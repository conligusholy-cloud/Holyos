// HolyOS — PDF generátor faktury
// =============================================================================
// Renderuje HTML šablonu přes headless Chromium (Puppeteer) a vrátí Buffer
// PDF souboru. Šablona je v `services/pdf/invoice-template.html`, data se
// vkládají přes Mustache-like substituci ({{key}} → value).
//
// QR platba (CZ): generuje SPAYD string podle ČBA standardu, vykresluje přes
// https://api.qrserver.com (žádný local QR balíček nutný — server-side
// inline base64 obrázek vložený do HTML).
// =============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

let _puppeteer = null;
function getPuppeteer() {
  if (_puppeteer) return _puppeteer;
  try {
    _puppeteer = require('puppeteer');
    return _puppeteer;
  } catch (e) {
    throw new Error('Puppeteer není nainstalovaný. Spusť `npm install puppeteer` v rootu HolyOS.');
  }
}

let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const puppeteer = getPuppeteer();
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  return _browser;
}

/** Cleanup pro graceful shutdown */
async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
}

// ─── ŠABLONA ────────────────────────────────────────────────────────────────

const TEMPLATE_PATH = path.join(__dirname, 'invoice-template.html');

function loadTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

/** Mustache-lite: {{key}} a {{#each items}}...{{/each}} */
function renderTemplate(html, data) {
  // {{#each ITEMS}}...{{/each}} — replace s join
  html = html.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, inner) => {
    const arr = data[key];
    if (!Array.isArray(arr)) return '';
    return arr.map((item, idx) => {
      let block = inner;
      // {{@index}}
      block = block.replace(/\{\{@index\}\}/g, String(idx + 1));
      // {{key}} v rámci item
      block = block.replace(/\{\{(\w+)\}\}/g, (m, k) => {
        return item[k] !== undefined && item[k] !== null ? escapeHtml(String(item[k])) : '';
      });
      return block;
    }).join('');
  });

  // {{#if KEY}}...{{/if}} — show jen pokud truthy
  html = html.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) => {
    return data[key] ? inner : '';
  });

  // Triple {{{ key }}} = raw HTML (bez escape — pro QR base64)
  html = html.replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => {
    return data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
  });

  // {{ key }} — escape
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] !== undefined && data[key] !== null ? escapeHtml(String(data[key])) : '';
  });

  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── FORMÁTOVÁNÍ ────────────────────────────────────────────────────────────

function fmtAmount(n, currency = 'CZK') {
  const num = Number(n) || 0;
  return num.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
}

function fmtAmountPlain(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getDate()}. ${dt.getMonth() + 1}. ${dt.getFullYear()}`;
}

function joinAddress(c) {
  if (!c) return '';
  const parts = [];
  if (c.address) parts.push(c.address);
  const cityLine = [c.zip, c.city].filter(Boolean).join(' ');
  if (cityLine) parts.push(cityLine);
  if (c.country && c.country !== 'CZ') parts.push(c.country);
  return parts.join(', ');
}

// ─── CZ QR platba (SPAYD) ───────────────────────────────────────────────────

/**
 * Sestaví SPAYD string podle ČBA standardu pro QR platbu.
 *
 * Formát: SPD*1.0*ACC:IBAN[+BIC]*AM:amount*CC:currency*X-VS:vs[*MSG:msg]
 *
 * @param {Object} opts
 * @param {string} opts.iban       IBAN (CZ65...)
 * @param {number} opts.amount     částka
 * @param {string} [opts.currency] CZK default
 * @param {string} [opts.vs]
 * @param {string} [opts.message]  max 60 znaků (ASCII safe)
 */
function buildSpaydString({ iban, amount, currency = 'CZK', vs, message }) {
  if (!iban) return null;
  const cleanIban = String(iban).replace(/\s+/g, '');
  const parts = [
    'SPD', '1.0',
    `ACC:${cleanIban}`,
    `AM:${Number(amount).toFixed(2)}`,
    `CC:${currency}`,
  ];
  if (vs) parts.push(`X-VS:${String(vs).replace(/\D/g, '').slice(0, 10)}`);
  if (message) {
    const msg = String(message)
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
      .replace(/[^\x20-\x7E]/g, ' ')
      .slice(0, 60);
    parts.push(`MSG:${msg}`);
  }
  return parts.join('*');
}

/** Vrátí URL na hostovaný QR kód nebo null pokud iban chybí. */
function buildQrUrl(spaydString) {
  if (!spaydString) return null;
  const encoded = encodeURIComponent(spaydString);
  // api.qrserver.com je free, široce dostupný; pro produkci je vhodné
  // přejít na lokální generaci přes balíček `qrcode`.
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encoded}`;
}

// ─── PŘÍPRAVA DAT PRO ŠABLONU ──────────────────────────────────────────────

/**
 * Z Invoice + ourCompany sestaví flat data objekt pro renderTemplate.
 */
function buildTemplateData(invoice, ourCompany) {
  if (!invoice) throw new Error('buildTemplateData: chybí invoice');

  const partner = invoice.company || {};
  const items = (invoice.items || []).map(it => ({
    line_order: it.line_order,
    description: it.description,
    quantity: fmtAmountPlain(it.quantity),
    unit: it.unit || 'ks',
    unit_price: fmtAmountPlain(it.unit_price),
    vat_rate: `${Number(it.vat_rate || 0)}%`,
    subtotal: fmtAmountPlain(it.subtotal),
    vat_amount: fmtAmountPlain(it.vat_amount),
    total: fmtAmountPlain(it.total),
  }));

  // Bankovní účet pro QR — preferujeme partner_bank_account z faktury,
  // jinak bank_account z our company. Pro AR fakturu má smysl jen ourCompany.
  const bankAccount = ourCompany?.bank_account || invoice.partner_bank_account || '';
  const iban = invoice.partner_iban || ourCompany?.iban || (bankAccount ? czAccountToIban(bankAccount) : '');

  const spayd = buildSpaydString({
    iban,
    amount: invoice.total,
    currency: invoice.currency || 'CZK',
    vs: invoice.variable_symbol,
    message: `Faktura ${invoice.invoice_number}`,
  });

  return {
    // Hlavička
    invoice_number: invoice.invoice_number,
    external_number: invoice.external_number || '',
    type_label: typeLabel(invoice.type),
    direction_label: invoice.direction === 'ar' ? 'FAKTURA — daňový doklad' : 'FAKTURA PŘIJATÁ',

    // Datumy
    date_issued: fmtDate(invoice.date_issued),
    date_taxable: fmtDate(invoice.date_taxable || invoice.date_issued),
    date_due: fmtDate(invoice.date_due),

    // Dodavatel (my)
    supplier_name: ourCompany?.name || '',
    supplier_address: joinAddress(ourCompany),
    supplier_ico: ourCompany?.ico || '',
    supplier_dic: ourCompany?.dic || '',
    supplier_email: ourCompany?.email || '',
    supplier_phone: ourCompany?.phone || '',
    supplier_web: ourCompany?.web || '',

    // Odběratel
    customer_name: partner.name || '',
    customer_address: joinAddress(partner),
    customer_ico: partner.ico || '',
    customer_dic: partner.dic || '',

    // Platba
    bank_account: bankAccount,
    iban: iban || '',
    variable_symbol: invoice.variable_symbol || invoice.invoice_number,
    constant_symbol: invoice.constant_symbol || '',
    specific_symbol: invoice.specific_symbol || '',
    payment_method: paymentMethodLabel(invoice.payment_method || 'bank_transfer'),

    // Položky
    items,

    // Sumy
    subtotal: fmtAmount(invoice.subtotal, invoice.currency || 'CZK'),
    vat_amount: fmtAmount(invoice.vat_amount, invoice.currency || 'CZK'),
    total: fmtAmount(invoice.total, invoice.currency || 'CZK'),
    currency: invoice.currency || 'CZK',

    // Poznámka
    note: invoice.note || '',

    // QR
    qr_url: buildQrUrl(spayd) || '',

    // Zápatí
    generated_at: new Date().toLocaleString('cs-CZ'),
  };
}

function typeLabel(t) {
  const map = {
    received: 'Faktura přijatá',
    issued: 'Faktura vydaná',
    credit_note_received: 'Dobropis přijatý',
    credit_note_issued: 'Dobropis vydaný',
    proforma_received: 'Záloha přijatá',
    proforma_issued: 'Záloha vydaná',
  };
  return map[t] || t;
}

function paymentMethodLabel(m) {
  return ({
    bank_transfer: 'Bankovním převodem',
    cash: 'Hotově',
    card: 'Kartou',
    barter: 'Zápočet',
  })[m] || m;
}

/** Převod CZ účtu na IBAN. Stejná implementace jako abo-kpc, pro jednoduchost inline. */
function czAccountToIban(account) {
  // "1234567890/0300" nebo "12-3456789012/0100"
  const cleaned = String(account || '').replace(/\s+/g, '');
  const m = cleaned.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return '';
  const prefix = (m[1] || '').padStart(6, '0');
  const base = m[2].padStart(10, '0');
  const bankCode = m[3];
  // BBAN: bank_code(4) + prefix(6) + base(10) = 20 chars
  const bban = bankCode + prefix + base;
  // IBAN check digits (mod-97)
  // Move CZ + checkDigits to end, replace letters with numbers (C=12, Z=35)
  const tmp = bban + '12' + '35' + '00';
  // Compute mod 97
  let remainder = 0;
  for (const ch of tmp) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  const check = String(98 - remainder).padStart(2, '0');
  return `CZ${check}${bban}`;
}

// ─── HLAVNÍ API ─────────────────────────────────────────────────────────────

/**
 * Vygeneruje PDF fakturu jako Buffer.
 *
 * @param {Object} invoice          Invoice s included { company, items }
 * @param {Object} ourCompany       Naše firma (Company objekt)
 * @param {Object} [opts]
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(invoice, ourCompany, opts = {}) {
  if (!invoice) throw new Error('generateInvoicePdf: chybí invoice');
  if (!invoice.items) throw new Error('generateInvoicePdf: invoice musí mít načtené items (Prisma include)');

  const data = buildTemplateData(invoice, ourCompany);
  const html = renderTemplate(loadTemplate(), data);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    const pdfRaw = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' },
    });
    // Puppeteer v22+ vrací Uint8Array, ne Buffer. Express `res.send(uint8Array)`
    // by ho serializoval jako JSON object (klíč/hodnota); konverze na Buffer
    // zaručí, že odejde jako binární payload s Content-Type: application/pdf.
    return Buffer.isBuffer(pdfRaw) ? pdfRaw : Buffer.from(pdfRaw);
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  generateInvoicePdf,
  closeBrowser,
  // pro testy
  buildSpaydString,
  buildQrUrl,
  czAccountToIban,
  buildTemplateData,
  renderTemplate,
};
