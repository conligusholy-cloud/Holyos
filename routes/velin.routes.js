// =============================================================================
// HolyOS — Velín: REST API (admin + mobile)
// =============================================================================
// Mountnuto v app.js pod /api/velin. Endpointy se dělí na:
//
//   /admin/* — autentizováno přes HolyOS JWT (requireAuth). Vedoucí/admin
//              spravují plány, úkoly, aktivace zařízení, skill profily.
//
//   /devices/activate (POST) — bez auth, jen s aktivačním kódem (kolega
//              ho dostal od admina). Vrací plain device token (1× v životě).
//
//   /* (mobile) — autentizováno přes requireVelinDevice (Bearer device token).
//
// Pravidlo z paměti: pevné podcesty pod /:id musí jít NAD dynamickou route.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { requireVelinAuth } = require('../middleware/velin-auth');
const {
  generateActivationCode,
  generateDeviceToken,
  hashSecret,
  verifySecret,
  activationExpiresAt,
  isPinValidFormat,
} = require('../services/velin/auth');
const scheduler = require('../services/workers/velin-scheduler');
const r2 = require('../services/storage/r2');
const velinBridge = require('../services/planning/velin-bridge');

// Multer in-memory storage pro chat attachmenty (max 15 MB).
// Nepoužíváme disk — soubor jde rovnou z paměti do R2 a buffer se uvolní.
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// ─── Helpers ─────────────────────────────────────────────────────────────

// Vrátí Date objekt ukazující na UTC půlnoc *pražského* kalendářního dne.
// Důvod: PostgreSQL DATE sloupec ukládá jen kalendářní den; když na Railway (UTC)
// uděláme `new Date().setHours(0,0,0,0)`, dostaneme UTC midnight, který v CES
// odpovídá včerejšku (pokud je čas mezi 22:00 a 24:00 lokálně). Tím by se úkoly
// zakládaly pod předchozí den. Tady to počítáme přes Intl s Europe/Prague.
function startOfToday() {
  const tz = process.env.VELIN_TZ || 'Europe/Prague';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  // en-CA formátuje jako "YYYY-MM-DD"
  return new Date(parts + 'T00:00:00Z');
}

function asDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

// Krátké public info o Person pro chat / detail úkolu (žádné citlivé údaje)
function publicPerson(p) {
  if (!p) return null;
  return {
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    photo_url: p.photo_url || null,
  };
}

// =============================================================================
// 1) ADMIN endpoints — vyžadují HolyOS JWT (web UI)
// =============================================================================
const admin = express.Router();
admin.use(requireAuth);

// ─── Aktivace zařízení ──────────────────────────────────────────────────
// POST /api/velin/admin/activation/:personId
// Vygeneruje nový 6-místný aktivační kód pro Person, uloží do DB s expirací.
// Pokud osoba má aktivní zařízení, kód jen prodlouží registraci (a starý kód
// invaliduje). Activation code se vrací v response — admin ho předá kolegovi.
admin.post('/activation/:personId', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.personId, 10);
    if (!Number.isFinite(personId)) return res.status(400).json({ error: 'Neplatné personId' });
    const person = await prisma.person.findUnique({ where: { id: personId } });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });
    if (!person.active) return res.status(400).json({ error: 'Osoba je deaktivovaná' });

    const code = generateActivationCode();
    const expires = activationExpiresAt();
    await prisma.person.update({
      where: { id: personId },
      data: {
        velin_activation_code: code,
        velin_activation_expires_at: expires,
      },
    });

    res.json({
      person_id: personId,
      activation_code: code,
      expires_at: expires.toISOString(),
      note: 'Předejte kód kolegovi. Po expiraci nebo aktivaci ho už nepůjde použít.',
    });
  } catch (err) { next(err); }
});

// DELETE /api/velin/admin/activation/:personId
// Zruší pending aktivaci (kdyby admin špatně klikl)
admin.delete('/activation/:personId', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.personId, 10);
    if (!Number.isFinite(personId)) return res.status(400).json({ error: 'Neplatné personId' });
    await prisma.person.update({
      where: { id: personId },
      data: {
        velin_activation_code: null,
        velin_activation_expires_at: null,
      },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/velin/admin/devices
// Přehled všech registrovaných zařízení (kdo, jaký telefon, kdy naposled)
admin.get('/devices', async (req, res, next) => {
  try {
    const devices = await prisma.deviceRegistration.findMany({
      orderBy: [{ active: 'desc' }, { last_seen_at: 'desc' }],
      include: { person: { select: { id: true, first_name: true, last_name: true } } },
    });
    res.json({
      devices: devices.map((d) => ({
        id: d.id,
        person: publicPerson(d.person),
        platform: d.platform,
        device_label: d.device_label,
        app_version: d.app_version,
        os_version: d.os_version,
        last_seen_at: d.last_seen_at,
        active: d.active,
        revoked_at: d.revoked_at,
        revoke_reason: d.revoke_reason,
        created_at: d.created_at,
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/velin/admin/devices/:id/revoke
admin.post('/devices/:id/revoke', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const reason = (req.body && req.body.reason) || 'admin_revoke';
    await prisma.deviceRegistration.update({
      where: { id },
      data: { active: false, revoked_at: new Date(), revoke_reason: String(reason).slice(0, 255) },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Live day — kdo co dělá teď ─────────────────────────────────────────
// GET /api/velin/admin/live-day
admin.get('/live-day', async (req, res, next) => {
  try {
    const dateParam = asDate(req.query.date);
    const date = dateParam || startOfToday();
    const plans = await prisma.dailyPlan.findMany({
      where: { date },
      include: {
        person: { select: { id: true, first_name: true, last_name: true, photo_url: true } },
        assignments: {
          orderBy: [{ priority: 'asc' }, { due_at: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: { person_id: 'asc' },
    });
    res.json({ date, plans });
  } catch (err) { next(err); }
});

// ─── Manuální úkol od vedoucího ─────────────────────────────────────────
// POST /api/velin/admin/tasks
const adminCreateTaskSchema = z.object({
  person_id: z.number().int().positive(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  estimated_min: z.number().int().min(1).max(60 * 24).optional(),
  due_at: z.string().datetime().optional(),
  location_hint: z.string().max(255).optional(),
  requires_gps_fence: z.boolean().optional(),
  fence_id: z.number().int().positive().optional(),
  push: z.boolean().optional(), // default true
});

admin.post('/tasks', async (req, res, next) => {
  try {
    const parsed = adminCreateTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný vstup', details: parsed.error.format() });
    const body = parsed.data;

    const person = await prisma.person.findUnique({ where: { id: body.person_id } });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });

    // Najdi (nebo vytvoř) dnešní plán
    const today = startOfToday();
    const plan = await prisma.dailyPlan.upsert({
      where: { person_id_date: { person_id: body.person_id, date: today } },
      create: { person_id: body.person_id, date: today, generated_by: 'manager', status: 'published' },
      update: {},
    });

    const creatorPersonId = req.user?.person?.id || null;
    const task = await prisma.taskAssignment.create({
      data: {
        daily_plan_id: plan.id,
        person_id: body.person_id,
        created_by: 'manager',
        created_by_person_id: creatorPersonId,
        source: 'manager',
        title: body.title,
        description: body.description,
        priority: body.priority ?? 3,
        estimated_min: body.estimated_min,
        due_at: body.due_at ? new Date(body.due_at) : null,
        location_hint: body.location_hint,
        requires_gps_fence: !!body.requires_gps_fence,
        fence_id: body.fence_id || null,
        status: 'proposed',
      },
    });

    // Push (default true)
    if (body.push !== false) {
      const { notifyPerson } = require('../services/push/expo-push');
      notifyPerson(prisma, body.person_id, {
        title: 'Nový úkol',
        body: task.title,
        data: { kind: 'task_assigned', task_id: task.id },
      }).catch((e) => console.warn('[velin] push notifyPerson:', e.message));
    }

    res.status(201).json({ task });
  } catch (err) { next(err); }
});

// ─── Skill profily ───────────────────────────────────────────────────────
admin.get('/skill-profiles', async (req, res, next) => {
  try {
    const profiles = await prisma.personSkillProfile.findMany({
      include: { person: { select: { id: true, first_name: true, last_name: true } } },
    });
    res.json({ profiles });
  } catch (err) { next(err); }
});

admin.put('/skill-profiles/:personId', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.personId, 10);
    if (!Number.isFinite(personId)) return res.status(400).json({ error: 'Neplatné personId' });
    const data = req.body || {};
    const upserted = await prisma.personSkillProfile.upsert({
      where: { person_id: personId },
      create: {
        person_id: personId,
        skills: data.skills ?? [],
        preferred_shift: data.preferred_shift || null,
        speed_factor: typeof data.speed_factor === 'number' ? data.speed_factor : 1.0,
        notes: data.notes || null,
      },
      update: {
        skills: data.skills ?? undefined,
        preferred_shift: data.preferred_shift ?? undefined,
        speed_factor: typeof data.speed_factor === 'number' ? data.speed_factor : undefined,
        notes: data.notes ?? undefined,
      },
    });
    res.json({ profile: upserted });
  } catch (err) { next(err); }
});

// ─── GeoFence CRUD ───────────────────────────────────────────────────────
admin.get('/fences', async (req, res, next) => {
  try {
    const fences = await prisma.geoFence.findMany({ orderBy: { id: 'asc' } });
    res.json({ fences });
  } catch (err) { next(err); }
});

admin.post('/fences', async (req, res, next) => {
  try {
    const { name, center_lat, center_lng, radius_m, notes } = req.body || {};
    if (!name || typeof center_lat !== 'number' || typeof center_lng !== 'number') {
      return res.status(400).json({ error: 'name, center_lat, center_lng jsou povinné' });
    }
    const fence = await prisma.geoFence.create({
      data: {
        name: String(name).slice(0, 255),
        center_lat,
        center_lng,
        radius_m: Number.isFinite(radius_m) ? radius_m : 150,
        notes: notes || null,
      },
    });
    res.status(201).json({ fence });
  } catch (err) { next(err); }
});

admin.put('/fences/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const { name, center_lat, center_lng, radius_m, active, notes } = req.body || {};
    const fence = await prisma.geoFence.update({
      where: { id },
      data: {
        name: name ?? undefined,
        center_lat: typeof center_lat === 'number' ? center_lat : undefined,
        center_lng: typeof center_lng === 'number' ? center_lng : undefined,
        radius_m: Number.isFinite(radius_m) ? radius_m : undefined,
        active: typeof active === 'boolean' ? active : undefined,
        notes: notes ?? undefined,
      },
    });
    res.json({ fence });
  } catch (err) { next(err); }
});

// ─── Manual triggery (pro testing scheduleru) ────────────────────────────
admin.post('/trigger/morning-generate', async (req, res, next) => {
  try { await scheduler.handleMorningGenerate(); res.json({ ok: true }); } catch (e) { next(e); }
});
admin.post('/trigger/morning-push', async (req, res, next) => {
  try { await scheduler.handleMorningPush(); res.json({ ok: true }); } catch (e) { next(e); }
});
admin.post('/trigger/evening-push', async (req, res, next) => {
  try { await scheduler.handleEveningPush(); res.json({ ok: true }); } catch (e) { next(e); }
});

// ─── Večerní reflexe — admin view ───────────────────────────────────────────
//
// GET /api/velin/admin/reflections?from=YYYY-MM-DD&to=YYYY-MM-DD&person_id=<id>
//
// Vrací list reflexí s person.first_name/last_name pro tabulku v admin UI.
// Default rozsah: posledních 7 dní. Person filtr volitelný.
//
// Response: {
//   reflections: [{ id, date, mood, energy, wins, struggles, tomorrow_focus,
//                    free_text, ai_summary, submitted_at, person: {...} }],
//   stats: {
//     by_person: [{ person_id, name, count, avg_mood, avg_energy, last_date }],
//     total: { count, avg_mood, avg_energy }
//   }
// }
admin.get('/reflections', async (req, res, next) => {
  try {
    // Default = posledních 7 dní (včetně dneška)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenAgo = new Date(today);
    sevenAgo.setDate(sevenAgo.getDate() - 6);

    const fromStr = String(req.query.from || '').trim();
    const toStr = String(req.query.to || '').trim();
    const from = fromStr ? new Date(fromStr) : sevenAgo;
    const to = toStr ? new Date(toStr) : today;
    // Inkluzivní `to` — přidej 23:59:59 ať se zachytí celý den
    to.setHours(23, 59, 59, 999);

    const personId = req.query.person_id ? parseInt(req.query.person_id, 10) : null;

    const where = {
      date: { gte: from, lte: to },
      ...(personId ? { person_id: personId } : {}),
    };

    const reflections = await prisma.eveningReflection.findMany({
      where,
      include: {
        person: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
      },
      orderBy: [{ date: 'desc' }, { submitted_at: 'desc' }],
    });

    // Agregace per person
    const byPersonMap = new Map();
    for (const r of reflections) {
      const pid = r.person_id;
      if (!byPersonMap.has(pid)) {
        byPersonMap.set(pid, {
          person_id: pid,
          name: `${r.person?.first_name || ''} ${r.person?.last_name || ''}`.trim() || `#${pid}`,
          count: 0,
          mood_sum: 0,
          mood_count: 0,
          energy_sum: 0,
          energy_count: 0,
          last_date: null,
        });
      }
      const entry = byPersonMap.get(pid);
      entry.count += 1;
      if (typeof r.mood === 'number') {
        entry.mood_sum += r.mood;
        entry.mood_count += 1;
      }
      if (typeof r.energy === 'number') {
        entry.energy_sum += r.energy;
        entry.energy_count += 1;
      }
      if (!entry.last_date || r.date > entry.last_date) entry.last_date = r.date;
    }
    const by_person = Array.from(byPersonMap.values()).map((p) => ({
      person_id: p.person_id,
      name: p.name,
      count: p.count,
      avg_mood: p.mood_count ? +(p.mood_sum / p.mood_count).toFixed(2) : null,
      avg_energy: p.energy_count ? +(p.energy_sum / p.energy_count).toFixed(2) : null,
      last_date: p.last_date,
    })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Celkový průměr
    let mood_sum = 0, mood_count = 0, energy_sum = 0, energy_count = 0;
    for (const r of reflections) {
      if (typeof r.mood === 'number') { mood_sum += r.mood; mood_count += 1; }
      if (typeof r.energy === 'number') { energy_sum += r.energy; energy_count += 1; }
    }
    const total = {
      count: reflections.length,
      avg_mood: mood_count ? +(mood_sum / mood_count).toFixed(2) : null,
      avg_energy: energy_count ? +(energy_sum / energy_count).toFixed(2) : null,
    };

    res.json({
      from,
      to,
      reflections,
      stats: { by_person, total },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Docházka — admin view (Fáze 3) ────────────────────────────────────────
//
// GET /api/velin/admin/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&person_id=<id>
//
// Vrací punches v rozsahu + day-by-day souhrn per person (kdo přišel kdy,
// poslední odchod, suma hodin).
admin.get('/attendance', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenAgo = new Date(today);
    sevenAgo.setDate(sevenAgo.getDate() - 6);

    const fromStr = String(req.query.from || '').trim();
    const toStr = String(req.query.to || '').trim();
    const from = fromStr ? new Date(fromStr) : sevenAgo;
    const to = toStr ? new Date(toStr) : today;
    to.setHours(23, 59, 59, 999);

    const personId = req.query.person_id ? parseInt(req.query.person_id, 10) : null;

    const where = {
      punched_at: { gte: from, lte: to },
      ...(personId ? { person_id: personId } : {}),
    };

    const punches = await prisma.attendancePunch.findMany({
      where,
      include: {
        person: { select: { id: true, first_name: true, last_name: true, photo_url: true } },
        fence: { select: { id: true, name: true } },
      },
      orderBy: [{ punched_at: 'asc' }],
    });

    // Souhrn per (person, date): první 'in' = arrival, poslední 'out' = departure
    const dayMap = new Map(); // key: `${person_id}|${YYYY-MM-DD}`
    for (const p of punches) {
      const dateStr = p.punched_at.toISOString().slice(0, 10);
      const key = `${p.person_id}|${dateStr}`;
      if (!dayMap.has(key)) {
        dayMap.set(key, {
          person_id: p.person_id,
          name: `${p.person?.first_name || ''} ${p.person?.last_name || ''}`.trim() || `#${p.person_id}`,
          date: dateStr,
          first_in: null,
          last_out: null,
          punch_count: 0,
          inside_fence_count: 0,
          sources: new Set(),
        });
      }
      const entry = dayMap.get(key);
      entry.punch_count += 1;
      if (p.inside_fence) entry.inside_fence_count += 1;
      entry.sources.add(p.source);
      if (p.kind === 'in' && !entry.first_in) entry.first_in = p.punched_at;
      if (p.kind === 'out') entry.last_out = p.punched_at;
    }

    const summary = Array.from(dayMap.values())
      .map((d) => ({
        ...d,
        sources: Array.from(d.sources),
        hours_in_provoz: d.first_in && d.last_out
          ? +((d.last_out.getTime() - d.first_in.getTime()) / (1000 * 60 * 60)).toFixed(2)
          : null,
      }))
      .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date)));

    res.json({ from, to, punches, summary });
  } catch (err) {
    next(err);
  }
});

router.use('/admin', admin);

// =============================================================================
// 2) Aktivace zařízení (bez auth — jen kód + PIN)
// =============================================================================
const activateSchema = z.object({
  activation_code: z.string().regex(/^\d{6}$/),
  pin: z.string(),
  expo_push_token: z.string(),
  platform: z.enum(['ios', 'android']),
  device_label: z.string().max(255).optional(),
  app_version: z.string().max(30).optional(),
  os_version: z.string().max(30).optional(),
});

// POST /api/velin/devices/activate
router.post('/devices/activate', async (req, res, next) => {
  try {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný vstup', details: parsed.error.format() });
    const body = parsed.data;

    if (!isPinValidFormat(body.pin)) {
      return res.status(400).json({ error: 'PIN musí být 4–8 číslic' });
    }

    const person = await prisma.person.findFirst({
      where: { velin_activation_code: body.activation_code, active: true },
    });
    if (!person) return res.status(404).json({ error: 'Aktivační kód neplatný nebo expirovaný' });
    if (!person.velin_activation_expires_at || person.velin_activation_expires_at < new Date()) {
      return res.status(410).json({ error: 'Aktivační kód expiroval — vyžádejte si nový' });
    }

    // Hash PINu a device tokenu
    const pinHash = await hashSecret(body.pin);
    const deviceToken = generateDeviceToken();
    const deviceTokenHash = await hashSecret(deviceToken);

    // Atomická transakce — Person PIN + activation cleanup + DeviceRegistration
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: person.id },
        data: {
          velin_pin_hash: pinHash,
          velin_activation_code: null,
          velin_activation_expires_at: null,
          velin_activated_at: new Date(),
        },
      });
      // Pokud už zařízení s tímto push tokenem existuje, reaktivuj ho.
      const existing = await tx.deviceRegistration.findUnique({
        where: { expo_push_token: body.expo_push_token },
      });
      if (existing) {
        await tx.deviceRegistration.update({
          where: { id: existing.id },
          data: {
            person_id: person.id,
            device_token_hash: deviceTokenHash,
            platform: body.platform,
            device_label: body.device_label || null,
            app_version: body.app_version || null,
            os_version: body.os_version || null,
            active: true,
            revoked_at: null,
            revoke_reason: null,
            last_seen_at: new Date(),
          },
        });
      } else {
        await tx.deviceRegistration.create({
          data: {
            person_id: person.id,
            expo_push_token: body.expo_push_token,
            device_token_hash: deviceTokenHash,
            platform: body.platform,
            device_label: body.device_label || null,
            app_version: body.app_version || null,
            os_version: body.os_version || null,
          },
        });
      }
    });

    res.json({
      ok: true,
      device_token: deviceToken,  // plain — kolega uloží do keychainu
      person: {
        id: person.id,
        first_name: person.first_name,
        last_name: person.last_name,
        photo_url: person.photo_url || null,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/velin/devices/login
// Re-login na stejném zařízení: jen ověří PIN proti Person a vydá nový device_token.
const loginSchema = z.object({
  person_id: z.number().int().positive(),
  pin: z.string(),
  expo_push_token: z.string(),
});
router.post('/devices/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný vstup' });
    const { person_id, pin, expo_push_token } = parsed.data;
    const person = await prisma.person.findUnique({ where: { id: person_id } });
    if (!person || !person.active) return res.status(404).json({ error: 'Osoba nenalezena' });
    const ok = await verifySecret(pin, person.velin_pin_hash);
    if (!ok) return res.status(401).json({ error: 'Špatný PIN' });

    const newToken = generateDeviceToken();
    const newHash = await hashSecret(newToken);
    await prisma.deviceRegistration.updateMany({
      where: { expo_push_token, person_id },
      data: { device_token_hash: newHash, active: true, last_seen_at: new Date() },
    });
    res.json({ ok: true, device_token: newToken });
  } catch (err) { next(err); }
});

// =============================================================================
// 2b) Registrace zařízení po HolyOS přihlášení (Fáze 0c primární cesta)
// =============================================================================
// Mobil se přihlásí přes /api/auth/login (HolyOS username + password), uloží
// JWT do SecureStore, a hned poté zavolá /api/velin/devices/register s tímto
// JWT v Authorization headeru. Endpoint upsertne DeviceRegistration vázanou
// na Person přihlášeného Usera. Tím získá HolyOS evidenci jeho zařízení a
// scheduler na něj může pushovat. JWT se používá i pro další volání.

const registerDeviceSchema = z.object({
  expo_push_token: z.string(),
  platform: z.enum(['ios', 'android']),
  device_label: z.string().max(255).optional(),
  app_version: z.string().max(30).optional(),
  os_version: z.string().max(30).optional(),
});

router.post('/devices/register', requireAuth, async (req, res, next) => {
  try {
    if (!req.user?.person?.id) {
      return res.status(403).json({ error: 'Tvůj účet nemá propojený Person record — zařízení nelze registrovat' });
    }
    const parsed = registerDeviceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný vstup', details: parsed.error.format() });
    const body = parsed.data;
    const personId = req.user.person.id;

    // device_token_hash je v této cestě nepoužívaný (auth jde přes JWT), ale
    // model ho vyžaduje NOT NULL. Uložíme placeholder bcrypt hash náhodné
    // hodnoty — nikdy ho nikdo neověřuje (JWT se ověřuje proti User tabulce).
    const placeholder = await hashSecret(generateDeviceToken());

    const existing = await prisma.deviceRegistration.findUnique({
      where: { expo_push_token: body.expo_push_token },
    });
    let device;
    if (existing) {
      device = await prisma.deviceRegistration.update({
        where: { id: existing.id },
        data: {
          person_id: personId,
          platform: body.platform,
          device_label: body.device_label || existing.device_label,
          app_version: body.app_version || existing.app_version,
          os_version: body.os_version || existing.os_version,
          active: true,
          revoked_at: null,
          revoke_reason: null,
          last_seen_at: new Date(),
        },
      });
    } else {
      device = await prisma.deviceRegistration.create({
        data: {
          person_id: personId,
          expo_push_token: body.expo_push_token,
          device_token_hash: placeholder,
          platform: body.platform,
          device_label: body.device_label || null,
          app_version: body.app_version || null,
          os_version: body.os_version || null,
        },
      });
    }

    res.status(201).json({
      ok: true,
      device: {
        id: device.id,
        platform: device.platform,
        device_label: device.device_label,
      },
    });
  } catch (err) { next(err); }
});

// =============================================================================
// 3) MOBILE endpoints — vyžadují HolyOS JWT NEBO device token (hybrid)
// =============================================================================
const mobile = express.Router();
mobile.use(requireVelinAuth);

// GET /api/velin/me
mobile.get('/me', async (req, res) => {
  const p = req.velin.person;
  res.json({
    person: {
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      photo_url: p.photo_url || null,
      quiet_from: p.velin_quiet_from || null,
      quiet_to: p.velin_quiet_to || null,
    },
    device: { id: req.velin.device.id, platform: req.velin.device.platform },
  });
});

// GET /api/velin/my-day
mobile.get('/my-day', async (req, res, next) => {
  try {
    const today = startOfToday();
    const personId = req.velin.person.id;
    const plan = await prisma.dailyPlan.findUnique({
      where: { person_id_date: { person_id: personId, date: today } },
      include: {
        assignments: {
          orderBy: [{ priority: 'asc' }, { due_at: 'asc' }, { id: 'asc' }],
        },
      },
    });
    // Nesplněné úkoly z minulých dnů
    const overdue = await prisma.taskAssignment.findMany({
      where: {
        person_id: personId,
        status: { in: ['proposed', 'accepted', 'in_progress', 'blocked'] },
        OR: [
          { daily_plan: { date: { lt: today } } },
          { due_at: { lt: today } },
        ],
      },
      orderBy: { id: 'asc' },
    });
    res.json({ date: today, plan, overdue });
  } catch (err) { next(err); }
});

// Pevné podcesty PŘED dynamickou /:id !
mobile.post('/tasks/self', async (req, res, next) => {
  try {
    const { title, description, priority, estimated_min } = req.body || {};
    if (!title || String(title).trim().length === 0) return res.status(400).json({ error: 'Chybí title' });
    const today = startOfToday();
    const personId = req.velin.person.id;
    const plan = await prisma.dailyPlan.upsert({
      where: { person_id_date: { person_id: personId, date: today } },
      create: { person_id: personId, date: today, generated_by: 'self', status: 'published' },
      update: {},
    });
    const task = await prisma.taskAssignment.create({
      data: {
        daily_plan_id: plan.id,
        person_id: personId,
        created_by: 'self',
        created_by_person_id: personId,
        source: 'self',
        title: String(title).slice(0, 500),
        description: description || null,
        priority: priority || 3,
        estimated_min: Number.isFinite(estimated_min) ? estimated_min : null,
        status: 'accepted',
        accepted_at: new Date(),
      },
    });
    res.status(201).json({ task });
  } catch (err) { next(err); }
});

// GET /api/velin/tasks/:id
mobile.get('/tasks/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const task = await prisma.taskAssignment.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
          include: { author: { select: { id: true, first_name: true, last_name: true, photo_url: true } } },
        },
        feedback: true,
        creator_person: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    if (task.person_id !== req.velin.person.id) {
      return res.status(403).json({ error: 'Tento úkol není přidělen tobě' });
    }

    // Pokud úkol pochází z plánovače (source='production', source_ref_type='BatchOperation'),
    // dopočítej info o dávce: číslo + produkt + pracoviště. Použito v mobilu pro
    // badge 🏭 + číslo dávky + pracoviště u úkolu (Krok D Fáze 4).
    let batchInfo = null;
    if (task.source === 'production' && task.source_ref_type === 'BatchOperation' && task.source_ref_id) {
      try {
        const op = await prisma.batchOperation.findUnique({
          where: { id: task.source_ref_id },
          select: {
            id: true,
            status: true,
            planned_start: true,
            planned_end: true,
            batch: {
              select: {
                id: true,
                batch_number: true,
                quantity: true,
                product: { select: { id: true, name: true, code: true } },
              },
            },
            operation: { select: { id: true, name: true } },
            workstation: { select: { id: true, name: true } },
          },
        });
        if (op) {
          batchInfo = {
            batch_operation_id: op.id,
            op_status: op.status,
            planned_start: op.planned_start,
            planned_end: op.planned_end,
            operation_name: op.operation?.name || null,
            batch_id: op.batch?.id || null,
            batch_number: op.batch?.batch_number || null,
            batch_quantity: op.batch?.quantity || null,
            product_name: op.batch?.product?.name || null,
            product_code: op.batch?.product?.code || null,
            workstation_name: op.workstation?.name || null,
          };
        }
      } catch (e) {
        console.warn('[velin] batchInfo lookup selhal:', e.message);
      }
    }

    res.json({ task, batchInfo });
  } catch (err) { next(err); }
});

async function transitionTask(req, res, next, opts) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const task = await prisma.taskAssignment.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    if (task.person_id !== req.velin.person.id) {
      return res.status(403).json({ error: 'Tento úkol není přidělen tobě' });
    }
    const data = opts.data(task, req);
    const updated = await prisma.taskAssignment.update({ where: { id }, data });

    // Round-trip do plánovače: pokud má úkol source_ref_type='BatchOperation'
    // a opts.bridgeAction je definovaná, propíšeme status zpět do BatchOperation.
    // Bridge je idempotentní a tichý — chyba zde nesmí shodit celý request.
    if (opts.bridgeAction && updated.source_ref_type === 'BatchOperation' && updated.source_ref_id) {
      try {
        const bridgePayload = opts.bridgePayload ? opts.bridgePayload(updated, req) : {};
        await velinBridge.propagateTaskStatusToBatchOperation(
          updated.id,
          opts.bridgeAction,
          bridgePayload
        );
      } catch (e) {
        console.warn('[velin/transitionTask] back-prop do BatchOperation selhal:', e.message);
      }
    }

    res.json({ task: updated });
  } catch (err) { next(err); }
}

mobile.post('/tasks/:id/accept', (req, res, next) =>
  transitionTask(req, res, next, {
    data: () => ({ status: 'accepted', accepted_at: new Date() }),
    // accept = jen kolega potvrdil "ano udělám" → BatchOperation zůstává planned
  }));

mobile.post('/tasks/:id/start', (req, res, next) =>
  transitionTask(req, res, next, {
    data: () => ({ status: 'in_progress', started_at: new Date(), accepted_at: undefined }),
    bridgeAction: 'start',
  }));

mobile.post('/tasks/:id/block', (req, res, next) =>
  transitionTask(req, res, next, {
    data: (task, r) => ({
      status: 'blocked',
      blocked_at: new Date(),
      blocked_reason: (r.body && String(r.body.reason || '').slice(0, 5000)) || 'bez důvodu',
    }),
    bridgeAction: 'block',
    bridgePayload: (task, r) => ({
      reason: (r.body && String(r.body.reason || '').slice(0, 5000)) || 'bez důvodu',
    }),
  }));

mobile.post('/tasks/:id/complete', (req, res, next) =>
  transitionTask(req, res, next, {
    data: (task, r) => ({
      status: 'done',
      completed_at: new Date(),
      actual_min: Number.isFinite(r.body?.actual_min) ? r.body.actual_min : null,
    }),
    bridgeAction: 'complete',
    bridgePayload: (task, r) => ({
      actual_min: Number.isFinite(r.body?.actual_min) ? r.body.actual_min : undefined,
    }),
  }));

mobile.post('/tasks/:id/messages', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const body = req.body || {};
    if (!body.body || String(body.body).trim().length === 0) {
      return res.status(400).json({ error: 'Chybí body' });
    }
    const task = await prisma.taskAssignment.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    if (task.person_id !== req.velin.person.id) {
      return res.status(403).json({ error: 'Tento úkol není přidělen tobě' });
    }
    const msg = await prisma.taskMessage.create({
      data: {
        task_id: id,
        author_kind: 'person',
        author_person_id: req.velin.person.id,
        body: String(body.body).slice(0, 10000),
        attachments: body.attachments || null,
      },
    });
    res.status(201).json({ message: msg });
  } catch (err) { next(err); }
});

// GET /api/velin/feedback/evening?date=YYYY-MM-DD (default: dnes)
// Vrátí už uloženou reflexi pro daný den, nebo null (pro pre-fill ve screen).
mobile.get('/feedback/evening', async (req, res, next) => {
  try {
    let date;
    if (req.query.date) {
      date = new Date(String(req.query.date));
      date.setHours(0, 0, 0, 0);
    } else {
      date = startOfToday();
    }
    const personId = req.velin.person.id;
    const reflection = await prisma.eveningReflection.findUnique({
      where: { person_id_date: { person_id: personId, date } },
    });
    res.json({ reflection: reflection || null, date });
  } catch (err) { next(err); }
});

// POST /api/velin/feedback/evening
mobile.post('/feedback/evening', async (req, res, next) => {
  try {
    const today = startOfToday();
    const personId = req.velin.person.id;
    const body = req.body || {};
    const upserted = await prisma.eveningReflection.upsert({
      where: { person_id_date: { person_id: personId, date: today } },
      create: {
        person_id: personId,
        date: today,
        mood: body.mood ?? null,
        energy: body.energy ?? null,
        wins: body.wins || null,
        struggles: body.struggles || null,
        tomorrow_focus: body.tomorrow_focus || null,
        free_text: body.free_text || null,
      },
      update: {
        mood: body.mood ?? undefined,
        energy: body.energy ?? undefined,
        wins: body.wins ?? undefined,
        struggles: body.struggles ?? undefined,
        tomorrow_focus: body.tomorrow_focus ?? undefined,
        free_text: body.free_text ?? undefined,
        submitted_at: new Date(),
      },
    });
    res.json({ reflection: upserted });
  } catch (err) { next(err); }
});

// POST /api/velin/fences/from-here
//
// Vytvoří nový GeoFence ze souřadnic, které klient pošle (typicky z mobilní
// GPS). Restrict na admin/super-admin/manager — běžný kolega nemá smysl
// definovat provoz. Mobile UI tlačítko zobrazujeme jen těmto rolím.
//
// Body: { name: string, lat: number, lng: number, radius_m?: number = 150 }
mobile.post('/fences/from-here', async (req, res, next) => {
  try {
    const u = req.user || {};
    const isAdmin = u.isSuperAdmin === true
      || u.role === 'admin'
      || u.role === 'super_admin'
      || u.role === 'manager';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Provoz může vytvořit jen vedoucí.' });
    }
    const { name, lat, lng, radius_m, notes } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Chybí název provozu' });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'Chybí lat/lng' });
    }
    const radius = Math.max(20, Math.min(2000, parseInt(radius_m, 10) || 150));

    const fence = await prisma.geoFence.create({
      data: {
        name: name.trim().slice(0, 255),
        center_lat: lat,
        center_lng: lng,
        radius_m: radius,
        active: true,
        notes: notes ? String(notes).slice(0, 1000) : null,
      },
    });
    res.status(201).json({ fence });
  } catch (err) { next(err); }
});

// GET /api/velin/attendance/today
// Vrátí dnešní punches kolegy + (volitelně) jejich derivovaný stav (in/out).
mobile.get('/attendance/today', async (req, res, next) => {
  try {
    const today = startOfToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const punches = await prisma.attendancePunch.findMany({
      where: {
        person_id: req.velin.person.id,
        punched_at: { gte: today, lt: tomorrow },
      },
      orderBy: { punched_at: 'asc' },
    });
    // Derivuj aktuální stav: poslední 'in'/'out' určuje currentState
    let currentState = 'out';
    for (const p of punches) {
      if (p.kind === 'in') currentState = 'in';
      else if (p.kind === 'out') currentState = 'out';
      else if (p.kind === 'break_start') currentState = 'break';
      else if (p.kind === 'break_end') currentState = 'in';
    }
    res.json({ punches, currentState });
  } catch (err) { next(err); }
});

// POST /api/velin/attendance/punch
//
// Body: { kind: 'in'|'out'|'break_start'|'break_end', lat?, lng?, accuracy_m?, source? }
//
// source default: 'velin_manual' (kolega klikl tlačítko)
//   'velin_geofence_auto' — background task při entry/exit z geofence
//   'velin_gps' (legacy) — zachovaný pro Fázi 0 klienty
//
// Pokud máme souřadnice, vyhodnotíme dovnitř/ven z aktivních fences.
// Backend nevyžaduje, aby punch byl uvnitř fence — admin pak může schvalovat
// ručně přes approved_by_user_id (pro výjimky / GPS selhání).
mobile.post('/attendance/punch', async (req, res, next) => {
  try {
    const { kind, lat, lng, accuracy_m, source: bodySource } = req.body || {};
    if (!['in', 'out', 'break_start', 'break_end'].includes(kind)) {
      return res.status(400).json({ error: 'Neplatný kind' });
    }

    // Sanitizovat source — povolíme jen 4 hodnoty
    const ALLOWED_SOURCES = ['velin_manual', 'velin_geofence_auto', 'velin_gps', 'kiosk'];
    const source = ALLOWED_SOURCES.includes(bodySource) ? bodySource : 'velin_manual';

    // Pokud máme souřadnice, vyhodnoť proti aktivním fence
    let inside_fence = false;
    let fence_id = null;
    if (typeof lat === 'number' && typeof lng === 'number') {
      const fences = await prisma.geoFence.findMany({ where: { active: true } });
      for (const f of fences) {
        const dM = haversineMeters(lat, lng, f.center_lat, f.center_lng);
        if (dM <= f.radius_m) { inside_fence = true; fence_id = f.id; break; }
      }
    }

    const punch = await prisma.attendancePunch.create({
      data: {
        person_id: req.velin.person.id,
        kind,
        source,
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
        accuracy_m: typeof accuracy_m === 'number' ? accuracy_m : null,
        inside_fence,
        fence_id,
      },
    });
    res.status(201).json({ punch });
  } catch (err) { next(err); }
});

// =============================================================================
// CHAT — mobile proxy nad existujícím ChatChannel/ChatMessage backendem
// =============================================================================
// Reuse ChatChannel/ChatChannelMember/ChatMessage modelů a stejné Prisma queries
// jako routes/messages.routes.js (web), ale autorizace přes requireVelinAuth
// (mobile JWT) místo requireAuth.
//
// Endpointy:
//   GET    /api/velin/chat/channels                       — moje channels + unread count
//   POST   /api/velin/chat/channels/direct                — { user_id } → otevři/vytvoř DM
//   GET    /api/velin/chat/users/searchable               — directory pro DM picker
//   GET    /api/velin/chat/channels/:id/messages          — paginated zprávy
//   POST   /api/velin/chat/channels/:id/messages          — send (text + attachments)
//   POST   /api/velin/chat/channels/:id/read              — mark read
//
// Push notifikace běží přes createNotification z notifications.routes.js,
// které od 2026-05-21 posílá Expo push všem DeviceRegistration záznamům.

const { createNotification } = require('./notifications.routes');

// Sdílený helper — ověř, že volající je členem kanálu.
async function chatEnsureMember(channelId, userId) {
  const m = await prisma.chatChannelMember.findUnique({
    where: { channel_id_user_id: { channel_id: channelId, user_id: userId } },
  });
  if (!m) {
    const err = new Error('Nemáš přístup do tohoto kanálu');
    err.status = 403;
    throw err;
  }
  return m;
}

// ─── POZOR: pevné podcesty PŘED dynamickou /:id ─────────────────────────────
// Memory `holyos_express_route_order` — Express posuzuje routy v pořadí, pevné
// stringy musí být před parametrizovanou cestou, jinak ji dynamic přepíše.

// POST /chat/upload — multipart upload fotky/souboru, vrátí URL pro attachments[]
//
// Klient pošle multipart/form-data s polem `file` + volitelný `channel_id`
// pro logování/audit. Backend uploadne do R2, vrátí strukturu, kterou klient
// vloží do `attachments` při POST /chat/channels/:id/messages.
//
// Response: { kind, url, name, size, mime }
mobile.post('/chat/upload', chatUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Chybí soubor (field name: file)' });
    }
    const { buffer, mimetype, originalname, size } = req.file;
    const safeName = String(originalname || 'soubor').slice(0, 255);
    const channelId = String(req.body.channel_id || 'misc').slice(0, 64);

    const ext = r2.extFromMimeOrName(mimetype, safeName);
    const key = r2.buildKey('chat', channelId, ext);

    const { url } = await r2.putObject(key, buffer, mimetype);
    if (!url) {
      return res.status(503).json({ error: 'R2 public URL není nakonfigurované' });
    }

    res.status(201).json({
      kind: r2.kindFromMime(mimetype),
      url,
      name: safeName,
      size,
      mime: mimetype || 'application/octet-stream',
    });
  } catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Soubor je příliš velký (max 15 MB)' });
    }
    if (err && err.status === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[velin chat] upload error:', err);
    next(err);
  }
});

// POST /chat/channels/direct — vytvořit/otevřít 1:1 s userId
mobile.post('/chat/channels/direct', async (req, res, next) => {
  try {
    const otherId = parseInt(req.body.user_id, 10);
    if (!Number.isInteger(otherId) || otherId <= 0) {
      return res.status(400).json({ error: 'Chybí user_id' });
    }
    if (otherId === req.user.id) {
      return res.status(400).json({ error: 'Nelze chatovat sám se sebou' });
    }

    // Existuje už direct channel mezi námi?
    const existing = await prisma.chatChannel.findFirst({
      where: {
        type: 'direct',
        members: { every: { user_id: { in: [req.user.id, otherId] } } },
        AND: [
          { members: { some: { user_id: req.user.id } } },
          { members: { some: { user_id: otherId } } },
        ],
      },
      include: { members: true },
    });
    if (existing && existing.members.length === 2) {
      return res.json({ channel: existing });
    }

    // Vytvoř nový DM
    const channel = await prisma.chatChannel.create({
      data: {
        type: 'direct',
        created_by: req.user.id,
        members: {
          create: [
            { user_id: req.user.id, role: 'admin' },
            { user_id: otherId, role: 'member' },
          ],
        },
      },
      include: { members: true },
    });
    res.status(201).json({ channel });
  } catch (err) { next(err); }
});

// GET /chat/users/searchable — directory pro DM picker (jen aktivní persons)
mobile.get('/chat/users/searchable', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user.id },
        person: { active: true },
      },
      select: {
        id: true,
        username: true,
        display_name: true,
        person: { select: { first_name: true, last_name: true, photo_url: true } },
      },
      orderBy: { display_name: 'asc' },
      take: 100,
    });
    const filtered = q
      ? users.filter(u =>
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q) ||
          (u.person?.first_name || '').toLowerCase().includes(q) ||
          (u.person?.last_name || '').toLowerCase().includes(q)
        )
      : users;
    res.json(filtered);
  } catch (err) { next(err); }
});

// GET /chat/channels — moje channels s unread count, sortované by last_message_at
mobile.get('/chat/channels', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const memberships = await prisma.chatChannelMember.findMany({
      where: { user_id: userId },
      include: {
        channel: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true, username: true, display_name: true,
                    person: { select: { photo_url: true, first_name: true, last_name: true } },
                  },
                },
              },
            },
            messages: {
              orderBy: { created_at: 'desc' },
              take: 1,
              select: {
                id: true, content: true, created_at: true, attachments: true,
                sender: { select: { id: true, display_name: true, username: true } },
              },
            },
          },
        },
      },
    });

    // Zjisti unread count per channel (zprávy s created_at > last_read_at)
    const channels = await Promise.all(memberships.map(async m => {
      const where = { channel_id: m.channel_id };
      if (m.last_read_at) where.created_at = { gt: m.last_read_at };
      const unread = await prisma.chatMessage.count({ where });
      return {
        id: m.channel.id,
        type: m.channel.type,
        name: m.channel.name,
        topic: m.channel.topic,
        last_message_at: m.channel.last_message_at,
        muted: m.muted,
        unread,
        members: m.channel.members,
        last_message: m.channel.messages[0] || null,
      };
    }));

    // Sort: by last_message_at desc
    channels.sort((a, b) =>
      new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    );

    res.json(channels);
  } catch (err) { next(err); }
});

// GET /chat/channels/:id/messages — paginated, ?before=<msgId>&limit=50
mobile.get('/chat/channels/:id/messages', async (req, res, next) => {
  try {
    await chatEnsureMember(req.params.id, req.user.id);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const before = req.query.before ? String(req.query.before) : null;

    // Pokud máme `before`, najdi created_at té zprávy a vrať starší
    let beforeDate = null;
    if (before) {
      const ref = await prisma.chatMessage.findUnique({
        where: { id: before },
        select: { created_at: true },
      });
      if (ref) beforeDate = ref.created_at;
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        channel_id: req.params.id,
        ...(beforeDate ? { created_at: { lt: beforeDate } } : {}),
      },
      include: {
        sender: {
          select: {
            id: true, username: true, display_name: true,
            person: { select: { photo_url: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    // Vrátíme chronologicky (nejstarší první) — frontend dělá scroll nahoru
    res.json(messages.reverse());
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /chat/channels/:id/messages — send (text + attachments)
mobile.post('/chat/channels/:id/messages', async (req, res, next) => {
  try {
    await chatEnsureMember(req.params.id, req.user.id);

    const content = String(req.body.content || '').trim();
    const rawAttachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    const attachments = rawAttachments.slice(0, 20).map(a => ({
      kind: (a && a.kind === 'image') ? 'image' : 'file',
      url: String(a?.url || '').slice(0, 1000),
      name: a?.name ? String(a.name).slice(0, 255) : undefined,
      size: typeof a?.size === 'number' ? a.size : undefined,
      mime: a?.mime ? String(a.mime).slice(0, 100) : undefined,
    })).filter(a => a.url);

    if (!content && attachments.length === 0) {
      return res.status(400).json({ error: 'Prázdná zpráva' });
    }
    if (content.length > 10000) {
      return res.status(400).json({ error: 'Zpráva je příliš dlouhá' });
    }

    const channelId = req.params.id;
    const message = await prisma.chatMessage.create({
      data: {
        channel_id: channelId,
        sender_id: req.user.id,
        sender_type: 'user',
        content,
        attachments: attachments.length ? attachments : undefined,
      },
      include: {
        sender: {
          select: {
            id: true, username: true, display_name: true,
            person: { select: { photo_url: true } },
          },
        },
      },
    });

    // Hned vrátíme klientovi, side-effects na pozadí (push, last_message_at)
    res.status(201).json(message);

    (async () => {
      try {
        const [, members] = await Promise.all([
          prisma.chatChannel.update({
            where: { id: channelId },
            data: { last_message_at: message.created_at },
          }),
          prisma.chatChannelMember.findMany({
            where: { channel_id: channelId },
            include: { channel: { select: { type: true, name: true } } },
          }),
        ]);

        const senderLabel = req.user.displayName || req.user.username;
        const channelMeta = members[0]?.channel || {};
        let preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
        if (!preview && attachments.length) {
          const hasImg = attachments.some(a => a.kind === 'image');
          preview = hasImg ? `📷 Obrázek (${attachments.length})` : `📎 Soubor (${attachments.length})`;
        }
        const link = `/modules/chat/?channel=${channelId}`;

        const toNotify = members.filter(m => m.user_id !== req.user.id && !m.muted);
        await Promise.all(toNotify.map(m => {
          let title = senderLabel;
          if (channelMeta.type === 'group' && channelMeta.name) title = `${senderLabel} v ${channelMeta.name}`;
          return createNotification({
            userId: m.user_id,
            type: 'chat_message',
            title,
            body: preview,
            link,
            meta: { channel_id: channelId, message_id: message.id },
          });
        }));
      } catch (bgErr) {
        console.error('[velin chat] background side-effects:', bgErr.message);
      }
    })();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /chat/channels/:id/read — mark read do teď
mobile.post('/chat/channels/:id/read', async (req, res, next) => {
  try {
    await chatEnsureMember(req.params.id, req.user.id);
    await prisma.chatChannelMember.update({
      where: { channel_id_user_id: { channel_id: req.params.id, user_id: req.user.id } },
      data: { last_read_at: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.use('/', mobile);

// ─── Helpers (geo) ───────────────────────────────────────────────────────
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

module.exports = router;
