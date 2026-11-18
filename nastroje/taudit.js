// Auditní zápis vlastnických změn.
//
// Je to jediná paměť na to, kdo kdy přišel o kus firmy. Když se tu něco
// splete, nepozná se to hned — pozná se to až ve chvíli, kdy se hráč ptá,
// kam se poděla pětina jeho firmy, a odpověď buď chybí, nebo lže.
const A = require('../services/game/audit');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const mapa = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

// ── Rozdíl dvou otisků ───────────────────────────────────────────────────────
let z = A.zmeny(mapa({ 7: 0.4 }), mapa({ 7: 0.3 }));
ok('ubraný podíl se zapíše', z.length === 1 && z[0].pred === 0.4 && z[0].po === 0.3);

z = A.zmeny(mapa({ 7: 0.4 }), mapa({ 7: 0.4 }));
ok('beze změny se nezapisuje nic', z.length === 0);

// Nový investor a odkoupený podíl jsou obojí změna vlastnictví.
z = A.zmeny(mapa({}), mapa({ 8: 0.25 }));
ok('nový podílník se zapíše z nuly', z.length === 1 && z[0].pred === 0 && z[0].po === 0.25);
z = A.zmeny(mapa({ 8: 0.25 }), mapa({}));
ok('odkoupený podíl se zapíše na nulu', z.length === 1 && z[0].pred === 0.25 && z[0].po === 0);

// ── Ředění: tohle je ten případ, kvůli kterému se dělá otisk ─────────────────
// Kapitálový vstup sáhne na všechny dosavadní investory najednou.
z = A.zmeny(mapa({ 7: 0.4, 8: 0.2 }), mapa({ 7: 0.3, 8: 0.15, 9: 0.25 }));
ok('ředění zapíše všechny tři, ne jen nového',
  z.length === 3, '— ' + z.map((x) => x.investor_id).join(','));
ok('a u každého je vidět, z čeho na co',
  z[0].pred === 0.4 && z[0].po === 0.3 && z[2].pred === 0 && z[2].po === 0.25);

// ── Drobnosti plovoucí čárky nejsou změna vlastnictví ───────────────────────
z = A.zmeny(mapa({ 7: 0.1 + 0.2 }), mapa({ 7: 0.3 }));
ok('0,1 + 0,2 proti 0,3 se nebere jako změna', z.length === 0,
  '— rozdíl ' + Math.abs(0.1 + 0.2 - 0.3));
z = A.zmeny(mapa({ 7: 0.3 }), mapa({ 7: 0.3 + 1e-6 }));
ok('ale miliontina už změna je', z.length === 1);

// ── Pořadí a úplnost ─────────────────────────────────────────────────────────
z = A.zmeny(mapa({ 9: 0.1, 7: 0.1 }), mapa({ 9: 0.2, 7: 0.2 }));
ok('zapisuje se v pořadí podle investora, ať je výpis čitelný',
  z[0].investor_id === 7 && z[1].investor_id === 9);
ok('prázdné otisky nic neshodí', A.zmeny(new Map(), new Map()).length === 0);

// ── Celý zápis proti podstrčené databázi ─────────────────────────────────────
let zapsano = null;
const tx = {
  gameEquity: { findMany: async () => [
    { investor_id: 7, podil: 0.2 }, { investor_id: 7, podil: 0.1 }, { investor_id: 8, podil: 0.25 }] },
  gameVlastnictvi: { createMany: async (x) => { zapsano = x.data; return { count: x.data.length }; } },
};
(async () => {
  // Dvě řádky téhož investora se musí sečíst, jinak by to vypadalo,
  // že o svůj podíl přišel a hned ho dostal zpátky.
  const pred = await A.otisk(tx, 1);
  ok('víc řádek jednoho investora se sečte', Math.abs(pred.get(7) - 0.3) < 1e-9,
    '— ' + pred.get(7));

  const kolik = await A.zapis(tx, 1, mapa({ 7: 0.3, 8: 0.4 }), { duvod: 'prevzeti', trade_id: 5 });
  ok('zapíše se jen ten, komu se podíl změnil', kolik === 1 && zapsano.length === 1,
    '— ' + JSON.stringify(zapsano));
  ok('a nese důvod i obchod', zapsano[0].duvod === 'prevzeti' && zapsano[0].trade_id === 5);
  ok('z 0,4 na 0,25', Math.abs(zapsano[0].podil_pred - 0.4) < 1e-9
    && Math.abs(zapsano[0].podil_po - 0.25) < 1e-9);

  zapsano = null;
  const nic = await A.zapis(tx, 1, mapa({ 7: 0.3, 8: 0.25 }), { duvod: 'prodej' });
  ok('beze změny se do databáze nesahá', nic === 0 && zapsano === null);

  // Důvod je sloupec o 16 znacích; delší text nesmí shodit zápis.
  zapsano = null;
  await A.zapis(tx, 1, mapa({ 7: 0.9 }), { duvod: 'tohle_je_moc_dlouhy_duvod' });
  ok('příliš dlouhý důvod se ořeže, nezapíše se chyba',
    zapsano && zapsano[0].duvod.length <= 16, '— ' + (zapsano && zapsano[0].duvod));
  zapsano = null;
  await A.zapis(tx, 1, mapa({ 7: 0.9 }), null);
  ok('chybějící důvod nic neshodí', zapsano && zapsano[0].duvod === '?');

  console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
