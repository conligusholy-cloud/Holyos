// =============================================================================
// HolyOS — Metodické pokyny a směrnice (Directive) routes
// CRUD směrnic, filtrování dle kategorie / stavu, fulltext hledání nad kódem
// a názvem. Přílohy se nahrávají přes /api/storage/upload a tady se ukládají
// jen jako pole referencí v JSON sloupci `attachments`.
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── Validace ──────────────────────────────────────────────────────────────

const directiveSchema = z.object({
  code: z.string().min(1).max(50),
  title: z.string().min(1).max(500),
  category: z.string().max(50).optional(),
  content: z.string().nullable().optional(),
  version: z.string().max(20).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  effective_from: z.string().datetime().nullable().optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  effective_to: z.string().datetime().nullable().optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  tags: z.array(z.string()).nullable().optional(),
  attachments: z.array(z.object({
    url: z.string(),
    name: z.string(),
    size: z.number().optional(),
    mime: z.string().optional(),
  })).nullable().optional(),
});

// Zkonvertuje volitelný string ("YYYY-MM-DD" / ISO / null / undefined / "") na Date | null | undefined
function toDateOrNull(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ─── Routes ────────────────────────────────────────────────────────────────

// GET /api/directives — seznam s filtrováním
router.get('/', async (req, res, next) => {
  try {
    const { search, category, status } = req.query;
    const where = {};

    if (category && category !== 'all') where.category = String(category);
    if (status && status !== 'all') where.status = String(status);

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { code:  { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.directive.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { code: 'asc' },
      ],
    });

    res.json(items);
  } catch (err) { next(err); }
});

// GET /api/directives/categories — souhrn počtů po kategoriích (pro UI badge)
router.get('/categories', async (req, res, next) => {
  try {
    const grouped = await prisma.directive.groupBy({
      by: ['category'],
      _count: { _all: true },
    });
    res.json(grouped.map(g => ({ category: g.category, count: g._count._all })));
  } catch (err) { next(err); }
});

// GET /api/directives/:id — detail
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const item = await prisma.directive.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'Směrnice nenalezena' });

    res.json(item);
  } catch (err) { next(err); }
});

// POST /api/directives — vytvoření nové směrnice
router.post('/', async (req, res, next) => {
  try {
    const parsed = directiveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    // Kontrola unikátnosti kódu
    const existing = await prisma.directive.findUnique({ where: { code: data.code } });
    if (existing) {
      return res.status(409).json({ error: `Směrnice s kódem "${data.code}" již existuje` });
    }

    const created = await prisma.directive.create({
      data: {
        code: data.code,
        title: data.title,
        category: data.category || 'obecne',
        content: data.content ?? null,
        version: data.version || '1.0',
        status: data.status || 'draft',
        effective_from: toDateOrNull(data.effective_from) ?? null,
        effective_to: toDateOrNull(data.effective_to) ?? null,
        tags: data.tags ?? null,
        attachments: data.attachments ?? null,
        created_by: req.user?.id ?? null,
        updated_by: req.user?.id ?? null,
      },
    });

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/directives/:id — úprava
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const parsed = directiveSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }

    const data = parsed.data;
    const existing = await prisma.directive.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Směrnice nenalezena' });

    // Když se mění kód, ověř unikátnost
    if (data.code && data.code !== existing.code) {
      const dup = await prisma.directive.findUnique({ where: { code: data.code } });
      if (dup) return res.status(409).json({ error: `Směrnice s kódem "${data.code}" již existuje` });
    }

    const updateData = {
      updated_by: req.user?.id ?? null,
    };
    if (data.code !== undefined)         updateData.code = data.code;
    if (data.title !== undefined)        updateData.title = data.title;
    if (data.category !== undefined)     updateData.category = data.category;
    if (data.content !== undefined)      updateData.content = data.content;
    if (data.version !== undefined)      updateData.version = data.version;
    if (data.status !== undefined)       updateData.status = data.status;
    if (data.effective_from !== undefined) updateData.effective_from = toDateOrNull(data.effective_from);
    if (data.effective_to !== undefined)   updateData.effective_to = toDateOrNull(data.effective_to);
    if (data.tags !== undefined)         updateData.tags = data.tags;
    if (data.attachments !== undefined)  updateData.attachments = data.attachments;

    const updated = await prisma.directive.update({ where: { id }, data: updateData });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/directives/:id — smazání
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const existing = await prisma.directive.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Směrnice nenalezena' });

    await prisma.directive.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
