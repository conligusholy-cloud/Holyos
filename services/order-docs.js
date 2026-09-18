// HolyOS — odeslání dokladů zákazníkovi po autorizaci objednávky
// =============================================================================
// Po autorizaci (Tomáš/Jan) pošle zákazníkovi e-mail s potvrzením objednávky
// a fakturou: ZÁLOHOVOU při platbě se zálohou (payment_split), nebo PLNOU při
// platbě celé částky předem. Fakturu vygeneruje do PDF a přiloží.
// =============================================================================

'use strict';

const { prisma } = require('../config/database');
const { sendMail } = require('./email');

async function getOurCompanySafe() {
  try { return await require('./settings').getOurCompany(); } catch (e) { return null; }
}

// Vrátí (a případně vytvoří) fakturu k odeslání zákazníkovi.
// payment_split=true → zálohová (proforma_issued, role deposit) — vzniká už při
//   založení objednávky. payment_split=false → plná faktura (issued) na celou částku.
async function ensureInvoiceForOrder(order) {
  if (order.payment_split) {
    return prisma.invoice.findFirst({
      where: { order_id: order.id, invoice_role: 'deposit' },
      include: { items: true, company: true }, orderBy: { id: 'desc' },
    });
  }
  // Plná faktura — pokud ještě není, vytvoř ji z položek objednávky.
  let full = await prisma.invoice.findFirst({
    where: { order_id: order.id, invoice_role: { not: 'deposit' } },
    include: { items: true, company: true }, orderBy: { id: 'desc' },
  });
  if (full) return full;

  const { generateInvoiceNumber } = require('./accountant/invoice-numbering');
  const invNo = await generateInvoiceNumber('issued', { prisma });
  const vatRate = 21; // tuzemský plátce; reverse-charge se řeší ručně u zahraničních
  const items = (order.items || []).map((it, idx) => {
    const qty = Number(it.quantity) || 1;
    const up = Number(it.unit_price) || 0;
    const sub = Math.round(qty * up * 100) / 100;
    const vat = Math.round(sub * vatRate) / 100;
    const tot = Math.round((sub + vat) * 100) / 100;
    return { line_order: idx + 1, description: it.name, quantity: qty, unit: it.unit || 'ks', unit_price: up, vat_rate: vatRate, subtotal: sub, vat_amount: vat, total: tot };
  });
  const subtotal = items.reduce((s, i) => s + Number(i.subtotal), 0);
  const vatAmount = items.reduce((s, i) => s + Number(i.vat_amount), 0);
  const total = items.reduce((s, i) => s + Number(i.total), 0);
  const due = new Date(Date.now() + 14 * 86400000);
  return prisma.invoice.create({
    data: {
      invoice_number: invNo, type: 'issued', direction: 'ar',
      company_id: order.company_id, order_id: order.id,
      currency: order.currency || 'CZK', subtotal, vat_amount: vatAmount, total,
      vat_regime: 'standard', date_issued: new Date(), date_due: due,
      variable_symbol: (invNo.match(/(\d+)$/) || [])[1] || null,
      status: 'draft', invoice_role: 'full', source: 'from_order',
      note: 'Faktura k objednávce ' + order.order_number,
      items: { create: items },
    },
    include: { items: true, company: true },
  });
}

// Hlavní: po autorizaci odešle zákazníkovi potvrzení objednávky + fakturu (PDF).
async function sendOrderConfirmationDocs(orderId) {
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) }, include: { company: true, items: true } });
  if (!order) return;
  const to = order.customer_email || (order.company && order.company.email) || null;
  if (!to) { console.warn('[order-docs] chybí e-mail zákazníka — doklady neodeslány'); return; }

  const ourCompany = await getOurCompanySafe();
  const fromEmail = (ourCompany && ourCompany.email) || process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || null;
  const ourName = (ourCompany && ourCompany.name) || 'Best Series s.r.o.';
  const cur = order.currency || 'CZK';

  const lines = (order.items || []).map((it) => '• ' + it.name + ' — ' + Number(it.quantity) + ' ' + (it.unit || 'ks') + ' × ' + Number(it.unit_price).toLocaleString('cs-CZ') + ' = ' + Number(it.total_price).toLocaleString('cs-CZ') + ' ' + cur);
  let body = 'Dobrý den,\n\nVaše objednávka ' + order.order_number + ' byla potvrzena a autorizována. Děkujeme.\n\nSouhrn objednávky:\n'
    + lines.join('\n') + '\n\nCelkem bez DPH: ' + Number(order.total_amount).toLocaleString('cs-CZ') + ' ' + cur + '\n\n';

  const attachments = [];
  try {
    const inv = await ensureInvoiceForOrder(order);
    if (inv && ourCompany) {
      const { generateInvoicePdf } = require('./pdf/invoice-pdf');
      const pdf = await generateInvoicePdf(inv, ourCompany);
      const label = inv.invoice_role === 'deposit' ? 'zálohovou fakturu' : 'fakturu';
      attachments.push({ filename: inv.invoice_number + '.pdf', content: pdf, contentType: 'application/pdf' });
      body += 'V příloze zasíláme ' + label + ' ' + inv.invoice_number + ' na částku ' + Number(inv.total).toLocaleString('cs-CZ') + ' ' + (inv.currency || cur)
        + (inv.date_due ? (' se splatností ' + new Date(inv.date_due).toLocaleDateString('cs-CZ')) : '') + '.\n\n';
      try { await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'issued' } }); } catch (e) {}
    }
  } catch (e) { console.error('[order-docs] faktura PDF selhala:', e && e.message); }

  body += 'S pozdravem\n' + ourName;

  try {
    await sendMail({ from: fromEmail, to, subject: 'Potvrzení objednávky ' + order.order_number, body, fromName: ourName, attachments: attachments.length ? attachments : undefined, brand: 'compounder' });
    await prisma.order.update({ where: { id: order.id }, data: { customer_docs_sent_at: new Date() } }).catch(() => {});
  } catch (e) { console.error('[order-docs] e-mail dokladů selhal:', e && e.message); }
}

module.exports = { sendOrderConfirmationDocs, ensureInvoiceForOrder };
