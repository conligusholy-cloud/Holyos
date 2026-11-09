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
// Znak je jen trojice čísel „tvar-paleta-symbol". Obrázek z nich složí prohlížeč.
const ZNAK_RE = /^[0-9]{1,2}-[0-9]{1,2}-[0-9]{1,2}$/;
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
  // Z ceníku bereme jen cenu, počet laundrů a jestli se prodává. Název a popis
  // patří ke kódu — jinak by v databázi uvízl starý název z dřívějšího seedu.
  return Object.assign({}, base, { price: p.price, laundry: p.laundry != null ? p.laundry : base.laundry });
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
    nick: p.nick, company: p.company || (p.nick + ' s.r.o.'), emblem: p.emblem || null,
    ref: p.ref_id || null,
    email: p.email || null,
    first_name: p.first_name || null, last_name: p.last_name || null,
    has_details: !!(p.email && p.first_name && p.last_name),
    cards: counts, state_at: p.state_at
  };
}

// Sazby profilů — musí sedět s PROFILES v public/compounder/game/game.js.
// Server je potřebuje jen tehdy, když uložená síť ještě nemá rozepsané úvěry.
const PROFIL_SAZBA = { opatrny: 0.096, vyvazeny: 0.114, dravy: 0.132 };
function urokMesicne(st) {
  const dluh = Number(st && st.loan) || 0;
  if (dluh <= 0) return 0;
  const zaklad = PROFIL_SAZBA[st.profile] != null ? PROFIL_SAZBA[st.profile] : 0.114;
  const sazba = Math.max(0.02, zaklad - (Number(st.rateDrop) || 0) + (Number(st.loanPrem) || 0));
  return Math.round(dluh * sazba / 12);
}
// Celá měsíční splátka — úrok i jistina, stejně jako splatkyMesicne() ve hře.
// Stará síť bez pole `loans` umí nanejvýš úrok, takže se vrátí aspoň ten.
function splatkyMesicne(st) {
  const uvery = Array.isArray(st && st.loans) ? st.loans : null;
  if (!uvery) return urokMesicne(st);
  return Math.round(uvery.reduce((a, l) => {
    const zbyva = Number(l && l.zbyva) || 0;
    if (zbyva <= 0) return a;
    const urok = zbyva * (Number(l.sazba) || 0) / 12;
    return a + Math.min(Number(l.splatka) || 0, zbyva + urok);
  }, 0));
}
// Čisté jmění: co hráč má, minus co dluží. Postavené prádlomaty, stroje
// skladem i na cestě, pobočky a technika čety v pořizovací ceně, plus hotovost,
// minus nesplacený úvěr. Rámec v bance se nepočítá — to nejsou jeho peníze.
const POBOCKA_CENA = 500000, CETA_CENA = 1530000;
// Musí sedět s cisteJmeni() v public/compounder/game/game.js — hráč vidí totéž
// číslo v záložce Já i v žebříčku a nesmí se lišit.
function cisteJmeni(st) {
  if (!st) return 0;
  const units = Array.isArray(st.units) ? st.units : [];
  let majetek = units.reduce((a, u) => a + ((u && u.eco && u.eco.invest) || 0), 0);
  const sk = (st.stock && typeof st.stock === 'object') ? st.stock : {};
  Object.keys(sk).forEach((k) => {
    majetek += (Number(sk[k]) || 0) * (CENY_STROJU[k] || CENY_STROJU.mini);
  });
  (Array.isArray(st.orders) ? st.orders : []).forEach((o) => {
    majetek += CENY_STROJU[(o && o.model)] || CENY_STROJU.mini;
  });
  majetek += (Array.isArray(st.pobocky) ? st.pobocky.length : 0) * POBOCKA_CENA;
  if (st.ceta && st.ceta.od) majetek += CETA_CENA;
  // Koupené pozemky jsou nemovitost a patří do majetku vždy — i prázdné, i ty
  // pod stojícím prádlomatem. V eco.invest je jen stroj a příprava plochy.
  // Musí sedět s pozemkyHodnota() v public/compounder/game/game.js.
  (Array.isArray(st.pozemky) ? st.pozemky : []).forEach((z) => {
    majetek += (z && Number(z.cena)) || 0;
    // Příprava plochy zaplacená dopředu, ještě bez stroje, drží u pozemku.
    majetek += (z && Number(z.priprava)) || 0;
  });
  return Math.round(majetek + (Number(st.cash) || 0) - (Number(st.loan) || 0));
}

// Co hráči měsíčně opravdu zbyde — jediná definice pro žebříček i Velín.
// Musí dávat to samé číslo jako cistyZisk() v public/compounder/game/game.js,
// jinak by administrace ukazovala něco jiného než hráč vidí v hlavičce.
const POBOCKA_MESICNE = 15000, CETA_MZDY = 80000, SHANEC_MZDA = 50000;
function zbydeMesicne(st) {
  if (!st) return 0;
  const units = Array.isArray(st.units) ? st.units : [];
  const provozni = units.reduce((a, u) => a + ((u.eco && u.eco.profit) || 0), 0);
  const pobocky = (Array.isArray(st.pobocky) ? st.pobocky.length : 0) * POBOCKA_MESICNE;
  const ceta = (st.ceta && st.ceta.od)
    ? CETA_MZDY + (st.ceta.shanec ? SHANEC_MZDA : 0) + (Number(st.ceta.phm) || 0) : 0;
  return Math.round(provozni - splatkyMesicne(st) - pobocky - ceta);
}

// ─── Distributor ────────────────────────────────────────────────────────────
// Kdo si platí měsíční režii, dostává 10 % z ceny každého prádlomatu, který
// postaví hráč, jehož do hry přivedl. Není to automatické — režie se musí
// každý herní měsíc obnovit, jinak výhoda spadne.
const DIST_REZIE = 40000;         // dávka režie za herní měsíc
const DIST_NA_HRACU = 5;          // za každých pět přivedených jedna dávka
const DIST_PROVIZE = 0.10;        // podíl z ceny prádlomatu
const MESIC_MS = 43200000;        // herní měsíc = 12 skutečných hodin
// Ceny strojů musí sedět s MODELS v public/compounder/game/game.js.
const CENY_STROJU = { mini: Math.round(35000 * 24.35 * 1.25), flex: Math.round(52000 * 24.35 * 1.25),
  max: Math.round(67000 * 24.35 * 1.25) };
// Koho hráč přivedl. Počítají se i ti, u kterých se vazba zapsala jen přes odkaz
// (invited_by_ref) a nikdy se nedopočítala napevno — jinak by hráč přišel o provize
// za člověka, kterého prokazatelně přivedl. Při té přížitosti vazbu srovnáme.
async function privedeniHraci(zvouci, select) {
  if (!zvouci) return [];
  const kde = [{ invited_by_id: zvouci.id }];
  if (zvouci.ref_id) kde.push({ invited_by_ref: zvouci.ref_id, invited_by_id: null });
  const lide = await prisma.gamePlayer.findMany({
    where: { OR: kde, NOT: { id: zvouci.id } },
    select: Object.assign({ id: true, invited_by_id: true }, select || {}),
    orderBy: { created_at: 'asc' }, take: 500,
  });
  const utrzene = lide.filter((h) => !h.invited_by_id).map((h) => h.id);
  if (utrzene.length) {
    await prisma.gamePlayer.updateMany({
      where: { id: { in: utrzene } }, data: { invited_by_id: zvouci.id },
    }).catch((e) => console.warn('[game] doplneni vazby pozvani:', e.message));
  }
  return lide;
}
async function privedenych(id) {
  const p = await prisma.gamePlayer.findUnique({ where: { id }, select: { id: true, ref_id: true } });
  return (await privedeniHraci(p)).length;
}
// Do pěti přivedených je distribuce zdarma — jinak odrazuje dřív, než
// stačí něco vydělat. Od pátého se platí dávka za každých začatých pět.
function distRezie(privedeno) {
  return DIST_REZIE * Math.floor((Number(privedeno) || 0) / DIST_NA_HRACU);
}
function distAktivni(p) {
  return !!(p && p.distributor_do && new Date(p.distributor_do).getTime() > Date.now());
}

// Kdo stavitele do hry přivedl. Normálně to řeší invited_by_id, ale účet
// se může zapsat dřív, než si zvoucí narokoval svoje sdílené id — pak zůstane
// jen invited_by_ref. Dohledáme ho podle něj a vazbu rovnou doplníme,
// aby se to příště nemuselo řešit.
async function kdoPrivedl(stavitel) {
  if (!stavitel) return null;
  if (stavitel.invited_by_id) {
    return prisma.gamePlayer.findUnique({ where: { id: stavitel.invited_by_id } });
  }
  if (!stavitel.invited_by_ref) return null;
  const zvouci = await prisma.gamePlayer.findUnique({ where: { ref_id: stavitel.invited_by_ref } });
  if (!zvouci || zvouci.id === stavitel.id) return null;
  try {
    await prisma.gamePlayer.update({ where: { id: stavitel.id }, data: { invited_by_id: zvouci.id } });
  } catch (e) { console.warn('[game] doplneni vazby pozvani:', e.message); }
  return zvouci;
}

// Provize se platí za koupený stroj — hned, ne až když ho někdo postaví.
// Stroje čteme z uložené sítě pozvaného: co už stojí, co je na cestě a co
// čeká skladem. Každý kus se platí nejvýš jednou — doručenka si pamatuje klíč.
function strojeHrace(st) {
  if (!st) return [];
  const out = [];
  (Array.isArray(st.units) ? st.units : []).forEach((u) => out.push((u && u.eco && u.eco.model) || 'mini'));
  (Array.isArray(st.orders) ? st.orders : []).forEach((o) => out.push((o && o.model) || 'mini'));
  const sk = (st.stock && typeof st.stock === 'object') ? st.stock : {};
  Object.keys(sk).forEach((k) => { for (let i = 0; i < (Number(sk[k]) || 0); i++) out.push(k); });
  return out;
}
// Dopočítá všechno, co zvoucímu ještě nebylo vyplaceno. Běží při každém nákupu
// stroje v jeho síti i při otevření záložky Já, takže dohná i to, co vzniklo
// dřív, než si distribuci zaplatil.
async function dorovnejProvize(zvouci) {
  if (!distAktivni(zvouci)) return 0;
  const lide = await privedeniHraci(zvouci, { nick: true, state: true });
  if (!lide.length) return 0;
  const hotove = await prisma.gameDelivery.findMany({
    where: { player_id: zvouci.id, kind: 'cash', popis: { startsWith: 'Provize' } },
    select: { spot_id: true } });
  const klice = new Set(hotove.map((d) => d.spot_id).filter(Boolean));
  let celkem = 0;
  for (const h of lide) {
    const stroje = strojeHrace(h.state);
    if (!stroje.length) continue;
    // Co se dřív vyplatilo za postavené místo, je týž stroj — nesmí se platit znovu.
    const mista = await prisma.gameSpotClaim.findMany({
      where: { player_id: h.id }, select: { spot_id: true } });
    let preskoc = mista.filter((m) => klice.has(m.spot_id)).length;
    for (let i = 0; i < stroje.length; i++) {
      const klic = 'nakup:' + h.id + ':' + i;
      if (klice.has(klic)) continue;
      if (preskoc > 0) { preskoc--; continue; }
      const model = stroje[i];
      const castka = Math.round((CENY_STROJU[model] || CENY_STROJU.mini) * DIST_PROVIZE);
      await prisma.gameDelivery.create({
        data: { player_id: zvouci.id, kind: 'cash', amount: castka, spot_id: klic,
          popis: 'Provize ' + castka.toLocaleString('cs-CZ') + ' L$ — ' + h.nick
            + ' koupil ' + String(model).toUpperCase() },
      });
      klice.add(klic);
      celkem += castka;
    }
  }
  if (celkem) {
    await prisma.gamePlayer.update({ where: { id: zvouci.id },
      data: { provize_celkem: { increment: celkem } } });
    console.log('[game] provize ' + celkem + ' L$ pro ' + zvouci.nick);
  }
  return celkem;
}

// POST /account/nakup — hráč právě koupil stroj. Kdo ho do hry přivedl a platí
// si distribuci, dostane provizi hned, bez čekání na dovoz a stavbu.
// Částka se neposílá z klienta — server si ji spočítá z uložené sítě.
router.post('/account/nakup', requirePlayer, async (req, res, next) => {
  try {
    const zvouci = await kdoPrivedl(req.player);
    const vyplaceno = zvouci ? await dorovnejProvize(zvouci) : 0;
    res.json({ ok: true, vyplaceno });
  } catch (e) { next(e); }
});

// GET /account/provize → z čeho se vydělané provize složily. Komu a kdy se co
// připsalo — hráč má mít čím si to zkontrolovat, ne jen jedno velké číslo.
router.get('/account/provize', requirePlayer, async (req, res, next) => {
  try {
    const rows = await prisma.gameDelivery.findMany({
      where: { player_id: req.player.id, kind: 'cash', popis: { startsWith: 'Provize' } },
      orderBy: { id: 'desc' }, take: 200,
      select: { amount: true, popis: true, created_at: true, claimed_at: true },
    });
    res.json({ ok: true, provize: rows.map((d) => ({
      castka: d.amount,
      // V popisu je za pomlčkou „Kdo koupil co“ — to je přesně, co chceme ukázat.
      zac: (String(d.popis || '').split(' — ')[1] || String(d.popis || '')).trim(),
      kdy: d.created_at,
      vyzvednuto: d.claimed_at || null,
    })) });
  } catch (e) { next(e); }
});

// GET /account/distributor → stav programu
router.get('/account/distributor', requirePlayer, async (req, res, next) => {
  try {
    let p = await prisma.gamePlayer.findUnique({ where: { id: req.player.id } });
    // Co se nevyplatilo včas, dorovnáme teď — hráč se nemá doprošovat.
    try {
      if (await dorovnejProvize(p)) p = await prisma.gamePlayer.findUnique({ where: { id: p.id } });
    } catch (e) { console.warn('[game] dorovnani provizi:', e.message); }
    const privedeno = await privedenych(p.id);
    res.json({ ok: true, aktivni: distAktivni(p), do: p.distributor_do,
      privedeno, rezie: distRezie(privedeno), provize: DIST_PROVIZE,
      provize_celkem: p.provize_celkem || 0, mesic_ms: MESIC_MS });
  } catch (e) { next(e); }
});

// POST /account/distributor → obnovení na další herní měsíc
// Peníze strhává klient ze své hotovosti, server hlídá jen období a cenu.
router.post('/account/distributor', requirePlayer, async (req, res, next) => {
  try {
    const p = await prisma.gamePlayer.findUnique({ where: { id: req.player.id } });
    const privedeno = await privedenych(p.id);
    const rezie = distRezie(privedeno);
    // Navazujeme na dosud zaplacené období, ať hráč nepřijde o zbytek měsíce.
    const od = distAktivni(p) ? new Date(p.distributor_do).getTime() : Date.now();
    const doKdy = new Date(od + MESIC_MS);
    const up = await prisma.gamePlayer.update({ where: { id: p.id }, data: { distributor_do: doKdy } });
    res.json({ ok: true, do: up.distributor_do, rezie, privedeno });
  } catch (e) { next(e); }
});

// ─── Pozvánky ────────────────────────────────────────────────────────────────
// Každý hráč má svoje id do sdíleného odkazu (ref_id). Kdo přijde přes cizí
// odkaz a založí si účet, zůstane u zvoucího zapsaný natrvalo — z toho se dá
// později postavit distributorský program s odměnami.
const REF_RE = /^[a-z0-9]{6,24}$/;

// Hráč si nárokuje svoje sdílené id. Platí „kdo dřív přijde": jedno id patří
// jednomu účtu a už se nepřepisuje, jinak by si hráč přihlášením na novém
// zařízení přepsal odkaz, který má rozeslaný. Zároveň doplníme účet všem,
// koho přivedl dřív, než se sám zaregistroval.
async function narokujRef(player, ref) {
  const id = String(ref || '').toLowerCase();
  if (!REF_RE.test(id)) return player;
  let p = player;
  if (player.ref_id !== id) {
    if (player.ref_id) return player;                       // svoje id už má
    const obsazeno = await prisma.gamePlayer.findUnique({ where: { ref_id: id }, select: { id: true } });
    if (obsazeno) return player;                            // id patří někomu jinému
    try { p = await prisma.gamePlayer.update({ where: { id: player.id }, data: { ref_id: id } }); }
    catch (e) { return player; }                            // závod dvou zařízení
  }
  await prisma.gamePlayer.updateMany({
    where: { invited_by_ref: id, invited_by_id: null, NOT: { id: p.id } },
    data: { invited_by_id: p.id }
  });
  return p;
}

// Zapíše, kdo nového hráče přivedl. Jen při registraci — vazba se později
// nepřepisuje, aby se nedala vyrobit zpětně.
async function zapisPozvani(player, odkud) {
  const id = String(odkud || '').toLowerCase();
  if (!REF_RE.test(id) || id === player.ref_id) return player;
  const zvouci = await prisma.gamePlayer.findUnique({ where: { ref_id: id }, select: { id: true } });
  if (zvouci && zvouci.id === player.id) return player;     // vlastní odkaz se nepočítá
  return prisma.gamePlayer.update({
    where: { id: player.id },
    data: { invited_by_ref: id, invited_by_id: zvouci ? zvouci.id : null, invited_at: new Date() }
  });
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
    // Pozvánky: hráč si drží svoje sdílené id a zapíšeme, kdo ho přivedl.
    let hrac = p;
    try {
      hrac = await narokujRef(hrac, (req.body || {}).ref);
      hrac = await zapisPozvani(hrac, (req.body || {}).odkud);
    } catch (e) { console.warn('[game] pozvánky při registraci:', e.message); }
    setCookie(res, sign(hrac));
    res.json({ ok: true, player: await pub(hrac) });
    // Majitelé to mají vědět hned — do Velína i na zvonek. Nečekáme na to.
    require('../services/game/notify').newPlayer(prisma, hrac);
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
    let hrac = await prisma.gamePlayer.update({ where: { id: p.id }, data: { last_login_at: new Date() } });
    // Účty z doby před pozvánkami si při prvním přihlášení nárokují svoje sdílené id.
    try { hrac = await narokujRef(hrac, (req.body || {}).ref); }
    catch (e) { console.warn('[game] pozvánky při přihlášení:', e.message); }
    setCookie(res, sign(hrac));
    res.json({ ok: true, player: await pub(hrac), state: hrac.state || null });
  } catch (e) { next(e); }
});

// POST /account/logout
router.post('/account/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

// GET /account/me → { player, state } nebo 401
// Sdílené id se narokuůje i tady, ne jen při přihlášení. Kdo zůstává
// přihlášený cookie a znovu se nepřihlásil, by ho jinak nedostal nikdy —
// rozesílal by odkaz s id, které na serveru nikomu nepatří, a nikdo z těch,
// kdo přes něj přišli, by se mu nezapsal do sítě.
router.get('/account/me', requirePlayer, async (req, res, next) => {
  try {
    let p = req.player;
    try { p = await narokujRef(p, req.query.ref); }
    catch (e) { console.warn('[game] narokovani ref v /me:', e.message); }
    res.json({ ok: true, player: await pub(p), state: p.state || null });
  } catch (e) { next(e); }
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

// GET /account/invited → koho hráč přivedl do hry
// Přesný seznam, ne jen počet — na tomhle se dá postavit odměna pro „distributory".
router.get('/account/invited', requirePlayer, async (req, res, next) => {
  try {
    const me = await prisma.gamePlayer.findUnique({
      where: { id: req.player.id }, select: { id: true, ref_id: true }
    });
    const lide = await privedeniHraci(me, {
      nick: true, company: true, emblem: true, invited_at: true, created_at: true, state: true,
    });
    // U každého je vidět, kolik má strojů a kolik z něj už přišlo — když někde
    // provize vázne, hráč hned vidí u koho, místo aby hádal.
    const dorucenky = await prisma.gameDelivery.findMany({
      where: { player_id: req.player.id, kind: 'cash', popis: { startsWith: 'Provize' } },
      select: { amount: true, spot_id: true }, take: 1000,
    });
    const zabory = lide.length
      ? await prisma.gameSpotClaim.findMany({
          where: { player_id: { in: lide.map((h) => h.id) } },
          select: { player_id: true, spot_id: true }, take: 2000,
        })
      : [];
    const mistoHrace = {};
    zabory.forEach((z) => { mistoHrace[z.spot_id] = z.player_id; });
    const podleHrace = {};
    dorucenky.forEach((d) => {
      const k = String(d.spot_id || '');
      // Novější provize mají klíč „nakup:<id hráče>:<pořadí>“, starší id místa.
      const id = k.indexOf('nakup:') === 0 ? Number(k.split(':')[1]) : mistoHrace[k];
      if (!id) return;
      const z = podleHrace[id] || (podleHrace[id] = { pocet: 0, castka: 0 });
      z.pocet++; z.castka += d.amount || 0;
    });
    res.json({
      ok: true, ref: (me && me.ref_id) || null,
      lide: lide.map((h) => ({
        nick: h.nick, firma: h.company || (h.nick + ' s.r.o.'), znak: h.emblem || null,
        kdy: h.invited_at || h.created_at,
        stroju: strojeHrace(h.state).length,
        provizi: (podleHrace[h.id] || {}).pocet || 0,
        provize: (podleHrace[h.id] || {}).castka || 0,
      }))
    });
  } catch (e) { next(e); }
});

// POST /account/emblem { emblem } — znak firmy
router.post('/account/emblem', requirePlayer, async (req, res, next) => {
  try {
    const e = s((req.body || {}).emblem, 16);
    if (e && !ZNAK_RE.test(e)) return res.status(400).json({ error: 'Neplatný znak.' });
    const p = await prisma.gamePlayer.update({ where: { id: req.player.id }, data: { emblem: e || null } });
    dropZeb();
    res.json({ ok: true, player: await pub(p) });
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
// POST /account/tutorial-card → kdo ještě nic nepostavil a nemá Expresní dovoz,
// dostane jeden kus. Tutoriál na něm stojí — bez něj by hráč čekal celý den.
// Hráči, který si už něco postavil, se nevydá nic.
router.post('/account/tutorial-card', requirePlayer, async (req, res, next) => {
  try {
    const stoji = await prisma.gameSpotClaim.count({ where: { player_id: req.player.id } });
    const vsechny = await prisma.gameCard.count({ where: { player_id: req.player.id, kind: 'rush' } });
    const volne = await prisma.gameCard.count({
      where: { player_id: req.player.id, kind: 'rush', used_at: null }
    });
    // Strop na tři kusy, ať se karta nedá vyrábět opakovaným použitím.
    if (stoji === 0 && volne === 0 && vsechny < 3) {
      await prisma.gameCard.create({ data: { player_id: req.player.id, kind: 'rush' } });
    }
    res.json({ ok: true, owned: (await pub(req.player)).cards });
  } catch (e) { next(e); }
});

// ─── Expresní dovoz zdarma ─────────────────────────────────────
// Každé dva herní měsíce (jeden skutečný den) přibude jedna karta zdarma, ať
// hráč nemusí čekat den na každý stroj. Nepoužité se hromadí jen do pěti —
// čas běží dál, ale zásoba nenabývá donekonečna.
const RUSH_ZDARMA_MS = 2 * MESIC_MS;
const RUSH_ZDARMA_MAX = 5;
async function dosypExpresniDovoz(p) {
  if (!p) return null;
  const ted = Date.now();
  if (!p.rush_zdarma_at) {
    // První pohled: začínáme počítat teď, ne zpětně od založení účtu.
    return prisma.gamePlayer.update({ where: { id: p.id }, data: { rush_zdarma_at: new Date(ted) } });
  }
  const od = new Date(p.rush_zdarma_at).getTime();
  const period = Math.floor((ted - od) / RUSH_ZDARMA_MS);
  if (period < 1) return p;
  const volnych = await prisma.gameCard.count({
    where: { player_id: p.id, kind: 'rush', used_at: null },
  });
  const dat = Math.max(0, Math.min(period, RUSH_ZDARMA_MAX - volnych));
  if (dat > 0) {
    await prisma.gameCard.createMany({
      data: Array.from({ length: dat }, () => ({ player_id: p.id, kind: 'rush' })),
    });
    console.log('[game] expresni dovoz zdarma: ' + dat + ' ks pro ' + p.nick);
  }
  // Čas posuneme vždycky, i když už měl plné zásoby — jinak by se bankovalo.
  return prisma.gamePlayer.update({ where: { id: p.id },
    data: { rush_zdarma_at: new Date(od + period * RUSH_ZDARMA_MS) } });
}
// Za jak dlouho přijde další.
function rushZdarmaZa(p) {
  if (!p || !p.rush_zdarma_at) return RUSH_ZDARMA_MS;
  const zbyva = new Date(p.rush_zdarma_at).getTime() + RUSH_ZDARMA_MS - Date.now();
  return Math.max(0, zbyva);
}

// GET /cards → katalog + co hráč vlastní
router.get('/cards', async (req, res, next) => {
  try {
    let p = await currentPlayer(req);
    if (p) {
      try { p = await dosypExpresniDovoz(p) || p; }
      catch (e) { console.warn('[game] expresni dovoz zdarma:', e.message); }
    }
    res.json({
      ok: true, catalog: await catalogPublic(), cash: await cashPublic(),
      payments: require('./game-stripe.routes')._paymentsOn(),
      owned: p ? (await pub(p)).cards : null,
      rush_zdarma_za: p ? rushZdarmaZa(p) : null,
      rush_zdarma_max: RUSH_ZDARMA_MAX,
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
      // Zakoupené balíčky dobíjejí rámec v bance, ne hotovost — proto se to
      // jmenuje „Dobít banku". Hráč si pak peníze půjčí, jak potřebuje.
      const c = await item(kind);
      const castka = (c && c.laundry) || CASH[kind].laundry;
      result = { effect: 'ramec', amount: castka,
        msg: 'Rámec v bance se zvedl o ' + castka.toLocaleString('cs-CZ') + ' L$.' };
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
  (await prisma.gamePlayer.findMany({ select: { id: true, company: true, nick: true, emblem: true } }))
    .forEach((h) => { m[h.id] = { firma: h.company || (h.nick + ' s.r.o.'), znak: h.emblem || null }; });
  return m;
}
// Ke každému hráči země, ve kterých mu stojí prádlomaty — od té, kde jich má
// nejvíc. Země visí na prozkoumaném městě, takže stačí spojit zábory s městy.
// „xx“ značí město, u kterého se zemi nepodařilo zjistit — to vlaječku nedostane.
const ZEME_MAX = 6;
async function zemeHracu() {
  const [zabory, mesta] = await Promise.all([
    prisma.gameSpotClaim.findMany({ select: { player_id: true, area_key: true } }),
    prisma.gameArea.findMany({ where: { country: { not: null } }, select: { key: true, country: true } }),
  ]);
  const zeme = {};
  mesta.forEach((m) => { if (m.country && m.country !== 'xx') zeme[m.key] = m.country; });
  const pocty = {};
  zabory.forEach((z) => {
    const cc = zeme[z.area_key];
    if (!cc) return;
    const k = pocty[z.player_id] || (pocty[z.player_id] = {});
    k[cc] = (k[cc] || 0) + 1;
  });
  const out = {};
  Object.keys(pocty).forEach((id) => {
    out[id] = Object.keys(pocty[id]).sort((a, b) => pocty[id][b] - pocty[id][a]).slice(0, ZEME_MAX);
  });
  return out;
}
// Hvězdičky z infolinky: pověst −100 je jedna hvězda, 0 tři, +100 pět.
// Musí sedět s hvezdy() v public/compounder/game/game.js.
function hvezdyZPovesti(st) {
  const p = Math.max(-100, Math.min(100, Number(st && st.povest) || 0));
  return Math.round((3 + p / 50) * 10) / 10;
}
let _zeb = { at: 0, data: null };
function dropZeb() { _zeb = { at: 0, data: null }; }
async function zebricky() {
  if (Date.now() - _zeb.at < 30e3 && _zeb.data) return _zeb.data;
  const [mista, hraci, zemeMap] = await Promise.all([
    prisma.gameSpotClaim.groupBy({ by: ['player_id', 'nick'], _count: { _all: true } }),
    prisma.gamePlayer.findMany({
      where: { disabled: false, state: { not: null } },
      orderBy: { state_at: 'desc' }, take: 500,
      select: { id: true, nick: true, company: true, emblem: true, state: true },
    }),
    // Kdyby sloupec se zemí ještě nebyl v databázi, žebříček kvůli vlaječkám
    // spadnout nesmí — prostě se nevykreslí.
    zemeHracu().catch(() => ({})),
  ]);
  // Firmy doplníme k nickům z míst — v žebříčku chceme vidět, kdo je kdo.
  const firmy = await firmyMapa();
  const poMistech = mista.map((m) => ({ id: m.player_id, nick: m.nick,
    firma: firmy[m.player_id] && firmy[m.player_id].firma, znak: firmy[m.player_id] && firmy[m.player_id].znak,
    zeme: zemeMap[m.player_id] || [], hodnota: m._count._all }))
    .sort((a, b) => b.hodnota - a.hodnota);

  const zisk = [], pozvanky = [], jmeni = [], hvezdy = [];
  hraci.forEach((h) => {
    const st = h.state || {};
    // To, co hráči opravdu zbyde — stejně jako mu to svítí v hlavičce hry.
    const mesicne = zbydeMesicne(st);
    const fi = h.company || (h.nick + ' s.r.o.');
    const zm = zemeMap[h.id] || [];
    if (mesicne > 0) zisk.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm, hodnota: Math.round(mesicne) });
    if (st.refs > 0) pozvanky.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm, hodnota: st.refs });
    // Do žebříčku jmění patří i ten, kdo je v minusu — právě to je vidět.
    if (st.profile) jmeni.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm, hodnota: cisteJmeni(st) });
    // Kdo ještě žádný hovor neměl, nemá se podle čeho hodnotit — startuje se na třech.
    if (st.profile && (st.hovoru || 0) > 0) {
      hvezdy.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm,
        hodnota: hvezdyZPovesti(st) });
    }
  });
  zisk.sort((a, b) => b.hodnota - a.hodnota);
  pozvanky.sort((a, b) => b.hodnota - a.hodnota);
  jmeni.sort((a, b) => b.hodnota - a.hodnota);
  hvezdy.sort((a, b) => b.hodnota - a.hodnota);

  _zeb = { at: Date.now(), data: { pradlomaty: poMistech, zisk, pozvanky, jmeni, hvezdy } };
  return _zeb.data;
}
// Moje příčka — ať ji hráč vidí, i když do první pětadvacítky nedosáhne.
function moje(list, id) {
  const i = list.findIndex((x) => x.id === id);
  return i < 0 ? null : { poradi: i + 1, hodnota: list[i].hodnota, z: list.length };
}
// Kolik prádlomatů stojí v které zemi a jakých modelů — přes všechny hráče.
// Země se bere z města, ve kterém místo leží; města bez známé země vypadnou.
async function zemeSPocty() {
  const [zabory, mesta] = await Promise.all([
    prisma.gameSpotClaim.findMany({ select: { area_key: true, model: true, player_id: true } }),
    prisma.gameArea.findMany({ where: { country: { not: null } }, select: { key: true, country: true } }),
  ]);
  const kod = {};
  mesta.forEach((m) => { if (m.country && m.country !== 'xx') kod[m.key] = m.country; });
  const out = {};
  zabory.forEach((z) => {
    const cc = kod[z.area_key];
    if (!cc) return;
    const r = out[cc] || (out[cc] = { kod: cc, mini: 0, flex: 0, max: 0, celkem: 0, hraci: new Set() });
    const m = String(z.model || 'mini').toLowerCase();
    if (m === 'flex' || m === 'max') r[m] += 1; else r.mini += 1;
    r.celkem += 1;
    r.hraci.add(z.player_id);
  });
  return Object.keys(out).map((k) => ({ kod: out[k].kod, mini: out[k].mini, flex: out[k].flex,
    max: out[k].max, celkem: out[k].celkem, hracu: out[k].hraci.size }))
    .sort((a, b) => b.celkem - a.celkem || a.kod.localeCompare(b.kod));
}

router.get('/leaderboard', async (req, res, next) => {
  try {
    const p = await currentPlayer(req);
    const [z, zeme] = await Promise.all([zebricky(), zemeSPocty()]);
    const orez = (l) => l.slice(0, ZEB_TOP).map((x, i) => ({ poradi: i + 1, nick: x.nick,
      firma: x.firma || (x.nick + ' s.r.o.'), znak: x.znak || null, zeme: x.zeme || [],
      hodnota: x.hodnota, ja: !!(p && x.id === p.id) }));
    res.json({ ok: true,
      pradlomaty: orez(z.pradlomaty), zisk: orez(z.zisk), pozvanky: orez(z.pozvanky),
      jmeni: orez(z.jmeni), hvezdy: orez(z.hvezdy), zeme: zeme,
      ja: p ? { pradlomaty: moje(z.pradlomaty, p.id), zisk: moje(z.zisk, p.id),
        pozvanky: moje(z.pozvanky, p.id), jmeni: moje(z.jmeni, p.id),
        hvezdy: moje(z.hvezdy, p.id) } : null,
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

// ─── Nájemní smlouva ─────────────────────────────────────────────────────────
// Hráč se s majitelem pozemku domlouvá na dvou věcech: na jak dlouho se váže
// a jakou má výpovědní dobu. Vázanost ho chrání před přeplacením — dokud běží,
// majitel s ním vypovědět nemůže. Výpovědní doba je lhůta, po kterou místo
// vydělává dál jemu, i když už někdo nabídl víc; během ní může nabídku dorovnat
// a zůstat. Za jistotu se platí vyšším nájmem (počítá klient, viz game.js).
// Konkurent nevidí ani nájem, ani podmínky — přihazuje naslepo.
const VYPOVED_MAX = 12;          // nejdelší výpovědní doba v herních měsících
const VAZANOST_MAX = 60;         // nejdelší vázanost v herních měsících (5 let)
const ODSTUPNE_MAX = 6;          // vlastní výpověď z doby určité stojí nejvýš 6 nájmů
function mesicu(n, max) {
  const v = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(max, v));
}
// Doběhlé výpovědi: místo přechází na toho, kdo nabídl víc. Spouští se při
// každém čtení míst, takže se to stane i bez hráče, který o místo přišel.
async function dobehleVypovedi() {
  const ted = new Date();
  const hotove = await prisma.gameSpotClaim.findMany({
    where: { vypoved_do: { not: null, lte: ted }, vyzyvatel_id: { not: null } },
    take: 100,
  });
  for (const c of hotove) {
    try {
      await prisma.gameSpotClaim.update({
        where: { spot_id: c.spot_id },
        data: {
          player_id: c.vyzyvatel_id, nick: c.vyzyvatel_nick || '?',
          model: c.vyzyvatel_model || c.model, rent: c.vyzyvatel_rent || c.rent,
          takeovers: { increment: 1 },
          // Nový nájemce začíná na holé smlouvě — podmínky si sjedná sám.
          vazano_do: null, vypoved_mesicu: 1,
          vypoved_do: null, vyzyvatel_id: null, vyzyvatel_nick: null,
          vyzyvatel_rent: null, vyzyvatel_model: null,
        },
      });
      console.log('[game] místo přešlo po výpovědi:', c.spot_id, c.nick, '→', c.vyzyvatel_nick);
    } catch (e) { console.warn('[game] dobehnuti vypovedi:', e.message); }
  }
  return hotove.length;
}

const claimPub = (c, me, firmy) => ({
  // Id majitele potřebuje klient na to, aby mu šlo napsat do chatu.
  id: c.player_id,
  spot_id: c.spot_id, area_key: c.area_key, nick: c.nick,
  firma: (firmy && firmy[c.player_id] && firmy[c.player_id].firma) || (c.nick + ' s.r.o.'),
  znak: (firmy && firmy[c.player_id] && firmy[c.player_id].znak) || null,
  model: c.model, mine: c.player_id === me,
  // Že místo stojí na vlastním pozemku, je veřejná věc — konkurence musí vědět,
  // že tam přihazovat nemá smysl.
  pozemek: !!c.pozemek,
  takeovers: c.takeovers, name: c.name, lat: c.lat, lon: c.lon,
  // Nájem říkáme jen majiteli. Ostatní přihazují naslepo — v tom je to riziko.
  rent: c.player_id === me ? c.rent : null,
  // Stejně tak podmínky smlouvy: kdo přihazuje, nesmí vědět, jak je nájemce krytý.
  vazano_do: c.player_id === me ? c.vazano_do : null,
  vypoved_mesicu: c.player_id === me ? c.vypoved_mesicu : null,
  vypoved_do: c.player_id === me ? c.vypoved_do : null,
  // Nájemci řekneme, kolik mu konkurent nabídl — bez toho by neměl co dorovnat.
  vyzyva: (c.player_id === me && c.vypoved_do)
    ? { nick: c.vyzyvatel_nick, rent: c.vyzyvatel_rent } : null,
  // A tomu, kdo přihodil, že na místo čeká. Datum ne — to by prozradilo smlouvu.
  moje_nabidka: (c.vyzyvatel_id && c.vyzyvatel_id === me) ? { rent: c.vyzyvatel_rent } : null,
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
    await dobehleVypovedi();
    // Zasíťovaná místa: kde už přípojky jsou, platí další stavitel jen instalaci.
    const built = await prisma.gameSpotBuilt.findMany({
      where: areas.length ? { area_key: { in: areas } } : {},
      select: { spot_id: true }, take: 4000,
    });
    res.json({ ok: true, min_bid: TAKEOVER_MIN, fee: BID_FEE,
      zasitovana: built.map((x) => x.spot_id),
      spots: rows.map((c) => claimPub(c, p ? p.id : 0, firmy)) });
  } catch (e) { next(e); }
});

// GET /spots/mine → vlastní místa (klient podle nich pozná, o které přišel)
router.get('/spots/mine', requirePlayer, async (req, res, next) => {
  try {
    await dobehleVypovedi();
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
    // Pozemek se dá koupit i bez stroje — leží a čeká, až na něj hráč něco postaví.
    if (!spot || !area || (!model && !b.pozemek)) return res.status(400).json({ error: 'Chybí místo.' });
    const taken = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (taken) {
      return res.status(409).json({
        error: taken.player_id === req.player.id ? 'Tady už stojíš.' : 'Tohle místo mezitím obsadil ' + taken.nick + '.',
        occupied: claimPub(taken, req.player.id, await firmyMapa()),
      });
    }
    const pozemek = !!b.pozemek;
    const vaz = pozemek ? 0 : mesicu(b.doba_mesicu, VAZANOST_MAX);
    const vyp = pozemek ? 1 : Math.max(1, mesicu(b.vypoved_mesicu, VYPOVED_MAX));
    const c = await prisma.gameSpotClaim.create({
      data: { spot_id: spot, area_key: area, player_id: req.player.id, nick: req.player.nick,
        model, rent: pozemek ? 0 : rent, name: s(b.name, 160) || null,
        lat: Number(b.lat) || null, lon: Number(b.lon) || null, pozemek,
        vazano_do: vaz ? new Date(Date.now() + vaz * MESIC_MS) : null, vypoved_mesicu: vyp },
    });
    // Od téhle chvíle je místo zasíťované napořád, i kdyby ho hráč zítra opustil.
    try {
      await prisma.gameSpotBuilt.upsert({
        where: { spot_id: spot }, create: { spot_id: spot, area_key: area }, update: {},
      });
    } catch (e) { console.warn('[game] zasíťování místa:', e.message); }
    // Provize se už neplatí za stavbu, ale za nákup stroje — viz /account/nakup.
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
    await dobehleVypovedi();
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur) return res.status(404).json({ error: 'Tohle místo je volné — stav rovnou.' });
    if (cur.player_id === req.player.id) return res.status(409).json({ error: 'Tady stojíš ty sám.' });
    // Vlastní pozemek se nepřeplácí — není komu nabízet nájem. Tohle hráči
    // řekneme na rovinu, ať zbytečně neplatí za cestu; je to veřejná informace.
    if (cur.pozemek) {
      return res.status(409).json({ ok: false, won: false, nelze: true,
        error: 'Tohle místo stojí na vlastním pozemku. Přeplatit ho nejde.' });
    }
    const need = Math.ceil(cur.rent * TAKEOVER_MIN);
    const ted = Date.now();
    // Smlouva na dobu určitou drží. Útočník se nedozví proč — odmítnutí vypadá
    // stejně jako málo peněz, jinak by si vyjednané podmínky mohl odvodit.
    const kryty = cur.vazano_do && new Date(cur.vazano_do).getTime() > ted;
    // Když už jedna výpověď běží, přebít ji jde zase jen o pětinu výš.
    const nadNabidkou = cur.vypoved_do ? offer >= Math.ceil((cur.vyzyvatel_rent || 0) * TAKEOVER_MIN) : true;
    if (offer < need || kryty || !nadNabidkou) {
      // Kolik bylo potřeba, neprozradíme — jinak by stačilo zkoušet po tisícovkách.
      return res.status(409).json({ ok: false, won: false, fee: BID_FEE, error: 'Majitel pozemku tvoji nabídku odmítl. Nájemce platí víc.' });
    }
    // Nájemce má výpovědní dobu: místo mu vydělává dál a může nabídku dorovnat.
    const doKdy = new Date(ted + Math.max(1, cur.vypoved_mesicu || 1) * MESIC_MS);
    const upd = await prisma.gameSpotClaim.update({
      where: { spot_id: spot },
      data: { vypoved_do: doKdy, vyzyvatel_id: req.player.id, vyzyvatel_nick: req.player.nick,
        vyzyvatel_rent: offer, vyzyvatel_model: model || cur.model },
    });
    console.log('[game] výpověď z místa:', spot, cur.nick, '→', req.player.nick, offer + ' L$');
    // Datum neposíláme — z něj by šla vyčíst délka výpovědní doby.
    res.json({ ok: true, won: true, ceka: true,
      spot: claimPub(upd, req.player.id, await firmyMapa()), lost_by: cur.nick });
  } catch (e) { next(e); }
});

// POST /spots/stavba { spot_id, model } — na koupený pozemek se staví až teď.
// Zábor už existuje, jen na něm dosud nic nestálo.
router.post('/spots/stavba', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120), model = s(b.model, 10);
    if (!spot || !model) return res.status(400).json({ error: 'Chybí stroj.' });
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: 'Tohle místo ti nepatří.' });
    if (cur.model) return res.status(409).json({ error: 'Tady už něco stojí.' });
    const upd = await prisma.gameSpotClaim.update({ where: { spot_id: spot }, data: { model } });
    res.json({ ok: true, spot: claimPub(upd, req.player.id, await firmyMapa()) });
  } catch (e) { next(e); }
});

// POST /spots/dorovnat { spot_id } — nájemce dorovná nabídku konkurenta a zůstává.
// Tohle je ta pojistka, kvůli které má smysl si vyjednat delší výpovědní dobu.
router.post('/spots/dorovnat', requirePlayer, async (req, res, next) => {
  try {
    const spot = s((req.body || {}).spot_id, 120);
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: 'Tohle místo ti nepatří.' });
    if (!cur.vypoved_do) return res.status(409).json({ error: 'Žádná výpověď tu neběží.' });
    if (new Date(cur.vypoved_do).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'Výpovědní doba už uběhla.' });
    }
    const novy = Math.max(cur.rent, cur.vyzyvatel_rent || cur.rent);
    const upd = await prisma.gameSpotClaim.update({
      where: { spot_id: spot },
      data: { rent: novy, vypoved_do: null, vyzyvatel_id: null, vyzyvatel_nick: null,
        vyzyvatel_rent: null, vyzyvatel_model: null },
    });
    console.log('[game] nájemce dorovnal:', spot, req.player.nick, novy + ' L$');
    res.json({ ok: true, rent: novy, spot: claimPub(upd, req.player.id, await firmyMapa()) });
  } catch (e) { next(e); }
});

// POST /spots/release { spot_id, odstupne } — výpověď z místa, stroj si hráč odveze.
// Z doby určité se dá odejít taky, ale majiteli pozemku se doplácí zbytek nájmu
// (nejvýš ODSTUPNE_MAX nájmů) — klient částku strhne, server ji jen spočítá.
router.post('/spots/release', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120);
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: 'Tohle místo ti nepatří.' });
    const zbyva = cur.vazano_do
      ? Math.ceil(Math.max(0, new Date(cur.vazano_do).getTime() - Date.now()) / MESIC_MS) : 0;
    const odstupne = Math.round(cur.rent * Math.min(zbyva, ODSTUPNE_MAX));
    if (odstupne > 0 && !b.odstupne) {
      return res.status(409).json({ ok: false, odstupne, zbyva,
        error: 'Smlouva je na dobu určitou. Odejít jde, ale doplatíš odstupné.' });
    }
    await prisma.gameSpotClaim.deleteMany({ where: { spot_id: spot, player_id: req.player.id } });
    res.json({ ok: true, odstupne });
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
module.exports._urokMesicne = urokMesicne;
module.exports._zbydeMesicne = zbydeMesicne;
module.exports._cisteJmeni = cisteJmeni;
module.exports._kdoPrivedl = kdoPrivedl;
module.exports._dorovnejProvize = dorovnejProvize;
module.exports._strojeHrace = strojeHrace;
module.exports._privedeniHraci = privedeniHraci;
module.exports._distAktivni = distAktivni;
module.exports._distRezie = distRezie;
