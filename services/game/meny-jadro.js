// =============================================================================
// Měny ceníku — tabulka a počty, bez databáze
// =============================================================================
// Schválně oddělené od meny.js: tahle část nesahá na nastavení hry, takže se
// dá spustit a otestovat samostatně. Kurzy a mapování jazyků si načítá
// meny.js a předává je sem jako obyčejná data.
'use strict';

// Korun za jednotku. Výchozí hodnoty jsou jen záchrana, než se kurz nastaví —
// drží se schválně nad trhem, ať se nikdy neprodává pod cenou.
// Záchytné hodnoty pro případ, že ještě nikdy neproběhlo stažení z ČNB —
// v novém prostředí nebo hned po nasazení. Skutečné kurzy si hra stahuje
// sama (services/game/kurzy.js) a drží je v nastavení hry. Tahle čísla jsou
// kurzy ČNB k 16. 11. 2026; předchozí byly odhad od oka a zlotý kvůli tomu
// účtoval o osm procent míň, než měl.
const KURZY_VYCHOZI = { czk: 1, eur: 24.43, usd: 22.182, pln: 5.548 };

// krok = na kolik nejmenších jednotek se zaokrouhluje nahoru
// pred = patří značka před číslo? ($5 ano, 5 Kč ne)
// nastaveni = klíč v nastavení hry, kterým se mění kurz
const MENY = {
  czk: { kod: 'czk', znak: 'Kč', des: 0, krok: 100, pred: false, nastaveni: null },
  eur: { kod: 'eur', znak: '€',  des: 2, krok: 10,  pred: false, nastaveni: 'kurz_eur' },
  usd: { kod: 'usd', znak: '$',  des: 2, krok: 10,  pred: true,  nastaveni: 'kurz_usd' },
  pln: { kod: 'pln', znak: 'zł', des: 2, krok: 10,  pred: false, nastaveni: 'kurz_pln' },
};

// Rozhoduje jazyk, ne země. Hráč si ho přepíná sám a je to jediný signál,
// u kterého víme, že ho zvolil vědomě. Jazyk, který tu není, platí v eurech —
// to je horší než správná měna, ale pořád lepší než koruny, které nikdo mimo
// Česko nezná.
const MENA_JAZYKA = { cs: 'czk', en: 'eur', pl: 'pln', de: 'eur', es: 'eur', fr: 'eur' };
const MENA_VYCHOZI = 'eur';
// Co Stripe umí účtovat. Co by v mapování přibylo navíc, musí se nejdřív
// doplnit sem i do MENY.
const STRIPE_UMI = ['czk', 'eur', 'usd', 'pln'];

// Nastavení hry smí mapování přepsat: { "en": "usd" }. Tím se dá v den
// spuštění další řeči přepnout měna bez nasazení.
function menaZMapy(jazyk, mapa) {
  const j = String(jazyk || 'cs');
  const z = mapa && Object.prototype.hasOwnProperty.call(mapa, j) ? String(mapa[j]).toLowerCase() : null;
  if (z && MENY[z]) return z;
  if (z) console.warn('[meny] jazyk ' + j + ' je namapovaný na neznámou měnu ' + z);
  return MENA_JAZYKA[j] || MENA_VYCHOZI;
}

// Haléře → nejmenší jednotka cílové měny. Zaokrouhluje se vždycky NAHORU na
// celý krok: dolů by to znamenalo prodávat pod cenou kvůli kurzu, a drobné
// ocásky typu 1,96 € vypadají v ceníku jako chyba.
function prepoctiS(halere, mena, kurzy) {
  const m = MENY[mena] || MENY.czk;
  const k = (kurzy && kurzy[m.kod]) || KURZY_VYCHOZI[m.kod] || 1;
  const hrube = (Number(halere) || 0) / k;
  return Math.max(m.krok, Math.ceil(hrube / m.krok) * m.krok);
}

// Částka v nejmenší jednotce → koruny, pro součty v adminu. Bez tohohle by se
// dolary sečetly s korunami po hlavě a tržby by seděly jen v Česku.
function naKoruny(castka, mena, kurzy) {
  const m = MENY[String(mena || 'czk').toLowerCase()] || MENY.czk;
  const k = (kurzy && kurzy[m.kod]) || KURZY_VYCHOZI[m.kod] || 1;
  return ((Number(castka) || 0) / 100) * k;
}

// Co by na ceníku nesedělo. Vrací seznam vět, prázdný = v pořádku.
function potize(kurzy, mapa) {
  const out = [];
  Object.keys(MENY).forEach((k) => {
    if (STRIPE_UMI.indexOf(k) < 0) out.push('měnu ' + k + ' Stripe neumí');
    if (!((kurzy && kurzy[k]) > 0)) out.push('měna ' + k + ' nemá kurz');
    const m = MENY[k];
    if (k !== 'czk' && !m.nastaveni) out.push('měna ' + k + ' nemá klíč na kurz v nastavení');
    if (m.des === 0 && m.krok !== 100) out.push('měna ' + k + ' má des 0, ale krok není 100');
  });
  const cela = Object.assign({}, MENA_JAZYKA, mapa || {});
  Object.keys(cela).forEach((j) => {
    const m = String(cela[j]).toLowerCase();
    if (!MENY[m]) out.push('jazyk ' + j + ' ukazuje na neznámou měnu ' + m);
    else if (STRIPE_UMI.indexOf(m) < 0) out.push('jazyk ' + j + ' ukazuje na měnu ' + m + ', kterou Stripe neumí');
  });
  return out;
}

module.exports = { MENY, MENA_JAZYKA, MENA_VYCHOZI, STRIPE_UMI, KURZY_VYCHOZI,
  menaZMapy, prepoctiS, naKoruny, potize };
