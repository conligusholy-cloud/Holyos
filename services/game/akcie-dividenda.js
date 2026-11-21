// =============================================================================
// Laundromat Tycoon — dividenda z akcií, která nabíhá
// =============================================================================
// Fond si odhlasuje sazbu: kolik procent účetní hodnoty akcie vyplatí za herní
// rok. Od té chvíle to akcionáři nabíhá plynule — vidí, jak mu přibývá, hned
// po koupi, a nemusí čekat, až se členové na něčem shodnou.
//
// Peníze se ale nepřipisují každou sekundu; to by byl provoz pro nic. Nabíhá
// čas a při prvním pohledu do hry se doúčtuje všechno, co od minule přibylo —
// stejně jako nájmy z pozemků a provize ze sítě.
//
// Tři pravidla, která z toho dělají slib, a ne díru do pokladny:
//
//  1. Platí se jen z VOLNÝCH peněz fondu. Co je slíbené ve vyvěšené nabídce,
//     se nerozdá podruhé.
//  2. Když fond nemá, dividenda NENABÍHÁ. Čas běží dál a ten úsek propadá —
//     žádný skrytý dluh, který členové neodhlasovali.
//  3. Nabíhá se od poslední výplaty, ne od koupě akcie. Bez toho by se při
//     zapnutí sazby vyplatilo zpětně všechno od chvíle, kdy akcie vznikly.
'use strict';

const { prisma } = require('../../config/database');
const AKCIE = require('./akcie');
const VOLNE = require('./fond-volne');

// Co by akcionáři nabíhalo. Nic se tím nemění — hra si z toho kreslí
// počítadlo, které běží před očima.
function stav(al, pocet, od) {
  const sazba = Math.max(0, (al && al.akcie_sazba) || 0);
  const ucetni = Math.max(0, (al && al.akcie_ucetni) || 0);
  return {
    sazba,
    // Co nese jedna akcie za herní rok. Podle toho se akcie porovnávají mezi
    // sebou, ať jich kdo drží kolik chce.
    na_akcii_rocne: Math.round(ucetni * sazba),
    za_sekundu: AKCIE.dividendaZaSekundu(pocet, ucetni, sazba),
    od: od ? new Date(od).getTime() : Date.now(),
  };
}

// Doúčtuje hráči dividendu ze všech akcií, které drží. Vrací, kolik se
// připsalo — ať je v logu vidět, že to vůbec běží.
async function dorovnej(playerId) {
  const id = parseInt(playerId, 10);
  if (!Number.isFinite(id)) return 0;
  const radky = await prisma.gameAkcie.findMany({
    where: { player_id: id, pocet: { gt: 0 } } }).catch(() => []);
  if (!radky.length) return 0;
  let celkem = 0;
  for (const r of radky) {
    const al = await prisma.gameAliance.findUnique({ where: { id: r.aliance_id } })
      .catch(() => null);
    if (!al || !(al.akcie_sazba > 0) || !(al.akcie_ucetni > 0)) continue;
    const od = new Date(r.dividenda_do || r.created_at).getTime();
    const ted = Date.now();
    const castka = AKCIE.dividendaZa(r.pocet, al.akcie_ucetni, al.akcie_sazba, ted - od);
    // Setiny koruny: čas se NEPOSOUVÁ, ať se drobné nerozpustí tím, že se
    // hráč dívá často. Nabíhá dál, než z toho bude koruna.
    if (!(castka > 0)) continue;
    const v = await VOLNE.volne(al.id, al);
    const plat = Math.max(0, Math.min(castka, v.volne));
    // Fond nemá: čas se posune, ale nic se nevyplatí. Tohle je ta mez —
    // dividenda nenabíhá do dluhu, jen se o ten úsek přijde.
    if (!(plat > 0)) {
      await prisma.gameAkcie.updateMany({ where: { id: r.id, dividenda_do: r.dividenda_do },
        data: { dividenda_do: new Date(ted) } }).catch(() => null);
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        // Podmíněné zápisy: mezi výpočtem a zápisem mohl hráč akcie prodat
        // nebo fond utratit pokladnu. Netrefí-li se, nevyplatí se nic.
        const posun = await tx.gameAkcie.updateMany({
          where: { id: r.id, dividenda_do: r.dividenda_do, pocet: r.pocet },
          data: { dividenda_do: new Date(ted) } });
        if (!posun.count) throw new Error('souběh');
        const ubylo = await tx.gameAliance.updateMany({
          where: { id: al.id, pokladna: { gte: plat } },
          data: { pokladna: { decrement: plat } } });
        if (!ubylo.count) throw new Error('fond nemá');
        await tx.gameDelivery.create({ data: { player_id: id, kind: 'cash',
          amount: plat,
          popis: 'Dividenda z akcií fondu ' + al.nazev,
          text_kod: 'dor.akcie_dividenda_sazba',
          text_data: { p1: al.nazev, p2: plat } } });
      });
      celkem += plat;
    } catch (e) { /* souběh: zkusí se při příštím pohledu */ }
  }
  if (celkem) console.log('[game] dividenda z akcií: hráč #' + id + ' dostal ' + celkem);
  return celkem;
}

module.exports = { dorovnej, stav };
