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

function parseInvests(text) {
  const out = {};
  let m = text.match(/(\d{4}) jste podpořili:\s*\n?\s*([\d\s ]+)\s*czk/i);
  if (m) { out.year = Number(m[1]); out.total_year = num(m[2]); }
  m = text.match(/Celkem jste podpořili:\s*\n?\s*([\d\s ]+)\s*czk/i);
  if (m) out.total_all = num(m[1]);
  const map = { palety: 'palety', expanze: 'expanze', neurawash: 'neurawash', 'opakovačky': 'opakovacky', opakovacky: 'opakovacky' };
  const re = /Seznam vaší podpory\s*-\s*([^:\n]+):([\s\S]*?)Celkem:\s*([\d\s ]+)\s*czk/gi;
  let s;
  while ((s = re.exec(text))) { const k = map[s[1].trim().toLowerCase()]; if (k) out[k] = num(s[3]); }
  for (const k of ['palety', 'expanze', 'neurawash', 'opakovacky']) if (out[k] == null) out[k] = 0;
  return out;
}

/** Stáhne podporu pro e-mail uživatele. Vrací { ok, data } nebo { ok:false, error }. */
async function fetchLegacySupport(email) {
  if (!email) return { ok: false, error: 'Uživatel nemá e-mail' };
  const jar = {};
  try {
    await get(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), jar);
    const inv = await get(BASE + '/cs/bo/my-invests/', jar);
    const text = htmlToText(inv.html);
    if (!/jste podpořili/i.test(text)) return { ok: false, error: /přihl|login/i.test(inv.url + text.slice(0, 500)) ? 'Starý portál nepřihlásil uživatele (fake-login nefunguje bez přihlášeného admina?)' : 'Stránka podpory nemá očekávaný obsah' };
    const data = parseInvests(text);
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
      const m = tot.match(/Celkový obrat v mé síti od počátku\s*\n?\s*([\d\s ]+)\s*czk/i);
      if (m) data.network_all = num(m[1]);
    } catch (e) { /* obrat sítě je bonus */ }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { fetchLegacySupport, parseInvests, htmlToText };
