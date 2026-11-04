// =============================================================================
// Laundromats Milionář — herní logika (běží celá v prohlížeči)
// =============================================================================
// Stav hry je JEDEN objekt uložený v localStorage. Až hra dostane účty a platby,
// stačí ten samý objekt posílat na server — proto nic neukládáme po kouskách.
//
// Čas: 1 SKUTEČNÝ den = 1 herní rok. Výnos se nepočítá tikáním, ale z rozdílu
// časů, takže prádlomaty vydělávají i se zavřenou hrou a hra přežije restart.
'use strict';
(function () {

// ─── Ekonomika ───────────────────────────────────────────────────────────────
// Čísla jsou 1:1 z reálného modelu prádlomatu (apps/laundromats/ekonomika.js),
// jen přepočtená do korun. Když se změní skutečný model, změň i tohle.
var EUR = 24.35;
var MODELS = {
  mini: { key: 'mini', name: 'MINI', machine: 35000, permit: 825, conn: 1926, spend: 16.52, cost: 647, perday: 5,
    desc: 'Nejmenší a nejlevnější. Hodí se tam, kde nechodí davy.' },
  flex: { key: 'flex', name: 'FLEX', machine: 52000, permit: 825, conn: 2889, spend: 11.33, cost: 767, perday: 8,
    desc: 'Dvě pračky a sušička. Nejlepší poměr ceny a výkonu.' },
  max: { key: 'max', name: 'MAX', machine: 67000, permit: 825, conn: 2889, spend: 11.33, cost: 900, perday: 10,
    desc: 'Dvě pračky a dvě sušičky. Pro místa, kde je o praní rvačka.' }
};
var MODEL_ORDER = ['mini', 'flex', 'max'];
// Fotky strojů. Lokální soubory jsou jen záloha — po startu se přepíšou tím,
// co je u dané verze nastavené v HolyOS (Compounder → fotky verzí). Když tam
// někdo nahraje hezčí render MAXu, objeví se sám i tady, v Ekonomice i v portálu.
var MODEL_IMG = {
  mini: { src: '/game/mini.webp' },
  flex: { src: '/game/flex.webp' },
  max: { src: '/game/max.webp' }
};
var VER_OF = { mini: 'V2', flex: 'V3', max: 'V4' };
// Fotky z ceníku HolyOS bereme jen tam, kde nemáme hezčí vlastní výřez (MAX).
var VER_PREFER_REMOTE = { max: true };
function loadMachinePhotos() {
  fetch('/api/compounder/portal/machines').then(function (r) { return r.json(); }).then(function (j) {
    var changed = false;
    (j.machines || []).forEach(function (m) {
      MODEL_ORDER.forEach(function (k) {
        if (VER_OF[k] !== m.ver || !m.photo || !VER_PREFER_REMOTE[k]) return;
        if (MODEL_IMG[k].src !== m.photo) { MODEL_IMG[k] = { src: m.photo }; changed = true; }
      });
    });
    if (changed && S && !$('v-shop').classList.contains('hidden')) paintShop();
  }).catch(function () { /* ceník nedostupný — zůstanou lokální fotky */ });
}
// Jeden SKUTEČNÝ den = dva herní měsíce, herní rok tedy trvá 6 dní.
var MONTH_MS = 43200000;         // 1 herní měsíc = 12 skutečných hodin
var YEAR_MS = 12 * MONTH_MS;     // 1 herní rok = 6 skutečných dní
var DELIVERY_MONTHS = 2;         // dodání prádlomatu = 2 herní měsíce (přesně 1 skutečný den)
var BANK_BASE = 1000000;         // startovní rámec v bance
var BANK_PER_UNIT = 600000;      // o kolik rámec povyroste s každým prádlomatem
var BANK_PER_DAY = 100000;       // co banka sama doplní za skutečný den
var REVEAL_COST = 35000;         // prověření jednoho místa
var SCOUT_COST = 20000;          // cesta do města a hledání vhodných míst
var CASH_RESERVE = 120000;       // tolik hotovosti banka nenechá utratit — musí zbýt na prověření místa a instalaci
var OPERATING_MAX = 150000;      // provozní úvěr nad rámec úvěrového stropu, aby hra nikdy neskončila ve slepé uličce

// Lepší místo = víc zákazníků. Skóre dává hledač míst ze skutečných dat.
function placeFactor(score) { return Math.max(0.3, Math.min(1.7, 0.35 + (score / 100) * 1.25)); }
// Lukrativnější typ místa = vyšší nájem a provozní náklady.
var COST_F = { mall: 1.25, hypermarket: 1.2, department_store: 1.15, supermarket: 1.1, fuel: 1, car_wash: 0.9 };
var KIND_LABEL = { supermarket: 'Supermarket', hypermarket: 'Hypermarket', mall: 'Obchodní centrum',
  department_store: 'Obchodní dům', fuel: 'Benzínka', car_wash: 'Samoobslužná myčka' };

// Ceník prádlomatů je o 25 % nad modelovou cenou; instalace zůstává na modelové ceně.
var PRICE_MULT = 1.25;
// Cena stroje (platí se v obchodě) a instalace na místě (projekt, povolení, přípojky).
function machinePrice(m) { return Math.round(m.machine * EUR * PRICE_MULT); }
function installPrice(m) { return Math.round((m.permit + m.conn) * EUR); }
function investOf(m) { return machinePrice(m) + installPrice(m); }
function economics(spot, modelKey) {
  var m = MODELS[modelKey] || MODELS.flex;
  var perday = m.perday * placeFactor(spot.score);
  var revenue = Math.round(perday * 30.5 * m.spend * EUR);
  var cost = Math.round(m.cost * EUR * (COST_F[spot.kind] || 1));
  var profit = revenue - cost;
  var inv = investOf(m);
  return { model: m.key, invest: inv, machine: machinePrice(m), install: installPrice(m),
    revenue: revenue, cost: cost, profit: profit,
    perday: Math.round(perday * 10) / 10, payback: profit > 0 ? inv / (profit * 12) : null };
}

// ─── Profily hráče ───────────────────────────────────────────────────────────
var PROFILES = {
  opatrny: { id: 'opatrny', name: 'Opatrný stavitel', cash: 500000, ltv: 0.70, rate: 0.096,
    desc: 'Nerad dlužíš. Banka ti proto půjčí míň, zato nejlevněji — a začínáš s nejtlustší peněženkou.' },
  vyvazeny: { id: 'vyvazeny', name: 'Vyvážený podnikatel', cash: 350000, ltv: 0.85, rate: 0.114,
    desc: 'Riziko bereš jako nástroj, ne jako adrenalin. Rozumný úvěr, rozumný úrok.' },
  dravy: { id: 'dravy', name: 'Dravý expanzista', cash: 300000, ltv: 1.00, rate: 0.132,
    desc: 'Chceš růst rychle a na dluh. Banka ti zaplatí i celý prádlomat, ale nechá si za to zaplatit.' }
};
var QUIZ = [
  { q: 'Máš 1 000 000 L$ a jeden prádlomat stojí 1 356 636 L$. Co uděláš?',
    a: [['Počkám, až našetřím celou částku.', 'opatrny'],
        ['Vezmu si menší úvěr a doplatím ze svého.', 'vyvazeny'],
        ['Vezmu maximální úvěr a hned stavím další.', 'dravy']] },
  { q: 'Našel jsi místo se skóre 61 ze 100. Postavíš tam?',
    a: [['Ne. Hledám dál, dokud nenajdu špičku.', 'opatrny'],
        ['Postavím, ale menší variantu MINI.', 'vyvazeny'],
        ['Postavím hned to velké. Čas jsou peníze.', 'dravy']] },
  { q: 'Síť vydělává. Co s penězi?',
    a: [['Splatím úvěr do posledního haléře.', 'opatrny'],
        ['Půlku na splátky, půlku na další prádlomat.', 'vyvazeny'],
        ['Všechno zpátky do expanze.', 'dravy']] }
];

// ─── Stav hry ────────────────────────────────────────────────────────────────
var KEY = 'lm_milionar_v1';
var S = null;
function fresh(profileId) {
  var p = PROFILES[profileId];
  var now = Date.now();
  return {
    v: 1, profile: profileId, startedAt: now, lastTick: now,
    cash: p.cash, bank: BANK_BASE, loan: 0,
    areas: {},     // id oblasti → { name, scoutedAt, spots:[…] }
    units: [],     // postavené prádlomaty
    revealed: {},  // id místa → true
    orders: [],    // koupené stroje na cestě: { model, arrivesAt }
    stock: {},     // model → kolik kusů čeká na skladě
    stats: { earned: 0, interest: 0 }
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* plná paměť — hra běží dál */ } }
function load() {
  try {
    var raw = localStorage.getItem(KEY); if (!raw) return null;
    var o = JSON.parse(raw); if (!o || !o.profile) return null;
    // Rozehraná hra z verze bez obchodu — jen doplníme, co chybí, ať o síť nikdo nepřijde.
    if (!o.orders) o.orders = [];
    if (!o.stock) o.stock = {};
    o.v = 2;
    return o;
  } catch (e) { return null; }
}

// ─── Sklad a objednávky ──────────────────────────────────────────────────────
// Stroj se kupuje v obchodě, pak je „na cestě" a po dvou herních měsících padne na sklad.
function deliverOrders() {
  var now = Date.now(), arrived = 0;
  S.orders = (S.orders || []).filter(function (o) {
    if (o.arrivesAt > now) return true;
    S.stock[o.model] = (S.stock[o.model] || 0) + 1; arrived++;
    return false;
  });
  return arrived;
}
function inStock(modelKey) { return (S.stock && S.stock[modelKey]) || 0; }
function onWay(modelKey) { return (S.orders || []).filter(function (o) { return o.model === modelKey; }).length; }
// Zbývající čas dodání lidsky: „za 7 h 20 min"
function etaText(ms) {
  if (ms <= 0) return 'právě teď';
  var mins = Math.max(1, Math.round(ms / 60000));   // zaokrouhlíme až minuty, jinak vyjde „23 h 60 min"
  var h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 1) return 'za ' + h + ' h' + (m ? ' ' + m + ' min' : '');
  return 'za ' + m + ' min';
}

// ─── Běh času ────────────────────────────────────────────────────────────────
// Dopočítá všechno, co se stalo od minulého výpočtu: výnos sítě, úrok z úvěru
// a doplnění bankovního rámce. Volá se při otevření hry i každých pár vteřin.
function bankCap() { return BANK_BASE + BANK_PER_UNIT * S.units.length; }
function monthlyProfit() { return S.units.reduce(function (a, u) { return a + u.eco.profit; }, 0); }
function yearlyProfit() { return monthlyProfit() * 12; }
function tick() {
  var now = Date.now();
  var dt = now - S.lastTick;
  if (dt < 0) { S.lastTick = now; return; }      // hráč si přetočil hodiny v telefonu
  if (dt > 30 * YEAR_MS) dt = 30 * YEAR_MS;      // po měsíci nepřítomnosti dál nenabíhá
  var years = dt / YEAR_MS;
  var earned = yearlyProfit() * years;
  var interest = S.loan * PROFILES[S.profile].rate * years;
  S.cash += earned - interest;
  S.loan += interest;
  S.stats.earned += Math.max(0, earned);
  S.stats.interest += interest;
  S.bank = Math.min(bankCap(), S.bank + BANK_PER_DAY * (dt / 86400000));
  S.lastTick = now;
  deliverOrders();
}
function gameYear() { return Math.floor((Date.now() - S.startedAt) / YEAR_MS) + 1; }

// ─── Pomůcky ─────────────────────────────────────────────────────────────────
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function kc(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1).replace('.', ',') + ' M';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + ' tis.';
  return n.toLocaleString('cs-CZ');
}
// Herní měna se jmenuje laundr a píše se L$ — ať si ji nikdo neplete s korunami.
var CUR = 'L$';
function kcFull(n) { return (Math.round(Number(n) || 0)).toLocaleString('cs-CZ') + ' ' + CUR; }
var toastT = null;
function toast(msg, kind) {
  var el = $('toast'); el.textContent = msg; el.className = 'toast' + (kind ? ' ' + kind : '');
  clearTimeout(toastT); toastT = setTimeout(function () { el.classList.add('hidden'); }, 2600);
}
function sheet(html) { $('sheet-body').innerHTML = html; $('sheet').classList.remove('hidden'); }
function closeSheet() { $('sheet').classList.add('hidden'); }
$('sheet').addEventListener('click', function (e) { if (e.target.classList.contains('sheet-bg')) closeSheet(); });
$('sheet-x').onclick = closeSheet;

function verdictPill(score) {
  var c = score >= 70 ? 'good' : score >= 55 ? 'mid' : 'bad';
  var t = score >= 70 ? 'výborné' : score >= 55 ? 'použitelné' : 'slabé';
  return '<span class="pill ' + c + '">' + score + '/100 · ' + t + '</span>';
}

// ─── Postavička ──────────────────────────────────────────────────────────────
// Kreslí se z jednoho čísla: 0 = opatrný, 1 = vyvážený, 2 = dravý. Po každé
// odpovědi se překreslí, takže hráč vidí, do koho se svými volbami proměňuje.
var SKIN = '#e8b58e', SKIN2 = '#d19a73';
var AVA = [
  { accent: '#4fd1ff', suit: '#24466b', hair: '#3a4256', name: 'opatrný' },
  { accent: '#7c5cff', suit: '#39306b', hair: '#2f3242', name: 'vyvážený' },
  { accent: '#ff8a3d', suit: '#5a2f1c', hair: '#241f22', name: 'dravý' }
];
function avatarSvg(lvl) {
  lvl = Math.max(0, Math.min(2, lvl | 0));
  var c = AVA[lvl], id = 'av' + lvl;
  var g = '<defs>'
    + '<radialGradient id="h' + id + '" cx="50%" cy="45%" r="55%">'
    + '<stop offset="0" stop-color="' + c.accent + '" stop-opacity=".34"/>'
    + '<stop offset="1" stop-color="' + c.accent + '" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="s' + id + '" x1="40" y1="108" x2="120" y2="158" gradientUnits="userSpaceOnUse">'
    + '<stop stop-color="' + c.suit + '"/><stop offset="1" stop-color="' + c.accent + '" stop-opacity=".55"/></linearGradient>'
    + '</defs>';
  // svatozář + rameno + krk
  g += '<circle cx="80" cy="80" r="76" fill="url(#h' + id + ')"/>'
    + '<circle cx="80" cy="80" r="60" fill="none" stroke="' + c.accent + '" stroke-opacity=".3" stroke-width="1.5"/>'
    + '<path d="M80 96c-26 0-44 14-50 38h100c-6-24-24-38-50-38z" fill="url(#s' + id + ')"/>'
    + '<path d="M68 92h24v16c0 6-24 6-24 0z" fill="' + SKIN2 + '"/>';
  // košile
  g += '<path d="M69 97l11 13 11-13 9 5-20 20-20-20z" fill="#f2f6ff"/>';
  // kravata / rozhalenka
  if (lvl === 0) g += '<path d="M80 110l6 6-6 28-6-28z" fill="' + c.accent + '"/>';
  else if (lvl === 1) g += '<path d="M80 110l5 5-5 17-5-17z" fill="' + c.accent + '"/>';
  else g += '<path d="M80 112l-9 9 3 4 6-6 6 6 3-4z" fill="' + c.suit + '"/>';
  // hlava
  g += '<ellipse cx="80" cy="64" rx="26" ry="29" fill="' + SKIN + '"/>'
    + '<path d="M58 70c-4 0-5 8 0 9M102 70c4 0 5 8 0 9" fill="' + SKIN + '"/>';
  // vlasy podle typu
  if (lvl === 0) g += '<path d="M54 60c0-18 12-27 26-27s26 9 26 27c0-9-10-13-26-13-9 0-14 3-18 8-3 4-8 3-8 5z" fill="' + c.hair + '"/>';
  else if (lvl === 1) g += '<path d="M54 62c0-20 12-29 26-29s26 9 26 29c-3-12-11-17-26-17s-23 5-26 17z" fill="' + c.hair + '"/>';
  else g += '<path d="M54 60c2-19 13-27 26-27s25 8 26 26c-5-7-9-11-14-9 2-4 1-6-2-7-2 5-7 7-13 6-7-1-13 1-16 5-3 3-5 4-7 6z" fill="' + c.hair + '"/>';
  // obočí
  var brow = lvl === 2 ? '<path d="M66 54l14 4M94 50l-13 6" stroke="' + c.hair + '" stroke-width="3.4" stroke-linecap="round"/>'
    : '<path d="M67 55h13M93 55H80" stroke="' + c.hair + '" stroke-width="3.2" stroke-linecap="round"/>';
  g += brow;
  // oči
  g += '<circle cx="71" cy="64" r="3.2" fill="#1b2235"/><circle cx="89" cy="64" r="3.2" fill="#1b2235"/>';
  // brýle jen u opatrného
  if (lvl === 0) g += '<g fill="none" stroke="' + c.accent + '" stroke-width="2.2">'
    + '<circle cx="71" cy="64" r="8"/><circle cx="89" cy="64" r="8"/><path d="M79 64h2"/></g>';
  // ústa
  if (lvl === 0) g += '<path d="M73 78q7 4 14 0" stroke="#9c5f49" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
  else if (lvl === 1) g += '<path d="M72 77q8 7 16 0" stroke="#9c5f49" stroke-width="2.8" fill="none" stroke-linecap="round"/>';
  else g += '<path d="M70 76q10 12 20 0z" fill="#8c4030"/><path d="M72 77h16l-2 2H74z" fill="#fff"/>';
  // odznak s tím, co typ řeší
  var bx = 124, by = 122;
  g += '<circle cx="' + bx + '" cy="' + by + '" r="19" fill="#0b1222" stroke="' + c.accent + '" stroke-width="2"/>';
  if (lvl === 0) g += '<circle cx="' + bx + '" cy="' + by + '" r="9" fill="none" stroke="#ffd866" stroke-width="2.4"/>'
    + '<text x="' + bx + '" y="' + (by + 4) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#ffd866">L$</text>';
  else if (lvl === 1) g += '<g fill="' + c.accent + '"><rect x="' + (bx - 9) + '" y="' + (by - 1) + '" width="5" height="9" rx="1.5"/>'
    + '<rect x="' + (bx - 2) + '" y="' + (by - 6) + '" width="5" height="14" rx="1.5"/>'
    + '<rect x="' + (bx + 5) + '" y="' + (by - 10) + '" width="5" height="18" rx="1.5"/></g>';
  else g += '<path d="M' + (bx - 9) + ' ' + (by + 7) + 'l6-7 5 4 7-10" fill="none" stroke="' + c.accent + '" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M' + (bx + 4) + ' ' + (by - 6) + 'h6v6" fill="none" stroke="' + c.accent + '" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>';
  return '<svg viewBox="0 0 160 160" role="img" aria-label="Postavička podnikatele">' + g + '</svg>';
}
// Z dosavadních odpovědí spočítá, ke komu má postavička blíž.
function avaLevel(sc, answered) {
  if (!answered) return 1;
  var risk = (sc.dravy * 2 + sc.vyvazeny) / (answered * 2);
  return Math.round(risk * 2);
}

// ─── Úvod a dotazník ─────────────────────────────────────────────────────────
var qi = 0, qScore = { opatrny: 0, vyvazeny: 0, dravy: 0 };
$('go-quiz').onclick = function () { $('intro').classList.add('hidden'); $('quiz').classList.remove('hidden'); renderQuiz(); };
function renderQuiz() {
  var q = QUIZ[qi];
  $('q-ava').innerHTML = avatarSvg(avaLevel(qScore, qi));
  $('q-title').textContent = 'Otázka ' + (qi + 1) + ' ze ' + QUIZ.length;
  $('q-text').textContent = q.q;
  $('q-opts').innerHTML = q.a.map(function (o, i) { return '<button data-i="' + i + '">' + esc(o[0]) + '</button>'; }).join('');
  $('q-dots').innerHTML = QUIZ.map(function (_, i) { return '<i class="' + (i <= qi ? 'on' : '') + '"></i>'; }).join('');
  [].forEach.call($('q-opts').children, function (b) {
    b.onclick = function () {
      qScore[q.a[+b.getAttribute('data-i')][1]]++;
      qi++;
      if (qi < QUIZ.length) return renderQuiz();
      var best = Object.keys(qScore).sort(function (a, c) { return qScore[c] - qScore[a]; })[0];
      showRole(best);
    };
  });
}
function showRole(id) {
  var p = PROFILES[id];
  $('quiz').classList.add('hidden'); $('role').classList.remove('hidden');
  $('role-ava').innerHTML = avatarSvg(['opatrny', 'vyvazeny', 'dravy'].indexOf(id));
  $('role-name').textContent = p.name;
  $('role-desc').textContent = p.desc;
  $('role-cash').textContent = kcFull(p.cash);
  $('role-ltv').textContent = Math.round(p.ltv * 100) + ' % z ceny';
  $('role-rate').textContent = (p.rate * 100).toFixed(1).replace('.', ',') + ' % ročně';
  $('go-game').onclick = function () { S = fresh(id); save(); startGame(); };
}

// ─── Mapa ────────────────────────────────────────────────────────────────────
var map = null, layer = null;
// Dlaždice NEBEREME z tile.openstreetmap.org — jejich pravidla to aplikacím zakazují
// a servery nás zablokují (403 „App is not following the tile usage policy").
// CARTO zase chce API klíč a bez něj vrací vodoznak s kódem 200, takže se chyba ani nepozná.
// Zůstáváme proto u Esri — stejná služba, na které jede „Najít místo" i Site Development.
// Primárně tmavá varianta (sedí ke hře), záloha je klasický silniční podklad.
var BASEMAPS = [
  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri' } },
  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    labels: null,
    opts: { maxZoom: 19, attribution: 'Tiles &copy; Esri' } }
];
var baseIdx = 0, baseLayer = null, labelLayer = null, tileErrs = 0;
function addBasemap() {
  var b = BASEMAPS[baseIdx];
  if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
  if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }
  tileErrs = 0;
  baseLayer = L.tileLayer(b.url, b.opts).addTo(map);
  if (b.labels) labelLayer = L.tileLayer(b.labels, { maxZoom: b.opts.maxZoom, maxNativeZoom: b.opts.maxNativeZoom, opacity: 0.9 }).addTo(map);
  baseLayer.on('tileerror', function () {
    tileErrs++;
    // Pár chybějících dlaždic je při rolování normální; až když padá celá vrstva, zkusíme další zdroj.
    if (tileErrs > 6 && baseIdx < BASEMAPS.length - 1) { baseIdx++; addBasemap(); }
  });
}
function initMap() {
  if (map) return;
  // Mapa jede z CDN. Když se nenačte (slabá síť, blokovaný skript), hra musí běžet dál
  // — jen místo mapy ukážeme hlášku a všechno ostatní se ovládá ze seznamu oblastí.
  if (typeof L === 'undefined') {
    var h = $('map-hint');
    h.textContent = 'Mapu se nepodařilo načíst. Zkontroluj připojení a načti hru znovu — hrát jde i bez ní přes tlačítko dole.';
    h.classList.remove('hidden');
    return;
  }
  map = L.map('map', { zoomControl: false }).setView([49.82, 15.47], 7);
  addBasemap();
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  layer = L.layerGroup().addTo(map);
  drawMap();
}
function pinIcon(cls, txt) {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin ' + cls + '">' + txt + '</div>' });
}
function drawMap() {
  if (!layer) return;
  layer.clearLayers();
  var any = false;
  Object.keys(S.areas).forEach(function (aid) {
    S.areas[aid].spots.forEach(function (sp) {
      any = true;
      var mine = S.units.some(function (u) { return u.spotId === sp.id; });
      var seen = !!S.revealed[sp.id];
      var cls = mine ? 'mine' : seen ? 'known' : 'unknown';
      var txt = mine ? '\u{1F9FA}' : seen ? '★' : '?';
      L.marker([sp.lat, sp.lon], { icon: pinIcon(cls, txt) })
        .addTo(layer)
        .on('click', function () { spotSheet(sp, aid); });
    });
  });
  $('map-hint').classList.toggle('hidden', any);
}

// ─── Panel: průzkum města ────────────────────────────────────────────────────
// Hráč napíše město a pošle tam člověka, aby ho prošel a našel vhodná místa.
// Cesta stojí pokaždé stejně, ať jde o Prahu nebo o Trutnov.
function areasSheet() {
  var done = Object.keys(S.areas).map(function (id) {
    return '<div class="area-item"><div><div class="nm">' + esc(S.areas[id].name) + '</div>'
      + '<div class="sub">nalezeno ' + S.areas[id].spots.length + ' míst</div></div>'
      + '<button class="btn sec sm" data-go="' + esc(id) + '">Na mapu</button></div>';
  }).join('');
  sheet('<h3>Prozkoumat město</h3>'
    + '<p class="muted small">Napiš, kam poslat člověka. Projde město, obhlédne benzínky, obchodní centra a myčky a vrátí se se seznamem míst. '
    + 'Cesta stojí ' + kcFull(SCOUT_COST) + '. Co je na kterém místě, zjistíš až jeho prověřením.</p>'
    + '<div class="row" style="gap:8px;margin:12px 0 10px">'
    + '<input id="city-q" class="inp" placeholder="Např. Kolín" autocomplete="off" autocapitalize="words" enterkeyhint="search">'
    + '<button class="btn" id="do-scout"' + (S.cash < SCOUT_COST ? ' disabled' : '') + '>Hledat</button></div>'
    + '<p class="fine" id="city-note"></p>'
    + (S.cash < SCOUT_COST ? '<p class="fine err">Na cestu nemáš dost hotovosti.</p>' : '')
    + (done ? '<h3 style="margin-top:16px">Už prozkoumáno</h3>' + done : ''));
  var inp = $('city-q'), btn = $('do-scout');
  var run = function () { scout((inp.value || '').trim(), btn); };
  if (btn) btn.onclick = run;
  if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } };
  [].forEach.call($('sheet-body').querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () {
      var a = S.areas[b.getAttribute('data-go')];
      closeSheet(); if (map && a && a.lat) map.setView([a.lat, a.lon], 12);
    };
  });
}
// Hledání běží na serveru na pozadí, protože data z OpenStreetMap chodí pomalu.
// Doptáváme se, dokud není hotovo, a mezitím hráči ukazujeme, jak dlouho to trvá.
var SCOUT_MAX_WAIT = 150000;
function scout(city, btn) {
  if (!city || city.length < 2) return toast('Napiš, do kterého města se má jet.', 'err');
  if (S.cash < SCOUT_COST) return toast('Na cestu nemáš dost hotovosti.', 'err');
  var started = Date.now(), stop = false;
  var note = $('city-note');
  var fail = function (msg) {
    stop = true; btn.disabled = false; btn.textContent = 'Hledat';
    if (note) note.textContent = '';
    toast(msg, 'err');
  };
  btn.disabled = true; btn.textContent = 'Hledám…';
  if (note) note.textContent = 'Posílám tam člověka. Projít nové město může trvat i minutu.';

  var poll = function () {
    if (stop) return;
    fetch('/api/game/scout?q=' + encodeURIComponent(city), { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok && r.status !== 202) throw new Error(j.error || ('Chyba ' + r.status)); return j; }); })
      .then(function (j) {
        if (stop) return;
        if (j && j.pending) {
          var s = Math.round((Date.now() - started) / 1000);
          if (Date.now() - started > SCOUT_MAX_WAIT) {
            return fail('Hledání trvá moc dlouho. Zkus to za chvíli znovu — mezitím běží dál a podruhé to bude hned.');
          }
          btn.textContent = 'Hledám… ' + s + ' s';
          return setTimeout(poll, 2500);
        }
        btn.disabled = false; btn.textContent = 'Hledat';
        if (note) note.textContent = '';
        if (!j.spots || !j.spots.length) return toast('Tam se nic vhodného nenašlo. Peníze ti zůstávají.', 'err');
        var id = j.area.id;
        var known = S.areas[id] ? S.areas[id].spots.length : 0;
        // Už prozkoumané město neúčtujeme znovu — jen hráče hodíme na mapu.
        if (known >= j.spots.length) {
          closeSheet();
          if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], 12);
          return toast(j.area.name + ' už máš prozkoumaný — koukni na mapu.', 'ok');
        }
        S.cash -= SCOUT_COST;
        S.areas[id] = { name: j.area.name, lat: j.area.lat, lon: j.area.lon, scoutedAt: Date.now(), spots: j.spots };
        save(); paint(); drawMap(); closeSheet();
        if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], 12);
        toast(j.area.name + ': nalezeno ' + j.spots.length + ' míst.', 'ok');
      })
      .catch(function (e) { fail(e.message); });
  };
  poll();
}

// ─── Panel: místo ────────────────────────────────────────────────────────────
function spotSheet(sp, areaId) {
  var unit = S.units.filter(function (u) { return u.spotId === sp.id; })[0];
  if (unit) return unitSheet(unit);
  if (!S.revealed[sp.id]) {
    sheet('<h3>Neprověřené místo</h3>'
      + '<p class="muted small">Víš jen, že tu něco je. Prověření ti ukáže, kolik tu chodí lidí, jaká je konkurence a jestli se tu prádlomat vyplatí.</p>'
      + '<div class="kv"><span>Typ místa</span><b>' + esc(KIND_LABEL[sp.kind] || 'Neznámý') + '</b></div>'
      + '<div class="kv"><span>Cena prověření</span><b>' + kcFull(REVEAL_COST) + '</b></div>'
      + '<button class="btn big" id="do-reveal"' + (S.cash < REVEAL_COST ? ' disabled' : '') + '>Prověřit místo</button>'
      + (S.cash < REVEAL_COST ? '<p class="fine">Na prověření nemáš dost hotovosti.</p>' : ''));
    var b = $('do-reveal');
    if (b) b.onclick = function () { S.cash -= REVEAL_COST; S.revealed[sp.id] = true; save(); paint(); drawMap(); spotSheet(sp, areaId); };
    return;
  }
  sheet('<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[sp.kind] || 'Místo') + ' · ' + esc(S.areas[areaId] ? S.areas[areaId].name : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<div class="kv"><span>Parkovacích ploch v okolí</span><b>' + (sp.parking != null ? sp.parking : '—') + '</b></div>'
    + '<div class="kv"><span>Konkurence do 1,5 km</span><b>' + (sp.competition != null ? sp.competition : '—') + '</b></div>'
    + '<div class="kv"><span>Tahouni provozu</span><b>' + (sp.anchors != null ? sp.anchors : '—') + '</b></div>'
    + '<h3 style="margin-top:18px">Co tu postavit</h3>'
    + MODEL_ORDER.map(function (k) { return modelCard(sp, economics(sp, k)); }).join(''));
  [].forEach.call($('sheet-body').querySelectorAll('[data-build]'), function (b) {
    b.onclick = function () { installSheet(sp, areaId, b.getAttribute('data-build')); };
  });
  var go = $('go-shop');
  if (go) go.onclick = function () { closeSheet(); switchTab('shop'); };
}
// Karta modelu na konkrétním místě. Postavit jde jen to, co je skladem — jinak vede do obchodu.
function modelCard(sp, e) {
  var m = MODELS[e.model], n = inStock(e.model), way = onWay(e.model);
  var btn;
  if (n > 0) btn = '<button class="btn sm" style="width:100%;margin-top:10px" data-build="' + e.model + '">Postavit (' + n + '× skladem)</button>';
  else if (way > 0) btn = '<p class="fine warn" style="margin:10px 0 0">' + way + '× je na cestě — až dorazí, postavíš ho tady.</p>';
  else btn = '<button class="btn sec sm" style="width:100%;margin-top:10px" id="go-shop">Není skladem — do obchodu</button>';
  return '<div class="card"><div class="row"><h3>' + m.name + '</h3><b>' + kc(e.invest) + ' ' + CUR + '</b></div>'
    + '<p class="muted small" style="margin:2px 0 8px">' + esc(m.desc) + '</p>'
    + '<div class="kv"><span>Zákazníků / den</span><b>' + String(e.perday).replace('.', ',') + '</b></div>'
    + '<div class="kv"><span>Obrat / měsíc</span><b>' + kcFull(e.revenue) + '</b></div>'
    + '<div class="kv"><span>Zisk / měsíc</span><b class="' + (e.profit > 0 ? 'ok' : 'err') + '">' + kcFull(e.profit) + '</b></div>'
    + '<div class="kv"><span>Návratnost</span><b>' + (e.payback ? e.payback.toFixed(1).replace('.', ',') + ' roku' : 'nikdy') + '</b></div>'
    + btn + '</div>';
}

// ─── Financování (hotovost + úvěr z banky) ───────────────────────────────────
// Používá se stejně na nákup stroje v obchodě i na instalaci na místě, aby se
// hráč nikdy nezasekl bez hotovosti a bez možnosti si půjčit.
function investedTotal() { return S.units.reduce(function (a, u) { return a + u.eco.invest; }, 0); }
function stockValue() {
  var v = 0;
  MODEL_ORDER.forEach(function (k) { v += (inStock(k) + onWay(k)) * machinePrice(MODELS[k]); });
  return v;
}
function assetsTotal() { return investedTotal() + stockValue(); }
// Na nákupy se nesmí utratit úplně všechno — jinak by hráč zůstal bez hotovosti,
// bez příjmu a bez možnosti cokoli prověřit.
function canFinance(amount) {
  var p = PROFILES[S.profile];
  var own = Math.min(Math.max(0, S.cash - CASH_RESERVE), amount);
  var need = amount - own;
  var ltvRoom = Math.max(0, p.ltv * (assetsTotal() + amount) - S.loan);
  var canBorrow = Math.min(ltvRoom, S.bank);
  return { amount: amount, own: own, need: need, ltvRoom: ltvRoom, canBorrow: canBorrow, ok: need <= canBorrow + 0.5 };
}
function doFinance(f) { S.cash -= f.own; S.bank -= f.need; S.loan += f.need; }
// Provozní úvěr: hotovost z banky na běžné výdaje. Nepodléhá úvěrovému stropu,
// jen vlastnímu limitu — je to pojistka, aby hra nikdy nešla do slepé uličky.
function operatingRoom() {
  var p = PROFILES[S.profile];
  return Math.max(0, p.ltv * assetsTotal() + OPERATING_MAX - S.loan);
}
function cashDrawMax() { return Math.max(0, Math.min(S.bank, operatingRoom(), OPERATING_MAX)); }
function financeRows(f) {
  var p = PROFILES[S.profile];
  return '<div class="kv"><span>Cena</span><b>' + kcFull(f.amount) + '</b></div>'
    + '<div class="kv"><span>Z vlastní hotovosti</span><b>' + kcFull(f.own) + '</b></div>'
    + '<div class="kv"><span>Doplatí banka (úvěr)</span><b class="' + (f.need > 0 ? 'warn' : '') + '">' + kcFull(f.need) + '</b></div>'
    + (f.need > 0 ? '<div class="kv"><span>Úvěrový strop profilu</span><b>' + kcFull(f.ltvRoom) + '</b></div>'
      + '<div class="kv"><span>Volný rámec v bance</span><b>' + kcFull(S.bank) + '</b></div>'
      + '<div class="kv"><span>Úrok</span><b>' + (p.rate * 100).toFixed(1).replace('.', ',') + ' % ročně</b></div>' : '');
}

// ─── Obchod ──────────────────────────────────────────────────────────────────
function paintShop() {
  var st = '';
  MODEL_ORDER.forEach(function (k) {
    var n = inStock(k); if (n) st += '<b>' + n + '× ' + MODELS[k].name + ' skladem</b>';
  });
  (S.orders || []).slice().sort(function (a, b) { return a.arrivesAt - b.arrivesAt; }).forEach(function (o) {
    st += '<b class="way">' + MODELS[o.model].name + ' na cestě · ' + etaText(o.arrivesAt - Date.now()) + '</b>';
  });
  $('shop-stock').innerHTML = st ? '<div class="stock">' + st + '</div>' : '';
  $('shop-list').innerHTML = MODEL_ORDER.map(function (k) {
    var m = MODELS[k], price = machinePrice(m), f = canFinance(price);
    var im = MODEL_IMG[k];
    return '<div class="card">'
      + '<div class="shop-img"><img src="' + esc(im.src) + '" alt="Prádlomat ' + m.name + '" loading="lazy"></div>'
      + '<div class="row" style="margin-top:12px"><h3>' + m.name + '</h3><b>' + kc(price) + ' ' + CUR + '</b></div>'
      + '<p class="muted small" style="margin:2px 0 8px">' + esc(m.desc) + '</p>'
      + '<div class="kv"><span>Zákazníků / den na průměrném místě</span><b>' + m.perday + '</b></div>'
      + '<div class="kv"><span>Provozní náklady / měsíc</span><b>' + kcFull(Math.round(m.cost * EUR)) + '</b></div>'
      + '<div class="kv"><span>Instalace na místě (navíc)</span><b>' + kcFull(installPrice(m)) + '</b></div>'
      + '<div class="kv"><span>Dodání</span><b>' + DELIVERY_MONTHS + ' herní měsíce (1 den)</b></div>'
      + '<button class="btn sm" style="width:100%;margin-top:10px" data-buy="' + k + '"' + (f.ok ? '' : ' disabled') + '>'
      + (f.ok ? 'Koupit ' + m.name : 'Nemáš na to') + '</button></div>';
  }).join('');
  [].forEach.call($('shop-list').querySelectorAll('[data-buy]'), function (b) {
    b.onclick = function () { buySheet(b.getAttribute('data-buy')); };
  });
}
function buySheet(modelKey) {
  var m = MODELS[modelKey], f = canFinance(machinePrice(m));
  sheet('<h3>Koupit ' + m.name + '</h3>'
    + '<p class="muted small">Stroj ti přivezou za ' + DELIVERY_MONTHS + ' herní měsíce, tedy za jeden skutečný den. Do té doby je na cestě, pak čeká na skladě, než mu najdeš místo.</p>'
    + financeRows(f)
    + '<button class="btn big" id="do-buy"' + (f.ok ? '' : ' disabled') + '>Objednat</button>'
    + (f.ok ? '' : '<p class="fine err">Chybí ti ' + kcFull(f.need - f.canBorrow) + '. Počkej, až síť vydělá, nebo splať část úvěru.</p>'));
  var b = $('do-buy');
  if (b) b.onclick = function () {
    doFinance(f);
    S.orders.push({ model: modelKey, orderedAt: Date.now(), arrivesAt: Date.now() + DELIVERY_MONTHS * MONTH_MS });
    save(); paint(); closeSheet();
    toast(m.name + ' objednán. Dorazí ' + etaText(DELIVERY_MONTHS * MONTH_MS) + '.', 'ok');
  };
}

// ─── Panel: instalace stroje ze skladu na místo ──────────────────────────────
function installSheet(sp, areaId, modelKey) {
  var m = MODELS[modelKey], e = economics(sp, modelKey), f = canFinance(e.install);
  sheet('<h3>Postavit ' + m.name + '</h3>'
    + '<p class="muted small">' + esc(sp.name) + ' — projekt, povolení a přípojky. Stroj máš skladem.</p>'
    + financeRows(f)
    + '<div class="kv"><span>Zisk tohohle místa / měsíc</span><b class="ok">' + kcFull(e.profit) + '</b></div>'
    + '<button class="btn big" id="do-build"' + (f.ok ? '' : ' disabled') + '>Postavit</button>'
    + (f.ok ? '' : '<p class="fine err">Na instalaci ti chybí ' + kcFull(f.need - f.canBorrow) + '.</p>'));
  var b = $('do-build');
  if (b) b.onclick = function () {
    doFinance(f);
    S.stock[modelKey] = inStock(modelKey) - 1;
    S.units.push({ spotId: sp.id, areaId: areaId, name: sp.name, kind: sp.kind, score: sp.score,
      lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: e });
    save(); paint(); drawMap(); closeSheet();
    toast('Prádlomat stojí. Vydělává ' + kcFull(e.profit) + ' měsíčně.', 'ok');
  };
}

// ─── Panel: hotový prádlomat ─────────────────────────────────────────────────
function unitSheet(u) {
  var years = (Date.now() - u.builtAt) / YEAR_MS;
  sheet('<h3>' + esc(u.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[u.kind] || 'Místo') + ' · ' + MODELS[u.eco.model].name + ' · v provozu ' + years.toFixed(1).replace('.', ',') + ' roku</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(u.score) + '</div>'
    + '<div class="kv"><span>Investice</span><b>' + kcFull(u.eco.invest) + '</b></div>'
    + '<div class="kv"><span>Obrat / měsíc</span><b>' + kcFull(u.eco.revenue) + '</b></div>'
    + '<div class="kv"><span>Náklady / měsíc</span><b>' + kcFull(u.eco.cost) + '</b></div>'
    + '<div class="kv"><span>Zisk / měsíc</span><b class="ok">' + kcFull(u.eco.profit) + '</b></div>'
    + '<div class="kv"><span>Vydělal celkem</span><b>' + kcFull(u.eco.profit * 12 * years) + '</b></div>');
}

// ─── Obrazovky hry ───────────────────────────────────────────────────────────
function paint() {
  $('t-year').textContent = gameYear();
  $('t-cash').textContent = kc(S.cash);
  $('t-rate').textContent = kc(monthlyProfit());
  $('t-count').textContent = S.units.length;
  if (!$('v-shop').classList.contains('hidden')) paintShop();
  if (!$('v-net').classList.contains('hidden')) paintNet();
  if (!$('v-bank').classList.contains('hidden')) paintBank();
  if (!$('v-me').classList.contains('hidden')) paintMe();
}
function paintNet() {
  $('net-sum').innerHTML = '<div><span>Prádlomaty</span><b>' + S.units.length + '</b></div>'
    + '<div><span>Zisk / měsíc</span><b class="ok">' + kc(monthlyProfit()) + '</b></div>'
    + '<div><span>Investováno</span><b>' + kc(investedTotal()) + '</b></div>'
    + '<div><span>Vyděláno celkem</span><b>' + kc(S.stats.earned) + '</b></div>';
  if (!S.units.length) { $('net-list').innerHTML = '<div class="empty">Zatím nemáš ani jeden prádlomat.<br>Začni tím, že na mapě prozkoumáš oblast.</div>'; return; }
  $('net-list').innerHTML = S.units.slice().sort(function (a, b) { return b.eco.profit - a.eco.profit; }).map(function (u) {
    return '<div class="card" data-unit="' + esc(u.spotId) + '">'
      + '<div class="row"><h3>' + esc(u.name) + '</h3>' + verdictPill(u.score) + '</div>'
      + '<p class="muted small" style="margin:2px 0 6px">' + esc(KIND_LABEL[u.kind] || 'Místo') + ' · ' + MODELS[u.eco.model].name + '</p>'
      + '<div class="row"><span class="muted small">Zisk / měsíc</span><b class="ok">' + kcFull(u.eco.profit) + '</b></div></div>';
  }).join('');
  [].forEach.call($('net-list').querySelectorAll('[data-unit]'), function (c) {
    c.onclick = function () { unitSheet(S.units.filter(function (u) { return u.spotId === c.getAttribute('data-unit'); })[0]); };
  });
}
function paintBank() {
  var p = PROFILES[S.profile];
  // Do majetku patří i stroje skladem a na cestě — banka je bere jako zástavu stejně jako postavené.
  var room = Math.max(0, p.ltv * assetsTotal() - S.loan);
  $('bank-body').innerHTML = '<div class="card">'
    + '<div class="row"><span class="muted small">Hotovost</span><b>' + kcFull(S.cash) + '</b></div>'
    + '<div class="row"><span class="muted small">Volný rámec v bance</span><b>' + kcFull(S.bank) + '</b></div>'
    + '<div class="bar"><i style="width:' + Math.round(Math.min(1, S.bank / bankCap()) * 100) + '%"></i></div>'
    + '<p class="fine" style="margin-top:6px">Rámec sám roste o ' + kcFull(BANK_PER_DAY) + ' za den, nejvýš do ' + kcFull(bankCap()) + '. Strop roste s každým postaveným prádlomatem.</p>'
    + '</div>'
    + '<div class="card"><h3>Úvěr</h3>'
    + '<div class="kv"><span>Dlužíš</span><b class="' + (S.loan > 0 ? 'warn' : '') + '">' + kcFull(S.loan) + '</b></div>'
    + '<div class="kv"><span>Úrok</span><b>' + (p.rate * 100).toFixed(1).replace('.', ',') + ' % ročně</b></div>'
    + '<div class="kv"><span>Zaplaceno na úrocích</span><b>' + kcFull(S.stats.interest) + '</b></div>'
    + '<div class="kv"><span>Ještě si můžeš půjčit</span><b>' + kcFull(Math.min(room, S.bank)) + '</b></div>'
    + (cashDrawMax() >= 1000 ? '<button class="btn sec big" id="do-draw">Vybrat ' + kcFull(cashDrawMax()) + ' na provoz</button>'
        + '<p class="fine">Hotovost z banky na průzkum, prověřování a instalace. Připíše se k úvěru a úročí se stejně.</p>' : '')
    + (S.loan > 0 && S.cash >= 1 ? '<button class="btn big" id="do-repay">Splatit ' + kcFull(Math.min(S.cash, S.loan)) + '</button>' : '')
    + (S.loan > 0 && S.cash < 1 ? '<p class="fine">Splácet začneš, až síť něco vydělá.</p>' : '')
    + '</div>'
    + '<div class="card"><h3>Dobít banku</h3><p class="muted small" style="margin:2px 0 0">Tady budou balíčky herních peněz. V téhle verzi se ještě neplatí — banka se doplňuje jen sama.</p></div>';
  var d = $('do-draw');
  if (d) d.onclick = function () {
    var take = cashDrawMax();
    S.bank -= take; S.loan += take; S.cash += take;
    save(); paint(); toast('Vybráno ' + kcFull(take) + ' na provoz.', 'ok');
  };
  var b = $('do-repay');
  if (b) b.onclick = function () {
    var pay = Math.min(S.cash, S.loan);
    S.cash -= pay; S.loan -= pay; S.bank = Math.min(bankCap(), S.bank + pay);
    save(); paint(); toast('Splaceno ' + kcFull(pay) + '.', 'ok');
  };
}
function paintMe() {
  var p = PROFILES[S.profile];
  var net = S.cash + investedTotal() - S.loan;
  $('me-body').innerHTML = '<div class="card"><h3>' + esc(p.name) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 8px">' + esc(p.desc) + '</p>'
    + '<div class="kv"><span>Herní rok</span><b>' + gameYear() + '</b></div>'
    + '<div class="kv"><span>Čisté jmění</span><b class="' + (net >= 0 ? 'ok' : 'err') + '">' + kcFull(net) + '</b></div>'
    + '<div class="kv"><span>Prozkoumaných oblastí</span><b>' + Object.keys(S.areas).length + '</b></div>'
    + '<div class="kv"><span>Prověřených míst</span><b>' + Object.keys(S.revealed).length + '</b></div>'
    + '</div>'
    + '<div class="card"><h3>Jak se hraje</h3>'
    + '<p class="muted small" style="margin:2px 0 0">Jeden skutečný den jsou ve hře dva měsíce, herní rok tedy trvá šest dní. Prádlomaty vydělávají, i když hru zavřeš — po návratu se ti všechno dopočítá. '
    + 'Místa na mapě jsou skutečná a jejich skóre počítá stejný nástroj, kterým Best Series hledá místa doopravdy. '
    + 'Platí se v <b>laundrech (L$)</b> — herní měně, která nemá žádnou skutečnou hodnotu.</p></div>'
    + '<button class="btn sec big" id="do-reset">Začít znovu od nuly</button>';
  $('do-reset').onclick = function () {
    sheet('<h3>Začít znovu?</h3><p class="muted small">Přijdeš o celou síť i o peníze. Tohle se nedá vrátit.</p>'
      + '<button class="btn big" id="yes-reset" style="background:linear-gradient(90deg,#b4263a,#ff5d6c)">Ano, smazat a začít znovu</button>'
      + '<button class="btn sec big" id="no-reset">Nechat být</button>');
    $('no-reset').onclick = closeSheet;
    $('yes-reset').onclick = function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); };
  };
}

// ─── Přepínání záložek ───────────────────────────────────────────────────────
var TABS = ['map', 'shop', 'net', 'bank', 'me'];
function switchTab(v) {
  [].forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.toggle('on', x.getAttribute('data-v') === v); });
  TABS.forEach(function (k) { $('v-' + k).classList.toggle('hidden', k !== v); });
  paint();
  if (v === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 50);
}
[].forEach.call(document.querySelectorAll('.tabs button'), function (b) {
  b.onclick = function () { switchTab(b.getAttribute('data-v')); };
});
$('open-areas').onclick = areasSheet;

// ─── Start ───────────────────────────────────────────────────────────────────
function startGame() {
  ['intro', 'quiz', 'role'].forEach(function (id) { $(id).classList.add('hidden'); });
  $('app').classList.remove('hidden');
  var before = S.cash, waiting = (S.orders || []).length;
  tick(); save(); paint();
  var arrived = waiting - (S.orders || []).length;
  initMap();
  var gained = S.cash - before;
  if (arrived) toast('Dorazilo ' + arrived + ' strojů — čekají na skladě v obchodě.', 'ok');
  else if (gained > 1000) toast('Než ses vrátil, síť vydělala ' + kcFull(gained) + '.', 'ok');
  setInterval(function () { tick(); save(); paint(); }, 5000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); save(); paint(); } });
}

loadMachinePhotos();

S = load();
if (S) { startGame(); }

})();
