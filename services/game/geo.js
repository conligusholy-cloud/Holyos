// =============================================================================
// Laundromat Tycoon — odkud se hráč připojuje
// =============================================================================
// Město a zemi odvozujeme z IP, stejně jako to dělá běžná analytika. Nikde se
// na to hráče neptáme a nikam to neukazujeme — je to jen pro přehled ve Správě
// hry, aby bylo vidět, kde se hra chytá.
//
// Přesnost je taková, jakou dává IP: u mobilních sítí ukáže klidně město, kde
// sedí brána operátora, a přes VPN úplně jinou zemi. Pro „odkud se hra hraje"
// to stačí, na nic jiného se to používat nemá.
'use strict';

const { prisma } = require('../../config/database');

const SLUZBA = 'https://ipwho.is/';
const PLATNOST_MS = 14 * 86400e3;   // po dvou týdnech se stejná IP zjistí znovu
const CACHE_MAX = 2000;
const cache = new Map();            // ip -> { kdy, data|null }

// Soukromé a lokální adresy nemá cenu nikam posílat.
function verejna(ip) {
  if (!ip) return false;
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.')
    || ip.startsWith('192.168.') || ip.startsWith('169.254.') || ip.startsWith('fc')
    || ip.startsWith('fd')) return false;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  return true;
}

async function dohledej(ip) {
  if (!verejna(ip)) return null;
  const mam = cache.get(ip);
  if (mam && Date.now() - mam.kdy < PLATNOST_MS) return mam.data;
  let data = null;
  try {
    // Vlastní timeout: na tomhle nesmí viset požadavek hráče.
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(SLUZBA + encodeURIComponent(ip), { signal: ac.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j && j.success && (j.city || j.country)) {
      data = {
        city: String(j.city || '').slice(0, 80) || null,
        region: String(j.region || '').slice(0, 80) || null,
        country: String(j.country || '').slice(0, 80) || null,
        cc: String(j.country_code || '').slice(0, 4) || null,
      };
    }
  } catch (e) {
    // Služba neodpověděla. Nevadí — zkusí se příště, hra na tom nestojí.
    return null;
  }
  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(ip, { kdy: Date.now(), data });
  return data;
}

// Doplní hráči město, když ho ještě nemá nebo se mu změnila IP. Běží na pozadí
// a nikdy nevyhodí ven chybu — požadavek, ze kterého se volá, na ni nečeká.
function obnov(hrac, ip) {
  if (!hrac || !hrac.id || !verejna(ip)) return;
  const stejna = hrac.geo_ip === ip;
  const cerstve = hrac.geo_at && Date.now() - new Date(hrac.geo_at).getTime() < PLATNOST_MS;
  if (stejna && cerstve) return;
  setImmediate(async () => {
    try {
      const g = await dohledej(ip);
      if (!g) return;
      await prisma.gamePlayer.update({ where: { id: hrac.id }, data: {
        geo_city: g.city, geo_region: g.region, geo_country: g.country, geo_cc: g.cc,
        geo_ip: ip, geo_at: new Date(),
      } });
    } catch (e) {
      console.warn('[game-geo] #' + hrac.id + ':', e && e.message);
    }
  });
}

module.exports = { obnov, dohledej, verejna };
