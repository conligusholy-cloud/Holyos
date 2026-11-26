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
  // Křivka od listopadu 2026 kreslí podle času a slévá vzorky do oken —
  // bez těchhle dvou by se ani nespustila.
  vytahni(/function vzorkyPoCase\(body, oken\) \{[\s\S]*?\n\}/, 'vzorkyPoCase'),
  vytahni(/function podilCasu\(body\) \{[\s\S]*?\n\}/, 'podilCasu'),
  vytahni(/function akcieZmeny\(body, kolik\) \{[\s\S]*?\n\}/, 'akcieZmeny'),
  vytahni(/function akcieObchodyGrafu\(body, kolik\) \{[\s\S]*?\n\}/, 'akcieObchodyGrafu'),
  vytahni(/function akcieMaObchody\(body\) \{[\s\S]*?\n\}/, 'akcieMaObchody'),
  vytahni(/function akcieKrivka\(body, maly\) \{[\s\S]*?\n\}/, 'akcieKrivka'),
  vytahni(/function akcieSipka\(f\) \{[\s\S]*?\n\}/, 'akcieSipka'),
  vytahni(/function smerVynosu\(ted, pred\) \{[\s\S]*?\n\}/, 'smerVynosu'),
  vytahni(/function sipkaHtml\(sm\) \{[\s\S]*?\n\}/, 'sipkaHtml'),
];
if (chyb) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
// Okolí, které kreslení potřebuje. Formátování peněz tu nehraje roli,
// takže stačí, aby číslo prošlo tak, jak je.
const box = { esc: (x) => String(x), tx: (k) => k, kcFull: (n) => String(Math.round(n)),
  AKCIE_GRAF_ID: 0 };
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const krivka = box.akcieKrivka, sipka = box.akcieSipka;

// ─── Křivka ──────────────────────────────────────────────────────────────────
const body = (ceny) => ceny.map((c, i) => ({ kdy: '2026-11-0' + (i + 1), cena: c }));
// Pozor na pořadí: plocha pod čarou se kreslí PŘED čarou, takže první
// points= v dokumentu je ona. Čára se bere jmenovitě.
const souradnice = (svg) => {
  const m = svg.match(/<polyline points="([^"]+)"/);
  return m ? m[1].split(' ').map((p) => p.split(',').map(Number)) : [];
};
const plochaZ = (svg) => {
  const m = svg.match(/<polygon points="([^"]+)"/);
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
// ─── Vodorovně se kreslí ZMĚNY, ne čas ───────────────────────────────────────
// Cena se zapisuje i když se nehnula (přeceňování), a klidný týden sežral
// celou šířku grafu — jediný pohyb pak byl svislý schod na kraji. Hráče
// zajímá, jak se cena hýbala, ne jak dlouho stála.
const zmeny = box.akcieZmeny;
ok('rovné úseky se do grafu neberou',
  zmeny(body([100, 100, 100, 100, 110, 110, 120]), 30).map(function (b) { return b.cena; })
    .join(',') === '100,110,120');
ok('bere se posledních N změn',
  zmeny(body([1, 2, 3, 4, 5, 6]), 3).map(function (b) { return b.cena; }).join(',') === '4,5,6');
// Cena, která se ještě nehnula dvakrát, musí dát rovnou čáru — ne prázdno.
// Prázdný graf vypadá jako rozbitá hra.
ok('ustálená cena dá rovnou čáru, ne prázdno',
  zmeny(body([100, 100, 100]), 30).length >= 2);
const ust = krivka(body([100000, 100000, 100000]), false);
ok('a ta čára se opravdu nakreslí', ust.indexOf('<polyline') > 0);

// ─── Graf je graf OBCHODŮ ────────────────────────────────────────────────────
// Řada cen nese i přecenění — zápisy z hodin, kdy se neobchodovalo a cena se
// jen přepočítala podle hodnoty fondu. Těch je drtivá většina: z grafu byla
// dlouhá rovná čára a jediný skutečný obchod vypadal jako osamocený skok na
// kraji. Hráč pak nevěří ani jednomu číslu, co na grafu je.
const vyber = box.akcieObchodyGrafu;
const rada = (l) => l.map(function (x, i) {
  return { kdy: '2026-11-0' + (i + 1), cena: x[0], duvod: x[1] };
});
const smes = rada([[100, 'upis'], [100, 'precena'], [100, 'precena'],
  [140, 'obchod'], [140, 'precena'], [160, 'obchod'], [150, 'obchod']]);
ok('do grafu jdou jen obchody',
  vyber(smes, 30).map(function (b) { return b.cena; }).join(',') === '140,160,150');
ok('a je jich tolik, kolik se obchodovalo', vyber(smes, 30).length === 3);
// Dva obchody za stejnou cenu jsou DVA obchody. Slít je by znamenalo tvrdit,
// že se mezitím neobchodovalo.
const stejne = rada([[100, 'obchod'], [100, 'obchod'], [120, 'obchod']]);
ok('stejná cena dvakrát po sobě jsou dva body',
  vyber(stejne, 30).map(function (b) { return b.cena; }).join(',') === '100,100,120');
ok('bere se posledních N obchodů',
  vyber(rada([[1, 'obchod'], [2, 'obchod'], [3, 'obchod'], [4, 'obchod']]), 2)
    .map(function (b) { return b.cena; }).join(',') === '3,4');
// Dokud se neobchodovalo, je graf o ceně — prázdno vypadá jako rozbitá hra.
const bezObchodu = rada([[100, 'upis'], [110, 'precena'], [120, 'precena']]);
ok('bez obchodů se kreslí změny ceny',
  vyber(bezObchodu, 30).map(function (b) { return b.cena; }).join(',') === '100,110,120');
ok('a je to poznat', box.akcieMaObchody(bezObchodu) === false
  && box.akcieMaObchody(smes) === true);
// Každý obchod je na grafu vidět jako zlom — bez značek se ze tří obchodů
// dá vyčíst leccos, třeba že cena „celou dobu stála a pak skočila".
const sZnackami = krivka(smes, false);
ok('u každého obchodu je značka',
  (sZnackami.match(/<g class="g-znacky">[\s\S]*?<\/g>/) || [''])[0].split('<line').length - 1 === 3);
ok('na malé kartě se značky nekreslí',
  krivka(smes, true).indexOf('g-znacky') < 0);
ok('značka drží tloušťku i v roztažené kartě',
  /<g class="g-znacky">[\s\S]{0,200}vector-effect="non-scaling-stroke"/.test(sZnackami));
// Popisek pod grafem musí mluvit o tom, co je NAKRESLENÉ. Dřív tam stálo
// datum prvního záznamu z celé řady, i když se kreslilo posledních třicet
// obchodů — hráč četl rozpětí, které na grafu vůbec nebylo.
const usekG = (hra.match(/function akcieGraf\(body\) \{[\s\S]*?\n\}/) || [''])[0];
ok('popisek počítá s nakresleným úsekem',
  /var videt = akcieObchodyGrafu\(body, 30\);/.test(usekG));
ok('a říká, kolik obchodů na grafu je',
  /akcie\.obchod_1/.test(usekG) && /akcie\.graf_bez_obchodu/.test(usekG));
ok('nejvyšší cena se bere taky z něj',
  /videt\.forEach\(function \(b\) \{ if \(b\.cena > max\) max = b\.cena; \}\);/.test(usekG));
ok('staré datum „od" pod grafem ceny zmizelo',
  usekG.indexOf('veta.fond_graf_od') < 0);
ok('značky mají svůj styl', /\.akcie-graf \.g-znacky line\{/.test(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.css'), 'utf8')));
// Změny jsou vedle sebe rovnoměrně: o to jde, aby byl na grafu vidět tvar.
const zub = souradnice(krivka(body([100, 110, 100, 110, 100]), false));
ok('změny jsou rozložené rovnoměrně',
  zub.length === 5 && Math.abs(zub[1][0] - 75) < 0.5 && Math.abs(zub[2][0] - 150) < 0.5);
ok('a první i poslední sedí na krajích',
  zub[0][0] === 0 && Math.abs(zub[4][0] - 300) < 0.5);
// Dlouhý klid před jedinou změnou nesmí graf sežrat.
const poKlidu = souradnice(krivka(body([100, 100, 100, 100, 100, 100, 100, 120]), false));
ok('po dlouhém klidu není graf jen schod na kraji',
  poKlidu.length === 2 && poKlidu[0][0] === 0 && Math.abs(poKlidu[1][0] - 300) < 0.5);

// Cena, která se nehnula, nesmí dělit nulou ani vystřelit mimo rám.
const rovne = krivka(body([100000, 100000, 100000]), false);
souradnice(rovne).forEach((b, i) => {
  ok('ustálená cena drží bod ' + i + ' v rámu',
    Number.isFinite(b[1]) && b[1] >= 0 && b[1] <= vyskaZ(rovne));
});
// Malý graf na kartě burzy je nižší, ale jinak stejný.
const m = krivka(body([100000, 101500, 99000]), true);
ok('malý graf je nižší', vyskaZ(m) < vyskaZ(g));
ok('a pozná se podle třídy', /class="akcie-graf [a-z]+ graf-maly"/.test(m));
ok('velký tu třídu nemá', !/graf-maly/.test(g));

// ─── Jak graf vypadá ─────────────────────────────────────────────────────────
// Samotná tenká linka v tmavé kartě vypadala jako čárka tužkou. Pod čarou je
// plocha, která se dolů vytrácí.
ok('pod čarou je plocha', /<polygon points="[^"]+" fill="url\(#akg\d+\)"\/>/.test(g));
const pl = plochaZ(g);
const vys = vyskaZ(g);
ok('plocha je zavřená dolů na obou koncích',
  pl.length === souradnice(g).length + 2 && pl[0][1] === vys && pl[pl.length - 1][1] === vys);
ok('a začíná i končí pod krajními body čáry',
  pl[0][0] === souradnice(g)[0][0] && pl[pl.length - 1][0] === souradnice(g)[souradnice(g).length - 1][0]);
// Přechod se odkazuje přes id. Na jedné obrazovce jich visí vedle sebe pět —
// se stejným id by si všechny vzaly barvu toho prvního.
const a = krivka(body([100000, 101000]), true), b2 = krivka(body([100000, 99000]), true);
const idZ = (svg) => (svg.match(/<linearGradient id="(akg\d+)"/) || [])[1];
ok('každý graf má vlastní id přechodu', !!idZ(a) && !!idZ(b2) && idZ(a) !== idZ(b2));
ok('a čára si tu barvu bere taky', /stop-color="currentColor"/.test(a));
// Barva podle toho, kam cena došla — stejně jako šipka u ceny vedle grafu.
ok('růst je zelený', /class="akcie-graf nahoru/.test(a));
ok('pokles červený', /class="akcie-graf dolu/.test(b2));
ok('a ustálená cena šedá', /class="akcie-graf rovne/.test(krivka(body([100000, 100000]), true)));
// Linky na pozadí patří jen velkému grafu; na kartě by z nich byla mřížka.
ok('velký graf má vodítka', /<g class="g-mrizka">/.test(g));
ok('malý ne', !/g-mrizka/.test(m));
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'compounder',
  'game', 'game.css'), 'utf8');
// Barvu drží jediná vlastnost `color` na svg: čára i přechod si ji berou
// přes currentColor, takže se mění jedním řádkem. Výchozí je pokles.
ok('barvu drží CSS přes color', /\.akcie-graf\{[\s\S]{0,160}color:#/.test(css)
  && /\.akcie-graf\.nahoru\{color:/.test(css)
  && /\.akcie-graf\.rovne\{color:/.test(css));
ok('čára bere barvu z currentColor', /\.akcie-graf \.g-cara\{[\s\S]{0,80}stroke:currentColor/.test(css));

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
const usekTrh = trh.slice(0, trh.indexOf('// Karta na záložce Burza'));
ok('obrazovka trhu se v kódu našla', usekTrh.length > 500 && usekTrh.length < trh.length);

// Dvě patra, která se nesmí splést. Úpis je nákup od fondu za pevnou cenu,
// burza je příkaz do knihy. Kdyby se z obrazovky nepoznalo, které je které,
// hráč klikne na jedno a čeká výsledek druhého.
ok('úpis se ukáže, jen dokud fond má co prodat', /b\.upis_zbyva > 0/.test(usekTrh));
ok('a je u něj vidět, kolik fondu zbývá',
  /akcie\.fond_jeste_proda[\s\S]{0,120}b\.upis_zbyva/.test(usekTrh));
ok('úpis kupuje od fondu starou cestou',
  /apiJson\('\/trade\/akcie\/' \+ id \+ '\/obchod', \{ smer: 'koupit'/.test(usekTrh));
ok('na burze se zadává i cena', /id="ak-cena"/.test(usekTrh));
ok('a příkaz jde do knihy', /'\/prikaz', \{ smer: s, pocet: n, cena: c \}/.test(usekTrh));
ok('formulář posílá přepnutý směr', /posliPrikaz\(smerTed, cislo\('ak-pocet'\)/.test(usekTrh));
ok('směr se dá přepnout', /id="ak-s-koupit"/.test(usekTrh) && /id="ak-s-prodat"/.test(usekTrh));
// Cenové pásmo musí být vidět U POLÍČKA, ne až v chybové hlášce.
ok('meze pásma stojí u ceny',
  /veta\.akcie_pasmo[\s\S]{0,120}b\.mez\.min[\s\S]{0,60}b\.mez\.max/.test(usekTrh));
// A strop toho směru taky: na nákup peníze, na prodej volné kusy.
ok('u nákupu je vidět volná hotovost',
  /veta\.akcie_volna_hotovost[\s\S]{0,80}b\.volna_hotovost/.test(usekTrh));
ok('u prodeje volné kusy', /veta\.akcie_volne_kusy[\s\S]{0,80}b\.volne_kusy/.test(usekTrh));
// Zobchodováno hned vs. leží v knize jsou dvě různé zprávy. Splést je znamená,
// že hráč čeká peníze, které nepřijdou.
ok('po zadání se rozlišuje obchod od čekání',
  /r\.j\.zobchodovano[\s\S]{0,160}veta\.akcie_prikaz_lezi/.test(usekTrh));
ok('vlastní příkaz jde zrušit', /data-ak-zrus/.test(usekTrh));
// Tlačítko „vzít" u řádku knihy. Obchod se jím uzavře jedním klikem, takže
// na něm musí stát, co udělá a za kolik — a nesmí nabízet víc, než se dá.
const hloubkaF = (hra.match(/function akcieVzitKolik\(b, x, smer\) \{[\s\S]*?\n\}/) || [''])[0];
ok('počet k vzetí počítá vlastní funkce', !!hloubkaF);
ok('moje vlastní kusy se z řádku odečtou', /\(x\.pocet \|\| 0\) - \(x\.moje \|\| 0\)/.test(hloubkaF));
ok('na nákup se strop počítá z volné hotovosti',
  /b\.volna_hotovost \|\| 0\) \/ Math\.max\(1, x\.cena\)/.test(hloubkaF));
ok('na prodej z volných kusů', /b\.volne_kusy \|\| 0/.test(hloubkaF));
const hl = hra.slice(hra.indexOf('function akcieHloubkaHtml'));
const usekH = hl.slice(0, hl.indexOf('function akciePrikazyHtml'));
ok('na tlačítku stojí počet i částka', /veta\.akcie_vzit[\s\S]{0,80}kolik \* x\.cena/.test(usekH));
ok('nulový počet tlačítko nekreslí', /kolik > 0 && vejde/.test(usekH));
ok('a cena mimo pásmo taky ne',
  /x\.cena >= b\.mez\.min && x\.cena <= b\.mez\.max/.test(usekH));
// Formulář i tlačítko posílají totéž jednou cestou. Dvě cesty znamenají dvě
// místa, kde se dá splést směr nebo cena.
ok('obě cesty posílají jednou funkcí',
  /var posliPrikaz = function \(s, n, c, btn\)/.test(usekTrh)
  && (usekTrh.match(/posliPrikaz\(/g) || []).length >= 2);
// Potvrzení obchodu neprobliká přes obrazovku — hráč ho právě sám vyvolal
// a hláška uprostřed mu zakrývá knihu. Jde rovnou do zvonku, kde si to
// přečte. Zahodit se nesmí: je to o penězích.
ok('potvrzení obchodu jde do zvonku, ne přes obrazovku',
  /doZvonku\(r\.j\.zobchodovano/.test(usekTrh)
  && !/toast\(r\.j\.zobchodovano/.test(usekTrh));
// Doručenka se po obchodu vyzvedne hned, ať hráč nekouká na staré číslo.
ok('doručenka se po obchodu vyzvedne — u úpisu i u příkazu',
  (usekTrh.match(/vyzvedniNasledky\(\)/g) || []).length >= 2);
ok('zrušení příkazu taky neprobliká', /doZvonku\(tx\('akcie\.prikaz_zrusen'\)/.test(usekTrh));
// Chyby naopak probliknout MUSÍ: ty hráč nečeká a bez nich by klikal naprázdno.
// Chyby naopak probliknout MUSÍ, a to každá: nevyplněný počet, nevyplněná
// cena, odmítnutí serveru i mlčící server. Hráč je nečeká a bez nich by
// klikal naprázdno.
ok('chybí počet — probliká', /return toast\(esc\(tx\('akcie\.vypln'\)\), 'err'\)/.test(usekTrh));
ok('chybí cena — probliká', /return toast\(esc\(tx\('akcie\.vypln_cenu'\)\), 'err'\)/.test(usekTrh));
ok('odmítnutí serveru probliká',
  (usekTrh.match(/return toast\(\(r\.j && r\.j\.error\)/g) || []).length >= 3);
ok('mlčící server taky',
  (usekTrh.match(/toast\(esc\(tx\('mapa\.server_neodpovida_6'\)\), 'err'\)/g) || []).length >= 3);
// Dvakrát stejný obchod po sobě jsou dvě události. Zvonek je pojistkou proti
// zdvojení potlačuje — u potvrzení obchodu se proto obchází.
const zv = hra.slice(hra.indexOf('function doZvonku'));
ok('potvrzení se do zvonku zapíše i podruhé',
  /zapisUpoz\(msg, kind \|\| 'ok', !!vzdy\)/.test(zv.slice(0, 300))
  && /veta\.akcie_prikaz_lezi', \{ p1: r\.j\.zbyva, p2: r\.j\.cena \}\), 'ok', true\)/.test(usekTrh));
// Žádné oznámení už přes obrazovku neprobliká — stohovala se po čtyřech
// a zakrývala přesně to, na co se hráč dívá. Všechno jde do zvonku.
const tst = hra.slice(hra.indexOf('function toast(msg, kind, drz)'));
ok('toast posílá všechno do zvonku',
  /if \(kind !== 'err'\) \{ doZvonku\(msg, kind\); return; \}/.test(tst.slice(0, 900)));
// Chyba je výjimka: je odpovědí na to, co hráč právě zkusil.
ok('a chybu pořád ukáže', /var box = \$\('toasty'\);/.test(tst.slice(0, 1200)));
ok('chyba se do zvonku uloží taky', /doZvonku\(msg, kind\);\n\}/.test(tst.slice(0, 1800)));
const zu = hra.slice(hra.indexOf('function zapisUpoz'));
ok('a zvonek takový zápis umí', /!vzdy && i >= 0/.test(zu.slice(0, 700)));

ok('tlačítko bere počet i cenu z řádku',
  /data-pocet'\), 10\)[\s\S]{0,120}data-cena'\), 10\)/.test(usekTrh));
// Fond akcie nevykupuje — po tom, co to uměl, nesmí v obrazovce nic zbýt.
ok('po výkupu fondem nezbyla stopa',
  !/akcie\.fond_vykoupi/.test(hra) && !/a\.vykoupi/.test(hra));
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

// Poslední obchody: čas a směr. Ze samotného data a ceny se nepozná, jestli
// cena šla nahoru nebo dolů — a při páru obchodů za hodinu ani kdy se staly.
ok('u obchodu je i čas', /casKratce\(o\.kdy\)/.test(usekTrh));
ok('a je vidět, kam cenou hnul',
  /smerVynosu\(o\.cena, o\.zmena == null \? null : o\.cena - o\.zmena\)/.test(usekTrh));
ok('nahoru zeleně, dolů červeně',
  /sm \? \(sm\.nahoru \? 'ok' : 'err'\) : ''/.test(usekTrh));
ok('server poslá změnu proti předchozímu obchodu',
  /zmena: obchody\[i \+ 1\] \? o\.cena - obchody\[i \+ 1\]\.cena : null/.test(routy));
// Čas se skládá z čísel: formát podle češtiny by v jiném jazyce přidal
// dopoledne/odpoledne a řádek obchodu by se rozjel.
const casF = (hra.match(/function casKratce\(x\) \{[\s\S]*?\n\}/) || [''])[0];
ok('čas se nebere z místního formátu', !!casF && !/toLocale/.test(casF));

// Řádek se slíbenou dividendou se musí vejít na JEDEN řádek i na úzkém
// telefonu — zalomený popisek vedle zalomené hodnoty se čte mizerně. Je to
// věc délky textu, takže se hlídá tady: ve všech jazycích krátký tvar.
(function () {
  const fsx = require('fs');
  const pathx = require('path');
  const dlouhe = [];
  ['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'].forEach(function (j) {
    const k = JSON.parse(fsx.readFileSync(pathx.join(__dirname, '..', 'services',
      'game', 'texty', j + '.json'), 'utf8'))['veta.akcie_sazba_na_akcii'] || '';
    // Bez značek: {p1} se nahradí číslem, {penize:p2} částkou. Počítá se, co
    // z věty zbyde navíc — slova a oddělovače.
    const holy = k.replace(/\{[^}]+\}/g, '');
    if (holy.length > 18) dlouhe.push(j + ' (' + holy.trim() + ')');
  });
  ok('slíbená dividenda je krátká ve všech jazycích', dlouhe.length === 0, dlouhe.join(', '));
}());

// Dividenda je to, co fond doopravdy vyplatil — patří k podrobnostem vedle
// nároku, ne místo něj.
ok('podrobnosti ukazují poslední dividendu',
  /akcie\.dividenda_posledni[\s\S]{0,200}a\.dividenda_posledni/.test(usekTrh));
ok('i co se na akcii vyplatilo celkem',
  /akcie\.dividenda_celkem[\s\S]{0,200}a\.dividenda_celkem/.test(usekTrh));
ok('a vysvětlení, že nárok není výplata', /akcie\.dividenda_popis/.test(usekTrh));

// Kniha akcionářů. Kdo dává do fondu peníze, má vědět, s kým je v tom.
ok('z podrobností vede cesta do knihy', /id="ak-kniha"/.test(usekTrh));
ok('a z panelu fondu taky', /id="fond-kniha"/.test(hra));
const kniha = hra.slice(hra.indexOf('function akcieKnihaSheet'));
const usekK = kniha.slice(0, kniha.indexOf('function akcieBurzaSheet'));
ok('kniha ukazuje procenta každého', /pctHra\(x\.podil_akcii\)/.test(usekK));
ok('i co to dělá v celém fondu', /x\.podil_fondu/.test(usekK));
// Nevydané kusy drží fond sám. Bez toho řádku by procenta neseděla na sto
// a vypadalo by to, že zbytek akcií někde zmizel.
ok('a nevydané kusy taky', /akcie\.fond_sam[\s\S]{0,160}k\.nevydano/.test(usekK));
ok('ze knihy se vracíme tam, odkud jsme přišli',
  /\$\('ak-kniha-zpet'\)\.onclick = akcieZpet;/.test(usekK));
// Cesta zpátky se musí schovat a vrátit: z podrobností do knihy a zase zpátky
// do podrobností, aniž by se ztratila cesta na burzu nebo do fondu.
ok('cesta zpátky se přes knihu neztratí',
  /AKCIE_KAM = function \(\) \{ AKCIE_KAM = kam; akcieTrhSheet\(id\); \};/.test(usekTrh));

const kn = routy.slice(routy.indexOf("router.get('/trade/akcie/:id/kniha'"));
const usekKn = kn.slice(0, kn.indexOf("router.post('/trade/akcie/:id/obchod'"));
ok('server knihu počítá službou', /AKCIE\.kniha\(radky, vydano, podil, cena\)/.test(usekKn));
ok('a bere jen ty, kdo něco drží', /pocet: \{ gt: 0 \}/.test(usekKn));
ok('největší držitel je nahoře', /orderBy: \{ pocet: 'desc' \}/.test(usekKn));

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
