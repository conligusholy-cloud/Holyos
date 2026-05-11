// =============================================================================
// HolyOS — Slot Schemes (týdenní vzorec výrobních slotů s časovou platností)
// =============================================================================
//
// Modul Výrobní sloty potřebuje umět: „od 1.9.2026 chci místo Po–Pá mít dva
// sloty/týden (Po–St a St–Pá)". Konfigurace už není 1 řádek v localStorage,
// ale série SlotScheme (každé schéma má 1..N oken a časový řez valid_from/valid_to).
//
// Auto-close: při POST nového schématu se předchozí otevřené (valid_to=NULL)
// automaticky uzavře dnem před valid_from nového. Bez překryvu.
//
// Konvence dnů: start_day/end_day jsou 0..6 (0=neděle, ..., 6=sobota) — stejně
// jako JavaScript Date.getDay() a původní frontend.

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Společný include — okna seřazená podle sort_order
const SCHEME_INCLUDE = {
  windows: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
  creator: { select: { id: true, username: true, display_name: true } },
};

// ─── Schemas ────────────────────────────────────────────────────────────────

const windowSchema = z.object({
  start_day: z.number().int().min(0).max(6),
  end_day: z.number().int().min(0).max(6),
  sort_order: z.number().int().min(0).default(0).optional(),
  name: z.string().max(50).nullable().optional(),
});

const createSchema = z.object({
  // ISO date string (YYYY-MM-DD) nebo plný DateTime — Prisma si poradí
  valid_from: z.string().min(8),
  valid_to: z.string().min(8).nullable().optional(),
  note: z.string().max(255).nullable().optional(),
  windows: z.array(windowSchema).min(1, 'Vzorec musí mít aspoň jedno okno.'),
});

const updateSchema = createSchema.partial().extend({
  // PUT může obsahovat windows (kompletní replace) i ne (jen meta změna)
  windows: z.array(windowSchema).min(1).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

// Datum den před zadaným (pro auto-close). Vstup může být Date i string.
function dayBefore(dateLike) {
  const d = new Date(dateLike);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// Normalizace na půlnoc UTC (pro DATE sloupec v Postgresu)
function toDateOnly(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/slot-schemes — celá historie + aktuální schéma (nejnovější první)
router.get('/', async (req, res, next) => {
  try {
    const schemes = await prisma.slotScheme.findMany({
      orderBy: [{ valid_from: 'desc' }, { id: 'desc' }],
      include: SCHEME_INCLUDE,
    });
    res.json(schemes);
  } catch (err) { next(err); }
});

// GET /api/slot-schemes/active?date=YYYY-MM-DD — pomocný endpoint:
// vrátí schéma, které platí v daný den (defaultně dnes). Pro pohodlí dashboardu.
router.get('/active', async (req, res, next) => {
  try {
    const ref = toDateOnly(req.query.date || new Date());
    const scheme = await prisma.slotScheme.findFirst({
      where: {
        valid_from: { lte: ref },
        OR: [{ valid_to: null }, { valid_to: { gte: ref } }],
      },
      orderBy: { valid_from: 'desc' },
      include: SCHEME_INCLUDE,
    });
    res.json(scheme);
  } catch (err) { next(err); }
});

// GET /api/slot-schemes/:id — detail (pro edit modal)
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const scheme = await prisma.slotScheme.findUnique({
      where: { id },
      include: SCHEME_INCLUDE,
    });
    if (!scheme) return res.status(404).json({ error: 'Schéma nenalezeno' });
    res.json(scheme);
  } catch (err) { next(err); }
});

// POST /api/slot-schemes — vytvořit nové schéma + auto-close předchozího
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.format() });
    }
    const data = parsed.data;
    const validFrom = toDateOnly(data.valid_from);
    const validTo = data.valid_to ? toDateOnly(data.valid_to) : null;

    // Auto-close: pokud existuje otevřené schéma (valid_to NULL) a jeho
    // valid_from je STARŠÍ než nové, zavřeme ho dnem před valid_from nového.
    // Pokud uživatel vytvoří schéma do minulosti (nepravděpodobné, ale možné),
    // necháme to být — nechť si to upraví ručně.
    const openPrev = await prisma.slotScheme.findFirst({
      where: { valid_to: null, valid_from: { lt: validFrom } },
      orderBy: { valid_from: 'desc' },
    });

    // Vše v jedné transakci — buď se uzavře předchozí + vytvoří nové, nebo nic.
    const result = await prisma.$transaction(async (tx) => {
      if (openPrev) {
        await tx.slotScheme.update({
          where: { id: openPrev.id },
          data: { valid_to: dayBefore(validFrom) },
        });
      }
      return tx.slotScheme.create({
        data: {
          valid_from: validFrom,
          valid_to: validTo,
          note: data.note || null,
          created_by: req.user.id,
          windows: {
            create: data.windows.map((w, i) => ({
              start_day: w.start_day,
              end_day: w.end_day,
              sort_order: typeof w.sort_order === 'number' ? w.sort_order : i,
              name: w.name || null,
            })),
          },
        },
        include: SCHEME_INCLUDE,
      });
    });

    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/slot-schemes/:id — edit existujícího schématu
// Pokud body obsahuje `windows`, kompletně se vymění (delete+create).
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validace selhala', details: parsed.error.format() });
    }
    const data = parsed.data;

    const patch = {};
    if (data.valid_from !== undefined) patch.valid_from = toDateOnly(data.valid_from);
    if (data.valid_to !== undefined) patch.valid_to = data.valid_to ? toDateOnly(data.valid_to) : null;
    if (data.note !== undefined) patch.note = data.note || null;

    const result = await prisma.$transaction(async (tx) => {
      if (data.windows) {
        await tx.slotSchemeWindow.deleteMany({ where: { scheme_id: id } });
        await tx.slotSchemeWindow.createMany({
          data: data.windows.map((w, i) => ({
            scheme_id: id,
            start_day: w.start_day,
            end_day: w.end_day,
            sort_order: typeof w.sort_order === 'number' ? w.sort_order : i,
            name: w.name || null,
          })),
        });
      }
      return tx.slotScheme.update({
        where: { id },
        data: patch,
        include: SCHEME_INCLUDE,
      });
    });

    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/slot-schemes/:id — smazat schéma
// Windows se smažou kaskádou. Pokud byl smazán otevřený řez a chceš ho vrátit
// k předchozímu, znovu mu nastav valid_to=NULL ručně přes PUT.
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    await prisma.slotScheme.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
