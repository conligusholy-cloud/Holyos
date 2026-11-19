// Nabídka podílu fondu zvenčí.
//
// Je to jediné místo, kde do fondu vstupuje člověk, který v něm není. Chyby
// se tu platí cizími penězi, tak se zkouší obojí: co projít musí a co projít
// nesmí. Nejdražší je pustit nabídku, na kterou fond nemá — hlasovalo by se
// o ní den a pak by se zjistilo, že ji nejde provést.
//
// Druhá past je protinávrh. Smlouvá se jedno kolo; kdyby šlo kol víc, dá se
// jím nabídka blokovat donekonečna, protože každé kolo je nové hlasování.
// A když se po protinávrhu počítá dál z PŮVODNÍ ceny, zaplatí fond něco
// jiného, než na čem se dohodl.
const N = require('../services/game/fond-nabidka');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// ── Co je na stole ──────────────────────────────────────────────────────────
{
  const puv = { podil: 0.2, cena: 1000000 };
  ok('bez protinávrhu platí původní nabídka',
    N.naStole(puv).cena === 1000000 && N.naStole(puv).podil === 0.2
      && N.naStole(puv).protinavrh === false);
  const sp = { podil: 0.2, cena: 1000000, protinavrh: { podil: 0.15, cena: 600000 } };
  ok('s protinávrhem platí protinávrh',
    N.naStole(sp).cena === 600000 && N.naStole(sp).podil === 0.15
      && N.naStole(sp).protinavrh === true, JSON.stringify(N.naStole(sp)));
  ok('rozbitý protinávrh se ignoruje, platí původní',
    N.naStole({ podil: 0.2, cena: 1000000, protinavrh: { cena: 600000 } }).cena === 1000000);
  ok('prázdný detail nic neshodí', N.naStole(null).cena === 0);
}

// ── Jedno kolo smlouvání ────────────────────────────────────────────────────
ok('na čerstvou nabídku smí fond protinávrh', N.smiProtinavrh({ podil: 0.2, cena: 10 }) === true);
ok('podruhé už ne',
  N.smiProtinavrh({ podil: 0.2, cena: 10, protinavrh: { podil: 0.1, cena: 5 } }) === false);

// ── Kontrola nabídky ────────────────────────────────────────────────────────
// prodano = kolik firmy je prodáno jinam, volne = volné peníze fondu
ok('běžná nabídka projde', N.zkontroluj(0.2, 1000000, 0.1, 5000000).ok === true);
ok('pod procento neprojde', N.zkontroluj(0.005, 1000000, 0, 5000000).duvod === 'podil_maly');
ok('nad sto procent neprojde', N.zkontroluj(1.5, 1000000, 0, 5000000).duvod === 'podil_velky');
ok('pod cenovým dnem neprojde', N.zkontroluj(0.2, 999, 0, 5000000).duvod === 'cena_mala');
ok('co je prodané jinam, se započítá',
  N.zkontroluj(0.3, 1000000, 0.8, 5000000).duvod === 'uz_prodano');
ok('přesně na sto procent ještě projde',
  N.zkontroluj(0.2, 1000000, 0.8, 5000000).ok === true);
ok('na co fond nemá, se nenabízí',
  N.zkontroluj(0.2, 6000000, 0, 5000000).duvod === 'fond_nema');
ok('měří se VOLNÉ peníze, ne celá pokladna',
  N.zkontroluj(0.2, 4000000, 0, 3000000).duvod === 'fond_nema');
ok('přesně na volné peníze projde', N.zkontroluj(0.2, 3000000, 0, 3000000).ok === true);

// ── Většina ─────────────────────────────────────────────────────────────────
ok('fond bez podílu po koupi třetiny většinu nemá',
  N.nasledky(0.33, 0).vetsina === false);
ok('ale s tím, co už drží, ji získá',
  N.nasledky(0.33, 0.3).vetsina === true, String(N.nasledky(0.33, 0.3).podil_po));
ok('přesná polovina ještě není většina', N.nasledky(0.2, 0.3).vetsina === false);
ok('o chlup víc už ano', N.nasledky(0.21, 0.3).vetsina === true);

// ── Rozbití pojistek ────────────────────────────────────────────────────────
function rozbij(nazev, chybna, pripady) {
  const spadlo = pripady.some(function (p) { return chybna.apply(null, p.vstup) !== p.ceka; });
  ok('rozbité „' + nazev + '“ test chytí', spadlo);
}
// Kdyby se po protinávrhu platilo z původní ceny.
rozbij('protinávrh se nebere v potaz',
  function (detail) { return (detail || {}).cena; },
  [{ vstup: [{ podil: 0.2, cena: 1000000, protinavrh: { podil: 0.15, cena: 600000 } }],
     ceka: 600000 }]);
// Kdyby se neměřilo proti volným penězům, ale proti ničemu.
rozbij('peníze fondu se nekontrolují',
  function (podil, cena, prodano, volne) {
    // Nekonečno ne — cislo() ho brání jako nulu, a to by test splnil omylem.
    return N.zkontroluj(podil, cena, prodano, 1e15).ok ? 'ok' : 'chyba';
  },
  [{ vstup: [0.2, 6000000, 0, 5000000], ceka: 'chyba' }]);
// Kdyby šlo smlouvat donekonečna.
rozbij('smlouvá se bez omezení',
  function (detail) { return true; },
  [{ vstup: [{ podil: 0.2, cena: 10, protinavrh: { podil: 0.1, cena: 5 } }], ceka: false }]);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
