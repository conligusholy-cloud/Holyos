// Celková hodnota fondu v panelu.
//
// Člen viděl jen pokladnu — a pokladna je ta menší půlka. Druhá, často větší,
// leží v podílech ve firmách, které fond koupil. Přitom při odchodu z fondu
// se vyplácí díl CELKU, ne vklad a ne pokladna, takže bez celkového čísla se
// člen nemá podle čeho rozhodnout.
//
// Nad grafem stálo vpravo jen číslo — vrchol křivky. Četlo se jako dnešní
// hodnota fondu a bylo o desítky milionů jinde.
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
const koren = path.join(__dirname, '..');
const hra = fs.readFileSync(path.join(koren, 'public/compounder/game/game.js'), 'utf8');
const m = hra.match(/function fondHodnota\(f\) \{[\s\S]*?\n\}/);
ok('v game.js se našlo: fondHodnota', !!m);
if (!m) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {};
vm.createContext(box);
vm.runInContext(m[0], box);
const H = box.fondHodnota;

// ─── Rozpad ──────────────────────────────────────────────────────────────────
let h = H({ hodnota_fondu: 152772873, pokladna: 16628471 });
ok('celek je to, co spočítal server', h.celkem === 152772873, '— ' + h.celkem);
ok('v podílech leží zbytek', h.podily === 152772873 - 16628471, '— ' + h.podily);
ok('a pokladna zůstává pokladnou', h.pokladna === 16628471);
ok('části dávají dohromady celek', h.pokladna + h.podily === h.celkem);

// Fond, který ještě nic nekoupil: celá hodnota je v pokladně a řádek
// „v podílech" musí být nula, ne záporné číslo.
h = H({ hodnota_fondu: 5000000, pokladna: 5000000 });
ok('fond bez podílů má v podílech nulu', h.podily === 0 && h.celkem === 5000000);

// Pokladna vyšší než celek nesmí udělat záporný řádek — to by vypadalo, že
// fond dluží. Stát se to může mezi dvěma výpočty na serveru.
h = H({ hodnota_fondu: 1000, pokladna: 5000 });
ok('nesmyslný vstup neudělá záporné podíly', h.podily === 0, '— ' + h.podily);

// Prázdno z nenačteného fondu nesmí shodit panel.
h = H(null);
ok('bez dat jsou samé nuly', h.celkem === 0 && h.pokladna === 0 && h.podily === 0);
h = H({});
ok('a prázdný fond taky', h.celkem === 0 && h.podily === 0);

// Celek se nesmí v hře dopočítávat z pokladny a podílů — jediný, kdo zná
// cenu podílů, je server.
ok('celek se nepřepočítává v hře', /hodnota_fondu/.test(m[0]));

// ─── Panel ───────────────────────────────────────────────────────────────────
const KAT = JSON.parse(fs.readFileSync(path.join(koren, 'services/game/texty/cs.json'), 'utf8'));
['fond.hodnota_celkem', 'fond.v_podilech', 'veta.fond_graf_max'].forEach((k) => {
  ok('katalog má ' + k, !!KAT[k]);
});
ok('panel fondu celkovou hodnotu ukazuje',
  /fond\.hodnota_celkem/.test(hra) && /hod\.celkem/.test(hra));
ok('a ukazuje i, kolik z toho leží v podílech',
  /fond\.v_podilech/.test(hra) && /hod\.podily/.test(hra));
ok('číslo nad grafem je označené jako vrchol křivky',
  !/\+ kcFull\(max\) \+ '<\/span><\/div>'/.test(hra) && /veta\.fond_graf_max/.test(hra));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
