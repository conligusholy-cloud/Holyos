// HolyOS — Validace matematiky faktury
// Kontroluje, že:
//  - součet položek == subtotal (bez DPH)
//  - subtotal + vat_amount == total
//  - každá položka quantity * unit_price ≈ subtotal položky

const EPSILON = 0.02; // 2 haléře tolerance (zaokrouhlení)

/**
 * @param {object} invoice - { subtotal, vat_amount, total }
 * @param {array} items - [{ quantity, unit_price, vat_rate, subtotal, vat_amount, total }]
 * @returns { ok: bool, confidence: 0-1, issues: [...] }
 */
function validateInvoiceMath(invoice, items = []) {
  const issues = [];
  let score = 1;

  const invSubtotal = Number(invoice.subtotal);
  const invVat = Number(invoice.vat_amount);
  const invTotal = Number(invoice.total);

  // 1) subtotal + vat_amount == total
  const sumHeader = invSubtotal + invVat;
  if (Math.abs(sumHeader - invTotal) > EPSILON) {
    issues.push({
      field: 'header_total',
      message: `Hlavička: subtotal (${invSubtotal}) + DPH (${invVat}) = ${sumHeader.toFixed(2)}, ale total je ${invTotal}`,
    });
    score -= 0.4;
  }

  if (items.length === 0) {
    return { ok: issues.length === 0, confidence: Math.max(0, score), issues };
  }

  // 2) Součet řádků == hlavička
  const sumItemsSubtotal = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
  const sumItemsVat = items.reduce((s, it) => s + Number(it.vat_amount || 0), 0);
  const sumItemsTotal = items.reduce((s, it) => s + Number(it.total || 0), 0);

  if (Math.abs(sumItemsSubtotal - invSubtotal) > EPSILON) {
    issues.push({
      field: 'items_subtotal',
      message: `Součet řádků bez DPH: ${sumItemsSubtotal.toFixed(2)}, ale hlavička: ${invSubtotal}`,
    });
    score -= 0.3;
  }
  if (Math.abs(sumItemsVat - invVat) > EPSILON) {
    issues.push({
      field: 'items_vat',
      message: `Součet DPH řádků: ${sumItemsVat.toFixed(2)}, ale hlavička: ${invVat}`,
    });
    score -= 0.2;
  }
  if (Math.abs(sumItemsTotal - invTotal) > EPSILON) {
    issues.push({
      field: 'items_total',
      message: `Součet celkem řádků: ${sumItemsTotal.toFixed(2)}, ale hlavička: ${invTotal}`,
    });
    score -= 0.3;
  }

  // 3) Per-řádek: qty * unit_price ≈ subtotal, subtotal * vat_rate ≈ vat_amount
  items.forEach((it, idx) => {
    const expectedSubtotal = Number(it.quantity) * Number(it.unit_price);
    if (Math.abs(expectedSubtotal - Number(it.subtotal)) > EPSILON) {
      issues.push({
        field: `item_${idx}_subtotal`,
        message: `Řádek #${idx + 1}: qty (${it.quantity}) × j.cena (${it.unit_price}) = ${expectedSubtotal.toFixed(2)}, ale subtotal: ${it.subtotal}`,
      });
      score -= 0.05;
    }
    const expectedVat = Number(it.subtotal) * Number(it.vat_rate) / 100;
    if (Math.abs(expectedVat - Number(it.vat_amount)) > EPSILON) {
      issues.push({
        field: `item_${idx}_vat`,
        message: `Řádek #${idx + 1}: subtotal × DPH% = ${expectedVat.toFixed(2)}, ale vat_amount: ${it.vat_amount}`,
      });
      score -= 0.05;
    }
  });

  return {
    ok: issues.length === 0,
    confidence: Math.max(0, score),
    issues,
  };
}

module.exports = { validateInvoiceMath };
