// Market place: výloha podle měst a prodej připraveného místa.
//
// Tržiště umělo prodat jen hotovou provozovnu — místo, na kterém už stál
// stroj. Kdo připravil plochu a natáhl přípojky, neměl ji jak prodat a nový
// hráč musel hledat na mapě sám. Tohle je ta chybějící půlka: místo se smí
// nabídnout, ale jen v lokalitě, kde prodávající má pobočku, protože servis
// je jediné, čím se za nabídku zaručuje.
//
// Nejcitlivější je koupě: u provozovny se převádí stroj, u místa se převádí
// jen zábor. Když se to splete, přijde kupující o stroj, který koupil, nebo
// naopak dostane stroj, který nikdo neprodal.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(koren, p), 'utf8');
const R = cti('routes/game-trade.routes.js');
const hra = cti('public/compounder/game/game.js');

// ─── Pobočka v lokalitě ──────────────────────────────────────────────────────
// Pobočky žijí ve stavu hry jako jméno města a souřadnice, ne jako klíč
// oblasti. Musí proto projít obě cesty, jinak by se podmínka dala obejít
// přejmenováním nebo naopak nešla splnit vůbec.
const m = R.match(/function kmMezi\(a, b\) \{[\s\S]*?\n\}\nfunction pobockaVLokalite\(st, c, nazevOblasti\) \{[\s\S]*?\n\}/);
ok('v obsluze se našlo: pobockaVLokalite', !!m);
if (m) {
  const box = {};
  vm.createContext(box);
  vm.runInContext(m[0], box);
  const P = box.pobockaVLokalite;
  const misto = { lat: 49.97, lon: 17.0 };                     // Šumperk
  const vSumperku = { name: 'Šumperk', lat: 49.965, lon: 16.97 };
  const vPraze = { name: 'Praha', lat: 50.08, lon: 14.43 };
  ok('pobočka ve stejném městě projde', !!P({ pobocky: [vSumperku] }, misto, 'Šumperk'));
  ok('pobočka jinde neprojde', !P({ pobocky: [vPraze] }, misto, 'Šumperk'));
  ok('bez pobočky taky ne', !P({ pobocky: [] }, misto, 'Šumperk'));
  ok('prázdný stav nic neshodí', !P(null, misto, 'Šumperk'));
  // Jméno pobočky se bere i bez souřadnic — stav z doby, kdy se neukládaly.
  ok('shoda jména stačí', !!P({ pobocky: [{ name: 'Šumperk' }] }, misto, 'šumperk'));
  // A naopak: pobočka pár kilometrů vedle platí, i když se jmenuje jinak.
  ok('blízká pobočka stačí taky',
    !!P({ pobocky: [{ name: 'Nemocnice', lat: 49.98, lon: 17.01 }] }, misto, 'Šumperk'));
  ok('vzdálená pobočka bez jména ne',
    !P({ pobocky: [{ name: 'Nemocnice', lat: 50.08, lon: 14.43 }] }, misto, 'Šumperk'));
}

// ─── Co smí na výlohu ────────────────────────────────────────────────────────
ok('bez stroje jde vypsat jen připravené místo',
  /const jenMisto = !c\.model;[\s\S]{0,400}if \(!c\.pripojky\) return/.test(R));
ok('a jen hráči v Unii', /jenMisto[\s\S]{0,400}acct\._unieSmi\(req\.player\.id\)/.test(R));
// Market place má být záruka, ne vývěska. Nabízet smí jen ten, kdo za místo
// v okrese ručí — master území, nebo jeho operátor.
ok('a jen masterovi okresu nebo jeho operátorovi',
  /const jsemMaster = !!\(uzemi && uzemi\.master_id === req\.player\.id\)/.test(R)
  && /if \(!jsemMaster && !licence\)/.test(R)
  && /server\.market_jen_master/.test(R));
ok('a jen s pobočkou v lokalitě',
  /pobockaVLokalite\(stavu\(req\.player\), c, oblast && oblast\.name\)/.test(R)
  && /server\.market_bez_pobocky/.test(R));
// Cena stroje se nesmlouvá. Kdyby se uložila k nabídce, zůstalo by viset
// číslo z doby, kdy stroje stály jinak.
ok('cena stroje se bere z ceníku, ne z nabídky',
  /cena_stroj: \(m\.druh === 'se_strojem' && m\.model_pro\)\s*\?\s*\(JMENI\.CENY_STROJU\[m\.model_pro\]/.test(R));
ok('nabídka si pamatuje, co je zač', /druh: jenMisto \? 'misto' : 'provozovna'/.test(R));
ok('a rozpis ceny', /cena_misto: jenMisto[\s\S]{0,120}cena_pripojky: jenMisto/.test(R));

// ─── Koupě ───────────────────────────────────────────────────────────────────
// Mezi vypsáním a koupí mohl prodávající na místě postavit. Pak kupuje
// kupující něco jiného, než co viděl v nabídce.
ok('u místa se hlídá, že stroj pořád nestojí',
  /jenMisto \? !!c\.model \|\| !c\.pripojky : !c\.model/.test(R));
ok('u místa se nepřevádí žádná jednotka',
  /const jednotky = jenMisto[\s\S]{0,700}kind: 'zprava'[\s\S]{0,400}: \[\{ player_id: m\.player_id, kind: 'unit_remove'/.test(R));
ok('u provozovny se stroj převádí dál', /kind: 'unit_add', spot_id: m\.spot_id, model: m\.model/.test(R));
ok('zábor přechází na kupujícího v obou případech',
  /await tx\.gameSpotClaim\.update\(\{ where: \{ spot_id: m\.spot_id \},\s*data: \{ player_id: req\.player\.id/.test(R));
ok('peníze jdou pořád stejnou cestou', /kind: 'cash', amount: -m\.cena/.test(R));

// ─── Výloha ──────────────────────────────────────────────────────────────────
ok('nabídky nesou jméno lokality', /area_nazev: \(a && a\.name\)/.test(R));
const l = hra.match(/function marketLokality\(vse\) \{[\s\S]*?\n\}/);
const r2 = hra.match(/function marketRozpis\(n\) \{[\s\S]*?\n\}/);
const f = hra.match(/function marketNabidky\(vse\) \{[\s\S]*?\n\}/);
ok('v game.js se našlo: marketLokality, marketRozpis a marketNabidky', !!l && !!r2 && !!f);
if (l && r2 && f) {
  const box = {};
  vm.createContext(box);
  vm.runInContext(l[0] + '\n' + r2[0] + '\n' + f[0], box);
  // Do výlohy patří jen to, za co někdo ručí. Ojetá provozovna od kohokoli
  // zůstává na tržišti — jinak by Market place sliboval nový stroj a nabízel
  // bazar.
  const vyber = box.marketNabidky([
    { druh: 'misto' }, { druh: 'provozovna' }, { druh: 'se_strojem' }, null,
  ]);
  ok('ve výloze jsou jen místa a nové stroje', vyber.length === 2, '— ' + vyber.length);
  ok('ojetá provozovna do výlohy nepatří',
    !vyber.some(function (x) { return x.druh === 'provozovna'; }));
  const lok = box.marketLokality([
    { area_nazev: 'Šumperk' }, { area_nazev: 'Praha' }, { area_nazev: 'Šumperk' }, {},
  ]);
  ok('nabídky se řadí po městech', lok['Šumperk'].length === 2 && lok['Praha'].length === 1);
  ok('a nabídka bez lokality nezmizí', !!lok['—'], '— ' + Object.keys(lok).join(', '));
  // Marže není uložená, vychází z rozdílu — jinak by si ji prodávající psal
  // sám a kupující by viděl rozpis, který nesedí s cenou.
  // Master si nacení jedinou věc: co stálo místo najít a připravit. Cena
  // stroje je z ceníku a sčítá se k tomu.
  let r = box.marketRozpis({ cena: 500000, cena_pripojky: 500000, cena_stroj: 1065000 });
  ok('rozpis sedí na cenu', r.misto + r.stroj === r.celkem, '— ' + JSON.stringify(r));
  ok('místo je masterovo číslo', r.misto === 500000);
  ok('a stroj z ceníku', r.stroj === 1065000);
  r = box.marketRozpis({ cena: 500000, cena_pripojky: 500000, cena_stroj: 0 });
  ok('místo bez stroje má jen jednu položku', r.stroj === 0 && r.celkem === 500000);
  r = box.marketRozpis({ cena: 300000 });
  ok('stará nabídka bez rozpisu nespadne', r.misto === 300000 && r.celkem === 300000);
  r = box.marketRozpis({ cena: -5, cena_pripojky: -5 });
  ok('záporné číslo se nepropíše', r.misto === 0 && r.celkem === 0);
}
ok('výloha má vlastní ikonu', /id="market-btn"/.test(cti('public/compounder/game/index.html'))
  && /marketBtn\.onclick = marketSheet/.test(hra));
ok('a vidí ji každý, nejen Unie', !/market-btn[\s\S]{0,200}ME\.unie/.test(hra));
ok('nabízet místa smí jen Unie', /ME && ME\.unie[\s\S]{0,200}market\.vypsat_misto/.test(hra));

const KAT = JSON.parse(cti('services/game/texty/cs.json'));
['market.nazev', 'market.popis', 'market.druh_misto', 'market.druh_provozovna',
  'market.servis_zajistuje', 'market.cena_celkem', 'market.rozpis_misto',
  'market.rozpis_stroj', 'market.zaruka', 'market.garantuje', 'market.vypsat_misto',
  'server.market_bez_pobocky', 'server.market_jen_master', 'dor.koupil_jsi_misto'].forEach((k) => {
  ok('katalog má ' + k, !!KAT[k]);
});

// Schéma musí ty sloupce mít — bez nich zápis spadne až v provozu.
const schema = cti('prisma/schema.prisma');
const model = schema.slice(schema.indexOf('model GameMarket'));
const hlava = model.slice(0, 1800);
['druh', 'model_pro', 'cena_misto', 'cena_pripojky', 'pobocka'].forEach((s2) => {
  ok('tabulka tržiště má ' + s2, new RegExp('\\b' + s2 + '\\b').test(hlava));
});

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
