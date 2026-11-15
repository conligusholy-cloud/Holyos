// =============================================================================
// Laundromat Tycoon — hodnosti a odznaky
// =============================================================================
// Hodnost je jedna, roste s čistým jměním a slouží hlavně k orientaci: hráč
// má pořád vidět, kde stojí a co je další meta. Odznaky jsou vedle toho a
// říkají, JAKÝ ten hráč je — jestli půjčuje, investuje, nebo bere telefony.
//
// Počítá se to tady na jednom místě schválně: hodnost, kterou vidí ostatní na
// burze a v žebříčku, musí spočítat server. Hra běží v prohlížeči hráče a
// cokoli, co pošle ven, jde zfalšovat — u titulu, který má na burze sloužit
// jako záruka, by to bylo zvlášť citlivé. Prohlížeč si tentýž žebřík počítá
// jen pro vlastní lištu.
'use strict';

// Hranice jsou schválně strmé: další stupeň má být vidět, ale ne na dosah.
// Odměna je zlomek jmění, které si na ni hráč musel vydělat — je to gesto,
// ne zdroj příjmu, aby to nerozhodilo ekonomiku.
const HODNOSTI = [
  { id: 'pradlak', nazev: 'Pradlák', od: 0, odmena: null },
  { id: 'zivnostnik', nazev: 'Živnostník', od: 3e6, odmena: { cash: 150000 } },
  { id: 'provozovatel', nazev: 'Provozovatel', od: 10e6, odmena: { karta: 'credit' } },
  { id: 'sitar', nazev: 'Majitel sítě', od: 30e6, odmena: { cash: 1e6 } },
  { id: 'magnat', nazev: 'Magnát', od: 80e6, odmena: { karta: 'traffic' } },
  { id: 'baron', nazev: 'Baron prádla', od: 200e6, odmena: { cash: 5e6 } },
  { id: 'legenda', nazev: 'Legenda', od: 500e6, odmena: { karta: 'credit' } },
];

// Který stupeň odpovídá danému jmění. Vrací i další metu, ať je co ukázat.
function hodnost(jmeni) {
  const j = Number(jmeni) || 0;
  let i = 0;
  for (let k = 0; k < HODNOSTI.length; k++) if (j >= HODNOSTI[k].od) i = k;
  const h = HODNOSTI[i], dalsi = HODNOSTI[i + 1] || null;
  return {
    stupen: i, id: h.id, nazev: h.nazev, od: h.od,
    dalsi: dalsi ? dalsi.nazev : null,
    dalsi_od: dalsi ? dalsi.od : null,
    do_dalsi: dalsi ? Math.max(0, dalsi.od - j) : null,
  };
}

// ─── Odznaky ─────────────────────────────────────────────────────────────────
// Odměnou je karta, ne hotovost. Bankéře i Investora si dva domluvení hráči
// vyrobí, ale za jednu kartu to nikdo dělat nebude — kdyby to sypalo peníze,
// vznikl by z toho příjem a lidi by přestali hrát hru a hráli odznaky.
// Proto mají ty dvě podmínky navíc čas: musí to chvíli opravdu běžet.
const ODZNAKY = [
  { kod: 'banker', barva: ['#f0b429','#b06d0a'], nazev: 'Bankéř', ikona: '🏦', odmena: { karta: 'rush' },
    popis: 'Půjčil jinému hráči a dostal celou půjčku zpátky.',
    jak: 'Půjč někomu na burze a nech půjčku doběhnout — musí běžet aspoň šest herních měsíců.' },
  { kod: 'investor', barva: ['#3fd68e','#107a4e'], nazev: 'Investor', ikona: '📈', odmena: { karta: 'rush' },
    popis: 'Drží podíl ve třech různých firmách a aspoň jeden mu už něco vynesl.',
    jak: 'Kup si podíl ve třech různých firmách a počkej si na vyrovnání.' },
  { kod: 'cestovatel', barva: ['#4fd1ff','#1565a8'], nazev: 'Cestovatel', ikona: '🗺️', odmena: { karta: 'connect' },
    popis: 'Má postavený prádlomat ve třech zemích.',
    jak: 'Rozjeď síť i za hranicemi — stačí jeden prádlomat ve třech různých zemích.' },
  { kod: 'hvezdy', barva: ['#ffe08a','#d99a1f'], nazev: 'Pět hvězd', ikona: '⭐', odmena: { karta: 'traffic' },
    popis: 'Udržel hodnocení 4,5 ★ celý týden v kuse.',
    jak: 'Ber hovory a odpovídej slušně. Hlídá se sedm dní bez přerušení.' },
  { kod: 'spojovatel', barva: ['#a78bfa','#5b3fc4'], nazev: 'Spojovatel', ikona: '📞', odmena: { karta: 'rush' },
    popis: 'Vzal padesát hovorů sám. Operátor se nepočítá.',
    jak: 'Zvedej telefon osobně. Hovory vyřízené placenou infolinkou se nepočítají.' },
  { kod: 'krizovka', barva: ['#67e8f9','#0e7490'], nazev: 'Krizovka', ikona: '🌊', odmena: { karta: 'connect' },
    popis: 'Postavil prádlomat v době, kdy běžela ekonomická krize.',
    jak: 'Až přijde krize, nestavěj stop — postav.' },
  { kod: 'mrchozrout', barva: ['#fda4af','#9f1239'], nazev: 'Mrchožrout', ikona: '🧯', odmena: { karta: 'rush' },
    popis: 'Koupil prádlomat z konkurzu.',
    jak: 'Sleduj konkurzní rozprodej — majetek po zkrachovalých jde za klesající cenu.' },
  { kod: 'naborar', barva: ['#86efac','#15803d'], nazev: 'Náborář', ikona: '🤝', odmena: { karta: 'traffic' },
    popis: 'Pozval tři hráče, kteří opravdu postavili prádlomat.',
    jak: 'Rozešli svůj odkaz. Počítají se jen ti, co se do hry doopravdy pustili.' },
];
const ODZNAK = {};
ODZNAKY.forEach((o) => { ODZNAK[o.kod] = o; });

module.exports = { HODNOSTI, hodnost, ODZNAKY, ODZNAK };
