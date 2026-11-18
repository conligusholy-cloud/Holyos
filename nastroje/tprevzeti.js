// Veřejná nabídka na odkup podílů.
//
// Je to obrazovka, kde jde o cizí firmu a cizí peníze. Jediná špatně
// spočítaná cena za procento znamená, že někdo prodal půlku firmy za cenu
// oběda — a zpátky se to nevezme.
const P = require('../services/game/prevzeti');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const ZA_HODINU = new Date(Date.now() + 3600000);
const PRED_HODINOU = new Date(Date.now() - 3600000);
function nabidka(o) {
  return Object.assign({ id: 1, utocnik_id: 7, utocnik_nick: 'Útok', firma_id: 9,
    firma_nick: 'Cíl', cena_za_pct: 100000, max_pct: 0.3, koupeno_pct: 0,
    do: ZA_HODINU, stav: 'bezi' }, o || {});
}

// ── Cena za procento, ne za podíl ────────────────────────────────────────────
// Tady se dá splést řád: podíl je 0,3, ale platí se za 30 procent.
ok('deset procent za cenu 100 000 za procento stojí milion',
  P.cenaZa(nabidka({}), 0.1) === 1000000, '— ' + P.cenaZa(nabidka({}), 0.1));
ok('celá firma stojí stonásobek ceny za procento',
  P.cenaZa(nabidka({}), 1) === 10000000, '— ' + P.cenaZa(nabidka({}), 1));
ok('nulový podíl nestojí nic', P.cenaZa(nabidka({}), 0) === 0);
ok('procenta se zaokrouhlují na celé koruny',
  Number.isInteger(P.cenaZa(nabidka({ cena_za_pct: 33333 }), 0.137)));

// ── Stav nabídky ─────────────────────────────────────────────────────────────
ok('běžící nabídka běží', P.stav(nabidka({})) === 'bezi');
ok('po lhůtě je doběhlá', P.stav(nabidka({ do: PRED_HODINOU })) === 'dobehla');
ok('vykoupená je naplněná',
  P.stav(nabidka({ koupeno_pct: 0.3 })) === 'naplnena');
ok('skoro vykoupená pořád běží',
  P.stav(nabidka({ koupeno_pct: 0.29 })) === 'bezi');
ok('zrušená zůstane zrušená',
  P.stav(nabidka({ stav: 'zrusena' })) === 'zrusena');
ok('doběhnutí má přednost před naplněním',
  P.stav(nabidka({ do: PRED_HODINOU, koupeno_pct: 0.3 })) === 'dobehla');

// ── Kolik ještě jde prodat ───────────────────────────────────────────────────
ok('z třiceti procent po deseti zbývá dvacet',
  Math.abs(P.zbyva(nabidka({ koupeno_pct: 0.1 })) - 0.2) < 1e-9,
  '— ' + P.zbyva(nabidka({ koupeno_pct: 0.1 })));
ok('přeprodaná nabídka nedá záporný zbytek',
  P.zbyva(nabidka({ koupeno_pct: 0.5 })) === 0);

// ── Co se posílá ven ─────────────────────────────────────────────────────────
let v = P.verejna(nabidka({}), 7);
ok('útočník pozná svou nabídku', v.moje === true && v.na_moji_firmu === false);
v = P.verejna(nabidka({}), 9);
ok('cíl pozná, že je na něj', v.na_moji_firmu === true && v.moje === false);
v = P.verejna(nabidka({}), 3);
ok('cizí hráč nemá ani jedno', v.moje === false && v.na_moji_firmu === false);
ok('ven jde cena, lhůta i kolik zbývá',
  v.cena_za_pct === 100000 && v.zbyva_pct === 0.3 && !!v.do);

// ── Meze ─────────────────────────────────────────────────────────────────────
ok('lhůta má dolní i horní mez', P.HODIN_MIN >= 1 && P.HODIN_MAX <= 168
  && P.HODIN_VYCHOZI >= P.HODIN_MIN && P.HODIN_VYCHOZI <= P.HODIN_MAX);
ok('podíl se kupuje po procentech, ne po tisícinách', P.PCT_MIN >= 0.01);
ok('cena za procento má dno', P.CENA_MIN > 0);

// ── Výstupní nabídka nad 75 % ────────────────────────────────────────────────
// Trvalá nabídka je jediná, která nemá konec. Kdyby jí lhůta přece jen
// doběhla, zmizela by přesně tomu, kvůli komu vznikla — hráči, co byl pryč.
ok('trvalá nabídka nedoběhne ani po lhůtě',
  P.stav(nabidka({ trvala: true, do: null })) === 'bezi');
ok('trvalá se dá naplnit a zrušit jako každá jiná',
  P.stav(nabidka({ trvala: true, do: null, koupeno_pct: 0.3 })) === 'naplnena'
  && P.stav(nabidka({ trvala: true, do: null, stav: 'zrusena' })) === 'zrusena');
ok('obyčejná nabídka po lhůtě pořád doběhne',
  P.stav(nabidka({ do: PRED_HODINOU })) === 'dobehla');
ok('ven jde, že je trvalá, a lhůta chybí',
  P.verejna(nabidka({ trvala: true, do: null }), 3).trvala === true
  && P.verejna(nabidka({ trvala: true, do: null }), 3).do === null);
ok('u obyčejné zůstává trvalá vypnutá', P.verejna(nabidka({}), 3).trvala === false);

ok('práh na výstupní nabídku jsou tři čtvrtiny', P.PRAH_VYSTUPNI === 0.75);
ok('kdo má tři čtvrtiny, smí ji vyhlásit',
  P.smiVystupni([{ investor_id: 7, podil: 0.75 }], 7) === true);
ok('o setinu míň už ne',
  P.smiVystupni([{ investor_id: 7, podil: 0.74 }], 7) === false);
ok('podíly se sčítají na člověka',
  P.smiVystupni([{ investor_id: 7, podil: 0.4 }, { investor_id: 7, podil: 0.4 }], 7) === true);
ok('cizí podíly se mu nepřičítají',
  P.smiVystupni([{ investor_id: 7, podil: 0.4 }, { investor_id: 8, podil: 0.4 }], 7) === false);
ok('nepřihlášený nikdy', P.smiVystupni([{ investor_id: 7, podil: 0.9 }], null) === false);

// Cena pod oceněním by z nabídky na odchod udělala pokutu za to, že někdo
// zůstal v menšině.
ok('nejnižší cena je setina jmění firmy', P.minCenaZaPct(10000000) === 100000,
  '— ' + P.minCenaZaPct(10000000));
ok('ani u bezcenné firmy neklesne pod dno', P.minCenaZaPct(0) === P.CENA_MIN);
ok('záporné jmění taky spadne na dno', P.minCenaZaPct(-5000000) === P.CENA_MIN);
ok('nesmysl nespadne na nulu', P.minCenaZaPct('kdoví') === P.CENA_MIN);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
