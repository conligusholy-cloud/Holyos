// =============================================================================
// HolyOS — Plánovač: BOM z Factorify (wrapper pro snapshot)
// =============================================================================
//
// Volá Tomášův services/factorify-bom.js → buildBomTree, ploský strom na
// list materiálových listů a mapuje factorify_id → HolyOS Material.id, aby
// výstup byl kompatibilní s BomSnapshotItem schemou.
//
// Strom z Factorify obsahuje:
//   - PRODUCT/SEMI_PRODUCT uzly (mají children)
//   - MATERIAL listy (children: [])
//   - PRODUCT bez Factorify BOM → fallback na HolyOS OperationMaterial
//     (vrátí children s `source: 'holyos_ops'` nebo `'holyos_ops_no_fid'`)
//
// Pro snapshot bereme jen LISTY (uzly s prázdnými children) — to jsou skutečné
// materiály ke spotřebě. Polotovary (sub-products s vlastním BOM) se rozpadnou
// do svých listů, takže se jejich materiály agregují do jednoho seznamu.

const { buildBomTree } = require('../factorify-bom');

/**
 * Pro daný Product zavolá Factorify BOM → vrátí pole BomSnapshotItem-kompatibilních
 * záznamů { material_id, quantity, unit, depth, source_operation_id? } + diagnostiku.
 *
 * @param {object} product   Prisma Product objekt s factorify_id
 * @param {object} prisma    Prisma client (předá se buildBomTree pro fallback)
 * @returns {{ items, stats, warnings }}
 */
async function buildBomItemsFromFactorify(product, prisma) {
  if (!product) throw new Error('product je povinný');
  if (!product.factorify_id) {
    throw new Error(`Product id=${product.id} (${product.code}) nemá factorify_id — nelze pull z Factorify`);
  }

  // 1) Postav strom přes Tomášův builder
  const tree = await buildBomTree(product.factorify_id, prisma);

  // 2) Plochi na listy s aggregovaným qty per (factorify_id, code)
  //    Polotovary se neukládají — jen finální spotřebovaný materiál.
  //    Pokud jeden materiál figuruje ve víc cestách, qty se sčítá.
  const aggregated = new Map(); // key: factorify_id || ('CODE:' + code) → { material info, qty, depth (min) }
  const warnings = [];

  function walk(node, depth, parentQty) {
    // Skip root sám sebe
    const effectiveQty = (parentQty || 1) * (Number(node.quantity) || 1);

    if (depth > 0 && (!node.children || node.children.length === 0)) {
      // LEAF — to je materiál ke spotřebě
      const key = node.factorify_id ? String(node.factorify_id) : `CODE:${node.code || ''}`;
      const cur = aggregated.get(key) || {
        factorify_id: node.factorify_id,
        code: node.code,
        name: node.name,
        type: node.type,
        unit: node.unit,
        depth, // hloubka první výskytu (mělčí = silnější vazba)
        quantity: 0,
        source: node.source || null,
        viaOperation: node.viaOperation || null,
      };
      cur.quantity += effectiveQty;
      cur.depth = Math.min(cur.depth, depth);
      aggregated.set(key, cur);
      return;
    }

    // Vnitřní uzel — rekurze, qty propaguje
    for (const child of (node.children || [])) {
      walk(child, depth + 1, effectiveQty);
    }
  }
  walk(tree, 0, 1);

  // 3) Mapuj na HolyOS Material — primárně podle factorify_id, sekundárně code
  const fids = Array.from(aggregated.values())
    .filter(it => it.factorify_id)
    .map(it => String(it.factorify_id));
  const codes = Array.from(aggregated.values())
    .filter(it => !it.factorify_id && it.code)
    .map(it => it.code);

  const [byFid, byCode] = await Promise.all([
    fids.length > 0
      ? prisma.material.findMany({
          where: { factorify_id: { in: fids } },
          select: { id: true, factorify_id: true, code: true, name: true, unit: true },
        })
      : [],
    codes.length > 0
      ? prisma.material.findMany({
          where: { code: { in: codes } },
          select: { id: true, factorify_id: true, code: true, name: true, unit: true },
        })
      : [],
  ]);
  const fidMap = new Map(byFid.map(m => [m.factorify_id, m]));
  const codeMap = new Map(byCode.map(m => [m.code, m]));

  // 4) Sestav BomSnapshotItem-kompatibilní pole + diagnostiku
  const items = [];
  for (const v of aggregated.values()) {
    let mat = null;
    if (v.factorify_id) mat = fidMap.get(String(v.factorify_id));
    if (!mat && v.code) mat = codeMap.get(v.code);

    if (!mat) {
      warnings.push({
        reason: 'material_not_in_holyos',
        factorify_id: v.factorify_id,
        code: v.code,
        name: v.name,
        quantity: v.quantity,
      });
      continue;
    }

    items.push({
      material_id: mat.id,
      quantity: +Number(v.quantity).toFixed(4),
      unit: v.unit || mat.unit || 'ks',
      depth: v.depth,
      // source_operation_id zatím nemáme z Factorify stromu (operation reference je hluboko)
      source_operation_id: null,
    });
  }

  return {
    items,
    stats: {
      tree_unique_goods: tree?.stats?.uniqueGoods ?? null,
      tree_expand_calls: tree?.stats?.expandCalls ?? null,
      tree_memo_hits: tree?.stats?.memoHits ?? null,
      tree_db_calls: tree?.stats?.dbCalls ?? null,
      tree_ms: tree?.stats?.totalMs ?? null,
      aggregated_leaves: aggregated.size,
      mapped_to_holyos: items.length,
      missing_in_holyos: warnings.length,
    },
    warnings,
  };
}

module.exports = { buildBomItemsFromFactorify };
