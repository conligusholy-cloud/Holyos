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
  /const jenMisto = !c\.model;[\s\S]{0,1600}if \(jenMisto\) \{[\s\S]{0,200}if \(!c\.pripojky\) return/.test(R));
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
  /cena_stroj: \(m\.druh === 'se_strojem'\)\s*\?\s*\(JMENI\.CENY_STROJU\[m\.model_pro \|\| m\.model\]/.test(R));
ok('nabídka si pamatuje, co je zač',
  /druh: jenMisto \? 'misto' : \(seStrojem \? 'se_strojem' : 'provozovna'\)/.test(R));
ok('a rozpis ceny',
  /cena_misto: \(jenMisto \|\| seStrojem\)[\s\S]{0,300}cena_pripojky: \(jenMisto \|\| seStrojem\)/.test(R));

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
ok('peníze jdou pořád stejnou cestou', /kind: 'cash', amount: -celkem/.test(R));

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

// ─── Masterův sklad v kartě území ────────────────────────────────────────────
// Bez seznamu vlastních míst musí master hledat po mapě, co v okrese vlastně
// má — a nabízet pak nemá z čeho.
const RU = cti('routes/game-unie.routes.js');
ok('server posílá moje místa v území', /u\.mista = claims\.map/.test(RU));
ok('a jen ta moje', /where: \{ player_id: me\.id, area_key: \{ in: mesta \} \}/.test(RU));
ok('s tím, co na nich je hotové',
  /pozemek: !!c\.pozemek[\s\S]{0,200}pripojky: Math\.max\(0, Math\.round\(c\.pripojky/.test(RU));
ok('a jestli už na Market place visí', /na_marketu: visi\.has\(c\.spot_id\)/.test(RU));
ok('místa vidí jen master území', /if \(!u\.moje\) continue;/.test(RU));

ok('karta území místa ukazuje', /unieMistaHtml\(u\)/.test(hra));
// Holý zábor bez přípojek nabízet nejde — to je kus mapy, ne nabídka.
ok('nabídnout jde jen připravené místo nebo místo se strojem',
  /var lze = !m\.na_marketu && \(m\.model \|\| m\.pripojky\);/.test(hra));
const n = hra.match(/function marketNaklady\(m\) \{[\s\S]*?\n\}/);
ok('v game.js se našlo: marketNaklady', !!n);
if (n) {
  const box2 = { SCOUT_COST: 20000, obhlidkaCena: () => 5000,
    trhZiskUMe: () => ({ profit: 42000 }) };
  vm.createContext(box2);
  vm.runInContext(n[0], box2);
  let v = box2.marketNaklady({ pripojky: 300000, pozemek_cena: 200000, score: 70, rent: 1000 });
  ok('náklady se sečtou', v.celkem === v.hledani + v.pripojky + v.pozemek, '— ' + JSON.stringify(v));
  ok('hledání se odhadne z dnešních cen', v.hledani > 0, '— ' + v.hledani);
  ok('ověřený provoz se spočítá ze skóre', v.mesicne === 42000);
  v = box2.marketNaklady({ pripojky: 0, score: null });
  ok('místo bez čísel nespadne', v.celkem >= 0 && v.mesicne === 0);
  v = box2.marketNaklady({ pripojky: -5, pozemek_cena: -5, score: null });
  ok('záporné náklady nevzniknou', v.pripojky === 0 && v.pozemek === 0);
}
['unie.moje_mista', 'unie.misto_nabidnout', 'unie.misto_visi', 'market.naklady',
  'market.naklad_hledani', 'market.naklad_pripojky', 'market.naklad_historie'].forEach((k) => {
  ok('katalog má ' + k, !!KAT[k]);
});

// ─── Zápůjčka: místo i se strojem ────────────────────────────────────────────
// Master nabídne místo, na kterém uz jeho stroj stojí. Kupující ho přebírá
// v chodu a vydělává od první minuty; v ceně má nový stroj za ceník a ten
// přijde masterovi na sklad. Pro hru je to táž výměna jako „až dojde nový,
// stroje se prohodí", jen bez čekání a bez evidence, co se může zaseknout.
ok('zápůjčku smí vypsat jen master nebo operátor',
  /const seStrojem = !!c\.model && String\(b\.druh \|\| ''\) === 'se_strojem';/.test(R)
  && /if \(seStrojem\) \{[\s\S]{0,900}server\.market_jen_master/.test(R));
ok('a jen s pobočkou v lokalitě', /if \(seStrojem\) \{[\s\S]{0,1200}server\.market_bez_pobocky/.test(R));
ok('v ceně je stroj z ceníku',
  /const strojCena = seStrojem \? Math\.max\(0, Math\.round\(JMENI\.CENY_STROJU\[m\.model\]/.test(R));
ok('kupující platí místo i stroj', /const celkem = Math\.max\(0, Math\.round\(m\.cena \+ strojCena\)\);/.test(R)
  && /kind: 'cash', amount: -celkem/.test(R));
// Bez tohohle by master o stroj prisel: nechal ho kupujicimu a nedostal nic.
ok('prodávajícímu přijde nový stroj na sklad',
  /seStrojem\s*\?\s*\[\{ player_id: m\.player_id, kind: 'stock', model: m\.model, amount: 1/.test(R));
ok('a stroj na místě přejde kupujícímu', /kind: 'unit_add', spot_id: m\.spot_id, model: m\.model/.test(R));

ok('výloha zápůjčku pozná', /n\.druh === 'se_strojem' \? 'market\.druh_se_strojem'/.test(hra));
ok('a počítá cenu i se strojem', /kcFull\(r\.celkem\)/.test(hra));
ok('master ji nabídne z karty území',
  /var lze = !m\.na_marketu && \(m\.model \|\| m\.pripojky\);/.test(hra)
  && /druh: zapujcka \? 'se_strojem' : 'misto'/.test(hra));
['market.druh_se_strojem', 'market.zapujcka_popis', 'market.zapujcka_jak',
  'market.nabidnout_se_strojem', 'market.stroj_na_miste',
  'dor.market_stroj_nahrada'].forEach((k) => {
  ok('katalog má ' + k, !!KAT[k]);
});

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
