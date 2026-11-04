// =============================================================================
// Laundromats Milionář — herní API (pradlomaty.info/game)
// =============================================================================
// Hra je VEŘEJNÁ, takže tyhle routy záměrně nemají requireAuth (stejně jako
// /api/ai chat nebo veřejné stránky cesty). Místo přihlášení je chrání limiter
// a to, že nic nezapisují — jen čtou veřejná data z OpenStreetMap.
//
// Místa k podnikání se berou ze stejného hledače, který pohání obchodní nástroj
// „Najít místo" (services/spots/finder.js). Hráč tedy hledá SKUTEČNÁ místa se
// skutečným skóre — benzínky, obchodní domy, myčky — a hra z toho počítá výnos.
//
// Co se ven NEPOSÍLÁ: kontaktní údaje reálných provozoven (telefon, e-mail, web,
// provozovatel, adresa). Ty hledač vrací pro interní použití, do veřejné hry nepatří.

const express = require('express');
const router = express.Router();
const finder = require('../services/spots/finder');

// ─── Limiter (v paměti) ──────────────────────────────────────────────────────
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now); hits.set(key, a);
  if (hits.size > 5000) { for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); }
  return a.length > max;
}
const ipOf = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || '').trim();

// ─── Oblasti k prozkoumání ───────────────────────────────────────────────────
// Pevný seznam, ať hráč nemusí nic psát a ať se dá ladit obtížnost. Cena průzkumu
// roste s velikostí oblasti — velká města mají víc míst, ale i dražší nájmy.
const AREAS = [
  { id: 'praha', name: 'Praha', query: 'Praha', lat: 50.0755, lon: 14.4378, size: 'velkoměsto', cost: 200000 },
  { id: 'brno', name: 'Brno', query: 'Brno', lat: 49.1951, lon: 16.6068, size: 'velkoměsto', cost: 160000 },
  { id: 'ostrava', name: 'Ostrava', query: 'Ostrava', lat: 49.8209, lon: 18.2625, size: 'velkoměsto', cost: 150000 },
  { id: 'plzen', name: 'Plzeň', query: 'Plzeň', lat: 49.7384, lon: 13.3736, size: 'velké město', cost: 85000 },
  { id: 'liberec', name: 'Liberec', query: 'Liberec', lat: 50.7663, lon: 15.0543, size: 'velké město', cost: 75000 },
  { id: 'olomouc', name: 'Olomouc', query: 'Olomouc', lat: 49.5938, lon: 17.2509, size: 'velké město', cost: 75000 },
  { id: 'hradec', name: 'Hradec Králové', query: 'Hradec Králové', lat: 50.2104, lon: 15.8252, size: 'velké město', cost: 105000 },
  { id: 'pardubice', name: 'Pardubice', query: 'Pardubice', lat: 50.0343, lon: 15.7812, size: 'velké město', cost: 85000 },
  { id: 'zlin', name: 'Zlín', query: 'Zlín', lat: 49.2265, lon: 17.6686, size: 'město', cost: 75000 },
  { id: 'budejovice', name: 'České Budějovice', query: 'České Budějovice', lat: 48.9745, lon: 14.4743, size: 'velké město', cost: 105000 },
  { id: 'usti', name: 'Ústí nad Labem', query: 'Ústí nad Labem', lat: 50.6607, lon: 14.0323, size: 'město', cost: 75000 },
  { id: 'kladno', name: 'Kladno', query: 'Kladno', lat: 50.1477, lon: 14.1028, size: 'město', cost: 85000 },
  { id: 'jihlava', name: 'Jihlava', query: 'Jihlava', lat: 49.3961, lon: 15.5912, size: 'město', cost: 80000 },
  { id: 'karlovy-vary', name: 'Karlovy Vary', query: 'Karlovy Vary', lat: 50.2309, lon: 12.8713, size: 'město', cost: 80000 },
  { id: 'teplice', name: 'Teplice', query: 'Teplice', lat: 50.6404, lon: 13.8245, size: 'město', cost: 75000 },
  { id: 'kolin', name: 'Kolín', query: 'Kolín', lat: 50.0280, lon: 15.2003, size: 'menší město', cost: 55000 },
  { id: 'trebic', name: 'Třebíč', query: 'Třebíč', lat: 49.2149, lon: 15.8819, size: 'menší město', cost: 50000 },
  { id: 'znojmo', name: 'Znojmo', query: 'Znojmo', lat: 48.8555, lon: 16.0488, size: 'menší město', cost: 50000 },
  { id: 'trutnov', name: 'Trutnov', query: 'Trutnov', lat: 50.5608, lon: 15.9129, size: 'menší město', cost: 45000 },
  { id: 'sumperk', name: 'Šumperk', query: 'Šumperk', lat: 49.9653, lon: 16.9706, size: 'menší město', cost: 45000 },
];
const AREA_BY_ID = {}; AREAS.forEach((a) => { AREA_BY_ID[a.id] = a; });

router.get('/areas', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ areas: AREAS.map((a) => ({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, size: a.size, cost: a.cost })) });
});

// ─── Průzkum oblasti ─────────────────────────────────────────────────────────
// Výsledek držíme 6 hodin v paměti; samotný hledač si navíc cachuje Overpass na 24 h,
// takže opakovaný průzkum stejného města už na OpenStreetMap vůbec nejde.
const scoutCache = new Map();
const SCOUT_TTL = 6 * 3600e3;

// Z nálezu hledače uděláme herní místo. Kontakty reálných firem zahazujeme.
function toSpot(c, i, areaId) {
  const m = c.metrics || {};
  return {
    id: areaId + '-' + i,
    lat: Math.round(c.lat * 1e5) / 1e5,
    lon: Math.round(c.lon * 1e5) / 1e5,
    name: c.name || 'Místo',
    kind: c.shop || null,
    score: Math.round(c.score || 0),
    verdict: c.verdict || null,
    parking: m.parking != null ? m.parking : null,
    competition: m.competition != null ? m.competition : null,
    anchors: m.anchors != null ? m.anchors : null,
  };
}

router.get('/scout/:areaId', async (req, res, next) => {
  try {
    const area = AREA_BY_ID[String(req.params.areaId || '')];
    if (!area) return res.status(404).json({ error: 'Takovou oblast neznám.' });
    if (rateLimited('game:' + ipOf(req), 20, 10 * 60e3)) {
      return res.status(429).json({ error: 'Moc rychle po sobě. Dej tomu chvilku.' });
    }
    const hit = scoutCache.get(area.id);
    if (hit && Date.now() - hit.at < SCOUT_TTL) {
      return res.set('Cache-Control', 'public, max-age=600').json(hit.data);
    }
    const r = await finder.searchArea(area.query, {
      // Ve hře chceme i benzínky a myčky, ne jen obchodní domy — hráč má co hledat.
      candidate_types: ['supermarket', 'hypermarket', 'mall', 'department_store', 'fuel', 'car_wash'],
      max_candidates: 40,
    });
    if (r && r.error) return res.status(503).json({ error: r.error });
    const spots = (r.candidates || []).map((c, i) => toSpot(c, i, area.id));
    const data = {
      area: { id: area.id, name: area.name, lat: area.lat, lon: area.lon },
      population: r.population || null,
      spots,
    };
    scoutCache.set(area.id, { at: Date.now(), data });
    res.set('Cache-Control', 'public, max-age=600').json(data);
  } catch (err) { next(err); }
});

module.exports = router;
