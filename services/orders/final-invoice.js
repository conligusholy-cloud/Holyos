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
  const deposit = computeDepositValue(order);
  const finalAmount = Math.max(0, Math.round((total - deposit) * 100) / 100);
  if (finalAmount <= 0) {
    return { created: false, reason: 'final_amount_zero' };
  }

  // Generuj číslo + datumy
  const invoiceNumber = await generateInvoiceNumber('issued', { prisma: db });
  const dueDays = await getDefaultInvoiceDueDays().catch(() => 14);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(today.getTime() + dueDays * 86400000);

  // VS — invoice_number bez prefixu, jen cifry
  const vs = invoiceNumber.replace(/\D/g, '').slice(-10);

  // VAT — pro jednoduchost (V1) bereme rovnou s DPH = total_amount * 21% (standard).
  // Tomášovo zadání: zatím počítáme částku doplatku bez detailního VAT rozkladu —
  // řádek faktury vznikne jako "Doplatek za <číslo objednávky>" s totalAmount = finalAmount.
  // Při ručních úpravách v účetních dokladech může Tomáš upravit.
  const defaultVatRate = 21;
  // finalAmount je celková částka s DPH (počítáno z Order.total_amount, který je s DPH)
  // Subtotal = finalAmount / 1.21, vat = subtotal * 0.21
  const lineSubtotal = +(finalAmount / (1 + defaultVatRate / 100)).toFixed(2);
  const lineVat = +(finalAmount - lineSubtotal).toFixed(2);

  const invoice = await db.invoice.create({
    data: {
      invoice_number: invoiceNumber,
      type: 'issued',
      direction: 'ar',
      company_id: order.company_id,
      order_id: order.id,
      currency: order.currency || 'CZK',
      exchange_rate: 1,
      subtotal: lineSubtotal.toFixed(2),
      vat_amount: lineVat.toFixed(2),
      total: finalAmount.toFixed(2),
      vat_regime: 'standard',
      date_issued: today,
      date_taxable: today,
      date_due: due,
      payment_method: 'bank_transfer',
      variable_symbol: vs,
      status: 'issued',
      source: 'auto_final_invoice',
      invoice_role: 'final',
      created_by_user_id: opts.createdByUserId || null,
      items: {
        create: [
          {
            line_order: 1,
            description: `Doplatek za prodejní objednávku ${order.order_number}` +
              (deposit > 0 ? ` (po zaplacené záloze ${deposit.toLocaleString('cs-CZ')} ${order.currency || 'CZK'})` : ''),
            quantity: 1,
            unit: 'ks',
            unit_price: finalAmount,
            vat_rate: defaultVatRate,
            subtotal: lineSubtotal.toFixed(2),
            vat_amount: lineVat.toFixed(2),
            total: finalAmount.toFixed(2),
          },
        ],
      },
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
