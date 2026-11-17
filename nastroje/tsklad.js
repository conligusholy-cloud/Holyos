// Dopočet skladu ze stavu hry.
//
// Jednorázová věc, která ale sáhne na majetek všech hráčů najednou, takže
// musí platit tři věci: nikomu nic neubere, druhé spuštění nic nepřidá,
// a naprázdno opravdu nic nezapíše.
//
// Databáze se neptáme — prisma se podstrčí.
const Module = require('module');
const puvodni = Module.prototype.require;

let HRACI = [];
let OBJEDNAVKY = [];      // co už server eviduje
let VYTVORENO = [];       // co by se vytvořilo
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gamePlayer: { findMany: async () => HRACI },
      gameOrder: {
        // Podmínky dotazu ctíme schválně: právě ony rozhodují, co se počítá
        // jako sklad. Kdyby se v kódu ztratilo „jen nepostavené", postavený
        // stroj by se doplnil znovu a hráč by ho dostal dvakrát.
        findMany: async (q) => OBJEDNAVKY.filter((o) => o.player_id === q.where.player_id
          && (q.where.postaveno_at !== null || !o.postaveno_at)
          && (q.where.zruseno_at !== null || !o.zruseno_at)),
        createMany: async (q) => {
          q.data.forEach((d) => { VYTVORENO.push(d); OBJEDNAVKY.push(d); });
          return { count: q.data.length };
        },
      },
    } };
  }
  return puvodni.apply(this, arguments);
};
const sklad = require('../services/game/sklad');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const ZA_HODINU = Date.now() + 3600000;

function priprav(stav, serverove) {
  HRACI = [{ id: 1, nick: 'Test', state: stav }];
  OBJEDNAVKY = (serverove || []).map((o) => Object.assign({ player_id: 1 }, o));
  VYTVORENO = [];
}

(async () => {
  // ── Co hra tvrdí, se přečte správně ────────────────────────────────────
  const ze = sklad.zeStavu({ stock: { mini: 2, flex: 1, max: 0 },
    orders: [{ model: 'max', arrivesAt: ZA_HODINU }, { model: 'nic', arrivesAt: ZA_HODINU }] });
  ok('sklad ze stavu hry', ze.skladem.mini === 2 && ze.skladem.flex === 1 && ze.skladem.max === 0);
  ok('neznámý model v zásilkách se zahodí', ze.naceste.length === 1 && ze.naceste[0].model === 'max');

  // ── Naprázdno nic nezapíše ─────────────────────────────────────────────
  priprav({ stock: { mini: 2 } }, []);
  let z = await sklad.doplnit({ ostro: false });
  ok('naprázdno se nic nevytvoří', VYTVORENO.length === 0 && z.pridano === 2,
    '— napočítáno ' + z.pridano);

  // ── Ostrý běh doplní, co chybí ─────────────────────────────────────────
  priprav({ stock: { mini: 2 } }, []);
  z = await sklad.doplnit({ ostro: true });
  ok('ostrý běh doplní chybějící stroje', VYTVORENO.length === 2 && z.pridano === 2);
  ok('doplněné řádky nesou značku', VYTVORENO.every((x) => x.doplneno === true));
  ok('doplněný sklad má datum dodání v minulosti',
    VYTVORENO.every((x) => x.dorazi_at.getTime() <= Date.now()));
  ok('doplněný stroj má cenu', VYTVORENO.every((x) => x.cena > 0));

  // ── Druhé spuštění nic nepřidá ─────────────────────────────────────────
  VYTVORENO = [];
  z = await sklad.doplnit({ ostro: true });
  ok('druhé spuštění nic nepřidá', VYTVORENO.length === 0 && z.pridano === 0,
    '— přidáno ' + z.pridano);

  // ── Doplní se jen rozdíl ───────────────────────────────────────────────
  priprav({ stock: { flex: 3 } }, [
    { model: 'flex', dorazi_at: new Date(Date.now() - 1000), postaveno_at: null, zruseno_at: null },
  ]);
  z = await sklad.doplnit({ ostro: true });
  ok('doplní se jen rozdíl, ne celý sklad', VYTVORENO.length === 2,
    '— vytvořeno ' + VYTVORENO.length);

  // ── Když má server víc, nic se neubere ─────────────────────────────────
  priprav({ stock: { mini: 1 } }, [
    { model: 'mini', dorazi_at: new Date(Date.now() - 1000), postaveno_at: null, zruseno_at: null },
    { model: 'mini', dorazi_at: new Date(Date.now() - 1000), postaveno_at: null, zruseno_at: null },
  ]);
  z = await sklad.doplnit({ ostro: true });
  ok('server s přebytkem se nekrátí', VYTVORENO.length === 0 && OBJEDNAVKY.length === 2);

  // ── Zásilky na cestě zůstanou na cestě ─────────────────────────────────
  priprav({ stock: {}, orders: [{ model: 'max', arrivesAt: ZA_HODINU }] }, []);
  z = await sklad.doplnit({ ostro: true });
  ok('zásilka na cestě se doplní jako na cestě',
    VYTVORENO.length === 1 && VYTVORENO[0].dorazi_at.getTime() > Date.now(),
    VYTVORENO.length ? '— dorazí za ' + Math.round((VYTVORENO[0].dorazi_at.getTime() - Date.now()) / 60000) + ' min' : '');

  // ── Sklad i cesta najednou ─────────────────────────────────────────────
  priprav({ stock: { mini: 1, max: 2 }, orders: [{ model: 'flex', arrivesAt: ZA_HODINU }] }, []);
  z = await sklad.doplnit({ ostro: true });
  ok('sklad i cesta se doplní dohromady', VYTVORENO.length === 4,
    '— vytvořeno ' + VYTVORENO.length);
  ok('rozpad po modelech sedí',
    z.podleModelu.mini === 1 && z.podleModelu.max === 2 && z.podleModelu.flex === 1,
    '— ' + JSON.stringify(z.podleModelu));

  // ── Hráč bez rozehrané hry se přeskočí ─────────────────────────────────
  HRACI = [{ id: 9, nick: 'Prázdný', state: null }];
  OBJEDNAVKY = []; VYTVORENO = [];
  z = await sklad.doplnit({ ostro: true });
  ok('hráč bez uložené hry se přeskočí', VYTVORENO.length === 0 && z.hracu === 0);

  // ── Postavené a zrušené stroje se nepočítají jako sklad ────────────────
  // Takové řádky server do dotazu vůbec nebere, takže by se doplnily znovu.
  // Hlídáme, že se dotaz ptá právě na nepostavené a nezrušené.
  priprav({ stock: { mini: 1 } }, [
    { model: 'mini', dorazi_at: new Date(Date.now() - 1000), postaveno_at: new Date(), zruseno_at: null },
  ]);
  z = await sklad.doplnit({ ostro: false });
  ok('postavený stroj se do skladu nepočítá', z.pridano === 1,
    '— napočítáno ' + z.pridano);

  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
