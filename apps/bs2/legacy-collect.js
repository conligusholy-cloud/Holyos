// BS2 — Přenos VŠECH dat ze starého partnerského portálu (partner.bestseries.cz)
// U jednoho uživatele: přihlášení (fake-login) → projde všechny stránky menu → z každé uloží
//   • fields  = výsledná čísla ve tvaru „Popisek: hodnota" (např. „Úroky celkem: 12 345 czk")
//   • tables  = všechny tabulky (nadpis, hlavičky, řádky) — historie položek
//   • text    = očištěný text stránky (důkaz, max ~15 kB)
// + speciální zdroje, které portál dotahuje až JavaScriptem (celkem podpořil, úrok z expanze)
// + podpora po všech letech (Přehled podpory ?y=YYYY).
// Nic se nepřepočítává — ukládají se výsledná čísla tak, jak je ukazuje starý portál.
'use strict';

const LS = require('./legacy-support');
const BASE = process.env.LEGACY_PORTAL_URL || 'https://partner.bestseries.cz';

// Stránky starého portálu (cesta /cs/bo/<path>/) v pořadí, jak se zobrazí v detailu uživatele
const SECTIONS = [
  { key: 'dashboard', label: 'Přehled (dashboard)', path: 'dashboard' },
  { key: 'my-invests', label: 'Přehled podpory (všechny roky)', path: 'my-invests' },
  { key: 'piv', label: 'PIV členství', path: 'piv' },
  { key: 'expansion-event', label: 'VIP členství', path: 'expansion-event' },
  { key: 'expansion-rules', label: 'Rozložení expanze', path: 'expansion-rules' },
  { key: 'uroky', label: 'Úroky', path: 'uroky' },
  { key: 'comissions', label: 'Provize', path: 'comissions' },
  { key: 'comissions-sumary', label: 'Provize souhrn', path: 'comissions-sumary' },
  { key: 'detailed-stats-values', label: 'Moje obraty', path: 'detailed-stats-values' },
  { key: 'detailed-stats-values-totals', label: 'Mé celkové obraty', path: 'detailed-stats-values-totals' },
  { key: 'my-net', label: 'Moje síť', path: 'my-net' },
  { key: 'kariera', label: 'Kariéra', path: 'kariera' },
  { key: 'prehled-kiosku', label: 'Přehled kiosků', path: 'prehled-kiosku' },
  { key: 'generacni-kiosky', label: 'Generační kiosky', path: 'generacni-kiosky' },
  { key: 'founder-slots', label: 'Founder program', path: 'founder-slots' },
  { key: 'orders', label: 'Mé objednávky', path: 'orders' },
  { key: 'recurence-orders', label: 'Mé opakovačky', path: 'recurence-orders' },
  { key: 'machinery-order', label: 'NEURAWASH', path: 'machinery-order' },
  { key: 'wallet', label: 'Wallet', path: 'wallet' },
  { key: 'wallet-podily', label: 'Podíly a aukce', path: 'wallet-podily' },
  { key: 'finance', label: 'Výběry', path: 'finance' },
  { key: 'laundry', label: 'Laundry', path: 'laundry' },
  { key: 'referer', label: 'Referenční program', path: 'referer' },
  { key: 'settings', label: 'Nastavení profilu', path: 'settings' },
];

// Položky levého menu a hlavičky — z textu stránky se vyhodí, aby zůstal jen obsah
const MENU = new Set(['Přehled', 'Kalkulátor vaší renty', 'Vzdělávání', 'VIP', 'VIP 2', 'PARTNER', 'Partner', 'Founder program', 'PIV', 'Kiosky', 'Přehled kiosků', 'Generační kiosky', 'Návštěvnost', 'Profi statistisky', 'Nákupy', 'Nová podpora', 'NEURAWASH', 'Mé objednávky', 'Mé opakovačky', 'Přehled podpory', 'Úroky', 'Rozložení expanze', 'Referenční program', 'Provize', 'Provize souhrn', 'Moje síť', 'Moje obraty', 'Kariéra', 'Podíly a wallet', 'Wallet', 'Podíly a aukce', 'Intercom', 'Výběry', 'Laundry', 'Nastavení profilu', 'Podpora', '> IHNED PODPOŘIT KIOSEK', 'Podmínky:', 'ZOP', 'ZOPDEV', 'GDPR', '|']);

const decode = (s) => String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&sup2;/g, '²')
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&([a-z]+);/gi, (m, e) => ({ aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', yacute: 'ý', scaron: 'š', ccaron: 'č', rcaron: 'ř', zcaron: 'ž', ecaron: 'ě', uring: 'ů', Scaron: 'Š', Ccaron: 'Č', Rcaron: 'Ř', Zcaron: 'Ž' }[e] || m));
const cellText = (h) => decode(String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Tabulky: nadpis (nejbližší předchozí h1–h5), hlavičky, řádky (max 1000 na tabulku). */
function parseTables(html) {
  const out = [];
  const re = /<table[\s\S]*?<\/table>/gi; let m;
  while ((m = re.exec(html)) && out.length < 40) {
    const t = m[0];
    const before = html.slice(Math.max(0, m.index - 3000), m.index);
    const hs = [...before.matchAll(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/gi)];
    const title = hs.length ? cellText(hs[hs.length - 1][1]) : '';
    const headers = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => cellText(x[1]));
    const rows = [];
    for (const tr of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => cellText(x[1]));
      if (cells.length && cells.some(Boolean)) rows.push(cells);
      if (rows.length >= 1000) break;
    }
    if (headers.length || rows.length) out.push({ title, headers, rows });
  }
  return out;
}

/** Text stránky bez menu, hlavičky a patičky. */
function pageText(html) {
  const lines = LS.htmlToText(String(html || '').replace(/<table[\s\S]*?<\/table>/gi, ' ')).split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    if (MENU.has(l) || /^Počet pracujících kiosků:/.test(l)) continue;
    out.push(l);
  }
  return out;
}

/** Výsledná čísla „Popisek: hodnota" (hodnota na stejném nebo dalším řádku). */
function parseFields(lines) {
  const f = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = l.match(/^(.{2,80}?):\s*(.{1,80})$/);
    if (m && /\d/.test(m[2])) { addField(f, m[1], m[2]); continue; }
    if (/:$/.test(l) && l.length <= 90 && i + 1 < lines.length && lines[i + 1].length <= 60 && !/:$/.test(lines[i + 1]) && !/^.{2,80}?:\s*\S/.test(lines[i + 1])) { addField(f, l.slice(0, -1), lines[i + 1]); i++; continue; }
    m = l.match(/^(\d{4}) jste podpořili:?$/i);
    if (m && i + 1 < lines.length) { addField(f, l.replace(/:$/, ''), lines[i + 1]); i++; }
  }
  return f;
}
function addField(f, k, v) { k = k.trim(); v = v.trim(); if (!k || !v) return; let key = k, n = 2; while (f[key] != null && f[key] !== v) key = k + ' (' + n++ + ')'; f[key] = v; }

/** Formulář nastavení profilu: hodnoty vstupních polí (bez hesel a technických polí). */
function parseInputs(html) {
  const f = {};
  for (const m of String(html || '').matchAll(/<input([^>]*)>/gi)) {
    const a = m[1]; const name = (a.match(/name="([^"]*)"/i) || [])[1]; const type = ((a.match(/type="([^"]*)"/i) || [])[1] || 'text').toLowerCase();
    if (!name || /pass|csrf|token|hidden|submit|button|file/i.test(name + ' ' + type)) continue;
    const val = decode((a.match(/value="([^"]*)"/i) || [])[1] || '');
    if (type === 'checkbox' || type === 'radio') { if (/checked/i.test(a)) f[name] = val || 'ano'; continue; }
    if (val) f[name] = val;
  }
  for (const m of String(html || '').matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const sel = (m[2].match(/<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i) || [])[1];
    if (sel && !/^y$/.test(m[1])) f[m[1]] = cellText(sel);
  }
  return f;
}

async function ajax(jar, path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { cookie: LS.cookieHeader(jar), 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', 'user-agent': 'BS2-admin-sync' }, body: body || 'user_id=0' });
  return (await r.text()).trim();
}

/** Jedna stránka → { label, fields, tables, text, ok } */
async function collectPage(jar, sec) {
  const pg = await LS.get(BASE + '/cs/bo/' + sec.path + '/', jar);
  if (pg.status >= 400) return { label: sec.label, ok: false, error: 'HTTP ' + pg.status };
  if (/login|prihlas/i.test(pg.url) && !/sa-sidebar/i.test(pg.html)) return { label: sec.label, ok: false, error: 'nepřihlášeno' };
  const lines = pageText(pg.html);
  const out = { label: sec.label, ok: true, fields: parseFields(lines), tables: parseTables(pg.html), text: lines.join('\n').slice(0, 15000) };
  if (sec.key === 'settings') out.inputs = parseInputs(pg.html);
  if (sec.key === 'piv') out.parsed = LS.parsePiv(pg.html);
  return out;
}

/**
 * Všechna data jednoho uživatele. Vrací { ok, sections: { key: {...} }, partner: {...pole pro partner_support} }.
 * `concurrency` = kolik stránek jednoho uživatele najednou (šetrně ke starému serveru).
 */
async function collectAll(email, { concurrency = 3 } = {}) {
  if (!email) return { ok: false, error: 'Uživatel nemá e-mail' };
  const jar = {};
  await LS.get(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), jar, 1).catch(() => {});
  const sections = {}; const partner = {}; const errors = [];
  // 1) podpora po všech letech + celkem (AJAX) + pozice — stávající ověřené funkce
  try {
    const std = await LS.fetchLegacyStandardWithJar(jar);
    if (std.ok) Object.assign(partner, std.data); else errors.push('my-invests: ' + std.error);
  } catch (e) { errors.push('my-invests: ' + e.message); }
  try {
    const t = await ajax(jar, '/php/load-support-total.php');
    const n = Number(String(t).replace(/["\s]/g, ''));
    if (isFinite(n)) partner.total_all = n;
  } catch (e) { errors.push('celkem: ' + e.message); }
  try {
    const t = await ajax(jar, '/php/load-days-visits-ratio.php');
    const j = JSON.parse(t); if (j && j.invested != null) Object.assign(partner, LS.parseExpansion(j));
  } catch (e) { errors.push('expanze: ' + e.message); }
  // 2) všechny stránky menu
  const queue = SECTIONS.slice();
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const sec = queue.shift();
      try {
        const r = await collectPage(jar, sec);
        sections[sec.key] = r;
        if (!r.ok) errors.push(sec.key + ': ' + r.error);
        if (sec.key === 'piv' && r.ok && r.parsed) Object.assign(partner, r.parsed);
      } catch (e) { sections[sec.key] = { label: sec.label, ok: false, error: e.message }; errors.push(sec.key + ': ' + e.message); }
    }
  }));
  if (partner.position == null) {
    try { const pg = await LS.get(BASE + '/cs/bo/my-invests/', jar); Object.assign(partner, LS.parsePosition(pg.html)); } catch (e) { /* pozice je bonus */ }
  }
  if (!Object.values(sections).some((s) => s.ok)) return { ok: false, error: errors[0] || 'Nic se nenačetlo (nepřihlášeno?)' };
  // eura → Kč (kurz ČNB) u PIV a expanze; u podpory řeší std
  try {
    const needEur = (partner.piv_currency === 'EUR' && partner.piv_total != null) || (partner.exp_currency === 'EUR' && partner.exp_invested != null);
    const c = needEur ? await LS.cnbEurRate() : null;
    if (partner.piv_total != null) partner.piv_total_czk = partner.piv_currency === 'EUR' ? (c ? Math.round(partner.piv_total * c.rate * 100) / 100 : null) : partner.piv_total;
    if (partner.exp_invested != null) partner.exp_invested_czk = partner.exp_currency === 'EUR' ? (c ? Math.round(partner.exp_invested * c.rate * 100) / 100 : null) : partner.exp_invested;
  } catch (e) { /* bez kurzu */ }
  partner.legacy_collected_at = new Date().toISOString();
  return { ok: true, sections, partner, errors };
}

module.exports = { SECTIONS, collectAll, parseFields, parseTables, pageText, parseInputs };
