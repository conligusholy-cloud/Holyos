// =============================================================================
// HolyOS — Generátor smluv k lokalitě (Site)
// =============================================================================
// Tři typy smluv se sdílenou strukturou:
//   kupni      — Kupní smlouva na kiosek (§ 2079 a násl. NOZ)
//   servisni   — Servisní smlouva o zajištění provozu za odměnu 13 % (§ 1746/2)
//   rezervacni — Rezervační smlouva na konkrétní lokalitu
//
// Každá smlouva má:
//   - FIELD schéma (skupiny + pole) — pro editovatelný formulář na FE
//   - buildDefaults() — předvyplnění z dat lokality (Site) a naší firmy
//   - render funkci → HTML → PDF přes sdílený Puppeteer (invoice-pdf.htmlToPdfBuffer)
//
// Pole ponechaná prázdná se v PDF vykreslí jako tečkovaná linka k dopsání.
// =============================================================================

'use strict';

// ─── Puppeteer (sdílený browser, lazy) ────────────────────────────────────────
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  let puppeteer;
  try { puppeteer = require('puppeteer'); }
  catch (e) { throw new Error('Puppeteer není nainstalovaný. Spusť `npm install puppeteer` v rootu HolyOS.'); }
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  return _browser;
}
async function htmlToPdfBuffer(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    const pdfRaw = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
    });
    return Buffer.isBuffer(pdfRaw) ? pdfRaw : Buffer.from(pdfRaw);
  } finally {
    await page.close().catch(() => {});
  }
}

const TYPES = ['kupni', 'servisni', 'rezervacni'];

const TYPE_LABEL = {
  kupni: 'Kupní smlouva',
  servisni: 'Servisní smlouva',
  rezervacni: 'Rezervační smlouva',
};

// ─── Helpery ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// hodnota pro zobrazení: prázdné → tečkovaná linka; víceřádkové → <br>
function v(val, width) {
  if (val === undefined || val === null || String(val).trim() === '') {
    return `<span class="fill">${'&nbsp;'.repeat(width || 24)}</span>`;
  }
  return esc(val).replace(/\n/g, '<br>');
}

function fmtNum(n) {
  const num = Number(n);
  if (!isFinite(num)) return '';
  return Math.round(num).toLocaleString('cs-CZ').replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ');
}

const VERSION_SPEC = {
  V2: 'velká pračka 18 kg, sušička 18 kg',
  V3: 'malá pračka 8 kg, velká pračka 18 kg, sušička 18 kg',
  V4: 'velká pračka 18 kg, velká pračka 18 kg, sušička 18 kg, sušička 18 kg',
};
function versionSpec(ver) {
  return VERSION_SPEC[String(ver || '').toUpperCase()] || '';
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return `${dt.getDate()}. ${dt.getMonth() + 1}. ${dt.getFullYear()}`;
}

function joinAddr(c) {
  if (!c) return '';
  const parts = [];
  if (c.address) parts.push(c.address);
  const cityLine = [c.zip, c.city].filter(Boolean).join(' ');
  if (cityLine) parts.push(cityLine);
  if (c.country && c.country !== 'CZ') parts.push(c.country);
  return parts.join(', ');
}

function siteLocationLine(site) {
  if (!site) return '';
  const bits = [];
  if (site.name) bits.push(site.name);
  const addr = joinAddr(site);
  if (addr) bits.push(addr);
  return bits.join(' — ');
}

// ─── FIELD schémata (pořadí = pořadí ve formuláři) ────────────────────────────

const SELLER_GROUP = (roleLabel) => ({
  key: 'seller', title: roleLabel, fields: [
    { name: 'seller_name', label: 'Název / jméno', type: 'text' },
    { name: 'seller_address', label: 'Sídlo / adresa', type: 'text' },
    { name: 'seller_ico', label: 'IČO', type: 'text' },
    { name: 'seller_dic', label: 'DIČ', type: 'text' },
    { name: 'seller_rep', label: 'Zastoupen(a)', type: 'text' },
    { name: 'seller_bank', label: 'Bankovní spojení', type: 'text' },
  ],
});

const BUYER_GROUP = (roleLabel) => ({
  key: 'buyer', title: roleLabel, fields: [
    { name: 'buyer_name', label: 'Název / jméno', type: 'text' },
    { name: 'buyer_address', label: 'Sídlo / adresa', type: 'text' },
    { name: 'buyer_ico', label: 'IČO', type: 'text' },
    { name: 'buyer_dic', label: 'DIČ', type: 'text' },
    { name: 'buyer_rep', label: 'Zastoupen(a)', type: 'text' },
    { name: 'buyer_bank', label: 'Bankovní spojení', type: 'text' },
  ],
});

const SCHEMAS = {
  kupni: [
    SELLER_GROUP('Prodávající'),
    BUYER_GROUP('Kupující'),
    { key: 'subject', title: 'Předmět koupě', fields: [
      { name: 'kiosek_type', label: 'Typ / verze prádlomatu', type: 'text' },
      { name: 'location_desc', label: 'Lokalita (kód a adresa)', type: 'text' },
      { name: 'kiosek_spec', label: 'Výbava / software / příslušenství', type: 'textarea' },
    ]},
    { key: 'price', title: 'Kupní cena', fields: [
      { name: 'price_machine', label: 'Cena stroje (bez DPH)', type: 'text' },
      { name: 'price_location', label: 'Cena lokality (bez DPH)', type: 'text' },
      { name: 'price_total', label: 'Celková cena (bez DPH)', type: 'text' },
      { name: 'reservation_credit', label: 'Odečet rezervačního poplatku', type: 'text' },
      { name: 'payment_days', label: 'Splatnost / účinnost (dní)', type: 'text' },
    ]},
    { key: 'warranty', title: 'Záruka a reklamace', fields: [
      { name: 'warranty_months', label: 'Záruka pro podnikatele (měsíců)', type: 'text' },
      { name: 'complaint_contact', label: 'Kontakt pro reklamace', type: 'text' },
    ]},
    { key: 'service', title: 'Servis', fields: [
      { name: 'reaction_time', label: 'Reakční doba na závadu', type: 'text' },
      { name: 'fix_time', label: 'Lhůta odstranění závady', type: 'text' },
    ]},
    { key: 'buyback', title: 'Předkupní právo a odkup', fields: [
      { name: 'buyback_decision_months', label: 'Lhůta na rozhodnutí (měsíců)', type: 'text' },
      { name: 'buyback_key_months', label: 'Násobek obratu pro klíč (×)', type: 'text' },
      { name: 'amortization_pct', label: 'Roční amortizace stroje (%)', type: 'text' },
      { name: 'resale_commission_pct', label: 'Provize za zprostředkování (%)', type: 'text' },
      { name: 'removal_notice_months', label: 'Oznámení o odstranění stroje (měsíců)', type: 'text' },
      { name: 'buyback_guarantee_pct', label: 'Garance odkupu (% celkové ceny)', type: 'text' },
      { name: 'buyback_guarantee_years', label: 'Garance odkupu po (letech)', type: 'text' },
    ]},
    { key: 'system', title: 'Systémové služby a podpis', fields: [
      { name: 'service_pct', label: 'Servisní odměna (%)', type: 'text' },
      { name: 'system_fee', label: 'Systémový poplatek (měsíc/stroj)', type: 'text' },
      { name: 'place_signed', label: 'Místo podpisu', type: 'text' },
    ]},
  ],
  servisni: [
    SELLER_GROUP('Poskytovatel (provozovatel)'),
    BUYER_GROUP('Objednatel (vlastník kiosku)'),
    { key: 'subject', title: 'Předmět a lokalita', fields: [
      { name: 'location_desc', label: 'Lokalita / umístění kiosku', type: 'text' },
    ]},
    { key: 'fee', title: 'Odměna', fields: [
      { name: 'fee_pct', label: 'Odměna (%)', type: 'text' },
      { name: 'fee_base', label: 'Základ pro výpočet', type: 'text' },
      { name: 'billing_period', label: 'Zúčtovací období', type: 'text' },
      { name: 'due_days', label: 'Splatnost (dní)', type: 'text' },
      { name: 'settlement', label: 'Vypořádání tržeb', type: 'textarea' },
      { name: 'system_value', label: 'Hodnota systémových služeb samostatně', type: 'text' },
    ]},
    { key: 'terms', title: 'Trvání a podpis', fields: [
      { name: 'term_type', label: 'Doba trvání', type: 'text' },
      { name: 'notice_months', label: 'Výpovědní doba (měsíců)', type: 'text' },
      { name: 'place_signed', label: 'Místo podpisu', type: 'text' },
    ]},
  ],
  rezervacni: [
    SELLER_GROUP('Poskytovatel (budoucí prodávající)'),
    BUYER_GROUP('Zájemce'),
    { key: 'subject', title: 'Předmět rezervace', fields: [
      { name: 'location_name', label: 'Rezervovaná lokalita', type: 'text' },
      { name: 'location_address', label: 'Adresa lokality', type: 'text' },
      { name: 'reservation_desc', label: 'Popis / účel rezervace', type: 'textarea' },
    ]},
    { key: 'conditions', title: 'Podmínky rezervace', fields: [
      { name: 'reservation_fee', label: 'Rezervační poplatek / záloha', type: 'text' },
      { name: 'reservation_fee_currency', label: 'Měna poplatku', type: 'text' },
      { name: 'reservation_fee_words', label: 'Poplatek slovy', type: 'text' },
      { name: 'fee_due_days', label: 'Splatnost poplatku (dní; prázdné = v den podpisu)', type: 'text' },
      { name: 'reservation_period', label: 'Doba rezervace', type: 'text' },
      { name: 'reserved_until', label: 'Rezervováno do', type: 'text' },
      { name: 'credit_to_price', label: 'Započtení poplatku', type: 'text' },
      { name: 'refund_terms', label: 'Vrácení / propadnutí poplatku', type: 'textarea' },
      { name: 'future_contract', label: 'Navazující smlouva', type: 'text' },
      { name: 'place_signed', label: 'Místo podpisu', type: 'text' },
    ]},
  ],
};

// ─── Předvyplnění z lokality + naší firmy ─────────────────────────────────────

function ourDefaults(our) {
  return {
    seller_name: our?.name || 'BEST SERIES s.r.o.',
    seller_address: joinAddr(our) || 'Zámostní 1155/27, Slezská Ostrava, 71000 Ostrava',
    seller_ico: our?.ico || '05643724',
    seller_dic: our?.dic || 'CZ05643724',
    seller_rep: '',
    seller_bank: our?.iban || our?.bank_account || '221913663/0600',
  };
}

function counterpartyDefaults(site) {
  // Protistrana: preferuj navázanou firmu, jinak primární kontakt.
  const company = site?.company;
  const primary = (site?.contacts || []).find(c => c.is_primary) || (site?.contacts || [])[0];
  return {
    buyer_name: company?.name || primary?.name || '',
    buyer_address: primary?.company ? '' : '',
    buyer_ico: company?.ico || '',
    buyer_dic: '',
    buyer_rep: '',
    buyer_bank: '',
  };
}

function buildDefaults(type, site, our) {
  const base = { ...ourDefaults(our), ...counterpartyDefaults(site) };
  const loc = siteLocationLine(site);
  const addr = joinAddr(site) || (site?.name || '');

  if (type === 'kupni') {
    const months = site?._locationMonths != null ? site._locationMonths : 12;
    const machine = (site?._machinePrice != null && site._machinePrice !== '') ? Number(site._machinePrice) : null;
    const locPrice = site?.purchase_price != null ? Number(site.purchase_price) : null;
    const total = (machine != null || locPrice != null) ? ((machine || 0) + (locPrice || 0)) : null;
    const ver = String(site?._version || site?.pradlomat_ref || '').toUpperCase();
    return {
      ...base,
      kiosek_type: ver,
      location_desc: loc,
      kiosek_spec: versionSpec(ver),
      price_machine: machine != null ? fmtNum(machine) : '',
      avg_turnover_vat: site?._avgTurnover != null ? fmtNum(site._avgTurnover) : '',
      location_months: String(months),
      price_location: locPrice != null ? fmtNum(locPrice) : '',
      price_total: total != null ? fmtNum(total) : '',
      reservation_credit: '',
      payment_days: '2',
      warranty_months: '12',
      complaint_contact: 'info@bestseries.cz',
      reaction_time: '48 hodin',
      fix_time: '5 pracovních dní',
      buyback_decision_months: '12',
      buyback_key_months: '12',
      amortization_pct: '10',
      resale_commission_pct: '10',
      removal_notice_months: '3',
      buyback_guarantee_pct: String(site?._buybackPct != null ? site._buybackPct : 65),
      buyback_guarantee_years: String(site?._buybackYears != null ? site._buybackYears : 5),
      service_pct: String(site?._servicePct != null ? site._servicePct : 15),
      system_fee: '100 EUR / měsíc',
      place_signed: site?.city || '',
    };
  }
  if (type === 'servisni') {
    return {
      ...base,
      location_desc: loc,
      fee_pct: String(site?._servicePct != null ? site._servicePct : 15),
      fee_base: 'z obratu s DPH dosaženého provozem kiosku za příslušné období',
      billing_period: 'kalendářní měsíc',
      due_days: '14',
      settlement: 'Poskytovatel inkasuje tržby (výběry) z kiosku, sráží si odměnu 15 % a zbývající částku poukazuje objednateli.',
      system_value: '100 EUR / měsíc',
      term_type: 'neurčitou',
      notice_months: '3',
      place_signed: site?.city || '',
    };
  }
  // rezervacni
  return {
    ...base,
    location_name: site?.name || '',
    location_address: addr,
    reservation_desc: 'Rezervace konkrétní lokality pro budoucí umístění a provoz kiosku (prádlomatu) zájemcem.',
    reservation_fee: site?.deposit != null ? String(site.deposit) : '',
    reservation_fee_currency: 'Kč',
    reservation_fee_words: '',
    fee_due_days: '',
    reservation_period: '3 dny (72 hodin)',
    reserved_until: '',
    credit_to_price: 'Rezervační poplatek se v případě uzavření kupní smlouvy započítává na kupní cenu.',
    refund_terms: 'Nedojde-li k uzavření navazující smlouvy z důvodu na straně poskytovatele, rezervační poplatek se zájemci vrací. Nedojde-li k jejímu uzavření z důvodu na straně zájemce, poplatek propadá ve prospěch poskytovatele jako paušální náhrada.',
    future_contract: 'kupní smlouva, popř. servisní smlouva',
    place_signed: site?.city || '',
  };
}

// Anglické varianty výchozích TEXTŮ polí (částky/čísla zůstávají stejné).
// Použijí se, když je smlouva v jiném jazyce než čeština (fields._lang).
const EN_TEXT_DEFAULTS = {
  kupni: {
    reaction_time: '48 hours',
    fix_time: '5 business days',
    system_fee: 'EUR 100 / month',
  },
  servisni: {
    fee_base: 'of the turnover incl. VAT generated by the operation of the kiosk for the relevant period',
    billing_period: 'calendar month',
    settlement: 'The Provider collects the revenue (cash-outs) from the kiosk, deducts its 15% remuneration and remits the remaining amount to the Client.',
    system_value: 'EUR 100 / month',
    term_type: 'an indefinite period',
  },
  rezervacni: {
    reservation_desc: 'Reservation of a specific location for the future placement and operation of a self-service laundry kiosk by the Prospective Buyer',
    reservation_fee_currency: 'CZK',
    reservation_period: '3 days (72 hours)',
    credit_to_price: 'If a purchase agreement is concluded, the reservation fee is credited towards the purchase price.',
    refund_terms: 'If the follow-up agreement is not concluded for reasons on the Provider’s side, the reservation fee is refunded to the Prospective Buyer. If it is not concluded for reasons on the Prospective Buyer’s side, the fee is forfeited to the Provider as a lump-sum compensation.',
    future_contract: 'a purchase agreement or, as the case may be, a service agreement',
  },
};

// ─── HTML šablona ─────────────────────────────────────────────────────────────

function shell(title, subtitle, body, en) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 11.5px; line-height: 1.5; margin: 0; }
  h1 { text-align: center; font-size: 20px; letter-spacing: 1px; margin: 0 0 4px; text-transform: uppercase; }
  .sub { text-align: center; font-size: 11px; color: #555; margin: 0 0 2px; }
  .law { text-align: center; font-size: 9.5px; color: #888; font-style: italic; margin: 0 0 18px; }
  h2 { font-size: 12.5px; margin: 18px 0 6px; text-align: center; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #d8d8d8; padding-bottom: 3px; }
  .party { margin: 4px 0 10px; }
  .party .role { font-weight: 700; margin-bottom: 2px; }
  .party .line { margin: 0; }
  .amp { text-align: center; font-weight: 700; margin: 6px 0; }
  ol { margin: 4px 0 8px; padding-left: 20px; }
  ol.letters { list-style: lower-alpha; }
  li { margin: 3px 0; }
  .fill { border-bottom: 1px dotted #999; }
  .sig { margin-top: 40px; display: flex; justify-content: space-between; gap: 40px; }
  .sig .box { flex: 1; text-align: center; }
  .sig .rule { border-top: 1px solid #333; margin-top: 46px; padding-top: 4px; font-weight: 700; }
  .sig .box img.sigimg { display:block; margin:0 auto; max-height:64px; max-width:230px; }
  .sig .box img.sigimg + .rule { margin-top: 4px; }
  .sig .sigdate { font-size: 10px; color: #777; margin-top: 2px; }
  .place { margin-top: 26px; }
  .note { color:#666; font-size: 10px; }
  .attach { margin-top: 16px; font-size: 10.5px; }
  @page { size: A4; }
  </style></head><body>
  <h1>${esc(title)}</h1>
  ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
  <p class="law">${en
    ? 'concluded pursuant to the applicable provisions of Act No. 89/2012 Coll., the Czech Civil Code, as amended'
    : 'uzavřená podle příslušných ustanovení zákona č. 89/2012 Sb., občanský zákoník, v platném znění'}</p>
  ${body}
  </body></html>`;
}

// Jazyk smlouvy: fields._lang (2písmenný kód z portálu). Čeština pro cs, jinak angličtina.
function isEn(d) {
  const l = String((d && d._lang) || 'cs').toLowerCase();
  return !l.startsWith('cs');
}

function partyBlock(role, d, p, en) {
  if (en) {
    return `<div class="party">
    <div class="role">${esc(role)}:</div>
    <p class="line">${v(d[p + '_name'])}</p>
    <p class="line">registered office / address: ${v(d[p + '_address'])}</p>
    <p class="line">Company ID: ${v(d[p + '_ico'], 10)}${d[p + '_dic'] ? ', VAT ID: ' + esc(d[p + '_dic']) : ', VAT ID: ' + v('', 10)}</p>
    <p class="line">represented by: ${v(d[p + '_rep'])}</p>
    <p class="line">bank account: ${v(d[p + '_bank'])}</p>
  </div>`;
  }
  return `<div class="party">
    <div class="role">${esc(role)}:</div>
    <p class="line">${v(d[p + '_name'])}</p>
    <p class="line">se sídlem / adresa: ${v(d[p + '_address'])}</p>
    <p class="line">IČO: ${v(d[p + '_ico'], 10)}${d[p + '_dic'] ? ', DIČ: ' + esc(d[p + '_dic']) : ', DIČ: ' + v('', 10)}</p>
    <p class="line">zastoupen(a): ${v(d[p + '_rep'])}</p>
    <p class="line">bankovní spojení: ${v(d[p + '_bank'])}</p>
  </div>`;
}

function sigCell(label, sig, en) {
  if (sig && sig.image) {
    var locale = en ? 'en-GB' : 'cs-CZ';
    var word = en ? 'Signed on' : 'Podepsáno';
    var when = sig.signed_at ? ('<div class="sigdate">' + word + ' ' + new Date(sig.signed_at).toLocaleString(locale) + '</div>') : '';
    return '<div class="box"><img class="sigimg" src="' + sig.image + '" alt="podpis"><div class="rule">' + esc(label) + (sig.name ? (' — ' + esc(sig.name)) : '') + '</div>' + when + '</div>';
  }
  return '<div class="box"><div class="rule">' + esc(label) + '</div></div>';
}
function sigBlock(leftLabel, rightLabel, place, leftSig, rightSig, en) {
  // Datum podpisu = datum posledního z podpisů (kdy je smlouva uzavřena).
  let dt = null;
  [leftSig, rightSig].forEach((s) => {
    if (s && s.signed_at) { const t = new Date(s.signed_at); if (!isNaN(t) && (!dt || t > dt)) dt = t; }
  });
  const dateStr = dt ? esc(dt.toLocaleDateString(en ? 'en-GB' : 'cs-CZ')) : '..............................';
  const line = en
    ? ('In ' + v(place, 18) + ' on ' + dateStr)
    : ('V ' + v(place, 18) + ' dne ' + dateStr);
  return '<p class="place">' + line + '</p>\n  <div class="sig">' + sigCell(leftLabel, leftSig, en) + sigCell(rightLabel, rightSig, en) + '</div>';
}

function renderKupni(d) {
  if (isEn(d)) return renderKupniEn(d);
  const body = `
    <h2>Smluvní strany</h2>
    ${partyBlock('Prodávající', d, 'seller')}
    <div class="amp">a</div>
    ${partyBlock('Kupující', d, 'buyer')}
    <p class="note">(společně dále jen „smluvní strany")</p>

    <h2>Preambule</h2>
    <ol>
      <li>Prodávající je výrobcem a provozovatelem samoobslužných prádelen (prádlomatů) provozovaných pod značkou <strong>Best Series</strong>.</li>
      <li>Na Lokalitě dle této smlouvy <strong>již stojí a je v plném provozu</strong> prádlomat prodávajícího, který obsluhuje zákazníky, generuje reálný obrat a zajišťuje nepřetržitý provoz.</li>
      <li>Předmětem této smlouvy je prodej nového Stroje kupujícímu a současně převod <strong>ekonomického užívání této zavedené a fungující Lokality</strong> tak, aby kupující od okamžiku účinnosti smlouvy čerpal přínos již existujícího provozu a klientely a <strong>nikdy nečekal na zahájení podnikání</strong>.</li>
      <li>Nový Stroj bude vyroben prodávajícím a po dokončení výroby jím bude <strong>bez přerušení provozu</strong> nahrazen stávající Stroj na Lokalitě.</li>
    </ol>

    <h2>Článek I — Výklad pojmů</h2>
    <ol class="letters">
      <li><strong>Stroj</strong> — nové zařízení (prádlomat) verze <strong>${v(d.kiosek_type)}</strong> specifikované v Příloze č. 1;</li>
      <li><strong>Lokalita</strong> — provozní místo dle článku III: ${v(d.location_desc)};</li>
      <li><strong>Zavedený provoz</strong> — již existující, funkční a výnosný provoz prádlomatu na Lokalitě ke dni účinnosti smlouvy;</li>
      <li><strong>Výrobní slot</strong> — konkrétní výrobní kapacita ve výrobním plánu prodávajícího přidělovaná dle článku VI;</li>
      <li><strong>Systémové služby</strong> — služby dle článku IX nezbytné pro dlouhodobou provozuschopnost Stroje.</li>
    </ol>

    <h2>Článek II — Předmět koupě</h2>
    <ol>
      <li>Předmětem smlouvy je závazek prodávajícího <strong>vyrobit a dodat</strong> kupujícímu nový Stroj verze <strong>${v(d.kiosek_type)}</strong> a současně převést na kupujícího <strong>ekonomické užívání Zavedeného provozu Lokality</strong>, a závazek kupujícího zaplatit kupní cenu a Stroj převzít.</li>
      <li>Sestava Stroje dle verze ${v(d.kiosek_type)}: ${v(d.kiosek_spec)}. Součástí dodávky je software a řídicí systém Stroje, dokumentace, návod a prohlášení o shodě.</li>
      <li>Předmět koupě tvoří <strong>nedělitelný celek</strong> — Stroj a ekonomické užívání Lokality nelze převádět odděleně, není-li dále stanoveno jinak.</li>
      <li>Prodávající prohlašuje, že bude výlučným výrobcem a vlastníkem Stroje až do přechodu vlastnického práva dle článku VI a že Stroj nebude zatížen právy třetích osob.</li>
    </ol>

    <h2>Článek III — Postavení Lokality</h2>
    <ol>
      <li>Kupující bere na vědomí a výslovně souhlasí, že <strong>nenabývá žádná věcná ani závazková práva k Lokalitě</strong> — zejména k pozemku, prostoru, nájmu ani přípojkám. Užívací právo k Lokalitě náleží výhradně prodávajícímu (na základě nájmu, nebo jako vlastníku pozemku).</li>
      <li>Kupující kupní cenou nabývá <strong>ekonomické právo</strong> provozovat svůj Stroj na této zavedené a ověřené Lokalitě a <strong>těžit z jejího Zavedeného provozu a klientely</strong> po dobu trvání užívacího práva prodávajícího k Lokalitě.</li>
      <li>Předmětem koupě tedy <strong>není</strong> nájem, pozemek ani jiné právo k nemovitosti, nýbrž <strong>ekonomická hodnota zavedeného a fungujícího provozu</strong>.</li>
      <li>Je-li Stroj provozován na Lokalitě Best Series, zavazuje se kupující provozovat jej výhradně <strong>pod značkou (brandem) Best Series</strong> a dodržovat její jednotná pravidla.</li>
      <li>Zamýšlí-li kupující odstranit svůj Stroj z Lokality, je povinen to prodávajícímu <strong>písemně oznámit nejméně ${v(d.removal_notice_months, 3)} měsíce předem</strong>.</li>
    </ol>

    <h2>Článek IV — Kupní cena</h2>
    <ol>
      <li>Kupní cena je složena ze dvou složek:</li>
    </ol>
    <ol class="letters">
      <li>cena Stroje: <strong>${v(d.price_machine, 12)} ${esc(d.price_currency || 'Kč')}</strong> bez DPH;</li>
      <li>cena Lokality (úplata za převzetí ekonomického užívání Zavedeného provozu): <strong>${v(d.price_location, 12)} ${esc(d.price_currency || 'Kč')}</strong> bez DPH.</li>
    </ol>
    <ol start="2">
      <li>Celková kupní cena činí <strong>${v(d.price_total, 12)} ${esc(d.price_currency || 'Kč')}</strong> bez DPH; ${d._reverse_charge
        ? 'kupující je osobou registrovanou k DPH v jiném členském státě EU — plnění je osvobozeno od české DPH a daň přizná kupující v režimu přenesené daňové povinnosti (reverse charge, čl. 196 směrnice Rady 2006/112/ES); fakturace probíhá bez DPH'
        : 'k ceně bude připočtena DPH v zákonné výši'}.</li>
      <li>Byla-li k téže Lokalitě uzavřena rezervační smlouva, započítává se již uhrazený rezervační poplatek ${v(d.reservation_credit, 10)} ${esc(d.price_currency || 'Kč')} na kupní cenu.</li>
      <li>Kupní cena zahrnuje výrobu nového Stroje, jeho instalaci a výměnu za stávající Stroj na Lokalitě dle článku VI.</li>
    </ol>

    <h2>Článek V — Platební podmínky a účinnost</h2>
    <ol>
      <li>Kupující hradí <strong>celou kupní cenu jednorázově předem</strong>, sníženou o případný již uhrazený rezervační poplatek dle článku IV.</li>
      <li>Smluvní strany výslovně sjednávají, že plná úhrada předem je <strong>vyvážená a odpovídá povaze plnění</strong>, neboť kupující od okamžiku účinnosti smlouvy čerpá ekonomický přínos Zavedeného provozu Lokality (nikoli až po dodání nového Stroje) a prodávající zároveň na základě úhrady zařazuje Stroj do výroby dle článku VI.</li>
      <li>Kupní cena je splatná do <strong>${v(d.payment_days, 3)} dnů</strong> od podpisu smlouvy, bezhotovostně na účet prodávajícího.</li>
      <li>Smlouva se stává <strong>účinnou dnem připsání</strong> celé kupní ceny na účet prodávajícího. Nebude-li kupní cena v této lhůtě uhrazena, smlouva <strong>nenabývá účinnosti</strong> a hledí se na ni, jako by nebyla uzavřena; prodávající je pak oprávněn nabídnout či prodat Lokalitu jinému zájemci.</li>
    </ol>

    <h2>Článek VI — Výroba, dodání a přechod vlastnictví</h2>
    <ol>
      <li><strong>Výrobní slot.</strong> Po připsání celé kupní ceny zařadí prodávající Stroj do výroby přidělením výrobního slotu. Výrobní slot je přidělován <strong>v pořadí podle okamžiku úplné úhrady kupní ceny jednotlivých objednávek</strong> (princip „kdo dříve plně zaplatí, dříve vyrábí"). Konkrétní termín výroby sdělí prodávající kupujícímu po zaplacení kupní ceny a naplánování výrobního slotu.</li>
      <li><strong>Kontinuita provozu.</strong> Do dokončení výroby a výměny provozuje na Lokalitě vlastní Stroj prodávajícího, takže provoz a výnos Lokality jsou zajištěny od okamžiku účinnosti bez přerušení; kupující nečeká na zahájení podnikání.</li>
      <li><strong>Výměna bez přerušení.</strong> Po dokončení výroby prodávající v rámci sjednané ceny zajistí výměnu stávajícího Stroje za nový Stroj kupujícího na Lokalitě a jeho uvedení do provozu tak, aby nedošlo k přerušení provozu Lokality. O předání se sepíše předávací protokol (Příloha č. 2).</li>
      <li><strong>Vlastnické právo</strong> ke Stroji přechází na kupujícího okamžikem jeho vyrobení.</li>
      <li><strong>Nebezpečí škody</strong> na Stroji přechází na kupujícího jeho předáním (instalací) na Lokalitě.</li>
    </ol>

    <h2>Článek VII — Záruka a reklamace</h2>
    <ol>
      <li>Je-li kupujícím <strong>právnická osoba (podnikatel)</strong>, poskytuje prodávající na Stroj <strong>záruku za jakost v délce ${v(d.warranty_months, 3)} měsíců</strong> od předání. Je-li kupujícím <strong>spotřebitel</strong>, řídí se jeho práva z vadného plnění příslušnými ustanoveními občanského zákoníku.</li>
      <li>Záruka <strong>zahrnuje</strong> vady materiálu a výroby Stroje a jeho funkčních celků, které se projeví při obvyklém provozu.</li>
      <li>Záruka <strong>nezahrnuje</strong>: běžné opotřebení a spotřební díly; vady vzniklé nesprávnou obsluhou, neodborným zásahem, zanedbáním údržby či provozem v rozporu s návodem; poškození třetí osobou, živly či vyšší mocí; a vady vzniklé nedodržením Systémových služeb dle článku IX.</li>
      <li><strong>Reklamace</strong> se uplatňuje písemně (na ${v(d.complaint_contact)}) bez zbytečného odkladu po zjištění vady, s popisem vady a poskytnutím součinnosti. Prodávající vadu posoudí a v případě oprávněné reklamace ji odstraní v přiměřené lhůtě opravou nebo výměnou dílu.</li>
      <li>Náhradní díly a servisní práce <strong>mimo záruku</strong> (po uplynutí záruční doby nebo mimo rozsah záruky) hradí kupující.</li>
    </ol>

    <h2>Článek VIII — Servisní služby</h2>
    <ol>
      <li>Kupující hlásí závady prodávajícímu na ${v(d.complaint_contact)}.</li>
      <li>Prodávající vyvine úsilí reagovat na nahlášenou závadu v reakční době <strong>${v(d.reaction_time, 8)}</strong> a odstranit ji ve lhůtě <strong>${v(d.fix_time, 10)}</strong>, nebrání-li tomu okolnosti nezávislé na jeho vůli.</li>
      <li>Prodávající provádí <strong>vzdálenou diagnostiku</strong> Stroje a je oprávněn provádět servis prostřednictvím poddodavatelů, za jejichž činnost odpovídá jako za vlastní.</li>
      <li>Rozsah a ceny servisu nad rámec této smlouvy se řídí samostatnou servisní smlouvou nebo platným ceníkem prodávajícího.</li>
    </ol>

    <h2>Článek IX — Systémové služby a provozní režim</h2>
    <ol>
      <li>Kupující bere na vědomí, že <strong>dlouhodobý provoz Stroje není možný bez Systémových služeb</strong> prodávajícího, jimiž jsou zejména: správa systému a softwaru Stroje, odesílání SMS telemetrie zákazníkům, software pro sledování výkonu Stroje a systém pro správu a řízení personálu provozu. Tyto služby zajišťují funkčnost, bezpečnost, aktualizace a výkon Stroje.</li>
      <li>Systémové služby jsou poskytovány za poplatek <strong>${v(d.system_fee, 10)}</strong> za Stroj a jsou podmínkou dlouhodobé provozuschopnosti Stroje.</li>
      <li>Provozní režim si kupující zvolí: <strong>a) provoz prostřednictvím prodávajícího</strong> dle samostatné servisní smlouvy — odměna <strong>${v(d.service_pct, 3)} % z obratu</strong>, v níž jsou Systémové služby (poplatek 100 EUR) již zahrnuty; po dohodě lze k této odměně připočítat nájem za místo (dle skutečnosti) a energie (dle aktuální spotřeby). <strong>b) samostatný provoz</strong> — kupující hradí veškeré náklady provozu sám a nad rámec toho poplatek 100 EUR za Systémové služby dle odstavců 1 a 2.</li>
    </ol>

    <h2>Článek X — Předkupní právo a garance zpětného odkupu</h2>
    <ol>
      <li>Kupující zřizuje ve prospěch prodávajícího <strong>předkupní právo</strong> ke Stroji, a to jak k samotnému Stroji, tak ke Stroji společně s ekonomickým užíváním Lokality („místem"). Zamýšlí-li kupující převést Stroj (samostatně či s místem) na třetí osobu, je povinen jej <strong>nejprve písemně nabídnout prodávajícímu</strong> za podmínek dle odstavce 3.</li>
      <li>Prodávající má na rozhodnutí o využití předkupního práva lhůtu <strong>${v(d.buyback_decision_months, 3)} měsíců</strong> od doručení písemného oznámení kupujícího obsahujícího podstatné náležitosti zamýšleného převodu.</li>
      <li>Kupní cena při zpětném odkupu = <strong>aktuální hodnota Stroje + ${v(d.buyback_key_months, 3)}× průměrný obrat s DPH</strong> (hodnota místa), kde <strong>aktuální hodnota Stroje</strong> = pořizovací cena Stroje snížená o lineární opotřebení <strong>${v(d.amortization_pct, 3)} % ročně</strong> za dobu užívání; při neshodě stran se hodnota Stroje určí znaleckým posudkem, jehož náklady nesou strany rovným dílem.</li>
      <li>Nevyužije-li prodávající předkupní právo, může kupujícímu nabídnout <strong>zprostředkování prodeje Stroje</strong> třetí osobě prostřednictvím systému prodávajícího za provizi <strong>${v(d.resale_commission_pct, 3)} %</strong> z prodejní ceny stanovené dle téhož klíče.</li>
      <li><strong>Garance zpětného odkupu (opce kupujícího):</strong> kupující je oprávněn (nikoli povinen) požadovat po prodávajícím zpětný odkup Stroje spolu s ekonomickým užíváním Lokality za <strong>${v(d.buyback_guarantee_pct, 3)} %</strong> celkové kupní ceny dle článku IV.</li>
      <li>Právo dle odstavce 5 lze uplatnit <strong>pouze k ${v(d.buyback_guarantee_years, 2)}. výročí</strong> účinnosti smlouvy. Kupující je povinen prodávajícímu <strong>písemně oznámit, zda garantovaný odkup využije, nejpozději 1 rok před koncem ${v(d.buyback_guarantee_years, 2)}. roku</strong>. Neoznámí-li to v této lhůtě, právo na garantovaný odkup zaniká.</li>
    </ol>

    <h2>Článek XI — Ukončení užívacího práva k Lokalitě a relokace</h2>
    <ol>
      <li>Dojde-li k ukončení užívacího práva prodávajícího k Lokalitě ze strany pronajímatele (výpověď apod.), nabídne prodávající kupujícímu náhradní řešení: zajištění nové srovnatelné lokality, vyřešení přípojek a přepravu Stroje.</li>
      <li>Náhradní řešení se poskytuje jako služba za reálné aktuální tržní ceny dle konkrétní nové lokality a rozsahu prací; ceny budou předem sděleny a odsouhlaseny.</li>
      <li>Stroj zůstává ve vlastnictví kupujícího; přijetí náhradní lokality není povinné.</li>
    </ol>

    <h2>Článek XII — Vyšší moc</h2>
    <ol>
      <li>Žádná ze stran neodpovídá za nesplnění povinnosti způsobené <strong>vyšší mocí</strong> (okolnosti mimořádné, nepředvídatelné a neodvratitelné — zejména živelní události, válka, epidemie, výpadky dodávek či energií, úřední opatření).</li>
      <li>Dotčená strana druhou stranu o vyšší moci bez zbytečného odkladu vyrozumí. Po dobu trvání vyšší moci se lhůty (zejména výrobní) přiměřeně prodlužují.</li>
    </ol>

    <h2>Článek XIII — Závěrečná ustanovení</h2>
    <ol>
      <li>Doručování se provádí na kontaktní adresy a e-maily uvedené v záhlaví.</li>
      <li>Smlouva a vztahy z ní se řídí právem České republiky; k řešení sporů jsou příslušné soudy České republiky.</li>
      <li>Změny jen písemnými, vzestupně číslovanými dodatky.</li>
      <li>Je-li některé ustanovení neplatné či neúčinné, nemá to vliv na platnost ostatních; strany je nahradí ustanovením obsahově nejbližším.</li>
      <li>Smlouva představuje úplné ujednání stran a nahrazuje předchozí ujednání o témže předmětu.</li>
      <li>Smlouva je vyhotovena ve dvou stejnopisech (nebo elektronicky s uznávanými podpisy); strany ji uzavírají svobodně, vážně a bez tísně.</li>
    </ol>
    <p class="attach"><strong>Přílohy:</strong> č. 1 — Technická specifikace Stroje (dle verze); č. 2 — Předávací protokol (sériová čísla, specifikace, fotodokumentace, revize, verze SW, seznam dokumentace).</p>
    ${sigBlock('Prodávající', 'Kupující', d.place_signed, d._signature_bestseries, d._signature_customer)}`;
  return shell('Kupní smlouva', 'na dodávku prádlomatu a převzetí zavedené lokality', body);
}

function renderKupniEn(d) {
  const cur = esc(d.price_currency || 'CZK');
  const body = `
    <h2>Contracting Parties</h2>
    ${partyBlock('Seller', d, 'seller', true)}
    <div class="amp">and</div>
    ${partyBlock('Buyer', d, 'buyer', true)}
    <p class="note">(hereinafter jointly referred to as the "Parties")</p>

    <h2>Preamble</h2>
    <ol>
      <li>The Seller is a manufacturer and operator of self-service laundries (laundry kiosks) operated under the <strong>Best Series</strong> brand.</li>
      <li>A laundry kiosk of the Seller <strong>is already installed and in full operation</strong> at the Location under this agreement — it serves customers, generates real turnover and ensures uninterrupted operation.</li>
      <li>The subject of this agreement is the sale of a new Machine to the Buyer together with the transfer of the <strong>economic use of this established and functioning Location</strong>, so that the Buyer benefits from the existing operation and clientele from the moment this agreement takes effect and <strong>never waits for the business to start</strong>.</li>
      <li>The new Machine will be manufactured by the Seller and, once completed, will replace the existing Machine at the Location <strong>without interrupting operation</strong>.</li>
    </ol>

    <h2>Article I — Definitions</h2>
    <ol class="letters">
      <li><strong>Machine</strong> — a new device (laundry kiosk), version <strong>${v(d.kiosek_type)}</strong>, specified in Annex No. 1;</li>
      <li><strong>Location</strong> — the operating site under Article III: ${v(d.location_desc)};</li>
      <li><strong>Established Operation</strong> — the existing, functioning and profitable operation of the laundry kiosk at the Location as of the effective date of this agreement;</li>
      <li><strong>Production Slot</strong> — a specific production capacity in the Seller's production plan allocated under Article VI;</li>
      <li><strong>System Services</strong> — the services under Article IX necessary for the long-term operability of the Machine.</li>
    </ol>

    <h2>Article II — Subject of Purchase</h2>
    <ol>
      <li>The subject of this agreement is the Seller's obligation to <strong>manufacture and deliver</strong> to the Buyer a new Machine, version <strong>${v(d.kiosek_type)}</strong>, and at the same time to transfer to the Buyer the <strong>economic use of the Established Operation of the Location</strong>, and the Buyer's obligation to pay the purchase price and take over the Machine.</li>
      <li>Machine configuration for version ${v(d.kiosek_type)}: ${v(d.kiosek_spec)}. The delivery includes the Machine's software and control system, documentation, manual and declaration of conformity.</li>
      <li>The subject of purchase forms an <strong>indivisible whole</strong> — the Machine and the economic use of the Location cannot be transferred separately, unless stipulated otherwise below.</li>
      <li>The Seller declares that it will be the exclusive manufacturer and owner of the Machine until ownership passes under Article VI and that the Machine will not be encumbered by third-party rights.</li>
    </ol>

    <h2>Article III — Status of the Location</h2>
    <ol>
      <li>The Buyer acknowledges and expressly agrees that it <strong>does not acquire any rights in rem or contractual rights to the Location</strong> — in particular to the land, premises, lease or utility connections. The right to use the Location belongs exclusively to the Seller (under a lease, or as the owner of the land).</li>
      <li>By paying the purchase price, the Buyer acquires the <strong>economic right</strong> to operate its Machine at this established and proven Location and to <strong>benefit from its Established Operation and clientele</strong> for the duration of the Seller's right to use the Location.</li>
      <li>The subject of purchase is therefore <strong>not</strong> a lease, land or any other right to real estate, but the <strong>economic value of an established and functioning operation</strong>.</li>
      <li>If the Machine is operated at a Best Series Location, the Buyer undertakes to operate it exclusively <strong>under the Best Series brand</strong> and to comply with its uniform rules.</li>
      <li>If the Buyer intends to remove its Machine from the Location, it must <strong>notify the Seller in writing at least ${v(d.removal_notice_months, 3)} months in advance</strong>.</li>
    </ol>

    <h2>Article IV — Purchase Price</h2>
    <ol>
      <li>The purchase price consists of two components:</li>
    </ol>
    <ol class="letters">
      <li>price of the Machine: <strong>${v(d.price_machine, 12)} ${cur}</strong> excl. VAT;</li>
      <li>price of the Location (consideration for taking over the economic use of the Established Operation): <strong>${v(d.price_location, 12)} ${cur}</strong> excl. VAT.</li>
    </ol>
    <ol start="2">
      <li>The total purchase price is <strong>${v(d.price_total, 12)} ${cur}</strong> excl. VAT; ${d._reverse_charge
        ? 'the Buyer is registered for VAT in another EU member state — the supply is exempt from Czech VAT and the Buyer accounts for the tax under the reverse charge mechanism (Art. 196 of Council Directive 2006/112/EC); invoicing is without VAT'
        : 'VAT at the statutory rate will be added'}.</li>
      <li>If a reservation agreement has been concluded for the same Location, the reservation fee of ${v(d.reservation_credit, 10)} ${cur} already paid is credited towards the purchase price.</li>
      <li>The purchase price includes the manufacture of the new Machine, its installation and the replacement of the existing Machine at the Location under Article VI.</li>
    </ol>

    <h2>Article V — Payment Terms and Effectiveness</h2>
    <ol>
      <li>The Buyer pays the <strong>entire purchase price in advance in a single payment</strong>, reduced by any reservation fee already paid under Article IV.</li>
      <li>The Parties expressly agree that full advance payment is <strong>balanced and corresponds to the nature of the performance</strong>, since the Buyer draws the economic benefit of the Established Operation of the Location from the moment this agreement takes effect (not only after delivery of the new Machine), and the Seller, upon payment, schedules the Machine for production under Article VI.</li>
      <li>The purchase price is payable within <strong>${v(d.payment_days, 3)} days</strong> of signing this agreement, by bank transfer to the Seller's account.</li>
      <li>This agreement becomes <strong>effective on the day the entire purchase price is credited</strong> to the Seller's account. If the purchase price is not paid within this period, the agreement <strong>does not take effect</strong> and is treated as if it had not been concluded; the Seller is then entitled to offer or sell the Location to another interested party.</li>
    </ol>

    <h2>Article VI — Production, Delivery and Transfer of Ownership</h2>
    <ol>
      <li><strong>Production Slot.</strong> Once the entire purchase price is credited, the Seller schedules the Machine for production by allocating a production slot. Production slots are allocated <strong>in the order in which individual orders are paid in full</strong> ("first to pay in full, first to be produced"). The Seller will notify the Buyer of the specific production date after payment of the purchase price and scheduling of the production slot.</li>
      <li><strong>Continuity of operation.</strong> Until production and replacement are completed, the Seller's own Machine operates at the Location, so the operation and yield of the Location are ensured from the effective date without interruption; the Buyer does not wait for the business to start.</li>
      <li><strong>Replacement without interruption.</strong> Upon completion of production, the Seller will, within the agreed price, replace the existing Machine at the Location with the Buyer's new Machine and put it into operation without interrupting the operation of the Location. A handover protocol will be drawn up (Annex No. 2).</li>
      <li><strong>Ownership</strong> of the Machine passes to the Buyer at the moment of its manufacture.</li>
      <li><strong>Risk of damage</strong> to the Machine passes to the Buyer upon its handover (installation) at the Location.</li>
    </ol>

    <h2>Article VII — Warranty and Claims</h2>
    <ol>
      <li>If the Buyer is a <strong>legal entity (entrepreneur)</strong>, the Seller provides a <strong>quality warranty of ${v(d.warranty_months, 3)} months</strong> from handover. If the Buyer is a <strong>consumer</strong>, its rights arising from defective performance are governed by the applicable provisions of the Czech Civil Code.</li>
      <li>The warranty <strong>covers</strong> defects in material and workmanship of the Machine and its functional units that appear during normal operation.</li>
      <li>The warranty <strong>does not cover</strong>: normal wear and tear and consumables; defects caused by improper operation, unauthorised intervention, neglected maintenance or operation contrary to the manual; damage caused by third parties, natural events or force majeure; and defects caused by failure to use the System Services under Article IX.</li>
      <li><strong>Claims</strong> must be made in writing (to ${v(d.complaint_contact)}) without undue delay after the defect is discovered, with a description of the defect and provision of cooperation. The Seller will assess the defect and, in the case of a justified claim, remedy it within a reasonable period by repair or replacement of the part.</li>
      <li>Spare parts and service work <strong>outside the warranty</strong> (after the warranty period or outside its scope) are paid by the Buyer.</li>
    </ol>

    <h2>Article VIII — Service</h2>
    <ol>
      <li>The Buyer reports defects to the Seller at ${v(d.complaint_contact)}.</li>
      <li>The Seller will use its best efforts to respond to a reported defect within <strong>${v(d.reaction_time, 8)}</strong> and to remedy it within <strong>${v(d.fix_time, 10)}</strong>, unless prevented by circumstances beyond its control.</li>
      <li>The Seller performs <strong>remote diagnostics</strong> of the Machine and is entitled to provide service through subcontractors, for whose activities it is liable as for its own.</li>
      <li>The scope and prices of service beyond this agreement are governed by a separate service agreement or the Seller's current price list.</li>
    </ol>

    <h2>Article IX — System Services and Operating Mode</h2>
    <ol>
      <li>The Buyer acknowledges that <strong>long-term operation of the Machine is not possible without the Seller's System Services</strong>, which include in particular: administration of the Machine's system and software, sending SMS telemetry to customers, software for monitoring the Machine's performance and a system for managing operating staff. These services ensure the functionality, security, updates and performance of the Machine.</li>
      <li>The System Services are provided for a fee of <strong>${v(d.system_fee, 10)}</strong> per Machine and are a condition of the Machine's long-term operability.</li>
      <li>The Buyer chooses the operating mode: <strong>a) operation through the Seller</strong> under a separate service agreement — remuneration of <strong>${v(d.service_pct, 3)} % of turnover</strong>, which already includes the System Services (fee of EUR 100); by agreement, rent for the site (actual amount) and energy (actual consumption) may be added to this remuneration. <strong>b) independent operation</strong> — the Buyer bears all operating costs itself and, in addition, pays the fee of EUR 100 for the System Services under paragraphs 1 and 2.</li>
    </ol>

    <h2>Article X — Pre-emptive Right and Buy-back Guarantee</h2>
    <ol>
      <li>The Buyer establishes a <strong>pre-emptive right</strong> in favour of the Seller to the Machine, both to the Machine itself and to the Machine together with the economic use of the Location (the "site"). If the Buyer intends to transfer the Machine (separately or with the site) to a third party, it must <strong>first offer it to the Seller in writing</strong> under the conditions of paragraph 3.</li>
      <li>The Seller has <strong>${v(d.buyback_decision_months, 3)} months</strong> from receipt of the Buyer's written notice containing the essential terms of the intended transfer to decide whether to exercise the pre-emptive right.</li>
      <li>The purchase price on buy-back = <strong>the current value of the Machine + ${v(d.buyback_key_months, 3)}× the average monthly turnover incl. VAT</strong> (value of the site), where the <strong>current value of the Machine</strong> = the acquisition price of the Machine reduced by straight-line depreciation of <strong>${v(d.amortization_pct, 3)} % per year</strong> for the period of use; if the Parties disagree, the value of the Machine will be determined by an expert opinion, the costs of which are borne equally by the Parties.</li>
      <li>If the Seller does not exercise the pre-emptive right, it may offer the Buyer <strong>brokerage of the sale of the Machine</strong> to a third party through the Seller's system for a commission of <strong>${v(d.resale_commission_pct, 3)} %</strong> of the sale price determined according to the same formula.</li>
      <li><strong>Buy-back guarantee (Buyer's option):</strong> the Buyer is entitled (but not obliged) to require the Seller to buy back the Machine together with the economic use of the Location for <strong>${v(d.buyback_guarantee_pct, 3)} %</strong> of the total purchase price under Article IV.</li>
      <li>The right under paragraph 5 may be exercised <strong>only on the ${v(d.buyback_guarantee_years, 2)}th anniversary</strong> of the effective date of this agreement. The Buyer must <strong>notify the Seller in writing whether it will exercise the guaranteed buy-back no later than 1 year before the end of the ${v(d.buyback_guarantee_years, 2)}th year</strong>. If it fails to do so within this period, the right to the guaranteed buy-back lapses.</li>
    </ol>

    <h2>Article XI — Termination of the Right to Use the Location and Relocation</h2>
    <ol>
      <li>If the Seller's right to use the Location is terminated by the landlord (notice, etc.), the Seller will offer the Buyer an alternative solution: securing a new comparable location, resolving utility connections and transporting the Machine.</li>
      <li>The alternative solution is provided as a service at actual current market prices depending on the specific new location and scope of work; the prices will be communicated and agreed in advance.</li>
      <li>The Machine remains the property of the Buyer; acceptance of the alternative location is not obligatory.</li>
    </ol>

    <h2>Article XII — Force Majeure</h2>
    <ol>
      <li>Neither Party is liable for a failure to perform caused by <strong>force majeure</strong> (extraordinary, unforeseeable and unavoidable circumstances — in particular natural events, war, epidemics, supply or energy outages, official measures).</li>
      <li>The affected Party will notify the other Party of the force majeure without undue delay. For the duration of the force majeure, deadlines (in particular production deadlines) are reasonably extended.</li>
    </ol>

    <h2>Article XIII — Final Provisions</h2>
    <ol>
      <li>Deliveries are made to the contact addresses and e-mails stated in the header.</li>
      <li>This agreement and the relations arising from it are governed by the laws of the Czech Republic; the courts of the Czech Republic have jurisdiction over disputes.</li>
      <li>Amendments may be made only by written, sequentially numbered annexes.</li>
      <li>If any provision is invalid or ineffective, this does not affect the validity of the remaining provisions; the Parties will replace it with a provision closest in substance.</li>
      <li>This agreement represents the entire agreement of the Parties and supersedes any previous arrangements on the same subject.</li>
      <li>This agreement is executed in two counterparts (or electronically with recognised signatures); the Parties conclude it freely, seriously and without duress.</li>
    </ol>
    <p class="attach"><strong>Annexes:</strong> No. 1 — Technical specification of the Machine (by version); No. 2 — Handover protocol (serial numbers, specification, photo documentation, inspections, SW version, list of documentation).</p>
    ${sigBlock('Seller', 'Buyer', d.place_signed, d._signature_bestseries, d._signature_customer, true)}`;
  return shell('Purchase Agreement', 'for the delivery of a laundry kiosk and takeover of an established location', body, true);
}

function renderServisni(d) {
  if (isEn(d)) return renderServisniEn(d);
  const body = `
    <h2>Smluvní strany</h2>
    ${partyBlock('Poskytovatel', d, 'seller')}
    <div class="amp">a</div>
    ${partyBlock('Objednatel', d, 'buyer')}
    <p class="note">(společně dále jen „smluvní strany")</p>

    <h2>Preambule</h2>
    <ol>
      <li>Poskytovatel je výrobcem a provozovatelem samoobslužných prádelen (prádlomatů) provozovaných pod značkou <strong>Best Series</strong>.</li>
      <li>Objednatel je vlastníkem Kiosku umístěného na Lokalitě: ${v(d.location_desc)}.</li>
      <li>Předmětem této smlouvy je <strong>komplexní zajištění provozu Kiosku</strong> poskytovatelem za odměnu dle článku IV, a to pod značkou Best Series.</li>
    </ol>

    <h2>Článek I — Výklad pojmů</h2>
    <ol class="letters">
      <li><strong>Kiosek</strong> — prádlomat objednatele umístěný na Lokalitě;</li>
      <li><strong>Lokalita</strong> — provozní místo Kiosku;</li>
      <li><strong>Systémové služby</strong> — software a systémové služby dle čl. III odst. 1;</li>
      <li><strong>Servisní poplatek</strong> — odměna poskytovatele dle článku IV;</li>
      <li><strong>Obrat</strong> — tržby dosažené provozem Kiosku včetně DPH za zúčtovací období.</li>
    </ol>

    <h2>Článek II — Předmět smlouvy</h2>
    <ol>
      <li>Poskytovatel se zavazuje pro objednatele <strong>komplexně zajišťovat provoz Kiosku</strong> v rozsahu článku III a objednatel se zavazuje platit za tuto činnost Servisní poplatek dle článku IV.</li>
      <li>Provoz Kiosku probíhá pod jednotnou značkou a pravidly <strong>Best Series</strong>.</li>
    </ol>

    <h2>Článek III — Rozsah služeb v Servisním poplatku</h2>
    <p style="margin:2px 0 6px;">Servisní poplatek dle článku IV zahrnuje:</p>
    <ol>
      <li><strong>Systémové a softwarové služby</strong>, zejména: telemetrie a vzdálený monitoring Kiosku; správa a zpracování plateb; hlášení a evidence závad; řízení personálu údržby a servisu; výběry tržeb; aktualizace platebních terminálů na aktuální platební metody a protokoly; e-mailový klient pro zasílání dokladů; exporty do účetnictví; aplikace pro zákazníky; SMS brána (SMS zákazníkovi před koncem pracího cyklu); servisní aplikace; e-shop s náhradními díly; servisní manuály; připojení k internetu (konektivita Kiosku). <em>(Samostatná hodnota systémových služeb bez servisní smlouvy činí ${v(d.system_value, 8)}.)</em></li>
      <li><strong>Pravidelná údržba</strong>: kontrola stavu, umytí skeletu, vyčištění filtrů, doplnění detergentů, odečty energií a pravidelné vzorkování a revize dle platné legislativy.</li>
      <li><strong>Infolinka 24/7</strong>: nepřetržitá zákaznická linka, na níž je zákazníkovi poskytnuta rada a řešení problému.</li>
      <li><strong>Servisní výjezdy</strong>: práce a výjezd jsou zahrnuty; hradí se pouze <strong>materiál</strong> — lze-li jej uplatnit z reklamace, řeší se reklamací, jinak materiál hradí objednatel (vlastník Kiosku). Poskytovatel zahájí řešení oznámené závady bez zbytečného odkladu, nejpozději do <strong>jednoho pracovního dne</strong>.</li>
      <li><strong>Detergenty</strong>: zahrnuty v Servisním poplatku.</li>
      <li><strong>Poplatky za platební terminály a platební brány</strong>: zahrnuty v Servisním poplatku.</li>
    </ol>

    <h2>Článek IV — Servisní poplatek (odměna)</h2>
    <ol>
      <li>Za zajištění provozu dle článku III náleží poskytovateli odměna ve výši <strong>${v(d.fee_pct, 4)} %</strong> ${v(d.fee_base)}.</li>
      <li>Odměna se zúčtovává za ${v(d.billing_period)} a je splatná na základě daňového dokladu se splatností ${v(d.due_days, 4)} dní.</li>
      <li>Vypořádání tržeb: ${v(d.settlement)}.</li>
      <li>${d._reverse_charge
        ? 'Objednatel je osobou registrovanou k DPH v jiném členském státě EU — odměna je osvobozena od české DPH a daň přizná objednatel v režimu přenesené daňové povinnosti (reverse charge, čl. 196 směrnice Rady 2006/112/ES); fakturace probíhá bez DPH.'
        : 'K odměně bude připočtena DPH v zákonné výši.'}</li>
    </ol>

    <h2>Článek V — Fakturace: servisní poplatek, nájem a energie</h2>
    <ol>
      <li>Celková fakturace objednateli zahrnuje <strong>tři samostatné položky</strong>:</li>
    </ol>
    <ol class="letters">
      <li><strong>Servisní poplatek</strong> ve výši <strong>${v(d.fee_pct, 4)} % z obratu s DPH</strong> (zahrnuje výhradně služby dle článku III);</li>
      <li><strong>Nájem Lokality</strong> — dle skutečné výše;</li>
      <li><strong>Energie</strong> — dle aktuální spotřeby.</li>
    </ol>
    <ol start="2">
      <li>Položky nájem a energie jsou fakturovány jako <strong>samostatné položky</strong> a <strong>nejsou</strong> součástí servisního poplatku dle článku IV.</li>
      <li>Nájem a energie se objednateli <strong>přefakturovávají pouze tehdy, je-li Lokalita zajištěna poskytovatelem</strong> (Best Series je nájemcem prostoru, resp. vlastníkem pozemku). Provozuje-li objednatel Stroj na vlastní lokalitě, nájem ani energie se neúčtují.</li>
    </ol>

    <h2>Článek VI — Práva a povinnosti stran</h2>
    <ol>
      <li>Poskytovatel zajišťuje provoz s odbornou péčí, v souladu s pokyny výrobce a právními předpisy, vede evidenci zásahů a je oprávněn plnit prostřednictvím poddodavatelů, za jejichž činnost odpovídá jako za vlastní.</li>
      <li>Objednatel poskytuje nezbytnou součinnost a přístup ke Kiosku a Lokalitě, řádně a včas hradí odměnu a bez zbytečného odkladu oznamuje závady.</li>
      <li>Software, telemetrie, aplikace, databáze, platební a systémové služby <strong>zůstávají ve vlastnictví poskytovatele</strong>; objednatel k nim po dobu poskytování služeb získává pouze právo užívání.</li>
      <li>Objednatel <strong>nesmí bez předchozího písemného souhlasu</strong> poskytovatele zasahovat do softwaru, řídicího systému, telemetrie, platebních systémů a elektroniky Kiosku.</li>
    </ol>

    <h2>Článek VII — Doba trvání a ukončení</h2>
    <ol>
      <li>Smlouva se uzavírá na dobu ${v(d.term_type, 12)} a nabývá účinnosti dnem podpisu.</li>
      <li>Smlouvu lze ukončit dohodou nebo písemnou výpovědí kterékoli strany i bez uvedení důvodu s výpovědní dobou ${v(d.notice_months, 3)} měsíce, počínající prvním dnem měsíce následujícího po doručení výpovědi.</li>
      <li>Od smlouvy lze odstoupit při podstatném porušení povinností druhou stranou, které nebylo odstraněno ani v dodatečné přiměřené lhůtě.</li>
      <li>Systémové služby (čl. III odst. 1) jsou nezbytné pro provoz Kiosku a objednatel je nemůže zajistit vlastními prostředky. <strong>Ukončením této smlouvy právo objednatele na systémové služby nezaniká</strong> a tyto se od okamžiku ukončení poskytují na základě samostatného závazku za poplatek <strong>${v(d.system_value, 8)}</strong> za Stroj. Tento závazek trvá, dokud jej objednatel písemně neukončí; bez systémových služeb pozbývá Kiosek provozuschopnosti.</li>
    </ol>

    <h2>Článek VIII — Závěrečná ustanovení</h2>
    <ol>
      <li>Smluvní strany zachovávají mlčenlivost o důvěrných informacích a zpracovávají osobní údaje v souladu s GDPR.</li>
      <li>Žádná ze stran neodpovídá za nesplnění povinnosti způsobené vyšší mocí; po dobu jejího trvání se lhůty přiměřeně prodlužují.</li>
      <li>Poskytovatel neodpovídá za škody způsobené vyšší mocí, výpadkem dodávek energií či internetového připojení nebo zásahem třetích osob.</li>
      <li>Vztahy neupravené smlouvou se řídí právem České republiky; změny jen písemnými, vzestupně číslovanými dodatky.</li>
      <li>Je-li některé ustanovení neplatné či neúčinné, nemá to vliv na platnost ostatních.</li>
      <li>Smlouva je vyhotovena ve dvou stejnopisech (nebo elektronicky s uznávanými podpisy); strany ji uzavírají svobodně a vážně.</li>
    </ol>
    ${sigBlock('Poskytovatel', 'Objednatel', d.place_signed, d._signature_bestseries, d._signature_customer)}`;
  return shell('Servisní smlouva', 'o komplexním zajištění provozu prádlomatu', body);
}

function renderServisniEn(d) {
  const body = `
    <h2>Contracting Parties</h2>
    ${partyBlock('Provider', d, 'seller', true)}
    <div class="amp">and</div>
    ${partyBlock('Client', d, 'buyer', true)}
    <p class="note">(hereinafter jointly referred to as the "Parties")</p>

    <h2>Preamble</h2>
    <ol>
      <li>The Provider is a manufacturer and operator of self-service laundries (laundry kiosks) operated under the <strong>Best Series</strong> brand.</li>
      <li>The Client is the owner of a Kiosk located at the Location: ${v(d.location_desc)}.</li>
      <li>The subject of this agreement is the <strong>comprehensive operation of the Kiosk</strong> by the Provider for the remuneration under Article IV, under the Best Series brand.</li>
    </ol>

    <h2>Article I — Definitions</h2>
    <ol class="letters">
      <li><strong>Kiosk</strong> — the Client's laundry kiosk located at the Location;</li>
      <li><strong>Location</strong> — the operating site of the Kiosk;</li>
      <li><strong>System Services</strong> — the software and system services under Art. III(1);</li>
      <li><strong>Service Fee</strong> — the Provider's remuneration under Article IV;</li>
      <li><strong>Turnover</strong> — revenue generated by the operation of the Kiosk including VAT for the billing period.</li>
    </ol>

    <h2>Article II — Subject of the Agreement</h2>
    <ol>
      <li>The Provider undertakes to <strong>comprehensively operate the Kiosk</strong> for the Client within the scope of Article III, and the Client undertakes to pay the Service Fee under Article IV for this activity.</li>
      <li>The Kiosk is operated under the uniform brand and rules of <strong>Best Series</strong>.</li>
    </ol>

    <h2>Article III — Scope of Services Included in the Service Fee</h2>
    <p style="margin:2px 0 6px;">The Service Fee under Article IV includes:</p>
    <ol>
      <li><strong>System and software services</strong>, in particular: telemetry and remote monitoring of the Kiosk; payment administration and processing; defect reporting and records; management of maintenance and service staff; cash collection; updates of payment terminals to current payment methods and protocols; e-mail client for sending receipts; accounting exports; customer application; SMS gateway (SMS to the customer before the end of the washing cycle); service application; e-shop with spare parts; service manuals; internet connection (Kiosk connectivity). <em>(The standalone value of the system services without a service agreement is ${v(d.system_value, 8)}.)</em></li>
      <li><strong>Regular maintenance</strong>: condition checks, washing of the body, cleaning of filters, refilling of detergents, energy meter readings and regular sampling and inspections in accordance with applicable legislation.</li>
      <li><strong>24/7 helpline</strong>: a round-the-clock customer line providing advice and problem resolution.</li>
      <li><strong>Service visits</strong>: work and travel are included; only <strong>material</strong> is charged — if it can be claimed under warranty, it is handled as a claim, otherwise the material is paid by the Client (owner of the Kiosk). The Provider will begin resolving a reported defect without undue delay, no later than within <strong>one business day</strong>.</li>
      <li><strong>Detergents</strong>: included in the Service Fee.</li>
      <li><strong>Payment terminal and payment gateway fees</strong>: included in the Service Fee.</li>
    </ol>

    <h2>Article IV — Service Fee (Remuneration)</h2>
    <ol>
      <li>For the operation under Article III, the Provider is entitled to remuneration of <strong>${v(d.fee_pct, 4)} %</strong> ${v(d.fee_base)}.</li>
      <li>The remuneration is settled per ${v(d.billing_period)} and is payable on the basis of a tax document with a due period of ${v(d.due_days, 4)} days.</li>
      <li>Settlement of revenue: ${v(d.settlement)}.</li>
      <li>${d._reverse_charge
        ? 'The Client is registered for VAT in another EU member state — the remuneration is exempt from Czech VAT and the Client accounts for the tax under the reverse charge mechanism (Art. 196 of Council Directive 2006/112/EC); invoicing is without VAT.'
        : 'VAT at the statutory rate will be added to the remuneration.'}</li>
    </ol>

    <h2>Article V — Invoicing: Service Fee, Rent and Energy</h2>
    <ol>
      <li>The total invoicing to the Client comprises <strong>three separate items</strong>:</li>
    </ol>
    <ol class="letters">
      <li><strong>Service Fee</strong> of <strong>${v(d.fee_pct, 4)} % of turnover incl. VAT</strong> (covering exclusively the services under Article III);</li>
      <li><strong>Rent for the Location</strong> — at the actual amount;</li>
      <li><strong>Energy</strong> — according to actual consumption.</li>
    </ol>
    <ol start="2">
      <li>Rent and energy are invoiced as <strong>separate items</strong> and are <strong>not</strong> part of the Service Fee under Article IV.</li>
      <li>Rent and energy are <strong>re-invoiced to the Client only if the Location is provided by the Provider</strong> (Best Series is the tenant of the premises or the owner of the land). If the Client operates the Machine at its own location, no rent or energy is charged.</li>
    </ol>

    <h2>Article VI — Rights and Obligations of the Parties</h2>
    <ol>
      <li>The Provider operates with professional care, in accordance with the manufacturer's instructions and legal regulations, keeps records of interventions and is entitled to perform through subcontractors, for whose activities it is liable as for its own.</li>
      <li>The Client provides the necessary cooperation and access to the Kiosk and the Location, pays the remuneration duly and on time and reports defects without undue delay.</li>
      <li>The software, telemetry, applications, databases, payment and system services <strong>remain the property of the Provider</strong>; the Client only acquires a right of use for the duration of the services.</li>
      <li>The Client <strong>must not, without the Provider's prior written consent</strong>, interfere with the software, control system, telemetry, payment systems or electronics of the Kiosk.</li>
    </ol>

    <h2>Article VII — Term and Termination</h2>
    <ol>
      <li>This agreement is concluded for ${v(d.term_type, 12)} and takes effect on the day of signature.</li>
      <li>This agreement may be terminated by mutual agreement or by written notice of either Party, even without cause, with a notice period of ${v(d.notice_months, 3)} months, starting on the first day of the month following delivery of the notice.</li>
      <li>Either Party may withdraw from this agreement in the event of a material breach by the other Party that has not been remedied even within an additional reasonable period.</li>
      <li>The System Services (Art. III(1)) are necessary for the operation of the Kiosk and the Client cannot provide them by its own means. <strong>Termination of this agreement does not extinguish the Client's right to the system services</strong>, which are provided from the moment of termination under a separate obligation for a fee of <strong>${v(d.system_value, 8)}</strong> per Machine. This obligation continues until terminated by the Client in writing; without the system services, the Kiosk ceases to be operable.</li>
    </ol>

    <h2>Article VIII — Final Provisions</h2>
    <ol>
      <li>The Parties maintain confidentiality regarding confidential information and process personal data in accordance with the GDPR.</li>
      <li>Neither Party is liable for a failure to perform caused by force majeure; deadlines are reasonably extended for its duration.</li>
      <li>The Provider is not liable for damage caused by force majeure, outages of energy supplies or internet connection, or interference by third parties.</li>
      <li>Matters not regulated by this agreement are governed by the laws of the Czech Republic; amendments only by written, sequentially numbered annexes.</li>
      <li>If any provision is invalid or ineffective, this does not affect the validity of the remaining provisions.</li>
      <li>This agreement is executed in two counterparts (or electronically with recognised signatures); the Parties conclude it freely and seriously.</li>
    </ol>
    ${sigBlock('Provider', 'Client', d.place_signed, d._signature_bestseries, d._signature_customer, true)}`;
  return shell('Service Agreement', 'on the comprehensive operation of a laundry kiosk', body, true);
}

function renderRezervacni(d) {
  if (isEn(d)) return renderRezervacniEn(d);
  const body = `
    <h2>Smluvní strany</h2>
    ${partyBlock('Poskytovatel', d, 'seller')}
    <div class="amp">a</div>
    ${partyBlock('Zájemce', d, 'buyer')}
    <p class="note">(společně dále jen „smluvní strany")</p>

    <h2>Článek I — Předmět rezervace</h2>
    <ol>
      <li>Poskytovatel touto smlouvou rezervuje pro zájemce konkrétní lokalitu: <strong>${v(d.location_name)}</strong>, na adrese ${v(d.location_address)}.</li>
      <li>Účel rezervace: ${v(d.reservation_desc)}.</li>
      <li>Po dobu rezervace se poskytovatel zavazuje nenabízet a nerezervovat tuto lokalitu jiné osobě.</li>
    </ol>

    <h2>Článek II — Rezervační poplatek</h2>
    <ol>
      <li>Zájemce se zavazuje uhradit rezervační poplatek ve výši <strong>${v(d.reservation_fee, 12)} ${esc(d.reservation_fee_currency || 'Kč')}</strong> (slovy: ${v(d.reservation_fee_words)}) se splatností ${d.fee_due_days ? (v(d.fee_due_days, 4) + ' dní od podpisu této smlouvy') : 'v den podpisu této smlouvy'}.</li>
      <li>${v(d.credit_to_price)}</li>
    </ol>

    <h2>Článek III — Doba rezervace</h2>
    <ol>
      <li>Rezervace se sjednává na dobu ${v(d.reservation_period, 12)}, tj. do ${v(d.reserved_until, 14)}.</li>
      <li>V době rezervace jedná(jí) strany o uzavření navazující smlouvy, kterou je ${v(d.future_contract)}.</li>
    </ol>

    <h2>Článek IV — Vrácení a propadnutí poplatku</h2>
    <ol>
      <li>${v(d.refund_terms)}</li>
    </ol>

    <h2>Článek V — Závěrečná ustanovení</h2>
    <ol>
      <li>Smlouva nabývá platnosti a účinnosti dnem podpisu oběma stranami.</li>
      <li>Vztahy neupravené smlouvou se řídí občanským zákoníkem a předpisy ČR; změny jen písemnými dodatky.</li>
      <li>Smlouva je vyhotovena ve dvou stejnopisech (nebo elektronicky); strany ji uzavírají svobodně a vážně.</li>
    </ol>
    ${sigBlock('Poskytovatel', 'Zájemce', d.place_signed, d._signature_bestseries, d._signature_customer)}`;
  return shell('Rezervační smlouva', 'na rezervaci lokality', body);
}

function renderRezervacniEn(d) {
  const body = `
    <h2>Contracting Parties</h2>
    ${partyBlock('Provider', d, 'seller', true)}
    <div class="amp">and</div>
    ${partyBlock('Prospective Buyer', d, 'buyer', true)}
    <p class="note">(hereinafter jointly referred to as the "Parties")</p>

    <h2>Article I — Subject of the Reservation</h2>
    <ol>
      <li>By this agreement, the Provider reserves for the Prospective Buyer the following specific location: <strong>${v(d.location_name)}</strong>, at the address ${v(d.location_address)}.</li>
      <li>Purpose of the reservation: ${v(d.reservation_desc)}.</li>
      <li>For the duration of the reservation, the Provider undertakes not to offer or reserve this location to any other person.</li>
    </ol>

    <h2>Article II — Reservation Fee</h2>
    <ol>
      <li>The Prospective Buyer undertakes to pay a reservation fee of <strong>${v(d.reservation_fee, 12)} ${esc(d.reservation_fee_currency || 'CZK')}</strong> (in words: ${v(d.reservation_fee_words)}) due ${d.fee_due_days ? ('within ' + v(d.fee_due_days, 4) + ' days of signing this agreement') : 'on the day of signing this agreement'}.</li>
      <li>${v(d.credit_to_price)}</li>
    </ol>

    <h2>Article III — Reservation Period</h2>
    <ol>
      <li>The reservation is agreed for a period of ${v(d.reservation_period, 12)}, i.e. until ${v(d.reserved_until, 14)}.</li>
      <li>During the reservation period, the Parties shall negotiate the conclusion of a follow-up agreement, namely ${v(d.future_contract)}.</li>
    </ol>

    <h2>Article IV — Refund and Forfeiture of the Fee</h2>
    <ol>
      <li>${v(d.refund_terms)}</li>
    </ol>

    <h2>Article V — Final Provisions</h2>
    <ol>
      <li>This agreement enters into force and effect on the day of its signature by both Parties.</li>
      <li>Matters not regulated by this agreement are governed by the Czech Civil Code and the laws of the Czech Republic; amendments may be made only in writing.</li>
      <li>This agreement is executed in two counterparts (or electronically); the Parties conclude it freely and seriously.</li>
    </ol>
    ${sigBlock('Provider', 'Prospective Buyer', d.place_signed, d._signature_bestseries, d._signature_customer, true)}`;
  return shell('Reservation Agreement', 'for the reservation of a location', body, true);
}

const RENDERERS = { kupni: renderKupni, servisni: renderServisni, rezervacni: renderRezervacni };

// ─── Veřejné API ──────────────────────────────────────────────────────────────

function isValidType(type) { return TYPES.includes(type); }

/** Vrátí schéma polí + předvyplněné hodnoty pro editovatelný formulář.
 *  lang: 2písmenný kód jazyka; jiný než 'cs' → anglická šablona i výchozí texty. */
function getPrefill(type, site, our, lang) {
  if (!isValidType(type)) throw new Error('Neznámý typ smlouvy: ' + type);
  const values = buildDefaults(type, site, our);
  const l = String(lang || 'cs').toLowerCase().slice(0, 2);
  if (l && l !== 'cs') {
    Object.assign(values, EN_TEXT_DEFAULTS[type] || {});
    values._lang = l;
  }
  return {
    type,
    label: TYPE_LABEL[type],
    groups: SCHEMAS[type],
    values,
  };
}

function renderHtml(type, fields) {
  if (!isValidType(type)) throw new Error('Neznámý typ smlouvy: ' + type);
  return RENDERERS[type](fields || {});
}

/** Vygeneruje PDF Buffer smlouvy z (upravených) polí. */
async function generateContractPdf(type, fields) {
  const html = renderHtml(type, fields);
  return htmlToPdfBuffer(html);
}

module.exports = {
  TYPES,
  TYPE_LABEL,
  isValidType,
  getPrefill,
  buildDefaults,
  renderHtml,
  generateContractPdf,
  htmlToPdfBuffer,
  SCHEMAS,
};
