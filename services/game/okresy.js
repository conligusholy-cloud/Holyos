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

// ─── Co se nikdy nedělá na cestě, po které se hráč dívá ──────────────────────
// Stahování hranice je dotaz na cizí službu a trvá vteřiny, při výpadku desítky
// vteřin. Přehled Unie na tom jednou uvízl: při každém pohledu se znovu zkoušel
// okres, který se stáhnout nedaří, a panel visel na „Načítám…".
//
// Pravidlo je proto tvrdé: čtecí cesta sáhne jen do databáze a odpoví tím, co
// v ní je. Co chybí, se dotáhne na pozadí a objeví se při příštím pohledu.
// A nezkouší se pořád dokola — mezi pokusy je pauza, jinak by neúspěch znamenal
// dotaz na cizí službu při každém načtení stránky.
const POKUSY = new Map();
const POKUS_PAUZA = 15 * 60 * 1000;
function naPozadi(klic, prace) {
  const kdy = POKUSY.get(klic) || 0;
  if (Date.now() - kdy < POKUS_PAUZA) return false;
  POKUSY.set(klic, Date.now());
  // Schválně bez await: volající musí odpovědět hned.
  Promise.resolve().then(prace).catch((e) => {
    console.warn('[game] okresy — ' + klic + ' na pozadí selhalo:', e && e.message);
  });
  return true;
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

// ─── Overpass ────────────────────────────────────────────────────────────────
// Hranice se tahá odtud, ne z Nominatimu. Nominatim je geokodér: umí říct,
// jak se místo jmenuje, ale obrys z něj chodí nespolehlivě a jméno není
// identita — hledání „okres Šumperk" trefilo město Šumperk. Overpass se umí
// zeptat přesně na to, co chceme: která administrativní hranice ten bod
// obsahuje. Hra ho navíc už používá na hledání míst, takže je ověřené, že
// ze serveru chodí.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
async function overpass(dotaz) {
  for (const url of OVERPASS) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(dotaz) }).finally(() => clearTimeout(to));
      if (!r.ok) continue;
      const j = await r.json();
      if (j && Array.isArray(j.elements)) return j;
    } catch (e) { /* další mirror */ }
  }
  return null;
}

// Hranice relace se z Overpassu vrací po kouscích (cesty) a v náhodném
// pořadí. Sešívají se podle konců: vezme se první kus a pořád se k němu
// přikládá ten, který na něj navazuje, dokud se kruh neuzavře. Bez toho by
// z obrysu byla hvězdice — čáry by skákaly křížem krážem.
function sesij(casti) {
  if (!casti.length) return [];
  const stejny = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const zbyva = casti.slice();
  let out = zbyva.shift().slice();
  let hledal = true;
  while (zbyva.length && hledal) {
    hledal = false;
    for (let i = 0; i < zbyva.length; i++) {
      const c = zbyva[i];
      const konec = out[out.length - 1];
      if (stejny(konec, c[0])) { out = out.concat(c.slice(1)); zbyva.splice(i, 1); hledal = true; break; }
      if (stejny(konec, c[c.length - 1])) { out = out.concat(c.slice().reverse().slice(1)); zbyva.splice(i, 1); hledal = true; break; }
      const zacatek = out[0];
      if (stejny(zacatek, c[c.length - 1])) { out = c.slice(0, -1).concat(out); zbyva.splice(i, 1); hledal = true; break; }
      if (stejny(zacatek, c[0])) { out = c.slice().reverse().slice(0, -1).concat(out); zbyva.splice(i, 1); hledal = true; break; }
    }
  }
  return out;
}

function zRelace(rel) {
  const casti = ((rel && rel.members) || [])
    .filter((m) => m.type === 'way' && (!m.role || m.role === 'outer') && Array.isArray(m.geometry))
    .map((m) => m.geometry.map((g) => [Number(g.lat), Number(g.lon)]))
    .filter((c) => c.length > 1);
  const obrys = sesij(casti);
  return obrys.length >= 4 ? obrys : null;
}

// Okres kolem bodu z Overpassu. Bere se nejmenší správní celek, který se
// okresu podobá: v Česku admin_level 6, jinde se o stupeň liší, tak se
// zkouší šestka i sedmička a vybere ta nižší úroveň (větší území).
async function okresOverpass(lat, lon, zemeHint) {
  const j = await overpass('[out:json][timeout:60];is_in(' + Number(lat) + ',' + Number(lon) + ')->.a;'
    + 'rel(pivot.a)["boundary"="administrative"]["admin_level"~"^[67]$"];out tags geom;');
  const rely = ((j && j.elements) || []).filter((e) => e.type === 'relation' && e.tags);
  if (!rely.length) return null;
  rely.sort((a, b) => Number(a.tags.admin_level || 9) - Number(b.tags.admin_level || 9));
  const rel = rely[0];
  const nazev = rel.tags['name:cs'] || rel.tags.name || null;
  if (!nazev) return null;
  const iso = String(rel.tags['ISO3166-2'] || '').slice(0, 2).toLowerCase();
  const zeme = iso || (zemeHint ? String(zemeHint).toLowerCase().slice(0, 2) : null);
  const obrys = zRelace(rel);
  return { key: klic(zeme, nazev), nazev: String(nazev), zeme,
    obyvatel: pocetObyvatel({ extratags: rel.tags }),
    lat: Number(lat), lon: Number(lon),
    hranice: obrys ? zjednodus(obrys, BODU_MAX) : null };
}

// Do kterého okresu patří bod — a rovnou jeho obrys. Nominatim vrací okres
// jako county, u velkých měst (Praha, Brno) žádný okres není a okresem je
// samo město.
//
// Obrys se bere z TÉHOŽ dotazu, ne z pozdějšího hledání podle jména. Hledání
// „okres Šumperk" vracelo město Šumperk a na mapě pak svítila obec místo
// okresu — jméno není identita, kdežto objekt, který reverse na zoomu okresu
// vrátí, okresem opravdu je.
async function najdiOkres(lat, lon, zemeHint) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  // Nejdřív Overpass: ptá se přímo na hranici, která ten bod obsahuje.
  const op = await okresOverpass(lat, lon, zemeHint).catch(() => null);
  if (op && op.key && op.hranice) return op;
  const j = await fetchJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2'
    + '&zoom=8&addressdetails=1&polygon_geojson=1&lat=' + encodeURIComponent(lat)
    + '&lon=' + encodeURIComponent(lon), 20000);
  const a = (j && j.address) || null;
  if (!a) return null;
  const nazev = a.county || a.state_district || a.city || a.town || a.municipality || null;
  const zeme = a.country_code || null;
  if (!nazev) return null;
  let body = prstenec(j.geojson);
  let obyvatel = pocetObyvatel(j);
  // Reverse umí vrátit i jen bod. Doptat se na geometrii jde podle osm_id —
  // tedy na TEN objekt, ne na jméno. Hledání podle jména („okres Šumperk")
  // trefilo město Šumperk a na mapě pak svítila obec.
  if ((!body || body.length < 4) && j.osm_type && j.osm_id) {
    const d = await lookup(j.osm_type, j.osm_id);
    if (d) {
      body = prstenec(d.geojson) || body;
      obyvatel = obyvatel || pocetObyvatel(d);
    }
  }
  return { key: klic(zeme, nazev), nazev: String(nazev), zeme, obyvatel,
    lat: Number(j.lat), lon: Number(j.lon),
    hranice: body && body.length >= 4 ? zjednodus(body, BODU_MAX) : null };
}

// Kolik lidí v okrese žije. Podle toho se počítá licence: okres je víc než
// jedno město a nemá stát stejně.
function pocetObyvatel(x) {
  const e = (x && x.extratags) || {};
  const n = parseInt(e.population || e['population:date'] || 0, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Doptání se na konkrétní objekt podle osm_id. Jméno není identita, tohle je.
async function lookup(osmType, osmId) {
  const p = String(osmType || '').toUpperCase().slice(0, 1);
  if (!p || !osmId) return null;
  const j = await fetchJson('https://nominatim.openstreetmap.org/lookup?format=jsonv2'
    + '&polygon_geojson=1&extratags=1&osm_ids=' + p + encodeURIComponent(osmId), 20000);
  return Array.isArray(j) && j.length ? j[0] : null;
}

// Hranice okresu. Hledá se jménem — reverse umí vrátit jméno, ale ne obrys.
async function najdiHranici(nazev, zeme) {
  const q = encodeURIComponent(nazev + (zeme ? ', ' + zeme : ''));
  const j = await fetchJson('https://nominatim.openstreetmap.org/search?format=jsonv2'
    + '&polygon_geojson=1&extratags=1&limit=1&q=' + q, 20000);
  const x = Array.isArray(j) && j.length ? j[0] : null;
  if (!x) return null;
  const body = prstenec(x.geojson);
  return {
    lat: Number(x.lat), lon: Number(x.lon), obyvatel: pocetObyvatel(x),
    hranice: body && body.length >= 4 ? zjednodus(body, BODU_MAX) : null,
  };
}

// Okres města. Jednou se najde a zapíše k oblasti, pak se jen čte.
async function proOblast(area) {
  if (!area) return null;
  if (area.okres_key) return { key: area.okres_key, nazev: area.okres_nazev || area.okres_key };
  // Okres se k městu ještě nedohledal. Dohledá se na pozadí a volajícímu se
  // odpoví, že zatím není — při příštím pohledu už tam bude. Čekat na cizí
  // službu uprostřed vykreslování panelu znamená panel, který se nenačte.
  naPozadi('oblast:' + area.key, async () => {
    const o = await najdiOkres(area.lat, area.lon, area.country);
    if (!o || !o.key) return;
    await prisma.gameArea.update({ where: { key: area.key },
      data: { okres_key: o.key, okres_nazev: o.nazev } }).catch(() => {});
    // Obrys z téhož dotazu — druhé hledání podle jména se tím ušetří a hlavně
    // nemůže trefit jiný objekt.
    await zajisti(o.key, o.nazev, o.zeme, o).catch(() => {});
    console.log('[game] okresy — město', area.key, '→ okres', o.key);
  });
  return null;
}

// Okres k městu A POČKÁ si na něj. Tohle patří jen tam, kde se bez okresu
// nedá rozhodnout — třeba když master vypisuje místo na Market place a musí
// se ověřit, že v tom okrese opravdu je. Na čtecí cestu to nepatří nikdy.
async function proOblastTed(area) {
  if (!area) return null;
  if (area.okres_key) return { key: area.okres_key, nazev: area.okres_nazev || area.okres_key };
  const o = await najdiOkres(area.lat, area.lon, area.country);
  if (!o || !o.key) return null;
  await prisma.gameArea.update({ where: { key: area.key },
    data: { okres_key: o.key, okres_nazev: o.nazev } }).catch(() => {});
  await zajisti(o.key, o.nazev, o.zeme, o).catch(() => {});
  return { key: o.key, nazev: o.nazev };
}

// Hranice okresu na pozadí. Tohle volá čtecí cesta místo zajisti(): odpoví
// hned a mapa zatím nakreslí kruh.
function zajistiNaPozadi(key, nazev, zeme) {
  if (!key) return false;
  return naPozadi('hranice:' + key, () => zajisti(key, nazev, zeme, null));
}

// Řádek okresu i s hranicí. Když se hranice nestáhne, řádek vznikne bez ní
// a zkusí se příště — mapa to pozná a nakreslí zatím kruh.
async function zajisti(key, nazev, zeme, hotovy) {
  if (!key) return null;
  const mam = await prisma.gameOkres.findUnique({ where: { key } }).catch(() => null);
  if (mam && mam.hranice) return mam;
  let h = (hotovy && hotovy.hranice) ? hotovy : null;
  // Obrys se dohledává přes některé město okresu — reverse z jeho středu
  // vrátí TEN okres i s geometrií. Hledání podle jména je až poslední
  // záchrana: jméno není identita a „okres Šumperk" trefilo město Šumperk.
  if (!h) {
    const mesto = await prisma.gameArea.findFirst({ where: { okres_key: key },
      select: { lat: true, lon: true, country: true } }).catch(() => null);
    if (mesto && mesto.lat != null) {
      h = await najdiOkres(mesto.lat, mesto.lon, mesto.country).catch(() => null);
    }
    // Klíč může vyjít jinak, když jméno přijde z jiného zdroje. Geograficky
    // je to ale pořád okres toho města, takže obrys sedí — jen se to zapíše
    // do logu, ať je poznat, že se dva zdroje v pojmenování rozcházejí.
    if (h && h.key !== key) {
      console.warn('[game] okres', key, '— zdroj hlásí jiný klíč', h.key, '(obrys beru)');
    }
  }
  if (!h || !h.hranice) {
    const z = await najdiHranici(nazev || (mam && mam.nazev) || key, zeme || (mam && mam.zeme) || null);
    if (z && z.hranice) h = Object.assign({}, h || {}, z);
  }
  const data = { nazev: String(nazev || (mam && mam.nazev) || key).slice(0, 120),
    zeme: (zeme || (mam && mam.zeme) || null), lat: (h && h.lat) || (mam && mam.lat),
    lon: (h && h.lon) || (mam && mam.lon),
    obyvatel: (h && h.obyvatel) || (mam && mam.obyvatel) || null,
    hranice: (h && h.hranice) || ((mam && mam.hranice) || null) };
  if (!data.hranice) console.warn('[game] okres', key, '— hranice se nestáhla, mapa nakreslí kruh');
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

// Okresy k seznamu měst. Čte se jen z databáze; město, které okres ještě nemá,
// se dohledá na pozadí a v odpovědi prostě není. Hráč ho uvidí při příštím
// otevření. Dřív se tu na dohledání čekalo — a u sítě o dvou stovkách míst
// to znamenalo panel, který se nenačetl.
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

// ─── Sousedé ─────────────────────────────────────────────────────────────────
// S kým okres sousedí. Území se má dát rozšiřovat o kus vedle, a k tomu musí
// hra vědět, co vedle je. Zjistí se to tak, že se kolem obrysu sáhne kousek
// ven a zeptá se, který okres tam je — žádná tabulka sousedů v OSM není
// a stahovat kvůli tomu hranice celé země by bylo dělo na vrabce.
//
// Je to drahé (dotaz na každý směr), takže se to dělá jednou za okres
// a ukládá. Pauza mezi dotazy je kvůli tomu, že Nominatim je cizí služba
// zdarma a bušit do ní nemáme čím ospravedlnit.
const SMERU = 12;              // kolik směrů se zkusí
const VEN_KM = 6;              // jak daleko za hranici se sáhne

function tezisteObrysu(body) {
  let la = 0, lo = 0;
  body.forEach((b) => { la += b[0]; lo += b[1]; });
  return [la / body.length, lo / body.length];
}

// Bod kousek za hranicí ve směru úhlu. Bere se nejvzdálenější bod obrysu
// v tom směru a přidá se pár kilometrů — tím se spolehlivě vyjde ven
// i u okresu, který je protáhlý.
function bodVen(body, stred, uhel) {
  const kosLat = Math.cos(stred[0] * Math.PI / 180) || 1;
  let vSektoru = 0, vcelku = 0;
  body.forEach((b) => {
    const dy = b[0] - stred[0], dx = (b[1] - stred[1]) * kosLat;
    const d = Math.hypot(dx, dy);
    if (d > vcelku) vcelku = d;
    const a = Math.atan2(dx, dy);
    let rozdil = Math.abs(a - uhel);
    if (rozdil > Math.PI) rozdil = 2 * Math.PI - rozdil;
    if (rozdil <= Math.PI / SMERU && d > vSektoru) vSektoru = d;
  });
  // V tom směru nemusí žádný bod obrysu ležet (špička, zub). Pak se jde na
  // celkový dosah obrysu — ven se musí vyjít vždycky, jinak by se ten směr
  // tiše přeskočil a soused by se nenašel.
  const nej = vSektoru || vcelku;
  if (!nej) return null;
  const d = nej + VEN_KM / 111;
  return [stred[0] + Math.cos(uhel) * d, stred[1] + Math.sin(uhel) * d / kosLat];
}

async function sousedi(key) {
  const o = await prisma.gameOkres.findUnique({ where: { key } }).catch(() => null);
  if (!o) return [];
  if (Array.isArray(o.sousedi) && o.sousedi.length) return o.sousedi;
  // Zjistit sousedy je dvanáct dotazů na cizí službu. Na cestě, po které se
  // hráč dívá, se na ně nečeká: spustí se na pozadí a odpoví se prázdnem.
  // Při příštím otevření už budou uložení.
  naPozadi('sousedi:' + key, () => sousediTed(o));
  return [];
}

// Vlastní hledání sousedů. Volá se z pozadí a z administrace, nikdy ne
// uprostřed vykreslování panelu.
async function sousediTed(o) {
  const key = o.key;
  const body = Array.isArray(o.hranice) ? o.hranice : null;
  if (!body || body.length < 4) return [];
  const stred = tezisteObrysu(body);
  const nalezeni = new Map();
  for (let i = 0; i < SMERU; i++) {
    const p = bodVen(body, stred, (i / SMERU) * 2 * Math.PI);
    if (!p) continue;
    const n = await najdiOkres(p[0], p[1], o.zeme).catch(() => null);
    if (n && n.key && n.key !== key && !nalezeni.has(n.key)) {
      nalezeni.set(n.key, n);
      // Soused se rovnou uloží i s obrysem — hráč si ho za chvíli otevře
      // a nemá na něj čekat podruhé.
      await zajisti(n.key, n.nazev, n.zeme, n).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  const klice = [...nalezeni.keys()];
  await prisma.gameOkres.update({ where: { key }, data: { sousedi: klice } }).catch(() => {});
  console.log('[game] okres', key, '— sousedé:', klice.join(', ') || '(žádní)');
  return klice;
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
    const o = await proOblastTed(a).catch(() => null);
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

// Převod starých území na pozadí. Na čtecí cestě se na něj nečeká.
function prevodNaPozadi() {
  return naPozadi('prevod', () => prevedStaraUzemi());
}

// Diagnostika pro administraci: zkusí po řadě všechny zdroje a řekne, co
// který vrátil. Bez toho se hádá naslepo — mapa jen mlčky nakreslí kruh.
async function diagnostika(lat, lon, zemeHint) {
  const out = { lat: Number(lat), lon: Number(lon), overpass: [], nominatim: null };
  const dotaz = '[out:json][timeout:60];is_in(' + Number(lat) + ',' + Number(lon) + ')->.a;'
    + 'rel(pivot.a)["boundary"="administrative"]["admin_level"~"^[67]$"];out tags geom;';
  for (const url of OVERPASS) {
    const zacatek = Date.now();
    const z = { url, ms: 0, stav: null, chyba: null, relaci: 0, vzorek: null };
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(dotaz) }).finally(() => clearTimeout(to));
      z.stav = r.status;
      if (r.ok) {
        const j = await r.json();
        const rely = ((j && j.elements) || []).filter((e) => e.type === 'relation' && e.tags);
        z.relaci = rely.length;
        rely.sort((a, b) => Number(a.tags.admin_level || 9) - Number(b.tags.admin_level || 9));
        if (rely[0]) {
          const rel = rely[0];
          const casti = ((rel.members) || []).filter((m) => m.type === 'way' && Array.isArray(m.geometry));
          const obrys = zRelace(rel);
          z.vzorek = { id: rel.id, admin_level: rel.tags.admin_level || null,
            nazev: rel.tags['name:cs'] || rel.tags.name || null,
            iso: rel.tags['ISO3166-2'] || null, obyvatel: pocetObyvatel({ extratags: rel.tags }),
            clenu: (rel.members || []).length, cest_s_geometrii: casti.length,
            sesito_bodu: obrys ? obrys.length : 0,
            klic: klic((rel.tags['ISO3166-2'] || '').slice(0, 2).toLowerCase()
              || (zemeHint || '').toLowerCase().slice(0, 2), rel.tags['name:cs'] || rel.tags.name) };
        }
      }
    } catch (e) { z.chyba = String((e && e.message) || e).slice(0, 200); }
    z.ms = Date.now() - zacatek;
    out.overpass.push(z);
    if (z.vzorek && z.vzorek.sesito_bodu >= 4) break;   // první, co dal obrys, stačí
  }
  const zacatek = Date.now();
  const n = { ms: 0, stav: null, chyba: null, nazev: null, osm: null, bodu: 0 };
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2'
      + '&zoom=8&addressdetails=1&polygon_geojson=1&lat=' + encodeURIComponent(lat)
      + '&lon=' + encodeURIComponent(lon), { signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json' } }).finally(() => clearTimeout(to));
    n.stav = r.status;
    if (r.ok) {
      const j = await r.json();
      const a = (j && j.address) || {};
      n.nazev = a.county || a.state_district || a.city || a.town || a.municipality || null;
      n.osm = j.osm_type ? (j.osm_type + '/' + j.osm_id) : null;
      const body = prstenec(j.geojson);
      n.bodu = body ? body.length : 0;
    }
  } catch (e) { n.chyba = String((e && e.message) || e).slice(0, 200); }
  n.ms = Date.now() - zacatek;
  out.nominatim = n;
  return out;
}

module.exports = { klic, zjednodus, prstenec, pocetObyvatel, lookup, diagnostika,
  najdiOkres, najdiHranici, proOblast, proOblastTed, zajisti, zajistiNaPozadi, oblasti, proKlice,
  prevedStaraUzemi, prevodNaPozadi, sousedi, sousediTed, tezisteObrysu, bodVen, BODU_MAX };
