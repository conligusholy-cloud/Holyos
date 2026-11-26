// =============================================================================
// Laundromat Tycoon — řada cen akcie a přecenění
// =============================================================================
// Cenou akcie dosud hýbalo jedině obchodování. Fond mohl koupit podíl hluboko
// pod cenou a akcionářům tím zhodnotit, co drží — a v grafu byla rovná čára,
// jako by se nestalo nic. Přitom právě tohle je to, kvůli čemu se akcie
// fondu drží: co fond vydělá na svých nákupech, patří i jim.
//
// Nově se cena přeceňuje spolu s účetní hodnotou akcie. Posouvá se stejným
// poměrem, takže prémie nebo diskont, který na akcii trh má, zůstane —
// mění se jen to, od čeho se počítá.
//
// Proti čemu se měří: akcie_ucetni na fondu, tedy účetní hodnota akcie
// z chvíle, kdy se cena naposledy nastavila. Po obchodu ji přepisuje obchod
// sám, protože ten cenou pohnul po svém a přecenění by ten pohyb zdvojilo.
'use strict';

const { prisma } = require('../../config/database');
const AKCIE = require('./akcie');
const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

// Bod do řady cen. Píše se jen tehdy, když se cena opravdu změnila — jinak
// by hodinové přeceňování vyrobilo graf z bodů na stejné výšce.
async function zapisCenu(klient, alianceId, cena, duvod, ucetni) {
  const k = klient || prisma;
  return k.gameAkcieCena.create({ data: {
    aliance_id: alianceId, cena: Math.max(0, Math.round(cena)),
    duvod: String(duvod || 'obchod').slice(0, 12),
    ucetni: Math.max(0, Number(ucetni) || 0) } });
}

// Graf OBCHODŮ. Posledních `kolik` cen, u kterých stál skutečný obchod,
// od nejstaršího po nejnovější.
//
// Řada cen nese i přecenění — hodiny, kdy se neobchodovalo a cena se jen
// přepočítala podle hodnoty fondu. V posledních třiceti bodech řady proto
// bývaly dva tři obchody a graf z nich byl rovná čára s jedním skokem na
// kraji. Obchody se tedy vybírají rovnou v databázi: padesát obchodů je
// padesát obchodů, i kdyby se mezi nimi přecenilo stokrát.
async function radaObchodu(alianceId, kolik) {
  const rows = await prisma.gameAkcieCena.findMany({
    where: { aliance_id: alianceId, duvod: 'obchod' }, orderBy: { kdy: 'desc' },
    take: Math.max(1, kolik || 50),
    select: { kdy: true, cena: true, duvod: true } }).catch(() => []);
  return rows.slice().reverse();
}

// Graf ceny. Posledních `kolik` bodů od nejstaršího po nejnovější.
async function radaCen(alianceId, kolik) {
  const rows = await prisma.gameAkcieCena.findMany({
    where: { aliance_id: alianceId }, orderBy: { kdy: 'desc' },
    take: Math.max(1, kolik || 30),
    select: { kdy: true, cena: true, duvod: true } }).catch(() => []);
  return rows.slice().reverse();
}

// Přecenit akcie jednoho fondu podle jeho dnešní hodnoty. Vrací 1, když se
// cena pohnula, jinak 0 — ať je v logu vidět, že to vůbec běží.
async function precenFondu(alianceId, hodnota) {
  const id = parseInt(alianceId, 10);
  if (!Number.isFinite(id)) return 0;
  const al = await prisma.gameAliance.findUnique({ where: { id },
    select: { akcie_celkem: true, akcie_vydano: true, akcie_podil: true,
      akcie_cena: true, akcie_ucetni: true } }).catch(() => null);
  if (!al) return 0;
  // Díl členů na hodnotě fondu — to, co nepatří akcionářům. Z něj se
  // počítá průběžná dividenda členům a ukládá se tady, protože tady už je
  // hodnota fondu spočítaná. Jinak by se kvůli každé výplatě muselo znovu
  // ocenit jmění všech firem, které fond drží.
  const dilClenu = Math.max(0, cislo(hodnota) * (1 - Math.max(0, Math.min(1, al.akcie_podil || 0))));
  await prisma.gameAliance.update({ where: { id },
    data: { clen_zaklad: dilClenu } }).catch(() => null);
  // Fond bez vydaných akcií nemá co přeceňovat: cena nevydaných kusů je
  // vyvolávací cena z hlasování a ta se hýbat nemá, dokud je nikdo nekoupí.
  if (!(al.akcie_celkem > 0) || !(al.akcie_vydano > 0)) return 0;
  // Nezaokrouhleně: proti téhle hodnotě se měří příští přecenění, a pár korun
  // zaokrouhlení by se v každém kroku přičetlo k ceně jako skutečný pohyb.
  const ted = AKCIE.ucetniPresna(hodnota, al.akcie_podil, al.akcie_vydano);
  if (!(ted > 0)) return 0;
  const ref = Math.max(0, Number(al.akcie_ucetni) || 0);
  // První běh: není proti čemu měřit, takže se jen zapamatuje, kde to stojí.
  // Dosadit nulu by znamenalo dělit nulou nebo cenu vystřelit do nesmyslu.
  if (!(ref > 0)) {
    await prisma.gameAliance.update({ where: { id },
      data: { akcie_ucetni: ted } }).catch(() => null);
    return 0;
  }
  const nova = AKCIE.precena(al.akcie_cena, ref, ted);
  // Podmíněný zápis: mezitím mohl projít obchod a cenu i referenci přepsat.
  // Kdyby se přepsal naslepo, přecenění by obchod přetlačilo zpátky.
  const r = await prisma.gameAliance.updateMany({
    where: { id, akcie_cena: al.akcie_cena, akcie_ucetni: al.akcie_ucetni },
    data: { akcie_cena: nova, akcie_ucetni: ted } }).catch(() => ({ count: 0 }));
  if (!r.count || nova === al.akcie_cena) return 0;
  await zapisCenu(null, id, nova, 'precena', ted).catch(() => null);
  console.log('[game] akcie #' + id + ': přecenění ' + al.akcie_cena + ' → ' + nova
    + ' (účetní ' + Math.round(ref) + ' → ' + Math.round(ted) + ')');
  return 1;
}

module.exports = { zapisCenu, radaCen, radaObchodu, precenFondu };
