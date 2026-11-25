// Akcie fondu: cena, kterou hraje poptávka.
//
// Cenu si NEURČUJE kupující. Při vydání ji určí fond hlasováním a pak s ní
// hýbe jen obchodování: kdo koupí, povytlačí ji nahoru, kdo prodá, srazí ji
// dolů — tím víc, čím větší kus naráz. Protistranou je vždycky fond, takže
// se dá vždycky koupit i prodat.
//
// Tři místa, kde chyba stojí skutečné peníze hráčů:
//  1. Vydání — kolik fondu se tím prodá. Moc = členové přijdou o díl, který
//     neprodali; málo = akcionáři zaplatí za vzduch.
//  2. Posun ceny — musí být souměrný a ohraničený, jinak jde cenou cloumat.
//  3. Prodej zpátky — díl akcionářů musí klesnout přesně o to, co fond
//     vyplatil, jinak odchod jednoho ředí nebo obohacuje ty, co zůstali.
const A = require('../services/game/akcie');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const blizko = (a, b) => Math.abs(a - b) < 1e-9;

// ─── Vydání ──────────────────────────────────────────────────────────────────
const v = A.vydani(100000000, 0, 0, 1000, 20000);
ok('vydání projde', v.ok === true);
ok('vybere se počet krát cena', v.vybrano === 20000000);
ok('hodnota fondu o to vzroste', v.hodnota_po === 120000000);
ok('akcionáři drží šestinu', blizko(v.podil_po, 20000000 / 120000000));
ok('členům zbyde pět šestin', blizko(A.dilClenu(v.podil_po), 100000000 / 120000000));
const v2 = A.vydani(120000000, 1000, v.podil_po, 1000, 20000);
ok('druhé vydání počítá s dosavadními akcionáři',
  blizko(v2.podil_po, (v.podil_po * 120000000 + 20000000) / 140000000));
ok('akcie zadarmo neprojdou', A.vydani(1e8, 0, 0, 100, 0).duvod === 'cena_mala');
ok('nula kusů neprojde', A.vydani(1e8, 0, 0, 0, 1000).duvod === 'pocet_maly');
ok('přes devět desetin fondu prodat nejde',
  A.vydani(1000000, 0, 0, 1000, 100000).duvod === 'podil_velky');

// ─── Účetní hodnota ──────────────────────────────────────────────────────────
ok('akcie je díl akcionářů dělený počtem kusů',
  A.ucetni(120000000, 1 / 6, 1000) === 20000);
ok('bez vydaných akcií se nedělí nulou', A.ucetni(1e8, 0.5, 0) === 0);

// ─── Úpis ────────────────────────────────────────────────────────────────────
// Fondu zbývá 985 nevydaných kusů z tisíce, cena 100 000, hodnota 96 029 647.
const stav = { cena: 100000, volne: 985, celkem: 1000, vydano: 15,
  podil: 0.0156202, hodnota: 96029647, hotovost: 10000000 };
const k = A.koupit(stav, 10);
ok('nákup projde', k.ok === true);
ok('zaplatí se dnešní cena krát kusy', k.castka === 1000000);
// Úpis cenou NEHÝBE. Fond prodává za to, co odhlasoval, a neprodraží se tomu,
// kdo přijde později — cenu dělá až burza mezi hráči.
ok('úpis cenou nehýbe', k.cena === 100000 && k.cena_po === 100000);
const velky = A.koupit(Object.assign({}, stav, { hotovost: 98500000 }), 985);
ok('ani rozebrání celého úpisu najednou',
  velky.ok === true && velky.cena_po === 100000);
ok('vydaných kusů přibude', k.vydano_po === 25);
ok('díl akcionářů vzroste', k.podil_po > stav.podil);

ok('víc kusů, než fond má, nejde', A.koupit(stav, 986).duvod === 'fond_tolik_nema');
ok('bez hotovosti to nejde',
  A.koupit(Object.assign({}, stav, { hotovost: 999999 }), 10).duvod === 'nemas_hotovost');
ok('přesně na hotovost to projde',
  A.koupit(Object.assign({}, stav, { hotovost: 1000000 }), 10).ok === true);
ok('nula kusů neprojde', A.koupit(stav, 0).duvod === 'pocet_maly');

// Fond akcie zpátky nevykupuje. Kdo to zkusí zavolat, nesmí najít funkci,
// která by to uměla — jinak ji dřív nebo později někdo zavolá.
ok('výkup fondem už modul neumí', typeof A.prodat === 'undefined');
ok('a posun ceny podle objemu taky ne', typeof A.cenaPo === 'undefined');

// ─── Kapitál z akcií ──────────────────────────────────────────────
// Kolik peněz fondu akcie doopravdy přinesly. Člen se podle toho dívá, jestli
// se vyplatilo prodat kus fondu cízím lidem — nesmí se mu tedy do čísla připočíst
// nic, co fondem neprošlo.
const kap = A.kapital([
  { pocet: 10, cena: 100000, kupujici_id: 5, prodavajici_id: null },  // fond prodal nové kusy
  { pocet: 2, cena: 90000, kupujici_id: 0, prodavajici_id: 5 },       // fond je vykoupil zpátky
  { pocet: 3, cena: 95000, kupujici_id: 7, prodavajici_id: 5 },       // hráč hráči na burze
]);
ok('vybralo se to, co fond prodal', kap.vybrano === 1000000);
ok('vyplatilo se to, co fond vykoupil', kap.vyplaceno === 180000);
ok('obchod dvou hráčů mezi sebou fondem nehnul', kap.kapital === 820000);
// Hrubé číslo by lhalo fondu, ze kterého akcionáři zase vystoupili.
const vrat = A.kapital([
  { pocet: 10, cena: 100000, kupujici_id: 5, prodavajici_id: null },
  { pocet: 10, cena: 100000, kupujici_id: 0, prodavajici_id: 5 },
]);
ok('co se vrátilo, už kapitál není', vrat.kapital === 0 && vrat.vybrano === 1000000);
ok('prázdno je nula', A.kapital([]).kapital === 0 && A.kapital(null).kapital === 0);
ok('nesmysly nic neshodí', A.kapital([null, {}, { pocet: 'x', cena: 'y' }]).kapital === 0);

// ─── Přecenění ──────────────────────────────────────────────────
// Cenou nehýbe jen obchodování. Když fond koupí podíl pod cenou, vyroste
// účetní hodnota akcie — a cena má jít s tím, stejným poměrem.
ok('růst účetní hodnoty o desetinu zvedne cenu o desetinu',
  A.precena(100000, 20000, 22000) === 110000);
ok('propad ji srazí stejně', A.precena(100000, 20000, 10000) === 50000);
ok('beze změny se cena nehne', A.precena(100000, 20000, 20000) === 100000);
// Prémie, kterou na akcii trh má, musí zůstat — přecenění neurčuje, za kolik
// se obchoduje, jen s tím posouvá základ.
ok('prémie proti účetní hodnotě zůstane',
  A.precena(60000, 20000, 40000) / 40000 === 60000 / 20000);
// Bez čísla, proti kterému se měří, se cena NESMÍ hnout.
ok('bez reference se cena nehne', A.precena(100000, 0, 22000) === 100000);
ok('bez dnešní hodnoty taky ne', A.precena(100000, 20000, 0) === 100000);
ok('a nedělí se nulou', Number.isFinite(A.precena(100000, 0, 0)));
ok('nesmysly cenu nerozbijí', A.precena(100000, 'x', 'y') === 100000);
// Hranice platí i tady: zdesetinásobení fondu nesmí vystřelit cenu do nesmyslu.
ok('cena nejde nad strop', A.precena(1000000, 1, 1000000) === A.CENA_MAX);
ok('ani pod dno', A.precena(10, 1000000, 1) === A.CENA_MIN);

// Účetní hodnota nezaokrouhleně. Proti ní se měří další přecenění, takže
// zaokrouhlení by se v každém kroku přičetlo k ceně jako skutečný pohyb.
ok('nezaokrouhlená účetní hodnota se opravdu nezaokrouhluje',
  A.ucetniPresna(100000000, 1 / 3, 1000) !== A.ucetni(100000000, 1 / 3, 1000));
ok('a jinak říká totéž',
  Math.round(A.ucetniPresna(100000000, 1 / 3, 1000)) === A.ucetni(100000000, 1 / 3, 1000));
ok('bez vydaných kusů je nula', A.ucetniPresna(1e8, 0.5, 0) === 0);

// ─── Co akcie nese ────────────────────────────────────────────────
// Spekulace s cenou je jedna věc, výdělek druhá. Na akcii připadá díl
// měsíčního výnosu fondu, který patří akcionářům, dělený počtem kusů.
ok('na akcii připadá díl akcionářů dělený počtem kusů',
  A.vynosNaAkcii(1000000, 0.5, 100) === 5000);
ok('větší díl akcionářů nese víc',
  A.vynosNaAkcii(1000000, 0.8, 100) > A.vynosNaAkcii(1000000, 0.5, 100));
ok('víc vydaných kusů nese na kus mín',
  A.vynosNaAkcii(1000000, 0.5, 200) === 2500);
// Bez vydaných kusů se nedělí nulou.
ok('bez vydaných kusů je to nula', A.vynosNaAkcii(1000000, 0.5, 0) === 0);
ok('a vrací se číslo, ne nekonečno', Number.isFinite(A.vynosNaAkcii(1e6, 0.5, 0)));
// Ztráta fondu se na akcii nepřenáší: akcionář nedoplácí.
ok('ztráta fondu akcii do mínusu nestahuje', A.vynosNaAkcii(-500000, 0.5, 100) === 0);
ok('fond, který nenese nic, nenese nic ani na akcii',
  A.vynosNaAkcii(0, 0.5, 100) === 0);
ok('bez dílu akcionářů taky nic', A.vynosNaAkcii(1000000, 0, 100) === 0);
ok('nesmysly nic nerozbijí', A.vynosNaAkcii('x', 'y', 'z') === 0);

// ─── Dividenda, která nabíhá ───────────────────────────────────────
// Fond slíbí procento účetní hodnoty akcie za HERNÍ rok a to pak nabíhá
// plynule. Herní rok je dvanáct herních měsíců, tedy šest skutečných dní —
// kdyby se počítal skutečný rok, akcionář by za večer neviděl nic.
const ROK = A.ROK_MS;
ok('herní rok je dvanáct herních měsíců', ROK === 12 * 43200000);
ok('za celý herní rok se vyplatí celá sazba',
  A.dividendaZa(100, 10000, 0.12, ROK) === 120000);
ok('za půlku roku půlka', A.dividendaZa(100, 10000, 0.12, ROK / 2) === 60000);
ok('víc kusů nese víc',
  A.dividendaZa(200, 10000, 0.12, ROK) === 2 * A.dividendaZa(100, 10000, 0.12, ROK));
// Zaokrouhluje se DOLŪ: fond nemá platit koruny, které nevydělal.
ok('zaokrouhluje se dolů', A.dividendaZa(1, 1000, 0.1, ROK / 3) === 33);
// Setiny koruny: nula. Volající podle toho pozná, že se čas nemá posouvat.
ok('ze setin je nula', A.dividendaZa(1, 100, 0.01, 1000) === 0);
ok('bez sazby nenabíhá nic', A.dividendaZa(100, 10000, 0, ROK) === 0);
ok('bez akcií taky ne', A.dividendaZa(0, 10000, 0.12, ROK) === 0);
ok('bez účetní hodnoty taky ne', A.dividendaZa(100, 0, 0.12, ROK) === 0);
ok('zpáteční čas nic nevyrobí', A.dividendaZa(100, 10000, 0.12, -ROK) === 0);
ok('sazba nad strop se uřízne',
  A.dividendaZa(100, 10000, 5, ROK) === A.dividendaZa(100, 10000, A.SAZBA_MAX, ROK));
ok('nesmysly nic nerozbijí', A.dividendaZa('x', 'y', 'z', 'w') === 0);
// Počítadlo v panelu se kreslí z částky za sekundu — musí sedět s tím,
// co se pak doopravdy vyplatí.
const zaSek = A.dividendaZaSekundu(100, 10000, 0.12);
ok('částka za sekundu sedí s částkou za rok',
  Math.abs(zaSek * (ROK / 1000) - A.dividendaZa(100, 10000, 0.12, ROK)) < 1);
ok('a vrací se nezaokrouhleně', A.dividendaZaSekundu(1, 100, 0.01) > 0
  && A.dividendaZaSekundu(1, 100, 0.01) < 1);
ok('bez sazby je počítadlo nula', A.dividendaZaSekundu(100, 10000, 0) === 0);

// ─── Kniha akcionářů ────────────────────────────────────────────
// Dvě různá procenta, která se snadno pletou: kolik má kdo mezi akcionáři,
// a co to znamená v celém fondu. Podle prvního se pozná, kdo může hnout cenou;
// podle druhého, co doopravdy vlastní.
const kn = A.kniha([{ player_id: 1, pocet: 300 }, { player_id: 2, pocet: 200 }],
  500, 0.4, 1000);
ok('v knize jsou oba', kn.length === 2);
ok('podíl z akcií je z vydaných kusů', blizko(kn[0].podil_akcii, 0.6));
ok('a podíly akcionářů dávají dohromady celek',
  blizko(kn[0].podil_akcii + kn[1].podil_akcii, 1));
ok('podíl z fondu je ten první krát díl akcionářů', blizko(kn[0].podil_fondu, 0.24));
ok('a dohromady dávají díl akcionářů',
  blizko(kn[0].podil_fondu + kn[1].podil_fondu, 0.4));
ok('hodnota je kusy krát cena', kn[0].hodnota === 300000);
// Nevydané kusy do knihy nepatří — ty drží fond sám. Kdyby se počítaly do
// jmenovatele, vypadal by každý akcionář slabší, než je.
ok('počítá se z vydaných, ne ze všech kusů',
  blizko(A.kniha([{ player_id: 1, pocet: 300 }], 500, 0.4, 0)[0].podil_akcii, 0.6));
// Nula akcií v řádku je zbytek po prodeji — do knihy nepatří.
ok('kdo už nic nedrží, v knize není',
  A.kniha([{ player_id: 1, pocet: 0 }, { player_id: 2, pocet: 5 }], 5, 1, 10).length === 1);
ok('bez vydaných kusů se nedělí nulou',
  A.kniha([{ player_id: 1, pocet: 3 }], 0, 0.5, 10)[0].podil_akcii === 0);
ok('prázdno a nesmysly nic neshodí',
  A.kniha(null, 10, 0.5, 10).length === 0 && A.kniha([null, {}], 10, 0.5, 10).length === 0);

// ─── Zapojení ────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const routy = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
const rez = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'game', 'rezervace.js'), 'utf8');

// Úpis: cenu kupující neposílá — platí ta, kterou fond odhlasoval. Kdyby ji
// server bral z těla požadavku, koupil by si každý fond za korunu.
const trh = routy.slice(routy.indexOf("router.post('/trade/akcie/:id/obchod'"));
const konecUpisu = trh.indexOf('// ─── Burza: kniha příkazů');
ok('routa úpisu se v obsluze našla', konecUpisu > 0);
const usekTrh = trh.slice(0, konecUpisu > 0 ? konecUpisu : 9000);
ok('server cenu z požadavku nebere', !/b\.cena|body\.cena/.test(usekTrh));
ok('bere ji ze stavu fondu', /al\.akcie_cena/.test(usekTrh));
// A NEPŘEPISUJE ji. Úpis je pevná cena; s cenou hýbe jen obchod na burze.
// Jediná zmínka ceny smí být pojistka proti souběhu v podmínce zápisu.
const zminky = (usekTrh.match(/akcie_cena:/g) || []).length;
ok('úpis cenou nehýbe ani na serveru', zminky === 1
  && /where: \{ id: alianceId, akcie_cena: al\.akcie_cena/.test(usekTrh), 'zmínek ' + zminky);
// Fond zpátky nevykupuje: prodej mu se musí odmítnout, ne tiše něco udělat.
ok('prodej fondu routa odmítne',
  /smer === 'prodat'[\s\S]{0,160}fond_akcie_nevykupuje/.test(usekTrh));
ok('a AKCIE.prodat už nikde nevolá', routy.indexOf('AKCIE.prodat') < 0);
// Pořadník je pryč i s rezervací peněz pod ležícími nabídkami.
ok('pořadník nabídek je pryč', routy.indexOf('gameAkcieNabidka') < 0);
ok('a rezervace už ho nehlídají', rez.indexOf('gameAkcieNabidka') < 0);
// Složený klíč podle map() je past, na kterou to jednou spadlo.
ok('nikde se nesahá na složený klíč jménem z map()',
  routy.indexOf('game_akcie_fond_hrac') < 0);
// Hodnota fondu nacita stavy vsech hracu — uvnitř transakce je to strop.
const transakce = usekTrh.slice(usekTrh.indexOf('prisma.$transaction'));
ok('hodnota fondu se uvnitř transakce nepočítá',
  transakce.indexOf('hodnotaFondu(') < 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
