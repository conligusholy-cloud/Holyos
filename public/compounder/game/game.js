// =============================================================================
// Laundromat Tycoon — herní logika (běží celá v prohlížeči)
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
  max: { src: '/game/max.webp?v=3' }
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
// ─── Poruchy a servis ──────────────────────────────────────────────
// Každý prádlomat se v průměru dvakrát za herní rok porouchá. Hráč na něj musí
// poslat technika — a po mapě mu tam opravdu jede autíčko ze sídla nebo pobočky.
//
// Čas počítáme z opravdových čísel: auto jede 60 km/h a oprava zabere 1 až 5 hodin
// podle závažnosti. Zrychlení obstará herní čas sám — herní hodina je skutečná
// minuta, takže celý výjezd trvá pár minut a je vidět, jak auto jede.
var PORUCHA_ROCNE = 4;                    // kolikrát za herní rok se stroj v průměru porouchá
var HODINA_MS = MONTH_MS / 30 / 24;       // herní hodina = skutečná minuta
var TECHNIK_KMH = 60;                     // průměrná rychlost servisního auta
// Když stojí MINI, stojí celý prádlomat — je v něm jedna pračka a jedna sušička.
// Ve FLEXu a MAXu je strojů víc, takže půlka jede dál. Nájem, servis a splátky
// běží vždycky celé — ty se za odstavený stroj neodpouštějí.
var PORUCHA_CHOD = { mini: 0, flex: 0.5, max: 0.5 };
// Závažnost je rovnou počet hodin opravy. Drobností je v seznamu nejvíc, takže
// většina poruch vyjde na hodinu až tři.
var ZAVADY = [
  { zav: 1, text: 'Zasekl se mincovník' },
  { zav: 1, text: 'Nejde platební terminál' },
  { zav: 1, text: 'Vypadlo osvětlení' },
  { zav: 1, text: 'Ucpaný filtr sušičky' },
  { zav: 1, text: 'Zasekla se dávkovací pumpička' },
  { zav: 2, text: 'Netěsní přívodní hadice' },
  { zav: 2, text: 'Nedovírají dvířka pračky' },
  { zav: 2, text: 'Vypadl jistič sušičky' },
  { zav: 2, text: 'Nejde ohřev vody' },
  { zav: 3, text: 'Vadné vypouštěcí čerpadlo' },
  { zav: 3, text: 'Prasklý řemen bubnu' },
  { zav: 3, text: 'Zavodnila se elektronika' },
  { zav: 4, text: 'Shořel motor sušičky' },
  { zav: 4, text: 'Rozbité ložisko bubnu' },
  { zav: 5, text: 'Vytopená technická místnost' }
];
function jeVPoruse(u) { return !!(u && u.porucha); }
// Kolik z plného provozu stroj zvládá, dokud není spravený.
function chodStroje(u) {
  if (!jeVPoruse(u)) return 1;
  var k = PORUCHA_CHOD[u.eco && u.eco.model];
  return k == null ? 0 : k;
}
function poruchy() { return (S.units || []).filter(jeVPoruse); }
// Jak dlouho stroj stojí. Krátké prostoje v hodinách, delší v herních měsících —
// v nich hráč počítá nájem i splátky.
function dobaProstoje(ms) {
  if (ms >= MONTH_MS) {
    var m = Math.max(1, Math.round(ms / MONTH_MS));
    return m + ' ' + mn(m, 'herní měsíc', 'herní měsíce', 'herních měsíců');
  }
  if (ms >= MONTH_MS / 30) {
    var d = Math.max(1, Math.round(ms / (MONTH_MS / 30)));
    return d + ' ' + mn(d, 'herní den', 'herní dny', 'herních dnů');
  }
  var h = Math.max(1, Math.round(ms / HODINA_MS));
  return h + ' ' + mn(h, 'herní hodinu', 'herní hodiny', 'herních hodin');
}
// Závada přibývá průběžně, ne v pevných intervalech — šance se počítá z toho,
// kolik času uběhlo. Po dlouhé pauze strop hlídá, ať se nerozbije všechno naráz.
// Porucha nepočká, až se hráč vrátí: spadne někam doprostřed doby, co byl pryč,
// a od té chvíle stroj nevydělává. O ten výdělek hráč přijde — vrací se funkce,
// kolik to dělá dohromady, aby se to dalo odečíst z výnosu za celé období.
// Zpětně jdeme nejvýš PORUCHA_ZPETNE_MAX, ať dvoutýdenní pauza nesmaže všechno.
var PORUCHA_ZPETNE_MAX = 6 * MONTH_MS;    // nejvýš půl herního roku zpětně
function hlidejPoruchy(dt) {
  if (!(dt > 0)) return 0;
  var sance = Math.min(0.5, dt / (YEAR_MS / PORUCHA_ROCNE));
  var ted = Date.now(), ztrata = 0;
  (S.units || []).forEach(function (u) {
    if (jeVPoruse(u) || u.technik) return;
    if (Math.random() >= sance) return;
    var z = ZAVADY[Math.floor(Math.random() * ZAVADY.length)];
    var zpet = Math.random() * Math.min(dt, PORUCHA_ZPETNE_MAX);
    u.porucha = { od: ted - zpet, zav: z.zav, text: z.text };
    u.vady = (u.vady || 0) + 1;
    // Co stroj za tu dobu nevydělal: plný obrat bez energie (ta se stojícím
    // strojem nejede), nájem a servis platí hráč tak jako tak.
    var vypadek = Math.round(((u.eco && u.eco.revenue) || 0) * (1 - ENERGY_SHARE)
      * (1 - chodStroje(u)) * (zpet / MONTH_MS));
    ztrata += Math.max(0, vypadek);
    if (zpet > HODINA_MS * 12 && vypadek > 0) {
      toast(u.name + ': ' + z.text.toLowerCase() + '. Stojí ' + dobaProstoje(zpet)
        + ' a přišel jsi o ' + kcFull(vypadek) + '. Pošli tam technika.', 'err');
    } else {
      toast(u.name + ': ' + z.text.toLowerCase() + '. Pošli tam technika.', 'err');
    }
  });
  return ztrata;
}
// ─── Za mořem ────────────────────────────────────────────────────────────────
// Technik nemůže dojet autem všude. Když prádlomat stojí na jiné pevnině, musí
// přes vodu — buď trajektem, nebo, když je to daleko, letadlem s autem na místě.
// Pevninu poznáme z polohy: ostrovy mají svoje obdélníky, zbytek rozhodne
// poledník. Je to hrubé, ale pro hru to stačí a hlavně je to předvídatelné.
var TRAJEKT_REZIE = 6;           // hodiny navíc: čekání v přístavu a plavba
// Trajektem jede technik i s dodávkou, takže po silnici jede stejně rychle
// jako jinde — navíc má jen čas strávený v přístavu a na lodi.
var LETADLO_KMH = 700;
var LETADLO_REZIE = 6;           // na letiště, odbavení a pak auto na místě
var TRAJEKT_MAX_KM = 1500;       // dál už se lodí nejezdí, letí se
var LETADLO_OD_KM = 2000;        // i po souši se přes dva tisíce kilometrů letí
var OSTROVY = [
  { k: 'britanie', lat: [49.5, 61.2], lon: [-11.5, 2.2] },
  { k: 'island', lat: [62.5, 67.5], lon: [-25.5, -12.5] },
  { k: 'gronsko', lat: [59.0, 84.0], lon: [-73.0, -11.0] },
  { k: 'sicilie', lat: [36.5, 38.4], lon: [12.3, 15.7] },
  { k: 'sardinie', lat: [38.8, 43.1], lon: [8.1, 9.9] },
  { k: 'baleary', lat: [38.6, 40.2], lon: [1.1, 4.4] },
  { k: 'malta', lat: [35.7, 36.2], lon: [14.1, 14.6] },
  { k: 'kreta', lat: [34.8, 35.8], lon: [23.4, 26.4] },
  { k: 'kypr', lat: [34.5, 35.8], lon: [32.2, 34.7] },
  { k: 'kanary', lat: [27.5, 29.5], lon: [-18.3, -13.3] },
  { k: 'japonsko', lat: [30.5, 45.8], lon: [128.5, 146.5] },
  { k: 'tchajwan', lat: [21.8, 25.4], lon: [119.9, 122.1] },
  { k: 'filipiny', lat: [4.5, 19.5], lon: [117.0, 127.0] },
  { k: 'indonesie', lat: [-11.0, 2.5], lon: [95.0, 141.0] },
  { k: 'srilanka', lat: [5.8, 10.0], lon: [79.5, 82.0] },
  { k: 'madagaskar', lat: [-26.0, -11.5], lon: [43.0, 51.0] },
  { k: 'kuba', lat: [19.5, 23.4], lon: [-85.2, -73.8] },
  { k: 'hispaniola', lat: [17.4, 20.1], lon: [-78.5, -65.0] },
  { k: 'bahamy', lat: [20.9, 27.3], lon: [-79.0, -72.5] },
  { k: 'antily', lat: [10.0, 18.7], lon: [-64.0, -59.0] },
  { k: 'hawaii', lat: [18.5, 22.5], lon: [-161.0, -154.0] },
  { k: 'australie', lat: [-44.0, -10.0], lon: [112.0, 154.0] },
  { k: 'novyzeland', lat: [-47.5, -34.0], lon: [166.0, 179.5] }
];
// Na které pevnině bod leží. Amerika je jeden celek (Panama), Evropa, Asie
// a Afrika taky — mezi nimi se dá dojet.
function pevnina(b) {
  if (!b || b.lat == null) return '';
  for (var i = 0; i < OSTROVY.length; i++) {
    var o = OSTROVY[i];
    if (b.lat >= o.lat[0] && b.lat <= o.lat[1] && b.lon >= o.lon[0] && b.lon <= o.lon[1]) return o.k;
  }
  if (b.lon <= -34 && b.lon >= -170) return 'amerika';
  return 'afroeurasie';
}
// Čím technik pojede a co ho to stojí navíc. Stejná pevnina znamená auto.
function zpusobCesty(a, b, km) {
  var letadlo = { kod: 'letadlo', nazev: 'letecky', znak: '✈',
    kmh: LETADLO_KMH, rezie: LETADLO_REZIE, silnice: false };
  if (pevnina(a) === pevnina(b)) {
    // Po vlastní ose jen do rozumné dálky. Přes půl kontinentu se letí a auto
    // si technik půjčí na místě — jinak by jediný výjezd trval týden.
    if (km > LETADLO_OD_KM) return letadlo;
    return { kod: 'auto', nazev: 'autem', znak: '🚐', kmh: TECHNIK_KMH, rezie: 0, silnice: true };
  }
  if (km <= TRAJEKT_MAX_KM) {
    return { kod: 'trajekt', nazev: 'trajektem', znak: '⛴', kmh: TECHNIK_KMH, rezie: TRAJEKT_REZIE, silnice: true };
  }
  return letadlo;
}
// Kolik hodin zabere cesta jedním směrem.
function cestaHodin(km, zp) {
  return zp.rezie + Math.max(0.5, km / zp.kmh);
}
// Jeden prádlomat je, dva jsou — ať věta nedrhne.
function zaMoremSlovy(n) {
  return n === 1 ? 'Jeden prádlomat máš' : (n >= 2 && n <= 4 ? n + ' prádlomaty máš' : n + ' prádlomatů máš');
}
// Prádlomaty, ke kterým se technik nedostane autem — od každé základny jen
// přes vodu. Právě u nich se vyplatí pobočka za mořem.
function zaMorem() {
  var zs = zakladny().filter(function (b) { return b && b.lat != null; });
  if (!zs.length) return [];
  return (S.units || []).filter(function (u) {
    if (u.lat == null) return false;
    return !zs.some(function (b) { return pevnina(b) === pevnina(u); });
  });
}
// Věta, která hráči poradí, co s tím. Ukazuje rozdíl v čase, ne jen fakt.
function zaMoremRada(u, v) {
  if (!v || !v.zpusob || v.zpusob.kod === 'auto') return '';
  return '<p class="fine warn" style="margin:8px 0 0">Tenhle prádlomat je za mořem — technik tam '
    + (v.zpusob.kod === 'letadlo' ? 'musí letět' : 'jede trajektem')
    + '. S pobočkou v jeho okolí by výjezd trval '
    + etaText(vyjezdZblizka(u)).replace('za ', '') + ' místo '
    + etaText(v.celkem).replace('za ', '') + '.</p>';
}
// Kolik bude výjezd trvat, než ho hráč potvrdí.
function vyjezdOdhad(u) {
  if (!u || u.lat == null) return null;
  var zs = zakladny().filter(function (b) { return b && b.lat != null; });
  if (!zs.length) return null;
  // Nebereme nejbližší základnu, ale nejrychlejší: pobočka o kus dál na téže
  // pevnině porazí tu, ke které se musí přes moře.
  var nej = null;
  zs.forEach(function (b) {
    var vzduch = kmMezi(b, u);
    var zp = zpusobCesty(b, u, vzduch);
    var km = zp.silnice ? vzduch * SILNICE : vzduch;
    // Půl hodiny má každá cesta i za rohem — technik musí naložit a vyjet.
    // Bez toho by u blízkého stroje autíčko po mapě jen probliklo.
    var jizda = cestaHodin(km, zp) * HODINA_MS;
    if (!nej || jizda < nej.jizda) nej = { zakladna: b, km: km, zp: zp, jizda: jizda };
  });
  var oprava = ((u.porucha && u.porucha.zav) || 1) * HODINA_MS;
  return { zakladna: nej.zakladna, km: nej.km, zpusob: nej.zp, jizda: nej.jizda,
    oprava: oprava, celkem: 2 * nej.jizda + oprava };
}
// Kolik by výjezd trval, kdyby hráč měl základnu přímo u prádlomatu. Z rozdílu
// se počítá doporučení postavit pobočku za mořem.
function vyjezdZblizka(u) {
  var oprava = ((u.porucha && u.porucha.zav) || 1) * HODINA_MS;
  return 2 * 0.5 * HODINA_MS + oprava;
}
function vyslatTechnika(u) {
  if (!u || !jeVPoruse(u) || u.technik) return;
  var v = vyjezdOdhad(u);
  if (!v) { toast('Nemáš základnu, odkud technika poslat.', 'err'); return; }
  var ted = Date.now();
  u.technik = {
    z: { lat: v.zakladna.lat, lon: v.zakladna.lon, name: v.zakladna.name || 'sídlo' },
    km: Math.round(v.km), zpusob: v.zpusob.kod, start: ted, prijezd: ted + v.jizda,
    hotovo: ted + v.jizda + v.oprava, navrat: ted + 2 * v.jizda + v.oprava
  };
  save(); paint(); drawMap(); drawAuta(); syncState(true);
  nactiTrasu(u);
  toast('Technik vyrazil ' + v.zpusob.nazev + ', na místě bude ' + etaText(v.jizda) + '.', 'ok');
}
// Výjezdy posouvá čas: jakmile je oprava hotová, stroj zase jede; až se auto
// vrátí na základnu, zmizí z mapy.
function hlidejServis() {
  var ted = Date.now();
  (S.units || []).forEach(function (u) {
    var t = u.technik;
    if (!t) return;
    if (ted >= t.hotovo && u.porucha) {
      // Kolik času stroj celkem prostál — z toho je pak výpis spolehlivosti.
      u.vadyMs = (u.vadyMs || 0) + Math.max(0, ted - (u.porucha.od || ted));
      delete u.porucha;
      toast(u.name + ' je spravený a zase vydělává.', 'ok');
    }
    if (ted >= t.navrat) delete u.technik;
  });
}
// ─── Trasa po silnici ────────────────────────────────────────────────────────
// Servisní auto nemá jet vzdušnou čarou přes pole a vodu. Trasu spočítá server
// podle skutečných silnic a klient si ji uloží k výjezdu; dokud nedorazí (nebo
// když se nepovede), jede autíčko napřímo jako dřív. Letadlo letí vždy přímo.
function nactiTrasu(u) {
  var t = u && u.technik;
  if (!t || t.trasa || t.zpusob === 'letadlo' || u.lat == null || t.z.lat == null) return;
  if (t.trasaZkusena) return;
  t.trasaZkusena = 1;
  api('/trasa?z=' + t.z.lat.toFixed(5) + ',' + t.z.lon.toFixed(5)
    + '&k=' + u.lat.toFixed(5) + ',' + u.lon.toFixed(5)).then(function (r) {
      if (!r.ok || !r.j || !r.j.ok || !Array.isArray(r.j.body) || r.j.body.length < 2) return;
      // Mezitím se mohl výjezd ukončit nebo začít jiný — pak už trasa nepatří k němu.
      if (!u.technik || u.technik.start !== t.start) return;
      u.technik.trasa = r.j.body;
      if (r.j.km) u.technik.km = r.j.km;
      save(); drawMap(); drawAuta();
    }).catch(function () { /* bez trasy se jede napřímo */ });
}
// Kolik kilometrů je na trasu po jednotlivých bodech — podle toho se auto
// posouvá rovnoměrně, ne po úsecích stejně dlouhých v čase.
function trasaDelky(tr) {
  var d = [0], c = 0;
  for (var i = 1; i < tr.length; i++) {
    c += kmMezi({ lat: tr[i - 1][0], lon: tr[i - 1][1] }, { lat: tr[i][0], lon: tr[i][1] });
    d.push(c);
  }
  return d;
}
// Bod na trase v daném podílu ujeté vzdálenosti (0 = start, 1 = cíl).
function trasaBod(tr, f) {
  if (!tr || tr.length < 2) return null;
  var d = trasaDelky(tr), celk = d[d.length - 1];
  if (!(celk > 0)) return { lat: tr[0][0], lon: tr[0][1] };
  var cil = Math.max(0, Math.min(1, f)) * celk;
  for (var i = 1; i < d.length; i++) {
    if (d[i] >= cil) {
      var k = (cil - d[i - 1]) / Math.max(1e-9, d[i] - d[i - 1]);
      return mezibod({ lat: tr[i - 1][0], lon: tr[i - 1][1] }, { lat: tr[i][0], lon: tr[i][1] }, k);
    }
  }
  return { lat: tr[tr.length - 1][0], lon: tr[tr.length - 1][1] };
}
// Bod mezi dvěma místy — odtud se bere poloha autíčka na mapě.
function mezibod(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}
// Kde je teď servisní auto: na cestě tam, u stroje, nebo na cestě zpátky.
function autoPoloha(u) {
  var t = u && u.technik;
  if (!t || u.lat == null || t.z.lat == null) return null;
  var ted = Date.now(), a = t.z, b = { lat: u.lat, lon: u.lon };
  if (ted < t.prijezd) {
    var f = t.prijezd > t.start ? (ted - t.start) / (t.prijezd - t.start) : 1;
    return (t.trasa && trasaBod(t.trasa, f)) || mezibod(a, b, f);
  }
  if (ted < t.hotovo) return { lat: b.lat, lon: b.lon, opravuje: true };
  if (ted < t.navrat) {
    var g = t.navrat > t.hotovo ? (ted - t.hotovo) / (t.navrat - t.hotovo) : 1;
    return (t.trasa && trasaBod(t.trasa, 1 - g)) || mezibod(b, a, g);
  }
  return null;
}
function connPrice(sp, modelKey) {
  // Pronajatý pozemek s připravenou plochou: přípojky zaplatil majitel, nájemce
  // platí jen vyšší nájem. Na holé parcele si je vybuduje sám.
  var naj = (S.leases && S.leases[sp.id]) || null;
  if (naj && naj.pronajem && naj.sit) return 0;
  // Na pozemku platí hráč přesně to, co si navrhl — ne paušál.
  var plan = planMista(sp.id);
  // Na pozemku platí hráč přesně to, co si navrhl — a když má přípravu
  // zaplacenou dopředu, při stavbě už neplatí za plochu nic.
  if (plan && plan.hotovo) return plan.zaplaceno ? 0 : (plan.cena || 0);
  var base = CONN_MIN + spotHash(sp.id, 'c') * (CONN_MAX - CONN_MIN);
  if (modelKey === 'max') base *= CONN_MAX_MULT;
  // Dokud plán není, ukazujeme hrubý odhad přípravy zelené louky.
  if (jePozemek(sp) && !jeZasitovane(sp)) base *= POZEMEK_STAVBA;
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
  // Rámec se přepočítá se stejným dechem jako dluh — splátka ho hned uvolní.
  if (S.ramec) ramecCerpano();
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
// Mimořádná splátka jednoho konkrétního úvěru — hráč si vybírá sám, protože
// nejdražší úvěr nemusí být ten, kterého se chce zbavit. Splátka zůstává
// stejně vysoká a úvěr skončí dřív — tak ušetří nejvíc na úrocích.
function splatitUver(id, castka) {
  var l = (S.loans || []).filter(function (x) { return x.id === id; })[0];
  if (!l) return 0;
  var dam = Math.min(Math.max(0, Math.round(castka || 0)), Math.round(l.zbyva), Math.floor(S.cash));
  if (!(dam > 0)) return 0;
  S.cash -= dam;
  zapis('splatka', 'Mimořádná splátka — ' + (l.popis || 'úvěr'), -dam);
  l.zbyva = Math.max(0, l.zbyva - dam);
  S.bank = Math.min(bankCap(), S.bank + dam);   // splácením se uvolňuje rámec
  if (l.zbyva < 1) {
    l.zbyva = 0;
    zapisDoplacene(l);
    S.stats.splaceno = (S.stats.splaceno || 0) + 1;
    S.loans = S.loans.filter(function (x) { return x.zbyva > 0; });
  }
  prepocitejDluh();
  return dam;
}

// ─── Změna délky splácení běžícího úvěru ─────────────────────────
// Delší splatnost srazí splátku, ale zaplatí se víc na úrocích — a banka ji
// nedá každému; rozhoduje táž historie jako u nového úvěru. Kratší splatnost
// splátku zvedne, ale úvěr je dřív z krku a stojí méně — tu banka dá vždycky,
// pro ni je to jistota navíc, a ještě srazí přirážku.
var PRODLOUZENI_POPLATEK = 0.005;   // za přepsání smlouvy, z nesplacené jistiny
// Na kterém stupni žebříčku splatností úvěr teď stojí.
function splatnostIdx(l) {
  var m = (l && l.mesicu) || UVER_MESICU;
  for (var i = SPLATNOSTI.length - 1; i >= 0; i--) if (SPLATNOSTI[i].mesicu <= m) return i;
  return 0;
}
// Jak by úvěr vypadal po přepsání na jinou délku splácení.
function zmenaNavrh(l, i) {
  var ted = splatnostIdx(l);
  var nova = SPLATNOSTI[i], stara = SPLATNOSTI[ted];
  var nalada = naladaDnes();
  var delsi = i > ted;
  // Rozdíl přirážky za splatnost. U delší do toho mluví i nálada rizikoře,
  // u kratší ne — to je pro banku jen dobře, nemá proč přitvrzovat.
  var sazba = Math.max(0.02, l.sazba + (nova.prirazka - stara.prirazka) + (delsi ? nalada.sazba : 0));
  var splatka = anuita(l.zbyva, sazba, nova.mesicu);
  var splatkaTed = Math.min(l.splatka, l.zbyva);
  var urokTed = Math.max(0, splatkaTed * (l.zbyvaMesicu || 0) - l.zbyva);
  var urokPak = Math.max(0, splatka * nova.mesicu - l.zbyva);
  return { i: i, delsi: delsi, mesicu: nova.mesicu, nazev: nova.nazev, sazba: sazba, splatka: splatka,
    poplatek: Math.round(l.zbyva * PRODLOUZENI_POPLATEK), nalada: nalada,
    rozdilSplatky: Math.round(splatka - splatkaTed),
    rozdilUroku: Math.round(urokPak - urokTed),
    urokTed: Math.round(urokTed), urokPak: Math.round(urokPak) };
}
// Stupně, na které jde úvěr dnes přepsat. Kratší vždycky, delší podle historie.
function splatnostiLze(l) {
  var ted = splatnostIdx(l), strop = maxSplatnost(), out = [];
  for (var i = 0; i < SPLATNOSTI.length; i++) {
    if (i === ted) continue;
    if (i < ted || i <= strop) out.push(i);
  }
  return out;
}
function zmenitSplatnost(id, i) {
  var l = (S.loans || []).filter(function (x) { return x.id === id; })[0];
  if (!l) return null;
  var n = zmenaNavrh(l, i);
  if (S.cash < n.poplatek) return null;
  S.cash -= n.poplatek;
  zapis('poplatek', 'Změna splatnosti — ' + (l.popis || 'úvěr'), -n.poplatek);
  l.sazba = n.sazba;
  l.mesicu = n.mesicu;
  l.zbyvaMesicu = n.mesicu;
  l.splatka = n.splatka;
  l.prepsano = (l.prepsano || 0) + 1;
  prepocitejDluh();
  return n;
}

// Za jak dlouho se strže další splátka. Hráč to musí vidět — jinak neví,
// do kdy má mít hotovost na účtu.
function dalsiSplatkaZa() {
  return Math.max(0, (S.splatkyAt || Date.now()) + MONTH_MS - Date.now());
}
// Řádek „další splátka“ i s tím, jestli na ni hráč má. Červeně, když nemá.
function dalsiSplatkaHtml() {
  var kolik = splatkyMesicne();
  if (!(kolik > 0)) return '';
  var ma = S.cash >= kolik;
  return '<div class="kv"><span>Další splátka</span><b class="' + (ma ? 'ok' : 'err') + '">'
    + etaText(dalsiSplatkaZa()) + '</b></div>'
    + '<p class="fine' + (ma ? '' : ' err') + '">' + (ma
        ? 'Do té doby musí být na účtu ' + kcFull(kolik) + '. Máš ' + kcFull(S.cash) + ', takže klid.'
        : 'Do té doby musí být na účtu ' + kcFull(kolik) + ', a máš jen ' + kcFull(S.cash)
          + '. Chybí ' + kcFull(kolik - S.cash) + ' — co nezaplatíš, přičte se k dluhu a počítá se jako nezaplacená splátka.')
    + '</p>';
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
    knihaProvoz(-dal, 'splatka');
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
// Doplacené místo = stojící prádlomat, na kterém nevisí žádný nesplacený úvěr.
// Počítá se z toho, co hráč má teď, ne z historie: započítá se i prádlomat
// koupený za hotové (na tom taky nic nedluží) a místo financované dvěma úvěry
// — na stroj a na přípojky — se počítá jednou, ne dvakrát. Když doplacené
// místo prodá, ubude; rámec je živé číslo, ne medaile za minulost.
function doplacenychMist() {
  var dluzi = {};
  (S.loans || []).forEach(function (l) { if (l.spotId && l.zbyva > 0) dluzi[l.spotId] = 1; });
  var videno = {};
  var n = 0;
  (S.units || []).forEach(function (u) {
    if (!u.spotId || dluzi[u.spotId] || videno[u.spotId]) return;
    videno[u.spotId] = 1; n++;
  });
  return n;
}
function maRamec() { return !!(S.ramec && S.ramec.limit > 0 && !S.ramec.zavreny); }
function ramecLze() { return !maSkraloup() && doplacenychMist() >= 2; }
// Doplacený prádlomat — na tom stojí cesta k rámcovému úvěru.
// Jen do statistik — kolik úvěrů na místa už hráč dotáhl do konce. Rámec se
// podle toho neřídí, ten se dívá na dnešek (viz doplacenychMist).
function zapisDoplacene(l) {
  if (l && l.spotId) S.stats.splacenoMist = (S.stats.splacenoMist || 0) + 1;
}
// Kolik z rámce je právě vyčerpáno. Rámec je revolvingový: co z něj hráč
// splatí, může čerpat znovu. Počítá se ze zůstatků úvěrů, které z rámce
// vznikly, ne z načítaného čísla — jinak by se to po splátkách rozešlo a
// u vyčerpaného rámce by napořád svítilo „k čerpání 0".
function ramecCerpano() {
  var c = (S.loans || []).reduce(function (a, l) {
    return a + (l && l.druh === 'ramec' ? Math.max(0, Math.round(l.zbyva || 0)) : 0);
  }, 0);
  if (S.ramec) S.ramec.cerpano = c;
  return c;
}
// Kolik z rámce zbývá k čerpání — vždy ještě omezené tím, co firma unese.
function ramecVolny() {
  if (!maRamec() || S.ramec.slabyOd) return 0;
  var zbyva = Math.max(0, S.ramec.limit - ramecCerpano());
  return Math.min(zbyva, stropPodleZisku(monthlyProfit() - splatkyMesicne(), zbyva));
}
// Základní limit podle historie a výdělku.
function ramecNavrh() {
  var podleHistorie = RAMEC_ZA_MISTO * Math.max(1, doplacenychMist() - 1);
  return Math.max(0, Math.round(Math.min(podleHistorie,
    stropPodleZisku(monthlyProfit() - splatkyMesicne(), podleHistorie)) / 10000) * 10000);
}
// ─── Přehodnocení rámce ──────────────────────────────────────────────────────
// Rámec není jednou provždy. Banka ho jednou za herní měsíc srovná s tím, jak
// si firma vede: doplacené prádlomaty ho zvedají, ztracený zisk nebo narostlé
// splátky ho srážejí. Nikdy ale ne pod to, co už je načerpané — na vrácení
// peněz, které hráč dostal, nikdo tlačit nebude. Stejně tak se dá o
// přehodnocení říct kdykoli ručně.
var RAMEC_KROK = 50000;           // menší pohyb než tenhle neřešíme
var RAMEC_PAD_MAX = 0.25;         // naráz banka nesebere víc než čtvrtinu limitu
// Z čeho se limit skládá: historie (doplacená místa) a co firma unese.
function ramecSlozky() {
  var podleHistorie = RAMEC_ZA_MISTO * Math.max(1, doplacenychMist() - 1);
  var podleZisku = Math.max(0, Math.round(stropPodleZisku(monthlyProfit() - splatkyMesicne(), podleHistorie)));
  return { historie: podleHistorie, zisk: podleZisku,
    cil: Math.round(Math.min(podleHistorie, podleZisku) / 10000) * 10000 };
}
// rovnou = limit jde na cíl bez brzdy. Používá se, když hráč sám prodal nebo
// přišel o prádlomat — tam není co změkčovat, změnu si způsobil vědomě.
function prehodnotRamec(rucne, rovnou) {
  if (!maRamec()) return null;
  var sl = ramecSlozky();
  var cerp = ramecCerpano();
  var stary = Math.round(S.ramec.limit || 0);
  // Hodnocení z pohovoru si rámec nese dál — kdo u rizikoře uspěl, má výhodu
  // i při přehodnocení.
  var koef = stary > 0 && S.ramec.puvodniCil ? stary / S.ramec.puvodniCil : 1;
  var cil = Math.round(sl.cil * Math.max(0.5, Math.min(1.5, koef)) / 10000) * 10000;
  // Dolů jen pomalu a nikdy pod načerpané.
  var dolniMez = rovnou ? cerp : Math.max(cerp, Math.round(stary * (1 - RAMEC_PAD_MAX)));
  var novy = cil >= stary ? cil : Math.max(dolniMez, cil);
  novy = Math.round(novy / 10000) * 10000;
  if (novy < cerp) novy = Math.ceil(cerp / 10000) * 10000;
  S.ramec.prehodnoceno = Date.now();
  S.ramec.puvodniCil = S.ramec.puvodniCil || sl.cil || stary;
  // Když si o přehodnocení řekne hráč sám, banka limit nesníží — to si nechá
  // na pravidelnou revizi jednou za herní měsíc. Jinak by se nikdo neptal.
  if (rucne && novy < stary) {
    save();
    toast('Na víc to teď není. ' + (sl.zisk < sl.historie
      ? 'Limit drží výdělek sítě — zvedni zisk nebo sniž splátky.'
      : 'Limit drží historie — doplať další prádlomat.'), 'err');
    return { zmena: 0, limit: stary };
  }
  if (Math.abs(novy - stary) < RAMEC_KROK) {
    if (rucne) toast('Banka limit přepočítala a nechala ho beze změny.', 'ok');
    save();
    return { zmena: 0, limit: stary };
  }
  S.ramec.limit = novy;
  save();
  if (novy > stary) {
    toast('Banka ti zvedla rámec na ' + kcFull(novy) + ' (+' + kcFull(novy - stary) + ').', 'ok');
  } else {
    toast('Banka snížila rámec na ' + kcFull(novy) + '. Načerpané peníze ti nebere, '
      + 'jen z rámce ubylo volné místo.', 'err');
  }
  return { zmena: novy - stary, limit: novy };
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
  { mesicu: 24, nazev: '2 roky', prirazka: -0.008 },
  { mesicu: 36, nazev: '3 roky', prirazka: -0.005 },
  { mesicu: 60, nazev: '5 let', prirazka: 0 },
  { mesicu: 84, nazev: '7 let', prirazka: 0.004 },
  { mesicu: 120, nazev: '10 let', prirazka: 0.009 }
];
// Nový úvěr začíná na pěti letech. Kratší stupně jsou až pro přepsání
// běžícího úvěru — kdo ho chce mít z krku dřív, zaplatí víc měsíčně,
// ale méně na úrocích. Banka proti tomu nic nemá, takže to nepodmíňuje.
var SPL_ZAKLAD = 2;
function maxSplatnost() {
  var splacenych = (S.stats && S.stats.splaceno) || 0;
  var stupen = splacenych >= 2 ? 2 : splacenych >= 1 ? 1 : 0;
  stupen += naladaDnes().splatnost;
  return Math.max(SPL_ZAKLAD, Math.min(SPLATNOSTI.length - 1, SPL_ZAKLAD + stupen));
}
// Proč delší splatnost nedostane — vždycky i s tím, za co by to bylo ano.
function splatnostDuvod(i) {
  var splacenych = (S.stats && S.stats.splaceno) || 0;
  if (naladaDnes().id === 'audit') return 'Dneska je rizikoř po auditu a drží se základní splatnosti. Zkus to zítra.';
  if (splacenych === 0) return 'Nemáš za sebou jediný splacený úvěr, takže banka nemá podle čeho soudit. Splať první úvěr a vrať se.';
  if (splacenych === 1 && i >= SPL_ZAKLAD + 2) return 'S jedním splaceným úvěrem ti banka dá nejvýš sedm let. Na deset se vrať, až budeš mít dva.';
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
// Splátka, která na tom místě visí. Místo bez úvěru nesplaci nic.
function splatkaMista(u) {
  var l = uverMista(u);
  if (!l) return 0;
  return Math.min(l.splatka, l.zbyva + l.zbyva * l.sazba / 12);
}
// Co z místa zbyde, když se zaplatí jeho vlastní úvěr.
function zbydeZMista(u) { return Math.round(u.eco.profit - splatkaMista(u)); }
// Kolik času od postavení stroj šlapal bez poruchy. Právě probíhající porucha
// se počítá taky — jinak by číslo stálo, dokud hráč nepošle technika.
function spolehlivost(u) {
  var zije = Date.now() - (u.builtAt || Date.now());
  if (!(zije > 0)) return 1;
  var mimo = (u.vadyMs || 0) + (u.porucha ? Date.now() - (u.porucha.od || Date.now()) : 0);
  return Math.max(0, Math.min(1, 1 - mimo / zije));
}
function uverMista(u) {
  if (!u || !S.loans) return null;
  return S.loans.filter(function (l) { return l.spotId && l.spotId === u.spotId; })[0] || null;
}
// Kolik na tomhle místě každý měsíc ukousne banka dohromady. Úvěrů může být
// víc — jeden na stroj, druhý na přípojky. (splatkaMista(u) výš počítá jen
// ten první; tahle je součet za celé místo.)
function splatkyMista(spotId) {
  if (!spotId || !S.loans) return 0;
  return Math.round(S.loans.filter(function (l) { return l.spotId === spotId; })
    .reduce(function (a, l) { return a + Math.min(l.splatka, l.zbyva + l.zbyva * l.sazba / 12); }, 0));
}
// Když o místo přijdeme — výpovědí, přeplacením nebo vlastním odchodem — úvěry
// na něj nezmizí. Banka chce svoje dál, i když stroj mezitím leží na skladě a
// nevydělává; jen přestanou patřit ke konkrétnímu místu.
function osirelyUver(spotId) {
  var splatka = splatkyMista(spotId);
  (S.loans || []).forEach(function (l) {
    if (l.spotId !== spotId) return;
    l.spotId = null;
    if (String(l.popis || '').indexOf('místo zrušeno') < 0) l.popis = (l.popis || 'Úvěr') + ' (místo zrušeno)';
  });
  return splatka;
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
// Pověst z infolinky násobí výsledek až na konci — ať platí celý rozsah
// i tomu, kdo už má návštěvnost na stropu.
function traffic() {
  var t = Math.min(trafficMax(),
    TRAFFIC_BASE + (S && S.refs ? S.refs : 0) * TRAFFIC_PER_REF + (S && S.boost ? S.boost : 0));
  return t * povestKoef();
}
// Servis, praní a úklid se platí z obratu - cim vic lidi pere, tim vic prace.
function economics(spot, modelKey, podil) {
  var m = MODELS[modelKey] || MODELS.flex;
  // Druhý a třetí prádlomat na stejném pozemku si zákazníky nepřivede — dělí se
  // o ty, co tam chodí tak jako tak. Proto bere menší podíl.
  var perday = m.perday * placeFactor(spot.score) * traffic() * (podil == null ? 1 : podil);
  var revenue = Math.round(perday * 30.5 * m.spend * EUR);
  var energy = Math.round(revenue * ENERGY_SHARE);
  var servis = Math.round(revenue * SERVIS_SHARE);
  // Co je domluvené, to se platí: vyjednaný nájem i nájem za cizí pozemek.
  // Na vlastní zemi se neplatí nic.
  var sml = (S.leases && S.leases[spot.id]) || null;
  var rent = sml ? Math.round(sml.rent || 0) : (jePozemek(spot) ? 0 : rentOf(spot));
  var cost = energy + servis + rent;
  var profit = revenue - cost;
  var conn = connPrice(spot, m.key);
  var inv = machinePrice(m) + conn;
  return { model: m.key, invest: inv, machine: machinePrice(m), install: conn, conn: conn,
    podil: podil == null ? 1 : podil,
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
var HRA_NAZEV = 'Laundromat Tycoon';
var KEY = 'lm_milionar_v1';
var PID_KEY = 'lm_milionar_pid';
// Jestli má mapa ukazovat jen vlastní síť. Je to věc pohledu, ne rozehrané hry,
// takže to držíme bokem od stavu — jen v tomhle prohlížeči.
var MAPA_KEY = 'lm_milionar_mapa_moje';
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
    profilVybran: 0,  // dotazník na profil přijde až po prvním prádlomatu
    pid: trvalePid(),
    refs: 0,       // kolik lidí otevřelo sdílený odkaz
    orders: [],    // koupené stroje na cestě: { model, arrivesAt }
    stock: {},     // model → kolik kusů čeká na skladě
    boost: 0,         // trvalé zvýšení návštěvnosti z karet
    connDiscount: 0,  // sleva na přípojky na nejbližší stavbě
    rateDrop: 0,      // snížení úroku z karty
    bankBonus: 0,     // navýšení bankovního rámce z karty
    povest: 0,        // jak si hráč vede na infolince, −100 až +100
    hovoru: 0,        // kolik hovorů už má za sebou — bez nich se do žebříčku nepočítá
    hovorZa: null,    // za jak dlouho strávených ve hře zazvoní další hovor
    hovoryPosl: [],   // rozhovory, které už padly — ať se hned neopakují
    stats: { earned: 0, interest: 0 },
    hist: []          // vývoj po herních měsících — tržby, zisk, dluh, počet prádlomatů
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
    if (typeof o.povest !== 'number') o.povest = 0;
    if (typeof o.hovoru !== 'number') o.hovoru = 0;
    if (!Array.isArray(o.hovoryPosl)) o.hovoryPosl = [];
    delete o.otazkyPosl;   // dřív se pamatovaly jednotlivé otázky, teď celé rozhovory
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
    // Druhý a třetí stroj na jednom pozemku má menší podíl na zákaznících —
    // drží se u stroje, aby se přepočtem návštěvnosti neztratil.
    var perday = m.perday * placeFactor(u.score) * traffic() * (u.eco.podil == null ? 1 : u.eco.podil);
    var plne = Math.round(perday * 30.5 * m.spend * EUR);
    // Porouchaný stroj nevydělává (nebo jen půlku), ale servis a nájem běží dál.
    // Z výjezdů technika se platí právě ten servisní poplatek, takže ten
    // počítáme pořád z plného obratu. Energie jde dolů s tím, co opravdu běží.
    var chod = chodStroje(u);
    var revenue = Math.round(plne * chod);
    u.eco.chod = chod;
    u.eco.perday = Math.round(perday * chod * 10) / 10;
    u.eco.revenue = revenue;
    u.eco.energy = Math.round(revenue * ENERGY_SHARE);
    u.eco.servis = Math.round(plne * SERVIS_SHARE);
    u.eco.cost = u.eco.energy + u.eco.servis + u.eco.rent;
    u.eco.profit = revenue - u.eco.cost;
    // Zisk, kdyby stroj jel naplno. Podle něj počítáme návratnost a co už místo
    // vydělalo — jinak by týdenní porucha přepisovala celá léta provozu.
    u.eco.ziskPlny = plne - (Math.round(plne * ENERGY_SHARE) + u.eco.servis + u.eco.rent);
    u.eco.payback = u.eco.ziskPlny > 0 ? u.eco.invest / (u.eco.ziskPlny * 12) : null;
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

// ─── Vývoj v čase ───────────────────────────────────────────────────────
// Za každý herní měsíc jeden řádek: tržby, zisk, co se platí, dluh a počet
// prádlomatů. Pár čísel, ale je z toho vidět celá cesta od začátku.
var HIST_MAX = 300;      // víc bodů už se jen prořídí, ať stav nenaroste do nebes
function histMesic() { return Math.floor((Date.now() - S.startedAt) / MONTH_MS); }
function histZaznam(m) {
  return {
    m: m,
    t: Math.round(S.units.reduce(function (a, u) { return a + ((u.eco && u.eco.revenue) || 0); }, 0)),
    z: Math.round(monthlyProfit()),
    s: Math.round(splatkyMesicne()),                        // splátky bance
    o: Math.round(pobockyMesicne() + cetaMesicne()),        // pobočky a četa
    d: Math.round(S.loan),
    p: S.units.length,
    h: Math.round(S.cash)
  };
}
// Běžící měsíc se přepisuje, hotové zůstávají. Poslední bod grafu je tím vždy
// „ted“ a nemusí se čekat půl dne, než se něco pohne.
function zapisHistorii() {
  // Kdo hrál dřív, než se vývoj začal zapisovat, dostane ho dopočítaný. Dělá se
  // to až tady, v tick(), protože tou dobou už má každé místo spočtenou ekonomiku.
  if (!Array.isArray(S.hist)) S.hist = dopocitejHistorii(S);
  var m = histMesic();
  if (!(m >= 0)) return;
  var z = histZaznam(m);
  var posl = S.hist[S.hist.length - 1];
  if (posl && posl.m === m) { S.hist[S.hist.length - 1] = z; return; }
  // Po pauze chybí měsíce mezi tím — doplníme je tím, v jakém stavu hra zůstala.
  if (posl) for (var k = Math.max(posl.m + 1, m - 60); k < m; k++) {
    S.hist.push({ m: k, t: posl.t, z: posl.z, s: posl.s, o: posl.o, d: posl.d, p: posl.p, h: posl.h });
  }
  S.hist.push(z);
  // Když už je bodů moc, nezahazujeme začátek — starší polovinu jen prořídíme
  // na každý druhý měsíc. Graf si tím nechá celý rozsah od prvního dne.
  if (S.hist.length > HIST_MAX) {
    var pul = Math.floor(S.hist.length / 2), nove = [];
    for (var j = 0; j < pul; j += 2) nove.push(S.hist[j]);
    S.hist = nove.concat(S.hist.slice(pul));
  }
}
// ─── Účetní kniha ────────────────────────────────────────────────────────────
// Každý pohyb peněz má svůj řádek: kdy, za co, kolik a kolik po tom zbylo.
// Jednorázové věci (nákup stroje, přípojky, pobočka, úvěr, provize) se zapisují
// hned. Provoz a splátky bance tečou průběžně, ty se sčítají za herní měsíc a
// zapíšou jedním řádkem — jinak by v knize byly tisíce drobných přírůstků.
var KNIHA_MAX = 600;              // starší řádky se zahazují, ať stav hry nenabobtná
var KNIHA_DRUH = {
  nakup: { nazev: 'Nákupy a stavba', kat: 'nakup' },
  pruzkum: { nazev: 'Průzkum', kat: 'provoz' },
  poplatek: { nazev: 'Poplatky', kat: 'provoz' },
  provoz: { nazev: 'Provoz sítě', kat: 'provoz' },
  uver: { nazev: 'Z banky', kat: 'banka' },
  splatka: { nazev: 'Splátky', kat: 'banka' },
  prijem: { nazev: 'Příjmy', kat: 'prijem' }
};
function knihaKat(d) { return (KNIHA_DRUH[d] || KNIHA_DRUH.prijem).kat; }
// Zapíše jeden pohyb. Volá se až PO změně hotovosti, aby seděl zůstatek.
// u = kolik z toho zaplatila banka (u nákupu na úvěr), jen pro informaci.
function zapis(d, p, c, u, vzniklo) {
  if (!S) return;
  c = Math.round(c || 0);
  if (!c) return;
  if (!Array.isArray(S.kniha)) S.kniha = [];
  var r = { t: Date.now(), d: d, p: String(p || ''), c: c, z: Math.round(S.cash) };
  if (u) r.u = Math.round(u);
  // Doručenka mohla čekat, než si ji hráč vyzvedl — pak je vedle data připsání
  // i den, kdy provize vznikla. Jinak to vypadá, že přišly dvě naráz za jeden stroj.
  var v = vzniklo ? new Date(vzniklo).getTime() : 0;
  if (v && Date.now() - v > 600000) r.v = v;
  S.kniha.push(r);
  if (S.kniha.length > KNIHA_MAX) S.kniha = S.kniha.slice(-KNIHA_MAX);
}
// Průběžné toky se sčítají za měsíc. Jakmile se měsíc přehoupne, uzavřou se.
function knihaProvoz(castka, druh) {
  if (!S || !castka) return;
  var m = histMesic();
  if (!(m >= 0)) return;
  if (!S.knihaMes || S.knihaMes.m !== m) { knihaUzavri(); S.knihaMes = { m: m, provoz: 0, splatky: 0 }; }
  if (druh === 'splatka') S.knihaMes.splatky += castka;
  else S.knihaMes.provoz += castka;
}
// Uzavře rozepsaný měsíc do dvou řádků: co síť vydělala a co sebrala banka.
function knihaUzavri() {
  var b = S.knihaMes;
  if (!b) return;
  S.knihaMes = null;
  if (Math.round(b.provoz)) zapis('provoz', 'Provoz sítě za měsíc', b.provoz);
  if (Math.round(b.splatky)) zapis('splatka', 'Splátky úvěrů za měsíc', b.splatky);
}
// Kdo hrál dřív, než se kniha začala vést, dostane začátek dopočítaný z toho,
// co ve hře stojí. U těchhle řádků neznáme zůstatek ani rozdělení na hotovost
// a úvěr, proto jsou označené jako dopočítané.
function dopocitejKnihu(o) {
  var k = [], p = PROFILES[o.profile];
  if (p) k.push({ t: o.startedAt, d: 'prijem', p: 'Startovní kapitál', c: Math.round(p.cash), r: 1 });
  (o.units || []).forEach(function (u) {
    var m = MODELS[u.eco && u.eco.model];
    k.push({ t: u.builtAt || o.startedAt, d: 'nakup', r: 1,
      p: 'Prádlomat ' + (u.name || 'místo') + (m ? ' (' + m.name + ')' : ''),
      c: -Math.round((u.eco && u.eco.invest) || 0) });
  });
  (o.pobocky || []).forEach(function (b) {
    k.push({ t: b.od || o.startedAt, d: 'nakup', p: 'Pobočka ' + (b.name || ''), c: -POBOCKA_CENA, r: 1 });
  });
  if (o.ceta) k.push({ t: o.ceta.od || o.startedAt, d: 'nakup', p: 'Stavební technika', c: -CETA_CENA, r: 1 });
  k.sort(function (a, b) { return a.t - b.t; });
  return k;
}
function knihaZaloz() {
  if (!S) return;
  if (!Array.isArray(S.kniha)) {
    S.kniha = dopocitejKnihu(S);
    S.knihaOd = Date.now();
  }
}
// Herní měsíc, do kterého řádek patří — podle toho se kniha dělí na období.
function knihaMesic(t) {
  return Math.max(0, Math.floor(((t || 0) - (S.startedAt || 0)) / MONTH_MS));
}
function mesicNazev(m) {
  return 'Rok ' + (Math.floor(m / 12) + 1) + ' · měsíc ' + (m % 12 + 1);
}
function knihaRadek(r) {
  var kl = r.c > 0 ? 'ok' : 'err';
  return '<div class="kn-radek"><i class="kn-tecka ' + knihaKat(r.d) + '"></i>'
    + '<span><b>' + esc(r.p) + '</b><i>' + datumCas(r.t)
    + (r.u ? ' · z toho úvěr ' + kcFull(r.u) : '')
    + (r.v ? ' · vzniklo ' + datumCas(r.v) : '')
    + (r.r ? ' · dopočítáno' : (r.z != null ? ' · zůstatek ' + kcFull(r.z) : '')) + '</i></span>'
    + '<b class="' + kl + '">' + (r.c > 0 ? '+' : '−') + kcFull(Math.abs(r.c)) + '</b></div>';
}
var KNIHA_FILTR = 'vse';
var KNIHA_FILTRY = [
  { k: 'vse', n: 'Vše' }, { k: 'nakup', n: 'Nákupy' }, { k: 'provoz', n: 'Provoz' },
  { k: 'banka', n: 'Banka' }, { k: 'prijem', n: 'Příjmy' }
];
function knihaSheet() {
  knihaZaloz();
  knihaSrovnej();
  // Doběhne na pozadí; když něco doplní, kniha se překreslí sama.
  doplnVznikProvizi(function (zmena) {
    if (zmena && $('sheet') && !$('sheet').classList.contains('hidden')) knihaSheet();
  });
  var vse = (S.kniha || []).slice().sort(function (a, b) { return b.t - a.t; });
  var list = KNIHA_FILTR === 'vse' ? vse
    : vse.filter(function (r) { return knihaKat(r.d) === KNIHA_FILTR; });
  var prijmy = 0, vydaje = 0;
  vse.forEach(function (r) { if (r.c > 0) prijmy += r.c; else vydaje -= r.c; });
  // Rozepsaný měsíc ukážeme zvlášť, aby bylo vidět, co se zrovna sbírá.
  var b = S.knihaMes, bezi = '';
  if (b && (Math.round(b.provoz) || Math.round(b.splatky))) {
    bezi = '<div class="kn-bezi"><b>Rozepsaný měsíc</b>'
      + '<span>Provoz <i class="' + (b.provoz >= 0 ? 'ok' : 'err') + '">'
      + (b.provoz >= 0 ? '+' : '−') + kcFull(Math.abs(Math.round(b.provoz))) + '</i></span>'
      + (Math.round(b.splatky) ? '<span>Splátky <i class="err">−'
          + kcFull(Math.abs(Math.round(b.splatky))) + '</i></span>' : '') + '</div>';
  }
  var mesic = -1, html = '';
  list.forEach(function (r) {
    var m = knihaMesic(r.t);
    if (m !== mesic) {
      mesic = m;
      var cist = list.filter(function (x) { return knihaMesic(x.t) === m; })
        .reduce(function (a, x) { return a + x.c; }, 0);
      html += '<div class="kn-mesic"><span>' + mesicNazev(m) + '</span>'
        + '<b class="' + (cist >= 0 ? 'ok' : 'err') + '">' + (cist >= 0 ? '+' : '−')
        + kcFull(Math.abs(cist)) + '</b></div>';
    }
    html += knihaRadek(r);
  });
  sheet('<h3>Účetní kniha</h3>'
    + '<p class="muted small">Každý pohyb peněz od začátku hry. Provoz sítě a splátky '
    + 'bance se sčítají za herní měsíc, všechno ostatní má svůj řádek.</p>'
    + '<div class="sum-grid" style="margin:12px 0">'
    + '<div><span>Příjmy</span><b class="ok">' + kc(prijmy) + ' ' + CUR + '</b></div>'
    + '<div><span>Výdaje</span><b class="err">' + kc(vydaje) + ' ' + CUR + '</b></div>'
    + '<div><span>Hotovost</span><b>' + kc(S.cash) + ' ' + CUR + '</b></div>'
    + '</div>'
    + bezi
    + '<div class="seg kn-filtr">' + KNIHA_FILTRY.map(function (f) {
        return '<button class="' + (f.k === KNIHA_FILTR ? 'on' : '') + '" data-knf="' + f.k + '">'
          + f.n + '</button>';
      }).join('') + '</div>'
    + (html ? '<div class="kn">' + html + '</div>'
            : '<div class="empty">V tomhle období nic není.</div>')
    + (S.knihaOd
        ? '<p class="fine" style="margin-top:12px">Řádky označené „dopočítáno" jsou z doby, '
          + 'kdy se kniha ještě nevedla — poskládali jsme je z toho, co ti ve hře stojí, '
          + 'takže u nich neznáme zůstatek ani kolik z toho šlo na úvěr.</p>'
        : ''));
  [].forEach.call(document.querySelectorAll('#sheet-body [data-knf]'), function (x) {
    x.onclick = function () { KNIHA_FILTR = x.getAttribute('data-knf'); knihaSheet(); };
  });
}
// Starým zápisům o provizi doplní datum vzniku. Server u každé provize ví, kdy
// ji připsal a kdy si ji hráč vyzvedl — podle vyzvednutí je spárujeme se zápisy
// z doby, kdy kniha čas vzniku ještě neukládala. Jinak dvě provize, které
// čekaly na vyzvednutí, navždy vypadají jako jedna zaúčtovaná dvakrát.
function doplnVznikProvizi(hotovo) {
  if (!S || S.knihaProvizeOk || !Array.isArray(S.kniha)) return hotovo && hotovo(false);
  var chybi = S.kniha.filter(function (r) {
    return r.d === 'prijem' && !r.v && /^Provize/.test(r.p || '');
  });
  if (!chybi.length) { S.knihaProvizeOk = 1; return hotovo && hotovo(false); }
  api('/account/provize').then(function (res) {
    var pr = ((res.ok && res.j && res.j.provize) || []).slice();
    var pouzite = [], zmena = false;
    chybi.forEach(function (r) {
      var nej = null, nejI = -1;
      pr.forEach(function (p, i) {
        if (pouzite[i] || p.castka !== r.c || !p.vyzvednuto) return;
        var d = Math.abs(new Date(p.vyzvednuto).getTime() - r.t);
        if (d < 300000 && (!nej || d < nej.d)) { nej = { d: d, kdy: p.kdy }; nejI = i; }
      });
      if (!nej) return;
      pouzite[nejI] = 1;
      var v = new Date(nej.kdy).getTime();
      if (v && r.t - v > 600000) { r.v = v; zmena = true; }
    });
    S.knihaProvizeOk = 1;
    if (zmena) save();
    if (hotovo) hotovo(zmena);
  }).catch(function () { if (hotovo) hotovo(false); });
}
// Když se mezitím přehoupl měsíc, uzavřeme ho — ať kniha nekončí u rozepsaného.
function knihaSrovnej() {
  if (S.knihaMes && S.knihaMes.m !== histMesic()) knihaUzavri();
}
function knihaHtml() {
  knihaZaloz();
  var vse = S.kniha || [];
  var prijmy = 0, vydaje = 0;
  vse.forEach(function (r) { if (r.c > 0) prijmy += r.c; else vydaje -= r.c; });
  return '<button class="card kv-karta" id="do-kniha">'
    + '<div class="row"><h3>Účetní kniha</h3><b class="muted">' + vse.length + ' zápisů ›</b></div>'
    + '<p class="muted small" style="margin:2px 0 8px">Co jsi kdy koupil, co ti přiteklo a co '
    + 'sebrala banka — od prvního dne.</p>'
    + '<div class="kv"><span>Příjmy celkem</span><b class="ok">' + kcFull(prijmy) + '</b></div>'
    + '<div class="kv"><span>Výdaje celkem</span><b class="err">' + kcFull(vydaje) + '</b></div>'
    + '</button>';
}
// Kolik z úvěru zbývalo po tolika měsících splácení.
function zbytekUveru(l, mesicu) {
  var j = Number(l.puvodni) || 0, i = (Number(l.sazba) || 0) / 12, spl = Number(l.splatka) || 0;
  if (!(spl > 0)) return Math.round(j);
  for (var k = 0; k < mesicu && j > 0; k++) j = j + j * i - spl;
  return Math.max(0, Math.round(j));
}
// Dopočet zpětně pro hry rozehrané dřív, než se vývoj začal zapisovat. Počet
// prádlomatů a tržby bereme podle toho, co kdy už stálo, dluh umoříme u každého
// úvěru jeho vlastní anuitou od data, kdy vznikl. Úvěry, které už jsou splacené,
// ve stavu nejsou — v dopočtu tedy chybí. Tvar křivky sedí, čísla jsou odhad.
function dopocitejHistorii(o) {
  var h = [];
  if (!o || !o.startedAt) return h;
  var ted = Math.floor((Date.now() - o.startedAt) / MONTH_MS);
  if (!(ted >= 0)) return h;
  for (var m = Math.max(0, ted - HIST_MAX + 1); m <= ted; m++) {
    var cas = o.startedAt + m * MONTH_MS, t = 0, z = 0, p = 0, d = 0, spl = 0;
    // Pobočky i četa si pamatují, odkdy jsou — provoz tedy dohledáme přesně.
    var prov = (o.pobocky || []).filter(function (b) { return (b.od || 0) <= cas; }).length * POBOCKA_MESICNE;
    if (o.ceta && (o.ceta.od || 0) <= cas) {
      prov += CETA_MZDY + (o.ceta.shanec ? SHANEC_MZDA : 0) + (o.ceta.phm || 0);
    }
    (o.units || []).forEach(function (u) {
      if ((u.builtAt || 0) > cas) return;
      p++;
      t += (u.eco && u.eco.revenue) || 0;
      z += (u.eco && u.eco.profit) || 0;
    });
    (o.loans || []).forEach(function (l) {
      if ((l.zalozen || 0) > cas) return;
      var zbyvalo = zbytekUveru(l, Math.floor((cas - (l.zalozen || 0)) / MONTH_MS));
      if (zbyvalo <= 0) return;
      d += zbyvalo;
      spl += Math.min(l.splatka || 0, zbyvalo + zbyvalo * (l.sazba || 0) / 12);
    });
    h.push({ m: m, t: Math.round(t), z: Math.round(z), s: Math.round(spl), o: Math.round(prov),
      d: Math.round(d), p: p, h: null, r: 1 });
  }
  return h;
}
function tick() {
  refreshUnits();
  var now = Date.now();
  var dt = now - S.lastTick;
  if (dt < 0) { S.lastTick = now; return; }      // hráč si přetočil hodiny v telefonu
  if (dt > 30 * YEAR_MS) dt = 30 * YEAR_MS;      // po měsíci nepřítomnosti dál nenabíhá
  var years = dt / YEAR_MS;
  // Poruchy se řeší dřív, než se spočítá výnos: stroj, který praskl někdy
  // uprostřed doby, co byl hráč pryč, od té chvíle nevydělával. Jinak by byla
  // nepřítomnost zadarmo a porucha by začala až návratem.
  var ztrataPoruch = hlidejPoruchy(dt);
  // Pobočky i četa stojí každý měsíc bez ohledu na to, jestli se staví.
  var earned = (yearlyProfit() - (pobockyMesicne() + cetaMesicne()) * 12) * years - ztrataPoruch;
  // Do bubliny nad prádlomaty: zvlášť co přiteklo a co banka sebrala.
  drip.earn += Math.max(0, earned);
  S.cash += earned;
  knihaProvoz(earned, 'provoz');
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
    prehodnotRamec();          // banka se na limit podívá každý herní měsíc
  }
  deliverOrders();
  hlidejVypovedMajitele(dt);
  hlidejStehovani();
  hlidejServis();
  zapisHistorii();
}

// ─── Čísla naskakující nad prádlomaty ───────────────────────────────────────
// Za vteřinu přiteče pár laundrů, což je na samostatnou bublinu málo. Sčítáme
// to proto a vypíšeme, až je z toho celé číslo — zeleně výnos, červeně úrok.
var drip = { earn: 0, pay: 0, i: 0 };
// Hotovost, se kterou jsme napošledí kreslili hlavičku. Rozdíl proti ní
// probléskne nad částkou — zeleně přírůstek, červeně úbytek. Tím se ukáže
// i to, co se strže najednou: nákup stroje, přípojky, splátka, průzkum města.
var dripCash = null;
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
    drip.earn -= kolik;
  }
  if (drip.pay >= 1) {
    var kolikP = Math.floor(drip.pay), txtP = '−' + kolikP.toLocaleString('cs-CZ');
    var q = naMape && S.units.length ? dripPoint(drip.i++) : null;
    if (q) dripShow(txtP, 'down', q);
    drip.pay -= kolikP;
  }
  hlavickaDrip();
  if (!$('v-map').classList.contains('hidden')) { drawAuta(); paintServis(); }
  hovorTik(1000);
}
// Nad hotovostí probléskne, o kolik se právě změnila — ať už přitečla po
// kapkách, nebo odtečla naráz.
function hlavickaDrip() {
  var ted = Math.round(S.cash);
  if (dripCash == null) { dripCash = ted; paintHlavicka(); return; }
  var zmena = ted - dripCash;
  if (!zmena) return;
  dripCash = ted;
  paintHlavicka();
  if (Math.abs(zmena) < 1) return;
  headDrip((zmena > 0 ? '+' : '−') + Math.abs(zmena).toLocaleString('cs-CZ'),
    zmena > 0 ? 'up' : 'down');
}
function gameYear() { return Math.floor((Date.now() - S.startedAt) / YEAR_MS) + 1; }

// ─── Pomůcky ─────────────────────────────────────────────────────────────────
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// Zkrácená částka. Zásadní je, že zaokrouhlení nesmí přetéct do dalšího řádu —
// 999 800 se zaokrouhlí na tisíc tisíců a to se nepíše, to je milion.
function kc(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) < 1e4) return n.toLocaleString('cs-CZ');
  var tis = Math.round(n / 1e3);
  if (Math.abs(tis) < 1000) return tis + ' tis.';
  var mil = n / 1e6, des = Math.abs(mil) >= 10 ? 0 : 1;
  if (Math.abs(Number(mil.toFixed(des))) < 1000) return mil.toFixed(des).replace('.', ',') + ' M';
  return (n / 1e9).toFixed(1).replace('.', ',') + ' mld.';
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

// ─── Infolinka ────────────────────────────────────────────────────
// Zákazníci volá jen tomu, kdo je zrovna ve hře — odpočítává se čas strávený
// v aplikaci, ne čas skutečný. Kdo hovory bere a umí poradit, má lepší pověst
// a chodí mu víc lidí. Kdo je odmítá nebo odbyde, přijde až o pětinu návštěvnosti.
var HOVOR_ZA_MIN = 150000;       // nejdřív za dvě a půl minuty ve hře
var HOVOR_ZA_MAX = 420000;       // nejpozději za sedm
var HOVOR_ZVONI_MS = 8000;       // osm vteřin a zákazník to pokládá — nevyřízený hovor
var HOVOR_ODMITNUTI = -2;        // co stojí nebraný hovor (projde přes váhu níž)
// Hvězdičky se vydřou a ztratí hned. Dobrá odpověď posune pověst o půlku toho,
// co je za ni napsané, špatná o trojnásobek — tak to chodí i ve skutečnosti:
// spokojený zákazník mlčí, naštvaný to řekne všem.
var POVEST_RUST = 0.5;
var POVEST_PAD = 3;
var POVEST_DOLU = 0.2;           // při nejhorší pověsti spadne návštěvnost o pětinu
var POVEST_NAHORU = 0.1;         // při nejlepší stoupne o desetinu
var SCENARU_PAMET = 18;          // kolik posledních rozhovorů se neopakuje
var JMEN_PAMET = 60;             // tolik posledních jmen se neopakuje
var HOVOR_ZENY = ['paní Nováková', 'paní Svobodová', 'paní Dvořáková', 'paní Černá',
  'paní Procházková', 'paní Kučerová', 'paní Veselá', 'paní Horáková', 'paní Němcová',
  'paní Marková', 'paní Pospíšilová', 'paní Pokorná', 'paní Hájková', 'paní Jelínková',
  'paní Králová', 'paní Růžičková', 'paní Benešová', 'paní Fialová', 'paní Sedláčková',
  'paní Doležalová', 'paní Zemanová', 'paní Kolářová', 'paní Navrátilová', 'paní Čermáková',
  'paní Vaňková', 'paní Urbanová', 'paní Blažková', 'paní Křížová', 'paní Kovářová',
  'paní Bartošová', 'paní Vlčková', 'paní Štěpánková', 'paní Poláková', 'paní Konečná',
  'paní Mašková', 'paní Musilová', 'paní Šimková', 'paní Holubová', 'paní Kratochvílová',
  'paní Kadlecová', 'paní Machová', 'paní Lišková', 'paní Soukupová', 'paní Bláhová',
  'slečna Matoušková', 'slečna Burešová', 'slečna Kopecká', 'slečna Malá', 'slečna Dostálová',
  'slečna Šťastná', 'slečna Tichá', 'slečna Vaněčková', 'slečna Hrubá', 'slečna Beránková',
  'paní Nguyenová', 'paní Horváthová', 'paní Baloghová', 'paní Kowalská', 'paní Šebestová',
  'paní Strnadová', 'paní Vondráčková', 'paní Zídková', 'paní Melicharová', 'paní Pechová',
  'paní Šulcová', 'paní Rybářová', 'paní Kohoutová', 'paní Čapková', 'paní Matějková',
  'paní Vrbová', 'paní Janoušková', 'paní Dudková', 'paní Hrabalová', 'paní Pánková',
  'paní Slavíková', 'paní Vítková', 'paní Brožová', 'paní Macháčková', 'paní Jirásková',
  'paní Bednářová', 'paní Havlíčková', 'paní Trávníčková', 'paní Suchánková', 'paní Kasalová',
  'slečna Kalousková', 'slečna Prokopová', 'slečna Hejduková', 'slečna Rysová', 'slečna Fenclová',
  'slečna Linhartová', 'slečna Krejzová', 'slečna Michalcová', 'slečna Potůčková', 'slečna Boháčová',
  'doktorka Králíčková', 'paní učitelka Zemanová', 'paní Nedvědová', 'paní Pilařová',
  'paní Bezděková', 'paní Hofmanová', 'paní Rezková', 'paní Štědrá', 'paní Chalupová'];
var HOVOR_MUZI = ['pan Novák', 'pan Svoboda', 'pan Dvořák', 'pan Černý', 'pan Procházka',
  'pan Kučera', 'pan Veselý', 'pan Horák', 'pan Němec', 'pan Marek', 'pan Pospíšil',
  'pan Pokorný', 'pan Hájek', 'pan Jelínek', 'pan Král', 'pan Růžička', 'pan Beneš',
  'pan Fiala', 'pan Sedláček', 'pan Doležal', 'pan Zeman', 'pan Kolář', 'pan Navrátil',
  'pan Čermák', 'pan Vaněk', 'pan Urban', 'pan Blažek', 'pan Kříž', 'pan Kovář',
  'pan Bartoš', 'pan Vlček', 'pan Štěpánek', 'pan Polák', 'pan Konečný', 'pan Mašek',
  'pan Musil', 'pan Šimek', 'pan Holub', 'pan Kratochvíl', 'pan Kadlec', 'pan Mach',
  'pan Liška', 'pan Soukup', 'pan Bláha', 'pan Matoušek', 'pan Bureš', 'pan Kopecký',
  'pan Malý', 'pan Dostál', 'pan Šťastný', 'pan Tichý', 'pan Richter', 'pan Hruška',
  'pan Beránek', 'pan Vávra',
  'pan Nguyen', 'pan Horváth', 'pan Balogh', 'pan Kowalski', 'pan Šebesta',
  'pan Strnad', 'pan Vondráček', 'pan Zídek', 'pan Melichar', 'pan Pech',
  'pan Šulc', 'pan Rybář', 'pan Kohout', 'pan Čapek', 'pan Matějka',
  'pan Vrba', 'pan Janoušek', 'pan Dudek', 'pan Hrabal', 'pan Pánek',
  'pan Slavík', 'pan Vítek', 'pan Brož', 'pan Macháček', 'pan Jirásek',
  'pan Bednář', 'pan Havlíček', 'pan Trávníček', 'pan Suchánek', 'pan Kasal',
  'pan Kalousek', 'pan Prokop', 'pan Hejduk', 'pan Rys', 'pan Fencl',
  'pan Linhart', 'pan Krejza', 'pan Michalec', 'pan Potůček', 'pan Boháč',
  'doktor Nedvěd', 'pan řidič Pilař', 'pan Bezděk', 'pan Hofman', 'pan Rezek',
  'pan Štědrý', 'pan Chalupa', 'pan Křeček', 'pan Vlasák', 'pan Žáček'];
var HOVOR_SCENARE = [
  { id: 'stovka', rod: '', kroky: [
    { t: 'Dobrý den, váš automat mi spolkl stovku a nic se nespustilo.', o: [
      { t: 'Mrzí mě to. Pošlu vám ji zpátky na účet.', b: 2, r: 'Dobře, to je fér.' },
      { t: 'Bez dokladu nic nevracíme, to je u samoobsluhy běžné.', b: -2, r: 'Takže mě okradete a je to?' },
      { t: 'To se občas stane, zkuste to znovu a snad to projde — mincovníky někdy naberou vlhkost a zasekne se jim mechanika.', b: -1, r: 'Takže mám hodit další stovku?' },
    ] },
    { t: 'A jak dlouho to trvá, než mi ty peníze přijdou?', o: [
      { t: 'Do dvou dnů. Kdyby ne, ozvěte se mi přímo.', b: 2, r: 'Beru.' },
      { t: 'Těžko říct, to má na starosti účetní.', b: -1, r: 'No super.' },
      { t: 'Obvykle to bývá rychlé.', b: 0, r: 'Hm.' },
    ] },
    { t: 'A co teď? Potřebuju to vyprat dneska.', o: [
      { t: 'Pustím vám stroj na dálku, za minutu naskočí.', b: 2, r: 'Vy jste zlato, děkuju!' },
      { t: 'Tak přijďte zítra.', b: -2, r: 'Zítra mi to je k ničemu.' },
      { t: 'Zkuste ten vedlejší, tam jde platit i kartou, ale jestli je volný, to vám odsud neřeknu.', b: 1, r: 'Tak to zkusím.' },
    ] },
  ] },
  { id: 'svetr', rod: 'z', kroky: [
    { t: 'Prala jsem u vás vlněný svetr a je z něj dětská velikost.', o: [
      { t: 'To je mi líto. Co jste na něj dala za program?', b: 2, r: 'Hned se ptáte věcně, to je dobré.' },
      { t: 'Vlna do automatu nepatří, to je vaše chyba.', b: -2, r: 'Tak to mi teda pomohlo.' },
      { t: 'Za sražení neručíme, máte to napsané na stroji i v podmínkách na webu, podívejte se tam.', b: -2, r: 'Volám kvůli svetru, ne kvůli podmínkám.' },
    ] },
    { t: 'Dala jsem šedesát, bylo to předvolené.', o: [
      { t: 'Tak to je na vlnu moc. Dám k tomu stroji lepší popisek, ať to nepotká dalšího.', b: 2, r: 'Aspoň něco.' },
      { t: 'No vidíte, tak to je jasné.', b: -1, r: 'To mě teda potěšilo.' },
      { t: 'Šedesát je standard, to nemůže nikomu uškodit.', b: -2, r: 'Tak proč mám ze svetru hadr?' },
    ] },
    { t: 'A kdo mi ten svetr zaplatí?', o: [
      { t: 'Pošlete mi fotku a účtenku, domluvíme se.', b: 2, r: 'Dobře, pošlu.' },
      { t: 'Nikdo, prala jste si sama a na stroji je napsané, co do něj patří.', b: -2, r: 'Končím s váma.' },
      { t: 'Můžu vám dát praní zdarma, víc bohužel ne.', b: 1, r: 'No, lepší než nic.' },
    ] },
    { t: 'Dobře. A jak to mám prát příště?', o: [
      { t: 'Třicet a nikdy do sušičky.', b: 2, r: 'Zapsáno. Děkuju.' },
      { t: 'Nějak to zkuste, od toho je to samoobsluha.', b: -2, r: 'To myslíte vážně?' },
      { t: 'Vlnu bych radši doma v ruce, v automatu je to vždycky risk, i když dáte nejnižší program a pomalé otáčky.', b: 0, r: 'Tak to k vám s vlnou nepůjdu.' },
    ] },
  ] },
  { id: 'drahe', rod: '', kroky: [
    { t: 'Jste moc drazí. Za rohem perou levněji.', o: [
      { t: 'Kolik tam platíte?', b: 2, r: 'Ptáte se správně.' },
      { t: 'Tak jděte za roh, nikdo vás tu nedrží.', b: -2, r: 'Nebojte, půjdu.' },
      { t: 'Naše ceny vycházejí z toho, že máme nové stroje, otevřeno nonstop a technika do druhého dne.', b: 1, r: 'To zní jako z letáku.' },
    ] },
    { t: 'Sto třicet za pračku. U vás dvě stě.', o: [
      { t: 'U nás vyperete osmnáct kilo naráz, tam nejspíš šest.', b: 2, r: 'Hm, to mě nenapadlo.' },
      { t: 'To nejde porovnávat, každý má jiné stroje, jinou vodu i jiné náklady, takže cenu za cyklus fakt neřešte.', b: -1, r: 'Proč ne?' },
      { t: 'Tak si tam jděte.', b: -2, r: 'Však jo.' },
    ] },
    { t: 'Hm. A dáte mi slevu, nebo vám napíšu recenzi?', o: [
      { t: 'Recenzi si napište. Jedno praní vám dám zdarma, ať to zkusíte.', b: 2, r: 'Tak dobře, zkusím to.' },
      { t: 'Dám vám padesát procent napořád.', b: -1, r: 'Beru! A řeknu to všem.' },
      { t: 'Tak si pište.', b: -2, r: 'Spolehněte se.' },
    ] },
  ] },
  { id: 'dvirka', rod: 'z', kroky: [
    { t: 'Nejdou mi otevřít dvířka a mám uvnitř všechno prádlo.', o: [
      { t: 'Dotáčí se a odpouští vodu. Dvě minuty a povolí.', b: 2, r: 'Aha, tak počkám.' },
      { t: 'Zatáhněte za ně pořádně.', b: -2, r: 'Já vám je ulomím!' },
      { t: 'Zámek je bezpečnostní a nejde s ním nic dělat, technik přijede nejdřív zítra, do té doby to tam asi zůstane.', b: -1, r: 'Zítra?!' },
    ] },
    { t: 'Už to povolilo. Ale prádlo je úplně mokré.', o: [
      { t: 'Neproběhlo odstřeďování. Sušičku máte u mě zdarma, kód pošlu SMSkou.', b: 2, r: 'To je slušné, děkuju.' },
      { t: 'Tak to dejte do sušičky, je vedle.', b: 0, r: 'Za další peníze?' },
      { t: 'To se stává, odstřeďování občas vynechá a nic se tím nezkazí, prádlo doschne doma na balkoně.', b: -2, r: 'To mi nestačí.' },
    ] },
    { t: 'A proč to vůbec spadlo?', o: [
      { t: 'Mrknu do stroje. Jestli je to závada, pošlu tam dnes technika.', b: 2, r: 'Dobře, díky.' },
      { t: 'Nejspíš jste ji přecpala.', b: -1, r: 'Zase si to můžu za všechno sama.' },
      { t: 'Netuším.', b: -2, r: 'Tak to je mi platné.' },
    ] },
  ] },
  { id: 'novy', rod: '', kroky: [
    { t: 'Dobrý den, jdu kolem a nevím, jak to funguje. Je to prádelna?', o: [
      { t: 'Samoobsluha. Naházíte prádlo, zaplatíte a za 35 minut máte hotovo.', b: 2, r: 'Aha, tak to zkusím.' },
      { t: 'Je to přece jasné z názvu, kdyby to byla prádelna, stál by tam někdo za pultem a bral vám to prádlo.', b: -2, r: 'Tohle je zbytečné.' },
      { t: 'Samoobsluha.', b: 0, r: 'No... dobře.' },
    ] },
    { t: 'A prášek si mám přinést?', o: [
      { t: 'Nemusíte, dávkovač je ve stroji.', b: 2, r: 'Výborně.' },
      { t: 'To je na vás, každý si to dělá po svém.', b: 0, r: 'Tak co mi radíte?' },
      { t: 'Jasně, bez vlastního prášku to nemá cenu, náš dávkovač stejně dávkuje málo a prádlo pak není pořádně vyprané.', b: -2, r: 'Tak to je skvělá reklama.' },
    ] },
    { t: 'Kolik ho mám dát?', o: [
      { t: 'Odměřený díl. Víc prášku líp nevypere.', b: 2, r: 'Dobrá rada.' },
      { t: 'Co myslíte, že je potřeba. Já u toho stroje nestojím.', b: -1, r: 'Proto se ptám vás.' },
      { t: 'Přečtěte si to na obalu, je tam tabulka podle tvrdosti vody a míry zašpinění.', b: -1, r: 'Stojím u stroje, ne doma.' },
    ] },
    { t: 'A kde zaplatím?', o: [
      { t: 'Kartou na terminálu u dvířek, nebo mincemi.', b: 2, r: 'Super, jdu na to.' },
      { t: 'Někde tam to je.', b: -2, r: 'To mi teda pomohlo.' },
      { t: 'Platí se až po doprání.', b: -2, r: 'Tak to mi stroj nenaskočil.' },
    ] },
  ] },
  { id: 'pes', rod: '', kroky: [
    { t: 'Můžu u vás vyprat deku po psovi? Nechci si zanést vlastní pračku.', o: [
      { t: 'Klidně. Přesně na to to je.', b: 2, r: 'Super.' },
      { t: 'Zvířecí věci u nás neperem.', b: -1, r: 'Tak to jdu jinam.' },
      { t: 'To je mi jedno, perte si co chcete.', b: -2, r: 'Pěkný přístup.' },
    ] },
    { t: 'A nebude to vadit tomu, kdo bude prát po mně?', o: [
      { t: 'Nebude, stroj mezi cykly vypláchne buben sám.', b: 2, r: 'To je dobře vymyšlené.' },
      { t: 'To nevím, nikdo si zatím nestěžoval, ale asi by jim to vadit mohlo, kdyby to věděli.', b: -1, r: 'Vy nevíte, jak funguje váš stroj?' },
      { t: 'Těm je to jedno.', b: -2, r: 'Mně by to jedno nebylo.' },
    ] },
    { t: 'A dám ji potom do sušičky?', o: [
      { t: 'Klidně, chlupy padají do filtru.', b: 2, r: 'Děkuju za radu.' },
      { t: 'Sušičku radši ne.', b: 0, r: 'Aha, tak jo.' },
      { t: 'Dělejte si, co chcete.', b: -2, r: 'To jsem si mohl ušetřit telefon.' },
    ] },
  ] },
  { id: 'smrad', rod: '', kroky: [
    { t: 'Prádlo mi po praní smrdí. To není normální.', o: [
      { t: 'To opravdu není. Který stroj to byl?', b: 2, r: 'Dobře, že se ptáte.' },
      { t: 'Smrdělo asi už předtím, stroj za to nemůže.', b: -2, r: 'To je neuvěřitelné.' },
      { t: 'Zkuste přidat víc aviváže, to to obvykle přebije a prádlo pak voní i několik dní.', b: -2, r: 'Já nechci přebít smrad, chci ho nemít.' },
    ] },
    { t: 'Ten krajní, u silnice.', o: [
      { t: 'Díky. Nechám mu vyčistit buben a praní máte u mě zdarma.', b: 2, r: 'To je slušné.' },
      { t: 'Podíváme se na to někdy, až tam technik pojede kvůli něčemu jinému.', b: -1, r: 'Někdy?' },
      { t: 'Na ten si nikdo nestěžoval.', b: -2, r: 'Tak já jsem první.' },
    ] },
    { t: 'A jak poznám, že je to spravené?', o: [
      { t: 'Dám vám vědět, až to technik udělá.', b: 2, r: 'Budu čekat, děkuju.' },
      { t: 'Prostě to zkusíte.', b: -1, r: 'Za svoje peníze.' },
      { t: 'To poznáte.', b: -2, r: 'Díky za nic.' },
    ] },
  ] },
  { id: 'penzion', rod: '', kroky: [
    { t: 'Mám penzion a potřebuju prát povlečení. Zvládnete to?', o: [
      { t: 'Zvládneme. Kolik toho týdně je?', b: 2, r: 'Hned k věci, to se mi líbí.' },
      { t: 'Přijďte jako každý jiný, rezervace neděláme a pořadí se tu nedrží.', b: 0, r: 'Tak to asi ne.' },
      { t: 'To nás nezajímá, jedeme na samoobsluhu a ne na firmy.', b: -2, r: 'Škoda pro vás.' },
    ] },
    { t: 'Asi sto kilo týdně.', o: [
      { t: 'To je pět praní. Domluvím vám pevnou cenu a stroje podržím.', b: 2, r: 'To zní výborně.' },
      { t: 'Tak to vám bude chvíli trvat, pět praní po pětatřiceti minutách jsou skoro tři hodiny, počítejte s tím.', b: -1, r: 'To mi moc nepomohlo.' },
      { t: 'Tolik toho nepereme.', b: -2, r: 'Na co tam ty stroje máte?' },
    ] },
    { t: 'A co když bude obsazeno?', o: [
      { t: 'Dám vám číslo, zavoláte a já vám stroj uvolním.', b: 2, r: 'Beru, ozvu se.' },
      { t: 'Tak počkáte.', b: -2, r: 'S prádlem z penzionu?' },
      { t: 'To se nestává.', b: -1, r: 'To mi nestačí.' },
    ] },
  ] },
  { id: 'soused', rod: '', kroky: [
    { t: 'Váš prádlomat stojí pod mými okny a v noci hučí.', o: [
      { t: 'To mě mrzí. V kolik vás to budí nejvíc?', b: 2, r: 'Aspoň někdo poslouchá.' },
      { t: 'Máme na to povolení od města i hlukovou studii, takže z naší strany je všechno v pořádku.', b: -1, r: 'To mě netěší.' },
      { t: 'To je váš problém, měl jste se dívat, co se vám staví pod okny.', b: -2, r: 'Uvidíme, čí to bude problém.' },
    ] },
    { t: 'Kolem jedenácté, kdy jdou lidi z práce.', o: [
      { t: 'Dám tam noční režim s nižšími otáčkami. Vyzkoušíme to týden.', b: 2, r: 'To by pomohlo.' },
      { t: 'S tím nic nenadělám, stroje běží jak běží a vypínat je na noc kvůli jednomu člověku nebudu.', b: -2, r: 'Tak to budu řešit jinde.' },
      { t: 'Lidi musí taky prát.', b: -1, r: 'A já musím spát.' },
    ] },
    { t: 'A když to nepomůže?', o: [
      { t: 'Přijdu se podívat a změříme to.', b: 2, r: 'Tak to beru.' },
      { t: 'Tak si stěžujte.', b: -2, r: 'Spolehněte se.' },
      { t: 'Pomůže.', b: -1, r: 'To uvidíme.' },
    ] },
  ] },
  { id: 'tenisky', rod: '', kroky: [
    { t: 'Můžu u vás vyprat tenisky?', o: [
      { t: 'Můžete. Do sáčku a na třicet.', b: 2, r: 'Super, díky.' },
      { t: 'Boty ne.', b: -1, r: 'Aha, škoda.' },
      { t: 'Zkuste to, uvidíte, já vám to nezakazuju ani nedoporučuju.', b: -2, r: 'To mi teda pomohlo.' },
    ] },
    { t: 'A do sušičky?', o: [
      { t: 'Ty ne, rozlepily by se. Nechte je doschnout doma.', b: 2, r: 'Dobře, že to vím.' },
      { t: 'Klidně.', b: -2, r: 'Tak to mi je zničíte.' },
      { t: 'Jak chcete.', b: -1, r: 'Ptám se, co je lepší.' },
    ] },
    { t: 'A nezničí mi to buben?', o: [
      { t: 'Ne, proto ten sáček.', b: 2, r: 'Jasně. Děkuju.' },
      { t: 'Může, podrážky jsou tvrdé a buben je plech.', b: -1, r: 'Tak to tam nedám.' },
      { t: 'To nevím, nikdy jsem to nezkoušel, ale podrážky jsou tvrdé, takže bych se asi nedivil, kdyby jo.', b: -1, r: 'Tak to mě teda uklidnilo.' },
    ] },
  ] },
  { id: 'karta', rod: 'm', kroky: [
    { t: 'Dobrý den, zaplatil jsem kartou a strhlo se to dvakrát.', o: [
      { t: 'Jednu platbu vám hned zruším.', b: 2, r: 'Děkuju, to je rychlovka.' },
      { t: 'To dělá banka, ne my.', b: -2, r: 'Peníze mám ale u vás.' },
      { t: 'Podívám se na to, ale terminál občas pošle dvě předautorizace a jedna se sama uvolní, takže možná stačí počkat.', b: 0, r: 'A co když se neuvolní?' },
    ] },
    { t: 'A jak to poznám na výpisu?', o: [
      { t: 'To já nevím.', b: -2, r: 'Tak kde si to mám ověřit?' },
      { t: 'Přijde vám vratka ve stejné částce, obvykle do tří dnů. Kdyby ne, zavolejte a dořeším to.', b: 2, r: 'Dobře, díky.' },
      { t: 'Bude tam napsáno storno.', b: 1, r: 'Tak se podívám.' },
    ] },
    { t: 'A můžu zatím prát?', o: [
      { t: 'Jasně, pustím vám stroj na dálku.', b: 2, r: 'Super.' },
      { t: 'Až se ta platba vyřeší, do té doby vám stroj nepustím.', b: -2, r: 'To mám chodit s košem domů?' },
      { t: 'Zkuste platit mincemi, ale drobné u sebe asi nemáte, že.', b: -1, r: 'Nemám.' },
    ] },
  ] },
  { id: 'mraz', rod: 'm', kroky: [
    { t: 'Teď v zimě to vůbec jede? Je mínus deset.', o: [
      { t: 'Jede. Stroj je vyhřívaný a voda nezamrzne.', b: 2, r: 'To jsem nevěděl.' },
      { t: 'To zkuste.', b: -2, r: 'Ptám se vás.' },
      { t: 'Když je takhle zima, radši to nechte na jindy, mohlo by to zamrznout a pak z toho máme opravu.', b: -2, r: 'Tak na co to tam je.' },
    ] },
    { t: 'A neztuhne mi prádlo, než ho donesu k autu?', o: [
      { t: 'Neztuhne.', b: 0, r: 'To mi jako má stačit?' },
      { t: 'Nechte ho projet sušičkou, vyjde teplé a cestou domů nezmrzne.', b: 2, r: 'Dobrý nápad.' },
      { t: 'Vezměte si rukavice.', b: -1, r: 'Děkuju za radu století.' },
    ] },
    { t: 'A kdyby to přece jen zamrzlo?', o: [
      { t: 'Zavolejte, pošlu technika hned.', b: 2, r: 'Beru.' },
      { t: 'To se nám zatím nestalo, takže s tím ani nepočítám.', b: -1, r: 'Ale stát se to může.' },
      { t: 'Tak to máte smůlu, mráz je vyšší moc.', b: -2, r: 'Pěkné.' },
    ] },
  ] },
  { id: 'otviracka', rod: 'm', kroky: [
    { t: 'Do kolika máte otevřeno?', o: [
      { t: 'Nonstop. Stroj stojí venku a jede pořád.', b: 2, r: 'To je super.' },
      { t: 'Do osmi večer.', b: -2, r: 'Tak to nikdy nestihnu.' },
      { t: 'Otevřeno vlastně nemáme, protože to není prádelna, ale stroj, a ten se nezavírá.', b: 1, r: 'Aha, rozumím.' },
    ] },
    { t: 'A v noci je to tam bezpečné?', o: [
      { t: 'Klidně.', b: -1, r: 'To mě moc neuklidnilo.' },
      { t: 'Je tam světlo a kamera na automat. Ale v noci je tam člověk sám, to vám nebudu zastírat.', b: 2, r: 'Oceňuju, že to řeknete na rovinu.' },
      { t: 'To vám nezaručím.', b: 0, r: 'Hm.' },
    ] },
    { t: 'A o svátcích?', o: [
      { t: 'Taky. Nic nezavíráme.', b: 2, r: 'Výborně.' },
      { t: 'Svátky řešíme individuálně.', b: -1, r: 'Co to znamená?' },
      { t: 'Nevím, podívejte se na web.', b: -2, r: 'Volám, abych se nemusel dívat.' },
    ] },
  ] },
  { id: 'peri', rod: 'z', kroky: [
    { t: 'Vejde se mi do toho peřina? Mám dvoulůžkovou.', o: [
      { t: 'Do velkého stroje ano, bere osm kilo suchého prádla.', b: 2, r: 'Tak to vezmu.' },
      { t: 'Nevejde.', b: -2, r: 'A to víte odkud?' },
      { t: 'Zkuste to tam nacpat, ono se to většinou nějak vejde, a když ne, tak to zase vytáhnete.', b: -2, r: 'Nacpat peřinu do pračky, to je tedy rada.' },
    ] },
    { t: 'A vyschne mi v sušičce?', o: [
      { t: 'Dejte ji na delší program a přihoďte dva suché ručníky, naberou vlhkost a peří se neslepí.', b: 2, r: 'To zkusím, díky.' },
      { t: 'Vyschne.', b: 0, r: 'Určitě?' },
      { t: 'Peřiny radši nesušíme.', b: -1, r: 'A co s ní mám podle vás dělat?' },
    ] },
    { t: 'Nezničím tím to peří?', o: [
      { t: 'Ne, když nedáte vysokou teplotu.', b: 2, r: 'Dobře, děkuju.' },
      { t: 'To se stát může.', b: -1, r: 'Tak mi poraďte, jak ne.' },
      { t: 'Peří je peří, to vydrží všechno.', b: -2, r: 'To si zrovna nemyslím.' },
    ] },
  ] },
  { id: 'barva', rod: 'z', kroky: [
    { t: 'Prala jsem po někom a obarvilo mi to bílé triko.', o: [
      { t: 'To je nepříjemné. Který stroj to byl a kdy?', b: 2, r: 'Dneska ráno, ten prostřední.' },
      { t: 'To si pustil někdo jiný, s tím nic nenaděláme.', b: -2, r: 'Takže nic.' },
      { t: 'Stroj po každém praní vypláchne buben, takže v něm barva zbýt nemůže — spíš se to obarvilo od něčeho vašeho.', b: -1, r: 'Vy mi tvrdíte, že lžu?' },
    ] },
    { t: 'Dneska ráno, ten prostřední.', o: [
      { t: 'Dobře, poznamenám si to.', b: 0, r: 'A dál?' },
      { t: 'Pustím na něj prázdný cyklus a prověřím to. Za to triko vám dám praní zdarma.', b: 2, r: 'To je slušné.' },
      { t: 'To už se nedá dokázat.', b: -2, r: 'Tak nashledanou.' },
    ] },
    { t: 'A dá se to triko ještě zachránit?', o: [
      { t: 'Zkuste ho vyprat hned znovu, dokud barva nezaschla.', b: 2, r: 'Jdu to udělat.' },
      { t: 'To nevím, nejsem chemik.', b: -1, r: 'Stačilo říct, co byste udělal vy.' },
      { t: 'Asi ne, s tím už vám nepomůžu, tohle je spíš na čistírnu.', b: -1, r: 'Děkuju za optimismus.' },
    ] },
  ] },
  { id: 'susicka', rod: 'z', kroky: [
    { t: 'Sušička mi nedosušila, prádlo je po celém cyklu vlhké.', o: [
      { t: 'To nemá být. Byl ten buben plný?', b: 2, r: 'No, nacpala jsem ho dost.' },
      { t: 'Dala jste tam moc věcí.', b: -1, r: 'To říkáte, aniž byste věděl kolik.' },
      { t: 'Sušení záleží na spoustě věcí — na tom, co sušíte, jak to bylo odstředěné a jak je venku chladno.', b: 0, r: 'Takže?' },
    ] },
    { t: 'No, nacpala jsem ho dost.', o: [
      { t: 'No vidíte.', b: -2, r: 'Nemusíte mě poučovat.' },
      { t: 'Tak to bude tím — sušička potřebuje, aby se prádlo volně otáčelo. Dejte půlku a uvidíte rozdíl.', b: 2, r: 'Dobře, zkusím to.' },
      { t: 'I tak to mělo usušit.', b: 0, r: 'Tak co teda?' },
    ] },
    { t: 'A zaplatím si to sušení znovu?', o: [
      { t: 'Ne, tohle jedno vám pustím zdarma.', b: 2, r: 'Děkuju.' },
      { t: 'Zaplatíte, stroj běžel.', b: -1, r: 'Ale nedosušil.' },
      { t: 'To už neřeším, stroj běžel a tím to pro mě končí.', b: -2, r: 'Skvělý přístup.' },
    ] },
  ] },
  { id: 'miminko', rod: 'z', kroky: [
    { t: 'Můžu u vás prát věci po miminku?', o: [
      { t: 'Můžete. Dejte šedesát, to je na dětské prádlo tak akorát.', b: 2, r: 'Dobře.' },
      { t: 'Jasně.', b: 0, r: 'A na kolik stupňů?' },
      { t: 'Klidně, ale upřímně bych dětské věci do veřejné pračky nedával, nikdy nevíte, co tam kdo pral před vámi.', b: -2, r: 'Tak proč to provozujete?' },
    ] },
    { t: 'A zbyde tam prášek po tom, kdo pral přede mnou?', o: [
      { t: 'Nezbyde.', b: 1, r: 'Tak dobře.' },
      { t: 'Ne, stroj mezi praními vypláchne buben čistou vodou a prášek si dávkuje sám, takže se nic nenahromadí.', b: 2, r: 'To mě uklidnilo.' },
      { t: 'Něco tam vždycky zbyde.', b: -2, r: 'Tak to teda ne.' },
    ] },
    { t: 'A aviváž tam mám dávat?', o: [
      { t: 'U dětských věcí ji radši vynechte.', b: 2, r: 'Děkuju za radu.' },
      { t: 'Dejte si, co chcete, do toho vám mluvit nebudu.', b: -1, r: 'Ptala jsem se na doporučení.' },
      { t: 'To je jedno, aviváž ještě nikdy nikomu nic nezkazila.', b: -1, r: 'U dětské kůže bych si tím nebyla tak jistá.' },
    ] },
  ] },
  { id: 'faktura', rod: 'm', kroky: [
    { t: 'Potřeboval bych na praní doklad pro firmu.', o: [
      { t: 'Pošlu vám fakturu na mail. Jaké máte IČO?', b: 2, r: 'Hned vám ho nadiktuju.' },
      { t: 'Doklady u samoobsluhy neděláme.', b: -2, r: 'Tak to si prádlo odvezu jinam.' },
      { t: 'Terminál tiskne útržek z platby, ale ten vám do účetnictví asi nestačí, takže nevím, co s tím.', b: -1, r: 'Proto právě volám.' },
    ] },
    { t: 'Jsme eseróčko, platíme firemní kartou.', o: [
      { t: 'Tak to je jednoduché.', b: 0, r: 'A co mám tedy udělat?' },
      { t: 'Výborně, ty platby umím v systému dohledat a poslat vám souhrnnou fakturu jednou měsíčně.', b: 2, r: 'To by nám sedlo.' },
      { t: 'Firemní karty tu radši nepoužívejte.', b: -2, r: 'Proč ne?' },
    ] },
    { t: 'A dá se to nastavit natrvalo?', o: [
      { t: 'Dá. Nastavím vám to ještě dneska.', b: 2, r: 'Děkuju.' },
      { t: 'Uvidíme, teď vám nic slibovat nebudu.', b: -1, r: 'To není odpověď.' },
      { t: 'To byste musel na účetní, ta tu ale dneska není a zítra má volno.', b: -1, r: 'Vy to nevyřídíte?' },
    ] },
  ] },
  { id: 'kamery', rod: 'm', kroky: [
    { t: 'Někdo mi z automatu vzal prádlo. Máte tam kamery?', o: [
      { t: 'Kamera tam je. Řekněte mi čas a podívám se na záznam.', b: 2, r: 'Bylo to kolem páté odpoledne.' },
      { t: 'Máme, hned vám ten záznam pošlu.', b: -2, r: 'To byste asi jen tak posílat neměl, ne?' },
      { t: 'Kamery tam jsou, ale záznam vám dát nemůžu, ten se předává policii.', b: 1, r: 'Aspoň něco.' },
    ] },
    { t: 'Bylo to kolem páté odpoledne.', o: [
      { t: 'Podívám se.', b: 1, r: 'Dobře.' },
      { t: 'Projdu to, a když tam někdo bude, předám to policii. Vám dám potvrzení, že se to stalo.', b: 2, r: 'To mi pomůže.' },
      { t: 'V pět tam chodí spousta lidí, to nedohledám.', b: -2, r: 'Ani jste se nepodíval.' },
    ] },
    { t: 'A nahradíte mi to?', o: [
      { t: 'To bohužel ne, ale příští praní jde za mnou.', b: 2, r: 'Fér.' },
      { t: 'Za věci ve stroji neručíme, je to tam napsané.', b: -1, r: 'Technicky máte pravdu, lidsky ne.' },
      { t: 'To jste si měl hlídat.', b: -2, r: 'Děkuju za pochopení.' },
    ] },
  ] },
  { id: 'prepln', rod: 'm', kroky: [
    { t: 'Vypral jsem si a prádlo je pořád špinavé.', o: [
      { t: 'Podívám se na ten stroj. Kolik jste toho dal dovnitř? Buben má být tak do tří čtvrtin.', b: 2, r: 'No, byl plný až nahoru.' },
      { t: 'Dal jste tam moc.', b: -1, r: 'To přece nemůžete vědět.' },
      { t: 'Tak si perte doma.', b: -2, r: 'Pěkné.' },
    ] },
    { t: 'No, byl plný až nahoru.', o: [
      { t: 'To je ono.', b: 0, r: 'A co teď?' },
      { t: 'Pak se prádlo nemá jak hýbat a nevypere se. Příště nechte nahoře dlaň místa.', b: 2, r: 'Aha, to dává smysl.' },
      { t: 'No vidíte, takže to není vada stroje, ale chyba obsluhy, tedy vaše.', b: -2, r: 'Nemusíte mi to podávat takhle.' },
    ] },
    { t: 'Dobře, a vyperu to znovu za svoje?', o: [
      { t: 'Tentokrát to jde za mnou.', b: 2, r: 'To je slušné, děkuju.' },
      { t: 'Ano, stroj běžel správně.', b: -1, r: 'Chápu, ale mrzí mě to.' },
      { t: 'Zkuste to znovu a uvidíme, jak to dopadne.', b: -1, r: 'Co uvidíme?' },
    ] },
  ] },
  { id: 'monterky', rod: 'm', kroky: [
    { t: 'Můžu u vás vyprat montérky od oleje?', o: [
      { t: 'Vyprat ano. Ale do sušičky je pak nedávejte.', b: 2, r: 'Proč ne?' },
      { t: 'Klidně, všechno.', b: -2, r: 'I do sušičky?' },
      { t: 'Můžete, u nás si každý pere, co chce — montérky, hadry, klidně i koberce, stroj to zvládne.', b: -1, r: 'To mě zrovna neuklidnilo.' },
    ] },
    { t: 'Proč ne?', o: [
      { t: 'Je to tak doporučené.', b: 0, r: 'Ale proč?' },
      { t: 'Zbytky oleje se v horkém bubnu můžou vznítit. Nechte je doschnout na vzduchu, je to bezpečnější.', b: 2, r: 'To jsem netušil, díky.' },
      { t: 'Protože by to smrdělo.', b: -1, r: 'To mi nepřijde jako důvod.' },
    ] },
    { t: 'A nezanesu tím stroj ostatním?', o: [
      { t: 'Ne, stroj po vás buben vypláchne.', b: 2, r: 'Dobře, díky.' },
      { t: 'Trochu jo, ale to nikdo nepozná.', b: -2, r: 'To se mi vůbec nelíbí.' },
      { t: 'Těžko říct, to vám takhle po telefonu nepovím.', b: -1, r: 'Vy to nevíte?' },
    ] },
  ] },
  { id: 'koberec', rod: 'm', kroky: [
    { t: 'Vejde se do vaší pračky předložka z koupelny?', o: [
      { t: 'Látková ano. Gumová ne, ta se v bubnu drolí.', b: 2, r: 'Ta moje je látková.' },
      { t: 'Nevejde.', b: -1, r: 'Ani malá?' },
      { t: 'To záleží na tom, jak je velká, jak je těžká, kolik nasákne a co má na spodní straně.', b: 0, r: 'Je to obyčejná předložka.' },
    ] },
    { t: 'Ta moje je látková, metr na půl metru.', o: [
      { t: 'Tak to jde.', b: 1, r: 'Fajn.' },
      { t: 'V pohodě. Dejte ji samotnou, nasákne hodně vody a s dalším prádlem by stroj nestíhal.', b: 2, r: 'Dobře, vezmu ji zvlášť.' },
      { t: 'Zkuste to a uvidíte.', b: -1, r: 'Radši bych to věděl předem.' },
    ] },
    { t: 'A usuším ji u vás?', o: [
      { t: 'Ano, na nižší teplotu a déle.', b: 2, r: 'Jasné, děkuju.' },
      { t: 'Sušička je na prádlo, ne na koberce.', b: -1, r: 'Vždyť jste říkal, že se to vyprat dá.' },
      { t: 'To už je na vás.', b: -2, r: 'Ptám se vás, vy to tam provozujete.' },
    ] },
  ] },
  { id: 'proud', rod: '', kroky: [
    { t: 'Uprostřed praní vypadl proud a stroj stojí s mým prádlem uvnitř.', o: [
      { t: 'Odemknu vám dvířka na dálku. Vydržte minutu.', b: 2, r: 'Děkuju!' },
      { t: 'To je výpadek u distributora, s tím nic nenadělám.', b: -2, r: 'A moje prádlo?' },
      { t: 'Počkejte, až se to rozjede — stroj si pamatuje, kde skončil, a dopere to sám, i když to může chvíli trvat.', b: 1, r: 'Tak počkám.' },
    ] },
    { t: 'A dopere se to, nebo začínám znovu?', o: [
      { t: 'Dopere.', b: 1, r: 'Tak jo.' },
      { t: 'Naváže tam, kde skončil. A kdyby ne, pustím vám celý cyklus znovu a zdarma.', b: 2, r: 'To je fér.' },
      { t: 'To vám neřeknu.', b: -2, r: 'Vy jste ta infolinka, ne?' },
    ] },
    { t: 'A stává se to často?', o: [
      { t: 'Ne. Za celý rok podruhé.', b: 2, r: 'Tak to beru.' },
      { t: 'Občas se to stane, na té lokalitě je to dané.', b: -1, r: 'To nezní dobře.' },
      { t: 'Elektřina je u nás vůbec problém, loni jsme to řešili snad pětkrát.', b: -2, r: 'Tak to tam radši prát nebudu.' },
    ] },
  ] },
  { id: 'sleva', rod: '', kroky: [
    { t: 'Chodím k vám třikrát týdně. Nemáte něco pro stálé zákazníky?', o: [
      { t: 'Můžu vám založit předplacený kredit se slevou. Chcete?', b: 2, r: 'To zní dobře.' },
      { t: 'Nemáme.', b: -1, r: 'Škoda.' },
      { t: 'Slevy nedáváme, cena je pro všechny stejná, a kdybychom slevili jednomu, chtěli by to hned všichni.', b: -1, r: 'Nemusíte mi vysvětlovat ekonomiku.' },
    ] },
    { t: 'A kolik by ta sleva byla?', o: [
      { t: 'Pár procent.', b: 0, r: 'Kolik přesně?' },
      { t: 'Při dobití na deset praní desetina dolů. Kredit nepropadá, zůstane vám, dokud ho nevyberete.', b: 2, r: 'Tak to beru.' },
      { t: 'To ještě vymyslíme.', b: -1, r: 'Radši bych slyšel číslo.' },
    ] },
    { t: 'A platí to i na sušičku?', o: [
      { t: 'Platí, na obojí.', b: 2, r: 'Výborně.' },
      { t: 'Zatím jen na praní, sušičku jsme do toho nedali.', b: 0, r: 'Aha, tak dobře.' },
      { t: 'To nevím, musel bych se podívat, jak to máme nastavené v systému.', b: -1, r: 'Tak mi zavolejte, až to budete vědět.' },
    ] },
  ] },
  { id: 'parkovani', rod: 'm', kroky: [
    { t: 'Dá se u vašeho automatu zaparkovat? Vozím prádlo autem.', o: [
      { t: 'Jsou tam dvě místa přímo u stroje, většinou bývá volno.', b: 2, r: 'Tak to je dobré.' },
      { t: 'Nevím.', b: -2, r: 'To je přece vaše místo.' },
      { t: 'Parkování neřešíme, to je věc města a my k tomu nemáme co říct.', b: -1, r: 'Ptám se prakticky, ne úředně.' },
    ] },
    { t: 'A v sobotu, když je vedle trh?', o: [
      { t: 'To bude horší.', b: 0, r: 'Tak kdy teda?' },
      { t: 'V sobotu dopoledne je plno. Kdybyste přijel po poledni, máte to tam volné.', b: 2, r: 'Díky, zařídím se podle toho.' },
      { t: 'Tak přijeďte jindy.', b: -1, r: 'Děkuju za radu.' },
    ] },
    { t: 'A zastavit aspoň na chvíli u dvířek?', o: [
      { t: 'To jde, na vyložení to tam stačí.', b: 2, r: 'Super.' },
      { t: 'Stát tam nesmíte, je tam zákaz, to snad víte.', b: -1, r: 'Ani na minutu?' },
      { t: 'Nedoporučuju, chodí tam strážníci a pokutují.', b: 1, r: 'Dobře, že to vím.' },
    ] },
  ] },
  { id: 'svatba', rod: 'z', kroky: [
    { t: 'Zítra se vdávám a na šatech mám flek od vína. Zvládne to váš automat?', o: [
      { t: 'Svatební šaty bych do automatu nedávala. Zkuste čistírnu, tohle je na ruční práci.', b: 2, r: 'Děkuju za upřímnost.' },
      { t: 'Jasně, hoďte to tam, program na jemné to dá.', b: -2, r: 'A když to zničím, co pak?' },
      { t: 'To záleží na materiálu.', b: 0, r: 'Je to hedvábí.' },
    ] },
    { t: 'A kdybych to jen vymáchala, abych to měla aspoň svěží?', o: [
      { t: 'Když to musí být dneska, dejte ruční program na dvacet stupňů bez odstřeďování. Ale ten flek to nevezme.', b: 2, r: 'Dobře, zkusím to opatrně.' },
      { t: 'To je jedno, máchání je máchání.', b: -1, r: 'Tak to mi moc nepomohlo.' },
      { t: 'Radši nic.', b: 0, r: 'Hm.' },
    ] },
    { t: 'A sušičku na to pustit můžu?', o: [
      { t: 'V žádném případě. Hedvábí v sušičce se srazí a je po šatech.', b: 2, r: 'Tak to teda ne. Díky!' },
      { t: 'Chvilku na nejnižší teplotu klidně.', b: -2, r: 'Vy mi ty šaty chcete zničit?' },
      { t: 'To už je na vás.', b: -1, r: 'Ptám se, protože vy tomu máte rozumět.' },
    ] },
  ] },
  { id: 'nocni', rod: 'm', kroky: [
    { t: 'Dělám na nočních. Dostanu se k vám ve tři ráno?', o: [
      { t: 'Dostanete, je to nonstop. Odemyká se kartou nebo přes aplikaci.', b: 2, r: 'To je přesně to, co potřebuju.' },
      { t: 'V noci tam radši nechoďte.', b: -2, r: 'Tak proč to máte otevřené?' },
      { t: 'Otevřeno je pořád, ale v noci tam nikdo není.', b: 0, r: 'To mi je jasné, je to samoobsluha.' },
    ] },
    { t: 'A je tam v noci vidět? Nerad bych tam šmátral po tmě.', o: [
      { t: 'Světlo se rozsvítí na pohyb a svítí celý cyklus.', b: 2, r: 'Výborně.' },
      { t: 'Vezměte si baterku.', b: -2, r: 'To myslíte vážně?' },
      { t: 'Něco tam svítí.', b: -1, r: 'Tak to zní nejistě.' },
    ] },
    { t: 'A kdyby se to v noci zaseklo, komu volám?', o: [
      { t: 'Mně. Tohle číslo bere člověk i ve tři ráno.', b: 2, r: 'Tak to je slovo do pranice. Díky.' },
      { t: 'Napište nám mail, ráno to vyřídíme.', b: -1, r: 'A co mám do rána dělat s mokrým prádlem?' },
      { t: 'V noci nikdo nebere, ale stroj si to pamatuje a ráno to doběhne.', b: -1, r: 'Hm, uvidím.' },
    ] },
  ] },
  { id: 'ztrata', rod: 'z', kroky: [
    { t: 'Zapomněla jsem si u vás prádlo v bubnu, byla jsem tam před hodinou.', o: [
      { t: 'Podívám se do systému, který stroj to byl, a zamknu ho, dokud nedorazíte.', b: 2, r: 'To jste mě zachránil.' },
      { t: 'To už tam asi nebude.', b: -2, r: 'Vy mě fakt umíte uklidnit.' },
      { t: 'Zajeďte se tam podívat.', b: 0, r: 'To jsem chtěla udělat tak jako tak.' },
    ] },
    { t: 'A co když to někdo vyndal? Byly tam dětské věci.', o: [
      { t: 'Vyndané prádlo dáváme do boxu vedle stroje, nikdo s tím neodchází.', b: 2, r: 'Tak to se mi ulevilo.' },
      { t: 'Za věci v automatu neručíme, to je v podmínkách.', b: -2, r: 'Ptám se, co s tím uděláte, ne co nemusíte.' },
      { t: 'Většinou se nic neztratí.', b: 0, r: 'Většinou.' },
    ] },
    { t: 'A co mi poradíte, abych to zas nezapomněla?', o: [
      { t: 'Zapněte si v aplikaci upozornění na konec praní. Pípne vám to.', b: 2, r: 'To si nastavím hned.' },
      { t: 'Prostě si to pamatujte.', b: -2, r: 'Děkuju za radu.' },
      { t: 'Dejte si budík v telefonu.', b: 1, r: 'To není špatný nápad.' },
    ] },
  ] },
  { id: 'mince', rod: 'm', kroky: [
    { t: 'Stojím u automatu a nemám drobné. Bere to mince, nebo kartu?', o: [
      { t: 'Kartou i telefonem, mince nepotřebujete vůbec.', b: 2, r: 'Super, tak to zkusím.' },
      { t: 'Mince jsou jistota, zajeďte si vyměnit.', b: -2, r: 'Kam, ve čtvrt na deset večer?' },
      { t: 'Obojí, jak chcete.', b: 1, r: 'Tak dobře.' },
    ] },
    { t: 'A nestrhne mi to víc, než kolik propeřu?', o: [
      { t: 'Předautorizuje se vyšší částka a zbytek se vrátí do dvou dnů. Zaplatíte jen to, co propral.', b: 2, r: 'Aha, tak to je v pořádku.' },
      { t: 'To se nám občas stane.', b: -2, r: 'Tak to radši nezkouším.' },
      { t: 'Strhne přesně cenu programu.', b: 1, r: 'Dobře.' },
    ] },
    { t: 'A kdyby to platbu nevzalo?', o: [
      { t: 'Zkuste to ještě jednou a pak mi zavolejte, pustím vám stroj na dálku.', b: 2, r: 'To je služba.' },
      { t: 'To se stát nemůže.', b: -1, r: 'Všechno se může stát.' },
      { t: 'Terminál občas vypadne, to je signálem.', b: -1, r: 'Takže mám smůlu?' },
    ] },
  ] },
  { id: 'voda', rod: '', kroky: [
    { t: 'Kolem vašeho automatu je louže. Teče to z něj?', o: [
      { t: 'Díky, že voláte. Posílám tam technika a stroj zatím odstavím.', b: 2, r: 'Tak to je rychlovka, díky.' },
      { t: 'To bude po někom jiném.', b: -2, r: 'A kdyby ne?' },
      { t: 'Občas tam zůstane voda po vypouštění.', b: 0, r: 'Je toho dost.' },
    ] },
    { t: 'Můžu ten stroj zatím používat, nebo se mi to vylije?', o: [
      { t: 'Nepoužívejte ho. Vedle je druhý, ten je v pořádku.', b: 2, r: 'Tak zkusím ten.' },
      { t: 'Klidně perte, voda nikomu neublížila.', b: -2, r: 'A když se zkratuje?' },
      { t: 'Já bych to risknul.', b: -2, r: 'Já teda ne.' },
    ] },
    { t: 'A dostanu něco za to, že jsem vám to nahlásil?', o: [
      { t: 'Praní zdarma, pošlu vám kód do zprávy. Díky, bez vás bych se to dozvěděl až od technika.', b: 2, r: 'To mě potěšilo.' },
      { t: 'To po nás nikdo nemůže chtít.', b: -2, r: 'Já nic nechtěl, jen se ptám.' },
      { t: 'Nic takového nemáme, ale díky.', b: 0, r: 'Budiž.' },
    ] },
  ] },
  { id: 'prasek', rod: 'z', kroky: [
    { t: 'Jaký prášek tam dáváte? Mám citlivou pokožku a nesnesu silné parfémy.', o: [
      { t: 'Jede tam neparfémovaná drogerie. Složení vám pošlu, ať si to můžete ověřit.', b: 2, r: 'To jste hodný, děkuju.' },
      { t: 'Běžný prášek jako všude.', b: -1, r: 'To mi nic neříká.' },
      { t: 'To fakt nevím, to řeší kolega.', b: -2, r: 'Tak mě s ním spojte.' },
    ] },
    { t: 'A můžu si přinést vlastní?', o: [
      { t: 'Můžete, je tam přihrádka. Dávkujte polovinu, stroje berou míň než domácí pračka.', b: 2, r: 'Perfektní, tak to udělám.' },
      { t: 'To nejde, systém dávkuje sám.', b: -1, r: 'Škoda.' },
      { t: 'Vlastní prášky zakazujeme, ničí nám to stroje.', b: -2, r: 'Tak já zas ničím vaše stroje.' },
    ] },
    { t: 'A proplachuje se to mezi zákazníky, nebo peru v cizí pěně?', o: [
      { t: 'Po každém cyklu jede proplach čistou vodou, a jednou týdně dezinfekce bubnu.', b: 2, r: 'To jsem chtěla slyšet.' },
      { t: 'Voda je voda.', b: -2, r: 'To je dost nechutná odpověď.' },
      { t: 'Buben se proplachuje, to je v pořádku.', b: 1, r: 'Dobře.' },
    ] },
  ] },
  { id: 'kolo', rod: 'm', kroky: [
    { t: 'Přijel jsem z vyjížďky, dres a bunda jsou od bláta. Dá se to u vás vyprat?', o: [
      { t: 'Dá, jen nejdřív oklepejte hrubé bláto venku — jinak to jde do filtru.', b: 2, r: 'Tak to udělám.' },
      { t: 'Zablácené věci do automatu nepatří.', b: -2, r: 'A kam teda patří?' },
      { t: 'Hoďte to tam, to je jedno.', b: -1, r: 'Nechci vám zanést stroj.' },
    ] },
    { t: 'A membránovou bundu to nezničí? Stála pět tisíc.', o: [
      { t: 'Dejte třicet stupňů, žádnou aviváž a nízké odstřeďování. Membrána to vydrží.', b: 2, r: 'Díky, to jsem potřeboval.' },
      { t: 'Membrány se do automatu nedávají.', b: -1, r: 'Tak to si vyperu doma.' },
      { t: 'To vám neřeknu, to je na výrobci.', b: 0, r: 'Hm.' },
    ] },
    { t: 'A batoh? Je po něm celé auto.', o: [
      { t: 'Batoh vyndejte z rámu, zapněte všechny zipy a dejte na jemné. Sušičku ne, to by roztavilo zipy.', b: 2, r: 'Jasně, díky za tip.' },
      { t: 'Batohy neperte, zničí se.', b: 0, r: 'Takže mám smůlu.' },
      { t: 'To je mi jedno, zaplaceno máte.', b: -2, r: 'Tak to přeju hezký den.' },
    ] },
  ] },
  { id: 'zdrazeni', rod: '', kroky: [
    { t: 'Minule jsem platil míň. Vy jste zdražili?', o: [
      { t: 'Zdražili, o deset korun za cyklus. Šla nahoru voda a elektřina, dýl už jsme to držet nemohli.', b: 2, r: 'Aspoň to říkáte na rovinu.' },
      { t: 'Ceny jsou pořád stejné.', b: -2, r: 'Mám účtenku, na které to je jinak.' },
      { t: 'To rozhoduje vedení.', b: -1, r: 'Vy jste vedení, ne?' },
    ] },
    { t: 'A to jste nemohli dát vědět dopředu?', o: [
      { t: 'Máte pravdu, mělo to viset na dveřích týden předem. Příště to tak bude.', b: 2, r: 'Tak dobře.' },
      { t: 'Cedule tam visela.', b: -1, r: 'Nevšiml jsem si.' },
      { t: 'To nikdo nedělá.', b: -2, r: 'Slušní lidi to dělají.' },
    ] },
    { t: 'Nemáte něco pro ty, co k vám chodí pravidelně?', o: [
      { t: 'Kredit na deset praní, tam je cena pořád ta stará. Můžu vám ho založit teď.', b: 2, r: 'Tak to beru.' },
      { t: 'Nemáme a mít nebudeme.', b: -2, r: 'Příště zkusím konkurenci.' },
      { t: 'Něco chystáme.', b: 0, r: 'Dejte vědět.' },
    ] },
  ] },
  { id: 'deti', rod: 'z', kroky: [
    { t: 'U vašeho automatu si hrají děti, lezou do bubnu. Víte o tom?', o: [
      { t: 'Nevěděl, díky. Dám tam zámek dvířek mimo cyklus a zajedu se tam podívat.', b: 2, r: 'To je dobře.' },
      { t: 'Za cizí děti neručíme.', b: -2, r: 'Jde o to, aby se nikomu nic nestalo.' },
      { t: 'To mají hlídat rodiče.', b: -1, r: 'To jistě, ale stroj je váš.' },
    ] },
    { t: 'A jdou ta dvířka zevnitř otevřít?', o: [
      { t: 'Jdou. Zámek drží jen při běhu a při výpadku proudu se sám rozepne.', b: 2, r: 'To jsem chtěla slyšet.' },
      { t: 'To jsem nikdy nezkoušel.', b: -1, r: 'Tak to zkuste.' },
      { t: 'Zevnitř ne, ale tam se nikdo nevejde.', b: -2, r: 'Osmiletý kluk se vejde.' },
    ] },
    { t: 'Nechcete tam dát cedulku, ať to vidí i rodiče?', o: [
      { t: 'Dobrý nápad, objednám ji ještě dnes. Díky za postrčení.', b: 2, r: 'Není zač.' },
      { t: 'Cedulky nikdo nečte.', b: -1, r: 'Některé se čtou.' },
      { t: 'Máme tam dost cedulí.', b: -2, r: 'Tak nashledanou.' },
    ] },
  ] },
  { id: 'klub', rod: 'm', kroky: [
    { t: 'Vedu fotbalový klub, dvacet dresů každý týden. Dá se to u vás domluvit?', o: [
      { t: 'Dá. Udělám vám klubový kredit a ukážu, jak to naskládat do dvou strojů.', b: 2, r: 'To by nám hodně pomohlo.' },
      { t: 'Přijďte a plaťte jako každý.', b: -1, r: 'Ptám se, jestli to jde domluvit.' },
      { t: 'Velké zakázky neděláme.', b: -2, r: 'Dvacet dresů není velká zakázka.' },
    ] },
    { t: 'A kdy máte nejmíň lidí? Nechci blokovat celou provozovnu.', o: [
      { t: 'V úterý a ve středu dopoledne tam nikdo není. Vezměte to tehdy.', b: 2, r: 'Zapíšu si to.' },
      { t: 'Pořád je to plné.', b: -1, r: 'To mi nepomohlo.' },
      { t: 'To se nedá říct.', b: 0, r: 'Hm.' },
    ] },
    { t: 'A dostanu na to fakturu pro klub?', o: [
      { t: 'Měsíční, se vším, co klub propere. Pošlu ji mailem.', b: 2, r: 'Perfektní, domluveno.' },
      { t: 'Faktury neděláme.', b: -2, r: 'Tak to si klub neproplatí.' },
      { t: 'To musíte řešit přes účetní.', b: -1, r: 'Volám vám, ne účetní.' },
    ] },
  ] },
  { id: 'qr', rod: 'z', kroky: [
    { t: 'Načetla jsem QR kód telefonem a nic se nestalo. Platba neprošla.', o: [
      { t: 'Vidím to v systému — platba se zasekla na půl cesty a nic se nestrhlo. Pustím vám stroj ručně.', b: 2, r: 'To je rychlé, děkuju.' },
      { t: 'To bude vaší bankou.', b: -2, r: 'Zkoušela jsem to dvakrát.' },
      { t: 'Zkuste to ještě jednou.', b: -1, r: 'A když se to strhne dvakrát?' },
    ] },
    { t: 'A nestrhne se mi to nakonec dvakrát?', o: [
      { t: 'Když to projde dvakrát, jednu platbu vám vrátím a ozvu se vám sama.', b: 2, r: 'Dobře, spoléhám na vás.' },
      { t: 'To se nestává.', b: -1, r: 'Mně se právě stalo.' },
      { t: 'To si pak musíte vyřídit s bankou.', b: -2, r: 'To je ale vaše platební brána.' },
    ] },
    { t: 'A nemáte to raději na kartu? Tomu rozumím líp.', o: [
      { t: 'Terminál je přímo na stroji, přiložíte kartu a jede to. QR je jen pro ty, co nechtějí tahat peněženku.', b: 2, r: 'Tak příště kartou.' },
      { t: 'QR je moderní, zvykejte si.', b: -2, r: 'Já si zvyknu na konkurenci.' },
      { t: 'Obojí funguje stejně.', b: 0, r: 'To zjevně ne.' },
    ] },
  ] },
  { id: 'cekani', rod: 'm', kroky: [
    { t: 'Stojím u vás a všechny stroje běží. Jak dlouho mám čekat?', o: [
      { t: 'Koukám do systému: ten vlevo končí za jedenáct minut, druhý za dvacet.', b: 2, r: 'Tak to počkám, díky.' },
      { t: 'To vám neřeknu.', b: -2, r: 'Vždyť to musíte vidět.' },
      { t: 'Chvilku to potrvá.', b: -1, r: 'Chvilku je kolik?' },
    ] },
    { t: 'A dá se to nějak zamluvit dopředu, ať nejezdím zbytečně?', o: [
      { t: 'Rezervace neděláme, ale v aplikaci vidíte, co je volné, než vyrazíte.', b: 2, r: 'To mi stačí.' },
      { t: 'Ne.', b: -1, r: 'Aha.' },
      { t: 'Rezervujte si to u konkurence.', b: -2, r: 'To nebyla moc chytrá odpověď.' },
    ] },
    { t: 'A co když si někdo nechá prádlo ve stroji a nejde pro něj?', o: [
      { t: 'Můžete ho vyndat do boxu vedle. Majiteli chodí upozornění, většinou dorazí do deseti minut.', b: 2, r: 'Rozumím, tak to zkusím.' },
      { t: 'Do cizího prádla nesahejte.', b: -1, r: 'A co mám dělat?' },
      { t: 'Tak si počkejte.', b: -2, r: 'Hezky jste mi poradil.' },
    ] },
  ] },
];
function povest() { return Math.max(-100, Math.min(100, (S && S.povest) || 0)); }
// Násobitel návštěvnosti podle pověsti. Nula je normál, záporná pověst bolí víc,
// než kladná pomůže — špatná pověst se roznese rychleji.
function povestKoef() {
  var p = povest();
  return 1 + (p < 0 ? p / 100 * POVEST_DOLU : p / 100 * POVEST_NAHORU);
}
// Hodnocení, jaké hráči dávají zákazníci: jedna až pět hvězdiček po desetinách.
// Mizerná pověst je jedna hvězda, nedotčená tři, nejlepší pět.
function hvezdy() {
  return Math.round((3 + povest() / 50) * 10) / 10;
}
function hvezdyText(h) {
  return (h == null ? hvezdy() : h).toFixed(1).replace('.', ',') + ' ★';
}
function povestSlovy() {
  var p = povest();
  if (p >= 60) return 'výborná';
  if (p >= 20) return 'dobrá';
  if (p > -20) return 'průměrná';
  if (p > -60) return 'špatná';
  return 'mizerná';
}
function zmenPovest(o) {
  S.povest = Math.max(-100, Math.min(100, povest() + o));
}
// Kolik pověsti doopravdy udělá jedna odpověď. Počítá se po odpovědích, ne až
// ze součtu — jinak by se jedna hrubost schovala za dvě vlídné věty.
function povestZaOdpoved(b) {
  return (b > 0 ? b * POVEST_RUST : b * POVEST_PAD);
}
// Další hovor naplánujeme na náhodnou dobu strávenou ve hře.
function naplanujHovor() {
  S.hovorZa = HOVOR_ZA_MIN + Math.random() * (HOVOR_ZA_MAX - HOVOR_ZA_MIN);
}
var HOVOR = null;                // { jmeno, scenar, kroky, poradi, i, body, prepis, ceka, stav, zvoniDo }
// Jeden hovor je jeden rozhovor na jedno téma — zákazník se dál ptá podle toho,
// co už padlo. Poslední rozhovory přeskočíme, ať se nevrací hned dokola.
// Jméno volajícího musí sedět s tím, jak o sobě v rozhovoru mluví — u scénáře,
// kde zákazník říká „prala jsem“, nemůže volat pan.
// Jméno volajícího se nesmí vracet pořád dokola — posledních pár desítek si
// hra pamatuje a vybírá jen ze zbytku. Kdyby se fond vyčerpal, bere se celý.
function hovorJmeno(rod) {
  var fond = rod === 'z' ? HOVOR_ZENY
    : (rod === 'm' ? HOVOR_MUZI : HOVOR_ZENY.concat(HOVOR_MUZI));
  var posl = S.jmenaPosl || [];
  var volne = fond.filter(function (j) { return posl.indexOf(j) < 0; });
  if (!volne.length) volne = fond;
  var jmeno = volne[Math.floor(Math.random() * volne.length)];
  S.jmenaPosl = posl.concat([jmeno]).slice(-JMEN_PAMET);
  return jmeno;
}
function vyberScenar() {
  var posl = S.hovoryPosl || [];
  var fond = HOVOR_SCENARE.filter(function (x) { return posl.indexOf(x.id) < 0; });
  if (!fond.length) fond = HOVOR_SCENARE.slice();
  return fond[Math.floor(Math.random() * fond.length)];
}
// Pořadí odpovědí se kříže pro každý krok zvlášť — aby ta správná nebyla
// pořád první. Délka odpovědi taky nic neprozrazuje, to hlídá už sama banka.
function zamichej(n) {
  var a = [], i, j, t;
  for (i = 0; i < n; i++) a.push(i);
  for (i = n - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
// Může to teď zazvonit? Ne během tutoriálu, ne když hráč píše nebo má otevřený
// panel, a ne když ještě nemá jediný prádlomat — to by neměl kdo volat.
function hovorLze() {
  return !!S && S.tut === 'done' && (S.units || []).length > 0 && !HOVOR
    && !document.hidden && !pisePrave()
    && $('sheet').classList.contains('hidden');
}
function hovorTik(dt) {
  if (!S || document.hidden) return;
  if (HOVOR) { hovorHlidej(); return; }
  if (S.tut !== 'done' || !(S.units || []).length) return;
  if (typeof S.hovorZa !== 'number') { naplanujHovor(); return; }
  S.hovorZa -= dt;
  if (S.hovorZa > 0) return;
  if (!hovorLze()) return;              // později to zazvoní znovu
  zacniHovor();
}
function zacniHovor() {
  var sc = vyberScenar();
  HOVOR = {
    jmeno: hovorJmeno(sc.rod),
    scenar: sc.id, kroky: sc.kroky,
    poradi: sc.kroky.map(function (k) { return zamichej(k.o.length); }),
    i: 0, body: 0, vaha: 0, odpovedi: [], prepis: [], ceka: false,
    hvPred: hvezdy(), stav: 'zvoni', zvoniDo: Date.now() + HOVOR_ZVONI_MS
  };
  S.hovoryPosl = (S.hovoryPosl || []).concat([sc.id]).slice(-SCENARU_PAMET);
  paintHovor();
}
function hovorHlidej() {
  if (!HOVOR || HOVOR.stav !== 'zvoni') return;
  if (Date.now() >= HOVOR.zvoniDo) { odmitniHovor(true); return; }
  // Překreslit celé okno by pokaždé restartovalo pulzování telefonu — za běhu
  // zvonění tedy měníme jen odpočet.
  var od = $('hov-odpocet');
  if (od) od.textContent = String(Math.max(0, Math.ceil((HOVOR.zvoniDo - Date.now()) / 1000)));
  else paintHovor();
}
function odmitniHovor(samo) {
  if (!HOVOR) return;
  zmenPovest(povestZaOdpoved(HOVOR_ODMITNUTI));
  S.hovoru = (S.hovoru || 0) + 1;
  HOVOR = null;
  naplanujHovor();
  zavriHovor();
  save(); paint(); syncState(true);
  toast(samo ? 'Zákazník se nedčekal a položil to. Pověst klesla.'
             : 'Hovor jsi nevzal. Pověst klesla.', 'err');
}
function vezmiHovor() {
  if (!HOVOR) return;
  HOVOR.stav = 'hovor';
  HOVOR.prepis.push({ k: 'z', t: HOVOR.kroky[0].t });
  paintHovor();
}
// Hovor teče jako rozhovor: co hráč vybere, zůstane v přepisu, zákazník na to
// zareaguje a sam od sebe se pta dál. Mezi replikami je krátká pauza s tečkami,
// ať to neskače naráz. Body se během hovoru neukazují — zákazník taky neříká
// do telefonu, kolik zrovna přičetl; sečtou se až na konci.
var HOVOR_PAUZA_REAKCE = 700, HOVOR_PAUZA_OTAZKA = 900;
// i je pořadí tlačítka na obrazovce, ne pořadí v bance — přeložíme přes míchání.
function odpovez(i) {
  if (!HOVOR || HOVOR.stav !== 'hovor' || HOVOR.ceka) return;
  var h = HOVOR, o = h.kroky[h.i].o[h.poradi[h.i][i]];
  if (!o) return;
  h.body += o.b;
  h.vaha += povestZaOdpoved(o.b);
  h.odpovedi.push({ b: o.b, r: o.r });
  h.prepis.push({ k: 'ja', t: o.t });
  h.ceka = true;
  paintHovor();
  setTimeout(function () {
    if (HOVOR !== h) return;
    h.prepis.push({ k: 'z', t: o.r });
    paintHovor();
    setTimeout(function () { if (HOVOR === h) hovorDal(); }, HOVOR_PAUZA_OTAZKA);
  }, HOVOR_PAUZA_REAKCE);
}
// Další otázka, nebo konec hovoru — až tady se pověst opravdu mění.
function hovorDal() {
  if (!HOVOR) return;
  HOVOR.i++;
  HOVOR.ceka = false;
  if (HOVOR.i < HOVOR.kroky.length) {
    HOVOR.prepis.push({ k: 'z', t: HOVOR.kroky[HOVOR.i].t });
  } else {
    HOVOR.stav = 'konec';
    zmenPovest(HOVOR.vaha);
    S.hovoru = (S.hovoru || 0) + 1;
    save(); paint(); syncState(true);
  }
  paintHovor();
}
function zavesHovor() {
  HOVOR = null;
  naplanujHovor();
  zavriHovor();
  save(); paint(); syncState(true);
}
// Okno hovoru. Zvonění, otázka s třemi odpověďmi, reakce zákazníka a nakonec
// shrnutí. Všechno v jednom překryvu, ať je jasné, že se čeká právě na hráče.
function zavriHovor() {
  var el = $('hovor');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}
// Přepis rozhovoru: zákazník vlevo, hráčovy odpovědi vpravo. Na konci hovoru
// zůstává celý vidět, ať si hráč může přečíst, co vlastně nasliboval.
function hovorPrepis(h) {
  return '<div class="hov-prepis" id="hov-prepis">'
    + h.prepis.map(function (r) {
        return '<p class="hov-b ' + (r.k === 'ja' ? 'ja' : 'z') + '">' + esc(r.t) + '</p>';
      }).join('')
    + (h.ceka ? '<p class="hov-b z hov-pise"><i></i><i></i><i></i></p>' : '')
    + '</div>';
}
function hovorBtn(id, tr, text) {
  return '<button class="' + tr + '" id="' + id + '">' + text + '</button>';
}
function paintHovor() {
  var el = $('hovor');
  if (!el || !HOVOR) return;
  var h = HOVOR, html;
  if (h.stav === 'zvoni') {
    var zbyva = Math.max(0, Math.ceil((h.zvoniDo - Date.now()) / 1000));
    html = '<div class="hov-in zvoni">'
      + '<i class="hov-tel">📞</i>'
      + '<p class="hov-popis">Infolinka</p>'
      + '<h3>' + esc(h.jmeno) + '</h3>'
      + '<p class="hov-stav">volá … položí to za <b id="hov-odpocet">' + zbyva + '</b> s</p>'
      + '<div class="hov-tlacitka">'
      + hovorBtn('hov-ne', 'hov-kolo ne', '✕')
      + hovorBtn('hov-ano', 'hov-kolo ano', '✓')
      + '</div>'
      + '<p class="fine">Kdo hovory nebere, přichází o návštěvnost.</p></div>';
  } else if (h.stav === 'hovor') {
    html = '<div class="hov-in hov-chat">'
      + '<p class="hov-popis">' + esc(h.jmeno) + ' · infolinka</p>'
      + hovorPrepis(h)
      + (h.ceka ? '' : '<div class="hov-vyber"><p class="hov-popis">Co odpovíte?</p>'
          + '<div class="hov-odp">'
          + h.poradi[h.i].map(function (ix, i) {
              return '<button data-odp="' + i + '">' + esc(h.kroky[h.i].o[ix].t) + '</button>';
            }).join('')
          + '</div></div>')
      + '</div>';
  } else {
    var b = h.body;
    var zm = Math.round((h.vaha || 0) * 10) / 10;   // co to doopravdy udělalo s pověstí
    var tr2 = zm > 0 ? 'ok' : (zm < 0 ? 'err' : 'muted');
    var soud = b >= 6 ? 'Zákazník zavěsil nadšený a řekne to dál.'
      : b >= 2 ? 'Zákazník byl spokojený.'
      : b > -2 ? 'Zákazník zavěsil, ale nijak nadšený nebyl.'
      : b > -6 ? 'Zákazník odchází nespokojený.'
      : 'Zákazník prásknul telefonem. Tohle se roznese.';
    // Co hovor udělal, ukážeme v tom, čemu hráč rozumí: v hvězdičkách a
    // v návštěvnosti. Body pověsti se objeví jen jednou a rovnou se stupnicí,
    // ať je jasné, že jedna odpověď s tím pohne o kousek, ne o polovinu.
    var dh = Math.round((hvezdy() - h.hvPred) * 10) / 10;
    var navs = Math.round((povestKoef() - 1) * 1000) / 10;
    html = '<div class="hov-in hov-chat">'
      + '<p class="hov-popis">Hovor skončil</p>'
      + hovorPrepis(h)
      + '<p class="hov-stav ' + tr2 + '">' + soud + '</p>'
      + '<div class="kv"><span>Hodnocení zákazníků</span><b>' + hvezdyText()
      + (dh ? ' <span class="' + tr2 + '">(' + (dh > 0 ? '+' : '−')
          + Math.abs(dh).toFixed(1).replace('.', ',') + ')</span>' : '') + '</b></div>'
      + '<div class="kv"><span>Pověst</span><b>' + povestSlovy()
      + ' <span class="' + tr2 + '">(' + (zm > 0 ? '+' : (zm < 0 ? '−' : ''))
      + String(Math.abs(zm)).replace('.', ',') + ')</span></b></div>'
      + '<div class="kv"><span>Návštěvnost</span><b class="' + (povest() >= 0 ? 'ok' : 'err') + '">'
      + (navs >= 0 ? '+' : '−') + Math.abs(navs).toFixed(1).replace('.', ',') + ' %</b></div>'
      + '<p class="fine">Pověst jde od −100 do +100. Každý hovor s ní pohne o pár bodů '
      + 'a podle ní se počítá hodnocení zákazníků i návštěvnost prádlomatů.</p>'
      + '<button class="btn big" id="hov-konec" style="width:100%;margin-top:10px">Zavěsit</button></div>';
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  // Přepis dorůstá odspodu — vždy ukazujeme poslední repliku.
  var pr = $('hov-prepis');
  if (pr) pr.scrollTop = pr.scrollHeight;
  if ($('hov-ano')) $('hov-ano').onclick = vezmiHovor;
  if ($('hov-ne')) $('hov-ne').onclick = function () { odmitniHovor(false); };

  if ($('hov-konec')) $('hov-konec').onclick = zavesHovor;
  [].forEach.call(el.querySelectorAll('[data-odp]'), function (b2) {
    b2.onclick = function () { odpovez(Number(b2.getAttribute('data-odp'))); };
  });
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
// Dotazník se hráči ukáže až po prvním postaveném prádlomatu. Dřív stál hned
// na začátku a dokončilo ho jen sedm lidí ze sta — zbytek odešel dřív, než
// vůbec viděl mapu.
var DOTAZNIK_PO = false;
// Úvod → rovnou do hry. Profil se zatím nastaví na vyvážený; po prvním
// prádlomatu si ho hráč v dotazníku změní a rozdíl v hotovosti mu dorovnáme.
// ─── Bonus za rychlý start ───────────────────────────────────────────────────
// Na úvodce běží odpočet. Všechno ostatní — startovní kapitál, rámec, obhlídka
// zdarma i karty k účtu — dostane každý bez ohledu na čas; expirovat může jen
// tenhle jeden bonus, a ten opravdu expiruje. Slibovat, že propadne i zbytek,
// by byla lež, kterou hráč odhalí prvním obnovením stránky.
var START_BONUS = 150000;
var START_BONUS_MS = 60000;
var startBonusDo = 0;
function startBonusPlati() { return startBonusDo > 0 && Date.now() < startBonusDo; }
function startBonusOdpocet() {
  var cas = $('sb-cas'), pruh = $('sb-bonus'), bar = $('sb-bar'), suma = $('sb-suma');
  var pod = $('sb-bonus-pod'), hl = $('sb-bonus-hl'), box = $('sb'), hrat = $('go-quiz');
  if (!cas || !pruh) return;
  var zakladni = PROFILES.vyvazeny.cash;
  var hratText = hrat ? hrat.textContent : '';
  if (suma) suma.textContent = (zakladni + START_BONUS).toLocaleString('cs-CZ');
  if (hrat) hrat.textContent = 'Hrát a vzít ' + kcFull(START_BONUS);
  startBonusDo = Date.now() + START_BONUS_MS;
  var tik = function () {
    var zbyva = Math.max(0, startBonusDo - Date.now());
    var s = Math.ceil(zbyva / 1000);
    cas.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    if (bar) bar.style.width = Math.round(zbyva / START_BONUS_MS * 100) + '%';
    // Posledních deset vteřin odpočet tepe — je to jediná věc, co opravdu mizí.
    cas.classList.toggle('pulz', zbyva > 0 && zbyva <= 10000);
    if (pod && zbyva > 0) pod.textContent = 'Je tvůj, když začneš do ' + s + ' '
      + mn(s, 'vteřiny', 'vteřin', 'vteřin');
    if (zbyva > 0) return;
    clearInterval(t);
    cas.textContent = 'vypršel';
    cas.classList.remove('pulz');
    cas.classList.add('pryc');
    pruh.classList.add('pryc');
    if (box) box.classList.add('pryc');
    if (hl) hl.textContent = 'Bonus za rychlý start propadl';
    if (pod) pod.textContent = 'Všechno ostatní dostaneš pořád.';
    if (suma) suma.textContent = zakladni.toLocaleString('cs-CZ');
    if (hrat) hrat.textContent = hratText || 'Hrát — bez registrace';
  };
  var t = setInterval(tik, 250);
  tik();
}

// Kdo klepl na tlačítko včas, bonus má — i když se pak ještě chvíli pere
// s obsazeným jménem. Odpočet ho za to trestat nebude.
var BONUS_ZAMCEN = false;
function introErr(t) {
  var e = $('in-err');
  if (!e) return toast(t, 'err');
  e.textContent = t; e.classList.remove('hidden');
}
// Vlastní hra. Volá se, až když je jasné, pod jakým jménem hráč hraje —
// nebo když se server neozval a hrát se musí i tak.
function spustNovouHru() {
  var bonus = BONUS_ZAMCEN;
  S = fresh('vyvazeny');
  if (bonus) S.cash += START_BONUS;
  save();
  startGame();
  if (bonus) {
    zapis('bonus', 'Bonus za rychlý start', START_BONUS);
    save(); paint();
    toast('Stihl jsi to! Bonus za rychlý start +' + kcFull(START_BONUS) + '.', 'ok');
  }
  if (ME) syncState(true);
}
$('go-quiz').onclick = function () {
  var b = $('go-quiz');
  var nick = ($('in-nick') ? $('in-nick').value : '').trim();
  var firma = ($('in-firma') ? $('in-firma').value : '').trim();
  if (nick.length < 3) return introErr('Vymysli si jméno, aspoň tři znaky. Pod ním budeš hrát.');
  if (nick.length > 24) return introErr('Jméno je moc dlouhé — nejvýš 24 znaků.');
  if (/[\s@]/.test(nick)) return introErr('Ve jménu nesmí být mezery ani zavináč.');
  if (firma.length === 1) return introErr('Název společnosti má aspoň dva znaky — nebo ho nech prázdný.');
  if ($('in-err')) $('in-err').classList.add('hidden');
  if (startBonusPlati()) BONUS_ZAMCEN = true;
  b.disabled = true; b.textContent = 'Zakládám firmu…';
  apiJson('/account/zacni', { nick: nick, company: firma, ref: trvalePid(),
    odkud: prichoziRef(), zdroj: zjistiZdroj(), sid: visitId() }).then(function (r) {
    b.disabled = false; b.textContent = 'Začít hrát';
    if (!r.ok) {
      // Obsazené jméno nebo překlep řešíme na místě — hra ještě nezačala.
      if (r.status === 409 || r.status === 400 || r.status === 429) {
        if (r.status === 409 && $('in-nick')) {
          $('in-nick').value = nick + Math.floor(10 + Math.random() * 90);
          $('in-nick').focus();
        }
        return introErr(r.j.error || 'Nepovedlo se.');
      }
      // Jiná chyba serveru hráče nesmí zastavit — hraje a účet doplní později.
      return spustNovouHru();
    }
    ME = r.j.player;
    srovnejRef();
    POZVANI = null;
    ev('game_register');
    spustNovouHru();
  }).catch(function () {
    // Server mlčí. Hrát se dá i bez účtu, jméno si vyžádáme, až bude odpovídat.
    b.disabled = false; b.textContent = 'Začít hrát';
    spustNovouHru();
  });
};
// Profil se mění za běhu — hráč už hraje, tak mu hotovost nikdy nebereme.
function nastavProfil(id) {
  var stary = PROFILES[S.profile] || PROFILES.vyvazeny, novy = PROFILES[id];
  if (!novy) return 0;
  var pridat = Math.max(0, novy.cash - stary.cash);
  S.profile = id;
  S.profilVybran = 1;
  if (pridat) { S.cash += pridat; zapis('bonus', 'Startovní kapitál — ' + novy.name, pridat); }
  save(); paint();
  return pridat;
}
function otevriDotaznik() {
  if (!S || S.profilVybran) return;
  DOTAZNIK_PO = true;
  qi = 0; qScore = { opatrny: 0, vyvazeny: 0, dravy: 0 };
  closeSheet();
  $('app').classList.add('hidden');
  $('quiz').classList.remove('hidden');
  renderQuiz();
}
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
  // Po prvním prádlomatu už hráč hotovost má — ukážeme, co dostane navíc.
  var popisek = $('role-cash').parentNode.firstChild;
  if (DOTAZNIK_PO) {
    var stary0 = PROFILES[S && S.profile] || PROFILES.vyvazeny;
    if (popisek) popisek.textContent = 'Hotovost navíc';
    $('role-cash').textContent = kcFull(Math.max(0, p.cash - stary0.cash));
  } else {
    if (popisek) popisek.textContent = 'Startovní hotovost';
    $('role-cash').textContent = kcFull(p.cash);
  }
  $('role-ltv').textContent = Math.round(p.ltv * 100) + ' % z ceny';
  $('role-rate').textContent = (p.rate * 100).toFixed(1).replace('.', ',') + ' % ročně';
  // Kdo je přihlášený (třeba po „začít znovu"), už účet zakládat nemusí.
  var hint = $('role-acct');
  if (hint) hint.innerHTML = ME ? 'Hraješ jako <b>' + esc(ME.nick) + '</b>.' : '';
  $('go-game').onclick = function () {
    // Po prvním prádlomatu jen přepneme profil rozehrané hře.
    if (DOTAZNIK_PO) {
      nastavProfil(id);
      $('role').classList.add('hidden');
      if (!ME) return showAcct('register');
      startGame(); syncState(true);
      // Účet má jméno, ale ještě ne heslo — teď je ta chvíle, kdy má co ztratit.
      if (!ME.ma_heslo) setTimeout(hesloSheet, 1200);
      return;
    }
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
  // noWrap: svět se na šířku neopakuje — už tak se z dálky kouká na glóbus.
  baseLayer = L.tileLayer(b.url, Object.assign({ noWrap: true }, b.opts)).addTo(map);
  if (b.labels) labelLayer = L.tileLayer(b.labels, { maxZoom: b.opts.maxZoom,
    maxNativeZoom: b.opts.maxNativeZoom, opacity: 0.9, noWrap: true }).addTo(map);
  baseLayer.on('tileerror', function () {
    tileErrs++;
    // Pár chybějících dlaždic je při rolování normální; až když padá celá vrstva, zkusíme další zdroj.
    if (tileErrs > 6 && baseIdx < BASEMAPS.length - 1) { baseIdx++; addBasemap(); }
  });
}
// ─── Glóbus ──────────────────────────────────────────────────────
// Oddálená mapa se rozloží do plochy a vypadá to divně. Místo toho se z dálky
// ukáže planeta: pravopísná ortografická projekce do canvasu, obrysy pevnin
// jsou v svet.js. Tažením se glóbus točí, klepnutím hra zaletí na to místo.
var GLOBUS_ZOOM = 4;              // pod tímhle přiblížením už mapa není k ničemu
var GLOBUS_PRILET = 6;            // kam hra zaletí, když na glóbus klepneš
var G = { on: false, lam: 0.26, phi: 0.87, r: 0, cx: 0, cy: 0, body: [] };
function globusJe() { return G.on; }
// Střed, na který glóbus kouká při otevření: sídlo, jinak první stroj, jinak Evropa.
function globusStred() {
  if (S && S.sidlo && S.sidlo.lat != null) return { lat: S.sidlo.lat, lon: S.sidlo.lon };
  var u = (S && S.units || []).filter(function (x) { return x.lat != null; })[0];
  if (u) return { lat: u.lat, lon: u.lon };
  return { lat: 50, lon: 15 };
}
function globusOtevri() {
  var st = globusStred();
  G.lam = st.lon * Math.PI / 180;
  G.phi = st.lat * Math.PI / 180;
  G.on = true;
  $('globus').classList.remove('hidden');
  $('globus-zpet').classList.remove('hidden');
  $('open-areas').classList.add('hidden');
  $('map-globus').classList.add('on');
  globusKresli();
}
function globusZavri() {
  G.on = false;
  $('globus').classList.add('hidden');
  $('globus-zpet').classList.add('hidden');
  $('open-areas').classList.remove('hidden');
  $('map-globus').classList.remove('on');
}
// Body na kouli: moje stavby, základny a (když nejsou schované) konkurence.
function globusBody() {
  var b = [];
  (S.units || []).forEach(function (u) {
    if (u.lat == null) return;
    b.push({ lat: u.lat, lon: u.lon, barva: jeVPoruse(u) ? '#ff5d6c' : '#2fe3a0', r: 4, u: u });
  });
  if (S.sidlo && S.sidlo.lat != null) b.push({ lat: S.sidlo.lat, lon: S.sidlo.lon, barva: '#4fd1ff', r: 5 });
  (S.pobocky || []).forEach(function (x) {
    if (x.lat != null) b.push({ lat: x.lat, lon: x.lon, barva: '#4fd1ff', r: 4 });
  });
  if (!MAPA_MOJE) {
    Object.keys(CLAIMS).forEach(function (k) {
      var c = CLAIMS[k];
      if (c.mine || c.lat == null) return;
      b.push({ lat: c.lat, lon: c.lon, barva: 'rgba(255,93,108,.65)', r: 3 });
    });
  }
  return b;
}
function globusKresli() {
  var cv = $('globus');
  if (!cv || !G.on) return;
  var box = cv.parentNode.getBoundingClientRect();
  var w = Math.max(80, Math.round(box.width)), h = Math.max(80, Math.round(box.height));
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  var g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  var R = Math.min(w, h) * 0.43;
  var cx = w / 2, cy = h / 2;
  G.r = R; G.cx = cx; G.cy = cy;
  var sp = Math.sin(G.phi), cp = Math.cos(G.phi);
  function proj(lo, la) {
    var dl = lo - G.lam, cla = Math.cos(la), sla = Math.sin(la), cd = Math.cos(dl);
    return { x: cx + R * cla * Math.sin(dl), y: cy - R * (cp * sla - sp * cla * cd),
      v: sp * sla + cp * cla * cd >= 0 };
  }
  // Koule: přísvět zleva nahoře, ať to vypadá kulatě.
  var oc = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  oc.addColorStop(0, '#16243f'); oc.addColorStop(0.7, '#0c1427'); oc.addColorStop(1, '#060b16');
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.clip();
  g.fillStyle = oc; g.fillRect(0, 0, w, h);
  // Poledníky a rovnoběžky po třiceti stupních.
  g.strokeStyle = 'rgba(120,160,255,.10)'; g.lineWidth = 1;
  var la, lo, p, zac;
  for (la = -60; la <= 60; la += 30) {
    g.beginPath(); zac = true;
    for (lo = -180; lo <= 180; lo += 4) {
      p = proj(lo * Math.PI / 180, la * Math.PI / 180);
      if (!p.v) { zac = true; continue; }
      if (zac) { g.moveTo(p.x, p.y); zac = false; } else g.lineTo(p.x, p.y);
    }
    g.stroke();
  }
  for (lo = -180; lo < 180; lo += 30) {
    g.beginPath(); zac = true;
    for (la = -90; la <= 90; la += 4) {
      p = proj(lo * Math.PI / 180, la * Math.PI / 180);
      if (!p.v) { zac = true; continue; }
      if (zac) { g.moveTo(p.x, p.y); zac = false; } else g.lineTo(p.x, p.y);
    }
    g.stroke();
  }
  // Pevniny. Body za obzorem se přitisknou na okraj koule — silueta tak sedí
  // i u kontinentů, které přes obzor přebíhají.
  if (typeof SVET_PEVNINA !== 'undefined') {
    g.fillStyle = '#2e3a52'; g.strokeStyle = 'rgba(150,180,230,.35)'; g.lineWidth = 0.7;
    for (var i = 0; i < SVET_PEVNINA.length; i++) {
      var r = SVET_PEVNINA[i], lo2 = r[0], la2 = r[1], vid = false, cesta = [];
      var q = proj(lo2 / 10 * Math.PI / 180, la2 / 10 * Math.PI / 180);
      cesta.push(q); if (q.v) vid = true;
      for (var j = 2; j < r.length; j += 2) {
        lo2 += r[j]; la2 += r[j + 1];
        q = proj(lo2 / 10 * Math.PI / 180, la2 / 10 * Math.PI / 180);
        cesta.push(q); if (q.v) vid = true;
      }
      if (!vid) continue;
      g.beginPath();
      for (var m = 0; m < cesta.length; m++) {
        var c = cesta[m], x = c.x, y = c.y;
        if (!c.v) {
          var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
          x = cx + dx / d * R; y = cy + dy / d * R;
        }
        if (m === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill(); g.stroke();
    }
  }
  // Moje síť na kouli.
  G.body = [];
  globusBody().forEach(function (b) {
    var pp = proj(b.lon * Math.PI / 180, b.lat * Math.PI / 180);
    if (!pp.v) return;
    G.body.push({ x: pp.x, y: pp.y, lat: b.lat, lon: b.lon, u: b.u });
    g.beginPath(); g.arc(pp.x, pp.y, b.r + 2.5, 0, 6.2832);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fill();
    g.beginPath(); g.arc(pp.x, pp.y, b.r, 0, 6.2832);
    g.fillStyle = b.barva; g.fill();
  });
  g.restore();
  g.beginPath(); g.arc(cx, cy, R, 0, 6.2832);
  g.strokeStyle = 'rgba(120,180,255,.45)'; g.lineWidth = 1.2; g.stroke();
}
// Z bodu na kouli zpátky na zeměpisné souřadnice — podle toho hra ví, kam zaletět.
function globusMisto(x, y) {
  var dx = (x - G.cx) / G.r, dy = -(y - G.cy) / G.r;
  var rho = Math.sqrt(dx * dx + dy * dy);
  if (rho > 1) return null;
  var c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
  var lat = Math.asin(cc * Math.sin(G.phi) + (rho ? dy * sc * Math.cos(G.phi) / rho : 0));
  var lon = G.lam + Math.atan2(dx * sc, rho * Math.cos(G.phi) * cc - dy * Math.sin(G.phi) * sc);
  return { lat: lat * 180 / Math.PI, lon: ((lon * 180 / Math.PI + 540) % 360) - 180 };
}
function globusPrilet(lat, lon) {
  globusZavri();
  if (map) map.setView([lat, lon], Math.max(GLOBUS_PRILET, GLOBUS_ZOOM + 1));
  drawMap(); drawAuta();
}
// Ovládání: tažením se točí, krátkým klepnutím hra zaletí na to místo.
function bindGlobus() {
  var cv = $('globus');
  if (!cv) return;
  var tahne = false, posl = null, ujelo = 0;
  cv.addEventListener('pointerdown', function (e) {
    tahne = true; ujelo = 0; posl = { x: e.clientX, y: e.clientY };
    if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (x) { /* nevadí */ } }
  });
  cv.addEventListener('pointermove', function (e) {
    if (!tahne) return;
    var dx = e.clientX - posl.x, dy = e.clientY - posl.y;
    posl = { x: e.clientX, y: e.clientY };
    ujelo += Math.abs(dx) + Math.abs(dy);
    // Koule se točí za prstem: tah doprava žene pevniny doprava, proto mínus —
    // lam je zeměpisná délka středu pohledu, a ta se musí posunout na opačnou stranu.
    G.lam -= dx / G.r * 0.9;
    G.phi = Math.max(-1.4, Math.min(1.4, G.phi + dy / G.r * 0.9));
    globusKresli();
  });
  function pusteno(e) {
    if (!tahne) return;
    tahne = false;
    if (ujelo > 8) return;                      // to bylo tažení, ne klepnutí
    var box = cv.getBoundingClientRect();
    var x = e.clientX - box.left, y = e.clientY - box.top;
    // Nejdřív zkusíme, jestli hráč netrefil některou svou stavbu.
    var nej = null, nejd = 22;
    G.body.forEach(function (b) {
      var d = Math.sqrt((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y));
      if (d < nejd) { nejd = d; nej = b; }
    });
    if (nej) return globusPrilet(nej.lat, nej.lon);
    var m = globusMisto(x, y);
    if (m) globusPrilet(m.lat, m.lon);
  }
  cv.addEventListener('pointerup', pusteno);
  cv.addEventListener('pointercancel', function () { tahne = false; });
  if ($('globus-zpet')) $('globus-zpet').onclick = function () {
    globusZavri();
    if (map && map.getZoom() <= GLOBUS_ZOOM) map.setView(map.getCenter(), GLOBUS_ZOOM + 1);
  };
  if ($('map-poradce')) $('map-poradce').onclick = poradceSheet;
  if ($('map-globus')) $('map-globus').onclick = function () {
    if (G.on) {
      globusZavri();
      if (map && map.getZoom() <= GLOBUS_ZOOM) map.setView(map.getCenter(), GLOBUS_ZOOM + 1);
    } else globusOtevri();
  };
  window.addEventListener('resize', function () { if (G.on) globusKresli(); });
}
var autaLayer = null;
var MAPA_MOJE = (function () {
  try { return localStorage.getItem(MAPA_KEY) === '1'; } catch (e) { return false; }
})();
// Přepínač nad mapou: buď všechno včetně konkurence a volných míst, nebo jen
// vlastní prádlomaty, sídlo a pobočky — když je míst moc, nejde se v tom vyznat.
function mapaPohled(moje) {
  MAPA_MOJE = !!moje;
  try { localStorage.setItem(MAPA_KEY, MAPA_MOJE ? '1' : '0'); } catch (e) { /* nevadí */ }
  [].forEach.call(document.querySelectorAll('[data-mapa]'), function (b) {
    b.classList.toggle('on', (b.getAttribute('data-mapa') === 'moje') === MAPA_MOJE);
  });
  drawMap();
  drawAuta();
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
  map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: GLOBUS_ZOOM })
    .setView([49.82, 15.47], 7);
  // Změna přiblížení rozhoduje, jestli se volná místa kreslí — překreslíme.
  // A kdo se oddálí až na doraz, dostane místo rozložené mapy glóbus.
  map.on('zoomend', function () {
    drawMap();
    if (map.getZoom() <= GLOBUS_ZOOM && !G.on) globusOtevri();
  });
  addBasemap();
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  addAttribution();
  layer = L.layerGroup().addTo(map);
  autaLayer = L.layerGroup().addTo(map);
  bindGlobus();
  drawMap();
  drawAuta();
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
// Servisní auto jezdí po mapě každou vteřinu, takže má vlastní vrstvu — není
// proč kvůli němu překreslovat všechny pinŭky.
// Po moři nejede auto — ikona se mění podle toho, čím technik cestuje.
var ZNAK_CESTY = { auto: '\uD83D\uDE90', trajekt: '\u26F4', letadlo: '\u2708' };
function autoIcon(opravuje, zpusob) {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin auto' + (opravuje ? ' dela' : '') + '">'
      + (opravuje ? '\uD83D\uDD27' : (ZNAK_CESTY[zpusob] || ZNAK_CESTY.auto)) + '</div>' });
}
function drawAuta() {
  if (!map || typeof L === 'undefined') return;
  if (!autaLayer) autaLayer = L.layerGroup().addTo(map);
  autaLayer.clearLayers();
  (S.units || []).forEach(function (u) {
    var p = autoPoloha(u);
    if (!p) return;
    // Hra se mohla mezitím zavřít a otevřít — trasu si doptáme i dodatečně.
    if (u.technik && !u.technik.trasa) nactiTrasu(u);
    // Kudy technik jede. Čárkovaně, ať to nepřebije vlastní mapu.
    if (u.technik && u.technik.trasa && u.technik.trasa.length > 1 && L.polyline) {
      L.polyline(u.technik.trasa, { className: 'trasa', color: '#7c5cff', weight: 3,
        opacity: 0.75, dashArray: '6 6' }).addTo(autaLayer);
    }
    L.marker([p.lat, p.lon], { icon: autoIcon(p.opravuje, u.technik && u.technik.zpusob), zIndexOffset: 1000 })
      .addTo(autaLayer)
      .on('click', function () { unitSheet(u); });
  });
}
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
// Koupený pozemek. Na mapě musí být na první pohled poznat, že zem je moje —
// a jestli je plocha připravená, nebo je to pořád louka.
// Cizí pozemek na mapě. Nabídka pronájmu je inzerát — má být vidět.
function ciziPozemekIcon(c) {
  var nab = !!c.pronajem;
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin pozemek cizi' + (nab ? ' nabidka' : '') + '">\u2302<i class="pin-tag">'
      + (nab ? 'K PRONÁJMU' : 'CIZÍ POZEMEK') + '</i></div>' });
}
function pozemekIcon(sp) {
  var pl = planMista(sp.id);
  var hotovo = pl && pl.hotovo && pl.zaplaceno;
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin pozemek moje">\u2302<i class="pin-tag">'
      + (hotovo ? 'PLOCHA HOTOVÁ' : 'MŮJ POZEMEK') + '</i></div>' });
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
// Druhé stání na pozemku má id s mřížkou — pozemek se pozná podle základního.
function zakladniSpotId(id) {
  var t = String(id || ''), i = t.indexOf('#');
  return i < 0 ? t : t.slice(0, i);
}
// Na čí zemi prádlomat stojí: moje koupená, cizí pronajatá, nebo běžný nájem.
function zemUnit(u) {
  var zak = zakladniSpotId(u && u.spotId);
  if (!zak) return '';
  if (mamPozemek(zak)) return 'moje';
  var l = S.leases && S.leases[zak];
  if (l && l.pronajem) return 'najem';
  var c = CLAIMS[zak];
  if (c && c.najemce && c.najemce.ja) return 'najem';
  return '';
}
function unitIcon(u) {
  var im = MODEL_IMG[u.eco && u.eco.model] || MODEL_IMG.flex;
  var vada = jeVPoruse(u);
  // Domeček v rohu říká, že stroj stojí na pozemku — zeleně na vlastním,
  // fialově na pronajatém. Bez domečku je to běžný nájem místa.
  var zem = zemUnit(u);
  // Běžící výpověď od majitele je oranžová — stroj jede dál, ale má spočítané dny.
  var vyp = !vada && jeVeVypovedi(u);
  var natrhu = !vada && !vyp ? trhMoje(u.spotId) : null;
  return L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22],
    html: '<div class="pin unit' + (vada ? ' vada' : '') + (vyp ? ' vypoved' : '')
      + (natrhu ? ' trh' : '') + (zem ? ' zem-' + zem : '')
      + '" data-unit="' + esc(u.spotId) + '">'
      + '<img src="' + esc(im.src) + '" alt="">'
      + (vada ? '<i class="pin-vada">!</i>' : '')
      + (vyp ? '<i class="pin-vyp">\u29D6</i>' : '')
      + (natrhu ? '<i class="pin-trh">\u20AC</i>' : '')
      + (zem ? '<i class="pin-zem">\u2302</i>' : '')
      + '<i class="pin-tag">' + esc(vada ? u.porucha.text
          : (vyp ? 'Výpověď — ' + etaText(Math.max(0, u.vypoved.do - Date.now())).replace('za ', '')
          : natrhu ? 'Na prodej · ' + kcFull(natrhu.cena)
          : (MODELS[u.eco && u.eco.model] ? MODELS[u.eco.model].name : ''))) + '</i></div>' });
}
// Z dálky mají v mapě být jen prádlomaty, sídlo a pobočky. Volná místa je
// v tomhle měřítku stejně nejde rozlišit — slepí se do hromádky otačníků.
var MISTA_ZOOM = 14;
// ─── Správa servisu ──────────────────────────────────────────────
// Odznak vlevo nahoře nad mapou řekne jedním pohledem, jak síť jede. Po klepnutí
// se otevře celý přehled — který stroj stojí, kde je technik a kdy bude hotovo.
function servisStav() {
  var vse = S.units || [];
  var stoji = vse.filter(function (u) { return jeVPoruse(u) && !u.technik; });
  var resi = vse.filter(function (u) { return jeVPoruse(u) && u.technik; });
  var vraci = vse.filter(function (u) { return !jeVPoruse(u) && u.technik; });
  return { vse: vse, stoji: stoji, resi: resi, vraci: vraci,
    jede: vse.length - stoji.length - resi.length };
}
function paintServis() {
  var el = $('map-servis');
  if (!el) return;
  var st = servisStav();
  if (!st.vse.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  var tr = st.stoji.length ? 'vada' : (st.resi.length || st.vraci.length ? 'jede' : 'ok');
  el.className = 'map-servis ' + tr;
  el.innerHTML = tr === 'vada'
      ? '<i>⚠️</i><b>' + st.stoji.length + '</b>'
      : (tr === 'jede' ? '<i>🔧</i><b>' + (st.resi.length + st.vraci.length) + '</b>'
                       : '<i>🔧</i><b>' + st.jede + '/' + st.vse.length + '</b>');
  el.title = 'Správa servisu';
  el.onclick = servisSheet;
}
// Jedna řádka přehledu. Pořadí: co stojí bez technika, co se právě řeší, co jede.
function servisRadek(u) {
  var t = u.technik, ted = Date.now(), m = MODELS[u.eco && u.eco.model];
  var stav, tr, akce = '';
  if (jeVPoruse(u) && !t) {
    var v = vyjezdOdhad(u);
    tr = 'err';
    stav = u.porucha.text + (v ? ' — ' + Math.round(v.km) + ' km ' + v.zpusob.nazev
      + ', oprava na ' + u.porucha.zav + ' h' : '');
    akce = v ? '<button class="btn sec maly" data-vada="' + esc(u.spotId) + '">Vyslat</button>' : '';
  } else if (t && ted < t.prijezd) {
    tr = 'warn'; stav = u.porucha.text + ' — ' + (ZNAK_CESTY[t.zpusob] || ZNAK_CESTY.auto)
      + ' technik přijede ' + etaText(t.prijezd - ted);
  } else if (t && jeVPoruse(u)) {
    tr = 'warn'; stav = u.porucha.text + ' — technik na místě, hotovo ' + etaText(t.hotovo - ted);
  } else if (t) {
    tr = 'ok'; stav = 'Spraveno, technik jede zpátky';
  } else if (jeVeVypovedi(u)) {
    tr = 'warn'; stav = 'Výpověď z místa — odvoz na sklad '
      + etaText(Math.max(0, u.vypoved.do - Date.now()));
  } else {
    tr = 'ok'; stav = 'Jede — ' + kcFull(u.eco.profit) + ' / měsíc';
  }
  return '<div class="srv-radek" data-srv="' + esc(u.spotId) + '">'
    + '<i class="srv-tecka ' + tr + '"></i>'
    + '<span><b>' + esc(u.name) + '</b> <i>' + esc((m ? m.name : '') + ' · ' + stav) + '</i></span>'
    + akce + '</div>';
}
function servisSheet() {
  var st = servisStav();
  var poradi = st.stoji.concat(st.resi, st.vraci,
    st.vse.filter(function (u) { return !jeVPoruse(u) && !u.technik; }));
  sheet('<h3>Správa servisu</h3>'
    + '<p class="muted small">Výjezdy máš zaplacené v servisním poplatku, takže technika '
    + 'můžeš poslat kam chceš a kolik jich chceš naráz. Dokud stroj stojí, nájem, '
    + 'servis i splátka běží dál — čekáním se nic neušetří.</p>'
    + '<div class="sum-grid" style="margin:12px 0">'
    + '<div><span>Jede</span><b class="ok">' + st.jede + ' z ' + st.vse.length + '</b></div>'
    + '<div><span>Stojí</span><b class="' + (st.stoji.length ? 'err' : '') + '">' + st.stoji.length + '</b></div>'
    + '<div><span>Techniků na cestě</span><b class="' + (st.resi.length + st.vraci.length ? 'warn' : '') + '">'
    + (st.resi.length + st.vraci.length) + '</b></div>'
    + '</div>'
    + (st.stoji.length > 1
        ? '<button class="btn big" id="do-vsechny" style="width:100%;margin-bottom:12px">'
          + 'Vyslat techniky na všechny (' + st.stoji.length + ')</button>'
        : '')
    + (poradi.length
        ? '<div class="srv">' + poradi.map(servisRadek).join('') + '</div>'
        : '<div class="empty">Zatím nemáš žádný prádlomat.</div>')
    + (zaMorem().length
        ? '<p class="fine warn" style="margin-top:12px">' + zaMoremSlovy(zaMorem().length)
          + ' za mořem — technik tam jede trajektem nebo letí. Pobočka v jejich okolí '
          + 'zkrátí každý výjezd na pár hodin a vyplatí se dřív, než to vypadá.</p>'
        : '')
    + '<p class="fine" style="margin-top:12px">Každý stroj se v průměru dvakrát za herní rok '
    + 'porouchá. MINI při poruše stojí celé, FLEX a MAX jedou na půl — je v nich strojů víc.</p>');
  var vs = $('do-vsechny');
  if (vs) vs.onclick = function () {
    servisStav().stoji.forEach(vyslatTechnika);
    servisSheet();
  };
  [].forEach.call(document.querySelectorAll('#sheet-body [data-vada]'), function (b) {
    b.onclick = function (e) {
      e.stopPropagation();
      vyslatTechnika(najdiJednotku(b.getAttribute('data-vada')));
      servisSheet();
    };
  });
  [].forEach.call(document.querySelectorAll('#sheet-body [data-srv]'), function (r) {
    r.onclick = function () { unitSheet(najdiJednotku(r.getAttribute('data-srv'))); };
  });
}
function najdiJednotku(id) {
  return (S.units || []).filter(function (u) { return u.spotId === id; })[0];
}
// ─── Shlukování značek ───────────────────────────────────────────────────────
// Čím víc hráčů, tím hustší mapa: prádlomaty i cedulky s firmami se začnou
// překrývat. Při oddálení se proto značky, které by si lezly do zorného pole,
// sloučí do jedné bubliny s počtem. Klepnutí na bublinu mapu přiblíží a shluk
// se rozpadne na jednotlivé značky — žádné schovávání, jen jiný detail.
var SHLUK_PX = 54;               // mřížka v obrazovkových bodech
var SHLUK_OD_ZOOMU = 16;         // od úrovně ulic se už nic neslučuje
function shlukIcon(n, moje) {
  var r = n > 99 ? 46 : n > 9 ? 42 : 38;
  return L.divIcon({ className: '', iconSize: [r, r], iconAnchor: [r / 2, r / 2],
    html: '<div class="pin shluk' + (moje ? ' moje' : '') + '">' + n + '</div>' });
}
// Rozdělí značky do mřížky podle jejich polohy na obrazovce.
function shlukuj(kusy) {
  if (!map || map.getZoom() >= SHLUK_OD_ZOOMU) return kusy.map(function (k) { return [k]; });
  var bunky = {}, poradi = [];
  kusy.forEach(function (k) {
    var p;
    try { p = map.latLngToContainerPoint([k.lat, k.lon]); } catch (e) { p = null; }
    if (!p) { poradi.push([k]); return; }
    var klic = Math.floor(p.x / SHLUK_PX) + ':' + Math.floor(p.y / SHLUK_PX);
    if (!bunky[klic]) { bunky[klic] = []; poradi.push(bunky[klic]); }
    bunky[klic].push(k);
  });
  return poradi;
}
// Vykreslí shluky: co je samo, nakreslí se normálně, co se sešlo, dostane bublinu.
function vykresliShluky(kusy, vrstva) {
  shlukuj(kusy).forEach(function (sk) {
    if (sk.length === 1) return sk[0].kresli();
    var lat = 0, lon = 0, moje = 0;
    sk.forEach(function (k) { lat += k.lat; lon += k.lon; if (k.moje) moje++; });
    var stred = [lat / sk.length, lon / sk.length];
    L.marker(stred, { icon: shlukIcon(sk.length, moje > 0) })
      .addTo(vrstva)
      .on('click', function () {
        if (!map) return;
        // Přiblížení o dvě úrovně shluk spolehlivě rozpadne i v centru města.
        map.setView(stred, Math.min(18, map.getZoom() + 2));
      });
  });
}
function drawMap() {
  if (!layer) return;
  layer.clearLayers();
  var any = false, zname = {}, skryto = 0, skrytoCizi = 0, kusy = [];
  var blizko = !map || map.getZoom() >= MISTA_ZOOM;
  var moje = MAPA_MOJE;
  var naProdej = trhPodleMist();
  Object.keys(S.areas).forEach(function (aid) {
    S.areas[aid].spots.forEach(function (sp) {
      any = true; zname[sp.id] = 1;
      var unit = S.units.filter(function (u) { return u.spotId === sp.id; })[0];
      var rival = !unit && CLAIMS[sp.id] && !CLAIMS[sp.id].mine ? CLAIMS[sp.id] : null;
      // V pohledu „jen moje“ mizí konkurence. Prozkoumaná i volná místa zůstávají
      // — právě na nich se staví, bez nich by mapa k ničemu nebyla.
      // Cizí prádlomat na tržišti je nabídka, ne konkurence — ten ukážeme i ve
      // filtru „jen moje", jinak by hráč o koupi vedle sebe nevěděl.
      if (moje && rival && !naProdej[sp.id]) { skrytoCizi++; return; }
      // Volné místo je jen tip, ne stavba — ukazuje se až při přiblížení.
      if (!unit && !rival && !blizko) { skryto++; return; }
      var seen = !!S.revealed[sp.id];
      // Pozemek na prodej má svůj pin, i když tam hráč ještě nebyl — cedule
      // „na prodej" je na parcele vidět z ulice, na rozdíl od výše nájmu.
      var mujPoz = !unit && mamPozemek(sp.id);
      // Cizí zem bez stroje není konkurenční prádlomat — má svůj špendlík,
      // a když ji majitel nabízí, je to vidět.
      var ciziPoz = rival && rival.pozemek && !rival.model ? rival : null;
      if (ciziPoz && ciziPoz.najemce && ciziPoz.najemce.ja) return;
      var nabidka = !unit && naProdej[sp.id] ? naProdej[sp.id] : null;
      var icon = unit ? unitIcon(unit)
        : nabidka ? trhIcon(nabidka)
        : ciziPoz ? ciziPozemekIcon(ciziPoz)
        : rival ? rivalIcon(rival)
        : mujPoz ? pozemekIcon(sp)
        : jePozemek(sp) ? pinIcon('pozemek' + (seen ? ' known' : ''), '\u2302')
        : pinIcon(seen ? 'known' : 'unknown', seen ? '\u2605' : '?');
      kusy.push({ lat: sp.lat, lon: sp.lon, moje: !!unit || mujPoz, kresli: function () {
        L.marker([sp.lat, sp.lon], { icon: icon })
          .addTo(layer)
          .on('click', function () {
            if (nabidka) return trhKoupitSheet(nabidka);
            if (rival) return rivalSheet(sp, aid, rival);
            spotSheet(sp, aid);
          });
      } });
    });
  });
  // Cizí zábory v městech, která jsme neprozkoumali. Víme o nich jen to, že tam
  // někdo něco drží — co to místo umí, zjistíme až průzkumem města. Koupený
  // pozemek bez stroje není prádlomat, tak ani nevypadá jako prádlomat.
  Object.keys(CLAIMS).forEach(function (sid) {
    var c = CLAIMS[sid];
    if (c.mine || zname[sid] || c.lat == null) return;
    any = true;
    if (moje && !naProdej[sid]) { skrytoCizi++; return; }
    var zem = c.pozemek && !c.model;
    var nab = naProdej[sid] || null;
    kusy.push({ lat: c.lat, lon: c.lon, moje: false, kresli: function () {
      L.marker([c.lat, c.lon], { icon: nab ? trhIcon(nab) : zem ? ciziPozemekIcon(c) : rivalIcon(c) })
        .addTo(layer)
        .on('click', function () { if (nab) return trhKoupitSheet(nab); cizi(c); });
    } });
  });
  // Další stání na témže pozemku nejsou v seznamu míst — mají ale vlastní
  // zábor a hlavně musí být na mapě vidět.
  S.units.forEach(function (u) {
    if (!u.spotId || String(u.spotId).indexOf('#') < 0 || u.lat == null) return;
    kusy.push({ lat: u.lat, lon: u.lon, moje: true, kresli: function () {
      L.marker([u.lat, u.lon], { icon: unitIcon(u) })
        .addTo(layer).on('click', function () { unitSheet(u); });
    } });
  });
  // Teprve teď se rozhodne, co se vykreslí samostatně a co se sloučí.
  vykresliShluky(kusy, layer);
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
  // Nápověda pod mapou říká buď „začni průzkumem“, nebo „přibliž, místa jsou schovaná“.
  var h = $('map-hint');
  if (!any) {
    h.textContent = 'Napiš město a pošli tam člověka, ať ho projde. Místa jsou schovaná — dokud město neprozkoumáš, nic na mapě neuvidíš.';
    h.classList.remove('hidden');
  // Nápověda o schovaných místech patří k prvnímu rozkoukání. Po herním měsíci
  // už hráč ví, jak se mapa chová, a lišta přes půl obrazovky by jen překážela.
  // Že filtr „jen moje" schovává konkurenci, je vidět z přepínače nad mapou —
  // hlášku o tom hráč po pár minutách jen odklikává.
  } else if (skryto && Date.now() - (S.startedAt || 0) < MONTH_MS) {
    h.textContent = 'Přibliž mapu na úroveň ulic, ať uvidíš volná místa — teď jich je schovaných '
      + skryto + '. Ze seznamu oblastí tě hra skočí rovnou k nim.';
    h.classList.remove('hidden');
  } else h.classList.add('hidden');
  paintServis();
  paintTrhBadge();
}
// Panel cizího prádlomatu v neprozkoumaném městě.
function cizi(c) {
  var mesto = (c.area_key || '').replace(/(^|\s)\S/g, function (x) { return x.toUpperCase(); });
  var zem = c.pozemek && !c.model;
  sheet('<h3>' + esc(c.name || (zem ? 'Cizí pozemek' : 'Cizí prádlomat')) + '</h3>'
    + '<p class="muted small">' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '')
    + (zem ? 'Tenhle pozemek vlastní <b>' : 'Tohle místo drží <b>') + esc(c.firma || c.nick) + '</b> (' + esc(c.nick) + ')'
    + (zem ? '' : ' · ' + esc((MODELS[c.model] || {}).name || c.model))
    + (c.takeovers ? ' · už ' + c.takeovers + '× změnilo majitele' : '') + '</p>'
    + (zem ? '<p class="muted small">Prádlomat tu zatím nestojí — je to koupená zem. '
        + (c.pronajem ? 'Majitel ji nabízí k pronájmu za ' + kcFull(c.pronajem.cena) + ' měsíčně'
            + (c.pronajem.sit ? ' i s připravenou plochou' : ' jako holou parcelu') + '. '
            + 'Pronajmout si ji můžeš, až město prozkoumáš.'
          : 'Majitel ji zatím nikomu nenabízí.') + '</p>' : '')
    + '<p class="muted small">' + (mesto ? esc(mesto) + ' jsi neprozkoumal' : 'Tohle město jsi neprozkoumal')
    + ' — bez toho nevíš, kolik tu chodí lidí ani jestli se sem vyplatí jít. '
    + (zem ? 'Pošli tam člověka a pak uvidíš i okolní místa.'
          : 'Pošli tam člověka a pak se můžeš pokusit nájem přeplatit.') + '</p>'
    + '<button class="btn big" id="go-scout-here">Prozkoumat ' + (mesto ? esc(mesto) : 'tohle město') + ' za ' + kcFull(SCOUT_COST) + '</button>'
    + (S.cash < SCOUT_COST ? '<p class="fine err">Na cestu nemáš dost hotovosti.</p>' : '')
    + (c.id ? '<button class="btn ghost" id="cizi-napsat" style="width:100%;margin-top:8px">Napsat majiteli</button>' : ''));
  var cn = $('cizi-napsat');
  if (cn) cn.onclick = function () { chatSheet(c.id); };
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
// Města, která už někdo prohledal — ta se otevřou okamžitě. Držíme je v paměti,
// ať se při každém otevření panelu nechodí na server.
var MESTA_HOTOVA = null;
function loadMesta(then) {
  if (MESTA_HOTOVA) { if (then) then(); return; }
  api('/mesta').then(function (r) {
    MESTA_HOTOVA = (r.ok && r.j.mesta) || [];
    if (then) then();
  }).catch(function () { MESTA_HOTOVA = []; if (then) then(); });
}
function mestaHtml(nadpis) {
  var m = (MESTA_HOTOVA || []).filter(function (x) { return !S.areas[x.key]; }).slice(0, 18);
  if (!m.length) return '';
  return '<p class="muted small" style="margin:14px 0 6px"><b>' + esc(nadpis) + '</b></p>'
    + '<div class="mesta-chipy">' + m.map(function (x) {
        return '<button class="mesto-chip" data-mesto="' + esc(x.name) + '">' + esc(x.name)
          + '<i>' + x.mist + ' míst</i></button>';
      }).join('') + '</div>';
}
function bindMesta(spustit) {
  [].forEach.call($('sheet-body').querySelectorAll('[data-mesto]'), function (b) {
    b.onclick = function () {
      var inp = $('q-area');
      if (inp) inp.value = b.getAttribute('data-mesto');
      if (spustit) spustit(b.getAttribute('data-mesto'));
    };
  });
}
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
    + '<div id="mesta-box">' + mestaHtml('Hotová města — člověk je prošel, otevřou se hned') + '</div>'
    + (done ? '<h3 style="margin-top:16px">Už prozkoumáno</h3>' + done : ''));
  var inp = $('q-area'), btn = $('do-scout');
  // Hotová města doplníme, jakmile dorazí ze serveru — panel na ně nečeká.
  if (!MESTA_HOTOVA) {
    loadMesta(function () {
      var box = $('mesta-box');
      if (!box) return;
      box.innerHTML = mestaHtml('Hotová města — člověk je prošel, otevřou se hned');
      bindMesta(function (mesto) { scout(mesto, $('do-scout')); });
    });
  }
  // Na telefonu klávesnice ukousne půlku obrazovky — ať pole zůstane vidět.
  if (inp) inp.onfocus = function () { setTimeout(function () { inp.scrollIntoView({ block: 'center' }); }, 250); };
  var run = function () { scout((inp.value || '').trim(), btn); };
  bindMesta(function (mesto) { scout(mesto, btn); });
  if (btn) btn.onclick = run;
  if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } };
  [].forEach.call($('sheet-body').querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () {
      var a = S.areas[b.getAttribute('data-go')];
      closeSheet(); if (map && a && a.lat) map.setView([a.lat, a.lon], MISTA_ZOOM);
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
  var nabidnuto = false;
  var progress = function (s) {
    btn.textContent = 'Hledám… ' + s + ' s';
    if (note) note.textContent = 'Chodí po městě (' + s + ' s). Nech stránku otevřenou, může to trvat i minutu.';
    // Po deseti vteřinách nabídneme města, kde už někdo byl — ta se otevřou
    // hned. Nový hráč tak nemusí čekat na první hledání vůbec.
    if (s >= 10 && !nabidnuto) {
      nabidnuto = true;
      loadMesta(function () {
        var box = $('mesta-box');
        if (!box || stop) return;
        box.innerHTML = mestaHtml('Nechceš čekat? Tahle města jsou hotová a otevřou se hned');
        bindMesta(function (mesto) { done(); btn.disabled = false; btn.textContent = 'Hledat'; scout(mesto, btn); });
      });
    }
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
          if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], MISTA_ZOOM);
          return toast(j.area.name + ' už máš prozkoumaný — koukni na mapu.', 'ok');
        }
        S.cash -= SCOUT_COST;
        zapis('pruzkum', 'Průzkum města — ' + j.area.name, -SCOUT_COST);
        S.areas[id] = { name: j.area.name, lat: j.area.lat, lon: j.area.lon, scoutedAt: Date.now(), spots: (j.spots || []).map(fixMetrics) };
        zalozSidlo(j.area);
        save(); paint(); drawMap(); closeSheet(); syncState(true);
        ev('game_scout');
        loadClaims();   // ať hráč hned vidí, kde už konkurence stojí
        if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], MISTA_ZOOM);
        toast(j.area.name + ': nalezeno ' + j.spots.length + ' míst.', 'ok');
        // Na začátku hráče nenecháme hádat, do čeho klepnout: nejlepší místo
        // mu obhlídneme zdarma a rovnou ukážeme i s čísly.
        prvniMisto(id);
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

// Nejlepší místo z prvního průzkumu — obhlídka zdarma a hned otevřený detail.
// Nový hráč tak do minuty vidí skutečná čísla, ne prázdnou mapu.
function prvniMisto(areaId) {
  if (!tutAktivni() || (S.units || []).length) return;
  if (Object.keys(S.revealed || {}).length) return;
  var a = S.areas[areaId];
  if (!a || !a.spots || !a.spots.length) return;
  var nej = a.spots.slice().sort(function (x, y) { return (y.score || 0) - (x.score || 0); })[0];
  if (!nej) return;
  S.revealed[nej.id] = true;
  save(); drawMap(); tutPaint(); syncState(true);
  setTimeout(function () {
    if (map && nej.lat != null) map.setView([nej.lat, nej.lon], 16);
    spotSheet(nej, areaId);
    toast('Nejlepší místo ve městě jsme ti obhlédli zdarma.', 'ok');
  }, 400);
}

// ─── Panel: místo ────────────────────────────────────────────────────────────
function spotSheet(sp, areaId) {
  var unit = S.units.filter(function (u) { return u.spotId === sp.id; })[0];
  // Na pronajatém cizím pozemku stojí můj prádlomat na vlastním záboru.
  if (!unit) unit = S.units.filter(function (u) { return u.spotId === padId(sp.id, 1); })[0];
  // Na vlastním pozemku je nad jedním prádlomatem ještě celá parcela — ta má
  // svůj přehled se stáními, takže se detail stroje neotevírá rovnou.
  if (unit && !mamPozemek(sp.id)) return unitSheet(unit);
  var claim = CLAIMS[sp.id];
  var najemniMoje = claim && claim.najemce && claim.najemce.ja;
  if (claim && !claim.mine && !najemniMoje) {
    // Cizí zem: buď je k pronájmu, nebo se na ni dá jen koukat.
    if (claim.pozemek && !claim.model) return cizipozemekSheet(sp, areaId, claim);
    return rivalSheet(sp, areaId, claim);
  }

  // 1. krok — obhlídka. Levná, jen se tam někdo zajede podívat.
  if (!S.revealed[sp.id]) {
    var poz0 = jePozemek(sp);
    sheet('<h3>' + (poz0 ? 'Pozemek na prodej' : 'Neprověřené místo') + '</h3>'
      + '<p class="muted small">' + (poz0
          ? 'Na parcele je cedule, takže výměru i cenu znáš. Co tu ale chodí lidí a jestli se '
            + 'sem prádlomat vyplatí, zjistíš až obhlídkou.'
          : 'Víš jen, že tu něco je. Obhlídka ti ukáže, kolik tu chodí lidí, jaká je konkurence a jestli se tu prádlomat vyplatí.') + '</p>'
      + '<div class="kv"><span>Typ místa</span><b>' + esc(KIND_LABEL[sp.kind] || 'Neznámý') + '</b></div>'
      + (poz0 ? '<div class="kv"><span>Výměra</span><b>' + pozemekM2(sp) + ' m²</b></div>'
          + '<div class="kv"><span>Cena pozemku</span><b>' + kcFull(pozemekCena(sp))
          + '</b> <span class="muted small">(' + kcFull(pozemekZaM2(sp)) + ' / m²)</span></div>' : '')
      + '<div class="kv"><span>Cena obhlídky</span><b>' + kcFull(REVEAL_COST) + '</b></div>'
      + '<button class="btn big" id="do-reveal"' + (S.cash < REVEAL_COST ? ' disabled' : '') + '>Prověřit místo</button>'
      + (S.cash < REVEAL_COST ? '<p class="fine">Na obhlídku nemáš dost hotovosti.</p>' : ''));
    var b = $('do-reveal');
    if (b) b.onclick = function () {
      S.cash -= REVEAL_COST;
      zapis('pruzkum', 'Prověření místa — ' + (sp.name || ''), -REVEAL_COST);
      S.revealed[sp.id] = true; save(); paint(); drawMap(); syncState(true); spotSheet(sp, areaId);
    };
    return;
  }

  var lease = S.leases[sp.id];
  // Dřív se pozemek „pronajímal“ spolu se strojem a při výběru stroje vznikl
  // nájem za nula. Kdo takový rozdělaný záznam má, zůstal by kvůli němu viset
  // na kartě nájmu a zem by si koupit nemohl — tak ho zahodíme.
  if (lease && lease.pozemek && !mamPozemek(sp.id)) {
    delete S.leases[sp.id];
    lease = null;
    save();
  }
  var head = '<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[sp.kind] || 'Místo') + ' · ' + esc(S.areas[areaId] ? S.areas[areaId].name : '')
    // Co hráč koupil, se mu už nenabízí — v hlavičce stojí, že zem je jeho.
    + (mamPozemek(sp.id) ? ' · <b class="ok">tvůj pozemek</b>'
        : najemniMoje ? ' · <b class="ok">pronajatý pozemek</b>'
        : jePozemek(sp) ? ' · <b class="ok">pozemek na prodej</b>' : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<div class="kv"><span>Parkovacích ploch v okolí</span><b>' + (mnum(sp.parking) != null ? mnum(sp.parking) + (sp.parking_m != null ? ' (' + sp.parking_m + ' m)' : '') : '—') + '</b></div>'
    + '<div class="kv"><span>Konkurence do 1,5 km</span><b>' + (mnum(sp.competition) != null ? mnum(sp.competition) : '—') + '</b></div>'
    + '<div class="kv"><span>Tahouni provozu</span><b>' + (mnum(sp.anchors) != null ? mnum(sp.anchors) : '—') + '</b></div>';

  // 2. krok — domluvit s majitelem nájem. Zadarmo, ale bez něj se stavět nedá.
  if (!lease && jePozemek(sp) && !mamPozemek(sp.id)) {
    var cenaZ = pozemekCena(sp);
    var fz = canFinance(cenaZ, null, cenaZ);   // zem je zástava sama o sobě
    sheet(head + pozemekKarta(sp)
      + '<button class="btn big" id="do-koupit-zem"' + (fz.ok ? '' : ' disabled')
      + ' style="width:100%;margin-top:12px">Koupit pozemek za ' + kcFull(cenaZ) + '</button>'
      + (fz.ok
          ? '<p class="fine">Kupuješ samotnou zem. Cestu, parkování a přípojky si pak necháš udělat, '
            + 'až budeš chtít — a prádlomat sem přivezeš, až ho budeš mít. Nájem už nikdy neplatíš.</p>'
          : '<p class="fine err">' + esc(fz.duvod || 'Na pozemek zatím nemáš.') + '</p>'));
    var kz = $('do-koupit-zem');
    if (kz) kz.onclick = function () { koupitPozemek(sp, areaId, kz); };
    return;
  }
  // Na vlastním pozemku se rovnou staví — zem je zaplacená.
  if (mamPozemek(sp.id)) {
    var zem0 = pozemky().filter(function (z) { return z.spotId === sp.id; })[0] || {};
    var najemce0 = claim && claim.najemce ? claim.najemce : null;
    var pl0 = planMista(sp.id);
    // Stání se počítají jen z plochy, která je hotová a zaplacená — rozdělaný
    // návrh ještě nic neznamená.
    var pady0 = pl0 && pl0.hotovo && pl0.zaplaceno ? planStroje(pl0) : [];
    var stoji0 = strojuNaPozemku(sp.id);
    sheet(head
      + '<div class="card"><div class="row"><h3>Tvůj pozemek</h3><b class="ok">' + (zem0.m2 || pozemekM2(sp)) + ' m²</b></div>'
      + '<p class="muted small" style="margin:4px 0 0">Zem máš koupenou za ' + kcFull(zem0.cena || pozemekCena(sp))
      + '. Nájem neplatíš a nikdo tě odtud nevyhodí.</p>'
      + (pady0.length
          ? '<div class="kv" style="margin-top:10px"><span>Zaplacená příprava plochy</span><b class="ok">'
            + kcFull(pl0.zaplaceno) + '</b></div>'
            + '<div class="kv"><span>Stání na prádlomaty</span><b>' + stoji0 + ' z ' + pady0.length + ' obsazeno</b></div>'
          : '')
      + (najemce0 ? '' : '<button class="btn big" id="do-priprava-start" style="width:100%;margin-top:12px">'
          + (pady0.length ? 'Rozšířit nebo předělat plochu' : 'Připravit plochu') + '</button>')
      + (pady0.length || najemce0 ? ''
          : '<p class="fine">Cestu, parkování, dlažbu a přípojky si necháš udělat a zaplatíš hned — stroj '
            + 'skladem mít nemusíš. V návrhu si zvolíš, jestli děláš místo pro jeden velký kiosek, '
            + 'nebo rovnou stání pro dva tři prádlomaty.</p>')
      + '</div>'
      + pronajemKarta(sp, claim, pady0.length > 0, stoji0)
      + (najemce0 ? '' : pady0.length
          ? '<h3 style="margin-top:18px">Stání na ploše</h3>'
            + pady0.map(function (pd, i) {
                var obsaz = padObsazen(sp, i), mm = MODELS[pd.model] || MODELS.mini;
                var skl = inStock(pd.model), cest = onWay(pd.model);
                return '<div class="card"><div class="row"><h3>' + (i + 1) + '. stání · ' + esc(mm.name) + '</h3>'
                  + '<b class="' + (obsaz ? 'ok' : '') + '">' + (obsaz ? 'stojí' : 'volné') + '</b></div>'
                  + (obsaz
                      ? '<p class="muted small" style="margin:4px 0 8px">Prádlomat je v provozu.</p>'
                        + '<button class="btn sec sm" style="width:100%" data-pad-detail="' + i + '">Otevřít detail</button>'
                      : skl > 0
                        ? '<p class="muted small" style="margin:4px 0 8px">Plocha je zaplacená — platí se už jen doprava stroje.</p>'
                          + '<button class="btn sm" style="width:100%" data-pad="' + i + '">Postavit '
                          + esc(mm.name) + ' (' + skl + '× skladem)</button>'
                        : cest > 0
                          ? '<p class="fine warn" style="margin:6px 0 0">' + cest + '× ' + esc(mm.name)
                            + ' je na cestě — až dorazí, postavíš ho sem.</p>'
                          : '<p class="muted small" style="margin:4px 0 8px">' + esc(mm.name)
                            + ' nemáš skladem. Kup ho v obchodě a pak ho sem přivezeš.</p>'
                            + '<button class="btn sec sm" style="width:100%" id="go-shop">Do obchodu</button>')
                  + '</div>';
              }).join('')
          : '')
      + (najemce0 ? '' : '<h3 style="margin-top:18px">Co se sem vejde</h3>'
          + '<p class="fine">Nájem tu neplatíš, proto jsou čísla lepší než na pronájmu. Druhý prádlomat na '
          + 'stejném pozemku vydělá ' + Math.round(padPodil(1) * 100) + ' % a třetí '
          + Math.round(padPodil(2) * 100) + ' % toho prvního — zákazníci kolem jsou pořád titíž.</p>'
          + MODEL_ORDER.map(function (k) { return modelCard(sp, economics(sp, k), '', true); }).join('')));
    bindPronajem(sp, areaId, claim);
    var ps0 = $('do-priprava-start');
    if (ps0) ps0.onclick = function () {
      planEditor(sp, areaId, function () { pripravaSheet(sp, areaId); });
    };
    [].forEach.call($('sheet-body').querySelectorAll('[data-pad-detail]'), function (bd) {
      bd.onclick = function () {
        var id = padId(sp.id, Number(bd.getAttribute('data-pad-detail')));
        var u = S.units.filter(function (x) { return x.spotId === id; })[0];
        if (u) unitSheet(u);
      };
    });
    [].forEach.call($('sheet-body').querySelectorAll('[data-pad]'), function (bp) {
      bp.onclick = function () {
        var i = Number(bp.getAttribute('data-pad'));
        var pd = planStroje(planMista(sp.id))[i];
        if (!pd) return;
        installSheet(sp, areaId, pd.model, false, i);
      };
    });
    var go0 = $('go-shop');
    if (go0) go0.onclick = function () { closeSheet(); switchTab('shop'); };
    return;
  }
  if (!lease) {
    // Podmínky se vybírají tady, při vyjednávání — pak už se smlouva nemění.
    if (S.najemVolba == null) S.najemVolba = { doba: 0, vypoved: 1 };
    var nv = S.najemVolba;
    var vykresli = function () {
      var cena = najemSPodminkami(sp, nv.doba, nv.vypoved);
      var popis = '';
      NAJEM_DOBY.forEach(function (d) { if (d.m === nv.doba) popis = d.p; });
      sheet(head
        + '<h3 style="margin-top:18px">Nájemní smlouva</h3>'
        + '<p class="muted small">Než sem něco postavíš, musíš se s majitelem pozemku dohodnout. '
        + 'Čím delší jistotu chceš, tím dražší nájem — ale tím hůř se ti někdo dostane na místo.</p>'
        + '<p class="muted small" style="margin:10px 0 4px"><b>Na jak dlouho se vážeš</b></p>'
        + '<div class="seg sub najem-seg">' + NAJEM_DOBY.map(function (d) {
            return '<button class="' + (d.m === nv.doba ? 'on' : '') + '" data-doba="' + d.m + '">'
              + (d.m ? (d.m / 12) + (d.m === 12 ? ' rok' : (d.m < 60 ? ' roky' : ' let')) : 'Neurčito') + '</button>';
          }).join('') + '</div>'
        + '<p class="fine">' + esc(popis) + '</p>'
        + '<p class="muted small" style="margin:12px 0 4px"><b>Výpovědní doba</b></p>'
        + '<div class="seg sub najem-seg">' + NAJEM_VYPOVEDI.map(function (m) {
            return '<button class="' + (m === nv.vypoved ? 'on' : '') + '" data-vyp="' + m + '">'
              + m + ' měs.</button>';
          }).join('') + '</div>'
        + '<p class="fine">Když tě někdo přeplatí, tolik herních měsíců ti místo ještě vydělává — '
        + 'a celou tu dobu můžeš jeho nabídku dorovnat a zůstat. Stejnou lhůtu musí dodržet '
        + 'i majitel pozemku, když vypoví sám — tolik času pak máš na nové místo pro stroj.</p>'
        + '<div class="kv" style="margin-top:14px"><span>Nájem za těchhle podmínek</span><b class="'
        + (cena > rentOf(sp) ? 'warn' : 'ok') + '">' + kcFull(cena) + ' / měsíc</b></div>'
        + (cena > rentOf(sp)
            ? '<div class="kv"><span>Příplatek za jistotu</span><b>+' + kcFull(cena - rentOf(sp))
              + ' (' + Math.round((najemKoef(nv.doba, nv.vypoved) - 1) * 100) + ' %)</b></div>'
            : '')
        + '<button class="btn big" id="do-lease" style="width:100%;margin-top:12px">Domluvit nájem</button>'
        + '<p class="fine">Z doby určité se dá odejít i dřív, ale doplatíš odstupné — zbytek nájmu '
        + 'do konce smlouvy, nejvýš za ' + ODSTUPNE_MAX + ' měsíce.</p>');
      [].forEach.call($('sheet-body').querySelectorAll('[data-doba]'), function (x) {
        x.onclick = function () { nv.doba = Number(x.getAttribute('data-doba')); save(); vykresli(); };
      });
      [].forEach.call($('sheet-body').querySelectorAll('[data-vyp]'), function (x) {
        x.onclick = function () { nv.vypoved = Number(x.getAttribute('data-vyp')); save(); vykresli(); };
      });
      var l = $('do-lease');
      if (l) l.onclick = function () {
        S.leases[sp.id] = { rent: najemSPodminkami(sp, nv.doba, nv.vypoved), at: Date.now(),
          doba: nv.doba, vypoved: nv.vypoved };
        save(); paint(); spotSheet(sp, areaId);
        toast('Nájem domluven na ' + kcFull(S.leases[sp.id].rent) + ' měsíčně, '
          + dobaNazev(nv.doba).toLowerCase() + ', výpověď ' + vypovedNazev(nv.vypoved) + '.', 'ok');
      };
    };
    vykresli();
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
    b.onclick = function () {
      installSheet(sp, areaId, b.getAttribute('data-build'));
    };
  });
  [].forEach.call($('sheet-body').querySelectorAll('[data-doobchodu]'), function (go) {
    go.onclick = function () { closeSheet(); switchTab('shop'); };
  });
}
// Karta modelu na konkrétním místě. Postavit jde jen to, co je skladem — jinak vede do obchodu.
function modelCard(sp, e, pridej, bezTlacitka) {
  var m = MODELS[e.model], n = inStock(e.model), way = onWay(e.model);
  var btn;
  if (bezTlacitka) btn = '';
  else if (n > 0) btn = '<button class="btn sm" style="width:100%;margin-top:10px" data-build="' + e.model + '">Postavit (' + n + '× skladem)</button>';
  else if (way > 0) btn = '<p class="fine warn" style="margin:10px 0 0">' + way + '× je na cestě — až dorazí, postavíš ho tady.</p>';
  else btn = '<button class="btn sec sm" style="width:100%;margin-top:10px" data-doobchodu="' + e.model + '">Není skladem — do obchodu</button>';
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
    + btn + (pridej || '') + '</div>';
}

// ─── Financování (hotovost + úvěr z banky) ───────────────────────────────────
// Používá se stejně na nákup stroje v obchodě i na instalaci na místě, aby se
// hráč nikdy nezasekl bez hotovosti a bez možnosti si půjčit.
function investedTotal() { return S.units.reduce(function (a, u) { return a + u.eco.invest; }, 0); }
// Čisté jmění: co hráč má, minus co dluží. Kromě postavených prádlomatů se počítají
// i stroje na skladě a na cestě, pobočky a technika čety — to všechno už je zaplacené.
// Musí sedět s cisteJmeni() v routes/game-account.routes.js, podle kterého se staví
// žebříček. Když se vzorce rozejdou, hráč vidí dvě různá čísla pro tutéž věc.
function cisteJmeni() {
  var majetek = investedTotal();
  MODEL_ORDER.forEach(function (k) { majetek += inStock(k) * machinePrice(MODELS[k]); });
  (S.orders || []).forEach(function (o) {
    majetek += machinePrice(MODELS[o && o.model] || MODELS.mini);
  });
  majetek += (S.pobocky || []).length * POBOCKA_CENA;
  if (maCetu()) majetek += CETA_CENA;
  majetek += pozemkyHodnota();
  return Math.round(majetek + S.cash - S.loan);
}
function stockValue() {
  var v = 0;
  MODEL_ORDER.forEach(function (k) { v += (inStock(k) + onWay(k)) * machinePrice(MODELS[k]); });
  return v;
}
function assetsTotal() { return investedTotal() + stockValue() + pozemkyHodnota(); }
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
function doFinance(f, vazba) {
  S.cash -= f.own; S.bank -= f.need; pricistDluh(f.need, prirazkaZa(f.need), vazba);
  zapis('nakup', (vazba && vazba.popis) || 'Nákup', -f.own, f.need);
}
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
    save(); paint(); closeSheet();
    // Nejdřív uložíme síť (je v ní nová objednávka) a pak řekneme serveru, že
    // se kupovalo — ten z ní spočte provizi tomu, kdo nás do hry přivedl.
    // Provize se platí hned při nákupu, ne až až stroj dorazí a postaví se.
    syncState(true).then(function () {
      if (ME) apiJson('/account/nakup', { model: modelKey }).catch(function () { /* zkusí se přiště */ });
    });
    toast(m.name + ' objednán. Dorazí ' + etaText(DELIVERY_MONTHS * MONTH_MS) + '.', 'ok');
  };
}

// ─── Panel: instalace stroje ze skladu na místo ──────────────────────────────
// Příprava plochy bez stroje. Pozemek je můj, tak si na něm můžu nechat udělat
// cestu, parkování, dlažbu i přípojky dřív, než prádlomat vůbec existuje — a
// zaplatit to hned. Hotová plocha je součást nemovitosti: počítá se do majetku,
// banka ji bere jako zástavu a při stavbě se pak platí už jen doprava stroje.
function pripravaSheet(sp, areaId, drz) {
  if (!drz) FIN_OWN = null;
  var plan = planMista(sp.id);
  if (!plan || !plan.hotovo) return spotSheet(sp, areaId);
  var pady = planStroje(plan);
  var jiz = Math.round(Number(plan.zaplaceno) || 0);
  var cena = Math.max(0, Math.round(plan.cena || 0) - jiz);
  if (!cena) {
    save();
    toast('Plochu máš zaplacenou, nic se nedoplácí.', 'ok');
    return spotSheet(sp, areaId);
  }
  // Banka to posuzuje jako zhodnocení pozemku, ne jako výdělek místa — stroj tu
  // zatím žádný není, takže se nedá půjčovat proti jeho zisku.
  var f = canFinance(cena, FIN_OWN, cena);
  sheet('<h3>Připravit plochu</h3>'
    + '<p class="muted small">' + esc(sp.name) + ' — cesta, parkování, dlažba a přípojky podle tvého návrhu. '
    + 'Stroje mít nemusíš: plocha počká, až je vyrobíš nebo koupíš.</p>'
    + '<div class="kv"><span>Stání na prádlomaty</span><b>' + pady.length + '\u00d7 ('
    + esc(pady.map(function (x) { return (MODELS[x.model] || {}).name || ''; }).join(', ')) + ')</b></div>'
    + (jiz
        ? '<div class="kv"><span>Příprava podle návrhu</span><b>' + kcFull(plan.cena) + '</b></div>'
          + '<div class="kv"><span>Zaplaceno dřív</span><b class="ok">\u2212' + kcFull(jiz) + '</b></div>'
          + '<div class="kv souhrn"><span>Doplatek</span><b>' + kcFull(cena) + '</b></div>'
        : '<div class="kv souhrn"><span>Příprava celkem</span><b>' + kcFull(cena) + '</b></div>')
    + financeRows(f)
    + '<p class="fine">Hotová plocha zůstane u pozemku — počítá se do majetku a banka ji bere jako zástavu. '
    + 'Při stavbě pak platíš jen dopravu stroje.</p>'
    + '<button class="btn big" id="do-priprava"' + (f.ok ? '' : ' disabled')
    + ' style="width:100%;margin-top:10px">Nechat udělat</button>'
    + (f.ok ? (f.dotkne_rezervy ? '<p class="fine warn">Sáhneš i do provozní rezervy — po zaplacení ti zbude '
          + kcFull(S.cash - f.own) + '.</p>' : '')
        : '<p class="fine err">' + esc(f.duvod || '') + '</p>'
          + '<p class="fine">' + esc(dohnat(f.chybi)) + '</p>'));
  bindFinance(function () { pripravaSheet(sp, areaId, true); });
  var bp = $('do-priprava');
  if (bp) bp.onclick = function () {
    doFinance(f, { druh: 'misto', spotId: sp.id, popis: 'Příprava plochy — ' + sp.name });
    plan.zaplaceno = Math.round(plan.cena || 0);
    pozemky().forEach(function (z) { if (z.spotId === sp.id) z.priprava = plan.zaplaceno; });
    save(); paint(); drawMap(); syncState(true);
    toast('Plocha je připravená na ' + pady.length + ' ' + mn(pady.length, 'prádlomat', 'prádlomaty', 'prádlomatů')
      + '. Až stroj dorazí, zaplatíš jen dopravu.', 'ok');
    spotSheet(sp, areaId);
  };
}
function installSheet(sp, areaId, modelKey, drz, pad) {
  if (!drz) FIN_OWN = null;
  var mam = mamPozemek(sp.id);
  // Pronajatý cizí pozemek: zábor na základním id drží majitel, můj stroj
  // dostane vlastní.
  var pron = (S.leases[sp.id] || {}).pronajem ? S.leases[sp.id] : null;
  // Kolikátý stroj na pozemku to bude — podle toho se dělí zákazníci.
  var uzStoji = mam ? strojuNaPozemku(sp.id) : 0;
  var m = MODELS[modelKey], e = economics(sp, modelKey, mam ? padPodil(uzStoji) : 1);
  var doprava = dopravaNa(sp, modelKey);
  var spotId = pron ? padId(sp.id, 1) : padId(sp.id, mam && pad ? pad : 0);
  var ceta = !mam && cetaZvladne(sp);
  var celkem = e.conn + doprava;
  // Banka tohle místo posuzuje podle toho, co vydělá ono samo.
  var f = canFinance(celkem, FIN_OWN, stropPodleZisku(e.profit, celkem));
  var n = nejblizsiZakladna(sp);
  sheet('<h3>Postavit ' + m.name + '</h3>'
    + '<p class="muted small">' + esc(sp.name) + (mam && pad ? ' \u00b7 ' + (pad + 1) + '. stání' : '')
    + ' — teď se platí '
    + (mam && !e.conn
        ? 'jen doprava stroje; plochu máš hotovou a zaplacenou'
        : (mam ? 'příprava plochy podle tvého návrhu'
            : jeZasitovane(sp) ? 'instalace stroje' : 'přípojky (voda, odpad, elektřina)')
          + ' a doprava')
    + '. Stroj máš skladem' + (mam ? '.' : ', nájem domluvený.') + '</p>'
    + (pron ? '<p class="fine">Stojíš na cizím pozemku — zem patří majiteli, prádlomat tobě. '
        + 'Nájem ' + kcFull(e.rent) + ' měsíčně mu chodí automaticky.</p>' : '')
    + (!S.sidlo ? '<p class="fine ok">Touhle stavbou vznikne sídlo tvojí firmy — ve městě, ne na téhle adrese. '
        + 'Od něj se pak počítá doprava všech dalších strojů, tak si rozmysli, kde začínáš.</p>' : '')
    + (uzStoji ? '<p class="fine warn">Na tomhle pozemku už ' + (uzStoji === 1 ? 'jeden prádlomat stojí'
          : uzStoji + ' prádlomaty stojí') + '. Zákazníci kolem jsou společní, takže tenhle vydělá '
        + Math.round(padPodil(uzStoji) * 100) + ' % toho prvního.</p>' : '')
    + '<div class="kv"><span>' + (mam ? 'Příprava plochy a přípojky'
        : jeZasitovane(sp) ? 'Instalace' : ceta ? 'Přípojky vlastní četou' : 'Přípojky') + '</span><b'
    + (ceta || (mam && !e.conn) ? ' class="ok"' : '') + '>'
    + (mam && !e.conn ? 'zaplaceno předem' : kcFull(e.conn)) + '</b></div>'
    + (ceta ? '<p class="fine ok">Staví tvoje parta za ' + Math.round(CETA_PODIL * 100)
      + ' % ceny. Tenhle měsíc jí zbývá ' + cetaZbyva() + ' z ' + CETA_MIST + ' míst.</p>' : '')
    + '<div class="kv"><span>Doprava stroje' + (n ? ' (' + Math.round(n.km) + ' km)' : '') + '</span><b'
    + (doprava > 0 ? ' class="warn"' : '') + '>' + (doprava > 0 ? kcFull(doprava) : 'zdarma — sídlo vzniká tady') + '</b></div>'
    + financeRows(f)
    + (mam ? '<div class="kv"><span>Nájem</span><b class="ok">žádný — zem je tvoje</b></div>'
        : '<div class="kv"><span>Domluvený nájem</span><b>' + kcFull(e.rent) + ' / měsíc</b></div>')
    + '<div class="kv"><span>Zisk tohohle stroje / měsíc</span><b class="ok">' + kcFull(e.profit) + '</b></div>'
    + (splatkyMesicne() > monthlyProfit() + e.profit
        ? '<p class="fine warn">I s tímhle místem vyděláš ' + kcFull(Math.round(monthlyProfit() + e.profit))
          + ' měsíčně, ale na splátkách platíš ' + kcFull(splatkyMesicne())
          + '. Rozdíl ti ubírá z hotovosti, dokud nepřidáš další prádlomat.</p>'
        : '')
    + '<button class="btn big" id="do-build"' + (f.ok ? '' : ' disabled') + '>Postavit</button>'
    + (f.ok ? (f.dotkne_rezervy ? '<p class="fine warn">Sáhneš i do provozní rezervy — po stavbě ti zbude ' + kcFull(S.cash - f.own) + '.</p>' : '')
        : '<p class="fine err">' + esc(f.duvod || '') + '</p>'
          + '<p class="fine">' + esc(dohnat(f.chybi)) + '</p>'
          + '<button class="btn sec" id="go-bank" style="width:100%;margin-top:8px">Zkusit úvěr v bance</button>'));
  bindFinance(function () { installSheet(sp, areaId, modelKey, true, pad); });
  var gb = $('go-bank');
  if (gb) gb.onclick = function () { closeSheet(); switchTab('bank'); uverSheet(); };
  var b = $('do-build');
  if (b) b.onclick = function () {
    // Místo si nejdřív zabereme na serveru — na jednom místě smí stát jen jeden.
    b.disabled = true; b.textContent = 'Stavím…';
    var sml = S.leases[sp.id] || {};
    var dlat = (pad && !pron) ? 0.00008 * pad : 0, dlon = (pad && !pron) ? 0.00011 * pad : 0;
    var nazev = sp.name + (pad ? ' \u2014 ' + (pad + 1) + '. stání' : '');
    // Na vlastním pozemku zábor prvního stání už existuje — jen se do něj dopíše
    // stroj. Každé další stání dostane vlastní zábor na téže zemi.
    var volani = pron
      ? apiJson('/spots/claim', { spot_id: spotId, area_key: areaId, model: modelKey,
          rent: e.rent, name: sp.name, lat: sp.lat, lon: sp.lon, pozemek: true })
      : mam
      ? (pad
          ? apiJson('/spots/claim', { spot_id: spotId, area_key: areaId, model: modelKey, rent: 0,
              name: nazev, lat: sp.lat + dlat, lon: sp.lon + dlon, pozemek: true })
          : apiJson('/spots/stavba', { spot_id: sp.id, model: modelKey }))
      : apiJson('/spots/claim', { spot_id: sp.id, area_key: areaId, model: modelKey,
          rent: e.rent, name: sp.name, lat: sp.lat, lon: sp.lon, pozemek: false,
          doba_mesicu: sml.doba || 0, vypoved_mesicu: sml.vypoved || 1 });
    volani.then(function (r) {
      b.disabled = false; b.textContent = 'Postavit';
      if (!r.ok) {
        if (r.j.occupied) CLAIMS[spotId] = r.j.occupied;
        drawMap(); closeSheet();
        return toast(r.j.error || 'Místo je obsazené.', 'err');
      }
      CLAIMS[spotId] = r.j.spot;
      // Zem je v majetku zvlášť — v investici stání je jen stroj a doprava.
      if (mam) pozemky().forEach(function (z) { if (z.spotId === sp.id) z.zastaveno = 1; });
      doFinance(f, { druh: 'misto', spotId: spotId,
        popis: (mam ? (e.conn ? 'Příprava plochy — ' : 'Doprava stroje — ') : 'Přípojky — ') + sp.name });
      pripojUverKeStroji(spotId, sp.name);
      if (ceta) cetaPostavila(sp);
      // První stavba zakládá sídlo — ale ve městě, ne na adrese prádlomatu.
      // Firma má vlastní adresu; sdílet ji s provozovnou by nedávalo smysl.
      if (!S.sidlo) {
        var a = S.areas[areaId], str = stredOblasti(a);
        S.sidlo = { name: (a && a.name) || sp.name, lat: str ? str.lat : sp.lat,
          lon: str ? str.lon : sp.lon, od: Date.now() };
        toast('Sídlo firmy máš v ' + S.sidlo.name + '. Změnit se nedá.', 'ok');
      }
      S.stock[modelKey] = inStock(modelKey) - 1;
      S.units.push({ spotId: spotId, areaId: areaId, name: nazev, kind: sp.kind, score: sp.score,
        lat: sp.lat + dlat, lon: sp.lon + dlon, builtAt: Date.now(), eco: e });
      ev('game_build');
      save(); paint(); drawMap(); closeSheet(); syncState(true);
      toast('Prádlomat stojí. Vydělává ' + kcFull(e.profit) + ' měsíčně.', 'ok');
    }).catch(function () { b.disabled = false; b.textContent = 'Postavit'; toast('Server neodpovídá.', 'err'); });
  };
}


// ─── Pronájem vlastního pozemku ──────────────────────────────────────────────
// Zem je nemovitost: nemusí na ní stát můj prádlomat, aby vydělávala. Můžu ji
// pronajmout jinému hráči — buď jako holou parcelu, kde si přípojky vybuduje
// a zaplatí sám, nebo s připravenou plochou, za kterou si řeknu víc. Nájem mi
// pak chodí každý herní měsíc, i když na pozemku sám nic nemám.
var PRONAJEM_HOLY = 0.6;        // holá parcela: podíl z nájmu, co by místo neslo
var PRONAJEM_SIT = 1.3;         // s hotovou plochou: majitel do ní dal peníze
function navrhNajmu(sp, sit) {
  return Math.max(500, Math.round(rentOf(sp) * (sit ? PRONAJEM_SIT : PRONAJEM_HOLY) / 100) * 100);
}
function pronajemKarta(sp, claim, maPlochu, stoji) {
  var n = claim && claim.najemce;
  if (n) {
    return '<div class="card"><div class="row"><h3>Pronajato</h3><b class="ok">' + kcFull(n.cena) + ' / měsíc</b></div>'
      + '<p class="muted small" style="margin:4px 0 8px">Zem má pronajatou <b>' + esc(n.firma) + '</b> ('
      + esc(n.nick) + ')' + (n.sit ? ' i s připravenou plochou' : ' jako holou parcelu')
      + '. Nájem ti chodí každý herní měsíc — na pozemku zatím stavět nemůžeš.</p>'
      + '<button class="btn sec" id="do-najem-konec" style="width:100%">Ukončit pronájem</button></div>';
  }
  if (stoji) return '';
  var nab = claim && claim.pronajem;
  var sit = nab ? !!nab.sit : maPlochu;
  var cena = nab ? nab.cena : navrhNajmu(sp, sit);
  return '<div class="card"><div class="row"><h3>Pronajmout jinému hráči</h3>'
    + (nab ? '<b class="ok">v nabídce</b>' : '') + '</div>'
    + '<p class="muted small" style="margin:4px 0 8px">Na zemi nemusíš stavět sám. Nabídni ji ostatním: '
    + 'postaví si tu svůj prádlomat a tobě bude chodit nájem.</p>'
    + '<div class="seg sub najem-seg">'
    + '<button class="' + (sit ? '' : 'on') + '" data-pron-sit="0">Holá parcela</button>'
    + '<button class="' + (sit ? 'on' : '') + '"' + (maPlochu ? '' : ' disabled') + ' data-pron-sit="1">S hotovou plochou</button>'
    + '</div>'
    + '<p class="fine">' + (sit
        ? 'Nájemce nestaví ani neplatí přípojky — má je hotové od tebe, a proto platí víc.'
        : 'Nájemce si cestu, parkování i přípojky vybuduje a zaplatí sám. Nájem je za to nižší.')
      + (maPlochu ? '' : ' Plochu zatím připravenou nemáš, tak jde nabídnout jen holá parcela.') + '</p>'
    + '<label class="fld" style="margin-top:8px"><span>Nájem za měsíc</span>'
    + '<input id="pron-cena" class="inp" type="number" min="0" step="100" value="' + cena + '"></label>'
    + '<p class="fine">Obvyklé nájemné v okolí je ' + kcFull(rentOf(sp)) + ' / měsíc.</p>'
    + '<button class="btn big" id="do-pronajem" style="width:100%;margin-top:8px">'
    + (nab ? 'Upravit nabídku' : 'Nabídnout k pronájmu') + '</button>'
    + (nab ? '<button class="btn sec" id="do-pronajem-stop" style="width:100%;margin-top:8px">Stáhnout nabídku</button>' : '')
    + '</div>';
}
function bindPronajem(sp, areaId, claim) {
  var maPlochu = !!(planMista(sp.id) && planMista(sp.id).hotovo && planMista(sp.id).zaplaceno);
  var sit = claim && claim.pronajem ? !!claim.pronajem.sit : maPlochu;
  [].forEach.call($('sheet-body').querySelectorAll('[data-pron-sit]'), function (b) {
    b.onclick = function () {
      sit = b.getAttribute('data-pron-sit') === '1';
      if (sit && !maPlochu) return toast('Nejdřív připrav a zaplať plochu.', 'err');
      var i = $('pron-cena');
      if (i) i.value = navrhNajmu(sp, sit);
      [].forEach.call($('sheet-body').querySelectorAll('[data-pron-sit]'), function (x) {
        x.classList.toggle('on', (x.getAttribute('data-pron-sit') === '1') === sit);
      });
    };
  });
  var pb = $('do-pronajem');
  if (pb) pb.onclick = function () {
    var cena = Math.max(0, Math.round(Number(($('pron-cena') || {}).value) || 0));
    if (cena < 100) return toast('Dej nájmu nějakou rozumnou cenu.', 'err');
    pb.disabled = true; pb.textContent = 'Zapisuji…';
    apiJson('/spots/pronajem', { spot_id: sp.id, cena: cena, sit: sit }).then(function (r) {
      pb.disabled = false;
      if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
      CLAIMS[sp.id] = r.j.spot;
      drawMap(); toast('Pozemek je v nabídce za ' + kcFull(cena) + ' měsíčně.', 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { pb.disabled = false; toast('Server neodpovídá.', 'err'); });
  };
  var sb = $('do-pronajem-stop');
  if (sb) sb.onclick = function () {
    apiJson('/spots/pronajem', { spot_id: sp.id, cena: 0 }).then(function (r) {
      if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
      CLAIMS[sp.id] = r.j.spot;
      drawMap(); toast('Nabídka stažená.', 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { toast('Server neodpovídá.', 'err'); });
  };
  var kb = $('do-najem-konec');
  if (kb) kb.onclick = function () {
    kb.disabled = true;
    apiJson('/spots/najem-konec', { spot_id: sp.id }).then(function (r) {
      kb.disabled = false;
      if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
      CLAIMS[sp.id] = r.j.spot;
      nactiNajmy(function () { vyzvedniNasledky(); });
      drawMap(); toast('Pronájem skončil.', 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { kb.disabled = false; toast('Server neodpovídá.', 'err'); });
  };
}
// Cizí pozemek. Koupit se nedá — zem se dál neprodává. Když ji ale majitel
// nabízí, dá se na ní stavět za nájem: zem zůstane jeho, prádlomat je můj.
function cizipozemekSheet(sp, areaId, c) {
  var n = c.pronajem;
  sheet('<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[sp.kind] || 'Místo') + ' · '
    + esc(S.areas[areaId] ? S.areas[areaId].name : '') + ' · <b class="warn">cizí pozemek</b></p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<div class="card"><div class="row"><h3>' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '') + esc(c.firma) + '</h3>'
    + '<b class="muted small">' + esc(c.nick) + '</b></div>'
    + '<p class="muted small" style="margin:4px 0 0">' + (n
        ? 'Zem patří téhle firmě a nabízí ji k pronájmu. Koupit ji nejde — pozemky se dál neprodávají.'
        : c.najemce ? 'Zem patří téhle firmě a už je pronajatá někomu jinému.'
        : 'Zem patří téhle firmě a zatím ji nikomu nenabízí.') + '</p></div>'
    + (n
        ? '<h3 style="margin-top:18px">Nabídka pronájmu</h3>'
          + '<div class="kv"><span>Nájem</span><b class="warn">' + kcFull(n.cena) + ' / měsíc</b></div>'
          + '<div class="kv"><span>Plocha</span><b class="' + (n.sit ? 'ok' : '') + '">'
          + (n.sit ? 'připravená — přípojky hotové' : 'holá parcela') + '</b></div>'
          + '<p class="fine">' + (n.sit
              ? 'Cestu, parkování i přípojky zaplatil majitel. Ty platíš jen dopravu stroje a nájem.'
              : 'Cestu, parkování i přípojky si vybuduješ a zaplatíš ty — nájem je za to nižší.') + '</p>'
          + '<button class="btn big" id="do-najmout" style="width:100%;margin-top:10px">Pronajmout si</button>'
          + '<p class="fine">Zem zůstává majiteli, prádlomat je tvůj. Přeplatit tě tu nikdo nemůže.</p>'
        : ''));
  var nb = $('do-najmout');
  if (nb) nb.onclick = function () {
    nb.disabled = true; nb.textContent = 'Domlouvám…';
    apiJson('/spots/najmout', { spot_id: sp.id }).then(function (r) {
      nb.disabled = false; nb.textContent = 'Pronajmout si';
      if (!r.ok) {
        if (r.j.spot) CLAIMS[sp.id] = r.j.spot;
        drawMap(); closeSheet();
        return toast(r.j.error || 'Nepovedlo se.', 'err');
      }
      CLAIMS[sp.id] = r.j.spot;
      S.leases[sp.id] = { rent: n.cena, at: Date.now(), pronajem: 1, sit: !!n.sit, majitel: c.firma };
      save(); paint(); drawMap(); syncState(true);
      toast('Pozemek máš pronajatý. Teď na něj postav prádlomat.', 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { nb.disabled = false; nb.textContent = 'Pronajmout si'; toast('Server neodpovídá.', 'err'); });
  };
}
// Nájmy si server spočítá sám, jen ho musíme šťouchnout — pak přijdou jako
// obyčejná dodávka hotovosti, stejně jako provize ze sítě.
var NAJMY = null;
function nactiNajmy(then) {
  if (!ME) { if (then) then(); return; }
  api('/spots/najmy').then(function (r) {
    NAJMY = (r.ok && r.j.pozemky) || [];
    if (then) then();
  }).catch(function () { if (then) then(); });
}
function najmyMesicne() {
  return (NAJMY || []).reduce(function (a, c) {
    return a + ((c.najemce && c.najemce.cena) || 0);
  }, 0);
}

// ─── Konkurence: jedno místo, jeden prádlomat ───────────────────────────────
// Kdo kde stojí, rozhoduje server — jinak by si dva hráči postavili na totéž
// místo. Cizí prádlomaty vidíš na mapě i s nickem, ale NE s nájmem: přeplatit
// konkurenta znamená nabídnout naslepo a za nepovedené vyjednávání zaplatit.
var CLAIMS = {};          // id místa → { nick, model, mine, takeovers, rent }
var BID_FEE = 5000;
function areaKeys() { return Object.keys(S && S.areas ? S.areas : {}); }

// ─── Pozemky na prodej ───────────────────────────────────────────────────────
// Dvě pětiny nalezených míst se nepronajímají — prodávají se. Kdo si pozemek koupí,
// neplatí žádný nájem a nikdo ho odtamtud nevyhodí: nedá se přeplatit, protože
// zem je jeho. Zaplatí to ale jednou a pořádně — samotnou zem podle výměry
// a k tomu přípravu zelené louky: příjezdovou cestu, parkování, přivedení
// elektřiny, vody a odpadu a vydlážděnou plochu pod prádlomat.
//
// Které místo je pozemek, se počítá z jeho id, ne z nálezu — takže se pozemky
// objeví i ve městech, která má hráč prozkoumaná odedávna.
var POZEMKU_PODIL = 0.40;        // dvě pětiny míst jsou na prodej
var POZEMEK_M2_MIN = 180, POZEMEK_M2_MAX = 420;
var POZEMEK_ZA_M2_MIN = 300, POZEMEK_ZA_M2_MAX = 1200;
var POZEMEK_STAVBA = 2.2;        // příprava louky proti běžným přípojkám
function jePozemek(sp) { return !!sp && spotHash(sp.id, 'poz') < POZEMKU_PODIL; }
function pozemekM2(sp) {
  // Zaokrouhlíme na celé metry mřížky, aby výměra v nabídce seděla s plánem,
  // na kterém pak hráč staví.
  var hrube = POZEMEK_M2_MIN + spotHash(sp.id, 'm2') * (POZEMEK_M2_MAX - POZEMEK_M2_MIN);
  var r = planRozmer(hrube);
  return r.w * r.h;
}
// Lepší adresa, dražší zem. K tomu trocha náhody podle konkrétního pozemku.
function pozemekZaM2(sp) {
  var lukrativ = 0.6 + (Math.max(0, Math.min(100, sp.score)) / 100) * 0.6;
  var zaklad = POZEMEK_ZA_M2_MIN + spotHash(sp.id, 'cm') * (POZEMEK_ZA_M2_MAX - POZEMEK_ZA_M2_MIN);
  return Math.round(zaklad * lukrativ / 50) * 50;
}
function pozemekCena(sp) { return pozemekM2(sp) * pozemekZaM2(sp); }
// Koupené pozemky. Zem je nemovitost: patří do majetku i prázdná a banka proti
// ní půjčí stejně jako proti strojům — proto se počítá do zástavy.
function pozemky() {
  if (!Array.isArray(S.pozemky)) S.pozemky = [];
  return S.pozemky;
}
// Na jeden pozemek se vejde víc prádlomatů. První stání drží zábor pozemku,
// každé další dostane vlastní — v žebříčku je to samostatný prádlomat.
function padId(spotId, i) { return i ? spotId + '#' + i : spotId; }
function padObsazen(sp, i) {
  var id = padId(sp.id, i);
  return S.units.some(function (u) { return u.spotId === id; });
}
function strojuNaPozemku(spotId) {
  return S.units.filter(function (u) {
    return u.spotId === spotId || String(u.spotId || '').indexOf(spotId + '#') === 0;
  }).length;
}
// Kolikátý stroj v pořadí, tolik zákazníků. Druhý a třetí si nové nepřivedou,
// jen uberou frontu tomu prvnímu.
var POZEMEK_PODILY = [1, 0.6, 0.45];
function padPodil(kolikatyUz) {
  return POZEMEK_PODILY[Math.min(Math.max(0, kolikatyUz), POZEMEK_PODILY.length - 1)];
}
function mamPozemek(spotId) {
  return pozemky().some(function (z) { return z.spotId === spotId; });
}
// Do majetku patří všechna koupená zem, i ta pod stojícím prádlomatem — a k ní
// příprava plochy, pokud ji hráč zaplatil dopředu, ještě bez stroje. V investici
// místa je jen stroj a to, co se dodělávalo až při stavbě.
function pozemkyHodnota() {
  return pozemky().reduce(function (a, z) { return a + (z.cena || 0) + (z.priprava || 0); }, 0);
}
function pozemkyPrazdne() {
  return pozemky().filter(function (z) { return !z.zastaveno; });
}
// Vlastní pozemek pod prádlomatem — zjistí se z toho, co o místě ví server.
function maPozemek(spotId) {
  var c = CLAIMS[spotId];
  return !!(c && c.pozemek);
}
// Koupě samotné země. Zábor na serveru vznikne hned, i když na něm zatím nic
// nestojí — jinak by pozemek pod rukama koupil někdo jiný.
function koupitPozemek(sp, areaId, btn) {
  var cena = pozemekCena(sp);
  var f = canFinance(cena, null, cena);
  if (!f.ok) return toast(f.duvod || 'Na pozemek zatím nemáš.', 'err');
  if (btn) { btn.disabled = true; btn.textContent = 'Kupuji…'; }
  apiJson('/spots/claim', { spot_id: sp.id, area_key: areaId, model: '', rent: 0,
    name: sp.name, lat: sp.lat, lon: sp.lon, pozemek: true }).then(function (r) {
    if (btn) { btn.disabled = false; btn.textContent = 'Koupit pozemek bez stroje'; }
    if (!r.ok) {
      if (r.j.occupied) CLAIMS[sp.id] = r.j.occupied;
      drawMap(); closeSheet();
      return toast(r.j.error || 'Místo je obsazené.', 'err');
    }
    CLAIMS[sp.id] = r.j.spot;
    doFinance(f, { druh: 'pozemek', spotId: sp.id, popis: 'Pozemek — ' + sp.name });
    pozemky().push({ spotId: sp.id, areaId: areaId, name: sp.name, lat: sp.lat, lon: sp.lon,
      m2: pozemekM2(sp), cena: cena, od: Date.now() });
    save(); paint(); drawMap(); closeSheet(); syncState(true);
    toast('Pozemek je tvůj. Postavit na něm můžeš, až budeš chtít.', 'ok');
  }).catch(function () {
    if (btn) { btn.disabled = false; btn.textContent = 'Koupit pozemek bez stroje'; }
    toast('Server neodpovídá.', 'err');
  });
}
function pozemekKarta(sp) {
  var m2 = pozemekM2(sp), zaM2 = pozemekZaM2(sp);
  return '<h3 style="margin-top:18px">Pozemek na prodej</h3>'
    + '<p class="muted small">Tohle místo se nepronajímá, prodává se. Když ho koupíš, neplatíš '
    + 'žádný nájem a nikdo tě odtud nevyhodí — zem je tvoje. Je to ale holá parcela: '
    + 'příjezdovou cestu, parkování, přípojky i dlažbu pod stroj zaplatíš ty.</p>'
    + '<div class="kv"><span>Výměra</span><b>' + m2 + ' m²</b></div>'
    + '<div class="kv"><span>Cena za m²</span><b>' + kcFull(zaM2) + '</b></div>'
    + '<div class="kv souhrn"><span>Pozemek celkem</span><b>' + kcFull(m2 * zaM2) + '</b></div>'
    + '<div class="kv"><span>Nájem</span><b class="ok">žádný</b></div>'
    + '<p class="fine">Příprava louky je zhruba ' + POZEMEK_STAVBA.toFixed(1).replace('.', ',')
    + '× dražší než napojení na hotovém místě. Zaplatí se to tím, že za tohle místo '
    + 'nikdy nikomu nic neplatíš a nikdo ti ho nevezme.</p>';
}
// ─── Příprava pozemku ────────────────────────────────────────────────────────
// Koupená zem je jen tráva. Než na ní může stát prádlomat, musí hráč sám
// navrhnout, jak to tam bude vypadat: kudy se přijede, kde se zaparkuje, kam
// přijde stroj a jak daleko se k němu musí natáhnout elektřina, voda a odpad.
// Cena přípravy se počítá z toho, co doopravdy nakreslí — čím dál od ulice
// stroj posadí, tím delší přípojky a tím dražší místo.
//
// Plán je mřížka po metrech. Spodní řada plochy sousedí s ulicí; tam je i bod,
// odkud se přípojky táhnou.
var PLAN_DLAZBA_M2 = 1200;       // zámková dlažba kolem stroje
var PLAN_CESTA_M2 = 1800;        // asfaltová příjezdová cesta
var PLAN_STANI = 12000;          // jedno parkovací stání i s vodorovným značením
var PLAN_POPLATKY = 60000;       // připojovací poplatky, ať jsou trasy jakkoli dlouhé
var PLAN_STANI_MIN = 2;          // bez dvou stání to město nezkolauduje
// Skutečné rozměry prádlomatů: hloubka je u všech stejná, liší se šířka.
// Před strojem ještě zbyde metr na dlažbu, aby se nestoupalo z trávy.
var PLAN_ROZMERY = { mini: [2.4, 2], flex: [3.15, 2], max: [4.2, 2] };
// Kolmé stání se značí 2,5 × 4 m — tak se kreslí i na parkovištích u obchodů.
var PLAN_STANI_ROZMER = [2.5, 4];
// Vozovka: jednosměrka má 3 m, obousměrná 6 m. Štětec kreslí rovnou celou šířku,
// aby se cesta nekreslila po metrech.
var PLAN_CESTA_SIRKY = [3, 5];
// Každé médium se táhne zvlášť a z jiného místa ulice — v reálu nevede voda,
// elektřina a kanalizace jedním výkopem od jednoho sloupku. Ceny za metr dávají
// dohromady to, co dřív stál jeden společný výkop.
var PLAN_MEDIA = [
  { k: 'voda', n: 'Voda', b: '#4ab8ff', m: 2200 },
  { k: 'elektrina', n: 'Elektřina', b: '#ffd34a', m: 2400 },
  { k: 'odpad', n: 'Kanalizace', b: '#b39bff', m: 2000 }
];
var PLAN_PRAZDNO = 0, PLAN_DLAZBA = 1, PLAN_CESTA = 2, PLAN_STANI_B = 3, PLAN_STROJ = 9;
var PLAN_NARADI = [
  { k: 'cesta', n: 'Cesta', b: PLAN_CESTA, p: 'Asfalt, po kterém se k prádlomatu dojede. Musí navazovat na ulici.' },
  { k: 'dlazba', n: 'Dlažba', b: PLAN_DLAZBA, p: 'Zámková dlažba okolo stroje, aby se nechodilo v blátě.' },
  { k: 'guma', n: 'Guma', b: PLAN_PRAZDNO, p: 'Smaže, co jsi nakreslil. Tráva nic nestojí.' }
];
// Rozměry parcely v metrech. Držíme ji obdélníkovou, mírně do šířky k ulici.
function planRozmer(m2) {
  var w = Math.max(8, Math.round(Math.sqrt(m2 * 1.6)));
  var h = Math.max(6, Math.round(m2 / w));
  return { w: w, h: h };
}
// Kde na ulici je který sloupek. Pro každý pozemek stejný, ať se plán po
// znovuotevření nemění — a pro každé médium jinde, jako doopravdy.
function planPripojka(sp, w, k) {
  return Math.max(1, Math.min(w - 2, Math.round(spotHash(sp && sp.id, 'prip-' + (k || '')) * (w - 2))));
}
// Sloupek média na hotovém plánu. Starší plány mají jen jeden — ostatní dvě
// média se od něj rozestoupí, ať se výkopy nekreslí přes sebe.
function planSloupek(p, k) {
  if (!p.pripojky) {
    var z = p.prip || 1;
    p.pripojky = { voda: z, elektrina: Math.min(p.w - 1, z + 3), odpad: Math.max(0, z - 3) };
  }
  var x = p.pripojky[k];
  return Math.max(0, Math.min(p.w - 1, x == null ? (p.prip || 1) : x));
}
function planyVse() {
  if (!S.plany || typeof S.plany !== 'object') S.plany = {};
  return S.plany;
}
function planMista(spotId) { return planyVse()[spotId] || null; }
// Prázdný plán: samá tráva, stroj zatím nikde.
function planNovy(sp) {
  var m2 = pozemekM2(sp), r = planRozmer(m2);
  var b = [];
  for (var i = 0; i < r.w * r.h; i++) b.push(PLAN_PRAZDNO);
  var pr = {};
  PLAN_MEDIA.forEach(function (md) { pr[md.k] = planPripojka(sp, r.w, md.k); });
  return { w: r.w, h: r.h, b: b, stroje: [], stani: [], pripojky: pr, prip: pr.voda };
}
// Stání na plánu. Starší plány měly jen jeden stroj — převedou se, ať se hráč,
// který už něco připravil, nedívá na prázdnou parcelu.
function planStroje(p) {
  if (!p) return [];
  if (!Array.isArray(p.stroje)) {
    p.stroje = p.stroj
      ? [{ x: p.stroj.x, y: p.stroj.y, w: p.stroj.w, h: p.stroj.h, model: p.model || 'mini' }]
      : [];
    p.stroj = null;
  }
  return p.stroje;
}
// Parkovací stání. Dřív se malovala po políčkách — co takhle vzniklo, převedeme
// na stání v jejich původní velikosti, ať zaplacený plán nepřestane platit.
function planStani(p) {
  if (!p) return [];
  if (!Array.isArray(p.stani)) {
    p.stani = [];
    for (var y = 0; y < p.h; y++) {
      for (var x = 0; x < p.w; x++) {
        if (p.b[planIndex(p, x, y)] !== PLAN_STANI_B) continue;
        p.b[planIndex(p, x, y)] = PLAN_PRAZDNO;
        if (planBunka(p, x, y + 1) === PLAN_STANI_B) {
          p.b[planIndex(p, x, y + 1)] = PLAN_PRAZDNO;
          p.stani.push({ x: x, y: y, w: 1, h: 2 });
        }
      }
    }
  }
  return p.stani;
}
// Stroj nemá rozměry na celé metry, mřížka ano — tak zabere tolik políček,
// kolik jich opravdu překryje.
function planCely(v) { return Math.max(1, Math.ceil(Number(v) - 0.001)); }
function cisloM(v) { return String(Math.round(Number(v) * 100) / 100).replace('.', ','); }
function padBunky(st) {
  var out = [];
  var x0 = Math.floor(st.x + 0.001), y0 = Math.floor(st.y + 0.001);
  var x1 = Math.ceil(st.x + st.w - 0.001) - 1, y1 = Math.ceil(st.y + st.h - 0.001) - 1;
  for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}
// Stroje i stání stojí na přesných metrech, mřížka je po celých — překryv se
// proto počítá obdélníky, ne políčky. Jinak by dvě stání vedle sebe nešla
// postavit těsně na sraz, jak se parkoviště kreslí doopravdy.
function planPrekryv(a, b) {
  return a.x < b.x + b.w - 0.001 && a.x + a.w > b.x + 0.001
    && a.y < b.y + b.h - 0.001 && a.y + a.h > b.y + 0.001;
}
function planVolnoRect(p, r, kromeStani) {
  if (r.x < -0.001 || r.y < -0.001 || r.x + r.w > p.w + 0.001 || r.y + r.h > p.h + 0.001) return false;
  if (planStroje(p).some(function (o) { return planPrekryv(r, o); })) return false;
  return !planStani(p).some(function (o, i) { return i !== kromeStani && planPrekryv(r, o); });
}
// Je tohle políčko pod strojem nebo stáním?
function planVRectu(st, x, y) {
  return x < st.x + st.w - 0.001 && x + 1 > st.x + 0.001
    && y < st.y + st.h - 0.001 && y + 1 > st.y + 0.001;
}
// Otočení o 90°. Na úzkou parcelu se stroj i stání musí dát postavit nadél.
var PLAN_OTOCENO = false;
function planRozmerStroje(k) {
  var r = PLAN_ROZMERY[k] || PLAN_ROZMERY.mini;
  return PLAN_OTOCENO ? [r[1], r[0]] : [r[0], r[1]];
}
function planRozmerStani() {
  var r = PLAN_STANI_ROZMER;
  return PLAN_OTOCENO ? [r[1], r[0]] : [r[0], r[1]];
}
function planIndex(p, x, y) { return y * p.w + x; }
function planBunka(p, x, y) {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
  return p.b[planIndex(p, x, y)];
}
// Políčka, na kterých stojí stroje. Pod nimi je dlažba vždycky.
function planStrojBunky(p, mimo) {
  var out = [];
  planStroje(p).forEach(function (st, i) {
    if (mimo != null && i === mimo) return;
    padBunky(st).forEach(function (c) { out.push(c); });
  });
  return out;
}
// Políčka pod parkovacími stáními — zabraná jsou stejně jako pod strojem.
function planStaniBunky(p, mimo) {
  var out = [];
  planStani(p).forEach(function (st, i) {
    if (mimo != null && i === mimo) return;
    padBunky(st).forEach(function (c) { out.push(c); });
  });
  return out;
}
// Je na tomhle políčku stání nebo stroj?
function planPodStrojem(p, x, y) {
  return planStroje(p).some(function (st) { return planVRectu(st, x, y); });
}
function planObsazeno(p, x, y) {
  if (planPodStrojem(p, x, y)) return true;
  return planStani(p).some(function (st) { return planVRectu(st, x, y); });
}
function planZpet(rodic, k) {
  var out = [];
  while (k) { out.push(k); k = rodic[k]; }
  return out;
}
// Výkop k jednomu stroji: nejkratší trasa od toho, co už je vykopané. Kope se
// kudykoli po parcele — bagr nepotřebuje asfalt, jen se nedá kopat pod jiným
// strojem. Vrací délku v metrech a políčka, kudy vede; další odbočka se na ně
// napojí, takže se společný kus výkopu neplatí dvakrát.
function planVykopKStani(p, zdroj, st, blok) {
  var cil = {}, i;
  padBunky(st).forEach(function (c) { cil[c[0] + ':' + c[1]] = 1; });
  var fronta = [], videl = {}, rodic = {};
  Object.keys(zdroj).forEach(function (k) {
    var xy = k.split(':');
    fronta.push([Number(xy[0]), Number(xy[1]), 0]);
    videl[k] = 1;
  });
  while (fronta.length) {
    var t = fronta.shift(), tk = t[0] + ':' + t[1];
    if (cil[tk]) return { delka: t[2], cesta: planZpet(rodic, tk) };
    var sousedi = [[t[0] + 1, t[1]], [t[0] - 1, t[1]], [t[0], t[1] + 1], [t[0], t[1] - 1]];
    for (i = 0; i < sousedi.length; i++) {
      var x = sousedi[i][0], y = sousedi[i][1], k2 = x + ':' + y;
      if (videl[k2]) continue;
      // Stroj v mřížce nestojí (drží se zvlášť), ale výkop k němu dojít musí.
      if (cil[k2]) return { delka: t[2] + 1, cesta: planZpet(rodic, tk) };
      if (blok[k2]) continue;
      if (planBunka(p, x, y) === -1) continue;
      videl[k2] = 1; rodic[k2] = tk;
      fronta.push([x, y, t[2] + 1]);
    }
  }
  return null;
}
// Výkopy všech tří médií. Každé má svůj sloupek a svou trasu; parkovací stání
// jsou zpevněná plocha, takže pod nimi výkop projde.
function planVykopy(p) {
  var pady = planStroje(p), out = {};
  PLAN_MEDIA.forEach(function (md) {
    var sl = planSloupek(p, md.k);
    var res = { delka: 0, trasy: [], ok: pady.length > 0 };
    if (res.ok) {
      var zdroj = {};
      zdroj[sl + ':' + (p.h - 1)] = 1;
      for (var i = 0; i < pady.length; i++) {
        var blok = {};
        planStrojBunky(p, i).forEach(function (c) { blok[c[0] + ':' + c[1]] = 1; });
        var r = planVykopKStani(p, zdroj, pady[i], blok);
        if (!r) { res.ok = false; res.delka = 0; res.trasy = []; break; }
        res.delka += r.delka;
        res.trasy.push(r.cesta);
        r.cesta.forEach(function (k) { zdroj[k] = 1; });
      }
    }
    out[md.k] = res;
  });
  return out;
}
// Celková délka výkopů — všechna tři média dohromady.
function planPripojkaDelka(p) {
  var v = planVykopy(p), celkem = 0, ok = true;
  PLAN_MEDIA.forEach(function (md) {
    if (!v[md.k].ok) ok = false; else celkem += v[md.k].delka;
  });
  return ok ? celkem : null;
}
// Dojede se ke každému prádlomatu? Cesta musí začínat u ulice a dotknout se
// každého stání — k jednomu se dojet dá a k druhému ne, to by nestačilo.
function planCestaOdUlice(p) {
  var start = [], x;
  for (x = 0; x < p.w; x++) if (planBunka(p, x, p.h - 1) === PLAN_CESTA) start.push([x, p.h - 1]);
  var fronta = start.slice(), videl = {};
  start.forEach(function (st) { videl[st[0] + ':' + st[1]] = 1; });
  while (fronta.length) {
    var t = fronta.shift();
    var sousedi = [[t[0] + 1, t[1]], [t[0] - 1, t[1]], [t[0], t[1] + 1], [t[0], t[1] - 1]];
    for (var i = 0; i < sousedi.length; i++) {
      var sx = sousedi[i][0], sy = sousedi[i][1], k = sx + ':' + sy;
      if (videl[k]) continue;
      if (planBunka(p, sx, sy) !== PLAN_CESTA) continue;
      videl[k] = 1;
      fronta.push([sx, sy]);
    }
  }
  return videl;
}
function planSousediCesta(videl, st) {
  return padBunky(st).some(function (c) {
    return [[c[0] + 1, c[1]], [c[0] - 1, c[1]], [c[0], c[1] + 1], [c[0], c[1] - 1]]
      .some(function (sd) { return videl[sd[0] + ':' + sd[1]]; });
  });
}
function planDojezd(p) {
  var pady = planStroje(p);
  if (!pady.length) return false;
  var videl = planCestaOdUlice(p);
  return pady.every(function (st) { return planSousediCesta(videl, st); });
}
function planPocty(p) {
  var c = { dlazba: 0, cesta: 0 };
  for (var i = 0; i < p.b.length; i++) {
    if (p.b[i] === PLAN_DLAZBA) c.dlazba++;
    else if (p.b[i] === PLAN_CESTA) c.cesta++;
  }
  // Pod strojem je dlažba vždycky — platí se, i když ji hráč nekreslil.
  c.podStrojem = planStrojBunky(p).length;
  c.stroju = planStroje(p).length;
  c.stanixKs = planStani(p).length;
  return c;
}
function planCena(p) {
  var c = planPocty(p), v = planVykopy(p);
  var polozky = [
    { n: 'Asfaltová cesta', m: c.cesta + ' m²', v: c.cesta * PLAN_CESTA_M2 },
    { n: 'Parkovací stání', m: c.stanixKs + '×', v: c.stanixKs * PLAN_STANI },
    { n: 'Zámková dlažba', m: (c.dlazba + c.podStrojem) + ' m²', v: (c.dlazba + c.podStrojem) * PLAN_DLAZBA_M2 }
  ];
  PLAN_MEDIA.forEach(function (md) {
    polozky.push({ n: md.n, m: (v[md.k].ok ? v[md.k].delka + ' m' : '—'),
      v: (v[md.k].ok ? v[md.k].delka : 0) * md.m });
  });
  polozky.push({ n: 'Připojovací poplatky', m: '', v: PLAN_POPLATKY });
  var celkem = polozky.reduce(function (a, x) { return a + x.v; }, 0);
  var delka = PLAN_MEDIA.reduce(function (a, md) { return a + (v[md.k].ok ? v[md.k].delka : 0); }, 0);
  return { polozky: polozky, celkem: Math.round(celkem), delka: delka, vykopy: v };
}
// Co ještě chybí, aby se dalo stavět. Hráč má vědět proč, ne jen že to nejde.
function planChyby(p) {
  var ch = [], c = planPocty(p), n = c.stroju;
  if (!n) ch.push('Umísti aspoň jeden prádlomat — klepni na Stroj a pak na plochu.');
  var potreba = PLAN_STANI_MIN * Math.max(1, n);
  if (c.stanixKs < potreba) {
    ch.push('Chybí parkování: máš ' + c.stanixKs + ' z ' + potreba + ' stání (na každý prádlomat dvě, '
      + 'jedno stání je ' + cisloM(PLAN_STANI_ROZMER[0]) + ' × ' + cisloM(PLAN_STANI_ROZMER[1]) + ' m).');
  }
  var videl = planCestaOdUlice(p);
  if (n && !planDojezd(p)) ch.push('Ke každému prádlomatu se musí dát dojet — veď cestu od ulice až k němu.');
  var zajezd = planStani(p).filter(function (st) { return !planSousediCesta(videl, st); }).length;
  if (zajezd) ch.push('K ' + zajezd + ' stání se nedá zajet — každé musí přiléhat k cestě.');
  if (n) {
    var v = planVykopy(p);
    PLAN_MEDIA.forEach(function (md) {
      if (!v[md.k].ok) {
        ch.push(md.n + ' se ke stroji nedostane — výkop nemá kudy obejít druhý stroj.');
      }
    });
  }
  return ch;
}
// Návrh za hráče. Udělá to, co by udělal projektant: vozovku od ulice ke stáním
// a parkování hned vedle ní.
function planAutoNavrh(p) {
  var st = planStroje(p), x, y, sirka = PLAN_CESTA_SIRKY[0];
  if (!st.length) return false;
  var pas = Math.max(0, p.h - sirka);        // první řada pruhu u ulice
  // Pruh u ulice stačí tak dlouhý, aby pobral sloupky, odbočky a parkování —
  // asfalt přes celou parcelu by byl vyhozený.
  var od = p.w, doX = 0;
  PLAN_MEDIA.forEach(function (md) {
    var sl = planSloupek(p, md.k);
    od = Math.min(od, sl); doX = Math.max(doX, sl);
  });
  st.forEach(function (s0) {
    var o = Math.max(0, Math.min(p.w - sirka, s0.x + Math.floor((planCely(s0.w) - sirka) / 2)));
    od = Math.min(od, o); doX = Math.max(doX, o + sirka - 1);
  });
  var mistaSir = PLAN_STANI_MIN * st.length * PLAN_STANI_ROZMER[0];
  if (doX - od + 1 < mistaSir) {
    doX = Math.min(p.w - 1, od + mistaSir - 1);
    od = Math.max(0, doX - mistaSir + 1);
  }
  // Stání, která by stála v cestě, se nejdřív odklidí — jinak by se k stroji
  // nedalo dojet a hráč by jen koukal na chybu.
  var vcesteOd = od, vcesteDo = doX;
  p.stani = planStani(p).filter(function (st0) {
    var prekryv = st0.x <= vcesteDo && st0.x + st0.w - 1 >= vcesteOd && st0.y + st0.h - 1 >= pas;
    if (prekryv) return false;
    return !st.some(function (s1) {
      var o = Math.max(0, Math.min(p.w - sirka, s1.x + Math.floor((planCely(s1.w) - sirka) / 2)));
      return st0.x <= o + sirka - 1 && st0.x + planCely(st0.w) - 1 >= o
        && st0.y + planCely(st0.h) - 1 >= s1.y + planCely(s1.h);
    });
  });
  for (y = pas; y < p.h; y++) {
    for (x = od; x <= doX; x++) if (!planObsazeno(p, x, y)) p.b[planIndex(p, x, y)] = PLAN_CESTA;
  }
  // Od pruhu u ulice odbočka ke každému stroji, taky na šířku jednosměrky.
  st.forEach(function (s0) {
    var od2 = Math.max(0, Math.min(p.w - sirka, s0.x + Math.floor((planCely(s0.w) - sirka) / 2)));
    for (y = pas - 1; y >= s0.y + planCely(s0.h); y--) {
      for (x = od2; x < od2 + sirka; x++) if (!planObsazeno(p, x, y)) p.b[planIndex(p, x, y)] = PLAN_CESTA;
    }
  });
  // Parkování: stání v řadě nad vozovkou, ať se k nim dá zacouvat.
  // Stání, ke kterému se po úpravě nedá zajet, radši zmizí — návrh má vyjít
  // rovnou, ne hlásit chybu.
  var dosah0 = planCestaOdUlice(p);
  p.stani = planStani(p).filter(function (st0) { return planSousediCesta(dosah0, st0); });
  var potreba = PLAN_STANI_MIN * st.length;
  var sw = PLAN_STANI_ROZMER[0], sh = PLAN_STANI_ROZMER[1];
  var radek = pas - Math.ceil(sh);
  if (radek < 0) { sw = PLAN_STANI_ROZMER[1]; sh = PLAN_STANI_ROZMER[0]; radek = pas - Math.ceil(sh); }
  if (radek < 0) return true;
  // Stání klademe po půlmetrech, ať se srovnají na sraz — a jen tam, kde pod
  // nimi opravdu je cesta, jinak by se k nim nezajelo.
  // Nejdřív podél pruhu u ulice, teprve pak zbytek parcely. Klade se po
  // půlmetrech, ať se stání srovnají na sraz.
  [od, 0].forEach(function (zacatek) {
    for (var px = zacatek; px + sw <= p.w + 0.001 && planStani(p).length < potreba; px += 0.5) {
      var kand = { x: Math.round(px * 2) / 2, y: radek, w: sw, h: sh };
      if (!planVolnoRect(p, kand)) continue;
      var naCeste = padBunky(kand).some(function (c) { return planBunka(p, c[0], c[1]) === PLAN_CESTA; });
      if (naCeste || !planSousediCesta(dosah0, kand)) continue;
      planStani(p).push(kand);
      padBunky(kand).forEach(function (c) { p.b[planIndex(p, c[0], c[1])] = PLAN_PRAZDNO; });
    }
  });
  return true;
}
// ─── Kreslení plánu ──────────────────────────────────────────────────────────
var PLAN_BARVY = {};
PLAN_BARVY[PLAN_PRAZDNO] = 'plan-trava';
PLAN_BARVY[PLAN_DLAZBA] = 'plan-dlazba';
PLAN_BARVY[PLAN_CESTA] = 'plan-cesta';
PLAN_BARVY[PLAN_STANI_B] = 'plan-stani';
// Osa vozovky. Spočítá se vzdálenost od kraje asfaltu a čára se vede po hřebeni
// — proto nevynechá ani zatáčku a na široké vozovce vede jedna čára, ne dvě.
function planOsaCesty(p) {
  var d = [], fronta = [], i, x, y;
  for (i = 0; i < p.w * p.h; i++) d.push(p.b[i] === PLAN_CESTA ? -1 : 0);
  for (i = 0; i < p.w * p.h; i++) if (d[i] === 0) fronta.push(i);
  // Okraj parcely je taky kraj vozovky.
  for (x = 0; x < p.w; x++) {
    [0, p.h - 1].forEach(function (yy) {
      var k = planIndex(p, x, yy);
      if (d[k] === -1) { d[k] = 1; fronta.push(k); }
    });
  }
  for (y = 0; y < p.h; y++) {
    [0, p.w - 1].forEach(function (xx) {
      var k = planIndex(p, xx, y);
      if (d[k] === -1) { d[k] = 1; fronta.push(k); }
    });
  }
  var qi = 0;
  while (qi < fronta.length) {
    var k2 = fronta[qi++], kx = k2 % p.w, ky = Math.floor(k2 / p.w);
    [[kx + 1, ky], [kx - 1, ky], [kx, ky + 1], [kx, ky - 1]].forEach(function (c) {
      if (c[0] < 0 || c[1] < 0 || c[0] >= p.w || c[1] >= p.h) return;
      var k3 = planIndex(p, c[0], c[1]);
      if (d[k3] !== -1) return;
      d[k3] = d[k2] + 1;
      fronta.push(k3);
    });
  }
  var osa = {};
  function dd(x2, y2) { return (x2 < 0 || y2 < 0 || x2 >= p.w || y2 >= p.h) ? 0 : d[planIndex(p, x2, y2)]; }
  for (y = 0; y < p.h; y++) {
    for (x = 0; x < p.w; x++) {
      var v = d[planIndex(p, x, y)];
      if (v <= 0) continue;
      var l = dd(x - 1, y), r = dd(x + 1, y), u = dd(x, y - 1), dn = dd(x, y + 1);
      if (v < l || v < r || v < u || v < dn) continue;
      osa[x + ':' + y] = 1;
    }
  }
  return osa;
}
function planSvg(p) {
  var sirka = 100, krok = sirka / p.w, vyska = krok * p.h;
  // Pruh ulice je schválně vyšší — vejde se do něj popisek i sloupky s médii,
  // a hráč hned vidí, odkud se na parcelu jezdí a odkud se táhnou sítě.
  var pas = Math.max(krok * 1.4, 5);
  var s = '<svg class="plan-plocha" viewBox="0 0 ' + sirka + ' ' + (vyska + pas)
    + '" preserveAspectRatio="xMidYMid meet">'
    + '<defs><linearGradient id="pg-stroj" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#48a7ff"></stop><stop offset="1" stop-color="#1668c4"></stop></linearGradient>'
    + '<linearGradient id="pg-ulice" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#1b1f2a"></stop><stop offset="1" stop-color="#0d1017"></stop></linearGradient>'
    + '</defs>';
  s += '<rect x="0" y="' + vyska + '" width="' + sirka + '" height="' + pas
    + '" class="plan-ulice" fill="url(#pg-ulice)"></rect>'
    + '<text x="' + (sirka * 0.06) + '" y="' + (vyska + pas * 0.62) + '" class="plan-popis">ulice</text>';
  for (var y = 0; y < p.h; y++) {
    for (var x = 0; x < p.w; x++) {
      // Tráva má jemnou šachovnici, ať plán nevypadá jako kus zeleného papíru.
      var bun = planBunka(p, x, y);
      var lich = bun === PLAN_PRAZDNO && (x + y) % 2 ? ' sude' : '';
      s += '<rect data-bx="' + x + '" data-by="' + y + '" x="' + (x * krok) + '" y="' + (y * krok)
        + '" width="' + krok + '" height="' + krok + '" class="plan-b ' + PLAN_BARVY[bun] + lich + '"></rect>';
    }
  }
  // Kraj vozovky. Bílá čára po celém obvodu asfaltu — u ulice ne, tam se
  // navazuje na silnici.
  for (var ky = 0; ky < p.h; ky++) {
    for (var kx = 0; kx < p.w; kx++) {
      if (planBunka(p, kx, ky) !== PLAN_CESTA) continue;
      var x0 = kx * krok, y0 = ky * krok, x1 = (kx + 1) * krok, y1 = (ky + 1) * krok;
      if (planBunka(p, kx, ky - 1) !== PLAN_CESTA) {
        s += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y0 + '" class="plan-kraj"></line>';
      }
      if (ky < p.h - 1 && planBunka(p, kx, ky + 1) !== PLAN_CESTA) {
        s += '<line x1="' + x0 + '" y1="' + y1 + '" x2="' + x1 + '" y2="' + y1 + '" class="plan-kraj"></line>';
      }
      if (planBunka(p, kx - 1, ky) !== PLAN_CESTA) {
        s += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + y1 + '" class="plan-kraj"></line>';
      }
      if (planBunka(p, kx + 1, ky) !== PLAN_CESTA) {
        s += '<line x1="' + x1 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" class="plan-kraj"></line>';
      }
    }
  }
  // Vodorovné značení: čára se táhne po ose vozovky, zatáčky včetně.
  var osa = planOsaCesty(p);
  Object.keys(osa).forEach(function (k) {
    var xy = k.split(':'), ox = Number(xy[0]), oy = Number(xy[1]);
    var cx = (ox + 0.5) * krok, cy = (oy + 0.5) * krok;
    // Osamělý hřeben v rohu vozovky by byl jen tečka uprostřed asfaltu — ten
    // se nekreslí, čára má smysl jen tam, kde někam vede.
    if (osa[(ox + 1) + ':' + oy]) {
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + krok) + '" y2="' + cy + '" class="plan-cara"></line>';
    }
    if (osa[ox + ':' + (oy + 1)]) {
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + (cy + krok) + '" class="plan-cara"></line>';
    }
  });
  // Parkovací stání: černý asfalt s bílými čárami. Co nemá u sebe cestu,
  // svítí červeně — tam se nezaparkuje.
  var dosah = planCestaOdUlice(p);
  planStani(p).forEach(function (st) {
    s += '<rect x="' + (st.x * krok) + '" y="' + (st.y * krok) + '" width="' + (st.w * krok)
      + '" height="' + (st.h * krok) + '" rx="' + (krok * 0.12) + '" class="plan-stani-p'
      + (planSousediCesta(dosah, st) ? '' : ' chyba') + '"></rect>';
  });
  // Výkopy médií — tři barevné trasy od svých sloupků.
  var vyk = planVykopy(p);
  PLAN_MEDIA.forEach(function (md) {
    var sl = planSloupek(p, md.k);
    (vyk[md.k].trasy || []).forEach(function (tr) {
      var body = tr.map(function (k) {
        var xy = k.split(':');
        return ((Number(xy[0]) + 0.5) * krok) + ',' + ((Number(xy[1]) + 0.5) * krok);
      });
      if (body.length < 2) return;
      s += '<polyline points="' + body.join(' ') + '" class="plan-vykop" stroke="' + md.b + '"></polyline>';
    });
    s += '<circle cx="' + ((sl + 0.5) * krok) + '" cy="' + (vyska + pas * 0.42) + '" r="'
      + Math.max(krok * 0.26, 1.1) + '" class="plan-prip" fill="' + md.b + '"></circle>';
  });
  planStroje(p).forEach(function (st) {
    s += '<rect x="' + (st.x * krok) + '" y="' + (st.y * krok) + '" width="' + (st.w * krok)
      + '" height="' + (st.h * krok) + '" class="plan-stroj' + (planSousediCesta(dosah, st) ? '' : ' chyba')
      + '" fill="url(#pg-stroj)" rx="' + (krok * 0.25) + '"></rect>'
      + '<text x="' + ((st.x + st.w / 2) * krok) + '" y="' + ((st.y + st.h / 2 + 0.3) * krok)
      + '" class="plan-popis bily">' + esc((MODELS[st.model] || {}).name || '') + '</text>';
  });
  // Spodní hrana: tady se vjíždí, odtud musí cesta začínat.
  s += '<line x1="0" y1="' + vyska + '" x2="' + sirka + '" y2="' + vyska + '" class="plan-hrana"></line>';
  return s + '</svg>';
}
var PLAN_NASTROJ = 'cesta';   // stroj | stani | cesta | dlazba | guma
var PLAN_MODEL = 'mini';      // jaký stroj se klade
var PLAN_SIRKA = PLAN_CESTA_SIRKY[0];
// Editor pozemku. Navrhne se celá plocha — klidně pro víc prádlomatů najednou —
// a to, co z návrhu vyjde, se pak platí jako příprava místa.
function planEditor(sp, areaId, hotovo) {
  var vse = planyVse();
  var p = vse[sp.id];
  if (!p || !p.w) { p = planNovy(sp); vse[sp.id] = p; }
  planStroje(p); planStani(p);
  if (!planStroje(p).length) PLAN_NASTROJ = 'stroj';
  else if (planStroje(p).length) PLAN_MODEL = planStroje(p)[planStroje(p).length - 1].model || PLAN_MODEL;

  function padNa(x, y) {
    var st = planStroje(p);
    for (var i = 0; i < st.length; i++) if (planVRectu(st[i], x, y)) return i;
    return -1;
  }
  function staniNa(x, y) {
    var st = planStani(p);
    for (var i = 0; i < st.length; i++) if (planVRectu(st[i], x, y)) return i;
    return -1;
  }
  function volno(sx, sy, w, h, krome) {
    return planVolnoRect(p, { x: sx, y: sy, w: w, h: h }, krome);
  }
  function vycisti(st) {
    padBunky(st).forEach(function (c) { p.b[planIndex(p, c[0], c[1])] = PLAN_PRAZDNO; });
  }
  function polozStroj(x, y) {
    var st = planStroje(p), byl = padNa(x, y);
    if (byl >= 0) {
      if (padObsazen(sp, byl)) return toast('Na tomhle stání už prádlomat stojí.', 'err');
      st.splice(byl, 1); save(); return vykresli();
    }
    var r = planRozmerStroje(PLAN_MODEL);
    var sx = Math.max(0, Math.min(p.w - planCely(r[0]), x));
    var sy = Math.max(0, Math.min(p.h - planCely(r[1]), y));
    if (!volno(sx, sy, r[0], r[1])) return toast('Tady už něco je.', 'err');
    st.push({ x: sx, y: sy, w: r[0], h: r[1], model: PLAN_MODEL });
    // Pod strojem je dlažba sama o sobě — co tam hráč nakreslil dřív, se nepočítá dvakrát.
    vycisti(st[st.length - 1]);
    save(); vykresli();
  }
  function polozStani(x, y) {
    var st = planStani(p), byl = staniNa(x, y);
    if (byl >= 0) { st.splice(byl, 1); save(); return vykresli(); }
    var r2 = planRozmerStani(), w = r2[0], h = r2[1];
    var sx = Math.max(0, Math.min(p.w - w, x)), sy = Math.max(0, Math.min(p.h - h, y));
    // Stání se samo přisadí k sousednímu, ať jdou nakreslit na sraz jako na
    // opravdovém parkovišti — ne o půl metru vedle.
    planStani(p).forEach(function (o) {
      if (Math.abs(o.y - sy) > 0.5 || Math.abs(o.h - h) > 0.01) return;
      if (Math.abs(o.x + o.w - sx) < 1.01) sx = o.x + o.w;
      else if (Math.abs(o.x - (sx + w)) < 1.01) sx = o.x - w;
    });
    if (sx + w > p.w) sx = p.w - w;
    if (sx < 0) sx = 0;
    // Když to takhle nejde, zkusíme stání otočené — ať se hráč nemusí trefovat.
    if (!volno(sx, sy, w, h)) {
      w = r2[1]; h = r2[0];
      sx = Math.max(0, Math.min(p.w - planCely(w), x)); sy = Math.max(0, Math.min(p.h - planCely(h), y));
      if (!volno(sx, sy, w, h)) return toast('Stání se sem nevejde.', 'err');
    }
    st.push({ x: sx, y: sy, w: w, h: h });
    vycisti(st[st.length - 1]);
    save(); vykresli();
  }
  function maluj(x, y) {
    if (PLAN_NASTROJ === 'stroj') return polozStroj(x, y);
    if (PLAN_NASTROJ === 'stani') return polozStani(x, y);
    var n = PLAN_NARADI.filter(function (t) { return t.k === PLAN_NASTROJ; })[0];
    if (!n) return;
    // Cesta se kreslí rovnou na celou šířku vozovky, ostatní nářadí po metru.
    var s = PLAN_NASTROJ === 'cesta' ? PLAN_SIRKA : 1;
    var od = Math.floor((s - 1) / 2), zmena = false;
    for (var dy = -od; dy < s - od; dy++) {
      for (var dx = -od; dx < s - od; dx++) {
        var cx = x + dx, cy = y + dy;
        if (planBunka(p, cx, cy) === -1) continue;
        // Pod strojem ani pod stáním se kreslit nedá — mají svůj povrch.
        if (planObsazeno(p, cx, cy)) continue;
        p.b[planIndex(p, cx, cy)] = n.b;
        zmena = true;
      }
    }
    if (zmena) { save(); vykresli(); }
  }
  function vykresli() {
    var cen = planCena(p), chyby = planChyby(p), c = planPocty(p);
    var naradi = PLAN_NARADI.filter(function (t) { return t.k === PLAN_NASTROJ; })[0];
    var st = planStroje(p), stoji = strojuNaPozemku(sp.id);
    var popis = PLAN_NASTROJ === 'stroj'
        ? 'Klepni na plochu a stání pro stroj se tam položí. Klepnutím na hotové ho zase sundáš.'
      : PLAN_NASTROJ === 'stani'
        ? 'Parkovací stání je ' + cisloM(planRozmerStani()[0]) + ' × ' + cisloM(planRozmerStani()[1])
          + ' m. Musí přiléhat k cestě; klepnutím na hotové ho sundáš.'
      : (naradi || {}).p || '';
    sheet('<h3>Příprava plochy</h3>'
      + '<p class="muted small">' + esc(sp.name) + ' · ' + p.w + ' × ' + p.h + ' m. '
      + 'Rozmísti na parcelu tolik prádlomatů, kolik jich sem chceš — jeden velký kiosek, '
      + 'nebo dvě tři menší stání vedle sebe.</p>'
      + '<div class="plan-ram">' + planSvg(p) + '</div>'
      + '<p class="fine plan-legenda">' + PLAN_MEDIA.map(function (md) {
          return '<span><i style="background:' + md.b + '"></i>' + esc(md.n) + '</span>';
        }).join('') + '</p>'
      + '<p class="fine">Každé médium má na ulici svůj sloupek a kope se k němu vlastní výkop — ten vede '
      + 'kudykoli po parcele, platí se po metru. Vjezd je po celé spodní hraně u ulice.</p>'
      + '<div class="seg sub plan-seg">'
      + '<button class="' + (PLAN_NASTROJ === 'stroj' ? 'on' : '') + '" data-plan-t="stroj">'
      + '<i class="sw sw-stroj"></i>Stroj</button>'
      + '<button class="' + (PLAN_NASTROJ === 'stani' ? 'on' : '') + '" data-plan-t="stani">'
      + '<i class="sw sw-stani"></i>Stání</button>'
      + PLAN_NARADI.map(function (t) {
          return '<button class="' + (t.k === PLAN_NASTROJ ? 'on' : '') + '" data-plan-t="' + t.k + '">'
            + '<i class="sw sw-' + t.k + '"></i>' + t.n + '</button>';
        }).join('') + '</div>'
      + (PLAN_NASTROJ === 'stroj'
          ? '<div class="seg sub plan-seg" style="margin-top:6px">'
            + MODEL_ORDER.map(function (k) {
                var r = planRozmerStroje(k);
                return '<button class="' + (k === PLAN_MODEL ? 'on' : '') + '" data-plan-m="' + k + '">'
                  + esc(MODELS[k].name) + ' ' + cisloM(r[0]) + '×' + cisloM(r[1]) + '</button>';
              }).join('') + '</div>'
          : '')
      + (PLAN_NASTROJ === 'stroj' || PLAN_NASTROJ === 'stani'
          ? '<button class="btn sec sm" id="plan-otocit" style="width:100%;margin-top:6px">↻ Otočit o 90° '
            + '(teď ' + (PLAN_OTOCENO ? 'nadél' : 'čelem k cestě') + ')</button>'
          : '')
      + (PLAN_NASTROJ === 'cesta'
          ? '<div class="seg sub plan-seg" style="margin-top:6px">'
            + PLAN_CESTA_SIRKY.map(function (s2) {
                return '<button class="' + (s2 === PLAN_SIRKA ? 'on' : '') + '" data-plan-s="' + s2 + '">'
                  + s2 + ' m ' + (s2 > 3 ? 'obousměrná' : 'jednosměrka') + '</button>';
              }).join('') + '</div>'
          : '')
      + '<p class="fine">' + esc(popis) + '</p>'
      + '<h3 style="margin:14px 0 4px">Na ploše stojí</h3>'
      + (st.length
          ? st.map(function (x, i) {
              return '<div class="kv"><span>' + (i + 1) + '. stání · ' + esc((MODELS[x.model] || {}).name || '')
                + '</span><b class="' + (padObsazen(sp, i) ? 'ok' : '') + '">'
                + (padObsazen(sp, i) ? 'prádlomat stojí' : cisloM(x.w) + ' × ' + cisloM(x.h) + ' m') + '</b></div>';
            }).join('')
          : '<p class="fine">Zatím žádné. Klepni na Stroj a pak na parcelu.</p>')
      + '<div class="kv"><span>Parkovacích stání</span><b class="'
      + (c.stanixKs >= PLAN_STANI_MIN * Math.max(1, c.stroju) ? 'ok' : 'warn') + '">' + c.stanixKs + '×</b></div>'
      + '<h3 style="margin:14px 0 4px">Co to bude stát</h3>'
      + cen.polozky.map(function (x) {
          return '<div class="kv"><span>' + esc(x.n) + (x.m ? ' <i class="muted small">' + esc(x.m) + '</i>' : '')
            + '</span><b>' + kcFull(x.v) + '</b></div>';
        }).join('')
      + '<div class="kv souhrn"><span>Příprava celkem</span><b class="' + (cen.celkem ? 'warn' : '') + '">'
      + kcFull(cen.celkem) + '</b></div>'
      + (p.zaplaceno
          ? '<div class="kv"><span>Zaplaceno dřív</span><b class="ok">−' + kcFull(p.zaplaceno) + '</b></div>'
          : '')
      + (chyby.length
          ? '<div class="card vada-karta" style="margin-top:12px"><h3>⚠️ Ještě to nejde</h3>'
            + chyby.map(function (x) { return '<p class="muted small" style="margin:6px 0 0">' + esc(x) + '</p>'; }).join('')
            + '</div>'
          : '<p class="fine ok" style="margin-top:10px">Plocha je hotová: dojede se sem, zaparkuje se tu a '
            + 'všechna tři média mají kudy vést — dohromady ' + cen.delka + ' m výkopů.</p>')
      + '<button class="btn sec" id="plan-auto" style="width:100%;margin-top:12px">Navrhnout za mě</button>'
      + '<button class="btn big" id="plan-hotovo"' + (chyby.length ? ' disabled' : '')
      + ' style="width:100%;margin-top:8px">Hotovo — spočítat přípravu</button>'
      + (stoji ? '' : '<button class="btn sec" id="plan-smazat" style="width:100%;margin-top:8px">Začít návrh znovu</button>'));
    var pl = $('sheet-body').querySelector('.plan-plocha');
    if (pl) {
      var kresli = function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        var bx = t.getAttribute('data-bx'), by = t.getAttribute('data-by');
        if (bx == null || by == null) return;
        maluj(Number(bx), Number(by));
      };
      pl.addEventListener('click', kresli);
      // Tažením se kreslí rychleji než klepáním po metrech.
      pl.addEventListener('pointermove', function (ev) {
        if (!ev.buttons || PLAN_NASTROJ === 'stroj' || PLAN_NASTROJ === 'stani') return;
        var el = document.elementFromPoint(ev.clientX, ev.clientY);
        if (el) kresli({ target: el });
      });
    }
    [].forEach.call($('sheet-body').querySelectorAll('[data-plan-t]'), function (b2) {
      b2.onclick = function () { PLAN_NASTROJ = b2.getAttribute('data-plan-t'); vykresli(); };
    });
    var ot = $('plan-otocit');
    if (ot) ot.onclick = function () { PLAN_OTOCENO = !PLAN_OTOCENO; vykresli(); };
    [].forEach.call($('sheet-body').querySelectorAll('[data-plan-m]'), function (b3) {
      b3.onclick = function () { PLAN_MODEL = b3.getAttribute('data-plan-m'); vykresli(); };
    });
    [].forEach.call($('sheet-body').querySelectorAll('[data-plan-s]'), function (b4) {
      b4.onclick = function () { PLAN_SIRKA = Number(b4.getAttribute('data-plan-s')); vykresli(); };
    });
    var au = $('plan-auto');
    if (au) au.onclick = function () {
      // Bez stroje není co napojovat — jeden rovnou položíme doprostřed parcely.
      var st0 = planStroje(p);
      if (!st0.length) {
        var r0 = planRozmerStroje(PLAN_MODEL);
        st0.push({ x: Math.max(0, Math.floor((p.w - planCely(r0[0])) / 2)), y: 1,
          w: r0[0], h: r0[1], model: PLAN_MODEL });
        vycisti(st0[0]);
      }
      planAutoNavrh(p);
      PLAN_NASTROJ = 'cesta';
      save(); vykresli();
      toast('Hotový návrh. Doladit ho můžeš po svém.', 'ok');
    };
    var sm = $('plan-smazat');
    if (sm) sm.onclick = function () {
      // Zaplacená příprava se nepromazává — doplácí se jen rozdíl proti ní.
      var zapl = p && p.zaplaceno ? p.zaplaceno : 0;
      vse[sp.id] = planNovy(sp); p = vse[sp.id];
      if (zapl) p.zaplaceno = zapl;
      PLAN_NASTROJ = 'stroj'; save(); vykresli();
    };
    var hb = $('plan-hotovo');
    if (hb) hb.onclick = function () {
      p.cena = planCena(p).celkem;
      p.hotovo = 1;
      save();
      if (hotovo) hotovo(p);
    };
  }
  vykresli();
}
// ─── Nájemní smlouva ─────────────────────────────────────────────────────────
// S majitelem pozemku se domlouvají dvě věci: na jak dlouho se hráč zaváže a
// jakou bude mít výpovědní dobu. Vázanost ho chrání — dokud běží, nikdo ho
// nepřeplatí. Výpovědní doba je lhůta, po kterou místo vydělává dál jemu, i
// když už někdo nabídl víc; do jejího konce může nabídku dorovnat a zůstat.
// Za jistotu se platí vyšším nájmem. Konkurent podmínky nevidí, stejně jako
// nevidí nájem — přihazuje naslepo a nikdy neví, jak dobře je soused krytý.
var NAJEM_DOBY = [
  { m: 0, n: 'Na dobu neurčitou', p: 'Nejlevnější. Kdokoli tě může kdykoli přeplatit.' },
  { m: 12, n: '1 rok', p: 'Rok klidu. Pak se smlouva mění na dobu neurčitou.' },
  { m: 36, n: '3 roky', p: 'Tři roky tě nikdo nevystrnadí.' },
  { m: 60, n: '5 let', p: 'Nejdražší jistota. Pět herních let nedotknutelný.' }
];
var NAJEM_VYPOVEDI = [1, 3, 6, 12];
var NAJEM_ZA_ROK = 0.05;        // +5 % nájmu za každý rok vázanosti
var NAJEM_ZA_MESIC = 0.03;      // +3 % za každý měsíc výpovědní doby nad jeden
var ODSTUPNE_MAX = 6;           // odejít z doby určité stojí nejvýš šest nájmů
// Kolikrát dražší je nájem s vyjednanými podmínkami. Minimum (neurčito a měsíc
// výpovědi) je základní cena, všechno nad to si majitel pozemku nechá zaplatit.
function najemKoef(dobaM, vypM) {
  return 1 + (Math.max(0, dobaM) / 12) * NAJEM_ZA_ROK
    + Math.max(0, (vypM || 1) - 1) * NAJEM_ZA_MESIC;
}
function najemSPodminkami(sp, dobaM, vypM) {
  return Math.round(rentOf(sp) * najemKoef(dobaM, vypM));
}
function dobaNazev(m) {
  for (var i = 0; i < NAJEM_DOBY.length; i++) if (NAJEM_DOBY[i].m === m) return NAJEM_DOBY[i].n;
  return Math.round(m / 12) + ' let';
}
function vypovedNazev(m) {
  return m + ' ' + mn(m, 'měsíc', 'měsíce', 'měsíců');
}
// Běžící výpověď na mém místě — vrací data, ze kterých se staví varování.
function vyzvaNaMiste(spotId) {
  var c = CLAIMS[spotId];
  if (!c || !c.mine || c.pozemek || !c.vypoved_do || !c.vyzyva) return null;
  var do_ = new Date(c.vypoved_do).getTime();
  if (!(do_ > Date.now())) return null;
  return { do: do_, nick: c.vyzyva.nick || 'konkurent', rent: c.vyzyva.rent || 0 };
}
// Karta s výpovědí v detailu prádlomatu. Dorovnání je ta pojistka, kvůli které
// má smysl vyjednat si delší výpovědní dobu.
function vypovedHtml(u) {
  var v = vyzvaNaMiste(u.spotId);
  if (!v) return '';
  var rozdil = Math.max(0, v.rent - (u.eco.rent || 0));
  return '<div class="card vada-karta"><div class="row"><h3>⚠️ Výpověď z místa</h3>'
    + '<b class="err">' + etaText(v.do - Date.now()).replace('za ', 'zbývá ') + '</b></div>'
    + '<p class="muted small" style="margin:4px 0 8px">' + esc(v.nick) + ' nabídl majiteli pozemku '
    + 'vyšší nájem. Do konce výpovědní doby tu vyděláváš dál — a když nabídku dorovnáš, '
    + 'místo ti zůstane.</p>'
    + '<div class="kv"><span>Platíš teď</span><b>' + kcFull(u.eco.rent) + ' / měsíc</b></div>'
    + '<div class="kv"><span>Nabídka konkurenta</span><b class="warn">' + kcFull(v.rent) + ' / měsíc</b></div>'
    + '<div class="kv"><span>Zdraží tě to o</span><b class="err">' + kcFull(rozdil) + ' / měsíc</b></div>'
    + '<button class="btn big" id="do-dorovnat" style="width:100%;margin-top:10px">Dorovnat a zůstat</button>'
    + '</div>';
}
// Jak je místo nasmlouvané — vidí jen nájemce.
function smlouvaHtml(u) {
  var c = CLAIMS[u.spotId];
  if (c && c.mine && c.pozemek) {
    return '<h3 style="margin:16px 0 4px">Vlastní pozemek</h3>'
      + '<div class="kv"><span>Nájem</span><b class="ok">neplatíš žádný</b></div>'
      + '<div class="kv"><span>Může tě odsud někdo dostat?</span><b class="ok">ne</b></div>'
      + '<p class="fine">Zem je tvoje, takže tohle místo nejde přeplatit ani vypovědět. '
      + 'Prodat se dá jedině se strojem.</p>';
  }
  if (!c || !c.mine || !c.vypoved_mesicu) return '';
  var vaz = c.vazano_do ? new Date(c.vazano_do).getTime() : 0;
  var kryty = vaz > Date.now();
  return '<h3 style="margin:16px 0 4px">Nájemní smlouva</h3>'
    + '<div class="kv"><span>Vázanost</span><b class="' + (kryty ? 'ok' : '') + '">'
    + (kryty ? 'do ' + datumCas(vaz).split(' ')[0] + ' (nikdo tě nepřeplatí)' : 'na dobu neurčitou') + '</b></div>'
    + '<div class="kv"><span>Výpovědní doba</span><b>' + vypovedNazev(c.vypoved_mesicu) + '</b></div>'
    + '<p class="fine">Konkurence tvoje podmínky nevidí. Dokud vázanost běží, přihazovat na tvoje '
    + 'místo nemá smysl — majitel pozemku je nabídku nucen odmítnout a vypovědět nesmí ani sám. '
    + 'Na dobu neurčitou vypovědět může: stroj se pak po výpovědní době stěhuje na sklad.</p>';
}
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
    prevezmiMista();
    hlidejVypovedi();
    drawMap();
    if (then) then();
  }).catch(function () { if (then) then(); });
}

// Na která místa čekám, až doběhne výpovědní doba souseda. Drží se ve stavu
// hry, protože mezi přihozením a převzetím může hráč hru klidně zavřít.
function cekam() {
  if (!S.cekam || typeof S.cekam !== 'object') S.cekam = {};
  return S.cekam;
}
// Místo, které mi mezitím připadlo, se musí dostavět — stroj na něj držím skladem.
function prevezmiMista() {
  if (!S) return;
  var fronta = cekam();
  Object.keys(fronta).forEach(function (id) {
    var c = CLAIMS[id], ceka = fronta[id];
    if (!c || !c.mine) return;                       // ještě to nedoběhlo
    if (S.units.some(function (u) { return u.spotId === id; })) { delete fronta[id]; return; }
    var a = S.areas[ceka.areaId], sp = null;
    if (a) (a.spots || []).forEach(function (x) { if (x.id === id) sp = x; });
    if (!sp) { delete fronta[id]; return; }
    if (inStock(ceka.model) < 1) {
      toast('Místo ' + sp.name + ' je tvoje, ale nemáš volný ' + MODELS[ceka.model].name + '.', 'err');
      return;                                        // zkusíme to zas, až stroj bude
    }
    var conn = connPrice(sp, ceka.model);
    var f = canFinance(conn, null, stropPodleZisku(economics(sp, ceka.model).profit, conn));
    if (!f.ok) { toast('Místo ' + sp.name + ' je tvoje, ale na přípojky ti chybí hotovost.', 'err'); return; }
    delete fronta[id];
    doFinance(f, { druh: 'misto', spotId: id, popis: 'Přípojky — ' + sp.name });
    pripojUverKeStroji(id, sp.name);
    S.stock[ceka.model] = inStock(ceka.model) - 1;
    var eco = economics(sp, ceka.model);
    eco.rent = ceka.rent; eco.conn = conn; eco.install = conn;
    eco.cost = eco.energy + eco.servis + eco.rent;
    eco.profit = eco.revenue - eco.cost;
    S.units.push({ spotId: id, areaId: ceka.areaId, name: sp.name, kind: sp.kind, score: sp.score,
      lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: eco });
    save(); paint(); drawMap(); syncState(true);
    toast('Výpovědní doba doběhla — ' + sp.name + ' je tvoje a stroj na něm stojí.', 'ok');
  });
}
// Nová výpověď na mém místě se nesmí přehlédnout — hráč na ni má omezený čas.
var VYPOVEDI_ZNAME = {};
function hlidejVypovedi() {
  (S.units || []).forEach(function (u) {
    var v = vyzvaNaMiste(u.spotId);
    if (!v) { delete VYPOVEDI_ZNAME[u.spotId]; return; }
    if (VYPOVEDI_ZNAME[u.spotId]) return;
    VYPOVEDI_ZNAME[u.spotId] = 1;
    toast(v.nick + ' přeplatil nájem na místě ' + u.name + '. Do konce výpovědní doby to můžeš dorovnat.', 'err');
  });
}
// Zábory na serveru jsou pravda o tom, co komu patří — a drží i tehdy, když
// se stav hry mezi zařízeními rozejde. Když tedy server říká, že na místě
// stojí můj prádlomat, ale v rozehrané hře chybí, vrátíme ho zpátky. Tohle
// zachraňuje případ „koupil jsem na počítači a v telefonu to nevidím".
function obnovChybejiciUnity() {
  if (!S || !ME) return 0;
  var mam = {};
  (S.units || []).forEach(function (u) { mam[u.spotId] = 1; });
  var pridano = 0;
  Object.keys(CLAIMS || {}).forEach(function (sid) {
    var c = CLAIMS[sid];
    if (!c || !c.mine || !c.model || mam[sid]) return;
    if (c.pozemek && !c.model) return;                 // holý pozemek není stroj
    if (S.prodano && S.prodano[sid]) return;           // prodané se nevrací
    // Když je město prozkoumané, vezmeme skutečné místo i s jeho skóre.
    var sp = null;
    Object.keys(S.areas || {}).forEach(function (aid) {
      (S.areas[aid].spots || []).forEach(function (x) { if (x.id === zakladniSpotId(sid)) sp = x; });
    });
    var misto = sp || { id: sid, name: c.name || 'Prádlomat', kind: 'unknown', score: 60,
      lat: c.lat, lon: c.lon };
    var eco = economics({ id: sid, name: misto.name, kind: misto.kind, score: misto.score,
      lat: misto.lat, lon: misto.lon }, c.model);
    if (c.rent != null) {
      eco.rent = c.rent;
      eco.cost = eco.energy + eco.servis + eco.rent;
      eco.profit = eco.revenue - eco.cost;
    }
    S.units.push({ spotId: sid, areaId: c.area_key || '', name: misto.name || c.name || 'Prádlomat',
      kind: misto.kind || 'unknown', score: misto.score != null ? misto.score : 60,
      lat: misto.lat != null ? misto.lat : c.lat, lon: misto.lon != null ? misto.lon : c.lon,
      builtAt: Date.now(), eco: eco });
    pridano++;
  });
  if (pridano) {
    save(); paint(); drawMap(); syncState(true);
    toast(pridano === 1
      ? 'Vrátili jsme ti prádlomat, který v téhle hře chyběl — server o něm ví.'
      : 'Vrátili jsme ti ' + pridano + ' prádlomaty, které v téhle hře chyběly.', 'ok');
  }
  return pridano;
}
// Místo, o které hráč přišel, zmizí ze sítě a stroj se mu vrátí na sklad.
function reconcileUnits() {
  obnovChybejiciUnity();
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
    osirelyUver(x.u.spotId);
  });
  save(); prehodnotRamec(false, true); paint();
  var x = lost[0];
  toast(lost.length === 1
    ? x.nick + ' přeplatil nájem v místě ' + x.u.name + '. Stroj máš zpátky na skladě.'
    : 'Přišel jsi o ' + lost.length + ' míst — konkurence přeplatila nájem. Stroje máš na skladě.', 'err');
}

// ─── Výpověď od majitele pozemku ─────────────────────────────────────────────
// Nájem není jistota. Stejně jako se stroj porouchá, může majitel pozemku sám
// vypovědět smlouvu — pozemek prodá, postaví si tam vlastní věc nebo si to
// rozmyslí. Prádlomat se pak musí odvézt: skončí na skladě a hráč mu hledá nové
// místo i nové přípojky. Vázanost smlouvy tomu brání (za to se platí) a
// vyjednaná výpovědní doba rozhoduje, kolik času na stěhování zbude.
var VYPOVED_ROCNE = 0.08;          // průměrně jednou za ~12 herních let na stroj
var VYPOVED_DUVODY = [
  { t: 'Majitel pozemek prodal', p: 'Nový vlastník s prádlomatem nepočítá.', jednat: false },
  { t: 'Majitel si plochu bere pro sebe', p: 'Chystá tam vlastní stavbu.', jednat: false },
  { t: 'Benzínka ruší podnájmy', p: 'Vedení sítě zrušilo pronájmy ploch plošně.', jednat: false },
  { t: 'Obchod mění provozovatele', p: 'Nový nájemce objektu chce plochu pro sebe.', jednat: true },
  { t: 'Majitel má lepší nabídku', p: 'Za plochu mu někdo nabídl víc, než platíš ty.', jednat: true },
  { t: 'Stížnosti sousedů', p: 'Majiteli vadí noční provoz. Dá se to ukecat, ale ne zadarmo.', jednat: true }
];
var VYPOVED_PRIHOZENI = [0.25, 0.35, 0.5];   // o kolik si majitel řekne víc, když se dá jednat
function jeVeVypovedi(u) { return !!(u && u.vypoved); }
// Vypovědět jde jen běžně pronajaté místo: vlastní zem ani pozemek od jiného
// hráče sem nepatří a vázanou smlouvu musí majitel dodržet.
function lzeVypovedet(u) {
  if (!u || u.vypoved || zemUnit(u) !== '') return false;
  var c = CLAIMS[u.spotId];
  if (!c || !c.mine || c.pozemek) return false;
  if (c.vypoved_do) return false;    // už běží výpověď kvůli konkurentovi
  if (c.vazano_do && new Date(c.vazano_do).getTime() > Date.now()) return false;
  return true;
}
function hlidejVypovedMajitele(dt) {
  if (!(dt > 0) || !ME) return;
  var sance = Math.min(0.2, dt / (YEAR_MS / VYPOVED_ROCNE));
  (S.units || []).forEach(function (u) {
    if (!lzeVypovedet(u)) return;
    if (Math.random() >= sance) return;
    var c = CLAIMS[u.spotId];
    var d = VYPOVED_DUVODY[Math.floor(Math.random() * VYPOVED_DUVODY.length)];
    var mesicu = Math.max(1, (c && c.vypoved_mesicu) || 1);
    u.vypoved = { od: Date.now(), do: Date.now() + mesicu * MONTH_MS, mesicu: mesicu,
      t: d.t, p: d.p,
      navyseni: d.jednat ? VYPOVED_PRIHOZENI[Math.floor(Math.random() * VYPOVED_PRIHOZENI.length)] : 0 };
    toast(u.name + ': majitel pozemku dal výpověď — ' + d.t.toLowerCase() + '.', 'err');
  });
}
// Doběhlá výpovědní doba: prádlomat se odveze na sklad a místo se uvolní.
// Přípojky zůstanou v zemi majiteli — na novém místě se dělají (a platí) znovu.
function hlidejStehovani() {
  var ted = Date.now();
  var konci = (S.units || []).filter(function (u) { return u.vypoved && ted >= u.vypoved.do; });
  if (!konci.length) return;
  konci.forEach(function (u) {
    S.units = S.units.filter(function (x) { return x.spotId !== u.spotId; });
    S.stock[u.eco.model] = inStock(u.eco.model) + 1;
    var spl = osirelyUver(u.spotId);
    delete CLAIMS[u.spotId];
    if (ME) apiJson('/spots/release', { spot_id: u.spotId, odstupne: true }).catch(function () {});
    toast('Nájem v místě ' + u.name + ' skončil. ' + ((MODELS[u.eco.model] || {}).name || 'Prádlomat')
      + ' máš na skladě — najdi mu nové místo a udělej přípojky.'
      + (spl ? ' Splátky ' + kcFull(spl) + ' měsíčně běží dál.' : ''), 'err');
  });
  save(); prehodnotRamec(false, true); paint(); drawMap(); syncState(true);
}
// Karta výpovědi v detailu prádlomatu.
function vypovedMajiteleHtml(u) {
  var v = u && u.vypoved;
  if (!v) return '';
  var novy = Math.round((u.eco.rent || 0) * (1 + (v.navyseni || 0)));
  var h = '<div class="card vada-karta"><div class="row"><h3>⚠️ Výpověď od majitele</h3>'
    + '<b class="err">' + etaText(Math.max(0, v.do - Date.now())).replace('za ', 'zbývá ') + '</b></div>'
    + '<p class="muted small" style="margin:4px 0 8px"><b>' + esc(v.t) + '.</b> ' + esc(v.p)
    + ' Výpovědní doba je ' + vypovedNazev(v.mesicu) + '; do jejího konce prádlomat vydělává dál. '
    + 'Pak se musí odvézt — skončí na skladě a nové místo bude chtít i nové přípojky.</p>';
  var spl = splatkyMista(u.spotId);
  if (spl > 0) {
    h += '<div class="kv"><span>Splátky úvěru na tohle místo</span><b class="err">'
      + kcFull(spl) + ' / měsíc</b></div>'
      + '<p class="fine err" style="margin:4px 0 8px">Ty běží dál. Na skladě stroj nevydělává nic, '
      + 'ale bance se platí stejně — proto se vyplatí mít nové místo nachystané dřív, než lhůta doběhne.</p>';
  }
  if (v.navyseni > 0) {
    h += '<div class="kv"><span>Platíš teď</span><b>' + kcFull(u.eco.rent || 0) + ' / měsíc</b></div>'
      + '<div class="kv"><span>Majitel chce</span><b class="warn">' + kcFull(novy) + ' / měsíc</b></div>'
      + '<div class="kv"><span>Zdraží tě to o</span><b class="err">'
      + kcFull(Math.max(0, novy - (u.eco.rent || 0))) + ' / měsíc</b></div>'
      + '<button class="btn big" id="do-navyseni" style="width:100%;margin-top:10px">Přisadit a zůstat</button>';
  } else {
    h += '<p class="fine err">Tahle výpověď se vyjednat nedá. Hledej nové místo včas — '
      + 'stroj na skladě nevydělává.</p>';
  }
  return h + '</div>';
}

// Panel cizího prádlomatu: koho přebíráš a za kolik to zkusíš.
function rivalSheet(sp, areaId, c) {
  // Pozemek se nepřeplácí — zem patří majiteli a ten ji prodávat nemusí.
  if (c.pozemek) {
    sheet('<h3>' + esc(sp.name) + '</h3>'
      + '<p class="muted small">' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '')
      + 'Tohle místo drží <b>' + esc(c.firma || c.nick) + '</b> (' + esc(c.nick) + ') · '
      + esc((MODELS[c.model] || {}).name || c.model) + '</p>'
      + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
      + '<div class="card"><div class="row"><h3>Vlastní pozemek</h3><b class="warn">nelze přeplatit</b></div>'
      + '<p class="muted small" style="margin:4px 0 0">Majitel tu nemá nájem — zem koupil. '
      + 'Nabídnout majiteli pozemku víc nejde, protože žádný majitel pozemku není. '
      + 'Jediná cesta je domluvit se s ním ve zprávách.</p></div>'
      + (c.id ? '<button class="btn big" id="bid-napsat" style="width:100%">Napsat majiteli</button>' : ''));
    var bn0 = $('bid-napsat');
    if (bn0) bn0.onclick = function () { chatSheet(c.id); };
    return;
  }
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
        + '<button class="btn big" id="go-shop-bid">Koupit prádlomat v obchodě</button>')
    + (c.id ? '<button class="btn ghost" id="bid-napsat" style="width:100%;margin-top:8px">Napsat majiteli</button>'
        + '<p class="fine">Místo jde i koupit po dobrém — dohodni se s ním ve zprávách.</p>' : ''));
  var bn = $('bid-napsat');
  if (bn) bn.onclick = function () { chatSheet(c.id); };
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
        S.cash -= BID_FEE;
        zapis('poplatek', 'Neúspěšné vyjednávání — ' + (sp.name || ''), -BID_FEE);
        save(); paint();
        return toast(r.j.error || 'Nepovedlo se.', 'err');
      }
      // Majitel kývl, ale nájemce má výpovědní dobu — místo bude naše až po ní.
      // Datum neznáme (podmínky soused tají), takže se čeká na převzetí.
      if (r.j.ceka) {
        cekam()[sp.id] = { rent: amt, model: model, areaId: areaId };
        save(); loadClaims(); closeSheet();
        return toast('Majitel pozemku kývl. ' + esc(r.j.lost_by) + ' má ale výpovědní lhůtu — '
          + 'až doběhne, místo je tvoje. Nech si na něj volný ' + MODELS[model].name + '.', 'ok');
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
// Co se o závadě píše v panelu místa — včetně toho, o kolik tržeb hráč přichází.
function poruchaHtml(u) {
  if (!jeVPoruse(u) && !u.technik) return '';
  var t = u.technik, ted = Date.now();
  if (jeVPoruse(u)) {
    var chod = chodStroje(u);
    var v = t ? null : vyjezdOdhad(u);
    return '<div class="card vada-karta"><div class="row"><h3>⚠️ ' + esc(u.porucha.text) + '</h3>'
      + '<b class="err">' + (chod ? 'půl provozu' : 'stojí') + '</b></div>'
      + '<p class="muted small" style="margin:4px 0 8px">'
      + (chod ? 'Část strojů jede dál, ale tržba je na polovině. '
              : 'Prádlomat nevydělává vůbec nic. ')
      + 'Nájem, servis i splátka běží dál — výjezd technika už máš v servisním poplatku zaplacený.</p>'
      + (t
          ? '<div class="kv"><span>Technik</span><b>' + esc(ted < t.prijezd
              ? 'na cestě, přijede ' + etaText(t.prijezd - ted)
              : 'na místě, hotovo ' + etaText(t.hotovo - ted)) + '</b></div>'
          : (v
              ? '<div class="kv"><span>Odkud pojede</span><b>' + esc(v.zakladna.name || 'základna') + '</b></div>'
                + '<div class="kv"><span>Vzdálenost</span><b>' + Math.round(v.km) + ' km '
                  + v.zpusob.znak + ' ' + v.zpusob.nazev + '</b></div>'
                + '<div class="kv"><span>Cesta a oprava</span><b>' + etaText(v.celkem).replace('za ', '') + '</b></div>'
                + zaMoremRada(u, v)
                + '<button class="btn big" id="do-technik" style="width:100%;margin-top:10px">Vyslat technika</button>'
              : '<p class="fine err">Nemáš základnu, odkud technika poslat.</p>'))
      + '</div>';
  }
  return '<div class="card vada-karta"><div class="row"><h3>🔧 Spraveno</h3>'
    + '<b class="ok">zase jede</b></div>'
    + '<p class="muted small" style="margin:4px 0 0">Technik jede zpátky na základnu.</p></div>';
}
function unitSheet(u) {
  var years = (Date.now() - u.builtAt) / YEAR_MS;
  sheet('<h3>' + esc(u.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[u.kind] || 'Místo') + ' · ' + MODELS[u.eco.model].name
    + ' · v provozu ' + years.toFixed(1).replace('.', ',') + ' roku'
    + (zemUnit(u) === 'moje' ? ' · <b class="ok">tvůj pozemek</b>'
        : zemUnit(u) === 'najem' ? ' · <b class="ok">pronajatý pozemek</b>' : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(u.score) + '</div>'
    + vypovedHtml(u)
    + vypovedMajiteleHtml(u)
    + poruchaHtml(u)
    + '<h3 style="margin:16px 0 4px">Co to měsíčně dělá</h3>'
    + '<div class="kv"><span>Obrat</span><b>' + kcFull(u.eco.revenue) + '</b></div>'
    + (u.eco.rent != null ? '<div class="kv"><span>− Nájem</span><b class="warn">' + kcFull(u.eco.rent) + '</b></div>' : '')
    + (u.eco.energy != null ? '<div class="kv"><span>− Energie (' + pct(ENERGY_SHARE) + ' obratu)</span><b class="warn">' + kcFull(u.eco.energy) + '</b></div>' : '')
    + (u.eco.servis != null ? '<div class="kv"><span>− Servis a úklid (' + pct(SERVIS_SHARE) + ' obratu)</span><b class="warn">' + kcFull(u.eco.servis) + '</b></div>' : '')
    + '<div class="kv souhrn"><span>Provozní zisk</span><b class="'
      + (u.eco.profit >= 0 ? 'ok' : 'err') + '">' + kcFull(u.eco.profit) + '</b></div>'
    + mistoUverHtml(u)
    + smlouvaHtml(u)
    + '<h3 style="margin:16px 0 4px">Souhrn</h3>'
    + '<div class="kv"><span>Investice</span><b>' + kcFull(u.eco.invest) + '</b></div>'
    + '<div class="kv"><span>Vydělal celkem</span><b>' + kcFull(u.eco.ziskPlny * 12 * years) + '</b></div>'
    + (u.eco.ziskPlny > 0 ? '<div class="kv"><span>Návratnost</span><b>'
      + (u.eco.invest / (u.eco.ziskPlny * 12)).toFixed(1).replace('.', ',') + ' roku</b></div>' : '')
    + '<h3 style="margin:18px 0 4px">Prodat celou provozovnu</h3>'
    + (trhMoje(u.spotId)
        ? '<p class="muted small">Na tržišti za <b>' + kcFull(trhMoje(u.spotId).cena) + '</b>, nabídka končí '
          + etaText(new Date(trhMoje(u.spotId).konci).getTime() - Date.now())
          + '. Do té doby ti prádlomat normálně vydělává.</p>'
        : '<p class="muted small">Stroj, nájemní smlouvu i přípojky můžeš nabídnout komukoli na tržišti. '
          + 'Kupující má hotovou provozovnu hned, ty peníze na ruku.</p>')
    + '<button class="btn sec" id="do-trh" style="width:100%">'
    + (trhMoje(u.spotId) ? 'Upravit nabídku na tržišti' : 'Nabídnout na tržišti') + '</button>'
    + '<p class="muted small" style="margin-top:14px">Když je jinde líp, místo vypovíš a stroj si odvezeš na sklad. '
    + 'Přípojky ani domluvený nájem se nevracejí, místo se hned uvolní konkurenci a splátky '
    + 'úvěru na něj běží dál.</p>'
    + '<button class="btn sec" id="do-release" style="width:100%">Vypovědět místo</button>');
  var tb = $('do-technik');
  if (tb) tb.onclick = function () { vyslatTechnika(u); closeSheet(); switchTab('map'); };
  var db = $('do-dorovnat');
  if (db) db.onclick = function () {
    var v = vyzvaNaMiste(u.spotId);
    if (!v) return;
    db.disabled = true; db.textContent = 'Jednám s majitelem…';
    apiJson('/spots/dorovnat', { spot_id: u.spotId }).then(function (r) {
      db.disabled = false; db.textContent = 'Dorovnat a zůstat';
      if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
      // Nový nájem se musí propsat i do ekonomiky místa, jinak by zisk lhal.
      u.eco.rent = r.j.rent;
      u.eco.cost = u.eco.energy + u.eco.servis + u.eco.rent;
      u.eco.profit = u.eco.revenue - u.eco.cost;
      save(); paint(); loadClaims(); unitSheet(u); syncState(true);
      toast('Dorovnáno. Místo zůstává tvoje, nájem je teď ' + kcFull(r.j.rent) + '.', 'ok');
    }).catch(function () { db.disabled = false; db.textContent = 'Dorovnat a zůstat'; toast('Server neodpovídá.', 'err'); });
  };
  var tb2 = $('do-trh');
  if (tb2) tb2.onclick = function () {
    if (TRH == null) return loadTrh(function () { trhProdejSheet(u); });
    trhProdejSheet(u);
  };
  var nb = $('do-navyseni');
  if (nb) nb.onclick = function () {
    var v = u.vypoved;
    if (!v || !v.navyseni) return;
    var novy = Math.round((u.eco.rent || 0) * (1 + v.navyseni));
    nb.disabled = true; nb.textContent = 'Jednám s majitelem…';
    apiJson('/spots/navyseni', { spot_id: u.spotId, rent: novy }).then(function (r) {
      nb.disabled = false; nb.textContent = 'Přisadit a zůstat';
      if (!r.ok) return toast((r.j && r.j.error) || 'Nepovedlo se.', 'err');
      delete u.vypoved;
      // Vyšší nájem se musí propsat i do ekonomiky místa, jinak by zisk lhal.
      u.eco.rent = r.j.rent;
      u.eco.cost = u.eco.energy + u.eco.servis + u.eco.rent;
      u.eco.profit = u.eco.revenue - u.eco.cost;
      save(); paint(); loadClaims(); unitSheet(u); syncState(true);
      toast('Domluveno. Místo zůstává tvoje, nájem je teď ' + kcFull(r.j.rent) + ' měsíčně.', 'ok');
    }).catch(function () {
      nb.disabled = false; nb.textContent = 'Přisadit a zůstat'; toast('Server neodpovídá.', 'err');
    });
  };
  var rb = $('do-release');
  if (rb) rb.onclick = function () {
    if (rb.getAttribute('data-sure') !== '1') {
      rb.setAttribute('data-sure', '1');
      rb.textContent = 'Opravdu? Klikni znovu';
      rb.classList.add('warn');
      return;
    }
    rb.disabled = true;
    vypovedMisto(u, false, rb);
  };
}
// Výpověď z místa. Ze smlouvy na dobu určitou jde odejít taky, ale majiteli
// pozemku se doplácí odstupné — server ho spočítá, hráč ho musí potvrdit.
function vypovedMisto(u, sOdstupnym, rb) {
  apiJson('/spots/release', { spot_id: u.spotId, odstupne: !!sOdstupnym }).then(function (r) {
      if (!r.ok && r.j && r.j.odstupne > 0 && !sOdstupnym) {
        if (rb) { rb.disabled = false; rb.textContent = 'Vypovědět místo'; rb.classList.remove('warn'); }
        if (S.cash < r.j.odstupne) {
          return toast('Odstupné je ' + kcFull(r.j.odstupne) + ' a tolik hotovosti nemáš.', 'err');
        }
        sheet('<h3>Odstupné</h3>'
          + '<p class="muted small">Smlouva je na dobu určitou, do konce zbývá ' + r.j.zbyva + ' '
          + mn(r.j.zbyva, 'měsíc', 'měsíce', 'měsíců') + '. Majitel pozemku tě pustí, ale chce '
          + 'doplatit nájem — nejvýš za ' + ODSTUPNE_MAX + ' měsíce.</p>'
          + '<div class="kv"><span>Odstupné</span><b class="err">' + kcFull(r.j.odstupne) + '</b></div>'
          + '<div class="kv"><span>Zbude ti</span><b>' + kcFull(S.cash - r.j.odstupne) + '</b></div>'
          + '<button class="btn big" id="do-odstupne" style="width:100%;margin-top:12px">Zaplatit a odejít</button>'
          + '<button class="btn sec" id="do-zustat" style="width:100%;margin-top:8px">Nechat být</button>');
        var o = $('do-odstupne');
        if (o) o.onclick = function () {
          o.disabled = true;
          S.cash -= r.j.odstupne;
          zapis('poplatek', 'Odstupné z nájmu — ' + (u.name || ''), -r.j.odstupne);
          vypovedMisto(u, true, null);
        };
        var z = $('do-zustat');
        if (z) z.onclick = function () { closeSheet(); };
        return;
      }
      if (!r.ok) { if (rb) rb.disabled = false; return toast((r.j && r.j.error) || 'Nepovedlo se.', 'err'); }
      S.units = S.units.filter(function (x) { return x.spotId !== u.spotId; });
      S.stock[u.eco.model] = inStock(u.eco.model) + 1;
      osirelyUver(u.spotId);
      delete CLAIMS[u.spotId];
      save(); prehodnotRamec(false, true); paint(); drawMap(); closeSheet(); syncState(true);
      toast('Místo vypovězeno. ' + MODELS[u.eco.model].name + ' čeká na skladě.', 'ok');
  }).catch(function () { if (rb) rb.disabled = false; toast('Server neodpovídá.', 'err'); });
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
  var txt = 'Stavím síť prádlomatů v Laundromat Tycoonu. Zkus to taky — a mně tím přibydou zákazníci.';
  if (navigator.share) {
    navigator.share({ title: 'Laundromat Tycoon', text: txt, url: url }).catch(function () {});
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
// Co se v kroku dělá, proč to hráč dělá a na co si má dát pozor. Bez toho
// druhého a třetího je z tutoriálu jen ukazování prstem.
function tutText(k) {
  if (k === 1) return {
    t: 'Vyber si město',
    p: 'Napiš město a pošli tam člověka. Projde ho a najde místa, kde by prádlomat vydělával.',
    proc: 'Bez míst nemáš kam stavět. A první město ti zůstane jako sídlo firmy — od něj se počítá doprava strojů.',
    pozor: 'Cesta stojí ' + kcFull(SCOUT_COST) + '. Sídlo se později změnit nedá, tak ho dej tam, kde chceš stavět.',
    cil: '#sidlo-mesto, #sidlo-go', nouze: '#open-areas'
  };
  if (k === 2) {
    var proveril = Object.keys(S.revealed || {}).length > 0;
    if (!proveril) return {
      t: 'Prověř si místo',
      p: 'Klepni na doměček na mapě a nech si ho prověřit. Uvidíš nájem, obrat i zisk.',
      proc: 'Dokud místo neprověříš, vidíš jen skóre. Čísla rozhodnou, jestli se tam stroj vyplatí.',
      pozor: 'Obhlídka stojí ' + kcFull(REVEAL_COST) + '. Čím vyšší skóre, tím víc lidí kolem chodí.',
      cil: '#do-reveal', nouze: '#tab-map'
    };
    return {
      t: 'Domluv nájem',
      p: 'Vyber vázanost a výpovědní dobu a domluv se s majitelem pozemku.',
      proc: 'Bez smlouvy se stavět nedá. Smlouva je zdarma — platí se až nájem, měsíc po měsíci.',
      pozor: 'Delší vázanost je dražší, ale chrání tě: konkurence tě nepřeplatí a majitel tě tak snadno nevyžene.',
      cil: '.najem-seg, #do-lease', nouze: '#tab-map'
    };
  }
  if (k === 3) return {
    t: 'Kup prádlomat',
    p: 'V obchodě vezmi MINI. Zaplatíš ho z vlastního, půjčovat si zatím nemusíš.',
    proc: 'MINI je nejlevnější stroj. Na první místo stačí a necháš si peníze na přípojky.',
    pozor: 'Nech si rezervu — přípojky na místě stojí dalších 50 000 až 100 000.',
    cil: '#v-shop [data-buy="mini"], [data-doobchodu="mini"]', nouze: '#tab-shop'
  };
  if (k === 4) return ownedOf('rush') ? {
    t: 'Doruč ho hned',
    p: 'Použij kartu Expresní dovoz a stroj je okamžitě skladem.',
    proc: 'Běžné dodání jsou dva herní měsíce, tedy celý skutečný den. Tak dlouho čekat nemusíš.',
    pozor: 'Kartu máš jednu do začátku. Další se dají získat později.',
    cil: '#v-shop .btn.rush', nouze: '#tab-shop'
  } : {
    t: 'Stroj je na cestě',
    p: 'Dopravce ho veze. Až dorazí, počká ve skladu, než mu najdeš místo.',
    proc: 'Dodání trvá dva herní měsíce, tedy jeden skutečný den. Hra běží dál, i když ji zavřeš.',
    pozor: 'Mezitím si můžeš prověřit další místa — ať máš z čeho vybírat.',
    cil: '#tab-shop', nouze: '#tab-shop'
  };
  if (k === 5) return {
    t: 'Postav prádlomat',
    p: 'Klepni na místo s domluveným nájmem a dej Postavit. Stroj ze skladu se na něj nastěhuje.',
    proc: 'Tím ti začne téct první příjem. Prádlomat vydělává nonstop, i když hru zavřeš.',
    pozor: 'Při stavbě zaplatíš přípojky — vodu, odpad a elektřinu. Je to jednorázově, pak už jen nájem.',
    cil: '[data-build], #do-build', nouze: '#tab-map'
  };
  return null;
}
// Standa — provozní, co prádlomaty dělá roky. Provede hráče prvním strojem.
var TUT_KDO = { jmeno: 'Standa', role: 'provozní, 40 prádlomatů' };
var TUT_AVA = '<svg class="tut-ava" viewBox="0 0 48 48" aria-hidden="true">'
  + '<circle cx="24" cy="24" r="24" fill="#16233a"/>'
  + '<path d="M9 44a15 15 0 0 1 30 0Z" fill="#3a6cf5"/>'
  + '<path d="M20 44V34h8v10Z" fill="#2a4fb8"/>'
  + '<circle cx="24" cy="23" r="10" fill="#f0c9a4"/>'
  + '<path d="M14 19a10 10 0 0 1 20 0Z" fill="#1f2d47"/>'
  + '<path d="M12 19h24a1.6 1.6 0 0 1 0 3H12a1.6 1.6 0 0 1 0-3Z" fill="#273852"/>'
  + '<circle cx="20.4" cy="23.4" r="1.5" fill="#1f2d47"/><circle cx="27.6" cy="23.4" r="1.5" fill="#1f2d47"/>'
  + '<path d="M20 29.4h8" stroke="#1f2d47" stroke-width="1.8" stroke-linecap="round" fill="none"/>'
  + '<path d="M19.6 26.6h8.8" stroke="#5b4636" stroke-width="2.4" stroke-linecap="round" fill="none"/>'
  + '</svg>';
var TUT_CIL = null;
function tutPaint() {
  var bar = $('tut');
  if (!bar) return;
  if (TUT_CIL) { var o = document.querySelector(TUT_CIL); if (o) o.classList.remove('tut-on'); TUT_CIL = null; }
  var k = tutKrok(), info = k ? tutText(k) : null;
  if (!info) {
    bar.classList.add('hidden');
    tutZhasni();
    // První prádlomat stojí — tutoriál skončil sám.
    if (tutAktivni() && (S.units || []).length) {
      S.tut = 'done'; save();
      toast('První prádlomat stojí. Teď už to znáš — další si postavíš sám.', 'ok');
      // Teď má smysl se ptát, jaký je podnikatel — a nabídnout účet.
      if (!S.profilVybran) setTimeout(otevriDotaznik, 1400);
    }
    return;
  }
  bar.classList.remove('hidden');
  $('tut-krok').textContent = 'Krok ' + k + ' z ' + TUT_KROKU;
  $('tut-titul').textContent = info.t;
  $('tut-text').textContent = info.p;
  $('tut-fill').style.width = Math.round((k - 1) / TUT_KROKU * 100) + '%';
  if (info.cil) { var c = document.querySelector(info.cil); if (c) { c.classList.add('tut-on'); TUT_CIL = info.cil; } }
  tutSvetlo(k, info);
  tutHlidej();
}

// ─── Světlo na prvek a Standa, co vysvětluje ─────────────────────────────────
// Hráč nemá luštit, kam klepnout. Okolí ztmavne, svítí jen to jedno tlačítko
// a vedle něj stojí bublina: co udělat, proč to dělá a na co si dát pozor.
// Ztmavení nic neblokuje — klikat jde všude, jen se to hůř přehlédne.
var TUT_STAV = null;       // { k, cil, text } — co je zrovna nasvícené
var TUT_SKRYTA = {};       // kroky, u kterých hráč bublinu zavřel
var TUT_HLIDAC = null;
// Krok může mít víc prvků (políčko i tlačítko pod ním) — nasvítíme je dohromady,
// jinak by hráč měl psát do tmy.
function tutRect(sel) {
  if (!sel) return null;
  var l = null, t = null, r2 = null, b = null;
  // Otevřený panel překrývá celou hru. Nasvítit tlačítko pod ním by hráče jen
  // poslalo klepat do tmy, tak se v tu chvíli díváme jen dovnitř panelu.
  var sh = $('sheet'), panel = sh && !sh.classList.contains('hidden') ? sh : null;
  [].forEach.call(document.querySelectorAll(sel), function (el) {
    if (panel && !panel.contains(el)) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    l = l == null ? r.left : Math.min(l, r.left);
    t = t == null ? r.top : Math.min(t, r.top);
    r2 = r2 == null ? r.right : Math.max(r2, r.right);
    b = b == null ? r.bottom : Math.max(b, r.bottom);
  });
  if (l == null) return null;
  return { left: l, top: t, right: r2, bottom: b, width: r2 - l, height: b - t };
}
function tutPrvek(info) {
  var r = tutRect(info.cil) || tutRect(info.nouze);
  return r ? { r: r } : null;
}
function tutZhasni() {
  var sv = $('tut-sv'), b = $('tut-bubl');
  if (sv) sv.classList.add('hidden');
  if (b) b.classList.add('hidden');
  TUT_STAV = null;
}
// Panel se zavře, mapa popojede, stroj dorazí — světlo musí umět i naskočit
// zpátky, ne jen zhasnout. Hlídač běží, dokud tutoriál běží.
function tutHlidej() {
  if (TUT_HLIDAC) return;
  TUT_HLIDAC = setInterval(function () {
    if (!tutAktivni()) { clearInterval(TUT_HLIDAC); TUT_HLIDAC = null; tutZhasni(); return; }
    var k = tutKrok(), i = k ? tutText(k) : null;
    if (!i) return tutZhasni();
    tutSvetlo(k, i);
  }, 350);
}
function tutSvetlo(k, info) {
  var sv = $('tut-sv'), bub = $('tut-bubl');
  if (!sv || !bub) return;
  if (TUT_SKRYTA[k]) { tutZhasni(); return; }
  var c = tutPrvek(info);
  // Není co nasvítit — ať hráč aspoň vidí lištu nahoře.
  if (!c) { tutZhasni(); if ($('tut') && tutAktivni()) $('tut').classList.remove('hidden'); return; }
  // Bublinu překreslíme jen při změně kroku — jinak by blikala.
  if (!TUT_STAV || TUT_STAV.k !== k || TUT_STAV.cil !== info.cil) {
    bub.innerHTML = '<div class="tut-hl">' + TUT_AVA
      + '<div class="tut-kdo"><b>' + esc(TUT_KDO.jmeno) + '</b><i>' + esc(TUT_KDO.role) + '</i></div>'
      + '<span class="tut-poc">' + k + '/' + TUT_KROKU + '</span></div>'
      + '<h4>' + esc(info.t) + '</h4>'
      + '<p>' + esc(info.p) + '</p>'
      + (info.proc ? '<p class="tut-proc">' + esc(info.proc) + '</p>' : '')
      + (info.pozor ? '<p class="tut-pozor">Pozor: ' + esc(info.pozor) + '</p>' : '')
      + '<div class="tut-akce"><button class="btn sm" id="tut-ok">Rozumím</button>'
      + '<button class="tut-preskoc" id="tut-pres">Přeskočit</button></div>';
    bub.querySelector('#tut-ok').onclick = function () { TUT_SKRYTA[k] = 1; tutZhasni(); };
    bub.querySelector('#tut-pres').onclick = function () { tutZhasni(); tutSkip(); };
    TUT_STAV = { k: k, cil: info.cil };
  }
  sv.classList.remove('hidden');
  bub.classList.remove('hidden');
  if ($('tut')) $('tut').classList.add('hidden');   // bublina říká totéž, a líp
  tutUmisti(c.r);
}
function tutUmisti(r) {
  var dira = $('tut-dira'), bub = $('tut-bubl');
  if (!dira || !bub) return;
  var o = 6;
  dira.style.left = Math.max(0, r.left - o) + 'px';
  dira.style.top = Math.max(0, r.top - o) + 'px';
  dira.style.width = (r.width + o * 2) + 'px';
  dira.style.height = (r.height + o * 2) + 'px';
  var bh = bub.offsetHeight || 200, bw = bub.offsetWidth || 320;
  // Bublina patří tam, kde nepřekryje to, na co má hráč klepnout.
  var nad = r.top, pod = window.innerHeight - r.bottom;
  var top = pod >= bh + 16 ? r.bottom + 12 : (nad >= bh + 16 ? r.top - bh - 12 : Math.max(8, (window.innerHeight - bh) / 2));
  var left = Math.min(Math.max(10, r.left + r.width / 2 - bw / 2), Math.max(10, window.innerWidth - bw - 10));
  bub.style.top = Math.round(top) + 'px';
  bub.style.left = Math.round(left) + 'px';
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

// Hlavička se překresluje každou vteřinu, aby hotovost naskákala spolu
// s čísly, která nad ní probléskní. Zbytek záložky stačí jednou za pět.
// Pod jakou firmou hráč hraje. Bez účtu to řekne rovnou — a klepnutí vede tam,
// kde si ho založí.
function paintFirma() {
  paintHeslo();
  var el = $('t-firma');
  if (!el) return;
  if (ME) {
    var firma = ME.company || (ME.nick + ' s.r.o.');
    el.innerHTML = (ME.emblem ? znakSvg(ME.emblem, 20) + ' ' : '')
      + '<b>' + esc(firma) + '</b><i>' + esc(ME.nick) + '</i>';
  } else {
    el.innerHTML = '<b class="muted">Hraješ bez účtu</b><i>Založit firmu ›</i>';
  }
}
function paintHlavicka() {
  if (!S) return;
  paintFirma();
  $('t-year').textContent = gameYear();
  $('t-cash').textContent = kcHdr(S.cash);
  var cz = cistyZisk();
  $('t-rate').textContent = kc(cz);
  $('t-rate').className = cz < 0 ? 'err' : 'ok';
  $('t-count').textContent = S.units.length;
  // Pod počtem postavených ještě to, co leží na skladě nebo se zrovna veze —
  // jinak by hráč na koupený stroj čekající na místo klidně zapomněl.
  var pod = $('t-sklad');
  if (pod) {
    var sklad = MODEL_ORDER.reduce(function (a, k) { return a + inStock(k); }, 0);
    var vezou = (S.orders || []).length;
    pod.textContent = sklad ? sklad + ' skladem' : (vezou ? vezou + ' na cestě' : '');
    pod.className = 't-pod' + (sklad ? ' ok' : (vezou ? ' warn' : ''));
  }
}
function paint() {
  refreshUnits();
  paintHlavicka();
  // Hlavička se hýbe pořád, obsah záložky počká, až hráč dopíše.
  if (pisePrave()) return;
  if (!$('v-shop').classList.contains('hidden')) paintShop();
  if (!$('v-net').classList.contains('hidden')) {
    if (!$('net-zebricek').classList.contains('hidden')) paintZeb();
    else if (!$('net-vyvoj').classList.contains('hidden')) paintVyvoj();
    else if (!$('net-stroje').classList.contains('hidden')) paintStroje();
    else paintNet();
  }
  if (!$('v-bank').classList.contains('hidden')) paintBank();
  if (!$('v-cards').classList.contains('hidden')) paintCards();
  if (!$('v-burza').classList.contains('hidden')) paintBurza();
  if (!$('v-me').classList.contains('hidden')) paintMe();
  tutPaint();
}
// ─── Grafy vývoje ──────────────────────────────────────────────────
// Kreslíme je přímo do SVG — žádná knihovna, hra se nemá čím zdržovat. Šířku
// grafu roztahuje prohlížeč svěřeným viewBoxem, tloušťka čáry zůstává stejná.
var GRAF_W = 320, GRAF_H = 104, GRAF_P = 8, GRAF_ID = 0;
var GRAF_H2 = 150;       // souhrnný graf je vyšší, vejde se do něj víc čar
// Lámaná čára přes všechny body. Schody používá počet prádlomatů — ten se
// nemění plynule, přibyde celej stroj naraz.
function cestaBodu(body, px, py, schody) {
  var d = '';
  for (var i = 0; i < body.length; i++) {
    var x = px(i).toFixed(1), y = py(body[i]).toFixed(1);
    if (!i) d += 'M' + x + ' ' + y;
    else if (schody) d += ' L' + x + ' ' + py(body[i - 1]).toFixed(1) + ' L' + x + ' ' + y;
    else d += ' L' + x + ' ' + y;
  }
  return d;
}
// Tenká svislá čára na přelomu herního roku — ať je poznat, jak dlouhý úsek to je.
function rokyCary(mezniky, px, vyska) {
  return (mezniky || []).map(function (i) {
    return '<line x1="' + px(i).toFixed(1) + '" y1="0" x2="' + px(i).toFixed(1) + '" y2="' + vyska
      + '" stroke="rgba(120,160,255,.22)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
  }).join('');
}
function grafSvg(body, barva, schody, mezniky) {
  var n = body.length;
  if (n < 2) return '';
  var max = 0, min = 0;
  body.forEach(function (v) { if (v > max) max = v; if (v < min) min = v; });
  if (max === min) max = min + 1;
  var px = function (i) { return GRAF_P + i * (GRAF_W - 2 * GRAF_P) / (n - 1); };
  var py = function (v) { return GRAF_P + (max - v) * (GRAF_H - 2 * GRAF_P) / (max - min); };
  var d = cestaBodu(body, px, py, schody);
  var dno = py(min).toFixed(1);
  var plocha = d + ' L' + px(n - 1).toFixed(1) + ' ' + dno + ' L' + px(0).toFixed(1) + ' ' + dno + ' Z';
  var gid = 'graf-v' + (++GRAF_ID);
  var cary = rokyCary(mezniky, px, GRAF_H);
  return '<svg class="graf" viewBox="0 0 ' + GRAF_W + ' ' + GRAF_H + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="' + barva + '" stop-opacity=".34"/>'
    + '<stop offset="1" stop-color="' + barva + '" stop-opacity="0"/></linearGradient></defs>'
    + cary
    + '<path d="' + plocha + '" fill="url(#' + gid + ')"/>'
    + '<path d="' + d + '" fill="none" stroke="' + barva + '" stroke-width="2" '
    + 'vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<circle cx="' + px(n - 1).toFixed(1) + '" cy="' + py(body[n - 1]).toFixed(1) + '" r="3" fill="' + barva + '"/>'
    + '</svg>';
}
// Jedna kartika: nadpis, dnešní hodnota, změna od začátku a pod tím graf.
function grafKarta(o) {
  var dolu = o.dobreNahoru === false;
  var lepsi = dolu ? o.zmena < 0 : o.zmena > 0;
  var zm = !o.zmena ? 'beze změny od začátku'
    : (o.zmena > 0 ? '▲ +' : '▼ −') + o.jed(Math.abs(o.zmena)) + ' od začátku';
  return '<div class="card graf-karta">'
    + '<div class="row"><h3>' + o.nadpis + '</h3><b>' + o.jed(o.ted) + '</b></div>'
    + '<p class="graf-zmena ' + (!o.zmena ? 'muted' : (lepsi ? 'ok' : 'err')) + '">' + zm + '</p>'
    + grafSvg(o.body, o.barva, !!o.schody, o.mezniky)
    + '<p class="fine" style="margin:7px 0 0">' + o.pod + '</p></div>';
}
// Přepnutí mezi „Moje síť“, „Vývoj“ a „Žebříček“ — volá se i z odkazu pod dlaždicemi.
function netZalozka(kam) {
  [].forEach.call(document.querySelectorAll('[data-net]'), function (x) {
    x.classList.toggle('on', x.getAttribute('data-net') === kam);
  });
  $('net-moje').classList.toggle('hidden', kam !== 'moje');
  $('net-stroje').classList.toggle('hidden', kam !== 'stroje');
  $('net-vyvoj').classList.toggle('hidden', kam !== 'vyvoj');
  $('net-zebricek').classList.toggle('hidden', kam !== 'zebricek');
  if (kam === 'zebricek') { ZEB = null; paintZeb(); }
  else if (kam === 'vyvoj') paintVyvoj();
  else if (kam === 'stroje') paintStroje();
  else paintNet();
}
// Souhrnný graf: tržby, zisk a to, co každý měsíc odteče, v jedné ose. Mezera
// mezi ziskem a odtokem je přesně to, co hráči zbyde — proto je vybarvená.
// Počet prádlomatů jede vzadu vlastním měřítkem, jen jako pozadí.
// Pás mezi dvěma řadami, rozkrájený v místě, kde se kříží. Zeleně je to, co
// zbývá, červeně to, co chybí — jinak by ztráta vypadala stejně jako výdělek.
function pasKusy(horni, dolni, px, py) {
  var body = [], n = horni.length;
  for (var i = 0; i < n; i++) {
    body.push({ x: px(i), a: horni[i], b: dolni[i] });
    if (i + 1 >= n) continue;
    var d1 = horni[i] - dolni[i], d2 = horni[i + 1] - dolni[i + 1];
    if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
      var t = d1 / (d1 - d2);
      var v = horni[i] + (horni[i + 1] - horni[i]) * t;
      body.push({ x: px(i) + (px(i + 1) - px(i)) * t, a: v, b: v });
    }
  }
  // Rozdělíme na kusy podle toho, kdo je zrovna nahoře. Mezi dvěma opačnými
  // úseky vždycky leží bod, kde se čáry dotýkají — ten patří oběma, ať mezi
  // nimi nezůstane díra.
  var skup = [], akt = { zn: 0, body: [] };
  body.forEach(function (bod) {
    var zn = bod.a === bod.b ? 0 : (bod.a > bod.b ? 1 : -1);
    if (zn && akt.zn && zn !== akt.zn) {
      skup.push(akt);
      akt = { zn: zn, body: [akt.body[akt.body.length - 1]] };
    }
    if (zn) akt.zn = zn;
    akt.body.push(bod);
  });
  skup.push(akt);
  return skup.filter(function (g) { return g.body.length > 1; }).map(function (g) {
    var d = '', k;
    for (k = 0; k < g.body.length; k++) {
      d += (k ? ' L' : 'M') + g.body[k].x.toFixed(1) + ' ' + py(g.body[k].a).toFixed(1);
    }
    for (k = g.body.length - 1; k >= 0; k--) {
      d += ' L' + g.body[k].x.toFixed(1) + ' ' + py(g.body[k].b).toFixed(1);
    }
    return { d: d + ' Z', kladny: g.zn >= 0 };
  });
}
function grafSouhrn(o) {
  var n = o.trzby.length;
  if (n < 2) return '';
  var max = 0;
  [o.trzby, o.zisk, o.odtok].forEach(function (r) {
    r.forEach(function (v) { if (v > max) max = v; });
  });
  if (max <= 0) max = 1;
  var px = function (i) { return GRAF_P + i * (GRAF_W - 2 * GRAF_P) / (n - 1); };
  var py = function (v) { return GRAF_P + (max - v) * (GRAF_H2 - 2 * GRAF_P) / max; };
  var gid = 'graf-s' + (++GRAF_ID);
  // Prádlomaty mají úplně jiný řád než peníze, takže vlastní měřítko. Necháme
  // je jen do dvou třetin výšky, ať nelezou do cesty čarám s penězi.
  var pmax = 0;
  o.pocty.forEach(function (v) { if (v > pmax) pmax = v; });
  var ppy = function (v) {
    return GRAF_H2 - GRAF_P - (pmax ? v / pmax : 0) * (GRAF_H2 - 2 * GRAF_P) * 0.66;
  };
  // Pás mezi ziskem a odtokem: nahoru po zisku, zpátky po odtoku.
  var pas = pasKusy(o.zisk, o.odtok, px, py).map(function (k) {
    return '<path d="' + k.d + '" fill="url(#' + (k.kladny ? gid : gid + 'm') + ')"/>';
  }).join('');
  return '<svg class="graf velky" viewBox="0 0 ' + GRAF_W + ' ' + GRAF_H2 + '" '
    + 'preserveAspectRatio="none" aria-hidden="true">'
    + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#2fe3a0" stop-opacity=".32"/>'
    + '<stop offset="1" stop-color="#2fe3a0" stop-opacity=".08"/></linearGradient>'
    + '<linearGradient id="' + gid + 'm" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#ff5d6c" stop-opacity=".32"/>'
    + '<stop offset="1" stop-color="#ff5d6c" stop-opacity=".08"/></linearGradient></defs>'
    + rokyCary(o.mezniky, px, GRAF_H2)
    + '<path d="' + cestaBodu(o.pocty, px, ppy, true) + '" fill="none" stroke="rgba(124,92,255,.5)" '
    + 'stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>'
    + pas
    + cara(o.trzby, '#4fd1ff', px, py) + cara(o.zisk, '#2fe3a0', px, py)
    + cara(o.odtok, '#ffd866', px, py)
    + '</svg>';
}
function cara(body, barva, px, py) {
  return '<path d="' + cestaBodu(body, px, py, false) + '" fill="none" stroke="' + barva
    + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" '
    + 'stroke-linecap="round"/>'
    + '<circle cx="' + px(body.length - 1).toFixed(1) + '" cy="' + py(body[body.length - 1]).toFixed(1)
    + '" r="2.6" fill="' + barva + '"/>';
}
// Legenda pod souhrnným grafem — barva, co to je a kolik to dělá teď.
function legendaRadek(barva, nazev, hodnota, carkovane) {
  return '<i class="leg"><i class="leg-b' + (carkovane ? ' carka' : '') + '" style="background:' + barva
    + '"></i>' + nazev + ' <b>' + hodnota + '</b></i>';
}
function paintVyvoj() {
  var el = $('net-vyvoj-body');
  if (!el) return;
  var h = (S.hist || []).slice();
  if (h.length < 2) {
    el.innerHTML = '<div class="empty">Na graf je ještě brzo.<br>'
      + 'Bod přibývá každý herní měsíc, to je dvakrát za den.</div>';
    return;
  }
  // Na telefon se pár set bodů nevejde — delší historii prořídíme, tvar zůstane.
  if (h.length > 120) {
    var krok = Math.ceil(h.length / 120), r = [];
    for (var i = 0; i < h.length; i += krok) r.push(h[i]);
    if (r[r.length - 1] !== h[h.length - 1]) r.push(h[h.length - 1]);
    h = r;
  }
  var vzit = function (k) { return h.map(function (x) { return Math.round(Number(x[k]) || 0); }); };
  var prvni = h[0], posl = h[h.length - 1];
  var kus = function (v) { return v.toLocaleString('cs-CZ') + '×'; };
  var mez = [];
  h.forEach(function (x, i) { if (i && x.m % 12 === 0) mez.push(i); });
  var odtok = h.map(function (x) { return Math.round((Number(x.s) || 0) + (Number(x.o) || 0)); });
  var zbyde = posl.z - odtok[odtok.length - 1];
  var souhrn = '<div class="card graf-karta">'
    + '<div class="row"><h3>Všechno dohromady</h3><b class="' + (zbyde >= 0 ? 'ok' : 'err') + '">'
    + kcFull(zbyde) + '</b></div>'
    + '<p class="graf-zmena muted">' + (zbyde >= 0 ? 'tolik ti teď měsíčně zbyde'
        : 'tolik ti teď každý měsíc chybí') + '</p>'
    + grafSouhrn({ trzby: vzit('t'), zisk: vzit('z'), odtok: odtok, pocty: vzit('p'), mezniky: mez })
    + '<div class="legenda">'
    + legendaRadek('#4fd1ff', 'Tržby', kcFull(posl.t))
    + legendaRadek('#2fe3a0', 'Zisk', kcFull(posl.z))
    + legendaRadek('#ffd866', 'Splátky a provoz', kcFull(odtok[odtok.length - 1]))
    + legendaRadek('#7c5cff', 'Prádlomaty', kus(posl.p), true)
    + '</div>'
    + '<p class="fine" style="margin:8px 0 0">Vybarvená mezera mezi zelenou a žlutou je to, co ti '
    + 'měsíčně zbyde — zeleně, když zbývá, červeně, když chybí. Čím víc se rozevírá, '
    + 'tím rychleji to roste. Žlutá je splátka bance '
    + 'i s pobočkami a četou. Čárkovaná fialová je počet prádlomatů — ta má vlastní '
    + 'měřítko, s penězi se neporovnává.</p></div>';
  el.innerHTML = souhrn
    + grafKarta({ nadpis: 'Tržby prádlomatů', body: vzit('t'), barva: '#4fd1ff', jed: kcFull,
        ted: posl.t, zmena: posl.t - prvni.t,
        pod: 'Co prádlomaty za měsíc vyberou, než se z toho cokoli zaplatí.', mezniky: mez })
    + grafKarta({ nadpis: 'Zisk před splátkou', body: vzit('z'), barva: '#2fe3a0', jed: kcFull,
        ted: posl.z, zmena: posl.z - prvni.z,
        pod: 'Tržby minus energie, servis a nájmy. Splátky bance v tom ještě nejsou.', mezniky: mez })
    + grafKarta({ nadpis: 'Závazky bance', body: vzit('d'), barva: '#ff5d6c', jed: kcFull,
        ted: posl.d, zmena: posl.d - prvni.d, dobreNahoru: false,
        pod: 'Kolik ještě zbývá splatit bance. Na splátky teď jde ' + kcFull(posl.s) + ' měsíčně.', mezniky: mez })
    + grafKarta({ nadpis: 'Prádlomaty', body: vzit('p'), barva: '#7c5cff', jed: kus, schody: true,
        ted: posl.p, zmena: posl.p - prvni.p,
        pod: 'Kolik jich v síti stálo.', mezniky: mez })
    + '<p class="fine" style="margin:4px 2px 0">Jeden bod je jeden herní měsíc, tedy 12 hodin. '
    + 'Graf začíná v herním roce ' + (Math.floor(prvni.m / 12) + 1) + '.'
    + (h.some(function (x) { return x.r; })
        ? ' Část před dneškem je dopočítaná ze staveb a úvěrů, které máš — úvěry, '
          + 'co už máš splacené, v ní nejsou, takže dluh vzadu vychází níž.'
        : '')
    + '</p>';
}
// ─── Žebříček vlastních strojů ──────────────────────────────────────
// Které místo táhne a které se jen veze. Řadí se podle vybraného sloupce, ale
// každá řádka ukáže všechno podstatné najednou, ať se nemusí přebírat záložkami.
var STROJE_KAT = 'zisk';
var STROJE_POPIS = {
  zisk: { nadpis: 'Co který stroj vydělá', vic: 'nejvíc nahoře',
    pod: 'Zisk místa po zaplacení jeho vlastní splátky — to, co ti z něj opravdu zbyde.',
    hodnota: function (u) { return zbydeZMista(u); }, jed: kcFull, dolu: false,
    shrn: function (a, b) { return 'Nejvíc vydělá ' + a + ', nejméně ' + b + '.'; } },
  trzby: { nadpis: 'Největší tržby', vic: 'nejvíc nahoře',
    pod: 'Co stroj za měsíc vybere, než se z toho zaplatí energie, servis a nájem.',
    hodnota: function (u) { return u.eco.revenue; }, jed: kcFull, dolu: false,
    shrn: function (a, b) { return 'Největší tržbu má ' + a + ', nejmenší ' + b + '.'; } },
  poruchy: { nadpis: 'Nejvíc poruch', vic: 'nejhorší nahoře',
    pod: 'Kolikrát se stroj od postavení porouchal. Vedle je, kolik času od té doby šlapal bez závady.',
    hodnota: function (u) { return u.vady || 0; },
    jed: function (n) { return n + '×'; }, dolu: false,
    shrn: function (a, b) { return 'Nejvíc poruch má ' + a + ', nejméně ' + b + '.'; } },
  navratnost: { nadpis: 'Nejrychlejší návratnost', vic: 'nejkratší nahoře',
    pod: 'Za jak dlouho se investice do místa vrátí při plném provozu. Kratší je lepší.',
    hodnota: function (u) { return u.eco.payback == null ? 1e9 : u.eco.payback; },
    jed: function (v) { return v >= 1e8 ? '—' : v.toFixed(1).replace('.', ',') + ' roku'; }, dolu: true,
    shrn: function (a, b) { return 'Nejrychleji se vrátí ' + a + ', nejpomaleji ' + b + '.'; } }
};
function strojRadek(u, i) {
  var popis = STROJE_POPIS[STROJE_KAT];
  var im = MODEL_IMG[u.eco && u.eco.model] || MODEL_IMG.flex;
  var m = MODELS[u.eco && u.eco.model];
  var vada = jeVPoruse(u);
  var spl = Math.round(spolehlivost(u) * 100);
  var hod = popis.hodnota(u);
  var zisk = zbydeZMista(u);
  // Pod názvem jedna řádka se vším podstatným — model, tržba, poruchy, spolehlivost.
  var vady = u.vady || 0;
  var zem = zemUnit(u);
  var detail = (m ? m.name : '') + (zem === 'moje' ? ' · na tvém pozemku' : zem === 'najem' ? ' · na pronajatém pozemku' : '')
    + ' · tržba ' + kc(u.eco.revenue)
    + ' · ' + vady + ' ' + mn(vady, 'porucha', 'poruchy', 'poruch')
    + ' · bez závady ' + spl + ' %';
  return '<div class="zeb-row stroj' + (vada ? ' vada' : '') + '" data-stroj-id="' + esc(u.spotId) + '">'
    + '<i class="poradi' + (i < 3 ? ' medaile m' + (i + 1) : '') + '">' + (i + 1) + '</i>'
    + '<img class="stroj-foto" src="' + esc(im.src) + '" alt="">'
    + '<span class="nick">' + esc(u.name) + (vada ? ' <em class="vada-znak">⚠️</em>' : '')
    + '<i>' + esc(detail) + '</i></span>'
    + '<b class="' + (STROJE_KAT === 'zisk' ? (zisk >= 0 ? 'ok' : 'err')
        : (STROJE_KAT === 'poruchy' && hod ? 'warn' : '')) + '">' + popis.jed(hod) + '</b></div>';
}
function paintStroje() {
  var box = $('stroje-body');
  if (!box) return;
  var popis = STROJE_POPIS[STROJE_KAT] || STROJE_POPIS.zisk;
  var list = (S.units || []).slice().sort(function (a, b) {
    var r = popis.hodnota(b) - popis.hodnota(a);
    if (popis.dolu) r = -r;
    return r || (a.builtAt || 0) - (b.builtAt || 0);
  });
  if (!list.length) {
    box.innerHTML = '<div class="empty">Zatím nemáš ani jeden prádlomat.<br>'
      + 'Začni tím, že na mapě prozkoumáš oblast.</div>';
    return;
  }
  var vad = list.reduce(function (a, u) { return a + (u.vady || 0); }, 0);
  var nej = list[0], posl = list[list.length - 1];
  box.innerHTML = '<h3 style="margin:14px 0 2px">' + popis.nadpis
    + ' <span class="muted small" style="font-weight:600">(' + popis.vic + ')</span></h3>'
    + '<p class="muted small" style="margin:0 0 10px">' + popis.pod + '</p>'
    + '<div class="zeb">' + list.map(strojRadek).join('') + '</div>'
    + '<p class="fine" style="margin-top:12px">Dohromady ' + list.length + ' '
    + mn(list.length, 'stroj', 'stroje', 'strojů') + ' a ' + vad + ' '
    + mn(vad, 'porucha', 'poruchy', 'poruch') + ' od postavení.'
    + (list.length > 1 && popis.hodnota(nej) !== popis.hodnota(posl)
        ? ' ' + popis.shrn(esc(nej.name), esc(posl.name)) : '')
    + '</p>';
  [].forEach.call(box.querySelectorAll('[data-stroj-id]'), function (r) {
    r.onclick = function () { unitSheet(najdiJednotku(r.getAttribute('data-stroj-id'))); };
  });
}
// ─── Žebříčky ────────────────────────────────────────────────────────────────
var ZEB = null, ZEB_KAT = 'pradlomaty';
var ZEB_POPIS = {
  pradlomaty: { nadpis: 'Nejvíc prádlomatů', jed: function (v) { return v + '×'; },
    pod: 'Počítají se postavené prádlomaty — to je jediné číslo, které hlídá server. Koupený pozemek bez stroje se nepočítá.' },
  zisk: { nadpis: 'Nejvyšší měsíční zisk', jed: function (v) { return kcFull(v); },
    pod: 'Podle poslední uložené sítě hráče.' },
  hvezdy: { nadpis: 'Nejlepší hodnocení zákazníků',
    jed: function (v) { return hvezdyText(v); },
    pod: 'Jedna až pět hvězdiček podle toho, jak si hráč vede na infolince. '
      + 'Kdo ještě žádný hovor neměl, v žebříčku není.' },
  pozvanky: { nadpis: 'Nejvíc pozvánek', jed: function (v) { return v + '×'; },
    pod: 'Kolikrát někdo otevřel sdílený odkaz hráče.' },
  zeme: { nadpis: 'Prádlomaty po zemích', jed: function (v) { return v + '×'; },
    pod: 'Kolik prádlomatů stojí v které zemi — všech hráčů dohromady, '
      + 'rozepsané po modelích.' },
  jmeni: { nadpis: 'Největší čisté jmění', jed: function (v) { return kcFull(v); },
    pod: 'Co hráč má, minus co dluží: prádlomaty, stroje skladem, pobočky a technika '
      + 'v pořizovací ceně, plus hotovost, minus úvěr. V minusu se může být.' }
};
function loadZeb() {
  // Při výpadku nastavíme prázdný žebříček — jinak by panel zůstal viset
  // na „Načítám…" a hráč by nevěděl, že se něco pokazilo.
  var prazdny = { pradlomaty: [], zisk: [], pozvanky: [], jmeni: [], hvezdy: [], zeme: [],
    ja: null, hracu: 0, chyba: true };
  return api('/leaderboard')
    .then(function (r) { ZEB = r.ok ? r.j : prazdny; })
    .catch(function () { ZEB = prazdny; });
}
// ─── Vlaječky zemí ─────────────────────────────────────────────────
// Vlajka je dvojice znaků „regional indicator“ — telefon z nich slöží obrázek
// vlajky sám. Kde na to písmo není (Windows), ukáže aspoň kód země, což stačí.
var ZEME_NAZEV = { cz: 'Česko', sk: 'Slovensko', pl: 'Polsko', de: 'Německo', at: 'Rakousko',
  hu: 'Maďarsko', si: 'Slovinsko', hr: 'Chorvatsko', it: 'Itálie', es: 'Španělsko',
  fr: 'Francie', nl: 'Nizozemsko', be: 'Belgie', ch: 'Švýcarsko', gb: 'Velká Británie',
  ie: 'Irsko', dk: 'Dánsko', se: 'Švédsko', no: 'Norsko', fi: 'Finsko', pt: 'Portugalsko',
  ro: 'Rumunsko', bg: 'Bulharsko', gr: 'Řecko', ua: 'Ukrajina', us: 'Spojené státy',
  ca: 'Kanada' };
function vlajka(kod) {
  var k = String(kod || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(k)) return '';
  return String.fromCodePoint(0x1F1E6 + k.charCodeAt(0) - 65, 0x1F1E6 + k.charCodeAt(1) - 65);
}
function zemeNazev(kod) {
  var k = String(kod || '').toLowerCase();
  return ZEME_NAZEV[k] || k.toUpperCase();
}
// Vlaječky zemí, ve kterých hráči stojí prádlomaty — od té, kde jich má nejvíc.
function vlajkyHtml(zeme) {
  var z = (zeme || []).filter(function (k) { return vlajka(k); });
  if (!z.length) return '';
  return '<i class="vlajky" title="' + esc(z.map(zemeNazev).join(', ')) + '">'
    + z.map(function (k) { return '<i>' + vlajka(k) + '</i>'; }).join('') + '</i>';
}
// Čeština má tři tvary — jeden hráč, dva hráči, pět hráčů.
function hracuSlovy(n) {
  return n + (n === 1 ? ' hráč' : (n >= 2 && n <= 4 ? ' hráči' : ' hráčů'));
}
// Země místo hráčů: vlaječka, název, rozpis po modelích a celkový počet.
function zemeRadek(z) {
  var mod = ['mini', 'flex', 'max'].map(function (k) {
    return '<i class="' + (z[k] ? 'je' : 'nic') + '">' + k.toUpperCase() + ' ' + (z[k] || 0) + '</i>';
  }).join('');
  return '<div class="zeb-row zeme">'
    + '<i class="zeb-vlaj">' + (vlajka(z.kod) || esc(String(z.kod || '').toUpperCase())) + '</i>'
    + '<span class="nick">' + esc(zemeNazev(z.kod))
    + '<i class="zeme-mod">' + mod + '<b>' + hracuSlovy(z.hracu) + '</b></i></span>'
    + '<b>' + z.celkem + '×</b></div>';
}
function paintZeb() {
  var box = $('zeb-body');
  if (!ZEB) { box.innerHTML = '<p class="muted small">Načítám…</p>'; return loadZeb().then(paintZeb); }
  var list = ZEB[ZEB_KAT] || [], popis = ZEB_POPIS[ZEB_KAT];
  if (ZEB_KAT === 'zeme') {
    box.innerHTML = '<h3 style="margin:14px 0 2px">' + popis.nadpis + '</h3>'
      + '<p class="muted small" style="margin:0 0 10px">' + popis.pod + '</p>'
      + (list.length
        ? '<div class="zeb">' + list.map(zemeRadek).join('') + '</div>'
        : '<div class="empty">' + (ZEB.chyba
            ? 'Žebříček se nepodařilo načíst. Zkus to za chvíli.'
            : 'Zatím nikde nic nestojí.') + '</div>')
      + (list.length ? '<p class="fine">Celkem ' + list.reduce(function (a, z) { return a + z.celkem; }, 0)
          + ' prádlomatů v ' + list.length + (list.length === 1 ? ' zemi.' : (list.length <= 4 ? ' zemích.' : ' zemích.')) + '</p>' : '');
    return;
  }
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
            + vlajkyHtml(x.zeme)
            + '<b>' + popis.jed(x.hodnota) + '</b></div>';
        }).join('') + '</div>'
      : '<div class="empty">' + (ZEB.chyba ? 'Žebříček se nepodařilo načíst. Zkus to za chvíli.' : 'Tady zatím nikdo není. Buď první.') + '</div>')
    + (ja && ja.poradi > list.length
      ? '<p class="muted small" style="margin-top:12px">Ty jsi ' + ja.poradi + '. z ' + ja.z + ' — ' + popis.jed(ja.hodnota) + '.</p>'
      : '')
    + (ZEB.hracu ? '<p class="fine">Hráčů se sítí: ' + ZEB.hracu + '</p>' : '');
}

// Pověst z infolinky — ať je vidět i mimo hovor, co to s návštěvností dělá.
function povestHtml() {
  var p = povest();
  var zmena = Math.round((povestKoef() - 1) * 100);
  return '<div class="card"><div class="row"><h3>Infolinka</h3>'
    + '<b class="' + (p > 0 ? 'ok' : (p < 0 ? 'err' : '')) + '">' + hvezdyText() + '</b></div>'
    + '<p class="muted small" style="margin:2px 0 0">Pověst u zákazníků je ' + povestSlovy() + '.</p>'
    + '<div class="povest-pas"><i style="left:' + ((p + 100) / 2) + '%"></i></div>'
    + '<div class="kv"><span>Návštěvnost z pověsti</span><b class="'
    + (zmena > 0 ? 'ok' : (zmena < 0 ? 'err' : '')) + '">' + (zmena > 0 ? '+' : '') + zmena + ' %</b></div>'
    + '<p class="fine" style="margin-top:8px">Zákazníci volí, jen když jsi ve hře. '
    + 'Kdo hovor vezme a umí poradit, má v prádlomatech víc lidí — až o desetinu. '
    + 'Kdo je odmítá nebo odbyde, přijde až o pětinu návštěvnosti. Zvoní to jen pět vteřin — '
    + 'co se nevezme, bere se jako nevyřízený hovor.</p></div>';
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
    + (zaMorem().length
        ? '<p class="fine warn" style="margin-top:8px">' + zaMoremSlovy(zaMorem().length)
          + ' za mořem (' + esc(zaMorem().map(function (u) { return u.name; }).slice(0, 3).join(', '))
          + '). Servis tam musí trajektem nebo letadlem — pobočka na té straně se zaplatí '
          + 'už na ušetřeném čase výjezdů.</p>'
        : '')
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
      zapis('nakup', 'Pobočka ' + m.name, -POBOCKA_CENA);
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
  // Odkaz na grafy — čísla nahoře jsou dnešní stav, tohle je cesta k němu.
  var vyv = $('net-do-vyvoje');
  if (vyv) vyv.onclick = function () { netZalozka('vyvoj'); };
  if (!S.units.length) {
    $('net-list').innerHTML = povestHtml() + zakladnyHtml() + cetaHtml()
      + '<div class="empty">Zatím nemáš ani jeden prádlomat.<br>Začni tím, že na mapě prozkoumáš oblast.</div>';
    bindZakladny();
    return;
  }
  $('net-list').innerHTML = povestHtml() + zakladnyHtml() + cetaHtml() + S.units.slice().sort(function (a, b) { return b.eco.profit - a.eco.profit; }).map(function (u) {
    return '<div class="card" data-unit="' + esc(u.spotId) + '">'
      + '<div class="row"><h3>' + esc(u.name) + '</h3>' + verdictPill(u.score) + '</div>'
      + '<p class="muted small" style="margin:2px 0 6px">' + esc(KIND_LABEL[u.kind] || 'Místo') + ' · ' + MODELS[u.eco.model].name + '</p>'
      + (function () {
        var l = uverMista(u);
        if (!l) return '<div class="row"><span class="muted small">Zisk / měsíc</span><b class="ok">' + kcFull(u.eco.profit) + '</b></div></div>';
        // Místo na dluh: číslo před splátkou je jen mezikrok, rozhoduje to pod ním.
        var splatka = splatkaMista(u);
        var cisty = zbydeZMista(u);
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
      + '<div class="kv"><span>Vyčerpáno</span><b>' + kcFull(ramecCerpano()) + '</b></div>'
      + '<div class="kv"><span>K čerpání</span><b class="' + (volny > 0 ? 'ok' : 'warn') + '">' + kcFull(volny) + '</b></div>'
      + (S.ramec.slabyOd
          ? '<p class="fine err">Čerpání je zastavené — ' + slabaMista().length + ' '
            + mn(slabaMista().length, 'místo nevydělá', 'místa nevydělají', 'míst nevydělá')
            + ' na svou splátku. Banka dá rámci ' + etaText(S.ramec.slabyOd + RAMEC_LHUTA - Date.now())
            + ', pak ho zavře. Sprav to, nebo slabá místa prodej.</p>'
          : '<p class="fine">Čerpat můžeš bez dalšího pohovoru — jen krátké tři otázky. '
            + 'Podmínka je, že každý prádlomat vydělá aspoň na svou splátku.</p>')
      + ramecRozborHtml()
      + (volny >= 1000 ? '<button class="btn sec big" id="do-cerpat">Čerpat z rámce</button>' : '')
      + '<button class="btn sec" id="do-prehodnotit" style="width:100%;margin-top:8px">Požádat o navýšení</button>'
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
// Z čeho limit vychází a co s ním pohne — bez toho hráč jen kouká na číslo.
function ramecRozborHtml() {
  var sl = ramecSlozky();
  var drzi = sl.zisk < sl.historie ? 'zisk' : 'historie';
  return '<div class="kv" style="margin-top:8px"><span>Za doplacená místa (' + doplacenychMist() + ')</span>'
    + '<b class="' + (drzi === 'historie' ? 'warn' : '') + '">' + kcFull(sl.historie) + '</b></div>'
    + '<div class="kv"><span>Co unese výdělek sítě</span>'
    + '<b class="' + (drzi === 'zisk' ? 'warn' : '') + '">' + kcFull(sl.zisk) + '</b></div>'
    + '<p class="fine">Platí ten menší z nich. ' + (drzi === 'zisk'
        ? 'Limit teď drží výdělek — zvedne ho vyšší zisk nebo nižší splátky.'
        : 'Limit teď drží historie — každý další doplacený prádlomat přidá ' + kcFull(RAMEC_ZA_MISTO) + '.')
    + ' Banka ho sama srovná jednou za herní měsíc a hned, jakmile ti ubude nebo přibude '
    + 'prádlomat — limit stojí na tom, kolik doplacených strojů máš v provozu. '
    + 'Dolů jde po čtvrtinách a nikdy pod to, co máš načerpané.</p>';
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
      S.ramec = { limit: limit, cerpano: 0, od: Date.now(), slabyOd: null, zavreny: null,
        bonus: st.sazba, puvodniCil: ramecNavrh() || limit, prehodnoceno: Date.now() };
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
      S.cash += c;
      zapis('uver', 'Čerpání z rámce', c);
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
    + '<p class="muted small" style="margin:2px 0 10px">Každý má svoji sazbu a pevnou splátku. '
    + 'Kterýkoli můžeš kdykoli předčasně splatit bez sankce — nebo si u něj vyjednat jinou délku splácení: delší srazí splátku, kratší ušetří na úrocích.</p>'
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
          + ((u.prepsano || u.prodlouzeno) ? '<p class="fine">Délku splácení už jsi jednou vyjednával'
              + ((u.prepsano || u.prodlouzeno) > 1 ? ' (' + (u.prepsano || u.prodlouzeno) + '×)' : '') + '.</p>' : '')
          + (u.zmeskano ? '<p class="fine err">Nezaplacená splátka: ' + u.zmeskano + ' ze ' + KRACH_SPLATEK
              + '. Když přišla splátka, neměl jsi na ni hotovost — co jsi nezaplatil, přičetlo se k dluhu. '
              + (u.zmeskano >= KRACH_SPLATEK - 1
                  ? 'Ještě jedna a banka pošle firmu do konkurzu. '
                  : 'Při třetí jde firma do konkurzu. ')
              + 'Jakmile jednu splátku zaplatíš celou, počítadlo se vynuluje.</p>' : '')
          + '<div class="uver-akce">'
          + '<button class="btn sec sm" data-splatit="' + esc(u.id) + '"' + (S.cash < 1 ? ' disabled' : '') + '>Splatit tenhle</button>'
          + '<button class="btn sec sm" data-prodlouzit="' + esc(u.id) + '">Změnit splatnost</button>'
          + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}
// Panel: mimořádná splátka jednoho úvěru.
function splatitUverSheet(id) {
  var l = (S.loans || []).filter(function (x) { return x.id === id; })[0];
  if (!l) return;
  var max = Math.min(Math.floor(S.cash), Math.round(l.zbyva));
  if (max < 1) return toast('Na mimořádnou splátku teď nemáš hotovost.', 'err');
  sheet('<h3>Splatit — ' + esc(l.popis || 'Úvěr') + '</h3>'
    + '<p class="muted small">Splátka zůstane stejně vysoká a úvěr skončí dřív — tak ušetříš nejvíc na úrocích. '
    + 'Bez sankce, kdykoli.</p>'
    + '<div class="kv"><span>Zbývá splatit</span><b>' + kcFull(l.zbyva) + '</b></div>'
    + '<div class="kv"><span>Úrok ' + (l.sazba * 100).toFixed(1).replace('.', ',') + ' % — měsíčně</span><b class="warn">'
    + kcFull(Math.round(l.zbyva * l.sazba / 12)) + '</b></div>'
    + '<div class="kv"><span>Máš v hotovosti</span><b>' + kcFull(S.cash) + '</b></div>'
    + '<label class="fld"><span>Kolik splatit (nejvíš ' + kcFull(max) + ')</span>'
    + '<input id="sp-amt" class="inp" type="number" min="1" step="1000" max="' + max + '" value="' + max + '"></label>'
    + '<p class="fine" id="sp-note"></p>'
    + '<button class="btn big" id="sp-go">Splatit</button>');
  var i = $('sp-amt'), note = $('sp-note');
  var prepis = function () {
    var v = Math.max(0, Math.min(max, Math.round(Number(i.value) || 0)));
    note.textContent = v >= Math.round(l.zbyva)
      ? 'Tímhle úvěr úplně zmizí — ušetříš ' + kcFull(Math.round(l.zbyva * l.sazba / 12)) + ' na úroku každý měsíc.'
      : 'Po splátce zůstane ' + kcFull(Math.round(l.zbyva) - v) + '. Úrok klesne na '
        + kcFull(Math.round((l.zbyva - v) * l.sazba / 12)) + ' měsíčně.';
  };
  i.oninput = prepis; prepis();
  $('sp-go').onclick = function () {
    var dal = splatitUver(id, Number(i.value) || 0);
    if (!dal) return toast('Zadej částku, kterou máš.', 'err');
    save(); paint(); paintBank(); closeSheet(); syncState(true);
    toast('Splaceno ' + kcFull(dal) + '.', 'ok');
  };
}
// Panel: vyjednání delší splatnosti u běžícího úvěru.
function prodlouzitSheet(id, vybrany) {
  var l = (S.loans || []).filter(function (x) { return x.id === id; })[0];
  if (!l) return;
  var lze = splatnostiLze(l);
  var nalada = naladaDnes();
  var ted = splatnostIdx(l);
  if (!lze.length) {
    sheet('<h3>Změnit délku splácení</h3>'
      + '<div class="nalada ' + nalada.id + '"><b>' + nalada.nazev + '</b><span>' + esc(nalada.slovo) + '</span></div>'
      + '<p class="muted small">Tenhle úvěr už není kam přepsat.</p>'
      + '<button class="btn sec big" id="pr-zavrit">Rozumím</button>');
    var zx = $('pr-zavrit');
    if (zx) zx.onclick = closeSheet;
    return;
  }
  // Předvybere nejbližší delší stupeň — pro něj sem hráč chodí nejčastěji.
  // Když delší není, nabídne nejbližší kratší.
  var i = vybrany;
  if (i == null) {
    var delsi = lze.filter(function (k) { return k > ted; });
    i = delsi.length ? delsi[0] : lze[lze.length - 1];
  }
  var n = zmenaNavrh(l, i);
  var splatkaTed = Math.min(l.splatka, l.zbyva);
  var zbydePak = Math.round(cistyZisk() - n.rozdilSplatky);
  var strop = maxSplatnost();
  sheet('<h3>Změnit délku splácení</h3>'
    + '<p class="muted small">' + esc(l.popis || 'Úvěr') + ' — zbývá ' + kcFull(l.zbyva)
    + ', teď na ' + SPLATNOSTI[ted].nazev + '</p>'
    + '<div class="nalada ' + nalada.id + '"><b>' + nalada.nazev + '</b><span>' + esc(nalada.slovo) + '</span></div>'
    + '<label class="fld"><span>Na jak dlouho — krátká stojí míň, dlouhá uleví měsíčně</span></label>'
    + '<div class="splat">'
    + SPLATNOSTI.map(function (x, k) {
        if (k === ted) return '<button class="splat-b ted" disabled><b>' + x.nazev + '</b><span>teď</span></button>';
        var moznost = lze.indexOf(k) >= 0;
        if (!moznost) return '<button class="splat-b zamceno" disabled><b>' + x.nazev + '</b><span>zamčeno</span></button>';
        var m = zmenaNavrh(l, k);
        return '<button class="splat-b' + (k === i ? ' on' : '') + '" data-pr-sp="' + k + '">'
          + '<b>' + x.nazev + '</b><span>' + kcFull(m.splatka) + ' / měs</span></button>';
      }).join('')
    + '</div>'
    + (strop < SPLATNOSTI.length - 1 ? '<p class="fine">Zkrátit můžeš vždycky. Na delší splatnost zatím nedosáhneš: '
        + esc(splatnostDuvod(strop + 1)) + '</p>' : '')
    + '<div class="kv"><span>Splátka teď</span><b>' + kcFull(splatkaTed) + ' / měsíc</b></div>'
    + '<div class="kv"><span>Splátka po přepsání</span><b class="' + (n.rozdilSplatky <= 0 ? 'ok' : 'warn') + '">'
    + kcFull(n.splatka) + ' / měsíc</b></div>'
    + '<div class="kv souhrn"><span>' + (n.rozdilSplatky <= 0 ? 'Ušetříš každý měsíc' : 'Zaplatíš každý měsíc navíc') + '</span>'
    + '<b class="' + (n.rozdilSplatky <= 0 ? 'ok' : 'warn') + '">' + kcFull(Math.abs(n.rozdilSplatky)) + '</b></div>'
    + '<div class="kv"><span>Úrok</span><b>' + (l.sazba * 100).toFixed(1).replace('.', ',') + ' % → '
    + (n.sazba * 100).toFixed(1).replace('.', ',') + ' % ročně</b></div>'
    + '<div class="kv"><span>' + (n.rozdilUroku <= 0 ? 'Na úrocích ušetříš celkem' : 'Na úrocích zaplatíš navíc') + '</span>'
    + '<b class="' + (n.rozdilUroku <= 0 ? 'ok' : 'warn') + '">' + kcFull(Math.abs(n.rozdilUroku)) + '</b></div>'
    + '<div class="kv"><span>Poplatek za přepsání (' + (PRODLOUZENI_POPLATEK * 100).toFixed(1).replace('.', ',') + ' %)</span><b class="warn">'
    + kcFull(n.poplatek) + '</b></div>'
    + '<p class="fine' + (zbydePak < 0 ? ' err' : '') + '">' + (n.delsi
        ? 'Splátka klesne hned, ale úvěr poběží ' + n.mesicu + ' měsíců místo ' + (l.zbyvaMesicu || 0)
          + '. Banka na tom vydělá — proto ti to ráda dá.'
        : 'Úvěr budeš mít z krku za ' + n.mesicu + ' měsíců místo ' + (l.zbyvaMesicu || 0)
          + ' a ještě ti srazí přirážku. Zaplatíš ale víc každý měsíc.')
    + ' Po přepsání ti měsíčně zbyde ' + kcFull(zbydePak) + '.</p>'
    + '<button class="btn big" id="pr-go"' + (S.cash < n.poplatek ? ' disabled' : '') + '>Přepsat na ' + SPLATNOSTI[i].nazev + '</button>'
    + (S.cash < n.poplatek ? '<p class="fine err">Na poplatek ' + kcFull(n.poplatek) + ' teď nemáš hotovost.</p>' : '')
    + '<button class="btn ghost" id="pr-zavrit">Nechám to tak</button>');
  var z = $('pr-zavrit');
  if (z) z.onclick = closeSheet;
  [].forEach.call($('sheet-body').querySelectorAll('[data-pr-sp]'), function (b) {
    b.onclick = function () { prodlouzitSheet(id, Number(b.getAttribute('data-pr-sp'))); };
  });
  var g = $('pr-go');
  if (g) g.onclick = function () {
    var r = zmenitSplatnost(id, i);
    if (!r) return toast('Na poplatek nemáš hotovost.', 'err');
    save(); paint(); paintBank(); closeSheet(); syncState(true);
    toast('Přepsáno na ' + r.nazev + ' — splátka ' + kcFull(r.splatka) + ' měsíčně.', 'ok');
  };
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
    + dalsiSplatkaHtml()
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
  var pr = $('do-prehodnotit');
  if (pr) pr.onclick = function () {
    pr.disabled = true;
    prehodnotRamec(true);
    paint();
    syncState(true);
  };
  [].forEach.call($('bank-body').querySelectorAll('[data-splatit]'), function (b) {
    b.onclick = function () { splatitUverSheet(b.getAttribute('data-splatit')); };
  });
  [].forEach.call($('bank-body').querySelectorAll('[data-prodlouzit]'), function (b) {
    b.onclick = function () { prodlouzitSheet(b.getAttribute('data-prodlouzit')); };
  });
  var b = $('do-repay');
  if (b) b.onclick = function () {
    var pay = Math.min(S.cash, S.loan);
    S.cash -= pay; splatitDluh(pay); S.bank = Math.min(bankCap(), S.bank + pay);
    zapis('splatka', 'Doplacení úvěrů', -pay);
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
    + dalsiSplatkaHtml()
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
    zapis('splatka', 'Doplacení úvěrů', -pay);
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
// Rozpis provizí: kdy, od koho a za co. Tažíme ho ze serveru až při otevření —
// ve stavu hry není, protože provize vznikají u zvoucího, ne u hráče.
// Datum a čas lidsky — u provizí je důležité obojí, hráči jich chodí víc za den.
function datumCas(x) {
  try {
    return new Date(x).toLocaleString('cs-CZ',
      { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ''; }
}
function provizeSheet() {
  sheet('<h3>Provize</h3><p class="muted small">Načítám…</p>');
  api('/account/provize').then(function (r) {
    var list = (r.ok && r.j.provize) || [];
    var celkem = list.reduce(function (a, x) { return a + (x.castka || 0); }, 0);
    sheet('<h3>Provize</h3>'
      + '<p class="muted small">Deset procent z ceny každého stroje, který si koupil někdo '
      + 'z tvé sítě. Vyplácí se hned při nákupu.</p>'
      + (list.length
          ? '<div class="sum-grid" style="margin:12px 0">'
            + '<div><span>Dohromady</span><b class="ok">' + kcFull(celkem) + '</b></div>'
            + '<div><span>Provizí</span><b>' + list.length + '×</b></div></div>'
            + '<div class="srv">' + list.map(function (x) {
                return '<div class="srv-radek">'
                  + '<i class="srv-tecka ' + (x.vyzvednuto ? 'ok' : 'warn') + '"></i>'
                  + '<span><b>' + esc(x.zac || 'provize') + '</b>'
                  + '<i>' + esc(datumCas(x.kdy)) + (x.vyzvednuto ? '' : ' · čeká na vyzvednutí') + '</i></span>'
                  + '<b class="ok">' + kcFull(x.castka) + '</b></div>';
              }).join('') + '</div>'
          : '<div class="empty">Zatím žádná provize.<br>Přiveď někoho do hry a dostaneš '
            + 'desetinu z každého stroje, který si koupí.</div>')
      + (list.length >= 200 ? '<p class="fine">Ukazuje se posledních 200.</p>' : ''));
  }).catch(function () {
    sheet('<h3>Provize</h3><p class="muted small">Rozpis se nepodařilo načíst. Zkus to za chvíli.</p>');
  });
}
function loadDist(then) {
  if (!ME) { DIST = null; if (then) then(); return; }
  api('/account/distributor').then(function (r) {
    DIST = r.ok ? r.j : null;
    if (then) then();
    // Server mohl právě teď dorovnat provize, které nevznikly včas. Vyzvedneme
    // je hned — čekat na minutový tep by vypadalo, že peníze nepřišly.
    nactiNajmy(function () {
      vyzvedniNasledky(function () { if (!$('v-me').classList.contains('hidden')) paintMe(); });
    });
  }).catch(function () { if (then) then(); });
}
function distHtml() {
  if (!ME) return '';
  if (!DIST) return '<div class="card"><h3>Distributor</h3><p class="fine">Načítám…</p></div>';
  var aktivni = DIST.aktivni, rezie = DIST.rezie;
  return '<div class="card"><h3>Distributor prádlomatů</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Platíš měsíční režii a bereš '
    + Math.round(DIST.provize * 100) + ' % z ceny každého prádlomatu, který si koupí hráč, '
    + 'kterého jsi do hry přivedl. Vyplácí se hned při nákupu — nečeká se na dovoz ani stavbu. '
    + 'Platí to i na jeho druhý, třetí a každý další.</p>'
    + '<div class="kv"><span>Stav</span><b class="' + (aktivni ? 'ok' : 'warn') + '">'
    + (aktivni ? 'aktivní, končí ' + etaText(new Date(DIST.do).getTime() - Date.now()) : 'neaktivní') + '</b></div>'
    + '<div class="kv"><span>Přivedených hráčů</span><b>' + DIST.privedeno + '</b></div>'
    + '<div class="kv"><span>Režie na měsíc</span><b class="' + (rezie > 0 ? 'warn' : 'ok') + '">'
    + (rezie > 0 ? kcFull(rezie) : 'zdarma') + '</b></div>'
    + (DIST.provize_celkem > 0
        ? '<button class="kv kv-klik" id="do-provize"><span>Vyděláno na provizích</span>'
          + '<b class="ok">' + kcFull(DIST.provize_celkem) + ' ›</b></button>' : '')
    + '<p class="fine">' + (rezie > 0
        ? 'Režie roste o ' + kcFull(40000) + ' s každými pěti přivedenými hráči — čím větší síť, tím dražší provoz.'
        : 'Do pěti přivedených hráčů je distribuce zdarma. Od pátého začneš platit '
          + kcFull(40000) + ' za herní měsíc a dál to roste po stejných dávkách.')
    + ' Obnovit se musí každý herní měsíc, jinak výhoda spadne.</p>'
    + (S.cash >= rezie
        ? '<button class="btn sec" id="do-dist" style="width:100%;margin-top:8px">'
          + (aktivni
              ? 'Prodloužit o měsíc' + (rezie > 0 ? ' za ' + kcFull(rezie) : ' zdarma')
              : 'Zapnout na měsíc' + (rezie > 0 ? ' za ' + kcFull(rezie) : ' zdarma')) + '</button>'
        : '<p class="fine err">Na režii ti chybí ' + kcFull(rezie - S.cash) + '.</p>')
    + '</div>';
}
function bindDist() {
  var pr = $('do-provize');
  if (pr) pr.onclick = provizeSheet;
  var b = $('do-dist');
  if (!b) return;
  b.onclick = function () {
    if (!DIST || S.cash < DIST.rezie) return;
    b.disabled = true; b.textContent = 'Platím…';
    var rezie = DIST.rezie;
    apiJson('/account/distributor', {}).then(function (r) {
      if (!r.ok) { b.disabled = false; return toast(r.j.error || 'Nepovedlo se.', 'err'); }
      S.cash -= rezie;
      zapis('poplatek', 'Distributorský program — měsíční režie', -rezie);
      save(); syncState(true);
      loadDist(function () { paintMe(); });
      toast(rezie > 0 ? 'Distribuce zaplacená na další herní měsíc.'
        : 'Distribuce zapnutá na další herní měsíc — zdarma.', 'ok');
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
        // U každého je vidět, kolik má strojů a za kolik z nich už provize přišla.
        // Když se čísla rozcházejí, je hned jasné, u koho to vázne.
        var stroju = h.stroju || 0, provizi = h.provizi || 0;
        var chybi = stroju > provizi;
        return '<div class="zeb-row">' + (h.znak ? znakSvg(h.znak, 24) : '<i class="znak-mezera"></i>')
          + '<span class="nick">' + esc(h.firma)
          + '<i>' + esc(h.nick) + ' · ' + stroju + ' '
          + mn(stroju, 'stroj', 'stroje', 'strojů') + ' · provize z ' + provizi + '</i></span>'
          + '<b class="' + (h.provize ? 'ok' : (chybi ? 'warn' : 'muted')) + '">'
          + (h.provize ? kc(h.provize) : datumKratce(h.kdy)) + '</b></div>';
      }).join('') + '</div>'
    + (POZVANI.some(function (h) { return (h.stroju || 0) > (h.provizi || 0); })
        ? '<p class="fine" style="margin-top:8px">U někoho máš míň provizí než strojů. '
          + 'Dorovná se to samo, jakmile tuhle záložku otevřeš — ale jen když máš distribuci '
          + 'zapnutou. S vypnutou se nedoplatí nic, dokud ji nezapneš.</p>' : '');
}
// Místo na mapě podle id — ať se dá z přehledu majetku skočit rovnou na něj.
function spotPodle(spotId) {
  var nalez = null;
  Object.keys(S.areas || {}).forEach(function (aid) {
    ((S.areas[aid] || {}).spots || []).forEach(function (sp) {
      if (sp.id === spotId) nalez = { sp: sp, areaId: aid };
    });
  });
  return nalez;
}
// ─── Můj majetek ─────────────────────────────────────────────────────────────
// Rozvaha na jedné kartě: co hráč vlastní, co za to dluží a co mu zbývá. Bez ní
// se dá snadno zapomenout, že někde leží koupená zem, na které se nestaví.
function majetekHtml() {
  var zem = pozemky();
  var skladem = 0, cesta = 0;
  MODEL_ORDER.forEach(function (k) { skladem += inStock(k); cesta += onWay(k); });
  var zazemi = (S.pobocky || []).length * POBOCKA_CENA + (maCetu() ? CETA_CENA : 0);
  var majetek = assetsTotal() + zazemi;
  var polozky = [
    { n: 'Postavené prádlomaty', m: S.units.length + '×', v: investedTotal() },
    { n: 'Stroje skladem a na cestě', m: skladem + '× skladem' + (cesta ? ', ' + cesta + '× na cestě' : ''), v: stockValue() },
    { n: 'Pozemky a zaplacené plochy', m: zem.length + '×', v: pozemkyHodnota() },
    { n: 'Pobočky a servisní četa', m: (S.pobocky || []).length + '× pobočka' + (maCetu() ? ', četa' : ''), v: zazemi }
  ];
  var najem = najmyMesicne();
  return '<div class="card"><h3>Můj majetek</h3>'
    + '<p class="muted small" style="margin:2px 0 8px">Co všechno vlastníš a kolik z toho zbude, až se odečte banka.</p>'
    + polozky.map(function (x) {
        return '<div class="kv"><span>' + esc(x.n) + ' <i class="muted small">' + esc(x.m) + '</i></span><b>'
          + kcFull(x.v) + '</b></div>';
      }).join('')
    + (najem ? '<div class="kv"><span>Nájem z pronajatých pozemků</span><b class="ok">+'
        + kcFull(najem) + ' / měsíc</b></div>' : '')
    + '<div class="kv souhrn"><span>Majetek celkem</span><b>' + kcFull(majetek) + '</b></div>'
    + '<div class="kv"><span>Hotovost</span><b>' + kcFull(S.cash) + '</b></div>'
    + '<div class="kv"><span>Dluh u banky</span><b class="' + (S.loan ? 'err' : '') + '">'
    + (S.loan ? '\u2212' + kcFull(S.loan) : kcFull(0)) + '</b></div>'
    + '<div class="kv souhrn"><span>Čisté jmění</span><b class="' + (cisteJmeni() >= 0 ? 'ok' : 'err') + '">'
    + kcFull(cisteJmeni()) + '</b></div>'
    + '<h3 style="margin:16px 0 4px">Moje pozemky</h3>'
    + (zem.length
        ? zem.map(function (z) {
            var pl = planMista(z.spotId);
            var mist = pl && pl.hotovo && pl.zaplaceno ? planStroje(pl).length : 0;
            var stoji = strojuNaPozemku(z.spotId);
            var stav = stoji
              ? stoji + '\u00d7 prádlomat' + (mist > stoji ? ', volná stání: ' + (mist - stoji) : '')
              : mist ? 'plocha připravená na ' + mist + ' ' + mn(mist, 'stání', 'stání', 'stání') + ', čeká na stroj'
              : 'holá parcela — plocha se musí připravit';
            return '<div class="area-item" data-zem="' + esc(z.spotId) + '">'
              + '<div><div class="nm">\u2302 ' + esc(z.name || 'Pozemek') + '</div>'
              + '<div class="sub">' + (z.m2 || '?') + ' m\u00b2 · ' + stav + '</div></div>'
              + '<b>' + kcFull((z.cena || 0) + (z.priprava || 0)) + '</b></div>';
          }).join('')
        : '<p class="fine">Zatím žádný. Na mapě poznáš pozemky na prodej podle zelené značky s domečkem — '
          + 'koupená zem pak má bílý rámeček a cedulku „můj pozemek".</p>')
    + '</div>';
}
function bindMajetek() {
  [].forEach.call(document.querySelectorAll('[data-zem]'), function (r) {
    r.onclick = function () {
      var n = spotPodle(r.getAttribute('data-zem'));
      if (!n) return toast('Tenhle pozemek je v městě, které zrovna není načtené.', 'err');
      switchTab('map');
      if (map) map.setView([n.sp.lat, n.sp.lon], Math.max(16, map.getZoom()));
      spotSheet(n.sp, n.areaId);
    };
  });
}
function paintMe() {
  var p = PROFILES[S.profile];
  // Co má hráč rozepsané, přežije překreslení.
  var drzFirma = $('me-firma') ? $('me-firma').value : null;
  var net = cisteJmeni();
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
    + majetekHtml()
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
    + knihaHtml()
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
  bindMajetek();
  var kn = $('do-kniha');
  if (kn) kn.onclick = function () { KNIHA_FILTR = 'vse'; knihaSheet(); };
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
      CEKA_NABIDKA = !!r.j.ceka_na_me;
      chatOdznak();
    } else TRADES = [];
    if (then) then();
  }).catch(function () { TRADES = TRADES || []; if (then) then(); });
}

// ─── Zprávy mezi hráči ─────────────────────────────────────────
// Text od cizího hráče se do stránky nikdy nevkládá jako HTML — vždy přes esc().
var CHAT = null;
function loadChat(then) {
  if (!ME) { CHAT = { threads: [], neprectenych: 0 }; if (then) then(); return; }
  api('/chat/threads').then(function (r) {
    CHAT = r.ok ? r.j : { threads: [], neprectenych: 0 };
    chatOdznak();
    hlidejZpravy();
    if (then) then();
  }).catch(function () { CHAT = CHAT || { threads: [], neprectenych: 0 }; if (then) then(); });
}
// ─── Zpráva od hráče doprostřed obrazovky ────────────────────────────────────
// Když někdo napíše, zatímco hráč hraje, nestačí tečka na záložce — obchod se
// domlouvá teď a odpověď za hodinu je k ničemu. Chová se to proto jako hovor
// z infolinky: okno přes celou obrazovku, dokud ho hráč neodbaví. Nestohuje se
// s hovorem a jednu zprávu neukáže dvakrát ani po obnovení stránky.
var ZPRAVA_OKNO = null;
function hlidejZpravy() {
  if (!ME || !S || !CHAT || !CHAT.threads || !CHAT.threads.length) return;
  if (HOVOR || ZPRAVA_OKNO) return;
  // Poprvé si jen zapamatujeme, co už ve schránce leží. Jinak by hráči po
  // otevření hry vyskočilo okno se zprávou, kterou si přečetl předevčírem.
  if (S.zpravaVidena == null) {
    S.zpravaVidena = CHAT.threads.reduce(function (a, t) {
      return Math.max(a, (t.posledni && t.posledni.id) || 0); }, 0);
    save();
    return;
  }
  var nove = CHAT.threads.filter(function (t) {
    return t.neprectenych > 0 && t.posledni && !t.posledni.moje
      && t.posledni.id > (S.zpravaVidena || 0);
  });
  if (!nove.length) return;
  S.zpravaVidena = nove.reduce(function (a, t) { return Math.max(a, t.posledni.id); }, S.zpravaVidena || 0);
  save();
  ukazZpravu(nove[0], nove.length - 1);
}
function ukazZpravu(t, dalsich) {
  var el = $('zprava');
  if (!el) return;
  ZPRAVA_OKNO = t;
  el.innerHTML = '<div class="zpr-in">'
    + '<p class="hov-popis">Zpráva od hráče</p>'
    + '<div class="zpr-kdo">' + (t.znak ? znakSvg(t.znak, 34) : '')
      + '<div><b>' + esc(t.firma) + '</b><i>' + esc(t.nick) + '</i></div></div>'
    + '<p class="zpr-text">' + esc(t.posledni.text) + '</p>'
    + (dalsich > 0 ? '<p class="fine">A ještě ' + dalsich + ' '
        + mn(dalsich, 'další zpráva', 'další zprávy', 'dalších zpráv') + ' od jiných.</p>' : '')
    + '<div class="zpr-tl">'
      + '<button class="btn sec" id="zpr-ne">Teď ne</button>'
      + '<button class="btn" id="zpr-ano">Odpovědět</button>'
    + '</div></div>';
  el.classList.remove('hidden');
  try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) { /* nevadí */ }
  var zavri = function () { el.classList.add('hidden'); el.innerHTML = ''; ZPRAVA_OKNO = null; };
  var ne = $('zpr-ne');
  if (ne) ne.onclick = zavri;
  var ano = $('zpr-ano');
  if (ano) ano.onclick = function () { zavri(); chatSheet(t.id); };
}
// Tečka na záložce svítí, když čeká nabídka nebo nepřečtená zpráva.
var CEKA_NABIDKA = false;
function chatOdznak() {
  var dot = $('burza-dot');
  if (!dot) return;
  var neprectene = CHAT && CHAT.neprectenych > 0;
  dot.classList.toggle('hidden', !(CEKA_NABIDKA || neprectene));
}
function kdyKratce(x) {
  var d = new Date(x), ted = new Date();
  var dnes = d.toDateString() === ted.toDateString();
  try {
    return dnes ? d.toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
  } catch (e) { return ''; }
}
function chatHtml() {
  if (!ME) return '';
  if (!CHAT) return '<div class="card"><h3>Zprávy</h3><p class="fine">Načítám…</p></div>';
  var t = CHAT.threads || [];
  return '<div class="card"><h3>Zprávy'
    + (CHAT.neprectenych ? ' <i class="pocet">' + CHAT.neprectenych + '</i>' : '') + '</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">Napiš komukoli, s kým chceš domluvit obchod.</p>'
    + (t.length ? t.map(function (x) {
        return '<div class="area-item chat-r' + (x.neprectenych ? ' nove' : '') + '" data-chat="' + x.id + '">'
          + '<div><div class="nm">' + (x.znak ? znakSvg(x.znak, 16) + ' ' : '') + esc(x.firma) + '</div>'
          + '<div class="sub">' + (x.posledni.moje ? 'Ty: ' : '') + esc(x.posledni.text) + '</div></div>'
          + '<div class="chat-p"><span class="muted small">' + kdyKratce(x.posledni.kdy) + '</span>'
          + (x.neprectenych ? '<i class="pocet">' + x.neprectenych + '</i>' : '') + '</div></div>';
      }).join('') : '<p class="fine">Zatím sis s nikým nepsal.</p>')
    + '<button class="btn sec" id="chat-novy" style="width:100%;margin-top:10px">Napsat hráči</button>'
    + '</div>';
}
function bindChat(box) {
  [].forEach.call(box.querySelectorAll('[data-chat]'), function (b) {
    b.onclick = function () { chatSheet(Number(b.getAttribute('data-chat'))); };
  });
  var n = $('chat-novy');
  if (n) n.onclick = function () { chatVyberSheet(); };
}
// ─── Výběr hráče ─────────────────────────────────────────────────────────────
// Používá se dvakrát: komu napsat a komu nabídnout obchod. Kdo je zrovna u hry,
// odpoví hned — proto filtr a stav u každého jména. Řazení dělá server podle
// posledního uložení hry, takže nahoře jsou ti nejčerstvější.
var ONLINE_MS = 10 * 60000;       // kdo si uložil hru za posledních deset minut
var DNES_MS = 24 * 3600000;
function hracStav(h) {
  var t = h.naposledy ? new Date(h.naposledy).getTime() : 0;
  if (!t) return { kde: 'nikdy', text: 'ještě nehrál', tr: '' };
  var pred = Date.now() - t;
  if (pred <= ONLINE_MS) return { kde: 'online', text: 'u hry teď', tr: 'ok' };
  if (pred <= DNES_MS) {
    var min = Math.round(pred / 60000);
    return { kde: 'dnes', text: min < 60 ? 'před ' + min + ' min' : 'před ' + Math.round(min / 60) + ' h', tr: 'warn' };
  }
  var dnu = Math.round(pred / 86400000);
  return { kde: 'dav', text: 'před ' + dnu + ' ' + mn(dnu, 'dnem', 'dny', 'dny'), tr: '' };
}
function hraciVyberSheet(nadpis, popisTlacitka, pak) {
  sheet('<h3>' + esc(nadpis) + '</h3><p class="muted small">Načítám hráče…</p>');
  api('/trade/players').then(function (r) {
    if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
    var hraci = r.j.players || [];
    if (!hraci.length) {
      return sheet('<h3>Zatím není komu</h3><p class="muted small">Až přibude další hráč, objeví se tady.</p>');
    }
    var online = hraci.filter(function (h) { return hracStav(h).kde === 'online'; }).length;
    var dnes = hraci.filter(function (h) { return hracStav(h).kde !== 'nikdy' && hracStav(h).kde !== 'dav'; }).length;
    // Když je někdo u hry, začínáme u něj — obchod se domluví nejrychleji s tím,
    // kdo je zrovna online.
    var filtr = online ? 'online' : 'vse', hledam = '';
    var vykresli = function () {
      var k = hraci.filter(function (h) {
        var st = hracStav(h);
        if (filtr === 'online' && st.kde !== 'online') return false;
        if (filtr === 'dnes' && (st.kde === 'dav' || st.kde === 'nikdy')) return false;
        if (hledam) {
          var t = (h.firma + ' ' + h.nick).toLowerCase();
          if (t.indexOf(hledam.toLowerCase()) < 0) return false;
        }
        return true;
      });
      sheet('<h3>' + esc(nadpis) + '</h3>'
        + '<div class="seg sub najem-seg" style="margin-top:4px">'
          + '<button class="' + (filtr === 'online' ? 'on' : '') + '" data-f="online">U hry teď'
            + (online ? ' (' + online + ')' : '') + '</button>'
          + '<button class="' + (filtr === 'dnes' ? 'on' : '') + '" data-f="dnes">Dnes'
            + (dnes ? ' (' + dnes + ')' : '') + '</button>'
          + '<button class="' + (filtr === 'vse' ? 'on' : '') + '" data-f="vse">Všichni ('
            + hraci.length + ')</button>'
        + '</div>'
        + '<input id="hr-hledat" class="inp" type="text" placeholder="Hledat firmu nebo nick…" '
          + 'style="width:100%;margin:10px 0 4px" value="' + esc(hledam) + '">'
        + (k.length ? k.map(function (h) {
            var st = hracStav(h);
            return '<div class="area-item"><div><div class="nm">' + esc(h.firma) + '</div>'
              + '<div class="sub">' + esc(h.nick) + ' · <i class="' + st.tr + '">'
              + (st.kde === 'online' ? '● ' : '') + esc(st.text) + '</i></div></div>'
              + '<button class="btn sec sm" data-h="' + h.id + '">' + esc(popisTlacitka) + '</button></div>';
          }).join('')
          : '<p class="muted small" style="margin-top:14px">'
            + (filtr === 'online' ? 'Zrovna nikdo u hry není. Zkus Dnes nebo Všichni — zprávu si přečte, až se vrátí.'
               : 'Nikdo takový tu není.') + '</p>'));
      [].forEach.call($('sheet-body').querySelectorAll('[data-f]'), function (b) {
        b.onclick = function () { filtr = b.getAttribute('data-f'); vykresli(); };
      });
      var inp = $('hr-hledat');
      if (inp) {
        inp.oninput = function () {
          hledam = inp.value;
          var kurzor = inp.selectionStart;
          vykresli();
          var novy = $('hr-hledat');
          if (novy) { novy.focus(); try { novy.setSelectionRange(kurzor, kurzor); } catch (e) { /* nevadí */ } }
        };
      }
      [].forEach.call($('sheet-body').querySelectorAll('[data-h]'), function (b) {
        b.onclick = function () { pak(Number(b.getAttribute('data-h'))); };
      });
    };
    vykresli();
  }).catch(function () { toast('Server neodpovídá.', 'err'); });
}
// Komu napsat — seznam všech hráčů, stejný jako u nabídky.
function chatVyberSheet() {
  hraciVyberSheet('Komu napsat', 'Napsat', function (id) { chatSheet(id); });
}
// Jedna konverzace. Po otevření se všechno příchozí označí za přečtené.
function chatSheet(id) {
  sheet('<h3>Zprávy</h3><p class="muted small">Načítám…</p>');
  api('/chat/with/' + id).then(function (r) {
    if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
    var h = r.j.hrac;
    var blokuju = !!r.j.blokuju, blokujeMe = !!r.j.blokuje_me;
    sheet('<h3>' + (h.znak ? znakSvg(h.znak, 20) + ' ' : '') + esc(h.firma) + '</h3>'
      + '<p class="muted small">' + esc(h.nick) + '</p>'
      + (blokuju ? '<p class="fine err">Tohohle hráče máš zablokovaného — nic ti od něj nepřijde a ani mu nenapíšeš.</p>' : '')
      + (blokujeMe && !blokuju ? '<p class="fine err">Tenhle hráč si psát nepřeje.</p>' : '')
      + '<div class="chat-okno" id="chat-okno">' + chatZpravyHtml(r.j.zpravy) + '</div>'
      + (blokuju || blokujeMe ? ''
          : '<label class="fld"><span>Napsat</span>'
            + '<input id="chat-text" class="inp" type="text" maxlength="800" placeholder="Napiš zprávu…"></label>'
            + '<button class="btn big" id="chat-send">Odeslat</button>')
      + '<button class="btn ghost" id="chat-nabidka" style="width:100%;margin-top:8px">Nabídnout mu obchod</button>'
      + '<button class="btn ghost" id="chat-blok" style="width:100%;margin-top:8px">'
      + (blokuju ? 'Odblokovat' : 'Zablokovat hráče') + '</button>'
      + (blokuju ? '' : '<p class="fine">Zablokovaný hráč ti už nenapíše. Nevhodnou zprávu nahlásíš praporkem u ní.</p>'));
    var okno = $('chat-okno');
    if (okno) { okno.scrollTop = okno.scrollHeight; bindNahlas(okno); }
    var bl = $('chat-blok');
    if (bl) bl.onclick = function () {
      if (!blokuju && bl.getAttribute('data-jist') !== '1') {
        bl.setAttribute('data-jist', '1');
        bl.textContent = 'Opravdu zablokovat? Klepni znovu';
        return;
      }
      bl.disabled = true;
      apiJson('/chat/block', { id: id, zrusit: blokuju }).then(function (rr) {
        if (!rr.ok) { bl.disabled = false; return toast(rr.j.error || 'Nepovedlo se.', 'err'); }
        toast(blokuju ? 'Odblokováno.' : 'Zablokováno. Už ti nenapíše.', 'ok');
        loadChat(function () { if (!$('v-burza').classList.contains('hidden')) paintBurza(); });
        chatSheet(id);
      }).catch(function () { bl.disabled = false; toast('Server neodpovídá.', 'err'); });
    };
    var inp = $('chat-text'), b = $('chat-send');
    if (!inp || !b) { var nb0 = $('chat-nabidka'); if (nb0) nb0.onclick = function () { majetekSheet(id); }; return; }
    var odesli = function () {
      var t = (inp.value || '').trim();
      if (!t) return;
      b.disabled = true;
      apiJson('/chat/send', { to_id: id, text: t }).then(function (rr) {
        b.disabled = false;
        if (!rr.ok) return toast(rr.j.error || 'Nepovedlo se odeslat.', 'err');
        inp.value = '';
        // Z prázdného okna nejdřív zmizí hláška, že si ještě nic nenapsali.
        var pr = okno.querySelector('p.fine');
        if (pr) okno.innerHTML = '';
        okno.insertAdjacentHTML('beforeend', chatZpravyHtml([rr.j.zprava]));
        bindNahlas(okno);
        okno.scrollTop = okno.scrollHeight;
        loadChat(function () { if (!$('v-burza').classList.contains('hidden')) paintBurza(); });
      }).catch(function () { b.disabled = false; toast('Server neodpovídá.', 'err'); });
    };
    b.onclick = odesli;
    inp.onkeydown = function (e) { if (e.key === 'Enter') odesli(); };
    var nb = $('chat-nabidka');
    if (nb) nb.onclick = function () { majetekSheet(id); };
    setTimeout(function () { inp.focus(); }, 60);
    loadChat(function () { if (!$('v-burza').classList.contains('hidden')) paintBurza(); });
  }).catch(function () { toast('Server neodpovídá.', 'err'); });
}
function chatZpravyHtml(zpravy) {
  if (!zpravy.length) return '<p class="fine" style="margin:0">Ještě jste si nic nenapsali. Začni.</p>';
  return zpravy.map(function (m) {
    // Nahlásit jde jen to, co přišlo mně — u svojí zprávy praporek není.
    var vlajka = m.moje ? ''
      : (m.nahlasena
          ? '<b class="chat-nahl" title="Už nahlášeno">\u2691 nahlášeno</b>'
          : '<button class="chat-vlajka" data-nahlas="' + m.id + '" title="Nahlásit zprávu">\u2691</button>');
    return '<div class="chat-b' + (m.moje ? ' ja' : '') + '">' + esc(m.text)
      + '<i>' + kdyKratce(m.kdy) + vlajka + '</i></div>';
  }).join('');
}
// Praporky se naviazují po každém překreslení okna.
function bindNahlas(okno) {
  [].forEach.call(okno.querySelectorAll('[data-nahlas]'), function (b) {
    b.onclick = function () {
      if (b.getAttribute('data-jist') !== '1') {
        b.setAttribute('data-jist', '1');
        b.textContent = 'opravdu?';
        b.classList.add('ptam');
        return;
      }
      b.disabled = true;
      apiJson('/chat/report', { id: Number(b.getAttribute('data-nahlas')) }).then(function (r) {
        if (!r.ok) return toast(r.j.error || 'Nepovedlo se.', 'err');
        b.outerHTML = '<b class="chat-nahl">\u2691 nahlášeno</b>';
        toast('Zpráva nahlášená. Podíváme se na to.', 'ok');
      }).catch(function () { b.disabled = false; toast('Server neodpovídá.', 'err'); });
    };
  });
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
// ─── Tržiště ─────────────────────────────────────────────────────────────────
// Hotová provozovna na prodej: stroj, nájemní smlouva, přípojky i rozvržení
// plochy v jednom. Kupující má všechno hned — neplatí dva herní měsíce čekání
// na výrobu ani hledání místa. Zaplatí za to vyšší cenu, kterou si řekne
// prodávající; dokud se neprodá, prádlomat dál vydělává prodávajícímu.
var TRH = null;
var TRH_MESICE = [1, 3, 6, 12];
var TRH_SPOLUUCAST = 0.2;    // banka na hotovou provozovnu dá nejvýš 80 % ceny
function loadTrh(then) {
  api('/trade/trh').then(function (r) {
    TRH = (r.ok && r.j.trh) || [];
    if (then) then();
  }).catch(function () { TRH = TRH || []; if (then) then(); });
}
function trhMoje(spotId) {
  return (TRH || []).filter(function (n) { return n.moje && n.spot_id === spotId; })[0] || null;
}
// Cena, kterou hra napoví: co do místa šlo plus roční zisk. Prodávající si ji
// může přepsat, tohle je jen rozumný začátek.
function trhNavrhCeny(u) {
  var invest = (u.eco && u.eco.invest) || 0;
  var rocne = Math.max(0, Math.round((u.eco && u.eco.profit) || 0) * 12);
  return Math.max(1000, Math.round((invest + rocne) / 1000) * 1000);
}
// Co z toho místa vyždímeš TY. Návštěvnost se počítá z tvojí pověsti a karet,
// takže stejné místo nemusí u kupujícího vydělávat tolik co u prodávajícího.
// Banka i návratnost se řídí tímhle číslem, ne cizím slibem.
function trhZiskUMe(n) {
  var sp = { id: n.spot_id, name: n.name, kind: n.kind || 'unknown',
    score: n.score != null ? n.score : 60, lat: n.lat, lon: n.lon };
  var eco = economics(sp, n.model || 'mini');
  eco.rent = n.rent || eco.rent;
  eco.cost = eco.energy + eco.servis + eco.rent;
  eco.profit = eco.revenue - eco.cost;
  return eco;
}
// Prádlomat, který někdo nabízí na tržišti. Na mapě je zlatý, s cenovkou —
// ať je na první pohled poznat, že se dá koupit hned i s místem.
function trhIcon(n) {
  var im = MODEL_IMG[n.model] || MODEL_IMG.flex;
  return L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22],
    html: '<div class="pin unit trh" data-trh="' + esc(n.spot_id) + '">'
      + '<img src="' + esc(im.src) + '" alt="">'
      + '<i class="pin-trh">\u20AC</i>'
      + '<i class="pin-tag">' + esc(kcFull(n.cena)) + '</i></div>' });
}
// Co je na tržišti, podle místa — mapa si tím vybírá špendlík.
function trhPodleMist() {
  var m = {};
  (TRH || []).forEach(function (n) { if (!n.moje && n.spot_id) m[n.spot_id] = n; });
  return m;
}
function paintTrhBadge() {
  var el = $('map-trh');
  if (!el) return;
  var kolik = (TRH || []).filter(function (n) { return !n.moje; }).length;
  // Odznak svítí pořád — i prázdné tržiště musí jít otevřít, jinak by hráč
  // neměl kudy vystavit vlastní prádlomat.
  el.classList.remove('hidden');
  el.classList.toggle('prazdne', !kolik);
  el.innerHTML = '<i>\uD83E\uDD1D</i><b>' + (kolik || 'Tržiště') + '</b>';
  el.title = kolik
    ? 'Tržiště — ' + kolik + ' ' + mn(kolik, 'hotová provozovna', 'hotové provozovny', 'hotových provozoven') + ' na prodej'
    : 'Tržiště — zrovna nikdo nic nenabízí';
  el.onclick = trhSeznamSheet;
}
// Celé tržiště v panelu — otevře se z mapy, ať se nemusí chodit na Burzu.
// Jedna položka = jedna hotová provozovna: fotka stroje, cena a co vydělá.
// Vlastní nabídky jsou dole zvlášť, ať je hráč vidí a může je stáhnout.
// „za 144 h" nikdo nečte. Delší lhůty říkáme ve dnech.
function trhKonci(ms) {
  ms = Math.max(0, ms);
  if (ms >= 48 * 3600e3) {
    var d = Math.round(ms / 86400e3);
    return 'za ' + d + ' ' + mn(d, 'den', 'dny', 'dní');
  }
  return etaText(ms);
}
function trhPolozka(n, moje) {
  var m = MODELS[n.model] || { name: n.model };
  var im = MODEL_IMG[n.model] || MODEL_IMG.flex;
  var konci = trhKonci(new Date(n.konci).getTime() - Date.now());
  return '<div class="trh-p">'
    + '<img class="trh-foto" src="' + esc(im.src) + '" alt="' + esc(m.name) + '">'
    + '<div class="trh-txt">'
      + '<div class="trh-hl"><b>' + esc(n.name || 'Místo') + '</b>'
      + '<b class="' + (moje ? 'warn' : 'ok') + '">' + kcFull(n.cena) + '</b></div>'
      + '<i>' + esc(m.name) + (moje ? '' : ' · ' + esc(n.firma || n.nick)) + '</i>'
      + '<i>' + (moje ? 'vydělává ti ' + kcFull(n.zisk)
                      : 'u tebe ' + kcFull(Math.round(trhZiskUMe(n).profit)))
      + ' / měsíc · končí ' + konci + '</i>'
      + '<button class="btn ' + (moje ? 'sec ' : '') + 'sm" style="width:100%;margin-top:7px" '
      + (moje ? 'data-trh-stop="' + n.id + '">Stáhnout z nabídky' : 'data-trh-n="' + n.id + '">Prohlédnout a koupit')
      + '</button>'
    + '</div></div>';
}
function trhSeznamSheet() {
  var vse = TRH || [];
  var cizi = vse.filter(function (n) { return !n.moje; });
  var moje = vse.filter(function (n) { return n.moje; });
  sheet('<h3>Tržiště</h3>'
    + '<p class="muted small">Hotové provozovny: stroj, nájemní smlouva, přípojky i rozvržení plochy. '
    + 'Vydělává hned — nečekáš na výrobu ani nehledáš místo. Banka to financuje jako obchodní '
    + 'příležitost, ale chce spoluúčast ' + Math.round(TRH_SPOLUUCAST * 100) + ' %.</p>'
    + (cizi.length
        ? '<div class="trh-seznam">' + cizi.map(function (n) { return trhPolozka(n, false); }).join('') + '</div>'
        : '<p class="muted small" style="margin-top:12px">Zrovna tu nikdo nic nenabízí.</p>')
    + (moje.length
        ? '<h3 style="margin:18px 0 6px">Tvoje nabídky</h3>'
          + '<p class="muted small" style="margin:0 0 8px">Dokud se neprodají, vydělávají dál tobě.</p>'
          + '<div class="trh-seznam">' + moje.map(function (n) { return trhPolozka(n, true); }).join('') + '</div>'
        : '')
    + ((S.units || []).length
        ? '<button class="btn" id="trh-nabidnout-2" style="width:100%;margin-top:14px">'
          + (moje.length ? 'Nabídnout další prádlomat' : 'Nabídnout vlastní prádlomat') + '</button>'
        : ''));
  [].forEach.call($('sheet-body').querySelectorAll('[data-trh-n]'), function (b) {
    b.onclick = function () {
      var n = (TRH || []).filter(function (x) { return String(x.id) === b.getAttribute('data-trh-n'); })[0];
      if (n) trhKoupitSheet(n);
    };
  });
  [].forEach.call($('sheet-body').querySelectorAll('[data-trh-stop]'), function (b) {
    b.onclick = function () {
      b.disabled = true; b.textContent = 'Stahuju…';
      apiJson('/trade/trh/' + b.getAttribute('data-trh-stop') + '/stahnout', {}).then(function (r) {
        if (!r.ok) { b.disabled = false; b.textContent = 'Stáhnout z nabídky';
          return toast((r.j && r.j.error) || 'Nepovedlo se.', 'err'); }
        toast('Nabídka stažena.', 'ok');
        loadTrh(function () { drawMap(); trhSeznamSheet(); });
      }).catch(function () { b.disabled = false; b.textContent = 'Stáhnout z nabídky';
        toast('Server neodpovídá.', 'err'); });
    };
  });
  var nb = $('trh-nabidnout-2');
  if (nb) nb.onclick = trhVyberSheet;
}

// Výběr, který prádlomat chci vystavit — ať se to nemusí hledat po mapě.
function trhVyberSheet() {
  var u = (S.units || []).slice();
  if (!u.length) return toast('Nemáš co nabídnout — zatím nic nestojí.', 'err');
  sheet('<h3>Který prádlomat nabídnout</h3>'
    + '<p class="muted small">Prodáváš celou provozovnu: stroj, nájemní smlouvu, přípojky i rozvržení '
    + 'plochy. Dokud se neprodá, vydělává dál tobě.</p>'
    + '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">'
    + u.map(function (x) {
        var n = trhMoje(x.spotId);
        return '<button class="btn sec" style="width:100%;text-align:left" data-trh-u="' + esc(x.spotId) + '">'
          + '<b>' + esc(x.name) + '</b> · ' + esc((MODELS[x.eco.model] || {}).name || '')
          + ' · ' + kcFull(x.eco.profit) + ' / měsíc'
          + (n ? '<br><i class="muted small">už visí na tržišti za ' + kcFull(n.cena) + '</i>' : '')
          + '</button>';
      }).join('')
    + '</div>');
  [].forEach.call($('sheet-body').querySelectorAll('[data-trh-u]'), function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-trh-u');
      var x = (S.units || []).filter(function (y) { return y.spotId === id; })[0];
      if (x) trhProdejSheet(x);
    };
  });
}
// Co banka na hotovou provozovnu půjčí. Na rozdíl od stavby na zelené louce
// tu je vidět, co místo vydělává — půjčuje se tedy proti jeho zisku, ale vždy
// jen do 80 % ceny. Zbytek je spoluúčast kupujícího.
function trhFinance(n, chci) {
  var minVlastni = Math.ceil(n.cena * TRH_SPOLUUCAST);
  var zisk = Math.round(trhZiskUMe(n).profit);
  var f = canFinance(n.cena, chci == null ? minVlastni : Math.max(minVlastni, chci),
    stropPodleZisku(Math.max(0, zisk), n.cena));
  f.minVlastni = minVlastni;
  if (f.own < minVlastni - 0.5) {
    f.ok = false;
    f.duvod = 'Banka chce spoluúčast aspoň ' + kcFull(minVlastni) + ' (' + Math.round(TRH_SPOLUUCAST * 100)
      + ' %) a tolik hotovosti nemáš.';
  }
  return f;
}
function trhKoupitSheet(n) {
  var m = MODELS[n.model] || { name: n.model };
  var f = trhFinance(n, null);
  var muj = Math.round(trhZiskUMe(n).profit);
  var navratnost = muj > 0 ? (n.cena / (muj * 12)) : null;
  sheet('<h3>' + esc(n.name || 'Místo') + '</h3>'
    + '<p class="muted small">' + esc(m.name) + ' · ' + esc(n.firma || n.nick)
    + ' · nabídka končí ' + etaText(new Date(n.konci).getTime() - Date.now()) + '</p>'
    + '<div class="card" style="margin-top:12px">'
      + '<div class="kv"><span>Cena</span><b>' + kcFull(n.cena) + '</b></div>'
      + '<div class="kv"><span>U tebe vydělá</span><b class="' + (muj > 0 ? 'ok' : 'err') + '">'
        + kcFull(muj) + ' / měsíc</b></div>'
      + '<div class="kv"><span>U prodávajícího vydělává</span><b>' + kcFull(n.zisk) + ' / měsíc</b></div>'
      + '<div class="kv"><span>Z toho nájem</span><b>' + kcFull(n.rent) + ' / měsíc</b></div>'
      + (navratnost ? '<div class="kv"><span>Návratnost</span><b>'
          + (Math.round(navratnost * 10) / 10).toString().replace('.', ',') + ' roku</b></div>' : '')
      + (Math.abs(muj - n.zisk) > Math.max(500, n.zisk * 0.08)
          ? '<p class="fine warn">Čísla se liší, protože návštěvnost roste s pověstí a kartami majitele. '
            + 'Počítej s tím svým.</p>' : '')
      + '<p class="fine">Dostaneš stroj, nájemní smlouvu, přípojky i rozvržení plochy. '
      + 'Vydělává od první minuty — na nic se nečeká.</p>'
    + '</div>'
    + '<div class="card">'
      + '<div class="kv"><span>Zaplatíš ze svého</span><b>' + kcFull(f.own) + '</b></div>'
      + '<div class="kv"><span>Doplatí banka</span><b class="' + (f.need ? 'warn' : '') + '">'
        + kcFull(f.need) + '</b></div>'
      + (f.need ? '<div class="kv"><span>Splátka</span><b>'
          + kcFull(anuita(f.need, Math.max(0.02, rateOf() + prirazkaZa(f.need)), UVER_MESICU))
          + ' / měsíc</b></div>' : '')
      + '<p class="fine">Banka tohle bere jako obchodní příležitost — půjčí proti tomu, co místo '
      + 'vydělá, ale chce spoluúčast ' + Math.round(TRH_SPOLUUCAST * 100) + ' %, tedy aspoň '
      + kcFull(f.minVlastni) + '.</p>'
    + '</div>'
    + (f.ok
        ? '<button class="btn big" id="trh-go" style="width:100%">Koupit za ' + kcFull(n.cena) + '</button>'
        : '<p class="fine err">' + esc(f.duvod || 'Na tohle banka nepůjčí.') + '</p>'));
  var g = $('trh-go');
  if (g) g.onclick = function () {
    g.disabled = true; g.textContent = 'Kupuju…';
    apiJson('/trade/trh/' + n.id + '/koupit', {}).then(function (r) {
      if (!r.ok) {
        g.disabled = false; g.textContent = 'Koupit za ' + kcFull(n.cena);
        return toast((r.j && r.j.error) || 'Nepovedlo se.', 'err');
      }
      // Celou cenu strhne doručenka ze serveru. Z našeho tu přibude jen to, co
      // na nákup půjčila banka — jinak by hráč platil i tu část, kterou nedal.
      var f2 = trhFinance(n, null);
      if (f2.need > 0) {
        S.bank -= f2.need;
        pricistDluh(f2.need, prirazkaZa(f2.need), { druh: 'misto', spotId: n.spot_id,
          popis: 'Prádlomat z tržiště — ' + (n.name || '') });
        S.cash += f2.need;
        zapis('uver', 'Úvěr na prádlomat z tržiště — ' + (n.name || ''), f2.need);
      }
      save();
      closeSheet();
      toast('Koupeno. ' + (n.name || 'Prádlomat') + ' je tvůj a hned vydělává.', 'ok');
      loadTrh(function () { vyzvedniNasledky(function () { loadClaims(); paintBurza(); }); });
    }).catch(function () {
      g.disabled = false; g.textContent = 'Koupit za ' + kcFull(n.cena);
      toast('Server neodpovídá.', 'err');
    });
  };
}
// Rozvaha jednoho místa: co do něj šlo, co z něj zatím přiteklo a kde je
// hranice, pod kterou se prodej nevyplatí. Provozní čísla jsou odhad z doby
// provozu — hra si pro každý stroj zvlášť účetnictví nevede, ale měsíční
// čísla a doba běhu jsou přesné, takže je to blízko.
function rozvahaMista(u) {
  var eco = u.eco || {};
  var mesicu = Math.max(0, (Date.now() - (u.builtAt || Date.now())) / MONTH_MS);
  var zak = zakladniSpotId(u.spotId);
  var poz = pozemky().filter(function (z) { return z.spotId === zak; })[0] || null;
  var stroj = Math.round(eco.machine || 0);
  var pripojky = Math.round(eco.conn || eco.install || 0);
  var obhlidka = S.revealed && S.revealed[zak] ? REVEAL_COST : 0;
  var pozemek = poz ? Math.round((poz.cena || 0) + (poz.priprava || 0)) : 0;
  var vlozeno = stroj + pripojky + obhlidka + pozemek;
  // Kolik stroj za tu dobu opravdu šlapal — porouchaný nevydělával.
  var chod = spolehlivost(u);
  var obrat = Math.round((eco.revenue || 0) * mesicu * chod);
  var najem = Math.round((eco.rent || 0) * mesicu);
  var energie = Math.round((eco.energy || 0) * mesicu * chod);
  var servis = Math.round((eco.servis || 0) * mesicu);
  var vydelal = obrat - najem - energie - servis;
  var uvery = (S.loans || []).filter(function (l) { return l.spotId === u.spotId; });
  var dluh = Math.round(uvery.reduce(function (a, l) { return a + l.zbyva; }, 0));
  return { mesicu: mesicu, vlozeno: vlozeno, stroj: stroj, pripojky: pripojky, obhlidka: obhlidka,
    pozemek: pozemek, obrat: obrat, najem: najem, energie: energie, servis: servis,
    vydelal: vydelal, dluh: dluh, vady: u.vady || 0,
    // Pod tuhle cenu se prodej nevyplatí: zbytek vložených peněz, co se ještě
    // nevrátil provozem. Co je nad ní, je čistý výdělek z celého místa.
    nula: Math.max(0, vlozeno - vydelal) };
}
// Doba provozu po česku: do roku v měsících, dál v letech. Desetinné číslo
// má vždycky „roku" (1,2 roku), celé se skloňuje normálně.
function dobaProvozu(mesicu) {
  if (mesicu < 12) {
    var m = Math.max(1, Math.round(mesicu));
    return m + ' ' + mn(m, 'herní měsíc', 'herní měsíce', 'herních měsíců');
  }
  var roky = mesicu / 12;
  var cele = Math.round(roky);
  if (Math.abs(roky - cele) < 0.05) return cele + ' ' + mn(cele, 'rok', 'roky', 'let');
  return cisloM(Math.round(roky * 10) / 10) + ' roku';
}
function rozvahaHtml(r) {
  return '<div class="card">'
    + '<div class="row"><h3>Co tě to stálo</h3><b>' + kcFull(r.vlozeno) + '</b></div>'
    + '<div class="kv"><span>Stroj</span><b>' + kcFull(r.stroj) + '</b></div>'
    + '<div class="kv"><span>Přípojky a instalace</span><b>' + kcFull(r.pripojky) + '</b></div>'
    + (r.obhlidka ? '<div class="kv"><span>Obhlídka místa</span><b>' + kcFull(r.obhlidka) + '</b></div>' : '')
    + (r.pozemek ? '<div class="kv"><span>Pozemek a příprava plochy</span><b>' + kcFull(r.pozemek) + '</b></div>' : '')
    + '</div>'
    + '<div class="card">'
    + '<div class="row"><h3>Co to zatím vydělalo</h3><b class="' + (r.vydelal >= 0 ? 'ok' : 'err') + '">'
      + kcFull(r.vydelal) + '</b></div>'
    + '<p class="muted small" style="margin:2px 0 8px">Za ' + dobaProvozu(r.mesicu) + ' provozu'
      + (r.vady ? ' · ' + r.vady + ' ' + mn(r.vady, 'porucha', 'poruchy', 'poruch') : '') + '</p>'
    + '<div class="kv"><span>Obrat</span><b>' + kcFull(r.obrat) + '</b></div>'
    + '<div class="kv"><span>− Nájem</span><b class="warn">' + kcFull(r.najem) + '</b></div>'
    + '<div class="kv"><span>− Energie</span><b class="warn">' + kcFull(r.energie) + '</b></div>'
    + '<div class="kv"><span>− Servis a úklid</span><b class="warn">' + kcFull(r.servis) + '</b></div>'
    + '<p class="fine">Odhad z měsíčních čísel a doby provozu — hra každému stroji zvlášť pokladnu nevede. '
    + 'Doba, kdy stál porouchaný, je už odečtená.</p>'
    + '</div>'
    + '<div class="card">'
    + '<div class="row"><h3>Kde je nula</h3><b class="' + (r.nula > 0 ? 'warn' : 'ok') + '">'
      + (r.nula > 0 ? kcFull(r.nula) : 'už je zaplacený') + '</b></div>'
    + '<p class="muted small" style="margin:2px 0 0">'
    + (r.nula > 0
        ? 'Tolik z vložených peněz se ti provozem ještě nevrátilo. Prodej dráž a jsi v plusu, '
          + 'prodej levněji a tohle místo tě celkem stálo víc, než dalo.'
        : 'Provoz už vložené peníze vrátil celé. Cokoli utržíš, je čistý zisk z téhle provozovny.')
    + '</p>'
    + (r.dluh ? '<div class="kv" style="margin-top:8px"><span>Zbývá splatit úvěr na místě</span>'
        + '<b class="err">' + kcFull(r.dluh) + '</b></div>'
        + '<p class="fine">Úvěr prodejem nezmizí — zůstává tobě. Počítej s ním v ceně.</p>' : '')
    + '</div>';
}

// Nabídnutí vlastního prádlomatu na tržiště.
function trhProdejSheet(u) {
  var bezi = trhMoje(u.spotId);
  if (bezi) {
    sheet('<h3>Na tržišti</h3>'
      + '<p class="muted small">' + esc(u.name) + ' nabízíš za <b>' + kcFull(bezi.cena) + '</b>. '
      + 'Nabídka končí ' + etaText(new Date(bezi.konci).getTime() - Date.now()) + '. '
      + 'Do té doby prádlomat normálně vydělává tobě.</p>'
      + '<button class="btn sec" id="trh-stop" style="width:100%;margin-top:12px">Stáhnout z nabídky</button>');
    var st = $('trh-stop');
    if (st) st.onclick = function () {
      st.disabled = true;
      apiJson('/trade/trh/' + bezi.id + '/stahnout', {}).then(function (r) {
        if (!r.ok) { st.disabled = false; return toast((r.j && r.j.error) || 'Nepovedlo se.', 'err'); }
        loadTrh(function () { closeSheet(); unitSheet(u); });
        toast('Nabídka stažena.', 'ok');
      }).catch(function () { st.disabled = false; toast('Server neodpovídá.', 'err'); });
    };
    return;
  }
  if (S.trhVolba == null) S.trhVolba = { mesicu: 3 };
  var cena = trhNavrhCeny(u);
  var r = rozvahaMista(u);
  var vykresli = function () {
    sheet('<h3>Nabídnout na tržišti</h3>'
      + '<p class="muted small">' + esc(u.name) + ' — prodáváš celou provozovnu: stroj, nájemní smlouvu, '
      + 'přípojky i rozvržení plochy. Dokud se neprodá, vydělává dál tobě.</p>'
      + rozvahaHtml(r)
      + '<div class="card">'
        + '<div class="kv"><span>Vydělá měsíčně</span><b class="ok">' + kcFull(u.eco.profit) + '</b></div>'
        + '<div class="kv"><span>Za rok</span><b class="ok">' + kcFull(Math.round(u.eco.profit * 12)) + '</b></div>'
        + (splatkyMista(u.spotId) ? '<div class="kv"><span>Splátky na místě</span><b class="warn">'
            + kcFull(splatkyMista(u.spotId)) + ' / měsíc</b></div>' : '')
      + '</div>'
      + '<p class="muted small" style="margin:12px 0 4px"><b>Za kolik</b></p>'
      + '<div style="display:flex;gap:8px;align-items:center">'
        + '<input class="inp" id="trh-cena" type="number" inputmode="numeric" min="1000" step="10000" value="' + cena + '">'
        + '<span class="muted small">L$</span></div>'
      + '<p class="fine">Napovídáme ' + kcFull(trhNavrhCeny(u)) + ' — co jsi do místa dal plus roční zisk. '
      + 'Cena je na tobě; kupující vidí, co místo vydělává.'
      + (r.nula > 0 ? ' Pod ' + kcFull(r.nula) + ' bys prodělal.' : ' Cokoli utržíš, je čistý zisk.') + '</p>'
      + '<p class="muted small" style="margin:12px 0 4px"><b>Jak dlouho má nabídka viset</b></p>'
      + '<div class="seg sub najem-seg">' + TRH_MESICE.map(function (mm) {
          return '<button class="' + (mm === S.trhVolba.mesicu ? 'on' : '') + '" data-trh-m="' + mm + '">'
            + mm + ' měs.</button>';
        }).join('') + '</div>'
      + '<p class="fine">' + S.trhVolba.mesicu + ' herních měsíců = '
      + Math.round(S.trhVolba.mesicu * 12) + ' skutečných hodin. Po uplynutí nabídka zmizí, '
      + 'prádlomat zůstává tvůj.</p>'
      + '<button class="btn big" id="trh-dat" style="width:100%;margin-top:12px">Vystavit na tržišti</button>'
      + '<p class="fine">Jakmile někdo koupí, peníze máš hned a místo i stroj přejdou na něj. '
      + 'Úvěr, který na místě visí, zůstává tobě — splácíš ho dál.</p>');
    [].forEach.call($('sheet-body').querySelectorAll('[data-trh-m]'), function (x) {
      x.onclick = function () {
        S.trhVolba.mesicu = Number(x.getAttribute('data-trh-m'));
        cena = Math.max(1000, Math.round(Number(($('trh-cena') || {}).value) || cena));
        save(); vykresli();
      };
    });
    var d = $('trh-dat');
    if (d) d.onclick = function () {
      var c = Math.round(Number($('trh-cena').value) || 0);
      if (!(c >= 1000)) return toast('Cena musí být aspoň 1 000 L$.', 'err');
      d.disabled = true; d.textContent = 'Vystavuju…';
      apiJson('/trade/trh', { spot_id: u.spotId, cena: c, mesicu: S.trhVolba.mesicu,
        zisk: Math.round(u.eco.profit), obrat: Math.round(u.eco.revenue),
        investice: Math.round((u.eco && u.eco.invest) || 0),
        kind: u.kind, score: u.score, plan: planMista(zakladniSpotId(u.spotId)) || null
      }).then(function (r) {
        if (!r.ok) {
          d.disabled = false; d.textContent = 'Vystavit na tržišti';
          return toast((r.j && r.j.error) || 'Nepovedlo se.', 'err');
        }
        loadTrh(function () { closeSheet(); paint(); });
        toast('Vystaveno na tržišti za ' + kcFull(c) + '.', 'ok');
      }).catch(function () {
        d.disabled = false; d.textContent = 'Vystavit na tržišti';
        toast('Server neodpovídá.', 'err');
      });
    };
  };
  vykresli();
}

function paintBurza() {
  var box = $('burza-body');
  if (!TRADES) { box.innerHTML = '<p class="muted small">Načítám…</p>'; return loadTrades(paintBurza); }
  var ceka = TRADES.filter(function (t) { return t.stav === 'ceka'; });
  var hotove = TRADES.filter(function (t) { return t.stav !== 'ceka'; }).slice(0, 20);
  var naMe = ceka.filter(function (t) { return t.na_tahu; });
  var odeslane = ceka.filter(function (t) { return !t.na_tahu; });

  if (AUKCE == null) loadAukce(paintBurza);

  if (CHAT == null) loadChat(paintBurza);

  box.innerHTML = chatHtml()
    + aukceHtml()
    + sekce('Čeká na tvoji odpověď', naMe, 'Nikdo ti teď nic nenabízí.')
    + sekce('Čekáš na odpověď', odeslane, 'Nemáš rozjednanou žádnou nabídku.')
    + (hotove.length ? sekce('Uzavřené', hotove, '') : '');
  bindChat(box);
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
// ─── Co se na burze za co platí ──────────────────────────────────
// Bez orientační ceny střílí hráč naslepo a nabídka je lotérie. Počítá se
// z toho, co věc vydělává: čtyřnásobek ročního zisku je cena, při které se
// kupujícímu vrátí za čtyři roky. Shora i zdola ji drží to, co stavba stála.
var CENA_NASOBEK = 4;
function cenaPradlomatu(zisk, invest) {
  var podleZisku = Math.max(0, Math.round((zisk || 0) * 12 * CENA_NASOBEK));
  if (!(invest > 0)) return podleZisku;
  return Math.max(Math.round(invest * 0.5), Math.min(Math.round(invest * 1.2), podleZisku));
}
// Orientační cena čehokoli, co jde na burze nabídnout. Null = trh to nemá podé čeho ocenit.
function cenaPredmetu(x) {
  if (x.predmet === 'pradlomat') return cenaPradlomatu(x.zisk, x.invest);
  if (x.predmet === 'stroj') return Math.round(machinePrice(MODELS[x.model] || MODELS.mini) * 0.85);
  if (x.predmet === 'pobocka') return Math.round(POBOCKA_CENA * 0.8);
  return null;
}
function rokyNavratnosti(cena, zisk) {
  if (!(zisk > 0) || !(cena > 0)) return null;
  return cena / (zisk * 12);
}

function novaNabidkaSheet() {
  hraciVyberSheet('Komu chceš nabídnout', 'Vybrat', function (id) { majetekSheet(id); });
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
      // Co cizí místo vydělává a za kolik tam má nájem, je věc majitele.
      polozky.push({ smer: 'koupim', predmet: 'pradlomat', spot_id: m.spot_id, model: m.model,
        popis: esc(m.name || m.spot_id), pod: (MODELS[m.model] || {}).name + ' · postavený prádlomat' });
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
      var l = uverMista(u), dluh = l ? Math.round(l.zbyva) : 0;
      moje.push({ smer: 'prodam', predmet: 'pradlomat', spot_id: u.spotId, model: u.eco.model,
        zisk: u.eco.profit, invest: u.eco.invest, obrat: u.eco.revenue, skore: u.score, rent: u.eco.rent,
        dluh: dluh, splatka: l ? Math.round(l.splatka) : 0,
        popis: 'můj ' + esc(u.name), pod: MODELS[u.eco.model].name
          + ' · ' + Math.round(u.score) + '/100 · zisk ' + kcFull(u.eco.profit) + '/měs'
          + '<br><i class="cena">orientačně ' + kcFull(cenaPradlomatu(u.eco.profit, u.eco.invest)) + '</i>'
          + (dluh > 0 ? '<i class="cena dluh">visí na něm úvěr ' + kcFull(dluh) + '</i>' : '') });
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
  // U cizího prádlomatu neumíme nic počítat — a neměli bychom: jeho čísla
  // zná jen majitel. U vlastního majetku a u strojů cena dává smysl.
  var orient = (jaPlatim && x.predmet === 'pradlomat') ? null : cenaPredmetu(x);
  sheet('<h3>' + (jaPlatim ? 'Nabídka na odkup' : 'Nabídka k prodeji') + '</h3>'
    + '<p class="muted small">' + x.popis + ' · ' + esc(kdo.firma) + '</p>'
    + (x.predmet === 'pradlomat' && !jaPlatim
        ? '<div class="kv"><span>Zisk / měsíc</span><b class="ok">' + kcFull(x.zisk || 0) + '</b></div>'
          + (x.obrat ? '<div class="kv"><span>Obrat / měsíc</span><b>' + kcFull(x.obrat) + '</b></div>' : '')
          + (x.rent ? '<div class="kv"><span>Nájem / měsíc</span><b class="warn">' + kcFull(x.rent) + '</b></div>' : '')
          + (x.skore != null ? '<div class="kv"><span>Skóre místa</span><b>' + Math.round(x.skore) + '/100</b></div>' : '')
          + ((x.dluh || 0) > 0
              ? '<div class="kv"><span>Úvěr na místě</span><b class="warn">' + kcFull(x.dluh) + '</b></div>' : '')
        : '')
    + (x.predmet === 'pradlomat' && jaPlatim
        ? '<p class="fine">Co to místo vydělává a kolik tam platí nájem, ví jen majitel. '
          + 'Zeptej se ho ve zprávách, než něco nabídneš.</p>'
          + '<button class="btn ghost" id="na-napsat" style="width:100%;margin:4px 0 10px">Napsat majiteli</button>'
        : '')
    + (orient != null
        ? '<div class="kv souhrn"><span>Orientační cena</span><b>' + kcFull(orient) + '</b></div>'
          + '<p class="fine">' + (x.predmet === 'pradlomat'
              ? 'Tolik dává trh za prádlomat s tímhle ziskem — kupujícímu se vrátí za ' + CENA_NASOBEK + ' roky.'
              : 'Tolik se za to na burze běžně platí.') + '</p>'
        : '<p class="fine">Tohle trh nemá jak ocenit — cena je čistě na dohodě.</p>')
    + '<label class="fld"><span>Cena (L$)</span>'
    + '<input id="na-cena" class="inp" type="number" min="0" step="1000" value="' + (orient || 0) + '"></label>'
    + '<p class="fine" id="na-verdikt"></p>'
    + (jaPlatim ? kartyVyber('na') : '')
    + '<label class="fld"><span>Vzkaz (nepovinný)</span><input id="na-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<button class="btn big" id="na-ok">Odeslat nabídku</button>'
    + '<p class="fine">Rozhodne protistrana — nabídku může přijmout i odmítnout.</p>');
  // Verdikt se přepíše při každém úderu do klávesnice.
  var ci = $('na-cena'), vd = $('na-verdikt');
  var verdikt = function () {
    var c = Math.max(0, Math.round(Number(ci.value) || 0));
    var t = [], tr = 'fine';
    if (orient != null && orient > 0) {
      var o = Math.round((c - orient) / orient * 100);
      t.push(Math.abs(o) < 3 ? 'Sedí na orientační ceně.'
        : o > 0 ? 'O ' + o + ' % nad orientační cenou.' : 'O ' + (-o) + ' % pod orientační cenou.');
    }
    if (x.predmet === 'pradlomat' && x.zisk > 0 && !jaPlatim) {
      var r = rokyNavratnosti(c, x.zisk);
      if (r) t.push('Jemu se to vrátí za ' + r.toFixed(1).replace('.', ',') + ' roku.');
    }
    // Pod dluh, který na místě visí, prodávající nepůjde — doplácel by ze svého.
    var dluh = jaPlatim ? 0 : (x.dluh || 0);
    if (dluh > 0) {
      if (c < dluh) {
        t.push('Pod úvěr, který na místě visí — ' + kcFull(dluh - c) + ' bys doplácel ze svého.');
        tr = 'fine err';
      } else {
        t.push('Úvěr to pokryje a ještě ti ' + kcFull(c - dluh) + ' zbyde.');
      }
    }
    if (jaPlatim && c > S.cash) { t.push('Tolik hotovosti nemáš — máš ' + kcFull(S.cash) + '.'); tr = 'fine err'; }
    vd.className = tr;
    vd.textContent = t.join(' ');
  };
  ci.oninput = verdikt; verdikt();
  var nn = $('na-napsat');
  if (nn) nn.onclick = function () { chatSheet(toId); };
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
        zapis('prijem', x.popis || 'Připsáno na účet', x.amount || 0, 0, x.vzniklo);
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
          var sp = { id: x.spot_id, name: dd.name || 'Koupený prádlomat', kind: dd.kind || 'unknown',
            score: dd.score != null ? dd.score : 60, lat: dd.lat, lon: dd.lon };
          var eco = economics(sp, x.model || 'mini');
          eco.rent = dd.rent || eco.rent;
          eco.cost = eco.energy + eco.servis + eco.rent;
          eco.profit = eco.revenue - eco.cost;
          // Investicí je to, co za místo hráč opravdu dal — podle toho se pak
          // počítá návratnost, ne podle ceny stavby na zelené louce.
          if (dd.invest) { eco.invest = Math.round(dd.invest); eco.install = 0; eco.conn = 0; }
          S.units.push({ spotId: x.spot_id, areaId: dd.area_key || '', name: sp.name, kind: sp.kind,
            score: sp.score, lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: eco });
          // Rozvržení plochy po předchozím majiteli — přípojky jsou v zemi,
          // kupující je nestaví znovu.
          if (dd.plan) { S.plany = S.plany || {}; S.plany[zakladniSpotId(x.spot_id)] = dd.plan; }
        }
      }
      if (x.popis) zpravy.push(x.popis);
    });
    // Když ubylo místo, banka se hned podívá na rámec — limit se počítá z toho,
    // kolik doplacených prádlomatů má hráč v provozu.
    if (d.some(function (x) { return x.kind === 'unit_remove' || x.kind === 'unit_add'; })) prehodnotRamec(false, true);
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
// Lišta s firmou: s účtem vede na profil, bez účtu rovnou na jeho založení.
if ($('t-firma')) $('t-firma').onclick = function () {
  if (ME) switchTab('me'); else showAcct('register');
};
$('burza-nova').onclick = novaNabidkaSheet;
// Přepínače v záložce Síť: moje síť vs. žebříček a kategorie žebříčku.
[].forEach.call(document.querySelectorAll('[data-net]'), function (b) {
  b.onclick = function () { netZalozka(b.getAttribute('data-net')); };
});
// Přepínač nad mapou: všechno včetně konkurence, nebo jen vlastní síť.
[].forEach.call(document.querySelectorAll('[data-mapa]'), function (b) {
  b.classList.toggle('on', (b.getAttribute('data-mapa') === 'moje') === MAPA_MOJE);
  b.onclick = function () { mapaPohled(b.getAttribute('data-mapa') === 'moje'); };
});
[].forEach.call(document.querySelectorAll('[data-stroj]'), function (b) {
  b.onclick = function () {
    STROJE_KAT = b.getAttribute('data-stroj');
    [].forEach.call(document.querySelectorAll('[data-stroj]'), function (x) { x.classList.toggle('on', x === b); });
    paintStroje();
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

// ─── Záznam první minuty ─────────────────────────────────────────────────────
// Z úplně první návštěvy se nahrají první dvě minuty. Není to video —
// ukládá se popis toho, co se na stránce dělo (co se vykreslilo, kam člověk
// klepl, kam scroloval), takže je to malé a dá se to v administraci přehrát.
// Vyplňované texty se nenahrávají, nick ani heslo se tedy nikam neuloží.
// Posílá se po částech, ať se nic neztratí, když návštěvník odejde dřív.
var ZAZNAM_KEY = 'lm_zaznam';     // značka, že první návštěva už se nahrála
var ZAZNAM_DELKA = 120000;        // dvě minuty — aby šlo vidět celý tutoriál
var ZAZNAM_CAST = 15000;
var ZAZNAM_CASTI_MAX = 12;        // 8 × 15 s + rezerva na poslední odeslání
// Nahrává se jen ten okamžik, kdy člověk doopravdy přišel z reklamy — tedy
// příchod, který má v adrese utm nebo fbclid. Kdo se vrátí přímo nebo přijde
// z vyhledávání, se nenahrává vůbec; u těch se stejně nemá co ladit, platíme
// za ně. Poznává se to z adresy, ne z uloženého zdroje: ten si prohlížeč drží
// i při dalších návštěvách a nahrávalo by se znovu a znovu.
function zReklamy() {
  try {
    var q = new URLSearchParams(location.search);
    return !!(q.get('utm_source') || q.get('zdroj') || q.get('fbclid') || q.get('gclid') || q.get('ttclid'));
  } catch (e) { return false; }
}
function zaznamStart() {
  if (!zReklamy()) return;
  try {
    if (localStorage.getItem(ZAZNAM_KEY)) return;   // není to první návštěva
    localStorage.setItem(ZAZNAM_KEY, '1');          // ani po obnovení stránky už podruhé
  } catch (e) { return; }                           // bez úložiště se nenahrává
  var sc = document.createElement('script');
  sc.src = '/game/vendor/rrweb-record.min.js';
  sc.async = true;
  sc.onload = zaznamJed;
  document.head.appendChild(sc);
}
function zaznamJed() {
  var R = window.rrwebRecord && window.rrwebRecord.record;
  if (!R) return;
  var buf = [], cast = 0, start = Date.now(), stop = null, konec = false;
  function posli(posledni) {
    if (!buf.length || cast >= ZAZNAM_CASTI_MAX) return;
    var davka = buf; buf = [];
    var telo = JSON.stringify({ sid: visitId(), poradi: cast, ms: Date.now() - start,
      zdroj: zjistiZdroj(), udalosti: davka });
    cast++;
    try {
      fetch('/api/game/zaznam', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: telo, keepalive: !!posledni && telo.length < 60000 }).catch(function () {});
    } catch (e) { /* nahrávání nikdy nesmí shodit hru */ }
  }
  try {
    stop = R({
      emit: function (e) { if (!konec) buf.push(e); },
      maskAllInputs: true,                 // co kdo píše, se nenahrává
      maskInputOptions: { password: true },
      sampling: { mousemove: 100, scroll: 150, media: 1000 },
      recordCanvas: false, collectFonts: false
    });
  } catch (e) { return; }
  var t = setInterval(function () { posli(false); }, ZAZNAM_CAST);
  function dokonci() {
    if (konec) return;
    konec = true;
    clearInterval(t);
    try { if (stop) stop(); } catch (e) { /* nevadí */ }
    posli(true);
  }
  setTimeout(dokonci, ZAZNAM_DELKA);
  window.addEventListener('pagehide', function () { posli(true); });
}

// Odkud hráč přišel. Bereme z adresy při první návštěvě a držíme to v
// prohlížeči — registrace přijde třeba až za dva dny a to už v adrese nic není.
var ZDROJ_KEY = 'lm_zdroj';
function zjistiZdroj() {
  try {
    var q = new URLSearchParams(location.search);
    var z = q.get('utm_source') || q.get('zdroj') || (q.get('fbclid') ? 'facebook' : '');
    var m = q.get('utm_medium') || '', k = q.get('utm_campaign') || '';
    if (z) {
      var cely = [z, m, k].filter(Boolean).join(' / ').slice(0, 80);
      if (!localStorage.getItem(ZDROJ_KEY)) localStorage.setItem(ZDROJ_KEY, cely);
    }
    return localStorage.getItem(ZDROJ_KEY) || '';
  } catch (e) { return ''; }
}
function ev(name, znovu) {
  if (!znovu && evDone[name]) return;
  evDone[name] = 1;
  try {
    fetch('/api/game/ev', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      // Zdroj posíláme s sebou: u návštěvníka bez účtu je to jediné místo,
      // odkud se dá poznat, jestli přišel z reklamy.
      body: JSON.stringify({ event: name, sid: visitId(), zdroj: zjistiZdroj() }),
      keepalive: true }).catch(function () {});
  } catch (e) { /* sledování nikdy nesmí shodit hru */ }
}

// ─── AI poradce ──────────────────────────────────────────────────────────────
// Rádce ke hře, co vidí, jak hráč hraje. Posílá se mu jen výtah z herního
// stavu — čísla, nic osobního. Odpovídá server, model běží u nás.
var PORADCE_H = [];          // historie rozhovoru v rámci jedné návštěvy
var PORADCE_CEKA = false;

// Výtah stavu pro poradce. Držet krátký: co řádek, to něco, co může poradit.
function poradceStav() {
  var mista = (S.units || []).map(function (u) {
    return { name: u.name, model: (u.eco && u.eco.model) || '', score: u.score,
      rent: (u.eco && u.eco.rent) || 0, zisk: (u.eco && u.eco.profit) || 0,
      porucha: !!u.porucha, vypoved: typeof jeVeVypovedi === 'function' ? !!jeVeVypovedi(u) : false };
  });
  var sklad = 0; for (var k in (S.stock || {})) sklad += S.stock[k] || 0;
  var zisk = monthlyProfit(), spl = splatkyMesicne();
  var st = {
    rok: Math.max(1, Math.ceil(((Date.now() - (S.startedAt || Date.now())) / MONTH_MS + 1) / 12)),
    profil: (PROFILES[S.profile] || {}).name || S.profile,
    cash: S.cash, dluh: S.loan, bank: S.bank,
    zisk: zisk, splatky: spl, zbyde: zisk - spl,
    pocet: mista.length, sklad: sklad, cesta: (S.orders || []).length,
    mest: Object.keys(S.areas || {}).length,
    poruchy: mista.filter(function (m) { return m.porucha; }).length,
    vypovedi: mista.filter(function (m) { return m.vypoved; }).length,
    povest: povest(), mista: mista,
  };
  if (maRamec()) st.ramec = { limit: S.ramec.limit, cerpano: ramecCerpano(), volny: ramecVolny() };
  st.styl = poradceStyl(st);
  return st;
}
// Jak hráč hraje, krátce a vlastními slovy. Poradce pak ladí rady podle toho.
function poradceStyl(st) {
  var v = [];
  if (!st.pocet) v.push('zatím nic nepostavil');
  else {
    var sk = st.mista.reduce(function (a, m) { return a + (m.score || 0); }, 0) / st.pocet;
    v.push('průměrné skóre míst ' + Math.round(sk));
    var modely = {}; st.mista.forEach(function (m) { modely[m.model] = (modely[m.model] || 0) + 1; });
    v.push('stroje: ' + Object.keys(modely).map(function (k) { return k + '×' + modely[k]; }).join(', '));
  }
  var majetek = assetsTotal();
  if (majetek > 0) v.push('dluh je ' + Math.round((st.dluh / majetek) * 100) + ' % majetku');
  if (st.splatky > 0) v.push('hotovost pokryje ' + (st.cash / st.splatky).toFixed(1).replace('.', ',') + ' splátky');
  else if (!st.dluh) v.push('nemá žádný úvěr');
  if (st.poruchy) v.push('nechává stát porouchané stroje');
  return v.join(', ');
}
function poradceOtazky() {
  if (!(S.units || []).length) {
    return ['Jak mám začít?', 'Jak poznám dobré místo?', 'Mám si na první prádlomat půjčit?'];
  }
  var q = ['Co mám postavit dál?', 'Jak si stojím?'];
  if (S.loan > 0) q.push('Nemám moc dluhů?');
  if (maRamec()) q.push('Jak funguje rámcový úvěr?'); else q.push('Jak se dostanu k rámcovému úvěru?');
  if ((S.units || []).some(function (u) { return !!u.porucha; })) q.push('Co mám dělat s poruchou?');
  else q.push('Vyplatí se mi něco prodat na tržišti?');
  return q.slice(0, 4);
}
function poradceSheet() {
  PORADCE_CEKA = false;
  sheet('<h3>\uD83D\uDCA1 Poradce</h3>'
    + '<p class="muted small">Zeptej se na cokoli ke hře. Poradce vidí tvoje čísla — kolik máš, '
    + 'co ti co vydělává a kde to drhne. Rozhovor nikam neukládáme.</p>'
    + '<div id="por-tok" class="por-tok"></div>'
    + '<div id="por-chipy" class="por-chipy"></div>'
    + '<div class="por-vstup"><input class="inp" id="por-q" maxlength="300" '
    + 'placeholder="Napiš otázku\u2026" autocomplete="off">'
    + '<button class="btn sm" id="por-send">Zeptat se</button></div>');
  poradcePaint();
  var inp = $('por-q');
  if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); poradcePosli(inp.value); } };
  $('por-send').onclick = function () { poradcePosli($('por-q') ? $('por-q').value : ''); };
}
// Model odpovídá markdownem — **tučně** a odrážkami. V bublině to má vypadat
// jako text, ne jako hvězdičky. Víc než tohle neumíme a ani nepotřebujeme.
function poradceText(t) {
  var radky = String(t == null ? '' : t).split(/\n/);
  var out = '', seznam = false;
  radky.forEach(function (r) {
    r = r.replace(/\s+$/, '');
    var li = /^\s*[-*\u2022]\s+/.test(r);
    var txt = esc(r.replace(/^\s*[-*\u2022]\s+/, '').replace(/^#{1,6}\s*/, ''))
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    if (li) { if (!seznam) { out += '<ul class="por-ul">'; seznam = true; } out += '<li>' + txt + '</li>'; return; }
    if (seznam) { out += '</ul>'; seznam = false; }
    if (txt) out += '<p>' + txt + '</p>';
  });
  if (seznam) out += '</ul>';
  return out || esc(t || '');
}
function poradcePaint() {
  var tok = $('por-tok');
  if (!tok) return;
  var h = PORADCE_H.map(function (z) {
    return '<div class="por-z ' + (z.role === 'ai' ? 'ai' : 'ja') + '">' + poradceText(z.text) + '</div>';
  }).join('');
  if (PORADCE_CEKA) h += '<div class="por-z ai cekam">Přemýšlím\u2026</div>';
  if (!h) h = '<div class="por-uvod">Nevíš, kde začít? Klikni na otázku níž.</div>';
  tok.innerHTML = h;
  tok.scrollTop = tok.scrollHeight;
  var ch = $('por-chipy');
  if (ch) {
    ch.innerHTML = poradceOtazky().map(function (q) {
      return '<button class="por-chip" data-por-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
    ch.querySelectorAll('[data-por-q]').forEach(function (b) {
      b.onclick = function () { poradcePosli(b.getAttribute('data-por-q')); };
    });
  }
}
function poradcePosli(q) {
  q = String(q || '').trim();
  if (!q || PORADCE_CEKA) return;
  var inp = $('por-q'); if (inp) inp.value = '';
  PORADCE_H.push({ role: 'ja', text: q });
  PORADCE_CEKA = true; poradcePaint();
  apiJson('/poradce', { otazka: q, stav: poradceStav(), historie: PORADCE_H.slice(0, -1).slice(-6) })
    .then(function (r) {
      PORADCE_CEKA = false;
      var j = r.j || {};
      if (j.ok && j.text) PORADCE_H.push({ role: 'ai', text: j.text });
      else PORADCE_H.push({ role: 'ai', text: j.error || 'Poradce teď nemůže odpovědět. Zkus to za chvíli.' });
      poradcePaint();
    })
    .catch(function () {
      PORADCE_CEKA = false;
      PORADCE_H.push({ role: 'ai', text: 'Server neodpovídá. Zkus to za chvíli.' });
      poradcePaint();
    });
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
// Verze stavu na serveru, ze které tahle hra vychází. Posílá se s každým
// uložením; když se mezitím uložilo z jiného zařízení, server to odmítne a
// pošle novější stav. Bez toho by hra otevřená v telefonu přepsala prádlomaty
// koupené mezitím na počítači.
var STATE_REV = null;
function prevezmiStav(srv, rev) {
  if (!srv) return false;
  var novy = dosypStav(srv);
  if (!novy) return false;
  S = novy;
  if (rev != null) STATE_REV = rev;
  save();
  if (typeof refreshUnits === 'function') refreshUnits();
  paint(); drawMap();
  return true;
}
function syncState(force) {
  if (wiped || !ME || syncBusy || !S) return Promise.resolve();
  // Hra na pozadí (druhá záložka, telefon v kapse) neukládá — jinak by svým
  // starým stavem přepsala to, co hráč zrovna dělá jinde. Výjimka je poslední
  // uložení při odchodu, to si vynutíme přes force.
  if (!force && document.hidden) return Promise.resolve();
  if (!force && Date.now() - syncAt < 15000) return Promise.resolve();
  syncBusy = true; syncAt = Date.now();
  // aktivni říká serveru, jestli má hráč hru doopravdy před sebou — podle toho
  // se počítá čas strávený ve hře.
  return apiJson('/account/state', { state: S, aktivni: !document.hidden, rev: STATE_REV }, 'PUT')
    .then(function (r) {
      syncBusy = false;
      if (r.ok) { if (r.j && r.j.rev != null) STATE_REV = r.j.rev; return; }
      if (r.status === 409 && r.j) {
        // Jinde je novější hra. Vezmeme ji — svoje poslední vteřiny raději
        // obětujeme než cizí postup z druhého zařízení.
        if (prevezmiStav(r.j.state, r.j.rev)) {
          toast('Tuhle hru máš rozehranou i jinde — načetli jsme novější stav.', 'ok');
        } else if (r.j.rev != null) { STATE_REV = r.j.rev; }
      }
    })
    .catch(function () { syncBusy = false; /* offline — zkusí se příště */ });
}

// ─── Heslo k rozehranému účtu ────────────────────────────────────────────────
// Hráč začal jen se jménem firmy. Dokud si nevymyslí heslo, drží ho ve hře
// jediná cookie v tomhle prohlížeči — a to mu musíme říct narovinu, ne až
// ve chvíli, kdy o síť přijde.
function potrebujeHeslo() { return !!(ME && ME.ma_heslo === false); }
function hesloSheet() {
  if (!potrebujeHeslo()) return;
  sheet('<h3>Zamkni si firmu heslem</h3>'
    + '<p class="muted small">Hraješ jako <b>' + esc(ME.nick) + '</b>'
    + (ME.company ? ' za ' + esc(ME.company) : '') + ' — tvoje síť je uložená u nás na serveru, '
    + 'ale zatím tě k ní pustí jen tenhle prohlížeč. Vymysli si heslo a dostaneš se k ní '
    + 'odkudkoli — z telefonu, z práce, po smazání historie.</p>'
    + '<label class="fld"><span>Heslo</span>'
    + '<input id="hs-pass" class="inp" type="password" maxlength="200" autocomplete="new-password" '
    + 'placeholder="aspoň 6 znaků"></label>'
    + '<p class="fine err hidden" id="hs-err"></p>'
    + '<button class="btn big" id="hs-go" style="width:100%">Nastavit heslo</button>'
    + '<button class="btn ghost" id="hs-pak" style="width:100%;margin-top:8px">Teď ne</button>'
    + '<p class="fine">E-mail po tobě nikdo nechce. Ten bude potřeba, až si budeš něco kupovat.</p>');
  var inp = $('hs-pass');
  var posli = function () {
    var pwd = inp ? inp.value : '';
    var e = $('hs-err');
    if (pwd.length < 6) { if (e) { e.textContent = 'Heslo musí mít aspoň 6 znaků.'; e.classList.remove('hidden'); } return; }
    var b = $('hs-go'); b.disabled = true; b.textContent = 'Ukládám…';
    apiJson('/account/heslo', { password: pwd }).then(function (r) {
      b.disabled = false; b.textContent = 'Nastavit heslo';
      if (!r.ok) { if (e) { e.textContent = r.j.error || 'Nepovedlo se.'; e.classList.remove('hidden'); } return; }
      ME = r.j.player;
      closeSheet(); paintHeslo();
      toast('Hotovo. Teď se k síti dostaneš i jinde — jménem ' + ME.nick + ' a heslem.', 'ok');
    }).catch(function () {
      b.disabled = false; b.textContent = 'Nastavit heslo';
      if (e) { e.textContent = 'Server neodpovídá. Zkus to za chvíli.'; e.classList.remove('hidden'); }
    });
  };
  $('hs-go').onclick = posli;
  if (inp) inp.onkeydown = function (ev2) { if (ev2.key === 'Enter') { ev2.preventDefault(); posli(); } };
  $('hs-pak').onclick = function () { closeSheet(); paintHeslo(); };
  setTimeout(function () { if (inp) inp.focus(); }, 80);
}
// Proužek nad hrou. Nezmizí, dokud heslo není — ale neplete se do hraní.
function paintHeslo() {
  var el = $('heslo-lista');
  if (!el) return;
  var ukaz = potrebujeHeslo() && S && (S.units || []).length > 0;
  el.classList.toggle('hidden', !ukaz);
  if (!ukaz) return;
  el.innerHTML = '<span>Firma je zatím jen v tomhle prohlížeči.</span><b>Nastavit heslo</b>';
  el.onclick = hesloSheet;
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
  // Kdo už hraje, se účtem nesmí být zdržený — hra běží i bez něj.
  if (zp) zp.textContent = (S && S.units && S.units.length) ? 'Teď ne — hrát dál' : 'Zpět';
  if (zp) zp.onclick = function () {
    $('acct').classList.add('hidden');
    if (S && S.units && S.units.length) return startGame();
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
    { nick: nick, password: pass, company: firma, ref: trvalePid(), odkud: prichoziRef(),
      zdroj: zjistiZdroj(), sid: visitId() }).then(function (r) {
    $('ac-go').disabled = false;
    if (!r.ok) return acctErr(r.j.error || 'Nepovedlo se.');
    ME = r.j.player;
    srovnejRef();
    POZVANI = null;
    if (!login) ev('game_register');
    // Verzi stavu si bereme vždycky — podle ní se pozná, že hru mezitím uložilo
    // jiné zařízení, a tohle ji nemá přepsat.
    if (r.j.rev != null) STATE_REV = r.j.rev;
    if (login) {
      // Na serveru je uložená síť — ta má přednost před tím, co je v prohlížeči.
      if (r.j.state) { S = dosypStav(r.j.state) || S; save(); }
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
    RUSH_ZA = r.j.rush_zdarma_za; RUSH_MAX = r.j.rush_zdarma_max || 5;
    if (r.j.owned && ME) ME.cards = r.j.owned;
  }).catch(function () { });
}
function ownedOf(kind) { return (ME && ME.cards && ME.cards[kind]) || 0; }
// Kdy přibude další Expresní dovoz zdarma. Počítá to server, klient jen ukazuje.
var RUSH_ZA = null, RUSH_MAX = 5;
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
        + (c.kind === 'rush' && RUSH_ZA != null
            ? '<p class="fine ok">Jedna ti přibude zdarma každé dva herní měsíce — další '
              + etaText(RUSH_ZA) + (n >= RUSH_MAX ? '. Víc než ' + RUSH_MAX + ' si jich ale neuložíš.' : '.') + '</p>'
            : '')
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
  var iS = Math.max(SPL_ZAKLAD, Math.min(maxSplatnost(), iSplatnosti == null ? SPL_ZAKLAD : iSplatnosti));
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
    + '<div class="splat">' + SPLATNOSTI.slice(SPL_ZAKLAD).map(function (x, j) {
        var i = SPL_ZAKLAD + j, lze = i <= maxS;
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
    zapis('uver', 'Úvěr z banky na ' + m.splatnost.nazev, m.naruku);
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
      else { S.cash += v.amount; zapis('prijem', 'Karta — ' + (v.name || 'hotovost'), v.amount); }
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
// Název karty v prohlížeči. Aplikace, které hru otevírají ve vlastní kartě,
// si titulek drží z chvíle, kdy se karta založila — po přejmenování hry by na
// ní tak zůstal starý název. Přepíšeme ho při každém startu.
function nastavTitulek() {
  try { document.title = HRA_NAZEV; } catch (e) {}
}
function startGame() {
  nastavTitulek();
  ['intro', 'quiz', 'role'].forEach(function (id) { $(id).classList.add('hidden'); });
  $('app').classList.remove('hidden');
  var before = S.cash, waiting = (S.orders || []).length;
  tick(); save(); dripCash = Math.round(S.cash); paint();
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
  // Tržiště chceme mít i na mapě, ne až po otevření Burzy.
  paintTrhBadge();
  loadTrh(drawMap);
  vyzvedniNasledky();
  loadTrades();
  loadChat();
  setInterval(function () { loadTrades(); loadTrh(drawMap); nactiNajmy(vyzvedniNasledky); loadCards().then(function () { claimCash(); }); }, 60000);
  // Zprávy od hráčů chodí živě: ptáme se každých dvacet vteřin, ale jen když má
  // hráč hru doopravdy před sebou.
  setInterval(function () { if (!document.hidden) loadChat(); }, 20000);
  checkPayment();
  setInterval(function () { tick(); save(); paint(); syncState(); }, 5000);
  // Vlastní, rychlejší tep jen pro naskakující čísla nad prádlomaty.
  setInterval(function () { tick(); dripTick(); }, 1000);
  setInterval(pullRefs, 60000);
  document.addEventListener('visibilitychange', function () {
    // Po návratu do hry se hned podíváme, jestli nám konkurence nevyfoukla místo.
    if (!document.hidden) { tick(); save(); paint(); loadClaims(); loadTrades(); loadChat(); nactiNajmy(vyzvedniNasledky); loadCards().then(function () { claimCash(); }); }
    else { syncState(true); }
  });
  window.addEventListener('pagehide', function () { syncState(true); });
}

ev('game_open');
zjistiZdroj();
zaznamStart();
startBonusOdpocet();
// Dokud má hráč hru otevřenou, posíláme každých pět minut tichou stopu. Jen
// z toho se dá poznat, kolik lidí je na hře právě teď — otevření stránky samo
// o sobě neřekne, jestli u ní někdo ještě sedí.
setInterval(function () {
  if (!document.hidden) ev('game_zije', true);
}, 300000);
nastavTitulek();
loadMachinePhotos();

countIncomingRef();   // ještě než se rozhodne, jestli je co rozehraného
S = load();
// Přihlášený hráč má přednost: síť ze serveru přebije to, co leží v prohlížeči,
// protože mohl mezitím hrát jinde.
// Posíláme id, které nesou naše rozeslané odkazy — server si ho zabere, pokud
// ještě žádné nemáme, a doplní všem, kdo přes něj přišli, vazbu na nás.
api('/account/me?ref=' + encodeURIComponent((S && S.pid) || trvalePid())).then(function (r) {
  if (r.ok && r.j.player) {
    ME = r.j.player;
    var srv = r.j.state;
    if (r.j.rev != null) STATE_REV = r.j.rev;
    if (srv && (!S || (srv.lastTick || 0) >= (S.lastTick || 0))) { S = dosypStav(srv) || S; save(); }
    srovnejRef();   // až tady: stav ze serveru může mít staré pid
    if (S) return startGame();
  }
  if (S) startGame();          // rozehraná hra bez účtu (z doby před účty)
}).catch(function () { if (S) startGame(); });

})();
