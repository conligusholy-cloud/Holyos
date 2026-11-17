// =============================================================================
// Měna skutečných plateb podle jazyka hráče
// =============================================================================
// Ceny v ceníku jsou v haléřích, protože hra začala v korunách. Kdo hraje
// jinou řečí, ale nemá platit v korunách — nezná je a kurz si v hlavě
// nepřepočítá.
//
// Zásadní je, že převod je na JEDNOM místě. Cena, kterou hráč vidí, a cena,
// kterou mu strhne Stripe, musí vzniknout stejným výpočtem; kdyby se počítaly
// zvlášť, dřív nebo později se rozejdou o cent a hráč se bude právem ptát.
//
// Měny jsou připravené dopředu, ať se v den spuštění další řeči nesahá do
// kódu: stačí v nastavení hry přemapovat jazyk na měnu (klíč meny_jazyku).
// Co se tím NESMÍ stát, je ukázat číslo v jedné měně a značku jiné — proto
// tabulka v meny-jadro.js drží u každé měny i to, kam značka patří a na kolik
// desetinných míst se zaokrouhluje, a server to posílá klientovi s sebou.
// Klient si nic neodvozuje sám.
//
// Kurzy drží nastavení hry (kurz_eur, kurz_usd, kurz_pln) — korun za jednotku,
// aby se kvůli pohybu kurzu nemusel nasazovat nový kód.
'use strict';

const { prisma } = require('../../config/database');
const J = require('./meny-jadro');

const { MENY, MENA_JAZYKA, MENA_VYCHOZI, STRIPE_UMI, KURZY_VYCHOZI } = J;
const NASTAVENI_MAPY = 'meny_jazyku';

let _cache = { at: 0, kurzy: Object.assign({}, KURZY_VYCHOZI), mapa: null };

// Kurzy i mapování jedním dotazem — ceník se ptá na čtyřicet cen naráz.
async function nactiNastaveni() {
  if (Date.now() - _cache.at < 300e3) return _cache;
  const kurzy = Object.assign({}, KURZY_VYCHOZI);
  let mapa = null;
  try {
    const klice = Object.keys(MENY).map((k) => MENY[k].nastaveni).filter(Boolean);
    const rows = await prisma.gameSetting.findMany({
      where: { klic: { in: klice.concat([NASTAVENI_MAPY]) } } });
    rows.forEach((r) => {
      if (r.klic === NASTAVENI_MAPY) {
        try {
          const m = JSON.parse(String(r.hodnota || '{}'));
          if (m && typeof m === 'object') mapa = m;
        } catch (e) { console.warn('[meny] ' + NASTAVENI_MAPY + ' není platný JSON, jede výchozí mapování'); }
        return;
      }
      const kod = Object.keys(MENY).filter((k) => MENY[k].nastaveni === r.klic)[0];
      const n = Number(r.hodnota);
      if (kod && isFinite(n) && n > 0) kurzy[kod] = n;
    });
  } catch (e) { /* bez nastavení jedou výchozí hodnoty */ }
  _cache = { at: Date.now(), kurzy, mapa };
  return _cache;
}

// Po změně kurzu v nastavení se nečeká pět minut. Admin si řekne sám.
function zapomen() { _cache = { at: 0, kurzy: Object.assign({}, KURZY_VYCHOZI), mapa: _cache.mapa }; }

// Kurz eura zvlášť — admin ho ukazuje v přehledu tržeb.
async function kurzEur() { return (await nactiNastaveni()).kurzy.eur; }
async function kurzy() { return (await nactiNastaveni()).kurzy; }

// Synchronní varianta pro místa, kde se na nastavení čekat nedá: jede
// z posledního načtení, tedy nejvýš pět minut staré.
function menaProJazyk(jazyk) { return J.menaZMapy(jazyk, _cache.mapa); }
async function menaProJazykAsync(jazyk) {
  const n = await nactiNastaveni();
  return J.menaZMapy(jazyk, n.mapa);
}

// Částka v nejmenší jednotce → koruny, pro součty v adminu.
function naKoruny(castka, mena, kurzyMap) { return J.naKoruny(castka, mena, kurzyMap || _cache.kurzy); }

// Pro jednu cenu. Vrací i částku k zobrazení, ať si ji nikdo nepočítá sám.
async function cenaProJazyk(halere, jazyk) {
  const n = await nactiNastaveni();
  const mena = J.menaZMapy(jazyk, n.mapa);
  const castka = J.prepoctiS(halere, mena, n.kurzy);
  return { mena, castka, zobrazit: castka / 100,
    znak: MENY[mena].znak, des: MENY[mena].des, pred: MENY[mena].pred };
}

// Pro celý ceník naráz — jeden dotaz na nastavení místo čtyřiceti.
async function prevodnik(jazyk) {
  const n = await nactiNastaveni();
  const mena = J.menaZMapy(jazyk, n.mapa);
  const m = MENY[mena];
  return {
    mena, znak: m.znak, des: m.des, pred: m.pred, kurz: n.kurzy[mena] || 1,
    // halere → částka v nejmenší jednotce cílové měny
    halere: (x) => J.prepoctiS(x, mena, n.kurzy),
    // halere → číslo k zobrazení (koruny / eura / dolary / zloté)
    zobraz: (x) => J.prepoctiS(x, mena, n.kurzy) / 100,
  };
}

// Kontrola při startu: ať se neukáže měna, za kterou se nedá účtovat.
async function zkontroluj() {
  const n = await nactiNastaveni();
  const p = J.potize(n.kurzy, n.mapa);
  if (p.length) console.warn('[meny] POZOR: ' + p.join('; '));
  return p;
}

module.exports = { MENY, MENA_JAZYKA, MENA_VYCHOZI, STRIPE_UMI, KURZY_VYCHOZI,
  menaProJazyk, menaProJazykAsync, kurzEur, kurzy, naKoruny, zapomen,
  cenaProJazyk, prevodnik, zkontroluj,
  // zpětná kompatibilita: dřív se vozil jen kurz eura
  KURZ_VYCHOZI: KURZY_VYCHOZI.eur };
