// HolyOS — PDF generátor POTVRZENÉ OBJEDNÁVKY (headless Chromium / Puppeteer).
// Renderuje stejný profesionální doklad jako zákazník viděl v /order/<token>
// (barvy Compounderu), včetně podpisu zákazníka. Vzor: delivery-note-pdf.js.
'use strict';

let _puppeteer = null;
function getPuppeteer() { if (_puppeteer) return _puppeteer; _puppeteer = require('puppeteer'); return _puppeteer; }
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
function money(n) { return (Math.round(Number(n) || 0)).toLocaleString('cs-CZ'); }
function isoWeek(d) {
  var dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day);
  var ys = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt - ys) / 86400000) + 1) / 7);
}
function term(dateStr) {
  if (!dateStr) return '—';
  var d = new Date(dateStr); if (isNaN(d)) return '—';
  return 'Týden ' + isoWeek(d) + ' (' + d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) + ')';
}
function parseCode(str) {
  var m = (String(str || '').match(/\bL\d+H\d+(?:[WD]\d+)+\b/i) || [])[0];
  return m ? m.toUpperCase() : null;
}
function codeDesc(code) {
  if (!code) return null;
  var tail = (code.match(/H\d+((?:[WD]\d+)+)/) || [])[1] || '';
  var re = /([WD])(\d+)/g, g, units = [];
  while ((g = re.exec(tail))) {
    var digits = g[2], count = 1, kg = digits;
    if (digits.length === 3) { count = parseInt(digits[0], 10); kg = digits.slice(1); }
    units.push({ kind: g[1], count: count, kg: parseInt(kg, 10) });
  }
  if (!units.length) return null;
  var parts = units.map(function (u) {
    var noun = u.kind === 'W' ? 'pračk' : 'sušičk';
    return u.count + '× ' + noun + (u.count === 1 ? 'ou' : 'ami') + ' ' + u.kg + ' kg (' + u.kind + ')';
  });
  var joined = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' a ' + parts[parts.length - 1] : parts[0];
  return 'Prádlomat vybavený ' + joined + ' — dle typu stroje ' + tail + '.';
}

// order: Prisma order + items (s note "TYP:xxx") + company. our: naše firma. opts: {slotDates:[], owner:{name,email,phone}}
function buildHtml(order, our, opts) {
  our = our || {}; opts = opts || {};
  var cur = order.currency || 'CZK';
  var c = order.company || {};
  var owner = opts.owner || null;
  var slotDates = Array.isArray(opts.slotDates) ? opts.slotDates : [];

  // Rozpad na řádky (1 kus = 1 řádek).
  var rows = [], firstCode = null, rowIdx = 0, rowsHtml = '';
  (order.items || []).forEach(function (it) {
    var qty = Math.max(1, Math.round(Number(it.quantity) || 1));
    var code = parseCode(it.note && it.note.replace(/^TYP:/, '')) || parseCode(it.note) || parseCode(it.name);
    if (!firstCode && code) firstCode = code;
    var nm = String(it.name || '').replace(/\n/g, ' — ').split(' — ')[0].replace(/\bL\d+H\d+(?:[WD]\d+)+\b/i, '').trim() || it.name;
    var up = Number(it.unit_price) || 0;
    for (var q = 0; q < qty; q++) {
      rowsHtml += '<tr><td class="c">' + (rowIdx + 1) + '</td>'
        + '<td class="nm">' + esc(nm) + (code ? '<span class="code">' + esc(code) + '</span>' : '') + '</td>'
        + '<td class="r">1 ks</td>'
        + '<td>' + esc(term(slotDates[rowIdx])) + '</td>'
        + '<td class="r">' + money(up) + ' ' + cur + '<span class="vat">' + money(up * 1.21) + ' s DPH</span></td></tr>';
      rowIdx++;
    }
  });

  var base = Number(order.total_amount) || 0;
  var vat = Math.round(base * 21) / 100;
  var grand = Math.round((base + vat) * 100) / 100;

  // Platba
  var payHtml = '';
  if (order.payment_split) {
    var pct = order.deposit_percent || (order.deposit_amount ? Math.round((Number(order.deposit_amount) / base) * 100) : 75);
    var depBase = order.deposit_amount != null ? Number(order.deposit_amount) : Math.round(base * pct) / 100;
    var depGrand = Math.round(depBase * 1.21);
    var restGrand = Math.round(grand - depGrand);
    payHtml = '<div class="pay"><div class="pc"><div class="pk">Záloha ' + pct + ' %</div><div class="pv">' + money(depGrand) + ' ' + cur + '</div><div class="ps">splatnost 3 dny · vč. DPH</div></div>'
      + '<div class="pc"><div class="pk">Doplatek ' + (100 - pct) + ' %</div><div class="pv">' + money(restGrand) + ' ' + cur + '</div><div class="ps">před expedicí · vč. DPH</div></div></div>';
  } else {
    payHtml = '<div class="pay"><div class="pc"><div class="pk">Platba předem</div><div class="pv">' + money(grand) + ' ' + cur + '</div><div class="ps">vč. DPH</div></div></div>';
  }

  var desc = codeDesc(firstCode);
  var machineCount = (order.items || []).reduce(function (s, it) { return s + (Number(it.quantity) || 0); }, 0);
  var sig = order.signature_data && /^data:image/.test(order.signature_data) ? order.signature_data : null;

  return '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'body{font-family:Arial,Helvetica,sans-serif;color:#14141a;font-size:12px;line-height:1.5}'
    + '.top{background:#0e0e11;color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:flex-start}'
    + '.logo{font-size:18px;font-weight:800}.logo b{color:#cda454}.logo .t{display:block;font-size:8.5px;letter-spacing:.28em;color:#d8bd78;font-weight:700;margin-top:3px;text-transform:uppercase}'
    + '.hr{text-align:right}.hr .h{font-size:16px;font-weight:800}.hr .n{font-size:14px;font-weight:800;color:#d8bd78}.hr .s{display:inline-block;margin-top:5px;font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#0e0e11;background:linear-gradient(135deg,#f6e6ad,#cda454 42%,#9a7a34);padding:3px 9px;border-radius:999px}'
    + '.parties{display:flex;gap:20px;padding:16px 22px 4px}.party{flex:1}'
    + '.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#a9822f;font-weight:800;border-bottom:2px solid #cda454;display:inline-block;padding-bottom:2px;margin-bottom:6px}'
    + '.co{font-weight:800;font-size:13px}.ln{font-size:11.5px;color:#5b5b66}.ln.ct{margin-top:6px}.ln b{color:#14141a}'
    + '.meta{display:flex;gap:22px;padding:12px 22px;margin-top:8px;background:#faf8f3;border-top:1px solid #e7e4dc;border-bottom:1px solid #e7e4dc}'
    + '.meta .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:#8a8a95;font-weight:700}.meta .v{font-size:12.5px;font-weight:800}'
    + 'table{width:100%;border-collapse:collapse}thead th{background:#0e0e11;color:#d8bd78;font-size:10px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;padding:8px 8px;text-align:left}'
    + 'thead th:first-child{padding-left:22px}thead th:last-child{padding-right:22px;text-align:right}'
    + 'tbody td{padding:9px 8px;border-bottom:1px solid #e7e4dc;vertical-align:top;font-size:12px}tbody td:first-child{padding-left:22px}tbody td:last-child{padding-right:22px}'
    + 'td.c{text-align:center;font-weight:800;color:#a9822f}td.r{text-align:right;white-space:nowrap}td.nm{font-weight:800}td.nm .code{display:block;font-weight:700;font-size:10px;color:#a9822f;letter-spacing:.05em;margin-top:2px}'
    + 'td.r .vat{display:block;font-weight:600;font-size:9px;color:#8a8a95}'
    + '.cfg{padding:14px 22px 2px}.cfg h3{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#a9822f;font-weight:800;margin-bottom:5px}.cfg p{font-size:12px;color:#5b5b66}'
    + '.sum{margin:14px 22px 0;padding-top:8px;border-top:2px solid #0e0e11}.srow{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}.srow .l{color:#5b5b66}.srow .v{font-weight:800}.srow.tot{border-top:1px solid #e7e4dc;margin-top:4px;padding-top:8px}.srow.tot .v{color:#9a7a34;font-size:17px}'
    + '.terms{padding:14px 22px 0}.terms h3{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#a9822f;font-weight:800;margin-bottom:8px}'
    + '.pay{display:flex;gap:10px}.pc{flex:1;background:#faf8f3;border:1px solid #e7e4dc;border-radius:8px;padding:9px}.pk{font-size:9.5px;text-transform:uppercase;color:#8a8a95;font-weight:700}.pv{font-size:14px;font-weight:800;margin-top:2px}.ps{font-size:11px;color:#5b5b66}'
    + '.fine{margin:12px 22px 0;border:1px solid #e7e4dc;border-radius:8px;padding:10px 13px;background:#faf8f3}.fine h4{font-size:10px;text-transform:uppercase;color:#a9822f;font-weight:800;margin-bottom:6px}.fine ul{margin:0;padding-left:15px;color:#5b5b66;font-size:11px}.fine li{margin-bottom:4px}.fine b{color:#14141a}'
    + '.sig{margin:16px 22px 0;padding-top:10px;border-top:1px solid #e7e4dc}.sig h4{font-size:10px;text-transform:uppercase;color:#a9822f;font-weight:800;margin-bottom:6px}.sig img{max-width:240px;max-height:110px;border:1px solid #e7e4dc;border-radius:6px;padding:4px;background:#fff}.sig .m{font-size:11.5px;color:#5b5b66;margin-top:6px}.sig .m b{color:#14141a}'
    + '.foot{text-align:center;color:#8a8a95;font-size:10px;padding:16px 22px 10px}'
    + '</style></head><body>'
    + '<div class="top"><div class="logo"><b>BEST</b> SERIES<span class="t">Prádlomat · Compounder</span></div>'
    + '<div class="hr"><div class="h">Potvrzená objednávka</div><div class="n">' + esc(order.order_number) + '</div><span class="s">Potvrzeno</span></div></div>'
    + '<div class="parties"><div class="party"><span class="lbl">Dodavatel</span>'
    + '<div class="co">' + esc(our.name || 'Best Series s.r.o.') + '</div>'
    + (our.address ? '<div class="ln">' + esc(our.address) + '</div>' : '')
    + ((our.zip || our.city) ? '<div class="ln">' + esc([our.zip, our.city].filter(Boolean).join(' ')) + '</div>' : '')
    + ((our.ico || our.dic) ? '<div class="ln">' + [our.ico ? 'IČO: ' + esc(our.ico) : '', our.dic ? 'DIČ: ' + esc(our.dic) : ''].filter(Boolean).join(' · ') + '</div>' : '')
    + (owner && owner.name ? '<div class="ln ct">Vyřizuje: <b>' + esc(owner.name) + '</b></div>' : '')
    + (owner && owner.email ? '<div class="ln">' + esc(owner.email) + '</div>' : '')
    + (owner && owner.phone ? '<div class="ln">' + esc(owner.phone) + '</div>' : '')
    + '</div><div class="party"><span class="lbl">Odběratel</span>'
    + '<div class="co">' + esc(c.name || '—') + '</div>'
    + (c.address ? '<div class="ln">' + esc(c.address) + '</div>' : '')
    + ((c.zip || c.city) ? '<div class="ln">' + esc([c.zip, c.city].filter(Boolean).join(' ')) + '</div>' : '')
    + (c.ico ? '<div class="ln">IČO: ' + esc(c.ico) + '</div>' : '')
    + (c.contact_person ? '<div class="ln ct">Odpovědná osoba: <b>' + esc(c.contact_person) + '</b></div>' : '')
    + (c.email ? '<div class="ln">' + esc(c.email) + '</div>' : '')
    + (c.phone ? '<div class="ln">' + esc(c.phone) + '</div>' : '')
    + '</div></div>'
    + '<div class="meta"><div><div class="k">Datum vystavení</div><div class="v">' + (order.created_at ? new Date(order.created_at).toLocaleDateString('cs-CZ') : new Date().toLocaleDateString('cs-CZ')) + '</div></div>'
    + '<div><div class="k">Měna</div><div class="v">' + esc(cur) + '</div></div>'
    + '<div><div class="k">Počet strojů</div><div class="v">' + machineCount + ' ks</div></div>'
    + (order.authorized_at ? '<div><div class="k">Autorizováno</div><div class="v">' + new Date(order.authorized_at).toLocaleDateString('cs-CZ') + '</div></div>' : '')
    + '</div>'
    + '<table><thead><tr><th>#</th><th>Popis</th><th style="text-align:right">Ks</th><th>Termín</th><th style="text-align:right">Cena bez DPH</th></tr></thead><tbody>'
    + (rowsHtml || '<tr><td colspan="5">Bez položek</td></tr>') + '</tbody></table>'
    + (desc ? '<div class="cfg"><h3>Konfigurace strojů</h3><p>' + esc(desc) + '</p></div>' : '')
    + '<div class="sum"><div class="srow"><span class="l">Základ bez DPH</span><span class="v">' + money(base) + ' ' + cur + '</span></div>'
    + '<div class="srow"><span class="l">DPH 21 %</span><span class="v">' + money(vat) + ' ' + cur + '</span></div>'
    + '<div class="srow tot"><span class="l">Celkem s DPH</span><span class="v">' + money(grand) + ' ' + cur + '</span></div></div>'
    + '<div class="terms"><h3>Platební podmínky</h3>' + payHtml + '</div>'
    + '<div class="fine"><h4>Podmínky objednávky</h4><ul>'
    + '<li>Stroj zůstává až do úplného zaplacení kupní ceny majetkem výrobce (výhrada vlastnictví).</li>'
    + '<li>Není-li stroj servisován prostřednictvím servisní smlouvy (13 % z obratu), je součástí softwarový poplatek <b>2 500 Kč / měsíc</b> (100 € / měsíc).</li>'
    + '<li>Uvedené výrobní termíny budou splněny za předpokladu, že platby proběhnou vždy před nebo v termín splatnosti jednotlivých dokladů.</li>'
    + '</ul></div>'
    + '<div class="sig"><h4>Podpis zákazníka</h4>'
    + (sig ? '<img src="' + sig + '">' : '<div class="m">Bez podpisu</div>')
    + '<div class="m">' + (order.signature_place ? 'Místo: <b>' + esc(order.signature_place) + '</b>' : '') + (order.signed_at ? ' · Podepsáno: <b>' + new Date(order.signed_at).toLocaleString('cs-CZ') + '</b>' : '') + '</div></div>'
    + '<div class="foot">Best Series s.r.o. · potvrzená objednávka ' + esc(order.order_number) + '</div>'
    + '</body></html>';
}

async function generateOrderPdf(order, our, opts) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(buildHtml(order, our, opts), { waitUntil: 'networkidle0', timeout: 20000 });
    const out = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

module.exports = { generateOrderPdf, buildHtml };
