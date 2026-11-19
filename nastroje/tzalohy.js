// Retence záloh databáze.
//
// Zálohuje se každé tři hodiny, ne jednou za noc: dump trvá sedmnáct vteřin,
// ale havárie ve tři odpoledne by u denní zálohy znamenala ztrátu celého dne
// hraní stotřiceti lidí.
//
// Retence proto nejde na počet. „Posledních třicet" by při osmi zálohách
// denně znamenalo necelé čtyři dny historie — a měsíc stará záloha by zmizela,
// aniž by si toho kdokoli všiml. Smazaná záloha se nevrací, takže se tenhle
// výpočet nespoléhá na to, že „by měl fungovat".
const Module = require('module');
const puvodni = Module.prototype.require;
// Modul si při načtení bere klienta R2 a AWS SDK; k výpočtu je nepotřebuje.
Module.prototype.require = function (co) {
  if (/@aws-sdk\/client-s3$/.test(co)) {
    return { PutObjectCommand: function () {}, ListObjectsV2Command: function () {},
      DeleteObjectCommand: function () {}, GetObjectCommand: function () {} };
  }
  if (/storage\/r2$/.test(co)) return { getClient: () => null };
  if (/\/settings$/.test(co)) return { getSetting: async () => null, setSetting: async () => {} };
  return puvodni.apply(this, arguments);
};
const B = require('../services/backup/db-backup');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const K = (den, hhmm) => 'db-backups/' + den + '_' + hhmm + '.dump.enc';
const TED = Date.UTC(2026, 10, 20, 12, 0, 0);   // 20. 11. 2026

// ── Jemné okno: poslední tři dny se nechávají celé ───────────────────────────
const dnes = ['0032', '0332', '0632', '0932'].map((h) => K('2026-11-20', h));
let keep = B.vyberKZachovani(dnes, TED);
ok('všechny dnešní zálohy zůstávají', keep.size === 4, '— ' + keep.size);

const tyden = [];
for (let d = 10; d <= 20; d++) {
  ['0232', '1132', '2032'].forEach((h) => tyden.push(K('2026-11-' + d, h)));
}
keep = B.vyberKZachovani(tyden, TED);
// 17.–20. 11. je jemné okno (4 dny × 3), zbytek jen poslední z každého dne.
ok('z posledních dnů zůstává všechno',
  ['0232', '1132', '2032'].every((h) => keep.has(K('2026-11-19', h))),
  '— ' + Array.from(keep).filter((k) => k.indexOf('11-19') > 0).length);
ok('ze starších dnů zůstává poslední z každého dne',
  keep.has(K('2026-11-12', '2032')) && !keep.has(K('2026-11-12', '0232')));
ok('a ta ranní se maže', !keep.has(K('2026-11-12', '1132')));

// ── Třicet dnů a rok zpátky ──────────────────────────────────────────────────
const dlouhe = [];
for (let m = 1; m <= 11; m++) {
  for (let d = 1; d <= 28; d += 1) {
    dlouhe.push(K('2026-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), '0232'));
  }
}
keep = B.vyberKZachovani(dlouhe, TED);
ok('z každého měsíce zůstává první záloha',
  keep.has(K('2026-01-01', '0232')) && keep.has(K('2026-05-01', '0232')));
// Tohle je ta past, kvůli které je retence časová: starý den uprostřed roku.
ok('ale ne každý den starého měsíce', !keep.has(K('2026-05-15', '0232')));
// Třicet dnů se počítá na dny, které v seznamu OPRAVDU jsou, ne na kalendář.
// Tady je v každém měsíci 28 dnů, takže třicítka sahá dva dny do října.
ok('posledních třicet záloh po dnech zůstává',
  keep.has(K('2026-11-01', '0232')) && keep.has(K('2026-10-27', '0232')),
  '— dnů v keep: ' + keep.size);
ok('a den před tou hranicí už ne', !keep.has(K('2026-10-26', '0232')));
ok('rok zpátky se nedrží víc než dvanáct měsíčních',
  Array.from(keep).filter((k) => k.indexOf('-01_') > 0).length <= 12);

// ── Nesmysly na vstupu ───────────────────────────────────────────────────────
ok('prázdný seznam nic neshodí', B.vyberKZachovani([], TED).size === 0);
ok('a null taky ne', B.vyberKZachovani(null, TED).size === 0);
// Nikdy se nesmí smazat úplně všechno: i jediná záloha zůstává.
ok('jediná stará záloha se nesmaže',
  B.vyberKZachovani([K('2020-01-01', '0232')], TED).size === 1);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
