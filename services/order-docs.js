// HolyOS — odeslání dokladů zákazníkovi po autorizaci objednávky
// =============================================================================
// Po autorizaci (Tomáš/Jan) pošle zákazníkovi e-mail s potvrzením objednávky
// a fakturou: ZÁLOHOVOU při platbě se zálohou (payment_split), nebo PLNOU při
// platbě celé částky předem. Fakturu vygeneruje do PDF a přiloží.
// =============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { prisma } = require('../config/database');
const { sendMail } = require('./email');

const ORDER_DOCS_DIR = path.join(__dirname, '..', 'data', 'order-docs');

async function getOurCompanySafe() {
  try { return await require('./settings').getOurCompany(); } catch (e) { return null; }
}

// Termíny z rezervovaných slotů (1 slot = 1 stroj), seřazené vzestupně.
async function loadSlotDates(orderId) {
  try {
    const asg = await prisma.slotAssignment.findMany({
      where: { order_id: orderId },
      include: { slot: { select: { start_date: true, end_date: true } } },
    });
    return asg.map((a) => a.slot && (a.slot.end_date || a.slot.start_date)).filter(Boolean)
      .sort((x, y) => new Date(x) - new Date(y));
  } catch (e) { return []; }
}

// Obchodník (kdo objednávku vyřizuje) pro hlavičku dokladu.
async function loadOwner(order) {
  try {
    if (!order.created_by) return null;
    const p = await prisma.person.findUnique({ where: { id: order.created_by }, select: { first_name: true, last_name: true, email: true, phone: true } });
    if (!p) return null;
    return { name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null, email: p.email || null, phone: p.phone || null };
  } catch (e) { return null; }
}

// Autorizující (Jan/Tomáš) — jméno pro blok „Za dodavatele".
async function loadAuthorizer(order) {
  try {
    if (!order.authorized_by_user_id) return null;
    const u = await prisma.user.findUnique({ where: { id: order.authorized_by_user_id }, select: { display_name: true, username: true } });
    if (!u) return null;
    return { name: u.display_name || u.username || null };
  } catch (e) { return null; }
}

// Vygeneruje PDF potvrzené objednávky, uloží na data volume a vrátí { buffer, filePath }.
async function buildAndStoreOrderPdf(order, ourCompany) {
  const { generateOrderPdf } = require('./pdf/order-pdf');
  const owner = await loadOwner(order);
  const slotDates = await loadSlotDates(order.id);
  const authorizer = await loadAuthorizer(order);
  const buffer = await generateOrderPdf(order, ourCompany || {}, { owner, slotDates, authorizer });
  let filePath = null;
  try {
    fs.mkdirSync(ORDER_DOCS_DIR, { recursive: true });
    const safeNo = String(order.order_number || ('order-' + order.id)).replace(/[^A-Za-z0-9_-]/g, '_');
    filePath = path.join(ORDER_DOCS_DIR, safeNo + '.pdf');
    fs.writeFileSync(filePath, buffer);
    await prisma.order.update({ where: { id: order.id }, data: { confirmation_pdf_path: filePath } }).catch(() => {});
    require('./order-events').logOrderEvent(order.id, { type: 'order_pdf_created', label: 'Vygenerováno PDF potvrzené objednávky', actor: 'systém' });
  } catch (e) { console.error('[order-docs] uložení PDF objednávky selhalo:', e && e.message); }
  return { buffer, filePath };
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
  const created = await prisma.invoice.create({
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
  require('./order-events').logOrderEvent(order.id, { type: 'invoice_created', label: 'Vytvořena faktura', detail: created.invoice_number + ' · ' + Number(created.total).toLocaleString('cs-CZ') + ' ' + (created.currency || 'CZK'), actor: 'systém' });
  return created;
}

// Hlavní: po autorizaci vygeneruje PDF potvrzené objednávky (uloží k objednávce),
// přiloží fakturu (zálohovou / plnou) a odešle zákazníkovi e-mailem.
async function sendOrderConfirmationDocs(orderId) {
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) }, include: { company: true, items: true } });
  if (!order) { console.warn('[order-docs] objednávka nenalezena:', orderId); return; }

  const ourCompany = await getOurCompanySafe();
  const fromEmail = (ourCompany && ourCompany.email) || process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || null;
  const ourName = (ourCompany && ourCompany.name) || 'Best Series s.r.o.';
  const cur = order.currency || 'CZK';
  const attachments = [];

  // 1) PDF POTVRZENÉ OBJEDNÁVKY — vždy vygeneruj a ulož k objednávce (i bez ourCompany).
  try {
    const { buffer } = await buildAndStoreOrderPdf(order, ourCompany);
    if (buffer && buffer.length) {
      attachments.push({ filename: 'Objednavka-' + order.order_number + '.pdf', content: buffer, contentType: 'application/pdf' });
    }
  } catch (e) { console.error('[order-docs] PDF objednávky selhalo:', e && e.message); }

  // 2) FAKTURA (zálohová / plná) — přílohou.
  let invoiceNote = '';
  try {
    const inv = await ensureInvoiceForOrder(order);
    if (inv && ourCompany) {
      const { generateInvoicePdf } = require('./pdf/invoice-pdf');
      const pdf = await generateInvoicePdf(inv, ourCompany);
      const label = inv.invoice_role === 'deposit' ? 'zálohovou fakturu' : 'fakturu';
      attachments.push({ filename: inv.invoice_number + '.pdf', content: pdf, contentType: 'application/pdf' });
      invoiceNote = 'V příloze zasíláme ' + label + ' ' + inv.invoice_number + ' na částku ' + Number(inv.total).toLocaleString('cs-CZ') + ' ' + (inv.currency || cur)
        + (inv.date_due ? (' se splatností ' + new Date(inv.date_due).toLocaleDateString('cs-CZ')) : '') + '.\n\n';
      try { await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'issued' } }); } catch (e) {}
    }
  } catch (e) { console.error('[order-docs] faktura PDF selhala:', e && e.message); }

  // 3) E-mail zákazníkovi.
  const to = order.customer_email || (order.company && order.company.email) || null;
  if (!to) { console.warn('[order-docs] chybí e-mail zákazníka — PDF objednávky uloženo, e-mail neodeslán (objednávka ' + order.order_number + ')'); return; }

  const lines = (order.items || []).map((it) => '• ' + it.name + ' — ' + Number(it.quantity) + ' ' + (it.unit || 'ks') + ' × ' + Number(it.unit_price).toLocaleString('cs-CZ') + ' = ' + Number(it.total_price).toLocaleString('cs-CZ') + ' ' + cur);
  let body = 'Dobrý den,\n\nVaše objednávka ' + order.order_number + ' byla potvrzena a autorizována. Děkujeme.\n\n'
    + 'V příloze najdete potvrzenou objednávku (PDF).\n\nSouhrn objednávky:\n'
    + lines.join('\n') + '\n\nCelkem bez DPH: ' + Number(order.total_amount).toLocaleString('cs-CZ') + ' ' + cur + '\n\n'
    + invoiceNote + 'S pozdravem\n' + ourName;

  try {
    const res = await sendMail({ from: fromEmail, to, subject: 'Potvrzení objednávky ' + order.order_number, body, fromName: ourName, attachments: attachments.length ? attachments : undefined, brand: 'compounder' });
    const evt = require('./order-events');
    if (res && res.sent) {
      await prisma.order.update({ where: { id: order.id }, data: { customer_docs_sent_at: new Date() } }).catch(() => {});
      evt.logOrderEvent(order.id, { type: 'docs_emailed', label: 'Potvrzená objednávka + faktura odeslány zákazníkovi', detail: 'na ' + to + ' · příloh: ' + attachments.length, actor: 'systém' });
      console.log('[order-docs] doklady odeslány zákazníkovi ' + to + ' (objednávka ' + order.order_number + ', příloh: ' + attachments.length + ')');
    } else {
      evt.logOrderEvent(order.id, { type: 'docs_email_failed', label: 'Odeslání dokladů zákazníkovi selhalo', detail: 'na ' + to + ' · ' + ((res && (res.error || res.skipped)) || 'chyba'), actor: 'systém' });
      console.error('[order-docs] e-mail se neodeslal (objednávka ' + order.order_number + '):', res && (res.skipped || res.error));
    }
  } catch (e) { console.error('[order-docs] e-mail dokladů selhal:', e && e.message); }
}

module.exports = { sendOrderConfirmationDocs, ensureInvoiceForOrder, buildAndStoreOrderPdf };
