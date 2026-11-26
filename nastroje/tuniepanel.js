// Panel Unie: dvě hromádky a skládačka.
//
// Panel byl sloupec plných karet pod sebou — vlastní území, cizí a volná
// promíchaná, každé s posuvníkem poplatku a seznamem míst. U pěti území se
// v něm nedalo nic najít a hlavní otázka, kvůli které ho hráč otevírá — jak
// velké území mám a jak se mi v něm daří — se v tom ztrácela.
//
// Hlídá se tu čtvero:
//
//  1. Dvě hromádky. Moje území zvlášť, kde se dá soutěžit zvlášť. Kdyby se
//     slily, je panel zpátky tam, kde byl.
//  2. Souhrn v nadpisu. Počet území a co nesou — to je ta odpověď.
//  3. Varování na ZAVŘENÉM řádku. Skládačka, která schová běžící výzvu, je
//     past: hráč o území přijde a ani se nedoví proč.
//  4. Paměť rozbalení. Panel se překresluje po každé doručence a bez paměti
//     by se všechno pokaždé zase sbalilo pod rukama.
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
const hra = cti('public/compounder/game/game.js');
const css = cti('public/compounder/game/game.css');
const KAT = JSON.parse(cti('services/game/texty/cs.json'));

// Čisté funkce se vytáhnou a spustí — o tvar řádku tu jde především.
const jmena = ['unieSkladacka', 'unieRadek', 'unieMojeRadek', 'unieCiziRadek',
  'unieVolneRadek', 'unieOddil'];
const kusy = jmena.map(function (n) {
  const m = hra.match(new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}'));
  ok('v game.js se našlo: ' + n, !!m);
  return m ? m[0] : '';
});
const box = {
  esc: (x) => String(x),
  tx: (k, u) => String(KAT[k] || k).replace(/\{(?:[a-z]+:)?(p\d+)\}/g,
    (_, n) => (u && u[n] != null ? String(u[n]) : '')),
  kcFull: (n) => Math.round(n) + ' L$',
  cislo1: (n) => String(n),
};
vm.createContext(box);
vm.runInContext('var UNIE_OTEVRENO = {};' + kusy.join('\n'), box);

// ─── Řádek mého území ────────────────────────────────────────────────────────
const uzemi = (x) => Object.assign({ okres_key: 'cz', nazev: 'Šumperk', stroju: 16,
  cizich: 12, prijem_mesic: 60896, nespokojenost: 10, vyzva_prah: 40,
  zavazek: 2, zavazek_pridano: 2 }, x || {});
const klid = box.unieMojeRadek(uzemi());
ok('na řádku je název území', klid.indexOf('Šumperk') >= 0);
ok('kolik v něm stojí strojů a kolik je cizích',
  klid.indexOf('16') >= 0 && klid.indexOf('12') >= 0);
ok('a co nese za měsíc', klid.indexOf('60896') >= 0);
// Příjem je v pořádku i u území, které má problém. Červený by tvrdil, že se
// nevyplácí — a to je jiná věc než nespokojenost.
ok('příjem je zelený i u území s problémem',
  box.unieMojeRadek(uzemi({ nespokojenost: 90 })).indexOf('<b class="ok">') >= 0);

// Varování musí být vidět, aniž by hráč řádek rozklikl.
ok('běžící výzva je vidět ze zavřeného řádku',
  box.unieMojeRadek(uzemi({ vyzyvatel_nick: 'Karel' })).indexOf(KAT['unie.radek_vyzva']) >= 0);
ok('nespokojenost nad prahem taky',
  box.unieMojeRadek(uzemi({ nespokojenost: 55 })).indexOf(KAT['unie.radek_nespokojeno']) >= 0);
ok('nesplněný závazek taky',
  box.unieMojeRadek(uzemi({ zavazek_pridano: 0 })).indexOf(KAT['unie.radek_zavazek']) >= 0);
ok('klidné území žádné varování nemá',
  klid.indexOf(KAT['unie.radek_vyzva']) < 0
  && klid.indexOf(KAT['unie.radek_nespokojeno']) < 0
  && klid.indexOf(KAT['unie.radek_zavazek']) < 0);
// Jedno varování, to nejhorší. Dvě by řádek zalomila na tři řádky.
ok('při výzvě se nespokojenost nepřidává',
  box.unieMojeRadek(uzemi({ vyzyvatel_nick: 'Karel', nespokojenost: 90 }))
    .indexOf(KAT['unie.radek_nespokojeno']) < 0);

// ─── Řádek cizího a volného území ────────────────────────────────────────────
const cizi = box.unieCiziRadek({ okres_key: 'c', nazev: 'Pardubice',
  master_nick: 'ConteDeJure', nespokojenost: 50, duvod_vyzvy: 'nespokojenost' });
ok('u cizího je vidět, kdo ho drží', cizi.indexOf('ConteDeJure') >= 0);
ok('a že se o něj dá soutěžit', cizi.indexOf(KAT['unie.radek_lze_vyzvat']) >= 0);
ok('území, o které se soutěžit nedá, to řekne taky',
  box.unieCiziRadek({ nazev: 'X', master_nick: 'Y', nespokojenost: 5 })
    .indexOf(KAT['unie.radek_drzi_se']) >= 0);
// Běžící výzva znamená, že se už soutěží — další vyzyvatel se nepřidává.
ok('během cizí výzvy se vyzvat nenabízí',
  box.unieCiziRadek({ nazev: 'X', master_nick: 'Y', nespokojenost: 90,
    duvod_vyzvy: 'nespokojenost', vyzyvatel_nick: 'Z' })
    .indexOf(KAT['unie.radek_lze_vyzvat']) < 0);
const volne = box.unieVolneRadek({ okres_key: 'v', nazev: 'Olomouc',
  volnych: 14, mist: 14, licence: 22571 });
ok('u volného je cena licence', volne.indexOf('22571') >= 0);
ok('a kolik je v něm volných míst', volne.indexOf('14') >= 0);

// ─── Skládačka ───────────────────────────────────────────────────────────────
const sk = box.unieSkladacka('u:cz', 'HLAVA', 'TELO', 'card');
ok('řádek se dá rozkliknout', /^<details class="sklad card"/.test(sk));
ok('zavřený je výchozí stav', sk.indexOf(' open>') < 0);
ok('hlavička je v summary', /<summary>HLAVA<\/summary>/.test(sk));
ok('a obsah pod ní', /<div class="sklad-telo">TELO<\/div>/.test(sk));
box.UNIE_OTEVRENO['u:cz'] = true;
ok('co bylo rozbalené, zůstane rozbalené',
  box.unieSkladacka('u:cz', 'H', 'T', 'card').indexOf(' open>') > 0);
ok('cizí klíč se tím neotevře',
  box.unieSkladacka('u:jine', 'H', 'T', 'card').indexOf(' open>') < 0);
ok('stav se při rozbalení zapisuje',
  /UNIE_OTEVRENO\[d\.getAttribute\('data-sklad'\)\] = d\.open;/.test(hra));

// ─── Dvě hromádky a souhrn ───────────────────────────────────────────────────
const panel = (hra.match(/function unieHtml\(d\) \{[\s\S]*?\n\}/) || [''])[0];
ok('panel se v kódu našel', panel.length > 400);
ok('moje území jsou zvlášť',
  /var moje = \(d\.uzemi \|\| \[\]\)\.filter\(function \(u\) \{ return u\.moje; \}\);/.test(panel));
ok('a cizí zvlášť',
  /var cizi = \(d\.uzemi \|\| \[\]\)\.filter\(function \(u\) \{ return !u\.moje; \}\);/.test(panel));
ok('volná patří k těm, o která se soutěží',
  panel.indexOf('unie.oddil_soutez') > 0
  && panel.indexOf('volne.map') > panel.indexOf('unie.oddil_soutez'));
// Souhrn v nadpisu je ta odpověď, kvůli které hráč panel otevírá.
ok('v nadpisu je počet i co území nesou',
  /unieOddil\(tx\('unie\.oddil_moje'\), moje\.length, kcFull\(nese\)\)/.test(panel));
ok('a nese se sčítá ze všech mých území',
  /moje\.reduce\(function \(a, u\) \{ return a \+ \(u\.prijem_mesic \|\| 0\); \}, 0\)/.test(panel));
ok('karta území se vkládá bez vlastního obalu',
  /unieUzemiKarta\(u, nast, true\)/.test(panel));

// ─── Místa uvnitř území ──────────────────────────────────────────────────────
// Master má v území klidně třicet míst. Vypsaná pod sebou by z karty udělala
// seznam, ve kterém se nedá nic najít.
ok('skupiny míst jsou taky skládačka',
  /return unieSkladacka\('m:' \+ u\.okres_key \+ ':' \+ klic,/.test(hra));
ok('a každá si nese svůj počet',
  /unieRadek\(nadpis, '', cislo1\(pocet\), 'muted'\)/.test(hra));
ok('klíč skupiny obsahuje území, ať se dvě nepletou',
  /'m:' \+ u\.okres_key \+ ':'/.test(hra));

// ─── Styl ────────────────────────────────────────────────────────────────────
ok('skládačka má vlastní styl', /\.sklad>summary\{/.test(css));
ok('a šipku, podle které je poznat, že jde rozkliknout',
  /\.sklad>summary::after\{/.test(css) && /\.sklad\[open\]>summary::after\{/.test(css));
ok('vlastní značka prohlížeče se schová',
  /\.sklad>summary::-webkit-details-marker\{display:none\}/.test(css));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
