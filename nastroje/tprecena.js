// Přecenění akcie podle hodnoty fondu.
//
// Cenou akcie dosud hýbalo jedině obchodování. Fond mohl koupit podíl hluboko
// pod cenou a akcionářům tím zhodnotit, co drží — a v grafu byla rovná čára.
// Tohle je ta oprava, a protože sahá na cenu, za kterou hráči kupují, musí
// sedět čtyři věci:
//
//  1. Poměr — cena se posune stejným poměrem jako účetní hodnota. Prémie,
//     kterou na akcii trh má, zůstane; jinak by přecenění trh přepisovalo.
//  2. První běh — bez čísla, proti kterému se měří, se cena NESMÍ hnout.
//     Dosadit nulu znamená dělit nulou nebo cenu vystřelit do nesmyslu.
//  3. Soupeření s obchodem — mezi čtením a zápisem může projít obchod.
//     Zápis je proto podmíněný a při nesouhlasu se nesmí zapsat ani bod grafu.
//  4. Ticho — když se cena nepohnula, nepíše se nic. Hodinové přeceňování by
//     jinak vyrobilo graf z bodů na stejné výšce.
const Module = require('module');
const puvodni = Module.prototype.require;
let FOND = null;          // co vrátí databáze
let UPDATE = null;        // poslední update na fondu
let UPDATE_MANY = [];     // podmíněné zápisy
let BODY = [];            // zapsané body grafu
let SHODA = true;         // trefí se podmíněný zápis?
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameAliance: {
        findUnique: async () => FOND,
        update: async (q) => { UPDATE = q.data; return {}; },
        updateMany: async (q) => { UPDATE_MANY.push(q); return { count: SHODA ? 1 : 0 }; },
      },
      gameAkcieCena: { create: async (q) => { BODY.push(q.data); return q.data; } },
    } };
  }
  return puvodni.apply(this, arguments);
};
const CENA = require('../services/game/akcie-cena');
const A = require('../services/game/akcie');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const znovu = (f) => { FOND = f; UPDATE = null; UPDATE_MANY = []; BODY = []; SHODA = true; };
// Fond za 100 mil., akcionáři drží třetinu, vydáno 1000 kusů → účetní 33 333.
// Reference se ukládá nezaokrouhlená, a tak se tu taky počítá: zaokrouhlená
// by posunula každé přecenění o pár korun a test by měřil chybu, kterou
// server nedělá.
const UCETNI0 = 100000000 / 3 / 1000;
const fond = (x) => Object.assign({ akcie_celkem: 1000, akcie_vydano: 1000,
  akcie_podil: 1 / 3, akcie_cena: 100000, akcie_ucetni: UCETNI0 }, x || {});

(async () => {
  // ─── Poměr ─────────────────────────────────────────────────────────────────
  // Fond vyroste o desetinu → účetní hodnota akcie taky → cena taky.
  znovu(fond());
  let n = await CENA.precenFondu(7, 110000000);
  ok('růst fondu zvedne cenu akcie', n === 1);
  ok('a to stejným poměrem', UPDATE_MANY[0].data.akcie_cena === 110000,
    String(UPDATE_MANY[0].data.akcie_cena));
  ok('prémie proti účetní hodnotě zůstane',
    Math.abs(UPDATE_MANY[0].data.akcie_cena / UPDATE_MANY[0].data.akcie_ucetni
      - 100000 / UCETNI0) < 0.01);
  ok('zapíše se nová referenční účetní hodnota',
    Math.round(UPDATE_MANY[0].data.akcie_ucetni) === Math.round(110000000 / 3 / 1000));
  ok('a bod do grafu s důvodem přecenění',
    BODY.length === 1 && BODY[0].duvod === 'precena' && BODY[0].cena === 110000);

  // Propad se chová souměrně. Akcie fondu, který prodělal, musí zlevnit —
  // jinak by hráč kupoval za cenu, která se nikdy nepohnula dolů.
  znovu(fond());
  await CENA.precenFondu(7, 50000000);
  ok('propad fondu cenu srazí', UPDATE_MANY[0].data.akcie_cena === 50000);

  // Co se nehnulo, se nepřepisuje.
  znovu(fond());
  n = await CENA.precenFondu(7, 100000000);
  ok('beze změny hodnoty se cena nehne', n === 0);
  ok('a nepíše se bod do grafu', BODY.length === 0);

  // ─── První běh ─────────────────────────────────────────────────────────────
  // Není proti čemu měřit. Cena se nesmí hnout, jen se zapamatuje, kde stojí.
  znovu(fond({ akcie_ucetni: 0 }));
  n = await CENA.precenFondu(7, 100000000);
  ok('bez reference se cena nehne', n === 0 && UPDATE_MANY.length === 0);
  ok('ale reference se zapamatuje', UPDATE && Math.round(UPDATE.akcie_ucetni) === Math.round(UCETNI0));
  ok('a graf zůstane čistý', BODY.length === 0);

  // ─── Co se nepřeceňuje ─────────────────────────────────────────────────────
  // Fond bez vydaných akcií má jen vyvolávací cenu z hlasování a ta se hýbat
  // nemá, dokud kusy někdo nekoupí.
  znovu(fond({ akcie_vydano: 0 }));
  ok('fond bez vydaných akcií se nepřeceňuje',
    (await CENA.precenFondu(7, 200000000)) === 0 && UPDATE_MANY.length === 0);
  znovu(fond({ akcie_celkem: 0, akcie_vydano: 0 }));
  ok('fond bez akcií vůbec taky ne',
    (await CENA.precenFondu(7, 200000000)) === 0 && UPDATE_MANY.length === 0);
  // Rozbitá data: vydané kusy bez vydaných akcií. Cena takového fondu není
  // cenou ničeho a přeceňovat ji znamená psát číslo, které nic neznamená.
  znovu(fond({ akcie_celkem: 0, akcie_vydano: 1000 }));
  ok('vydané kusy bez vydaných akcií se nepřeceňují',
    (await CENA.precenFondu(7, 200000000)) === 0 && UPDATE_MANY.length === 0);
  // Fond, který nestojí nic, by dělil nulou.
  znovu(fond());
  ok('nulová hodnota fondu nic nerozbije',
    (await CENA.precenFondu(7, 0)) === 0 && UPDATE_MANY.length === 0);
  znovu(null);
  ok('neznámý fond nic nerozbije', (await CENA.precenFondu(7, 1e8)) === 0);
  znovu(fond());
  ok('nesmyslné id nic nerozbije', (await CENA.precenFondu('nic', 1e8)) === 0);

  // ─── Soupeření s obchodem ──────────────────────────────────────────────────
  // Mezi čtením a zápisem projde obchod: ten cenou pohnul po svém a přecenění
  // ho nesmí přetlačit zpátky. Podmínka se netrefí, a pak se nesmí zapsat ani
  // bod do grafu — jinak by v něm stála cena, která nikdy neplatila.
  znovu(fond()); SHODA = false;
  n = await CENA.precenFondu(7, 110000000);
  ok('když mezitím projde obchod, přecenění neplatí', n === 0);
  ok('a do grafu se nic nezapíše', BODY.length === 0);
  ok('podmínka drží cenu i referenci',
    UPDATE_MANY[0].where.akcie_cena === 100000 && UPDATE_MANY[0].where.akcie_ucetni === UCETNI0);

  // ─── Řada cen ──────────────────────────────────────────────────────────────
  // Graf se kreslí odsud a musí jít od nejstaršího po nejnovější — obráceně
  // by každý růst vypadal jako propad.
  const zdroj = [{ kdy: 3, cena: 300 }, { kdy: 2, cena: 200 }, { kdy: 1, cena: 100 }];
  const prismaCeny = { gameAkcieCena: { findMany: async () => zdroj } };
  Module.prototype.require = function (co) {
    if (/config\/database$/.test(co)) return { prisma: prismaCeny };
    return puvodni.apply(this, arguments);
  };
  delete require.cache[require.resolve('../services/game/akcie-cena')];
  const CENA2 = require('../services/game/akcie-cena');
  Module.prototype.require = puvodni;
  const rada = await CENA2.radaCen(7, 30);
  ok('graf jde od nejstaršího po nejnovější',
    rada[0].cena === 100 && rada[2].cena === 300);
  ok('a nic se po cestě neztratí', rada.length === 3);

  // ─── Zapojení ──────────────────────────────────────────────────────────────
  const fs = require('fs');
  const path = require('path');
  const hist = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'game', 'fond-historie.js'), 'utf8');
  // Hodinové kolo i vzorek po události. Kdyby přecenění viselo jen na jednom
  // z nich, cena by se po nákupu fondu hnula až za hodinu — nebo vůbec.
  ok('hodinové kolo přeceňuje',
    /for \(const f of fondy\) \{[\s\S]{0,200}precenFondu\(f\.id, f\.hodnota\)/.test(hist));
  ok('a vzorek po události taky',
    /precenFondu\(id, f\.hodnota\)/.test(hist));
  // Vzorek se nezapíše, když se čísla nehnula. Přecenění musí běžet dřív,
  // jinak by ho ta zkratka přeskočila.
  const vzorek = hist.slice(hist.indexOf('async function vzorkujFond'));
  ok('přecenění běží dřív než zkratka na nezměněná čísla',
    vzorek.indexOf('precenFondu') < vzorek.indexOf('stojiZaZapis'));

  const routy = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
  // Obchod cenou pohnul po svém. Kdyby si nechal starou referenci, hodinové
  // přecenění by ten pohyb vzalo ještě jednou.
  ok('obchod si přepisuje referenční účetní hodnotu',
    /akcie_ucetni: ucetniPo/.test(routy));
  ok('a počítá ji z hodnoty PO obchodu',
    /hodPred \+ r\.castka : hodPred - r\.castka/.test(routy));
  ok('obchod zapisuje bod do řady cen',
    /CENA\.zapisCenu\(tx, alianceId, r\.cena_po, 'obchod'/.test(routy));
  ok('graf se čte z řady cen, ne z obchodů', /CENA\.radaCen\(/.test(routy));
  // Tohle shodilo seznam akcií na živo: require se omylem přilepil dovnitř
  // jedné funkce, takže CENA bylo v jejím rozsahu a routa o něm nevěděla.
  // Hlídá se, že stojí na úrovni modulu — tedy bez odsazení.
  ok('CENA se načítá na úrovni modulu, ne uvnitř funkce',
    /^const CENA = require\('\.\.\/services\/game\/akcie-cena'\);$/m.test(routy));

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
  process.exit(chyb ? 1 : 0);
})();
