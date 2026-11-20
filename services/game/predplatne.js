// =============================================================================
// Laundromat Tycoon — předplatné: co se účtuje a co hráč dostává
// =============================================================================
// U předplatného na techniky se dá počet měnit za běhu. Dřív se rozdíl řešil
// doplatkem ve Stripu (proration) a vypadalo to jako chyba: karta slíbila
// 234 Kč, na výpisu bylo 309,68. Částka byla správně — byl v ní doplatek za
// techniky přidané během předchozího týdne — ale karta o něm mlčela.
//
// Doplatky jsou proto zrušené. Účtuje se vždycky celé období novým počtem,
// a to až od příští platby. Tím se ale rozcházejí dvě čísla a každé je
// potřeba jinde:
//
//   qty            co se bude účtovat při nejbližší platbě
//   qty_zaplaceno  za kolik je zaplacené období, které zrovna běží
//
// Hráč dostává VĚTŠÍ z nich. Přikoupí-li, má technika hned a zaplatí za něj
// až příště (bonus, který mu odpouštíme). Ubere-li, účtovat se bude míň,
// ale do konce zaplaceného období mu běží to, co si zaplatil — takže o nic
// nepřijde a zároveň se tím nedá obejít placení.
'use strict';

const kladne = (x, vychozi) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) && n > 0 ? n : vychozi;
};

// Kolik kusů hráči právě teď běží.
function platnyPocet(qty, qtyZaplaceno) {
  const uctuje = kladne(qty, 1);
  // Prázdná hodnota u starších řádků znamená „stejně jako qty".
  const zaplaceno = qtyZaplaceno == null ? uctuje : kladne(qtyZaplaceno, uctuje);
  return Math.max(uctuje, zaplaceno);
}

// Kolik se bude účtovat při nejbližší platbě.
const uctovanyPocet = (qty) => kladne(qty, 1);

module.exports = { platnyPocet, uctovanyPocet };
