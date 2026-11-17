// Ředění podílů při kapitálovém vstupu.
//
// Podíl rozhoduje o tom, komu kolik teče ze zisku. Chyba tady není chyba
// v zobrazení — je to krádež na splátky, která se pozná až za měsíc. Proto
// se hlídá hlavně jedna věta: koláč se po vstupu pořád rovná jedné.
const P = require('../services/game/podily');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const skoro = (a, b) => Math.abs(a - b) < 1e-9;
const soucet = (l) => l.reduce((a, e) => a + e.podil, 0);

// ── Příklad z komentáře: majitel 60, investor 40, vstup 25 ───────────────────
let po = P.redeni([{ id: 1, investor_id: 7, podil: 0.4 }], 0.25);
ok('dosavadní investor se zředí ze 40 na 30 %', skoro(po[0].podil, 0.3),
  '— ' + (po[0].podil * 100).toFixed(1) + ' %');
ok('majiteli zbyde 45 %', skoro(P.majitelPo(po, 0.25), 0.45),
  '— ' + (P.majitelPo(po, 0.25) * 100).toFixed(1) + ' %');
ok('koláč se rovná jedné', skoro(soucet(po) + 0.25 + P.majitelPo(po, 0.25), 1));

// ── Firma, kde je prodáno úplně všechno ──────────────────────────────────────
// Tohle je ten případ, kvůli kterému vstup vůbec je: majitel nemá co prodat,
// ručit nemá čím, a přesto do firmy jdou peníze dostat.
po = P.redeni([
  { id: 1, investor_id: 7, podil: 0.5 },
  { id: 2, investor_id: 8, podil: 0.5 },
], 0.4);
ok('i u stoprocentně prodané firmy vstup projde',
  skoro(soucet(po) + 0.4, 1), '— součet ' + (soucet(po) + 0.4));
ok('oba dosavadní se zředí stejně',
  skoro(po[0].podil, 0.3) && skoro(po[1].podil, 0.3));
ok('majiteli nic nezůstane, ale nejde do mínusu',
  P.majitelPo(po, 0.4) === 0);

// ── Dva vstupy po sobě ───────────────────────────────────────────────────────
let kolo1 = P.redeni([{ id: 1, investor_id: 7, podil: 0.4 }], 0.25);
let stav = kolo1.map((e) => ({ id: e.id, investor_id: e.investor_id, podil: e.podil }))
  .concat([{ id: 2, investor_id: 8, podil: 0.25 }]);
let kolo2 = P.redeni(stav, 0.2);
ok('po druhém vstupu se součet pořád rovná jedné',
  skoro(soucet(kolo2) + 0.2 + P.majitelPo(kolo2, 0.2), 1),
  '— ' + (soucet(kolo2) + 0.2 + P.majitelPo(kolo2, 0.2)));
ok('první investor je po dvou kolech na 24 %', skoro(kolo2[0].podil, 0.24),
  '— ' + (kolo2[0].podil * 100).toFixed(1) + ' %');

// ── Krajní hodnoty ───────────────────────────────────────────────────────────
po = P.redeni([{ id: 1, investor_id: 7, podil: 0.5 }], 0);
ok('nulový vstup nikoho nezředí', skoro(po[0].podil, 0.5));
po = P.redeni([{ id: 1, investor_id: 7, podil: 0.5 }], 1);
ok('stoprocentní vstup sebere všechno', skoro(po[0].podil, 0));
po = P.redeni([{ id: 1, investor_id: 7, podil: 0.5 }], -0.5);
ok('záporný vstup se bere jako nula', skoro(po[0].podil, 0.5));
po = P.redeni([{ id: 1, investor_id: 7, podil: 0.5 }], 5);
ok('vstup nad sto procent se zastropuje', skoro(po[0].podil, 0));
ok('prázdná firma nic nerozbije', P.redeni(null, 0.3).length === 0);

// ── Co se nesmí měnit ────────────────────────────────────────────────────────
const pred = [{ id: 1, investor_id: 7, podil: 0.4, cena: 1000000, vyplaceno: 50000 }];
po = P.redeni(pred, 0.25);
ok('původní podíl zůstane k nahlédnutí', skoro(po[0].podil_pred, 0.4));
ok('ředění nesahá na pořizovací cenu ani na vyplacené',
  pred[0].cena === 1000000 && pred[0].vyplaceno === 50000);
ok('investor u podílu zůstává týž', po[0].investor_id === 7);

// ── Podíl podle vložených peněz ──────────────────────────────────────────────
ok('vklad ve výši hodnoty firmy dá půlku', skoro(P.podilDleCeny(10e6, 10e6), 0.5));
ok('vklad pětiny hodnoty dá šestinu',
  skoro(P.podilDleCeny(10e6, 2e6), 2 / 12), '— ' + P.podilDleCeny(10e6, 2e6));
ok('do bezcenné firmy je každý vklad stoprocentní', skoro(P.podilDleCeny(0, 5e6), 1));
ok('nulový vklad nedá nic', P.podilDleCeny(10e6, 0) === 0);
ok('záporná hodnota firmy se bere jako nula', skoro(P.podilDleCeny(-5e6, 5e6), 1));

// ── Majitelův podíl ──────────────────────────────────────────────────────────
ok('majitel je zbytek do sta procent',
  skoro(P.majitel([{ podil: 0.3 }, { podil: 0.2 }]), 0.5));
ok('přeprodaná firma nedá majiteli mínus',
  P.majitel([{ podil: 0.7 }, { podil: 0.7 }]) === 0);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
