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

// Kolik má hráč zamčeného pod běžícími nabídkami a nesplacenými
// nedoplatky dividendy. Nedoplatek je dluh firmy vůči podílníkům: dokud
// běží, nemá si její majitel brát další závazky.
async function zamceno(playerId) {
  const ted = new Date();
  const [rows, dluhy, akcie] = await Promise.all([
    prisma.gameTender.findMany({
      where: { utocnik_id: playerId, stav: 'bezi', trvala: false },
    }).catch(() => []),
    prisma.gameEquity.findMany({
      where: { firma_id: playerId, stav: 'bezi' }, select: { nedoplatek: true },
    }).catch(() => []),
    // Nákupní nabídka v pořadníku akcií je stejný slib jako nabídka na
    // převzetí: kdokoli mi do ní může prodat a já musím zaplatit. Bez téhle
    // položky by hráč jedněmi penězi podložil deset nabídek a devíti lidem
    // by pak server řekl, že se to nepovedlo.
    // Tabulka nemusí v klientovi existovat — třeba když se po nasazení
    // nestihl přegenerovat. Rezervace gatují KAŽDÝ nákup ve hře, takže je
    // nesmí shodit chybějící tabulka: radši se nezamkne nic, než aby se
    // nedalo hrát. Proto se na ni sahá přes volitelný přístup, ne natvrdo.
    (prisma.gameAkcieNabidka ? prisma.gameAkcieNabidka.findMany({
      where: { player_id: playerId, stav: 'bezi', smer: 'koupit' },
      select: { zbyva: true, cena: true },
    }).catch(() => []) : Promise.resolve([])),
  ]);
  const zNabidek = rows
    .filter((t) => !t.do || new Date(t.do) > ted)
    .reduce((a, t) => a + zbyvaZNabidky(t), 0);
  const zDividend = dluhy.reduce((a, x) => a + Math.max(0, Number(x.nedoplatek) || 0), 0);
  const zAkcii = akcie.reduce((a, x) =>
    a + Math.max(0, Math.floor(Number(x.zbyva) || 0)) * Math.max(0, Math.round(Number(x.cena) || 0)), 0);
  return Math.round(zNabidek + zDividend + zAkcii);
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
