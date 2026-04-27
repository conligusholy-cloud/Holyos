// =============================================================================
// HolyOS — Vozový park (Vehicle Fleet) routes
// CRUD vozidel, filtrování, statusy POV/STK/dálniční známky, kontrola termínů
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
// Helper z notifications.routes.js — udělá DB záznam i SSE push v jednom
// volání (čímž získáme i live "zvonek" v UI).
const { createNotification } = require('./notifications.routes');

// ─── Pomocné funkce pro fleet notifikace ───────────────────────────────────
// Krátký popis vozidla — "SPZ 1AB 2345 (Hyundai i30)" / fallback na model
function vehicleLabel(v) {
  if (!v) return 'vozidlo';
  if (v.license_plate && v.model) return `${v.license_plate} (${v.model})`;
  return v.license_plate || v.model || `vozidlo #${v.id}`;
}

// Zformátuje datum + čas v cs-CZ pro tělo notifikace.
// Pokud je čas 00:00:00, zobrazí jen datum (uživatel zjevně čas nezadal).
function formatServiceDateTime(d) {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const dateStr = date.toLocaleDateString('cs-CZ');
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;
  if (!hasTime) return dateStr;
  const timeStr = date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} v ${timeStr}`;
}

// Sestaví textový popis místa servisu podle priorit:
// 1) provozovny v M2N relaci (branches) — adresa první vybrané (pro většinu případů jediná),
// 2) fallback na fakturační/sídelní adresu firmy z adresáře,
// 3) volný text `location`,
// 4) jen název servisní firmy.
function describeServicePlace(service) {
  // Provozovny vybrané jako Místo provedení (M2N)
  const fromBranches = (service.branches || [])
    .map(b => b.branch)
    .filter(Boolean)
    .map(b => {
      const parts = [b.name, b.address, [b.zip, b.city].filter(Boolean).join(' ')]
        .filter(Boolean);
      return parts.join(', ');
    })
    .filter(Boolean);
  if (fromBranches.length) return fromBranches.join(' • ');

  // Z adresáře — branch_* fields nebo sídlo firmy
  const co = service.service_company_ref;
  if (co) {
    const branchLine = [co.branch_address, [co.branch_zip, co.branch_city].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');
    if (branchLine) return co.name ? `${co.name}, ${branchLine}` : branchLine;
    const seatLine = [co.address, [co.zip, co.city].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');
    if (seatLine) return co.name ? `${co.name}, ${seatLine}` : seatLine;
    if (co.name) return co.name;
  }

  // Volný text fallback (starší záznamy)
  if (service.location) return service.location;
  if (service.service_company) return service.service_company;
  return null;
}

// ─── Pomocné funkce ────────────────────────────────────────────────────────

/**
 * Spočítá dny do daného data (od dneška). Vrátí null pro chybějící datum.
 */
function daysUntil(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diffMs = target - today;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Vrátí stav podle dnů do termínu: 'ok' | 'warning' (≤30 dní) | 'expired' (po termínu)
 */
function statusFromDays(days) {
  if (days === null || days === undefined) return null;
  if (days < 0) return 'expired';
  if (days <= 30) return 'warning';
  return 'ok';
}

/**
 * Obohatí vozidlo o počítaná pole (dny a stavy POV/STK/dálniční známky).
 * next_service / next_tire_change se doplňují samostatně v /vehicles endpointu
 * protože vyžadují extra DB dotazy a nechceme je načítat u každého detailu.
 */
function enrichVehicle(v) {
  if (!v) return v;
  const insuranceDays = daysUntil(v.insurance_to);
  const stkDays = daysUntil(v.stk_valid_to);
  const tollDays = daysUntil(v.toll_sticker_to);
  const financingDays = daysUntil(v.financing_to);

  return {
    ...v,
    insurance_days: insuranceDays,
    insurance_status: statusFromDays(insuranceDays),
    stk_days: stkDays,
    stk_status: statusFromDays(stkDays),
    toll_days: tollDays,
    toll_status: statusFromDays(tollDays),
    financing_days: financingDays,
    financing_status: statusFromDays(financingDays),
  };
}

/**
 * Pro hlavní tabulku: nejbližší plánovaný servis a výměna pneu ke každému
 * vozidlu. Jeden agregační dotaz, mapa vehicle_id → ISO datum.
 */
async function nextScheduledByVehicle(table) {
  // table = 'vehicleService' | 'vehicleTireChange'
  const rows = await prisma[table].findMany({
    where: { status: 'planned', scheduled_at: { not: null, gte: new Date() } },
    select: { vehicle_id: true, scheduled_at: true },
    orderBy: { scheduled_at: 'asc' },
  });
  const byVehicle = {};
  for (const r of rows) {
    if (!byVehicle[r.vehicle_id]) byVehicle[r.vehicle_id] = r.scheduled_at;
  }
  return byVehicle;
}

// ─── Validace ──────────────────────────────────────────────────────────────

const vehicleSchema = z.object({
  license_plate: z.string().max(20).optional().nullable(),
  company: z.string().max(100).optional().nullable(), // "Best Series" | "Špagetka" | "JTP services"
  model: z.string().min(1).max(255),
  vin: z.string().max(30).optional().nullable(),
  category: z.string().min(1).max(50),
  color: z.string().max(50).optional().nullable(),
  year: z.number().int().optional().nullable(),
  insurance_from: z.string().optional().nullable(),
  insurance_to: z.string().optional().nullable(),
  insurance_company: z.string().max(255).optional().nullable(),
  stk_valid_to: z.string().optional().nullable(),
  toll_sticker_to: z.string().optional().nullable(),
  financing_type: z.string().max(50).optional().nullable(),
  financing_to: z.string().optional().nullable(),
  financing_owner: z.string().max(255).optional().nullable(),
  disk_size: z.string().max(255).optional().nullable(),
  tire_size: z.string().max(255).optional().nullable(),
  driver_id: z.number().int().optional().nullable(),
  active: z.boolean().optional(),
  current_km: z.number().int().optional().nullable(),
  note: z.string().optional().nullable(),
});

/**
 * Převede stringové datum ("2026-05-01") na Date (nebo null).
 */
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Převede validovaná data pro Prisma create/update.
 */
function toPrismaData(data) {
  const out = { ...data };
  if ('insurance_from' in out) out.insurance_from = parseDate(out.insurance_from);
  if ('insurance_to' in out) out.insurance_to = parseDate(out.insurance_to);
  if ('stk_valid_to' in out) out.stk_valid_to = parseDate(out.stk_valid_to);
  if ('toll_sticker_to' in out) out.toll_sticker_to = parseDate(out.toll_sticker_to);
  if ('financing_to' in out) out.financing_to = parseDate(out.financing_to);
  return out;
}

// ─── Všechny routy vyžadují autentizaci ────────────────────────────────────
router.use(requireAuth);

// ─── GET /api/fleet/vehicles — seznam vozidel ─────────────────────────────
router.get('/vehicles', async (req, res, next) => {
  try {
    const { search, category, active, status, driver_id, company } = req.query;

    const where = {};
    if (active !== undefined) where.active = active === 'true';
    if (category) where.category = category;
    if (company) where.company = company;
    if (driver_id) where.driver_id = parseInt(driver_id);
    if (search) {
      where.OR = [
        { license_plate: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { vin: { contains: search, mode: 'insensitive' } },
      ];
    }

    const vehicles = await prisma.vehicle.findMany({
      where,
      include: {
        driver: {
          select: { id: true, first_name: true, last_name: true, email: true, phone: true },
        },
      },
      orderBy: [{ active: 'desc' }, { license_plate: 'asc' }],
    });

    let enriched = vehicles.map(enrichVehicle);

    // Doplň nejbližší plánovaný servis a výměnu pneu — používá se ve sloupcích tabulky
    const [nextServiceMap, nextTireMap] = await Promise.all([
      nextScheduledByVehicle('vehicleService'),
      nextScheduledByVehicle('vehicleTireChange'),
    ]);
    enriched = enriched.map(v => ({
      ...v,
      next_service: nextServiceMap[v.id] || null,
      next_tire_change: nextTireMap[v.id] || null,
    }));

    // Filtr podle stavu (expired/warning/ok) — aplikuje na cokoliv (POV, STK, známka)
    if (status) {
      enriched = enriched.filter(v =>
        v.insurance_status === status || v.stk_status === status || v.toll_status === status,
      );
    }

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/fleet/vehicles/:id — detail vozidla ──────────────────────────
router.get('/vehicles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: {
          select: { id: true, first_name: true, last_name: true, email: true, phone: true },
        },
      },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vozidlo nenalezeno' });

    res.json(enrichVehicle(vehicle));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/fleet/vehicles — nové vozidlo ───────────────────────────────
router.post('/vehicles', async (req, res, next) => {
  try {
    const parsed = vehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }

    const vehicle = await prisma.vehicle.create({
      data: toPrismaData(parsed.data),
      include: {
        driver: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    res.status(201).json(enrichVehicle(vehicle));
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/fleet/vehicles/:id — úprava vozidla ──────────────────────────
router.put('/vehicles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const parsed = vehicleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }

    const exists = await prisma.vehicle.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: 'Vozidlo nenalezeno' });

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: toPrismaData(parsed.data),
      include: {
        driver: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    // ─── Notifikace o změně řidiče ──────────────────────────────────────────
    // Posíláme nezávisle na úspěchu/neúspěchu (push selže tiše do logu, abychom
    // neshodili response samotné úpravy vozidla).
    try {
      const driverChanged = ('driver_id' in parsed.data) && (exists.driver_id !== vehicle.driver_id);
      if (driverChanged) {
        await notifyDriverChange({
          vehicle,
          oldDriverId: exists.driver_id,
          newDriverId: vehicle.driver_id,
          actorUserId: req.user?.id,
        });
      }
    } catch (e) {
      console.error('[fleet] Notifikace o změně řidiče selhala:', e.message);
    }

    res.json(enrichVehicle(vehicle));
  } catch (err) {
    next(err);
  }
});

/**
 * Pošle notifikaci původnímu i novému řidiči vozu při změně.
 *  - oldDriverId / newDriverId = Person.id (nebo null)
 *  - actorUserId = User.id toho, kdo změnu provedl (nenotifikujeme ho samého)
 */
async function notifyDriverChange({ vehicle, oldDriverId, newDriverId, actorUserId }) {
  const label = vehicleLabel(vehicle);
  const link = `/modules/vozovy-park/index.html?id=${vehicle.id}`;

  // Nový řidič — "Bylo Vám přiděleno vozidlo …"
  if (newDriverId) {
    const np = await prisma.person.findUnique({
      where: { id: newDriverId },
      select: { user_id: true, first_name: true, last_name: true },
    });
    if (np?.user_id && np.user_id !== actorUserId) {
      await createNotification({
        userId: np.user_id,
        type: 'fleet_driver_assigned',
        title: `🚗 Bylo Vám přiděleno vozidlo ${label}`,
        body: `Od této chvíle jste evidován/a jako řidič vozidla ${label}.`,
        link,
        meta: { vehicle_id: vehicle.id, license_plate: vehicle.license_plate || null, kind: 'assigned' },
      });
    }
  }

  // Starý řidič — "Vozidlo … Vám bylo odebráno"
  if (oldDriverId && oldDriverId !== newDriverId) {
    const op = await prisma.person.findUnique({
      where: { id: oldDriverId },
      select: { user_id: true, first_name: true, last_name: true },
    });
    if (op?.user_id && op.user_id !== actorUserId) {
      await createNotification({
        userId: op.user_id,
        type: 'fleet_driver_unassigned',
        title: `🚗 Vozidlo ${label} Vám bylo odebráno`,
        body: `Již nejste evidován/a jako řidič vozidla ${label}.`,
        link,
        meta: { vehicle_id: vehicle.id, license_plate: vehicle.license_plate || null, kind: 'unassigned' },
      });
    }
  }
}

// ─── DELETE /api/fleet/vehicles/:id — smazat vozidlo ──────────────────────
router.delete('/vehicles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    await prisma.vehicle.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Vozidlo nenalezeno' });
    next(err);
  }
});

// ─── GET /api/fleet/alerts — upozornění na blížící se termíny ─────────────
// Vrací vozidla, která mají jakýkoliv stav 'warning' nebo 'expired'
router.get('/alerts', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const vehicles = await prisma.vehicle.findMany({
      where: { active: true },
      include: {
        driver: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
    });

    const alerts = [];
    for (const v of vehicles) {
      const enriched = enrichVehicle(v);
      const items = [
        { kind: 'insurance', label: 'Povinné ručení', days: enriched.insurance_days, status: enriched.insurance_status, date: v.insurance_to },
        { kind: 'stk', label: 'STK', days: enriched.stk_days, status: enriched.stk_status, date: v.stk_valid_to },
        { kind: 'toll', label: 'Dálniční známka', days: enriched.toll_days, status: enriched.toll_status, date: v.toll_sticker_to },
      ];
      for (const it of items) {
        if (it.status === 'expired' || (it.status === 'warning' && it.days <= days)) {
          alerts.push({
            vehicle_id: v.id,
            license_plate: v.license_plate,
            model: v.model,
            driver: v.driver ? `${v.driver.first_name} ${v.driver.last_name}` : null,
            ...it,
            date: it.date,
          });
        }
      }
    }

    alerts.sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

    res.json({ count: alerts.length, alerts });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/fleet/check-expirations — vytvořit notifikace ───────────────
// Vytvoří pro přihlášeného uživatele (a super-adminy) notifikaci na vozidla s
// končícím POV/STK/dálniční známkou (≤30 dnů) nebo po termínu
router.post('/check-expirations', async (req, res, next) => {
  try {
    const daysThreshold = parseInt(req.body?.days) || 30;

    const vehicles = await prisma.vehicle.findMany({
      where: { active: true },
      include: { driver: { include: { user: true } } },
    });

    // Komu pošleme notifikace: super-adminy + přihlášený user + řidiče (pokud má user účet)
    const recipientIds = new Set();
    if (req.user?.id) recipientIds.add(req.user.id);
    const admins = await prisma.user.findMany({ where: { is_super_admin: true }, select: { id: true } });
    admins.forEach(a => recipientIds.add(a.id));

    let created = 0;
    for (const v of vehicles) {
      const enriched = enrichVehicle(v);
      const items = [
        { kind: 'insurance', label: 'Povinné ručení', days: enriched.insurance_days, status: enriched.insurance_status },
        { kind: 'stk', label: 'STK', days: enriched.stk_days, status: enriched.stk_status },
        { kind: 'toll', label: 'Dálniční známka', days: enriched.toll_days, status: enriched.toll_status },
      ];

      for (const it of items) {
        if (it.status !== 'expired' && !(it.status === 'warning' && it.days <= daysThreshold)) continue;

        const title = it.status === 'expired'
          ? `⚠️ ${it.label} po termínu — ${v.license_plate || v.model}`
          : `🕒 ${it.label} vyprší za ${it.days} dní — ${v.license_plate || v.model}`;
        const body = `${v.model}${v.license_plate ? ' (' + v.license_plate + ')' : ''}`;

        // Adresáti: recipientIds + user řidiče (pokud existuje)
        const ids = new Set(recipientIds);
        if (v.driver?.user?.id) ids.add(v.driver.user.id);

        for (const userId of ids) {
          // Pokusíme se nezdvojovat — pokud je za poslední 24h stejný typ + meta.vehicle_id
          const since = new Date();
          since.setHours(since.getHours() - 24);
          const existing = await prisma.notification.findFirst({
            where: {
              user_id: userId,
              type: `fleet_${it.kind}`,
              created_at: { gte: since },
              meta: { path: ['vehicle_id'], equals: v.id },
            },
          });
          if (existing) continue;

          await prisma.notification.create({
            data: {
              user_id: userId,
              type: `fleet_${it.kind}`,
              title,
              body,
              link: `/modules/vozovy-park/index.html?id=${v.id}`,
              meta: { vehicle_id: v.id, kind: it.kind, days: it.days, status: it.status },
            },
          });
          created++;
        }
      }
    }

    // ─── Pneu alerty — napojíme existující hlídač dezénu + sezóny
    try {
      const currentSeason = currentTireSeason();
      // Namontované pneu s nedostatečným dezénem
      const mounted = await prisma.tireStockItem.findMany({
        where: { mounted: true, tread_depth_mm: { not: null } },
        include: { vehicle: { include: { driver: { include: { user: true } } } } },
      });
      for (const t of mounted) {
        if (!t.vehicle) continue;
        const th = TIRE_DEPTH_WARN[t.season];
        if (!th) continue;
        const depth = Number(t.tread_depth_mm);
        if (depth > th.max) continue; // v pořádku

        const critical = depth < th.min;
        const title = critical
          ? `⚠️ Dezén pod minimem — ${t.vehicle.license_plate || t.vehicle.model}`
          : `🕒 Blíží se výměna pneu — ${t.vehicle.license_plate || t.vehicle.model}`;
        const body = `${t.season === 'zimni' ? 'Zimní' : 'Letní'} pneu, dezén ${depth} mm (limit ${th.min}-${th.max} mm)`;

        const ids = new Set(recipientIds);
        if (t.vehicle.driver?.user?.id) ids.add(t.vehicle.driver.user.id);
        for (const userId of ids) {
          const since = new Date(); since.setHours(since.getHours() - 24);
          const existing = await prisma.notification.findFirst({
            where: {
              user_id: userId,
              type: 'fleet_tire_depth',
              created_at: { gte: since },
              meta: { path: ['tire_id'], equals: t.id },
            },
          });
          if (existing) continue;
          await prisma.notification.create({
            data: {
              user_id: userId,
              type: 'fleet_tire_depth',
              title, body,
              link: `/modules/vozovy-park/index.html?id=${t.vehicle.id}`,
              meta: { vehicle_id: t.vehicle.id, tire_id: t.id, season: t.season, depth, critical },
            },
          });
          created++;
        }
      }

      // Vozidla bez sezónně vhodných pneu
      const allActive = await prisma.vehicle.findMany({
        where: { active: true },
        include: {
          tire_stock: { where: { mounted: true }, select: { season: true } },
          driver: { include: { user: true } },
        },
      });
      for (const v of allActive) {
        const hasSeason = (v.tire_stock || []).some(t => t.season === currentSeason);
        if (hasSeason) continue;
        const title = `🕒 Vozidlo bez ${currentSeason === 'zimni' ? 'zimních' : 'letních'} pneu — ${v.license_plate || v.model}`;
        const body = `Aktuálně je ${currentSeason === 'zimni' ? 'zimní období (1.11.-31.3.)' : 'letní období (1.4.-31.10.)'} a vozidlo nemá nasazenou sadu`;
        const ids = new Set(recipientIds);
        if (v.driver?.user?.id) ids.add(v.driver.user.id);
        for (const userId of ids) {
          const since = new Date(); since.setHours(since.getHours() - 24);
          const existing = await prisma.notification.findFirst({
            where: {
              user_id: userId,
              type: 'fleet_tire_season',
              created_at: { gte: since },
              meta: { path: ['vehicle_id'], equals: v.id },
            },
          });
          if (existing) continue;
          await prisma.notification.create({
            data: {
              user_id: userId,
              type: 'fleet_tire_season',
              title, body,
              link: `/modules/vozovy-park/index.html?id=${v.id}`,
              meta: { vehicle_id: v.id, season: currentSeason },
            },
          });
          created++;
        }
      }
    } catch (e) {
      console.warn('[fleet check-expirations] tire alerts error:', e.message);
    }

    res.json({ ok: true, notifications_created: created });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/fleet/drivers — seznam osob použitelných jako řidič ─────────
// Pomocník pro frontend dropdown (aktivní zaměstnanci z HR)
router.get('/drivers', async (req, res, next) => {
  try {
    const people = await prisma.person.findMany({
      where: { active: true },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        department: { select: { name: true } },
      },
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
    });
    res.json(people);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// DOKUMENTY VOZU — Technický průkaz, leasing, STK protokoly, obecné přílohy
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage');

// Ulož base64 soubor do storage/vehicles/<id>/ a vrať { url, file_name, size, mime }
function saveBase64File(vehicleId, base64, originalName, mime) {
  const folder = path.join(STORAGE_DIR, 'vehicles', String(vehicleId));
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  const ext = path.extname(originalName || '') || '.bin';
  const uniqueName = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(folder, uniqueName);
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(filePath, buffer);
  return {
    url: `/api/storage/files/vehicles/${vehicleId}/${uniqueName}`,
    file_name: uniqueName,
    size: buffer.length,
    mime: mime || null,
    original_name: originalName || uniqueName,
  };
}

// GET /api/fleet/vehicles/:id/documents
router.get('/vehicles/:id/documents', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const docs = await prisma.vehicleDocument.findMany({
      where: { vehicle_id: vehicleId },
      orderBy: { uploaded_at: 'desc' },
    });
    res.json(docs);
  } catch (err) { next(err); }
});

// POST /api/fleet/vehicles/:id/documents — upload dokumentu (base64 v těle)
// Body: { doc_type, title, file_data (base64), file_name, mime_type, note? }
router.post('/vehicles/:id/documents', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const { doc_type, title, file_data, file_name, mime_type, note } = req.body;
    if (!doc_type || !file_data) {
      return res.status(400).json({ error: 'Chybí doc_type nebo file_data' });
    }
    const saved = saveBase64File(vehicleId, file_data, file_name, mime_type);
    const doc = await prisma.vehicleDocument.create({
      data: {
        vehicle_id: vehicleId,
        doc_type: String(doc_type).slice(0, 50),
        title: String(title || file_name || saved.original_name).slice(0, 255),
        file_url: saved.url,
        file_name: saved.original_name,
        file_size: saved.size,
        mime_type: saved.mime,
        note: note || null,
        uploaded_by: req.user?.id || null,
      },
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// DELETE /api/fleet/documents/:docId
router.delete('/documents/:docId', async (req, res, next) => {
  try {
    const docId = parseInt(req.params.docId);
    if (isNaN(docId)) return res.status(400).json({ error: 'Neplatné ID' });
    const doc = await prisma.vehicleDocument.findUnique({ where: { id: docId } });
    if (!doc) return res.status(404).json({ error: 'Dokument nenalezen' });

    // Smaž fyzický soubor (best-effort)
    try {
      const urlPath = doc.file_url.replace('/api/storage/files/', '');
      const abs = path.join(STORAGE_DIR, urlPath);
      const resolved = path.resolve(abs);
      if (resolved.startsWith(path.resolve(STORAGE_DIR)) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    } catch (_) { /* soubor možná chybí, ignore */ }

    await prisma.vehicleDocument.delete({ where: { id: docId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// POJISTKY — POV, havarijní
// =============================================================================

const policySchema = z.object({
  policy_type: z.enum(['pov', 'havarijni', 'jine']),
  company_name: z.string().max(255).optional().nullable(),
  policy_number: z.string().max(100).optional().nullable(),
  valid_from: z.string().optional().nullable(),
  valid_to: z.string().optional().nullable(),
  premium_amount: z.number().optional().nullable(),
  note: z.string().optional().nullable(),
  // Upload (volitelný — pokud přichází base64, uložíme)
  file_data: z.string().optional().nullable(),
  file_name: z.string().optional().nullable(),
  mime_type: z.string().optional().nullable(),
});

function toPolicyData(data, vehicleId) {
  const out = {
    vehicle_id: vehicleId,
    policy_type: data.policy_type,
    company_name: data.company_name || null,
    policy_number: data.policy_number || null,
    valid_from: parseDate(data.valid_from),
    valid_to: parseDate(data.valid_to),
    premium_amount: data.premium_amount ?? null,
    note: data.note || null,
  };
  if (data.file_data) {
    const saved = saveBase64File(vehicleId, data.file_data, data.file_name, data.mime_type);
    out.file_url = saved.url;
    out.file_name = saved.original_name;
  }
  return out;
}

// GET /api/fleet/vehicles/:id/policies
router.get('/vehicles/:id/policies', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const policies = await prisma.vehicleInsurancePolicy.findMany({
      where: { vehicle_id: vehicleId },
      orderBy: [{ policy_type: 'asc' }, { valid_to: 'desc' }],
    });
    res.json(policies);
  } catch (err) { next(err); }
});

// POST /api/fleet/vehicles/:id/policies
router.post('/vehicles/:id/policies', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const policy = await prisma.vehicleInsurancePolicy.create({
      data: toPolicyData(parsed.data, vehicleId),
    });
    res.status(201).json(policy);
  } catch (err) { next(err); }
});

// PUT /api/fleet/policies/:policyId
router.put('/policies/:policyId', async (req, res, next) => {
  try {
    const policyId = parseInt(req.params.policyId);
    if (isNaN(policyId)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleInsurancePolicy.findUnique({ where: { id: policyId } });
    if (!existing) return res.status(404).json({ error: 'Pojistka nenalezena' });
    const parsed = policySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = toPolicyData(parsed.data, existing.vehicle_id);
    // Ponech původní file, když se neuploaduje nový
    if (!parsed.data.file_data) {
      delete data.file_url;
      delete data.file_name;
    }
    delete data.vehicle_id; // není v update změnitelné
    const policy = await prisma.vehicleInsurancePolicy.update({
      where: { id: policyId },
      data,
    });
    res.json(policy);
  } catch (err) { next(err); }
});

// DELETE /api/fleet/policies/:policyId
router.delete('/policies/:policyId', async (req, res, next) => {
  try {
    const policyId = parseInt(req.params.policyId);
    if (isNaN(policyId)) return res.status(400).json({ error: 'Neplatné ID' });
    const policy = await prisma.vehicleInsurancePolicy.findUnique({ where: { id: policyId } });
    if (!policy) return res.status(404).json({ error: 'Pojistka nenalezena' });

    // Smaž přiložený soubor, pokud je
    if (policy.file_url) {
      try {
        const urlPath = policy.file_url.replace('/api/storage/files/', '');
        const abs = path.join(STORAGE_DIR, urlPath);
        const resolved = path.resolve(abs);
        if (resolved.startsWith(path.resolve(STORAGE_DIR)) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      } catch (_) {}
    }

    await prisma.vehicleInsurancePolicy.delete({ where: { id: policyId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// SERVISY VOZU
// =============================================================================

const serviceSchema = z.object({
  service_type: z.string().min(1).max(255),
  scheduled_at: z.string().optional().nullable(),
  done_at: z.string().optional().nullable(),
  // FK na Company z adresáře servisních firem. Pokud je vyplněno, service_company
  // text se doplní automaticky (denormalizovaný název pro historii).
  service_company_id: z.number().int().optional().nullable(),
  service_company: z.string().max(255).optional().nullable(),
  // location = volný text fallback (starší záznamy / ručně zadaná adresa).
  // branch_ids = nový M2N seznam vybraných provozoven (nahrazuje location).
  location: z.string().max(500).optional().nullable(),
  branch_ids: z.array(z.number().int()).optional().nullable(),
  km_at_service: z.number().int().optional().nullable(),
  order_number: z.string().max(100).optional().nullable(),
  cost_labor: z.number().optional().nullable(),
  cost_parts: z.number().optional().nullable(),
  invoice_number: z.string().max(100).optional().nullable(),
  note: z.string().optional().nullable(),
  status: z.enum(['planned', 'done', 'cancelled']).optional(),
  // Upload faktury (volitelně)
  invoice_file_data: z.string().optional().nullable(),
  invoice_file_name: z.string().optional().nullable(),
  invoice_mime: z.string().optional().nullable(),
});

function parseDateTime(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Pokud je vyplněné service_company_id, dohledá název firmy a vrátí ho.
// Při neplatném ID vrací null (FK se vynuluje, ale zůstane volitelný text).
async function resolveCompanyName(companyId) {
  if (companyId == null) return null;
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  return co ? co.name : null;
}

async function toServiceData(data, vehicleId, userId) {
  const out = {
    vehicle_id: vehicleId,
    service_type: data.service_type,
    scheduled_at: parseDateTime(data.scheduled_at),
    done_at: parseDateTime(data.done_at),
    service_company_id: data.service_company_id ?? null,
    service_company: data.service_company || null,
    location: data.location || null,
    km_at_service: data.km_at_service ?? null,
    order_number: data.order_number || null,
    cost_labor: data.cost_labor ?? null,
    cost_parts: data.cost_parts ?? null,
    invoice_number: data.invoice_number || null,
    note: data.note || null,
    status: data.status || 'planned',
  };
  // Je-li uvedena firma z adresáře, přepíšeme denormalizovaný název jejím aktuálním názvem.
  if (out.service_company_id != null) {
    const name = await resolveCompanyName(out.service_company_id);
    if (name) out.service_company = name;
    else out.service_company_id = null; // FK neexistuje, spadni na volný text
  }
  if (userId != null) out.created_by = userId;
  if (data.invoice_file_data) {
    const saved = saveBase64File(vehicleId, data.invoice_file_data, data.invoice_file_name, data.invoice_mime);
    out.invoice_url = saved.url;
  }
  return out;
}

// Výběr polí firmy, která potřebujeme posílat do FE (pro zobrazení v kartě / tooltipu)
const SERVICE_COMPANY_SELECT = {
  id: true, name: true, ico: true, dic: true,
  address: true, city: true, zip: true,
  branch_address: true, branch_city: true, branch_zip: true,
  contact_person: true, email: true, phone: true, active: true,
  branches: {
    where: { active: true },
    orderBy: { id: 'asc' },
    select: {
      id: true, name: true, address: true, city: true, zip: true,
      contact_person: true, phone: true, email: true, active: true,
    },
  },
};

// Include pro místa provedení (provozovny vybrané jako Místo provedení).
const SERVICE_LOCATION_INCLUDE = {
  branches: {
    include: {
      branch: {
        select: {
          id: true, company_id: true, name: true,
          address: true, city: true, zip: true, active: true,
        },
      },
    },
  },
};

// Sjednotí branch_ids v M2N tabulce (delete + insert v transakci).
async function syncServiceBranches(tx, serviceId, branchIds) {
  await tx.vehicleServiceLocation.deleteMany({ where: { service_id: serviceId } });
  if (Array.isArray(branchIds) && branchIds.length > 0) {
    const unique = [...new Set(branchIds.filter((n) => Number.isInteger(n)))];
    if (unique.length) {
      await tx.vehicleServiceLocation.createMany({
        data: unique.map((bid) => ({ service_id: serviceId, branch_id: bid })),
        skipDuplicates: true,
      });
    }
  }
}

async function syncTireChangeBranches(tx, tireChangeId, branchIds) {
  await tx.vehicleTireChangeLocation.deleteMany({ where: { tire_change_id: tireChangeId } });
  if (Array.isArray(branchIds) && branchIds.length > 0) {
    const unique = [...new Set(branchIds.filter((n) => Number.isInteger(n)))];
    if (unique.length) {
      await tx.vehicleTireChangeLocation.createMany({
        data: unique.map((bid) => ({ tire_change_id: tireChangeId, branch_id: bid })),
        skipDuplicates: true,
      });
    }
  }
}

// GET /api/fleet/vehicles/:id/services — všechny servisy vozu (vč. done)
router.get('/vehicles/:id/services', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const services = await prisma.vehicleService.findMany({
      where: { vehicle_id: vehicleId },
      include: {
        service_company_ref: { select: SERVICE_COMPANY_SELECT },
        ...SERVICE_LOCATION_INCLUDE,
      },
      orderBy: [
        { status: 'asc' },          // planned first (abecedně)
        { scheduled_at: 'asc' },
        { done_at: 'desc' },
      ],
    });
    res.json(services);
  } catch (err) { next(err); }
});

// POST /api/fleet/vehicles/:id/services — nový servis
router.post('/vehicles/:id/services', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = await toServiceData(parsed.data, vehicleId, req.user?.id);
    const service = await prisma.$transaction(async (tx) => {
      const created = await tx.vehicleService.create({ data });
      await syncServiceBranches(tx, created.id, parsed.data.branch_ids);
      return tx.vehicleService.findUnique({
        where: { id: created.id },
        include: {
          service_company_ref: { select: SERVICE_COMPANY_SELECT },
          ...SERVICE_LOCATION_INCLUDE,
        },
      });
    });

    // ─── Notifikace řidiči o naplánovaném servisu ───────────────────────────
    // Tichý fallback — chyba zápisu/pushe nesmí shodit založení servisu.
    try {
      await notifyDriverAboutService({ serviceId: service.id, actorUserId: req.user?.id });
    } catch (e) {
      console.error('[fleet] Notifikace řidiče o servisu selhala:', e.message);
    }

    res.status(201).json(service);
  } catch (err) { next(err); }
});

/**
 * Pošle řidiči vozu notifikaci o nově naplánovaném servisu (datum/čas + místo).
 * Když vozidlo nemá řidiče, řidič nemá user_id, nebo zakládá servis sám sobě,
 * neposílá nic. Místo skládáme přes describeServicePlace (preferuje vybrané
 * provozovny, fallback na adresu firmy / volný text).
 */
async function notifyDriverAboutService({ serviceId, actorUserId }) {
  const service = await prisma.vehicleService.findUnique({
    where: { id: serviceId },
    include: {
      vehicle: {
        select: {
          id: true, license_plate: true, model: true,
          driver: { select: { id: true, user_id: true, first_name: true, last_name: true } },
        },
      },
      service_company_ref: { select: SERVICE_COMPANY_SELECT },
      ...SERVICE_LOCATION_INCLUDE,
    },
  });
  if (!service || !service.vehicle) return;

  const driver = service.vehicle.driver;
  if (!driver || !driver.user_id) return;        // nemá kam doručit
  if (driver.user_id === actorUserId) return;    // nenotifikujeme aktéra samotného

  const label = vehicleLabel(service.vehicle);
  const when = formatServiceDateTime(service.scheduled_at) || 'termín bude upřesněn';
  const place = describeServicePlace(service) || 'místo bude upřesněno';

  const title = `🔧 Naplánován servis: ${label}`;
  const bodyLines = [];
  if (service.service_type) bodyLines.push(`Úkon: ${service.service_type}`);
  bodyLines.push(`Termín: ${when}`);
  bodyLines.push(`Místo: ${place}`);
  if (service.note) bodyLines.push(`Pozn.: ${service.note}`);

  await createNotification({
    userId: driver.user_id,
    type: 'fleet_service_planned',
    title,
    body: bodyLines.join('\n'),
    link: `/modules/vozovy-park/index.html?id=${service.vehicle.id}`,
    meta: {
      vehicle_id: service.vehicle.id,
      service_id: service.id,
      license_plate: service.vehicle.license_plate || null,
      scheduled_at: service.scheduled_at,
    },
  });
}

// PUT /api/fleet/services/:serviceId — úprava
router.put('/services/:serviceId', async (req, res, next) => {
  try {
    const serviceId = parseInt(req.params.serviceId);
    if (isNaN(serviceId)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleService.findUnique({ where: { id: serviceId } });
    if (!existing) return res.status(404).json({ error: 'Servis nenalezen' });
    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = await toServiceData(parsed.data, existing.vehicle_id, undefined);
    delete data.vehicle_id;
    delete data.created_by;
    if (!parsed.data.invoice_file_data) delete data.invoice_url;
    const service = await prisma.$transaction(async (tx) => {
      await tx.vehicleService.update({ where: { id: serviceId }, data });
      // branch_ids === undefined ⇒ klient pole vůbec neposlal, M2N necháváme být.
      // branch_ids === null nebo [] ⇒ explicitně vyprázdnit.
      if (parsed.data.branch_ids !== undefined) {
        await syncServiceBranches(tx, serviceId, parsed.data.branch_ids || []);
      }
      return tx.vehicleService.findUnique({
        where: { id: serviceId },
        include: {
          service_company_ref: { select: SERVICE_COMPANY_SELECT },
          ...SERVICE_LOCATION_INCLUDE,
        },
      });
    });
    res.json(service);
  } catch (err) { next(err); }
});

// POST /api/fleet/services/:serviceId/confirm — správce potvrdí provedení
// (nastavi status=done, done_at=now jestli není, confirmed_by=user)
router.post('/services/:serviceId/confirm', async (req, res, next) => {
  try {
    const serviceId = parseInt(req.params.serviceId);
    if (isNaN(serviceId)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleService.findUnique({ where: { id: serviceId } });
    if (!existing) return res.status(404).json({ error: 'Servis nenalezen' });
    const now = new Date();
    const service = await prisma.vehicleService.update({
      where: { id: serviceId },
      data: {
        status: 'done',
        done_at: existing.done_at || now,
        confirmed_by: req.user?.id || null,
        confirmed_at: now,
      },
    });
    res.json(service);
  } catch (err) { next(err); }
});

// DELETE /api/fleet/services/:serviceId
router.delete('/services/:serviceId', async (req, res, next) => {
  try {
    const serviceId = parseInt(req.params.serviceId);
    if (isNaN(serviceId)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleService.findUnique({ where: { id: serviceId } });
    if (!existing) return res.status(404).json({ error: 'Servis nenalezen' });
    // Smaž i fakturu, pokud byla přiložená
    if (existing.invoice_url) {
      try {
        const urlPath = existing.invoice_url.replace('/api/storage/files/', '');
        const abs = path.join(STORAGE_DIR, urlPath);
        const resolved = path.resolve(abs);
        if (resolved.startsWith(path.resolve(STORAGE_DIR)) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      } catch (_) {}
    }
    await prisma.vehicleService.delete({ where: { id: serviceId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// ŠKODNÍ UDÁLOSTI
// =============================================================================

const damageEventSchema = z.object({
  event_date: z.string().min(1),
  location: z.string().max(500).optional().nullable(),
  description: z.string().optional().nullable(),
  claim_number: z.string().max(100).optional().nullable(),
  estimated_damage: z.number().optional().nullable(),
});

function toDamageData(data, vehicleId, userId) {
  const out = {
    vehicle_id: vehicleId,
    event_date: parseDateTime(data.event_date),
    location: data.location || null,
    description: data.description || null,
    claim_number: data.claim_number || null,
    estimated_damage: data.estimated_damage ?? null,
  };
  if (userId != null) out.created_by = userId;
  return out;
}

// GET /api/fleet/vehicles/:id/damage-events — všechny škodní události vozidla
router.get('/vehicles/:id/damage-events', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const events = await prisma.vehicleDamageEvent.findMany({
      where: { vehicle_id: vehicleId },
      include: { documents: { orderBy: { uploaded_at: 'desc' } } },
      orderBy: { event_date: 'desc' },
    });
    res.json(events);
  } catch (err) { next(err); }
});

// POST /api/fleet/vehicles/:id/damage-events — nová škodní událost
router.post('/vehicles/:id/damage-events', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = damageEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    if (!parsed.data.event_date) {
      return res.status(400).json({ error: 'Datum události je povinné' });
    }
    const event = await prisma.vehicleDamageEvent.create({
      data: toDamageData(parsed.data, vehicleId, req.user?.id),
      include: { documents: true },
    });
    res.status(201).json(event);
  } catch (err) { next(err); }
});

// PUT /api/fleet/damage-events/:eventId — úprava
router.put('/damage-events/:eventId', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.eventId);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleDamageEvent.findUnique({ where: { id: eventId } });
    if (!existing) return res.status(404).json({ error: 'Událost nenalezena' });
    const parsed = damageEventSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = toDamageData(parsed.data, existing.vehicle_id, undefined);
    delete data.vehicle_id;
    delete data.created_by;
    const event = await prisma.vehicleDamageEvent.update({
      where: { id: eventId },
      data,
      include: { documents: true },
    });
    res.json(event);
  } catch (err) { next(err); }
});

// DELETE /api/fleet/damage-events/:eventId — smaže událost i všechny přiložené dokumenty
router.delete('/damage-events/:eventId', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.eventId);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleDamageEvent.findUnique({
      where: { id: eventId },
      include: { documents: true },
    });
    if (!existing) return res.status(404).json({ error: 'Událost nenalezena' });
    // Smaž fyzické soubory přiložených dokumentů
    for (const doc of existing.documents) {
      try {
        const urlPath = doc.file_url.replace('/api/storage/files/', '');
        const abs = path.join(STORAGE_DIR, urlPath);
        const resolved = path.resolve(abs);
        if (resolved.startsWith(path.resolve(STORAGE_DIR)) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      } catch (_) {}
    }
    await prisma.vehicleDamageEvent.delete({ where: { id: eventId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/fleet/damage-events/:eventId/documents — přidá dokument k události
router.post('/damage-events/:eventId/documents', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.eventId);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Neplatné ID' });
    const event = await prisma.vehicleDamageEvent.findUnique({
      where: { id: eventId },
      select: { id: true, vehicle_id: true },
    });
    if (!event) return res.status(404).json({ error: 'Událost nenalezena' });
    const { file_data, file_name, mime_type, title } = req.body;
    if (!file_data) return res.status(400).json({ error: 'Chybí file_data' });
    const saved = saveBase64File(event.vehicle_id, file_data, file_name, mime_type);
    const doc = await prisma.vehicleDamageDocument.create({
      data: {
        damage_event_id: eventId,
        title: title || saved.original_name,
        file_url: saved.url,
        file_name: saved.original_name,
        file_size: saved.size,
        mime_type: saved.mime,
        uploaded_by: req.user?.id || null,
      },
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// DELETE /api/fleet/damage-documents/:docId
router.delete('/damage-documents/:docId', async (req, res, next) => {
  try {
    const docId = parseInt(req.params.docId);
    if (isNaN(docId)) return res.status(400).json({ error: 'Neplatné ID' });
    const doc = await prisma.vehicleDamageDocument.findUnique({ where: { id: docId } });
    if (!doc) return res.status(404).json({ error: 'Dokument nenalezen' });
    try {
      const urlPath = doc.file_url.replace('/api/storage/files/', '');
      const abs = path.join(STORAGE_DIR, urlPath);
      const resolved = path.resolve(abs);
      if (resolved.startsWith(path.resolve(STORAGE_DIR)) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    } catch (_) {}
    await prisma.vehicleDamageDocument.delete({ where: { id: docId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// PNEU — VÝMĚNY + SKLAD + HLÍDÁNÍ
// =============================================================================

// Prahové hodnoty pro hloubku dezénu (mm) — pod těmito hodnotami hlásíme varování.
const TIRE_DEPTH_WARN = {
  letni: { min: 2.0, max: 3.0 },   // 2–3 mm = upozornění (pod 2 mm = po termínu)
  zimni: { min: 4.0, max: 5.0 },   // 4–5 mm = upozornění (pod 4 mm = po termínu)
};

// Sezóna podle aktuálního data
function currentTireSeason(date) {
  const d = date || new Date();
  const m = d.getMonth() + 1; // 1-12
  // Zimní: 1.11. – 31.3. (listopad, prosinec, leden, únor, březen)
  if (m >= 11 || m <= 3) return 'zimni';
  // Letní: 1.4. – 31.10.
  return 'letni';
}

const tireChangeSchema = z.object({
  season: z.enum(['letni', 'zimni']),
  scheduled_at: z.string().optional().nullable(),
  done_at: z.string().optional().nullable(),
  // location = volný text fallback. branch_ids = nový M2N seznam provozoven.
  location: z.string().max(500).optional().nullable(),
  branch_ids: z.array(z.number().int()).optional().nullable(),
  km_at_service: z.number().int().optional().nullable(),
  order_number: z.string().max(100).optional().nullable(),
  // FK na Company z adresáře. service_company text se doplní automaticky dle názvu firmy.
  service_company_id: z.number().int().optional().nullable(),
  service_company: z.string().max(255).optional().nullable(),
  cost_service: z.number().optional().nullable(),
  cost_tires: z.number().optional().nullable(),
  invoice_number: z.string().max(100).optional().nullable(),
  note: z.string().optional().nullable(),
  status: z.enum(['planned', 'done', 'cancelled']).optional(),
  invoice_file_data: z.string().optional().nullable(),
  invoice_file_name: z.string().optional().nullable(),
  invoice_mime: z.string().optional().nullable(),
  // Protokol / dodací list — stejný base64 mechanismus jako faktura výše.
  protocol_file_data: z.string().optional().nullable(),
  protocol_file_name: z.string().optional().nullable(),
  protocol_mime: z.string().optional().nullable(),
});

async function toTireChangeData(data, vehicleId, userId) {
  const out = {
    vehicle_id: vehicleId,
    season: data.season,
    scheduled_at: parseDateTime(data.scheduled_at),
    done_at: parseDateTime(data.done_at),
    location: data.location || null,
    km_at_service: data.km_at_service ?? null,
    order_number: data.order_number || null,
    service_company_id: data.service_company_id ?? null,
    service_company: data.service_company || null,
    cost_service: data.cost_service ?? null,
    cost_tires: data.cost_tires ?? null,
    invoice_number: data.invoice_number || null,
    note: data.note || null,
    status: data.status || 'planned',
  };
  if (out.service_company_id != null) {
    const name = await resolveCompanyName(out.service_company_id);
    if (name) out.service_company = name;
    else out.service_company_id = null;
  }
  if (userId != null) out.created_by = userId;
  if (data.invoice_file_data) {
    const saved = saveBase64File(vehicleId, data.invoice_file_data, data.invoice_file_name, data.invoice_mime);
    out.invoice_url = saved.url;
  }
  if (data.protocol_file_data) {
    const saved = saveBase64File(vehicleId, data.protocol_file_data, data.protocol_file_name, data.protocol_mime);
    out.protocol_url = saved.url;
  }
  return out;
}

// GET /api/fleet/vehicles/:id/tire-changes
router.get('/vehicles/:id/tire-changes', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const rows = await prisma.vehicleTireChange.findMany({
      where: { vehicle_id: vehicleId },
      include: {
        service_company_ref: { select: SERVICE_COMPANY_SELECT },
        ...SERVICE_LOCATION_INCLUDE,
      },
      orderBy: [{ status: 'asc' }, { scheduled_at: 'asc' }, { done_at: 'desc' }],
    });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/vehicles/:id/tire-changes', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = tireChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = await toTireChangeData(parsed.data, vehicleId, req.user?.id);
    const tc = await prisma.$transaction(async (tx) => {
      const created = await tx.vehicleTireChange.create({ data });
      await syncTireChangeBranches(tx, created.id, parsed.data.branch_ids);
      return tx.vehicleTireChange.findUnique({
        where: { id: created.id },
        include: {
          service_company_ref: { select: SERVICE_COMPANY_SELECT },
          ...SERVICE_LOCATION_INCLUDE,
        },
      });
    });
    res.status(201).json(tc);
  } catch (err) { next(err); }
});

router.put('/tire-changes/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleTireChange.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Záznam nenalezen' });
    const parsed = tireChangeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = await toTireChangeData(parsed.data, existing.vehicle_id, undefined);
    delete data.vehicle_id;
    delete data.created_by;
    if (!parsed.data.invoice_file_data) delete data.invoice_url;
    // Stejné pravidlo jako u faktury: pokud klient v této editaci nepřiložil
    // nový protokol, nepřepisujeme existující URL na null.
    if (!parsed.data.protocol_file_data) delete data.protocol_url;
    const tc = await prisma.$transaction(async (tx) => {
      await tx.vehicleTireChange.update({ where: { id }, data });
      if (parsed.data.branch_ids !== undefined) {
        await syncTireChangeBranches(tx, id, parsed.data.branch_ids || []);
      }
      return tx.vehicleTireChange.findUnique({
        where: { id },
        include: {
          service_company_ref: { select: SERVICE_COMPANY_SELECT },
          ...SERVICE_LOCATION_INCLUDE,
        },
      });
    });
    res.json(tc);
  } catch (err) { next(err); }
});

router.post('/tire-changes/:id/confirm', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleTireChange.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Záznam nenalezen' });
    const now = new Date();
    const tc = await prisma.vehicleTireChange.update({
      where: { id },
      data: {
        status: 'done',
        done_at: existing.done_at || now,
        confirmed_by: req.user?.id || null,
        confirmed_at: now,
      },
    });
    res.json(tc);
  } catch (err) { next(err); }
});

router.delete('/tire-changes/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.vehicleTireChange.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Záznam nenalezen' });
    // Uklidí přiložené soubory (faktura i protokol) ze storage volume.
    // Tichý try/catch — neexistující/cizí soubor nesmí shodit smazání záznamu.
    for (const url of [existing.invoice_url, existing.protocol_url]) {
      if (!url) continue;
      try {
        const urlPath = url.replace('/api/storage/files/', '');
        const abs = path.join(STORAGE_DIR, urlPath);
        const resolved = path.resolve(abs);
        if (resolved.startsWith(path.resolve(STORAGE_DIR)) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      } catch (_) {}
    }
    await prisma.vehicleTireChange.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// SKLAD PNEU
// =============================================================================

const tireStockSchema = z.object({
  vehicle_id: z.number().int().optional().nullable(),
  season: z.enum(['letni', 'zimni']),
  tire_size: z.string().max(100).optional().nullable(),
  manufacturer: z.string().max(100).optional().nullable(),
  model_name: z.string().max(255).optional().nullable(),
  dot_code: z.string().max(20).optional().nullable(),
  tread_depth_mm: z.number().optional().nullable(),
  storage_location: z.string().max(255).optional().nullable(),
  mounted: z.boolean().optional(),
  mounted_at: z.string().optional().nullable(),
  dismounted_at: z.string().optional().nullable(),
  purchase_price: z.number().optional().nullable(),
  invoice_number: z.string().max(100).optional().nullable(),
  note: z.string().optional().nullable(),
});

function toTireStockData(data) {
  return {
    vehicle_id: data.vehicle_id ?? null,
    season: data.season,
    tire_size: data.tire_size || null,
    manufacturer: data.manufacturer || null,
    model_name: data.model_name || null,
    dot_code: data.dot_code || null,
    tread_depth_mm: data.tread_depth_mm ?? null,
    storage_location: data.storage_location || null,
    mounted: !!data.mounted,
    mounted_at: parseDateTime(data.mounted_at),
    dismounted_at: parseDateTime(data.dismounted_at),
    purchase_price: data.purchase_price ?? null,
    invoice_number: data.invoice_number || null,
    note: data.note || null,
  };
}

// GET /api/fleet/vehicles/:id/tire-stock — pneu přiřazené konkrétnímu vozidlu
router.get('/vehicles/:id/tire-stock', async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'Neplatné ID' });
    const items = await prisma.tireStockItem.findMany({
      where: { vehicle_id: vehicleId },
      orderBy: [{ season: 'asc' }, { mounted: 'desc' }, { created_at: 'desc' }],
    });
    res.json(items);
  } catch (err) { next(err); }
});

// GET /api/fleet/tire-stock — celý sklad (nepřiřazené + přiřazené)
router.get('/tire-stock', async (req, res, next) => {
  try {
    const { season, vehicle_id, mounted } = req.query;
    const where = {};
    if (season) where.season = season;
    if (vehicle_id) where.vehicle_id = parseInt(vehicle_id);
    if (mounted !== undefined) where.mounted = mounted === 'true';
    const items = await prisma.tireStockItem.findMany({
      where,
      include: { vehicle: { select: { id: true, license_plate: true, model: true } } },
      orderBy: [{ season: 'asc' }, { created_at: 'desc' }],
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/tire-stock', async (req, res, next) => {
  try {
    const parsed = tireStockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const item = await prisma.tireStockItem.create({ data: toTireStockData(parsed.data) });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put('/tire-stock/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = tireStockSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = toTireStockData(parsed.data);
    // Nepřepisuj vehicle_id pokud nebylo přímo zmíněno (partial)
    if (!('vehicle_id' in parsed.data)) delete data.vehicle_id;
    const item = await prisma.tireStockItem.update({ where: { id }, data });
    res.json(item);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Záznam nenalezen' });
    next(err);
  }
});

router.delete('/tire-stock/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    await prisma.tireStockItem.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Záznam nenalezen' });
    next(err);
  }
});

// GET /api/fleet/tire-alerts — pneu hlídání (dezén pod hranicí + nesedící sezóna)
router.get('/tire-alerts', async (req, res, next) => {
  try {
    const season = currentTireSeason();
    const thresholds = TIRE_DEPTH_WARN[season];
    const alerts = [];

    // 1) Namontované pneu s dezénem v pásmu upozornění (nebo pod minimem)
    const mounted = await prisma.tireStockItem.findMany({
      where: { mounted: true, tread_depth_mm: { not: null } },
      include: { vehicle: { select: { id: true, license_plate: true, model: true, company: true } } },
    });
    for (const t of mounted) {
      if (!t.vehicle) continue;
      const depth = Number(t.tread_depth_mm);
      const tireThresholds = TIRE_DEPTH_WARN[t.season];
      if (!tireThresholds) continue;
      if (depth < tireThresholds.min) {
        alerts.push({
          kind: 'tire_depth_critical',
          severity: 'critical',
          label: `Dezén pod minimem (${depth} mm < ${tireThresholds.min} mm)`,
          tire_id: t.id,
          season: t.season,
          depth,
          vehicle_id: t.vehicle.id,
          license_plate: t.vehicle.license_plate,
          model: t.vehicle.model,
        });
      } else if (depth <= tireThresholds.max) {
        alerts.push({
          kind: 'tire_depth_warning',
          severity: 'warning',
          label: `Blíží se výměna (${depth} mm v pásmu ${tireThresholds.min}-${tireThresholds.max} mm)`,
          tire_id: t.id,
          season: t.season,
          depth,
          vehicle_id: t.vehicle.id,
          license_plate: t.vehicle.license_plate,
          model: t.vehicle.model,
        });
      }
    }

    // 2) Vozidla, která nemají namontovanou sezónně vhodnou sadu
    //    (aktuální sezóna je X, ale vozidlo nemá mounted tire se season=X)
    const vehicles = await prisma.vehicle.findMany({
      where: { active: true },
      include: {
        tire_stock: {
          where: { mounted: true },
          select: { season: true },
        },
      },
    });
    for (const v of vehicles) {
      const mountedSeasons = new Set((v.tire_stock || []).map(t => t.season));
      if (!mountedSeasons.has(season)) {
        alerts.push({
          kind: 'wrong_season',
          severity: 'warning',
          label: `Aktuálně je ${season === 'zimni' ? 'zimní' : 'letní'} období — vozidlo nemá odpovídající pneu`,
          current_season: season,
          vehicle_id: v.id,
          license_plate: v.license_plate,
          model: v.model,
          has_seasons: [...mountedSeasons],
        });
      }
    }

    res.json({
      current_season: season,
      count: alerts.length,
      alerts,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/fleet/stats — souhrnná statistika vozového parku ────────────
router.get('/stats', async (req, res, next) => {
  try {
    const vehicles = await prisma.vehicle.findMany({ where: { active: true } });
    const enriched = vehicles.map(enrichVehicle);

    const byCategory = {};
    const byFinancing = {};
    let povExpired = 0, povWarning = 0;
    let stkExpired = 0, stkWarning = 0;
    let tollExpired = 0, tollWarning = 0;

    for (const v of enriched) {
      byCategory[v.category] = (byCategory[v.category] || 0) + 1;
      if (v.financing_type) byFinancing[v.financing_type] = (byFinancing[v.financing_type] || 0) + 1;
      if (v.insurance_status === 'expired') povExpired++;
      else if (v.insurance_status === 'warning') povWarning++;
      if (v.stk_status === 'expired') stkExpired++;
      else if (v.stk_status === 'warning') stkWarning++;
      if (v.toll_status === 'expired') tollExpired++;
      else if (v.toll_status === 'warning') tollWarning++;
    }

    res.json({
      total: vehicles.length,
      by_category: byCategory,
      by_financing: byFinancing,
      insurance: { expired: povExpired, warning: povWarning },
      stk: { expired: stkExpired, warning: stkWarning },
      toll: { expired: tollExpired, warning: tollWarning },
    });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// ADRESÁŘ SERVISNÍCH FIREM (servisy, pneuservisy, dodavatelé)
// Sdílí tabulku Company — filtrováno na supplier / cooperation / both / service_provider.
// Při zápisu VehicleService / VehicleTireChange se service_company_id (FK) doplňuje
// spolu s denormalizovaným názvem do service_company (String) kvůli historii.
// =============================================================================

const SERVICE_PROVIDER_TYPES = ['supplier', 'cooperation', 'both', 'service_provider'];

const serviceProviderSchema = z.object({
  name: z.string().min(1).max(255),
  ico: z.string().max(20).optional().nullable(),
  dic: z.string().max(20).optional().nullable(),
  // Sídlo
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  zip: z.string().max(10).optional().nullable(),
  country: z.string().max(2).optional().nullable(),
  // Provozovna
  branch_address: z.string().max(255).optional().nullable(),
  branch_city: z.string().max(100).optional().nullable(),
  branch_zip: z.string().max(10).optional().nullable(),
  // Ostatní
  type: z.string().max(50).optional().nullable(),
  contact_person: z.string().max(255).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  web: z.string().max(255).optional().nullable(),
  bank_account: z.string().max(50).optional().nullable(),
  payment_terms_days: z.number().int().min(0).max(365).optional().nullable(),
  notes: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

function toCompanyData(data) {
  const out = {
    name: data.name,
    ico: data.ico || null,
    dic: data.dic || null,
    address: data.address || null,
    city: data.city || null,
    zip: data.zip || null,
    country: data.country || 'CZ',
    branch_address: data.branch_address || null,
    branch_city: data.branch_city || null,
    branch_zip: data.branch_zip || null,
    type: data.type || 'service_provider',
    contact_person: data.contact_person || null,
    email: data.email || null,
    phone: data.phone || null,
    web: data.web || null,
    bank_account: data.bank_account || null,
    notes: data.notes || null,
  };
  if (data.payment_terms_days != null) out.payment_terms_days = data.payment_terms_days;
  if (data.active != null) out.active = data.active;
  return out;
}

// GET /api/fleet/service-providers — seznam firem vhodných pro servis/pneu
router.get('/service-providers', async (req, res, next) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const search = (req.query.search || '').toString().trim();
    const where = {
      type: { in: SERVICE_PROVIDER_TYPES },
    };
    if (!includeInactive) where.active = true;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { ico: { contains: search } },
        { dic: { contains: search } },
      ];
    }
    const companies = await prisma.company.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      include: {
        branches: {
          where: { active: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    res.json(companies);
  } catch (err) { next(err); }
});

// ─── PROVOZOVNY (CompanyBranch) ────────────────────────────────────────────
// Pevné podcesty MUSÍ jít před `/service-providers/:id` (Express route order).

const branchSchema = z.object({
  name: z.string().max(255).optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  zip: z.string().max(10).optional().nullable(),
  contact_person: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  note: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

function toBranchData(data) {
  const out = {
    name: data.name || null,
    address: data.address || null,
    city: data.city || null,
    zip: data.zip || null,
    contact_person: data.contact_person || null,
    phone: data.phone || null,
    email: data.email || null,
    note: data.note || null,
  };
  if (data.active != null) out.active = data.active;
  return out;
}

// GET /api/fleet/service-providers/:id/branches — seznam provozoven firmy
router.get('/service-providers/:id/branches', async (req, res, next) => {
  try {
    const companyId = parseInt(req.params.id);
    if (isNaN(companyId)) return res.status(400).json({ error: 'Neplatné ID firmy' });
    const includeInactive = req.query.include_inactive === 'true';
    const where = { company_id: companyId };
    if (!includeInactive) where.active = true;
    const branches = await prisma.companyBranch.findMany({
      where,
      orderBy: { id: 'asc' },
    });
    res.json(branches);
  } catch (err) { next(err); }
});

// POST /api/fleet/service-providers/:id/branches — založí novou provozovnu
router.post('/service-providers/:id/branches', async (req, res, next) => {
  try {
    const companyId = parseInt(req.params.id);
    if (isNaN(companyId)) return res.status(400).json({ error: 'Neplatné ID firmy' });
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ error: 'Firma nenalezena' });
    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const branch = await prisma.companyBranch.create({
      data: { company_id: companyId, ...toBranchData(parsed.data) },
    });
    res.status(201).json(branch);
  } catch (err) { next(err); }
});

// PUT /api/fleet/branches/:id — úprava provozovny
router.put('/branches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID provozovny' });
    const existing = await prisma.companyBranch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Provozovna nenalezena' });
    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const branch = await prisma.companyBranch.update({
      where: { id },
      data: toBranchData(parsed.data),
    });
    res.json(branch);
  } catch (err) { next(err); }
});

// DELETE /api/fleet/branches/:id — smaže provozovnu (jen pokud nemá vazby).
// Pro soft-delete použij PUT s { active: false }.
router.delete('/branches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID provozovny' });
    const existing = await prisma.companyBranch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Provozovna nenalezena' });
    const [svcCount, tireCount] = await Promise.all([
      prisma.vehicleServiceLocation.count({ where: { branch_id: id } }),
      prisma.vehicleTireChangeLocation.count({ where: { branch_id: id } }),
    ]);
    if (svcCount + tireCount > 0) {
      return res.status(409).json({
        error: 'Provozovna je použita v servisech / výměnách pneu, nelze smazat. Můžeš ji deaktivovat.',
        references: { services: svcCount, tire_changes: tireCount },
      });
    }
    await prisma.companyBranch.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/fleet/service-providers/:id — detail firmy
router.get('/service-providers/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const company = await prisma.company.findUnique({
      where: { id },
      include: { branches: { orderBy: { id: 'asc' } } },
    });
    if (!company) return res.status(404).json({ error: 'Firma nenalezena' });
    res.json(company);
  } catch (err) { next(err); }
});

// POST /api/fleet/service-providers — založí novou firmu
router.post('/service-providers', async (req, res, next) => {
  try {
    const parsed = serviceProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const data = toCompanyData(parsed.data);
    const company = await prisma.company.create({ data });
    res.status(201).json(company);
  } catch (err) { next(err); }
});

// PUT /api/fleet/service-providers/:id — upraví firmu
router.put('/service-providers/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = serviceProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const existing = await prisma.company.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Firma nenalezena' });
    const data = toCompanyData(parsed.data);
    const company = await prisma.company.update({ where: { id }, data });
    // Promítni změnu názvu do denormalizovaných polí existujících servisů / pneu výměn
    if (existing.name !== company.name) {
      await prisma.vehicleService.updateMany({
        where: { service_company_id: id },
        data: { service_company: company.name },
      });
      await prisma.vehicleTireChange.updateMany({
        where: { service_company_id: id },
        data: { service_company: company.name },
      });
    }
    res.json(company);
  } catch (err) { next(err); }
});

// DELETE /api/fleet/service-providers/:id — smaže firmu (pouze pokud ji nikdo nepoužívá)
// Kontrolujeme odkazy napříč fleetem i zbytkem systému. Pro soft-delete použij PUT { active: false }.
router.delete('/service-providers/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.company.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Firma nenalezena' });

    // Kontrola na reference — dokud existují, tvrdý delete nepovolíme.
    const [svcCount, tireCount, orderCount, materialCount] = await Promise.all([
      prisma.vehicleService.count({ where: { service_company_id: id } }),
      prisma.vehicleTireChange.count({ where: { service_company_id: id } }),
      prisma.order.count({ where: { company_id: id } }).catch(() => 0),
      prisma.material.count({ where: { supplier_id: id } }).catch(() => 0),
    ]);
    const refs = svcCount + tireCount + orderCount + materialCount;
    if (refs > 0) {
      return res.status(409).json({
        error: 'Firma je použita jinde v systému, nelze smazat. Můžeš ji deaktivovat.',
        references: { services: svcCount, tire_changes: tireCount, orders: orderCount, materials: materialCount },
      });
    }
    await prisma.company.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
