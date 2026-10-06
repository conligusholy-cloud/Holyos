// =============================================================================
// HolyOS — Production routes (náhrada za Factorify proxy)
// =============================================================================

const express = require('express');
const { z } = require('zod');
const router = express.Router();
const { prisma } = require('../config/database');
const { scheduleBatch } = require('../services/planning/scheduler');
const { computeOpMaterialStatus } = require('../services/planning/op-material-status');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// =============================================================================
// HELPER: Rekurzivní načítání sub-produktů (polotovar → polotovar → ... do hloubky)
// =============================================================================

// Standardní include pro načtení produktu s operacemi a materiály (1 úroveň)
const PRODUCT_DEEP_INCLUDE = {
  operations: {
    include: {
      workstation: true,
      workstation_group: { select: { id: true, name: true, color: true } },
      allowed_people: { select: { id: true, person_id: true, priority: true, person: { select: { id: true, first_name: true, last_name: true, photo_url: true } } }, orderBy: { priority: 'asc' } },
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

function stripCodeSuffix(code) {
  if (!code) return code;
  return code.replace(/-[A-Za-z0-9]{1,3}$/, '');
}

async function findLinkedProduct(material, prisma, productCache) {
  if (!material) return null;
  const code = (material.code || '').toLowerCase();
  const name = (material.name || '').toLowerCase();
  if (productCache.byMatId[material.id]) return productCache.byMatId[material.id];
  if (code && productCache.byCode[code]) return productCache.byCode[code];
  if (name && productCache.byName[name]) return productCache.byName[name];
  if (code && productCache.byStrippedProductCode[code]) {
    const candidate = productCache.byStrippedProductCode[code];
    if (candidate !== '__AMBIGUOUS__') return candidate;
  }
  if (code) {
    const stripped = stripCodeSuffix(code);
    if (stripped && stripped !== code && productCache.byCode[stripped]) {
      return productCache.byCode[stripped];
    }
  }
  return null;
}

async function buildProductCache(prisma) {
  const allProducts = await prisma.product.findMany({
    select: { id: true, material_id: true, code: true, name: true },
  });
  const cache = { byMatId: {}, byCode: {}, byName: {}, byStrippedProductCode: {} };
  allProducts.forEach(p => {
    if (p.material_id) cache.byMatId[p.material_id] = p.id;
    if (p.code) {
      const lower = p.code.toLowerCase();
      cache.byCode[lower] = p.id;
      const stripped = stripCodeSuffix(lower);
      if (stripped && stripped !== lower) {
        if (cache.byStrippedProductCode[stripped] && cache.byStrippedProductCode[stripped] !== p.id) {
          cache.byStrippedProductCode[stripped] = '__AMBIGUOUS__';
        } else {
          cache.byStrippedProductCode[stripped] = p.id;
        }
      }
    }
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

    // operations = hlavní linie (bez variant); u každé operace seznam variant k výběru při zadání do výroby
    const products = await prisma.product.findMany({
      where,
      include: { operations: { where: { variant_of_id: null }, orderBy: { step_number: 'asc' }, select: { id: true, step_number: true, name: true, variant_name: true, variant_code: true, variants: { select: { id: true, variant_name: true, variant_code: true }, orderBy: { id: 'asc' } } } },
        equipment: { select: { id: true, group_name: true, name: true, variant_ids: true, output_variant_id: true }, orderBy: [{ group_name: 'asc' }, { sort: 'asc' }] },
        output_variants: { select: { id: true, code: true, name: true, is_base: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (err) { next(err); }
});

// GET /api/production/products/:id
router.get('/products/:id', async (req, res, next) => {
  try {
    // Načti produkt s operacemi a materiály (1 úroveň)
    let product = await loadProductDeep(parseInt(req.params.id), prisma);
    if (!product) return res.status(404).json({ error: 'Produkt nenalezen' });

    // Varianty bez kódu (vzniklé před zavedením kódů) dostanou unikátní kód V01… automaticky
    const noCode = (product.operations || []).filter(o => o.variant_of_id && !o.variant_code);
    if (noCode.length) {
      const used = await usedVariantCodes();
      for (const v of noCode) { const c = nextVariantCode(used); used.add(c); await prisma.productOperation.update({ where: { id: v.id }, data: { variant_code: c } }); }
      product = await loadProductDeep(parseInt(req.params.id), prisma);
    }

    // Rekurzivně enrich materiály s linked_product (do hloubky max 30 úrovní)
    const productCache = await buildProductCache(prisma);
    const productDataCache = {};
    await enrichOperationsRecursive(product.operations, prisma, productCache, 0, 30, productDataCache);

    res.json(product);
  } catch (err) { next(err); }
});

// PATCH /api/production/products/:id/configurator — přepni viditelnost v konfigurátoru
// PATCH /api/production/products/:id/active — přepne aktivní/neaktivní výrobek (body { active } nebo toggle)
router.patch('/products/:id/active', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, active: true } });
    if (!product) return res.status(404).json({ error: 'Produkt nenalezen' });
    const next_ = (req.body && typeof req.body.active === 'boolean') ? req.body.active : !product.active;
    const updated = await prisma.product.update({ where: { id }, data: { active: next_ } });
    res.json({ id: updated.id, active: updated.active });
  } catch (err) { next(err); }
});

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

// ─── Nativní HolyOS linie: výrobek / polotovar založený přímo v HolyOS (bez Factorify) ───
// Kódy Best Series: BS-M-0001 (vrcholová sestava = výrobek), BS-S-0001 (sestava = polotovar),
// BS-D-0001 (díl vyráběný, založený z postupu). Nakupované díly mají NA0000 (z Factorify / nákupu) — negenerují se.
// Číslo = první volné v dané řadě, ověřené proti výrobkům I zboží (skladovým kartám).
const BS_PREFIX = { product: 'BS-M-', 'semi-product': 'BS-S-', part: 'BS-D-' };
async function nextHolyosCode(prefix /*, model (ignorováno — kontrolujeme obě tabulky) */) {
  const [prods, mats] = await Promise.all([
    prisma.product.findMany({ where: { code: { startsWith: prefix, mode: 'insensitive' } }, select: { code: true } }),
    prisma.material.findMany({ where: { code: { startsWith: prefix, mode: 'insensitive' } }, select: { code: true } }),
  ]);
  let max = 0;
  prods.concat(mats).forEach((r) => { const m = /(\d+)$/.exec(r.code || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  // Pojistka: kdyby číslo přesto kolidovalo (např. jiný formát), posuň se na další volné.
  for (let n = max + 1; n < max + 1000; n++) {
    const code = prefix + String(n).padStart(4, '0');
    if (!(await codeTaken(code))) return code;
  }
  return prefix + String(max + 1).padStart(4, '0');
}
async function codeTaken(code) {
  const [p, m] = await Promise.all([
    prisma.product.findFirst({ where: { code: { equals: code, mode: 'insensitive' } }, select: { id: true, name: true } }),
    prisma.material.findFirst({ where: { code: { equals: code, mode: 'insensitive' } }, select: { id: true, name: true } }),
  ]);
  if (p) return 'Výrobek/polotovar s kódem „' + code + '" už existuje (ID ' + p.id + ', ' + p.name + ')';
  if (m) return 'Materiál (skladová karta) s kódem „' + code + '" už existuje (ID ' + m.id + ', ' + m.name + ')';
  return null;
}

// POST /api/production/recode-holyos-codes — jednorázový přepis starých kódů HO-* na BS-*.
// HO-V → BS-M (výrobek), HO-P → BS-S (polotovar), HO-M → BS-D (díl). Navázaná skladová karta
// (Product.material_id se stejným kódem) dostane stejný nový kód. Idempotentní: bez HO-* nic nedělá.
router.post('/recode-holyos-codes', async (req, res, next) => {
  try {
    const changes = [];
    const prods = await prisma.product.findMany({
      where: { OR: [{ code: { startsWith: 'HO-V-' } }, { code: { startsWith: 'HO-P-' } }] },
      select: { id: true, code: true, type: true, material_id: true },
      orderBy: { id: 'asc' },
    });
    for (const p of prods) {
      const prefix = p.code.startsWith('HO-P-') || p.type === 'semi-product' ? BS_PREFIX['semi-product'] : BS_PREFIX.product;
      const newCode = await nextHolyosCode(prefix, 'product');
      await prisma.product.update({ where: { id: p.id }, data: { code: newCode } });
      if (p.material_id) {
        const m = await prisma.material.findUnique({ where: { id: p.material_id }, select: { id: true, code: true } });
        if (m && m.code && m.code.toUpperCase() === p.code.toUpperCase()) {
          await prisma.material.update({ where: { id: m.id }, data: { code: newCode } });
        }
      }
      changes.push({ kind: 'product', id: p.id, from: p.code, to: newCode });
    }
    const mats = await prisma.material.findMany({ where: { code: { startsWith: 'HO-M-' } }, select: { id: true, code: true }, orderBy: { id: 'asc' } });
    for (const m of mats) {
      const newCode = await nextHolyosCode(BS_PREFIX.part, 'material');
      await prisma.material.update({ where: { id: m.id }, data: { code: newCode } });
      changes.push({ kind: 'material', id: m.id, from: m.code, to: newCode });
    }
    res.json({ ok: true, changed: changes.length, changes });
  } catch (err) { next(err); }
});

// POST /api/production/products
// { code?, name, type: product|semi-product, takt_time?, show_in_configurator?, create_material? }
// Prázdný kód → vygeneruje se BS-M-xxxx (výrobek) / BS-S-xxxx (polotovar). create_material (výchozí u polotovaru) založí
// skladovou kartu Material se stejným kódem a propojí ji (material_id) — polotovar pak jde vložit
// do kusovníku nadřazeného výrobku.
router.post('/products', async (req, res, next) => {
  try {
    const { z } = require('zod');
    const s = z.object({
      code: z.string().trim().max(50).optional().nullable(),
      name: z.string().trim().min(1, 'Zadej název').max(255),
      type: z.enum(['product', 'semi-product']).default('product'),
      material_id: z.number().int().optional().nullable(),
      takt_time: z.number().optional().nullable(),
      show_in_configurator: z.boolean().optional(),
      create_material: z.boolean().optional(),
      unit: z.string().trim().max(20).optional(),
    });
    const parsed = s.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', message: parsed.error.issues.map((i) => i.message).join(', ') });
    const d = parsed.data;
    const type = d.type || 'product';
    let code = (d.code || '').trim();
    if (!code) code = await nextHolyosCode(type === 'semi-product' ? BS_PREFIX['semi-product'] : BS_PREFIX.product, 'product');
    const dup = await codeTaken(code);
    if (dup) return res.status(400).json({ error: 'Duplicitní kód', message: dup });

    const createMaterial = d.create_material != null ? d.create_material : (type === 'semi-product');
    const product = await prisma.$transaction(async (tx) => {
      let material_id = d.material_id || null;
      if (createMaterial && !material_id) {
        const mat = await tx.material.create({ data: { code, name: d.name, type: type === 'semi-product' ? 'semi-product' : 'product', unit: d.unit || 'ks', sector: 'vyroba', status: 'active' } });
        material_id = mat.id;
      }
      return tx.product.create({
        data: { code, name: d.name, type, material_id, takt_time: d.takt_time || null, show_in_configurator: !!d.show_in_configurator },
      });
    });
    res.status(201).json(product);
  } catch (err) { next(err); }
});

// POST /api/production/products/:id/duplicate — kopie výrobku včetně postupu (operace + materiály + kompetence)
// { code?, name?, create_material? }
router.post('/products/:id/duplicate', async (req, res, next) => {
  try {
    const srcId = parseInt(req.params.id, 10);
    const src = await prisma.product.findUnique({
      where: { id: srcId },
      include: { operations: { include: { materials: true, required_competencies: true, allowed_people: true }, orderBy: { step_number: 'asc' } } },
    });
    if (!src) return res.status(404).json({ error: 'Výrobek nenalezen' });
    const b = req.body || {};
    let code = String(b.code || '').trim();
    if (!code) code = await nextHolyosCode(src.type === 'semi-product' ? BS_PREFIX['semi-product'] : BS_PREFIX.product, 'product');
    const dup = await codeTaken(code);
    if (dup) return res.status(400).json({ error: 'Duplicitní kód', message: dup });
    const name = String(b.name || (src.name + ' (kopie)')).trim().slice(0, 255);
    const createMaterial = b.create_material != null ? !!b.create_material : (src.type === 'semi-product');

    const created = await prisma.$transaction(async (tx) => {
      let material_id = null;
      if (createMaterial) {
        const mat = await tx.material.create({ data: { code, name, type: src.type === 'semi-product' ? 'semi-product' : 'product', unit: 'ks', sector: 'vyroba', status: 'active' } });
        material_id = mat.id;
      }
      const p = await tx.product.create({
        data: { code, name, type: src.type, material_id, takt_time: src.takt_time, show_in_configurator: false,
          min_batch_size: src.min_batch_size, economic_batch_size: src.economic_batch_size, batch_size_step: src.batch_size_step },
      });
      const opIdMap = new Map(); // původní id → nové id (kvůli variantám)
      const orderedOps = src.operations.slice().sort((a, b) => (a.variant_of_id ? 1 : 0) - (b.variant_of_id ? 1 : 0)); // základy dřív než varianty
      for (const op of orderedOps) {
        if (op.is_staging) continue; // staging z FY importu nekopírovat
        const nop = await tx.productOperation.create({
          data: { product_id: p.id, workstation_id: op.workstation_id, workstation_group_id: op.workstation_group_id, is_parallel: op.is_parallel, parallel_from: op.parallel_from, parallel_to: op.parallel_to, step_number: op.step_number, name: op.name, phase: op.phase,
            duration: op.duration, duration_unit: op.duration_unit, preparation_time: op.preparation_time, workers_count: op.workers_count,
            description: op.description, bom_count: op.bom_count, from_factorify: false,
            variant_of_id: op.variant_of_id ? (opIdMap.get(op.variant_of_id) || null) : null, variant_name: op.variant_name, variant_code: op.variant_code },
        });
        opIdMap.set(op.id, nop.id);
        for (const m of op.materials) {
          await tx.operationMaterial.create({ data: { operation_id: nop.id, material_id: m.material_id, product_id: m.product_id, quantity: m.quantity, unit: m.unit } });
        }
        for (const c of op.required_competencies || []) {
          await tx.operationRequiredCompetency.create({ data: { operation_id: nop.id, competency_id: c.competency_id, min_level: c.min_level } });
        }
        for (const ap of op.allowed_people || []) {
          await tx.operationAllowedPerson.create({ data: { operation_id: nop.id, person_id: ap.person_id, priority: ap.priority } });
        }
      }
      // Hotové výrobky (výstupy postupu)
      const outs = await tx.productOutput.findMany({ where: { product_id: src.id } });
      // Varianty konce: nové kódy (K##) + přemapování výstupů
      const ovMap = new Map();
      const ovs = await tx.productOutputVariant.findMany({ where: { product_id: src.id } });
      for (const ov of ovs) { const used = new Set((await tx.productOutputVariant.findMany({ select: { code: true } })).map(r => r.code)); let n = 1; while (used.has('K' + String(n).padStart(2, '0'))) n++; const nv = await tx.productOutputVariant.create({ data: { product_id: p.id, code: 'K' + String(n).padStart(2, '0'), name: ov.name } }); ovMap.set(ov.id, nv.id); }
      if (outs.length) await tx.productOutput.createMany({ data: outs.map(o => ({ product_id: p.id, out_product_id: o.out_product_id, out_material_id: o.out_material_id, quantity: o.quantity, unit: o.unit, note: o.note, output_variant_id: o.output_variant_id ? (ovMap.get(o.output_variant_id) || null) : null })) });
      return p;
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// POST /api/production/materials — rychlé založení materiálu přímo z editoru operace
// { code?, name, unit?, type? } → prázdný kód = BS-D-xxxx (vyráběný díl)
router.post('/materials', async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Zadej název materiálu' });
    let code = String((req.body && req.body.code) || '').trim();
    if (!code) code = await nextHolyosCode(BS_PREFIX.part, 'material');
    const dup = await codeTaken(code);
    if (dup) return res.status(400).json({ error: 'Duplicitní kód', message: dup });
    const unit = String((req.body && req.body.unit) || 'ks').trim().slice(0, 20) || 'ks';
    const type = ['material', 'semi-product', 'product'].indexOf(req.body && req.body.type) !== -1 ? req.body.type : 'material';
    const mat = await prisma.material.create({ data: { code, name, unit, type, sector: 'vyroba', status: 'active' } });
    res.status(201).json({ id: mat.id, code: mat.code, name: mat.name, type: mat.type, unit: mat.unit, current_stock: 0, linked_product_id: null });
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
    const id = parseInt(req.params.id);
    const p = await prisma.product.findUnique({ where: { id }, select: { id: true, code: true, name: true, material_id: true } });
    if (!p) return res.status(404).json({ error: 'Výrobek nenalezen' });
    // Pojistka: výrobek použitý v objednávkách nebo výrobních dávkách nemazat (raději deaktivovat).
    const [orderItems, batches] = await Promise.all([
      prisma.orderItem.count({ where: { product_id: id } }).catch(() => 0),
      prisma.productionBatch.count({ where: { product_id: id } }).catch(() => 0),
    ]);
    if (orderItems > 0 || batches > 0) {
      return res.status(409).json({ error: 'Výrobek „' + p.code + '" je použitý (' + orderItems + ' položek objednávek, ' + batches + ' výrobních dávek). Místo smazání ho deaktivuj.' });
    }
    await prisma.product.delete({ where: { id } });
    // Skladová karta založená spolu s polotovarem (stejný kód) → smazat jen pokud není nikde použitá.
    if (p.material_id) {
      try {
        const m = await prisma.material.findUnique({ where: { id: p.material_id }, select: { id: true, code: true } });
        if (m && m.code && m.code.toUpperCase() === String(p.code).toUpperCase()) {
          const used = await prisma.operationMaterial.count({ where: { material_id: m.id } }).catch(() => 1);
          const stock = await prisma.stock.count({ where: { material_id: m.id } }).catch(() => 1);
          if (!used && !stock) await prisma.material.delete({ where: { id: m.id } });
        }
      } catch (e) { /* karta zůstane */ }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// FACTORIFY SESTAVA ZBOŽÍ (FY BOM)
// =============================================================================

router.get('/products/:id/fy-bom', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: 'Neplatné ID produktu' });
    const bom = await prisma.productFyBom.findUnique({
      where: { product_id: productId },
      include: { items: { orderBy: { row_index: 'asc' } } },
    });
    res.json(bom);
  } catch (err) { next(err); }
});

router.post('/products/:id/fy-bom/import', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: 'Neplatné ID produktu' });
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: 'Produkt nenalezen' });

    const { source_filename, items, note } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Pole `items` je povinné' });
    if (items.length === 0) return res.status(400).json({ error: 'Sestava neobsahuje žádné řádky' });
    if (items.length > 5000) return res.status(400).json({ error: 'Příliš mnoho řádků (max 5000)' });

    const rows = [];
    items.forEach((it, idx) => {
      if (!it || typeof it !== 'object') return;
      const name = String(it.name || '').trim();
      if (!name) return;
      const qty = it.quantity === '' || it.quantity == null ? null : Number(it.quantity);
      rows.push({
        row_index: idx,
        level: it.level ? String(it.level).slice(0, 20) : null,
        factorify_item_id: it.factorify_item_id != null && !Number.isNaN(parseInt(it.factorify_item_id)) ? parseInt(it.factorify_item_id) : null,
        name: name.slice(0, 500),
        quantity: qty != null && !Number.isNaN(qty) ? qty : null,
        unit: it.unit ? String(it.unit).slice(0, 20) : null,
        item_type: it.item_type ? String(it.item_type).slice(0, 50) : null,
        keywords: it.keywords ? String(it.keywords) : null,
        status: it.status ? String(it.status).slice(0, 50) : null,
        photo: it.photo ? String(it.photo).slice(0, 500) : null,
        ignore_stock: !!it.ignore_stock,
        used_in_operations: it.used_in_operations ? String(it.used_in_operations) : null,
        used_at_workstations: it.used_at_workstations ? String(it.used_at_workstations) : null,
        is_purchasable: !!it.is_purchasable,
        has_workflow: !!it.has_workflow,
        drawing: it.drawing ? String(it.drawing).slice(0, 500) : null,
        drawing_is_draft: !!it.drawing_is_draft,
        defined_in: it.defined_in ? String(it.defined_in).slice(0, 120) : null,
        position: it.position ? String(it.position).slice(0, 120) : null,
      });
    });

    if (rows.length === 0) return res.status(400).json({ error: 'Žádný řádek nemá vyplněný název zboží' });

    const topRow = rows.find(r => {
      const lvl = (r.level || '').replace(/\s+/g, '').trim();
      return lvl === '1' || lvl === '';
    }) || rows[0];

    if (topRow) {
      if (product.factorify_id != null && topRow.factorify_item_id != null
          && product.factorify_id !== topRow.factorify_item_id) {
        return res.status(400).json({
          error: 'Sestava patří jinému výrobku',
          detail: 'Factorify ID v exportu (' + topRow.factorify_item_id + ') neodpovídá tomuto výrobku (' + product.factorify_id + ').',
        });
      }
      const tokenMatch = String(topRow.name || '').trim().match(/^(\S+)/);
      const importedCode = tokenMatch ? tokenMatch[1] : null;
      if (importedCode && product.code && importedCode.toLowerCase() !== product.code.toLowerCase()) {
        return res.status(400).json({
          error: 'Sestava patří jinému výrobku',
          detail: 'Kód v exportu (' + importedCode + ') neodpovídá kódu produktu (' + product.code + ').',
        });
      }
    }

    const userId = req.user && req.user.id || null;
    const userName = req.user && (req.user.displayName || req.user.username) || null;

    const result = await prisma.$transaction(async (tx) => {
      await tx.productFyBom.deleteMany({ where: { product_id: productId } });
      return tx.productFyBom.create({
        data: {
          product_id: productId,
          imported_by_id: userId,
          imported_by: userName,
          source_filename: source_filename ? String(source_filename).slice(0, 255) : null,
          row_count: rows.length,
          note: note ? String(note) : null,
          items: { create: rows },
        },
        include: { items: { orderBy: { row_index: 'asc' } } },
      });
    });

    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/products/:id/fy-bom', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: 'Neplatné ID produktu' });
    await prisma.productFyBom.deleteMany({ where: { product_id: productId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /products/:id/fy-bom/import-children
// Z FY snapshotu přebere přímé děti polotovaru na zadané parent_level a doplní je
// do pracovního postupu odpovídajícího Productu jako novou operaci "FY import".
// Existující spotřeby se nepřepisují — doplní se jen rozdílné materiály.
router.post('/products/:id/fy-bom/import-children', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: 'Neplatné ID produktu' });

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: 'Produkt nenalezen' });

    const { parent_level } = req.body || {};
    if (!parent_level) return res.status(400).json({ error: 'parent_level je povinné' });

    const fyBom = await prisma.productFyBom.findUnique({
      where: { product_id: productId },
      include: { items: { orderBy: { row_index: 'asc' } } },
    });
    if (!fyBom) return res.status(400).json({ error: 'Pro tento produkt není naimportovaná FY sestava' });

    const parseLevel = (s) => {
      if (!s) return [];
      return String(s).split(/[\s.]+/).filter(p => p.length > 0).map(p => parseInt(p, 10)).filter(n => !Number.isNaN(n));
    };
    const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const isChildOf = (parentArr, childArr) => childArr.length === parentArr.length + 1 && parentArr.every((v, i) => v === childArr[i]);
    const extractCode = (name) => {
      const m = String(name || '').trim().match(/^(\S+)/);
      return m ? m[1] : null;
    };

    const parentArr = parseLevel(parent_level);
    if (parentArr.length === 0) return res.status(400).json({ error: 'parent_level je neplatný' });

    const parentItem = fyBom.items.find(it => arrEq(parseLevel(it.level), parentArr));
    if (!parentItem) return res.status(400).json({ error: 'V FY snapshotu není položka s úrovní ' + parent_level });

    const childItems = fyBom.items.filter(it => isChildOf(parentArr, parseLevel(it.level)));
    if (childItems.length === 0) {
      return res.status(400).json({ error: 'Pro tento polotovar nejsou v FY snapshotu žádné podpoložky' });
    }

    let targetProductId;
    if (arrEq(parentArr, [1])) {
      targetProductId = productId;
    } else {
      const parentCode = extractCode(parentItem.name);
      const parentFactId = parentItem.factorify_item_id;
      let target = null;
      if (parentCode) target = await prisma.product.findFirst({ where: { code: parentCode } });
      if (!target && parentFactId) target = await prisma.product.findFirst({ where: { factorify_id: parentFactId } });
      if (!target) {
        let cleanName = String(parentItem.name || '').trim().replace(/^\d{3,12}\s*-\s*/, '').replace(/^[\w-]+\s+/, '').trim();
        if (!cleanName) cleanName = parentItem.name || ('Polotovar ' + (parentCode || parentFactId));
        const isProductType = String(parentItem.item_type || '').toLowerCase().includes('výrobek') || String(parentItem.item_type || '').toLowerCase().includes('vyrobek');
        let materialId = null;
        if (parentCode) {
          const mat = await prisma.material.findFirst({ where: { code: parentCode } });
          if (mat) materialId = mat.id;
        }
        const created = await prisma.product.create({
          data: {
            code: parentCode || ('FY-' + parentFactId),
            name: cleanName,
            type: isProductType ? 'product' : 'semi-product',
            material_id: materialId,
            factorify_id: parentFactId,
          },
        });
        targetProductId = created.id;
      } else {
        targetProductId = target.id;
      }
    }

    const targetProduct = await prisma.product.findUnique({
      where: { id: targetProductId },
      include: { operations: { include: { materials: { include: { material: true } } } } },
    });

    const existingCodes = new Set();
    for (const op of (targetProduct.operations || [])) {
      for (const om of (op.materials || [])) {
        if (om.material && om.material.code) existingCodes.add(om.material.code.toLowerCase());
      }
    }

    const toAdd = [];
    const skipped = [];
    const alreadyExisted = [];
    for (const child of childItems) {
      const code = extractCode(child.name);
      const factId = child.factorify_item_id;

      // Lookup priority — FY export má factorify_item_id, který odpovídá:
      //   - Material.factorify_id (varchar) pro materiály
      //   - Product.factorify_id (int) pro polotovary
      // Material.id je Prisma PK a NEodpovídá FY ID.
      let material = null;

      if (factId != null && String(factId).trim() !== '') {
        material = await prisma.material.findFirst({ where: { factorify_id: String(factId) } });
      }
      if (!material && factId != null) {
        material = await prisma.material.findFirst({ where: { external_id: String(factId) } });
      }
      if (!material && code) {
        material = await prisma.material.findFirst({
          where: { code: { equals: code, mode: 'insensitive' } },
        });
      }
      if (!material && child.name) {
        material = await prisma.material.findFirst({
          where: { name: { equals: child.name, mode: 'insensitive' } },
        });
      }

      if (!material) {
        skipped.push({
          code: code || null,
          name: child.name,
          level: child.level,
          factorify_id: factId,
          reason: 'Material nenalezen — zkoušeno FY ID=' + (factId || '?') + ', kód=' + (code || '?') + ', název',
        });
        continue;
      }

      if (material.code && existingCodes.has(material.code.toLowerCase())) {
        alreadyExisted.push({ code: material.code, name: child.name, level: child.level });
        continue;
      }

      toAdd.push({
        material_id: material.id,
        material_code: material.code,
        quantity: child.quantity != null ? Number(child.quantity) : 1,
        unit: child.unit || material.unit || 'ks',
      });
    }

    if (toAdd.length === 0) {
      return res.json({
        added: 0,
        already_existed: alreadyExisted.length,
        already_existed_list: alreadyExisted,
        skipped,
        target_product_id: targetProductId,
        target_product_code: targetProduct.code,
        message: 'Vše je už v postupu nebo žádný materiál nenalezen',
      });
    }

    let importOp = (targetProduct.operations || []).find(op => /^FY import/i.test(op.name));
    if (!importOp) {
      const maxStep = (targetProduct.operations || []).reduce((mx, o) => Math.max(mx, o.step_number || 0), 0);
      importOp = await prisma.productOperation.create({
        data: {
          product_id: targetProductId,
          name: 'FY import (' + new Date().toLocaleDateString('cs-CZ') + ')',
          step_number: maxStep + 1,
          duration: 0,
          duration_unit: 'MINUTE',
          workers_count: 1,
          is_staging: true,
          description: 'Migrační okno z Factorify importu — staging area pro materiály k roztřídění (drag&drop). Není to skutečná pracovní operace.',
        },
      });
    }

    let added = 0;
    for (const item of toAdd) {
      const linked = await prisma.product.findFirst({ where: { material_id: item.material_id } });
      await prisma.operationMaterial.create({
        data: {
          operation_id: importOp.id,
          material_id: item.material_id,
          quantity: item.quantity,
          unit: item.unit,
          product_id: linked ? linked.id : null,
        },
      });
      added++;
    }

    res.json({
      added,
      already_existed: alreadyExisted.length,
      already_existed_list: alreadyExisted,
      skipped,
      operation_id: importOp.id,
      operation_name: importOp.name,
      target_product_id: targetProductId,
      target_product_code: targetProduct.code,
    });
  } catch (err) { next(err); }
});



// POST /products/:id/fy-bom/sync-qty
// Aktualizuje OperationMaterial.quantity tak, aby seděla s FY exportem.
// body: { parent_level, factorify_item_id, fy_qty, fy_unit? }
router.post('/products/:id/fy-bom/sync-qty', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    if (Number.isNaN(productId)) return res.status(400).json({ error: 'Neplatné ID produktu' });

    const { parent_level, factorify_item_id, fy_qty, fy_unit } = req.body || {};
    if (!parent_level) return res.status(400).json({ error: 'parent_level je povinné' });
    if (factorify_item_id == null) return res.status(400).json({ error: 'factorify_item_id je povinné' });
    if (fy_qty == null || isNaN(Number(fy_qty))) return res.status(400).json({ error: 'fy_qty je povinné a musí být číslo' });

    const fyBom = await prisma.productFyBom.findUnique({
      where: { product_id: productId },
      include: { items: true },
    });
    if (!fyBom) return res.status(400).json({ error: 'Pro tento produkt není naimportovaná FY sestava' });

    const parseLevel = (s) => {
      if (!s) return [];
      return String(s).split(/[\s.]+/).filter(p => p.length > 0).map(p => parseInt(p, 10)).filter(n => !Number.isNaN(n));
    };
    const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    const parentArr = parseLevel(parent_level);
    if (parentArr.length === 0) return res.status(400).json({ error: 'parent_level je neplatný' });

    let targetProductId;
    if (arrEq(parentArr, [1])) {
      targetProductId = productId;
    } else {
      const parentItem = fyBom.items.find(it => arrEq(parseLevel(it.level), parentArr));
      if (!parentItem) return res.status(404).json({ error: 'Polotovar na úrovni ' + parent_level + ' nenalezen ve FY snapshotu' });
      let target = null;
      if (parentItem.factorify_item_id != null) {
        target = await prisma.product.findFirst({ where: { factorify_id: Number(parentItem.factorify_item_id) } });
      }
      if (!target) {
        const m = String(parentItem.name || '').trim().match(/^(\S+)/);
        const parentCode = m ? m[1] : null;
        if (parentCode) target = await prisma.product.findFirst({ where: { code: parentCode } });
      }
      if (!target) return res.status(404).json({ error: 'Cílový polotovar (úroveň ' + parent_level + ') v HolyOS neexistuje' });
      targetProductId = target.id;
    }

    const material = await prisma.material.findFirst({ where: { factorify_id: String(factorify_item_id) } });
    if (!material) return res.status(404).json({ error: 'Material s factorify_id=' + factorify_item_id + ' neexistuje' });

    const operations = await prisma.productOperation.findMany({
      where: { product_id: targetProductId },
      include: { materials: { where: { material_id: material.id } } },
    });
    const allOms = operations.flatMap(op => op.materials);
    if (allOms.length === 0) {
      return res.status(404).json({ error: 'Material "' + material.code + '" není v žádné operaci tohoto polotovaru. Použij Doplnit do postupu.' });
    }

    const opsWithMatch = operations.filter(op => op.materials.length > 0).sort((a, b) => (a.step_number || 0) - (b.step_number || 0));
    const omToUpdate = opsWithMatch[0].materials[0];
    const updated = await prisma.operationMaterial.update({
      where: { id: omToUpdate.id },
      data: {
        quantity: Number(fy_qty),
        ...(fy_unit ? { unit: String(fy_unit) } : {}),
      },
    });
    res.json({
      ok: true,
      operation_material_id: updated.id,
      operation_id: opsWithMatch[0].id,
      operation_name: opsWithMatch[0].name,
      material_code: material.code,
      new_quantity: updated.quantity,
      new_unit: updated.unit,
      total_matches: allOms.length,
      warning: allOms.length > 1 ? 'Material je v ' + allOms.length + ' operacích — upravena byla jen první.' : null,
    });
  } catch (err) { next(err); }
});

// =============================================================================
// HALY (halls) — seskupení pracovišť
// =============================================================================

// =============================================================================
// HOTOVÉ VÝROBKY (výstupy postupu) — co se naskladní po dokončení
// =============================================================================
const OUTPUT_INCLUDE = { out_product: { select: { id: true, code: true, name: true, type: true } }, out_material: { select: { id: true, code: true, name: true, unit: true } } };
// GET /api/production/products/:id/outputs
// ── Výbava výrobku (Barva – Červená = sada variant operací) ───────────────────
// GET /api/production/products/:id/equipment
router.get('/products/:id/equipment', async (req, res, next) => {
  try {
    const rows = await prisma.productEquipment.findMany({ where: { product_id: parseInt(req.params.id, 10) }, orderBy: [{ group_name: 'asc' }, { sort: 'asc' }, { name: 'asc' }] });
    res.json(rows);
  } catch (err) { next(err); }
});
// PUT /api/production/products/:id/equipment — nahradí celou výbavu: [{ id?, group_name, name, variant_ids:[], note? }]
router.put('/products/:id/equipment', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    // Do výbavy jde zařadit varianty i ZÁKLADNÍ provedení operace (základ = „u této operace nic neměnit")
    const variants = await prisma.productOperation.findMany({ where: { product_id: productId, OR: [{ variant_of_id: { not: null } }, { variants: { some: {} } }] }, select: { id: true, variant_of_id: true } });
    const validIds = new Set(variants.map(v => v.id));
    const baseOf = new Map(variants.map(v => [v.id, v.variant_of_id || v.id]));
    const clean = [];
    for (const [i, it] of items.entries()) {
      const group_name = String(it.group_name || '').trim().slice(0, 80), name = String(it.name || '').trim().slice(0, 120);
      if (!group_name || !name) return res.status(400).json({ error: 'Každá položka výbavy musí mít skupinu (např. Barva) a název (např. Červená).' });
      const ids = [...new Set((it.variant_ids || []).map(Number).filter(n => validIds.has(n)))];
      // jedna výbava nesmí mít dvě varianty téže operace
      const bases = ids.map(id => baseOf.get(id)); if (new Set(bases).size !== bases.length) return res.status(400).json({ error: 'Výbava „' + group_name + ' – ' + name + '" má dvě varianty stejné operace.' });
      clean.push({ product_id: productId, group_name, name, variant_ids: ids, sort: i, note: it.note ? String(it.note).slice(0, 2000) : null, output_variant_id: it.output_variant_id ? parseInt(it.output_variant_id) : null });
    }
    const rows = await prisma.$transaction(async (tx) => {
      await tx.productEquipment.deleteMany({ where: { product_id: productId } });
      if (clean.length) await tx.productEquipment.createMany({ data: clean });
      return tx.productEquipment.findMany({ where: { product_id: productId }, orderBy: [{ group_name: 'asc' }, { sort: 'asc' }] });
    });
    res.json(rows);
  } catch (err) { next(err); }
});
// Převod zvolené výbavy na volby variant { základ_id: varianta_id }; kolize dvou výbav na téže operaci = chyba
async function resolveEquipment(productId, equipmentIds, baseChoices) {
  const choices = Object.assign({}, baseChoices || {});
  const ids = (equipmentIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return { choices, labels: [] };
  const eq = await prisma.productEquipment.findMany({ where: { id: { in: ids }, product_id: productId } });
  const allVar = await prisma.productOperation.findMany({ where: { product_id: productId, OR: [{ variant_of_id: { not: null } }, { variants: { some: {} } }] }, select: { id: true, variant_of_id: true, name: true } });
  const baseOf = new Map(allVar.map(v => [v.id, v.variant_of_id || v.id]));
  const owner = {}; // základ → název výbavy, která ho nastavila
  const picked = {}; // základ → zvolené id (varianta nebo samotný základ)
  for (const e of eq) {
    for (const vid of e.variant_ids) {
      const b = baseOf.get(vid); if (!b) continue;
      if (picked[b] && picked[b] !== vid) throw Object.assign(new Error('Výbavy „' + owner[b] + '" a „' + e.group_name + ' – ' + e.name + '" se liší u stejné operace — vyber jen jednu z nich.'), { status: 400 });
      picked[b] = vid; owner[b] = e.group_name + ' – ' + e.name;
    }
  }
  for (const b of Object.keys(picked)) choices[b] = picked[b]; // základ = id základu (výslovná volba), jinak id varianty
  // Varianta konce: nejvýš jedna napříč zvolenou výbavou
  let outputVariantId = null, outOwner = null;
  for (const e of eq) { if (!e.output_variant_id) continue; if (outputVariantId && outputVariantId !== e.output_variant_id) throw Object.assign(new Error('Výbavy „' + outOwner + '" a „' + e.group_name + ' – ' + e.name + '" určují různé konce (hotové výrobky) — vyber jen jednu z nich.'), { status: 400 }); outputVariantId = e.output_variant_id; outOwner = e.group_name + ' – ' + e.name; }
  return { choices, labels: eq.map(e => e.group_name + ' – ' + e.name), outputVariantId };
}

// ── Varianty konce (hotové výrobky per provedení) ─────────────────────────────
router.get('/products/:id/output-variants', async (req, res, next) => {
  try { res.json(await prisma.productOutputVariant.findMany({ where: { product_id: parseInt(req.params.id) }, orderBy: { id: 'asc' } })); } catch (err) { next(err); }
});
// POST { name, base_name? } → vytvoří variantu konce s unikátním kódem K01, K02 …
//   Při první variantě musí dostat jméno i ZÁKLADNÍ konec (base_name) — vznikne pojmenovaný základ (is_base) s vlastním kódem,
//   stejně jako u operací, aby šlo konce jednoznačně rozlišit (kód dávky, výbava).
router.post('/products/:id/output-variants', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'Zadej název varianty konce (např. Červený).' });
    const nextCode = async () => { const used = new Set((await prisma.productOutputVariant.findMany({ select: { code: true } })).map(r => r.code.toUpperCase())); let n = 1; while (used.has('K' + String(n).padStart(2, '0'))) n++; return 'K' + String(n).padStart(2, '0'); };
    const hasBase = await prisma.productOutputVariant.findFirst({ where: { product_id: productId, is_base: true } });
    if (!hasBase) {
      const baseName = String(req.body?.base_name || '').trim().slice(0, 120);
      if (!baseName) return res.status(400).json({ error: 'Pojmenuj i základní konec (např. Modrý), aby šly konce rozlišit.', need_base_name: true });
      await prisma.productOutputVariant.create({ data: { product_id: productId, code: await nextCode(), name: baseName, is_base: true } });
    }
    const row = await prisma.productOutputVariant.create({ data: { product_id: productId, code: await nextCode(), name } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});
router.put('/products/:id/output-variants/:vid', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'Zadej název.' });
    res.json(await prisma.productOutputVariant.update({ where: { id: parseInt(req.params.vid) }, data: { name } }));
  } catch (err) { next(err); }
});
router.delete('/products/:id/output-variants/:vid', async (req, res, next) => {
  try {
    const row = await prisma.productOutputVariant.findUnique({ where: { id: parseInt(req.params.vid) } });
    if (!row) return res.status(404).json({ error: 'Nenalezeno' });
    if (row.is_base) return res.status(400).json({ error: 'Základní konec nejde smazat — smaž nejdřív ostatní varianty konce.' });
    await prisma.productOutputVariant.delete({ where: { id: row.id } });
    // Zbyl jen základ → odstranit i jeho pojmenování (výrobek je zase bez variant konce)
    const rest = await prisma.productOutputVariant.findMany({ where: { product_id: row.product_id } });
    if (rest.length === 1 && rest[0].is_base) await prisma.productOutputVariant.delete({ where: { id: rest[0].id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/products/:id/outputs', async (req, res, next) => {
  try {
    const rows = await prisma.productOutput.findMany({ where: { product_id: parseInt(req.params.id) }, include: OUTPUT_INCLUDE, orderBy: { id: 'asc' } });
    res.json(rows);
  } catch (err) { next(err); }
});
// PUT /api/production/products/:id/outputs — nahradí seznam { outputs: [{ out_product_id? | out_material_id?, quantity, unit, note }] }
// Prázdný seznam = výchozí chování (výrobek sám ×1).
router.put('/products/:id/outputs', async (req, res, next) => {
  try {
    const pid = parseInt(req.params.id);
    const list = Array.isArray(req.body && req.body.outputs) ? req.body.outputs : [];
    // output_variant_id: výstupy pro variantu konce (K01 Červený…); bez něj = výchozí výstupy
    let variantId = req.body && req.body.output_variant_id ? parseInt(req.body.output_variant_id) : null;
    if (variantId) { const ov = await prisma.productOutputVariant.findUnique({ where: { id: variantId } }); if (ov && ov.is_base) variantId = null; } // základ = výchozí výstupy
    const data = list.map((o) => ({
      product_id: pid,
      output_variant_id: variantId,
      out_product_id: o.out_product_id ? parseInt(o.out_product_id) : null,
      out_material_id: o.out_material_id ? parseInt(o.out_material_id) : null,
      quantity: Number(o.quantity) > 0 ? Number(o.quantity) : 1,
      unit: (o.unit || 'ks').slice(0, 20),
      note: o.note ? String(o.note).slice(0, 255) : null,
    })).filter((o) => o.out_product_id || o.out_material_id);
    await prisma.$transaction(async (tx) => {
      await tx.productOutput.deleteMany({ where: { product_id: pid, output_variant_id: variantId } });
      if (data.length) await tx.productOutput.createMany({ data });
    });
    const rows = await prisma.productOutput.findMany({ where: { product_id: pid }, include: OUTPUT_INCLUDE, orderBy: { id: 'asc' } });
    res.json(rows);
  } catch (err) { next(err); }
});

// =============================================================================
// OBECNÉ NASTAVENÍ VÝROBY (AppSetting production.*)
// =============================================================================
// GET /api/production/settings → { workers_person_ids: [] }
router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const { getSetting } = require('../services/settings');
    const ids = await getSetting('production.workers_person_ids', { type: 'json', defaultValue: [] });
    const { DEFAULT_SHIFT } = require('../services/planning/shift-calendar');
    const shift = await getSetting('production.shift', { type: 'json', defaultValue: null });
    const leadMin = await getSetting('production.material_lead_min', { type: 'number', defaultValue: 60 });
    const leadBlocks = await getSetting('production.material_lead_blocks_start', { type: 'boolean', defaultValue: false });
    res.json({ workers_person_ids: Array.isArray(ids) ? ids : [], shift: shift || Object.assign({ source: 'default' }, DEFAULT_SHIFT), material_lead_min: Number(leadMin) || 60, material_lead_blocks_start: !!leadBlocks });
  } catch (err) { next(err); }
});
// PUT /api/production/settings { workers_person_ids: [..] }
router.put('/settings', requireAuth, async (req, res, next) => {
  try {
    const { setSetting } = require('../services/settings');
    const b = req.body || {};
    if (Array.isArray(b.workers_person_ids)) {
      await setSetting('production.workers_person_ids', b.workers_person_ids.map(Number).filter(Number.isFinite), { type: 'json', description: 'Výrobní pracovníci — výchozí seznam lidí nabízený u operací' });
    }
    if (b.material_lead_min !== undefined && Number.isFinite(Number(b.material_lead_min))) {
      await setSetting('production.material_lead_min', Math.max(0, Math.round(Number(b.material_lead_min))), { type: 'number', description: 'Rezerva pro přípravu materiálu na pracoviště (minuty před začátkem operace)' });
    }
    if (typeof b.material_lead_blocks_start === 'boolean') {
      await setSetting('production.material_lead_blocks_start', b.material_lead_blocks_start, { type: 'boolean', description: 'Rezerva přípravy materiálu smí odsunout začátek výroby (false = lidé bez prodlev, příprava se přizpůsobí)' });
    }
    if (b.shift && typeof b.shift === 'object') {
      const sh = b.shift;
      const hhmm = (v) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) ? v : null;
      const clean = sh.mode === '24_7' ? { mode: '24_7' } : {
        start: hhmm(sh.start) || '05:30', end: hhmm(sh.end) || '14:00',
        work_days: (Array.isArray(sh.work_days) ? sh.work_days.map(Number).filter(n => n >= 1 && n <= 7) : [1, 2, 3, 4, 5]),
        breaks: (Array.isArray(sh.breaks) ? sh.breaks : []).map(x => ({ start: hhmm(x.start), end: hhmm(x.end) })).filter(x => x.start && x.end),
      };
      await setSetting('production.shift', clean, { type: 'json', description: 'Směna výroby: začátek/konec, pracovní dny, přestávky (plánovač)' });
    }
    const { getSetting } = require('../services/settings');
    res.json({ workers_person_ids: await getSetting('production.workers_person_ids', { type: 'json', defaultValue: [] }), shift: await getSetting('production.shift', { type: 'json', defaultValue: null }) });
  } catch (err) { next(err); }
});

// =============================================================================
// SKUPINY PRACOVIŠŤ (Hala → Skupina → Pracoviště)
// =============================================================================

// GET /api/production/workstation-groups — seznam skupin (vč. počtu pracovišť a operací)
router.get('/workstation-groups', async (req, res, next) => {
  try {
    const groups = await prisma.workstationGroup.findMany({
      orderBy: [{ hall: { sort_order: 'asc' } }, { sort_order: 'asc' }, { name: 'asc' }],
      include: {
        hall: { select: { id: true, name: true, color: true } },
        _count: { select: { workstations: true, operations: true } },
      },
    });
    res.json(groups);
  } catch (err) { next(err); }
});

// POST /api/production/workstation-groups — vytvořit skupinu
router.post('/workstation-groups', async (req, res, next) => {
  try {
    const { name, code, hall_id, color, sort_order, note, workstation_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Název skupiny je povinný' });
    const g = await prisma.$transaction(async (tx) => {
      const created = await tx.workstationGroup.create({
        data: {
          name: name.trim(), code: code ? String(code).trim() : null,
          hall_id: hall_id ? parseInt(hall_id) : null,
          color: color || null, sort_order: sort_order || 0, note: note || null,
        },
      });
      if (Array.isArray(workstation_ids) && workstation_ids.length) {
        await tx.workstation.updateMany({
          where: { id: { in: workstation_ids.map(Number) } },
          data: { group_id: created.id, ...(created.hall_id ? { hall_id: created.hall_id } : {}) },
        });
      }
      return created;
    });
    res.status(201).json(g);
  } catch (err) { next(err); }
});

// PUT /api/production/workstation-groups/:id — upravit skupinu
router.put('/workstation-groups/:id', async (req, res, next) => {
  try {
    const { name, code, hall_id, color, sort_order, note } = req.body;
    const id = parseInt(req.params.id);
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (code !== undefined) data.code = code ? String(code).trim() : null;
    if (hall_id !== undefined) data.hall_id = hall_id ? parseInt(hall_id) : null;
    if (color !== undefined) data.color = color || null;
    if (sort_order !== undefined) data.sort_order = parseInt(sort_order) || 0;
    if (note !== undefined) data.note = note || null;
    const g = await prisma.$transaction(async (tx) => {
      const updated = await tx.workstationGroup.update({ where: { id }, data });
      // Přesun skupiny do jiné haly → přesunou se i její pracoviště
      if (hall_id !== undefined) {
        await tx.workstation.updateMany({ where: { group_id: id }, data: { hall_id: updated.hall_id } });
      }
      return updated;
    });
    res.json(g);
  } catch (err) { next(err); }
});

// DELETE /api/production/workstation-groups/:id — smazat skupinu (pracoviště i operace zůstanou, odpojí se)
router.delete('/workstation-groups/:id', async (req, res, next) => {
  try {
    await prisma.workstationGroup.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

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
        group: { select: { id: true, name: true, color: true, hall_id: true } },
        supplier_company: { select: { id: true, name: true, city: true, email: true, phone: true } },
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
    const { name, code, hall_id, group_id, is_external, width_m, length_m, input_warehouse_id, input_location_id, output_warehouse_id, output_location_id, supplier_company_id, coop_lead_days, coop_note } = req.body;
    const ws = await prisma.workstation.create({
      data: {
        name, code,
        hall_id: hall_id ? parseInt(hall_id) : null,
        group_id: group_id ? parseInt(group_id) : null,
        is_external: is_external === true,
        supplier_company_id: is_external === true && supplier_company_id ? parseInt(supplier_company_id) : null,
        coop_lead_days: is_external === true && coop_lead_days != null && coop_lead_days !== '' ? Math.max(0, parseInt(coop_lead_days)) : null,
        coop_note: is_external === true && coop_note ? String(coop_note) : null,
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
    const { name, code, hall_id, group_id, is_external, width_m, length_m, input_warehouse_id, input_location_id, output_warehouse_id, output_location_id, supplier_company_id, coop_lead_days, coop_note } = req.body;
    const data = {};
    if (supplier_company_id !== undefined) data.supplier_company_id = supplier_company_id ? parseInt(supplier_company_id) : null;
    if (coop_lead_days !== undefined) data.coop_lead_days = coop_lead_days != null && coop_lead_days !== '' ? Math.max(0, parseInt(coop_lead_days)) : null;
    if (coop_note !== undefined) data.coop_note = coop_note ? String(coop_note) : null;
    if (name !== undefined) data.name = name;
    if (code !== undefined) data.code = code;
    if (hall_id !== undefined) data.hall_id = hall_id ? parseInt(hall_id) : null;
    if (group_id !== undefined) data.group_id = group_id ? parseInt(group_id) : null;
    // Změna haly bez explicitní skupiny → skupina z jiné haly se odpojí
    if (hall_id !== undefined && group_id === undefined) {
      const cur = await prisma.workstation.findUnique({ where: { id: parseInt(req.params.id) }, select: { group: { select: { hall_id: true } } } });
      if (cur?.group && cur.group.hall_id !== data.hall_id) data.group_id = null;
    }
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

// POST /api/production/workstations/reset-all — ADMIN: smaž všechna pracoviště (se zálohou)
// Body: { confirm: 'SMAZAT', halls?: boolean }
// Výrobky, postupy, sloty i dávky zůstávají — jen přijdou o workstation_id (FK ON DELETE SET NULL).
router.post('/workstations/reset-all', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (req.body?.confirm !== 'SMAZAT') return res.status(400).json({ error: 'Chybí potvrzení "SMAZAT"' });
    const withHalls = !!req.body?.halls;

    const ws = await prisma.workstation.findMany({ include: { workers: true, hall: true }, orderBy: { id: 'asc' } });
    const halls = await prisma.hall.findMany({ orderBy: { id: 'asc' } });
    const opsLinked = await prisma.productOperation.count({ where: { workstation_id: { not: null } } });

    // Záloha do data/backups (DATA_DIR na Railway volume)
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workstations-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(file, JSON.stringify({
      exported_at: new Date().toISOString(), by: req.user?.username || req.user?.id, workstations: ws, halls,
    }, null, 2));

    const r = await prisma.workstation.deleteMany({});
    let hallsDeleted = 0;
    if (withHalls) hallsDeleted = (await prisma.hall.deleteMany({})).count;

    console.log(`[production] ADMIN reset pracovišť: ${r.count} pracovišť, ${hallsDeleted} hal, ${opsLinked} operací odpojeno (user ${req.user?.id}), záloha ${file}`);
    res.json({ ok: true, workstations_deleted: r.count, halls_deleted: hallsDeleted, operations_unlinked: opsLinked, backup: path.basename(file) });
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
      include: { product: true, workstation: true, workstation_group: { select: { id: true, name: true, color: true } }, materials: { include: { material: true } } },
      orderBy: [{ product_id: 'asc' }, { step_number: 'asc' }],
    });
    res.json(ops);
  } catch (err) { next(err); }
});

// POST /api/production/operations
router.post('/operations', async (req, res, next) => {
  try {
    const { product_id, workstation_id, workstation_group_id, step_number, name, phase, duration, duration_unit, preparation_time, workers_count, description, bom_count, materials, is_parallel, parallel_from, parallel_to, allowed_person_ids } = req.body;
    if (!is_parallel && !workstation_id && !workstation_group_id) return res.status(400).json({ error: 'Operace musí mít skupinu pracovišť nebo konkrétní pracoviště (paralelní operace je plovoucí a pracoviště nepotřebuje).' });
    const op = await prisma.$transaction(async (tx) => {
      const created = await tx.productOperation.create({
        data: {
          product_id, workstation_id, step_number,
          workstation_group_id: workstation_group_id || null,
          is_parallel: !!is_parallel,
          parallel_from: is_parallel && parallel_from ? parseInt(parallel_from, 10) : null,
          parallel_to: is_parallel && parallel_to ? parseInt(parallel_to, 10) : null,
          name, phase, duration,
          duration_unit: duration_unit || 'MINUTE',
          preparation_time: preparation_time || 0,
          workers_count: workers_count || 1,
          description: description || null,
          bom_count,
        },
      });
      // Kdo smí operaci dělat
      if (Array.isArray(allowed_person_ids)) {
        await tx.operationAllowedPerson.createMany({ data: allowed_person_ids.map((pid, i) => ({ operation_id: created.id, person_id: parseInt(pid, 10), priority: i })).filter(x => Number.isFinite(x.person_id)), skipDuplicates: true });
      }
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
        include: { workstation: true, workstation_group: { select: { id: true, name: true, color: true } }, allowed_people: { select: { id: true, person_id: true, priority: true, person: { select: { id: true, first_name: true, last_name: true, photo_url: true } } }, orderBy: { priority: 'asc' } }, materials: { include: { material: true } } },
      });
    });
    res.status(201).json(op);
  } catch (err) { next(err); }
});

// Kódy variant: formát písmeno + 2 číslice, unikátní napříč celým systémem
const VARIANT_LETTERS = 'VWXYZABCDEFGHJKLMNPQRSTU'; // začíná se u V (varianta), I a O vynechány kvůli záměně s 1/0
async function usedVariantCodes() {
  const rows = await prisma.productOperation.findMany({ where: { variant_code: { not: null } }, select: { variant_code: true } });
  return new Set(rows.map(r => String(r.variant_code).toUpperCase()));
}
function nextVariantCode(used) {
  for (const L of VARIANT_LETTERS) for (let n = 1; n <= 99; n++) { const c = L + String(n).padStart(2, '0'); if (!used.has(c)) return c; }
  throw Object.assign(new Error('Došly volné kódy variant.'), { status: 400 });
}

// Propagace změn dílů základní operace do jejích variant.
//   before/after = díly základu před a po uložení. Pro každou variantu:
//   - díl přidaný do základu → přidá se i do varianty (společný díl)
//   - díl změněný (množství/jednotka) → ve variantě se přepíše, pokud tam je
//   - díl odebraný ze základu → z varianty se odebere jen tehdy, když ho varianta měla beze změny (stejné množství)
async function propagateMaterialsToVariants(tx, opId, before, after) {
  const variants = await tx.productOperation.findMany({ where: { variant_of_id: opId }, select: { id: true } });
  if (!variants.length) return;
  const b = new Map(before.map(m => [m.material_id, m]));
  const a = new Map(after.filter(m => m.material_id).map(m => [m.material_id, m]));
  for (const v of variants) {
    const cur = await tx.operationMaterial.findMany({ where: { operation_id: v.id } });
    const vm = new Map(cur.map(m => [m.material_id, m]));
    for (const [mid, m] of a) {
      const old = b.get(mid);
      const inV = vm.get(mid);
      if (!old) { if (!inV) await tx.operationMaterial.create({ data: { operation_id: v.id, material_id: mid, product_id: m.product_id || null, quantity: m.quantity, unit: m.unit || 'ks' } }); }
      else if (inV && (Number(old.quantity) !== Number(m.quantity) || (old.unit || 'ks') !== (m.unit || 'ks'))) await tx.operationMaterial.update({ where: { id: inV.id }, data: { quantity: m.quantity, unit: m.unit || 'ks' } });
    }
    for (const [mid, old] of b) {
      if (a.has(mid)) continue;
      const inV = vm.get(mid);
      if (inV && Number(inV.quantity) === Number(old.quantity)) await tx.operationMaterial.delete({ where: { id: inV.id } });
    }
  }
}

// POST /api/production/operations/:id/variant — vytvoří variantu operace (kopie dílů, lidí, pracoviště…)
//   body: { variant_name (povinné), variant_code? }
router.post('/operations/:id/variant', async (req, res, next) => {
  try {
    const srcId = parseInt(req.params.id, 10);
    const src = await prisma.productOperation.findUnique({ where: { id: srcId }, include: { materials: true, allowed_people: true, required_competencies: true } });
    if (!src) return res.status(404).json({ error: 'Operace nenalezena' });
    const baseId = src.variant_of_id || src.id; // varianta z varianty → pořád patří k základu
    const variant_name = String(req.body?.variant_name || '').trim();
    if (!variant_name) return res.status(400).json({ error: 'Zadej název varianty (např. Hliník, Nerez, SK verze).' });
    // Kód varianty: písmeno + dvě číslice (V01, V02, … V99, pak W01 …), UNIKÁTNÍ V CELÉM SYSTÉMU (všechny výrobky) — žádné kolize
    const used = await usedVariantCodes();
    let variant_code = String(req.body?.variant_code || '').trim().toUpperCase() || null;
    if (variant_code) {
      if (!/^[A-Z][0-9]{2}$/.test(variant_code)) return res.status(400).json({ error: 'Kód varianty musí být písmeno a dvě číslice (např. V01).' });
      if (used.has(variant_code)) return res.status(400).json({ error: 'Kód varianty ' + variant_code + ' už je v systému použitý — kódy se nesmí opakovat.' });
    } else variant_code = nextVariantCode(used);
    const op = await prisma.$transaction(async (tx) => {
      const created = await tx.productOperation.create({
        data: { product_id: src.product_id, workstation_id: src.workstation_id, workstation_group_id: src.workstation_group_id, is_parallel: src.is_parallel, parallel_from: src.parallel_from, parallel_to: src.parallel_to,
          step_number: src.step_number, name: src.name, phase: src.phase, duration: src.duration, duration_unit: src.duration_unit, preparation_time: src.preparation_time, workers_count: src.workers_count,
          description: src.description, bom_count: src.bom_count, from_factorify: false, variant_of_id: baseId, variant_name, variant_code },
      });
      if (src.materials.length) await tx.operationMaterial.createMany({ data: src.materials.map(m => ({ operation_id: created.id, material_id: m.material_id, product_id: m.product_id, quantity: m.quantity, unit: m.unit })) });
      if (src.allowed_people.length) await tx.operationAllowedPerson.createMany({ data: src.allowed_people.map(ap => ({ operation_id: created.id, person_id: ap.person_id, priority: ap.priority })), skipDuplicates: true });
      if ((src.required_competencies || []).length) await tx.operationRequiredCompetency.createMany({ data: src.required_competencies.map(c => ({ operation_id: created.id, competency_id: c.competency_id, min_level: c.min_level })) });
      return tx.productOperation.findUnique({ where: { id: created.id }, include: { workstation: true, workstation_group: { select: { id: true, name: true, color: true } }, allowed_people: { select: { id: true, person_id: true, priority: true, person: { select: { id: true, first_name: true, last_name: true, photo_url: true } } }, orderBy: { priority: 'asc' } }, materials: { include: { material: true } } } });
    });
    res.status(201).json(op);
  } catch (err) { next(err); }
});

// PUT /api/production/operations/:id
router.put('/operations/:id', async (req, res, next) => {
  try {
    const { workstation_id, workstation_group_id, step_number, name, phase, duration, duration_unit, preparation_time, workers_count, description, bom_count, materials, is_parallel, parallel_from, parallel_to, allowed_person_ids } = req.body;
    const opId = parseInt(req.params.id);
    // Kontrola: hlavní (neparalelní) operace musí mít pracoviště nebo skupinu — sloučíme s aktuálním stavem (PUT může být částečný)
    if (workstation_id !== undefined || workstation_group_id !== undefined || is_parallel !== undefined) {
      const cur = await prisma.productOperation.findUnique({ where: { id: opId }, select: { workstation_id: true, workstation_group_id: true, is_parallel: true } });
      if (!cur) return res.status(404).json({ error: 'Operace nenalezena' });
      const par = is_parallel !== undefined ? !!is_parallel : cur.is_parallel;
      const ws = workstation_id !== undefined ? workstation_id : cur.workstation_id;
      const grp = workstation_group_id !== undefined ? workstation_group_id : cur.workstation_group_id;
      if (!par && !ws && !grp) return res.status(400).json({ error: 'Operace musí mít skupinu pracovišť nebo konkrétní pracoviště (paralelní operace je plovoucí a pracoviště nepotřebuje).' });
    }
    const op = await prisma.$transaction(async (tx) => {
      const { variant_name } = req.body;
      let variant_code = req.body.variant_code;
      // Základní provedení s pojmenováním (má varianty) dostane unikátní kód automaticky, když žádný nemá
      if (variant_name && !variant_code) {
        const cur = await tx.productOperation.findUnique({ where: { id: opId }, select: { variant_code: true } });
        if (!cur.variant_code) { const used = new Set((await tx.productOperation.findMany({ where: { variant_code: { not: null } }, select: { variant_code: true } })).map(r => String(r.variant_code).toUpperCase())); variant_code = nextVariantCode(used); }
      }
      if (variant_code !== undefined && variant_code) {
        variant_code = String(variant_code).trim().toUpperCase();
        if (!/^[A-Z][0-9]{2}$/.test(variant_code)) throw Object.assign(new Error('Kód varianty musí být písmeno a dvě číslice (např. V01).'), { status: 400 });
        const dup = await tx.productOperation.findFirst({ where: { id: { not: opId }, variant_code: { equals: variant_code, mode: 'insensitive' } }, select: { id: true, name: true, product: { select: { code: true } } } });
        if (dup) throw Object.assign(new Error('Kód varianty ' + variant_code + ' už používá operace „' + dup.name + '" (' + (dup.product ? dup.product.code : '') + ') — kódy se nesmí opakovat.'), { status: 400 });
      }
      await tx.productOperation.update({
        where: { id: opId },
        data: { workstation_id, step_number, name, phase, duration, duration_unit, preparation_time, workers_count, description, bom_count,
          ...(variant_name !== undefined ? { variant_name: variant_name ? String(variant_name).slice(0, 120) : null } : {}),
          ...(variant_code !== undefined ? { variant_code: variant_code ? String(variant_code).slice(0, 20) : null } : {}),
          ...(workstation_group_id !== undefined ? { workstation_group_id: workstation_group_id || null } : {}),
          ...(is_parallel !== undefined ? { is_parallel: !!is_parallel, parallel_from: is_parallel && parallel_from ? parseInt(parallel_from, 10) : null, parallel_to: is_parallel && parallel_to ? parseInt(parallel_to, 10) : null } : {}) },
      });
      // Varianty drží pořadí a zařazení (hlavní/paralelní okno) podle základu
      if (step_number !== undefined || is_parallel !== undefined) {
        const base = await tx.productOperation.findUnique({ where: { id: opId }, select: { step_number: true, is_parallel: true, parallel_from: true, parallel_to: true } });
        await tx.productOperation.updateMany({ where: { variant_of_id: opId }, data: { step_number: base.step_number, is_parallel: base.is_parallel, parallel_from: base.parallel_from, parallel_to: base.parallel_to } });
      }
      // Kdo smí operaci dělat — nahraď seznam (pokud přišel)
      if (Array.isArray(allowed_person_ids)) {
        await tx.operationAllowedPerson.deleteMany({ where: { operation_id: opId } });
        await tx.operationAllowedPerson.createMany({ data: allowed_person_ids.map((pid, i) => ({ operation_id: opId, person_id: parseInt(pid, 10), priority: i })).filter(x => Number.isFinite(x.person_id)), skipDuplicates: true });
      }
      // Nahraď materiály — smaž staré + vlož nové v jedné transakci
      if (Array.isArray(materials)) {
        // Propagace do variant: díly společné se základem (stejný materiál) se ve všech variantách srovnají podle základu
        const before = await tx.operationMaterial.findMany({ where: { operation_id: opId }, select: { material_id: true, quantity: true, unit: true } });
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
        await propagateMaterialsToVariants(tx, opId, before, materials);
      }
      return tx.productOperation.findUnique({
        where: { id: opId },
        include: { workstation: true, workstation_group: { select: { id: true, name: true, color: true } }, allowed_people: { select: { id: true, person_id: true, priority: true, person: { select: { id: true, first_name: true, last_name: true, photo_url: true } } }, orderBy: { priority: 'asc' } }, materials: { include: { material: true } } },
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
    const { material_id, quantity, unit, operation_id } = req.body;
    const data = {};
    if (material_id !== undefined) data.material_id = material_id;
    if (quantity !== undefined) data.quantity = quantity;
    if (unit !== undefined) data.unit = unit;
    // Drag&drop: presun materialu mezi operacemi
    if (operation_id !== undefined) data.operation_id = operation_id;
    const mat = await prisma.operationMaterial.update({
      where: { id: parseInt(req.params.id) },
      data: data,
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
// NÁŘEZOVÉ PLÁNY (CuttingPlan) — vstupní deska → více výstupních dílů na sklad
// =============================================================================

// Include pro plán se vším potřebným pro UI
const CUTTING_PLAN_INCLUDE = {
  input_material: { select: { id: true, code: true, name: true, unit: true, current_stock: true } },
  input_warehouse: { select: { id: true, name: true, code: true } },
  output_warehouse: { select: { id: true, name: true, code: true } },
  outputs: {
    include: { material: { select: { id: true, code: true, name: true, unit: true, current_stock: true } } },
    orderBy: { id: 'asc' },
  },
  _count: { select: { executions: true } },
};

// Zod schéma — vstupní i výstupní sklad jsou POVINNÉ (bez nich nelze uložit).
const cuttingPlanSchema = z.object({
  code: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().min(1, 'Název je povinný').max(255),
  input_material_id: z.number().int().positive('Vyber vstupní materiál'),
  input_quantity: z.number().positive().default(1),
  input_warehouse_id: z.number().int().positive('Vyber vstupní sklad'),
  output_warehouse_id: z.number().int().positive('Vyber výstupní sklad'),
  note: z.string().trim().optional().nullable(),
  outputs: z.array(z.object({
    material_id: z.number().int().positive(),
    quantity: z.number().positive(),
    unit: z.string().trim().max(20).optional(),
  })).min(1, 'Přidej alespoň jeden výstupní díl'),
});

// GET /api/production/cutting-plans — seznam plánů
router.get('/cutting-plans', async (req, res, next) => {
  try {
    const { search } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { input_material: { code: { contains: search, mode: 'insensitive' } } },
        { input_material: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const plans = await prisma.cuttingPlan.findMany({
      where,
      include: CUTTING_PLAN_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    res.json(plans);
  } catch (err) { next(err); }
});

// GET /api/production/cutting-plans/:id — detail plánu
router.get('/cutting-plans/:id', async (req, res, next) => {
  try {
    const plan = await prisma.cuttingPlan.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        ...CUTTING_PLAN_INCLUDE,
        executions: {
          include: { executor: { select: { id: true, first_name: true, last_name: true } } },
          orderBy: { created_at: 'desc' },
          take: 50,
        },
      },
    });
    if (!plan) return res.status(404).json({ error: 'Nářezový plán nenalezen' });
    res.json(plan);
  } catch (err) { next(err); }
});

// POST /api/production/cutting-plans — vytvoření plánu
router.post('/cutting-plans', async (req, res, next) => {
  try {
    const parsed = cuttingPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    const d = parsed.data;
    const plan = await prisma.cuttingPlan.create({
      data: {
        code: d.code || null,
        name: d.name,
        input_material_id: d.input_material_id,
        input_quantity: d.input_quantity,
        input_warehouse_id: d.input_warehouse_id,
        output_warehouse_id: d.output_warehouse_id,
        note: d.note || null,
        created_by: req.user?.person?.id || null,
        outputs: {
          create: d.outputs.map(o => ({
            material_id: o.material_id,
            quantity: o.quantity,
            unit: o.unit || 'ks',
          })),
        },
      },
      include: CUTTING_PLAN_INCLUDE,
    });
    res.status(201).json(plan);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Kód plánu už existuje' });
    next(err);
  }
});

// PUT /api/production/cutting-plans/:id — úprava plánu (nahradí výstupy)
router.put('/cutting-plans/:id', async (req, res, next) => {
  try {
    const parsed = cuttingPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    const d = parsed.data;
    const planId = parseInt(req.params.id);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.cuttingPlan.update({
        where: { id: planId },
        data: {
          code: d.code || null,
          name: d.name,
          input_material_id: d.input_material_id,
          input_quantity: d.input_quantity,
          input_warehouse_id: d.input_warehouse_id,
          output_warehouse_id: d.output_warehouse_id,
          note: d.note || null,
        },
      });
      // Nahraď výstupy — smaž staré + vlož nové
      await tx.cuttingPlanOutput.deleteMany({ where: { plan_id: planId } });
      await tx.cuttingPlanOutput.createMany({
        data: d.outputs.map(o => ({
          plan_id: planId,
          material_id: o.material_id,
          quantity: o.quantity,
          unit: o.unit || 'ks',
        })),
      });
      return tx.cuttingPlan.findUnique({ where: { id: planId }, include: CUTTING_PLAN_INCLUDE });
    });
    res.json(plan);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Kód plánu už existuje' });
    next(err);
  }
});

// DELETE /api/production/cutting-plans/:id
router.delete('/cutting-plans/:id', async (req, res, next) => {
  try {
    await prisma.cuttingPlan.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/production/cutting-plans/:id/execute — provedení plánu
// Vydá vstupní materiál ze vstupního skladu a přijme výstupní díly na výstupní sklad.
// multiplier = kolikrát se plán provedl (násobí vstup i výstupy).
router.post('/cutting-plans/:id/execute', async (req, res, next) => {
  try {
    const planId = parseInt(req.params.id);
    const multiplierSchema = z.object({
      multiplier: z.number().positive().default(1),
      note: z.string().trim().optional().nullable(),
    });
    const parsed = multiplierSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    const multiplier = parsed.data.multiplier;
    const personId = req.user?.person?.id || null;

    const plan = await prisma.cuttingPlan.findUnique({
      where: { id: planId },
      include: { outputs: true },
    });
    if (!plan) return res.status(404).json({ error: 'Nářezový plán nenalezen' });
    if (!plan.outputs.length) return res.status(400).json({ error: 'Plán nemá žádné výstupní díly' });

    const inputQty = Number(plan.input_quantity) * multiplier;

    const result = await prisma.$transaction(async (tx) => {
      // 1) Výdej vstupního materiálu ze vstupního skladu
      await tx.inventoryMovement.create({
        data: {
          material_id: plan.input_material_id,
          warehouse_id: plan.input_warehouse_id,
          type: 'issue',
          quantity: inputQty,
          reference_type: 'cutting_plan',
          reference_id: plan.id,
          note: `Nářezový plán: ${plan.name} (výdej vstupní desky)`,
          created_by: personId,
        },
      });
      await tx.material.update({
        where: { id: plan.input_material_id },
        data: { current_stock: { decrement: inputQty } },
      });

      // 2) Příjem výstupních dílů na výstupní sklad
      for (const out of plan.outputs) {
        const outQty = Number(out.quantity) * multiplier;
        await tx.inventoryMovement.create({
          data: {
            material_id: out.material_id,
            warehouse_id: plan.output_warehouse_id,
            type: 'receipt',
            quantity: outQty,
            reference_type: 'cutting_plan',
            reference_id: plan.id,
            note: `Nářezový plán: ${plan.name} (příjem dílu)`,
            created_by: personId,
          },
        });
        await tx.material.update({
          where: { id: out.material_id },
          data: { current_stock: { increment: outQty } },
        });
      }

      // 3) Audit záznam o provedení
      const execution = await tx.cuttingPlanExecution.create({
        data: {
          plan_id: plan.id,
          multiplier,
          executed_by: personId,
          note: parsed.data.note || null,
        },
      });
      return execution;
    });

    res.status(201).json({ ok: true, execution: result });
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
      order.flatMap(item => [
        prisma.productOperation.update({
          where: { id: item.id },
          data: { step_number: item.step_number },
        }),
        // varianty operace drží stejné pořadí jako jejich základ
        prisma.productOperation.updateMany({ where: { variant_of_id: item.id }, data: { step_number: item.step_number } }),
      ])
    );

    // Vrať aktualizovaný produkt
    const product = await prisma.product.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        operations: {
          include: { workstation: true, workstation_group: { select: { id: true, name: true, color: true } }, allowed_people: { select: { id: true, person_id: true, priority: true, person: { select: { id: true, first_name: true, last_name: true, photo_url: true } } }, orderBy: { priority: 'asc' } }, materials: { include: { material: true } } },
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
        // Vazba na prodejní objednávku jde přes SlotAssignment.order_id (Int? bez Prisma relace),
        // takže si vytáhnu jen IDčka a doplním order_number jedním navazujícím lookupem.
        slot_assignments: { select: { order_id: true } },
      },
      orderBy: [{ planned_start: 'asc' }, { priority: 'asc' }],
    });

    // Doplnění related_orders — sběr unikátních order_id přes všechny dávky → jeden batch lookup
    const orderIds = [...new Set(
      batches.flatMap(b => (b.slot_assignments || []).map(s => s.order_id).filter(Boolean))
    )];
    const orderMap = new Map();
    if (orderIds.length) {
      const orders = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, order_number: true },
      });
      orders.forEach(o => orderMap.set(o.id, o.order_number));
    }
    batches.forEach(b => {
      const ids = [...new Set((b.slot_assignments || []).map(s => s.order_id).filter(Boolean))];
      b.related_orders = ids
        .map(id => ({ id, order_number: orderMap.get(id) || null }))
        .filter(o => o.order_number);
      delete b.slot_assignments;
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
          include: {
            slot: { select: { id: true, start_date: true, end_date: true } },
          },
        },
      },
    });
    if (!batch) return res.status(404).json({ error: 'Dávka nenalezena' });

    // Doplň related sales orders (přes SlotAssignment.order_id) — pro proklik z UI
    const orderIds = [...new Set((batch.slot_assignments || []).map(sa => sa.order_id).filter(Boolean))];
    let relatedOrders = [];
    if (orderIds.length > 0) {
      relatedOrders = await prisma.order.findMany({
        where: { id: { in: orderIds }, type: 'sales' },
        select: { id: true, order_number: true, status: true, company: { select: { id: true, name: true } } },
      });
    }
    res.json({ ...batch, related_orders: relatedOrders });
  } catch (err) { next(err); }
});

// Generátor batch_number: {rok}-{seq3}, např. "2026-001", "2026-042".
// Sekvence běží od 1 v rámci kalendářního roku planned_start (nebo dnes).
// Testovací dávky mají vlastní řadu "TEST-{rok}-{seq3}" (dřív se hledalo jen "{rok}-", takže
// druhá testovací dávka dostala znovu -001 → P2002 konflikt).
async function generateBatchNumber(plannedStart, isTest) {
  const ref = plannedStart ? new Date(plannedStart) : new Date();
  const year = ref.getFullYear();
  const prefix = (isTest ? 'TEST-' : '') + `${year}-`;
  const rows = await prisma.productionBatch.findMany({
    where: { batch_number: { startsWith: prefix } },
    select: { batch_number: true },
  });
  let seq = 0;
  for (const r of rows) {
    const m = r.batch_number.slice(prefix.length).match(/^(\d+)$/);
    if (m) seq = Math.max(seq, parseInt(m[1], 10));
  }
  return prefix + String(seq + 1).padStart(3, '0');
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
      created_by_id, note, auto_generate_operations, due_date, is_test, ignore_stock, equipment_ids,
    } = req.body || {};
    let variant_choices = req.body?.variant_choices;

    const productId = parseInt(product_id, 10);
    const qty = parseInt(quantity, 10);
    if (isNaN(productId) || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'product_id a quantity (>0) jsou povinné' });
    }
    // Výbava (Barva – Červená …) → volby variant; ruční volby variant mají přednost
    let equipmentLabels = [], outputVariantId = req.body?.output_variant_id ? parseInt(req.body.output_variant_id) : null;
    if (Array.isArray(equipment_ids) && equipment_ids.length) {
      try { const r = await resolveEquipment(productId, equipment_ids, null); variant_choices = Object.assign({}, r.choices, variant_choices || {}); equipmentLabels = r.labels; if (r.outputVariantId) outputVariantId = r.outputVariantId; }
      catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
    }

    // Varianty operací: { základ_id: varianta_id | základ_id } — hodnota = zvolená varianta, nebo id základu (= výslovně základ).
    // U výrobku s variantami MUSÍ být provedení zvoleno u KAŽDÉ operace s variantami, aby byl postup jednoznačný.
    let choices = null, variantLabel = null, configCode = null;
    const basesWithVariants = await prisma.productOperation.findMany({ where: { product_id: productId, variant_of_id: null, is_staging: false, variants: { some: {} } }, select: { id: true, name: true, step_number: true, variants: { select: { id: true } } }, orderBy: { step_number: 'asc' } });
    if (basesWithVariants.length) {
      const vc = (variant_choices && typeof variant_choices === 'object') ? variant_choices : {};
      const missing = [], bad = [];
      choices = {};
      for (const b of basesWithVariants) {
        const val = vc[b.id] != null ? Number(vc[b.id]) : null;
        if (val == null || !Number.isFinite(val)) { missing.push(b.step_number + '. ' + b.name); continue; }
        if (val === b.id) continue; // výslovně základ
        if (b.variants.some(v => v.id === val)) choices[b.id] = val; else bad.push(b.step_number + '. ' + b.name);
      }
      if (missing.length) return res.status(400).json({ error: 'Není zvoleno provedení u operací: ' + missing.join(', ') + '. Vyber výbavu nebo provedení u každé operace s variantami — jinak není jasné, co se má vyrábět.', missing });
      if (bad.length) return res.status(400).json({ error: 'Neplatná varianta u operací: ' + bad.join(', ') });
      if (!Object.keys(choices).length) choices = null;
    }
    // Štítek dávky: u každé operace s variantami zvolené provedení (varianta nebo pojmenovaný základ)
    {
      const bases = await prisma.productOperation.findMany({ where: { product_id: productId, variant_of_id: null, is_staging: false, variants: { some: {} } }, select: { id: true, name: true, step_number: true, variant_name: true, variant_code: true, variants: { select: { id: true, variant_name: true, variant_code: true } } }, orderBy: { step_number: 'asc' } });
      const parts = bases.map(b => { const vid = choices ? choices[b.id] : null; const v = vid ? b.variants.find(x => x.id === vid) : null; const pick = v || b; return b.step_number + '. ' + b.name + ': ' + (pick.variant_code ? pick.variant_code + ' ' : '') + (pick.variant_name || (v ? 'varianta' : 'základ')); });
      variantLabel = ((equipmentLabels.length ? 'Výbava: ' + equipmentLabels.join(', ') + (parts.length ? ' · ' : '') : '') + parts.join(' · ')).slice(0, 255) || null;
      // Výrobní kód: kód výrobku + kódy zvolených provedení v pořadí operací (základ i varianta mají svůj kód)
      const prodRow = await prisma.product.findUnique({ where: { id: productId }, select: { code: true } });
      const codes = bases.map(b => { const vid = choices ? choices[b.id] : null; const v = vid ? b.variants.find(x => x.id === vid) : null; return (v || b).variant_code || null; }).filter(Boolean);
      configCode = ((prodRow && prodRow.code) || ('P' + productId)) + (codes.length ? '-' + codes.join('-') : '');
      // Varianta konce (K01 …) → do kódu i štítku; když výrobek konce má, musí být zvolen (jednoznačnost)
      const anyOv = await prisma.productOutputVariant.count({ where: { product_id: productId } });
      if (anyOv && !outputVariantId) return res.status(400).json({ error: 'Není zvolen konec (hotové výrobky) — vyber výbavu, která konec určuje.' });
      if (outputVariantId) {
        const ov = await prisma.productOutputVariant.findFirst({ where: { id: outputVariantId, product_id: productId } });
        if (!ov) return res.status(400).json({ error: 'Neplatná varianta konce.' });
        configCode += '-' + ov.code;
        variantLabel = ((variantLabel ? variantLabel + ' · ' : '') + 'Konec: ' + ov.code + ' ' + ov.name).slice(0, 255);
      } else outputVariantId = null;
    }

    let batch_number = await generateBatchNumber(planned_start, !!is_test);
    // Pojistka proti souběhu: když číslo mezitím někdo obsadil, vygeneruj další a zkus znovu.
    const createBatch = async (bn) => prisma.productionBatch.create({
      data: {
        batch_number: bn,
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
        due_date: due_date ? new Date(due_date) : null,
        is_test: !!is_test,
        ignore_stock: !!ignore_stock,
        variant_choices: choices || undefined,
        variant_label: variantLabel,
        config_code: configCode ? configCode.slice(0, 160) : null,
        output_variant_id: outputVariantId || null,
      },
      include: { product: { select: { id: true, code: true, name: true } } },
    });
    let batch;
    for (let attempt = 0; ; attempt++) {
      try { batch = await createBatch(batch_number); break; }
      catch (e) {
        if (e.code === 'P2002' && attempt < 3) { batch_number = await generateBatchNumber(planned_start, !!is_test); continue; }
        throw e;
      }
    }

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

    // Vícestupňová výroba: díly s vlastním postupem (polotovary), kterých není dost skladem → dílčí dávky před touto dávkou
    let feeders = null;
    if (auto_generate_operations !== false && !(opsResult && opsResult.error)) {
      try {
        const { createFeederBatches } = require('../services/planning/feeders');
        feeders = await createFeederBatches(batch.id);
      } catch (e) {
        console.error('[batches/create] feeder batches failed:', e.message);
        feeders = { error: e.message, created: [], skipped: [] };
      }
    }

    res.status(201).json({ ...batch, operations_generated: opsResult, feeders });
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
// Po release automaticky pustí scheduler (RCCP V2) — best-effort. Pokud scheduler
// selže, release přesto úspěšný a chyba se loguje (release nesmí být blokovaný).
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

    // Auto-schedule po release (best-effort, neblokuje response)
    let scheduleResult = null;
    try {
      scheduleResult = await scheduleBatch(id);
    } catch (e) {
      console.error(`[release/${id}] auto-schedule failed:`, e.message);
      scheduleResult = { error: e.message };
    }

    res.json({ ...updated, _schedule: scheduleResult });
  } catch (err) { next(err); }
});

// DELETE /api/production/batches/:id — smazání dávky (cascade na batch_operations + logs)
router.delete('/batches/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const b = await prisma.productionBatch.findUnique({ where: { id }, select: { id: true, batch_number: true, status: true, is_test: true } });
    if (!b) return res.status(404).json({ error: 'Dávka nenalezena' });
    await prisma.$transaction(async (tx) => {
      // Testovací dávka: uklidit VŠE navázané (skladové pohyby/doklady s referencí na dávku, feeder dávky)
      if (b.is_test) {
        const mv = await tx.inventoryMovement.findMany({ where: { reference_type: 'batch', reference_id: id }, select: { id: true, material_id: true, type: true, quantity: true, document_id: true } });
        for (const m of mv) {
          // vrátit stav skladu, který pohyb změnil
          const delta = Number(m.quantity) * (m.type === 'receipt' ? -1 : (m.type === 'issue' ? 1 : 0));
          if (delta) await tx.material.update({ where: { id: m.material_id }, data: { current_stock: { increment: delta } } }).catch(() => {});
        }
        if (mv.length) await tx.inventoryMovement.deleteMany({ where: { id: { in: mv.map(m => m.id) } } });
        const docIds = [...new Set(mv.map(m => m.document_id).filter(Boolean))];
        if (docIds.length) await tx.warehouseDocument.deleteMany({ where: { id: { in: docIds }, movements: { none: {} } } }).catch(() => {});
        await tx.productionBatch.deleteMany({ where: { parent_batch_id: id, is_test: true } });
      }
      // Automaticky založené dílčí dávky polotovarů, které ještě nezačaly, smaž s rodičem (rekurzivně); rozpracované jen odpoj
      const dropFeeders = async (pid) => {
        const kids = await tx.productionBatch.findMany({ where: { parent_batch_id: pid, batch_type: 'feeder', status: 'planned' }, select: { id: true } });
        for (const k of kids) { await dropFeeders(k.id); await tx.slotAssignment.updateMany({ where: { batch_id: k.id }, data: { batch_id: null } }).catch(() => {}); await tx.productionBatch.delete({ where: { id: k.id } }); }
      };
      await dropFeeders(id);
      // Ostatní feeder dávky odpoj (ne smazat), sloty uvolni, pak dávku (operace + logy jdou cascade)
      await tx.productionBatch.updateMany({ where: { parent_batch_id: id }, data: { parent_batch_id: null } });
      await tx.slotAssignment.updateMany({ where: { batch_id: id }, data: { batch_id: null } }).catch(() => {});
      await tx.productionBatch.delete({ where: { id } });
    });
    console.log(`[batches] smazána dávka ${b.batch_number} (${b.status}) uživatelem ${req.user ? (req.user.username || req.user.id) : '?'}`);
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dávka nenalezena' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'Dávku nelze smazat — mají na ni vazbu další záznamy (Velín úkoly, pickování…). Zruš ji místo toho.' });
    next(err);
  }
});

// =============================================================================
// PLÁNOVAČ — VÝROBNÍ KIOSEK (F6) — endpointy pro obrazovku pracoviště
// =============================================================================

// GET /api/production/workstations/:id/buffer
//   F5.4 Workstation buffer view — co je fyzicky na vstupní/výstupní lokaci
//   pracoviště a kolik z toho drží rozpracované BatchOperation.
//   Vrací { workstation, input, output, in_progress_operations }.
router.get('/workstations/:id/buffer', async (req, res, next) => {
  try {
    const wsId = parseInt(req.params.id, 10);
    if (isNaN(wsId)) return res.status(400).json({ error: 'Neplatné ID pracoviště' });

    const ws = await prisma.workstation.findUnique({
      where: { id: wsId },
      include: {
        input_location: { select: { id: true, code: true, name: true, warehouse_id: true } },
        output_location: { select: { id: true, code: true, name: true, warehouse_id: true } },
      },
    });
    if (!ws) return res.status(404).json({ error: 'Pracoviště nenalezeno' });

    async function loadStock(locationId) {
      if (!locationId) return [];
      const rows = await prisma.stock.findMany({
        where: { location_id: locationId, quantity: { gt: 0 } },
        include: {
          material: { select: { id: true, code: true, name: true, unit: true } },
          lot: { select: { id: true, lot_number: true, expires_at: true } },
        },
        orderBy: [{ material: { code: 'asc' } }],
      });
      return rows.map(r => ({
        material: r.material,
        lot: r.lot,
        quantity: Number(r.quantity),
        reserved_quantity: Number(r.reserved_quantity),
        available: Number(r.quantity) - Number(r.reserved_quantity),
      }));
    }

    const [inputStock, outputStock] = await Promise.all([
      loadStock(ws.input_location_id),
      loadStock(ws.output_location_id),
    ]);

    // Rozpracované operace na tomto pracovišti — užitečné kontextu (kdo drží jaký materiál)
    const inProgress = await prisma.batchOperation.findMany({
      where: { workstation_id: wsId, status: 'in_progress' },
      include: {
        batch: { select: { batch_number: true, quantity: true,
          product: { select: { code: true, name: true } } } },
        operation: { select: { name: true, step_number: true } },
        assigned_person: { select: { first_name: true, last_name: true } },
      },
      orderBy: { started_at: 'asc' },
    });

    res.json({
      workstation: { id: ws.id, name: ws.name, code: ws.code, flow_type: ws.flow_type },
      input: { location: ws.input_location, stock: inputStock, total_items: inputStock.length },
      output: { location: ws.output_location, stock: outputStock, total_items: outputStock.length },
      in_progress_operations: inProgress.map(op => ({
        id: op.id,
        batch_number: op.batch?.batch_number,
        product: op.batch?.product ? `${op.batch.product.code} ${op.batch.product.name}` : null,
        operation: op.operation?.name,
        step: op.operation?.step_number,
        assigned_to: op.assigned_person ? `${op.assigned_person.first_name} ${op.assigned_person.last_name}` : null,
        started_at: op.started_at,
      })),
    });
  } catch (err) { next(err); }
});

// Materiál blokuje start operace, pokud není na pracovišti (on_site) — ledaže dávka ignoruje sklad (testy).
function isMaterialBlocked(material, batch) {
  if (!material || !material.materials || !material.materials.length) return false;
  if (batch && batch.ignore_stock) return false;
  return material.level !== 'on_site' && material.level !== 'none';
}
function materialBlockReason(material) {
  const bad = (material.materials || []).filter(m => m.level !== 'on_site');
  const list = bad.slice(0, 4).map(m => (m.code ? m.code + ' ' : '') + (m.name || '') + ' (' + m.needed + ' ' + m.unit + ', na pracovišti ' + m.on_site + ')').join(', ');
  const head = material.level === 'missing' ? 'Materiál chybí a není objednán' : material.level === 'not_produced' ? 'Polotovar chybí a není vyroben — nejdřív ho zadej do výroby' : material.level === 'ordered' ? 'Materiál je objednán, ale ještě nedorazil' : material.level === 'in_production' ? 'Polotovar se teprve vyrábí v dílčí dávce' + ((bad.find(m => m.in_production) || {}).in_production ? ' ' + bad.find(m => m.in_production).in_production.batches.join(', ') : '') : 'Materiál není připraven na pracovišti — skladník ho musí nejdřív přivézt';
  return head + (list ? ': ' + list : '') + (bad.length > 4 ? ' …' : '');
}

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
        batch: { select: { id: true, batch_number: true, quantity: true, config_code: true, priority: true,
          product: { select: { id: true, code: true, name: true } } } },
        operation: { select: { id: true, name: true, step_number: true, duration: true, description: true, variant_name: true, variant_code: true } },
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
        batch: { select: { id: true, batch_number: true, quantity: true, config_code: true, priority: true, status: true, ignore_stock: true,
          product: { select: { id: true, code: true, name: true } } } },
        workstation: { select: { id: true, name: true, input_warehouse_id: true } },
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

    // 4. Moje NAPLÁNOVANÁ práce — operace, kde jsem hlavní (assigned_person) nebo další pracovník
    //    (workers), na kterémkoli pracovišti, které ještě nezačaly: co, kdy a kde mě čeká.
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const myPlannedRaw = await prisma.batchOperation.findMany({
      where: {
        OR: [{ assigned_person_id: personId }, { workers: { some: { person_id: personId } } }],
        status: { in: ['pending', 'ready'] },
        AND: [{ OR: [{ planned_end: { gte: dayStart } }, { planned_start: null }] }],
        batch: { status: { notIn: ['cancelled', 'done', 'completed'] } },
      },
      include: {
        batch: { select: { id: true, batch_number: true, quantity: true, config_code: true, priority: true, status: true,
          product: { select: { id: true, code: true, name: true } } } },
        operation: { select: { id: true, name: true, step_number: true, duration: true, description: true, is_parallel: true, workers_count: true, variant_name: true, variant_code: true } },
        workstation: { select: { id: true, name: true, input_warehouse_id: true } },
        workers: { select: { person_id: true, slot: true, person: { select: { first_name: true, last_name: true } } }, orderBy: { slot: 'asc' } },
      },
      orderBy: [{ planned_start: 'asc' }, { sequence: 'asc' }],
      take: 50,
    });
    // Semafor materiálu (na pracovišti / skladem / objednáno / chybí) — pro naplánované i volné úkoly.
    // Bez materiálu na pracovišti (a bez „ignorovat sklad" u dávky) se operace NESMÍ začít → can_start=false.
    let matStatus = new Map();
    try { matStatus = await computeOpMaterialStatus(myPlannedRaw.concat(available)); } catch (e) { /* bez semaforu */ }
    const withMaterial = (o) => {
      const material = matStatus.get(o.id) || { level: 'none', materials: [] };
      const blocked = isMaterialBlocked(material, o.batch);
      return { material, can_start: !blocked, blocked_reason: blocked ? materialBlockReason(material) : null };
    };
    const my_planned = myPlannedRaw.map(o => {
      const mates = (o.workers || []).filter(w => w.person_id !== personId && w.person)
        .map(w => ((w.person.first_name || '') + ' ' + (w.person.last_name || '')).trim()).filter(Boolean);
      const { workers, ...rest } = o;
      return { ...rest, here: o.workstation_id === wsId, mates, ...withMaterial(o) };
    });
    const availableOut = available.map(o => ({ ...o, ...withMaterial(o) }));

    res.json({
      workstation_id: wsId,
      person_id: personId,
      my_in_progress: myInProgress,
      available: availableOut,
      my_planned,
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

    const existing = await prisma.batchOperation.findUnique({ where: { id }, select: { id: true, status: true, operation: { select: { id: true } }, batch: { select: { id: true, quantity: true, ignore_stock: true } }, workstation: { select: { input_warehouse_id: true } } } });
    if (!existing) return res.status(404).json({ error: 'Operace nenalezena' });
    if (existing.status !== 'ready' && existing.status !== 'pending') {
      return res.status(409).json({ error: `Nelze startovat ze stavu '${existing.status}'` });
    }
    // Bez připraveného materiálu na pracovišti se operace nesmí zahájit (výjimka: dávka s „ignorovat sklad")
    try {
      const ms = await computeOpMaterialStatus([existing]);
      const material = ms.get(id) || { level: 'none', materials: [] };
      if (isMaterialBlocked(material, existing.batch)) {
        return res.status(409).json({ error: materialBlockReason(material), code: 'material_not_ready', material });
      }
    } catch (e) { console.warn('[batch-operations/start] kontrola materiálu:', e.message); }

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

router.resolveEquipment = resolveEquipment;
module.exports = router;
