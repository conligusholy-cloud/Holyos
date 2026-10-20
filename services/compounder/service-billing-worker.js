// HolyOS — Měsíční servisní fakturace (13 % z obratu stroje v terénu).
// Pro každou aktivní ServiceSubscription vezme obrat předchozího uzavřeného měsíce ze SIS,
// spočte poplatek (fee_pct % z obratu vč. DPH) a vytvoří AR fakturu (koncept).
// E-mail se odešle JEN když subscription.auto_send === true (volba u smlouvy).
'use strict';

const { prisma } = require('../../config/database');
const { computePrevMonthRevenue } = require('./kiosk-revenue');
const { generateInvoiceNumber } = require('../accountant/invoice-numbering');
const { invoiceBankFields } = require('../accountant/billing-accounts');

const STARTUP_DELAY_MS = 45 * 1000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // každých 6 h; kalendářní cit řeší last_billed_ym
let _timer = null, _running = false;

function num(x) { const n = Number(x); return isFinite(n) ? n : 0; }

async function resolveCompanyId(sub) {
  if (sub.company_id) return sub.company_id;
  let company = null;
  if (sub.buyer_ico) company = await prisma.company.findFirst({ where: { ico: String(sub.buyer_ico) } }).catch(function () { return null; });
  if (!company && sub.customer_name) company = await prisma.company.findFirst({ where: { name: { equals: sub.customer_name, mode: 'insensitive' } } }).catch(function () { return null; });
  if (!company) company = await prisma.company.create({ data: { name: sub.customer_name || ('Servis ' + sub.kiosk_code), ico: sub.buyer_ico || null, type: 'customer', email: sub.email || null } });
  await prisma.serviceSubscription.update({ where: { id: sub.id }, data: { company_id: company.id } }).catch(function () {});
  return company.id;
}


// Naše firma pro PDF (z nastavení; záložně z env) — kvůli bankovnímu účtu a QR platbě.
async function ourCompanyForPdf() {
  let our = null;
  try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  our = our || { name: process.env.OUR_COMPANY_NAME || 'Best Series s.r.o.', ico: process.env.BEST_SERIES_ICO || '05643724', dic: process.env.BEST_SERIES_DIC || '', email: process.env.COMPOUNDER_MAIL_FROM || 'compounder@bestseries.cz' };
  return our;
}
// Odesílatel servisních faktur = Best Series (ne Compounder): SERVICE_BILLING_MAIL_FROM, jinak fakturační e-mail naší firmy, jinak COMPOUNDER_MAIL_FROM.
async function mailFrom() {
  let our = null; try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  return { from: process.env.SERVICE_BILLING_MAIL_FROM || (our && our.email) || process.env.COMPOUNDER_MAIL_FROM || undefined, fromName: process.env.SERVICE_BILLING_MAIL_FROM_NAME || '🧾 Fakturace Best Series - Prádlomat' };
}
function mailBody(invNo, total, currency, monthName, test) {
  return (test ? 'TESTOVACÍ E-MAIL — takto bude vypadat zpráva pro odběratele. Faktura v příloze je jen ukázka (nebyla vystavena).\n\n' : '')
    + 'Dobrý den,\n\nv příloze zasíláme servisní fakturu ' + invNo + (monthName ? ' za ' + monthName : '') + '.\nČástka k úhradě: ' + Number(total).toLocaleString('cs-CZ') + ' ' + currency + ' (splatnost 14 dní).\n\nS pozdravem\nBest Series';
}

// Odešle vystavenou servisní fakturu e-mailem odběrateli. opts: { to, monthName }. Vrací výsledek sendMail + from/to.
async function sendInvoiceEmail(invoiceId, opts) {
  opts = opts || {};
  const { generateInvoicePdf } = require('../pdf/invoice-pdf');
  const { sendMail } = require('../email');
  const full = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: { orderBy: { line_order: 'asc' } }, company: true } });
  if (!full) return { sent: false, error: 'Faktura nenalezena' };
  const to = opts.to || (full.company && full.company.email);
  if (!to) return { sent: false, error: 'Odběratel nemá e-mail' };
  const pdf = await generateInvoicePdf(full, await ourCompanyForPdf());
  const r = await sendMail(Object.assign({}, await mailFrom(), {
    to, brand: 'bs2',
    subject: 'Servisní faktura ' + full.invoice_number + (opts.monthName ? ' — ' + opts.monthName : ''),
    body: mailBody(full.invoice_number, full.total, full.currency || 'CZK', opts.monthName, false),
    attachments: [{ filename: full.invoice_number + '.pdf', content: pdf, contentType: 'application/pdf' }],
  }));
  if (r && r.sent) await prisma.invoice.update({ where: { id: invoiceId }, data: { status: full.status === 'draft' ? 'sent' : full.status } }).catch(function () {});
  return Object.assign({}, r, { to, from: (r && r.from) || (await mailFrom()).from || null });
}

// Testovací e-mail: ukázková faktura (obrat minulého měsíce ze SIS, jinak vzorová částka) — NIC se nevystavuje ani neukládá.
async function sendTestEmail(sub, to) {
  const { generateInvoicePdf } = require('../pdf/invoice-pdf');
  const { sendMail } = require('../email');
  let rev = null; try { rev = await computePrevMonthRevenue(sub.kiosk_code); } catch (e) { rev = null; }
  const feePct = num(sub.fee_pct) || 13, vatRate = num(sub.vat_rate) || 21;
  const currency = sub.currency || (rev && rev.currency) || 'CZK';
  const revenue = rev && rev.prevMonth > 0 ? rev.prevMonth : 10000;
  const monthName = rev && rev.prevMonth > 0 ? rev.prevMonthName : 'ukázkový měsíc';
  const subtotal = Math.round(revenue * feePct) / 100, vat = Math.round(subtotal * vatRate) / 100, total = Math.round((subtotal + vat) * 100) / 100;
  const our = await ourCompanyForPdf();
  const invNo = 'FS-' + new Date().getFullYear() + '-00001';
  const inv = {
    invoice_number: invNo, type: 'issued', direction: 'ar', currency, subtotal, vat_amount: vat, total,
    date_issued: new Date(), date_taxable: new Date(), date_due: new Date(Date.now() + 14 * 86400000), variable_symbol: '20260001',
    payment_method: 'bank_transfer', vat_regime: 'standard', ...(await invoiceBankFields(currency)),
    company: { name: sub.customer_name || 'Ukázkový odběratel', ico: sub.buyer_ico || '', country: 'CZ' },
    items: [{ line_order: 0, description: 'Servisní poplatek ' + feePct + ' % z obratu ' + monthName + ' (obrat ' + revenue.toLocaleString('cs-CZ') + ' ' + currency + ') — kiosk ' + sub.kiosk_code + (sub.contract_number ? ' — na základě servisní smlouvy č. ' + sub.contract_number : ''), quantity: 1, unit: 'ks', unit_price: subtotal, vat_rate: vatRate, subtotal, vat_amount: vat, total }],
    note: (sub.contract_number ? 'Fakturováno na základě servisní smlouvy č. ' + sub.contract_number + '. ' : '') + 'TESTOVACÍ FAKTURA — ukázka, nebyla vystavena.',
  };
  const pdf = await generateInvoicePdf(inv, our);
  const r = await sendMail(Object.assign({}, await mailFrom(), {
    to, brand: 'bs2',
    subject: '[TEST] Servisní faktura ' + invNo + ' — ' + monthName,
    body: mailBody(invNo, total, currency, monthName, true),
    attachments: [{ filename: invNo + '.pdf', content: pdf, contentType: 'application/pdf' }],
  }));
  return Object.assign({}, r, { to, from: (r && r.from) || (await mailFrom()).from || null, via: r && r.via, invoice_total: total, currency });
}

// Vyfakturuje jednu smlouvu za předchozí měsíc. Vrací {ok, skipped?, invoice_number?, reason?}.
async function billSubscription(sub, opts) {
  opts = opts || {};
  // Obrat jen za dny, kdy smlouva skutečně běžela (první/poslední měsíc bývá neúplný)
  const toYmd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const rev = await computePrevMonthRevenue(sub.kiosk_code, { from: toYmd(sub.contract_start), to: toYmd(sub.contract_end) });
  if (rev.empty) return { ok: true, skipped: true, reason: 'outside_contract' };
  if (!opts.force && sub.last_billed_ym === rev.prevMonthYm) return { ok: true, skipped: true, reason: 'already_billed' };
  if (rev.prevMonth <= 0) return { ok: true, skipped: true, reason: 'no_revenue' };
  rev.prevMonthName = rev.periodLabel; // do popisu faktury i e-mailu: „23.–30. 9. 2026 (část měsíce září 2026)"

  const feePct = num(sub.fee_pct) || 13;
  const vatRate = num(sub.vat_rate) || 21;
  const currency = sub.currency || rev.currency || 'CZK';
  const subtotal = Math.round(rev.prevMonth * feePct) / 100; // obrat * % /100
  const vat = Math.round(subtotal * vatRate) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const companyId = await resolveCompanyId(sub);
  const invNo = await generateInvoiceNumber('service_issued', { prisma });
  const bank = await invoiceBankFields(currency);
  const cn = (sub.contract_number || '').trim();
  const desc = 'Servisní poplatek ' + feePct + ' % z obratu ' + rev.prevMonthName + ' (obrat ' + rev.prevMonth.toLocaleString('cs-CZ') + ' ' + currency + ') — kiosk ' + sub.kiosk_code + (cn ? ' — na základě servisní smlouvy č. ' + cn : '');

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number: invNo, type: 'issued', direction: 'ar',
      company_id: companyId,
      currency, subtotal, vat_amount: vat, total,
      vat_regime: 'standard',
      date_issued: new Date(), date_due: new Date(Date.now() + 14 * 86400000),
      date_taxable: new Date(),
      variable_symbol: invNo.replace(/\D/g, '') || null, // rok + pořadí (odliší od ostatních řad)
      status: 'draft', source: 'service_billing', ...bank,
      note: (cn ? 'Fakturováno na základě servisní smlouvy č. ' + cn + '. ' : '') + 'Automatická servisní faktura za ' + rev.prevMonthName + ' · kiosk ' + sub.kiosk_code + ' · ' + feePct + ' % z obratu ' + rev.prevMonth.toLocaleString('cs-CZ') + ' ' + currency,
      items: { create: [{ line_order: 0, description: desc, quantity: 1, unit: 'ks', unit_price: subtotal, vat_rate: vatRate, subtotal, vat_amount: vat, total }] },
    },
  });
  await prisma.serviceSubscription.update({ where: { id: sub.id }, data: { last_billed_ym: rev.prevMonthYm } });

  let sent = false, sendError = null;
  // Automatické odeslání: jen u smluv se zapnutým Odesílat e-mailem (volba u smlouvy) a s vyplněným e-mailem.
  if (sub.auto_send && sub.email) {
    try {
      const r = await sendInvoiceEmail(invoice.id, { to: sub.email, monthName: rev.prevMonthName });
      sent = !!r.sent; if (!r.sent) sendError = r.error || r.skipped || 'neodesláno';
    } catch (e) { sendError = e.message; console.error('[service-billing] odeslání faktury selhalo:', e.message); }
  }
  return { ok: true, invoice_id: invoice.id, invoice_number: invNo, total, currency, sent, send_error: sendError };
}

async function runOnce() {
  if (_running) return; _running = true;
  try {
    const subs = await prisma.serviceSubscription.findMany({ where: { active: true } });
    const today = new Date().getDate();
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
    for (const sub of subs) {
      try {
        // Datum první faktury periody: dřív se nefakturuje (porovnání jako YYYY-MM-DD v pražském čase)
        if (sub.first_invoice_date && todayStr < new Date(sub.first_invoice_date).toISOString().slice(0, 10)) continue;
        if (today < (sub.billing_day || 3)) continue; // ještě není den fakturace
        const r = await billSubscription(sub);
        if (r && r.ok && !r.skipped) console.log('[service-billing] faktura ' + r.invoice_number + ' pro kiosk ' + sub.kiosk_code + (r.sent ? ' (odeslána)' : ' (koncept)'));
      } catch (e) { console.error('[service-billing] kiosk ' + sub.kiosk_code + ':', e.message); }
    }
  } catch (e) { console.error('[service-billing] runOnce:', e.message); }
  finally { _running = false; }
}

function start() {
  if (_timer) return;
  setTimeout(function () { runOnce().catch(function () {}); }, STARTUP_DELAY_MS);
  _timer = setInterval(function () { runOnce().catch(function () {}); }, POLL_INTERVAL_MS);
  console.log('[service-billing] worker spuštěn (poll 6 h, auto-send=' + 'per smlouva' + ')');
}
function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { start, stop, runOnce, billSubscription, sendInvoiceEmail, sendTestEmail };
