// =============================================================================
// HolyOS — Vyhledávač lokalit pro prádlomat (AI + OpenStreetMap)
// =============================================================================
// Najde v zadané oblasti kandidátní místa vhodná pro venkovní samoobslužný
// prádlomat a ohodnotí je. Datové zdroje jsou zdarma:
//   • Nominatim  — geokódování oblasti (bounding box).
//   • Overpass   — JEDEN dotaz na celou oblast: retail „tahouni provozu"
//                  (supermarkety…), parkoviště a KONKURENCE (prádelny/čistírny).
//   • GeoNames   — spádová populace (fallback OSM), počítá se 1× na oblast.
// Skóre je deterministické podle konfigurovatelných vah/poloměrů, takže plošné
// hledání NESTOJÍ žádné AI tokeny. Claude report se pouští jen na vyžádání
// u konkrétního bodu (analyzePoint).
// =============================================================================

// ─── Konfigurace (výchozí) ───────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  parking_radius: 250,        // m — parkoviště v bezprostřední blízkosti
  competition_radius: 1500,   // m — okruh, kde nechceme konkurenci
  anchor_radius: 400,         // m — okruh pro „tahouny provozu"
  population_radius_km: 10,   // km — spádová populace
  min_population: 8000,       // práh spádové populace
  candidate_types: ['supermarket', 'hypermarket', 'mall', 'department_store'],
  weights: { parking: 30, competition: 30, population: 20, anchors: 20 },
  min_score: 55,              // práh „vhodné"
  max_candidates: 60,         // strop kandidátů na jedno hledání
  people_per_pradlomat: 15000,// obyvatel na 1 prádlomat (přepočet kapacity oblasti)
};

// Odfiltruje null/undefined/NaN, aby prázdné pole z formuláře nepřepsalo výchozí.
function clean(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v === null || v === undefined) return;
    if (typeof v === 'number' && !Number.isFinite(v)) return;
    out[k] = v;
  });
  return out;
}
function mergeConfig(cfg) {
  cfg = cfg || {};
  const w = Object.assign({}, DEFAULT_CONFIG.weights, clean(cfg.weights || {}));
  const base = clean(cfg);
  delete base.weights; delete base.candidate_types;
  return Object.assign({}, DEFAULT_CONFIG, base, { weights: w,
    candidate_types: Array.isArray(cfg.candidate_types) && cfg.candidate_types.length ? cfg.candidate_types : DEFAULT_CONFIG.candidate_types });
}

// ─── HTTP helpery ────────────────────────────────────────────────────────────
function UA() { return 'HolyOS-SpotFinder/1.0 (+https://pradlomaty.info; tomas.holy@bestseries.cz)'; }
async function fetchJson(url, opts, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms || 12000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal, headers: { 'User-Agent': UA(), 'Accept': 'application/json' } }, opts || {}));
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(to); }
}
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ─── Geokódování oblasti → bounding box ──────────────────────────────────────
async function geocodeArea(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=' + encodeURIComponent(query);
  const j = await fetchJson(url);
  if (!Array.isArray(j) || !j.length) return null;
  const x = j[0];
  const bb = (x.boundingbox || []).map(Number); // [south, north, west, east]
  const lat = parseFloat(x.lat), lon = parseFloat(x.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let bbox = null;
  if (bb.length === 4 && bb.every(Number.isFinite)) bbox = { s: bb[0], n: bb[1], w: bb[2], e: bb[3] };
  // Pojistka na obří bbox (celý kraj/stát): omez na ~40 km kolem středu.
  if (bbox) {
    const maxDeg = 0.36; // ~40 km
    if ((bbox.n - bbox.s) > maxDeg || (bbox.e - bbox.w) > maxDeg) {
      const dLat = 0.18, dLon = 0.28;
      bbox = { s: lat - dLat, n: lat + dLat, w: lon - dLon, e: lon + dLon };
    }
  } else {
    bbox = { s: lat - 0.09, n: lat + 0.09, w: lon - 0.14, e: lon + 0.14 };
  }
  return { lat, lon, bbox, display_name: x.display_name || query,
    country_code: (x.address && x.address.country_code) || '' };
}

// ─── Overpass: jeden dotaz na celou oblast ───────────────────────────────────
const RETAIL_RX = 'supermarket|hypermarket|mall|department_store|wholesale|convenience';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Zkusí postupně několik veřejných Overpass mirrorů (rate-limit/timeout na jednom
// nemá shodit hledání). Vrací JSON, nebo null když selžou všechny.
async function overpass(query) {
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const j = await fetchJson(OVERPASS_ENDPOINTS[i], {
      method: 'POST',
      headers: { 'User-Agent': UA(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    }, 45000);
    if (j && Array.isArray(j.elements)) return j;
  }
  return null;
}
async function fetchAreaFeatures(bbox) {
  const bb = bbox.s + ',' + bbox.w + ',' + bbox.n + ',' + bbox.e;
  const q = '[out:json][timeout:90];('
    + 'nwr[shop~"^(' + RETAIL_RX + ')$"](' + bb + ');'
    + 'nwr[amenity=parking](' + bb + ');'
    + 'nwr[shop~"^(laundry|dry_cleaning)$"](' + bb + ');'
    + 'nwr[amenity=laundry](' + bb + ');'
    + ');out center 3000;';
  const j = await overpass(q);
  if (!j) return null; // Overpass selhal (rate-limit/timeout) — odlišit od „nic nenalezeno".
  const els = (j && j.elements) || [];
  const retail = [], parking = [], competition = [];
  els.forEach((e) => {
    const ll = e.center || e; if (ll.lat == null) return;
    const t = e.tags || {};
    const point = { lat: ll.lat, lon: ll.lon, name: t.name || t.brand || '', tags: t };
    if (t.amenity === 'parking') { parking.push(point); return; }
    if (t.shop === 'laundry' || t.shop === 'dry_cleaning' || t.amenity === 'laundry') { competition.push(point); return; }
    if (t.shop) { point.shop = t.shop; retail.push(point); }
  });
  return { retail, parking, competition };
}

// ─── Populace (GeoNames → OSM fallback), počítá se 1× na oblast ──────────────
async function geonamesPopulation(lat, lon, radiusKm) {
  const user = process.env.GEONAMES_USERNAME;
  if (!user) return null;
  const url = 'https://secure.geonames.org/findNearbyPlaceNameJSON?lat=' + lat + '&lng=' + lon
    + '&radius=' + radiusKm + '&maxRows=500&style=FULL&featureClass=P&username=' + encodeURIComponent(user);
  const j = await fetchJson(url, null, 12000);
  if (!j || !Array.isArray(j.geonames)) return null;
  let total = 0;
  j.geonames.forEach((g) => { const p = parseInt(g.population, 10); if (Number.isFinite(p) && p > 0) total += p; });
  return total > 0 ? { population: total, source: 'GeoNames' } : null;
}
async function osmPopulation(lat, lon, radiusM) {
  const q = '[out:json][timeout:25];node(around:' + radiusM + ',' + lat + ',' + lon + ')[place][population];out 200;';
  const j = await overpass(q);
  const els = (j && j.elements) || [];
  let total = 0;
  els.forEach((e) => { const p = parseInt(String((e.tags && e.tags.population) || '').replace(/[^0-9]/g, ''), 10); if (Number.isFinite(p) && p > 0) total += p; });
  return { population: total, source: 'OpenStreetMap' };
}
async function populationAt(lat, lon, radiusKm) {
  const gn = await geonamesPopulation(lat, lon, radiusKm);
  if (gn) return gn;
  return osmPopulation(lat, lon, radiusKm * 1000);
}

// ─── Metriky bodu z předstažených prvků ──────────────────────────────────────
function pointMetrics(lat, lon, feat, cfg) {
  let parkCount = 0, parkNearest = null;
  feat.parking.forEach((p) => { const d = haversineM(lat, lon, p.lat, p.lon); if (d <= cfg.parking_radius) { parkCount++; if (parkNearest == null || d < parkNearest) parkNearest = d; } });
  let compCount = 0, compNearest = null; const compList = [];
  feat.competition.forEach((p) => { const d = haversineM(lat, lon, p.lat, p.lon); if (d <= cfg.competition_radius) { compCount++; if (compNearest == null || d < compNearest) compNearest = d; compList.push({ name: p.name || 'Prádelna/čistírna', dist: d }); } });
  compList.sort((a, b) => a.dist - b.dist);
  let anchorCount = 0; const anchorList = [];
  feat.retail.forEach((p) => { const d = haversineM(lat, lon, p.lat, p.lon); if (d > 0 && d <= cfg.anchor_radius) { anchorCount++; anchorList.push({ name: p.name || p.shop, type: p.shop, dist: d }); } });
  anchorList.sort((a, b) => a.dist - b.dist);
  return {
    parking: { count: parkCount, nearest_m: parkNearest },
    competition: { count: compCount, nearest_m: compNearest, list: compList.slice(0, 6) },
    anchors: { count: anchorCount, list: anchorList.slice(0, 8) },
  };
}

// ─── Deterministické skóre 0–100 ─────────────────────────────────────────────
function scoreMetrics(m, population, cfg) {
  const w = cfg.weights;
  // Parkování: aspoň jedno = plný bod, více = beze změny (klíčové je „je / není".)
  const sPark = m.parking.count >= 1 ? 1 : 0;
  // Konkurence: nic = 1; každá v okruhu ubírá; nejbližší blíž = horší.
  let sComp = 1;
  if (m.competition.count > 0) {
    sComp = Math.max(0, 1 - m.competition.count * 0.5);
    if (m.competition.nearest_m != null && m.competition.nearest_m < cfg.competition_radius * 0.4) sComp = Math.max(0, sComp - 0.2);
  }
  // Populace: lineárně k 1,8× prahu.
  const target = Math.max(1, cfg.min_population * 1.8);
  const sPop = population != null ? Math.max(0, Math.min(1, population / target)) : 0;
  // Tahouni provozu: 4+ = plný bod.
  const sAnchor = Math.min(1, m.anchors.count / 4);

  const wsum = (w.parking + w.competition + w.population + w.anchors) || 1;
  const score = Math.round(((sPark * w.parking) + (sComp * w.competition) + (sPop * w.population) + (sAnchor * w.anchors)) / wsum * 100);
  const breakdown = {
    parking: { score: Math.round(sPark * 100), weight: w.parking },
    competition: { score: Math.round(sComp * 100), weight: w.competition },
    population: { score: Math.round(sPop * 100), weight: w.population },
    anchors: { score: Math.round(sAnchor * 100), weight: w.anchors },
  };
  let verdict = 'Nevhodné';
  if (score >= cfg.min_score) verdict = 'Vhodné';
  else if (score >= Math.max(30, cfg.min_score - 20)) verdict = 'Hraniční';
  return { score: Math.max(0, Math.min(100, score)), verdict, breakdown };
}

// ─── Shlukování kandidátů (retail parky = jeden bod) ─────────────────────────
function clusterPoints(points, minGapM) {
  const out = [];
  points.forEach((p) => {
    const near = out.find((o) => haversineM(o.lat, o.lon, p.lat, p.lon) < minGapM);
    if (near) { if (!near.name && p.name) near.name = p.name; return; }
    out.push({ lat: p.lat, lon: p.lon, name: p.name, shop: p.shop });
  });
  return out;
}

// ─── Hlavní: vyhledání kandidátů v oblasti ───────────────────────────────────
async function searchArea(query, rawCfg) {
  const cfg = mergeConfig(rawCfg);
  const area = await geocodeArea(query);
  if (!area) return { error: 'Oblast se nepodařilo najít.' };

  const feat = await fetchAreaFeatures(area.bbox);
  if (!feat) {
    return { error: 'OpenStreetMap (Overpass) je právě přetížený nebo nedostupný. Zkus to prosím za chvíli znovu.' };
  }
  if (!feat.retail.length) {
    return { area: area, config: cfg, candidates: [], population: null,
      note: 'V oblasti se nenašli žádní vhodní tahouni provozu (supermarkety apod.).' };
  }

  // Kandidáti = retail zvolených typů, shluknuté.
  const wanted = new Set(cfg.candidate_types);
  let cands = feat.retail.filter((r) => wanted.has(r.shop));
  cands = clusterPoints(cands, 150).slice(0, cfg.max_candidates);

  // Populace 1× na oblast (spádová populace města je pro všechny body podobná).
  const pop = await populationAt(area.lat, area.lon, cfg.population_radius_km);
  const population = pop ? pop.population : null;

  const candidates = cands.map((c) => {
    const m = pointMetrics(c.lat, c.lon, feat, cfg);
    const sc = scoreMetrics(m, population, cfg);
    return {
      lat: c.lat, lon: c.lon,
      name: c.name || (c.shop ? shopLabel(c.shop) : 'Místo'),
      shop: c.shop || null,
      metrics: m, score: sc.score, verdict: sc.verdict, breakdown: sc.breakdown,
      suitable: sc.score >= cfg.min_score && (population == null || population >= cfg.min_population),
    };
  }).sort((a, b) => b.score - a.score);

  return {
    area: { lat: area.lat, lon: area.lon, display_name: area.display_name, bbox: area.bbox },
    config: cfg,
    population: population,
    population_source: pop ? pop.source : null,
    counts: { retail: feat.retail.length, parking: feat.parking.length, competition: feat.competition.length, candidates: candidates.length },
    candidates: candidates,
  };
}

function shopLabel(s) {
  const m = { supermarket: 'Supermarket', hypermarket: 'Hypermarket', mall: 'Obchodní centrum', department_store: 'Obchodní dům', wholesale: 'Velkoobchod', convenience: 'Večerka' };
  return m[s] || s;
}

// ─── Analýza jednoho bodu + Claude report (na vyžádání) ──────────────────────
async function analyzePoint(lat, lon, rawCfg, opts) {
  const cfg = mergeConfig(rawCfg);
  opts = opts || {};
  const feat = await fetchAreaFeatures({
    s: lat - 0.03, n: lat + 0.03, w: lon - 0.045, e: lon + 0.045, // ~3–5 km kolem bodu
  });
  const m = pointMetrics(lat, lon, feat || { retail: [], parking: [], competition: [] }, cfg);
  const pop = await populationAt(lat, lon, cfg.population_radius_km);
  const population = pop ? pop.population : null;
  const sc = scoreMetrics(m, population, cfg);

  let ai = null;
  if (opts.ai !== false) ai = await aiReport({ lat, lon, metrics: m, population, population_source: pop ? pop.source : null, score: sc.score, verdict: sc.verdict, config: cfg });
  return { metrics: m, population, population_source: pop ? pop.source : null, score: sc.score, verdict: sc.verdict, breakdown: sc.breakdown, ai };
}

async function aiReport(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.SPOT_FINDER_MODEL || process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi analytik lokality pro venkovní samoobslužný prádlomat (Compounder Machine). '
      + 'Z dodaných dat o okolí bodu napiš stručné věcné zhodnocení vhodnosti pro umístění prádlomatu. '
      + 'Klíčové signály: parkování v bezprostřední blízkosti (nutnost), ŽÁDNÁ konkurenční prádelna/čistírna v okolí (competition.count = 0 je ideál), dostatečná spádová populace a přítomnost tahounů provozu (supermarkety apod.). '
      + 'Odpověz POUZE platným JSON bez markdownu: {"verdict":"<2-4 slova>","scorePct":<0-100>,"summary":"<2-4 věty>","factors":[{"label":"<krátce>","value":"<krátce>","good":<true|false>}],"recommendation":"<1-2 věty>"}. '
      + 'Piš česky.';
    const usr = 'Data o bodu (JSON):\n' + JSON.stringify(facts);
    const msg = await client.messages.create({ model, max_tokens: 700, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    const j = JSON.parse(text);
    return {
      verdict: String(j.verdict || '').slice(0, 60),
      scorePct: Math.max(0, Math.min(100, Math.round(Number(j.scorePct) || 0))),
      summary: String(j.summary || '').slice(0, 1200),
      factors: Array.isArray(j.factors) ? j.factors.slice(0, 8).map((f) => ({ label: String(f.label || '').slice(0, 60), value: String(f.value || '').slice(0, 80), good: !!f.good })) : [],
      recommendation: String(j.recommendation || '').slice(0, 600),
    };
  } catch (e) { return null; }
}

// ─── Analýza spádové oblasti (kružítko kolem města) ──────────────────────────
// Obce s populací v okruhu (GeoNames → fallback OSM). Vrací i vzdálenost.
async function placesWithin(lat, lon, radiusKm) {
  const user = process.env.GEONAMES_USERNAME;
  if (user) {
    const url = 'https://secure.geonames.org/findNearbyPlaceNameJSON?lat=' + lat + '&lng=' + lon
      + '&radius=' + radiusKm + '&maxRows=500&style=FULL&featureClass=P&username=' + encodeURIComponent(user);
    const j = await fetchJson(url, null, 15000);
    if (j && Array.isArray(j.geonames)) {
      const places = j.geonames.map((g) => ({
        name: g.name, lat: Number(g.lat), lon: Number(g.lng),
        population: parseInt(g.population, 10) || 0,
        dist_km: g.distance != null ? Math.round(Number(g.distance) * 10) / 10 : null,
      })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      return { places, source: 'GeoNames' };
    }
  }
  // Fallback: OSM place nodes s populací.
  const q = '[out:json][timeout:40];node(around:' + Math.round(radiusKm * 1000) + ',' + lat + ',' + lon + ')[place][population];out 500;';
  const j = await overpass(q);
  const els = (j && j.elements) || [];
  const places = els.map((e) => ({
    name: (e.tags && (e.tags.name || e.tags['name:en'])) || '?',
    lat: e.lat, lon: e.lon,
    population: parseInt(String((e.tags && e.tags.population) || '').replace(/[^0-9]/g, ''), 10) || 0,
    dist_km: Math.round(haversineM(lat, lon, e.lat, e.lon) / 100) / 10,
  })).filter((p) => Number.isFinite(p.lat) && p.population > 0);
  return { places, source: 'OpenStreetMap' };
}

async function analyzeArea(query, radiusKm, rawCfg, opts) {
  const cfg = mergeConfig(rawCfg);
  opts = opts || {};
  radiusKm = Number(radiusKm) > 0 ? Number(radiusKm) : (cfg.population_radius_km || 15);
  if (radiusKm > 60) radiusKm = 60;
  const area = await geocodeArea(query);
  if (!area) return { error: 'Oblast se nepodařilo najít.' };
  const pw = await placesWithin(area.lat, area.lon, radiusKm);
  const places = (pw.places || []).filter((p) => p.population > 0).sort((a, b) => b.population - a.population);
  if (!places.length && pw.source === 'OpenStreetMap' && !process.env.GEONAMES_USERNAME) {
    // OSM má populaci jen sporadicky — dej najevo, že chybí GeoNames.
  }
  const total = places.reduce((s, p) => s + p.population, 0);
  const areaKm2 = Math.PI * radiusKm * radiusKm;
  const density = areaKm2 > 0 ? Math.round(total / areaKm2) : null;

  // Kapacita oblasti: kolik prádlomatů uživí (přepočet obyvatel na 1 prádlomat)
  // a rozložení tohoto počtu na obce podle jejich populace (metoda největšího zbytku).
  const perP = Number(cfg.people_per_pradlomat) > 0 ? Number(cfg.people_per_pradlomat) : 15000;
  const recommended = perP > 0 ? Math.round(total / perP) : 0;
  let allocation = [];
  if (recommended > 0 && places.length) {
    const rows = places.map((p) => ({ name: p.name, population: p.population, dist_km: p.dist_km,
      units: Math.floor(p.population / perP), rem: (p.population % perP) / perP }));
    let rest = recommended - rows.reduce((s, r) => s + r.units, 0);
    if (rest > 0) {
      const byRem = rows.slice().sort((a, b) => b.rem - a.rem || b.population - a.population);
      for (let i = 0; i < byRem.length && rest > 0; i++) { byRem[i].units += 1; rest--; }
    }
    allocation = rows.filter((r) => r.units > 0)
      .sort((a, b) => b.units - a.units || b.population - a.population)
      .map((r) => ({ name: r.name, population: r.population, dist_km: r.dist_km, units: r.units }));
  }
  const capacity = { per_pradlomat: perP, recommended, allocation };

  let ai = null;
  if (opts.ai !== false) {
    ai = await areaReport({
      center: area.display_name, radius_km: radiusKm,
      total_population: total, density_per_km2: density,
      places_count: places.length,
      people_per_pradlomat: perP, recommended_pradlomats: recommended,
      top_places: places.slice(0, 12).map((p) => ({ name: p.name, population: p.population, dist_km: p.dist_km })),
    });
  }
  return {
    center: { lat: area.lat, lon: area.lon, display_name: area.display_name },
    radius_km: radiusKm, source: pw.source,
    total_population: total, density_per_km2: density,
    places_count: places.length,
    places: places.slice(0, 300),
    capacity,
    ai,
  };
}

async function areaReport(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.SPOT_FINDER_MODEL || process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi analytik spádové oblasti pro venkovní samoobslužný prádlomat. '
      + 'Dostaneš střed oblasti, poloměr (km), celkovou populaci v okruhu, hustotu (obyv./km²), doporučený počet prádlomatů (recommended_pradlomats, přepočet 1 na people_per_pradlomat obyvatel) a seznam největších obcí se vzdáleností. '
      + 'Napiš stručné zhodnocení spádové oblasti z pohledu potenciálu pro prádlomat: velikost a rozložení populace (koncentrovaná ve městě vs. rozptýlená), kolik prádlomatů oblast uživí a kam by je bylo rozumné rozmístit, dojezdovost. '
      + 'Odpověz POUZE platným JSON bez markdownu: {"summary":"<3-5 vět>","density_label":"<např. Vysoká/Střední/Nízká hustota>","recommendation":"<1-2 věty kam mířit>"}. Piš česky.';
    const usr = 'Data (JSON):\n' + JSON.stringify(facts);
    const msg = await client.messages.create({ model, max_tokens: 600, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    const j = JSON.parse(text);
    return {
      summary: String(j.summary || '').slice(0, 1200),
      density_label: String(j.density_label || '').slice(0, 40),
      recommendation: String(j.recommendation || '').slice(0, 600),
    };
  } catch (e) { return null; }
}

// ─── Analýza zákaznického potenciálu (AI report na lokalitu) ─────────────────
// Firmy/služby v okolí (Overpass, jeden dotaz) — pro segment B2B (ubytování, gastro…).
async function nearbyBusinesses(lat, lon, radiusM) {
  const q = '[out:json][timeout:60];('
    + 'nwr(around:' + radiusM + ',' + lat + ',' + lon + ')[tourism~"^(hotel|guest_house|apartment|hostel|motel|chalet|camp_site|caravan_site)$"];'
    + 'nwr(around:' + radiusM + ',' + lat + ',' + lon + ')[amenity~"^(restaurant|cafe|fast_food|pub|bar)$"];'
    + 'nwr(around:' + radiusM + ',' + lat + ',' + lon + ')[leisure=fitness_centre];'
    + 'nwr(around:' + radiusM + ',' + lat + ',' + lon + ')[shop~"^(beauty|hairdresser|massage)$"];'
    + ');out center 900;';
  const j = await overpass(q);
  if (!j) return null;
  const cats = { ubytovani: 0, kempy: 0, restaurace_gastro: 0, fitness: 0, salony_wellness: 0 };
  const examples = { ubytovani: [], restaurace_gastro: [] };
  (j.elements || []).forEach((e) => {
    const t = e.tags || {}; const nm = t.name || t.brand || '';
    if (t.tourism) {
      if (t.tourism === 'camp_site' || t.tourism === 'caravan_site') cats.kempy++;
      else { cats.ubytovani++; if (nm && examples.ubytovani.length < 8) examples.ubytovani.push(nm); }
    } else if (t.amenity) { cats.restaurace_gastro++; if (nm && examples.restaurace_gastro.length < 8) examples.restaurace_gastro.push(nm); }
    else if (t.leisure === 'fitness_centre') cats.fitness++;
    else if (t.shop) cats.salony_wellness++;
  });
  return { counts: cats, examples };
}

async function analyzePotential(lat, lon, rawCfg, opts) {
  const cfg = mergeConfig(rawCfg);
  opts = opts || {};
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: 'Lokalita nemá souřadnice.' };

  // 1) Populace + obce po dojezdových pásmech (aproximace km, GeoNames → OSM).
  const pw = await placesWithin(lat, lon, 20);
  const places = (pw.places || []).filter((p) => p.population > 0).sort((a, b) => (a.dist_km || 0) - (b.dist_km || 0));
  const rings = { r5: 0, r10: 0, r15: 0, r20: 0 };
  places.forEach((p) => { const d = p.dist_km == null ? 999 : p.dist_km; if (d <= 5) rings.r5 += p.population; else if (d <= 10) rings.r10 += p.population; else if (d <= 15) rings.r15 += p.population; else if (d <= 20) rings.r20 += p.population; });
  const totalPop = places.reduce((s, p) => s + p.population, 0);

  // 2) OSM okolí — parkoviště, tahouni, konkurenční prádelny/čistírny.
  const feat = await fetchAreaFeatures({ s: lat - 0.09, n: lat + 0.09, w: lon - 0.13, e: lon + 0.13 }); // ~10 km
  const m = pointMetrics(lat, lon, feat || { retail: [], parking: [], competition: [] }, cfg);
  const comp = (feat && feat.competition || []).map((p) => ({ name: p.name || 'Prádelna/čistírna', km: Math.round(haversineM(lat, lon, p.lat, p.lon) / 100) / 10 }))
    .filter((c) => c.km <= 20).sort((a, b) => a.km - b.km).slice(0, 12);

  // 3) Firmy/služby (B2B potenciál).
  const biz = await nearbyBusinesses(lat, lon, 12000);

  // 4) Provozované prádlomaty (kdepereme.cz) — vzdálenosti.
  const existing = Array.isArray(opts.existing) ? opts.existing : [];
  const exWithDist = existing.map((w) => ({ name: w.name, km: Math.round(haversineM(lat, lon, w.lat, w.lon) / 100) / 10 })).sort((a, b) => a.km - b.km);
  const nearestOwn = exWithDist[0] || null;

  const facts = {
    datum_analyzy: new Date().toISOString().slice(0, 10),
    lokalita: { lat, lon, adresa: opts.address || null, mesto: opts.city || null, typ_umisteni: opts.placeType || null, nazev: opts.name || null },
    parametry_pradlomatu: opts.machineParams || null,
    parkovani: { je_v_okoli: m.parking.count > 0, nejblizsi_m: m.parking.nearest_m, pocet_do_250m: m.parking.count },
    tahouni_provozu: { pocet_do_400m: m.anchors.count, priklady: m.anchors.list.map((a) => a.name || a.type).slice(0, 8) },
    populace: { celkem_do_20km: totalPop, pasma_priblizne: rings, zdroj: pw.source, nejvetsi_obce: places.slice(0, 14).map((p) => ({ nazev: p.name, obyvatel: p.population, km: p.dist_km })) },
    konkurence_osm: { pocet_do_20km: comp.length, nejblizsi_km: comp.length ? comp[0].km : null, seznam: comp },
    firmy_v_okoli_do_12km: biz ? biz.counts : null,
    firmy_priklady: biz ? biz.examples : null,
    provozovane_pradlomaty: { nejblizsi_km: nearestOwn ? nearestOwn.km : null, nejblizsi_nazev: nearestOwn ? nearestOwn.name : null, do_25km: exWithDist.filter((x) => x.km <= 25).slice(0, 12) },
    zdroje: {
      populace: pw.source === 'GeoNames' ? 'GeoNames (geonames.org)' : 'OpenStreetMap',
      firmy_konkurence: 'OpenStreetMap přes Overpass API',
      provozovane_pradlomaty: 'Google My Maps „WHERE WE LAUNDRY [EU]" (kdepereme.cz)',
    },
  };

  const report_md = await potentialReport(facts);
  return { facts, report_md, generated_at: new Date().toISOString() };
}

async function potentialReport(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.SPOT_POTENTIAL_MODEL || process.env.SPOT_FINDER_MODEL || process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi analytik zákaznického potenciálu pro venkovní samoobslužný prádlomat (18kg pračka + sušička, samoobsluha, non-stop). '
      + 'Dostaneš strukturovaná fakta o lokalitě (JSON). Vycházej POUZE z těchto dat a z obecně známých demografických poměrů ČR; nic si nevymýšlej a nepředstírej, že jsi lokalitu prověřil na místě. '
      + 'Data pocházejí z GeoNames (populace), OpenStreetMap/Overpass (firmy, konkurence) a Google My Maps kdepereme.cz (naše provozované prádlomaty) — u zdrojů uveď tyto názvy a datum z pole datum_analyzy. '
      + 'Kde chybí přímá data (např. věk 50+, počet domácností), použij standardní poměry ČR (populace 50+ ≈ 40 %, průměrná domácnost ≈ 2,3 osoby) a VÝSLOVNĚ to označ jako odhad. '
      + 'Jasně odlišuj OVĚŘENÁ FAKTA, ODHADY a NEOVĚŘENÉ PŘEDPOKLADY. '
      + 'Postupuj podle těchto bodů: 1) spádová oblast a populace (pásma 5/10/15/20 min ~ km, nezapočítávej lidi opakovaně), 2) tři skupiny zákazníků: A) firmy/podnikatelé/chataři (ubytování, gastro, wellness, úklid), B) lidé 50+, C) běžné domácnosti (peřiny, poruchy praček, spojení s nákupem), 3) konkurence a alternativy (i naše nejbližší provozované prádlomaty), 4) zhodnocení konkrétního umístění (parkování, viditelnost — co nejde ověřit na dálku, označ jako „ověřit na místě"), 5) transparentní výpočet potenciálu pro každou skupinu ve třech scénářích (konzervativní/střední/optimistický) s odhadem placených pracích cyklů/měsíc, sušení zvlášť, zvlášť první 3 měsíce / ustálený stav po 12 měsících / sezónní špičky, 6) obchodní doporučení (silná/průměrná/slabá/nelze rozhodnout; nosná skupina; očekávaná praní/měsíc konzervativně a středně; 3 rizika; co ověřit na místě; jak získat první zákazníky v každé skupině). '
      + 'Výstup je ČESKY v Markdownu a začíná krátkým ROZHODOVACÍM SHRNUTÍM (3–5 vět). '
      + 'Pak přidej: tabulku skupiny × scénáře (Markdown tabulka), popis spádové oblasti, seznam konkurentů, podrobný výpočet a na konci sekci „Zdroje" s názvy zdrojů a datem. Nepoužívej nadpis h1 (#), začni rovnou textem shrnutí.';
    const usr = 'Fakta o lokalitě (JSON):\n' + JSON.stringify(facts);
    const msg = await client.messages.create({ model, max_tokens: 4500, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    return text.trim() || null;
  } catch (e) { return null; }
}

module.exports = { DEFAULT_CONFIG, mergeConfig, searchArea, analyzePoint, geocodeArea, analyzeArea, analyzePotential };
