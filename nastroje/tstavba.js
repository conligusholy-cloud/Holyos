// Stavba na místě, kde můj zábor už leží.
//
// Zábor místa a stroj na něm jsou dvě různé věci. Když stroj zmizí —
// zbourá ho hra nebo ho zabaví soud — zábor hráči zůstává; mizí jen stroj.
// Klient se ale dřív rozhodoval podle pořadí stání: první stání na vlastním
// pozemku = dopsat stroj do záboru, každé další = zabrat nové místo. Na
// stání, kde zábor po zmizelém stroji zůstal, tím hra zabírala místo, které
// už hráči patřilo, a server ji odmítl: „Tady už stojíš." Hráč koukal na
// vlastní prázdnou plochu, na které nešlo postavit.
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
  vytahni(/function padId\(spotId, i\) \{[^\n]*\n/, 'padId'),
  vytahni(/function dopsatStroj\(claim\) \{[^\n]*\n/, 'dopsatStroj'),
  vytahni(/function zrusNahrobek\(spotId\) \{[\s\S]*?\n\}/, 'zrusNahrobek'),
];
if (kusy.some((x) => !x)) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }

const box = {};
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const { padId, dopsatStroj, zrusNahrobek } = box;

// ─── Čím se staví ────────────────────────────────────────────────────────────
// Volný zábor je ten, do kterého se jen dopíše stroj. Nic jiného.
ok('vlastní zábor bez stroje → dopsat',
  dopsatStroj({ mine: true, model: '' }) === true);
ok('vlastní zábor se strojem → nedopisovat (tam už něco stojí)',
  dopsatStroj({ mine: true, model: 'max' }) === false);
ok('cizí zábor bez stroje → nedopisovat (není můj)',
  dopsatStroj({ mine: false, model: '' }) === false);
ok('cizí zábor se strojem → nedopisovat',
  dopsatStroj({ mine: false, model: 'max' }) === false);
ok('žádný zábor → nedopisovat, místo se teprve zabere',
  dopsatStroj(undefined) === false && dopsatStroj(null) === false);

// Server posílá model jako null, když na místě nic nestojí. Kdyby se
// kontrolovalo jen na prázdný řetězec, null by prošel jako „stojí tam stroj"
// a hráč by na vlastní prázdné ploše zase nepostavil.
ok('model null se bere jako prázdné místo',
  dopsatStroj({ mine: true, model: null }) === true);

// ─── Stání na témže pozemku ──────────────────────────────────────────────────
// Id stání musí být stabilní: na padId se zábor hledá i zakládá. Kdyby se
// rozešly, hra by hledala zábor jinde, než ho předtím založila.
ok('první stání má id pozemku', padId('fabriano-1', 0) === 'fabriano-1');
ok('druhé stání má vlastní id', padId('fabriano-1', 1) === 'fabriano-1#1');
ok('páté stání taky', padId('fabriano-1', 4) === 'fabriano-1#4');

// ─── Ten skutečný případ ─────────────────────────────────────────────────────
// Soud zabavil stroj na druhém stání. Zábor zůstal, stroj zmizel.
const poSoudu = { 'fabriano-1': { mine: true, model: 'max' },
  'fabriano-1#1': { mine: true, model: '' } };
ok('po zabavení se na uvolněné stání staví dopsáním, ne novým záborem',
  dopsatStroj(poSoudu[padId('fabriano-1', 1)]) === true);
ok('na stání, kde stroj pořád stojí, se nestaví',
  dopsatStroj(poSoudu[padId('fabriano-1', 0)]) === false);
// Třetí stání nikdy nikdo nezabral — tam se místo zabírá normálně.
ok('na dosud nezabrané stání se zabírá nově',
  dopsatStroj(poSoudu[padId('fabriano-1', 2)]) === false);

// ─── Zapojení do stavby ──────────────────────────────────────────────────────
// Pomocník sám o sobě nestačí: musí se při dokončení stavby opravdu zavolat,
// a dřív, než se stroj přidá do sítě. Tohle se nedá ověřit spuštěním, protože
// dokončení stavby je obsluha tlačítka — hlídá se tedy v samotném zdroji.
const dokonceni = hra.slice(hra.indexOf('var volani = dopsatStroj('));
const iZrus = dokonceni.indexOf('zrusNahrobek(spotId);');
const iPush = dokonceni.indexOf('S.units.push({ spotId: spotId');
ok('dokončená stavba náhrobek ruší', iZrus > 0);
ok('ruší ho dřív, než stroj přidá do sítě', iZrus > 0 && iPush > 0 && iZrus < iPush);

// ─── Náhrobek po odebraném stroji ────────────────────────────────────────────
// Tohle je ten případ, kdy hráč přišel o zaplacený stroj úplně: soud mu
// zabavil prádlomat, místo si to poznamenalo, a když na stejné místo postavil
// nový, srovnání se serverem ho smazalo — a na sklad ho nevrátilo.
box.S = { prodano: { 'horice-0': 1, 'fabriano-1': 1 } };
ok('nová stavba náhrobek ruší',
  zrusNahrobek('horice-0') === true && box.S.prodano['horice-0'] === undefined);
ok('cizí náhrobky zůstávají — o ty stroje hráč přišel u soudu',
  box.S.prodano['fabriano-1'] === 1);
ok('místo bez náhrobku se stavbou nemění',
  zrusNahrobek('praha-5') === false);
// Druhá stavba na témže místě už nemá co rušit; nesmí spadnout.
ok('zrušení dvakrát po sobě nevadí', zrusNahrobek('horice-0') === false);

// Bez uloženého stavu se nesmí sáhnout do ničeho — hra volá stavbu i dřív,
// než je stav načtený, a výjimka by shodila celé dokončení stavby: hráč by
// měl stroj zaplacený, server by ho měl zapsaný a hra by o něm nevěděla.
box.S = null;
ok('bez stavu hry to jen nic neudělá', zrusNahrobek('horice-0') === false);
box.S = {};
ok('bez seznamu náhrobků to jen nic neudělá', zrusNahrobek('horice-0') === false);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
