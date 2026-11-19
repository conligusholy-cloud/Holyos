// =============================================================================
// Laundromat Tycoon — rezervace peněz pod běžícími závazky
// =============================================================================
// Vyhlášená nabídka na převzetí je slib: „kdokoli z podílníků mi do zítřka
// prodá, tomu zaplatím". Dosud se kontrolovalo jen to, jestli útočník má na
// celou nabídku v okamžiku vyhlášení — a pak se na ty peníze zapomnělo.
// Šlo tedy vyhlásit tři nabídky na tři firmy z jedněch peněz a dvěma
// podílníkům pak říct, že se nějak nepovedlo.
//
// Rezervace je proto jednoduchá: co je slíbené pod běžícími nabídkami, se
// z volné hotovosti odečítá. Nové závazky se měří proti tomu, co zbývá.
//
// Peníze se doopravdy zamknout nedají — hotovost pořád žije ve stavu hry.
// Tohle je mez, kterou vynucuje server: útočník si je může utratit ve hře,
// ale další závazek mu server nedovolí. Až pokladna dostane autoritu,
// zpřísní se to samo, protože „volné“ pak bude její číslo.
//
// Trvalá výstupní nabídka se nerezervuje: neví se, kolik jí kdo prodá ani
// kdy, takže by zamkla hotovost navždycky. Hlídá se při každém prodeji.
'use strict';

const { prisma } = require('../../config/database');

// Co zbývá doplatit pod jednou nabídkou.
function zbyvaZNabidky(t) {
  if (!t || t.trvala) return 0;
  const zbyva = Math.max(0, (Number(t.max_pct) || 0) - (Number(t.koupeno_pct) || 0));
  return Math.round(zbyva * 100 * (Number(t.cena_za_pct) || 0));
}

// Kolik má hráč zamčeného pod běžícími nabídkami.
async function zamceno(playerId) {
  const ted = new Date();
  const rows = await prisma.gameTender.findMany({
    where: { utocnik_id: playerId, stav: 'bezi', trvala: false },
  }).catch(() => []);
  return rows
    .filter((t) => !t.do || new Date(t.do) > ted)
    .reduce((a, t) => a + zbyvaZNabidky(t), 0);
}

// Volná hotovost = co hra ukazuje, minus zamčené. Bere se číslo hry, ne
// pokladny: pokladna zatím jen měří a její rozdíl je náš, ne hráčův —
// nemá mu zavírat obchod.
async function volne(player, stav) {
  const hotovost = Math.round(Number((stav || {}).cash) || 0);
  const zamknuto = await zamceno(player.id);
  return { hotovost, zamceno: zamknuto, volne: Math.max(0, hotovost - zamknuto) };
}

// Vejde se další závazek? Vrací popis, ne výjimku — co s tím, ví volající.
async function vejdeSe(player, stav, potreba) {
  const v = await volne(player, stav);
  const p = Math.max(0, Math.round(Number(potreba) || 0));
  return Object.assign(v, { potreba: p, ok: p <= v.volne });
}

module.exports = { zamceno, volne, vejdeSe, zbyvaZNabidky };
