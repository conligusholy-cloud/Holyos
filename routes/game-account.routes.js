// =============================================================================
// Laundromat Tycoon — účty hráčů, karty a nákupy
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
const { HODNOSTI, hodnost, zmrazena, ODZNAKY, ODZNAK,
  hodnostiPro, odznakyPro, nazevOdmeny } = require('../services/game/hodnosti');
const TEXTY = require('../services/game/texty');
const MENY = require('../services/game/meny');
const POZEMKY = require('../services/game/pozemky');
const JMENI = require('../services/game/jmeni');
// Zkratka do obsluhy: stx(req)('server.neco') vrátí hlášku v jazyce hráče.
// Skládá se pro toho, KOMU se posílá — ne pro toho, kdo akci vyvolal.
function stx(req) {
  const j = TEXTY.jazykHrace(req && req.player);
  return (klic, udaje) => TEXTY.t(klic, udaje, j);
}
const JWT_SECRET = require('../config/secrets').jwtSecret();

const router = express.Router();
router.use(express.json({ limit: '4mb' })); // stav hry roste s počtem prádlomatů (136 ≈ 470 kB)

const COOKIE = 'lm_game';
const TOKEN_DAYS = 180;
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const NICK_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const FIRMA_RE = /^[\p{L}\p{N} .,&'"()+-]{2,60}$/u;
const firmaNebo = (f, nick) => (f && FIRMA_RE.test(f) ? f : nick + ' s.r.o.');
// Odkud účet vznikl. Id prohlížeče si klient nese sám (stejné, jaké posílá do
// pozvánek), IP a prohlížeč bereme z požadavku. Nic z toho se hráči nikde
// neukazuje — slouží jen k poznání účtů, které si jeden člověk zakládá sám.
const PID_RE = /^[a-z0-9]{6,24}$/;
function puvod(req) {
  const pid = String((req.body || {}).ref || '').toLowerCase();
  return {
    dev_pid: PID_RE.test(pid) ? pid : null,
    reg_ip: ipOf(req) || null,
    reg_ua: String(req.headers['user-agent'] || '').slice(0, 500) || null,
  };
}
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
    kind: 'rush', icon: 'truck', price: 4900 },
  traffic: {
    // Trvalá kampaň. Z prodeje je pryč — vedle týdenních balíčků by ji nikdo
    // nekoupil a prodala by se stejně jen jednou za hru. Kdo ji má, efekt mu
    // zůstává napořád a může ji kdykoli použít; nenabízí se jen k nákupu.
    kind: 'traffic', icon: 'megaphone', price: 9900, bezBalicku: true, skryty: true },
  connect: {
    kind: 'connect', icon: 'wrench', price: 7900 },
  credit: {
    kind: 'credit', icon: 'bank', price: 12900 }
};
const CARD_KINDS = Object.keys(CARDS);

// ─── Balíčky karet ───────────────────────────────────────────────────────────
// Víc kusů jedné karty najednou za nižší cenu za kus. Sleva je v procentech,
// cena za kus se zaokrouhlí na celé koruny — ať v nabídce nesvítí haléře a
// násobek sedí přesně na to, co se účtuje ve Stripu (ten násobí cenu za kus).
const BALICKY = [{ qty: 3, sleva: 0.12 }, { qty: 5, sleva: 0.27 }, { qty: 10, sleva: 0.41 }];
function cenaKusuVBalicku(price, qty) {
  const b = BALICKY.filter((x) => x.qty === qty)[0];
  if (!b || !(price > 0)) return price;
  return Math.max(100, Math.round(price * (1 - b.sleva) / 100) * 100);
}
// Nabídka balíčků k jedné kartě, rovnou s úsporou — klient už nic nepočítá.
function balickyProKartu(c, prev) {
  if (!c || c.bezBalicku) return [];
  return BALICKY.map((b) => {
    const kus = cenaKusuVBalicku(c.price, b.qty);
    const celkem = kus * b.qty, plna = c.price * b.qty;
    return { qty: b.qty, price_czk: prev.zobraz(celkem), plna_czk: prev.zobraz(plna),
      sleva: Math.max(0, Math.round((1 - celkem / plna) * 100)) };
  }).filter((b) => b.sleva > 0);
}

// ─── Balíčky herních peněz ───────────────────────────────────────────────────
// Ceny v haléřích, laundry na ruku. Čím větší balík, tím víc za korunu —
// u stovky je to 1 000 L$/Kč, u dvoutisícovky 2 300 L$/Kč.
const CASH = {
  cash100:  { kind: 'cash100',  price: 10000,  laundry: 100000 },
  cash200:  { kind: 'cash200',  price: 20000,  laundry: 300000 },
  cash500:  { kind: 'cash500',  price: 50000,  laundry: 900000 },
  cash1000: { kind: 'cash1000', price: 100000, laundry: 2000000 },
  cash2000: { kind: 'cash2000', price: 200000, laundry: 4600000 },
  // Dárek za sledování na Facebooku. V nabídce není a koupit se nedá — jen se
  // vydá jednou za účet. Jede ale po stejné koleji jako koupené balíčky, takže
  // ho chrání i pojistka, co hlídá, aby složená zástava nezmizela.
  cash_fb:  { kind: 'cash_fb',  price: 0, laundry: 1000000, skryty: true },
};
const CASH_KINDS = Object.keys(CASH);

// ─── Balíčky rámcového úvěru ─────────────────────────────────────────────────
// Rámec je úvěrová linka proti zástavě — a jak velký objem si z ní hráč může
// vzít, odemykají tyhle balíčky. Nejsou spotřební: koupí se jednou a platí
// napořád. Kdo má nižší stupeň a chce vyšší, doplácí jen rozdíl (viz checkout).
// strop null = bez stropu, limit pak drží jen herní pravidla.
const RAMEC_ZDARMA = 5000000;        // kolik unese rámec bez jediného balíčku
const RAMEC = {
  ramec10:  { kind: 'ramec10',  price: 50000,  strop: 10000000, uroven: 1, bezBalicku: true },
  ramec20:  { kind: 'ramec20',  price: 100000, strop: 20000000, uroven: 2, bezBalicku: true },
  ramec40:  { kind: 'ramec40',  price: 200000, strop: 40000000, uroven: 3, bezBalicku: true },
  ramec70:  { kind: 'ramec70',  price: 300000, strop: 70000000, uroven: 4, bezBalicku: true },
  ramecmax: { kind: 'ramecmax', price: 500000, strop: null,     uroven: 5, bezBalicku: true },
};
const RAMEC_KINDS = Object.keys(RAMEC);

// ─── Balíčky infolinky ───────────────────────────────────────────────────────
// Kredit = jeden hovor, který vyřídí placený operátor místo hráče. Čím větší
// balíček, tím nižší cena za hovor.
// Infolinka se platí na čas, ne na kusy: dokud balíček běží, bere operátor
// všechny hovory a telefon hráči vůbec nezvoní. Staré balíčky po hovorech
// zůstávají v seznamu kvůli tomu, co si lidi koupili a ještě nevyzvedli —
// prodávat se už nedají (active: false v ceníku je schová úplně) a při
// vyzvednutí dají týden, ať na tom nikdo netratí.
const LINKA_DEN = 86400000;
const LINKA = {
  linka1d: { kind: 'linka1d', price: 4900, dnu: 1 },
  linka3d: { kind: 'linka3d', price: 7400, dnu: 3 },
  linka7d: { kind: 'linka7d', price: 9900, dnu: 7 },
  linka30d: { kind: 'linka30d', price: 29000, dnu: 30 },
  linka365d: { kind: 'linka365d', price: 99900, dnu: 365 },
  // Doběh starých kreditových balíčků. Nenabízejí se, jen se dají vyzvednout.
  linka50:  { kind: 'linka50',  price: 9900,  dnu: 7, stary: true },
  linka100: { kind: 'linka100', price: 17900, dnu: 7, stary: true },
  linka200: { kind: 'linka200', price: 29900, dnu: 7, stary: true },
  linka300: { kind: 'linka300', price: 39900, dnu: 7, stary: true },
  linka400: { kind: 'linka400', price: 49900, dnu: 7, stary: true },
  linka500: { kind: 'linka500', price: 59900, dnu: 7, stary: true }
};
const LINKA_KINDS = Object.keys(LINKA);

// ─── Reklamní kampaň ──────────────────────────────────────────────────
// Dřív to byla jedna karta za 99 Kč, která zvedla návštěvnost natrvalo.
// Natrvalo znamená, že se prodá jednou za hru — teď jedou kampaně na týden
// ve třech silách. Kdo tu starou kartu koupil, efekt mu zůstává; z prodeje
// jde pryč, protože vedle týdenních balíčků by ji nikdo nekoupil.
//
// add je přírůstek k návštěvnosti v bodech, ne procento z tržeb: základ je
// 0,45 a strop 1,1, takže +0,25 je pro začátečníka o 56 % víc tržeb a pro
// hráče na stropu o 23 %. Popisky proto mluví o bodech — „+25 %" si hráči
// četli jako čtvrtinu navíc na tržbách a balíček byl ve skutečnosti silnější.
//
// Ceny z toho vycházejí. První týden se prodávalo za 49/69/99, což bylo
// postavené na tom mylném čtení: za 99 Kč dostal začátečník o polovinu vyšší
// tržby na celý týden, zatímco infolinka za stejné peníze dělá zlomek toho.
// Nová řada drží slevu za objem — čím silnější balíček, tím levnější bod —
// a nejdražší kampaň je nad infolinkou, což odpovídá tomu, co umí.
//   Letáky         +10 bodů   69 Kč   6,90 za bod
//   Rádio a polep  +15 bodů   99 Kč   6,60 za bod
//   Velká kampaň   +25 bodů  149 Kč   5,96 za bod
// Kdo koupil dřív a levněji, o nic nepřichází: jednorázový balíček je
// spotřebovaný a běžící předplatné si drží cenu, za kterou bylo založeno.
const KAMPAN = {
  kampan10: { kind: 'kampan10', icon: 'megaphone', price: 6900, dnu: 7, add: 0.10 },
  kampan15: { kind: 'kampan15', icon: 'megaphone', price: 9900, dnu: 7, add: 0.15 },
  kampan25: { kind: 'kampan25', icon: 'megaphone', price: 14900, dnu: 7, add: 0.25 },
};
const KAMPAN_KINDS = Object.keys(KAMPAN);

// ─── Předplatné ──────────────────────────────────────────────────────────────
// Co se strhává samo dokola. Cena je za JEDNOHO technika a týden; jeden
// technik stihne obsloužit `kapacita` poboček. Víc poboček = víc techniků.
// Infolinka na předplatné: totéž co balíček, jen se sama obnovuje. Dokud
// předplatné běží, je linka zapnutá — nic se nepřipisuje na čas, platí stav
// předplatného. Zrušit jde kdykoli a zaplacené období dojede.
const SUBS = {
  linka_sub1d: { kind: 'linka_sub1d', icon: 'phone',
    price: 4900, interval: 'day', interval_count: 1, linka: true },
  linka_sub3d: { kind: 'linka_sub3d', icon: 'phone',
    price: 7400, interval: 'day', interval_count: 3, linka: true },
  linka_sub7d: { kind: 'linka_sub7d', icon: 'phone',
    price: 9900, interval: 'week', interval_count: 1, linka: true },
  linka_sub30d: { kind: 'linka_sub30d', icon: 'phone',
    price: 29000, interval: 'month', interval_count: 1, linka: true },
  linka_sub365d: { kind: 'linka_sub365d', icon: 'phone',
    price: 99900, interval: 'year', interval_count: 1, linka: true },
  dispecer: {
    kind: 'dispecer', icon: 'wrench', price: 3900,
    interval: 'week', kapacita: 35 },
  // Kampaň na předplatné: totéž co balíček, jen se sama obnovuje. Běží,
  // dokud běží předplatné.
  kampan_sub10: { kind: 'kampan_sub10', icon: 'megaphone',
    price: 6900, interval: 'week', interval_count: 1, kampan: true, add: 0.10, dnu: 7 },
  kampan_sub15: { kind: 'kampan_sub15', icon: 'megaphone',
    price: 9900, interval: 'week', interval_count: 1, kampan: true, add: 0.15, dnu: 7 },
  kampan_sub25: { kind: 'kampan_sub25', icon: 'megaphone',
    price: 14900, interval: 'week', interval_count: 1, kampan: true, add: 0.25, dnu: 7 },
};
const SUB_KINDS = Object.keys(SUBS);

// Text položek bydlí v katalogu — tady zůstávají jen čísla a chování. České
// znění se doplní při startu: potřebuje ho Stripe (název produktu na účtence)
// a správa hry. Hráč vidí text složený v prohlížeči podle kódu položky, takže
// každý ve svém jazyce.
[CARDS, CASH, RAMEC, LINKA, KAMPAN, SUBS].forEach((tab) => {
  Object.keys(tab).forEach((k) => {
    const x = tab[k];
    ['name', 'short', 'desc'].forEach((pole) => {
      const klic = 'obchod.' + x.kind + '.' + pole;
      const v = TEXTY.t(klic, null, 'cs');
      if (v !== klic) x[pole] = v;
    });
  });
});
// Ručně přidaná hotovost z administrace. Není v nabídce, nedá se koupit —
// vzniká jen tím, že ji někdo hráči přidá, a nese vlastní částku.
const CASH_CUSTOM = 'cash_dar';
const ALL = Object.assign({}, CARDS, CASH, SUBS, LINKA, KAMPAN, RAMEC);
// Co se hráči počítá mezi nevyzvednuté kusy. Je to všechno, co se dá koupit
// jako kus, tedy ALL bez předplatného — to se nekupuje po kusech a bydlí
// v GameSubscription. Rodina, která tu chybí, znamená zaplacenou kartu, o
// které se hra nikdy nedozví: přesně tohle potkalo kampaně hned první den.
// Proto se seznam nevypisuje ručně, ale odvozuje — nová rodina v ALL je tu
// automaticky. Hlídá to nastroje/tvlastni.js.
const POCITANE_KINDS = Object.keys(ALL).filter((k) => !SUBS[k]).concat([CASH_CUSTOM]);

// ─── Nastavení hry ───────────────────────────────────────────────────────────
// Přepínače, které jde cvaknout z administrace bez nasazování. Držíme je
// půl minuty v paměti, ať se kvůli každému načtení hry nechodí do databáze.
const NASTAVENI_VYCHOZI = { onboarding_rychly: '1', nick_pauza_dnu: '30', udalosti_zap: '1',
  // Odměny za hodnosti a odznaky běží. Zpětné vyplacení stávajícím hráčům
  // bylo dlouho vypnuté, protože rozdané peníze a karty už zpátky nevezmeš —
  // 18. 11. 2026 padlo rozhodnutí je pustit. Doplácí se každému při prvním
  // uložení hry, jednou: řádek v game_odmeny hlídá, že se nic nevyplatí
  // dvakrát. Nastavení v databázi má pořád přednost, takže se to dá zastavit
  // bez nasazení.
  hodnosti_odmeny: '1', hodnosti_zpetne: '1',
  // Postavit půjde jen stroj, který má hráč podle serveru koupený. Dokud je
  // to vypnuté, server si jen zapisuje, co by odmítl — zapíná se to teprve
  // tehdy, až se ukáže, že by neodmítal nikoho poctivého.
  sklad_povinny: '0' };
let _nast = { at: 0, map: null };
async function nastaveni() {
  if (_nast.map && Date.now() - _nast.at < 30e3) return _nast.map;
  const m = Object.assign({}, NASTAVENI_VYCHOZI);
  try {
    const rows = await prisma.gameSetting.findMany();
    rows.forEach((r) => { m[r.klic] = r.hodnota; });
  } catch (e) { console.warn('[game] nastavení:', e.message); }
  _nast = { at: Date.now(), map: m };
  return m;
}
function dropNastaveni() { _nast = { at: 0, map: null }; }
// Zrychlený onboarding: hotová města hned, první obhlídka zdarma, nájem na
// jedno klepnutí a první stroj doručený okamžitě.
async function rychlyOnboarding() {
  return (await nastaveni()).onboarding_rychly !== '0';
}
// Jak dlouho musí hráč počkat, než si zase změní jméno. Jméno vidí ostatní
// na mapě i v žebříčku, takže z něj nemá být převlek na každý den; 0 = bez pauzy.
async function nickPauzaMs() {
  const d = Number((await nastaveni()).nick_pauza_dnu);
  return (isFinite(d) && d > 0 ? d : 0) * 86400000;
}

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
async function cashPublic(prev) {
  const out = [];
  const zaklad = await item('cash100');
  for (const k of CASH_KINDS) {
    if (CASH[k] && CASH[k].skryty) continue;      // dárky se neprodávají
    const c = await item(k); if (!c) continue;
    out.push({ kind: c.kind, name: c.name, price_czk: prev.zobraz(c.price), laundry: c.laundry,
      // Kolik L$ dostane hráč za jednotku SVOJÍ měny — dělí se cenou už
      // přepočtenou, takže je to euro, dolar nebo zlotý, ne koruna.
      // per_czk zůstává kvůli hrám otevřeným přes nasazení; staré jméno
      // lhalo a dalo se podle něj snadno splést.
      za_jednotku: Math.round(c.laundry / prev.zobraz(c.price)),
      per_czk: Math.round(c.laundry / prev.zobraz(c.price)),
      bonus: zaklad ? Math.round((perCzk(c) / perCzk(zaklad) - 1) * 100) : 0 });
  }
  return out;
}
// Který stupeň rámce má hráč koupený. Karty se nespotřebovávají — jsou to
// trvalá odemčení, takže se jen koukáme, co má.
async function ramecUroven(playerId) {
  try {
    const karty = await prisma.gameCard.findMany({
      where: { player_id: playerId, kind: { in: RAMEC_KINDS } }, select: { kind: true },
    });
    return karty.reduce((a, k) => Math.max(a, (RAMEC[k.kind] || {}).uroven || 0), 0);
  } catch (e) { console.warn('[game] úroveň rámce:', e.message); return 0; }
}
function ramecPodleUrovne(uroven) {
  if (!uroven) return RAMEC_ZDARMA;
  const b = RAMEC_KINDS.map((k) => RAMEC[k]).filter((x) => x.uroven === uroven)[0];
  return b ? b.strop : RAMEC_ZDARMA;        // null = bez stropu
}
async function ramecPublic(playerId, prev) {
  const balicky = [];
  for (const k of RAMEC_KINDS) {
    const c = await item(k); if (!c) continue;
    balicky.push({ kind: c.kind, name: c.name, short: c.short,
      price_czk: prev.zobraz(c.price), strop: RAMEC[k].strop, uroven: RAMEC[k].uroven });
  }
  const uroven = playerId ? await ramecUroven(playerId) : 0;
  return { zdarma: RAMEC_ZDARMA, uroven, strop: ramecPodleUrovne(uroven), balicky };
}

// Kolik korun za hovor — ať je vidět, že větší balíček vyjde líp.
async function linkaPublic(prev) {
  const out = [];
  for (const k of LINKA_KINDS) {
    if (LINKA[k].stary) continue;          // doběh starých balíčků se neprodává
    const c = await item(k); if (!c) continue;
    out.push({ kind: c.kind, name: c.name, price_czk: prev.zobraz(c.price), dnu: LINKA[k].dnu,
      za_den: Math.round(prev.zobraz(c.price) / LINKA[k].dnu * 100) / 100 });
  }
  return out;
}
// Kampaně do ceníku. Posílá se i add a dnu — hra z nich spočítá, o kolik
// to zvedne tržby zrovna tomuhle hráči, a nemusí to hádat podle názvu.
async function kampanPublic(prev) {
  const out = [];
  for (const k of KAMPAN_KINDS) {
    const c = await item(k); if (!c) continue;
    out.push({ kind: c.kind, name: c.name, short: c.short, desc: c.desc,
      price_czk: prev.zobraz(c.price), dnu: KAMPAN[k].dnu, add: KAMPAN[k].add });
  }
  return out;
}
async function subsPublic(prev) {
  const out = [];
  for (const k of SUB_KINDS) {
    const c = await item(k); if (!c) continue;
    out.push({ kind: c.kind, name: c.name, icon: c.icon, short: c.short, desc: c.desc,
      price_czk: prev.zobraz(c.price), interval: c.interval, interval_count: c.interval_count || 1,
      linka: !!c.linka, kampan: !!c.kampan, add: c.add, dnu: c.dnu, kapacita: c.kapacita });
  }
  return out;
}
// Co hráči zrovna běží. Ptáme se databáze, kterou opravují webhooky ze Stripu —
// a i tak nevěříme jen stavu: skončená platnost je skončená platnost.
async function predplatneHrace(p) {
  if (!p) return null;
  const rows = await prisma.gameSubscription.findMany({
    where: { player_id: p.id, status: { in: ['active', 'past_due'] } },
    orderBy: { id: 'desc' }, take: 5
  });
  const ted = Date.now();
  const zive = rows.filter((r) => !r.plati_do || new Date(r.plati_do).getTime() > ted);
  return zive.map((r) => ({ kind: r.kind, qty: r.qty, status: r.status,
    plati_do: r.plati_do, obnovi_se: r.obnovi_se }));
}
async function catalogPublic(prev) {
  const out = [];
  for (const k of CARD_KINDS) {
    const c = await item(k); if (!c) continue;
    out.push({ kind: c.kind, name: c.name, icon: c.icon, short: c.short, desc: c.desc,
      price_czk: prev.zobraz(c.price), bundles: balickyProKartu(c, prev),
      // Stažená z prodeje. Z katalogu nemizí — kdo ji má (třeba za hodnost),
      // musí ji pořád umět použít; hra jí jen schová tlačítko na koupi.
      skryty: !!CARDS[k].skryty });
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
    if (!p) return res.status(401).json({ error: stx(req)('server.nejsi_prihlaseny') });
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
  POCITANE_KINDS.forEach((k) => { counts[k] = 0; });
  cards.forEach((c) => { if (counts[c.kind] != null) counts[c.kind]++; });
  return {
    nick: p.nick, company: p.company || (p.nick + ' s.r.o.'), emblem: p.emblem || null,
    nick_at: p.nick_at || null,
    jazyk: TEXTY.jazykHrace(p),
    ref: p.ref_id || null,
    email: p.email || null,
    first_name: p.first_name || null, last_name: p.last_name || null,
    has_details: !!(p.email && p.first_name && p.last_name),
    ma_heslo: !!p.password_hash,
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
// Musí sedět s cistyZisk() v public/compounder/game/game.js — je to stejné
// číslo, jaké hráči svítí v hlavičce. Pojistné se dlouho odečítalo jen
// v prohlížeči, takže žebříček ukazoval o pojistku vyšší zisk, než hráč sám
// viděl, a čísla si odporovala.
const POJISTNE_PODIL = 0.004;     // měsíční pojistné = 0,4 % ceny stroje
function zbydeMesicne(st) {
  if (!st) return 0;
  const units = Array.isArray(st.units) ? st.units : [];
  const provozni = units.reduce((a, u) => a + ((u.eco && u.eco.profit) || 0), 0);
  const pobocky = (Array.isArray(st.pobocky) ? st.pobocky.length : 0) * POBOCKA_MESICNE;
  const ceta = (st.ceta && st.ceta.od)
    ? CETA_MZDY + (st.ceta.shanec ? SHANEC_MZDA : 0) + (Number(st.ceta.phm) || 0) : 0;
  const pojisteni = st.pojisteni
    ? units.reduce((a, u) => a + (CENY_STROJU[(u.eco && u.eco.model)] || CENY_STROJU.mini)
      * POJISTNE_PODIL, 0)
    : 0;
  return Math.round(provozni - splatkyMesicne(st) - pobocky - ceta - pojisteni);
}

// ─── Distributor ────────────────────────────────────────────────────────────
// Kdo si platí měsíční režii, dostává 10 % z ceny každého prádlomatu, který
// postaví hráč, jehož do hry přivedl. Není to automatické — režie se musí
// každý herní měsíc obnovit, jinak výhoda spadne.
const DIST_REZIE = 40000;         // dávka režie za herní měsíc
const DIST_NA_HRACU = 5;          // za každých pět přivedených jedna dávka
const DIST_PROVIZE = 0.10;        // podíl z ceny prádlomatu
const MESIC_MS = 43200000;        // herní měsíc = 12 skutečných hodin
// Kam až smí vyrůst uložený stav. Musí zůstat pod limitem parseru těla
// požadavku (4 MB o pár řádků výš), jinak by uložení spadlo dřív, než se
// k téhle kontrole dostane, a hráč by místo srozumitelné hlášky dostal mlčení.
const STAV_MAX = 3000000;
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
          text_kod: 'dor.provize', text_data: { penize: castka, p1: h.nick },
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

// Dodací lhůta. Čím větší síť, tím déle se čeká — musí sedět s dodaniDnu()
// v public/compounder/game/game.js. Počítá se z evidence míst, ne z toho, co
// pošle prohlížeč.
const DODANI_ZA = 50, DODANI_MAX_DNU = 5, DELIVERY_MONTHS = 2;
async function dodaniMs(playerId) {
  const n = await prisma.gameSpotClaim.count({ where: { player_id: playerId, model: { not: '' } } });
  const dnu = Math.max(1, Math.min(DODANI_MAX_DNU, Math.ceil(n / DODANI_ZA)));
  return dnu * DELIVERY_MONTHS * MESIC_MS;
}

// POST /account/nakup { model, hned } — hráč právě koupil stroj.
// Dvě věci naráz: kdo ho do hry přivedl a platí si distribuci, dostane
// provizi hned, bez čekání na dovoz a stavbu. A objednávka se zapíše, aby
// server věděl, co má hráč na cestě a ve skladu — dosud to žilo jen
// v prohlížeči, a proto serverové jmění sklad vůbec nevidělo.
//
// Zatím se jen zapisuje. Hra pořád jede podle svého a nic si odsud nebere;
// teprve až se ukáže, že obojí sedí, může se sklad stát tím rozhodujícím.
router.post('/account/nakup', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const model = s(b.model, 10);
    let objednavka = null;
    if (CENY_STROJU[model]) {
      const ted = Date.now();
      const za = b.hned ? 0 : await dodaniMs(req.player.id);
      objednavka = await prisma.gameOrder.create({ data: {
        player_id: req.player.id, model, cena: CENY_STROJU[model],
        dorazi_at: new Date(ted + za),
      } });
    }
    const zvouci = await kdoPrivedl(req.player);
    const vyplaceno = zvouci ? await dorovnejProvize(zvouci) : 0;
    res.json({ ok: true, vyplaceno, objednavka: objednavka ? objednavka.id : null });
  } catch (e) { next(e); }
});

// Stavba spotřebuje stroj ze skladu. Zatím je to jen značka: když se stroj
// nenajde, nic se neodmítá — hra pořád rozhoduje sama a tenhle zápis slouží
// k tomu, aby šlo porovnat, jestli obojí sedí. Až se ukáže, že ano, stane se
// z toho podmínka: postavit půjde jen stroj, který hráč opravdu koupil.
// Hledání se dělá PŘED zabráním místa, označení AŽ POTOM, co se zabrání
// povedlo. Kdyby se stroj odepsal dřív a zábor pak selhal, hráč by o něj
// přišel — a ztracený stroj je mnohem horší než stroj navíc.
async function najdiStroj(playerId, model, spot) {
  if (!model) return { ok: true, id: null };
  try {
    const volny = await prisma.gameOrder.findFirst({
      where: { player_id: playerId, model, postaveno_at: null, zruseno_at: null },
      orderBy: { dorazi_at: 'asc' },
      select: { id: true },
    });
    if (volny) return { ok: true, id: volny.id };
    const n = await nastaveni().catch(() => ({}));
    const povinny = String(n.sklad_povinny || '0') === '1';
    console.warn('[game-sklad] hráč #' + playerId + ' staví ' + model + ' na ' + spot
      + ', ale server mu žádný takový stroj neeviduje'
      + (povinny ? ' — ODMÍTNUTO' : ' — zatím se jen zapisuje'));
    // Do konzole se z provozu nikdo nedívá, a přitom je to jediné číslo,
    // podle kterého se dá rozhodnout, jestli už smí sklad odmítat. Zápis
    // nesmí stavbu shodit ani zdržet — proto bez čekání a bez výjimky.
    prisma.gameDohled.create({ data: { player_id: playerId, druh: 'sklad',
      detail: (model + ' · ' + spot).slice(0, 200) } })
      .catch((e) => console.warn('[game-dohled]', e && e.message));
    return { ok: !povinny, id: null, chybi: true };
  } catch (e) {
    // Výpadek evidence skladu nesmí hráči zablokovat stavbu. Radši stroj
    // navíc než hráč, kterému hra nejde hrát.
    console.warn('[game] sklad při stavbě:', e.message);
    return { ok: true, id: null };
  }
}
async function oznacPostaveny(id, spot) {
  if (!id) return;
  try {
    await prisma.gameOrder.update({ where: { id }, data: { postaveno_at: new Date(), spot_id: spot } });
  } catch (e) { console.warn('[game] sklad při stavbě:', e.message); }
}

// GET /account/sklad → co má hráč podle serveru na cestě a ve skladu.
// Hra si to zatím jen může porovnat se svým; rozhoduje pořád ona.
router.get('/account/sklad', requirePlayer, async (req, res, next) => {
  try {
    const rows = await prisma.gameOrder.findMany({
      where: { player_id: req.player.id, postaveno_at: null, zruseno_at: null },
      orderBy: { dorazi_at: 'asc' },
    });
    const ted = Date.now();
    res.json({ ok: true,
      skladem: rows.filter((r) => new Date(r.dorazi_at).getTime() <= ted)
        .map((r) => ({ id: r.id, model: r.model, cena: r.cena })),
      na_ceste: rows.filter((r) => new Date(r.dorazi_at).getTime() > ted)
        .map((r) => ({ id: r.id, model: r.model, cena: r.cena, dorazi: r.dorazi_at })) });
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

// ─── Začátek hry: jen nick a firma ───────────────────────────────────────────
// POST /account/zacni { nick, company } → { ok, player }
// Na úvodce po hráči nechceme heslo ani e-mail — jen pod jakým jménem hraje.
// Účet tím vznikne doopravdy (nick je zabraný, síť se ukládá na server), ale
// zatím ho drží jen cookie v prohlížeči. Heslo si doplní, až bude mít co
// ztratit; do té doby se jinde přihlásit nedá a hra mu to říká.
router.post('/account/zacni', async (req, res, next) => {
  try {
    if (rateLimited('zac:' + ipOf(req), 10, 3600e3)) return res.status(429).json({ error: stx(req)('server.moc_pokusu_zkus_to_za_chvili') });
    const nick = s((req.body || {}).nick, 24);
    if (!NICK_RE.test(nick)) return res.status(400).json({ error: stx(req)('server.jmeno_musi_mit_3_24_znaku') });
    const lower = nick.toLowerCase();
    const taken = await prisma.gamePlayer.findUnique({ where: { nick_lower: lower }, select: { id: true } });
    if (taken) return res.status(409).json({ error: stx(req)('server.pod_timhle_jmenem_uz_nekdo_hraje') });
    const p = await prisma.gamePlayer.create({
      data: { nick, nick_lower: lower, company: firmaNebo(s((req.body || {}).company, 60), nick),
        password_hash: null, last_login_at: new Date(),
        zdroj: s((req.body || {}).zdroj, 80) || null,
        sid: /^[a-z0-9-]{6,64}$/.test(String((req.body || {}).sid || ''))
          ? String((req.body || {}).sid) : null,
        ...puvod(req) }
    });
    { const mod = require('../services/game/moderace').zkontroluj; mod({ player: p, zdroj: 'nick', text: p.nick }); if (p.company && p.company !== p.nick + ' s.r.o.') mod({ player: p, zdroj: 'firma', text: p.company }); }
    try {
      await prisma.gameCard.createMany({ data: CARD_KINDS.map((k) => ({ player_id: p.id, kind: k })) });
    } catch (e) { console.warn('[game] uvítací karty:', e.message); }
    let hrac = p;
    try {
      hrac = await narokujRef(hrac, (req.body || {}).ref);
      hrac = await zapisPozvani(hrac, (req.body || {}).odkud);
    } catch (e) { console.warn('[game] pozvánky na začátku:', e.message); }
    setCookie(res, sign(hrac));
    res.json({ ok: true, player: await pub(hrac) });
    require('../services/game/notify').newPlayer(prisma, hrac);
  } catch (e) {
    if (e && e.code === 'P2002') return res.status(409).json({ error: stx(req)('server.pod_timhle_jmenem_uz_nekdo_hraje_2') });
    next(e);
  }
});

// POST /account/heslo { password } — doplnění hesla k účtu, co vzniklo bez něj.
// Kdo heslo už má, mění si ho jinde; tahle cesta slouží jen k prvnímu nastavení.
router.post('/account/heslo', requirePlayer, async (req, res, next) => {
  try {
    if (req.player.password_hash) return res.status(409).json({ error: stx(req)('server.heslo_uz_mas_nastavene') });
    const pwd = String((req.body || {}).password || '');
    if (pwd.length < 6) return res.status(400).json({ error: stx(req)('server.heslo_musi_mit_aspon_6_znaku') });
    if (pwd.length > 200) return res.status(400).json({ error: stx(req)('server.heslo_je_prilis_dlouhe') });
    const hrac = await prisma.gamePlayer.update({
      where: { id: req.player.id },
      data: { password_hash: await bcrypt.hash(pwd, 10) }
    });
    res.json({ ok: true, player: await pub(hrac) });
  } catch (e) { next(e); }
});

// ─── Registrace ──────────────────────────────────────────────────────────────
// POST /account/register { nick, password } → { ok, player }
router.post('/account/register', async (req, res, next) => {
  try {
    if (rateLimited('reg:' + ipOf(req), 10, 3600e3)) return res.status(429).json({ error: stx(req)('server.moc_pokusu_zkus_to_za_chvili_2') });
    const nick = s((req.body || {}).nick, 24);
    const pwd = String((req.body || {}).password || '');
    if (!NICK_RE.test(nick)) return res.status(400).json({ error: stx(req)('server.nick_musi_mit_3_24_znaku') });
    if (pwd.length < 6) return res.status(400).json({ error: stx(req)('server.heslo_musi_mit_aspon_6_znaku_2') });
    if (pwd.length > 200) return res.status(400).json({ error: stx(req)('server.heslo_je_prilis_dlouhe_2') });
    const lower = nick.toLowerCase();
    const taken = await prisma.gamePlayer.findUnique({ where: { nick_lower: lower }, select: { id: true } });
    if (taken) return res.status(409).json({ error: stx(req)('server.tenhle_nick_uz_nekdo_ma_vymysli') });
    const p = await prisma.gamePlayer.create({
      data: { nick, nick_lower: lower, company: firmaNebo(s((req.body || {}).company, 60), nick),
        password_hash: await bcrypt.hash(pwd, 10), last_login_at: new Date(),
        // Odkud přišel: hra si to zapamatuje z adresy při první návštěvě.
        zdroj: s((req.body || {}).zdroj, 80) || null,
        // Id první návštěvy — podle něj se k účtu najde záznam první minuty.
        sid: /^[a-z0-9-]{6,64}$/.test(String((req.body || {}).sid || ''))
          ? String((req.body || {}).sid) : null,
        ...puvod(req) }
    });
    { const mod = require('../services/game/moderace').zkontroluj; mod({ player: p, zdroj: 'nick', text: p.nick }); if (p.company && p.company !== p.nick + ' s.r.o.') mod({ player: p, zdroj: 'firma', text: p.company }); }
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
    if (e && e.code === 'P2002') return res.status(409).json({ error: stx(req)('server.tenhle_nick_uz_nekdo_ma_vymysli_2') });
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
    if (rateLimited('log:' + ipOf(req), 20, 900e3)) return res.status(429).json({ error: stx(req)('server.moc_pokusu_zkus_to_za_chvili_3') });
    const nick = s((req.body || {}).nick, 24);
    const pwd = String((req.body || {}).password || '');
    const p = await prisma.gamePlayer.findUnique({ where: { nick_lower: nick.toLowerCase() } });
    if (p && !p.disabled && !p.password_hash) {
      return res.status(409).json({ error: stx(req)('server.tenhle_ucet_jeste_nema_heslo_otevri') });
    }
    const ok = p && !p.disabled && p.password_hash && await bcrypt.compare(pwd, p.password_hash);
    if (!ok) return res.status(401).json({ error: stx(req)('server.nick_nebo_heslo_nesedi') });
    let hrac = await prisma.gamePlayer.update({ where: { id: p.id }, data: { last_login_at: new Date() } });
    // Účty z doby před pozvánkami si při prvním přihlášení nárokují svoje sdílené id.
    try { hrac = await narokujRef(hrac, (req.body || {}).ref); }
    catch (e) { console.warn('[game] pozvánky při přihlášení:', e.message); }
    setCookie(res, sign(hrac));
    res.json({ ok: true, player: await pub(hrac), state: hrac.state || null, rev: hrac.state_rev || 0 });
  } catch (e) { next(e); }
});

// POST /account/logout
router.post('/account/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

// GET /account/odznaky → co mám a co mi chybí. Katalog posíláme s sebou, ať
// hra nemusí držet vlastní kopii textů.
router.get('/account/odznaky', requirePlayer, async (req, res, next) => {
  try {
    const mam = await prisma.gameOdmena.findMany({
      where: { player_id: req.player.id, druh: 'odznak' },
      select: { kod: true, created_at: true } });
    const kdy = {};
    mam.forEach((x) => { kdy[x.kod] = x.created_at; });
    res.json({ ok: true, odznaky: odznakyPro(TEXTY.jazykHrace(req.player)).map((o) => ({
      kod: o.kod, nazev: o.nazev, ikona: o.ikona, popis: o.popis, jak: o.jak,
      barva: o.barva || null, odmena: o.odmena || null,
      mam: !!kdy[o.kod], kdy: kdy[o.kod] || null })) });
  } catch (e) { next(e); }
});

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
    // Odkud se hráč připojuje — doplní se na pozadí, odpověď na to nečeká.
    // Jednou za načtení hry stačí; služba se stejně ptá jen při změně IP.
    require('../services/game/geo').obnov(p, ipOf(req));
    res.json({ ok: true, player: await pub(p), state: p.state || null, rev: p.state_rev || 0,
      // Žebřík hodností posíláme ze serveru, aby hra v liště neukazovala jiný
      // titul, než jaký u toho hráče vidí ostatní v žebříčku a na burze.
      hodnosti: hodnostiPro(TEXTY.jazykHrace(p)) });
  } catch (e) { next(e); }
});

// POST /account/details { email, first_name, last_name } — doplnění před nákupem
router.post('/account/details', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const email = s(b.email, 160).toLowerCase();
    const first = s(b.first_name, 60);
    const last = s(b.last_name, 60);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: stx(req)('server.zadej_platny_e_mail') });
    if (first.length < 2 || last.length < 2) return res.status(400).json({ error: stx(req)('server.vypln_jmeno_i_prijmeni') });
    const p = await prisma.gamePlayer.update({
      where: { id: req.player.id }, data: { email, first_name: first, last_name: last }
    });
    res.json({ ok: true, player: await pub(p) });
  } catch (e) { next(e); }
});

// ─── Potvrzení slovem ──────────────────────────────────────────────────────
// Dva kroky už nejdou vzít zpátky: čistý štít a smazání účtu. Ani jeden se
// nesmí spustit ukliknutím, takže hráč musí slovo opsat. Hlídá to SERVER, ne
// jen okno v prohlížeči — kdyby to bylo jen v okně, stačilo by poslat
// požadavek rovnou a potvrzení by nebylo k ničemu.
// Diakritika ani velikost písmen se neřeší: kdo napíše „zacit znova", myslel
// to stejně vážně jako ten, kdo trefil háčky.
const bezOzdob = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();
function potvrzeniSedi(zadano, klic, jazyk) {
  const a = bezOzdob(zadano);
  if (!a) return false;
  // Bereme slovo v řeči hráče i v češtině — kdo si mezitím přepnul jazyk,
  // ať nezůstane zamčený venku.
  return [TEXTY.t(klic, null, jazyk), TEXTY.t(klic, null, TEXTY.ZDROJ)]
    .some((x) => bezOzdob(x) === a);
}

// POST /account/reset — hráč začíná od nuly. Účet i zaplacené karty mu zůstávají
// (ty si koupil za skutečné peníze), ale síť, uložený stav a zabraná místa mizí.
// Bez téhle routy by se stav po obnovení stránky vrátil ze serveru.
// Čistý štít není mazací guma. Hráč může mít v běhu půjčku od jiného hráče
// nebo podíl, za který mu někdo zaplatil hotovost — to nejsou jeho čísla,
// to jsou peníze někoho jiného. Vyrovnání proto proběhne první a teprve pak
// se maže. Podrobnosti v services/game/konec.js.
router.post('/account/reset', requirePlayer, async (req, res, next) => {
  try {
    const jaz = TEXTY.jazykHrace(req.player);
    if (!potvrzeniSedi((req.body || {}).potvrzeni, 'server.potvrzeni_zacit_znovu', jaz)) {
      return res.status(400).json({ error: stx(req)('server.napis_pro_potvrzeni',
        { p1: TEXTY.t('server.potvrzeni_zacit_znovu', null, jaz) }) });
    }
    const v = await require('../services/game/konec').ukonciHru(req.player.id);
    res.json({ ok: true, vyrovnani: v });
  } catch (e) { next(e); }
});

// POST /account/smazat — právo na výmaz. Nevratné: napřed konkurz, pak z účtu
// zmizí osobní údaje. Podrobnosti i to, co se schválně nemaže, v konec.js.
router.post('/account/smazat', requirePlayer, async (req, res, next) => {
  try {
    const jaz = TEXTY.jazykHrace(req.player);
    if (!potvrzeniSedi((req.body || {}).potvrzeni, 'server.potvrzeni_smazat', jaz)) {
      return res.status(400).json({ error: stx(req)('server.napis_pro_potvrzeni',
        { p1: TEXTY.t('server.potvrzeni_smazat', null, jaz) }) });
    }
    const v = await require('../services/game/konec').smazUcet(req.player.id);
    if (!v.ok) return res.status(409).json({ error: stx(req)('server.ucet_uz_neexistuje') });
    // Přihlášení padá s token_version, cookie smažeme hned, ať se nikdo
    // nevrací do prázdné schránky.
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true, vyrovnani: v.vyrovnani, predplatne_zruseno: v.predplatne_zruseno });
  } catch (e) { next(e); }
});

// GET /account/udaje → všechno, co o hráči vedeme, v jednom souboru.
// Právo na přístup k vlastním údajům: hráč nemá prosit o výpis, prostě si ho
// stáhne. Nic se tu nemaže ani nemění — je to čtení.
// Záměrně se vydává i celý stav hry: je to jeho hra. Ven nejdou jen hesla
// (držíme jen jejich otisk, ze kterého heslo nezjistí nikdo) a vnitřní
// identifikátory Stripu, které hráči nic neřeknou a patří do účetnictví.
router.get('/account/udaje', requirePlayer, async (req, res, next) => {
  try {
    const id = req.player.id;
    const [p, nakupy, predplatne, odmeny, mista, pujcky, podily, dorucenky, obchody] = await Promise.all([
      prisma.gamePlayer.findUnique({ where: { id } }),
      prisma.gamePurchase.findMany({ where: { player_id: id }, orderBy: { created_at: 'asc' } }),
      prisma.gameSubscription.findMany({ where: { player_id: id }, orderBy: { id: 'asc' } }),
      prisma.gameOdmena.findMany({ where: { player_id: id }, orderBy: { id: 'asc' } }),
      prisma.gameSpotClaim.findMany({ where: { player_id: id }, orderBy: { id: 'asc' } }),
      prisma.gameLoan.findMany({ where: { OR: [{ borrower_id: id }, { lender_id: id }] }, orderBy: { id: 'asc' } }),
      prisma.gameEquity.findMany({ where: { OR: [{ firma_id: id }, { investor_id: id }] }, orderBy: { id: 'asc' } }),
      prisma.gameDelivery.findMany({ where: { player_id: id }, orderBy: { id: 'asc' }, take: 2000 }),
      prisma.gameTrade.findMany({ where: { OR: [{ from_id: id }, { to_id: id }] }, orderBy: { id: 'asc' }, take: 2000 }),
    ]);
    if (!p) return res.status(404).json({ error: stx(req)('server.takovy_hrac_tu_neni') });
    const ven = {
      vydano: new Date().toISOString(),
      co_to_je: stx(req)('server.vsechno_co_o_tobe_hra_vede'),
      ucet: {
        id: p.id, nick: p.nick, firma: p.company, znak: p.emblem, jazyk: p.jazyk,
        hodnost: p.hodnost, email: p.email, jmeno: p.first_name, prijmeni: p.last_name,
        zalozeno: p.created_at, posledni_prihlaseni: p.last_login_at,
        stav_ulozen: p.state_at, zdroj_navstevy: p.zdroj,
        odkaz_id: p.ref_id, pozval_me_id: p.invited_by_id, pozvan: p.invited_at,
        cas_ve_hre_s: p.hra_s_celkem, distributor_do: p.distributor_do,
        provize_celkem: p.provize_celkem, ucet_zablokovan: p.disabled,
      },
      stav_hry: p.state || null,
      nakupy: nakupy.map((o) => ({ id: o.id, co: o.kind, pocet: o.qty,
        castka: o.amount_cents / 100, mena: o.currency, stav: o.status,
        zalozeno: o.created_at, zaplaceno: o.paid_at, email: o.email })),
      predplatne: predplatne.map((x) => ({ id: x.id, co: x.kind, pocet: x.qty,
        stav: x.status, plati_do: x.plati_do, obnovi_se: x.obnovi_se })),
      odmeny, mista, pujcky, podily,
      dorucenky: dorucenky.map((d) => ({ id: d.id, druh: d.kind, castka: d.amount,
        popis: d.popis, vyzvednuto: d.claimed_at, kdy: d.created_at })),
      obchody: obchody.map((t) => ({ id: t.id, smer: t.smer, co: t.predmet, cena: t.cena,
        stav: t.stav, od: t.from_nick, komu: t.to_nick, vzkaz: t.vzkaz, kdy: t.created_at })),
    };
    res.setHeader('Content-Disposition',
      'attachment; filename="laundromat-tycoon-udaje-' + id + '.json"');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(ven, null, 2));
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
    if (e && !ZNAK_RE.test(e)) return res.status(400).json({ error: stx(req)('server.neplatny_znak') });
    const p = await prisma.gamePlayer.update({ where: { id: req.player.id }, data: { emblem: e || null } });
    dropZeb();
    res.json({ ok: true, player: await pub(p) });
  } catch (e) { next(e); }
});

// POST /account/company { company } — přejmenování firmy
router.post('/account/company', requirePlayer, async (req, res, next) => {
  try {
    const f = s((req.body || {}).company, 60);
    if (!FIRMA_RE.test(f)) return res.status(400).json({ error: stx(req)('server.nazev_firmy_ma_2_60_znaku') });
    const p = await prisma.gamePlayer.update({ where: { id: req.player.id }, data: { company: f } });
    require('../services/game/moderace').zkontroluj({ player: p, zdroj: 'firma', text: f });
    dropZeb();   // žebříček drží 30 s v paměti, po přejmenování ho zahodíme
    res.json({ ok: true, player: await pub(p) });
  } catch (e) { next(e); }
});

// POST /account/nick { nick } — změna jména hráče
// Jméno je po celé hře rozkopírované do desítek záznamů (kdo komu co prodal,
// komu patří místo na mapě, kdo komu dluží). Mění se proto všude najednou,
// jinak by po hráči zůstával starý podpis na mapě i v přehledech.
router.post('/account/nick', requirePlayer, async (req, res, next) => {
  try {
    const nick = s((req.body || {}).nick, 24);
    if (!NICK_RE.test(nick)) {
      return res.status(400).json({ error: stx(req)('server.jmeno_musi_mit_3_24_znaku_2') });
    }
    const stary = req.player.nick;
    if (nick === stary) return res.json({ ok: true, player: await pub(req.player) });
    const lower = nick.toLowerCase();
    // Stejné jméno jinými velkými písmeny si hráč smí opravit kdykoli a zadarmo.
    const jenVelikost = lower === String(stary).toLowerCase();
    if (!jenVelikost) {
      const pauza = await nickPauzaMs();
      const od = req.player.nick_at ? new Date(req.player.nick_at).getTime() : 0;
      if (pauza && od && Date.now() - od < pauza) {
        const dnu = Math.ceil((pauza - (Date.now() - od)) / 86400000);
        return res.status(409).json({ error: stx(req)('server.jmeno_menil_nedavno_dnu', { p1: dnu }) });
      }
      const taken = await prisma.gamePlayer.findUnique({ where: { nick_lower: lower }, select: { id: true } });
      if (taken && taken.id !== req.player.id) {
        return res.status(409).json({ error: stx(req)('server.pod_timhle_jmenem_uz_nekdo_hraje_3') });
      }
    }
    const id = req.player.id;
    const p = await prisma.gamePlayer.update({ where: { id },
      data: { nick, nick_lower: lower, nick_at: new Date() } });
    require('../services/game/moderace').zkontroluj({ player: p, zdroj: 'nick', text: nick });
    // Přepis podpisů všude jinde. Kdyby některý krok selhal, hra tím nepadne —
    // jen někde zůstane staré jméno, a to je menší zlo než půlka změny.
    try {
      await Promise.all([
        prisma.gameSpotClaim.updateMany({ where: { player_id: id }, data: { nick } }),
        prisma.gameSpotClaim.updateMany({ where: { vyzyvatel_id: id }, data: { vyzyvatel_nick: nick } }),
        prisma.gameSpotClaim.updateMany({ where: { najemce_id: id }, data: { najemce_nick: nick } }),
        prisma.gameTrade.updateMany({ where: { from_id: id }, data: { from_nick: nick } }),
        prisma.gameTrade.updateMany({ where: { to_id: id }, data: { to_nick: nick } }),
        prisma.gameLoan.updateMany({ where: { lender_id: id }, data: { lender_nick: nick } }),
        prisma.gameLoan.updateMany({ where: { borrower_id: id }, data: { borrower_nick: nick } }),
        prisma.gameEquity.updateMany({ where: { investor_id: id }, data: { investor_nick: nick } }),
        prisma.gameEquity.updateMany({ where: { firma_id: id }, data: { firma_nick: nick } }),
        prisma.gameMarket.updateMany({ where: { player_id: id }, data: { nick } }),
        prisma.gameMarket.updateMany({ where: { koupil_id: id }, data: { koupil_nick: nick } }),
        prisma.gameAuction.updateMany({ where: { player_id: id }, data: { nick } }),
      ]);
    } catch (e) { console.warn('[game] přepis jména ' + stary + ' → ' + nick + ':', e.message); }
    dropZeb();
    setCookie(res, sign(p));   // v podepsané cookii je nick, ať nesedí starý
    console.log('[game] hráč #' + id + ' se přejmenoval: ' + stary + ' → ' + nick);
    res.json({ ok: true, player: await pub(p) });
  } catch (e) {
    if (e && e.code === 'P2002') return res.status(409).json({ error: stx(req)('server.pod_timhle_jmenem_uz_nekdo_hraje_4') });
    next(e);
  }
});

// ─── Stav hry ────────────────────────────────────────────────────────────────
// Kolik času hráč ve hře opravdu strávil. Klient se ozývá zhruba co patnáct
// vteřin, dokud má hru otevřenou — tak se dá sčítat mezera od minulého
// ozvání. Delší mezera znamená, že hru mezitím zavřel, a nepočítá se.
// Když je hra jen na pozadí (jiná záložka), čas neběží, ale značku posouváme,
// ať se po návratu nepřipočte celá pauza.
const CAS_MEZERA_S = 150;   // delší ticho = hráč byl pryč
function denPrahy(d) { return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }); }
function odehranyCas(p, ted, aktivni) {
  let pridat = 0;
  if (aktivni && p.hra_at) {
    const s = Math.round((ted.getTime() - new Date(p.hra_at).getTime()) / 1000);
    if (s > 0 && s <= CAS_MEZERA_S) pridat = s;
  }
  const den = denPrahy(ted);
  const dnesek = p.hra_den === den ? (p.hra_s_den || 0) : 0;
  return {
    hra_at: ted,
    hra_den: den,
    hra_s_den: dnesek + pridat,
    hra_s_celkem: (p.hra_s_celkem || 0) + pridat,
  };
}

// ─── Pojistka na zaplacené balíčky ───────────────────────────────────────────
// Balíček se na serveru označí za vyzvednutý, ale uloží se až se stavem, který
// posílá klient — a ten se dá ztratit: druhé zařízení uloží novější stav,
// klient ho převezme a svoje poslední vteřiny i s balíčkem zahodí. Proto si
// server u každého uložení ohlídá, že složená zástava není nižší než součet
// balíčků, které si hráč vyzvedl. Ztracený balíček se tím doplní sám.
const _podlahy = new Map();          // player_id → { at, hodnota }
function dropPodlaha(id) { _podlahy.delete(id); }
async function zastavaPodlaha(playerId) {
  const v = _podlahy.get(playerId);
  if (v && Date.now() - v.at < 60e3) return v.hodnota;
  let hodnota = 0;
  try {
    const karty = await prisma.gameCard.findMany({
      where: { player_id: playerId, kind: { in: CASH_KINDS }, used_at: { not: null } },
      select: { kind: true },
    });
    for (const k of karty) {
      const c = await item(k.kind);
      hodnota += (c && c.laundry) || (CASH[k.kind] && CASH[k.kind].laundry) || 0;
    }
  } catch (e) { console.warn('[game] podlaha zástavy:', e.message); return 0; }
  _podlahy.set(playerId, { at: Date.now(), hodnota });
  return hodnota;
}

// PUT /account/state { state } — klient posílá celý stav, server ho jen uloží.
// Simulace běží v prohlížeči; server je úložiště, ne rozhodčí. Jediné, co se
// podvrhnout nedá, jsou karty — ty žijí ve vlastní tabulce.
// POST /account/ping — tep otevřené hry (i ze skryté záložky), jen pro přehled „kdo je online“
// ─── Jazyk hry ───────────────────────────────────────────────────────────────
// GET /texty/:jazyk → celý katalog pro prohlížeč. Angličtina přichází
// podložená češtinou, takže hře nikdy nechybí klíč a nemusí řešit pády sama.
router.get('/texty/:jazyk', (req, res) => {
  const j = String(req.params.jazyk || '').slice(0, 5);
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ ok: true, jazyk: TEXTY.JAZYKY.indexOf(j) >= 0 ? j : TEXTY.ZDROJ,
    texty: TEXTY.katalogPro(j) });
});

// GET /texty/linka/:jazyk → scénáře infolinky. Je to souvislá próza, ne
// popisky, tak má vlastní soubor místo tisíce klíčů v katalogu. Když pro
// daný jazyk ještě nejsou, pošlou se české — rozhovor česky je pořád lepší
// než infolinka, která nezvoní.
router.get('/texty/linka/:jazyk', (req, res) => {
  const j = String(req.params.jazyk || '').slice(0, 5);
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ ok: true, scenare: TEXTY.scenare(j) });
});

// POST /account/jazyk { jazyk } → přepnutí jazyka u účtu
router.post('/account/jazyk', requirePlayer, async (req, res, next) => {
  try {
    const j = String((req.body || {}).jazyk || '').slice(0, 5);
    if (TEXTY.JAZYKY.indexOf(j) < 0) return res.status(400).json({ error: stx(req)('server.takovy_jazyk_neznam') });
    const p = await prisma.gamePlayer.update({ where: { id: req.player.id }, data: { jazyk: j } });
    console.log('[game] hráč #' + p.id + ' přepnul jazyk na ' + j);
    res.json({ ok: true, jazyk: j, hlaska: TEXTY.t('jazyk.ulozeno', {}, j) });
  } catch (e) { next(e); }
});

router.post('/account/ping', requirePlayer, (req, res) => {
  // vidim říká, jestli má hráč hru na očích, nebo ji jen drží ve schované
  // záložce. Na burze se podle toho pozná, kdo odpoví hned.
  require('../services/game/presence').ping(req.player.id, (req.body || {}).vidim !== false);
  res.json({ ok: true });
});
// POST /account/chyba { chyby: [{typ,text,detail,kdy}] } — tiché hlášení chyb z klienta (jen pro admin hry)
router.post('/account/chyba', requirePlayer, async (req, res) => {
  try {
    const chyby = Array.isArray((req.body || {}).chyby) ? req.body.chyby : [];
    if (chyby.length) await require('../services/game/chyby').zapis(req.player, chyby);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false }); }
});
router.put('/account/state', requirePlayer, async (req, res, next) => {
  try {
    const st = (req.body || {}).state;
    if (!st || typeof st !== 'object') return res.status(400).json({ error: stx(req)('server.chybi_stav') });
    // Strop je pojistka proti nesmyslu, ne proti velké síti. Do hlášky i do logu
    // patří skutečná velikost — jinak hráč ani my nevíme, o kolik to přeteklo,
    // a ukládání se zastaví potichu. Přesně to dva dny drželo žebříčky na
    // starých číslech: stav přerostl 400 kB a každé uložení padalo na 413.
    const velikost = JSON.stringify(st).length;
    if (velikost > STAV_MAX) {
      console.warn('[game] hráč #' + req.player.id + ' má stav ' + Math.round(velikost / 1024)
        + ' kB, strop ' + Math.round(STAV_MAX / 1024) + ' kB — neuloženo');
      return res.status(413).json({ error: stx(req)('server.stav_moc_velky_kb',
        { p1: Math.round(velikost / 1024), p2: Math.round(STAV_MAX / 1024) }) });
    }
    // Verze: klient posílá tu, ze které vychází. Když se mezitím uložilo odjinud
    // (druhé zařízení), uložení odmítneme a pošleme zpátky novější stav — jinak
    // by si hráč přepsal to, co před chvílí udělal jinde.
    const rev = (req.body || {}).rev;
    const akt = Number(req.player.state_rev || 0);
    if (rev != null && Number(rev) !== akt) {
      return res.status(409).json({ error: stx(req)('server.hra_se_mezitim_ulozila_z_jineho'),
        rev: akt, state: req.player.state || null });
    }
    // Zaplacený balíček nesmí zmizet: co je vyzvednuté, musí být i v zástavě.
    const podlaha = await zastavaPodlaha(req.player.id);
    const mel = Math.max(0, Number(st.duvera) || 0);
    if (podlaha > mel) {
      st.duvera = podlaha;
      st.bank = Math.max(0, Number(st.bank) || 0) + (podlaha - mel);
      console.warn('[game] hráč', req.player.id, 'přišel o zástavu', podlaha - mel, '— doplněno');
    }
    // Mez přírůstku hotovosti. Zatím se jen měří: server si spočítá, kolik
    // hráč od posledního uložení vůbec mohl vydělat, a nesedící skok zapíše
    // do logu. Ukládání nebrzdí ani neblokuje — až bude z provozu vidět,
    // kolik to dělá planých poplachů, stane se z meze skutečný strop.
    require('../services/game/strop').zkontroluj(req.player, st)
      .catch((e) => console.warn('[game-strop]', e && e.message));

    const ted = new Date();
    // Doručenky, které si hra do tohohle stavu zapsala, potvrdíme ve STEJNÉ
    // transakci. Dřív se potvrzovaly zvlášť, a když to potvrzení nedošlo,
    // server poslal totéž znovu a hra si peníze připsala podruhé. Takhle
    // projde buď obojí, nebo nic: stav bez potvrzení neexistuje.
    const vyzvednuto = Array.isArray((req.body || {}).vyzvednuto)
      ? (req.body || {}).vyzvednuto.map((x) => parseInt(x, 10)).filter(Number.isFinite).slice(0, 100)
      : [];
    const [p] = await prisma.$transaction([
      prisma.gamePlayer.update({
        where: { id: req.player.id },
        data: Object.assign({ state: st, state_at: ted, state_rev: akt + 1 },
          odehranyCas(req.player, ted, (req.body || {}).aktivni !== false)),
      }),
    ].concat(vyzvednuto.length ? [
      prisma.gameDelivery.updateMany({
        where: { id: { in: vyzvednuto }, player_id: req.player.id, claimed_at: null },
        data: { claimed_at: ted },
      }),
    ] : []));
    res.json({ ok: true, rev: p.state_rev });
    // Hodnost dopočítáme až po odpovědi — hráč na vyplacení odměny nečeká a
    // kdyby se tu cokoli pokazilo, uložení hry to shodit nesmí.
    resHodnost(p, st).catch((e) => console.warn('[game-hodnost]', e && e.message));
  } catch (e) { next(e); }
});

// ─── Hodnost a odměny ────────────────────────────────────────────────────────
// Počítá se ze stavu uloženého na serveru, ne z toho, co o sobě hra tvrdí.
// Odměna se vyplácí jednou — hlídá to unikátní index v game_odmeny, ne tahle
// funkce; dvě uložení hry ve stejnou vteřinu jsou běžná věc.
async function nastaveniHodnosti() {
  const n = await nastaveni().catch(() => ({}));
  return {
    odmeny: String(n.hodnosti_odmeny == null ? '1' : n.hodnosti_odmeny) !== '0',
    zpetne: String(n.hodnosti_zpetne || '0') === '1',
  };
}
// Jednu odměnu připsat: hotovost přes frontu následků, karta rovnou do balíčku.
async function vyplatOdmenu(playerId, druh, kod, odmena, zpetne, platit) {
  const cash = (odmena && odmena.cash) || 0;
  const karta = (odmena && odmena.karta) || null;
  // Vkládá se přes createMany se skipDuplicates, ne přes create s odchycenou
  // výjimkou. Dvě uložení hry ve stejnou vteřinu jsou běžná věc a create by
  // při každém takovém souběhu vypsal prisma:error — v logu to pak přehluší
  // všechno ostatní, a log je jediné místo, kam se na provoz dá koukat.
  // Navíc: odchycená výjimka brala každou chybu databáze jako „už tam je",
  // takže skutečný výpadek by odměnu potichu zahodil. Takhle se počet rovná
  // nule jen u opravdového duplikátu a cokoli jiného vybouchne nahlas.
  const vlozeno = await prisma.gameOdmena.createMany({
    data: [{ player_id: playerId, druh, kod, cash, karta,
      zpetne: !!zpetne, vyplaceno: !!platit }],
    skipDuplicates: true,
  });
  if (!vlozeno.count) return false;        // už tam je
  if (!platit) return false;
  await pripisOdmenu(playerId, druh, kod, cash, karta);
  return true;
}
async function pripisOdmenu(playerId, druh, kod, cash, karta) {
  // Text se neukládá jako hotová věta, ale jako kód a údaje — složí se až
  // u toho, kdo doručenku čte, v jeho jazyce. popis se plní taky, aby starší
  // verze hry a administrace pořád něco viděly.
  const textKod = druh === 'hodnost' ? 'odmena.hodnost' : 'odmena.odznak';
  const textData = { kod };
  const popis = TEXTY.t(textKod, { nazev: nazevOdmeny(druh, kod, TEXTY.ZDROJ) }, TEXTY.ZDROJ);
  if (cash > 0) {
    await prisma.gameDelivery.create({ data: { player_id: playerId, kind: 'cash',
      amount: cash, popis, text_kod: textKod, text_data: textData } });
  }
  if (karta) await prisma.gameCard.create({ data: { player_id: playerId, kind: karta } });
  console.log('[game-hodnost] ' + popis + ' → hráč ' + playerId
    + (cash ? ' · ' + cash + ' L$' : '') + (karta ? ' · karta ' + karta : ''));
}
// Dopočítat hodnost po uložení hry a doplatit, co k ní patří.
async function resHodnost(p, st) {
  const cfg = await nastaveniHodnosti();
  // Jmění počítá server z vlastních dat. Vychází o něco níž než dřívější
  // číslo ze stavu hry, protože nezapočítává přípravy ploch, pobočky a
  // četu — proto hodnost nikdy nejde dolů: jednou dosažená meta se
  // neztrácí. Bez toho by tři hráči po přepnutí spadli o stupeň a brali
  // by to jako trest za něco, co neudělali.
  const jmeniServ = await JMENI.proHrace(p.id, st).catch(() => cisteJmeni(st));
  const spoctena = hodnost(jmeniServ);
  const prvni = !p.hodnost;          // hráče vidíme s hodností poprvé
  const stary = HODNOSTI.findIndex((x) => x.id === p.hodnost);
  const h = zmrazena(p.hodnost, spoctena);
  if (h.id !== p.hodnost) {
    await prisma.gamePlayer.update({ where: { id: p.id }, data: { hodnost: h.id } })
      .catch(() => {});
  }
  await resOdznaky(p, st, cfg).catch((e) => console.warn('[game-odznak]', e && e.message));
  if (!cfg.odmeny) return;
  // Hodnost může i klesnout (prodal síť, zadlužil se) — odměnu mu nebereme,
  // ale ani znovu nevyplácíme: řádek v game_odmeny už tam je.
  for (let i = 1; i <= h.stupen; i++) {
    const st2 = HODNOSTI[i];
    if (!st2.odmena) continue;
    // Stupně, které měl hráč už při zavedení hodností, jsou „zpětné" a platí se
    // jen tehdy, když to majitel pustí. Nové stupně se platí vždycky.
    const jeZpetny = prvni || (stary >= 0 && i <= stary);
    await vyplatOdmenu(p.id, 'hodnost', st2.id, st2.odmena, jeZpetny, jeZpetny ? cfg.zpetne : true);
  }
  // Když majitel zpětné vyplácení pustí dodatečně, doplatíme, co leží nevyplacené.
  if (cfg.zpetne) await doplatZpetne(p.id);
}

// ─── Odznaky ─────────────────────────────────────────────────────────────────
// Část podmínek umí ověřit server z databáze (půjčky, podíly, země, pozvaní).
// Zbytek — kolik hovorů vzal hráč sám, jestli stavěl v krizi — je ve stavu hry,
// a ten je tak důvěryhodný jako celá hra: počítá se v prohlížeči. Odměnou je
// proto karta, ne hotovost; za jednu kartu nemá smysl nic obcházet.
const ODZNAK_PAUZA_MS = 5 * 60000;
const odznakyKdy = new Map();
const HVEZDY_TYDEN = 7 * 86400e3;
const PUJCKA_MIN_MESICU = 6;

async function splneneOdznaky(p, st) {
  const ja = p.id;
  const [pujcky, podily, zeme, pozvani] = await Promise.all([
    prisma.gameLoan.count({ where: { lender_id: ja, stav: 'splaceno', splaceno: { gte: PUJCKA_MIN_MESICU } } }),
    prisma.gameEquity.findMany({ where: { investor_id: ja }, select: { firma_id: true, vyplaceno: true } }),
    zemeHracu().catch(() => ({})),
    prisma.gamePlayer.findMany({ where: { invited_by_id: ja, disabled: false },
      select: { state: true }, take: 50 }),
  ]);
  const firmy = new Set(podily.map((e) => e.firma_id));
  const neslo = podily.some((e) => (e.vyplaceno || 0) !== 0);
  const zemi = (zeme[ja] || []).length;
  const postavili = pozvani.filter((h) => Array.isArray((h.state || {}).units) && h.state.units.length > 0).length;
  const out = [];
  if (pujcky > 0) out.push('banker');
  if (firmy.size >= 3 && neslo) out.push('investor');
  if (zemi >= 3) out.push('cestovatel');
  if (st.hvezdyOd && Date.now() - Number(st.hvezdyOd) >= HVEZDY_TYDEN) out.push('hvezdy');
  if ((st.hovoruJa || 0) >= 50) out.push('spojovatel');
  if (st.krizovka) out.push('krizovka');
  if (st.mrchozrout) out.push('mrchozrout');
  if (postavili >= 3) out.push('naborar');
  return out;
}
async function resOdznaky(p, st, cfg) {
  const ted = Date.now();
  if (ted - (odznakyKdy.get(p.id) || 0) < ODZNAK_PAUZA_MS) return;
  odznakyKdy.set(p.id, ted);
  const mam = await prisma.gameOdmena.findMany({ where: { player_id: p.id, druh: 'odznak' },
    select: { kod: true } });
  const uz = new Set(mam.map((x) => x.kod));
  const splnene = await splneneOdznaky(p, st);
  for (const kod of splnene) {
    if (uz.has(kod)) continue;
    const o = ODZNAK[kod];
    if (!o) continue;
    await vyplatOdmenu(p.id, 'odznak', kod, o.odmena, false, !!cfg.odmeny);
  }
}

async function doplatZpetne(playerId) {
  const dluh = await prisma.gameOdmena.findMany({
    where: { player_id: playerId, vyplaceno: false }, take: 30 });
  for (const o of dluh) {
    const r = await prisma.gameOdmena.updateMany({
      where: { id: o.id, vyplaceno: false }, data: { vyplaceno: true } });
    if (!r.count) continue;          // mezitím doplatil jiný požadavek
    await pripisOdmenu(playerId, o.druh, o.kod, o.cash, o.karta);
  }
}

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

// ─── Sledování na Instagramu ─────────────────────────────────────────────────
// Za sledování profilu dostane hráč tři Expresní dovozy. Že nás někdo opravdu
// sleduje, se ověřit nedá — Instagram na to žádné rozhraní nemá — takže to
// stojí na důvěře a vydá se to jednou za účet. Je to cena za reklamu, ne
// prodej: karty jsou dárek (purchase_id zůstává prázdné).
const IG_ODKAZ = 'https://www.instagram.com/laundromattycoon';
const IG_KARET = 3;
router.post('/account/instagram', requirePlayer, async (req, res, next) => {
  try {
    if (req.player.instagram_at) {
      return res.status(409).json({ error: stx(req)('server.karticky_za_instagram_uz_sis_vyzvedl') });
    }
    await prisma.gamePlayer.update({
      where: { id: req.player.id }, data: { instagram_at: new Date() },
    });
    await prisma.gameCard.createMany({
      data: Array.from({ length: IG_KARET }, () => ({ player_id: req.player.id, kind: 'rush' })),
    });
    console.log('[game] instagram: hrac ' + req.player.id + ' dostal ' + IG_KARET + 'x rush');
    res.json({ ok: true, karet: IG_KARET, owned: (await pub(req.player)).cards });
  } catch (e) { next(e); }
});

// Za sledování stránky na Facebooku přibude do banky milion — rámec i zástava,
// stejně jako u koupeného balíčku. Vydá se jednou za účet a stejně jako
// u Instagramu to stojí na důvěře, ověřit to nejde.
const FB_ODKAZ = 'https://www.facebook.com/share/1M6soaMidv/';
const FB_KIND = 'cash_fb';
router.post('/account/facebook', requirePlayer, async (req, res, next) => {
  try {
    if (req.player.facebook_at) {
      return res.status(409).json({ error: stx(req)('server.darek_za_facebook_uz_sis_vyzvedl') });
    }
    await prisma.gamePlayer.update({
      where: { id: req.player.id }, data: { facebook_at: new Date() },
    });
    await prisma.gameCard.create({ data: { player_id: req.player.id, kind: FB_KIND } });
    const c = await item(FB_KIND);
    console.log('[game] facebook: hrac ' + req.player.id + ' dostal ' + FB_KIND);
    res.json({ ok: true, laundry: (c && c.laundry) || CASH[FB_KIND].laundry,
      owned: (await pub(req.player)).cards });
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
    // Měna se řídí jazykem hráče. Ceny v ceníku jsou v haléřích, převádí se
    // až tady — a stejnou funkcí, jakou pak Stripe počítá, co strhne.
    const prev = await MENY.prevodnik(TEXTY.jazykHrace(p));
    res.json({
      ok: true, mena: prev.mena, mena_znak: prev.znak, mena_des: prev.des, mena_pred: prev.pred,
      catalog: await catalogPublic(prev), cash: await cashPublic(prev),
      linka: await linkaPublic(prev),
      kampan: await kampanPublic(prev),
      onboarding_rychly: await rychlyOnboarding(),
      ramec: await ramecPublic(p ? p.id : null, prev),
      nick_pauza_ms: await nickPauzaMs(),
      instagram: { odkaz: IG_ODKAZ, karet: IG_KARET, vzato: p ? !!p.instagram_at : false },
      facebook: { odkaz: FB_ODKAZ, laundry: CASH[FB_KIND].laundry, vzato: p ? !!p.facebook_at : false },
      subs: await subsPublic(prev), predplatne: await predplatneHrace(p),
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
  rush: (t) => ({ effect: 'rush', msg: t('karta.rush_hotovo') }),
  traffic: (t) => ({ effect: 'traffic', add: 0.15, msg: t('karta.traffic_hotovo') }),
  connect: (t) => ({ effect: 'connect', discount: 0.4, msg: t('karta.connect_hotovo') }),
  credit: (t) => ({ effect: 'credit', rate_drop: 0.02, room_add: 1000000, msg: t('karta.credit_hotovo') })
};
router.post('/cards/use', requirePlayer, async (req, res, next) => {
  try {
    const kind = s((req.body || {}).kind, 24);
    if (!ALL[kind] && kind !== CASH_CUSTOM) return res.status(400).json({ error: stx(req)('server.takova_karta_neni') });
    // Balíček rámce není spotřební karta — je to trvalé odemčení, nespaluje se.
    if (RAMEC[kind]) return res.status(409).json({ error: stx(req)('server.balicek_ramce_se_nepouziva_plati_trvale') });
    const card = await prisma.gameCard.findFirst({
      where: { player_id: req.player.id, kind, used_at: null }, orderBy: { id: 'asc' }, select: { id: true, amount: true }
    });
    if (!card) return res.status(409).json({ error: stx(req)('server.tuhle_kartu_nemas') });
    // updateMany s podmínkou used_at: null — dvojklik ani dvě záložky kartu nespotřebují dvakrát
    const done = await prisma.gameCard.updateMany({
      where: { id: card.id, used_at: null },
      data: { used_at: new Date(), used_on: s((req.body || {}).on, 80) || null }
    });
    if (!done.count) return res.status(409).json({ error: stx(req)('server.karta_uz_byla_pouzita') });
    let result;
    if (kind === CASH_CUSTOM) {
      const castka = Math.max(0, card.amount || 0);
      result = { effect: 'cash', amount: castka, msg: stx(req)('karta.na_ucet_pristalo', { penize: castka }) };
    } else if (CASH[kind]) {
      // Zakoupené balíčky dobíjejí rámec v bance, ne hotovost — proto se to
      // jmenuje „Dobít banku". Hráč si pak peníze půjčí, jak potřebuje.
      const c = await item(kind);
      const castka = (c && c.laundry) || CASH[kind].laundry;
      result = { effect: 'ramec', amount: castka,
        msg: stx(req)('karta.ramec_se_zvedl', { penize: castka }) };
    } else if (LINKA[kind]) {
      const dnu = LINKA[kind].dnu || 1;
      const t = stx(req);
      const doba = dnu === 1 ? t('obecne.den') : dnu === 7 ? t('obecne.tyden')
        : dnu === 30 ? t('obecne.mesic') : dnu === 365 ? t('obecne.rok')
          : t('obecne.dnu', { n: dnu });
      result = { effect: 'linka', dnu,
        msg: LINKA[kind].stary
          ? t('karta.linka_prevedena_na_tyden')
          : t('karta.linka_bezi', { p1: doba }) };
    } else if (KAMPAN[kind]) {
      const k = KAMPAN[kind];
      result = { effect: 'kampan', add: k.add, dnu: k.dnu,
        msg: stx(req)('karta.kampan_bezi', { p1: Math.round(k.add * 100), p2: k.dnu }) };
    } else {
      result = EFFECTS[kind](stx(req));
    }
    dropPodlaha(req.player.id);
    res.json({ ok: true, card: kind, result, owned: (await pub(req.player)).cards });
  } catch (e) { next(e); }
});


// ─── Žebříčky ────────────────────────────────────────────────────────────────
// Tři pohledy: kdo má nejvíc prádlomatů (to ví server jistě, z obsazených míst),
// kdo nejvíc vydělává a kdo nejvíc pozval. Zisk a pozvánky čteme z uloženého
// stavu, který píše prohlížeč hráče — ber je jako hlášené, ne ověřené.
// Žebříček ukazuje všechny hráče, ne jen špičku — kdo je sedmnáctý, chce to
// vidět taky. Strop je jen pojistka, aby odpověď nerostla donekonečna.
const ZEB_TOP = 500;
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
    // Jen místa, kde opravdu stojí stroj. Koupený pozemek bez prádlomatu
    // vlaječku nedělá — hráč tam zatím nic neprovozuje.
    prisma.gameSpotClaim.findMany({ where: { model: { not: '' } },
      select: { player_id: true, area_key: true } }),
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
// ─── Dopočet času, který hráč prohrál mimo hru ───────────────────────────────
// Hra počítá v prohlížeči, server drží jen poslední uložený snímek. Hráč, co
// zrovna nehraje, měl proto v žebříčku jmění hotovost k poslednímu přihlášení
// — a po návratu skokem přeskočil půlku tabulky, protože mu tick() dopočítal
// celou dobu naráz. Tady se ta mezera dopočítá dopředu: hotovost naroste
// sazbou „co mu měsíčně zbyde" za čas, který od uložení uběhl. Je to stejná
// sazba, s jakou počítá tick() — earned = (roční zisk − režie) × roky.
//
// Odhad to zůstává, ne výpis z účtu: nezná poruchy, katastrofy, krize ani
// sezónnost, které hráči naskočí až při návratu, takže se od skutečnosti liší
// o jednotky procent. Přesné to z principu být nemůže — pravidla, podle
// kterých se čas dopočítává, zná jen prohlížeč. Pro pořadí v žebříčku to ale
// stačí a je to nesrovnatelně blíž pravdě než zmrzlé číslo.
const DOPOCET_MAX_MS = 14 * 86400e3;   // dál je odhad moc divoký, radši se zastaví
function dopoctiStav(st, naposledy) {
  if (!st || !naposledy) return { st, odhad: false, od: 0, pridano: 0 };
  const od = Math.max(0, Date.now() - new Date(naposledy).getTime());
  // Kdo hraje teď, má stav čerstvý — není co dopočítávat.
  if (od < 60000) return { st, odhad: false, od, pridano: 0 };
  const mesicne = zbydeMesicne(st);
  if (!mesicne) return { st, odhad: false, od, pridano: 0 };
  const pridej = Math.round(mesicne * (Math.min(od, DOPOCET_MAX_MS) / MESIC_MS));
  if (!pridej) return { st, odhad: false, od, pridano: 0 };
  // Mělká kopie: měníme jedno číslo a uložený stav zašpinit nechceme.
  return { st: Object.assign({}, st, { cash: (Number(st.cash) || 0) + pridej }),
    odhad: true, od, pridano: pridej };
}

// Žebříček se drží v paměti po oknech přibitých na hodiny, ne na „třicet
// vteřin od posledního dotazu". Dřív si každý hráč načetl svůj vlastní snímek
// podle toho, kdy se zrovna zeptal, a dva telefony vedle sebe pak ukazovaly
// jiná čísla. Teď připadne každý dotaz do stejného okna a všichni v něm
// dostanou tentýž žebříček — a překlopí se jim naráz.
const ZEB_OKNO = 30000;
let _zeb = { okno: -1, data: null };
function dropZeb() { _zeb = { okno: -1, data: null }; }
async function zebricky() {
  const okno = Math.floor(Date.now() / ZEB_OKNO);
  if (_zeb.okno === okno && _zeb.data) return _zeb.data;
  const [mista, hraci, zemeMap, majetek] = await Promise.all([
    // Počítají se postavené prádlomaty, ne zabraná místa — prázdný pozemek
    // do žebříčku nepatří.
    prisma.gameSpotClaim.groupBy({ by: ['player_id', 'nick'], _count: { _all: true },
      where: { model: { not: '' } } }),
    prisma.gamePlayer.findMany({
      where: { disabled: false, state: { not: null } },
      orderBy: { state_at: 'desc' }, take: 500,
      select: { id: true, nick: true, company: true, emblem: true, state: true, state_at: true },
    }),
    // Kdyby sloupec se zemí ještě nebyl v databázi, žebříček kvůli vlaječkám
    // spadnout nesmí — prostě se nevykreslí.
    zemeHracu().catch(() => ({})),
    // Majetek ze serverových dat: stroje na místech, koupená zem, sklad a
    // zboží na cestě. Dva dotazy na celý žebříček, ne pět set.
    JMENI.majetekVsech().catch(() => new Map()),
  ]);
  // Jmění hráče = serverový majetek plus jeho hotovost mínus dluh. Kdyby
  // se majetek nenačetl, spadne se na dřívější číslo ze stavu hry — žebříček
  // kvůli tomu padat nesmí.
  const jmeniHrace = (h, st) => {
    const m = majetek.get(h.id);
    return m ? m.celkem + JMENI.hotovostADluh(st) : cisteJmeni(st);
  };
  // Firmy doplníme k nickům z míst — v žebříčku chceme vidět, kdo je kdo.
  const firmy = await firmyMapa();
  // Do žebříčku prádlomatů patří každý, kdo hru rozehrál — i ten, kdo zatím
  // nic nepostavil. Jinak polovina hráčů v seznamu vůbec není a nedá se
  // poznat, že tam jsou. Nula je taky výsledek.
  const hodnostHrace = new Map();
  const pocetMist = new Map();
  mista.forEach((m) => pocetMist.set(m.player_id, m._count._all));
  const poMistech = [];
  const viden = new Set();
  hraci.forEach((h) => {
    if (!(h.state || {}).profile) return;        // kdo ani nezačal, do žebříčku nepatří
    viden.add(h.id);
    // Hodnost počítáme ze stavu uloženého na serveru — ne z toho, co o sobě
    // tvrdí prohlížeč. V žebříčku a na burze to má být záruka, ne jmenovka.
    hodnostHrace.set(h.id, hodnost(jmeniHrace(h, h.state || {})).id);
    poMistech.push({ id: h.id, nick: h.nick, firma: h.company || (h.nick + ' s.r.o.'),
      znak: h.emblem || null, zeme: zemeMap[h.id] || [], hodnota: pocetMist.get(h.id) || 0,
      hodnost: hodnostHrace.get(h.id) });
  });
  // Kdyby někomu místa patřila, ale neměl uložený stav, ať nezmizí.
  mista.forEach((m) => {
    if (viden.has(m.player_id)) return;
    poMistech.push({ id: m.player_id, nick: m.nick,
      firma: firmy[m.player_id] && firmy[m.player_id].firma,
      znak: firmy[m.player_id] && firmy[m.player_id].znak,
      zeme: zemeMap[m.player_id] || [], hodnota: m._count._all });
  });
  poMistech.sort((a, b) => b.hodnota - a.hodnota);
  const seSiti = poMistech.filter((x) => x.hodnota > 0).length;

  const zisk = [], pozvanky = [], jmeni = [], hvezdy = [];
  hraci.forEach((h) => {
    const st = h.state || {};
    // To, co hráči opravdu zbyde — stejně jako mu to svítí v hlavičce hry.
    const mesicne = zbydeMesicne(st);
    const fi = h.company || (h.nick + ' s.r.o.');
    const zm = zemeMap[h.id] || [];
    const hd = hodnostHrace.get(h.id) || hodnost(jmeniHrace(h, st)).id;
    if (mesicne > 0) zisk.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm, hodnota: Math.round(mesicne), hodnost: hd });
    if (st.refs > 0) pozvanky.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm, hodnota: st.refs, hodnost: hd });
    // Do žebříčku jmění patří i ten, kdo je v minusu — právě to je vidět.
    if (st.profile) {
      // Jmění se dopočítá k teď, aby neaktivní hráč nevisel na starém čísle.
      const dop = dopoctiStav(st, h.state_at);
      const cj = jmeniHrace(h, dop.st);
      // Hodnost zůstává z uloženého stavu: je to meta, kterou hra hráči
      // opravdu udělila. Z dopočítaného jmění by mu žebříček maloval metu,
      // kterou ještě nedostal.
      jmeni.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm,
        hodnota: cj, hodnost: hd, odhad: dop.odhad, naposledy: h.state_at });
    }
    // Kdo ještě žádný hovor neměl, nemá se podle čeho hodnotit — startuje se na třech.
    if (st.profile && (st.hovoru || 0) > 0) {
      hvezdy.push({ id: h.id, nick: h.nick, firma: fi, znak: h.emblem || null, zeme: zm,
        hodnota: hvezdyZPovesti(st), hodnost: hd });
    }
  });
  zisk.sort((a, b) => b.hodnota - a.hodnota);
  pozvanky.sort((a, b) => b.hodnota - a.hodnota);
  jmeni.sort((a, b) => b.hodnota - a.hodnota);
  hvezdy.sort((a, b) => b.hodnota - a.hodnota);

  _zeb = { okno, data: { pradlomaty: poMistech, zisk, pozvanky, jmeni, hvezdy, seSiti,
    // Ke kterému okamžiku žebříček platí. Posílá se do hry, ať je rozdíl mezi
    // dvěma telefony vysvětlený, a ne záhadný.
    aktualizovano: new Date(okno * ZEB_OKNO).toISOString() } };
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
    prisma.gameSpotClaim.findMany({ where: { model: { not: '' } },
      select: { area_key: true, model: true, player_id: true } }),
    prisma.gameArea.findMany({ where: { country: { not: null } }, select: { key: true, country: true } }),
  ]);
  const kod = {};
  mesta.forEach((m) => { if (m.country && m.country !== 'xx') kod[m.key] = m.country; });
  const out = {};
  zabory.forEach((z) => {
    const cc = kod[z.area_key];
    if (!cc) return;
    const r = out[cc] || (out[cc] = { kod: cc, mini: 0, flex: 0, max: 0, celkem: 0,
      hraci: new Set(), podle: {} });
    const m = String(z.model || 'mini').toLowerCase();
    if (m === 'flex' || m === 'max') r[m] += 1; else r.mini += 1;
    r.celkem += 1;
    r.hraci.add(z.player_id);
    r.podle[z.player_id] = (r.podle[z.player_id] || 0) + 1;
  });
  // Kdo má v zemi nejvíc prádlomatů — první tři. Při shodě je výš ten, kdo tam
  // byl dřív; to poznáme podle nižšího id hráče.
  const TOP = 3;
  const spicka = {};
  Object.keys(out).forEach((k) => {
    const p = out[k].podle;
    spicka[k] = Object.keys(p)
      .map((id) => ({ id: Number(id), pocet: p[id] }))
      .sort((a, b) => b.pocet - a.pocet || a.id - b.id)
      .slice(0, TOP);
  });
  const ids = [...new Set(Object.keys(spicka).flatMap((k) => spicka[k].map((x) => x.id)))];
  const hraci = ids.length
    ? await prisma.gamePlayer.findMany({ where: { id: { in: ids } },
        select: { id: true, nick: true, company: true, emblem: true } })
    : [];
  const kdo = {};
  hraci.forEach((h) => { kdo[h.id] = h; });
  const ven = (x) => {
    const h = kdo[x.id];
    return h ? { nick: h.nick, firma: h.company || (h.nick + ' s.r.o.'),
      znak: h.emblem || null, pocet: x.pocet } : null;
  };
  return Object.keys(out).map((k) => {
    const top = (spicka[k] || []).map(ven).filter(Boolean);
    return { kod: out[k].kod, mini: out[k].mini, flex: out[k].flex,
      max: out[k].max, celkem: out[k].celkem, hracu: out[k].hraci.size,
      // kral zůstává kvůli starším verzím hry, co ještě nečtou top
      kral: top[0] || null, top };
  }).sort((a, b) => b.celkem - a.celkem || a.kod.localeCompare(b.kod));
}

router.get('/leaderboard', async (req, res, next) => {
  try {
    const p = await currentPlayer(req);
    const [z, zeme] = await Promise.all([zebricky(), zemeSPocty()]);
    const orez = (l) => l.slice(0, ZEB_TOP).map((x, i) => ({ poradi: i + 1, id: x.id, nick: x.nick,
      firma: x.firma || (x.nick + ' s.r.o.'), znak: x.znak || null, zeme: x.zeme || [],
      // Hodnost jde ven s každým řádkem — v žebříčku ji hra ukazuje místo nicku.
      hodnota: x.hodnota, hodnost: x.hodnost || null, ja: !!(p && x.id === p.id) }));
    res.json({ ok: true,
      pradlomaty: orez(z.pradlomaty), zisk: orez(z.zisk), pozvanky: orez(z.pozvanky),
      jmeni: orez(z.jmeni), hvezdy: orez(z.hvezdy), zeme: zeme,
      aktualizovano: z.aktualizovano || null,
      ja: p ? { pradlomaty: moje(z.pradlomaty, p.id), zisk: moje(z.zisk, p.id),
        pozvanky: moje(z.pozvanky, p.id), jmeni: moje(z.jmeni, p.id),
        hvezdy: moje(z.hvezdy, p.id) } : null,
      hracu: z.pradlomaty.length, se_siti: z.seSiti });
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
  // Nabídka pronájmu pozemku je naopak veřejná — je to inzerát, má ji vidět
  // každý. Stejně tak kdo si pozemek pronajal.
  pronajem: (c.pozemek && c.pronajem_cena > 0 && !c.najemce_id)
    ? { cena: c.pronajem_cena, sit: !!c.pronajem_sit } : null,
  najemce: c.najemce_id
    ? { id: c.najemce_id, nick: c.najemce_nick,
        firma: (firmy && firmy[c.najemce_id] && firmy[c.najemce_id].firma) || (c.najemce_nick + ' s.r.o.'),
        cena: c.pronajem_cena, sit: !!c.pronajem_sit, ja: c.najemce_id === me }
    : null,
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
    if (!spot || !area || (!model && !b.pozemek)) return res.status(400).json({ error: stx(req)('server.chybi_misto') });
    const taken = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (taken) {
      return res.status(409).json({
        error: taken.player_id === req.player.id ? stx(req)('server.tady_uz_stojis')
        : stx(req)('server.misto_obsadil', { p1: taken.nick }),
        occupied: claimPub(taken, req.player.id, await firmyMapa()),
      });
    }
    const pozemek = !!b.pozemek;
    // Cenu země si počítá server sám z otisku místa a skóre, které posílá
    // hra. Skóre jde zfalšovat, ale lukrativnost z něj roste jen v pevném
    // rozsahu, takže nejvíc, co si tím hráč přilepší, je dvojnásobek — a to
    // jen u pozemku, na kterém nic nestojí.
    const cenaZeme = pozemek
      ? POZEMKY.cena(spot, Math.max(0, Math.min(100, Math.round(Number(b.score) || 0))))
      : null;
    const vaz = pozemek ? 0 : mesicu(b.doba_mesicu, VAZANOST_MAX);
    const vyp = pozemek ? 1 : Math.max(1, mesicu(b.vypoved_mesicu, VYPOVED_MAX));
    // Stroj ze skladu se bere PŘED zabráním místa. Kdyby se bralo potom,
    // odmítnutá stavba by po sobě nechala zabrané místo se strojem, který
    // nikdy nevznikl — a to je horší než stroj navíc.
    const sklad = await najdiStroj(req.player.id, model, spot);
    if (!sklad.ok) return res.status(409).json({ error: stx(req)('server.takovy_stroj_nemas_skladem') });
    const c = await prisma.gameSpotClaim.create({
      data: { spot_id: spot, area_key: area, player_id: req.player.id, nick: req.player.nick,
        model, rent: pozemek ? 0 : rent, name: s(b.name, 160) || null,
        lat: Number(b.lat) || null, lon: Number(b.lon) || null, pozemek, cena: cenaZeme,
        vazano_do: vaz ? new Date(Date.now() + vaz * MESIC_MS) : null, vypoved_mesicu: vyp },
    });
    await oznacPostaveny(sklad.id, spot);
    // Od téhle chvíle je místo zasíťované napořád, i kdyby ho hráč zítra opustil.
    try {
      await prisma.gameSpotBuilt.upsert({
        where: { spot_id: spot }, create: { spot_id: spot, area_key: area }, update: {},
      });
    } catch (e) { console.warn('[game] zasíťování místa:', e.message); }
    // Provize se už neplatí za stavbu, ale za nákup stroje — viz /account/nakup.
    res.json({ ok: true, spot: claimPub(c, req.player.id, await firmyMapa()) });
  } catch (e) {
    if (e && e.code === 'P2002') return res.status(409).json({ error: stx(req)('server.tohle_misto_prave_nekdo_obsadil') });
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
    if (!cur) return res.status(404).json({ error: stx(req)('server.tohle_misto_je_volne_stav_rovnou') });
    if (cur.player_id === req.player.id) return res.status(409).json({ error: stx(req)('server.tady_stojis_ty_sam') });
    // Vlastní pozemek se nepřeplácí — není komu nabízet nájem. Tohle hráči
    // řekneme na rovinu, ať zbytečně neplatí za cestu; je to veřejná informace.
    if (cur.pozemek) {
      return res.status(409).json({ ok: false, won: false, nelze: true,
        error: stx(req)('server.tohle_misto_stoji_na_vlastnim_pozemku') });
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
      return res.status(409).json({ ok: false, won: false, fee: BID_FEE, error: stx(req)('server.majitel_pozemku_tvoji_nabidku_odmitl_najemce') });
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
    if (!spot || !model) return res.status(400).json({ error: stx(req)('server.chybi_stroj') });
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.tohle_misto_ti_nepatri_2') });
    if (cur.model) return res.status(409).json({ error: stx(req)('server.tady_uz_neco_stoji') });
    if (cur.najemce_id) return res.status(409).json({ error: stx(req)('server.pozemek_mas_pronajaty_nejdriv_ukonci_najem') });
    const sklad = await najdiStroj(req.player.id, model, spot);
    if (!sklad.ok) return res.status(409).json({ error: stx(req)('server.takovy_stroj_nemas_skladem') });
    const upd = await prisma.gameSpotClaim.update({ where: { spot_id: spot }, data: { model } });
    await oznacPostaveny(sklad.id, spot);
    res.json({ ok: true, spot: claimPub(upd, req.player.id, await firmyMapa()) });
  } catch (e) { next(e); }
});

// POST /spots/dorovnat { spot_id } — nájemce dorovná nabídku konkurenta a zůstává.
// Tohle je ta pojistka, kvůli které má smysl si vyjednat delší výpovědní dobu.
router.post('/spots/dorovnat', requirePlayer, async (req, res, next) => {
  try {
    const spot = s((req.body || {}).spot_id, 120);
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.tohle_misto_ti_nepatri_3') });
    if (!cur.vypoved_do) return res.status(409).json({ error: stx(req)('server.zadna_vypoved_tu_nebezi') });
    if (new Date(cur.vypoved_do).getTime() <= Date.now()) {
      return res.status(409).json({ error: stx(req)('server.vypovedni_doba_uz_ubehla') });
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

// ─── Pronájem vlastního pozemku jinému hráči ────────────────────────────────
// Kdo má zem, nemusí na ní stavět — může ji pronajmout. Buď jako holou parcelu
// (nájemce si přípojky vybuduje a zaplatí sám), nebo s připravenou plochou; za
// tu si majitel řekne víc, protože do ní dal peníze. Nájem se majiteli připisuje
// po herních měsících, stejně jako provize ze sítě.
const NAJEM_MAX = 5000000;

// POST /spots/pronajem { spot_id, cena, sit } — vypsat nebo stáhnout nabídku.
router.post('/spots/pronajem', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120);
    const cena = Math.max(0, Math.min(NAJEM_MAX, Math.round(Number(b.cena) || 0)));
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.tenhle_pozemek_ti_nepatri') });
    if (!cur.pozemek) return res.status(409).json({ error: stx(req)('server.pronajmout_jde_jen_vlastni_pozemek') });
    if (cur.najemce_id) return res.status(409).json({ error: stx(req)('server.pozemek_uz_je_pronajaty') });
    if (cur.model) return res.status(409).json({ error: stx(req)('server.nejdriv_odvez_vlastni_pradlomat') });
    const upd = await prisma.gameSpotClaim.update({
      where: { spot_id: spot },
      data: { pronajem_cena: cena > 0 ? cena : null, pronajem_sit: cena > 0 ? !!b.sit : false },
    });
    res.json({ ok: true, spot: claimPub(upd, req.player.id, await firmyMapa()) });
  } catch (e) { next(e); }
});

// POST /spots/najmout { spot_id } — cizí hráč si pozemek pronajme.
router.post('/spots/najmout', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120);
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || !cur.pozemek) return res.status(404).json({ error: stx(req)('server.takovy_pozemek_neexistuje') });
    if (cur.player_id === req.player.id) return res.status(409).json({ error: stx(req)('server.tohle_je_tvuj_vlastni_pozemek') });
    if (!cur.pronajem_cena) return res.status(409).json({ error: stx(req)('server.majitel_pozemek_nenabizi') });
    if (cur.najemce_id) return res.status(409).json({ error: stx(req)('server.pozemek_si_mezitim_pronajal_nekdo_jiny') });
    const ted = new Date();
    const upd = await prisma.gameSpotClaim.update({
      where: { spot_id: spot },
      data: { najemce_id: req.player.id, najemce_nick: req.player.nick, najem_od: ted, najem_do: ted },
    });
    console.log('[game] pronájem pozemku:', spot, cur.nick, '→', req.player.nick, cur.pronajem_cena + ' L$');
    res.json({ ok: true, spot: claimPub(upd, req.player.id, await firmyMapa()) });
  } catch (e) { next(e); }
});

// POST /spots/najem-konec { spot_id } — nájemce se pozemku vzdá, nebo ho majitel
// uvolní. Stroj nájemce stojí na vlastním záboru, ten se maže zvlášť přes release.
router.post('/spots/najem-konec', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120);
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur) return res.status(404).json({ error: stx(req)('server.takovy_pozemek_neexistuje_2') });
    const muj = cur.player_id === req.player.id, najemce = cur.najemce_id === req.player.id;
    if (!muj && !najemce) return res.status(409).json({ error: stx(req)('server.s_timhle_pozemkem_nemas_co_do') });
    // Co nájemci doběhlo do konce, majitel ještě dostane.
    await dorovnejNajmy({ id: cur.player_id, nick: cur.nick });
    const upd = await prisma.gameSpotClaim.update({
      where: { spot_id: spot },
      data: { najemce_id: null, najemce_nick: null, najem_od: null, najem_do: null,
        pronajem_cena: muj ? null : cur.pronajem_cena, pronajem_sit: muj ? false : cur.pronajem_sit },
    });
    res.json({ ok: true, spot: claimPub(upd, req.player.id, await firmyMapa()) });
  } catch (e) { next(e); }
});

// Dopočítá nájmy, které majiteli ještě nebyly připsané. Běží při otevření hry
// i záložky Já — stejně jako provize, aby se nic neztratilo, i když se majitel
// týden nepodívá.
async function dorovnejNajmy(majitel) {
  if (!majitel || !majitel.id) return 0;
  const rows = await prisma.gameSpotClaim.findMany({
    where: { player_id: majitel.id, najemce_id: { not: null } },
  });
  let celkem = 0;
  for (const c of rows) {
    const cena = Math.max(0, Math.round(c.pronajem_cena || 0));
    if (!cena) continue;
    const od = new Date(c.najem_do || c.najem_od || c.created_at).getTime();
    const mesicu = Math.floor((Date.now() - od) / MESIC_MS);
    if (mesicu < 1) continue;
    const castka = cena * mesicu;
    await prisma.gameDelivery.create({
      data: { player_id: majitel.id, kind: 'cash', amount: castka,
        spot_id: 'najem:' + c.spot_id + ':' + Math.round(od / MESIC_MS),
        text_kod: 'dor.najem', text_data: { penize: castka, p1: (c.name || 'pozemek'), p2: c.najemce_nick },
        popis: 'Nájem ' + castka.toLocaleString('cs-CZ') + ' L$ — ' + (c.name || 'pozemek')
          + ' (' + c.najemce_nick + ')' },
    });
    await prisma.gameSpotClaim.update({
      where: { spot_id: c.spot_id }, data: { najem_do: new Date(od + mesicu * MESIC_MS) },
    });
    celkem += castka;
  }
  return celkem;
}

// GET /spots/najmy → co mi nájemci dluží a co se právě připsalo.
router.get('/spots/najmy', requirePlayer, async (req, res, next) => {
  try {
    const pripsano = await dorovnejNajmy(req.player);
    const rows = await prisma.gameSpotClaim.findMany({
      where: { player_id: req.player.id, pozemek: true, OR: [{ najemce_id: { not: null } }, { pronajem_cena: { gt: 0 } }] },
    });
    const firmy = await firmyMapa();
    res.json({ ok: true, pripsano, pozemky: rows.map((c) => claimPub(c, req.player.id, firmy)) });
  } catch (e) { next(e); }
});

// POST /spots/navyseni { spot_id, rent } — majitel pozemku dal výpověď a pustí
// nájemce dál jen za víc peněz. Výpověď samotnou spustila hra v prohlížeči (je
// to náhoda jako porucha, ne tah konkurence), server tu jen zapíše vyšší nájem,
// ať sedí ekonomika i to, co o místě vědí ostatní.
const NAVYSENI_MAX = 2;   // víc než dvojnásobek si majitel neřekne
router.post('/spots/navyseni', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120);
    const rent = Math.round(Number(b.rent) || 0);
    const cur = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.tohle_misto_ti_nepatri_4') });
    if (cur.pozemek) return res.status(409).json({ error: stx(req)('server.na_vlastnim_pozemku_se_najem_neplati') });
    if (!(rent > cur.rent)) return res.status(400).json({ error: stx(req)('server.nova_castka_musi_byt_vyssi_nez') });
    if (rent > cur.rent * NAVYSENI_MAX || rent > 5000000) {
      return res.status(400).json({ error: stx(req)('server.tolik_si_majitel_nerekl') });
    }
    const upd = await prisma.gameSpotClaim.update({ where: { spot_id: spot }, data: { rent } });
    console.log('[game] nájemce přisadil po výpovědi:', spot, req.player.nick, rent + ' L$');
    res.json({ ok: true, rent: upd.rent, spot: claimPub(upd, req.player.id, await firmyMapa()) });
  } catch (e) { next(e); }
});

// POST /spots/model { spot_id, model } — výměna stroje na vlastním místě.
// Zábor zůstává, mění se jen model: jinak by konkurence i žebříček zemí
// koukali na stroj, který tam už nestojí. Peníze řeší hra u sebe.
router.post('/spots/model', requirePlayer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const spot = s(b.spot_id, 120), model = s(b.model, 10);
    if (!spot || !model) return res.status(400).json({ error: stx(req)('server.chybi_misto_nebo_model') });
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: spot } });
    if (!c || c.player_id !== req.player.id) {
      return res.status(404).json({ error: stx(req)('server.tohle_misto_neni_tvoje') });
    }
    const up = await prisma.gameSpotClaim.update({ where: { spot_id: spot }, data: { model } });
    res.json({ ok: true, spot: claimPub(up, req.player.id, await firmyMapa()) });
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
    if (!cur || cur.player_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.tohle_misto_ti_nepatri_5') });
    const zbyva = cur.vazano_do
      ? Math.ceil(Math.max(0, new Date(cur.vazano_do).getTime() - Date.now()) / MESIC_MS) : 0;
    const odstupne = Math.round(cur.rent * Math.min(zbyva, ODSTUPNE_MAX));
    if (odstupne > 0 && !b.odstupne) {
      return res.status(409).json({ ok: false, odstupne, zbyva,
        error: stx(req)('server.smlouva_je_na_dobu_urcitou_odejit') });
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
module.exports._cenaKusuVBalicku = cenaKusuVBalicku;
module.exports._cardKinds = CARD_KINDS;
module.exports._subKinds = SUB_KINDS;
module.exports._linkaKinds = LINKA_KINDS;
module.exports._kampanKinds = KAMPAN_KINDS;
module.exports._pocitaneKinds = POCITANE_KINDS;
module.exports._subKinds = SUB_KINDS;
module.exports._ramecKinds = RAMEC_KINDS;
module.exports._ramecKatalog = RAMEC;
module.exports._ramecUroven = ramecUroven;
module.exports._predplatneHrace = predplatneHrace;
module.exports._dropPrices = dropPrices;
module.exports._dropPodlaha = dropPodlaha;
module.exports._nastaveni = nastaveni;
module.exports._dropNastaveni = dropNastaveni;
module.exports._rychlyOnboarding = rychlyOnboarding;
module.exports._defaults = ALL;
module.exports._cashCustom = CASH_CUSTOM;
module.exports._urokMesicne = urokMesicne;
module.exports._zbydeMesicne = zbydeMesicne;
module.exports._cisteJmeni = cisteJmeni;
module.exports._kdoPrivedl = kdoPrivedl;
// Id hráče z cookie, bez sahání do databáze. Používá hledání měst, aby se
// limit počítal po hráčích a ne po IP — za jednou mobilní adresou sedí klidně
// celé město a jeden hledající by ji vyčerpal všem ostatním.
module.exports._pidZCookie = (req) => {
  const t = (req.cookies || {})[COOKIE];
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET, { audience: 'lm-game' }).pid || null; } catch (e) { return null; }
};
module.exports._dorovnejProvize = dorovnejProvize;
module.exports._strojeHrace = strojeHrace;
module.exports._privedeniHraci = privedeniHraci;
module.exports._distAktivni = distAktivni;
module.exports._distRezie = distRezie;
