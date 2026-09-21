// =============================================================================
// HolyOS — Doplatková faktura (auto-vystavení N dní před zahájením výroby)
// =============================================================================
//
// Workflow:
//   1) Tomáš nastaví objednávce 'Rozdělenou platbu' a výši zálohy
//   2) Zákazník zaplatí zálohu → Order.deposit_paid=true → výroba uvolněna
//   3) Worker denně kontroluje: pokud production_start_first ≤ today + lead_days
//      a Order ještě nemá final_invoice_id, vystaví doplatkovou Invoice
//   4) Po platbě doplatku Tomáš klikne 'Doplatek přišel' → propíše se na Invoice
//
// Funkce je idempotentní — když už final_invoice_id existuje, vrací stávající.

const { prisma: defaultPrisma } = require('../../config/database');
const { generateInvoiceNumber } = require('../accountant/invoice-numbering');
const { getDefaultInvoiceDueDays, getOurCompany } = require('../settings');

/**
 * Vypočítá výši zálohy z deposit_amount / deposit_percent (stejná logika jako frontend).
 */
function computeDepositValue(order) {
  const total = parseFloat(order.total_amount || 0);
  if (order.deposit_amount != null) {
    return parseFloat(order.deposit_amount.toString());
  }
  if (order.deposit_percent != null) {
    return Math.round((total * parseInt(order.deposit_percent, 10) / 100) * 100) / 100;
  }
  return 0;
}

/**
 * Spočítá nejranější start výroby pro objednávku — z přiřazených slotů.
 * Vrací Date nebo null (pokud žádný slot není přiřazen).
 */
async function getEarliestProductionStart(orderId, db) {
  const assignments = await db.slotAssignment.findMany({
    where: { order_item: { order_id: orderId } },
    include: { slot: { select: { start_date: true } } },
  });
  let earliest = null;
  for (const a of assignments) {
    const s = a.slot?.start_date;
    if (s && (!earliest || s < earliest)) earliest = s;
  }
  return earliest;
}

/**
 * Vystaví doplatkovou Invoice pro Order.
 * Idempotentní: pokud už final_invoice_id existuje, vrací stávající.
 *
 * @param {number} orderId
 * @param {object} [opts]
 * @param {number} [opts.createdByUserId] User.id pro audit
 * @param {object} [opts.prisma]
 * @param {boolean} [opts.skipEligibilityChecks] Přeskočí kontroly (manual override)
 * @returns {Promise<{ created: boolean, reason?: string, invoice?: object }>}
 */
async function issueFinalInvoiceForOrder(orderId, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const id = parseInt(orderId, 10);
  if (isNaN(id)) throw new Error('Neplatné orderId');

  const order = await db.order.findUnique({
    where: { id },
    include: {
      company: true,
      items: { select: { id: true, name: true, quantity: true, unit_price: true } },
    },
  });
  if (!order) return { created: false, reason: 'order_not_found' };
  if (order.type !== 'sales') return { created: false, reason: 'not_a_sales_order' };

  // Idempotence — už vystaveno
  if (order.final_invoice_id) {
    const existing = await db.invoice.findUnique({ where: { id: order.final_invoice_id } });
    return { created: false, reason: 'already_issued', invoice: existing };
  }

  if (!opts.skipEligibilityChecks) {
    if (!order.payment_split) return { created: false, reason: 'payment_not_split' };
    if (!order.deposit_paid) return { created: false, reason: 'deposit_not_paid' };
  }

  const total = parseFloat(order.total_amount || 0);
  if (total <= 0) return { created: false, reason: 'order_total_zero' };

  // §20–22: finální faktura automaticky odečte VŠECHNY daňové doklady k přijatým
  // platbám (DPPP, type='tax_receipt') této objednávky.
  const dppps = await db.invoice.findMany({
    where: { order_id: order.id, type: 'tax_receipt' },
    select: { id: true, invoice_number: true, total: true, subtotal: true, vat_amount: true, date_taxable: true },
    orderBy: { id: 'asc' },
  });
  let deducted = dppps.reduce((s, d) => s + Number(d.total), 0);
  // Fallback pro starší objednávky bez DPPP: odečti evidovanou zálohu, ať nedojde
  // k dvojímu naúčtování už zaplacené zálohy.
  if (deducted === 0 && order.deposit_paid) {
    const legacy = computeDepositValue(order);
    if (legacy > 0) deducted = legacy;
  }
  deducted = Math.round(deducted * 100) / 100;
  const finalAmount = Math.max(0, Math.round((total - deducted) * 100) / 100);

  // DPH režim: CZK = standard 21 %, cizí měna = reverse charge 0 % (jako u zálohových).
  const isForeign = (order.currency || 'CZK') !== 'CZK';
  const rate = isForeign ? 0 : 21;
  const vatRegime = isForeign ? 'reverse_charge' : 'standard';
  const splitGross = (gross) => {
    const sub = rate > 0 ? +(gross / (1 + rate / 100)).toFixed(2) : +Number(gross).toFixed(2);
    const vat = +(Number(gross) - sub).toFixed(2);
    return { sub, vat };
  };

  // Generuj číslo + datumy
  const invoiceNumber = await generateInvoiceNumber('issued', { prisma: db });
  const dueDays = await getDefaultInvoiceDueDays().catch(() => 14);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(today.getTime() + dueDays * 86400000);
  const vs = invoiceNumber.replace(/\D/g, '').slice(-10);

  // Řádky: 1) celkové plnění, 2..n) odečty zaplacených záloh (dle DPPP).
  const plneni = splitGross(total);
  const items = [{
    line_order: 1,
    description: `Celkové plnění — prodejní objednávka ${order.order_number}`,
    quantity: 1, unit: 'ks', unit_price: total, vat_rate: rate,
    subtotal: plneni.sub, vat_amount: plneni.vat, total: total,
  }];
  let dedSub = 0, dedVat = 0, li = 2;
  for (const d of dppps) {
    const dt = Number(d.total);
    const s = Number(d.subtotal);
    const v = Number(d.vat_amount);
    dedSub += s; dedVat += v;
    items.push({
      line_order: li++,
      description: `Odečet zaplacené zálohy dle ${d.invoice_number}` +
        (d.date_taxable ? ` ze dne ${new Date(d.date_taxable).toLocaleDateString('cs-CZ')}` : ''),
      quantity: 1, unit: 'ks', unit_price: -dt, vat_rate: rate,
      subtotal: -s, vat_amount: -v, total: -dt,
    });
  }
  if (!dppps.length && deducted > 0) {
    const sp = splitGross(deducted);
    dedSub += sp.sub; dedVat += sp.vat;
    items.push({
      line_order: li++,
      description: 'Odečet zaplacené zálohy',
      quantity: 1, unit: 'ks', unit_price: -deducted, vat_rate: rate,
      subtotal: -sp.sub, vat_amount: -sp.vat, total: -deducted,
    });
  }
  const invSubtotal = +(plneni.sub - dedSub).toFixed(2);
  const invVat = +(plneni.vat - dedVat).toFixed(2);
  const invTotal = finalAmount;

  const invoice = await db.invoice.create({
    data: {
      invoice_number: invoiceNumber,
      type: 'issued',
      direction: 'ar',
      company_id: order.company_id,
      order_id: order.id,
      currency: order.currency || 'CZK',
      exchange_rate: 1,
      subtotal: invSubtotal.toFixed(2),
      vat_amount: invVat.toFixed(2),
      total: invTotal.toFixed(2),
      vat_regime: vatRegime,
      date_issued: today,
      date_taxable: today,
      date_due: due,
      payment_method: 'bank_transfer',
      variable_symbol: vs,
      status: 'issued',
      source: 'auto_final_invoice',
      invoice_role: 'final',
      note: deducted > 0
        ? `Konečné vyúčtování. Započtené zálohy: ${deducted.toLocaleString('cs-CZ')} ${order.currency || 'CZK'}. K úhradě: ${invTotal.toLocaleString('cs-CZ')} ${order.currency || 'CZK'}.`
        : null,
      created_by_user_id: opts.createdByUserId || null,
      items: { create: items },
    },
    include: { items: true, company: true },
  });

  // Naváž zpět na Order
  await db.order.update({
    where: { id: order.id },
    data: { final_invoice_id: invoice.id },
  });

  return { created: true, invoice };
}

/**
 * Vrátí seznam objednávek, na které má worker vystavit doplatkovou fakturu.
 * Pravidla:
 *   - type='sales'
 *   - payment_split=true, deposit_paid=true, final_paid=false
 *   - final_invoice_id IS NULL
 *   - production_start_first ≤ today + final_invoice_lead_days
 *     (production_start_first = nejranější start_date přiřazeného slotu)
 *
 * Pozn.: Když objednávka nemá přiřazený slot (production_start_first=null),
 * neeskaluje — čeká, dokud Tomáš sloty nepřiřadí.
 */
async function getOrdersEligibleForFinalInvoice(opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const now = opts.now || new Date();

  const candidates = await db.order.findMany({
    where: {
      type: 'sales',
      payment_split: true,
      deposit_paid: true,
      final_paid: false,
      final_invoice_id: null,
    },
    select: {
      id: true,
      order_number: true,
      final_invoice_lead_days: true,
      items: {
        select: { id: true },
      },
    },
  });

  const eligible = [];
  for (const o of candidates) {
    const itemIds = o.items.map(it => it.id);
    if (itemIds.length === 0) continue;
    const assignments = await db.slotAssignment.findMany({
      where: { order_item_id: { in: itemIds } },
      include: { slot: { select: { start_date: true } } },
    });
    let earliest = null;
    for (const a of assignments) {
      const s = a.slot?.start_date;
      if (s && (!earliest || s < earliest)) earliest = s;
    }
    if (!earliest) continue; // nemá sloty, nelze určit kdy začne výroba
    const leadDays = o.final_invoice_lead_days || 14;
    const threshold = new Date(now.getTime() + leadDays * 86400000);
    if (earliest <= threshold) {
      eligible.push({ order_id: o.id, order_number: o.order_number, production_start_first: earliest });
    }
  }

  return eligible;
}

/**
 * Když Tomáš v UI označí, že přišel doplatek, propíše se na Invoice (status=paid).
 * Spouští se z routes/warehouse.routes.js v POST /payment kind='final'.
 */
async function markFinalInvoicePaid(orderId, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const order = await db.order.findUnique({
    where: { id: parseInt(orderId, 10) },
    select: { id: true, final_invoice_id: true },
  });
  if (!order || !order.final_invoice_id) return { updated: false };

  const inv = await db.invoice.findUnique({ where: { id: order.final_invoice_id } });
  if (!inv) return { updated: false };

  const updated = await db.invoice.update({
    where: { id: inv.id },
    data: {
      status: 'paid',
      paid_amount: inv.total,
    },
  });
  return { updated: true, invoice: updated };
}

/**
 * Když Tomáš zruší označení 'doplatek přišel', vrátíme Invoice zpět do 'issued'.
 */
async function unmarkFinalInvoicePaid(orderId, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const order = await db.order.findUnique({
    where: { id: parseInt(orderId, 10) },
    select: { id: true, final_invoice_id: true },
  });
  if (!order || !order.final_invoice_id) return { updated: false };

  const updated = await db.invoice.update({
    where: { id: order.final_invoice_id },
    data: { status: 'issued', paid_amount: 0 },
  });
  return { updated: true, invoice: updated };
}

module.exports = {
  issueFinalInvoiceForOrder,
  getOrdersEligibleForFinalInvoice,
  markFinalInvoicePaid,
  unmarkFinalInvoicePaid,
  computeDepositValue,
  getEarliestProductionStart,
};
