// =============================================================================
// HolyOS — Production routes (náhrada za Factorify proxy)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');

// =============================================================================
// HELPER: Rekurzivní načítání sub-produktů (polotovar → polotovar → ... do hloubky)
// =============================================================================

// Standardní include pro načtení produktu s operacemi a materiály (1 úroveň)
const PRODUCT_DEEP_INCLUDE = {
  operations: {
    include: {
      workstation: true,
      materials: {
        include: {
          material: true,
        },
      },
    },
    orderBy: { step_number: 'asc' },
  },
};

// Načti plný produkt s operacemi a materiály podle ID
async function loadProductDeep(productId, prisma) {
  return prisma.product.findUnique({
    where: { id: productId },
    include: PRODUCT_DEEP_INCLUDE,
  });
}

// Najdi Product odpovídající danému materiálu (přes material_id FK, kód, nebo název)
async function findLinkedProduct(material, prisma, productCache) {
  if (!material) return null;
  const code = (material.code || '').toLowerCase();
  const name = (material.name || '').toLowerCase();

  // Zkontroluj cache
  if (code && productCache.byCode[code]) return productCache.byCode[code];
  if (name && productCache.byName[name]) return productCache.byName[name];
  if (productCache.byMatId[material.id]) return productCache.byMatId[material.id];

  return null;
}

// Předpočítej cache všech produktů pro rychlé vyhledávání
async function buildProductCache(prisma) {
  const allProducts = await prisma.product.findMany({
    select: { id: true, material_id: true, code: true, name: true },
  });
  const cache = { byMatId: {}, byCode: {}, byName: {} };
  allProducts.forEach(p => {
    if (p.material_id) cache.byMatId[p.material_id] = p.id;
    if (p.code) cache.byCode[p.code.toLowerCase()] = p.id;
    if (p.name) cache.byName[p.name.toLowerCase()] = p.id;
  });
  return cache;
}

// Rekurzivně enrich operace s linked_product (do hloubky maxDepth)
// productDataCache = cache načtených produktů { [id]: productObj } — zamezuje opakovaným DB dotazům
// Zarážka je POUZE hloubka — žádné blokování přes visited/ancestors
async function enrichOperationsRecursive(operations, prisma, productCache, depth, maxDepth, productDataCache) {
  if (!operations || depth >= maxDepth) return;

  for (const op of operations) {
    if (!op.materials) continue;
    for (const m of op.materials) {
      if (!m.material) continue;

      // Zjisti, jestli je to polotovar/výrobek
      const t = (m.material.type || '').toLowerCase();
      const isComposite = t.includes('semi') || t.includes('polotovar') || t.includes('product') || t.includes('výrobek') || t.includes('vyrobek');
      if (!isComposite) {
        m.linked_product = null;
        continue;
      }

      // Najdi odpovídající Product ID
      let productId = null;
      if (m.product_id) productId = m.product_id;
      if (!productId) productId = await findLinkedProduct(m.material, prisma, productCache);

      if (!productId) {
        m.linked_product = null;
        continue;
      }

      // Načti produkt z cache nebo z DB
      if (!productDataCache[productId]) {
        const loaded = await loadProductDeep(productId, prisma);
        if (loaded) productDataCache[productId] = loaded;
      }

      if (!productDataCache[productId]) {
        m.linked_product = null;
        continue;
      }

      // Deep clone pro tuto úroveň (každá úroveň potřebuje vlastní kopii)
      m.linked_product = JSON.parse(JSON.stringify(productDataCache[productId]));

      // Rekurzivně enrich materiály sub-produktu (zastaví se na maxDepth)
      await enrichOperationsRecursive(m.linked_product.operations, prisma, productCache, depth + 1, maxDepth, productDataCache);
    }
  }
}

// =============================================================================
// PRODUKTY (výrobky)
// =============================================================================

// GET /api/production/products
router.get('/products', async (req, res, next) => {
  try {
    const { search, type } = req.query;
    const where = {};
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    const products = await prisma.product.findMany({
      where,
      include: { operations: { orderBy: { step_number: 'asc' }, select: { id: true, step_number: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (err) { next(err); }
});

// GET /api/production/products/:id
router.get('/products/:id', async (req, res, next) => {
  try {
    // Načti produkt s operacemi a materiály (1 úroveň)
    const product = await loadProductDeep(parseInt(req.params.id), prisma);
    if (!product) return res.status(404).json({ error: 'Produkt nenalezen' });

    // Rekurzivně enrich materiály s linked_product (do hloubky max 30 úrovní)
    const productCache = await buildProductCache(prisma);
    const productDataCache = {};
    await enrichOperationsRecursive(product.operations, prisma, productCache, 0, 30, productDataCache);

    res.json(product);
  } catch (err) { next(err); }
});

// POST /api/production/products
// Kontrola duplicit podle kódu — kód musí být unikátní
router.post('/products', async (req, res, next) => {
  try {
    const { code, name, type, material_id, takt_time } = req.body;

    // Kontrola duplicity kódu
    if (code) {
      const existing = await prisma.product.findFirst({
        where: { code: { equals: code, mode: 'insensitive' } },
      });
      if (existing) {
        return res.status(400).json({
          error: 'Duplicitní kód',
          message: 'Výrobek/polotovar s kódem "' + code + '" již existuje (ID: ' + existing.id + ', název: ' + existing.name + ')',
        });
      }
    }

    const product = await prisma.product.create({
      data: { code, name, type: type || 'product', material_id, takt_time: takt_time || null },
    });
    res.status(201).json(product);
  } catch (err) { next(err); }
});

// PUT /api/production/products/:id
router.put('/products/:id', async (req, res, next) => {
  try {
    const { code, name, type, material_id, takt_time } = req.body;
    const data = {};
    if (code !== undefined) data.code = code;
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (material_id !== undefined) data.material_id = material_id;
    if (takt_time !== undefined) data.takt_time = takt_time;
    const product = await prisma.product.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.json(product);
  } catch (err) { next(err); }
});

// DELETE /api/production/products/:id
router.delete('/products/:id', async (req, res, next) => {
  try {
    await prisma.product.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// HALY (halls) — seskupení pracovišť
// =============================================================================

// GET /api/production/halls — seznam hal
router.get('/halls', async (req, res, next) => {
  try {
    const halls = await prisma.hall.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { workstations: true } },
      },
    });
    res.json(halls);
  } catch (err) { next(err); }
});

// POST /api/production/halls — vytvořit halu
router.post('/halls', async (req, res, next) => {
  try {
    const { name, color, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Název haly je povinný' });
    const hall = await prisma.hall.create({
      data: {
        name: name.trim(),
        color: color || '#14b8a6',
        sort_order: sort_order || 0,
      },
    });
    res.status(201).json(hall);
  } catch (err) { next(err); }
});

// PUT /api/production/halls/:id — upravit halu
router.put('/halls/:id', async (req, res, next) => {
  try {
    const { name, color, sort_order } = req.body;
    const hall = await prisma.hall.update({
      where: { id: parseInt(req.params.id) },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
        ...(sort_order !== undefined && { sort_order }),
      },
    });
    res.json(hall);
  } catch (err) { next(err); }
});

// DELETE /api/production/halls/:id — smazat halu (pracoviště zůstanou bez haly)
router.delete('/halls/:id', async (req, res, next) => {
  try {
    await prisma.hall.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// PRACOVIŠTĚ (workstations)
// =============================================================================

// GET /api/production/workstations
router.get('/workstations', async (req, res, next) => {
  try {
    const { search } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    const workstations = await prisma.workstation.findMany({
      where,
      include: {
        workers: {
          include: { person: { select: { id: true, first_name: true, last_name: true, email: true, phone: true, photo_url: true, active: true, department: { select: { id: true, name: true } } } } },
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        },
        hall: { select: { id: true, name: true, color: true } },
        input_warehouse: { select: { id: true, name: true, code: true, locations: { select: { id: true, label: true, section: true, rack: true, position: true }, orderBy: [{ section: 'asc' }, { rack: 'asc' }, { position: 'asc' }] } } },
        input_location: { select: { id: true, label: true, section: true, rack: true, position: true } },
        output_warehouse: { select: { id: true, name: true, code: true, locations: { select: { id: true, label: true, section: true, rack: true, position: true }, orderBy: [{ section: 'asc' }, { rack: 'asc' }, { position: 'asc' }] } } },
        output_location: { select: { id: true, label: true, section: true, rack: true, position: true } },
        _count: { select: { operations: true } },
      },
      orderBy: [{ hall: { sort_order: 'asc' } }, { name: 'asc' }],
    });
    res.json(workstations);
  } catch (err) { next(err); }
});

// POST /api/production/workstations/import-factorify
// Jednorázový import pracovišť z Factorify → HolyOS DB (přeruší vazby)
router.post('/workstations/import-factorify', async (req, res, next) => {
  const https = require('https');
  const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
  const TOKEN = process.env.FACTORIFY_TOKEN || '';

  if (!TOKEN) return res.status(400).json({ error: 'FACTORIFY_TOKEN není nastaven v .env' });

  function queryFactorify(entityName) {
    return new Promise((resolve, reject) => {
      const url = new URL(`/api/query/${entityName}`, BASE_URL);
      const postData = JSON.stringify({});
      const options = {
        hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
        headers: {
          'Accept': 'application/json', 'Content-Type': 'application/json',
          'Cookie': `securityToken=${TOKEN}`,
          'X-AccountingUnit': '1', 'X-FySerialization': 'ui2',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      const r = https.request(options, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
            let rows = parsed;
            if (parsed.rows) rows = parsed.rows;
            else if (parsed.items) rows = parsed.items;
            else if (parsed.data) rows = parsed.data;
            else if (!Array.isArray(parsed)) {
              for (const key of Object.keys(parsed)) {
                if (Array.isArray(parsed[key])) { rows = parsed[key]; break; }
              }
            }
            if (!Array.isArray(rows)) rows = [rows];
            resolve(rows);
          } catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
        });
      });
      r.on('error', reject);
      r.setTimeout(30000, () => { r.destroy(); reject(new Error('Timeout')); });
      r.write(postData);
      r.end();
    });
  }

  try {
    const stages = await queryFactorify('Stage');
    let imported = 0, updated = 0, skipped = 0;

    for (const s of stages) {
      const factorifyId = s.id || s.ID || s.Id;
      if (!factorifyId) { skipped++; continue; }

      const name = s.label || s.name || s.Name || s.title || s.Title || `Stage-${factorifyId}`;
      const code = s.code || s.Code || s.referenceName || s.ReferenceName || '';
      const isArchived = s.archived === true || s.Archived === true;
      if (isArchived) { skipped++; continue; }

      const existing = await prisma.workstation.findFirst({ where: { factorify_id: parseInt(factorifyId) } });
      if (existing) {
        await prisma.workstation.update({
          where: { id: existing.id },
          data: { name, code },
        });
        updated++;
      } else {
        await prisma.workstation.create({
          data: { name, code, factorify_id: parseInt(factorifyId) },
        });
        imported++;
      }
    }

    res.json({
      ok: true,
      message: `Import dokončen: ${imported} nových, ${updated} aktualizovaných, ${skipped} přeskočených`,
      imported, updated, skipped, total: stages.length,
    });
  } catch (err) {
    console.error('Factorify import error:', err);
    res.status(500).json({ error: 'Import selhal: ' + err.message });
  }
});

// GET /api/production/workstations/:id
router.get('/workstations/:id', async (req, res, next) => {
  try {
    // Zkusíme načíst i workers (pokud tabulka existuje po migraci)
    let ws;
    try {
      ws = await prisma.workstation.findUnique({
        where: { id: parseInt(req.params.id) },
        include: {
          operations: { include: { product: true } },
          workers: { include: { person: { select: { id: true, first_name: true, last_name: true, email: true, phone: true, photo_url: true, active: true, department: { select: { id: true, name: true } } } } }, orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }] },
        },
      });
    } catch (e) {
      // Fallback bez workers (tabulka ještě neexistuje)
      ws = await prisma.workstation.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { operations: { include: { product: true } } },
      });
      if (ws) ws.workers = [];
    }
    if (!ws) return res.status(404).json({ error: 'Pracoviště nenalezeno' });
    res.json(ws);
  } catch (err) { next(err); }
});

// POST /api/production/workstations
router.post('/workstations', async (req, res, next) => {
  try {
    const { name, code, hall_id, is_external, width_m, length_m, input_warehouse_id, input_location_id, output_warehouse_id, output_location_id } = req.body;
    const ws = await prisma.workstation.create({
      data: {
        name, code,
        hall_id: hall_id ? parseInt(hall_id) : null,
        is_external: is_external === true,
        width_m: width_m ? parseFloat(width_m) : null,
        length_m: length_m ? parseFloat(length_m) : null,
        input_warehouse_id: input_warehouse_id ? parseInt(input_warehouse_id) : null,
        input_location_id: input_location_id ? parseInt(input_location_id) : null,
        output_warehouse_id: output_warehouse_id ? parseInt(output_warehouse_id) : null,
        output_location_id: output_location_id ? parseInt(output_location_id) : null,
      },
    });
    res.status(201).json(ws);
  } catch (err) { next(err); }
});

// PUT /api/production/workstations/:id
router.put('/workstations/:id', async (req, res, next) => {
  try {
    const { name, code, hall_id, is_external, width_m, length_m, input_warehouse_id, input_location_id, output_warehouse_id, output_location_id } = req.body;
    const data = { name, code };
    if (hall_id !== undefined) data.hall_id = hall_id ? parseInt(hall_id) : null;
    if (is_external !== undefined) data.is_external = is_external === true;
    if (width_m !== undefined) data.width_m = width_m ? parseFloat(width_m) : null;
    if (length_m !== undefined) data.length_m = length_m ? parseFloat(length_m) : null;
    if (input_warehouse_id !== undefined) data.input_warehouse_id = input_warehouse_id ? parseInt(input_warehouse_id) : null;
    if (input_location_id !== undefined) data.input_location_id = input_location_id ? parseInt(input_location_id) : null;
    if (output_warehouse_id !== undefined) data.output_warehouse_id = output_warehouse_id ? parseInt(output_warehouse_id) : null;
    if (output_location_id !== undefined) data.output_location_id = output_location_id ? parseInt(output_location_id) : null;
    const ws = await prisma.workstation.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.json(ws);
  } catch (err) { next(err); }
});

// === Pracovníci na pracovišti ===

// POST /api/production/workstations/:id/workers — přidej pracovníka
router.post('/workstations/:id/workers', async (req, res, next) => {
  try {
    const { person_id, role, is_primary } = req.body;
    if (!person_id) return res.status(400).json({ error: 'person_id je povinný' });
    const ww = await prisma.workstationWorker.create({
      data: {
        workstation_id: parseInt(req.params.id),
        person_id: parseInt(person_id),
        role: role || null,
        is_primary: is_primary || false,
      },
      include: { person: { select: { id: true, first_name: true, last_name: true, email: true, phone: true, photo_url: true, department: { select: { id: true, name: true } } } } },
    });
    res.status(201).json(ww);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Pracovník už je přiřazen k tomuto pracovišti' });
    next(err);
  }
});

// PUT /api/production/workstations/:id/workers/:workerId — uprav roli
router.put('/workstations/:id/workers/:workerId', async (req, res, next) => {
  try {
    const { role, is_primary } = req.body;
    const ww = await prisma.workstationWorker.update({
      where: { id: parseInt(req.params.workerId) },
      data: { role, is_primary },
      include: { person: { select: { id: true, first_name: true, last_name: true, email: true } } },
    });
    res.json(ww);
  } catch (err) { next(err); }
});

// DELETE /api/production/workstations/:id/workers/:workerId — odeber pracovníka
router.delete('/workstations/:id/workers/:workerId', async (req, res, next) => {
  try {
    await prisma.workstationWorker.delete({ where: { id: parseInt(req.params.workerId) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/production/workstations/:id
router.delete('/workstations/:id', async (req, res, next) => {
  try {
    await prisma.workstation.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// OPERACE (product operations)
// =============================================================================

// GET /api/production/operations
router.get('/operations', async (req, res, next) => {
  try {
    const { product_id } = req.query;
    const where = {};
    if (product_id) where.product_id = parseInt(product_id);
    const ops = await prisma.productOperation.findMany({
      where,
      include: { product: true, workstation: true, materials: { include: { material: true } } },
      orderBy: [{ product_id: 'asc' }, { step_number: 'asc' }],
    });
    res.json(ops);
  } catch (err) { next(err); }
});

// POST /api/production/operations
router.post('/operations', async (req, res, next) => {
  try {
    const { product_id, workstation_id, step_number, name, phase, duration, duration_unit, preparation_time, workers_count, description, bom_count, materials } = req.body;
    const op = await prisma.$transaction(async (tx) => {
      const created = await tx.productOperation.create({
        data: {
          product_id, workstation_id, step_number,
          name, phase, duration,
          duration_unit: duration_unit || 'MINUTE',
          preparation_time: preparation_time || 0,
          workers_count: workers_count || 1,
          description: description || null,
          bom_count,
        },
      });
      // Hromadně vlož materiály (pokud přišly) — s automatickým napojením na Product
      if (Array.isArray(materials) && materials.length > 0) {
        const matIds = materials.map(m => m.material_id).filter(Boolean);
        const linkedProds = matIds.length > 0
          ? await tx.product.findMany({ where: { material_id: { in: matIds } }, select: { id: true, material_id: true } })
          : [];
        const matIdToProductId = {};
        linkedProds.forEach(p => { if (p.material_id) matIdToProductId[p.material_id] = p.id; });

        await tx.operationMaterial.createMany({
          data: materials.map(m => ({
            operation_id: created.id,
            material_id: m.material_id,
            product_id: m.product_id || matIdToProductId[m.material_id] || null,
            quantity: m.quantity,
            unit: m.unit || 'ks',
          })),
        });
      }
      return tx.productOperation.findUnique({
        where: { id: created.id },
        include: { workstation: true, materials: { include: { material: true } } },
      });
    });
    res.status(201).json(op);
  } catch (err) { next(err); }
});

// PUT /api/production/operations/:id
router.put('/operations/:id', async (req, res, next) => {
  try {
    const { workstation_id, step_number, name, phase, duration, duration_unit, preparation_time, workers_count, description, bom_count, materials } = req.body;
    const opId = parseInt(req.params.id);
    const op = await prisma.$transaction(async (tx) => {
      await tx.productOperation.update({
        where: { id: opId },
        data: { workstation_id, step_number, name, phase, duration, duration_unit, preparation_time, workers_count, description, bom_count },
      });
      // Nahraď materiály — smaž staré + vlož nové v jedné transakci
      if (Array.isArray(materials)) {
        await tx.operationMaterial.deleteMany({ where: { operation_id: opId } });
        if (materials.length > 0) {
          const matIds = materials.map(m => m.material_id).filter(Boolean);
          const linkedProds = matIds.length > 0
            ? await tx.product.findMany({ where: { material_id: { in: matIds } }, select: { id: true, material_id: true } })
            : [];
          const matIdToProductId = {};
          linkedProds.forEach(p => { if (p.material_id) matIdToProductId[p.material_id] = p.id; });

          await tx.operationMaterial.createMany({
            data: materials.map(m => ({
              operation_id: opId,
              material_id: m.material_id,
              product_id: m.product_id || matIdToProductId[m.material_id] || null,
              quantity: m.quantity,
              unit: m.unit || 'ks',
            })),
          });
        }
      }
      return tx.productOperation.findUnique({
        where: { id: opId },
        include: { workstation: true, materials: { include: { material: true } } },
      });
    });
    res.json(op);
  } catch (err) { next(err); }
});

// DELETE /api/production/operations/:id
router.delete('/operations/:id', async (req, res, next) => {
  try {
    await prisma.productOperation.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// MATERIÁLY OPERACE (spotřeba materiálu per operace)
// =============================================================================

// GET /api/production/operations/:id/materials
router.get('/operations/:id/materials', async (req, res, next) => {
  try {
    const mats = await prisma.operationMaterial.findMany({
      where: { operation_id: parseInt(req.params.id) },
      include: { material: { select: { id: true, code: true, name: true, unit: true, current_stock: true } } },
    });
    res.json(mats);
  } catch (err) { next(err); }
});

// POST /api/production/operations/:id/materials
router.post('/operations/:id/materials', async (req, res, next) => {
  try {
    const { material_id, quantity, unit } = req.body;
    const mat = await prisma.operationMaterial.create({
      data: {
        operation_id: parseInt(req.params.id),
        material_id,
        quantity,
        unit: unit || 'ks',
      },
      include: { material: { select: { id: true, code: true, name: true, unit: true, current_stock: true } } },
    });
    res.status(201).json(mat);
  } catch (err) { next(err); }
});

// PUT /api/production/operation-materials/:id
router.put('/operation-materials/:id', async (req, res, next) => {
  try {
    const { material_id, quantity, unit } = req.body;
    const mat = await prisma.operationMaterial.update({
      where: { id: parseInt(req.params.id) },
      data: { material_id, quantity, unit },
      include: { material: { select: { id: true, code: true, name: true, unit: true, current_stock: true } } },
    });
    res.json(mat);
  } catch (err) { next(err); }
});

// DELETE /api/production/operation-materials/:id
router.delete('/operation-materials/:id', async (req, res, next) => {
  try {
    await prisma.operationMaterial.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// HROMADNÉ PŘEŘAZENÍ POŘADÍ OPERACÍ
// =============================================================================

// PUT /api/production/products/:id/reorder-operations
router.put('/products/:id/reorder-operations', async (req, res, next) => {
  try {
    const { order } = req.body; // [{id: 1, step_number: 1}, {id: 3, step_number: 2}, ...]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Chybí pole "order"' });

    // Aktualizuj pořadí v transakci
    await prisma.$transaction(
      order.map(item =>
        prisma.productOperation.update({
          where: { id: item.id },
          data: { step_number: item.step_number },
        })
      )
    );

    // Vrať aktualizovaný produkt
    const product = await prisma.product.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        operations: {
          include: { workstation: true, materials: { include: { material: true } } },
          orderBy: { step_number: 'asc' },
        },
      },
    });
    res.json(product);
  } catch (err) { next(err); }
});

// =============================================================================
// STATISTIKY
// =============================================================================

// GET /api/production/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [products, workstations, operations, materials] = await Promise.all([
      prisma.product.count(),
      prisma.workstation.count(),
      prisma.productOperation.count(),
      prisma.material.count(),
    ]);
    res.json({ products, workstations, operations, materials });
  } catch (err) { next(err); }
});

// =============================================================================
// MATERIÁLY (read-only přístup z výrobního modulu)
// =============================================================================

// GET /api/production/materials
// Vrací materiály + linked_product_id (pokud existuje Product s material_id == id)
router.get('/materials', async (req, res, next) => {
  try {
    const { search, type } = req.query;
    const where = {};
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    const materials = await prisma.material.findMany({
      where,
      select: { id: true, code: true, name: true, type: true, unit: true, current_stock: true },
      orderBy: { name: 'asc' },
    });

    // Připoj linked_product_id — hledej Product přes material_id, kód, nebo název
    const allProducts = await prisma.product.findMany({
      select: { id: true, material_id: true, code: true, name: true },
    });

    // Indexy pro rychlé hledání
    const byMaterialId = {};
    const byCode = {};
    const byName = {};
    allProducts.forEach(p => {
      if (p.material_id) byMaterialId[p.material_id] = p.id;
      if (p.code) byCode[p.code.toLowerCase()] = p.id;
      if (p.name) byName[p.name.toLowerCase()] = p.id;
    });

    const enriched = materials.map(m => {
      // Priorita: 1) material_id FK, 2) stejný kód, 3) stejný název
      const lpId = byMaterialId[m.id]
        || (m.code ? byCode[m.code.toLowerCase()] : null)
        || (m.name ? byName[m.name.toLowerCase()] : null)
        || null;
      return { ...m, linked_product_id: lpId };
    });

    res.json(enriched);
  } catch (err) { next(err); }
});

// =============================================================================
// SIMULACE
// =============================================================================

// GET /api/production/simulations
router.get('/simulations', async (req, res, next) => {
  try {
    const sims = await prisma.simulation.findMany({ orderBy: { updated_at: 'desc' } });
    res.json(sims);
  } catch (err) { next(err); }
});

// GET /api/production/simulations/:id
router.get('/simulations/:id', async (req, res, next) => {
  try {
    const sim = await prisma.simulation.findUnique({ where: { id: req.params.id } });
    if (!sim) return res.status(404).json({ error: 'Simulace nenalezena' });
    res.json(sim);
  } catch (err) { next(err); }
});

// POST /api/production/simulations
router.post('/simulations', async (req, res, next) => {
  try {
    const { name, objects, connections, viewport } = req.body;
    const sim = await prisma.simulation.create({
      data: { name: name || 'Nová simulace', objects: objects || [], connections, viewport },
    });
    res.status(201).json(sim);
  } catch (err) { next(err); }
});

// PUT /api/production/simulations/:id
router.put('/simulations/:id', async (req, res, next) => {
  try {
    const { name, objects, connections, viewport } = req.body;
    const sim = await prisma.simulation.update({
      where: { id: req.params.id },
      data: { name, objects, connections, viewport, version: { increment: 1 } },
    });
    res.json(sim);
  } catch (err) { next(err); }
});

// DELETE /api/production/simulations/:id
router.delete('/simulations/:id', async (req, res, next) => {
  try {
    await prisma.simulation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
