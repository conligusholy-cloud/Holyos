// =============================================================================
// Laundromat Tycoon — burza: obchody mezi hráči
// =============================================================================
// Hráč může druhému nabídnout, že od něj něco koupí, nebo že mu něco prodá.
// Druhý přijme, odmítne, nebo pošle protinávrh — a smlouvá se dál.
//
// Co se dá obchodovat: stroj ze skladu, postavený prádlomat i s místem, karta.
// Platí se laundry a volitelně k tomu přihozenými kartami.
//
// Proč to má dvě části: karty a obsazená místa drží server, takže ty převede
// rovnou. Hotovost, sklad a postavené prádlomaty ale žijí v prohlížeči hráče,
// proto se jen zapíše „co se má stát" (GameDelivery) a klient si to vyzvedne.
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const acct = require('./game-account.routes');

router.use(express.json({ limit: '32kb' }));

const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const MODELY = ['mini', 'flex', 'max'];
const PREDMETY = ['stroj', 'pradlomat', 'karta', 'pobocka'];
const MAX_CENA = 2000000000;

function hrac(req, res, next) {
  acct._currentPlayer(req).then((p) => {
    if (!p) return res.status(401).json({ error: 'Nejsi přihlášený.' });
    req.player = p; next();
  }).catch(next);
}
const api = (fn) => (req, res, next) => fn(req, res).catch(next);

// Stav hry hráče — sklad a postavené prádlomaty jsou v něm.
const stavu = (p) => (p && p.state) || {};
const skladu = (st) => {
  const out = {};
  MODELY.forEach((m) => { out[m] = Math.max(0, Math.round((st.stock && st.stock[m]) || 0)); });
  return out;
};

// ─── Co má kdo na prodej ─────────────────────────────────────────────────────
// GET /trade/assets/:id → sklad, prádlomaty a karty daného hráče.
// Na burze je tohle veřejné schválně: bez toho by se nedalo nabízet.
router.get('/trade/assets/:id', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id },
    select: { id: true, nick: true, company: true, state: true, disabled: true } });
  if (!p || p.disabled) return res.status(404).json({ error: 'Takový hráč tu není.' });
  const st = stavu(p);
  const [mista, karty] = await Promise.all([
    prisma.gameSpotClaim.findMany({ where: { player_id: id },
      select: { spot_id: true, name: true, model: true, rent: true, area_key: true } }),
    prisma.gameCard.groupBy({ by: ['kind'], where: { player_id: id, used_at: null }, _count: { _all: true } }),
  ]);
  const k = {};
  karty.forEach((x) => { k[x.kind] = x._count._all; });
  // Jak si cizí firma stojí, je její věc. Ven jde jen to, co je stejně vidět
  // na mapě: kde to stojí a jaký je tam stroj. Nájem, obrat, zisk ani úvěry
  // nikoli — kdo chce vědět víc, má se majitele zeptat ve zprávách.
  res.json({ ok: true,
    hrac: { id: p.id, nick: p.nick, firma: p.company || (p.nick + ' s.r.o.') },
    sklad: skladu(st),
    pradlomaty: mista.map((m) => ({ spot_id: m.spot_id, name: m.name,
      model: m.model, area_key: m.area_key })),
    pobocky: (Array.isArray(st.pobocky) ? st.pobocky : [])
      .filter((x) => x && x.name).map((x) => ({ name: x.name, lat: x.lat, lon: x.lon })),
    karty: k });
}));

// GET /trade/players → s kým jde obchodovat
router.get('/trade/players', hrac, api(async (req, res) => {
  const rows = await prisma.gamePlayer.findMany({
    where: { disabled: false, id: { not: req.player.id } },
    orderBy: { state_at: 'desc' }, take: 100,
    select: { id: true, nick: true, company: true, state_at: true },
  });
  res.json({ ok: true, players: rows.map((p) => ({ id: p.id, nick: p.nick,
    firma: p.company || (p.nick + ' s.r.o.'), naposledy: p.state_at })) });
}));

// ─── Nabídky ─────────────────────────────────────────────────────────────────
const verejny = (t, me) => ({
  id: t.id, smer: t.smer, predmet: t.predmet, model: t.model, spot_id: t.spot_id,
  card_kind: t.card_kind, cena: t.cena, karty: t.karty || [], vzkaz: t.vzkaz,
  stav: t.stav, parent_id: t.parent_id, created_at: t.created_at,
  od: { id: t.from_id, nick: t.from_nick }, komu: { id: t.to_id, nick: t.to_nick },
  moje: t.from_id === me,       // nabídku poslal přihlášený hráč
  na_tahu: t.to_id === me && t.stav === 'ceka',
});

// GET /trade/list → všechno, co se mě týká
router.get('/trade/list', hrac, api(async (req, res) => {
  const me = req.player.id;
  const rows = await prisma.gameTrade.findMany({
    where: { OR: [{ from_id: me }, { to_id: me }] },
    orderBy: { created_at: 'desc' }, take: 120,
  });
  res.json({ ok: true, trades: rows.map((t) => verejny(t, me)),
    ceka_na_me: rows.filter((t) => t.to_id === me && t.stav === 'ceka').length });
}));

// Ověří, že nabídka dává smysl a že prodávající danou věc opravdu má.
async function zkontroluj(nab, prodavajici) {
  const st = stavu(prodavajici);
  if (nab.predmet === 'stroj') {
    if (!MODELY.includes(nab.model)) return 'Takový model neznám.';
    if (skladu(st)[nab.model] < 1) return 'Prodávající nemá ten stroj skladem.';
  } else if (nab.predmet === 'pradlomat') {
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: nab.spot_id || '' } });
    if (!c || c.player_id !== prodavajici.id) return 'Ten prádlomat už prodávajícímu nepatří.';
  } else if (nab.predmet === 'karta') {
    const k = await prisma.gameCard.count({ where: { player_id: prodavajici.id, kind: nab.card_kind || '', used_at: null } });
    if (!k) return 'Prodávající tu kartu nemá.';
  } else if (nab.predmet === 'pobocka') {
    // Pobočky žijí ve stavu hry, ne v tabulce — hledáme ji podle názvu.
    const pob = Array.isArray(st.pobocky) ? st.pobocky : [];
    if (!pob.some((x) => x && x.name === nab.pobocka)) return 'Prodávající takovou pobočku nemá.';
  } else return 'Tohle se obchodovat nedá.';
  return null;
}

// POST /trade/offer { to_id, smer, predmet, model, spot_id, card_kind, cena, karty[], vzkaz }
router.post('/trade/offer', hrac, api(async (req, res) => {
  const b = req.body || {};
  const to_id = parseInt(b.to_id, 10);
  const smer = s(b.smer, 8);
  const predmet = s(b.predmet, 12);
  if (to_id === req.player.id) return res.status(400).json({ error: 'Sám sobě nabídku posílat nemusíš.' });
  if (!['koupim', 'prodam'].includes(smer)) return res.status(400).json({ error: 'Neznámý směr obchodu.' });
  if (!PREDMETY.includes(predmet)) return res.status(400).json({ error: 'Tohle se obchodovat nedá.' });
  const cena = Math.max(0, Math.min(MAX_CENA, Math.round(Number(b.cena) || 0)));
  const karty = Array.isArray(b.karty) ? b.karty.map((x) => s(x, 24)).filter(Boolean).slice(0, 10) : [];
  if (!cena && !karty.length) return res.status(400).json({ error: 'Nabídni aspoň nějakou cenu nebo kartu.' });

  const druhy = await prisma.gamePlayer.findUnique({ where: { id: to_id } });
  if (!druhy || druhy.disabled) return res.status(404).json({ error: 'Takový hráč tu není.' });

  const nab = { predmet, model: s(b.model, 10) || null, spot_id: s(b.spot_id, 120) || null,
    card_kind: s(b.card_kind, 24) || null, pobocka: s(b.pobocka, 80) || null };
  // Kdo věc má: u „koupim" ji má ten druhý, u „prodam" ji mám já.
  const chyba = await zkontroluj(nab, smer === 'koupim' ? druhy : req.player);
  if (chyba) return res.status(409).json({ error: chyba });
  // Karty přihozené k ceně platí vždycky ten, kdo kupuje.
  const platici = smer === 'koupim' ? req.player : druhy;
  for (const k of karty) {
    const m = await prisma.gameCard.count({ where: { player_id: platici.id, kind: k, used_at: null } });
    if (!m) return res.status(409).json({ error: 'Karta ' + k + ' chybí tomu, kdo má platit.' });
  }

  const t = await prisma.gameTrade.create({ data: {
    from_id: req.player.id, from_nick: req.player.nick, to_id, to_nick: druhy.nick,
    smer, predmet, model: nab.model,
    // U pobočky nese její název sloupec spot_id — nový sloupec kvůli tomu nezakládáme.
    spot_id: predmet === 'pobocka' ? nab.pobocka : nab.spot_id, card_kind: nab.card_kind,
    cena, karty, vzkaz: s(b.vzkaz, 200) || null,
  } });
  res.json({ ok: true, trade: verejny(t, req.player.id) });
}));

// POST /trade/:id/counter { cena, karty[], vzkaz } — protinávrh (otočí se role)
router.post('/trade/:id/counter', hrac, api(async (req, res) => {
  const t = await prisma.gameTrade.findUnique({ where: { id: parseInt(req.params.id, 10) } });
  if (!t) return res.status(404).json({ error: 'Nabídka nenalezena.' });
  if (t.to_id !== req.player.id) return res.status(403).json({ error: 'Tahle nabídka není pro tebe.' });
  if (t.stav !== 'ceka') return res.status(409).json({ error: 'Tahle nabídka už není ve hře.' });
  const cena = Math.max(0, Math.min(MAX_CENA, Math.round(Number((req.body || {}).cena) || 0)));
  const karty = Array.isArray((req.body || {}).karty) ? (req.body || {}).karty.map((x) => s(x, 24)).filter(Boolean).slice(0, 10) : [];
  if (!cena && !karty.length) return res.status(400).json({ error: 'Protinávrh potřebuje cenu nebo kartu.' });

  const novy = await prisma.$transaction(async (tx) => {
    await tx.gameTrade.update({ where: { id: t.id }, data: { stav: 'protinavrh', resolved_at: new Date() } });
    // Předmět i směr zůstávají, jen se prohodí, kdo komu píše.
    return tx.gameTrade.create({ data: {
      from_id: req.player.id, from_nick: req.player.nick, to_id: t.from_id, to_nick: t.from_nick,
      smer: t.smer === 'koupim' ? 'prodam' : 'koupim',
      predmet: t.predmet, model: t.model, spot_id: t.spot_id, card_kind: t.card_kind,
      cena, karty, vzkaz: s((req.body || {}).vzkaz, 200) || null, parent_id: t.id,
    } });
  });
  res.json({ ok: true, trade: verejny(novy, req.player.id) });
}));

// POST /trade/:id/decline — odmítnutí
router.post('/trade/:id/decline', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = await prisma.gameTrade.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ error: 'Nabídka nenalezena.' });
  if (t.to_id !== req.player.id && t.from_id !== req.player.id) return res.status(403).json({ error: 'Tahle nabídka není tvoje.' });
  if (t.stav !== 'ceka') return res.status(409).json({ error: 'Tahle nabídka už není ve hře.' });
  await prisma.gameTrade.update({ where: { id },
    data: { stav: t.from_id === req.player.id ? 'zruseno' : 'odmitnuto', resolved_at: new Date() } });
  res.json({ ok: true });
}));

// POST /trade/:id/accept — přijetí a samotný převod
router.post('/trade/:id/accept', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = await prisma.gameTrade.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ error: 'Nabídka nenalezena.' });
  if (t.to_id !== req.player.id) return res.status(403).json({ error: 'Přijmout ji může jen ten, komu přišla.' });
  if (t.stav !== 'ceka') return res.status(409).json({ error: 'Tahle nabídka už není ve hře.' });

  const odesilatel = await prisma.gamePlayer.findUnique({ where: { id: t.from_id } });
  if (!odesilatel || odesilatel.disabled) return res.status(409).json({ error: 'Druhý hráč už nehraje.' });

  // Kdo je kdo: u „koupim" kupuje odesílatel, u „prodam" kupuje příjemce.
  const kupujici = t.smer === 'koupim' ? odesilatel : req.player;
  const prodavajici = t.smer === 'koupim' ? req.player : odesilatel;

  const chyba = await zkontroluj(t, prodavajici);
  if (chyba) {
    await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
    return res.status(409).json({ error: chyba });
  }
  // Má kupující na to? Čteme z jeho poslední uložené hry — není to neprůstřelné,
  // ale zachytí to poctivý omyl.
  const hotovost = Math.round((stavu(kupujici).cash) || 0);
  if (t.cena > hotovost) return res.status(409).json({ error: 'Kupující nemá dost hotovosti (' + hotovost.toLocaleString('cs-CZ') + ' L$).' });

  const karty = Array.isArray(t.karty) ? t.karty : [];
  const popisPredmetu = t.predmet === 'stroj' ? (t.model || '').toUpperCase()
    : t.predmet === 'pradlomat' ? 'prádlomat'
    : t.predmet === 'pobocka' ? ('pobočku ' + (t.spot_id || '')) : 'karta';

  await prisma.$transaction(async (tx) => {
    // 1. karty přihozené k ceně → od kupujícího prodávajícímu
    for (const k of karty) {
      const c = await tx.gameCard.findFirst({ where: { player_id: kupujici.id, kind: k, used_at: null }, orderBy: { id: 'asc' } });
      if (!c) throw new Error('Karta ' + k + ' se mezitím ztratila.');
      await tx.gameCard.update({ where: { id: c.id }, data: { player_id: prodavajici.id } });
    }
    // 2. samotný předmět
    if (t.predmet === 'karta') {
      const c = await tx.gameCard.findFirst({ where: { player_id: prodavajici.id, kind: t.card_kind, used_at: null }, orderBy: { id: 'asc' } });
      if (!c) throw new Error('Karta se mezitím ztratila.');
      await tx.gameCard.update({ where: { id: c.id }, data: { player_id: kupujici.id } });
    } else if (t.predmet === 'stroj') {
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'stock', model: t.model, amount: -1, popis: 'Prodal jsi ' + popisPredmetu },
        { player_id: kupujici.id, trade_id: t.id, kind: 'stock', model: t.model, amount: 1, popis: 'Koupil jsi ' + popisPredmetu },
      ] });
    } else if (t.predmet === 'pradlomat') {
      const c = await tx.gameSpotClaim.update({ where: { spot_id: t.spot_id },
        data: { player_id: kupujici.id, nick: kupujici.nick } });
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'unit_remove', spot_id: t.spot_id, popis: 'Prodal jsi prádlomat ' + (c.name || '') },
        { player_id: kupujici.id, trade_id: t.id, kind: 'unit_add', spot_id: t.spot_id, model: c.model,
          data: { name: c.name, lat: c.lat, lon: c.lon, rent: c.rent, area_key: c.area_key },
          popis: 'Koupil jsi prádlomat ' + (c.name || '') },
      ] });
    } else if (t.predmet === 'pobocka') {
      // Pobočka se přesouvá přes doručenky — stav hry si ji přepíše sám.
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'pobocka_remove', spot_id: t.spot_id,
          popis: 'Prodal jsi pobočku ' + (t.spot_id || '') },
        { player_id: kupujici.id, trade_id: t.id, kind: 'pobocka_add', spot_id: t.spot_id,
          popis: 'Koupil jsi pobočku ' + (t.spot_id || '') },
      ] });
    }
    // 3. peníze
    if (t.cena > 0) {
      await tx.gameDelivery.createMany({ data: [
        { player_id: kupujici.id, trade_id: t.id, kind: 'cash', amount: -t.cena, popis: 'Zaplatil jsi za ' + popisPredmetu },
        { player_id: prodavajici.id, trade_id: t.id, kind: 'cash', amount: t.cena, popis: 'Utržil jsi za ' + popisPredmetu },
      ] });
    }
    await tx.gameTrade.update({ where: { id }, data: { stav: 'prijato', resolved_at: new Date() } });
  });

  console.log('[game] obchod #' + id + ': ' + prodavajici.nick + ' → ' + kupujici.nick
    + ' · ' + popisPredmetu + ' za ' + t.cena + ' L$' + (karty.length ? ' + ' + karty.length + ' karet' : ''));
  res.json({ ok: true });
}));

// ─── Vyzvednutí následků ─────────────────────────────────────────────────────
// GET /trade/deliveries → co si mám připsat do rozehrané hry
router.get('/trade/deliveries', hrac, api(async (req, res) => {
  const rows = await prisma.gameDelivery.findMany({
    where: { player_id: req.player.id, claimed_at: null }, orderBy: { id: 'asc' }, take: 50,
  });
  // created_at posíláme kvůli účetní knize: doručenka mohla čekat i půl dne,
  // než si ji hráč vyzvedl, a v knize má být vidět, kdy ta provize vznikla.
  res.json({ ok: true, deliveries: rows.map((d) => ({ id: d.id, kind: d.kind, model: d.model,
    amount: d.amount, spot_id: d.spot_id, data: d.data || null, popis: d.popis,
    vzniklo: d.created_at })) });
}));

// POST /trade/deliveries/claim { ids: [] } — klient potvrdí, že to zapsal
router.post('/trade/deliveries/claim', hrac, api(async (req, res) => {
  const ids = Array.isArray((req.body || {}).ids)
    ? (req.body || {}).ids.map((x) => parseInt(x, 10)).filter(Number.isFinite).slice(0, 50) : [];
  if (!ids.length) return res.json({ ok: true, claimed: 0 });
  const r = await prisma.gameDelivery.updateMany({
    where: { id: { in: ids }, player_id: req.player.id, claimed_at: null },
    data: { claimed_at: new Date() },
  });
  res.json({ ok: true, claimed: r.count });
}));

// ─── Konkurzní rozprodej ────────────────────────────────────────────────────
// Majetek zkrachovalé firmy je herní měsíc na Burze. Cena začíná na 80 %
// hodnoty a lineárně klesá ke 40 % — kdo chce jistotu, kupuje dřív a dráž.
const AUKCE_OD = 0.8, AUKCE_DO = 0.4;
const AUKCE_MESIC = 43200000;      // herní měsíc = 12 skutečných hodin
function aukceCena(a, ted) {
  const cely = Math.max(1, new Date(a.do).getTime() - new Date(a.od).getTime());
  const ubehlo = Math.min(1, Math.max(0, ((ted || Date.now()) - new Date(a.od).getTime()) / cely));
  const podil = AUKCE_OD - (AUKCE_OD - AUKCE_DO) * ubehlo;
  return Math.max(1000, Math.round(a.hodnota * podil / 1000) * 1000);
}
function aukcePub(a, ted) {
  return { id: a.id, nick: a.nick, predmet: a.predmet, model: a.model, spot_id: a.spot_id,
    card_kind: a.card_kind, popis: a.popis, hodnota: a.hodnota, cena: aukceCena(a, ted),
    konci: a.do, moje: false };
}

// POST /trade/konkurz { polozky:[{predmet,model,spot_id,card_kind,popis,hodnota,data}] }
// Hlásí klient ve chvíli, kdy jeho firma padla. Server z toho udělá nabídky.
router.post('/trade/konkurz', hrac, api(async (req, res) => {
  const polozky = Array.isArray((req.body || {}).polozky) ? (req.body || {}).polozky.slice(0, 60) : [];
  if (!polozky.length) return res.json({ ok: true, zalozeno: 0 });
  const konec = new Date(Date.now() + AUKCE_MESIC);
  const data = polozky.map((x) => ({
    player_id: req.player.id, nick: req.player.nick,
    predmet: String(x.predmet || 'stroj').slice(0, 12),
    model: x.model ? String(x.model).slice(0, 10) : null,
    spot_id: x.spot_id ? String(x.spot_id).slice(0, 120) : null,
    card_kind: x.card_kind ? String(x.card_kind).slice(0, 24) : null,
    popis: String(x.popis || 'majetek').slice(0, 160),
    hodnota: Math.max(1000, Math.round(Number(x.hodnota) || 0)),
    data: x.data || null, do: konec,
  }));
  await prisma.gameAuction.createMany({ data });
  console.log('[game] konkurz ' + req.player.nick + ': ' + data.length + ' položek na burze');
  res.json({ ok: true, zalozeno: data.length });
}));

// GET /trade/aukce → co je teď v rozprodeji
router.get('/trade/aukce', hrac, api(async (req, res) => {
  const ted = Date.now();
  const rows = await prisma.gameAuction.findMany({
    where: { koupil_id: null, do: { gt: new Date(ted) } },
    orderBy: { do: 'asc' }, take: 200,
  });
  res.json({ ok: true, aukce: rows.map((a) => {
    const v = aukcePub(a, ted);
    v.moje = a.player_id === req.player.id;
    return v;
  }) });
}));

// POST /trade/aukce/:id/koupit → kupující platí, majetek jde přes doručenky
router.post('/trade/aukce/:id/koupit', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.gameAuction.findUnique({ where: { id } });
  if (!a || a.koupil_id) return res.status(409).json({ error: 'Tohle už někdo koupil.' });
  if (new Date(a.do).getTime() < Date.now()) return res.status(409).json({ error: 'Rozprodej už skončil.' });
  if (a.player_id === req.player.id) return res.status(400).json({ error: 'Vlastní majetek si zpátky nekoupíš.' });
  const cena = aukceCena(a);

  await prisma.$transaction(async (tx) => {
    const zabrano = await tx.gameAuction.updateMany({
      where: { id: a.id, koupil_id: null },
      data: { koupil_id: req.player.id, koupil_za: cena, koupeno_at: new Date() },
    });
    if (!zabrano.count) throw Object.assign(new Error('Tohle už někdo koupil.'), { stav: 409 });

    const dorucenky = [
      { player_id: req.player.id, kind: 'cash', amount: -cena, popis: 'Koupil jsi z konkurzu: ' + a.popis },
      { player_id: a.player_id, kind: 'cash', amount: cena, popis: 'Z konkurzu se prodalo: ' + a.popis },
    ];
    if (a.predmet === 'stroj') {
      dorucenky.push({ player_id: req.player.id, kind: 'stock', model: a.model, amount: 1, popis: 'Z konkurzu: ' + a.popis });
    } else if (a.predmet === 'pobocka') {
      dorucenky.push({ player_id: req.player.id, kind: 'pobocka_add', spot_id: a.spot_id, popis: 'Z konkurzu: ' + a.popis });
    } else if (a.predmet === 'pradlomat') {
      // Místo po zkrachovalém je volné — kupující ho musí zabrat jako každé jiné,
      // ale stroj dostane na sklad.
      dorucenky.push({ player_id: req.player.id, kind: 'stock', model: a.model || 'mini', amount: 1,
        popis: 'Z konkurzu stroj z místa ' + a.popis });
    }
    await tx.gameDelivery.createMany({ data: dorucenky });
  });

  res.json({ ok: true, cena });
}));

// ─── Zprávy mezi hráči ─────────────────────────────────────────
// Prostý chat jeden na jednoho. Konverzace není vlastní záznam — je to prostě
// všechno, co si dva lidi poslali. Text se nikdy nevkládá do stránky jako HTML,
// klient ho escápuje; tady hlídáme jen délku a frekvenci.
const ZPRAVA_MAX = 800;
const ZPRAV_ZA_MINUTU = 20;
const zpravyLog = new Map();
function prilisCasto(id) {
  const ted = Date.now();
  const a = (zpravyLog.get(id) || []).filter((t) => ted - t < 60000);
  a.push(ted);
  zpravyLog.set(id, a);
  if (zpravyLog.size > 2000) {
    for (const [k, v] of zpravyLog) if (!v.some((t) => ted - t < 60000)) zpravyLog.delete(k);
  }
  return a.length > ZPRAV_ZA_MINUTU;
}
const zpravaPub = (m, ja) => ({
  id: m.id, text: m.text, moje: m.from_id === ja,
  kdy: m.created_at, precteno: !!m.read_at, nahlasena: !!m.reported_at,
});
// Koho tenhle hráč blokuje a kdo blokuje jeho — obojí je potřeba: jeho bloky
// schovávají konverzace, cizí bloky mu brání psát.
async function blokyKolem(ja) {
  const rows = await prisma.gameBlock.findMany({
    where: { OR: [{ blocker_id: ja }, { blocked_id: ja }] },
  });
  return {
    blokuju: new Set(rows.filter((b) => b.blocker_id === ja).map((b) => b.blocked_id)),
    blokujiMe: new Set(rows.filter((b) => b.blocked_id === ja).map((b) => b.blocker_id)),
  };
}

// POST /chat/send { to_id, text } → pošle zprávu druhému hráči
router.post('/chat/send', hrac, api(async (req, res) => {
  const to = parseInt((req.body || {}).to_id, 10);
  const text = s((req.body || {}).text, ZPRAVA_MAX);
  if (!text) return res.status(400).json({ error: 'Napiš něco.' });
  if (!Number.isFinite(to) || to === req.player.id) {
    return res.status(400).json({ error: 'Komu to má jít?' });
  }
  if (prilisCasto(req.player.id)) {
    return res.status(429).json({ error: 'Moc zpráv po sobě. Dá si chvilku pauzu.' });
  }
  const komu = await prisma.gamePlayer.findUnique({ where: { id: to },
    select: { id: true, disabled: true } });
  if (!komu || komu.disabled) return res.status(404).json({ error: 'Takový hráč tu není.' });
  const bloky = await blokyKolem(req.player.id);
  if (bloky.blokuju.has(to)) {
    return res.status(403).json({ error: 'Tohohle hráče máš zablokovaného. Odblokuj ho a píš dál.' });
  }
  if (bloky.blokujiMe.has(to)) {
    return res.status(403).json({ error: 'Tomuhle hráči už psát nemůžeš.' });
  }
  const m = await prisma.gameMessage.create({
    data: { from_id: req.player.id, to_id: to, text },
  });
  res.json({ ok: true, zprava: zpravaPub(m, req.player.id) });
}));

// GET /chat/threads → s kým si píšu, poslední zpráva a kolik nepřečtených
router.get('/chat/threads', hrac, api(async (req, res) => {
  const ja = req.player.id;
  const bloky = await blokyKolem(ja);
  const rows = await prisma.gameMessage.findMany({
    where: { OR: [{ from_id: ja }, { to_id: ja }] },
    orderBy: { id: 'desc' }, take: 400,
  });
  const podle = new Map();
  rows.forEach((m) => {
    const druhy = m.from_id === ja ? m.to_id : m.from_id;
    if (bloky.blokuju.has(druhy)) return;   // koho blokuju, toho nevidím
    let t = podle.get(druhy);
    if (!t) { t = { id: druhy, posledni: m, neprectenych: 0 }; podle.set(druhy, t); }
    if (m.to_id === ja && !m.read_at) t.neprectenych++;
  });
  const ids = [...podle.keys()];
  const lide = ids.length
    ? await prisma.gamePlayer.findMany({ where: { id: { in: ids } },
        select: { id: true, nick: true, company: true, emblem: true } })
    : [];
  const kdo = new Map(lide.map((p) => [p.id, p]));
  const threads = [...podle.values()].map((t) => {
    const p = kdo.get(t.id);
    return {
      id: t.id, nick: p ? p.nick : 'neznámý',
      firma: p ? (p.company || p.nick + ' s.r.o.') : 'neznámá firma',
      znak: p ? p.emblem || null : null,
      neprectenych: t.neprectenych,
      posledni: zpravaPub(t.posledni, ja),
    };
  }).sort((a, b) => new Date(b.posledni.kdy) - new Date(a.posledni.kdy));
  const neprectenych = threads.reduce((a, t) => a + t.neprectenych, 0);
  res.json({ ok: true, threads, neprectenych });
}));

// GET /chat/with/:id → celá konverzace; co přišlo mně, rovnou označíme za přečtené
router.get('/chat/with/:id', hrac, api(async (req, res) => {
  const ja = req.player.id;
  const druhy = parseInt(req.params.id, 10);
  if (!Number.isFinite(druhy)) return res.status(400).json({ error: 'Který hráč?' });
  const p = await prisma.gamePlayer.findUnique({ where: { id: druhy },
    select: { id: true, nick: true, company: true, emblem: true, disabled: true } });
  if (!p || p.disabled) return res.status(404).json({ error: 'Takový hráč tu není.' });
  const rows = await prisma.gameMessage.findMany({
    where: { OR: [{ from_id: ja, to_id: druhy }, { from_id: druhy, to_id: ja }] },
    orderBy: { id: 'asc' }, take: 200,
  });
  await prisma.gameMessage.updateMany({
    where: { from_id: druhy, to_id: ja, read_at: null }, data: { read_at: new Date() },
  });
  const bloky = await blokyKolem(ja);
  res.json({ ok: true,
    hrac: { id: p.id, nick: p.nick, firma: p.company || (p.nick + ' s.r.o.'), znak: p.emblem || null },
    blokuju: bloky.blokuju.has(druhy),
    blokuje_me: bloky.blokujiMe.has(druhy),
    zpravy: rows.map((m) => zpravaPub(m, ja)) });
}));

// POST /chat/block { id, zrusit } — koho nechci slyšet
router.post('/chat/block', hrac, api(async (req, res) => {
  const ja = req.player.id;
  const koho = parseInt((req.body || {}).id, 10);
  const zrusit = !!(req.body || {}).zrusit;
  if (!Number.isFinite(koho) || koho === ja) return res.status(400).json({ error: 'Koho?' });
  if (zrusit) {
    await prisma.gameBlock.deleteMany({ where: { blocker_id: ja, blocked_id: koho } });
    return res.json({ ok: true, blokuju: false });
  }
  const je = await prisma.gamePlayer.findUnique({ where: { id: koho }, select: { id: true } });
  if (!je) return res.status(404).json({ error: 'Takový hráč tu není.' });
  try {
    await prisma.gameBlock.create({ data: { blocker_id: ja, blocked_id: koho } });
  } catch (e) { /* už zablokovaný — nevadí */ }
  res.json({ ok: true, blokuju: true });
}));

// POST /chat/report { id } — nahlášení jedné zprávy. Nahlásit jde jen to,
// co přišlo mně — na vlastní zprávy si stěžovat není proč.
router.post('/chat/report', hrac, api(async (req, res) => {
  const ja = req.player.id;
  const id = parseInt((req.body || {}).id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Kterou zprávu?' });
  const m = await prisma.gameMessage.findUnique({ where: { id } });
  if (!m || m.to_id !== ja) return res.status(404).json({ error: 'Taková zpráva tu není.' });
  if (!m.reported_at) {
    await prisma.gameMessage.update({ where: { id },
      data: { reported_at: new Date(), reported_by: ja } });
    console.log('[game] nahlasena zprava ' + id + ' od hrace ' + m.from_id);
  }
  res.json({ ok: true });
}));

module.exports = router;
