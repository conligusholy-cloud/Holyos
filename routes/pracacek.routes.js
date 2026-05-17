// =============================================================================
// HolyOS — Pracáček: REST API (admin + mobile)
// =============================================================================
// Mountnuto v app.js pod /api/pracacek. Endpointy se dělí na:
//
//   /admin/* — autentizováno přes HolyOS JWT (requireAuth). Vedoucí/admin
//              spravují plány, úkoly, aktivace zařízení, skill profily.
//
//   /devices/activate (POST) — bez auth, jen s aktivačním kódem (kolega
//              ho dostal od admina). Vrací plain device token (1× v životě).
//
//   /* (mobile) — autentizováno přes requirePracacekDevice (Bearer device token).
//
// Pravidlo z paměti: pevné podcesty pod /:id musí jít NAD dynamickou route.

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { requirePracacekDevice } = require('../middleware/pracacek-auth');
const {
  generateActivationCode,
  generateDeviceToken,
  hashSecret,
  verifySecret,
  activationExpiresAt,
  isPinValidFormat,
} = require('../services/pracacek/auth');
const scheduler = require('../services/workers/pracacek-scheduler');

// ─── Helpers ─────────────────────────────────────────────────────────────

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
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
// POST /api/pracacek/admin/activation/:personId
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
        pracacek_activation_code: code,
        pracacek_activation_expires_at: expires,
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

// DELETE /api/pracacek/admin/activation/:personId
// Zruší pending aktivaci (kdyby admin špatně klikl)
admin.delete('/activation/:personId', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.personId, 10);
    if (!Number.isFinite(personId)) return res.status(400).json({ error: 'Neplatné personId' });
    await prisma.person.update({
      where: { id: personId },
      data: {
        pracacek_activation_code: null,
        pracacek_activation_expires_at: null,
      },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/pracacek/admin/devices
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

// POST /api/pracacek/admin/devices/:id/revoke
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
// GET /api/pracacek/admin/live-day
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
// POST /api/pracacek/admin/tasks
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
      }).catch((e) => console.warn('[pracacek] push notifyPerson:', e.message));
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

// POST /api/pracacek/devices/activate
router.post('/devices/activate', async (req, res, next) => {
  try {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatný vstup', details: parsed.error.format() });
    const body = parsed.data;

    if (!isPinValidFormat(body.pin)) {
      return res.status(400).json({ error: 'PIN musí být 4–8 číslic' });
    }

    const person = await prisma.person.findFirst({
      where: { pracacek_activation_code: body.activation_code, active: true },
    });
    if (!person) return res.status(404).json({ error: 'Aktivační kód neplatný nebo expirovaný' });
    if (!person.pracacek_activation_expires_at || person.pracacek_activation_expires_at < new Date()) {
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
          pracacek_pin_hash: pinHash,
          pracacek_activation_code: null,
          pracacek_activation_expires_at: null,
          pracacek_activated_at: new Date(),
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

// POST /api/pracacek/devices/login
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
    const ok = await verifySecret(pin, person.pracacek_pin_hash);
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
// 3) MOBILE endpoints — vyžadují device token (requirePracacekDevice)
// =============================================================================
const mobile = express.Router();
mobile.use(requirePracacekDevice);

// GET /api/pracacek/me
mobile.get('/me', async (req, res) => {
  const p = req.pracacek.person;
  res.json({
    person: {
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      photo_url: p.photo_url || null,
      quiet_from: p.pracacek_quiet_from || null,
      quiet_to: p.pracacek_quiet_to || null,
    },
    device: { id: req.pracacek.device.id, platform: req.pracacek.device.platform },
  });
});

// GET /api/pracacek/my-day
mobile.get('/my-day', async (req, res, next) => {
  try {
    const today = startOfToday();
    const personId = req.pracacek.person.id;
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
    const personId = req.pracacek.person.id;
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

// GET /api/pracacek/tasks/:id
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
    if (task.person_id !== req.pracacek.person.id) {
      return res.status(403).json({ error: 'Tento úkol není přidělen tobě' });
    }
    res.json({ task });
  } catch (err) { next(err); }
});

async function transitionTask(req, res, next, opts) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné id' });
    const task = await prisma.taskAssignment.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    if (task.person_id !== req.pracacek.person.id) {
      return res.status(403).json({ error: 'Tento úkol není přidělen tobě' });
    }
    const data = opts.data(task, req);
    const updated = await prisma.taskAssignment.update({ where: { id }, data });
    res.json({ task: updated });
  } catch (err) { next(err); }
}

mobile.post('/tasks/:id/accept', (req, res, next) =>
  transitionTask(req, res, next, {
    data: () => ({ status: 'accepted', accepted_at: new Date() }),
  }));

mobile.post('/tasks/:id/start', (req, res, next) =>
  transitionTask(req, res, next, {
    data: () => ({ status: 'in_progress', started_at: new Date(), accepted_at: undefined }),
  }));

mobile.post('/tasks/:id/block', (req, res, next) =>
  transitionTask(req, res, next, {
    data: (task, r) => ({
      status: 'blocked',
      blocked_at: new Date(),
      blocked_reason: (r.body && String(r.body.reason || '').slice(0, 5000)) || 'bez důvodu',
    }),
  }));

mobile.post('/tasks/:id/complete', (req, res, next) =>
  transitionTask(req, res, next, {
    data: (task, r) => ({
      status: 'done',
      completed_at: new Date(),
      actual_min: Number.isFinite(r.body?.actual_min) ? r.body.actual_min : null,
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
    if (task.person_id !== req.pracacek.person.id) {
      return res.status(403).json({ error: 'Tento úkol není přidělen tobě' });
    }
    const msg = await prisma.taskMessage.create({
      data: {
        task_id: id,
        author_kind: 'person',
        author_person_id: req.pracacek.person.id,
        body: String(body.body).slice(0, 10000),
        attachments: body.attachments || null,
      },
    });
    res.status(201).json({ message: msg });
  } catch (err) { next(err); }
});

// POST /api/pracacek/feedback/evening
mobile.post('/feedback/evening', async (req, res, next) => {
  try {
    const today = startOfToday();
    const personId = req.pracacek.person.id;
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

// POST /api/pracacek/attendance/punch
mobile.post('/attendance/punch', async (req, res, next) => {
  try {
    const { kind, lat, lng, accuracy_m } = req.body || {};
    if (!['in', 'out', 'break_start', 'break_end'].includes(kind)) {
      return res.status(400).json({ error: 'Neplatný kind' });
    }

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
        person_id: req.pracacek.person.id,
        kind,
        source: 'pracacek_gps',
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
