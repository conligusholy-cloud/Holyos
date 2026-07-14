// =============================================================================
// HolyOS — Veřejné endpointy pro nabídku lokality (web bestseries.global)
// =============================================================================
// Anonymní návštěvník webu nabídne místo pro prádlomat: zadá kontakt, adresu
// (geokódování přes OSM Nominatim) a na mapě umístí obdélník půdorysu stroje.
// Nabídka se uloží jako Site (public_source = "bestseries.global", status "lead")
// a zobrazí se v záložce Lokality v Prodejních objednávkách.
//
// Mount: /api/lokality v app.js (BEZ requireAuth — veřejné).
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');

// User-Agent pro Nominatim (vyžadují slušné UA, jinak blokují).
const NOMINATIM_UA = 'HolyOS-Lokality/1.0 (+https://bestseries.global; tomas.holy@bestseries.cz)';

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || null;
}

// Notifikace o nové nabídce lokality — VŽDY Janovi a Tomášovi (majitelé), do Velína
// (push) i jako zvonek v HolyOS. Příjemci dle COMPOUNDER_OWNER_EMAILS (default Jan+Tomáš),
// nezávisle na nastavení příjemců Compounderu. Fire-and-forget.
const LOKALITY_NOTIFY_LINK = '/modules/prodejni-objednavky/index.html';
async function notifyLocationOwners(prisma, { title, body, data }) {
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
        Promise.resolve(notifyPerson(prisma, p.id, { title, body, data: Object.assign({ link: LOKALITY_NOTIFY_LINK }, data || {}), sound: 'default' }))
          .catch((e) => console.warn('[lokality] push', p.id, e && e.message));
      }
      if (p.user_id && createNotification) {
        createNotification({ userId: p.user_id, type: 'system', title, body, link: LOKALITY_NOTIFY_LINK })
          .catch((e) => console.warn('[lokality] zvonek', p.user_id, e && e.message));
      }
    }
  } catch (e) {
    console.error('[lokality] notifyLocationOwners:', e && e.message);
  }
}

// ─── GET /api/lokality/geocode?q=adresa ─────────────────────────────────────
// Server-side proxy na Nominatim (kvůli povinnému User-Agentu a CORS).
// Vrací pár návrhů pro našeptávač adresy na webu.
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [] });
  try {
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=jsonv2&addressdetails=1&limit=6&accept-language=cs&countrycodes=cz,sk&q='
      + encodeURIComponent(q);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    const results = (Array.isArray(j) ? j : []).map((x) => {
      const a = x.address || {};
      return {
        label: x.display_name || '',
        lat: parseFloat(x.lat),
        lon: parseFloat(x.lon),
        city: a.city || a.town || a.village || a.municipality || '',
        zip: a.postcode || '',
      };
    }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
    res.json({ results });
  } catch (e) {
    console.warn('[lokality] geocode selhal:', e && e.message);
    res.json({ results: [] });
  }
});

// ─── POST /api/lokality/offer ───────────────────────────────────────────────
const pointSchema = z.object({ lat: z.number().finite(), lng: z.number().finite() });
const offerSchema = z.object({
  owner_name: z.string().trim().min(2).max(200),
  owner_phone: z.string().trim().max(40).optional().or(z.literal('')),
  owner_email: z.string().trim().email().max(200).optional().or(z.literal('')),
  address: z.string().trim().min(3).max(500),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  zip: z.string().trim().max(10).optional().or(z.literal('')),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  footprint_rotation: z.number().finite().optional(),
  is_owner: z.boolean().optional(),
  deal_type: z.enum(['rent', 'purchase', 'other']).optional(),
  electricity: z.boolean().optional(),
  water: z.boolean().optional(),
  sewage: z.boolean().optional(),
  parking: z.boolean().optional(),
  // Body přípojek označené na mapě (volitelné, každý klíč volitelný).
  utility_points: z.object({
    electricity: pointSchema.nullable().optional(),
    water: pointSchema.nullable().optional(),
    sewage: pointSchema.nullable().optional(),
    parking: pointSchema.nullable().optional(),
  }).partial().optional(),
  note: z.string().trim().max(4000).optional().or(z.literal('')),
});

router.post('/offer', async (req, res, next) => {
  try {
    const parsed = offerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Zkontroluj prosím vyplněná pole.' });
    }
    const d = parsed.data;
    const phone = (d.owner_phone || '').trim();
    const email = (d.owner_email || '').trim();
    if (!phone && !email) {
      return res.status(400).json({ ok: false, error: 'Uveď prosím telefon nebo e-mail, ať se ti můžeme ozvat.' });
    }

    const lat = d.latitude, lng = d.longitude;
    const mapLink = 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=19/' + lat + '/' + lng;
    const name = ('Nabídka: ' + (d.city ? d.city + ' — ' : '') + d.owner_name).slice(0, 255);

    // Body přípojek — jen platné {lat,lng}. Označený bod zároveň znamená „k dispozici".
    const up = d.utility_points || {};
    const pts = {};
    for (const k of ['electricity', 'water', 'sewage', 'parking']) {
      if (up[k] && Number.isFinite(up[k].lat) && Number.isFinite(up[k].lng)) {
        pts[k] = { lat: Number(up[k].lat.toFixed(7)), lng: Number(up[k].lng.toFixed(7)) };
      }
    }
    const has = (k, flag) => Boolean(flag) || Boolean(pts[k]);
    const electricity = has('electricity', d.electricity);
    const water = has('water', d.water);
    const sewage = has('sewage', d.sewage);
    const parking = has('parking', d.parking);
    const yn = (v) => (v ? 'ano' : 'neuvedeno');
    const withPin = (k) => (pts[k] ? ' (📍 na mapě)' : '');

    const site = await prisma.site.create({
      data: {
        name,
        site_type: d.deal_type || 'rent',
        status: 'lead',
        public_source: 'bestseries.global',
        description: d.note || null,
        address: d.address,
        city: d.city || null,
        zip: d.zip || null,
        country: 'CZ',
        latitude: lat.toFixed(7),
        longitude: lng.toFixed(7),
        map_link: mapLink,
        owner_name: d.owner_name,
        owner_phone: phone || null,
        owner_email: email || null,
        owner_note: d.note || null,
        area_m2: '6.40',
        water_supply: water,
        sewage: sewage,
        parking: parking,
        footprint_rotation: (d.footprint_rotation != null) ? Number(d.footprint_rotation).toFixed(2) : null,
        footprint_w_mm: 3182,
        footprint_h_mm: 2015,
        utility_points: Object.keys(pts).length ? pts : null,
        is_property_owner: (typeof d.is_owner === 'boolean') ? d.is_owner : null,
        capacity_note: [
          'Elektřina: ' + yn(electricity) + withPin('electricity'),
          'Voda: ' + yn(water) + withPin('water'),
          'Kanalizace: ' + yn(sewage) + withPin('sewage'),
          'Parkoviště v dosahu: ' + yn(parking) + withPin('parking'),
        ].join(' · '),
      },
      select: { id: true },
    });

    // Velín push + zvonek — VŽDY Jan + Tomáš (majitelé). Informativní shrnutí nabídky.
    const ownerTxt = (d.is_owner === true) ? 'Ano' : (d.is_owner === false ? 'Ne' : 'neuvedeno');
    const dealTxt = { rent: 'Pronájem', purchase: 'Prodej pozemku', other: 'Zatím neví' }[d.deal_type || 'rent'];
    const utilTxt = Object.keys(pts).length
      ? Object.keys(pts).map((k) => ({ electricity: 'elektřina', water: 'voda', sewage: 'kanalizace', parking: 'parkoviště' }[k])).join(', ')
      : 'neoznačeny';
    notifyLocationOwners(prisma, {
      title: '📍 Nová nabídka lokality' + (d.city ? (' — ' + d.city) : ''),
      body: d.owner_name + ' nabízí místo pro prádlomat.'
        + '\nZájem: ' + dealTxt
        + '\nAdresa: ' + d.address
        + '\nVlastník místa: ' + ownerTxt
        + '\nKontakt: ' + (phone || '—') + (email ? (' · ' + email) : '')
        + '\nPřípojky na mapě: ' + utilTxt,
      data: { type: 'site_offer', site_id: site.id },
    }).catch((e) => console.error('[lokality] velín notifikace:', e && e.message));

    console.log('[lokality] Nová veřejná nabídka lokality #' + site.id + ' — ' + d.address + ' (ip ' + clientIp(req) + ')');
    return res.status(201).json({ ok: true, id: site.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
