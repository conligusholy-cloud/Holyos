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
//
// Texty (názvy, popisy, návody) jsou v katalogu překladů, ne tady — tenhle
// soubor drží jen pravidla a čísla. Každá funkce, která text vrací, bere
// jazyk: skládá se pro toho, KOMU se to posílá.
'use strict';

const TEXTY = require('./texty');

// Hranice jsou schválně strmé: další stupeň má být vidět, ale ne na dosah.
// Odměna je zlomek jmění, které si na ni hráč musel vydělat — je to gesto,
// ne zdroj příjmu, aby to nerozhodilo ekonomiku.
const HODNOSTI = [
  { id: 'pradlak', od: 0, odmena: null },
  { id: 'zivnostnik', od: 3e6, odmena: { cash: 150000 } },
  { id: 'provozovatel', od: 10e6, odmena: { karta: 'credit' } },
  { id: 'sitar', od: 30e6, odmena: { cash: 1e6 } },
  { id: 'magnat', od: 80e6, odmena: { karta: 'traffic' } },
  { id: 'baron', od: 200e6, odmena: { cash: 5e6 } },
  { id: 'legenda', od: 500e6, odmena: { karta: 'credit' } },
  // Nad Legendou pokračuje žebřík do miliard. Odměna zůstává gestem — kolem
  // dvou procent jmění, za které se na stupeň hráč vyšplhal — a platí se
  // v hotovosti: karty se na téhle úrovni opakovat nedají, trvalou kampaň
  // i lepšího bankéře hráč dávno má.
  { id: 'miliardar', od: 1e9, odmena: { cash: 20e6 } },
  { id: 'kral', od: 2.5e9, odmena: { cash: 50e6 } },
  { id: 'cisar', od: 5e9, odmena: { cash: 100e6 } },
];

function nazevHodnosti(id, jazyk) {
  return id ? TEXTY.t('hodnost.' + id, {}, jazyk) : null;
}
// Žebřík i s názvy — tohle se posílá do hry, aby lišta ukazovala tentýž titul,
// jaký u hráče vidí ostatní.
function hodnostiPro(jazyk) {
  return HODNOSTI.map((h) => ({ id: h.id, od: h.od, odmena: h.odmena,
    nazev: nazevHodnosti(h.id, jazyk) }));
}

// Který stupeň odpovídá danému jmění. Vrací i další metu, ať je co ukázat.
function hodnost(jmeni, jazyk) {
  const j = Number(jmeni) || 0;
  let i = 0;
  for (let k = 0; k < HODNOSTI.length; k++) if (j >= HODNOSTI[k].od) i = k;
  const h = HODNOSTI[i], dalsi = HODNOSTI[i + 1] || null;
  return {
    stupen: i, id: h.id, nazev: nazevHodnosti(h.id, jazyk), od: h.od,
    dalsi: dalsi ? nazevHodnosti(dalsi.id, jazyk) : null,
    dalsi_id: dalsi ? dalsi.id : null,
    dalsi_od: dalsi ? dalsi.od : null,
    do_dalsi: dalsi ? Math.max(0, dalsi.od - j) : null,
  };
}

// Jednou dosažená hodnost se neztrácí. Potřeba to bylo ve chvíli, kdy jmění
// začal počítat server z vlastních dat: vychází o něco níž než dřívější číslo
// ze stavu hry, protože nezapočítává přípravy ploch, pobočky a četu. Bez
// tohohle by tři hráči spadli o stupeň a brali by to jako trest za něco,
// co neudělali.
//
// Dolů to nejde ani později, až hráč prodá síť — odměnu za stupeň dostal
// jednou a žádná se nevyplácí znovu.
function zmrazena(staraId, spoctena, jazyk) {
  const stary = HODNOSTI.findIndex((x) => x.id === staraId);
  if (stary < 0 || !spoctena) return spoctena;
  return (stary > spoctena.stupen) ? hodnost(HODNOSTI[stary].od, jazyk) : spoctena;
}

// ─── Odznaky ─────────────────────────────────────────────────────────────────
// Odměnou je karta, ne hotovost. Bankéře i Investora si dva domluvení hráči
// vyrobí, ale za jednu kartu to nikdo dělat nebude — kdyby to sypalo peníze,
// vznikl by z toho příjem a lidi by přestali hrát hru a hráli odznaky.
// Proto mají ty dvě podmínky navíc čas: musí to chvíli opravdu běžet.
const ODZNAKY = [
  { kod: 'banker', barva: ['#f0b429', '#b06d0a'], ikona: '🏦', odmena: { karta: 'rush' } },
  { kod: 'investor', barva: ['#3fd68e', '#107a4e'], ikona: '📈', odmena: { karta: 'rush' } },
  { kod: 'cestovatel', barva: ['#4fd1ff', '#1565a8'], ikona: '🗺️', odmena: { karta: 'connect' } },
  { kod: 'hvezdy', barva: ['#ffe08a', '#d99a1f'], ikona: '⭐', odmena: { karta: 'traffic' } },
  { kod: 'spojovatel', barva: ['#a78bfa', '#5b3fc4'], ikona: '📞', odmena: { karta: 'rush' } },
  { kod: 'krizovka', barva: ['#67e8f9', '#0e7490'], ikona: '🌊', odmena: { karta: 'connect' } },
  { kod: 'mrchozrout', barva: ['#fda4af', '#9f1239'], ikona: '🧯', odmena: { karta: 'rush' } },
  { kod: 'naborar', barva: ['#86efac', '#15803d'], ikona: '🤝', odmena: { karta: 'traffic' } },
];
const ODZNAK = {};
ODZNAKY.forEach((o) => { ODZNAK[o.kod] = o; });

// Jeden odznak i s texty v daném jazyce. Neznámý kód vrátí null, ať se
// nerozsype výpis kvůli překlepu.
function odznakPro(kod, jazyk) {
  const o = ODZNAK[kod];
  if (!o) return null;
  return { kod: o.kod, barva: o.barva, ikona: o.ikona, odmena: o.odmena,
    nazev: TEXTY.t('odznak.' + o.kod + '.nazev', {}, jazyk),
    popis: TEXTY.t('odznak.' + o.kod + '.popis', {}, jazyk),
    jak: TEXTY.t('odznak.' + o.kod + '.jak', {}, jazyk) };
}
function odznakyPro(jazyk) { return ODZNAKY.map((o) => odznakPro(o.kod, jazyk)); }
// Název čehokoli, co se dá dostat jako odměna — hodnosti i odznaku.
function nazevOdmeny(druh, kod, jazyk) {
  if (druh === 'hodnost') return nazevHodnosti(kod, jazyk) || kod;
  const o = odznakPro(kod, jazyk);
  return (o && o.nazev) || kod;
}

module.exports = { HODNOSTI, hodnost, zmrazena, ODZNAKY, ODZNAK,
  nazevHodnosti, hodnostiPro, odznakPro, odznakyPro, nazevOdmeny };
