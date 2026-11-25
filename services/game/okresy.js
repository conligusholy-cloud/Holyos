// =============================================================================
// Laundromat Tycoon — území Unie
// =============================================================================
// Území je buňka šestiúhelníkové sítě o velikosti zhruba okresu. Geometrie
// (klíč, obrys, sousedé) je v sit.js a nemá žádnou databázi; tenhle modul k ní
// přidává to, co z buňky dělá území hry: jméno podle největšího města uvnitř,
// obyvatele jako součet známých měst a řádek v databázi, ze kterého mapa
// kreslí a podle kterého se počítá licence.
//
// Název „okres" zůstal v kódu i ve sloupcích databáze, protože to je pořád
// území té velikosti a přejmenovat půl schématu by nic nespravilo.
'use strict';

const { prisma } = require('../../config/database');
const SIT = require('./sit');

const { klicBodu, jeKlic, obrys, stred, sousedniKlice, plocha,
  nejvetsi, soucetObyvatel, RAD } = SIT;

// ─── Jméno a obyvatelé ───────────────────────────────────────────────────────
// Buňka se jmenuje po největším známém městě uvnitř a obyvatele má jejich
// součtem. Počítá to sit.js, odsud jdou jen data z databáze.
async function mestaVBunce(key) {
  return prisma.gameArea.findMany({ where: { okres_key: key },
    select: { key: true, name: true, population: true, country: true,
      lat: true, lon: true } }).catch(() => []);
}

// ─── Řádek území ─────────────────────────────────────────────────────────────
// Založí nebo osvěží řádek buňky. Všechno je místní, takže tohle smí volat
// i cesta, po které se hráč dívá — nic se nestahuje a na nic se nečeká.
//
// Jméno se jednou dané nemění: hráč drží „Šumperk" a nemá se mu to pod rukou
// přejmenovat jen proto, že se v buňce objevilo větší město. Obyvatelé se
// naopak osvěžují pokaždé — podle nich se počítá licence.
async function zajisti(key, nazevNavrh, zemeNavrh) {
  if (!jeKlic(key)) return null;
  const [mam, mesta] = await Promise.all([
    prisma.gameOkres.findUnique({ where: { key } }).catch(() => null),
    mestaVBunce(key),
  ]);
  const nej = nejvetsi(mesta);
  const s = stred(key) || {};
  const data = {
    nazev: String((mam && mam.nazev) || (nej && nej.name) || nazevNavrh || key).slice(0, 120),
    zeme: (mam && mam.zeme) || (nej && nej.country) || zemeNavrh || null,
    lat: s.lat != null ? s.lat : (mam && mam.lat),
    lon: s.lon != null ? s.lon : (mam && mam.lon),
    obyvatel: soucetObyvatel(mesta) || (mam && mam.obyvatel) || null,
    zdroj: 'sit:h3:' + RAD,
    hranice: obrys(key),
    sousedi: sousedniKlice(key),
  };
  return prisma.gameOkres.upsert({ where: { key },
    create: Object.assign({ key }, data), update: data }).catch(() => mam);
}

// ─── Město → území ───────────────────────────────────────────────────────────
// Do které buňky město patří. Spočítá se a uloží; podruhé se jen čte.
async function proOblast(area) {
  if (!area) return null;
  if (jeKlic(area.okres_key)) {
    return { key: area.okres_key, nazev: area.okres_nazev || area.okres_key };
  }
  const key = klicBodu(area.lat, area.lon);
  if (!key) return null;
  // Jméno buňky je jméno největšího města v ní. Při prvním dotazu je tím
  // městem často právě tohle, takže se použije jako návrh.
  await prisma.gameArea.update({ where: { key: area.key },
    data: { okres_key: key, okres_nazev: area.name || null } }).catch(() => {});
  const r = await zajisti(key, area.name, area.country);
  return { key, nazev: (r && r.nazev) || area.name || key };
}
// Dřív byly dvě cesty: jedna, která si počkala na cizí službu, a jedna, která
// odpověděla hned a dotáhla to na pozadí. Teď se nic nestahuje, takže je
// jedna. Jméno zůstalo, ať se nemusí přepisovat volající.
const proOblastTed = proOblast;

// Území k seznamu měst.
async function proKlice(klice) {
  const out = new Map();
  if (!klice || !klice.length) return out;
  const rows = await prisma.gameArea.findMany({ where: { key: { in: klice } } }).catch(() => []);
  for (const a of rows) {
    const o = await proOblast(a).catch(() => null);
    if (o && o.key) out.set(a.key, o);
  }
  return out;
}

// Města, která do území patří. Podle nich se počítají volná místa i potenciál.
async function oblasti(key) {
  if (!key) return [];
  const rows = await prisma.gameArea.findMany({ where: { okres_key: String(key) },
    select: { key: true } }).catch(() => []);
  return rows.map((r) => r.key);
}

// Sousedé území. Šest buněk kolem — a rovnou se založí jejich řádky, ať má
// hra co ukázat, když si hráč na „+" klikne.
async function sousedi(key) {
  if (!jeKlic(key)) return [];
  const klice = sousedniKlice(key);
  for (const k of klice) await zajisti(k, null, null).catch(() => {});
  return klice;
}

// ─── Převod toho, co běží ────────────────────────────────────────────────────
// Území se dřív vázala na okres z OpenStreetMap („cz:sumperk"). Převedou se na
// buňku kolem svého města a zůstanou tomu, kdo je drží — je to naše změna
// pravidel, ne jeho, takže se nic nedoplácí.
//
// Pořadí je důležité: území se musí převést DŘÍV, než se městům přepočítají
// klíče, protože staré území se k městu dohledává právě přes ten starý klíč.
let PREVEDENO = false;
async function prevedStaraUzemi() {
  if (PREVEDENO) return 0;
  PREVEDENO = true;
  let kolik = 0;
  const uzemi = await prisma.gameTerritory.findMany().catch(() => []);
  for (const t of uzemi) {
    if (jeKlic(t.okres_key)) continue;
    // Město, podle kterého se území pozná. Buď je starý klíč rovnou klíčem
    // města, nebo se město k tomu starému okresu hlásí.
    const mesto = await prisma.gameArea.findFirst({
      where: { OR: [{ key: t.okres_key }, { okres_key: t.okres_key }] },
      select: { lat: true, lon: true, name: true, country: true },
    }).catch(() => null);
    const key = mesto ? klicBodu(mesto.lat, mesto.lon) : null;
    if (!key) {
      console.warn('[game] území', t.okres_key, '— nejde převést, město se nenašlo');
      continue;
    }
    const obsazeno = await prisma.gameTerritory.findUnique({ where: { okres_key: key } }).catch(() => null);
    if (obsazeno && obsazeno.id !== t.id) {
      console.warn('[game] území', t.okres_key, '— buňka', key, 'už patří', obsazeno.master_nick);
      continue;
    }
    await prisma.gameTerritory.update({ where: { id: t.id }, data: { okres_key: key } }).catch(() => {});
    await prisma.gameOperatorLicence.updateMany({ where: { okres_key: t.okres_key },
      data: { okres_key: key } }).catch(() => {});
    await zajisti(key, mesto.name, mesto.country).catch(() => {});
    console.log('[game] území', t.okres_key, '→ buňka', key);
    kolik++;
  }
  // Teprve teď města: starý klíč už nikdo nepotřebuje. Měst jsou tisíce, tak
  // se sesypou po buňkách a zapíše se jedním dotazem na buňku, ne na město.
  const mesta = await prisma.gameArea.findMany({
    select: { key: true, lat: true, lon: true, okres_key: true } }).catch(() => []);
  const doBunky = new Map();
  mesta.forEach((a) => {
    if (jeKlic(a.okres_key)) return;
    const key = klicBodu(a.lat, a.lon);
    if (!key) return;
    if (!doBunky.has(key)) doBunky.set(key, []);
    doBunky.get(key).push(a.key);
  });
  for (const [key, klice] of doBunky) {
    await prisma.gameArea.updateMany({ where: { key: { in: klice } },
      data: { okres_key: key } }).catch(() => {});
  }
  if (doBunky.size) console.log('[game] měst přepočítáno do buněk:', mesta.length);
  // A staré řádky okresů pryč — jsou mezi nimi ty, co měly obrys města.
  const stare = await prisma.gameOkres.findMany({ select: { key: true } }).catch(() => []);
  for (const o of stare) {
    if (jeKlic(o.key)) continue;
    await prisma.gameOkres.delete({ where: { key: o.key } }).catch(() => {});
  }
  if (kolik) console.log('[game] převedeno území na buňky:', kolik);
  return kolik;
}
// Převod je jednorázový a nic se při něm nestahuje, ale sahá na všechna města.
// Na cestě, po které se hráč dívá, se na něj proto nečeká.
function prevodNaPozadi() {
  if (PREVEDENO) return false;
  Promise.resolve().then(prevedStaraUzemi).catch((e) => {
    console.warn('[game] převod území selhal:', e && e.message);
  });
  return true;
}

module.exports = { klicBodu, jeKlic, obrys, stred, sousedniKlice, plocha,
  mestaVBunce, proOblast, proOblastTed, zajisti, oblasti, proKlice, sousedi,
  prevedStaraUzemi, prevodNaPozadi, RAD };
