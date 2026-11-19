// Které měřítko škody platí u soudu.
//
// Škodu počítala dvě různá místa a každé jinak. Řízení uznávalo provizi jen
// z účtů, které samo označí za mrtvé — smazané, zablokované, skoro nehrající.
// „Provize od živých hráčů je v pořádku" zní rozumně, dokud nepotkáš člověka,
// který si pomocné účty drží při životě: chvíli s nimi hraje, stroje od nich
// kupuje pod cenou — a na papíře je každý z nich živý hráč.
//
// Takový případ pak šel k soudu s pětinou toho, co ten člověk vzal: Pinon
// 5 323 513 proti 24 584 346 ze stejných dat. Platí proto větší z obou čísel.
const Z = require('../services/game/zlocin');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const R = { koef_zabaveni: 0.4, trest_nejnizsi: 1, trest_stredni: 1.2, trest_nejvyssi: 1.3 };

// Pinon: řízení napočítalo pětinu, vyhodnocení podvodů celou částku.
let r = Z.vetsiSkoda({ id: 1, skoda: 5323513 }, { zisk: 24584346 }, R);
ok('platí širší měřítko, když je vyšší', r.skoda === 24584346, '— ' + r.skoda);
ok('a je vidět, odkud to číslo je', r.skoda_podle === 'podvody');
ok('obě čísla zůstanou zapsaná',
  r.skoda_uzka === 5323513 && r.zisk_podvod === 24584346);
ok('trest se přepočítá z nové škody',
  r.trest.stredni === Math.round(24584346 * 1.2), '— ' + r.trest.stredni);
ok('a zmrazení taky', r.zmrazit === Math.round(24584346 * 0.4), '— ' + r.zmrazit);

// Andylka: obě měřítka souhlasí, nic se měnit nemá.
r = Z.vetsiSkoda({ id: 2, skoda: 33727445 }, { zisk: 33727445 }, R);
ok('shoda obou měřítek nic nemění', r.skoda === 33727445 && r.skoda_podle === 'rizeni');

// A obráceně: když řízení napočítá víc, platí ono. Širší měřítko počítá
// nákupy po pásmech, takže o některé může přijít.
r = Z.vetsiSkoda({ id: 3, skoda: 9000000 }, { zisk: 1000000 }, R);
ok('vyšší škoda z řízení se nesnižuje', r.skoda === 9000000, '— ' + r.skoda);
ok('a je označená jako z řízení', r.skoda_podle === 'rizeni');

// Chybějící vyhodnocení podvodů nesmí škodu vynulovat — to by byl tichý
// amnestijní zákon pokaždé, když se ten výpočet nepovede.
r = Z.vetsiSkoda({ id: 4, skoda: 7000000 }, null, R);
ok('bez vyhodnocení podvodů zůstane škoda z řízení', r.skoda === 7000000, '— ' + r.skoda);
r = Z.vetsiSkoda({ id: 5, skoda: 7000000 }, {}, R);
ok('a prázdný záznam ji taky nesmaže', r.skoda === 7000000);

// Nesmysly nic neshodí a nevyrobí záporný trest.
r = Z.vetsiSkoda({ id: 6, skoda: -5 }, { zisk: -9 }, R);
ok('záporné hodnoty padnou na nulu', r.skoda === 0 && r.trest.nejvyssi === 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
