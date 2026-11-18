// =============================================================================
// Laundromat Tycoon — souběh: dva lidé ve stejné vteřině
// =============================================================================
// Mezi tím, než si obsluha načte nabídku, a tím, než zapíše převod, uběhne
// pár desetin vteřiny. Když se do nich trefí druhý člověk — nebo jen druhé
// kliknutí toho samého — projde kontrola dvakrát a zapíše se to dvakrát.
// U obchodu s podíly to znamená, že se jeden podíl převede dvěma lidem a
// peníze se vyplatí dvakrát. Pozná se to až ve chvíli, kdy někdo počítá
// procenta a vyjde mu sto dvacet.
//
// Lék je jediný a nestojí na tom, kdo byl rychlejší: změnu stavu zapsat
// PODMÍNĚNĚ — „přepiš čekající na přijatou" — a podívat se, kolik řádků to
// doopravdy změnilo. Jedna znamená, že nabídku zabral ten, kdo se ptá. Nula
// znamená, že ji zabral někdo jiný o chlup dřív, a tahle transakce nemá co
// dělat dál. Databáze tím rozhodne za nás, protože podmíněný zápis je
// atomický — a nemusí se kvůli tomu zamykat celá tabulka.
//
// Proč výjimka a ne návratová hodnota: podmíněný zápis je obvykle hluboko
// uvnitř transakce a mezi ním a odpovědí je ještě půl obsluhy. Výjimka
// transakci rovnou shodí — tedy se nestane nic — a obsluha ji nahoře
// přeloží na slušnou hlášku.

'use strict';

class Soubeh extends Error {
  constructor(klic, udaje) {
    super(klic);
    this.name = 'Soubeh';
    this.klic = klic;
    this.udaje = udaje || null;
  }
}

// Podmíněný zápis musí trefit právě jeden řádek. Nula = byl někdo dřív.
// Víc než jeden by znamenalo špatnou podmínku, což je chyba v kódu — ale
// zastavit se to musí stejně, zapsané už je to špatně.
function zamkni(vysledek, klic, udaje) {
  const kolik = (vysledek && vysledek.count) || 0;
  if (kolik !== 1) throw new Soubeh(klic, udaje);
  return true;
}

// Nahoře v obsluze: je to souběh? Pak odpověz 409 v jazyce hráče a vrať
// true, ať se nepokračuje. Cokoli jiného propadne dál jako skutečná chyba.
function odpoved(e, res, prelozit) {
  if (!(e instanceof Soubeh)) return false;
  res.status(409).json({ error: prelozit(e.klic, e.udaje) });
  return true;
}

module.exports = { Soubeh, zamkni, odpoved };
