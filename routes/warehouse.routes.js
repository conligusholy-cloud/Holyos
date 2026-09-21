// =============================================================================
// HolyOS — Warehouse routes (materiály, firmy, objednávky, sklady, inventury)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit, diffObjects, makeSnapshot } = require('../services/audit');
const { buildShareUrl: buildOrderShareUrl } = require('../services/share-url');
const {
  releaseOrderToProduction,
  shouldRelease,
} = require('../services/orders/release-to-production');
const {
  issueFinalInvoiceForOrder,
  markFinalInvoicePaid,
  unmarkFinalInvoicePaid,
} = require('../services/orders/final-invoice');

router.use(requireAuth);

// Helper — bezpečně převede datum string (YYYY-MM-DD nebo ISO) na Date objekt.
// Prisma DateTime fieldy odmítají string, vyžadují Date instanci.
function parseDate(v) {
  if (v === undefined) return undefined; // neměnit pole
  if (v === null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Helper — normalizuje nullable unikátní textová pole materiálu.
// Prázdný string "" není NULL, takže @unique constraint povolí jen JEDEN
// záznam s "". Editační formulář posílá barcode: "" pro zboží bez kódu, což
// po prvním uložení způsobí kolizi (P2002) u všech dalších. Prázdné/whitespace
// hodnoty proto převedeme na null — NULLů smí být v unikátním sloupci víc.
function normalizeMaterialBody(body) {
  const data = { ...body };
  for (const field of ['barcode']) {
    if (field in data && typeof data[field] === 'string' && data[field].trim() === '') {
      data[field] = null;
    }
  }
  return data;
}

// Vygeneruje unikátní kód materiálu, když uživatel nechá pole "Kód" prázdné
// (formulář slibuje "Auto"). Formát: MAT-000001 — sekvenčně podle nejvyššího
// existujícího MAT- čísla. Pole code je @unique a NENÍ nullable, takže prázdný
// string "" smí být v DB jen jednou; bez tohoto by druhý a další uživatel
// narazil na P2002 (409 Duplicitní záznam, field: ["code"]).
async function generateMaterialCode() {
  const last = await prisma.material.findFirst({
    where: { code: { startsWith: 'MAT-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  let next = 1;
  if (last) {
    const n = parseInt(last.code.slice(4), 10);
    if (!isNaN(n)) next = n + 1;
  }
  return 'MAT-' + String(next).padStart(6, '0');
}

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

// ─── KATEGORIE ZBOŽÍ ───────────────────────────────────────────────────────
// Stromová hierarchie (osnova) — spravuje se v záložce Kategorie modulu
// Nákup a sklad, zboží se zařazuje přes Material.category_id.

// Vrátí množinu ID kategorie + všech jejích potomků (pro filtr podstromem).
async function collectCategorySubtreeIds(rootId) {
  const all = await prisma.materialCategory.findMany({ select: { id: true, parent_id: true } });
  const byParent = new Map();
  for (const c of all) {
    if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
    byParent.get(c.parent_id).push(c.id);
  }
  const ids = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    ids.push(id);
    for (const childId of byParent.get(id) || []) queue.push(childId);
  }
  return ids;
}

// GET /api/wh/categories — plochý seznam (strom skládá frontend podle parent_id)
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await prisma.materialCategory.findMany({
      include: { _count: { select: { materials: true, children: true } } },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/categories
router.post('/categories', async (req, res, next) => {
  try {
    const { name, parent_id, description, sort_order } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Název kategorie je povinný' });
    }
    const category = await prisma.materialCategory.create({
      data: {
        name: String(name).trim(),
        parent_id: parent_id ? parseInt(parent_id) : null,
        description: description || null,
        sort_order: Number.isFinite(parseInt(sort_order)) ? parseInt(sort_order) : 0,
      },
    });
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/categories/:id
router.put('/categories/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { name, parent_id, description, sort_order } = req.body;
    // Ochrana proti cyklu: kategorie nesmí být zanořená sama do sebe / svého podstromu
    if (parent_id) {
      const subtreeIds = await collectCategorySubtreeIds(id);
      if (subtreeIds.includes(parseInt(parent_id))) {
        return res.status(400).json({ error: 'Kategorii nelze zanořit do jejího vlastního podstromu' });
      }
    }
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (parent_id !== undefined) data.parent_id = parent_id ? parseInt(parent_id) : null;
    if (description !== undefined) data.description = description || null;
    if (sort_order !== undefined) data.sort_order = parseInt(sort_order) || 0;
    const category = await prisma.materialCategory.update({ where: { id }, data });
    res.json(category);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/categories/:id — podkategorie se přesunou na root,
// zboží zůstane nezařazené (FK má ON DELETE SET NULL)
router.delete('/categories/:id', async (req, res, next) => {
  try {
    await prisma.materialCategory.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── MATERIÁLY ─────────────────────────────────────────────────────────────

// GET /api/wh/materials
router.get('/materials', async (req, res, next) => {
  try {
    const { search, type, low_stock, category_id, supplier_id } = req.query;
    const where = { status: 'active' };
    if (type) where.type = type;
    // Filtr dodavatele — jen zboží přiřazené konkrétnímu dodavateli
    if (supplier_id) where.supplier_id = parseInt(supplier_id);
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search } },
      ];
    }
    // Filtr kategorie: "none" = nezařazené, jinak ID kategorie včetně podstromu
    if (category_id === 'none') {
      where.category_id = null;
    } else if (category_id) {
      where.category_id = { in: await collectCategorySubtreeIds(parseInt(category_id)) };
    }

    let materials = await prisma.material.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, parent_id: true } },
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

// GET /api/wh/materials/:id/image — vrátí fotografii materiálu z persistent volume.
// (Pevný podcest před dynamickou /:id route — viz holyos_express_route_order memory.)
// Soubor je hledán v data/product-images/ pod jménem mat-<id>.<libovolná přípona>.
router.get('/materials/:id/image', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const fs = require('fs');
    const path = require('path');
    const IMAGES_DIR = path.join(__dirname, '..', 'data', 'product-images');
    if (!fs.existsSync(IMAGES_DIR)) {
      return res.status(404).json({ error: 'Adresář s obrázky neexistuje' });
    }
    const prefix = `mat-${id}.`;
    const match = fs.readdirSync(IMAGES_DIR).find(f => f.startsWith(prefix));
    if (!match) return res.status(404).json({ error: 'Materiál nemá fotografii' });
    const filePath = path.join(IMAGES_DIR, match);
    const ext = (path.extname(match) || '').toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : 'application/octet-stream';
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
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

// GET /api/wh/materials/:id/where-used — kde se díl používá: konstrukční kusovník (CAD)
// + kusovník pracovního postupu (FY BOM). Páruje se podle material_id, kódu a názvu.
router.get('/materials/:id/where-used', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const mat = await prisma.material.findUnique({ where: { id }, select: { id: true, code: true, name: true } });
    if (!mat) return res.status(404).json({ error: 'Materiál nenalezen' });
    const code = (mat.code || '').trim();
    const name = (mat.name || '').trim();
    const baseName = (n) => String(n || '').replace(/[-_]\d+\s*$/, '').trim();
    const norm = (s) => String(s || '').trim().toLowerCase();
    const keys = new Set([norm(code), norm(name)].filter(Boolean));

    // ── Konstrukční kusovník (CAD) ──
    const orCad = [{ material_id: id }];
    if (code) orCad.push({ name: { contains: code, mode: 'insensitive' } });
    if (name) orCad.push({ name: { contains: name, mode: 'insensitive' } });
    const comps = await prisma.cadComponent.findMany({
      where: { OR: orCad },
      include: { parent_config: { include: { drawing: { include: { project: { select: { code: true, name: true } } } } } } },
      take: 2000,
    });
    const cadMap = new Map();
    for (const c of comps) {
      // Přesná shoda dílu (název bez instanční přípony) proti kódu/názvu — jinak přeskoč.
      if (c.material_id !== id && !keys.has(norm(baseName(c.name)))) continue;
      const dr = c.parent_config && c.parent_config.drawing;
      if (!dr) continue;
      const key = dr.id;
      const q = Number(c.quantity) || 1;
      if (cadMap.has(key)) { cadMap.get(key).quantity += q; }
      else {
        cadMap.set(key, {
          drawing_id: dr.id,
          file_name: dr.file_name,
          title: dr.title || null,
          version: dr.version,
          project: dr.project ? (dr.project.code || dr.project.name) : null,
          quantity: q,
        });
      }
    }

    // ── Kusovník pracovního postupu (FY BOM) ──
    const orBom = [];
    if (name) orBom.push({ name: { equals: name, mode: 'insensitive' } });
    if (code) orBom.push({ name: { contains: code, mode: 'insensitive' } });
    let bomItems = [];
    if (orBom.length) {
      bomItems = await prisma.productFyBomItem.findMany({
        where: { OR: orBom },
        include: { fy_bom: { include: { product: { select: { id: true, code: true, name: true } } } } },
        take: 2000,
      });
    }
    const bomMap = new Map();
    for (const it of bomItems) {
      const p = it.fy_bom && it.fy_bom.product;
      if (!p) continue;
      const key = p.id;
      const q = Number(it.quantity) || 1;
      if (bomMap.has(key)) { bomMap.get(key).quantity += q; }
      else {
        bomMap.set(key, {
          product_id: p.id, code: p.code || null, name: p.name || null,
          level: it.level || null, quantity: q,
        });
      }
    }

    res.json({
      material: mat,
      cad: Array.from(cadMap.values()).sort((a, b) => String(a.file_name).localeCompare(String(b.file_name))),
      routing: Array.from(bomMap.values()).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name))),
    });
  } catch (err) { next(err); }
});

// POST /api/wh/materials
router.post('/materials', async (req, res, next) => {
  try {
    const data = normalizeMaterialBody(req.body);
    // Prázdný/chybějící kód → auto-generuj (formulář slibuje "Auto").
    const autoCode = !data.code || String(data.code).trim() === '';
    if (autoCode) data.code = await generateMaterialCode();

    // Při souběhu dvou uživatelů může vygenerovaný kód kolidovat (P2002).
    // Pro auto-kódy zkusíme znovu s dalším pořadovým číslem.
    let material;
    for (let attempt = 0; ; attempt++) {
      try {
        material = await prisma.material.create({ data });
        break;
      } catch (err) {
        const dupCode = err.code === 'P2002' && (err.meta?.target || []).includes('code');
        if (autoCode && dupCode && attempt < 5) {
          data.code = await generateMaterialCode();
          continue;
        }
        throw err;
      }
    }

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
    const material = await prisma.material.update({ where: { id: parseInt(req.params.id) }, data: normalizeMaterialBody(req.body) });
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
      data: materials.map(normalizeMaterialBody),
      skipDuplicates: true,
    });

    res.status(201).json({ created: result.count });
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/materials/bulk-category — hromadné přiřazení kategorie
// Body: { material_ids: number[], category_id: number|null } (null = vyřadit z kategorie)
router.post('/materials/bulk-category', async (req, res, next) => {
  try {
    const { material_ids, category_id } = req.body;
    if (!Array.isArray(material_ids) || material_ids.length === 0) {
      return res.status(400).json({ error: 'Očekáváno neprázdné pole material_ids' });
    }
    const ids = material_ids.map(Number).filter(Number.isFinite);
    const catId = category_id === null || category_id === '' || category_id === undefined
      ? null
      : parseInt(category_id);
    if (catId !== null) {
      const exists = await prisma.materialCategory.findUnique({ where: { id: catId } });
      if (!exists) return res.status(404).json({ error: 'Kategorie nenalezena' });
    }
    const result = await prisma.material.updateMany({
      where: { id: { in: ids } },
      data: { category_id: catId },
    });
    await logAudit({ action: 'update', entity: 'material', entity_id: null, description: `Hromadně přiřazena kategorie (${catId === null ? 'odebráno' : 'ID ' + catId}) u ${result.count} položek zboží`, user: req.user });
    res.json({ updated: result.count });
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
        items: { include: { product: { select: { id: true, code: true, name: true } } } },
        final_invoice: {
          select: {
            id: true, invoice_number: true, total: true, currency: true,
            date_issued: true, date_due: true, status: true, paid_amount: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Dopočítej výrobní datumy ze slotů (bez N+1 queries)
    const enriched = await enrichOrdersWithProductionDates(orders);
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// ─── Helper: dopočítej výrobní datumy ze slot-assignmentů ──────────────────
// Pro každou položku (OrderItem) najdeme její přiřazený slot a vrátíme:
//   - production_start  = start_date slotu (kdy výroba začíná)
//   - production_finish = end_date slotu (kdy výroba končí)
// Pro celou objednávku:
//   - production_start_last  = start_date NEJPOZDĚJŠÍHO slotu ze všech položek
//   - production_finish_last = end_date  NEJPOZDĚJŠÍHO slotu (= kdy je vše hotovo)
// Pro plánování výroby se hodí position_start per položka + finish_last per order.
async function enrichOrdersWithProductionDates(orders) {
  if (!orders || !orders.length) return orders;

  // Sesbírej všechna order_item_ids, jedním dotazem natáhni jejich sloty
  const itemIds = [];
  for (const o of orders) {
    if (Array.isArray(o.items)) for (const it of o.items) itemIds.push(it.id);
  }
  if (!itemIds.length) return orders;

  const assignments = await prisma.slotAssignment.findMany({
    where: { order_item_id: { in: itemIds } },
    include: { slot: { select: { start_date: true, end_date: true } } },
  });

  // Mapa: order_item_id → { start_date, end_date } — bereme NEJDŘÍVĚJŠÍ start
  // a NEJPOZDĚJŠÍ end, kdyby jedna položka byla přiřazena do více slotů.
  const byItem = {};
  for (const a of assignments) {
    if (!a.slot || !a.order_item_id) continue;
    const cur = byItem[a.order_item_id] || { start: null, end: null };
    const s = a.slot.start_date;
    const e = a.slot.end_date;
    if (s && (!cur.start || s < cur.start)) cur.start = s;
    if (e && (!cur.end || e > cur.end)) cur.end = e;
    byItem[a.order_item_id] = cur;
  }

  // Aplikuj na položky + agreguj na úroveň objednávky
  const DELIVERY_LEAD_DAYS = 10; // datum slíbené zákazníkovi = konec posledního slotu + 10 dní
  const toPersist = [];
  const result = orders.map(o => {
    let orderLatestStart = null;
    let orderLatestEnd = null;
    let orderEarliestStart = null; // nejranější start ze všech slotů (kdy výroba reálně začne)
    const items = Array.isArray(o.items) ? o.items.map(it => {
      const m = byItem[it.id];
      const ps = m?.start || null;
      const pe = m?.end || null;
      // Na úrovni objednávky: nejpozdější slot (nejpozdější end_date)
      if (pe && (!orderLatestEnd || pe > orderLatestEnd)) {
        orderLatestEnd = pe;
        orderLatestStart = ps;
      }
      // Nejranější start — pro trigger doplatkové faktury "N dní před výroba od"
      if (ps && (!orderEarliestStart || ps < orderEarliestStart)) {
        orderEarliestStart = ps;
      }
      return { ...it, production_start: ps, production_finish: pe };
    }) : [];

    // Datum slíbené zákazníkovi — automaticky = konec posledního výrobního slotu + 10 dní,
    // pokud ho obchodník nezadal ručně (expected_delivery_manual). Uloží se, ať teče i do faktur/PDF.
    let expected = o.expected_delivery;
    if (!o.expected_delivery_manual && orderLatestEnd) {
      const auto = new Date(orderLatestEnd);
      auto.setDate(auto.getDate() + DELIVERY_LEAD_DAYS);
      const cur = expected ? new Date(expected) : null;
      if (!cur || cur.getTime() !== auto.getTime()) {
        expected = auto;
        toPersist.push({ id: o.id, expected_delivery: auto });
      }
    }

    return {
      ...o,
      items,
      expected_delivery: expected,
      production_start_last: orderLatestStart,   // start NEJPOZDĚJŠÍHO slotu
      production_finish_last: orderLatestEnd,    // end NEJPOZDĚJŠÍHO slotu (= kdy je objednávka hotová)
      production_start_first: orderEarliestStart, // start NEJRANĚJŠÍHO slotu (= kdy výroba reálně začne)
      // Externí share URL (přes SHARE_BASE_URL — typicky bestseries.cash)
      share_url: o.share_token ? buildOrderShareUrl('/order/' + o.share_token) : null,
    };
  });

  // Best-effort persistence dopočítaných termínů (jen když se změnily).
  if (toPersist.length) {
    await Promise.all(toPersist.map(u =>
      prisma.order.update({ where: { id: u.id }, data: { expected_delivery: u.expected_delivery } }).catch(() => {})
    ));
  }
  return result;
}

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
      // Prisma DateTime vyžaduje Date objekt, ne string
      expected_delivery: parseDate(rest.expected_delivery),
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
            product: { select: { id: true, code: true, name: true } },
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
        final_invoice: {
          select: {
            id: true, invoice_number: true, total: true, currency: true,
            date_issued: true, date_due: true, status: true, paid_amount: true,
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    const [enriched] = await enrichOrdersWithProductionDates([order]);
    // Účetní doklady navázané na objednávku (faktury) + jejich stavy.
    try {
      enriched.invoices = await prisma.invoice.findMany({
        where: { order_id: order.id },
        orderBy: { id: 'asc' },
        select: {
          id: true, invoice_number: true, type: true, invoice_role: true, direction: true,
          total: true, currency: true, status: true, date_issued: true, date_taxable: true, date_due: true, paid_amount: true,
          parent_invoice_id: true, delivery_status: true, sent_at: true, sent_to: true, send_error: true, send_attempts: true,
        },
      });
    } catch (e) { enriched.invoices = []; }
    res.json(enriched);
  } catch (err) { next(err); }
});

// POST /api/wh/orders/:id/share — Vygeneruj sdílecí token
router.post('/orders/:id/share', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });

    // Pokud už má token, vrať ho
    if (order.share_token) {
      return res.json({
        share_token: order.share_token,
        share_url: buildOrderShareUrl('/order/' + order.share_token),
      });
    }

    // Vygeneruj unikátní token
    const crypto = require('crypto');
    const token = crypto.randomBytes(24).toString('hex');

    try {
      const updated = await prisma.order.update({
        where: { id: parseInt(req.params.id) },
        data: { share_token: token },
      });
      res.json({
        share_token: updated.share_token,
        share_url: buildOrderShareUrl('/order/' + updated.share_token),
      });
    } catch (dbErr) {
      // Sloupec share_token pravděpodobně ještě neexistuje — nasaďte migraci
      console.error('Share token DB error (spusťte migraci):', dbErr.message);
      res.status(503).json({ error: 'Sdílení není dostupné — nasaďte databázovou migraci (npx prisma migrate deploy)' });
    }
  } catch (err) { next(err); }
});

// =============================================================================
// PLATBA NA PRODEJNÍ OBJEDNÁVCE — záloha/doplatek + auto-uvolnění do výroby
// =============================================================================
//
// Pevné podcesty pod /orders/:id (přesně před dynamickou PUT /:id).

// PUT /api/wh/orders/:id/payment-config
//   Nastaví parametry platby (rozdělení, výši zálohy, kdy uvolnit výrobu).
//   body: { payment_split?, deposit_amount?, deposit_percent?, release_on_deposit? }
router.put('/orders/:id/payment-config', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Neplatné ID' });

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (order.type !== 'sales') {
      return res.status(400).json({ error: 'Platby řešíme jen pro prodejní objednávky' });
    }

    const { payment_split, deposit_amount, deposit_percent, release_on_deposit, final_invoice_lead_days } = req.body || {};
    const data = {};
    if (payment_split !== undefined) data.payment_split = !!payment_split;
    if (deposit_amount !== undefined) {
      data.deposit_amount = deposit_amount === null || deposit_amount === '' ? null : deposit_amount;
    }
    if (deposit_percent !== undefined) {
      data.deposit_percent = deposit_percent === null || deposit_percent === '' ? null : parseInt(deposit_percent, 10);
    }
    if (release_on_deposit !== undefined) data.release_on_deposit = !!release_on_deposit;
    if (final_invoice_lead_days !== undefined) {
      const n = parseInt(final_invoice_lead_days, 10);
      data.final_invoice_lead_days = isNaN(n) ? 14 : Math.max(0, Math.min(180, n));
    }

    // Když uživatel zruší payment_split, vyčistíme zálohové údaje (ale ne final_paid — to je platná platba).
    if (data.payment_split === false) {
      data.deposit_amount = null;
      data.deposit_percent = null;
      data.deposit_paid = false;
      data.deposit_paid_at = null;
    }

    const updated = await prisma.order.update({ where: { id: orderId }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/wh/orders/:id/payment
//   Manuálně označí platbu jako přijatou. Backend rozhodne, jestli překlopit
//   status na 'confirmed' a/nebo rozpadnout objednávku do výroby.
//
//   body: { kind: 'deposit' | 'final' | 'full', paid: boolean (default true) }
//     - 'deposit': označí zálohu (vyžaduje payment_split=true)
//     - 'final':   označí doplatek (vyžaduje payment_split=true)
//     - 'full':    označí jednorázovou platbu (vyžaduje payment_split=false)
//
//   Vrací: { order, released? (info o uvolnění do výroby pokud proběhlo) }
//
//   TODO (Účetní iniciativa): místo manuálního označení tu bude trigger
//   z BankTransaction → Invoice → Order auto-párovače.
router.post('/orders/:id/payment', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Neplatné ID' });

    const { kind, paid } = req.body || {};
    if (!['deposit', 'final', 'full'].includes(kind)) {
      return res.status(400).json({ error: "kind musí být 'deposit' | 'final' | 'full'" });
    }
    const isPaid = paid === undefined ? true : !!paid;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (order.type !== 'sales') {
      return res.status(400).json({ error: 'Platby řešíme jen pro prodejní objednávky' });
    }

    // Validace dle režimu split
    if ((kind === 'deposit' || kind === 'final') && !order.payment_split) {
      return res.status(400).json({ error: 'Objednávka není rozdělená na zálohu + doplatek' });
    }
    if (kind === 'full' && order.payment_split) {
      return res.status(400).json({ error: "Použij 'deposit' nebo 'final' (objednávka je rozdělená)" });
    }

    const data = {};
    const now = isPaid ? new Date() : null;
    if (kind === 'deposit') {
      data.deposit_paid = isPaid;
      data.deposit_paid_at = now;
    } else if (kind === 'final') {
      data.final_paid = isPaid;
      data.final_paid_at = now;
    } else if (kind === 'full') {
      // jednorázová platba: final_paid drží celkovou částku
      data.final_paid = isPaid;
      data.final_paid_at = now;
    }

    // Auto-status: jakmile přijde záloha nebo plná platba, překlopíme na 'confirmed'
    // (zachováme 'cancelled' / 'delivered' / cokoli pokročilejšího beze změny).
    const updated = await prisma.order.update({ where: { id: orderId }, data });

    let statusChanged = null;
    if (isPaid && ['new', 'quoted', 'ordered'].includes(updated.status)) {
      const after = await prisma.order.update({
        where: { id: orderId },
        data: { status: 'confirmed' },
      });
      statusChanged = { from: updated.status, to: after.status };
    }

    // Načti znovu (s případnou aktualizací statusu) a rozhodni o uvolnění do výroby
    const fresh = await prisma.order.findUnique({ where: { id: orderId } });

    // Po zaplacení zálohy automaticky potvrď všechny rezervace slotů,
    // které patří této objednávce. Idempotentní: updateMany s reservation_status=reserved.
    let reservationsConfirmed = 0;
    if (isPaid && (kind === 'deposit' || kind === 'full')) {
      const confirmRes = await prisma.slotAssignment.updateMany({
        where: { order_id: orderId, reservation_status: 'reserved' },
        data: { reservation_status: 'confirmed', reservation_confirmed_at: new Date() },
      });
      reservationsConfirmed = confirmRes.count;
    }

    let releaseResult = null;
    if (shouldRelease(fresh)) {
      releaseResult = await releaseOrderToProduction(orderId, {
        createdById: req.user?.person_id || null,
      });
    }

    // Propsání platby doplatku na linked Invoice (pokud existuje doplatková faktura).
    // 'final' nebo 'full' v split-režimu — propis na Invoice.status='paid'/'issued'.
    let finalInvoiceUpdate = null;
    if ((kind === 'final' || kind === 'full') && fresh.final_invoice_id) {
      try {
        if (isPaid) {
          finalInvoiceUpdate = await markFinalInvoicePaid(orderId);
        } else {
          finalInvoiceUpdate = await unmarkFinalInvoicePaid(orderId);
        }
      } catch (e) {
        console.error('[orders/payment] propsání na Invoice selhalo:', e.message);
      }
    }

    res.json({
      order: fresh,
      status_changed: statusChanged,
      release: releaseResult,
      final_invoice_update: finalInvoiceUpdate,
      reservations_confirmed: reservationsConfirmed,
    });
  } catch (err) { next(err); }
});

// POST /api/wh/orders/:id/release-to-production
//   Ruční override — uvolnit do výroby i bez zaplacení (např. interní zakázka).
router.post('/orders/:id/release-to-production', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Neplatné ID' });

    const result = await releaseOrderToProduction(orderId, {
      createdById: req.user?.person_id || null,
    });
    if (!result.released && result.reason === 'order_not_found') {
      return res.status(404).json({ error: 'Objednávka nenalezena' });
    }
    if (!result.released && result.reason === 'not_a_sales_order') {
      return res.status(400).json({ error: 'Jen prodejní objednávka se rozpadá do výroby' });
    }
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/wh/orders/:id/issue-final-invoice
//   Ruční vystavení doplatkové faktury (override workeru). Vrací Invoice nebo
//   reason, proč ji nelze vystavit (např. order_not_found, already_issued).
//   body: { skipEligibilityChecks?: bool } — true = vystavit i bez zaplacené zálohy
router.post('/orders/:id/issue-final-invoice', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Neplatné ID' });

    const skipChecks = !!req.body?.skipEligibilityChecks;
    const result = await issueFinalInvoiceForOrder(orderId, {
      createdByUserId: req.user?.id || null,
      skipEligibilityChecks: skipChecks,
    });
    if (result.reason === 'order_not_found') {
      return res.status(404).json({ error: 'Objednávka nenalezena' });
    }
    if (result.reason === 'not_a_sales_order') {
      return res.status(400).json({ error: 'Jen prodejní objednávka může mít doplatkovou fakturu' });
    }
    if (result.reason === 'already_issued') {
      return res.status(409).json({ error: 'Faktura na doplatek už byla vystavena', invoice: result.invoice });
    }
    if (result.reason === 'payment_not_split') {
      return res.status(400).json({ error: 'Objednávka nemá rozdělenou platbu' });
    }
    if (result.reason === 'deposit_not_paid' && !skipChecks) {
      return res.status(400).json({ error: 'Záloha ještě nebyla zaplacena. Použij skipEligibilityChecks pro override.' });
    }
    if (result.reason === 'final_amount_zero') {
      return res.status(400).json({ error: 'Částka doplatku je 0 — není co fakturovat' });
    }
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/wh/orders/:id
router.put('/orders/:id', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id);
    const allowed = {};
    const fields = ['status', 'currency', 'note', 'expected_delivery', 'items_count', 'total_amount', 'company_id'];
    for (const f of fields) {
      if (req.body[f] !== undefined) allowed[f] = req.body[f];
    }
    if (allowed.company_id) allowed.company_id = parseInt(allowed.company_id);
    if (allowed.items_count !== undefined) allowed.items_count = parseInt(allowed.items_count) || 0;
    if (allowed.total_amount !== undefined) allowed.total_amount = parseFloat(allowed.total_amount) || 0;
    if (allowed.expected_delivery !== undefined) {
      allowed.expected_delivery = parseDate(allowed.expected_delivery);
      // Zadané datum = ruční override (neautomatizovat). Vymazané = zpět na auto z posledního slotu.
      allowed.expected_delivery_manual = !!allowed.expected_delivery;
    }

    // Při zrušení objednávky uvolni sloty
    if (allowed.status === 'cancelled') {
      const assignments = await prisma.slotAssignment.findMany({ where: { order_id: orderId } });
      const slotIds = [...new Set(assignments.map(a => a.slot_id))];
      await prisma.slotAssignment.deleteMany({ where: { order_id: orderId } });
      // Uvolni sloty, které nemají další přiřazení
      for (const sid of slotIds) {
        const remaining = await prisma.slotAssignment.count({ where: { slot_id: sid } });
        if (remaining === 0) {
          await prisma.productionSlot.update({ where: { id: sid }, data: { status: 'open' } });
        }
      }
    }

    const order = await prisma.order.update({
      where: { id: orderId },
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
    const orderId = parseInt(req.params.id);

    // Uvolni sloty přiřazené k této objednávce
    const assignments = await prisma.slotAssignment.findMany({ where: { order_id: orderId } });
    const slotIds = [...new Set(assignments.map(a => a.slot_id))];
    await prisma.slotAssignment.deleteMany({ where: { order_id: orderId } });
    // Uvolni sloty, které nemají další přiřazení
    for (const sid of slotIds) {
      const remaining = await prisma.slotAssignment.count({ where: { slot_id: sid } });
      if (remaining === 0) {
        await prisma.productionSlot.update({ where: { id: sid }, data: { status: 'open' } });
      }
    }

    await prisma.order.delete({ where: { id: orderId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POLOŽKY OBJEDNÁVEK ───────────────────────────────────────────────────

// Kapacita kamionu podle délky (verze): kolik stejných strojů se vejde na 1 kamion.
const TRUCK_CAPACITY = { L1: 4, L2: 4, L3: 3, L4: 3 };

// Automatické přepnutí ceny za kus na kamionovou, když počet stejného stroje na
// objednávce dosáhne kapacity kamionu dané délky. Sahá jen na ceny, které odpovídají
// známé maloobchodní nebo kamionové ceně z ceníku — ručně přepsané ceny nechává být.
// Nakonec přepočítá celkovou částku objednávky.
async function applyTruckPricing(orderId) {
  const oid = parseInt(orderId, 10);
  if (!oid) return;
  const order = await prisma.order.findUnique({ where: { id: oid }, select: { id: true, currency: true } });
  const items = await prisma.orderItem.findMany({ where: { order_id: oid }, orderBy: { id: 'asc' } });
  if (order && items.length) {
    const cur = order.currency === 'EUR' ? 'EUR' : 'CZK';
    const pls = await prisma.salesPricelistItem.findMany({
      where: { active: true, kind: 'machine' },
      select: { id: true, name_cs: true, name_en: true, product_id: true, model_version: true, price_czk: true, price_eur: true, truck_price_czk: true, truck_price_eur: true },
    });
    const num = (d) => (d == null ? null : Number(d));
    const matchPl = (it) => {
      if (it.product_id) { const byP = pls.find((p) => p.product_id && p.product_id === it.product_id); if (byP) return byP; }
      const nm = String(it.name || '').trim();
      return pls.find((p) => {
        const cs = (p.name_cs || '').trim(), en = (p.name_en || '').trim();
        return nm === cs || (en && nm === en) || (en && cs && nm === (en + '\n' + cs)) || (en && cs && nm === (cs + '\n' + en));
      });
    };
    const groups = new Map();   // pl.id -> count
    const itemPl = new Map();   // orderItem.id -> pl
    for (const it of items) {
      const p = matchPl(it);
      if (!p) continue;
      itemPl.set(it.id, p);
      groups.set(p.id, (groups.get(p.id) || 0) + 1);
    }
    const eps = 0.005;
    for (const it of items) {
      const p = itemPl.get(it.id);
      if (!p) continue;
      const cap = TRUCK_CAPACITY[p.model_version];
      if (!cap) continue;
      const retail = cur === 'EUR' ? num(p.price_eur) : num(p.price_czk);
      const truck = cur === 'EUR' ? num(p.truck_price_eur) : num(p.truck_price_czk);
      if (truck == null) continue; // bez kamionové ceny neřešíme
      const target = (groups.get(p.id) >= cap) ? truck : retail;
      if (target == null) continue;
      const cp = num(it.unit_price) || 0;
      const recognized = cp === 0 || (retail != null && Math.abs(cp - retail) < eps) || Math.abs(cp - truck) < eps;
      if (!recognized) continue; // ruční cena — nesahat
      if (Math.abs(cp - target) > eps) {
        const qty = Number(it.quantity) || 1;
        await prisma.orderItem.update({ where: { id: it.id }, data: { unit_price: target, total_price: qty * target } });
      }
    }
  }
  const all = await prisma.orderItem.findMany({ where: { order_id: oid } });
  const total = all.reduce((s, i) => s + Number(i.total_price || 0), 0);
  await prisma.order.update({ where: { id: oid }, data: { total_amount: total, items_count: all.length } });
}

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
    const { product_id, material_id, name, quantity, unit, unit_price, total_price, note, expected_delivery, serial_number } = req.body;
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
        expected_delivery: parseDate(expected_delivery),
        serial_number: serial_number ? String(serial_number).trim() || null : null,
      },
    });
    // Auto kamionová cena při plném kamionu + přepočet celkové částky
    await applyTruckPricing(req.params.id);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/orders/:orderId/items/:itemId
router.put('/orders/:orderId/items/:itemId', async (req, res, next) => {
  try {
    // Whitelist polí + konverze typů (nikdy nespreaduj req.body napřímo do data)
    const allowed = {};
    const stringFields = ['name', 'unit', 'note', 'serial_number'];
    const intFields = ['product_id', 'material_id'];
    const floatFields = ['quantity', 'unit_price', 'total_price', 'delivered_quantity'];
    const dateFields = ['expected_delivery'];

    for (const f of stringFields) {
      if (req.body[f] !== undefined) {
        // Prázdný string → null (aby se v DB neukládal prázdný serial "")
        const v = req.body[f];
        allowed[f] = v != null && String(v).trim() !== '' ? String(v).trim() : null;
      }
    }
    for (const f of intFields) if (req.body[f] !== undefined) allowed[f] = req.body[f] ? parseInt(req.body[f]) : null;
    for (const f of floatFields) if (req.body[f] !== undefined) allowed[f] = req.body[f] !== null && req.body[f] !== '' ? parseFloat(req.body[f]) : null;
    for (const f of dateFields) if (req.body[f] !== undefined) allowed[f] = parseDate(req.body[f]);

    const item = await prisma.orderItem.update({
      where: { id: parseInt(req.params.itemId) },
      data: allowed,
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// PUT /api/wh/orders/:orderId/items/:itemId — editace položky objednávky
router.put('/orders/:orderId/items/:itemId', async (req, res, next) => {
  try {
    const { name, quantity, unit, unit_price } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (quantity !== undefined) {
      updateData.quantity = parseFloat(quantity);
      updateData.total_price = parseFloat(quantity) * parseFloat(unit_price || req.body.unit_price || 0);
    }
    if (unit !== undefined) updateData.unit = unit;
    if (unit_price !== undefined) {
      updateData.unit_price = parseFloat(unit_price);
      updateData.total_price = parseFloat(quantity || req.body.quantity || 0) * parseFloat(unit_price);
    }

    const item = await prisma.orderItem.update({
      where: { id: parseInt(req.params.itemId) },
      data: updateData,
    });

    // Přepočítej celkovou částku objednávky
    const allItems = await prisma.orderItem.findMany({
      where: { order_id: parseInt(req.params.orderId) },
    });
    const newTotal = allItems.reduce((sum, i) => sum + parseFloat(i.total_price || 0), 0);
    await prisma.order.update({
      where: { id: parseInt(req.params.orderId) },
      data: { total_amount: newTotal, items_count: allItems.length },
    });

    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wh/orders/:orderId/items/:itemId
router.delete('/orders/:orderId/items/:itemId', async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId);
    // Uvolni sloty přiřazené k této položce
    const assignments = await prisma.slotAssignment.findMany({ where: { order_item_id: itemId } });
    const slotIds = [...new Set(assignments.map(a => a.slot_id))];
    await prisma.slotAssignment.deleteMany({ where: { order_item_id: itemId } });
    for (const sid of slotIds) {
      const remaining = await prisma.slotAssignment.count({ where: { slot_id: sid } });
      if (remaining === 0) {
        await prisma.productionSlot.update({ where: { id: sid }, data: { status: 'open' } });
      }
    }
    await prisma.orderItem.delete({ where: { id: itemId } });
    await applyTruckPricing(req.params.orderId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/orders/:orderId/items/:itemId/duplicate — naklonuje položku
// jako nový samostatný řádek včetně konfigurací (OrderItemConfig). Používá se
// když chce uživatel další kus stejného výrobku se stejnou konfigurací —
// místo zvýšení quantity (které by konfiguraci neodlišilo).
router.post('/orders/:orderId/items/:itemId/duplicate', async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const itemId = parseInt(req.params.itemId);
    const source = await prisma.orderItem.findUnique({
      where: { id: itemId },
      include: { configs: true },
    });
    if (!source) return res.status(404).json({ error: 'Položka nenalezena' });
    if (source.order_id !== orderId) return res.status(400).json({ error: 'Položka nepatří k této objednávce' });

    const clone = await prisma.orderItem.create({
      data: {
        order_id: orderId,
        product_id: source.product_id,
        material_id: source.material_id,
        name: source.name,
        quantity: 1,
        unit: source.unit,
        unit_price: source.unit_price,
        total_price: source.unit_price, // 1 × unit_price
        note: source.note,
        expected_delivery: source.expected_delivery,
        configs: source.configs.length
          ? { create: source.configs.map(c => ({ option_id: c.option_id, custom_value: c.custom_value })) }
          : undefined,
      },
      include: { configs: { include: { option: { include: { group: true } } } } },
    });

    // Auto kamionová cena při plném kamionu + přepočet celkové částky
    await applyTruckPricing(orderId);
    res.status(201).json(clone);
  } catch (err) { next(err); }
});

// DELETE /api/wh/order-items/:id — kompatibilní alias (frontend volá tuto cestu)
router.delete('/order-items/:id', async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.id);
    const oiRow = await prisma.orderItem.findUnique({ where: { id: itemId }, select: { order_id: true } });
    // Uvolni sloty přiřazené k této položce
    const assignments = await prisma.slotAssignment.findMany({ where: { order_item_id: itemId } });
    const slotIds = [...new Set(assignments.map(a => a.slot_id))];
    await prisma.slotAssignment.deleteMany({ where: { order_item_id: itemId } });
    for (const sid of slotIds) {
      const remaining = await prisma.slotAssignment.count({ where: { slot_id: sid } });
      if (remaining === 0) {
        await prisma.productionSlot.update({ where: { id: sid }, data: { status: 'open' } });
      }
    }
    await prisma.orderItem.delete({ where: { id: itemId } });
    if (oiRow) await applyTruckPricing(oiRow.order_id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/wh/orders/:id/authorize — Tomáš/Jan autorizuje podepsanou objednávku.
// Stav 'signed' → 'confirmed'; poté se zákazníkovi automaticky odešle potvrzení
// objednávky + faktura (zálohová při záloze, plná při platbě celé částky předem).
router.post('/orders/:id/authorize', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (order.status === 'confirmed') return res.json({ ok: true, already: true });
    if (order.status !== 'signed') return res.status(400).json({ error: 'Autorizovat lze jen podepsanou objednávku.' });
    // Volitelný podpis dodavatele (Jan/Tomáš) — „objednávku potvrzuji a autorizuji".
    const sig = (req.body && typeof req.body.signature === 'string' && /^data:image\//.test(req.body.signature)) ? req.body.signature.slice(0, 600000) : null;
    const place = (req.body && req.body.place) ? String(req.body.place).slice(0, 120) : null;
    await prisma.order.update({ where: { id }, data: {
      status: 'confirmed', authorized_at: new Date(),
      authorized_by_user_id: (req.user && req.user.id) || null,
      authorizer_signature_data: sig,
      authorizer_place: place,
    } });
    let _authName = null;
    try { if (req.user && req.user.id) { const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { display_name: true, username: true } }); _authName = u && (u.display_name || u.username); } } catch (e) {}
    require('../services/order-events').logOrderEvent(id, { type: 'authorized', label: 'Objednávka autorizována dodavatelem', detail: place ? ('místo: ' + place) : null, actor: _authName || 'dodavatel' });
    require('../services/order-docs').sendOrderConfirmationDocs(id).catch((e) => console.error('[order-authorize] doklady:', e && e.message));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/wh/orders/:id/history — časová osa (co se s objednávkou dělo) + související doklady.
router.get('/orders/:id/history', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });

    // Autorizující (jméno) pro popisek.
    let authorizerName = null;
    if (order.authorized_by_user_id) {
      try {
        const u = await prisma.user.findUnique({ where: { id: order.authorized_by_user_id }, select: { display_name: true, username: true } });
        if (u) authorizerName = u.display_name || u.username || null;
      } catch (e) {}
    }

    const invoices = await prisma.invoice.findMany({
      where: { order_id: id }, orderBy: { id: 'asc' },
      select: { id: true, invoice_number: true, type: true, invoice_role: true, total: true, currency: true, status: true, date_issued: true, date_due: true, paid_amount: true },
    });

    const invLabel = (inv) => (inv.invoice_role === 'deposit' || inv.type === 'proforma_issued') ? 'Zálohová faktura' : 'Faktura';

    // ── Časová osa ──
    // Primárně z logu událostí (OrderEvent); doplníme odvozené milníky, které
    // v logu nejsou (starší objednávky, platby označené ručně). Bez duplicit.
    let events = [];
    try {
      events = await prisma.orderEvent.findMany({ where: { order_id: id }, orderBy: { ts: 'asc' } });
    } catch (e) {}
    const tl = events.map((e) => ({ ts: new Date(e.ts).toISOString(), label: e.label, detail: e.detail || null, actor: e.actor || null }));
    const loggedTypes = new Set(events.map((e) => e.type));
    const derive = (cond, ts, label, detail) => { if (cond && ts) tl.push({ ts: new Date(ts).toISOString(), label, detail: detail || null, actor: null }); };
    // Odvozené doplňky jen když chybí odpovídající událost:
    derive(!loggedTypes.has('order_created'), order.created_at, 'Objednávka vytvořena', order.order_number);
    derive(!loggedTypes.has('customer_signed'), order.signed_at, 'Zákazník podepsal', order.signature_place ? ('místo: ' + order.signature_place) : null);
    derive(!loggedTypes.has('authorized'), order.authorized_at, 'Autorizováno dodavatelem', authorizerName);
    derive(!loggedTypes.has('docs_emailed'), order.customer_docs_sent_at, 'Doklady odeslány zákazníkovi', null);
    if (!loggedTypes.has('invoice_created')) invoices.forEach((inv) => derive(true, inv.date_issued, 'Vystavena ' + invLabel(inv).toLowerCase(), inv.invoice_number));
    // Platby, uvolnění, doručení, vypršení — vždy z polí (nelogují se jako událost jinde):
    derive(true, order.deposit_paid_at, 'Záloha zaplacena', null);
    derive(true, order.final_paid_at, 'Doplatek zaplacen', null);
    derive(true, order.released_at, 'Uvolněno do výroby', null);
    derive(!loggedTypes.has('expired'), order.expired_at, 'Vypršelo — sloty uvolněny', null);
    derive(true, order.delivered_at, 'Doručeno', null);
    tl.sort((a, b) => new Date(a.ts) - new Date(b.ts));

    // ── Související doklady ──
    const documents = [];
    if (['signed', 'confirmed', 'ordered', 'delivered', 'in_production'].includes(order.status) || order.confirmation_pdf_path) {
      documents.push({ kind: 'order', title: 'Potvrzená objednávka ' + order.order_number, status: order.status, url: '/api/wh/orders/' + id + '/confirmation-pdf' });
    }
    invoices.forEach((inv) => {
      documents.push({ kind: 'invoice', title: invLabel(inv) + ' ' + (inv.invoice_number || ('#' + inv.id)), status: inv.status, total: inv.total, currency: inv.currency, paid_amount: inv.paid_amount, date_due: inv.date_due, url: '/api/accounting/invoices/' + inv.id + '/pdf' });
    });

    res.json({ order_id: id, order_number: order.order_number, status: order.status, timeline: tl, documents });
  } catch (err) { next(err); }
});

// GET /api/wh/orders/:id/confirmation-pdf — PDF potvrzené objednávky (uložené, nebo vygenerované on-the-fly).
router.get('/orders/:id/confirmation-pdf', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.order.findUnique({ where: { id }, include: { company: true, items: true } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });

    const fs = require('fs');
    // Uložené PDF z data volume má přednost.
    if (order.confirmation_pdf_path && fs.existsSync(order.confirmation_pdf_path)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="Objednavka-' + order.order_number + '.pdf"');
      return fs.createReadStream(order.confirmation_pdf_path).pipe(res);
    }
    // Fallback: vygeneruj on-the-fly.
    let ourCompany = null;
    try { ourCompany = await require('../services/settings').getOurCompany(); } catch (e) {}
    const { buildAndStoreOrderPdf } = require('../services/order-docs');
    const { buffer } = await buildAndStoreOrderPdf(order, ourCompany);
    if (!buffer || !buffer.length) return res.status(500).json({ error: 'PDF se nepodařilo vygenerovat' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Objednavka-' + order.order_number + '.pdf"');
    res.end(buffer);
  } catch (err) { next(err); }
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

// --- EXCHANGE RATES (CNB denni kurzy, cache 1h) ---
// Vraci { rates: { EUR: 25.12, USD: 22.4, ... }, source: 'CNB', valid_for: '2026-04-21' }.
// Kazda sazba je normalizovana na 1 jednotku zahranicni meny -> X CZK.
let _fxRatesCache = null;
let _fxRatesCacheUntil = 0;
router.get('/exchange-rates', async (req, res, next) => {
  try {
    const now = Date.now();
    if (_fxRatesCache && now < _fxRatesCacheUntil) {
      return res.json(_fxRatesCache);
    }
    const response = await fetch('https://api.cnb.cz/cnbapi/exrates/daily?lang=CZ');
    if (!response.ok) throw new Error('CNB API nedostupne');
    const data = await response.json();
    const rates = { CZK: 1 };
    for (const r of (data.rates || [])) {
      const code = r.currencyCode;
      const amount = parseFloat(r.amount) || 1;
      const rate = parseFloat(r.rate);
      if (code && !isNaN(rate) && rate > 0) {
        rates[code] = rate / amount; // 1 jednotka -> X CZK
      }
    }
    const out = {
      rates,
      source: 'CNB',
      valid_for: (data.rates && data.rates[0] && data.rates[0].validFor) || null,
      fetched_at: new Date().toISOString(),
    };
    _fxRatesCache = out;
    _fxRatesCacheUntil = now + 60 * 60 * 1000; // 1h cache
    res.json(out);
  } catch (err) {
    // Fallback — priblizne sazby, at UI neprestane fungovat kdyz CNB spadne.
    res.json({
      rates: { CZK: 1, EUR: 25, USD: 22, GBP: 29, PLN: 6, HUF: 0.065 },
      source: 'fallback',
      valid_for: null,
      fetched_at: new Date().toISOString(),
      error: err.message,
    });
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

    // Pagination: limit 1..2000, offset >= 0. Default 200 (3× původních 100).
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 2000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Řadit podle skutečného data pohybu (factorify_moved_at) primárně, fallback created_at.
    // Faktorify import nastavuje factorify_moved_at na původní datum pohybu z Factorify;
    // u ručně vytvořených pohybů (přes UI/PWA) tohle pole zůstává null a použije se created_at.
    const movements = await prisma.inventoryMovement.findMany({
      where,
      include: {
        material: { select: { id: true, name: true, code: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
        creator: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: [
        { factorify_moved_at: { sort: 'desc', nulls: 'last' } },
        { created_at: 'desc' },
      ],
      take: limit,
      skip: offset,
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

// --- PRODEJNI CENIK ---
// Samostatne prodejni polozky (service, zbozi i vyrobky) s cenami v Kc a EUR
// bez DPH. Volitelne propojeni na Product pres product_id.

function parsePrice(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Ceník struktura: povolené hodnoty verze/varianty (prázdné = nezařazeno)
const PRICELIST_VERSIONS = ['L1', 'L2', 'L3', 'L4']; // délka
const PRICELIST_VARIANTS = ['H1', 'H2']; // výška: H1 = nižší, H2 = standard
function normModelVersion(v) {
  const s = String(v || '').trim().toUpperCase();
  return PRICELIST_VERSIONS.includes(s) ? s : null;
}
function normModelVariant(v) {
  const s = String(v || '').trim().toUpperCase();
  return PRICELIST_VARIANTS.includes(s) ? s : null;
}
// Sjednocení rozměru na tvar „písmeno+číslo" (18W18D → W18D18)
function normMachineCode(v) {
  if (!v) return null;
  let s = String(v).trim().toUpperCase().slice(0, 60);
  if (/^\d/.test(s)) s = s.replace(/(\d+)([A-Z])/g, (m, n, c) => c + n);
  return s || null;
}
// Výbava/konfigurace: pole skupin [{name,type:'single'|'multi',required,options:[{name}]}]
function normConfigOptions(v) {
  if (!Array.isArray(v)) return null;
  const groups = [];
  for (const g of v) {
    if (!g || typeof g !== 'object') continue;
    const name = String(g.name || '').trim().slice(0, 100);
    if (!name) continue;
    const type = g.type === 'multi' ? 'multi' : 'single';
    const required = !!g.required;
    const options = [];
    for (const o of (Array.isArray(g.options) ? g.options : [])) {
      const isObj = o && typeof o === 'object';
      const on = String(isObj ? o.name : o || '').trim().slice(0, 120);
      if (!on) continue;
      const pc = isObj && o.price_czk != null && o.price_czk !== '' ? Number(o.price_czk) : null;
      const pe = isObj && o.price_eur != null && o.price_eur !== '' ? Number(o.price_eur) : null;
      options.push({ name: on, price_czk: Number.isFinite(pc) ? pc : null, price_eur: Number.isFinite(pe) ? pe : null });
    }
    groups.push({ name, type, required, options });
  }
  return groups.length ? groups : null;
}
function normKind(v) {
  return String(v || '').trim().toLowerCase() === 'accessory' ? 'accessory' : 'machine';
}
function normCategory(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 80);
  return s || null;
}

// GET /api/wh/pricelist?active=true&search=...&product_id=X
router.get('/pricelist', async (req, res, next) => {
  try {
    const { search, active, product_id, kind, category } = req.query;
    const where = {};
    if (active !== undefined) where.active = active === 'true';
    if (product_id) where.product_id = parseInt(product_id, 10);
    if (kind) where.kind = String(kind);
    if (category) where.category = String(category);
    if (search) {
      where.OR = [
        { name_cs: { contains: search, mode: 'insensitive' } },
        { name_en: { contains: search, mode: 'insensitive' } },
        { machine_code: { contains: search, mode: 'insensitive' } },
      ];
    }
    const items = await prisma.salesPricelistItem.findMany({
      where,
      include: {
        product: { select: { id: true, code: true, name: true, type: true } },
      },
      orderBy: [{ active: 'desc' }, { name_cs: 'asc' }],
    });
    res.json(items);
  } catch (err) { next(err); }
});

// GET /api/wh/pricelist/:id
router.get('/pricelist/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = await prisma.salesPricelistItem.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, code: true, name: true, type: true } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Polozka ceniku nenalezena' });
    res.json(item);
  } catch (err) { next(err); }
});

// POST /api/wh/pricelist
router.post('/pricelist', async (req, res, next) => {
  try {
    const { name_cs, name_en, price_czk, price_eur, truck_price_czk, truck_price_eur, truck_capacity, model_version, model_variant, machine_code, config_options, kind, category, product_id, note, active } = req.body || {};
    if (!name_cs || !String(name_cs).trim()) {
      return res.status(400).json({ error: 'Povinny je cesky nazev (name_cs).' });
    }
    // product_id je volitelny — frontend vizualne upozorni pokud chybi
    const created = await prisma.salesPricelistItem.create({
      data: {
        name_cs: String(name_cs).trim(),
        name_en: name_en ? String(name_en).trim() : null,
        price_czk: parsePrice(price_czk),
        price_eur: parsePrice(price_eur),
        truck_price_czk: parsePrice(truck_price_czk),
        truck_price_eur: parsePrice(truck_price_eur),
        truck_capacity: (truck_capacity === undefined || truck_capacity === null || truck_capacity === '') ? null : (parseInt(truck_capacity, 10) || null),
        model_version: normModelVersion(model_version),
        model_variant: normModelVariant(model_variant),
        machine_code: normMachineCode(machine_code),
        config_options: normConfigOptions(config_options),
        kind: normKind(kind),
        category: normCategory(category),
        product_id: product_id ? parseInt(product_id, 10) : null,
        note: note || null,
        active: active === undefined ? true : !!active,
      },
      include: {
        product: { select: { id: true, code: true, name: true, type: true } },
      },
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/wh/pricelist/:id
router.put('/pricelist/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name_cs, name_en, price_czk, price_eur, truck_price_czk, truck_price_eur, truck_capacity, model_version, model_variant, machine_code, config_options, kind, category, product_id, note, active } = req.body || {};
    const data = {};
    if (name_cs !== undefined) data.name_cs = String(name_cs).trim();
    if (name_en !== undefined) data.name_en = name_en ? String(name_en).trim() : null;
    if (price_czk !== undefined) data.price_czk = parsePrice(price_czk);
    if (price_eur !== undefined) data.price_eur = parsePrice(price_eur);
    if (truck_price_czk !== undefined) data.truck_price_czk = parsePrice(truck_price_czk);
    if (truck_price_eur !== undefined) data.truck_price_eur = parsePrice(truck_price_eur);
    if (truck_capacity !== undefined) data.truck_capacity = (truck_capacity === null || truck_capacity === '') ? null : (parseInt(truck_capacity, 10) || null);
    if (model_version !== undefined) data.model_version = normModelVersion(model_version);
    if (model_variant !== undefined) data.model_variant = normModelVariant(model_variant);
    if (machine_code !== undefined) data.machine_code = normMachineCode(machine_code);
    if (config_options !== undefined) data.config_options = normConfigOptions(config_options);
    if (kind !== undefined) data.kind = normKind(kind);
    if (category !== undefined) data.category = normCategory(category);
    if (product_id !== undefined) data.product_id = product_id ? parseInt(product_id, 10) : null;
    if (note !== undefined) data.note = note || null;
    if (active !== undefined) data.active = !!active;
    const updated = await prisma.salesPricelistItem.update({
      where: { id },
      data,
      include: {
        product: { select: { id: true, code: true, name: true, type: true } },
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/wh/pricelist/:id
router.delete('/pricelist/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.salesPricelistItem.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Společná (výchozí) výbava/konfigurace pro všechny položky ceníku — uložená
// v AppSetting. Položky bez vlastní výbavy dědí tuhle společnou.
const PRICELIST_DEFAULT_CONFIG_KEY = 'sales.pricelist_default_config';

// GET /api/wh/pricelist-config-default
router.get('/pricelist-config-default', async (req, res, next) => {
  try {
    const s = await prisma.appSetting.findUnique({ where: { key: PRICELIST_DEFAULT_CONFIG_KEY } });
    let arr = [];
    if (s && s.value) { try { arr = JSON.parse(s.value); } catch (_) { arr = []; } }
    res.json({ config_options: Array.isArray(arr) ? arr : [] });
  } catch (err) { next(err); }
});

// PUT /api/wh/pricelist-config-default { config_options: [...] }
router.put('/pricelist-config-default', async (req, res, next) => {
  try {
    const groups = normConfigOptions((req.body || {}).config_options) || [];
    const value = JSON.stringify(groups);
    await prisma.appSetting.upsert({
      where: { key: PRICELIST_DEFAULT_CONFIG_KEY },
      create: { key: PRICELIST_DEFAULT_CONFIG_KEY, value, value_type: 'json', scope: 'sales', description: 'Společná výbava/konfigurace pro položky ceníku' },
      update: { value, value_type: 'json' },
    });
    res.json({ config_options: groups });
  } catch (err) { next(err); }
});

// ─── DODACÍ LIST ─────────────────────────────────────────────────────────────
// POST /api/wh/orders/:id/delivery-note — vytvoří dodací list z položek objednávky
router.post('/orders/:id/delivery-note', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.order.findUnique({ where: { id }, include: { items: true, company: true } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    const year = new Date().getFullYear();
    const pfx = 'DL-' + year + '-';
    const last = await prisma.deliveryNote.findFirst({ where: { number: { startsWith: pfx } }, orderBy: { number: 'desc' }, select: { number: true } });
    let seq = 1;
    if (last) { const m = last.number.match(/(\d+)$/); if (m) seq = parseInt(m[1], 10) + 1; }
    const number = pfx + String(seq).padStart(5, '0');
    const items = (order.items || []).map(function (it) {
      return { name: it.name, quantity: Number(it.quantity) || 1, unit: it.unit || 'ks', serial_number: it.serial_number || null };
    });
    const dn = await prisma.deliveryNote.create({
      data: {
        number, order_id: order.id, company_id: order.company_id || null,
        customer_name: order.company ? order.company.name : null,
        items, note: (req.body && req.body.note) ? String(req.body.note).slice(0, 2000) : null,
        created_by_user_id: (req.user && req.user.id) || null,
      },
    });
    res.status(201).json({ id: dn.id, number: dn.number });
  } catch (err) { next(err); }
});

// GET /api/wh/delivery-notes/:id/pdf — PDF dodacího listu
router.get('/delivery-notes/:id/pdf', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const dn = await prisma.deliveryNote.findUnique({ where: { id } });
    if (!dn) return res.status(404).json({ error: 'Dodací list nenalezen' });
    let orderNumber = null;
    if (dn.order_id) { const o = await prisma.order.findUnique({ where: { id: dn.order_id }, select: { order_number: true } }); orderNumber = o && o.order_number; }
    const { generateDeliveryNotePdf } = require('../services/pdf/delivery-note-pdf');
    const buf = await generateDeliveryNotePdf(
      { number: dn.number, date_issued: dn.date_issued, customer_name: dn.customer_name, order_number: orderNumber, note: dn.note, items: dn.items },
      { name: 'Best Series s.r.o.', ico: process.env.BEST_SERIES_ICO || '05643724', dic: process.env.BEST_SERIES_DIC || '' }
    );
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="' + dn.number + '.pdf"');
    res.send(buf);
  } catch (err) { next(err); }
});

module.exports = router;
