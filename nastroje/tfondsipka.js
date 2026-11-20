// Šipka u měsíčního výnosu drženého podílu.
//
// Napravo u každého podílu stojí to, kvůli čemu se drží: co nese za měsíc.
// Šipka říká, kam se to pohnulo proti MINULÉMU VZORKU — ne proti tomu, co
// kdo kdy viděl. Kdyby se měřilo proti poslední návštěvě, viděl by každý
// člen u téhož podílu jinou šipku.
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
const kusy = [
  (hra.match(/function smerVynosu\(ted, pred\) \{[\s\S]*?\n\}/) || [''])[0],
  (hra.match(/function sipkaHtml\(sm\) \{[\s\S]*?\n\}/) || [''])[0],
];
ok('v game.js se našlo: smerVynosu', !!kusy[0]);
if (!kusy[0]) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {};
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const smer = box.smerVynosu, sipka = box.sipkaHtml;

// ─── Kam se to pohnulo ───────────────────────────────────────────────────────
ok('růst je nahoru', smer(600000, 588983).nahoru === true);
ok('pokles je dolů', smer(500000, 588983).nahoru === false);
ok('a ví se o kolik', smer(600000, 588983).rozdil === 11017);
ok('pokles má záporný rozdíl', smer(500000, 588983).rozdil === -88983);

// Šipka u čísla, které stojí, je jen šum.
ok('beze změny se nekreslí nic', smer(588983, 588983) === null);
// Zaokrouhluje se stejně, jako se to ukládá — setina pohyb není.
ok('setina rozdílu se neřeší', smer(588983.4, 588983) === null);
ok('ale koruna ano', smer(588984, 588983) !== null);

// ─── Kdy se nemá s čím srovnat ───────────────────────────────────────────────
// Nový podíl, první vzorek, výpadek zápisu. Nula není pokles — kdyby se za
// chybějící vzorek dosadila, vypadal by každý nový podíl jako propad.
ok('bez minulého vzorku se nekreslí nic', smer(588983, null) === null);
ok('nedefinovaný vzorek taky ne', smer(588983, undefined) === null);
ok('nesmysl místo vzorku taky ne', smer(588983, 'nic') === null);
// Nula jako SKUTEČNĚ zapsaný vzorek je ale platná: podíl, co nenesl nic
// a teď nese, roste.
ok('zapsaná nula je platný vzorek', smer(588983, 0).nahoru === true);
ok('a propad na nulu je pokles', smer(0, 588983).nahoru === false);

// ─── Jak to vypadá ───────────────────────────────────────────────────────────
ok('nahoru je zelená', sipka(smer(600000, 1)).indexOf('ok') > 0);
ok('dolů je červená', sipka(smer(1, 600000)).indexOf('err') > 0);
ok('nahoru má šipku vzhůru', sipka(smer(600000, 1)).indexOf('↑') > 0);
ok('dolů má šipku dolů', sipka(smer(1, 600000)).indexOf('↓') > 0);
ok('beze změny se nevykreslí nic', sipka(null) === '');

// ─── Zapojení ────────────────────────────────────────────────────────────────
const blok = hra.slice(hra.indexOf("tx('fond.drzi')"));
const usek = blok.slice(0, blok.indexOf('Vyvěšené') > 0 ? blok.indexOf('Vyvěšené') : 4000);
ok('napravo u podílu stojí měsíční výnos, ne zaplacená cena',
  /kcFull\(x\.mesicne\)/.test(usek) && !/<\/span><span class="muted small">' \+ kcFull\(x\.cena\)/.test(usek));
ok('zaplacená cena se přesunula k detailu',
  /fond_drzi_zaplaceno[\s\S]{0,60}x\.cena/.test(usek));
ok('šipka se u podílu kreslí', /sipkaHtml\(sm\)/.test(usek));
ok('a u součtu dole taky', /sipkaHtml\(smCelkem\)/.test(usek));
// Chybějící vzorek nesmí v součtu propadnout jako nula.
ok('součet „předtím" nedosazuje za chybějící vzorek nulu',
  /if \(x\.mesicne_pred != null\)[\s\S]{0,200}else if \(nesloPred != null\)/.test(usek));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
