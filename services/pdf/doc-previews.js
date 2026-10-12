// HolyOS — Náhledy šablon dokumentů (faktury, dobropis, záloha, dodací list, příjemka, nabídka, upomínky…).
// Každý náhled se vykreslí z ukázkových dat stejnými šablonami, jaké se používají pro skutečné doklady.
'use strict';

const QRCode = require('qrcode');
const invoicePdf = require('./invoice-pdf');
const deliveryNote = require('./delivery-note-pdf');
const orderPdf = require('./order-pdf');
const { buildReminder } = require('../reminders/templates');

const OUR = {
  name: 'Best Series s.r.o.', address: 'Ukázková 123', zip: '602 00', city: 'Brno', country: 'CZ',
  ico: '05643724', dic: 'CZ05643724', email: 'fakturace@bestseries.cz', phone: '+420 600 000 000', web: 'www.bestseries.cz',
  bank_account: '1234567890/0800', iban: 'CZ6508000000001234567890',
};
const CUSTOMER = { name: 'LAUNDRY, j.s.a.', address: 'Příkladná 45', zip: '110 00', city: 'Praha', country: 'CZ', ico: '12345678', dic: 'CZ12345678' };
const SUPPLIER = { name: 'Dodavatel komponent s.r.o.', address: 'Průmyslová 8', zip: '690 02', city: 'Břeclav', country: 'CZ', ico: '87654321', dic: 'CZ87654321' };

const ITEMS = [
  { line_order: 0, description: 'Prádlomat PRO CZ — 3 pračky 18 kg + sušička', quantity: 1, unit: 'ks', unit_price: 1450000, vat_rate: 21, subtotal: 1450000, vat_amount: 304500, total: 1754500 },
  { line_order: 1, description: 'Doprava a montáž', quantity: 1, unit: 'ks', unit_price: 35000, vat_rate: 21, subtotal: 35000, vat_amount: 7350, total: 42350 },
];

function sampleInvoice(type, direction, extra) {
  const subtotal = 1485000, vat = 311850;
  return Object.assign({
    invoice_number: type === 'issued' ? 'FV-2026-00012' : type === 'proforma_issued' ? 'ZV-2026-00007' : type === 'credit_note_issued' ? 'DV-2026-00002' : type === 'tax_receipt' ? 'DPPP-2026-00003' : 'FP-2026-00418',
    external_number: type === 'received' ? '2026-0418' : '',
    type, direction, currency: 'CZK', subtotal, vat_amount: vat, total: subtotal + vat,
    date_issued: new Date('2026-10-01'), date_taxable: new Date('2026-10-01'), date_due: new Date('2026-10-15'),
    variable_symbol: '2026000012', payment_method: 'bank_transfer', vat_regime: 'standard',
    company: direction === 'ar' ? CUSTOMER : SUPPLIER, items: ITEMS,
    note: 'Ukázkový doklad — údaje jsou smyšlené.',
  }, extra || {});
}

async function renderInvoiceHtml(inv, ourCompany) {
  const data = invoicePdf.buildTemplateData(inv, ourCompany || OUR);
  try {
    const spayd = invoicePdf.buildSpaydString({ iban: OUR.iban, amount: inv.total, currency: inv.currency, vs: inv.variable_symbol, message: 'Faktura ' + inv.invoice_number });
    if (spayd) data.qr_url = await QRCode.toDataURL(spayd, { margin: 1, width: 220 });
  } catch (e) { data.qr_url = ''; }
  return invoicePdf.renderTemplate(invoicePdf.loadTemplate(), data).replace('<body>', '<body><div class="demo">UKÁZKA — smyšlená data</div>');
}

// ── Společný vzhled (Best Series 2.0) — bs2-doc-style.js ──
const bs2 = require('./bs2-doc-style');
const esc = bs2.esc;
const money = (n, cur) => Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || 'CZK');
const addr = (c) => [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const party = (label, c) => `<div class="party"><span class="h">${label}</span><div class="name">${esc(c.name)}</div><div class="row">${esc(addr(c))}</div><div class="row">IČO: ${esc(c.ico || '')}${c.dic ? ' · DIČ: ' + esc(c.dic) : ''}</div>${c.email ? `<div class="row">${esc(c.email)}</div>` : ''}</div>`;
const shell = (title, number, pill, inner) => bs2.page({ title, number, pill, demo: true }, inner);

function offerHtml() {
  const rows = ITEMS.map((it, i) => `<tr><td class="c">${i + 1}</td><td class="d">${esc(it.description)}</td><td class="r">${it.quantity} ${it.unit}</td><td class="r">${money(it.unit_price)}</td><td class="r">${it.vat_rate} %</td><td class="r">${money(it.total)}</td></tr>`).join('');
  return shell('Cenová nabídka', 'NAB-2026-00031', 'Platnost 30 dní', `
  <div class="parties">${party('Dodavatel', OUR)}${party('Odběratel', CUSTOMER)}</div>
  <div class="meta"><div><div class="l">Vystaveno</div><div class="v">1. 10. 2026</div></div><div><div class="l">Platnost do</div><div class="v">31. 10. 2026</div></div><div><div class="l">Dodací lhůta</div><div class="v">8–10 týdnů</div></div><div><div class="l">Vyřizuje</div><div class="v">Jan Obchodník</div></div></div>
  <table class="items"><thead><tr><th>#</th><th>Popis</th><th class="r">Množství</th><th class="r">Cena / MJ bez DPH</th><th class="r">DPH</th><th class="r">Celkem s DPH</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="sum"><div class="row"><span>Celkem bez DPH</span><strong>${money(1485000)}</strong></div><div class="row"><span>DPH 21 %</span><strong>${money(311850)}</strong></div><div class="row total"><span>Cena celkem</span><span>${money(1796850)}</span></div></div>
  <div class="box"><h3>Platební podmínky</h3>Záloha 75 % do 3 dnů od potvrzení objednávky, doplatek 25 % před expedicí. Cena zahrnuje dopravu a montáž na místo.</div>
  <div class="box"><h3>Poznámka</h3>Nabídka je nezávazná, platí do uvedeného data. Pro potvrzení nabídky nám zašlete podepsanou objednávku.</div>
  <div class="sig"><div>Za dodavatele</div><div>Za odběratele (akceptace)</div></div>`);
}
function receiptHtml() {
  const rows = [['Motor pračky 18 kg', 4, 'ks'], ['Ložisko 6205 2RS', 16, 'ks'], ['Těsnění dveří — sada', 4, 'ks']].map((r, i) => `<tr><td class="c">${i + 1}</td><td class="d">${esc(r[0])}</td><td class="r">${r[1]} ${r[2]}</td><td class="r">${r[1]} ${r[2]}</td><td>Sklad A-02-3</td></tr>`).join('');
  return shell('Příjemka', 'PR-2026-00094', 'Skladový doklad', `
  <div class="parties">${party('Dodavatel', SUPPLIER)}${party('Příjemce', OUR)}</div>
  <div class="meta"><div><div class="l">Datum příjmu</div><div class="v">2. 10. 2026</div></div><div><div class="l">Objednávka</div><div class="v">PO-2026-0155</div></div><div><div class="l">Dodací list dodavatele</div><div class="v">DL-88412</div></div><div><div class="l">Sklad</div><div class="v">Sklad A</div></div></div>
  <table class="items"><thead><tr><th>#</th><th>Položka</th><th class="r">Objednáno</th><th class="r">Přijato</th><th>Skladová pozice</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="box"><h3>Poznámka ke kontrole</h3>Zboží přijato bez závad, počet kusů odpovídá objednávce.</div>
  <div class="sig"><div>Předal (dodavatel / dopravce)</div><div>Převzal (skladník)</div></div>`);
}

function issueHtml() {
  const rows = [['Motor pračky 18 kg', 2, 'ks', 'A-02-3'], ['Ložisko 6205 2RS', 8, 'ks', 'A-02-3'], ['Těsnění dveří — sada', 2, 'ks', 'B-01-1']].map((r, i) => `<tr><td class="c">${i + 1}</td><td class="d">${esc(r[0])}</td><td class="r">${r[1]} ${r[2]}</td><td class="r">${r[1]} ${r[2]}</td><td>Sklad ${r[3]}</td></tr>`).join('');
  return shell('Výdejka', 'VY-2026-00061', 'Skladový doklad', `
  <div class="parties">${party('Vydává', OUR)}<div class="party"><span class="h">Příjemce / účel výdeje</span><div class="name">Výroba — prádlomat PRO CZ</div><div class="row">Zakázka: SO-MUZ7QI1S</div><div class="row">Pracoviště: Montáž 1</div><div class="row">Převzal: Petr Montér</div></div></div>
  <div class="meta"><div><div class="l">Datum výdeje</div><div class="v">6. 10. 2026</div></div><div><div class="l">Zdrojový sklad</div><div class="v">Sklad A</div></div><div><div class="l">Důvod výdeje</div><div class="v">Výroba</div></div><div><div class="l">Vydal</div><div class="v">Jana Skladnice</div></div></div>
  <table class="items"><thead><tr><th>#</th><th>Položka</th><th class="r">Požadováno</th><th class="r">Vydáno</th><th>Skladová pozice</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="box"><h3>Poznámka</h3>Materiál vydán dle výrobní zakázky, zbývající množství se odepíše ze skladu.</div>
  <div class="sig"><div>Vydal (skladník)</div><div>Převzal (výroba)</div></div>`);
}
function transferHtml() {
  const rows = [['Motor pračky 18 kg', 6, 'ks', 'A-02-3', 'V-01-1'], ['Ložisko 6205 2RS', 24, 'ks', 'A-02-3', 'V-01-2'], ['Řemen pohonu — sada', 6, 'ks', 'B-03-2', 'V-01-3']].map((r, i) => `<tr><td class="c">${i + 1}</td><td class="d">${esc(r[0])}</td><td class="r">${r[1]} ${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('');
  return shell('Přesun materiálu', 'PM-2026-00017', 'Skladový doklad', `
  <div class="parties"><div class="party"><span class="h">Z (zdroj)</span><div class="name">Sklad A — hlavní sklad</div><div class="row">Brno, Ukázková 123</div></div><div class="party"><span class="h">Do (cíl)</span><div class="name">Sklad Výroba</div><div class="row">Brno, hala 2</div></div></div>
  <div class="meta"><div><div class="l">Datum přesunu</div><div class="v">7. 10. 2026</div></div><div><div class="l">Důvod</div><div class="v">Zásobení výroby</div></div><div><div class="l">Přesunul</div><div class="v">Jana Skladnice</div></div><div><div class="l">Převzal</div><div class="v">Petr Montér</div></div></div>
  <table class="items"><thead><tr><th>#</th><th>Položka</th><th class="r">Množství</th><th>Z pozice</th><th>Na pozici</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="box"><h3>Poznámka</h3>Vnitřní přesun mezi sklady — nemění celkový stav zásob, mění jen umístění.</div>
  <div class="sig"><div>Odeslal (zdrojový sklad)</div><div>Převzal (cílový sklad)</div></div>`);
}
function reminderHtml(level) {
  const inv = { invoice_number: 'FV-2026-00009', date_issued: '2026-09-10', date_due: '2026-09-24', total: 1796850, currency: 'CZK', variable_symbol: '2026000009' };
  const today = new Date('2026-09-24'); today.setDate(today.getDate() + (level === 1 ? 7 : level === 2 ? 14 : 21));
  const r = buildReminder({ level, invoice: inv, partner: Object.assign({ country: 'CZ' }, CUSTOMER), us: { name: OUR.name, iban: OUR.iban }, today });
  const names = { 1: ['1. upomínka', 'Zdvořilá připomínka — 7 dní po splatnosti'], 2: ['2. upomínka', 'Důraznější výzva — 14 dní po splatnosti'], 3: ['3. upomínka', 'Předsoudní upomínka — 21 dní po splatnosti'] };
  return shell('Upomínka', 'UP-2026-0' + level, names[level][1], `
  <div class="parties">${party('Odesílatel', OUR)}${party('Adresát', CUSTOMER)}</div>
  <div class="box" style="margin-top:0"><h3>Předmět</h3><b>${esc(r.subject)}</b></div>
  <div class="letter">${esc(r.body).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</div>`);
}

const CATALOG = [
  { key: 'invoice_issued',   group: 'Vydané doklady', name: 'Faktura vydaná', desc: 'Daňový doklad pro odběratele s QR platbou.', used: 'Účetní doklady → Vydané' },
  { key: 'invoice_proforma', group: 'Vydané doklady', name: 'Zálohová faktura', desc: 'Výzva k zaplacení zálohy (není daňový doklad).', used: 'Prodejní objednávky → záloha' },
  { key: 'invoice_tax_receipt', group: 'Vydané doklady', name: 'Daňový doklad k přijaté platbě (DPPP)', desc: 'Doklad k přijaté záloze po spárování platby.', used: 'Automaticky po spárování platby' },
  { key: 'invoice_credit',   group: 'Vydané doklady', name: 'Dobropis vydaný', desc: 'Opravný doklad snižující fakturovanou částku.', used: 'Účetní doklady → Vydané' },
  { key: 'offer',            group: 'Obchod', name: 'Cenová nabídka', desc: 'Nabídka prádlomatu s platebními podmínkami a akceptací.', used: 'Prodejní objednávky' },
  { key: 'order',            group: 'Obchod', name: 'Potvrzená objednávka', desc: 'Potvrzení objednávky se sloty výroby a platebním kalendářem.', used: 'Prodejní objednávky → průvodce' },
  { key: 'delivery_note',    group: 'Sklad a expedice', name: 'Dodací list', desc: 'Předávací doklad k expedici s podpisy.', used: 'Prodejní objednávky / Skladové doklady' },
  { key: 'goods_issue',      group: 'Sklad a expedice', name: 'Výdejka', desc: 'Doklad o výdeji materiálu ze skladu do výroby / na zakázku.', used: 'Skladové doklady' },
  { key: 'stock_transfer',   group: 'Sklad a expedice', name: 'Přesun materiálu (převodka)', desc: 'Doklad o přesunu zboží mezi sklady nebo pozicemi.', used: 'Skladové doklady / Sklady' },
  { key: 'goods_receipt',    group: 'Sklad a expedice', name: 'Příjemka', desc: 'Doklad o příjmu zboží na sklad.', used: 'Skladové doklady' },
  { key: 'invoice_received', group: 'Přijaté doklady', name: 'Faktura přijatá (evidenční karta)', desc: 'Vzhled přijaté faktury při vlastním tisku / archivaci.', used: 'Účetní doklady → Přijaté' },
  { key: 'reminder_1',       group: 'Upomínky', name: '1. upomínka', desc: 'Zdvořilá připomínka — 7 dní po splatnosti.', used: 'Automatické upomínky' },
  { key: 'reminder_2',       group: 'Upomínky', name: '2. upomínka', desc: 'Důraznější výzva — 14 dní po splatnosti.', used: 'Automatické upomínky' },
  { key: 'reminder_3',       group: 'Upomínky', name: '3. upomínka', desc: 'Předsoudní upomínka — 21 dní po splatnosti.', used: 'Automatické upomínky' },
];

async function renderPreview(key) {
  switch (key) {
    case 'invoice_issued': return renderInvoiceHtml(sampleInvoice('issued', 'ar'));
    case 'invoice_proforma': return renderInvoiceHtml(sampleInvoice('proforma_issued', 'ar', { note: 'Zálohová faktura — neslouží jako daňový doklad.' }));
    case 'invoice_tax_receipt': return renderInvoiceHtml(sampleInvoice('tax_receipt', 'ar', { items: [Object.assign({}, ITEMS[0], { description: 'Přijatá záloha 75 % — Prádlomat PRO CZ', unit_price: 1087500, subtotal: 1087500, vat_amount: 228375, total: 1315875 })], subtotal: 1087500, vat_amount: 228375, total: 1315875 }));
    case 'invoice_credit': return renderInvoiceHtml(sampleInvoice('credit_note_issued', 'ar', { items: [Object.assign({}, ITEMS[1], { description: 'Dobropis — sleva na dopravu', unit_price: -5000, subtotal: -5000, vat_amount: -1050, total: -6050 })], subtotal: -5000, vat_amount: -1050, total: -6050, note: 'Opravný daňový doklad k faktuře FV-2026-00012.' }));
    case 'invoice_received': return renderInvoiceHtml(sampleInvoice('received', 'ap', { note: 'Přijatá faktura — evidenční karta.' }));
    case 'offer': return offerHtml();
    case 'goods_receipt': return receiptHtml();
    case 'goods_issue': return issueHtml();
    case 'stock_transfer': return transferHtml();
    case 'reminder_1': return reminderHtml(1);
    case 'reminder_2': return reminderHtml(2);
    case 'reminder_3': return reminderHtml(3);
    case 'delivery_note':
      return deliveryNote.buildHtml({ number: 'DL-2026-00018', date_issued: new Date('2026-10-05'), customer_name: CUSTOMER.name, order_number: 'SO-MUZ7QI1S', note: 'Zboží převzato bez výhrad.', items: [{ name: 'Prádlomat PRO CZ', quantity: 1, unit: 'ks', serial_number: 'PRO-2026-0042' }, { name: 'Sada klíčů a dokumentace', quantity: 1, unit: 'ks' }] }, { name: OUR.name, address: addr(OUR), ico: OUR.ico, dic: OUR.dic }, { demo: true });
    case 'order':
      return orderPdf.buildHtml({ order_number: 'SO-MUZ7QI1S', currency: 'CZK', company: Object.assign({}, CUSTOMER), total_amount: 1485000, payment_split: true, deposit_percent: 75, created_at: new Date('2026-10-01'), authorized_at: new Date('2026-10-02'), items: [{ name: 'Prádlomat PRO CZ', quantity: 1, unit_price: 1450000, note: 'TYP:L1H2W3D1' }, { name: 'Doprava a montáž', quantity: 1, unit_price: 35000 }] }, OUR, { slotDates: [new Date('2026-12-07')], demo: true });
    default: return null;
  }
}

module.exports = { CATALOG, renderPreview };
