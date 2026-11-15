// =============================================================================
// Laundromat Tycoon — světové události
// =============================================================================
// Povodeň v Česku, festival v Brně, zdražení energií v Evropě. Události vznikají
// tady na serveru jednou pro celý herní svět a zasahují prádlomaty podle toho,
// KDE stojí, ne podle toho, čí jsou. Dva hráči se sousedními pobočkami mají
// stejné podmínky; kdo má síť rozesetou po Evropě, rozloží riziko.
//
// Samotný dopad si dopočítá hra v prohlížeči — server je vyhlašovatel, ne
// účetní. Je to stejný princip jako u krizí a sezóny: pravidlo je společné,
// výpočet lokální.
//
// Vypnout to jde nastavením udalosti_zap = 0, aniž by se cokoli ztratilo.

'use strict';

const { prisma } = require('../../config/database');
const acct = require('../../routes/game-account.routes');

const DEN = 86400000;
const TIK_MS = 10 * 60000;          // jak často se kouká, co začít a co ukončit
const NAJEDNOU_MAX = 6;             // kolik událostí smí běžet ve světě naráz
const SANCE_ZA_TIK = 0.2;           // s jakou pravděpodobností při tiku něco vznikne
const TICHO_MAX = 2 * 3600000;      // po takovém tichu vyhlásí další tik událost jistě

// ─── Katalog ─────────────────────────────────────────────────────────────────
// navstevnost a naklady jsou poměrné změny: −0.3 = o třicet procent míň lidí,
// +0.2 = o pětinu dražší provoz. Délka je ve skutečných hodinách.
const KATALOG = [
  // ── co bolí ───────────────────────────────────────────────────────────────
  { typ: 'povoden', nazev: 'Povodně', ikona: '🌊', vaha: 8, zavaznost: 3, urovne: ['mesto', 'zeme'],
    hodin: [12, 72], dopad: { navstevnost: -0.35, naklady: 0.12 },
    popis: 'Rozvodněná řeka zaplavila ulice. Lidé řeší čerpadla, ne prádlo, a do provozoven se špatně dostává.' },
  { typ: 'vypadek', nazev: 'Výpadek elektřiny', ikona: '🔌', vaha: 10, zavaznost: 2, urovne: ['mesto'],
    hodin: [6, 30], dopad: { navstevnost: -0.5 },
    popis: 'Porucha na vedení. Část města je bez proudu a pračky stojí.' },
  { typ: 'energie', nazev: 'Zdražení energií', ikona: '⚡', vaha: 10, zavaznost: 2, urovne: ['zeme', 'svet'],
    hodin: [48, 168], dopad: { naklady: 0.22 },
    popis: 'Ceny elektřiny vyskočily. Praní je dražší a na účtech je to znát hned.' },
  { typ: 'vichrice', nazev: 'Vichřice', ikona: '🌪️', vaha: 7, zavaznost: 2, urovne: ['zeme'],
    hodin: [8, 36], dopad: { navstevnost: -0.18, naklady: 0.08 },
    popis: 'Silný vítr strhává střechy a lidé zůstávají doma.' },
  { typ: 'doprava', nazev: 'Dopravní omezení', ikona: '🚧', vaha: 8, zavaznost: 1, urovne: ['mesto'],
    hodin: [24, 96], dopad: { navstevnost: -0.22 },
    popis: 'Uzavřená hlavní třída a objížďky. Zákazníci to k prádlomatu mají složitější.' },
  { typ: 'detergent', nazev: 'Nedostatek detergentů', ikona: '🧴', vaha: 6, zavaznost: 2, urovne: ['svet', 'zeme'],
    hodin: [48, 144], dopad: { naklady: 0.18 },
    popis: 'Výpadek u dodavatele. Prací prostředky se shánějí hůř a jsou dražší.' },
  { typ: 'mrazy', nazev: 'Mrazy', ikona: '❄️', vaha: 6, zavaznost: 2, urovne: ['zeme'],
    hodin: [24, 96], dopad: { navstevnost: -0.15, naklady: 0.15 },
    popis: 'Silné mrazy. Topí se naplno a lidem se ven nechce.' },
  { typ: 'sucho', nazev: 'Sucho a omezení vody', ikona: '🏜️', vaha: 5, zavaznost: 3, urovne: ['zeme'],
    hodin: [48, 168], dopad: { navstevnost: -0.25, naklady: 0.12 },
    popis: 'Vyhlášené omezení odběru vody. Pere se míň a dráž.' },
  { typ: 'recese', nazev: 'Recese', ikona: '📉', vaha: 4, zavaznost: 3, urovne: ['zeme'],
    hodin: [72, 240], dopad: { navstevnost: -0.28 },
    popis: 'Lidé utahují opasky. Prádlo se nechává doma na ruční praní.' },
  // ── co pomáhá ─────────────────────────────────────────────────────────────
  { typ: 'festival', nazev: 'Festival', ikona: '🎪', vaha: 10, dobra: true, zavaznost: 2, urovne: ['mesto'],
    hodin: [12, 60], dopad: { navstevnost: 0.45 },
    popis: 'Do města se sjeli návštěvníci. Ubytování praská ve švech a prádla je plno.' },
  { typ: 'turiste', nazev: 'Turistická sezóna', ikona: '🧳', vaha: 9, dobra: true, zavaznost: 2, urovne: ['zeme'],
    hodin: [72, 240], dopad: { navstevnost: 0.22 },
    popis: 'Nájezd turistů. Penziony perou víc a hosté hledají samoobslužné prádelny.' },
  { typ: 'hotel', nazev: 'Nový hotel', ikona: '🏨', vaha: 7, dobra: true, zavaznost: 1, urovne: ['mesto'],
    hodin: [48, 168], dopad: { navstevnost: 0.28 },
    popis: 'Ve městě otevřel velký hotel a shání, kde prát.' },
  { typ: 'sport', nazev: 'Sportovní akce', ikona: '🏟️', vaha: 8, dobra: true, zavaznost: 2, urovne: ['mesto'],
    hodin: [12, 48], dopad: { navstevnost: 0.4 },
    popis: 'Velký zápas a s ním plné hotely, dresy a ručníky.' },
  { typ: 'levneenergie', nazev: 'Zlevnění energií', ikona: '💡', vaha: 7, dobra: true, zavaznost: 1, urovne: ['zeme', 'svet'],
    hodin: [48, 168], dopad: { naklady: -0.18 },
    popis: 'Ceny elektřiny spadly. Provoz je na chvíli levnější.' },
  { typ: 'rust', nazev: 'Hospodářský růst', ikona: '📈', vaha: 5, dobra: true, zavaznost: 2, urovne: ['zeme'],
    hodin: [72, 240], dopad: { navstevnost: 0.2 },
    popis: 'Lidem se vede líp a za pohodlí si rádi připlatí.' },
];

// Kde co hrozí víc. Čeho tu není, má váhu jedna.
const RIZIKA = {
  cz: { povoden: 1.6, mrazy: 1.3, festival: 1.3 },
  sk: { povoden: 1.4, mrazy: 1.3 },
  pl: { mrazy: 1.5, energie: 1.3 },
  at: { mrazy: 1.4, turiste: 1.5 },
  de: { energie: 1.4, doprava: 1.2 },
  es: { sucho: 2, turiste: 1.8, mrazy: 0.2 },
  it: { sucho: 1.6, turiste: 1.7, mrazy: 0.4 },
  hr: { turiste: 2, sucho: 1.5, mrazy: 0.3 },
  hu: { sucho: 1.4, povoden: 1.3 },
};

const nahodne = (a, b) => a + Math.random() * (b - a);
const vyber = (pole) => pole[Math.floor(Math.random() * pole.length)];

async function zapnuto() {
  try { return (await acct._nastaveni()).udalosti_zap !== '0'; }
  catch (e) { return true; }
}

// Města, ze kterých se dá vybírat — jen ta, kde někdo opravdu staví.
async function mesta() {
  const rows = await prisma.gameArea.findMany({
    where: { country: { not: null } },
    select: { key: true, name: true, country: true }, take: 500,
  });
  return rows.filter((m) => m.country && m.country !== 'xx');
}

function vahaProZemi(sablona, zeme) {
  const r = (RIZIKA[zeme] || {})[sablona.typ];
  return sablona.vaha * (r == null ? 1 : r);
}

// Vybere náhodnou šablonu podle vah.
function losujSablonu(zeme) {
  const vahy = KATALOG.map((s) => vahaProZemi(s, zeme));
  let suma = vahy.reduce((a, b) => a + b, 0), r = Math.random() * suma;
  for (let i = 0; i < KATALOG.length; i++) { r -= vahy[i]; if (r <= 0) return KATALOG[i]; }
  return KATALOG[KATALOG.length - 1];
}

async function zalozUdalost() {
  const seznam = await mesta();
  if (!seznam.length) return null;
  const kde = vyber(seznam);
  const sablona = losujSablonu(kde.country);
  const uroven = vyber(sablona.urovne);
  const hodin = nahodne(sablona.hodin[0], sablona.hodin[1]);
  const od = new Date();
  const data = {
    typ: sablona.typ, nazev: sablona.nazev, popis: sablona.popis, ikona: sablona.ikona,
    dobra: !!sablona.dobra, uroven, zavaznost: sablona.zavaznost, dopad: sablona.dopad,
    zeme: uroven === 'svet' ? null : kde.country,
    area_key: uroven === 'mesto' ? kde.key : null,
    od, do: new Date(od.getTime() + hodin * 3600000),
  };
  // Dvě stejné události na stejném místě vedle sebe nedávají smysl.
  const uz = await prisma.gameEvent.findFirst({ where: { typ: data.typ, do: { gt: od },
    zeme: data.zeme, area_key: data.area_key } });
  if (uz) return null;
  const e = await prisma.gameEvent.create({ data });
  console.log('[game-udalosti] ' + e.nazev + ' · ' + uroven
    + (e.area_key ? ' ' + kde.name : e.zeme ? ' ' + e.zeme.toUpperCase() : ' svět')
    + ' · ' + Math.round(hodin) + ' h');
  return e;
}

let bezi = false;
async function tik() {
  if (bezi) return;
  bezi = true;
  try {
    if (!(await zapnuto())) return;
    const ted = new Date();
    const aktivnich = await prisma.gameEvent.count({ where: { od: { lte: ted }, do: { gt: ted } } });
    if (aktivnich >= NAJEDNOU_MAX) return;
    // Čím prázdnější svět, tím spíš se něco semele — ať tam pořád něco žije.
    const sance = SANCE_ZA_TIK * (1 + (NAJEDNOU_MAX - aktivnich) / NAJEDNOU_MAX);
    // Pojistka proti mrtvému světu: když se nikde nic neděje a ani se dlouho
    // nedělo, vyhlásíme něco natvrdlo. Jinak by hráč mohl trefit prázdno.
    let nutne = false;
    if (!aktivnich) {
      const posledni = await prisma.gameEvent.findFirst({ orderBy: { do: 'desc' }, select: { do: true } });
      nutne = !posledni || ted.getTime() - new Date(posledni.do).getTime() > TICHO_MAX;
    }
    if (!nutne && Math.random() >= sance) return;
    await zalozUdalost();
  } catch (e) {
    console.warn('[game-udalosti] tik:', e && e.message);
  } finally { bezi = false; }
}

function start() {
  setTimeout(tik, 30000);
  setInterval(tik, TIK_MS);
  console.log('[game-udalosti] generátor světových událostí běží');
}

module.exports = { start, tik, KATALOG };
