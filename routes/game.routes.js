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

// ─── Průzkum města ─────────────────────────────────────────────────────────
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

// Hledání v libovolném městě, které hráč napíše. Geokódování i vyhledání řeší
// stejný hledač jako obchodní nástroj; my jen hlídáme rozumný vstup a cache.
function normQuery(q) {
  return String(q || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}
async function scoutQuery(query, res) {
  const key = query.toLowerCase();
  const hit = scoutCache.get(key);
  if (hit && Date.now() - hit.at < SCOUT_TTL) {
    return res.set('Cache-Control', 'public, max-age=600').json(hit.data);
  }
  const r = await finder.searchArea(query, {
    // Ve hře chceme i benzínky a myčky, ne jen obchodní domy — hráč má co hledat.
    candidate_types: ['supermarket', 'hypermarket', 'mall', 'department_store', 'fuel', 'car_wash'],
    max_candidates: 40,
  });
  if (r && r.error) return res.status(503).json({ error: r.error });
  const spots = (r.candidates || []).map((c, i) => toSpot(c, i, key.replace(/[^a-z0-9]+/g, '-')));
  const data = {
    area: { id: key, name: (r.area && r.area.display_name ? String(r.area.display_name).split(',')[0].trim() : query),
      lat: r.area ? r.area.lat : null, lon: r.area ? r.area.lon : null },
    population: r.population || null,
    spots,
  };
  scoutCache.set(key, { at: Date.now(), data });
  res.set('Cache-Control', 'public, max-age=600').json(data);
}

// Napsané město: /api/game/scout?q=Kolín
router.get('/scout', async (req, res, next) => {
  try {
    const q = normQuery(req.query.q);
    if (q.length < 2) return res.status(400).json({ error: 'Napiš jméno města.' });
    if (!/^[\p{L}\p{N} .,'\-]+$/u.test(q)) return res.status(400).json({ error: 'Tohle jako jméno města nevypadá.' });
    if (rateLimited('game:' + ipOf(req), 20, 10 * 60e3)) {
      return res.status(429).json({ error: 'Moc rychle po sobě. Dej tomu chvilku.' });
    }
    await scoutQuery(q, res);
  } catch (err) { next(err); }
});

module.exports = router;
