// Cena pozemku na serveru musí dávat stejné číslo jako hra v prohlížeči.
//
// Obě implementace jsou dvě, protože server nemá jak spustit kód hry a hra
// nemá jak sáhnout do databáze. Dokud jsou dvě, můžou se rozejít — a pozemek
// není drobnost: je to nemovitost, banka proti ní půjčuje a u hráče uprostřed
// expanze je to většina majetku.
//
// Čísla níž nejsou vymyšlená. Vznikla porovnáním obou implementací na
// sedmdesáti kombinacích míst a skóre v opravdovém prohlížeči, kde se
// funkce braly z nasazeného game.js. Když se tenhle test rozbije, rozešly
// se znovu.
const p = require('../services/game/pozemky');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Pevné hodnoty ověřené proti hře ──────────────────────────────────────────
const ZNAME = [
  { id: 'praha-1', m2: 216, c0: 64800, c50: 86400, c100: 118800 },
  { id: 'kolin-24', m2: 322, c0: 96600, c50: 128800, c100: 177100 },
  { id: 'zlin-13', m2: 400, c0: 180000, c50: 260000, c100: 360000 },
  { id: 'bari-3', m2: 416, c0: 249600, c50: 353600, c100: 478400 },
  { id: 'telc-0', m2: 216, c0: 43200, c50: 64800, c100: 86400 },
];
ZNAME.forEach((z) => {
  ok('výměra ' + z.id, p.m2(z.id) === z.m2, '— ' + p.m2(z.id) + ' m²');
  ok('cena ' + z.id + ' při skóre 0 / 50 / 100',
    p.cena(z.id, 0) === z.c0 && p.cena(z.id, 50) === z.c50 && p.cena(z.id, 100) === z.c100,
    '— ' + p.cena(z.id, 0) + ' / ' + p.cena(z.id, 50) + ' / ' + p.cena(z.id, 100));
});

// ── Otisk místa ──────────────────────────────────────────────────────────────
ok('otisk je mezi nulou a jedničkou',
  ZNAME.every((z) => p.spotHash(z.id, 'm2') >= 0 && p.spotHash(z.id, 'm2') < 1));
ok('jiná sůl dá jiný otisk', p.spotHash('praha-1', 'm2') !== p.spotHash('praha-1', 'cm'));
ok('stejné místo dá vždy stejný otisk',
  p.spotHash('praha-1', 'm2') === p.spotHash('praha-1', 'm2'));

// ── Pásmo ────────────────────────────────────────────────────────────────────
let mimo = 0;
ZNAME.forEach((z) => {
  const pas = p.pasmo(z.id);
  for (let sc = 0; sc <= 100; sc += 5) {
    const c = p.cena(z.id, sc);
    if (c < pas.min || c > pas.max) mimo++;
  }
});
ok('cena při jakémkoli skóre padne do pásma', mimo === 0, mimo ? '— mimo ' + mimo + 'krát' : '');
ok('pásmo není širší než dvojnásobek',
  ZNAME.every((z) => p.pasmo(z.id).max <= p.pasmo(z.id).min * 2 + 1));

// ── Co server uzná ───────────────────────────────────────────────────────────
const pas = p.pasmo('praha-1');
ok('nafouknutá cena se zařízne na strop pásma',
  p.uznana('praha-1', 99999999) === pas.max, '— ' + p.uznana('praha-1', 99999999));
ok('podstřelená cena se zvedne na dno pásma',
  p.uznana('praha-1', 1) === pas.min, '— ' + p.uznana('praha-1', 1));
ok('poctivá cena projde beze změny',
  p.uznana('praha-1', p.cena('praha-1', 50)) === p.cena('praha-1', 50));
ok('bez čísla se bere střed pásma', p.uznana('praha-1', 0) === p.odhad('praha-1'));
ok('odhad leží v pásmu',
  p.odhad('praha-1') >= pas.min && p.odhad('praha-1') <= pas.max);

// ── Skóre mimo rozsah nesmí rozhodit cenu ────────────────────────────────────
ok('záporné skóre se bere jako nula', p.cena('praha-1', -50) === p.cena('praha-1', 0));
ok('skóre nad sto se bere jako sto', p.cena('praha-1', 500) === p.cena('praha-1', 100));
ok('nesmyslné skóre spadne na nulu', p.cena('praha-1', 'nic') === p.cena('praha-1', 0));

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
