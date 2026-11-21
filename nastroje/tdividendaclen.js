// Průběžná dividenda členům fondu.
//
// Akcionáři ji mají, členové ji dosud neměli — a přitom jsou to oni, kdo do
// fondu složil peníze. Platí stejná pravidla jako u akcionářů a navíc jedna
// věc, která se u akcií řešit nemusí: dělení mezi členy podle vkladů.
//
//  1. Základ je díl členů na hodnotě fondu, tedy to, co NEPATŘÍ akcionářům.
//     Kdyby se počítal z celé hodnoty, platil by fond členům i z toho, co
//     už prodal akcionářům.
//  2. Mezi členy se dělí podle vkladů — stejným výpočtem, jakým se ve fondu
//     dělí všechno ostatní.
//  3. Jen z volných peněz; když fond nemá, nenabíhá nic a čas propadá.
//  4. Setiny koruny čas neposouvají.
const Module = require('module');
const puvodni = Module.prototype.require;
let VKLADY = [];
let FONDY = {};
let NABIDKY = [];
let UPDATE_MANY = [];
let DORUCENKY = [];
let SHODA = true;
let POKLADNA_STACI = true;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    const tx = {
      gameFondVklad: { updateMany: async (q) => { UPDATE_MANY.push(q); return { count: SHODA ? 1 : 0 }; } },
      gameAliance: { updateMany: async (q) => { UPDATE_MANY.push(q); return { count: POKLADNA_STACI ? 1 : 0 }; } },
      gameDelivery: { create: async (q) => { DORUCENKY.push(q.data); return q.data; } },
    };
    return { prisma: {
      gameFondVklad: {
        findMany: async (q) => (q.where.clen_id
          ? VKLADY.filter((v) => v.clen_id === q.where.clen_id && v.castka > 0)
          : VKLADY),
        updateMany: tx.gameFondVklad.updateMany,
      },
      gameAliance: { findUnique: async (q) => FONDY[q.where.id] || null },
      gameTender: { findMany: async () => NABIDKY },
      $transaction: async (fn) => fn(tx),
    } };
  }
  return puvodni.apply(this, arguments);
};
const DIVC = require('../services/game/fond-dividenda');
const A = require('../services/game/akcie');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const HODINA = 3600000;
const pred = (ms) => new Date(Date.now() - ms);
// Fond: díl členů 100 mil., sazba 12 % za herní rok. Dva členové, 75 : 25.
const fond = (x) => Object.assign({ id: 7, nazev: 'EX ALTO', clen_sazba: 0.12,
  clen_zaklad: 100000000, pokladna: 50000000 }, x || {});
const vklady = () => [
  { id: 1, aliance_id: 7, clen_id: 5, castka: 75000000, dividenda_do: pred(HODINA) },
  { id: 2, aliance_id: 7, clen_id: 9, castka: 25000000, dividenda_do: pred(HODINA) },
];
const znovu = (v, f, nab) => {
  VKLADY = v || []; FONDY = { 7: f }; NABIDKY = nab || [];
  UPDATE_MANY = []; DORUCENKY = []; SHODA = true; POKLADNA_STACI = true;
};

(async () => {
  // ─── Dělení podle vkladů ───────────────────────────────────────────────────
  znovu(vklady(), fond());
  const dostal = await DIVC.dorovnej(5);
  // Tři čtvrtiny vkladů → tři čtvrtiny základu.
  const cekano = A.dividendaZa(1, 100000000 * 0.75, 0.12, HODINA);
  ok('členovi se platí podle jeho vkladu', dostal === cekano, String(dostal));
  ok('a je to doručenka jemu',
    DORUCENKY.length === 1 && DORUCENKY[0].player_id === 5 && DORUCENKY[0].amount === dostal);
  // Menší člen dostane méně — ve stejném poměru jako vklady.
  znovu(vklady(), fond());
  const maly = await DIVC.dorovnej(9);
  ok('menší vklad nese poměrně míň', Math.abs(dostal / maly - 3) < 0.01,
    dostal + ' : ' + maly);
  // Podíly musí sedět na stejný výpočet, jakým se ve fondu dělí všechno.
  const p = DIVC.podilyZVkladu(vklady());
  ok('podíl se počítá z vkladů', Math.abs(p.get(5) - 0.75) < 1e-9);
  ok('a sečte se na celek', Math.abs(p.get(5) + p.get(9) - 1) < 1e-9);

  // ─── Z čeho se platí ───────────────────────────────────────────────────────
  // Základ je díl ČLENŮ. Kdyby se bral z celé hodnoty fondu, platil by fond
  // členům i z toho, co už patří akcionářům.
  znovu(vklady(), fond({ clen_zaklad: 0 }));
  ok('bez dílu členů se neplatí nic',
    (await DIVC.dorovnej(5)) === 0 && UPDATE_MANY.length === 0);
  znovu(vklady(), fond({ clen_sazba: 0 }));
  ok('bez sazby taky ne',
    (await DIVC.dorovnej(5)) === 0 && UPDATE_MANY.length === 0);
  znovu([], fond());
  ok('kdo ve fondu nic nemá, nedostane nic', (await DIVC.dorovnej(5)) === 0);
  znovu(vklady(), null);
  ok('neznámý fond nic nerozbije', (await DIVC.dorovnej(5)) === 0);
  znovu(vklady(), fond());
  ok('nesmyslné id nic nerozbije', (await DIVC.dorovnej('nic')) === 0);

  // ─── Fond nemá ─────────────────────────────────────────────────────────────
  znovu(vklady(), fond(), [{ fond_id: 7, stav: 'bezi', max_pct: 1, koupeno_pct: 0,
    cena_za_pct: 50000000, do: new Date(Date.now() + HODINA) }]);
  ok('se zamčenou pokladnou se nevyplatí nic', (await DIVC.dorovnej(5)) === 0);
  ok('a žádná doručenka nevznikne', DORUCENKY.length === 0);
  ok('ale čas se posune, aby z toho nebyl dluh',
    UPDATE_MANY.length === 1 && !!UPDATE_MANY[0].data.dividenda_do);
  znovu(vklady(), fond({ pokladna: 7 }));
  ok('vyplatí se nanejvýš to, co fond má', (await DIVC.dorovnej(5)) === 7);

  // ─── Setiny koruny ─────────────────────────────────────────────────────────
  znovu([{ id: 1, aliance_id: 7, clen_id: 5, castka: 100, dividenda_do: pred(1000) }],
    fond({ clen_zaklad: 100 }));
  ok('ze setin se nevyplatí nic', (await DIVC.dorovnej(5)) === 0);
  ok('a čas se NEposune — nabíhá dál', UPDATE_MANY.length === 0);

  // ─── Souběh ────────────────────────────────────────────────────────────────
  // Mezi výpočtem a zápisem člen vybral vklad: podmínka se netrefí.
  znovu(vklady(), fond()); SHODA = false;
  ok('při souběhu se nevyplatí nic', (await DIVC.dorovnej(5)) === 0);
  ok('a nevznikne doručenka', DORUCENKY.length === 0);
  znovu(vklady(), fond()); POKLADNA_STACI = false;
  ok('když pokladna mezitím klesne, nevyplatí se nic', (await DIVC.dorovnej(5)) === 0);

  // ─── Počítadlo ─────────────────────────────────────────────────────────────
  const st = DIVC.stav(fond(), 0.75, pred(HODINA));
  ok('počítadlo zná sazbu', st.sazba === 0.12);
  ok('a můj základ je díl členů krát můj podíl', st.zaklad === 75000000);
  ok('celkem za rok je sazba z celého dílu členů', st.celkem_rocne === 12000000);
  ok('za sekundu sedí s tím, co se vyplatí',
    Math.abs(st.za_sekundu * (A.ROK_MS / 1000) - A.dividendaZa(1, 75000000, 0.12, A.ROK_MS)) < 1);
  ok('bez sazby je počítadlo nula', DIVC.stav(fond({ clen_sazba: 0 }), 0.75, new Date()).za_sekundu === 0);
  ok('bez podílu taky', DIVC.stav(fond(), 0, new Date()).za_sekundu === 0);

  // ─── Zapojení ──────────────────────────────────────────────────────────────
  const fs = require('fs');
  const path = require('path');
  const routy = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
  const fond_js = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'game', 'fond.js'), 'utf8');
  const cena_js = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'game', 'akcie-cena.js'), 'utf8');
  ok('panel fondu doúčtuje i členskou dividendu',
    /router\.get\('\/trade\/aliance\/fond',[\s\S]{0,400}DIVC\.dorovnej/.test(routy));
  ok('sazba členům má vlastní druh návrhu',
    /clen_sazba: \{ prah: FOND\.prahDruhu\('clen_sazba'\)/.test(routy));
  // Rozdávat peníze členům má být těžší než platit akcionářům: akcionářům
  // platí většina ze svého, sobě si průběžný odliv odhlasovat jen tak nemá.
  ok('a je to ZÁSADNÍ rozhodnutí', /clen_sazba: ZASADNI/.test(fond_js));
  ok('zapnutí posune začátek na teď',
    /clen_sazba: sazba[\s\S]{0,300}dividenda_do: new Date\(\)/.test(routy));
  // Díl členů se dopočítává při přecenění — a to i u fondu, který žádné
  // akcie nevydal. Jinak by se členská dividenda neměla z čeho počítat.
  ok('díl členů se ukládá při přecenění', /clen_zaklad: dilClenu/.test(cena_js));
// A je to opravdu díl ČLENŮ: z celé hodnoty fondu by fond platil členům
// i z toho, co už prodal akcionářům, a ti by to dostali dvakrát.
ok('a je to hodnota bez dílu akcionářů',
  /dilClenu = [^;]*\(1 - Math\.max\(0, Math\.min\(1, al\.akcie_podil/.test(cena_js));
  ok('a počítá se i u fondu bez akcií',
    cena_js.indexOf('clen_zaklad: dilClenu') < cena_js.indexOf('if (!(al.akcie_celkem > 0)'));

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
  process.exit(chyb ? 1 : 0);
})();
