// Co hráč vlastní mimo zdi své firmy.
//
// Karta „Můj majetek" uměla jen to, co hráč drží fyzicky: prádlomaty, stroje,
// pozemky, pobočky, hotovost minus dluh. Vklad do fondu v ní nebyl vůbec,
// takže kdo do fondu složil sedmdesát čtyři milionů, je u sebe neviděl —
// a žebříček o něm přitom tvrdil o šestatřicet milionů víc, protože ten
// vlastnictví počítá.
//
// Nejzrádnější je tu znaménko: co z MÉ firmy drží někdo jiný, se musí
// ODEČÍST. Prádlomaty na té části pořád stojí a v kartě výš se počítají,
// ale moje už nejsou.
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
const kus = (hra.match(/function podilyMamCo\(p\) \{[\s\S]*?\n\}/) || [''])[0];
ok('v game.js se našlo: podilyMamCo', !!kus);
if (!kus) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {};
vm.createContext(box);
vm.runInContext(kus + '\n', box);
const mamCo = box.podilyMamCo;

// ─── Kdy se blok kreslí ──────────────────────────────────────────────────────
ok('hráč s podílem ve fondu blok vidí',
  mamCo({ fond_celkem: 52104119, drzim: { hodnota: 0 }, prodano: { hodnota: 0 } }) === true);
ok('hráč s podílem v cizí firmě blok vidí',
  mamCo({ fond_celkem: 0, drzim: { hodnota: 4000000 }, prodano: { hodnota: 0 } }) === true);
// Tenhle je důležitý: hráč, kterému kus firmy drží někdo jiný, o tom musí
// vědět, i když sám nikde nic nedrží.
ok('hráč, kterému kus firmy drží jiní, blok taky vidí',
  mamCo({ fond_celkem: 0, drzim: { hodnota: 0 }, prodano: { hodnota: 16000000 } }) === true);
ok('hráč bez fondu a bez podílů blok nevidí',
  mamCo({ fond_celkem: 0, drzim: { hodnota: 0 }, prodano: { hodnota: 0 } }) === false);
// Než odpověď dorazí, karta musí vypadat jako dřív.
ok('dokud se nenačte, blok není', mamCo(null) === false && mamCo(false) === false);
ok('prázdná odpověď blok nedělá', mamCo({}) === false);

// ─── Součet ──────────────────────────────────────────────────────────────────
// Server posílá celkem = fond + držené podíly − co z mé firmy drží jiní.
// Hra k němu přičte čisté jmění. Tady se kontroluje jen ta aritmetika
// znaménka, protože právě ona se plete.
const celkem = (p) => (p.fond_celkem || 0) + (p.drzim.hodnota || 0) - (p.prodano.hodnota || 0);
const ja = { fond_celkem: 52104119, drzim: { hodnota: 0 }, prodano: { hodnota: 15925883 } };
ok('prodaná část firmy se odečítá, ne přičítá', celkem(ja) === 36178236);
ok('a nedostane se nad hodnotu fondu', celkem(ja) < ja.fond_celkem);

// ─── Zapojení ────────────────────────────────────────────────────────────────
ok('karta majetku blok kreslí', hra.indexOf('podilyMamCo(PODILY_MOJE)') > 0);
ok('prodaná část má v kartě minus',
  /z_me_firmy_drzi_jini[\s\S]{0,200}err">\\u2212/.test(hra));
// Čisté jmění se tím měnit nesmí: váže se na něj hodnost i úvěrový rámec.
const fn = (hra.match(/function cisteJmeni\(\) \{[\s\S]*?\n\}/) || [''])[0];
ok('čisté jmění o podílech neví', fn.indexOf('PODILY_MOJE') < 0 && fn.indexOf('podil') < 0);

// Neúspěšné načtení nesmí nechat stav, kvůli kterému se kreslení ptá pořád
// dokola — paintMe se volá při každém překreslení záložky.
const ld = (hra.match(/function loadPodily\(then\) \{[\s\S]*?\n\}/) || [''])[0];
ok('neúspěch se zapíše, aby se nenačítalo donekonečna',
  ld.indexOf('PODILY_MOJE = false') > 0 && ld.indexOf('|| false') > 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
