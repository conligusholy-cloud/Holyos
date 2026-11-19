// Jmění podle skutečného vlastnictví.
//
// Tenhle výpočet má dvě možné chyby a obě jsou v žebříčku vidět jako lež.
// Když se majiteli neodečte podíl, který drží někdo jiný, počítá se tentýž
// majetek dvakrát a hra je bohatší, než je. Když se naopak podíl odečte
// a držiteli se nepřičte, zmizí — a to je přesně ten případ, kvůli kterému
// se to píše: hráč vložil 52,7 M do fondu a jmění mu o 52,7 M spadlo.
//
// Proto se tu nekontrolují jen jednotlivá čísla, ale hlavně SOUČET: co se
// jednomu odečte, musí se druhému přičíst. Součet přes všechny hráče se
// musí rovnat součtu hodnot firem plus pokladen fondů — ani o korunu víc.
const V = require('../services/game/vlastnictvi');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const souctiMapu = (m) => { let s = 0; m.forEach((v) => { s += v; }); return s; };

// ── Bez podílů a fondů je jmění prostě hodnota firmy ────────────────────────
{
  const r = V.spocti(new Map([[1, 1000], [2, -50]]), {});
  ok('bez vlastnictví je jmění hodnota firmy', r.get(1) === 1000 && r.get(2) === -50,
    r.get(1) + ' / ' + r.get(2));
}

// ── Cizí podíl: co se odečte majiteli, přičte se držiteli ───────────────────
{
  const r = V.spocti(new Map([[1, 1000], [2, 0]]), {
    equity: [{ investor_id: 2, fond_id: null, firma_id: 1, podil: 0.3, cena: 50 }],
  });
  ok('majiteli se odečte cizí třetina', r.get(1) === 700, String(r.get(1)));
  ok('a držiteli se přičte', r.get(2) === 300, String(r.get(2)));
  ok('součet se nezměnil', souctiMapu(r) === 1000, String(souctiMapu(r)));
}

// ── Záporná firma: podíl není míň než nic, dluh nese majitel ────────────────
{
  const r = V.spocti(new Map([[1, -800], [2, 0]]), {
    equity: [{ investor_id: 2, fond_id: null, firma_id: 1, podil: 0.5, cena: 10 }],
  });
  ok('podíl v zadlužené firmě je nula', r.get(2) === 0, String(r.get(2)));
  ok('a celý dluh zůstává majiteli', r.get(1) === -800, String(r.get(1)));
}

// ── Neznámá firma se ocení tím, co se za podíl zaplatilo ────────────────────
{
  const r = V.spocti(new Map([[2, 0]]), {
    equity: [{ investor_id: 2, fond_id: null, firma_id: 99, podil: 0.4, cena: 7000 }],
  });
  ok('neznámá firma → zaplacená cena podílu', r.get(2) === 7000, String(r.get(2)));
}

// ── Celá scéna: firmy, podíl hráče, fond s pokladnou i s podílem ────────────
// Firma 1 má 1000, firma 2 má 400, firma 3 nic. Hráč 2 drží 30 % firmy 1.
// Fond 7 má v pokladně 1000 a drží 50 % firmy 2. Ve fondu jsou hráči 1 a 3
// v poměru vkladů 300 : 100.
const SCENA = {
  hodnoty: new Map([[1, 1000], [2, 400], [3, 0]]),
  data: {
    equity: [
      { investor_id: 2, fond_id: null, firma_id: 1, podil: 0.3, cena: 50 },
      { investor_id: null, fond_id: 7, firma_id: 2, podil: 0.5, cena: 10 },
    ],
    fondy: [{ id: 7, pokladna: 1000 }],
    vklady: [
      { aliance_id: 7, clen_id: 1, castka: 300 },
      { aliance_id: 7, clen_id: 3, castka: 100 },
    ],
  },
};
{
  const r = V.spocti(SCENA.hodnoty, SCENA.data);
  const f = V.hodnotyFondu(SCENA.hodnoty, SCENA.data.fondy, SCENA.data.equity);
  ok('fond = pokladna plus to, co drží', f.get(7) === 1200, String(f.get(7)));
  ok('hráč 1: firma bez cizí třetiny plus tři čtvrtiny fondu',
    r.get(1) === 1000 - 300 + 900, String(r.get(1)));
  ok('hráč 2: firma bez poloviny držené fondem plus jeho podíl v jedničce',
    r.get(2) === 400 - 200 + 300, String(r.get(2)));
  ok('hráč 3: jen čtvrtina fondu', r.get(3) === 300, String(r.get(3)));
  // Tohle je ta hlavní kontrola. Hodnoty firem 1400 plus pokladna fondu 1000.
  ok('součet sedí na firmy plus pokladny', souctiMapu(r) === 2400, String(souctiMapu(r)));
}

// ── Vklad do fondu nesmí jmění srazit ───────────────────────────────────────
// Přesně Honzův případ: hráč měl v hotovosti 52 700 000, vložil je do fondu.
// Hodnota firmy o ně klesla, ale v pokladně fondu jsou — jmění musí zůstat.
{
  const pred = V.spocti(new Map([[1, 52700000]]), {});
  const po = V.spocti(new Map([[1, 0]]), {
    fondy: [{ id: 5, pokladna: 52700000 }],
    vklady: [{ aliance_id: 5, clen_id: 1, castka: 52700000 }],
  });
  ok('vklad do fondu jmění nesrazí', pred.get(1) === po.get(1),
    pred.get(1) + ' → ' + po.get(1));
}

// ── Rozbití pojistek ────────────────────────────────────────────────────────
// Každá pojistka se nahradí chybnou variantou a musí být vidět, že ji
// SCÉNA chytí. Bez tohohle by test mohl projít i s rozbitým výpočtem.
function rozbij(nazev, spoctiChybne) {
  let spadlo = false;
  try {
    const r = spoctiChybne(SCENA.hodnoty, SCENA.data);
    spadlo = souctiMapu(r) !== 2400 || r.get(1) !== 1600 || r.get(2) !== 500 || r.get(3) !== 300;
  } catch (e) { spadlo = true; }
  ok('rozbité „' + nazev + '“ test chytí', spadlo);
}

// Majiteli se cizí podíl neodečte — tentýž majetek se počítá dvakrát.
rozbij('majiteli se neodečítá', function (hod, data) {
  const out = new Map(hod);
  (data.equity || []).forEach((e) => {
    const h = V.hodnotaPodilu(hod, e);
    if (e.investor_id != null) out.set(e.investor_id, (out.get(e.investor_id) || 0) + h);
  });
  const f = V.hodnotyFondu(hod, data.fondy, data.equity);
  const celkem = new Map();
  (data.vklady || []).forEach((v) => celkem.set(v.aliance_id, (celkem.get(v.aliance_id) || 0) + v.castka));
  (data.vklady || []).forEach((v) => {
    out.set(v.clen_id, (out.get(v.clen_id) || 0) + f.get(v.aliance_id) * (v.castka / celkem.get(v.aliance_id)));
  });
  return out;
});

// Podíl držený fondem se přičte i fondu, i „investorovi“ — dvojí počítání.
rozbij('fondem držený podíl se počítá dvakrát', function (hod, data) {
  const out = V.spocti(hod, data);
  (data.equity || []).forEach((e) => {
    if (e.fond_id == null) return;
    out.set(e.firma_id, (out.get(e.firma_id) || 0) + V.hodnotaPodilu(hod, e));
  });
  return out;
});

// Fond se ocení jen pokladnou — co drží, se ztratí.
rozbij('fond se cení jen pokladnou', function (hod, data) {
  return V.spocti(hod, Object.assign({}, data, {
    equity: (data.equity || []).filter((e) => e.fond_id == null),
  }));
});

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
