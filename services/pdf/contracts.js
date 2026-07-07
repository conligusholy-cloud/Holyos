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
      { name: 'kiosek_type', label: 'Označení / typ kiosku', type: 'text' },
      { name: 'kiosek_sn', label: 'Výrobní / sériové číslo', type: 'text' },
      { name: 'location_desc', label: 'Umístění / lokalita', type: 'text' },
      { name: 'kiosek_spec', label: 'Technická specifikace a výbava', type: 'textarea' },
    ]},
    { key: 'price', title: 'Cena a platby', fields: [
      { name: 'price', label: 'Kupní cena (bez DPH)', type: 'text' },
      { name: 'price_words', label: 'Cena slovy', type: 'text' },
      { name: 'price_includes', label: 'Cena zahrnuje', type: 'text' },
      { name: 'deposit_pct', label: 'Záloha (%)', type: 'text' },
      { name: 'deposit_due_days', label: 'Splatnost zálohy (dní)', type: 'text' },
      { name: 'balance_due_days', label: 'Splatnost doplatku (dní)', type: 'text' },
      { name: 'interest_rate', label: 'Úrok z prodlení', type: 'text' },
    ]},
    { key: 'terms', title: 'Předání, záruka, podpis', fields: [
      { name: 'handover_place', label: 'Místo předání', type: 'text' },
      { name: 'handover_date', label: 'Termín předání', type: 'text' },
      { name: 'ownership_transfer', label: 'Přechod vlastnictví', type: 'text' },
      { name: 'warranty_months', label: 'Záruka (měsíců)', type: 'text' },
      { name: 'complaint_contact', label: 'Kontakt pro reklamace', type: 'text' },
      { name: 'place_signed', label: 'Místo podpisu', type: 'text' },
    ]},
  ],
  servisni: [
    SELLER_GROUP('Poskytovatel (provozovatel)'),
    BUYER_GROUP('Objednatel (vlastník kiosku)'),
    { key: 'subject', title: 'Předmět a rozsah', fields: [
      { name: 'location_desc', label: 'Lokalita / umístění kiosku', type: 'text' },
      { name: 'service_scope', label: 'Rozsah zajištění provozu', type: 'textarea' },
    ]},
    { key: 'fee', title: 'Odměna', fields: [
      { name: 'fee_pct', label: 'Odměna (%)', type: 'text' },
      { name: 'fee_base', label: 'Základ pro výpočet', type: 'text' },
      { name: 'billing_period', label: 'Zúčtovací období', type: 'text' },
      { name: 'due_days', label: 'Splatnost (dní)', type: 'text' },
      { name: 'settlement', label: 'Vypořádání tržeb', type: 'textarea' },
      { name: 'parts_included', label: 'Náhradní díly / materiál v odměně', type: 'text' },
    ]},
    { key: 'terms', title: 'Podmínky a ukončení', fields: [
      { name: 'reaction_time', label: 'Reakční doba na závadu', type: 'text' },
      { name: 'fix_time', label: 'Lhůta odstranění závady', type: 'text' },
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
    return {
      ...base,
      kiosek_type: site?.pradlomat_ref || 'prádlomat 750',
      kiosek_sn: '',
      location_desc: loc,
      kiosek_spec: '',
      price: site?.purchase_price != null ? String(site.purchase_price) : '',
      price_words: '',
      price_includes: 'dopravu, instalaci a uvedení do provozu',
      deposit_pct: '50',
      deposit_due_days: '7',
      balance_due_days: '14',
      interest_rate: '0,05 % z dlužné částky za každý den prodlení',
      handover_place: addr,
      handover_date: '',
      ownership_transfer: 'úplným zaplacením kupní ceny',
      warranty_months: '24',
      complaint_contact: our?.email || '',
      place_signed: site?.city || '',
    };
  }
  if (type === 'servisni') {
    return {
      ...base,
      location_desc: loc,
      service_scope: [
        'preventivní údržba a pravidelné servisní prohlídky',
        'opravy a odstraňování závad, zajištění náhradních dílů',
        'doplňování spotřebního materiálu',
        'vzdálený monitoring, dohled a technická podpora',
        'inkaso tržeb a jejich vyúčtování',
      ].join('\n'),
      fee_pct: '13',
      fee_base: 'z celkových tržeb (obratu) dosažených provozem kiosku za příslušné období, bez DPH',
      billing_period: 'kalendářní měsíc',
      due_days: '14',
      settlement: 'Poskytovatel inkasuje tržby, sráží si odměnu 13 % a zbývající částku poukazuje objednateli.',
      parts_included: 'nejsou zahrnuty (hradí objednatel proti doložení)',
      reaction_time: '48 hodin',
      fix_time: '5 pracovních dní',
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

    <h2>Článek I — Předmět koupě</h2>
    <ol>
      <li>Předmětem této smlouvy je závazek prodávajícího odevzdat kupujícímu níže specifikovaný kiosek a umožnit mu nabýt vlastnické právo k němu, a závazek kupujícího kiosek převzít a zaplatit kupní cenu.</li>
      <li>Kiosek je specifikován takto: označení / typ <strong>${v(d.kiosek_type)}</strong>, výrobní / sériové číslo ${v(d.kiosek_sn, 14)}, umístění / lokalita ${v(d.location_desc)}.</li>
      <li>Technická specifikace a výbava: ${v(d.kiosek_spec)}.</li>
      <li>Prodávající prohlašuje, že je výlučným vlastníkem kiosku, že kiosek není zatížen právy třetích osob a že jeho prodeji nebrání žádná právní ani faktická překážka.</li>
    </ol>

    <h2>Článek II — Kupní cena a platební podmínky</h2>
    <ol>
      <li>Kupní cena kiosku činí <strong>${v(d.price, 14)} Kč</strong> (slovy: ${v(d.price_words)}) bez DPH. K ceně bude připočtena DPH v zákonné výši.</li>
      <li>Kupní cena zahrnuje ${v(d.price_includes)}.</li>
      <li>Kupující uhradí cenu takto: záloha ve výši ${v(d.deposit_pct, 5)} % se splatností ${v(d.deposit_due_days, 4)} dní na základě zálohové faktury a doplatek se splatností ${v(d.balance_due_days, 4)} dní od předání.</li>
      <li>Cena se hradí bezhotovostně na účet prodávajícího; je uhrazena dnem připsání na účet.</li>
      <li>V případě prodlení kupujícího s úhradou je prodávající oprávněn požadovat úrok z prodlení ve výši ${v(d.interest_rate)}.</li>
    </ol>

    <h2>Článek III — Předání a převzetí</h2>
    <ol>
      <li>Prodávající předá kiosek kupujícímu v místě ${v(d.handover_place)}, v termínu ${v(d.handover_date, 14)}.</li>
      <li>O předání a převzetí bude sepsán předávací protokol podepsaný oběma stranami, obsahující stav kiosku, předané příslušenství a dokumentaci, případně zjištěné vady.</li>
      <li>Nebezpečí škody na kiosku přechází na kupujícího okamžikem převzetí.</li>
      <li>Vlastnické právo ke kiosku přechází na kupujícího ${v(d.ownership_transfer)}.</li>
    </ol>

    <h2>Článek IV — Záruka a odpovědnost za vady</h2>
    <ol>
      <li>Prodávající poskytuje na kiosek záruku za jakost v délce ${v(d.warranty_months, 4)} měsíců ode dne předání.</li>
      <li>Záruka se nevztahuje na vady způsobené neodborným zásahem, nesprávnou obsluhou, běžným opotřebením, zásahem třetí osoby nebo vyšší mocí.</li>
      <li>Vady je kupující povinen bez zbytečného odkladu písemně reklamovat na adresu ${v(d.complaint_contact)}.</li>
      <li>Navazující servisní zajištění je upraveno samostatnou servisní smlouvou.</li>
    </ol>

    <h2>Článek V — Závěrečná ustanovení</h2>
    <ol>
      <li>Smlouva nabývá platnosti a účinnosti dnem podpisu oběma stranami.</li>
      <li>Vztahy neupravené smlouvou se řídí občanským zákoníkem a předpisy ČR.</li>
      <li>Smlouvu lze měnit pouze písemnými, vzestupně číslovanými dodatky.</li>
      <li>Je-li některé ustanovení neplatné či neúčinné, nemá to vliv na platnost ostatních.</li>
      <li>Smlouva je vyhotovena ve dvou stejnopisech s platností originálu (nebo elektronicky s uznávanými podpisy).</li>
      <li>Smluvní strany prohlašují, že si smlouvu přečetly, souhlasí s jejím obsahem a uzavírají ji svobodně a vážně.</li>
    </ol>
    <p class="attach"><strong>Přílohy:</strong> č. 1 — Technická specifikace kiosku.</p>
    ${sigBlock('Prodávající', 'Kupující', d.place_signed)}`;
  return shell('Kupní smlouva', 'na dodávku kiosku', body);
}

function renderServisni(d) {
  const scope = String(d.service_scope || '').split('\n').filter(x => x.trim());
  const scopeHtml = scope.length
    ? `<ol class="letters">${scope.map(x => `<li>${esc(x.trim())}</li>`).join('')}</ol>`
    : `<p>${v('', 40)}</p>`;
  const body = `
    <h2>Smluvní strany</h2>
    ${partyBlock('Poskytovatel', d, 'seller')}
    <div class="amp">a</div>
    ${partyBlock('Objednatel', d, 'buyer')}
    <p class="note">(společně dále jen „smluvní strany")</p>

    <h2>Článek I — Předmět smlouvy</h2>
    <ol>
      <li>Objednatel je vlastníkem / provozovatelem kiosku umístěného na lokalitě ${v(d.location_desc)} (dále jen „kiosek").</li>
      <li>Předmětem smlouvy je závazek poskytovatele komplexně zajišťovat provoz kiosku a závazek objednatele platit za tuto činnost sjednanou odměnu.</li>
      <li>Zajištění provozu zahrnuje zejména:</li>
    </ol>
    ${scopeHtml}

    <h2>Článek II — Odměna poskytovatele</h2>
    <ol>
      <li>Za komplexní zajištění provozu náleží poskytovateli odměna ve výši <strong>${v(d.fee_pct, 4)} %</strong> ${v(d.fee_base)}.</li>
      <li>Odměna se zúčtovává za ${v(d.billing_period)} a je splatná na základě daňového dokladu se splatností ${v(d.due_days, 4)} dní.</li>
      <li>Vypořádání tržeb: ${v(d.settlement)}.</li>
      <li>Náklady na náhradní díly a spotřební materiál ${v(d.parts_included)}.</li>
      <li>K odměně bude připočtena DPH v zákonné výši.</li>
    </ol>

    <h2>Článek III — Práva a povinnosti stran</h2>
    <ol>
      <li>Poskytovatel zajišťuje provoz s odbornou péčí, v souladu s pokyny výrobce a právními předpisy; na nahlášenou závadu reaguje v době ${v(d.reaction_time, 10)} a odstraní ji ve lhůtě ${v(d.fix_time, 10)}, nebrání-li tomu okolnosti nezávislé na jeho vůli.</li>
      <li>Poskytovatel vede evidenci zásahů a je oprávněn plnit prostřednictvím poddodavatelů, za jejichž činnost odpovídá jako za vlastní.</li>
      <li>Objednatel poskytuje nezbytnou součinnost a přístup ke kiosku, řádně a včas hradí odměnu a bez zbytečného odkladu oznamuje závady.</li>
    </ol>

    <h2>Článek IV — Doba trvání a ukončení</h2>
    <ol>
      <li>Smlouva se uzavírá na dobu ${v(d.term_type, 12)} a nabývá účinnosti dnem podpisu.</li>
      <li>Smlouvu lze ukončit dohodou nebo písemnou výpovědí kterékoli strany i bez uvedení důvodu s výpovědní dobou ${v(d.notice_months, 3)} měsíce, počínající prvním dnem měsíce následujícího po doručení výpovědi.</li>
      <li>Od smlouvy lze odstoupit při podstatném porušení povinností druhou stranou, které nebylo odstraněno ani v dodatečné přiměřené lhůtě.</li>
    </ol>

    <h2>Článek V — Závěrečná ustanovení</h2>
    <ol>
      <li>Smluvní strany zachovávají mlčenlivost o důvěrných informacích a zpracovávají osobní údaje v souladu s GDPR.</li>
      <li>Vztahy neupravené smlouvou se řídí občanským zákoníkem a předpisy ČR; změny jen písemnými dodatky.</li>
      <li>Smlouva je vyhotovena ve dvou stejnopisech; strany ji uzavírají svobodně a vážně.</li>
    </ol>
    ${sigBlock('Poskytovatel', 'Objednatel', d.place_signed)}`;
  return shell('Servisní smlouva', 'o zajištění provozu kiosku', body);
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
