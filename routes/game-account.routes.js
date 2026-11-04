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
    kind: 'connect', name: 'Známý na úřadě', icon: 'wrench', price: 7900,
    short: 'Přípojky o 40 % levněji',
    desc: 'Jednou použiješ při stavbě a zaplatíš za vodu, odpad a elektřinu výrazně míň.'
  },
  credit: {
    kind: 'credit', name: 'Lepší bankéř', icon: 'bank', price: 12900,
    short: 'Úrok −2 % a vyšší strop',
    desc: 'Přepíše ti úvěrové podmínky: sazba klesne o dva procentní body a banka ti natrvalo zvedne rámec.'
  }
};
const CARD_KINDS = Object.keys(CARDS);
const catalogPublic = () => CARD_KINDS.map((k) => {
  const c = CARDS[k];
  return { kind: c.kind, name: c.name, icon: c.icon, short: c.short, desc: c.desc, price_czk: c.price / 100 };
});

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
  CARD_KINDS.forEach((k) => { counts[k] = 0; });
  cards.forEach((c) => { if (counts[c.kind] != null) counts[c.kind]++; });
  return {
    nick: p.nick, email: p.email || null,
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
      data: { nick, nick_lower: lower, password_hash: await bcrypt.hash(pwd, 10), last_login_at: new Date() }
    });
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
      ok: true, catalog: catalogPublic(),
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
    if (!CARDS[kind]) return res.status(400).json({ error: 'Taková karta není.' });
    const card = await prisma.gameCard.findFirst({
      where: { player_id: req.player.id, kind, used_at: null }, orderBy: { id: 'asc' }, select: { id: true }
    });
    if (!card) return res.status(409).json({ error: 'Tuhle kartu nemáš.' });
    // updateMany s podmínkou used_at: null — dvojklik ani dvě záložky kartu nespotřebují dvakrát
    const done = await prisma.gameCard.updateMany({
      where: { id: card.id, used_at: null },
      data: { used_at: new Date(), used_on: s((req.body || {}).on, 80) || null }
    });
    if (!done.count) return res.status(409).json({ error: 'Karta už byla použitá.' });
    res.json({ ok: true, card: kind, result: EFFECTS[kind](), owned: (await pub(req.player)).cards });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports._cards = CARDS;
module.exports._currentPlayer = currentPlayer;
module.exports._requirePlayer = requirePlayer;
module.exports._pub = pub;
