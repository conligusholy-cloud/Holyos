// =============================================================================
// Laundromat Tycoon — dividendová politika
// =============================================================================
// Podíl ve firmě dosud znamenal jen peníze: každý měsíc odešel podílníkovi
// jeho díl zisku a tím to končilo. Kdo skoupil většinu, neměl z toho o nic
// víc než ten, kdo držel procento.
//
// Dividendová politika je první pravomoc, kterou většina dostává. Určuje
// jedinou věc: kolik procent měsíčního zisku firma vyplácí podílníkům.
//
//   100 %  všechno jde ven — hotovost hned (tak to fungovalo doteď)
//     0 %  nevyplácí se nic — peníze zůstanou ve firmě a rostou v její hodnotě
//
// Je to volba mezi penězi teď a hodnotou potom, a dělá ji ten, kdo drží víc
// než polovinu. Majitel ji změnit nemůže — jinak by si investory pozval a
// pak jim výplatu utnul. Když většinu nemá nikdo, zůstává na stu procentech
// a nesahá na ni nikdo.
//
// Co se vědomě NEŠKÁLUJE: ztráta. Když firma prodělává, podílník doplácí
// svůj díl vždycky celý. Kdyby politika hýbala i ztrátou, většinový podílník
// by si před ztrátovým měsícem nastavil nulu a nechal ji na majiteli — a to
// už není politika, to je úhyb.
//
// Minimální dividenda (19. 11.) řeší druhou polovinu: většina může firmě
// uložit, kolik měsíčně vyplatí NEJMÉNĚ. Původní námitka — že vynucená
// výplata je vymáhání peněz z cizího účtu, dokud je hotovost firmy
// hotovostí majitele — pořád platí, a proto se nic nevymáhá. Co firma
// nevydělá, se nikomu nebere: rozdíl se zapíše podílníkovi jako NEDOPLATEK
// a vyplatí se, jakmile firma vydělá. Slib tím má váhu (dokud nedoplatek
// běží, majitel nesmí nové závazky), ale nikdo nesahá na cizí hotovost.
//
// Víc než svůj díl zisku firma nevyplatí nikdy. To je ta mez, která z toho
// dělá dividendu, a ne exekuci.

'use strict';

// Kdo politiku určuje, řeší prava.js — prahy mají být na jednom místě,
// ať se nestane, že se většina počítá na dvou místech jinak.
const PRAVA = require('./prava');

const VYCHOZI = 1;      // tak se vyplácelo, než politika vznikla
const MIN = 0;
const MAX = 1;
const VETSINA = PRAVA.VETSINA;

// Hodnota, se kterou se dá počítat. Nesmysl i chybějící údaj spadne na
// výchozí sto procent, protože výplata musí proběhnout vždycky.
// Pozor na null: Number(null) je nula, takže by chybějící sloupec v databázi
// potichu zastavil výplaty celé hře. Chybějící údaj je výchozí sto procent,
// nula je nula jen tehdy, když ji tam někdo doopravdy napsal.
function platna(x) {
  if (x === null || x === undefined || x === '') return VYCHOZI;
  const n = Number(x);
  if (!isFinite(n)) return VYCHOZI;
  return Math.max(MIN, Math.min(MAX, n));
}

// Kdo politiku určuje: podílník s víc než polovinou. Jinak nikdo.
const kdoUrcuje = PRAVA.kdoUrcuje;
const smiMenit = PRAVA.smiMenit;

// Co se za měsíc vyplatí z jednoho podílu. Zisk se krátí politikou,
// ztráta nikdy.
function castka(zbyde, podil, pct) {
  const z = Number(zbyde) || 0;
  const p = Number(podil) || 0;
  if (z < 0) return Math.round(z * p);
  return Math.round(z * p * platna(pct));
}

// Kolik z firmy měsíčně odejde při dané politice — pro přehled majiteli.
function odchoziCelkem(zbyde, podily, pct) {
  return (podily || []).reduce((a, e) => a + castka(zbyde, e.podil, pct), 0);
}

// Minimální měsíční výplata. Nesmysl i chybějící údaj je nula, tedy stav
// před touhle pravomocí: vyplácí se jen podíl ze zisku.
function platnyMin(x) {
  const n = Math.round(Number(x) || 0);
  return n > 0 ? n : 0;
}

// Strop, který se dá slíbit: co firma teď měsíčně vydělá. Kdyby šlo slíbit
// víc, nebyla by to dividendová politika, ale způsob, jak majiteli
// nasbírat nedoplatek, který nemůže splatit, a tím mu zavřít obchod.
function stropMin(zbyde) {
  return Math.max(0, Math.round(Number(zbyde) || 0));
}

// Co se podílníkovi za měsíc vyplatí a co z toho zůstane dlužné.
//
//   zaklad  dnešní výplata podle politiky (podíl ze zisku krácený pct)
//   slib    co se dluží: minimum na tenhle podíl plus starý nedoplatek
//   strop   svůj díl zisku — víc firma nevyplatí ani kdyby dlužila víc
//
// Ztráta se nemění: podílník nese svůj díl celý jako dřív, a minimum se
// za takový měsíc celé zapíše do nedoplatku.
function rozpad(zbyde, podil, pct, min, nedoplatek) {
  const z = Number(zbyde) || 0;
  const p = Number(podil) || 0;
  const stary = Math.max(0, Math.round(Number(nedoplatek) || 0));
  const slib = Math.round(platnyMin(min) * p) + stary;
  if (z < 0) {
    // Ztrátový měsíc: doplatek od podílníka jako dřív, slib se jen zapíše.
    return { vyplata: castka(z, p, pct), nedoplatek: slib, zaklad: castka(z, p, pct), slib };
  }
  const zaklad = castka(z, p, pct);
  const strop = Math.max(0, Math.round(z * p));
  const vyplata = Math.min(strop, Math.max(zaklad, slib));
  return { vyplata, nedoplatek: Math.max(0, slib - vyplata), zaklad, slib, strop };
}

module.exports = { platna, platnyMin, stropMin, rozpad, kdoUrcuje, smiMenit, castka,
  odchoziCelkem, VYCHOZI, MIN, MAX, VETSINA };
