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
      // Odkud přišel, když ho nikdo nepozval — z reklamy, z odkazu, sám.
      zdroj: p.zdroj || null,
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
    sid: p.sid || null,
    // Záznam první minuty, jestli se k účtu najde.
    zaznam: p.sid ? await zaznamInfo(p.sid) : null,
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
    include: { player: { select: { nick: true, email: true, created_at: true } } },
  });
  const paid = await prisma.gamePurchase.aggregate({ where: { status: 'paid' }, _sum: { amount_cents: true }, _count: { _all: true } });
  res.json({ ok: true,
    souhrn: { zaplaceno_ks: paid._count._all, zaplaceno_kc: (paid._sum.amount_cents || 0) / 100 },
    orders: rows.map((o) => ({
      id: o.id, kind: o.kind, qty: o.qty, castka: o.amount_cents / 100, status: o.status,
      nick: o.player ? o.player.nick : null, registrace: o.player ? o.player.created_at : null, email: o.email || (o.player ? o.player.email : null),
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

// ─── Spojené účty ────────────────────────────────────────────────────────────
// GET /multi → skupiny účtů, které spolu nejspíš souvisí.
//
// Nic to neblokuje a hráč o tom neví. Jen to poskládá, co už víme: z jakého
// prohlížeče účet vznikl (trvalé id, které si klient nese sám), z jaké IP a
// z jaké sítě — a k tomu, kdo koho pozval a kolik na tom zvoucí vydělal.
//
// Čte se to opatrně: jedna IP neznamená podvod. Rodina u jedné wifi, kolej
// nebo mobilní síť (operátoři sdílejí jednu IP mezi stovky lidí) vypadají
// stejně. Důkaz je až spojení „stejné zařízení + jeden pozval druhého".
const IP_SIT = (ip) => {
  const x = String(ip || '');
  if (!x) return null;
  if (x.indexOf(':') >= 0) return x.split(':').slice(0, 4).join(':') + '::/64';
  const o = x.split('.');
  return o.length === 4 ? o.slice(0, 3).join('.') + '.0/24' : null;
};
router.get('/multi', api(async (req, res) => {
  const [hraci, davky, mista] = await Promise.all([
    prisma.gamePlayer.findMany({
      select: { id: true, nick: true, company: true, created_at: true, last_login_at: true,
        invited_by_id: true, invited_by_ref: true, ref_id: true, sid: true, state: true,
        dev_pid: true, reg_ip: true, reg_ua: true, zdroj: true, disabled: true,
        hra_s_celkem: true, provize_celkem: true, email: true },
      orderBy: { id: 'asc' } }),
    prisma.gameDelivery.findMany({ where: { kind: 'cash', popis: { startsWith: 'Provize' } },
      select: { player_id: true, spot_id: true, amount: true } }),
    prisma.gameSpotClaim.findMany({ select: { player_id: true, spot_id: true } }),
  ]);
  // Starší účty stopu u sebe nemají — dohledá se z první události té návštěvy.
  const sidy = hraci.filter((h) => !h.reg_ip && h.sid).map((h) => h.sid);
  const prvni = {};
  if (sidy.length) {
    const ev = await prisma.compounderEvent.findMany({
      where: { sid: { in: sidy.slice(0, 2000) } },
      select: { sid: true, ip: true, ua: true }, orderBy: { id: 'asc' }, take: 20000 });
    ev.forEach((e) => { if (!prvni[e.sid] && e.ip) prvni[e.sid] = e; });
  }
  hraci.forEach((h) => {
    const e = !h.reg_ip && h.sid ? prvni[h.sid] : null;
    h._ip = h.reg_ip || (e && e.ip) || null;
    h._ua = h.reg_ua || (e && e.ua) || null;
  });

  // Kdo koho pozval a kolik za něj zvoucí dostal.
  const podleId = {}, podleRef = {};
  hraci.forEach((h) => { podleId[h.id] = h; if (h.ref_id) podleRef[h.ref_id] = h; });
  const majitelMista = {};
  mista.forEach((m) => { majitelMista[m.spot_id] = m.player_id; });
  const provize = {};   // "zvouci|pozvany" → { kusu, castka }
  davky.forEach((d) => {
    const klic = String(d.spot_id || '');
    const m = /^nakup:(\d+):/.exec(klic);
    const za = m ? Number(m[1]) : majitelMista[klic];
    if (!za) return;
    const k = d.player_id + '|' + za;
    const z = provize[k] || (provize[k] = { kusu: 0, castka: 0 });
    z.kusu++; z.castka += Number(d.amount) || 0;
  });
  const zvouciOd = (h) => podleId[h.invited_by_id] || podleRef[h.invited_by_ref] || null;

  // Spojíme účty, které sdílí zařízení, IP nebo síť. Každé spojení si pamatuje,
  // čím vzniklo — bez toho by se „stejná mobilní síť" četla jako důkaz.
  const rodic = {};
  const najdi = (x) => { while (rodic[x] !== x) { rodic[x] = rodic[rodic[x]]; x = rodic[x]; } return x; };
  const spoj = (a, b) => { a = najdi(a); b = najdi(b); if (a !== b) rodic[b] = a; };
  hraci.forEach((h) => { rodic[h.id] = h.id; });
  const klice = { dev: {}, ip: {}, sit: {} };
  hraci.forEach((h) => {
    if (h.dev_pid) (klice.dev[h.dev_pid] = klice.dev[h.dev_pid] || []).push(h.id);
    if (h._ip) (klice.ip[h._ip] = klice.ip[h._ip] || []).push(h.id);
    const sit = IP_SIT(h._ip);
    if (sit) (klice.sit[sit] = klice.sit[sit] || []).push(h.id);
  });
  ['dev', 'ip', 'sit'].forEach((druh) => {
    Object.keys(klice[druh]).forEach((k) => {
      const l = klice[druh][k];
      for (let i = 1; i < l.length; i++) spoj(l[0], l[i]);
    });
  });
  // Pozvánka sama o sobě skupinu nedělá — jinak by v jedné skupině skončila
  // celá hra. Jen zpřísňuje hodnocení skupiny, která vznikla ze zařízení či IP.

  const skupiny = {};
  hraci.forEach((h) => {
    const k = najdi(h.id);
    (skupiny[k] = skupiny[k] || []).push(h);
  });
  const ven = [];
  Object.keys(skupiny).forEach((k) => {
    const cl = skupiny[k];
    if (cl.length < 2) return;
    const ids = {};
    cl.forEach((h) => { ids[h.id] = 1; });
    // Čím jsou spojení: stejný prohlížeč váží nejvíc, stejná síť nejmíň.
    const devy = {}, ipy = {}, site = {};
    cl.forEach((h) => {
      if (h.dev_pid) devy[h.dev_pid] = (devy[h.dev_pid] || 0) + 1;
      if (h._ip) ipy[h._ip] = (ipy[h._ip] || 0) + 1;
      const s2 = IP_SIT(h._ip); if (s2) site[s2] = (site[s2] || 0) + 1;
    });
    const sdileneZarizeni = Object.keys(devy).some((x) => devy[x] > 1);
    const sdilenaIp = Object.keys(ipy).some((x) => ipy[x] > 1);
    let uvnitrProvize = 0, uvnitrKusu = 0, pozvanihVeSkupine = 0;
    const clenove = cl.map((h) => {
      const z = zvouciOd(h);
      const vlastni = z && ids[z.id] ? 1 : 0;
      if (vlastni) pozvanihVeSkupine++;
      const pr = z ? (provize[z.id + '|' + h.id] || null) : null;
      if (vlastni && pr) { uvnitrProvize += pr.castka; uvnitrKusu += pr.kusu; }
      return {
        id: h.id, nick: h.nick, firma: h.company || null, zalozeno: h.created_at,
        naposledy: h.last_login_at, odehrano_s: h.hra_s_celkem || 0,
        stroju: acct._strojeHrace(h.state).length,
        pozval: z ? z.nick : null, pozval_ze_skupiny: !!vlastni,
        provize_za_nej: pr ? pr.castka : 0, provizi_kusu: pr ? pr.kusu : 0,
        zdroj: h.zdroj || null, ma_email: !!h.email, zablokovan: !!h.disabled,
        zarizeni: h.dev_pid || null, ip: h._ip || null, sit: IP_SIT(h._ip),
        prohlizec: (h._ua || '').slice(0, 120) || null,
      };
    });
    clenove.sort((a, b) => new Date(a.zalozeno) - new Date(b.zalozeno));
    const casy = clenove.map((c) => new Date(c.zalozeno).getTime());
    const rozpeti = Math.max(0, Math.max.apply(null, casy) - Math.min.apply(null, casy));
    // Hodnocení. Samotná sdílená síť je slabá stopa, teprve pozvánka uvnitř
    // skupiny z toho dělá něco, co stojí za pohled.
    let uroven = 'nizka', proc = [];
    if (sdileneZarizeni) proc.push('stejný prohlížeč');
    else if (sdilenaIp) proc.push('stejná IP');
    else proc.push('stejná síť');
    if (pozvanihVeSkupine) proc.push('pozvánka uvnitř skupiny');
    if (uvnitrProvize) proc.push('provize uvnitř skupiny');
    if (rozpeti && rozpeti < 2 * 3600e3) proc.push('účty vznikly do dvou hodin po sobě');
    if (clenove.some((c) => c.odehrano_s < 300 && c.stroju > 0)) proc.push('stroj po pár minutách hry');
    if (pozvanihVeSkupine && (sdileneZarizeni || sdilenaIp)) uroven = 'vysoka';
    else if (pozvanihVeSkupine || sdileneZarizeni) uroven = 'stredni';
    ven.push({ uroven, proc, clenu: clenove.length, pozvanych_uvnitr: pozvanihVeSkupine,
      provize_uvnitr: uvnitrProvize, provizi_kusu: uvnitrKusu,
      rozpeti_minut: Math.round(rozpeti / 60000),
      zarizeni_sdilene: sdileneZarizeni, ip_sdilena: sdilenaIp, clenove });
  });
  const vaha = { vysoka: 3, stredni: 2, nizka: 1 };
  ven.sort((a, b) => vaha[b.uroven] - vaha[a.uroven] || b.provize_uvnitr - a.provize_uvnitr || b.clenu - a.clenu);
  res.json({ ok: true, skupin: ven.length,
    bez_stopy: hraci.filter((h) => !h._ip && !h.dev_pid).length,
    hracu: hraci.length, skupiny: ven });
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

  // Retence: vrátil se hráč den po registraci? A po týdnu? Bereme to podle
  // toho, kdy si naposledy uložil stav — hra ukládá průběžně, takže „poslední
  // uložení" je spolehlivá stopa toho, dokdy hrál.
  const vsichni = await prisma.gamePlayer.findMany({
    where: { disabled: false }, select: { created_at: true, state_at: true } });
  const zil = (h, dnu) => h.state_at
    && new Date(h.state_at).getTime() - new Date(h.created_at).getTime() >= dnu * 86400e3;
  const tydny = {};
  vsichni.forEach((h) => {
    const t = new Date(h.created_at);
    const pon = new Date(t.getTime() - ((t.getDay() + 6) % 7) * 86400e3);
    const k = den(pon);
    const r = tydny[k] || (tydny[k] = { tyden: k, registraci: 0, d1: 0, d7: 0 });
    r.registraci++;
    if (zil(h, 1)) r.d1++;
    if (zil(h, 7)) r.d7++;
  });
  const retence = {
    registraci: vsichni.length,
    d1: vsichni.filter((h) => zil(h, 1)).length,
    d7: vsichni.filter((h) => zil(h, 7)).length,
    cohorty: Object.values(tydny).sort((a, b) => (a.tyden < b.tyden ? 1 : -1)).slice(0, 8),
  };

  res.json({ ok: true, dny, retence,
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

// GET /stats/reklama?dny=30[&funnel=<id>] → po dnech: kolik šlo do reklamy (Meta, kampaně napojené na funnel
// „Tycoon" v Centru reklamy) a kolik lidé ve hře zaplatili → zisk / ztráta. Tržba je bez DPH (21 %).
router.get('/stats/reklama', api(async (req, res) => {
  const dk = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const isD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  // Období: ?od=YYYY-MM-DD&do=YYYY-MM-DD (max 366 dní), jinak posledních ?dny dní
  let odK, doK;
  if (isD(req.query.od) && isD(req.query.do) && req.query.od <= req.query.do) { odK = req.query.od; doK = req.query.do; }
  else { const n = Math.min(180, Math.max(1, parseInt(req.query.dny, 10) || 30)); doK = dk(Date.now()); odK = dk(Date.now() - (n - 1) * 86400e3); }
  const dni = {}; const seznam = [];
  for (let t = new Date(odK + 'T12:00:00Z'); ; t = new Date(t.getTime() + 86400e3)) {
    const k = t.toISOString().slice(0, 10); if (k > doK || seznam.length >= 366) break;
    dni[k] = { den: k, vydaj: 0, zobrazeni: 0, kliky: 0, registraci: 0, trzba: 0, nakupu: 0 }; seznam.push(k);
  }
  const dny = seznam.length;
  const od = new Date(new Date(odK + 'T00:00:00Z').getTime() - 86400e3), dok = new Date(new Date(doK + 'T00:00:00Z').getTime() + 2 * 86400e3);
  const [nakupy, hraci] = await Promise.all([
    prisma.gamePurchase.findMany({ where: { status: 'paid', paid_at: { gte: od, lt: dok } }, select: { paid_at: true, amount_cents: true } }),
    prisma.gamePlayer.findMany({ where: { created_at: { gte: od, lt: dok } }, select: { created_at: true } }),
  ]);
  nakupy.forEach((n) => { const r = dni[dk(n.paid_at)]; if (r) { r.trzba += n.amount_cents / 100 / 1.21; r.nakupu++; } });
  hraci.forEach((h) => { const r = dni[dk(h.created_at)]; if (r) r.registraci++; });

  const ads = require('./ads-center.routes');
  let funnel = null, kampane = [], chyba = null;
  try {
    const fl = await ads.loadFunnels();
    funnel = (req.query.funnel && fl.find((f) => String(f.id) === String(req.query.funnel)))
      || fl.find((f) => /tycoon|game/i.test(String(f.name || f.title || '')));
    if (!funnel) chyba = 'V Centru reklamy jsem nenašel funnel „Tycoon" — výdaje na reklamu nejsou k dispozici.';
    else {
      const starts = (funnel.nodes || []).filter((n) => n.kind === 'start' && n.meta && n.meta.campaign && n.meta.campaign.id);
      const c = await ads.metaCfg(req);
      if (!c.token) chyba = 'Meta Ads není napojená (Centrum reklamy → Nastavení).';
      else if (!starts.length) chyba = 'Startovní bod funnelu nemá napojenou kampaň.';
      else {
        const tr = JSON.stringify({ since: odK, until: doK });
        for (const nd of starts) {
          const id = String(nd.meta.campaign.id).replace(/[^0-9]/g, '');
          try {
            const j = await ads.metaGraph(id + '/insights', { fields: 'spend,impressions,inline_link_clicks', time_increment: 1, time_range: tr, limit: 500 }, c.token);
            (j.data || []).forEach((r) => { const x = dni[r.date_start]; if (x) { x.vydaj += Number(r.spend || 0); x.zobrazeni += Number(r.impressions || 0); x.kliky += Number(r.inline_link_clicks || 0); } });
            kampane.push(nd.meta.campaign.name || id);
          } catch (e) { chyba = 'Meta: ' + e.message; }
        }
      }
    }
  } catch (e) { chyba = 'Reklamu se nepodařilo načíst: ' + e.message; }

  let kum = 0;
  const R2 = (n) => Math.round(n * 100) / 100;
  const rady = Object.values(dni).sort((a, b) => (a.den < b.den ? -1 : 1)).map((r) => {
    const zisk = r.trzba - r.vydaj; kum += zisk;
    return { den: r.den, vydaj: R2(r.vydaj), zobrazeni: r.zobrazeni, kliky: r.kliky, registraci: r.registraci, trzba: R2(r.trzba), nakupu: r.nakupu, zisk: R2(zisk), kumulativne: R2(kum) };
  });
  const sum = rady.reduce((a, r) => ({ vydaj: a.vydaj + r.vydaj, trzba: a.trzba + r.trzba, reg: a.reg + r.registraci, nak: a.nak + r.nakupu, kl: a.kl + r.kliky }), { vydaj: 0, trzba: 0, reg: 0, nak: 0, kl: 0 });
  const plus = rady.filter((r) => r.zisk > 0).length, minus = rady.filter((r) => r.zisk < 0).length;
  res.json({ ok: true, dny, od: odK, do: doK, funnel: funnel ? { id: funnel.id, name: funnel.name || funnel.title } : null, kampane, chyba, rady,
    souhrn: { vydaj: Math.round(sum.vydaj), trzba: Math.round(sum.trzba), zisk: Math.round(sum.trzba - sum.vydaj), roas: sum.vydaj > 0 ? R2(sum.trzba / sum.vydaj) : null,
      dnu_plus: plus, dnu_minus: minus, registraci: sum.reg, nakupu: sum.nak, kliku: sum.kl,
      cena_registrace: sum.reg ? R2(sum.vydaj / sum.reg) : null, cena_nakupu: sum.nak ? R2(sum.vydaj / sum.nak) : null } });
}));

// GET /stats/provoz → kdo je na hře právě teď. Návštěvy se poznají podle stop,
// které hra posílá (otevření a pak každých pár minut, dokud ji má hráč
// otevřenou), hráči podle toho, kdy si naposled uložili stav.
router.get('/stats/provoz', api(async (req, res) => {
  const ted = Date.now();
  const od24 = new Date(ted - 24 * 3600e3);
  const [udalosti, hraci, posledni, casy] = await Promise.all([
    prisma.compounderEvent.findMany({
      where: { created_at: { gte: od24 }, event: { startsWith: 'game_' } },
      select: { created_at: true, event: true, sid: true } }),
    prisma.gamePlayer.findMany({
      where: { state_at: { gte: new Date(ted - 60 * 60e3) }, disabled: false },
      select: { id: true, nick: true, company: true, state_at: true, created_at: true } }),
    prisma.compounderEvent.findMany({
      where: { event: { startsWith: 'game_' } },
      orderBy: { created_at: 'desc' }, take: 30,
      select: { created_at: true, event: true, sid: true } }),
    // Čas ve hře: server ho sčítá hráčům při ukládání stavu.
    prisma.gamePlayer.findMany({
      where: { disabled: false, hra_s_celkem: { gt: 0 } },
      orderBy: { hra_s_celkem: 'desc' }, take: 50,
      select: { id: true, nick: true, company: true, hra_s_den: true, hra_s_celkem: true,
        hra_den: true, hra_at: true, created_at: true } }),
  ]);
  const dnesek = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const casyVen = casy.map((h) => ({
    id: h.id, nick: h.nick, firma: h.company,
    dnes: h.hra_den === dnesek ? (h.hra_s_den || 0) : 0,
    celkem: h.hra_s_celkem || 0,
    dni: Math.max(1, Math.round((ted - new Date(h.created_at).getTime()) / 86400e3)),
    naposled: h.hra_at,
    zalozeno: h.created_at,
  }));
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
        pred: Math.max(0, Math.round((ted - new Date(h.state_at).getTime()) / 60000)), zalozeno: h.created_at })),
    hodiny,
    casy: casyVen.slice().sort((a, b) => (b.dnes - a.dnes) || (b.celkem - a.celkem)),
    cas_souhrn: {
      dnes: casyVen.reduce((a, h) => a + h.dnes, 0),
      celkem: casyVen.reduce((a, h) => a + h.celkem, 0),
      hracu_dnes: casyVen.filter((h) => h.dnes > 0).length,
    },
    udalosti: podleUdalosti,
    posledni: posledni.map((e) => ({ kdy: e.created_at, event: e.event, sid: String(e.sid || '').slice(0, 6) })),
  });
}));

// ─── Záznamy první minuty ────────────────────────────────────────────────────
// Z první návštěvy se nahrává prvních šedesát vteřin dění na stránce. Tady se
// to jen čte: seznam záznamů a pak všechny části jednoho záznamu za sebou.
async function zaznamInfo(sid) {
  const casti = await prisma.gameReplay.findMany({
    where: { sid }, orderBy: { poradi: 'asc' },
    select: { poradi: true, ms: true, bajtu: true, created_at: true } });
  if (!casti.length) return null;
  return { sid, casti: casti.length, ms: Math.max.apply(null, casti.map((c) => c.ms || 0)),
    bajtu: casti.reduce((a, c) => a + (c.bajtu || 0), 0), kdy: casti[0].created_at };
}

// GET /zaznamy → poslední nahrané první minuty, i od návštěvníků bez účtu.
router.get('/zaznamy', api(async (req, res) => {
  const take = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 40));
  const prvni = await prisma.gameReplay.findMany({
    where: { poradi: 0 }, orderBy: { created_at: 'desc' }, take,
    select: { sid: true, created_at: true, ua: true, zdroj: true } });
  const sidy = prvni.map((r) => r.sid);
  const [casti, hraci] = await Promise.all([
    prisma.gameReplay.findMany({ where: { sid: { in: sidy } },
      select: { sid: true, ms: true, bajtu: true } }),
    prisma.gamePlayer.findMany({ where: { sid: { in: sidy } },
      select: { id: true, nick: true, company: true, sid: true, zdroj: true, created_at: true } }),
  ]);
  const H = {}; hraci.forEach((h) => { H[h.sid] = h; });
  res.json({ ok: true, zaznamy: prvni.map((r) => {
    const moje = casti.filter((c) => c.sid === r.sid);
    const h = H[r.sid] || null;
    return {
      sid: r.sid, kdy: r.created_at, zdroj: r.zdroj || (h ? h.zdroj : null),
      ms: Math.max.apply(null, moje.map((c) => c.ms || 0).concat([0])),
      bajtu: moje.reduce((a, c) => a + (c.bajtu || 0), 0),
      casti: moje.length,
      mobil: /Mobile|Android|iPhone/i.test(String(r.ua || '')),
      hrac: h ? { id: h.id, nick: h.nick, firma: h.company, zdroj: h.zdroj,
        zalozil_po_ms: new Date(h.created_at).getTime() - new Date(r.created_at).getTime() } : null,
    };
  }) });
}));

// GET /zaznam?sid=… → všechny části jednoho záznamu slepené za sebou.
router.get('/zaznam', api(async (req, res) => {
  const sid = String(req.query.sid || '').slice(0, 64);
  if (!/^[a-z0-9-]{6,64}$/.test(sid)) return res.status(400).json({ error: 'Chybí sid.' });
  const casti = await prisma.gameReplay.findMany({ where: { sid }, orderBy: { poradi: 'asc' } });
  if (!casti.length) return res.status(404).json({ error: 'Záznam tu není.' });
  let udalosti = [];
  casti.forEach((c) => { if (Array.isArray(c.udalosti)) udalosti = udalosti.concat(c.udalosti); });
  const hrac = await prisma.gamePlayer.findFirst({ where: { sid },
    select: { id: true, nick: true, company: true } });
  res.json({ ok: true, sid, kdy: casti[0].created_at, casti: casti.length,
    ms: Math.max.apply(null, casti.map((c) => c.ms || 0)), hrac, udalosti });
}));

// ─── AI analytik hry ─────────────────────────────────────────────────────────
// Sesbírá, jak se hráči ve hře chovají (trychtýř, retence, postup, čas ve hře, platby, zdroje, reklama)
// a nechá Claude navrhnout konkrétní změny, které povedou k víc platbám. Poslední rozbor se ukládá.
const AI_KEY = 'game.ai_analyza';
const medi = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const R1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

async function sesbirejDataHry(reklama) {
  const dny = 30, od = new Date(Date.now() - dny * 86400e3);
  const [udalosti, hraci, nakupy, ceny, zaznamu] = await Promise.all([
    prisma.compounderEvent.findMany({ where: { created_at: { gte: od }, event: { startsWith: 'game_' } }, select: { event: true, sid: true }, take: 300000 }),
    prisma.gamePlayer.findMany({ where: { disabled: false }, take: 4000, orderBy: { created_at: 'desc' },
      select: { id: true, created_at: true, state_at: true, state: true, zdroj: true, hra_s_celkem: true, invited_by_id: true } }),
    prisma.gamePurchase.findMany({ where: { status: 'paid' }, select: { player_id: true, kind: true, qty: true, amount_cents: true, paid_at: true } }),
    prisma.gamePrice.findMany({ select: { kind: true, price: true, name: true, active: true } }),
    prisma.gameReplay.count().catch(() => 0),
  ]);
  // Události: kolik unikátních návštěv a kolikrát
  const ev = {};
  udalosti.forEach((e) => { const o = ev[e.event] || (ev[e.event] = { sids: new Set(), celkem: 0 }); o.sids.add(e.sid); o.celkem++; });
  const udalostiVystup = Object.keys(ev).map((k) => ({ udalost: k, unikatnich: ev[k].sids.size, celkem: ev[k].celkem })).sort((a, b) => b.unikatnich - a.unikatnich);

  const plat = {}; nakupy.forEach((n) => { const o = plat[n.player_id] || (plat[n.player_id] = { n: 0, kc: 0, prvni: null }); o.n++; o.kc += n.amount_cents / 100; const t = new Date(n.paid_at).getTime(); if (!o.prvni || t < o.prvni) o.prvni = t; });
  const bucket = (v, hr) => { for (const [lbl, max] of hr) if (v < max) return lbl; return hr[hr.length - 1][0]; };
  const B = { pradlomatu: {}, cas_ve_hre: {}, dni_od_registrace_do_posledni_aktivity: {}, profil: {}, zdroj: {}, pozvany: {} };
  const pridej = (skupina, klic, plati) => { const o = skupina[klic] || (skupina[klic] = { hracu: 0, platicich: 0 }); o.hracu++; if (plati) o.platicich++; };
  const casy = [], dnuDoPlatby = [];
  hraci.forEach((h) => {
    const st = h.state || {}; const units = Array.isArray(st.units) ? st.units.length : 0; const plati = !!plat[h.id];
    const minut = (h.hra_s_celkem || 0) / 60;
    const dniAktivity = h.state_at ? (new Date(h.state_at).getTime() - new Date(h.created_at).getTime()) / 86400e3 : 0;
    pridej(B.pradlomatu, bucket(units, [['0', 1], ['1', 2], ['2', 3], ['3-5', 6], ['6+', 1e9]]), plati);
    pridej(B.cas_ve_hre, bucket(minut, [['<1 min', 1], ['1-5 min', 5], ['5-15 min', 15], ['15-30 min', 30], ['30+ min', 1e9]]), plati);
    pridej(B.dni_od_registrace_do_posledni_aktivity, bucket(dniAktivity, [['<1 den', 1], ['1-3 dny', 3], ['3-7 dní', 7], ['7+ dní', 1e9]]), plati);
    pridej(B.profil, String(st.profile || 'neuvedeno'), plati);
    pridej(B.zdroj, String(h.zdroj || 'přímo/neznámý').slice(0, 40), plati);
    pridej(B.pozvany, h.invited_by_id ? 'pozvaný hráčem' : 'nepozvaný', plati);
    if (minut > 0) casy.push(minut);
    if (plati && plat[h.id].prvni) dnuDoPlatby.push((plat[h.id].prvni - new Date(h.created_at).getTime()) / 86400e3);
  });
  const podleDruhu = {}; nakupy.forEach((n) => { const o = podleDruhu[n.kind] || (podleDruhu[n.kind] = { nakupu: 0, kc: 0 }); o.nakupu++; o.kc += n.amount_cents / 100; });
  const platici = Object.keys(plat).length;
  return {
    obdobi_udalosti_dnu: dny,
    hracu_celkem: hraci.length, platicich_hracu: platici,
    konverze_na_platbu_pct: hraci.length ? R1(platici / hraci.length * 100) : 0,
    udalosti_za_30_dni: udalostiVystup,
    chovani_podle_skupin: B,
    median_minut_ve_hre: R1(medi(casy)), median_dni_od_registrace_do_prvni_platby: R1(medi(dnuDoPlatby)),
    nakupy_podle_druhu: podleDruhu,
    cenik: ceny.map((c) => ({ druh: c.kind, nazev: c.name, cena_kc: c.price / 100, aktivni: c.active })),
    nahranych_zaznamu_prvni_minuty: zaznamu,
    reklama: reklama || null,
  };
}

// Odpověď AI → objekt. Když je JSON useknutý (dlouhá odpověď), zkusí ho opravit: zahodí nedokončený konec a doplní závorky.
function parseAiJson(text) {
  const a = text.indexOf('{'); if (a < 0) return { summary: text.slice(0, 2000) };
  let t = text.slice(a);
  try { return JSON.parse(t.slice(0, t.lastIndexOf('}') + 1)); } catch (e) { /* oprava níže */ }
  for (let cut = t.length; cut > 10; ) {
    const k = Math.max(t.lastIndexOf('},', cut - 1), t.lastIndexOf('",', cut - 1), t.lastIndexOf('}]', cut - 1));
    if (k < 0) break; cut = k;
    let cand = t.slice(0, k + 1); if (cand.endsWith(',')) cand = cand.slice(0, -1);
    // dopočítej neuzavřené závorky (ignoruje obsah řetězců)
    const st = []; let inS = false, esc = false;
    for (const ch of cand) { if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inS = false; continue; } if (ch === '"') inS = true; else if (ch === '{' || ch === '[') st.push(ch); else if (ch === '}' || ch === ']') st.pop(); }
    if (inS) continue;
    const fixed = cand + st.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
    try { const o = JSON.parse(fixed); o._nekompletni = true; return o; } catch (e) { /* zkus kratší */ }
  }
  return { summary: 'AI vrátila neúplnou odpověď — spusť rozbor znovu.' };
}

// GET /ai-analyza → poslední uložený rozbor
router.get('/ai-analyza', api(async (req, res) => {
  const { getSetting } = require('../services/settings');
  const v = await getSetting(AI_KEY, { type: 'json', defaultValue: null }).catch(() => null);
  res.json({ ok: true, rozbor: v });
}));

// POST /ai-analyza { reklama? } → nový rozbor (Claude), uloží se
router.post('/ai-analyza', api(async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI není nakonfigurováno (chybí ANTHROPIC_API_KEY).' });
  const rk = req.body && req.body.reklama && typeof req.body.reklama === 'object' ? req.body.reklama : null;
  const reklama = rk ? ['vydaj', 'trzba', 'zisk', 'roas', 'dnu_plus', 'dnu_minus', 'registraci', 'nakupu', 'kliku', 'cena_registrace', 'cena_nakupu'].reduce((o, k) => { if (Number.isFinite(Number(rk[k]))) o[k] = Number(rk[k]); return o; }, {}) : null;
  const data = await sesbirejDataHry(reklama && Object.keys(reklama).length ? reklama : null);
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.GAME_AI_MODEL || 'claude-sonnet-4-6';
  const sys = 'Jsi senior produktový analytik a growth designér free-to-play her. Analyzuješ hru „Laundromat Tycoon" (prohlížečová tycoon hra o stavbě sítě samoobslužných prádlomatů na pradlomaty.info/game; hráči si zakládají účet, prozkoumávají města, staví prádlomaty a platí přes Stripe za balíčky měny/karty/výhody). Cíl majitele: ZÍSKAT VÍC PLATEB (vyšší konverze na platbu a vyšší tržba na hráče při rozumné ceně reklamy). Dostaneš agregovaná data o chování hráčů (trychtýř událostí, chování podle skupin vč. konverze na platbu, čas ve hře, postup, zdroje návštěv, nákupy podle druhu, ceník, výsledky reklamy). Pracuj POUZE s dodanými čísly, nic si nevymýšlej; když je vzorek malý (jednotky plateb), řekni to a formuluj závěry jako hypotézy. Najdi: kde se hráči ztrácejí, v jakém okamžiku/postupu je pravděpodobné, že zaplatí (a co mají platící společné), co brání platbě (cena, načasování, nabídka, tření), co se dá změnit v herním designu, nabídce, ceníku, onboardingu, notifikacích/e-mailech a reklamě. Odpověz POUZE platným JSON bez markdownu: {"summary":"<3-5 vět o stavu>","zjisteni":[{"nadpis":"<krátce>","detail":"<1-3 věty s čísly>"}],"navrhy":[{"nazev":"<krátce>","co_zmenit":"<konkrétně co ve hře/nabídce udělat>","proc":"<na jakých číslech to stojí>","ocekavany_dopad":"<odhad dopadu na platby>","narocnost":"nízká|střední|vysoká","priorita":1,"dopad":4,"snadnost":3,"oblast":"onboarding|nabídka|ceník|herní design|notifikace|reklama","kpi":"<jaká metrika se má zlepšit, např. konverze game_open→game_register>","cil":"<měřitelný cíl, např. z 8,5 % na 15 %>"}],"experimenty":["<A/B test nebo měření, které ověří hypotézu>"],"chybi_data":["<co by se mělo začít měřit, aby šlo příště analyzovat přesněji>"]}. 5–8 návrhů seřazených podle priority (1 = nejdřív); dopad a snadnost jsou celá čísla 1–5 (5 = největší dopad / nejsnazší). Každé zjištění musí mít aspoň jeden návrh, který ho řeší. Buď stručný: summary max 4 věty, detail max 2 věty, co_zmenit max 3 věty. Piš česky, konkrétně, s čísly.';
  const msg = await client.messages.create({ model, max_tokens: 8000, system: sys, messages: [{ role: 'user', content: 'Data hry (JSON):\n' + JSON.stringify(data) }] });
  let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
  text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
  const j = parseAiJson(text);
  const S = (x, n) => String(x == null ? '' : x).slice(0, n);
  const rozbor = {
    vytvoreno: new Date().toISOString(), model,
    prehled: { hracu: data.hracu_celkem, platicich: data.platicich_hracu, konverze_pct: data.konverze_na_platbu_pct },
    summary: S(j.summary, 2000),
    zjisteni: (Array.isArray(j.zjisteni) ? j.zjisteni : []).slice(0, 10).map((x) => ({ nadpis: S(x.nadpis, 120), detail: S(x.detail, 500) })),
    navrhy: (Array.isArray(j.navrhy) ? j.navrhy : []).slice(0, 10).map((x) => ({ nazev: S(x.nazev, 120), co_zmenit: S(x.co_zmenit, 600), proc: S(x.proc, 500), ocekavany_dopad: S(x.ocekavany_dopad, 300), narocnost: S(x.narocnost, 20), priorita: Number(x.priorita) || 9,
      dopad: Math.min(5, Math.max(1, Math.round(Number(x.dopad) || 3))), snadnost: Math.min(5, Math.max(1, Math.round(Number(x.snadnost) || 3))), oblast: S(x.oblast, 40), kpi: S(x.kpi, 200), cil: S(x.cil, 200) })).sort((a, b) => a.priorita - b.priorita),
    nekompletni: !!j._nekompletni,
    // Podklady pro grafy (stejná data, ze kterých AI vycházela)
    data: { udalosti: data.udalosti_za_30_dni.slice(0, 20), skupiny: data.chovani_podle_skupin, nakupy: data.nakupy_podle_druhu,
      median_minut: data.median_minut_ve_hre, median_dni_do_platby: data.median_dni_od_registrace_do_prvni_platby, reklama: data.reklama },
    experimenty: (Array.isArray(j.experimenty) ? j.experimenty : []).slice(0, 8).map((x) => S(x, 400)),
    chybi_data: (Array.isArray(j.chybi_data) ? j.chybi_data : []).slice(0, 8).map((x) => S(x, 300)),
  };
  try { const { setSetting } = require('../services/settings'); await setSetting(AI_KEY, rozbor, { type: 'json', description: 'Laundromat Tycoon — poslední rozbor AI analytika', scope: 'game', userId: req.user && req.user.id }); } catch (e) { console.warn('[game-ai] uložení rozboru selhalo:', e.message); }
  res.json({ ok: true, rozbor });
}));

module.exports = router;
