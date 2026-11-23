// =============================================================================
// HolyOS — Laundromat Tycoon: analytik hledající nové finty
// =============================================================================
// Analytik dá modelu souhrn hry a nechá ho hledat chování, které detektory
// neumí. Dvě věci se tu musí držet, jinak je to nebezpečné:
//
//   1) Výstup modelu je DATA, ne příkaz. Nesmí nic zahájit, nic zmrazit
//      a nesmí se dostat do hry jinak než jako text pro člověka. Proto se
//      ořezává na pevný tvar a všechno ostatní se zahazuje.
//   2) Podklad musí stát na číslech z databáze, ne na odhadech — jinak by
//      model „našel" cokoli.
// =============================================================================
'use strict';

const path = require('path');
const Module = require('module');
const puvodni = Module.prototype.require;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return { prisma: {} };
  if (/\.\.\/settings$/.test(co) || /services\/settings$/.test(co)) {
    return { getSetting: async () => null, setSetting: async () => ({}) };
  }
  return puvodni.apply(this, arguments);
};
const A = require(path.join(__dirname, '..', 'services/game/zlocin-analytik'));
Module.prototype.require = puvodni;

let chyb = 0;
function ma(podminka, popis, detail) {
  if (podminka) { console.log('  ok   ' + popis + (detail ? '  — ' + detail : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (detail ? '  — ' + detail : ''));
}

// ─── Co model vrátí, se musí ořezat na pevný tvar ───────────────────────────
{
  console.log('\nVýstup modelu je data, ne příkaz');
  const spatny = {
    nalezy: [
      { nazev: 'Nález', popis: 'něco', koho: ['A', 'B'], proc_podezrele: 'protože',
        jak_overit: 'takhle', odhad_skody: '5000000', jistota: 'vysoká', navrh_detektoru: 'takhle' },
      // Model si vymyslel pole navíc — nesmí projít dál.
      { nazev: 'Druhý', zahaj: true, zmrazit: 999999999, prikaz: 'DROP TABLE', jistota: 'naprostá' },
      { popis: 'bez názvu se zahazuje' },
    ],
    poznamka: 'nic dalšího',
    // A tohle taky ne.
    spustit: true, sql: 'delete from game_players',
  };
  const c = A.ocisti(spatny);
  ma(c.nalezy.length === 2, 'nález bez názvu se zahodí', c.nalezy.length);
  ma(c.spustit === undefined && c.sql === undefined, 'pole navíc v odpovědi se zahodí');
  ma(c.nalezy[1].zahaj === undefined && c.nalezy[1].zmrazit === undefined && c.nalezy[1].prikaz === undefined,
    'a u nálezu taky — žádný příkaz se ven nedostane', JSON.stringify(Object.keys(c.nalezy[1])));
  ma(c.nalezy[0].odhad_skody === 5000000, 'škoda se převede na číslo', c.nalezy[0].odhad_skody);
  ma(c.nalezy[1].jistota === 'nízká', 'neznámá jistota spadne na nízkou', c.nalezy[1].jistota);
  ma(c.nalezy[0].jistota === 'vysoká', 'známá zůstane');

  const dlouhy = A.ocisti({ nalezy: [{ nazev: 'x'.repeat(500), popis: 'y'.repeat(5000),
    koho: new Array(50).fill('nick'), odhad_skody: 'nesmysl' }] });
  ma(dlouhy.nalezy[0].nazev.length === 120, 'název se ořeže', dlouhy.nalezy[0].nazev.length);
  ma(dlouhy.nalezy[0].popis.length === 800, 'popis taky');
  ma(dlouhy.nalezy[0].koho.length === 10, 'seznam hráčů taky', dlouhy.nalezy[0].koho.length);
  ma(dlouhy.nalezy[0].odhad_skody === null, 'nečíselná škoda je null');

  const moc = A.ocisti({ nalezy: new Array(50).fill({ nazev: 'n' }) });
  ma(moc.nalezy.length === 12, 'nálezů se bere nejvýš dvanáct', moc.nalezy.length);
  ma(A.ocisti(null).nalezy.length === 0, 'prázdná odpověď nic neshodí');
  ma(A.ocisti({ nalezy: 'nesmysl' }).nalezy.length === 0, 'nesmysl místo pole taky ne');
}

// ─── Parsování odpovědi ─────────────────────────────────────────────────────
{
  console.log('\nParsování odpovědi');
  ma(A.rozparsuj('{"nalezy":[]}') !== null, 'čistý JSON projde');
  ma(A.rozparsuj('Tady je výsledek:\n```json\n{"nalezy":[{"nazev":"x"}]}\n```').nalezy.length === 1,
    'JSON obalený textem se vyloupne');
  ma(A.rozparsuj('nic') === null, 'text bez JSONu je null');
  ma(A.rozparsuj('{rozbité') === null, 'rozbitý JSON je null');
  ma(A.rozparsuj(null) === null, 'null je null');
}

// ─── Podklad stojí na datech ────────────────────────────────────────────────
{
  console.log('\nPodklad pro model');
  const hraci = [
    { id: 1, nick: 'Hlavni', company: 'H', hra_s_celkem: 90000, state: { cash: 50000000 } },
    { id: 2, nick: 'Pomocny', company: 'P', hra_s_celkem: 300, state: { cash: 10 }, invited_by_id: 1 },
    { id: 3, nick: 'Cizi', company: 'C', hra_s_celkem: 90000, state: { cash: 1000000 } },
  ];
  const prisma = {
    gamePlayer: { findMany: async () => hraci },
    gameTrade: { findMany: async () => ([
      { id: 11, from_id: 1, to_id: 2, smer: 'koupim', predmet: 'stroj', model: 'max', cena: 100 },
      { id: 12, from_id: 1, to_id: 3, smer: 'koupim', predmet: 'stroj', model: 'max', cena: 2000000 },
    ]) },
    gameDrazba: { findMany: async () => ([{ id: 21, prodavajici_id: 1, nazev: 'Lidl', suma: 900000, vitez_id: 3, prihozu: 4 }]) },
    gameDrazbaPrihoz: { findMany: async () => ([{ drazba_id: 21, player_id: 3, castka: 900000 }]) },
    gameLoan: { findMany: async () => ([{ id: 31, lender_id: 1, borrower_id: 2, castka: 9000000,
      splatka: 900000, splaceno: 0, mesicu: 10, stav: 'propadlo', zastava_spot: 'hk-1' }]) },
    gameEquity: { findMany: async () => ([{ id: 41, fond_id: 7, firma_id: 1, podil: 0.3, cena: 20000000, stav: 'bezi' }]) },
    gameAliance: { findMany: async () => ([{ id: 7, nazev: 'EX ALTO', pokladna: 16000000 }]) },
    gameAlianceClen: { findMany: async () => ([{ aliance_id: 7, player_id: 1 }, { aliance_id: 7, player_id: 2 }]) },
    gameSpotClaim: { groupBy: async () => ([{ player_id: 1, _count: { _all: 160 } }]) },
    gameMarket: { findMany: async () => ([{ id: 51, player_id: 2, koupil_id: 1, cena: 5000000, model: 'max', name: 'Billa' }]) },
  };
  return A.podklady(prisma).then((t) => {
    ma(/Hlavni/.test(t) && /Pomocny/.test(t), 'v podkladu jsou hráči');
    ma(/KAM TEČE NEJVÍC HODNOTY/.test(t), 'je tam tok hodnoty');
    ma(/ÚČTY, KTERÉ SKORO NEHRAJÍ/.test(t), 'i krátce hrající účty');
    const radekKratky = (t.slice(t.indexOf('SKORO NEHRAJÍ')).match(/Pomocny: [^\n]*/) || [])[0] || '';
    ma(/odehráno 5 min/.test(radekKratky), 'a je u nich, jak dlouho hráli', radekKratky);
    ma(/pozval ho Hlavni/.test(radekKratky), 'i kdo je přivedl');
    ma(/OBCHODY DALEKO OD CENÍKU/.test(t) && /#11/.test(t), 'obchod za stokorunu je vidět');
    ma(!/#12/.test(t.slice(t.indexOf('OBCHODY DALEKO'), t.indexOf('DRAŽBY'))), 'obchod za rozumnou cenu tam není');
    ma(/PŮJČKY, KTERÉ SE NESPLATILY/.test(t) && /#31/.test(t), 'propadlá půjčka je vidět');
    ma(/FONDY/.test(t) && /EX ALTO/.test(t), 'fondy taky');
    ma(/ve firmách vlastních členů/.test(t), 'a je vidět, že fond drží podíl ve firmě svého člena');
    ma(t.length < 24001, 'podklad se vejde do stropu', t.length + ' znaků');

    console.log('\nZadání pro model');
    ma(/POUZE platným JSON/.test(A.SYSTEM), 'chce se po něm JSON');
    ma(/Nic si nedomýšlej/.test(A.SYSTEM), 'a aby si nic nevymýšlel');
    ma(/Běžná hra není podvod/.test(A.SYSTEM), 'je upozorněný, že běžná hra není podvod');
    ma(/prázdné pole/.test(A.SYSTEM), 'a že nic nenajít je platný výsledek');
    ma(A.UZ_HLIDAME.split('\n').length >= 6, 'ví, co už hlídají detektory',
      A.UZ_HLIDAME.split('\n').length + ' vzorců');

    console.log('\nPojistky v kódu');
    const fs = require('fs');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'services/game/zlocin-analytik.js'), 'utf8');
    ma(!/zahaj\(/.test(SRC), 'analytik nikde nezahajuje řízení');
    ma(!/gameZlocin\./.test(SRC), 'a nesahá na případy');
    ma(/ANTHROPIC_API_KEY/.test(SRC) && /není na serveru nastavený/.test(SRC), 'bez klíče řekne proč');
    const ADM = fs.readFileSync(path.join(__dirname, '..', 'routes/game-admin.routes.js'), 'utf8');
    ma(/\/zlocin\/analytik\/podklad/.test(ADM), 'podklad se dá zkontrolovat');
    const RIZ = fs.readFileSync(path.join(__dirname, '..', 'services/game/zlocin-rizeni.js'), 'utf8');
    ma(!/analytik/.test(RIZ), 'řízení o analytikovi vůbec neví — nemá jak ho poslechnout');

    console.log(chyb ? '\n' + chyb + ' CHYB' : '\nVšechno sedí.');
    process.exit(chyb ? 1 : 0);
  });
}
