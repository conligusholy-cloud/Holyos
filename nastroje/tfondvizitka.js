// =============================================================================
// HolyOS — Laundromat Tycoon: test vizitky cizího fondu
// =============================================================================
// Žebříček fondů ukazoval jen jméno a jedno číslo a nedal se rozkliknout —
// o cizím fondu se nedalo zjistit nic. Vizitka to otevírá, ale jen na to, co
// je veřejné i jinde. Co se ve fondu zrovna rozhoduje a kdo kolik vložil,
// ven nesmí: to je věc členů.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, co) {
  if (podminka) { console.log('  ok   ' + popis + (co != null ? '  — ' + co : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (co != null ? '  — ' + co : ''));
}
function odZavorky(zdroj, od) {
  let h = 0;
  for (let j = zdroj.indexOf('{', od); j < zdroj.length; j++) {
    if (zdroj[j] === '{') h++;
    else if (zdroj[j] === '}') { h--; if (!h) return zdroj.slice(od, j + 1); }
  }
  throw new Error('konec se nenašel');
}

const trade = fs.readFileSync(path.join(KOREN, 'routes/game-trade.routes.js'), 'utf8');
const hra = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');

// ─── Routa: co o cizím fondu pustí ven ──────────────────────────────────────
console.log('\nVizitka cizího fondu');
const i = trade.indexOf("router.get('/trade/fond/:id'");
ma(i > 0, 'routa /trade/fond/:id existuje');
const zac = trade.indexOf('async (req, res) => {', i);
const src = odZavorky(trade, zac);
const ctx = {
  prisma: {
    gameAliance: { findUnique: async () => ({ id: 3, nazev: 'EX ALTO HOLDING', pokladna: 2500000,
      akcie_celkem: 1750, akcie_vydano: 748, akcie_podil: 0.428, akcie_cena: 166041,
      akcie_sazba: 0.15, created_at: new Date('2026-11-01') }) },
    gameAlianceClen: { findMany: async (a) => {
      ctx.clenWhere = a.where;
      return [{ player_id: 7 }, { player_id: 9 }];
    } },
    gameEquity: { findMany: async (a) => {
      ctx.equityWhere = a.where;
      // Cena v datech je schválně: vizitka ji nesmí poslat ven, i když ji
      // v řádku má k dispozici.
      return [
        { firma_id: 11, firma_nick: 'Josef', podil: 0.3, cena: 5000000 },
        { firma_id: 11, firma_nick: 'Josef', podil: 0.3, cena: 4000000 },
        { firma_id: 12, firma_nick: 'Tonda', podil: 0.05, cena: 200000 },
      ];
    } },
    gamePlayer: { findMany: async () => [
      { id: 7, nick: 'Tomas', company: 'Laudry Word' },
      { id: 9, nick: 'Josef', company: 'Mýdlový prádlo' },
      { id: 11, nick: 'Josef', company: 'Mýdlový prádlo' },
      { id: 12, nick: 'Tonda', company: null },
    ] },
  },
  mojeAliance: async () => ({ aliance_id: 3 }),
  hodnotaFondu: async () => 113537122,
  akcieStav: (al, h) => ({ celkem: al.akcie_celkem, vydano: al.akcie_vydano,
    volne: al.akcie_celkem - al.akcie_vydano, podil: al.akcie_podil,
    cena: al.akcie_cena, hodnota: h, ucetni: 71602 }),
  PRAVA: { VETSINA: 0.5 },
  stx: () => (k) => k,
  parseInt, Promise, Array, Set, Map, Math, Object, Number, console,
};
vm.createContext(ctx);
// src už obsahuje celou funkci i s hlavičkou — stačí ji obalit závorkami.
const handler = vm.runInContext('(' + src + ')', ctx);
let odp = null;
const res = { json: (x) => { odp = x; }, status: () => ({ json: (x) => { odp = x; } }) };

(async () => {
  await handler({ params: { id: '3' }, player: { id: 7 } }, res)
    .catch((e) => { console.log('  (routa spadla: ' + e.message + ')'); });
  const f = odp && odp.fond;
  ma(!!f, 'vizitka se vrátí');
  ma(f.nazev === 'EX ALTO HOLDING' && f.hodnota === 113537122, 'jméno a hodnota sedí');
  ma(f.pokladna === 2500000, 'pokladna je veřejná — je i v žebříčku');
  ma((f.clenove || []).length === 2, 'členové se vypíšou', String((f.clenove || []).length));
  ma(f.clenove.some((c) => c.nazev === 'Mýdlový prádlo'), 'členové jménem firmy, ne nickem');
  ma(f.clenove.some((c) => c.ja), 'sám sebe v seznamu poznám');
  // Dva nákupy téže firmy jsou jeden podíl, ne dva.
  ma((f.drzi || []).length === 2, 'podíly se sčítají po firmách', String((f.drzi || []).length));
  const velky = f.drzi.filter((d) => d.firma_id === 11)[0];
  ma(velky && Math.abs(velky.podil - 0.6) < 1e-9, 'sečtený podíl sedí', velky && velky.podil);
  ma(velky && velky.vetsina === true, 'většina se pozná');
  ma(f.drzi[0].podil >= f.drzi[1].podil, 'řadí se od největšího');
  ma(f.drzi.every((d) => d.cena === undefined), 'za kolik fond podíl koupil, ven nejde');
  ma(f.akcie && f.akcie.cena === 166041 && f.akcie.sazba === 0.15, 'akcie fondu jsou na vizitce');
  ma(ctx.equityWhere && ctx.equityWhere.stav === 'bezi', 'počítají se jen běžící podíly');
  ma(ctx.clenWhere && ctx.clenWhere.stav === 'clen', 'pozvaní, kteří nevstoupili, nejsou členové');
  const txt = JSON.stringify(f);
  ma(txt.indexOf('navrh') < 0 && txt.indexOf('hlas') < 0, 'o hlasování ven nejde nic');
  ma(txt.indexOf('vklad') < 0 && txt.indexOf('clen_zaklad') < 0, 'ani kdo kolik vložil');

  // ─── Hra: řádek žebříčku se dá rozkliknout ────────────────────────────────
  console.log('\nŘádek žebříčku fondů');
  ma(/data-fond-info="' \+ f\.id \+ '"/.test(hra), 'řádek nese id fondu');
  ma(/zeb-row klik/.test(hra), 'a tváří se jako prokliknutelný');
  ma((hra.match(/fondInfoNapoj\(/g) || []).length >= 3,
    'napojuje se v panelu fondu i v záložce Žebříček');
  ma(/api\('\/trade\/fond\/' \+ id\)/.test(hra), 'vizitka se ptá serveru');
  const css = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.css'), 'utf8');
  ma(/\.zeb-row\.klik\{cursor:pointer\}/.test(css), 'kurzor říká, že se dá kliknout');

  console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
  process.exit(chyb ? 1 : 0);
})();
