// =============================================================================
// HolyOS — Plochý BOM ze stromu Product → Operations → Materials (rekurzivně)
// =============================================================================
// Vrací jak ploché indexy (pro lookup podle code/factorify_id), tak položky
// pro porovnání proti Factorify BOM stromu.
// =============================================================================

/**
 * Z Product stromu (s recursively enriched operations[].materials[].linked_product)
 * vyrobí plochý seznam BOM položek + indexy pro lookup.
 *
 * @param {Object} rootProduct — Product s `operations` (a u materiálů `linked_product`)
 * @returns {Object} {
 *   items: Array<{code, name, quantity, unit, type, material_id, factorify_id, path, depth}>,
 *   byCode: Map<lowercaseCode, item>,
 *   byFactorifyId: Map<string, item>,
 * }
 */
function flattenHolyOsBom(rootProduct) {
  const items = [];
  const byCode = new Map();
  const byFactorifyId = new Map();

  function visit(product, path, depth) {
    if (!product || !product.operations) return;
    for (const op of product.operations) {
      if (!op.materials) continue;
      for (const om of op.materials) {
        const mat = om.material;
        if (!mat) continue;

        const item = {
          code: mat.code || '',
          name: mat.name || '',
          quantity: Number(om.quantity) || 0,
          unit: om.unit || mat.unit || '',
          type: mat.type || '',
          material_id: mat.id,
          factorify_id: mat.factorify_id ? String(mat.factorify_id) : null,
          via_operation: op.name,
          path: path,
          depth: depth,
        };
        items.push(item);

        if (item.code) {
          const k = item.code.toLowerCase();
          // První výskyt vyhrává (nebo můžeme agregovat — zatím necháme první)
          if (!byCode.has(k)) byCode.set(k, item);
          else {
            // Pokud už existuje, sečti množství (různé operace užívají stejný materiál)
            const existing = byCode.get(k);
            existing.quantity = (existing.quantity || 0) + item.quantity;
          }
        }
        if (item.factorify_id && !byFactorifyId.has(item.factorify_id)) {
          byFactorifyId.set(item.factorify_id, item);
        }

        // Rekurze do polotovaru
        if (om.linked_product) {
          const childPath = path ? `${path} / ${item.code || item.name}` : (item.code || item.name);
          visit(om.linked_product, childPath, depth + 1);
        }
      }
    }
  }

  // Root: i samotný produkt může mít factorify_id (pro match s kořenem stromu)
  if (rootProduct) {
    if (rootProduct.factorify_id != null) {
      byFactorifyId.set(String(rootProduct.factorify_id), {
        code: rootProduct.code || '',
        name: rootProduct.name || '',
        quantity: 1,
        unit: 'ks',
        type: 'product',
        product_id: rootProduct.id,
        factorify_id: String(rootProduct.factorify_id),
        path: '',
        depth: 0,
      });
    }
    if (rootProduct.code) byCode.set(rootProduct.code.toLowerCase(), {
      code: rootProduct.code, name: rootProduct.name, product_id: rootProduct.id, depth: 0, path: '',
    });
  }

  visit(rootProduct, '', 1);
  return { items, byCode, byFactorifyId };
}

/**
 * Spočítá množstevní toleranci. Pro malé hodnoty absolutní práh, pro velké relativní.
 */
function quantitiesMatch(a, b) {
  if (a == null && b == null) return true;
  const aN = Number(a) || 0;
  const bN = Number(b) || 0;
  if (aN === 0 && bN === 0) return true;
  const diff = Math.abs(aN - bN);
  if (diff < 0.001) return true;
  const rel = diff / Math.max(Math.abs(aN), Math.abs(bN));
  return rel < 0.01; // 1% tolerance
}

module.exports = { flattenHolyOsBom, quantitiesMatch };
