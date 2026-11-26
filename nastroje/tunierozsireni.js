// Rozšiřování území o sousední buňky.
//
// Území šlo vzít jen tam, kde už hráč sám stavěl — pozdní hra tím končila
// u vlastní sítě a růst se nedal plánovat. Buňka sítě má šest sousedů, takže
// jde nakreslit i to, co je vedle, a dát k tomu plus.
//
// Dřív se sousedé pracně hledali: kolem obrysu se sáhlo dvanácti směry ven
// a cizí služby se zeptalo, co tam je. Teď je to prostě šest sousedních
// buněk — žádné dotazování, žádná pauza mezi dotazy, žádné „zatím nevím".
//
// Co se tu pořád musí držet, je to o cizím majetku a cizích penězích: území
// si smíš vzít jen tam, kam dosáhneš servisem — pobočka, sídlo, nebo už tam
// stavíš.
const fs = require('fs');
const path = require('path');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(koren, p), 'utf8');
const Z = cti('services/game/okresy.js');
const R = cti('routes/game-unie.routes.js');
const hra = cti('public/compounder/game/game.js');

// ─── Sousedé ─────────────────────────────────────────────────────────────────
// Šest sousedních buněk, spočítaných, ne hledaných. Vlastnosti sítě hlídá
// tokresy.js; tady jde o to, že se sousedé uloží a že se rovnou založí jejich
// řádky — bez nich by hráč klikl na „+" a nenašel tam nic.
const S = require('../services/game/sit');
const UKAZKA = S.klicBodu(49.9653, 16.9706);
ok('soused se počítá, nehledá', S.sousedniKlice(UKAZKA).length === 6);
ok('sousedi se ukládají k území', /sousedi: sousedniKlice\(key\)/.test(Z));
ok('a jejich řádky se rovnou založí',
  /for \(const k of klice\) await zajisti\(k, null, null\)/.test(Z));
ok('sám sebe za souseda nepovažuje', /\(k\) => k !== key/.test(cti('services/game/sit.js')));
// Po síti se kvůli sousedům nikam nesahá — tohle bývalo dvanáct dotazů na
// cizí službu s vteřinovou pauzou mezi nimi.
ok('žádná pauza mezi dotazy už není potřeba', Z.indexOf('setTimeout(r, 1100)') < 0);

// ─── Kam dosáhnu servisem ────────────────────────────────────────────────────
// Bez tohohle by šlo skoupit půl republiky od stolu a servis by v těch
// okresech neměl kdo dělat.
ok('převzetí chce pobočku nebo vlastní stroje',
  /const mamStroje = await prisma\.gameSpotClaim\.count\(/.test(R)
  && /if \(!mamStroje\) \{[\s\S]{0,400}server\.unie_bez_pobocky/.test(R));
ok('sídlo se bere jako pobočka', /if \(st && st\.sidlo\) pob\.push\(st\.sidlo\)/.test(R));
ok('soused nese, jestli tam pobočku mám', /pobocka: pobocka \? String\(pobocka\.name/.test(R));
ok('a jestli ho už někdo drží', /drzi: drzi\.get\(o\.key\) \|\| null/.test(R));
ok('vlastní území se mezi sousedy nenabízí', /if \(!mam\.has\(k\)\) klice\.add\(k\)/.test(R));

// ─── Mapa ────────────────────────────────────────────────────────────────────
ok('sousedé se kreslí slabě a s plusem',
  /dashArray: '4 4'/.test(hra) && /uzemi-plus-pin/.test(hra));
ok('plus otevře kartu souseda', /\.on\('click', function \(\) \{ unieSousedSheet\(n\); \}\)/.test(hra));
ok('bez pobočky se nenabízí převzetí', /var muzu = !n\.drzi && !!n\.pobocka;/.test(hra));
// Bez pobočky si území vzít nejde — a chodit kvůli ní na mapu a zpátky je
// zbytečná cesta. Zřídí se rovnou z karty souseda.
ok('pobočku jde zřídit rovnou z karty souseda',
  /function unieSousedPobocka\(n\)/.test(hra) && /data-sous-pob=/.test(hra));
ok('server pošle města té buňky', /mesta: mesta\.map\(\(m\) => \(\{ key: m\.key/.test(R));
// Pobočka v neprozkoumaném městě by znamenala servis tam, kde hráč nikdy nebyl.
ok('nabízejí se jen prozkoumaná města',
  /znam = vse\.filter\(function \(m\) \{ return S\.areas && S\.areas\[m\.key\]; \}\)/.test(hra));
const usekPob = (hra.match(/function unieSousedPobocka\(n\) \{[\s\S]*?\n\}/) || [''])[0];
ok('funkce na zřízení pobočky se našla', usekPob.length > 200);
ok('a bez peněz je tlačítko zhasnuté',
  /S\.cash < POBOCKA_CENA \? ' disabled' : ''/.test(usekPob));
ok('je na něm vidět, co to stojí teď i měsíčně',
  /veta\.unie_soused_pobocka_cena[\s\S]{0,120}POBOCKA_CENA, p2: POBOCKA_MESICNE/.test(usekPob));
// Bez prozkoumaného města pobočku založit nejde — a posílat hráče hledat to
// město na mapě je ta samá zbytečná cesta. Tlačítko otevře hledání
// s předvyplněným městem.
ok('neprozkoumané město jde prozkoumat odsud', /data-sous-scout=/.test(usekPob));
ok('a bez peněz na cestu je i to tlačítko zhasnuté',
  /S\.cash < SCOUT_COST \? ' disabled' : ''/.test(usekPob));
ok('otevře hledání s předvyplněným městem',
  /areasSheet\(t\.getAttribute\('data-sous-scout'\)\)/.test(hra));
ok('a je u toho cena cesty', /veta\.unie_soused_prozkoumej', \{ p1: SCOUT_COST \}/.test(usekPob));
// Server o pobočce ví až po uložení stavu — bez nového natažení by karta dál
// tvrdila, že tam pobočku nemáš, a tlačítko „Rozšířit" by se neobjevilo.
ok('po zřízení se sousedé natáhnou znovu',
  /UZEMI_SOUSEDI = null;\s*\n\s*nactiSousedy\(function \(\) \{[\s\S]{0,260}unieSousedSheet\(novy \|\| n\)/.test(hra));
ok('a stav se pošle na server', /save\(\); paint\(\); syncState\(true\);[\s\S]{0,200}data-sous-pob|data-sous-pob[\s\S]{0,900}syncState\(true\)/.test(hra));
ok('sousedi se tahají až se zapnutou vlaječkou',
  /UZEMI_VRSTVA && UZEMI_SOUSEDI == null/.test(hra));
ok('po převzetí se mapa načte znovu', /UZEMI_SOUSEDI = null; UZEMI_MAPA = null; UNIE = null;/.test(hra));

const KAT = JSON.parse(cti('services/game/texty/cs.json'));
['server.unie_bez_pobocky', 'unie.sousedi', 'unie.sousedi_popis', 'unie.sousedi_hledam',
  'unie.soused_pobocka', 'unie.soused_bez_pobocky', 'unie.rozsirit'].forEach((k) => {
  ok('katalog má ' + k, !!KAT[k]);
});
ok('schéma zná sousedy', /sousedi    Json\?/.test(cti('prisma/schema.prisma')));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
