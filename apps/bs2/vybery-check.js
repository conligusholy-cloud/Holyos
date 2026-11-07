// Best Series 2.0 — kontrola údajů před prvním výběrem (migrace ze starého portálu).
// Než uživatel uvidí žádost o výběr, sám opíše ze starého portálu: Podpora palety celkem, Expanze celkem,
// Podpora balíčky celkem, Opakovačky celkem (každé v Kč i v EUR) a svou pozici (Partner / VIP / VIP 2). Uloží se do samostatných
// sloupců (supporters.mig_*), hned se automaticky porovnají s načtenými daty (partner_support.std_by_year
// + position). Shoda → výběry odemčené. Neshoda → „čeká na ruční kontrolu" (admin ověří v Admin → Výběry).
'use strict';

const FIELDS = [['palety', 'Podpora palety celkem'], ['expanze', 'Expanze celkem'], ['balicky', 'Podpora balíčky celkem'], ['opakovacky', 'Opakovačky celkem']];
const POSITIONS = ['Partner', 'VIP', 'VIP 2'];
const TOL = 1; // tolerance zaokrouhlení (Kč / €)
const CHECK_V = 3; // verze pravidel kontroly — při změně se všechna vyplnění automaticky přepočítají (recheckStale)

const num = (v) => { if (v == null || String(v).trim() === '') return 0; const n = Number(String(v).replace(/\s/g, '').replace(/ /g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const normPos = (p) => String(p || '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/^VIP ?1$/, 'VIP').replace(/^VIP2$/, 'VIP 2');

// Naše hodnoty po měnách ze std_by_year (každá sekce v každém roce má svou měnu r.cur[k])
function ours(p) {
  const by = p && p.std_by_year && typeof p.std_by_year === 'object' ? p.std_by_year : null;
  const n = (v) => (v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null);
  // Expanze = sloupec EX PODPORA v Admin → Výběry (std_expanze_all, příp. ruční přepis ov_ex; jinak vloženo v expanzi)
  // v měně účtu — porovnává se jen ve stejné měně (eurový účet → Expanze €, korunový → Expanze Kč).
  const exVal = n(p && p.std_expanze_all) != null ? n(p.std_expanze_all) : n(p && p.exp_invested);
  const exCur = (n(p && p.std_expanze_all) != null ? p.std_currency : (p && (p.exp_currency || p.std_currency))) === 'EUR' ? 'eur' : 'czk';
  const exFromEx = exVal != null && !(p && p.std_mixed === true && p.ov_ex == null); // smíšené měny (vše přepočteno na Kč) → rozpad po letech
  if ((!by || !Object.keys(by).length) && !exFromEx) return null;
  const out = {}; for (const [k] of FIELDS) out[k] = { czk: 0, eur: 0 };
  for (const r of Object.values(by || {})) for (const [k] of FIELDS) {
    const v = Number(r && r[k]) || 0; if (!v) continue;
    const cur = (r.cur && r.cur[k]) === 'EUR' ? 'eur' : 'czk';
    out[k][cur] = Math.round((out[k][cur] + v) * 100) / 100;
  }
  if (exFromEx) { out.expanze = { czk: 0, eur: 0 }; out.expanze[exCur] = Math.round(exVal * 100) / 100; }
  return out;
}

const ST_KEYS = ['palety', 'opakovacky', 'balicky'];
// ST podpora po měnách: std_total (příp. ruční přepis ov_st) v měně účtu = sloupec ST PODPORA v Admin → Výběry.
// Smíšené měny (vše přepočtené na Kč) → součet palet, opakovaček a balíčků z rozpadu po letech, Kč a € zvlášť.
function stOurs(p, o) {
  const n = (v) => (v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null);
  const tot = n(p && p.std_total);
  if (tot != null && !(p.std_mixed === true && p.ov_st == null)) { const r = { czk: 0, eur: 0 }; r[p.std_currency === 'EUR' ? 'eur' : 'czk'] = Math.round(tot * 100) / 100; return r; }
  const r = { czk: 0, eur: 0 }; if (o) for (const k of ST_KEYS) { r.czk += o[k].czk || 0; r.eur += o[k].eur || 0; }
  return { czk: Math.round(r.czk * 100) / 100, eur: Math.round(r.eur * 100) / 100 };
}

function compare(row) {
  const p = row.partner_support || {};
  const o = ours(p);
  const diffs = [];
  if (!o) return { status: 'no_data', diffs: [{ field: 'data', text: 'K účtu nemáme načtenou podporu ze starého portálu.' }] };
  // ST podpora = palety + opakovačky + balíčky → porovnává se SOUČET se sloupcem ST PODPORA, zvlášť v Kč a v EUR
  const st = stOurs(p, o);
  for (const c of ['czk', 'eur']) {
    const d = Math.round(ST_KEYS.reduce((a2, k) => a2 + (Number(row['mig_' + k + '_' + c]) || 0), 0) * 100) / 100, s2 = st[c] || 0;
    if (Math.abs(d - s2) > TOL) diffs.push({ field: 'st', cur: c, label: 'ST podpora — palety + opakovačky + balíčky' + (c === 'eur' ? ' (EUR)' : ' (Kč)'), declared: d, ours: s2 });
  }
  // Expanze = sloupec EX PODPORA ve stejné měně
  for (const c of ['czk', 'eur']) {
    const d = Number(row['mig_expanze_' + c]) || 0, s2 = o.expanze[c] || 0;
    if (Math.abs(d - s2) > TOL) diffs.push({ field: 'expanze', cur: c, label: 'Expanze celkem' + (c === 'eur' ? ' (EUR)' : ' (Kč)'), declared: d, ours: s2 });
  }
  const sp = normPos(p.position), dp = normPos(row.mig_position);
  if (!sp || sp !== dp) diffs.push({ field: 'position', label: 'Pozice', declared: row.mig_position || '—', ours: p.position || '— (nezjištěno)' });
  return { status: diffs.length ? 'mismatch' : 'ok', diffs, ours: o };
}

module.exports = function mountVyberyCheck(app, ctx) {
  const { q, wrap, requireUser, requireAdmin, V, log, notifyVelin } = ctx;
  const esc = V.esc;

  async function load(id) { return (await q('SELECT id, email, nick, first_name, last_name, currency, partner_support, mig_palety_czk, mig_palety_eur, mig_expanze_czk, mig_expanze_eur, mig_balicky_czk, mig_balicky_eur, mig_opakovacky_czk, mig_opakovacky_eur, mig_position, mig_at, mig_status, mig_diff, mig_reviewed_by, mig_reviewed_at FROM supporters WHERE id=$1', [id])).rows[0] || null; }
  // Smí uživatel žádat o výběr? (vyplnil a sedí, nebo ručně ověřeno)
  async function allowed(id) { const r = (await q('SELECT mig_status FROM supporters WHERE id=$1', [id])).rows[0]; return !!r && (r.mig_status === 'ok' || r.mig_status === 'reviewed'); }

  // Brána na /vybery: vrací true, když stránku vyřídila sama (formulář / čeká na kontrolu)
  async function gate(req, res) {
    const u = await load(req.user.id); if (!u) return false;
    if (u.mig_status === 'ok' || u.mig_status === 'reviewed') return false;
    res.send(V.supporterVyberyGate(req.user, { u, positions: POSITIONS, fields: FIELDS, err: String(req.query.err || '').slice(0, 200) }));
    return true;
  }

  app.post('/vybery/kontrola', wrap(requireUser), wrap(async (req, res) => {
    if (V.vyberyVisible && !V.vyberyVisible(req.user)) return res.status(404).send(V.errorPage('Stránka nenalezena', 'Tato stránka neexistuje.', '/'));
    const cur = (await load(req.user.id)) || {};
    if (cur.mig_status === 'ok' || cur.mig_status === 'reviewed' || cur.mig_status === 'mismatch') return res.redirect('/vybery'); // jednou vyplněno = čeká se na nás
    const b = req.body || {}; const vals = {};
    for (const [k] of FIELDS) for (const c of ['czk', 'eur']) { const v = num(b[k + '_' + c]); if (!isFinite(v) || v < 0 || v > 1e9) return res.redirect('/vybery?err=' + encodeURIComponent('Zkontrolujte prosím částky — zadávejte jen čísla (prázdné = 0).')); vals[k + '_' + c] = v; }
    const pos = POSITIONS.includes(String(b.position)) ? String(b.position) : null;
    if (!pos) return res.redirect('/vybery?err=' + encodeURIComponent('Vyberte prosím svou pozici.'));
    if (String(b.confirm) !== '1') return res.redirect('/vybery?err=' + encodeURIComponent('Potvrďte prosím, že údaje odpovídají starému portálu.'));
    await q(`UPDATE supporters SET mig_palety_czk=$2, mig_palety_eur=$3, mig_expanze_czk=$4, mig_expanze_eur=$5, mig_balicky_czk=$6, mig_balicky_eur=$7, mig_opakovacky_czk=$9, mig_opakovacky_eur=$10, mig_position=$8, mig_at=now() WHERE id=$1`,
      [req.user.id, vals.palety_czk, vals.palety_eur, vals.expanze_czk, vals.expanze_eur, vals.balicky_czk, vals.balicky_eur, pos, vals.opakovacky_czk, vals.opakovacky_eur]);
    const row = await load(req.user.id); const r = compare(row);
    const status = r.status === 'ok' ? 'ok' : 'mismatch';
    await q('UPDATE supporters SET mig_status=$2, mig_diff=$3 WHERE id=$1', [req.user.id, status, JSON.stringify({ v: CHECK_V, diffs: r.diffs, ours: r.ours || null, checked_at: new Date().toISOString(), kind: r.status })]);
    await log({ name: req.user.nick || String(req.user.id) }, 'vybery_mig_check', { id: req.user.id, status, diffs: r.diffs.length });
    if (status !== 'ok' && notifyVelin) { try { notifyVelin('🔎 Výběry: požadavek na ruční kontrolu', ([row.last_name, row.first_name].filter(Boolean).join(' ') || row.nick || row.email) + ' (' + row.email + ') — nesedí: ' + (r.diffs.map((d) => d.label).filter(Boolean).join(', ') || 'údaje'), '/admin/vybery/kontrola/' + row.id, 'vybery'); } catch (e) { /* upozornění není kritické */ } }
    res.redirect('/vybery' + (status === 'ok' ? '?msg=' + encodeURIComponent('Děkujeme, údaje sedí. Výběry máte odemčené.') : ''));
  }));

  // Admin: detail porovnání + „ověřeno ručně" / „vrátit k novému vyplnění"
  app.get('/admin/vybery/kontrola/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
    const u = await load(req.params.id); if (!u) return res.status(404).send('Nenalezeno');
    const r = u.mig_at ? compare(u) : null; const o = r && r.ours;
    const m = (v, c) => (v == null ? '—' : Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: 2 }) + (c === 'eur' ? ' €' : ' Kč'));
    const stO = r && r.ours ? stOurs(u.partner_support || {}, r.ours) : null;
    const mark = (ok) => (!u.mig_at ? '' : ok ? '<span class="badge active">✓</span>' : '<span class="badge blocked">≠</span>');
    const rowsHtml = ['czk', 'eur'].map((c) => {
      const items = ST_KEYS.map((k) => `<tr><td style="padding-left:22px" class="muted">${esc((FIELDS.find((f) => f[0] === k) || [k, k])[1])} <span class="small">${c === 'eur' ? 'EUR' : 'Kč'}</span></td><td>${m(u['mig_' + k + '_' + c], c)}</td><td class="muted small">${o ? m(o[k][c], c) : '—'}</td><td></td></tr>`).join('');
      const dSum = Math.round(ST_KEYS.reduce((a2, k) => a2 + (Number(u['mig_' + k + '_' + c]) || 0), 0) * 100) / 100;
      const sSum = stO ? stO[c] : null;
      return `<tr><td><b>ST podpora</b> = palety + opakovačky + balíčky <span class="muted small">${c === 'eur' ? 'EUR' : 'Kč'}</span></td><td><b>${m(dSum, c)}</b></td><td><b>${sSum == null ? '—' : m(sSum, c)}</b></td><td>${mark(sSum != null && Math.abs(dSum - sSum) <= TOL)}</td></tr>` + items;
    }).join('') + ['czk', 'eur'].map((c) => { const d = u['mig_expanze_' + c], s2 = o ? o.expanze[c] : null;
      return `<tr><td><b>Expanze</b> = EX podpora <span class="muted small">${c === 'eur' ? 'EUR' : 'Kč'}</span></td><td><b>${m(d, c)}</b></td><td><b>${s2 == null ? '—' : m(s2, c)}</b></td><td>${mark(s2 != null && Math.abs((Number(d) || 0) - s2) <= TOL)}</td></tr>`; }).join('')
      + `<tr><td><b>Pozice</b></td><td><b>${esc(u.mig_position || '—')}</b></td><td>${esc((u.partner_support || {}).position || '—')}</td><td>${mark(normPos(u.mig_position) === normPos((u.partner_support || {}).position))}</td></tr>`;
    const st = { ok: '✓ sedí', mismatch: '⚠ nesedí — čeká na ruční kontrolu', reviewed: '✓ ověřeno ručně' }[u.mig_status] || 'nevyplněno';
    res.send(V.adminLayout('Kontrola údajů', 'vyb', req.admin, `
      <div class="row" style="justify-content:space-between"><h1 style="margin:0">Kontrola údajů — ${esc([u.last_name, u.first_name].filter(Boolean).join(' ') || u.nick || u.email)}</h1><a class="btn sec sm" href="/admin/vybery">← Výběry</a></div>
      <p class="muted">${esc(u.email)} · stav: <b>${st}</b>${u.mig_at ? ' · vyplněno ' + new Date(u.mig_at).toLocaleString('cs-CZ') : ''}${u.mig_reviewed_at ? ' · ověřil ' + esc(u.mig_reviewed_by || '') + ' ' + new Date(u.mig_reviewed_at).toLocaleString('cs-CZ') : ''}</p>
      <div class="card"><table><thead><tr><th>Údaj</th><th>Vyplnil uživatel</th><th>Náš systém (načteno ze starého portálu)</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>
      ${r && r.status === 'no_data' ? '<p class="msg err">K účtu nemáme načtenou podporu (std_by_year) — načti ji v Uživatelích a porovnej znovu.</p>' : ''}</div>
      ${u.mig_at ? `<div class="row" style="gap:8px"><form method="post" action="/admin/vybery/kontrola/${u.id}"><input type="hidden" name="action" value="recheck"><button class="btn sec">↻ Porovnat znovu</button></form>
        ${u.mig_status !== 'reviewed' && u.mig_status !== 'ok' ? `<form method="post" action="/admin/vybery/kontrola/${u.id}" onsubmit="return confirm('Označit jako ověřené ručně? Uživatel tím dostane přístup k výběrům.')"><input type="hidden" name="action" value="ok"><button class="btn">✓ Ověřeno ručně — odemknout výběry</button></form>` : ''}
        <form method="post" action="/admin/vybery/kontrola/${u.id}" onsubmit="return confirm('Vrátit uživateli formulář k novému vyplnění?')"><input type="hidden" name="action" value="reset"><button class="btn danger">Vrátit k novému vyplnění</button></form></div>` : ''}`, process.env.HOLYOS_URL));
  }));
  app.post('/admin/vybery/kontrola/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
    const id = Number(req.params.id); const a = String((req.body || {}).action || ''); const who = String((req.admin && (req.admin.name || req.admin.username)) || 'admin').slice(0, 80);
    if (a === 'ok') await q("UPDATE supporters SET mig_status='reviewed', mig_reviewed_by=$2, mig_reviewed_at=now() WHERE id=$1 AND mig_at IS NOT NULL", [id, who]);
    else if (a === 'reset') await q('UPDATE supporters SET mig_status=NULL, mig_at=NULL, mig_diff=NULL, mig_reviewed_by=NULL, mig_reviewed_at=NULL WHERE id=$1', [id]);
    else if (a === 'recheck') { const u = await load(id); if (u && u.mig_at) { const r = compare(u); const st = r.status === 'ok' ? 'ok' : (u.mig_status === 'reviewed' ? 'reviewed' : 'mismatch'); await q('UPDATE supporters SET mig_status=$2, mig_diff=$3 WHERE id=$1', [id, st, JSON.stringify({ v: CHECK_V, diffs: r.diffs, ours: r.ours || null, checked_at: new Date().toISOString(), kind: r.status })]); } }
    await log(req.admin, 'vybery_mig_' + (a || '?'), { id });
    res.redirect('/admin/vybery/kontrola/' + id);
  }));

  // Ruční kontrola ze seznamu Výběry (zaškrtávátko): zaškrtnuto = „ověřeno ručně" → připraven k výplatě
  // (i bez vyplněného formuláře). Odškrtnutí vrátí stav podle automatického porovnání, bez vyplnění na „nevyplněno".
  app.post('/admin/vybery/rucne/:id(\\d+)', requireAdmin, wrap(async (req, res) => {
    const id = Number(req.params.id); const on = String((req.body || {}).on || '') === '1';
    const who = String((req.admin && (req.admin.name || req.admin.username)) || 'admin').slice(0, 80);
    if (on) await q("UPDATE supporters SET mig_status='reviewed', mig_reviewed_by=$2, mig_reviewed_at=now() WHERE id=$1", [id, who]);
    else {
      const u = await load(id);
      if (u && u.mig_at) { const r = compare(u); await q('UPDATE supporters SET mig_status=$2, mig_diff=$3, mig_reviewed_by=NULL, mig_reviewed_at=NULL WHERE id=$1', [id, r.status === 'ok' ? 'ok' : 'mismatch', JSON.stringify({ v: CHECK_V, diffs: r.diffs, ours: r.ours || null, checked_at: new Date().toISOString(), kind: r.status })]); }
      else await q('UPDATE supporters SET mig_status=NULL, mig_reviewed_by=NULL, mig_reviewed_at=NULL WHERE id=$1', [id]);
    }
    await log(req.admin, on ? 'vybery_manual_ok' : 'vybery_manual_off', { id });
    if (req.get('X-Requested-With') === 'fetch') return res.json({ ok: true });
    const back = String(req.get('Referer') || '/admin/vybery'); res.redirect(/\/admin\/vybery/.test(back) ? back : '/admin/vybery');
  }));

  // Přepočet vyplnění podle aktuálních pravidel (po změně pravidel nebo novém načtení podpory).
  // Ručně ověřené („reviewed") zůstávají ověřené; ostatní dostanou ok / mismatch podle nového porovnání.
  let _rcAt = 0;
  async function recheckStale(force) {
    if (!force && Date.now() - _rcAt < 60e3) return 0; _rcAt = Date.now();
    const ids = (await q(`SELECT id FROM supporters WHERE mig_at IS NOT NULL AND (${force ? 'true' : "coalesce(mig_diff->>'v','0') <> $1"}) LIMIT 5000`, force ? [] : [String(CHECK_V)])).rows.map((r) => r.id);
    for (const id of ids) {
      const u = await load(id); if (!u) continue; const r = compare(u);
      const st = r.status === 'ok' ? 'ok' : (u.mig_status === 'reviewed' ? 'reviewed' : 'mismatch');
      await q('UPDATE supporters SET mig_status=$2, mig_diff=$3 WHERE id=$1', [id, st, JSON.stringify({ v: CHECK_V, diffs: r.diffs, ours: r.ours || null, checked_at: new Date().toISOString(), kind: r.status })]);
    }
    if (ids.length) console.log('[vybery-check] přepočteno ' + ids.length + ' vyplnění podle pravidel v' + CHECK_V);
    return ids.length;
  }
  setTimeout(() => recheckStale(true).catch((e) => console.warn('[vybery-check] přepočet:', e.message)), 20e3);

  return { gate, allowed, compare, ours, recheckStale };
};
module.exports.FIELDS = FIELDS;
module.exports.POSITIONS = POSITIONS;
module.exports.compare = compare;
module.exports.ours = ours;
module.exports.stOurs = stOurs;
