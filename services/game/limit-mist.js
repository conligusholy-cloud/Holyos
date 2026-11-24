// =============================================================================
// Laundromat Tycoon — limit počtu míst na prádlomaty podle země
// =============================================================================
// Limit země = obyvatelé / obyvatel_na_misto (výchozí 5 000 → ČR ≈ 2 180 míst).
// Zemi místa určuje server: z oblasti (GameArea.country), a když oblast neznáme,
// z nejbližší známé oblasti podle souřadnic — klient si zemi vybrat nemůže.
// Počítají se všechna zabraná místa (stroje i pozemky). Už zabraná místa se
// nikomu neberou; nad limitem jen nejde zabrat další. Země bez známého počtu
// obyvatel limit nemá. Vypnuto, dokud to admin nezapne (admin hry → Nastavení).
'use strict';

const { getSetting, setSetting } = require('../settings');
const KEY = 'game.limit_mist';

// Obyvatelé (zaokrouhleně, miliony → kusy). Doplňuje se podle potřeby v adminu.
const OBYVATELE = {
  cz: 10900000, sk: 5430000, pl: 36600000, de: 84500000, at: 9100000, hu: 9600000, si: 2100000,
  hr: 3850000, ch: 8800000, fr: 68000000, es: 48000000, pt: 10400000, it: 59000000, nl: 17900000,
  be: 11700000, lu: 660000, dk: 5950000, se: 10500000, no: 5500000, fi: 5600000, ie: 5300000,
  gb: 68000000, ro: 19000000, bg: 6400000, gr: 10400000, rs: 6700000, ua: 37000000,
  lt: 2800000, lv: 1850000, ee: 1370000, us: 335000000, ca: 40000000, au: 26500000,
  // zbytek světa (odhad 2024, zaokrouhleno) — ať žádná země není „bez limitu“
  ad: 80000, al: 2750000, am: 2780000, az: 10150000, ba: 3200000, by: 9200000, cy: 1260000, ge: 3700000, gi: 33000,
  is: 390000, im: 85000, je: 103000, gg: 64000, fo: 54000, li: 39000, mc: 38000, md: 2400000, me: 620000, mk: 1830000,
  mt: 540000, sm: 34000, va: 800, xk: 1600000, tr: 85300000, ru: 144000000,
  mx: 129000000, gt: 18100000, bz: 410000, sv: 6300000, hn: 10600000, ni: 7000000, cr: 5200000, pa: 4500000,
  cu: 11000000, do: 11300000, ht: 11700000, jm: 2800000, pr: 3200000, tt: 1500000, bs: 410000, bb: 280000,
  co: 52300000, ve: 28300000, ec: 18000000, pe: 34000000, bo: 12400000, br: 216000000, py: 6900000, uy: 3400000,
  ar: 46000000, cl: 19600000, gy: 810000, sr: 620000,
  ma: 37800000, dz: 45600000, tn: 12500000, ly: 6900000, eg: 112700000, sd: 48100000, ng: 223800000, gh: 34100000,
  ci: 28900000, sn: 18000000, cm: 28600000, et: 126500000, ke: 55100000, tz: 67400000, ug: 48600000, rw: 14100000,
  ao: 36700000, za: 60400000, na: 2600000, bw: 2700000, zw: 16700000, zm: 20600000, mz: 33900000, mg: 30300000,
  mu: 1260000, cd: 102300000, cg: 6100000,
  il: 9800000, ps: 5400000, lb: 5400000, jo: 11300000, sy: 23200000, iq: 45500000, ir: 89200000, sa: 36900000,
  ae: 9500000, qa: 2700000, kw: 4300000, bh: 1500000, om: 4600000, ye: 34400000,
  kz: 19900000, uz: 35600000, kg: 7000000, tj: 10100000, tm: 6500000, af: 42200000, pk: 240500000, in: 1428000000,
  bd: 173000000, lk: 22000000, np: 30900000, cn: 1410000000, hk: 7500000, mo: 700000, tw: 23400000, mn: 3400000,
  jp: 124500000, kr: 51700000, kp: 26200000, vn: 98900000, th: 71800000, kh: 16900000, la: 7600000, mm: 54600000,
  my: 34300000, sg: 5900000, id: 277500000, ph: 117300000, nz: 5200000, pg: 10300000, fj: 940000,
};

const VYCHOZI = { zapnuto: false, obyvatel_na_misto: 5000, obyvatele: {} };

async function nastaveni() {
  const v = await getSetting(KEY, { type: 'json', defaultValue: {} }).catch(() => ({}));
  const o = Object.assign({}, VYCHOZI, v && typeof v === 'object' ? v : {});
  o.obyvatele = Object.assign({}, OBYVATELE, o.obyvatele || {});
  return o;
}

async function uloz(b) {
  const cur = await getSetting(KEY, { type: 'json', defaultValue: {} }).catch(() => ({}));
  const out = Object.assign({}, VYCHOZI, cur && typeof cur === 'object' ? cur : {});
  b = b && typeof b === 'object' ? b : {};
  if ('zapnuto' in b) out.zapnuto = !!b.zapnuto;
  if ('obyvatel_na_misto' in b) {
    const n = Number(b.obyvatel_na_misto);
    if (Number.isFinite(n)) out.obyvatel_na_misto = Math.min(1e7, Math.max(100, Math.round(n)));
  }
  if (b.obyvatele && typeof b.obyvatele === 'object') {
    out.obyvatele = Object.assign({}, out.obyvatele || {});
    Object.keys(b.obyvatele).forEach((k) => {
      const kod = String(k).toLowerCase();
      const n = Number(b.obyvatele[k]);
      if (/^[a-z]{2}$/.test(kod) && Number.isFinite(n) && n >= 0) out.obyvatele[kod] = Math.round(n);
    });
  }
  await setSetting(KEY, out, { type: 'json', description: 'Laundromat Tycoon — limit míst podle země (admin hry → Nastavení)', scope: 'game' });
  return nastaveni();
}

const rad = (x) => x * Math.PI / 180;
function vzdalenost(a, b, c, d) {
  const dl = rad(d - b), dp = rad(c - a);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dl / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Země místa: oblast podle klíče, jinak nejbližší známá oblast podle souřadnic.
async function zemeMista(prisma, areaKey, lat, lon) {
  const a = areaKey ? await prisma.gameArea.findUnique({ where: { key: String(areaKey) }, select: { country: true } }).catch(() => null) : null;
  if (a && /^[a-z]{2}$/.test(a.country || '') && a.country !== 'xx') return a.country;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const oblasti = await prisma.gameArea.findMany({ where: { country: { not: null }, lat: { not: null }, lon: { not: null } },
      select: { country: true, lat: true, lon: true }, take: 3000 }).catch(() => []);
    let best = null, bd = 1e9;
    oblasti.forEach((o) => { if (o.country === 'xx') return; const d = vzdalenost(lat, lon, o.lat, o.lon); if (d < bd) { bd = d; best = o.country; } });
    if (best && bd < 150) return best;
  }
  return null;
}

// Kolik míst je v které zemi zabráno.
async function zabrano(prisma) {
  const [skupiny, oblasti] = await Promise.all([
    prisma.gameSpotClaim.groupBy({ by: ['area_key'], _count: { _all: true } }),
    prisma.gameArea.findMany({ select: { key: true, country: true }, take: 5000 }),
  ]);
  const zeme = {}; oblasti.forEach((o) => { zeme[o.key] = o.country; });
  const out = {};
  skupiny.forEach((s) => { const k = zeme[s.area_key] && zeme[s.area_key] !== 'xx' ? zeme[s.area_key] : '??'; out[k] = (out[k] || 0) + s._count._all; });
  return out;
}

const limitZeme = (N, kod) => {
  const ob = N.obyvatele[kod];
  return ob ? Math.max(1, Math.floor(ob / N.obyvatel_na_misto)) : null;
};

// Přehled pro admina: země, limit, zabráno, volno.
async function prehled(prisma) {
  const N = await nastaveni(), Z = await zabrano(prisma);
  const kody = Array.from(new Set(Object.keys(Z).concat(Object.keys(N.obyvatele))));
  const zeme = kody.map((k) => {
    const limit = limitZeme(N, k), zab = Z[k] || 0;
    return { kod: k, obyvatel: N.obyvatele[k] || null, limit, zabrano: zab, volno: limit == null ? null : Math.max(0, limit - zab) };
  }).filter((z) => z.zabrano > 0 || z.kod === 'cz' || z.kod === 'sk')
    .sort((a, b) => b.zabrano - a.zabrano);
  return { zapnuto: N.zapnuto, obyvatel_na_misto: N.obyvatel_na_misto, zeme };
}

// Smí se v téhle zemi zabrat další místo?
async function smiZabrat(prisma, areaKey, lat, lon) {
  const N = await nastaveni();
  if (!N.zapnuto) return { ok: true };
  const kod = await zemeMista(prisma, areaKey, lat, lon);
  if (!kod) return { ok: true };
  const limit = limitZeme(N, kod);
  if (limit == null) return { ok: true, zeme: kod };
  const Z = await zabrano(prisma);
  const zab = Z[kod] || 0;
  return { ok: zab < limit, zeme: kod, limit, zabrano: zab };
}

module.exports = { nastaveni, uloz, prehled, smiZabrat, zemeMista, limitZeme, OBYVATELE };
