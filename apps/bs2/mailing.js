// Best Series 2.0 — Rozesílky (hromadné e-maily) v administraci /admin/rozesilky.
// Segment příjemců (stav účtu, typ uživatele, přihlášení, objednávky/produkt, balíček lokality, ruční seznam),
// koncept → testovací e-mail → potvrzení počtu → fronta na pozadí (Amazon SES přes HolyOS /api/auth/bs2/bulk-mail).
// Každý e-mail má odkaz na odhlášení (/odhlasit-rozesilku/<token>); vyřazení (supporters.mail_optout) jde
// nastavit i ručně v detailu uživatele. Vyřazení a blokovaní se nikdy neposílají.
'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

module.exports = function mountMailing(app, ctx) {
  const { q, requireAdmin, wrap, V, PUBLIC_URL, HOLYOS_URL, SSO_SECRET, log, esc, upload } = ctx;
  const MAX_FILES_BYTES = 7 * 1024 * 1024; // přílohy dohromady (posílají se každému příjemci)
  const svcToken = () => jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, SSO_SECRET, { expiresIn: '2m' });
  // Odesílatelé = adresy Amazon SES nastavené v HolyOS (Centrum reklamy → Amazon SES → další odesílatelé)
  let _snd = { at: 0, v: null };
  async function senders() {
    if (_snd.v && Date.now() - _snd.at < 60e3) return _snd.v;
    try { const r = await fetch(HOLYOS_URL + '/api/auth/bs2/bulk-senders', { headers: { Authorization: 'Bearer ' + svcToken() }, signal: AbortSignal.timeout(10000) }); const j = await r.json(); _snd = { at: Date.now(), v: { list: j.senders || [], def: j.default || 'info@bestseries2.cz', configured: !!j.configured } }; }
    catch (e) { if (!_snd.v) _snd = { at: Date.now() - 50e3, v: { list: [], def: 'info@bestseries2.cz', configured: false, error: e.message } }; }
    return _snd.v;
  }
  // Přílohy kampaně (pro frontu držíme v paměti, ať se nenačítají z DB u každého e-mailu)
  const _files = new Map();
  async function filesOf(cid, withData) {
    if (!withData) return (await q('SELECT id, filename, content_type, size FROM mail_campaign_files WHERE campaign_id=$1 ORDER BY id', [cid])).rows;
    const c = _files.get(cid); if (c && Date.now() - c.at < 10 * 60e3) return c.v;
    const v = (await q('SELECT filename, content_type, data FROM mail_campaign_files WHERE campaign_id=$1 ORDER BY id', [cid])).rows.map((f) => ({ filename: f.filename, contentType: f.content_type || 'application/octet-stream', data: Buffer.from(f.data).toString('base64') }));
    _files.set(cid, { at: Date.now(), v }); return v;
  }
  const RATE = Math.max(1, Math.min(12, parseInt(process.env.BS2_BULK_RATE || '4', 10))); // e-mailů za sekundu (SES limit 14/s)
  const TYPES = { new: 'Nový', standard: 'Stávající', owner: 'Koupil prádlomat', seller: 'Může prodávat', location: 'Prověření lokality' };
  const STATUS = { draft: 'koncept', sending: 'odesílá se', paused: 'pozastaveno', done: 'dokončeno', canceled: 'zrušeno' };

  // ── Odhlašovací token (podepsané id uživatele) ──
  const KEY = crypto.createHmac('sha256', String(SSO_SECRET || 'bs2-unsub')).update('bs2-mail-unsub').digest();
  const sign = (id) => crypto.createHmac('sha256', KEY).update(String(id)).digest('base64url').slice(0, 22);
  const unsubToken = (id) => id + '.' + sign(id);
  const parseToken = (t) => { const [id, sig] = String(t || '').split('.'); const n = parseInt(id, 10); return Number.isInteger(n) && sig && sig === sign(n) ? n : null; };
  const unsubUrl = (id) => PUBLIC_URL + '/odhlasit-rozesilku/' + unsubToken(id);

  // ── Segment → SQL ──
  function normFilter(f) {
    f = f || {};
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
    return {
      status: arr(f.status).filter((x) => ['active', 'invited'].includes(x)),
      types: arr(f.types).filter((x) => TYPES[x] || x === 'supporter'), // supporter = Podporovatel (má standardní podporu)
      login: ['any', 'never', 'within', 'not_within'].includes(f.login) ? f.login : 'any',
      login_days: Math.max(1, Math.min(3650, parseInt(f.login_days, 10) || 30)),
      orders: ['any', 'has', 'none'].includes(f.orders) ? f.orders : 'any',
      product: String(f.product || '').slice(0, 200),
      location: ['any', 'has', 'none'].includes(f.location) ? f.location : 'any',
      support: ['any', 'has', 'none'].includes(f.support) ? f.support : 'any',
      manual: String(f.manual || '').slice(0, 200000),
      manual_only: !!f.manual_only && f.manual_only !== '0',
      // Blacklist této rozesílky — id kontaktů, které se mají vynechat. Platí jen
      // pro tuhle kampaň; trvalé odhlášení řeší odkaz v e-mailu (mail_optout).
      exclude: [...new Set((Array.isArray(f.exclude) ? f.exclude : String(f.exclude || '').split(','))
        .map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 20000),
    };
  }
  function whereFor(f) {
    const p = []; const w = ["s.status <> 'blocked'", 's.mail_optout = false', "s.email LIKE '%@%'"];
    const P = (v) => { p.push(v); return '$' + p.length; };
    const emails = [...new Set(String(f.manual || '').toLowerCase().split(/[\s,;]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    // Vyřazení platí vždy — i když kontakt přijde přes ruční seznam.
    if (f.exclude && f.exclude.length) w.push('s.id <> ALL(' + P(f.exclude) + '::int[])');
    if (f.manual_only) { w.push('lower(s.email) = ANY(' + P(emails) + '::text[])'); return { sql: w.join(' AND '), p, emails }; }
    if (f.status.length) w.push('s.status = ANY(' + P(f.status) + '::text[])');
    if (f.login === 'never') w.push('s.last_login_at IS NULL');
    if (f.login === 'within') w.push('s.last_login_at >= now() - make_interval(days => ' + P(f.login_days) + '::int)');
    if (f.login === 'not_within') w.push('(s.last_login_at IS NULL OR s.last_login_at < now() - make_interval(days => ' + P(f.login_days) + '::int))');
    const prod = f.product ? ' AND o.product_name ILIKE ' + P('%' + f.product + '%') : '';
    if (f.orders === 'has' || (f.orders === 'any' && f.product)) w.push("EXISTS (SELECT 1 FROM orders o WHERE o.supporter_id = s.id AND o.status <> 'cancelled'" + prod + ')');
    if (f.orders === 'none') w.push("NOT EXISTS (SELECT 1 FROM orders o WHERE o.supporter_id = s.id AND o.status <> 'cancelled'" + prod + ')');
    // Podporovatelé = mají standardní podporu (partner_support.std_total > 0) — stejně jako „se std. podporou“ v Uživatelích
    const STD = "(CASE WHEN s.partner_support->>'std_total' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (s.partner_support->>'std_total')::numeric ELSE 0 END > 0)";
    // Typ uživatele (zaškrtnuté typy platí NEBO); „Podporovatel“ = má standardní podporu
    const realTypes = f.types.filter((x) => x !== 'supporter'), wantSup = f.types.includes('supporter');
    if (realTypes.length || wantSup) w.push('(' + [realTypes.length ? 's.user_type = ANY(' + P(realTypes) + '::text[])' : null, wantSup ? STD : null].filter(Boolean).join(' OR ') + ')');
    if (f.support === 'has') w.push(STD);
    if (f.support === 'none') w.push('NOT coalesce(' + STD + ', false)');
    if (f.location === 'has') w.push('s.location_package IS NOT NULL');
    if (f.location === 'none') w.push('s.location_package IS NULL');
    // Ruční seznam = navíc k filtru. Pevné podmínky (blokovaný, odhlášený, platný e-mail
    // a blacklist této rozesílky) musí platit i pro něj, proto se z „nebo" vyjímají.
    const PEVNYCH = 3 + ((f.exclude && f.exclude.length) ? 1 : 0);
    if (emails.length) { const extra = w.splice(PEVNYCH); if (extra.length) w.push('((' + extra.join(' AND ') + ') OR lower(s.email) = ANY(' + P(emails) + '::text[]))'); }
    return { sql: w.join(' AND '), p, emails };
  }
  async function countFor(filter) {
    const f = normFilter(filter); const { sql, p, emails } = whereFor(f);
    const c = (await q('SELECT count(*)::int AS c FROM supporters s WHERE ' + sql, p)).rows[0].c;
    const sample = (await q('SELECT s.email, s.first_name, s.last_name FROM supporters s WHERE ' + sql + ' ORDER BY s.id LIMIT 8', p)).rows;
    const optout = (await q('SELECT count(*)::int AS c FROM supporters WHERE mail_optout = true')).rows[0].c;
    // Kolik z vybraných nemá křestní jméno — ti dostanou jen „Dobrý den,".
    // Lepší to vědět teď než až z odeslané rozesílky.
    let bezJmena = 0;
    try { bezJmena = (await q("SELECT count(*)::int AS c FROM supporters s WHERE " + sql + " AND coalesce(trim(s.first_name), '') = ''", p)).rows[0].c; }
    catch (e) { console.warn('[bs2 rozesílky] počet bez jména:', e.message); } // informativní údaj nesmí shodit počítadlo
    let unknown = [];
    if (emails.length) { const found = new Set((await q('SELECT lower(email) AS e FROM supporters WHERE lower(email) = ANY($1::text[])', [emails])).rows.map((r) => r.e)); unknown = emails.filter((e) => !found.has(e)).slice(0, 50); }
    return { count: c, sample, optout, unknown, excluded: (f.exclude || []).length, noname: bezJmena };
  }

  // ── Odeslání jednoho e-mailu přes HolyOS (Amazon SES) ──
  // Oslovení skloňujeme do 5. pádu („Dobrý den Tomáši,"). Přezdívka se do {jmeno}
  // NEDOSAZUJE — z „Dobrý den tomapXxER," je na první pohled strojový e-mail.
  // Když křestní jméno neznáme, zůstane prostě „Dobrý den," (osiřelé mezery a čárky
  // za prázdným jménem se uklidí níž).
  const VOC = require('./vocative');
  const osloveni = (u) => {
    const f = String((u && u.first_name) || '').trim();
    if (!f) return '';
    try { return VOC.vocFirst(f, VOC.isFemale(f, (u && u.last_name) || '')) || f; } catch (e) { return f; }
  };
  const uklid = (t) => String(t || '')
    .replace(/[ \t]+([,.!?])/g, '$1')      // „Dobrý den ," → „Dobrý den,"
    .replace(/([,;:])[ \t]*[,;:]+/g, '$1') // „Dobrý den,," → „Dobrý den," (čárka zbylá po jménu)
    .replace(/[ \t]{2,}/g, ' ')            // dvojité mezery po vypuštěném jménu
    .replace(/[ \t]+$/gm, '');
  const fill = (t, u) => uklid(String(t || '')
    .replace(/\{jmeno\}/g, osloveni(u))
    .replace(/\{prijmeni\}/g, (u && u.last_name) || '')
    .replace(/\{nick\}/g, (u && u.nick) || ''));
  async function sendOne(c, u) {
    const attachments = c.id ? await filesOf(c.id, true) : [];
    const r = await fetch(HOLYOS_URL + '/api/auth/bs2/bulk-mail', { method: 'POST', headers: { Authorization: 'Bearer ' + svcToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: u.email, from: c.sender || undefined, subject: fill(c.subject, u), body: fill(c.body, u), link: c.link || undefined, linkLabel: c.link_label || undefined, unsubUrl: u.id ? unsubUrl(u.id) : undefined, campaignId: c.id, attachments: attachments.length ? attachments : undefined }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HolyOS ' + r.status)); e.code = j.code; e.status = r.status; throw e; }
    return j;
  }

  // ── Fronta na pozadí ──
  let busy = false, fails = 0;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const c = (await q("SELECT * FROM mail_campaigns WHERE status = 'sending' ORDER BY started_at NULLS LAST, id LIMIT 1")).rows[0];
      if (!c) return;
      const batch = (await q(`SELECT r.id, r.email, s.id AS sid, s.first_name, s.last_name, s.nick, s.mail_optout, s.status AS sstatus
        FROM mail_campaign_recipients r LEFT JOIN supporters s ON s.id = r.supporter_id
        WHERE r.campaign_id = $1 AND r.status = 'queued' ORDER BY r.id LIMIT $2`, [c.id, RATE])).rows;
      if (!batch.length) { await q("UPDATE mail_campaigns SET status='done', finished_at=now(), updated_at=now() WHERE id=$1 AND status='sending'", [c.id]); return; }
      await Promise.all(batch.map(async (b) => {
        if (b.mail_optout || b.sstatus === 'blocked') { await q("UPDATE mail_campaign_recipients SET status='skipped', error=$2 WHERE id=$1", [b.id, b.mail_optout ? 'vyřazen z rozesílek' : 'blokovaný účet']); return; }
        try {
          await sendOne(c, { id: b.sid, email: b.email, first_name: b.first_name, last_name: b.last_name, nick: b.nick });
          await q("UPDATE mail_campaign_recipients SET status='sent', sent_at=now(), error=NULL WHERE id=$1", [b.id]);
          await q('UPDATE mail_campaigns SET sent = sent + 1, updated_at=now() WHERE id=$1', [c.id]);
          q('INSERT INTO mail_log (supporter_id, to_email, subject, status) VALUES ($1,$2,$3,$4)', [b.sid, b.email, ('[Rozesílka] ' + fill(c.subject, b)).slice(0, 300), 'sent']).catch(() => {});
          fails = 0;
        } catch (e) {
          if (e.code === 'no_ses_sender' || e.status === 401) { await q("UPDATE mail_campaigns SET status='paused', last_error=$2, updated_at=now() WHERE id=$1", [c.id, e.message.slice(0, 300)]); return; } // e-mail zůstává ve frontě
          fails++;
          await q("UPDATE mail_campaign_recipients SET status='failed', error=$2 WHERE id=$1", [b.id, String(e.message).slice(0, 300)]);
          await q('UPDATE mail_campaigns SET failed = failed + 1, last_error=$2, updated_at=now() WHERE id=$1', [c.id, String(e.message).slice(0, 300)]);
        }
      }));
      if (fails >= 25) { fails = 0; await q("UPDATE mail_campaigns SET status='paused', last_error=$2, updated_at=now() WHERE id=$1", [c.id, 'Pozastaveno automaticky: 25 chyb za sebou — zkontroluj odesílání a pokračuj.']); }
    } catch (e) { console.warn('[bs2 rozesílky]', e.message); }
    finally { busy = false; }
  }
  setInterval(tick, 1000).unref();

  // ── Veřejné odhlášení (odkaz v e-mailu) ──
  const pubPage = (title, html) => `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Best Series</title>
<style>body{margin:0;background:#04060c;color:#eaf2ff;font:15px/1.55 Inter,-apple-system,Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px}.c{max-width:460px;background:rgba(14,22,40,.85);border:1px solid rgba(120,160,255,.2);border-radius:18px;padding:28px;text-align:center}h1{font-size:22px;margin:0 0 10px}p{color:#8ea2c2}.b{display:inline-block;margin-top:14px;border:0;border-radius:12px;padding:12px 20px;font:inherit;font-weight:700;color:#fff;background:linear-gradient(90deg,#1e86e0,#7c5cff);cursor:pointer}.s{background:transparent;border:1px solid rgba(120,160,255,.35);color:#eaf2ff}</style></head><body><div class="c">${html}</div></body></html>`;
  app.get('/odhlasit-rozesilku/:t', wrap(async (req, res) => {
    const id = parseToken(req.params.t); const u = id ? (await q('SELECT id, email, mail_optout FROM supporters WHERE id=$1', [id])).rows[0] : null;
    if (!u) return res.status(404).send(pubPage('Odkaz neplatný', '<h1>Odkaz je neplatný</h1><p>Odhlašovací odkaz nenašel žádný účet.</p>'));
    const t = esc(req.params.t);
    res.set('Cache-Control', 'no-store').send(u.mail_optout
      ? pubPage('Odhlášeno', `<h1>Jste odhlášeni</h1><p>Na adresu <b>${esc(u.email)}</b> už hromadné e-maily od Best Series neposíláme. Důležité e-maily k vašemu účtu (např. obnova hesla) dostanete dál.</p><form method="post" action="/odhlasit-rozesilku/${t}"><input type="hidden" name="a" value="in"><button class="b s">Chci e-maily zase dostávat</button></form>`)
      : pubPage('Odhlášení z e-mailů', `<h1>Odhlásit se z e-mailů?</h1><p>Adresa <b>${esc(u.email)}</b> přestane dostávat hromadné e-maily od Best Series.</p><form method="post" action="/odhlasit-rozesilku/${t}"><input type="hidden" name="a" value="out"><button class="b">Odhlásit se</button></form>`));
  }));
  app.post('/odhlasit-rozesilku/:t', wrap(async (req, res) => {
    const id = parseToken(req.params.t); if (!id) return res.status(404).send(pubPage('Odkaz neplatný', '<h1>Odkaz je neplatný</h1>'));
    const out = String((req.body || {}).a) !== 'in';
    await q('UPDATE supporters SET mail_optout=$2, mail_optout_at=CASE WHEN $2 THEN now() ELSE NULL END, mail_optout_by=CASE WHEN $2 THEN $3 ELSE NULL END WHERE id=$1', [id, out, 'user']);
    await log({ name: 'uživatel #' + id }, out ? 'mail_optout' : 'mail_optin', { id, via: 'odkaz v e-mailu' });
    res.redirect(303, '/odhlasit-rozesilku/' + encodeURIComponent(req.params.t));
  }));
  // List-Unsubscribe „one-click" (RFC 8058) — klienti jako Gmail posílají POST bez formuláře
  app.post('/odhlasit-rozesilku/:t/one-click', wrap(async (req, res) => {
    const id = parseToken(req.params.t); if (id) await q("UPDATE supporters SET mail_optout=true, mail_optout_at=now(), mail_optout_by='user' WHERE id=$1", [id]);
    res.status(id ? 200 : 404).end();
  }));

  // ── Administrace ──
  const fmt = (d) => (d ? new Date(d).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const CSS = `<style>.ml-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:start}@media(max-width:900px){.ml-grid{grid-template-columns:1fr}}
.ml-chips{display:flex;flex-wrap:wrap;gap:6px}.ml-chips label{display:inline-flex;align-items:center;gap:6px;margin:0;padding:6px 10px;border:1px solid var(--border2);border-radius:999px;font-size:13px;color:var(--text);cursor:pointer}.ml-chips input{width:auto;margin:0}
.ml-st{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 9px;border:1px solid var(--border2)}.ml-st.sending{color:#4fd1ff;border-color:#4fd1ff}.ml-st.done{color:var(--ok);border-color:var(--ok)}.ml-st.paused{color:#ffd866;border-color:#ffd866}.ml-st.canceled{color:var(--err);border-color:var(--err)}
.ml-bar{height:10px;border-radius:999px;background:rgba(120,160,255,.12);overflow:hidden}.ml-bar i{display:block;height:100%;background:linear-gradient(90deg,#1e86e0,#7c5cff)}
.ml-ai,.ml-test{margin-top:14px;padding:12px;border-radius:12px;border:1px dashed rgba(124,92,255,.45);background:rgba(124,92,255,.06)}.ml-test{border-color:rgba(79,209,255,.35);background:rgba(79,209,255,.05)}.ml-files{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}.ml-file{display:flex;gap:8px;align-items:center;margin:0;font-size:13.5px;color:var(--text)}.ml-file input{width:auto;margin:0}
.ml-cnt{font-size:34px;font-weight:800;letter-spacing:-.02em}.ml-prev{white-space:pre-wrap;background:rgba(4,8,16,.6);border:1px solid var(--border);border-radius:12px;padding:12px;font-size:14px;max-height:340px;overflow:auto}</style>`;

  app.get('/admin/rozesilky', requireAdmin, wrap(async (req, res) => {
    const rows = (await q('SELECT id, name, subject, status, total, sent, failed, created_by, created_at, started_at, finished_at FROM mail_campaigns ORDER BY id DESC LIMIT 200')).rows;
    const opt = (await q('SELECT id, email, first_name, last_name, mail_optout_at, mail_optout_by FROM supporters WHERE mail_optout = true ORDER BY mail_optout_at DESC NULLS LAST LIMIT 100')).rows;
    const optN = (await q('SELECT count(*)::int AS c FROM supporters WHERE mail_optout = true')).rows[0].c;
    const msg = req.query.msg ? `<div class="msg ok">${esc(req.query.msg)}</div>` : '';
    res.send(V.adminLayout('Rozesílky', 'mail', req.admin, CSS + `
  <div class="row" style="justify-content:space-between"><h1 style="margin:0">Rozesílky <span class="muted" style="font-size:14px;font-weight:500">hromadné e-maily</span></h1><a class="btn" href="/admin/rozesilky/new">+ Nová rozesílka</a></div>
  <p class="muted small">Odesílá se přes Amazon SES (výchozí odesílatel <b>${esc(process.env.BS2_BULK_FROM_HINT || 'info@bestseries2.cz')}</b>, odpovědi chodí na info@bestseries.cz), postupně na pozadí (${RATE} e-mailů/s). Vyřazení uživatelé a blokované účty se nikdy neposílají.</p>${msg}
  <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Název</th><th>Předmět</th><th>Stav</th><th>Průběh</th><th>Vytvořeno</th></tr></thead><tbody>
  ${rows.map((c) => { const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0; return `<tr><td><a href="/admin/rozesilky/${c.id}"><b>${esc(c.name)}</b></a></td><td class="small">${esc(c.subject)}</td><td><span class="ml-st ${esc(c.status)}">${STATUS[c.status] || esc(c.status)}</span></td>
    <td style="min-width:160px">${c.total ? `<div class="ml-bar"><i style="width:${pct}%"></i></div><div class="small muted">${c.sent} odesláno${c.failed ? ' · ' + c.failed + ' chyb' : ''} / ${c.total}</div>` : '<span class="muted small">—</span>'}</td><td class="small muted">${fmt(c.created_at)}${c.created_by ? '<br>' + esc(c.created_by) : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Zatím žádná rozesílka.</td></tr>'}
  </tbody></table></div></div>
  <details class="card"><summary><b>Vyřazení z rozesílek</b> <span class="muted">(${optN})</span></summary>
  <p class="muted small">Odhlásili se sami odkazem v e-mailu, nebo je vyřadil správce v detailu uživatele. Vrátit je jde v detailu uživatele.</p>
  <table><thead><tr><th>Uživatel</th><th>Od</th><th>Kdo</th></tr></thead><tbody>${opt.map((u) => `<tr><td><a href="/admin/supporters/${u.id}">${esc([u.first_name, u.last_name].filter(Boolean).join(' ') || u.email)}</a> <span class="small muted">${esc(u.email)}</span></td><td class="small">${fmt(u.mail_optout_at)}</td><td class="small">${u.mail_optout_by === 'user' ? 'sám (odkaz)' : esc(u.mail_optout_by || '—')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nikdo.</td></tr>'}</tbody></table></details>`, HOLYOS_URL));
  }));

  async function load(id) { return (await q('SELECT * FROM mail_campaigns WHERE id=$1', [id])).rows[0] || null; }
  const products = async () => (await q("SELECT product_name, count(*)::int AS c FROM orders GROUP BY product_name ORDER BY c DESC LIMIT 60")).rows;

  function editor(c, prods, admin, snd, files) {
    snd = snd || { list: [], def: 'info@bestseries2.cz' }; files = files || [];
    const f = normFilter(c ? c.filter : { status: ['active', 'invited'] });
    const ro = c && c.status !== 'draft';
    const dis = ro ? ' disabled' : '';
    const chk = (name, val, on, label) => `<label><input type="checkbox" name="${name}" value="${val}"${on ? ' checked' : ''}${dis}> ${label}</label>`;
    const sel = (name, val, opts) => `<select name="${name}" style="width:auto"${dis}>${opts.map(([v, l]) => `<option value="${v}"${val === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const pct = c && c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
    return CSS + `
  <div class="row" style="justify-content:space-between"><h1 style="margin:0">${c ? esc(c.name) : 'Nová rozesílka'} ${c ? `<span class="ml-st ${esc(c.status)}">${STATUS[c.status]}</span>` : ''}</h1><a class="btn sec sm" href="/admin/rozesilky">← Rozesílky</a></div>
  ${c && c.status !== 'draft' ? `<div class="card" id="ml-prog"><div class="row" style="justify-content:space-between"><b>Průběh</b><span class="small muted" id="ml-ptxt">${c.sent} odesláno · ${c.failed} chyb / ${c.total}</span></div><div class="ml-bar" style="margin:10px 0"><i id="ml-pbar" style="width:${pct}%"></i></div>
    ${c.last_error ? `<div class="msg err small" id="ml-perr">${esc(c.last_error)}</div>` : '<div id="ml-perr"></div>'}
    <div class="row">${c.status === 'sending' ? `<form method="post" action="/admin/rozesilky/${c.id}/pause"><button class="btn sec sm">⏸ Pozastavit</button></form>` : ''}${c.status === 'paused' ? `<form method="post" action="/admin/rozesilky/${c.id}/resume"><button class="btn sm">▶ Pokračovat</button></form>` : ''}${['sending', 'paused'].includes(c.status) ? `<form method="post" action="/admin/rozesilky/${c.id}/cancel" onsubmit="return confirm('Zrušit rozesílku? Zbylé e-maily se už nepošlou.')"><button class="btn danger sm">✕ Zrušit</button></form>` : ''}</div>
    <div class="small muted" style="margin-top:8px">Spuštěno: ${fmt(c.started_at)}${c.finished_at ? ' · dokončeno: ' + fmt(c.finished_at) : ''}</div></div>` : ''}
  <form method="post" action="/admin/rozesilky/${c ? c.id : 'new'}" id="ml-form" enctype="multipart/form-data"><div class="ml-grid">
  <div class="card"><h2 style="margin-top:0">E-mail</h2>
    <label>Odesílatel</label>${(() => { const cur = (c && c.sender) || snd.def; const opts = snd.list.map((x) => x.address); if (cur && opts.indexOf(cur) < 0) opts.unshift(cur); return `<select name="sender"${dis}>${opts.map((a) => `<option value="${esc(a)}"${a === cur ? ' selected' : ''}>${esc(a)}${snd.list.some((x) => x.address === a) ? '' : ' — není v Amazon SES!'}</option>`).join('')}</select>`; })()}
    <div class="small muted">Adresy z HolyOS → Centrum reklamy → Amazon SES (další odesílatelé). ${snd.configured === false ? '<span style="color:#ffd866">Amazon SES v HolyOS není nastavený.</span>' : ''}</div>
    <label>Přílohy</label>${files.length ? `<div class="ml-files">${files.map((f) => `<label class="ml-file">📎 <a href="/admin/rozesilky/file/${f.id}" target="_blank">${esc(f.filename)}</a> <span class="small muted">${Math.round(f.size / 1024)} kB</span>${ro ? '' : ` <button type="button" class="ml-rmfile" data-file="${f.id}" data-name="${esc(f.filename)}" title="Odebrat přílohu" style="margin-left:8px;background:none;border:0;color:#ff8f8f;font-size:15px;line-height:1;cursor:pointer;padding:2px 6px">✕</button>`}</label>`).join('')}</div>` : ''}
    ${ro ? '' : `<input type="file" name="files" id="ml-files" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip">
    <div class="small muted">PDF, obrázky, Word, Excel, PowerPoint, TXT/CSV, ZIP · max 5 souborů a 7 MB dohromady. Příloha se posílá každému příjemci — u velkých souborů radši odkaz.</div>
    <div class="ml-ai"><b>✨ Vytvořit e-mail pomocí AI</b><div class="small muted">Podle vybraných/nahraných příloh (PDF, obrázek, Word, Excel, text) navrhne předmět i text. Můžeš doplnit pokyn.</div>
      <textarea id="ml-ai-hint" rows="2" placeholder="např. pozvánka na webinář, krátce a přátelsky, zdůraznit termín"></textarea>
      <div class="row" style="margin-top:6px"><button type="button" class="btn sec sm" id="ml-ai">✨ Vygenerovat předmět a text</button><span class="small muted" id="ml-ai-st"></span></div></div>`}
    <label>Název rozesílky (jen pro vás)</label><input name="name" required maxlength="120" value="${esc(c ? c.name : '')}"${dis}>
    <label>Předmět</label><input name="subject" required maxlength="200" value="${esc(c ? c.subject : '')}"${dis}>
    <label>Text e-mailu</label><textarea name="body" rows="12" required maxlength="20000"${dis}>${esc(c ? c.body : 'Dobrý den {jmeno},\n\n')}</textarea>
    <div class="small muted">Zástupné znaky: <code>{jmeno}</code> (křestní jméno v 5. pádě — „Tomáši“; komu jméno neznáme, zůstane jen „Dobrý den,“) <code>{prijmeni}</code> <code>{nick}</code>. Prázdný řádek = nový odstavec. Odkaz na odhlášení se přidá na konec automaticky.</div>
    <label>Tlačítko — odkaz (nepovinné)</label><input name="link" type="url" placeholder="https://www.bestseries2.cz/…" value="${esc(c ? c.link || '' : '')}"${dis}>
    <label>Tlačítko — text</label><input name="link_label" maxlength="80" placeholder="např. Otevřít Best Series" value="${esc(c ? c.link_label || '' : '')}"${dis}>
    <div class="small muted">Odkaz smí vést na bestseries2.cz, bestseries.cz, laundromats.eu, pradlomaty.info nebo compounder.world.</div>
    ${ro ? '' : `<div class="ml-test"><b>✉ Testovací e-mail</b><div class="small muted">Uloží koncept a pošle ho přesně tak, jak dorazí příjemcům (předmět s [TEST]).</div>
      <div class="row" style="margin-top:6px"><input name="test_to" type="email" placeholder="vas@email.cz" style="flex:1" value="${esc(admin.email || '')}"><button class="btn sec" type="submit" name="_test" value="1">✉ Uložit a poslat test</button></div></div>`}
  </div>
  <div class="card"><h2 style="margin-top:0">Komu</h2>
    <label>Stav účtu</label><div class="ml-chips">${chk('status', 'active', f.status.includes('active'), 'Aktivní')}${chk('status', 'invited', f.status.includes('invited'), 'Čeká na první přihlášení')}</div>
    <div class="small muted">Nic nezaškrtnuto = oba stavy. Blokovaní se neposílají nikdy.</div>
    <label>Typ uživatele</label><div class="ml-chips">${Object.entries(TYPES).map(([k, l]) => chk('types', k, f.types.includes(k), l)).join('')}${chk('types', 'supporter', f.types.includes('supporter'), '💙 Podporovatel')}</div>
    <div class="small muted">Nic nezaškrtnuto = všechny typy. Zaškrtnuté platí „nebo“. Podporovatel = má standardní podporu (jako „se std. podporou“ v Uživatelích).</div>
    <label>Přihlášení</label><div class="row">${sel('login', f.login, [['any', 'kdykoli / nikdy'], ['never', 'nikdy se nepřihlásil'], ['within', 'přihlášen za posledních'], ['not_within', 'nepřihlášen posledních']])}<input name="login_days" type="number" min="1" max="3650" style="width:90px" value="${f.login_days}"${dis}> <span class="muted small">dní</span></div>
    <label>Objednávky</label><div class="row">${sel('orders', f.orders, [['any', 'nerozhoduje'], ['has', 'má objednávku'], ['none', 'nemá objednávku']])}
      <input name="product" list="ml-prods" placeholder="produkt (nepovinné)" style="flex:1;min-width:160px" value="${esc(f.product)}"${dis}><datalist id="ml-prods">${prods.map((p) => `<option value="${esc(p.product_name)}">${p.c}×</option>`).join('')}</datalist></div>
    <label>Balíček Prověření lokality</label>${sel('location', f.location, [['any', 'nerozhoduje'], ['has', 'má balíček'], ['none', 'nemá balíček']])}
    <label>Ruční seznam e-mailů</label><textarea name="manual" rows="4" placeholder="jeden e-mail na řádek (nebo oddělené čárkou)"${dis}>${esc(f.manual)}</textarea>
    <div class="ml-chips" style="margin-top:6px"><label><input type="checkbox" name="manual_only" value="1"${f.manual_only ? ' checked' : ''}${dis}> Poslat JEN na ruční seznam (ignorovat filtry)</label></div>
    <div class="small muted">Bez zaškrtnutí se ruční seznam přidá k filtrům. E-mail musí patřit uživateli BS2.</div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)"><div class="row" style="justify-content:space-between"><span class="muted">Příjemců podle výběru</span>
      <span style="display:inline-flex;border-radius:8px;overflow:hidden">
        <button type="button" class="btn sec sm" id="ml-count" style="border-radius:8px 0 0 8px;border-right:0">↻ Spočítat</button>
        <button type="button" class="btn sec sm" id="ml-bl" style="border-radius:0 8px 8px 0" title="Vybrat kontakty, které tuhle rozesílku nedostanou">🚫 Blacklist <span id="ml-bl-n">0</span></button>
      </span></div>
      <input type="hidden" name="exclude" id="ml-exclude" value="${(f.exclude || []).join(',')}">
      <div class="ml-cnt" id="ml-n">${c && c.total && ro ? c.total : '–'}</div><div class="small muted" id="ml-info"></div></div>
  </div></div>
  ${ro ? '' : `<div class="row" style="margin-top:4px"><button class="btn" type="submit">💾 Uložit koncept</button></div>`}
  </form>
  ${c && c.status === 'draft' ? `<div class="ml-grid" style="margin-top:14px">
    <div class="card"><h2 style="margin-top:0">🚀 Spustit rozesílku</h2><p class="small muted">Seznam příjemců se zafixuje v okamžiku spuštění. Pro potvrzení opiš přesný počet příjemců.</p>
      <form method="post" action="/admin/rozesilky/${c.id}/start" class="row" id="ml-start"><input name="confirm" inputmode="numeric" required placeholder="počet příjemců" style="width:170px"><button class="btn">🚀 Spustit</button></form></div>
  </div>` : ''}
  <script>(function(){var f=document.getElementById('ml-form'),b=document.getElementById('ml-count'),n=document.getElementById('ml-n'),inf=document.getElementById('ml-info');
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function data(){var o={status:[],types:[]};f.querySelectorAll('input,select,textarea').forEach(function(e){if(!e.name)return;if(e.type==='checkbox'){if(e.checked){if(e.name==='status'||e.name==='types')o[e.name].push(e.value);else o[e.name]=e.value;}}else o[e.name]=e.value;});return o;}
  var ai=document.getElementById('ml-ai');if(ai)ai.onclick=function(){var st=document.getElementById('ml-ai-st'),fd=new FormData(),fi=document.getElementById('ml-files');
    for(var i=0;fi&&i<fi.files.length;i++)fd.append('files',fi.files[i]);fd.append('hint',document.getElementById('ml-ai-hint').value);fd.append('campaign_id','${c ? c.id : ''}');
    ai.disabled=true;st.textContent='Čtu přílohy a píšu e-mail… (do minuty)';
    fetch('/admin/rozesilky/ai',{method:'POST',credentials:'same-origin',body:fd}).then(function(r){return r.json();}).then(function(j){ai.disabled=false;if(j.error){st.textContent='⚠ '+j.error;return;}
      var S=f.querySelector('[name=subject]'),B=f.querySelector('[name=body]'),N=f.querySelector('[name=name]');if(S.value&&!confirm('Přepsat stávající předmět a text návrhem od AI?')){st.textContent='';return;}
      S.value=j.subject||'';B.value=j.body||'';if(N&&!N.value)N.value=j.subject||'';st.textContent='✓ Hotovo — zkontroluj a uprav text.';}).catch(function(){ai.disabled=false;st.textContent='⚠ Nepodařilo se.';});};
  // Příloha se odebere hned po kliknutí na ✕ — dřív se musela zaškrtnout a teprve
  // uložit celý formulář, což vypadalo, že odebrání nefunguje.
  document.querySelectorAll('.ml-rmfile').forEach(function(b){
    b.onclick=function(){
      if(!confirm('Odebrat přílohu „'+b.getAttribute('data-name')+'“?'))return;
      b.disabled=true;
      fetch('/admin/rozesilky/${c ? c.id : 0}/file/'+b.getAttribute('data-file')+'/delete',{method:'POST',credentials:'same-origin'})
        .then(function(r){return r.json();}).then(function(j){
          if(j&&j.ok){var w=b.closest('.ml-file');if(w)w.remove();
            var box=document.querySelector('.ml-files');if(box&&!box.querySelector('.ml-file'))box.remove();}
          else{b.disabled=false;alert((j&&j.error)||'Přílohu se nepodařilo odebrat.');}
        }).catch(function(){b.disabled=false;alert('Přílohu se nepodařilo odebrat.');});
    };
  });

  // ── Blacklist této rozesílky ────────────────────────────────────────────
  // Vyřazení platí jen pro tuhle kampaň (uloží se k ní do filtru). Trvalé
  // odhlášení dál řeší odkaz v e-mailu.
  var EX=document.getElementById('ml-exclude');
  function exList(){return (EX.value||'').split(',').map(function(x){return parseInt(x,10);}).filter(Boolean);}
  function exSet(a){EX.value=a.join(',');var n=document.getElementById('ml-bl-n');if(n)n.textContent=a.length;count();}
  exSet(exList());
  var blBtn=document.getElementById('ml-bl');
  if(blBtn)blBtn.onclick=function(){
    var vyb={};exList().forEach(function(id){vyb[id]=true;});
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:900;display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML='<style>.bl-row:hover{background:rgba(120,160,255,.08)}</style>'
      +'<div style="background:#0e1526;border:1px solid rgba(120,160,255,.28);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.6);max-width:780px;width:100%;max-height:86vh;display:flex;flex-direction:column;overflow:hidden">'
      +'<div style="padding:16px 20px;border-bottom:1px solid rgba(120,160,255,.2);background:#0b1120"><div style="font-size:19px;font-weight:800">🚫 Blacklist rozesílky</div>'
      +'<div class="small muted" style="margin-top:3px">Zaškrtnuté kontakty tuhle rozesílku nedostanou. Platí jen pro ni — natrvalo se nikdo neodhlašuje.</div></div>'
      +'<div style="padding:12px 20px;border-bottom:1px solid rgba(120,160,255,.2);background:#0b1120;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
        +'<input id="bl-q" placeholder="Hledat jméno nebo e-mail…" style="flex:1;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg,#070b14);color:inherit">'
        +'<span class="small muted" id="bl-info"></span></div>'
      +'<div id="bl-list" style="overflow-y:auto;overflow-x:hidden;flex:1;min-height:0"><div class="small muted" style="padding:14px">Načítám…</div></div>'
      +'<div style="padding:12px 20px;border-top:1px solid rgba(120,160,255,.2);background:#0b1120;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<span class="small muted" id="bl-cnt"></span>'
        +'<span style="display:flex;gap:8px"><button type="button" class="btn sec sm" id="bl-clear">Zrušit všechna vyřazení</button>'
        +'<button type="button" class="btn sec sm" id="bl-x">Zavřít</button>'
        +'<button type="button" class="btn sm" id="bl-ok">Použít</button></span></div></div>';
    var puvodniScroll=document.body.style.overflow;document.body.style.overflow='hidden';
    document.body.appendChild(ov);
    var L=ov.querySelector('#bl-list'),Q=ov.querySelector('#bl-q'),INF=ov.querySelector('#bl-info'),CNT=ov.querySelector('#bl-cnt');
    function pocet(){var n=Object.keys(vyb).filter(function(k){return vyb[k];}).length;CNT.textContent='Vyřazeno '+n+' kontaktů';}
    // Jeden příjemce = jeden řádek ve sloupcích: zaškrtávátko | jméno | příjmení | e-mail.
    var GRID='display:grid;grid-template-columns:24px minmax(90px,1fr) minmax(110px,1.2fr) minmax(170px,2fr);gap:10px;align-items:center;padding:6px 10px';
    function hlavicka(){return '<div class="small muted" style="'+GRID+';position:sticky;top:0;background:#0e1526;border-bottom:1px solid rgba(120,160,255,.2);padding-top:8px;padding-bottom:8px;z-index:1">'
      +'<span></span><span>Jméno</span><span>Příjmení</span><span>E-mail</span></div>';}
    function radek(r){
      var prazdne='<span class="muted" style="opacity:.5">—</span>';
      return '<label class="bl-row" style="'+GRID+';border-radius:8px;cursor:pointer;border-bottom:1px solid rgba(120,160,255,.07)">'
        +'<input type="checkbox" data-id="'+r.id+'"'+(vyb[r.id]?' checked':'')+' style="margin:0">'
        +'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(r.first_name?esc(r.first_name):prazdne)+'</span>'
        +'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">'+(r.last_name?esc(r.last_name):(r.nick?'<span class="muted">'+esc(r.nick)+'</span>':prazdne))+'</span>'
        +'<span class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85">'+esc(r.email)+'</span></label>';}
    var t=null;
    function nacti(){
      var dotaz=Q.value;
      fetch('/admin/rozesilky/recipients',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({filter:data(),q:dotaz})}).then(function(r){return r.json();}).then(function(j){
        if(j.error){L.innerHTML='<div class="small" style="padding:14px;color:#ff8f8f">'+esc(j.error)+'</div>';return;}
        var ids={};var html=hlavicka();
        (j.excluded||[]).forEach(function(r){ids[r.id]=1;});
        if((j.excluded||[]).length){html+='<div class="small" style="padding:9px 10px 4px;color:#ffd866;font-weight:700">Vyřazení z této rozesílky ('+j.excluded.length+')</div>'+j.excluded.map(radek).join('');
          html+='<div class="small muted" style="padding:12px 10px 4px;font-weight:700">Ostatní příjemci</div>';}
        var zbytek=(j.rows||[]).filter(function(r){return !ids[r.id];});
        html+=zbytek.length?zbytek.map(radek).join(''):'<div class="small muted" style="padding:14px">Nikdo neodpovídá.</div>';
        L.innerHTML=html;
        INF.textContent=j.total>j.limit?('zobrazeno '+j.limit+' z '+j.total+' — zbytek najdeš hledáním'):(j.total+' příjemců');
        pocet();});
    }
    Q.oninput=function(){clearTimeout(t);t=setTimeout(nacti,250);};
    L.addEventListener('change',function(e){var c=e.target.closest('input[type=checkbox]');if(!c)return;
      var id=parseInt(c.getAttribute('data-id'),10);if(c.checked)vyb[id]=true;else delete vyb[id];pocet();});
    ov.querySelector('#bl-clear').onclick=function(){vyb={};L.querySelectorAll('input[type=checkbox]').forEach(function(c){c.checked=false;});pocet();};
    var zavri=function(){document.body.style.overflow=puvodniScroll;document.body.removeChild(ov);};
    ov.querySelector('#bl-x').onclick=zavri;
    ov.onclick=function(e){if(e.target===ov)zavri();};
    ov.querySelector('#bl-ok').onclick=function(){exSet(Object.keys(vyb).filter(function(k){return vyb[k];}).map(Number));zavri();};
    nacti();
  };

  var seq=0;function count(){if(!b)return;var my=++seq;b.disabled=true;n.style.opacity='.45';fetch('/admin/rozesilky/count',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({filter:data()})}).then(function(r){return r.json();}).then(function(j){if(my!==seq)return;b.disabled=false;n.style.opacity='';if(j.error){n.textContent='—';inf.innerHTML='<span style="color:#ff8f8f;font-weight:700">⚠ Počet se nepodařilo spočítat:</span> <span style="color:#ff8f8f">'+esc(j.error)+'</span>';return;}n.textContent=j.count.toLocaleString('cs-CZ');inf.innerHTML=(j.sample.length?'např. '+j.sample.map(function(s){return esc(s.email);}).join(', ')+'<br>':'')+(j.excluded?'<span style="color:#ffd866">Blacklist této rozesílky: '+j.excluded+' kontaktů</span><br>':'')+(j.noname?'<span style="color:#ffd866">Bez křestního jména: '+j.noname+' — dostanou jen „Dobrý den,“</span><br>':'')+'Trvale odhlášených z rozesílek: '+j.optout+(j.unknown.length?'<br><span style="color:#ffd866">Nenalezeno v BS2: '+j.unknown.map(esc).join(', ')+'</span>':'');}).catch(function(){b.disabled=false;n.style.opacity='';n.textContent='—';inf.innerHTML='<span style="color:#ff8f8f;font-weight:700">⚠ Server neodpověděl — zkus Spočítat znovu.</span>';});}
  // Přepočet při každé změně filtru (zaškrtávátka/výběry hned, psaní s krátkou prodlevou)
  var tmr=null;function later(ms){clearTimeout(tmr);tmr=setTimeout(count,ms);}
  var komu=b&&b.closest('.card');if(komu&&!${ro ? 'true' : 'false'}){komu.addEventListener('change',function(e){if(e.target.matches('input,select,textarea'))later(150);});komu.addEventListener('input',function(e){if(e.target.matches('input[type=number],input:not([type]),input[type=text],textarea'))later(600);});}
  if(b){b.onclick=count;${ro ? '' : 'count();'}}
  ${c && ['sending', 'paused'].includes(c.status) ? `setInterval(function(){fetch('/admin/rozesilky/${c.id}/status',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){var p=j.total?Math.round((j.sent+j.failed)/j.total*100):0;document.getElementById('ml-pbar').style.width=p+'%';document.getElementById('ml-ptxt').textContent=j.sent+' odesláno · '+j.failed+' chyb / '+j.total;if(j.status!=='${c.status}')location.reload();});},3000);` : ''}
  })();<\/script>`;
  }

  app.get('/admin/rozesilky/new', requireAdmin, wrap(async (req, res) => res.send(V.adminLayout('Nová rozesílka', 'mail', req.admin, editor(null, await products(), req.admin, await senders(), []), HOLYOS_URL))));
  app.get('/admin/rozesilky/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
    const c = await load(req.params.id); if (!c) return res.redirect('/admin/rozesilky');
    const m = req.query.msg ? `<div class="msg ${req.query.err ? 'err' : 'ok'}">${esc(req.query.msg)}</div>` : '';
    res.send(V.adminLayout('Rozesílka', 'mail', req.admin, m + editor(c, await products(), req.admin, await senders(), await filesOf(c.id)), HOLYOS_URL));
  }));
  const filterFromBody = (b) => normFilter({ status: b.status, types: b.types, login: b.login, login_days: b.login_days, orders: b.orders, product: b.product, location: b.location, support: b.support, manual: b.manual, manual_only: b.manual_only, exclude: b.exclude });
  const fields = (b) => ({ name: String(b.name || '').trim().slice(0, 120) || 'Rozesílka', subject: String(b.subject || '').trim().slice(0, 200), body: String(b.body || '').slice(0, 20000), link: /^https:\/\//.test(String(b.link || '').trim()) ? String(b.link).trim().slice(0, 500) : null, link_label: String(b.link_label || '').trim().slice(0, 80) || null, sender: /^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(String(b.sender || '').trim()) ? String(b.sender).trim().slice(0, 160) : null });
  const multi = upload.array('files', 5);
  // Uloží nové přílohy / odebere zaškrtnuté; vrací chybovou hlášku nebo ''
  async function saveFiles(cid, req) {
    const rm = [].concat((req.body || {}).remove_files || []).map((x) => parseInt(x, 10)).filter(Boolean);
    if (rm.length) await q('DELETE FROM mail_campaign_files WHERE campaign_id=$1 AND id = ANY($2::int[])', [cid, rm]);
    const nf = (req.files || []).filter((f) => f.size);
    const have = (await q('SELECT count(*)::int AS n, coalesce(sum(size),0)::int AS b FROM mail_campaign_files WHERE campaign_id=$1', [cid])).rows[0];
    let msg = '';
    if (nf.length) {
      const bytes = have.b + nf.reduce((a, f) => a + f.size, 0);
      if (have.n + nf.length > 5) msg = 'Max 5 příloh — nové přílohy se neuložily.';
      else if (bytes > MAX_FILES_BYTES) msg = 'Přílohy by měly dohromady ' + Math.round(bytes / 1048576 * 10) / 10 + ' MB (max 7 MB) — nové přílohy se neuložily.';
      else for (const f of nf) await q('INSERT INTO mail_campaign_files (campaign_id, filename, content_type, size, data) VALUES ($1,$2,$3,$4,$5)', [cid, String(f.originalname || 'priloha').replace(/[\r\n"\\/]/g, '_').slice(0, 150), String(f.mimetype || 'application/octet-stream').slice(0, 100), f.size, f.buffer]);
    }
    _files.delete(cid);
    return msg;
  }
  async function afterSave(req, res, cid, okMsg) {
    const fmsg = await saveFiles(cid, req);
    const b = req.body || {};
    if (b._test) {
      const to = String(b.test_to || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.redirect('/admin/rozesilky/' + cid + '?err=1&msg=' + encodeURIComponent('Uloženo, ale pro test zadej platný e-mail.'));
      const c = await load(cid);
      const u = (await q('SELECT id, email, first_name, last_name, nick FROM supporters WHERE lower(email)=$1', [to])).rows[0] || { id: null, email: to, first_name: (req.admin.name || '').split(' ')[0], last_name: (req.admin.name || '').split(' ').slice(1).join(' '), nick: '' };
      try { const r = await sendOne(Object.assign({}, c, { subject: '[TEST] ' + c.subject }), Object.assign({}, u, { email: to })); await log(req.admin, 'mail_campaign_test', { id: cid, to });
        return res.redirect('/admin/rozesilky/' + cid + '?msg=' + encodeURIComponent('Uloženo a test odeslán na ' + to + (r.via ? ' (' + r.via + ')' : '') + '.' + (fmsg ? ' ' + fmsg : '')));
      } catch (e) { return res.redirect('/admin/rozesilky/' + cid + '?err=1&msg=' + encodeURIComponent('Uloženo, ale test se nepodařilo odeslat: ' + e.message)); }
    }
    res.redirect('/admin/rozesilky/' + cid + (fmsg ? '?err=1&msg=' + encodeURIComponent(fmsg) : '?msg=' + encodeURIComponent(okMsg)));
  }
  app.post('/admin/rozesilky/new', requireAdmin, multi, wrap(async (req, res) => {
    const x = fields(req.body || {}); if (!x.subject || !x.body.trim()) return res.redirect('/admin/rozesilky/new');
    const r = await q('INSERT INTO mail_campaigns (name, subject, body, link, link_label, filter, created_by, sender) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [x.name, x.subject, x.body, x.link, x.link_label, JSON.stringify(filterFromBody(req.body || {})), req.admin.name || null, x.sender]);
    await log(req.admin, 'mail_campaign_new', { id: r.rows[0].id, name: x.name });
    await afterSave(req, res, r.rows[0].id, 'Koncept uložen. Pošli si test a pak rozesílku spusť.');
  }));
  app.post('/admin/rozesilky/:id(\\d+)', requireAdmin, multi, wrap(async (req, res) => {
    const c = await load(req.params.id); if (!c || c.status !== 'draft') return res.redirect('/admin/rozesilky/' + req.params.id);
    const x = fields(req.body || {});
    await q('UPDATE mail_campaigns SET name=$2, subject=$3, body=$4, link=$5, link_label=$6, filter=$7, sender=$8, updated_at=now() WHERE id=$1', [c.id, x.name, x.subject || c.subject, x.body || c.body, x.link, x.link_label, JSON.stringify(filterFromBody(req.body || {})), x.sender]);
    await afterSave(req, res, c.id, 'Uloženo.');
  }));
  app.get('/admin/rozesilky/file/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
    const f = (await q('SELECT filename, content_type, data FROM mail_campaign_files WHERE id=$1', [req.params.id])).rows[0]; if (!f) return res.status(404).end();
    res.set('Content-Type', f.content_type || 'application/octet-stream').set('Content-Disposition', 'inline; filename="' + encodeURIComponent(f.filename) + '"').set('X-Content-Type-Options', 'nosniff').send(f.data);
  }));
  // ── AI: návrh předmětu a textu podle příloh ──
  function docxText(buf) { // Word: text z word/document.xml (zip přes CFB z balíčku xlsx)
    try { const CFB = require('xlsx').CFB; const z = CFB.read(buf, { type: 'buffer' }); const e = CFB.find(z, 'word/document.xml') || CFB.find(z, '/word/document.xml'); if (!e) return ''; return Buffer.from(e.content).toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim(); } catch (e) { return ''; }
  }
  function sheetText(buf) { try { const X = require('xlsx'); const wb = X.read(buf, { type: 'buffer' }); return wb.SheetNames.slice(0, 5).map((n) => '## ' + n + '\n' + X.utils.sheet_to_csv(wb.Sheets[n]).slice(0, 20000)).join('\n\n'); } catch (e) { return ''; } }
  app.post('/admin/rozesilky/ai', requireAdmin, multi, wrap(async (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY; if (!key) return res.status(503).json({ error: 'Na serveru BS2 chybí ANTHROPIC_API_KEY.' });
    const files = (req.files || []).filter((f) => f.size).map((f) => ({ filename: f.originalname, type: f.mimetype, data: f.buffer }));
    const cid = parseInt((req.body || {}).campaign_id, 10);
    if (cid) (await q('SELECT filename, content_type, data FROM mail_campaign_files WHERE campaign_id=$1 ORDER BY id', [cid])).rows.forEach((f) => files.push({ filename: f.filename, type: f.content_type, data: Buffer.from(f.data) }));
    const hint = String((req.body || {}).hint || '').slice(0, 1500);
    if (!files.length && !hint.trim()) return res.status(400).json({ error: 'Vyber přílohu nebo napiš pokyn, o čem má e-mail být.' });
    const content = []; let total = 0;
    for (const f of files.slice(0, 5)) {
      const ext = String(f.filename || '').toLowerCase().split('.').pop(); const t = String(f.type || '');
      total += f.data.length; if (total > 20 * 1024 * 1024) break;
      if (t === 'application/pdf' || ext === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data.toString('base64') }, title: f.filename });
      else if (/^image\/(png|jpeg|gif|webp)$/.test(t)) content.push({ type: 'image', source: { type: 'base64', media_type: t, data: f.data.toString('base64') } });
      else { const txt = ext === 'docx' ? docxText(f.data) : ['xlsx', 'xls', 'csv'].includes(ext) ? sheetText(f.data) : ['txt', 'md'].includes(ext) ? f.data.toString('utf8') : ''; if (txt) content.push({ type: 'text', text: 'Obsah přílohy „' + f.filename + '“:\n' + txt.slice(0, 60000) }); else content.push({ type: 'text', text: '(Příloha „' + f.filename + '“ — obsah tohoto formátu neumím přečíst, ber v úvahu jen název.)' }); }
    }
    content.push({ type: 'text', text: 'Napiš hromadný e-mail pro uživatele Best Series 2.0 (podporovatelé a zákazníci české firmy Best Series, která vyrábí a provozuje samoobslužné prádlomaty). Vycházej z příloh výše' + (hint ? ' a z tohoto pokynu: ' + hint : '') + '.\nPravidla: česky, vykání, věcně a srozumitelně, bez přehnaných marketingových frází, nevymýšlej fakta, která v podkladech nejsou. Text začni oslovením „Dobrý den {jmeno},“ (zástupný znak nech přesně takto). Odstavce odděluj prázdným řádkem, žádné HTML ani markdown. Nepiš patičku s odhlášením (přidá se sama). Pokud je příloha součástí e-mailu, zmiň ji („v příloze najdete…“).\nVrať POUZE JSON: {"subject":"…","body":"…"}' });
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: process.env.BS2_MAIL_AI_MODEL || 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content }] }), signal: AbortSignal.timeout(110000) });
      const j = await r.json();
      if (!r.ok) {
        // Syrové „invalid x-api-key" nikomu nic neřekne — přeložíme to do češtiny.
        const zprava = (j.error && j.error.message) || ('AI ' + r.status);
        if (r.status === 401 || r.status === 403 || /invalid x-api-key|authentication_error/i.test(zprava)) {
          return res.status(502).json({ error: 'Klíč k AI není platný — nastav platný ANTHROPIC_API_KEY (Railway → projekt BS2 → Variables). Týká se to všech funkcí s AI, nejen rozesílek.' });
        }
        if (/credit balance|insufficient/i.test(zprava)) {
          return res.status(502).json({ error: 'Došel kredit na AI. Dobij ho v Anthropic Console (Plans & Billing).' });
        }
        return res.status(502).json({ error: zprava });
      }
      const text = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join(''); const a = text.indexOf('{'), b = text.lastIndexOf('}');
      // JSON od modelu: když obsahuje syrové konce řádků uvnitř řetězců, opravíme je
      const fixJson = (t) => { let o = '', str = false, esc2 = false; for (const ch of t) { if (str) { if (esc2) { esc2 = false; o += ch; continue; } if (ch === '\\') { esc2 = true; o += ch; continue; } if (ch === '"') str = false; o += ch === '\n' ? '\\n' : ch === '\r' ? '' : ch === '\t' ? '\\t' : ch; } else { if (ch === '"') str = true; o += ch; } } return o; };
      let o = null; if (a >= 0 && b > a) { const raw = text.slice(a, b + 1); try { o = JSON.parse(raw); } catch (e) { o = JSON.parse(fixJson(raw)); } }
      if (!o || !o.subject || !o.body) return res.status(502).json({ error: 'AI nevrátila předmět a text, zkus to znovu.' });
      await log(req.admin, 'mail_campaign_ai', { files: files.length });
      res.json({ subject: String(o.subject).slice(0, 200), body: String(o.body).slice(0, 20000) });
    } catch (e) { res.status(502).json({ error: 'AI: ' + e.message }); }
  }));
  // Odebrání jedné přílohy (✕ u seznamu příloh). Maže se rovnou, ať se nemusí
  // ukládat celý formulář — rozepsaný text tím zůstane nedotčený.
  app.post('/admin/rozesilky/:id(\\d+)/file/:fid(\\d+)/delete', requireAdmin, wrap(async (req, res) => {
    const cid = parseInt(req.params.id, 10), fid = parseInt(req.params.fid, 10);
    const c = await load(cid);
    if (!c) return res.status(404).json({ error: 'Rozesílka nenalezena.' });
    if (c.status !== 'draft') return res.status(400).json({ error: 'Rozeslanou kampaň už měnit nejde.' });
    const r = await q('DELETE FROM mail_campaign_files WHERE campaign_id=$1 AND id=$2 RETURNING filename', [cid, fid]);
    if (!r.rowCount) return res.status(404).json({ error: 'Příloha nenalezena.' });
    _files.delete(cid);
    await log(req.admin, 'mail_campaign_file_delete', { id: cid, file: r.rows[0].filename });
    res.json({ ok: true });
  }));

  // Seznam příjemců pro okno „Blacklist" — podle stejného filtru jako počítadlo,
  // ale BEZ vyřazení (ty vrátíme zvlášť, aby šly odškrtnout zpátky).
  app.post('/admin/rozesilky/recipients', requireAdmin, wrap(async (req, res) => {
    try {
      const b = req.body || {};
      const f = normFilter(Object.assign({}, b.filter, { exclude: [] }));
      const { sql, p } = whereFor(f);
      const hledat = String(b.q || '').trim().toLowerCase().slice(0, 100);
      const pp = p.slice(); let w = sql;
      if (hledat) { pp.push('%' + hledat + '%'); w += ' AND (lower(s.email) LIKE $' + pp.length + ' OR lower(coalesce(s.first_name,\'\') || \' \' || coalesce(s.last_name,\'\') || \' \' || coalesce(s.nick,\'\')) LIKE $' + pp.length + ')'; }
      const LIMIT = 500;
      const celkem = (await q('SELECT count(*)::int AS c FROM supporters s WHERE ' + w, pp)).rows[0].c;
      const rows = (await q('SELECT s.id, s.email, s.first_name, s.last_name, s.nick FROM supporters s WHERE ' + w
        + ' ORDER BY lower(coalesce(s.last_name, s.email)) LIMIT ' + LIMIT, pp)).rows;
      // Už vyřazené ukážeme vždy, i kdyby je hledání nenašlo — jinak by nešly vrátit zpět.
      const vyrazeno = normFilter(b.filter).exclude;
      const vyrazeniRadky = vyrazeno.length
        ? (await q('SELECT id, email, first_name, last_name, nick FROM supporters WHERE id = ANY($1::int[]) ORDER BY lower(coalesce(last_name, email))', [vyrazeno])).rows
        : [];
      res.json({ total: celkem, limit: LIMIT, rows, excluded: vyrazeniRadky });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));
  app.post('/admin/rozesilky/count', requireAdmin, wrap(async (req, res) => { try { res.json(await countFor((req.body || {}).filter)); } catch (e) { console.warn('[bs2 rozesílky] počet příjemců:', e.message); res.status(400).json({ error: e.message }); } }));
  app.get('/admin/rozesilky/:id(\\d+)/status', requireAdmin, wrap(async (req, res) => { const c = await load(req.params.id); res.set('Cache-Control', 'no-store').json(c ? { status: c.status, total: c.total, sent: c.sent, failed: c.failed, last_error: c.last_error } : {}); }));
  app.post('/admin/rozesilky/:id(\\d+)/test', requireAdmin, wrap(async (req, res) => {
    const c = await load(req.params.id); const to = String((req.body || {}).to || '').trim().toLowerCase();
    if (!c || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.redirect('/admin/rozesilky/' + req.params.id + '?err=1&msg=' + encodeURIComponent('Zadej platný e-mail.'));
    const u = (await q('SELECT id, email, first_name, last_name, nick FROM supporters WHERE lower(email)=$1', [to])).rows[0] || { id: null, email: to, first_name: (req.admin.name || '').split(' ')[0], last_name: (req.admin.name || '').split(' ').slice(1).join(' '), nick: '' };
    try { const r = await sendOne(Object.assign({}, c, { subject: '[TEST] ' + c.subject }), Object.assign({}, u, { email: to })); await log(req.admin, 'mail_campaign_test', { id: c.id, to });
      res.redirect('/admin/rozesilky/' + c.id + '?msg=' + encodeURIComponent('Test odeslán na ' + to + (r.via ? ' (' + r.via + ')' : '') + '.'));
    } catch (e) { res.redirect('/admin/rozesilky/' + c.id + '?err=1&msg=' + encodeURIComponent('Test se nepodařilo odeslat: ' + e.message)); }
  }));
  app.post('/admin/rozesilky/:id(\\d+)/start', requireAdmin, wrap(async (req, res) => {
    const c = await load(req.params.id); if (!c || c.status !== 'draft') return res.redirect('/admin/rozesilky/' + req.params.id);
    const { count } = await countFor(c.filter);
    const typed = parseInt(String((req.body || {}).confirm || '').replace(/\s/g, ''), 10);
    if (!count) return res.redirect('/admin/rozesilky/' + c.id + '?err=1&msg=' + encodeURIComponent('Výběr nemá žádné příjemce.'));
    if (typed !== count) return res.redirect('/admin/rozesilky/' + c.id + '?err=1&msg=' + encodeURIComponent('Počet nesouhlasí — výběr má teď ' + count + ' příjemců. Opiš přesně toto číslo.'));
    const f = normFilter(c.filter); const { sql, p } = whereFor(f);
    const ins = await q(`INSERT INTO mail_campaign_recipients (campaign_id, supporter_id, email) SELECT $${p.length + 1}, s.id, lower(s.email) FROM supporters s WHERE ${sql} ON CONFLICT (campaign_id, email) DO NOTHING`, p.concat([c.id]));
    await q("UPDATE mail_campaigns SET status='sending', total=$2, started_at=now(), updated_at=now(), last_error=NULL WHERE id=$1", [c.id, ins.rowCount]);
    await log(req.admin, 'mail_campaign_start', { id: c.id, name: c.name, total: ins.rowCount });
    res.redirect('/admin/rozesilky/' + c.id + '?msg=' + encodeURIComponent('Rozesílka spuštěna: ' + ins.rowCount + ' příjemců.'));
  }));
  const setStatus = (from, to, action) => wrap(async (req, res) => {
    const r = await q('UPDATE mail_campaigns SET status=$3, updated_at=now()' + (to === 'canceled' ? ', finished_at=now()' : '') + (to === 'sending' ? ', last_error=NULL' : '') + ' WHERE id=$1 AND status = ANY($2::text[])', [req.params.id, from, to]);
    if (to === 'canceled') await q("UPDATE mail_campaign_recipients SET status='skipped', error='rozesílka zrušena' WHERE campaign_id=$1 AND status='queued'", [req.params.id]);
    if (r.rowCount) await log(req.admin, action, { id: Number(req.params.id) });
    res.redirect('/admin/rozesilky/' + req.params.id);
  });
  app.post('/admin/rozesilky/:id(\\d+)/pause', requireAdmin, setStatus(['sending'], 'paused', 'mail_campaign_pause'));
  app.post('/admin/rozesilky/:id(\\d+)/resume', requireAdmin, setStatus(['paused'], 'sending', 'mail_campaign_resume'));
  app.post('/admin/rozesilky/:id(\\d+)/cancel', requireAdmin, setStatus(['sending', 'paused'], 'canceled', 'mail_campaign_cancel'));

  // Ruční vyřazení / vrácení u uživatele (detail uživatele)
  app.post('/admin/supporters/:id(\\d+)/mail-optout', requireAdmin, wrap(async (req, res) => {
    const out = String((req.body || {}).optout) === '1';
    await q('UPDATE supporters SET mail_optout=$2, mail_optout_at=CASE WHEN $2 THEN now() ELSE NULL END, mail_optout_by=CASE WHEN $2 THEN $3 ELSE NULL END WHERE id=$1', [req.params.id, out, req.admin.name || 'správce']);
    await log(req.admin, out ? 'mail_optout' : 'mail_optin', { id: Number(req.params.id) });
    res.redirect('/admin/supporters/' + req.params.id + '?msg=' + encodeURIComponent(out ? 'Uživatel vyřazen z hromadných e-mailů.' : 'Uživatel zase dostává hromadné e-maily.'));
  }));

  return { unsubUrl };
};
