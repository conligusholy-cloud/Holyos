// HolyOS — Barva dílů výrobku: detekce dílů s barevnými variantami + záměna za variantu zvolené barvy.
//
// Barevná varianta dílu = samostatná skladová karta s příponou barvy (NA0034 → NA0034-cervena),
// parent_material_id → základní díl. V pracovním postupu je díl jako ZÁKLAD (bez přípony); barva se volí
// až u dávky (ProductionBatch.part_color) a všechny výpočty materiálu (MRP, vychystání, úkoly, stav)
// pro tu dávku díly zamění za variantu dané barvy. Díl, který danou barvu nemá, zůstane beze změny.
const { prisma } = require('../../config/database');

// Klíč barvy pro porovnání („Červená" = „cervena")
function colorKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Barevné díly výrobku a nabídka barev.
 * @returns {{ colors: Array<{name,key,color,count,missing}>, parts: Array<{material_id, code, name, base_id, base_code, operations:string[], variants: Object<key,{id,code,name,color_name,color}>}> }}
 */
async function productPartColors(productId, tx = prisma) {
  const ops = await tx.productOperation.findMany({
    where: { product_id: Number(productId) },
    select: { id: true, step_number: true, name: true, materials: { select: { material_id: true } } },
  });
  const matOps = new Map();
  ops.forEach((o) => (o.materials || []).forEach((m) => {
    if (!matOps.has(m.material_id)) matOps.set(m.material_id, new Set());
    matOps.get(m.material_id).add((o.step_number != null ? o.step_number + '. ' : '') + o.name);
  }));
  const ids = [...matOps.keys()];
  if (!ids.length) return { colors: [], parts: [] };
  const mats = await tx.material.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true, parent_material_id: true, color_name: true },
  });
  // základ = parent (je-li díl sám variantou), jinak díl
  const baseIds = [...new Set(mats.map((m) => m.parent_material_id || m.id))];
  const bases = await tx.material.findMany({
    where: { id: { in: baseIds } },
    select: { id: true, code: true, name: true, color_variants: { where: { status: 'active' }, select: { id: true, code: true, name: true, color_name: true, color: true } } },
  });
  const baseById = new Map(bases.map((b) => [b.id, b]));
  const parts = [];
  for (const m of mats) {
    const b = baseById.get(m.parent_material_id || m.id);
    if (!b || !b.color_variants.length) continue;
    const variants = {};
    b.color_variants.forEach((v) => { const k = colorKey(v.color_name); if (k) variants[k] = v; });
    parts.push({ material_id: m.id, code: m.code, name: m.name, current_color: m.parent_material_id ? m.color_name : null, base_id: b.id, base_code: b.code, base_name: b.name, operations: [...(matOps.get(m.id) || [])], variants });
  }
  const colorMap = new Map();
  parts.forEach((p) => Object.entries(p.variants).forEach(([k, v]) => {
    const c = colorMap.get(k) || { key: k, name: v.color_name, color: v.color || null, count: 0 };
    c.count++; if (!c.color && v.color) c.color = v.color; colorMap.set(k, c);
  }));
  const colors = [...colorMap.values()].map((c) => ({ ...c, missing: parts.length - c.count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'cs'));
  return { colors, parts };
}

/**
 * Mapa záměny pro zvolenou barvu: material_id (základ i jiná barva) → varianta zvolené barvy.
 * Prázdná mapa, když barva není zvolená.
 */
async function colorSwapMap(materialIds, colorName, tx = prisma) {
  const key = colorKey(colorName);
  const out = new Map();
  const ids = [...new Set((materialIds || []).map(Number).filter(Boolean))];
  if (!key || !ids.length) return out;
  const mats = await tx.material.findMany({ where: { id: { in: ids } }, select: { id: true, parent_material_id: true } });
  const baseIds = [...new Set(mats.map((m) => m.parent_material_id || m.id))];
  const vars = await tx.material.findMany({
    where: { parent_material_id: { in: baseIds }, status: 'active' },
    select: { id: true, code: true, name: true, unit: true, parent_material_id: true, color_name: true },
  });
  const byBase = new Map();
  vars.forEach((v) => { if (colorKey(v.color_name) === key) byBase.set(v.parent_material_id, v); });
  mats.forEach((m) => { const v = byBase.get(m.parent_material_id || m.id); if (v && v.id !== m.id) out.set(m.id, v); });
  return out;
}

/** Vrátí id materiálu po záměně (nebo původní). */
function swapId(map, id) { const v = map && map.get(Number(id)); return v ? v.id : id; }

/** Záměna v poli řádků s material_id (+ volitelně vnořený objekt material). Vrací nové pole. */
function applySwap(rows, map) {
  if (!map || !map.size) return rows;
  return (rows || []).map((r) => {
    const v = map.get(Number(r.material_id));
    if (!v) return r;
    const n = { ...r, material_id: v.id, _color_swapped_from: r.material_id };
    if (r.material) n.material = { ...r.material, id: v.id, code: v.code, name: v.name };
    return n;
  });
}

/** Mapa záměny pro dávku (podle part_color) nad danými materiály. */
async function batchSwapMap(batch, materialIds, tx = prisma) {
  if (!batch || !batch.part_color) return new Map();
  return colorSwapMap(materialIds, batch.part_color, tx);
}

module.exports = { colorKey, productPartColors, colorSwapMap, swapId, applySwap, batchSwapMap };
