// HolyOS — PDF generátor dodacího listu (headless Chromium / Puppeteer).
'use strict';

let _puppeteer = null;
function getPuppeteer() {
  if (_puppeteer) return _puppeteer;
  _puppeteer = require('puppeteer');
  return _puppeteer;
}
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await getPuppeteer().launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  return _browser;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// dn = { number, date_issued, customer_name, order_number, note, items:[{name,quantity,unit,serial_number}] }
// our = { name, address, ico, dic }
function buildHtml(dn, our, opts) {
  const bs2 = require('./bs2-doc-style');
  our = our || {}; opts = opts || {};
  const rows = (Array.isArray(dn.items) ? dn.items : []).map(function (it, i) {
    return '<tr><td class="c">' + (i + 1) + '</td><td class="d">' + esc(it.name) + (it.serial_number ? '<span class="code">výrobní číslo ' + esc(it.serial_number) + '</span>' : '') + '</td>'
      + '<td class="r">' + esc(it.quantity != null ? it.quantity : 1) + '</td><td>' + esc(it.unit || 'ks') + '</td></tr>';
  }).join('');
  const d = dn.date_issued ? new Date(dn.date_issued) : new Date();
  const body = '<div class="parties"><div class="party"><span class="h">Dodavatel</span><div class="name">' + esc(our.name || 'Best Series s.r.o.') + '</div>'
    + (our.address ? '<div class="row">' + esc(our.address) + '</div>' : '')
    + ((our.ico || our.dic) ? '<div class="row">' + (our.ico ? 'IČO: ' + esc(our.ico) : '') + (our.dic ? ' · DIČ: ' + esc(our.dic) : '') + '</div>' : '') + '</div>'
    + '<div class="party"><span class="h">Odběratel</span><div class="name">' + esc(dn.customer_name || '') + '</div></div></div>'
    + '<div class="meta"><div><div class="l">Datum vystavení</div><div class="v">' + d.toLocaleDateString('cs-CZ') + '</div></div>'
    + '<div><div class="l">Objednávka</div><div class="v">' + esc(dn.order_number || '—') + '</div></div><div></div><div></div></div>'
    + '<table class="items"><thead><tr><th class="r">#</th><th>Položka</th><th class="r">Množství</th><th>MJ</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="4">Bez položek</td></tr>') + '</tbody></table>'
    + (dn.note ? '<div class="note"><strong>Poznámka:</strong> ' + esc(dn.note) + '</div>' : '')
    + '<div class="sig"><div>Předal (dodavatel)</div><div>Převzal (odběratel)</div></div>';
  return bs2.page({ title: 'Dodací list', number: dn.number, pill: 'Expedice', demo: opts.demo }, body);
}

async function generateDeliveryNotePdf(dn, our) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(buildHtml(dn, our), { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

module.exports = { generateDeliveryNotePdf, buildHtml };
