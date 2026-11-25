// Kniha příkazů na burze akcií.
//
// Tady se potkávají cizí peníze, takže musí sedět čtyři věci, a každá z nich
// je past, na kterou se dá spadnout potichu:
//
//  1. Párování. Obchod se uzavře za cenu STARŠÍHO příkazu. Kdyby platila cena
//     nového, stačilo by napsat jedničku a čekat, až to někdo vezme.
//  2. Přednost. Nejdřív nejlepší cena, při shodě ten, kdo přišel dřív. Jinak
//     by nemělo smysl pokládat nabídku jako první.
//  3. Cenové pásmo. Příkaz daleko od poslední ceny se nepřijme — jinak se
//     cena dá poslat kamkoli jedním překlepem.
//  4. Krytí. Pod nákupem musí ležet peníze, pod prodejem kusy. A sám se sebou
//     hráč neobchoduje: byl by to posun ceny zadarmo.
const K = require('../services/game/akcie-kniha');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ─── Cenové pásmo ────────────────────────────────────────────────────────────
const m = K.mez(1000);
ok('pásmo je symetrické kolem poslední ceny', m.min === 700 && m.max === 1300);
ok('bez ceny se pásmo neurčuje', K.mez(0) === null);
ok('dno pásma nespadne pod minimum', K.mez(1).min >= K.CENA_MIN);

const stav = { cenaTed: 1000, volna_hotovost: 10000000, volne_akcie: 100, mych_prikazu: 0 };
ok('příkaz uvnitř pásma projde',
  K.zkontroluj({ smer: 'koupit', pocet: 10, cena: 1200 }, stav).ok === true);
ok('na kraji pásma ještě projde',
  K.zkontroluj({ smer: 'koupit', pocet: 10, cena: 1300 }, stav).ok === true);
ok('o korunu dál už ne',
  K.zkontroluj({ smer: 'koupit', pocet: 10, cena: 1301 }, stav).duvod === 'mimo_pasmo');
ok('a dolů stejně',
  K.zkontroluj({ smer: 'prodat', pocet: 10, cena: 699 }, stav).duvod === 'mimo_pasmo');
// Tohle je ten případ, kvůli kterému pásmo vzniklo: nabídka za deset korun.
ok('nabídka za deset korun se nepřijme',
  K.zkontroluj({ smer: 'prodat', pocet: 1, cena: 10 }, stav).duvod === 'mimo_pasmo');

// ─── Krytí ───────────────────────────────────────────────────────────────────
ok('na nákup musí být peníze',
  K.zkontroluj({ smer: 'koupit', pocet: 100, cena: 1300 },
    Object.assign({}, stav, { volna_hotovost: 129999 })).duvod === 'nemas_hotovost');
ok('přesně na hotovost to projde',
  K.zkontroluj({ smer: 'koupit', pocet: 100, cena: 1300 },
    Object.assign({}, stav, { volna_hotovost: 130000 })).ok === true);
ok('prodat se dá jen to, co mám volné',
  K.zkontroluj({ smer: 'prodat', pocet: 101, cena: 1000 }, stav).duvod === 'tolik_nedrzis');
ok('kusy pod jinou nabídkou se nepočítají',
  K.zamceneAkcie([{ smer: 'prodat', pocet: 7, cena: 1000 },
    { smer: 'koupit', pocet: 3, cena: 900 }]) === 7);
ok('peníze pod poptávkou se počítají',
  K.zamcenePenize([{ smer: 'koupit', pocet: 3, cena: 900 },
    { smer: 'prodat', pocet: 7, cena: 1000 }]) === 2700);
ok('víc než strop příkazů naráz nejde',
  K.zkontroluj({ smer: 'koupit', pocet: 1, cena: 1000 },
    Object.assign({}, stav, { mych_prikazu: K.PRIKAZU_MAX })).duvod === 'prikazu_moc');
ok('nula kusů neprojde',
  K.zkontroluj({ smer: 'koupit', pocet: 0, cena: 1000 }, stav).duvod === 'pocet_maly');
ok('bez směru taky ne',
  K.zkontroluj({ smer: 'cokoli', pocet: 1, cena: 1000 }, stav).duvod === 'smer');

// ─── Přednost a cena obchodu ─────────────────────────────────────────────────
// V knize leží tři nabídky. Kupující dává nejvýš 1 100 za 30 kusů.
const nabidky = [
  { id: 3, player_id: 4, smer: 'prodat', pocet: 40, cena: 1090, created_at: '2026-01-03' },
  { id: 1, player_id: 2, smer: 'prodat', pocet: 10, cena: 1050, created_at: '2026-01-01' },
  { id: 9, player_id: 8, smer: 'prodat', pocet: 10, cena: 1200, created_at: '2026-01-02' },
];
const r = K.sparuj({ smer: 'koupit', pocet: 30, cena: 1100, player_id: 1 }, nabidky);
ok('vyřídí se nejlevnější nabídka první', r.obchody[0].prikaz_id === 1);
ok('a pak ta dražší, která se ještě vejde', r.obchody[1].prikaz_id === 3);
ok('nabídka nad limitem se nebere', r.obchody.length === 2);
// Tohle je to podstatné: platí cena toho, kdo byl v knize, ne limit kupce.
ok('obchod se uzavře za cenu staršího příkazu',
  r.obchody[0].cena === 1050 && r.obchody[1].cena === 1090);
ok('kupující nepřeplatí svůj limit', r.castka === 10 * 1050 + 20 * 1090);
ok('z velké nabídky se vezme jen tolik, kolik je třeba', r.obchody[1].pocet === 20);
ok('nic nezbylo', r.zbyva === 0);
ok('nová cena je poslední obchod', r.cena_po === 1090);

// Při shodné ceně rozhoduje čas, ne pořadí v seznamu ani číslo příkazu.
const shoda = K.sparuj({ smer: 'koupit', pocet: 5, cena: 1000, player_id: 1 }, [
  { id: 20, player_id: 2, smer: 'prodat', pocet: 5, cena: 1000, created_at: '2026-02-02' },
  { id: 21, player_id: 3, smer: 'prodat', pocet: 5, cena: 1000, created_at: '2026-02-01' },
]);
ok('při stejné ceně má přednost starší příkaz', shoda.obchody[0].prikaz_id === 21);

// Prodávající bere nejdražšího kupce.
const prodej = K.sparuj({ smer: 'prodat', pocet: 15, cena: 900, player_id: 1 }, [
  { id: 31, player_id: 2, smer: 'koupit', pocet: 10, cena: 950, created_at: '2026-03-01' },
  { id: 32, player_id: 3, smer: 'koupit', pocet: 10, cena: 1000, created_at: '2026-03-02' },
  { id: 33, player_id: 4, smer: 'koupit', pocet: 10, cena: 800, created_at: '2026-03-03' },
]);
ok('prodávající dostane nejdřív nejvyšší cenu', prodej.obchody[0].cena === 1000);
ok('pak nižší, dokud má co prodat', prodej.obchody[1].cena === 950);
ok('pod svůj limit neprodá', prodej.obchody.length === 2 && prodej.zbyva === 0);

// Sám se sebou hráč neobchoduje.
const sam = K.sparuj({ smer: 'koupit', pocet: 10, cena: 1100, player_id: 7 }, [
  { id: 41, player_id: 7, smer: 'prodat', pocet: 10, cena: 1000, created_at: '2026-04-01' },
]);
ok('vlastní příkaz se přeskočí', sam.obchody.length === 0 && sam.zbyva === 10);
ok('a cena se tím nehne', sam.cena_po === 0);

// Co se nespáruje, zůstane ležet.
const zbytek = K.sparuj({ smer: 'koupit', pocet: 50, cena: 1100, player_id: 1 }, [
  { id: 51, player_id: 2, smer: 'prodat', pocet: 10, cena: 1000, created_at: '2026-05-01' },
]);
ok('zbytek příkazu zůstane v knize', zbytek.zobchodovano === 10 && zbytek.zbyva === 40);
// Prázdná kniha nic neshodí a nic nevymyslí.
const prazdno = K.sparuj({ smer: 'koupit', pocet: 5, cena: 1000, player_id: 1 }, []);
ok('prázdná kniha nechá příkaz celý', prazdno.zbyva === 5 && prazdno.cena_po === 0);
ok('nesmysly nic neshodí',
  K.sparuj(null, null).zbyva === 0 && K.sparuj({ smer: 'koupit' }, [null]).zbyva === 0);

// ─── Hloubka ─────────────────────────────────────────────────────────────────
const h = K.hloubka([
  { smer: 'prodat', pocet: 5, cena: 1100 },
  { smer: 'prodat', pocet: 7, cena: 1100 },
  { smer: 'prodat', pocet: 3, cena: 1050 },
  { smer: 'koupit', pocet: 4, cena: 950 },
  { smer: 'koupit', pocet: 6, cena: 1000 },
], 8);
ok('stejné ceny se sečtou do jednoho řádku',
  h.nabidka[1].cena === 1100 && h.nabidka[1].pocet === 12);
ok('nabídka jde od nejlevnější', h.nabidka[0].cena === 1050);
ok('poptávka od nejdražší', h.poptavka[0].cena === 1000);
ok('nejlepší ceny sedí', h.nejlepsi_nabidka === 1050 && h.nejlepsi_poptavka === 1000);
// U řádku se zvlášť počítá, kolik z těch kusů je mých. Bez toho by tlačítko
// „vzít" nabízelo vlastní kusy — hráč klikne a nestane se nic, jen mu v knize
// zůstane ležet nový příkaz.
const hJa = K.hloubka([
  { smer: 'prodat', pocet: 5, cena: 1100, player_id: 1 },
  { smer: 'prodat', pocet: 7, cena: 1100, player_id: 2 },
  { smer: 'prodat', pocet: 4, cena: 1050, player_id: 2 },
], 8, 1);
ok('na řádku je vidět, kolik kusů je mých',
  hJa.nabidka[1].pocet === 12 && hJa.nabidka[1].moje === 5);
ok('cizí řádek moje kusy nemá', hJa.nabidka[0].moje === 0);
ok('bez hráče se nic za moje nepovažuje',
  K.hloubka([{ smer: 'prodat', pocet: 5, cena: 1100, player_id: 1 }], 8).nabidka[0].moje === 0);

ok('prázdná kniha má nuly, ne nedefinováno',
  K.hloubka([], 8).nejlepsi_nabidka === 0 && K.hloubka(null, 8).poptavka.length === 0);
// Vyřízený příkaz s nulou kusů v hloubce nemá co dělat.
ok('vyprázdněný příkaz se nekreslí',
  K.hloubka([{ smer: 'prodat', pocet: 0, cena: 1100 }], 8).nabidka.length === 0);

// ─── Zapojení ────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const routy = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
const rez = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'game', 'rezervace.js'), 'utf8');
const brzda = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'game', 'brzda.js'), 'utf8');

const p = routy.slice(routy.indexOf("router.post('/trade/akcie/:id/prikaz'"));
const usek = p.slice(0, p.indexOf("router.post('/trade/akcie/:id/prikaz/:pid/zrusit'"));
ok('routa příkazu se v obsluze našla', usek.length > 500);
ok('pravidla počítá služba, ne routa', /KNIHA\.zkontroluj\(/.test(usek) && /KNIHA\.sparuj\(/.test(usek));
// Hloubka se posílá s mým id: jinak by hra nevěděla, které kusy na řádku
// jsou moje, a tlačítko „vzít" by nabízelo obchod se sebou samým.
ok('hloubka se počítá s mým id', /KNIHA\.hloubka\(vse, 8, req\.player\.id\)/.test(routy));
// Kniha se musí přečíst ZNOVU uvnitř transakce: mezi kontrolou a zápisem
// mohl někdo jiný koupit a párovalo by se proti stavu, který už neplatí.
const tx = usek.slice(usek.indexOf('prisma.$transaction'));
ok('kniha se čte znovu uvnitř transakce', /prikazyFondu\(tx,/.test(tx));
// Podmínkou zápisu je přesně ten počet, se kterým se počítalo.
ok('ubrání z cizího příkazu je podmíněné',
  /where: \{ id: o\.prikaz_id, stav: 'bezi', pocet: puvodni\.pocet \}/.test(tx));
ok('vyřízený příkaz se zavře', /stav: zbytek > 0 \? 'bezi' : 'splneno'/.test(tx));
// Peníze tečou mezi hráči, fondu se obchod netýká.
ok('kupujícímu se strhne a prodávajícímu připíše',
  /amount: -castka/.test(tx) && /amount: castka/.test(tx));
ok('pokladna fondu se obchodem nehne', !/pokladna:/.test(tx));
ok('díl akcionářů taky ne', !/akcie_podil:/.test(tx));
ok('mění se jen cena akcie', /data: \{ akcie_cena: r\.cena_po \}/.test(tx));
ok('a zapíše se bod do grafu', /CENA\.zapisCenu\(tx, alianceId, r\.cena_po, 'obchod'/.test(tx));
// Dividenda se doúčtuje dřív, než se s kusy hne — jinak propadne.
ok('dividenda se doúčtuje před obchodem',
  usek.indexOf('DIV.dorovnej') >= 0 && usek.indexOf('DIV.dorovnej') < usek.indexOf('prisma.$transaction'));
ok('a protistranám taky', /for \(const p of protiPred/.test(usek));
// Pořizovací cena jde s akciemi, jinak si oba čtou zisk, který nemají.
const prevod = routy.slice(routy.indexOf('async function prevedAkcie'));
ok('prodávajícímu se pořizovací cena krátí poměrně',
  /zbytek \/ prodal\.pocet/.test(prevod.slice(0, 1200)));
ok('kupujícímu se přičte, co zaplatil',
  /porizovaci: \{ increment: BigInt\(castka\) \}/.test(prevod.slice(0, 1200)));
ok('a prázdná držba se smaže', /gameAkcie\.delete/.test(prevod.slice(0, 1200)));
// Cizí příkaz zrušit nejde.
const zrus = routy.slice(routy.indexOf("router.post('/trade/akcie/:id/prikaz/:pid/zrusit'"));
ok('ruší se jen vlastní běžící příkaz',
  /player_id: req\.player\.id, stav: 'bezi'/.test(zrus.slice(0, 900)));
// Rezervace a brzda.
ok('peníze pod poptávkou rezervace hlídají',
  /gameAkciePrikaz/.test(rez) && /zamcenePenize/.test(rez));
ok('nový příkaz brzda zastavuje', brzda.indexOf("/prikaz$/") > 0);
ok('zrušení příkazu brzda nezastavuje', brzda.indexOf('zrusit') < 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
