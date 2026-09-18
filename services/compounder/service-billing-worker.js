// HolyOS — Měsíční servisní fakturace (13 % z obratu stroje v terénu).
// Pro každou aktivní ServiceSubscription vezme obrat předchozího uzavřeného měsíce ze SIS,
// spočte poplatek (fee_pct % z obratu vč. DPH) a vytvoří AR fakturu (koncept).
// E-mail se odešle JEN když subscription.auto_send === true A env SERVICE_BILLING_AUTO_SEND==='1'.
'use strict';

const { prisma } = require('../../config/database');
const { computePrevMonthRevenue } = require('./kiosk-revenue');
const { generateInvoiceNumber } = require('../accountant/invoice-numbering');

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

// Vyfakturuje jednu smlouvu za předchozí měsíc. Vrací {ok, skipped?, invoice_number?, reason?}.
async function billSubscription(sub, opts) {
  opts = opts || {};
  const rev = await computePrevMonthRevenue(sub.kiosk_code);
  if (!opts.force && sub.last_billed_ym === rev.prevMonthYm) return { ok: true, skipped: true, reason: 'already_billed' };
  if (rev.prevMonth <= 0) return { ok: true, skipped: true, reason: 'no_revenue' };

  const feePct = num(sub.fee_pct) || 13;
  const vatRate = num(sub.vat_rate) || 21;
  const currency = sub.currency || rev.currency || 'CZK';
  const subtotal = Math.round(rev.prevMonth * feePct) / 100; // obrat * % /100
  const vat = Math.round(subtotal * vatRate) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const companyId = await resolveCompanyId(sub);
  const invNo = await generateInvoiceNumber('issued', { prisma });
  const desc = 'Servisní poplatek ' + feePct + ' % z obratu ' + rev.prevMonthName + ' (obrat ' + rev.prevMonth.toLocaleString('cs-CZ') + ' ' + currency + ') — kiosk ' + sub.kiosk_code;

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number: invNo, type: 'issued', direction: 'ar',
      company_id: companyId,
      currency, subtotal, vat_amount: vat, total,
      vat_regime: 'standard',
      date_issued: new Date(), date_due: new Date(Date.now() + 14 * 86400000),
      date_taxable: new Date(),
      variable_symbol: (invNo.match(/(\d+)$/) || [])[1] || null,
      status: 'draft', source: 'service_billing',
      note: 'Automatická servisní faktura za ' + rev.prevMonthName + ' · kiosk ' + sub.kiosk_code + ' · ' + feePct + ' % z obratu ' + rev.prevMonth.toLocaleString('cs-CZ') + ' ' + currency,
      items: { create: [{ line_order: 0, description: desc, quantity: 1, unit: 'ks', unit_price: subtotal, vat_rate: vatRate, subtotal, vat_amount: vat, total }] },
    },
  });
  await prisma.serviceSubscription.update({ where: { id: sub.id }, data: { last_billed_ym: rev.prevMonthYm } });

  let sent = false;
  const autoAllowed = process.env.SERVICE_BILLING_AUTO_SEND === '1';
  if (sub.auto_send && autoAllowed && sub.email) {
    try {
      const { generateInvoicePdf } = require('../pdf/invoice-pdf');
      const { sendMail } = require('../email');
      const full = await prisma.invoice.findUnique({ where: { id: invoice.id }, include: { items: true, company: true } });
      const ourCompany = { name: process.env.OUR_COMPANY_NAME || 'Best Series s.r.o.', ico: process.env.BEST_SERIES_ICO || '05643724', dic: process.env.BEST_SERIES_DIC || '', email: process.env.COMPOUNDER_MAIL_FROM || 'compounder@bestseries.cz' };
      const pdf = await generateInvoicePdf(full, ourCompany);
      await sendMail({
        from: process.env.COMPOUNDER_MAIL_FROM || undefined,
        fromName: process.env.COMPOUNDER_MAIL_FROM_NAME || 'Best Series',
        to: sub.email, brand: 'compounder',
        subject: 'Servisní faktura ' + invNo + ' — ' + rev.prevMonthName,
        body: 'Dobrý den,\n\nv příloze zasíláme servisní fakturu ' + invNo + ' za ' + rev.prevMonthName + '.\nČástka k úhradě: ' + total.toLocaleString('cs-CZ') + ' ' + currency + ' (splatnost 14 dní).\n\nS pozdravem\nBest Series',
        attachments: [{ filename: invNo + '.pdf', content: pdf, contentType: 'application/pdf' }],
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'sent' } }).catch(function () {});
      sent = true;
    } catch (e) { console.error('[service-billing] odeslání faktury selhalo:', e.message); }
  }
  return { ok: true, invoice_id: invoice.id, invoice_number: invNo, total, currency, sent };
}

async function runOnce() {
  if (_running) return; _running = true;
  try {
    const subs = await prisma.serviceSubscription.findMany({ where: { active: true } });
    const today = new Date().getDate();
    for (const sub of subs) {
      try {
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
  console.log('[service-billing] worker spuštěn (poll 6 h, auto-send=' + (process.env.SERVICE_BILLING_AUTO_SEND === '1' ? 'ON' : 'OFF') + ')');
}
function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { start, stop, runOnce, billSubscription };
