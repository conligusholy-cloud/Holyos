// =============================================================================
// HolyOS — Laundromat Tycoon: dluh na prodaném prádlomatu
// =============================================================================
// Kdo kupuje postavený prádlomat, má dostat prádlomat, ne cizí splátky.
// Dřív se claim jen přepsal na kupujícího: prodávající dál splácel stroj,
// který už nemá, a zastavený prádlomat se prodejem zbavil zástavy — věřiteli
// zbylo vymáhání místo krytí.
//
// Testuje se opravdový kód: služba dluh-mista.js, obsluha z game-trade
// a obsluha doručenky z game.js, obojí vytažené ve vm.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, detail) {
  if (podminka) { console.log('  ok   ' + popis + (detail ? '  — ' + detail : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (detail ? '  — ' + detail : ''));
}
// Vytáhne zdroj funkce podle jména — párováním složených závorek.
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  const asyncni = /async\s+$/.test(zdroj.slice(Math.max(0, i - 8), i));
  let hloubka = 0;
  for (let j = zdroj.indexOf('{', i); j < zdroj.length; j++) {
    if (zdroj[j] === '{') hloubka++;
    else if (zdroj[j] === '}') { hloubka--; if (!hloubka) return (asyncni ? 'async ' : '') + zdroj.slice(i, j + 1); }
  }
  throw new Error('funkce ' + jmeno + ' nemá konec');
}

const DLUH = require(path.join(KOREN, 'services/game/dluh-mista'));
const TRADE = fs.readFileSync(path.join(KOREN, 'routes/game-trade.routes.js'), 'utf8');
const HRA = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');

// ─── 1. Co na místě vázne ───────────────────────────────────────────────────
function cojevazne() {
  console.log('\nCo na prádlomatu vázne');
  const st = { loans: [
    { spotId: 'hk-1', zbyva: 800000 },      // úvěr na stroj
    { spotId: 'hk-1', zbyva: 200000 },      // a na přípojky
    { spotId: 'hk-2', zbyva: 5000000 },     // jiné místo
    { spotId: 'hk-1', zbyva: 0 },           // doplacený
    { spotId: 'hk-1', zbyva: -50 },         // nesmysl
    null,
  ] };
  ma(DLUH.banka(st, 'hk-1') === 1000000, 'úvěry na jednom místě se sčítají', DLUH.banka(st, 'hk-1'));
  ma(DLUH.banka(st, 'hk-2') === 5000000, 'cizí místo se do toho neplete');
  ma(DLUH.banka(st, 'hk-9') === 0, 'na místě bez úvěru nevázne nic');
  ma(DLUH.banka(st, '') === 0 && DLUH.banka(null, 'hk-1') === 0, 'prázdné vstupy nic neshodí');
  ma(DLUH.banka({ loans: 'nesmysl' }, 'hk-1') === 0, 'rozbitý stav nic neshodí');

  // Doplatek půjčky = současná hodnota zbývajících splátek.
  const p = { mesicu: 12, splaceno: 2, splatka: 100000, urok: 0.12 };
  const r = 0.01, n = 10;
  const cekam = Math.round(100000 * (1 - Math.pow(1 + r, -n)) / r);
  ma(DLUH.doplatek(p) === cekam, 'doplatek je současná hodnota, ne součet splátek', DLUH.doplatek(p));
  ma(DLUH.doplatek(p) < 100000 * 10, 'a je tedy nižší než součet splátek');
  ma(DLUH.doplatek({ mesicu: 6, splaceno: 6, splatka: 100000 }) === 0, 'splacená půjčka nic nestojí');
  ma(DLUH.doplatek({ mesicu: 5, splaceno: 0, splatka: 1000, urok: 0 }) === 5000, 'bez úroku je to prostý součet');
}

// ─── 2. Jak se cena rozdělí ─────────────────────────────────────────────────
function deleni() {
  console.log('\nRozdělení ceny (Tomášův příklad: 1,5 mil. za prádlomat s úvěrem 1 mil.)');
  const a = DLUH.rozdel(1500000, { banka: 1000000, pujcky: [], celkem: 1000000 });
  ma(a.banka === 1000000, 'na úvěr jde celý milion', a.banka);
  ma(a.prodavajicimu === 500000, 'prodávajícímu zbyde půl milionu', a.prodavajicimu);
  ma(a.banka + a.prodavajicimu === 1500000, 'nic se po cestě neztratí ani nepřibude');

  console.log('\nZastavený prádlomat');
  const z = { id: 7, castka: 400000, lender_id: 2, lender_nick: 'Banka s.r.o.', mesicu: 10 };
  const b = DLUH.rozdel(1000000, { banka: 300000, pujcky: [z], celkem: 700000 });
  ma(b.pujcky.length === 1 && b.pujcky[0].zaplatit === 400000, 'zástava se doplatí celá', b.pujcky[0].zaplatit);
  ma(b.banka === 300000, 'a na banku zbyde zbytek dluhu');
  ma(b.prodavajicimu === 300000, 'prodávajícímu zůstane, co přebude', b.prodavajicimu);
  ma(b.doplaceno === 700000, 'doplaceno sedí na součtu dluhu');

  console.log('\nKdyž cena na dluh nestačí');
  const c = DLUH.rozdel(300000, { banka: 1000000, pujcky: [z], celkem: 1400000 });
  ma(c.pujcky.length === 0, 'půjčka se z půlky nedoplácí — buď celá, nebo vůbec');
  ma(c.banka === 300000, 'co je, jde na bankovní úvěr');
  ma(c.prodavajicimu === 0, 'prodávajícímu nezbyde nic');
  const d = DLUH.rozdel(0, { banka: 1000000, pujcky: [z], celkem: 1400000 });
  ma(d.banka === 0 && d.prodavajicimu === 0, 'nulová cena nic nerozdá');
  const e = DLUH.rozdel(2000000, { banka: 0, pujcky: [], celkem: 0 });
  ma(e.prodavajicimu === 2000000, 'bez dluhu dostane prodávající všechno');

  console.log('\nPořadí: zástava má přednost před bankou');
  const f = DLUH.rozdel(400000, { banka: 1000000, pujcky: [z], celkem: 1400000 });
  ma(f.pujcky.length === 1 && f.banka === 0,
    'přesně na zástavu — doplatí se ona, ne banka', JSON.stringify({ p: f.pujcky.length, b: f.banka }));
}

// ─── 3. Obsluha na serveru ──────────────────────────────────────────────────
async function server() {
  console.log('\nObchod doplácí dluh z ceny');
  const src = telo(TRADE, 'doplatDluhZCeny');
  const ctx = vm.createContext({ DLUH, Math, Number, Set, Object, console });
  vm.runInContext(src + '\nthis.F = doplatDluhZCeny;', ctx);
  const F = ctx.F;

  function tx(zapisy) {
    return { gameLoan: { update: async (x) => { zapisy.push(x); return {}; } } };
  }
  const prodavajici = { id: 1, nick: 'Petulak', state: { loans: [
    { spotId: 'hk-1', zbyva: 1000000 }, { spotId: 'hk-2', zbyva: 400000 } ] } };
  // Falešná prisma: naMiste se ptá na půjčky se zástavou.
  const puj = [];
  const db = { gameLoan: { findMany: async () => puj,
    update: async () => ({}) } };
  const naMiste = DLUH.naMiste;

  // (a) jen bankovní úvěr
  {
    const zapisy = [];
    const t = Object.assign(tx(zapisy), { gameLoan: Object.assign({}, db.gameLoan,
      { update: async (x) => { zapisy.push(x); return {}; } }) });
    const r = await F(t, prodavajici, 'hk-1', 1500000);
    const uver = r.davky.filter((x) => x.kind === 'uver_splatka')[0];
    ma(!!uver, 'hře jde pokyn k doplacení úvěru');
    ma(uver && uver.amount === 1000000, 'a na celou výši úvěru', uver && uver.amount);
    ma(uver && uver.spot_id === 'hk-1', 'a na správné místo');
    ma(r.prodavajicimu === 500000, 'prodávajícímu zbyde 500 000', r.prodavajicimu);
    ma(!zapisy.length, 'bez zástavy se žádná půjčka nepřepisuje');
  }
  // (b) zastavený prádlomat, cena stačí
  {
    puj.length = 0;
    puj.push({ id: 7, lender_id: 2, lender_nick: 'Věřitel', borrower_id: 1,
      mesicu: 10, splaceno: 0, splatka: 50000, urok: 0, zastava_spot: 'hk-1' });
    const zapisy = [];
    const t = { gameLoan: { findMany: async () => puj,
      update: async (x) => { zapisy.push(x); return {}; } } };
    const r = await F(t, prodavajici, 'hk-1', 2000000);
    const veriteli = r.davky.filter((x) => x.kind === 'cash' && x.player_id === 2)[0];
    ma(!!veriteli, 'věřitel dostane peníze');
    ma(veriteli && veriteli.amount === 500000, 'a to doplatek půjčky', veriteli && veriteli.amount);
    ma(zapisy.length === 1 && zapisy[0].data.stav === 'splaceno', 'půjčka se uzavře');
    ma(zapisy[0].data.zastava_spot === null, 'a zástava se uvolní');
    ma(r.prodavajicimu === 500000, 'prodávajícímu zbyde cena bez obou dluhů', r.prodavajicimu);
    ma(r.davky.some((x) => x.kind === 'uver_splatka' && x.amount === 1000000), 'banka dostane svoje');
  }
  // (c) cena na zástavu nestačí — půjčka běží dál, ale věřitel se to dozví
  {
    const zapisy = [];
    const t = { gameLoan: { findMany: async () => puj,
      update: async (x) => { zapisy.push(x); return {}; } } };
    const r = await F(t, prodavajici, 'hk-1', 300000);
    ma(!r.davky.some((x) => x.kind === 'cash' && x.player_id === 2), 'věřiteli se nic nedoplácí');
    ma(zapisy.length === 1 && zapisy[0].data.zastava_spot === null, 'zástava se stejně uvolní — stroj je pryč');
    ma(!zapisy[0].data.stav, 'ale půjčka běží dál');
    ma(r.davky.some((x) => x.kind === 'zprava' && x.player_id === 2), 'věřitel dostane zprávu');
    ma(r.prodavajicimu === 0, 'prodávajícímu nezbyde nic', r.prodavajicimu);
  }
  // (d) místo bez dluhu se nikam nehlásí
  {
    puj.length = 0;
    const t = { gameLoan: { findMany: async () => [], update: async () => ({}) } };
    const r = await F(t, prodavajici, 'hk-9', 1000000);
    ma(!r.davky.length && r.prodavajicimu === 1000000, 'čistý prádlomat se prodá jako dřív');
  }
  // naMiste nad falešnou databází
  {
    puj.length = 0;
    puj.push({ id: 7, lender_id: 2, lender_nick: 'V', borrower_id: 1,
      mesicu: 4, splaceno: 0, splatka: 25000, urok: 0, zastava_spot: 'hk-1' });
    const v = await naMiste({ gameLoan: { findMany: async () => puj } }, prodavajici, 'hk-1');
    ma(v.banka === 1000000 && v.zastava === 100000 && v.celkem === 1100000,
      'naMiste sečte obojí', JSON.stringify(v.celkem));
    const prazdne = await naMiste({ gameLoan: { findMany: async () => [] } }, null, 'hk-1');
    ma(prazdne.celkem === 0, 'bez hráče nevázne nic');
  }
}

// ─── 4. Obě cesty prodeje ───────────────────────────────────────────────────
function obeCesty() {
  console.log('\nDoplácí se v obchodu i v dražbě');
  const volani = (TRADE.match(/doplatDluhZCeny\(/g) || []).length;
  ma(volani >= 4, 'pomocník se volá ze všech cest prodeje',
    volani + '× (1 definice + obchod, dražba, tržiště)');
  ma(/koupil_nick: req\.player\.nick[\s\S]{0,900}doplatDluhZCeny\(tx, prodavajici, m\.spot_id, m\.cena\)/.test(TRADE),
    'tržiště: doplácí se i tam');
  ma(/vyr\.prodavajicimu > 0[\s\S]{0,200}amount: vyr\.prodavajicimu/.test(TRADE),
    'a prodávající dostane až zbytek');
  ma(/predmet === 'pradlomat'[\s\S]{0,200}doplatDluhZCeny/.test(TRADE), 'obchod: jen u prádlomatu');
  ma(/d\.predmet === 'pradlomat'[\s\S]{0,200}doplatDluhZCeny/.test(TRADE), 'dražba: jen u prádlomatu');
  ma(/utrzil = vyr\.prodavajicimu/.test(TRADE), 'dražba platí prodávajícímu až zbytek');
  ma(/amount: prodavajicimu/.test(TRADE), 'a obchod taky');
  // Dluh musí být v nabídce i v dražbě, ne až v překvapení po zaplacení.
  ma(/dluh: d\.celkem/.test(TRADE) || /dluh: dl\.celkem/.test(TRADE), 'dluh se ukládá k nabídce');
  ma((TRADE.match(/dluh_banka/g) || []).length >= 2, 'a k dražbě taky');
}

// ─── 5. Hra: doručenka s doplacením ─────────────────────────────────────────
function hra() {
  console.log('\nHra umaže úvěr, hotovosti se to nedotkne');
  const src = telo(HRA, 'splatitUverMista');
  const ctx = vm.createContext({ Math, Number, console });
  vm.runInContext('var S = { loans: [], stats: {}, bank: 0, cash: 0 };'
    + 'function bankCap() { return 99999999; }'
    + 'function zapisDoplacene() {}'
    + 'function prepocitejDluh() {}'
    + src + '\nthis.F = splatitUverMista; this.STAV = function () { return S; };', ctx);
  const F = ctx.F;
  const S = () => ctx.STAV();

  S().loans = [{ spotId: 'hk-1', zbyva: 600000 }, { spotId: 'hk-1', zbyva: 400000 },
    { spotId: 'hk-2', zbyva: 900000 }];
  S().cash = 50000;
  const zbylo = F('hk-1', 1000000);
  ma(zbylo === 0, 'celá částka padla na úvěr', zbylo);
  ma(S().loans.length === 1 && S().loans[0].spotId === 'hk-2', 'úvěry na prodaném místě zmizely');
  ma(S().loans[0].zbyva === 900000, 'cizí místo se nedotklo');
  ma(S().cash === 50000, 'hotovost se nehýbe — peníze zůstaly v ceně');
  ma(S().bank === 1000000, 'splácením se uvolnil rámec', S().bank);

  // Cizí místo v seznamu první — ať se nepozná jen podle toho, že peníze došly.
  S().loans = [{ spotId: 'hk-9', zbyva: 900000 }, { spotId: 'hk-8', zbyva: 600000 }];
  S().cash = 0;
  F('hk-8', 600000);
  ma(S().loans.length === 1 && S().loans[0].spotId === 'hk-9' && S().loans[0].zbyva === 900000,
    'úvěr na cizím místě zůstane celý, i když stojí v seznamu první',
    JSON.stringify(S().loans));

  S().loans = [{ spotId: 'hk-3', zbyva: 200000 }];
  const prebytek = F('hk-3', 500000);
  ma(prebytek === 300000, 'co přebude, se vrátí volajícímu', prebytek);
  ma(!S().loans.length, 'a úvěr je pryč');

  S().loans = [{ spotId: 'hk-4', zbyva: 500000 }];
  const cast = F('hk-4', 200000);
  ma(cast === 0 && S().loans[0].zbyva === 300000, 'částečné doplacení úvěr jen zmenší');

  ma(F('', 100000) === 100000 && F('hk-4', 0) === 0, 'nesmysly nic neshodí');

  console.log('\nDoručenka uver_splatka');
  ma(/kind === 'uver_splatka'/.test(HRA), 'hra doručenku zná');
  ma(/splatitUverMista\(x\.spot_id, x\.amount/.test(HRA), 'a pošle ji do splácení místa');
  ma(/zbylo > 0[\s\S]{0,80}S\.cash \+= zbylo/.test(HRA), 'přebytek se vrátí do hotovosti');

  console.log('\nKupující dluh vidí');
  ma(/function dluhMistaHtml/.test(HRA), 'nabídka má blok o dluhu');
  ma(/dluhMistaHtml\(t\.data, t\.cena\)/.test(HRA), 'kreslí se u nabídky');
  ma(/dluhMistaHtml\(d\.data, cena\)/.test(HRA), 'i v okně dražby');
}

// ─── 5b. Kupující vidí, co se mu nabízí ─────────────────────────────────────
function coSeNabizi() {
  console.log('\nCo se vlastně nabízí');
  // Server musí k nabídce i k dražbě zapsat místo.
  // Čtyři místa, kde se místo skládá: nabídka, protinávrh, dražba a dopsání
  // při čtení seznamu. Když jedno vypadne, kupující zase kouká na prázdno.
  ma((TRADE.match(/misto: \{/g) || []).length === 4, 'místo se skládá na všech čtyřech cestách',
    (TRADE.match(/misto: \{/g) || []).length + ' ze 4');
  // Oba zápisy místa musí nést všechno, co kupující potřebuje.
  const bloky = [];
  let od = -1;
  while ((od = TRADE.indexOf('misto: {', od + 1)) >= 0) {
    let h = 0;
    for (let j = TRADE.indexOf('{', od); j < TRADE.length; j++) {
      if (TRADE[j] === '{') h++;
      else if (TRADE[j] === '}') { h--; if (!h) { bloky.push(TRADE.slice(od, j + 1)); break; } }
    }
  }
  ma(bloky.length === 4, 'našly se všechny zápisy místa', bloky.length);
  // A nabídka si to opravdu bere z evidence míst, ne odnikud.
  ma(/predmet === 'pradlomat'[\s\S]{0,400}gameSpotClaim\.findUnique[\s\S]{0,500}\bc \? \{ misto: \{/.test(TRADE),
    'nabídka čte místo z evidence a bez něj ho nevymýšlí');
  bloky.forEach((b, i) => {
    const chybi = ['name', 'model', 'area_key', 'score', 'rent', 'lat', 'lon', 'pozemek', 'cizi_zem']
      .filter((pole) => !new RegExp('\\b' + pole + ':').test(b));
    ma(!chybi.length, ['nabídka', 'protinávrh', 'dražba', 'seznam'][i] + ': jde ven všechno',
      chybi.join(', ') || '9 údajů');
  });

  const ctx = vm.createContext({ Math, Number, String, console,
    esc: (x) => String(x),
    tx: (k) => k,
    kcFull: (n) => String(Math.round(n)) + ' L$',
    mestoZKlice: (k) => (k === 'hradec-kralove' ? 'Hradec Králové' : String(k || '')),
    MODELS: { max: { name: 'MAX' }, mini: { name: 'MINI' } } });
  vm.runInContext(telo(HRA, 'mistoNabidkyHtml') + '\n' + telo(HRA, 'predmetPopis')
    + '\nthis.M = mistoNabidkyHtml; this.P = predmetPopis;', ctx);
  const M = ctx.M, P = ctx.P;

  const misto = { name: 'U Nemocnice', model: 'max', area_key: 'hradec-kralove',
    score: 88, rent: 12500, lat: 50.2, lon: 15.8, pozemek: false, cizi_zem: false };
  const h = M({ misto });
  ma(/U Nemocnice/.test(h), 'je vidět, které místo to je');
  ma(/Hradec Králové/.test(h), 'i ve kterém městě');
  ma(/MAX/.test(h), 'i jaký stroj tam stojí');
  ma(/88 \/ 100/.test(h), 'i jak dobré to místo je');
  ma(/12500 L\$/.test(h), 'i co se tam platí na nájmu');
  ma(/data-trmapa="50\.2,15\.8"/.test(h), 'a dá se to ukázat na mapě');

  const vlastni = M({ misto: Object.assign({}, misto, { pozemek: true, rent: 0 }) });
  ma(/hra\.vlastni_zem/.test(vlastni), 'na vlastní zemi se nájem neplatí');
  const cizi = M({ misto: Object.assign({}, misto, { pozemek: true, cizi_zem: true, rent: 9000 }) });
  ma(/9000 L\$/.test(cizi) && !/vlastni_zem/.test(cizi),
    'prodaná zem pod prádlomatem znamená nájem, ne vlastní zem');

  ma(M({}) === '' && M(null) === '', 'stará nabídka bez místa nic nekreslí');
  const bezMesta = M({ misto: { model: 'mini', rent: 0 } });
  ma(/MINI/.test(bezMesta), 'neúplné místo se nezahodí celé');

  ma(P({ predmet: 'pradlomat', data: { misto } }) === 'MAX · U Nemocnice',
    'nadpis nabídky řekne stroj i místo', P({ predmet: 'pradlomat', data: { misto } }));
  ma(P({ predmet: 'pradlomat', data: {} }) === 'hra.pradlomat_na_miste',
    'stará nabídka má pořád svůj původní nadpis');

  ma(/mistoNabidkyHtml\(t\.data\)/.test(HRA), 'kreslí se u nabídky');
  ma(/mistoNabidkyHtml\(d\.data\)/.test(HRA), 'i v okně dražby');
  ma(/data-trmapa\]/.test(HRA), 'a odkaz na mapu je napojený');
}

// ─── 5c. Čekající nabídky se dopisují při čtení ─────────────────────────────
async function priCteni() {
  console.log('\nStaré nabídky se dopíšou při čtení');
  const src = telo(TRADE, 'dopisMista');
  const claims = [{ spot_id: 'hk-1', player_id: 1, name: 'U Nemocnice', model: 'max',
    area_key: 'hradec-kralove', score: 88, rent: 12500, lat: 50.2, lon: 15.8,
    pozemek: false, pozemek_majitel_id: null }];
  const hraci = [{ id: 1, state: { loans: [{ spotId: 'hk-1', zbyva: 900000 }] } }];
  const pujcky = [{ zastava_spot: 'hk-1', borrower_id: 1, stav: 'bezi',
    mesicu: 4, splaceno: 0, splatka: 25000, urok: 0 },
    // Zástava po předchozím majiteli místa — na dnešním vlastníkovi nevázne.
    { zastava_spot: 'hk-1', borrower_id: 99, stav: 'bezi',
      mesicu: 10, splaceno: 0, splatka: 500000, urok: 0 }];
  const dotazy = [];
  let ptalSeNa = [];
  const prisma = {
    gameSpotClaim: { findMany: async (q) => { dotazy.push('claim');
      ptalSeNa = q.where.spot_id.in.slice();
      return claims.filter((c) => q.where.spot_id.in.indexOf(c.spot_id) >= 0); } },
    gamePlayer: { findMany: async () => { dotazy.push('hraci'); return hraci; } },
    gameLoan: { findMany: async () => { dotazy.push('pujcky'); return pujcky; } },
  };
  const ctx = vm.createContext({ prisma, DLUH, Math, Number, Set, Map, Object, Promise, console });
  vm.runInContext(src + '\nthis.F = dopisMista;', ctx);
  const F = ctx.F;

  const nabidky = [
    { predmet: 'pradlomat', spot_id: 'hk-1', stav: 'ceka', data: null },
    { predmet: 'pradlomat', spot_id: 'hk-1', stav: 'prijato', data: null },
    { predmet: 'karta', spot_id: null, stav: 'ceka', data: null },
    { predmet: 'pradlomat', spot_id: 'hk-pryc', stav: 'ceka', data: null },
    // Dvě čekající nabídky na totéž místo — server se smí zeptat jednou.
    { predmet: 'pradlomat', spot_id: 'hk-1', stav: 'ceka', data: null },
  ];
  await F(nabidky);
  const m = (nabidky[0].data || {}).misto;
  ma(!!m, 'nabídka bez zapsaného místa ho dostane při čtení');
  ma(m && m.name === 'U Nemocnice' && m.model === 'max', 'a je to to správné místo');
  ma(m && m.rent === 12500 && m.score === 88, 'i s nájmem a skóre');
  ma(nabidky[0].data.dluh === 1000000, 'dluh je banka i zástava dohromady',
    nabidky[0].data && nabidky[0].data.dluh);
  ma(nabidky[0].data.dluh_banka === 900000 && nabidky[0].data.dluh_zastava === 100000,
    'a je vidět, co je co');
  ma(nabidky[1].data === null, 'uzavřená nabídka se nepřepisuje');
  ma(nabidky[2].data === null, 'karta se nepřepisuje');
  ma(nabidky[3].data === null, 'místo, které zmizelo, nic nevymyslí');
  ma(dotazy.filter((x) => x === 'claim').length === 1, 'ptá se jednou za všechny, ne za každou',
    dotazy.join(', '));
  ma(ptalSeNa.length === new Set(ptalSeNa).size, 'a na totéž místo se neptá dvakrát',
    ptalSeNa.join(', '));
  ma(nabidky[4].data && nabidky[4].data.misto, 'druhá nabídka na totéž místo ho dostane taky');
  ma(nabidky[0].data.dluh_zastava === 100000,
    'zástava po předchozím majiteli se nezapočítá', nabidky[0].data.dluh_zastava);

  // Bez čekající nabídky prádlomatu se server neptá vůbec.
  dotazy.length = 0;
  await F([{ predmet: 'karta', stav: 'ceka', data: null }]);
  ma(!dotazy.length, 'bez prádlomatu se do databáze nesahá');
  await F([]);
  ma(true, 'prázdný seznam nic neshodí');

  ma(/const trades = rows\.map\(\(t\) => verejny\(t, me, F\)\);[\s\S]{0,80}await dopisMista\(trades\)/.test(TRADE),
    'seznam nabídek to volá');
  // Protinávrh je nová nabídka — musí si místo i dluh spočítat znovu.
  ma(/t\.predmet === 'pradlomat'[\s\S]{0,600}DLUH\.naMiste\(prisma, majitel, t\.spot_id\)/.test(TRADE),
    'protinávrh počítá místo i dluh znovu');
}

// ─── 6. Texty ───────────────────────────────────────────────────────────────
function texty() {
  console.log('\nTexty ve všech jazycích');
  const klice = ['hra.vlastni_zem', 'hra.ukazat_na_mape', 'hra.vazne_na_nem_uver', 'veta.uver_se_doplati_z_ceny', 'veta.uver_cena_nepokryje',
    'dor.zastava_prodana_pujcka_doplacena', 'dor.z_ceny_doplacena_pujcka',
    'dor.z_ceny_doplacen_uver', 'dor.zastava_zmizela_pujcka_bezi', 'dor.zaplatil_jsi_za'];
  ['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'].forEach((j) => {
    const o = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/' + j + '.json'), 'utf8'));
    const chybi = klice.filter((k) => !o[k]);
    ma(!chybi.length, j + ': všechny texty přeložené', chybi.join(', ') || klice.length + ' textů');
  });
  const cs = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/cs.json'), 'utf8'));
  ma(/\{penize:p1\}/.test(cs['veta.uver_se_doplati_z_ceny']), 'částka se formátuje jako peníze');
  ma(/\{penize:p2\}/.test(cs['veta.uver_se_doplati_z_ceny']), 'i to, co zbyde prodávajícímu');
}

(async () => {
  cojevazne();
  deleni();
  await server();
  obeCesty();
  hra();
  coSeNabizi();
  await priCteni();
  texty();
  console.log(chyb ? '\n' + chyb + ' CHYB' : '\nVšechno sedí.');
  process.exit(chyb ? 1 : 0);
})();
