// Investiční aliance.
//
// Aliance posouvá práva ve firmě z jednoho člověka na blok. Když se tu něco
// splete, stane se jedna ze dvou věcí: buď někdo dostane moc nad cizí firmou,
// na kterou nemá, nebo o ni naopak přijde ten, kdo ji poctivě má. Obojí se
// pozná až ve chvíli, kdy je pozdě.
const A = require('../services/game/aliance');
const PRAVA = require('../services/game/prava');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const skoro = (a, b) => Math.abs(a - b) < 1e-9;
// Kdo v seznamu drží kolik po sloučení.
const drzi = (l, id) => (l.find((e) => e.investor_id === id) || {}).podil;

// ── Mluvčí ───────────────────────────────────────────────────────────────────
let podily = [
  { investor_id: 7, podil: 0.1 },
  { investor_id: 8, podil: 0.3 },
  { investor_id: 9, podil: 0.2 },
];
ok('za blok mluví ten, kdo v té firmě drží nejvíc',
  A.mluvci([7, 8, 9], podily) === 8);
ok('člen bez podílu v téhle firmě mluvčím není',
  A.mluvci([7, 8, 9], [{ investor_id: 7, podil: 0.1 }]) === 7);
ok('aliance bez podílu v téhle firmě nemá mluvčího',
  A.mluvci([7, 8], [{ investor_id: 9, podil: 0.5 }]) === null);
// Shoda nesmí záviset na pořadí řádek z databáze.
ok('při shodě rozhoduje nižší id, ne pořadí',
  A.mluvci([9, 7], [{ investor_id: 9, podil: 0.2 }, { investor_id: 7, podil: 0.2 }]) === 7
  && A.mluvci([7, 9], [{ investor_id: 7, podil: 0.2 }, { investor_id: 9, podil: 0.2 }]) === 7);

// ── Sloučení podílů ──────────────────────────────────────────────────────────
// Tři po deseti procentech: sami nezmůžou nic, dohromady blokují.
podily = [
  { investor_id: 7, podil: 0.1 },
  { investor_id: 8, podil: 0.1 },
  { investor_id: 9, podil: 0.1 },
];
let clenstvi = new Map([[7, 1], [8, 1], [9, 1]]);
let slouceno = A.slucPodily(podily, clenstvi);
ok('blok drží součet, mluvčí ho má celý', skoro(drzi(slouceno, 7), 0.3),
  '— ' + drzi(slouceno, 7));
ok('ostatní členové drží v přepočtu nulu',
  drzi(slouceno, 8) === 0 && drzi(slouceno, 9) === 0);
ok('sami na blokaci nedosáhli',
  !PRAVA.smiBlokovat(podily, 7) && !PRAVA.smiBlokovat(podily, 8));
ok('v alianci blokuje mluvčí', PRAVA.smiBlokovat(slouceno, 7) === true);
ok('a ostatní členové ne — blok mluví jedním hlasem',
  PRAVA.smiBlokovat(slouceno, 8) === false);

// Většina dohromady.
podily = [{ investor_id: 7, podil: 0.3 }, { investor_id: 8, podil: 0.3 }];
clenstvi = new Map([[7, 1], [8, 1]]);
slouceno = A.slucPodily(podily, clenstvi);
ok('dva po třiceti procentech určují dohromady výplatu zisku',
  PRAVA.kdoUrcuje(slouceno) === 7 && PRAVA.kdoUrcuje(podily) === null);

// Kdo v alianci není, zůstává sám za sebe.
podily = [{ investor_id: 7, podil: 0.3 }, { investor_id: 8, podil: 0.3 },
  { investor_id: 9, podil: 0.26 }];
slouceno = A.slucPodily(podily, new Map([[7, 1], [8, 1]]));
ok('nečlen si svůj podíl i svoje právo nechává',
  skoro(drzi(slouceno, 9), 0.26) && PRAVA.smiBlokovat(slouceno, 9) === true);

// Dvě aliance v jedné firmě se nesmí slít dohromady.
podily = [{ investor_id: 7, podil: 0.2 }, { investor_id: 8, podil: 0.2 },
  { investor_id: 9, podil: 0.3 }, { investor_id: 10, podil: 0.3 }];
slouceno = A.slucPodily(podily, new Map([[7, 1], [8, 1], [9, 2], [10, 2]]));
ok('každá aliance má svůj vlastní součet',
  skoro(drzi(slouceno, 7), 0.4) && skoro(drzi(slouceno, 9), 0.6),
  '— první ' + drzi(slouceno, 7) + ', druhá ' + drzi(slouceno, 9));
ok('a většinu má ta větší', PRAVA.kdoUrcuje(slouceno) === 9);

// Dva podíly téhož člena se sčítají stejně jako dřív.
slouceno = A.slucPodily([{ investor_id: 7, podil: 0.2 }, { investor_id: 7, podil: 0.2 },
  { investor_id: 8, podil: 0.2 }], new Map([[7, 1], [8, 1]]));
ok('víc řádek jednoho člena nerozbije součet',
  skoro(PRAVA.souhrn(slouceno).find((e) => e.investor_id === 7).podil, 0.6),
  '— ' + PRAVA.souhrn(slouceno).find((e) => e.investor_id === 7).podil);

// ── Zákaz zástavy v bloku ────────────────────────────────────────────────────
// Zákaz si zapíná člen, ale vykonává ho blok: jinak by stačilo mít v alianci
// jednoho člena se zapnutým zákazem a nikdo by nevěděl, čí to je.
podily = [{ investor_id: 7, podil: 0.1 }, { investor_id: 8, podil: 0.2, zakaz: true }];
slouceno = A.slucPodily(podily, new Map([[7, 1], [8, 1]]));
ok('zákaz kteréhokoli člena platí pro celý blok',
  PRAVA.kdoBlokuje(slouceno) === 8, '— ' + PRAVA.kdoBlokuje(slouceno));
ok('sám by na blokaci nedosáhl', PRAVA.kdoBlokuje(podily) === null);

// ── Co se posílá majiteli ────────────────────────────────────────────────────
podily = [{ investor_id: 7, podil: 0.2 }, { investor_id: 8, podil: 0.15 },
  { investor_id: 9, podil: 0.4 }];
const s = A.souhrn(podily, new Map([[7, 1], [8, 1]]));
ok('majitel vidí jeden blok, ne dva lidi',
  s.length === 1 && s[0].clenu === 2 && skoro(s[0].podil, 0.35),
  '— ' + JSON.stringify(s));
ok('a ví, s kým se má bavit', s[0].mluvci === 7);
ok('hráč mimo alianci se v přehledu bloků neobjeví',
  !s.some((x) => x.aliance_id == null));

// ── Nesmysly na vstupu ───────────────────────────────────────────────────────
ok('bez členství se nic nemění',
  A.slucPodily(podily, new Map()).every((e, i) => e.podil === podily[i].podil));
ok('prázdné podíly nic neshodí',
  A.slucPodily(null, new Map([[7, 1]])).length === 0 && A.souhrn(null, null).length === 0);
ok('sloučení nesahá na původní seznam', skoro(podily[1].podil, 0.15));

// ── Název a velikost ─────────────────────────────────────────────────────────
ok('název se ořeže a zdvojené mezery zmizí', A.nazevOk('  Severní   blok ') === 'Severní blok');
ok('jedno písmeno nestačí', A.nazevOk('x') === null);
ok('příliš dlouhý název neprojde', A.nazevOk('x'.repeat(A.NAZEV_MAX + 1)) === null);
ok('prázdný název neprojde', A.nazevOk('   ') === null && A.nazevOk(null) === null);
ok('pět členů je strop', A.jeMisto(A.MAX_CLENU - 1) === true && A.jeMisto(A.MAX_CLENU) === false);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
