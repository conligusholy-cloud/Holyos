#!/usr/bin/env node
// =============================================================================
// Oprava id míst ve městech bez latinky
// =============================================================================
// Předpona id místa vznikala tak, že se z klíče města vyhodilo všechno kromě
// a-z0-9. U Москва i Львів z toho nezbude nic, takže obě města dostala stejnou
// předponu a tím i stejná id míst: --0, --1, --2… Prádlomat postavený v Moskvě
// se pak ukazoval i ve Lvově. Není to duplikát, je to jedna provozovna
// ukázaná dvakrát.
//
// Tenhle skript přejmenuje id u takových měst na otisk klíče (m2d4e5321-0) a
// protáhne to všude, kde id leží: claimy, doručenky, obchody, dražby, zástavy
// u půjček a stavy hráčů. Města s latinkou se nemění.
//
// POUŽITÍ:
//   node nastroje/opravit-id-mest.js              zkouška nanečisto
//   node nastroje/opravit-id-mest.js --zapsat     provede
'use strict';

try { require('dotenv').config(); } catch (e) { /* bez dotenv to jede z prostředí */ }
const crypto = require('crypto');
const { prisma } = require('../config/database');

const ZAPSAT = process.argv.includes('--zapsat');

function predponaMista(key) {
  const s = String(key).replace(/[^a-z0-9]+/g, '-');
  if (/[a-z0-9]/.test(s)) return s;
  return 'm' + crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 8);
}

// Id může mít za sebou ještě stání: klodzko-2#2. Základ se přejmenuje, zbytek
// zůstane.
function prejmenuj(id, mapa) {
  const s = String(id || '');
  const mrizka = s.indexOf('#');
  const zaklad = mrizka >= 0 ? s.slice(0, mrizka) : s;
  const zbytek = mrizka >= 0 ? s.slice(mrizka) : '';
  return mapa[zaklad] ? mapa[zaklad] + zbytek : null;
}

async function main() {
  const oblasti = await prisma.gameArea.findMany();
  // Jen města, kterým se předpona mění.
  const dotcene = oblasti.map((a) => {
    const stara = String(a.key).replace(/[^a-z0-9]+/g, '-');
    const nova = predponaMista(a.key);
    return { a, stara, nova };
  }).filter((x) => x.stara !== x.nova);

  if (!dotcene.length) { console.log('Žádné město s prázdnou předponou — není co opravovat.'); return; }

  console.log('Měst k opravě: ' + dotcene.length);
  // Mapa id podle města. Id se skládalo jako <predpona>-<poradi>, takže
  // přejmenování je čistá výměna předpony.
  const mapaMesta = new Map();       // key města → { stareId: noveId }
  const kolize = new Set();          // staré id, které vzniklo ve víc městech
  const globalni = {};
  dotcene.forEach(({ a, nova }) => {
    const m = {};
    (Array.isArray(a.spots) ? a.spots : []).forEach((sp, i) => {
      const stare = String(sp.id);
      const nove = nova + '-' + i;
      m[stare] = nove;
      if (globalni[stare] && globalni[stare] !== nove) kolize.add(stare);
      globalni[stare] = nove;
    });
    mapaMesta.set(a.key, m);
    console.log('  ' + a.key + ' (' + a.name + ') · míst ' + ((a.spots || []).length)
      + ' · ' + (Object.keys(m)[0] || '?') + ' → ' + (m[Object.keys(m)[0]] || '?'));
  });
  if (kolize.size) {
    console.log('  Stejná id vznikla ve víc městech: ' + kolize.size
      + ' — u nich rozhoduje město, ke kterému řádek patří.');
  }

  // ── Claimy ────────────────────────────────────────────────────────────────
  // Claim ví, ke kterému městu patří (area_key), takže je vždycky jednoznačný.
  // Z něj se zároveň dozvíme, jak přejmenovat řádky, které město neznají.
  const claimy = await prisma.gameSpotClaim.findMany();
  const zClaimu = {};               // staré id → nové id, rozhodnuté claimem
  const claimyKeZmene = [];
  claimy.forEach((c) => {
    const m = mapaMesta.get(c.area_key);
    if (!m) return;
    const nove = prejmenuj(c.spot_id, m);
    if (!nove || nove === c.spot_id) return;
    claimyKeZmene.push({ stare: c.spot_id, nove, kdo: c.nick, name: c.name });
    zClaimu[c.spot_id] = nove;
  });
  console.log('\nClaimů k přejmenování: ' + claimyKeZmene.length);
  claimyKeZmene.forEach((x) => console.log('  ' + x.stare + ' → ' + x.nove
    + '  (' + x.kdo + ' · ' + x.name + ')'));

  // Pro ostatní tabulky: nejdřív podle claimu, pak podle globální mapy, ale
  // nikdy u id, které vzniklo ve víc městech a claim ho nerozhodl.
  const prelozId = (id) => {
    if (!id) return null;
    const s = String(id);
    const zaklad = s.indexOf('#') >= 0 ? s.slice(0, s.indexOf('#')) : s;
    if (zClaimu[zaklad]) return prejmenuj(s, zClaimu);
    if (kolize.has(zaklad)) return null;          // nejednoznačné, necháváme
    return globalni[zaklad] ? prejmenuj(s, globalni) : null;
  };

  // ── Ostatní tabulky s id místa ────────────────────────────────────────────
  // Třetí hodnota je sloupec primárního klíče — GameSpotBuilt má místo id
  // rovnou spot_id, takže by se podle 'id' nenašel.
  const tabulky = [
    ['gameDelivery', 'spot_id', 'id'], ['gameTrade', 'spot_id', 'id'],
    ['gameDrazba', 'spot_id', 'id'], ['gameLoan', 'zastava_spot', 'id'],
    ['gameSpotBuilt', 'spot_id', 'spot_id'],
    ['gameMarket', 'spot_id', 'id'], ['gameAuction', 'spot_id', 'id'],
  ];
  // Chybějící model znamená zastaralého Prisma klienta. Přepsat půlku tabulek
  // a o zbytku nevědět je horší než původní chyba, takže se radši zastavíme.
  const chybi = tabulky.filter(([m]) => !prisma[m]).map(([m]) => m);
  if (chybi.length) {
    console.error('\nPrisma klient nezná: ' + chybi.join(', '));
    console.error('Spusť nejdřív `npx prisma generate` a zkus to znovu.');
    process.exit(2);
  }

  const plan = [];
  for (const [model, pole, klic] of tabulky) {
    let rows = [];
    try { rows = await prisma[model].findMany(); } catch (e) { console.warn('  ' + model + ': ' + e.message); continue; }
    rows.forEach((r) => {
      const nove = prelozId(r[pole]);
      if (nove && nove !== r[pole]) plan.push({ model, pole, klic, kde: r[klic], stare: r[pole], nove });
    });
  }
  console.log('\nŘádků v dalších tabulkách: ' + plan.length);
  const dleModelu = {};
  plan.forEach((x) => { dleModelu[x.model] = (dleModelu[x.model] || 0) + 1; });
  Object.keys(dleModelu).forEach((m) => console.log('  ' + m + ': ' + dleModelu[m]));

  // ── Stavy hráčů ───────────────────────────────────────────────────────────
  // Jednotky i pozemky vědí, ke kterému městu patří (areaId), takže je lze
  // přejmenovat bez hádání. Zbytek jde podle města, které hráč má prozkoumané.
  const hraci = await prisma.gamePlayer.findMany({ select: { id: true, nick: true, state: true } });
  const stavy = [];
  hraci.forEach((h) => {
    const st = h.state;
    if (!st || typeof st !== 'object') return;
    let zmen = 0;
    const kopie = JSON.parse(JSON.stringify(st));
    // Mapa pro tohohle hráče: jen města, která má prozkoumaná.
    const moje = {};
    Object.keys(kopie.areas || {}).forEach((aid) => {
      const m = mapaMesta.get(aid);
      if (!m) return;
      (kopie.areas[aid].spots || []).forEach((sp) => {
        const nove = prejmenuj(sp.id, m);
        if (nove && nove !== sp.id) { moje[sp.id] = nove; sp.id = nove; zmen++; }
      });
    });
    const prelozHrace = (id) => {
      if (!id) return null;
      const s = String(id);
      const zaklad = s.indexOf('#') >= 0 ? s.slice(0, s.indexOf('#')) : s;
      if (zClaimu[zaklad]) return prejmenuj(s, zClaimu);
      return moje[zaklad] ? prejmenuj(s, moje) : null;
    };
    // Jednotky a pozemky — ty znají svoje město, takže mají přednost.
    ['units', 'pozemky'].forEach((pole) => {
      (Array.isArray(kopie[pole]) ? kopie[pole] : []).forEach((u) => {
        const m = mapaMesta.get(u.areaId);
        const nove = (m && prejmenuj(u.spotId, m)) || prelozHrace(u.spotId);
        if (nove && nove !== u.spotId) { u.spotId = nove; zmen++; }
      });
    });
    (Array.isArray(kopie.loans) ? kopie.loans : []).forEach((l) => {
      const nove = prelozHrace(l.spotId);
      if (nove && nove !== l.spotId) { l.spotId = nove; zmen++; }
    });
    ['revealed', 'plany', 'prodano'].forEach((pole) => {
      const o = kopie[pole];
      if (!o || typeof o !== 'object') return;
      Object.keys(o).forEach((k) => {
        const nove = prelozHrace(k);
        if (nove && nove !== k) { o[nove] = o[k]; delete o[k]; zmen++; }
      });
    });
    if (zmen) stavy.push({ id: h.id, nick: h.nick, zmen, state: kopie });
  });
  console.log('\nHráčů se změnou stavu: ' + stavy.length);
  stavy.forEach((x) => console.log('  #' + x.id + ' ' + x.nick + ' · změn ' + x.zmen));

  if (!ZAPSAT) {
    console.log('\n(zkouška nanečisto — provést přes --zapsat)');
    return;
  }

  // ── Zápis ─────────────────────────────────────────────────────────────────
  // Všechno v jedné transakci: buď se přepíše celá sada, nebo nic. Rozdělaný
  // přepis by byl horší než původní chyba.
  await prisma.$transaction(async (tx) => {
    for (const { a, nova } of dotcene) {
      const spots = (Array.isArray(a.spots) ? a.spots : []).map((sp, i) =>
        Object.assign({}, sp, { id: nova + '-' + i }));
      await tx.gameArea.update({ where: { key: a.key }, data: { spots } });
    }
    for (const c of claimyKeZmene) {
      await tx.gameSpotClaim.update({ where: { spot_id: c.stare }, data: { spot_id: c.nove } });
    }
    for (const x of plan) {
      await tx[x.model].update({ where: { [x.klic]: x.kde }, data: { [x.pole]: x.nove } });
    }
    for (const h of stavy) {
      // Verzi je nutné zvednout. Hráč má v prohlížeči starý stav se starými id
      // a při nejbližším ukládání by ho poslal zpátky — přepis by se tím
      // tiše vrátil. S vyšší verzí mu server uložení odmítne a pošle ten
      // opravený, což je přesně to, co chceme.
      await tx.gamePlayer.update({
        where: { id: h.id },
        data: { state: h.state, state_rev: { increment: 1 } },
      });
    }
  }, { timeout: 120000 });

  console.log('\nHotovo. Měst ' + dotcene.length + ', claimů ' + claimyKeZmene.length
    + ', dalších řádků ' + plan.length + ', stavů ' + stavy.length + '.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
