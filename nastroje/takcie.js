// Akcie fondu: kolik se vydáním prodá a jak se páruje pořadník nabídek.
//
// Dvě místa, kde chyba stojí skutečné peníze hráčů:
//
//  1. Vydání. Hlasuje se o ceně a počtu kusů, ne o procentu — kolik fondu se
//     tím prodalo, musí vyjít samo. Když se spočítá moc, členové přijdou
//     o díl, který neprodali; když málo, akcionáři zaplatí za vzduch.
//  2. Párování. Cena obchodu je cena nabídky, která ležela DŘÍV. Kdyby se
//     brala cena příchozího, dal by se trh dojit tím, kdo klikne rychleji.
const A = require('../services/game/akcie');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const blizko = (a, b) => Math.abs(a - b) < 1e-9;

// ─── Vydání ──────────────────────────────────────────────────────────────────
// Fond za sto milionů vydá tisíc akcií po dvaceti tisících = dvacet milionů.
// Po vydání má hodnotu 120 a akcionáři drží 20/120, tedy šestinu.
const v = A.vydani(100000000, 0, 0, 1000, 20000);
ok('vydání projde', v.ok === true);
ok('vybere se počet krát cena', v.vybrano === 20000000);
ok('hodnota fondu o to vzroste', v.hodnota_po === 120000000);
ok('akcionáři drží šestinu', blizko(v.podil_po, 20000000 / 120000000));
ok('členům zbyde pět šestin', blizko(A.dilClenu(v.podil_po), 100000000 / 120000000));
ok('o tolik se členům díl zředí', blizko(v.redeni, 1 / 6));

// Druhé vydání staví na prvním: dosavadní akcionáři se ředí stejně jako členové.
const v2 = A.vydani(120000000, 1000, v.podil_po, 1000, 20000);
ok('druhé vydání počítá s dosavadními akcionáři',
  blizko(v2.podil_po, (v.podil_po * 120000000 + 20000000) / 140000000));
ok('kusů je dohromady dva tisíce', v2.akcie_po === 2000);

// Levná cena ředí členy víc — přesně proto se o ní hlasuje.
const levne = A.vydani(100000000, 0, 0, 1000, 1000);
const drahe = A.vydani(100000000, 0, 0, 1000, 100000);
ok('levné akcie ředí členy míň než drahé?', levne.podil_po < drahe.podil_po,
  'levně se vybere míň, tedy se prodá menší kus');
ok('za drahé akcie se prodá větší kus fondu', drahe.podil_po > levne.podil_po);

// ─── Co se vydat nesmí ───────────────────────────────────────────────────────
ok('akcie zadarmo neprojdou', A.vydani(1e8, 0, 0, 100, 0).duvod === 'cena_mala');
ok('nula kusů neprojde', A.vydani(1e8, 0, 0, 0, 1000).duvod === 'pocet_maly');
ok('milion a jedna akcie neprojde',
  A.vydani(1e8, 0, 0, A.POCET_MAX + 1, 1000).duvod === 'pocet_velky');
// Fond se nesmí rozprodat celý — členům musí zůstat většina rozhodování.
ok('přes devět desetin fondu prodat nejde',
  A.vydani(1000000, 0, 0, 1000, 100000).duvod === 'podil_velky');
ok('prázdný fond nemá co prodávat',
  A.vydani(0, 0, 0, 0, 0).ok === false);

// ─── Účetní hodnota akcie ────────────────────────────────────────────────────
ok('akcie je díl akcionářů dělený počtem kusů',
  A.ucetni(120000000, 1 / 6, 1000) === 20000);
ok('když fond vyroste, akcie taky',
  A.ucetni(240000000, 1 / 6, 1000) === 40000);
ok('bez vydaných akcií se nedělí nulou', A.ucetni(1e8, 0.5, 0) === 0);
ok('záporná hodnota fondu nedá zápornou akcii', A.ucetni(-5, 0.5, 10) === 0);

// ─── Pořadník: pořadí v knize ────────────────────────────────────────────────
const prodeje = [
  { id: 1, cena: 120, zbyva: 10, poradi: 1 },
  { id: 2, cena: 100, zbyva: 10, poradi: 2 },
  { id: 3, cena: 100, zbyva: 10, poradi: 3 },
];
ok('u prodejů je nejlevnější první',
  A.serad(prodeje, 'prodat').map((x) => x.id).join() === '2,3,1');
const nakupy = [
  { id: 1, cena: 90, zbyva: 10, poradi: 1 },
  { id: 2, cena: 110, zbyva: 10, poradi: 2 },
  { id: 3, cena: 110, zbyva: 10, poradi: 3 },
];
ok('u nákupů je nejdražší první',
  A.serad(nakupy, 'koupit').map((x) => x.id).join() === '2,3,1');
// Pozor na past: kdyby data přišla už ve správném pořadí, stabilní řazení by
// vypuštěné pravidlo „kdo dřív přišel" schovalo. Proto se sem dává kniha
// obráceně, než má vyjít.
const stejnaCena = [
  { id: 7, cena: 100, zbyva: 5, poradi: 30 },
  { id: 8, cena: 100, zbyva: 5, poradi: 10 },
  { id: 9, cena: 100, zbyva: 5, poradi: 20 },
];
ok('při shodné ceně rozhoduje, kdo přišel dřív',
  A.serad(stejnaCena, 'prodat').map((x) => x.id).join() === '8,9,7');
ok('a páruje se v tom pořadí',
  A.sparuj({ smer: 'koupit', pocet: 5, cena: 100 }, stejnaCena)
    .obchody[0].proti_id === 8);
ok('vyprodaná nabídka v knize nepřekáží',
  A.serad([{ id: 9, cena: 50, zbyva: 0, poradi: 0 }], 'prodat').length === 0);

// ─── Pořadník: páření ────────────────────────────────────────────────────────
// Tohle je to pravidlo, kvůli kterému se celý trh chová slušně.
const r = A.sparuj({ smer: 'koupit', pocet: 25, cena: 120 }, prodeje);
ok('koupí se od nejlevnějšího', r.obchody[0].cena === 100);
ok('vezme se celá kniha až do limitu', r.kusu === 25);
ok('za cenu té nabídky, co ležela dřív — ne za moji',
  r.obchody.map((o) => o.cena).join() === '100,100,120');
ok('zaplatí se součet jednotlivých obchodů', r.castka === 10 * 100 + 10 * 100 + 5 * 120);
ok('nic nezbylo nespárováno', r.zbyva === 0);

// Limit se musí držet: dražší nabídku kupující nebere.
const r2 = A.sparuj({ smer: 'koupit', pocet: 25, cena: 100 }, prodeje);
ok('nad svůj limit kupující nejde', r2.kusu === 20);
ok('zbytek zůstane ležet v knize', r2.zbyva === 5);
ok('a nepřeplatí se ani o korunu', r2.castka === 2000);

// Prodávající zrcadlově: bere nejdražší nákup a pod svoje dno nejde.
const r3 = A.sparuj({ smer: 'prodat', pocet: 25, cena: 100 }, nakupy);
ok('prodá se nejdražšímu', r3.obchody[0].cena === 110);
ok('pod svoje dno prodávající nejde', r3.kusu === 20 && r3.zbyva === 5);

// Prázdná kniha: nabídka prostě zůstane ležet celá.
ok('do prázdné knihy se jen lehne',
  A.sparuj({ smer: 'koupit', pocet: 5, cena: 100 }, []).zbyva === 5);
// Nepřekrývající se ceny se nepotkají — to není chyba, to je trh.
ok('nákup pod nejlevnějším prodejem se nespáruje',
  A.sparuj({ smer: 'koupit', pocet: 5, cena: 50 }, prodeje).kusu === 0);

// ─── Co nabídka zamkne ───────────────────────────────────────────────────────
// Bez tohohle by hráč jedněmi penězi podložil deset nabídek a trh by mu
// slíbil akcie, které nemá čím zaplatit.
const kniha = [
  { smer: 'koupit', zbyva: 10, cena: 100 },
  { smer: 'koupit', zbyva: 5, cena: 200 },
  { smer: 'prodat', zbyva: 7, cena: 300 },
];
ok('nákupy zamykají peníze', A.zamceno(kniha, 'koupit') === 10 * 100 + 5 * 200);
ok('prodeje zamykají kusy, ne peníze', A.zamceno(kniha, 'prodat') === 7);

// ─── Kontrola nabídky ────────────────────────────────────────────────────────
ok('prodat víc, než držím, nejde',
  A.zkontroluj('prodat', 10, 100, 5, 1e9).duvod === 'tolik_nedrzis');
ok('koupit za víc, než mám, nejde',
  A.zkontroluj('koupit', 10, 100, 0, 999).duvod === 'nemas_hotovost');
ok('přesně na hotovost to projde', A.zkontroluj('koupit', 10, 100, 0, 1000).ok === true);
ok('nabídka za nulu neprojde', A.zkontroluj('koupit', 10, 0, 0, 1e9).duvod === 'cena_mala');
ok('nesmysl ve směru neprojde', A.zkontroluj('darovat', 1, 1, 9, 9).duvod === 'smer');
ok('platná nabídka vrátí, co stojí', A.zkontroluj('koupit', 3, 250, 0, 1e9).castka === 750);

// ─── Zapojení ────────────────────────────────────────────────────────────────
// Pravidla sama nestačí. Tohle jsou čtyři místa, kde se dá propojit špatně
// a hráč na tom tratí, aniž by se cokoli zdálo rozbité.
const fs = require('fs');
const path = require('path');
const koren = path.join(__dirname, '..');
const routy = fs.readFileSync(path.join(koren, 'routes', 'game-trade.routes.js'), 'utf8');
const rez = fs.readFileSync(path.join(koren, 'services', 'game', 'rezervace.js'), 'utf8');

// 1. Ležící nákupní nabídka musí zamykat peníze. Bez toho hráč jedněmi
//    penězi podloží deset nabídek a devíti lidem server řekne, že to nejde.
ok('nákupní nabídka v knize zamyká peníze',
  /gameAkcieNabidka[\s\S]{0,200}smer: 'koupit'/.test(rez));
ok('a zamyká kusy krát cena, ne jen kusy',
  /zAkcii[\s\S]{0,160}zbyva[\s\S]{0,80}cena/.test(rez));
ok('zamčené akcie se přičítají k celkové rezervaci',
  /zNabidek \+ zDividend \+ zAkcii/.test(rez));

// 2. Vydání NESMÍ hned posunout díl akcionářů. Kdyby ano, členové by se
//    zředili za akcie, které si nikdo nekoupil.
const vydani = routy.slice(routy.indexOf("if (n.druh === 'akcie') {"));
const usekVydani = vydani.slice(0, vydani.indexOf("if (n.druh === 'akcie_dividenda')"));
ok('vydání jen vyvěsí nabídku do knihy',
  /gameAkcieNabidka\.create/.test(usekVydani));
ok('vydání nehýbe dílem akcionářů ani pokladnou',
  !/akcie_podil:/.test(usekVydani) && !/pokladna:/.test(usekVydani));

// 3. Díl se posune teprve tím, co se z vydání opravdu prodá.
const trh = routy.slice(routy.indexOf("router.post('/trade/akcie/:id/nabidka'"));
const usekTrh = trh.slice(0, trh.indexOf("router.post('/trade/akcie/nabidka/"));
ok('prodej z vydání posouvá díl akcionářů',
  /kusuFondu > 0[\s\S]{0,600}akcie_podil: vyd\.podil_po/.test(usekTrh));
ok('a zároveň přidá peníze do pokladny fondu',
  /pokladna: \{ increment: castkaFondu \}/.test(usekTrh));

// 4. Vlastní nabídky se nesmí párovat samy se sebou — hráč by si prodával
//    sám sobě a jen tím hýbal cenou v grafu.
ok('vlastní nabídky se nepárují',
  /filter\(\(x\) => x\.player_id !== req\.player\.id\)/.test(usekTrh));
// Ukrojení z ležící nabídky musí mít v podmínce původní zbyva, jinak si
// dva kupující naráz vezmou totéž.
ok('ukrojení z knihy je zamčené proti souběhu',
  /updateMany\(\{[\s\S]{0,160}zbyva: puvodni\.zbyva/.test(usekTrh));
// Peníze kupujícího odejdou doručenkou, jinak by zaplatil jen na papíře.
ok('kupující platí zápornou doručenkou', /amount: -o\.castka/.test(usekTrh));
ok('prodávající dostane kladnou', /amount: o\.castka/.test(usekTrh));
// Cizí nabídku nesmí stáhnout nikdo jiný než její autor.
const zrus = routy.slice(routy.indexOf("router.post('/trade/akcie/nabidka/:id/zrus'"));
ok('cizí nabídku stáhnout nejde',
  /n\.player_id !== req\.player\.id/.test(zrus.slice(0, 900)));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
