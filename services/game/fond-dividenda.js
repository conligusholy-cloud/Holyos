// =============================================================================
// Laundromat Tycoon — průběžná dividenda členům fondu
// =============================================================================
// Akcionáři dostali dividendu, která nabíhá v čase. Členové fondu — ti, kdo do
// něj složili peníze — měli dosud jen jednorázovou výplatu, o které se pokaždé
// znovu hlasuje. Tohle je jejich obdoba: fond si odhlasuje sazbu a ta pak
// nabíhá stejně jako akcionářům.
//
// Základ je díl členů na hodnotě fondu, tedy to, co NEPATŘÍ akcionářům,
// rozdělené mezi členy podle vkladů. Kdo vložil víc, dostává víc — stejné
// pravidlo, jakým se dělí všechno ostatní ve fondu.
//
// Pravidla jsou stejná jako u akcionářů a platí ze stejného důvodu:
//  1. Platí se jen z VOLNÝCH peněz fondu.
//  2. Když fond nemá, nenabíhá nic — čas běží dál a ten úsek propadá.
//  3. Setiny koruny čas neposouvají, aby se drobné nerozpustily.
'use strict';

const { prisma } = require('../../config/database');
const AKCIE = require('./akcie');
const FOND = require('./fond');
const VOLNE = require('./fond-volne');

// Co členovi nabíhá. Nic se tím nemění — hra si z toho kreslí počítadlo.
function stav(al, podilClena, od) {
  const sazba = Math.max(0, (al && al.clen_sazba) || 0);
  const zaklad = Math.max(0, (al && al.clen_zaklad) || 0);
  const muj = zaklad * Math.max(0, Math.min(1, Number(podilClena) || 0));
  return {
    sazba,
    zaklad: Math.round(muj),
    // Co dostanou členové dohromady za herní rok. Podle toho se pozná, co
    // sazba stojí fond — jedno číslo pro celý panel.
    celkem_rocne: Math.round(zaklad * sazba),
    za_sekundu: AKCIE.dividendaZaSekundu(1, muj, sazba),
    od: od ? new Date(od).getTime() : Date.now(),
  };
}

// Podíly členů podle vkladů. Stejný výpočet, jakým se ve fondu dělí všechno
// ostatní — dvě různá „kolik mi z fondu patří" by byla past.
function podilyZVkladu(radky) {
  const p = FOND.podily((radky || []).map((r) => ({ clen_id: r.clen_id, castka: r.castka })));
  const m = new Map();
  (p || []).forEach((x) => m.set(x.clen_id, x.podil));
  return m;
}

// Doúčtuje hráči dividendu ze všech fondů, ve kterých má vklad.
async function dorovnej(playerId) {
  const id = parseInt(playerId, 10);
  if (!Number.isFinite(id)) return 0;
  const moje = await prisma.gameFondVklad.findMany({
    where: { clen_id: id, castka: { gt: 0 } } }).catch(() => []);
  if (!moje.length) return 0;
  let celkem = 0;
  for (const r of moje) {
    const al = await prisma.gameAliance.findUnique({ where: { id: r.aliance_id } })
      .catch(() => null);
    if (!al || !(al.clen_sazba > 0) || !(al.clen_zaklad > 0)) continue;
    const vsichni = await prisma.gameFondVklad.findMany({
      where: { aliance_id: r.aliance_id } }).catch(() => []);
    const podil = podilyZVkladu(vsichni).get(id) || 0;
    if (!(podil > 0)) continue;
    const zaklad = al.clen_zaklad * podil;
    const od = new Date(r.dividenda_do || r.created_at).getTime();
    const ted = Date.now();
    const castka = AKCIE.dividendaZa(1, zaklad, al.clen_sazba, ted - od);
    // Setiny koruny: čas se NEPOSOUVÁ, ať se drobné nerozpustí tím, že se
    // člen dívá často.
    if (!(castka > 0)) continue;
    const v = await VOLNE.volne(al.id, al);
    const plat = Math.max(0, Math.min(castka, v.volne));
    // Fond nemá: čas se posune, ale nic se nevyplatí. Žádný skrytý dluh.
    if (!(plat > 0)) {
      await prisma.gameFondVklad.updateMany({
        where: { id: r.id, dividenda_do: r.dividenda_do },
        data: { dividenda_do: new Date(ted) } }).catch(() => null);
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        // Podmíněné zápisy: mezi výpočtem a zápisem mohl člen vybrat vklad
        // nebo fond utratit pokladnu.
        const posun = await tx.gameFondVklad.updateMany({
          where: { id: r.id, dividenda_do: r.dividenda_do, castka: r.castka },
          data: { dividenda_do: new Date(ted) } });
        if (!posun.count) throw new Error('souběh');
        const ubylo = await tx.gameAliance.updateMany({
          where: { id: al.id, pokladna: { gte: plat } },
          data: { pokladna: { decrement: plat } } });
        if (!ubylo.count) throw new Error('fond nemá');
        await tx.gameDelivery.create({ data: { player_id: id, kind: 'cash',
          amount: plat,
          popis: 'Dividenda z fondu ' + al.nazev,
          text_kod: 'dor.fond_dividenda_sazba',
          text_data: { p1: al.nazev, p2: plat } } });
      });
      celkem += plat;
    } catch (e) { /* souběh: zkusí se při příštím pohledu */ }
  }
  if (celkem) console.log('[game] dividenda z fondu: člen #' + id + ' dostal ' + celkem);
  return celkem;
}

module.exports = { dorovnej, stav, podilyZVkladu };
