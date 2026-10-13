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
        + '<td class="d">' + esc(nm) + (code ? '<span class="code">' + esc(code) + '</span>' : '') + '</td>'
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
  var authSig = order.authorizer_signature_data && /^data:image/.test(order.authorizer_signature_data) ? order.authorizer_signature_data : null;
  var authName = (opts.authorizer && opts.authorizer.name) || null;

  const bs2 = require('./bs2-doc-style');
  const dt = (x) => new Date(x).toLocaleDateString('cs-CZ');
  const body = ''
    + '<div class="parties"><div class="party"><span class="h">Dodavatel</span>'
    + '<div class="name">' + esc(our.name || 'Best Series s.r.o.') + '</div>'
    + (our.address ? '<div class="row">' + esc(our.address) + '</div>' : '')
    + ((our.zip || our.city) ? '<div class="row">' + esc([our.zip, our.city].filter(Boolean).join(' ')) + '</div>' : '')
    + ((our.ico || our.dic) ? '<div class="row">' + [our.ico ? 'IČO: ' + esc(our.ico) : '', our.dic ? 'DIČ: ' + esc(our.dic) : ''].filter(Boolean).join(' · ') + '</div>' : '')
    + (owner && owner.name ? '<div class="row" style="margin-top:5px">Vyřizuje: <b>' + esc(owner.name) + '</b></div>' : '')
    + (owner && owner.email ? '<div class="row">' + esc(owner.email) + '</div>' : '')
    + (owner && owner.phone ? '<div class="row">' + esc(owner.phone) + '</div>' : '')
    + '</div><div class="party"><span class="h">Odběratel</span>'
    + '<div class="name">' + esc(c.name || '—') + '</div>'
    + (c.address ? '<div class="row">' + esc(c.address) + '</div>' : '')
    + ((c.zip || c.city) ? '<div class="row">' + esc([c.zip, c.city].filter(Boolean).join(' ')) + '</div>' : '')
    + (c.ico ? '<div class="row">IČO: ' + esc(c.ico) + '</div>' : '')
    + (c.contact_person ? '<div class="row" style="margin-top:5px">Odpovědná osoba: <b>' + esc(c.contact_person) + '</b></div>' : '')
    + (c.email ? '<div class="row">' + esc(c.email) + '</div>' : '')
    + (c.phone ? '<div class="row">' + esc(c.phone) + '</div>' : '')
    + '</div></div>'
    + '<div class="meta"><div><div class="l">Datum vystavení</div><div class="v">' + dt(order.created_at || new Date()) + '</div></div>'
    + '<div><div class="l">Měna</div><div class="v">' + esc(cur) + '</div></div>'
    + '<div><div class="l">Počet strojů</div><div class="v">' + machineCount + ' ks</div></div>'
    + '<div>' + (order.authorized_at ? '<div class="l">Autorizováno</div><div class="v">' + dt(order.authorized_at) + '</div>' : '') + '</div></div>'
    + '<table class="items"><thead><tr><th class="r">#</th><th>Popis</th><th class="r">Ks</th><th>Termín</th><th class="r">Cena bez DPH</th></tr></thead><tbody>'
    + (rowsHtml || '<tr><td colspan="5">Bez položek</td></tr>') + '</tbody></table>'
    + (desc ? '<div class="box"><h3>Konfigurace strojů</h3><div class="row">' + esc(desc) + '</div></div>' : '')
    + '<div class="sum"><div class="row"><span>Základ bez DPH</span><strong>' + money(base) + ' ' + cur + '</strong></div>'
    + '<div class="row"><span>DPH 21 %</span><strong>' + money(vat) + ' ' + cur + '</strong></div>'
    + '<div class="row total"><span>Celkem s DPH</span><span>' + money(grand) + ' ' + cur + '</span></div></div>'
    + '<div class="box"><h3>Platební podmínky</h3>' + payHtml + '</div>'
    + '<div class="box fine"><h3>Podmínky objednávky</h3><ul>'
    + '<li>Stroj zůstává až do úplného zaplacení kupní ceny majetkem výrobce (výhrada vlastnictví).</li>'
    + '<li>Není-li stroj servisován prostřednictvím servisní smlouvy (13 % z obratu), je součástí softwarový poplatek <b>2 500 Kč / měsíc</b> (100 € / měsíc).</li>'
    + '<li>Uvedené výrobní termíny budou splněny za předpokladu, že platby proběhnou vždy před nebo v termín splatnosti jednotlivých dokladů.</li>'
    + '</ul></div>'
    + '<div class="sigwrap">'
    + '<div class="sigcol"><h4>Za odběratele</h4>'
    + (sig ? '<img src="' + sig + '">' : '<div class="box" style="margin-top:0">Bez podpisu</div>')
    + '<div class="m">' + (order.signature_place ? 'Místo: <b>' + esc(order.signature_place) + '</b>' : '') + (order.signed_at ? ' · ' + new Date(order.signed_at).toLocaleString('cs-CZ') : '') + '</div></div>'
    + '<div class="sigcol"><h4>Za dodavatele (Best Series s.r.o.)</h4>'
    + (authSig ? '<img src="' + authSig + '">' : '<div class="box" style="margin-top:0">' + (authName ? esc(authName) : 'Autorizováno') + '</div>')
    + '<div class="st">Objednávku potvrzuji a autorizuji.</div>'
    + '<div class="m">' + (authName ? '<b>' + esc(authName) + '</b>' : '') + (order.authorizer_place ? ' · ' + esc(order.authorizer_place) : '') + (order.authorized_at ? ' · ' + new Date(order.authorized_at).toLocaleString('cs-CZ') : '') + '</div></div>'
    + '</div>';
  return bs2.page({ title: 'Potvrzená objednávka', number: order.order_number, pill: 'Potvrzeno', demo: opts.demo }, body);
}

async function generateOrderPdf(order, our, opts) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(buildHtml(order, our, opts), { waitUntil: 'networkidle0', timeout: 20000 });
    await require('./bs2-doc-style').preparePdfPage(page);
    const out = await page.pdf(require('./bs2-doc-style').PDF_OPTIONS);
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

module.exports = { generateOrderPdf, buildHtml };
