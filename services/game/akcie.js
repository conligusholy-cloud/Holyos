// =============================================================================
// Laundromat Tycoon — akcie fondu
// =============================================================================
// Fond může vydat akcie a prodat tím kus sebe komukoli, kdo o to stojí.
// Akcionář nemusí být člen fondu a o chování fondu nehlasuje — rozhodují dál
// jen členové podle vkladů. Co akcionář má: díl na hodnotě fondu a nárok na
// dividendu, kterou fond vyhlásí.
//
// Dvě věci, na kterých to celé stojí:
//
// 1. KOLIK FONDU SE PRODÁ. Nehlasuje se o procentu, ale o ceně a počtu kusů —
//    tak to chodí i doopravdy. Kolik procent se tím prodalo, vyjde samo:
//    co se vybralo, děleno hodnotou fondu PO vydání. Když fond v hodnotě
//    sto milionů vydá akcie za dvacet, akcionáři drží 20/120, tedy šestinu,
//    a členům zbyde pět šestin. Levná cena tedy členy ředí — proto se o ní
//    hlasuje.
//
// 2. JAK VZNIKÁ CENA. Pořadník nabídek: kdo chce koupit, řekne počet a
//    nejvyšší cenu; kdo prodat, počet a nejnižší. Co se potká, to se
//    zobchoduje za cenu té nabídky, která ležela dřív — kdo přišel pozdě,
//    bere cenu toho, kdo čekal. Stejné pravidlo jako na skutečné burze a
//    jediné, u kterého nejde vydělat tím, že se někdo trefí o vteřinu dřív.
//
// Tenhle modul je jen pravidla a počty. Databáze, peníze a doručenky jsou
// v routes/game-trade.routes.js.
'use strict';

const CENA_MIN = 1;              // akcie za nic by rozdala fond zadarmo
const CENA_MAX = 1000000000;
const POCET_MIN = 1;
const POCET_MAX = 1000000;       // strop na jednu nabídku, ať nejde zahltit knihu
const PODIL_MAX = 0.9;           // víc než devět desetin fondu prodat nejde

const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const kusy = (x) => Math.max(0, Math.floor(cislo(x)));
const penize = (x) => Math.max(0, Math.round(cislo(x)));

// ─── Vydání akcií ────────────────────────────────────────────────────────────
// hodnotaPred je dnešní hodnota fondu (pokladna plus to, co drží), akciePred
// a podilPred je, co už akcionáři drží z dřívějška. Vrací, co se vybere a jak
// se tím posune díl akcionářů — a tedy i to, co zbyde členům.
function vydani(hodnotaPred, akciePred, podilPred, pocet, cena) {
  const v = Math.max(0, penize(hodnotaPred));
  const a0 = kusy(akciePred);
  const f0 = Math.max(0, Math.min(PODIL_MAX, cislo(podilPred)));
  const n = kusy(pocet);
  const c = penize(cena);
  if (n < POCET_MIN) return { ok: false, duvod: 'pocet_maly' };
  if (n > POCET_MAX) return { ok: false, duvod: 'pocet_velky' };
  if (c < CENA_MIN) return { ok: false, duvod: 'cena_mala' };
  if (c > CENA_MAX) return { ok: false, duvod: 'cena_velka' };
  const vybrano = n * c;
  const hodnotaPo = v + vybrano;
  if (!(hodnotaPo > 0)) return { ok: false, duvod: 'fond_nema_hodnotu' };
  // Hodnota akcionářů: co drželi, plus co právě složili.
  const podilPo = (f0 * v + vybrano) / hodnotaPo;
  if (podilPo > PODIL_MAX + 1e-9) return { ok: false, duvod: 'podil_velky' };
  return { ok: true, vybrano, hodnota_po: hodnotaPo, akcie_po: a0 + n,
    podil_po: podilPo, podil_pred: f0,
    // O kolik klesne díl každého člena. Ředí se všem stejným poměrem.
    redeni: f0 >= 1 ? 0 : (podilPo - f0) / (1 - f0) };
}

// Účetní hodnota jedné akcie: díl akcionářů z hodnoty fondu, dělený počtem
// kusů. Je to to dno, o které se cena na trhu opírá — ne strop ani příkaz.
function ucetni(hodnotaFondu, podilAkcionaru, akcii) {
  const a = kusy(akcii);
  if (!(a > 0)) return 0;
  const f = Math.max(0, Math.min(1, cislo(podilAkcionaru)));
  return Math.max(0, Math.round((Math.max(0, cislo(hodnotaFondu)) * f) / a));
}

// Co z fondu zbývá členům. Mezi sebou si to dělí dál podle vkladů.
function dilClenu(podilAkcionaru) {
  return Math.max(0, 1 - Math.max(0, Math.min(1, cislo(podilAkcionaru))));
}

// ─── Pořadník nabídek ────────────────────────────────────────────────────────
// Kniha je setříděná: u prodejů nejlevnější napřed, u nákupů nejdražší napřed,
// při shodě ceny ten, kdo přišel dřív. Tohle pořadí je celé pravidlo trhu.
function serad(nabidky, smer) {
  const l = (nabidky || []).filter((x) => x && kusy(x.zbyva) > 0);
  const znamenko = smer === 'prodat' ? 1 : -1;     // prodeje vzestupně, nákupy sestupně
  return l.slice().sort((a, b) => znamenko * (penize(a.cena) - penize(b.cena))
    || (cislo(a.poradi) - cislo(b.poradi)));
}

// Spáruje novou nabídku s protistranou. Vrací obchody a kolik z nové nabídky
// zbylo nespárováno — to zůstane ležet v knize.
//
// Cena obchodu je VŽDY cena nabídky, která ležela dřív. Kdo přijde později,
// bere cenu toho, kdo čekal: příchozí nákup za 120 na ležící prodej za 100
// se zobchoduje za 100 a kupující ušetří. Opačné pravidlo by odměňovalo
// toho, kdo stihl kliknout o vteřinu dřív.
function sparuj(nova, protistrana) {
  const chci = nova && nova.smer === 'koupit' ? 'prodat' : 'koupit';
  const kniha = serad(protistrana, chci);
  let zbyva = kusy(nova && nova.pocet);
  const cenaLimit = penize(nova && nova.cena);
  const obchody = [];
  for (const p of kniha) {
    if (zbyva <= 0) break;
    const cenaP = penize(p.cena);
    // Limit: kupující nepřeplatí, prodávající nepodstřelí.
    if (nova.smer === 'koupit' ? cenaP > cenaLimit : cenaP < cenaLimit) break;
    const kolik = Math.min(zbyva, kusy(p.zbyva));
    if (kolik <= 0) continue;
    obchody.push({ proti_id: p.id, proti_player_id: p.player_id,
      pocet: kolik, cena: cenaP, castka: kolik * cenaP });
    zbyva -= kolik;
  }
  return { obchody, zbyva,
    kusu: obchody.reduce((a, o) => a + o.pocet, 0),
    castka: obchody.reduce((a, o) => a + o.castka, 0) };
}

// Co si nabídka zamkne, dokud leží v knize. U nákupu peníze (jinak by jedněmi
// penězi podložil deset nabídek), u prodeje kusy akcií.
function zamceno(nabidky, smer) {
  return (nabidky || []).filter((x) => x && x.smer === smer && kusy(x.zbyva) > 0)
    .reduce((a, x) => a + (smer === 'koupit' ? kusy(x.zbyva) * penize(x.cena) : kusy(x.zbyva)), 0);
}

// Je nabídka sama o sobě v pořádku? drzi je, kolik kusů prodávající má;
// hotovost to, co kupující může dát (po odečtení toho, co má zamčené jinde).
function zkontroluj(smer, pocet, cena, drzi, hotovost) {
  const n = kusy(pocet), c = penize(cena);
  if (smer !== 'koupit' && smer !== 'prodat') return { ok: false, duvod: 'smer' };
  if (n < POCET_MIN) return { ok: false, duvod: 'pocet_maly' };
  if (n > POCET_MAX) return { ok: false, duvod: 'pocet_velky' };
  if (c < CENA_MIN) return { ok: false, duvod: 'cena_mala' };
  if (c > CENA_MAX) return { ok: false, duvod: 'cena_velka' };
  if (smer === 'prodat' && n > kusy(drzi)) return { ok: false, duvod: 'tolik_nedrzis' };
  if (smer === 'koupit' && n * c > penize(hotovost)) return { ok: false, duvod: 'nemas_hotovost' };
  return { ok: true, pocet: n, cena: c, castka: n * c };
}

module.exports = { vydani, ucetni, dilClenu, serad, sparuj, zamceno, zkontroluj,
  CENA_MIN, CENA_MAX, POCET_MIN, POCET_MAX, PODIL_MAX };
