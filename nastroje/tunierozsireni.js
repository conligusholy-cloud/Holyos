// Rozšiřování území o sousední okresy.
//
// Území šlo vzít jen tam, kde už hráč sám stavěl — pozdní hra tím končila
// u vlastní sítě a růst se nedal plánovat. Okres má hranici, takže jde
// nakreslit i to, co je vedle, a dát k tomu plus.
//
// Dvě věci se tu musí držet, obě o cizím majetku a cizích penězích:
// území si smíš vzít jen tam, kam dosáhneš servisem (pobočka, sídlo, nebo
// už tam stavíš), a sousedé se nehledají znovu a znovu — je to dvanáct
// dotazů na cizí službu zdarma.
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
const R = cti('routes/game-unie.routes.js');
const hra = cti('public/compounder/game/game.js');

// ─── Kam se sáhne pro souseda ────────────────────────────────────────────────
const kusy = ['tezisteObrysu', 'bodVen'].map(function (jm) {
  const m = Z.match(new RegExp('function ' + jm + '\\([\\s\\S]*?\\n\\}'));
  ok('v okresy.js se našlo: ' + jm, !!m);
  return m ? m[0] : '';
});
const box = { SMERU: 12, VEN_KM: 6 };
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);

// Čtverec 1° × 1° se středem v 50,17.
const ctverec = [[49.5, 16.5], [50.5, 16.5], [50.5, 17.5], [49.5, 17.5]];
const stred = box.tezisteObrysu(ctverec);
ok('těžiště sedí doprostřed', Math.abs(stred[0] - 50) < 1e-9 && Math.abs(stred[1] - 17) < 1e-9,
  '— ' + JSON.stringify(stred));

// Bod na sever musí ležet VEN z obrysu, jinak by se hra zeptala sama sebe
// a souseda nikdy nenašla.
const sever = box.bodVen(ctverec, stred, 0);
ok('bod na sever je za hranicí', sever && sever[0] > 50.5, '— ' + JSON.stringify(sever));
const vychod = box.bodVen(ctverec, stred, Math.PI / 2);
ok('bod na východ je za hranicí', vychod && vychod[1] > 17.5, '— ' + JSON.stringify(vychod));
const jih = box.bodVen(ctverec, stred, Math.PI);
ok('a na jih taky', jih && jih[0] < 49.5, '— ' + JSON.stringify(jih));
ok('ve směru, kde obrys nic nemá, se nic nevymýšlí',
  box.bodVen([[50, 17]], [50, 17], 0) === null);

// ─── Sousedé se hledají jednou ───────────────────────────────────────────────
ok('uložení sousedé se čtou z databáze',
  /if \(Array\.isArray\(o\.sousedi\) && o\.sousedi\.length\) return o\.sousedi;/.test(Z));
ok('a po hledání se uloží', /data: \{ sousedi: klice \}/.test(Z));
ok('mezi dotazy je pauza', /setTimeout\(r, 1100\)/.test(Z));
ok('sám sebe za souseda nepovažuje', /n\.key !== key/.test(Z));
ok('a nalezený soused se rovnou uloží i s obrysem',
  /zajisti\(n\.key, n\.nazev, n\.zeme, n\)/.test(Z));
ok('bez obrysu se sousedi nehledají', /if \(!body \|\| body\.length < 4\) return \[\];/.test(Z));

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
