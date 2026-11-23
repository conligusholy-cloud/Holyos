// Odkup podílu zpátky od fondu.
//
// Do fondu šel podíl jednosměrně: majitel ho fondu nabídl a tím to skončilo.
// Tlačítko „Odkoupit zpět" u podílu posílá nabídku ČLOVĚKU, který ho drží —
// a fond žádného člověka nemá, ten o všem hlasuje. Cesta zpátky proto
// neexistovala vůbec.
//
// Nově je to zrcadlo nabídky: majitel řekne kolik procent a za kolik, fond
// hlasuje a může jednou odhlasovat jiné podmínky. Hlídá se tu to, co by
// jinak bralo cizí peníze: že fond neprodá víc, než drží, že majitel
// zaplatí jen to, na čem se strany dohodly, a že na to má.
const F = require('../services/game/fond-nabidka');
const FOND = require('../services/game/fond');
const fs = require('fs');
const path = require('path');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(koren, p), 'utf8');

// ─── Co se smí ───────────────────────────────────────────────────────────────
ok('odkup do výše, co fond drží, projde',
  F.zkontrolujZpet(0.1, 1000000, 0.3, 2000000).ok);
ok('celý podíl taky', F.zkontrolujZpet(0.3, 1000000, 0.3, 2000000).ok);
ok('víc, než fond drží, ne',
  F.zkontrolujZpet(0.5, 1000000, 0.3, 2000000).duvod === 'fond_tolik_nedrzi');
ok('ve firmě, kde fond nic nemá, ne',
  F.zkontrolujZpet(0.1, 1000000, 0, 2000000).duvod === 'fond_nedrzi');
// Bez tohohle se den hlasuje o ceně, kterou kupující nemá, a provedení pak
// spadne — fond mezitím odmítl jiné věci.
ok('na co majitel nemá, se nehlasuje',
  F.zkontrolujZpet(0.1, 3000000, 0.3, 2000000).duvod === 'majitel_nema');
ok('pod dnem ceny ne',
  F.zkontrolujZpet(0.1, 10, 0.3, 2000000).duvod === 'cena_mala');
ok('míň než procento ne',
  F.zkontrolujZpet(0.005, 1000000, 0.3, 2000000).duvod === 'podil_maly');
ok('nesmysl na vstupu nic nepustí', !F.zkontrolujZpet(null, null, null, null).ok);

// ─── Co fondu zbyde ──────────────────────────────────────────────────────────
let n = F.nasledkyZpet(0.1, 0.3);
ok('fondu zbyde zbytek', n.podil_po === 0.2, '— ' + n.podil_po);
ok('a většinu už nemá', !n.vetsina);
n = F.nasledkyZpet(0.05, 0.6);
ok('když mu většina zůstane, ví se to', n.vetsina && n.podil_po === 0.55, '— ' + n.podil_po);
n = F.nasledkyZpet(0.3, 0.3);
ok('po celém odkupu fondu nezbyde nic', n.podil_po === 0 && !n.vetsina);
n = F.nasledkyZpet(5, 0.3);
ok('a záporný zbytek nevznikne', n.podil_po === 0, '— ' + n.podil_po);

// ─── Smlouvání ───────────────────────────────────────────────────────────────
// Protinávrh je společný s nabídkou: platí to, co leží na stole, ne to,
// co se nabízelo poprvé. Bez toho by se provedlo původní číslo.
const d = { podil: 0.1, cena: 1000000, protinavrh: { podil: 0.1, cena: 1800000 } };
ok('platí, co leží na stole', F.naStole(d).cena === 1800000, '— ' + F.naStole(d).cena);
ok('a smlouvá se jen jedno kolo', !F.smiProtinavrh(d));
ok('dokud protinávrh není, fond ho podat smí',
  F.smiProtinavrh({ podil: 0.1, cena: 1000000 }));

// ─── Váha hlasování ──────────────────────────────────────────────────────────
// Kupující ve fondu není a hlasovat v něm nesmí, takže si nic nepřihraje —
// proto běžný práh jako u nákupu, ne zásadní jako u výplaty.
ok('zpětný odkup má práh jako nákup',
  FOND.prahDruhu('odkup_zpet') === FOND.prahDruhu('koupit'),
  '— ' + FOND.prahDruhu('odkup_zpet'));

// ─── Server ──────────────────────────────────────────────────────────────────
const R = cti('routes/game-trade.routes.js');
ok('návrh jde založit zvenčí', /router\.post\('\/trade\/fond\/odkup-zpet'/.test(R));
ok('provedení platí, co leží na stole', /n\.druh === 'odkup_zpet'[\s\S]{0,600}FONDNAB\.naStole\(d\)/.test(R));
ok('a znovu se ověří, co fond drží a na co majitel má',
  /n\.druh === 'odkup_zpet'[\s\S]{0,1200}zkontrolujZpet\(na\.podil, na\.cena, drzi, hotovost\)/.test(R));
ok('peníze jdou do pokladny fondu',
  /n\.druh === 'odkup_zpet'[\s\S]{0,2600}pokladna: \{ increment: na\.cena \}/.test(R));
ok('a majiteli odejdou doručenkou',
  /dor\.fond_odkup_zpet_zaplaceno/.test(R) && /amount: -na\.cena/.test(R));
ok('změna vlastnictví se zapíše do auditu',
  /n\.druh === 'odkup_zpet'[\s\S]{0,4000}AUDIT\.zapis\(tx, firmaId, auditPred/.test(R));
ok('souběh podíl nepustí dvakrát',
  /n\.druh === 'odkup_zpet'[\s\S]{0,2000}SOUBEH\.Soubeh\('server\.takovy_podil_uz_nebezi'\)/.test(R));
ok('fond smí smlouvat i u odkupu', /n\.druh !== 'nabidka' && n\.druh !== 'odkup_zpet'/.test(R));
ok('a majitel smí odpovědět i stáhnout',
  (R.match(/n\.druh !== 'nabidka' && n\.druh !== 'odkup_zpet'/g) || []).length >= 3);

// ─── Hra ─────────────────────────────────────────────────────────────────────
const hra = cti('public/compounder/game/game.js');
ok('okno odkupu v game.js je', /function odkupZpetSheet\(\)/.test(hra));
ok('tlačítko svítí jen tomu, komu fond drží',
  /\(DRZI_VE_MNE \|\| \[\]\)\.length/.test(hra));
ok('procenta nejdou přetáhnout přes to, co fond drží',
  /Math\.min\(max, Math\.round\(Number\(\$\('oz-pct'\)\.value\)/.test(hra));
ok('a bez hotovosti se návrh neodešle',
  /cena > volnaHotovost\(null\)[\s\S]{0,200}oz-ok/.test(hra));
ok('server posílá, které fondy ve mně drží', /drzi_ve_mne/.test(R) && /DRZI_VE_MNE =/.test(hra));

const KAT = JSON.parse(cti('services/game/texty/cs.json'));
['fond.odkup_zpet', 'fond.odkup_zpet_popis', 'fond.odkup_zpet_okno', 'fond.odkup_zpet_drzi',
  'fond.odkup_zpet_zbyde', 'fond.odkup_zpet_odeslat', 'fond.odkup_zpet_odeslan',
  'fond.zadny_fond_ve_mne', 'dor.fond_odkup_zpet_navrh', 'dor.fond_odkup_zpet_hotovo',
  'dor.fond_odkup_zpet_zaplaceno', 'server.fond_ve_tve_firme_nic_nedrzi',
  'server.fond_drzi_jen_pct', 'server.na_odkup_nemas'].forEach((k) => {
  ok('katalog má ' + k, !!KAT[k]);
});

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
