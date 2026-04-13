// =============================================================================
// HolyOS — Warehouse routes (materiály, firmy, objednávky, sklady, inventury)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

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
    res.status(201).json(company);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/companies/:id
router.put('/companies/:id', async (req, res, next) => {
  try {
    const company = await prisma.company.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(company);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/companies/:id
router.delete('/companies/:id', async (req, res, next) => {
  try {
    await prisma.company.update({
      where: { id: parseInt(req.params.id) },
      data: { active: false },
    });
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
    res.status(201).json(material);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/materials/:id
router.put('/materials/:id', async (req, res, next) => {
  try {
    const material = await prisma.material.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(material);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/materials/:id (soft delete)
router.delete('/materials/:id', async (req, res, next) => {
  try {
    await prisma.material.update({
      where: { id: parseInt(req.params.id) },
      data: { status: 'inactive' },
    });
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
    const { items, ...orderData } = req.body;

    const order = await prisma.order.create({
      data: {
        ...orderData,
        items: items ? { create: items } : undefined,
      },
      include: { items: true, company: true },
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/orders/:id
router.put('/orders/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
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
    const item = await prisma.orderItem.create({
      data: { order_id: parseInt(req.params.id), ...req.body },
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

// POST /api/wh/warehouses
router.post('/warehouses', async (req, res, next) => {
  try {
    const wh = await prisma.warehouse.create({ data: req.body });
    res.status(201).json(wh);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/warehouses/:id
router.put('/warehouses/:id', async (req, res, next) => {
  try {
    const wh = await prisma.warehouse.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(wh);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/warehouses/:id (soft)
router.delete('/warehouses/:id', async (req, res, next) => {
  try {
    await prisma.warehouse.update({
      where: { id: parseInt(req.params.id) },
      data: { active: false },
    });
    res.json({ ok: true });
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

// POST /api/wh/warehouses/:id/locations
router.post('/warehouses/:id/locations', async (req, res, next) => {
  try {
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

// DELETE /api/wh/locations/:id
router.delete('/locations/:id', async (req, res, next) => {
  try {
    await prisma.warehouseLocation.delete({ where: { id: parseInt(req.params.id) } });
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
    const [totalMaterials, lowStock, totalCompanies, openOrders, totalValue] = await Promise.all([
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
    ]);

    res.json({
      // camelCase pro frontend
      companyCount: totalCompanies,
      activeOrders: openOrders,
      totalMaterials: totalMaterials,
      warehouseCount: 1, // Zatím 1 sklad — rozšířit po přidání modelu Warehouse
      lowStock: Number(lowStock[0]?.count || 0),
      totalValue: Number(totalValue[0]?.value || 0),
      // snake_case pro zpětnou kompatibilitu
      total_materials: totalMaterials,
      low_stock_count: Number(lowStock[0]?.count || 0),
      total_companies: totalCompanies,
      open_orders: openOrders,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
