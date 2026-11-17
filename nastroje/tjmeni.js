// Čisté jmění počítané serverem a zmrazené hodnosti.
//
// Tohle číslo rozhoduje o žebříčku, o hodnostech a o odměnách, které se za ně
// vyplácejí. Až se za herní peníze začnou kupovat podíly ve firmách, bude
// rozhodovat i o nich. Stojí za to ho ohlídat.
const Module = require('module');
const puvodni = Module.prototype.require;

let CLAIMS = [];
let OBJEDNAVKY = [];
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameSpotClaim: { findMany: async (q) => CLAIMS.filter((c) =>
        !q.where || q.where.player_id === undefined || c.player_id === q.where.player_id) },
      gameOrder: { findMany: async (q) => OBJEDNAVKY.filter((o) => {
        const w = (q && q.where) || {};
        if (w.player_id !== undefined && o.player_id !== w.player_id) return false;
        if (w.postaveno_at === null && o.postaveno_at) return false;
        if (w.zruseno_at === null && o.zruseno_at) return false;
        return true;
      }) },
    } };
  }
  return puvodni.apply(this, arguments);
};
const JMENI = require('../services/game/jmeni');
const POZEMKY = require('../services/game/pozemky');
const { hodnost, zmrazena, HODNOSTI } = require('../services/game/hodnosti');
Module.prototype.require = puvodni;

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const C = JMENI.CENY_STROJU;

// ── Z čeho se jmění skládá ───────────────────────────────────────────────────
let m = JMENI.majetekZ([
  { spot_id: 'praha-1', model: 'mini', pozemek: false, cena: null },
  { spot_id: 'praha-2', model: 'max', pozemek: false, cena: null },
], []);
ok('stroje na místech se sčítají podle modelu', m.stroje === C.mini + C.max,
  '— ' + m.stroje);
ok('bez pozemků a skladu je zbytek nula', m.zeme === 0 && m.sklad === 0);

// ── Koupená zem ──────────────────────────────────────────────────────────────
m = JMENI.majetekZ([{ spot_id: 'zlin-13', model: '', pozemek: true, cena: 260000 }], []);
ok('zem s uloženou cenou se bere, jak je', m.zeme === 260000, '— ' + m.zeme);

m = JMENI.majetekZ([{ spot_id: 'zlin-13', model: '', pozemek: true, cena: null }], []);
ok('zem bez ceny se odhadne středem pásma', m.zeme === POZEMKY.odhad('zlin-13'),
  '— ' + m.zeme + ' vs ' + POZEMKY.odhad('zlin-13'));

// Zem se strojem se počítá dvakrát: stroj i pozemek pod ním jsou majetek.
m = JMENI.majetekZ([{ spot_id: 'zlin-13', model: 'flex', pozemek: true, cena: 260000 }], []);
ok('vlastní zem pod strojem se počítá k němu, ne místo něj',
  m.stroje === C.flex && m.zeme === 260000);

// ── Sklad a zboží na cestě ───────────────────────────────────────────────────
m = JMENI.majetekZ([], [{ model: 'mini', cena: 0 }, { model: 'max', cena: 999 }]);
ok('stroj bez ceny se ocení ceníkem, s cenou podle ní', m.sklad === C.mini + 999,
  '— ' + m.sklad);

// ── Hotovost a dluh ──────────────────────────────────────────────────────────
ok('hotovost mínus dluh', JMENI.hotovostADluh({ cash: 5000000, loan: 2000000 }) === 3000000);
ok('zadlužený hráč jde do minusu', JMENI.hotovostADluh({ cash: 0, loan: 1000000 }) === -1000000);
ok('prázdný stav je nula', JMENI.hotovostADluh(null) === 0);

// ── Celý hráč ────────────────────────────────────────────────────────────────
(async () => {
  CLAIMS = [
    { player_id: 1, spot_id: 'praha-1', model: 'mini', pozemek: false, cena: null },
    { player_id: 1, spot_id: 'zlin-13', model: '', pozemek: true, cena: 260000 },
    { player_id: 2, spot_id: 'brno-0', model: 'max', pozemek: false, cena: null },
  ];
  OBJEDNAVKY = [
    { player_id: 1, model: 'flex', cena: C.flex, postaveno_at: null, zruseno_at: null },
    { player_id: 1, model: 'mini', cena: C.mini, postaveno_at: new Date(), zruseno_at: null },
    { player_id: 1, model: 'max', cena: C.max, postaveno_at: null, zruseno_at: new Date() },
  ];
  const r = await JMENI.rozpad(1, { cash: 1000000, loan: 400000 });
  ok('postavený a zrušený stroj se do skladu nepočítají', r.sklad === C.flex,
    '— ' + r.sklad);
  ok('rozpad sedí se součtem',
    r.jmeni === C.mini + 260000 + C.flex + 600000, '— ' + r.jmeni);

  // ── Dávkový výpočet dá totéž co jednotlivý ────────────────────────────────
  const vsichni = await JMENI.majetekVsech();
  const jeden = await JMENI.rozpad(1, { cash: 0, loan: 0 });
  ok('dávkový výpočet sedí s jednotlivým',
    vsichni.get(1).celkem === jeden.celkem, '— ' + vsichni.get(1).celkem + ' vs ' + jeden.celkem);
  ok('druhý hráč se nepomíchá s prvním', vsichni.get(2).celkem === C.max);
  ok('hráč bez ničeho v mapě není', vsichni.get(99) === undefined);

  // ── Zmrazené hodnosti ─────────────────────────────────────────────────────
  const magnat = HODNOSTI.find((h) => h.id === 'magnat');
  const nizsi = hodnost(5e6);          // živnostník
  ok('nižší spočítaná hodnost se nepoužije, drží se stará',
    zmrazena('magnat', nizsi).id === 'magnat', '— ' + zmrazena('magnat', nizsi).id);
  ok('vyšší spočítaná hodnost se vezme',
    zmrazena('zivnostnik', hodnost(magnat.od)).id === 'magnat');
  ok('stejná hodnost projde beze změny',
    zmrazena('sitar', hodnost(35e6)).id === 'sitar');
  ok('hráč bez hodnosti dostane spočítanou',
    zmrazena(null, nizsi).id === nizsi.id);
  ok('neznámá stará hodnost nic nerozbije',
    zmrazena('neexistuje', nizsi).id === nizsi.id);

  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
