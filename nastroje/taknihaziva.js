// Kniha příkazů se musí přepsat ve chvíli, kdy hráč příkaz zadá.
//
// Potvrzení obchodu chodí jen do zvonku — na obrazovce nic neprobliká. Když
// nad formulářem zůstane viset stará kniha, hráč nemá jak poznat, jestli
// příkaz prošel: zadá ho znovu, nebo obnoví hru. Obojí se stalo.
//
// Hlídá se tu troje:
//
//  1. Kniha po mém příkazu. Co se zobchodovalo, ubude protistraně; co zbylo,
//     leží v knize jako můj příkaz. Čísla se tu nepočítají podruhé — říká je
//     server ve své odpovědi, tohle je jen jejich promítnutí.
//  2. Vlastní kusy. Se sebou hráč neobchoduje, takže se z řádku protistrany
//     nesmí ubírat to, co na něm drží sám.
//  3. Výpadek serveru. Jeden neúspěšný dotaz nesmí zahodit, co už máme, ani
//     se zacyklit — dřív si obrazovka o totéž říkala donekonečna.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const hra = fs.readFileSync(path.join(koren, 'public/compounder/game/game.js'), 'utf8');

// Testuje se SKUTEČNÝ kód vytažený z game.js, ne jeho opis.
const kusy = ['akcieKnihaPo', 'akcieKnihaBez'].map(function (n) {
  const m = hra.match(new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}'));
  ok('v game.js se našlo: ' + n, !!m);
  return m ? m[0] : '';
});
const box = {};
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);

const kniha = function () {
  return {
    aliance_id: 7, cena: 1000, pasmo_pct: 30,
    mez: { min: 700, cena: 1000, max: 1300 },
    nabidka: [{ cena: 1000, pocet: 64, moje: 0 }, { cena: 1100, pocet: 5, moje: 0 }],
    poptavka: [],
    prikazy: [], moje_kusy: 10, volne_kusy: 10, zamcene_kusy: 0,
    volna_hotovost: 1000000,
  };
};

// ─── Příkaz, co zůstal ležet ────────────────────────────────────────────────
const lezi = box.akcieKnihaPo(kniha(), { smer: 'koupit', pocet: 3, cena: 900 },
  { zobchodovano: 0, castka: 0, zbyva: 3, cena: 900, cena_po: 0, prikaz_id: 55 });
ok('můj příkaz je v knize hned', lezi.poptavka.length === 1
  && lezi.poptavka[0].pocet === 3 && lezi.poptavka[0].cena === 900);
ok('a je na něm poznat, že je můj', lezi.poptavka[0].moje === 3);
ok('je i mezi mými příkazy', lezi.prikazy.length === 1 && lezi.prikazy[0].id === 55);
ok('peníze pod ním jsou slíbené, ne volné',
  lezi.volna_hotovost === 1000000 - 3 * 900);
ok('protistrana se nehnula', lezi.nabidka[0].pocet === 64);
ok('a cena taky ne, dokud se neobchodovalo', lezi.cena === 1000);

// ─── Příkaz, co se rovnou zobchodoval ───────────────────────────────────────
const vzal = box.akcieKnihaPo(kniha(), { smer: 'koupit', pocet: 2, cena: 1000 },
  { zobchodovano: 2, castka: 2000, zbyva: 0, cena: 1000, cena_po: 1000 });
ok('protistraně ubyly kusy, které jsem vzal', vzal.nabidka[0].pocet === 62);
ok('a kusy mám já', vzal.moje_kusy === 12 && vzal.volne_kusy === 12);
ok('zaplacené peníze nejsou volné', vzal.volna_hotovost === 1000000 - 2000);
ok('v knize po mně nic nezůstalo', vzal.poptavka.length === 0 && vzal.prikazy.length === 0);

// Spotřebuje se nejlepší cena a teprve pak ta další — v tomhle pořadí se páruje.
const velky = box.akcieKnihaPo(kniha(), { smer: 'koupit', pocet: 66, cena: 1100 },
  { zobchodovano: 66, castka: 66200, zbyva: 0, cena: 1100, cena_po: 1100 });
ok('odebírá se od nejlepší ceny dolů',
  velky.nabidka.length === 1 && velky.nabidka[0].cena === 1100
  && velky.nabidka[0].pocet === 3);
ok('cena akcie je poslední obchod', velky.cena === 1100);
ok('a pásmo se posune s ní',
  velky.mez.min === 770 && velky.mez.max === 1430);

// ─── Vlastní kusy na řádku ──────────────────────────────────────────────────
// Se sebou hráč neobchoduje. Kdyby se mu ubíraly vlastní kusy, zmizely by mu
// z knihy příkazy, které pořád běží.
const sMymi = kniha();
sMymi.nabidka[0] = { cena: 1000, pocet: 64, moje: 60 };
const po = box.akcieKnihaPo(sMymi, { smer: 'koupit', pocet: 10, cena: 1100 },
  { zobchodovano: 9, castka: 9400, zbyva: 1, cena: 1100, cena_po: 1100 });
ok('z řádku se ubírají jen cizí kusy',
  po.nabidka[0].cena === 1000 && po.nabidka[0].pocet === 60);
ok('zbytek se vezme z dalšího řádku', po.nabidka.length === 1);
ok('a co se nestihlo, leží v knize jako můj příkaz',
  po.poptavka.length === 1 && po.poptavka[0].cena === 1100 && po.poptavka[0].moje === 1);

// ─── Prodej ─────────────────────────────────────────────────────────────────
const prodej = box.akcieKnihaPo(kniha(), { smer: 'prodat', pocet: 6, cena: 1200 },
  { zobchodovano: 0, castka: 0, zbyva: 6, cena: 1200, cena_po: 0, prikaz_id: 7 });
ok('nabídka se objeví na správné straně knihy',
  prodej.nabidka.filter(function (x) { return x.cena === 1200 && x.moje === 6; }).length === 1);
ok('a kusy pod ní nejsou volné',
  prodej.volne_kusy === 4 && prodej.zamcene_kusy === 6);
ok('držím jich pořád stejně', prodej.moje_kusy === 10);
const prodano = box.akcieKnihaPo(kniha(), { smer: 'prodat', pocet: 4, cena: 900 },
  { zobchodovano: 4, castka: 3600, zbyva: 0, cena: 900, cena_po: 900 });
ok('co se prodalo, mi ubylo a peníze přibyly',
  prodano.moje_kusy === 6 && prodano.volna_hotovost === 1003600);

// ─── Nic se nepřepisuje pod rukama ──────────────────────────────────────────
const puvodni = kniha();
box.akcieKnihaPo(puvodni, { smer: 'koupit', pocet: 2, cena: 1000 },
  { zobchodovano: 2, castka: 2000, zbyva: 0, cena: 1000, cena_po: 1000 });
ok('původní kniha zůstane nedotčená',
  puvodni.nabidka[0].pocet === 64 && puvodni.moje_kusy === 10);

// ─── Zrušený příkaz ─────────────────────────────────────────────────────────
const zrus = box.akcieKnihaBez(lezi, 55);
ok('zrušený příkaz z knihy zmizí', zrus.poptavka.length === 0);
ok('a ze seznamu mých příkazů taky', zrus.prikazy.length === 0);
ok('peníze se uvolní zpátky', zrus.volna_hotovost === 1000000);
ok('cizí příkaz se tím nezruší',
  box.akcieKnihaBez(lezi, 999).poptavka.length === 1);

// ─── Napojení v obrazovce ───────────────────────────────────────────────────
ok('obrazovka přepíše knihu hned po odpovědi',
  /AKCIE_BURZA = akcieKnihaPo\(AKCIE_BURZA, \{ smer: s, pocet: n, cena: c \}, r\.j\);/.test(hra));
ok('a překreslí se dřív, než si řekne o celý přehled',
  /akcieKnihaPo\(AKCIE_BURZA[\s\S]{0,260}akcieTrhSheet\(id, smerTed\);\n        znovu\(\);/.test(hra));
ok('zrušení ubere příkaz z knihy stejně rychle',
  /AKCIE_BURZA = akcieKnihaBez\(AKCIE_BURZA, t\.getAttribute\('data-ak-zrus'\)\);/.test(hra));

// ─── Výpadek serveru ────────────────────────────────────────────────────────
// Dřív se při chybě nastavilo null, obrazovka si o totéž řekla znovu — a z
// jednoho výpadku sítě byla nekonečná smyčka požadavků nad prázdnou knihou.
const nacti = (hra.match(/function loadAkcieBurza\(id, then\) \{[\s\S]*?\n\}/) || [''])[0];
ok('neúspěšné načtení nezahodí, co už máme',
  nacti.indexOf('AKCIE_BURZA = null') < 0
  && /if \(mam\) AKCIE_BURZA = r\.j\.trh;/.test(nacti));
ok('a volajícímu řekne, že to nevyšlo', /then\(false\)/.test(nacti));
const trhu = (hra.match(/function loadAkcieTrh\(id, then\) \{[\s\S]*?\n\}/) || [''])[0];
ok('totéž u ceny a grafu',
  trhu.indexOf('AKCIE_TRH = null') < 0 && /then\(false\)/.test(trhu));
ok('obrazovka se po neúspěchu nevolá znovu',
  /loadAkcieBurza\(id, function \(mam\) \{\n      if \(mam\) akcieTrhSheet\(id, smer\);\n      else toast\(/.test(hra));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
