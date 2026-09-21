// =============================================================================
// HolyOS — Daňový doklad k přijaté platbě (DPPP)
// =============================================================================
//
// Po spárování bankovní platby se zálohovou fakturou (proforma_issued, AR) vzniká
// podle zákona o DPH samostatný daňový doklad k přijaté platbě (typ 'tax_receipt',
// řada DD). Tato služba ho vytváří AUTOMATICKY a IDEMPOTENTNĚ.
//
// Zásady (dle zadání):
//   • §2  každý doklad je samostatný (DPPP je NOVÝ dokument, ne úprava zálohové),
//   • §10 trigger = PAYMENT MATCHED,
//   • §11 DUZP = skutečné datum přijetí úplaty (datum bank. transakce),
//   • §16 idempotence: 1 (platba × zálohová) → max 1 DPPP,
//   • §29 vytvoření dokladu v transakci; e-mail až po commitu (guarded).
//
// Odeslání zákazníkovi je za pojistkou env `DEPOSIT_TAX_AUTO_SEND==='1'`.
// Bez ní se DPPP jen vytvoří (delivery_status='not_sent') a odešle se ručně.

'use strict';

const { prisma: defaultPrisma } = require('../../config/database');
const { generateInvoiceNumber } = require('./invoice-numbering');

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// Sazba DPH odvozená ze zálohové faktury (poměr total/subtotal), fallback dle režimu.
function deriveVatRate(src) {
  if (src.vat_regime && src.vat_regime !== 'standard') return 0; // reverse_charge, non_vat_payer, …
  const sub = Number(src.subtotal), tot = Number(src.total);
  if (sub > 0 && tot > 0) {
    const r = Math.round((tot / sub - 1) * 100);
    if (Number.isFinite(r) && r >= 0) return r;
  }
  return 21;
}

/**
 * Vytvoří (idempotentně) daňové doklady k přijaté platbě pro všechny zálohové
 * faktury, na které byla platba alokována. Voláno PO commitu spárování.
 * @param {number} paymentId
 * @param {object} [opts] { prisma }
 * @returns {Promise<Array<{id:number, invoice_number?:string, created?:boolean, skipped?:boolean}>>}
 */
async function createDepositTaxDocsForPayment(paymentId, opts = {}) {
  const prisma = opts.prisma || defaultPrisma;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      bank_transaction: { select: { id: true, transaction_date: true, value_date: true } },
      allocations: { include: { invoice: true } },
    },
  });
  if (!payment) return [];

  const results = [];
  for (const alloc of payment.allocations) {
    const src = alloc.invoice;
    // Jen zálohové faktury VYDANÉ zákazníkovi (AR proforma_issued).
    if (!src || src.direction !== 'ar' || src.type !== 'proforma_issued') continue;
    const gross = Number(alloc.amount);
    if (!(gross > 0)) continue;

    // Idempotence: existuje už DPPP pro (tuto platbu, tuto zálohovou)?
    const existing = await prisma.invoice.findFirst({
      where: { type: 'tax_receipt', source_payment_id: payment.id, parent_invoice_id: src.id },
      select: { id: true, invoice_number: true },
    });
    if (existing) { results.push({ id: existing.id, invoice_number: existing.invoice_number, skipped: true }); continue; }

    const rate = deriveVatRate(src);
    const base = rate > 0 ? round2(gross / (1 + rate / 100)) : gross;
    const vat = round2(gross - base);
    // §11 DUZP = skutečné datum přijetí úplaty (bank. transakce), ne import/spárování.
    const received = payment.bank_transaction?.transaction_date
      || payment.bank_transaction?.value_date
      || payment.executed_date
      || new Date();

    const data = {
      type: 'tax_receipt',
      direction: 'ar',
      invoice_role: 'deposit_tax',
      company_id: src.company_id,
      order_id: src.order_id || null,
      parent_invoice_id: src.id,
      source_payment_id: payment.id,
      source_bank_transaction_id: payment.bank_transaction_id || null,
      currency: src.currency,
      exchange_rate: src.exchange_rate,
      subtotal: base,
      vat_amount: vat,
      total: gross,
      paid_amount: gross, // DPPP vzniká z již přijaté platby → uhrazeno
      vat_regime: src.vat_regime,
      date_issued: new Date(),
      date_taxable: received,
      date_due: received,
      payment_method: 'bank_transfer',
      variable_symbol: src.variable_symbol || null,
      partner_bank_account: src.partner_bank_account || null,
      partner_iban: src.partner_iban || null,
      status: 'issued',
      delivery_status: 'not_sent',
      source: 'auto_payment_match',
      note: 'Daňový doklad k přijaté platbě k zálohové faktuře ' + src.invoice_number,
    };

    try {
      const dppp = await prisma.$transaction(async (tx) => {
        const number = await generateInvoiceNumber('tax_receipt', { prisma: tx });
        return tx.invoice.create({
          data: {
            ...data,
            invoice_number: number,
            items: {
              create: [{
                line_order: 1,
                description: 'Přijatá úplata k zálohové faktuře ' + src.invoice_number,
                quantity: 1, unit: 'ks', unit_price: base, vat_rate: rate,
                subtotal: base, vat_amount: vat, total: gross,
              }],
            },
          },
        });
      });
      results.push({ id: dppp.id, invoice_number: dppp.invoice_number, created: true });
    } catch (e) {
      // P2002 = souběžné vytvoření stejného DPPP → ber jako již vytvořený (idempotence).
      if (e && e.code === 'P2002') {
        const dup = await prisma.invoice.findFirst({
          where: { type: 'tax_receipt', source_payment_id: payment.id, parent_invoice_id: src.id },
          select: { id: true, invoice_number: true },
        });
        if (dup) { results.push({ id: dup.id, invoice_number: dup.invoice_number, skipped: true }); continue; }
      }
      console.warn('[deposit-tax-doc] create failed for záloha', src.invoice_number, e.message);
    }
  }
  return results;
}

/**
 * Odešle DPPP zákazníkovi e-mailem (PDF v příloze) a zaeviduje výsledek.
 * Idempotentní vůči existenci dokladu — NEVYTVÁŘÍ nový doklad, jen odesílá.
 * @param {number} invoiceId
 * @param {object} [opts] { prisma }
 */
async function sendDepositTaxDoc(invoiceId, opts = {}) {
  const prisma = opts.prisma || defaultPrisma;
  const { getOurCompany } = require('../settings');
  const { generateInvoicePdf } = require('../pdf/invoice-pdf');
  const { sendMail } = require('../email');

  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { company: true, items: true, order: { select: { customer_email: true } } },
  });
  if (!inv || inv.type !== 'tax_receipt') return { ok: false, reason: 'not_tax_receipt' };

  const to = (inv.company && inv.company.email) || (inv.order && inv.order.customer_email) || null;
  await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'queued', send_attempts: { increment: 1 } } });
  if (!to) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'failed', send_error: 'Chybí fakturační e-mail zákazníka' } });
    return { ok: false, reason: 'no_email' };
  }
  try {
    const our = await getOurCompany();
    const pdf = await generateInvoicePdf(inv, our);
    const subject = 'Daňový doklad k přijaté platbě ' + inv.invoice_number;
    const body = 'Dobrý den,\n\nv příloze zasíláme daňový doklad k přijaté platbě č. ' + inv.invoice_number +
      (inv.parent_invoice_id ? '' : '') + '.\n\nS pozdravem\n' + ((our && our.name) || 'Best Series s.r.o.');
    const from = (our && our.email) || null;
    const result = await sendMail({
      from, to, subject, body,
      attachments: [{ filename: inv.invoice_number + '.pdf', content: pdf, contentType: 'application/pdf' }],
    });
    if (!result || !result.sent) {
      const reason = (result && (result.skipped || result.error)) || 'unknown';
      await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'failed', send_error: String(reason).slice(0, 1000), sent_to: to } });
      return { ok: false, reason: 'send_failed', error: reason };
    }
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { delivery_status: 'sent', sent_at: new Date(), sent_to: to, send_error: null, send_message_id: (result && result.messageId) || null },
    });
    return { ok: true };
  } catch (e) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'failed', send_error: String(e.message || e).slice(0, 1000), sent_to: to } });
    return { ok: false, reason: 'send_failed', error: e.message };
  }
}

/**
 * Kompletní automatika po spárování platby: vytvoř DPPP a (za pojistkou) odešli.
 * Bezpečné volat best-effort po commitu spárování. Nikdy nevyhazuje.
 * Odeslání jen když env DEPOSIT_TAX_AUTO_SEND==='1'.
 */
async function processPaymentForDepositTaxDocs(paymentId, opts = {}) {
  try {
    const created = await createDepositTaxDocsForPayment(paymentId, opts);
    const autoSend = process.env.DEPOSIT_TAX_AUTO_SEND === '1';
    if (autoSend) {
      for (const r of created) {
        if (r && r.created && r.id) {
          await sendDepositTaxDoc(r.id, opts).catch((e) => console.warn('[deposit-tax-doc] send failed', r.id, e.message));
        }
      }
    }
    return created;
  } catch (e) {
    console.warn('[deposit-tax-doc] processPayment failed', paymentId, e.message);
    return [];
  }
}

module.exports = {
  createDepositTaxDocsForPayment,
  sendDepositTaxDoc,
  processPaymentForDepositTaxDocs,
  deriveVatRate,
};
