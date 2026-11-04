// =============================================================================
// Laundromats Milionář — účty hráčů, karty a nákupy
// =============================================================================
// Hra samotná je veřejná (viz game.routes.js). Tenhle router přidává účet:
// hráč si na začátku vymyslí herní nick a heslo, stav hry se ukládá na server
// a může tak pokračovat na jiném zařízení.
//
// Proč účet vůbec je: zrychlující karty se kupují za skutečné peníze. Kdyby
// stav žil jen v prohlížeči, přijde hráč o zaplacené karty při smazání dat
// a kdokoli si je přidá ručně v konzoli. Karty proto drží databáze.
//
// Jméno a e-mail se nevyžadují při registraci — až před prvním nákupem.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const JWT_SECRET = require('../config/secrets').jwtSecret();

const router = express.Router();
router.use(express.json({ limit: '512kb' })); // stav hry bývá pár desítek kB

const COOKIE = 'lm_game';
const TOKEN_DAYS = 180;
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const NICK_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const FIRMA_RE = /^[\p{L}\p{N} .,&'"()+-]{2,60}$/u;
const firmaNebo = (f, nick) => (f && FIRMA_RE.test(f) ? f : nick + ' s.r.o.');
const ipOf = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || '').trim();

// ─── Limiter (v paměti, stejně jako ve zbytku hry) ───────────────────────────
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now); hits.set(key, a);
  if (hits.size > 5000) { for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); }
  return a.length > max;
}

// ─── Katalog karet ───────────────────────────────────────────────────────────
// Ceny v haléřích. Co karta dělá, rozhoduje server — klient si efekt nevymýšlí.
const CARDS = {
  rush: {
    kind: 'rush', name: 'Expresní dovoz', icon: 'truck', price: 4900,
    short: 'Stroj dorazí hned',
    desc: 'Objednaný prádlomat přeskočí dvouměsíční dodací lhůtu a je na skladě okamžitě.'
  },
  traffic: {
    kind: 'traffic', name: 'Reklamní kampaň', icon: 'megaphone', price: 9900,
    short: '+15 % návštěvnosti natrvalo',
    desc: 'Letáky, polep, místní rádio. Do všech tvých prádlomatů začne chodit víc lidí — a zůstane to tak.'
  },
  connect: {
    kind: 'connect', name: 'Známý řemeslník', icon: 'wrench', price: 7900,
    short: 'Přípojky o 40 % levněji',
    desc: 'Udělá ti vodu, odpad i elektřinu za přátelskou cenu. Platí na jednu stavbu.'
  },
  credit: {
    kind: 'credit', name: 'Lepší bankéř', icon: 'bank', price: 12900,
    short: 'Úrok −2 % a vyšší strop',
    desc: 'Přepíše ti úvěrové podmínky: sazba klesne o dva procentní body a banka ti natrvalo zvedne rámec.'
  }
};
const CARD_KINDS = Object.keys(CARDS);

// ─── Balíčky herních peněz ───────────────────────────────────────────────────
// Ceny v haléřích, laundry na ruku. Čím větší balík, tím víc za korunu —
// u stovky je to 1 000 L$/Kč, u dvoutisícovky 2 300 L$/Kč.
const CASH = {
  cash100:  { kind: 'cash100',  name: 'Hrst laundrů',   price: 10000,  laundry: 100000 },
  cash200:  { kind: 'cash200',  name: 'Balík laundrů',  price: 20000,  laundry: 300000 },
  cash500:  { kind: 'cash500',  name: 'Kufřík',         price: 50000,  laundry: 900000 },
  cash1000: { kind: 'cash1000', name: 'Trezor',         price: 100000, laundry: 2000000 },
  cash2000: { kind: 'cash2000', name: 'Obrněný vůz',    price: 200000, laundry: 4600000 },
};
const CASH_KINDS = Object.keys(CASH);
// Ručně přidaná hotovost z administrace. Není v nabídce, nedá se koupit —
// vzniká jen tím, že ji někdo hráči přidá, a nese vlastní částku.
const CASH_CUSTOM = 'cash_dar';
const ALL = Object.assign({}, CARDS, CASH);

// ─── Ceník z databáze ────────────────────────────────────────────────────────
// Hodnoty výš jsou jen výchozí. Co platí doopravdy, je v tabulce game_prices —
// ceny se tak mění v administraci bez nasazování. Držíme je minutu v paměti,
// ať se kvůli každému výpisu nechodí do databáze.
let _prices = { at: 0, map: {} };
async function prices() {
  if (Date.now() - _prices.at < 60e3) return _prices.map;
  const m = {};
  try {
    const rows = await prisma.gamePrice.findMany();
    rows.forEach((r) => { m[r.kind] = r; });
  } catch (e) { console.warn('[game] ceník:', e.message); }
  _prices = { at: Date.now(), map: m };
  return m;
}
function dropPrices() { _prices = { at: 0, map: {} }; }
// Položka s cenou podle ceníku; vrátí null, když je vypnutá.
async function item(kind) {
  const base = ALL[kind]; if (!base) return null;
  const p = (await prices())[kind];
  if (p && p.active === false) return null;
  if (!p) return base;
  return Object.assign({}, base, { price: p.price, laundry: p.laundry != null ? p.laundry : base.laundry, name: p.name || base.name });
}
async function activeKinds(list) {
  const out = [];
  for (const k of list) { if (await item(k)) out.push(k); }
  return out;
}
// Kolik laundrů za korunu — ať hráč vidí, že se větší balík vyplatí.
const perCzk = (c) => Math.round(c.laundry / (c.price / 100));
async function cashPublic() {
  const out = [];
  const zaklad = await item('cash100');
  for (const k of CASH_KINDS) {
    const c = await item(k); if (!c) continue;
    out.push({ kind: c.kind, name: c.name, price_czk: c.price / 100, laundry: c.laundry, per_czk: perCzk(c),
      bonus: zaklad ? Math.round((perCzk(c) / perCzk(zaklad) - 1) * 100) : 0 });
  }
  return out;
}
async function catalogPublic() {
  const out = [];
  for (const k of CARD_KINDS) {
    const c = await item(k); if (!c) continue;
    out.push({ kind: c.kind, name: c.name, icon: c.icon, short: c.short, desc: c.desc, price_czk: c.price / 100 });
  }
  return out;
}

// ─── Token ───────────────────────────────────────────────────────────────────
function sign(p) { return jwt.sign({ pid: p.id, v: p.token_version }, JWT_SECRET, { expiresIn: TOKEN_DAYS + 'd', audience: 'lm-game' }); }
function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_DAYS * 86400e3, path: '/'
  });
}
async function currentPlayer(req) {
  const t = (req.cookies || {})[COOKIE];
  if (!t) return null;
  let d; try { d = jwt.verify(t, JWT_SECRET, { audience: 'lm-game' }); } catch (e) { return null; }
  const p = await prisma.gamePlayer.findUnique({ where: { id: d.pid } });
  if (!p || p.disabled || p.token_version !== d.v) return null;
  return p;
}
function requirePlayer(req, res, next) {
  currentPlayer(req).then((p) => {
    if (!p) return res.status(401).json({ error: 'Nejsi přihlášený.' });
    req.player = p; next();
  }).catch(next);
}

// Co o sobě hráč vidí. Heslo ani interní pole ven nejdou.
async function pub(p) {
  const cards = await prisma.gameCard.findMany({
    where: { player_id: p.id, used_at: null },
    select: { kind: true }
  });
  const counts = {};
  CARD_KINDS.concat(CASH_KINDS).concat([CASH_CUSTOM]).forEach((k) => { counts[k] = 0; });
  cards.forEach((c) => { if (counts[c.kind] != null) counts[c.kind]++; });
  return {
    nick: p.nick, company: p.company || (p.nick + ' s.r.o.'), email: p.email || null,
    first_name: p.first_name || null, last_name: p.last_name || null,
    has_details: !!(p.email && p.first_name && p.last_name),
    cards: counts, state_at: p.state_at
  };
}

// ─── Registrace ──────────────────────────────────────────────────────────────
// POST /account/register { nick, password } → { ok, player }
router.post('/account/register', async (req, res, next) => {
  try {
    if (rateLimited('reg:' + ipOf(req), 10, 3600e3)) return res.status(429).json({ error: 'Moc pokusů. Zkus to za chvíli.' });
    const nick = s((req.body || {}).nick, 24);
    const pwd = String((req.body || {}).password || '');
    if (!NICK_RE.test(nick)) return res.status(400).json({ error: 'Nick musí mít 3–24 znaků (písmena, číslice, tečka, pomlčka, podtržítko).' });
    if (pwd.length < 6) return res.status(400).json({ error: 'Heslo musí mít aspoň 6 znaků.' });
    if (pwd.length > 200) return res.status(400).json({ error: 'Heslo je příliš dlouhé.' });
    const lower = nick.toLowerCase();
    const taken = await prisma.gamePlayer.findUnique({ where: { nick_lower: lower }, select: { id: true } });
    if (taken) return res.status(409).json({ error: 'Tenhle nick už někdo má. Vymysli jiný.' });
    const p = await prisma.gamePlayer.create({
      data: { nick, nick_lower: lower, company: firmaNebo(s((req.body || {}).company, 60), nick),
        password_hash: await bcrypt.hash(pwd, 10), last_login_at: new Date() }
    });
    // Dárek do začátku: jedna od každé zrychlující karty. Dostane ho jen nový
    // účet — ne ten, kdo si hru resetuje, jinak by si karty takhle „vyráběl".
    try {
      await prisma.gameCard.createMany({ data: CARD_KINDS.map((k) => ({ player_id: p.id, kind: k })) });
    } catch (e) { console.warn('[game] uvítací karty:', e.message); }
    setCookie(res, sign(p));
    res.json({ ok: true, player: await pub(p) });
  } catch (e) {
    if (e && e.code === 'P2002') return res.status(409).json({ error: 'Tenhle nick už někdo má. Vymysli jiný.' });
    next(e);
  }
});

// GET /account/nick-free?nick=… → { free }
router.get('/account/nick-free', async (req, res, next) => {
  try {
    const nick = s(req.query.nick, 24);
    if (!NICK_RE.test(nick)) return res.json({ free: false, reason: 'format' });
    const t = await prisma.gamePlayer.findUnique({ where: { nick_lower: nick.toLowerCase() }, select: { id: true } });
    res.json({ free: !t });
  } catch (e) { next(e); }
});

// POST /account/login { nick, password }
router.post('/account/login', async (req, res, next) => {
  try {
    if (rateLimited('log:' + ipOf(req), 20, 900e3)) return res.status(429).json({ error: 'Moc pokusů. Zkus to za chvíli.' });
    const nick = s((req.body || {}).nick, 24);
    const pwd = String((req.body || {}).password || '');
    const p = await prisma.gamePlayer.findUnique({ where: { nick_lower: nick.toLowerCase() } });
    const ok = p && !p.disabled && await bcrypt.compare(pwd, p.password_hash);
    if (!ok) return res.status(401).json({ error: 'Nick nebo heslo nesedí.' });
    await prisma.gamePlayer.update({ where: { id: p.id }, data: { last_login_at: new Date() } });
    setCookie(res, sign(p));
    res.json({ ok: true, player: await pub(p), state: p.state || null });
  } catch (e) { next(e); }
});

// POST /account/logout
router.post('/account/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

// GET /account/me → { player, state } nebo 401
router.get('/account/me', requirePlayer, async (req, res, next) => {
  try { res.json({ ok: true, player: await pub(req.player), state: req.player.state || null }); } catch (e) { next(e); }
});

// POST /account/details { email, first_name, last_name } — doplnění před nákupem
router.post('/account/details', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const email = s(b.email, 160).toLowerCase();
    const first = s(b.first_name, 60);
    const last = s(b.last_name, 60);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Zadej platný e-mail.' });
    if (first.length < 2 || last.length < 2) return res.status(400).json({ error: 'Vyplň jméno i příjmení.' });
    const p = await prisma.gamePlayer.update({
      where: { id: req.player.id }, data: { email, first_name: first, last_name: last }
    });
    res.json({ ok: true, player: await pub(p) });
  } catch (e) { next(e); }
});

// POST /account/reset — hráč začíná od nuly. Účet i zaplacené karty mu zůstávají
// (ty si koupil za skutečné peníze), ale síť, uložený stav a zabraná místa mizí.
// Bez téhle routy by se stav po obnovení stránky vrátil ze serveru.
router.post('/account/reset', requirePlayer, async (req, res, next) => {
  try {
    const gone = await prisma.gameSpotClaim.deleteMany({ where: { player_id: req.player.id } });
    await prisma.gamePlayer.update({ where: { id: req.player.id }, data: { state: null, state_at: null } });
    res.json({ ok: true, released: gone.count });
  } catch (e) { next(e); }
});

// POST /account/company { company } — přejmenování firmy
router.post('/account/company', requirePlayer, async (req, res, next) => {
  try {
    const f = s((req.body || {}).company, 60);
    if (!FIRMA_RE.test(f)) return res.status(400).json({ error: 'Název firmy má 2–60 znaků, bez divokých symbolů.' });
    const p = await prisma.gamePlayer.update({ where: { id: req.player.id }, data: { company: f } });
    dropZeb();   // žebříček drží 30 s v paměti, po přejmenování ho zahodíme
    res.json({ ok: true, player: await pub(p) });
  } catch (e) { next(e); }
});

// ─── Stav hry ────────────────────────────────────────────────────────────────
// PUT /account/state { state } — klient posílá celý stav, server ho jen uloží.
// Simulace běží v prohlížeči; server je úložiště, ne rozhodčí. Jediné, co se
// podvrhnout nedá, jsou karty — ty žijí ve vlastní tabulce.
router.put('/account/state', requirePlayer, async (req, res, next) => {
  try {
    const st = (req.body || {}).state;
    if (!st || typeof st !== 'object') return res.status(400).json({ error: 'Chybí stav.' });
    if (JSON.stringify(st).length > 400000) return res.status(413).json({ error: 'Stav hry je moc velký.' });
    await prisma.gamePlayer.update({ where: { id: req.player.id }, data: { state: st, state_at: new Date() } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─── Karty ───────────────────────────────────────────────────────────────────
// GET /cards → katalog + co hráč vlastní
router.get('/cards', async (req, res, next) => {
  try {
    const p = await currentPlayer(req);
    res.json({
      ok: true, catalog: await catalogPublic(), cash: await cashPublic(),
      payments: require('./game-stripe.routes')._paymentsOn(),
      owned: p ? (await pub(p)).cards : null
    });
  } catch (e) { next(e); }
});

// POST /cards/use { kind, on } → spotřebuje jeden kus a vrátí, co má klient udělat.
// Efekt popisuje server, aby šlo číslo kdykoli změnit bez nasazení nové hry.
const EFFECTS = {
  rush: () => ({ effect: 'rush', msg: 'Stroj dorazil okamžitě.' }),
  traffic: () => ({ effect: 'traffic', add: 0.15, msg: 'Kampaň běží — chodí ti o 15 % víc lidí.' }),
  connect: () => ({ effect: 'connect', discount: 0.4, msg: 'Přípojky na dalším místě budou o 40 % levnější.' }),
  credit: () => ({ effect: 'credit', rate_drop: 0.02, room_add: 1000000, msg: 'Banka ti snížila úrok a zvedla rámec.' })
};
router.post('/cards/use', requirePlayer, async (req, res, next) => {
  try {
    const kind = s((req.body || {}).kind, 24);
    if (!ALL[kind] && kind !== CASH_CUSTOM) return res.status(400).json({ error: 'Taková karta není.' });
    const card = await prisma.gameCard.findFirst({
      where: { player_id: req.player.id, kind, used_at: null }, orderBy: { id: 'asc' }, select: { id: true, amount: true }
    });
    if (!card) return res.status(409).json({ error: 'Tuhle kartu nemáš.' });
    // updateMany s podmínkou used_at: null — dvojklik ani dvě záložky kartu nespotřebují dvakrát
    const done = await prisma.gameCard.updateMany({
      where: { id: card.id, used_at: null },
      data: { used_at: new Date(), used_on: s((req.body || {}).on, 80) || null }
    });
    if (!done.count) return res.status(409).json({ error: 'Karta už byla použitá.' });
    let result;
    if (kind === CASH_CUSTOM) {
      const castka = Math.max(0, card.amount || 0);
      result = { effect: 'cash', amount: castka, msg: 'Na účet ti přistálo ' + castka.toLocaleString('cs-CZ') + ' L$.' };
    } else if (CASH[kind]) {
      const c = await item(kind);
      const castka = (c && c.laundry) || CASH[kind].laundry;
      result = { effect: 'cash', amount: castka, msg: 'Na účet ti přistálo ' + castka.toLocaleString('cs-CZ') + ' L$.' };
    } else {
      result = EFFECTS[kind]();
    }
    res.json({ ok: true, card: kind, result, owned: (await pub(req.player)).cards });
  } catch (e) { next(e); }
});


// ─── Žebříčky ────────────────────────────────────────────────────────────────
// Tři pohledy: kdo má nejvíc prádlomatů (to ví server jistě, z obsazených míst),
// kdo nejvíc vydělává a kdo nejvíc pozval. Zisk a pozvánky čteme z uloženého
// stavu, který píše prohlížeč hráče — ber je jako hlášené, ne ověřené.
const ZEB_TOP = 25;
// Zábor si drží jen nick; firmu dotahujeme až při čtení, aby se přejmenování
// projevilo všude najednou a nemuselo se přepisovat do každé řádky.
async function firmyMapa() {
  const m = {};
  (await prisma.gamePlayer.findMany({ select: { id: true, company: true, nick: true } }))
    .forEach((h) => { m[h.id] = h.company || (h.nick + ' s.r.o.'); });
  return m;
}
let _zeb = { at: 0, data: null };
function dropZeb() { _zeb = { at: 0, data: null }; }
async function zebricky() {
  if (Date.now() - _zeb.at < 30e3 && _zeb.data) return _zeb.data;
  const [mista, hraci] = await Promise.all([
    prisma.gameSpotClaim.groupBy({ by: ['player_id', 'nick'], _count: { _all: true } }),
    prisma.gamePlayer.findMany({
      where: { disabled: false, state: { not: null } },
      orderBy: { state_at: 'desc' }, take: 500,
      select: { id: true, nick: true, company: true, state: true },
    }),
  ]);
  // Firmy doplníme k nickům z míst — v žebříčku chceme vidět, kdo je kdo.
  const firmy = await firmyMapa();
  const poMistech = mista.map((m) => ({ id: m.player_id, nick: m.nick, firma: firmy[m.player_id], hodnota: m._count._all }))
    .sort((a, b) => b.hodnota - a.hodnota);

  const zisk = [], pozvanky = [];
  hraci.forEach((h) => {
    const st = h.state || {};
    const units = Array.isArray(st.units) ? st.units : [];
    const mesicne = units.reduce((a, u) => a + ((u.eco && u.eco.profit) || 0), 0);
    const fi = h.company || (h.nick + ' s.r.o.');
    if (mesicne > 0) zisk.push({ id: h.id, nick: h.nick, firma: fi, hodnota: Math.round(mesicne) });
    if (st.refs > 0) pozvanky.push({ id: h.id, nick: h.nick, firma: fi, hodnota: st.refs });
  });
  zisk.sort((a, b) => b.hodnota - a.hodnota);
  pozvanky.sort((a, b) => b.hodnota - a.hodnota);

  _zeb = { at: Date.now(), data: { pradlomaty: poMistech, zisk, pozvanky } };
  return _zeb.data;
}
// Moje příčka — ať ji hráč vidí, i když do první pětadvacítky nedosáhne.
function moje(list, id) {
  const i = list.findIndex((x) => x.id === id);
  return i < 0 ? null : { poradi: i + 1, hodnota: list[i].hodnota, z: list.length };
}
router.get('/leaderboard', async (req, res, next) => {
  try {
    const p = await currentPlayer(req);
    const z = await zebricky();
    const orez = (l) => l.slice(0, ZEB_TOP).map((x, i) => ({ poradi: i + 1, nick: x.nick,
      firma: x.firma || (x.nick + ' s.r.o.'), hodnota: x.hodnota, ja: !!(p && x.id === p.id) }));
    res.json({ ok: true,
      pradlomaty: orez(z.pradlomaty), zisk: orez(z.zisk), pozvanky: orez(z.pozvanky),
      ja: p ? { pradlomaty: moje(z.pradlomaty, p.id), zisk: moje(z.zisk, p.id), pozvanky: moje(z.pozvanky, p.id) } : null,
      hracu: z.pradlomaty.length });
  } catch (e) { next(e); }
});

// ─── Místa: kdo kde stojí ────────────────────────────────────────────────────
// Na jednom místě smí stát jediný prádlomat. Kdo chce cizí, musí majiteli
// pozemku nabídnout vyšší nájem — a protože výše nájmu je tajná, přihazuje
// naslepo. Neúspěšné vyjednávání ho stojí poplatek (odečte si ho klient).
//
// Tahle tabulka je jediná pravda o tom, kdo kde stojí. Hotovost a síť si hráč
// drží v prohlížeči, ale místo mu nikdo nevezme ani nepodvrhne.
const TAKEOVER_MIN = 1.2;   // nabídka musí být aspoň o pětinu vyšší
const BID_FEE = 5000;       // co stojí neúspěšné vyjednávání (informativní, strhne klient)

const claimPub = (c, me, firmy) => ({
  spot_id: c.spot_id, area_key: c.area_key, nick: c.nick,
  firma: (firmy && firmy[c.player_id]) || (c.nick + ' s.r.o.'),
  model: c.model, mine: c.player_id === me,
  takeovers: c.takeovers, name: c.name, lat: c.lat, lon: c.lon,
  // Nájem říkáme jen majiteli. Ostatní přihazují naslepo — v tom je to riziko.
  rent: c.player_id === me ? c.rent : null,
  since: c.created_at,
});

// GET /spots → kdo kde stojí. Bez parametru vrátí VŠECHNY zábory: hráč má na
// mapě vidět konkurenci i ve městech, která sám neprozkoumal — jinak by na ni
// narazil až náhodou. Volná místa zůstávají schovaná, ta se musí najít.
router.get('/spots', async (req, res, next) => {
  try {
    const p = await currentPlayer(req);
    const areas = String(req.query.area || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 40);
    const rows = await prisma.gameSpotClaim.findMany({
      where: areas.length ? { area_key: { in: areas } } : {},
      orderBy: { updated_at: 'desc' }, take: 2000,
    });
    const firmy = await firmyMapa();
    res.json({ ok: true, min_bid: TAKEOVER_MIN, fee: BID_FEE, spots: rows.map((c) => claimPub(c, p ? p.id : 0, firmy)) });
  } catch (e) { next(e); }
});

// GET /spots/mine → vlastní místa (klient podle nich pozná, o které přišel)
router.get('/spots/mine', requirePlayer, async (req, res, next) => {
  try {
    const rows = await prisma.gameSpotClaim.findMany({ where: { player_id: req.player.id } });
    const firmy = await firmyMapa();
    res.json({ ok: true, spots: rows.map((c) => claimPub(c, req.player.id, firmy)) });
  } catch (e) { next(e); }
});

// POST /spots/claim { spot_id, area_key, model, rent, name, lat, lon } — zabrání volného místa
router.post('/spots/claim', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120), area = s(b.area_key, 80), model = s(b.model, 10);
    const rent = Math.max(0, Math.round(Number(b.rent) || 0));
    if (!spot || !area || !model) return res.status(400).json({ error: 'Chybí místo.' });
    const taken = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (taken) {
      return res.status(409).json({
        error: taken.player_id === req.player.id ? 'Tady už stojíš.' : 'Tohle místo mezitím obsadil ' + taken.nick + '.',
        occupied: claimPub(taken, req.player.id, await firmyMapa()),
      });
    }
    const c = await prisma.gameSpotClaim.create({
      data: { spot_id: spot, area_key: area, player_id: req.player.id, nick: req.player.nick,
        model, rent, name: s(b.name, 160) || null, lat: Number(b.lat) || null, lon: Number(b.lon) || null },
    });
    res.json({ ok: true, spot: claimPub(c, req.player.id, await firmyMapa()) });
  } catch (e) {
    if (e && e.code === 'P2002') return res.status(409).json({ error: 'Tohle místo právě někdo obsadil.' });
    next(e);
  }
});

// POST /spots/bid { spot_id, rent, model } — přeplacení cizího nájmu
router.post('/spots/bid', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120);
    const offer = Math.max(0, Math.round(Number(b.rent) || 0));
    const model = s(b.model, 10);
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur) return res.status(404).json({ error: 'Tohle místo je volné — stav rovnou.' });
    if (cur.player_id === req.player.id) return res.status(409).json({ error: 'Tady stojíš ty sám.' });
    const need = Math.ceil(cur.rent * TAKEOVER_MIN);
    if (offer < need) {
      // Kolik bylo potřeba, neprozradíme — jinak by stačilo zkoušet po tisícovkách.
      return res.status(409).json({ ok: false, won: false, fee: BID_FEE, error: 'Majitel pozemku tvoji nabídku odmítl. Nájemce platí víc.' });
    }
    const upd = await prisma.gameSpotClaim.update({
      where: { spot_id: spot },
      data: { player_id: req.player.id, nick: req.player.nick, model: model || cur.model, rent: offer, takeovers: { increment: 1 } },
    });
    console.log('[game] přetažení místa:', spot, cur.nick, '→', req.player.nick, offer + ' L$');
    res.json({ ok: true, won: true, spot: claimPub(upd, req.player.id, await firmyMapa()), lost_by: cur.nick });
  } catch (e) { next(e); }
});

// POST /spots/release { spot_id } — výpověď z místa, stroj si hráč odveze
router.post('/spots/release', requirePlayer, async (req, res, next) => {
  try {
    const spot = s((req.body || {}).spot_id, 120);
    const done = await prisma.gameSpotClaim.deleteMany({ where: { spot_id: spot, player_id: req.player.id } });
    if (!done.count) return res.status(409).json({ error: 'Tohle místo ti nepatří.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports._cards = ALL;
module.exports._currentPlayer = currentPlayer;
module.exports._requirePlayer = requirePlayer;
module.exports._pub = pub;
module.exports._item = item;
module.exports._dropPrices = dropPrices;
module.exports._defaults = ALL;
module.exports._cashCustom = CASH_CUSTOM;
