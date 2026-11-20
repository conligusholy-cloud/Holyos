// Burza akcií pod vlastní ikonou na mapě.
//
// Hráč tu vidí, co je v oběhu: graf, dnešní cenu a šipku. Podle toho se
// rozhoduje o skutečných penězích, takže tři věci musí sedět vždycky:
//
//  1. Graf — křivka se musí vejít do rámu a nesmí spadnout na rovnou čáru
//     u ceny, která se hýbe o procenta. Rovná čára u drahé akcie je lež.
//  2. Šipka — měří se proti ceně na začátku grafu, aby ukazovala přesně
//     ten pohyb, který je nad ní vidět. Bez obchodu se nekreslí: první
//     den akcie není propad.
//  3. Návrat — kdo si otevře obchod ze seznamu, musí se do seznamu vrátit.
//     Tohle hru už jednou vyhodilo z fondu na mapu.
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
  vytahni(/function akcieKrivka\(body, maly\) \{[\s\S]*?\n\}/, 'akcieKrivka'),
  vytahni(/function akcieSipka\(f\) \{[\s\S]*?\n\}/, 'akcieSipka'),
  vytahni(/function smerVynosu\(ted, pred\) \{[\s\S]*?\n\}/, 'smerVynosu'),
  vytahni(/function sipkaHtml\(sm\) \{[\s\S]*?\n\}/, 'sipkaHtml'),
];
if (chyb) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
// Okolí, které kreslení potřebuje. Formátování peněz tu nehraje roli,
// takže stačí, aby číslo prošlo tak, jak je.
const box = { esc: (x) => String(x), tx: (k) => k, kcFull: (n) => String(Math.round(n)) };
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const krivka = box.akcieKrivka, sipka = box.akcieSipka;

// ─── Křivka ──────────────────────────────────────────────────────────────────
const body = (ceny) => ceny.map((c, i) => ({ kdy: '2026-11-0' + (i + 1), cena: c }));
const souradnice = (svg) => {
  const m = svg.match(/points="([^"]+)"/);
  return m ? m[1].split(' ').map((p) => p.split(',').map(Number)) : [];
};
const vyskaZ = (svg) => Number((svg.match(/viewBox="0 0 \d+ (\d+)"/) || [])[1]);

ok('jeden obchod ještě graf nedělá', krivka(body([100000]), false) === '');
ok('ani prázdno', krivka([], false) === '' && krivka(null, false) === '');
const g = krivka(body([100000, 101500, 99000, 103000]), false);
ok('ze čtyř obchodů je čára o čtyřech bodech', souradnice(g).length === 4);
ok('kreslí se zleva doprava', souradnice(g)[0][0] === 0 && souradnice(g)[3][0] === 300);
souradnice(g).forEach((b, i) => {
  ok('bod ' + i + ' se vejde do rámu', b[1] >= 0 && b[1] <= vyskaZ(g));
});
ok('nejdražší obchod je nejvýš nahoře', souradnice(g)[3][1] === 0);
// Tohle je ta podstatná věc. Kdyby se začínalo od nuly, pohyb o procenta by
// u drahé akcie splynul v rovnou čáru a graf by byl k ničemu.
const male = souradnice(krivka(body([100000, 101000]), false));
ok('pohyb o procento je v grafu vidět', Math.abs(male[0][1] - male[1][1]) > 10);
// Cena, která se nehnula, nesmí dělit nulou ani vystřelit mimo rám.
const rovne = krivka(body([100000, 100000, 100000]), false);
souradnice(rovne).forEach((b, i) => {
  ok('ustálená cena drží bod ' + i + ' v rámu',
    Number.isFinite(b[1]) && b[1] >= 0 && b[1] <= vyskaZ(rovne));
});
// Malý graf na kartě burzy je nižší, ale jinak stejný.
const m = krivka(body([100000, 101500, 99000]), true);
ok('malý graf je nižší', vyskaZ(m) < vyskaZ(g));
ok('a pozná se podle třídy', /class="fond-graf graf-maly"/.test(m));
ok('velký tu třídu nemá', !/graf-maly/.test(g));

// ─── Šipka u ceny ────────────────────────────────────────────────────────────
ok('růst proti začátku grafu je nahoru',
  sipka({ cena: 101500, cena_drive: 100000 }).indexOf('↑') > 0);
ok('pokles je dolů', sipka({ cena: 99000, cena_drive: 100000 }).indexOf('↓') > 0);
ok('a je u ní o kolik', sipka({ cena: 101500, cena_drive: 100000 }).indexOf('1500') > 0);
ok('pokles ukazuje rozdíl bez znaménka',
  sipka({ cena: 99000, cena_drive: 100000 }).indexOf('-') < 0);
// Bez obchodu není proti čemu měřit. Nula tu není pokles — první den akcie
// by jinak vypadal jako propad o celou cenu.
ok('bez obchodu se šipka nekreslí', sipka({ cena: 100000, cena_drive: null }) === '');
ok('ustálená cena šipku nemá', sipka({ cena: 100000, cena_drive: 100000 }) === '');

// ─── Zapojení v kódu ─────────────────────────────────────────────────────────
ok('burza má na mapě vlastní ikonu',
  /getElementById\('akcie-btn'\)/.test(hra) && /akcieBtn\.onclick = akcieBurzaSheet/.test(hra));
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'compounder',
  'game', 'index.html'), 'utf8');
ok('a ikona v hře doopravdy je', /id="akcie-btn"/.test(html));

const seznam = hra.slice(hra.indexOf('function akcieKartaHtml'));
const usekSeznam = seznam.slice(0, seznam.indexOf('function akcieTrhSheet'));
ok('na kartě je graf', /akcieKrivka\(f\.graf, true\)/.test(usekSeznam));
// Cena je spekulace, tohle je výdělek. Kdo vidí jen graf, kupuje naslepo.
ok('na kartě je i to, co akcie nese',
  /akcie\.nese_mesicne/.test(usekSeznam) && /kcFull\(f\.na_akcii_mesicne\)/.test(usekSeznam));
ok('a výnos v procentech', /akcieVynosHtml\(f\)/.test(usekSeznam));
ok('na kartě je cena i šipka', /kcFull\(f\.cena\)/.test(usekSeznam) && /akcieSipka\(f\)/.test(usekSeznam));
ok('a rovnou obě tlačítka', /data-akcie-koupit/.test(usekSeznam) && /data-akcie-prodat/.test(usekSeznam));
// Prodat nejde, co nedržím. Tlačítko, které jen spadne na chybu, je horší
// než tlačítko, které je vidět zhasnuté.
ok('prodej je zhasnutý, dokud akcie nedržím',
  /f\.moje_kusy \? '' : ' disabled'/.test(usekSeznam));
ok('karta se dá rozkliknout k podrobnostem', /data-akcie-karta/.test(usekSeznam));
// Stejná karta na obou místech: pod ikonou na mapě i v záložce Burza. Dvě
// různé podoby téhož by hráč četl jako dvě různé věci.
ok('záložka Burza kreslí stejnou kartu', /l\.map\(akcieKartaHtml\)\.join\(''\)/.test(hra));
ok('a napájí se jedním místem', /function akcieNapoj\(box\)/.test(hra)
  && (hra.match(/akcieNapoj\(/g) || []).length >= 3);
ok('kliknutí na tlačítko kartu neotevře',
  /closest\('button'\)\) return;/.test(seznam.slice(0, seznam.indexOf('function akcieTrhSheet'))));

const trh = hra.slice(hra.indexOf('function akcieTrhSheet'));
const usekTrh = trh.slice(0, trh.indexOf('// Karta na Burze'));
// Se zadaným směrem je to rovnou obchod: jedno tlačítko, žádné druhé.
ok('se zadaným směrem je jen jedno tlačítko', /jenSmer\s*\n?\s*\?\s*'<button/.test(usekTrh));
ok('a vede z něj cesta k podrobnostem', /id="ak-detail"/.test(usekTrh));
// I v obchodu musí být vidět strop toho směru. Hráč jinak zadá počet a dozví
// se až z chybové hlášky, že fond tolik kusů nemá nebo na ně nemá peníze.
const vetev = (function () {
  const i = usekTrh.indexOf('+ (jenSmer\n');
  const j = usekTrh.indexOf(': podrobnosti)', i);
  return i > 0 && j > i ? usekTrh.slice(i, j) : '';
}());
ok('větev se zadaným směrem se v kódu našla', !!vetev);
ok('při prodeji je v obchodu vidět, kolik fond vykoupí',
  /akcie\.fond_vykoupi/.test(vetev) && /a\.vykoupi/.test(vetev));
ok('a při nákupu, kolik ještě prodá',
  /akcie\.fond_jeste_proda/.test(vetev) && /a\.volne/.test(vetev));
// Návrat. Zavřít se musí tam, odkud hráč přišel.
ok('zavřít vede zpátky, ne na mapu', /\$\('ak-zavrit'\)\.onclick = akcieZpet/.test(usekTrh));
const zpet = hra.slice(hra.indexOf('function akcieZpet'));
// Cíl návratu je funkce, ne jméno místa: obchod se otevírá ze seznamu burzy
// i z panelu fondu a do obojího se musí vracet tam, odkud hráč přišel.
ok('návrat se volá, když je kam', /typeof kam === 'function'\) return kam\(\)/.test(zpet.slice(0, 400)));
ok('a zahodí se, ať nezbyde na příště',
  /var kam = AKCIE_KAM;\s*\n\s*AKCIE_KAM = null;/.test(zpet.slice(0, 400)));
ok('seznam burzy se jako cíl návratu nastavuje',
  /AKCIE_KAM = akcieBurzaSheet;/.test(hra));
ok('zavřené okno návratové místo zahodí',
  /function closeSheet\(\) \{[^}]*AKCIE_KAM = null/.test(hra));
// Po obchodu je seznam zastaralý — cena i počty se pohnuly.
ok('po obchodu se seznam zahodí', /AKCIE_SEZNAM = null;/.test(usekTrh));

// ─── Co posílá server ────────────────────────────────────────────────────────
const routy = fs.readFileSync(path.join(__dirname, '..', 'routes',
  'game-trade.routes.js'), 'utf8');
const r = routy.slice(routy.indexOf("router.get('/trade/akcie'"));
const usekR = r.slice(0, r.indexOf("router.get('/trade/akcie/:id'"));
ok('seznam nese graf', /graf,/.test(usekR));
// Graf už není řada obchodů, ale řada CEN: cena se hybe i tehdy, když se
// s akciemi neobchoduje a jen se pohnula hodnota fondu.
ok('graf se čte z řady cen', /CENA\.radaCen\(f\.id, AKCIE_GRAF_SEZNAM\)/.test(usekR));
ok('a nese cenu, proti které se šipka měří',
  /cena_drive: graf\.length \? graf\[0\]\.cena : null/.test(usekR));
ok('bez obchodu je null, ne nula', !/cena_drive: graf\.length \? graf\[0\]\.cena : 0/.test(usekR));

// ─── Akcie v panelu fondu ────────────────────────────────────────
// Člen vidí vklady členů. Vedle nich stojí kapitál od akcionářů a cena, za
// kterou se jeho fond prodává — bez toho mu z panelu chíbí půl příběhu.
const vnitrek = hra.slice(hra.indexOf('function fondVnitrek'));
const usekF = vnitrek.slice(0, vnitrek.indexOf('var FOND_KAM'));
ok('panel fondu ukazuje kapitál z akcií',
  /fond\.akcie_kapital[\s\S]{0,120}kcFull\(f\.akcie_kapital\)/.test(usekF));
ok('a graf ceny akcie', /akcieKrivka\(f\.akcie_graf, true\)/.test(usekF));
ok('i dnešní cenu', /kcFull\(f\.akcie_cena\)/.test(usekF));
ok('rozdíl mezi vybraným a vykoupeným je vidět',
  /f\.akcie_vybrano[\s\S]{0,60}f\.akcie_vyplaceno/.test(usekF));
// Fond, který akcie nevydal, nemá co ukazovat — řádek s nulou nikomu nic neřekne.
ok('fond bez akcií blok nemá', /if \(f\.akcie_celkem > 0\) \{/.test(usekF));
ok('z fondu vede cesta na burzu', /id="fond-burza"/.test(usekF));
ok('a z burzy zpátky do fondu',
  /AKCIE_KAM = fondZavriAZnovu;/.test(hra));

// Dividenda je to, co fond doopravdy vyplatil — patří k podrobnostem vedle
// nároku, ne místo něj.
ok('podrobnosti ukazují poslední dividendu',
  /akcie\.dividenda_posledni[\s\S]{0,200}a\.dividenda_posledni/.test(usekTrh));
ok('i co se na akcii vyplatilo celkem',
  /akcie\.dividenda_celkem[\s\S]{0,200}a\.dividenda_celkem/.test(usekTrh));
ok('a vysvětlení, že nárok není výplata', /akcie\.dividenda_popis/.test(usekTrh));

// Co posílá server do seznamu a detailu akcií.
const rA = routy.slice(routy.indexOf('async function akcieVynosy'));
const usekV = rA.slice(0, rA.indexOf('// Kolik obchod'));
ok('výnos fondu se bere z držeb, ne z pokladny', /HIST\.drzby\(\)/.test(usekV));
ok('dividendy jen z provedených návrhů',
  /druh: 'akcie_dividenda', stav: 'proveden'/.test(usekV));
ok('poslední dividenda je ta nejnovější', /orderBy: \{ id: 'desc' \}/.test(usekV));
ok('nárok na akcii počítá služba', /AKCIE\.vynosNaAkcii\(vyn\.nese/.test(routy));

// Co posílá server do panelu fondu.
const fondR = routy.slice(routy.indexOf("router.get('/trade/aliance/fond'"));
const usekFR = fondR.slice(0, 6000);
ok('fond nese kapitál z akcií', /akcie_kapital: akcieKap\.kapital/.test(usekFR));
ok('a graf ceny', /akcie_graf: akcieObchody\.slice\(-30\)/.test(usekFR));
ok('kapitál počítá služba, ne routa',
  /require\('\.\.\/services\/game\/akcie'\)\.kapital\(akcieObchody\)/.test(usekFR));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
