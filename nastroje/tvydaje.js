// Výdaje, o kterých server ví ze svého: výměna stroje, poplatek za neúspěšné
// vyjednávání, odstupné — a poplatek za změnu splatnosti úvěru, který se
// pozná jen z rozdílu dvou uložení.
//
// Proč na tom záleží: čekaná změna i pokladna výdaje odečítají. Chybějící
// výdaj znamená, že server čeká víc hotovosti, než se opravdu stane, a ten
// rozdíl je místo, pod kterým se dá schovat hotovost odnikud.
const Module = require('module');
const puvodni = Module.prototype.require;
const KNIHA = [];
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: { gameVydaj: {
      create: async (x) => { KNIHA.push(x.data); return x.data; },
      findMany: async (q) => KNIHA.filter((r) => r.player_id === q.where.player_id),
    } } };
  }
  return puvodni.apply(this, arguments);
};
const VYD = require('../services/game/vydaje');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// Praha a Brno jsou od sebe vzdušnou čarou ~185 km.
const PRAHA = { lat: 50.08, lon: 14.44 };
const BRNO = { lat: 49.195, lon: 16.608 };

(async () => {
  // ── Doprava ────────────────────────────────────────────────────────────────
  const sidloPraha = { sidlo: Object.assign({ name: 'Praha' }, PRAHA), pobocky: [] };
  const blizko = VYD.doprava(sidloPraha, PRAHA, 'mini');
  ok('doprava na vlastní práh je jen paušál', blizko === VYD.DOPRAVA_PAUSAL,
    '— ' + blizko);
  const daleko = VYD.doprava(sidloPraha, BRNO, 'mini');
  ok('do Brna je to dráž', daleko > blizko, '— ' + daleko);
  ok('a sedí to na kilometry po silnici',
    Math.abs(daleko - (8000 + 185 * 1.3 * 120)) < 4000, '— ' + daleko);
  ok('MAX je dražší než MINI', VYD.doprava(sidloPraha, BRNO, 'max') > daleko);
  ok('bez základny se doprava neúčtuje',
    VYD.doprava({ pobocky: [] }, BRNO, 'mini') === 0);
  // Pobočka blíž k místu dopravu zlevní — vozí se z nejbližší základny.
  const sPobockou = { sidlo: Object.assign({ name: 'Praha' }, PRAHA),
    pobocky: [Object.assign({ name: 'Brno' }, BRNO)] };
  ok('vozí se z nejbližší základny',
    VYD.doprava(sPobockou, BRNO, 'mini') < daleko,
    '— ' + VYD.doprava(sPobockou, BRNO, 'mini') + ' vs ' + daleko);

  // ── Výměna stroje ──────────────────────────────────────────────────────────
  const misto = Object.assign({ spot_id: 'brno-7', pozemek: false }, BRNO);
  const nahoru = VYD.vymena(sPobockou, misto, 'mini', 'max');
  ok('výměna nahoru stojí dopravu i doplatek přípojek',
    nahoru.doprava > 0 && nahoru.doplatek > 0, '— ' + JSON.stringify(nahoru));
  const dolu = VYD.vymena(sPobockou, misto, 'max', 'mini');
  ok('výměna dolů doplatek nevrací', dolu.doplatek === 0, '— ' + dolu.doplatek);
  ok('ale dopravu zaplatíš tak jako tak', dolu.doprava > 0, '— ' + dolu.doprava);
  ok('stejná výměna dává vždycky stejnou cenu',
    VYD.vymena(sPobockou, misto, 'mini', 'max').celkem === nahoru.celkem);

  // ── Kniha výdajů ───────────────────────────────────────────────────────────
  KNIHA.length = 0;
  const ted = Date.now();
  await VYD.zapis(7, 'vymena', 45000, 'brno-7');
  await VYD.zapis(7, 'vyjednavani', VYD.BID_FEE, 'praha-1');
  await VYD.zapis(8, 'odstupne', 999999, 'praha-2');
  ok('zapsané výdaje se sečtou jen tomu svému hráči',
    (await VYD.zaObdobi(7, ted - 60000, ted + 60000)) === 50000,
    '— ' + (await VYD.zaObdobi(7, ted - 60000, ted + 60000)));
  await VYD.zapis(7, 'vymena', 0, 'x');
  await VYD.zapis(7, 'vymena', -5000, 'x');
  ok('nula ani záporná částka se nezapisuje', KNIHA.filter((r) => r.player_id === 7).length === 2);

  // ── Poplatek za změnu splatnosti ───────────────────────────────────────────
  const pred = { loans: [{ id: 'a', zbyva: 2000000, prepsano: 0 },
    { id: 'b', zbyva: 500000, prepsano: 2 }] };
  const po = { loans: [{ id: 'a', zbyva: 2000000, prepsano: 1 },
    { id: 'b', zbyva: 500000, prepsano: 2 }] };
  let r = VYD.poplatkySplatnosti(pred, po);
  ok('přepsaná smlouva stojí podíl z nesplacené jistiny',
    r.celkem === 10000 && r.kolik === 1, '— ' + r.celkem);
  ok('nepřepsaná smlouva nestojí nic',
    VYD.poplatkySplatnosti(pred, pred).celkem === 0);
  // Počítá se z jistiny PŘED změnou: po splátce je nižší a poplatek by vyšel menší.
  const poSeSplatkou = { loans: [{ id: 'a', zbyva: 10, prepsano: 1 },
    { id: 'b', zbyva: 500000, prepsano: 2 }] };
  ok('bere se jistina před změnou, ne po ní',
    VYD.poplatkySplatnosti(pred, poSeSplatkou).celkem === 10000,
    '— ' + VYD.poplatkySplatnosti(pred, poSeSplatkou).celkem);
  // Nový úvěr není přepsaný — za jeho sjednání se poplatek neplatí.
  const novyUver = { loans: [{ id: 'a', zbyva: 2000000, prepsano: 0 },
    { id: 'b', zbyva: 500000, prepsano: 2 }, { id: 'c', zbyva: 900000, prepsano: 0 }] };
  ok('nový úvěr poplatek nevyrobí',
    VYD.poplatkySplatnosti(pred, novyUver).celkem === 0);
  ok('prázdný stav nic neshodí', VYD.poplatkySplatnosti(null, null).celkem === 0);

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
