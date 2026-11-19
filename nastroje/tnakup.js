// Hlášení nákupu stroje: fronta, která se nevzdá.
//
// Nákup se serveru hlásí zvlášť a z toho hlášení vzniká objednávka, podle
// které server ví, co má hráč na skladě. Dřív se posílalo jednou: když spadlo
// uložení, nespustilo se vůbec, a když spadlo hlášení, spolkl to catch.
// Komentář u toho sliboval „zkusí se příště", jenže nic takového neexistovalo.
//
// Hráč stroj zaplatil a měl, server o něm nevěděl — pak mu povinný sklad
// odmítl stavbu a v pokladně mu chyběl největší výdaj ze všech. Při patnácti
// nasazeních za den je taková ztracená vteřina skoro jistota.
//
// Testuje se SKUTEČNÝ kód vytažený z game.js, ne jeho opis.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
function vytahni(re, co) {
  const m = hra.match(re);
  if (!m) { ok('v game.js se našlo: ' + co, false); return ''; }
  return m[0];
}
const kusy = [
  vytahni(/var NAHLASIT_MAX = [^\n]*\n/, 'NAHLASIT_MAX'),
  vytahni(/function klicNakupu\(\) \{[\s\S]*?\n\}/, 'klicNakupu'),
  vytahni(/function doFronty\(model, hned\) \{[\s\S]*?\n\}/, 'doFronty'),
  vytahni(/var nahlasBezi = false;\n/, 'nahlasBezi'),
  vytahni(/function nahlasNakupy\(\) \{[\s\S]*?\n\}/, 'nahlasNakupy'),
];
if (kusy.some((x) => !x)) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }

// Okolí, které ten kód potřebuje: hráč, uložený stav a volání na server.
const box = { ME: { id: 7 }, S: null, ulozeno: 0, poslano: [], odpoved: null,
  save: () => { box.ulozeno++; },
  // Skutečný apiJson staví na fetch: ten se neporouchá výjimkou, ale
  // odmítnutým slibem. Atrapa to musí dělat stejně, jinak by test zkoušel
  // něco jiného, než co se v provozu děje.
  apiJson: (cesta, telo) => { box.poslano.push({ cesta, telo });
    try { return Promise.resolve(box.odpoved(telo)); }
    catch (e) { return Promise.reject(e); } },
  Promise, Math, Date, String, Array, console };
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);

(async () => {
  // ── Fronta žije v ukládaném stavu ──────────────────────────────────────────
  box.S = {};
  box.doFronty('max', false);
  ok('nákup se zapíše do ukládaného stavu', Array.isArray(box.S.nahlasit) && box.S.nahlasit.length === 1,
    '— ' + JSON.stringify(box.S.nahlasit));
  ok('a nese model i klíč',
    box.S.nahlasit[0].model === 'max' && !!box.S.nahlasit[0].klic,
    '— ' + JSON.stringify(box.S.nahlasit[0]));
  // Tohle je ta vlastnost, kvůli které fronta nesmí být jen v paměti:
  // po načtení stránky se S obnoví z uloženého stavu a nákup v něm pořád je.
  const poNacteni = JSON.parse(JSON.stringify(box.S));
  ok('přežije uložení a načtení', poNacteni.nahlasit.length === 1);

  box.doFronty('mini', true);
  ok('dva nákupy mají různé klíče',
    box.S.nahlasit[0].klic !== box.S.nahlasit[1].klic);

  // ── Strop fronty ───────────────────────────────────────────────────────────
  box.S = { nahlasit: [] };
  for (let i = 0; i < box.NAHLASIT_MAX + 10; i++) box.doFronty('mini', false);
  ok('fronta neroste donekonečna', box.S.nahlasit.length === box.NAHLASIT_MAX,
    '— ' + box.S.nahlasit.length + ' / ' + box.NAHLASIT_MAX);

  // ── Potvrzený nákup z fronty zmizí ─────────────────────────────────────────
  box.S = {}; box.poslano = []; box.ulozeno = 0;
  box.doFronty('max', false);
  const klic = box.S.nahlasit[0].klic;
  box.odpoved = () => ({ ok: true, j: { ok: true } });
  await box.nahlasNakupy();
  ok('potvrzený nákup se odešle', box.poslano.length === 1
    && box.poslano[0].cesta === '/account/nakup', '— ' + JSON.stringify(box.poslano));
  ok('a pošle se s ním klíč', box.poslano[0].telo.klic === klic);
  ok('z fronty zmizí', box.S.nahlasit.length === 0);
  ok('a stav se uloží', box.ulozeno > 0);

  // ── To podstatné: neúspěch nákup NEZAHODÍ ──────────────────────────────────
  box.S = {}; box.poslano = [];
  box.doFronty('flex', false);
  box.odpoved = () => ({ ok: false, status: 502, j: null });
  await box.nahlasNakupy();
  ok('odmítnuté hlášení nechá nákup ve frontě', box.S.nahlasit.length === 1,
    '— ' + box.S.nahlasit.length);
  // A při dalším pokusu se pošle znovu, se STEJNÝM klíčem — jinak by
  // z opakování vznikly dva stroje.
  const klic2 = box.S.nahlasit[0].klic;
  box.odpoved = () => ({ ok: true, j: { ok: true } });
  await box.nahlasNakupy();
  ok('příští pokus ho doručí', box.S.nahlasit.length === 0);
  ok('a použije týž klíč', box.poslano[box.poslano.length - 1].telo.klic === klic2,
    '— ' + box.poslano[box.poslano.length - 1].telo.klic + ' vs ' + klic2);

  // ── Spadlé spojení taky nic nezahodí ───────────────────────────────────────
  box.S = {}; box.doFronty('max', false);
  box.odpoved = () => { throw new Error('síť spadla'); };
  await box.nahlasNakupy();
  ok('spadlé spojení nákup nezahodí', box.S.nahlasit.length === 1);

  // ── Celá fronta se vyprázdní najednou ──────────────────────────────────────
  box.S = { nahlasit: [] }; box.poslano = [];
  box.doFronty('mini', false); box.doFronty('flex', false); box.doFronty('max', false);
  box.odpoved = () => ({ ok: true, j: { ok: true } });
  await box.nahlasNakupy();
  ok('fronta se vyprázdní celá', box.S.nahlasit.length === 0 && box.poslano.length === 3,
    '— odesláno ' + box.poslano.length);

  // ── Server musí klíč číst ──────────────────────────────────────────────────
  // Fronta bez klíče na serveru by z opakování dělala další a další stroje.
  const route = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'game-account.routes.js'), 'utf8');
  ok('server klíč přijímá', /const klic = s\(b\.klic/.test(route));
  ok('a hledá podle něj dřív, než něco založí',
    route.indexOf('gameOrder.findUnique({ where: { klic } })') > 0);
  ok('a umí dvě hlášení ve stejnou chvíli',
    route.indexOf("e.code !== 'P2002'") > 0);
  const mig = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations',
    '20261120070000_order_klic', 'migration.sql'), 'utf8');
  ok('a databáze to jistí jedinečným indexem',
    /CREATE UNIQUE INDEX[\s\S]*game_orders_klic_key/.test(mig));

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
