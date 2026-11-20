// =============================================================================
// Laundromat Tycoon — akcie fondu
// =============================================================================
// Fond může vydat akcie a prodat tím kus sebe komukoli. Akcionář nemusí být
// člen fondu a o chování fondu nehlasuje — rozhodují dál jen členové podle
// vkladů. Co akcionář má: díl na hodnotě fondu a nárok na vyhlášenou dividendu.
//
// CENU SI NEURČUJE KUPUJÍCÍ. Je jedna platná cena a tu hraje poptávka:
//
// 1. Při vydání ji určí fond hlasováním — to je vyvolávací cena.
// 2. Pak už s ní hýbe jen obchodování. Kdo koupí, povytlačí ji nahoru; kdo
//    prodá, srazí ji dolů. Tím víc, čím větší kus naráz: koupě jednoho
//    procenta všech akcií hne cenou o procento. Kdo tedy skoupí velký balík,
//    si ho sám prodraží — stejně jako doopravdy.
//
// Protistranou je VŽDYCKY fond: prodává ze svých nevydaných kusů a vykupuje
// zpátky z pokladny. Proto se dá vždycky koupit i prodat a nikdo nečeká, až
// se najde druhá strana. Dřív tu byl pořadník nabídek, kde si cenu psal
// každý sám — dalo se tím položit nabídku za deset korun a vypadalo to
// divně, protože to divné bylo.
//
// Tenhle modul je jen pravidla a počty. Databáze, peníze a doručenky jsou
// v routes/game-trade.routes.js.
'use strict';

const CENA_MIN = 1;              // akcie za nic by rozdala fond zadarmo
const CENA_MAX = 1000000000;
const POCET_MIN = 1;
const POCET_MAX = 1000000;
const PODIL_MAX = 0.9;           // víc než devět desetin fondu prodat nejde
// Jak silně hýbe obchod cenou. Jednička znamená: koupě jednoho procenta
// všech vydaných akcií zvedne cenu o procento. Míň by byl mrtvý graf, víc
// by stačilo na to, aby cenou cloumal jeden hráč s hrstí kusů.
const CITLIVOST = 1;

const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const kusy = (x) => Math.max(0, Math.floor(cislo(x)));
const penize = (x) => Math.max(0, Math.round(cislo(x)));

// ─── Vydání ──────────────────────────────────────────────────────────────────
// Hlasuje se o ceně a počtu kusů, ne o procentu. Kolik fondu se tím prodá,
// vyjde samo: co se vybralo, děleno hodnotou fondu PO vydání.
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
  const podilPo = (f0 * v + vybrano) / hodnotaPo;
  if (podilPo > PODIL_MAX + 1e-9) return { ok: false, duvod: 'podil_velky' };
  return { ok: true, vybrano, hodnota_po: hodnotaPo, akcie_po: a0 + n,
    podil_po: podilPo, podil_pred: f0,
    redeni: f0 >= 1 ? 0 : (podilPo - f0) / (1 - f0) };
}

// Účetní hodnota jedné akcie: díl akcionářů z hodnoty fondu dělený počtem
// kusů, které drží hráči. Je to dno, o které se cena opírá — ne příkaz.
// Tržní cena se od něj může vzdálit, a právě to je na tom to zajímavé.
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

// ─── Cena a jak s ní hýbe obchod ─────────────────────────────────────────────
// Kam se cena posune, když se zobchoduje `pocet` kusů z celkových `celkem`.
// Nákup nahoru, prodej dolů. Pod CENA_MIN se nikdy nespadne — akcie za nic
// by znamenala, že fond rozdává.
function cenaPo(cena, pocet, celkem, smer) {
  const c = penize(cena);
  const n = kusy(pocet);
  const N = kusy(celkem);
  if (!(c > 0) || !(n > 0) || !(N > 0)) return Math.max(CENA_MIN, c);
  const hyb = CITLIVOST * Math.min(1, n / N);
  const nova = smer === 'prodat' ? c * (1 - hyb) : c * (1 + hyb);
  return Math.max(CENA_MIN, Math.min(CENA_MAX, Math.round(nova)));
}

// Kolik stojí celý balík. Obchoduje se za JEDNU cenu — tu dnešní; posun se
// projeví až na dalším obchodu. Počítat průměr po cestě by znamenalo, že
// hráč zaplatí jinak, než co mu hra ukázala, než klikl.
function castkaZa(cena, pocet) {
  return penize(cena) * kusy(pocet);
}

// ─── Nákup od fondu ──────────────────────────────────────────────────────────
// Fond prodává ze svých dosud nevydaných kusů. volne je, kolik jich má.
function koupit(stav, pocet) {
  const s = stav || {};
  const n = kusy(pocet);
  const volne = kusy(s.volne);
  const cena = penize(s.cena);
  if (n < POCET_MIN) return { ok: false, duvod: 'pocet_maly' };
  if (n > volne) return { ok: false, duvod: 'fond_tolik_nema' };
  if (!(cena > 0)) return { ok: false, duvod: 'cena_mala' };
  const castka = castkaZa(cena, n);
  if (castka > penize(s.hotovost)) return { ok: false, duvod: 'nemas_hotovost' };
  const v = vydani(s.hodnota, s.vydano, s.podil, n, cena);
  if (!v.ok) return v;
  return { ok: true, pocet: n, cena, castka,
    cena_po: cenaPo(cena, n, kusy(s.celkem), 'koupit'),
    vydano_po: v.akcie_po, podil_po: v.podil_po };
}

// ─── Prodej zpátky fondu ─────────────────────────────────────────────────────
// Zrcadlo nákupu: fond platí z pokladny a kusy se mu vrací mezi nevydané.
// Díl akcionářů klesne přesně o to, co fond vyplatil — jinak by se tím, kdo
// vystoupí, ředili nebo bohatli ti, kdo zůstali.
function prodat(stav, pocet) {
  const s = stav || {};
  const n = kusy(pocet);
  const cena = penize(s.cena);
  if (n < POCET_MIN) return { ok: false, duvod: 'pocet_maly' };
  if (n > kusy(s.drzi)) return { ok: false, duvod: 'tolik_nedrzis' };
  if (!(cena > 0)) return { ok: false, duvod: 'cena_mala' };
  const castka = castkaZa(cena, n);
  if (castka > penize(s.fond_volne)) return { ok: false, duvod: 'fond_nema' };
  const hodnota = Math.max(0, penize(s.hodnota));
  const hodnotaPo = Math.max(0, hodnota - castka);
  const drzeno = kusy(s.vydano);
  const f0 = Math.max(0, Math.min(1, cislo(s.podil)));
  // Hodnota akcionářů mínus to, co si odnáší odcházející.
  const akcionariPo = Math.max(0, f0 * hodnota - castka);
  return { ok: true, pocet: n, cena, castka,
    cena_po: cenaPo(cena, n, kusy(s.celkem), 'prodat'),
    vydano_po: Math.max(0, drzeno - n),
    podil_po: hodnotaPo > 0 ? Math.min(PODIL_MAX, akcionariPo / hodnotaPo) : 0 };
}

// Kolik peněz fondu akcie doopravdy přinesly.
//
// Počítá se jen to, kde protistranou byl FOND. Obchod bez prodávajícího jsou
// nově vydané kusy — peníze šly do pokladny. Obchod bez kupujícího je zpětný
// výkup — peníze z pokladny odešly. Obchod dvou hráčů mezi sebou, takové
// řádky zůstaly z dřívějšího pořadníku, fondem nehnul ani o korunu a nesmí
// se počítat na žádnou stranu.
//
// Vrací se hrubé i čisté číslo: hrubé by lhalo fondu, ze kterého akcionáři
// zase vystoupili.
function kapital(obchody) {
  let vybrano = 0, vyplaceno = 0;
  (obchody || []).forEach((o) => {
    if (!o) return;
    const castka = castkaZa(penize(o.cena), kusy(o.pocet));
    if (o.prodavajici_id == null) vybrano += castka;
    else if (!(cislo(o.kupujici_id) > 0)) vyplaceno += castka;
  });
  return { vybrano, vyplaceno, kapital: vybrano - vyplaceno };
}

module.exports = { vydani, ucetni, dilClenu, cenaPo, castkaZa, koupit, prodat, kapital,
  CENA_MIN, CENA_MAX, POCET_MIN, POCET_MAX, PODIL_MAX, CITLIVOST };
