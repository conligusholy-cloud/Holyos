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
const bs2style = require('./bs2-doc-style');

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

const itemI18n = require('../accountant/item-i18n');
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

function fmtAmount(n, currency = 'CZK', locale = 'cs-CZ') {
  const num = Number(n) || 0;
  return num.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
}

function fmtAmountPlain(n, locale = 'cs-CZ') {
  const num = Number(n) || 0;
  return num.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d, lang) {
  if (!d) return '—';
  const dt = new Date(d);
  if (lang === 'en') return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

/** QR kód generovaný lokálně (SVG data URL) — funguje v PDF, náhledu i offline, bez externí služby. */
function buildQrLocal(spaydString) {
  if (!spaydString) return null;
  try {
    const QRCode = require('qrcode');
    const qr = QRCode.create(spaydString, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size, data = qr.modules.data, q = 2; // quiet zone 2 moduly
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[y * n + x]) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    const size = n + q * 2;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  } catch (e) {
    return buildQrUrl(spaydString); // záloha: externí služba
  }
}

/** Vrátí URL na hostovaný QR kód nebo null pokud iban chybí. */
function buildQrUrl(spaydString) {
  if (!spaydString) return null;
  const encoded = encodeURIComponent(spaydString);
  // api.qrserver.com je free, široce dostupný; pro produkci je vhodné
  // přejít na lokální generaci přes balíček `qrcode`.
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encoded}`;
}

// ─── JAZYKY DOKLADU (cs / en) ───────────────────────────────────────────────
const I18N = {
  cs: {
    ext: 'Externí č.:', supplier: 'Dodavatel', customer: 'Odběratel', ico: 'IČO', dic: 'DIČ',
    issued: 'Vystaveno', duzp: 'DUZP', due: 'Splatnost', paymethod: 'Forma úhrady',
    desc: 'Popis', qty: 'Množství', unit: 'Jedn.', unitprice: 'Cena / ks', vatpct: 'DPH', base: 'Základ', vat: 'DPH', total: 'Celkem',
    config: 'Konfigurace / výbava', subtotal_all: 'Základ celkem', vat_all: 'DPH celkem', grand: 'Celkem k úhradě',
    paydetails: 'Platební údaje', account: 'Bankovní účet', vs: 'Variabilní symbol', ks: 'Konstantní symbol', ss: 'Specifický symbol',
    qr: 'QR platba', note: 'Poznámka:',
    reverse: '<strong>Režim přenesení daňové povinnosti.</strong> Daň odvede zákazník (reverse charge) — dodání do jiného členského státu EU osobě registrované k DPH dle čl. 196 směrnice 2006/112/ES, § 92 zákona č. 235/2004 Sb.',
    outside: '<strong>Plnění mimo působnost české DPH.</strong> Dodání zákazníkovi ze třetí země (mimo EU) — místo plnění mimo tuzemsko (§ 9 zákona č. 235/2004 Sb.); DPH se neúčtuje (0 %).',
    direction_ar: 'FAKTURA — daňový doklad', direction_ap: 'FAKTURA PŘIJATÁ', direction_tax: 'DAŇOVÝ DOKLAD K PŘIJATÉ PLATBĚ',
    pm: { bank_transfer: 'Bankovním převodem', cash: 'Hotově', card: 'Kartou', barter: 'Zápočet' },
    types: { received: 'Faktura přijatá', issued: 'Faktura vydaná', credit_note_received: 'Dobropis přijatý', credit_note_issued: 'Dobropis vydaný', proforma_received: 'Záloha přijatá', proforma_issued: 'Zálohová faktura', tax_receipt: 'Daňový doklad k platbě' },
    locale: 'cs-CZ',
  },
  en: {
    ext: 'Ext. no.:', supplier: 'Supplier', customer: 'Customer', ico: 'Company ID', dic: 'VAT ID',
    issued: 'Issue date', duzp: 'Tax point', due: 'Due date', paymethod: 'Payment method',
    desc: 'Description', qty: 'Quantity', unit: 'Unit', unitprice: 'Unit price', vatpct: 'VAT', base: 'Net', vat: 'VAT', total: 'Total',
    config: 'Configuration', subtotal_all: 'Total net', vat_all: 'Total VAT', grand: 'Total due',
    paydetails: 'Payment details', account: 'Bank account', vs: 'Variable symbol', ks: 'Constant symbol', ss: 'Specific symbol',
    qr: 'QR payment', note: 'Note:',
    reverse: '<strong>Reverse charge.</strong> VAT to be accounted for by the customer — supply of services to a taxable person in another EU Member State (Article 196 of Council Directive 2006/112/EC).',
    outside: '<strong>Outside the scope of Czech VAT.</strong> Supply to a customer outside the European Union — the place of supply is outside the Czech Republic; VAT is not charged (0 %).',
    direction_ar: 'INVOICE — tax document', direction_ap: 'RECEIVED INVOICE', direction_tax: 'TAX DOCUMENT FOR RECEIVED PAYMENT',
    pm: { bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', barter: 'Offset' },
    types: { received: 'Received invoice', issued: 'Invoice', credit_note_received: 'Received credit note', credit_note_issued: 'Credit note', proforma_received: 'Received proforma', proforma_issued: 'Proforma invoice', tax_receipt: 'Tax document for payment' },
    locale: 'en-GB',
  },
};
function langOf(invoice) { return invoice && invoice.language === 'en' ? 'en' : 'cs'; }

// ─── PŘÍPRAVA DAT PRO ŠABLONU ──────────────────────────────────────────────

/**
 * Z Invoice + ourCompany sestaví flat data objekt pro renderTemplate.
 */
function buildTemplateData(invoice, ourCompany) {
  if (!invoice) throw new Error('buildTemplateData: chybí invoice');

  const partner = invoice.company || {};
  const lang = langOf(invoice); const L = I18N[lang]; const loc = L.locale;
  // Do tabulky jde jen krátký název položky; výbava/konfigurace se přesune do
  // odstavce pod tabulku (segmenty s „·" nebo Rám:/Barva:/Akceptory:/Vytápění:).
  const configNotes = [];
  const items = (invoice.items || []).map(it => {
    const full = String(it.description || '');
    const segs = full.split(' — ');
    const nameSegs = [];
    const cfgSegs = [];
    segs.forEach((s) => {
      if (/[·•]|Rám:|Barva:|Akceptor|Vytáp|Výbava:/i.test(s)) cfgSegs.push(s.replace(/^Výbava:\s*/i, '').trim());
      else nameSegs.push(s.trim());
    });
    const shortName = nameSegs.filter(Boolean).join(' — ').trim() || full;
    const cfg = cfgSegs.filter(Boolean).join(' · ').trim();
    if (cfg) configNotes.push({ name: shortName, cfg });
    // Doklad v angličtině: anglický název (vlastní description_en, jinak překlad glosářem) + pod ním malým písmem česky
    const enName = lang === 'en' ? (it.description_en ? String(it.description_en) : itemI18n.translateItem(shortName)) : '';
    return {
      line_order: it.line_order,
      description: lang === 'en' ? enName : shortName,
      desc_cs: lang === 'en' && enName && enName !== shortName ? shortName : '',
      quantity: fmtAmountPlain(it.quantity, loc),
      unit: lang === 'en' ? itemI18n.translateUnit(it.unit) : (it.unit || 'ks'),
      unit_price: fmtAmountPlain(it.unit_price, loc),
      vat_rate: `${Number(it.vat_rate || 0)}%`,
      subtotal: fmtAmountPlain(it.subtotal, loc),
      vat_amount: fmtAmountPlain(it.vat_amount, loc),
      total: fmtAmountPlain(it.total, loc),
    };
  });

  // Bankovní účet pro QR — preferujeme partner_bank_account z faktury,
  // jinak bank_account z our company. Pro AR fakturu má smysl jen ourCompany.
  // U vydané faktury (AR) má přednost účet uložený na faktuře (dle měny — CZK / EUR), jinak účet naší firmy.
  const isAr = invoice.direction === 'ar';
  const bankAccount = isAr
    ? (invoice.partner_bank_account || (invoice.partner_iban ? '' : (ourCompany?.bank_account || '')))
    : (ourCompany?.bank_account || invoice.partner_bank_account || '');
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
    type_label: L.types[invoice.type] || typeLabel(invoice.type),
    direction_label: invoice.type === 'tax_receipt'
      ? L.direction_tax
      : (invoice.direction === 'ar' ? L.direction_ar : L.direction_ap),

    // Datumy
    date_issued: fmtDate(invoice.date_issued, lang),
    date_taxable: fmtDate(invoice.date_taxable || invoice.date_issued, lang),
    date_due: fmtDate(invoice.date_due, lang),

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
    bic: invoice.partner_bic || '',
    l_bic: 'BIC / SWIFT',
    variable_symbol: invoice.variable_symbol || invoice.invoice_number,
    constant_symbol: invoice.constant_symbol || '',
    specific_symbol: invoice.specific_symbol || '',
    payment_method: L.pm[invoice.payment_method || 'bank_transfer'] || paymentMethodLabel(invoice.payment_method || 'bank_transfer'),

    // Položky
    items,
    has_config: configNotes.length > 0,
    config_notes: configNotes,

    // Sumy
    subtotal: fmtAmount(invoice.subtotal, invoice.currency || 'CZK', loc),
    vat_amount: fmtAmount(invoice.vat_amount, invoice.currency || 'CZK', loc),
    total: fmtAmount(invoice.total, invoice.currency || 'CZK', loc),
    currency: invoice.currency || 'CZK',

    // Přenesení daňové povinnosti (EU plátce DPH) — právní doložka na faktuře.
    show_vat: invoice.vat_regime !== 'outside_scope', // mimo EU: bez rozpisu DPH
    reverse_charge: invoice.vat_regime === 'reverse_charge' || invoice.vat_regime === 'outside_scope',
    reverse_charge_text: invoice.vat_regime === 'outside_scope' ? L.outside : L.reverse,
    lang,
    l_ext: L.ext, l_supplier: L.supplier, l_customer: L.customer, l_ico: L.ico, l_dic: L.dic,
    l_issued: L.issued, l_duzp: L.duzp, l_due: L.due, l_paymethod: L.paymethod,
    l_desc: L.desc, l_qty: L.qty, l_unit: L.unit, l_unitprice: L.unitprice, l_vatpct: L.vatpct, l_base: L.base, l_vat: L.vat, l_total: L.total,
    l_config: L.config, l_subtotal_all: L.subtotal_all, l_vat_all: L.vat_all, l_grand: L.grand,
    l_paydetails: L.paydetails, l_account: L.account, l_vs: L.vs, l_ks: L.ks, l_ss: L.ss, l_qr: L.qr, l_note: L.note,

    // Poznámka
    note: invoice.note || '',

    // QR
    qr_url: buildQrLocal(spayd) || '',

    // Design Best Series 2.0 (jednotný vzhled dokladů)
    doc_css: bs2style.CSS + '\ntable.items td.d .cs{font-weight:400;font-size:6.8pt;color:#8a94a8;margin-top:2px;line-height:1.25}table.items td.d .cs:empty{display:none}table.items td.d .sn{font-weight:400}',
    logo_svg: bs2style.logoSvg(54),
    footer_text: bs2style.FOOTER_TEXT,
  };
}

function typeLabel(t) {
  const map = {
    received: 'Faktura přijatá',
    issued: 'Faktura vydaná',
    credit_note_received: 'Dobropis přijatý',
    credit_note_issued: 'Dobropis vydaný',
    proforma_received: 'Záloha přijatá',
    proforma_issued: 'Zálohová faktura',
    tax_receipt: 'Daňový doklad k platbě',
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
      // Okraje řídí CSS @page v šabloně (preferCSSPageSize), aby se tisklo na A4 s rezervou.
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
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
  loadTemplate,
};
