// =============================================================================
// HolyOS — Leasing / financující společnosti (financování prádlomatu)
// =============================================================================
// CRUD pro společnosti, které dokáží zákazníkovi zafinancovat prádlomat.
// Záložka „Leasing" v Prodejních objednávkách. IČO se doplňuje z ARES na webu
// (frontend volá /api/compounder/ares?ico=…).
// Mount: /api/leasing v app.js.

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const emptyToNull = (v) => { const s = (v == null ? '' : String(v)).trim(); return s ? s : null; };

const schema = z.object({
  name: z.string().trim().min(1).max(255),
  ico: z.string().trim().max(20).optional(),
  dic: z.string().trim().max(20).optional(),
  address: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  zip: z.string().trim().max(20).optional(),
  country: z.string().trim().max(4).optional(),
  contact_name: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(255).optional(),
  note: z.string().trim().max(6000).optional(),
  active: z.boolean().optional(),
});

// GET /api/leasing — seznam (volitelně ?q= a ?active=1)
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = {};
    if (req.query.active === '1') where.active = true;
    if (q) where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { ico: { contains: q } },
      { city: { contains: q, mode: 'insensitive' } },
      { contact_name: { contains: q, mode: 'insensitive' } },
    ];
    const rows = await prisma.leasingCompany.findMany({ where, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    res.json(rows);
  } catch (err) { next(err); }
});

function dataFrom(d) {
  return {
    name: d.name,
    ico: emptyToNull(d.ico), dic: emptyToNull(d.dic),
    address: emptyToNull(d.address), city: emptyToNull(d.city), zip: emptyToNull(d.zip),
    country: emptyToNull(d.country) || 'CZ',
    contact_name: emptyToNull(d.contact_name), phone: emptyToNull(d.phone), email: emptyToNull(d.email),
    note: emptyToNull(d.note),
    active: d.active === undefined ? true : !!d.active,
  };
}

// POST /api/leasing — nová společnost
router.post('/', async (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Vyplň název společnosti.' });
    const created = await prisma.leasingCompany.create({ data: dataFrom(parsed.data) });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/leasing/:id — úprava
router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const parsed = schema.partial({ name: true }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const d = parsed.data;
    const data = {};
    ['name'].forEach((k) => { if (d[k] !== undefined) data[k] = d[k]; });
    ['ico', 'dic', 'address', 'city', 'zip', 'contact_name', 'phone', 'email', 'note'].forEach((k) => { if (d[k] !== undefined) data[k] = emptyToNull(d[k]); });
    if (d.country !== undefined) data.country = emptyToNull(d.country) || 'CZ';
    if (d.active !== undefined) data.active = !!d.active;
    const updated = await prisma.leasingCompany.update({ where: { id: Number(req.params.id) }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/leasing/:id
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    await prisma.leasingCompany.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
