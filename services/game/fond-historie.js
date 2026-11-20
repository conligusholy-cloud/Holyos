// =============================================================================
// Laundromat Tycoon — jak roste hodnota fondu
// =============================================================================
// Hodnota fondu se nikam nezapisovala, takže se nedala nakreslit. Dopočítat ji
// zpětně nejde ani teoreticky: pokladna se mění vklady, nákupy a výplatami a
// cena podílu se hýbe sama s tím, jak roste firma, kterou fond drží. Jediná
// cesta je vzorkovat — a od té chvíle historie existuje.
//
// Vzorkuje se nejvýš jednou za hodinu. Hustěji by to byl šum (mezi dvěma
// pěti­minutovými tiky se nestane nic), řidčeji by graf skákal.
'use strict';

const { prisma } = require('../../config/database');
const FOND = require('./fond');
const JMENI = require('./jmeni');

const VZOREK_MS = 3600000;      // jak často se bere vzorek
const DRZET_DNU = 120;          // jak dlouho se vzorky nechávají
const BODU_MAX = 300;           // kolik bodů se posílá do hry

// Hodnoty všech fondů k téhle chvíli. Oceňuje se stejně jako v žebříčku —
// jmění firmy krát podíl — aby graf a žebříček nikdy neukazovaly dvě různá
// čísla o témže fondu.
async function hodnoty() {
  const [aliance, clenove, drzene, majetek, hraci] = await Promise.all([
    prisma.gameAliance.findMany({ select: { id: true, nazev: true, pokladna: true } }),
    prisma.gameAlianceClen.groupBy({ by: ['aliance_id'], _count: { _all: true },
      where: { stav: 'clen' } }).catch(() => []),
    prisma.gameEquity.findMany({ where: { fond_id: { not: null }, stav: 'bezi' },
      select: { fond_id: true, firma_id: true, podil: true, cena: true } }),
    JMENI.majetekVsech().catch(() => new Map()),
    prisma.gamePlayer.findMany({ where: { disabled: false },
      select: { id: true, state: true } }),
  ]);
  if (!aliance.length) return [];
  const jmeniFirmy = new Map();
  hraci.forEach((h) => {
    const m = majetek.get(h.id);
    jmeniFirmy.set(h.id, (m ? m.celkem : 0) + JMENI.hotovostADluh(h.state || {}));
  });
  const clenu = new Map();
  clenove.forEach((c) => clenu.set(c.aliance_id, c._count._all));
  return FOND.zebricek(aliance, clenu, drzene, jmeniFirmy, true);
}

// Kolik který držený podíl fondu nese měsíčně, k téhle chvíli. Počítá se
// z posledního uloženého stavu té firmy a z její výplatní politiky — tedy
// ze stejného čísla, podle kterého se podíl o půlnoci herního měsíce
// doopravdy vyplácí. Vrací pole { aliance_id, firma_id, mesicne }.
async function drzby() {
  const acct = require('../../routes/game-account.routes');
  const DIVIDENDA = require('./dividenda');
  const drzene = await prisma.gameEquity.findMany({
    where: { fond_id: { not: null }, stav: 'bezi' },
    select: { fond_id: true, firma_id: true, podil: true } });
  if (!drzene.length) return [];
  const firmy = await prisma.gamePlayer.findMany({
    where: { id: { in: Array.from(new Set(drzene.map((e) => e.firma_id))) } },
    select: { id: true, state: true, dividenda_pct: true } });
  const podle = new Map(firmy.map((f) => [f.id, f]));
  // Podíly se sčítají po firmách: tři nákupy po deseti procentech jsou
  // třicet procent jedné firmy, ne tři různé podíly.
  const soucty = new Map();
  drzene.forEach((e) => {
    const k = e.fond_id + '|' + e.firma_id;
    soucty.set(k, (soucty.get(k) || 0) + (Number(e.podil) || 0));
  });
  const out = [];
  soucty.forEach((podil, k) => {
    const [fondId, firmaId] = k.split('|').map(Number);
    const f = podle.get(firmaId);
    const zbyde = Math.round(acct._zbydeMesicne((f && f.state) || {}) || 0);
    out.push({ aliance_id: fondId, firma_id: firmaId,
      mesicne: DIVIDENDA.castka(zbyde, podil, f ? f.dividenda_pct : null) });
  });
  return out;
}

// Zapíše vzorky výnosů držených podílů. Jede to spolu s hodnotou fondu —
// zvlášť by se obojí rozešlo a šipka u podílu by ukazovala proti jinému
// okamžiku než křivka nad ní.
async function vzorkujDrzby(kdy, jenFond) {
  const l = (await drzby().catch(() => []))
    .filter((x) => jenFond == null || x.aliance_id === jenFond);
  if (!l.length) return 0;
  await prisma.gameFondDrzba.createMany({ data: l.map((x) => ({
    aliance_id: x.aliance_id, firma_id: x.firma_id, mesicne: x.mesicne, kdy })) });
  return l.length;
}

// Poslední zapsaný výnos u každého podílu jednoho fondu. Z toho je šipka:
// proti předchozímu vzorku, ne proti tomu, co kdo kdy viděl.
async function drzbyPred(alianceId) {
  const rows = await prisma.gameFondDrzba.findMany({
    where: { aliance_id: alianceId }, orderBy: { kdy: 'desc' }, take: 200,
    select: { firma_id: true, mesicne: true } }).catch(() => []);
  const out = new Map();
  rows.forEach((r) => { if (!out.has(r.firma_id)) out.set(r.firma_id, r.mesicne); });
  return out;
}

// Zapíše vzorek těm fondům, u kterých je poslední starší než hodina.
// Vrací, kolik řádků přibylo — ať je v logu vidět, že to vůbec běží.
async function vzorkuj(ted) {
  const kdy = ted instanceof Date ? ted : new Date();
  const fondy = await hodnoty();
  if (!fondy.length) return 0;
  const mez = new Date(kdy.getTime() - VZOREK_MS);
  const posledni = new Map();
  const radky = await prisma.gameFondHistorie.findMany({
    where: { aliance_id: { in: fondy.map((f) => f.id) }, kdy: { gt: mez } },
    select: { aliance_id: true } });
  radky.forEach((r) => posledni.set(r.aliance_id, true));
  const nove = fondy.filter((f) => !posledni.has(f.id)).map((f) => ({
    aliance_id: f.id, kdy,
    pokladna: f.pokladna, podily: Math.max(0, f.hodnota - f.pokladna),
    hodnota: f.hodnota, clenu: f.clenu }));
  if (!nove.length) return 0;
  await prisma.gameFondHistorie.createMany({ data: nove });
  await vzorkujDrzby(kdy).catch((e) => console.warn('[game-fond-drzby]', e && e.message));
  return nove.length;
}

// Vzorek hned po události, která fondem pohnula — vklad, výplata, nákup
// podílu, odchod člena. Hodinové vzorkování je na to, aby křivka vůbec
// existovala; na nákup za šedesát milionů se ale nedá čekat hodinu. Člen
// se po takovém obchodu podívá do grafu okamžitě a dosud viděl rovnou čáru,
// jako by se nic nestalo.
//
// Nový bod se zapíše jen tehdy, když se čísla opravdu změnila. Bez toho by
// pět prodejů do jedné nabídky během minuty udělalo pět bodů na stejné výšce
// a graf by zhoustl šumem.
// Má nový bod smysl? Jen když se proti poslednímu něco pohnulo. Pět prodejů
// do jedné nabídky během minuty by jinak udělalo pět bodů na stejné výšce.
// Oceňuje se zaokrouhleně, protože zaokrouhleně se to i ukládá — jinak by
// setina rozdílu, kterou nikdo neuvidí, zakládala bod po bodu.
function stojiZaZapis(posledni, f) {
  if (!posledni || !f) return !!f;
  return Math.round(posledni.pokladna) !== Math.round(f.pokladna)
    || Math.round(posledni.hodnota) !== Math.round(f.hodnota);
}

async function vzorkujFond(alianceId, ted) {
  const id = parseInt(alianceId, 10);
  if (!Number.isFinite(id)) return 0;
  const kdy = ted instanceof Date ? ted : new Date();
  const f = (await hodnoty()).find((x) => x.id === id);
  if (!f) return 0;
  const [posl] = await prisma.gameFondHistorie.findMany({
    where: { aliance_id: id }, orderBy: { kdy: 'desc' }, take: 1,
    select: { pokladna: true, hodnota: true } });
  if (!stojiZaZapis(posl, f)) return 0;
  await prisma.gameFondHistorie.create({ data: {
    aliance_id: id, kdy, pokladna: f.pokladna,
    podily: Math.max(0, f.hodnota - f.pokladna), hodnota: f.hodnota, clenu: f.clenu } });
  await vzorkujDrzby(kdy, id).catch((e) => console.warn('[game-fond-drzby]', e && e.message));
  return 1;
}

// Staré vzorky se nehromadí donekonečna. Čtvrt roku zpátky je víc, než
// kdo v grafu přečte.
async function uklid(ted) {
  const kdy = ted instanceof Date ? ted : new Date();
  const r = await prisma.gameFondHistorie.deleteMany({
    where: { kdy: { lt: new Date(kdy.getTime() - DRZET_DNU * 86400000) } } });
  return (r && r.count) || 0;
}

// Křivka jednoho fondu, od nejstaršího po nejnovější — tak se kreslí.
async function proFond(alianceId, limit) {
  const kolik = Math.max(2, Math.min(BODU_MAX, parseInt(limit, 10) || BODU_MAX));
  const radky = await prisma.gameFondHistorie.findMany({
    where: { aliance_id: alianceId }, orderBy: { kdy: 'desc' }, take: kolik,
    select: { kdy: true, pokladna: true, podily: true, hodnota: true } });
  return radky.reverse().map((r) => ({ kdy: r.kdy,
    pokladna: Math.round(r.pokladna), podily: Math.round(r.podily),
    hodnota: Math.round(r.hodnota) }));
}

module.exports = { hodnoty, vzorkuj, vzorkujFond, stojiZaZapis,
  drzby, vzorkujDrzby, drzbyPred, uklid, proFond, VZOREK_MS, DRZET_DNU, BODU_MAX };
