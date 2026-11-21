// =============================================================================
// HolyOS — Laundromat Tycoon: test pozemků (soud, inzerát, obnova záboru)
// =============================================================================
// Tři chyby, které hlásili hráči:
//   1) Soud zabavil prádlomat a zrušil celý zábor — i na vlastním pozemku.
//      Zem hráči zůstala ve hře, ale server o ní nevěděl, takže pronájem
//      hlásil, že pozemek hráči nepatří.
//   2) Špendlík „k pronájmu“ na cizím pozemku otevíral panel konkurence,
//      kde se nedalo nic dělat — pronajmout si zem nešlo.
//   3) Zábor zrušený soudem se neměl jak vrátit.
// Testy pouštějí opravdový kód: uzavri() ze zlocin-rizeni.js s falešnou
// databází a funkce vytažené z game.js ve vm.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis) {
  if (podminka) { console.log('  ok   ' + popis); return; }
  chyb++; console.log('  CHYBA ' + popis);
}

// Vytáhne zdroj funkce podle jména — párováním složených závorek.
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  let hloubka = 0, zacatek = zdroj.indexOf('{', i);
  for (let j = zacatek; j < zdroj.length; j++) {
    if (zdroj[j] === '{') hloubka++;
    else if (zdroj[j] === '}') { hloubka--; if (!hloubka) return zdroj.slice(i, j + 1); }
  }
  throw new Error('funkce ' + jmeno + ' nemá konec');
}

// ─── 1. Soud: zem zůstává, propadá jen stroj ────────────────────────────────
async function soud() {
  console.log('\nSoud zabavuje stroje, ne zaplacenou zem');
  // settings tahají prisma klienta — v testu ho nahradíme, ať se nepřipojuje.
  const nast = require.resolve(path.join(KOREN, 'services/settings.js'));
  require.cache[nast] = { id: nast, filename: nast, loaded: true,
    exports: { getSetting: async () => ({}), setSetting: async () => ({}) } };
  const RIZ = require(path.join(KOREN, 'services/game/zlocin-rizeni.js'));

  const zapsano = [];
  const claims = [
    { spot_id: 'liberec-14', player_id: 7, model: 'flex', pozemek: true, name: 'Vlastní zem' },
    { spot_id: 'brno-3', player_id: 7, model: 'mini', pozemek: false, name: 'Nájemní místo' },
  ];
  const prisma = {
    gameZlocin: { update: async ({ data }) => Object.assign({ id: 1, hlavni_id: 7, firma: 'F' }, data) },
    gameZlocinZprava: { create: async () => ({}) },
    gamePlayer: { findUnique: async () => ({ state: { cash: 0 } }) },
    gameDelivery: { create: (a) => ({ op: 'delivery', kind: a.data.kind, spot_id: a.data.spot_id }) },
    gameSpotClaim: {
      findMany: async () => claims.filter((c) => c.model),
      deleteMany: (a) => ({ op: 'delete', spot_id: a.where.spot_id }),
      updateMany: (a) => ({ op: 'update', spot_id: a.where.spot_id, data: a.data }),
    },
    $transaction: async (ops) => { ops.forEach((o) => zapsano.push(o)); return ops; },
  };
  // Trest je vyšší než zmrazené i hotovost → propadají prádlomaty.
  await RIZ.uzavri(prisma, { id: 1, hlavni_id: 7, firma: 'F', zmrazeno: 0, trest_castka: 9999999, skoda: 1 }, null, 9999999);

  const zem = zapsano.filter((o) => o.spot_id === 'liberec-14');
  const najem = zapsano.filter((o) => o.spot_id === 'brno-3');
  ma(zem.some((o) => o.op === 'delivery' && o.kind === 'unit_remove'), 'stroj z vlastní zemi propadá (doručenka unit_remove)');
  ma(!zem.some((o) => o.op === 'delete'), 'zábor vlastního pozemku se NEruší');
  ma(zem.some((o) => o.op === 'update' && o.data.model === ''), 'z pozemku se maže jen stroj');
  ma(najem.some((o) => o.op === 'delete'), 'nájemní místo se uvolní (zábor se ruší)');
  ma(!najem.some((o) => o.op === 'update'), 'nájemní místo se jen tak nepřepisuje');
}

// ─── 2. Cizí pozemek k pronájmu musí jít otevřít ────────────────────────────
function inzerat() {
  console.log('\nŠpendlík „k pronájmu“ otevírá panel, ze kterého se dá pronajmout');
  const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
  const kam = [];
  const ctx = {
    cizipozemekSheet: function (sp, areaId, c) { kam.push('pronajem'); },
    sheet: function () { kam.push('rival'); },
    esc: (x) => String(x == null ? '' : x), tx: () => '', znakSvg: () => '',
    verdictPill: () => '', kcFull: (n) => String(n), MODELS: { flex: { name: 'Flex' } },
    MODEL_ORDER: [], inStock: () => 0, economics: () => ({}), rentOf: () => 0,
    BID_FEE: 5000, $: () => null, S: { cash: 0 },
  };
  vm.createContext(ctx);
  vm.runInContext(telo(zdroj, 'rivalSheet'), ctx);
  const sp = { id: 'usti-nad-labem-9', name: 'Zem', kind: 'ulice', score: 60 };

  kam.length = 0;
  ctx.rivalSheet(sp, 'usti-nad-labem', { pozemek: true, model: '', nick: 'Tom', firma: 'Tom s.r.o.',
    pronajem: { cena: 7000, sit: true } });
  ma(kam[0] === 'pronajem', 'cizí zem bez stroje otevře panel pronájmu');

  kam.length = 0;
  ctx.rivalSheet(sp, 'usti-nad-labem', { pozemek: true, model: 'flex', nick: 'Tom', firma: 'Tom s.r.o.' });
  ma(kam[0] === 'rival', 'na cizím pozemku se strojem zůstává panel konkurence');
}

// ─── 3. Obnova záboru zrušeného soudem ──────────────────────────────────────
function obnova() {
  console.log('\nZábor pozemku, o kterém server neví, se zapíše zpátky');
  const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
  let odpoved = { ok: true, j: { spot: { mine: true, pozemek: true } } };
  const poslano = [];
  const ctx = {
    apiJson: function (cesta, telo) { poslano.push({ cesta, telo }); return Promise.resolve(odpoved); },
    CLAIMS: {}, S: { pozemky: [{ spotId: 'liberec-14' }] },
    pozemky: function () { return ctx.S.pozemky; },
    save: function () {}, drawMap: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext('var ZABOR_ZKUSEN = {};\n' + telo(zdroj, 'obnovZaborPozemku'), ctx);
  const sp = { id: 'liberec-14', name: 'Zem', lat: 50, lon: 15, score: 70 };

  return new Promise((hotovo) => {
    ctx.obnovZaborPozemku(sp, 'liberec', function () {
      ma(poslano.length === 1 && poslano[0].cesta === '/spots/claim', 'zábor se zapisuje přes /spots/claim');
      ma(poslano[0].telo.pozemek === true && poslano[0].telo.spot_id === 'liberec-14', 'posílá se pozemek, ne stavba');
      ma(!!ctx.CLAIMS['liberec-14'], 'zábor se objeví v evidenci míst');
      ma(ctx.S.pozemky.length === 1, 'pozemek zůstává hráči');

      // Mezitím ho zabral někdo jiný — pak zem moje není a ze seznamu zmizí.
      odpoved = { ok: false, j: { error: 'obsazeno', occupied: { mine: false, nick: 'Karlos' } } };
      ctx.ZABOR_ZKUSEN = {};
      ctx.obnovZaborPozemku(sp, 'liberec', function () {
        ma(ctx.S.pozemky.length === 0, 'cizí zábor pozemek ze seznamu odebere');
        hotovo();
      });
    });
  });
}

// ─── 4. Panel vlastního pozemku si obnovu vyžádá ────────────────────────────
function panel() {
  console.log('\nPanel vlastního pozemku si chybějící zábor vyžádá');
  const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
  const t = telo(zdroj, 'spotSheet');
  const i = t.indexOf('if (mamPozemek(sp.id)) {');
  const usek = i < 0 ? '' : t.slice(i, i + 400);
  ma(/if \(!CLAIMS\[sp\.id\] && !ZABOR_ZKUSEN\[sp\.id\]\)[\s\S]{0,160}obnovZaborPozemku\(sp, areaId/.test(usek),
    'větev vlastního pozemku volá obnovu, když zábor chybí');
}

(async () => {
  await soud();
  inzerat();
  await obnova();
  panel();
  console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
  process.exit(chyb ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
