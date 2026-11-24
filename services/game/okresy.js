// =============================================================================
// Laundromat Tycoon — okresy: území Unie a jeho skutečná hranice
// =============================================================================
// Území se dřív vázalo na město a na mapě se kreslilo jako kruh o sedmi
// kilometrech kolem jeho středu. Byla to kresba bez podkladu: dvě města
// v jednom okrese by se překrývala a hráč nepoznal, kde území končí a kde
// začíná sousední. Okres je proti tomu hranice, která někde doopravdy je —
// jde ji nakreslit a vedle ní si vzít další.
//
// Všechno je líné a jednorázové. Okres se k městu najde při prvním dotazu
// (reverse geokódování středu), hranice se k němu jednou stáhne a od té
// chvíle se obojí čte z databáze. Když cizí služba zrovna neodpoví, hra
// běží dál — jen se místo obrysu nakreslí kruh jako dřív.
'use strict';

const { prisma } = require('../../config/database');

const UA = 'LaundromatTycoon/1.0 (+https://pradlomaty.info)';
const BODU_MAX = 160;          // kolik bodů obrysu jde ven na mapu

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms || 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(to); }
}

// Klíč okresu. Bez diakritiky a mezer, s kódem země napřed — „okres Šumperk"
// je v Česku jeden, ale stejné jméno nese okres i město jinde ve světě.
function klic(zeme, nazev) {
  const z = String(zeme || 'xx').toLowerCase().slice(0, 2);
  const n = String(nazev || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return n ? z + ':' + n : '';
}

// Zjednodušení obrysu (Douglas–Peucker). Hranice z OSM má klidně pět tisíc
// bodů; na mapě v telefonu je to k nerozeznání od stovky a jen by se to
// vleklo po drátě.
function vzdalenost(p, a, b) {
  const x = p[1], y = p[0], x1 = a[1], y1 = a[0], x2 = b[1], y2 = b[0];
  const dx = x2 - x1, dy = y2 - y1;
  if (!dx && !dy) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
function dp(body, tol) {
  if (body.length < 3) return body.slice();
  let max = 0, idx = 0;
  for (let i = 1; i < body.length - 1; i++) {
    const d = vzdalenost(body[i], body[0], body[body.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [body[0], body[body.length - 1]];
  return dp(body.slice(0, idx + 1), tol).slice(0, -1).concat(dp(body.slice(idx), tol));
}
function zjednodus(body, kolik) {
  const cil = kolik || BODU_MAX;
  if (!Array.isArray(body) || body.length <= cil) return (body || []).slice();
  let out = body, tol = 0.0005;
  for (let i = 0; i < 14 && out.length > cil; i++) {
    out = dp(body, tol);
    tol *= 1.8;
  }
  return out;
}

// Z GeoJSONu vybere největší prstenec. Okres bývá Polygon, občas MultiPolygon
// (exklávy) — kreslí se ten hlavní, ne všechny dohromady.
function prstenec(geo) {
  if (!geo || !geo.coordinates) return null;
  let kandidati = [];
  if (geo.type === 'Polygon') kandidati = [geo.coordinates[0]];
  else if (geo.type === 'MultiPolygon') kandidati = geo.coordinates.map((p) => p[0]);
  else return null;
  let nej = null;
  kandidati.forEach((r) => { if (Array.isArray(r) && (!nej || r.length > nej.length)) nej = r; });
  if (!nej) return null;
  // GeoJSON je [lon, lat], mapa chce [lat, lon].
  return nej.map((c) => [Number(c[1]), Number(c[0])])
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
}

// Do kterého okresu patří bod. Nominatim vrací okres jako county, u velkých
// měst (Praha, Brno) žádný okres není — tam je okresem samo město.
async function najdiOkres(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  const j = await fetchJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2'
    + '&zoom=8&addressdetails=1&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon));
  const a = (j && j.address) || null;
  if (!a) return null;
  const nazev = a.county || a.state_district || a.city || a.town || a.municipality || null;
  const zeme = a.country_code || null;
  if (!nazev) return null;
  return { key: klic(zeme, nazev), nazev: String(nazev), zeme };
}

// Hranice okresu. Hledá se jménem — reverse umí vrátit jméno, ale ne obrys.
async function najdiHranici(nazev, zeme) {
  const q = encodeURIComponent(nazev + (zeme ? ', ' + zeme : ''));
  const j = await fetchJson('https://nominatim.openstreetmap.org/search?format=jsonv2'
    + '&polygon_geojson=1&limit=1&q=' + q, 20000);
  const x = Array.isArray(j) && j.length ? j[0] : null;
  if (!x) return null;
  const body = prstenec(x.geojson);
  return {
    lat: Number(x.lat), lon: Number(x.lon),
    hranice: body && body.length >= 4 ? zjednodus(body, BODU_MAX) : null,
  };
}

// Okres města. Jednou se najde a zapíše k oblasti, pak se jen čte.
async function proOblast(area) {
  if (!area) return null;
  if (area.okres_key) return { key: area.okres_key, nazev: area.okres_nazev || area.okres_key };
  const o = await najdiOkres(area.lat, area.lon);
  if (!o || !o.key) return null;
  await prisma.gameArea.update({ where: { key: area.key },
    data: { okres_key: o.key, okres_nazev: o.nazev } }).catch(() => {});
  await zajisti(o.key, o.nazev, o.zeme).catch(() => {});
  return { key: o.key, nazev: o.nazev };
}

// Řádek okresu i s hranicí. Když se hranice nestáhne, řádek vznikne bez ní
// a zkusí se příště — mapa to pozná a nakreslí zatím kruh.
async function zajisti(key, nazev, zeme) {
  if (!key) return null;
  const mam = await prisma.gameOkres.findUnique({ where: { key } }).catch(() => null);
  if (mam && mam.hranice) return mam;
  const h = await najdiHranici(nazev || (mam && mam.nazev) || key, zeme || (mam && mam.zeme) || null);
  const data = { nazev: String(nazev || (mam && mam.nazev) || key).slice(0, 120),
    zeme: (zeme || (mam && mam.zeme) || null), lat: h ? h.lat : (mam && mam.lat),
    lon: h ? h.lon : (mam && mam.lon), hranice: h ? h.hranice : ((mam && mam.hranice) || null) };
  return prisma.gameOkres.upsert({ where: { key }, create: Object.assign({ key }, data), update: data })
    .catch(() => mam);
}

// Která města v okrese leží. Podle nich se pak hledají zábory — claim nese
// město, ne okres.
async function oblasti(okresKey) {
  const rows = await prisma.gameArea.findMany({ where: { okres_key: okresKey },
    select: { key: true } }).catch(() => []);
  return rows.map((r) => r.key);
}

// Okresy k seznamu měst. Města, která okres ještě nemají, se cestou doplní —
// proto může první otevření trvat déle.
async function proKlice(klice) {
  const out = new Map();
  if (!klice || !klice.length) return out;
  const rows = await prisma.gameArea.findMany({ where: { key: { in: klice } } }).catch(() => []);
  for (const a of rows) {
    const o = await proOblast(a).catch(() => null);
    if (o && o.key) out.set(a.key, o);
  }
  return out;
}

// Převod území z doby, kdy se vázalo na město. Řádek, jehož klíč sedí na
// město, se přepíše na okres toho města — jinak by území nenašlo ani jeden
// zábor a tvářilo se jako prázdné. Když je ten okres už zabraný někým jiným,
// nechá se řádek být a napíše se to do logu: dvě města v jednom okrese jsou
// přesně ta srážka, kvůli které se na okresy přechází, a rozhodnout ji má
// člověk, ne tiché přepsání.
async function prevedStaraUzemi() {
  const uzemi = await prisma.gameTerritory.findMany().catch(() => []);
  if (!uzemi.length) return 0;
  const mesta = await prisma.gameArea.findMany({
    where: { key: { in: uzemi.map((t) => t.okres_key) } } }).catch(() => []);
  if (!mesta.length) return 0;
  let kolik = 0;
  for (const a of mesta) {
    const t = uzemi.find((x) => x.okres_key === a.key);
    if (!t) continue;
    const o = await proOblast(a).catch(() => null);
    if (!o || !o.key || o.key === t.okres_key) continue;
    const obsazeno = await prisma.gameTerritory.findUnique({ where: { okres_key: o.key } }).catch(() => null);
    if (obsazeno) {
      console.warn('[game] unie — území', a.key, 'nejde převést: okres', o.key, 'už drží', obsazeno.master_nick);
      continue;
    }
    await prisma.gameTerritory.update({ where: { id: t.id }, data: { okres_key: o.key } }).catch(() => {});
    await prisma.gameOperatorLicence.updateMany({ where: { okres_key: a.key }, data: { okres_key: o.key } }).catch(() => {});
    console.log('[game] unie — území', a.key, '→ okres', o.key);
    kolik++;
  }
  return kolik;
}

module.exports = { klic, zjednodus, prstenec, najdiOkres, najdiHranici,
  proOblast, zajisti, oblasti, proKlice, prevedStaraUzemi, BODU_MAX };
