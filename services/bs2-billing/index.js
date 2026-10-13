// HolyOS — Fakturace produktů a online produktů z Best Series 2.0 (BS2).
//   • kategorie „products" (stroje, služby): objednávka v BS2 → zálohová faktura (splatnost 3 dny, e-mailem hned);
//     po spárování platby → finální faktura + e-mail; vlastní číselné řady ZB (záloha) a FB (finální).
//   • kategorie „online" (Prověření lokality, Vyhledávač): po zaplacení přes Stripe → rovnou faktura (řada OB) + e-mail.
// Nastavení (šablona, bankovní účty CZK/EUR) jsou per kategorie v AppSetting "bs2.billing".
'use strict';

const { prisma } = require('../../config/database');
const { generateInvoiceNumber } = require('../accountant/invoice-numbering');

const KEY = 'bs2.billing';
const CATS = ['products', 'online'];
// Šablony dokladů = katalog modulu Šablony dokumentů (services/pdf/doc-previews CATALOG, skupina „Vydané doklady").
// Faktury BS2 se renderují stejným generátorem (invoice-pdf + bs2-doc-style) jako náhledy v tom modulu,
// takže zvolená šablona je přesně to, co je vidět v Šablonách dokumentů → Náhled.
const TEMPLATES = (() => {
  try {
    const { CATALOG } = require('../pdf/doc-previews');
    const keys = ['invoice_issued', 'invoice_proforma', 'invoice_tax_receipt'];
    return keys.map((k) => CATALOG.find((c) => c.key === k)).filter(Boolean).map((c) => ({ key: c.key, label: c.name + ' (Šablony dokumentů)', desc: c.desc, preview: '/api/doc-templates/' + c.key + '/preview' }));
  } catch (e) { return [{ key: 'invoice_issued', label: 'Faktura vydaná', preview: '/api/doc-templates/invoice_issued/preview' }]; }
})();
const LEGACY_TEMPLATE = { bs2: 'invoice_issued' };
const normTemplate = (k) => { k = LEGACY_TEMPLATE[k] || k; return TEMPLATES.some((t) => t.key === k) ? k : TEMPLATES[0].key; };
const DEFAULT_VAT = 21;
const PROFORMA_DUE_DAYS = 3;

function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function toId(v) { const n = parseInt(v, 10); return n > 0 ? n : null; }

async function getConfig() {
  const { getSetting } = require('../settings');
  let raw = null;
  try { raw = await getSetting(KEY, { type: 'json', defaultValue: null }); } catch (e) { raw = null; }
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
  const out = {};
  CATS.forEach((c) => {
    const x = (raw && raw[c]) || {};
    out[c] = { template: normTemplate(x.template), CZK: toId(x.CZK), EUR: toId(x.EUR), auto_send: x.auto_send === true, vat_rate: Number.isFinite(Number(x.vat_rate)) && x.vat_rate !== '' && x.vat_rate != null ? Number(x.vat_rate) : DEFAULT_VAT };
  });
  return out;
}
async function setConfig(body, userId) {
  const { setSetting } = require('../settings');
  const v = {};
  CATS.forEach((c) => {
    const x = (body && body[c]) || {};
    v[c] = { template: normTemplate(x.template), CZK: toId(x.CZK), EUR: toId(x.EUR), auto_send: x.auto_send === true || x.auto_send === 'true', vat_rate: Math.max(0, Math.min(30, Number(x.vat_rate))) || (x.vat_rate === 0 || x.vat_rate === '0' ? 0 : DEFAULT_VAT) };
  });
  await setSetting(KEY, v, { type: 'json', description: 'Fakturace Best Series 2.0 — šablona a bankovní účty (CZK/EUR) pro produkty a online produkty', scope: 'accounting', userId });
  return v;
}

// Bankovní pole dle kategorie a měny; když není vybráno, použije se společné nastavení fakturace.
async function bankFields(cat, currency) {
  const cur = String(currency || 'CZK').toUpperCase();
  const cfg = await getConfig();
  const id = cfg[cat] && cfg[cat][cur];
  if (id) {
    const a = await prisma.bankAccount.findUnique({ where: { id } }).catch(() => null);
    if (a && a.active) return { partner_bank_account: a.account_number + '/' + a.bank_code, partner_iban: a.iban || null, partner_bic: a.bic || null };
  }
  return require('../accountant/billing-accounts').invoiceBankFields(cur);
}

// Odběratele najdi (IČO / e-mail / jméno) nebo založ.
async function resolveCompany(c) {
  c = c || {};
  const name = String(c.name || '').trim() || String(c.email || 'Zákazník BS2');
  let co = null;
  if (c.ico) co = await prisma.company.findFirst({ where: { ico: String(c.ico) } }).catch(() => null);
  if (!co && c.email) co = await prisma.company.findFirst({ where: { email: { equals: String(c.email), mode: 'insensitive' }, type: 'customer' } }).catch(() => null);
  if (!co) co = await prisma.company.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }).catch(() => null);
  if (!co) {
    co = await prisma.company.create({ data: {
      name: name.slice(0, 255), ico: c.ico || null, dic: c.dic || null, type: 'customer', email: c.email || null, phone: c.phone ? String(c.phone).slice(0, 20) : null,
      address: c.address || null, city: c.city || null, zip: c.zip || null, country: (c.country || 'CZ').slice(0, 2),
    } });
  } else if (!co.email && c.email) {
    co = await prisma.company.update({ where: { id: co.id }, data: { email: c.email } }).catch(() => co);
  }
  return co;
}

async function ourCompany() {
  let our = null; try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  return our || { name: 'Best Series s.r.o.' };
}
async function mailFrom() {
  const our = await ourCompany();
  return { from: process.env.BS2_BILLING_MAIL_FROM || process.env.SERVICE_BILLING_MAIL_FROM || our.email || undefined, fromName: process.env.BS2_BILLING_MAIL_FROM_NAME || 'Fakturace Best Series 2.0' };
}
const fmt = (n, cur) => Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
const fmtD = (d) => { const x = new Date(d); return x.getDate() + '. ' + (x.getMonth() + 1) + '. ' + x.getFullYear(); };

// Odešle fakturu e-mailem (PDF v příloze), zapíše stav doručení.
async function sendInvoice(invoiceId, kind) {
  const { generateInvoicePdf } = require('../pdf/invoice-pdf');
  const { sendMail } = require('../email');
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { company: true, items: { orderBy: { line_order: 'asc' } } } });
  if (!inv) return { ok: false, error: 'Faktura nenalezena' };
  const to = inv.company && inv.company.email;
  if (!to) { await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'failed', send_error: 'Odběratel nemá e-mail' } }); return { ok: false, error: 'Odběratel nemá e-mail' }; }
  await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'queued', send_attempts: { increment: 1 } } });
  try {
    const pdf = await generateInvoicePdf(inv, await ourCompany());
    const cur = inv.currency || 'CZK';
    let subject, body;
    if (kind === 'proforma') {
      subject = 'Zálohová faktura ' + inv.invoice_number + ' — Best Series 2.0';
      body = 'Dobrý den,\n\nděkujeme za objednávku. V příloze zasíláme zálohovou fakturu ' + inv.invoice_number + '.\nČástka k úhradě: ' + fmt(inv.total, cur) + ', splatnost do ' + fmtD(inv.date_due) + ' (' + PROFORMA_DUE_DAYS + ' dny).\nPo přijetí platby Vám pošleme konečnou fakturu.\n\nS pozdravem\nBest Series s.r.o.';
    } else if (kind === 'final') {
      subject = 'Faktura ' + inv.invoice_number + ' — Best Series 2.0';
      body = 'Dobrý den,\n\nděkujeme za úhradu zálohy. V příloze zasíláme konečnou fakturu ' + inv.invoice_number + (inv.note ? ' (' + inv.note + ')' : '') + '.\nFaktura je uhrazena zálohou, k platbě nic nezbývá.\n\nS pozdravem\nBest Series s.r.o.';
    } else {
      subject = 'Faktura ' + inv.invoice_number + ' — Best Series 2.0';
      body = 'Dobrý den,\n\nděkujeme za platbu. V příloze zasíláme fakturu ' + inv.invoice_number + ' na částku ' + fmt(inv.total, cur) + '. Faktura je již uhrazena.\n\nS pozdravem\nBest Series s.r.o.';
    }
    const r = await sendMail(Object.assign({}, await mailFrom(), { to, brand: 'bs2', subject, body, attachments: [{ filename: inv.invoice_number + '.pdf', content: pdf, contentType: 'application/pdf' }] }));
    if (!r || !r.sent) {
      const why = (r && (r.error || r.skipped)) || 'neodesláno';
      await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'failed', send_error: String(why).slice(0, 1000), sent_to: to } });
      return { ok: false, error: why };
    }
    await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'sent', sent_at: new Date(), sent_to: to, send_error: null, status: inv.status === 'issued' ? 'sent' : inv.status } });
    return { ok: true, to };
  } catch (e) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { delivery_status: 'failed', send_error: String(e.message || e).slice(0, 1000), sent_to: to } }).catch(() => {});
    return { ok: false, error: e.message };
  }
}

// Z položek (net ceny) spočti řádky; gross=true → ceny v položkách jsou s DPH
function buildItems(items, vatRate, gross) {
  let sub = 0, vat = 0;
  const rows = (items || []).map((it, i) => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.unit_price) || 0;
    const lineTotalIn = r2(qty * price);
    const base = gross && vatRate > 0 ? r2(lineTotalIn / (1 + vatRate / 100)) : lineTotalIn;
    const va = r2(vatRate > 0 ? (gross ? lineTotalIn - base : base * vatRate / 100) : 0);
    sub += base; vat += va;
    return { line_order: i, description: String(it.description || '').slice(0, 500), quantity: qty, unit: it.unit || 'ks', unit_price: r2(base / qty), vat_rate: vatRate, subtotal: base, vat_amount: va, total: r2(base + va) };
  });
  return { rows, subtotal: r2(sub), vat: r2(vat), total: r2(sub + vat) };
}

function parseCurrency(c) { return String(c || 'CZK').toUpperCase() === 'EUR' ? 'EUR' : 'CZK'; }

// ─── Kategorie PRODUKTY: zálohová faktura při objednávce (idempotentně podle bs2_ref) ───
async function issueProforma(p) {
  const ref = 'BS2-O' + String(p.ref);
  const ex = await prisma.invoice.findFirst({ where: { source: 'bs2_products', external_number: ref, type: 'proforma_issued' }, select: { id: true, invoice_number: true, delivery_status: true } });
  if (ex) return { ok: true, existing: true, invoice_id: ex.id, invoice_number: ex.invoice_number };
  const cfg = (await getConfig()).products;
  const currency = parseCurrency(p.currency);
  const vatRate = p.vat_rate != null ? Number(p.vat_rate) : cfg.vat_rate;
  const b = buildItems(p.items, vatRate, false);
  if (!(b.total > 0)) return { ok: false, skipped: true, reason: 'nulová částka' };
  const company = await resolveCompany(p.customer);
  const now = new Date();
  const inv = await prisma.$transaction(async (tx) => {
    const no = await generateInvoiceNumber('bs2_proforma', { prisma: tx });
    return tx.invoice.create({ data: {
      invoice_number: no, external_number: ref, type: 'proforma_issued', direction: 'ar', invoice_role: 'deposit', language: p.language === 'en' ? 'en' : 'cs',
      company_id: company.id, currency, subtotal: b.subtotal, vat_amount: b.vat, total: b.total, vat_regime: vatRate > 0 ? 'standard' : (p.vat_regime || 'outside_scope'),
      date_issued: now, date_taxable: now, date_due: new Date(Date.now() + PROFORMA_DUE_DAYS * 86400000),
      variable_symbol: no.replace(/\D/g, '').slice(0, 10), status: 'issued', source: 'bs2_products',
      note: (p.note ? p.note + ' ' : '') + 'Zálohová faktura k objednávce č. ' + p.ref + ' v Best Series 2.0. Splatnost ' + PROFORMA_DUE_DAYS + ' dny.',
      ...(await bankFields('products', currency)),
      items: { create: b.rows },
    } });
  });
  // Dvoufázově: odeslání jen při zapnutém automatickém odesílání (a ne při ručním vystavení z BS2, p.send === false)
  if (p.send === false || !cfg.auto_send) return { ok: true, invoice_id: inv.id, invoice_number: inv.invoice_number, sent: false, held: true };
  const s = await sendInvoice(inv.id, 'proforma');
  return { ok: true, invoice_id: inv.id, invoice_number: inv.invoice_number, sent: !!s.ok, send_error: s.ok ? null : s.error };
}

// ─── Po spárování platby: finální faktura k zaplacené záloze BS2 + e-mail ───
async function processPayment(paymentId) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { bank_transaction: { select: { transaction_date: true, value_date: true } }, allocations: { include: { invoice: { include: { items: { orderBy: { line_order: 'asc' } } } } } } },
    });
    if (!payment) return [];
    const out = [];
    for (const al of payment.allocations) {
      const pf = al.invoice;
      if (!pf || pf.source !== 'bs2_products' || pf.type !== 'proforma_issued') continue;
      if (Number(al.amount) + 0.01 < Number(pf.total)) { console.log('[bs2-billing] záloha ' + pf.invoice_number + ' zaplacena jen částečně — finální faktura nevystavena'); continue; }
      const ex = await prisma.invoice.findFirst({ where: { type: 'issued', parent_invoice_id: pf.id, source: 'bs2_products' }, select: { id: true, invoice_number: true } });
      if (ex) { out.push({ id: ex.id, skipped: true }); continue; }
      const received = (payment.bank_transaction && (payment.bank_transaction.transaction_date || payment.bank_transaction.value_date)) || payment.executed_date || new Date();
      const inv = await prisma.$transaction(async (tx) => {
        const no = await generateInvoiceNumber('bs2_final', { prisma: tx });
        return tx.invoice.create({ data: {
          invoice_number: no, external_number: pf.external_number, type: 'issued', direction: 'ar', invoice_role: 'final', language: pf.language,
          company_id: pf.company_id, order_id: pf.order_id || null, parent_invoice_id: pf.id, source_payment_id: payment.id,
          currency: pf.currency, exchange_rate: pf.exchange_rate, subtotal: pf.subtotal, vat_amount: pf.vat_amount, total: pf.total, paid_amount: pf.total, vat_regime: pf.vat_regime,
          date_issued: new Date(), date_taxable: received, date_due: new Date(), variable_symbol: pf.variable_symbol, payment_method: 'bank_transfer',
          partner_bank_account: pf.partner_bank_account, partner_iban: pf.partner_iban, partner_bic: pf.partner_bic,
          status: 'paid', source: 'bs2_products', note: 'Uhrazeno zálohovou fakturou ' + pf.invoice_number + '. K úhradě 0,00 ' + pf.currency + '.',
          items: { create: pf.items.map((it, i) => ({ line_order: i, description: it.description, quantity: it.quantity, unit: it.unit, unit_price: it.unit_price, vat_rate: it.vat_rate, subtotal: it.subtotal, vat_amount: it.vat_amount, total: it.total })) },
        } });
      });
      const autoSend = (await getConfig()).products.auto_send;
      const s = autoSend ? await sendInvoice(inv.id, 'final') : { ok: false, error: 'automatické odesílání je vypnuté — odešli ručně' };
      console.log('[bs2-billing] finální faktura ' + inv.invoice_number + ' k záloze ' + pf.invoice_number + (s.ok ? ' odeslána' : ' NEODESLÁNA: ' + s.error));
      out.push({ id: inv.id, invoice_number: inv.invoice_number, sent: !!s.ok });
    }
    return out;
  } catch (e) { console.warn('[bs2-billing] processPayment:', e.message); return []; }
}

// ─── Kategorie ONLINE: po zaplacení přes Stripe rovnou faktura (ceny v BS2 jsou s DPH) ───
async function issueOnline(p) {
  const ref = 'BS2-L' + String(p.ref);
  const ex = await prisma.invoice.findFirst({ where: { source: 'bs2_online', external_number: ref }, select: { id: true, invoice_number: true } });
  if (ex) return { ok: true, existing: true, invoice_id: ex.id, invoice_number: ex.invoice_number };
  const cfg = (await getConfig()).online;
  const currency = parseCurrency(p.currency);
  const vatRate = p.vat_rate != null ? Number(p.vat_rate) : cfg.vat_rate;
  const b = buildItems(p.items, vatRate, p.gross !== false);
  if (!(b.total > 0)) return { ok: false, skipped: true, reason: 'nulová částka' };
  const company = await resolveCompany(p.customer);
  const paidAt = p.paid_at ? new Date(p.paid_at) : new Date();
  const inv = await prisma.$transaction(async (tx) => {
    const no = await generateInvoiceNumber('bs2_online', { prisma: tx });
    return tx.invoice.create({ data: {
      invoice_number: no, external_number: ref, type: 'issued', direction: 'ar', invoice_role: 'full', language: p.language === 'en' ? 'en' : 'cs',
      company_id: company.id, currency, subtotal: b.subtotal, vat_amount: b.vat, total: b.total, paid_amount: b.total, vat_regime: vatRate > 0 ? 'standard' : (p.vat_regime || 'outside_scope'),
      date_issued: paidAt, date_taxable: paidAt, date_due: paidAt, variable_symbol: no.replace(/\D/g, '').slice(0, 10), payment_method: 'card',
      status: 'paid', source: 'bs2_online', note: 'Zaplaceno online kartou přes Stripe' + (p.note ? ' — ' + p.note : '') + '. Objednávka č. ' + p.ref + '.',
      ...(await bankFields('online', currency)),
      items: { create: b.rows },
    } });
  });
  if (p.send === false || !cfg.auto_send) return { ok: true, invoice_id: inv.id, invoice_number: inv.invoice_number, sent: false, held: true };
  const s = await sendInvoice(inv.id, 'online');
  return { ok: true, invoice_id: inv.id, invoice_number: inv.invoice_number, sent: !!s.ok, send_error: s.ok ? null : s.error };
}

module.exports = { CATS, TEMPLATES, getConfig, setConfig, bankFields, issueProforma, issueOnline, processPayment, sendInvoice };
