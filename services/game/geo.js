// =============================================================================
// Laundromat Tycoon — odkud se hráč připojuje
// =============================================================================
// Město a zemi odvozujeme z IP, stejně jako to dělá běžná analytika. Nikde se
// na to hráče neptáme a ve hře se to nikomu neukazuje.
//
// Jenže IP město spolehlivě neurčí. Mobilní sítě posílají provoz přes pár bran
// a databáze pak u celého rozsahu uvádějí město té brány — Lord-P hrál
// z Rychnova nad Kněžnou a vyšla z toho Blatná, dvě stě kilometrů vedle.
// Proto se ptáme dvou nezávislých služeb a městu věříme jen tehdy, když se
// obě shodnou. Když ne, řekneme rovnou, že město neznáme, a ukážeme zemi
// a poskytovatele. Špatné město je horší než žádné.
'use strict';

const { prisma } = require('../../config/database');

const PLATNOST_MS = 14 * 86400e3;   // po dvou týdnech se stejná IP zjistí znovu
const CACHE_MAX = 2000;
const TIMEOUT_MS = 4000;
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

// Na porovnání názvů měst: „Blatna" a „Blatná" je totéž, „Praha" a „Prague" ne
// — s tím se nedá nic dělat, a radši dvakrát řekneme „nevíme", než abychom
// jednou ukázali město, kde hráč není.
function klic(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function jsonS(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return await r.json();
  } finally { clearTimeout(t); }
}

// Dvě nezávislé služby. Obě zdarma a bez klíče; když jedna neodpoví, jede se
// s druhou, jen s nižší jistotou.
async function ipwho(ip) {
  try {
    const j = await jsonS('https://ipwho.is/' + encodeURIComponent(ip));
    if (!j || !j.success) return null;
    return { city: j.city || null, region: j.region || null, country: j.country || null,
      cc: j.country_code || null, isp: (j.connection && (j.connection.isp || j.connection.org)) || null,
      mobil: false };
  } catch (e) { return null; }
}
async function ipapi(ip) {
  try {
    const j = await jsonS('http://ip-api.com/json/' + encodeURIComponent(ip)
      + '?fields=status,country,countryCode,regionName,city,isp,org,mobile,proxy,hosting');
    if (!j || j.status !== 'success') return null;
    return { city: j.city || null, region: j.regionName || null, country: j.country || null,
      cc: j.countryCode || null, isp: j.isp || j.org || null,
      mobil: !!(j.mobile || j.proxy || j.hosting) };
  } catch (e) { return null; }
}

async function dohledej(ip) {
  if (!verejna(ip)) return null;
  const mam = cache.get(ip);
  if (mam && Date.now() - mam.kdy < PLATNOST_MS) return mam.data;

  const [a, b] = await Promise.all([ipwho(ip), ipapi(ip)]);
  let data = null;
  if (a || b) {
    const z = a || b;
    const shoda = !!(a && b && a.city && b.city && klic(a.city) === klic(b.city));
    const mobil = !!((a && a.mobil) || (b && b.mobil));
    data = {
      // Město ukážeme jen tehdy, když se obě služby shodly a nejde o mobilní
      // nebo skrytou síť. Jinak si ho necháme jen jako tip.
      city: shoda && !mobil ? z.city : null,
      tip: z.city || null,
      region: shoda && !mobil ? (z.region || null) : null,
      country: z.country || null,
      cc: z.cc || null,
      isp: z.isp || null,
      // mesto = shodly se, zeme = víme jen zemi, mobil = mobilní nebo skrytá síť
      presnost: mobil ? 'mobil' : (shoda ? 'mesto' : 'zeme'),
      zdroju: (a ? 1 : 0) + (b ? 1 : 0),
    };
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
        geo_isp: g.isp, geo_tip: g.tip, geo_presnost: g.presnost,
        geo_ip: ip, geo_at: new Date(),
      } });
    } catch (e) {
      console.warn('[game-geo] #' + hrac.id + ':', e && e.message);
    }
  });
}

module.exports = { obnov, dohledej, verejna, klic };
