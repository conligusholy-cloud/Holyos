// =============================================================================
// Laundromat Tycoon — veřejná nabídka na odkup podílů
// =============================================================================
// Podíl se dosud dal koupit jen od jednoho hráče a po dohodě. Kdo chtěl
// ovládnout firmu, ve které drží podíl pět lidí, musel pětkrát vyjednávat —
// a kdo prodával poslední, řekl si o cokoli, protože věděl, že útočníkovi
// chybí do většiny zrovna on.
//
// Veřejná nabídka míří na všechny podílníky najednou: jedna cena za procento,
// jedna lhůta, každý se rozhoduje sám za sebe.
//
// Pravidla, na kterých to stojí:
//
//   Prodat musí chtít. Nikdo nepřijde o podíl proto, že někdo nabídl víc.
//   Mlčení je odmítnutí. Kdo se k tomu nedostane, nepřišel o nic.
//   Převede se jen to, co kdo doopravdy prodal. Nenaplněná nabídka doběhne.
//
// Co tahle hra vědomě nedělá: nedrží útočníkovi peníze stranou. Hotovost
// žije ve stavu hry, ne na serverovém účtu, takže se dá kontrolovat jen ve
// chvíli, kdy někdo prodává. Útočník, kterému peníze dojdou v půlce, tedy
// nabídku nedodrží — a hra to řekne nahlas tomu, kdo zrovna prodává, místo
// aby mu tiše ubrala podíl. Až bude hotovost na serveru, zamkne se rovnou.

'use strict';

const { prisma } = require('../../config/database');

const HODIN_MIN = 6, HODIN_MAX = 72, HODIN_VYCHOZI = 48;
// Výstupní nabídka: kdo drží tři čtvrtiny firmy, může nechat viset trvalý
// odkup zbytku. Nevykupuje tím nikoho násilím — menšina prodat může, ale
// nemusí. Cena přitom nesmí být pod oceněním firmy, jinak by to byl jen
// slušněji pojmenovaný nátlak na někoho, kdo už stejně nemá vliv.
const PRAH_VYSTUPNI = 0.75;
const PCT_MIN = 0.01, PCT_MAX = 1;
const CENA_MIN = 1000;              // za jedno procento

function stav(t, ted) {
  if (!t) return null;
  if (t.stav !== 'bezi') return t.stav;
  // Trvalá výstupní nabídka konec nemá. Je to její smysl: kdo byl pryč,
  // najde ji po návratu pořád viset.
  if (t.do && new Date(t.do).getTime() <= (ted || Date.now())) return 'dobehla';
  if (t.koupeno_pct >= t.max_pct - 1e-9) return 'naplnena';
  return 'bezi';
}

// Kolik ještě jde prodat do téhle nabídky.
function zbyva(t) {
  return Math.max(0, (Number(t.max_pct) || 0) - (Number(t.koupeno_pct) || 0));
}

// Co nabídka stojí celá a co stojí kus. Cena je za procento, takže se
// počítá z procent, ne z desetinného podílu — jinak se o dva řády minem.
function cenaZa(t, podil) {
  return Math.round((Number(podil) || 0) * 100 * (Number(t.cena_za_pct) || 0));
}

function verejna(t, jaId, ted) {
  const s = stav(t, ted);
  return {
    id: t.id,
    utocnik: t.utocnik_nick, utocnik_id: t.utocnik_id,
    firma: t.firma_nick, firma_id: t.firma_id,
    cena_za_pct: t.cena_za_pct,
    max_pct: t.max_pct, koupeno_pct: t.koupeno_pct, zbyva_pct: zbyva(t),
    do: t.do || null, trvala: !!t.trvala, stav: s,
    moje: t.utocnik_id === jaId,
    na_moji_firmu: t.firma_id === jaId,
  };
}

// Nejnižší cena za procento, za kterou smí výstupní nabídka jít ven:
// setina jmění firmy. Pod tím už to není nabídka na odchod, ale pokuta
// za to, že někdo zůstal v menšině.
function minCenaZaPct(jmeni) {
  return Math.max(CENA_MIN, Math.round((Number(jmeni) || 0) / 100));
}

// Smí tenhle držitel vyhlásit výstupní nabídku? Podíly se sčítají na
// držitele, ne na řádku — a držitelem může být i fond aliance, takže se
// porovnává klíč, ne investor_id. Snese se obojí: id hráče i hotový klíč.
function smiVystupni(podily, kdo) {
  const DRZ = require('./drzitel');
  if (kdo == null) return false;
  const k = (typeof kdo === 'string' && /^[hf]:/.test(kdo)) ? kdo : 'h:' + kdo;
  const moje = (podily || []).filter((e) => (e.drzitel || DRZ.klic(e)) === k)
    .reduce((a, e) => a + (Number(e.podil) || 0), 0);
  return moje >= PRAH_VYSTUPNI - 1e-9;
}

// Nabídky, které se týkají hráče: jeho vlastní, ty na jeho firmu, a ty na
// firmy, ve kterých drží podíl. Do cizích sporů mu nic není.
// Kolik firmy drží ještě její majitel. Prodané podíly i podíl zastavený
// u věřitele se počítají stejně — oboje je pryč, oboje se nesmí prodat
// podruhé. Stejné pravidlo jako u nabídky podílu fondu.
async function zbyvaMajiteli(firmaId) {
  const [eq, zastavy] = await Promise.all([
    prisma.gameEquity.findMany({
      where: { firma_id: firmaId, stav: 'bezi' }, select: { podil: true } }),
    prisma.gameLoan.findMany({
      where: { borrower_id: firmaId, stav: 'bezi', zastava_podil: { not: null } },
      select: { zastava_podil: true } }),
  ]);
  return zbyvaZ(eq.map((x) => x.podil), zastavy.map((x) => x.zastava_podil));
}
// Samotný počet, oddělený od databáze, aby se dal otestovat. Přeprodaná firma
// je chyba dat, ne nabídka k prodeji: zápor se ořízne na nulu, jinak by se
// z něj po vynásobení cenou stala záporná částka k výplatě.
function zbyvaZ(prodane, zastavene) {
  const souc = (p) => (Array.isArray(p) ? p : []).reduce((a, x) => a + (Number(x) || 0), 0);
  return Math.max(0, Math.min(1, 1 - souc(prodane) - souc(zastavene)));
}

async function proHrace(jaId) {
  const ted = Date.now();
  const moje = await prisma.gameEquity.findMany({
    where: { investor_id: jaId, stav: 'bezi' }, select: { firma_id: true, podil: true },
  });
  const firmy = Array.from(new Set(moje.map((e) => e.firma_id)));
  const rows = await prisma.gameTender.findMany({
    where: {
      stav: 'bezi',
      OR: [{ utocnik_id: jaId }, { firma_id: jaId }, { firma_id: { in: firmy.length ? firmy : [-1] } }],
    },
    orderBy: { do: 'asc' }, take: 50,
  });
  const drzim = new Map();
  moje.forEach((e) => drzim.set(e.firma_id, (drzim.get(e.firma_id) || 0) + (e.podil || 0)));
  // Majitel firmy nemá v evidenci podílů žádný řádek: jeho podíl je ten
  // zbytek, který nikomu neprodal. Bez tohohle čísla mu u nabídky na vlastní
  // firmu nesvítilo tlačítko a server mu tvrdil, že v ní nic nedrží —
  // přitom je to právě on, kdo ten podíl má, a nabídka míří hlavně na něj.
  // Zastavený podíl se počítá jako prodaný: je vázaný u věřitele.
  const vlastni = rows.some((t) => t.firma_id === jaId)
    ? await zbyvaMajiteli(jaId) : 0;
  return rows.map((t) => Object.assign(verejna(t, jaId, ted), {
    muj_podil: t.firma_id === jaId ? vlastni : (drzim.get(t.firma_id) || 0),
  })).filter((t) => t.stav === 'bezi');
}

module.exports = { stav, zbyva, cenaZa, verejna, proHrace, zbyvaMajiteli, zbyvaZ, minCenaZaPct, smiVystupni,
  HODIN_MIN, HODIN_MAX, HODIN_VYCHOZI, PCT_MIN, PCT_MAX, CENA_MIN, PRAH_VYSTUPNI };
