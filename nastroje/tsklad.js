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
        findMany: async (q) => OBJEDNAVKY.filter((o) => {
          const w = q.where || {};
          if (w.player_id !== undefined && o.player_id !== w.player_id) return false;
          if (w.doplneno !== undefined && !!o.doplneno !== w.doplneno) return false;
          if (w.postaveno_at === null && o.postaveno_at) return false;
          if (w.zruseno_at === null && o.zruseno_at) return false;
          return true;
        }),
        createMany: async (q) => {
          q.data.forEach((d) => { VYTVORENO.push(d); OBJEDNAVKY.push(d); });
          return { count: q.data.length };
        },
        deleteMany: async (q) => {
          const ids = new Set(q.where.id.in);
          const pred = OBJEDNAVKY.length;
          OBJEDNAVKY = OBJEDNAVKY.filter((o) => !ids.has(o.id));
          return { count: pred - OBJEDNAVKY.length };
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

  // ── Zásilka, která mezitím doletěla, se nesmí doplnit znovu ────────────
  // Tohle je ta chyba, co stála 21 strojů navíc. Hra pořád vede zásilku na
  // cestě, server už ji má jako sklad — a protože se dřív porovnávaly
  // přihrádky zvlášť, vyšlo z toho, že na cestě chybí.
  priprav({ stock: {}, orders: [{ model: 'mini', arrivesAt: ZA_HODINU }] }, [
    { model: 'mini', dorazi_at: new Date(Date.now() - 1000), postaveno_at: null, zruseno_at: null },
  ]);
  z = await sklad.doplnit({ ostro: true });
  ok('doletěná zásilka se nedoplní znovu', VYTVORENO.length === 0,
    '— vytvořeno ' + VYTVORENO.length);

  // A naopak: hra má sklad, server to vede jako zásilku na cestě.
  priprav({ stock: { mini: 1 } }, [
    { model: 'mini', dorazi_at: new Date(ZA_HODINU), postaveno_at: null, zruseno_at: null },
  ]);
  z = await sklad.doplnit({ ostro: true });
  ok('opačná přihrádka taky nic nepřidá', VYTVORENO.length === 0,
    '— vytvořeno ' + VYTVORENO.length);

  // ── Čas dodání zásilky se bere od hry, nepřepisuje se ──────────────────
  priprav({ stock: {}, orders: [{ model: 'max', arrivesAt: ZA_HODINU }] }, []);
  z = await sklad.doplnit({ ostro: true });
  ok('doplněná zásilka si nese čas dodání ze hry',
    VYTVORENO.length === 1 && Math.abs(VYTVORENO[0].dorazi_at.getTime() - ZA_HODINU) < 2000,
    VYTVORENO.length ? '— ' + VYTVORENO[0].dorazi_at.toISOString() : '');

  // ── Opakování do třetice ───────────────────────────────────────────────
  priprav({ stock: { mini: 2 }, orders: [{ model: 'flex', arrivesAt: ZA_HODINU }] }, []);
  await sklad.doplnit({ ostro: true });
  const poPrvnim = OBJEDNAVKY.length;
  await sklad.doplnit({ ostro: true });
  await sklad.doplnit({ ostro: true });
  ok('třetí a čtvrtý běh nepřidají nic', OBJEDNAVKY.length === poPrvnim,
    '— po prvním ' + poPrvnim + ', nakonec ' + OBJEDNAVKY.length);

  // ── Úklid smaže jen doplněné a nepostavené ─────────────────────────────
  OBJEDNAVKY = [
    { id: 1, player_id: 1, model: 'mini', doplneno: true, postaveno_at: null, zruseno_at: null },
    { id: 2, player_id: 1, model: 'mini', doplneno: true, postaveno_at: new Date(), zruseno_at: null },
    { id: 3, player_id: 1, model: 'flex', doplneno: false, postaveno_at: null, zruseno_at: null },
  ];
  const puvodniFind = OBJEDNAVKY.slice();
  HRACI = [];
  let u = await sklad.uklid({ ostro: false });
  ok('úklid naprázdno nic nesmaže', OBJEDNAVKY.length === 3 && u.smazano === 1,
    '— našel ' + u.smazano);
  u = await sklad.uklid({ ostro: true });
  ok('úklid smaže jen doplněný a nepostavený stroj',
    OBJEDNAVKY.length === 2 && OBJEDNAVKY.every((o) => o.id !== 1),
    '— zbylo ' + OBJEDNAVKY.map((o) => o.id).join(','));
  ok('koupený stroj úklid nechá být', OBJEDNAVKY.some((o) => o.id === 3));
  ok('postavený doplněný stroj úklid nechá být', OBJEDNAVKY.some((o) => o.id === 2));
  void puvodniFind;

  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
