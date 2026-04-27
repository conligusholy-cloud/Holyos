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
    const { search, type, configurator } = req.query;
    const where = {};
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filtr konfigurátoru — s fallbackem pokud sloupec ještě neexistuje
    if (configurator === 'true') {
      try {
        where.show_in_configurator = true;
        const products = await prisma.product.findMany({
          where,
          include: { operations: { orderBy: { step_number: 'asc' }, select: { id: true, step_number: true, name: true } } },
          orderBy: { name: 'asc' },
        });
        return res.json(products);
      } catch (filterErr) {
        // Sloupec show_in_configurator pravděpodobně ještě neexistuje — vrať všechny
        delete where.show_in_configurator;
      }
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

// PATCH /api/production/products/:id/configurator — přepni viditelnost v konfigurátoru
router.patch('/products/:id/configurator', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ error: 'Produkt nenalezen' });

    const updated = await prisma.product.update({
      where: { id },
      data: { show_in_configurator: !product.show_in_configurator },
    });
    res.json({ id: updated.id, show_in_configurator: updated.show_in_configurator });
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

// =============================================================================
// PRODUKTOVÝ KONFIGURÁTOR — správa konfiguračních skupin a voleb
// =============================================================================

// GET /api/production/products/:id/config — načti všechny konfigurační skupiny a volby produktu
router.get('/products/:id/config', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    const groups = await prisma.productConfigGroup.findMany({
      where: { product_id: productId },
      include: {
        options: {
          include: {
            bom_materials: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
            operation_effects: { include: { operation: { select: { id: true, step_number: true, name: true } } } },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
      orderBy: { sort_order: 'asc' },
    });
    res.json(groups);
  } catch (err) { next(err); }
});

// POST /api/production/products/:id/config-groups — vytvoř konfigurační skupinu
router.post('/products/:id/config-groups', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    const { name, code, type, required, sort_order } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Název a kód jsou povinné' });
    const group = await prisma.productConfigGroup.create({
      data: { product_id: productId, name, code, type: type || 'single_select', required: !!required, sort_order: sort_order || 0 },
    });
    res.status(201).json(group);
  } catch (err) { next(err); }
});

// PUT /api/production/config-groups/:id — uprav skupinu
router.put('/config-groups/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { name, code, type, required, sort_order } = req.body;
    const group = await prisma.productConfigGroup.update({
      where: { id },
      data: { ...(name && { name }), ...(code && { code }), ...(type && { type }), ...(required !== undefined && { required }), ...(sort_order !== undefined && { sort_order }) },
    });
    res.json(group);
  } catch (err) { next(err); }
});

// DELETE /api/production/config-groups/:id — smaž skupinu (cascade smaže volby)
router.delete('/config-groups/:id', async (req, res, next) => {
  try {
    await prisma.productConfigGroup.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/production/config-groups/:groupId/options — přidej volbu do skupiny
router.post('/config-groups/:groupId/options', async (req, res, next) => {
  try {
    const groupId = parseInt(req.params.groupId);
    const { name, code, price_modifier, is_default, sort_order } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Název a kód jsou povinné' });
    const option = await prisma.productConfigOption.create({
      data: {
        group_id: groupId, name, code,
        price_modifier: price_modifier || 0,
        is_default: !!is_default,
        sort_order: sort_order || 0,
      },
    });
    res.status(201).json(option);
  } catch (err) { next(err); }
});

// PUT /api/production/config-options/:id — uprav volbu
router.put('/config-options/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const data = {};
    ['name', 'code', 'price_modifier', 'is_default', 'sort_order'].forEach(k => {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    });
    const option = await prisma.productConfigOption.update({ where: { id }, data });
    res.json(option);
  } catch (err) { next(err); }
});

// DELETE /api/production/config-options/:id — smaž volbu
router.delete('/config-options/:id', async (req, res, next) => {
  try {
    await prisma.productConfigOption.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/production/config-options/:optionId/materials — přidej materiálový vliv
router.post('/config-options/:optionId/materials', async (req, res, next) => {
  try {
    const optionId   = parseInt(req.params.optionId, 10);
    const materialId = parseInt(req.body && req.body.material_id, 10);
    const quantity   = parseFloat(req.body && req.body.quantity);
    const unit       = (req.body && req.body.unit) ? String(req.body.unit).trim() : 'ks';

    // Validace — bez toho letěly NaN hodnoty rovnou do Prisma a request padal
    // s neuchopitelnou interní chybou (UI to schovalo a uživatel viděl jen,
    // že se v sestavě nic neuloží).
    if (Number.isNaN(optionId))   return res.status(400).json({ error: 'Neplatné ID volby konfigurace.' });
    if (Number.isNaN(materialId)) return res.status(400).json({ error: 'Vyberte platný materiál ze seznamu.' });
    if (Number.isNaN(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Množství musí být kladné číslo.' });
    }

    // Existuje volba i materiál? Přátelská 404 místo Prisma P2003.
    const [option, material] = await Promise.all([
      prisma.productConfigOption.findUnique({ where: { id: optionId }, select: { id: true } }),
      prisma.material.findUnique({ where: { id: materialId }, select: { id: true } }),
    ]);
    if (!option)   return res.status(404).json({ error: 'Volba konfigurace nenalezena.' });
    if (!material) return res.status(404).json({ error: 'Materiál nenalezen v katalogu.' });

    const item = await prisma.configOptionMaterial.create({
      data: { option_id: optionId, material_id: materialId, quantity, unit },
      include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// DELETE /api/production/config-option-materials/:id
router.delete('/config-option-materials/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Neplatné ID položky BOM.' });
    await prisma.configOptionMaterial.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    // Prisma P2025 = záznam k smazání neexistuje. Vracíme přátelskou 404.
    if (err && err.code === 'P2025') {
      return res.status(404).json({ error: 'Položka BOM už byla smazána nebo neexistuje.' });
    }
    next(err);
  }
});

// POST /api/production/config-options/:optionId/operations — přidej vliv na operaci
router.post('/config-options/:optionId/operations', async (req, res, next) => {
  try {
    const optionId = parseInt(req.params.optionId);
    const { operation_id, action, modified_duration, note } = req.body;
    if (!operation_id || !action) return res.status(400).json({ error: 'operation_id a action jsou povinné' });
    const item = await prisma.configOptionOperation.create({
      data: {
        option_id: optionId, operation_id: parseInt(operation_id),
        action, modified_duration: modified_duration ? parseInt(modified_duration) : null,
        note: note || null,
      },
      include: { operation: { select: { id: true, step_number: true, name: true } } },
    });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// DELETE /api/production/config-option-operations/:id
router.delete('/config-option-operations/:id', async (req, res, next) => {
  try {
    await prisma.configOptionOperation.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// ORDER ITEM CONFIGS — uložení vybrané konfigurace na položce objednávky
// =============================================================================

// GET /api/production/order-items/:itemId/config — vybraná konfigurace položky
router.get('/order-items/:itemId/config', async (req, res, next) => {
  try {
    const configs = await prisma.orderItemConfig.findMany({
      where: { order_item_id: parseInt(req.params.itemId) },
      include: { option: { include: { group: true } } },
    });
    res.json(configs);
  } catch (err) { next(err); }
});

// POST /api/production/order-items/:itemId/config — ulož vybranou konfiguraci (bulk)
router.post('/order-items/:itemId/config', async (req, res, next) => {
  try {
    const orderItemId = parseInt(req.params.itemId);
    const { configs } = req.body; // [{ option_id, custom_value }, ...]
    if (!Array.isArray(configs)) return res.status(400).json({ error: 'configs musí být pole' });

    // Smaž staré a vytvoř nové (replace)
    await prisma.orderItemConfig.deleteMany({ where: { order_item_id: orderItemId } });
    const created = await prisma.$transaction(
      configs.map(c => prisma.orderItemConfig.create({
        data: { order_item_id: orderItemId, option_id: c.option_id || null, custom_value: c.custom_value || null },
      }))
    );
    res.json(created);
  } catch (err) { next(err); }
});

// =============================================================================
// RESOLVED OPERATIONS — pracovní postup podle konfigurace
// =============================================================================

// GET /api/production/products/:id/resolved-operations?configs=1,5,12
// Vrátí operace produktu upravené podle vybraných konfiguračních voleb
router.get('/products/:id/resolved-operations', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    const configOptionIds = (req.query.configs || '').split(',').filter(Boolean).map(Number);

    // Načti základní operace produktu
    const operations = await prisma.productOperation.findMany({
      where: { product_id: productId },
      include: { materials: { include: { material: true } }, workstation: true },
      orderBy: { step_number: 'asc' },
    });

    if (configOptionIds.length === 0) {
      return res.json(operations);
    }

    // Načti konfigurační vlivy na operace
    const opEffects = await prisma.configOptionOperation.findMany({
      where: { option_id: { in: configOptionIds } },
    });

    // Načti extra materiály z konfigurace
    const configMaterials = await prisma.configOptionMaterial.findMany({
      where: { option_id: { in: configOptionIds } },
      include: { material: true },
    });

    // Aplikuj vlivy na operace
    const skipOpIds = new Set();
    const modifyOps = {};
    const addOps = [];

    for (const eff of opEffects) {
      if (eff.action === 'skip') {
        skipOpIds.add(eff.operation_id);
      } else if (eff.action === 'modify' && eff.modified_duration) {
        modifyOps[eff.operation_id] = eff;
      } else if (eff.action === 'add') {
        addOps.push(eff);
      }
    }

    // Filtruj, uprav, přidej
    let resolved = operations.filter(op => !skipOpIds.has(op.id));
    resolved = resolved.map(op => {
      if (modifyOps[op.id]) {
        return { ...op, duration: modifyOps[op.id].modified_duration, _config_note: modifyOps[op.id].note };
      }
      return op;
    });

    // Přidej konfig materiály k příslušným operacím
    for (const cm of configMaterials) {
      // Najdi první operaci, ke které můžeme přidat materiál, nebo přidej info
      const existingOp = resolved.find(op => op.id === cm.option?.operation_id);
      // Materiály z konfigurace přidáme jako extra_materials
    }

    res.json({
      operations: resolved,
      config_materials: configMaterials,
      skipped_operations: Array.from(skipOpIds),
    });
  } catch (err) { next(err); }
});

// =============================================================================
// PLÁNOVAČ — KOMPETENCE
// =============================================================================

// GET /api/production/competencies — seznam kompetencí
//   ?category=svarovna     — filtr na kategorii
//   ?active=true|false     — jen aktivní / všechny
//   ?include=workers       — zahrnout pole worker_competencies
router.get('/competencies', async (req, res, next) => {
  try {
    const { category, active, include } = req.query;
    const where = {};
    if (category) where.category = category;
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;

    const competencies = await prisma.competency.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: include === 'workers' ? {
        worker_competencies: {
          include: { person: { select: { id: true, first_name: true, last_name: true } } },
        },
      } : undefined,
    });
    res.json(competencies);
  } catch (err) { next(err); }
});

// GET /api/production/competencies/:id — detail kompetence
router.get('/competencies/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const competency = await prisma.competency.findUnique({
      where: { id },
      include: {
        worker_competencies: {
          include: { person: { select: { id: true, first_name: true, last_name: true, employee_number: true } } },
          orderBy: [{ level: 'desc' }, { person: { last_name: 'asc' } }],
        },
        required_for_operations: {
          include: {
            operation: {
              select: { id: true, name: true, step_number: true, product: { select: { id: true, code: true, name: true } } },
            },
          },
        },
      },
    });
    if (!competency) return res.status(404).json({ error: 'Kompetence nenalezena' });
    res.json(competency);
  } catch (err) { next(err); }
});

// POST /api/production/competencies — vytvoření kompetence
router.post('/competencies', async (req, res, next) => {
  try {
    const { code, name, category, description, level_max, active } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: 'code a name jsou povinné' });

    const competency = await prisma.competency.create({
      data: {
        code: String(code).trim(),
        name: String(name).trim(),
        category: category || null,
        description: description || null,
        level_max: level_max != null ? parseInt(level_max, 10) : 3,
        active: active === false ? false : true,
      },
    });
    res.status(201).json(competency);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Kompetence s tímto kódem už existuje' });
    next(err);
  }
});

// PUT /api/production/competencies/:id — úprava kompetence
router.put('/competencies/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const { code, name, category, description, level_max, active } = req.body || {};
    const data = {};
    if (code !== undefined) data.code = String(code).trim();
    if (name !== undefined) data.name = String(name).trim();
    if (category !== undefined) data.category = category || null;
    if (description !== undefined) data.description = description || null;
    if (level_max !== undefined) data.level_max = parseInt(level_max, 10);
    if (active !== undefined) data.active = !!active;

    const competency = await prisma.competency.update({ where: { id }, data });
    res.json(competency);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Kompetence nenalezena' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Kompetence s tímto kódem už existuje' });
    next(err);
  }
});

// DELETE /api/production/competencies/:id — smazání kompetence (cascade na worker_competencies a required)
router.delete('/competencies/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    await prisma.competency.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Kompetence nenalezena' });
    next(err);
  }
});

// GET /api/production/persons/:personId/competencies — kompetence pracovníka
router.get('/persons/:personId/competencies', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.personId, 10);
    if (isNaN(personId)) return res.status(400).json({ error: 'Neplatné personId' });

    const items = await prisma.workerCompetency.findMany({
      where: { person_id: personId },
      include: { competency: true },
      orderBy: [{ competency: { category: 'asc' } }, { competency: { name: 'asc' } }],
    });
    res.json(items);
  } catch (err) { next(err); }
});

// POST /api/production/persons/:personId/competencies — přidat / upsertovat kompetenci pracovníka
//   body: { competency_id, level, certified_at?, valid_until?, note? }
//   Pokud už dvojice existuje, provede update (UNIQUE person+competency).
router.post('/persons/:personId/competencies', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.personId, 10);
    if (isNaN(personId)) return res.status(400).json({ error: 'Neplatné personId' });

    const { competency_id, level, certified_at, valid_until, note } = req.body || {};
    const competencyId = parseInt(competency_id, 10);
    if (isNaN(competencyId)) return res.status(400).json({ error: 'competency_id je povinné' });

    const lvl = level != null ? parseInt(level, 10) : 1;
    const data = {
      level: lvl,
      certified_at: certified_at ? new Date(certified_at) : null,
      valid_until: valid_until ? new Date(valid_until) : null,
      note: note || null,
    };

    const wc = await prisma.workerCompetency.upsert({
      where: { person_id_competency_id: { person_id: personId, competency_id: competencyId } },
      create: { person_id: personId, competency_id: competencyId, ...data },
      update: data,
      include: { competency: true },
    });
    res.status(201).json(wc);
  } catch (err) {
    if (err.code === 'P2003') return res.status(400).json({ error: 'Person nebo Competency neexistuje' });
    next(err);
  }
});

// DELETE /api/production/worker-competencies/:id — odebrání kompetence pracovníkovi
router.delete('/worker-competencies/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    await prisma.workerCompetency.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Záznam nenalezen' });
    next(err);
  }
});

// GET /api/production/operations/:opId/required-competencies — co operace vyžaduje
router.get('/operations/:opId/required-competencies', async (req, res, next) => {
  try {
    const opId = parseInt(req.params.opId, 10);
    if (isNaN(opId)) return res.status(400).json({ error: 'Neplatné opId' });

    const items = await prisma.operationRequiredCompetency.findMany({
      where: { operation_id: opId },
      include: { competency: true },
      orderBy: [{ competency: { name: 'asc' } }],
    });
    res.json(items);
  } catch (err) { next(err); }
});

// POST /api/production/operations/:opId/required-competencies — přidat / upsertovat požadavek
//   body: { competency_id, min_level }
router.post('/operations/:opId/required-competencies', async (req, res, next) => {
  try {
    const opId = parseInt(req.params.opId, 10);
    if (isNaN(opId)) return res.status(400).json({ error: 'Neplatné opId' });

    const { competency_id, min_level } = req.body || {};
    const competencyId = parseInt(competency_id, 10);
    if (isNaN(competencyId)) return res.status(400).json({ error: 'competency_id je povinné' });
    const lvl = min_level != null ? parseInt(min_level, 10) : 1;

    const item = await prisma.operationRequiredCompetency.upsert({
      where: { operation_id_competency_id: { operation_id: opId, competency_id: competencyId } },
      create: { operation_id: opId, competency_id: competencyId, min_level: lvl },
      update: { min_level: lvl },
      include: { competency: true },
    });
    res.status(201).json(item);
  } catch (err) {
    if (err.code === 'P2003') return res.status(400).json({ error: 'Operace nebo Competency neexistuje' });
    next(err);
  }
});

// DELETE /api/production/operation-required-competencies/:id — odebrat požadavek operace
router.delete('/operation-required-competencies/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    await prisma.operationRequiredCompetency.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Záznam nenalezen' });
    next(err);
  }
});

// =============================================================================
// PLÁNOVAČ — VÝROBNÍ DÁVKY (ProductionBatch)
// =============================================================================

// GET /api/production/batches — seznam dávek
//   ?status=planned|released|in_progress|paused|done|cancelled
//   ?batch_type=main|feeder|subassembly
//   ?product_id=N
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD — filtr na planned_start
router.get('/batches', async (req, res, next) => {
  try {
    const { status, batch_type, product_id, from, to } = req.query;
    const where = {};
    if (status) where.status = status;
    if (batch_type) where.batch_type = batch_type;
    if (product_id) where.product_id = parseInt(product_id, 10);
    if (from || to) {
      where.planned_start = {};
      if (from) where.planned_start.gte = new Date(from);
      if (to) where.planned_start.lte = new Date(to);
    }

    const batches = await prisma.productionBatch.findMany({
      where,
      include: {
        product: { select: { id: true, code: true, name: true } },
        parent_batch: { select: { id: true, batch_number: true } },
        created_by: { select: { id: true, first_name: true, last_name: true } },
        _count: { select: { batch_operations: true, feeder_batches: true } },
      },
      orderBy: [{ planned_start: 'asc' }, { priority: 'asc' }],
    });
    res.json(batches);
  } catch (err) { next(err); }
});

// GET /api/production/batches/:id — detail dávky včetně operací a feeder dávek
router.get('/batches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const batch = await prisma.productionBatch.findUnique({
      where: { id },
      include: {
        product: true,
        parent_batch: { select: { id: true, batch_number: true, status: true } },
        feeder_batches: { select: { id: true, batch_number: true, status: true, batch_type: true, quantity: true } },
        bom_snapshot: true,
        created_by: { select: { id: true, first_name: true, last_name: true } },
        batch_operations: {
          include: {
            operation: { select: { id: true, name: true, step_number: true, duration: true } },
            workstation: { select: { id: true, name: true } },
            assigned_person: { select: { id: true, first_name: true, last_name: true } },
          },
          orderBy: { sequence: 'asc' },
        },
        slot_assignments: {
          include: { slot: { select: { id: true, start_date: true, end_date: true } } },
        },
      },
    });
    if (!batch) return res.status(404).json({ error: 'Dávka nenalezena' });
    res.json(batch);
  } catch (err) { next(err); }
});

// Generátor batch_number: {rok}-{seq3}, např. "2026-001", "2026-042".
// Sekvence běží od 1 v rámci kalendářního roku planned_start (nebo dnes).
async function generateBatchNumber(plannedStart) {
  const ref = plannedStart ? new Date(plannedStart) : new Date();
  const year = ref.getFullYear();
  const prefix = `${year}-`;
  const last = await prisma.productionBatch.findFirst({
    where: { batch_number: { startsWith: prefix } },
    orderBy: { batch_number: 'desc' },
    select: { batch_number: true },
  });
  let seq = 1;
  if (last) {
    const m = last.batch_number.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return prefix + String(seq).padStart(3, '0');
}

// POST /api/production/batches — vytvoření dávky
//   body: { product_id (povinné), quantity (povinné), variant_key?, batch_type?,
//           priority?, planned_start?, planned_end?, parent_batch_id?,
//           bom_snapshot_id?, created_by_id?, note?,
//           auto_generate_operations? (default true) }
//
//   Když auto_generate_operations !== false, hned po vytvoření dávky se zavolá
//   plánovač: pro každou ProductOperation produktu vznikne BatchOperation
//   se status='ready' (rovnou dostupné v kiosku).
router.post('/batches', async (req, res, next) => {
  try {
    const {
      product_id, quantity, variant_key, batch_type, priority,
      planned_start, planned_end, parent_batch_id, bom_snapshot_id,
      created_by_id, note, auto_generate_operations,
    } = req.body || {};

    const productId = parseInt(product_id, 10);
    const qty = parseInt(quantity, 10);
    if (isNaN(productId) || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'product_id a quantity (>0) jsou povinné' });
    }

    const batch_number = await generateBatchNumber(planned_start);

    const batch = await prisma.productionBatch.create({
      data: {
        batch_number,
        product_id: productId,
        quantity: qty,
        variant_key: variant_key || null,
        batch_type: batch_type || 'main',
        priority: priority != null ? parseInt(priority, 10) : 100,
        planned_start: planned_start ? new Date(planned_start) : null,
        planned_end: planned_end ? new Date(planned_end) : null,
        parent_batch_id: parent_batch_id ? parseInt(parent_batch_id, 10) : null,
        bom_snapshot_id: bom_snapshot_id ? parseInt(bom_snapshot_id, 10) : null,
        created_by_id: created_by_id ? parseInt(created_by_id, 10) : null,
        note: note || null,
      },
      include: { product: { select: { id: true, code: true, name: true } } },
    });

    // Plánovač F3.1 — automaticky vygeneruj BatchOperation
    let opsResult = null;
    if (auto_generate_operations !== false) {
      try {
        const { generateBatchOperationsForBatch } = require('../services/planning/batch-operations');
        opsResult = await generateBatchOperationsForBatch(batch.id);
      } catch (e) {
        // Generátor nemá blokovat create dávky — jen zalogovat upozornění.
        console.error('[batches/create] auto-generate operations failed:', e.message);
        opsResult = { error: e.message };
      }
    }

    res.status(201).json({ ...batch, operations_generated: opsResult });
  } catch (err) {
    if (err.code === 'P2003') return res.status(400).json({ error: 'Product, parent_batch nebo bom_snapshot neexistuje' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Konflikt batch_number — zkus znovu' });
    next(err);
  }
});

// PUT /api/production/batches/:id — úprava dávky
router.put('/batches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const allowed = ['quantity', 'variant_key', 'batch_type', 'status', 'priority',
      'planned_start', 'planned_end', 'actual_start', 'actual_end',
      'parent_batch_id', 'bom_snapshot_id', 'note'];
    const data = {};
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      const v = req.body[k];
      if (k === 'quantity' || k === 'priority' || k === 'parent_batch_id' || k === 'bom_snapshot_id') {
        data[k] = v == null ? null : parseInt(v, 10);
      } else if (k.endsWith('_start') || k.endsWith('_end')) {
        data[k] = v ? new Date(v) : null;
      } else {
        data[k] = v;
      }
    }

    const batch = await prisma.productionBatch.update({
      where: { id }, data,
      include: { product: { select: { id: true, code: true, name: true } } },
    });
    res.json(batch);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dávka nenalezena' });
    next(err);
  }
});

// POST /api/production/batches/:id/release — přechod planned → released.
// Při release se dávka přiřadí k pracovním pozicím (BatchOperation se zatím
// vytváří externě plánovačem; tento endpoint jen přepíná stav).
router.post('/batches/:id/release', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const batch = await prisma.productionBatch.findUnique({ where: { id }, select: { status: true } });
    if (!batch) return res.status(404).json({ error: 'Dávka nenalezena' });
    if (batch.status !== 'planned') {
      return res.status(409).json({ error: `Dávku lze release-ovat jen ze stavu 'planned' (aktuálně '${batch.status}')` });
    }

    const updated = await prisma.productionBatch.update({
      where: { id },
      data: { status: 'released' },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/production/batches/:id — smazání dávky (cascade na batch_operations + logs)
router.delete('/batches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    await prisma.productionBatch.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dávka nenalezena' });
    next(err);
  }
});

// =============================================================================
// PLÁNOVAČ — VÝROBNÍ KIOSEK (F6) — endpointy pro obrazovku pracoviště
// =============================================================================

// GET /api/production/workstations/:id/available-work?person_id=N
//   Klíčový endpoint kiosku. Vrátí dvě skupiny úkolů pro daného pracovníka:
//     - my_in_progress: rozpracované úkoly, které pracovník už začal (status='in_progress')
//     - available: úkoly připravené k odebrání (status pending/ready, bez assigned_person)
//   Filtrace přes kompetence: pracovník vidí úkol jen pokud má všechny
//   required_competencies operace na úrovni >= min_level.
router.get('/workstations/:id/available-work', async (req, res, next) => {
  try {
    const wsId = parseInt(req.params.id, 10);
    if (isNaN(wsId)) return res.status(400).json({ error: 'Neplatné ID pracoviště' });

    const personId = parseInt(req.query.person_id, 10);
    if (isNaN(personId)) return res.status(400).json({ error: 'person_id je povinné' });

    // 1. Získat kompetence pracovníka jako mapu { competency_id: level }
    const myCompetencies = await prisma.workerCompetency.findMany({
      where: { person_id: personId },
      select: { competency_id: true, level: true, valid_until: true },
    });
    const today = new Date();
    const compMap = new Map();
    for (const wc of myCompetencies) {
      if (wc.valid_until && wc.valid_until < today) continue; // expired
      compMap.set(wc.competency_id, wc.level);
    }

    // 2. Načíst rozpracované úkoly tohoto pracovníka na tomto pracovišti
    const myInProgress = await prisma.batchOperation.findMany({
      where: {
        workstation_id: wsId,
        assigned_person_id: personId,
        status: 'in_progress',
      },
      include: {
        batch: { select: { id: true, batch_number: true, quantity: true, priority: true,
          product: { select: { id: true, code: true, name: true } } } },
        operation: { select: { id: true, name: true, step_number: true, duration: true, description: true } },
      },
      orderBy: [{ started_at: 'asc' }],
    });

    // 3. Načíst dostupné úkoly (bez přiřazení) — kandidáty pro filtrování
    const candidates = await prisma.batchOperation.findMany({
      where: {
        workstation_id: wsId,
        assigned_person_id: null,
        status: { in: ['pending', 'ready'] },
      },
      include: {
        batch: { select: { id: true, batch_number: true, quantity: true, priority: true, status: true,
          product: { select: { id: true, code: true, name: true } } } },
        operation: {
          select: {
            id: true, name: true, step_number: true, duration: true, description: true,
            required_competencies: {
              include: { competency: { select: { id: true, code: true, name: true } } },
            },
          },
        },
      },
      orderBy: [{ batch: { priority: 'asc' } }, { sequence: 'asc' }, { planned_start: 'asc' }],
    });

    // 4. Filtr přes kompetence — vyhodit úkoly, kde pracovník nemá všechny required.
    //    blocked_by_competency = pole jmen kompetencí, které pracovníkovi chybí (k debug zobrazení).
    const available = [];
    for (const op of candidates) {
      const required = op.operation.required_competencies;
      let allowed = true;
      const missing = [];
      for (const req of required) {
        const myLvl = compMap.get(req.competency_id);
        if (!myLvl || myLvl < req.min_level) {
          allowed = false;
          missing.push({
            code: req.competency.code,
            name: req.competency.name,
            min_level: req.min_level,
            my_level: myLvl || 0,
          });
        }
      }
      if (allowed) {
        // Pro UI nepotřebujeme vracet required_competencies — usnadníme payload.
        const { required_competencies, ...opSlim } = op.operation;
        available.push({ ...op, operation: opSlim });
      }
      // Else: úkol pro tohoto pracovníka skrytý (tvrdá kompetenční politika).
    }

    res.json({
      workstation_id: wsId,
      person_id: personId,
      my_in_progress: myInProgress,
      available,
    });
  } catch (err) { next(err); }
});

// =============================================================================
// PLÁNOVAČ — INSTANCE OPERACÍ (BatchOperation)
// =============================================================================

// GET /api/production/batch-operations — seznam instancí operací
//   Klíčový endpoint pro výrobní obrazovku pracoviště.
//   ?workstation_id=N — pro kiosek konkrétního pracoviště
//   ?status=pending|ready|in_progress|done|blocked
//   ?assigned_person_id=N — můj seznam
//   ?batch_id=N — operace dané dávky
router.get('/batch-operations', async (req, res, next) => {
  try {
    const { workstation_id, status, assigned_person_id, batch_id } = req.query;
    const where = {};
    if (workstation_id) where.workstation_id = parseInt(workstation_id, 10);
    if (status) where.status = status;
    if (assigned_person_id) where.assigned_person_id = parseInt(assigned_person_id, 10);
    if (batch_id) where.batch_id = parseInt(batch_id, 10);

    const ops = await prisma.batchOperation.findMany({
      where,
      include: {
        batch: {
          select: {
            id: true, batch_number: true, status: true, priority: true, quantity: true,
            product: { select: { id: true, code: true, name: true } },
          },
        },
        operation: {
          select: {
            id: true, name: true, step_number: true, duration: true,
            required_competencies: { include: { competency: true } },
          },
        },
        workstation: { select: { id: true, name: true } },
        assigned_person: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: [{ planned_start: 'asc' }, { sequence: 'asc' }],
    });
    res.json(ops);
  } catch (err) { next(err); }
});

// POST /api/production/batch-operations/:id/start — pracovník zahajuje úkol
//   body: { person_id }
//   Nastaví assigned_person_id, started_at = now, status = 'in_progress'
//   a zaloguje akci 'start' do BatchOperationLog.
router.post('/batch-operations/:id/start', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const personId = parseInt(req.body?.person_id, 10);
    if (isNaN(personId)) return res.status(400).json({ error: 'person_id je povinné' });

    const existing = await prisma.batchOperation.findUnique({ where: { id }, select: { status: true } });
    if (!existing) return res.status(404).json({ error: 'Operace nenalezena' });
    if (existing.status !== 'ready' && existing.status !== 'pending') {
      return res.status(409).json({ error: `Nelze startovat ze stavu '${existing.status}'` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const op = await tx.batchOperation.update({
        where: { id },
        data: {
          status: 'in_progress',
          assigned_person_id: personId,
          started_at: new Date(),
        },
      });
      await tx.batchOperationLog.create({
        data: { batch_operation_id: id, person_id: personId, action: 'start' },
      });
      return op;
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'P2003') return res.status(400).json({ error: 'Person neexistuje' });
    next(err);
  }
});

// POST /api/production/batch-operations/:id/done — pracovník dokončil úkol
//   body: { person_id?, note? }
//   Nastaví finished_at = now, dopočítá duration_minutes, status = 'done',
//   zaloguje 'done'.
router.post('/batch-operations/:id/done', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const personId = req.body?.person_id ? parseInt(req.body.person_id, 10) : null;
    const note = req.body?.note || null;

    const existing = await prisma.batchOperation.findUnique({
      where: { id },
      select: { status: true, started_at: true, assigned_person_id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Operace nenalezena' });
    if (existing.status !== 'in_progress') {
      return res.status(409).json({ error: `Nelze dokončit ze stavu '${existing.status}'` });
    }

    const finished = new Date();
    const duration = existing.started_at
      ? Math.max(1, Math.round((finished - existing.started_at) / 60000))
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const op = await tx.batchOperation.update({
        where: { id },
        data: {
          status: 'done',
          finished_at: finished,
          duration_minutes: duration,
        },
      });
      await tx.batchOperationLog.create({
        data: {
          batch_operation_id: id,
          person_id: personId || existing.assigned_person_id,
          action: 'done',
          note,
        },
      });
      return op;
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
