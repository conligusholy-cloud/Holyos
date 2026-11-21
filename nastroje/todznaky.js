// =============================================================================
// HolyOS — Laundromat Tycoon: test odznaků
// =============================================================================
// Odznak říká, JAK hráč hraje. Odměnou je karta, ne hotovost, takže na nich
// nejde zbohatnout — zato se na ně hráči dívají a chybějící text nebo
// podmínka, která nejde splnit, je hned vidět.
//
// Podmínky se tu pouštějí opravdové: splneneOdznaky z routy, s falešnou
// databází, aby se dalo zkusit i to, co v datech zrovna není.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, co) {
  if (podminka) { console.log('  ok   ' + popis + (co != null ? '  — ' + co : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (co != null ? '  — ' + co : ''));
}
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  let h = 0;
  for (let j = zdroj.indexOf('{', i); j < zdroj.length; j++) {
    if (zdroj[j] === '{') h++;
    else if (zdroj[j] === '}') { h--; if (!h) return zdroj.slice(i, j + 1); }
  }
  throw new Error('konec se nenašel');
}

const H = require(path.join(KOREN, 'services/game/hodnosti.js'));
const KARTY = ['rush', 'connect', 'credit', 'traffic'];

console.log('\nKatalog odznaků');
ma(H.ODZNAKY.length === 12, 'odznaků je dvanáct', String(H.ODZNAKY.length));
const kody = H.ODZNAKY.map((o) => o.kod);
ma(new Set(kody).size === kody.length, 'žádný kód se neopakuje');
const ikony = H.ODZNAKY.map((o) => o.ikona);
ma(new Set(ikony).size === ikony.length, 'žádná ikona se neopakuje');
ma(H.ODZNAKY.every((o) => o.odmena && KARTY.indexOf(o.odmena.karta) >= 0),
  'odměnou je vždycky karta, nikdy hotovost');
ma(H.ODZNAKY.every((o) => Array.isArray(o.barva) && o.barva.length === 2),
  'každý odznak má svoje dvě barvy');
['akcionar', 'spolecnik', 'domaci', 'kladivo'].forEach((k) => {
  ma(kody.indexOf(k) >= 0, 'nový odznak ' + k + ' je v katalogu');
});

console.log('\nTexty ve všech jazycích');
['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'].forEach((j) => {
  const d = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/' + j + '.json'), 'utf8'));
  const chybi = [];
  H.ODZNAKY.forEach((o) => {
    ['nazev', 'popis', 'jak'].forEach((c) => {
      const k = 'odznak.' + o.kod + '.' + c;
      if (!d[k] || !String(d[k]).trim()) chybi.push(k);
    });
  });
  ma(chybi.length === 0, j + ': všechny tři texty u každého odznaku', chybi.join(', ') || '36 textů');
  // Název je pod ikonou, takže se musí vejít na jeden řádek.
  const dlouhe = H.ODZNAKY.map((o) => d['odznak.' + o.kod + '.nazev'] || '')
    .filter((n) => n.length > 16);
  ma(dlouhe.length === 0, j + ': názvy se vejdou pod ikonu', dlouhe.join(', ') || 'max 16 znaků');
});

// ─── Opravdové podmínky ─────────────────────────────────────────────────────
console.log('\nPodmínky nových odznaků');
const zdroj = fs.readFileSync(path.join(KOREN, 'routes/game-account.routes.js'), 'utf8');
function spust(data) {
  const d = Object.assign({ akcie: [], vklady: [], pozemky: [], drazby: [] }, data);
  const ctx = {
    prisma: {
      gameLoan: { count: async () => 0 },
      gameEquity: { findMany: async () => [] },
      gamePlayer: { findMany: async () => [] },
      // Falešná databáze čte podmínky z dotazu — jinak by test neověřil laťku,
      // jen to, že se na něco zeptáme.
      gameAkcie: { count: async (a) => d.akcie.filter((x) => x >= a.where.pocet.gte).length },
      gameFondVklad: { aggregate: async () => ({ _sum: { castka: d.vklady.reduce((s, x) => s + x, 0) } }) },
      gameSpotClaim: { count: async (a) => d.pozemky.filter((x) => x.pozemek === a.where.pozemek
        && (a.where.najemce_id.not === null ? x.najemce : true)).length },
      gameDrazba: { count: async (a) => d.drazby.filter((x) => x === a.where.stav).length },
    },
    zemeHracu: async () => ({}),
    Promise, Date, Set, Array, Math, Object, console,
  };
  vm.createContext(ctx);
  vm.runInContext(zdroj.slice(zdroj.indexOf('const HVEZDY_TYDEN'), zdroj.indexOf('async function resOdznaky')), ctx);
  return ctx.splneneOdznaky({ id: 7 }, {});
}

(async () => {
  let m = await spust({ akcie: [9] });
  ma(m.indexOf('akcionar') < 0, 'devět akcií na akcionáře nestačí');
  m = await spust({ akcie: [10] });
  ma(m.indexOf('akcionar') >= 0, 'deset akcií už ano');

  m = await spust({ vklady: [400000, 500000] });
  ma(m.indexOf('spolecnik') < 0, 'devět set tisíc ve fondu na společníka nestačí');
  m = await spust({ vklady: [400000, 600000] });
  ma(m.indexOf('spolecnik') >= 0, 'milion ve fondu ano — i po částech');

  m = await spust({ pozemky: [{ pozemek: true, najemce: false }] });
  ma(m.indexOf('domaci') < 0, 'vlastní pozemek bez nájemce na domácího nestačí');
  m = await spust({ pozemky: [{ pozemek: true, najemce: true }] });
  ma(m.indexOf('domaci') >= 0, 'jakmile na něm někdo sedí a platí, odznak je');

  m = await spust({ drazby: ['hotovo', 'hotovo'] });
  ma(m.indexOf('kladivo') < 0, 'dvě vyhrané dražby na kladivo nestačí');
  m = await spust({ drazby: ['hotovo', 'hotovo', 'hotovo'] });
  ma(m.indexOf('kladivo') >= 0, 'tři ano');
  m = await spust({ drazby: ['bezi', 'bezi', 'bezi'] });
  ma(m.indexOf('kladivo') < 0, 'běžící dražba se nepočítá — vyhrát se musí');

  m = await spust({});
  ma(m.length === 0, 'kdo nic z toho nemá, nedostane nic', JSON.stringify(m));

  console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
  process.exit(chyb ? 1 : 0);
})();
