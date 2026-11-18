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
const PRAVA = require('../services/game/prava');
const ALIANCE = require('../services/game/aliance');
const AUDIT = require('../services/game/audit');
const SOUBEH = require('../services/game/soubeh');

router.use(express.json({ limit: '32kb' }));

const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const MODELY = ['mini', 'flex', 'max'];
const JMENI = require('../services/game/jmeni');
const PODILY = require('../services/game/podily');
const PREDMETY = ['stroj', 'pradlomat', 'karta', 'pobocka', 'pujcka', 'podil', 'odkup', 'prevod', 'vstup', 'odklad'];
// Odklad splátky. Dlužník, který ví, že na příští splátku nemá, si může
// říct o posunutí — a nabídnout za to poplatek. Věřitel na tom bývá líp
// než na propadlé zástavě: z rozprodané firmy dostane zlomek toho, co by
// mu přinesla splacená půjčka.
//
// Rozhoduje každý věřitel za svou půjčku sám. Hlasování většinou pohledávek
// by znamenalo nový aparát a jeden tvrdohlavý věřitel firmu položí stejně —
// tohle je jednodušší a dramatičtější.
const ODKLAD_MAX_MESICU = 6;
// Kapitálový vstup: investor dá firmě peníze a dostane za ně NOVĚ VYDANÝ
// podíl. Od prodeje podílu se to liší v tom, kdo se tím ředí — u prodeje
// jen majitel, tady všichni, protože se celý koláč krájí znovu. Podrobně
// i s příkladem v services/game/podily.js.
//
// Proč to v záchraně firmy potřebujeme: kdo už prodal většinu, nemá co dál
// prodávat, a půjčku mu nikdo nedá, protože nemá čím ručit. Vstup je jediná
// cesta, jak do takové firmy dostat peníze.
const VSTUP_MIN = 0.01, VSTUP_MAX = 0.5;
// Co si dva hráči můžou domluvit navíc k věcem: půjčku a podíl ve firmě.
const MESIC_MS = 43200000;             // herní měsíc = 12 skutečných hodin
const PUJCKA_MIN = 10000;
const UROK_MAX = 0.6;                  // 60 % ročně je strop, výš už je to lichva
const PUJCKA_MESICU_MAX = 60;
// Prodat jde i většina firmy — majitel si o tom rozhoduje sám. Strop je jen
// na sto procentech: víc než celou firmu prodat nelze.
const PODIL_MIN = 0.01, PODIL_MAX = 1;
// Nad tímhle podílem drží kupující většinu a hra na to musí prodávajícího
// upozornit dřív, než klikne.
const PODIL_VETSINA = 0.5;
const ODKUP_NASOBEK = 1.25;            // orientační cena zpětného odkupu, dohoda ji přebíjí
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
    if (!p) return res.status(401).json({ error: TEXTY.t('server.neprihlasen', {}, TEXTY.ZDROJ) });
    req.player = p; require('../services/game/pristupy').zapis(req, p.id, 'aktivita'); next();
    // Hláška se skládá v jazyce toho, KOMU ji posíláme. Na burze a v dražbě
    // se potkají dva hráči s různým nastavením a každý má dostat svoje.
  }).catch(next);
}
// Zkratka do obsluhy: req.tx('server.neco') vrátí text v jazyce hráče.
function stx(req) {
  const j = TEXTY.jazykHrace(req && req.player);
  return (klic, udaje) => TEXTY.t(klic, udaje, j);
}
const api = (fn) => (req, res, next) => fn(req, res).catch(next);

// ─── Nouzová brzda ───────────────────────────────────────────────────────────
// Co se zastavuje a proč je v services/game/brzda.js.
const BRZDA = require('../services/game/brzda');
router.use((req, res, next) => {
  if (!BRZDA.zastavit(req.method, req.path)) return next();
  acct._nastaveni().then((n) => {
    if (!BRZDA.zataseno(n)) return next();
    res.status(503).json({ error: stx(req)('server.burza_je_docasne_pozastavena') });
  }).catch(next);
});

// Stav hry hráče — sklad a postavené prádlomaty jsou v něm.
const stavu = (p) => (p && p.state) || {};
const skladu = (st) => {
  const out = {};
  MODELY.forEach((m) => { out[m] = Math.max(0, Math.round((st.stock && st.stock[m]) || 0)); });
  return out;
};

// ─── Kolik firma stojí ───────────────────────────────────────────────────────
// Bez čísla by byl podíl loterie: kupující nevidí cizí zisky a hádal by cenu
// z ničeho. Firmu oceňujeme stejně jako jednotlivý prádlomat na burze —
// čtyřnásobkem ročního zisku provozovny, shora i zdola drženým tím, co stavba
// stála — a přičteme hotovost a odečteme dluh u banky. Je to orientace, ne
// povinnost: za kolik si podíl přeprodají, je věc hráčů.
const CENA_NASOBEK = 4;
function cenaPradlomatu(zisk, invest) {
  const podleZisku = Math.max(0, Math.round((zisk || 0) * 12 * CENA_NASOBEK));
  if (!(invest > 0)) return podleZisku;
  return Math.max(Math.round(invest * 0.5), Math.min(Math.round(invest * 1.2), podleZisku));
}
// Práh pro rozšířené finanční údaje. Zadání má 10–24,99 % jako „přístup
// k rozšířeným finančním informacím"; pod tím je hráč finanční investor.
const PRAH_FINANCE = 0.10;

// Co z ocenění uvidí konkrétní člověk. Vlastní firma a aliance se počítají
// taky — kdo za blok jedná, potřebuje čísla stejně jako samostatný držitel.
async function oceneniPro(oc, firmaId, divakId) {
  if (!divakId || divakId === firmaId) return oc;
  let muj = 0;
  try {
    const seznam = await pravaFirmy(firmaId);
    seznam.forEach((e) => { if (e.investor_id === divakId) muj = Math.max(muj, e.podil || 0); });
  } catch (e) { /* bez podílu se bere nula */ }
  if (muj >= PRAH_FINANCE - 1e-9) return oc;
  return { jmeni: oc.jmeni, hodnota: oc.hodnota, pradlomatu: oc.pradlomatu,
    // Ať hra pozná, že zbytek není nula, ale schované číslo.
    zkracene: true, prah_pct: Math.round(PRAH_FINANCE * 100) };
}

function oceneni(st) {
  const units = Array.isArray(st.units) ? st.units : [];
  const hotovost = Math.max(0, Math.round(Number(st.cash) || 0));
  const dluh = Math.max(0, Math.round(Number(st.loan) || 0));
  // Čisté jmění počítá tatáž funkce jako v kartě „Můj majetek" a v žebříčku,
  // takže ocenění sedí s tím, co hráč vidí o sobě: provozovny, stroje skladem
  // i na cestě, pozemky, pobočky a četa, plus hotovost, minus dluh.
  const jmeni = Math.round(acct._cisteJmeni(st) || 0);
  const majetek = jmeni - hotovost + dluh;
  const zbyde = Math.round(acct._zbydeMesicne(st) || 0);
  // Druhý pohled: co firma vydělává. Tržní cena provozovny je čtyřnásobek
  // jejího ročního zisku, u celé firmy to funguje stejně.
  const podleZisku = Math.max(0, Math.round(zbyde * 12 * CENA_NASOBEK));
  return { majetek, hotovost, dluh, jmeni, podle_zisku: podleZisku,
    hodnota: Math.max(0, jmeni), zbyde_mesicne: zbyde, pradlomatu: units.length };
}

// ─── Co má kdo na prodej ─────────────────────────────────────────────────────
// GET /trade/assets/:id → sklad, prádlomaty a karty daného hráče.
// Na burze je tohle veřejné schválně: bez toho by se nedalo nabízet.
router.get('/trade/assets/:id', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id },
    select: { id: true, nick: true, company: true, state: true, disabled: true } });
  if (!p || p.disabled) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni') });
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
    // Souhrnné ocenění firmy jde ven schválně: kdo kupuje podíl, má vědět,
    // do čeho jde. Čísla jednotlivých provozoven zůstávají majiteli.
    //
    // Od desetiny firmy se ale ukáže víc. Rozdělení drží zadání: kdo drží
    // pod deset procent, je finanční investor a vidí jen cenu; od deseti
    // procent má nárok na rozšířené finanční údaje — z čeho se ta cena
    // skládá, kolik je v hotovosti a kolik visí na dluhu.
    //
    // Cena samotná zůstává všem schválně: bez ní by se podíl nedal koupit
    // ani prodat a práh by místo informační výhody udělal slepou burzu.
    oceneni: await oceneniPro(oceneni(st), id, req.player.id),
    prodany_podil: await prodanyPodil(id),
    karty: k });
}));

// Kdo je u hry: bere se z tepů otevřené hry, ne z posledního uložení.
// Uložení stavu se na pozadí zastaví a jinak se děje jen po akcích, takže
// hráč, který zrovna sleduje dražbu, podle něj vypadal jako dávno pryč.
const PRESENCE = require('../services/game/presence');
const ONLINE_MS = 150000;   // tep chodí po třiceti vteřinách, pár se jich smí ztratit

// GET /trade/players → s kým jde obchodovat
router.get('/trade/players', hrac, api(async (req, res) => {
  const vyber = { id: true, nick: true, company: true, state_at: true, hodnost: true };
  const tepy = new Map();
  PRESENCE.recent(ONLINE_MS).forEach((x) => { if (x.id !== req.player.id) tepy.set(x.id, x); });
  const idOnline = [...tepy.keys()];
  const [cerstvi, zivi] = await Promise.all([
    prisma.gamePlayer.findMany({
      where: { disabled: false, id: { not: req.player.id } },
      orderBy: { state_at: 'desc' }, take: 100, select: vyber }),
    // Kdo je u hry, musí v seznamu být, i kdyby se mu stav neuložil týden.
    idOnline.length
      ? prisma.gamePlayer.findMany({ where: { disabled: false, id: { in: idOnline } }, select: vyber })
      : [],
  ]);
  const vsichni = [];
  const viden = new Set();
  zivi.concat(cerstvi).forEach((p) => { if (!viden.has(p.id)) { viden.add(p.id); vsichni.push(p); } });
  const ted = Date.now();
  const jaz = TEXTY.jazykHrace(req.player);
  // Hodnost posíláme s sebou: na burze je to jediná rychlá informace o tom,
  // s kým se člověk chystá domluvit na penězích.
  res.json({ ok: true, players: vsichni.map((p) => {
    const t = tepy.get(p.id);
    return { id: p.id, nick: p.nick,
      firma: p.company || (p.nick + ' s.r.o.'), naposledy: p.state_at,
      // tady = má hru na očích, pozadi = drží ji ve schované záložce
      online: !t ? null : (ted - t.v <= ONLINE_MS ? 'tady' : 'pozadi'),
      hodnost: p.hodnost || null, hodnost_nazev: hodnostNazev(p.hodnost, jaz) };
  }) });
}));

const { HODNOSTI, ODZNAK, nazevHodnosti, odznakPro } = require('../services/game/hodnosti');
const TEXTY = require('../services/game/texty');
const { textDorucenky } = require('../services/game/doruceni');
// Název hodnosti se skládá pro toho, KOMU se posílá — na burze se potkají
// dva hráči a každý může mít nastavený jiný jazyk.
const hodnostNazev = (id, jazyk) => (id ? nazevHodnosti(id, jazyk) : null);

// ─── Nabídky ─────────────────────────────────────────────────────────────────
// Názvy firem protistran — v hlášKách a na burze se má ukazovat firma, ne nick.
async function firmyPro(rows) {
  const ids = new Set();
  (Array.isArray(rows) ? rows : [rows]).forEach((t) => { if (t) { ids.add(t.from_id); ids.add(t.to_id); } });
  const F = {};
  if (!ids.size) return F;
  const lide = await prisma.gamePlayer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nick: true, company: true } });
  lide.forEach((h) => { F[h.id] = h.company || (h.nick + ' s.r.o.'); });
  return F;
}
const verejny = (t, me, F) => ({
  id: t.id, smer: t.smer, predmet: t.predmet, model: t.model, spot_id: t.spot_id,
  card_kind: t.card_kind, cena: t.cena, karty: t.karty || [], vzkaz: t.vzkaz, data: t.data || null,
  stav: t.stav, parent_id: t.parent_id, created_at: t.created_at,
  od: { id: t.from_id, nick: t.from_nick, firma: (F && F[t.from_id]) || null },
  komu: { id: t.to_id, nick: t.to_nick, firma: (F && F[t.to_id]) || null },
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
  const F = await firmyPro(rows);
  res.json({ ok: true, trades: rows.map((t) => verejny(t, me, F)),
    ceka_na_me: rows.filter((t) => t.to_id === me && t.stav === 'ceka').length });
}));

// Ověří, že nabídka dává smysl a že prodávající danou věc opravdu má.
async function zkontroluj(nab, prodavajici, t) {
  const st = stavu(prodavajici);
  if (nab.predmet === 'stroj') {
    if (!MODELY.includes(nab.model)) return t('server.takovy_model_neznam');
    if (skladu(st)[nab.model] < 1) return t('server.prodavajici_nema_stroj');
  } else if (nab.predmet === 'pradlomat') {
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: nab.spot_id || '' } });
    if (!c || c.player_id !== prodavajici.id) return t('server.pradlomat_uz_nepatri');
  } else if (nab.predmet === 'karta') {
    const k = await prisma.gameCard.count({ where: { player_id: prodavajici.id, kind: nab.card_kind || '', used_at: null } });
    if (!k) return t('server.prodavajici_nema_kartu');
  } else if (nab.predmet === 'pobocka') {
    // Pobočky žijí ve stavu hry, ne v tabulce — hledáme ji podle názvu.
    const pob = Array.isArray(st.pobocky) ? st.pobocky : [];
    if (!pob.some((x) => x && x.name === nab.pobocka)) return t('server.prodavajici_nema_pobocku');
  } else if (nab.predmet === 'pujcka' || nab.predmet === 'podil'
    || nab.predmet === 'odkup' || nab.predmet === 'prevod' || nab.predmet === 'vstup'
    || nab.predmet === 'odklad') {
    return null;        // peníze a podíl se kontrolují zvlášť, nic se nepřevádí ze skladu
  } else return t('server.tohle_se_obchodovat_neda');
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
// Počítají se jen nabídky, které hráč sám poslal — ty jsou jeho slib. Co
// přijde od ostatních, ho nezavazuje k ničemu (a kdyby se to počítalo, stačilo
// by poslat komukoli velkou nabídku a zablokovat mu tím hotovost).
async function vazanaHotovost(playerId, kromeId) {
  const rows = await prisma.gameTrade.findMany({
    where: { stav: 'ceka', from_id: playerId },
    select: { id: true, from_id: true, to_id: true, smer: true, predmet: true, cena: true },
  });
  return rows.reduce((a, t) => a
    + (t.id !== kromeId && platiciId(t) === playerId ? (t.cena || 0) : 0), 0);
}
// Vejde se nová nabídka do toho, co hráči zbývá? Vrací chybovou větu, nebo null.
async function hotovostStaci(hrac, cena, kromeId, t) {
  const cash = Math.round((stavu(hrac).cash) || 0);
  const vazano = await vazanaHotovost(hrac.id, kromeId);
  const volne = cash - vazano;
  if (cena <= volne) return null;
  return t('server.nemas_volnou_hotovost',
    { mas: cash, vazano: vazano, volne: Math.max(0, volne) });
}

// Kolik procent firmy už je prodáno jinde.
async function prodanyPodil(firmaId) {
  const [rows, pujcky] = await Promise.all([
    prisma.gameEquity.findMany({ where: { firma_id: firmaId, stav: 'bezi' }, select: { podil: true } }),
    // Zastavený podíl je stejně vázaný jako prodaný. Bez tohohle by dlužník
    // zastavil dvacet procent, hned prodal osmdesát někomu jinému a věřiteli
    // by při propadnutí nezbylo nic — zástava by byla jen na oko.
    prisma.gameLoan.findMany({ where: { borrower_id: firmaId, stav: 'bezi', zastava_podil: { not: null } },
      select: { zastava_podil: true } }),
  ]);
  return rows.reduce((a, x) => a + (x.podil || 0), 0)
    + pujcky.reduce((a, x) => a + (x.zastava_podil || 0), 0);
}

// Procenta do názvů a hlášek: 0,05 → „5", 0,025 → „2,5". Celá čísla zůstávají
// celá, desetinná mají čárku — ať to v dražbě vypadá česky.
const pct = (x) => String(Math.round((Number(x) || 0) * 1000) / 10).replace('.', ',');

// Práva podílníků v jedné firmě: kdo určuje dividendu a kdo blokuje zástavu.
// Podíly se sčítají na člověka — kdo koupil třikrát po dvaceti procentech,
// drží šedesát a tři řádky v databázi na tom nic nemění.
async function pravaFirmy(firmaId) {
  const rows = await prisma.gameEquity.findMany({
    where: { firma_id: firmaId, stav: 'bezi' },
    select: { investor_id: true, podil: true, zakaz_zastavy: true },
  });
  const poHraci = PRAVA.souhrn(rows);
  // Aliance se slučují tady, na jediném místě. Všechno ostatní — dividenda,
  // blokace zástavy, výstupní nabídka — pak funguje beze změny a bez výjimek
  // pro bloky: právo prostě má ten, kdo za blok jedná.
  return ALIANCE.slucPodily(poHraci, await clenstvi(poHraci.map((e) => e.investor_id)));
}

// Aliance, které v téhle firmě drží podíl, i s jejich jmény.
async function alianceBloky(firmaId) {
  const rows = await prisma.gameEquity.findMany({
    where: { firma_id: firmaId, stav: 'bezi' },
    select: { investor_id: true, podil: true },
  });
  const poHraci = PRAVA.souhrn(rows);
  const s = ALIANCE.souhrn(poHraci, await clenstvi(poHraci.map((e) => e.investor_id)));
  if (!s.length) return [];
  const [aliance, hraci] = await Promise.all([
    prisma.gameAliance.findMany({ where: { id: { in: s.map((x) => x.aliance_id) } },
      select: { id: true, nazev: true } }),
    prisma.gamePlayer.findMany({ where: { id: { in: s.map((x) => x.mluvci).filter(Boolean) } },
      select: { id: true, nick: true, company: true } }),
  ]);
  const nazvy = new Map(aliance.map((a) => [a.id, a.nazev]));
  const jm = new Map(hraci.map((h) => [h.id, h.company || h.nick]));
  return s.map((x) => ({ nazev: nazvy.get(x.aliance_id) || '', podil: x.podil,
    clenu: x.clenu, mluvci: jm.get(x.mluvci) || '' }));
}

// Mapa hráč → aliance pro zadané hráče. Kdo v žádné není, v mapě chybí
// a zůstává sám za sebe.
async function clenstvi(ids) {
  const m = new Map();
  if (!ids || !ids.length) return m;
  const rows = await prisma.gameAlianceClen.findMany({
    where: { player_id: { in: ids }, stav: 'clen' },
    select: { player_id: true, aliance_id: true },
  }).catch(() => []);
  rows.forEach((r) => m.set(r.player_id, r.aliance_id));
  return m;
}

// Kdo majiteli zakázal dát firmu do zástavy. Vrací jméno, se kterým se má
// bavit, nebo null, když nikdo. Běžících půjček se zákaz netýká — platí
// jen na nově sjednané zástavy.
async function blokujeZastavu(firmaId) {
  const kdo = PRAVA.kdoBlokuje(await pravaFirmy(firmaId));
  if (!kdo) return null;
  const h = await prisma.gamePlayer.findUnique({ where: { id: kdo },
    select: { nick: true, company: true } });
  return h ? (h.company || h.nick) : null;
}

// Kolik z téhle firmy drží jeden konkrétní investor. Rozhoduje to o většině:
// padesát procent rozdrobených mezi pět lidí nikomu kontrolu nedává.
async function podilInvestora(firmaId, investorId) {
  const rows = await prisma.gameEquity.findMany({
    where: { firma_id: firmaId, investor_id: investorId, stav: 'bezi' }, select: { podil: true } });
  return rows.reduce((a, x) => a + (x.podil || 0), 0);
}

// POST /trade/offer { to_id, smer, predmet, model, spot_id, card_kind, cena, karty[], vzkaz }
router.post('/trade/offer', hrac, api(async (req, res) => {
  const b = req.body || {};
  const to_id = parseInt(b.to_id, 10);
  const smer = s(b.smer, 8);
  const predmet = s(b.predmet, 12);
  if (to_id === req.player.id) return res.status(400).json({ error: stx(req)('server.sam_sobe_nabidku_posilat_nemusis') });
  if (!['koupim', 'prodam'].includes(smer)) return res.status(400).json({ error: stx(req)('server.neznamy_smer_obchodu') });
  if (!PREDMETY.includes(predmet)) return res.status(400).json({ error: stx(req)('server.tohle_se_obchodovat_neda') });
  const cena = Math.max(0, Math.min(MAX_CENA, Math.round(Number(b.cena) || 0)));
  const karty = Array.isArray(b.karty) ? b.karty.map((x) => s(x, 24)).filter(Boolean).slice(0, 10) : [];
  if (!cena && !karty.length) return res.status(400).json({ error: stx(req)('server.nabidni_aspon_nejakou_cenu_nebo_kartu') });

  const druhy = await prisma.gamePlayer.findUnique({ where: { id: to_id } });
  if (!druhy || druhy.disabled) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni_2') });

  const nab = { predmet, model: s(b.model, 10) || null, spot_id: s(b.spot_id, 120) || null,
    card_kind: s(b.card_kind, 24) || null, pobocka: s(b.pobocka, 80) || null };
  // Podmínky půjčky a podílu. U půjčky je „prodávající" ten, kdo peníze dává,
  // takže směr čteme stejně jako u věcí: koupim = chci je od něj.
  let data = null;
  if (predmet === 'pujcka') {
    const urok = Math.max(0, Math.min(UROK_MAX, Number(b.urok) || 0));
    const mesicu = Math.max(1, Math.min(PUJCKA_MESICU_MAX, Math.round(Number(b.mesicu) || 0)));
    if (cena < PUJCKA_MIN) {
      return res.status(400).json({ error: stx(req)('server.nejmensi_pujcka_je') + PUJCKA_MIN.toLocaleString('cs-CZ') + ' L$.' });
    }
    // Zástavou ručí vždycky dlužník — ten, kdo si půjčuje.
    const dluznik = smer === 'koupim' ? req.player : druhy;
    const zast = s(b.zastava, 120) || null;
    let zastavaNazev = null;
    if (zast) {
      const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: zast } });
      if (!c || c.player_id !== dluznik.id) {
        return res.status(409).json({ error: stx(req)('server.zastavou_muze_byt_jen_pradlomat_toho') });
      }
      zastavaNazev = c.name || zast;
    }
    // Věřitel může zástavu podmínit, i když ještě neví, čím mu dlužník ručí —
    // ten ji vybere, až bude nabídku přijímat.
    const zadam = smer === 'prodam' && !zast && !!b.zadam_zastavu;
    // Zástava podílem. Procento si říká věřitel — je to cena za půjčku stejně
    // jako úrok, dlužník to buď vezme, nebo ne. Vylučuje se se zástavou
    // prádlomatem i s požadavkem „vyber si sám“.
    let zastPodil = null;
    if (!zast && !zadam && Number(b.zastava_podil) > 0) {
      zastPodil = Math.max(PODIL_MIN, Math.min(PODIL_MAX, Number(b.zastava_podil)));
      const volne = PODIL_MAX - await prodanyPodil(dluznik.id);
      if (zastPodil > volne + 1e-9) {
        return res.status(409).json({ error: stx(req)('server.na_zastavu_podilem_nema_tolik',
          { p1: Math.round(zastPodil * 100), p2: Math.round(Math.max(0, volne) * 100) }) });
      }
    }
    // Konverze na nově vydaný podíl. Dělá totéž co zástava podílem — při
    // poslední nezaplacené splátce dostane věřitel kus firmy — ale podíl se
    // vydá nově a všichni dosavadní se o stejný poměr zředí. Nepotřebuje
    // proto volný podíl, a je tím použitelná i tam, kde je prodané všechno.
    // Právě taková firma přitom záchranné peníze potřebuje nejvíc.
    let konvPodil = null;
    if (!zast && !zadam && !zastPodil && Number(b.konverze_podil) > 0) {
      konvPodil = Math.max(PODIL_MIN, Math.min(VSTUP_MAX, Number(b.konverze_podil)));
    }
    // Blokační menšina. Kdo drží čtvrtinu firmy, může zastavení zakázat —
    // zástava je nevratná a propadne z ní majetek, na kterém visí i jeho
    // peníze. Hlídá se to tady, aby se dlužník nedozvěděl až od protistrany,
    // že se nabídka nedá přijmout.
    if (zast || zastPodil || konvPodil) {
      const blokuje = await blokujeZastavu(dluznik.id);
      if (blokuje) {
        return res.status(409).json({ error: stx(req)('server.zastavu_blokuje_podilnik', { p1: blokuje }) });
      }
    }
    data = { urok, mesicu, zastava: zast, zastava_nazev: zastavaNazev,
      zastava_podil: zastPodil, konverze_podil: konvPodil,
      zadam_zastavu: zadam, splatka: anuita(cena, urok, mesicu) };
  } else if (predmet === 'podil') {
    const podil = Math.max(PODIL_MIN, Math.min(PODIL_MAX, Number(b.podil) || 0));
    // Podíl prodává majitel firmy — u „koupim" je to ten druhý, u „prodam" já.
    const firma = smer === 'koupim' ? druhy : req.player;
    const uz = await prodanyPodil(firma.id);
    if (uz + podil > PODIL_MAX + 1e-9) {
      return res.status(409).json({ error: stx(req)('server.z_firmy_je_prodano_uz_pct', { p1: Math.round(uz * 100) }) });
    }
    // Kolik bude kupující držet, až to projde — a jestli tím získá většinu.
    // Posíláme to v nabídce, aby obě strany viděly totéž a prodávající se
    // nedozvěděl až po kliknutí, že se právě zbavil kontroly nad firmou.
    const kupujici = smer === 'koupim' ? req.player : druhy;
    const po = (await podilInvestora(firma.id, kupujici.id)) + podil;
    data = { podil, po_prodeji: po, vetsina: po > PODIL_VETSINA + 1e-9 };
  } else if (predmet === 'odklad') {
    // O odklad žádá vždycky dlužník, a vždycky u konkrétní půjčky.
    const pujckaId = parseInt(b.loan_id, 10) || 0;
    const mesicu2 = Math.max(1, Math.min(ODKLAD_MAX_MESICU, Math.round(Number(b.odklad_mesicu) || 1)));
    const pujcka = await prisma.gameLoan.findUnique({ where: { id: pujckaId } });
    if (!pujcka || pujcka.stav !== 'bezi') {
      return res.status(409).json({ error: stx(req)('server.takova_pujcka_uz_nebezi') });
    }
    if (pujcka.borrower_id !== req.player.id || pujcka.lender_id !== druhy.id) {
      return res.status(403).json({ error: stx(req)('server.o_odklad_zada_dluznik_sveho_veritele') });
    }
    data = { loan_id: pujcka.id, odklad_mesicu: mesicu2,
      splatka: pujcka.splatka, zmeskano: pujcka.zmeskano,
      zbyva_splatek: Math.max(0, (pujcka.mesicu || 0) - (pujcka.splaceno || 0)) };
  } else if (predmet === 'vstup') {
    // Peníze jdou do firmy, investor za ně dostane nově vydaný podíl a
    // všichni dosavadní se o stejný poměr zředí.
    const podil = Math.max(VSTUP_MIN, Math.min(VSTUP_MAX, Number(b.podil) || 0));
    // Firmou je ten, kdo peníze dostává: u „koupim" kupuje podíl odesílatel,
    // firmou je tedy ten druhý.
    const firma = smer === 'koupim' ? druhy : req.player;
    const investor = smer === 'koupim' ? req.player : druhy;
    if (firma.id === investor.id) {
      return res.status(400).json({ error: stx(req)('server.do_vlastni_firmy_vstoupit_nejde') });
    }
    // Čím firma je, počítá server z vlastních dat — ne z toho, co o sobě
    // tvrdí prohlížeč. Z toho plyne, jaký podíl by za ty peníze slušel;
    // je to vodítko do nabídky, ne povinnost. Kolik si plácnou, je na nich.
    const hodnotaPred = Math.max(0, await JMENI.proHrace(firma.id, stavu(firma)));
    const uz = await prodanyPodil(firma.id);
    const investoru = await prisma.gameEquity.count({ where: { firma_id: firma.id, stav: 'bezi' } });
    data = { podil,
      hodnota_pred: Math.round(hodnotaPred),
      hodnota_po: Math.round(hodnotaPred + cena),
      podil_dle_ceny: Math.round(PODILY.podilDleCeny(hodnotaPred, cena) * 1000) / 1000,
      prodano_pred: Math.round(uz * 1000) / 1000,
      redi_se: investoru,
      po_prodeji: podil,
      vetsina: podil > PODIL_VETSINA + 1e-9 };
  } else if (predmet === 'odkup') {
    // Zpětný odkup je obchod jako každý jiný: souhlasit musí obě strany a cenu
    // si řeknou samy. Kupuje vždycky majitel firmy, prodává podílník.
    const e = await prisma.gameEquity.findUnique({ where: { id: parseInt(b.equity_id, 10) || 0 } });
    if (!e || e.stav !== 'bezi') return res.status(409).json({ error: stx(req)('server.takovy_podil_uz_nebezi') });
    const kupujiciId = smer === 'koupim' ? req.player.id : to_id;
    const prodavajiciId = smer === 'koupim' ? to_id : req.player.id;
    if (e.firma_id !== kupujiciId || e.investor_id !== prodavajiciId) {
      return res.status(409).json({ error: stx(req)('server.tenhle_podil_spolu_nedrzite_odkup_kupuje') });
    }
    data = { equity_id: e.id, podil: e.podil, cena_puvodni: e.cena, vyplaceno: e.vyplaceno };
  } else if (predmet === 'prevod') {
    // Podíl v cizí firmě je majetek investora jako každý jiný — může ho prodat
    // dál komukoli. Firma do toho nemluví; kdyby musela kývnout, byl by podíl
    // neprodejný pokaždé, když má její majitel zrovna jiné starosti.
    const e = await prisma.gameEquity.findUnique({ where: { id: parseInt(b.equity_id, 10) || 0 } });
    if (!e || e.stav !== 'bezi') return res.status(409).json({ error: stx(req)('server.takovy_podil_uz_nebezi_2') });
    const kupujiciId = smer === 'koupim' ? req.player.id : to_id;
    const prodavajiciId = smer === 'koupim' ? to_id : req.player.id;
    if (e.investor_id !== prodavajiciId) {
      return res.status(409).json({ error: stx(req)('server.ten_podil_prodavajici_nedrzi') });
    }
    if (e.firma_id === kupujiciId) {
      return res.status(409).json({ error: stx(req)('server.majitel_firmy_si_podil_bere_zpatky') });
    }
    // Nabídnout jde i kus drženého podílu — po procentech, stejně jako v dražbě.
    // Když klient nic nepošle, nabízí se celý.
    let podilP = b.podil == null ? e.podil : Math.round(Number(b.podil) * 1000) / 1000;
    if (!(podilP > 0)) return res.status(400).json({ error: stx(req)('server.kolik_procent_podilu_nabizis') });
    if (podilP > e.podil + 1e-9) {
      return res.status(409).json({ error: stx(req)('server.prodavajici_drzi_jen') + pct(e.podil) + ' %.' });
    }
    // Zbytek pod desetinou procenta nemá cenu držet — vezme se to celé.
    if (e.podil - podilP < 0.001) podilP = e.podil;
    // Pořizovací cena a vyplacené se v nabídce krátí na nabízený kus, ať druhá
    // strana nevidí čísla za celý balík.
    const dilP = (v) => Math.round((Number(v) || 0) * (podilP / e.podil));
    data = { equity_id: e.id, podil: podilP, cena_puvodni: dilP(e.cena),
      vyplaceno: dilP(e.vyplaceno), firma_id: e.firma_id, firma_nick: e.firma_nick };
  }
  // Kdo věc má: u „koupim" ji má ten druhý, u „prodam" ji mám já.
  const chyba = await zkontroluj(nab, smer === 'koupim' ? druhy : req.player, stx(req));
  if (chyba) return res.status(409).json({ error: chyba });
  // Karty přihozené k ceně platí vždycky ten, kdo kupuje.
  const platici = smer === 'koupim' ? req.player : druhy;
  for (const k of karty) {
    const m = await prisma.gameCard.count({ where: { player_id: platici.id, kind: k, used_at: null } });
    if (!m) return res.status(409).json({ error: stx(req)('server.karta_chybi_platicimu', { p1: k }) });
  }

  // Platím-li já, musí na to být volná hotovost — jinak je nabídka od začátku mrtvá.
  const platimJa = predmet === 'pujcka' ? smer === 'prodam' : smer === 'koupim';
  if (platimJa && cena > 0) {
    const chybi = await hotovostStaci(req.player, cena, null, stx(req));
    if (chybi) return res.status(409).json({ error: chybi });
  }

  const t = await prisma.gameTrade.create({ data: {
    from_id: req.player.id, from_nick: req.player.nick, to_id, to_nick: druhy.nick,
    smer, predmet, model: nab.model,
    // U pobočky nese její název sloupec spot_id — nový sloupec kvůli tomu nezakládáme.
    spot_id: predmet === 'pobocka' ? nab.pobocka : nab.spot_id, card_kind: nab.card_kind,
    cena, karty, data, vzkaz: s(b.vzkaz, 200) || null,
  } });
  // AI hlídání vzkazu (na pozadí; při škodě/podezření jde upozornění do Velína)
  require('../services/game/pristupy').zapis(req, req.player.id, 'nabidka', t.id);
  if (t.vzkaz) require('../services/game/moderace').zkontroluj({ player: req.player, zdroj: 'vzkaz', refId: t.id, text: t.vzkaz, komu: druhy.nick });
  res.json({ ok: true, trade: verejny(t, req.player.id, await firmyPro(t)) });
}));

// POST /trade/:id/counter { cena, karty[], vzkaz } — protinávrh (otočí se role)
router.post('/trade/:id/counter', hrac, api(async (req, res) => {
  const t = await prisma.gameTrade.findUnique({ where: { id: parseInt(req.params.id, 10) } });
  if (!t) return res.status(404).json({ error: stx(req)('server.nabidka_nenalezena') });
  if (t.to_id !== req.player.id) return res.status(403).json({ error: stx(req)('server.tahle_nabidka_neni_pro_tebe') });
  if (t.stav !== 'ceka') return res.status(409).json({ error: stx(req)('server.tahle_nabidka_uz_neni_ve_hre') });
  const b = req.body || {};   // větev pro podíl níž na něj spoléhá — bez toho spadne na „b is not defined"
  const cena = Math.max(0, Math.min(MAX_CENA, Math.round(Number((req.body || {}).cena) || 0)));
  const karty = Array.isArray((req.body || {}).karty) ? (req.body || {}).karty.map((x) => s(x, 24)).filter(Boolean).slice(0, 10) : [];
  if (!cena && !karty.length) return res.status(400).json({ error: stx(req)('server.protinavrh_potrebuje_cenu_nebo_kartu') });

  // Směr se prohodí, takže se prohodí i to, kdo platí.
  const novySmer = t.smer === 'koupim' ? 'prodam' : 'koupim';
  // Podmínky půjčky a podílu jdou s předmětem — jinak by protinávrh udělal
  // z dvacetiprocentní půjčky na rok bezúročnou na měsíc.
  let data = t.data || null;
  if (t.predmet === 'pujcka') {
    const d = Object.assign({}, data || {});
    if (cena < PUJCKA_MIN) {
      return res.status(400).json({ error: stx(req)('server.nejmensi_pujcka_je_2') + PUJCKA_MIN.toLocaleString('cs-CZ') + ' L$.' });
    }
    // Zástavu dává dlužník — a po prohození směru se pozná stejně jako u nabídky.
    const dluznikJaJa = novySmer === 'koupim';
    const zast = s((req.body || {}).zastava, 120);
    if (zast === '-') { d.zastava = null; d.zastava_nazev = null; }
    else if (zast) {
      if (!dluznikJaJa) return res.status(409).json({ error: stx(req)('server.zastavu_muze_dat_jen_ten_kdo') });
      const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: zast } });
      if (!c || c.player_id !== req.player.id) {
        return res.status(409).json({ error: stx(req)('server.zastavou_muze_byt_jen_tvuj_pradlomat') });
      }
      d.zastava = zast; d.zastava_nazev = c.name || zast;
      d.zadam_zastavu = false;      // požadavek je splněný, zástava je na stole
    }
    d.splatka = anuita(cena, Math.max(0, Number(d.urok) || 0), Math.max(1, Math.round(Number(d.mesicu) || 1)));
    data = d;
  }
  // U podílu se dá smlouvat i o procentech, nejen o ceně — „beru, ale za deset
  // procent" je stejně legitimní protinávrh jako jiná cena.
  if (t.predmet === 'podil' && b.podil != null) {
    const podil = Math.max(PODIL_MIN, Math.min(PODIL_MAX, Number(b.podil) || 0));
    // Prodává majitel firmy: u „koupim" je to protistrana, u „prodam" já.
    const firmaId = novySmer === 'koupim' ? t.from_id : req.player.id;
    const uz = await prodanyPodil(firmaId);
    if (uz + podil > PODIL_MAX + 1e-9) {
      return res.status(409).json({ error: stx(req)('server.z_firmy_je_prodano_uz_pct', { p1: Math.round(uz * 100) }) });
    }
    const kupujiciId = novySmer === 'koupim' ? req.player.id : t.from_id;
    const po = (await podilInvestora(firmaId, kupujiciId)) + podil;
    data = Object.assign({}, data || {}, { podil, po_prodeji: po,
      vetsina: po > PODIL_VETSINA + 1e-9 });
  }
  // Platím-li po prohození já, musí na to být volná hotovost.
  const platimJa = t.predmet === 'pujcka' ? novySmer === 'prodam' : novySmer === 'koupim';
  if (platimJa && cena > 0) {
    const chybi = await hotovostStaci(req.player, cena, t.id, stx(req));
    if (chybi) return res.status(409).json({ error: chybi });
  }

  let novy;
  try {
  novy = await prisma.$transaction(async (tx) => {
    // Protinávrh starou nabídku zavírá — a zavřít ji smí jen ten, kdo ji
    // zastihl ještě čekající.
    SOUBEH.zamkni(await tx.gameTrade.updateMany({ where: { id: t.id, stav: 'ceka' },
      data: { stav: 'protinavrh', resolved_at: new Date() } }),
      'server.tahle_nabidka_uz_neni_ve_hre');
    // Předmět i směr zůstávají, jen se prohodí, kdo komu píše.
    return tx.gameTrade.create({ data: {
      from_id: req.player.id, from_nick: req.player.nick, to_id: t.from_id, to_nick: t.from_nick,
      smer: novySmer,
      predmet: t.predmet, model: t.model, spot_id: t.spot_id, card_kind: t.card_kind,
      cena, karty, data, vzkaz: s((req.body || {}).vzkaz, 200) || null, parent_id: t.id,
    } });
  });
  } catch (e) { if (SOUBEH.odpoved(e, res, stx(req))) return; throw e; }
  if (novy) require('../services/game/pristupy').zapis(req, req.player.id, 'protinavrh', novy.id);
  if (novy && novy.vzkaz) require('../services/game/moderace').zkontroluj({ player: req.player, zdroj: 'vzkaz', refId: novy.id, text: novy.vzkaz, komu: t.from_nick });
  res.json({ ok: true, trade: verejny(novy, req.player.id, await firmyPro(novy)) });
}));

// POST /trade/:id/decline — odmítnutí
router.post('/trade/:id/decline', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = await prisma.gameTrade.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ error: stx(req)('server.nabidka_nenalezena_2') });
  if (t.to_id !== req.player.id && t.from_id !== req.player.id) return res.status(403).json({ error: stx(req)('server.tahle_nabidka_neni_tvoje') });
  if (t.stav !== 'ceka') return res.status(409).json({ error: stx(req)('server.tahle_nabidka_uz_neni_ve_hre_2') });
  // Podmíněně: mezi kontrolou a zápisem ji mohl protějšek přijmout. Pak je
  // převod hotový a přepsat stav na „odmítnuto" by o něm lhalo.
  const r = await prisma.gameTrade.updateMany({ where: { id, stav: 'ceka' },
    data: { stav: t.from_id === req.player.id ? 'zruseno' : 'odmitnuto', resolved_at: new Date() } });
  if (r.count !== 1) {
    return res.status(409).json({ error: stx(req)('server.tahle_nabidka_uz_neni_ve_hre_2') });
  }
  res.json({ ok: true });
}));

// POST /trade/:id/accept — přijetí a samotný převod
router.post('/trade/:id/accept', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = await prisma.gameTrade.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ error: stx(req)('server.nabidka_nenalezena_3') });
  if (t.to_id !== req.player.id) return res.status(403).json({ error: stx(req)('server.prijmout_ji_muze_jen_ten_komu') });
  if (t.stav === 'ceka') require('../services/game/pristupy').zapis(req, req.player.id, 'prijeti', t.id);
  if (t.stav !== 'ceka') return res.status(409).json({ error: stx(req)('server.tahle_nabidka_uz_neni_ve_hre_3') });

  const odesilatel = await prisma.gamePlayer.findUnique({ where: { id: t.from_id } });
  if (!odesilatel || odesilatel.disabled) return res.status(409).json({ error: stx(req)('server.druhy_hrac_uz_nehraje') });

  // Kdo je kdo: u „koupim" kupuje odesílatel, u „prodam" kupuje příjemce.
  const kupujici = t.smer === 'koupim' ? odesilatel : req.player;
  const prodavajici = t.smer === 'koupim' ? req.player : odesilatel;

  const chyba = await zkontroluj(t, prodavajici, stx(req));
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
    return res.status(409).json({ error: stx(req)(t.predmet === 'pujcka'
      ? 'server.veritel_nema_dost_hotovosti' : 'server.kupujici_nema_dost_hotovosti',
      { penize: hotovost }) });
  }
  // Odkup: podíl musí pořád běžet a držet ho spolu ti dva, co se domlouvají.
  let odkupEq = null;
  if (t.predmet === 'odkup') {
    odkupEq = await prisma.gameEquity.findUnique({ where: { id: ((t.data || {}).equity_id) || 0 } });
    if (!odkupEq || odkupEq.stav !== 'bezi'
      || odkupEq.firma_id !== kupujici.id || odkupEq.investor_id !== prodavajici.id) {
      await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
      return res.status(409).json({ error: stx(req)('server.ten_podil_uz_mezi_vami_nebezi') });
    }
  }
  // Převod podílu na třetího: musí pořád běžet a pořád ho musí držet prodávající.
  let prevodEq = null;
  if (t.predmet === 'prevod') {
    prevodEq = await prisma.gameEquity.findUnique({ where: { id: ((t.data || {}).equity_id) || 0 } });
    if (!prevodEq || prevodEq.stav !== 'bezi' || prevodEq.investor_id !== prodavajici.id
      || prevodEq.firma_id === kupujici.id) {
      await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
      return res.status(409).json({ error: stx(req)('server.ten_podil_uz_takhle_nebezi') });
    }
  }
  if (t.predmet === 'podil') {
    const uz = await prodanyPodil(prodavajici.id);
    const p = Number((t.data || {}).podil) || 0;
    if (uz + p > PODIL_MAX + 1e-9) {
      await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
      return res.status(409).json({ error: stx(req)('server.z_firmy_je_mezitim_prodano_uz') + Math.round(uz * 100) + ' %.' });
    }
  }
  let zastavaSpot = t.predmet === 'pujcka' ? ((t.data || {}).zastava || null) : null;
  let zastavaNazev = t.predmet === 'pujcka' ? ((t.data || {}).zastava_nazev || null) : null;
  const zastavaPodil = t.predmet === 'pujcka' ? (Number((t.data || {}).zastava_podil) || null) : null;
  // Konverze volný podíl nepotřebuje — vydává se nový — takže se tu na nic
  // neptáme. Stačí, že se vejde do stropu, který platí i pro vstup.
  const konverzePodil = t.predmet === 'pujcka'
    ? (Number((t.data || {}).konverze_podil) ? Math.min(VSTUP_MAX, Number((t.data || {}).konverze_podil)) : null)
    : null;
  // Mezi vystavením a přijetím mohl podílník zákaz zapnout. Rozhoduje stav
  // v okamžiku, kdy zástava doopravdy vzniká — tedy teď.
  if (zastavaSpot || zastavaPodil || konverzePodil) {
    const blokuje = await blokujeZastavu(kupujici.id);
    if (blokuje) {
      return res.status(409).json({ error: stx(req)('server.zastavu_blokuje_podilnik', { p1: blokuje }) });
    }
  }
  if (zastavaPodil) {
    // Od vystavení nabídky mohl dlužník podíl prodat jinam. Zastavit se dá
    // jen to, co je pořád volné.
    const volne = PODIL_MAX - await prodanyPodil(kupujici.id);
    if (zastavaPodil > volne + 1e-9) {
      await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
      return res.status(409).json({ error: stx(req)('server.na_zastavu_podilem_uz_nema',
        { p1: Math.round(zastavaPodil * 100), p2: Math.round(Math.max(0, volne) * 100) }) });
    }
  }
  if (zastavaSpot) {
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: zastavaSpot } });
    if (!c || c.player_id !== kupujici.id) {
      await prisma.gameTrade.update({ where: { id }, data: { stav: 'neplatne', resolved_at: new Date() } });
      return res.status(409).json({ error: stx(req)('server.zastaveny_pradlomat_uz_dluznikovi_nepatri') });
    }
  } else if (t.predmet === 'pujcka' && (t.data || {}).zadam_zastavu) {
    // Věřitel si zástavu vymínil, ale vybrat ji může jen dlužník — ten ví,
    // který prádlomat je ochotný dát v sázku.
    if (req.player.id !== kupujici.id) {
      return res.status(409).json({ error: stx(req)('server.dluznik_nevybral_zastavu_cela') });
    }
    const z = s((req.body || {}).zastava, 120);
    if (!z) {
      return res.status(409).json({ error: stx(req)('server.veritel_u_tehle_pujcky_chce_zastavu') });
    }
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: z } });
    if (!c || c.player_id !== kupujici.id) {
      return res.status(409).json({ error: stx(req)('server.zastavou_muze_byt_jen_tvuj_postaveny') });
    }
    zastavaSpot = z; zastavaNazev = c.name || z;
  }

  const karty = Array.isArray(t.karty) ? t.karty : [];
  const tx = stx(req);
  const popisPredmetu = t.predmet === 'stroj' ? (t.model || '').toUpperCase()
    : t.predmet === 'pradlomat' ? tx('predmet.pradlomat')
    : t.predmet === 'pobocka' ? tx('predmet.pobocku', { p1: (t.spot_id || '') })
    : t.predmet === 'pujcka' ? tx('predmet.pujcku')
    : t.predmet === 'podil' ? tx('predmet.podil_pct', { p1: Math.round(((t.data || {}).podil || 0) * 100) })
    : t.predmet === 'vstup' ? tx('predmet.vstup_pct', { p1: Math.round(((t.data || {}).podil || 0) * 100) })
    : t.predmet === 'odklad' ? tx('predmet.odklad_mesicu', { p1: ((t.data || {}).odklad_mesicu || 1) })
    // Karta je poslední známý předmět, ne odkladiště pro všechno ostatní:
    // dokud byla ve větvi „co zbyde", ukázal se každý nový druh obchodu
    // jako „karta" bez názvu — v nabídce i v doručence.
    : t.predmet !== 'karta' ? String(t.predmet || '?')
    : t.predmet === 'odkup' ? tx('predmet.odkup_pct', { p1: Math.round(((t.data || {}).podil || 0) * 100) })
    : t.predmet === 'prevod' ? tx('predmet.podil_pct_firma',
      { p1: pct((t.data || {}).podil), p2: ((t.data || {}).firma_nick || '') })
    : tx('predmet.karta');

  // Čí vlastnictví se tímhle obchodem může pohnout. U podílu a vstupu je to
  // firma prodávajícího, u odkupu a převodu ta, ke které se podíl váže.
  const auditFirma = t.predmet === 'podil' || t.predmet === 'vstup' ? prodavajici.id
    : t.predmet === 'odkup' ? (odkupEq && odkupEq.firma_id)
    : t.predmet === 'prevod' ? (prevodEq && prevodEq.firma_id)
    : null;

  try {
  await prisma.$transaction(async (tx) => {
    // Nabídku zabereme hned prvním zápisem, ne až na konci. Kontrola
    // „stav je ceka" nahoře proběhla před pár desetinami vteřiny a mezitím
    // ji mohl přijmout druhý klik nebo druhý člověk; teprve tohle rozhodne,
    // kdo ji má. Když nezabere, transakce padá a nepřevede se nic.
    SOUBEH.zamkni(await tx.gameTrade.updateMany({ where: { id, stav: 'ceka' },
      data: { stav: 'prijato', resolved_at: new Date() } }),
      'server.tahle_nabidka_uz_neni_ve_hre_3');
    // Otisk před změnou. Zapisuje se uvnitř transakce: buď se stane převod
    // i jeho záznam, nebo ani jedno.
    const auditPred = auditFirma ? await AUDIT.otisk(tx, auditFirma) : null;
    // 1. karty přihozené k ceně → od kupujícího prodávajícímu
    for (const k of karty) {
      const c = await tx.gameCard.findFirst({ where: { player_id: kupujici.id, kind: k, used_at: null }, orderBy: { id: 'asc' } });
      if (!c) throw new Error(stx(req)('server.karta_se_ztratila', { p1: k }));
      await tx.gameCard.update({ where: { id: c.id }, data: { player_id: prodavajici.id } });
    }
    // 2. samotný předmět
    if (t.predmet === 'karta') {
      const c = await tx.gameCard.findFirst({ where: { player_id: prodavajici.id, kind: t.card_kind, used_at: null }, orderBy: { id: 'asc' } });
      if (!c) throw new Error(stx(req)('server.karta_se_ztratila_2'));
      await tx.gameCard.update({ where: { id: c.id }, data: { player_id: kupujici.id } });
    } else if (t.predmet === 'stroj') {
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'stock', model: t.model, amount: -1, popis: 'Prodal jsi ' + popisPredmetu,
      text_kod: 'dor.prodal_jsi', text_data: { p1: popisPredmetu } },
        { player_id: kupujici.id, trade_id: t.id, kind: 'stock', model: t.model, amount: 1, popis: 'Koupil jsi ' + popisPredmetu },
      ] });
    } else if (t.predmet === 'pradlomat') {
      const c = await tx.gameSpotClaim.update({ where: { spot_id: t.spot_id },
        data: { player_id: kupujici.id, nick: kupujici.nick } });
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'unit_remove', spot_id: t.spot_id, popis: 'Prodal jsi prádlomat ' + (c.name || '') , text_kod: 'dor.prodal_jsi_pradlomat', text_data: { p1: (c.name || '') }},
        { player_id: kupujici.id, trade_id: t.id, kind: 'unit_add', spot_id: t.spot_id, model: c.model,
          data: { name: c.name, lat: c.lat, lon: c.lon, rent: c.rent, area_key: c.area_key },
          popis: 'Koupil jsi prádlomat ' + (c.name || '') , text_kod: 'dor.koupil_jsi_pradlomat', text_data: { p1: (c.name || '') }},
      ] });
    } else if (t.predmet === 'pobocka') {
      // Pobočka se přesouvá přes doručenky — stav hry si ji přepíše sám.
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'pobocka_remove', spot_id: t.spot_id,
          popis: 'Prodal jsi pobočku ' + (t.spot_id || '') , text_kod: 'dor.prodal_jsi_pobocku', text_data: { p1: (t.spot_id || '') }},
        { player_id: kupujici.id, trade_id: t.id, kind: 'pobocka_add', spot_id: t.spot_id,
          popis: 'Koupil jsi pobočku ' + (t.spot_id || '') , text_kod: 'dor.koupil_jsi_pobocku', text_data: { p1: (t.spot_id || '') }},
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
        zastava_podil: zastavaPodil, konverze_podil: konverzePodil,
        dalsi_at: new Date(Date.now() + MESIC_MS),
      } });
      await tx.gameDelivery.createMany({ data: [
        { player_id: prodavajici.id, trade_id: t.id, kind: 'cash', amount: -t.cena,
          popis: 'Půjčil jsi ' + kupujici.nick , text_kod: 'dor.pujcil_jsi', text_data: { p1: kupujici.nick }},
        { player_id: kupujici.id, trade_id: t.id, kind: 'cash', amount: t.cena,
          popis: 'Půjčka od ' + prodavajici.nick , text_kod: 'dor.pujcka_od', text_data: { p1: prodavajici.nick }},
      ] });
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
    // 3b1. odklad: splátka se posune a zmeškané se odpustí. Je to jediné
    // místo, kde se počítadlo zmeškaných vrací na nulu — dohodou obou stran.
    // Proto se taky hned ověřuje, že půjčka pořád běží a pořád patří těmhle
    // dvěma: od vystavení nabídky mohla propadnout.
    if (t.predmet === 'odklad') {
      const pid = parseInt((t.data || {}).loan_id, 10) || 0;
      const mes = Math.max(1, Math.min(ODKLAD_MAX_MESICU, Math.round(Number((t.data || {}).odklad_mesicu) || 1)));
      const pujcka = await tx.gameLoan.findUnique({ where: { id: pid } });
      if (!pujcka || pujcka.stav !== 'bezi'
        || pujcka.borrower_id !== kupujici.id || pujcka.lender_id !== prodavajici.id) {
        throw new Error('odklad-neplatny');
      }
      await tx.gameLoan.update({ where: { id: pid }, data: {
        zmeskano: 0,
        dalsi_at: new Date(Math.max(Date.now(), new Date(pujcka.dalsi_at).getTime()) + mes * MESIC_MS),
      } });
      await tx.gameDelivery.createMany({ data: [
        { player_id: kupujici.id, trade_id: t.id, kind: 'zprava',
          popis: prodavajici.nick + ' ti odložil splátku', text_kod: 'dor.odklad_tobe',
          text_data: { p1: prodavajici.nick, p2: mes } },
        { player_id: prodavajici.id, trade_id: t.id, kind: 'zprava',
          popis: 'Odložil jsi splátku ' + kupujici.nick, text_kod: 'dor.odklad_tvuj',
          text_data: { p1: kupujici.nick, p2: mes } },
      ] });
    }
    // 3b2. kapitálový vstup: peníze jdou majiteli firmy a investor za ně
    // dostane nově vydaný podíl. Dosavadní podíly se musí PŘEPOČÍTAT, ne jen
    // doplnit o nový — jinak by součet přerostl sto procent, nebo by se
    // někomu potichu ubralo. Krátí se podíl, ne pořizovací cena a vyplacené
    // dividendy: ty jsou historie a ředěním se nemění.
    if (t.predmet === 'vstup') {
      const f = Math.max(VSTUP_MIN, Math.min(VSTUP_MAX, Number((t.data || {}).podil) || 0));
      const stavajici = await tx.gameEquity.findMany({
        where: { firma_id: prodavajici.id, stav: 'bezi' },
        select: { id: true, podil: true, investor_id: true },
      });
      for (const e of PODILY.redeni(stavajici, f)) {
        await tx.gameEquity.update({ where: { id: e.id }, data: { podil: e.podil } });
      }
      await tx.gameEquity.create({ data: {
        trade_id: t.id,
        investor_id: kupujici.id, investor_nick: kupujici.nick,
        firma_id: prodavajici.id, firma_nick: prodavajici.nick,
        podil: f, cena: t.cena, dalsi_at: new Date(Date.now() + MESIC_MS),
      } });
      // Dosavadním podílníkům to musí někdo říct. Zředili se a nikdo se jich
      // neptal — doručenka bez peněz je jediné místo, kde se to dozvědí.
      const komu = PODILY.redeni(stavajici, f).filter((e) => e.investor_id !== kupujici.id);
      if (komu.length) {
        await tx.gameDelivery.createMany({ data: komu.map((e) => ({
          player_id: e.investor_id, trade_id: t.id, kind: 'cash', amount: 0,
          popis: 'Do firmy ' + prodavajici.nick + ' vstoupil nový investor, tvůj podíl se zředil',
          text_kod: 'dor.redeni_podilu',
          text_data: { p1: prodavajici.nick, p2: Math.round(f * 100) },
        })) });
      }
    }
    // 3d. převod: podíl nezaniká, jen mění držitele. Pořizovací cena a vyplaceno
    // se novému majiteli počítají od nuly — jinak by zdědil cizí výnos a jeho
    // „kolik mi to vyneslo" by lhalo. Termín dalšího vyrovnání zůstává, takže
    // nejbližší výplata jde celá tomu, kdo podíl drží v tu chvíli.
    if (t.predmet === 'prevod' && prevodEq) {
      // Nabídnout šel i kus podílu. Kolik se opravdu převádí, se ověřuje až
      // tady — mezitím mohl prodávající část pustit jinudy.
      let podil = Number((t.data || {}).podil);
      if (!(podil > 0) || podil > prevodEq.podil + 1e-9) podil = prevodEq.podil;
      const zbytek = prevodEq.podil - podil;
      // Co zůstává prodávajícímu: pořizovací cena i vyplacené dividendy se
      // krátí ve stejném poměru, jinak by zbytek v knize vypadal dráž, než je.
      const dil = (v) => Math.round((Number(v) || 0) * (zbytek / prevodEq.podil));
      if (zbytek < 1e-9) {
        await tx.gameEquity.update({ where: { id: prevodEq.id }, data: {
          investor_id: kupujici.id, investor_nick: kupujici.nick,
          cena: t.cena, vyplaceno: 0, trade_id: t.id,
        } });
      } else {
        await tx.gameEquity.update({ where: { id: prevodEq.id },
          data: { podil: zbytek, cena: dil(prevodEq.cena), vyplaceno: dil(prevodEq.vyplaceno) } });
        await tx.gameEquity.create({ data: {
          trade_id: t.id,
          investor_id: kupujici.id, investor_nick: kupujici.nick,
          firma_id: prevodEq.firma_id, firma_nick: prevodEq.firma_nick,
          podil, cena: t.cena, dalsi_at: prevodEq.dalsi_at,
        } });
      }
    }
    // 3c. odkup: podíl se uzavírá, peníze pak projdou běžnou cestou níž
    if (t.predmet === 'odkup' && odkupEq) {
      await tx.gameEquity.update({ where: { id: odkupEq.id }, data: { stav: 'odkoupeno' } });
    }
    // 3. peníze
    if (t.cena > 0) {
      await tx.gameDelivery.createMany({ data: [
        { player_id: kupujici.id, trade_id: t.id, kind: 'cash', amount: -t.cena, popis: 'Zaplatil jsi za ' + popisPredmetu },
        { player_id: prodavajici.id, trade_id: t.id, kind: 'cash', amount: t.cena, popis: 'Utržil jsi za ' + popisPredmetu , text_kod: 'dor.utrzil_jsi_za', text_data: { p1: popisPredmetu }},
      ] });
    }
    if (auditPred) {
      await AUDIT.zapis(tx, auditFirma, auditPred,
        { duvod: t.predmet, trade_id: t.id, protistrana_id: kupujici.id });
    }
  });
  } catch (e) { if (SOUBEH.odpoved(e, res, stx(req))) return; throw e; }

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

// ─── Veřejná nabídka na odkup podílů ────────────────────────────────────────
// Míří na všechny podílníky firmy najednou. Prodat musí chtít, mlčení je
// odmítnutí a převede se jen to, co kdo doopravdy prodal.
const PREVZETI = require('../services/game/prevzeti');

// POST /trade/prevzeti { firma_id, cena_za_pct, pct, hodin }
router.post('/trade/prevzeti', hrac, api(async (req, res) => {
  const b = req.body || {};
  const firmaId = parseInt(b.firma_id, 10) || 0;
  if (!firmaId || firmaId === req.player.id) {
    return res.status(400).json({ error: stx(req)('server.na_vlastni_firmu_nabidku_nedavas') });
  }
  const firma = await prisma.gamePlayer.findUnique({ where: { id: firmaId } });
  if (!firma || firma.disabled) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni') });

  const cenaZaPct = Math.max(PREVZETI.CENA_MIN, Math.round(Number(b.cena_za_pct) || 0));
  const pct = Math.max(PREVZETI.PCT_MIN, Math.min(PREVZETI.PCT_MAX, Number(b.pct) || 0));
  const hodin = Math.max(PREVZETI.HODIN_MIN,
    Math.min(PREVZETI.HODIN_MAX, Math.round(Number(b.hodin) || PREVZETI.HODIN_VYCHOZI)));

  // Výstupní nabídka: trvalý odkup zbytku od toho, kdo firmu ovládá. Nemá
  // lhůtu a nevykupuje nikoho násilím — menšina prodat může, ale nemusí.
  // Je to jediná cesta ven z firmy, do které už nikdo jiný neinvestuje.
  const trvala = !!b.trvala;
  if (trvala) {
    const seznam = await pravaFirmy(firmaId);
    if (!PREVZETI.smiVystupni(seznam, req.player.id)) {
      return res.status(403).json({ error: stx(req)('server.vystupni_nabidku_smi_az_od_pct',
        { p1: Math.round(PREVZETI.PRAH_VYSTUPNI * 100) }) });
    }
    // Cena nesmí být pod oceněním firmy. Pod ním už to není nabídka na
    // odchod, ale pokuta za to, že někdo zůstal v menšině.
    const JMENI = require('../services/game/jmeni');
    const jmeni = await JMENI.proHrace(firma.id, stavu(firma));
    const dno = PREVZETI.minCenaZaPct(jmeni);
    if (cenaZaPct < dno) {
      return res.status(409).json({ error: stx(req)('server.vystupni_cena_pod_ocenenim', { p1: dno }) });
    }
  }

  // Jedna běžící nabídka na firmu od jednoho útočníka. Dvě by si navzájem
  // přebíjely cenu a podílník by nevěděl, které věřit.
  const uz = await prisma.gameTender.findFirst({
    where: { utocnik_id: req.player.id, firma_id: firmaId, stav: 'bezi', do: { gt: new Date() } },
  });
  if (uz) return res.status(409).json({ error: stx(req)('server.na_tuhle_firmu_uz_nabidku_mas') });

  // Peníze se nedají zamknout — hotovost žije ve stavu hry. Aspoň se
  // zkontroluje, že na celou nabídku teď má: útočník, co slibuje, co nemá,
  // by jinak zjistil až po prvním prodeji, že na zbytek nedosáhne.
  // U trvalé nabídky se dopředu kontrolovat nedá: neví se, kolik jí kdo
  // prodá ani kdy. Hlídá se proto při každém jednotlivém prodeji.
  const potreba = trvala ? 0 : Math.round(pct * 100 * cenaZaPct);
  const hotovost = Math.round(stavu(req.player).cash || 0);
  if (potreba > hotovost) {
    return res.status(409).json({ error: stx(req)('server.na_celou_nabidku_nemas',
      { p1: potreba, p2: hotovost }) });
  }

  const t = await prisma.gameTender.create({ data: {
    utocnik_id: req.player.id, utocnik_nick: req.player.nick,
    firma_id: firma.id, firma_nick: firma.nick,
    cena_za_pct: cenaZaPct, trvala,
    // Trvalá vykupuje, co kdo přinese, a konec nemá.
    max_pct: trvala ? PREVZETI.PCT_MAX : pct,
    do: trvala ? null : new Date(Date.now() + hodin * 3600000),
  } });

  // Podílníkům a majiteli to musí někdo říct — nabídka, o které nikdo neví,
  // je k ničemu a hráč by o ní zjistil, až by bylo po lhůtě.
  const podilnici = await prisma.gameEquity.findMany({
    where: { firma_id: firma.id, stav: 'bezi' }, select: { investor_id: true },
  });
  const komu = Array.from(new Set(podilnici.map((e) => e.investor_id).concat([firma.id])))
    .filter((x) => x !== req.player.id);
  if (komu.length) {
    await prisma.gameDelivery.createMany({ data: komu.map((pid) => ({
      player_id: pid, kind: 'zprava',
      popis: req.player.nick + ' vyhlásil nabídku na odkup podílů ve firmě ' + firma.nick,
      text_kod: 'dor.prevzeti_vyhlaseno',
      text_data: { p1: req.player.nick, p2: firma.nick, p3: cenaZaPct },
    })) });
  }
  console.log('[game] převzetí: ' + req.player.nick + ' → ' + firma.nick
    + ' · ' + Math.round(pct * 100) + ' % za ' + cenaZaPct + ' L$/%');
  res.json({ ok: true, nabidka: PREVZETI.verejna(t, req.player.id) });
}));

// POST /trade/zastava-souhlas { firma_id, zakaz } → blokační menšina
// zapíná nebo vypíná zákaz zastavit majetek firmy.
//
// Je to přepínač, ne žádost o souhlas. Majitel na nic nečeká a rovnou vidí,
// na čem je — kdyby to byla žádost, stál by s rozjednanou půjčkou tři dny,
// než se podílník přihlásí.
router.post('/trade/zastava-souhlas', hrac, api(async (req, res) => {
  const b = req.body || {};
  const firmaId = parseInt(b.firma_id, 10) || 0;
  const firma = await prisma.gamePlayer.findUnique({ where: { id: firmaId } });
  if (!firma) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni') });

  const seznam = await pravaFirmy(firmaId);
  if (!PRAVA.smiBlokovat(seznam, req.player.id)) {
    return res.status(403).json({ error: stx(req)('server.na_blokaci_zastavy_nemas_dost',
      { p1: Math.round(PRAVA.BLOKACNI * 100) }) });
  }
  const zakaz = !!b.zakaz;
  // Zákaz se zapisuje na všechny moje podíly v té firmě — nastavuje si ho
  // člověk pro celý svůj podíl, ne pro jednu řádku v databázi.
  await prisma.gameEquity.updateMany({
    where: { firma_id: firmaId, investor_id: req.player.id, stav: 'bezi' },
    data: { zakaz_zastavy: zakaz },
  });

  // Majitel se to musí dozvědět hned. Zjistit až od protistrany, že se
  // sjednaná půjčka nedá přijmout, by bylo nepěkné.
  await prisma.gameDelivery.create({ data: {
    player_id: firmaId, kind: 'zprava',
    popis: req.player.nick + (zakaz ? ' zakázal zastavit majetek firmy' : ' zastavení majetku firmy zase povolil'),
    text_kod: zakaz ? 'dor.zastava_zakazana' : 'dor.zastava_povolena',
    text_data: { p1: req.player.nick },
  } });
  console.log('[game] zástava: ' + req.player.nick + ' → ' + firma.nick
    + ' · ' + (zakaz ? 'zákaz' : 'povoleno'));
  res.json({ ok: true, zakaz });
}));

// ─── Investiční aliance ──────────────────────────────────────────────────────
// Podíly členů se v jedné firmě sčítají, takže blok dosáhne na prahy, na
// které sám nedosáhne nikdo. Kdo vstoupí, přenechává svůj hlas mluvčímu —
// je to skutečná cena za vstup a musí ji vidět dřív, než pozvánku přijme.

// GET /trade/aliance → moje aliance, členové a nevyřízené pozvánky
router.get('/trade/aliance', hrac, api(async (req, res) => {
  const ja = req.player.id;
  const moje = await prisma.gameAlianceClen.findFirst({
    where: { player_id: ja, stav: 'clen' } });
  const pozvanky = await prisma.gameAlianceClen.findMany({
    where: { player_id: ja, stav: 'pozvan' }, orderBy: { created_at: 'desc' }, take: 10 });
  const ids = Array.from(new Set(pozvanky.map((p) => p.aliance_id)
    .concat(moje ? [moje.aliance_id] : [])));
  const aliance = ids.length
    ? await prisma.gameAliance.findMany({ where: { id: { in: ids } } }) : [];
  const nazvy = new Map(aliance.map((a) => [a.id, a.nazev]));

  let clenove = [];
  if (moje) {
    const rows = await prisma.gameAlianceClen.findMany({
      where: { aliance_id: moje.aliance_id }, orderBy: { created_at: 'asc' } });
    const hraci = await prisma.gamePlayer.findMany({
      where: { id: { in: rows.map((r) => r.player_id) } },
      select: { id: true, nick: true, company: true } });
    const jm = new Map(hraci.map((h) => [h.id, h.company || h.nick]));
    clenove = rows.map((r) => ({ id: r.player_id, kdo: jm.get(r.player_id) || ('#' + r.player_id),
      stav: r.stav, ja: r.player_id === ja }));
  }
  res.json({ ok: true,
    aliance: moje ? { id: moje.aliance_id, nazev: nazvy.get(moje.aliance_id) || '', clenove } : null,
    pozvanky: pozvanky.map((p) => ({ aliance_id: p.aliance_id,
      nazev: nazvy.get(p.aliance_id) || '' })),
    max_clenu: ALIANCE.MAX_CLENU });
}));

// POST /trade/aliance { nazev } → založit
router.post('/trade/aliance', hrac, api(async (req, res) => {
  const nazev = ALIANCE.nazevOk((req.body || {}).nazev);
  if (!nazev) return res.status(400).json({ error: stx(req)('server.nazev_aliance_je_kratky_nebo_dlouhy',
    { p1: ALIANCE.NAZEV_MIN, p2: ALIANCE.NAZEV_MAX }) });
  const uz = await prisma.gameAlianceClen.findFirst({ where: { player_id: req.player.id, stav: 'clen' } });
  if (uz) return res.status(409).json({ error: stx(req)('server.uz_v_alianci_jsi') });
  const a = await prisma.gameAliance.create({
    data: { nazev, zakladatel_id: req.player.id } });
  await prisma.gameAlianceClen.create({
    data: { aliance_id: a.id, player_id: req.player.id, stav: 'clen' } });
  console.log('[game] aliance #' + a.id + ' ' + nazev + ' založil ' + req.player.nick);
  res.json({ ok: true, aliance_id: a.id, nazev });
}));

// POST /trade/aliance/pozvat { player_id }
router.post('/trade/aliance/pozvat', hrac, api(async (req, res) => {
  const koho = parseInt((req.body || {}).player_id, 10) || 0;
  if (koho === req.player.id) return res.status(400).json({ error: stx(req)('server.sam_sebe_zvat_nemusis') });
  const moje = await prisma.gameAlianceClen.findFirst({
    where: { player_id: req.player.id, stav: 'clen' } });
  if (!moje) return res.status(403).json({ error: stx(req)('server.v_zadne_alianci_nejsi') });
  const kdo = await prisma.gamePlayer.findUnique({ where: { id: koho } });
  if (!kdo || kdo.disabled) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni') });

  // Strop se počítá i s nevyřízenými pozvánkami: kdyby ne, pozve se jich
  // deset a aliance se naplní podle toho, kdo byl zrovna u telefonu.
  const kolik = await prisma.gameAlianceClen.count({ where: { aliance_id: moje.aliance_id } });
  if (!ALIANCE.jeMisto(kolik)) {
    return res.status(409).json({ error: stx(req)('server.aliance_je_plna', { p1: ALIANCE.MAX_CLENU }) });
  }
  const uzClen = await prisma.gameAlianceClen.findFirst({ where: { player_id: koho, stav: 'clen' } });
  if (uzClen) return res.status(409).json({ error: stx(req)('server.ten_hrac_uz_alianci_ma') });

  const a = await prisma.gameAliance.findUnique({ where: { id: moje.aliance_id } });
  await prisma.gameAlianceClen.createMany({
    data: [{ aliance_id: moje.aliance_id, player_id: koho, stav: 'pozvan', pozval_id: req.player.id }],
    skipDuplicates: true,
  });
  await prisma.gameDelivery.create({ data: {
    player_id: koho, kind: 'zprava',
    popis: req.player.nick + ' tě zve do aliance ' + (a ? a.nazev : ''),
    text_kod: 'dor.aliance_pozvanka',
    text_data: { p1: req.player.nick, p2: a ? a.nazev : '' },
  } });
  res.json({ ok: true });
}));

// POST /trade/aliance/prijmout { aliance_id }
router.post('/trade/aliance/prijmout', hrac, api(async (req, res) => {
  const id = parseInt((req.body || {}).aliance_id, 10) || 0;
  const p = await prisma.gameAlianceClen.findFirst({
    where: { aliance_id: id, player_id: req.player.id, stav: 'pozvan' } });
  if (!p) return res.status(404).json({ error: stx(req)('server.takovou_pozvanku_nemas') });
  const kolik = await prisma.gameAlianceClen.count({ where: { aliance_id: id, stav: 'clen' } });
  if (!ALIANCE.jeMisto(kolik)) {
    return res.status(409).json({ error: stx(req)('server.aliance_je_plna', { p1: ALIANCE.MAX_CLENU }) });
  }
  try {
    await prisma.gameAlianceClen.update({ where: { id: p.id }, data: { stav: 'clen' } });
  } catch (e) {
    // Částečný unikátní index: členství je jen jedno. Dvě přijetí ve stejnou
    // vteřinu tu skončí, a je to tak správně.
    return res.status(409).json({ error: stx(req)('server.uz_v_alianci_jsi') });
  }
  // Ostatní pozvánky padají — členství je jedno a visící pozvánky by jen
  // mátly.
  await prisma.gameAlianceClen.deleteMany({
    where: { player_id: req.player.id, stav: 'pozvan' } }).catch(() => {});
  const a = await prisma.gameAliance.findUnique({ where: { id } });
  const ostatni = await prisma.gameAlianceClen.findMany({
    where: { aliance_id: id, stav: 'clen', player_id: { not: req.player.id } },
    select: { player_id: true } });
  if (ostatni.length) {
    await prisma.gameDelivery.createMany({ data: ostatni.map((o) => ({
      player_id: o.player_id, kind: 'zprava',
      popis: req.player.nick + ' vstoupil do aliance ' + (a ? a.nazev : ''),
      text_kod: 'dor.aliance_vstoupil',
      text_data: { p1: req.player.nick, p2: a ? a.nazev : '' },
    })) });
  }
  res.json({ ok: true });
}));

// POST /trade/aliance/odejit → odchod je okamžitý, práva se přepočítají
router.post('/trade/aliance/odejit', hrac, api(async (req, res) => {
  const moje = await prisma.gameAlianceClen.findFirst({
    where: { player_id: req.player.id, stav: 'clen' } });
  if (!moje) return res.status(404).json({ error: stx(req)('server.v_zadne_alianci_nejsi') });
  await prisma.gameAlianceClen.delete({ where: { id: moje.id } });
  const zbyva = await prisma.gameAlianceClen.count({
    where: { aliance_id: moje.aliance_id, stav: 'clen' } });
  // Aliance bez členů nemá co držet. Pozvánky do ní by zůstaly viset.
  if (!zbyva) {
    await prisma.gameAlianceClen.deleteMany({ where: { aliance_id: moje.aliance_id } }).catch(() => {});
    await prisma.gameAliance.delete({ where: { id: moje.aliance_id } }).catch(() => {});
  }
  console.log('[game] aliance #' + moje.aliance_id + ': odešel ' + req.player.nick
    + ', zbývá ' + zbyva);
  res.json({ ok: true, zrusena: !zbyva });
}));

// POST /trade/dividenda { firma_id, pct } → většinový podílník určuje,
// kolik procent měsíčního zisku firma vyplácí.
//
// Je to první pravomoc, kterou většina ve hře má, a schválně je úzká: mění
// se jedno číslo a nic jiného. Nikdo nesahá na cizí uloženou hru — majitel
// si dál staví, co chce, jen mu z firmy odchází víc nebo míň peněz.
router.post('/trade/dividenda', hrac, api(async (req, res) => {
  const DIVIDENDA = require('../services/game/dividenda');
  const b = req.body || {};
  const firmaId = parseInt(b.firma_id, 10) || 0;
  const firma = await prisma.gamePlayer.findUnique({ where: { id: firmaId } });
  if (!firma || firma.disabled) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni') });

  // Většinu má člověk, ne řádka — dva podíly téhož investora se sčítají.
  const vsechny = await prisma.gameEquity.findMany({
    where: { firma_id: firmaId, stav: 'bezi' }, select: { investor_id: true, podil: true } });
  const souhrn = new Map();
  vsechny.forEach((e) => souhrn.set(e.investor_id,
    (souhrn.get(e.investor_id) || 0) + (e.podil || 0)));
  const seznam = Array.from(souhrn, ([investor_id, podil]) => ({ investor_id, podil }));
  if (!DIVIDENDA.smiMenit(seznam, req.player.id)) {
    return res.status(403).json({ error: stx(req)('server.dividendu_urcuje_vetsinovy_podilnik') });
  }

  const pct = DIVIDENDA.platna(b.pct);
  if (pct === DIVIDENDA.platna(firma.dividenda_pct)) return res.json({ ok: true, pct });

  await prisma.gamePlayer.update({ where: { id: firmaId },
    data: { dividenda_pct: pct, dividenda_kdo: req.player.id, dividenda_at: new Date() } });

  // Majitel i ostatní podílníci se to musí dozvědět. Mění se jim příjem —
  // zjistit to až z výplaty by bylo nepěkné překvapení.
  const komu = Array.from(new Set(seznam.map((e) => e.investor_id).concat([firmaId])))
    .filter((x) => x !== req.player.id);
  if (komu.length) {
    await prisma.gameDelivery.createMany({ data: komu.map((pid) => ({
      player_id: pid, kind: 'zprava',
      popis: req.player.nick + ' nastavil ve firmě ' + firma.nick + ' výplatu zisku na '
        + Math.round(pct * 100) + ' %',
      text_kod: 'dor.dividenda_zmenena',
      text_data: { p1: req.player.nick, p2: firma.nick, p3: Math.round(pct * 100) },
    })) });
  }
  console.log('[game] dividenda: ' + req.player.nick + ' → ' + firma.nick
    + ' · ' + Math.round(pct * 100) + ' %');
  res.json({ ok: true, pct });
}));

// POST /trade/prevzeti/:id/zrusit → útočník stahuje svou nabídku
router.post('/trade/prevzeti/:id/zrusit', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = await prisma.gameTender.findUnique({ where: { id } });
  if (!t || PREVZETI.stav(t) !== 'bezi') {
    return res.status(409).json({ error: stx(req)('server.tahle_nabidka_uz_nebezi') });
  }
  if (t.utocnik_id !== req.player.id) {
    return res.status(403).json({ error: stx(req)('server.stahnout_ji_muze_jen_kdo_ji_dal') });
  }
  await prisma.gameTender.update({ where: { id }, data: { stav: 'zrusena' } });
  console.log('[game] převzetí #' + id + ' staženo: ' + req.player.nick);
  res.json({ ok: true });
}));

// GET /trade/prevzeti → nabídky, které se mě týkají
router.get('/trade/prevzeti', hrac, api(async (req, res) => {
  res.json({ ok: true, nabidky: await PREVZETI.proHrace(req.player.id) });
}));

// POST /trade/prevzeti/:id/prodat { podil } → podílník prodává svůj kus
router.post('/trade/prevzeti/:id/prodat', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = await prisma.gameTender.findUnique({ where: { id } });
  if (!t || PREVZETI.stav(t) !== 'bezi') {
    return res.status(409).json({ error: stx(req)('server.tahle_nabidka_uz_nebezi') });
  }
  if (t.utocnik_id === req.player.id) {
    return res.status(400).json({ error: stx(req)('server.vlastni_nabidce_prodat_nejdes') });
  }
  const utocnik = await prisma.gamePlayer.findUnique({ where: { id: t.utocnik_id } });
  if (!utocnik || utocnik.disabled) {
    return res.status(409).json({ error: stx(req)('server.druhy_hrac_uz_nehraje') });
  }

  // Předběžně, ať se hráč dozví slušnou hlášku dřív, než se sáhne na
  // databázi. Závazné je ale až to, co se spočítá uvnitř transakce —
  // mezi těmihle řádky a zápisem může prodat někdo další.
  const mamHrube = (await prisma.gameEquity.findMany({
    where: { firma_id: t.firma_id, investor_id: req.player.id, stav: 'bezi' },
    select: { podil: true },
  })).reduce((a, e) => a + (e.podil || 0), 0);
  if (!(mamHrube > 0)) return res.status(409).json({ error: stx(req)('server.v_teto_firme_nic_nedrzis') });
  const zadano = Number(req.body && req.body.podil) || 0;

  let prodano = 0, zaplaceno = 0;
  try {
  await prisma.$transaction(async (tx) => {
    // Nabídku i vlastní podíl čteme znovu a uvnitř transakce. Číslo načtené
    // venku je staré o pár desetin vteřiny a přesně do nich se trefí druhý
    // prodávající — oba by si ukrojili ze stejného zbytku a útočník by
    // vykoupil víc, než nabídl.
    const tt = await tx.gameTender.findUnique({ where: { id: t.id } });
    if (!tt || PREVZETI.stav(tt) !== 'bezi') throw new SOUBEH.Soubeh('server.tahle_nabidka_uz_nebezi');
    const moje = await tx.gameEquity.findMany({
      where: { firma_id: tt.firma_id, investor_id: req.player.id, stav: 'bezi' },
      orderBy: { id: 'asc' },
    });
    const mam = moje.reduce((a, e) => a + (e.podil || 0), 0);
    if (!(mam > 0)) throw new SOUBEH.Soubeh('server.v_teto_firme_nic_nedrzis');

    const podil = Math.min(zadano > 0 ? zadano : mam, mam, PREVZETI.zbyva(tt));
    if (!(podil > 0)) throw new SOUBEH.Soubeh('server.nabidka_je_uz_naplnena');
    const cena = PREVZETI.cenaZa(tt, podil);
    if (cena > Math.round(stavu(utocnik).cash || 0)) {
      throw new SOUBEH.Soubeh('server.utocnik_uz_na_to_nema');
    }

    const auditPred = await AUDIT.otisk(tx, tt.firma_id);
    // Zbytek nabídky zabrat dřív, než se sáhne na podíly. Podmínkou je přesně
    // to číslo, se kterým jsme počítali; změnilo-li se, transakce padá a
    // nezapíše se nic.
    const koupeno = (tt.koupeno_pct || 0) + podil;
    SOUBEH.zamkni(await tx.gameTender.updateMany({
      where: { id: tt.id, stav: 'bezi', koupeno_pct: tt.koupeno_pct },
      data: { koupeno_pct: koupeno, stav: koupeno >= tt.max_pct - 1e-9 ? 'naplnena' : 'bezi' },
    }), 'server.tahle_nabidka_uz_nebezi');

    // Bereme z vlastních podílů od nejstaršího, dokud není pokryto. Každý
    // zápis má v podmínce původní velikost řádku — kdyby ho mezitím někdo
    // ukrojil (prodej do druhé nabídky, která běží nad toutéž firmou),
    // netrefí se a padá celá transakce.
    let zbyvaVzit = podil;
    for (const e of moje) {
      if (zbyvaVzit <= 1e-9) break;
      const vezmi = Math.min(e.podil, zbyvaVzit);
      const zbytek = e.podil - vezmi;
      const dil = (v) => Math.round((Number(v) || 0) * (zbytek / e.podil));
      const kde = { id: e.id, investor_id: req.player.id, stav: 'bezi', podil: e.podil };
      if (zbytek < 1e-9) {
        SOUBEH.zamkni(await tx.gameEquity.updateMany({ where: kde, data: {
          investor_id: utocnik.id, investor_nick: utocnik.nick,
          cena: PREVZETI.cenaZa(tt, vezmi), vyplaceno: 0 } }),
          'server.tvuj_podil_se_mezitim_zmenil');
      } else {
        SOUBEH.zamkni(await tx.gameEquity.updateMany({ where: kde,
          data: { podil: zbytek, cena: dil(e.cena), vyplaceno: dil(e.vyplaceno) } }),
          'server.tvuj_podil_se_mezitim_zmenil');
        await tx.gameEquity.create({ data: {
          investor_id: utocnik.id, investor_nick: utocnik.nick,
          firma_id: tt.firma_id, firma_nick: tt.firma_nick,
          podil: vezmi, cena: PREVZETI.cenaZa(tt, vezmi), dalsi_at: e.dalsi_at } });
      }
      zbyvaVzit -= vezmi;
    }
    await tx.gameDelivery.createMany({ data: [
      { player_id: utocnik.id, kind: 'cash', amount: -cena,
        popis: 'Odkoupil jsi podíl ve firmě ' + tt.firma_nick,
        text_kod: 'dor.prevzeti_koupil', text_data: { p1: Math.round(podil * 100), p2: tt.firma_nick } },
      { player_id: req.player.id, kind: 'cash', amount: cena,
        popis: 'Prodal jsi podíl ve firmě ' + tt.firma_nick,
        text_kod: 'dor.prevzeti_prodal', text_data: { p1: Math.round(podil * 100), p2: tt.firma_nick } },
    ] });
    await AUDIT.zapis(tx, tt.firma_id, auditPred,
      { duvod: 'prevzeti', protistrana_id: utocnik.id });
    prodano = podil; zaplaceno = cena;
  });
  } catch (e) { if (SOUBEH.odpoved(e, res, stx(req))) return; throw e; }
  console.log('[game] převzetí #' + t.id + ': ' + req.player.nick + ' prodal '
    + Math.round(prodano * 100) + ' % za ' + zaplaceno + ' L$');
  res.json({ ok: true, prodano, cena: zaplaceno });
}));

// GET /trade/krize → kdo nemá na splátku.
// Nikdo se o nic nehlásí a o nic nežádá: kdo nemá na splátku, ten je vidět.
// Tak to chodí i doopravdy a je to lepší hra než tlačítko „požádat o pomoc",
// které nikdo nestiskne. Vlastní stav posíláme zvlášť — varování vidí jen
// dlužník sám, na nástěnce je až krize.
router.get('/trade/krize', hrac, api(async (req, res) => {
  const KRIZE = require('../services/game/krize');
  const moje = await prisma.gameLoan.findMany({
    where: { borrower_id: req.player.id, stav: 'bezi' },
  });
  const [seznam, ja] = await Promise.all([
    KRIZE.seznam(),
    Promise.resolve(KRIZE.stav(moje, stavu(req.player))),
  ]);
  res.json({ ok: true, ja, firmy: seznam.filter((f) => f.id !== req.player.id) });
}));

router.get('/trade/finance', hrac, api(async (req, res) => {
  const ja = req.player.id;
  const [pujcky, podily] = await Promise.all([
    // Hotové půjčky a odkoupené podíly jdou ven taky — u uzavřené nabídky
    // na burze pak jde napsat, jak to dopadlo. Přehled nahoře si běžící
    // vyfiltruje sám.
    prisma.gameLoan.findMany({
      where: { OR: [{ borrower_id: ja }, { lender_id: ja }] },
      orderBy: { dalsi_at: 'asc' }, take: 100,
    }),
    prisma.gameEquity.findMany({
      where: { OR: [{ investor_id: ja }, { firma_id: ja }] },
      orderBy: { created_at: 'asc' }, take: 100,
    }),
  ]);
  // Kolik z podílu teče teď: procento z toho, co dané firmě měsíčně zbyde.
  // Čteme to z posledního uloženého stavu té firmy — stejné číslo, podle
  // kterého se podíl o půlnoci herního měsíce doopravdy vyplácí.
  const firmy = new Map();
  const politiky = new Map();
  for (const e of podily) {
    const kdo = e.firma_id;
    if (firmy.has(kdo)) continue;
    const f = await prisma.gamePlayer.findUnique({ where: { id: kdo },
      select: { state: true, dividenda_pct: true, dividenda_kdo: true, dividenda_at: true } });
    firmy.set(kdo, Math.round(acct._zbydeMesicne(stavu(f)) || 0));
    politiky.set(kdo, f || {});
  }
  // Práva podílníků ve firmě: kdo určuje výplatu zisku a kdo blokuje
  // zastavení majetku. Musí to vidět majitel i podílníci — jsou to jediná
  // dvě nastavení, do kterých může mluvit někdo jiný než majitel.
  const DIVIDENDA = require('../services/game/dividenda');
  async function jmeno(id) {
    if (!id) return null;
    const h = await prisma.gamePlayer.findUnique({ where: { id },
      select: { nick: true, company: true } });
    return h ? (h.company || h.nick) : null;
  }
  async function politika(firmaId) {
    const f = politiky.get(firmaId) || {};
    const seznam = await pravaFirmy(firmaId);
    const pr = PRAVA.proHrace(seznam, ja);
    // Výstupní nabídka: kdo firmu ovládá, může nechat viset trvalý odkup
    // zbytku. Dno ceny se počítá z ocenění firmy, a jen jemu — ostatním
    // by to byl dotaz navíc pro číslo, které stejně neuvidí.
    const smimVystupni = PREVZETI.smiVystupni(seznam, ja);
    let minCena = null;
    if (smimVystupni) {
      const JMENI = require('../services/game/jmeni');
      minCena = PREVZETI.minCenaZaPct(await JMENI.proHrace(firmaId, stavu(f)));
    }
    // Bloky, které v téhle firmě drží podíl. Majitel je musí vidět i se
    // jménem — skrytý kartel by byl past: nechápal by, proč mu najednou
    // někdo mluví do firmy, a neměl by se jak zařídit.
    const bloky = await alianceBloky(firmaId);
    return Object.assign({}, pr, {
      pct: DIVIDENDA.platna(f.dividenda_pct),
      bloky,
      smim_vystupni: smimVystupni, min_cena: minCena,
      urcuje_nick: await jmeno(pr.urcuje),
      blokuje_nick: await jmeno(pr.blokuje),
      // Jméno z dřívějška: klient ho zná jako „smím měnit dividendu".
      smim: pr.smim_urcovat,
      kdy: f.dividenda_at || null,
    });
  }
  // U podílu je srozumitelnější název firmy než přezdívka hráče — kupuje se
  // kus firmy, ne kus člověka. Bereme aktuální název, ne ten z chvíle prodeje.
  const nazvy = new Map();
  const protistrany = podily.map((e) => (e.investor_id === ja ? e.firma_id : e.investor_id));
  if (protistrany.length) {
    const lide = await prisma.gamePlayer.findMany({
      where: { id: { in: Array.from(new Set(protistrany)) } },
      select: { id: true, nick: true, company: true },
    });
    lide.forEach((h) => { nazvy.set(h.id, h.company || (h.nick + ' s.r.o.')); });
  }
  res.json({ ok: true,
    pujcky: pujcky.map((p) => ({ id: p.id, trade_id: p.trade_id,
      moje: p.borrower_id === ja ? 'dluzim' : 'pujcil',
      kdo: p.borrower_id === ja ? p.lender_nick : p.borrower_nick,
      // Komu psát, když si chce dlužník říct o odklad.
      kdo_id: p.borrower_id === ja ? p.lender_id : p.borrower_id,
      castka: p.castka, urok: p.urok, mesicu: p.mesicu, splatka: p.splatka,
      splaceno: p.splaceno, zmeskano: p.zmeskano, stav: p.stav, doplatek: doplatek(p),
      // Kolik už přes splátky proteklo a kolik má ještě přijít, v penězích.
      zaplaceno: p.splaceno * p.splatka, celkem: p.mesicu * p.splatka,
      zastava: p.zastava_nazev || null, zastava_podil: p.zastava_podil || null,
      konverze_podil: p.konverze_podil || null, dalsi: p.dalsi_at })),
    podily: podily.map((e) => ({ id: e.id, trade_id: e.trade_id,
      moje: e.investor_id === ja ? 'mam' : 'prodal',
      kdo: e.investor_id === ja ? e.firma_nick : e.investor_nick,
      kdo_id: e.investor_id === ja ? e.firma_id : e.investor_id,
      kdo_firma: nazvy.get(e.investor_id === ja ? e.firma_id : e.investor_id) || null,
      podil: e.podil, cena: e.cena, vyplaceno: e.vyplaceno, stav: e.stav,
      // Co by z podílu přišlo při dnešním výdělku firmy. Záporné = firma
      // prodělává a podílník se na ztrátě podílí stejným dílem.
      mesicne: DIVIDENDA.castka(firmy.get(e.firma_id) || 0, e.podil,
        (politiky.get(e.firma_id) || {}).dividenda_pct),
      odkup: Math.round(e.cena * ODKUP_NASOBEK), dalsi: e.dalsi_at })),
    dividendy: Object.fromEntries(await Promise.all(
      Array.from(politiky.keys()).map(async (id) => [id, await politika(id)]))),
    odkup_nasobek: ODKUP_NASOBEK });
}));

// POST /trade/pujcka/:id/splatit → dlužník doplatí zbytek a je hotovo
router.post('/trade/pujcka/:id/splatit', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gameLoan.findUnique({ where: { id } });
  if (!p || p.stav !== 'bezi') return res.status(404).json({ error: stx(req)('server.takova_pujcka_tu_nebezi') });
  if (p.borrower_id !== req.player.id) return res.status(403).json({ error: stx(req)('server.splatit_ji_muze_jen_dluznik') });
  const castka = doplatek(p);
  if (castka <= 0) {
    await prisma.gameLoan.update({ where: { id }, data: { stav: 'splaceno' } });
    return res.json({ ok: true, castka: 0 });
  }
  const hotovost = Math.round(stavu(req.player).cash || 0);
  if (castka > hotovost) {
    return res.status(409).json({ error: stx(req)('server.na_doplaceni_potrebujes') + castka.toLocaleString('cs-CZ')
      + ' L$, máš ' + hotovost.toLocaleString('cs-CZ') + ' L$.' });
  }
  await prisma.$transaction(async (tx) => {
    await tx.gameDelivery.createMany({ data: [
      { player_id: p.borrower_id, kind: 'cash', amount: -castka,
        popis: 'Doplatil jsi půjčku — ' + p.lender_nick , text_kod: 'dor.doplatil_jsi_pujcku', text_data: { p1: p.lender_nick }},
      { player_id: p.lender_id, kind: 'cash', amount: castka,
        popis: p.borrower_nick + ' doplatil půjčku předčasně' , text_kod: 'dor.doplatil_pujcku_predcasne', text_data: { p1: p.borrower_nick }},
    ] });
    await tx.gameLoan.update({ where: { id },
      data: { stav: 'splaceno', splaceno: p.mesicu, zmeskano: 0 } });
  });
  console.log('[game] půjčka #' + id + ' doplacena předčasně: ' + castka + ' L$');
  res.json({ ok: true, castka });
}));

// ─── Vlastnická struktura ────────────────────────────────────────────────────
// GET /trade/struktura/:id → kdo vlastní kus téhle firmy a kde má její majitel
// podíl jinde. Je to veřejné schválně: kdo do koho investoval, patří k obrazu
// trhu stejně jako to, kde komu stojí prádlomat. Ceny a výplaty ven nejdou —
// ty jsou věc těch dvou, co se domluvili.
router.get('/trade/struktura/:id', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id },
    select: { id: true, nick: true, company: true, disabled: true, hodnost: true } });
  if (!p || p.disabled) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni_3') });
  const jazyk = TEXTY.jazykHrace(req.player);
  const [vMe, jinde, mista] = await Promise.all([
    prisma.gameEquity.findMany({ where: { firma_id: id, stav: 'bezi' },
      orderBy: { podil: 'desc' }, take: 50 }),
    prisma.gameEquity.findMany({ where: { investor_id: id, stav: 'bezi' },
      orderBy: { podil: 'desc' }, take: 50 }),
    // Kde komu stojí prádlomat, je vidět na mapě — v rejstříku to tedy patří
    // taky. Holé pozemky (model je prázdný) do seznamu provozoven nejdou.
    prisma.gameSpotClaim.findMany({ where: { player_id: id, NOT: { model: '' } },
      select: { spot_id: true, name: true, model: true, area_key: true, lat: true, lon: true },
      orderBy: [{ area_key: 'asc' }, { spot_id: 'asc' }], take: 60 }),
  ]);
  const ids = Array.from(new Set(vMe.map((e) => e.investor_id).concat(jinde.map((e) => e.firma_id))));
  const nazvy = new Map();
  if (ids.length) {
    const lide = await prisma.gamePlayer.findMany({ where: { id: { in: ids } },
      select: { id: true, nick: true, company: true, emblem: true } });
    lide.forEach((h) => nazvy.set(h.id, { nick: h.nick, firma: h.company || (h.nick + ' s.r.o.'),
      znak: h.emblem || null }));
  }
  const kdo = (i) => nazvy.get(i) || { nick: '?', firma: stx(req)('server.neznama_firma'), znak: null };
  const prodano = vMe.reduce((a, e) => a + e.podil, 0);
  // Jedna firma může podíl kupovat na víckrát. V rejstříku patří dohromady —
  // dvakrát jedno procento je prostě dvě procenta, ne dva řádky.
  const sect = (rows, klic) => {
    const m = new Map();
    rows.forEach((e) => {
      const i = e[klic];
      const x = m.get(i) || { id: i, podil: 0, smluv: 0,
        nick: kdo(i).nick, firma: kdo(i).firma, znak: kdo(i).znak };
      x.podil += e.podil; x.smluv++;
      m.set(i, x);
    });
    return Array.from(m.values()).sort((a, b) => b.podil - a.podil);
  };
  const odz = await prisma.gameOdmena.findMany({
    where: { player_id: id, druh: 'odznak' }, select: { kod: true } }).catch(() => []);
  res.json({ ok: true,
    hrac: { id: p.id, nick: p.nick, firma: p.company || (p.nick + ' s.r.o.'),
      hodnost: p.hodnost || null, hodnost_nazev: hodnostNazev(p.hodnost, jazyk),
      odznaky: odz.map((x) => odznakPro(x.kod, jazyk)).filter(Boolean)
        .map((o) => ({ kod: o.kod, nazev: o.nazev, ikona: o.ikona, popis: o.popis,
          barva: o.barva || null })) },
    prodano,
    // Kde má provozovny. Nájem, obrat ani zisk ven nejdou — to je věc majitele.
    pradlomaty: mista.map((m) => ({ spot_id: m.spot_id, name: m.name || null,
      model: m.model, area_key: m.area_key, lat: m.lat, lon: m.lon })),
    // Kdo drží kus téhle firmy.
    podilnici: sect(vMe, 'investor_id'),
    // A kde má tenhle hráč podíl on sám.
    drzi: sect(jinde, 'firma_id') });
}));

// ─── Vyzvednutí následků ─────────────────────────────────────────────────────
// GET /trade/deliveries → co si mám připsat do rozehrané hry
router.get('/trade/deliveries', hrac, api(async (req, res) => {
  const rows = await prisma.gameDelivery.findMany({
    where: { player_id: req.player.id, claimed_at: null }, orderBy: { id: 'asc' }, take: 50,
  });
  // created_at posíláme kvůli účetní knize: doručenka mohla čekat i půl dne,
  // než si ji hráč vyzvedl, a v knize má být vidět, kdy ta provize vznikla.
  const jazyk = TEXTY.jazykHrace(req.player);
  // nick → název firmy, ať hlášky ukazují firmy
  const jmena = {};
  (await prisma.gamePlayer.findMany({ select: { nick: true, company: true } }))
    .forEach((h) => { if (h.nick && h.company) jmena[h.nick.toLowerCase()] = h.company; });
  res.json({ ok: true, deliveries: rows.map((d) => ({ id: d.id, kind: d.kind, model: d.model,
    amount: d.amount, spot_id: d.spot_id, data: d.data || null,
    // Věta se skládá až tady, v jazyce toho, kdo ji čte. Starší řádky mají
    // jen hotový český popis — ty se nechávají být.
    popis: textDorucenky(d, jazyk, jmena),
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
  if (!a || a.koupil_id) return res.status(409).json({ error: stx(req)('server.tohle_uz_nekdo_koupil') });
  if (new Date(a.do).getTime() < Date.now()) return res.status(409).json({ error: stx(req)('server.rozprodej_uz_skoncil') });
  if (a.player_id === req.player.id) return res.status(400).json({ error: stx(req)('server.vlastni_majetek_si_zpatky_nekoupis') });
  const cena = aukceCena(a);

  try {
  await prisma.$transaction(async (tx) => {
    const zabrano = await tx.gameAuction.updateMany({
      where: { id: a.id, koupil_id: null },
      data: { koupil_id: req.player.id, koupil_za: cena, koupeno_at: new Date() },
    });
    SOUBEH.zamkni(zabrano, 'server.tohle_uz_nekdo_koupil');

    const dorucenky = [
      { player_id: req.player.id, kind: 'cash', amount: -cena, popis: 'Koupil jsi z konkurzu: ' + a.popis,
        text_kod: 'dor.koupil_z_konkurzu', text_data: { p1: a.popis } },
    ];
    // Z majetku po ukončené hře se prodávajícímu nic nevyplácí. Kdyby ano,
    // vyplatilo by se resetovat se dokola a liquidaci inkasovat.
    if (!(a.data && a.data.bez_vyplaty)) {
      dorucenky.push({ player_id: a.player_id, kind: 'cash', amount: cena,
        popis: 'Z konkurzu se prodalo: ' + a.popis,
        text_kod: 'dor.prodalo_z_konkurzu', text_data: { p1: a.popis } });
    }
    if (a.predmet === 'stroj') {
      dorucenky.push({ player_id: req.player.id, kind: 'stock', model: a.model, amount: 1, popis: 'Z konkurzu: ' + a.popis });
    } else if (a.predmet === 'pobocka') {
      dorucenky.push({ player_id: req.player.id, kind: 'pobocka_add', spot_id: a.spot_id, popis: 'Z konkurzu: ' + a.popis });
    } else if (a.predmet === 'pradlomat') {
      // Místo po zkrachovalém je volné — kupující ho musí zabrat jako každé jiné,
      // ale stroj dostane na sklad.
      dorucenky.push({ player_id: req.player.id, kind: 'stock', model: a.model || 'mini', amount: 1,
        popis: 'Z konkurzu stroj z místa ' + a.popis , text_kod: 'dor.z_konkurzu_stroj_z_mista', text_data: { p1: a.popis }});
    }
    await tx.gameDelivery.createMany({ data: dorucenky });
  });
  } catch (e) { if (SOUBEH.odpoved(e, res, stx(req))) return; throw e; }

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
  if (!spot) return res.status(400).json({ error: stx(req)('server.ktere_misto') });
  if (!(cena >= 1000) || cena > MAX_CENA) return res.status(400).json({ error: stx(req)('server.cena_musi_byt_aspon_1_000') });
  const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
  if (!c || c.player_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.tohle_misto_ti_nepatri') });
  if (!c.model) return res.status(400).json({ error: stx(req)('server.na_tomhle_miste_zadny_pradlomat_nestoji') });
  if (c.najemce_id) return res.status(409).json({ error: stx(req)('server.pozemek_mas_pronajaty_jinemu_hraci') });
  const bezi = await prisma.gameMarket.findFirst({
    where: { spot_id: spot, koupil_id: null, zruseno_at: null, do: { gt: new Date() } } });
  if (bezi) return res.status(409).json({ error: stx(req)('server.tohle_misto_uz_na_trzisti_je') });
  const kolik = await prisma.gameMarket.count({
    where: { player_id: req.player.id, koupil_id: null, zruseno_at: null, do: { gt: new Date() } } });
  if (kolik >= TRH_MAX_NABIDEK) return res.status(429).json({ error: stx(req)('server.vic_nabidek_naraz', { p1: TRH_MAX_NABIDEK }) });

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
  if (!m || m.player_id !== req.player.id) return res.status(404).json({ error: stx(req)('server.takova_nabidka_tu_neni') });
  if (m.koupil_id) return res.status(409).json({ error: stx(req)('server.tohle_uz_nekdo_koupil_2') });
  await prisma.gameMarket.update({ where: { id }, data: { zruseno_at: new Date() } });
  res.json({ ok: true });
}));

// POST /trade/trh/:id/koupit → kupující platí, místo i stroj mění majitele
router.post('/trade/trh/:id/koupit', hrac, api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const m = await prisma.gameMarket.findUnique({ where: { id } });
  if (!m || m.zruseno_at) return res.status(404).json({ error: stx(req)('server.takova_nabidka_tu_neni_2') });
  if (m.koupil_id) return res.status(409).json({ error: stx(req)('server.tohle_uz_nekdo_koupil_3') });
  if (new Date(m.do).getTime() < Date.now()) return res.status(409).json({ error: stx(req)('server.nabidka_uz_vyprsela') });
  if (m.player_id === req.player.id) return res.status(400).json({ error: stx(req)('server.vlastni_nabidku_si_nekoupis') });
  // Mezitím mohl prodávající místo prodat jinak nebo o něj přijít.
  const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: m.spot_id } });
  if (!c || c.player_id !== m.player_id || !c.model) {
    await prisma.gameMarket.update({ where: { id }, data: { zruseno_at: new Date() } });
    return res.status(409).json({ error: stx(req)('server.pradlomat_uz_prodavajicimu_nepatri_nabidku_jsme') });
  }

  try {
  await prisma.$transaction(async (tx) => {
    const zabrano = await tx.gameMarket.updateMany({
      where: { id: m.id, koupil_id: null, zruseno_at: null },
      data: { koupil_id: req.player.id, koupil_nick: req.player.nick, koupeno_at: new Date() },
    });
    SOUBEH.zamkni(zabrano, 'server.tohle_uz_nekdo_koupil');
    await tx.gameSpotClaim.update({ where: { spot_id: m.spot_id },
      data: { player_id: req.player.id, nick: req.player.nick } });
    const popis = 'prádlomat ' + (m.name || m.spot_id) + ' z tržiště';
    await tx.gameDelivery.createMany({ data: [
      { player_id: m.player_id, kind: 'unit_remove', spot_id: m.spot_id,
        popis: 'Prodal jsi ' + popis + ' hráči ' + req.player.nick , text_kod: 'dor.prodal_jsi_hraci', text_data: { p1: popis, p2: req.player.nick }},
      { player_id: req.player.id, kind: 'unit_add', spot_id: m.spot_id, model: m.model,
        data: { name: m.name, lat: m.lat, lon: m.lon, rent: m.rent, area_key: m.area_key,
          kind: m.kind, score: m.score, invest: m.cena, plan: m.plan || null },
        popis: 'Koupil jsi ' + popis },
      { player_id: req.player.id, kind: 'cash', amount: -m.cena, popis: 'Zaplatil jsi za ' + popis },
      { player_id: m.player_id, kind: 'cash', amount: m.cena, popis: 'Utržil jsi za ' + popis , text_kod: 'dor.utrzil_jsi_za', text_data: { p1: popis }},
    ] });
  });
  } catch (e) { if (SOUBEH.odpoved(e, res, stx(req))) return; throw e; }

  console.log('[game] tržiště prodej: ' + m.nick + ' → ' + req.player.nick + ' · ' + (m.name || m.spot_id) + ' za ' + m.cena + ' L$');
  res.json({ ok: true, cena: m.cena });
}));

module.exports = router;

// ─── Dražby na tržišti ───────────────────────────────────────────────────────
// Obrácená aukce: příhozy cenu snižují, ne zvyšují. Pravidla a výpočty jsou
// v services/game/drazby.js, tady je jen obsluha a peníze.
//
// Převod vydražené věci je schválně napsaný zvlášť a ne vytažený z přijetí
// nabídky výš: ta cesta je funkční a bez testů, a rozebírat ji kvůli dražbám
// by znamenalo sáhnout do peněz, které chodí. Když se tady něco změní, musí
// se to změnit i v /trade/:id/accept.
const DRZ = require('../services/game/drazby');

// Kolik hráč v téhle dražbě už přihodil — nemůže slíbit víc, než má.
async function mojePrihozy(drazbaId, playerId) {
  const r = await prisma.gameDrazbaPrihoz.aggregate({
    where: { drazba_id: drazbaId, player_id: playerId }, _sum: { castka: true } });
  return (r._sum && r._sum.castka) || 0;
}

// GET /trade/drazba → co se zrovna draží (a chvíli po konci i výsledek)
router.get('/trade/drazba', hrac, api(async (req, res) => {
  let d = await DRZ.bezici();
  if (d && new Date(d.konec).getTime() <= Date.now()) d = await vyporadejDrazbu(d.id);
  if (!d) {
    // Posledních pár vteřin po konci ukážeme výsledek, ať hráč vidí, jak dopadl.
    d = await prisma.gameDrazba.findFirst({
      where: { stav: 'hotovo', updated_at: { gte: new Date(Date.now() - 25000) } },
      orderBy: { id: 'desc' } });
  }
  if (!d) return res.json({ ok: true, drazba: null, predvolby: DRZ.PREDVOLBY, min: DRZ.PRIHOZ_MIN });
  // Kdo má okno dražby opravdu před sebou, přidá ?vidim=1. Schovaná záložka
  // se ptá dál (aby o dražbě věděla), ale do počtu diváků nepatří.
  if (d.stav === 'bezi' && String((req.query || {}).vidim) === '1') DRZ.divak(d.id, req.player.id);
  const v = DRZ.verejna(d, req.player.id);
  const [mp, posledni, prihazujici] = await Promise.all([
    mojePrihozy(d.id, req.player.id),
    prisma.gameDrazbaPrihoz.findMany({ where: { drazba_id: d.id }, orderBy: { id: 'desc' }, take: 6,
      select: { nick: true, castka: true } }),
    prisma.gameDrazbaPrihoz.findMany({ where: { drazba_id: d.id },
      select: { player_id: true }, distinct: ['player_id'] }),
  ]);
  v.moje_prihozy = mp;
  v.divaku = DRZ.divaku(d.id);
  v.prihazujicich = prihazujici.length;
  // Minimum i předvolby se odvíjejí od posledního příhozu — přihodit se musí
  // aspoň tolik, co dal on.
  const minimum = DRZ.minPrihoz(posledni.length ? posledni[0].castka : 0);
  v.minimum = minimum;
  res.json({ ok: true, drazba: v, prihozy: posledni,
    predvolby: DRZ.predvolby(minimum), min: minimum });
}));

// POST /trade/drazba { predmet, model, spot_id, card_kind, pobocka, podil, equity_id, vyvolavaci }
router.post('/trade/drazba', hrac, api(async (req, res) => {
  const b = req.body || {};
  const predmet = s(b.predmet, 12);
  if (!DRZ.PREDMETY.includes(predmet)) return res.status(400).json({ error: stx(req)('server.tohle_vydrazit_nejde') });
  const vyvolavaci = Math.min(MAX_CENA, Math.max(0, Math.round(Number(b.vyvolavaci) || 0)));
  if (vyvolavaci < DRZ.VYVOLAVACI_MIN) {
    return res.status(400).json({ error: stx(req)('server.nejnizsi_vyvolavaci_cena_je')
      + DRZ.VYVOLAVACI_MIN.toLocaleString('cs-CZ') + ' L$.' });
  }
  // Jedna dražba ve světě naráz. Jinak by z události byly tři vyskakující okna.
  const uz = await DRZ.bezici();
  if (uz && new Date(uz.konec).getTime() > Date.now()) {
    return res.status(409).json({ error: stx(req)('server.zrovna_bezi_jina_drazba_zkus_to') });
  }
  if (uz) await vyporadejDrazbu(uz.id);

  const ja = req.player;
  const st = stavu(ja);
  // Vedle českého názvu se posílá i kód a proměnná část — název dražby vidí
  // všichni hráči naráz a každý ve svém jazyce. Jde to do sloupce data, který
  // je JSON a klient ho dostává celý, takže kvůli tomu nemusí nic přibýt.
  let nazev = '', data = null, model = null, spotId = null, cardKind = null, nazevKod = null;
  if (predmet === 'stroj') {
    model = s(b.model, 10);
    if (!MODELY.includes(model)) return res.status(400).json({ error: stx(req)('server.takovy_model_neznam') });
    if (skladu(st)[model] < 1) return res.status(409).json({ error: stx(req)('server.ten_stroj_nemas_skladem') });
    nazev = 'prádlomat ' + model.toUpperCase() + ' (stroj ze skladu)';
    nazevKod = { kod: 'drazba.nazev_stroj', cast: model.toUpperCase() };
  } else if (predmet === 'pradlomat') {
    spotId = s(b.spot_id, 120);
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spotId } });
    if (!c || c.player_id !== ja.id || !c.model) return res.status(409).json({ error: stx(req)('server.ten_pradlomat_ti_nepatri') });
    nazev = 'prádlomat ' + (c.name || spotId);
    nazevKod = { kod: 'drazba.nazev_pradlomat', cast: (c.name || spotId) };
  } else if (predmet === 'pobocka') {
    spotId = s(b.pobocka, 120);
    const pob = Array.isArray(st.pobocky) ? st.pobocky : [];
    if (!pob.some((x) => x && x.name === spotId)) return res.status(409).json({ error: stx(req)('server.takovou_pobocku_nemas') });
    nazev = 'pobočka ' + spotId;
    nazevKod = { kod: 'drazba.nazev_pobocka', cast: spotId };
  } else if (predmet === 'karta') {
    cardKind = s(b.card_kind, 24);
    const k = await prisma.gameCard.count({ where: { player_id: ja.id, kind: cardKind, used_at: null } });
    if (!k) return res.status(409).json({ error: stx(req)('server.tu_kartu_nemas') });
    // V dražbě musí být poznat, o co se hraje — „karta connect" nikomu nic neřekne.
    const kat = (acct._cards || {})[cardKind];
    nazev = 'karta ' + ((kat && kat.name) || cardKind);
  } else if (predmet === 'podil') {
    const podil = Math.max(PODIL_MIN, Math.min(PODIL_MAX, Number(b.podil) || 0));
    const prodano = await prodanyPodil(ja.id);
    if (prodano + podil > PODIL_MAX + 1e-9) {
      return res.status(409).json({ error: stx(req)('server.z_firmy_prodano_sto', { p1: Math.round(prodano * 100) }) });
    }
    data = { podil };
    nazev = 'podíl ' + pct(podil) + ' % ve firmě ' + (ja.company || ja.nick);
    nazevKod = { kod: 'drazba.nazev_podil', cast: (ja.company || ja.nick), pct: pct(podil) };
  } else if (predmet === 'prevod') {
    const e = await prisma.gameEquity.findUnique({ where: { id: parseInt(b.equity_id, 10) || 0 } });
    if (!e || e.stav !== 'bezi' || e.investor_id !== ja.id) {
      return res.status(409).json({ error: stx(req)('server.takovy_podil_nedrzis') });
    }
    // Držený podíl jde rozdražit po kouscích — kdo má pět procent, může
    // pustit jedno. Když klient nic nepošle, jde do dražby celý.
    let podil = b.podil == null ? e.podil : Math.round(Number(b.podil) * 1000) / 1000;
    if (!(podil > 0)) return res.status(400).json({ error: stx(req)('server.kolik_procent_chces_vydrazit') });
    if (podil > e.podil + 1e-9) {
      return res.status(409).json({ error: stx(req)('server.drzis_jen') + pct(e.podil) + ' %.' });
    }
    // Zbytek pod desetinou procenta nemá cenu držet — vezme se to celé.
    if (e.podil - podil < 0.001) podil = e.podil;
    data = { equity_id: e.id, podil, firma_id: e.firma_id, firma_nick: e.firma_nick };
    nazev = 'podíl ' + pct(podil) + ' % ve firmě ' + e.firma_nick;
    nazevKod = { kod: 'drazba.nazev_podil', cast: e.firma_nick, pct: pct(podil) };
  }

  const d = await prisma.gameDrazba.create({ data: {
    prodavajici_id: ja.id, prodavajici_nick: ja.nick,
    predmet, model, spot_id: spotId, card_kind: cardKind,
    data: nazevKod ? Object.assign({}, data || {}, { nazev_kod: nazevKod }) : data,
    nazev: nazev.slice(0, 160), vyvolavaci,
    konec: new Date(Date.now() + DRZ.DRAZBA_MS),
  } });
  console.log('[game-drazba] #' + d.id + ' ' + ja.nick + ' vyvolává ' + nazev + ' za ' + vyvolavaci);
  res.json({ ok: true, drazba: DRZ.verejna(d, ja.id) });
}));

// POST /trade/drazba/prihoz { castka }
router.post('/trade/drazba/prihoz', hrac, api(async (req, res) => {
  const castka = Math.max(0, Math.round(Number((req.body || {}).castka) || 0));
  if (castka < DRZ.PRIHOZ_MIN) {
    return res.status(400).json({ error: stx(req)('server.nejmensi_prihoz_je')
      + DRZ.PRIHOZ_MIN.toLocaleString('cs-CZ') + ' L$.' });
  }
  const d = await DRZ.bezici();
  if (!d) return res.status(409).json({ error: stx(req)('server.zadna_drazba_nebezi') });
  if (new Date(d.konec).getTime() <= Date.now()) {
    await vyporadejDrazbu(d.id);
    return res.status(409).json({ error: stx(req)('server.drazba_uz_skoncila') });
  }
  // Přihazuje se nahoru: aspoň tolik, kolik dal poslední. Dvě současná
  // přihození si tím můžou vzájemně podrazit minimum — to ale stejně odchytí
  // zámek na konci dražby o kus níž a jeden z nich dostane „někdo byl rychlejší".
  const posl = await prisma.gameDrazbaPrihoz.findFirst({
    where: { drazba_id: d.id }, orderBy: { id: 'desc' }, select: { castka: true } });
  const minimum = DRZ.minPrihoz(posl ? posl.castka : 0);
  if (castka < minimum) {
    return res.status(400).json({ error: stx(req)('server.prihodit_aspon_posledni', { penize: minimum }) });
  }
  const ja = req.player;
  const jsemProdavajici = d.prodavajici_id === ja.id;
  // Prodávající smí přihazovat na svou věc: sráží tím cenu a přidává čas,
  // takže může dražbu natahovat a nalákat další. Platí to ale ze svého —
  // příhozy mu sice spadnou zpátky, ale vítězův doplatek o ně klesne, takže
  // ho to vyjde přesně na to, co do toho vloží.
  if (jsemProdavajici) {
    // Žádný strop: prodávající smí přihazovat pořád, i nad vyvolávací cenou,
    // aby dražbu udržel naživu jak dlouho chce. Platí to ze svého jako každý
    // jiný. Nad vyvolávací cenou tím ale zvedá doplatek vedoucímu, který se
    // bránit nemůže — tak je ta hra postavená a je to vědomé rozhodnutí.
  } else if (d.vedouci_id === ja.id) {
    // Vedoucí sám proti sobě nepřihazuje — jen by pálil peníze a natahoval čas.
    return res.status(409).json({ error: stx(req)('server.vedes_pockej_az_nekdo_prihodi') });
  }
  // Na příhozy musí mít. Počítá se z poslední uložené hry, co už v téhle dražbě
  // slíbil a co má rozjednané na burze — stejně jako u nabídek.
  const mam = Math.round(stavu(ja).cash || 0);
  const uz = await mojePrihozy(d.id, ja.id);
  const vazane = await vazanaHotovost(ja.id, null);
  if (mam - uz - vazane < castka) {
    return res.status(409).json({ error: stx(req)('server.na_tenhle_prihoz_nemas_volnou_hotovost')
      + Math.max(0, mam - uz - vazane).toLocaleString('cs-CZ') + ' L$.' });
  }
  // Prodloužení i součet v jedné aktualizaci: dva příhozy ve stejnou chvíli si
  // tak nepřepíšou čas konce.
  const novyKonec = new Date(new Date(d.konec).getTime() + DRZ.PRIHOZ_MS);
  const r = await prisma.gameDrazba.updateMany({
    where: { id: d.id, stav: 'bezi', konec: d.konec },
    data: Object.assign({ suma: { increment: castka }, prihozu: { increment: 1 },
      konec: novyKonec },
      // Prodávající se svým příhozem nikdy nestává vedoucím — vlastní věc
      // vyhrát nemůže. Vede dál poslední skutečný zájemce.
      jsemProdavajici ? {} : { vedouci_id: ja.id, vedouci_nick: ja.nick }),
  });
  if (!r.count) return res.status(409).json({ error: stx(req)('server.nekdo_byl_rychlejsi_zkus_to_znovu') });
  await prisma.gameDrazbaPrihoz.create({ data: { drazba_id: d.id, player_id: ja.id,
    nick: ja.nick, castka } });
  const cer = await prisma.gameDrazba.findUnique({ where: { id: d.id } });
  const ven = DRZ.verejna(cer, ja.id);
  // Po vlastním příhozu se minimum zvedlo na něj — klient si hned přepíše tlačítka.
  ven.minimum = DRZ.minPrihoz(castka);
  res.json({ ok: true, drazba: ven, moje_prihozy: uz + castka,
    predvolby: DRZ.predvolby(castka), min: DRZ.minPrihoz(castka) });
}));

// Vypořádání: peníze a převod věci. Vrací null, protože po vypořádání už
// žádná dražba neběží.
async function vyporadejDrazbu(id) {
  const d = await prisma.gameDrazba.findUnique({ where: { id } });
  if (!d || d.stav !== 'bezi') return null;
  // Zamknout dražbu dřív, než se začnou hýbat peníze — jinak by ji dvě
  // současná dotázání vypořádala dvakrát.
  const zamek = await prisma.gameDrazba.updateMany({
    where: { id, stav: 'bezi' }, data: { stav: 'hotovo' } });
  if (!zamek.count) return null;

  const cena = DRZ.cenaZa(d.vyvolavaci, d.suma);
  const prihozy = await prisma.gameDrazbaPrihoz.groupBy({
    by: ['player_id', 'nick'], where: { drazba_id: id }, _sum: { castka: true } });
  const vitez = d.vedouci_id
    ? await prisma.gamePlayer.findUnique({ where: { id: d.vedouci_id } })
    : null;
  const prodavajici = await prisma.gamePlayer.findUnique({ where: { id: d.prodavajici_id } });

  try {
    await prisma.$transaction(async (tx) => {
      // 1. příhozy: každému přihazujícímu se strhne, co v dražbě utratil
      for (const p of prihozy) {
        const c = (p._sum && p._sum.castka) || 0;
        if (c <= 0) continue;
        await tx.gameDelivery.create({ data: { player_id: p.player_id, kind: 'cash', amount: -c,
          popis: 'Příhozy v dražbě: ' + d.nazev , text_kod: 'dor.prihozy_v_drazbe', text_data: { p1: d.nazev }} });
      }
      // 2. prodávající dostane příhozy i doplatek
      if (d.suma + (vitez ? cena : 0) > 0) {
        await tx.gameDelivery.create({ data: { player_id: d.prodavajici_id, kind: 'cash',
          amount: d.suma + (vitez ? cena : 0),
          popis: vitez ? ('Vydražil jsi ' + d.nazev) : ('Dražba bez vítěze: ' + d.nazev) } });
      }
      // 3. vítěz doplatí a dostane věc. Bez příhozu se nic nepřevádí a
      //    prodávajícímu věc zůstává.
      if (vitez) {
        if (cena > 0) {
          await tx.gameDelivery.create({ data: { player_id: vitez.id, kind: 'cash', amount: -cena,
            popis: 'Doplatek za vydražené: ' + d.nazev , text_kod: 'dor.doplatek_za_vydrazene', text_data: { p1: d.nazev }} });
        }
        await prevedVydrazene(tx, d, prodavajici, vitez);
      }
      await tx.gameDrazba.update({ where: { id }, data: {
        vitez_id: vitez ? vitez.id : null, vitez_nick: vitez ? vitez.nick : null,
        cena: vitez ? cena : null } });
    });
  } catch (e) {
    console.error('[game-drazba] vypořádání #' + id + ' selhalo:', e && e.message);
    await prisma.gameDrazba.update({ where: { id }, data: { stav: 'neplatna' } }).catch(() => {});
    return null;
  }
  console.log('[game-drazba] #' + id + ' hotovo · ' + d.nazev
    + (vitez ? (' → ' + vitez.nick + ' za ' + cena + ' L$ (příhozy ' + d.suma + ')') : ' → nikdo nepřihodil'));
  return null;
}

// Převod vydražené věci. Dvojče k tomu, co dělá /trade/:id/accept — když se
// změní jedno, musí se i druhé.
async function prevedVydrazene(tx, d, prodavajici, vitez) {
  const popis = d.nazev;
  if (d.predmet === 'karta') {
    const c = await tx.gameCard.findFirst({ where: { player_id: prodavajici.id,
      kind: d.card_kind, used_at: null }, orderBy: { id: 'asc' } });
    // Dražbu vyhodnocuje úloha na pozadí, ne požadavek hráče — hláška se proto
    // skládá v jazyce prodávajícího, ne přes stx(req), který tu nemá odkud vzít req.
    if (!c) throw new Error(TEXTY.tHraci(prodavajici, 'server.karta_se_ztratila_2'));
    await tx.gameCard.update({ where: { id: c.id }, data: { player_id: vitez.id } });
  } else if (d.predmet === 'stroj') {
    await tx.gameDelivery.createMany({ data: [
      { player_id: prodavajici.id, kind: 'stock', model: d.model, amount: -1, popis: 'Vydražil se tvůj ' + popis , text_kod: 'dor.vydrazil_se_tvuj', text_data: { p1: popis }},
      { player_id: vitez.id, kind: 'stock', model: d.model, amount: 1, popis: 'Vydražil jsi ' + popis , text_kod: 'dor.vydrazil_jsi', text_data: { p1: popis }},
    ] });
  } else if (d.predmet === 'pradlomat') {
    const c = await tx.gameSpotClaim.update({ where: { spot_id: d.spot_id },
      data: { player_id: vitez.id, nick: vitez.nick } });
    await tx.gameDelivery.createMany({ data: [
      { player_id: prodavajici.id, kind: 'unit_remove', spot_id: d.spot_id, popis: 'Vydražil se tvůj ' + popis , text_kod: 'dor.vydrazil_se_tvuj', text_data: { p1: popis }},
      { player_id: vitez.id, kind: 'unit_add', spot_id: d.spot_id, model: c.model,
        data: { name: c.name, lat: c.lat, lon: c.lon, rent: c.rent, area_key: c.area_key },
        popis: 'Vydražil jsi ' + popis , text_kod: 'dor.vydrazil_jsi', text_data: { p1: popis }},
    ] });
  } else if (d.predmet === 'pobocka') {
    await tx.gameDelivery.createMany({ data: [
      { player_id: prodavajici.id, kind: 'pobocka_remove', spot_id: d.spot_id, popis: 'Vydražila se tvá ' + popis , text_kod: 'dor.vydrazila_se_tva', text_data: { p1: popis }},
      { player_id: vitez.id, kind: 'pobocka_add', spot_id: d.spot_id, popis: 'Vydražil jsi ' + popis , text_kod: 'dor.vydrazil_jsi', text_data: { p1: popis }},
    ] });
  } else if (d.predmet === 'podil') {
    const podil = Number((d.data || {}).podil) || 0;
    await tx.gameEquity.create({ data: {
      investor_id: vitez.id, investor_nick: vitez.nick,
      firma_id: prodavajici.id, firma_nick: prodavajici.nick,
      podil, cena: DRZ.cenaZa(d.vyvolavaci, d.suma), dalsi_at: new Date(Date.now() + MESIC_MS),
    } });
  } else if (d.predmet === 'prevod') {
    const eq = await tx.gameEquity.findUnique({ where: { id: (d.data || {}).equity_id || 0 } });
    if (!eq || eq.stav !== 'bezi' || eq.investor_id !== prodavajici.id) {
      throw new Error(TEXTY.tHraci(prodavajici, 'server.podil_uz_takhle_nebezi'));
    }
    // Do dražby mohl jít jen kus. Kolik, se ověřuje až tady — mezitím mohl
    // prodávající část podílu prodat jinudy a slíbit víc, než drží.
    let podil = Number((d.data || {}).podil);
    if (!(podil > 0) || podil > eq.podil + 1e-9) podil = eq.podil;
    const zbytek = eq.podil - podil;
    const cely = zbytek < 1e-9;
    const cena = DRZ.cenaZa(d.vyvolavaci, d.suma);
    // Co zůstává prodávajícímu: pořizovací cena i vyplacené dividendy se
    // krátí ve stejném poměru, jinak by zbytek v knize vypadal dráž, než je.
    const dil = (v) => Math.round((Number(v) || 0) * (zbytek / eq.podil));
    if (eq.firma_id === vitez.id) {
      // Vydražil si vlastní podíl zpátky — to je odkup.
      if (cely) await tx.gameEquity.update({ where: { id: eq.id }, data: { stav: 'odkoupeno' } });
      else {
        await tx.gameEquity.update({ where: { id: eq.id },
          data: { podil: zbytek, cena: dil(eq.cena), vyplaceno: dil(eq.vyplaceno) } });
      }
    } else if (cely) {
      await tx.gameEquity.update({ where: { id: eq.id }, data: {
        investor_id: vitez.id, investor_nick: vitez.nick, cena, vyplaceno: 0 } });
    } else {
      // Prodaný kus se odštípne do vlastního záznamu. Součty obou stran dělá
      // podilInvestora() přes řádky, takže na většinu to sedí dál.
      await tx.gameEquity.update({ where: { id: eq.id },
        data: { podil: zbytek, cena: dil(eq.cena), vyplaceno: dil(eq.vyplaceno) } });
      await tx.gameEquity.create({ data: {
        investor_id: vitez.id, investor_nick: vitez.nick,
        firma_id: eq.firma_id, firma_nick: eq.firma_nick,
        // Výplatní termín si bere z původního záznamu: vítěz nemá dostat
        // dividendu navíc, ani o rozjetý měsíc přijít.
        podil, cena, dalsi_at: eq.dalsi_at } });
    }
  }
}
module.exports._vyporadejDrazbu = vyporadejDrazbu;
