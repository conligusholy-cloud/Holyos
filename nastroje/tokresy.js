// Území Unie je buňka sítě, která pokrývá celou zeměkouli.
//
// Dokud se území vázalo na město, kreslil se na mapě kruh o sedmi kilometrech
// kolem jeho středu — kresba bez podkladu. Pak se zkoušel skutečný okres
// z OpenStreetMap; z produkce se ale stáhnout nedal a když se hra o hranici
// pokusila podle jména, dostala místo okresu stejnojmenné město. A hlavně:
// hra se hraje po celém světě a správní členění srovnatelné s okresem všude
// není.
//
// Teď je území buňka pravidelné šestiúhelníkové sítě o velikosti zhruba
// okresu. Hlídá se tu čtvero:
//
//  1. Síť platí na celé zeměkouli a pokaždé stejně. Kdyby se klíč u téhož
//     bodu lišil, rozpadlo by se hráčům, co drží.
//  2. Buňka má velikost okresu, ne města a ne kraje. Na tom stojí cena
//     licence i to, kolik se do území vejde prádlomatů.
//  3. Obrys je mnohoúhelník a sousedé jsou skutečně sousedi — z toho žije
//     kreslení mapy a rozšiřování přes „+".
//  4. Nic se nestahuje. Jedna cizí služba na čtecí cestě stačila na to, aby
//     panel Unie visel na „Načítám…".
const fs = require('fs');
const path = require('path');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(koren, p), 'utf8');
// Geometrie je schválně v modulu bez databáze — jde tedy vyžádat a doopravdy
// spustit, ne jen číst jako text.
const S = require('../services/game/sit');

// ─── Klíč ────────────────────────────────────────────────────────────────────
const SUMPERK = [49.9653, 16.9706];
const k1 = S.klicBodu(SUMPERK[0], SUMPERK[1]);
ok('bod má klíč', !!k1 && typeof k1 === 'string', '— ' + k1);
ok('a je to klíč naší sítě', S.jeKlic(k1) === true);
ok('stejný bod dá vždy stejný klíč', S.klicBodu(SUMPERK[0], SUMPERK[1]) === k1);
// Starý klíč okresu tím musí propadnout — podle toho se pozná, co převést.
ok('starý klíč okresu propadne', S.jeKlic('cz:sumperk') === false);
ok('prázdno a nesmysly propadnou taky',
  S.jeKlic(null) === false && S.jeKlic('') === false && S.jeKlic('841e227') === false);
ok('nesmyslné souřadnice klíč nedají',
  S.klicBodu(null, 1) === null && S.klicBodu('x', 'y') === null && S.klicBodu(95, 10) === null);

// ─── Celá zeměkoule ──────────────────────────────────────────────────────────
// Tohle je ten důvod, proč se od skutečných okresů odešlo: musí to fungovat
// všude, ne jen tam, kde se povede něco stáhnout.
(function () {
  let spatnych = 0, bunek = new Set();
  for (let la = -85; la <= 85; la += 5) {
    for (let lo = -180; lo < 180; lo += 10) {
      const k = S.klicBodu(la, lo);
      if (!k || !S.jeKlic(k)) { spatnych++; continue; }
      bunek.add(k);
      const o = S.obrys(k);
      if (!o || o.length < 4) spatnych++;
    }
  }
  ok('klíč i obrys vyjdou v každém koutě světa', spatnych === 0, '— vadných ' + spatnych);
  ok('a nejsou to pořád tytéž buňky', bunek.size > 500, '— různých ' + bunek.size);
}());

// ─── Velikost ────────────────────────────────────────────────────────────────
// Český okres má v průměru kolem 1 000 km². Buňka musí být v tomhle řádu:
// kdyby byla velká jako kraj, území by si rozebralo pět hráčů a bylo by po
// pozdní hře; kdyby byla jako město, nebyl by to okres.
(function () {
  const mesta = [['Šumperk', 49.9653, 16.9706], ['Praha', 50.0875, 14.4213],
    ['Sydney', -33.8688, 151.2093], ['Nairobi', -1.2921, 36.8219],
    ['Reykjavík', 64.1466, -21.9426], ['Singapur', 1.3521, 103.8198]];
  const male = [], velke = [];
  mesta.forEach(function (m) {
    const p = S.plocha(S.klicBodu(m[1], m[2]));
    if (p < 700) male.push(m[0] + ' ' + p);
    if (p > 3000) velke.push(m[0] + ' ' + p);
  });
  ok('buňka není menší než okres', male.length === 0, male.join(', '));
  ok('a není větší než okres', velke.length === 0, velke.join(', '));
}());

// ─── Obrys ───────────────────────────────────────────────────────────────────
const o1 = S.obrys(k1);
ok('obrys je mnohoúhelník, ne čára', o1.length >= 4, '— vrcholů ' + o1.length);
ok('obrys je šestiúhelník', o1.length === 6);
ok('vrcholy jsou souřadnice', o1.every(function (b) {
  return Number.isFinite(b[0]) && Number.isFinite(b[1])
    && b[0] >= -90 && b[0] <= 90 && b[1] >= -180 && b[1] <= 180;
}));
ok('obrys cizího klíče nevznikne', S.obrys('cz:sumperk') === null && S.obrys(null) === null);
// Střed buňky musí padnout zpátky do téže buňky — jinak by odznak území
// seděl jinde, než území je.
const st = S.stred(k1);
ok('střed padne zpátky do své buňky', S.klicBodu(st.lat, st.lon) === k1);
ok('a leží uvnitř obrysu',
  st.lat > Math.min.apply(null, o1.map(function (b) { return b[0]; }))
  && st.lat < Math.max.apply(null, o1.map(function (b) { return b[0]; })));

// ─── Sousedé ─────────────────────────────────────────────────────────────────
const sous = S.sousedniKlice(k1);
ok('sousedů je šest', sous.length === 6, '— ' + sous.length);
ok('mezi sousedy není ona sama', sous.indexOf(k1) < 0);
ok('a žádný dvakrát', new Set(sous).size === sous.length);
ok('sousedství platí oběma směry',
  sous.every(function (k) { return S.sousedniKlice(k).indexOf(k1) >= 0; }));
ok('soused je zase buňka naší sítě', sous.every(S.jeKlic));
ok('cizí klíč sousedy nemá', S.sousedniKlice('cz:sumperk').length === 0);
// Blízká města padnou do jedné buňky nebo do sousední, vzdálená nikdy.
(function () {
  const sumperk = k1;
  const blizko = S.klicBodu(49.98, 17.00);          // pár kilometrů
  const daleko = S.klicBodu(50.0875, 14.4213);      // Praha
  ok('pár kilometrů je táž nebo sousední buňka',
    blizko === sumperk || sous.indexOf(blizko) >= 0);
  ok('dvě stě kilometrů už ne', daleko !== sumperk && sous.indexOf(daleko) < 0);
}());

// ─── Jméno a obyvatelé ───────────────────────────────────────────────────────
const mesta = [{ name: 'Šumperk', population: 25000 },
  { name: 'Zábřeh', population: 13000 }, { name: 'Bez údaje', population: null }];
ok('území se jmenuje po největším městě', S.nejvetsi(mesta).name === 'Šumperk');
ok('obyvatelé jsou součet známých měst', S.soucetObyvatel(mesta) === 38000);
ok('bez měst není počet nula, ale nic', S.soucetObyvatel([]) === null);
ok('prázdno nic neshodí',
  S.nejvetsi(null) === null && S.soucetObyvatel(null) === null
  && S.nejvetsi([null, {}]) !== undefined);

// ─── Nic se nestahuje ────────────────────────────────────────────────────────
// Jedna cizí služba na čtecí cestě stačila na to, aby panel Unie visel na
// „Načítám…". Do území se žádná vrátit nesmí.
const Z = cti('services/game/okresy.js');
const SITZ = cti('services/game/sit.js');
ok('území se na nic po síti neptá',
  Z.indexOf('openstreetmap') < 0 && Z.indexOf('overpass') < 0 && Z.indexOf('fetch(') < 0);
ok('ani geometrie', SITZ.indexOf('fetch(') < 0 && SITZ.indexOf('http') < 0);
ok('hledání hranice podle jména v kódu NENÍ', Z.indexOf('najdiHranici') < 0);

// ─── Převod toho, co běží ────────────────────────────────────────────────────
// Pořadí je celé pravidlo: území se musí převést DŘÍV, než se městům
// přepočítají klíče — staré území se k městu dohledává právě přes ten starý
// klíč. Opačně by se nenašlo žádné a všem by území zmizela.
ok('převod jde přes území a teprve pak přes města',
  Z.indexOf('gameTerritory.findMany') < Z.indexOf('Teprve teď města'));
ok('území se k městu dohledá přes starý klíč',
  /OR: \[\{ key: t\.okres_key \}, \{ okres_key: t\.okres_key \}\]/.test(Z));
ok('licence jdou s územím', /gameOperatorLicence\.updateMany\([\s\S]{0,160}okres_key: key/.test(Z));
ok('převod nepřepíše cizí území',
  /obsazeno && obsazeno\.id !== t\.id/.test(Z));
ok('a běží jen jednou', /if \(PREVEDENO\) return 0;/.test(Z));
ok('na čtecí cestě se na převod nečeká',
  /Promise\.resolve\(\)\.then\(prevedStaraUzemi\)/.test(Z));

// ─── Zábory se hledají přes města ────────────────────────────────────────────
// Zábor nese MĚSTO, území BUŇKU. Kdyby se zábory hledaly rovnou podle klíče
// území, nenašel by se ani jeden a všechno by tiše vycházelo nula.
const U = cti('services/game/unie.js');
ok('vyúčtování překládá území na města',
  /const klice = await OKRESY\.oblasti\(t\.okres_key\);[\s\S]{0,400}area_key: \{ in: klice \}/.test(U));
ok('přehled území taky',
  /const kliceO = await OKRESY\.oblasti\(t\.okres_key\);[\s\S]{0,400}area_key: \{ in: kliceO \}/.test(U));
ok('počítání strojů v území taky',
  /async function pocetVOkrese\(okresKey\) \{[\s\S]{0,300}area_key: \{ in: klice \}/.test(U));
ok('žebříček si drží překlad město→území',
  /okresMesta = new Map\(mesta\.map/.test(U) && /podleOkresu\[t\.okres_key\]/.test(U));
ok('a nikde se zábor nehledá podle klíče území',
  !/area_key: t\.okres_key/.test(U) && !/area_key: \{ in: uzemi\.map/.test(U));
ok('potenciál sčítá místa celého území',
  /prisma\.gameArea\.findMany\(\{ where: \{ okres_key: key \}/.test(U));

// ─── Mapa ────────────────────────────────────────────────────────────────────
const R = cti('routes/game-unie.routes.js');
ok('mapa posílá hranici', /hranice: Array\.isArray\(o\.hranice\) \? o\.hranice : null/.test(R));
ok('chybějící řádek území se rovnou založí',
  /for \(const k of chybi\) await OKRESY\.zajisti\(k, null, null\)/.test(R));
ok('stará území se převádějí na pozadí', /OKRESY\.prevodNaPozadi\(\)/.test(R));

const hra = cti('public/compounder/game/game.js');
ok('hra kreslí polygon', /L\.polygon\(u\.hranice, styl\)/.test(hra));
// Bez náhradního kruhu by nepřevedené území z mapy zmizelo úplně.
ok('a bez hranice zůstane kruh', /L\.circle\(\[u\.lat, u\.lon\], Object\.assign\(\{ radius: UZEMI_R \}/.test(hra));
ok('polygon se kreslí jen z pořádného obrysu', /u\.hranice\.length >= 4/.test(hra));

// ─── Co se nepřevedlo ────────────────────────────────────────────────────────
// Dva sousední okresy mohly spadnout do jedné buňky a jeden z nich byl
// v převodu dřív. Druhému zůstal řádek s klíčem města místo buňky: bez obrysu
// se nedal nakreslit, bez měst v něm nestál žádný prádlomat a nic nenesl —
// a přesto po hráči chtěl rozvojový závazek a dal se o něj vyzvat.
const O = cti('services/game/okresy.js');
ok('neprevedené území se ruší, ne přeskakuje',
  /async function zrusNeprevedene\(t, duvod\)/.test(O)
  && !/console\.warn\('\[game\] území', t\.okres_key, '— nejde převést[\s\S]{0,60}continue;/.test(O));
ok('ruší se, když se město nenašlo', /if \(!key\) \{\n      await zrusNeprevedene\(t, /.test(O));
ok('i když buňku drží někdo jiný',
  /obsazeno\.id !== t\.id\) \{[\s\S]{0,400}await zrusNeprevedene\(t, 'buňku '/.test(O));
ok('a licence se hráči vrací',
  /kind: 'cash',\n      amount: cena, spot_id: 'unie:zanik:' \+ t\.id/.test(O));
ok('řádek území zmizí', /gameTerritory\.delete\(\{ where: \{ id: t\.id \} \}\)/.test(O));
// Operátor si za licenci zaplatil masterovi — když území padne, nemá za co.
ok('operátorská licence padá s územím a peníze se vrací',
  /gameOperatorLicence\.updateMany|gameOperatorLicence\.update\(\{ where: \{ id: l\.id \}/.test(O)
  && /spot_id: 'unie:zanik-lic:' \+ l\.id/.test(O));
// Doručenka to musí umět říct, jinak hráči peníze jen tiše přibudou.
const KAT = JSON.parse(cti('services/game/texty/cs.json'));
ok('a hráč se ve zvonku doví proč',
  !!KAT['dor.unie_uzemi_zaniklo'] && !!KAT['dor.unie_uzemi_zaniklo_operator']
  && KAT['dor.unie_uzemi_zaniklo'].indexOf('{penize}') > 0);

// ─── Licence ─────────────────────────────────────────────────────────────────
// Území je víc než jedno město a nemá stát stejně. Volná místa zná hra jen
// z té části, kterou někdo prozkoumal — počet obyvatel platí i pro zbytek.
ok('licence počítá i z obyvatel území',
  /licence_za_obyvatele/.test(U) && /Math\.round\(obyvatel \* \(nast\.licence_za_obyvatele/.test(U));
ok('a bere to vyšší z obou měřítek, ne součet',
  /const cena = Math\.max\(nast\.licence_min,[\s\S]{0,200}licence_za_obyvatele/.test(U));
ok('počet obyvatel se u území drží', /obyvatel   Int\?/.test(cti('prisma/schema.prisma')));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
