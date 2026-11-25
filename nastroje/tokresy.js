// Území Unie je okres, ne město.
//
// Dokud se území vázalo na město, kreslil se na mapě kruh o sedmi kilometrech
// kolem jeho středu. Byla to kresba bez podkladu: dvě města v jednom okrese
// by se překrývala a hráč nepoznal, kde území končí. Okres je hranice, která
// někde doopravdy je — stáhne se z OpenStreetMap, zjednoduší a nakreslí.
//
// Hlídá se tu troje: že se klíč okresu dá spočítat stejně pokaždé, že obrys
// projde zjednodušením a nezbyde z něj čára, a že se zábory (ty nesou MĚSTO)
// hledají přes překlad město→okres, ne přímo podle klíče okresu.
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
const Z = cti('services/game/okresy.js');

// Čisté funkce se vytáhnou ze souboru — vyžádat si modul nejde, tahá za sebou
// databázi.
const kusy = ['klic', 'vzdalenost', 'dp', 'zjednodus', 'prstenec'].map(function (jm) {
  const re = new RegExp('function ' + jm + '\\([\\s\\S]*?\\n\\}');
  const m = Z.match(re);
  ok('v okresy.js se našlo: ' + jm, !!m);
  return m ? m[0] : '';
});
const box = { BODU_MAX: 160 };
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);

// ─── Klíč ────────────────────────────────────────────────────────────────────
ok('klíč je bez diakritiky a s kódem země',
  box.klic('CZ', 'okres Šumperk') === 'cz:okres-sumperk', '— ' + box.klic('CZ', 'okres Šumperk'));
ok('stejný okres dá vždy stejný klíč',
  box.klic('cz', 'Okres  Šumperk ') === box.klic('CZ', 'okres Šumperk'));
// Stejné jméno v jiné zemi je jiné území — bez kódu země by se slila.
ok('země klíč odliší', box.klic('pl', 'Opole') !== box.klic('cz', 'Opole'));
ok('prázdné jméno klíč nedá', box.klic('cz', '') === '');
ok('nesmysl nic neshodí', box.klic(null, null) === '');

// ─── Obrys ───────────────────────────────────────────────────────────────────
const ctverec = { type: 'Polygon', coordinates: [[[17, 50], [17.1, 50], [17.1, 50.1], [17, 50.1], [17, 50]]] };
let r = box.prstenec(ctverec);
ok('GeoJSON se přetočí na [lat,lon]', r[0][0] === 50 && r[0][1] === 17, '— ' + JSON.stringify(r[0]));
// U MultiPolygonu (okres s exklávou) se kreslí ten hlavní, ne všechny přes sebe.
const multi = { type: 'MultiPolygon', coordinates: [
  [[[17, 50], [17.01, 50], [17, 50.01], [17, 50]]],
  [[[18, 51], [18.5, 51], [18.5, 51.5], [18, 51.5], [18, 51], [18.2, 51.2]]],
] };
ok('z MultiPolygonu se bere největší kus', box.prstenec(multi).length === 6,
  '— ' + box.prstenec(multi).length);
ok('neznámý tvar vrátí prázdno', box.prstenec({ type: 'Point', coordinates: [1, 2] }) === null);
ok('prázdný vstup taky', box.prstenec(null) === null);

// Hranice z OSM má tisíce bodů. Na mapě v telefonu je to k nerozeznání od
// stovky a jen by se to vleklo po drátě.
const kruh = [];
for (let i = 0; i < 900; i++) {
  const a = i / 900 * 2 * Math.PI;
  kruh.push([50 + Math.sin(a) * 0.3, 17 + Math.cos(a) * 0.45]);
}
const zj = box.zjednodus(kruh, 160);
ok('obrys se zjednoduší', zj.length <= 160 && zj.length >= 8, '— ' + zj.length + ' z ' + kruh.length);
ok('a pořád je to polygon, ne čára', zj.length >= 4);
ok('krátký obrys se nechá být', box.zjednodus([[1, 1], [2, 2], [3, 1]], 160).length === 3);
ok('prázdno nic neshodí', box.zjednodus(null, 160).length === 0);

// ─── Zábory se hledají přes města ────────────────────────────────────────────
// Zábor nese MĚSTO, území OKRES. Kdyby se zábory hledaly rovnou podle klíče
// okresu, nenašel by se ani jeden a všechno by tiše vycházelo nula.
const U = cti('services/game/unie.js');
ok('vyúčtování překládá okres na města',
  /const klice = await OKRESY\.oblasti\(t\.okres_key\);[\s\S]{0,400}area_key: \{ in: klice \}/.test(U));
ok('přehled území taky',
  /const kliceO = await OKRESY\.oblasti\(t\.okres_key\);[\s\S]{0,400}area_key: \{ in: kliceO \}/.test(U));
ok('počítání strojů v okrese taky',
  /async function pocetVOkrese\(okresKey\) \{[\s\S]{0,300}area_key: \{ in: klice \}/.test(U));
ok('žebříček si drží překlad město→okres',
  /okresMesta = new Map\(mesta\.map/.test(U) && /podleOkresu\[t\.okres_key\]/.test(U));
ok('a nikde se zábor nehledá podle klíče okresu',
  !/area_key: t\.okres_key/.test(U) && !/area_key: \{ in: uzemi\.map/.test(U));
ok('potenciál sčítá místa celého okresu',
  /prisma\.gameArea\.findMany\(\{ where: \{ okres_key: key \}/.test(U));

// ─── Mapa ────────────────────────────────────────────────────────────────────
const R = cti('routes/game-unie.routes.js');
ok('mapa posílá hranici', /hranice: Array\.isArray\(o\.hranice\) \? o\.hranice : null/.test(R));
ok('a chybějící hranici dotahuje NA POZADÍ',
  /OKRESY\.zajistiNaPozadi\(k, mam && mam\.nazev/.test(R));
// Tohle je ta past, na které přehled Unie jednou uvízl na „Načítám…":
// při každém pohledu se znovu čekalo na cizí službu. Čtecí cesta nesmí
// na stahování čekat vůbec.
ok('čtecí cesta na stahování nečeká',
  !/await OKRESY\.zajisti\(/.test(R) && !/await OKRESY\.prevedStaraUzemi\(/.test(R)
  && !/await OKRESY\.proOblast\(/.test(R));
ok('stará území se převedou na okresy, taky na pozadí',
  /OKRESY\.prevodNaPozadi\(\)/.test(R));
// A v samotném modulu: po neúspěchu se nezkouší hned znovu, jinak by každé
// načtení stránky znamenalo dotaz na cizí službu.
ok('mezi pokusy je pauza', /const POKUS_PAUZA = /.test(Z)
  && /Date\.now\(\) - kdy < POKUS_PAUZA/.test(Z));
ok('práce na pozadí se nečeká', /Promise\.resolve\(\)\.then\(prace\)/.test(Z));
ok('a pro okres k městu je zvlášť cesta, která si počká',
  /async function proOblastTed\(area\)/.test(Z));
ok('převod nepřepíše cizí území',
  /obsazeno[\s\S]{0,200}console\.warn\('\[game\] unie — území'/.test(Z));

const hra = cti('public/compounder/game/game.js');
ok('hra kreslí polygon', /L\.polygon\(u\.hranice, styl\)/.test(hra));
// Bez náhradního kruhu by prázdná mapa vypadala jako chyba hry.
ok('a bez hranice zůstane kruh', /L\.circle\(\[u\.lat, u\.lon\], Object\.assign\(\{ radius: UZEMI_R \}/.test(hra));
ok('polygon se kreslí jen z pořádného obrysu', /u\.hranice\.length >= 4/.test(hra));

// Obrys se musí vzít z téhož dotazu, který okres určil. Hledání podle jména
// vracelo u „okres Šumperk" město Šumperk a na mapě svítila obec místo okresu.
ok('okres si nese obrys z reverse',
  /polygon_geojson=1&lat=/.test(Z) && /hranice: body && body\.length >= 4/.test(Z));
ok('a hledání podle jména je až poslední záchrana',
  /if \(!h \|\| !h\.hranice\) \{\s*const z = await najdiHranici/.test(Z));
ok('nalezený okres se rovnou uloží i s hranicí', /zajisti\(o\.key, o\.nazev, o\.zeme, o\)/.test(Z));

// Okres je víc než jedno město a nemá stát stejně. Volná místa znají jen tu
// část okresu, kterou někdo prozkoumal — počet obyvatel platí i pro zbytek.
const U2 = cti('services/game/unie.js');
ok('licence počítá i z obyvatel okresu',
  /licence_za_obyvatele/.test(U2) && /Math\.round\(obyvatel \* \(nast\.licence_za_obyvatele/.test(U2));
ok('a bere to vyšší z obou měřítek, ne součet',
  /const cena = Math\.max\(nast\.licence_min,[\s\S]{0,200}licence_za_obyvatele/.test(U2));
ok('počet obyvatel se u okresu drží', /obyvatel   Int\?/.test(cti('prisma/schema.prisma')));
ok('a tahá se z OSM', /function pocetObyvatel\(x\)/.test(Z) && /extratags=1/.test(Z));
// Jméno není identita: doptat se musí podle osm_id toho objektu, který
// reverse vrátil, ne podle textu „okres Šumperk".
ok('obrys se doptává podle osm_id', /function lookup\(osmType, osmId\)/.test(Z)
  && /osm_ids=' \+ p \+ encodeURIComponent\(osmId\)/.test(Z)
  && /if \(\(!body \|\| body\.length < 4\) && j\.osm_type && j\.osm_id\) \{[\s\S]{0,200}await lookup\(j\.osm_type, j\.osm_id\)/.test(Z));
ok('a chybějící obrys se dohledá přes město okresu',
  /najdiOkres\(mesto\.lat, mesto\.lon, mesto\.country\)/.test(Z));
// Overpass se ptá rovnou na hranici, která ten bod obsahuje. Nominatim je
// geokodér: umí jméno, ale obrys z něj chodí nespolehlivě — a jméno není
// identita, hledání „okres Šumperk" trefilo město Šumperk.
ok('hranice se tahá z Overpassu', /function okresOverpass\(lat, lon, zemeHint\)/.test(Z)
  && /is_in\(' \+ Number\(lat\)/.test(Z));
ok('a Nominatim je až záloha',
  /const op = await okresOverpass\(lat, lon, zemeHint\)[\s\S]{0,120}if \(op && op\.key && op\.hranice\) return op;/.test(Z));
ok('bere se nižší správní úroveň', /rely\.sort\(\(a, b\) => Number\(a\.tags\.admin_level/.test(Z));
ok('a jen vnější okraj relace', /!m\.role \|\| m\.role === 'outer'/.test(Z));
ok('kusy relace se sešívají', /const obrys = sesij\(casti\);/.test(Z));
ok('když ani to nevyjde, je to vidět v logu', /hranice se nestáhla/.test(Z));

// Hranice chodí z Overpassu po kouscích a v náhodném pořadí. Bez sešití by
// z obrysu byla hvězdice — čáry by skákaly křížem krážem.
const ses = Z.match(/function sesij\(casti\) \{[\s\S]*?\n\}/);
ok('v okresy.js se našlo: sesij', !!ses);
if (ses) {
  const b2 = { Math: Math };
  vm.createContext(b2);
  vm.runInContext(ses[0], b2);
  const h = [[0, 0], [0, 1]], p = [[1, 1], [0, 1]], d = [[1, 1], [1, 0]], l = [[1, 0], [0, 0]];
  const kruh2 = b2.sesij([p, l, h, d]);
  ok('kusy se sešijí do kruhu', kruh2.length === 5, '— ' + kruh2.length + ' bodů');
  ok('a konec navazuje na začátek',
    kruh2[0][0] === kruh2[kruh2.length - 1][0] && kruh2[0][1] === kruh2[kruh2.length - 1][1],
    '— ' + JSON.stringify([kruh2[0], kruh2[kruh2.length - 1]]));
  ok('obrácený kus se otočí', b2.sesij([h, p]).length === 3);
  ok('kus, co nenavazuje, se nepřilepí', b2.sesij([h, [[9, 9], [9, 8]]]).length === 2);
  ok('prázdno nic neshodí', b2.sesij([]).length === 0);
}

const schema = cti('prisma/schema.prisma');
ok('schéma zná okresy', /model GameOkres \{/.test(schema));
ok('území se klíčuje okresem', /okres_key  String   @unique @map\("area_key"\)/.test(schema));
ok('a licence taky', /okres_key  String   @map\("area_key"\)/.test(schema));
ok('město si pamatuje svůj okres', /okres_key   String\?  @db\.VarChar\(80\)/.test(schema));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
