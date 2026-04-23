// HolyOS — Sklad 2.0 | REST API (nové endpointy)
//
// Namespace: /api/wh (stejný jako legacy warehouse.routes.js — tento router
// se mountuje za ním a přidává jen nové cesty bez kolizí).
//
// Nové endpointy:
//   POST /api/wh/moves                     — idempotentní pohyb s client_uuid
//   GET  /api/wh/moves                     — filtrace (material_id, document_id, type, ...)
//   GET  /api/wh/items/by-qr/:qr_code      — lookup materiálu podle barcode (QR)
//   GET  /api/wh/locations/by-qr/:qr_code  — lookup lokace podle barcode (QR)
//   GET  /api/wh/sync/materials            — delta sync pro PWA
//   GET  /api/wh/sync/locations            — full dump pro PWA (malé, stačí refresh)
//
// Backward-compat: stávající /api/wh/movements v warehouse.routes.js zůstává
// pro dnešní web UI (používá Material.current_stock, nevytváří Stock řádky).

const express = require('express');
const { z } = require('zod');

const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { createMove, resolvePersonIdForUser, MOVE_TYPES } = require('../services/warehouse/moves.service');
const { createDocument, completeDocument, cancelDocument, DOC_TYPES } = require('../services/warehouse/documents.service');
const { createBatch, pickBatchItem, pickBatchItemMultiLot, completeBatch, BATCH_STATUS } = require('../services/warehouse/batches.service');
const { lockLocations, unlockLocations, finishInventoryWithAdjust } = require('../services/warehouse/inventory-v2.service');
const serialNumbersService = require('../services/warehouse/serial-numbers.service');
const lotsService = require('../services/warehouse/lots.service');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------
const moveInputSchema = z.object({
  client_uuid: z.string().uuid().optional(),
  type: z.enum(MOVE_TYPES),
  material_id: z.number().int().positive(),
  warehouse_id: z.number().int().positive(),
  quantity: z.number(), // signed pro adjustment/inventory_adjust
  location_id: z.number().int().positive().nullable().optional(),
  from_location_id: z.number().int().positive().nullable().optional(),
  to_location_id: z.number().int().positive().nullable().optional(),
  document_id: z.number().int().positive().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  reference_type: z.string().nullable().optional(),
  reference_id: z.number().int().nullable().optional(),
  note: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/wh/moves
// ---------------------------------------------------------------------------
router.post('/moves', async (req, res, next) => {
  try {
    const input = moveInputSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await createMove({
      ...input,
      created_by: person_id,
      device_id: req.get('X-Device-Id') || null,
    });
    res.status(result.deduped ? 200 : 201).json({
      ...result.move,
      _deduped: result.deduped, // informativní, klient ví, že šlo o resend
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('vyžaduje')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/wh/moves — filtrace
// ---------------------------------------------------------------------------
router.get('/moves', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.material_id) where.material_id = Number(req.query.material_id);
    if (req.query.warehouse_id) where.warehouse_id = Number(req.query.warehouse_id);
    if (req.query.document_id) where.document_id = Number(req.query.document_id);
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.from || req.query.to) {
      where.created_at = {};
      if (req.query.from) where.created_at.gte = new Date(req.query.from);
      if (req.query.to) where.created_at.lte = new Date(req.query.to);
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const moves = await prisma.inventoryMovement.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true } },
        location: { select: { id: true, label: true } },
        from_location: { select: { id: true, label: true } },
        to_location: { select: { id: true, label: true } },
      },
    });
    res.json(moves);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/wh/items/by-qr/:qr_code — lookup materiálu podle barcode
// ---------------------------------------------------------------------------
router.get('/items/by-qr/:qr_code', async (req, res, next) => {
  try {
    const qr = String(req.params.qr_code);
    const material = await prisma.material.findUnique({
      where: { barcode: qr },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!material) return res.status(404).json({ error: 'Materiál s tímto QR kódem neexistuje' });

    // Top 10 lokací, kde materiál fyzicky leží
    const stockByLocation = await prisma.stock.findMany({
      where: { material_id: material.id, quantity: { gt: 0 } },
      orderBy: { quantity: 'desc' },
      take: 10,
      include: {
        location: { select: { id: true, label: true, warehouse_id: true, type: true } },
      },
    });

    // Posledních 10 pohybů
    const lastMovements = await prisma.inventoryMovement.findMany({
      where: { material_id: material.id },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: {
        id: true, type: true, quantity: true, location_id: true,
        from_location_id: true, to_location_id: true, created_at: true,
      },
    });

    res.json({ ...material, stock_by_location: stockByLocation, last_movements: lastMovements });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/wh/locations/by-qr/:qr_code — lookup lokace podle barcode
// ---------------------------------------------------------------------------
router.get('/locations/by-qr/:qr_code', async (req, res, next) => {
  try {
    const qr = String(req.params.qr_code);
    const location = await prisma.warehouseLocation.findUnique({
      where: { barcode: qr },
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });
    if (!location) return res.status(404).json({ error: 'Lokace s tímto QR kódem neexistuje' });

    const stock = await prisma.stock.findMany({
      where: { location_id: location.id, quantity: { gt: 0 } },
      orderBy: { quantity: 'desc' },
      include: {
        material: { select: { id: true, code: true, name: true, unit: true } },
      },
    });

    res.json({ ...location, stock });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/wh/sync/materials — delta sync pro PWA
// ---------------------------------------------------------------------------
router.get('/sync/materials', async (req, res, next) => {
  try {
    const since = req.query.since ? new Date(String(req.query.since)) : null;
    const where = { status: 'active' };
    if (since) where.updated_at = { gt: since };
    if (req.query.sector) where.sector = String(req.query.sector);

    const items = await prisma.material.findMany({
      where,
      select: {
        id: true, code: true, name: true, barcode: true, unit: true, sector: true,
        current_stock: true, min_stock: true, updated_at: true,
      },
      orderBy: { id: 'asc' },
      take: 5000, // safety cap
    });

    res.json({ items, server_time: new Date().toISOString(), count: items.length });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/wh/sync/locations — full dump (lokací je málo, delta zbytečná)
// ---------------------------------------------------------------------------
router.get('/sync/locations', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.warehouse_id) where.warehouse_id = Number(req.query.warehouse_id);
    const items = await prisma.warehouseLocation.findMany({
      where,
      orderBy: [{ warehouse_id: 'asc' }, { label: 'asc' }],
    });
    res.json({ items, server_time: new Date().toISOString(), count: items.length });
  } catch (err) { next(err); }
});

// ===========================================================================
// DOCUMENTS
// ===========================================================================

const documentInputSchema = z.object({
  type: z.enum(DOC_TYPES),
  partner_id: z.number().int().nullable().optional(),
  reference: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

router.get('/documents', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.partner_id) where.partner_id = Number(req.query.partner_id);
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const docs = await prisma.warehouseDocument.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        partner: { select: { id: true, name: true } },
        _count: { select: { movements: true } },
      },
    });
    res.json(docs);
  } catch (err) { next(err); }
});

router.post('/documents', async (req, res, next) => {
  try {
    const input = documentInputSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const doc = await createDocument({ ...input, created_by: person_id });
    res.status(201).json(doc);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.get('/documents/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const doc = await prisma.warehouseDocument.findUnique({
      where: { id },
      include: {
        partner: true,
        creator: { select: { id: true, first_name: true, last_name: true } },
        movements: {
          include: {
            material: { select: { id: true, code: true, name: true, unit: true } },
            location: { select: { id: true, label: true } },
            from_location: { select: { id: true, label: true } },
            to_location: { select: { id: true, label: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!doc) return res.status(404).json({ error: 'Dokument neexistuje' });
    res.json(doc);
  } catch (err) { next(err); }
});

router.patch('/documents/:id', async (req, res, next) => {
  // edit jen pro draft/in_progress dokumenty
  try {
    const id = Number(req.params.id);
    const current = await prisma.warehouseDocument.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Dokument neexistuje' });
    if (current.status === 'completed' || current.status === 'cancelled') {
      return res.status(409).json({ error: `Dokument je ${current.status}, nelze editovat` });
    }
    const input = documentInputSchema.partial().omit({ type: true }).parse(req.body);
    const updated = await prisma.warehouseDocument.update({ where: { id }, data: input });
    res.json(updated);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.patch('/documents/:id/complete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const person_id = await resolvePersonIdForUser(req.user);
    const doc = await completeDocument(id, person_id);
    res.json(doc);
  } catch (err) {
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('zrušen')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.patch('/documents/:id/cancel', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const doc = await cancelDocument(id);
    res.json(doc);
  } catch (err) {
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('Uzavřený')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// ===========================================================================
// BATCHES (pickovací dávky)
// ===========================================================================

const batchInputSchema = z.object({
  sector: z.enum(['vyroba', 'stavba', 'servis', 'eshop', 'pradelna']).nullable().optional(),
  assigned_to: z.number().int().nullable().optional(),
  note: z.string().nullable().optional(),
  items: z.array(z.object({
    material_id: z.number().int().positive(),
    quantity: z.number().positive(),
    from_location_id: z.number().int().positive().nullable().optional(),
    sort_order: z.number().int().optional(),
  })).min(1),
});

const pickInputSchema = z.object({
  batch_item_id: z.number().int().positive(),
  picked_quantity: z.number().min(0),
  from_location_id: z.number().int().positive().optional(),
  client_uuid: z.string().uuid(),
  note: z.string().nullable().optional(),
});

router.get('/batches', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.assigned_to) where.assigned_to = Number(req.query.assigned_to);
    if (req.query.sector) where.sector = String(req.query.sector);

    const batches = await prisma.batch.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: Math.min(Number(req.query.limit) || 100, 500),
      include: {
        assignee: { select: { id: true, first_name: true, last_name: true } },
        _count: { select: { items: true } },
      },
    });
    res.json(batches);
  } catch (err) { next(err); }
});

router.post('/batches', async (req, res, next) => {
  try {
    const input = batchInputSchema.parse(req.body);
    const batch = await createBatch(input);
    res.status(201).json(batch);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.get('/batches/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, first_name: true, last_name: true } },
        items: {
          orderBy: { sort_order: 'asc' },
          include: {
            material: { select: { id: true, code: true, name: true, unit: true, barcode: true } },
            from_location: { select: { id: true, label: true, barcode: true } },
            picker: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
    });
    if (!batch) return res.status(404).json({ error: 'Dávka neexistuje' });
    res.json(batch);
  } catch (err) { next(err); }
});

router.post('/batches/:id/pick', async (req, res, next) => {
  try {
    const batch_id = Number(req.params.id);
    const input = pickInputSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await pickBatchItem({
      batch_id,
      batch_item_id: input.batch_item_id,
      picked_quantity: input.picked_quantity,
      from_location_id: input.from_location_id,
      client_uuid: input.client_uuid,
      device_id: req.get('X-Device-Id') || null,
      user_person_id: person_id,
      note: input.note,
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('Dávka je ve stavu')) return res.status(409).json({ error: err.message });
    if (err.message?.includes('Chybí from_location_id') || err.message?.includes('nepatří')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/wh/batches/:id/pick-split — rozdělený pick přes víc šarží
const pickSplitInputSchema = z.object({
  batch_item_id: z.number().int().positive(),
  client_uuid_prefix: z.string().uuid(),
  note: z.string().nullable().optional(),
  splits: z.array(
    z.object({
      lot_id: z.number().int().positive(),
      quantity: z.number().positive(),
      from_location_id: z.number().int().positive().nullable().optional(),
    })
  ).min(1),
});

router.post('/batches/:id/pick-split', async (req, res, next) => {
  try {
    const batch_id = Number(req.params.id);
    const input = pickSplitInputSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await pickBatchItemMultiLot({
      batch_id,
      batch_item_id: input.batch_item_id,
      splits: input.splits,
      client_uuid_prefix: input.client_uuid_prefix,
      device_id: req.get('X-Device-Id') || null,
      user_person_id: person_id,
      note: input.note,
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('Dávka je ve stavu')) return res.status(409).json({ error: err.message });
    if (
      err.message?.includes('splits') ||
      err.message?.includes('musí být') ||
      err.message?.includes('Chybí') ||
      err.message?.includes('UUID') ||
      err.message?.includes('lot_id')
    ) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.patch('/batches/:id/complete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const batch = await completeBatch(id);
    res.json(batch);
  } catch (err) {
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ===========================================================================
// INVENTORY v2 — lock + finish-v2 (s generováním adjust pohybů)
//
// POZOR: stávající /api/wh/inventories/:id/start a /complete v warehouse.routes.js
// zůstávají zachované pro dnešní web UI. V2 endpointy jsou dodatek pro PWA flow.
// ===========================================================================

router.post('/inventories/:id/lock-locations', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = await lockLocations(id);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/inventories/:id/unlock-locations', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = await unlockLocations(id);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/inventories/:id/finish-v2', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await finishInventoryWithAdjust(id, person_id);
    res.json(result);
  } catch (err) {
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('uzavřená')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// ===========================================================================
// SERIAL NUMBERS — tracking konkrétních kusů (servis + save_sn_first_scan)
// ===========================================================================

// GET /api/wh/serials?sn=XYZ    — fulltext lookup napříč materiály
router.get('/serials', async (req, res, next) => {
  try {
    const sn = req.query.sn ? String(req.query.sn) : null;
    if (!sn) return res.status(400).json({ error: 'Chybí query parametr ?sn=' });
    const matches = await serialNumbersService.lookupBySerialNumber(sn);
    res.json(matches);
  } catch (err) { next(err); }
});

// GET /api/wh/serials/:id       — detail jednoho kusu
router.get('/serials/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sn = await serialNumbersService.getSerialById(id);
    if (!sn) return res.status(404).json({ error: 'Sériové číslo neexistuje' });
    res.json(sn);
  } catch (err) { next(err); }
});

// GET /api/wh/materials/:id/serials — seznam S/N pro materiál
router.get('/materials/:id/serials', async (req, res, next) => {
  try {
    const material_id = Number(req.params.id);
    const status = req.query.status ? String(req.query.status) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const list = await serialNumbersService.listByMaterial(material_id, { status, limit });
    res.json(list);
  } catch (err) { next(err); }
});

// POST /api/wh/materials/:id/serials/bulk-receipt
//   body: { warehouse_id, location_id, serials: string[], unit_price?, document_id?, note?, client_uuid? }
//   vytvoří 1× receipt move + N× SerialNumber v transakci
const bulkReceiptSchema = z.object({
  warehouse_id: z.number().int().positive(),
  location_id: z.number().int().positive(),
  serials: z.array(z.string().min(1)).min(1),
  unit_price: z.number().nullable().optional(),
  document_id: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
  client_uuid: z.string().uuid().nullable().optional(),
});

router.post('/materials/:id/serials/bulk-receipt', async (req, res, next) => {
  try {
    const material_id = Number(req.params.id);
    const input = bulkReceiptSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await serialNumbersService.createBulkReceiptWithSerials({
      material_id,
      warehouse_id: input.warehouse_id,
      location_id: input.location_id,
      serials: input.serials,
      unit_price: input.unit_price ?? undefined,
      document_id: input.document_id ?? undefined,
      note: input.note ?? undefined,
      client_uuid: input.client_uuid ?? undefined,
      device_id: req.get('X-Device-Id') || null,
      created_by: person_id,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (
      err.message?.includes('duplicity') ||
      err.message?.includes('už existují') ||
      err.message?.includes('neodpovídá masce') ||
      err.message?.includes('save_sn_first_scan')
    ) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// PATCH /api/wh/serials/:id/issue
//   body: { warehouse_id, reference_type?, reference_id?, note?, client_uuid? }
const issueSchema = z.object({
  warehouse_id: z.number().int().positive(),
  reference_type: z.string().nullable().optional(),
  reference_id: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
  client_uuid: z.string().uuid().nullable().optional(),
});

router.patch('/serials/:id/issue', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const input = issueSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await serialNumbersService.issueSerial({
      id,
      warehouse_id: input.warehouse_id,
      reference_type: input.reference_type ?? undefined,
      reference_id: input.reference_id ?? undefined,
      note: input.note ?? undefined,
      client_uuid: input.client_uuid ?? undefined,
      device_id: req.get('X-Device-Id') || null,
      issued_by: person_id,
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('není ve stavu')) return res.status(409).json({ error: err.message });
    if (err.message?.includes('nemá aktuální lokaci')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/wh/serials/:id/scrap
router.patch('/serials/:id/scrap', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const note = req.body?.note ? String(req.body.note) : null;
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await serialNumbersService.scrapSerial({
      id, note, scrapped_by: person_id,
    });
    res.json(result);
  } catch (err) {
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/wh/serials/:id/return — vrátit issued kus zpět
const returnSchema = z.object({
  location_id: z.number().int().positive(),
  note: z.string().nullable().optional(),
});

router.patch('/serials/:id/return', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const input = returnSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await serialNumbersService.returnSerial({
      id,
      location_id: input.location_id,
      note: input.note ?? undefined,
      returned_by: person_id,
    });
    res.json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('není ve stavu')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// ===========================================================================
// MATERIAL LOTS — šarže s expirací (prádelna, potraviny, chemie)
// ===========================================================================

// GET /api/wh/materials/:id/lots?status=&expiringWithinDays=
router.get('/materials/:id/lots', async (req, res, next) => {
  try {
    const material_id = Number(req.params.id);
    const status = req.query.status ? String(req.query.status) : undefined;
    const expiringWithinDays = req.query.expiringWithinDays ? Number(req.query.expiringWithinDays) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const list = await lotsService.listByMaterial(material_id, { status, expiringWithinDays, limit });
    res.json(list);
  } catch (err) { next(err); }
});

// GET /api/wh/lots/:id
router.get('/lots/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const lot = await lotsService.getLotById(id);
    if (!lot) return res.status(404).json({ error: 'Šarže neexistuje' });
    res.json(lot);
  } catch (err) { next(err); }
});

// GET /api/wh/lots/expiring?days=30
router.get('/lots/expiring', async (req, res, next) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 30;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    const list = await lotsService.getExpiring({ days, limit });
    res.json(list);
  } catch (err) { next(err); }
});

// GET /api/wh/materials/:materialId/lots/by-code/:code
router.get('/materials/:materialId/lots/by-code/:code', async (req, res, next) => {
  try {
    const material_id = Number(req.params.materialId);
    const code = String(req.params.code);
    const lot = await lotsService.lookupByLotCode(material_id, code);
    if (!lot) return res.status(404).json({ error: 'Šarže neexistuje' });
    res.json(lot);
  } catch (err) { next(err); }
});

// POST /api/wh/materials/:id/lots — vytvoření šarže bez pohybu (evidovat dopředu)
const lotCreateSchema = z.object({
  lot_code: z.string().min(1),
  manufactured_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  supplier_id: z.number().int().positive().nullable().optional(),
  supplier_lot_ref: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

router.post('/materials/:id/lots', async (req, res, next) => {
  try {
    const material_id = Number(req.params.id);
    const input = lotCreateSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const lot = await lotsService.createLot({
      material_id,
      lot_code: input.lot_code,
      manufactured_at: input.manufactured_at ?? null,
      expires_at: input.expires_at ?? null,
      supplier_id: input.supplier_id ?? null,
      supplier_lot_ref: input.supplier_lot_ref ?? null,
      note: input.note ?? null,
      received_by: person_id,
    });
    res.status(201).json(lot);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'Šarže s tímto lot_code už existuje' });
    }
    next(err);
  }
});

// POST /api/wh/materials/:id/lots/receive — příjem šarže + move + Stock
const lotReceiveSchema = z.object({
  warehouse_id: z.number().int().positive(),
  location_id: z.number().int().positive(),
  quantity: z.number().positive(),
  lot_code: z.string().min(1),
  manufactured_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  supplier_id: z.number().int().positive().nullable().optional(),
  supplier_lot_ref: z.string().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  document_id: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
  client_uuid: z.string().uuid().nullable().optional(),
});

router.post('/materials/:id/lots/receive', async (req, res, next) => {
  try {
    const material_id = Number(req.params.id);
    const input = lotReceiveSchema.parse(req.body);
    const person_id = await resolvePersonIdForUser(req.user);
    const result = await lotsService.receiveLotWithMove({
      material_id,
      warehouse_id: input.warehouse_id,
      location_id: input.location_id,
      quantity: input.quantity,
      lot_code: input.lot_code,
      manufactured_at: input.manufactured_at ?? null,
      expires_at: input.expires_at ?? null,
      supplier_id: input.supplier_id ?? null,
      supplier_lot_ref: input.supplier_lot_ref ?? null,
      unit_price: input.unit_price ?? null,
      document_id: input.document_id ?? null,
      note: input.note ?? null,
      client_uuid: input.client_uuid ?? null,
      device_id: req.get('X-Device-Id') || null,
      created_by: person_id,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (
      err.message?.includes('už existuje') ||
      err.message?.includes('není označen') ||
      err.message?.includes('musí být')
    ) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/wh/lots/sweep-expired — admin hromadně marknout prošlé šarže
router.post('/lots/sweep-expired', async (req, res, next) => {
  try {
    const cutoff = req.body?.cutoff ? String(req.body.cutoff) : undefined;
    const result = await lotsService.sweepExpiredLots({ cutoff });
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /api/wh/lots/:id/status  body: { status, note? }
const lotStatusSchema = z.object({
  status: z.enum(['in_stock', 'consumed', 'expired', 'scrapped']),
  note: z.string().nullable().optional(),
});

router.patch('/lots/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const input = lotStatusSchema.parse(req.body);
    const lot = await lotsService.changeLotStatus(id, input.status, input.note ?? undefined);
    res.json(lot);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors });
    if (err.message?.includes('neexistuje')) return res.status(404).json({ error: err.message });
    if (err.message?.includes('Neplatný status')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
