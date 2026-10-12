// HolyOS — Měsíční fakturace softwarové podpory stroje (paušál, např. 60 EUR bez DPH).
// Pro každou aktivní SoftwareSubscription vystaví v nastavený den měsíce fakturu za BĚŽNÝ měsíc (předem).
// Jazyk faktury i e-mailu: cs | en (u zahraničních odběratelů). Řada čísel SW-RRRR-NNNNN.
// E-mail se odešle JEN když subscription.auto_send === true.
'use strict';

const { prisma } = require('../../config/database');
const { generateInvoiceNumber } = require('../accountant/invoice-numbering');
const { invoiceBankFields } = require('../accountant/billing-accounts');

const STARTUP_DELAY_MS = 60 * 1000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
let _timer = null, _running = false;

const MONTHS = {
  cs: ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

function num(x) { const n = Number(x); return isFinite(n) ? n : 0; }
function langOf(sub) { return sub && sub.language === 'en' ? 'en' : 'cs'; }
function monthLabel(lang, d) { return MONTHS[lang][d.getMonth()] + ' ' + d.getFullYear(); }
function ymOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function fmtMoney(n, cur, lang) { return Number(n).toLocaleString(lang === 'en' ? 'en-GB' : 'cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur; }

// Částky dle DPH režimu: standard → vat_rate %, reverse_charge / outside_scope → 0 %.
function computeAmounts(sub) {
  const regime = sub.vat_regime || 'standard';
  const vatRate = regime === 'standard' ? (num(sub.vat_rate) || 0) : 0;
  const subtotal = Math.round(num(sub.amount) * 100) / 100;
  const vat = Math.round(subtotal * vatRate) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  return { regime, vatRate, subtotal, vat, total };
}

function itemDescription(sub, label, lang) {
  const cn = (sub.contract_number || '').trim();
  if (lang === 'en') return 'Software support — ' + label + ' — machine ' + sub.kiosk_code + (cn ? ' — under contract no. ' + cn : '');
  return 'Softwarová podpora — ' + label + ' — stroj ' + sub.kiosk_code + (cn ? ' — na základě smlouvy č. ' + cn : '');
}
function invoiceNote(sub, label, lang) {
  const cn = (sub.contract_number || '').trim();
  if (lang === 'en') return (cn ? 'Invoiced under contract no. ' + cn + '. ' : '') + 'Monthly software support for ' + label + ', machine ' + sub.kiosk_code + '.';
  return (cn ? 'Fakturováno na základě smlouvy č. ' + cn + '. ' : '') + 'Měsíční softwarová podpora za ' + label + ', stroj ' + sub.kiosk_code + '.';
}

async function ourCompanyForPdf() {
  let our = null;
  try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  return our || { name: process.env.OUR_COMPANY_NAME || 'Best Series s.r.o.', ico: process.env.BEST_SERIES_ICO || '05643724', dic: process.env.BEST_SERIES_DIC || '', email: process.env.COMPOUNDER_MAIL_FROM || 'compounder@bestseries.cz' };
}
async function mailFrom() {
  let our = null; try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  return { from: process.env.SERVICE_BILLING_MAIL_FROM || (our && our.email) || process.env.COMPOUNDER_MAIL_FROM || undefined, fromName: process.env.SERVICE_BILLING_MAIL_FROM_NAME || '🧾 Fakturace Best Series - Prádlomat' };
}
function mailTexts(lang, invNo, total, currency, label, test) {
  if (lang === 'en') {
    return {
      subject: (test ? '[TEST] ' : '') + 'Invoice ' + invNo + ' — software support, ' + label,
      body: (test ? 'TEST E-MAIL — this is how the message will look for the customer. The attached invoice is only a sample (it was not issued).\n\n' : '')
        + 'Dear customer,\n\nplease find attached invoice ' + invNo + ' for software support (' + label + ').\nAmount due: ' + fmtMoney(total, currency, 'en') + ' (due in 14 days).\n\nBest regards\nBest Series',
    };
  }
  return {
    subject: (test ? '[TEST] ' : '') + 'Faktura ' + invNo + ' — softwarová podpora, ' + label,
    body: (test ? 'TESTOVACÍ E-MAIL — takto bude vypadat zpráva pro odběratele. Faktura v příloze je jen ukázka (nebyla vystavena).\n\n' : '')
      + 'Dobrý den,\n\nv příloze zasíláme fakturu ' + invNo + ' za softwarovou podporu (' + label + ').\nČástka k úhradě: ' + fmtMoney(total, currency, 'cs') + ' (splatnost 14 dní).\n\nS pozdravem\nBest Series',
  };
}

async function resolveCompanyId(sub) {
  if (sub.company_id) return sub.company_id;
  let company = null;
  if (sub.buyer_ico) company = await prisma.company.findFirst({ where: { ico: String(sub.buyer_ico) } }).catch(function () { return null; });
  if (!company && sub.customer_name) company = await prisma.company.findFirst({ where: { name: { equals: sub.customer_name, mode: 'insensitive' } } }).catch(function () { return null; });
  if (!company) company = await prisma.company.create({ data: { name: sub.customer_name || ('Software ' + sub.kiosk_code), ico: sub.buyer_ico || null, dic: sub.buyer_dic || null, type: 'customer', email: sub.email || null } });
  await prisma.softwareSubscription.update({ where: { id: sub.id }, data: { company_id: company.id } }).catch(function () {});
  return company.id;
}

// Odešle vystavenou fakturu e-mailem (jazyk dle faktury). opts: { to }.
async function sendInvoiceEmail(invoiceId, opts) {
  opts = opts || {};
  const { generateInvoicePdf } = require('../pdf/invoice-pdf');
  const { sendMail } = require('../email');
  const full = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: { orderBy: { line_order: 'asc' } }, company: true } });
  if (!full) return { sent: false, error: 'Faktura nenalezena' };
  const to = opts.to || (full.company && full.company.email);
  if (!to) return { sent: false, error: 'Odběratel nemá e-mail' };
  const lang = full.language === 'en' ? 'en' : 'cs';
  const label = opts.label || monthLabel(lang, new Date(full.date_taxable || full.date_issued));
  const pdf = await generateInvoicePdf(full, await ourCompanyForPdf());
  const tx = mailTexts(lang, full.invoice_number, full.total, full.currency || 'EUR', label, false);
  const r = await sendMail(Object.assign({}, await mailFrom(), {
    to, brand: 'bs2', subject: tx.subject, body: tx.body,
    attachments: [{ filename: full.invoice_number + '.pdf', content: pdf, contentType: 'application/pdf' }],
  }));
  if (r && r.sent) await prisma.invoice.update({ where: { id: invoiceId }, data: { status: full.status === 'draft' ? 'sent' : full.status } }).catch(function () {});
  return Object.assign({}, r, { to, from: (r && r.from) || (await mailFrom()).from || null });
}

// Testovací e-mail: ukázková faktura, nic se nevystavuje ani neukládá.
async function sendTestEmail(sub, to) {
  const { generateInvoicePdf } = require('../pdf/invoice-pdf');
  const { sendMail } = require('../email');
  const lang = langOf(sub);
  const now = new Date();
  const label = monthLabel(lang, now);
  const a = computeAmounts(sub);
  const currency = (sub.currency || 'EUR').toUpperCase();
  const invNo = 'SW-' + now.getFullYear() + '-00001';
  const inv = {
    invoice_number: invNo, type: 'issued', direction: 'ar', language: lang, currency,
    subtotal: a.subtotal, vat_amount: a.vat, total: a.total,
    date_issued: now, date_taxable: now, date_due: new Date(Date.now() + 14 * 86400000), variable_symbol: String(now.getFullYear()) + '00001',
    payment_method: 'bank_transfer', vat_regime: a.regime, ...(await invoiceBankFields(currency)),
    company: { name: sub.customer_name || (lang === 'en' ? 'Sample customer' : 'Ukázkový odběratel'), ico: sub.buyer_ico || '', dic: sub.buyer_dic || '', country: sub.country || 'CZ' },
    items: [{ line_order: 0, description: itemDescription(sub, label, lang), quantity: 1, unit: lang === 'en' ? 'month' : 'měs.', unit_price: a.subtotal, vat_rate: a.vatRate, subtotal: a.subtotal, vat_amount: a.vat, total: a.total }],
    note: (lang === 'en' ? 'TEST INVOICE — sample, not issued. ' : 'TESTOVACÍ FAKTURA — ukázka, nebyla vystavena. ') + invoiceNote(sub, label, lang),
  };
  const pdf = await generateInvoicePdf(inv, await ourCompanyForPdf());
  const tx = mailTexts(lang, invNo, a.total, currency, label, true);
  const r = await sendMail(Object.assign({}, await mailFrom(), {
    to, brand: 'bs2', subject: tx.subject, body: tx.body,
    attachments: [{ filename: invNo + '.pdf', content: pdf, contentType: 'application/pdf' }],
  }));
  return Object.assign({}, r, { to, from: (r && r.from) || (await mailFrom()).from || null, via: r && r.via, invoice_total: a.total, currency });
}

// Vyfakturuje jednu smlouvu za BĚŽNÝ měsíc (předem). Vrací {ok, skipped?, invoice_number?}.
async function billSubscription(sub, opts) {
  opts = opts || {};
  const now = new Date();
  const ym = ymOf(now);
  if (!opts.force && sub.last_billed_ym === ym) return { ok: true, skipped: true, reason: 'already_billed' };
  const lang = langOf(sub);
  const label = monthLabel(lang, now);
  const a = computeAmounts(sub);
  if (a.subtotal <= 0) return { ok: true, skipped: true, reason: 'no_amount' };
  const currency = (sub.currency || 'EUR').toUpperCase();
  const companyId = await resolveCompanyId(sub);
  const invNo = await generateInvoiceNumber('software_issued', { prisma });
  const bank = await invoiceBankFields(currency);

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number: invNo, type: 'issued', direction: 'ar', language: lang,
      company_id: companyId, currency, subtotal: a.subtotal, vat_amount: a.vat, total: a.total,
      vat_regime: a.regime,
      date_issued: now, date_taxable: now, date_due: new Date(Date.now() + 14 * 86400000),
      variable_symbol: invNo.replace(/\D/g, '') || null,
      status: 'draft', source: 'software_billing', ...bank,
      note: invoiceNote(sub, label, lang),
      items: { create: [{ line_order: 0, description: itemDescription(sub, label, lang), quantity: 1, unit: lang === 'en' ? 'month' : 'měs.', unit_price: a.subtotal, vat_rate: a.vatRate, subtotal: a.subtotal, vat_amount: a.vat, total: a.total }] },
    },
  });
  await prisma.softwareSubscription.update({ where: { id: sub.id }, data: { last_billed_ym: ym } });

  let sent = false, sendError = null;
  if (sub.auto_send && sub.email) {
    try {
      const r = await sendInvoiceEmail(invoice.id, { to: sub.email, label });
      sent = !!r.sent; if (!r.sent) sendError = r.error || r.skipped || 'neodesláno';
    } catch (e) { sendError = e.message; console.error('[software-billing] odeslání faktury selhalo:', e.message); }
  }
  return { ok: true, invoice_id: invoice.id, invoice_number: invNo, total: a.total, currency, sent, send_error: sendError };
}

async function runOnce() {
  if (_running) return; _running = true;
  try {
    const subs = await prisma.softwareSubscription.findMany({ where: { active: true } });
    const today = new Date().getDate();
    for (const sub of subs) {
      try {
        if (today < (sub.billing_day || 1)) continue;
        const r = await billSubscription(sub);
        if (r && r.ok && !r.skipped) console.log('[software-billing] faktura ' + r.invoice_number + ' pro stroj ' + sub.kiosk_code + (r.sent ? ' (odeslána)' : ' (koncept)'));
      } catch (e) { console.error('[software-billing] stroj ' + sub.kiosk_code + ':', e.message); }
    }
  } catch (e) { console.error('[software-billing] runOnce:', e.message); }
  finally { _running = false; }
}

function start() {
  if (_timer) return;
  setTimeout(function () { runOnce().catch(function () {}); }, STARTUP_DELAY_MS);
  _timer = setInterval(function () { runOnce().catch(function () {}); }, POLL_INTERVAL_MS);
  console.log('[software-billing] worker spuštěn (poll 6 h, auto-send per smlouva)');
}
function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { start, stop, runOnce, billSubscription, sendInvoiceEmail, sendTestEmail, computeAmounts };
