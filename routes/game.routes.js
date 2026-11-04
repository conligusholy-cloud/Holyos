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
// stejný hledač jako obchodní nástroj (services/spots/finder.js).
//
// POZOR NA ČAS: hledač tahá data z OpenStreetMap přes Overpass a první dotaz na
// nové město klidně trvá minutu i víc. Proto se na odpověď NEČEKÁ — požadavek
// nastartuje úlohu na pozadí a hned vrátí 202 { pending: true }. Klient se pak
// doptává, dokud není hotovo. Jakmile úloha doběhne, výsledek je v cache a další
// hledání téhož města je okamžité.
function normQuery(q) {
  return String(q || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}
const scoutJobs = new Map();
const JOB_TTL = 5 * 60e3;
function cleanJobs() {
  const now = Date.now();
  for (const [k, j] of scoutJobs) if (now - j.at > JOB_TTL) scoutJobs.delete(k);
}
async function runScout(query, key, job) {
  try {
    const r = await finder.searchArea(query, {
      // Ve hře chceme i benzínky a myčky, ne jen obchodní domy — hráč má co hledat.
      candidate_types: ['supermarket', 'hypermarket', 'mall', 'department_store', 'fuel', 'car_wash'],
      max_candidates: 40,
    });
    if (r && r.error) { job.state = 'error'; job.error = r.error; return; }
    const spots = (r.candidates || []).map((c, i) => toSpot(c, i, key.replace(/[^a-z0-9]+/g, '-')));
    const data = {
      area: {
        id: key,
        name: (r.area && r.area.display_name ? String(r.area.display_name).split(',')[0].trim() : query),
        lat: r.area ? r.area.lat : null,
        lon: r.area ? r.area.lon : null,
      },
      population: r.population || null,
      spots,
    };
    scoutCache.set(key, { at: Date.now(), data });
    job.state = 'done';
  } catch (e) {
    job.state = 'error';
    job.error = 'Hledání se nepovedlo: ' + (e && e.message ? e.message : 'neznámá chyba');
  }
}

router.get('/scout', async (req, res, next) => {
  try {
    const q = normQuery(req.query.q);
    if (q.length < 2) return res.status(400).json({ error: 'Napiš jméno města.' });
    if (!/^[\p{L}\p{N} .,'\-]+$/u.test(q)) return res.status(400).json({ error: 'Tohle jako jméno města nevypadá.' });
    const key = q.toLowerCase();

    const hit = scoutCache.get(key);
    if (hit && Date.now() - hit.at < SCOUT_TTL) {
      return res.set('Cache-Control', 'public, max-age=600').json(hit.data);
    }
    cleanJobs();
    let job = scoutJobs.get(key);
    if (job && job.state === 'done') { scoutJobs.delete(key); return res.status(503).json({ error: 'Zkus to prosím ještě jednou.' }); }
    if (job && job.state === 'error') { scoutJobs.delete(key); return res.status(503).json({ error: job.error }); }
    if (!job) {
      // Nová úloha se počítá do limitu; doptávání na běžící úlohu ne, jinak by si hráč limit vyčerpal čekáním.
      if (rateLimited('game:' + ipOf(req), 20, 10 * 60e3)) {
        return res.status(429).json({ error: 'Moc rychle po sobě. Dej tomu chvilku.' });
      }
      job = { at: Date.now(), state: 'running' };
      scoutJobs.set(key, job);
      runScout(q, key, job);
    }
    res.set('Cache-Control', 'no-store').status(202).json({ pending: true, waited_ms: Date.now() - job.at });
  } catch (err) { next(err); }
});

module.exports = router;
