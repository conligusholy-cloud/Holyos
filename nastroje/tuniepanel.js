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
  mn: (n, a, b, c) => (n === 1 ? a : (n >= 2 && n <= 4) ? b : c),
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
// Samotné slovo „závazek" na odznaku byla hádanka: hráč nevěděl, co po něm
// území chce ani kolik toho zbývá. Na odznaku musí stát to, co chybí.
const seZavazkem = box.unieMojeRadek(uzemi({ zavazek: 4, zavazek_pridano: 0 }));
ok('nesplněný závazek je vidět ze zavřeného řádku', seZavazkem.indexOf('warn') >= 0);
ok('a je na něm, kolik prádlomatů chybí',
  seZavazkem.indexOf('chybí 4 prádlomaty') >= 0, seZavazkem);
ok('skloňuje se podle počtu',
  box.unieMojeRadek(uzemi({ zavazek: 1, zavazek_pridano: 0 })).indexOf('chybí 1 prádlomat') >= 0
  && box.unieMojeRadek(uzemi({ zavazek: 7, zavazek_pridano: 0 })).indexOf('chybí 7 prádlomatů') >= 0);
ok('počítá se, co zbývá, ne celý závazek',
  box.unieMojeRadek(uzemi({ zavazek: 4, zavazek_pridano: 3 })).indexOf('chybí 1 prádlomat') >= 0);
ok('klidné území žádné varování nemá',
  klid.indexOf(KAT['unie.radek_vyzva']) < 0
  && klid.indexOf(KAT['unie.radek_nespokojeno']) < 0
  && klid.indexOf('chybí') < 0);
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

// ─── Panel se hlídá sám ──────────────────────────────────────────────────────
// Hráč natáhne přípojky z panelu a zavře kartu. Když panel pod ní dál tvrdí
// „chybí přípojky", vypadá to, že se akce nepovedla — a hráč ji udělá znovu.
const zive = ['unieSkupinaMista', 'trhMoje', 'unieOtisk', 'unieSrovnejMista']
  .map(function (n) {
    const m = hra.match(new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}'));
    ok('v game.js se našlo: ' + n, !!m);
    return m ? m[0] : '';
  });
const ziv = { CLAIMS: {}, TRH: null, S: { revealed: {} }, UNIE: null, UNIE_OTEVRENO: {} };
vm.createContext(ziv);
vm.runInContext(zive.join('\n'), ziv);

const misto = { spot_id: 's1', nazev: 'Billa', mesto: 'Bruntál',
  pozemek: true, pripojky: 0, model: '', na_marketu: false };
ok('holý zábor je rozdělaný', ziv.unieSkupinaMista(misto) === 'rozdelane');
ok('s přípojkami se dá nabídnout',
  ziv.unieSkupinaMista({ pripojky: 120000 }) === 'lze');
ok('se strojem taky', ziv.unieSkupinaMista({ model: 'flex' }) === 'lze');
ok('co visí na Market place, patří k visícím',
  ziv.unieSkupinaMista({ model: 'flex', na_marketu: true }) === 'visi');
// Tohle je ta vazba, kvůli které se skupiny nemůžou rozejít: seznam i hlídka
// se ptají stejné funkce.
const mista = (hra.match(/function unieMistaHtml\(u\) \{[\s\S]*?\n\}/) || [''])[0];
ok('seznam skládá skupiny touž funkcí',
  /unieSkupinaMista\(m\) === k/.test(mista));

// Hráč natáhl přípojky: hra to ví ze záboru dřív, než se ozve server.
ziv.UNIE = { uzemi: [{ okres_key: 'h3abc', mista: [misto] }] };
ziv.CLAIMS = { s1: { mine: true, model: '', pripraveno: true, pozemek: true } };
ziv.unieSrovnejMista();
ok('místo po akci přeskočí do správné skupiny',
  ziv.unieSkupinaMista(ziv.UNIE.uzemi[0].mista[0]) === 'lze');
ok('a ta skupina se rovnou otevře, ať se řádek neztratí',
  ziv.UNIE_OTEVRENO['m:h3abc:lze'] === true);

// Dokud se trh nenačetl, nabídky se nesahají — prázdný seznam neznamená,
// že na Market place nic nevisí.
ziv.UNIE.uzemi[0].mista[0].na_marketu = true;
ziv.unieSrovnejMista();
ok('nenačtený trh nesmí shodit visící nabídku',
  ziv.UNIE.uzemi[0].mista[0].na_marketu === true);
ziv.TRH = [];
ziv.unieSrovnejMista();
ok('načtený trh ji srovná podle skutečnosti',
  ziv.UNIE.uzemi[0].mista[0].na_marketu === false);

// Otisk: hlídka podle něj pozná, že má smysl sáhnout na server.
const o1 = ziv.unieOtisk();
ok('otisk se beze změny nehýbe', ziv.unieOtisk() === o1);
ziv.CLAIMS.s1.model = 'flex';
ok('postavený stroj otisk změní', ziv.unieOtisk() !== o1);
const o2 = ziv.unieOtisk();
ziv.S.revealed.x = true;
ok('a nově objevené místo taky', ziv.unieOtisk() !== o2);

ok('hlídka sáhne na server jen při změně',
  /function unieHlidej\(\) \{\n  if \(unieOtisk\(\) === UNIE_OTISK\) return;/.test(hra));
ok('panel Unie je v řadě překreslování hry',
  /else if \(!\$\('net-unie'\)\.classList\.contains\('hidden'\)\) unieHlidej\(\);/.test(hra));
ok('a otisk se zapisuje při každém překreslení panelu',
  /UNIE_OTISK = unieOtisk\(\);/.test(hra));

// ─── Co je rozvojový závazek ────────────────────────────────────────────────
// „Rozvojový závazek 0 / 4" samo o sobě je hádanka. Co to je a co se stane,
// když se to nesplní, musí stát rovnou pod tím — jinak hráč kouká na
// varování, kterému nerozumí, a nic s ním neudělá.
const karta = hra.slice(hra.indexOf('function unieUzemiKarta(u, nast, holy)'),
  hra.indexOf('function unieUzemiKarta(u, nast, holy)') + 3000);
ok('pod číslem závazku stojí, co to je',
  /veta\.unie_zavazek_popis/.test(karta));
ok('a ta věta říká, co se stane, když se nesplní',
  /vyzvat/.test(KAT['veta.unie_zavazek_popis'] || ''));
ok('skloňuje se i tam',
  /mn\(u\.zavazek, tx\('hra\.pradlomat'\)/.test(karta));
ok('rada „Co teď" skloňuje taky',
  /veta\.unie_rada_zavazek', \{ p1: cislo1\(zbyva\),\n      p2: mn\(zbyva/.test(hra)
  && (KAT['veta.unie_rada_zavazek'] || '').indexOf('{p2}') > 0);
// Mrtvý odznak se nemá kam vrátit.
ok('holé slovo „závazek" z katalogu zmizelo',
  !KAT['unie.radek_zavazek'] && hra.indexOf('unie.radek_zavazek') < 0);

// ─── Styl ────────────────────────────────────────────────────────────────────
ok('skládačka má vlastní styl', /\.sklad>summary\{/.test(css));
ok('a šipku, podle které je poznat, že jde rozkliknout',
  /\.sklad>summary::after\{/.test(css) && /\.sklad\[open\]>summary::after\{/.test(css));
ok('vlastní značka prohlížeče se schová',
  /\.sklad>summary::-webkit-details-marker\{display:none\}/.test(css));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
