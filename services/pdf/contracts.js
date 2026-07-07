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
      { name: 'avg_turnover_vat', label: 'Průměrný obrat s DPH (měsíčně)', type: 'text' },
      { name: 'location_months', label: 'Počet měsíců (pro cenu lokality)', type: 'text' },
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
      { name: 'reservation_fee_words', label: 'Poplatek slovy', type: 'text' },
      { name: 'fee_due_days', label: 'Splatnost poplatku (dní)', type: 'text' },
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
    seller_name: our?.name || 'Best Series s.r.o.',
    seller_address: joinAddr(our),
    seller_ico: our?.ico || '05643724',
    seller_dic: our?.dic || '',
    seller_rep: '',
    seller_bank: our?.iban || our?.bank_account || '',
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
    reservation_fee_words: '',
    fee_due_days: '3',
    reservation_period: '3 dny (72 hodin)',
    reserved_until: '',
    credit_to_price: 'Rezervační poplatek se v případě uzavření kupní smlouvy započítává na kupní cenu.',
    refund_terms: 'Nedojde-li k uzavření navazující smlouvy z důvodu na straně poskytovatele, rezervační poplatek se zájemci vrací. Nedojde-li k jejímu uzavření z důvodu na straně zájemce, poplatek propadá ve prospěch poskytovatele jako paušální náhrada.',
    future_contract: 'kupní smlouva, popř. servisní smlouva',
    place_signed: site?.city || '',
  };
}

// ─── HTML šablona ─────────────────────────────────────────────────────────────

function shell(title, subtitle, body) {
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
  .place { margin-top: 26px; }
  .note { color:#666; font-size: 10px; }
  .attach { margin-top: 16px; font-size: 10.5px; }
  @page { size: A4; }
  </style></head><body>
  <h1>${esc(title)}</h1>
  ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
  <p class="law">uzavřená podle příslušných ustanovení zákona č. 89/2012 Sb., občanský zákoník, v platném znění</p>
  ${body}
  </body></html>`;
}

function partyBlock(role, d, p) {
  return `<div class="party">
    <div class="role">${esc(role)}:</div>
    <p class="line">${v(d[p + '_name'])}</p>
    <p class="line">se sídlem / adresa: ${v(d[p + '_address'])}</p>
    <p class="line">IČO: ${v(d[p + '_ico'], 10)}${d[p + '_dic'] ? ', DIČ: ' + esc(d[p + '_dic']) : ', DIČ: ' + v('', 10)}</p>
    <p class="line">zastoupen(a): ${v(d[p + '_rep'])}</p>
    <p class="line">bankovní spojení: ${v(d[p + '_bank'])}</p>
  </div>`;
}

function sigBlock(leftLabel, rightLabel, place) {
  return `<p class="place">V ${v(place, 18)} dne ..............................</p>
  <div class="sig">
    <div class="box"><div class="rule">${esc(leftLabel)}</div></div>
    <div class="box"><div class="rule">${esc(rightLabel)}</div></div>
  </div>`;
}

function renderKupni(d) {
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
      <li>cena Stroje: <strong>${v(d.price_machine, 12)} Kč</strong> bez DPH;</li>
      <li>cena Lokality (úplata za převzetí ekonomického užívání Zavedeného provozu), stanovená jako <strong>průměrný obrat s DPH</strong> ${v(d.avg_turnover_vat, 10)} Kč × ${v(d.location_months, 4)} měsíců = <strong>${v(d.price_location, 12)} Kč</strong> bez DPH.</li>
    </ol>
    <ol start="2">
      <li>Celková kupní cena činí <strong>${v(d.price_total, 12)} Kč</strong> bez DPH; k ceně bude připočtena DPH v zákonné výši.</li>
      <li>Byla-li k téže Lokalitě uzavřena rezervační smlouva, započítává se již uhrazený rezervační poplatek ${v(d.reservation_credit, 10)} Kč na kupní cenu.</li>
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

    <h2>Článek X — Předkupní právo a zpětný odkup</h2>
    <ol>
      <li>Kupující zřizuje ve prospěch prodávajícího <strong>předkupní právo</strong> ke Stroji, a to jak k samotnému Stroji, tak ke Stroji společně s ekonomickým užíváním Lokality („místem"). Zamýšlí-li kupující převést Stroj (samostatně či s místem) na třetí osobu, je povinen jej <strong>nejprve písemně nabídnout prodávajícímu</strong> za podmínek dle odstavce 3.</li>
      <li>Prodávající má na rozhodnutí o využití předkupního práva lhůtu <strong>${v(d.buyback_decision_months, 3)} měsíců</strong> od doručení písemného oznámení kupujícího obsahujícího podstatné náležitosti zamýšleného převodu.</li>
      <li>Kupní cena při zpětném odkupu = <strong>aktuální hodnota Stroje + ${v(d.buyback_key_months, 3)}× průměrný obrat s DPH</strong> (hodnota místa), kde <strong>aktuální hodnota Stroje</strong> = pořizovací cena Stroje snížená o lineární opotřebení <strong>${v(d.amortization_pct, 3)} % ročně</strong> za dobu užívání; při neshodě stran se hodnota Stroje určí znaleckým posudkem, jehož náklady nesou strany rovným dílem.</li>
      <li>Nevyužije-li prodávající předkupní právo, může kupujícímu nabídnout <strong>zprostředkování prodeje Stroje</strong> třetí osobě prostřednictvím systému prodávajícího za provizi <strong>${v(d.resale_commission_pct, 3)} %</strong> z prodejní ceny stanovené dle téhož klíče.</li>
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
    ${sigBlock('Prodávající', 'Kupující', d.place_signed)}`;
  return shell('Kupní smlouva', 'na dodávku prádlomatu a převzetí zavedené lokality', body);
}

function renderServisni(d) {
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
      <li>K odměně bude připočtena DPH v zákonné výši.</li>
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
    ${sigBlock('Poskytovatel', 'Objednatel', d.place_signed)}`;
  return shell('Servisní smlouva', 'o komplexním zajištění provozu prádlomatu', body);
}

function renderRezervacni(d) {
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
      <li>Zájemce se zavazuje uhradit rezervační poplatek ve výši <strong>${v(d.reservation_fee, 12)} Kč</strong> (slovy: ${v(d.reservation_fee_words)}) se splatností ${v(d.fee_due_days, 4)} dní od podpisu této smlouvy.</li>
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
    ${sigBlock('Poskytovatel', 'Zájemce', d.place_signed)}`;
  return shell('Rezervační smlouva', 'na rezervaci lokality', body);
}

const RENDERERS = { kupni: renderKupni, servisni: renderServisni, rezervacni: renderRezervacni };

// ─── Veřejné API ──────────────────────────────────────────────────────────────

function isValidType(type) { return TYPES.includes(type); }

/** Vrátí schéma polí + předvyplněné hodnoty pro editovatelný formulář. */
function getPrefill(type, site, our) {
  if (!isValidType(type)) throw new Error('Neznámý typ smlouvy: ' + type);
  return {
    type,
    label: TYPE_LABEL[type],
    groups: SCHEMAS[type],
    values: buildDefaults(type, site, our),
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
  SCHEMAS,
};
