// Prodat fondu podíl, který člen drží v cizí firmě.
//
// Je to obchod s vlastním fondem, a to je přesně ten případ, kde se dá
// ukrást: prodávající je zároveň ten, kdo o nákupu hlasuje. Hlídají se proto
// tři věci, bez kterých by to byla díra do společné pokladny:
//
//  1. Cenu si prodávající NEURČUJE. Bere se ocenění, kterým hra měří každý
//     podíl — jmění firmy krát podíl.
//  2. Práh je ZÁSADNÍ. I při pevné ceně musí ostatní říct, jestli to fond
//     vůbec chce; většinový člen by si jinak prodal do fondu, co by chtěl.
//  3. Prodat jde jen VLASTNÍ běžící podíl a jen za peníze, které fond má.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const F = require('../services/game/fond');
const VLAST = require('../services/game/vlastnictvi');
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
const routy = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');

// ─── Cena ────────────────────────────────────────────────────────────────────
// Stejné ocenění, jakým se podíl počítá všude jinde. Dvě různá „kolik ten
// podíl stojí" by znamenala, že se dá vybrat to výhodnější.
const jm = new Map([[3, 100000000]]);
ok('podíl se oceňuje jměním firmy krát podíl',
  VLAST.hodnotaPodilu(jm, { firma_id: 3, podil: 0.1, cena: 1 }) === 10000000);
ok('neznámá firma spadne na pořizovací cenu, ne na nulu',
  VLAST.hodnotaPodilu(new Map(), { firma_id: 9, podil: 0.1, cena: 4200 }) === 4200);
const usekCena = routy.slice(routy.indexOf('async function cenaPodiluDnes'));
ok('server cenu počítá tímhle oceněním',
  /VLAST\.hodnotaPodilu\(jm, e\)/.test(usekCena.slice(0, 900)));
// Tohle je ta past: cena z těla požadavku by znamenala, že si ji řekne
// prodávající sám — a pro svůj vlastní obchod ještě zvedne ruku.
const navrh = routy.slice(routy.indexOf("} else if (druh === 'odkup_podilu') {"));
const usekNavrh = navrh.slice(0, navrh.indexOf("} else if (druh === 'clen_sazba')"));
ok('cena se nebere z požadavku', !/b\.cena|body\.cena/.test(usekNavrh));
ok('bere se ze serverového ocenění', /cenaPodiluDnes\(e\)/.test(usekNavrh));
// A znovu při provedení: mezi hlasováním a vyhlášením může uběhnout den.
const provest = routy.slice(routy.indexOf("if (n.druh === 'odkup_podilu') {"));
const usekProvest = provest.slice(0, provest.indexOf("if (n.druh === 'clen_sazba')"));
ok('a při provedení se počítá znovu', /cenaPodiluDnes\(e\)/.test(usekProvest));
ok('ne z toho, co se uložilo při hlasování', !/cena: d\.cena|d\.cena\b/.test(usekProvest));

// ─── Čí podíl a za co ────────────────────────────────────────────────────────
ok('prodat jde jen vlastní podíl', /e\.investor_id !== req\.player\.id/.test(usekNavrh));
ok('a jen běžící', /e\.stav !== 'bezi'/.test(usekNavrh));
ok('fond nekupuje za víc, než má volného', /cena > volne/.test(usekNavrh));
ok('a kontroluje to i při provedení', /cena > volne/.test(usekProvest));

// ─── Převod ──────────────────────────────────────────────────────────────────
// Podíl drží buď hráč, nebo fond — nikdy obojí. Zápis to musí udělat naráz.
ok('podíl přejde na fond', /investor_id: null[\s\S]{0,120}fond_id: moje\.aliance_id/.test(usekProvest));
ok('zápis je podmíněný tím, že ho pořád drží prodávající',
  /where: \{ id: e\.id, stav: 'bezi', investor_id: prodavajici \}/.test(usekProvest));
ok('fondu ubude z pokladny', /pokladna: \{ decrement: cena \}/.test(usekProvest));
ok('a prodávající dostane peníze doručenkou',
  /player_id: prodavajici, kind: 'cash'/.test(usekProvest));
// Změna vlastnictví se musí zapsat do evidence — jinak po téhle cestě
// nezůstane stopa.
ok('změna vlastnictví jde do evidence', /AUDIT\.zapis\(tx, e\.firma_id/.test(usekProvest));

// ─── Práh ────────────────────────────────────────────────────────────────────
ok('odkup od vlastního člena je ZÁSADNÍ', F.prahDruhu('odkup_podilu') === F.ZASADNI);
ok('tedy přísnější než běžný nákup', F.prahDruhu('odkup_podilu') > F.prahDruhu('koupit'));

// ─── Zapojení v hře ──────────────────────────────────────────────────────────
ok('u podílu je tlačítko Prodat fondu', /data-fondodkup="' \+ e\.id/.test(hra));
ok('a napojuje se tam, kde ostatní tlačítka u podílu',
  /querySelectorAll\('\[data-fondodkup\]'\)/.test(hra));
const sheet = hra.slice(hra.indexOf('function fondOdkupSheet'));
const usekSheet = sheet.slice(0, sheet.indexOf('\nfunction '));
ok('cena se ukazuje PŘED hlasováním', /fond\.odkup_cena[\s\S]{0,120}kcFull\(d\.cena\)/.test(usekSheet));
ok('a je u ní i práh', /fondPrahRadek\('odkup_podilu'\)/.test(usekSheet));
// Hlasovat o tom, na co fond nemá, je ztráta dne.
ok('bez peněz fondu se tlačítko zhasne', /\(staci \? '' : ' disabled'\)/.test(usekSheet));
ok('a řekne se proč', /fond\.odkup_fond_nema/.test(usekSheet));
ok('kdo není ve fondu, dozví se to', /fond\.odkup_nejsi_clen/.test(usekSheet));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
