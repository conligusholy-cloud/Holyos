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
