// =============================================================================
// HolyOS — Celorepublikový generátor předjednaných míst pro prádlomat
// =============================================================================
// Projede česká města (GeoNames), u každého spočítá kapacitu (populace ÷ 15 000),
// odečte naše už provozované prádlomaty (KML „WHERE WE LAUNDRY") i už založená
// předjednaná místa, a pro chybějící počet najde konkrétní kandidátní body přes
// vyhledávač (Overpass: supermarkety, benzínky, myčky, výdejní boxy…).
//
// Spuštění (z kořene projektu):
//   node scripts/generate-cz-spots.js                 # DRY-RUN, jen vypíše plán
//   node scripts/generate-cz-spots.js --commit        # založí a ZVEŘEJNÍ místa
//   node scripts/generate-cz-spots.js --commit --draft  # založí jako rozpracované
// Volby: --min-pop=8000  --cap=2  --radius=15  --per-100k=  --max-total=500
//        --limit-cities=0 (0 = všechna)
// Vyžaduje env: GEONAMES_USERNAME, (ANTHROPIC nepotřeba). Google KML musí být
// dostupný (pouštěj lokálně, ne z Railway, kde bývá blokovaný).
// =============================================================================

require('dotenv').config();
const { prisma } = require('../config/database');
const finder = require('../services/spots/finder');

// ─── Parametry ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const COMMIT = has('--commit');
const AS_DRAFT = has('--draft');
const MIN_POP = parseInt(val('min-pop', '8000'), 10);
const CAP_PER_CITY = parseInt(val('cap', '0'), 10);          // tvrdý strop na město (0 = řídí se faktorem)
const FACTOR = parseFloat(val('factor', '1.3'));            // cíl = kapacita × faktor
const RADIUS_KM = parseInt(val('radius', '15'), 10);
const PEOPLE_PER = 15000;                                    // obyvatel na 1 prádlomat (kapacita)
const MAX_TOTAL = parseInt(val('max-total', '5000'), 10);
const LIMIT_CITIES = parseInt(val('limit-cities', '0'), 10);
const DEDUP_M = 700;                                          // min. odstup bodů

function distKm(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function distM(la1, lo1, la2, lo2) { return distKm(la1, lo1, la2, lo2) * 1000; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DB operace odolná proti výpadku spojení (Railway zavírá idle spojení) — reconnect + retry.
async function dbRetry(fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String((e && e.message) || '');
      const transient = /closed the connection|ConnectionReset|10054|terminating|Io error|ECONNRESET|Timed out|Can't reach/i.test(msg);
      if (i < tries - 1 && transient) {
        try { await prisma.$disconnect(); } catch (_) {}
        await sleep(2000);
        try { await prisma.$connect(); } catch (_) {}
        continue;
      }
      throw e;
    }
  }
}

// ─── Naše provozované prádlomaty (KML) ───────────────────────────────────────
async function fetchOperating() {
  const mid = process.env.KDEPEREME_MYMAPS_MID || '1kTO9nPigGvqmmEhm_iTcW2z9LkJYgmY';
  const url = 'https://www.google.com/maps/d/kml?forcekml=1&mid=' + mid;
  let xml = '';
  try { const r = await fetch(url, { headers: { 'User-Agent': 'HolyOS-SpotGen/1.0' } }); if (r.ok) xml = await r.text(); } catch (_) {}
  const out = [];
  const re = /<coordinates>([\s\S]*?)<\/coordinates>/g; let m;
  while ((m = re.exec(xml))) { const p = m[1].trim().split(','); const lon = parseFloat(p[0]), lat = parseFloat(p[1]); if (isFinite(lat) && isFinite(lon)) out.push({ lat, lon }); }
  return out;
}

// ─── Česká města s populací (GeoNames) ───────────────────────────────────────
async function fetchCzCities() {
  const user = process.env.GEONAMES_USERNAME;
  if (!user) throw new Error('Chybí GEONAMES_USERNAME v env.');
  const url = 'https://secure.geonames.org/searchJSON?country=CZ&featureClass=P&cities=cities5000'
    + '&maxRows=1000&orderby=population&username=' + encodeURIComponent(user);
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const j = await r.json();
  const list = Array.isArray(j.geonames) ? j.geonames : [];
  return list.map((g) => ({ name: g.name, pop: parseInt(g.population, 10) || 0, lat: Number(g.lat), lon: Number(g.lng) }))
    .filter((c) => c.pop > 0 && isFinite(c.lat));
}

async function main() {
  console.log('== Generátor předjednaných míst — celá ČR ==');
  console.log('Režim:', COMMIT ? (AS_DRAFT ? 'COMMIT (draft)' : 'COMMIT (zveřejnit)') : 'DRY-RUN (jen plán)');
  console.log('min-pop=' + MIN_POP, 'cap/město=' + CAP_PER_CITY, 'radius=' + RADIUS_KM + 'km', 'max-total=' + MAX_TOTAL, '\n');

  const cfgRow = await prisma.appSetting.findUnique({ where: { key: 'pradlomat.finder_config' } });
  let cfg = {}; if (cfgRow && cfgRow.value) { try { cfg = JSON.parse(cfgRow.value); } catch (_) {} }
  // Ve velkých městech chceme hodně kandidátů (pipeline) — zvedni strop hledání.
  cfg.max_candidates = Math.max(Number(cfg.max_candidates) || 60, 500);

  const operating = await fetchOperating();
  console.log('Provozovaných prádlomatů (KML):', operating.length);

  const existingSpots = (await dbRetry(() => prisma.pradlomatSpot.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
    select: { latitude: true, longitude: true },
  }))).map((s) => ({ lat: Number(s.latitude), lon: Number(s.longitude) }));
  console.log('Už založených míst:', existingSpots.length);

  let cities = await fetchCzCities();
  cities = cities.filter((c) => c.pop >= MIN_POP);
  if (LIMIT_CITIES > 0) cities = cities.slice(0, LIMIT_CITIES);
  console.log('Měst k vyhodnocení (pop ≥ ' + MIN_POP + '):', cities.length, '\n');

  const placed = []; // nově naplánované body (i pro dedup mezi městy)
  let totalCreated = 0;

  for (const c of cities) {
    if (totalCreated >= MAX_TOTAL) { console.log('Dosažen max-total, končím.'); break; }
    const capacity = Math.round(c.pop / PEOPLE_PER);
    const target = Math.round(capacity * FACTOR);                 // cíl počtu míst ve městě
    const opNear = operating.filter((o) => distKm(c.lat, c.lon, o.lat, o.lon) <= RADIUS_KM).length;
    const spotNear = existingSpots.concat(placed).filter((s) => distKm(c.lat, c.lon, s.lat, s.lon) <= RADIUS_KM).length;
    let need = target - opNear - spotNear;                        // kolik ještě chybí
    if (CAP_PER_CITY > 0) need = Math.min(need, CAP_PER_CITY);
    if (need <= 0) { continue; }

    // Kandidátní body z vyhledávače (1 Overpass dotaz na město).
    let res = null;
    try { res = await finder.searchArea(c.name + ', Česko', cfg); } catch (e) { console.log('  ! ' + c.name + ': ' + e.message); }
    await sleep(1500); // šetři Overpass
    const cands = (res && Array.isArray(res.candidates)) ? res.candidates : [];
    if (!cands.length) { console.log('· ' + c.name + ' (kapacita ' + capacity + ' × ' + FACTOR + ' = cíl ' + target + ', naše ' + opNear + ') → chybí ' + need + ', ale žádní kandidáti'); continue; }

    // Vezmi tolik NEJLEPŠÍCH kandidátů, kolik chybí do cíle (dedup na 700 m).
    const minScore = Number(cfg.min_score) || 55;
    let pool = cands.filter((c2) => c2.score == null || c2.score >= minScore);
    if (!pool.length) pool = cands;

    const chosen = [];
    for (const cand of pool) {
      if (chosen.length >= need || totalCreated + chosen.length >= MAX_TOTAL) break;
      const near = operating.concat(existingSpots, placed, chosen)
        .some((p) => distM(cand.lat, cand.lon, p.lat, p.lon) < DEDUP_M);
      if (near) continue;
      chosen.push(cand);
    }
    if (!chosen.length) continue;

    console.log('▶ ' + c.name + ' (kapacita ' + capacity + ' × ' + FACTOR + ' = cíl ' + target + ', naše ' + opNear + ', plán ' + spotNear + ') → zakládám ' + chosen.length + '/' + need);
    for (const cand of chosen) {
      placed.push({ lat: cand.lat, lon: cand.lon });
      const title = (cand.name || 'Připravená lokalita') + ' – ' + c.name;
      console.log('    • ' + title + '  [' + cand.lat.toFixed(4) + ',' + cand.lon.toFixed(4) + ']  skóre ' + cand.score);
      if (COMMIT) {
        const code = await uniqueCode(prisma, c.name + '-' + (cand.shop || 'misto'));
        const m = cand.metrics || {};
        await dbRetry(() => prisma.pradlomatSpot.create({
          data: {
            code, title: title.slice(0, 200),
            status: AS_DRAFT ? 'draft' : 'published',
            is_public: !AS_DRAFT,
            city: c.name.slice(0, 120), country: 'CZ',
            latitude: cand.lat, longitude: cand.lon,
            has_parking: !!(m.parking && m.parking.count > 0),
            parking_distance_m: (m.parking && m.parking.nearest_m != null) ? Math.round(m.parking.nearest_m) : null,
            population: res.population != null ? Math.round(res.population) : null,
            anchor_count: m.anchors ? m.anchors.count : null,
            competition_count: m.competition ? m.competition.count : null,
            score: cand.score != null ? cand.score : null,
            internal_notes: 'Auto-generováno (celá ČR) ' + new Date().toISOString().slice(0, 10),
          },
        }));
        totalCreated += 1;
      } else { totalCreated += 1; }
    }
  }

  console.log('\n== Hotovo ==');
  console.log((COMMIT ? 'Založeno' : 'Naplánováno (dry-run)') + ' míst: ' + totalCreated);
  if (!COMMIT) console.log('Pro skutečné založení a zveřejnění spusť znovu s  --commit');
  await prisma.$disconnect();
}

// unikátní kód (slug + přípona)
async function uniqueCode(prisma, base) {
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'misto';
  let code = slug(base), i = 1;
  while (await dbRetry(() => prisma.pradlomatSpot.findUnique({ where: { code }, select: { id: true } }))) { i += 1; code = slug(base) + '-' + i; }
  return code;
}

main().catch((e) => { console.error('CHYBA:', e && e.message); process.exit(1); });
