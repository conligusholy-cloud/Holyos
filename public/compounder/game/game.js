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
  flex: { key: 'flex', name: 'FLEX', machine: 52000, permit: 825, conn: 2889, spend: 11.33, cost: 767, perday: 8,
    desc: 'Velký kiosek. Dražší, ale utáhne víc lidí.' },
  mini: { key: 'mini', name: 'MINI', machine: 35000, permit: 825, conn: 1926, spend: 16.52, cost: 647, perday: 5,
    desc: 'Menší a levnější. Hodí se tam, kde nechodí davy.' }
};
var YEAR_MS = 86400000;          // 1 herní rok = 1 skutečný den
var BANK_BASE = 1000000;         // startovní rámec v bance
var BANK_PER_UNIT = 600000;      // o kolik rámec povyroste s každým prádlomatem
var BANK_PER_DAY = 100000;       // co banka sama doplní za skutečný den
var REVEAL_COST = 35000;         // prověření jednoho místa

// Lepší místo = víc zákazníků. Skóre dává hledač míst ze skutečných dat.
function placeFactor(score) { return Math.max(0.3, Math.min(1.7, 0.35 + (score / 100) * 1.25)); }
// Lukrativnější typ místa = vyšší nájem a provozní náklady.
var COST_F = { mall: 1.25, hypermarket: 1.2, department_store: 1.15, supermarket: 1.1, fuel: 1, car_wash: 0.9 };
var KIND_LABEL = { supermarket: 'Supermarket', hypermarket: 'Hypermarket', mall: 'Obchodní centrum',
  department_store: 'Obchodní dům', fuel: 'Benzínka', car_wash: 'Samoobslužná myčka' };

function investOf(m) { return Math.round((m.machine + m.permit + m.conn) * EUR); }
function economics(spot, modelKey) {
  var m = MODELS[modelKey] || MODELS.flex;
  var perday = m.perday * placeFactor(spot.score);
  var revenue = Math.round(perday * 30.5 * m.spend * EUR);
  var cost = Math.round(m.cost * EUR * (COST_F[spot.kind] || 1));
  var profit = revenue - cost;
  var inv = investOf(m);
  return { model: m.key, invest: inv, revenue: revenue, cost: cost, profit: profit,
    perday: Math.round(perday * 10) / 10, payback: profit > 0 ? inv / (profit * 12) : null };
}

// ─── Profily hráče ───────────────────────────────────────────────────────────
var PROFILES = {
  opatrny: { id: 'opatrny', name: 'Opatrný stavitel', cash: 500000, ltv: 0.70, rate: 0.049,
    desc: 'Nerad dlužíš. Banka ti proto půjčí míň, zato nejlevněji — a začínáš s nejtlustší peněženkou.' },
  vyvazeny: { id: 'vyvazeny', name: 'Vyvážený podnikatel', cash: 350000, ltv: 0.85, rate: 0.064,
    desc: 'Riziko bereš jako nástroj, ne jako adrenalin. Rozumný úvěr, rozumný úrok.' },
  dravy: { id: 'dravy', name: 'Dravý expanzista', cash: 200000, ltv: 1.00, rate: 0.079,
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
    stats: { earned: 0, interest: 0 }
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* plná paměť — hra běží dál */ } }
function load() {
  try { var raw = localStorage.getItem(KEY); if (!raw) return null; var o = JSON.parse(raw); return (o && o.v === 1) ? o : null; }
  catch (e) { return null; }
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

function verdictPill(score) {
  var c = score >= 70 ? 'good' : score >= 55 ? 'mid' : 'bad';
  var t = score >= 70 ? 'výborné' : score >= 55 ? 'použitelné' : 'slabé';
  return '<span class="pill ' + c + '">' + score + '/100 · ' + t + '</span>';
}

// ─── Úvod a dotazník ─────────────────────────────────────────────────────────
var qi = 0, qScore = { opatrny: 0, vyvazeny: 0, dravy: 0 };
$('go-quiz').onclick = function () { $('intro').classList.add('hidden'); $('quiz').classList.remove('hidden'); renderQuiz(); };
function renderQuiz() {
  var q = QUIZ[qi];
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
  $('role-name').textContent = p.name;
  $('role-desc').textContent = p.desc;
  $('role-cash').textContent = kcFull(p.cash);
  $('role-ltv').textContent = Math.round(p.ltv * 100) + ' % z ceny';
  $('role-rate').textContent = (p.rate * 100).toFixed(1).replace('.', ',') + ' % ročně';
  $('go-game').onclick = function () { S = fresh(id); save(); startGame(); };
}

// ─── Mapa ────────────────────────────────────────────────────────────────────
var map = null, layer = null, AREAS = [];
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
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

// ─── Panel: výběr oblasti ────────────────────────────────────────────────────
function areasSheet() {
  if (!AREAS.length) return toast('Seznam oblastí se nenačetl. Zkus to za chvíli.', 'err');
  var rows = AREAS.map(function (a) {
    var done = !!S.areas[a.id];
    return '<div class="area-item"><div><div class="nm">' + esc(a.name) + '</div>'
      + '<div class="sub">' + esc(a.size) + (done ? ' · prozkoumáno (' + S.areas[a.id].spots.length + ' míst)' : ' · průzkum ' + kcFull(a.cost)) + '</div></div>'
      + (done
        ? '<button class="btn sec sm" data-go="' + a.id + '">Na mapu</button>'
        : '<button class="btn sm" data-scout="' + a.id + '"' + (S.cash < a.cost ? ' disabled' : '') + '>Prozkoumat</button>')
      + '</div>';
  }).join('');
  sheet('<h3>Prozkoumat oblast</h3>'
    + '<p class="muted small">Průzkum stojí peníze a odhalí, kde v oblasti vůbec jsou vhodná místa. Co je na nich, zjistíš až prověřením konkrétního místa.</p>'
    + rows);
  [].forEach.call($('sheet-body').querySelectorAll('[data-scout]'), function (b) {
    b.onclick = function () { scout(b.getAttribute('data-scout'), b); };
  });
  [].forEach.call($('sheet-body').querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () {
      var a = AREAS.filter(function (x) { return x.id === b.getAttribute('data-go'); })[0];
      closeSheet(); if (map) map.setView([a.lat, a.lon], 13);
    };
  });
}
function scout(areaId, btn) {
  var a = AREAS.filter(function (x) { return x.id === areaId; })[0];
  if (!a || S.cash < a.cost) return toast('Na průzkum nemáš dost hotovosti.', 'err');
  btn.disabled = true; btn.textContent = 'Hledám…';
  fetch('/api/game/scout/' + encodeURIComponent(areaId))
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('Chyba ' + r.status)); return j; }); })
    .then(function (j) {
      if (!j.spots || !j.spots.length) { btn.disabled = false; btn.textContent = 'Prozkoumat'; return toast('V téhle oblasti se nic vhodného nenašlo. Peníze ti zůstávají.', 'err'); }
      S.cash -= a.cost;
      S.areas[areaId] = { name: a.name, scoutedAt: Date.now(), spots: j.spots };
      save(); paint(); drawMap(); closeSheet();
      if (map) map.setView([a.lat, a.lon], 12);
      toast('Oblast ' + a.name + ': nalezeno ' + j.spots.length + ' míst.', 'ok');
    })
    .catch(function (e) { btn.disabled = false; btn.textContent = 'Prozkoumat'; toast(e.message, 'err'); });
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
  var e = economics(sp, 'flex'), e2 = economics(sp, 'mini');
  sheet('<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[sp.kind] || 'Místo') + ' · ' + esc(S.areas[areaId] ? S.areas[areaId].name : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<div class="kv"><span>Parkovacích ploch v okolí</span><b>' + (sp.parking != null ? sp.parking : '—') + '</b></div>'
    + '<div class="kv"><span>Konkurence do 1,5 km</span><b>' + (sp.competition != null ? sp.competition : '—') + '</b></div>'
    + '<div class="kv"><span>Tahouni provozu</span><b>' + (sp.anchors != null ? sp.anchors : '—') + '</b></div>'
    + '<h3 style="margin-top:18px">Co tu postavit</h3>'
    + modelCard(sp, e) + modelCard(sp, e2));
  [].forEach.call($('sheet-body').querySelectorAll('[data-build]'), function (b) {
    b.onclick = function () { buildSheet(sp, areaId, b.getAttribute('data-build')); };
  });
}
function modelCard(sp, e) {
  var m = MODELS[e.model];
  return '<div class="card"><div class="row"><h3>' + m.name + '</h3><b>' + kc(e.invest) + ' ' + CUR + '</b></div>'
    + '<p class="muted small" style="margin:2px 0 8px">' + esc(m.desc) + '</p>'
    + '<div class="kv"><span>Zákazníků / den</span><b>' + String(e.perday).replace('.', ',') + '</b></div>'
    + '<div class="kv"><span>Obrat / měsíc</span><b>' + kcFull(e.revenue) + '</b></div>'
    + '<div class="kv"><span>Zisk / měsíc</span><b class="' + (e.profit > 0 ? 'ok' : 'err') + '">' + kcFull(e.profit) + '</b></div>'
    + '<div class="kv"><span>Návratnost</span><b>' + (e.payback ? e.payback.toFixed(1).replace('.', ',') + ' roku' : 'nikdy') + '</b></div>'
    + '<button class="btn sm" style="width:100%;margin-top:10px" data-build="' + e.model + '">Postavit ' + m.name + '</button></div>';
}

// ─── Panel: stavba (hotovost + úvěr) ─────────────────────────────────────────
function investedTotal() { return S.units.reduce(function (a, u) { return a + u.eco.invest; }, 0); }
function buildSheet(sp, areaId, modelKey) {
  var e = economics(sp, modelKey);
  var p = PROFILES[S.profile];
  var own = Math.min(S.cash, e.invest);
  var need = e.invest - own;
  var ltvRoom = Math.max(0, p.ltv * (investedTotal() + e.invest) - S.loan);
  var canBorrow = Math.min(ltvRoom, S.bank);
  var ok = need <= canBorrow + 0.5;
  sheet('<h3>Postavit ' + MODELS[modelKey].name + '</h3>'
    + '<p class="muted small">' + esc(sp.name) + '</p>'
    + '<div class="kv"><span>Investice</span><b>' + kcFull(e.invest) + '</b></div>'
    + '<div class="kv"><span>Z vlastní hotovosti</span><b>' + kcFull(own) + '</b></div>'
    + '<div class="kv"><span>Doplatí banka (úvěr)</span><b class="' + (need > 0 ? 'warn' : '') + '">' + kcFull(need) + '</b></div>'
    + '<div class="kv"><span>Úvěrový strop profilu</span><b>' + kcFull(ltvRoom) + '</b></div>'
    + '<div class="kv"><span>Volný rámec v bance</span><b>' + kcFull(S.bank) + '</b></div>'
    + '<div class="kv"><span>Úrok</span><b>' + (p.rate * 100).toFixed(1).replace('.', ',') + ' % ročně</b></div>'
    + '<button class="btn big" id="do-build"' + (ok ? '' : ' disabled') + '>Postavit</button>'
    + (ok ? '' : '<p class="fine err">Chybí ti ' + kcFull(need - canBorrow) + '. Počkej, až síť vydělá, nebo splať část úvěru.</p>'));
  var b = $('do-build');
  if (b) b.onclick = function () {
    S.cash -= own; S.bank -= need; S.loan += need;
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
  $('t-rate').textContent = kc(yearlyProfit());
  $('t-count').textContent = S.units.length;
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
  var room = Math.max(0, p.ltv * investedTotal() - S.loan);
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
    + (S.loan > 0 && S.cash >= 1 ? '<button class="btn big" id="do-repay">Splatit ' + kcFull(Math.min(S.cash, S.loan)) + '</button>' : '')
    + (S.loan > 0 && S.cash < 1 ? '<p class="fine">Splácet začneš, až síť něco vydělá.</p>' : '')
    + '</div>'
    + '<div class="card"><h3>Dobít banku</h3><p class="muted small" style="margin:2px 0 0">Tady budou balíčky herních peněz. V téhle verzi se ještě neplatí — banka se doplňuje jen sama.</p></div>';
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
    + '<p class="muted small" style="margin:2px 0 0">Jeden skutečný den je ve hře rok. Prádlomaty vydělávají, i když hru zavřeš — po návratu se ti všechno dopočítá. '
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
[].forEach.call(document.querySelectorAll('.tabs button'), function (b) {
  b.onclick = function () {
    var v = b.getAttribute('data-v');
    [].forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.toggle('on', x === b); });
    ['map', 'net', 'bank', 'me'].forEach(function (k) { $('v-' + k).classList.toggle('hidden', k !== v); });
    paint();
    if (v === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 50);
  };
});
$('open-areas').onclick = areasSheet;

// ─── Start ───────────────────────────────────────────────────────────────────
function startGame() {
  ['intro', 'quiz', 'role'].forEach(function (id) { $(id).classList.add('hidden'); });
  $('app').classList.remove('hidden');
  var before = S.cash;
  tick(); save(); paint();
  initMap();
  var gained = S.cash - before;
  if (gained > 1000) toast('Než ses vrátil, síť vydělala ' + kcFull(gained) + '.', 'ok');
  setInterval(function () { tick(); save(); paint(); }, 5000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); save(); paint(); } });
}

fetch('/api/game/areas').then(function (r) { return r.json(); }).then(function (j) { AREAS = j.areas || []; })
  .catch(function () { AREAS = []; });

S = load();
if (S) { startGame(); }

})();
