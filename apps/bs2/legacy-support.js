// BS2 — Načtení podpory uživatele ze starého partnerského portálu (partner.bestseries.cz)
// Přihlásí se jako uživatel přes fake-login.php (stejně jako tlačítko „Starý účet"), stáhne
// „Přehled podpory" (/cs/bo/my-invests/) a „Mé celkové obraty" a vytáhne souhrny:
// celkem od počátku, aktuální rok, palety / expanze / NeuraWash / opakovačky, obrat sítě od počátku.
'use strict';

const BASE = process.env.LEGACY_PORTAL_URL || 'https://partner.bestseries.cz';

function parseCookies(res, jar) {
  let list = [];
  try { if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie(); } catch (e) { /* starší Node */ }
  if (!list.length) { const raw = res.headers.get('set-cookie'); if (raw) list = raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/); }
  for (const c of list) { const kv = String(c).split(';')[0].trim(); const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1); }
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');

async function get(url, jar, hops = 5) {
  let u = url;
  for (let i = 0; i < hops; i++) {
    const res = await fetch(u, { redirect: 'manual', headers: { cookie: cookieHeader(jar), 'user-agent': 'BS2-admin-sync' } });
    parseCookies(res, jar);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u).toString(); continue; }
    return { url: u, status: res.status, html: await res.text() };
  }
  if (hops === 1) return { url: u, status: 302, html: '' }; // záměrně bez následování přesměrování
  throw new Error('Příliš mnoho přesměrování');
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(div|p|h\d|tr|li|td|th|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
const num = (s) => { const t = String(s || '').replace(/[^\d,-]/g, '').replace(',', '.'); return t === '' ? null : Number(t); };

// měna: účty ze SK/EU mají podporu v eurech („535 eur"), CZ v korunách („1 582 czk")
const CUR = '(czk|kč|kc|eur|€)';
const curOf = (s) => (/eur|€/i.test(String(s || '')) ? 'EUR' : 'CZK');
function parseInvests(text) {
  const out = {};
  let m = text.match(new RegExp('(\\d{4}) jste podpořili:\\s*\\n?\\s*([\\d\\s ,.]+)\\s*' + CUR, 'i'));
  if (m) { out.year = Number(m[1]); out.total_year = num(m[2]); out.currency = curOf(m[3]); }
  m = text.match(new RegExp('Celkem jste podpořili:\\s*\\n?\\s*([\\d\\s ,.]+)\\s*' + CUR, 'i'));
  if (m) { out.total_all = num(m[1]); out.currency = out.currency || curOf(m[2]); }
  const map = { palety: 'palety', expanze: 'expanze', neurawash: 'neurawash', 'opakovačky': 'opakovacky', opakovacky: 'opakovacky' };
  const re = new RegExp('Seznam vaší podpory\\s*-\\s*([^:\\n]+):([\\s\\S]*?)Celkem:\\s*([\\d\\s ,.]+)\\s*' + CUR, 'gi');
  let s;
  while ((s = re.exec(text))) { const k = map[s[1].trim().toLowerCase()]; if (k) out[k] = num(s[3]); }
  for (const k of ['palety', 'expanze', 'neurawash', 'opakovacky']) if (out[k] == null) out[k] = 0;
  if (!out.currency) out.currency = 'CZK';
  return out;
}

// Kurz EUR z ČNB (denní kurz devizového trhu) — cache 6 h; eurové hodnoty zůstávají beze změny,
// přepočet na Kč se ukládá do samostatných polí *_czk spolu s kurzem a jeho datem.
let _cnb = null;
async function cnbEurRate() {
  if (_cnb && Date.now() - _cnb.at < 6 * 3600e3) return _cnb;
  const r = await fetch('https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt');
  const t = await r.text();
  const date = (t.match(/^(\d{2}\.\d{2}\.\d{4})/) || [])[1] || null;
  const line = t.split('\n').find((l) => /\|EUR\|/.test(l));
  if (!line) throw new Error('ČNB: kurz EUR nenalezen');
  const p = line.split('|'); const rate = Number(p[4].replace(',', '.')) / (Number(p[2]) || 1);
  if (!isFinite(rate) || rate <= 0) throw new Error('ČNB: neplatný kurz');
  _cnb = { rate, date, at: Date.now() };
  return _cnb;
}
const CZK_FIELDS = ['total_all', 'total_year', 'palety', 'expanze', 'neurawash', 'opakovacky'];
/** U eurového účtu doplní *_czk (přepočet kurzem ČNB). U korunového účtu *_czk smaže. Volitelně použije už uložený kurz. */
async function addCzk(data, keepRate) {
  if (data.currency !== 'EUR') { for (const k of CZK_FIELDS) delete data[k + '_czk']; delete data.eur_rate; delete data.eur_rate_date; return data; }
  let rate = keepRate && keepRate.rate, date = keepRate && keepRate.date;
  if (!rate) { try { const c = await cnbEurRate(); rate = c.rate; date = c.date; } catch (e) { data.eur_rate_error = e.message; return data; } }
  data.eur_rate = rate; data.eur_rate_date = date; delete data.eur_rate_error;
  for (const k of CZK_FIELDS) data[k + '_czk'] = data[k] == null ? null : Math.round(Number(data[k]) * rate * 100) / 100;
  return data;
}

// Pozice uživatele ve starém portálu = popisek pod logem v levém menu (.sa-sidebar-logo__caption):
// „PARTNER", „VIP", „VIP 2" (+ obrázek loga, např. /images/vip.png). Normalizujeme na Partner / VIP / VIP 2.
function parsePosition(html) {
  const h = String(html || '');
  const cap = (h.match(/sa-sidebar-logo__caption[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
  const logo = (h.match(/sa-sidebar-logo[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i) || [])[1] || null;
  const raw = cap ? cap.replace(/<[^>]+>/g, ' ').replace(/&sup2;|²/g, ' 2').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const logoFile = logo ? logo.split('/').pop() : null;
  let position = null;
  if (/^vip\s*-?\s*(2|ii)$/i.test(raw) || /vip[-_ ]?2/i.test(logoFile || '')) position = 'VIP 2';
  else if (/^vip$/i.test(raw) || (!raw && /^vip\./i.test(logoFile || ''))) position = 'VIP';
  else if (/^partner$/i.test(raw)) position = 'Partner';
  else if (raw) position = raw;
  return { position, position_raw: raw || null, position_logo: logoFile, position_checked_at: new Date().toISOString() };
}
/** Jen pozice (rychlé: přihlášení + 1 stránka). */
async function fetchLegacyPosition(email) {
  if (!email) return { ok: false, error: 'Uživatel nemá e-mail' };
  const jar = {};
  try {
    await get(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), jar, 1).catch(() => {});
    const inv = await get(BASE + '/cs/bo/my-invests/', jar);
    if (!/sa-sidebar-logo/i.test(inv.html)) return { ok: false, error: 'Stránka nemá očekávaný obsah (nepřihlášeno?)' };
    return { ok: true, data: parsePosition(inv.html) };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Stáhne podporu pro e-mail uživatele. Vrací { ok, data } nebo { ok:false, error }. */
async function fetchLegacySupport(email) {
  if (!email) return { ok: false, error: 'Uživatel nemá e-mail' };
  const jar = {};
  try {
    // jen přihlášení (cookie) — nepřesměrovávat na těžký dashboard, ušetří to většinu času
    await get(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), jar, 1).catch(() => {});
    const inv = await get(BASE + '/cs/bo/my-invests/', jar);
    const text = htmlToText(inv.html);
    if (!/jste podpořili/i.test(text)) return { ok: false, error: /přihl|login/i.test(inv.url + text.slice(0, 500)) ? 'Starý portál nepřihlásil uživatele (fake-login nefunguje bez přihlášeného admina?)' : 'Stránka podpory nemá očekávaný obsah' };
    const data = parseInvests(text);
    Object.assign(data, parsePosition(inv.html)); // pozice Partner / VIP / VIP 2
    // „Celkem jste podpořili" se na stránce dotahuje AJAXem (v HTML je jen zástupná hodnota = rok)
    try {
      const r = await fetch(BASE + '/php/load-support-total.php', { method: 'POST', headers: { cookie: cookieHeader(jar), 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', 'user-agent': 'BS2-admin-sync' }, body: 'user_id=0' });
      const t = (await r.text()).trim();
      const n = Number(String(t).replace(/["\s]/g, ''));
      if (r.ok && isFinite(n)) data.total_all = n; else data.total_all_error = 'load-support-total: ' + t.slice(0, 80);
    } catch (e) { data.total_all_error = e.message; }
    // jméno/nick v hlavičce — kontrola, že jsme opravdu na účtu tohoto uživatele
    const who = text.match(/Počet pracujících kiosků:\s*\d+\n([^\n]+)\n([^\n]+)\nPřehled/);
    if (who) data.legacy_name = who[1] + ' (' + who[2] + ')';
    try {
      const tot = htmlToText((await get(BASE + '/cs/bo/detailed-stats-values-totals/', jar)).html);
      const m = tot.match(new RegExp('Celkový obrat v mé síti od počátku\\s*\\n?\\s*([\\d\\s ,.]+)\\s*' + CUR, 'i'));
      if (m) data.network_currency = curOf(m[2]);
      if (m) data.network_all = num(m[1]);
    } catch (e) { /* obrat sítě je bonus */ }
    await addCzk(data);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { fetchLegacySupport, fetchLegacyPosition, parsePosition, parseInvests, htmlToText, addCzk, cnbEurRate };
