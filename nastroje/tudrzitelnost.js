// Utáhne fond dividendu, kterou slíbil?
//
// Jediná otázka, která u dividendy opravdu rozhoduje: co fondu teče z držených
// firem dovnitř a co odteče akcionářům ven. Rozdíl se bere z pokladny, a ta
// není bezedná — člen se podle toho rozhoduje, jestli sazbu zvednout, nechat,
// nebo srazit.
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
const vytahni = (re, jmeno) => {
  const m = hra.match(re);
  ok('v game.js se našlo: ' + jmeno, !!m);
  return m ? m[0] : '';
};
const kusy = [
  vytahni(/function fondUdrzitelnost\(zFirem, akcionarum, clenum, volne\) \{[\s\S]*?\n\}/, 'fondUdrzitelnost'),
  vytahni(/function fondSazbaUdrzitelna\(neseMesicne, zakladAkcii\) \{[\s\S]*?\n\}/, 'fondSazbaUdrzitelna'),
];
if (chyb) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {};
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const U = box.fondUdrzitelnost, S = box.fondSazbaUdrzitelna;

// ─── Bilance ─────────────────────────────────────────────────────────────────
const u = U(1302000, 886168, 0, 45000000);
ok('z firem teče, co teče', u.zFirem === 1302000);
ok('akcionářům odtéká, co odtéká', u.akcionarum === 886168);
ok('zbytek je rozdíl', u.zbyva === 1302000 - 886168);
ok('a ví se, kolik výnosu dividenda spolkne',
  Math.abs(u.ukrajuje - 886168 / 1302000) < 1e-9);
// Kdo vyplácí míň, než vydělá, nic nedoplácí — není co.
ok('kdo vydělá víc, než rozdá, pokladnu nečerpá', u.vydrzi === null);

// ─── Když se vyplácí víc, než se vydělá ──────────────────────────────────────
// Tohle je ten případ, kvůli kterému to číslo vzniklo. Fond může chvíli
// dotovat dividendu z pokladny, ale musí být vidět, jak dlouho.
const p = U(500000, 900000, 0, 8000000);
ok('schodek je záporný', p.zbyva === -400000);
ok('a ví se, kolik měsíců pokladna vydrží', p.vydrzi === 20);
ok('ukrajuje víc než celý výnos', p.ukrajuje > 1);
// Prázdná pokladna vydrží nula měsíců, ne „nekonečno" a ne pád.
ok('prázdná pokladna vydrží nula měsíců', U(0, 100000, 0, 0).vydrzi === 0);
ok('záporná pokladna se bere jako prázdná', U(0, 100000, 0, -5000).vydrzi === 0);

// ─── Ven teče obojí ─────────────────────────────────────────────
// Fond platí akcionářům i členům a pokladna mezi nimi nerozlišuje. Kdyby se
// do bilance počítala jen jedna strana, vypadal by fond zdravěji, než je.
const obe = U(1000000, 400000, 400000, 10000000);
ok('ven jde součet obou dividend', obe.ven === 800000);
ok('a zbytek je po obou', obe.zbyva === 200000);
ok('ukrajuje se počítá z obou', Math.abs(obe.ukrajuje - 0.8) < 1e-9);
const jenClenum = U(500000, 0, 900000, 8000000);
ok('sama dividenda členům udělá schodek', jenClenum.zbyva === -400000);
ok('a pokladna na něj vydrží stejně', jenClenum.vydrzi === 20);

// ─── Hranice ─────────────────────────────────────────────────────────────────
// Fond, který nic nedrží, nemá z čeho měřit podíl — nula procent by lhala.
ok('bez výnosu se podíl nekreslí', U(0, 100000, 0, 1000000).ukrajuje === null);
ok('ale schodek se spočítá pořád', U(0, 100000, 0, 1000000).zbyva === -100000);
ok('bez dividendy zbyde všechno', U(1000000, 0, 0, 0).zbyva === 1000000);
ok('a nic se nespolkne', U(1000000, 0, 0, 0).ukrajuje === 0);
ok('přesně na nulu není schodek', U(900000, 900000, 0, 100).vydrzi === null);
ok('nesmysly nic neshodí', U('x', 'y', 'z', 'w').zbyva === 0);

// ─── Udržitelná sazba ────────────────────────────────────────────────────────
// Kolik procent by šlo platit do nekonečna: roční výnos dělený tím, co akcie
// účetně stojí. Herní rok je dvanáct herních měsíců.
ok('roční výnos dělený základem', Math.abs(S(1000000, 120000000) - 0.1) < 1e-9);
ok('dvojnásobný výnos unese dvojnásobnou sazbu',
  Math.abs(S(2000000, 120000000) - 2 * S(1000000, 120000000)) < 1e-9);
// Bez výnosu nebo bez vydaných akcií se nedělí nulou a nekreslí se nic.
ok('bez výnosu se nevrací nic', S(0, 120000000) === null);
ok('bez základu taky ne', S(1000000, 0) === null);
ok('nesmysly taky ne', S('x', 'y') === null);

// ─── Zapojení ────────────────────────────────────────────────────────────────
const vnitrek = hra.slice(hra.indexOf('function fondVnitrek'));
const usek = vnitrek.slice(0, vnitrek.indexOf('var FOND_KAM'));
ok('panel fondu bilanci ukazuje', /fondUdrzitelnost\(zFirem,/.test(usek));
// Dividenda členům nesmí viset uvnitř bloku akcií: fond nemusí žádné akcie
// vydat a přitom členům platit, a otázka „utáhne to fond?" platí vždycky.
ok('bilance stojí mimo blok akcií',
  usek.indexOf("if (f.akcie_celkem > 0) {") < usek.indexOf('fondUdrzitelnost(zFirem,')
  && usek.slice(usek.indexOf('fondUdrzitelnost(zFirem,')).indexOf('id="fond-kniha"') < 0);
ok('a dividenda členům taky', /fond\.clen_sazba_nadpis/.test(usek));
ok('měsíční odliv členům se bere z roční sazby',
  /Math\.round\(\(f\.clen_dividenda_rocne \|\| 0\) \/ 12\), f\.volne\)/.test(usek));
// Dividenda se musí měřit MĚSÍČNĚ proti měsíčnímu výnosu, ne ročně —
// dvanáctkrát nafouknutý odliv by vypadal jako katastrofa.
ok('a měří měsíc proti měsíci',
  /fondUdrzitelnost\(zFirem, Math\.round\(\(f\.akcie_dividenda_rocne \|\| 0\) \/ 12\)/.test(usek));
ok('z firem se sčítá to, co nesou', /\(Number\(x\.mesicne\) \|\| 0\)/.test(usek));
ok('schodek je vidět jako červený', /u\.zbyva >= 0 \? 'ok' : 'err'/.test(usek));
ok('a je u něj, jak dlouho pokladna vydrží', /veta\.fond_pokladna_vydrzi/.test(usek));
ok('udržitelná sazba se počítá z dílu akcionářů',
  /fondSazbaUdrzitelna\(u\.zFirem, zaklad\)/.test(usek)
  && /\(f\.hodnota_fondu \|\| 0\) \* \(f\.akcie_podil \|\| 0\)/.test(usek));
// A hlavně tam, kde se o sazbě rozhoduje: pod políčkem v návrhu.
ok('a stojí i u hlasování o sazbě',
  /fondSazbaUdrzitelna\(zFirem,[\s\S]{0,400}veta\.fond_sazba_udrzitelna/.test(hra));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
