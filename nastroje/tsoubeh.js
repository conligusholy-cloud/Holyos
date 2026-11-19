// Souběh: dva lidé ve stejné vteřině.
//
// Nejdražší chyby v burze nejsou ve vzorcích — ty jsou otestované. Jsou v tom,
// co se stane, když dva lidé kliknou zároveň. Obsluha si načte nabídku,
// spočítá, kolik zbývá, a teprve pak zapíše; trefí-li se druhý do té mezery,
// projde kontrola dvakrát a zapíše se to dvakrát. Jeden podíl se převede dvěma
// lidem, peníze se vyplatí dvakrát — a pozná se to až ve chvíli, kdy někdo
// sečte procenta a vyjde mu sto dvacet.
//
// Tenhle test proto nezkouší vzorce. Pustí SKUTEČNOU obsluhu z
// routes/game-trade.routes.js proti podstrčené databázi, která umí jednu věc
// navíc: na povel uspí první požadavek přesně mezi čtením a zápisem, nechá
// doběhnout druhý a první pak probudí. Přesně ta vteřina, která se v provozu
// nedá nasimulovat a z logu se pozná pozdě.
'use strict';

const Module = require('module');

// ── Podstrčená databáze ──────────────────────────────────────────────────────
// Umí jen to, co obsluha potřebuje, zato se chová jako databáze v tom, na čem
// tady všechno stojí: zápis vidí data tak, jak jsou TEĎ, podmíněný zápis vrací
// počet skutečně změněných řádků, a spadlá transakce po sobě nic nenechá.
const T = {};                       // tabulky: název → pole řádků
const POSLEDNI = {};                // čítače id
let hak = null;                     // uspání před prvním zápisem

const kopie = (x) => JSON.parse(JSON.stringify(x));
function sedi(radek, kde) {
  return Object.keys(kde || {}).every((k) => {
    const v = kde[k];
    if (k === 'OR') return v.some((p) => sedi(radek, p));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.indexOf(radek[k]) >= 0;
      if ('not' in v) return v.not === null ? radek[k] != null : radek[k] !== v.not;
      if ('gt' in v) return radek[k] > v.gt;
      if ('gte' in v) return radek[k] >= v.gte;
      if ('lt' in v) return radek[k] < v.lt;
      if ('lte' in v) return radek[k] <= v.lte;
      return true;
    }
    return radek[k] === v;
  });
}

// Model nad jednou tabulkou. `zurnal` je seznam vratných kroků TÉHLE
// transakce — spadlá transakce vrací zpátky jen své vlastní zápisy, ne celou
// tabulku. Na tom to celé stojí: kdyby se vracel celý obraz tabulky, smazala
// by spadlá transakce i to, co mezitím poctivě zapsal ten druhý, a test by
// vyčítal kódu chybu, kterou udělala tahle atrapa.
function model(nazev, zurnal) {
  if (!T[nazev]) { T[nazev] = []; POSLEDNI[nazev] = 0; }
  const najdi = (kde) => T[nazev].filter((r) => sedi(r, kde));
  // Každý zápis je místo, kde se dá uspat. Čtení ne — zkouší se mezera mezi
  // načtením a zápisem, ne mezi dvěma čteními.
  const pred = async () => { if (hak) { const h = hak; hak = null; await h(nazev); } };
  const vratit = (fn) => { if (zurnal) zurnal.push(fn); };
  const zapisuji = (radky) => radky.forEach((r) => {
    const puv = Object.assign({}, r);
    vratit(() => { Object.keys(r).forEach((k) => { delete r[k]; }); Object.assign(r, puv); });
  });
  const pribyl = (r) => vratit(() => {
    const i = T[nazev].indexOf(r);
    if (i >= 0) T[nazev].splice(i, 1);
  });
  return {
    findUnique: async ({ where }) => { const r = najdi(where)[0]; return r ? kopie(r) : null; },
    findFirst: async ({ where }) => { const r = najdi(where)[0]; return r ? kopie(r) : null; },
    findMany: async ({ where } = {}) => najdi(where || {}).map(kopie),
    count: async ({ where } = {}) => najdi(where || {}).length,
    create: async ({ data }) => {
      await pred();
      const r = Object.assign({ id: ++POSLEDNI[nazev] }, data);
      T[nazev].push(r); pribyl(r); return kopie(r);
    },
    createMany: async ({ data }) => {
      await pred();
      (data || []).forEach((d) => {
        const r = Object.assign({ id: ++POSLEDNI[nazev] }, d);
        T[nazev].push(r); pribyl(r);
      });
      return { count: (data || []).length };
    },
    update: async ({ where, data }) => {
      await pred();
      const r = najdi(where)[0];
      if (!r) throw new Error('update: řádek nenalezen v ' + nazev);
      zapisuji([r]); Object.assign(r, data); return kopie(r);
    },
    updateMany: async ({ where, data }) => {
      await pred();
      const l = najdi(where);
      zapisuji(l); l.forEach((r) => Object.assign(r, data));
      return { count: l.length };
    },
    delete: async ({ where }) => {
      await pred();
      const i = T[nazev].findIndex((r) => sedi(r, where));
      if (i >= 0) {
        const r = T[nazev][i];
        T[nazev].splice(i, 1);
        vratit(() => T[nazev].splice(i, 0, r));
      }
      return {};
    },
  };
}
function klient(zurnal) {
  return new Proxy({
    $transaction: async (fn) => {
      // Vlastní žurnál: na konci platí buď všechny zápisy téhle transakce,
      // nebo žádný — a cizí zápisy zůstanou, ať to dopadne jakkoli.
      const j = [];
      try {
        return await fn(klient(j));
      } catch (e) {
        j.reverse().forEach((vrat) => vrat());
        throw e;
      }
    },
  }, { get: (cil, k) => (k in cil ? cil[k] : model(k, zurnal)) });
}
const prisma = klient(null);

const puvodni = Module.prototype.require;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) return { prisma };
  return puvodni.apply(this, arguments);
};
const ROUTER = require('../routes/game-trade.routes.js');
const PRAVA = require('../services/game/prava');
const ALIANCE = require('../services/game/aliance');
Module.prototype.require = puvodni;

// ── Volání obsluhy ───────────────────────────────────────────────────────────
// Přihlášení se přeskakuje a hráč se dodá rovnou: zkouší se souběh, ne vstup.
function obsluha(cesta) {
  const l = ROUTER.stack.filter((x) => x.route && x.route.path === cesta && x.route.methods.post)[0];
  if (!l) throw new Error('obsluha nenalezena: ' + cesta);
  return l.route.stack[l.route.stack.length - 1].handle;
}
function zavolej(cesta, hrac, params, body) {
  return new Promise((hotovo, chyba) => {
    const res = {
      status(k) { this._k = k; return this; },
      json(j) { hotovo({ stav: this._k || 200, telo: j }); return this; },
    };
    obsluha(cesta)({ player: hrac, params, body: body || {} }, res, chyba);
  });
}
// Necháme doběhnout, co je rozpracované, až k uspání.
const chvilku = () => new Promise((r) => setTimeout(r, 0));

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const hrac = (id, nick, cash) => ({ id, nick, company: nick + ' s.r.o.', jazyk: 'cs',
  disabled: false, state: { cash } });
function vycisti() {
  Object.keys(T).forEach((k) => { delete T[k]; delete POSLEDNI[k]; });
  hak = null;
}
// Atrapa nedoplňuje výchozí hodnoty ze schématu, takže nově založený řádek
// přijde bez stavu — v databázi by měl „bezi".
const bezici = (e) => (e.stav || 'bezi') === 'bezi';
const soucetPodilu = (f) => (T.gameEquity || [])
  .filter((e) => e.firma_id === f && bezici(e)).reduce((a, e) => a + e.podil, 0);
const drzi = (f, kdo) => (T.gameEquity || [])
  .filter((e) => e.firma_id === f && e.investor_id === kdo && bezici(e))
  .reduce((a, e) => a + e.podil, 0);
const hotovostnich = () => (T.gameDelivery || []).filter((d) => d.kind === 'cash').length;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Dva podílníci prodávají do jedné nabídky ve stejnou vteřinu
// ─────────────────────────────────────────────────────────────────────────────
// Nabídka na 60 %, dva podílníci po 50 %. Oba kliknou „prodat vše". Bez zámku
// si oba přečtou „zbývá 60" a oba zapíšou převod: útočník vykoupí sto procent,
// i když nabídl šedesát — a zaplatí za šedesát.
async function dvaDoJedne() {
  vycisti();
  const utocnik = hrac(1, 'Utocnik', 100000000);
  const a = hrac(2, 'Anna', 0), b = hrac(3, 'Bedrich', 0);
  T.gamePlayer = [utocnik, a, b]; POSLEDNI.gamePlayer = 3;
  T.gameTender = [{ id: 10, utocnik_id: 1, utocnik_nick: 'Utocnik', firma_id: 9, firma_nick: 'Cil',
    cena_za_pct: 10000, max_pct: 0.6, koupeno_pct: 0, stav: 'bezi',
    do: new Date(Date.now() + 86400000), trvala: false }];
  POSLEDNI.gameTender = 10;
  T.gameEquity = [
    { id: 1, firma_id: 9, firma_nick: 'Cil', investor_id: 2, investor_nick: 'Anna',
      podil: 0.5, cena: 0, vyplaceno: 0, stav: 'bezi', dalsi_at: null },
    { id: 2, firma_id: 9, firma_nick: 'Cil', investor_id: 3, investor_nick: 'Bedrich',
      podil: 0.5, cena: 0, vyplaceno: 0, stav: 'bezi', dalsi_at: null },
  ];
  POSLEDNI.gameEquity = 2;

  let pustit; const brana = new Promise((r) => { pustit = r; });
  let uspano = false;
  hak = async () => { uspano = true; await brana; };

  const prvni = zavolej('/trade/prevzeti/:id/prodat', a, { id: '10' }, {});
  await chvilku();
  ok('první prodávající se uspal mezi čtením a zápisem', uspano);

  const druhy = await zavolej('/trade/prevzeti/:id/prodat', b, { id: '10' }, {});
  pustit();
  const prvniV = await prvni;

  const koupeno = T.gameTender[0].koupeno_pct;
  ok('druhý prodávající prošel', druhy.stav === 200, JSON.stringify(druhy.telo));
  ok('první dostal odmítnutí, ne tichý převod', prvniV.stav === 409,
    prvniV.stav + ' · ' + JSON.stringify(prvniV.telo));
  ok('nabídka nevykoupila víc, než nabídla', koupeno <= 0.6 + 1e-9,
    'koupeno ' + Math.round(koupeno * 100) + ' % ze stropu 60 %');
  ok('útočník drží přesně to, co má nabídka zapsané',
    Math.abs(drzi(9, 1) - koupeno) < 1e-9,
    'drží ' + Math.round(drzi(9, 1) * 100) + ' %, zapsáno ' + Math.round(koupeno * 100) + ' %');
  ok('firma pořád dává sto procent', Math.abs(soucetPodilu(9) - 1) < 1e-9,
    Math.round(soucetPodilu(9) * 100) + ' %');
  ok('po spadlé transakci nezůstala doručenka navíc', hotovostnich() === 2,
    hotovostnich() + ' doručenek na hotovost');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Jeden podílník prodává týž podíl do dvou nabídek najednou
// ─────────────────────────────────────────────────────────────────────────────
// Nad jednou firmou smí běžet víc nabídek — to je schválně. Podílník má 30 % a
// pustí je do obou. Bez zámku na řádku se z třiceti procent převede šedesát:
// oba útočníci dostanou svých třicet a podílníkovi zůstane nula.
async function jedenDoDvou() {
  vycisti();
  const u1 = hrac(1, 'Utocnik1', 100000000), u2 = hrac(2, 'Utocnik2', 100000000);
  const a = hrac(3, 'Anna', 0);
  T.gamePlayer = [u1, u2, a]; POSLEDNI.gamePlayer = 3;
  const nabidka = (id, uid, nick) => ({ id, utocnik_id: uid, utocnik_nick: nick,
    firma_id: 9, firma_nick: 'Cil', cena_za_pct: 10000, max_pct: 1, koupeno_pct: 0,
    stav: 'bezi', do: new Date(Date.now() + 86400000), trvala: false });
  T.gameTender = [nabidka(10, 1, 'Utocnik1'), nabidka(11, 2, 'Utocnik2')];
  POSLEDNI.gameTender = 11;
  T.gameEquity = [{ id: 1, firma_id: 9, firma_nick: 'Cil', investor_id: 3,
    investor_nick: 'Anna', podil: 0.3, cena: 0, vyplaceno: 0, stav: 'bezi', dalsi_at: null }];
  POSLEDNI.gameEquity = 1;

  let pustit; const brana = new Promise((r) => { pustit = r; });
  hak = async () => { await brana; };
  const prvni = zavolej('/trade/prevzeti/:id/prodat', a, { id: '10' }, {});
  await chvilku();
  const druhy = await zavolej('/trade/prevzeti/:id/prodat', a, { id: '11' }, {});
  pustit();
  const prvniV = await prvni;

  const u1drzi = drzi(9, 1), u2drzi = drzi(9, 2), zbylo = drzi(9, 3);
  ok('prošla právě jedna z obou nabídek',
    (druhy.stav === 200) !== (prvniV.stav === 200),
    'první ' + prvniV.stav + ' · druhý ' + druhy.stav);
  ok('podíl se neprodal dvakrát', Math.abs((u1drzi + u2drzi) - 0.3) < 1e-9,
    'útočníci drží dohromady ' + Math.round((u1drzi + u2drzi) * 100) + ' % z nabízených 30 %');
  ok('prodávajícímu nic nepřebylo ani nechybí', Math.abs(zbylo) < 1e-9,
    'zbylo ' + Math.round(zbylo * 100) + ' %');
  // Majitelových sedmdesát procent žádný řádek nemá — je to zbytek do sta.
  // Hlídá se tedy to, co řádky říkají: pořád dohromady třicet, jen u jiných lidí.
  ok('prodaných procent nepřibylo ani neubylo', Math.abs(soucetPodilu(9) - 0.3) < 1e-9,
    Math.round(soucetPodilu(9) * 100) + ' % v řádcích místo 30 %');
  // Kdyby se zápis jen přepsal, vyjdou procenta pořád na třicet — jen je drží
  // ten druhý útočník a první zaplatil za nic. Platby to prozradí.
  ok('zaplatil jen ten, kdo podíl dostal', hotovostnich() === 2,
    hotovostnich() + ' doručenek na hotovost, útočníci drží '
    + Math.round(u1drzi * 100) + ' % a ' + Math.round(u2drzi * 100) + ' %');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Jedna nabídka přijatá dvakrát
// ─────────────────────────────────────────────────────────────────────────────
// Dvojklik na „přijmout", nebo dvě otevřená okna. Bez zámku se podíl vydá
// dvakrát a cena vyplatí dvakrát z jedné nabídky.
async function dvakratPrijato() {
  vycisti();
  const majitel = hrac(1, 'Majitel', 0), investor = hrac(2, 'Investor', 100000000);
  T.gamePlayer = [majitel, investor]; POSLEDNI.gamePlayer = 2;
  T.gameTrade = [{ id: 7, from_id: 1, from_nick: 'Majitel', to_id: 2, to_nick: 'Investor',
    smer: 'prodam', predmet: 'podil', cena: 50000, karty: [], stav: 'ceka',
    data: { podil: 0.2 }, created_at: new Date() }];
  POSLEDNI.gameTrade = 7;
  T.gameEquity = []; POSLEDNI.gameEquity = 0;

  let pustit; const brana = new Promise((r) => { pustit = r; });
  hak = async () => { await brana; };
  const prvni = zavolej('/trade/:id/accept', investor, { id: '7' }, {});
  await chvilku();
  const druhy = await zavolej('/trade/:id/accept', investor, { id: '7' }, {});
  pustit();
  const prvniV = await prvni;

  const radku = (T.gameEquity || []).length;
  ok('nabídka se přijala jen jednou', (druhy.stav === 200) !== (prvniV.stav === 200),
    'první ' + prvniV.stav + ' · druhý ' + druhy.stav);
  ok('podíl se vydal jednou', radku === 1, radku + ' řádků podílu');
  ok('zaplatilo se jednou', hotovostnich() === 2, hotovostnich() + ' doručenek na hotovost');
  ok('nabídka je přijatá, ne pořád čekající', T.gameTrade[0].stav === 'prijato',
    T.gameTrade[0].stav);
  ok('vydalo se přesně dvacet procent', Math.abs(drzi(1, 2) - 0.2) < 1e-9,
    Math.round(drzi(1, 2) * 100) + ' %');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Řetězové vlastnictví
// ─────────────────────────────────────────────────────────────────────────────
// A drží kus B, B drží kus C a C drží kus A — kruh. Hra schválně NEPOČÍTÁ
// skrz: podíl dává hlas v té firmě, ne ve firmách, které ta firma drží. Kdyby
// se počítalo skrz, dal by se vliv řetězit donekonečna a kruh by výpočet
// zacyklil. Tohle drží obojí na místě.
function retez() {
  const radky = [
    { firma_id: 1, investor_id: 2, podil: 0.6 },   // 2 drží 60 % firmy 1
    { firma_id: 2, investor_id: 3, podil: 0.6 },   // 3 drží 60 % firmy 2
    { firma_id: 3, investor_id: 1, podil: 0.6 },   // a kruh se uzavírá
  ];
  const zacatek = Date.now();
  const v = [1, 2, 3].map((f) => {
    const lide = PRAVA.souhrn(radky.filter((r) => r.firma_id === f));
    return { firma: f, lide, urcuje: PRAVA.kdoUrcuje(lide) };
  });
  ok('kruhové vlastnictví výpočet nezacyklí', Date.now() - zacatek < 1000);
  ok('v každé firmě rozhoduje jen její přímý podílník',
    v[0].urcuje === 'h:2' && v[1].urcuje === 'h:3' && v[2].urcuje === 'h:1',
    v.map((x) => x.firma + '→' + x.urcuje).join(' · '));
  ok('vliv se neřetězí: kdo drží matku, nemá hlas ve vnučce',
    v.every((x) => x.lide.length === 1),
    v.map((x) => x.firma + ': ' + x.lide.length + ' podílník').join(' · '));
  // A totéž, když jsou všichni tři v jedné alianci: blok sečte podíly v JEDNÉ
  // firmě, ne napříč řetězem.
  const clenstvi = new Map([[1, 100], [2, 100], [3, 100]]);
  const blok = ALIANCE.slucPodily(PRAVA.souhrn(radky.filter((r) => r.firma_id === 1)), clenstvi);
  const celkem = blok.reduce((a, e) => a + e.podil, 0);
  ok('aliance sečte jen podíly v té jedné firmě', Math.abs(celkem - 0.6) < 1e-9,
    Math.round(celkem * 100) + ' %');
}

(async () => {
  await dvaDoJedne();
  await jedenDoDvou();
  await dvakratPrijato();
  retez();
  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})().catch((e) => { console.log('CHYBA ' + ((e && e.stack) || e)); process.exit(1); });
