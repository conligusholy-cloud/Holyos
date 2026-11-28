// Náhrada za trvalé kampaně nad strop.
//
// Karta „trvalá kampaň" dávala +15 % návštěvnosti a sčítala se bez omezení.
// Návštěvnost ale násobí tržbu celé sítě, takže třicet karet znamenalo
// +450 % a jedna taková karta rozhodila žebříček víc než sto prádlomatů.
// Strop šesti karet je proto správně — jenže přišel až potom, co si je
// hráči koupili. Komu jich zbylo dvacet čtyři, tomu nedělají nic a ty
// nepoužité nejde ani použít.
//
// Hlídá se tu čtvero:
//
//  1. Které karty zemřely. Nejdřív nepoužité — ty jsou celé a hráč je nikdy
//     nespálil. Teprve pak ty použité nad strop.
//  2. Že se náhrada dá jen jednou. Karta se značí a zároveň zavírá; bez toho
//     by si ji hráč použil znovu a chtěl náhradu podruhé.
//  3. Že se mrtvé karty přestanou počítat do boostu i do stropu. Jinak má
//     hráč peníze i efekt.
//  4. Kurz. Vrací se cena karty v herních penězích a ten přepočet musí sedět
//     s ceníkem hotovosti — dvě čísla na dvou místech se vždycky rozejdou.
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
const NAV = cti('services/game/navstevnost.js');
const ACC = cti('routes/game-account.routes.js');
const KAT = JSON.parse(cti('services/game/texty/cs.json'));

// ─── Které karty zemřely ─────────────────────────────────────────────────────
const box = { BOOST_KARET_MAX: 6 };
vm.createContext(box);
vm.runInContext((NAV.match(/function mrtveKarty\(pouzite, nepouzite\) \{[\s\S]*?\n\}/) || [''])[0], box);
const karty = (n, od) => Array.from({ length: n }, (_, i) => ({ id: od + i }));
const id = (l) => l.map((c) => c.id).join(',');

ok('šest a míň karet nikomu nezemře',
  box.mrtveKarty(karty(6, 1), []).length === 0
  && box.mrtveKarty(karty(2, 1), karty(3, 10)).length === 0);
// Hráč s třiceti kartami: šest žije, čtyřiadvacet je k ničemu.
ok('co je nad strop, zemře', box.mrtveKarty(karty(30, 1), []).length === 24);
ok('a jsou to ty pozdější, ne první', id(box.mrtveKarty(karty(30, 1), [])).startsWith('7,8,9'));
// Nepoužité jdou první: hráč je nikdy nespálil, takže se mu vracejí celé.
ok('nejdřív se proplatí nepoužité',
  id(box.mrtveKarty(karty(6, 1), karty(2, 100))) === '100,101');
ok('a teprve pak použité nad strop',
  id(box.mrtveKarty(karty(8, 1), karty(2, 100))) === '100,101,7,8');
ok('hráč bez karet nemá co proplácet', box.mrtveKarty([], []).length === 0);

// ─── Jednou a dost ───────────────────────────────────────────────────────────
const fce = (NAV.match(/async function nahradKartyNadStrop\(\) \{[\s\S]*?\n\}/) || [''])[0];
ok('náhrada se v kódu našla', fce.length > 400);
ok('proplacené karty se značí', /data: \{ used_on: NAD_STROP, used_at: new Date\(\) \}/.test(fce));
ok('a tím se i zavřou, ať nejdou použít', /used_at: new Date\(\)/.test(fce));
ok('podruhé se už neberou', /NOT: \{ used_on: NAD_STROP \}/.test(fce));
ok('a celé to běží jen jednou', /if \(NAHRAZENO\) return 0;\n  NAHRAZENO = true;/.test(NAV));
ok('peníze jdou doručenkou, ne tiše',
  /kind: 'cash',\n      amount: castka, spot_id: 'karta:strop:'/.test(fce));
ok('a částka je cena karty krát počet',
  /const castka = NAHRADA_ZA_KARTU \* mrtve\.length;/.test(fce));
ok('hráč se ve zvonku doví, co se stalo',
  !!KAT['dor.karta_nad_strop'] && KAT['dor.karta_nad_strop'].indexOf('{penize}') > 0
  && KAT['dor.karta_nad_strop'].indexOf('{p1}') >= 0);

// ─── Mrtvá karta nesmí dál hrát ──────────────────────────────────────────────
// Jinak má hráč peníze i efekt — a to je horší než původní chyba.
ok('do boostu se mrtvé karty nepočítají',
  /kind: 'traffic', used_at: \{ not: null \},\n      NOT: \{ used_on: NAD_STROP \}/.test(NAV));
ok('a do stropu při použití další karty taky ne',
  /kind: 'traffic', used_at: \{ not: null \},\n          NOT: \{ used_on: NAV\.NAD_STROP \}/.test(ACC));
ok('náhrada se spouští, když si hráč otevře karty',
  /nahradaNaPozadi\(\);/.test(ACC));

// ─── Kurz ────────────────────────────────────────────────────────────────────
// Vrací se cena karty v herních penězích, přepočtená nejlepším kurzem, jaký
// v obchodě je. Obě čísla žijí na dvou místech, takže se musí ověřit proti
// sobě — jinak se časem rozejdou a hráči se vrátí nesmysl.
const cenaKarty = Number((NAV.match(/const KARTA_CENA_HAL = (\d+);/) || [])[1]);
const kurz = Number((NAV.match(/const KURZ_LAUNDRY_ZA_HALER = (\d+);/) || [])[1]);
const trafficCena = Number((ACC.match(/kind: 'traffic', icon: 'megaphone', price: (\d+)/) || [])[1]);
const cash = {};
(ACC.match(/cash\d+:\s*\{ kind: '[a-z0-9]+',\s*price: \d+,\s*laundry: \d+ \}/g) || []).forEach((r) => {
  const m = r.match(/kind: '([a-z0-9]+)',\s*price: (\d+),\s*laundry: (\d+)/);
  if (m) cash[m[1]] = { price: Number(m[2]), laundry: Number(m[3]) };
});
const nejlepsi = Math.max.apply(null, Object.keys(cash).map((k) => cash[k].laundry / cash[k].price));
ok('cena karty v náhradě sedí s ceníkem', cenaKarty === trafficCena,
  cenaKarty + ' vs ' + trafficCena);
ok('a kurz je ten nejlepší, jaký v obchodě je', kurz === nejlepsi,
  kurz + ' vs ' + nejlepsi);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
