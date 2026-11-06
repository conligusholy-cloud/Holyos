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
// Fotky z ceníku HolyOS použijeme jen u verzí, pro které nemáme vlastní render.
// Teď máme všechny tři, takže se z ceníku nebere nic — jinak by MAXu přebila
// fotka skutečné instalace v cizím polepu.
var VER_PREFER_REMOTE = {};
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
var BANK_PER_DAY = 500000;       // co banka sama doplní za skutečný den
var REVEAL_COST = 5000;          // obhlídka místa — jen se tam někdo zajede podívat
var CONN_MIN = 50000, CONN_MAX = 100000;  // přípojky se platí až po domluvě nájmu, podle místa
var CONN_MAX_MULT = 1.2;         // MAX má víc strojů, přípojky jsou o pětinu dražší
var RENT_EUR = 165;              // základní měsíční nájem z reálného modelu (€)
var ENERGY_SHARE = 0.09;         // energie ≈ 9 % obratu kiosku
var SERVIS_SHARE = 0.13;         // servis, praní a úklid ≈ 13 % obratu kiosku
// Návštěvnost na začátku — s ní vychází návratnost kolem pěti let. Roste tím,
// kolik lidí otevře odkaz, který hráč sdílí (viz pozvánky níž).
var TRAFFIC_BASE = 0.45, TRAFFIC_PER_REF = 0.05, TRAFFIC_MAX = 1.1;
var SCOUT_COST = 20000;          // cesta do města a hledání vhodných míst
var CASH_RESERVE = 120000;       // tolik hotovosti banka nenechá utratit — musí zbýt na prověření místa a instalaci
var OPERATING_MAX = 150000;      // provozní úvěr nad rámec úvěrového stropu, aby hra nikdy neskončila ve slepé uličce

// Lepší místo = víc zákazníků. Skóre dává hledač míst ze skutečných dat.
function placeFactor(score) { return Math.max(0.3, Math.min(1.7, 0.35 + (score / 100) * 1.25)); }
var KIND_LABEL = { supermarket: 'Supermarket', hypermarket: 'Hypermarket', mall: 'Obchodní centrum',
  department_store: 'Obchodní dům', fuel: 'Benzínka', car_wash: 'Samoobslužná myčka' };

// Ceník prádlomatů je o 25 % nad modelovou cenou.
var PRICE_MULT = 1.25;
function machinePrice(m) { return Math.round(m.machine * EUR * PRICE_MULT); }

// Každé místo má svoje podmínky, ale pořád ty samé — odvozují se z jeho id,
// takže se při každém otevření nepřepočítají na něco jiného.
function spotHash(id, salt) {
  var t = String(id) + (salt || ''), h = 2166136261;
  for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
// Přípojky (voda, odpad, elektřina) — platí se až po domluvě nájmu.
// ─── Sídlo, pobočky a doprava ───────────────────────────────────────────────
// Stroj někdo musí přivézt. Počítá se to od nejbližšího sídla nebo pobočky,
// takže expanze dostane směr: stavět daleko se prodraží.
var DOPRAVA_PAUSAL = 8000;      // výjezd party, ať je to blízko nebo daleko
var DOPRAVA_KM = 120;           // za kilometr
var SILNICE = 1.3;              // silnice nejsou vzdušnou čarou
var POBOCKA_CENA = 500000;
var POBOCKA_MESICNE = 15000;    // sklad a člověk
var POBOCKA_PAUZA = 3 * YEAR_MS;   // zřídit další jde jednou za tři herní roky
// Vzdálenost dvou bodů na mapě v kilometrech (po povrchu Země).
function kmMezi(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  var la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Všechna místa, odkud se dá vyjet: sídlo a pobočky.
function zakladny() {
  var z = [];
  if (S.sidlo) z.push(S.sidlo);
  (S.pobocky || []).forEach(function (x) { z.push(x); });
  return z;
}
// Nejbližší základna k danému místu a kolik je to kilometrů.
function nejblizsiZakladna(sp) {
  var z = zakladny();
  if (!z.length) return null;
  var nej = null;
  z.forEach(function (b) {
    var km = kmMezi(b, sp) * SILNICE;
    if (!nej || km < nej.km) nej = { zakladna: b, km: km };
  });
  return nej;
}
// Doprava stroje na místo. Bez sídla ještě nevíme odkud, tak nic neúčtujeme.
function dopravaNa(sp, modelKey) {
  // První stroj veze dodavatel rovnou na místo — firma ještě nemá odkud vozit.
  if (!(S.units || []).length) return 0;
  var n = nejblizsiZakladna(sp);
  if (!n) return 0;
  var cena = DOPRAVA_PAUSAL + n.km * DOPRAVA_KM;
  if (modelKey === 'max') cena *= 1.5;      // MAX je rozměrný, potřebuje větší vůz
  return Math.round(cena / 100) * 100;
}
// Co pobočky stojí každý měsíc — dobře umístěná se zaplatí, špatná krade.
function pobockyMesicne() { return (S.pobocky || []).length * POBOCKA_MESICNE; }
// Kdy si hráč může zřídit další pobočku.
function pobockaOd() {
  var posledni = (S.pobocky || []).reduce(function (a, x) { return Math.max(a, x.od || 0); }, 0);
  return Math.max(S.startedAt || 0, posledni) + POBOCKA_PAUZA;
}
function pobockaLze() { return Date.now() >= pobockaOd(); }

// ─── Pohovor s rizikořem ────────────────────────────────────────────────────
// Deset otázek při otevření nebo navýšení rámce, tři při běžném čerpání.
// Každá má opatrnou, vyváženou a odvážnou odpověď. Odvážná může dostat víc,
// ale dráž — a hlavně se odpovědi ověřují proti skutečnému stavu hry: kdo si
// vymýšlí, dopadne hůř, než kdyby odpověděl popravdě.
var OTAZKY = [
  { q: 'Na co ty peníze budou?', a: [
    { t: 'Na konkrétní místo, které mám prověřené.', b: 2, overit: function () { return Object.keys(S.revealed || {}).length >= 1; } },
    { t: 'Na rozšíření sítě, místo teprve najdu.', b: 1 },
    { t: 'Chci rezervu, uvidí se.', b: 0 } ] },
  { q: 'Co uděláte, když tržby spadnou o pětinu?', a: [
    { t: 'Mám rezervu, půl roku to utáhnu.', b: 2, overit: function () { return S.cash >= splatkyMesicne() * 6; } },
    { t: 'Utáhnu opasek a omezím výdaje.', b: 1 },
    { t: 'Půjčím si víc.', b: -1 } ] },
  { q: 'Jakou máte provozní rezervu?', a: [
    { t: 'Víc než tři splátky dopředu.', b: 2, overit: function () { return S.cash >= splatkyMesicne() * 3; } },
    { t: 'Zhruba jednu splátku.', b: 1, overit: function () { return S.cash >= splatkyMesicne(); } },
    { t: 'Upřímně žádnou.', b: 0 } ] },
  { q: 'Kdo vám stroje servisuje?', a: [
    { t: 'Mám na to lidi a smlouvu.', b: 1, overit: function () { return maCetu(); } },
    { t: 'Řeším to vždycky ad hoc.', b: 0 },
    { t: 'Zatím to neřeším.', b: -1 } ] },
  { q: 'Co když vám majitel vypoví místo?', a: [
    { t: 'Mám prověřená náhradní místa.', b: 2, overit: function () { return Object.keys(S.revealed || {}).length >= 3; } },
    { t: 'Najdu jiné, chvíli to potrvá.', b: 1 },
    { t: 'To se mi stát nemůže.', b: -1 } ] },
  { q: 'Z čeho budete splácet?', a: [
    { t: 'Z provozu, splátka je pod polovinou zisku.', b: 2, overit: function () { return monthlyProfit() > 0 && splatkyMesicne() < monthlyProfit() * 0.5; } },
    { t: 'Z provozu, ale bude to těsné.', b: 1 },
    { t: 'Z dalšího úvěru.', b: -2 } ] },
  { q: 'Sledujete, kde staví konkurence?', a: [
    { t: 'Ano, mapu si hlídám.', b: 1 },
    { t: 'Moc ne.', b: 0 } ] },
  { q: 'Kolik prádlomatů chcete mít za rok?', a: [
    { t: 'O pár víc, než mám teď.', b: 2 },
    { t: 'Rád bych síť zdvojnásobil.', b: 1 },
    { t: 'Desetkrát tolik.', b: -1 } ] },
  { q: 'Máte s provozem zkušenost?', a: [
    { t: 'Pár prádlomatů už mi běží.', b: 2, overit: function () { return S.units.length >= 3; } },
    { t: 'Začínám, učím se za pochodu.', b: 1 },
    { t: 'Žádnou.', b: 0 } ] },
  { q: 'A kdyby se splácet nedařilo?', a: [
    { t: 'Prodám část sítě a dluh srovnám.', b: 2 },
    { t: 'Přijdu se s vámi domluvit.', b: 1 },
    { t: 'To nevím.', b: -1 } ] }
];
// Hodnocení pohovoru: kolik bodů, co to udělá s limitem a se sazbou.
function pohovorStupen(body, otazek) {
  var max = otazek * 2;
  var podil = max > 0 ? body / max : 0;
  if (podil >= 0.7) return { nazev: 'výborné', limit: 1.2, sazba: -0.003, ok: true,
    slovo: 'Takhle připravené klienty máme rádi. Dáme vám lepší sazbu i vyšší limit.' };
  if (podil >= 0.4) return { nazev: 'dobré', limit: 1, sazba: 0, ok: true,
    slovo: 'Nic mimořádného, ale drží to pohromadě. Podmínky standardní.' };
  if (podil >= 0.15) return { nazev: 'slabé', limit: 0.8, sazba: 0.003, ok: true,
    slovo: 'Mám z toho rozpaky. Půjčíme míň a dráž.' };
  return { nazev: 'nedostatečné', limit: 0, sazba: 0, ok: false,
    slovo: 'Takhle ne. Vraťte se, až budete mít věci srovnané.' };
}
// Vlastní pohovor. `kolik` otázek, `hotovo` dostane výsledek.
function pohovorSheet(kolik, nadpis, hotovo) {
  var poradi = OTAZKY.map(function (o, i) { return i; });
  for (var i = poradi.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1)), t = poradi[i]; poradi[i] = poradi[j]; poradi[j] = t;
  }
  poradi = poradi.slice(0, Math.min(kolik, OTAZKY.length));
  var krok = 0, body = 0, prichyceno = 0;
  function dalsi() {
    if (krok >= poradi.length) {
      var st = pohovorStupen(body, poradi.length);
      sheet('<h3>' + esc(nadpis) + '</h3>'
        + '<div class="nalada"><b>Hodnocení: ' + st.nazev + '</b><span>' + esc(st.slovo) + '</span></div>'
        + (prichyceno ? '<p class="fine err">Rizikoř si ' + prichyceno + '× ověřil, co jste říkal, a nesedělo to. '
          + 'To s hodnocením zamávalo víc, než kdybyste odpověděl na rovinu.</p>' : '')
        + '<button class="btn big" id="poh-ok">Pokračovat</button>');
      $('poh-ok').onclick = function () { closeSheet(); hotovo(st); };
      return;
    }
    var o = OTAZKY[poradi[krok]];
    sheet('<h3>' + esc(nadpis) + '</h3>'
      + '<p class="fine">Otázka ' + (krok + 1) + ' z ' + poradi.length + '</p>'
      + '<p class="muted small" style="margin:6px 0 12px;font-size:15px;color:var(--text)">' + esc(o.q) + '</p>'
      + o.a.map(function (x, i) {
          return '<button class="btn sec" style="width:100%;margin-top:8px;text-align:left" data-odp="' + i + '">' + esc(x.t) + '</button>';
        }).join(''));
    [].forEach.call(document.querySelectorAll('[data-odp]'), function (b) {
      b.onclick = function () {
        var x = o.a[Number(b.getAttribute('data-odp'))];
        // Kdo tvrdí něco, co stav hry vyvrací, dostane mínus místo plusu.
        if (x.overit && !x.overit()) { body -= 2; prichyceno++; }
        else body += x.b;
        krok++; dalsi();
      };
    });
  }
  dalsi();
}

// ─── Krach ──────────────────────────────────────────────────────────────────
// Tři neuhrazené splátky po sobě a je po firmě. Varování chodí předem, takže
// hráč má čas něco prodat a zachránit se — a protože se to ví, je komu prodat.
var KRACH_SPLATEK = 3;
// Nejvyšší počet zmeškaných splátek, který na některém úvěru visí.
function zmeskanoNejvic() {
  return (S.loans || []).reduce(function (a, l) { return Math.max(a, l.zmeskano || 0); }, 0);
}
function hroziKrach() { return zmeskanoNejvic() > 0 && zmeskanoNejvic() < KRACH_SPLATEK; }
function jeKrach() { return zmeskanoNejvic() >= KRACH_SPLATEK; }
// Varování se ukáže jen jednou za každý stupeň, ať neotravuje každých pár vteřin.
function hlidejKrach() {
  var z = zmeskanoNejvic();
  if (!z) { S.krachVarovano = 0; return; }
  if ((S.krachVarovano || 0) >= z) return;
  S.krachVarovano = z;
  if (z >= KRACH_SPLATEK) { krachSheet(); return; }
  toast(z === 1
    ? 'Nezaplatil jsi splátku. Prodej něco na Burze, nebo splať, než to banka zvedne.'
    : 'Druhá neuhrazená splátka. Ještě jedna a banka pošle firmu do konkurzu.', 'err');
}
// Rozprodej majetku. Prádlomaty i stroje jdou z ruky za zlomek hodnoty,
// výtěžek nejdřív bance a co zbude, patří hráči. Místa se uvolní — a protože
// jsou zasíťovaná, někdo je postaví lacino.
var KRACH_PODIL = 0.6;   // střed rozmezí, ve kterém se majetek v konkurzu prodává
function provedKonkurz() {
  // Majetek jde na burzu — cena tam klesá z 80 % na 40 % během herního měsíce.
  // Co se neprodá, propadne; hráči se připisují peníze průběžně, jak kdo kupuje.
  var polozky = [];
  S.units.forEach(function (u) {
    polozky.push({ predmet: 'pradlomat', model: u.eco.model, spot_id: u.spotId,
      popis: u.name || 'prádlomat', hodnota: Math.round(u.eco.invest || machinePrice(MODELS[u.eco.model])) });
    apiJson('/spots/release', { spot_id: u.spotId });   // místo se uvolní konkurenci
  });
  MODEL_ORDER.forEach(function (k) {
    for (var i = 0; i < inStock(k); i++) {
      polozky.push({ predmet: 'stroj', model: k, popis: 'stroj ' + MODELS[k].name, hodnota: machinePrice(MODELS[k]) });
    }
  });
  (S.orders || []).forEach(function (o) {
    polozky.push({ predmet: 'stroj', model: o.model, popis: 'stroj ' + MODELS[o.model].name + ' (na cestě)',
      hodnota: machinePrice(MODELS[o.model]) });
  });
  (S.pobocky || []).forEach(function (b) {
    polozky.push({ predmet: 'pobocka', spot_id: b.name, popis: 'pobočka ' + b.name, hodnota: POBOCKA_CENA });
  });
  if (polozky.length) apiJson('/trade/konkurz', { polozky: polozky });

  // Technika čety se prodá rovnou, na tu se na burze kupec nehledá.
  var utrzeno = maCetu() ? Math.round(CETA_CENA * KRACH_PODIL) : 0;
  var mel = S.units.length;
  S.units = []; S.stock = {}; S.orders = []; S.pobocky = []; S.ceta = null;
  CLAIMS = {};

  // Nejdřív banka, zbytek hráči.
  var naDluh = Math.min(utrzeno + Math.max(0, S.cash), S.loan);
  var zdroje = utrzeno + Math.max(0, S.cash);
  splatitDluh(naDluh);
  S.cash = Math.max(0, zdroje - naDluh);
  // Co se z majetku nepokrylo, banka odepíše — to je smysl konkurzu. Jinak by
  // hráč vyšel bez sítě a s dluhem, na který nemá z čeho platit, a spadl hned znovu.
  var odepsano = S.loan;
  S.loans = [];
  prepocitejDluh();
  S.krachVarovano = 0;
  save(); paint(); syncState(true);
  return { utrzeno: utrzeno, naDluh: naDluh, zbylo: S.cash, odepsano: odepsano, mel: mel };
}
function krachSheet() {
  sheet('<h3>Konkurz</h3>'
    + '<p class="muted small">Tři splátky po sobě neuhrazené. Banka firmu poslala do konkurzu '
    + 'a tvůj majetek jde na měsíc na Burzu — stroje, prádlomaty i s místy, pobočky i karty. '
    + 'Cena začíná na 80 % hodnoty a během herního měsíce klesá ke 40 %.</p>'
    + '<div class="kv"><span>Dlužíš</span><b class="err">' + kcFull(S.loan) + '</b></div>'
    + '<div class="kv"><span>Prádlomatů v síti</span><b>' + S.units.length + '</b></div>'
    + '<p class="muted small" style="margin-top:12px">Co se prodá, jde nejdřív bance. Co zbude, je tvoje. '
    + 'Můžeš hrát dál se škraloupem — herní rok bez úvěru, pak jen na jeden prádlomat s vyšší akontací — '
    + 'nebo začít znovu s čistou úvěrovou historií. Účet, firma, znak i zaplacené karty ti zůstanou tak jako tak.</p>'
    + '<button class="btn sec big" id="krach-dal">Hrát dál se škraloupem</button>'
    + '<button class="btn big" id="krach-znovu" style="margin-top:8px;background:linear-gradient(90deg,#b4263a,#ff5d6c)">Začít znovu s čistým štítem</button>');
  $('krach-dal').onclick = function () {
    var v = provedKonkurz();
    // Škraloup: rok bez úvěru. Zmeškané splátky vynulujeme, ať se konkurz
    // nespustí znovu hned v dalším měsíci.
    S.skraloupDo = Date.now() + YEAR_MS;
    (S.loans || []).forEach(function (l) { l.zmeskano = 0; });
    save(); paint();
    sheet('<h3>Po konkurzu</h3>'
      + '<div class="kv"><span>Rozprodáno</span><b>' + kcFull(v.utrzeno) + '</b></div>'
      + '<div class="kv"><span>Z toho bance</span><b class="warn">' + kcFull(v.naDluh) + '</b></div>'
      + '<div class="kv souhrn"><span>Zbylo ti</span><b class="ok">' + kcFull(v.zbylo) + '</b></div>'
      + (v.odepsano > 0 ? '<div class="kv"><span>Banka odepsala</span><b>' + kcFull(v.odepsano) + '</b></div>' : '')
      + '<p class="muted small" style="margin-top:12px">Tvůj majetek je teď herní měsíc na Burze — '
      + 'cena klesá z 80 % na 40 % hodnoty a co se prodá, připíše se ti průběžně. '
      + v.mel + ' ' + mn(v.mel, 'místo se uvolnilo', 'místa se uvolnila', 'míst se uvolnilo')
      + ' konkurenci; zůstala tam ale síť přípojek, takže je někdo postaví lacino. '
      + 'Banka ti herní rok nepůjčí.</p>'
      + '<button class="btn big" id="krach-ok">Rozumím</button>');
    $('krach-ok').onclick = closeSheet;
  };
  $('krach-znovu').onclick = function () {
    var y = $('krach-znovu'); y.disabled = true; y.textContent = 'Mažu…';
    apiJson('/account/reset', {}).then(function (r) {
      if (!r.ok) { y.disabled = false; y.textContent = 'Začít znovu s čistým štítem'; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
      wiped = true;
      try { localStorage.removeItem(KEY); } catch (e) { /* nevadí */ }
      location.replace(location.pathname);
    }).catch(function () { y.disabled = false; y.textContent = 'Začít znovu s čistým štítem'; toast('Server neodpovídá.', 'err'); });
  };
}
// Po krachu banka rok nepůjčí.
function maSkraloup() { return (S.skraloupDo || 0) > Date.now(); }

// ─── Vlastní stavební četa ──────────────────────────────────────────────────
// Technika a dva lidi v sídle nebo na pobočce. Četa staví přípojky za pětinu
// ceny a zvládne čtyři místa za herní měsíc — vyplatí se jen tomu, kdo opravdu
// expanduje. Pod dvě místa měsíčně prodělává.
var CETA_TECHNIKA = [
  { id: 'bagr', nazev: 'Minibagr', cena: 800000 },
  { id: 'dodavka', nazev: 'Dodávka', cena: 600000 },
  { id: 'vrtacka', nazev: 'Jádrová vrtačka', cena: 80000 },
  { id: 'deska', nazev: 'Vibrační deska', cena: 50000 }
];
var CETA_CENA = CETA_TECHNIKA.reduce(function (a, x) { return a + x.cena; }, 0);  // 1 530 000
var CETA_MZDY = 80000;            // dva lidi po 40 tisících
var CETA_PHM_KM = 15;             // za kilometr tam a zpět
var CETA_PODIL = 0.2;             // přípojky za pětinu ceny
var CETA_MIST = 4;                // kolik míst zvládne za herní měsíc
var SHANEC_MZDA = 50000;          // kdo místa vyhledává a domlouvá sám

function maCetu() { return !!(S.ceta && S.ceta.od); }
function maShanece() { return !!(S.ceta && S.ceta.shanec); }
// Měsíční režie čety: mzdy, případný sháněč a PHM za připravená místa.
function cetaMesicne() {
  if (!maCetu()) return 0;
  return CETA_MZDY + (maShanece() ? SHANEC_MZDA : 0) + (S.ceta.phm || 0);
}
// Kolik stála poslední jízda na tohle místo — platí se za každé připravené.
function cetaPhmNa(sp) {
  var n = nejblizsiZakladna(sp);
  if (!n) return 0;
  return Math.round(n.km * 2 * CETA_PHM_KM);
}
// Kolik míst četa tenhle herní měsíc ještě zvládne.
function cetaZbyva() {
  if (!maCetu()) return 0;
  var mesic = Math.floor(Date.now() / MONTH_MS);
  if (S.ceta.mesic !== mesic) { S.ceta.mesic = mesic; S.ceta.hotovo = 0; S.ceta.phm = 0; }
  return Math.max(0, CETA_MIST - (S.ceta.hotovo || 0));
}
// Může četa postavit přípojky na tomhle místě? Na zasíťovaném nemá co dělat —
// to stojí 10 % i bez ní.
function cetaZvladne(sp) { return maCetu() && !jeZasitovane(sp) && cetaZbyva() > 0; }
// Zapíše, že četa jedno místo připravila.
function cetaPostavila(sp) {
  if (!maCetu() || cetaZbyva() <= 0) return;
  S.ceta.hotovo = (S.ceta.hotovo || 0) + 1;
  S.ceta.phm = (S.ceta.phm || 0) + cetaPhmNa(sp);
}

// Místa, kde už někdy stál prádlomat — přípojky tam zůstaly. Plní se ze serveru.
var ZASITOVANE = {};
function jeZasitovane(sp) { return !!ZASITOVANE[sp && sp.id]; }
// Podíl z plné ceny přípojek, který platí ten, kdo staví na zasíťované místo.
var INSTALACE_PODIL = 0.1;
function connPrice(sp, modelKey) {
  var base = CONN_MIN + spotHash(sp.id, 'c') * (CONN_MAX - CONN_MIN);
  if (modelKey === 'max') base *= CONN_MAX_MULT;
  // Voda, odpad i elektřina tu už jsou — platí se jen postavení a zapojení stroje.
  if (jeZasitovane(sp)) base *= INSTALACE_PODIL;
  // Vlastní četa to udělá za pětinu — ale jen na panenském místě a dokud má kapacitu.
  else if (cetaZvladne(sp)) base *= CETA_PODIL;
  // Karta „Známý řemeslník" platí na jednu stavbu a spotřebuje se až při ní.
  if (S && S.connDiscount) base *= (1 - S.connDiscount);
  return Math.round(base / 1000) * 1000;
}
// Úrok a rámec po případné kartě „Lepší bankéř".
function rateOf() { return Math.max(0.02, PROFILES[S.profile].rate - (S.rateDrop || 0)); }
// Skutečná sazba, kterou hráč platí ze svého dluhu. Banka si u každé půjčky
// řekne přirážku podle zadluženosti a ta pak na tom dluhu zůstane — stejně jako
// doopravdy. Při další půjčce se sazby zprůměrují podle částek.
// Vážený průměr sazeb na dluhu — jedno číslo do přehledu.
function urokSazba() {
  var d = S.loan || 0;
  if (d <= 0) return rateOf();
  return Math.max(0.02, urokMesicne() * 12 / d);
}
// Riziková přirážka za novou tranši: rozhoduje zadluženost PO načerpání.
function prirazkaZa(castka) {
  var majetek = assetsTotal();
  var pak = majetek > 0 ? (S.loan + Math.max(0, castka)) / majetek : 2;
  return pak <= 0.5 ? 0 : pak <= 0.8 ? 0.008 : pak <= 1 ? 0.018 : 0.03;
}

// ─── Úvěry ──────────────────────────────────────────────────────────────────
// Dluh není jeden hrnec, ale seznam konkrétních úvěrů. Jen tak jde říct
// „tenhle prádlomat je doplacený", posoudit, jestli si místo vydělá na svou
// splátku, a vést úvěrovou historii. S.loan zůstává jako součet zbytků —
// počítá s ním spousta míst ve hře i žebříček na serveru.
var UVER_MESICU = 60;             // pevná splátka na pět herních let
// Anuita: stejná splátka každý měsíc, v ní se mění poměr úroku a jistiny.
function anuita(jistina, sazba, mesicu) {
  if (!(jistina > 0) || !(mesicu > 0)) return 0;
  var r = sazba / 12;
  if (r <= 0) return Math.ceil(jistina / mesicu);
  return Math.ceil(jistina * r / (1 - Math.pow(1 + r, -mesicu)));
}
// S.loan a S.loanPrem jsou dopočítané — nikdy se nenastavují ručně.
function prepocitejDluh() {
  var loans = S.loans || (S.loans = []);
  var celkem = 0, urokRok = 0;
  loans.forEach(function (l) { celkem += l.zbyva; urokRok += l.zbyva * l.sazba; });
  S.loan = Math.round(celkem);
  S.loanPrem = celkem > 0 ? Math.max(0, (urokRok / celkem) - rateOf()) : 0;
}
// Nový úvěr. `vazba` říká, na co je — podle toho se pozná doplacený prádlomat.
function pricistDluh(castka, prirazka, vazba, mesicu) {
  castka = Math.round(castka || 0);
  if (!(castka > 0)) return null;
  if (!S.loans) S.loans = [];
  var sazba = Math.max(0.02, rateOf() + (prirazka || 0));
  var l = {
    id: 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
    druh: (vazba && vazba.druh) || 'provoz',
    spotId: (vazba && vazba.spotId) || null,
    popis: (vazba && vazba.popis) || 'Provozní úvěr',
    puvodni: castka, zbyva: castka, sazba: sazba,
    mesicu: mesicu || UVER_MESICU, zbyvaMesicu: mesicu || UVER_MESICU,
    splatka: anuita(castka, sazba, mesicu || UVER_MESICU),
    zalozen: Date.now(), zmeskano: 0
  };
  S.loans.push(l);
  prepocitejDluh();
  return l;
}
// Mimořádná splátka. Nejdřív nejdražší úvěr — to je to, co by udělal každý.
function splatitDluh(castka) {
  castka = Math.max(0, Math.round(castka || 0));
  if (!S.loans || !S.loans.length || !castka) return 0;
  var poradi = S.loans.slice().sort(function (a, b) { return b.sazba - a.sazba; });
  var splaceno = 0, dosplaceno = 0;
  poradi.forEach(function (l) {
    if (castka <= 0 || l.zbyva <= 0) return;
    var dam = Math.min(castka, l.zbyva);
    l.zbyva -= dam; castka -= dam; splaceno += dam;
    if (l.zbyva < 1) { l.zbyva = 0; dosplaceno++; zapisDoplacene(l); }
  });
  if (dosplaceno) {
    S.stats.splaceno = (S.stats.splaceno || 0) + dosplaceno;
    S.loans = S.loans.filter(function (l) { return l.zbyva > 0; });
  }
  prepocitejDluh();
  return splaceno;
}
// Měsíční splátka všech úvěrů. Co hráč nemá, zůstává viset na dluhu a počítá
// se jako zmeškaná splátka — z toho jednou vyroste krach.
function mesicniSplatka() {
  if (!S.loans || !S.loans.length) return;
  var dosplaceno = 0;
  S.loans.forEach(function (l) {
    if (l.zbyva <= 0) return;
    var urok = l.zbyva * l.sazba / 12;
    var chce = Math.min(l.splatka, l.zbyva + urok);   // poslední splátka bývá menší
    var ma = Math.max(0, S.cash);
    var dal = Math.min(chce, ma);
    S.cash -= dal;
    l.zbyva = Math.max(0, l.zbyva + urok - dal);
    drip.pay += dal;
    S.stats.interest += urok;
    if (dal < chce - 0.5) {
      l.zmeskano = (l.zmeskano || 0) + 1;
      S.stats.zmeskano = (S.stats.zmeskano || 0) + 1;
    } else if (l.zmeskano) {
      l.zmeskano = 0;                                  // doplatil, karta čistá
    }
    l.zbyvaMesicu = Math.max(0, (l.zbyvaMesicu || 0) - 1);
    if (l.zbyva < 1) { l.zbyva = 0; dosplaceno++; zapisDoplacene(l); }
  });
  if (dosplaceno) {
    S.stats.splaceno = (S.stats.splaceno || 0) + dosplaceno;
    S.loans = S.loans.filter(function (l) { return l.zbyva > 0; });
  }
  prepocitejDluh();
  hlidejRamec();
}
// ─── Rámcový úvěr ───────────────────────────────────────────────────────────
// Schválený objem, ze kterého hráč čerpá na další prádlomaty bez nového
// pohovoru — dokud mu síť plní podmínky. Musí si ho zasloužit: dva plně
// doplacené prádlomaty.
var RAMEC_ZA_MISTO = 1200000;     // o kolik limit povyroste s každým doplaceným místem
var RAMEC_KRYTI = 1.0;            // pod tímhle pokrytím je místo pod vodou
var RAMEC_LHUTA = YEAR_MS;        // jak dlouho smí být síť slabá, než rámec padne
function doplacenychMist() { return (S.stats && S.stats.splacenoMist) || 0; }
function maRamec() { return !!(S.ramec && S.ramec.limit > 0 && !S.ramec.zavreny); }
function ramecLze() { return !maSkraloup() && doplacenychMist() >= 2; }
// Doplacený prádlomat — na tom stojí cesta k rámcovému úvěru.
function zapisDoplacene(l) {
  if (l && l.spotId) S.stats.splacenoMist = (S.stats.splacenoMist || 0) + 1;
}
// Kolik z rámce zbývá k čerpání — vždy ještě omezené tím, co firma unese.
function ramecVolny() {
  if (!maRamec() || S.ramec.slabyOd) return 0;
  var zbyva = Math.max(0, S.ramec.limit - (S.ramec.cerpano || 0));
  return Math.min(zbyva, stropPodleZisku(monthlyProfit() - splatkyMesicne(), zbyva));
}
// Základní limit podle historie a výdělku.
function ramecNavrh() {
  var podleHistorie = RAMEC_ZA_MISTO * Math.max(1, doplacenychMist() - 1);
  return Math.max(0, Math.round(Math.min(podleHistorie,
    stropPodleZisku(monthlyProfit() - splatkyMesicne(), podleHistorie)) / 10000) * 10000);
}
// Místa, která nevydělají ani na svou splátku.
function slabaMista() {
  return S.units.filter(function (u) {
    var l = uverMista(u);
    if (!l) return false;
    var splatka = Math.min(l.splatka, l.zbyva + l.zbyva * l.sazba / 12);
    return splatka > 0 && u.eco.profit / splatka < RAMEC_KRYTI;
  });
}
// Hlídání podmínek. Varování → zastavené čerpání → po roce zavřený rámec.
function hlidejRamec() {
  if (!maRamec()) return;
  var slabych = slabaMista().length;
  if (!slabych) {
    if (S.ramec.slabyOd) { S.ramec.slabyOd = null; toast('Síť je zase v pořádku, rámec máš otevřený.', 'ok'); }
    return;
  }
  if (!S.ramec.slabyOd) {
    S.ramec.slabyOd = Date.now();
    toast(slabych + ' ' + mn(slabych, 'místo nevydělá', 'místa nevydělají', 'míst nevydělá')
      + ' na svou splátku. Dokud to trvá, z rámce čerpat nemůžeš.', 'err');
    return;
  }
  if (Date.now() - S.ramec.slabyOd > RAMEC_LHUTA) {
    S.ramec.zavreny = Date.now();
    toast('Banka ti zavřela rámec — síť rok nesplňovala podmínky. Co je načerpané, splácíš dál.', 'err');
  }
}

// ─── Rizikoř ────────────────────────────────────────────────────────────────
// Má den ode dne jinou náladu a dá ji najevo hned, jak hráč vejde. Nálada je
// daná hráčem a herním měsícem, takže se nedá překlikat obnovením stránky —
// a nikdy neobejde tvrdá pravidla, hýbe jen cenou a ochotou.
var NALADY = [
  { id: 'vstricny', nazev: 'Vstřícný den', slovo: 'Dneska mám dobrý den, tak se domluvíme.',
    sazba: -0.0015, castka: 1.05, splatnost: 1 },
  { id: 'bezny', nazev: 'Běžný den', slovo: 'Jedeme podle pravidel, nic víc, nic míň.',
    sazba: 0, castka: 1, splatnost: 0 },
  { id: 'prisny', nazev: 'Přísný den', slovo: 'Dneska jsem opatrný, tak se nedivte.',
    sazba: 0.0015, castka: 0.95, splatnost: 0 },
  { id: 'audit', nazev: 'Po auditu', slovo: 'Máme po kontrole. Držím se předpisů do písmene.',
    sazba: 0.0015, castka: 0.95, splatnost: -1 }
];
function naladaDnes() {
  var mesic = Math.floor(Date.now() / MONTH_MS);
  var h = spotHash((S && S.pid ? S.pid : 'x') + ':' + mesic, 'nalada');
  return NALADY[Math.min(NALADY.length - 1, Math.floor(h * NALADY.length))];
}
// Delší splatnost sráží splátku, ale prodraží se na úrocích — a banka ji nedá
// každému. Rozhoduje historie splacených úvěrů, ne náhoda.
var SPLATNOSTI = [
  { mesicu: 60, nazev: '5 let', prirazka: 0 },
  { mesicu: 84, nazev: '7 let', prirazka: 0.004 },
  { mesicu: 120, nazev: '10 let', prirazka: 0.009 }
];
function maxSplatnost() {
  var splacenych = (S.stats && S.stats.splaceno) || 0;
  var stupen = splacenych >= 2 ? 2 : splacenych >= 1 ? 1 : 0;
  stupen += naladaDnes().splatnost;
  return Math.max(0, Math.min(SPLATNOSTI.length - 1, stupen));
}
// Proč delší splatnost nedostane — vždycky i s tím, za co by to bylo ano.
function splatnostDuvod(i) {
  var splacenych = (S.stats && S.stats.splaceno) || 0;
  if (naladaDnes().id === 'audit') return 'Dneska je rizikoř po auditu a drží se základní splatnosti. Zkus to zítra.';
  if (splacenych === 0) return 'Nemáš za sebou jediný splacený úvěr, takže banka nemá podle čeho soudit. Splať první úvěr a vrať se.';
  if (splacenych === 1 && i >= 2) return 'S jedním splaceným úvěrem ti banka dá nejvýš sedm let. Na deset se vrať, až budeš mít dva.';
  return 'Na tuhle splatnost zatím nedosáhneš.';
}

// Banka nepůjčí podle toho, co máš, ale podle toho, co to uživí. Kolik musí
// zisk pokrýt splátku, aby úvěr dala — stejné číslo, jaké se ukazuje u místa.
var KRYTI_MIN = 1.25;
// Z měsíčního zisku spočítá, jak velkou jistinu jeho splátka unese.
function uneseDluh(mesicniZisk, sazba) {
  var splatka = Math.max(0, mesicniZisk) / KRYTI_MIN;
  if (!(splatka > 0)) return 0;
  var r = sazba / 12;
  if (r <= 0) return Math.floor(splatka * UVER_MESICU);
  return Math.floor(splatka * (1 - Math.pow(1 + r, -UVER_MESICU)) / r);
}
// Totéž za celou firmu: co síť vydělá, minus splátky, které už běží.
function firmaUneseDluh(sazba) {
  return uneseDluh(monthlyProfit() - splatkyMesicne(), sazba);
}
// Zástava v hotovosti, kterou si hráč koupil v „Dobít banku“. Takový úvěr je
// krytý 1:1, takže u něj banka nekouká na výdělek — ale jen do výše zástavy.
// Volná je ta část, kterou ještě nespotřeboval dluh nad to, co uživí zisk.
function duveraVolna() {
  var cela = Math.max(0, (S && S.duvera) || 0);
  if (cela <= 0) return 0;
  var unese = uneseDluh(monthlyProfit(), Math.max(0.02, rateOf() + (S.loanPrem || 0)));
  return Math.max(0, cela - Math.max(0, S.loan - unese));
}
// Co banka bere jako krytí: majetek pořízený podle LTV profilu plus
// hotovostní zástava, která kryje úvěr 1:1.
function zastavaStrop(majetekNavic) {
  return PROFILES[S.profile].ltv * (assetsTotal() + (majetekNavic || 0))
    + Math.max(0, (S && S.duvera) || 0);
}
// Startovní úvěr na stroj. Firma bez historie nemá žádný výdělek, který by
// banka posoudila — jenže stroj je zástava, kterou si v případě problému
// odveze a prodá. Takže první stroj půjčuje proti němu samému, jako leasing.
// Výdělek chce vidět až u přípojek — ty z místa vytrhnout nejdou.
function jeZacatek() {
  if (!S || maSkraloup()) return false;
  if (S.units && S.units.length) return false;
  if (S.orders && S.orders.length) return false;
  if (S.loan > 0) return false;
  for (var k in (S.stock || {})) if (S.stock[k] > 0) return false;
  return true;
}
// Strop pro první stroj: tolik, kolik unese zástava. Null = posuď to běžně,
// podle toho, co firma vydělává.
function zamerStrop(modelKey, castka) {
  if (!jeZacatek()) return null;
  return Math.max(0, zastavaStrop(castka) - S.loan);
}
// Strop pro konkrétní úvěr. `zisk` je měsíční zisk toho, co se financuje —
// u místa jeho vlastní, u stroje bez místa a u provozního úvěru celá firma.
function stropPodleZisku(zisk, odhadCastky) {
  var sazba = Math.max(0.02, rateOf() + prirazkaZa(odhadCastky || 0));
  var strop = uneseDluh(zisk, sazba);
  // Menší úvěr má menší přirážku, takže strop ještě jednou zpřesníme.
  return uneseDluh(zisk, Math.max(0.02, rateOf() + prirazkaZa(strop))) + duveraVolna();
}

// Úvěr, který patří ke konkrétnímu místu.
function uverMista(u) {
  if (!u || !S.loans) return null;
  return S.loans.filter(function (l) { return l.spotId && l.spotId === u.spotId; })[0] || null;
}
// Měsíční nájem: lepší místo si řekne o víc, zbytek je o tom, jak se domluvíš.
function rentOf(sp) {
  var attract = 0.7 + (Math.max(0, Math.min(100, sp.score)) / 100) * 0.8;
  var deal = 0.9 + spotHash(sp.id, 'r') * 0.3;
  return Math.round(RENT_EUR * EUR * attract * deal / 100) * 100;
}

// Kolik lidí ti otevřelo sdílený odkaz → o tolik víc zákazníků chodí.
// Strop návštěvnosti roste o to, co přidaly karty — jinak by zaplacená kampaň zapadla.
function trafficMax() { return TRAFFIC_MAX + (S && S.boost ? S.boost : 0); }
function traffic() { return Math.min(trafficMax(), TRAFFIC_BASE + (S && S.refs ? S.refs : 0) * TRAFFIC_PER_REF + (S && S.boost ? S.boost : 0)); }
// Servis, praní a úklid se platí z obratu - cim vic lidi pere, tim vic prace.
function economics(spot, modelKey) {
  var m = MODELS[modelKey] || MODELS.flex;
  var perday = m.perday * placeFactor(spot.score) * traffic();
  var revenue = Math.round(perday * 30.5 * m.spend * EUR);
  var energy = Math.round(revenue * ENERGY_SHARE);
  var servis = Math.round(revenue * SERVIS_SHARE);
  var rent = rentOf(spot);
  var cost = energy + servis + rent;
  var profit = revenue - cost;
  var conn = connPrice(spot, m.key);
  var inv = machinePrice(m) + conn;
  return { model: m.key, invest: inv, machine: machinePrice(m), install: conn, conn: conn,
    energy: energy, servis: servis, rent: rent, revenue: revenue, cost: cost, profit: profit,
    perday: Math.round(perday * 10) / 10, payback: profit > 0 ? inv / (profit * 12) : null };
}

// ─── Profily hráče ───────────────────────────────────────────────────────────
var PROFILES = {
  opatrny: { id: 'opatrny', name: 'Opatrný stavitel', cash: 1500000, ltv: 0.70, rate: 0.096,
    desc: 'Nerad dlužíš. Banka ti proto půjčí míň, zato nejlevněji — a začínáš s nejtlustší peněženkou.' },
  vyvazeny: { id: 'vyvazeny', name: 'Vyvážený podnikatel', cash: 1400000, ltv: 0.85, rate: 0.114,
    desc: 'Riziko bereš jako nástroj, ne jako adrenalin. Rozumný úvěr, rozumný úrok.' },
  dravy: { id: 'dravy', name: 'Dravý expanzista', cash: 1300000, ltv: 1.00, rate: 0.132,
    desc: 'Chceš růst rychle a na dluh. Banka ti zaplatí i celý prádlomat, ale nechá si za to zaplatit. Na první prádlomat máš i tak dost — začíná se bez dluhu.' }
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
var PID_KEY = 'lm_milionar_pid';
var REF_FROM_KEY = 'lm_ref_from';   // přes čí odkaz jsem do hry přišel
var S = null;
// Id pro pozvánky žije mimo rozehranou hru. Když si hráč dá „začít znovu",
// sdílený odkaz musí platit dál — jinak přijde o pozvánky, které už rozeslal.
function trvalePid() {
  var id = null;
  try { id = localStorage.getItem(PID_KEY); } catch (e) { /* nevadí */ }
  if (!/^[a-z0-9]{6,24}$/.test(id || '')) {
    id = (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)).slice(0, 12);
  }
  try { localStorage.setItem(PID_KEY, id); } catch (e) { /* nevadí */ }
  return id;
}
function fresh(profileId) {
  var p = PROFILES[profileId];
  var now = Date.now();
  return {
    v: 1, profile: profileId, startedAt: now, lastTick: now,
    cash: p.cash, bank: BANK_BASE, loan: 0,
    loanPrem: 0,      // dopočítaná průměrná přirážka na dluhu
    loans: [],        // jednotlivé úvěry: každý se svou sazbou a splátkou
    sidlo: null,      // { name, lat, lon } — vybere se hned na začátku
    tut: 1,           // krok tutoriálu; 'done' = má to za sebou
    ceta: null,       // vlastní stavební parta: { od, shanec, mesic, hotovo, phm }
    ramec: null,      // rámcový úvěr: { limit, cerpano, od, slabyOd, zavreny }
    pobocky: [],      // další základny, ze kterých se počítá doprava
    splatkyAt: now,   // odkdy se počítají měsíční splátky
    areas: {},     // id oblasti → { name, scoutedAt, spots:[…] }
    units: [],     // postavené prádlomaty
    revealed: {},  // id místa → true
    leases: {},    // id místa → { rent, at } — domluvený nájem
    pid: trvalePid(),
    refs: 0,       // kolik lidí otevřelo sdílený odkaz
    orders: [],    // koupené stroje na cestě: { model, arrivesAt }
    stock: {},     // model → kolik kusů čeká na skladě
    boost: 0,         // trvalé zvýšení návštěvnosti z karet
    connDiscount: 0,  // sleva na přípojky na nejbližší stavbě
    rateDrop: 0,      // snížení úroku z karty
    bankBonus: 0,     // navýšení bankovního rámce z karty
    stats: { earned: 0, interest: 0 }
  };
}
// Finder nekdy vraci metriky jako objekt { count, nearest_m, list } - potrebujeme z nich cislo.
function mnum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.count === 'number') return v.count;
  return null;
}
function fixMetrics(sp) {
  if (!sp) return sp;
  if (sp.parking && typeof sp.parking === 'object' && sp.parking.nearest_m != null && sp.parking_m == null) {
    sp.parking_m = Math.round(sp.parking.nearest_m);
  }
  sp.parking = mnum(sp.parking);
  sp.competition = mnum(sp.competition);
  sp.anchors = mnum(sp.anchors);
  return sp;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* plná paměť — hra běží dál */ } }
// Doplňuje, co starší uložené hře chybí. Projde tím i síť ze serveru — ta
// mohla naposled běžet na starém klientovi a jinak by se migrace přeskočily.
function dosypStav(o) {
  try {
    if (!o || !o.profile) return null;
    // Rozehraná hra z verze bez obchodu — jen doplníme, co chybí, ať o síť nikdo nepřijde.
    if (!o.orders) o.orders = [];
    if (!o.stock) o.stock = {};
    if (!o.leases) o.leases = {};
    // Staré rozehrané hry mají pid uvnitř stavu — necháme jim ho a uložíme
    // bokem, ať přežije i případný reset.
    if (!/^[a-z0-9]{6,24}$/.test(o.pid || '')) o.pid = trvalePid();
    else { try { localStorage.setItem(PID_KEY, o.pid); } catch (e) { /* nevadí */ } }
    if (typeof o.refs !== 'number') o.refs = 0;
    // Rozehraná hra z doby, kdy byl dluh jeden hrnec: převedeme ho na jeden
    // úvěr, aby se dal splácet i hlídat stejně jako nové. Vázbu na stroj nemá
    // — do historie se započítá, až ho hráč splatí.
    if (!o.stats) o.stats = { earned: 0, interest: 0 };
    if (!Array.isArray(o.loans)) {
      o.loans = [];
      if (o.loan > 0) {
        var sz = Math.max(0.02, (PROFILES[o.profile] ? PROFILES[o.profile].rate : 0.114)
          - (o.rateDrop || 0) + (o.loanPrem || 0));
        o.loans.push({ id: 'u-stary', druh: 'stary', spotId: null, popis: 'Dřívější dluh',
          puvodni: Math.round(o.loan), zbyva: Math.round(o.loan), sazba: sz,
          mesicu: 60, zbyvaMesicu: 60,
          splatka: Math.ceil(o.loan * (sz / 12) / (1 - Math.pow(1 + sz / 12, -60))),
          zalozen: Date.now(), zmeskano: 0 });
      }
    }
    if (!o.splatkyAt) o.splatkyAt = Date.now();
    if (!Array.isArray(o.pobocky)) o.pobocky = [];
    // Rozehraná hra z doby před sídly: za sídlo bereme místo, kde hráč postavil
    // první prádlomat. Bez toho by mu doprava vycházela zdarma a pobočku by
    // si nikdy nemohl zřídit.
    if (!o.sidlo) {
      var prvni = (o.units || []).slice().sort(function (a, b) { return (a.builtAt || 0) - (b.builtAt || 0); })[0];
      if (prvni && prvni.lat != null) {
        var ob = o.areas && o.areas[prvni.areaId];
        var sp2 = (ob && ob.spots) || [];
        var la = 0, lo = 0, n = 0;
        sp2.forEach(function (x) { if (x.lat != null) { la += x.lat; lo += x.lon; n++; } });
        o.sidlo = { name: (ob && ob.name) || prvni.name || 'sídlo',
          lat: n ? la / n : prvni.lat, lon: n ? lo / n : prvni.lon, od: prvni.builtAt || Date.now() };
      } else o.sidlo = null;
    }
    // Kdo už něco postavil, tutoriál nepotřebuje. Kdo ne, dostane ho teď.
    if (o.tut == null) o.tut = (o.units || []).length ? 'done' : 1;
    if (o.ceta === undefined) o.ceta = null;
    if (o.ramec === undefined) o.ramec = null;
    if (typeof o.stats.splacenoMist !== 'number') o.stats.splacenoMist = 0;
    if (typeof o.stats.splaceno !== 'number') o.stats.splaceno = 0;
    if (typeof o.stats.zmeskano !== 'number') o.stats.zmeskano = 0;
    ['boost', 'connDiscount', 'rateDrop', 'bankBonus', 'loanPrem'].forEach(function (k) { if (typeof o[k] !== 'number') o[k] = 0; });
    // Stara ulozena mista mela metriky jako objekty { count, nearest_m } - srovname je na cisla.
    Object.keys(o.areas || {}).forEach(function (id) {
      ((o.areas[id] || {}).spots || []).forEach(fixMetrics);
    });
    o.v = 2;
    return o;
  } catch (e) { return null; }
}
function load() {
  try {
    var raw = localStorage.getItem(KEY); if (!raw) return null;
    return dosypStav(JSON.parse(raw));
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
// Rámec už nemá strop — jen narůstá. Jedinou brzdou je zástava, tedy kolik
// banka půjčí proti majetku. Dřív tu byl umělý hrnec, který hru brzdil i tomu,
// kdo měl čím ručit.
function bankCap() { return Infinity; }
// Navstevnost se meni podle pozvanek, takze uz postavene pradlomaty prepocitame.
// Investice, pripojky a domluveny najem zustavaji - to je zaplacene a podepsane.
function refreshUnits() {
  (S.units || []).forEach(function (u) {
    var m = MODELS[u.eco.model]; if (!m) return;
    var perday = m.perday * placeFactor(u.score) * traffic();
    var revenue = Math.round(perday * 30.5 * m.spend * EUR);
    u.eco.perday = Math.round(perday * 10) / 10;
    u.eco.revenue = revenue;
    u.eco.energy = Math.round(revenue * ENERGY_SHARE);
    u.eco.servis = Math.round(revenue * SERVIS_SHARE);
    u.eco.cost = u.eco.energy + u.eco.servis + u.eco.rent;
    u.eco.profit = revenue - u.eco.cost;
    u.eco.payback = u.eco.profit > 0 ? u.eco.invest / (u.eco.profit * 12) : null;
  });
}
function monthlyProfit() { return S.units.reduce(function (a, u) { return a + u.eco.profit; }, 0); }
// Co hráči na konci měsíce opravdu zbyde: co síť vydělá, minus všechno, co
// se platí pořád — celá splátka bance (úrok i jistina), pobočky a četa.
// Jedno číslo, jedna definice: stejně se počítá v hlavičce i v panelu Síť.
// Pozor: do tick() patří dál monthlyProfit(), tam se splátky stráhají zvlášť —
// kdyby se počítalo s čistým ziskem, strhly by se dvakrát.
function cistyZisk() { return monthlyProfit() - splatkyMesicne() - pobockyMesicne() - cetaMesicne(); }
function yearlyProfit() { return monthlyProfit() * 12; }
function tick() {
  refreshUnits();
  var now = Date.now();
  var dt = now - S.lastTick;
  if (dt < 0) { S.lastTick = now; return; }      // hráč si přetočil hodiny v telefonu
  if (dt > 30 * YEAR_MS) dt = 30 * YEAR_MS;      // po měsíci nepřítomnosti dál nenabíhá
  var years = dt / YEAR_MS;
  // Pobočky i četa stojí každý měsíc bez ohledu na to, jestli se staví.
  var earned = (yearlyProfit() - (pobockyMesicne() + cetaMesicne()) * 12) * years;
  // Do bubliny nad prádlomaty: zvlášť co přiteklo a co banka sebrala.
  drip.earn += Math.max(0, earned);
  S.cash += earned;
  S.stats.earned += Math.max(0, earned);
  S.bank = Math.min(bankCap(), S.bank + BANK_PER_DAY * (dt / 86400000));
  S.lastTick = now;
  // Úvěry se splácejí po celých herních měsících, ne plynule — splátka je
  // pevná a buď na ni hráč má, nebo ne.
  if (!S.splatkyAt) S.splatkyAt = now;
  var mesicu = Math.floor((now - S.splatkyAt) / MONTH_MS);
  if (mesicu > 0) {
    if (mesicu > 120) { mesicu = 120; S.splatkyAt = now; }   // po dlouhé pauze nedoháníme donekonečna
    else S.splatkyAt += mesicu * MONTH_MS;
    for (var i = 0; i < mesicu; i++) mesicniSplatka();
    hlidejKrach();
  }
  deliverOrders();
}

// ─── Čísla naskakující nad prádlomaty ───────────────────────────────────────
// Za vteřinu přiteče pár laundrů, což je na samostatnou bublinu málo. Sčítáme
// to proto a vypíšeme, až je z toho celé číslo — zeleně výnos, červeně úrok.
var drip = { earn: 0, pay: 0, i: 0 };
function dripPoint(i) {
  if (!map || !S.units.length) return null;
  var u = S.units[i % S.units.length];
  if (u.lat == null) return null;
  var p = map.latLngToContainerPoint([u.lat, u.lon]);
  var box = $('map').getBoundingClientRect();
  if (p.x < 0 || p.y < 0 || p.x > box.width || p.y > box.height) return null;
  return p;
}
function dripShow(text, cls, p) {
  var el = document.createElement('div');
  el.className = 'drip ' + cls;
  el.textContent = text;
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  $('map').appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1600);
}
// Bublina nad hotovostí v hlavičce — tu hráč vidí v každé záložce.
function headDrip(text, cls) {
  var host = $('t-cash').parentNode;
  var el = document.createElement('div');
  el.className = 'hdrip ' + cls;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);
}
function dripTick() {
  if (!S || document.hidden) return;
  var naMape = !$('v-map').classList.contains('hidden');
  if (drip.earn >= 1) {
    var kolik = Math.floor(drip.earn), txt = '+' + kolik.toLocaleString('cs-CZ');
    var p = naMape && S.units.length ? dripPoint(drip.i++) : null;
    if (p) dripShow(txt, 'up', p);
    headDrip(txt, 'up');
    drip.earn -= kolik;
  }
  if (drip.pay >= 1) {
    var kolikP = Math.floor(drip.pay), txtP = '−' + kolikP.toLocaleString('cs-CZ');
    var q = naMape && S.units.length ? dripPoint(drip.i++) : null;
    if (q) dripShow(txtP, 'down', q);
    headDrip(txtP, 'down');
    drip.pay -= kolikP;
  }
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
// V hlavičce chceme vidět, že peníze tečou. „120 tis." se hne jednou za půl
// hodiny, proto pod milion píšeme přesné číslo — to se mění každou vteřinu.
function kcHdr(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
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
// Když na telefonu vyjede klávesnice, okno se zmenší. Panel na to musí reagovat,
// jinak mu pole s tlačítkem schová pod sebe.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', function () {
    var vv = window.visualViewport;
    var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    var sh = $('sheet');
    sh.classList.toggle('kb', kb > 120);
    sh.style.paddingBottom = kb > 120 ? kb + 'px' : '';
  });
}
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
// Kdo už hraje, se musel dřív prokousat celým dotazníkem. Teď jde rovnou sem.
$('go-login').onclick = function () { showAcct('login'); };
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
      ev('game_quiz');
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
  // Kdo je přihlášený (třeba po „začít znovu"), už účet zakládat nemusí.
  var hint = $('role-acct');
  if (hint) hint.innerHTML = ME ? 'Hraješ jako <b>' + esc(ME.nick) + '</b>.' : '';
  $('go-game').onclick = function () {
    S = fresh(id); save();
    if (ME) { startGame(); syncState(true); return; }
    showAcct('register');
  };
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
  // Vlastní, nenápadný podpis místo širokého pruhu přes půl mapy. Úplně ho
  // smazat nejde — Esri nám dlaždice pouští zdarma právě proti uvedení zdroje.
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([49.82, 15.47], 7);
  addBasemap();
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  addAttribution();
  layer = L.layerGroup().addTo(map);
  drawMap();
}
// Podpis zdroje map schovaný do malého „i". Po klepnutí se rozbalí.
function addAttribution() {
  var C = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      var el = L.DomUtil.create('div', 'attr-mini');
      el.innerHTML = '<button type="button" aria-label="Zdroj mapových podkladů">i</button>'
        + '<span>Mapové podklady &copy; Esri · Leaflet</span>';
      L.DomEvent.disableClickPropagation(el);
      el.querySelector('button').onclick = function () { el.classList.toggle('open'); };
      return el;
    }
  });
  new C().addTo(map);
}
// Sídlo a pobočky na mapě. Sídlo má větší domeček, provozovna menší.
function domIcon(velke, nazev) {
  var r = velke ? 38 : 28;
  return L.divIcon({ className: '', iconSize: [r, r], iconAnchor: [r / 2, r / 2],
    html: '<div class="pin dum' + (velke ? '' : ' mala') + '">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 11h2.2v9h5.1v-5.6h4.4V20h5.1v-9h2.2z"/></svg>'
      + '<i class="pin-tag">' + esc(nazev || (velke ? 'Sídlo' : 'Pobočka')) + '</i></div>' });
}
// Co se dá se základnou dělat — zatím jen přehled, pobočku jde prodat na Burze.
function zakladnaSheet(z, jeSidlo) {
  sheet('<h3>' + esc(z.name || (jeSidlo ? 'Sídlo firmy' : 'Pobočka')) + '</h3>'
    + '<p class="muted small">' + (jeSidlo
        ? 'Odsud vyjíždí doprava strojů i stavební četa. Sídlo se nemění.'
        : 'Provozovna — doprava se počítá od ní, když je blíž než sídlo.') + '</p>'
    + (jeSidlo ? '' : '<div class="kv"><span>Provoz</span><b class="warn">' + kcFull(POBOCKA_MESICNE) + ' / měsíc</b></div>')
    + '<div class="kv"><span>Prádlomatů do 30 km</span><b>'
    + S.units.filter(function (u) { return u.lat != null && kmMezi(z, u) <= 30; }).length + '</b></div>'
    + (jeSidlo ? '' : '<p class="fine">Prodat ji můžeš na Burze jako cokoli jiného.</p>'));
}
function pinIcon(cls, txt) {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin ' + cls + '">' + txt + '</div>' });
}
// Cizí prádlomat: fotka taky, ale v barvách konkurence a s nickem majitele.
function rivalIcon(c) {
  var im = MODEL_IMG[c.model] || MODEL_IMG.flex;
  return L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22],
    html: '<div class="pin unit rival"><img src="' + esc(im.src) + '" alt="">'
      + '<i class="pin-tag">' + esc(c.firma || c.nick) + '</i></div>' });
}
// Postavený prádlomat ukazuje přímo fotku toho stroje, který tam stojí —
// na mapě je tak na první pohled vidět, jestli je to MINI, FLEX nebo MAX.
function unitIcon(u) {
  var im = MODEL_IMG[u.eco && u.eco.model] || MODEL_IMG.flex;
  return L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22],
    html: '<div class="pin unit" data-unit="' + esc(u.spotId) + '">'
      + '<img src="' + esc(im.src) + '" alt="">'
      + '<i class="pin-tag">' + esc(MODELS[u.eco && u.eco.model] ? MODELS[u.eco.model].name : '') + '</i></div>' });
}
function drawMap() {
  if (!layer) return;
  layer.clearLayers();
  var any = false, zname = {};
  Object.keys(S.areas).forEach(function (aid) {
    S.areas[aid].spots.forEach(function (sp) {
      any = true; zname[sp.id] = 1;
      var unit = S.units.filter(function (u) { return u.spotId === sp.id; })[0];
      var rival = !unit && CLAIMS[sp.id] && !CLAIMS[sp.id].mine ? CLAIMS[sp.id] : null;
      var seen = !!S.revealed[sp.id];
      var icon = unit ? unitIcon(unit) : rival ? rivalIcon(rival) : pinIcon(seen ? 'known' : 'unknown', seen ? '★' : '?');
      L.marker([sp.lat, sp.lon], { icon: icon })
        .addTo(layer)
        .on('click', function () { if (rival) return rivalSheet(sp, aid, rival); spotSheet(sp, aid); });
    });
  });
  // Cizí prádlomaty v městech, která jsme neprozkoumali. Víme o nich jen to, že
  // tam někdo stojí — co to místo umí, zjistíme až průzkumem města.
  Object.keys(CLAIMS).forEach(function (sid) {
    var c = CLAIMS[sid];
    if (c.mine || zname[sid] || c.lat == null) return;
    any = true;
    L.marker([c.lat, c.lon], { icon: rivalIcon(c) })
      .addTo(layer)
      .on('click', function () { cizi(c); });
  });
  // Sídlo a provozovny: velký domeček pro sídlo, menší pro pobočku.
  if (S.sidlo && S.sidlo.lat != null) {
    L.marker([S.sidlo.lat, S.sidlo.lon], { icon: domIcon(true, S.sidlo.name) })
      .addTo(layer).on('click', function () { zakladnaSheet(S.sidlo, true); });
  }
  (S.pobocky || []).forEach(function (b) {
    if (b.lat == null) return;
    L.marker([b.lat, b.lon], { icon: domIcon(false, b.name) })
      .addTo(layer).on('click', function () { zakladnaSheet(b, false); });
  });
  $('map-hint').classList.toggle('hidden', any);
}
// Panel cizího prádlomatu v neprozkoumaném městě.
function cizi(c) {
  var mesto = (c.area_key || '').replace(/(^|\s)\S/g, function (x) { return x.toUpperCase(); });
  sheet('<h3>' + esc(c.name || 'Cizí prádlomat') + '</h3>'
    + '<p class="muted small">' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '') + 'Tohle místo drží <b>' + esc(c.firma || c.nick) + '</b> (' + esc(c.nick) + ') · '
    + esc((MODELS[c.model] || {}).name || c.model)
    + (c.takeovers ? ' · už ' + c.takeovers + '× změnilo majitele' : '') + '</p>'
    + '<p class="muted small">' + (mesto ? esc(mesto) + ' jsi neprozkoumal' : 'Tohle město jsi neprozkoumal')
    + ' — bez toho nevíš, kolik tu chodí lidí ani jestli se sem vyplatí jít. '
    + 'Pošli tam člověka a pak se můžeš pokusit nájem přeplatit.</p>'
    + '<button class="btn big" id="go-scout-here">Prozkoumat ' + (mesto ? esc(mesto) : 'tohle město') + ' za ' + kcFull(SCOUT_COST) + '</button>'
    + (S.cash < SCOUT_COST ? '<p class="fine err">Na cestu nemáš dost hotovosti.</p>' : ''));
  var b = $('go-scout-here');
  if (b) b.onclick = function () {
    if (S.cash < SCOUT_COST) return toast('Na cestu nemáš dost hotovosti.', 'err');
    areasSheet();
    var inp = $('q-area');
    if (inp) { inp.value = mesto || ''; scout(inp.value.trim(), $('do-scout')); }
  };
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
    // Safari na iOS nabízí vyplnění adresy podle názvu a placeholderu pole. Proto
    // type="search", neutrální name/id a žádný náznak města — lišta s klíčem,
    // kartou a špendlíkem se pak nad klávesnicí neukáže.
    + '<input id="q-area" name="hledat" type="search" class="inp" placeholder="Napiš sem" '
    + 'autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="words" '
    + 'enterkeyhint="search" aria-label="Kam poslat člověka">'
    + '<button class="btn" id="do-scout"' + (S.cash < SCOUT_COST ? ' disabled' : '') + '>Hledat</button></div>'
    + '<p class="fine" id="city-note"></p>'
    + (S.cash < SCOUT_COST ? '<p class="fine err">Na cestu nemáš dost hotovosti.</p>' : '')
    + (done ? '<h3 style="margin-top:16px">Už prozkoumáno</h3>' + done : ''));
  var inp = $('q-area'), btn = $('do-scout');
  // Na telefonu klávesnice ukousne půlku obrazovky — ať pole zůstane vidět.
  if (inp) inp.onfocus = function () { setTimeout(function () { inp.scrollIntoView({ block: 'center' }); }, 250); };
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
var SCOUT_MAX_WAIT = 240000;   // první hledání nového města trvá na OpenStreetMap i pár minut
function scout(city, btn) {
  if (!city || city.length < 2) return toast('Napiš, do kterého města se má jet.', 'err');
  if (S.cash < SCOUT_COST) return toast('Na cestu nemáš dost hotovosti.', 'err');
  var started = Date.now(), stop = false, timer = null, netErr = 0;
  var note = $('city-note');
  var done = function () { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  var fail = function (msg) {
    done();
    btn.disabled = false; btn.textContent = 'Hledat';
    if (note) note.textContent = '';
    toast(msg, 'err');
  };
  btn.disabled = true; btn.textContent = 'Hledám…';
  if (note) note.textContent = 'Posílám tam člověka. Projít nové město může trvat i minutu.';

  // Postup píšeme i do poznámky pod polem — tlačítko bývá na mapě překryté.
  var progress = function (s) {
    btn.textContent = 'Hledám… ' + s + ' s';
    if (note) note.textContent = 'Chodí po městě (' + s + ' s). Nech stránku otevřenou, může to trvat i minutu.';
  };
  // iOS uspí časovače, jakmile se přepne aplikace nebo zhasne displej. Po návratu
  // se proto hned zeptáme znovu, ať se hledání nezasekne na půl cesty.
  var wake = function () { if (!stop && !document.hidden) { clearTimeout(timer); timer = setTimeout(poll, 50); } };
  document.addEventListener('visibilitychange', wake);

  var poll = function () {
    if (stop) return;
    fetch('/api/game/scout?q=' + encodeURIComponent(city), { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok && r.status !== 202) throw new Error(j.error || ('Chyba ' + r.status)); return j; }); })
      .then(function (j) {
        if (stop) return;
        netErr = 0;
        if (j && j.pending) {
          var s = Math.round((Date.now() - started) / 1000);
          if (Date.now() - started > SCOUT_MAX_WAIT) {
            return fail('Zabralo to moc času, ale hledání běží dál na serveru. Zkus za minutu to samé město znovu — naskočí hned.');
          }
          progress(s);
          timer = setTimeout(poll, 2500);
          return;
        }
        done();
        btn.disabled = false; btn.textContent = 'Hledat';
        if (note) note.textContent = '';
        if (!j.spots || !j.spots.length) return toast('Tam se nic vhodného nenašlo. Peníze ti zůstávají.', 'err');
        var id = j.area.id;
        var known = S.areas[id] ? S.areas[id].spots.length : 0;
        // Už prozkoumané město neúčtujeme znovu — jen hráče hodíme na mapu.
        if (known >= j.spots.length) {
          zalozSidlo(j.area);
          closeSheet();
          if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], 12);
          return toast(j.area.name + ' už máš prozkoumaný — koukni na mapu.', 'ok');
        }
        S.cash -= SCOUT_COST;
        S.areas[id] = { name: j.area.name, lat: j.area.lat, lon: j.area.lon, scoutedAt: Date.now(), spots: (j.spots || []).map(fixMetrics) };
        zalozSidlo(j.area);
        save(); paint(); drawMap(); closeSheet(); syncState(true);
        ev('game_scout');
        loadClaims();   // ať hráč hned vidí, kde už konkurence stojí
        if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], 12);
        toast(j.area.name + ': nalezeno ' + j.spots.length + ' míst.', 'ok');
      })
      .catch(function (e) {
        if (stop) return;
        // Krátký výpadek sítě (tunel, přepnutí Wi-Fi) hledání nezabíjí — zkusíme to znovu.
        if (++netErr <= 5 && Date.now() - started < SCOUT_MAX_WAIT) { timer = setTimeout(poll, 3000); return; }
        fail(e.message || 'Spojení se serverem vázne.');
      });
  };
  poll();
}

// ─── Panel: místo ────────────────────────────────────────────────────────────
function spotSheet(sp, areaId) {
  var unit = S.units.filter(function (u) { return u.spotId === sp.id; })[0];
  if (unit) return unitSheet(unit);
  var claim = CLAIMS[sp.id];
  if (claim && !claim.mine) return rivalSheet(sp, areaId, claim);

  // 1. krok — obhlídka. Levná, jen se tam někdo zajede podívat.
  if (!S.revealed[sp.id]) {
    sheet('<h3>Neprověřené místo</h3>'
      + '<p class="muted small">Víš jen, že tu něco je. Obhlídka ti ukáže, kolik tu chodí lidí, jaká je konkurence a jestli se tu prádlomat vyplatí.</p>'
      + '<div class="kv"><span>Typ místa</span><b>' + esc(KIND_LABEL[sp.kind] || 'Neznámý') + '</b></div>'
      + '<div class="kv"><span>Cena obhlídky</span><b>' + kcFull(REVEAL_COST) + '</b></div>'
      + '<button class="btn big" id="do-reveal"' + (S.cash < REVEAL_COST ? ' disabled' : '') + '>Prověřit místo</button>'
      + (S.cash < REVEAL_COST ? '<p class="fine">Na obhlídku nemáš dost hotovosti.</p>' : ''));
    var b = $('do-reveal');
    if (b) b.onclick = function () { S.cash -= REVEAL_COST; S.revealed[sp.id] = true; save(); paint(); drawMap(); syncState(true); spotSheet(sp, areaId); };
    return;
  }

  var lease = S.leases[sp.id];
  var head = '<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[sp.kind] || 'Místo') + ' · ' + esc(S.areas[areaId] ? S.areas[areaId].name : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<div class="kv"><span>Parkovacích ploch v okolí</span><b>' + (mnum(sp.parking) != null ? mnum(sp.parking) + (sp.parking_m != null ? ' (' + sp.parking_m + ' m)' : '') : '—') + '</b></div>'
    + '<div class="kv"><span>Konkurence do 1,5 km</span><b>' + (mnum(sp.competition) != null ? mnum(sp.competition) : '—') + '</b></div>'
    + '<div class="kv"><span>Tahouni provozu</span><b>' + (mnum(sp.anchors) != null ? mnum(sp.anchors) : '—') + '</b></div>';

  // 2. krok — domluvit s majitelem nájem. Zadarmo, ale bez něj se stavět nedá.
  if (!lease) {
    sheet(head
      + '<h3 style="margin-top:18px">Nájem</h3>'
      + '<p class="muted small">Než sem něco postavíš, musíš se s majitelem pozemku dohodnout na nájmu. '
      + 'Teprve pak se platí přípojky a staví.</p>'
      + '<div class="kv"><span>Odhad nájmu</span><b>' + kcFull(Math.round(rentOf(sp) * 0.9)) + ' – ' + kcFull(Math.round(rentOf(sp) * 1.1)) + ' / měsíc</b></div>'
      + '<button class="btn big" id="do-lease">Domluvit nájem</button>');
    var l = $('do-lease');
    if (l) l.onclick = function () {
      S.leases[sp.id] = { rent: rentOf(sp), at: Date.now() };
      save(); paint(); spotSheet(sp, areaId);
      toast('Nájem domluven na ' + kcFull(S.leases[sp.id].rent) + ' měsíčně.', 'ok');
    };
    return;
  }

  // 3. krok — vybrat stroj a zaplatit přípojky.
  sheet(head
    + '<div class="kv"><span>Domluvený nájem</span><b class="ok">' + kcFull(lease.rent) + ' / měsíc</b></div>'
    + '<div class="kv"><span>' + (jeZasitovane(sp) ? 'Instalace na tomhle místě' : 'Přípojky na tomhle místě') + '</span><b'
    + (jeZasitovane(sp) ? ' class="ok"' : '') + '>' + kcFull(connPrice(sp, 'flex')) + '</b> <span class="muted small">(u MAXu o 20 % víc)</span></div>'
    + (jeZasitovane(sp) ? '<p class="fine ok">Zasíťované místo — voda, odpad i elektřina už tu jsou. '
      + 'Platíš jen ' + Math.round(INSTALACE_PODIL * 100) + ' % toho, co stály přípojky.</p>' : '')
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
    + '<div class="kv"><span>Nájem / měsíc</span><b>' + kcFull(e.rent) + '</b></div>'
    + '<div class="kv"><span>Energie / měsíc (' + pct(ENERGY_SHARE) + ' obratu)</span><b>' + kcFull(e.energy) + '</b></div>'
    + '<div class="kv"><span>Servis a úklid / měsíc (' + pct(SERVIS_SHARE) + ' obratu)</span><b>' + kcFull(e.servis) + '</b></div>'
    + '<div class="kv"><span>Zisk / měsíc</span><b class="' + (e.profit > 0 ? 'ok' : 'err') + '">' + kcFull(e.profit) + '</b></div>'
    + '<div class="kv"><span>Přípojky (jednorázově)</span><b>' + kcFull(e.conn) + '</b></div>'
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
// chci = kolik chce hráč zaplatit ze svého. Když se nezadá, vezme se rozumné
// výchozí: nejdřív to, co přesahuje provozní rezervu, a doplatek do nutného
// minima, když na úvěr nezbývá.
function canFinance(amount, chci, strop) {
  var p = PROFILES[S.profile];
  var ltvRoom = Math.max(0, zastavaStrop(amount) - S.loan);
  // Strop podle výdělku: banka nepůjčí víc, než co unese splátka. Když ho
  // volající nedá, posuzuje se cash flow celé firmy.
  var dscr = maSkraloup() ? 0
    : strop == null ? stropPodleZisku(monthlyProfit() - splatkyMesicne(), amount) : Math.max(0, Math.round(strop));
  var canBorrow = Math.min(ltvRoom, S.bank, dscr);
  // Rezervu si normálně necháváme stranou, ale nesmí být důvodem, proč nákup
  // neprojde — když na úvěr nezbývá, sáhneme i do ní. Dřív tady hráč uvízl
  // s penězi v kapse a hláškou, že mu chybí.
  var zRezervy = Math.min(Math.max(0, S.cash - CASH_RESERVE), amount);
  var musiZKapsy = Math.max(0, amount - canBorrow);
  // Zaokrouhlíme, ať v políčku nesvítí 159796,95000000007.
  var minOwn = Math.ceil(Math.min(S.cash, musiZKapsy));
  var maxOwn = Math.floor(Math.min(S.cash, amount));
  var vychozi = Math.min(S.cash, Math.max(zRezervy, musiZKapsy));
  var own = chci == null ? vychozi : Math.max(minOwn, Math.min(maxOwn, Math.round(chci)));
  var need = Math.max(0, amount - own);
  var ok = own <= S.cash + 0.5 && need <= canBorrow + 0.5;
  // Důvod, proč to nejde — ať hráč nehádá, co má dělat.
  var duvod = null;
  if (!ok) {
    var chybi = Math.round(amount - S.cash - canBorrow);
    if (S.cash + canBorrow < amount) {
      duvod = 'Chybí ti ' + kcFull(chybi) + '. Máš ' + kcFull(S.cash) + ' v hotovosti a banka doplatí nejvýš '
        + kcFull(canBorrow)
        + (dscr <= ltvRoom && dscr <= S.bank
            ? ' — zástava by dovolila ' + kcFull(Math.min(ltvRoom, S.bank)) + ', ale tolik by neuneslo splátku. '
              + 'Banka chce vidět, že výdělek pokryje splátku aspoň ' + KRYTI_MIN.toFixed(2).replace('.', ',') + '×.'
              + (jeZacatek() ? ' Začni menším strojem, nebo místem, které víc vydělá.' : '')
          : S.bank < ltvRoom
            ? ' — víc jí teď ve volném rámci nezbývá, ten roste každý den.'
            : ' — na víc nemáš zástavu, úvěrový strop je ' + kcFull(ltvRoom) + '.');
    } else duvod = 'Chybí ti ' + kcFull(chybi) + '.';
  }
  return { amount: amount, own: own, need: need, ltvRoom: ltvRoom, canBorrow: canBorrow, dscr: dscr,
    cash: S.cash, minOwn: minOwn, maxOwn: maxOwn, ok: ok, duvod: duvod,
    chybi: ok ? 0 : Math.max(0, Math.round(amount - S.cash - canBorrow)),
    dotkne_rezervy: own > zRezervy };
}
// České množné číslo — 1 den, 2 dny, 5 dní.
function mn(n, a, b, c) { return n === 1 ? a : (n >= 2 && n <= 4) ? b : c; }
// Kolik ještě chybí a za jak dlouho to hráč vydělá, když nic nezmění.
// Bez téhle věty vidí jen zašedlé tlačítko a neví, jestli má čekat, nebo něco dělat.
function dohnat(chybi) {
  if (!(chybi > 0)) return '';
  var zisk = cistyZisk();
  if (!(zisk > 0)) return 'Zatím ti nic nepřitéká — postav první prádlomat, nebo si půjč v bance.';
  var mesicu = Math.ceil(chybi / zisk);
  var dni = Math.max(1, Math.round(mesicu / 2));
  return 'Při zisku ' + kcFull(zisk) + ' za měsíc na to budeš mít za '
    + mesicu + ' ' + mn(mesicu, 'herní měsíc', 'herní měsíce', 'herních měsíců')
    + ', tedy asi za ' + dni + ' ' + mn(dni, 'den', 'dny', 'dní') + '.';
}
function doFinance(f, vazba) { S.cash -= f.own; S.bank -= f.need; pricistDluh(f.need, prirazkaZa(f.need), vazba); }
// Stroj se kupuje dřív, než ví, kde bude stát. Až se postaví, úvěr na něj
// přivážeme k tomu místu — jinak by nešlo říct, že je ten prádlomat doplacený.
function pripojUverKeStroji(spotId, nazev) {
  var l = (S.loans || []).filter(function (x) { return x.druh === 'stroj' && !x.spotId; })
    .sort(function (a, b) { return a.zalozen - b.zalozen; })[0];
  if (!l) return;
  l.spotId = spotId;
  l.druh = 'misto';
  l.popis = 'Prádlomat — ' + (nazev || 'místo');
}
// Kolik banka ukousne každý měsíc na úrocích z celého dluhu.
function urokMesicne() {
  return Math.round((S.loans || []).reduce(function (a, l) { return a + l.zbyva * l.sazba / 12; }, 0));
}
// Kolik hráč každý měsíc odvede bance celkem — úrok i jistina.
function splatkyMesicne() {
  return Math.round((S.loans || []).reduce(function (a, l) {
    return a + Math.min(l.splatka, l.zbyva + l.zbyva * l.sazba / 12);
  }, 0));
}
// Provozní úvěr: hotovost z banky na běžné výdaje. Nepodléhá úvěrovému stropu,
// jen vlastnímu limitu — je to pojistka, aby hra nikdy nešla do slepé uličky.
function operatingRoom() {
  var p = PROFILES[S.profile];
  return Math.max(0, zastavaStrop() + OPERATING_MAX - S.loan);
}
function cashDrawMax() { return Math.max(0, Math.min(S.bank, operatingRoom(), OPERATING_MAX)); }
// Podil z ceny v procentech - u akontace a uveru at je videt pomer, ne jen cislo.
// Kolik chce hráč dát ze svého u právě otevřeného panelu. Null = nech to na hře.
var FIN_OWN = null;
function bindFinance(znovu) {
  var el = $('fin-own');
  if (!el) return;
  el.onchange = function () { FIN_OWN = Number(el.value) || 0; znovu(); };
}
function pct(share) { return String(Math.round(share * 100)) + ' %'; }
function pctNote(part, total) {
  if (!total || part == null) return '';
  var v = part / total * 100;
  var t = (v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', ','));
  return ' <span class="pct">' + t + ' %</span>';
}
function financeRows(f) {
  var p = PROFILES[S.profile];
  var lze = f.maxOwn > f.minOwn;   // je vůbec co nastavovat?
  return '<div class="kv"><span>Tvoje hotovost</span><b>' + kcFull(f.cash) + '</b></div>'
    + '<div class="kv"><span>Cena</span><b>' + kcFull(f.amount) + '</b></div>'
    + (lze
      ? '<label class="fld"><span>Kolik dáš ze svého (akontace)' + pctNote(f.own, f.amount) + '</span>'
        + '<input id="fin-own" class="inp" type="number" step="1000" min="' + f.minOwn + '" max="' + f.maxOwn + '" value="' + Math.round(f.own) + '"></label>'
        + '<p class="fine">' + (f.minOwn > 0 ? 'Nejmíň ' + kcFull(f.minOwn) + ' musíš dát ze svého, ' : 'Můžeš dát od nuly ')
        + 'nejvíc ' + kcFull(f.maxOwn) + '. Zbytek doplatí banka.</p>'
      : '<div class="kv"><span>Z vlastní hotovosti (akontace)</span><b>' + kcFull(f.own) + pctNote(f.own, f.amount) + '</b></div>')
    + '<div class="kv"><span>Doplatí banka (úvěr)</span><b class="' + (f.need > 0 ? 'warn' : '') + '">' + kcFull(f.need) + pctNote(f.need, f.amount) + '</b></div>'
    + (f.need > 0 ? '<div class="kv"><span>Úvěrový strop profilu</span><b>' + kcFull(f.ltvRoom) + '</b></div>'
      + (f.dscr != null && f.dscr < Math.min(f.ltvRoom, S.bank)
          ? '<div class="kv"><span>Strop podle výdělku</span><b class="warn">' + kcFull(f.dscr) + '</b></div>'
            + '<p class="fine">Zástava by dovolila víc, ale banka chce, aby výdělek pokryl splátku aspoň '
            + KRYTI_MIN.toFixed(2).replace('.', ',') + '×. Víc ti na tohle teď nepůjčí.</p>'
          : '')
      + '<div class="kv"><span>Volný rámec v bance</span><b>' + kcFull(S.bank) + '</b></div>'
      + '<div class="kv"><span>Úrok z této půjčky</span><b>'
      + ((rateOf() + prirazkaZa(f.need)) * 100).toFixed(1).replace('.', ',') + ' % ročně'
      + (prirazkaZa(f.need) ? ' <span class="warn">(+' + (prirazkaZa(f.need) * 100).toFixed(1).replace('.', ',') + ' za riziko)</span>' : '')
      + '</b></div>' : '');
}

// ─── Obchod ──────────────────────────────────────────────────────────────────
function paintShop() {
  var st = '';
  MODEL_ORDER.forEach(function (k) {
    var n = inStock(k); if (n) st += '<b>' + n + '× ' + MODELS[k].name + ' skladem</b>';
  });
  // Kdo má Expresní dovoz, ať ho může použít rovnou tady, ne až přes záložku Karty.
  var mamRush = ownedOf('rush');
  (S.orders || []).slice().sort(function (a, b) { return a.arrivesAt - b.arrivesAt; }).forEach(function (o) {
    st += '<b class="way">' + MODELS[o.model].name + ' na cestě · ' + etaText(o.arrivesAt - Date.now())
      + (mamRush ? '<button class="btn sm rush" data-rush="' + o.orderedAt + '">⚡ Doručit hned</button>' : '')
      + '</b>';
  });
  $('shop-stock').innerHTML = st ? '<div class="stock">' + st + '</div>' : '';
  [].forEach.call($('shop-stock').querySelectorAll('[data-rush]'), function (b) {
    b.onclick = function () { rushOrder(Number(b.getAttribute('data-rush')), b); };
  });
  $('shop-list').innerHTML = MODEL_ORDER.map(function (k) {
    var m = MODELS[k], price = machinePrice(m), f = canFinance(price, null, zamerStrop(k, price));
    var im = MODEL_IMG[k];
    return '<div class="card">'
      + '<div class="shop-img"><img src="' + esc(im.src) + '" alt="Prádlomat ' + m.name + '" loading="lazy"></div>'
      + '<div class="row" style="margin-top:12px"><h3>' + m.name + '</h3><b>' + kc(price) + ' ' + CUR + '</b></div>'
      + '<p class="muted small" style="margin:2px 0 8px">' + esc(m.desc) + '</p>'
      + '<div class="kv"><span>Zákazníků / den na průměrném místě</span><b>' + m.perday + '</b></div>'
      + '<div class="kv"><span>Servis a úklid</span><b>' + pct(SERVIS_SHARE) + ' obratu</b></div>'
      + '<div class="kv"><span>Energie</span><b>' + pct(ENERGY_SHARE) + ' obratu</b></div>'
      + '<div class="kv"><span>Přípojky na místě (navíc)</span><b>' + kcFull(Math.round(CONN_MIN * (k === 'max' ? CONN_MAX_MULT : 1))) + ' – ' + kcFull(Math.round(CONN_MAX * (k === 'max' ? CONN_MAX_MULT : 1))) + '</b></div>'
      + '<div class="kv"><span>Dodání</span><b>' + DELIVERY_MONTHS + ' herní měsíce (1 den)</b></div>'
      + '<button class="btn sm' + (f.ok ? '' : ' sec') + '" style="width:100%;margin-top:10px" data-buy="' + k + '">'
      + (f.ok ? 'Koupit ' + m.name : 'Chybí ti ' + kcFull(f.chybi)) + '</button>'
      + (f.ok ? '' : '<p class="fine">' + esc(dohnat(f.chybi)) + '</p>')
      + '</div>';
  }).join('');
  [].forEach.call($('shop-list').querySelectorAll('[data-buy]'), function (b) {
    b.onclick = function () { buySheet(b.getAttribute('data-buy')); };
  });
}
function buySheet(modelKey, drz) {
  if (!drz) FIN_OWN = null;
  var cena = machinePrice(MODELS[modelKey]);
  var m = MODELS[modelKey], f = canFinance(cena, FIN_OWN, zamerStrop(modelKey, cena));
  sheet('<h3>Koupit ' + m.name + '</h3>'
    + '<p class="muted small">Stroj ti přivezou za ' + DELIVERY_MONTHS + ' herní měsíce, tedy za jeden skutečný den. Do té doby je na cestě, pak čeká na skladě, než mu najdeš místo.</p>'
    + (jeZacatek() ? '<p class="fine ok">Na první stroj ti banka půjčí proti němu samému — '
        + 'ještě nemáš co vykázat, ale stroj si v případě problému odveze a prodá. '
        + 'U přípojek na místě už bude koukat na to, co vyděláš.</p>' : '')
    + financeRows(f)
    + '<button class="btn big" id="do-buy"' + (f.ok ? '' : ' disabled') + '>Objednat</button>'
    + (f.ok ? '' : '<p class="fine err">' + esc(f.duvod || '') + '</p>'
        + '<p class="fine">' + esc(dohnat(f.chybi)) + ' Nebo splať část úvěru — tím se ti uvolní rámec.</p>'));
  bindFinance(function () { buySheet(modelKey, true); });
  var b = $('do-buy');
  if (b) b.onclick = function () {
    doFinance(f, { druh: 'stroj', popis: 'Prádlomat ' + m.name });
    S.orders.push({ model: modelKey, orderedAt: Date.now(), arrivesAt: Date.now() + DELIVERY_MONTHS * MONTH_MS });
    save(); paint(); closeSheet(); syncState(true);
    toast(m.name + ' objednán. Dorazí ' + etaText(DELIVERY_MONTHS * MONTH_MS) + '.', 'ok');
  };
}

// ─── Panel: instalace stroje ze skladu na místo ──────────────────────────────
function installSheet(sp, areaId, modelKey, drz) {
  if (!drz) FIN_OWN = null;
  var m = MODELS[modelKey], e = economics(sp, modelKey);
  var doprava = dopravaNa(sp, modelKey);
  var celkem = e.conn + doprava;
  // Banka tohle místo posuzuje podle toho, co vydělá ono samo.
  var f = canFinance(celkem, FIN_OWN, stropPodleZisku(e.profit, celkem));
  var n = nejblizsiZakladna(sp);
  sheet('<h3>Postavit ' + m.name + '</h3>'
    + '<p class="muted small">' + esc(sp.name) + ' — teď se platí '
    + (jeZasitovane(sp) ? 'instalace stroje' : 'přípojky (voda, odpad, elektřina)')
    + ' a doprava. Stroj máš skladem, nájem domluvený.</p>'
    + (!S.sidlo ? '<p class="fine ok">Touhle stavbou vznikne sídlo tvojí firmy — ve městě, ne na téhle adrese. '
        + 'Od něj se pak počítá doprava všech dalších strojů, tak si rozmysli, kde začínáš.</p>' : '')
    + '<div class="kv"><span>' + (jeZasitovane(sp) ? 'Instalace' : cetaZvladne(sp) ? 'Přípojky vlastní četou' : 'Přípojky') + '</span><b'
    + (cetaZvladne(sp) ? ' class="ok"' : '') + '>' + kcFull(e.conn) + '</b></div>'
    + (cetaZvladne(sp) ? '<p class="fine ok">Staví tvoje parta za ' + Math.round(CETA_PODIL * 100)
      + ' % ceny. Tenhle měsíc jí zbývá ' + cetaZbyva() + ' z ' + CETA_MIST + ' míst.</p>' : '')
    + '<div class="kv"><span>Doprava stroje' + (n ? ' (' + Math.round(n.km) + ' km)' : '') + '</span><b'
    + (doprava > 0 ? ' class="warn"' : '') + '>' + (doprava > 0 ? kcFull(doprava) : 'zdarma — sídlo vzniká tady') + '</b></div>'
    + financeRows(f)
    + '<div class="kv"><span>Domluvený nájem</span><b>' + kcFull(e.rent) + ' / měsíc</b></div>'
    + '<div class="kv"><span>Zisk tohohle místa / měsíc</span><b class="ok">' + kcFull(e.profit) + '</b></div>'
    + (splatkyMesicne() > monthlyProfit() + e.profit
        ? '<p class="fine warn">I s tímhle místem vyděláš ' + kcFull(Math.round(monthlyProfit() + e.profit))
          + ' měsíčně, ale na splátkách platíš ' + kcFull(splatkyMesicne())
          + ' — a přibude ještě splátka za přípojky. Rozdíl ti ubírá z hotovosti, dokud nepřidáš další prádlomat.</p>'
        : '')
    + '<button class="btn big" id="do-build"' + (f.ok ? '' : ' disabled') + '>Postavit</button>'
    + (f.ok ? (f.dotkne_rezervy ? '<p class="fine warn">Sáhneš i do provozní rezervy — po stavbě ti zbude ' + kcFull(S.cash - f.own) + '.</p>' : '')
        : '<p class="fine err">' + esc(f.duvod || '') + '</p>'
          + '<p class="fine">' + esc(dohnat(f.chybi)) + '</p>'
          + '<button class="btn sec" id="go-bank" style="width:100%;margin-top:8px">Zkusit úvěr v bance</button>'));
  bindFinance(function () { installSheet(sp, areaId, modelKey, true); });
  var gb = $('go-bank');
  if (gb) gb.onclick = function () { closeSheet(); switchTab('bank'); uverSheet(); };
  var b = $('do-build');
  if (b) b.onclick = function () {
    // Místo si nejdřív zabereme na serveru — na jednom místě smí stát jen jeden.
    b.disabled = true; b.textContent = 'Stavím…';
    apiJson('/spots/claim', { spot_id: sp.id, area_key: areaId, model: modelKey,
      rent: e.rent, name: sp.name, lat: sp.lat, lon: sp.lon }).then(function (r) {
      b.disabled = false; b.textContent = 'Postavit';
      if (!r.ok) {
        if (r.j.occupied) CLAIMS[sp.id] = r.j.occupied;
        drawMap(); closeSheet();
        return toast(r.j.error || 'Místo je obsazené.', 'err');
      }
      CLAIMS[sp.id] = r.j.spot;
      doFinance(f, { druh: 'misto', spotId: sp.id, popis: 'Přípojky — ' + sp.name });
      pripojUverKeStroji(sp.id, sp.name);
      if (cetaZvladne(sp)) cetaPostavila(sp);
      // První stavba zakládá sídlo — ale ve městě, ne na adrese prádlomatu.
      // Firma má vlastní adresu; sdílet ji s provozovnou by nedávalo smysl.
      if (!S.sidlo) {
        var a = S.areas[areaId], str = stredOblasti(a);
        S.sidlo = { name: (a && a.name) || sp.name, lat: str ? str.lat : sp.lat,
          lon: str ? str.lon : sp.lon, od: Date.now() };
        toast('Sídlo firmy máš v ' + S.sidlo.name + '. Změnit se nedá.', 'ok');
      }
      S.stock[modelKey] = inStock(modelKey) - 1;
      S.units.push({ spotId: sp.id, areaId: areaId, name: sp.name, kind: sp.kind, score: sp.score,
        lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: e });
      ev('game_build');
      save(); paint(); drawMap(); closeSheet(); syncState(true);
      toast('Prádlomat stojí. Vydělává ' + kcFull(e.profit) + ' měsíčně.', 'ok');
    }).catch(function () { b.disabled = false; b.textContent = 'Postavit'; toast('Server neodpovídá.', 'err'); });
  };
}


// ─── Konkurence: jedno místo, jeden prádlomat ───────────────────────────────
// Kdo kde stojí, rozhoduje server — jinak by si dva hráči postavili na totéž
// místo. Cizí prádlomaty vidíš na mapě i s nickem, ale NE s nájmem: přeplatit
// konkurenta znamená nabídnout naslepo a za nepovedené vyjednávání zaplatit.
var CLAIMS = {};          // id místa → { nick, model, mine, takeovers, rent }
var BID_FEE = 5000;
function areaKeys() { return Object.keys(S && S.areas ? S.areas : {}); }

function loadClaims(then) {
  // Bez filtru na města — konkurenci chceme vidět na celé mapě, i tam, kam
  // jsme ještě nikoho neposlali.
  api('/spots').then(function (r) {
    if (!r.ok) return;
    if (r.j.fee) BID_FEE = r.j.fee;
    var next = {};
    (r.j.spots || []).forEach(function (c) { next[c.spot_id] = c; });
    CLAIMS = next;
    var zas = {};
    (r.j.zasitovana || []).forEach(function (id) { zas[id] = 1; });
    ZASITOVANE = zas;
    reconcileUnits();
    drawMap();
    if (then) then();
  }).catch(function () { if (then) then(); });
}

// Místo, o které hráč přišel, zmizí ze sítě a stroj se mu vrátí na sklad.
function reconcileUnits() {
  if (!S || !S.units.length) return;
  var lost = [];
  S.units = S.units.filter(function (u) {
    var c = CLAIMS[u.spotId];
    if (S.prodano && S.prodano[u.spotId]) return false;   // prodaný, ne přetažený
    if (c && !c.mine) { lost.push({ u: u, nick: c.nick }); return false; }
    return true;
  });
  if (!lost.length) return;
  lost.forEach(function (x) {
    S.stock[x.u.eco.model] = inStock(x.u.eco.model) + 1;
  });
  save(); paint();
  var x = lost[0];
  toast(lost.length === 1
    ? x.nick + ' přeplatil nájem v místě ' + x.u.name + '. Stroj máš zpátky na skladě.'
    : 'Přišel jsi o ' + lost.length + ' míst — konkurence přeplatila nájem. Stroje máš na skladě.', 'err');
}

// Panel cizího prádlomatu: koho přebíráš a za kolik to zkusíš.
function rivalSheet(sp, areaId, c) {
  var free = MODEL_ORDER.filter(function (k) { return inStock(k) > 0; });
  var e = economics(sp, free[0] || 'flex');
  var odhad = rentOf(sp);
  sheet('<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '') + 'Tohle místo drží <b>' + esc(c.firma || c.nick) + '</b> (' + esc(c.nick) + ') · '
    + esc((MODELS[c.model] || {}).name || c.model)
    + (c.takeovers ? ' · už ' + c.takeovers + '× změnilo majitele' : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<p class="muted small">Majitel pozemku se tě nezeptá, kolik platí ten druhý — to je jeho věc. '
    + 'Nabídni víc a místo je tvoje; nabídni málo a přijdeš o ' + kcFull(BID_FEE) + ' za zbytečnou cestu.</p>'
    + '<div class="kv"><span>Nájem v okolí bývá</span><b>kolem ' + kcFull(odhad) + '</b></div>'
    + '<div class="kv"><span>Instalace tvého stroje</span><b class="ok">' + kcFull(connPrice(sp, free[0] || 'flex')) + '</b></div>'
    + '<p class="fine ok">Přípojky tu už jsou po předchozím majiteli — platíš jen postavení svého stroje.</p>'
    + (free.length
      ? '<label class="fld"><span>Co nabídneš majiteli / měsíc</span>'
        + '<input id="bid-amt" class="inp" type="number" inputmode="numeric" min="0" step="500" value="' + Math.round(odhad * 1.4 / 500) * 500 + '"></label>'
        + '<label class="fld"><span>Co tam postavíš</span><select id="bid-model" class="inp">'
        + free.map(function (k) { return '<option value="' + k + '">' + MODELS[k].name + ' (' + inStock(k) + '× skladem)</option>'; }).join('')
        + '</select></label>'
        + '<button class="btn big" id="do-bid">Zkusit přeplatit</button>'
      : '<p class="fine err">Nemáš na skladě žádný prádlomat. Abys tohle místo přebral, '
        + 'musíš mít volný stroj — konkurenta vystřídáš jedině tak, že na jeho místo hned postavíš svůj.</p>'
        + '<button class="btn big" id="go-shop-bid">Koupit prádlomat v obchodě</button>'));
  var gs = $('go-shop-bid');
  if (gs) gs.onclick = function () { closeSheet(); switchTab('shop'); };
  var b = $('do-bid');
  if (b) b.onclick = function () {
    var amt = Math.max(0, Math.round(Number($('bid-amt').value) || 0));
    var model = $('bid-model').value;
    var conn = connPrice(sp, model);
    if (S.cash < BID_FEE) return toast('Na vyjednávání nemáš hotovost.', 'err');
    b.disabled = true; b.textContent = 'Vyjednávám…';
    apiJson('/spots/bid', { spot_id: sp.id, rent: amt, model: model }).then(function (r) {
      b.disabled = false; b.textContent = 'Zkusit přeplatit';
      if (!r.j.won) {
        // 404 = zábor mezitím zmizel (majitel vypověděl nebo si resetoval hru).
        // Za to hráč platit nebude a rovnou ho pustíme stavět.
        if (r.status === 404) {
          delete CLAIMS[sp.id];
          loadClaims();
          toast('Místo se mezitím uvolnilo — můžeš stavět rovnou.', 'ok');
          return spotSheet(sp, areaId);
        }
        S.cash -= BID_FEE; save(); paint();
        return toast(r.j.error || 'Nepovedlo se.', 'err');
      }
      // Vyhráli jsme: platíme přípojky a stavíme s nájmem, který jsme nabídli.
      var f = canFinance(conn, null, stropPodleZisku(economics(sp, model).profit, conn));
      if (!f.ok) {
        // Místo už máme, ale na přípojky nemáme — vrátíme ho, ať v něm neleží.
        apiJson('/spots/release', { spot_id: sp.id });
        return toast('Místo bys měl, ale na přípojky ti chybí ' + kcFull(f.need - f.canBorrow) + '.', 'err');
      }
      doFinance(f, { druh: 'misto', spotId: sp.id, popis: 'Přípojky — ' + sp.name });
      pripojUverKeStroji(sp.id, sp.name);
      S.stock[model] = inStock(model) - 1;
      var eco = economics(sp, model);
      eco.rent = amt; eco.conn = conn; eco.install = conn;
      eco.cost = eco.energy + eco.servis + amt;
      eco.profit = eco.revenue - eco.cost;
      S.units.push({ spotId: sp.id, areaId: areaId, name: sp.name, kind: sp.kind, score: sp.score,
        lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: eco });
      save(); paint(); loadClaims(); closeSheet();
      toast('Místo je tvoje — ' + esc(r.j.lost_by) + ' si stroj odváží.', 'ok');
    }).catch(function () { b.disabled = false; b.textContent = 'Zkusit přeplatit'; toast('Server neodpovídá.', 'err'); });
  };
}

// ─── Panel: hotový prádlomat ─────────────────────────────────────────────────
// Co z tohohle místa zbyde po splátce jeho vlastního úvěru. Když na něj místo
// nevydělá, banka by na něj další peníze nepůjčila — hráč to má vidět.
function mistoUverHtml(u) {
  var l = uverMista(u);
  if (!l) {
    return (S.loan > 0
      ? '<p class="fine">Tenhle prádlomat je doplacený — celý provozní zisk je tvůj. Dluh máš jinde.</p>'
      : '<p class="fine">Nemáš dluh, takže provozní zisk je zároveň čistý výdělek.</p>');
  }
  var urok = Math.round(l.zbyva * l.sazba / 12);
  var splatka = Math.min(l.splatka, l.zbyva + urok);
  var cisty = u.eco.profit - splatka;
  var kryti = splatka > 0 ? u.eco.profit / splatka : 9;
  return '<div class="kv"><span>− Splátka úvěru (úrok ' + kcFull(urok) + ')</span><b class="warn">'
    + kcFull(splatka) + '</b></div>'
    + '<div class="kv souhrn"><span>Čistý výdělek</span><b class="' + (cisty >= 0 ? 'ok' : 'err') + '">'
    + kcFull(cisty) + '</b></div>'
    + '<div class="kv"><span>Pokrytí splátky</span><b class="' + (kryti >= 1.25 ? 'ok' : kryti >= 1 ? 'warn' : 'err') + '">'
    + kryti.toFixed(2).replace('.', ',') + '×</b></div>'
    + '<p class="fine">' + (kryti >= 1.25
        ? 'Místo si na svou splátku vydělá s rezervou — banka takové financuje ráda.'
        : kryti >= 1
          ? 'Na splátku to vyjde jen tak tak. Banka chce vidět aspoň 1,25×.'
          : 'Tohle místo na svou splátku nevydělá a doplácíš na něj z ostatních.')
    + ' Zbývá splatit ' + kcFull(l.zbyva) + ', ještě ' + (l.zbyvaMesicu || 0) + ' měsíců.</p>';
}
function unitSheet(u) {
  var years = (Date.now() - u.builtAt) / YEAR_MS;
  sheet('<h3>' + esc(u.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[u.kind] || 'Místo') + ' · ' + MODELS[u.eco.model].name + ' · v provozu ' + years.toFixed(1).replace('.', ',') + ' roku</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(u.score) + '</div>'
    + '<h3 style="margin:16px 0 4px">Co to měsíčně dělá</h3>'
    + '<div class="kv"><span>Obrat</span><b>' + kcFull(u.eco.revenue) + '</b></div>'
    + (u.eco.rent != null ? '<div class="kv"><span>− Nájem</span><b class="warn">' + kcFull(u.eco.rent) + '</b></div>' : '')
    + (u.eco.energy != null ? '<div class="kv"><span>− Energie (' + pct(ENERGY_SHARE) + ' obratu)</span><b class="warn">' + kcFull(u.eco.energy) + '</b></div>' : '')
    + (u.eco.servis != null ? '<div class="kv"><span>− Servis a úklid (' + pct(SERVIS_SHARE) + ' obratu)</span><b class="warn">' + kcFull(u.eco.servis) + '</b></div>' : '')
    + '<div class="kv souhrn"><span>Provozní zisk</span><b class="ok">' + kcFull(u.eco.profit) + '</b></div>'
    + mistoUverHtml(u)
    + '<h3 style="margin:16px 0 4px">Souhrn</h3>'
    + '<div class="kv"><span>Investice</span><b>' + kcFull(u.eco.invest) + '</b></div>'
    + '<div class="kv"><span>Vydělal celkem</span><b>' + kcFull(u.eco.profit * 12 * years) + '</b></div>'
    + (u.eco.profit > 0 ? '<div class="kv"><span>Návratnost</span><b>'
      + (u.eco.invest / (u.eco.profit * 12)).toFixed(1).replace('.', ',') + ' roku</b></div>' : '')
    + '<p class="muted small" style="margin-top:14px">Když je jinde líp, místo vypovíš a stroj si odvezeš na sklad. '
    + 'Přípojky ani domluvený nájem se nevracejí a místo se hned uvolní konkurenci.</p>'
    + '<button class="btn sec" id="do-release" style="width:100%">Vypovědět místo</button>');
  var rb = $('do-release');
  if (rb) rb.onclick = function () {
    if (rb.getAttribute('data-sure') !== '1') {
      rb.setAttribute('data-sure', '1');
      rb.textContent = 'Opravdu? Klikni znovu';
      rb.classList.add('warn');
      return;
    }
    rb.disabled = true;
    apiJson('/spots/release', { spot_id: u.spotId }).then(function (r) {
      if (!r.ok) { rb.disabled = false; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
      S.units = S.units.filter(function (x) { return x.spotId !== u.spotId; });
      S.stock[u.eco.model] = inStock(u.eco.model) + 1;
      delete CLAIMS[u.spotId];
      save(); paint(); drawMap(); closeSheet(); syncState(true);
      toast('Místo vypovězeno. ' + MODELS[u.eco.model].name + ' čeká na skladě.', 'ok');
    }).catch(function () { rb.disabled = false; toast('Server neodpovídá.', 'err'); });
  };
}

// ─── Pozvánky ────────────────────────────────────────────────────────────────
// Čím víc lidí otevře odkaz, který hráč pošle dál, tím víc zákazníků mu chodí.
// Počítá se otevření odkazu někým jiným, ne samotné kliknutí na „sdílet".
function shareUrl() { return location.origin + '/game?ref=' + encodeURIComponent(S.pid); }
function prichoziRef() { try { return localStorage.getItem(REF_FROM_KEY) || ''; } catch (e) { return ''; } }
// Sdílené id patří účtu, ne zařízení. Na novém telefonu si hra vezme to, které
// má účet na serveru — jinak by hráč rozesílal dva různé odkazy.
function srovnejRef() {
  if (!ME || !ME.ref) return;
  try { localStorage.setItem(PID_KEY, ME.ref); } catch (e) { /* nevadí */ }
  if (S && S.pid !== ME.ref) { S.pid = ME.ref; save(); pullRefs(); }
}
function datumKratce(x) {
  try { return new Date(x).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }); }
  catch (e) { return ''; }
}
function pullRefs() {
  if (!S || !S.pid) return;
  fetch('/api/game/ref/' + encodeURIComponent(S.pid), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || typeof j.refs !== 'number' || j.refs === S.refs) return;
      S.refs = j.refs; save(); paint();
    }).catch(function () { /* nevadí, zkusí se zas */ });
}
// Když někdo přijde přes cizí odkaz, započítáme to majiteli odkazu — jen jednou.
// POZOR: musí se volat hned při načtení, ne až po startu hry. Ten, kdo na odkaz
// klikne, totiž obvykle hru teprve poprvé otevírá a žádný rozehraný stav nemá.
function countIncomingRef() {
  var m = /[?&]ref=([a-z0-9]{6,24})/i.exec(location.search);
  if (!m) return;
  var id = m[1].toLowerCase();
  var mine = null;
  try { mine = localStorage.getItem(PID_KEY); } catch (e) { /* nevadí */ }
  if (!mine) { try { var raw = localStorage.getItem(KEY); if (raw) mine = (JSON.parse(raw) || {}).pid || null; } catch (e) { /* nevadí */ } }
  if (mine === id) return;                       // vlastní odkaz se nepočítá
  // Zapamatujeme si, kdo nás přivedl. Při registraci to pošleme na server a
  // zvoucí hráč tím dostane pozvaného napevno do své „sítě".
  try { if (!localStorage.getItem(REF_FROM_KEY)) localStorage.setItem(REF_FROM_KEY, id); } catch (e) { /* nevadí */ }
  try { if (localStorage.getItem('lm_ref_' + id)) return; localStorage.setItem('lm_ref_' + id, '1'); } catch (e) { /* nevadí */ }
  fetch('/api/game/ref/' + id, { method: 'POST' }).catch(function () {});
}
function shareGame(btn) {
  var url = shareUrl();
  var txt = 'Stavím síť prádlomatů v Laundromats Milionáři. Zkus to taky — a mně tím přibydou zákazníci.';
  if (navigator.share) {
    navigator.share({ title: 'Laundromats Milionář', text: txt, url: url }).catch(function () {});
    return;
  }
  var done = function () { btn.textContent = 'Odkaz zkopírován'; setTimeout(function () { btn.textContent = 'Zkopírovat odkaz'; }, 2000); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(function () { prompt('Zkopíruj odkaz:', url); });
  else prompt('Zkopíruj odkaz:', url);
}

// ─── Obrazovky hry ───────────────────────────────────────────────────────────
// Píše právě hráč do nějakého pole uvnitř záložky? Pak panel nepřekreslujeme —
// jinak mu rozepsaný text zmizí pod rukama (stávalo se to u názvu firmy).
function pisePrave() {
  var el = document.activeElement;
  if (!el) return false;
  var tag = (el.tagName || '').toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;
  return !!(el.closest && el.closest('.view'));
}
// ─── Tutoriál ───────────────────────────────────────────────────────
// První prádlomat postaví hráč s doprovodem: lišta nahoře řekne, co teď, a
// zvýrazní to, na co má klepnout. Krok se neukládá — počítá se ze stavu hry,
// takže se tutoriál nemůže zaseknout ani když hráč udělá kroky naposřed.
var TUT_KROKU = 5;
// Sídlo založíme z prvního prozkoumaného města — ve městě, ne na adrese místa.
function zalozSidlo(area) {
  if (S.sidlo || !area || area.lat == null) return;
  S.sidlo = { name: area.name, lat: area.lat, lon: area.lon, od: Date.now() };
  toast('Sídlo firmy máš v ' + S.sidlo.name + '. Změnit se nedá.', 'ok');
}
function mamStroj() {
  return MODEL_ORDER.some(function (k) { return inStock(k) > 0; });
}
function tutAktivni() { return !!S && S.tut !== 'done' && S.tut != null; }
// Krok se odvozuje ze stavu hry, ne z klikání. 0 = už není co ukazovat.
function tutKrok() {
  if (!tutAktivni()) return 0;
  if ((S.units || []).length) return 0;   // první prádlomat stojí — hotovo
  if (!S.sidlo) return 1;
  if (!Object.keys(S.leases || {}).length) return 2;
  if (!(S.orders || []).length && !mamStroj()) return 3;
  if (!mamStroj()) return 4;
  return 5;
}
function tutText(k) {
  if (k === 1) return { t: 'Vyber město', p: 'Kde bude mít firma sídlo? Pošli tam člověka, ať město projde a najde volná místa.', cil: '#open-areas' };
  if (k === 2) {
    var proveril = Object.keys(S.revealed || {}).length > 0;
    return proveril
      ? { t: 'Domluv nájem', p: 'Vybral sis místo — teď se s majitelem dohodni na nájmu. Zadarmo, ale bez něj se stavět nedá.', cil: null }
      : { t: 'Vytypuj lokalitu', p: 'Klepni na doměček na mapě a prověř místo — uvidíš nájem, obrat i zisk. Čím vyšší skóre, tím líp.', cil: null };
  }
  if (k === 3) return { t: 'Kup prádlomat', p: 'V obchodě vezmi MINI — na ten máš peníze a nemusíš si půjčovat.', cil: '#tab-shop' };
  if (k === 4) return { t: 'Doruč ho hned', p: 'Dodací lhůta je jeden skutečný den. Máš ale kartu Expresní dovoz — použij ji a stroj je hned skladem.',
    cil: document.querySelector('#v-shop .btn.rush') ? '#v-shop .btn.rush' : '#tab-shop' };
  if (k === 5) return { t: 'Postav prádlomat', p: 'Vrať se na mapu, klepni na místo s domluveným nájmem a postav na něm stroj ze skladu.', cil: '#tab-map' };
  return null;
}
var TUT_CIL = null;
function tutPaint() {
  var bar = $('tut');
  if (!bar) return;
  if (TUT_CIL) { var o = document.querySelector(TUT_CIL); if (o) o.classList.remove('tut-on'); TUT_CIL = null; }
  var k = tutKrok(), info = k ? tutText(k) : null;
  if (!info) {
    bar.classList.add('hidden');
    // První prádlomat stojí — tutoriál skončil sám.
    if (tutAktivni() && (S.units || []).length) {
      S.tut = 'done'; save();
      toast('První prádlomat stojí. Teď už to znáš — další si postavíš sám.', 'ok');
    }
    return;
  }
  bar.classList.remove('hidden');
  $('tut-krok').textContent = 'Krok ' + k + ' z ' + TUT_KROKU;
  $('tut-titul').textContent = info.t;
  $('tut-text').textContent = info.p;
  $('tut-fill').style.width = Math.round((k - 1) / TUT_KROKU * 100) + '%';
  if (info.cil) { var c = document.querySelector(info.cil); if (c) { c.classList.add('tut-on'); TUT_CIL = info.cil; } }
}
function tutSkip() {
  if (!tutAktivni()) return;
  S.tut = 'done'; save(); tutPaint(); syncState(true);
  toast('Tutoriál vypnutý. Našeptávat už ti nebudu.', 'ok');
}
// První krok otevřeme sami — bez sídla není co dělat.
function tutStart() {
  if (!tutAktivni()) return;
  // Bez karty Expresní dovoz by hráč po koupi čekal celý den. Server ji vydá
  // jen tomu, kdo ještě nic nepostavil — stávající hráči ji tak dostanou taky.
  if (ME && !ownedOf('rush')) {
    apiJson('/account/tutorial-card', {}).then(function (r) {
      if (r.ok && r.j.owned && ME) { ME.cards = r.j.owned; paint(); }
    }).catch(function () { /* karta počká, tutoriál běží dál */ });
  }
  if (tutKrok() !== 1) return;
  switchTab('map');
  sidloSheet();
}
function sidloSheet() {
  sheet('<h3>Kde bude mít firma sídlo?</h3>'
    + '<p class="muted small">Napiš město. Pošleme tam člověka, projde ho a najde místa, kde by prádlomat vydělával. '
    + 'První prozkoumané město se stane sídlem tvojí firmy — ve městě, ne na adrese prádlomatu — a od něj se pak počítá doprava strojů.</p>'
    + '<label class="fld"><span>Město</span>'
    + '<input id="sidlo-mesto" class="inp" type="text" maxlength="60" placeholder="např. Pardubice"></label>'
    + '<p class="fine" id="city-note"></p>'
    + '<button class="btn big" id="sidlo-go">Poslat tam člověka</button>'
    + '<p class="fine">Cesta stojí ' + kcFull(SCOUT_COST) + '. Měst můžeš později projít kolik chceš, ale sídlo zůstane tam, kde začneš.</p>');
  var i = $('sidlo-mesto'), b = $('sidlo-go');
  b.onclick = function () { scout((i.value || '').trim(), b); };
  i.onkeydown = function (e) { if (e.key === 'Enter') b.click(); };
  setTimeout(function () { i.focus(); }, 60);
}

function paint() {
  refreshUnits();
  $('t-year').textContent = gameYear();
  $('t-cash').textContent = kcHdr(S.cash);
  var cz = cistyZisk();
  $('t-rate').textContent = kc(cz);
  $('t-rate').className = cz < 0 ? 'err' : 'ok';
  $('t-count').textContent = S.units.length;
  // Hlavička se hýbe pořád, obsah záložky počká, až hráč dopíše.
  if (pisePrave()) return;
  if (!$('v-shop').classList.contains('hidden')) paintShop();
  if (!$('v-net').classList.contains('hidden')) {
    if ($('net-zebricek').classList.contains('hidden')) paintNet(); else paintZeb();
  }
  if (!$('v-bank').classList.contains('hidden')) paintBank();
  if (!$('v-cards').classList.contains('hidden')) paintCards();
  if (!$('v-burza').classList.contains('hidden')) paintBurza();
  if (!$('v-me').classList.contains('hidden')) paintMe();
  tutPaint();
}
// ─── Žebříčky ────────────────────────────────────────────────────────────────
var ZEB = null, ZEB_KAT = 'pradlomaty';
var ZEB_POPIS = {
  pradlomaty: { nadpis: 'Nejvíc prádlomatů', jed: function (v) { return v + '×'; },
    pod: 'Počítají se obsazená místa — to je jediné číslo, které hlídá server.' },
  zisk: { nadpis: 'Nejvyšší měsíční zisk', jed: function (v) { return kcFull(v); },
    pod: 'Podle poslední uložené sítě hráče.' },
  pozvanky: { nadpis: 'Nejvíc pozvánek', jed: function (v) { return v + '×'; },
    pod: 'Kolikrát někdo otevřel sdílený odkaz hráče.' }
};
function loadZeb() {
  // Při výpadku nastavíme prázdný žebříček — jinak by panel zůstal viset
  // na „Načítám…" a hráč by nevěděl, že se něco pokazilo.
  var prazdny = { pradlomaty: [], zisk: [], pozvanky: [], ja: null, hracu: 0, chyba: true };
  return api('/leaderboard')
    .then(function (r) { ZEB = r.ok ? r.j : prazdny; })
    .catch(function () { ZEB = prazdny; });
}
function paintZeb() {
  var box = $('zeb-body');
  if (!ZEB) { box.innerHTML = '<p class="muted small">Načítám…</p>'; return loadZeb().then(paintZeb); }
  var list = ZEB[ZEB_KAT] || [], popis = ZEB_POPIS[ZEB_KAT];
  var ja = ZEB.ja ? ZEB.ja[ZEB_KAT] : null;
  box.innerHTML = '<h3 style="margin:14px 0 2px">' + popis.nadpis + '</h3>'
    + '<p class="muted small" style="margin:0 0 10px">' + popis.pod + '</p>'
    + (list.length
      ? '<div class="zeb">' + list.map(function (x) {
          return '<div class="zeb-row' + (x.ja ? ' ja' : '') + '">'
            + '<i class="poradi' + (x.poradi <= 3 ? ' medaile m' + x.poradi : '') + '">' + x.poradi + '</i>'
            + (x.znak ? znakSvg(x.znak, 26) : '<i class="znak-mezera"></i>')
            + '<span class="nick">' + esc(x.firma || x.nick)
            + '<i>' + esc(x.nick) + '</i></span>'
            + '<b>' + popis.jed(x.hodnota) + '</b></div>';
        }).join('') + '</div>'
      : '<div class="empty">' + (ZEB.chyba ? 'Žebříček se nepodařilo načíst. Zkus to za chvíli.' : 'Tady zatím nikdo není. Buď první.') + '</div>')
    + (ja && ja.poradi > list.length
      ? '<p class="muted small" style="margin-top:12px">Ty jsi ' + ja.poradi + '. z ' + ja.z + ' — ' + popis.jed(ja.hodnota) + '.</p>'
      : '')
    + (ZEB.hracu ? '<p class="fine">Hráčů se sítí: ' + ZEB.hracu + '</p>' : '');
}

// Střed prozkoumaného města — odtud se dá zřídit pobočka.
function stredOblasti(a) {
  var sp = (a && a.spots) || [];
  if (!sp.length) return null;
  var la = 0, lo = 0, n = 0;
  sp.forEach(function (x) { if (x.lat != null) { la += x.lat; lo += x.lon; n++; } });
  return n ? { lat: la / n, lon: lo / n } : null;
}
// Sídlo a pobočky: odkud se vyjíždí na stavby.
function zakladnyHtml() {
  if (!S.sidlo) return '<div class="card"><h3>Sídlo firmy</h3>'
    + '<p class="muted small" style="margin:2px 0 0">Vznikne tam, kde postavíš první prádlomat. '
    + 'Od sídla se pak počítá doprava všech dalších strojů.</p></div>';
  var lze = pobockaLze();
  return '<div class="card"><h3>Sídlo a pobočky</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Doprava stroje se počítá od nejbližší základny. '
    + 'Pobočka stojí ' + kcFull(POBOCKA_CENA) + ' a ' + kcFull(POBOCKA_MESICNE) + ' měsíčně.</p>'
    + '<div class="kv"><span>Sídlo</span><b>' + esc(S.sidlo.name || 'neznámé') + '</b></div>'
    + (S.pobocky || []).map(function (b) {
        return '<div class="kv"><span>Pobočka</span><b>' + esc(b.name || 'pobočka') + '</b></div>';
      }).join('')
    + (pobockyMesicne() > 0 ? '<div class="kv"><span>Provoz poboček</span><b class="warn">'
      + kcFull(pobockyMesicne()) + ' / měsíc</b></div>' : '')
    + (lze
        ? '<button class="btn sec" id="do-pobocka" style="width:100%;margin-top:10px">Zřídit pobočku za ' + kcFull(POBOCKA_CENA) + '</button>'
        : '<p class="fine">Další pobočku si můžeš zřídit ' + etaText(pobockaOd() - Date.now())
          + '. Koupit ji od jiného hráče na Burze můžeš kdykoli.</p>')
    + '</div>';
}
// Vlastní stavební četa — karta v Síti.
function cetaHtml() {
  if (!S.sidlo) return '';
  if (!maCetu()) {
    return '<div class="card"><h3>Vlastní stavební četa</h3>'
      + '<p class="muted small" style="margin:2px 0 10px">Technika a dva lidi v sídle. Přípojky pak stavíš za '
      + Math.round(CETA_PODIL * 100) + ' % ceny a zvládneš ' + CETA_MIST + ' místa za herní měsíc. '
      + 'Vyplatí se od dvou míst měsíčně — pod to prodělává.</p>'
      + '<div class="kv"><span>Technika</span><b>' + kcFull(CETA_CENA) + '</b></div>'
      + '<div class="kv"><span>Mzdy dvou lidí</span><b class="warn">' + kcFull(CETA_MZDY) + ' / měsíc</b></div>'
      + '<button class="btn sec" id="do-ceta" style="width:100%;margin-top:10px">Pořídit četu</button></div>';
  }
  var zbyva = cetaZbyva();
  return '<div class="card"><h3>Vlastní stavební četa</h3>'
    + '<div class="kv"><span>Volná kapacita tenhle měsíc</span><b class="' + (zbyva ? 'ok' : 'warn') + '">'
    + zbyva + ' z ' + CETA_MIST + ' míst</b></div>'
    + '<div class="kv"><span>Mzdy</span><b class="warn">' + kcFull(CETA_MZDY) + ' / měsíc</b></div>'
    + (maShanece() ? '<div class="kv"><span>Sháněč míst</span><b class="warn">' + kcFull(SHANEC_MZDA) + ' / měsíc</b></div>' : '')
    + ((S.ceta.phm || 0) > 0 ? '<div class="kv"><span>PHM tenhle měsíc</span><b class="warn">' + kcFull(S.ceta.phm) + '</b></div>' : '')
    + '<p class="fine">Přípojky na panenském místě ti četa postaví za ' + Math.round(CETA_PODIL * 100)
    + ' % ceny. Na zasíťovaná místa ji posílat nemusíš — ta stojí ' + Math.round(INSTALACE_PODIL * 100) + ' % i bez ní.</p>'
    + (maShanece()
        ? '<button class="btn sec" id="do-shanec" style="width:100%;margin-top:8px">Propustit sháněče</button>'
        : '<button class="btn sec" id="do-shanec" style="width:100%;margin-top:8px">Najmout sháněče míst za ' + kcFull(SHANEC_MZDA) + ' / měsíc</button>')
    + '</div>';
}
function cetaSheet() {
  var f = canFinance(CETA_CENA, FIN_OWN);
  sheet('<h3>Pořídit stavební četu</h3>'
    + '<p class="muted small">Technika patří k sídlu a lidi jedou odtud. Banka techniku financuje, '
    + 'ale posuzuje ji podle cash flow celé firmy — nestojí za ní místo, které vydělává.</p>'
    + CETA_TECHNIKA.map(function (t) {
        return '<div class="kv"><span>' + esc(t.nazev) + '</span><b>' + kcFull(t.cena) + '</b></div>';
      }).join('')
    + financeRows(f)
    + '<div class="kv souhrn"><span>Mzdy dvou lidí</span><b class="warn">' + kcFull(CETA_MZDY) + ' / měsíc</b></div>'
    + '<p class="fine">Při čtyřech místech měsíčně ušetříš kolem 240 tisíc a četa stojí kolem 120 — '
    + 'při jednom místě naopak prodělává. Je to sázka na vlastní tempo.</p>'
    + '<button class="btn big" id="do-ceta-ano"' + (f.ok ? '' : ' disabled') + '>Pořídit</button>'
    + (f.ok ? '' : '<p class="fine err">' + esc(f.duvod || '') + '</p>'));
  bindFinance(function () { cetaSheet(); });
  var b = $('do-ceta-ano');
  if (b) b.onclick = function () {
    var g = canFinance(CETA_CENA, FIN_OWN);
    if (!g.ok) return;
    doFinance(g, { druh: 'technika', popis: 'Stavební technika' });
    S.ceta = { od: Date.now(), shanec: false, mesic: Math.floor(Date.now() / MONTH_MS), hotovo: 0, phm: 0 };
    save(); paint(); closeSheet(); syncState(true);
    toast('Četa je tvoje. Přípojky teď stavíš za pětinu.', 'ok');
  };
}
// Výběr města pro pobočku — jen z toho, co hráč prozkoumal.
function pobockaSheet() {
  var mesta = Object.keys(S.areas || {}).map(function (id) {
    var a = S.areas[id], str = stredOblasti(a);
    if (!str) return null;
    var uz = zakladny().some(function (b) { return kmMezi(b, str) < 8; });
    return { id: id, name: a.name || id, lat: str.lat, lon: str.lon, uz: uz };
  }).filter(Boolean);
  sheet('<h3>Zřídit pobočku</h3>'
    + '<p class="muted small">Stojí ' + kcFull(POBOCKA_CENA) + ' a ' + kcFull(POBOCKA_MESICNE)
    + ' měsíčně. Vyplatí se tam, kde chceš stavět — doprava se pak počítá odsud. '
    + 'Další půjde zřídit až za tři herní roky.</p>'
    + (S.cash < POBOCKA_CENA ? '<p class="fine err">Na pobočku teď nemáš — chybí ti ' + kcFull(POBOCKA_CENA - S.cash) + '.</p>' : '')
    + (mesta.length
      ? '<div class="zeb">' + mesta.map(function (m) {
          return '<div class="zeb-row"><span class="nick">' + esc(m.name)
            + '<i>' + (m.uz ? 'tady už základnu máš' : 'prozkoumané město') + '</i></span>'
            + (m.uz || S.cash < POBOCKA_CENA ? '' : '<button class="btn sm" data-pob="' + esc(m.id) + '">Zřídit</button>')
            + '</div>';
        }).join('') + '</div>'
      : '<div class="empty">Nemáš prozkoumané žádné město.</div>'));
  [].forEach.call(document.querySelectorAll('[data-pob]'), function (b) {
    b.onclick = function () {
      var m = mesta.filter(function (x) { return x.id === b.getAttribute('data-pob'); })[0];
      if (!m || S.cash < POBOCKA_CENA || !pobockaLze()) return;
      S.cash -= POBOCKA_CENA;
      S.pobocky.push({ name: m.name, lat: m.lat, lon: m.lon, od: Date.now() });
      save(); paint(); closeSheet(); syncState(true);
      toast('Pobočka v ' + m.name + ' otevřená.', 'ok');
    };
  });
}
function paintNet() {
  // Dlaždice se čtou shora dolů jako výpis: co síť vydělá, co z toho odteče,
  // a co zbyde. Aby to sedělo, musí každé číslo vycházet ze stejného základu.
  var zbyde = cistyZisk();
  var odtece = splatkyMesicne() + pobockyMesicne() + cetaMesicne();
  $('net-sum').innerHTML = '<div><span>Prádlomaty</span><b>' + S.units.length + '</b></div>'
    // Dokud se nemá co odečítat, je zisk prádlomatů zároveň tím, co zbyde —
    // dvě stejná čísla vedle sebe by jen pletla.
    + (odtece > 0
        ? '<div><span>Zisk před splátkou</span><b class="' + (monthlyProfit() < 0 ? 'err' : 'ok') + '">' + kc(monthlyProfit()) + '</b></div>'
        : '<div><span>Zisk / měsíc</span><b class="' + (zbyde < 0 ? 'err' : 'ok') + '">' + kc(zbyde) + '</b></div>')
    + (splatkyMesicne() > 0
        ? '<div><span>Splátky bance</span><b class="warn">' + kc(-splatkyMesicne()) + '</b></div>' : '')
    + (pobockyMesicne() > 0
        ? '<div><span>Provoz poboček</span><b class="warn">' + kc(-pobockyMesicne()) + '</b></div>' : '')
    + (cetaMesicne() > 0
        ? '<div><span>Vlastní četa</span><b class="warn">' + kc(-cetaMesicne()) + '</b></div>' : '')
    + (odtece > 0
        ? '<div><span>Zbyde měsíčně</span><b class="' + (zbyde >= 0 ? 'ok' : 'err') + '">' + kc(zbyde) + '</b></div>' : '')
    + '<div><span>Investováno</span><b>' + kc(investedTotal()) + '</b></div>'
    + '<div><span>Vyděláno celkem</span><b>' + kc(S.stats.earned) + '</b></div>';
  var note = $('net-note');
  if (note) {
    note.textContent = splatkyMesicne() > 0
      ? 'Ze splátky ' + kcFull(splatkyMesicne()) + ' je úrok ' + kcFull(urokMesicne())
        + ' — ten je navždy pryč. Zbytek, ' + kcFull(Math.max(0, splatkyMesicne() - urokMesicne()))
        + ', umazává dluh, takže se ti o to zvyšuje majetek. „Zbyde měsíčně“ je to samé číslo, co svítí nahoře v hlavičce.'
      : 'Nikomu nic nesplácíš, takže ti zůstává celý zisk prádlomatů.';
  }
  if (!S.units.length) {
    $('net-list').innerHTML = zakladnyHtml() + cetaHtml()
      + '<div class="empty">Zatím nemáš ani jeden prádlomat.<br>Začni tím, že na mapě prozkoumáš oblast.</div>';
    bindZakladny();
    return;
  }
  $('net-list').innerHTML = zakladnyHtml() + cetaHtml() + S.units.slice().sort(function (a, b) { return b.eco.profit - a.eco.profit; }).map(function (u) {
    return '<div class="card" data-unit="' + esc(u.spotId) + '">'
      + '<div class="row"><h3>' + esc(u.name) + '</h3>' + verdictPill(u.score) + '</div>'
      + '<p class="muted small" style="margin:2px 0 6px">' + esc(KIND_LABEL[u.kind] || 'Místo') + ' · ' + MODELS[u.eco.model].name + '</p>'
      + (function () {
        var l = uverMista(u);
        if (!l) return '<div class="row"><span class="muted small">Zisk / měsíc</span><b class="ok">' + kcFull(u.eco.profit) + '</b></div></div>';
        // Místo na dluh: číslo před splátkou je jen mezikrok, rozhoduje to pod ním.
        var urok = l.zbyva * l.sazba / 12;
        var splatka = Math.min(l.splatka, l.zbyva + urok);
        var cisty = u.eco.profit - splatka;
        return '<div class="row"><span class="muted small">Zisk před splátkou</span><b>' + kcFull(u.eco.profit) + '</b></div>'
          + '<div class="row"><span class="muted small">− Splátka úvěru</span><b class="warn">' + kcFull(Math.round(splatka)) + '</b></div>'
          + '<div class="row"><span class="muted small">Zbyde z místa</span><b class="' + (cisty >= 0 ? 'ok' : 'err') + '">'
          + kcFull(Math.round(cisty)) + '</b></div></div>';
      })();
  }).join('');
  [].forEach.call($('net-list').querySelectorAll('[data-unit]'), function (c) {
    c.onclick = function () { unitSheet(S.units.filter(function (u) { return u.spotId === c.getAttribute('data-unit'); })[0]); };
  });
  bindZakladny();
}
function bindZakladny() {
  var b = $('do-pobocka');
  if (b) b.onclick = function () { pobockaSheet(); };
  var c = $('do-ceta');
  if (c) c.onclick = function () { FIN_OWN = null; cetaSheet(); };
  var sh = $('do-shanec');
  if (sh) sh.onclick = function () {
    S.ceta.shanec = !S.ceta.shanec;
    save(); paint(); syncState(true);
    toast(S.ceta.shanec ? 'Sháněč nastoupil — místa bude hledat sám.' : 'Sháněč skončil.', 'ok');
  };
}
// Přehled jednotlivých úvěrů — co je na co, za kolik a kolik ještě zbývá.
// Rámcový úvěr v bance: cesta k němu, stav a čerpání.
function ramecHtml() {
  if (maRamec()) {
    var volny = ramecVolny();
    return '<div class="card"><h3>Rámcový úvěr</h3>'
      + '<div class="kv"><span>Schválený limit</span><b>' + kcFull(S.ramec.limit) + '</b></div>'
      + '<div class="kv"><span>Načerpáno</span><b>' + kcFull(S.ramec.cerpano || 0) + '</b></div>'
      + '<div class="kv"><span>K čerpání</span><b class="' + (volny > 0 ? 'ok' : 'warn') + '">' + kcFull(volny) + '</b></div>'
      + (S.ramec.slabyOd
          ? '<p class="fine err">Čerpání je zastavené — ' + slabaMista().length + ' '
            + mn(slabaMista().length, 'místo nevydělá', 'místa nevydělají', 'míst nevydělá')
            + ' na svou splátku. Banka dá rámci ' + etaText(S.ramec.slabyOd + RAMEC_LHUTA - Date.now())
            + ', pak ho zavře. Sprav to, nebo slabá místa prodej.</p>'
          : '<p class="fine">Čerpat můžeš bez dalšího pohovoru — jen krátké tři otázky. '
            + 'Podmínka je, že každý prádlomat vydělá aspoň na svou splátku.</p>')
      + (volny >= 1000 ? '<button class="btn sec big" id="do-cerpat">Čerpat z rámce</button>' : '')
      + '</div>';
  }
  if (S.ramec && S.ramec.zavreny) {
    return '<div class="card"><h3>Rámcový úvěr</h3>'
      + '<p class="muted small" style="margin:2px 0 0">Banka ti rámec zavřela, protože síť rok nevydělávala na splátky. '
      + 'Co je načerpané, splácíš dál. Nový rámec si můžeš zasloužit znovu — stejnou cestou.</p></div>';
  }
  var doplaceno = doplacenychMist();
  return '<div class="card"><h3>Rámcový úvěr</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Schválený objem, ze kterého čerpáš na další prádlomaty '
    + 'bez nového pohovoru. Banka ho otevře tomu, kdo už dokázal úvěr splatit.</p>'
    + '<div class="kv"><span>Plně doplacených prádlomatů</span><b class="' + (doplaceno >= 2 ? 'ok' : '') + '">'
    + doplaceno + ' ze 2</b></div>'
    + (maSkraloup() ? '<p class="fine err">Po konkurzu ti banka herní rok nepůjčí.</p>' : '')
    + (ramecLze()
        ? '<p class="fine">Máš na něj nárok. Čeká tě pohovor s rizikořem — deset otázek.</p>'
          + '<button class="btn sec big" id="do-ramec">Požádat o rámec</button>'
        : '<p class="fine">Splať nejdřív dva prádlomaty do konce. Pak se přijď bavit o rámci.</p>')
    + '</div>';
}
function ramecSheet() {
  pohovorSheet(10, 'Pohovor o rámci', function (st) {
    if (!st.ok) { toast('Rizikoř to zamítl. Zkus to, až budeš mít věci srovnané.', 'err'); return; }
    var limit = Math.round(ramecNavrh() * st.limit / 10000) * 10000;
    if (limit < 10000) { toast('Na rámec zatím nevyděláváš dost. Vrať se, až síť povyroste.', 'err'); return; }
    sheet('<h3>Rámec schválen</h3>'
      + '<div class="kv"><span>Limit</span><b class="ok">' + kcFull(limit) + '</b></div>'
      + '<div class="kv"><span>Hodnocení pohovoru</span><b>' + esc(st.nazev) + '</b></div>'
      + '<p class="muted small" style="margin-top:10px">Čerpat můžeš po částech, vždycky jen do výše, '
      + 'kterou unese výdělek. Podmínka je, že každý prádlomat vydělá aspoň na svou splátku — '
      + 'když to rok neplatí, banka rámec zavře.</p>'
      + '<button class="btn big" id="ram-ok">Beru</button>');
    $('ram-ok').onclick = function () {
      S.ramec = { limit: limit, cerpano: 0, od: Date.now(), slabyOd: null, zavreny: null, bonus: st.sazba };
      save(); paint(); closeSheet(); syncState(true);
      toast('Rámec ' + kcFull(limit) + ' je schválený.', 'ok');
    };
  });
}
function cerpatSheet(chci) {
  var volny = ramecVolny();
  if (volny < 1000) { closeSheet(); return toast('Z rámce teď čerpat nemůžeš.', 'err'); }
  var castka = Math.max(1000, Math.min(volny, Math.round((chci == null ? volny : chci) / 1000) * 1000));
  var prirazka = prirazkaZa(castka) + (S.ramec.bonus || 0);
  var sazba = Math.max(0.02, rateOf() + prirazka);
  var splatka = anuita(castka, sazba, UVER_MESICU);
  sheet('<h3>Čerpání z rámce</h3>'
    + '<div class="kv"><span>K dispozici</span><b>' + kcFull(volny) + '</b></div>'
    + '<label class="fld"><span>Kolik si vezmeš</span>'
    + '<input id="cer-amt" class="inp" type="number" min="1000" step="1000" max="' + volny + '" value="' + castka + '"></label>'
    + '<div class="kv"><span>Úrok</span><b>' + (sazba * 100).toFixed(1).replace('.', ',') + ' % ročně</b></div>'
    + '<div class="kv souhrn"><span>Splátka</span><b class="warn">' + kcFull(splatka) + ' / měsíc po 5 let</b></div>'
    + '<button class="btn big" id="cer-ano">Čerpat</button>'
    + '<button class="btn sec" id="cer-ne" style="width:100%;margin-top:8px">Zpátky</button>');
  var inp = $('cer-amt');
  if (inp) inp.onchange = function () { cerpatSheet(Number(inp.value) || 0); };
  $('cer-ne').onclick = closeSheet;
  $('cer-ano').onclick = function () {
    var c = Math.max(1000, Math.min(ramecVolny(), Math.round((Number(inp.value) || 0) / 1000) * 1000));
    // Krátký pohovor — tři otázky, ať to po desáté neotravuje.
    pohovorSheet(3, 'Krátká kontrola', function (st) {
      if (!st.ok) { toast('Rizikoř čerpání zastavil. Zkus to, až se věci srovnají.', 'err'); return; }
      S.ramec.cerpano = (S.ramec.cerpano || 0) + c;
      S.cash += c;
      pricistDluh(c, prirazkaZa(c) + (S.ramec.bonus || 0), { druh: 'ramec', popis: 'Čerpání z rámce' });
      save(); paint(); syncState(true);
      toast('Načerpáno ' + kcFull(c) + '.', 'ok');
    });
  };
}
function uveryHtml() {
  var l = (S.loans || []).slice().sort(function (a, b) { return b.zbyva - a.zbyva; });
  if (!l.length) return '';
  return '<div class="card"><h3>Tvoje úvěry</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Každý má svoji sazbu a pevnou splátku na pět herních let. '
    + 'Předčasně splatit můžeš kdykoli a bez sankce.</p>'
    + l.map(function (u) {
        var urok = Math.round(u.zbyva * u.sazba / 12);
        var splatka = Math.min(u.splatka, u.zbyva + urok);
        return '<div class="uver' + (u.zmeskano ? ' dluzi' : '') + '">'
          + '<div class="uver-hl"><b>' + esc(u.popis || 'Úvěr') + '</b>'
          + '<span>' + (u.sazba * 100).toFixed(1).replace('.', ',') + ' %</span></div>'
          + '<div class="kv"><span>Zbývá splatit</span><b>' + kcFull(u.zbyva) + '</b></div>'
          + '<div class="kv"><span>Splátka / měsíc</span><b class="warn">' + kcFull(splatka)
          + ' <span class="muted">(úrok ' + kcFull(urok) + ')</span></b></div>'
          + '<div class="kv"><span>Zbývá měsíců</span><b>' + (u.zbyvaMesicu || 0) + ' z ' + (u.mesicu || 60) + '</b></div>'
          + (u.zmeskano ? '<p class="fine err">Neuhrazené splátky: ' + u.zmeskano + '. Banka to sleduje.</p>' : '')
          + '</div>';
      }).join('')
    + '</div>';
}
function paintBank() {
  var p = PROFILES[S.profile];
  // Do majetku patří i stroje skladem a na cestě — banka je bere jako zástavu stejně jako postavené.
  var room = Math.max(0, zastavaStrop() - S.loan);
  $('bank-body').innerHTML = '<div class="card">'
    + '<div class="row"><span class="muted small">Hotovost</span><b>' + kcFull(S.cash) + '</b></div>'
    + '<div class="row"><span class="muted small">Volný rámec v bance</span><b>' + kcFull(S.bank) + '</b></div>'
    + ((S.duvera || 0) > 0 ? '<div class="row"><span class="muted small">Složená zástava</span><b>' + kcFull(S.duvera)
        + (duveraVolna() < S.duvera ? ' <span class="muted">(volná ' + kcFull(duveraVolna()) + ')</span>' : '') + '</b></div>' : '')
    + '<p class="fine" style="margin-top:6px">Rámec sám roste o ' + kcFull(BANK_PER_DAY)
    + ' za den a nemá strop. Kolik si půjčíš, ale rozhoduje zástava — majetek, kterým ručíš.</p>'
    + '</div>'
    + '<div class="card"><h3>Úvěr</h3>'
    + '<div class="kv"><span>Dlužíš</span><b class="' + (S.loan > 0 ? 'warn' : '') + '">' + kcFull(S.loan) + '</b></div>'
    + '<div class="kv"><span>' + (S.loan > 0 ? 'Úrok z tvého dluhu' : 'Základní sazba') + '</span><b>'
    + ((S.loan > 0 ? urokSazba() : rateOf()) * 100).toFixed(1).replace('.', ',') + ' % ročně'
    + (S.loan > 0 && S.loanPrem > 0.0005
        ? ' <span class="warn">(+' + (S.loanPrem * 100).toFixed(1).replace('.', ',') + ' za riziko)</span>' : '')
    + '</b></div>'
    + '<div class="kv"><span>Splátka / měsíc</span><b class="' + (splatkyMesicne() > 0 ? 'warn' : '') + '">'
    + kcFull(splatkyMesicne()) + (urokMesicne() > 0 ? ' <span class="muted">(z toho úrok ' + kcFull(urokMesicne()) + ')</span>' : '') + '</b></div>'
    + '<div class="kv"><span>Zaplaceno na úrocích</span><b>' + kcFull(S.stats.interest) + '</b></div>'
    + ((S.stats.splaceno || 0) > 0 ? '<div class="kv"><span>Splacených úvěrů</span><b class="ok">'
      + S.stats.splaceno + '</b></div>' : '')
    + '<div class="kv"><span>Ještě si můžeš půjčit</span><b>' + kcFull(Math.min(room, S.bank)) + '</b></div>'
    + (uverNabidka(null).max >= 1000
        ? '<button class="btn sec big" id="do-ask">Požádat o úvěr</button>'
          + '<p class="fine">Banka se podívá, co máš, a řekne si podmínky. Než kývneš, uvidíš všechno dopředu.</p>'
        : '<p class="fine">' + uverDuvod() + '</p>')
    + (S.loan > 0 && S.cash >= 1 ? '<button class="btn big" id="do-repay">Splatit mimořádně ' + kcFull(Math.min(S.cash, S.loan)) + '</button>'
        + '<p class="fine">Mimořádná splátka jde nejdřív na nejdražší úvěr. Běžné splátky se strhávají samy každý herní měsíc.</p>' : '')
    + (S.loan > 0 && S.cash < 1 ? '<p class="fine">Splácet začneš, až síť něco vydělá.</p>' : '')
    + '</div>'
    + ramecHtml()
    + uveryHtml()
    + cashPacksHtml();
  bindCashPacks();
  var d = $('do-ask');
  if (d) d.onclick = function () { uverSheet(); };
  var r = $('do-ramec');
  if (r) r.onclick = function () { ramecSheet(); };
  var c = $('do-cerpat');
  if (c) c.onclick = function () { cerpatSheet(); };
  var b = $('do-repay');
  if (b) b.onclick = function () {
    var pay = Math.min(S.cash, S.loan);
    S.cash -= pay; splatitDluh(pay); S.bank = Math.min(bankCap(), S.bank + pay);
    save(); paint(); syncState(true); toast('Splaceno ' + kcFull(pay) + '.', 'ok');
  };
}
// Klepnutí na hotovost v hlavičce. Když peníze dojdou, hráč nemá hledat,
// kde se berou — tady je rovnou vidí všechny cesty, jak si přidat.
function penizeSheet() {
  var room = Math.max(0, zastavaStrop() - S.loan);
  var muze = uverNabidka(null).max >= 1000;
  sheet('<h3>Peníze</h3>'
    + '<div class="kv"><span>Hotovost</span><b>' + kcFull(S.cash) + '</b></div>'
    + '<div class="kv"><span>Dlužíš bance</span><b class="' + (S.loan > 0 ? 'warn' : '') + '">' + kcFull(S.loan) + '</b></div>'
    + '<div class="kv"><span>Ještě si můžeš půjčit</span><b>' + kcFull(Math.min(room, S.bank)) + '</b></div>'
    + '<p class="muted small" style="margin:10px 0 0">Hotovost roste sama tím, co vydělají prádlomaty. '
    + 'Když potřebuješ víc hned, půjč si v bance — podmínky uvidíš dopředu'
    + (PAYMENTS_ON ? ', nebo si dobij balíček laundry.' : '.') + '</p>'
    + (muze
        ? '<button class="btn big" id="pen-uver" style="margin-top:12px">Požádat banku o úvěr</button>'
        : '<p class="fine" style="margin-top:12px">' + uverDuvod() + '</p>')
    + (S.loan > 0 && S.cash >= 1
        ? '<button class="btn sec" id="pen-splatit" style="width:100%;margin-top:8px">Splatit ' + kcFull(Math.min(S.cash, S.loan)) + '</button>' : '')
    + (PAYMENTS_ON ? '<button class="btn sec" id="pen-balicek" style="width:100%;margin-top:8px">Dobít balíček laundry</button>' : '')
    + '<button class="btn sec" id="pen-ceka" style="width:100%;margin-top:8px">Zkontrolovat, co na mě čeká</button>'
    + '<p class="fine">Čekat může hotovost přidaná ručně nebo zaplacený balíček, který se ještě nestihl připsat.</p>');
  var u = $('pen-uver');
  if (u) u.onclick = function () { uverSheet(); };
  var sp = $('pen-splatit');
  if (sp) sp.onclick = function () {
    var pay = Math.min(S.cash, S.loan);
    S.cash -= pay; splatitDluh(pay); S.bank = Math.min(bankCap(), S.bank + pay);
    save(); paint(); syncState(true); closeSheet(); toast('Splaceno ' + kcFull(pay) + '.', 'ok');
  };
  var ba = $('pen-balicek');
  if (ba) ba.onclick = function () { closeSheet(); switchTab('bank'); };
  var ck = $('pen-ceka');
  if (ck) ck.onclick = function () {
    ck.disabled = true; ck.textContent = 'Koukám\u2026';
    var pred = S.cash;
    loadCards().then(function () {
      claimCash(function () {
        closeSheet();
        if (S.cash <= pred) toast('Nic na tebe nečeká.');
      });
    });
  };
}
// ---- Znak firmy ---------------------------------------------------------
// Znak není obrázek, ale krátký kód „tvar-paleta-symbol“. Kreslí se tady
// v prohlížeči, takže je hotový okamžitě a nikde neleží žádný soubor.
var ZNAK_PAL = [
  ['#3b82f6', '#1e3a8a', '#ffffff'],
  ['#22c55e', '#14532d', '#ffffff'],
  ['#ef4444', '#7f1d1d', '#ffffff'],
  ['#a855f7', '#4c1d95', '#ffffff'],
  ['#f97316', '#7c2d12', '#ffffff'],
  ['#06b6d4', '#0b4a57', '#ffffff'],
  ['#facc15', '#854d0e', '#3b2a05'],
  ['#ec4899', '#831843', '#ffffff'],
  ['#64748b', '#1e293b', '#ffffff'],
  ['#84cc16', '#3f6212', '#ffffff']
];
var ZNAK_TVAR = [
  '<path d="M50 3 L93 17 v33 c0 25-19 40-43 47 C26 90 7 75 7 50 V17z"/>',
  '<circle cx="50" cy="50" r="46"/>',
  '<rect x="5" y="5" width="90" height="90" rx="24"/>',
  '<path d="M50 3 L89 26 v48 L50 97 11 74V26z"/>',
  '<path d="M50 3 L97 50 50 97 3 50z"/>',
  '<path d="M31 5h38l26 26v38l-26 26H31L5 69V31z"/>'
];
var ZNAK_SYM = [
  '<rect x="27" y="24" width="46" height="54" rx="9" fill="%F%"/><circle cx="50" cy="56" r="15" fill="%D%"/><circle cx="50" cy="56" r="8" fill="%F%"/><rect x="33" y="31" width="10" height="7" rx="3.5" fill="%D%"/>',
  '<path d="M50 18 c14 20 24 30 24 42 a24 24 0 0 1-48 0 c0-12 10-22 24-42z" fill="%F%"/>',
  '<circle cx="42" cy="60" r="17" fill="%F%"/><circle cx="66" cy="43" r="11" fill="%F%"/><circle cx="69" cy="68" r="7" fill="%F%"/>',
  '<path d="M58 16 L28 58 h17 l-5 28 30-42H53z" fill="%F%"/>',
  '<path d="M50 16 l10 21 23 3-17 16 4 23-20-11-20 11 4-23-17-16 23-3z" fill="%F%"/>',
  '<path d="M22 72 L18 30 l15 13 17-23 17 23 15-13-4 42z" fill="%F%"/>',
  '<circle cx="50" cy="50" r="27" fill="%F%"/><circle cx="50" cy="50" r="18" fill="none" stroke="%D%" stroke-width="5"/><path d="M44 40 v20 h13" fill="none" stroke="%D%" stroke-width="5" stroke-linecap="round"/>',
  '<path d="M18 56 q8-13 16 0 t16 0 t16 0 t16 0" fill="none" stroke="%F%" stroke-width="8" stroke-linecap="round"/><path d="M18 76 q8-13 16 0 t16 0 t16 0 t16 0" fill="none" stroke="%F%" stroke-width="8" stroke-linecap="round"/>',
  '<path d="M50 22 a9 9 0 0 1 9 9 c0 6-5 8-9 10 v4" fill="none" stroke="%F%" stroke-width="6" stroke-linecap="round"/><path d="M50 47 L21 70 h58z" fill="none" stroke="%F%" stroke-width="7" stroke-linejoin="round"/>',
  '<circle cx="50" cy="50" r="27" fill="%F%"/><circle cx="50" cy="50" r="9" fill="%D%"/><circle cx="50" cy="29" r="5" fill="%D%"/><circle cx="50" cy="71" r="5" fill="%D%"/><circle cx="29" cy="50" r="5" fill="%D%"/><circle cx="71" cy="50" r="5" fill="%D%"/>'
];
// Z kódu složí hotové SVG. Když kód chybí nebo je rozbitý, vrátí prázdné kolečko.
function znakSvg(kod, px) {
  px = px || 40;
  var c = String(kod == null ? '' : kod).split('-').map(Number);
  if (c.length !== 3 || c.some(function (n) { return !isFinite(n); })) {
    return '<svg class="znak" width="' + px + '" height="' + px + '" viewBox="0 0 100 100" aria-hidden="true">'
      + '<circle cx="50" cy="50" r="44" fill="none" stroke="#475569" stroke-width="5" stroke-dasharray="9 7"/></svg>';
  }
  var tvar = ZNAK_TVAR[c[0] % ZNAK_TVAR.length];
  var pal = ZNAK_PAL[c[1] % ZNAK_PAL.length];
  var sym = ZNAK_SYM[c[2] % ZNAK_SYM.length];
  var gid = 'zg' + c.join('');
  return '<svg class="znak" width="' + px + '" height="' + px + '" viewBox="0 0 100 100" aria-hidden="true">'
    + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="' + pal[0] + '"/><stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>'
    + '<g fill="url(#' + gid + ')">' + tvar + '</g>'
    + sym.split('%F%').join(pal[2]).split('%D%').join(pal[1])
    + '</svg>';
}
// Výběr znaku — nabídne dvanáct náhodných a dá zamíchat další.
function znakSheet() {
  var navrhy = [], vybrano = ME && ME.emblem ? ME.emblem : null;
  function zamichej() {
    // Zamícháme symboly i palety a bereme je po řadě, aby v nabídce nebyl
    // třikrát ten samý symbol jen v jiné barvě.
    function michej(n) {
      var a = [], i;
      for (i = 0; i < n; i++) a.push(i);
      for (i = n - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    var sy = michej(ZNAK_SYM.length), pa = michej(ZNAK_PAL.length);
    navrhy = [];
    for (var i = 0; i < 12; i++) {
      navrhy.push(Math.floor(Math.random() * ZNAK_TVAR.length) + '-' + pa[i % pa.length] + '-' + sy[i % sy.length]);
    }
    if (vybrano && navrhy.indexOf(vybrano) < 0) navrhy[0] = vybrano;
  }
  zamichej();
  function kresli() {
    sheet('<h3>Znak firmy</h3>'
      + '<p class="muted small">Vyber si znak pro <b>' + esc((ME && (ME.company || ME.nick)) || 'svou firmu') + '</b>. '
      + 'Uvidí ho konkurence v žebříčku i u tvých míst na mapě.</p>'
      + '<div class="znak-grid">' + navrhy.map(function (k) {
          return '<button class="znak-opt' + (k === vybrano ? ' on' : '') + '" data-k="' + esc(k) + '">' + znakSvg(k, 54) + '</button>';
        }).join('') + '</div>'
      + '<button class="btn sec" id="znak-mix" style="width:100%;margin-top:12px">Zamíchat jiné</button>'
      + '<button class="btn big" id="znak-ulozit" style="margin-top:8px"' + (vybrano ? '' : ' disabled') + '>Použít tenhle znak</button>');
    Array.prototype.forEach.call(document.querySelectorAll('.znak-opt'), function (b) {
      b.onclick = function () { vybrano = b.getAttribute('data-k'); kresli(); };
    });
    $('znak-mix').onclick = function () { zamichej(); kresli(); };
    $('znak-ulozit').onclick = function () {
      var b = $('znak-ulozit');
      if (!vybrano) return;
      b.disabled = true; b.textContent = 'Ukládám…';
      apiJson('/account/emblem', { emblem: vybrano }).then(function (r) {
        if (!r.ok) { b.disabled = false; b.textContent = 'Použít tenhle znak'; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
        ME = r.j.player; ZEB = null; closeSheet(); loadClaims(); paintMe();
        toast('Znak firmy je nastavený.', 'ok');
      }).catch(function () { b.disabled = false; b.textContent = 'Použít tenhle znak'; toast('Server neodpovídá.', 'err'); });
    };
  }
  kresli();
}
// ─── Distributor ────────────────────────────────────────────────────────────
// Kdo si platí měsíční režii, bere 10 % z ceny každého prádlomatu, který
// postaví hráč, jehož do hry přivedl. Režie se musí každý herní měsíc obnovit.
var DIST = null;
function loadDist(then) {
  if (!ME) { DIST = null; if (then) then(); return; }
  api('/account/distributor').then(function (r) { DIST = r.ok ? r.j : null; if (then) then(); })
    .catch(function () { if (then) then(); });
}
function distHtml() {
  if (!ME) return '';
  if (!DIST) return '<div class="card"><h3>Distributor</h3><p class="fine">Načítám…</p></div>';
  var aktivni = DIST.aktivni, rezie = DIST.rezie;
  return '<div class="card"><h3>Distributor prádlomatů</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Platíš měsíční režii a bereš '
    + Math.round(DIST.provize * 100) + ' % z ceny každého prádlomatu, který postaví hráč, '
    + 'kterého jsi do hry přivedl. Platí to i na jeho druhý, třetí a každý další.</p>'
    + '<div class="kv"><span>Stav</span><b class="' + (aktivni ? 'ok' : 'warn') + '">'
    + (aktivni ? 'aktivní, končí ' + etaText(new Date(DIST.do).getTime() - Date.now()) : 'neaktivní') + '</b></div>'
    + '<div class="kv"><span>Přivedených hráčů</span><b>' + DIST.privedeno + '</b></div>'
    + '<div class="kv"><span>Režie na měsíc</span><b class="warn">' + kcFull(rezie) + '</b></div>'
    + (DIST.provize_celkem > 0 ? '<div class="kv"><span>Vyděláno na provizích</span><b class="ok">'
      + kcFull(DIST.provize_celkem) + '</b></div>' : '')
    + '<p class="fine">Režie roste o ' + kcFull(40000) + ' s každými pěti přivedenými hráči — '
    + 'čím větší síť, tím dražší provoz.</p>'
    + (S.cash >= rezie
        ? '<button class="btn sec" id="do-dist" style="width:100%;margin-top:8px">'
          + (aktivni ? 'Prodloužit o měsíc za ' : 'Zaplatit měsíc za ') + kcFull(rezie) + '</button>'
        : '<p class="fine err">Na režii ti chybí ' + kcFull(rezie - S.cash) + '.</p>')
    + '</div>';
}
function bindDist() {
  var b = $('do-dist');
  if (!b) return;
  b.onclick = function () {
    if (!DIST || S.cash < DIST.rezie) return;
    b.disabled = true; b.textContent = 'Platím…';
    var rezie = DIST.rezie;
    apiJson('/account/distributor', {}).then(function (r) {
      if (!r.ok) { b.disabled = false; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
      S.cash -= rezie;
      save(); syncState(true);
      loadDist(function () { paintMe(); });
      toast('Distribuce zaplacená na další herní měsíc.', 'ok');
    }).catch(function () { b.disabled = false; toast('Server neodpovídá.', 'err'); });
  };
}

// Koho hráč přivedl do hry — přesná jména, ne jen počítadlo otevření.
var POZVANI = null;
function loadPozvani() {
  if (!ME) { POZVANI = []; return Promise.resolve(); }
  return api('/account/invited')
    .then(function (r) { POZVANI = (r.ok && r.j.lide) || []; })
    .catch(function () { POZVANI = []; });
}
function pozvaniHtml() {
  if (!ME) return '<p class="fine">Přihlášeným hráčům se tady vypíše, koho konkrétně přivedli.</p>';
  if (POZVANI == null) return '<p class="fine">Načítám…</p>';
  if (!POZVANI.length) return '<p class="fine">Přes tvůj odkaz se zatím nikdo nezaregistroval. '
    + 'Otevření odkazu ti zvedá návštěvnost hned, ale do sítě se počítá až založený účet.</p>';
  return '<p class="fine" style="margin-bottom:8px">Ve tvé síti '
    + mn(POZVANI.length, 'je', 'jsou', 'je') + ' ' + POZVANI.length + ' '
    + mn(POZVANI.length, 'hráč', 'hráči', 'hráčů') + ':</p>'
    + '<div class="zeb">' + POZVANI.map(function (h) {
        return '<div class="zeb-row">' + (h.znak ? znakSvg(h.znak, 24) : '<i class="znak-mezera"></i>')
          + '<span class="nick">' + esc(h.firma) + '<i>' + esc(h.nick) + '</i></span>'
          + '<b class="muted">' + datumKratce(h.kdy) + '</b></div>';
      }).join('') + '</div>';
}
function paintMe() {
  var p = PROFILES[S.profile];
  // Co má hráč rozepsané, přežije překreslení.
  var drzFirma = $('me-firma') ? $('me-firma').value : null;
  var net = S.cash + investedTotal() - S.loan;
  $('me-body').innerHTML = (ME
    ? '<div class="card"><div class="znak-hlava">' + znakSvg(ME.emblem, 56)
      + '<div><h3 style="margin:0">' + esc(ME.company || ME.nick) + '</h3>'
      + '<p class="muted small" style="margin:3px 0 0">Hraješ jako <b>' + esc(ME.nick) + '</b></p></div></div>'
      + '<p class="muted small" style="margin:10px 0 8px">Pod jménem a znakem firmy tě vidí konkurence na mapě i v žebříčku.</p>'
      + '<label class="fld"><span>Název firmy</span>'
      + '<input id="me-firma" class="inp" type="text" maxlength="60" value="' + esc(ME.company || '') + '"></label>'
      + '<button class="btn sec" id="me-firma-ulozit" style="width:100%;margin-top:8px">Přejmenovat firmu</button>'
      + '<button class="btn sec" id="me-znak" style="width:100%;margin-top:8px">'
      + (ME.emblem ? 'Změnit znak firmy' : 'Vygenerovat znak firmy') + '</button>'
      + '</div>'
    : '')
    + '<div class="card"><h3>' + esc(p.name) + '</h3>'
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
    + '<div class="card"><h3>Pozvi lidi a přibydou ti zákazníci</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Každý, kdo otevře tvůj odkaz, ti zvedne návštěvnost všech prádlomatů. '
    + 'Počítá se otevření odkazu někým jiným, ne samotné sdílení.</p>'
    + '<div class="kv"><span>Otevřeli tvůj odkaz</span><b class="ok">' + (S.refs || 0) + '×</b></div>'
    + '<div class="kv"><span>Návštěvnost</span><b>' + Math.round(traffic() * 100) + ' % '
    + (traffic() >= trafficMax() ? '(na maximu)' : '(z ' + Math.round(trafficMax() * 100) + ' %)') + '</b></div>'
    + '<div class="bar"><i style="width:' + Math.round(traffic() / trafficMax() * 100) + '%"></i></div>'
    + '<button class="btn big" id="do-share" style="margin-top:12px">' + (navigator.share ? 'Poslat odkaz' : 'Zkopírovat odkaz') + '</button>'
    + '</div>'
    + '<div class="card"><h3>Tvoje síť hráčů</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Kdo si přes tvůj odkaz založil účet. '
    + 'Tohle zůstává zapsané natrvalo.</p>'
    + pozvaniHtml() + '</div>'
    + distHtml()
    + '<button class="btn sec big" id="do-reset">Začít znovu od nuly</button>';
  if (drzFirma != null && $('me-firma')) $('me-firma').value = drzFirma;
  var fb = $('me-firma-ulozit');
  if (fb) fb.onclick = function () {
    var f = $('me-firma').value.trim();
    if (f.length < 2) return toast('Název firmy má aspoň 2 znaky.', 'err');
    fb.disabled = true; fb.textContent = 'Ukládám…';
    apiJson('/account/company', { company: f }).then(function (r) {
      fb.disabled = false; fb.textContent = 'Přejmenovat firmu';
      if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
      ME = r.j.player;
      ZEB = null; loadClaims(); paintMe();
      toast('Firma se teď jmenuje ' + ME.company + '.', 'ok');
    }).catch(function () { fb.disabled = false; fb.textContent = 'Přejmenovat firmu'; toast('Server neodpovídá.', 'err'); });
  };
  bindDist();
  var zb = $('me-znak');
  if (zb) zb.onclick = function () { znakSheet(); };
  $('do-share').onclick = function () { shareGame($('do-share')); };
  $('do-reset').onclick = function () {
    sheet('<h3>Začít znovu?</h3>'
      + '<p class="muted small">Přijdeš o celou síť, o peníze i o zabraná místa — ta se hned uvolní konkurenci. '
      + 'Tohle se nedá vrátit. Účet i zaplacené karty ti zůstávají.</p>'
      + '<button class="btn big" id="yes-reset" style="background:linear-gradient(90deg,#b4263a,#ff5d6c)">Ano, smazat a začít znovu</button>'
      + '<button class="btn sec big" id="no-reset">Nechat být</button>');
    $('no-reset').onclick = closeSheet;
    $('yes-reset').onclick = function () {
      var y = $('yes-reset'); y.disabled = true; y.textContent = 'Mažu…';
      // Smazat jen prohlížeč nestačí — stav i zabraná místa drží server a po
      // obnovení stránky by se hra vrátila přesně tam, kde byla.
      apiJson('/account/reset', {}).then(function (r) {
        if (!r.ok) { y.disabled = false; y.textContent = 'Ano, smazat a začít znovu'; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
        wiped = true;
        try { localStorage.removeItem(KEY); } catch (e) {}
        location.replace(location.pathname);
      }).catch(function () { y.disabled = false; y.textContent = 'Ano, smazat a začít znovu'; toast('Server neodpovídá.', 'err'); });
    };
  };
}


// ─── Burza: obchody mezi hráči ───────────────────────────────────────────────
// Nabídka putuje tam a zpět. Karty a místa převede server sám, hotovost, sklad
// a postavené prádlomaty si klient vyzvedne jako „následky obchodu".
var TRADES = null, TRADE_HRACI = null;

function loadTrades(then) {
  return api('/trade/list').then(function (r) {
    if (r.ok) {
      TRADES = r.j.trades || [];
      var dot = $('burza-dot');
      if (dot) dot.classList.toggle('hidden', !r.j.ceka_na_me);
    } else TRADES = [];
    if (then) then();
  }).catch(function () { TRADES = TRADES || []; if (then) then(); });
}

function predmetPopis(t) {
  if (t.predmet === 'stroj') return 'stroj ' + ((MODELS[t.model] || {}).name || t.model);
  if (t.predmet === 'pradlomat') return 'prádlomat na místě';
  var c = (CARDS_CAT || []).filter(function (x) { return x.kind === t.card_kind; })[0];
  return 'karta ' + (c ? c.name : t.card_kind);
}
function cenaPopis(t) {
  var casti = [];
  if (t.cena) casti.push(kcFull(t.cena));
  (t.karty || []).forEach(function (k) {
    var c = (CARDS_CAT || []).filter(function (x) { return x.kind === k; })[0];
    casti.push(c ? c.name : k);
  });
  return casti.join(' + ') || '—';
}

// Konkurzní rozprodej — kdo zkrachoval, toho majetek je tu měsíc za klesající cenu.
var AUKCE = null;
function loadAukce(then) {
  api('/trade/aukce').then(function (r) { AUKCE = (r.ok && r.j.aukce) || []; if (then) then(); })
    .catch(function () { AUKCE = []; if (then) then(); });
}
function aukceHtml() {
  if (!AUKCE || !AUKCE.length) return '';
  return '<div class="card"><h3>Konkurzní rozprodej</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Majetek firem, které padly. Cena klesá z 80 % na 40 % '
    + 'hodnoty — kdo si počká, koupí levněji, ale riskuje, že to mezitím vezme někdo jiný.</p>'
    + AUKCE.map(function (a) {
        return '<div class="trade"><div class="row"><b>' + esc(a.popis) + '</b>'
          + '<b class="ok">' + kcFull(a.cena) + '</b></div>'
          + '<p class="muted small" style="margin:2px 0 6px">po ' + esc(a.nick) + ' · hodnota ' + kcFull(a.hodnota)
          + ' · končí ' + etaText(new Date(a.konci).getTime() - Date.now()) + '</p>'
          + (a.moje ? '<p class="fine">Tohle je tvůj majetek z konkurzu.</p>'
            : S.cash < a.cena ? '<p class="fine err">Chybí ti ' + kcFull(a.cena - S.cash) + '.</p>'
            : '<button class="btn sm" data-aukce="' + a.id + '">Koupit za ' + kcFull(a.cena) + '</button>')
          + '</div>';
      }).join('')
    + '</div>';
}
function bindAukce() {
  [].forEach.call(document.querySelectorAll('[data-aukce]'), function (b) {
    b.onclick = function () {
      b.disabled = true; b.textContent = 'Kupuju…';
      apiJson('/trade/aukce/' + b.getAttribute('data-aukce') + '/koupit', {}).then(function (r) {
        if (!r.ok) { b.disabled = false; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
        toast('Koupeno za ' + kcFull(r.j.cena) + '.', 'ok');
        loadAukce(function () { vyzvedniNasledky(); paintBurza(); });
      }).catch(function () { b.disabled = false; toast('Server neodpovídá.', 'err'); });
    };
  });
}
function paintBurza() {
  var box = $('burza-body');
  if (!TRADES) { box.innerHTML = '<p class="muted small">Načítám…</p>'; return loadTrades(paintBurza); }
  var ceka = TRADES.filter(function (t) { return t.stav === 'ceka'; });
  var hotove = TRADES.filter(function (t) { return t.stav !== 'ceka'; }).slice(0, 20);
  var naMe = ceka.filter(function (t) { return t.na_tahu; });
  var odeslane = ceka.filter(function (t) { return !t.na_tahu; });

  if (AUKCE == null) loadAukce(paintBurza);

  box.innerHTML = aukceHtml()
    + sekce('Čeká na tvoji odpověď', naMe, 'Nikdo ti teď nic nenabízí.')
    + sekce('Čekáš na odpověď', odeslane, 'Nemáš rozjednanou žádnou nabídku.')
    + (hotove.length ? sekce('Uzavřené', hotove, '') : '');
  bindAukce();

  [].forEach.call(box.querySelectorAll('[data-tr]'), function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-tr'), co = b.getAttribute('data-akce');
      var t = TRADES.filter(function (x) { return String(x.id) === id; })[0];
      if (co === 'counter') return protinavrhSheet(t);
      // Platím-li já, ať to nepadne až na serveru.
      var jaPlatim = (t.smer === 'koupim' && t.moje) || (t.smer === 'prodam' && !t.moje);
      if (co === 'accept' && jaPlatim && t.cena > S.cash) {
        return toast('Na tohle nemáš hotovost — chybí ' + kcFull(t.cena - S.cash) + '.', 'err');
      }
      b.disabled = true;
      apiJson('/trade/' + id + '/' + co, {}).then(function (r) {
        if (!r.ok) { b.disabled = false; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
        toast(co === 'accept' ? 'Obchod uzavřen.' : 'Nabídka zamítnuta.', 'ok');
        if (co === 'accept') vyzvedniNasledky();
        loadTrades(paintBurza);
      }).catch(function () { b.disabled = false; toast('Server neodpovídá.', 'err'); });
    };
  });
}
function sekce(nadpis, list, prazdno) {
  if (!list.length && !prazdno) return '';
  return '<h3 style="margin:16px 0 4px">' + nadpis + '</h3>'
    + (list.length ? list.map(radekObchodu).join('') : '<p class="muted small">' + prazdno + '</p>');
}
function radekObchodu(t) {
  var jaKupuji = (t.smer === 'koupim' && t.moje) || (t.smer === 'prodam' && !t.moje);
  var protistrana = t.moje ? t.komu.nick : t.od.nick;
  var veta = t.moje
    ? (t.smer === 'koupim' ? 'Chceš koupit od ' + esc(protistrana) : 'Nabízíš ' + esc(protistrana))
    : (t.smer === 'koupim' ? esc(protistrana) + ' chce koupit od tebe' : esc(protistrana) + ' ti nabízí');
  return '<div class="trade' + (t.na_tahu ? ' na-tahu' : '') + '">'
    + '<h4>' + esc(predmetPopis(t)) + '</h4>'
    + '<p class="kdo">' + veta + ' · ' + (jaKupuji ? 'platíš ty' : 'platí on') + '</p>'
    + '<div class="row"><span class="muted small">Cena</span><span class="cena">' + esc(cenaPopis(t)) + '</span></div>'
    + (t.vzkaz ? '<p class="muted small" style="margin-top:6px">„' + esc(t.vzkaz) + '"</p>' : '')
    + (t.stav !== 'ceka' ? '<p style="margin-top:8px"><span class="stav ' + esc(t.stav) + '">' + esc(t.stav) + '</span></p>' : '')
    + (t.na_tahu
      ? '<div class="akce"><button class="btn sm" data-tr="' + t.id + '" data-akce="accept">Přijmout</button>'
        + '<button class="btn sm sec" data-tr="' + t.id + '" data-akce="counter">Protinávrh</button>'
        + '<button class="btn sm sec" data-tr="' + t.id + '" data-akce="decline">Odmítnout</button></div>'
      : t.stav === 'ceka' && t.moje
        ? '<div class="akce"><button class="btn sm sec" data-tr="' + t.id + '" data-akce="decline">Zrušit nabídku</button></div>'
        : '')
    + '</div>';
}

// ─── Protinávrh ──────────────────────────────────────────────────────────────
function protinavrhSheet(t) {
  var vybrane = [];
  sheet('<h3>Protinávrh</h3>'
    + '<p class="muted small">Předmět zůstává stejný (' + esc(predmetPopis(t)) + '), měníš jen cenu.</p>'
    + '<div class="kv"><span>Původní nabídka</span><b>' + esc(cenaPopis(t)) + '</b></div>'
    + '<label class="fld"><span>Co nabízíš ty (L$)</span>'
    + '<input id="pn-cena" class="inp" type="number" min="0" step="1000" value="' + (t.cena || 0) + '"></label>'
    + kartyVyber('pn')
    + '<label class="fld"><span>Vzkaz (nepovinný)</span><input id="pn-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<button class="btn big" id="pn-ok">Poslat protinávrh</button>');
  vybrane = bindKartyVyber('pn');
  $('pn-ok').onclick = function () {
    var b = $('pn-ok'); b.disabled = true;
    apiJson('/trade/' + t.id + '/counter', { cena: Number($('pn-cena').value) || 0, karty: vybrane(), vzkaz: $('pn-vzkaz').value })
      .then(function (r) {
        b.disabled = false;
        if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
        closeSheet(); loadTrades(paintBurza); toast('Protinávrh odeslán.', 'ok');
      }).catch(function () { b.disabled = false; toast('Server neodpovídá.', 'err'); });
  };
}
// Výběr karet, které hráč přihodí k ceně (platí vždy ten, kdo kupuje).
function kartyVyber(pref) {
  var moje = (CARDS_CAT || []).filter(function (c) { return ownedOf(c.kind) > 0; });
  if (!moje.length) return '';
  return '<p class="muted small" style="margin:10px 0 2px">Přihodit karty</p><div class="vyber" id="' + pref + '-karty">'
    + moje.map(function (c) { return '<button type="button" data-k="' + c.kind + '">' + esc(c.name) + ' (' + ownedOf(c.kind) + ')</button>'; }).join('')
    + '</div>';
}
function bindKartyVyber(pref) {
  var box = $(pref + '-karty');
  if (!box) return function () { return []; };
  [].forEach.call(box.querySelectorAll('[data-k]'), function (b) {
    b.onclick = function () { b.classList.toggle('on'); };
  });
  return function () {
    return [].slice.call(box.querySelectorAll('[data-k].on')).map(function (b) { return b.getAttribute('data-k'); });
  };
}

// ─── Nová nabídka ────────────────────────────────────────────────────────────
function novaNabidkaSheet() {
  sheet('<h3>Komu chceš nabídnout</h3><p class="muted small">Načítám hráče…</p>');
  api('/trade/players').then(function (r) {
    if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
    var hraci = r.j.players || [];
    if (!hraci.length) return sheet('<h3>Zatím není s kým</h3><p class="muted small">Až přibude další hráč, objeví se tady.</p>');
    sheet('<h3>Komu chceš nabídnout</h3>'
      + hraci.map(function (h) {
          return '<div class="area-item"><div><div class="nm">' + esc(h.firma) + '</div>'
            + '<div class="sub">' + esc(h.nick) + '</div></div>'
            + '<button class="btn sec sm" data-h="' + h.id + '">Vybrat</button></div>';
        }).join(''));
    [].forEach.call($('sheet-body').querySelectorAll('[data-h]'), function (b) {
      b.onclick = function () { majetekSheet(Number(b.getAttribute('data-h'))); };
    });
  }).catch(function () { toast('Server neodpovídá.', 'err'); });
}

function majetekSheet(id) {
  sheet('<h3>Co má</h3><p class="muted small">Načítám…</p>');
  api('/trade/assets/' + id).then(function (r) {
    if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
    var a = r.j, polozky = [];
    MODEL_ORDER.forEach(function (k) {
      if (a.sklad[k] > 0) polozky.push({ smer: 'koupim', predmet: 'stroj', model: k,
        popis: 'stroj ' + MODELS[k].name, pod: a.sklad[k] + '× skladem' });
    });
    (a.pradlomaty || []).forEach(function (m) {
      polozky.push({ smer: 'koupim', predmet: 'pradlomat', spot_id: m.spot_id, model: m.model,
        popis: esc(m.name || m.spot_id), pod: (MODELS[m.model] || {}).name + ' · nájem ' + kcFull(m.rent)
          + (m.zisk != null ? ' · zisk ' + kcFull(m.zisk) + '/měs' : '') });
    });
    (a.pobocky || []).forEach(function (b) {
      polozky.push({ smer: 'koupim', predmet: 'pobocka', pobocka: b.name,
        popis: 'pobočka ' + esc(b.name), pod: 'základna pro dopravu a četu' });
    });
    Object.keys(a.karty || {}).forEach(function (k) {
      var c = (CARDS_CAT || []).filter(function (x) { return x.kind === k; })[0];
      if (c && a.karty[k] > 0) polozky.push({ smer: 'koupim', predmet: 'karta', card_kind: k,
        popis: 'karta ' + c.name, pod: a.karty[k] + '× k dispozici' });
    });
    // A co můžu nabídnout já
    var moje = [];
    MODEL_ORDER.forEach(function (k) {
      if (inStock(k) > 0) moje.push({ smer: 'prodam', predmet: 'stroj', model: k,
        popis: 'můj stroj ' + MODELS[k].name, pod: inStock(k) + '× skladem' });
    });
    S.units.forEach(function (u) {
      moje.push({ smer: 'prodam', predmet: 'pradlomat', spot_id: u.spotId, model: u.eco.model,
        popis: 'můj ' + esc(u.name), pod: MODELS[u.eco.model].name + ' · zisk ' + kcFull(u.eco.profit) + '/měs' });
    });
    (S.pobocky || []).forEach(function (b) {
      moje.push({ smer: 'prodam', predmet: 'pobocka', pobocka: b.name,
        popis: 'moje pobočka ' + esc(b.name), pod: 'provoz tě stojí ' + kcFull(POBOCKA_MESICNE) + ' / měsíc' });
    });
    (CARDS_CAT || []).forEach(function (c) {
      if (ownedOf(c.kind) > 0) moje.push({ smer: 'prodam', predmet: 'karta', card_kind: c.kind,
        popis: 'moje karta ' + c.name, pod: ownedOf(c.kind) + '× k dispozici' });
    });

    var radek = function (x, i, pref) {
      return '<div class="area-item"><div><div class="nm">' + x.popis + '</div>'
        + '<div class="sub">' + x.pod + '</div></div>'
        + '<button class="btn sec sm" data-p="' + pref + i + '">Nabídnout</button></div>';
    };
    sheet('<h3>' + esc(a.hrac.firma) + '</h3>'
      + '<p class="muted small">' + esc(a.hrac.nick) + ' — vyber, o co ti jde.</p>'
      + (polozky.length ? '<h3 style="margin-top:14px">Koupit od něj</h3>' + polozky.map(function (x, i) { return radek(x, i, 'k'); }).join('')
        : '<p class="muted small">Nemá nic, co by šlo koupit.</p>')
      + (moje.length ? '<h3 style="margin-top:18px">Prodat mu</h3>' + moje.map(function (x, i) { return radek(x, i, 'p'); }).join('')
        : '<p class="muted small" style="margin-top:14px">Ty zatím nemáš co nabídnout.</p>'));
    [].forEach.call($('sheet-body').querySelectorAll('[data-p]'), function (b) {
      b.onclick = function () {
        var v = b.getAttribute('data-p');
        var x = v.charAt(0) === 'k' ? polozky[Number(v.slice(1))] : moje[Number(v.slice(1))];
        cenaSheet(id, a.hrac, x);
      };
    });
  }).catch(function () { toast('Server neodpovídá.', 'err'); });
}

function cenaSheet(toId, kdo, x) {
  var jaPlatim = x.smer === 'koupim';
  sheet('<h3>' + (jaPlatim ? 'Nabídka na odkup' : 'Nabídka k prodeji') + '</h3>'
    + '<p class="muted small">' + esc(x.popis) + ' · ' + esc(kdo.firma) + '</p>'
    + '<p class="muted small">' + (jaPlatim ? 'Platíš ty.' : 'Platí on — ty dostaneš, co si řekneš.') + '</p>'
    + '<label class="fld"><span>Cena (L$)</span>'
    + '<input id="na-cena" class="inp" type="number" min="0" step="1000" value="0"></label>'
    + (jaPlatim ? kartyVyber('na') : '')
    + '<label class="fld"><span>Vzkaz (nepovinný)</span><input id="na-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<button class="btn big" id="na-ok">Odeslat nabídku</button>');
  var vybrane = jaPlatim ? bindKartyVyber('na') : function () { return []; };
  $('na-ok').onclick = function () {
    var b = $('na-ok'); b.disabled = true;
    apiJson('/trade/offer', { to_id: toId, smer: x.smer, predmet: x.predmet, model: x.model || null,
      spot_id: x.spot_id || null, card_kind: x.card_kind || null, pobocka: x.pobocka || null,
      cena: Number($('na-cena').value) || 0, karty: vybrane(), vzkaz: $('na-vzkaz').value })
      .then(function (r) {
        b.disabled = false;
        if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
        closeSheet(); loadTrades(paintBurza); toast('Nabídka odeslána.', 'ok');
      }).catch(function () { b.disabled = false; toast('Server neodpovídá.', 'err'); });
  };
}

// ─── Následky uzavřených obchodů ─────────────────────────────────────────────
// Hotovost, sklad a postavené prádlomaty žijí v prohlížeči, takže si je sem
// musíme donést sami. Server si pak poznamená, že je máme vyřízené.
function vyzvedniNasledky(then) {
  if (!ME) { if (then) then(); return; }
  api('/trade/deliveries').then(function (r) {
    var d = (r.ok && r.j.deliveries) || [];
    if (!d.length) { if (then) then(); return; }
    var zpravy = [];
    d.forEach(function (x) {
      if (x.kind === 'cash') {
        S.cash += x.amount || 0;
        // Kdyby mezitím peníze utratil, schodek pokryje banka — ať hra neskončí
        // v záporné hotovosti, ze které není cesta ven.
        if (S.cash < 0) { pricistDluh(-S.cash, prirazkaZa(-S.cash)); S.bank = Math.max(0, S.bank + S.cash); S.cash = 0; }
      }
      else if (x.kind === 'stock') { S.stock[x.model] = Math.max(0, inStock(x.model) + (x.amount || 0)); }
      else if (x.kind === 'unit_remove') {
        S.prodano = S.prodano || {};
        S.prodano[x.spot_id] = 1;   // ať se stroj nevrátí na sklad jako při přetažení
        S.units = S.units.filter(function (u) { return u.spotId !== x.spot_id; });
      } else if (x.kind === 'pobocka_remove') {
        S.pobocky = (S.pobocky || []).filter(function (b) { return b.name !== x.spot_id; });
      } else if (x.kind === 'pobocka_add') {
        if (!(S.pobocky || []).some(function (b) { return b.name === x.spot_id; })) {
          // Souřadnice vezmeme z prozkoumaného města stejného jména, jinak od sídla.
          var mesto = null;
          Object.keys(S.areas || {}).forEach(function (aid) {
            var ar = S.areas[aid];
            if (!mesto && ar && (ar.name || aid) === x.spot_id) mesto = stredOblasti(ar);
          });
          if (!mesto && S.sidlo) mesto = { lat: S.sidlo.lat, lon: S.sidlo.lon };
          S.pobocky = S.pobocky || [];
          S.pobocky.push({ name: x.spot_id, lat: mesto ? mesto.lat : null, lon: mesto ? mesto.lon : null, od: Date.now() });
        }
      } else if (x.kind === 'unit_add') {
        var dd = x.data || {};
        if (!S.units.some(function (u) { return u.spotId === x.spot_id; })) {
          var sp = { id: x.spot_id, name: dd.name || 'Koupený prádlomat', kind: 'unknown',
            score: 60, lat: dd.lat, lon: dd.lon };
          var eco = economics(sp, x.model || 'mini');
          eco.rent = dd.rent || eco.rent;
          eco.cost = eco.energy + eco.servis + eco.rent;
          eco.profit = eco.revenue - eco.cost;
          S.units.push({ spotId: x.spot_id, areaId: dd.area_key || '', name: sp.name, kind: sp.kind,
            score: sp.score, lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: eco });
        }
      }
      if (x.popis) zpravy.push(x.popis);
    });
    save(); paint(); drawMap(); syncState(true);
    apiJson('/trade/deliveries/claim', { ids: d.map(function (x) { return x.id; }) }).catch(function () {});
    if (zpravy.length) toast(zpravy[0] + (zpravy.length > 1 ? ' (+' + (zpravy.length - 1) + ' dalších)' : ''), 'ok');
    if (then) then();
  }).catch(function () { if (then) then(); });
}

// ─── Přepínání záložek ───────────────────────────────────────────────────────
var TABS = ['map', 'shop', 'net', 'bank', 'cards', 'burza', 'me'];
function switchTab(v) {
  [].forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.toggle('on', x.getAttribute('data-v') === v); });
  TABS.forEach(function (k) { $('v-' + k).classList.toggle('hidden', k !== v); });
  paint();
  if (v === 'map' && map) { setTimeout(function () { map.invalidateSize(); }, 50); loadClaims(); }
  // Burza se musí ptát serveru pokaždé — nabídka mohla přijít před vteřinou.
  if (v === 'burza') { AUKCE = null; loadTrades(paintBurza); }
  if (v === 'me' && POZVANI == null) loadPozvani().then(paintMe);
  if (v === 'me' && DIST == null) loadDist(paintMe);
}
[].forEach.call(document.querySelectorAll('.tabs button'), function (b) {
  b.onclick = function () { switchTab(b.getAttribute('data-v')); };
});
$('open-areas').onclick = areasSheet;
if ($('tut-skip')) $('tut-skip').onclick = tutSkip;
// Hotovost v hlavičce je tlačítko — odtud se hráč dostane k penězům.
if ($('t-penize')) $('t-penize').onclick = function () { penizeSheet(); };
$('burza-nova').onclick = novaNabidkaSheet;
// Přepínače v záložce Síť: moje síť vs. žebříček a kategorie žebříčku.
[].forEach.call(document.querySelectorAll('[data-net]'), function (b) {
  b.onclick = function () {
    var zeb = b.getAttribute('data-net') === 'zebricek';
    [].forEach.call(document.querySelectorAll('[data-net]'), function (x) { x.classList.toggle('on', x === b); });
    $('net-moje').classList.toggle('hidden', zeb);
    $('net-zebricek').classList.toggle('hidden', !zeb);
    if (zeb) { ZEB = null; paintZeb(); } else paintNet();
  };
});
[].forEach.call(document.querySelectorAll('[data-zeb]'), function (b) {
  b.onclick = function () {
    ZEB_KAT = b.getAttribute('data-zeb');
    [].forEach.call(document.querySelectorAll('[data-zeb]'), function (x) { x.classList.toggle('on', x === b); });
    paintZeb();
  };
});


// ─── Účet hráče ──────────────────────────────────────────────────────────────
// Stav hry žije v prohlížeči, ale zrcadlíme ho na server. Důvod je prostý:
// zrychlující karty se kupují za skutečné peníze, a ty nesmí zmizet s cache.
// Karty samotné server drží ve vlastní tabulce a klient je nikdy nepřipisuje sám.
var ME = null;            // { nick, email, cards: {…}, has_details }
var CARDS_CAT = null;     // katalog ze serveru
var PAYMENTS_ON = false;  // jsou nastavené klíče Stripe?
var syncAt = 0, syncBusy = false;

// ─── Sledování cesty hráče ───────────────────────────────────────────────────
// Posíláme jen krok a náhodné id návštěvy — podle toho je v administraci vidět,
// kde lidé odpadají. Žádné osobní údaje.
var VID_KEY = 'lm_vid';
function visitId() {
  try {
    var v = localStorage.getItem(VID_KEY);
    if (!v) { v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toLowerCase(); localStorage.setItem(VID_KEY, v); }
    return v;
  } catch (e) { return 'anon' + Math.random().toString(36).slice(2, 10); }
}
var evDone = {};
function ev(name, znovu) {
  if (!znovu && evDone[name]) return;
  evDone[name] = 1;
  try {
    fetch('/api/game/ev', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: name, sid: visitId() }), keepalive: true }).catch(function () {});
  } catch (e) { /* sledování nikdy nesmí shodit hru */ }
}

function api(path, opts) {
  return fetch('/api/game' + path, Object.assign({ credentials: 'same-origin' }, opts || {}))
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
}
function apiJson(path, body, method) {
  return api(path, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
}
// Uložení na server. Neposíláme častěji než jednou za 15 s, ať to netluče zbytečně.
var wiped = false;   // po smazání hry už nic na server neposíláme
function syncState(force) {
  if (wiped || !ME || syncBusy || !S) return Promise.resolve();
  if (!force && Date.now() - syncAt < 15000) return Promise.resolve();
  syncBusy = true; syncAt = Date.now();
  return apiJson('/account/state', { state: S }, 'PUT')
    .catch(function () { /* offline — zkusí se příště */ })
    .then(function () { syncBusy = false; });
}

// ─── Registrace / přihlášení ────────────────────────────────────────────────
function showAcct(mode) {
  ['intro', 'quiz', 'role'].forEach(function (id) { $(id).classList.add('hidden'); });
  $('acct').classList.remove('hidden');
  var login = mode === 'login';
  $('acct').querySelector('h2').textContent = login ? 'Přihlas se ke své síti' : 'Vyber si herní nick';
  $('ac-go').textContent = login ? 'Přihlásit a pokračovat' : 'Založit a hrát';
  $('ac-have').textContent = login ? 'Chci začít znovu s novým účtem' : 'Už účet mám — přihlásit se';
  $('ac-nick-hint').classList.toggle('hidden', login);
  $('ac-firma-f').classList.toggle('hidden', login);
  $('ac-firma-hint').classList.toggle('hidden', login);
  $('ac-pass').setAttribute('autocomplete', login ? 'current-password' : 'new-password');
  $('ac-err').classList.add('hidden');
  $('ac-have').onclick = function () { showAcct(login ? 'register' : 'login'); };
  var zp = $('ac-zpet');
  if (zp) zp.onclick = function () {
    $('acct').classList.add('hidden');
    // Bez rozehrané hry se vracíme na úvod, jinak zpátky k výběru profilu.
    $(S ? 'role' : 'intro').classList.remove('hidden');
  };
  $('ac-go').onclick = function () { doAcct(login); };
  setTimeout(function () { $('ac-nick').focus(); }, 60);
}
function acctErr(t) { var e = $('ac-err'); e.textContent = t; e.classList.remove('hidden'); }
function doAcct(login) {
  var nick = $('ac-nick').value.trim(), pass = $('ac-pass').value;
  if (nick.length < 3) return acctErr('Nick musí mít aspoň 3 znaky.');
  if (pass.length < 6) return acctErr('Heslo musí mít aspoň 6 znaků.');
  $('ac-go').disabled = true;
  var firma = $('ac-firma').value.trim();
  if (!login && firma.length && firma.length < 2) return acctErr('Název firmy má aspoň 2 znaky.');
  apiJson('/account/' + (login ? 'login' : 'register'),
    { nick: nick, password: pass, company: firma, ref: trvalePid(), odkud: prichoziRef() }).then(function (r) {
    $('ac-go').disabled = false;
    if (!r.ok) return acctErr(r.j.error || 'Nepovedlo se.');
    ME = r.j.player;
    srovnejRef();
    POZVANI = null;
    if (!login) ev('game_register');
    if (login) {
      // Na serveru je uložená síť — ta má přednost před tím, co je v prohlížeči.
      if (r.j.state) { S = r.j.state; save(); }
      else if (!S) {
        // Účet existuje, ale rozehraná hra k němu není — pošleme ho vybrat profil.
        $('acct').classList.add('hidden');
        $('intro').classList.remove('hidden');
        return toast('Přihlášeno. Teď si ještě vyber, jaký jsi podnikatel.', 'ok');
      }
    }
    $('acct').classList.add('hidden');
    srovnejRef();   // znovu: po přihlášení mohl přijít stav se starým pid
    startGame();
    syncState(true);
  }).catch(function () { $('ac-go').disabled = false; acctErr('Server neodpovídá. Zkus to za chvíli.'); });
}

// ─── Karty ───────────────────────────────────────────────────────────────────
var CARD_ART = {
  rush: { emoji: '🚚', tone: 'blue' }, traffic: { emoji: '📣', tone: 'violet' },
  connect: { emoji: '🔧', tone: 'green' }, credit: { emoji: '🏦', tone: 'gold' }
};
function loadCards() {
  return api('/cards').then(function (r) {
    if (!r.ok) return;
    CARDS_CAT = r.j.catalog; CASH_CAT = r.j.cash || null; PAYMENTS_ON = !!r.j.payments;
    if (r.j.owned && ME) ME.cards = r.j.owned;
  }).catch(function () { });
}
function ownedOf(kind) { return (ME && ME.cards && ME.cards[kind]) || 0; }
function paintCards() {
  var box = $('cards-body');
  if (!CARDS_CAT) { box.innerHTML = '<p class="muted small">Načítám…</p>'; return loadCards().then(paintCards); }
  var total = CARDS_CAT.reduce(function (a, c) { return a + ownedOf(c.kind); }, 0);
  var vsechny = CARDS_CAT.length && CARDS_CAT.every(function (c) { return ownedOf(c.kind) >= 1; });
  box.innerHTML = (total ? '' : '<p class="muted small">Zatím žádnou kartu nemáš.</p>')
    + (vsechny ? '<p class="muted small">Od každé karty máš jednu do začátku — jsou tvoje, použij je, kdy chceš.</p>' : '')
    + CARDS_CAT.map(function (c) {
      var n = ownedOf(c.kind), art = CARD_ART[c.kind] || { emoji: '⚡', tone: 'blue' };
      return '<div class="gcard ' + art.tone + '">'
        + '<div class="gcard-top"><span class="gcard-ico">' + art.emoji + '</span>'
        + '<div><h3>' + esc(c.name) + '</h3><p class="gcard-short">' + esc(c.short) + '</p></div>'
        + (n ? '<b class="gcard-n">' + n + '×</b>' : '') + '</div>'
        + '<p class="muted small">' + esc(c.desc) + '</p>'
        + '<div class="gcard-act">'
        + (n ? '<button class="btn sm" data-use="' + c.kind + '">Použít</button>' : '')
        + (PAYMENTS_ON ? '<button class="btn sm ghost" data-buy-card="' + c.kind + '">Koupit za ' + c.price_czk.toLocaleString('cs-CZ') + ' Kč</button>'
          : '<span class="fine">Prodej se teprve spouští.</span>')
        + '</div></div>';
    }).join('');
  [].forEach.call(box.querySelectorAll('[data-use]'), function (b) { b.onclick = function () { useCard(b.getAttribute('data-use')); }; });
  [].forEach.call(box.querySelectorAll('[data-buy-card]'), function (b) { b.onclick = function () { buyCard(b.getAttribute('data-buy-card')); }; });
}

// Karta se spotřebuje NA SERVERU a teprve pak se projeví ve hře.
// Zrychlí JEDNU vybranou zásilku, ne tu nejbližší — hráč si kliknul na konkrétní.
function rushOrder(orderedAt, btn) {
  var o = (S.orders || []).filter(function (x) { return x.orderedAt === orderedAt; })[0];
  if (!o) return toast('Tahle zásilka už dorazila.', 'err');
  if (!ownedOf('rush')) return toast('Nemáš kartu Expresní dovoz.', 'err');
  if (btn) { btn.disabled = true; btn.textContent = 'Volám dopravci…'; }
  apiJson('/cards/use', { kind: 'rush', on: o.model }).then(function (r) {
    if (!r.ok) { if (btn) { btn.disabled = false; btn.textContent = '⚡ Doručit hned'; } return toast(r.j.error || 'Nepovedlo se.', 'err'); }
    if (ME) ME.cards = r.j.owned;
    o.arrivesAt = Date.now() - 1;
    deliverOrders();
    save(); syncState(true); paint(); paintShop();
    toast(MODELS[o.model].name + ' je skladem — můžeš stavět.', 'ok');
  }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = '⚡ Doručit hned'; } toast('Server neodpovídá.', 'err'); });
}
function useCard(kind) {
  if (kind === 'rush' && !(S.orders || []).length) return toast('Nemáš nic na cestě — nejdřív si kup stroj v obchodě.', 'err');
  if (kind === 'connect' && S.connDiscount) return toast('Slevu na přípojky už máš připravenou.', 'err');
  apiJson('/cards/use', { kind: kind }).then(function (r) {
    if (!r.ok) return toast(r.j.error || 'Kartu se nepovedlo použít.', 'err');
    if (ME) ME.cards = r.j.owned;
    applyCard(r.j.result);
    save(); syncState(true); paint(); paintCards();
    toast(r.j.result.msg, 'ok');
  }).catch(function () { toast('Server neodpovídá.', 'err'); });
}
function applyCard(e) {
  if (!e) return;
  if (e.effect === 'rush') {
    var next = (S.orders || []).slice().sort(function (a, b) { return a.arrivesAt - b.arrivesAt; })[0];
    if (next) next.arrivesAt = Date.now() - 1;
    deliverOrders();
  } else if (e.effect === 'traffic') {
    S.boost = (S.boost || 0) + (e.add || 0);
  } else if (e.effect === 'connect') {
    S.connDiscount = e.discount || 0;
  } else if (e.effect === 'credit') {
    S.rateDrop = (S.rateDrop || 0) + (e.rate_drop || 0);
    S.bankBonus = (S.bankBonus || 0) + (e.room_add || 0);
    S.bank += e.room_add || 0;
  }
}

// ─── Úvěr: nabídka banky ─────────────────────────────────────────────────────
// Banka se dívá na dvě věci: kolik máš v zástavě a jak jsi zadlužený. Čím víc
// už dlužíš proti majetku, tím vyšší úrok a tím menší ochota půjčit.
var UVER_POPLATEK = 0.01;   // jednorázově za sjednání
function uverNabidka(chci, iSplatnosti) {
  var p = PROFILES[S.profile];
  var nalada = naladaDnes();
  var iS = Math.max(0, Math.min(maxSplatnost(), iSplatnosti == null ? 0 : iSplatnosti));
  var sp = SPLATNOSTI[iS];
  // Složená zástava je také majetek — bez ní by zadluženost vyšla nesmyslně vysoká.
  var majetek = assetsTotal() + Math.max(0, (S && S.duvera) || 0);
  var strop = Math.max(0, zastavaStrop() - S.loan);
  var max = Math.max(0, Math.min(strop, S.bank, OPERATING_MAX + strop));
  // Provozní úvěr banka posuzuje podle cash flow celé firmy: co síť vydělá
  // minus splátky, které už běží.
  var dscr = maSkraloup() ? 0 : stropPodleZisku(monthlyProfit() - splatkyMesicne(), max);
  var brzdiVydelek = dscr < max;
  max = Math.round(Math.min(max * nalada.castka, dscr, S.bank) / 1000) * 1000;
  var castka = Math.max(0, Math.min(max, Math.round((chci == null ? max : chci) / 1000) * 1000));
  // Zadluženost po načerpání — podle ní si banka říká přirážku.
  var ted = majetek > 0 ? S.loan / majetek : 0;
  var pak = majetek > 0 ? (S.loan + castka) / majetek : 2;
  var prirazka = prirazkaZa(castka) + sp.prirazka + nalada.sazba;
  var sazba = Math.max(0.02, rateOf() + prirazka);
  var poplatek = Math.round(castka * UVER_POPLATEK);
  var splatkaMes = anuita(castka, sazba, sp.mesicu);
  var celkemUrok = Math.max(0, splatkaMes * sp.mesicu - castka);
  // Kolik si může půjčit, aby ještě zůstal v levnějším pásmu — ať ví, kde je hranice.
  var bezPrirazky = Math.max(0, Math.floor((0.5 * majetek - S.loan) / 1000) * 1000);
  var levnejsi = Math.max(0, Math.floor((0.8 * majetek - S.loan) / 1000) * 1000);
  return { max: max, castka: castka, sazba: sazba, prirazka: prirazka, poplatek: poplatek,
    naruku: Math.max(0, castka - poplatek), mesicne: Math.round(castka * sazba / 12),
    ted: ted, zadluzenost: pak, majetek: majetek, dscr: dscr, brzdiVydelek: brzdiVydelek,
    nalada: nalada, iSplatnosti: iS, splatnost: sp, splatkaMes: splatkaMes, celkemUrok: celkemUrok,
    // Sazba, kterou hráč ponese na celém dluhu po načerpání (vážený průměr).
    poSjednani: Math.max(0.02, rateOf() + ((S.loan * (S.loanPrem || 0) + castka * prirazka) / Math.max(1, S.loan + castka))),
    bezPrirazky: bezPrirazky, levnejsi: levnejsi };
}
// Proč banka nepůjčí. Hráč má vždycky vědět, co s tím může udělat.
function uverDuvod() {
  if (maSkraloup()) {
    return 'Po konkurzu ti banka herní rok nepůjčí. Zbývá ' + etaText((S.skraloupDo || 0) - Date.now())
      + '. Do té doby musíš vystačit s tím, co síť vydělá.';
  }
  var p = PROFILES[S.profile];
  var majetek = assetsTotal();
  var strop = Math.max(0, zastavaStrop() - S.loan);
  if (majetek <= 0 && strop < 1000) return 'Banka půjčuje proti majetku a ty zatím žádný nemáš. Kup první prádlomat — nebo slož zástavu přes Dobít banku — a rámec se otevře.';
  if (strop < 1000) {
    return 'Banka ti půjčí nejvýš ' + Math.round(p.ltv * 100) + ' % hodnoty majetku, což je '
      + kcFull(Math.round(p.ltv * majetek)) + ' — a tolik už dlužíš. Splať část úvěru, nebo přikup prádlomat; '
      + 'tím ti strop povyroste.';
  }
  var zbyva = monthlyProfit() - splatkyMesicne();
  if (stropPodleZisku(zbyva, 0) < 1000) {
    return 'Banka se dívá na to, co ti po splátkách zbývá — a to je '
      + kcFull(Math.max(0, zbyva)) + ' měsíčně. Na další splátku to nestačí. '
      + 'Postav další prádlomat, nebo splať část úvěru a vrať se.';
  }
  return 'Volný rámec v bance je vyčerpaný. Sám dorůstá o ' + kcFull(BANK_PER_DAY)
    + ' za den — nebo ho doplníš tím, že splatíš část úvěru.';
}
function uverSheet(chci, iSplatnosti) {
  var n = uverNabidka(chci, iSplatnosti);
  if (n.max < 1000) { closeSheet(); return toast('Banka ti teď nepůjčí ani korunu.', 'err'); }
  // Hodnotíme PŮJČKU, ne hráče: přirážka se řídí tím, jak bude zadlužený až
  // si tuhle částku vezme. Dřív tu stálo „jsi zadlužený" i tomu, kdo neměl ani korunu dluhu.
  var po = Math.round(n.zadluzenost * 100);
  var hodnoceni = n.prirazka === 0
      ? 'Při téhle částce budeš dlužit ' + po + ' % hodnoty svého majetku. To je pro banku v klidu, sazbu nezvedáme.'
    : n.prirazka <= 0.008
      ? 'Po načerpání budeš dlužit ' + po + ' % hodnoty majetku. Ještě dobré, přirážka je malá.'
    : n.prirazka <= 0.018
      ? 'Po načerpání budeš dlužit ' + po + ' % hodnoty majetku — to už banka bere jako riziko a připočítá si přirážku.'
      : 'Po načerpání budeš dlužit ' + po + ' % hodnoty majetku, skoro tolik co máš. Půjčíme, ale draho.';
  var rada = n.prirazka > 0 && n.bezPrirazky >= 1000 && n.bezPrirazky < n.castka
      ? 'Do ' + kcFull(n.bezPrirazky) + ' je sazba bez přirážky.'
    : n.prirazka > 0.008 && n.levnejsi >= 1000 && n.levnejsi < n.castka
      ? 'Do ' + kcFull(n.levnejsi) + ' by byla přirážka jen 0,8 bodu.'
    : '';
  var maxS = maxSplatnost();
  sheet('<h3>Nabídka banky</h3>'
    + '<div class="nalada ' + n.nalada.id + '"><b>' + n.nalada.nazev + '</b>'
    + '<span>' + esc(n.nalada.slovo) + '</span></div>'
    + '<p class="muted small">' + hodnoceni + (rada ? ' ' + rada : '')
    + ' Podmínky platí, dokud je nepřijmeš — nic se neděje samo.</p>'
    + (n.brzdiVydelek ? '<div class="kv"><span>Strop podle výdělku firmy</span><b class="warn">' + kcFull(n.dscr) + '</b></div>'
        + '<p class="fine">Zástava by dovolila víc, ale banka chce, aby ti na splátku zbývalo aspoň '
        + KRYTI_MIN.toFixed(2).replace('.', ',') + '× tolik, co splátka dělá.</p>' : '')
    + (duveraVolna() > 0 ? '<div class="kv"><span>Z toho proti zástavě</span><b class="ok">'
        + kcFull(duveraVolna()) + '</b></div>'
        + '<p class="fine">Tolik ti banka půjčí i bez výdělku — složená zástava úvěr kryje.</p>' : '')
    + '<div class="kv"><span>Dnes dlužíš</span><b' + (S.loan > 0 ? ' class="warn"' : '') + '>' + kcFull(S.loan)
    + (S.loan > 0 ? ' · ' + Math.round(n.ted * 100) + ' % majetku' : '') + '</b></div>'
    + '<label class="fld"><span>Kolik si chceš půjčit (nejvýš ' + kcFull(n.max) + ')</span>'
    + '<input id="uv-amt" class="inp" type="number" min="1000" step="1000" max="' + n.max + '" value="' + n.castka + '"></label>'
    + '<label class="fld"><span>Na jak dlouho</span></label>'
    + '<div class="splat">' + SPLATNOSTI.map(function (x, i) {
        var lze = i <= maxS;
        return '<button class="splat-b' + (i === n.iSplatnosti ? ' on' : '') + (lze ? '' : ' zamceno')
          + '" data-splat="' + i + '"' + (lze ? '' : ' disabled') + '>'
          + '<b>' + x.nazev + '</b><span>' + (lze ? kcFull(anuita(n.castka, Math.max(0.02, rateOf() + prirazkaZa(n.castka) + x.prirazka + n.nalada.sazba), x.mesicu)) + ' / měs' : 'zamčeno') + '</span></button>';
      }).join('') + '</div>'
    + (maxS < SPLATNOSTI.length - 1 ? '<p class="fine">' + esc(splatnostDuvod(maxS + 1)) + '</p>' : '')
    + '<div class="kv"><span>Úrok</span><b>' + (n.sazba * 100).toFixed(1).replace('.', ',') + ' % ročně'
    + (n.prirazka > 0.0005 ? ' <span class="warn">(+' + (n.prirazka * 100).toFixed(1).replace('.', ',') + ' za riziko a splatnost)</span>' : '') + '</b></div>'
    + '<div class="kv"><span>Poplatek za sjednání (1 %)</span><b class="warn">' + kcFull(n.poplatek) + '</b></div>'
    + '<div class="kv"><span>Dostaneš na ruku</span><b class="ok">' + kcFull(n.naruku) + '</b></div>'
    + '<div class="kv souhrn"><span>Splátka</span><b class="warn">' + kcFull(n.splatkaMes) + ' / měsíc po ' + n.splatnost.nazev + '</b></div>'
    + '<div class="kv"><span>Celkem na úrocích zaplatíš</span><b>' + kcFull(n.celkemUrok) + '</b></div>'
    + '<div class="kv"><span>Dluh po načerpání</span><b>' + kcFull(S.loan + n.castka) + '</b></div>'
    + (S.loan > 0 && Math.abs(n.poSjednani - n.sazba) > 0.0005
        ? '<div class="kv"><span>Sazba z celého dluhu</span><b>'
          + (n.poSjednani * 100).toFixed(1).replace('.', ',') + ' % ročně</b></div>'
          + '<p class="fine">Starý dluh má svoji sazbu, nová půjčka svoji — banka je zprůměruje podle částek.</p>'
        : '')
    + '<button class="btn big" id="uv-ano">Beru to</button>'
    + '<button class="btn sec" id="uv-ne" style="width:100%;margin-top:8px">Díky, nechám si to projít hlavou</button>'
    + '<p class="fine">Splátka se strhne každý herní měsíc sama. Doplatit zbytek můžeš kdykoli a bez sankcí.</p>');
  // Při změně částky přepočítáme celou nabídku — sazba se může hnout.
  var inp = $('uv-amt');
  if (inp) inp.onchange = function () { uverSheet(Number(inp.value) || 0, n.iSplatnosti); };
  [].forEach.call(document.querySelectorAll('[data-splat]'), function (b) {
    b.onclick = function () { uverSheet(Number(inp.value) || 0, Number(b.getAttribute('data-splat'))); };
  });
  $('uv-ne').onclick = closeSheet;
  $('uv-ano').onclick = function () {
    var m = uverNabidka(Number(inp.value) || 0, n.iSplatnosti);
    if (m.castka < 1000) return toast('Takhle malou částku banka neřeší.', 'err');
    S.bank -= m.castka;
    pricistDluh(m.castka, m.prirazka, { druh: 'provoz', popis: 'Úvěr z banky na ' + m.splatnost.nazev }, m.splatnost.mesicu);
    S.cash += m.naruku;
    S.stats.interest += m.poplatek;   // poplatek bereme jako náklad úvěru
    save(); paint(); paintBank(); closeSheet(); syncState(true);
    toast('Úvěr sjednán. Na účtu máš o ' + kcFull(m.naruku) + ' víc.', 'ok');
  };
}

// ─── Balíčky herních peněz ───────────────────────────────────────────────────
// Laundry se kupují stejnou cestou jako karty: po zaplacení visí balíček na
// účtu a klient si ho vyzvedne — díky tomu se peníze nepřipíšou dvakrát ani
// se neztratí, když hráč zavře stránku hned po platbě.
var CASH_CAT = null;
function cashPacksHtml() {
  if (!PAYMENTS_ON) {
    return '<div class="card"><h3>Dobít banku</h3><p class="muted small" style="margin:2px 0 0">'
      + 'Balíčky herních peněz se teprve spouštějí. Zatím se banka doplňuje jen sama.</p></div>';
  }
  if (!CASH_CAT) return '<div class="card"><h3>Dobít banku</h3><p class="muted small" style="margin:2px 0 0">Načítám…</p></div>';
  return '<div class="card"><h3>Dobít banku</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Zvedne ti volný rámec v bance a složí se jako zástava — '
    + 'banka proti ní půjčí, i když na to ještě nevyděláváš. Čím větší balík, tím víc laundrů za korunu.</p>'
    + CASH_CAT.map(function (c) {
      return '<div class="pack" data-pack="' + c.kind + '">'
        + '<div class="pack-l"><b>' + kcFull(c.laundry) + '</b>'
        + '<span>' + esc(c.name) + (c.bonus > 0 ? ' · o ' + c.bonus + ' % výhodnější' : '') + '</span></div>'
        + '<button class="btn sm">' + c.price_czk.toLocaleString('cs-CZ') + ' Kč</button></div>';
    }).join('')
    + '<p class="fine">Platbu zpracovává Stripe. Peníze se připíšou hned po zaplacení.</p></div>';
}
function bindCashPacks() {
  [].forEach.call(document.querySelectorAll('#bank-body [data-pack]'), function (el) {
    el.onclick = function () { buyCash(el.getAttribute('data-pack')); };
  });
}
function buyCash(kind) {
  var c = (CASH_CAT || []).filter(function (x) { return x.kind === kind; })[0];
  if (!c) return;
  if (!ME) return toast('Nejdřív se přihlas.', 'err');
  if (!ME.has_details) return detailsSheet(null, kind);
  sheet('<h3>' + esc(c.name) + '</h3>'
    + '<div class="kv"><span>Rámec a zástava v bance</span><b class="ok">+' + kcFull(c.laundry) + '</b></div>'
    + '<div class="kv"><span>Cena</span><b>' + c.price_czk.toLocaleString('cs-CZ') + ' Kč</b></div>'
    + '<div class="kv"><span>Za korunu</span><b>' + c.per_czk.toLocaleString('cs-CZ') + ' L$</b></div>'
    + '<div class="kv"><span>Platí</span><b>' + esc(ME.first_name + ' ' + ME.last_name) + '</b></div>'
    + '<button class="btn big" id="do-pay">Zaplatit kartou</button>'
    + '<p class="fine">Laundry jsou herní měna bez jakékoli hodnoty a nejde je směnit zpět.</p>');
  $('do-pay').onclick = function () {
    $('do-pay').disabled = true;
    apiJson('/stripe/checkout', { kind: kind, qty: 1 }).then(function (r) {
      if (r.ok && r.j.url) { location.href = r.j.url; return; }
      $('do-pay').disabled = false;
      if (r.status === 428) return detailsSheet(null, kind);
      toast(r.j.error || 'Platbu se nepodařilo založit.', 'err');
    }).catch(function () { $('do-pay').disabled = false; toast('Server neodpovídá.', 'err'); });
  };
}
// Zaplacené balíčky si vyzvedneme sami, hráč na nic klikat nemusí.
function claimCash(then) {
  if (!ME || !ME.cards) { if (then) then(); return; }
  // Nejdřív ručně přidaná hotovost z administrace, pak koupené balíčky.
  var k = null;
  if ((ME.cards.cash_dar || 0) > 0) k = 'cash_dar';
  else if (CASH_CAT) {
    var dluzne = CASH_CAT.filter(function (c) { return (ME.cards[c.kind] || 0) > 0; });
    if (dluzne.length) k = dluzne[0].kind;
  }
  if (!k) { if (then) then(); return; }
  apiJson('/cards/use', { kind: k }).then(function (r) {
    var v = r.ok && r.j.result;
    if (v && (v.effect === 'cash' || v.effect === 'ramec')) {
      // Hotovost přidaná z administrace jde do kapsy, koupený balíček do rámce.
      // Koupený balík je zároveň zástava: banka proti němu půjčí i bez výdělku.
      if (v.effect === 'ramec') { S.bank += v.amount; S.duvera = (S.duvera || 0) + v.amount; }
      else S.cash += v.amount;
      ME.cards = r.j.owned;
      save(); paint(); syncState(true);
      toast(v.msg, 'ok');
      return claimCash(then);   // může jich čekat víc
    }
    if (then) then();
  }).catch(function () { if (then) then(); });
}

// ─── Nákup karty ─────────────────────────────────────────────────────────────
function buyCard(kind) {
  var c = (CARDS_CAT || []).filter(function (x) { return x.kind === kind; })[0];
  if (!c) return;
  if (!ME) return toast('Nejdřív se přihlas.', 'err');
  if (!ME.has_details) return detailsSheet(kind);
  sheet('<h3>' + esc(c.name) + '</h3>'
    + '<p class="muted small">' + esc(c.desc) + '</p>'
    + '<div class="kv"><span>Cena</span><b>' + c.price_czk.toLocaleString('cs-CZ') + ' Kč</b></div>'
    + '<div class="kv"><span>Platí</span><b>' + esc(ME.first_name + ' ' + ME.last_name) + '</b></div>'
    + '<div class="kv"><span>E-mail</span><b>' + esc(ME.email) + '</b></div>'
    + '<button class="btn big" id="do-pay">Zaplatit kartou</button>'
    + '<p class="fine">Platbu zpracovává Stripe. Karta se ti připíše hned po zaplacení.</p>');
  $('do-pay').onclick = function () {
    $('do-pay').disabled = true;
    apiJson('/stripe/checkout', { kind: kind, qty: 1 }).then(function (r) {
      if (r.ok && r.j.url) { location.href = r.j.url; return; }
      $('do-pay').disabled = false;
      if (r.status === 428) return detailsSheet(kind);
      toast(r.j.error || 'Platbu se nepodařilo založit.', 'err');
    }).catch(function () { $('do-pay').disabled = false; toast('Server neodpovídá.', 'err'); });
  };
}
// Jméno a e-mail chceme až tady — do té chvíle je hra úplně anonymní.
function detailsSheet(thenKind, thenCash) {
  sheet('<h3>Ještě dva údaje</h3>'
    + '<p class="muted small">K platbě potřebujeme vědět, komu kartu připsat a kam poslat doklad.</p>'
    + '<label class="fld"><span>Jméno</span><input id="d-first" class="inp" type="text" maxlength="60" value="' + esc((ME && ME.first_name) || '') + '"></label>'
    + '<label class="fld"><span>Příjmení</span><input id="d-last" class="inp" type="text" maxlength="60" value="' + esc((ME && ME.last_name) || '') + '"></label>'
    + '<label class="fld"><span>E-mail</span><input id="d-mail" class="inp" type="email" maxlength="160" value="' + esc((ME && ME.email) || '') + '"></label>'
    + '<button class="btn big" id="d-save">Uložit a pokračovat</button>');
  $('d-save').onclick = function () {
    apiJson('/account/details', {
      first_name: $('d-first').value, last_name: $('d-last').value, email: $('d-mail').value
    }).then(function (r) {
      if (!r.ok) return toast(r.j.error || 'Nepovedlo se uložit.', 'err');
      ME = r.j.player; closeSheet();
      if (thenKind) buyCard(thenKind);
      else if (thenCash) buyCash(thenCash);
    }).catch(function () { toast('Server neodpovídá.', 'err'); });
  };
}

// Návrat z platby: ?platba=ok&s=cs_… — karta se připisuje na webhook, takže
// chvíli počkáme, než se na serveru objeví.
function checkPayment() {
  var m = /[?&]platba=([a-z]+)/.exec(location.search);
  if (!m) return;
  var sid = (/[?&]s=([^&]+)/.exec(location.search) || [])[1];
  history.replaceState(null, '', location.pathname);
  if (m[1] !== 'ok' || !sid) return toast('Platba zrušená, nic se nestrhlo.', 'err');
  var tries = 0;
  (function poll() {
    api('/stripe/status?s=' + encodeURIComponent(sid)).then(function (r) {
      if (r.ok && r.j.status === 'paid') {
        ev('game_paid', true);
        if (ME) ME.cards = r.j.owned;
        if (/^cash/.test(r.j.kind || '')) {
          return claimCash(function () { paintBank(); switchTab('bank'); });
        }
        paintCards(); switchTab('cards');
        return toast('Zaplaceno — karta je tvoje.', 'ok');
      }
      if (++tries < 10) return setTimeout(poll, 1500);
      toast('Platba se ještě potvrzuje. Karta se objeví během chvilky.', 'ok');
    }).catch(function () { });
  })();
}

// ─── Start ───────────────────────────────────────────────────────────────────
function startGame() {
  ['intro', 'quiz', 'role'].forEach(function (id) { $(id).classList.add('hidden'); });
  $('app').classList.remove('hidden');
  var before = S.cash, waiting = (S.orders || []).length;
  tick(); save(); paint();
  var arrived = waiting - (S.orders || []).length;
  initMap();
  tutStart();
  var gained = S.cash - before;
  if (arrived) toast('Dorazilo ' + arrived + ' strojů — čekají na skladě v obchodě.', 'ok');
  else if (gained > 1000) toast('Než ses vrátil, síť vydělala ' + kcFull(gained) + '.', 'ok');
  pullRefs();
  loadCards().then(function () {
    claimCash();   // co je zaplacené a nevyzvednuté, připíšeme hned
    if (!$('v-cards').classList.contains('hidden')) paintCards();
    if (!$('v-bank').classList.contains('hidden')) paintBank();
  });
  loadClaims();
  setInterval(loadClaims, 45000);
  vyzvedniNasledky();
  loadTrades();
  setInterval(function () { loadTrades(); vyzvedniNasledky(); loadCards().then(function () { claimCash(); }); }, 60000);
  checkPayment();
  setInterval(function () { tick(); save(); paint(); syncState(); }, 5000);
  // Vlastní, rychlejší tep jen pro naskakující čísla nad prádlomaty.
  setInterval(function () { tick(); dripTick(); }, 1000);
  setInterval(pullRefs, 60000);
  document.addEventListener('visibilitychange', function () {
    // Po návratu do hry se hned podíváme, jestli nám konkurence nevyfoukla místo.
    if (!document.hidden) { tick(); save(); paint(); loadClaims(); loadTrades(); vyzvedniNasledky(); loadCards().then(function () { claimCash(); }); }
    else { syncState(true); }
  });
  window.addEventListener('pagehide', function () { syncState(true); });
}

ev('game_open');
loadMachinePhotos();

countIncomingRef();   // ještě než se rozhodne, jestli je co rozehraného
S = load();
// Přihlášený hráč má přednost: síť ze serveru přebije to, co leží v prohlížeči,
// protože mohl mezitím hrát jinde.
api('/account/me').then(function (r) {
  if (r.ok && r.j.player) {
    ME = r.j.player;
    var srv = r.j.state;
    if (srv && (!S || (srv.lastTick || 0) >= (S.lastTick || 0))) { S = dosypStav(srv) || S; save(); }
    srovnejRef();   // až tady: stav ze serveru může mít staré pid
    if (S) return startGame();
  }
  if (S) startGame();          // rozehraná hra bez účtu (z doby před účty)
}).catch(function () { if (S) startGame(); });

})();
