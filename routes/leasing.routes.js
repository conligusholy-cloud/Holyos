// =============================================================================
// HolyOS — Leasing / financující společnosti (financování prádlomatu)
// =============================================================================
// CRUD pro společnosti, které dokáží zákazníkovi zafinancovat prádlomat.
// Záložka „Leasing" v Prodejních objednávkách. IČO se doplňuje z ARES na webu
// (frontend volá /api/compounder/ares?ico=…).
// Mount: /api/leasing v app.js.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Úložiště dokumentů (Railway persistent volume přes DATA_DIR).
const DATA_ROOT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LEASING_DOCS_DIR = path.join(DATA_ROOT, 'leasing-docs');
try { if (!fs.existsSync(LEASING_DOCS_DIR)) fs.mkdirSync(LEASING_DOCS_DIR, { recursive: true }); } catch (e) { /* ignore */ }

// Kategorie žadatele o financování.
const DOC_CATEGORIES = ['fo', 'po_firma', 'po_zivnost'];

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
    // Smazat i soubory dokumentů (best-effort), DB kaskáduje.
    const docs = await prisma.leasingDocument.findMany({ where: { leasing_company_id: Number(req.params.id) }, select: { file_path: true } });
    for (const d of docs) { if (d.file_path) { try { const p = path.join(DATA_ROOT, d.file_path); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ } } }
    await prisma.leasingCompany.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOKUMENTY K ŽÁDOSTI O FINANCOVÁNÍ (dle typu žadatele)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/leasing/:id/documents — seznam dokumentů společnosti
router.get('/:id(\\d+)/documents', async (req, res, next) => {
  try {
    const items = await prisma.leasingDocument.findMany({
      where: { leasing_company_id: Number(req.params.id) },
      orderBy: [{ category: 'asc' }, { created_at: 'asc' }],
    });
    res.json({ items, categories: DOC_CATEGORIES });
  } catch (err) { next(err); }
});

// POST /api/leasing/:id/documents — nahrát dokument (base64 data URL) nebo jen položku
// Body: { category, title, note?, data_url?, filename? }
router.post('/:id(\\d+)/documents', async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const s = z.object({
      category: z.enum(DOC_CATEGORIES),
      title: z.string().trim().min(1).max(300),
      note: z.string().trim().max(2000).optional().nullable(),
      data_url: z.string().optional().nullable(),
      filename: z.string().max(300).optional().nullable(),
    });
    const parsed = s.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });
    const d = parsed.data;

    const company = await prisma.leasingCompany.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) return res.status(404).json({ error: 'Společnost nenalezena' });

    let file_path = null, size_bytes = null, mime_type = null;
    if (d.data_url) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(d.data_url);
      if (!m) return res.status(400).json({ error: 'Očekávám data URL (data:...;base64,...)' });
      mime_type = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Soubor je větší než 25 MB' });
      const rawExt = (d.filename && d.filename.includes('.')) ? d.filename.split('.').pop() : (mime_type.split('/')[1] || 'bin');
      const ext = String(rawExt).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
      const fname = `leasing-${companyId}-${d.category}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(LEASING_DOCS_DIR, fname), buf);
      file_path = `leasing-docs/${fname}`;
      size_bytes = buf.length;
    }

    const doc = await prisma.leasingDocument.create({
      data: { leasing_company_id: companyId, category: d.category, title: d.title, note: d.note || null, file_path, mime_type, size_bytes },
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// GET /api/leasing/documents/:did/download — stažení souboru
router.get('/documents/:did(\\d+)/download', async (req, res, next) => {
  try {
    const doc = await prisma.leasingDocument.findUnique({ where: { id: Number(req.params.did) } });
    if (!doc || !doc.file_path) return res.status(404).json({ error: 'Soubor nenalezen' });
    const full = path.join(DATA_ROOT, doc.file_path);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Soubor na disku chybí' });
    const ext = doc.file_path.split('.').pop();
    const safeTitle = String(doc.title || 'dokument').replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 100);
    if (doc.mime_type) res.type(doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
    res.sendFile(full);
  } catch (err) { next(err); }
});

// DELETE /api/leasing/documents/:did
router.delete('/documents/:did(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.did);
    const doc = await prisma.leasingDocument.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ error: 'Dokument nenalezen' });
    if (doc.file_path) { try { const p = path.join(DATA_ROOT, doc.file_path); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ } }
    await prisma.leasingDocument.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
