// Rezervace peněz pod běžícími nabídkami.
//
// Bez ní šlo vyhlásit tři nabídky na tři firmy z jedněch peněz: kontrola se
// dělala jen v okamžiku vyhlášení a pak se na ty peníze zapomnělo. Dvěma
// podílníkům by se pak muselo říct, že se to nějak nepovedlo.
const Module = require('module');
const puvodni = Module.prototype.require;
let NABIDKY = [];
let PODILY = [];
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameTender: { findMany: async (q) => NABIDKY.filter((t) =>
        t.utocnik_id === q.where.utocnik_id && t.stav === q.where.stav && t.trvala === q.where.trvala) },
      gameEquity: { findMany: async (q) => PODILY.filter((e) =>
        e.firma_id === q.where.firma_id && e.stav === q.where.stav) },
    } };
  }
  return puvodni.apply(this, arguments);
};
const REZ = require('../services/game/rezervace');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const HRAC = { id: 1, nick: 'Útočník' };
const ZITRA = new Date(Date.now() + 86400000);
const VCERA = new Date(Date.now() - 86400000);
// max_pct 0,3 = třicet procent, cena 10 000 za procento → slíbeno 300 000.
const nabidka = (x) => Object.assign({ utocnik_id: 1, stav: 'bezi', trvala: false,
  max_pct: 0.3, koupeno_pct: 0, cena_za_pct: 10000, do: ZITRA }, x || {});

(async () => {
  NABIDKY = []; PODILY = [];
  let v = await REZ.volne(HRAC, { cash: 1000000 });
  ok('bez nabídek je volné všechno', v.volne === 1000000 && v.zamceno === 0);

  NABIDKY = [nabidka()];
  v = await REZ.volne(HRAC, { cash: 1000000 });
  ok('běžící nabídka drží, co zbývá doplatit',
    v.zamceno === 300000 && v.volne === 700000, '— ' + v.zamceno);

  NABIDKY = [nabidka({ koupeno_pct: 0.2 })];
  v = await REZ.volne(HRAC, { cash: 1000000 });
  ok('co už se koupilo, se nedrží podruhé',
    v.zamceno === 100000, '— ' + v.zamceno);

  NABIDKY = [nabidka({ koupeno_pct: 0.3 })];
  ok('naplněná nabídka nedrží nic', (await REZ.volne(HRAC, { cash: 10 })).zamceno === 0);

  NABIDKY = [nabidka({ do: VCERA })];
  ok('doběhlá nabídka nedrží nic', (await REZ.volne(HRAC, { cash: 10 })).zamceno === 0);

  // Trvalá výstupní nabídka nemá konec a neví se, kolik jí kdo prodá —
  // kdyby se rezervovala, zamkla by hotovost navždycky.
  NABIDKY = [nabidka({ trvala: true, do: null })];
  ok('trvalá výstupní nabídka se nerezervuje',
    (await REZ.volne(HRAC, { cash: 1000000 })).zamceno === 0);
  // Dotaz ji vynechává sám, ale pojistka patří i do výpočtu — kdyby se
  // dotaz jednou rozšířil, nesmí se trvalá nabídka začít rezervovat potichu.
  ok('a nerezervuje se ani ve výpočtu',
    REZ.zbyvaZNabidky(nabidka({ trvala: true, do: null })) === 0,
    '— ' + REZ.zbyvaZNabidky(nabidka({ trvala: true, do: null })));

  NABIDKY = [nabidka(), nabidka()];
  v = await REZ.volne(HRAC, { cash: 1000000 });
  ok('dvě nabídky se sčítají', v.zamceno === 600000, '— ' + v.zamceno);

  // To hlavní: druhý slib z týchž peněz neprojde.
  NABIDKY = [nabidka()];
  let r = await REZ.vejdeSe(HRAC, { cash: 1000000 }, 300000);
  ok('druhá nabídka, na kterou ještě zbývá, projde', r.ok === true);
  r = await REZ.vejdeSe(HRAC, { cash: 1000000 }, 800000);
  ok('nabídka přes volné peníze neprojde', r.ok === false,
    '— potřeba ' + r.potreba + ', volné ' + r.volne);
  NABIDKY = [nabidka({ max_pct: 1 })];
  r = await REZ.vejdeSe(HRAC, { cash: 1000000 }, 1);
  ok('kdo slíbil celou hotovost, nevyhlásí ani korunu navíc', r.ok === false,
    '— volné ' + r.volne);

  // Hotovost pod zamčeným: volné nesmí být záporné, jinak by se z mínusu
  // stala povolenka.
  NABIDKY = [nabidka({ max_pct: 1 })];
  v = await REZ.volne(HRAC, { cash: 100000 });
  ok('volné nejde pod nulu', v.volne === 0, '— ' + v.volne);

  // ── Nedoplatek dividendy drží stejně jako nabídka ──────────────────────────
  // Dokud firma dluží podílníkům, nemá si její majitel brát další závazky.
  NABIDKY = [];
  PODILY = [{ firma_id: 1, stav: 'bezi', nedoplatek: 250000 },
    { firma_id: 1, stav: 'bezi', nedoplatek: 50000 },
    { firma_id: 2, stav: 'bezi', nedoplatek: 900000 }];
  v = await REZ.volne(HRAC, { cash: 1000000 });
  ok('nedoplatky dividendy se sčítají a drží',
    v.zamceno === 300000 && v.volne === 700000, '— ' + v.zamceno);
  ok('cizí firma mi nic nedrží', v.zamceno === 300000);

  NABIDKY = [nabidka()];
  v = await REZ.volne(HRAC, { cash: 1000000 });
  ok('nabídka a nedoplatek se sčítají dohromady',
    v.zamceno === 600000, '— ' + v.zamceno);
  r = await REZ.vejdeSe(HRAC, { cash: 1000000 }, 500000);
  ok('a nová nabídka se měří proti zbytku', r.ok === false, '— volné ' + r.volne);

  PODILY = [{ firma_id: 1, stav: 'bezi', nedoplatek: 0 }];
  NABIDKY = [];
  ok('splacený nedoplatek nedrží nic',
    (await REZ.volne(HRAC, { cash: 10 })).zamceno === 0);

  PODILY = [];
  ok('prázdný stav nic neshodí', (await REZ.volne(HRAC, null)).volne === 0);

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
