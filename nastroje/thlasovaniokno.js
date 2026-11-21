// =============================================================================
// HolyOS — Laundromat Tycoon: test okna „ve fondu se hlasuje"
// =============================================================================
// Návrh ve fondu má lhůtu a propadne mlčením. Kdo panel fondu neotevře, o něm
// neví — proto se hra ptá serveru a nehlasovaný návrh ukáže v okně. Test pouští
// opravdovou routu i opravdové funkce z game.js (vytažené a spuštěné ve vm),
// protože chyba tady znamená, že člen o hlasování neví vůbec.
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
function odZavorky(zdroj, od) {
  let hloubka = 0;
  for (let j = zdroj.indexOf('{', od); j < zdroj.length; j++) {
    if (zdroj[j] === '{') hloubka++;
    else if (zdroj[j] === '}') { hloubka--; if (!hloubka) return zdroj.slice(od, j + 1); }
  }
  throw new Error('konec se nenašel');
}
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  return odZavorky(zdroj, i);
}

// ─── Server: komu se návrh vůbec pošle ──────────────────────────────────────
async function routa() {
  console.log('\nServer posílá jen to, o čem člen ještě nehlasoval');
  const trade = fs.readFileSync(path.join(KOREN, 'routes/game-trade.routes.js'), 'utf8');
  const i = trade.indexOf("router.get('/trade/aliance/hlasovani'");
  ma(i > 0, 'routa /trade/aliance/hlasovani existuje');
  const zacatek = trade.indexOf('async (req, res) => {', i);
  const src = odZavorky(trade, trade.indexOf('{', zacatek + 'async (req, res) =>'.length) - 0);
  const ted = Date.now();
  const stav = { navrhy: [], hlasy: {}, clen: null, dotazy: 0, where: null };
  const ctx = {
    prisma: {
      gameFondNavrh: { findMany: async (a) => { stav.dotazy++; stav.where = a.where; return stav.navrhy; } },
      gameFondHlas: { findUnique: async (a) => stav.hlasy[a.where.navrh_id_clen_id.navrh_id] || null },
    },
    mojeAliance: async () => stav.clen,
    stavNavrhu: async () => ({ pro: 0.57, chybi: 0.19 }),
    console,
  };
  vm.createContext(ctx);
  const handler = vm.runInContext('(async (req, res) => ' + src + ')', ctx);
  const spust = async () => {
    let odpoved = null;
    await handler({ player: { id: 7 } }, { json: (x) => { odpoved = x; return x; } });
    return odpoved;
  };

  stav.clen = null;
  let r = await spust();
  ma(r && r.ok && r.navrhy.length === 0, 'kdo není ve fondu, nedostane nic');
  ma(stav.dotazy === 0, 'a server se na návrhy ani neptá', 'jeden dotaz a konec');

  stav.clen = { aliance_id: 3, player_id: 7 };
  stav.navrhy = [
    { id: 11, druh: 'clen_sazba', detail: { sazba: 0.15 }, prah: 0.75, do: new Date(ted + 3600000) },
    { id: 12, druh: 'dividenda', detail: {}, prah: 0.5, do: new Date(ted + 3600000) },
    { id: 13, druh: 'koupit', detail: {}, prah: 0.5, do: new Date(ted - 60000) },
  ];
  stav.hlasy = { 12: { volba: 'pro' } };
  r = await spust();
  const ids = r.navrhy.map((n) => n.id);
  ma(stav.where && stav.where.stav === 'bezi', 'ptá se jen na běžící návrhy');
  ma(ids.indexOf(11) >= 0, 'nehlasovaný návrh se pošle');
  ma(ids.indexOf(12) < 0, 'o čem už člen hlasoval, se neposílá');
  ma(ids.indexOf(13) < 0, 'návrh po lhůtě se neposílá');
  ma(r.navrhy[0].pro === 0.57 && r.navrhy[0].chybi === 0.19, 'posílá se i stav hlasování');
  ma(r.navrhy[0].prah === 0.75, 'a práh, aby člen věděl, kolik je potřeba');
}

// ─── Hra: okno vyskočí, ale neotravuje ──────────────────────────────────────
function okno() {
  console.log('\nOkno vyskočí jednou za spuštění a nepřebíjí otevřený panel');
  const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
  const stav = { ukazano: [], skryty: true };
  const ctx = {
    ME: { id: 7 },
    api: () => Promise.resolve({ ok: true, j: { navrhy: [{ id: 11, druh: 'clen_sazba',
      detail: { sazba: 0.15 }, prah: 0.75, do: null, pro: 0.57, chybi: 0.19 }] } }),
    $: () => ({ classList: { contains: () => stav.skryty } }),
    hlasovaniSheet: (n) => stav.ukazano.push(n.id),
  };
  vm.createContext(ctx);
  vm.runInContext('var HLASOVANI_UKAZANO = {};\n' + telo(zdroj, 'hlidejHlasovani'), ctx);

  return Promise.resolve()
    .then(() => { ctx.hlidejHlasovani(); })
    .then(() => {
      ma(stav.ukazano.length === 1, 'nehlasovaný návrh okno otevře');
      ctx.hlidejHlasovani();
    })
    .then(() => {
      ma(stav.ukazano.length === 1, 'podruhé už ne — jednou za spuštění hry');
      // Otevřený panel se nepřebíjí a návrh se nespotřebuje.
      ctx.HLASOVANI_UKAZANO = {};
      stav.skryty = false;
      ctx.hlidejHlasovani();
    })
    .then(() => {
      ma(stav.ukazano.length === 1, 'do otevřeného panelu okno neskáče');
      ma(!ctx.HLASOVANI_UKAZANO[11], 'a návrh si nechá na příště', 'jinak by se ztratil');
      stav.skryty = true;
      ctx.hlidejHlasovani();
    })
    .then(() => {
      ma(stav.ukazano.length === 2, 'jakmile je volno, okno se ukáže');
      ctx.ME = null;
      ctx.HLASOVANI_UKAZANO = {};
      ctx.hlidejHlasovani();
      ma(stav.ukazano.length === 2, 'nepřihlášenému se nic neukazuje');
    });
}

// ─── Hlasovat jde rovnou z okna ─────────────────────────────────────────────
function hlasovani() {
  console.log('\nZ okna se hlasuje rovnou');
  const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
  const prvky = {};
  const stav = { html: '', poslano: null, zavreno: 0, toast: null };
  const ctx = {
    sheet: (h) => { stav.html = h; },
    closeSheet: () => { stav.zavreno++; },
    toast: (t) => { stav.toast = t; },
    esc: (x) => String(x == null ? '' : x),
    tx: (k) => k,
    fondNavrhPopis: () => 'dividenda členům 15 % za herní rok',
    etaText: () => 'za 6 h 26 min',
    apiJson: (cesta, data) => { stav.poslano = { cesta, data }; return Promise.resolve({ ok: true, j: {} }); },
    $: (id) => (prvky[id] = prvky[id] || { onclick: null, disabled: false }),
    Math,
  };
  vm.createContext(ctx);
  vm.runInContext(telo(zdroj, 'hlasovaniSheet'), ctx);
  ctx.hlasovaniSheet({ id: 11, druh: 'clen_sazba', prah: 0.75, pro: 0.57, chybi: 0.19,
    do: new Date(Date.now() + 3600000).toISOString() });

  ma(stav.html.indexOf('fond.hlasovani_nadpis') > 0, 'okno má nadpis o hlasování');
  ma(stav.html.indexOf('dividenda členům 15 % za herní rok') > 0, 'je v něm vidět, o čem se rozhoduje');
  ma(stav.html.indexOf('57 %') > 0, 'a kolik už je pro');
  ma(stav.html.indexOf('veta.fond_chybi_hlasu') > 0, 'i kolik hlasů chybí do prahu');
  ma(stav.html.indexOf('za 6 h 26 min') > 0, 'a do kdy se stihne hlasovat');
  ma(!!prvky['hl-pro'].onclick && !!prvky['hl-proti'].onclick, 'tlačítka Pro i Proti fungují');

  prvky['hl-pro'].onclick();
  ma(stav.poslano && stav.poslano.cesta === '/trade/aliance/fond/navrh/11/hlas',
    'hlas jde na správný návrh', stav.poslano && stav.poslano.cesta);
  ma(stav.poslano && stav.poslano.data.volba === 'pro', 'a se správnou volbou');
  return Promise.resolve().then(() => {
    ma(stav.zavreno === 1, 'po hlasování se okno zavře');
    prvky['hl-proti'].onclick();
    ma(stav.poslano.data.volba === 'proti', 'Proti posílá proti');
    prvky['hl-pozdeji'].onclick();
    ma(stav.zavreno >= 2, 'tlačítko později okno zavře bez hlasu');
  });
}

// ─── Hra se musí ptát sama od sebe ──────────────────────────────────────────
function zapojeni() {
  console.log('\nHra se ptá sama, bez otevření fondu');
  const zdroj = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
  ma(/\n  hlidejHlasovani\(\);/.test(zdroj), 'ptá se hned po spuštění hry');
  ma(/setInterval\(hlidejHlasovani, 60000\)/.test(zdroj), 'a pak jednou za minutu');
}

(async () => {
  await routa();
  await okno();
  await hlasovani();
  zapojeni();
  console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
  process.exit(chyb ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
