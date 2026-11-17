// Mez přírůstku hotovosti — počítá se z toho, co ví server, ne z toho,
// co pošle prohlížeč.
//
// Tohle je první kámen serverového počítání peněz. Zatím se jen měří, ale
// až se z meze stane strop, bude na tomhle testu stát, jestli se poctivému
// hráči nezastaví hra.
//
// Databáze se neptáme: prisma se podstrčí, aby test běžel všude a rychle.
const Module = require('module');
const puvodni = Module.prototype.require;

let CLAIMS = [];
let DORUCENKY = [];
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameSpotClaim: { findMany: async () => CLAIMS },
      gameDelivery: { findMany: async () => DORUCENKY },
    } };
  }
  return puvodni.apply(this, arguments);
};

const strop = require('../services/game/strop');
Module.prototype.require = puvodni;

const MESIC = strop.MESIC_MS;
let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

function hrac(hotovost, predMs) {
  return { id: 1, nick: 'Test', state: { cash: hotovost },
    state_at: new Date(Date.now() - predMs) };
}

(async () => {
  // ── Jeden MAX stroj za jeden herní měsíc ───────────────────────────────
  // 20 lidí denně × návštěvnost 2,0 × 30,5 dne × 11,33 € × 24,35 = ~337 tis.
  const zaMesic = strop.stropStroje('max');
  ok('strop jednoho MAXu za měsíc je kolem 337 tisíc',
    Math.abs(zaMesic - 336800) < 2000, '— vyšlo ' + Math.round(zaMesic));

  // ── Poctivý hráč projde ────────────────────────────────────────────────
  CLAIMS = [{ model: 'max' }, { model: 'max' }, { model: 'flex' }];
  DORUCENKY = [];
  let v = await strop.prirustek(hrac(1000000, MESIC), 1000000 + 400000);
  ok('poctivý přírůstek se vejde', v.sedi,
    '— přidal ' + v.rozdil + ', strop ' + v.strop);

  // ── Dopsaná miliarda neprojde ──────────────────────────────────────────
  v = await strop.prirustek(hrac(1000000, MESIC), 1000000000);
  ok('dopsaná miliarda se nevejde', !v.sedi,
    '— přidal ' + v.rozdil + ', strop ' + v.strop);

  // ── Víc prádlomatů = vyšší mez ─────────────────────────────────────────
  const maly = await strop.prirustek(hrac(0, MESIC), 5000000);
  CLAIMS = new Array(40).fill({ model: 'max' });
  const velky = await strop.prirustek(hrac(0, MESIC), 5000000);
  // Porovnáváme příspěvek strojů, ne celou mez: v té je i pevná rezerva,
  // která u malé sítě převáží všechno ostatní.
  ok('velká síť má vyšší mez než malá', velky.ze_stroju > maly.ze_stroju * 5,
    '— ze strojů ' + maly.ze_stroju + ' vs ' + velky.ze_stroju);
  ok('velké síti projde, co malé neprojde', velky.sedi && !maly.sedi);

  // ── Čas hraje roli ─────────────────────────────────────────────────────
  CLAIMS = [{ model: 'max' }];
  const hodina = await strop.prirustek(hrac(0, 3600000), 1);
  const tyden = await strop.prirustek(hrac(0, 7 * 86400000), 1);
  ok('delší nepřítomnost zvedá mez', tyden.strop > hodina.strop,
    '— hodina ' + hodina.strop + ', týden ' + tyden.strop);

  // ── Co poslal server, se počítá ────────────────────────────────────────
  CLAIMS = [];
  DORUCENKY = [];
  const bezVyplaty = await strop.prirustek(hrac(0, 60000), 50000000);
  DORUCENKY = [{ amount: 48000000 }, { amount: 2000000 }];
  const sVyplatou = await strop.prirustek(hrac(0, 60000), 50000000);
  ok('výplata podílu se do meze započte', !bezVyplaty.sedi && sVyplatou.sedi,
    '— bez ní strop ' + bezVyplaty.strop + ', s ní ' + sVyplatou.strop);

  // ── Hráč bez prádlomatů má aspoň rezervu ───────────────────────────────
  DORUCENKY = [];
  const novy = await strop.prirustek(hrac(0, 60000), 1000000);
  ok('nový hráč bez prádlomatů se vejde do rezervy', novy.sedi,
    '— strop ' + novy.strop);

  // ── Ubývání hotovosti se neřeší ────────────────────────────────────────
  const utratil = await strop.prirustek(hrac(5000000, MESIC), 10000);
  ok('utracení hotovosti mez neřeší', utratil.sedi && utratil.rozdil < 0);

  // ── První uložení nemá s čím porovnávat ────────────────────────────────
  const prvni = await strop.prirustek({ id: 2, state: null, state_at: null }, 999999999);
  ok('bez předchozího uložení se nehlásí nic', prvni.sedi);

  // ── Výpadek databáze ukládání hry nesmí shodit ─────────────────────────
  const puvodniClaims = CLAIMS;
  CLAIMS = null;   // findMany vrátí null → reduce spadne
  const pad = await strop.zkontroluj(hrac(0, MESIC), 999999999);
  ok('chyba uvnitř kontroly nezastaví ukládání', pad === true);
  CLAIMS = puvodniClaims;

  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
