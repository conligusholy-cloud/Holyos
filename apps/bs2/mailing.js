// Best Series 2.0 — Rozesílky (hromadné e-maily) v administraci /admin/rozesilky.
// Segment příjemců (stav účtu, typ uživatele, přihlášení, objednávky/produkt, balíček lokality, ruční seznam),
// koncept → testovací e-mail → potvrzení počtu → fronta na pozadí (Amazon SES přes HolyOS /api/auth/bs2/bulk-mail).
// Každý e-mail má odkaz na odhlášení (/odhlasit-rozesilku/<token>); vyřazení (supporters.mail_optout) jde
// nastavit i ručně v detailu uživatele. Vyřazení a blokovaní se nikdy neposílají.
'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

module.exports = function mountMailing(app, ctx) {
  const { q, requireAdmin, wrap, V, PUBLIC_URL, HOLYOS_URL, SSO_SECRET, log, esc } = ctx;
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
      types: arr(f.types).filter((x) => TYPES[x]),
      login: ['any', 'never', 'within', 'not_within'].includes(f.login) ? f.login : 'any',
      login_days: Math.max(1, Math.min(3650, parseInt(f.login_days, 10) || 30)),
      orders: ['any', 'has', 'none'].includes(f.orders) ? f.orders : 'any',
      product: String(f.product || '').slice(0, 200),
      location: ['any', 'has', 'none'].includes(f.location) ? f.location : 'any',
      manual: String(f.manual || '').slice(0, 200000),
      manual_only: !!f.manual_only && f.manual_only !== '0',
    };
  }
  function whereFor(f) {
    const p = []; const w = ["s.status <> 'blocked'", 's.mail_optout = false', "s.email LIKE '%@%'"];
    const P = (v) => { p.push(v); return '$' + p.length; };
    const emails = [...new Set(String(f.manual || '').toLowerCase().split(/[\s,;]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    if (f.manual_only) { w.push('lower(s.email) = ANY(' + P(emails) + '::text[])'); return { sql: w.join(' AND '), p, emails }; }
    if (f.status.length) w.push('s.status = ANY(' + P(f.status) + '::text[])');
    if (f.types.length) w.push('s.user_type = ANY(' + P(f.types) + '::text[])');
    if (f.login === 'never') w.push('s.last_login_at IS NULL');
    if (f.login === 'within') w.push('s.last_login_at >= now() - make_interval(days => ' + P(f.login_days) + '::int)');
    if (f.login === 'not_within') w.push('(s.last_login_at IS NULL OR s.last_login_at < now() - make_interval(days => ' + P(f.login_days) + '::int))');
    const prod = f.product ? ' AND o.product_name ILIKE ' + P('%' + f.product + '%') : '';
    if (f.orders === 'has' || (f.orders === 'any' && f.product)) w.push("EXISTS (SELECT 1 FROM orders o WHERE o.supporter_id = s.id AND o.status <> 'cancelled'" + prod + ')');
    if (f.orders === 'none') w.push("NOT EXISTS (SELECT 1 FROM orders o WHERE o.supporter_id = s.id AND o.status <> 'cancelled'" + prod + ')');
    if (f.location === 'has') w.push('s.location_package IS NOT NULL');
    if (f.location === 'none') w.push('s.location_package IS NULL');
    if (emails.length) { const extra = w.splice(3); if (extra.length) w.push('((' + extra.join(' AND ') + ') OR lower(s.email) = ANY(' + P(emails) + '::text[]))'); } // ruční seznam = navíc k filtru
    return { sql: w.join(' AND '), p, emails };
  }
  async function countFor(filter) {
    const f = normFilter(filter); const { sql, p, emails } = whereFor(f);
    const c = (await q('SELECT count(*)::int AS c FROM supporters s WHERE ' + sql, p)).rows[0].c;
    const sample = (await q('SELECT s.email, s.first_name, s.last_name FROM supporters s WHERE ' + sql + ' ORDER BY s.id LIMIT 8', p)).rows;
    const optout = (await q('SELECT count(*)::int AS c FROM supporters WHERE mail_optout = true')).rows[0].c;
    let unknown = [];
    if (emails.length) { const found = new Set((await q('SELECT lower(email) AS e FROM supporters WHERE lower(email) = ANY($1::text[])', [emails])).rows.map((r) => r.e)); unknown = emails.filter((e) => !found.has(e)).slice(0, 50); }
    return { count: c, sample, optout, unknown };
  }

  // ── Odeslání jednoho e-mailu přes HolyOS (Amazon SES) ──
  const fill = (t, u) => String(t || '').replace(/\{jmeno\}/g, (u && (u.first_name || u.nick)) || '').replace(/\{prijmeni\}/g, (u && u.last_name) || '').replace(/\{nick\}/g, (u && u.nick) || '');
  async function sendOne(c, u) {
    const token = jwt.sign({ aud: 'holyos-api', iss: 'bs2' }, SSO_SECRET, { expiresIn: '2m' });
    const r = await fetch(HOLYOS_URL + '/api/auth/bs2/bulk-mail', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: u.email, subject: fill(c.subject, u), body: fill(c.body, u), link: c.link || undefined, linkLabel: c.link_label || undefined, unsubUrl: u.id ? unsubUrl(u.id) : undefined, campaignId: c.id }), signal: AbortSignal.timeout(30000) });
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
.ml-cnt{font-size:34px;font-weight:800;letter-spacing:-.02em}.ml-prev{white-space:pre-wrap;background:rgba(4,8,16,.6);border:1px solid var(--border);border-radius:12px;padding:12px;font-size:14px;max-height:340px;overflow:auto}</style>`;

  app.get('/admin/rozesilky', requireAdmin, wrap(async (req, res) => {
    const rows = (await q('SELECT id, name, subject, status, total, sent, failed, created_by, created_at, started_at, finished_at FROM mail_campaigns ORDER BY id DESC LIMIT 200')).rows;
    const opt = (await q('SELECT id, email, first_name, last_name, mail_optout_at, mail_optout_by FROM supporters WHERE mail_optout = true ORDER BY mail_optout_at DESC NULLS LAST LIMIT 100')).rows;
    const optN = (await q('SELECT count(*)::int AS c FROM supporters WHERE mail_optout = true')).rows[0].c;
    const msg = req.query.msg ? `<div class="msg ok">${esc(req.query.msg)}</div>` : '';
    res.send(V.adminLayout('Rozesílky', 'mail', req.admin, CSS + `
  <div class="row" style="justify-content:space-between"><h1 style="margin:0">Rozesílky <span class="muted" style="font-size:14px;font-weight:500">hromadné e-maily</span></h1><a class="btn" href="/admin/rozesilky/new">+ Nová rozesílka</a></div>
  <p class="muted small">Odesílá se přes Amazon SES z adresy <b>${esc(process.env.BS2_BULK_FROM_HINT || 'info@bestseries.cz')}</b>, postupně na pozadí (${RATE} e-mailů/s). Vyřazení uživatelé a blokované účty se nikdy neposílají.</p>${msg}
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

  function editor(c, prods, admin) {
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
  <form method="post" action="/admin/rozesilky/${c ? c.id : 'new'}" id="ml-form"><div class="ml-grid">
  <div class="card"><h2 style="margin-top:0">E-mail</h2>
    <label>Název rozesílky (jen pro vás)</label><input name="name" required maxlength="120" value="${esc(c ? c.name : '')}"${dis}>
    <label>Předmět</label><input name="subject" required maxlength="200" value="${esc(c ? c.subject : '')}"${dis}>
    <label>Text e-mailu</label><textarea name="body" rows="12" required maxlength="20000"${dis}>${esc(c ? c.body : 'Dobrý den {jmeno},\n\n')}</textarea>
    <div class="small muted">Zástupné znaky: <code>{jmeno}</code> <code>{prijmeni}</code> <code>{nick}</code>. Prázdný řádek = nový odstavec. Odkaz na odhlášení se přidá na konec automaticky.</div>
    <label>Tlačítko — odkaz (nepovinné)</label><input name="link" type="url" placeholder="https://www.bestseries2.cz/…" value="${esc(c ? c.link || '' : '')}"${dis}>
    <label>Tlačítko — text</label><input name="link_label" maxlength="80" placeholder="např. Otevřít Best Series" value="${esc(c ? c.link_label || '' : '')}"${dis}>
    <div class="small muted">Odkaz smí vést na bestseries2.cz, bestseries.cz, laundromats.eu, pradlomaty.info nebo compounder.world.</div>
  </div>
  <div class="card"><h2 style="margin-top:0">Komu</h2>
    <label>Stav účtu</label><div class="ml-chips">${chk('status', 'active', f.status.includes('active'), 'Aktivní')}${chk('status', 'invited', f.status.includes('invited'), 'Čeká na první přihlášení')}</div>
    <div class="small muted">Nic nezaškrtnuto = oba stavy. Blokovaní se neposílají nikdy.</div>
    <label>Typ uživatele</label><div class="ml-chips">${Object.entries(TYPES).map(([k, l]) => chk('types', k, f.types.includes(k), l)).join('')}</div>
    <div class="small muted">Nic nezaškrtnuto = všechny typy.</div>
    <label>Přihlášení</label><div class="row">${sel('login', f.login, [['any', 'kdykoli / nikdy'], ['never', 'nikdy se nepřihlásil'], ['within', 'přihlášen za posledních'], ['not_within', 'nepřihlášen posledních']])}<input name="login_days" type="number" min="1" max="3650" style="width:90px" value="${f.login_days}"${dis}> <span class="muted small">dní</span></div>
    <label>Objednávky</label><div class="row">${sel('orders', f.orders, [['any', 'nerozhoduje'], ['has', 'má objednávku'], ['none', 'nemá objednávku']])}
      <input name="product" list="ml-prods" placeholder="produkt (nepovinné)" style="flex:1;min-width:160px" value="${esc(f.product)}"${dis}><datalist id="ml-prods">${prods.map((p) => `<option value="${esc(p.product_name)}">${p.c}×</option>`).join('')}</datalist></div>
    <label>Balíček Prověření lokality</label>${sel('location', f.location, [['any', 'nerozhoduje'], ['has', 'má balíček'], ['none', 'nemá balíček']])}
    <label>Ruční seznam e-mailů</label><textarea name="manual" rows="4" placeholder="jeden e-mail na řádek (nebo oddělené čárkou)"${dis}>${esc(f.manual)}</textarea>
    <div class="ml-chips" style="margin-top:6px"><label><input type="checkbox" name="manual_only" value="1"${f.manual_only ? ' checked' : ''}${dis}> Poslat JEN na ruční seznam (ignorovat filtry)</label></div>
    <div class="small muted">Bez zaškrtnutí se ruční seznam přidá k filtrům. E-mail musí patřit uživateli BS2.</div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)"><div class="row" style="justify-content:space-between"><span class="muted">Příjemců podle výběru</span><button type="button" class="btn sec sm" id="ml-count">↻ Spočítat</button></div>
      <div class="ml-cnt" id="ml-n">${c && c.total && ro ? c.total : '–'}</div><div class="small muted" id="ml-info"></div></div>
  </div></div>
  ${ro ? '' : `<div class="row" style="margin-top:4px"><button class="btn" type="submit">💾 Uložit koncept</button></div>`}
  </form>
  ${c && c.status === 'draft' ? `<div class="ml-grid" style="margin-top:14px">
    <div class="card"><h2 style="margin-top:0">1. Testovací e-mail</h2><p class="small muted">Pošle e-mail přesně tak, jak dorazí příjemcům (bez zápisu do fronty). Nejdřív koncept ulož.</p>
      <form method="post" action="/admin/rozesilky/${c.id}/test" class="row"><input name="to" type="email" required placeholder="vas@email.cz" style="flex:1" value="${esc(admin.email || '')}"><button class="btn sec">✉ Poslat test</button></form></div>
    <div class="card"><h2 style="margin-top:0">2. Spustit rozesílku</h2><p class="small muted">Seznam příjemců se zafixuje v okamžiku spuštění. Pro potvrzení opiš přesný počet příjemců.</p>
      <form method="post" action="/admin/rozesilky/${c.id}/start" class="row" id="ml-start"><input name="confirm" inputmode="numeric" required placeholder="počet příjemců" style="width:170px"><button class="btn">🚀 Spustit</button></form></div>
  </div>` : ''}
  <script>(function(){var f=document.getElementById('ml-form'),b=document.getElementById('ml-count'),n=document.getElementById('ml-n'),inf=document.getElementById('ml-info');
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function data(){var o={status:[],types:[]};f.querySelectorAll('input,select,textarea').forEach(function(e){if(!e.name)return;if(e.type==='checkbox'){if(e.checked){if(e.name==='status'||e.name==='types')o[e.name].push(e.value);else o[e.name]=e.value;}}else o[e.name]=e.value;});return o;}
  var seq=0;function count(){if(!b)return;var my=++seq;b.disabled=true;n.style.opacity='.45';fetch('/admin/rozesilky/count',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({filter:data()})}).then(function(r){return r.json();}).then(function(j){if(my!==seq)return;b.disabled=false;n.style.opacity='';if(j.error){inf.textContent=j.error;return;}n.textContent=j.count.toLocaleString('cs-CZ');inf.innerHTML=(j.sample.length?'např. '+j.sample.map(function(s){return esc(s.email);}).join(', ')+'<br>':'')+'Vyřazených z rozesílek celkem: '+j.optout+(j.unknown.length?'<br><span style="color:#ffd866">Nenalezeno v BS2: '+j.unknown.map(esc).join(', ')+'</span>':'');}).catch(function(){b.disabled=false;n.textContent='?';});}
  // Přepočet při každé změně filtru (zaškrtávátka/výběry hned, psaní s krátkou prodlevou)
  var tmr=null;function later(ms){clearTimeout(tmr);tmr=setTimeout(count,ms);}
  var komu=b&&b.closest('.card');if(komu&&!${ro ? 'true' : 'false'}){komu.addEventListener('change',function(e){if(e.target.matches('input,select,textarea'))later(150);});komu.addEventListener('input',function(e){if(e.target.matches('input[type=number],input:not([type]),input[type=text],textarea'))later(600);});}
  if(b){b.onclick=count;${ro ? '' : 'count();'}}
  ${c && ['sending', 'paused'].includes(c.status) ? `setInterval(function(){fetch('/admin/rozesilky/${c.id}/status',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){var p=j.total?Math.round((j.sent+j.failed)/j.total*100):0;document.getElementById('ml-pbar').style.width=p+'%';document.getElementById('ml-ptxt').textContent=j.sent+' odesláno · '+j.failed+' chyb / '+j.total;if(j.status!=='${c.status}')location.reload();});},3000);` : ''}
  })();<\/script>`;
  }

  app.get('/admin/rozesilky/new', requireAdmin, wrap(async (req, res) => res.send(V.adminLayout('Nová rozesílka', 'mail', req.admin, editor(null, await products(), req.admin), HOLYOS_URL))));
  app.get('/admin/rozesilky/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
    const c = await load(req.params.id); if (!c) return res.redirect('/admin/rozesilky');
    const m = req.query.msg ? `<div class="msg ${req.query.err ? 'err' : 'ok'}">${esc(req.query.msg)}</div>` : '';
    res.send(V.adminLayout('Rozesílka', 'mail', req.admin, m + editor(c, await products(), req.admin), HOLYOS_URL));
  }));
  const filterFromBody = (b) => normFilter({ status: b.status, types: b.types, login: b.login, login_days: b.login_days, orders: b.orders, product: b.product, location: b.location, manual: b.manual, manual_only: b.manual_only });
  const fields = (b) => ({ name: String(b.name || '').trim().slice(0, 120) || 'Rozesílka', subject: String(b.subject || '').trim().slice(0, 200), body: String(b.body || '').slice(0, 20000), link: /^https:\/\//.test(String(b.link || '').trim()) ? String(b.link).trim().slice(0, 500) : null, link_label: String(b.link_label || '').trim().slice(0, 80) || null });
  app.post('/admin/rozesilky/new', requireAdmin, wrap(async (req, res) => {
    const x = fields(req.body || {}); if (!x.subject || !x.body.trim()) return res.redirect('/admin/rozesilky/new');
    const r = await q('INSERT INTO mail_campaigns (name, subject, body, link, link_label, filter, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [x.name, x.subject, x.body, x.link, x.link_label, JSON.stringify(filterFromBody(req.body || {})), req.admin.name || null]);
    await log(req.admin, 'mail_campaign_new', { id: r.rows[0].id, name: x.name });
    res.redirect('/admin/rozesilky/' + r.rows[0].id + '?msg=' + encodeURIComponent('Koncept uložen. Pošli si test a pak rozesílku spusť.'));
  }));
  app.post('/admin/rozesilky/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
    const c = await load(req.params.id); if (!c || c.status !== 'draft') return res.redirect('/admin/rozesilky/' + req.params.id);
    const x = fields(req.body || {});
    await q('UPDATE mail_campaigns SET name=$2, subject=$3, body=$4, link=$5, link_label=$6, filter=$7, updated_at=now() WHERE id=$1', [c.id, x.name, x.subject || c.subject, x.body || c.body, x.link, x.link_label, JSON.stringify(filterFromBody(req.body || {}))]);
    res.redirect('/admin/rozesilky/' + c.id + '?msg=' + encodeURIComponent('Uloženo.'));
  }));
  app.post('/admin/rozesilky/count', requireAdmin, wrap(async (req, res) => { try { res.json(await countFor((req.body || {}).filter)); } catch (e) { res.status(400).json({ error: e.message }); } }));
  app.get('/admin/rozesilky/:id(\\d+)/status', requireAdmin, wrap(async (req, res) => { const c = await load(req.params.id); res.set('Cache-Control', 'no-store').json(c ? { status: c.status, total: c.total, sent: c.sent, failed: c.failed, last_error: c.last_error } : {}); }));
  app.post('/admin/rozesilky/:id(\\d+)/test', requireAdmin, wrap(async (req, res) => {
    const c = await load(req.params.id); const to = String((req.body || {}).to || '').trim().toLowerCase();
    if (!c || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.redirect('/admin/rozesilky/' + req.params.id + '?err=1&msg=' + encodeURIComponent('Zadej platný e-mail.'));
    const u = (await q('SELECT id, email, first_name, last_name, nick FROM supporters WHERE lower(email)=$1', [to])).rows[0] || { id: null, email: to, first_name: (req.admin.name || '').split(' ')[0], last_name: '', nick: '' };
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
