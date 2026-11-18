// Pověst počítaná serverem.
//
// Pověst násobí tržbu celé sítě: nejhorší srazí o pětinu, nejlepší zvedne o
// desetinu. Kdo si ji nastaví na sto, přilepší si o třetinu proti tomu, kdo
// ji má na dně — a dokud se brala z prohlížeče, stačilo k tomu přepsat jedno
// číslo v uložené hře.
//
// Server ji proto počítá sám z toho, CO hráč v hovoru vybral. Váhu si najde
// ve svém katalogu scénářů, takže vymyslet si ji nejde. Tenhle test hlídá
// obojí: že se počítá stejně jako ve hře, a že se nedá nahlásit víc hovorů,
// než kolik se jich za ten čas dalo stihnout.
const P = require('../services/game/povest');
const TEXTY = require('../services/game/texty');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const skoro = (a, b) => Math.abs(a - b) < 1e-9;
const MIN = P.HOVOR_MIN_ODSTUP;

// ── Váha odpovědi ────────────────────────────────────────────────────────────
// Musí sedět s game.js: kladná × 0,5, záporná × 3.
ok('kladná odpověď zvedá pomalu', skoro(P.zaOdpoved(2), 1));
ok('záporná sráží šestkrát rychleji', skoro(P.zaOdpoved(-2), -6));
ok('nula nedělá nic', P.zaOdpoved(0) === 0);

// ── Váha celého hovoru ───────────────────────────────────────────────────────
const scenar = { id: 'test', kroky: [
  { o: [{ b: 2 }, { b: -2 }, { b: 0 }] },
  { o: [{ b: 2 }, { b: -1 }] },
  { o: [{ b: 1 }, { b: -3 }] },
] };
ok('hovor je součtem svých odpovědí',
  skoro(P.vahaHovoru(scenar, [0, 0, 0]), 1 + 1 + 0.5));
ok('jedna hrubost přebije dvě vlídné věty',
  P.vahaHovoru(scenar, [0, 0, 1]) < 0,
  String(P.vahaHovoru(scenar, [0, 0, 1])));
ok('nedohraný hovor pověst nemění', P.vahaHovoru(scenar, [0, 0]) === null);
ok('vymyšlená odpověď neprojde', P.vahaHovoru(scenar, [0, 9, 0]) === null);
ok('neznámý scénář neprojde', P.vahaHovoru(null, [0]) === null);

// ── Skutečné scénáře z katalogu ──────────────────────────────────────────────
// Kdyby se v katalogu objevil scénář bez vah nebo s prázdným krokem, server
// by u něj počítal nulu a nikdo by si toho nevšiml.
const vsechny = TEXTY.scenare('cs');
ok('katalog scénářů se načetl', vsechny.length > 10, vsechny.length + ' scénářů');
let bezVah = 0, prazdne = 0;
vsechny.forEach((s) => {
  (s.kroky || []).forEach((k) => {
    if (!Array.isArray(k.o) || !k.o.length) { prazdne++; return; }
    if (k.o.every((o) => !Number(o.b))) bezVah++;
  });
});
ok('žádný krok není bez odpovědí', prazdne === 0, prazdne + ' prázdných');
ok('každý krok umí pověst pohnout', bezVah === 0, bezVah + ' kroků bez vah');
// A nejhorší možný hovor musí srazit pověst znatelně — jinak je infolinka
// jen klikání bez následku.
const nejhorsi = vsechny.map((s) => (s.kroky || [])
  .reduce((a, k) => a + Math.min.apply(null, (k.o || [{ b: 0 }]).map((o) => P.zaOdpoved(o.b))), 0))
  .sort((a, b) => a - b)[0];
ok('nejhorší hovor v katalogu pověst opravdu srazí', nejhorsi <= -10,
  'nejhorší dělá ' + nejhorsi.toFixed(1) + ' bodu');

// ── Zápis: hovor ─────────────────────────────────────────────────────────────
const ted = Date.parse('2026-11-19T12:00:00Z');
const prazdny = { povest: 0, povest_den: null, povest_off: 0, povest_at: null };
let v = P.zmena(prazdny, { typ: 'hovor', volby: [0, 0, 0] }, scenar, ted);
ok('dobře odbavený hovor pověst zvedne', skoro(v.nova, 2.5), String(v.nova));
v = P.zmena({ povest: 0, povest_at: new Date(ted - 10 * MIN) },
  { typ: 'hovor', volby: [1, 1, 1] }, scenar, ted);
ok('odbytý hovor pověst srazí', v.nova < 0, String(v.nova));

// ── Strop: hovor nemůže přijít dřív, než se mohl stihnout ────────────────────
v = P.zmena({ povest: 0, povest_at: new Date(ted) }, { typ: 'hovor', volby: [0, 0, 0] }, scenar, ted);
ok('hovor ve stejnou vteřinu jako předchozí se nezapočítá',
  v.delta === 0 && !!v.zahozeno, v.zahozeno || 'započítán');
v = P.zmena({ povest: 0, povest_at: new Date(ted - MIN) }, { typ: 'hovor', volby: [0, 0, 0] }, scenar, ted);
ok('hovor po pěti minutách projde', v.delta > 0);

// ── Nevzatý hovor ────────────────────────────────────────────────────────────
v = P.zmena({ povest: 50, povest_at: new Date(ted - MIN) }, { typ: 'odmitnut' }, null, ted);
ok('nevzatý hovor stojí šest bodů', skoro(v.nova, 44), String(v.nova));

// ── Zmeškané za nepřítomnosti ────────────────────────────────────────────────
v = P.zmena({ povest: 0, povest_at: new Date(ted - 100 * MIN) }, { typ: 'zmeskano', kolik: 30 }, null, ted);
ok('za jednu nepřítomnost nejvýš šest bodů', skoro(v.nova, -P.OFF_POVEST_MAX),
  String(v.nova));
v = P.zmena({ povest: -6, povest_den: P.denKlic(ted), povest_off: 6,
  povest_at: new Date(ted - 100 * MIN) }, { typ: 'zmeskano', kolik: 30 }, null, ted);
ok('za den nejvýš dvanáct', skoro(v.nova, -12), String(v.nova));
v = P.zmena({ povest: -12, povest_den: P.denKlic(ted), povest_off: 12,
  povest_at: new Date(ted - 100 * MIN) }, { typ: 'zmeskano', kolik: 30 }, null, ted);
ok('po vyčerpání denního stropu už ztráta nepřibývá', skoro(v.nova, -12), String(v.nova));
v = P.zmena({ povest: -12, povest_den: '2026-11-18', povest_off: 12,
  povest_at: new Date(ted - 100 * MIN) }, { typ: 'zmeskano', kolik: 30 }, null, ted);
ok('nový den strop vynuluje', skoro(v.nova, -18), String(v.nova));
// A hlavně: nedá se nahlásit víc zmeškaných, než kolik se vešlo do času.
v = P.zmena({ povest: 0, povest_at: new Date(ted - 2.5 * MIN) }, { typ: 'zmeskano', kolik: 30 }, null, ted);
ok('zmeškaných se započte jen tolik, kolik se jich vešlo do času',
  skoro(v.nova, -2), String(v.nova) + ' · ' + (v.zahozeno || ''));
v = P.zmena({ povest: 0, povest_at: new Date(ted - 60000) }, { typ: 'zmeskano', kolik: 30 }, null, ted);
ok('za minutu se nestihl žádný', v.nova === 0, String(v.nova));
v = P.zmena(prazdny, { typ: 'zmeskano', kolik: 30 }, null, ted);
ok('prvnímu hlášení se nebrání, není co měřit', skoro(v.nova, -P.OFF_POVEST_MAX),
  String(v.nova));

// ── Meze ─────────────────────────────────────────────────────────────────────
v = P.zmena({ povest: 99, povest_at: new Date(ted - MIN) }, { typ: 'hovor', volby: [0, 0, 0] }, scenar, ted);
ok('nad sto se pověst nedostane', v.nova === 100, String(v.nova));
v = P.zmena({ povest: -99, povest_at: new Date(ted - MIN) }, { typ: 'odmitnut' }, null, ted);
ok('pod minus sto taky ne', v.nova === -100, String(v.nova));
ok('neznámý druh události se odmítne', !!P.zmena(prazdny, { typ: 'cokoli' }, null, ted).chyba);

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
