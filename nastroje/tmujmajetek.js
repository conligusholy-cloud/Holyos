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
const kusAk = (hra.match(/function akcieMoje\(\) \{[\s\S]*?\n\}/) || [''])[0];
ok('v game.js se našlo: podilyMamCo', !!kus);
ok('v game.js se našlo: akcieMoje', !!kusAk);
if (!kus || !kusAk) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = { AKCIE_SEZNAM: null };
vm.createContext(box);
vm.runInContext(kusAk + '\n' + kus + '\n', box);
const mamCo = box.podilyMamCo;
const akcie = box.akcieMoje;
const sAkciemi = (l, f) => { box.AKCIE_SEZNAM = l; const r = f(); box.AKCIE_SEZNAM = null; return r; };

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

// ─── Akcie fondů ────────────────────────────────────────────────
// Akcie se dají koupit i bez členství ve fondu. Kdo žádný vklad nemá, ale
// akcie drží, měl svůj majetek do téhle chvíle nikde — ani v kartě, ani
// v součtu.
const burza = [
  { aliance_id: 1, cena: 145919, moje_kusy: 65, na_akcii_mesicne: 762 },
  { aliance_id: 2, cena: 50000, moje_kusy: 0, na_akcii_mesicne: 100 },
  { aliance_id: 3, cena: 20000, moje_kusy: 3, na_akcii_mesicne: 0 },
];
const mam = sAkciemi(burza, akcie);
ok('sčítají se kusy ze všech fondů', mam.pocet === 68);
ok('fond, kde nic nedržím, se nepočítá', mam.fondu === 2);
ok('hodnota je kusy krát dnešní cena', mam.hodnota === 65 * 145919 + 3 * 20000);
ok('a ví se, co nesou za měsíc', mam.mesicne === 65 * 762);
ok('bez načteného seznamu je to nula',
  akcie().hodnota === 0 && akcie().pocet === 0);
ok('nesmysly nic neshodí',
  sAkciemi([{ cena: 'x', moje_kusy: 'y' }, null && {}], akcie).hodnota === 0);
// A blok se kvůli nim kreslí, i když hráč není v žádném fondu.
ok('kdo drží jen akcie, blok vidí',
  sAkciemi(burza, () => mamCo({ fond_celkem: 0, drzim: { hodnota: 0 },
    prodano: { hodnota: 0 } })) === true);
ok('a bez akcií i bez podílů pořád ne',
  sAkciemi([{ aliance_id: 1, cena: 1000, moje_kusy: 0 }],
    () => mamCo({ fond_celkem: 0, drzim: { hodnota: 0 }, prodano: { hodnota: 0 } })) === false);

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
ok('a akcie jsou v kartě taky', /hra\.akcie_fondu[\s\S]{0,200}kcFull\(ak\.hodnota\)/.test(hra));
ok('a v součtu', /kcFull\(cisteJmeni\(\) \+ \(p\.celkem \|\| 0\) \+ ak\.hodnota\)/.test(hra));
// Čisté jmění se tím měnit nesmí: váže se na něj hodnost i úvěrový rámec.
const fn = (hra.match(/function cisteJmeni\(\) \{[\s\S]*?\n\}/) || [''])[0];
ok('čisté jmění o podílech neví', fn.indexOf('PODILY_MOJE') < 0 && fn.indexOf('podil') < 0);
ok('ani o akciích', fn.indexOf('AKCIE') < 0 && fn.indexOf('akcie') < 0);

// Neúspěšné načtení nesmí nechat stav, kvůli kterému se kreslení ptá pořád
// dokola — paintMe se volá při každém překreslení záložky.
const ld = (hra.match(/function loadPodily\(then\) \{[\s\S]*?\n\}/) || [''])[0];
ok('neúspěch se zapíše, aby se nenačítalo donekonečna',
  ld.indexOf('PODILY_MOJE = false') > 0 && ld.indexOf('|| false') > 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
