// Kdo drží podíl: hráč, nebo fond aliance.
//
// Tohle je pojistka proti chybě, která by byla neviditelná a drahá. Podíl
// patřil vždycky hráči; od chvíle, kdy do firem investuje i fond, můžou ve
// firmě sedět oba vedle sebe. Kdyby se někde sečetly podle investor_id,
// fondu by se podíl ztratil — a protože podíl rozhoduje o většině i o
// výplatách, byla by to krádež na splátky.
//
// Druhá část testu projde VŠECHNY moduly, které podíly sčítají, a ověří
// dvě věci: že se bez fondu nic nezměnilo, a že s fondem nic nezmizí.
const D = require('../services/game/drzitel');
const PRAVA = require('../services/game/prava');
const PODILY = require('../services/game/podily');
const DIVIDENDA = require('../services/game/dividenda');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Klíč ─────────────────────────────────────────────────────────────────────
ok('hráč má klíč h:', D.klic({ investor_id: 17 }) === 'h:17');
ok('fond má klíč f:', D.klic({ fond_id: 3, investor_id: null }) === 'f:3');
// Tohle je ta past: hráč 3 a fond 3 jsou dvě různé věci.
ok('hráč 3 a fond 3 se nepotkají',
  D.klic({ investor_id: 3 }) !== D.klic({ fond_id: 3 }));
ok('fond přebíjí investor_id, když tam zbyde',
  D.klic({ fond_id: 3, investor_id: 9 }) === 'f:3');
// Nula je platné id — nesmí spadnout do „nemá držitele".
ok('id nula je pořád držitel', D.klic({ investor_id: 0 }) === 'h:0');
ok('podíl bez držitele vrací null', D.klic({ investor_id: null }) === null);
ok('prázdný řádek vrací null', D.klic(null) === null);

ok('klíč se dá rozebrat zpátky',
  D.zKlice('f:3').typ === 'fond' && D.zKlice('f:3').id === 3);
ok('a u hráče taky',
  D.zKlice('h:17').typ === 'hrac' && D.zKlice('h:17').id === 17);
ok('nesmysl se nerozebere', D.zKlice('x') === null && D.zKlice(null) === null);

ok('fond se pozná', D.jeFond({ fond_id: 1 }) && !D.jeFond({ investor_id: 1 }));
ok('hráč se pozná', D.jeHrac({ investor_id: 1 }) && !D.jeHrac({ fond_id: 1 }));

// ── Součet po držitelích ─────────────────────────────────────────────────────
const smiseno = [
  { investor_id: 7, podil: 0.2 },
  { investor_id: 7, podil: 0.1 },     // jeden člověk, dva řádky
  { fond_id: 7, podil: 0.3 },         // fond se stejným id jako hráč
];
const m = D.soucet(smiseno);
ok('dva řádky jednoho člověka se sečtou', m.get('h:7') === 0.30000000000000004 || Math.abs(m.get('h:7') - 0.3) < 1e-9,
  '— ' + m.get('h:7'));
ok('fond se stejným id zůstane zvlášť', Math.abs(m.get('f:7') - 0.3) < 1e-9, '— ' + m.get('f:7'));
ok('a jsou to dva držitelé, ne jeden', m.size === 2, '— ' + m.size);
ok('podíl bez držitele se do součtu nedostane',
  D.soucet([{ podil: 0.5 }]).size === 0);

// Nic se neztratí: součet přes držitele = součet přes řádky.
const souctem = Array.from(D.soucet(smiseno).values()).reduce((a, x) => a + x, 0);
const radky = smiseno.reduce((a, e) => a + e.podil, 0);
ok('součet po držitelích se rovná součtu po řádcích',
  Math.abs(souctem - radky) < 1e-9, '— ' + souctem + ' vs ' + radky);

// ── Moduly, které podíly sčítají ─────────────────────────────────────────────
// Bez fondu se nesmí změnit vůbec nic — to je ta regrese, která by bolela.
const jenHraci = [{ investor_id: 1, podil: 0.6 }, { investor_id: 2, podil: 0.2 }];
ok('majitel je pořád zbytek do sta procent',
  Math.abs(PODILY.majitel(jenHraci) - 0.2) < 1e-9, '— ' + PODILY.majitel(jenHraci));
ok('ředění se nezměnilo',
  PODILY.redeni(jenHraci, 0.25)[0].podil === 0.6 * 0.75);
ok('většinu pozná jako dřív',
  PRAVA.kdoUrcuje(jenHraci.map((e) => ({ investor_id: e.investor_id, podil: e.podil }))) === 'h:1');
ok('dividenda se nezměnila', DIVIDENDA.castka(1000000, 0.6, 1) === 600000);

// S fondem: podíl fondu nesmí zmizet ze součtu ani z majitelova zbytku.
const sFondem = [{ investor_id: 1, podil: 0.3 }, { fond_id: 9, investor_id: null, podil: 0.4 }];
ok('fondův podíl se počítá do majitelova zbytku',
  Math.abs(PODILY.majitel(sFondem) - 0.3) < 1e-9, '— ' + PODILY.majitel(sFondem));
ok('ředění zasáhne i fondův podíl',
  Math.abs(PODILY.redeni(sFondem, 0.5)[1].podil - 0.2) < 1e-9,
  '— ' + PODILY.redeni(sFondem, 0.5)[1].podil);
// Přes klíč se většina pozná i u fondu.
const vetsinaFondu = D.seznam([{ fond_id: 9, podil: 0.6 }, { investor_id: 1, podil: 0.1 }]);
ok('fond s většinou je vidět jako držitel',
  vetsinaFondu.filter((x) => x.drzitel === 'f:9' && x.podil > 0.5).length === 1);
ok('a není to hráč 9', !vetsinaFondu.some((x) => x.drzitel === 'h:9'));
// Dividenda počítá z podílu, ne z toho, kdo ho drží — musí vyjít stejně.
ok('výplata je stejná, ať drží hráč nebo fond',
  DIVIDENDA.castka(1000000, 0.4, 1) === 400000);

// Ředění nesmí držitele ztratit — vyředěný fondův podíl, který by přestal
// patřit komukoli, by zmizel ze všech součtů a nikdo by si ho nevšiml.
const poRedeni = PODILY.redeni(sFondem, 0.25);
ok('ředění nese držitele dál',
  D.klic(poRedeni[0]) === 'h:1' && D.klic(poRedeni[1]) === 'f:9',
  '— ' + D.klic(poRedeni[1]));

// ── Převzetí: výstupní nabídku smí i fond ────────────────────────────────────
const PREVZETI = require('../services/game/prevzeti');
const velkyFond = [{ fond_id: 5, investor_id: null, podil: 0.8 }];
ok('fond s osmdesáti procenty smí výstupní nabídku',
  PREVZETI.smiVystupni(velkyFond, 'f:5') === true);
ok('hráč 5 se za něj neschová', PREVZETI.smiVystupni(velkyFond, 5) === false);
ok('a hráč to pořád smí po svém',
  PREVZETI.smiVystupni([{ investor_id: 5, podil: 0.8 }], 5) === true);

// ── Aliance: fondův podíl patří do bloku své aliance rovnou ──────────────────
const AL = require('../services/game/aliance');
// Hráč 7 je v alianci 1, fond aliance 1 drží taky. Dohromady jeden blok.
const vBloku = AL.souhrn(
  [{ investor_id: 7, podil: 0.2 }, { fond_id: 1, investor_id: null, podil: 0.3 }],
  new Map([[7, 1]]));
ok('fond a člen téže aliance jsou jeden blok',
  vBloku.length === 1 && Math.abs(vBloku[0].podil - 0.5) < 1e-9,
  '— ' + JSON.stringify(vBloku));
ok('a blok se pozná jako fondový', vBloku[0].fond === true);
// Za fondový blok nejedná mluvčí: rozhodují o něm členové společně.
ok('fondový blok nemá mluvčího', vBloku[0].mluvci === null);

const slouceno = AL.slucPodily(
  [{ investor_id: 7, podil: 0.2 }, { fond_id: 1, investor_id: null, podil: 0.3 }],
  new Map([[7, 1]]));
const nesou = slouceno.filter((x) => x.za_blok);
ok('blok nese právě jeden řádek', nesou.length === 1, '— ' + nesou.length);
ok('a nese ho fond, ne člen', nesou[0].fond_id === 1, '— ' + JSON.stringify(nesou[0]));
ok('součet bloku je celý na něm',
  Math.abs(nesou[0].podil - 0.5) < 1e-9, '— ' + nesou[0].podil);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
