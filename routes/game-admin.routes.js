// =============================================================================
// Laundromat Tycoon — administrace (HolyOS, sekce Soukromé)
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
  const [spots, cards, pays, privedl, zvouci] = await Promise.all([
    prisma.gameSpotClaim.groupBy({ by: ['player_id'], where: { player_id: { in: ids } }, _count: { _all: true } }),
    prisma.gameCard.groupBy({ by: ['player_id'], where: { player_id: { in: ids } }, _count: { _all: true } }),
    prisma.gamePurchase.groupBy({ by: ['player_id'], where: { player_id: { in: ids }, status: 'paid' },
      _sum: { amount_cents: true }, _count: { _all: true } }),
    // Kolik hráčů kdo přivedl — základ pro distributorský program.
    prisma.gamePlayer.groupBy({ by: ['invited_by_id'], where: { invited_by_id: { in: ids } }, _count: { _all: true } }),
    prisma.gamePlayer.findMany({ where: { invited: { some: { id: { in: ids } } } }, select: { id: true, nick: true, company: true } }),
  ]);
  const by = (arr) => { const m = {}; arr.forEach((x) => { m[x.player_id] = x; }); return m; };
  const S = by(spots), C = by(cards), P = by(pays);
  const PRIV = {}; privedl.forEach((x) => { PRIV[x.invited_by_id] = x._count._all; });
  const ZVOU = {}; zvouci.forEach((z) => { ZVOU[z.id] = z.company || z.nick; });
  res.json({ ok: true, players: rows.map((p) => {
    const st = p.state || {};
    const units = Array.isArray(st.units) ? st.units : [];
    // Co hráči měsíčně zbyde po celých splátkách, pobočkách a četě — to samé
    // číslo, které vidí v hlavičce hry. Jinak si stěžuje, že Velín lže.
    const prijem = acct._zbydeMesicne(st);
    return {
      id: p.id, nick: p.nick, email: p.email,
      prijem: Math.round(prijem),
      jmeno: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      created_at: p.created_at, last_login_at: p.last_login_at, state_at: p.state_at,
      profil: st.profile || null,
      hotovost: typeof st.cash === 'number' ? Math.round(st.cash) : null,
      uver: typeof st.loan === 'number' ? Math.round(st.loan) : null,
      pradlomatu: units.length,
      mest: st.areas ? Object.keys(st.areas).length : 0,
      pozvanek: st.refs || 0,
      privedl: PRIV[p.id] || 0,
      privedl_me: p.invited_by_id ? (ZVOU[p.invited_by_id] || ('hráč #' + p.invited_by_id)) : null,
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

// POST /players/:id/privedl { zvouci_id } — ruční oprava sítě: kdo tohohle hráče
// do hry přivedl. Prázdné zvouci_id vazbu zruší. Provize za už koupené stroje
// pak zvoucímu doběhnou samy, až otevře záložku Já.
router.post('/players/:id/privedl', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const zvouciId = parseInt((req.body || {}).zvouci_id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  if (!Number.isFinite(zvouciId)) {
    await prisma.gamePlayer.update({ where: { id }, data: { invited_by_id: null } });
    return res.json({ ok: true, privedl_me: null });
  }
  if (zvouciId === id) return res.status(400).json({ error: 'Hráč nemůže přivést sám sebe.' });
  const z = await prisma.gamePlayer.findUnique({ where: { id: zvouciId },
    select: { id: true, nick: true, company: true } });
  if (!z) return res.status(404).json({ error: 'Zvoucí hráč nenalezen.' });
  // Kruh by rozbil počítání sítě — zvoucí nesmí být někým, koho přivedl tenhle hráč.
  let chod = z, kroku = 0;
  while (chod && chod.invited_by_id && kroku++ < 50) {
    if (chod.invited_by_id === id) return res.status(400).json({ error: 'To by udělalo kruh.' });
    chod = await prisma.gamePlayer.findUnique({ where: { id: chod.invited_by_id },
      select: { id: true, invited_by_id: true } });
  }
  await prisma.gamePlayer.update({ where: { id },
    data: { invited_by_id: z.id, invited_at: p.invited_at || new Date() } });
  res.json({ ok: true, privedl_me: { id: z.id, nick: z.nick, firma: z.company || z.nick } });
}));

// GET /nahlasene → zprávy, na které si někdo stěžoval
router.get('/nahlasene', api(async (req, res) => {
  const vse = String(req.query.vse || '') === '1';
  const rows = await prisma.gameMessage.findMany({
    where: vse ? { reported_at: { not: null } } : { reported_at: { not: null }, resolved_at: null },
    orderBy: { reported_at: 'desc' }, take: 200,
  });
  const ids = [...new Set(rows.flatMap((m) => [m.from_id, m.to_id, m.reported_by].filter(Boolean)))];
  const lide = ids.length
    ? await prisma.gamePlayer.findMany({ where: { id: { in: ids } },
        select: { id: true, nick: true, company: true, disabled: true } })
    : [];
  const kdo = new Map(lide.map((p) => [p.id, p]));
  const jm = (id) => {
    const p = kdo.get(id);
    return p ? { id: p.id, nick: p.nick, firma: p.company || (p.nick + ' s.r.o.'), disabled: p.disabled } : null;
  };
  res.json({ ok: true, zpravy: rows.map((m) => ({
    id: m.id, text: m.text, kdy: m.created_at, nahlaseno: m.reported_at, vyrizeno: m.resolved_at,
    od: jm(m.from_id), komu: jm(m.to_id), nahlasil: jm(m.reported_by),
  })) });
}));

// POST /nahlasene/:id/vyrizeno { zpet } — označí nahlášení za vyřízené
router.post('/nahlasene/:id/vyrizeno', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const zpet = !!(req.body || {}).zpet;
  await prisma.gameMessage.update({ where: { id }, data: { resolved_at: zpet ? null : new Date() } });
  res.json({ ok: true });
}));

// GET /players → pro výběr zvoucího stačí nick a firma (lehký seznam)
router.get('/players-vyber', api(async (req, res) => {
  const rows = await prisma.gamePlayer.findMany({
    where: { disabled: false }, orderBy: { nick: 'asc' },
    select: { id: true, nick: true, company: true },
  });
  res.json({ ok: true, players: rows.map((p) => ({ id: p.id, nick: p.nick,
    firma: p.company || (p.nick + ' s.r.o.') })) });
}));

// GET /players/:id → detail: co hráč vlastní, co utratil, kde stojí
router.get('/players/:id', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  const [karty, nakupy, mista, privedeni, zvouci] = await Promise.all([
    prisma.gameCard.findMany({ where: { player_id: id }, select: { kind: true, used_at: true, purchase_id: true, amount: true } }),
    prisma.gamePurchase.findMany({ where: { player_id: id }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.gameSpotClaim.findMany({ where: { player_id: id }, select: { spot_id: true, name: true, model: true, rent: true, takeovers: true } }),
    // Koho hráč přivedl, včetně toho, kolik u nás každý z nich utratil.
    prisma.gamePlayer.findMany({
      where: { invited_by_id: id }, orderBy: { created_at: 'desc' }, take: 200,
      select: { id: true, nick: true, company: true, created_at: true, invited_at: true, last_login_at: true,
        purchases: { where: { status: 'paid' }, select: { amount_cents: true } } },
    }),
    p.invited_by_id
      ? prisma.gamePlayer.findUnique({ where: { id: p.invited_by_id }, select: { id: true, nick: true, company: true } })
      : null,
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
    prijem: acct._zbydeMesicne(st),
    pozvanek: st.refs || 0,
    ref: p.ref_id || null,
    privedl_me: zvouci ? { id: zvouci.id, nick: zvouci.nick, firma: zvouci.company || zvouci.nick } : null,
  }, polozky, mista, ceka_hotovost: cekaHotovost,
  privedeni: privedeni.map((h) => ({
    id: h.id, nick: h.nick, firma: h.company || (h.nick + ' s.r.o.'),
    kdy: h.invited_at || h.created_at, posledne: h.last_login_at,
    utratil: h.purchases.reduce((a, x) => a + x.amount_cents, 0) / 100,
  })),
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
      kind: k, name: d.name,   // název je z kódu, ceník drží jen cenu
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
// ─── Provize ─────────────────────────────────────────────────────────
// GET /provize?nick=&limit= → kompletní kniha vyplacených provizí. Komu se co
// připsalo, za koho a kdy — včetně toho, jestli si to hráč už vyzvedl ve hře.
// Dorovnání po startu serveru se tu pozná podle data: je pozdější než nákup.
router.get('/provize', api(async (req, res) => {
  const nick = String(req.query.nick || '').trim().slice(0, 60);
  const take = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 200));
  const kde = { kind: 'cash', popis: { startsWith: 'Provize' } };
  if (nick) {
    const kdo = await prisma.gamePlayer.findMany({
      where: { OR: [{ nick: { contains: nick, mode: 'insensitive' } },
                    { company: { contains: nick, mode: 'insensitive' } }] },
      select: { id: true } });
    kde.player_id = { in: kdo.map((x) => x.id) };
  }
  const rows = await prisma.gameDelivery.findMany({
    where: kde, orderBy: { id: 'desc' }, take,
    select: { id: true, player_id: true, amount: true, popis: true, spot_id: true,
      created_at: true, claimed_at: true } });
  const hraci = await prisma.gamePlayer.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.player_id))] } },
    select: { id: true, nick: true, company: true, provize_celkem: true, distributor_do: true } });
  const podleId = {};
  hraci.forEach((h) => { podleId[h.id] = h; });
  const souhrn = {};
  rows.forEach((r) => {
    const h = podleId[r.player_id] || {};
    const k = h.nick || ('#' + r.player_id);
    if (!souhrn[k]) souhrn[k] = { nick: k, firma: h.firma || h.company || null, kusu: 0, castka: 0,
      nevyzvednuto: 0, provize_celkem: h.provize_celkem || 0, distributor_do: h.distributor_do || null };
    souhrn[k].kusu++;
    souhrn[k].castka += r.amount || 0;
    if (!r.claimed_at) souhrn[k].nevyzvednuto += r.amount || 0;
  });
  res.json({ ok: true, celkem: rows.length,
    souhrn: Object.keys(souhrn).map((k) => souhrn[k]).sort((a, b) => b.castka - a.castka),
    provize: rows.map((r) => {
      const h = podleId[r.player_id] || {};
      return { id: r.id, komu: h.nick || ('#' + r.player_id), firma: h.company || null,
        castka: r.amount,
        // V popisu je za pomlčkou „Kdo koupil co“ — přesně to, co chceme vidět.
        za: (String(r.popis || '').split(' \u2014 ')[1] || String(r.popis || '')).trim(),
        klic: r.spot_id || null,
        kdy: r.created_at, vyzvednuto: r.claimed_at || null };
    }) });
}));

// POST /provize/dorovnat → dopočítá a připočte všechno, co ještě nebylo vyplaceno.
// Stejná úloha, která jinak běží při startu serveru — jen se dá spustit ručně,
// když se nemá čekat na restart. Je idempotentní, opakovaný běh nic nepřiplatí.
router.post('/provize/dorovnat', api(async (req, res) => {
  const vysledek = await require('../services/game/provize').dorovnejVsem();
  res.json({ ok: true, ...vysledek });
}));

// GET /provize/kontrola → kde se počty rozcházejí. Za každýho pozvaného se
// spočítá, kolik má strojů (postavené, na cestě i skladem) a kolik provizí za něj
// zvoucí dostal. Co nesedí, je buď k dorovnání, nebo distribuce nebyla zapnutá.
router.get('/provize/kontrola', api(async (req, res) => {
  const [hraci, davky, mista] = await Promise.all([
    prisma.gamePlayer.findMany({ where: { disabled: false },
      select: { id: true, nick: true, company: true, ref_id: true, state: true,
        invited_by_id: true, invited_by_ref: true, distributor_do: true } }),
    prisma.gameDelivery.findMany({ where: { kind: 'cash', popis: { startsWith: 'Provize' } },
      select: { player_id: true, spot_id: true } }),
    prisma.gameSpotClaim.findMany({ select: { player_id: true, spot_id: true } }),
  ]);
  // Čí je které místo — starší provize mají v klíči id místa, ne id hráče.
  const majitelMista = {};
  mista.forEach((m) => { majitelMista[m.spot_id] = m.player_id; });
  const podleId = {}, podleRef = {};
  hraci.forEach((h) => { podleId[h.id] = h; if (h.ref_id) podleRef[h.ref_id] = h; });
  // Klíče provizí: „nakup:<id pozvaného>:<pořadí>“, starší jsou id místa.
  const zaplaceno = {};
  davky.forEach((d) => {
    const klic = String(d.spot_id || '');
    const m = /^nakup:(\d+):/.exec(klic);
    const za = m ? Number(m[1]) : majitelMista[klic];
    if (!za) return;
    const k = d.player_id + '|' + za;
    zaplaceno[k] = (zaplaceno[k] || 0) + 1;
  });
  const ted = new Date();
  const radky = [];
  hraci.forEach((h) => {
    const zvouci = podleId[h.invited_by_id] || podleRef[h.invited_by_ref];
    if (!zvouci || zvouci.id === h.id) return;
    const stroju = acct._strojeHrace(h.state).length;
    if (!stroju) return;
    const vyplaceno = zaplaceno[zvouci.id + '|' + h.id] || 0;
    radky.push({ pozvany: h.nick, firma: h.company || null, zvouci: zvouci.nick,
      vazba: h.invited_by_id ? 'napevno' : 'přes odkaz',
      stroju, provizi: vyplaceno, chybi: Math.max(0, stroju - vyplaceno),
      distribuce: !!(zvouci.distributor_do && new Date(zvouci.distributor_do) > ted) });
  });
  radky.sort((a, b) => b.chybi - a.chybi || a.zvouci.localeCompare(b.zvouci));
  res.json({ ok: true,
    chybi_celkem: radky.reduce((a, r) => a + (r.distribuce ? r.chybi : 0), 0),
    chybi_bez_distribuce: radky.reduce((a, r) => a + (r.distribuce ? 0 : r.chybi), 0),
    radky });
}));

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

// GET /stats/provoz → kdo je na hře právě teď. Návštěvy se poznají podle stop,
// které hra posílá (otevření a pak každých pár minut, dokud ji má hráč
// otevřenou), hráči podle toho, kdy si naposled uložili stav.
router.get('/stats/provoz', api(async (req, res) => {
  const ted = Date.now();
  const od24 = new Date(ted - 24 * 3600e3);
  const [udalosti, hraci, posledni] = await Promise.all([
    prisma.compounderEvent.findMany({
      where: { created_at: { gte: od24 }, event: { startsWith: 'game_' } },
      select: { created_at: true, event: true, sid: true } }),
    prisma.gamePlayer.findMany({
      where: { state_at: { gte: new Date(ted - 60 * 60e3) }, disabled: false },
      select: { id: true, nick: true, company: true, state_at: true } }),
    prisma.compounderEvent.findMany({
      where: { event: { startsWith: 'game_' } },
      orderBy: { created_at: 'desc' }, take: 30,
      select: { created_at: true, event: true, sid: true } }),
  ]);
  const cas = (e) => new Date(e.created_at).getTime();
  const unikat = (ms) => new Set(udalosti.filter((e) => ted - cas(e) <= ms).map((e) => e.sid)).size;
  // Po hodinách za posledních 24 hodin — ať je vidět, kdy se hraje.
  const hodiny = [];
  for (let i = 23; i >= 0; i--) {
    const konec = ted - i * 3600e3, zacatek = konec - 3600e3;
    const v = udalosti.filter((e) => cas(e) > zacatek && cas(e) <= konec);
    hodiny.push({ hodina: new Date(konec).getHours(),
      navstev: new Set(v.map((e) => e.sid)).size,
      akci: v.filter((e) => e.event !== 'game_zije').length });
  }
  const podleUdalosti = {};
  udalosti.forEach((e) => { podleUdalosti[e.event] = (podleUdalosti[e.event] || 0) + 1; });
  res.json({ ok: true, ted: new Date().toISOString(),
    ted5: unikat(6 * 60e3), hodina: unikat(3600e3), den: unikat(24 * 3600e3),
    hracu_online: hraci.filter((h) => ted - new Date(h.state_at).getTime() <= 10 * 60e3).length,
    online: hraci
      .sort((a, b) => new Date(b.state_at).getTime() - new Date(a.state_at).getTime())
      .slice(0, 25)
      .map((h) => ({ id: h.id, nick: h.nick, firma: h.company,
        pred: Math.max(0, Math.round((ted - new Date(h.state_at).getTime()) / 60000)) })),
    hodiny,
    udalosti: podleUdalosti,
    posledni: posledni.map((e) => ({ kdy: e.created_at, event: e.event, sid: String(e.sid || '').slice(0, 6) })),
  });
}));

module.exports = router;
