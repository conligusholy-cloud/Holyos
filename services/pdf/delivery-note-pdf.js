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
function buildHtml(dn, our) {
  our = our || {};
  const rows = (Array.isArray(dn.items) ? dn.items : []).map(function (it, i) {
    return '<tr><td>' + (i + 1) + '</td><td>' + esc(it.name) + (it.serial_number ? ' <span style="color:#888">(v.č. ' + esc(it.serial_number) + ')</span>' : '') + '</td>'
      + '<td style="text-align:right">' + esc(it.quantity != null ? it.quantity : 1) + '</td><td>' + esc(it.unit || 'ks') + '</td></tr>';
  }).join('');
  const d = dn.date_issued ? new Date(dn.date_issued) : new Date();
  return '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><style>'
    + 'body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;margin:32px;}'
    + 'h1{font-size:20px;margin:0 0 2px;}.muted{color:#666;}'
    + '.head{display:flex;justify-content:space-between;margin-bottom:24px;}'
    + '.box{max-width:48%;}table{width:100%;border-collapse:collapse;margin-top:12px;}'
    + 'th,td{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;}th{background:#f4f4f4;font-size:11px;text-transform:uppercase;letter-spacing:.4px;}'
    + '.sig{margin-top:56px;display:flex;justify-content:space-between;}.sig div{width:44%;border-top:1px solid #999;padding-top:6px;text-align:center;color:#666;}'
    + '</style></head><body>'
    + '<div class="head"><div class="box"><h1>Dodací list</h1><div class="muted">Číslo: ' + esc(dn.number) + '</div>'
    + '<div class="muted">Datum: ' + d.toLocaleDateString('cs-CZ') + '</div>'
    + (dn.order_number ? '<div class="muted">Objednávka: ' + esc(dn.order_number) + '</div>' : '') + '</div>'
    + '<div class="box" style="text-align:right"><b>' + esc(our.name || 'Best Series s.r.o.') + '</b><br>'
    + esc(our.address || '') + '<br>' + (our.ico ? 'IČO: ' + esc(our.ico) : '') + (our.dic ? ' · DIČ: ' + esc(our.dic) : '') + '</div></div>'
    + '<div><b>Odběratel:</b> ' + esc(dn.customer_name || '') + '</div>'
    + '<table><thead><tr><th>#</th><th>Položka</th><th style="text-align:right">Množství</th><th>MJ</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="4" class="muted">Bez položek</td></tr>') + '</tbody></table>'
    + (dn.note ? '<p class="muted" style="margin-top:16px">' + esc(dn.note) + '</p>' : '')
    + '<div class="sig"><div>Předal (dodavatel)</div><div>Převzal (odběratel)</div></div>'
    + '</body></html>';
}

async function generateDeliveryNotePdf(dn, our) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(buildHtml(dn, our), { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

module.exports = { generateDeliveryNotePdf };
