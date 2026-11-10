// =============================================================================
// Laundromat Tycoon — herní API (pradlomaty.info/game)
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
const { prisma } = require('../config/database');
const crypto = require('crypto');

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

// ─── Trasa servisního auta ───────────────────────────────────────────────────
// GET /trasa?z=lat,lon&k=lat,lon → body cesty po silnici.
// Servisní auto ve hře nemá jezdit vzdušnou čarou přes pole a vodu. Trasu
// spočítá veřejný OSRM a výsledek si držíme v paměti — silnice se nemění a na
// stejnou dvojici se hra ptá znovu při každé poruše. Když router nevyjde,
// klient jede napřímo jako dřív, takže se tím hra nikdy nezasekne.
const TRASY = new Map();
const TRASA_MAX = 800;
const TRASA_BODU = 200;          // víc bodů autíčko na mapě stejně nevyužije
function trasaBodZ(s) {
  const d = String(s || '').split(',').map(Number);
  if (d.length !== 2 || !Number.isFinite(d[0]) || !Number.isFinite(d[1])) return null;
  if (Math.abs(d[0]) > 90 || Math.abs(d[1]) > 180) return null;
  return [Number(d[0].toFixed(5)), Number(d[1].toFixed(5))];
}
router.get('/trasa', async (req, res, next) => {
  try {
    const z = trasaBodZ(req.query.z), k = trasaBodZ(req.query.k);
    if (!z || !k) return res.status(400).json({ error: 'Chybí souřadnice.' });
    const klic = z.join(',') + ';' + k.join(',');
    if (TRASY.has(klic)) {
      return res.set('Cache-Control', 'public, max-age=86400')
        .json({ ok: true, ...TRASY.get(klic), cache: true });
    }
    if (rateLimited('trasa:' + ipOf(req), 60, 60e3)) {
      return res.status(429).json({ ok: false, duvod: 'moc dotazů' });
    }
    const url = 'https://router.project-osrm.org/route/v1/driving/'
      + z[1] + ',' + z[0] + ';' + k[1] + ',' + k[0] + '?overview=full&geometries=geojson';
    let j = null;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'LaundromatTycoon/1.0' },
        signal: AbortSignal.timeout(8000) });
      if (r.ok) j = await r.json();
    } catch (e) { /* router neodpověděl — pro hru to není chyba */ }
    const cesta = j && Array.isArray(j.routes) && j.routes[0];
    if (!cesta || !cesta.geometry || !Array.isArray(cesta.geometry.coordinates)) {
      return res.json({ ok: false, duvod: 'bez trasy' });
    }
    const sour = cesta.geometry.coordinates;
    const krok = Math.max(1, Math.ceil(sour.length / TRASA_BODU));
    const body = sour
      .filter((_, i) => i % krok === 0 || i === sour.length - 1)
      .map((c) => [Number(c[1].toFixed(5)), Number(c[0].toFixed(5))]);
    const out = { body, km: Math.round((cesta.distance || 0) / 1000) };
    TRASY.set(klic, out);
    // Nejstarší záznam ven, ať paměť neroste donekonečna.
    if (TRASY.size > TRASA_MAX) TRASY.delete(TRASY.keys().next().value);
    res.set('Cache-Control', 'public, max-age=86400').json({ ok: true, ...out });
  } catch (e) { next(e); }
});

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
    // Hledač vrací u každé metriky objekt { count, nearest_m, … } — do hry stačí počty.
    parking: m.parking ? m.parking.count : null,
    parking_m: m.parking && m.parking.nearest_m != null ? Math.round(m.parking.nearest_m) : null,
    competition: m.competition ? m.competition.count : null,
    anchors: m.anchors ? m.anchors.count : null,
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
// Klíč do cache bez diakritiky a velkých písmen: „Rychnov Nad Kneznou" a
// „Rychnov nad Kněžnou" je totéž město, a bylo by hloupé hledat ho dvakrát
// (jedno hledání trvá i dvě minuty). Geokodéru posíláme pořád původní text.
function cacheKey(q) {
  return q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
const scoutJobs = new Map();
const JOB_TTL = 5 * 60e3;
function cleanJobs() {
  const now = Date.now();
  // Běžící úlohu nikdy nezahazujeme — jinak by se po pěti minutách rozjela
  // znovu od začátku a hledání by se nikdy nedobralo konce.
  for (const [k, j] of scoutJobs) if (j.state !== 'running' && now - j.at > JOB_TTL) scoutJobs.delete(k);
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
    // Dvoupismenný kód země — ve hře z něj jsou vlaječky u hráčů v žebříčku.
    const zeme = r.area && r.area.country_code
      ? String(r.area.country_code).toLowerCase().slice(0, 2) : null;
    const data = {
      area: {
        id: key,
        name: (r.area && r.area.display_name ? String(r.area.display_name).split(',')[0].trim() : query),
        country: zeme,
        lat: r.area ? r.area.lat : null,
        lon: r.area ? r.area.lon : null,
      },
      population: r.population || null,
      spots,
    };
    scoutCache.set(key, { at: Date.now(), data });
    // Do databáze, ať je město prozkoumané i po nasazení nové verze a pro všechny
    // hráče najednou. Hledání na OpenStreetMap je drahé, výsledek se nemění.
    try {
      await prisma.gameArea.upsert({
        where: { key },
        create: { key, name: data.area.name, country: zeme, lat: data.area.lat, lon: data.area.lon, population: data.population, spots },
        update: { name: data.area.name, country: zeme, lat: data.area.lat, lon: data.area.lon, population: data.population, spots },
      });
    } catch (e) { console.warn('[game] uložení města:', e.message); }
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
    const key = cacheKey(q);

    const hit = scoutCache.get(key);
    if (hit && Date.now() - hit.at < SCOUT_TTL) {
      return res.set('Cache-Control', 'public, max-age=600').json(hit.data);
    }
    // Město už někdo prohledal dřív — vrátíme ho okamžitě, bez OpenStreetMap.
    const saved = await prisma.gameArea.findUnique({ where: { key } }).catch(() => null);
    if (saved && Array.isArray(saved.spots) && saved.spots.length) {
      const data = {
        area: { id: key, name: saved.name, country: saved.country || null, lat: saved.lat, lon: saved.lon },
        population: saved.population, spots: saved.spots,
      };
      scoutCache.set(key, { at: Date.now(), data });
      prisma.gameArea.update({ where: { key }, data: { hits: { increment: 1 } } }).catch(() => {});
      return res.set('Cache-Control', 'public, max-age=600').json(data);
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

// ─── Sledování ───────────────────────────────────────────────────────────────
// Pár bodů v cestě hráče, ať je v administraci vidět, kde lidé odpadají.
// Ukládáme do stejné tabulky jako zbytek webu (compounder_events), bez osobních
// údajů — jen náhodné id návštěvy, krok a čas.
const EVENTY = ['game_open', 'game_quiz', 'game_register', 'game_scout', 'game_build', 'game_paid'];
router.post('/ev', express.json({ limit: '2kb' }), (req, res) => {
  const b = req.body || {};
  const event = String(b.event || '');
  const sid = String(b.sid || '').slice(0, 64);
  if (!EVENTY.includes(event) || !/^[a-z0-9-]{6,64}$/.test(sid)) return res.json({ ok: false });
  if (rateLimited('ev:' + ipOf(req), 120, 10 * 60e3)) return res.json({ ok: false });
  prisma.compounderEvent.create({ data: {
    sid, event, path: '/game', lang: 'cs',
    ua: String(req.headers['user-agent'] || '').slice(0, 1000) || null, ip: ipOf(req) || null,
  } }).catch(() => {});
  res.json({ ok: true });
});

// ─── Záznam první minuty ─────────────────────────────────────────────────────
// Z první návštěvy se nahrává prvních šedesát vteřin — ne obraz, ale popis
// toho, co se na stránce dělo (co se vykreslilo, kam člověk klepl, kam
// scroloval). Z toho se pak v administraci dá přehrát, jak kdo hru poprvé
// potkal a kde se zasekl. Vyplňované texty se nenahrávají, nick ani heslo
// se tedy nikam neuloží.
// Chodí to po částech, aby se nic neztratilo, když návštěvník odejde dřív.
const ZAZNAM_CASTI = 8;              // víc než osm částí na návštěvu nebereme
const ZAZNAM_LIMIT = '900kb';        // strop na jednu část
router.post('/zaznam', express.json({ limit: ZAZNAM_LIMIT }), async (req, res) => {
  try {
    const b = req.body || {};
    const sid = String(b.sid || '').slice(0, 64);
    const poradi = Math.max(0, Math.min(ZAZNAM_CASTI - 1, parseInt(b.poradi, 10) || 0));
    const udalosti = b.udalosti;
    if (!/^[a-z0-9-]{6,64}$/.test(sid)) return res.json({ ok: false });
    if (!Array.isArray(udalosti) || !udalosti.length) return res.json({ ok: false });
    if (rateLimited('zaznam:' + ipOf(req), 40, 10 * 60e3)) return res.json({ ok: false });
    const bajtu = JSON.stringify(udalosti).length;
    await prisma.gameReplay.upsert({
      where: { sid_poradi: { sid, poradi } },
      update: { udalosti, bajtu, ms: Math.max(0, parseInt(b.ms, 10) || 0) },
      create: { sid, poradi, udalosti, bajtu, ms: Math.max(0, parseInt(b.ms, 10) || 0),
        ua: String(req.headers['user-agent'] || '').slice(0, 500) || null },
    });
    // Úklid: záznamy starší měsíce už nikdo neotevře, ať databáze nebobtná.
    if (poradi === 0) {
      prisma.gameReplay.deleteMany({
        where: { created_at: { lt: new Date(Date.now() - 30 * 86400e3) } } }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false }); }
});

// ─── Pozvánky ────────────────────────────────────────────────────────────────
// Hráč sdílí odkaz s ?ref=<svoje id>. Kdo ho otevře, započítá se mu jedno
// otevření a hráči tím roste návštěvnost jeho prádlomatů.
// Počítadlo patří do databáze: dřív leželo v paměti serveru a každé nasazení
// hráčům vynulovalo pozvánky, které si poctivě nasbírali.
const REF_MAX = 500;
const okId = (x) => /^[a-z0-9]{6,24}$/.test(String(x || ''));

// Z adresy návštěvníka děláme jednosměrný otisk — na „jedno započtení na adresu"
// to stačí a samotné IP nikde neleží.
function refOtisk(req) {
  const sul = process.env.GAME_REF_SALT || process.env.JWT_SECRET || 'milionar';
  return crypto.createHash('sha256').update(sul + '|' + ipOf(req)).digest('hex').slice(0, 48);
}
async function refPocet(id) {
  return Math.min(REF_MAX, await prisma.gameRef.count({ where: { ref_id: id } }));
}

router.post('/ref/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').toLowerCase();
    if (!okId(id)) return res.status(400).json({ error: 'Neplatné id.' });
    let counted = false;
    try {
      // Unikátní dvojice (odkaz, návštěvník) hlídá, že jedna adresa započte jednou.
      await prisma.gameRef.create({ data: { ref_id: id, visitor: refOtisk(req) } });
      counted = true;
    } catch (e) {
      if (!e || e.code !== 'P2002') throw e;
    }
    res.json({ refs: await refPocet(id), counted });
  } catch (e) { next(e); }
});

router.get('/ref/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').toLowerCase();
    if (!okId(id)) return res.status(400).json({ error: 'Neplatné id.' });
    res.set('Cache-Control', 'no-store').json({ refs: await refPocet(id) });
  } catch (e) { next(e); }
});

module.exports = router;
