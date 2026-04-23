// HolyOS — Tiskový subsystém | REST API
// Namespace: /api/print
//
// Zahrnuje:
//   - CRUD tiskáren (printers)
//   - CRUD šablon etiket (label_templates)
//   - Test tiskárny (ping + testovací etiketa)
//   - Hlavní tiskový endpoint POST /api/print
//   - Historie tisků (print_jobs)

const express = require('express');
const { z } = require('zod');

const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit, diffObjects, makeSnapshot } = require('../services/audit');
const { printLabel, testPrinter } = require('../services/print/print.service');
const { extractPlaceholders } = require('../services/print/zpl-renderer');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Zod schémata
// ---------------------------------------------------------------------------
const printerInputSchema = z.object({
  name: z.string().min(1).max(100),
  model: z.string().min(1).max(50).default('TSC_TC200'),
  location_id: z.number().int().nullable().optional(),
  connection_type: z.enum(['lan', 'usb']).default('lan'),
  ip_address: z.string().nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  language: z.enum(['ZPL', 'TSPL', 'EPL']).default('ZPL'),
  label_width_mm: z.number().default(60),
  label_height_mm: z.number().default(20),
  dpi: z.number().int().default(203),
  priority: z.number().int().default(0),
  is_active: z.boolean().default(true),
  encoding: z.string().default('UTF-8'),
  pre_command: z.string().nullable().optional(),
  post_command: z.string().nullable().optional(),
  gap_mm: z.number().nullable().optional(),
}).partial().required({ name: true });

const labelTemplateInputSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  language: z.enum(['ZPL', 'TSPL', 'EPL']).default('ZPL'),
  width_mm: z.number().default(60),
  height_mm: z.number().default(20),
  body: z.string().min(1),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
}).partial().required({ code: true, name: true, body: true });

const printJobInputSchema = z.object({
  template: z.string().min(1),        // kód šablony
  data: z.record(z.any()).default({}),
  printer_id: z.number().int().nullable().optional(),
  copies: z.number().int().min(1).max(99).default(1),
  location_id: z.number().int().nullable().optional(),
});

// ===========================================================================
// PRINTERS
// ===========================================================================

// GET /api/print/printers — seznam
router.get('/printers', async (req, res, next) => {
  try {
    const printers = await prisma.printer.findMany({
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      include: { location: { select: { id: true, label: true, warehouse_id: true } } },
    });
    res.json(printers);
  } catch (err) { next(err); }
});

// POST /api/print/printers — vytvoření
router.post('/printers', async (req, res, next) => {
  try {
    const data = printerInputSchema.parse(req.body);
    const printer = await prisma.printer.create({ data });
    await logAudit({
      action: 'create',
      entity: 'printer',
      entity_id: printer.id,
      description: `Vytvořena tiskárna: ${printer.name}`,
      snapshot: makeSnapshot(printer),
      user: req.user,
    });
    res.status(201).json(printer);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// GET /api/print/printers/:id — detail
router.get('/printers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const printer = await prisma.printer.findUnique({
      where: { id },
      include: { location: true },
    });
    if (!printer) return res.status(404).json({ error: 'Tiskárna neexistuje' });
    res.json(printer);
  } catch (err) { next(err); }
});

// PATCH /api/print/printers/:id — úprava
router.patch('/printers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.printer.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Tiskárna neexistuje' });

    const data = printerInputSchema.partial().parse(req.body);
    const updated = await prisma.printer.update({ where: { id }, data });

    await logAudit({
      action: 'update',
      entity: 'printer',
      entity_id: id,
      description: `Upravena tiskárna: ${updated.name}`,
      changes: diffObjects(before, updated),
      snapshot: makeSnapshot(before),
      user: req.user,
    });
    res.json(updated);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// DELETE /api/print/printers/:id
router.delete('/printers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.printer.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Tiskárna neexistuje' });

    const jobsCount = await prisma.printJob.count({ where: { printer_id: id } });
    if (jobsCount > 0) {
      // kvůli RESTRICT FK ponecháme jen deaktivaci
      await prisma.printer.update({ where: { id }, data: { is_active: false } });
      await logAudit({
        action: 'update',
        entity: 'printer',
        entity_id: id,
        description: `Tiskárna "${before.name}" deaktivována (má ${jobsCount} tisků v historii, nelze smazat)`,
        snapshot: makeSnapshot(before),
        user: req.user,
      });
      return res.status(200).json({ deactivated: true, reason: 'printer_has_jobs' });
    }
    await prisma.printer.delete({ where: { id } });
    await logAudit({
      action: 'delete',
      entity: 'printer',
      entity_id: id,
      description: `Smazána tiskárna: ${before.name}`,
      snapshot: makeSnapshot(before),
      user: req.user,
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/print/printers/:id/test — zkušební tisk
router.post('/printers/:id/test', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const withTestLabel = req.body?.withTestLabel !== false; // default true
    const result = await testPrinter(id, { withTestLabel });
    res.json(result);
  } catch (err) { next(err); }
});

// ===========================================================================
// LABEL TEMPLATES
// ===========================================================================

// GET /api/print/templates
router.get('/templates', async (req, res, next) => {
  try {
    const templates = await prisma.labelTemplate.findMany({
      orderBy: { code: 'asc' },
    });
    // Přidáme seznam placeholderů, aby UI mohlo validovat vstup
    const withPlaceholders = templates.map(t => ({
      ...t,
      placeholders: extractPlaceholders(t.body),
    }));
    res.json(withPlaceholders);
  } catch (err) { next(err); }
});

// GET /api/print/templates/:id
router.get('/templates/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tpl = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!tpl) return res.status(404).json({ error: 'Šablona neexistuje' });
    res.json({ ...tpl, placeholders: extractPlaceholders(tpl.body) });
  } catch (err) { next(err); }
});

// POST /api/print/templates
router.post('/templates', async (req, res, next) => {
  try {
    const data = labelTemplateInputSchema.parse(req.body);
    const tpl = await prisma.labelTemplate.create({ data });
    await logAudit({
      action: 'create',
      entity: 'label_template',
      entity_id: tpl.id,
      description: `Vytvořena šablona: ${tpl.code}`,
      snapshot: makeSnapshot(tpl),
      user: req.user,
    });
    res.status(201).json(tpl);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// PATCH /api/print/templates/:id
router.patch('/templates/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Šablona neexistuje' });

    const data = labelTemplateInputSchema.partial().parse(req.body);
    const updated = await prisma.labelTemplate.update({ where: { id }, data });

    await logAudit({
      action: 'update',
      entity: 'label_template',
      entity_id: id,
      description: `Upravena šablona: ${updated.code}`,
      changes: diffObjects(before, updated),
      snapshot: makeSnapshot(before),
      user: req.user,
    });
    res.json(updated);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// DELETE /api/print/templates/:id
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: 'Šablona neexistuje' });

    const jobsCount = await prisma.printJob.count({ where: { template_id: id } });
    if (jobsCount > 0) {
      await prisma.labelTemplate.update({ where: { id }, data: { is_active: false } });
      return res.status(200).json({ deactivated: true, reason: 'template_has_jobs' });
    }
    await prisma.labelTemplate.delete({ where: { id } });
    await logAudit({
      action: 'delete',
      entity: 'label_template',
      entity_id: id,
      description: `Smazána šablona: ${before.code}`,
      snapshot: makeSnapshot(before),
      user: req.user,
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ===========================================================================
// PRINT JOBS
// ===========================================================================

// POST /api/print — hlavní tiskový endpoint (web + PWA)
router.post('/', async (req, res, next) => {
  try {
    const input = printJobInputSchema.parse(req.body);
    const job = await printLabel({
      ...input,
      user_id: req.user?.person_id ?? req.user?.id ?? null,
      device_id: req.get('X-Device-Id') || null,
    });
    res.status(200).json(job);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.startsWith('Tisk selhal') || err.message?.startsWith('Žádná aktivní tiskárna')) {
      return res.status(503).json({ error: err.message, job_id: err.jobId || null });
    }
    next(err);
  }
});

// GET /api/print/jobs — historie tiskových úloh
router.get('/jobs', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.printer_id) where.printer_id = Number(req.query.printer_id);
    if (req.query.status) where.status = String(req.query.status);
    const limit = Math.min(Number(req.query.limit) || 50, 500);

    const jobs = await prisma.printJob.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        printer: { select: { id: true, name: true } },
        template: { select: { id: true, code: true, name: true } },
      },
    });
    res.json(jobs);
  } catch (err) { next(err); }
});

module.exports = router;
