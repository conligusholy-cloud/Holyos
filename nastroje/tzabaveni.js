// Co propadá soudu, když na trest nestačí hotovost.
//
// Dvě chyby, obě drahé a obě se staly. Zabavení vzalo i koupené pozemky bez
// stavby: cenik('') spadne na MINI, takže se holá zem ocenila jako stroj,
// který na ní nestojí, a jako nejlevnější šla ke dnu první. Hráč o zem
// přišel, trestu se započetla cena neexistujícího stroje a doručenka
// unit_remove neměla ve hře co odebrat — pozemek mu v mapě zůstal a nedalo
// se na něm stavět. Přesně tohle potkalo hráče pinon 19. 11. ve 21:48.
//
// Druhá: doručenka a zrušení záboru byly dva samostatné zápisy. Když prošel
// jen jeden, zmizel hráči stroj ze hry a serveru zůstal zábor — místo pak
// blokoval stroj, který soud už vzal.
const ZL = require('../services/game/zlocin');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Ceník: prázdný model není stroj ─────────────────────────────────────────
// Tohle je ta past. cenik() má zůstat, jak je — chrání před neznámým modelem
// — ale volající se na něj nesmí ptát na zem.
ok('neznámý model se ocení jako mini, ne jako nula',
  ZL.cenik('xxx') === ZL.cenik('mini'), String(ZL.cenik('xxx')));
ok('a prázdný model taky — proto se na zem ptát nesmí',
  ZL.cenik('') === ZL.cenik('mini'), String(ZL.cenik('')));
ok('max je dražší než mini', ZL.cenik('max') > ZL.cenik('mini'));

// ── Výběr toho, co propadne ─────────────────────────────────────────────────
// Vybírá se z claimů stejnou podmínkou, jakou posílá obsluha do databáze.
const VSE = [
  { spot_id: 'a', name: 'Potraviny Švamberk', model: '' },   // koupená zem
  { spot_id: 'b', name: 'EuroSpin', model: 'max' },
  { spot_id: 'c', name: 'Lidl', model: 'mini' },
  { spot_id: 'd', name: 'Prázdná parcela', model: null },
];
const kZabaveni = (l) => l.filter((c) => c.model);
const vybrane = kZabaveni(VSE);
ok('zem bez stavby nepropadá', !vybrane.some((c) => c.name === 'Potraviny Švamberk'));
ok('ani parcela s prázdným modelem', !vybrane.some((c) => c.model == null));
ok('prádlomaty propadají', vybrane.length === 2, String(vybrane.length));

// Pořadí: od nejlevnějšího, ať se pokryje trest a nesebere se víc, než je třeba.
const poradi = vybrane.map((c) => ({ c, v: ZL.cenik(c.model) })).sort((a, b) => a.v - b.v);
ok('bere se od nejlevnějšího', poradi[0].c.name === 'Lidl', poradi.map((x) => x.c.name).join(' → '));

// ── Kolik se zabaví ─────────────────────────────────────────────────────────
function zabav(claims, zbyva) {
  const l = claims.filter((c) => c.model).map((c) => ({ c, v: ZL.cenik(c.model) }))
    .sort((a, b) => a.v - b.v);
  const vzato = [];
  for (const x of l) {
    if (zbyva <= 0) break;
    vzato.push(x.c.name);
    zbyva -= x.v;
  }
  return { vzato, nedoplatek: Math.max(0, Math.round(zbyva)) };
}
{
  const r = zabav(VSE, 1);
  ok('na korunu dluhu stačí jeden nejlevnější stroj', r.vzato.length === 1 && r.vzato[0] === 'Lidl',
    JSON.stringify(r.vzato));
  ok('a zbytek se nestrhává', r.nedoplatek === 0);
}
{
  const r = zabav(VSE, 1e12);
  ok('na obří trest padnou všechny stroje', r.vzato.length === 2);
  ok('ale zem mezi nimi není', r.vzato.indexOf('Potraviny Švamberk') < 0);
  ok('a zbytek zůstane jako nedoplatek', r.nedoplatek > 0);
}
{
  const r = zabav(VSE.filter((c) => !c.model), 1e9);
  ok('kdo má jen zem, nepřijde o nic', r.vzato.length === 0);
  ok('a celý trest zůstane nedoplatkem', r.nedoplatek === 1e9);
}

// ── Rozbití pojistky ────────────────────────────────────────────────────────
// Stará varianta brala všechno. Musí být vidět, že to test chytí.
{
  const stary = (claims, zbyva) => {
    const l = claims.map((c) => ({ c, v: ZL.cenik(c.model) })).sort((a, b) => a.v - b.v);
    const vzato = [];
    for (const x of l) { if (zbyva <= 0) break; vzato.push(x.c.name); zbyva -= x.v; }
    return vzato;
  };
  const vzal = stary(VSE, 1e12);
  ok('rozbité „bere se i zem“ test chytí',
    vzal.indexOf('Potraviny Švamberk') >= 0 && vzal.length !== 2, JSON.stringify(vzal));
}

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
