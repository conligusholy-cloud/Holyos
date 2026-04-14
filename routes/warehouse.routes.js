// =============================================================================
// HolyOS — Warehouse routes (materiály, firmy, objednávky, sklady, inventury)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit, diffObjects, makeSnapshot } = require('../services/audit');

router.use(requireAuth);

// ─── FIRMY ─────────────────────────────────────────────────────────────────

// GET /api/wh/companies
router.get('/companies', async (req, res, next) => {
  try {
    const { search, type, active } = req.query;
    const where = {};
    if (type) where.type = type;
    if (active !== undefined) where.active = active === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { ico: { contains: search } },
      ];
    }

    const companies = await prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(companies);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/companies
router.post('/companies', async (req, res, next) => {
  try {
    const company = await prisma.company.create({ data: req.body });
    await logAudit({ action: 'create', entity: 'company', entity_id: company.id, description: `Vytvořena společnost: ${company.name}`, snapshot: makeSnapshot(company), user: req.user });
    res.status(201).json(company);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/companies/:id
router.put('/companies/:id', async (req, res, next) => {
  try {
    const before = await prisma.company.findUnique({ where: { id: parseInt(req.params.id) } });
    const company = await prisma.company.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    const changes = diffObjects(before, company);
    if (changes) await logAudit({ action: 'update', entity: 'company', entity_id: company.id, description: `Upravena společnost: ${company.name}`, changes, snapshot: makeSnapshot(before), user: req.user });
    res.json(company);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/companies/:id
router.delete('/companies/:id', async (req, res, next) => {
  try {
    const before = await prisma.company.findUnique({ where: { id: parseInt(req.params.id) } });
    await prisma.company.update({ where: { id: parseInt(req.params.id) }, data: { active: false } });
    await logAudit({ action: 'delete', entity: 'company', entity_id: parseInt(req.params.id), description: `Smazána společnost: ${before ? before.name : req.params.id}`, snapshot: makeSnapshot(before), user: req.user });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── MATERIÁLY ─────────────────────────────────────────────────────────────

// GET /api/wh/materials
router.get('/materials', async (req, res, next) => {
  try {
    const { search, type, low_stock } = req.query;
    const where = { status: 'active' };
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search } },
      ];
    }

    let materials = await prisma.material.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Filtr: jen materiály pod minimem
    if (low_stock === 'true') {
      materials = materials.filter(m =>
        m.min_stock && parseFloat(m.current_stock) <= parseFloat(m.min_stock)
      );
    }

    res.json(materials);
  } catch (err) {
    next(err);
  }
});

// GET /api/wh/materials/:id
router.get('/materials/:id', async (req, res, next) => {
  try {
    const material = await prisma.material.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        supplier: true,
        movements: { take: 20, orderBy: { created_at: 'desc' } },
        stock_rules: true,
      },
    });

    if (!material) return res.status(404).json({ error: 'Materiál nenalezen' });
    res.json(material);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/materials
router.post('/materials', async (req, res, next) => {
  try {
    const material = await prisma.material.create({ data: req.body });
    await logAudit({ action: 'create', entity: 'material', entity_id: material.id, description: `Vytvořen materiál: ${material.name}`, snapshot: makeSnapshot(material), user: req.user });
    res.status(201).json(material);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/materials/:id
router.put('/materials/:id', async (req, res, next) => {
  try {
    const before = await prisma.material.findUnique({ where: { id: parseInt(req.params.id) } });
    const material = await prisma.material.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    const changes = diffObjects(before, material);
    if (changes) await logAudit({ action: 'update', entity: 'material', entity_id: material.id, description: `Upraven materiál: ${material.name}`, changes, snapshot: makeSnapshot(before), user: req.user });
    res.json(material);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/materials/:id (soft delete)
router.delete('/materials/:id', async (req, res, next) => {
  try {
    const before = await prisma.material.findUnique({ where: { id: parseInt(req.params.id) } });
    await prisma.material.update({ where: { id: parseInt(req.params.id) }, data: { status: 'inactive' } });
    await logAudit({ action: 'delete', entity: 'material', entity_id: parseInt(req.params.id), description: `Smazán materiál: ${before ? before.name : req.params.id}`, snapshot: makeSnapshot(before), user: req.user });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/materials/bulk — hromadný import
router.post('/materials/bulk', async (req, res, next) => {
  try {
    const { materials } = req.body;
    if (!Array.isArray(materials)) {
      return res.status(400).json({ error: 'Očekáván pole materials' });
    }

    const result = await prisma.material.createMany({
      data: materials,
      skipDuplicates: true,
    });

    res.status(201).json({ created: result.count });
  } catch (err) {
    next(err);
  }
});

// ─── OBJEDNÁVKY ────────────────────────────────────────────────────────────

// GET /api/wh/orders
router.get('/orders', async (req, res, next) => {
  try {
    const { type, status, company_id } = req.query;
    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (company_id) where.company_id = parseInt(company_id);

    const orders = await prisma.order.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        items: true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/orders
router.post('/orders', async (req, res, next) => {
  try {
    const { items, items_count, total_amount, ...rest } = req.body;

    // Zajisti správné typy
    const orderData = {
      order_number: rest.order_number,
      type: rest.type || 'sales',
      company_id: parseInt(rest.company_id),
      status: rest.status || 'new',
      currency: rest.currency || 'CZK',
      note: rest.note || null,
      expected_delivery: rest.expected_delivery || null,
      items_count: parseInt(items_count) || 0,
      total_amount: parseFloat(total_amount) || 0,
    };

    if (!orderData.company_id || isNaN(orderData.company_id)) {
      return res.status(400).json({ error: 'Odběratel je povinný — vyberte firmu.' });
    }

    const order = await prisma.order.create({
      data: orderData,
      include: { items: true, company: true },
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

// GET /api/wh/orders/:id — detail jedné objednávky
router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        company: true,
        items: {
          include: {
            configs: {
              include: {
                option: {
                  include: {
                    group: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    res.json(order);
  } catch (err) { next(err); }
});

// POST /api/wh/orders/:id/share — Vygeneruj sdílecí token
router.post('/orders/:id/share', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });

    // Pokud už má token, vrať ho
    if (order.share_token) {
      return res.json({ share_token: order.share_token });
    }

    // Vygeneruj unikátní token
    const crypto = require('crypto');
    const token = crypto.randomBytes(24).toString('hex');

    try {
      const updated = await prisma.order.update({
        where: { id: parseInt(req.params.id) },
        data: { share_token: token },
      });
      res.json({ share_token: updated.share_token });
    } catch (dbErr) {
      // Sloupec share_token pravděpodobně ještě neexistuje — nasaďte migraci
      console.error('Share token DB error (spusťte migraci):', dbErr.message);
      res.status(503).json({ error: 'Sdílení není dostupné — nasaďte databázovou migraci (npx prisma migrate deploy)' });
    }
  } catch (err) { next(err); }
});

// PUT /api/wh/orders/:id
router.put('/orders/:id', async (req, res, next) => {
  try {
    const allowed = {};
    const fields = ['status', 'currency', 'note', 'expected_delivery', 'items_count', 'total_amount', 'company_id'];
    for (const f of fields) {
      if (req.body[f] !== undefined) allowed[f] = req.body[f];
    }
    if (allowed.company_id) allowed.company_id = parseInt(allowed.company_id);
    if (allowed.items_count !== undefined) allowed.items_count = parseInt(allowed.items_count) || 0;
    if (allowed.total_amount !== undefined) allowed.total_amount = parseFloat(allowed.total_amount) || 0;

    const order = await prisma.order.update({
      where: { id: parseInt(req.params.id) },
      data: allowed,
      include: { items: true },
    });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/orders/:id
router.delete('/orders/:id', async (req, res, next) => {
  try {
    await prisma.order.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POLOŽKY OBJEDNÁVEK ───────────────────────────────────────────────────

// GET /api/wh/orders/:id/items
router.get('/orders/:id/items', async (req, res, next) => {
  try {
    const items = await prisma.orderItem.findMany({
      where: { order_id: parseInt(req.params.id) },
      include: { material: { select: { id: true, name: true, code: true, unit: true } } },
      orderBy: { id: 'asc' },
    });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/orders/:id/items
router.post('/orders/:id/items', async (req, res, next) => {
  try {
    const { product_id, material_id, name, quantity, unit, unit_price, total_price, note } = req.body;
    const item = await prisma.orderItem.create({
      data: {
        order_id: parseInt(req.params.id),
        product_id: product_id ? parseInt(product_id) : null,
        material_id: material_id ? parseInt(material_id) : null,
        name: name || '—',
        quantity: parseFloat(quantity) || 1,
        unit: unit || 'ks',
        unit_price: parseFloat(unit_price) || 0,
        total_price: parseFloat(total_price) || (parseFloat(quantity) || 1) * (parseFloat(unit_price) || 0),
        note: note || null,
      },
    });
    // Aktualizovat celkovou cenu objednávky
    const agg = await prisma.orderItem.aggregate({
      where: { order_id: parseInt(req.params.id) },
      _sum: { total_price: true },
      _count: true,
    });
    await prisma.order.update({
      where: { id: parseInt(req.params.id) },
      data: {
        total_amount: agg._sum.total_price || 0,
        items_count: agg._count,
      },
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/orders/:orderId/items/:itemId
router.put('/orders/:orderId/items/:itemId', async (req, res, next) => {
  try {
    const item = await prisma.orderItem.update({
      where: { id: parseInt(req.params.itemId) },
      data: req.body,
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/orders/:orderId/items/:itemId
router.delete('/orders/:orderId/items/:itemId', async (req, res, next) => {
  try {
    await prisma.orderItem.delete({ where: { id: parseInt(req.params.itemId) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/order-items/:id — kompatibilní alias (frontend volá tuto cestu)
router.delete('/order-items/:id', async (req, res, next) => {
  try {
    await prisma.orderItem.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── SKLADY ───────────────────────────────────────────────────────────────

// GET /api/wh/warehouses
router.get('/warehouses', async (req, res, next) => {
  try {
    const warehouses = await prisma.warehouse.findMany({
      where: { active: true },
      include: {
        manager: { select: { id: true, first_name: true, last_name: true } },
        _count: { select: { locations: true, movements: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(warehouses);
  } catch (err) {
    next(err);
  }
});

// GET /api/wh/warehouses/:id — detail skladu s pozicemi a pracovišti
router.get('/warehouses/:id', async (req, res, next) => {
  try {
    const wh = await prisma.warehouse.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        manager: { select: { id: true, first_name: true, last_name: true } },
        locations: { orderBy: [{ section: 'asc' }, { rack: 'asc' }, { position: 'asc' }] },
        workstations_input: { select: { id: true, name: true, code: true } },
        workstations_output: { select: { id: true, name: true, code: true } },
        _count: { select: { locations: true, movements: true } },
      },
    });
    if (!wh) return res.status(404).json({ error: 'Sklad nenalezen' });
    res.json(wh);
  } catch (err) { next(err); }
});

// POST /api/wh/warehouses
router.post('/warehouses', async (req, res, next) => {
  try {
    const wh = await prisma.warehouse.create({ data: req.body });
    await logAudit({ action: 'create', entity: 'warehouse', entity_id: wh.id, description: `Vytvořen sklad: ${wh.name}`, snapshot: makeSnapshot(wh), user: req.user });
    res.status(201).json(wh);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/warehouses/:id
router.put('/warehouses/:id', async (req, res, next) => {
  try {
    const before = await prisma.warehouse.findUnique({ where: { id: parseInt(req.params.id) } });
    const wh = await prisma.warehouse.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    const changes = diffObjects(before, wh);
    if (changes) await logAudit({ action: 'update', entity: 'warehouse', entity_id: wh.id, description: `Upraven sklad: ${wh.name}`, changes, snapshot: makeSnapshot(before), user: req.user });
    res.json(wh);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/warehouses/:id — smaže sklad jen pokud nemá naskladněné zboží
router.delete('/warehouses/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const before = await prisma.warehouse.findUnique({ where: { id } });

    // Zkontroluj, jestli sklad má pohyby (= naskladněné zboží)
    const movementCount = await prisma.inventoryMovement.count({ where: { warehouse_id: id } });
    if (movementCount > 0) {
      return res.status(409).json({ error: 'Sklad nelze smazat — obsahuje naskladněné zboží (' + movementCount + ' pohybů)' });
    }

    // Smaž pozice a pak sklad
    await prisma.warehouseLocation.deleteMany({ where: { warehouse_id: id } });
    await prisma.warehouse.delete({ where: { id } });
    await logAudit({ action: 'delete', entity: 'warehouse', entity_id: id, description: `Smazán sklad: ${before ? before.name : id}`, snapshot: makeSnapshot(before), user: req.user });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/warehouses/bulk — hromadné smazání skladů
router.delete('/warehouses-bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'Žádné sklady k smazání' });

    const blocked = [];
    const deleted = [];

    for (const id of ids) {
      const movementCount = await prisma.inventoryMovement.count({ where: { warehouse_id: id } });
      if (movementCount > 0) {
        const wh = await prisma.warehouse.findUnique({ where: { id }, select: { name: true } });
        blocked.push({ id, name: wh?.name || id, movements: movementCount });
      } else {
        await prisma.warehouseLocation.deleteMany({ where: { warehouse_id: id } });
        await prisma.warehouse.delete({ where: { id } });
        deleted.push(id);
      }
    }

    res.json({ deleted: deleted.length, blocked });
  } catch (err) {
    next(err);
  }
});

// ─── POZICE VE SKLADU ─────────────────────────────────────────────────────

// GET /api/wh/warehouses/:id/locations
router.get('/warehouses/:id/locations', async (req, res, next) => {
  try {
    const locations = await prisma.warehouseLocation.findMany({
      where: { warehouse_id: parseInt(req.params.id) },
      orderBy: [{ section: 'asc' }, { rack: 'asc' }, { position: 'asc' }],
    });
    res.json(locations);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/warehouses/:id/locations/bulk — hromadné vytvoření pozic
router.post('/warehouses/:id/locations/bulk', async (req, res, next) => {
  try {
    const warehouseId = parseInt(req.params.id);
    const { section, racks, shelves } = req.body;
    if (!section || !racks || !shelves) return res.status(400).json({ error: 'Chybí parametry (section, racks, shelves)' });

    const data = [];
    for (let r = 1; r <= racks; r++) {
      for (let s = 1; s <= shelves; s++) {
        const rackStr = String(r).padStart(2, '0');
        const shelfStr = String(s).padStart(2, '0');
        data.push({
          warehouse_id: warehouseId,
          section: section.toUpperCase(),
          rack: 'R' + rackStr,
          position: 'P' + shelfStr,
          label: section.toUpperCase() + '-R' + rackStr + '-P' + shelfStr,
        });
      }
    }

    // Přeskoč duplicitní labely (unique constraint na label)
    const result = await prisma.warehouseLocation.createMany({ data, skipDuplicates: true });
    const skipped = data.length - result.count;
    res.status(201).json({ created: result.count, total: data.length, skipped });
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/warehouses/:id/locations
router.post('/warehouses/:id/locations', async (req, res, next) => {
  try {
    // Kontrola duplicitního labelu napříč všemi sklady
    if (req.body.label) {
      const existing = await prisma.warehouseLocation.findUnique({ where: { label: req.body.label } });
      if (existing) return res.status(409).json({ error: 'Pozice s označením "' + req.body.label + '" již existuje' });
    }
    const loc = await prisma.warehouseLocation.create({
      data: { warehouse_id: parseInt(req.params.id), ...req.body },
    });
    res.status(201).json(loc);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/locations/:id
router.put('/locations/:id', async (req, res, next) => {
  try {
    const loc = await prisma.warehouseLocation.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(loc);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/locations/:id — smaže pozici jen pokud nemá naskladněné zboží
router.delete('/locations/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const movementCount = await prisma.inventoryMovement.count({ where: { location_id: id } });
    if (movementCount > 0) {
      return res.status(409).json({ error: 'Pozici nelze smazat — obsahuje naskladněné zboží (' + movementCount + ' pohybů)' });
    }
    await prisma.warehouseLocation.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── INVENTURY ────────────────────────────────────────────────────────────

// GET /api/wh/inventories
router.get('/inventories', async (req, res, next) => {
  try {
    const { warehouse_id, status } = req.query;
    const where = {};
    if (warehouse_id) where.warehouse_id = parseInt(warehouse_id);
    if (status) where.status = status;

    const inventories = await prisma.inventory.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true } },
        creator: { select: { id: true, first_name: true, last_name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(inventories);
  } catch (err) {
    next(err);
  }
});

// GET /api/wh/inventories/:id
router.get('/inventories/:id', async (req, res, next) => {
  try {
    const inv = await prisma.inventory.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        warehouse: true,
        creator: { select: { id: true, first_name: true, last_name: true } },
        items: {
          include: {
            material: { select: { id: true, name: true, code: true, unit: true } },
            location: { select: { id: true, label: true, section: true, rack: true, position: true } },
            counter: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
    });
    if (!inv) return res.status(404).json({ error: 'Inventura nenalezena' });
    res.json(inv);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/inventories — založit novou inventuru
router.post('/inventories', async (req, res, next) => {
  try {
    const inv = await prisma.inventory.create({
      data: {
        ...req.body,
        created_by: req.user.person?.id || null,
      },
    });
    res.status(201).json(inv);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/inventories/:id
router.put('/inventories/:id', async (req, res, next) => {
  try {
    const inv = await prisma.inventory.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(inv);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/inventories/:id/start — zahájit inventuru (vygenerovat položky)
router.post('/inventories/:id/start', async (req, res, next) => {
  try {
    const inv = await prisma.inventory.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!inv) return res.status(404).json({ error: 'Inventura nenalezena' });

    // Vygenerovat položky ze všech aktivních materiálů
    const materials = await prisma.material.findMany({
      where: { status: 'active' },
      select: { id: true, current_stock: true, unit_price: true },
    });

    const items = materials.map(m => ({
      inventory_id: inv.id,
      material_id: m.id,
      expected_qty: m.current_stock,
      unit_price: m.unit_price,
    }));

    await prisma.inventoryItem.createMany({ data: items });

    const updated = await prisma.inventory.update({
      where: { id: inv.id },
      data: { status: 'in_progress', started_at: new Date() },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/inventories/:id/complete — uzavřít inventuru
router.post('/inventories/:id/complete', async (req, res, next) => {
  try {
    // Spočítat rozdíly u všech položek
    const items = await prisma.inventoryItem.findMany({
      where: { inventory_id: parseInt(req.params.id) },
    });

    for (const item of items) {
      if (item.actual_qty !== null) {
        const diff = parseFloat(item.actual_qty) - parseFloat(item.expected_qty);
        const valueDiff = item.unit_price ? diff * parseFloat(item.unit_price) : null;
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { difference: diff, value_difference: valueDiff },
        });
      }
    }

    const updated = await prisma.inventory.update({
      where: { id: parseInt(req.params.id) },
      data: { status: 'completed', completed_at: new Date() },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/inventories/:invId/items/:itemId — zadat skutečný stav
router.put('/inventories/:invId/items/:itemId', async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.update({
      where: { id: parseInt(req.params.itemId) },
      data: {
        ...req.body,
        counted_by: req.user.person?.id || null,
        counted_at: new Date(),
      },
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ─── ARES (vyhledání firmy podle IČO) ─────────────────────────────────────

// GET /api/wh/ares/:ico
router.get('/ares/:ico', async (req, res, next) => {
  try {
    const ico = req.params.ico;
    const response = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`);

    if (!response.ok) {
      return res.status(404).json({ error: 'IČO nenalezeno v ARES' });
    }

    const data = await response.json();
    res.json({
      ico: data.ico,
      name: data.obchodniJmeno,
      dic: data.dic || null,
      address: data.sidlo ? `${data.sidlo.nazevUlice || ''} ${data.sidlo.cisloDomovni || ''}`.trim() : null,
      city: data.sidlo?.nazevObce || null,
      zip: data.sidlo?.psc ? String(data.sidlo.psc) : null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── SKLADOVÉ POHYBY ──────────────────────────────────────────────────────

// POST /api/wh/movements — příjem/výdej/transfer
router.post('/movements', async (req, res, next) => {
  try {
    const movement = await prisma.inventoryMovement.create({
      data: {
        ...req.body,
        created_by: req.user.person?.id || null,
      },
    });

    // Aktualizuj current_stock na materiálu
    const delta = ['receipt', 'adjustment'].includes(movement.type)
      ? parseFloat(movement.quantity)
      : -parseFloat(movement.quantity);

    await prisma.material.update({
      where: { id: movement.material_id },
      data: { current_stock: { increment: delta } },
    });

    const typeLabels = { receipt: 'Příjem', issue: 'Výdej', transfer: 'Transfer', adjustment: 'Korekce' };
    await logAudit({ action: 'create', entity: 'movement', entity_id: movement.id, description: `${typeLabels[movement.type] || movement.type}: ${movement.quantity} ks (materiál #${movement.material_id}, sklad #${movement.warehouse_id})`, snapshot: makeSnapshot(movement), user: req.user });

    res.status(201).json(movement);
  } catch (err) {
    next(err);
  }
});

// GET /api/wh/movements
router.get('/movements', async (req, res, next) => {
  try {
    const { material_id, warehouse_id, type } = req.query;
    const where = {};
    if (material_id) where.material_id = parseInt(material_id);
    if (warehouse_id) where.warehouse_id = parseInt(warehouse_id);
    if (type) where.type = type;

    const movements = await prisma.inventoryMovement.findMany({
      where,
      include: {
        material: { select: { id: true, name: true, code: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
        creator: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    res.json(movements);
  } catch (err) {
    next(err);
  }
});

// ─── SKLAD STATISTIKY ─────────────────────────────────────────────────────

// GET /api/wh/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [totalMaterials, lowStock, totalCompanies, openOrders, totalValue, warehouseCount] = await Promise.all([
      prisma.material.count({ where: { status: 'active' } }),
      prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM materials
        WHERE status = 'active' AND min_stock IS NOT NULL AND current_stock <= min_stock
      `,
      prisma.company.count({ where: { active: true } }),
      prisma.order.count({ where: { status: { in: ['new', 'in_progress'] } } }),
      prisma.$queryRaw`
        SELECT COALESCE(SUM(current_stock * COALESCE(unit_price, 0)), 0)::float as value
        FROM materials WHERE status = 'active'
      `,
      prisma.warehouse.count({ where: { active: true } }),
    ]);

    res.json({
      companyCount: totalCompanies,
      activeOrders: openOrders,
      totalMaterials: totalMaterials,
      warehouseCount: warehouseCount,
      lowStock: Number(lowStock[0]?.count || 0),
      totalValue: Number(totalValue[0]?.value || 0),
      total_materials: totalMaterials,
      low_stock_count: Number(lowStock[0]?.count || 0),
      total_companies: totalCompanies,
      open_orders: openOrders,
    });
  } catch (err) {
    next(err);
  }
});

// ─── SKLADOVÉ ZÁSOBY ──────────────────────────────────────────────────────

// GET /api/wh/stock — zásoby zboží podle skladu a pozice
router.get('/stock', async (req, res, next) => {
  try {
    const { warehouse_id, search } = req.query;

    // Načti pohyby s relacemi
    const where = {};
    if (warehouse_id) where.warehouse_id = parseInt(warehouse_id);
    if (search) {
      where.material = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const movements = await prisma.inventoryMovement.findMany({
      where,
      include: {
        material: { select: { id: true, name: true, code: true, unit: true, unit_price: true } },
        warehouse: { select: { id: true, name: true } },
        location: { select: { id: true, label: true, section: true, rack: true, position: true } },
      },
    });

    // Agreguj zásoby podle materiál + sklad + pozice
    const stockMap = {};
    for (const mv of movements) {
      const key = mv.material_id + '-' + mv.warehouse_id + '-' + (mv.location_id || 0);
      if (!stockMap[key]) {
        stockMap[key] = {
          material_id: mv.material.id,
          material_name: mv.material.name,
          material_code: mv.material.code,
          unit: mv.material.unit,
          unit_price: mv.material.unit_price ? parseFloat(mv.material.unit_price) : 0,
          warehouse_id: mv.warehouse.id,
          warehouse_name: mv.warehouse.name,
          location_id: mv.location?.id || null,
          location_label: mv.location?.label || null,
          section: mv.location?.section || null,
          rack: mv.location?.rack || null,
          position: mv.location?.position || null,
          qty: 0,
        };
      }
      const delta = ['receipt', 'adjustment'].includes(mv.type)
        ? parseFloat(mv.quantity)
        : -parseFloat(mv.quantity);
      stockMap[key].qty += delta;
    }

    // Vrať jen položky s kladnou zásobou
    const stock = Object.values(stockMap).filter(s => s.qty > 0);
    stock.sort((a, b) => (a.warehouse_name + (a.location_label || '')).localeCompare(b.warehouse_name + (b.location_label || '')));

    res.json(stock);
  } catch (err) {
    next(err);
  }
});

// ─── VÝHLED NÁKUPU (Purchase Forecast) ──────────────────────────────────────
// Kombinuje: aktuální zásoby, otevřené objednávky (nákup/prodej),
// BOM materiálové potřeby produktů a lead-time dodavatelů.
// Vrací seznam materiálů s: aktuální zásobou, plánovanou spotřebou,
// očekávaným příjmem, doporučeným datem objednání a stavem.

router.get('/forecast', async (req, res, next) => {
  try {
    const { horizon_days } = req.query;
    const horizon = parseInt(horizon_days) || 60; // výchozí horizont 60 dní
    const today = new Date();
    const horizonEnd = new Date(today);
    horizonEnd.setDate(horizonEnd.getDate() + horizon);

    // 1) Načti všechny aktivní materiály s dodavatelem
    const materials = await prisma.material.findMany({
      where: { status: 'active' },
      include: {
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    // 2) Načti otevřené prodejní objednávky (= poptávka / spotřeba)
    const salesOrders = await prisma.order.findMany({
      where: {
        type: 'sales',
        status: { notIn: ['cancelled', 'done', 'delivered'] },
      },
      include: {
        items: {
          where: { status: { not: 'delivered' } },
          include: { material: { select: { id: true } } },
        },
        company: { select: { name: true } },
      },
    });

    // 3) Načti otevřené nákupní objednávky (= příjem / supply)
    const purchaseOrders = await prisma.order.findMany({
      where: {
        type: 'purchase',
        status: { notIn: ['cancelled', 'done', 'delivered'] },
      },
      include: {
        items: {
          where: { status: { not: 'delivered' } },
          include: { material: { select: { id: true } } },
        },
        company: { select: { name: true } },
      },
    });

    // 4) Načti BOM — materiálové potřeby na produkt
    const bomItems = await prisma.operationMaterial.findMany({
      include: {
        material: { select: { id: true } },
        operation: {
          select: {
            product: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    // Sestav mapu spotřeby a příjmu podle material_id
    const demandMap = {}; // material_id → [{ qty, date, source }]
    const supplyMap = {}; // material_id → [{ qty, date, source }]

    // Poptávka z prodejních objednávek
    for (const order of salesOrders) {
      const deliveryDate = order.expected_delivery || null;
      for (const item of order.items) {
        if (!item.material_id) continue;
        const remaining = parseFloat(item.quantity) - parseFloat(item.delivered_quantity || 0);
        if (remaining <= 0) continue;
        if (!demandMap[item.material_id]) demandMap[item.material_id] = [];
        demandMap[item.material_id].push({
          qty: remaining,
          date: deliveryDate,
          source: 'Prodej: ' + (order.company?.name || order.order_number),
          order_number: order.order_number,
        });
      }
    }

    // Příjem z nákupních objednávek
    for (const order of purchaseOrders) {
      const deliveryDate = order.expected_delivery || null;
      for (const item of order.items) {
        if (!item.material_id) continue;
        const remaining = parseFloat(item.quantity) - parseFloat(item.delivered_quantity || 0);
        if (remaining <= 0) continue;
        if (!supplyMap[item.material_id]) supplyMap[item.material_id] = [];
        supplyMap[item.material_id].push({
          qty: remaining,
          date: item.expected_delivery || deliveryDate,
          source: 'Nákup: ' + (order.company?.name || order.order_number),
          order_number: order.order_number,
        });
      }
    }

    // BOM potřeby — připravíme přehled kolik materiálu spotřebuje každý produkt
    const bomMap = {}; // material_id → [{ product_name, qty_per_unit }]
    for (const bom of bomItems) {
      if (!bom.material_id) continue;
      const productName = bom.operation?.product?.name || 'Neznámý produkt';
      const productCode = bom.operation?.product?.code || '';
      if (!bomMap[bom.material_id]) bomMap[bom.material_id] = [];
      bomMap[bom.material_id].push({
        product: productName,
        product_code: productCode,
        qty_per_unit: parseFloat(bom.quantity),
      });
    }

    // 5) Sestav výhled pro každý materiál
    const forecast = materials.map(mat => {
      const currentStock = parseFloat(mat.current_stock || 0);
      const minStock = parseFloat(mat.min_stock || 0);
      const leadTime = parseInt(mat.lead_time_days || 0);
      const reorderQty = parseFloat(mat.reorder_quantity || 0);

      const demands = demandMap[mat.id] || [];
      const supplies = supplyMap[mat.id] || [];
      const bom = bomMap[mat.id] || [];

      const totalDemand = demands.reduce((sum, d) => sum + d.qty, 0);
      const totalSupply = supplies.reduce((sum, s) => sum + s.qty, 0);
      const projectedStock = currentStock + totalSupply - totalDemand;

      // Nejbližší datum poptávky
      const demandDates = demands.filter(d => d.date).map(d => new Date(d.date));
      const earliestDemand = demandDates.length > 0
        ? new Date(Math.min(...demandDates.map(d => d.getTime())))
        : null;

      // Datum kdy objednat = nejbližší poptávka - lead time
      let orderByDate = null;
      if (earliestDemand && leadTime > 0) {
        orderByDate = new Date(earliestDemand);
        orderByDate.setDate(orderByDate.getDate() - leadTime);
      }

      // Stav / priorita
      let status = 'ok';
      let statusLabel = 'V pořádku';
      if (currentStock <= 0 && totalDemand > 0) {
        status = 'critical';
        statusLabel = 'Kritické — není skladem';
      } else if (projectedStock < 0) {
        status = 'critical';
        statusLabel = 'Kritické — nedostatek po splnění objednávek';
      } else if (currentStock <= minStock && minStock > 0) {
        status = 'warning';
        statusLabel = 'Pod minimem';
      } else if (projectedStock <= minStock && minStock > 0) {
        status = 'warning';
        statusLabel = 'Bude pod minimem';
      } else if (orderByDate && orderByDate <= today) {
        status = 'warning';
        statusLabel = 'Čas objednat';
      }

      return {
        material_id: mat.id,
        code: mat.code,
        name: mat.name,
        unit: mat.unit,
        supplier: mat.supplier?.name || null,
        supplier_id: mat.supplier?.id || null,
        current_stock: currentStock,
        min_stock: minStock,
        lead_time_days: leadTime,
        reorder_quantity: reorderQty,
        total_demand: totalDemand,
        total_supply: totalSupply,
        projected_stock: projectedStock,
        earliest_demand_date: earliestDemand,
        order_by_date: orderByDate,
        status,
        status_label: statusLabel,
        demands,
        supplies,
        bom_usage: bom,
      };
    });

    // Setřídíme: critical → warning → ok
    const statusOrder = { critical: 0, warning: 1, ok: 2 };
    forecast.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

    // Souhrnná statistika
    const stats = {
      total_materials: forecast.length,
      critical: forecast.filter(f => f.status === 'critical').length,
      warning: forecast.filter(f => f.status === 'warning').length,
      ok: forecast.filter(f => f.status === 'ok').length,
      needs_ordering: forecast.filter(f => f.order_by_date && f.order_by_date <= today).length,
    };

    res.json({ forecast, stats, horizon_days: horizon });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
