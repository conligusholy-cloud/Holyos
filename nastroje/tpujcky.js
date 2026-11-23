// Půjčky mezi hráči: kde je hráč vidí a jestli se počítají do jmění.
//
// Hráč nahlásil, že někomu dluží a nikde nevidí splátku. Karta „Půjčky
// a podíly" přitom existovala — stála ale jen na burze dole pod aukcemi
// a akciemi, takže ji nikdo nenašel. Totéž u koupených podílů: i tlačítko
// na odkup bylo schované tam.
//
// Druhá, horší půlka: hotovost z půjčky se do čistého jmění přičítala, ale
// dluh se neodečítal. Kdo si půjčil padesát milionů, vyskočil v žebříčku
// o padesát milionů nahoru — a podle jmění jedou hodnosti i odměny.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const hra = fs.readFileSync(path.join(koren, 'public/compounder/game/game.js'), 'utf8');

// ─── Server: dluh se odečte, pohledávka přičte ───────────────────────────────
let PUJCKY = [];
const puvodni = Module.prototype.require;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      gameSpotClaim: { findMany: async () => [] },
      gameOrder: { findMany: async () => [] },
      gameLoan: { findMany: async (q) => {
        const w = (q && q.where) || {};
        return PUJCKY.filter((p) => {
          if (w.stav && p.stav !== w.stav) return false;
          if (w.OR) return w.OR.some((o) => (o.lender_id !== undefined && p.lender_id === o.lender_id)
            || (o.borrower_id !== undefined && p.borrower_id === o.borrower_id));
          return true;
        });
      } },
    } };
  }
  return puvodni.apply(this, arguments);
};
const JMENI = require('../services/game/jmeni');
Module.prototype.require = puvodni;

(async () => {
  // Deset splátek po milionu, tři zaplacené → zbývá sedm milionů.
  PUJCKY = [{ lender_id: 1, borrower_id: 2, splatka: 1000000, mesicu: 10, splaceno: 3, stav: 'bezi' }];
  let mapa = await JMENI.pujckyVsech();
  ok('dlužníkovi se zbytek odečte', mapa.get(2) === -7000000, '— ' + mapa.get(2));
  ok('věřiteli přičte', mapa.get(1) === 7000000, '— ' + mapa.get(1));
  ok('ve hře se hodnota jen přesune', (mapa.get(1) || 0) + (mapa.get(2) || 0) === 0);

  // Doplacená půjčka už není dluh — a propadlá zástava taky ne.
  PUJCKY = [
    { lender_id: 1, borrower_id: 2, splatka: 1000000, mesicu: 10, splaceno: 10, stav: 'bezi' },
    { lender_id: 1, borrower_id: 3, splatka: 500000, mesicu: 4, splaceno: 0, stav: 'propadlo' },
  ];
  mapa = await JMENI.pujckyVsech();
  ok('doplacená půjčka se nepočítá', !mapa.get(2), '— ' + mapa.get(2));
  ok('propadlá taky ne', !mapa.get(3), '— ' + mapa.get(3));

  // Víc půjček naráz se sečte, obojí směrem.
  PUJCKY = [
    { lender_id: 1, borrower_id: 2, splatka: 100000, mesicu: 10, splaceno: 0, stav: 'bezi' },
    { lender_id: 3, borrower_id: 1, splatka: 200000, mesicu: 5, splaceno: 1, stav: 'bezi' },
  ];
  mapa = await JMENI.pujckyVsech();
  ok('půjčky se sčítají přes směry', mapa.get(1) === 1000000 - 800000, '— ' + mapa.get(1));
  ok('pro jednoho hráče vyjde totéž', (await JMENI.pujckyHrace(1)) === mapa.get(1));

  // Kdo nemá na mapě nic a jen půjčil, nesmí ze žebříčku vypadnout.
  PUJCKY = [{ lender_id: 9, borrower_id: 2, splatka: 1000000, mesicu: 3, splaceno: 0, stav: 'bezi' }];
  const vsech = await JMENI.majetekVsech();
  ok('věřitel bez majetku je v žebříčku taky',
    vsech.has(9) && vsech.get(9).celkem === 3000000, '— ' + JSON.stringify(vsech.get(9)));
  ok('a dlužníkovi to z majetku ubere', vsech.get(2).celkem === -3000000,
    '— ' + JSON.stringify(vsech.get(2)));

  const r = await JMENI.rozpad(2, { cash: 5000000, loan: 0 });
  ok('rozpad dluh ukáže zvlášť', r.pujcky === -3000000, '— ' + r.pujcky);
  ok('a jmění je o něj nižší', r.jmeni === 5000000 - 3000000, '— ' + r.jmeni);

  // ─── Hra: karta i čísla u hráče ────────────────────────────────────────────
  const m = hra.match(/function pujckyMoje\(\) \{[\s\S]*?\n\}/);
  ok('v game.js se našlo: pujckyMoje', !!m);
  if (m) {
    const box = { FINANCE: null, bezici: (x) => x.stav !== 'splaceno' && x.stav !== 'propadlo' && x.stav !== 'odkoupeno' };
    vm.createContext(box);
    vm.runInContext(m[0], box);
    let v = box.pujckyMoje();
    ok('bez načteného přehledu jsou nuly', v.dluzim === 0 && v.pujcil === 0);
    box.FINANCE = { pujcky: [
      { moje: 'dluzim', splatka: 1000000, mesicu: 10, splaceno: 3, stav: 'bezi', dalsi: Date.now() + 3600000 },
      { moje: 'pujcil', splatka: 500000, mesicu: 4, splaceno: 0, stav: 'bezi', dalsi: Date.now() + 60000 },
      { moje: 'dluzim', splatka: 900000, mesicu: 2, splaceno: 2, stav: 'splaceno', dalsi: 0 },
    ] };
    v = box.pujckyMoje();
    ok('hra počítá zbytek stejně jako server', v.dluzim === 7000000, '— ' + v.dluzim);
    ok('a co mi dluží taky', v.pujcil === 2000000, '— ' + v.pujcil);
    ok('splacená se nepočítá ani tady', v.dluzim === 7000000);
    ok('ví se, kdy je další splátka', v.nejblizsi > 0);
  }

  ok('čisté jmění v kartě dluh odečítá',
    /- pj\.dluzim \+ pj\.pujcil/.test(hra), '— cisteJmeni()');
  ok('karta majetku dluh u hráčů ukazuje',
    /hra\.dluzim_hracum/.test(hra) && /hra\.pujcil_jsem_hracum/.test(hra));

  // Karta půjček musí stát i v panelu Já — na burzu pro splátku nikdo nejde.
  const me = hra.slice(hra.indexOf('+ majetekHtml()'), hra.indexOf('+ majetekHtml()') + 400);
  ok('karta půjček stojí i v panelu Já', /financeHtml\(\)/.test(me), '— ' + me.slice(0, 60));
  ok('a tlačítka se v něm napojí', /bindPujcky\('me-body'\)/.test(hra));
  ok('na burze zůstala taky', /bindPujcky\('burza-body'\)/.test(hra));

  // Jméno bindFinance smí být v souboru jen jednou. Když se objeví podruhé,
  // tiše přepíše akontaci v nákupním okně a ta přestane přepočítávat.
  ok('bindFinance se jmenuje jen jedna funkce',
    (hra.match(/function bindFinance\b/g) || []).length === 1,
    '— ' + (hra.match(/function bindFinance\b/g) || []).length + '×');
  ok('a je to ta od akontace', /function bindFinance\(znovu\)/.test(hra));

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
