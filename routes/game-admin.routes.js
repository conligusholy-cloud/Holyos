// =============================================================================
// Laundromats Milionář — administrace (HolyOS, sekce Soukromé)
// =============================================================================
// Přehled hráčů, objednávek, ceník a statistiky. Vidí to jen lidé, kteří mají
// přístup do soukromých sekcí (stejné pravidlo jako Best Series 2.0).
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const acct = require('./game-account.routes');

router.use(express.json({ limit: '64kb' }));
router.use(requireAuth);

// Kdo smí dovnitř: stejný okruh jako u ostatních soukromých sekcí.
function allowed(user) {
  const person = user && user.person;
  if (!person) return false;
  const ids = String(process.env.GAME_ADMIN_PERSON_IDS || process.env.BS2_ALLOWED_PERSON_IDS || '')
    .split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (ids.length) return ids.includes(person.id);
  const fn = String(person.first_name || '').trim().toLowerCase();
  const ln = String(person.last_name || '').trim().toLowerCase();
  return ln === 'holý' && (fn === 'tomáš' || fn === 'jan');
}
router.use((req, res, next) => {
  if (!allowed(req.user)) return res.status(403).json({ error: 'Do této sekce nemáš přístup.' });
  next();
});

const api = (fn) => (req, res, next) => fn(req, res).catch(next);
const den = (d) => new Date(d).toISOString().slice(0, 10);

// ─── Hráči ───────────────────────────────────────────────────────────────────
// GET /players?q=&limit= → kdo hraje, jak daleko je a kolik utratil
router.get('/players', api(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const take = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 200));
  const where = q ? {
    OR: [
      { nick: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { last_name: { contains: q, mode: 'insensitive' } },
    ],
  } : {};
  const rows = await prisma.gamePlayer.findMany({ where, orderBy: { created_at: 'desc' }, take });
  const ids = rows.map((r) => r.id);
  const [spots, cards, pays] = await Promise.all([
    prisma.gameSpotClaim.groupBy({ by: ['player_id'], where: { player_id: { in: ids } }, _count: { _all: true } }),
    prisma.gameCard.groupBy({ by: ['player_id'], where: { player_id: { in: ids } }, _count: { _all: true } }),
    prisma.gamePurchase.groupBy({ by: ['player_id'], where: { player_id: { in: ids }, status: 'paid' },
      _sum: { amount_cents: true }, _count: { _all: true } }),
  ]);
  const by = (arr) => { const m = {}; arr.forEach((x) => { m[x.player_id] = x; }); return m; };
  const S = by(spots), C = by(cards), P = by(pays);
  res.json({ ok: true, players: rows.map((p) => {
    const st = p.state || {};
    return {
      id: p.id, nick: p.nick, email: p.email,
      jmeno: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      created_at: p.created_at, last_login_at: p.last_login_at, state_at: p.state_at,
      profil: st.profile || null,
      hotovost: typeof st.cash === 'number' ? Math.round(st.cash) : null,
      uver: typeof st.loan === 'number' ? Math.round(st.loan) : null,
      pradlomatu: Array.isArray(st.units) ? st.units.length : 0,
      mest: st.areas ? Object.keys(st.areas).length : 0,
      pozvanek: st.refs || 0,
      mist: (S[p.id] && S[p.id]._count._all) || 0,
      karet: (C[p.id] && C[p.id]._count._all) || 0,
      nakupu: (P[p.id] && P[p.id]._count._all) || 0,
      utraceno: ((P[p.id] && P[p.id]._sum.amount_cents) || 0) / 100,
      disabled: p.disabled,
    };
  }) });
}));

// POST /players/:id/disabled { disabled } — zablokování účtu
router.post('/players/:id/disabled', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const off = !!(req.body || {}).disabled;
  const p = await prisma.gamePlayer.update({ where: { id },
    data: { disabled: off, token_version: { increment: off ? 1 : 0 } } });
  res.json({ ok: true, disabled: p.disabled });
}));

// GET /players/:id → detail: co hráč vlastní, co utratil, kde stojí
router.get('/players/:id', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  const [karty, nakupy, mista] = await Promise.all([
    prisma.gameCard.findMany({ where: { player_id: id }, select: { kind: true, used_at: true, purchase_id: true, amount: true } }),
    prisma.gamePurchase.findMany({ where: { player_id: id }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.gameSpotClaim.findMany({ where: { player_id: id }, select: { spot_id: true, name: true, model: true, rent: true, takeovers: true } }),
  ]);
  const def = acct._defaults;
  const cekaHotovost = karty.filter((c) => c.kind === acct._cashCustom && !c.used_at)
    .reduce((a, c) => a + (c.amount || 0), 0);
  const polozky = Object.keys(def).map((kind) => {
    const moje = karty.filter((c) => c.kind === kind);
    return {
      kind, name: def[kind].name, typ: def[kind].laundry ? 'penize' : 'karta',
      laundry: def[kind].laundry || null,
      nepouzito: moje.filter((c) => !c.used_at).length,
      pouzito: moje.filter((c) => c.used_at).length,
      darem: moje.filter((c) => !c.purchase_id).length,
    };
  });
  const st = p.state || {};
  res.json({ ok: true, player: {
    id: p.id, nick: p.nick, email: p.email,
    jmeno: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
    created_at: p.created_at, last_login_at: p.last_login_at, disabled: p.disabled,
    profil: st.profile || null,
    hotovost: typeof st.cash === 'number' ? Math.round(st.cash) : null,
    uver: typeof st.loan === 'number' ? Math.round(st.loan) : null,
    pradlomatu: Array.isArray(st.units) ? st.units.length : 0,
    pozvanek: st.refs || 0,
  }, polozky, mista, ceka_hotovost: cekaHotovost,
  nakupy: nakupy.map((o) => ({ id: o.id, kind: o.kind, qty: o.qty, castka: o.amount_cents / 100,
    status: o.status, created_at: o.created_at, paid_at: o.paid_at })) });
}));

// POST /players/:id/grant { kind, qty } — přidá balíčky zdarma
// Karta bez vazby na nákup (purchase_id = null) je dárek; podle toho se pozná.
router.post('/players/:id/grant', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const kind = String((req.body || {}).kind || '');
  const qty = Math.max(1, Math.min(50, parseInt((req.body || {}).qty, 10) || 1));
  if (!acct._defaults[kind]) return res.status(400).json({ error: 'Taková položka není.' });
  const p = await prisma.gamePlayer.findUnique({ where: { id }, select: { id: true, nick: true } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  await prisma.gameCard.createMany({ data: Array.from({ length: qty }, () => ({ player_id: id, kind })) });
  const kdo = (req.user && (req.user.displayName || req.user.username)) || 'admin';
  console.log('[game] dárek: ' + qty + '× ' + kind + ' → ' + p.nick + ' (přidal ' + kdo + ')');
  res.json({ ok: true, qty });
}));

// POST /players/:id/cash { amount } — přidá hotovost rovnou, bez balíčku.
// Peníze čekají jako nevyzvednuté a hráči se připíšou, jakmile má hru otevřenou.
router.post('/players/:id/cash', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const castka = Math.round(Number((req.body || {}).amount) || 0);
  if (!(castka > 0) || castka > 1000000000) return res.status(400).json({ error: 'Zadej částku mezi 1 a 1 000 000 000 L$.' });
  const p = await prisma.gamePlayer.findUnique({ where: { id }, select: { id: true, nick: true } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  await prisma.gameCard.create({ data: { player_id: id, kind: acct._cashCustom, amount: castka } });
  const kdo = (req.user && (req.user.displayName || req.user.username)) || 'admin';
  console.log('[game] hotovost: ' + castka.toLocaleString('cs-CZ') + ' L$ → ' + p.nick + ' (přidal ' + kdo + ')');
  res.json({ ok: true, amount: castka });
}));

// POST /players/:id/revoke { kind } — odebere jeden nepoužitý kus (když se admin ukliknul)
router.post('/players/:id/revoke', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const kind = String((req.body || {}).kind || '');
  const c = await prisma.gameCard.findFirst({ where: { player_id: id, kind, used_at: null, purchase_id: null }, orderBy: { id: 'desc' } });
  if (!c) return res.status(409).json({ error: 'Není co odebrat — zbylé kusy hráč buď zaplatil, nebo už použil.' });
  await prisma.gameCard.delete({ where: { id: c.id } });
  res.json({ ok: true });
}));

// ─── Objednávky ──────────────────────────────────────────────────────────────
router.get('/orders', api(async (req, res) => {
  const stav = String(req.query.status || '').trim();
  const take = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 200));
  const rows = await prisma.gamePurchase.findMany({
    where: stav ? { status: stav } : {},
    orderBy: { created_at: 'desc' }, take,
    include: { player: { select: { nick: true, email: true } } },
  });
  const paid = await prisma.gamePurchase.aggregate({ where: { status: 'paid' }, _sum: { amount_cents: true }, _count: { _all: true } });
  res.json({ ok: true,
    souhrn: { zaplaceno_ks: paid._count._all, zaplaceno_kc: (paid._sum.amount_cents || 0) / 100 },
    orders: rows.map((o) => ({
      id: o.id, kind: o.kind, qty: o.qty, castka: o.amount_cents / 100, status: o.status,
      nick: o.player ? o.player.nick : null, email: o.email || (o.player ? o.player.email : null),
      session: o.stripe_session, created_at: o.created_at, paid_at: o.paid_at,
    })) });
}));

// ─── Ceník ───────────────────────────────────────────────────────────────────
router.get('/prices', api(async (req, res) => {
  const def = acct._defaults;
  const rows = await prisma.gamePrice.findMany();
  const m = {}; rows.forEach((r) => { m[r.kind] = r; });
  res.json({ ok: true, prices: Object.keys(def).map((k) => {
    const d = def[k], u = m[k];
    return {
      kind: k, name: (u && u.name) || d.name,
      typ: d.laundry ? 'penize' : 'karta',
      price_czk: (u ? u.price : d.price) / 100,
      vychozi_czk: d.price / 100,
      laundry: u && u.laundry != null ? u.laundry : (d.laundry || null),
      vychozi_laundry: d.laundry || null,
      active: u ? u.active : true,
      zmeneno: u ? u.updated_at : null, kdo: u ? u.updated_by : null,
    };
  }) });
}));

// POST /prices { kind, price_czk, laundry, active }
router.post('/prices', api(async (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || '');
  const def = acct._defaults[kind];
  if (!def) return res.status(400).json({ error: 'Taková položka není.' });
  const czk = Number(b.price_czk);
  if (!Number.isFinite(czk) || czk < 1 || czk > 100000) return res.status(400).json({ error: 'Cena musí být mezi 1 a 100 000 Kč.' });
  const laundry = def.laundry != null ? Math.max(1, Math.round(Number(b.laundry) || def.laundry)) : null;
  const kdo = (req.user && (req.user.displayName || req.user.username)) || null;
  const data = { price: Math.round(czk * 100), laundry, active: b.active !== false, updated_by: kdo, name: def.name };
  await prisma.gamePrice.upsert({ where: { kind }, create: Object.assign({ kind }, data), update: data });
  acct._dropPrices();   // ať se změna projeví hned, ne až vyprší minutová paměť
  res.json({ ok: true });
}));

// ─── Statistiky ──────────────────────────────────────────────────────────────
// GET /stats?dny=30 → návštěvy, registrace, tržby a trychtýř
router.get('/stats', api(async (req, res) => {
  const dny = Math.min(180, Math.max(7, parseInt(req.query.dny, 10) || 30));
  const od = new Date(Date.now() - dny * 86400e3);

  const [hraci, nakupy, udalosti, mista, celkem] = await Promise.all([
    prisma.gamePlayer.findMany({ where: { created_at: { gte: od } }, select: { created_at: true } }),
    prisma.gamePurchase.findMany({ where: { status: 'paid', paid_at: { gte: od } }, select: { paid_at: true, amount_cents: true, kind: true } }),
    prisma.compounderEvent.findMany({ where: { created_at: { gte: od }, event: { startsWith: 'game_' } },
      select: { created_at: true, event: true, sid: true } }),
    prisma.gameSpotClaim.count(),
    prisma.gamePlayer.count(),
  ]);

  const dni = {};
  for (let i = 0; i < dny; i++) dni[den(Date.now() - i * 86400e3)] = { den: den(Date.now() - i * 86400e3), navstev: 0, registraci: 0, trzba: 0 };
  const navstevnici = {};
  udalosti.forEach((e) => {
    const d = den(e.created_at);
    if (e.event === 'game_open' && dni[d]) {
      const k = d + '|' + e.sid;
      if (!navstevnici[k]) { navstevnici[k] = 1; dni[d].navstev++; }
    }
  });
  hraci.forEach((h) => { const d = den(h.created_at); if (dni[d]) dni[d].registraci++; });
  nakupy.forEach((n) => { const d = den(n.paid_at); if (dni[d]) dni[d].trzba += n.amount_cents / 100; });

  // Trychtýř: kolik lidí hru otevřelo a kolik jich došlo dál.
  const sidy = new Set(udalosti.filter((e) => e.event === 'game_open').map((e) => e.sid));
  const krok = (ev) => new Set(udalosti.filter((e) => e.event === ev).map((e) => e.sid)).size;
  const trzbaCelkem = nakupy.reduce((a, n) => a + n.amount_cents / 100, 0);
  const podleDruhu = {};
  nakupy.forEach((n) => { podleDruhu[n.kind] = (podleDruhu[n.kind] || 0) + n.amount_cents / 100; });

  res.json({ ok: true, dny,
    souhrn: { hracu_celkem: celkem, obsazenych_mist: mista, trzba_obdobi: Math.round(trzbaCelkem), nakupu_obdobi: nakupy.length },
    trychtyr: [
      { krok: 'Otevřeli hru', pocet: sidy.size },
      { krok: 'Dokončili dotazník', pocet: krok('game_quiz') },
      { krok: 'Založili účet', pocet: krok('game_register') },
      { krok: 'Prozkoumali město', pocet: krok('game_scout') },
      { krok: 'Postavili prádlomat', pocet: krok('game_build') },
      { krok: 'Zaplatili', pocet: krok('game_paid') },
    ],
    trzba_podle_druhu: podleDruhu,
    rady: Object.values(dni).sort((a, b) => (a.den < b.den ? -1 : 1)),
  });
}));

module.exports = router;
