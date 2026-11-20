// Nákup více kiosků jednoho druhu naráz.
//
// Kdo staví deset stejných prádlomatů, neměl by klikat desetkrát. Objednávka
// na víc kusů ale sahá na peníze a na sklad, takže musí sedět čtyři věci:
//
//  1. Cena — financuje se celá objednávka, ne jeden kus. Kdyby se úvěr počítal
//     z ceny za kus, dostal by hráč deset strojů za peníze na jeden.
//  2. Klíč zásilky — orderedAt pozná zásilku u Expresního dovozu. Dva kusy
//     objednané ve stejnou milisekundu by ho sdílely a karta by zrychlila oba.
//  3. „Dorazí hned" — úleva pro člověka, který hru vidí poprvé, platí jen pro
//     PRVNÍ kus. Jinak by si nováček objednal deset strojů bez čekání.
//  4. Hlášení serveru — jeden záznam na kus. Server zakládá jednu objednávku
//     na kus a z každé počítá provizi tomu, kdo hráče přivedl.
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
  vytahni(/var NAKUP_MAX = \d+;/, 'NAKUP_MAX'),
  vytahni(/function buyPocet\(n\) \{[\s\S]*?\n\}/, 'buyPocet'),
  vytahni(/function buyZasilky\(modelKey, n, ted, hned, zaMs\) \{[\s\S]*?\n\}/, 'buyZasilky'),
];
if (chyb) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {};
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const pocet = box.buyPocet, zasilky = box.buyZasilky, MAX = box.NAKUP_MAX;

// ─── Kolik kusů ──────────────────────────────────────────────────────────────
ok('jeden kus je jeden kus', pocet(1) === 1);
ok('deset je deset', pocet(10) === 10);
// Prázdné políčko nebo nesmysl znamená jeden, ne nula a ne pád.
ok('prázdno je jeden', pocet('') === 1 && pocet(null) === 1 && pocet(undefined) === 1);
ok('nesmysl je jeden', pocet('pět') === 1 && pocet(NaN) === 1);
ok('nula ani zápor neprojdou', pocet(0) === 1 && pocet(-5) === 1);
ok('půlka stroje se neobjednává', pocet(2.9) === 2);
// Strop je tu kvůli frontě hlášení: každý kus je v ní jeden záznam a ta má
// vlastní strop. Bez omezení by se objednávka na tisíc kusů o ni otloukla.
ok('nad strop to nejde', pocet(MAX + 50) === MAX);
ok('a strop je rozumný', MAX >= 5 && MAX <= 50, String(MAX));

// ─── Zásilky ─────────────────────────────────────────────────────────────────
const TED = 1764000000000, ZA = 86400000;
const z = zasilky('flex', 5, TED, false, ZA);
ok('pět kusů je pět zásilek', z.length === 5);
ok('každá má svůj model', z.every((x) => x.model === 'flex'));
// Tohle je ta past: stejný klíč by z Expresního dovozu udělal kartu na všechno.
const klice = new Set(z.map((x) => x.orderedAt));
ok('každá zásilka má vlastní klíč', klice.size === 5);
ok('klíče jdou po sobě', z[0].orderedAt === TED && z[4].orderedAt === TED + 4);
ok('všechny dorazí ve stejnou chvíli', z.every((x) => x.arrivesAt === TED + ZA));
ok('a žádná není „hned"', z.every((x) => x.hned === false));

// ─── Úleva pro nováčka ───────────────────────────────────────────────────────
// První stroj dorazí hned, aby člověk, který hru vidí poprvé, nečekal den.
// Zbytek objednávky jede normální cestou — jinak by to byla sleva na dodací
// lhůtu pro celý sklad.
const zh = zasilky('mini', 4, TED, true, ZA);
ok('první kus dorazí hned', zh[0].hned === true && zh[0].arrivesAt === TED);
ok('druhý už čeká', zh[1].hned === false && zh[1].arrivesAt === TED + ZA);
ok('a zbytek taky', zh.slice(1).every((x) => x.hned === false));
ok('jediný kus nováčka dorazí hned',
  zasilky('mini', 1, TED, true, ZA)[0].arrivesAt === TED);
// Nesmyslný počet nesmí vyrobit prázdnou ani nekonečnou objednávku.
ok('nesmyslný počet dá jednu zásilku', zasilky('flex', 'x', TED, false, ZA).length === 1);
ok('a nad strop se nepřeleze', zasilky('flex', 999, TED, false, ZA).length === MAX);

// ─── Zapojení ────────────────────────────────────────────────────────────────
const bs = hra.slice(hra.indexOf('function buySheet(modelKey, drz, pocet)'));
const usek = bs.slice(0, bs.indexOf('\n// ─── Panel: instalace'));
ok('panel nákupu má políčko na počet', /id="buy-pocet"/.test(usek));
ok('a strop políčka sedí se stropem v kódu',
  /max="'\s*\n?\s*\+ NAKUP_MAX/.test(usek));
// Financuje se celá objednávka. Tohle je ta chyba, která by stála peníze.
ok('cena je za kus krát počet', /var cena = zaKus \* n;/.test(usek));
ok('a banka posuzuje tu celou', /canFinance\(cena, FIN_OWN, zamerStrop\(modelKey, cena\)\)/.test(usek));
// Změna počtu musí překreslit celý panel: s cenou se hne akontace i úvěr.
ok('změna počtu překreslí panel', /pole\.onchange = function \(\) \{ buySheet\(modelKey, false, pole\.value\); \}/.test(usek));
// Jeden záznam do fronty na KAŽDÝ kus — server zakládá jednu objednávku na kus.
ok('do fronty jde každý kus zvlášť',
  /buyZasilky\([\s\S]{0,800}doFronty\(z\.model, z\.hned\)/.test(usek));
ok('a do skladu taky', /S\.orders\.push\(\{ model: z\.model, orderedAt: z\.orderedAt/.test(usek));
// Panel se otevírá z obchodu — bez toho by nové políčko nikdo neviděl.
ok('obchod panel otevírá', /b\.onclick = function \(\) \{ buySheet\(b\.getAttribute\('data-buy'\)\); \}/.test(hra));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
