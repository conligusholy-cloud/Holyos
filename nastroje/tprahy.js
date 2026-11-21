// Kolik hlasů je na co potřeba — a jestli to člen vidí PŘEDEM.
//
// Tohle vypadalo jako rozbitá hra: člen s 55 % vkladů dal hlasovat o dividendě
// členům (práh tři čtvrtiny), nic se nestalo a návrh tiše čekal na druhého
// člena. Z panelu se přitom nedalo poznat, že je potřeba víc hlasů, než sám
// má — a tak ho zrušil s tím, že to nefunguje.
//
// Prahy jsou herní pravidlo a hlídají se tu dvě věci: že každý druh návrhu
// má práh a že ho hra umí ukázat ještě před hlasováním.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const F = require('../services/game/fond');
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
const routy = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');

// ─── Prahy samotné ───────────────────────────────────────────────────────────
const DRUHY = (() => {
  const blok = routy.slice(routy.indexOf('const DRUHY = {'));
  return (blok.slice(0, blok.indexOf('\n};')).match(/^\s{2}([a-z_]+):/gm) || [])
    .map((x) => x.trim().replace(':', ''));
})();
ok('druhy návrhů se našly', DRUHY.length >= 8, DRUHY.join(', '));
DRUHY.forEach((d) => {
  // 'nabidka' chodí zvenčí a práh si bere od 'koupit' — vlastní nemá.
  const prah = F.prahDruhu(d === 'nabidka' ? 'koupit' : d);
  ok('druh ' + d + ' má práh', prah > 0 && prah <= 1, String(prah));
});
// Rozdávat peníze členům je zásadní — a průběžná dividenda členům je totéž
// jako výplata, jen rozložená v čase. Kdyby byla běžná, obešla by většina
// práh na výplatu tím, že si místo ní odhlasuje sazbu.
ok('výplata členům je zásadní', F.prahDruhu('vyplatit') === F.ZASADNI);
ok('a průběžná dividenda členům taky', F.prahDruhu('clen_sazba') === F.ZASADNI);
ok('zásadní práh je vyšší než běžný', F.ZASADNI > F.BEZNE);
// Dividenda akcionářům je běžná: členové ji platí ze svého, takže se většina
// omezuje sama.
ok('sazba akcionářům je běžná', F.prahDruhu('akcie_sazba') === F.BEZNE);

// ─── Vidí je člen předem? ────────────────────────────────────────────────────
ok('server posílá prahy do hry', /prahy: Object\.keys\(DRUHY\)/.test(routy));
const kus = (hra.match(/function fondPrahRadek\(druh\) \{[\s\S]*?\n\}/) || [''])[0];
ok('v game.js se našlo: fondPrahRadek', !!kus);
if (!kus) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {
  FOND: { fond: { prahy: { vyplatit: 0.75, koupit: 0.5 } } },
  fondJa: () => ({ podil: 0.552 }),
  tx: (k, d) => k + ' ' + JSON.stringify(d || {}),
  esc: (x) => String(x),
  pctHra: (x) => String(Math.round(x * 1000) / 10),
};
vm.createContext(box);
vm.runInContext(kus, box);
const R = box.fondPrahRadek;
const vyplatit = R('vyplatit');
ok('řádek řekne, kolik je potřeba', vyplatit.indexOf('0.75') > 0 || vyplatit.indexOf('75') > 0);
ok('a kolik mám já', vyplatit.indexOf('55.2') > 0);
// Tohle je ta věta, která chyběla: sám to neprosadíš.
ok('když sám nestačím, je to vidět', /warn/.test(vyplatit) && /prah_nestaci/.test(vyplatit));
const koupit = R('koupit');
ok('když stačím, varování není', !/warn/.test(koupit) && !/prah_nestaci/.test(koupit));
// Neznámý druh nekreslí nic — radši nic než vymyšlené číslo.
ok('neznámý druh nekreslí nic', R('neco') === '');
box.FOND = null;
ok('bez načteného fondu taky ne', R('vyplatit') === '');

// ─── Zapojení ────────────────────────────────────────────────────────────────
// U KAŽDÉHO tlačítka „Dát hlasovat" musí ten řádek být. Jedno zapomenuté
// a je to zase hra, která „nefunguje".
const navrh = hra.slice(hra.indexOf('function fondNavrhSheet'));
const usek = navrh.slice(0, navrh.indexOf("if ($('fo-koupit'))"));
const tlacitek = (usek.match(/id="fo-[a-z]+"[^>]*>' \+ esc\(tx\('fond\.dat_hlasovat'\)\)/g) || []).length;
const radku = (usek.match(/fondPrahRadek\('/g) || []).length;
ok('každé tlačítko má u sebe práh', tlacitek === radku, tlacitek + ' tlačítek, ' + radku + ' řádků');
ok('a je jich tolik co druhů k hlasování', radku >= 7, String(radku));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
