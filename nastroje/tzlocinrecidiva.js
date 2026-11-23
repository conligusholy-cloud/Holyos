// =============================================================================
// HolyOS — Laundromat Tycoon: potrestaný hráč nemá imunitu
// =============================================================================
// Nové případy se zakládaly jen tomu, kdo ještě žádný případ NEMĚL — seznam
// se bral bez ohledu na stav, takže kdo byl jednou odsouzený, měl do konce
// hry klid. To, že někoho potrestáme, přitom neznamená, že nemůže podvádět
// dál.
//
// Druhá polovina téhož: škoda se počítá z celé historie provizí a levných
// nákupů. Kdyby se opakovaný případ otevřel na celou škodu, soudil by se
// znovu i ten kus, za který už hráč zaplatil. Odečítá se proto škoda
// z uzavřených případů a vede se jen to nové.
// =============================================================================
'use strict';

const Module = require('module');
const puvodni = Module.prototype.require;

let ZLOCINY = [];          // co je v databázi
let ZALOZENE = [];         // co tik() založil
let PRAVIDLA = null;

function db() {
  return { prisma: {
    gameZlocin: {
      findMany: async (q) => {
        const w = (q && q.where) || {};
        return ZLOCINY.filter((z) => {
          if (w.stav && w.stav.in) return w.stav.in.indexOf(z.stav) >= 0;
          if (w.stav && typeof w.stav === 'string') return z.stav === w.stav;
          return true;
        });
      },
      create: async (x) => { ZALOZENE.push(x.data); return Object.assign({ id: 900 + ZALOZENE.length }, x.data); },
      update: async (x) => x.data,
      findFirst: async () => null,
    },
    gamePlayer: { findUnique: async () => ({ state: { cash: 100000000 }, company: 'F', nick: 'N' }) },
    gameDelivery: { create: async () => ({}) },
    gameZlocinZprava: { create: async () => ({}) },
    gameZlocinHlas: { findMany: async () => [], deleteMany: async () => ({}) },
  } };
}
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return db();
  return puvodni.apply(this, arguments);
};
const R = require('../services/game/zlocin-rizeni');
const ZL = require('../services/game/zlocin');
Module.prototype.require = puvodni;

let chyb = 0;
function ma(podminka, popis, detail) {
  if (podminka) { console.log('  ok   ' + popis + (detail ? '  — ' + detail : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (detail ? '  — ' + detail : ''));
}

// Zdroj pravdy pro ten kus tik(), který zakládá nové případy. Vytažený ze
// souboru, aby se netestoval opis — tik() sám sahá do databáze na dalších
// deset míst a sken si dělá sám.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'services/game/zlocin-rizeni.js'), 'utf8');
const zac = SRC.indexOf('    if (R.zapnuto && sken) {');
const kon = SRC.indexOf('\n    }', SRC.indexOf('await zahaj(prisma, R, row); n++;')) + 6;
if (zac < 0 || kon < 6) { console.log('CHYBA: blok zakládání nových případů se v tik() nenašel'); process.exit(1); }
const BLOK = SRC.slice(zac, kon);

async function spust(pravidla, sken, zlociny) {
  ZLOCINY = zlociny; ZALOZENE = [];
  const zahajeno = [];
  const prisma = db().prisma;
  const ctx = vm.createContext({ prisma, Math, Set, Map, Object, Promise, console,
    AKTIVNI: R.AKTIVNI,
    R: pravidla, sken,
    zahaj: async (p, r, row) => { zahajeno.push(row); return {}; } });
  await vm.runInContext('(async function () {' + BLOK + '})()', ctx);
  return zahajeno;
}

(async () => {
  PRAVIDLA = Object.assign({}, await ZL.nastaveni(), { zapnuto: true, max_novych_za_tik: 10 });

  console.log('\nKdo už případ má, druhý nedostane');
  {
    const sken = { kontrola: [{ id: 1, nick: 'A', skoda: 5000000 }, { id: 2, nick: 'B', skoda: 7000000 }] };
    const zahajeno = await spust(PRAVIDLA, sken,
      [{ hlavni_id: 1, stav: 'kontrola', skoda: 5000000 }]);
    ma(zahajeno.length === 1, 'otevře se jen ten druhý', zahajeno.length);
    ma(zahajeno[0].id === 2, 'a je to ten bez běžícího případu');
  }

  console.log('\nKdo byl odsouzený, imunitu nemá');
  {
    // Hráč dostal rozsudek na 5 mil. a od té doby napáchal dalších 7 mil.
    const sken = { kontrola: [{ id: 1, nick: 'A', skoda: 12000000 }] };
    const zahajeno = await spust(PRAVIDLA, sken,
      [{ hlavni_id: 1, stav: 'uzavreno', skoda: 5000000 }]);
    ma(zahajeno.length === 1, 'nový případ se otevře');
    ma(zahajeno[0].skoda === 7000000, 'a soudí se jen nová škoda', zahajeno[0].skoda);
    ma(zahajeno[0].drive_odsouzeno === 5000000, 'u případu je vidět, co už bylo odsouzeno');
    ma(zahajeno[0].zmrazit === Math.round(7000000 * PRAVIDLA.koef_zabaveni),
      'zmrazuje se podle nové škody', zahajeno[0].zmrazit);
    ma(zahajeno[0].trest.nejnizsi === Math.round(7000000 * PRAVIDLA.trest_nejnizsi),
      'i tresty', zahajeno[0].trest.nejnizsi);
  }

  console.log('\nZa totéž se podruhé nesoudí');
  {
    // Nic nového nepřibylo — škoda je pořád ta, za kterou už zaplatil.
    const sken = { kontrola: [{ id: 1, nick: 'A', skoda: 5000000 }] };
    const zahajeno = await spust(PRAVIDLA, sken,
      [{ hlavni_id: 1, stav: 'uzavreno', skoda: 5000000 }]);
    ma(!zahajeno.length, 'druhý případ za tutéž škodu nevzniká');
  }
  {
    // Drobná nová škoda pod hranicí taky ne.
    const sken = { kontrola: [{ id: 1, nick: 'A', skoda: 5300000 }] };
    const zahajeno = await spust(Object.assign({}, PRAVIDLA, { recidiva_min_skoda: 1000000 }), sken,
      [{ hlavni_id: 1, stav: 'uzavreno', skoda: 5000000 }]);
    ma(!zahajeno.length, 'ani 300 tisíc navíc při hranici milionu');
  }
  {
    const sken = { kontrola: [{ id: 1, nick: 'A', skoda: 6300000 }] };
    const zahajeno = await spust(Object.assign({}, PRAVIDLA, { recidiva_min_skoda: 1000000 }), sken,
      [{ hlavni_id: 1, stav: 'uzavreno', skoda: 5000000 }]);
    ma(zahajeno.length === 1 && zahajeno[0].skoda === 1300000, 'milion a tři sta už ano',
      zahajeno.length && zahajeno[0].skoda);
  }

  console.log('\nVíc uzavřených případů se sčítá');
  {
    const sken = { kontrola: [{ id: 1, nick: 'A', skoda: 20000000 }] };
    const zahajeno = await spust(PRAVIDLA, sken, [
      { hlavni_id: 1, stav: 'uzavreno', skoda: 5000000 },
      { hlavni_id: 1, stav: 'uzavreno', skoda: 6000000 },
      { hlavni_id: 1, stav: 'zruseno', skoda: 4000000 },   // zrušený se neodečítá
    ]);
    ma(zahajeno.length === 1 && zahajeno[0].skoda === 9000000,
      'odečte se jen to, co bylo opravdu odsouzeno', zahajeno.length && zahajeno[0].skoda);
  }

  console.log('\nPojistky');
  {
    const sken = { kontrola: [1, 2, 3, 4, 5].map((i) => ({ id: i, nick: 'H' + i, skoda: 9000000 })) };
    const zahajeno = await spust(Object.assign({}, PRAVIDLA, { max_novych_za_tik: 2 }), sken, []);
    ma(zahajeno.length === 2, 'najednou se neotevře víc, než dovolí pojistka', zahajeno.length);
    const vyp = await spust(Object.assign({}, PRAVIDLA, { zapnuto: false }), sken, []);
    ma(!vyp.length, 's vypnutými pravidly se neotevře nic');
    const prazdno = await spust(PRAVIDLA, { kontrola: [] }, []);
    ma(!prazdno.length, 'prázdný sken nic neotevře');
  }

  console.log('\nV kódu');
  ma(/where: \{ stav: \{ in: AKTIVNI \} \}, select: \{ hlavni_id: true \}/.test(SRC),
    'bere se jen běžící případ, ne všechny');
  ma(!/findMany\(\{ select: \{ hlavni_id: true \} \}\)/.test(SRC), 'starý seznam všech případů v kódu nezbyl');
  ma(typeof PRAVIDLA.recidiva_min_skoda === 'number', 'hranice nové škody je v pravidlech',
    PRAVIDLA.recidiva_min_skoda);
  const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'modules/milionar/index.html'), 'utf8');
  ma(/recidiva_min_skoda/.test(ADMIN), 'a dá se nastavit v administraci');

  console.log(chyb ? '\n' + chyb + ' CHYB' : '\nVšechno sedí.');
  process.exit(chyb ? 1 : 0);
})();
