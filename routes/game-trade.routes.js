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
const PREDMETY = ['stroj', 'pradlomat', 'karta', 'pobocka', 'pujcka', 'podil'];
// Co si dva hráči můžou domluvit navíc k věcem: půjčku a podíl ve firmě.
const MESIC_MS = 43200000;             // herní měsíc = 12 skutečných hodin
const PUJCKA_MIN = 10000;
const UROK_MAX = 0.6;                  // 60 % ročně je strop, výš už je to lichva
const PUJCKA_MESICU_MAX = 60;
const PODIL_MIN = 0.01, PODIL_MAX = 0.49;   // většinu firmy si majitel nechá
const ODKUP_NASOBEK = 1.25;            // za kolik jde podíl koupit zpátky
// Anuitní splátka za herní měsíc: stejná částka po celou dobu.
function anuita(castka, urokRocni, mesicu) {
  const r = (Number(urokRocni) || 0) / 12;
  if (!(mesicu > 0)) return castka;
  if (r <= 0) return Math.ceil(castka / mesicu);
  return Math.ceil(castka * r / (1 - Math.pow(1 + r, -mesicu)));
}
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
  card_kind: t.card_kind, cena: t.cena, karty: t.karty || [], vzkaz: t.vzkaz, data: t.data || null,
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
  } else if (nab.predmet === 'pujcka' || nab.predmet === 'podil') {
    return null;        // peníze a podíl se kontrolují zvlášť, nic se nepřevádí ze skladu
  } else return 'Tohle se obchodovat nedá.';
  return null;
}
// Kdo u téhle nabídky platí hotovost. U půjčky je to věřitel — ten, od koho
// se peníze „kupují"; u všeho ostatního kupující.
function platiciId(t) {
  const kupujici = t.smer === 'koupim' ? t.from_id : t.to_id;
  const prodavajici = t.smer === 'koupim' ? t.to_id : t.from_id;
  return t.predmet === 'pujcka' ? prodavajici : kupujici;
}
// Co má hráč rozjednané a zaplatil by, kdyby to protistrana přijala.
// Bez tohohle jde rozeslat deset nabídek po milionu s milionem v kase —
// devět z nich pak nejde přijmout a hráč se diví proč.
async function vazanaHotovost(playerId, kromeId) {
  const rows = await prisma.gameTrade.findMany({
    where: { stav: 'ceka', OR: [{ from_id: playerId }, { to_id: playerId }] },
    select: { id: true, from_id: true, to_id: true, smer: true, predmet: true, cena: true },
  });
  return rows.reduce((a, t) => a
    + (t.id !== kromeId && platiciId(t) === playerId ? (t.cena || 0) : 0), 0);
}
// Vejde se nová nabídka do toho, co hráči zbývá? Vrací chybovou větu, nebo null.
async function hotovostStaci(hrac, cena, kromeId) {
  const cash = Math.round((stavu(hrac).cash) || 0);
  const vazano = await vazanaHotovost(hrac.id, kromeId);
  const volne = cash - vazano;
  if (cena <= volne) return null;
  return 'Na tohle nemáš volnou hotovost. Máš ' + cash.toLocaleString('cs-CZ')
    + ' L$, z toho ' + vazano.toLocaleString('cs-CZ') + ' L$ drží nabídky, co čekají na odpověď — '
    + 'volných je ' + Math.max(0, volne).toLocaleString('cs-CZ') + ' L$.';
}

// Kolik procent firmy už je prodáno jinde.
async function prodanyPodil(firmaId) {
  const rows = await prisma.gameEquity.findMany({ where: { firma_id: firmaId, stav: 'bezi' },
    select: { podil: true } });
  return rows.reduce((a, x) => a + (x.podil || 0), 0);
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
  // Podmínky půjčky a podílu. U půjčky je „prodávající" ten, kdo peníze dává,
  // takže směr čteme stejně jako u věcí: koupim = chci je od něj.
  let data = null;
  if (predmet === 'pujcka') {
    const urok = Math.max(0, Math.min(UROK_MAX, Number(b.urok) || 0));
    const mesicu = Math.max(1, Math.min(PUJCKA_MESICU_MAX, Math.round(Number(b.mesicu) || 0)));
    if (cena < PUJCKA_MIN) {
      return res.status(400).json({ error: 'Nejmenší půjčka je ' + PUJCKA_MIN.toLocaleString('cs-CZ') + ' L$.' });
    }
    // Zástavou ručí vždycky dlužník — ten, kdo si půjčuje.
    const dluznik = smer === 'koupim' ? req.player : druhy;
    const zast = s(b.zastava, 120) || null;
    let zastavaNazev = null;
    if (zast) {
      const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: zast } });
      if (!c || c.player_id !== dluznik.id) {
        return res.status(409).json({ error: 'Zástavou může být jen prádlomat toho, kdo si půjčuje.' });
      }
      zastavaNazev = c.name || zast;
    }
    // Věřitel může zástavu podmínit, i když ještě neví, čím mu dlužník ručí —
    // ten ji vybere, až bude nabídku přijímat.
    const zadam = smer === 'prodam' && !zast && !!b.zadam_zastavu;
    data = { urok, mesicu, zastava: zast, zastava_nazev: zastavaNazev,
      zadam_zastavu: zadam, splatka: anuita(cena, urok, mesicu) };
  } else if (predmet === 'podil') {
    const podil = Math.max(PODIL_MIN, Math.min(PODIL_MAX, Number(b.podil) || 0));
    // Podíl prodává majitel firmy — u „koupim" je to ten druhý, u „prodam" já.
    const firma = smer === 'koupim' ? druhy : req.player;
    const uz = await prodanyPodil(firma.id);
    if (uz + podil > PODIL_MAX + 1e-9) {
      return res.status(409).json({ error: 'Z firmy je prodáno už ' + Math.round(uz * 100)
        + ' %. Víc než ' + Math.round(PODIL_MAX * 100) + ' % se prodat nedá.' });
    }
    data = { podil };
  }
  // Kdo věc má: u „koupim" ji má ten druhý, u „prodam" ji mám já.
  const chyba = await zkontroluj(nab, smer === 'koupim' ? druhy : req.player);
  if (chyba) return res.status(409).json({ error: chyba });
  // Karty přihozené k ceně platí vždycky ten, kdo kupuje.
  const platici = smer === 'koupim' ? req.player : druhy;
  for (const k of karty) {
    const m = await prisma.gameCard.count({ where: { player_id: platici.id, kind: k, used_at: null } });
    if (!m) return res.status(409).json({ error: 'Karta ' + k + ' chybí tomu, kdo má platit.' });
  }

  // Platím-li já, musí na to být volná hotovost — jinak je nabídka od začátku mrtvá.
  const platimJa = predmet === 'pujcka' ? smer === 'prodam' : smer === 'koupim';
  if (platimJa && cena > 0) {
    const chybi = await hotovostStaci(req.player, cena, null);
    if (chybi) return res.status(409).json({ error: chybi });
  }

  const t = await prisma.gameTrade.create({ data: {
    from_id: req.player.id, from_nick: req.player.nick, to_id, to_nick: druhy.nick,
    smer, predmet, model: nab.model,
    // U pobočky nese její název sloupec spot_id — nový sloupec kvůli tomu nezakládáme.
    spot_id: predmet === 'pobocka' ? nab.pobocka : nab.spot_id, card_kind: nab.card_kind,
    cena, karty, data, vzkaz: s(b.vzkaz, 200) || null,
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

  // Směr se prohodí, takže se prohodí i to, kdo platí.
  const novySmer = t.smer === 'koupim' ? 'prodam' : 'koupim';
  // Podmínky půjčky a podílu jdou s předmětem — jinak by protinávrh udělal
  // z dvacetiprocentní půjčky na rok bezúročnou na měsíc.
  let data = t.data || null;
  if (t.predmet === 'pujcka') {
    const d = Object.assign({}, data || {});
    if (cena < PUJCKA_MIN) {
      return res.status(400).json({ error: 'Nejmenší půjčka je ' + PUJCKA_MIN.toLocaleString('cs-CZ') + ' L$.' });
    }
    // Zástavu dává dlužník — a po prohození směru se pozná stejně jako u nabídky.
    const dluznikJaJa = novySmer === 'koupim';
    const zast = s((req.body || {}).zastava, 120);
    if (zast === '-') { d.zastava = null; d.zastava_nazev = null; }
    else if (zast) {
      if (!dluznikJaJa) return res.status(409).json({ error: 'Zástavu může dát jen ten, kdo si půjčuje.' });
      const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: zast } });
      if (!c || c.player_id !== req.player.id) {
        return res.status(409).json({ error: 'Zástavou může být jen tvůj prádlomat.' });
      }
      d.zastava = zast; d.zastava_nazev = c.name || zast;
      d.zadam_zastavu = false;      // požadavek je splněný, zástava je na stole
    }
    d.splatka = anuita(cena, Math.max(0, Number(d.urok) || 0), Math.max(1, Math.round(Number(d.mesicu) || 1)));
    data = d;
  }
  // Platím-li po prohození já, musí na to být volná hotovost.
  const platimJa = t.predmet === 'pujcka' ? novySmer === 'prodam' : novySmer === 'koupim';
  if (platimJa && cena > 0) {
    const chybi = await hotovostStaci(req.player, cena, t.id);
    if (chybi) return res.status(409).json({ error: chybi });
  }

  const novy = await prisma.$transaction(async (tx) => {
    await tx.gameTrade.update({ where: { id: t.id }, data: { stav: 'protinavrh', resolved_at: new Date() } });
    // Předmět i směr zůstávají, jen se prohodí, kdo komu píše.
    return tx.gameTrade.create({ data: {
      from_id: req.player.id, from_nick: req.player.nick, to_id: t.from_id, to_nick: t.from_nick,
      smer: novySmer,
      predmet: t.predmet, model: t.model, spot_id: t.spot_id, card_kind: t.card_kind,
      cena, karty, data, vzkaz: s((req.body || {}).vzkaz, 200) || null, parent_id: t.id,
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
  // U půjčky dává peníze ten, od koho se „kupují" — tedy věřitel.
  const platici = t.predmet === 'pujcka' ? prodavajici : kupujici;
  const hotovost = Math.round((stavu(platici).cash) || 0);
  if (t.cena > hotovost) {
    return res.status(409).json({ error: (t.predmet === 'pujcka' ? 'Věřitel' : 'Kupující')
      + ' nemá dost hotovosti (' + hotovost.toLocaleString('cs-CZ') + ' L$).' });
  }
  if (t.predmet === 'podil') {
    const uz = await prodanyPodil(prodavajici.id);
    const p = Number((t.data || {}).podil) || 0;
    if (uz + p > PODIL_MAX + 1e-9) {
      await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
      return res.status(409).json({ error: 'Z firmy je mezitím prodáno už ' + Math.round(uz * 100) + ' %.' });
    }
  }
  let zastavaSpot = t.predmet === 'pujcka' ? ((t.data || {}).zastava || null) : null;
  let zastavaNazev = t.predmet === 'pujcka' ? ((t.data || {}).zastava_nazev || null) : null;
  if (zastavaSpot) {
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: zastavaSpot } });
    if (!c || c.player_id !== kupujici.id) {
      await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
      return res.status(409).json({ error: 'Zastavený prádlomat už dlužníkovi nepatří.' });
    }
  } else if (t.predmet === 'pujcka' && (t.data || {}).zadam_zastavu) {
    // Věřitel si zástavu vymínil, ale vybrat ji může jen dlužník — ten ví,
    // který prádlomat je ochotný dát v sázku.
    if (req.player.id !== kupujici.id) {
      return res.status(409).json({ error: 'Dlužník ještě nevybral zástavu, kterou sis vymínil. '
        + 'Pošli mu protinávrh, nebo počkej, až půjčku přijme se zástavou.' });
    }
    const z = s((req.body || {}).zastava, 120);
    if (!z) {
      return res.status(409).json({ error: 'Věřitel u téhle půjčky chce zástavu — vyber prádlomat, kterým ručíš.' });
    }
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: z } });
    if (!c || c.player_id !== kupujici.id) {
      return res.status(409).json({ error: 'Zástavou může být jen tvůj postavený prádlomat.' });
    }
    zastavaSpot = z; zastavaNazev = c.name || z;
  }

  const karty = Array.isArray(t.karty) ? t.karty : [];
  const popisPredmetu = t.predmet === 'stroj' ? (t.model || '').toUpperCase()
    : t.predmet === 'pradlomat' ? 'prádlomat'
    : t.predmet === 'pobocka' ? ('pobočku ' + (t.spot_id || ''))
    : t.predmet === 'pujcka' ? 'půjčku'
    : t.predmet === 'podil' ? ('podíl ' + Math.round(((t.data || {}).podil || 0) * 100) + ' % ve firmě')
    : 'karta';

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
    // 3a. půjčka: peníze jdou od věřitele dlužníkovi a rozjede se splátkový kalendář
    if (t.predmet === 'pujcka') {
      const d = t.data || {};
      const mesicu = Math.max(1, Math.round(Number(d.mesicu) || 1));
      const urok = Math.max(0, Number(d.urok) || 0);
      const splatka = Math.max(1, Math.round(Number(d.splatka) || anuita(t.cena, urok, mesicu)));
      await tx.gameLoan.create({ data: {
        trade_id: t.id,
        lender_id: prodavajici.id, lender_nick: prodavajici.nick,
        borrower_id: kupujici.id, borrower_nick: kupujici.nick,
        castka: t.cena, urok, mesicu, splatka,
        zastava_spot: zastavaSpot, zastava_nazev: zastavaNazev,
        dalsi_at: new Date(Date.now() + MESIC_MS),
      } });
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'cash', amount: -t.cena,
          popis: 'Půjčil jsi ' + kupujici.nick },
        { player_id: kupujici.id, trade_id: t.id, kind: 'cash', amount: t.cena,
          popis: 'Půjčka od ' + prodavajici.nick },
      ] });
      await tx.gameTrade.update({ where: { id }, data: { stav: 'prijato', resolved_at: new Date() } });
      return;
    }
    // 3b. podíl: investor zaplatí majiteli a od příštího herního měsíce s ním
    // nese zisk i ztrátu.
    if (t.predmet === 'podil') {
      const podil = Number((t.data || {}).podil) || 0;
      await tx.gameEquity.create({ data: {
        trade_id: t.id,
        investor_id: kupujici.id, investor_nick: kupujici.nick,
        firma_id: prodavajici.id, firma_nick: prodavajici.nick,
        podil, cena: t.cena, dalsi_at: new Date(Date.now() + MESIC_MS),
      } });
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

// Kolik stojí doplatit půjčku hned. Je to současná hodnota zbývajících splátek:
// dlužník vrátí jistinu, úrok platí jen za dobu, kterou peníze měl. Lichvu
// za předčasné splacení hra nedělá — kdo má, může kdykoli skončit.
function doplatek(p) {
  const zbyva = Math.max(0, (p.mesicu || 0) - (p.splaceno || 0));
  if (!zbyva) return 0;
  const r = (Number(p.urok) || 0) / 12;
  if (r <= 0) return Math.round(p.splatka * zbyva);
  return Math.round(p.splatka * (1 - Math.pow(1 + r, -zbyva)) / r);
}

// ─── Půjčky a podíly: přehled a odkup ───────────────────────────────────────
// GET /trade/finance → co komu dlužím, kdo dluží mně, kdo má podíl ve mně
// a v kom mám podíl já.
router.get('/trade/finance', hrac, api(async (req, res) => {
  const ja = req.player.id;
  const [pujcky, podily] = await Promise.all([
    prisma.gameLoan.findMany({
      where: { OR: [{ borrower_id: ja }, { lender_id: ja }], stav: { in: ['bezi', 'vymahano'] } },
      orderBy: { dalsi_at: 'asc' }, take: 100,
    }),
    prisma.gameEquity.findMany({
      where: { OR: [{ investor_id: ja }, { firma_id: ja }], stav: 'bezi' },
      orderBy: { created_at: 'asc' }, take: 100,
    }),
  ]);
  res.json({ ok: true,
    pujcky: pujcky.map((p) => ({ id: p.id, moje: p.borrower_id === ja ? 'dluzim' : 'pujcil',
      kdo: p.borrower_id === ja ? p.lender_nick : p.borrower_nick,
      castka: p.castka, urok: p.urok, mesicu: p.mesicu, splatka: p.splatka,
      splaceno: p.splaceno, zmeskano: p.zmeskano, stav: p.stav, doplatek: doplatek(p),
      zastava: p.zastava_nazev || null, dalsi: p.dalsi_at })),
    podily: podily.map((e) => ({ id: e.id, moje: e.investor_id === ja ? 'mam' : 'prodal',
      kdo: e.investor_id === ja ? e.firma_nick : e.investor_nick,
      podil: e.podil, cena: e.cena, vyplaceno: e.vyplaceno,
      odkup: Math.round(e.cena * ODKUP_NASOBEK), dalsi: e.dalsi_at })),
    odkup_nasobek: ODKUP_NASOBEK });
}));

// POST /trade/pujcka/:id/splatit → dlužník doplatí zbytek a je hotovo
router.post('/trade/pujcka/:id/splatit', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gameLoan.findUnique({ where: { id } });
  if (!p || p.stav !== 'bezi') return res.status(404).json({ error: 'Taková půjčka tu neběží.' });
  if (p.borrower_id !== req.player.id) return res.status(403).json({ error: 'Splatit ji může jen dlužník.' });
  const castka = doplatek(p);
  if (castka <= 0) {
    await prisma.gameLoan.update({ where: { id }, data: { stav: 'splaceno' } });
    return res.json({ ok: true, castka: 0 });
  }
  const hotovost = Math.round(stavu(req.player).cash || 0);
  if (castka > hotovost) {
    return res.status(409).json({ error: 'Na doplacení potřebuješ ' + castka.toLocaleString('cs-CZ')
      + ' L$, máš ' + hotovost.toLocaleString('cs-CZ') + ' L$.' });
  }
  await prisma.$transaction(async (tx) => {
    await tx.gameDelivery.createMany({ data: [
      { player_id: p.borrower_id, kind: 'cash', amount: -castka,
        popis: 'Doplatil jsi půjčku — ' + p.lender_nick },
      { player_id: p.lender_id, kind: 'cash', amount: castka,
        popis: p.borrower_nick + ' doplatil půjčku předčasně' },
    ] });
    await tx.gameLoan.update({ where: { id },
      data: { stav: 'splaceno', splaceno: p.mesicu, zmeskano: 0 } });
  });
  console.log('[game] půjčka #' + id + ' doplacena předčasně: ' + castka + ' L$');
  res.json({ ok: true, castka });
}));

// POST /trade/podil/:id/odkup → majitel firmy koupí podíl zpátky
router.post('/trade/podil/:id/odkup', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const e = await prisma.gameEquity.findUnique({ where: { id } });
  if (!e || e.stav !== 'bezi') return res.status(404).json({ error: 'Takový podíl tu není.' });
  if (e.firma_id !== req.player.id) return res.status(403).json({ error: 'Odkoupit podíl může jen majitel firmy.' });
  const cena = Math.round(e.cena * ODKUP_NASOBEK);
  const hotovost = Math.round(stavu(req.player).cash || 0);
  if (cena > hotovost) {
    return res.status(409).json({ error: 'Na odkup potřebuješ ' + cena.toLocaleString('cs-CZ') + ' L$.' });
  }
  await prisma.$transaction(async (tx) => {
    await tx.gameDelivery.createMany({ data: [
      { player_id: e.firma_id, kind: 'cash', amount: -cena,
        popis: 'Odkup podílu od ' + e.investor_nick },
      { player_id: e.investor_id, kind: 'cash', amount: cena,
        popis: e.firma_nick + ' odkoupil tvůj podíl' },
    ] });
    await tx.gameEquity.update({ where: { id }, data: { stav: 'odkoupeno' } });
  });
  res.json({ ok: true, cena });
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

// ─── Tržiště ─────────────────────────────────────────────────────────────────
// Hráč veřejně nabídne postavený prádlomat i s místem za cenu, kterou si řekne.
// Dokud se nabídka neprodá, prádlomat dál patří jemu a normálně vydělává —
// nabídka je jen inzerát. Kdo ji koupí, dostane stroj, nájemní smlouvu,
// přípojky i rozvržení plochy a vydělává hned, bez čekání na výrobu.
const TRH_MESICU = [1, 3, 6, 12];      // na jak dlouho se dá vystavit (herní měsíce)
const TRH_MESIC_MS = 43200000;         // herní měsíc = 12 skutečných hodin
const TRH_MAX_NABIDEK = 12;            // kolik nabídek může mít jeden hráč naráz

function trhPub(m, ja) {
  return {
    id: m.id, nick: m.nick, firma: m.firma || (m.nick + ' s.r.o.'),
    spot_id: m.spot_id, name: m.name, model: m.model, kind: m.kind, score: m.score,
    lat: m.lat, lon: m.lon, rent: m.rent, zisk: m.zisk, obrat: m.obrat,
    investice: m.investice, cena: m.cena, od: m.od, konci: m.do,
    moje: m.player_id === ja,
  };
}

// GET /trade/trh → co je právě na tržišti
router.get('/trade/trh', hrac, api(async (req, res) => {
  const rows = await prisma.gameMarket.findMany({
    where: { koupil_id: null, zruseno_at: null, do: { gt: new Date() } },
    orderBy: { created_at: 'desc' }, take: 200,
  });
  res.json({ ok: true, trh: rows.map((m) => trhPub(m, req.player.id)) });
}));

// POST /trade/trh { spot_id, cena, mesicu, zisk, obrat, investice, plan }
// Vystavení vlastního prádlomatu. Místo musí pořád patřit prodávajícímu a musí
// na něm opravdu stroj stát — holý pozemek se takhle neprodává.
router.post('/trade/trh', hrac, api(async (req, res) => {
  const b = req.body || {};
  const spot = s(b.spot_id, 120);
  const cena = Math.round(Number(b.cena) || 0);
  const mesicu = TRH_MESICU.includes(parseInt(b.mesicu, 10)) ? parseInt(b.mesicu, 10) : 3;
  if (!spot) return res.status(400).json({ error: 'Které místo?' });
  if (!(cena >= 1000) || cena > MAX_CENA) return res.status(400).json({ error: 'Cena musí být aspoň 1 000 L$.' });
  const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
  if (!c || c.player_id !== req.player.id) return res.status(409).json({ error: 'Tohle místo ti nepatří.' });
  if (!c.model) return res.status(400).json({ error: 'Na tomhle místě žádný prádlomat nestojí.' });
  if (c.najemce_id) return res.status(409).json({ error: 'Pozemek máš pronajatý jinému hráči.' });
  const bezi = await prisma.gameMarket.findFirst({
    where: { spot_id: spot, koupil_id: null, zruseno_at: null, do: { gt: new Date() } } });
  if (bezi) return res.status(409).json({ error: 'Tohle místo už na tržišti je.' });
  const kolik = await prisma.gameMarket.count({
    where: { player_id: req.player.id, koupil_id: null, zruseno_at: null, do: { gt: new Date() } } });
  if (kolik >= TRH_MAX_NABIDEK) return res.status(429).json({ error: 'Víc než ' + TRH_MAX_NABIDEK + ' nabídek naráz mít nemůžeš.' });

  const m = await prisma.gameMarket.create({ data: {
    player_id: req.player.id, nick: req.player.nick, firma: req.player.company,
    spot_id: spot, area_key: c.area_key, name: c.name, model: c.model,
    kind: s(b.kind, 40) || null, score: Math.max(0, Math.min(100, Math.round(Number(b.score) || 60))),
    lat: c.lat, lon: c.lon, rent: Math.max(0, Math.round(c.rent || 0)),
    zisk: Math.round(Number(b.zisk) || 0), obrat: Math.max(0, Math.round(Number(b.obrat) || 0)),
    investice: Math.max(0, Math.round(Number(b.investice) || 0)),
    cena, plan: b.plan || null,
    do: new Date(Date.now() + mesicu * TRH_MESIC_MS),
  } });
  console.log('[game] tržiště: ' + req.player.nick + ' nabízí ' + (c.name || spot) + ' za ' + cena + ' L$');
  res.json({ ok: true, nabidka: trhPub(m, req.player.id) });
}));

// POST /trade/trh/:id/stahnout → vlastní nabídku jde kdykoli stáhnout
router.post('/trade/trh/:id/stahnout', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const m = await prisma.gameMarket.findUnique({ where: { id } });
  if (!m || m.player_id !== req.player.id) return res.status(404).json({ error: 'Taková nabídka tu není.' });
  if (m.koupil_id) return res.status(409).json({ error: 'Tohle už někdo koupil.' });
  await prisma.gameMarket.update({ where: { id }, data: { zruseno_at: new Date() } });
  res.json({ ok: true });
}));

// POST /trade/trh/:id/koupit → kupující platí, místo i stroj mění majitele
router.post('/trade/trh/:id/koupit', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const m = await prisma.gameMarket.findUnique({ where: { id } });
  if (!m || m.zruseno_at) return res.status(404).json({ error: 'Taková nabídka tu není.' });
  if (m.koupil_id) return res.status(409).json({ error: 'Tohle už někdo koupil.' });
  if (new Date(m.do).getTime() < Date.now()) return res.status(409).json({ error: 'Nabídka už vypršela.' });
  if (m.player_id === req.player.id) return res.status(400).json({ error: 'Vlastní nabídku si nekoupíš.' });
  // Mezitím mohl prodávající místo prodat jinak nebo o něj přijít.
  const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: m.spot_id } });
  if (!c || c.player_id !== m.player_id || !c.model) {
    await prisma.gameMarket.update({ where: { id }, data: { zruseno_at: new Date() } });
    return res.status(409).json({ error: 'Prádlomat už prodávajícímu nepatří. Nabídku jsme stáhli.' });
  }

  await prisma.$transaction(async (tx) => {
    const zabrano = await tx.gameMarket.updateMany({
      where: { id: m.id, koupil_id: null, zruseno_at: null },
      data: { koupil_id: req.player.id, koupil_nick: req.player.nick, koupeno_at: new Date() },
    });
    if (!zabrano.count) throw Object.assign(new Error('Tohle už někdo koupil.'), { stav: 409 });
    await tx.gameSpotClaim.update({ where: { spot_id: m.spot_id },
      data: { player_id: req.player.id, nick: req.player.nick } });
    const popis = 'prádlomat ' + (m.name || m.spot_id) + ' z tržiště';
    await tx.gameDelivery.createMany({ data: [
      { player_id: m.player_id, kind: 'unit_remove', spot_id: m.spot_id,
        popis: 'Prodal jsi ' + popis + ' hráči ' + req.player.nick },
      { player_id: req.player.id, kind: 'unit_add', spot_id: m.spot_id, model: m.model,
        data: { name: m.name, lat: m.lat, lon: m.lon, rent: m.rent, area_key: m.area_key,
          kind: m.kind, score: m.score, invest: m.cena, plan: m.plan || null },
        popis: 'Koupil jsi ' + popis },
      { player_id: req.player.id, kind: 'cash', amount: -m.cena, popis: 'Zaplatil jsi za ' + popis },
      { player_id: m.player_id, kind: 'cash', amount: m.cena, popis: 'Utržil jsi za ' + popis },
    ] });
  });

  console.log('[game] tržiště prodej: ' + m.nick + ' → ' + req.player.nick + ' · ' + (m.name || m.spot_id) + ' za ' + m.cena + ' L$');
  res.json({ ok: true, cena: m.cena });
}));

module.exports = router;
