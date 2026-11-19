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
  return nove.length;
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

module.exports = { hodnoty, vzorkuj, uklid, proFond, VZOREK_MS, DRZET_DNU, BODU_MAX };
