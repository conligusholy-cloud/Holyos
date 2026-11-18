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
// Co tahle verze vědomě neumí: vynutit výplatu, když firma zrovna nevydělává.
// K tomu by byla potřeba firemní pokladna oddělená od kapsy majitele; dokud
// je hotovost firmy jeho hotovost, minimální dividenda by byla jen jiné
// jméno pro vymáhání peněz z cizího účtu.

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

module.exports = { platna, kdoUrcuje, smiMenit, castka, odchoziCelkem,
  VYCHOZI, MIN, MAX, VETSINA };
