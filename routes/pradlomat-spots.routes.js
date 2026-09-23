// =============================================================================
// HolyOS — Předjednaná místa pro prádlomat
// =============================================================================
// Samostatný koncept (ZÁMĚRNĚ oddělený od Site / bestseries.global):
//   • Veřejný přehled na pradlomaty.info/location — místa, která už máme
//     předjednaná a nabízíme je zájemcům/provozovatelům (mapa + karty + detail
//     + formulář "Mám zájem").
//   • Interní správa v Prodejních objednávkách (záložka Předjednaná místa).
//
// Mount: /api/pradlomat-spots v app.js.
//   Veřejné endpointy (/public/...) jsou BEZ auth (deklarované nad requireAuth).
//   Interní endpointy vyžadují JWT (requireAuth).
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const finder = require('../services/spots/finder');

const FINDER_CONFIG_KEY = 'pradlomat.finder_config';
const SPOT_STATUSES = ['draft', 'published', 'reserved', 'taken', 'archived'];
const NOMINATIM_UA = 'HolyOS-Pradlomaty/1.0 (+https://pradlomaty.info; tomas.holy@bestseries.cz)';

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || null;
}

function actorPersonId(req) {
  return req.user && req.user.person ? req.user.person.id : null;
}

// Z payloadu kandidáta (z vyhledávače) vytáhne strukturované metriky pro uložení.
// Přijme jak ploché hodnoty, tak vnořený objekt metrics.
function candidateMetrics(b) {
  const m = (b && b.metrics) || {};
  const iOrNull = (v) => (v != null && isFinite(v)) ? Math.round(Number(v)) : null;
  return {
    has_parking: b.has_parking != null ? !!b.has_parking : (b.metrics ? ((m.parking && m.parking.count) > 0) : null),
    parking_distance_m: b.parking_distance_m != null ? iOrNull(b.parking_distance_m) : (m.parking ? iOrNull(m.parking.nearest_m) : null),
    population: iOrNull(b.population),
    anchor_count: b.anchor_count != null ? iOrNull(b.anchor_count) : (m.anchors ? iOrNull(m.anchors.count) : null),
    competition_count: b.competition_count != null ? iOrNull(b.competition_count) : (m.competition ? iOrNull(m.competition.count) : null),
    score: iOrNull(b.score),
  };
}

// Automaticky dopočítá parametry okolí z GPS (Overpass + GeoNames, bez AI).
// Vrací pole pro uložení, nebo null při selhání. Používá se při zveřejnění místa.
async function analyzeAndFill(lat, lon) {
  try {
    if (lat == null || lon == null) return null;
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    let cfg = {}; if (row && row.value) { try { cfg = JSON.parse(row.value); } catch (_) {} }
    const r = await finder.analyzePoint(Number(lat), Number(lon), cfg, { ai: false });
    const m = r.metrics || {};
    return {
      has_parking: !!(m.parking && m.parking.count > 0),
      parking_distance_m: (m.parking && m.parking.nearest_m != null) ? Math.round(m.parking.nearest_m) : null,
      population: r.population != null ? Math.round(r.population) : null,
      anchor_count: m.anchors ? m.anchors.count : null,
      competition_count: m.competition ? m.competition.count : null,
      score: r.score != null ? r.score : null,
    };
  } catch (e) { console.warn('[spots] analyzeAndFill:', e && e.message); return null; }
}

// Diakritika pryč, mezery→pomlčky, jen [a-z0-9-].
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'misto';
}

// Vytvoří unikátní kód (slug + případně číselná přípona).
async function uniqueCode(base) {
  let code = slugify(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await prisma.pradlomatSpot.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
    i += 1;
    code = `${slugify(base)}-${i}`;
  }
}

// Serializace Decimalů → number (aby na frontendu nebyly stringy).
function num(v) { return v == null ? null : Number(v); }

// Přibližná souřadnice (zaokrouhlení ~1 km), ať zákazník nevidí přesné místo.
function fuzz(v) { return v == null ? null : Math.round(Number(v) * 100) / 100; }

// Veřejná podoba místa — ANONYMIZOVANÁ. Bez jména partnera (title), bez přesné
// adresy a s přibližnou polohou. Zákazník vidí jen veřejný název a parametry.
function toPublic(s) {
  return {
    code: s.code,
    name: s.public_title || s.highlight || ('Připravená lokalita' + (s.city ? ' – ' + s.city : '')),
    city: s.city,
    region: s.region,
    country: s.country,
    latitude: fuzz(s.latitude),
    longitude: fuzz(s.longitude),
    approx: true,
    public_description: s.public_description,
    highlight: s.highlight,
    area_m2: num(s.area_m2),
    rent_monthly: num(s.rent_monthly),
    rent_currency: s.rent_currency,
    footfall_note: s.footfall_note,
    availability_note: s.availability_note,
    has_parking: s.has_parking,
    parking_distance_m: s.parking_distance_m,
    population: s.population,
    anchor_count: s.anchor_count,
    competition_count: s.competition_count,
    score: s.score,
    cover_image_url: s.cover_image_url,
    gallery: Array.isArray(s.gallery) ? s.gallery : [],
    status: s.status,
  };
}

// Vzdálenost dvou bodů v km (haversine).
function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Interní podoba (vše).
function toAdmin(s) {
  return {
    id: s.id,
    code: s.code,
    title: s.title,
    status: s.status,
    is_public: s.is_public,
    city: s.city,
    region: s.region,
    country: s.country,
    address: s.address,
    show_address: s.show_address,
    latitude: num(s.latitude),
    longitude: num(s.longitude),
    public_title: s.public_title,
    public_description: s.public_description,
    highlight: s.highlight,
    area_m2: num(s.area_m2),
    rent_monthly: num(s.rent_monthly),
    rent_currency: s.rent_currency,
    footfall_note: s.footfall_note,
    availability_note: s.availability_note,
    has_parking: s.has_parking,
    parking_distance_m: s.parking_distance_m,
    population: s.population,
    anchor_count: s.anchor_count,
    competition_count: s.competition_count,
    score: s.score,
    reserved_lead_id: s.reserved_lead_id,
    reserved_lead_label: s.reserved_lead_label,
    potential_report: s.potential_report,
    potential_generated_at: s.potential_generated_at,
    cover_image_url: s.cover_image_url,
    gallery: Array.isArray(s.gallery) ? s.gallery : [],
    owner_name: s.owner_name,
    owner_phone: s.owner_phone,
    owner_email: s.owner_email,
    internal_notes: s.internal_notes,
    electricity_kw: num(s.electricity_kw),
    water_supply: s.water_supply,
    sewage: s.sewage,
    assigned_to_id: s.assigned_to_id,
    created_by_id: s.created_by_id,
    sort_order: s.sort_order,
    created_at: s.created_at,
    updated_at: s.updated_at,
    inquiries_count: s._count ? s._count.inquiries : undefined,
    new_inquiries: s._count ? undefined : s.new_inquiries,
  };
}

// Notifikace o nové poptávce — majitelům (push + zvonek), fire-and-forget.
const SPOT_NOTIFY_LINK = '/modules/prodejni-objednavky/index.html';
async function notifyOwners({ title, body }) {
  try {
    const emails = (process.env.COMPOUNDER_OWNER_EMAILS || 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const persons = await prisma.person.findMany({
      where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) },
      select: { id: true, user_id: true },
    });
    if (!persons.length) return;
    let notifyPerson = null, createNotification = null;
    try { notifyPerson = require('../services/push/expo-push').notifyPerson; } catch (e) { /* push nedostupný */ }
    try { createNotification = require('./notifications.routes').createNotification; } catch (e) { /* zvonek nedostupný */ }
    for (const p of persons) {
      if (notifyPerson) {
        Promise.resolve(notifyPerson(prisma, p.id, { title, body, data: { link: SPOT_NOTIFY_LINK }, sound: 'default' }))
          .catch((e) => console.warn('[spots] push', p.id, e && e.message));
      }
      if (p.user_id && createNotification) {
        createNotification({ userId: p.user_id, type: 'system', title, body, link: SPOT_NOTIFY_LINK })
          .catch((e) => console.warn('[spots] zvonek', p.user_id, e && e.message));
      }
    }
  } catch (e) {
    console.error('[spots] notifyOwners:', e && e.message);
  }
}

// =============================================================================
// VEŘEJNÉ ENDPOINTY (bez auth) — pro web pradlomaty.info/location
// =============================================================================

// GET /api/pradlomat-spots/public — seznam zveřejněných míst.
router.get('/public', async (req, res, next) => {
  try {
    const spots = await prisma.pradlomatSpot.findMany({
      where: { status: { in: ['published', 'reserved'] } },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
    });
    // Dopočítej vzdálenost k nejbližšímu provozovanému prádlomatu (z Google My Maps).
    let existing = [];
    try { existing = await fetchExistingLaundromats(); } catch (_) { existing = []; }
    const out = spots.map((s) => {
      const pub = toPublic(s);
      if (s.latitude != null && s.longitude != null && existing.length) {
        let best = null;
        for (const w of existing) {
          const d = distKm(Number(s.latitude), Number(s.longitude), w.lat, w.lon);
          if (best === null || d < best.d) best = { d, name: w.name };
        }
        if (best) { pub.nearest_laundromat_km = Math.round(best.d * 10) / 10; pub.nearest_laundromat_name = best.name; }
      }
      return pub;
    });
    res.json(out);
  } catch (err) { next(err); }
});

// GET /api/pradlomat-spots/public/area-analysis?area=…&radius_km=… — VEŘEJNÁ analýza
// spádové oblasti (bez AI, s rate-limitem). Pro web pradlomaty.info/location.
const _pubAreaHits = new Map();
function pubAreaRateOk(ip) {
  const now = Date.now(), win = 60 * 60 * 1000, max = 40;
  const arr = (_pubAreaHits.get(ip) || []).filter((t) => now - t < win);
  if (arr.length >= max) { _pubAreaHits.set(ip, arr); return false; }
  arr.push(now); _pubAreaHits.set(ip, arr);
  if (_pubAreaHits.size > 5000) _pubAreaHits.clear();
  return true;
}
router.get('/public/area-analysis', async (req, res, next) => {
  try {
    const area = String(req.query.area || '').trim();
    if (area.length < 2) return res.status(400).json({ error: 'Zadej město nebo oblast.' });
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '?';
    if (!pubAreaRateOk(ip)) return res.status(429).json({ error: 'Příliš mnoho dotazů. Zkus to prosím za chvíli.' });
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    let cfg = {}; if (row && row.value) { try { cfg = JSON.parse(row.value); } catch (_) {} }
    const radiusKm = Number(req.query.radius_km) || 15;
    const result = await finder.analyzeArea(area, radiusKm, cfg, { ai: false });
    if (result && result.error) return res.status(404).json(result);
    // Provozované prádelny („už pereme") ve spádovém okruhu — kolik a kde.
    try {
      if (result && result.center) {
        const ex = await fetchExistingLaundromats();
        const within = (ex || [])
          .filter((w) => w.lat != null && w.lon != null)
          .map((w) => ({ name: w.name, dist_km: Math.round(distKm(result.center.lat, result.center.lon, w.lat, w.lon) * 10) / 10 }))
          .filter((w) => w.dist_km <= radiusKm)
          .sort((a, b) => a.dist_km - b.dist_km);
        result.operating = within;
      }
    } catch (_) { /* neblokuj analýzu */ }
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/pradlomat-spots/public/existing-laundromats — NAŠE stávající lokality.
// Zdroj pravdy = SIS kiosk-values (tab Compounding, 69 lokalit). SIS nevrací GPS,
// takže adresy (kiosk.label) geokódujeme přes Nominatim a výsledek trvale cachujeme
// v AppSetting. Fallback: Google My Maps KML, kdyby SIS nebylo dostupné.
const KIOSK_GEOCODE_KEY = 'pradlomat.kiosk_geocode';   // { "<adresa>": {lat,lon} }
const MYMAPS_MID = process.env.KDEPEREME_MYMAPS_MID || '1kTO9nPigGvqmmEhm_iTcW2z9LkJYgmY';
let _existingCache = { at: 0, data: null };
let _geoRunning = false;

// SIS kiosky (server-side klíč). Vrací [] když SIS není nakonfigurováno / selže.
async function fetchSisKiosks() {
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  if (!apiKey) return [];
  const apiUrl = process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(apiUrl, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return [];
    const payload = await r.json();
    return Array.isArray(payload.kiosks) ? payload.kiosks : [];
  } catch (_) { return []; } finally { clearTimeout(to); }
}

async function loadGeoCache() {
  try { const row = await prisma.appSetting.findUnique({ where: { key: KIOSK_GEOCODE_KEY } }); return (row && row.value) ? JSON.parse(row.value) : {}; }
  catch (_) { return {}; }
}
async function saveGeoCache(map) {
  try { await prisma.appSetting.upsert({ where: { key: KIOSK_GEOCODE_KEY }, update: { value: JSON.stringify(map) }, create: { key: KIOSK_GEOCODE_KEY, value: JSON.stringify(map) } }); } catch (_) {}
}
async function geocodeAddr(addr) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cz,pl,ie&q=' + encodeURIComponent(addr);
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'cs' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (Array.isArray(j) && j.length) return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
  } catch (_) {} finally { clearTimeout(to); }
  return null;
}
// Na pozadí doplní chybějící geokódy (Nominatim, 1,2 s/dotaz), uloží do cache.
// Vynech testovací / neúplné adresy ze SIS (bez čísla popisného, „ABCD", „TEST"…).
function isRealAddr(label) {
  const a = String(label || '').trim();
  return a.length >= 6 && /\d/.test(a);
}

async function backfillGeocodes(kiosks, geo) {
  if (_geoRunning) return; _geoRunning = true;
  try {
    let changed = false;
    for (const k of kiosks) {
      const addr = (k.label || '').trim();
      if (!isRealAddr(addr) || geo[addr]) continue;
      const g = await geocodeAddr(addr + ', Česko');
      geo[addr] = g || { lat: null, lon: null }; changed = true;
      await saveGeoCache(geo); // ukládej průběžně, ať se postup neztratí
      await new Promise((r) => setTimeout(r, 1200)); // respektuj Nominatim rate-limit
    }
    if (changed) { await saveGeoCache(geo); _existingCache = { at: 0, data: null }; }
  } catch (_) {} finally { _geoRunning = false; }
}

// Klíč města z názvu/adresy (bez diakritiky, první slovo) — pro spárování KML×SIS.
function cityKey(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9, ]/g, ' ').trim().split(/[\s,]+/)[0] || '';
}

async function fetchExistingLaundromats() {
  const now = Date.now();
  if (_existingCache.data && _existingCache.data.length && now - _existingCache.at < 6 * 3600 * 1000) return _existingCache.data;

  // 1) PRIMÁRNÍ zdroj souřadnic: kdepereme (Google My Maps KML) — přesné GPS.
  const list = (await fetchKmlLaundromats()).slice();
  const kmlCities = new Set(list.map((p) => cityKey(p.name)));

  // 2) DOPLNĚK: SIS lokality, které v KML (dle města) nejsou — přes geokódovanou cache.
  try {
    const kiosks = await fetchSisKiosks();
    if (kiosks.length) {
      const geo = await loadGeoCache();
      let missing = 0;
      for (const k of kiosks) {
        const addr = (k.label || '').trim();
        if (!isRealAddr(addr) || kmlCities.has(cityKey(addr))) continue;
        const g = geo[addr];
        if (g && g.lat != null && g.lon != null) {
          list.push({ name: addr, lat: g.lat, lon: g.lon, note: (k.companyName || '') + (k.inIncubator ? ' · inkubátor' : ' · zavedená') });
        } else if (!g) { missing++; }
      }
      if (missing) backfillGeocodes(kiosks, geo); // doplní GPS chybějících na pozadí
    }
  } catch (_) { /* SIS doplněk je best-effort */ }

  if (list.length) _existingCache = { at: now, data: list };
  return list;
}

// Primární zdroj souřadnic: Google My Maps „WHERE WE LAUNDRY [EU]" (KML).
// Poslední úspěšné načtení držíme v AppSetting, aby výpadek Googlu nevynuloval mapu.
const KML_SNAPSHOT_KEY = 'pradlomat.kml_snapshot';
async function loadKmlSnapshot() {
  try { const row = await prisma.appSetting.findUnique({ where: { key: KML_SNAPSHOT_KEY } }); const j = row && row.value ? JSON.parse(row.value) : null; return (j && Array.isArray(j.list)) ? j.list : []; }
  catch (_) { return []; }
}
async function saveKmlSnapshot(list) {
  try { await prisma.appSetting.upsert({ where: { key: KML_SNAPSHOT_KEY }, update: { value: JSON.stringify({ list, at: Date.now() }) }, create: { key: KML_SNAPSHOT_KEY, value: JSON.stringify({ list, at: Date.now() }) } }); } catch (_) {}
}
async function fetchKmlLaundromats() {
  const url = 'https://www.google.com/maps/d/kml?forcekml=1&mid=' + MYMAPS_MID;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  let xml = '';
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': NOMINATIM_UA } });
    if (r.ok) xml = await r.text();
  } catch (_) {} finally { clearTimeout(to); }
  if (!xml) return await loadKmlSnapshot(); // Google nedostupný → poslední uložený stav
  const decode = (s) => String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  const out = [];
  const folderRe = /<Folder>([\s\S]*?)<\/Folder>/g; let fm;
  while ((fm = folderRe.exec(xml))) {
    const block = fm[1];
    const country = decode((block.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '');
    const pmRe = /<Placemark>([\s\S]*?)<\/Placemark>/g; let pm;
    while ((pm = pmRe.exec(block))) {
      const p = pm[1];
      const name = decode((p.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '');
      const note = decode((p.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '');
      const coord = (p.match(/<coordinates>([\s\S]*?)<\/coordinates>/) || [])[1] || '';
      const parts = coord.trim().split(',');
      const lon = parseFloat(parts[0]); const lat = parseFloat(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ name, note: note || null, lat, lon, country });
    }
  }
  if (out.length) { saveKmlSnapshot(out); return out; }
  return await loadKmlSnapshot();
}
router.get('/public/existing-laundromats', async (req, res) => {
  try { res.json(await fetchExistingLaundromats()); }
  catch (e) { res.json((_existingCache && _existingCache.data) || []); }
});

// GET /api/pradlomat-spots/public/:code — detail jednoho místa.
router.get('/public/:code', async (req, res, next) => {
  try {
    const s = await prisma.pradlomatSpot.findUnique({ where: { code: String(req.params.code || '') } });
    if (!s || !['published', 'reserved'].includes(s.status)) {
      return res.status(404).json({ error: 'Místo nenalezeno' });
    }
    res.json(toPublic(s));
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/public/:code/inquiry — poptávka "Mám zájem".
const inquirySchema = z.object({
  name: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(255).optional(),
  message: z.string().trim().max(4000).optional(),
});
router.post('/public/:code/inquiry', async (req, res, next) => {
  try {
    const parsed = inquirySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný formulář' });
    const d = parsed.data;
    if (!d.phone && !d.email) return res.status(400).json({ error: 'Zadejte telefon nebo e-mail.' });

    const spot = await prisma.pradlomatSpot.findUnique({ where: { code: String(req.params.code || '') } });
    if (!spot || !['published', 'reserved'].includes(spot.status)) return res.status(404).json({ error: 'Místo nenalezeno' });

    await prisma.pradlomatSpotInquiry.create({
      data: {
        spot_id: spot.id,
        name: d.name || null,
        phone: d.phone || null,
        email: d.email || null,
        message: d.message || null,
        source: 'pradlomaty.info/location',
      },
    });

    notifyOwners({
      title: 'Nová poptávka místa',
      body: `${d.name || d.phone || d.email || 'Zájemce'} — ${spot.title}`,
    });

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/public/:code/block — „Opravdu blokovat" z webu.
// Založí poptávku a lokalitu překlopí na rezervováno (stáhne z nabídky).
router.post('/public/:code/block', async (req, res, next) => {
  try {
    const parsed = inquirySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný formulář' });
    const d = parsed.data;
    if (!d.phone && !d.email) return res.status(400).json({ error: 'Zadejte telefon nebo e-mail.' });

    const spot = await prisma.pradlomatSpot.findUnique({ where: { code: String(req.params.code || '') } });
    if (!spot || !['published', 'reserved'].includes(spot.status)) return res.status(404).json({ error: 'Místo nenalezeno' });
    if (spot.status === 'reserved') return res.status(409).json({ error: 'Tuto lokalitu už si někdo zablokoval.' });

    await prisma.pradlomatSpotInquiry.create({
      data: {
        spot_id: spot.id,
        name: d.name || null, phone: d.phone || null, email: d.email || null,
        message: '🔒 BLOKACE lokality přes web' + (d.message ? (' — ' + d.message) : ''),
        source: 'pradlomaty.info/location (blokace)',
      },
    });
    await prisma.pradlomatSpot.update({ where: { id: spot.id }, data: { status: 'reserved', is_public: true } });

    notifyOwners({
      title: '🔒 Blokace lokality',
      body: `${d.name || d.phone || d.email || 'Zájemce'} zablokoval(a): ${spot.title}`,
    });

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// INTERNÍ ENDPOINTY (vyžadují přihlášení)
// =============================================================================
router.use(requireAuth);

// ─── Vyhledávač lokalit (AI + OSM) ──────────────────────────────────────────

// GET /api/pradlomat-spots/finder/config — konfigurace logiky (s výchozími).
router.get('/finder/config', async (req, res, next) => {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    let saved = {};
    if (row && row.value) { try { saved = JSON.parse(row.value); } catch (_) { saved = {}; } }
    res.json({ config: finder.mergeConfig(saved), defaults: finder.DEFAULT_CONFIG });
  } catch (err) { next(err); }
});

// PUT /api/pradlomat-spots/finder/config — uložení konfigurace.
router.put('/finder/config', async (req, res, next) => {
  try {
    const cfg = finder.mergeConfig(req.body || {});
    const value = JSON.stringify(cfg);
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    if (row) await prisma.appSetting.update({ where: { key: FINDER_CONFIG_KEY }, data: { value, value_type: 'json' } });
    else await prisma.appSetting.create({ data: { key: FINDER_CONFIG_KEY, value, value_type: 'json' } });
    res.json({ config: cfg });
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/finder/search  { area } — plošné hledání kandidátů.
router.post('/finder/search', async (req, res, next) => {
  try {
    const area = String((req.body && req.body.area) || '').trim();
    if (area.length < 2) return res.status(400).json({ error: 'Zadej město nebo oblast.' });
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    let cfg = {}; if (row && row.value) { try { cfg = JSON.parse(row.value); } catch (_) {} }
    const result = await finder.searchArea(area, cfg);
    if (result && result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/finder/analyze  { lat, lon } — hloubková analýza bodu + AI.
router.post('/finder/analyze', async (req, res, next) => {
  try {
    const lat = Number(req.body && req.body.lat), lon = Number(req.body && req.body.lon);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Chybí souřadnice.' });
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    let cfg = {}; if (row && row.value) { try { cfg = JSON.parse(row.value); } catch (_) {} }
    const result = await finder.analyzePoint(lat, lon, cfg, { ai: req.body && req.body.ai !== false });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/finder/save-candidate — založí kandidáta jako místo (draft).
router.post('/finder/save-candidate', async (req, res, next) => {
  try {
    const b = req.body || {};
    const lat = Number(b.lat), lon = Number(b.lon);
    const title = String(b.name || '').trim() || (b.city ? String(b.city) : 'Nové místo');
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Chybí souřadnice.' });
    const code = await uniqueCode(b.city ? (b.city + '-' + title) : title);
    let notes = '';
    if (b.note) notes = String(b.note).slice(0, 4000);
    else if (b.score != null) notes = 'Z vyhledávače lokalit — skóre ' + Math.round(b.score) + '/100 (' + (b.verdict || '') + ').';
    const created = await prisma.pradlomatSpot.create({
      data: Object.assign({
        code, title, status: 'draft', is_public: false,
        city: b.city ? String(b.city).slice(0, 120) : null,
        latitude: lat, longitude: lon,
        internal_notes: notes || null,
        created_by_id: actorPersonId(req),
      }, candidateMetrics(b)),
    });
    res.status(201).json(toAdmin(created));
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/finder/area-analysis — analýza spádové oblasti (kruh + hustota + AI).
router.post('/finder/area-analysis', async (req, res, next) => {
  try {
    const area = String((req.body && req.body.area) || '').trim();
    if (area.length < 2) return res.status(400).json({ error: 'Zadej město nebo oblast.' });
    const radiusKm = Number(req.body && req.body.radius_km) || 15;
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    let cfg = {}; if (row && row.value) { try { cfg = JSON.parse(row.value); } catch (_) {} }
    const result = await finder.analyzeArea(area, radiusKm, cfg, { ai: req.body && req.body.ai !== false });
    if (result && result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/finder/save-candidates — hromadné založení kandidátů.
router.post('/finder/save-candidates', async (req, res, next) => {
  try {
    const items = Array.isArray(req.body && req.body.candidates) ? req.body.candidates : [];
    if (!items.length) return res.status(400).json({ error: 'Nic k založení.' });
    const personId = actorPersonId(req);
    let created = 0;
    for (const b of items) {
      const lat = Number(b.lat), lon = Number(b.lon);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const title = String(b.name || '').trim() || (b.city ? String(b.city) : 'Nové místo');
      const code = await uniqueCode(b.city ? (b.city + '-' + title) : title);
      await prisma.pradlomatSpot.create({
        data: Object.assign({
          code, title, status: 'draft', is_public: false,
          city: b.city ? String(b.city).slice(0, 120) : null,
          latitude: lat, longitude: lon,
          internal_notes: b.note ? String(b.note).slice(0, 4000) : null,
          created_by_id: personId,
        }, candidateMetrics(b)),
      });
      created += 1;
    }
    res.status(201).json({ created });
  } catch (err) { next(err); }
});

// GET /api/pradlomat-spots/geocode?q=adresa — proxy na Nominatim.
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'cs' } });
    if (!r.ok) return res.json([]);
    const arr = await r.json();
    res.json((Array.isArray(arr) ? arr : []).map((x) => ({
      display_name: x.display_name,
      lat: Number(x.lat),
      lon: Number(x.lon),
      city: (x.address && (x.address.city || x.address.town || x.address.village)) || null,
      country: (x.address && x.address.country) || null,
    })));
  } catch (e) {
    res.json([]);
  }
});

// GET /api/pradlomat-spots/leads-search?q= — našeptávač leadů (CompounderLead) pro rezervaci.
router.get('/leads-search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const leads = await prisma.compounderLead.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
          { company: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, phone: true, email: true, city: true, company: true },
      orderBy: { id: 'desc' }, take: 12,
    });
    res.json(leads);
  } catch (err) { next(err); }
});

// GET /api/pradlomat-spots — seznam všech (správa).
router.get('/', async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const where = {};
    if (status && SPOT_STATUSES.includes(status)) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { owner_name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const spots = await prisma.pradlomatSpot.findMany({
      where,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
      include: { _count: { select: { inquiries: true } } },
    });
    // Kolik nových poptávek u každého místa.
    const newCounts = await prisma.pradlomatSpotInquiry.groupBy({
      by: ['spot_id'], where: { status: 'new' }, _count: { _all: true },
    });
    const newMap = {}; newCounts.forEach((c) => { newMap[c.spot_id] = c._count._all; });
    res.json(spots.map((s) => Object.assign(toAdmin(s), { new_inquiries: newMap[s.id] || 0 })));
  } catch (err) { next(err); }
});

// Validace pro create/update.
const spotSchema = z.object({
  title: z.string().trim().min(1).max(255),
  code: z.string().trim().max(80).optional(),
  status: z.enum(['draft', 'published', 'reserved', 'taken', 'archived']).optional(),
  is_public: z.boolean().optional(),
  public_title: z.string().trim().max(255).optional().nullable(),
  has_parking: z.boolean().optional().nullable(),
  parking_distance_m: z.number().int().optional().nullable(),
  population: z.number().int().optional().nullable(),
  anchor_count: z.number().int().optional().nullable(),
  competition_count: z.number().int().optional().nullable(),
  score: z.number().int().optional().nullable(),
  reserved_lead_id: z.number().int().optional().nullable(),
  reserved_lead_label: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(60).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  show_address: z.boolean().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  public_description: z.string().trim().max(8000).optional().nullable(),
  highlight: z.string().trim().max(160).optional().nullable(),
  area_m2: z.number().optional().nullable(),
  rent_monthly: z.number().optional().nullable(),
  rent_currency: z.string().trim().max(3).optional().nullable(),
  footfall_note: z.string().trim().max(255).optional().nullable(),
  availability_note: z.string().trim().max(255).optional().nullable(),
  cover_image_url: z.string().trim().max(500).optional().nullable(),
  gallery: z.array(z.string()).optional().nullable(),
  owner_name: z.string().trim().max(255).optional().nullable(),
  owner_phone: z.string().trim().max(40).optional().nullable(),
  owner_email: z.string().trim().max(255).optional().nullable(),
  internal_notes: z.string().trim().max(8000).optional().nullable(),
  electricity_kw: z.number().optional().nullable(),
  water_supply: z.boolean().optional().nullable(),
  sewage: z.boolean().optional().nullable(),
  assigned_to_id: z.number().int().optional().nullable(),
  sort_order: z.number().int().optional(),
});

function emptyToNull(v) { return v === '' ? null : v; }

// POST /api/pradlomat-spots — vytvoření.
router.post('/', async (req, res, next) => {
  try {
    const parsed = spotSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.issues });
    const d = parsed.data;
    const code = d.code ? await uniqueCode(d.code) : await uniqueCode(d.city ? `${d.city}-${d.title}` : d.title);
    // Na web jde místo podle stavu (Zveřejněné/Rezervováno). is_public se dopočítá.
    const status = d.status || 'draft';
    const is_public = ['published', 'reserved'].includes(status);

    const created = await prisma.pradlomatSpot.create({
      data: {
        code,
        title: d.title,
        status,
        is_public,
        city: emptyToNull(d.city), region: emptyToNull(d.region), country: emptyToNull(d.country) || 'CZ',
        address: emptyToNull(d.address), show_address: !!d.show_address,
        latitude: d.latitude ?? null, longitude: d.longitude ?? null,
        public_title: emptyToNull(d.public_title),
        public_description: emptyToNull(d.public_description), highlight: emptyToNull(d.highlight),
        has_parking: d.has_parking ?? null, parking_distance_m: d.parking_distance_m ?? null,
        population: d.population ?? null, anchor_count: d.anchor_count ?? null,
        competition_count: d.competition_count ?? null, score: d.score ?? null,
        reserved_lead_id: d.reserved_lead_id ?? null, reserved_lead_label: emptyToNull(d.reserved_lead_label),
        area_m2: d.area_m2 ?? null, rent_monthly: d.rent_monthly ?? null,
        rent_currency: emptyToNull(d.rent_currency) || 'CZK',
        footfall_note: emptyToNull(d.footfall_note), availability_note: emptyToNull(d.availability_note),
        cover_image_url: emptyToNull(d.cover_image_url), gallery: d.gallery || undefined,
        owner_name: emptyToNull(d.owner_name), owner_phone: emptyToNull(d.owner_phone),
        owner_email: emptyToNull(d.owner_email), internal_notes: emptyToNull(d.internal_notes),
        electricity_kw: d.electricity_kw ?? null, water_supply: d.water_supply ?? null, sewage: d.sewage ?? null,
        assigned_to_id: d.assigned_to_id ?? null,
        created_by_id: actorPersonId(req),
        sort_order: d.sort_order ?? 0,
      },
    });
    // Auto-analýza okolí při rovnou zveřejněném místě bez zadaných dat.
    let out = created;
    if (is_public && created.latitude != null && created.longitude != null
        && d.has_parking == null) {
      const auto = await analyzeAndFill(created.latitude, created.longitude);
      if (auto) out = await prisma.pradlomatSpot.update({ where: { id: created.id }, data: auto });
    }
    res.status(201).json(toAdmin(out));
  } catch (err) { next(err); }
});

// GET /api/pradlomat-spots/:id — detail + poptávky.
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const s = await prisma.pradlomatSpot.findUnique({
      where: { id: Number(req.params.id) },
      include: { inquiries: { orderBy: { created_at: 'desc' } } },
    });
    if (!s) return res.status(404).json({ error: 'Místo nenalezeno' });
    const out = toAdmin(s);
    out.inquiries = s.inquiries;
    res.json(out);
  } catch (err) { next(err); }
});

// POST /api/pradlomat-spots/:id/potential-analysis — AI analýza zákaznického
// potenciálu (GeoNames + OSM + naše provozované prádlomaty), uloží se k lokalitě.
router.post('/:id(\\d+)/potential-analysis', async (req, res, next) => {
  try {
    const s = await prisma.pradlomatSpot.findUnique({ where: { id: Number(req.params.id) } });
    if (!s) return res.status(404).json({ error: 'Místo nenalezeno' });
    if (s.latitude == null || s.longitude == null) return res.status(400).json({ error: 'Lokalita nemá GPS souřadnice — nejdřív ji umísti na mapě.' });
    const row = await prisma.appSetting.findUnique({ where: { key: FINDER_CONFIG_KEY } });
    let cfg = {}; if (row && row.value) { try { cfg = JSON.parse(row.value); } catch (_) {} }
    let existing = []; try { existing = await fetchExistingLaundromats(); } catch (_) {}
    const result = await finder.analyzePotential(Number(s.latitude), Number(s.longitude), cfg, {
      existing, address: s.address, city: s.city, placeType: s.footfall_note, name: s.title,
    });
    if (!result || result.error) return res.status(400).json({ error: (result && result.error) || 'Analýzu se nepodařilo spustit.' });
    if (!result.report_md) return res.status(502).json({ error: 'AI report se nepodařilo vytvořit (chybí ANTHROPIC_API_KEY nebo výpadek).', facts: result.facts });
    const genAt = new Date();
    await prisma.pradlomatSpot.update({ where: { id: s.id }, data: { potential_report: result.report_md, potential_generated_at: genAt } });
    res.json({ ok: true, report_md: result.report_md, generated_at: genAt.toISOString(), facts: result.facts });
  } catch (err) { next(err); }
});

// PUT /api/pradlomat-spots/:id — úprava.
router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const parsed = spotSchema.partial().safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.issues });
    const d = parsed.data;
    const existing = await prisma.pradlomatSpot.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Místo nenalezeno' });

    const data = {};
    const setIf = (key, val) => { if (val !== undefined) data[key] = val; };
    setIf('title', d.title);
    if (d.code !== undefined && d.code && d.code !== existing.code) data.code = await uniqueCode(d.code);
    setIf('status', d.status);
    setIf('city', emptyToNull(d.city)); setIf('region', emptyToNull(d.region));
    if (d.country !== undefined) data.country = emptyToNull(d.country) || 'CZ';
    setIf('address', emptyToNull(d.address)); setIf('show_address', d.show_address);
    setIf('latitude', d.latitude); setIf('longitude', d.longitude);
    setIf('public_title', emptyToNull(d.public_title));
    setIf('public_description', emptyToNull(d.public_description)); setIf('highlight', emptyToNull(d.highlight));
    setIf('has_parking', d.has_parking); setIf('parking_distance_m', d.parking_distance_m);
    setIf('population', d.population); setIf('anchor_count', d.anchor_count);
    setIf('competition_count', d.competition_count); setIf('score', d.score);
    setIf('reserved_lead_id', d.reserved_lead_id); setIf('reserved_lead_label', emptyToNull(d.reserved_lead_label));
    setIf('area_m2', d.area_m2); setIf('rent_monthly', d.rent_monthly);
    if (d.rent_currency !== undefined) data.rent_currency = emptyToNull(d.rent_currency) || 'CZK';
    setIf('footfall_note', emptyToNull(d.footfall_note)); setIf('availability_note', emptyToNull(d.availability_note));
    setIf('cover_image_url', emptyToNull(d.cover_image_url));
    if (d.gallery !== undefined) data.gallery = d.gallery || [];
    setIf('owner_name', emptyToNull(d.owner_name)); setIf('owner_phone', emptyToNull(d.owner_phone));
    setIf('owner_email', emptyToNull(d.owner_email)); setIf('internal_notes', emptyToNull(d.internal_notes));
    setIf('electricity_kw', d.electricity_kw); setIf('water_supply', d.water_supply); setIf('sewage', d.sewage);
    setIf('assigned_to_id', d.assigned_to_id); setIf('sort_order', d.sort_order);

    // Na web jde místo podle stavu (Zveřejněné/Rezervováno). is_public se dopočítá.
    const finalStatus = data.status || existing.status;
    data.is_public = ['published', 'reserved'].includes(finalStatus);

    // Auto-analýza okolí při zveřejnění — každé místo, které jde na web, projde
    // analyzátorem (pokud ještě nemá data a nejsou zadaná ručně v tomto uložení).
    if (data.is_public) {
      const lat = data.latitude !== undefined ? data.latitude : existing.latitude;
      const lon = data.longitude !== undefined ? data.longitude : existing.longitude;
      // has_parking == null = místo analýzou nikdy neprošlo (analyzátor vždy nastaví true/false).
      const alreadyHas = existing.has_parking != null;
      const settingNow = data.has_parking !== undefined;
      if (lat != null && lon != null && !alreadyHas && !settingNow) {
        const auto = await analyzeAndFill(lat, lon);
        if (auto) Object.assign(data, auto);
      }
    }

    const updated = await prisma.pradlomatSpot.update({ where: { id: existing.id }, data });
    res.json(toAdmin(updated));
  } catch (err) { next(err); }
});

// DELETE /api/pradlomat-spots/:id — smazání (i s poptávkami přes onDelete: Cascade).
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    await prisma.pradlomatSpot.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    if (err && err.code === 'P2025') return res.status(404).json({ error: 'Místo nenalezeno' });
    next(err);
  }
});

// PUT /api/pradlomat-spots/inquiries/:iid — změna stavu poptávky.
router.put('/inquiries/:iid(\\d+)', async (req, res, next) => {
  try {
    const status = String((req.body && req.body.status) || '').trim();
    if (!['new', 'handled'].includes(status)) return res.status(400).json({ error: 'Neplatný stav' });
    const upd = await prisma.pradlomatSpotInquiry.update({
      where: { id: Number(req.params.iid) }, data: { status },
    });
    res.json(upd);
  } catch (err) {
    if (err && err.code === 'P2025') return res.status(404).json({ error: 'Poptávka nenalezena' });
    next(err);
  }
});

module.exports = router;
