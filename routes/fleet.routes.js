// =============================================================================
// HolyOS — Vozový park (Vehicle Fleet) routes
// CRUD vozidel, filtrování, statusy POV/STK/dálniční známky, kontrola termínů
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

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

// ─── Validace ──────────────────────────────────────────────────────────────

const vehicleSchema = z.object({
  license_plate: z.string().max(20).optional().nullable(),
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
    const { search, category, active, status, driver_id } = req.query;

    const where = {};
    if (active !== undefined) where.active = active === 'true';
    if (category) where.category = category;
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

    res.json(enrichVehicle(vehicle));
  } catch (err) {
    next(err);
  }
});

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

module.exports = router;
