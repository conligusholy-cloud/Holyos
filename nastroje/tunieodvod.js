// Z čeho území odvádí.
//
// Původně se počítaly jen cizí prádlomaty a masterova vlastní síť se
// vynechávala. Území plné vlastních strojů tím pádem nenosilo nic — a to
// nedává smysl ani tematicky: servis se platí z peněz, které do prádlomatu
// přinese zákazník, a tomu je jedno, čí ten prádlomat je.
//
// Nově odvádí každý stroj v území. Dvě věci se u toho musí držet:
// sám sobě si nikdo nepřiplácí (nad 100 % se u masterových strojů příplatek
// neúčtuje), a operátor bere svůj díl ze všeho — servisuje i masterovy stroje.
const U = require('../services/game/unie');
const fs = require('fs');
const path = require('path');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(koren, p), 'utf8');

// Místo se servisem 1000 L$ se dá spočítat z ruky: odvod 30 % = 300.
const MISTO = { model: 'flex', score: 50, rent: 0, pozemek: false };
const servis = U.servisMista(MISTO);
ok('servis místa je kladný', servis > 0, '— ' + servis);

// ─── Rozpad ──────────────────────────────────────────────────────────────────
let r = U.rozpad(1000, 100, 60, 30);
ok('ze servisu odejde odvod_pct', r.zaklad === 300, '— ' + r.zaklad);
ok('při 100 % se odvádí přesně základ', r.odvod === 300);
ok('operátor bere svůj díl', r.operator === 180 && r.master === 120);
ok('a nikdo nic nedoplácí', r.priplatek === 0);
r = U.rozpad(1000, 150, 60, 30);
ok('nad 100 % se připlácí rozdíl', r.priplatek === 150, '— ' + r.priplatek);
r = U.rozpad(1000, 50, 60, 30);
ok('pod 100 % se nepřiplácí nic', r.priplatek === 0 && r.odvod === 150);

// ─── Čí je stroj ─────────────────────────────────────────────────────────────
const uzemi = { master_id: 7, poplatek_pct: 150 };
const cizi = Object.assign({ player_id: 9 }, MISTO);
const muj = Object.assign({ player_id: 7 }, MISTO);

const rc = U.odvodZMista(cizi, uzemi, 60, 30);
const rm = U.odvodZMista(muj, uzemi, 60, 30);
ok('cizí stroj odvádí podle nastaveného poplatku', rc.odvod > rc.zaklad, '— ' + rc.odvod);
ok('a jeho majitel si nad 100 % připlácí', rc.priplatek > 0, '— ' + rc.priplatek);
ok('vlastní stroj odvádí taky', rm.odvod > 0 && rm.master > 0, '— ' + rm.master);
ok('ale sám sobě si master nepřiplácí', rm.priplatek === 0, '— ' + rm.priplatek);
ok('u vlastního se poplatek zastropuje na 100 %', rm.odvod === rm.zaklad, '— ' + rm.odvod);
// Operátor servisuje všechno, takže bere i z masterových strojů. Bez toho by
// za masterovu síť dělal servis zadarmo.
ok('operátor bere i z masterových strojů', rm.operator > 0, '— ' + rm.operator);
ok('a dělí se stejným poměrem', rm.operator === Math.round(rm.odvod * 0.6));

// Pod sto procenty se vlastní a cizí chovají stejně — strop se neprojeví.
const niz = { master_id: 7, poplatek_pct: 65 };
ok('pod 100 % je vlastní i cizí stejně',
  U.odvodZMista(muj, niz, 60, 30).odvod === U.odvodZMista(cizi, niz, 60, 30).odvod);

// Bez operátora zůstává celý odvod masterovi.
const bezOp = U.odvodZMista(cizi, niz, 0, 30);
ok('bez operátora bere master všechno', bezOp.master === bezOp.odvod && bezOp.operator === 0);

// ─── Jedno pravidlo na třech místech ─────────────────────────────────────────
// Vyúčtování, přehled území i žebříček Unie se musí ptát stejně. Když se
// rozejdou, hráč vidí v kartě jiné číslo, než co mu přijde doručenkou.
const Z = cti('services/game/unie.js');
ok('vyúčtování počítá přes odvodZMista', /mista\.forEach\(\(c\) => \{\s*const r = odvodZMista\(/.test(Z));
ok('přehled území taky', /vsechny\.forEach\(\(c\) => \{\s*const r = odvodZMista\(/.test(Z));
ok('žebříček taky', /podleOkresu\[t\.okres_key\] \|\| \[\]\)\.forEach\(\(c\) => \{\s*const r = odvodZMista\(/.test(Z));
ok('a nikde se už masterova síť nevynechává',
  !/player_id: \{ not: t\.master_id \}/.test(Z) && !/c\.player_id === t\.master_id\) return;/.test(Z));

// ─── Co o tom hra říká hráči ─────────────────────────────────────────────────
const hra = cti('public/compounder/game/game.js');
const KAT = JSON.parse(cti('services/game/texty/cs.json'));
ok('karta ukazuje všechny stroje', /hra\.unie_stroju/.test(hra) && !!KAT['hra.unie_stroju']);
ok('prázdné území má vlastní radu', /hra\.unie_rada_prazdno/.test(hra) && !!KAT['hra.unie_rada_prazdno']);
// Rada dřív posílala hráče snižovat poplatek, aby přilákal ostatní. Jenže
// pod 100 % se pro ně nemění nic — platí stejný servis, jen míň jde masterovi.
ok('rada už neslibuje, že nízký poplatek přiláká hráče',
  !/sniž poplatek, aby se sem hráčům vyplatilo/.test(KAT['hra.unie_rada_nikdo'] || ''));
ok('a rada o růstu nelže o vlastních strojích',
  /vlastní i cizí odvádějí stejně/.test(KAT['hra.unie_rada_rust'] || ''));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
