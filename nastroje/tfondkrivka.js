// Křivka hodnoty fondu: kdy se zapíše nový bod.
//
// Vzorkuje se jednou za hodinu, aby křivka vůbec existovala. Jenže po nákupu
// za šedesát milionů se člen podívá do grafu hned — a viděl rovnou čáru, jako
// by se nestalo nic. Proto se vzorek bere i po každé události, která fondem
// pohne: vklad, výplata, nákup podílu, odchod člena, prodej do nabídky.
//
// Hlídá se obojí: že se bod po změně zapíše, a že se nezapisuje šum.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

const zdroj = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'game', 'fond-historie.js'), 'utf8');
const kus = (zdroj.match(/function stojiZaZapis\(posledni, f\) \{[\s\S]*?\n\}/) || [''])[0];
ok('ve fond-historie.js se našlo: stojiZaZapis', !!kus);
if (!kus) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {};
vm.createContext(box);
vm.runInContext(kus + '\n', box);
const stoji = box.stojiZaZapis;

// ─── Kdy bod přibýt má ───────────────────────────────────────────────────────
const bod = { pokladna: 101375000, hodnota: 139440113 };
ok('první bod se zapíše vždycky', stoji(null, bod) === true);
// Ten skutečný případ: fond koupil 25 % LosPrádlos za 60 milionů.
ok('nákup za 60 milionů se zapíše',
  stoji(bod, { pokladna: 41375000, hodnota: 78065113 }) === true);
ok('vklad se zapíše',
  stoji(bod, { pokladna: 141375000, hodnota: 179440113 }) === true);
// Pokladna stejná, ale firmy v držení vyrostly — hodnota se taky hýbe.
ok('růst firem se zapíše, i když pokladna stojí',
  stoji(bod, { pokladna: 101375000, hodnota: 140000000 }) === true);
ok('pohyb jen v pokladně se zapíše',
  stoji(bod, { pokladna: 101000000, hodnota: 139440113 }) === true);

// ─── Kdy přibýt nemá ─────────────────────────────────────────────────────────
ok('beze změny se nezapisuje', stoji(bod, { pokladna: 101375000, hodnota: 139440113 }) === false);
// Zamčení peněz v nabídce pokladnou nehýbe — a hodnotou taky ne.
ok('vyvěšení nabídky samo o sobě bod nedělá',
  stoji(bod, { pokladna: 101375000, hodnota: 139440113 }) === false);
// Ukládá se zaokrouhleně, takže setina rozdílu bod zakládat nesmí.
ok('setina rozdílu se neřeší',
  stoji({ pokladna: 101375000.4, hodnota: 139440113.2 }, bod) === false);
ok('ale koruna ano',
  stoji({ pokladna: 101375001, hodnota: 139440113 }, bod) === true);

// Bez čísel se nemá co zapisovat — a nesmí to spadnout.
ok('bez nového stavu se nezapisuje', stoji(bod, null) === false);
ok('bez obojího se nezapisuje', stoji(null, null) === false);

// ─── Zapojení ────────────────────────────────────────────────────────────────
// Samotné pravidlo nestačí: vzorek se musí brát po KAŽDÉM pohybu pokladnou,
// a až po dokončení transakce. Jinak by se vzal stav před zápisem.
const routy = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
const pohyby = (routy.match(/pokladna: \{ (increment|decrement)/g) || []).length;
const vzorky = (routy.match(/vzorekFondu\(/g) || []).length;
ok('každý pohyb pokladnou má svůj vzorek', vzorky >= pohyby,
  pohyby + ' pohybů · ' + vzorky + ' vzorků');
// Uvnitř transakce by se vzorek vzal ze stavu PŘED zápisem a graf by ukázal
// čísla, která za chvíli neplatí. Hledá se to poctivě: od každého
// $transaction( se dojde závorka po závorce na jeho konec a uvnitř nesmí
// vzorek být. Volnější regulární výraz tu hlásil planý poplach — `await tx.`
// je v souboru všude.
function teloTransakci(src) {
  const tela = [];
  let i = 0;
  for (;;) {
    const z = src.indexOf('$transaction(', i);
    if (z < 0) break;
    let hloubka = 0, j = src.indexOf('(', z), vRetezci = null, konec = -1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (vRetezci) {
        if (c === '\\') { j++; continue; }
        if (c === vRetezci) vRetezci = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { vRetezci = c; continue; }
      if (c === '(' || c === '{' || c === '[') hloubka++;
      else if (c === ')' || c === '}' || c === ']') {
        hloubka--;
        if (hloubka === 0) { konec = j; break; }
      }
    }
    if (konec < 0) break;
    tela.push(src.slice(z, konec));
    i = konec;
  }
  return tela;
}
const uvnitr = teloTransakci(routy).filter((t) => t.indexOf('vzorekFondu(') >= 0);
ok('vzorek se nebere uvnitř transakce', uvnitr.length === 0,
  uvnitr.length ? 'v ' + uvnitr.length + ' transakci' : '');
ok('selhání vzorku neshodí obchod', /vzorkujFond\([\s\S]{0,120}\.catch\(/.test(routy));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
