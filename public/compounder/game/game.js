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

// ─── Texty a jazyk ───────────────────────────────────────────────────────────
// Tohle musí být úplně první věc v souboru. Datové tabulky níž — měsíce,
// názvy zemí, jména volajících, otázky pohovoru, hodnosti — se počítají při
// načtení, a kdyby překladač ještě nestál, dostaly by místo textů holé klíče
// a hráč by je tak i viděl.
//
// Oba katalogy jsou ve stránce dřív než hra, jako obyčejné skripty. Čeština
// je vždycky (ve sloučených šablonách je i stavba oken včetně id prvků, takže
// chybějící katalog nezničí jen text, ale celé okno), jazyk hráče k ní přibude
// podle jeho účtu. Proto se jazyk přepíná znovunačtením stránky — překreslit
// to nestačí, tabulky nahoře se už podruhé nepočítají.
var HRAC_TEXTY = window.__TEXTY_HRAC || { jazyk: 'cs' };
// Řeči, které jsou opravdu přeložené. Rozdělaný překlad se nenabízí — hráč by
// viděl češtinu pod cizí vlajkou a vypadalo by to jako rozbitá hra.
var JAZYKY_HOTOVE = (HRAC_TEXTY.jazyky && HRAC_TEXTY.jazyky.length)
  ? HRAC_TEXTY.jazyky : ['cs', 'en'];
var JAZYK = HRAC_TEXTY.jazyk || 'cs';
var PREKLADY = (window.T18N
  ? new window.T18N.Preklady(
      HRAC_TEXTY.texty
        ? (function (m) { m.cs = window.__TEXTY_CS || {}; m[JAZYK] = HRAC_TEXTY.texty; return m; })({})
        : { cs: window.__TEXTY_CS || {} })
  : null);
function tx(klic, udaje) {
  if (!PREKLADY) return klic;
  return PREKLADY.t(klic, udaje, JAZYK);
}
// Pevný (statický) text hlavičky, mapy a spodní lišty je v index.html česky.
// V jiném jazyce ho tady přepíšeme z katalogu; česky se nesahá na nic.
function prelozStatickyText() {
  if (JAZYK === 'cs') return;
  var dej = function (sel, klic) {
    var el = document.querySelector(sel);
    if (el) el.textContent = tx(klic);
  };
  dej('.top .t-item:nth-child(1) > span', 'hra.rok');
  dej('#t-penize > span', 'hra.hotovost');
  dej('.top .t-item:nth-child(3) > span', 'hra.zbyde_mes');
  dej('.top .t-item:nth-child(4) > span', 'hra.pradlomaty');
  dej('[data-mapa="vse"] b', 'hra.vsechno'); dej('[data-mapa="vse"] i', 'hra.vse');
  dej('[data-mapa="moje"] b', 'hra.jen_moje'); dej('[data-mapa="moje"] i', 'hra.moje');
  var od = document.getElementById('open-areas'); if (od) od.textContent = '\uD83D\uDD0E ' + tx('hra.prozkoumat_mesto');
  dej('#map-hint', 'hra.mapa_napoveda');
  dej('#v-shop > h2', 'hra.obchod'); dej('#v-shop > p', 'hra.zal_obchod_popis');
  dej('#v-bank > h2', 'hra.banka');
  dej('#v-cards > h2', 'hra.karty'); dej('#v-cards > p', 'hra.zal_karty_popis');
  dej('#v-burza > h2', 'hra.burza'); dej('#v-burza > p', 'hra.zal_burza_popis'); dej('#burza-nova', 'hra.zal_nova_nabidka');
  dej('#v-me > h2', 'hra.ja');
  dej('#net-do-vyvoje', 'hra.zal_jak_si_vedu');
  [['data-net', { moje: 'hra.zal_moje_sit', stroje: 'hra.stroje', mista: 'hra.zal_mista', vyvoj: 'hra.zal_vyvoj', zebricek: 'hra.zal_zebricek' }],
   ['data-stroj', { zisk: 'hra.zisk', trzby: 'hra.trzby', poruchy: 'hra.zal_poruchy', navratnost: 'mapa.navratnost' }],
   ['data-misto', { vse: 'hra.vse', moje: 'hra.moje', volna: 'hra.zal_volna', cizi: 'hra.zal_konkurence' }],
   ['data-zeb', { pradlomaty: 'hra.pradlomaty', zisk: 'hra.zisk', jmeni: 'hra.zal_jmeni', hvezdy: 'hra.zal_hvezdicky', pozvanky: 'hra.zal_pozvanky', zeme: 'hra.zal_zeme' }]
  ].forEach(function (g) {
    Object.keys(g[1]).forEach(function (v) { dej('[' + g[0] + '="' + v + '"]', g[1][v]); });
  });
  [['map', 'hra.mapa'], ['shop', 'hra.obchod'], ['net', 'hra.sit'], ['bank', 'hra.banka'], ['cards', 'hra.karty'], ['burza', 'hra.burza'], ['me', 'hra.ja']].forEach(function (p) {
    var b = document.querySelector('nav.tabs button[data-v="' + p[0] + '"]'); if (!b) return;
    for (var n = b.lastChild; n; n = n.previousSibling) { if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = tx(p[1]); break; } }
  });
}
prelozStatickyText();
// Peníze a čísla se v angličtině píšou jinak (1,234,567 místo 1 234 567).
function tCislo(n) { return window.T18N ? window.T18N.cislo(n, JAZYK) : String(Math.round(n || 0)); }
function tPenize(n) { return window.T18N ? window.T18N.penize(n, JAZYK) : (Math.round(n || 0) + ' L$'); }
// Množné číslo přes katalog — nahrazuje mn(), které umí jen česká pravidla.
function tPocet(klic, n) { return tx(klic, { n: n }); }

// ─── Ekonomika ───────────────────────────────────────────────────────────────
// Čísla jsou 1:1 z reálného modelu prádlomatu (apps/laundromats/ekonomika.js),
// jen přepočtená do korun. Když se změní skutečný model, změň i tohle.
var EUR = 24.35;
// Kapacita = kolik lidí z místa stroj ještě pobere. Víc pracek a sušiček
// zvládne víc lidí; co se nevejde, odejde k někomu jinému. Proto se na slabém
// místě velký stroj nevyplatí (stejně obslouží to samé co malý, jen stál víc)
// a na špičkovém místě malý stroj většinu lidí nechá odejít.
// Čísla sedí na skóre místa: MINI naplní místo se skóre 50, FLEX 80, MAX 100.
var MODELS = {
  mini: { key: 'mini', name: 'MINI', machine: 35000, permit: 825, conn: 1926, spend: 16.52, cost: 647,
    kapacita: 7.1 },
  flex: { key: 'flex', name: 'FLEX', machine: 52000, permit: 825, conn: 2889, spend: 11.33, cost: 767,
    kapacita: 14.3 },
  max: { key: 'max', name: 'MAX', machine: 67000, permit: 825, conn: 2889, spend: 11.33, cost: 900,
    kapacita: 20 }
};
// Popis modelu je věta pro hráče, ne vlastnost stroje — patří do katalogu.
function modelPopis(k) { return tx('model.' + k + '.popis'); }
function modelIdealni(k) { return tx('model.' + k + '.idealni'); }
// Kolik lidí denně přijde na místo. Roste se skóre rychleji než lineárně —
// špičkové místo má dvojnásobek lidí oproti průměrnému, ne o desetinu víc.
var POPTAVKA_SPICKA = 20;        // lidí denně na místě se skóre 100
var POPTAVKA_SKLON = 1.5;
function poptavkaMista(score) {
  var sc = Math.max(0, Math.min(100, Number(score) || 0));
  return POPTAVKA_SPICKA * Math.pow(sc / 100, POPTAVKA_SKLON);
}
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
// Výroba má svoje tempo. Do padesáti prádlomatů dorazí stroj za den, pak si
// každých dalších padesát vyžádá den navíc — sto za dva dny, sto padesát za
// tři. Nad dvě stě se to zastaví na pěti dnech, aby velký hráč nečekal týden.
var DODANI_ZA = 50;              // po kolika postavených prádlomatech přibude den
var DODANI_MAX_DNU = 5;          // strop, ať čekání nenaroste donekonečna
function dodaniDnu() {
  var n = ((S && S.units) || []).length;
  return Math.max(1, Math.min(DODANI_MAX_DNU, Math.ceil(n / DODANI_ZA)));
}
function dodaniMs() { return dodaniDnu() * DELIVERY_MONTHS * MONTH_MS; }
function dodaniSlovy() {
  var d = dodaniDnu();
  return d === 1 ? esc(tx('hra.jeden_skutecny_den')) : d + ' ' + mn(d, 'den', 'dny', esc(tx('hra.dnu')));
}
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

var KIND_LABEL = { supermarket: esc(tx('hra.supermarket')), hypermarket: esc(tx('hra.hypermarket')), mall: esc(tx('hra.obchodni_centrum')),
  department_store: esc(tx('hra.obchodni_dum')), fuel: esc(tx('hra.benzinka')), car_wash: esc(tx('hra.samoobsluzna_mycka')) };

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
// Pobočky si hráč zřizuje i ruší, kdy chce — jsou to provozní náklady, ne
// trvalé rozhodnutí. Při zrušení se vybavení rozprodá se ztrátou, zpátky
// přijde polovina. Sídlo je naopak adresa firmy: přestěhovat se dá, ale
// stojí to a jen jednou za tři herní roky (osmnáct skutečných dní).
var POBOCKA_VRATKA = 0.5;          // kolik se vrátí při zrušení pobočky
var SIDLO_STEHOVANI = 300000;      // co stojí přestěhovat sídlo
var SIDLO_PAUZA = 3 * YEAR_MS;     // a jak často to jde
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
// Pobočku jde zřídit kdykoli — omezuje ji jen cena a to, že v místě ještě
// žádnou základnu nemá.
function pobockaLze() { return true; }
// Kdy půjde přestěhovat sídlo. Počítá se od založení firmy nebo od posledního
// stěhování, podle toho, co bylo později.
function sidloOd() {
  return Math.max(S.startedAt || 0, (S.sidlo && S.sidlo.od) || 0) + SIDLO_PAUZA;
}
function sidloLze() { return !!S.sidlo && Date.now() >= sidloOd(); }

// ─── Pohovor s rizikořem ────────────────────────────────────────────────────
// Deset otázek při otevření nebo navýšení rámce, tři při běžném čerpání.
// Každá má opatrnou, vyváženou a odvážnou odpověď. Odvážná může dostat víc,
// ale dráž — a hlavně se odpovědi ověřují proti skutečnému stavu hry: kdo si
// vymýšlí, dopadne hůř, než kdyby odpověděl popravdě.
var OTAZKY = [
  { q: esc(tx('hra.na_co_ty_penize_budou')), a: [
    { t: esc(tx('hra.na_konkretni_misto_ktere_mam')), b: 2, overit: function () { return Object.keys(S.revealed || {}).length >= 1; } },
    { t: esc(tx('hra.na_rozsireni_site_misto_teprve')), b: 1 },
    { t: esc(tx('hra.chci_rezervu_uvidi_se')), b: 0 } ] },
  { q: esc(tx('hra.co_udelate_kdyz_trzby_spadnou')), a: [
    { t: esc(tx('hra.mam_rezervu_pul_roku_to')), b: 2, overit: function () { return S.cash >= splatkyMesicne() * 6; } },
    { t: esc(tx('hra.utahnu_opasek_a_omezim_vydaje')), b: 1 },
    { t: esc(tx('hra.pujcim_si_vic')), b: -1 } ] },
  { q: esc(tx('hra.jakou_mate_provozni_rezervu')), a: [
    { t: esc(tx('hra.vic_nez_tri_splatky_dopredu')), b: 2, overit: function () { return S.cash >= splatkyMesicne() * 3; } },
    { t: esc(tx('hra.zhruba_jednu_splatku')), b: 1, overit: function () { return S.cash >= splatkyMesicne(); } },
    { t: esc(tx('hra.uprimne_zadnou')), b: 0 } ] },
  { q: esc(tx('hra.kdo_vam_stroje_servisuje')), a: [
    { t: esc(tx('hra.mam_na_to_lidi_a')), b: 1, overit: function () { return maCetu(); } },
    { t: esc(tx('hra.resim_to_vzdycky_ad_hoc')), b: 0 },
    { t: esc(tx('hra.zatim_to_neresim')), b: -1 } ] },
  { q: esc(tx('hra.co_kdyz_vam_majitel_vypovi')), a: [
    { t: esc(tx('hra.mam_proverena_nahradni_mista')), b: 2, overit: function () { return Object.keys(S.revealed || {}).length >= 3; } },
    { t: esc(tx('hra.najdu_jine_chvili_to_potrva')), b: 1 },
    { t: esc(tx('hra.to_se_mi_stat_nemuze')), b: -1 } ] },
  { q: esc(tx('hra.z_ceho_budete_splacet')), a: [
    { t: esc(tx('hra.z_provozu_splatka_je_pod')), b: 2, overit: function () { return monthlyProfit() > 0 && splatkyMesicne() < monthlyProfit() * 0.5; } },
    { t: esc(tx('hra.z_provozu_ale_bude_to')), b: 1 },
    { t: esc(tx('hra.z_dalsiho_uveru')), b: -2 } ] },
  { q: esc(tx('hra.sledujete_kde_stavi_konkurence')), a: [
    { t: esc(tx('hra.ano_mapu_si_hlidam')), b: 1 },
    { t: esc(tx('hra.moc_ne')), b: 0 } ] },
  { q: esc(tx('hra.kolik_pradlomatu_chcete_mit_za')), a: [
    { t: esc(tx('hra.o_par_vic_nez_mam')), b: 2 },
    { t: esc(tx('hra.rad_bych_sit_zdvojnasobil')), b: 1 },
    { t: esc(tx('hra.desetkrat_tolik')), b: -1 } ] },
  { q: esc(tx('hra.mate_s_provozem_zkusenost')), a: [
    { t: esc(tx('hra.par_pradlomatu_uz_mi_bezi')), b: 2, overit: function () { return S.units.length >= 3; } },
    { t: esc(tx('hra.zacinam_ucim_se_za_pochodu')), b: 1 },
    { t: esc(tx('hra.zadnou')), b: 0 } ] },
  { q: esc(tx('hra.a_kdyby_se_splacet_nedarilo')), a: [
    { t: esc(tx('hra.prodam_cast_site_a_dluh')), b: 2 },
    { t: esc(tx('hra.prijdu_se_s_vami_domluvit')), b: 1 },
    { t: esc(tx('hra.to_nevim')), b: -1 } ] }
];
// Hodnocení pohovoru: kolik bodů, co to udělá s limitem a se sazbou.
function pohovorStupen(body, otazek) {
  var max = otazek * 2;
  var podil = max > 0 ? body / max : 0;
  if (podil >= 0.7) return { nazev: esc(tx('hra.vyborne_2')), limit: 1.2, sazba: -0.003, ok: true,
    slovo: esc(tx('hra.takhle_pripravene_klienty_mame_radi')) };
  if (podil >= 0.4) return { nazev: esc(tx('hra.dobre')), limit: 1, sazba: 0, ok: true,
    slovo: esc(tx('hra.nic_mimoradneho_ale_drzi_to')) };
  if (podil >= 0.15) return { nazev: esc(tx('hra.slabe_2')), limit: 0.8, sazba: 0.003, ok: true,
    slovo: esc(tx('hra.mam_z_toho_rozpaky_pujcime')) };
  return { nazev: esc(tx('hra.nedostatecne')), limit: 0, sazba: 0, ok: false,
    slovo: esc(tx('hra.takhle_ne_vratte_se_az')) };
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
        + '<div class="nalada"><b>' + esc(tx('hra.hodnoceni')) + ' ' + st.nazev + '</b><span>' + esc(st.slovo) + '</span></div>'
        + (prichyceno ? tx('veta.p_class_fine_err_rizikor_si', { p1: prichyceno, p2: esc(tx('hra.overil_co_jste_rikal_a')), p3: esc(tx('hra.to_s_hodnocenim_zamavalo_vic')) }) : '')
        + '<button class="btn big" id="poh-ok">' + esc(tx('hra.pokracovat')) + '</button>');
      $('poh-ok').onclick = function () { closeSheet(); hotovo(st); };
      return;
    }
    var o = OTAZKY[poradi[krok]];
    sheet(tx('veta.h3_h3_p_class_fine_otazka', { p1: esc(nadpis) }) + (krok + 1) + ' z ' + poradi.length + '</p>'
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
    ? esc(tx('hra.nezaplatil_jsi_splatku_prodej_neco'))
    : esc(tx('hra.druha_neuhrazena_splatka_jeste_jedna')), 'err');
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
      popis: u.name || esc(tx('hra.pradlomat_7')), hodnota: Math.round(u.eco.invest || machinePrice(MODELS[u.eco.model])) });
    apiJson('/spots/release', { spot_id: u.spotId });   // místo se uvolní konkurenci
  });
  MODEL_ORDER.forEach(function (k) {
    for (var i = 0; i < inStock(k); i++) {
      polozky.push({ predmet: 'stroj', model: k, popis: 'stroj ' + MODELS[k].name, hodnota: machinePrice(MODELS[k]) });
    }
  });
  (S.orders || []).forEach(function (o) {
    polozky.push({ predmet: 'stroj', model: o.model, popis: 'stroj ' + MODELS[o.model].name + ' ' + esc(tx('hra.na_ceste_2')),
      hodnota: machinePrice(MODELS[o.model]) });
  });
  (S.pobocky || []).forEach(function (b) {
    polozky.push({ predmet: 'pobocka', spot_id: b.name, popis: tx('veta.pobocka_4', { p1: b.name }), hodnota: POBOCKA_CENA });
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
  sheet(tx('veta.h3_konkurz_h3_p_class_muted', { p1: esc(tx('hra.dluzis')), p2: kcFull(S.loan), p3: esc(tx('hra.pradlomatu_v_siti')), p4: S.units.length, p5: esc(tx('hra.hrat_dal_se_skraloupem')), p6: esc(tx('hra.zacit_znovu_s_cistym_stitem')) }));
  $('krach-dal').onclick = function () {
    var v = provedKonkurz();
    // Škraloup: rok bez úvěru. Zmeškané splátky vynulujeme, ať se konkurz
    // nespustí znovu hned v dalším měsíci.
    S.skraloupDo = Date.now() + YEAR_MS;
    (S.loans || []).forEach(function (l) { l.zmeskano = 0; });
    save(); paint();
    sheet('<h3>' + esc(tx('hra.po_konkurzu')) + '</h3>'
      + '<div class="kv"><span>' + esc(tx('hra.rozprodano')) + '</span><b>' + kcFull(v.utrzeno) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('hra.z_toho_bance')) + '</span><b class="warn">' + kcFull(v.naDluh) + '</b></div>'
      + '<div class="kv souhrn"><span>' + esc(tx('hra.zbylo_ti')) + '</span><b class="ok">' + kcFull(v.zbylo) + '</b></div>'
      + (v.odepsano > 0 ? '<div class="kv"><span>' + esc(tx('hra.banka_odepsala')) + '</span><b>' + kcFull(v.odepsano) + '</b></div>' : '')
      + tx('veta.p_class_muted_small_style_margin', { p1: v.mel, p2: mn(v.mel, esc(tx('hra.misto_se_uvolnilo')), esc(tx('hra.mista_se_uvolnila')), esc(tx('hra.mist_se_uvolnilo'))), p3: esc(tx('hra.banka_ti_herni_rok_nepujci')), p4: esc(tx('hra.rozumim_2')) }));
    $('krach-ok').onclick = closeSheet;
  };
  // I po krachu se slovo opisuje. Je to pořád nevratné smazání sítě a hráč,
  // kterému se zrovna zhroutila firma, kliká rychleji než přemýšlí.
  $('krach-znovu').onclick = zacniZnovuSheet;
}
// Po krachu banka rok nepůjčí.
function maSkraloup() { return (S.skraloupDo || 0) > Date.now(); }

// ─── Vlastní stavební četa ──────────────────────────────────────────────────
// Technika a dva lidi v sídle nebo na pobočce. Četa staví přípojky za pětinu
// ceny a zvládne čtyři místa za herní měsíc — vyplatí se jen tomu, kdo opravdu
// expanduje. Pod dvě místa měsíčně prodělává.
var CETA_TECHNIKA = [
  { id: 'bagr', nazev: esc(tx('hra.minibagr')), cena: 800000 },
  { id: 'dodavka', nazev: esc(tx('hra.dodavka')), cena: 600000 },
  { id: 'vrtacka', nazev: esc(tx('hra.jadrova_vrtacka')), cena: 80000 },
  { id: 'deska', nazev: esc(tx('hra.vibracni_deska')), cena: 50000 }
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
  { zav: 1, text: esc(tx('hra.zasekl_se_mincovnik')) },
  { zav: 1, text: esc(tx('hra.nejde_platebni_terminal')) },
  { zav: 1, text: esc(tx('hra.vypadlo_osvetleni')) },
  { zav: 1, text: esc(tx('hra.ucpany_filtr_susicky')) },
  { zav: 1, text: esc(tx('hra.zasekla_se_davkovaci_pumpicka')) },
  { zav: 2, text: esc(tx('hra.netesni_privodni_hadice')) },
  { zav: 2, text: esc(tx('hra.nedoviraji_dvirka_pracky')) },
  { zav: 2, text: esc(tx('hra.vypadl_jistic_susicky')) },
  { zav: 2, text: esc(tx('hra.nejde_ohrev_vody')) },
  { zav: 3, text: esc(tx('hra.vadne_vypousteci_cerpadlo')) },
  { zav: 3, text: esc(tx('hra.praskly_remen_bubnu')) },
  { zav: 3, text: esc(tx('hra.zavodnila_se_elektronika')) },
  { zav: 4, text: esc(tx('hra.shorel_motor_susicky')) },
  { zav: 4, text: esc(tx('hra.rozbite_lozisko_bubnu')) },
  { zav: 5, text: esc(tx('hra.vytopena_technicka_mistnost')) }
];
// ─── Katastrofy ──────────────────────────────────────────────────────────────
// Na rozdíl od běžné závady tohle technik nespraví: hoří, teče nebo někdo
// rozmlátil výlohu. Prádlomat stojí celý, oprava se platí a trvá dny. Stává se
// to nečekaně — v průměru jednou za pět a půl herního roku na stroj — ale bolí
// to, a proto jde provozovny pojistit (pojistné běží měsíčně, oprava pak stojí
// pětinu). U velké sítě to znamená několik škod do měsíce: čím víc strojů, tím
// častěji se něco semele, a pojištění se začne vyplácet samo.
var KATASTROFA_ROCNE = 0.18;       // průměrně jednou za 5,5 herního roku na stroj
// Oprava je podíl z ceny stroje. Požár bolí nejvíc, rozbitá výloha je spíš
// otrava — a i ta nejdražší škoda se dá splatit za pár herních měsíců provozu,
// aby jedna smůla neposlala začínajícího hráče ke dnu.
var KATASTROFY = [
  { t: esc(tx('hra.pozar')), ico: '\uD83D\uDD25', p: esc(tx('hra.od_pretizene_zasuvky_chytla_susicka')), dnu: 5, podil: 0.22 },
  { t: esc(tx('hra.vytopeni')), ico: '\uD83D\uDCA7', p: esc(tx('hra.praskl_privod_vody_a_vsechno')), dnu: 4, podil: 0.16 },
  { t: esc(tx('hra.vloupani')), ico: '\uD83D\uDD13', p: esc(tx('hra.v_noci_nekdo_vypacil_dvere')), dnu: 3, podil: 0.1 },
  { t: esc(tx('hra.vandalismus')), ico: '\uD83E\uDDF1', p: esc(tx('hra.rozbita_vyloha_posprejovane_stroje_a')), dnu: 2, podil: 0.05 },
  { t: esc(tx('hra.vichrice')), ico: '\uD83C\uDF2A\uFE0F', p: esc(tx('hra.vitr_strhl_strechu_pristresku_a')), dnu: 3, podil: 0.12 }
];
var POJISTNE_PODIL = 0.004;        // měsíční pojistné = 0,4 % ceny stroje
var POJISTENI_SPOLUUCAST = 0.2;    // s pojištěním platí hráč pětinu opravy
function jeVKatastrofe(u) { return !!(u && u.katastrofa); }
function katastrofy() { return (S.units || []).filter(jeVKatastrofe); }
// Měsíční pojistné za celou síť. Platí se jen když je pojištění zapnuté.
function pojisteniMesicne() {
  if (!S || !S.pojisteni) return 0;
  return Math.round((S.units || []).reduce(function (a, u) {
    return a + machinePrice(MODELS[(u.eco && u.eco.model) || 'mini']) * POJISTNE_PODIL;
  }, 0));
}
function hlidejKatastrofy(dt) {
  if (!(dt > 0)) return 0;
  var sance = Math.min(0.2, dt / (YEAR_MS / KATASTROFA_ROCNE));
  var ted = Date.now(), ztrata = 0;
  (S.units || []).forEach(function (u) {
    if (jeVKatastrofe(u) || Math.random() >= sance) return;
    var k = KATASTROFY[Math.floor(Math.random() * KATASTROFY.length)];
    var cena = Math.round(machinePrice(MODELS[(u.eco && u.eco.model) || 'mini']) * k.podil);
    var pojisteno = !!S.pojisteni;
    var platim = pojisteno ? Math.round(cena * POJISTENI_SPOLUUCAST) : cena;
    u.katastrofa = { od: ted, t: k.t, ico: k.ico, p: k.p, dnu: k.dnu, cena: cena, platim: platim,
      pojisteno: pojisteno, hotovo: null };
    u.vady = (u.vady || 0) + 1;
    ztrata += 0;
    zapisUpoz(tx('veta.pradlomat_stoji_dokud_se_neopravi', { p1: u.name, p2: k.t.toLowerCase() }), 'err');
    toast(tx('veta.pradlomat_stoji_oprava_stoji', { p1: u.name, p2: k.t, p3: kcFull(platim) })
      + (pojisteno ? ' ' + esc(tx('hra.zbytek_plati_pojistovna')) : ' ' + esc(tx('hra.pojisteny_nebyl'))), 'err', true);
  });
  return ztrata;
}
// Hráč opravu zaplatí, od té chvíle se pracuje a za pár dní stroj zase jede.
function zaplatOpravu(u) {
  var k = u.katastrofa;
  if (!k || k.hotovo) return;
  if (S.cash < k.platim) return toast(esc(tx('hra.na_opravu_nemas_dost_hotovosti')), 'err');
  S.cash -= k.platim;
  zapis('nakup', tx('veta.oprava', { p1: k.t, p2: (u.name || '') }), -k.platim);
  k.hotovo = Date.now() + k.dnu * (MONTH_MS / 30);   // herní den = 24 skutečných minut
  save(); paint(); drawMap(); syncState(true);
  toast(esc(tx('hra.oprava_zaplacena')) + ' ' + (u.name || esc(tx('hra.pradlomat_6'))) + ' pojede za '
    + etaText(k.hotovo - Date.now()).replace('za ', '') + '.', 'ok');
}
// Hotové opravy pustí stroj zpátky do provozu.
function hlidejOpravy() {
  var ted = Date.now(), zmena = false;
  (S.units || []).forEach(function (u) {
    var k = u.katastrofa;
    if (!k || !k.hotovo || ted < k.hotovo) return;
    delete u.katastrofa; zmena = true;
    toast(tx('veta.je_po_oprave_zase_v_provozu', { p1: (u.name || esc(tx('hra.pradlomat_8'))) }), 'ok');
  });
  if (zmena) { save(); paint(); drawMap(); }
}
function jeVPoruse(u) { return !!(u && u.porucha); }
// Kolik z plného provozu stroj zvládá, dokud není spravený.
function chodStroje(u) {
  if (jeVKatastrofe(u)) return 0;      // po požáru nebo vytopení nejede nic
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
    return m + ' ' + mn(m, esc(tx('hra.herni_mesic_2')), esc(tx('hra.herni_mesice')), esc(tx('hra.hernich_mesicu')));
  }
  if (ms >= MONTH_MS / 30) {
    var d = Math.max(1, Math.round(ms / (MONTH_MS / 30)));
    return d + ' ' + mn(d, esc(tx('hra.herni_den_2')), esc(tx('hra.herni_dny_2')), esc(tx('hra.hernich_dnu_2')));
  }
  var h = Math.max(1, Math.round(ms / HODINA_MS));
  return h + ' ' + mn(h, esc(tx('hra.herni_hodinu')), esc(tx('hra.herni_hodiny')), esc(tx('hra.hernich_hodin')));
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
      toast(tx('veta.stoji_a_prisel_jsi_o_posli', { p1: u.name, p2: z.text.toLowerCase(), p3: dobaProstoje(zpet), p4: kcFull(vypadek) }), 'err');
    } else {
      toast(tx('veta.posli_tam_technika', { p1: u.name, p2: z.text.toLowerCase() }), 'err');
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
  var letadlo = { kod: 'letadlo', nazev: tx('hra.zpusob_letecky'), znak: '✈',
    kmh: LETADLO_KMH, rezie: LETADLO_REZIE, silnice: false };
  if (pevnina(a) === pevnina(b)) {
    // Po vlastní ose jen do rozumné dálky. Přes půl kontinentu se letí a auto
    // si technik půjčí na místě — jinak by jediný výjezd trval týden.
    if (km > LETADLO_OD_KM) return letadlo;
    return { kod: 'auto', nazev: tx('hra.zpusob_autem'), znak: '🚐', kmh: TECHNIK_KMH, rezie: 0, silnice: true };
  }
  if (km <= TRAJEKT_MAX_KM) {
    return { kod: 'trajekt', nazev: tx('hra.zpusob_trajektem'), znak: '⛴', kmh: TECHNIK_KMH, rezie: TRAJEKT_REZIE, silnice: true };
  }
  return letadlo;
}
// Kolik hodin zabere cesta jedním směrem.
function cestaHodin(km, zp) {
  return zp.rezie + Math.max(0.5, km / zp.kmh);
}
// Jeden prádlomat je, dva jsou — ať věta nedrhne.
function zaMoremSlovy(n) {
  return n === 1 ? esc(tx('hra.jeden_pradlomat_mas')) : (n >= 2 && n <= 4 ? tx('veta.pradlomaty_mas', { p1: n }): tx('veta.pradlomatu_mas', { p1: n }));
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
  return tx('veta.p_class_fine_warn_style_margin_2', { p1: (v.zpusob.kod === 'letadlo' ? esc(tx('hra.musi_letet')) : 'jede trajektem'), p2: tx('veta.s_pobockou_v_jeho_okoli_by', { p1: etaText(vyjezdZblizka(u)).replace('za ', ''), p2: etaText(v.celkem).replace('za ', '') }) });
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
// `ticho` používá vedoucí servisu: když vyjede k třiceti strojům najednou,
// nemá hráči probliknout třicet hlášek — dostane jednu souhrnnou.
function vyslatTechnika(u, ticho) {
  if (!u || !jeVPoruse(u) || u.technik) return false;
  var v = vyjezdOdhad(u);
  if (!v) { toast(esc(tx('hra.nemas_zakladnu_odkud_technika_poslat_2')), 'err'); return false; }
  var ted = Date.now();
  u.technik = {
    z: { lat: v.zakladna.lat, lon: v.zakladna.lon, name: v.zakladna.name || esc(tx('hra.sidlo_2')) },
    km: Math.round(v.km), zpusob: v.zpusob.kod, start: ted, prijezd: ted + v.jizda,
    hotovo: ted + v.jizda + v.oprava, navrat: ted + 2 * v.jizda + v.oprava
  };
  save(); paint(); drawMap(); drawAuta(); syncState(true);
  nactiTrasu(u);
  if (!ticho) toast(tx('veta.technik_vyrazil_na_miste_bude', { p1: v.zpusob.nazev, p2: etaText(v.jizda) }), 'ok');
  return true;
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
      toast(tx('veta.je_spraveny_a_zase_vydelava', { p1: u.name }), 'ok');
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
  // Technik bez výchozího bodu nemá kudy jet. Dřív to spadlo na t.z.lat
  // a s ním celé vykreslení mapy — a to kvůli jednomu stroji.
  if (!t || !t.z || u.lat == null || t.z.lat == null) return null;
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
  if ((jePozemek(sp) || mamPozemek(sp.id)) && !jeZasitovane(sp)) base *= POZEMEK_STAVBA;
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
    popis: (vazba && vazba.popis) || esc(tx('hra.provozni_uver')),
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
  zapis('splatka', tx('veta.mimoradna_splatka', { p1: (l.popis || esc(tx('hra.uver_5'))) }), -dam);
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
  zapis('poplatek', tx('veta.zmena_splatnosti', { p1: (l.popis || esc(tx('hra.uver_4'))) }), -n.poplatek);
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
  return '<div class="kv"><span>' + esc(tx('hra.dalsi_splatka_2')) + '</span><b class="' + (ma ? 'ok' : 'err') + '">'
    + etaText(dalsiSplatkaZa()) + '</b></div>'
    + '<p class="fine' + (ma ? '' : ' err') + '">' + (ma
        ? tx('veta.do_te_doby_musi_byt_na_2', { p1: kcFull(kolik), p2: kcFull(S.cash) }): tx('veta.do_te_doby_musi_byt_na', { p1: kcFull(kolik), p2: kcFull(S.cash), p3: kcFull(kolik - S.cash), p4: esc(tx('hra.co_nezaplatis_pricte_se_k')) }))
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
// Objem, který si hráč smí z rámce vzít, odemykají balíčky. Bez nich platí
// strop zdarma; nejvyšší balíček strop ruší úplně. Načerpané peníze strop
// nikdy nebere — kdo je nad ním, splácí a teprve pod stropem čerpá dál.
var RAMEC = null;                 // { zdarma, uroven, strop, balicky } ze serveru
var RAMEC_ZDARMA = 5000000;
function ramecStrop() {
  if (!RAMEC) return RAMEC_ZDARMA;
  return RAMEC.strop === null ? null : (RAMEC.strop || RAMEC_ZDARMA);
}
// Limit po zastropování. Null strop = beze změny.
function podStropem(castka) {
  var st = ramecStrop();
  return st === null ? castka : Math.min(castka, st);
}
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
  var cerp = ramecCerpano();
  // Strop balíčku platí hned, ne až od příští revize limitu. Kdo je nad ním,
  // o načerpané peníze nepřijde — jen čerpá znovu, až se dostane pod strop.
  var zbyva = Math.max(0, podStropem(S.ramec.limit) - cerp);
  return Math.min(zbyva, stropPodleZisku(monthlyProfit() - splatkyMesicne(), zbyva));
}
// Základní limit podle historie a výdělku.
function ramecNavrh() {
  var podleHistorie = RAMEC_ZA_MISTO * Math.max(1, doplacenychMist() - 1);
  return Math.max(0, Math.round(podStropem(Math.min(podleHistorie,
    stropPodleZisku(monthlyProfit() - splatkyMesicne(), podleHistorie))) / 10000) * 10000);
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
  return { historie: podleHistorie, zisk: podleZisku, strop: ramecStrop(),
    cil: Math.round(podStropem(Math.min(podleHistorie, podleZisku)) / 10000) * 10000 };
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
    toast(esc(tx('hra.na_vic_to_ted_neni')) + ' ' + (sl.zisk < sl.historie
      ? esc(tx('hra.limit_drzi_vydelek_site_zvedni'))
      : esc(tx('hra.limit_drzi_historie_doplat_dalsi'))), 'err');
    return { zmena: 0, limit: stary };
  }
  if (Math.abs(novy - stary) < RAMEC_KROK) {
    if (rucne) toast(esc(tx('hra.banka_limit_prepocitala_a_nechala')), 'ok');
    save();
    return { zmena: 0, limit: stary };
  }
  S.ramec.limit = novy;
  save();
  if (novy > stary) {
    toast(tx('veta.banka_ti_zvedla_ramec_na', { p1: kcFull(novy), p2: kcFull(novy - stary) }), 'ok');
  } else {
    toast(tx('veta.banka_snizila_ramec_na_nacerpane_penize', { p1: kcFull(novy) }), 'err');
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
    if (S.ramec.slabyOd) { S.ramec.slabyOd = null; toast(esc(tx('hra.sit_je_zase_v_poradku')), 'ok'); }
    return;
  }
  if (!S.ramec.slabyOd) {
    S.ramec.slabyOd = Date.now();
    toast(tx('veta.na_svou_splatku_dokud_to_trva', { p1: slabych, p2: mn(slabych, esc(tx('hra.misto_nevydela')), esc(tx('hra.mista_nevydelaji')), esc(tx('hra.mist_nevydela'))) }), 'err');
    return;
  }
  if (Date.now() - S.ramec.slabyOd > RAMEC_LHUTA) {
    S.ramec.zavreny = Date.now();
    toast(esc(tx('hra.banka_ti_zavrela_ramec_sit')), 'err');
  }
}

// ─── Rizikoř ────────────────────────────────────────────────────────────────
// Má den ode dne jinou náladu a dá ji najevo hned, jak hráč vejde. Nálada je
// daná hráčem a herním měsícem, takže se nedá překlikat obnovením stránky —
// a nikdy neobejde tvrdá pravidla, hýbe jen cenou a ochotou.
var NALADY = [
  { id: 'vstricny', nazev: esc(tx('hra.vstricny_den')), slovo: esc(tx('hra.dneska_mam_dobry_den_tak')),
    sazba: -0.0015, castka: 1.05, splatnost: 1 },
  { id: 'bezny', nazev: esc(tx('hra.bezny_den')), slovo: esc(tx('hra.jedeme_podle_pravidel_nic_vic')),
    sazba: 0, castka: 1, splatnost: 0 },
  { id: 'prisny', nazev: esc(tx('hra.prisny_den')), slovo: esc(tx('hra.dneska_jsem_opatrny_tak_se')),
    sazba: 0.0015, castka: 0.95, splatnost: 0 },
  { id: 'audit', nazev: esc(tx('hra.po_auditu')), slovo: esc(tx('hra.mame_po_kontrole_drzim_se')),
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
  if (naladaDnes().id === 'audit') return esc(tx('hra.dneska_je_rizikor_po_auditu'));
  if (splacenych === 0) return esc(tx('hra.nemas_za_sebou_jediny_splaceny'));
  if (splacenych === 1 && i >= SPL_ZAKLAD + 2) return esc(tx('hra.s_jednim_splacenym_uverem_ti'));
  return esc(tx('hra.na_tuhle_splatnost_zatim_nedosahnes'));
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
    if (String(l.popis || '').indexOf(esc(tx('hra.misto_zruseno'))) < 0) l.popis = (l.popis || esc(tx('hra.uver_3'))) + ' ' + esc(tx('hra.misto_zruseno_2'));
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
function trafficMax() { return TRAFFIC_MAX + (S && S.boost ? S.boost : 0) + kampanAdd(); }
// Pověst z infolinky násobí výsledek až na konci — ať platí celý rozsah
// i tomu, kdo už má návštěvnost na stropu.
// ─── Ekonomika: konjunktura a krize ──────────────────────────────────────────
// Trh se vlní. Klidné roky střídají krize, kdy lidem dojdou peníze a do
// prádlomatů chodí míň zákazníků. Není to náhoda v prohlížeči — je to funkce
// času, takže všichni hráči jsou na tom ve stejnou chvíli stejně a dá se o tom
// bavit. Jak dlouho krize potrvá, ale nikdo dopředu neví: délka i hloubka se
// losují z času a během krize to navíc kolísá.
var KRIZE_BLOK = 1;                // jak často se losuje, jestli krize začne (herní roky)
var KRIZE_SANCE = 0.28;            // s jakou pravděpodobností v bloku začne
var KRIZE_DELKA_MIN = 0.5;         // nejkratší krize v herních letech (3 skutečné dny)
var KRIZE_DELKA_MAX = 2;           // nejdelší krize (12 skutečných dnů)
var KRIZE_DNO_MIN = 0.15;          // nejmírnější propad návštěvnosti
var KRIZE_DNO_MAX = 0.4;           // nejhorší propad
var KONJ_VLNA = 0.05;              // jak moc ekonomika dýchá i mimo krizi
var KRIZE_PRUM = null;             // dočasné přepsání při dopočtu nepřítomnosti

// ─── Sezóna ──────────────────────────────────────────────────────────────────
// Prát se nepřestane nikdy, ale ne každý měsíc stejně. Po Vánocích jsou lidi
// bez peněz a doma, v létě se perou ručníky a plavky a na podzim se chystá
// na svátky. Rozdíl mezi nejslabším a nejsilnějším měsícem je kolem 30 %,
// tedy zhruba ±15 % kolem průměru. Měsíce běží všem stejně — jsou odvozené
// z času, ne od toho, kdy kdo začal hrát.
var MESICE = ['leden', esc(tx('hra.unor')), esc(tx('hra.brezen')), 'duben', esc(tx('hra.kveten')), esc(tx('hra.cerven')),
  esc(tx('hra.cervenec')), 'srpen', esc(tx('hra.zari')), esc(tx('hra.rijen')), 'listopad', 'prosinec'];
var SEZONA = [0.86, 0.88, 0.94, 0.99, 1.02, 1.08, 1.13, 1.12, 1.07, 0.96, 1.03, 1.08];
// Normalizace: přes celý rok musí sezóna vyjít na jedničku, jinak by sama
// o sobě hru zlevnila nebo zdražila.
var SEZONA_PRUMER = SEZONA.reduce(function (a, b) { return a + b; }, 0) / SEZONA.length;
function hernoMesic(t) { return ((Math.floor(t / MONTH_MS) % 12) + 12) % 12; }
function sezonaV(t) { return SEZONA[hernoMesic(t)] / SEZONA_PRUMER; }

// Deterministický šum: ze stejného čísla vyleze vždycky stejné „náhodné" číslo,
// takže se krize nemusí nikde ukládat ani posílat — spočítá si ji každý sám.
function krizeSum(blok, sul) {
  var x = Math.imul(blok ^ (sul * 0x9e3779b9), 2654435761);
  x ^= x >>> 15; x = Math.imul(x, 2246822519);
  x ^= x >>> 13; x = Math.imul(x, 3266489917);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// Krize, která se losovala v daném bloku. Null = v tom bloku žádná nezačala.
function krizeBloku(i) {
  if (krizeSum(i, 1) >= KRIZE_SANCE) return null;
  var blokMs = KRIZE_BLOK * YEAR_MS;
  var od = i * blokMs + krizeSum(i, 2) * blokMs;
  var delka = (KRIZE_DELKA_MIN + krizeSum(i, 3) * (KRIZE_DELKA_MAX - KRIZE_DELKA_MIN)) * YEAR_MS;
  var dno = KRIZE_DNO_MIN + krizeSum(i, 4) * (KRIZE_DNO_MAX - KRIZE_DNO_MIN);
  return { od: od, do: od + delka, delka: delka, dno: dno };
}
// Jak hluboko je ekonomika v daný okamžik. 1 = normál, 0,6 = o 40 % míň lidí.
function ekonomikaV(t) {
  var blokMs = KRIZE_BLOK * YEAR_MS;
  var i = Math.floor(t / blokMs);
  var nejhorsi = null;
  // Krize může přesahovat do dalších bloků, proto se díváme i dozadu.
  for (var k = i - 3; k <= i; k++) {
    var kr = krizeBloku(k);
    if (!kr || t < kr.od || t >= kr.do) continue;
    if (!nejhorsi || kr.dno > nejhorsi.dno) nejhorsi = kr;
  }
  // I v dobrých časech to trochu dýchá — nikdy to není rovná čára.
  var dech = 1 + KONJ_VLNA * Math.sin(t / (0.37 * YEAR_MS));
  var sez = sezonaV(t), mes = hernoMesic(t);
  if (!nejhorsi) {
    return { koef: dech * sez, krize: false, hloubka: 0, sezona: sez, mesic: mes };
  }
  // Propad nenastoupí ze dne na den: nabíhá, drží se u dna a zase povoluje.
  // Uvnitř krize to kolísá, takže se nedá odhadnout, kdy je nejhůř.
  var u = (t - nejhorsi.od) / nejhorsi.delka;
  var tvar = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.6);
  var vlna = 1 + 0.22 * Math.sin(t / (0.11 * YEAR_MS) + nejhorsi.od);
  var pokles = Math.max(0, Math.min(0.45, nejhorsi.dno * tvar * vlna));
  return { koef: Math.max(0.3, dech - pokles) * sez, krize: pokles > 0.03, hloubka: pokles,
    sezona: sez, mesic: mes };
}
// Průměr za delší úsek — podle toho se dopočítá nepřítomnost, aby se krize
// nedala přečkat tím, že hráč hru prostě zavře.
function krizePrumer(od, doKdy) {
  if (!(doKdy > od)) return ekonomikaV(doKdy).koef;
  var vzorku = Math.max(2, Math.min(64, Math.ceil((doKdy - od) / (YEAR_MS / 24))));
  var sum = 0;
  for (var j = 0; j < vzorku; j++) sum += ekonomikaV(od + (doKdy - od) * (j + 0.5) / vzorku).koef;
  return sum / vzorku;
}
function ekonomika() { return ekonomikaV(Date.now()); }

// ─── Světové události ────────────────────────────────────────────────────────
// Povodeň v Česku, festival v Brně, zdražení energií. Vyhlašuje je server
// jednou pro celý svět a platí tam, kde platí — ne tomu, komu patří. Hra si
// z nich vybere ty, které se týkají jejích míst, a dopad si spočítá sama.
var UDALOSTI = null;               // { bezi: [...], konec: [...] } ze serveru
var UDAL_OKNO = null;              // { od, do } při dopočtu nepřítomnosti
var UDAL_OCHRANA = 5;              // do kolika prádlomatů se negativní události vyhýbají
var UDAL_DNO = 0.45;               // pod tohle návštěvnost kvůli událostem neklesne
var UDAL_STROP = 1.8;              // a nad tohle nevyskočí
function loadUdalosti(then) {
  return api('/udalosti').then(function (r) {
    UDALOSTI = (r.ok && r.j) || { bezi: [], konec: [] };
    if (then) then();
  }).catch(function () { UDALOSTI = UDALOSTI || { bezi: [], konec: [] }; if (then) then(); });
}
// Týká se událost tohohle místa?
function udalostPlatiNa(e, areaId) {
  if (!e.mesta) return true;                     // celý svět
  return e.mesta.indexOf(areaId) >= 0;
}
// Nováčka pohromy míjejí — ať se má čas postavit na nohy.
function udalostProMe(e) {
  if (e.dobra) return true;
  return (S.units || []).length >= UDAL_OCHRANA;
}
// Kolik mých prádlomatů událost zasáhla.
function udalostKolikMych(e) {
  if (!udalostProMe(e)) return 0;
  return (S.units || []).filter(function (u) { return udalostPlatiNa(e, u.areaId); }).length;
}
// Nová událost u mých provozoven se ohlásí. Dvakrát se neohlásí.
function hlidejUdalosti() {
  if (!S || !UDALOSTI) return;
  S.udalostiVim = S.udalostiVim || [];
  var nove = (UDALOSTI.bezi || []).filter(function (e) {
    return S.udalostiVim.indexOf(e.id) < 0 && udalostKolikMych(e) > 0;
  });
  (UDALOSTI.bezi || []).forEach(function (e) {
    if (S.udalostiVim.indexOf(e.id) < 0) S.udalostiVim.push(e.id);
  });
  S.udalostiVim = S.udalostiVim.slice(-200);
  if (!nove.length) return;
  var e = nove[0];
  var kolik = udalostKolikMych(e);
  toast(tx('veta.zasahuje', { p1: e.ikona, p2: udalNazev(e), p3: udalKde(e), p4: kolik, p5: mn(kolik, esc(tx('hra.tvuj_pradlomat')), esc(tx('hra.tvoje_pradlomaty')), esc(tx('hra.tvych_pradlomatu'))), p6: (nove.length > 1 ? tx('veta.a_dalsi_udalost', { p1: (nove.length - 1) }) : '') }),
    e.dobra ? 'ok' : 'err', true);
  save();
}
// Laundromat News: co se děje ve světě a co z toho se mě týká.
// Název a popis události skládá hra, ne server: odpověď o událostech je
// společná pro celý svět a cachuje se, takže by v ní byl jeden jazyk pro
// všechny. Podle typu si text vezme z katalogu; u starých událostí, které
// typ ještě nemají, zůstane to, co přišlo ze serveru.
function udalNazev(e) {
  var k = 'udalost.' + (e.typ || '') + '.nazev';
  var v = e.typ ? tx(k) : null;
  return (v && v !== k) ? v : (e.nazev || '');
}
function udalPopis(e) {
  var k = 'udalost.' + (e.typ || '') + '.popis';
  var v = e.typ ? tx(k) : null;
  return (v && v !== k) ? v : (e.popis || '');
}
function udalKde(e) {
  return e.uroven === 'svet' ? tx('udalost.cely_svet') : (e.kde || '');
}
function udalostiHtml() {
  if (!UDALOSTI) return '';
  var bezi = (UDALOSTI.bezi || []).slice().sort(function (a, b) {
    return udalostKolikMych(b) - udalostKolikMych(a) || b.zavaznost - a.zavaznost;
  });
  var radek = function (e, skoncila) {
    var kolik = udalostKolikMych(e);
    var d = e.dopad || {};
    var ucinky = [];
    if (d.navstevnost) ucinky.push((d.navstevnost > 0 ? '+' : '')
      + tx('veta.navstevnost', { p1: Math.round(d.navstevnost * 100) }));
    if (d.naklady) ucinky.push((d.naklady > 0 ? '+' : '')
      + tx('veta.provozni_naklady', { p1: Math.round(d.naklady * 100) }));
    return '<div class="udal' + (e.dobra ? ' dobra' : '') + (kolik ? ' moje' : '')
      + (skoncila ? ' konec' : '') + '">'
      + '<div class="udal-h"><i>' + e.ikona + '</i>'
      + '<div><b>' + esc(udalNazev(e)) + '</b><span>' + esc(udalKde(e))
      + (skoncila ? ' ' + esc(tx('hra.skoncilo')) : tx('udalost.jeste', { p1: etaText(Number(new Date(e.do)) - Date.now()) }))
      + '</span></div>'
      + (kolik ? '<em>' + kolik + '\u00d7</em>' : '') + '</div>'
      + '<p class="muted small">' + esc(udalPopis(e)) + '</p>'
      + (ucinky.length ? '<p class="fine ' + (e.dobra ? 'ok' : 'warn') + '">'
          + ucinky.join(' · ') + (kolik ? '' : ' ' + esc(tx('hra.tebe_se_to_netyka'))) + '</p>' : '')
      + '</div>';
  };
  var mych = bezi.filter(function (e) { return udalostKolikMych(e) > 0; }).length;
  return '<div class="card"><div class="row"><h3>' + esc(tx('hra.co_se_deje_ve_svete')) + '</h3>'
    + (mych ? '<b class="warn">' + mych + '\u00d7 u tebe</b>' : '') + tx('veta.div_p_class_muted_small_style_2')
    + ((S.units || []).length < UDAL_OCHRANA
        ? tx('hra.dokud_nemas_pradlomatu_pohromy_se_ti', { p1: UDAL_OCHRANA })
        : '') + '</p>'
    + (bezi.length ? bezi.map(function (e) { return radek(e, false); }).join('')
      : '<p class="muted small">' + esc(tx('hra.ted_je_ve_svete_klid')) + '</p>')
    + ((UDALOSTI.konec || []).length
        ? '<h3 style="margin-top:16px">' + esc(tx('hra.nedavno_skoncilo')) + '</h3>'
          + UDALOSTI.konec.slice(0, 5).map(function (e) { return radek(e, true); }).join('')
        : '')
    + '</div>';
}
function udalostiMista(areaId) {
  return ((UDALOSTI && UDALOSTI.bezi) || []).filter(function (e) {
    return udalostProMe(e) && udalostPlatiNa(e, areaId);
  });
}
// Jak dlouho byla událost v daném okně aktivní, v poměru k délce okna.
function udalostPodil(e, od, doKdy) {
  var a = Math.max(od, Number(new Date(e.od)));
  var b = Math.min(doKdy, Number(new Date(e.do)));
  if (!(b > a)) return 0;
  return (b - a) / (doKdy - od);
}
// Koeficienty pro jedno místo: návštěvnost a náklady. Při dopočtu nepřítomnosti
// se váží dobou, po kterou událost v tom období opravdu běžela.
function udalostKoef(areaId) {
  var navst = 1, nakl = 1;
  var vse = ((UDALOSTI && UDALOSTI.bezi) || []).concat((UDALOSTI && UDALOSTI.konec) || []);
  for (var i = 0; i < vse.length; i++) {
    var e = vse[i];
    if (!udalostProMe(e) || !udalostPlatiNa(e, areaId)) continue;
    var vaha = 1;
    if (UDAL_OKNO) {
      vaha = udalostPodil(e, UDAL_OKNO.od, UDAL_OKNO.do);
      if (!vaha) continue;
    } else if (Number(new Date(e.do)) <= Date.now()) continue;   // doběhlé teď neplatí
    var d = e.dopad || {};
    navst *= 1 + (Number(d.navstevnost) || 0) * vaha;
    nakl *= 1 + (Number(d.naklady) || 0) * vaha;
  }
  return { navstevnost: Math.max(UDAL_DNO, Math.min(UDAL_STROP, navst)),
    naklady: Math.max(0.5, Math.min(2, nakl)) };
}
// Když se ekonomika zlomí, ať to hráč nezjistí až z toho, že mu klesly tržby.
function hlidejKrizi() {
  var e = ekonomika();
  var bylo = !!(S && S.vKrizi);
  if (e.krize === bylo) return;
  S.vKrizi = e.krize;
  if (e.krize) {
    toast(tx('veta.prisla_ekonomicka_krize_lidem_dochazeji_penize', { p1: Math.round(e.hloubka * 100) }), 'err', true);
  } else {
    toast(esc(tx('hra.krize_je_zazehnana_zakaznici_se')), 'ok', true);
  }
}
// Jak si ekonomika stojí — bez prozrazení, kdy to skončí.
function ekonomikaHtml() {
  var e = ekonomika();
  var pct = Math.round(e.hloubka * 100);
  var nad = Math.round((e.koef - 1) * 100);
  var sez = Math.round((e.sezona - 1) * 100);
  return '<div class="card"><div class="row"><h3>' + esc(tx('hra.ekonomika')) + '</h3>'
    + '<b class="' + (e.krize ? 'err' : nad >= 0 ? 'ok' : 'warn') + '">'
    + (e.krize ? 'krize' : nad > 1 ? 'konjunktura' : 'klid') + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.herni_mesic')) + '</span><b>' + MESICE[e.mesic] + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.sezona')) + '</span><b class="' + (sez >= 0 ? 'ok' : 'warn') + '">'
    + (sez > 0 ? '+' : '') + sez + ' %</b></div>'
    + (e.krize ? '<div class="kv"><span>' + esc(tx('hra.krize')) + '</span><b class="err">' + '−'
        + Math.round(e.hloubka * 100) + ' %</b></div>' : '')
    + '<div class="kv souhrn"><span>' + esc(tx('hra.navstevnost_oproti_normalu')) + '</span><b class="'
    + (e.koef >= 1 ? 'ok' : 'err') + '">' + (nad > 0 ? '+' : '') + nad + ' %</b></div>'
    + '<p class="fine">' + (e.krize
        ? tx('hra.zakazniku_ubylo_o_dno_ani_konec', { p1: pct })
        : tx('hra.trh_je_v_poradku_krize_prichazeji'))
    + tx('veta.v_lednu_a_unoru_se_pere');
}
function krizeKoef() { return KRIZE_PRUM != null ? KRIZE_PRUM : ekonomika().koef; }

// Reklamní kampaň. Na rozdíl od staré trvalé karty (ta sedí v S.boost) běží
// jen do data a pak sama zmizí — nic se nemaže, jen se přestane počítat.
// Běží vždycky jedna: koupě další ji nahradí, takže se nedá naskládat
// libovolně velký náskok, který by rozhodil žebříček i hodnosti.
// Kampaň jde mít i na předplatné. Pak o ní nerozhoduje datum ve stavu hry,
// ale to, co o předplatném říká server — klient si ji nesmí odkývat sám.
var KAMPAN_SUB = { kampan10: 'kampan_sub10', kampan15: 'kampan_sub15', kampan25: 'kampan_sub25' };
var KAMPAN_SUB_ADD = { kampan_sub10: 0.10, kampan_sub15: 0.15, kampan_sub25: 0.25 };
function kampanPredplatne() {
  var ted = Date.now();
  return (PREDPLATNE || []).filter(function (x) {
    return /^kampan_sub/.test(x.kind) && (!x.plati_do || new Date(x.plati_do).getTime() > ted);
  })[0] || null;
}
function kampanJednorazova() {
  return !!(S && S.kampan && S.kampan.do > Date.now() && S.kampan.add > 0);
}
function kampanBezi() { return !!kampanPredplatne() || kampanJednorazova(); }
// Když by hráč měl obojí, platí to silnější — zaplatil si obě.
function kampanAdd() {
  var p = kampanPredplatne();
  return Math.max(p ? (KAMPAN_SUB_ADD[p.kind] || 0) : 0,
    kampanJednorazova() ? (Number(S.kampan.add) || 0) : 0);
}
function kampanZbyva() { return kampanJednorazova() ? S.kampan.do - Date.now() : 0; }
// Návštěvnost bez kampaně. Je to podíl kolemjdoucích, kteří k prádlomatu
// opravdu zajdou: základ 45 %, každý přivedený hráč +5 bodů, strop 110 %.
// Pověst a krize násobí až výsledek, takže se do poměru nepromítnou.
function navstevnostBez() {
  var boost = (S && S.boost) ? S.boost : 0;
  var refs = (S && S.refs) ? S.refs : 0;
  return Math.min(TRAFFIC_MAX + boost, TRAFFIC_BASE + refs * TRAFFIC_PER_REF + boost);
}
// O kolik procent vyrostou tržby, když návštěvnost povyskočí o add.
// Tržba je přímo úměrná návštěvnosti, takže je to prostý poměr — a je vyšší
// než číslo v názvu balíčku: +25 bodů ze 45 % je o víc než polovinu nahoru.
function kampanTrzby(add) {
  var z = navstevnostBez();
  return z > 0 ? Math.round(add / z * 100) : 0;
}
// Týden v hodinách („za 168 h") nikdo nečte. Nad dva dny mluvíme ve dnech.
function zbyvaDnyText(ms) {
  if (ms >= 2 * 86400000) return tx('hra.zbyva_dni', { n: Math.round(ms / 86400000) });
  return etaText(ms);
}
function kampanAuto() { return !!(S && S.kampanAuto); }
function nastavKampanAuto(zap) {
  if (!S) return;
  S.kampanAuto = zap ? 1 : 0;
  save(); syncState(true);
}
// Spustí kampaň. Vrací true, když se opravdu spustila.
function spustKampan(add, dnu) {
  add = Number(add) || 0;
  var dny = Math.max(1, Number(dnu) || 7);
  if (!(add > 0)) return false;
  S.kampan = { add: add, do: Date.now() + dny * 86400000, od: Date.now() };
  save(); paint(); refreshUnits();
  return true;
}
function traffic() {
  var t = Math.min(trafficMax(),
    TRAFFIC_BASE + (S && S.refs ? S.refs : 0) * TRAFFIC_PER_REF
      + (S && S.boost ? S.boost : 0) + kampanAdd());
  return t * povestKoef() * krizeKoef();
}
// Servis, praní a úklid se platí z obratu - cim vic lidi pere, tim vic prace.
function economics(spot, modelKey, podil) {
  var m = MODELS[modelKey] || MODELS.flex;
  // Druhý a třetí prádlomat na stejném pozemku si zákazníky nepřivede — dělí se
  // o ty, co tam chodí tak jako tak. Proto bere menší podíl.
  // Kolik lidí místo nabídne a kolik z nich tenhle stroj pobere. Zbytek odejde.
  var poptavka = poptavkaMista(spot.score) * (podil == null ? 1 : podil);
  var obslouzi = Math.min(m.kapacita, poptavka);
  var perday = obslouzi * traffic();
  var revenue = Math.round(perday * 30.5 * m.spend * EUR);
  var energy = Math.round(revenue * ENERGY_SHARE);
  var servis = Math.round(revenue * SERVIS_SHARE);
  // Co je domluvené, to se platí: vyjednaný nájem i nájem za cizí pozemek.
  // Na vlastní zemi se neplatí nic.
  var sml = (S.leases && S.leases[spot.id]) || null;
  // Koupenou zem bereme jako vlastní navždy, i kdyby se podíl pozemků v
  // nastavení hry změnil — jinak by hráč začal platit nájem sám sobě.
  var rent = sml ? Math.round(sml.rent || 0)
    : ((jePozemek(spot) || mamPozemek(spot.id)) ? 0 : rentOf(spot));
  var cost = energy + servis + rent;
  var profit = revenue - cost;
  var conn = connPrice(spot, m.key);
  var inv = machinePrice(m) + conn;
  return { model: m.key, invest: inv, machine: machinePrice(m), install: conn, conn: conn,
    podil: podil == null ? 1 : podil,
    energy: energy, servis: servis, rent: rent, revenue: revenue, cost: cost, profit: profit,
    perday: Math.round(perday * 10) / 10,
    poptavka: Math.round(poptavka * 10) / 10, kapacita: m.kapacita,
    payback: profit > 0 ? inv / (profit * 12) : null };
}

// ─── Profily hráče ───────────────────────────────────────────────────────────
var PROFILES = {
  opatrny: { id: 'opatrny', name: esc(tx('hra.opatrny_stavitel')), cash: 1500000, ltv: 0.70, rate: 0.096,
    desc: esc(tx('hra.nerad_dluzis_banka_ti_proto')) },
  vyvazeny: { id: 'vyvazeny', name: esc(tx('hra.vyvazeny_podnikatel')), cash: 1400000, ltv: 0.85, rate: 0.114,
    desc: esc(tx('hra.riziko_beres_jako_nastroj_ne')) },
  dravy: { id: 'dravy', name: esc(tx('hra.dravy_expanzista')), cash: 1300000, ltv: 1.00, rate: 0.132,
    desc: esc(tx('hra.chces_rust_rychle_a_na')) }
};
var QUIZ = [
  { q: esc(tx('hra.mas_1_000_000_l')),
    a: [[esc(tx('hra.pockam_az_nasetrim_celou_castku')), 'opatrny'],
        [esc(tx('hra.vezmu_si_mensi_uver_a')), 'vyvazeny'],
        [esc(tx('hra.vezmu_maximalni_uver_a_hned')), 'dravy']] },
  { q: esc(tx('hra.nasel_jsi_misto_se_skore')),
    a: [[esc(tx('hra.ne_hledam_dal_dokud_nenajdu')), 'opatrny'],
        [esc(tx('hra.postavim_ale_mensi_variantu_mini')), 'vyvazeny'],
        [esc(tx('hra.postavim_hned_to_velke_cas')), 'dravy']] },
  { q: esc(tx('hra.sit_vydelava_co_s_penezi')),
    a: [[esc(tx('hra.splatim_uver_do_posledniho_halere')), 'opatrny'],
        [esc(tx('hra.pulku_na_splatky_pulku_na')), 'vyvazeny'],
        [esc(tx('hra.vsechno_zpatky_do_expanze')), 'dravy']] }
];

// ─── Stav hry ────────────────────────────────────────────────────────────────
var HRA_NAZEV = esc(tx('hra.laundromat_tycoon'));
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
    hovorLog: [],     // evidence hovorů — kdo volal a jak to dopadlo
    linkaDo: 0,       // dokud běží infolinka, bere operátor všechny hovory
    linkaAuto: 0,     // u nákupu balíčku brát rovnou předplatné, co se obnovuje
    linkaStop: 0,     // pozastavená linka: hovory bere hráč, čas se nespotřebovává
    linkaZbytek: 0,   // zmrazený zbytek času, dokud linka stojí
    pojisteni: false, // pojištění provozoven proti požáru, vytopení a vloupání
    vKrizi: false,    // byla ekonomika v krizi, když se hra naposled počítala
    udalostiVim: [],  // ohlášené světové události — ať se nehlásí dvakrát
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
        o.loans.push({ id: 'u-stary', druh: 'stary', spotId: null, popis: esc(tx('hra.drivejsi_dluh')),
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
    if (!Array.isArray(o.hovorLog)) o.hovorLog = [];
    delete o.snyRezie;     // agenda snů zrušena — nikdo za ni dál neplatí
    if (!o.offPovest || typeof o.offPovest !== 'object') o.offPovest = { den: '', body: 0 };
    // Infolinka se platí na čas. Komu zbyly kredity ze starých balíčků,
    // dostane za ně týden — jednou, při prvním otevření po změně.
    if (typeof o.linkaDo !== 'number') o.linkaDo = 0;
    if (typeof o.linkaZbytek !== 'number') o.linkaZbytek = 0;
    if (typeof o.linkaStop !== 'number') o.linkaStop = 0;
    if (typeof o.linkaAuto !== 'number') o.linkaAuto = 0;
    if (typeof o.kampanAuto !== 'number') o.kampanAuto = 0;
    if (!o.kampan || typeof o.kampan !== 'object'
      || typeof o.kampan.do !== 'number' || typeof o.kampan.add !== 'number') o.kampan = null;
    if ((o.linka || 0) > 0 && !o.linkaPrevod) {
      o.linkaDo = Math.max(o.linkaDo, Date.now() + LINKA_PREVOD_MS);
      o.linka = 0; o.linkaPrevod = 1;
    }
    delete o.linkaSam;
    if (typeof o.pojisteni !== 'boolean') o.pojisteni = false;
    // Sídlo z doby, kdy se nestěhovalo, nemá datum. Bereme založení firmy —
    // kdo hraje dýl než tři herní roky, může se stěhovat hned.
    if (o.sidlo && !o.sidlo.od) o.sidlo.od = o.startedAt || Date.now();
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
        o.sidlo = { name: (ob && ob.name) || prvni.name || esc(tx('hra.sidlo_3')),
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
  if (ms <= 0) return esc(tx('hra.prave_ted'));
  var mins = Math.max(1, Math.round(ms / 60000));   // zaokrouhlíme až minuty, jinak vyjde „23 h 60 min"
  var h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 1) return m ? tx('hra.za_h_min', { p1: h, p2: m }) : tx('hra.za_h', { p1: h });
  return tx('hra.za_min', { p1: m });
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
    var poptavka = poptavkaMista(u.score) * (u.eco.podil == null ? 1 : u.eco.podil);
    // Co se zrovna děje tam, kde stroj stojí: povodeň, festival, zdražení energií.
    var ud = udalostKoef(u.areaId);
    u.eco.udalost = Math.round(ud.navstevnost * 1000) / 1000;
    u.eco.udalostNaklady = Math.round(ud.naklady * 1000) / 1000;
    var perday = Math.min(m.kapacita, poptavka) * traffic() * ud.navstevnost;
    var plne = Math.round(perday * 30.5 * m.spend * EUR);
    u.eco.poptavka = Math.round(poptavka * 10) / 10;
    u.eco.kapacita = m.kapacita;
    // Porouchaný stroj nevydělává (nebo jen půlku), ale servis a nájem běží dál.
    // Z výjezdů technika se platí právě ten servisní poplatek, takže ten
    // počítáme pořád z plného obratu. Energie jde dolů s tím, co opravdu běží.
    var chod = chodStroje(u);
    var revenue = Math.round(plne * chod);
    u.eco.chod = chod;
    u.eco.perday = Math.round(perday * chod * 10) / 10;
    u.eco.revenue = revenue;
    // Zdražení energií i levnější proud jdou do provozních nákladů.
    u.eco.energy = Math.round(revenue * ENERGY_SHARE * ud.naklady);
    u.eco.servis = Math.round(plne * SERVIS_SHARE * ud.naklady);
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
function cistyZisk() { return monthlyProfit() - splatkyMesicne() - pobockyMesicne() - cetaMesicne() - pojisteniMesicne(); }
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
  nakup: { nazev: esc(tx('hra.nakupy_a_stavba')), kat: 'nakup' },
  pruzkum: { nazev: esc(tx('hra.pruzkum')), kat: 'provoz' },
  poplatek: { nazev: esc(tx('hra.poplatky')), kat: 'provoz' },
  provoz: { nazev: esc(tx('hra.provoz_site')), kat: 'provoz' },
  uver: { nazev: esc(tx('hra.z_banky')), kat: 'banka' },
  splatka: { nazev: esc(tx('hra.splatky_3')), kat: 'banka' },
  prijem: { nazev: esc(tx('hra.prijmy_2')), kat: 'prijem' },
  sen: { nazev: esc(tx('hra.splnene_sny')), kat: 'nakup' }
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
  if (Math.round(b.provoz)) zapis('provoz', esc(tx('hra.provoz_site_za_mesic')), b.provoz);
  if (Math.round(b.splatky)) zapis('splatka', esc(tx('hra.splatky_uveru_za_mesic')), b.splatky);
}
// Kdo hrál dřív, než se kniha začala vést, dostane začátek dopočítaný z toho,
// co ve hře stojí. U těchhle řádků neznáme zůstatek ani rozdělení na hotovost
// a úvěr, proto jsou označené jako dopočítané.
function dopocitejKnihu(o) {
  var k = [], p = PROFILES[o.profile];
  if (p) k.push({ t: o.startedAt, d: 'prijem', p: esc(tx('hra.startovni_kapital')), c: Math.round(p.cash), r: 1 });
  (o.units || []).forEach(function (u) {
    var m = MODELS[u.eco && u.eco.model];
    k.push({ t: u.builtAt || o.startedAt, d: 'nakup', r: 1,
      p: tx('veta.pradlomat_2', { p1: (u.name || esc(tx('hra.misto_6'))), p2: (m ? ' (' + m.name + ')' : '') }),
      c: -Math.round((u.eco && u.eco.invest) || 0) });
  });
  (o.pobocky || []).forEach(function (b) {
    k.push({ t: b.od || o.startedAt, d: 'nakup', p: tx('veta.pobocka_7', { p1: (b.name || '') }), c: -POBOCKA_CENA, r: 1 });
  });
  if (o.ceta) k.push({ t: o.ceta.od || o.startedAt, d: 'nakup', p: esc(tx('hra.stavebni_technika_2')), c: -CETA_CENA, r: 1 });
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
  return tx('veta.rok', { p1: tx('veta.mesic', { p1: (Math.floor(m / 12) + 1), p2: (m % 12 + 1) }) });
}
function knihaRadek(r) {
  var kl = r.c > 0 ? 'ok' : 'err';
  return '<div class="kn-radek"><i class="kn-tecka ' + knihaKat(r.d) + '"></i>'
    + '<span><b>' + esc(r.p) + '</b><i>' + datumCas(r.t)
    + (r.u ? tx('veta.z_toho_uver', { p1: kcFull(r.u) }): '')
    + (r.v ? tx('veta.vzniklo', { p1: datumCas(r.v) }) : '')
    + (r.r ? ' ' + esc(tx('hra.dopocitano')) : (r.z != null ? tx('veta.zustatek', { p1: kcFull(r.z) }): '')) + '</i></span>'
    + '<b class="' + kl + '">' + (r.c > 0 ? '+' : '−') + kcFull(Math.abs(r.c)) + '</b></div>';
}
var KNIHA_FILTR = 'vse';
var KNIHA_FILTRY = [
  { k: 'vse', n: esc(tx('hra.vse')) }, { k: 'nakup', n: esc(tx('hra.nakupy')) }, { k: 'provoz', n: esc(tx('hra.provoz')) },
  { k: 'banka', n: esc(tx('hra.banka')) }, { k: 'prijem', n: esc(tx('hra.prijmy_3')) }
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
    bezi = '<div class="kn-bezi"><b>' + esc(tx('hra.rozepsany_mesic')) + '</b>'
      + '<span>Provoz <i class="' + (b.provoz >= 0 ? 'ok' : 'err') + '">'
      + (b.provoz >= 0 ? '+' : '−') + kcFull(Math.abs(Math.round(b.provoz))) + '</i></span>'
      + (Math.round(b.splatky) ? '<span>' + esc(tx('hra.splatky_2')) + ' ' + '<i class="err">−'
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
  sheet(tx('veta.h3_h3_p_class_muted_small_16', { p1: esc(tx('hra.ucetni_kniha')), p2: esc(tx('hra.prijmy')), p3: kc(prijmy), p4: CUR, p5: esc(tx('hra.vydaje')), p6: kc(vydaje), p7: CUR, p8: kc(S.cash), p9: CUR, p10: bezi }) + KNIHA_FILTRY.map(function (f) {
        return '<button class="' + (f.k === KNIHA_FILTR ? 'on' : '') + '" data-knf="' + f.k + '">'
          + f.n + '</button>';
      }).join('') + '</div>'
    + (html ? '<div class="kn">' + html + '</div>'
            : '<div class="empty">' + esc(tx('hra.v_tomhle_obdobi_nic_neni')) + '</div>')
    + (S.knihaOd
        ? tx('hra.p_class_fine_style_margin_top')
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
    + tx('veta.div_class_row_h3_h3_b', { p1: esc(tx('hra.ucetni_kniha_2')), p2: vse.length, p3: esc(tx('hra.prijmy_celkem')), p4: kcFull(prijmy), p5: esc(tx('hra.vydaje_celkem')), p6: kcFull(vydaje) });
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
  var now = Date.now();
  var dt = now - S.lastTick;
  if (dt < 0) { S.lastTick = now; refreshUnits(); return; }  // přetočené hodiny v telefonu
  if (dt > 30 * YEAR_MS) dt = 30 * YEAR_MS;      // po měsíci nepřítomnosti dál nenabíhá
  // Za dobu, co byl hráč pryč, se počítá s průměrnou ekonomikou toho období —
  // jinak by stačilo krizi přesedět se zavřenou hrou.
  KRIZE_PRUM = dt > 60000 ? krizePrumer(now - dt, now) : null;
  UDAL_OKNO = dt > 60000 ? { od: now - dt, do: now } : null;
  refreshUnits();
  var years = dt / YEAR_MS;
  // Poruchy se řeší dřív, než se spočítá výnos: stroj, který praskl někdy
  // uprostřed doby, co byl hráč pryč, od té chvíle nevydělával. Jinak by byla
  // nepřítomnost zadarmo a porucha by začala až návratem.
  var ztrataPoruch = hlidejPoruchy(dt);
  hlidejKatastrofy(dt);
  hlidejOpravy();
  // Pobočky i četa stojí každý měsíc bez ohledu na to, jestli se staví.
  var earned = (yearlyProfit() - (pobockyMesicne() + cetaMesicne() + pojisteniMesicne()) * 12) * years - ztrataPoruch;
  // Do bubliny nad prádlomaty: zvlášť co přiteklo a co banka sebrala.
  drip.earn += Math.max(0, earned);
  S.cash += earned;
  knihaProvoz(earned, 'provoz');
  S.stats.earned += Math.max(0, earned);
  S.bank = Math.min(bankCap(), S.bank + BANK_PER_DAY * (dt / 86400000));
  S.lastTick = now;
  KRIZE_PRUM = null; UDAL_OKNO = null;
  refreshUnits();              // zpátky na dnešní ekonomiku, ať čísla sedí s tím, co je teď
  hlidejKrizi();
  hlidejHodnost();
  hlidejHvezdy();
  linkaOffline(dt);            // co se na infolince stalo, než se hráč vrátil
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
  hlidejDispecer();
  dispecerKolo();
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
    var kolik = Math.floor(drip.earn), txt = '+' + tCislo(kolik);
    var p = naMape && S.units.length ? dripPoint(drip.i++) : null;
    if (p) dripShow(txt, 'up', p);
    drip.earn -= kolik;
  }
  if (drip.pay >= 1) {
    var kolikP = Math.floor(drip.pay), txtP = '−' + tCislo(kolikP);
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
  headDrip((zmena > 0 ? '+' : '−') + tCislo(Math.abs(zmena)),
    zmena > 0 ? 'up' : 'down');
}
function gameYear() { return Math.floor((Date.now() - S.startedAt) / YEAR_MS) + 1; }

// ─── Pomůcky ─────────────────────────────────────────────────────────────────
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// Zkrácená částka. Zásadní je, že zaokrouhlení nesmí přetéct do dalšího řádu —
// 999 800 se zaokrouhlí na tisíc tisíců a to se nepíše, to je milion.
// Desetinná čárka je česká věc, angličtina píše tečku. Zkratky řádů taky:
// 'tis.' není 'k' jen jinak napsané, je to jiné slovo a patří do katalogu.
function des(x, mist) { return tCislo2(x.toFixed(mist)); }
function desZnak() { return JAZYK === 'en' ? '.' : ','; }
function tCislo2(s) { return String(s).replace('.', desZnak()); }
function kc(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) < 1e4) return tCislo(n);
  var tis = Math.round(n / 1e3);
  if (Math.abs(tis) < 1000) return tx('obecne.tisic', { p1: tis });
  var mil = n / 1e6, mist = Math.abs(mil) >= 10 ? 0 : 1;
  if (Math.abs(Number(mil.toFixed(mist))) < 1000) return tx('obecne.milion', { p1: des(mil, mist) });
  return tx('obecne.miliarda', { p1: des(n / 1e9, 1) });
}
// V hlavičce chceme vidět, že peníze tečou. „120 tis." se hne jednou za půl
// hodiny, proto pod milion píšeme přesné číslo — to se mění každou vteřinu.
function kcHdr(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) >= 1e6) return tx('obecne.milion', { p1: des(n / 1e6, 1) });
  return tCislo(n);
}
// Herní měna se jmenuje laundr a píše se L$ — ať si ji nikdo neplete s korunami.
var CUR = 'L$';
function kcFull(n) { return tPenize(n); }
var toastT = null;
// Hlášky se stohují nad sebou a každá má křížek. Co si hráč nezpůsobil sám —
// výpověď z místa, porucha, doručená provize — nikam nemizí, dokud to nezavře;
// potvrzení vlastního klepnutí po pár vteřinách zmizí samo.
// Všechno důležité se zároveň ukládá do zvonku, ať se k tomu dá vrátit.
var TOASTU_MAX = 4;
var TOAST_MS = 5200;
// Hláška dole jen probliknutí — nic nezůstává viset. Co má přežít, jde do
// zvonku: tam si to hráč přečte, až bude chtít. `drz` (a chyby) proto nemění
// to, jak dlouho hláška svítí, ale jestli se zapíše mezi upozornění.
function toast(msg, kind, drz) {
  var box = $('toasty');
  if (!box) return;
  var doZvonku = drz === true || kind === 'err';
  var el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  var t = document.createElement('span');
  t.textContent = msg;
  var x = document.createElement('button');
  x.className = 'toast-x'; x.type = 'button'; x.setAttribute('aria-label', esc(tx('hra.zavrit')));
  x.textContent = '\u00d7';
  x.onclick = function () { if (el.parentNode) el.parentNode.removeChild(el); };
  el.appendChild(t); el.appendChild(x);
  box.appendChild(el);
  while (box.children.length > TOASTU_MAX) box.removeChild(box.firstChild);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, TOAST_MS);
  if (doZvonku) { zapisUpoz(msg, kind); zvonekCukni(); }
}
// Zvoneček na mapě krátce cukne, ať je poznat, že něco přibylo.
function zvonekCukni() {
  var el = $('map-zvon');
  if (!el) return;
  el.classList.remove('cuk');
  void el.offsetWidth;
  el.classList.add('cuk');
  setTimeout(function () { el.classList.remove('cuk'); }, 1200);
}
// ─── Zvonek: co se stalo, když se hráč zrovna nedíval ────────────────────────
var UPOZ_MAX = 60;
function zapisUpoz(text, kind) {
  if (!S) return;
  if (!Array.isArray(S.upoz)) S.upoz = [];
  // Pojistka proti zdvojení: stejnou větu do deseti minut už nepřipisujeme.
  var ted = Date.now(), txt = String(text || '').slice(0, 300);
  for (var i = S.upoz.length - 1; i >= 0 && ted - (S.upoz[i].t || 0) < 10 * 60e3; i--) {
    if (S.upoz[i].x === txt) return;
  }
  S.upoz.push({ t: Date.now(), x: String(text || '').slice(0, 300), k: kind || '', p: 0 });
  if (S.upoz.length > UPOZ_MAX) S.upoz = S.upoz.slice(-UPOZ_MAX);
  save(); paintZvon();
}
function upozNeprectenych() {
  return ((S && S.upoz) || []).filter(function (u) { return !u.p; }).length;
}
function paintZvon() {
  var el = $('map-zvon');
  if (!el) return;
  var n = upozNeprectenych(), celkem = ((S && S.upoz) || []).length;
  el.classList.toggle('hidden', !celkem);
  el.classList.toggle('ma', n > 0);
  el.innerHTML = '\uD83D\uDD14' + (n ? '<b>' + (n > 9 ? '9+' : n) + '</b>' : '');
  el.title = n ? tx('veta.neprectenych_upozorneni', { p1: n }): esc(tx('hra.upozorneni'));
}
// Upozornění se do hry zapisují jako hotová věta v jazyce, který zrovna platil.
// Starší záznamy jsou proto česky, i když hráč hraje anglicky. Při zobrazení
// větu dohledáme podle české předlohy v katalogu (s čísly na místě {p1}…) a
// složíme znovu v jazyce hráče. Co se nenajde, zůstane tak, jak bylo.
var ZPETNE_SABLONY = null;
function zpetneTx(text) {
  text = String(text == null ? '' : text);
  if (JAZYK === 'cs' || !text) return text;
  if (!ZPETNE_SABLONY) {
    ZPETNE_SABLONY = [];
    var cz = window.__TEXTY_CS || {};
    Object.keys(cz).forEach(function (k) {
      var v = cz[k];
      if (typeof v !== 'string' || v.indexOf('<') >= 0 || v.length < 8) return;
      var jmena = [];
      var re = '^' + v.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(?:[a-z]+:)?(p\d+)\}/g, function (m, n) { jmena.push(n); return '(.+?)'; }) + '$';
      if (!jmena.length) return;
      try { ZPETNE_SABLONY.push({ k: k, re: new RegExp(re), j: jmena, d: v.replace(/\{[^}]+\}/g, '').length }); } catch (e) { /* neplatná šablona se přeskočí */ }
    });
    ZPETNE_SABLONY.sort(function (a, b) { return b.d - a.d; });
  }
  for (var i = 0; i < ZPETNE_SABLONY.length; i++) {
    var sb = ZPETNE_SABLONY[i], m = sb.re.exec(text);
    if (!m) continue;
    var udaje = {};
    sb.j.forEach(function (n, x) {
      var h = m[x + 1];
      var pen = /^(-?[\d\s ]+(?:,\d+)?)\s*L\$$/.exec(h);
      var cis = /^-?[\d\s ]+$/.exec(h);
      if (pen) udaje[n] = tPenize(Number(pen[1].replace(/[\s ]/g, '').replace(',', '.')));
      else if (cis) udaje[n] = tCislo(Number(h.replace(/[\s ]/g, '')));
      else udaje[n] = hovorText(h);
    });
    var out = tx(sb.k, udaje);
    return out && out !== sb.k ? out : text;
  }
  return text;
}
// Stav nabídky na burze přichází ze serveru jako kód (prijato, odmitnuto…).
function stavNabidky(kod) {
  var k = 'hra.stav_' + kod, v = tx(k);
  return v && v !== k ? v : kod;
}
function upozorneniSheet() {
  var l = ((S && S.upoz) || []).slice().reverse();
  sheet(tx('veta.h3_h3_p_class_muted_small_22', { p1: esc(tx('hra.ud83d_udd14_upozorneni')) })
    + (l.length
        ? '<div class="upoz">' + l.map(function (u) {
            return '<div class="upoz-r' + (u.p ? '' : ' nove') + (u.k === 'err' ? ' err' : '') + '">'
              + '<i>' + datumCas(u.t) + '</i><span>' + esc(zpetneTx(u.x)) + '</span></div>';
          }).join('') + '</div>'
          + '<button class="btn sec" id="upoz-smaz" style="width:100%;margin-top:12px">' + esc(tx('hra.vymazat_seznam')) + '</button>'
        : tx('hra.p_class_fine_zatim_nic_az')));
  var b = $('upoz-smaz');
  if (b) b.onclick = function () { S.upoz = []; save(); paintZvon(); closeSheet(); };
  // Přečteno až po otevření, ať se zvonek nevynuluje jen tím, že něco přišlo.
  var zmena = false;
  ((S && S.upoz) || []).forEach(function (u) { if (!u.p) { u.p = 1; zmena = true; } });
  if (zmena) { save(); paintZvon(); }
}
function sheet(html) { $('sheet-body').innerHTML = html; $('sheet').classList.remove('hidden'); }
function closeSheet() { $('sheet').classList.add('hidden'); }
// Krok, který nejde vzít zpátky, se nesmí stát ukliknutím. Hráč musí slovo
// opsat a tlačítko zůstane zamčené, dokud nesedí. Diakritika ani velikost
// písmen se neřeší — kdo napíše „zacit znova", myslel to stejně vážně.
// Tohle okno je zdvořilost, ne zámek: slovo si server ověřuje znovu sám.
function bezOzdob(x) {
  return String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').replace(/^ | $/g, '');
}
// Potvrzení pro kroky, které se dají vzít zpátky penězi, ne pro mazání:
// stačí druhé kliknutí, opisovat slovo by tu bylo buzerace.
function potvrdAno(o) {
  sheet('<h3>' + esc(o.nadpis) + '</h3>'
    + '<p class="muted small">' + o.popis + '</p>'
    + '<button class="btn big" id="ano-ok" style="width:100%;margin-top:10px">'
    + esc(o.tlacitko) + '</button>'
    + '<button class="btn sec" id="ano-ne" style="width:100%;margin-top:8px">'
    + esc(tx('hra.nechat_byt')) + '</button>');
  $('ano-ne').onclick = closeSheet;
  $('ano-ok').onclick = function () { closeSheet(); o.pak(); };
}
function potvrdSlovem(o) {
  sheet('<h3>' + esc(o.nadpis) + '</h3>'
    + '<p class="muted small">' + o.popis + '</p>'
    + '<p class="fine warn" style="margin:10px 0 4px">'
    + tx('veta.pro_potvrzeni_opis_slovo', { p1: '<b>' + esc(o.slovo) + '</b>' }) + '</p>'
    + '<input id="pot-vstup" class="inp" type="text" autocomplete="off" autocapitalize="characters"'
    + ' autocorrect="off" spellcheck="false" style="width:100%">'
    + '<button class="btn big" id="pot-ok" style="width:100%;margin-top:10px" disabled>'
    + esc(o.tlacitko) + '</button>'
    + '<button class="btn sec" id="pot-ne" style="width:100%;margin-top:8px">'
    + esc(tx('hra.nechat_byt')) + '</button>');
  var vstup = $('pot-vstup'), ok = $('pot-ok');
  var sedi = function () { return bezOzdob(vstup.value) === bezOzdob(o.slovo); };
  vstup.oninput = function () { ok.disabled = !sedi(); };
  vstup.onkeydown = function (e) { if (e.key === 'Enter' && sedi()) ok.click(); };
  $('pot-ne').onclick = closeSheet;
  ok.onclick = function () {
    if (!sedi()) return;
    ok.disabled = true;
    ok.textContent = esc(o.pracuji || tx('hra.mazu'));
    o.pak(vstup.value, function () { ok.disabled = false; ok.textContent = esc(o.tlacitko); });
  };
  setTimeout(function () { try { vstup.focus(); } catch (e) { /* na mobilu to nevadí */ } }, 60);
}
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
  var t = score >= 70 ? esc(tx('hra.vyborne')) : score >= 55 ? esc(tx('hra.pouzitelne')) : esc(tx('hra.slabe'));
  return '<span class="pill ' + c + '">' + score + '/100 · ' + t + '</span>';
}

// ─── Infolinka ────────────────────────────────────────────────────
// Zákazníci volá jen tomu, kdo je zrovna ve hře — odpočítává se čas strávený
// v aplikaci, ne čas skutečný. Kdo hovory bere a umí poradit, má lepší pověst
// a chodí mu víc lidí. Kdo je odmítá nebo odbyde, přijde až o pětinu návštěvnosti.
// Na jeden prádlomat vychází hovor zhruba jednou za osm minut; náhoda s tím
// hýbe mezi šesti a deseti.
var HOVOR_ZA_MIN = 360000;
var HOVOR_ZA_MAX = 600000;
// Čím větší síť, tím víc zákazníků a tím častěji zvoní: rozmezí se dělí
// počtem postavených prádlomatů. Pod minimální odstup ale nejdeme — hovor
// trvá skoro minutu a hra, ve které se jen zvedá telefon, by nebyla hra.
// U velké sítě je právě tenhle odstup to, co o frekvenci rozhoduje.
var HOVOR_MIN_ODSTUP = 300000;
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
var HOVOR_ZENY = [esc(tx('hra.pani_novakova')), esc(tx('hra.pani_svobodova')), esc(tx('hra.pani_dvorakova')), esc(tx('hra.pani_cerna')),
  esc(tx('hra.pani_prochazkova')), esc(tx('hra.pani_kucerova')), esc(tx('hra.pani_vesela')), esc(tx('hra.pani_horakova')), esc(tx('hra.pani_nemcova')),
  esc(tx('hra.pani_markova')), esc(tx('hra.pani_pospisilova')), esc(tx('hra.pani_pokorna')), esc(tx('hra.pani_hajkova')), esc(tx('hra.pani_jelinkova')),
  esc(tx('hra.pani_kralova')), esc(tx('hra.pani_ruzickova')), esc(tx('hra.pani_benesova')), esc(tx('hra.pani_fialova')), esc(tx('hra.pani_sedlackova')),
  esc(tx('hra.pani_dolezalova')), esc(tx('hra.pani_zemanova')), esc(tx('hra.pani_kolarova')), esc(tx('hra.pani_navratilova')), esc(tx('hra.pani_cermakova')),
  esc(tx('hra.pani_vankova')), esc(tx('hra.pani_urbanova')), esc(tx('hra.pani_blazkova')), esc(tx('hra.pani_krizova')), esc(tx('hra.pani_kovarova')),
  esc(tx('hra.pani_bartosova')), esc(tx('hra.pani_vlckova')), esc(tx('hra.pani_stepankova')), esc(tx('hra.pani_polakova')), esc(tx('hra.pani_konecna')),
  esc(tx('hra.pani_maskova')), esc(tx('hra.pani_musilova')), esc(tx('hra.pani_simkova')), esc(tx('hra.pani_holubova')), esc(tx('hra.pani_kratochvilova')),
  esc(tx('hra.pani_kadlecova')), esc(tx('hra.pani_machova')), esc(tx('hra.pani_liskova')), esc(tx('hra.pani_soukupova')), esc(tx('hra.pani_blahova')),
  esc(tx('hra.slecna_matouskova')), esc(tx('hra.slecna_buresova')), esc(tx('hra.slecna_kopecka')), esc(tx('hra.slecna_mala')), esc(tx('hra.slecna_dostalova')),
  esc(tx('hra.slecna_stastna')), esc(tx('hra.slecna_ticha')), esc(tx('hra.slecna_vaneckova')), esc(tx('hra.slecna_hruba')), esc(tx('hra.slecna_berankova')),
  esc(tx('hra.pani_nguyenova')), esc(tx('hra.pani_horvathova')), esc(tx('hra.pani_baloghova')), esc(tx('hra.pani_kowalska')), esc(tx('hra.pani_sebestova')),
  esc(tx('hra.pani_strnadova')), esc(tx('hra.pani_vondrackova')), esc(tx('hra.pani_zidkova')), esc(tx('hra.pani_melicharova')), esc(tx('hra.pani_pechova')),
  esc(tx('hra.pani_sulcova')), esc(tx('hra.pani_rybarova')), esc(tx('hra.pani_kohoutova')), esc(tx('hra.pani_capkova')), esc(tx('hra.pani_matejkova')),
  esc(tx('hra.pani_vrbova')), esc(tx('hra.pani_janouskova')), esc(tx('hra.pani_dudkova')), esc(tx('hra.pani_hrabalova')), esc(tx('hra.pani_pankova')),
  esc(tx('hra.pani_slavikova')), esc(tx('hra.pani_vitkova')), esc(tx('hra.pani_brozova')), esc(tx('hra.pani_machackova')), esc(tx('hra.pani_jiraskova')),
  esc(tx('hra.pani_bednarova')), esc(tx('hra.pani_havlickova')), esc(tx('hra.pani_travnickova')), esc(tx('hra.pani_suchankova')), esc(tx('hra.pani_kasalova')),
  esc(tx('hra.slecna_kalouskova')), esc(tx('hra.slecna_prokopova')), esc(tx('hra.slecna_hejdukova')), esc(tx('hra.slecna_rysova')), esc(tx('hra.slecna_fenclova')),
  esc(tx('hra.slecna_linhartova')), esc(tx('hra.slecna_krejzova')), esc(tx('hra.slecna_michalcova')), esc(tx('hra.slecna_potuckova')), esc(tx('hra.slecna_bohacova')),
  esc(tx('hra.doktorka_kralickova')), esc(tx('hra.pani_ucitelka_zemanova')), esc(tx('hra.pani_nedvedova')), esc(tx('hra.pani_pilarova')),
  esc(tx('hra.pani_bezdekova')), esc(tx('hra.pani_hofmanova')), esc(tx('hra.pani_rezkova')), esc(tx('hra.pani_stedra')), esc(tx('hra.pani_chalupova')),
  esc(tx('hra.pani_rychtarikova')), esc(tx('hra.pani_bastova')), esc(tx('hra.pani_hofmanova_2')), esc(tx('hra.pani_simackova')),
  esc(tx('hra.pani_trnkova')), esc(tx('hra.pani_vopenkova')), esc(tx('hra.pani_kadlecova_2')), esc(tx('hra.pani_myskova')),
  esc(tx('hra.pani_bernardova')), esc(tx('hra.pani_kopalova')), esc(tx('hra.pani_zemanova_2')), esc(tx('hra.pani_stuchlikova')),
  esc(tx('hra.pani_vrbova_2')), esc(tx('hra.pani_hanzlikova')), esc(tx('hra.pani_michalikova')), esc(tx('hra.pani_dostalova')),
  esc(tx('hra.pani_lacinova')), esc(tx('hra.pani_kafkova')), esc(tx('hra.pani_burdova')), esc(tx('hra.pani_nedvedova_2')),
  esc(tx('hra.pani_halamkova')), esc(tx('hra.pani_sestakova')), esc(tx('hra.pani_pazderova')), esc(tx('hra.pani_kolmanova')),
  esc(tx('hra.pani_subrtova')), esc(tx('hra.slecna_vackova')), esc(tx('hra.slecna_hruskova')), esc(tx('hra.slecna_dolezelova')),
  esc(tx('hra.slecna_vankova')), esc(tx('hra.slecna_capkova')), esc(tx('hra.slecna_bartosova')), esc(tx('hra.slecna_kralovcova')),
  esc(tx('hra.slecna_reznickova')), esc(tx('hra.slecna_vlasakova')), esc(tx('hra.slecna_skalicka')), esc(tx('hra.pani_hrabalova_2')),
  esc(tx('hra.pani_mlynarova')), esc(tx('hra.pani_konvalinkova')), esc(tx('hra.pani_pechova_2')), esc(tx('hra.pani_bauerova')),
  esc(tx('hra.pani_sladkova')), esc(tx('hra.pani_maresova')), esc(tx('hra.pani_ticha')), esc(tx('hra.pani_kratochvilova_2')),
  esc(tx('hra.pani_fialova_2')), esc(tx('hra.pani_vondrackova_2')), esc(tx('hra.pani_hubackova')), esc(tx('hra.pani_zelinkova')),
  esc(tx('hra.pani_janouskova_2')), esc(tx('hra.pani_peterkova')),
];
var HOVOR_MUZI = [esc(tx('hra.pan_novak')), esc(tx('hra.pan_svoboda')), esc(tx('hra.pan_dvorak')), esc(tx('hra.pan_cerny')), esc(tx('hra.pan_prochazka')),
  esc(tx('hra.pan_kucera')), esc(tx('hra.pan_vesely')), esc(tx('hra.pan_horak')), esc(tx('hra.pan_nemec')), esc(tx('hra.pan_marek')), esc(tx('hra.pan_pospisil')),
  esc(tx('hra.pan_pokorny')), esc(tx('hra.pan_hajek')), esc(tx('hra.pan_jelinek')), esc(tx('hra.pan_kral')), esc(tx('hra.pan_ruzicka')), esc(tx('hra.pan_benes')),
  esc(tx('hra.pan_fiala')), esc(tx('hra.pan_sedlacek')), esc(tx('hra.pan_dolezal')), esc(tx('hra.pan_zeman')), esc(tx('hra.pan_kolar')), esc(tx('hra.pan_navratil')),
  esc(tx('hra.pan_cermak')), esc(tx('hra.pan_vanek')), esc(tx('hra.pan_urban')), esc(tx('hra.pan_blazek')), esc(tx('hra.pan_kriz')), esc(tx('hra.pan_kovar')),
  esc(tx('hra.pan_bartos')), esc(tx('hra.pan_vlcek')), esc(tx('hra.pan_stepanek')), esc(tx('hra.pan_polak')), esc(tx('hra.pan_konecny')), esc(tx('hra.pan_masek')),
  esc(tx('hra.pan_musil')), esc(tx('hra.pan_simek')), esc(tx('hra.pan_holub')), esc(tx('hra.pan_kratochvil')), esc(tx('hra.pan_kadlec')), esc(tx('hra.pan_mach')),
  esc(tx('hra.pan_liska')), esc(tx('hra.pan_soukup')), esc(tx('hra.pan_blaha')), esc(tx('hra.pan_matousek')), esc(tx('hra.pan_bures')), esc(tx('hra.pan_kopecky')),
  esc(tx('hra.pan_maly')), esc(tx('hra.pan_dostal')), esc(tx('hra.pan_stastny')), esc(tx('hra.pan_tichy')), esc(tx('hra.pan_richter')), esc(tx('hra.pan_hruska')),
  esc(tx('hra.pan_beranek')), esc(tx('hra.pan_vavra')),
  esc(tx('hra.pan_nguyen')), esc(tx('hra.pan_horvath')), esc(tx('hra.pan_balogh')), esc(tx('hra.pan_kowalski')), esc(tx('hra.pan_sebesta')),
  esc(tx('hra.pan_strnad')), esc(tx('hra.pan_vondracek')), esc(tx('hra.pan_zidek')), esc(tx('hra.pan_melichar')), esc(tx('hra.pan_pech')),
  esc(tx('hra.pan_sulc')), esc(tx('hra.pan_rybar')), esc(tx('hra.pan_kohout')), esc(tx('hra.pan_capek')), esc(tx('hra.pan_matejka')),
  esc(tx('hra.pan_vrba')), esc(tx('hra.pan_janousek')), esc(tx('hra.pan_dudek')), esc(tx('hra.pan_hrabal')), esc(tx('hra.pan_panek')),
  esc(tx('hra.pan_slavik')), esc(tx('hra.pan_vitek')), esc(tx('hra.pan_broz')), esc(tx('hra.pan_machacek')), esc(tx('hra.pan_jirasek')),
  esc(tx('hra.pan_bednar')), esc(tx('hra.pan_havlicek')), esc(tx('hra.pan_travnicek')), esc(tx('hra.pan_suchanek')), esc(tx('hra.pan_kasal')),
  esc(tx('hra.pan_kalousek')), esc(tx('hra.pan_prokop')), esc(tx('hra.pan_hejduk')), esc(tx('hra.pan_rys')), esc(tx('hra.pan_fencl')),
  esc(tx('hra.pan_linhart')), esc(tx('hra.pan_krejza')), esc(tx('hra.pan_michalec')), esc(tx('hra.pan_potucek')), esc(tx('hra.pan_bohac')),
  esc(tx('hra.doktor_nedved')), esc(tx('hra.pan_ridic_pilar')), esc(tx('hra.pan_bezdek')), esc(tx('hra.pan_hofman')), esc(tx('hra.pan_rezek')),
  esc(tx('hra.pan_stedry')), esc(tx('hra.pan_chalupa')), esc(tx('hra.pan_krecek')), esc(tx('hra.pan_vlasak')), esc(tx('hra.pan_zacek')),
  esc(tx('hra.pan_rychtarik')), esc(tx('hra.pan_basta')), esc(tx('hra.pan_hofman_2')), esc(tx('hra.pan_simacek')),
  esc(tx('hra.pan_trnka')), esc(tx('hra.pan_vopenka')), esc(tx('hra.pan_kadlec_2')), esc(tx('hra.pan_myska')),
  esc(tx('hra.pan_bernard')), esc(tx('hra.pan_kopal')), esc(tx('hra.pan_zeman_2')), esc(tx('hra.pan_stuchlik')),
  esc(tx('hra.pan_vrba_2')), esc(tx('hra.pan_hanzlik')), esc(tx('hra.pan_michalik')), esc(tx('hra.pan_dostal_2')),
  esc(tx('hra.pan_lacina')), esc(tx('hra.pan_kafka')), esc(tx('hra.pan_burda')), esc(tx('hra.pan_nedved')),
  esc(tx('hra.pan_halamek')), esc(tx('hra.pan_sestak')), esc(tx('hra.pan_pazdera')), esc(tx('hra.pan_kolman')),
  esc(tx('hra.pan_subrt')), esc(tx('hra.pan_vacek')), esc(tx('hra.pan_hruska_2')), esc(tx('hra.pan_dolezel')),
  esc(tx('hra.pan_vanek_2')), esc(tx('hra.pan_capek_2')), esc(tx('hra.pan_bartos_2')), esc(tx('hra.pan_kralovec')),
  esc(tx('hra.pan_reznicek')), esc(tx('hra.pan_vlasak_2')), esc(tx('hra.pan_skalicky')), esc(tx('hra.pan_hrabal_2')),
  esc(tx('hra.pan_mlynar')), esc(tx('hra.pan_konvalinka')), esc(tx('hra.pan_pech_2')), esc(tx('hra.pan_bauer')),
  esc(tx('hra.pan_sladek')), esc(tx('hra.pan_mares')), esc(tx('hra.pan_tichy_2')), esc(tx('hra.pan_kratochvil_2')),
  esc(tx('hra.pan_fiala_2')), esc(tx('hra.pan_vondracek_2')), esc(tx('hra.pan_hubacek')), esc(tx('hra.pan_zelinka')),
  esc(tx('hra.pan_janousek_2')), esc(tx('hra.pan_peterka')),
];
// Scénáře infolinky nejsou v kódu, ale v services/game/texty/linka.<jazyk>.json
// a stahují se podle jazyka hráče. Je to souvislá próza — padesát rozhovorů,
// přes tisíc replik — a jako klíče v katalogu by se v tom nedalo psát. Takhle
// se nový scénář napíše jako text, ne jako linka.susicka.3.odpoved2.
// Dokud se nenačtou, infolinka nezvoní; bez scénáře není co hrát.
var HOVOR_SCENARE = [];
function nactiScenare(jazyk, pak) {
  api('/texty/linka/' + encodeURIComponent(jazyk || 'cs')).then(function (r) {
    if (r.ok && r.j && Array.isArray(r.j.scenare) && r.j.scenare.length) HOVOR_SCENARE = r.j.scenare;
    if (pak) pak();
  }).catch(function () { if (pak) pak(); });
}
// ─── Tvář volajícího a jeho nálada ───────────────────────────────────────────
// Obrázek se nekreslí nikde na serveru a nikde neleží — skládá se tady ze
// jména, takže stejný zákazník vypadá vždycky stejně. Výraz ale není daný
// jménem, ten se mění podle toho, jak s člověkem mluvíš: obočí, pusa i barva
// kroužku kolem. Nálada jde od 0 (zuří) do 100 (spokojený).
var TVAR_PLET = ['#f3c9a6', '#e8b48c', '#d79b6e', '#b87c52', '#8d5a3a', '#f7d9bd'];
var TVAR_VLASY = ['#2b2118', '#4a3524', '#7a5230', '#a8763f', '#c9a227', '#8c8c94', '#1f1f23'];
function tvarHash(txt) {
  var h = 0, str = String(txt || '');
  for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) % 100000; }
  return h;
}
function naladaSlovy(n) {
  if (n <= 15) return esc(tx('hra.zuri'));
  if (n <= 32) return esc(tx('hra.nastvany'));
  if (n <= 48) return esc(tx('hra.podrazdeny'));
  if (n <= 62) return esc(tx('hra.nejisty'));
  if (n <= 80) return esc(tx('hra.uklidneny'));
  return esc(tx('hra.spokojeny'));
}
function naladaBarva(n) {
  if (n <= 32) return '#ff5d6c';
  if (n <= 62) return '#f3b23c';
  return '#2fe3a0';
}
// Ženská a mužská varianta se liší jen vlasy — zbytek je stejný obličej.
function tvarSvg(jmeno, rod, nalada, px) {
  px = px || 72;
  var n = Math.max(0, Math.min(100, nalada == null ? 50 : nalada));
  var h = tvarHash(jmeno);
  var plet = TVAR_PLET[h % TVAR_PLET.length];
  var vlasy = TVAR_VLASY[(h >> 3) % TVAR_VLASY.length];
  var zena = rod === 'z' || (rod !== 'm' && (h % 2 === 0));
  var ucho = (h >> 5) % 3;                       // malá obměna tvaru hlavy
  var kruh = naladaBarva(n);
  // Obočí: při vzteku vnitřní konec DOLŮ (to je ten zamračený véčkový tvar),
  // při klidu mírně nahoru. Nahoru to přeháníme míň — vytřeštěné obočí by
  // vypadalo vyděšeně, ne spokojeně.
  var sk = (50 - n) / 50;
  var sklon = Math.round(sk > 0 ? sk * 6 : sk * 3);
  // Pusa: záporná hodnota je koutek dolů, kladná úsměv.
  var usmev = Math.round((n - 50) / 50 * 13);
  var vlasyTvar = zena
    ? '<path d="M24 46 C24 24 76 24 76 46 L76 62 C76 52 70 44 50 44 C30 44 24 52 24 62z" fill="' + vlasy + '"/>'
      + '<path d="M22 48 q-4 18 2 28 l6-4 q-4-12-2-24z" fill="' + vlasy + '"/>'
      + '<path d="M78 48 q4 18-2 28 l-6-4 q4-12 2-24z" fill="' + vlasy + '"/>'
    : '<path d="M26 46 C26 26 74 26 74 46 L74 50 C70 40 58 38 50 38 C40 38 30 41 26 50z" fill="' + vlasy + '"/>';
  return '<svg class="tvar" width="' + px + '" height="' + px + '" viewBox="0 0 100 100" aria-hidden="true">'
    + '<circle cx="50" cy="50" r="47" fill="#101a2d"/>'
    + '<circle cx="50" cy="50" r="46" fill="none" stroke="' + kruh + '" stroke-width="3"/>'
    + '<ellipse cx="50" cy="56" rx="' + (25 + ucho) + '" ry="28" fill="' + plet + '"/>'
    + vlasyTvar
    + '<circle cx="41" cy="56" r="3.2" fill="#23313f"/><circle cx="59" cy="56" r="3.2" fill="#23313f"/>'
    + '<path d="M34 ' + (47 - sklon) + ' L45 ' + (47 + sklon) + '" stroke="#23313f" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M66 ' + (47 - sklon) + ' L55 ' + (47 + sklon) + '" stroke="#23313f" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M39 72 Q50 ' + (72 + usmev) + ' 61 72" fill="none" stroke="#23313f" stroke-width="3" stroke-linecap="round"/>'
    + '</svg>';
}
// Pruh nálady pod jménem — ať je vidět i číslem, ne jen z výrazu.
function naladaHtml(h) {
  var n = Math.max(0, Math.min(100, h.nalada == null ? 50 : h.nalada));
  return '<div class="nal"><i class="nal-pruh"><b style="width:' + n + '%;background:' + naladaBarva(n) + '"></b></i>'
    + '<span style="color:' + naladaBarva(n) + '">' + naladaSlovy(n) + '</span></div>';
}
function povest() { return Math.max(-100, Math.min(100, (S && S.povest) || 0)); }
// Co se na lince stalo, se hlásí serveru. Ne proto, aby to spočítal za nás —
// hra si pověst počítá dál sama a hráč ji vidí hned — ale proto, aby ji uměl
// spočítat taky, a to z toho, co hráč vybral. Váhu odpovědi si najde ve svém
// katalogu scénářů, takže se nedá poslat vymyšlená. Nepovede-li se to,
// nevadí: hra běží dál a server si to srovná při příštím hovoru.
function hlasLinku(co) {
  if (!ME) return;
  apiJson('/linka/udalost', co).catch(function () { /* hra tím nestojí */ });
}
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
  return (h == null ? hvezdy() : h).toFixed(1).replace('.', desZnak()) + ' ★';
}
function povestSlovy() {
  var p = povest();
  if (p >= 60) return esc(tx('hra.vyborna'));
  if (p >= 20) return esc(tx('hra.dobra'));
  if (p > -20) return esc(tx('hra.prumerna'));
  if (p > -60) return esc(tx('hra.spatna'));
  return esc(tx('hra.mizerna'));
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
// Frekvence s počtem poboček roste, ale jen mírně, a nikdy nespadne pod pět
// minut. Jinak by z hry o prádlomatech bylo call centrum: jeden hovor se
// třemi otázkami trvá skoro minutu a při velké síti by se nedalo dělat nic
// jiného. Jedna pobočka osm minut, padesát pobočkami pět a půl.
var HOVOR_SKLON = 0.12;
function naplanujHovor() {
  var pobocek = Math.max(1, ((S && S.units) || []).length);
  var zaklad = HOVOR_ZA_MIN + Math.random() * (HOVOR_ZA_MAX - HOVOR_ZA_MIN);
  S.hovorZa = Math.max(HOVOR_MIN_ODSTUP, zaklad / Math.pow(pobocek, HOVOR_SKLON));
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
  // Dokud se scénáře nestáhly, není co hrát — volající bez repliky by byl
  // horší než ticho. Volající se o to postarají: bez scénáře se hovor
  // nezačne a zazvoní se, až scénáře dojdou.
  if (!HOVOR_SCENARE.length) return null;
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
// ─── Evidence hovorů ─────────────────────────────────────────────────────────
// Posledních padesát hovorů: kdo volal, o co šlo a jak to dopadlo. Hráč, který
// si platí operátora, jinak nemá jak zjistit, co za něj linka vyřídila.
var HOVORU_PAMET = 50;
function zapisHovor(jmeno, kroky, konec, zmena) {
  var prvni = kroky && kroky[0] ? String(kroky[0].t || '') : '';
  S.hovorLog = ((S.hovorLog) || []).concat([{
    kdy: Date.now(), jmeno: jmeno || '', tema: prvni.slice(0, 90),
    konec: konec, zmena: Math.round((zmena || 0) * 10) / 10
  }]).slice(-HOVORU_PAMET);
}
// Zaplacený kredit znamená klid: hovor vyřídí operátor a telefon vůbec
// nezazvoní. Kdo chce hovory brát sám (vynesou víc), přepne si to v kartě.
// Dokud balíček běží, bere operátor všechny hovory a telefon nezvoní.
var LINKA_PREVOD_MS = 7 * 86400000;     // co dostanou staré kredity při převodu
function linkaPredplatne() {
  var ted = Date.now();
  return (PREDPLATNE || []).filter(function (x) {
    return /^linka_sub/.test(x.kind) && (!x.plati_do || new Date(x.plati_do).getTime() > ted);
  })[0] || null;
}
// Linku jde pozastavit. Dokud za hráče bere hovory operátor, nemá jak si
// zvednout hodnocení — to roste jen z hovorů, které vyřídí sám. Zbývající čas
// se přitom nesmí spotřebovávat, takže se zmrazí a po zapnutí běží dál.
function linkaStoji() { return !!(S && S.linkaStop); }
function maLinku() {
  if (linkaStoji()) return false;
  if (linkaPredplatne()) return true;     // běžící předplatné drží linku zapnutou
  return !!(S && S.linkaDo && S.linkaDo > Date.now());
}
// Kolik času na lince zbývá. Když stojí, je to zmrazený zbytek — proto se
// nedá počítat z maLinku(), ta je v tu chvíli false.
function linkaZbyva() {
  if (linkaStoji()) return Math.max(0, (S && S.linkaZbytek) || 0);
  return (S && S.linkaDo && S.linkaDo > Date.now()) ? S.linkaDo - Date.now() : 0;
}
function pozastavLinku() {
  if (!S || linkaStoji()) return;
  S.linkaZbytek = Math.max(0, (S.linkaDo || 0) - Date.now());
  S.linkaStop = 1;
  S.linkaDo = 0;
  save(); paint(); syncState(true);
}
function spustLinku() {
  if (!S || !linkaStoji()) return;
  S.linkaDo = Date.now() + Math.max(0, S.linkaZbytek || 0);
  S.linkaStop = 0;
  S.linkaZbytek = 0;
  save(); paint(); syncState(true);
}
function prodluzLinku(dnu) {
  var pridat = Math.max(0, Number(dnu) || 0) * 86400000;
  // Koupeno za chodu pauzy: přičítá se ke zmrazenému zbytku, ne k datu —
  // jinak by nakoupený čas začal utíkat, i když linka stojí.
  if (linkaStoji()) {
    S.linkaZbytek = Math.max(0, S.linkaZbytek || 0) + pridat;
    return S.linkaZbytek;
  }
  var od = Math.max(Date.now(), (S && S.linkaDo) || 0);
  S.linkaDo = od + pridat;
  return S.linkaDo;
}
function operatorVyridi() {
  var sc = vyberScenar();
  if (!sc) return naplanujHovor();
  var jmeno = hovorJmeno(sc.rod);
  S.hovoryPosl = (S.hovoryPosl || []).concat([sc.id]).slice(-SCENARU_PAMET);
  S.hovoru = (S.hovoru || 0) + 1;
  zapisHovor(jmeno, sc.kroky, 'operator', 0);
  naplanujHovor();
  save(); paint(); syncState(true);
}
// ─── Infolinka, když hráč není ve hře ────────────────────────────────────────
// Lidi volají, i když má hráč hru zavřenou. Za nepřítomnosti počítáme hovory
// třikrát pomaleji a nejvýš třicet za jeden návrat — jinak by velká síť
// spolkla padesátihovorový balíček za jedno odpoledne. Co vezme operátor,
// stojí kredit; co nikdo nevzal, srazí pověst nejvýš o šest bodů, ať se hráč
// po víkendu nevrací k rozbité pověsti. Přepínač „beru si je sám" tady neplatí:
// hovor, u kterého hráč není, může vzít jedině operátor.
var OFF_PODIL = 3;            // offline chodí hovory třikrát pomaleji
var OFF_MIN = 10 * 60e3;      // kratší pauzu neřešíme
var OFF_MAX = 30;             // strop hovorů za jednu nepřítomnost
var OFF_POVEST_MAX = 6;       // strop ztráty pověsti za jednu nepřítomnost
var OFF_POVEST_DEN = 12;      // a za celý den, ať krátké odskoky nesčítají ztrátu donekonečna
// Kolik pověsti ještě dnes smí nepřítomnost sebrat.
function offPovestZbyva() {
  var d = S.offPovest;
  if (!d || d.den !== dnesKlic()) { d = { den: dnesKlic(), body: 0 }; S.offPovest = d; }
  return Math.max(0, OFF_POVEST_DEN - d.body);
}
function linkaOffline(dt) {
  if (!S || dt < OFF_MIN) return;
  if (S.tut !== 'done' || !(S.units || []).length) return;
  var pobocek = Math.max(1, (S.units || []).length);
  var prumer = Math.max(HOVOR_MIN_ODSTUP,
    ((HOVOR_ZA_MIN + HOVOR_ZA_MAX) / 2) / Math.pow(pobocek, HOVOR_SKLON));
  var kolik = Math.min(OFF_MAX, Math.floor(dt / (prumer * OFF_PODIL)));
  if (kolik <= 0) return;
  // S běžícím balíčkem bere operátor všechno, i za nepřítomnosti.
  var vzal = maLinku() ? kolik : 0;
  var zmeskano = kolik - vzal;
  S.hovoru = (S.hovoru || 0) + kolik;
  var ztrata = 0;
  if (zmeskano) {
    ztrata = Math.min(OFF_POVEST_MAX, zmeskano, offPovestZbyva());
    if (ztrata) { S.offPovest.body += ztrata; zmenPovest(-ztrata); }
    hlasLinku({ typ: 'zmeskano', kolik: zmeskano });
  }
  if (vzal) {
    zapisHovor(esc(tx('hra.operator_infolinky')), [{ t: tx('veta.vyridil_kdyz_jsi_byl_pryc', { p1: vzal, p2: mn(vzal, 'hovor', 'hovory', esc(tx('hra.hovoru'))) })}], 'operator', 0);
  }
  if (zmeskano) {
    zapisHovor(esc(tx('hra.nevzate_hovory')), [{ t: tx('veta.nikdo_nevzal_kdyz_jsi_byl_pryc', { p1: zmeskano, p2: mn(zmeskano, 'hovor', 'hovory', esc(tx('hra.hovoru_2'))) })}],
      'nevzat', -ztrata);
  }
  // Řekneme to až po vykreslení, ať hlášku nepřebije načítání hry.
  setTimeout(function () {
    if (vzal && zmeskano) {
      toast(tx('veta.operator_za_tebe_vyridil_na_uz', { p1: vzal, p2: mn(vzal, 'hovor', 'hovory', esc(tx('hra.hovoru_3'))), p3: zmeskano })
        + (ztrata ? tx('hra.povest_klesla_o_2', { p1: ztrata }) : '.'), 'warn', true);
    } else if (vzal) {
      toast(tx('veta.operator_za_tebe_vyridil_nez_ses', { p1: vzal, p2: mn(vzal, 'hovor', 'hovory', esc(tx('hra.hovoru_4'))), p3: etaText(linkaZbyva()) }), 'ok', true);
    } else {
      toast(tx('veta.nikdo_nevzal_kdyz_jsi_byl_pryc_2', { p1: zmeskano, p2: mn(zmeskano, 'hovor', 'hovory', esc(tx('hra.hovoru_5'))) })
        + (ztrata ? tx('hra.povest_klesla_o', { p1: ztrata }) : ''), ztrata ? 'err' : 'warn', true);
    }
  }, 1200);
}
function hovorTik(dt) {
  if (!S || document.hidden) return;
  if (HOVOR) { hovorHlidej(); return; }
  if (S.tut !== 'done' || !(S.units || []).length) return;
  if (typeof S.hovorZa !== 'number') { naplanujHovor(); return; }
  S.hovorZa -= dt;
  if (S.hovorZa > 0) return;
  // Dokud je kredit a hráč si hovory nebere sám, bere je operátor potichu.
  if (maLinku()) { operatorVyridi(); return; }
  if (!hovorLze()) return;              // později to zazvoní znovu
  zacniHovor();
}
function zacniHovor() {
  var sc = vyberScenar();
  if (!sc) return naplanujHovor();
  // Lidi nevolají na infolinku, když jsou spokojení. Většina začíná
  // podrážděná; scénář si může říct o vlastní výchozí náladu.
  var n0 = sc.nalada == null ? 14 + Math.floor(Math.random() * 24) : sc.nalada;
  HOVOR = {
    jmeno: hovorJmeno(sc.rod),
    rod: sc.rod, nalada: n0, nalada0: n0,
    scenar: sc.id, kroky: sc.kroky,
    poradi: sc.kroky.map(function (k) { return zamichej(k.o.length); }),
    i: 0, body: 0, vaha: 0, odpovedi: [], volby: [], prepis: [], ceka: false,
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
  // Zaplacená linka: hovor, který hráč nevezme, vyřídí operátor a pověst
  // nikam nejde. Kredit se strhne jen tehdy, když opravdu zaskakuje.
  var operator = maLinku();
  if (!operator) {
    zmenPovest(povestZaOdpoved(HOVOR_ODMITNUTI));
    hlasLinku({ typ: 'odmitnut' });
  }
  S.hovoru = (S.hovoru || 0) + 1;
  zapisHovor(HOVOR.jmeno, HOVOR.kroky, operator ? 'operator' : 'nevzat',
    operator ? 0 : povestZaOdpoved(HOVOR_ODMITNUTI));
  HOVOR = null;
  naplanujHovor();
  zavriHovor();
  save(); paint(); syncState(true);
  if (operator) {
    toast(esc(tx('hra.hovor_vzal_operator_infolinky_za')), 'ok', true);
  } else {
    toast(samo ? esc(tx('hra.zakaznik_se_nedockal_a_polozil'))
               : esc(tx('hra.hovor_jsi_nevzal_povest_klesla')), 'err');
    // Zrovna ho to stálo hvězdičky — tady má nabídka smysl nejvíc.
    if (linkaNabidnoutLze()) {
      var c = (LINKA_CAT || [])[0];
      S.linkaNabidka = Date.now(); save();
      sheet(tx('veta.h3_h3_p_class_muted_small_3', { p1: esc(tx('hra.u260e_ufe0f_at_to_za')), p2: esc(tx('hra.nevycerpane_hovory')), p3: esc(c.kind), p4: esc(polNazev(c)), p5: cenaReal(c.price_czk), p6: esc(tx('hra.ted_ne_2')), p7: esc(tx('hra.vetsi_balicky_vyjdou_levneji_najdes')) }));
      var bl = document.querySelector('#sheet-body [data-linka]');
      if (bl) bl.onclick = function () { buyCash(bl.getAttribute('data-linka')); };
      if ($('linka-ne')) $('linka-ne').onclick = closeSheet;
    }
  }
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
  h.nalada = Math.max(0, Math.min(100, (h.nalada == null ? 50 : h.nalada) + o.b * 13));
  h.vaha += povestZaOdpoved(o.b);
  h.odpovedi.push({ b: o.b, r: o.r });
  // Index odpovědi v katalogu, ne na obrazovce — tlačítka jsou zamíchaná.
  // Server si podle něj najde váhu sám; z klienta jde jen to, co hráč vybral.
  h.volby.push(h.poradi[h.i][i]);
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
    hlasLinku({ typ: 'hovor', scenar: HOVOR.scenar, volby: HOVOR.volby });
    S.hovoru = (S.hovoru || 0) + 1;
    // Zvlášť si počítáme hovory, které hráč vzal sám — odznak Spojovatel se
    // nedá koupit infolinkou a bez vlastního počítadla by to nešlo odlišit.
    S.hovoruJa = (S.hovoruJa || 0) + 1;
    zapisHovor(HOVOR.jmeno, HOVOR.kroky, 'ja', HOVOR.vaha);
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
      + '<div class="hov-tvar">' + tvarSvg(h.jmeno, h.rod, h.nalada, 108) + '</div>'
      + '<p class="hov-popis">' + esc(tx('hra.infolinka')) + '</p>'
      + '<h3>' + esc(h.jmeno) + '</h3>'
      + naladaHtml(h)
      + '<p class="hov-stav">' + esc(tx('hra.vola_polozi_to_za')) + ' ' + '<b id="hov-odpocet">' + zbyva + '</b> s</p>'
      + '<div class="hov-tlacitka">'
      + hovorBtn('hov-ne', 'hov-kolo ne', '✕')
      + hovorBtn('hov-ano', 'hov-kolo ano', '✓')
      + '</div>'
      + '<p class="fine">' + esc(tx('hra.kdo_hovory_nebere_prichazi_o')) + '</p></div>';
  } else if (h.stav === 'hovor') {
    html = '<div class="hov-in hov-chat">'
      + '<div class="hov-hlava">' + tvarSvg(h.jmeno, h.rod, h.nalada, 54)
      + '<div><p class="hov-popis">' + esc(h.jmeno) + ' ' + esc(tx('hra.infolinka_2')) + '</p>' + naladaHtml(h) + '</div></div>'
      + hovorPrepis(h)
      + (h.ceka ? '' : '<div class="hov-vyber"><p class="hov-popis">' + esc(tx('hra.co_odpovite')) + '</p>'
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
    var soud = b >= 6 ? esc(tx('hra.zakaznik_zavesil_nadseny_a_rekne'))
      : b >= 2 ? esc(tx('hra.zakaznik_byl_spokojeny'))
      : b > -2 ? esc(tx('hra.zakaznik_zavesil_ale_nijak_nadseny'))
      : b > -6 ? esc(tx('hra.zakaznik_odchazi_nespokojeny'))
      : esc(tx('hra.zakaznik_prasknul_telefonem_tohle_se'));
    // Co hovor udělal, ukážeme v tom, čemu hráč rozumí: v hvězdičkách a
    // v návštěvnosti. Body pověsti se objeví jen jednou a rovnou se stupnicí,
    // ať je jasné, že jedna odpověď s tím pohne o kousek, ne o polovinu.
    var dh = Math.round((hvezdy() - h.hvPred) * 10) / 10;
    var navs = Math.round((povestKoef() - 1) * 1000) / 10;
    html = '<div class="hov-in hov-chat hov-konec">'
      + '<div class="hov-hlava">' + tvarSvg(h.jmeno, h.rod, h.nalada, 54)
      + '<div><p class="hov-popis">' + esc(tx('hra.hovor_skoncil')) + '</p>' + naladaHtml(h) + '</div></div>'
      + hovorPrepis(h)
      + '<p class="hov-stav ' + tr2 + '">' + soud + '</p>'
      + '<div class="kv"><span>' + esc(tx('hra.hodnoceni_zakazniku')) + '</span><b>' + hvezdyText()
      + (dh ? ' <span class="' + tr2 + '">(' + (dh > 0 ? '+' : '−')
          + Math.abs(dh).toFixed(1).replace('.', desZnak()) + ')</span>' : '') + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('hra.povest')) + '</span><b>' + povestSlovy()
      + ' <span class="' + tr2 + '">(' + (zm > 0 ? '+' : (zm < 0 ? '−' : ''))
      + String(Math.abs(zm)).replace('.', desZnak()) + ')</span></b></div>'
      + '<div class="kv"><span>' + esc(tx('hra.navstevnost_2')) + '</span><b class="' + (povest() >= 0 ? 'ok' : 'err') + '">'
      + (navs >= 0 ? '+' : '−') + tx('veta.b_div_p_class_fine_povest', { p1: Math.abs(navs).toFixed(1).replace('.', desZnak()) })
      + (linkaNabidnoutLze() ? linkaNabidkaHtml() : '')
      + '<button class="btn big" id="hov-konec" style="width:100%;margin-top:10px">' + esc(tx('hra.zavesit')) + '</button></div>';
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  // Přepis dorůstá odspodu — vždy ukazujeme poslední repliku.
  var pr = $('hov-prepis');
  if (pr) pr.scrollTop = pr.scrollHeight;
  [].forEach.call(el.querySelectorAll('[data-linka]'), function (b2) {
    b2.onclick = function () { zavesHovor(); buyCash(b2.getAttribute('data-linka')); };
  });
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
  { accent: '#4fd1ff', suit: '#24466b', hair: '#3a4256', name: esc(tx('hra.opatrny')) },
  { accent: '#7c5cff', suit: '#39306b', hair: '#2f3242', name: esc(tx('hra.vyvazeny')) },
  { accent: '#ff8a3d', suit: '#5a2f1c', hair: '#241f22', name: esc(tx('hra.dravy')) }
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
  return tx('veta.svg_viewbox_0_0_160_160', { p1: g });
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
  if (suma) suma.textContent = tCislo(zakladni + START_BONUS);
  if (hrat) hrat.textContent = tx('veta.hrat_a_vzit', { p1: kcFull(START_BONUS) });
  startBonusDo = Date.now() + START_BONUS_MS;
  var tik = function () {
    var zbyva = Math.max(0, startBonusDo - Date.now());
    var s = Math.ceil(zbyva / 1000);
    cas.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    if (bar) bar.style.width = Math.round(zbyva / START_BONUS_MS * 100) + '%';
    // Posledních deset vteřin odpočet tepe — je to jediná věc, co opravdu mizí.
    cas.classList.toggle('pulz', zbyva > 0 && zbyva <= 10000);
    if (pod && zbyva > 0) pod.textContent = tx('veta.je_tvuj_kdyz_zacnes_do', { p1: s, p2: mn(s, esc(tx('hra.vteriny')), esc(tx('hra.vterin')), esc(tx('hra.vterin_2'))) });
    if (zbyva > 0) return;
    clearInterval(t);
    cas.textContent = esc(tx('hra.vyprsel'));
    cas.classList.remove('pulz');
    cas.classList.add('pryc');
    pruh.classList.add('pryc');
    if (box) box.classList.add('pryc');
    if (hl) hl.textContent = esc(tx('hra.bonus_za_rychly_start_propadl'));
    if (pod) pod.textContent = esc(tx('hra.vsechno_ostatni_dostanes_porad'));
    if (suma) suma.textContent = tCislo(zakladni);
    if (hrat) hrat.textContent = hratText || esc(tx('hra.hrat_bez_registrace'));
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
    zapis('bonus', esc(tx('hra.bonus_za_rychly_start')), START_BONUS);
    save(); paint();
    toast(tx('veta.stihl_jsi_to_bonus_za_rychly', { p1: kcFull(START_BONUS) }), 'ok');
  }
  if (ME) syncState(true);
}
$('go-quiz').onclick = function () {
  var b = $('go-quiz');
  var nick = ($('in-nick') ? $('in-nick').value : '').trim();
  var firma = ($('in-firma') ? $('in-firma').value : '').trim();
  if (nick.length < 3) return introErr(esc(tx('hra.vymysli_si_jmeno_aspon_tri')));
  if (nick.length > 24) return introErr(esc(tx('hra.jmeno_je_moc_dlouhe_nejvys')));
  if (/[\s@]/.test(nick)) return introErr(esc(tx('hra.ve_jmenu_nesmi_byt_mezery')));
  if (firma.length === 1) return introErr(esc(tx('hra.nazev_spolecnosti_ma_aspon_dva')));
  if ($('in-err')) $('in-err').classList.add('hidden');
  if (startBonusPlati()) BONUS_ZAMCEN = true;
  b.disabled = true; b.textContent = esc(tx('hra.zakladam_firmu'));
  apiJson('/account/zacni', { nick: nick, company: firma, ref: trvalePid(),
    odkud: prichoziRef(), zdroj: zjistiZdroj(), sid: visitId() }).then(function (r) {
    b.disabled = false; b.textContent = esc(tx('hra.zacit_hrat'));
    if (!r.ok) {
      // Obsazené jméno nebo překlep řešíme na místě — hra ještě nezačala.
      if (r.status === 409 || r.status === 400 || r.status === 429) {
        if (r.status === 409 && $('in-nick')) {
          $('in-nick').value = nick + Math.floor(10 + Math.random() * 90);
          $('in-nick').focus();
        }
        return introErr(r.j.error || esc(tx('hra.nepovedlo_se_2')));
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
    b.disabled = false; b.textContent = esc(tx('hra.zacit_hrat_2'));
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
  if (pridat) { S.cash += pridat; zapis('bonus', tx('veta.startovni_kapital', { p1: novy.name }), pridat); }
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
  $('q-title').textContent = tx('veta.otazka_ze', { p1: (qi + 1), p2: QUIZ.length });
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
    if (popisek) popisek.textContent = esc(tx('hra.hotovost_navic'));
    $('role-cash').textContent = kcFull(Math.max(0, p.cash - stary0.cash));
  } else {
    if (popisek) popisek.textContent = esc(tx('hra.startovni_hotovost'));
    $('role-cash').textContent = kcFull(p.cash);
  }
  $('role-ltv').textContent = tx('veta.z_ceny', { p1: Math.round(p.ltv * 100) });
  $('role-rate').textContent = tx('veta.rocne', { p1: (p.rate * 100).toFixed(1).replace('.', desZnak()) });
  // Kdo je přihlášený (třeba po „začít znovu"), už účet zakládat nemusí.
  var hint = $('role-acct');
  if (hint) hint.innerHTML = ME ? tx('veta.hrajes_jako_b_b', { p1: esc(ME.nick) }): '';
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
  if ($('map-zvon')) $('map-zvon').onclick = upozorneniSheet;
  paintZvon();
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
// ─── Výchozí pohled na mapě ──────────────────────────────────────────────
// Mapa se dřív vždycky otevřela nad středem Česka. Komu stojí prádlomaty
// v šesti zemích, tomu to k ničemu není — než najde, kde zrovna něco řeší,
// musí mapu přetáhnout přes půl Evropy. Vybranou základnu si hra pamatuje
// ve stavu, takže platí i na druhém zařízení.
var MAPA_ZOOM = 12;        // přiblížení, ve kterém je vidět okolí základny
function zakladny() {
  var out = [];
  if (S.sidlo && S.sidlo.lat != null) {
    out.push({ id: 'sidlo', nazev: S.sidlo.name, lat: S.sidlo.lat, lon: S.sidlo.lon, sidlo: true });
  }
  (S.pobocky || []).forEach(function (b) {
    if (b && b.lat != null) out.push({ id: 'pob:' + b.name, nazev: b.name, lat: b.lat, lon: b.lon });
  });
  return out;
}
// Kterou si hráč vybral. Bez volby bereme první pobočku — tam většinou
// sedí jeho hlavní provoz — a teprve když žádnou nemá, sídlo.
function vychoziZakladna() {
  var vse = zakladny();
  if (!vse.length) return null;
  var vybrana = vse.filter(function (z) { return z.id === S.mapaOd; })[0];
  if (vybrana) return vybrana;
  var pobocka = vse.filter(function (z) { return !z.sidlo; })[0];
  return pobocka || vse[0];
}
function initMap() {
  if (map) return;
  // Mapa jede z CDN. Když se nenačte (slabá síť, blokovaný skript), hra musí běžet dál
  // — jen místo mapy ukážeme hlášku a všechno ostatní se ovládá ze seznamu oblastí.
  if (typeof L === 'undefined') {
    var h = $('map-hint');
    h.textContent = esc(tx('hra.mapu_se_nepodarilo_nacist_zkontroluj'));
    h.classList.remove('hidden');
    return;
  }
  // Vlastní, nenápadný podpis místo širokého pruhu přes půl mapy. Úplně ho
  // smazat nejde — Esri nám dlaždice pouští zdarma právě proti uvedení zdroje.
  var odkud = vychoziZakladna();
  map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: GLOBUS_ZOOM })
    .setView(odkud ? [odkud.lat, odkud.lon] : [49.82, 15.47], odkud ? MAPA_ZOOM : 7);
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
      el.innerHTML = tx('veta.button_type_button_aria_label_zdroj', { p1: esc(tx('hra.mapove_podklady_copy_esri_leaflet')) });
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
      + '<i class="pin-tag">' + esc(nazev || (velke ? esc(tx('hra.sidlo_4')) : esc(tx('hra.pobocka_4')))) + '</i></div>' });
}
// Co se dá se základnou dělat — zatím jen přehled, pobočku jde prodat na Burze.
function zakladnaSheet(z, jeSidlo) {
  sheet('<h3>' + esc(z.name || (jeSidlo ? esc(tx('hra.sidlo_firmy_2')) : esc(tx('hra.pobocka_3')))) + '</h3>'
    + '<p class="muted small">' + (jeSidlo
        ? esc(tx('hra.odsud_vyjizdi_doprava_stroju_i'))
        : esc(tx('hra.provozovna_doprava_se_pocita_od'))) + '</p>'
    + (jeSidlo ? '' : tx('veta.div_class_kv_span_provoz_span', { p1: kcFull(POBOCKA_MESICNE) }))
    + '<div class="kv"><span>' + esc(tx('hra.pradlomatu_do_30_km')) + '</span><b>'
    + S.units.filter(function (u) { return u.lat != null && kmMezi(z, u) <= 30; }).length + '</b></div>'
    + (jeSidlo ? '' : '<p class="fine">' + esc(tx('hra.prodat_ji_muzes_na_burze')) + '</p>'));
}
// Koupený pozemek. Na mapě musí být na první pohled poznat, že zem je moje —
// a jestli je plocha připravená, nebo je to pořád louka.
// Cizí pozemek na mapě. Nabídka pronájmu je inzerát — má být vidět.
function ciziPozemekIcon(c) {
  var nab = !!c.pronajem;
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin pozemek cizi' + (nab ? ' nabidka' : '') + '">\u2302<i class="pin-tag">'
      + (nab ? esc(tx('hra.k_pronajmu')) : esc(tx('hra.cizi_pozemek_2'))) + '</i></div>' });
}
function pozemekIcon(sp) {
  var pl = planMista(sp.id);
  var hotovo = pl && pl.hotovo && pl.zaplaceno;
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin pozemek moje">\u2302<i class="pin-tag">'
      + (hotovo ? esc(tx('hra.plocha_hotova')) : esc(tx('hra.muj_pozemek'))) + '</i></div>' });
}
// Prověřené místo ukazuje rovnou své skóre — aby hráč nemusel klikat na každý
// špendlík zvlášť. Barva rámečku říká totéž co verdikt v detailu.
function skoreTrida(score) { return score >= 70 ? 'dobre' : score >= 55 ? 'stredni' : 'slabe'; }
function skoreIcon(cls, score) {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin ' + cls + ' skore ' + skoreTrida(score) + '">'
      + Math.round(score || 0) + '</div>' });
}
// Pozemek si nechává svůj domeček — že je na prodej, je důležitější než číslo.
// Pod ním visí cena (tu zná hráč z cedule na parcele i bez obhlídky) a
// u prověřeného pozemku ještě skóre jako malá cedulka v rohu.
function pozemekSkoreIcon(sp, seen) {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div class="pin pozemek' + (seen ? ' known' : '') + '"><span>\u2302</span>'
      + (seen ? '<i class="pin-skore ' + skoreTrida(sp.score) + '">' + Math.round(sp.score || 0) + '</i>' : '')
      + '<i class="pin-tag cena">' + esc(kc(pozemekCena(sp))) + '</i></div>' });
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
  var vada = jeVPoruse(u) || jeVKatastrofe(u);
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
      + '<i class="pin-tag">' + esc(jeVKatastrofe(u) ? u.katastrofa.t
          : vada ? u.porucha.text
          : (vyp ? tx('veta.vypoved', { p1: etaText(Math.max(0, u.vypoved.do - Date.now())).replace('za ', '') }): natrhu ? tx('veta.na_prodej', { p1: kcFull(natrhu.cena) })
          : (MODELS[u.eco && u.eco.model] ? MODELS[u.eco.model].name : ''))) + '</i></div>' });
}
// Z dálky mají v mapě být jen prádlomaty, sídlo a pobočky. Volná místa je
// v tomhle měřítku stejně nejde rozlišit — slepí se do hromádky otačníků.
var MISTA_ZOOM = 14;              // na tohle přiblížení hra skáče po průzkumu
// Odkud jsou vidět volná místa a pozemky na prodej. Dřív to bylo až od úrovně
// ulic, takže z pohledu na celé město koukal hráč na prázdnou mapu a nevěděl,
// kde má co hledat. Shlukování si s množstvím špendlíků poradí samo.
var MISTA_OD_ZOOMU = 11;
// ─── Správa servisu ──────────────────────────────────────────────
// Odznak vlevo nahoře nad mapou řekne jedním pohledem, jak síť jede. Po klepnutí
// se otevře celý přehled — který stroj stojí, kde je technik a kdy bude hotovo.
// Katastrofa (požár, vichřice, vytopení) zastaví stroj stejně jako porucha —
// dokud trvá, nevydělá ani korunu. Do počtů proto patří taky. Dřív se počítala
// mezi jedoucí, takže přehled hlásil „139 ze 140 jede, stojí 0", i když dva
// stroje stály. Pořadí je stejné jako v řádku: katastrofa má přednost před
// poruchou, protože tu stejně nejde řešit, dokud se neopraví budova.
function seOpravuje(u) {
  if (jeVKatastrofe(u)) return !!u.katastrofa.hotovo;
  return jeVPoruse(u) && !!u.technik;
}
function stojiNecinne(u) {
  if (jeVKatastrofe(u)) return !u.katastrofa.hotovo;
  return jeVPoruse(u) && !u.technik;
}
function jedeNormalne(u) { return !jeVPoruse(u) && !jeVKatastrofe(u) && !u.technik; }
function servisStav() {
  var vse = S.units || [];
  var stoji = vse.filter(stojiNecinne);
  var resi = vse.filter(seOpravuje);
  // Technik, co se vrací ze spravené poruchy — stroj už jede.
  var vraci = vse.filter(function (u) { return !jeVPoruse(u) && !jeVKatastrofe(u) && u.technik; });
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
  el.title = esc(tx('hra.sprava_servisu_2'));
  el.onclick = servisSheet;
}
// Jedna řádka přehledu. Pořadí: co stojí bez technika, co se právě řeší, co jede.
function servisRadek(u) {
  var t = u.technik, ted = Date.now(), m = MODELS[u.eco && u.eco.model];
  var stav, tr, akce = '';
  if (jeVKatastrofe(u)) {
    var k = u.katastrofa;
    tr = 'err';
    stav = k.hotovo ? tx('veta.opravuje_se_hotovo', { p1: hovorText(k.t), p2: etaText(Math.max(0, k.hotovo - ted)) })
      : tx('veta.stoji_oprava_za', { p1: hovorText(k.t), p2: kcFull(k.platim) });
    akce = k.hotovo ? '' : '<button class="btn sec maly" data-kat="' + esc(u.spotId) + '">' + esc(tx('hra.otevrit')) + '</button>';
  } else if (jeVPoruse(u) && !t) {
    var v = vyjezdOdhad(u);
    tr = 'err';
    // Když to řeší vedoucí, ať je to vidět — jinak to vypadá, že se neděje nic.
    var vyr = dispecerVyrazi(u);
    stav = hovorText(u.porucha.text)
      + (vyr != null
          ? tx('veta.vedouci_chysta_plan_servisu', { p1: etaText(vyr - ted) })
          : (v ? tx('veta.km_oprava_na_h', { p1: Math.round(v.km), p2: v.zpusob.nazev, p3: u.porucha.zav }) : ''));
    akce = v ? '<button class="btn sec maly" data-vada="' + esc(u.spotId) + '">' + esc(tx('hra.vyslat_tlacitko')) + '</button>' : '';
  } else if (t && ted < t.prijezd) {
    tr = 'warn'; stav = hovorText(u.porucha.text) + ' — ' + (ZNAK_CESTY[t.zpusob] || ZNAK_CESTY.auto)
      + tx('veta.technik_prijede', { p1: etaText(t.prijezd - ted) });
  } else if (t && jeVPoruse(u)) {
    tr = 'warn'; stav = hovorText(u.porucha.text) + tx('veta.technik_na_miste_hotovo', { p1: etaText(t.hotovo - ted) });
  } else if (t) {
    tr = 'ok'; stav = esc(tx('hra.spraveno_technik_jede_zpatky'));
  } else if (jeVeVypovedi(u)) {
    tr = 'warn'; stav = tx('veta.vypoved_z_mista_odvoz_na_sklad', { p1: etaText(Math.max(0, u.vypoved.do - Date.now())) });
  } else {
    tr = 'ok'; stav = tx('veta.jede', { p1: kcFull(u.eco.profit), p2: esc(tx('hra.mesic_2')) });
  }
  return '<div class="srv-radek" data-srv="' + esc(u.spotId) + '">'
    + '<i class="srv-tecka ' + tr + '"></i>'
    + '<span><b>' + esc(jmenoStroje(u.name)) + '</b> <i>' + esc((m ? m.name : '') + ' · ' + stav) + '</i></span>'
    + akce + '</div>';
}
function servisSheet() {
  var st = servisStav();
  // Poslední skupina jsou stroje, co jedou a nikdo u nich není. Bez vyřazení
  // katastrof by se stroj v opravě objevil v seznamu dvakrát.
  var poradi = st.stoji.concat(st.resi, st.vraci, st.vse.filter(jedeNormalne));
  sheet(tx('veta.h3_h3_p_class_muted_small_12', { p1: esc(tx('hra.sprava_servisu')), p2: st.jede, p3: st.vse.length, p4: esc(tx('hra.stoji_3')) }) + (st.stoji.length ? 'err' : '') + '">' + st.stoji.length + '</b></div>'
    + '<div><span>' + esc(tx('hra.techniku_na_ceste')) + '</span><b class="' + (st.resi.length + st.vraci.length ? 'warn' : '') + '">'
    + (st.resi.length + st.vraci.length) + '</b></div>'
    + '</div>'
    + (dispecerKapacita() && st.vse.length > dispecerKapacita()
        ? '<p class="fine warn" style="margin:8px 0 0">'
          + tx('veta.vedouci_nestiha_hlidat', { p1: dispecerKapacita(), p2: st.vse.length,
              p3: dispecerPotreba(st.vse.length) }) + '</p>'
        : '')
    + (st.stoji.length > 1
        ? tx('hra.button_class_btn_big_id_do', { p1: st.stoji.length })
        : '')
    + (poradi.length
        ? '<div class="srv">' + poradi.map(servisRadek).join('') + '</div>'
        : '<div class="empty">' + esc(tx('hra.zatim_nemas_zadny_pradlomat')) + '</div>')
    + (zaMorem().length
        ? tx('hra.p_class_fine_warn_style_margin_2', { p1: zaMoremSlovy(zaMorem().length) })
        : '')
    + tx('veta.p_class_fine_style_margin_top_2'));
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
  // Katastrofu technik nespraví — otevřeme rovnou místo, kde se platí oprava.
  [].forEach.call(document.querySelectorAll('#sheet-body [data-kat]'), function (b) {
    b.onclick = function (e) {
      e.stopPropagation();
      unitSheet(najdiJednotku(b.getAttribute('data-kat')));
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
  var blizko = !map || map.getZoom() >= MISTA_OD_ZOOMU;
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
        : jePozemek(sp) ? pozemekSkoreIcon(sp, seen)
        : seen ? skoreIcon('known', sp.score)
        : pinIcon('unknown', '?');
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
    h.textContent = esc(tx('hra.napis_mesto_a_posli_tam_2'));
    h.classList.remove('hidden');
  // Nápověda o schovaných místech patří k prvnímu rozkoukání. Po herním měsíci
  // už hráč ví, jak se mapa chová, a lišta přes půl obrazovky by jen překážela.
  // Že filtr „jen moje" schovává konkurenci, je vidět z přepínače nad mapou —
  // hlášku o tom hráč po pár minutách jen odklikává.
  } else if (skryto && Date.now() - (S.startedAt || 0) < MONTH_MS) {
    h.textContent = tx('veta.pribliz_mapu_at_uvidis_volna_mista', { p1: tx('veta.ze_seznamu_oblasti_te_hra_skoci', { p1: skryto }) });
    h.classList.remove('hidden');
  } else h.classList.add('hidden');
  paintServis();
  paintTrhBadge();
}
// Klíč oblasti je slug („hradec kralove"). Pro hráče z něj uděláme název
// města s velkými písmeny — jinde ho stejně nikde neskladujeme.
function mestoZKlice(k) {
  var a = S && S.areas && S.areas[k];
  if (a && a.name) return a.name;
  return String(k || '').replace(/(^|\s)\S/g, function (x) { return x.toUpperCase(); });
}
// Zavře panel a přiletí mapou na dané místo.
function naMapu(lat, lon) {
  if (lat == null || lon == null || !map) return false;
  closeSheet();
  map.setView([lat, lon], Math.max(16, map.getZoom()));
  return true;
}
// Panel cizího prádlomatu v neprozkoumaném městě.
function cizi(c) {
  var mesto = mestoZKlice(c.area_key);
  var zem = c.pozemek && !c.model;
  sheet(tx('veta.h3_h3_p_class_muted_small_23', { p1: esc(c.name || (zem ? esc(tx('mapa.cizi_pozemek')) : esc(tx('mapa.cizi_pradlomat')))), p2: (c.znak ? znakSvg(c.znak, 20) + ' ' : ''), p3: (zem ? esc(tx('hra.tenhle_pozemek_vlastni')) + ' ' + '<b>' : esc(tx('hra.tohle_misto_drzi_3')) + ' ' + '<b>'), p4: esc(c.firma || c.nick), p5: esc(c.nick), p6: (zem ? '' : ' · ' + esc((MODELS[c.model] || {}).name || c.model)), p7: (c.takeovers ? tx('veta.uz', { p1: c.takeovers, p2: esc(tx('mapa.zmenilo_majitele')) }): ''), p8: (zem ? '<p class="muted small">' + esc(tx('hra.pradlomat_tu_zatim_nestoji_je')) + ' '
        + (c.pronajem ? tx('veta.majitel_ji_nabizi_k_pronajmu_za', { p1: kcFull(c.pronajem.cena) })
            + (c.pronajem.sit ? ' ' + esc(tx('mapa.i_s_pripravenou_plochou')) : ' jako holou parcelu') + '. '
            + esc(tx('mapa.pronajmout_si_ji_muzes_az'))
          : esc(tx('mapa.majitel_ji_zatim_nikomu_nenabizi'))) + '</p>' : ''), p9: (mesto ? esc(mesto) + ' jsi neprozkoumal' : esc(tx('mapa.tohle_mesto_jsi_neprozkoumal'))), p10: esc(tx('mapa.bez_toho_nevis_kolik_tu')), p11: (zem ? esc(tx('mapa.posli_tam_cloveka_a_pak'))
          : esc(tx('mapa.posli_tam_cloveka_a_pak_2'))), p12: (mesto ? esc(mesto) : esc(tx('mapa.tohle_mesto'))), p13: kcFull(SCOUT_COST), p14: (S.cash < SCOUT_COST ? '<p class="fine err">' + esc(tx('mapa.na_cestu_nemas_dost_hotovosti')) + '</p>' : '') }));
  var b = $('go-scout-here');
  if (b) b.onclick = function () {
    if (S.cash < SCOUT_COST) return toast(esc(tx('mapa.na_cestu_nemas_dost_hotovosti_2')), 'err');
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
        return '<button class="mesto-chip" data-mesto="' + tx('veta.i_mist_i_button', { p1: esc(x.name), p2: esc(x.name), p3: x.mist });
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
function areasSheet(predvyplnit) {
  var done = Object.keys(S.areas).map(function (id) {
    return '<div class="area-item"><div><div class="nm">' + esc(S.areas[id].name) + '</div>'
      + '<div class="sub">nalezeno ' + S.areas[id].spots.length + tx('veta.mist_div_div_button_class_btn', { p1: esc(id) });
  }).join('');
  var zacatek = zacatecnik() && !Object.keys(S.areas || {}).length;
  sheet('<h3>' + esc(tx('hra.prozkoumat_mesto')) + '</h3>'
    + (zacatek ? tx('hra.p_class_muted_small_klepni_na', { p1: mestaHtml(''), p2: esc(tx('hra.nebo_vlastni_mesto')) }) : '')
    + tx('veta.p_class_muted_small_cesta_stoji', { p1: esc(tx('hra.napis_kam_poslat_cloveka_projde')), p2: kcFull(SCOUT_COST) })
    // Safari na iOS nabízí vyplnění adresy podle názvu a placeholderu pole. Proto
    // type="search", neutrální name/id a žádný náznak města — lišta s klíčem,
    // kartou a špendlíkem se pak nad klávesnicí neukáže.
    + tx('veta.input_id_q_area_name_hledat')
    + (predvyplnit ? ' value="' + esc(predvyplnit) + '"' : '') + '>'
    + '<button class="btn" id="do-scout"' + (S.cash < SCOUT_COST ? ' disabled' : '') + '>' + esc(tx('hra.hledat')) + '</button></div>'
    + '<p class="fine" id="city-note">'
    + (predvyplnit ? esc(tx('hra.z_mapy')) + ' ' + '<b>' + esc(predvyplnit) + '</b>' + ' ' + esc(tx('hra.staci_klepnout_na_hledat')) : '') + '</p>'
    + (S.cash < SCOUT_COST ? '<p class="fine err">' + esc(tx('hra.na_cestu_nemas_dost_hotovosti')) + '</p>' : '')
    // Nováčkovi ukazujeme hotová města hned a nahoře: psát město a čekat
    // minutu na průzkum je ta nejhorší možná první minuta ve hře.
    + (zacatek ? '' : '<div id="mesta-box">'
        + mestaHtml(esc(tx('hra.hotova_mesta_clovek_je_prosel'))) + '</div>')
    + (done ? '<h3 style="margin-top:16px">' + esc(tx('hra.uz_prozkoumano')) + '</h3>' + done : ''));
  var inp = $('q-area'), btn = $('do-scout');
  // Hotová města doplníme, jakmile dorazí ze serveru — panel na ně nečeká.
  if (!MESTA_HOTOVA) {
    loadMesta(function () {
      // Nováček má hotová města nahoře bez nadpisu, ostatní dole s vysvětlením.
      var prvni = $('mesta-box-prvni'), box = prvni || $('mesta-box');
      if (!box) return;
      box.innerHTML = mestaHtml(prvni ? '' : esc(tx('hra.hotova_mesta_clovek_je_prosel_2')));
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
// ─── Hledač chodí po městě ───────────────────────────────────────────────────
// Místo odpočtu vteřin se kreslí, co se děje: panáček jde po ulici, město mu
// běží za zády a pod tím se střídá, čím se zrovna zabývá. Je to čistě SVG
// a CSS, nic se nestahuje a nic to nestojí.
var HLEDAC_HLASKY = [
  esc(tx('hra.vystoupil_na_nadrazi_a_rozhlizi')),
  esc(tx('hra.prochazi_hlavni_tridu')),
  esc(tx('hra.obhlizi_benzinku_u_vypadovky')),
  esc(tx('hra.pocita_auta_na_parkovisti')),
  esc(tx('hra.kouka_kde_ma_konkurence_pradelnu')),
  esc(tx('hra.zastavil_se_u_obchodniho_centra')),
  esc(tx('hra.pta_se_v_mycce_kolik')),
  esc(tx('hra.meri_kolik_lidi_projde_za')),
  esc(tx('hra.zapisuje_si_adresy_a_ceny')),
  esc(tx('hra.obchazi_sidliste')),
  esc(tx('hra.prohlizi_si_zavrenou_provozovnu')),
  esc(tx('hra.dopisuje_poznamky_do_bloku'))
];
function hledacHtml() {
  // Osm domů dvakrát za sebou — díky tomu může pás jezdit dokola a napojení
  // není vidět. Výšky a šířky dáváme natvrdo, ne přes nth-child.
  var tvary = [[28, 60], [34, 38], [22, 54], [38, 30], [26, 46], [30, 58], [24, 34], [36, 44]];
  var domy = '';
  for (var i = 0; i < 16; i++) {
    var t = tvary[i % tvary.length];
    domy += '<i style="width:' + t[0] + 'px;height:' + t[1] + 'px"></i>';
  }
  return '<div class="hledac" aria-hidden="true">'
    + '<div class="hledac-mesto">' + domy + '</div>'
    + '<div class="hledac-ulice"></div>'
    + '<svg class="hledac-clovek" viewBox="0 0 36 56">'
    + '<ellipse cx="18" cy="52" rx="11" ry="2.6" fill="rgba(0,0,0,.45)"/>'
    + '<rect class="noha n1" x="13" y="32" width="4.6" height="17" rx="2.3" fill="#5a7099"/>'
    + '<rect class="noha n2" x="18.4" y="32" width="4.6" height="17" rx="2.3" fill="#44587d"/>'
    + '<rect x="12" y="15" width="12" height="19" rx="4.5" fill="#7c5cff"/>'
    + '<rect class="ruka r1" x="8.6" y="17" width="4.2" height="14" rx="2.1" fill="#6a4ddb"/>'
    + '<rect class="ruka r2" x="23.2" y="17" width="4.2" height="14" rx="2.1" fill="#8f77ff"/>'
    + '<circle cx="18" cy="8.5" r="7" fill="#f3c9a6"/>'
    + '<path d="M11 6.5q7-7 14 0l-1.2 2.6q-5.8-4.2-11.6 0z" fill="#2b2118"/>'
    + '</svg>'
    + '<i class="hledac-lupa">\uD83D\uDD0D</i>'
    + '</div>';
}
function scout(city, btn) {
  if (!city || city.length < 2) return toast(esc(tx('hra.napis_do_ktereho_mesta_se')), 'err');
  if (S.cash < SCOUT_COST) return toast(esc(tx('hra.na_cestu_nemas_dost_hotovosti_2')), 'err');
  var started = Date.now(), stop = false, timer = null, netErr = 0;
  var note = $('city-note');
  var done = function () { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  var fail = function (msg) {
    done();
    btn.disabled = false; btn.textContent = esc(tx('hra.hledat'));
    if (note) note.textContent = '';
    toast(msg, 'err');
  };
  btn.disabled = true; btn.textContent = esc(tx('hra.hledam'));
  if (note) note.innerHTML = hledacHtml()
    + tx('veta.span_class_hledac_stav_id_hledac', { p1: esc(tx('hra.projit_nove_mesto_muze_trvat')) });

  // Postup píšeme i do poznámky pod polem — tlačítko bývá na mapě překryté.
  var nabidnuto = false;
  var progress = function (s) {
    btn.textContent = esc(tx('hra.hledam_2'));
    var hl = $('hledac-stav');
    if (hl) {
      // Hláška se mění po čtyřech vteřinách, ať je vidět, že se něco děje.
      hl.innerHTML = esc(HLEDAC_HLASKY[Math.floor(s / 4) % HLEDAC_HLASKY.length])
        + '\u2026 <b>' + s + ' s' + '</b><br>' + esc(tx('hra.nech_stranku_otevrenou_muze_to'));
    } else if (note) {
      note.innerHTML = hledacHtml() + '<span class="hledac-stav" id="hledac-stav"></span>';
    }
    // Po deseti vteřinách nabídneme města, kde už někdo byl — ta se otevřou
    // hned. Nový hráč tak nemusí čekat na první hledání vůbec.
    if (s >= 10 && !nabidnuto) {
      nabidnuto = true;
      loadMesta(function () {
        var box = $('mesta-box');
        if (!box || stop) return;
        box.innerHTML = mestaHtml(esc(tx('hra.nechces_cekat_tahle_mesta_jsou')));
        bindMesta(function (mesto) { done(); btn.disabled = false; btn.textContent = esc(tx('hra.hledat_2')); scout(mesto, btn); });
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
      .then(function (r) { return r.json().then(function (j) { if (!r.ok && r.status !== 202) throw new Error(j.error || (tx('veta.chyba', { p1: r.status }))); return j; }); })
      .then(function (j) {
        if (stop) return;
        netErr = 0;
        if (j && j.pending) {
          var s = Math.round((Date.now() - started) / 1000);
          if (Date.now() - started > SCOUT_MAX_WAIT) {
            return fail(esc(tx('hra.zabralo_to_moc_casu_ale')));
          }
          progress(s);
          timer = setTimeout(poll, 2500);
          return;
        }
        done();
        btn.disabled = false; btn.textContent = esc(tx('hra.hledat_3'));
        if (note) note.textContent = '';
        if (!j.spots || !j.spots.length) return toast(esc(tx('hra.tam_se_nic_vhodneho_nenaslo')), 'err');
        var id = j.area.id;
        var known = S.areas[id] ? S.areas[id].spots.length : 0;
        // Už prozkoumané město neúčtujeme znovu — jen hráče hodíme na mapu.
        if (known >= j.spots.length) {
          zalozSidlo(j.area);
          closeSheet();
          if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], MISTA_ZOOM);
          return toast(tx('veta.uz_mas_prozkoumany_koukni_na_mapu', { p1: j.area.name }), 'ok');
        }
        S.cash -= SCOUT_COST;
        zapis('pruzkum', tx('veta.pruzkum_mesta', { p1: j.area.name }), -SCOUT_COST);
        S.areas[id] = { name: j.area.name, lat: j.area.lat, lon: j.area.lon, scoutedAt: Date.now(), spots: (j.spots || []).map(fixMetrics) };
        zalozSidlo(j.area);
        save(); paint(); drawMap(); closeSheet(); syncState(true);
        ev('game_scout');
        loadClaims();   // ať hráč hned vidí, kde už konkurence stojí
        if (map && j.area.lat) map.setView([j.area.lat, j.area.lon], MISTA_ZOOM);
        toast(tx('veta.nalezeno_mist', { p1: j.area.name, p2: j.spots.length }), 'ok');
        // Na začátku hráče nenecháme hádat, do čeho klepnout: nejlepší místo
        // mu obhlídneme zdarma a rovnou ukážeme i s čísly.
        prvniMisto(id);
      })
      .catch(function (e) {
        if (stop) return;
        // Krátký výpadek sítě (tunel, přepnutí Wi-Fi) hledání nezabíjí — zkusíme to znovu.
        if (++netErr <= 5 && Date.now() - started < SCOUT_MAX_WAIT) { timer = setTimeout(poll, 3000); return; }
        fail(e.message || esc(tx('hra.spojeni_se_serverem_vazne')));
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
    toast(esc(tx('hra.nejlepsi_misto_ve_meste_jsme')), 'ok');
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
    sheet('<h3>' + (poz0 ? esc(tx('hra.pozemek_na_prodej')) : esc(tx('hra.neproverene_misto'))) + '</h3>'
      + '<p class="muted small">' + (poz0
          ? tx('veta.na_parcele_je_cedule_takze_vymeru'): esc(tx('hra.vis_jen_ze_tu_neco'))) + '</p>'
      + '<div class="kv"><span>' + esc(tx('hra.typ_mista')) + '</span><b>' + esc(KIND_LABEL[sp.kind] || esc(tx('hra.neznamy'))) + '</b></div>'
      + (poz0 ? '<div class="kv"><span>' + esc(tx('hra.vymera')) + '</span><b>' + pozemekM2(sp) + ' m²</b></div>'
          + '<div class="kv"><span>' + esc(tx('hra.cena_pozemku')) + '</span><b>' + kcFull(pozemekCena(sp))
          + '</b> <span class="muted small">(' + kcFull(pozemekZaM2(sp)) + ' / m²)</span></div>' : '')
      + '<div class="kv"><span>' + esc(tx('hra.cena_obhlidky')) + '</span><b' + (obhlidkaCena() ? '' : ' class="ok"') + '>'
      + (obhlidkaCena() ? kcFull(obhlidkaCena()) : esc(tx('hra.prvni_zdarma'))) + '</b></div>'
      + '<button class="btn big" id="do-reveal"' + (S.cash < obhlidkaCena() ? ' disabled' : '') + '>' + esc(tx('hra.proverit_misto')) + '</button>'
      + (S.cash < obhlidkaCena() ? '<p class="fine">' + esc(tx('hra.na_obhlidku_nemas_dost_hotovosti')) + '</p>' : ''));
    var b = $('do-reveal');
    if (b) b.onclick = function () {
      var cena = obhlidkaCena();
      S.cash -= cena;
      if (cena) zapis('pruzkum', tx('veta.provereni_mista', { p1: (sp.name || '') }), -cena);
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
    + '<p class="muted small">' + esc(KIND_LABEL[sp.kind] || esc(tx('hra.misto'))) + ' · ' + esc(S.areas[areaId] ? S.areas[areaId].name : '')
    // Co hráč koupil, se mu už nenabízí — v hlavičce stojí, že zem je jeho.
    + (mamPozemek(sp.id) ? ' · <b class="ok">' + esc(tx('hra.tvuj_pozemek')) + '</b>'
        : najemniMoje ? ' · <b class="ok">' + esc(tx('hra.pronajaty_pozemek')) + '</b>'
        : jePozemek(sp) ? ' · ' + '<b class="ok">' + esc(tx('hra.pozemek_na_prodej_2')) + '</b>' : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<div class="kv"><span>' + esc(tx('hra.parkovacich_ploch_v_okoli')) + '</span><b>' + (mnum(sp.parking) != null ? mnum(sp.parking) + (sp.parking_m != null ? ' (' + sp.parking_m + ' m)' : '') : '—') + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.konkurence_do_1_5_km')) + '</span><b>' + (mnum(sp.competition) != null ? mnum(sp.competition) : '—') + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.tahouni_provozu')) + '</span><b>' + (mnum(sp.anchors) != null ? mnum(sp.anchors) : '—') + '</b></div>';

  // 2. krok — domluvit s majitelem nájem. Zadarmo, ale bez něj se stavět nedá.
  if (!lease && jePozemek(sp) && !mamPozemek(sp.id)) {
    var cenaZ = pozemekCena(sp);
    var fz = canFinance(cenaZ, null, cenaZ);   // zem je zástava sama o sobě
    sheet(tx('veta.button_class_btn_big_id_do', { p1: head, p2: pozemekKarta(sp), p3: (fz.ok ? '' : ' disabled'), p4: kcFull(cenaZ), p5: (fz.ok
          ? tx('veta.p_class_fine_kupujes_samotnou_zem'): '<p class="fine err">' + esc(fz.duvod || esc(tx('hra.na_pozemek_zatim_nemas'))) + '</p>') }));
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
      + '<div class="card"><div class="row"><h3>' + esc(tx('hra.tvuj_pozemek_2')) + '</h3><b class="ok">' + (zem0.m2 || pozemekM2(sp)) + tx('veta.m_b_div_p_class_muted', { p1: kcFull(zem0.cena || pozemekCena(sp)) })
      + (pady0.length
          ? '<div class="kv" style="margin-top:10px"><span>' + esc(tx('hra.zaplacena_priprava_plochy')) + '</span><b class="ok">'
            + kcFull(pl0.zaplaceno) + '</b></div>'
            + '<div class="kv"><span>' + esc(tx('hra.stani_na_pradlomaty')) + '</span><b>' + stoji0 + ' z ' + pady0.length + ' obsazeno</b></div>'
          : '')
      + (najemce0 ? '' : '<button class="btn big" id="do-priprava-start" style="width:100%;margin-top:12px">'
          + (pady0.length ? esc(tx('hra.rozsirit_nebo_predelat_plochu')) : esc(tx('hra.pripravit_plochu'))) + '</button>')
      + (pady0.length || najemce0 ? ''
          : tx('hra.p_class_fine_cestu_parkovani_dlazbu'))
      + '</div>'
      + pronajemKarta(sp, claim, pady0.length > 0, stoji0)
      + (najemce0 ? '' : pady0.length
          ? '<h3 style="margin-top:18px">' + esc(tx('hra.stani_na_plose')) + '</h3>'
            + pady0.map(function (pd, i) {
                var obsaz = padObsazen(sp, i), mm = MODELS[pd.model] || MODELS.mini;
                var skl = inStock(pd.model), cest = onWay(pd.model);
                return '<div class="card"><div class="row"><h3>' + (i + 1) + tx('hra.stani_h3_b_class', { p1: esc(mm.name) }) + (obsaz ? 'ok' : '') + '">' + (obsaz ? esc(tx('hra.stoji')) : esc(tx('hra.volne'))) + '</b></div>'
                  + (obsaz
                      ? '<p class="muted small" style="margin:4px 0 8px">' + esc(tx('hra.pradlomat_je_v_provozu')) + '</p>'
                        + '<button class="btn sec sm" style="width:100%" data-pad-detail="' + i + '">' + esc(tx('hra.otevrit_detail')) + '</button>'
                      : skl > 0
                        ? tx('veta.p_class_muted_small_style_margin_5', { p1: esc(tx('hra.plocha_je_zaplacena_plati_se')), p2: i, p3: esc(mm.name), p4: skl, p5: esc(tx('hra.skladem_4')) })
                        : cest > 0
                          ? tx('veta.p_class_fine_warn_style_margin', { p1: cest, p2: esc(mm.name) })
                          : tx('veta.p_class_muted_small_style_margin_3', { p1: esc(mm.name) }))
                  + '</div>';
              }).join('')
          : '')
      + (najemce0 ? '' : tx('hra.h3_style_margin_top_18px_co', { p1: Math.round(padPodil(1) * 100), p2: Math.round(padPodil(2) * 100) })
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
    // Nováček řeší podmínky smlouvy dřív, než vůbec ví, co je prádlomat. Dokud
    // nemá první nájem, vidí jen výchozí podmínky a jedno tlačítko; kdo chce,
    // rozklikne si je. Pak už se smlouva sjednává normálně.
    var jednoduse = zacatecnik() && !Object.keys(S.leases || {}).length;
    var vykresli = function () {
      var cena = najemSPodminkami(sp, nv.doba, nv.vypoved);
      var popis = '';
      NAJEM_DOBY.forEach(function (d) { if (d.m === nv.doba) popis = d.p; });
      sheet(head
        + '<h3 style="margin-top:18px">' + esc(tx('hra.najemni_smlouva')) + '</h3>'
        + '<p class="muted small">' + esc(tx('hra.nez_sem_neco_postavis_musis')) + ' '
        + esc(tx('hra.cim_delsi_jistotu_chces_tim')) + '</p>'
        + (jednoduse ? '' : '<p class="muted small" style="margin:10px 0 4px"><b>' + esc(tx('hra.na_jak_dlouho_se_vazes')) + '</b></p>'
        + '<div class="seg sub najem-seg">' + NAJEM_DOBY.map(function (d) {
            return '<button class="' + (d.m === nv.doba ? 'on' : '') + '" data-doba="' + d.m + '">'
              + (d.m ? (d.m / 12) + (d.m === 12 ? ' rok' : (d.m < 60 ? ' roky' : ' let')) : esc(tx('hra.neurcito'))) + '</button>';
          }).join('') + '</div>'
        + '<p class="fine">' + esc(popis) + '</p>')
        + (jednoduse ? '' : '<p class="muted small" style="margin:12px 0 4px"><b>' + esc(tx('hra.vypovedni_doba')) + '</b></p>'
        + '<div class="seg sub najem-seg">' + NAJEM_VYPOVEDI.map(function (m) {
            return '<button class="' + (m === nv.vypoved ? 'on' : '') + tx('hra.data_vyp_mes_button', { p1: m, p2: m });
          }).join('') + tx('veta.div_p_class_fine_kdyz_te'))
        + '<div class="kv" style="margin-top:14px"><span>' + esc(tx('hra.najem_za_techhle_podminek')) + '</span><b class="'
        + (cena > rentOf(sp) ? 'warn' : 'ok') + '">' + kcFull(cena) + ' ' + esc(tx('hra.mesic_5')) + '</b></div>'
        + (cena > rentOf(sp)
            ? '<div class="kv"><span>' + esc(tx('hra.priplatek_za_jistotu')) + '</span><b>+' + kcFull(cena - rentOf(sp))
              + ' (' + Math.round((najemKoef(nv.doba, nv.vypoved) - 1) * 100) + ' %)</b></div>'
            : '')
        + '<button class="btn big" id="do-lease" style="width:100%;margin-top:12px">' + esc(tx('hra.domluvit_najem')) + '</button>'
        + (jednoduse
            ? '<p class="fine"><a href="#" id="do-najem-vic">' + esc(tx('hra.chci_si_vybrat_podminky_smlouvy')) + '</a></p>'
            : tx('veta.p_class_fine_z_doby_urcite', { p1: ODSTUPNE_MAX })));
      var vic = $('do-najem-vic');
      if (vic) vic.onclick = function (e) { e.preventDefault(); jednoduse = false; vykresli(); };
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
        toast(tx('veta.najem_domluven_na_mesicne_vypoved', { p1: kcFull(S.leases[sp.id].rent), p2: dobaNazev(nv.doba).toLowerCase(), p3: vypovedNazev(nv.vypoved) }), 'ok');
      };
    };
    vykresli();
    return;
  }

  // 3. krok — vybrat stroj a zaplatit přípojky.
  sheet(head
    + '<div class="kv"><span>' + esc(tx('hra.domluveny_najem')) + '</span><b class="ok">' + kcFull(lease.rent) + ' ' + esc(tx('hra.mesic_6')) + '</b></div>'
    + '<div class="kv"><span>' + (jeZasitovane(sp) ? esc(tx('hra.instalace_na_tomhle_miste')) : esc(tx('hra.pripojky_na_tomhle_miste'))) + '</span><b'
    + (jeZasitovane(sp) ? ' class="ok"' : '') + '>' + kcFull(connPrice(sp, 'flex')) + '</b>' + ' ' + '<span class="muted small">' + esc(tx('hra.u_maxu_o_20_vic')) + '</span></div>'
    + (jeZasitovane(sp) ? tx('veta.p_class_fine_ok_platis_jen', { p1: esc(tx('hra.zasitovane_misto_voda_odpad_i')), p2: Math.round(INSTALACE_PODIL * 100) }) : '')
    + '<h3 style="margin-top:18px">' + esc(tx('hra.co_tu_postavit')) + '</h3>'
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
function cislo1(x) { return tCislo2(String(Math.round((Number(x) || 0) * 10) / 10)); }
// Jednou větou, jestli je stroj na tohle místo akorát, malý, nebo zbytečný.
function kapacitaSlovy(e) {
  var p = Number(e.poptavka) || 0, k = Number(e.kapacita) || 0;
  if (!p) return esc(tx('hra.na_tomhle_miste_skoro_nikdo'));
  if (k >= p * 1.25) return esc(tx('hra.na_tohle_misto_je_zbytecne'));
  if (k <= p * 0.7) return esc(tx('hra.misto_uveze_vic_nez_tenhle'));
  return esc(tx('hra.na_tohle_misto_sedi_pobere'));
}
// Karta modelu na konkrétním místě. Postavit jde jen to, co je skladem — jinak vede do obchodu.
function modelCard(sp, e, pridej, bezTlacitka) {
  var m = MODELS[e.model], n = inStock(e.model), way = onWay(e.model);
  var btn;
  if (bezTlacitka) btn = '';
  else if (n > 0) btn = tx('veta.button_class_btn_sm_style_width', { p1: e.model, p2: n, p3: esc(tx('hra.skladem_5')) });
  else if (way > 0) btn = '<p class="fine warn" style="margin:10px 0 0">' + way + esc(tx('hra.je_na_ceste_az_dorazi')) + '</p>';
  else btn = '<button class="btn sec sm" style="width:100%;margin-top:10px" data-doobchodu="' + e.model + '">' + esc(tx('hra.neni_skladem_do_obchodu')) + '</button>';
  return '<div class="card"><div class="row"><h3>' + tx('veta.h3_b_b_div_p_class', { p1: m.name, p2: kc(e.invest), p3: CUR, p4: esc(modelPopis(m.key)), p5: esc(tx('hra.misto_nabidne')), p6: cislo1(e.poptavka) }) + (e.kapacita < e.poptavka ? 'warn' : 'ok') + tx('veta.z_toho_b_div_p_class', { p1: cislo1(Math.min(e.kapacita, e.poptavka)), p2: kapacitaSlovy(e), p3: Math.round(traffic() * 100), p4: String(e.perday).replace('.', desZnak()), p5: esc(tx('hra.obrat_mesic_2')), p6: kcFull(e.revenue), p7: esc(tx('hra.najem_mesic_2')), p8: kcFull(e.rent), p9: pct(ENERGY_SHARE), p10: kcFull(e.energy), p11: pct(SERVIS_SHARE), p12: kcFull(e.servis), p13: esc(tx('hra.zisk_mesic_4')) }) + (e.profit > 0 ? 'ok' : 'err') + '">' + kcFull(e.profit) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.pripojky_jednorazove')) + '</span><b>' + kcFull(e.conn) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.navratnost')) + '</span><b>' + (e.payback ? e.payback.toFixed(1).replace('.', desZnak()) + ' roku' : 'nikdy') + '</b></div>'
    + btn + (pridej || '') + '</div>';
}

// ─── Financování (hotovost + úvěr z banky) ───────────────────────────────────
// Používá se stejně na nákup stroje v obchodě i na instalaci na místě, aby se
// hráč nikdy nezasekl bez hotovosti a bez možnosti si půjčit.
function investedTotal() { return S.units.reduce(function (a, u) { return a + u.eco.invest; }, 0); }
// ─── Hodnosti ────────────────────────────────────────────────────────────────
// Žebřík si hra drží jen jako zálohu — platný seznam přijde ze serveru s
// /account/me. Kdyby se obě kopie rozešly, hráč by v liště viděl jiný titul,
// než jaký u něj vidí ostatní v žebříčku a na burze.
var HODNOSTI_HRA = [
  { id: 'pradlak', nazev: esc(tx('hra.pradlak')), od: 0, odmena: null },
  { id: 'zivnostnik', nazev: esc(tx('hra.zivnostnik')), od: 3e6, odmena: { cash: 150000 } },
  { id: 'provozovatel', nazev: esc(tx('hra.provozovatel')), od: 10e6, odmena: { karta: 'credit' } },
  { id: 'sitar', nazev: esc(tx('hra.majitel_site')), od: 30e6, odmena: { cash: 1e6 } },
  { id: 'magnat', nazev: esc(tx('hra.magnat')), od: 80e6, odmena: { karta: 'traffic' } },
  { id: 'baron', nazev: esc(tx('hra.baron_pradla')), od: 200e6, odmena: { cash: 5e6 } },
  { id: 'legenda', nazev: esc(tx('hra.legenda')), od: 500e6, odmena: { karta: 'credit' } }
];
function hodnostHra(jmeni) {
  var j = Number(jmeni) || 0, i = 0;
  for (var k = 0; k < HODNOSTI_HRA.length; k++) if (j >= HODNOSTI_HRA[k].od) i = k;
  var h = HODNOSTI_HRA[i], d = HODNOSTI_HRA[i + 1] || null;
  return { stupen: i, id: h.id, nazev: h.nazev, od: h.od,
    dalsi: d ? d.nazev : null, dalsi_od: d ? d.od : null,
    doDalsi: d ? Math.max(0, d.od - j) : null };
}
function mojeHodnost() { return hodnostHra(S ? cisteJmeni() : 0); }
// Celý žebřík v Já: kde stojím, kolik zbývá do další mety a co který stupeň dá.
// Smysl té karty je orientace — hráč má pořád vidět, co je příště.
// Povýšení je jediná chvíle, kdy má smysl hráče vyrušit — jinak je hodnost
// tichá informace v liště. Ukazuje se jednou na stupeň, i po návratu do hry.
// Odznak Pět hvězd chce týden v kuse, ne jeden dobrý okamžik — proto si hra
// pamatuje, odkdy hodnocení nepřetržitě drží nad čtyřmi a půl.
var HVEZDY_META = 4.5;
function hlidejHvezdy() {
  if (!S) return;
  if (hvezdy() >= HVEZDY_META) { if (!S.hvezdyOd) { S.hvezdyOd = Date.now(); save(); } }
  else if (S.hvezdyOd) { S.hvezdyOd = 0; save(); }
}
function hlidejHodnost() {
  if (!S || !ME || S.tut !== 'done') return;
  var h = mojeHodnost();
  if (!S.hodnostVidena) { S.hodnostVidena = h.id; S.hodnostMax = h.stupen; save(); return; }
  if (S.hodnostVidena === h.id) return;
  var byl = -1, je = h.stupen;
  for (var i = 0; i < HODNOSTI_HRA.length; i++) if (HODNOSTI_HRA[i].id === S.hodnostVidena) byl = i;
  S.hodnostVidena = h.id;
  // Odměna se platí za stupeň jednou. Kdo spadne a vyšplhá se zpátky, povýšení
  // uvidí znovu, ale slibovat mu podruhé peníze by byla lež.
  var poprve = je > (S.hodnostMax == null ? -1 : S.hodnostMax);
  if (poprve) S.hodnostMax = je;
  save();
  if (je <= byl) return;          // propad hodnosti neoslavujeme ani nehlásíme
  var o = poprve ? (HODNOSTI_HRA[je] || {}).odmena : null;
  sheet(tx('veta.h3_h3_p_class_muted_small_19', { p1: esc(tx('hra.u_1f3c5_povyseni')), p2: esc(h.nazev), p3: kcFull(h.od) })
    + (o ? '<div class="kv souhrn"><span>' + esc(tx('hra.odmena')) + '</span><b class="ok">' + esc(odmenaSlovy(o)) + '</b></div>'
         + '<p class="fine">' + esc(tx('hra.hotovost_i_karty_pripise_server')) + '</p>' : '')
    + (h.dalsi ? '<div class="kv"><span>' + esc(tx('hra.dalsi_meta')) + '</span><b>' + esc(h.dalsi) + ' od '
        + kcFull(h.dalsi_od) + '</b></div>' : '<p class="fine">' + esc(tx('hra.vic_stupnu_uz_neni_gratuluju')) + '</p>')
    + '<button class="btn big" id="hod-ok" style="width:100%;margin-top:10px">' + esc(tx('hra.diky')) + '</button>');
  if ($('hod-ok')) $('hod-ok').onclick = closeSheet;
  toast(tx('veta.povysil_jsi_na', { p1: h.nazev }), 'ok', true);
}
function hodnostHtml() {
  if (!S) return '';
  var h = mojeHodnost(), net = cisteJmeni();
  var postup = 100;
  if (h.dalsi_od != null) {
    var od = h.od, do_ = h.dalsi_od;
    postup = do_ > od ? Math.max(0, Math.min(100, Math.round((net - od) / (do_ - od) * 100))) : 0;
  }
  var radky = HODNOSTI_HRA.map(function (x, i) {
    var mam = i <= h.stupen;
    return '<div class="hod-r' + (mam ? ' mam' : '') + (i === h.stupen ? ' ted' : '') + '">'
      + '<span class="hod-n">' + (mam ? '\u2713 ' : '') + esc(x.nazev) + '</span>'
      + '<span class="hod-od">' + (x.od ? 'od ' + kc(x.od) : 'start') + '</span>'
      + '<span class="hod-o">' + esc(odmenaSlovy(x.odmena)) + '</span></div>';
  }).join('');
  return '<div class="card"><h3>' + esc(tx('hra.hodnost')) + '</h3>'
    + '<div class="kv souhrn"><span>' + esc(h.nazev) + '</span><b>' + kcFull(net) + '</b></div>'
    + (h.dalsi
        ? tx('veta.div_class_bar_i_style_width', { p1: postup, p2: esc(h.dalsi), p3: kcFull(h.doDalsi) })
        : '<p class="fine">' + esc(tx('hra.jsi_na_nejvyssim_stupni_vys')) + '</p>')
    + '<div class="hod-tab">' + radky + '</div>'
    + '<p class="fine">' + esc(tx('hra.hodnost_se_pocita_z_cisteho')) + ' '
    + esc(tx('hra.vidi_ji_i_ostatni_v')) + '</p></div>';
}
function hodnostNazev(id) {
  for (var i = 0; i < HODNOSTI_HRA.length; i++) if (HODNOSTI_HRA[i].id === id) return HODNOSTI_HRA[i].nazev;
  return '';
}
// Co stupeň dává, jednou větou — do přehledu žebříku.
function odmenaSlovy(o) {
  if (!o) return '—';
  if (o.cash) return kcFull(o.cash);
  if (o.karta) {
    // Katalog karet přijde ze serveru až po načtení; než dorazí, ať tam nesvítí
    // technický název jako „credit".
    var ceske = { rush: esc(tx('hra.expresni_dovoz')), traffic: esc(tx('hra.reklamni_kampan')),
      connect: esc(tx('hra.znamy_remeslnik')), credit: esc(tx('hra.lepsi_banker')) };
    var c = (CARDS_CAT || []).filter(function (x) { return x.kind === o.karta; })[0];
    return tx('hra.karta_x', { p1: (c ? polNazev(c) : (ceske[o.karta] || o.karta)) });
  }
  return '—';
}

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
      duvod = tx('veta.chybi_ti_2', { p1: tx('veta.mas_v_hotovosti_a_banka_doplati', { p1: kcFull(chybi), p2: kcFull(S.cash), p3: kcFull(canBorrow) }), p2: (dscr <= ltvRoom && dscr <= S.bank
            ? tx('hra.zastava_by_dovolila_ale_tolik_by', { p1: kcFull(Math.min(ltvRoom, S.bank)), p2: KRYTI_MIN.toFixed(2).replace('.', desZnak()) })
              + (jeZacatek() ? ' ' + esc(tx('hra.zacni_mensim_strojem_nebo_mistem')) : '')
          : S.bank < ltvRoom
            ? ' ' + esc(tx('hra.vic_ji_ted_ve_volnem'))
            : tx('hra.na_vic_nemas_zastavu_uverovy_strop', { p1: kcFull(ltvRoom) })) });
    } else duvod = tx('veta.chybi_ti', { p1: kcFull(chybi) });
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
  if (!(zisk > 0)) return esc(tx('hra.zatim_ti_nic_nepriteka_postav'));
  var mesicu = Math.ceil(chybi / zisk);
  var dni = Math.max(1, Math.round(mesicu / 2));
  return tx('veta.pri_zisku', { p1: tx('veta.za_mesic_na_to_budes_mit', { p1: kcFull(zisk), p2: mesicu, p3: mn(mesicu, esc(tx('hra.herni_mesic_3')), esc(tx('hra.herni_mesice_2')), esc(tx('hra.hernich_mesicu_2'))), p4: dni, p5: mn(dni, 'den', 'dny', esc(tx('hra.dni'))) }) });
}
// ─── Agent: balíček přesně tam, kde hráč narazil ─────────────────────────────
// Pravidlo je přísné, aby to nebylo otravné: ozve se jedině tehdy, když hráč
// na něco opravdu nemá A ZÁROVEŇ by to ten balíček spravil. Koupený balík jde
// do rámce a skládá se jako zástava, takže pomůže jen tam, kde banku brzdí
// rámec nebo zástava. Když ji brzdí splátka — výdělek by nový úvěr neunesl —
// nepomohl by a my mlčíme. Žádné vyskakování jinde ve hře není.
var AGENT_ZPET = null;
function balikNaZed(amount, strop) {
  if (!PAYMENTS_ON || !CASH_CAT || !CASH_CAT.length || !S) return null;
  var puvB = S.bank, puvD = S.duvera || 0, nalez = null;
  var podleVelikosti = CASH_CAT.slice().sort(function (a, b) { return a.laundry - b.laundry; });
  for (var i = 0; i < podleVelikosti.length && !nalez; i++) {
    S.bank = puvB + podleVelikosti[i].laundry;
    S.duvera = puvD + podleVelikosti[i].laundry;
    // Strop smí být i funkce — u prvního stroje se počítá ze zástavy, takže
    // se musí přepočítat až s balíkem, jinak by vyšel pořád ten původní.
    var f = canFinance(amount, null, typeof strop === 'function' ? strop() : strop);
    if (f && f.ok) nalez = podleVelikosti[i];
  }
  S.bank = puvB; S.duvera = puvD;
  return nalez;
}
// Vrátí kus HTML do panelu, kde hráč zrovna narazil. Prázdný řetězec znamená
// „tady se neozýváme“ — volající s tím počítá.
function agentHtml(amount, strop, zpet) {
  var c = balikNaZed(amount, strop);
  if (!c) return '';
  AGENT_ZPET = zpet || null;
  return '<div class="card agent"><h3>' + tx('veta.h3_p_class_muted_small_style_7', { p1: esc(tx('hra.rychla_cesta_dal')), p2: esc(tx('hra.balik')), p3: esc(polNazev(c)), p4: kcFull(c.laundry), p5: esc(c.kind), p6: kcFull(c.laundry), p7: cenaReal(c.price_czk), p8: '', p9: kcFull(BANK_PER_DAY) });
}
function bindAgent() {
  var b = document.querySelector('[data-agent]');
  if (!b) return;
  b.onclick = function () {
    // Po zaplacení se hráč vrací přes Stripe, tedy po znovunačtení stránky —
    // kam se měl vrátit, proto musí přežít v uloženém stavu.
    if (AGENT_ZPET && S) { AGENT_ZPET.kdy = Date.now(); S.agentZpet = AGENT_ZPET; save(); }
    buyCash(b.getAttribute('data-agent'));
  };
}
// Peníze dorazily — otevřeme zpátky to, kvůli čemu si je hráč kupoval.
var AGENT_VRACENO = false;
function agentNavrat() {
  var z = S && S.agentZpet;
  if (!z) return;
  delete S.agentZpet; save();
  if (Date.now() - (z.kdy || 0) > 2 * 3600e3) return;
  AGENT_VRACENO = true;
  var sp = null, a = S.areas && z.areaId ? S.areas[z.areaId] : null;
  if (a) (a.spots || []).forEach(function (x) { if (x.id === z.spotId) sp = x; });
  if (z.typ === 'stroj') { switchTab('shop'); return buySheet(z.model); }
  if (!sp) return;
  switchTab('map');
  if (z.typ === 'stavba') return installSheet(sp, z.areaId, z.model, false, z.pad);
  if (z.typ === 'priprava') return pripravaSheet(sp, z.areaId);
  if (z.typ === 'pozemek') return spotSheet(sp, z.areaId);
}
// Zeď, na kterou se nedá klepnout dál: řekneme proč, a jestli by to balíček
// spravil, nabídneme ho. Když by nepomohl, zůstane jen hláška jako dřív.
function zedSheet(nadpis, f, amount, strop, zpet) {
  var h = agentHtml(amount, strop, zpet);
  if (!h) return toast((f && f.duvod) || esc(tx('hra.na_tohle_zatim_nemas')), 'err');
  sheet('<h3>' + esc(nadpis) + '</h3>'
    + '<p class="fine err">' + esc((f && f.duvod) || '') + '</p>'
    + '<p class="fine">' + esc(dohnat(f && f.chybi)) + '</p>' + h);
  bindAgent();
}
function doFinance(f, vazba) {
  S.cash -= f.own; S.bank -= f.need; pricistDluh(f.need, prirazkaZa(f.need), vazba);
  zapis('nakup', (vazba && vazba.popis) || esc(tx('hra.nakup')), -f.own, f.need);
}
// Stroj se kupuje dřív, než ví, kde bude stát. Až se postaví, úvěr na něj
// přivážeme k tomu místu — jinak by nešlo říct, že je ten prádlomat doplacený.
function pripojUverKeStroji(spotId, nazev) {
  var l = (S.loans || []).filter(function (x) { return x.druh === 'stroj' && !x.spotId; })
    .sort(function (a, b) { return a.zalozen - b.zalozen; })[0];
  if (!l) return;
  l.spotId = spotId;
  l.druh = 'misto';
  l.popis = tx('veta.pradlomat_3', { p1: (nazev || esc(tx('hra.misto_7'))) });
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
  var t = (v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', desZnak()));
  return ' <span class="pct">' + t + ' %</span>';
}
function financeRows(f) {
  var p = PROFILES[S.profile];
  var lze = f.maxOwn > f.minOwn;   // je vůbec co nastavovat?
  return '<div class="kv"><span>' + esc(tx('hra.tvoje_hotovost')) + '</span><b>' + kcFull(f.cash) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.cena')) + '</span><b>' + kcFull(f.amount) + '</b></div>'
    + (lze
      ? tx('veta.label_class_fld_span_kolik_das', { p1: pctNote(f.own, f.amount), p2: f.minOwn, p3: f.maxOwn, p4: Math.round(f.own) }) + (f.minOwn > 0 ? tx('hra.nejmin_musis_dat_ze_sveho', { p1: kcFull(f.minOwn) }) : esc(tx('hra.muzes_dat_od_nuly')) + ' ')
        + tx('veta.nejvic_zbytek_doplati_banka_p', { p1: kcFull(f.maxOwn) })
      : '<div class="kv"><span>' + esc(tx('hra.z_vlastni_hotovosti_akontace')) + '</span><b>' + kcFull(f.own) + pctNote(f.own, f.amount) + '</b></div>')
    + '<div class="kv"><span>' + esc(tx('hra.doplati_banka_uver')) + '</span><b class="' + (f.need > 0 ? 'warn' : '') + '">' + kcFull(f.need) + pctNote(f.need, f.amount) + '</b></div>'
    + (f.need > 0 ? tx('veta.div_class_kv_span_span_b_3', { p1: esc(tx('hra.uverovy_strop_profilu')), p2: kcFull(f.ltvRoom), p3: (f.dscr != null && f.dscr < Math.min(f.ltvRoom, S.bank)
          ? '<div class="kv"><span>' + esc(tx('hra.strop_podle_vydelku')) + '</span><b class="warn">' + kcFull(f.dscr) + '</b></div>'
            + tx('uver.zastava_by_dovolila_vic_vydelek')
            + KRYTI_MIN.toFixed(2).replace('.', desZnak()) + esc(tx('hra.vic_ti_na_tohle_ted')) + '</p>'
          : ''), p4: esc(tx('hra.volny_ramec_v_bance')), p5: kcFull(S.bank), p6: esc(tx('hra.urok_z_teto_pujcky')), p7: ((rateOf() + prirazkaZa(f.need)) * 100).toFixed(1).replace('.', desZnak()), p8: (prirazkaZa(f.need) ? tx('veta.span_class_warn_za_riziko_span', { p1: (prirazkaZa(f.need) * 100).toFixed(1).replace('.', desZnak()) }) : '') }) : '');
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
    st += '<b class="way">' + MODELS[o.model].name + tx('veta.na_ceste_2', { p1: etaText(o.arrivesAt - Date.now()) })
      + (mamRush ? '<button class="btn sm rush" data-rush="' + o.orderedAt + '">' + esc(tx('mapa.dorucit_hned')) + '</button>' : '')
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
      + tx('veta.div_class_shop_img_img_src', { p1: esc(im.src), p2: m.name, p3: m.name, p4: kc(price), p5: CUR, p6: esc(modelPopis(m.key)), p7: esc(tx('mapa.pobere_denne')), p8: cislo1(m.kapacita), p9: esc(tx('mapa.hodi_se_na_mista_se')), p10: esc(modelIdealni(m.key)), p11: esc(tx('mapa.servis_a_uklid')), p12: pct(SERVIS_SHARE), p13: pct(ENERGY_SHARE), p14: esc(tx('mapa.pripojky_na_miste_navic')) }) + kcFull(Math.round(CONN_MIN * (k === 'max' ? CONN_MAX_MULT : 1))) + ' – ' + kcFull(Math.round(CONN_MAX * (k === 'max' ? CONN_MAX_MULT : 1))) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('mapa.dodani')) + '</span><b>' + dodaniSlovy()
      + (dodaniDnu() > 1 ? ' <span class="warn">' + esc(tx('mapa.vytizena_vyroba')) + '</span>' : '') + '</b></div>'
      + '<button class="btn sm' + (f.ok ? '' : ' sec') + '" style="width:100%;margin-top:10px" data-buy="' + k + '">'
      + (f.ok ? tx('veta.koupit', { p1: m.name }) : tx('hra.chybi_ti', { p1: kcFull(f.chybi) })) + '</button>'
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
  sheet(tx('veta.h3_koupit_h3_p_class_muted', { p1: m.name, p2: dodaniSlovy() })
    + (dodaniDnu() > 1 ? tx('hra.cim_vetsi_sit_mas_tim_je', { p1: DODANI_ZA, p2: DODANI_MAX_DNU }) : '') + '</p>'
    + (jeZacatek() ? tx('hra.p_class_fine_ok_na_prvni', { p1: esc(tx('hra.u_pripojek_na_miste_uz')) }) : '')
    + financeRows(f)
    + '<button class="btn big" id="do-buy"' + (f.ok ? '' : ' disabled') + '>Objednat</button>'
    + (f.ok ? '' : '<p class="fine err">' + esc(f.duvod || '') + '</p>'
        + '<p class="fine">' + esc(dohnat(f.chybi)) + ' ' + esc(tx('hra.nebo_splat_cast_uveru_tim')) + '</p>'
        + agentHtml(cena, function () { return zamerStrop(modelKey, cena); },
            { typ: 'stroj', model: modelKey })));
  bindFinance(function () { buySheet(modelKey, true); });
  bindAgent();
  var b = $('do-buy');
  if (b) b.onclick = function () {
    doFinance(f, { druh: 'stroj', popis: tx('veta.pradlomat', { p1: m.name })});
    // První stroj dorazí hned. Čekat den na dodání je u člověka, který hru
    // vidí poprvé, nejkratší cesta k tomu, že se už nevrátí.
    var hned = zacatecnik() && !(S.orders || []).length && !mamStroj();
    S.orders.push({ model: modelKey, orderedAt: Date.now(),
      arrivesAt: hned ? Date.now() : Date.now() + dodaniMs() });
    save(); paint(); closeSheet();
    // Nejdřív uložíme síť (je v ní nová objednávka) a pak řekneme serveru, že
    // se kupovalo — ten z ní spočte provizi tomu, kdo nás do hry přivedl.
    // Provize se platí hned při nákupu, ne až až stroj dorazí a postaví se.
    syncState(true).then(function () {
      // hned = úplně první stroj, který dorazí bez čekání. Server si podle
      // toho nastaví, kdy objednávka dorazí — bez toho by nováčkovi ležel
      // první prádlomat den na cestě, i když ho ve hře má hned.
      if (ME) apiJson('/account/nakup', { model: modelKey, hned: !!hned }).catch(function () { /* zkusí se přiště */ });
    });
    toast(hned ? tx('veta.je_na_sklade_dopravce_ho_privezl', { p1: m.name }): tx('veta.objednan_dorazi', { p1: m.name, p2: etaText(dodaniMs()) }), 'ok');
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
    toast(esc(tx('hra.plochu_mas_zaplacenou_nic_se')), 'ok');
    return spotSheet(sp, areaId);
  }
  // Banka to posuzuje jako zhodnocení pozemku, ne jako výdělek místa — stroj tu
  // zatím žádný není, takže se nedá půjčovat proti jeho zisku.
  var f = canFinance(cena, FIN_OWN, cena);
  sheet('<h3>' + esc(tx('hra.pripravit_plochu_2')) + '</h3>'
    + '<p class="muted small">' + esc(sp.name) + ' ' + esc(tx('hra.cesta_parkovani_dlazba_a_pripojky')) + ' '
    + esc(tx('hra.stroje_mit_nemusis_plocha_pocka')) + '</p>'
    + '<div class="kv"><span>' + esc(tx('hra.stani_na_pradlomaty_2')) + '</span><b>' + pady.length + '\u00d7 ('
    + esc(pady.map(function (x) { return (MODELS[x.model] || {}).name || ''; }).join(', ')) + ')</b></div>'
    + (jiz
        ? '<div class="kv"><span>' + esc(tx('hra.priprava_podle_navrhu')) + '</span><b>' + kcFull(plan.cena) + '</b></div>'
          + '<div class="kv"><span>' + esc(tx('hra.zaplaceno_driv_2')) + '</span><b class="ok">\u2212' + kcFull(jiz) + '</b></div>'
          + '<div class="kv souhrn"><span>' + esc(tx('hra.doplatek')) + '</span><b>' + kcFull(cena) + '</b></div>'
        : '<div class="kv souhrn"><span>' + esc(tx('hra.priprava_celkem_2')) + '</span><b>' + kcFull(cena) + '</b></div>')
    + financeRows(f)
    + '<p class="fine">' + esc(tx('hra.hotova_plocha_zustane_u_pozemku')) + ' '
    + esc(tx('hra.pri_stavbe_pak_platis_jen')) + '</p>'
    + '<button class="btn big" id="do-priprava"' + (f.ok ? '' : ' disabled')
    + ' style="width:100%;margin-top:10px">' + esc(tx('hra.nechat_udelat')) + '</button>'
    + (f.ok ? (f.dotkne_rezervy ? tx('veta.p_class_fine_warn_sahnes_i', { p1: kcFull(S.cash - f.own) }) : '')
        : '<p class="fine err">' + esc(f.duvod || '') + '</p>'
          + '<p class="fine">' + esc(dohnat(f.chybi)) + '</p>'
          + agentHtml(cena, function () { return cena; }, { typ: 'priprava', areaId: areaId, spotId: sp.id })));
  bindFinance(function () { pripravaSheet(sp, areaId, true); });
  bindAgent();
  var bp = $('do-priprava');
  if (bp) bp.onclick = function () {
    doFinance(f, { druh: 'misto', spotId: sp.id, popis: tx('veta.priprava_plochy', { p1: sp.name })});
    plan.zaplaceno = Math.round(plan.cena || 0);
    pozemky().forEach(function (z) { if (z.spotId === sp.id) z.priprava = plan.zaplaceno; });
    save(); paint(); drawMap(); syncState(true);
    toast(tx('veta.plocha_je_pripravena_na_az_stroj', { p1: pady.length, p2: mn(pady.length, esc(tx('hra.pradlomat')), esc(tx('hra.pradlomaty_4')), esc(tx('hra.pradlomatu'))) }), 'ok');
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
  sheet(tx('veta.div_class_kv_span_span_b_4', { p1: tx('veta.h3_postavit_h3_p_class_muted', { p1: m.name, p2: esc(sp.name), p3: (mam && pad ? tx('veta.stani_3', { p1: (pad + 1) }) : ''), p4: (mam && !e.conn
        ? esc(tx('mapa.jen_doprava_stroje_plochu_mas'))
        : (mam ? esc(tx('mapa.priprava_plochy_podle_tveho_navrhu'))
            : jeZasitovane(sp) ? esc(tx('mapa.instalace_stroje')) : esc(tx('mapa.pripojky_voda_odpad_elektrina')))
          + esc(tx('mapa.a_doprava'))), p5: (mam ? '.' : esc(tx('mapa.najem_domluveny'))) }), p2: (pron ? tx('veta.p_class_fine_najem_mesicne_mu', { p1: esc(tx('hra.stojis_na_cizim_pozemku_zem')), p2: kcFull(e.rent) }) : ''), p3: (!S.sidlo ? '<p class="fine ok">' + esc(tx('hra.touhle_stavbou_vznikne_sidlo_tvoji')) + ' '
        + esc(tx('hra.od_nej_se_pak_pocita')) + '</p>' : ''), p4: (uzStoji ? tx('veta.p_class_fine_warn_na_tomhle', { p1: (uzStoji === 1 ? esc(tx('mapa.jeden_pradlomat_stoji'))
          : tx('mapa.pradlomaty_stoji', { p1: uzStoji })), p2: Math.round(padPodil(uzStoji) * 100) }) : ''), p5: (mam ? esc(tx('mapa.priprava_plochy_a_pripojky'))
        : jeZasitovane(sp) ? esc(tx('hra.instalace')) : ceta ? esc(tx('mapa.pripojky_vlastni_cetou')) : esc(tx('mapa.pripojky'))), p6: (ceta || (mam && !e.conn) ? ' class="ok"' : ''), p7: (mam && !e.conn ? esc(tx('mapa.zaplaceno_predem')) : kcFull(e.conn)), p8: (ceta ? tx('veta.p_class_fine_ok_stavi_tvoje', { p1: Math.round(CETA_PODIL * 100), p2: cetaZbyva(), p3: CETA_MIST }) : ''), p9: (n ? ' (' + Math.round(n.km) + ' km)' : ''), p10: (doprava > 0 ? ' class="warn"' : ''), p11: (doprava > 0 ? kcFull(doprava) : esc(tx('mapa.zdarma_sidlo_vznika_tady'))), p12: financeRows(f), p13: (mam ? '<div class="kv"><span>' + esc(tx('mapa.najem_2')) + '</span><b class="ok">' + esc(tx('mapa.zadny_zem_je_tvoje')) + '</b></div>'
        : '<div class="kv"><span>' + esc(tx('mapa.domluveny_najem')) + '</span><b>' + kcFull(e.rent) + ' ' + esc(tx('hra.mesic_7')) + '</b></div>'), p14: esc(tx('mapa.zisk_tohohle_stroje_mesic')), p15: kcFull(e.profit), p16: (splatkyMesicne() > monthlyProfit() + e.profit
        ? tx('veta.p_class_fine_warn_i_s', { p1: kcFull(Math.round(monthlyProfit() + e.profit)), p2: kcFull(splatkyMesicne()) })
        : ''), p17: (f.ok ? '' : ' disabled') })
    + (f.ok ? (f.dotkne_rezervy ? tx('veta.p_class_fine_warn_sahnes_i_2', { p1: kcFull(S.cash - f.own) }) : '')
        : '<p class="fine err">' + esc(f.duvod || '') + '</p>'
          + '<p class="fine">' + esc(dohnat(f.chybi)) + '</p>'
          + '<button class="btn sec" id="go-bank" style="width:100%;margin-top:8px">' + esc(tx('mapa.zkusit_uver_v_bance')) + '</button>'
          + agentHtml(celkem, function () { return stropPodleZisku(e.profit, celkem); },
              { typ: 'stavba', areaId: areaId, spotId: sp.id, model: modelKey, pad: pad })));
  bindFinance(function () { installSheet(sp, areaId, modelKey, true, pad); });
  bindAgent();
  var gb = $('go-bank');
  if (gb) gb.onclick = function () { closeSheet(); switchTab('bank'); uverSheet(); };
  var b = $('do-build');
  if (b) b.onclick = function () {
    // Místo si nejdřív zabereme na serveru — na jednom místě smí stát jen jeden.
    b.disabled = true; b.textContent = esc(tx('mapa.stavim'));
    var sml = S.leases[sp.id] || {};
    var dlat = (pad && !pron) ? 0.00008 * pad : 0, dlon = (pad && !pron) ? 0.00011 * pad : 0;
    var nazev = sp.name + (pad ? tx('veta.stani', { p1: (pad + 1) }) : '');
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
      b.disabled = false; b.textContent = esc(tx('hra.postavit'));
      if (!r.ok) {
        if (r.j.occupied) CLAIMS[spotId] = r.j.occupied;
        drawMap(); closeSheet();
        return toast(r.j.error || esc(tx('mapa.misto_je_obsazene')), 'err');
      }
      CLAIMS[spotId] = r.j.spot;
      // Zem je v majetku zvlášť — v investici stání je jen stroj a doprava.
      if (mam) pozemky().forEach(function (z) { if (z.spotId === sp.id) z.zastaveno = 1; });
      doFinance(f, { druh: 'misto', spotId: spotId,
        popis: (mam ? (e.conn ? esc(tx('mapa.priprava_plochy')) + ' ' : esc(tx('hra.doprava_stroje')) + ' ') : esc(tx('mapa.pripojky_2')) + ' ') + sp.name });
      pripojUverKeStroji(spotId, sp.name);
      if (ceta) cetaPostavila(sp);
      // První stavba zakládá sídlo — ale ve městě, ne na adrese prádlomatu.
      // Firma má vlastní adresu; sdílet ji s provozovnou by nedávalo smysl.
      if (!S.sidlo) {
        var a = S.areas[areaId], str = stredOblasti(a);
        S.sidlo = { name: (a && a.name) || sp.name, lat: str ? str.lat : sp.lat,
          lon: str ? str.lon : sp.lon, od: Date.now() };
        toast(tx('veta.sidlo_firmy_mas_v_zmenit_se', { p1: S.sidlo.name }), 'ok');
      }
      S.stock[modelKey] = inStock(modelKey) - 1;
      S.units.push({ spotId: spotId, areaId: areaId, name: nazev, kind: sp.kind, score: sp.score,
        lat: sp.lat + dlat, lon: sp.lon + dlon, builtAt: Date.now(), eco: e });
      ev('game_build');
      // Kdo staví, když je ekonomika dole, má na to odznak.
      if (krizeKoef() < 0.97) S.krizovka = true;
      save(); paint(); drawMap(); closeSheet(); syncState(true);
      toast(tx('veta.pradlomat_stoji_vydelava_mesicne', { p1: kcFull(e.profit) }), 'ok');
    }).catch(function () { b.disabled = false; b.textContent = esc(tx('hra.postavit_2')); toast(esc(tx('mapa.server_neodpovida_6')), 'err'); });
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
    return '<div class="card"><div class="row"><h3>' + esc(tx('hra.pronajato')) + '</h3><b class="ok">' + kcFull(n.cena) + ' ' + esc(tx('hra.mesic_32')) + '</b></div>'
      + '<p class="muted small" style="margin:4px 0 8px">' + esc(tx('hra.zem_ma_pronajatou')) + ' ' + '<b>' + esc(n.firma) + '</b> ('
      + esc(n.nick) + ')' + (n.sit ? ' ' + esc(tx('hra.i_s_pripravenou_plochou')) : ' jako holou parcelu')
      + tx('veta.najem_ti_chodi_kazdy_herni_mesic', { p1: esc(tx('hra.ukoncit_pronajem')) });
  }
  if (stoji) return '';
  var nab = claim && claim.pronajem;
  var sit = nab ? !!nab.sit : maPlochu;
  var cena = nab ? nab.cena : navrhNajmu(sp, sit);
  return '<div class="card"><div class="row"><h3>' + esc(tx('hra.pronajmout_jinemu_hraci')) + '</h3>'
    + (nab ? '<b class="ok">' + esc(tx('hra.v_nabidce')) + '</b>' : '') + tx('veta.div_p_class_muted_small_style_3', { p1: esc(tx('hra.na_zemi_nemusis_stavet_sam')) }) + (sit ? '' : 'on') + '" data-pron-sit="0">' + esc(tx('hra.hola_parcela')) + '</button>'
    + '<button class="' + (sit ? 'on' : '') + '"' + (maPlochu ? '' : ' disabled') + ' data-pron-sit="1">S hotovou plochou</button>'
    + '</div>'
    + '<p class="fine">' + (sit
        ? esc(tx('hra.najemce_nestavi_ani_neplati_pripojky'))
        : esc(tx('hra.najemce_si_cestu_parkovani_i')))
      + (maPlochu ? '' : ' ' + esc(tx('hra.plochu_zatim_pripravenou_nemas_tak'))) + tx('veta.p_label_class_fld_style_margin', { p1: esc(tx('hra.najem_za_mesic')), p2: cena, p3: kcFull(rentOf(sp)), p4: esc(tx('hra.mesic_33')) })
    + (nab ? esc(tx('hra.upravit_nabidku')) : esc(tx('hra.nabidnout_k_pronajmu'))) + '</button>'
    + (nab ? '<button class="btn sec" id="do-pronajem-stop" style="width:100%;margin-top:8px">' + esc(tx('hra.stahnout_nabidku')) + '</button>' : '')
    + '</div>';
}
function bindPronajem(sp, areaId, claim) {
  var maPlochu = !!(planMista(sp.id) && planMista(sp.id).hotovo && planMista(sp.id).zaplaceno);
  var sit = claim && claim.pronajem ? !!claim.pronajem.sit : maPlochu;
  [].forEach.call($('sheet-body').querySelectorAll('[data-pron-sit]'), function (b) {
    b.onclick = function () {
      sit = b.getAttribute('data-pron-sit') === '1';
      if (sit && !maPlochu) return toast(esc(tx('hra.nejdriv_priprav_a_zaplat_plochu')), 'err');
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
    if (cena < 100) return toast(esc(tx('hra.dej_najmu_nejakou_rozumnou_cenu')), 'err');
    pb.disabled = true; pb.textContent = esc(tx('hra.zapisuji'));
    apiJson('/spots/pronajem', { spot_id: sp.id, cena: cena, sit: sit }).then(function (r) {
      pb.disabled = false;
      if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_3')), 'err');
      CLAIMS[sp.id] = r.j.spot;
      drawMap(); toast(tx('veta.pozemek_je_v_nabidce_za_mesicne', { p1: kcFull(cena) }), 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { pb.disabled = false; toast(esc(tx('hra.server_neodpovida_19')), 'err'); });
  };
  var sb = $('do-pronajem-stop');
  if (sb) sb.onclick = function () {
    apiJson('/spots/pronajem', { spot_id: sp.id, cena: 0 }).then(function (r) {
      if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_5')), 'err');
      CLAIMS[sp.id] = r.j.spot;
      drawMap(); toast(esc(tx('hra.nabidka_stazena_3')), 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { toast(esc(tx('hra.server_neodpovida_20')), 'err'); });
  };
  var kb = $('do-najem-konec');
  if (kb) kb.onclick = function () {
    kb.disabled = true;
    apiJson('/spots/najem-konec', { spot_id: sp.id }).then(function (r) {
      kb.disabled = false;
      if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_6')), 'err');
      CLAIMS[sp.id] = r.j.spot;
      nactiNajmy(function () { vyzvedniNasledky(); });
      drawMap(); toast(esc(tx('hra.pronajem_skoncil')), 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { kb.disabled = false; toast(esc(tx('hra.server_neodpovida_21')), 'err'); });
  };
}
// Cizí pozemek. Koupit se nedá — zem se dál neprodává. Když ji ale majitel
// nabízí, dá se na ní stavět za nájem: zem zůstane jeho, prádlomat je můj.
function cizipozemekSheet(sp, areaId, c) {
  var n = c.pronajem;
  sheet('<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[sp.kind] || esc(tx('hra.misto_3'))) + ' · '
    + esc(S.areas[areaId] ? S.areas[areaId].name : '') + ' · <b class="warn">' + esc(tx('hra.cizi_pozemek')) + '</b></p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
    + '<div class="card"><div class="row"><h3>' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '') + esc(c.firma) + '</h3>'
    + '<b class="muted small">' + esc(c.nick) + '</b></div>'
    + '<p class="muted small" style="margin:4px 0 0">' + (n
        ? esc(tx('hra.zem_patri_tehle_firme_a'))
        : c.najemce ? esc(tx('hra.zem_patri_tehle_firme_a_2'))
        : esc(tx('hra.zem_patri_tehle_firme_a_3'))) + '</p></div>'
    + (n
        ? '<h3 style="margin-top:18px">' + esc(tx('hra.nabidka_pronajmu')) + '</h3>'
          + '<div class="kv"><span>' + esc(tx('hra.najem')) + '</span><b class="warn">' + kcFull(n.cena) + ' ' + esc(tx('hra.mesic_16')) + '</b></div>'
          + '<div class="kv"><span>' + esc(tx('hra.plocha')) + '</span>' + '<b class="' + (n.sit ? 'ok' : '') + '">'
          + (n.sit ? esc(tx('hra.pripravena_pripojky_hotove')) : esc(tx('hra.hola_parcela_2'))) + '</b></div>'
          + '<p class="fine">' + (n.sit
              ? esc(tx('hra.cestu_parkovani_i_pripojky_zaplatil'))
              : esc(tx('hra.cestu_parkovani_i_pripojky_si'))) + '</p>'
          + '<button class="btn big" id="do-najmout" style="width:100%;margin-top:10px">' + esc(tx('hra.pronajmout_si_3')) + '</button>'
          + '<p class="fine">' + esc(tx('hra.zem_zustava_majiteli_pradlomat_je')) + '</p>'
        : ''));
  var nb = $('do-najmout');
  if (nb) nb.onclick = function () {
    nb.disabled = true; nb.textContent = esc(tx('hra.domlouvam'));
    apiJson('/spots/najmout', { spot_id: sp.id }).then(function (r) {
      nb.disabled = false; nb.textContent = esc(tx('hra.pronajmout_si'));
      if (!r.ok) {
        if (r.j.spot) CLAIMS[sp.id] = r.j.spot;
        drawMap(); closeSheet();
        return toast(r.j.error || esc(tx('hra.nepovedlo_se_7')), 'err');
      }
      CLAIMS[sp.id] = r.j.spot;
      S.leases[sp.id] = { rent: n.cena, at: Date.now(), pronajem: 1, sit: !!n.sit, majitel: c.firma };
      save(); paint(); drawMap(); syncState(true);
      toast(esc(tx('hra.pozemek_mas_pronajaty_ted_na')), 'ok');
      spotSheet(sp, areaId);
    }).catch(function () { nb.disabled = false; nb.textContent = esc(tx('hra.pronajmout_si_2')); toast(esc(tx('hra.server_neodpovida_13')), 'err'); });
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
var POZEMKU_PODIL = 0.07;        // pozemek na prodej je rarita — zhruba každé čtrnácté místo
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
  if (!f.ok) return zedSheet(tx('veta.pozemek_2', { p1: sp.name }), f, cena, function () { return cena; },
    { typ: 'pozemek', areaId: areaId, spotId: sp.id });
  if (btn) { btn.disabled = true; btn.textContent = esc(tx('hra.kupuji')); }
  // Skóre posíláme proto, aby si server mohl spočítat cenu země sám —
  // jinak o koupeném pozemku ví jen to, že existuje, a v jmění chybí.
  apiJson('/spots/claim', { spot_id: sp.id, area_key: areaId, model: '', rent: 0,
    name: sp.name, lat: sp.lat, lon: sp.lon, pozemek: true, score: sp.score }).then(function (r) {
    if (btn) { btn.disabled = false; btn.textContent = esc(tx('hra.koupit_pozemek_bez_stroje')); }
    if (!r.ok) {
      if (r.j.occupied) CLAIMS[sp.id] = r.j.occupied;
      drawMap(); closeSheet();
      return toast(r.j.error || esc(tx('hra.misto_je_obsazene')), 'err');
    }
    CLAIMS[sp.id] = r.j.spot;
    doFinance(f, { druh: 'pozemek', spotId: sp.id, popis: tx('veta.pozemek', { p1: sp.name }) });
    pozemky().push({ spotId: sp.id, areaId: areaId, name: sp.name, lat: sp.lat, lon: sp.lon,
      m2: pozemekM2(sp), cena: cena, od: Date.now() });
    save(); paint(); drawMap(); closeSheet(); syncState(true);
    toast(esc(tx('hra.pozemek_je_tvuj_postavit_na')), 'ok');
  }).catch(function () {
    if (btn) { btn.disabled = false; btn.textContent = esc(tx('hra.koupit_pozemek_bez_stroje_2')); }
    toast(esc(tx('hra.server_neodpovida_32')), 'err');
  });
}
function pozemekKarta(sp) {
  var m2 = pozemekM2(sp), zaM2 = pozemekZaM2(sp);
  return '<h3 style="margin-top:18px">' + esc(tx('hra.pozemek_na_prodej_3')) + '</h3>'
    + tx('veta.p_class_muted_small_tohle_misto', { p1: esc(tx('hra.vymera_2')), p2: m2, p3: kcFull(zaM2), p4: kcFull(m2 * zaM2), p5: esc(tx('hra.najem_4')), p6: esc(tx('hra.zadny_2')), p7: POZEMEK_STAVBA.toFixed(1).replace('.', desZnak()) });
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
  { k: 'voda', n: esc(tx('hra.voda')), b: '#4ab8ff', m: 2200 },
  { k: 'elektrina', n: esc(tx('hra.elektrina')), b: '#ffd34a', m: 2400 },
  { k: 'odpad', n: esc(tx('hra.kanalizace')), b: '#b39bff', m: 2000 }
];
var PLAN_PRAZDNO = 0, PLAN_DLAZBA = 1, PLAN_CESTA = 2, PLAN_STANI_B = 3, PLAN_STROJ = 9;
var PLAN_NARADI = [
  { k: 'cesta', n: esc(tx('hra.cesta')), b: PLAN_CESTA, p: esc(tx('hra.asfalt_po_kterem_se_k')) },
  { k: 'dlazba', n: esc(tx('hra.dlazba')), b: PLAN_DLAZBA, p: esc(tx('hra.zamkova_dlazba_okolo_stroje_aby')) },
  { k: 'guma', n: esc(tx('hra.guma')), b: PLAN_PRAZDNO, p: esc(tx('hra.smaze_co_jsi_nakreslil_trava')) }
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
function cisloM(v) { return String(Math.round(Number(v) * 100) / 100).replace('.', desZnak()); }
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
    { n: esc(tx('hra.asfaltova_cesta')), m: c.cesta + ' m²', v: c.cesta * PLAN_CESTA_M2 },
    { n: esc(tx('hra.parkovaci_stani')), m: c.stanixKs + '×', v: c.stanixKs * PLAN_STANI },
    { n: esc(tx('hra.zamkova_dlazba')), m: (c.dlazba + c.podStrojem) + ' m²', v: (c.dlazba + c.podStrojem) * PLAN_DLAZBA_M2 }
  ];
  PLAN_MEDIA.forEach(function (md) {
    polozky.push({ n: md.n, m: (v[md.k].ok ? v[md.k].delka + ' m' : '—'),
      v: (v[md.k].ok ? v[md.k].delka : 0) * md.m });
  });
  polozky.push({ n: esc(tx('hra.pripojovaci_poplatky')), m: '', v: PLAN_POPLATKY });
  var celkem = polozky.reduce(function (a, x) { return a + x.v; }, 0);
  var delka = PLAN_MEDIA.reduce(function (a, md) { return a + (v[md.k].ok ? v[md.k].delka : 0); }, 0);
  return { polozky: polozky, celkem: Math.round(celkem), delka: delka, vykopy: v };
}
// Co ještě chybí, aby se dalo stavět. Hráč má vědět proč, ne jen že to nejde.
function planChyby(p) {
  var ch = [], c = planPocty(p), n = c.stroju;
  if (!n) ch.push(esc(tx('hra.umisti_aspon_jeden_pradlomat_klepni')));
  var potreba = PLAN_STANI_MIN * Math.max(1, n);
  if (c.stanixKs < potreba) {
    ch.push(tx('veta.chybi_parkovani_mas_z_stani_na', { p1: c.stanixKs, p2: potreba, p3: cisloM(PLAN_STANI_ROZMER[0]), p4: cisloM(PLAN_STANI_ROZMER[1]) }));
  }
  var videl = planCestaOdUlice(p);
  if (n && !planDojezd(p)) ch.push(esc(tx('hra.ke_kazdemu_pradlomatu_se_musi')));
  var zajezd = planStani(p).filter(function (st) { return !planSousediCesta(videl, st); }).length;
  if (zajezd) ch.push(tx('veta.k_stani_se_neda_zajet_kazde', { p1: zajezd }));
  if (n) {
    var v = planVykopy(p);
    PLAN_MEDIA.forEach(function (md) {
      if (!v[md.k].ok) {
        ch.push(tx('veta.se_ke_stroji_nedostane_vykop_nema', { p1: md.n }));
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
      if (padObsazen(sp, byl)) return toast(esc(tx('hra.na_tomhle_stani_uz_pradlomat')), 'err');
      st.splice(byl, 1); save(); return vykresli();
    }
    var r = planRozmerStroje(PLAN_MODEL);
    var sx = Math.max(0, Math.min(p.w - planCely(r[0]), x));
    var sy = Math.max(0, Math.min(p.h - planCely(r[1]), y));
    if (!volno(sx, sy, r[0], r[1])) return toast(esc(tx('hra.tady_uz_neco_je')), 'err');
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
      if (!volno(sx, sy, w, h)) return toast(esc(tx('hra.stani_se_sem_nevejde')), 'err');
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
        ? esc(tx('hra.klepni_na_plochu_a_stani'))
      : PLAN_NASTROJ === 'stani'
        ? tx('veta.parkovaci_stani_je_m_musi_prilehat', { p1: cisloM(planRozmerStani()[0]), p2: cisloM(planRozmerStani()[1]) }): (naradi || {}).p || '';
    sheet(tx('veta.h3_h3_p_class_muted_small_15', { p1: esc(tx('hra.priprava_plochy')), p2: esc(sp.name), p3: p.w, p4: p.h, p5: planSvg(p) }) + PLAN_MEDIA.map(function (md) {
          return '<span><i style="background:' + md.b + '"></i>' + esc(md.n) + '</span>';
        }).join('') + tx('veta.p_p_class_fine_kazde_medium') + (PLAN_NASTROJ === 'stroj' ? 'on' : '') + '" data-plan-t="stroj">'
      + '<i class="sw sw-stroj"></i>' + esc(tx('hra.stroj')) + '</button>'
      + '<button class="' + (PLAN_NASTROJ === 'stani' ? 'on' : '') + '" data-plan-t="stani">'
      + '<i class="sw sw-stani"></i>' + esc(tx('hra.stani')) + '</button>'
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
          ? tx('hra.button_class_btn_sec_sm_id') + (PLAN_OTOCENO ? esc(tx('hra.nadel')) : esc(tx('hra.celem_k_ceste'))) + ')</button>'
          : '')
      + (PLAN_NASTROJ === 'cesta'
          ? '<div class="seg sub plan-seg" style="margin-top:6px">'
            + PLAN_CESTA_SIRKY.map(function (s2) {
                return '<button class="' + (s2 === PLAN_SIRKA ? 'on' : '') + '" data-plan-s="' + s2 + '">'
                  + s2 + ' m ' + (s2 > 3 ? esc(tx('hra.obousmerna')) : esc(tx('hra.jednosmerka'))) + '</button>';
              }).join('') + '</div>'
          : '')
      + '<p class="fine">' + esc(popis) + '</p>'
      + '<h3 style="margin:14px 0 4px">' + esc(tx('hra.na_plose_stoji')) + '</h3>'
      + (st.length
          ? st.map(function (x, i) {
              return '<div class="kv"><span>' + tx('veta.stani_2', { p1: (i + 1) }) + esc((MODELS[x.model] || {}).name || '')
                + '</span><b class="' + (padObsazen(sp, i) ? 'ok' : '') + '">'
                + (padObsazen(sp, i) ? esc(tx('hra.pradlomat_stoji')) : cisloM(x.w) + ' × ' + cisloM(x.h) + ' m') + '</b></div>';
            }).join('')
          : '<p class="fine">' + esc(tx('hra.zatim_zadne_klepni_na_stroj')) + '</p>')
      + '<div class="kv"><span>' + esc(tx('hra.parkovacich_stani')) + '</span><b class="'
      + (c.stanixKs >= PLAN_STANI_MIN * Math.max(1, c.stroju) ? 'ok' : 'warn') + '">' + c.stanixKs + '×</b></div>'
      + '<h3 style="margin:14px 0 4px">' + esc(tx('hra.co_to_bude_stat')) + '</h3>'
      + cen.polozky.map(function (x) {
          return '<div class="kv"><span>' + esc(x.n) + (x.m ? ' <i class="muted small">' + esc(x.m) + '</i>' : '')
            + '</span><b>' + kcFull(x.v) + '</b></div>';
        }).join('')
      + '<div class="kv souhrn"><span>' + esc(tx('hra.priprava_celkem')) + '</span><b class="' + (cen.celkem ? 'warn' : '') + '">'
      + kcFull(cen.celkem) + '</b></div>'
      + (p.zaplaceno
          ? '<div class="kv"><span>' + esc(tx('hra.zaplaceno_driv')) + '</span><b class="ok">−' + kcFull(p.zaplaceno) + '</b></div>'
          : '')
      + (chyby.length
          ? '<div class="card vada-karta" style="margin-top:12px"><h3>' + esc(tx('hra.jeste_to_nejde')) + '</h3>'
            + chyby.map(function (x) { return '<p class="muted small" style="margin:6px 0 0">' + esc(x) + '</p>'; }).join('')
            + '</div>'
          : tx('hra.p_class_fine_ok_style_margin', { p1: cen.delka }))
      + '<button class="btn sec" id="plan-auto" style="width:100%;margin-top:12px">' + esc(tx('hra.navrhnout_za_me')) + '</button>'
      + '<button class="btn big" id="plan-hotovo"' + (chyby.length ? ' disabled' : '')
      + ' style="width:100%;margin-top:8px">' + esc(tx('hra.hotovo_spocitat_pripravu')) + '</button>'
      + (stoji ? '' : '<button class="btn sec" id="plan-smazat" style="width:100%;margin-top:8px">' + esc(tx('hra.zacit_navrh_znovu')) + '</button>'));
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
      toast(esc(tx('hra.hotovy_navrh_doladit_ho_muzes')), 'ok');
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
  { m: 0, n: esc(tx('hra.na_dobu_neurcitou')), p: esc(tx('hra.nejlevnejsi_kdokoli_te_muze_kdykoli')) },
  { m: 12, n: esc(tx('hra.doba_1_rok')), p: esc(tx('hra.rok_klidu_pak_se_smlouva')) },
  { m: 36, n: esc(tx('hra.doba_3_roky')), p: esc(tx('hra.tri_roky_te_nikdo_nevystrnadi')) },
  { m: 60, n: esc(tx('hra.doba_5_let')), p: esc(tx('hra.nejdrazsi_jistota_pet_hernich_let')) }
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
  return m + ' ' + mn(m, esc(tx('hra.mesic_3')), esc(tx('hra.mesice_2')), esc(tx('hra.mesicu_2')));
}
// Běžící výpověď na mém místě — vrací data, ze kterých se staví varování.
function vyzvaNaMiste(spotId) {
  var c = CLAIMS[spotId];
  if (!c || !c.mine || c.pozemek || !c.vypoved_do || !c.vyzyva) return null;
  var do_ = new Date(c.vypoved_do).getTime();
  if (!(do_ > Date.now())) return null;
  return { do: do_, nick: c.vyzyva.firma || c.vyzyva.nick || 'konkurent', rent: c.vyzyva.rent || 0 };
}
// Karta s výpovědí v detailu prádlomatu. Dorovnání je ta pojistka, kvůli které
// má smysl vyjednat si delší výpovědní dobu.
function vypovedHtml(u) {
  var v = vyzvaNaMiste(u.spotId);
  if (!v) return '';
  var rozdil = Math.max(0, v.rent - (u.eco.rent || 0));
  return '<div class="card vada-karta"><div class="row"><h3>' + tx('veta.h3_b_class_err_b_div_2', { p1: esc(tx('hra.vypoved_z_mista')), p2: etaText(v.do - Date.now()).replace('za ', esc(tx('hra.zbyva_2')) + ' '), p3: esc(v.nick), p4: esc(tx('hra.platis_ted_2')), p5: kcFull(u.eco.rent), p6: esc(tx('hra.mesic_27')), p7: esc(tx('hra.nabidka_konkurenta')), p8: kcFull(v.rent), p9: esc(tx('hra.mesic_28')), p10: esc(tx('hra.zdrazi_te_to_o_2')), p11: kcFull(rozdil), p12: esc(tx('hra.mesic_29')), p13: esc(tx('hra.dorovnat_a_zustat')) });
}
// Jak je místo nasmlouvané — vidí jen nájemce.
function smlouvaHtml(u) {
  var c = CLAIMS[u.spotId];
  if (c && c.mine && c.pozemek) {
    return '<h3 style="margin:16px 0 4px">' + esc(tx('hra.vlastni_pozemek')) + '</h3>'
      + '<div class="kv"><span>' + esc(tx('hra.najem_3')) + '</span><b class="ok">' + esc(tx('hra.neplatis_zadny')) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('hra.muze_te_odsud_nekdo_dostat')) + '</span><b class="ok">' + 'ne' + '</b></div>'
      + '<p class="fine">' + esc(tx('hra.zem_je_tvoje_takze_tohle')) + ' '
      + esc(tx('hra.prodat_se_da_jedine_se')) + '</p>';
  }
  if (!c || !c.mine || !c.vypoved_mesicu) return '';
  var vaz = c.vazano_do ? new Date(c.vazano_do).getTime() : 0;
  var kryty = vaz > Date.now();
  return '<h3 style="margin:16px 0 4px">' + esc(tx('hra.najemni_smlouva_2')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('hra.vazanost')) + '</span><b class="' + (kryty ? 'ok' : '') + '">'
    + (kryty ? 'do ' + datumCas(vaz).split(' ')[0] + ' ' + esc(tx('hra.nikdo_te_nepreplati')) : esc(tx('hra.na_dobu_neurcitou_2'))) + tx('veta.b_div_div_class_kv_span_3', { p1: esc(tx('hra.vypovedni_doba_2')), p2: vypovedNazev(c.vypoved_mesicu), p3: esc(tx('hra.na_dobu_neurcitou_vypovedet_muze')) });
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
      toast(tx('veta.misto_je_tvoje_ale_nemas_volny', { p1: sp.name }) + MODELS[ceka.model].name + '.', 'err');
      return;                                        // zkusíme to zas, až stroj bude
    }
    var conn = connPrice(sp, ceka.model);
    var f = canFinance(conn, null, stropPodleZisku(economics(sp, ceka.model).profit, conn));
    if (!f.ok) { toast(tx('veta.misto_je_tvoje_ale_na_pripojky', { p1: sp.name }), 'err'); return; }
    delete fronta[id];
    doFinance(f, { druh: 'misto', spotId: id, popis: tx('veta.pripojky_2', { p1: sp.name })});
    pripojUverKeStroji(id, sp.name);
    S.stock[ceka.model] = inStock(ceka.model) - 1;
    var eco = economics(sp, ceka.model);
    eco.rent = ceka.rent; eco.conn = conn; eco.install = conn;
    eco.cost = eco.energy + eco.servis + eco.rent;
    eco.profit = eco.revenue - eco.cost;
    S.units.push({ spotId: id, areaId: ceka.areaId, name: sp.name, kind: sp.kind, score: sp.score,
      lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: eco });
    save(); paint(); drawMap(); syncState(true);
    toast(tx('veta.vypovedni_doba_dobehla_je_tvoje_a', { p1: sp.name }), 'ok', true);
  });
}
// ─── Denní odměna ────────────────────────────────────────────────────────────
// Sedmidenní série: každý další den přijde víc, sedmý den velký dárek a pak
// série začíná znovu. Částka není pevná — je to podíl z měsíčního zisku, aby
// dárek nebyl ve druhém roce k smíchu. Pod ním je pevné dno pro začátečníky,
// kteří ještě nevydělávají nic. Vynechaný den sérii vrací na začátek.
var DENNI_PODIL = [0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.25];
var DENNI_DNO = [5000, 10000, 15000, 20000, 30000, 40000, 100000];
function dnesKlic(posunDnu) {
  var d = new Date(Date.now() - (posunDnu || 0) * 86400000);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function denniOdmena(den) {
  var i = Math.max(0, Math.min(DENNI_DNO.length - 1, (den || 1) - 1));
  return Math.max(DENNI_DNO[i], Math.round(monthlyProfit() * DENNI_PODIL[i]));
}
// Který den série hráče dneska čeká.
function denniDen() {
  var d = (S && S.denni) || {};
  if (d.den && d.kdy === dnesKlic(1) && d.den < DENNI_DNO.length) return d.den + 1;
  return 1;
}
function denniCeka() {
  if (!S || S.tut !== 'done') return false;
  return ((S.denni || {}).kdy || '') !== dnesKlic(0);
}
function hlidejDenni() {
  if (!denniCeka()) return;
  // Rozdělanou práci nepřerušujeme — otevřený panel má přednost, dárek počká.
  if (!$('sheet').classList.contains('hidden')) return;
  denniSheet();
}
function denniSheet() {
  // Když už si dneska vzal, ukazujeme ten den, co si vzal — ne ten zítřejší.
  var vzato = !denniCeka();
  var den = vzato && S.denni && S.denni.den ? S.denni.den : denniDen();
  var castka = denniOdmena(den);
  var dlazdice = '';
  for (var i = 1; i <= DENNI_DNO.length; i++) {
    dlazdice += tx('veta.div_class_den_span_den_span', { p1: (i < den || (vzato && i === den) ? ' hotovo' : (i === den ? ' ted' : '')), p2: (i === DENNI_DNO.length ? '\uD83C\uDF81 ' : ''), p3: i, p4: kc(denniOdmena(i)) });
  }
  sheet('<h3>' + esc(tx('hra.denni_odmena')) + '</h3>'
    + '<p class="muted small">' + esc(tx('hra.za_to_ze_se_vracis')) + ' '
    + esc(tx('hra.kdyz_den_vynechas_serie_zacina')) + '</p>'
    + '<div class="dny">' + dlazdice + '</div>'
    + (vzato
        ? tx('hra.p_class_fine_ok_dneska_sis', { p1: kcFull(castka), p2: den })
        : tx('hra.div_class_kv_souhrn_span_span', { p1: esc(tx('hra.dnes_dostanes')), p2: kcFull(castka), p3: kcFull(castka) }))
    + tx('veta.p_class_fine_odmena_roste_s', { p1: kcFull(DENNI_DNO[Math.min(DENNI_DNO.length - 1, den - 1)]) }));
  var b = $('den-vzit');
  if (b) b.onclick = function () {
    if (!denniCeka()) return closeSheet();
    var c = denniOdmena(denniDen());
    S.denni = { den: denniDen(), kdy: dnesKlic(0) };
    S.cash += c;
    zapis('prijem', tx('veta.denni_odmena_den', { p1: S.denni.den }), c);
    save(); paint(); syncState(true); closeSheet();
    toast(tx('veta.denni_odmena_je_na_uctu', { p1: kcFull(c) }), 'ok', true);
  };
}
// ─── Nabídka karty v pravou chvíli ───────────────────────────────────────────
// Karta se nabídne tehdy, kdy je k něčemu — ne náhodně. Pravidla jsou schválně
// přísná: každou kartu nabídneme za celou hru jednou, nejvýš jednu nabídku za
// den, nikdy přes rozdělanou práci, nikdy během tutoriálu a nikdy kartu, kterou
// hráč zrovna má. Když ji nechce, zavře to a už se neozveme.
var NABIDKY = [
  { kind: 'rush',
    kdy: function () { return ((S.orders || []).length > 0); },
    duvod: esc(tx('hra.stroj_mas_na_ceste_a')) + ' '
      + esc(tx('hra.expresni_dovoz_ho_hodi_na')) },
  { kind: 'connect',
    kdy: function () { return (S.units || []).length >= 1 && (S.units || []).length <= 2; },
    duvod: tx('veta.prvni_pradlomat_stoji_kazde_dalsi_misto')},
  { kind: 'kampan15', kampan: true,
    kdy: function () { var n = (S.units || []).length; return n >= 3 && n <= 6 && !kampanBezi(); },
    duvod: tx('veta.sit_uz_mas_kampan_se_vyplati')},
  { kind: 'credit',
    kdy: function () { return (S.units || []).length >= 6 && S.loan > 0; },
    duvod: tx('veta.expandujes_na_dluh_a_urok_ti')}
];
// Nabídka infolinky se ozývá tam, kde je k něčemu: po hovoru. Každý třetí,
// a to jen tomu, kdo žádné kredity nemá — kdo si je koupil, má pokoj. Odstup
// hlídáme i v čase, protože s velkou sítí zvoní telefon co půl minuty a
// nabídka po každém třetím hovoru by jinak byla za chvíli otravná.
var LINKA_PO_HOVORECH = 3;
var LINKA_ODSTUP = 20 * 60e3;
function linkaNabidnoutLze() {
  if (!S || S.tut !== 'done' || !ME || !PAYMENTS_ON) return false;
  if (!LINKA_CAT || !LINKA_CAT.length) return false;
  if (maLinku()) return false;
  if (((S.hovoru || 0) % LINKA_PO_HOVORECH) !== 0) return false;
  return Date.now() - (S.linkaNabidka || 0) >= LINKA_ODSTUP;
}
// Blok do panelu s koncem hovoru — nabídne nejmenší balíček a odkáže na zbytek.
function linkaNabidkaHtml() {
  var c = (LINKA_CAT || [])[0];
  if (!c) return '';
  S.linkaNabidka = Date.now(); save();
  return '<div class="card agent" style="margin-top:12px"><h3>' + esc(tx('hra.u260e_ufe0f_at_to_za_2')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 8px">' + esc(tx('hra.takhle_ti_bude_telefon_zvonit')) + ' '
    + esc(tx('hra.hovor_ktery_nestihnes_vezme_operator')) + '</p>'
    + '<button class="btn big" data-linka="' + esc(c.kind) + '">' + esc(polNazev(c)) + ' za '
    + cenaReal(c.price_czk) + '</button>'
    + '<p class="fine">' + esc(tx('hra.vetsi_balicky_vyjdou_levneji_jsou')) + '</p></div>';
}
function hlidejNabidky() {
  if (!S || S.tut !== 'done' || !ME || !PAYMENTS_ON || !CARDS_CAT) return;
  if (!$('sheet').classList.contains('hidden')) return;
  var dnes = dnesKlic(0);
  if (!S.nabidky) S.nabidky = {};
  if (S.nabidky.den === dnes) return;                 // jedna za den stačí
  for (var i = 0; i < NABIDKY.length; i++) {
    var n = NABIDKY[i];
    var c = (CARDS_CAT || []).concat(KAMPAN_CAT || [])
      .filter(function (x) { return x.kind === n.kind; })[0];
    if (!c || S.nabidky[n.kind] || ownedOf(n.kind) > 0) continue;
    if (!n.kdy()) continue;
    S.nabidky[n.kind] = dnes; S.nabidky.den = dnes; save();
    return nabidkaSheet(n, c);
  }
}
function nabidkaSheet(n, c) {
  var art = CARD_ART[c.kind] || { emoji: '\u26A1' };
  sheet('<h3>' + art.emoji + ' ' + esc(polNazev(c)) + '</h3>'
    + '<p class="muted small">' + esc(n.duvod) + '</p>'
    + '<div class="card agent" style="margin-top:12px"><p class="muted small" style="margin:0 0 8px">'
    + esc(polPopis(c)) + '</p>'
    + '<div class="kv"><span>' + esc(tx('hra.cena_2')) + '</span><b>' + cenaReal(c.price_czk) + '</b></div>'
    + ((c.bundles || []).length ? tx('veta.p_class_fine_ve_vice_kusech', { p1: c.bundles[c.bundles.length - 1].qty, p2: c.bundles[c.bundles.length - 1].sleva }) : '')
    + '<button class="btn big" id="nab-koupit">' + esc(tx('hra.koupit')) + '</button></div>'
    + '<button class="btn sec" id="nab-ne" style="width:100%;margin-top:8px">' + esc(tx('hra.ted_ne_3')) + '</button>'
    + '<p class="fine">' + esc(tx('hra.tuhle_nabidku_uz_ti_znovu')) + '</p>');
  $('nab-koupit').onclick = function () { (n.kampan ? buyCash : buyCard)(c.kind); };
  $('nab-ne').onclick = closeSheet;
}
// Nová výpověď na mém místě se nesmí přehlédnout — hráč na ni má omezený čas.
// Značka, že už jsme o ní dali vědět, patří do uloženého stavu: ve hře v
// paměti by se po každém obnovení stránky ztratila a hráč by dostal tu samou
// zprávu pořád dokola. Klíčem je kdo a dokdy — na novou výzvu upozorníme zas.
function hlidejVypovedi() {
  if (!S) return;
  if (!S.vypZnam) S.vypZnam = {};
  var zmena = false;
  (S.units || []).forEach(function (u) {
    var v = vyzvaNaMiste(u.spotId);
    if (!v) return;
    var klic = (v.nick || '') + '|' + (v.do || '');
    if (S.vypZnam[u.spotId] === klic) return;
    S.vypZnam[u.spotId] = klic; zmena = true;
    toast(tx('veta.preplatil_najem_na_miste_do_konce', { p1: v.nick, p2: u.name }), 'err');
  });
  // Úklid: značku držíme jen u míst, která pořád máme. Zmizelá výzva značku
  // nemaže — jinak by stačilo, aby se zábory na chvíli nenačetly, a zpráva
  // by naskočila znovu.
  Object.keys(S.vypZnam).forEach(function (sid) {
    var mam = (S.units || []).some(function (u) { return u.spotId === sid; });
    if (!mam) { delete S.vypZnam[sid]; zmena = true; }
  });
  if (zmena) save();
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
    var misto = sp || { id: sid, name: c.name || esc(tx('hra.pradlomat_4')), kind: 'unknown', score: 60,
      lat: c.lat, lon: c.lon };
    var eco = economics({ id: sid, name: misto.name, kind: misto.kind, score: misto.score,
      lat: misto.lat, lon: misto.lon }, c.model);
    if (c.rent != null) {
      eco.rent = c.rent;
      eco.cost = eco.energy + eco.servis + eco.rent;
      eco.profit = eco.revenue - eco.cost;
    }
    S.units.push({ spotId: sid, areaId: c.area_key || '', name: misto.name || c.name || esc(tx('hra.pradlomat_5')),
      kind: misto.kind || 'unknown', score: misto.score != null ? misto.score : 60,
      lat: misto.lat != null ? misto.lat : c.lat, lon: misto.lon != null ? misto.lon : c.lon,
      builtAt: Date.now(), eco: eco });
    pridano++;
  });
  if (pridano) {
    save(); paint(); drawMap(); syncState(true);
    toast(pridano === 1
      ? esc(tx('hra.vratili_jsme_ti_pradlomat_ktery'))
      : tx('veta.vratili_jsme_ti_pradlomaty_ktere_v', { p1: pridano }), 'ok');
  }
  return pridano;
}
// Místo, o které hráč přišel, zmizí ze sítě a stroj se mu vrátí na sklad.
function reconcileUnits() {
  obnovChybejiciUnity();
  if (!S || !S.units.length) return;
  // Skóre místa patří místu, ne stroji. U míst převzatých po někom jiném se
  // hře občas rozešlo s evidencí a zůstalo jí nízké — hráč pak platil nájem
  // za dobré místo a vydělával jako na špatném. Evidence rozhoduje: nájem
  // z ní kdysi vznikl, takže je to ona, komu nájem sedí.
  var opraveno = 0;
  S.units.forEach(function (u) {
    var c = CLAIMS[u.spotId];
    if (!c || !c.mine || c.score == null) return;
    if (Math.abs((Number(u.score) || 0) - c.score) <= 1) return;
    u.score = c.score;
    opraveno++;
  });
  if (opraveno) { refreshUnits(); save(); }
  var lost = [];
  S.units = S.units.filter(function (u) {
    var c = CLAIMS[u.spotId];
    if (S.prodano && S.prodano[u.spotId]) return false;   // prodaný, ne přetažený
    if (c && !c.mine) { lost.push({ u: u, nick: c.firma || c.nick }); return false; }
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
    ? tx('veta.preplatil_najem_v_miste_stroj_mas', { p1: x.nick, p2: x.u.name }): tx('veta.prisel_jsi_o_mist_konkurence_preplatila', { p1: lost.length }), 'err');
}

// ─── Výpověď od majitele pozemku ─────────────────────────────────────────────
// Nájem není jistota. Stejně jako se stroj porouchá, může majitel pozemku sám
// vypovědět smlouvu — pozemek prodá, postaví si tam vlastní věc nebo si to
// rozmyslí. Prádlomat se pak musí odvézt: skončí na skladě a hráč mu hledá nové
// místo i nové přípojky. Vázanost smlouvy tomu brání (za to se platí) a
// vyjednaná výpovědní doba rozhoduje, kolik času na stěhování zbude.
var VYPOVED_ROCNE = 0.08;          // průměrně jednou za ~12 herních let na stroj
var VYPOVED_DUVODY = [
  { t: esc(tx('hra.majitel_pozemek_prodal')), p: esc(tx('hra.novy_vlastnik_s_pradlomatem_nepocita')), jednat: false },
  { t: esc(tx('hra.majitel_si_plochu_bere_pro')), p: esc(tx('hra.chysta_tam_vlastni_stavbu')), jednat: false },
  { t: esc(tx('hra.benzinka_rusi_podnajmy')), p: esc(tx('hra.vedeni_site_zrusilo_pronajmy_ploch')), jednat: false },
  { t: esc(tx('hra.obchod_meni_provozovatele')), p: esc(tx('hra.novy_najemce_objektu_chce_plochu')), jednat: true },
  { t: esc(tx('hra.majitel_ma_lepsi_nabidku')), p: esc(tx('hra.za_plochu_mu_nekdo_nabidl')), jednat: true },
  { t: esc(tx('hra.stiznosti_sousedu')), p: esc(tx('hra.majiteli_vadi_nocni_provoz_da')), jednat: true }
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
    toast(tx('veta.majitel_pozemku_dal_vypoved', { p1: u.name, p2: d.t.toLowerCase() }), 'err');
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
    toast(tx('veta.najem_v_miste_skoncil', { p1: u.name }) + ((MODELS[u.eco.model] || {}).name || esc(tx('hra.pradlomat_3')))
      + tx('veta.mas_na_sklade_najdi_mu_nove', { p1: (spl ? tx('veta.splatky_mesicne_bezi_dal', { p1: kcFull(spl) }) : '') }), 'err');
  });
  save(); prehodnotRamec(false, true); paint(); drawMap(); syncState(true);
}
// Karta výpovědi v detailu prádlomatu.
function vypovedMajiteleHtml(u) {
  var v = u && u.vypoved;
  if (!v) return '';
  var novy = Math.round((u.eco.rent || 0) * (1 + (v.navyseni || 0)));
  var h = '<div class="card vada-karta"><div class="row"><h3>' + tx('veta.h3_b_class_err_b_div', { p1: esc(tx('hra.vypoved_od_majitele')), p2: etaText(Math.max(0, v.do - Date.now())).replace('za ', esc(tx('hra.zbyva')) + ' '), p3: esc(v.t), p4: esc(v.p), p5: vypovedNazev(v.mesicu), p6: esc(tx('hra.pak_se_musi_odvezt_skonci')) });
  var spl = splatkyMista(u.spotId);
  if (spl > 0) {
    h += '<div class="kv"><span>' + tx('veta.span_b_class_err_b_div', { p1: esc(tx('hra.splatky_uveru_na_tohle_misto')), p2: kcFull(spl), p3: esc(tx('hra.mesic_10')) });
  }
  if (v.navyseni > 0) {
    h += '<div class="kv"><span>' + esc(tx('hra.platis_ted')) + '</span><b>' + kcFull(u.eco.rent || 0) + ' ' + esc(tx('hra.mesic_11')) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('hra.majitel_chce')) + '</span><b class="warn">' + kcFull(novy) + ' ' + esc(tx('hra.mesic_12')) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('hra.zdrazi_te_to_o')) + '</span><b class="err">'
      + kcFull(Math.max(0, novy - (u.eco.rent || 0))) + ' ' + esc(tx('hra.mesic_13')) + '</b></div>'
      + '<button class="btn big" id="do-navyseni" style="width:100%;margin-top:10px">' + esc(tx('hra.prisadit_a_zustat')) + '</button>';
  } else {
    h += tx('veta.p_class_fine_err_tahle_vypoved');
  }
  return h + '</div>';
}

// Panel cizího prádlomatu: koho přebíráš a za kolik to zkusíš.
function rivalSheet(sp, areaId, c) {
  // Pozemek se nepřeplácí — zem patří majiteli a ten ji prodávat nemusí.
  if (c.pozemek) {
    sheet('<h3>' + esc(sp.name) + '</h3>'
      + '<p class="muted small">' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '')
      + esc(tx('hra.tohle_misto_drzi')) + ' ' + '<b>' + esc(c.firma || c.nick) + '</b> (' + esc(c.nick) + ') · '
      + esc((MODELS[c.model] || {}).name || c.model) + '</p>'
      + '<div style="margin:8px 0 12px">' + verdictPill(sp.score) + '</div>'
      + '<div class="card"><div class="row"><h3>' + esc(tx('mapa.vlastni_pozemek')) + '</h3><b class="warn">' + esc(tx('mapa.nelze_preplatit')) + '</b></div>'
      + '<p class="muted small" style="margin:4px 0 0">' + esc(tx('hra.majitel_tu_nema_najem_zem')) + ' '
      + esc(tx('mapa.nabidnout_vic_nejde_protoze_neni')) + ' '
      + esc(tx('hra.tohle_misto_je_obsazene_natrvalo')) + '</p></div>');
    return;
  }
  var free = MODEL_ORDER.filter(function (k) { return inStock(k) > 0; });
  var e = economics(sp, free[0] || 'flex');
  var odhad = rentOf(sp);
  sheet('<h3>' + esc(sp.name) + '</h3>'
    + '<p class="muted small">' + (c.znak ? znakSvg(c.znak, 20) + ' ' : '') + esc(tx('hra.tohle_misto_drzi_2')) + ' ' + '<b>' + esc(c.firma || c.nick) + '</b> (' + esc(c.nick) + ') · '
    + esc((MODELS[c.model] || {}).name || c.model)
    + (c.takeovers ? tx('hra.uz', { p1: c.takeovers, p2: esc(tx('mapa.zmenilo_majitele_2')) }) : '') + tx('veta.p_div_style_margin_8px_0', { p1: verdictPill(sp.score), p2: esc(tx('hra.majitel_pozemku_se_te_nezepta')), p3: kcFull(BID_FEE), p4: esc(tx('mapa.najem_v_okoli_byva')), p5: kcFull(odhad), p6: esc(tx('mapa.instalace_tveho_stroje')), p7: kcFull(connPrice(sp, free[0] || 'flex')), p8: esc(tx('mapa.pripojky_tu_uz_jsou_po')) })
    + (free.length
      ? '<label class="fld"><span>' + esc(tx('mapa.co_nabidnes_majiteli_mesic')) + '</span>'
        + '<input id="bid-amt" class="inp" type="number" inputmode="numeric" min="0" step="500" value="' + Math.round(odhad * 1.4 / 500) * 500 + '"></label>'
        + '<label class="fld"><span>' + esc(tx('mapa.co_tam_postavis')) + '</span><select id="bid-model" class="inp">'
        + free.map(function (k) { return '<option value="' + k + '">' + MODELS[k].name + ' (' + inStock(k) + esc(tx('hra.skladem_6')) + '</option>'; }).join('')
        + '</select></label>'
        + '<button class="btn big" id="do-bid">' + esc(tx('mapa.zkusit_preplatit')) + '</button>'
      : tx('hra.p_class_fine_err_nemas_na', { p1: esc(tx('mapa.koupit_pradlomat_v_obchode')) }))
    );
  var gs = $('go-shop-bid');
  if (gs) gs.onclick = function () { closeSheet(); switchTab('shop'); };
  var b = $('do-bid');
  if (b) b.onclick = function () {
    var amt = Math.max(0, Math.round(Number($('bid-amt').value) || 0));
    var model = $('bid-model').value;
    var conn = connPrice(sp, model);
    if (S.cash < BID_FEE) return toast(esc(tx('mapa.na_vyjednavani_nemas_hotovost')), 'err');
    b.disabled = true; b.textContent = esc(tx('mapa.vyjednavam'));
    apiJson('/spots/bid', { spot_id: sp.id, rent: amt, model: model }).then(function (r) {
      b.disabled = false; b.textContent = esc(tx('mapa.zkusit_preplatit_2'));
      if (!r.j.won) {
        // 404 = zábor mezitím zmizel (majitel vypověděl nebo si resetoval hru).
        // Za to hráč platit nebude a rovnou ho pustíme stavět.
        if (r.status === 404) {
          delete CLAIMS[sp.id];
          loadClaims();
          toast(esc(tx('mapa.misto_se_mezitim_uvolnilo_muzes')), 'ok');
          return spotSheet(sp, areaId);
        }
        S.cash -= BID_FEE;
        zapis('poplatek', tx('veta.neuspesne_vyjednavani', { p1: (sp.name || '') }), -BID_FEE);
        save(); paint();
        return toast(r.j.error || esc(tx('hra.nepovedlo_se_8')), 'err');
      }
      // Majitel kývl, ale nájemce má výpovědní dobu — místo bude naše až po ní.
      // Datum neznáme (podmínky soused tají), takže se čeká na převzetí.
      if (r.j.ceka) {
        cekam()[sp.id] = { rent: amt, model: model, areaId: areaId };
        save(); loadClaims(); closeSheet();
        return toast(tx('veta.ma_ale_vypovedni_lhutu_az_dobehne', { p1: esc(tx('mapa.majitel_pozemku_kyvl')), p2: esc(r.j.lost_by) }) + MODELS[model].name + '.', 'ok');
      }
      // Vyhráli jsme: platíme přípojky a stavíme s nájmem, který jsme nabídli.
      var f = canFinance(conn, null, stropPodleZisku(economics(sp, model).profit, conn));
      if (!f.ok) {
        // Místo už máme, ale na přípojky nemáme — vrátíme ho, ať v něm neleží.
        apiJson('/spots/release', { spot_id: sp.id });
        return toast(tx('veta.misto_bys_mel_ale_na_pripojky', { p1: kcFull(f.need - f.canBorrow) }), 'err');
      }
      doFinance(f, { druh: 'misto', spotId: sp.id, popis: tx('veta.pripojky', { p1: sp.name })});
      pripojUverKeStroji(sp.id, sp.name);
      S.stock[model] = inStock(model) - 1;
      var eco = economics(sp, model);
      eco.rent = amt; eco.conn = conn; eco.install = conn;
      eco.cost = eco.energy + eco.servis + amt;
      eco.profit = eco.revenue - eco.cost;
      S.units.push({ spotId: sp.id, areaId: areaId, name: sp.name, kind: sp.kind, score: sp.score,
        lat: sp.lat, lon: sp.lon, builtAt: Date.now(), eco: eco });
      save(); paint(); loadClaims(); closeSheet();
      toast(tx('veta.misto_je_tvoje_si_stroj_odvazi', { p1: esc(r.j.lost_by) }), 'ok');
    }).catch(function () { b.disabled = false; b.textContent = esc(tx('mapa.zkusit_preplatit_3')); toast(esc(tx('mapa.server_neodpovida_4')), 'err'); });
  };
}

// ─── Panel: hotový prádlomat ─────────────────────────────────────────────────
// Co z tohohle místa zbyde po splátce jeho vlastního úvěru. Když na něj místo
// nevydělá, banka by na něj další peníze nepůjčila — hráč to má vidět.
function mistoUverHtml(u) {
  var l = uverMista(u);
  if (!l) {
    return (S.loan > 0
      ? '<p class="fine">' + esc(tx('hra.tenhle_pradlomat_je_doplaceny_cely')) + '</p>'
      : '<p class="fine">' + esc(tx('hra.nemas_dluh_takze_provozni_zisk')) + '</p>');
  }
  var urok = Math.round(l.zbyva * l.sazba / 12);
  var splatka = Math.min(l.splatka, l.zbyva + urok);
  var cisty = u.eco.profit - splatka;
  var kryti = splatka > 0 ? u.eco.profit / splatka : 9;
  return tx('veta.div_class_kv_span_splatka_uveru', { p1: kcFull(urok), p2: kcFull(splatka), p3: esc(tx('hra.cisty_vydelek')), p4: (cisty >= 0 ? 'ok' : 'err'), p5: kcFull(cisty), p6: esc(tx('hra.pokryti_splatky')), p7: (kryti >= 1.25 ? 'ok' : kryti >= 1 ? 'warn' : 'err'), p8: kryti.toFixed(2).replace('.', desZnak()), p9: (kryti >= 1.25
        ? esc(tx('hra.misto_si_na_svou_splatku'))
        : kryti >= 1
          ? esc(tx('hra.na_splatku_to_vyjde_jen'))
          : esc(tx('hra.tohle_misto_na_svou_splatku'))), p10: tx('veta.zbyva_splatit_jeste', { p1: kcFull(l.zbyva) }), p11: tx('veta.mesicu_p', { p1: (l.zbyvaMesicu || 0) }) });
}
// Co se o závadě píše v panelu místa — včetně toho, o kolik tržeb hráč přichází.
// Karta katastrofy. Dokud se oprava nezaplatí, stroj stojí a nic nevydělává.
function katastrofaHtml(u) {
  var k = u && u.katastrofa;
  if (!k) return '';
  var ted = Date.now();
  if (k.hotovo) {
    return '<div class="card vada-karta"><div class="row"><h3>\uD83D\uDEA7 ' + tx('veta.opravuje_se_h3_b_class_warn', { p1: esc(k.t), p2: etaText(Math.max(0, k.hotovo - ted)) });
  }
  return tx('veta.div_class_card_vada_karta_div', { p1: (k.ico || '\u26A0\uFE0F'), p2: esc(k.t), p3: esc(tx('hra.stoji_2')), p4: esc(k.p), p5: esc(tx('hra.pradlomat_nevydelava_vubec_nic_a')), p6: esc(tx('hra.oprava_celkem')), p7: kcFull(k.cena), p8: (k.pojisteno
        ? '<div class="kv"><span>' + esc(tx('hra.plati_pojistovna')) + '</span><b class="ok">' + kcFull(k.cena - k.platim) + '</b></div>'
        : ''), p9: esc(tx('hra.zaplatis_3')), p10: (k.pojisteno ? 'ok' : 'err'), p11: kcFull(k.platim), p12: esc(tx('hra.oprava_potrva')), p13: k.dnu, p14: mn(k.dnu, esc(tx('hra.herni_den')), esc(tx('hra.herni_dny')), esc(tx('hra.hernich_dnu'))), p15: (k.pojisteno ? '' : '<p class="fine warn">' + esc(tx('hra.pojisteny_nebyl_platis_celou_opravu')) + ' '
        + esc(tx('hra.pojisteni_zapnes_v_siti')) + '</p>'), p16: (S.cash < k.platim ? ' disabled' : ''), p17: kcFull(k.platim), p18: (S.cash < k.platim ? '<p class="fine err">' + esc(tx('hra.tolik_hotovosti_nemas')) + '</p>' : '') });
}
function poruchaHtml(u) {
  if (!jeVPoruse(u) && !u.technik) return '';
  var t = u.technik, ted = Date.now();
  if (jeVPoruse(u)) {
    var chod = chodStroje(u);
    var v = t ? null : vyjezdOdhad(u);
    return '<div class="card vada-karta"><div class="row"><h3>⚠️ ' + esc(u.porucha.text) + '</h3>'
      + '<b class="err">' + (chod ? esc(tx('hra.pul_provozu')) : esc(tx('hra.stoji_4'))) + '</b></div>'
      + '<p class="muted small" style="margin:4px 0 8px">'
      + (chod ? esc(tx('hra.cast_stroju_jede_dal_ale')) + ' '
              : esc(tx('hra.pradlomat_nevydelava_vubec_nic')) + ' ')
      + esc(tx('hra.najem_servis_i_splatka_bezi')) + '</p>'
      + (t
          ? '<div class="kv"><span>' + esc(tx('hra.technik')) + '</span><b>' + esc(ted < t.prijezd
              ? tx('veta.na_ceste_prijede', { p1: etaText(t.prijezd - ted) })
              : tx('veta.na_miste_hotovo', { p1: etaText(t.hotovo - ted) })) + '</b></div>'
          : (v
              ? '<div class="kv"><span>' + esc(tx('hra.odkud_pojede')) + '</span><b>' + esc(v.zakladna.name || esc(tx('hra.zakladna'))) + '</b></div>'
                + '<div class="kv"><span>' + esc(tx('hra.vzdalenost')) + '</span><b>' + Math.round(v.km) + ' km '
                  + v.zpusob.znak + ' ' + v.zpusob.nazev + '</b></div>'
                + '<div class="kv"><span>' + esc(tx('hra.cesta_a_oprava')) + '</span><b>' + etaText(v.celkem).replace('za ', '') + '</b></div>'
                + zaMoremRada(u, v)
                + '<button class="btn big" id="do-technik" style="width:100%;margin-top:10px">' + esc(tx('hra.vyslat_technika')) + '</button>'
              : '<p class="fine err">' + esc(tx('hra.nemas_zakladnu_odkud_technika_poslat')) + '</p>'))
      + '</div>';
  }
  return '<div class="card vada-karta"><div class="row"><h3>' + esc(tx('hra.spraveno')) + '</h3>'
    + '<b class="ok">' + esc(tx('hra.zase_jede')) + '</b></div>'
    + '<p class="muted small" style="margin:4px 0 0">' + esc(tx('hra.technik_jede_zpatky_na_zakladnu')) + '</p></div>';
}
function unitSheet(u) {
  var years = (Date.now() - u.builtAt) / YEAR_MS;
  sheet('<h3>' + esc(jmenoStroje(u.name)) + '</h3>'
    + '<p class="muted small">' + esc(KIND_LABEL[u.kind] || esc(tx('mapa.misto')))
    + (mestoUnit(u) ? ' · ' + esc(mestoUnit(u)) : '') + ' · ' + MODELS[u.eco.model].name
    + tx('hra.v_provozu_roku', { p1: years.toFixed(1).replace('.', desZnak()) })
    + (zemUnit(u) === 'moje' ? ' · <b class="ok">' + esc(tx('mapa.tvuj_pozemek')) + '</b>'
        : zemUnit(u) === 'najem' ? ' · <b class="ok">' + esc(tx('mapa.pronajaty_pozemek')) + '</b>' : '') + '</p>'
    + '<div style="margin:8px 0 12px">' + verdictPill(u.score) + '</div>'
    + (u.lat != null ? '<button class="btn sec" id="do-mapa" style="width:100%;margin-bottom:12px">' + esc(tx('mapa.ukazat_na_mape')) + '</button>' : '')
    + vypovedHtml(u)
    + vypovedMajiteleHtml(u)
    + katastrofaHtml(u)
    + poruchaHtml(u)
    + '<h3 style="margin:16px 0 4px">' + esc(tx('mapa.co_to_mesicne_dela')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('hra.obrat')) + '</span><b>' + kcFull(u.eco.revenue) + '</b></div>'
    + (u.eco.rent != null ? '<div class="kv"><span>' + esc(tx('mapa.najem')) + '</span><b class="warn">' + kcFull(u.eco.rent) + '</b></div>' : '')
    + (u.eco.energy != null ? tx('veta.div_class_kv_span_energie_obratu', { p1: pct(ENERGY_SHARE), p2: kcFull(u.eco.energy) }) : '')
    + (u.eco.servis != null ? tx('hra.div_class_kv_span_servis_a', { p1: pct(SERVIS_SHARE), p2: kcFull(u.eco.servis) }) : '')
    + '<div class="kv souhrn"><span>' + esc(tx('mapa.provozni_zisk')) + '</span><b class="'
      + (u.eco.profit >= 0 ? 'ok' : 'err') + '">' + kcFull(u.eco.profit) + '</b></div>'
    + mistoUverHtml(u)
    + smlouvaHtml(u)
    + '<h3 style="margin:16px 0 4px">' + esc(tx('hra.souhrn')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('hra.investice')) + '</span><b>' + kcFull(u.eco.invest) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('mapa.vydelal_celkem')) + '</span><b>' + kcFull(u.eco.ziskPlny * 12 * years) + '</b></div>'
    + (u.eco.ziskPlny > 0 ? '<div class="kv"><span>' + esc(tx('mapa.navratnost')) + '</span><b>'
      + (u.eco.invest / (u.eco.ziskPlny * 12)).toFixed(1).replace('.', desZnak()) + ' roku</b></div>' : '')
    + vymenaHtml(u)
    + '<h3 style="margin:18px 0 4px">' + esc(tx('hra.prodat_celou_provozovnu_2')) + '</h3>'
    + (trhMoje(u.spotId)
        ? tx('hra.p_class_muted_small_b_b', { p1: esc(tx('mapa.na_trzisti_za')), p2: kcFull(trhMoje(u.spotId).cena) })
          + tx('trh.do_te_doby_vydelava', { p1: etaText(new Date(trhMoje(u.spotId).konci).getTime() - Date.now()) })
        : '<p class="muted small">' + esc(tx('hra.stroj_najemni_smlouvu_i_pripojky')) + ' '
          + esc(tx('hra.kupujici_ma_hotovou_provozovnu_hned')) + '</p>')
    + '<button class="btn sec" id="do-trh" style="width:100%">'
    + (trhMoje(u.spotId) ? esc(tx('mapa.upravit_nabidku_na_trzisti')) : esc(tx('mapa.nabidnout_na_trzisti'))) + tx('veta.button_p_class_muted_small_style', { p1: esc(tx('hra.kdyz_je_jinde_lip_misto')), p2: esc(tx('mapa.vypovedet_misto')) }));
  bindVymena(u);
  var ob = $('do-oprava');
  if (ob) ob.onclick = function () { ob.disabled = true; zaplatOpravu(u); closeSheet(); unitSheet(u); };
  var tb = $('do-technik');
  if (tb) tb.onclick = function () { vyslatTechnika(u); closeSheet(); switchTab('map'); };
  var mb = $('do-mapa');
  if (mb) mb.onclick = function () {
    closeSheet(); switchTab('map');
    // Mapa se po přepnutí záložky musí přeměřit, jinak skočí vedle.
    setTimeout(function () {
      if (!map) return;
      map.invalidateSize();
      map.setView([u.lat, u.lon], Math.max(16, map.getZoom()));
    }, 60);
  };
  var db = $('do-dorovnat');
  if (db) db.onclick = function () {
    var v = vyzvaNaMiste(u.spotId);
    if (!v) return;
    db.disabled = true; db.textContent = esc(tx('mapa.jednam_s_majitelem'));
    apiJson('/spots/dorovnat', { spot_id: u.spotId }).then(function (r) {
      db.disabled = false; db.textContent = esc(tx('mapa.dorovnat_a_zustat'));
      if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_9')), 'err');
      // Nový nájem se musí propsat i do ekonomiky místa, jinak by zisk lhal.
      u.eco.rent = r.j.rent;
      u.eco.cost = u.eco.energy + u.eco.servis + u.eco.rent;
      u.eco.profit = u.eco.revenue - u.eco.cost;
      save(); paint(); loadClaims(); unitSheet(u); syncState(true);
      toast(tx('veta.dorovnano_misto_zustava_tvoje_najem_je', { p1: kcFull(r.j.rent) }), 'ok');
    }).catch(function () { db.disabled = false; db.textContent = esc(tx('mapa.dorovnat_a_zustat_2')); toast(esc(tx('mapa.server_neodpovida')), 'err'); });
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
    nb.disabled = true; nb.textContent = esc(tx('mapa.jednam_s_majitelem_2'));
    apiJson('/spots/navyseni', { spot_id: u.spotId, rent: novy }).then(function (r) {
      nb.disabled = false; nb.textContent = esc(tx('mapa.prisadit_a_zustat'));
      if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_10')), 'err');
      delete u.vypoved;
      // Vyšší nájem se musí propsat i do ekonomiky místa, jinak by zisk lhal.
      u.eco.rent = r.j.rent;
      u.eco.cost = u.eco.energy + u.eco.servis + u.eco.rent;
      u.eco.profit = u.eco.revenue - u.eco.cost;
      save(); paint(); loadClaims(); unitSheet(u); syncState(true);
      toast(tx('veta.domluveno_misto_zustava_tvoje_najem_je', { p1: kcFull(r.j.rent) }), 'ok');
    }).catch(function () {
      nb.disabled = false; nb.textContent = esc(tx('mapa.prisadit_a_zustat_2')); toast(esc(tx('mapa.server_neodpovida_2')), 'err');
    });
  };
  var rb = $('do-release');
  if (rb) rb.onclick = function () {
    if (rb.getAttribute('data-sure') !== '1') {
      rb.setAttribute('data-sure', '1');
      rb.textContent = esc(tx('hra.opravdu_klikni_znovu'));
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
        if (rb) { rb.disabled = false; rb.textContent = esc(tx('hra.vypovedet_misto')); rb.classList.remove('warn'); }
        if (S.cash < r.j.odstupne) {
          return toast(tx('veta.odstupne_je_a_tolik_hotovosti_nemas', { p1: kcFull(r.j.odstupne) }), 'err');
        }
        sheet(tx('veta.h3_h3_p_class_muted_small', { p1: esc(tx('hra.odstupne')), p2: r.j.zbyva, p3: mn(r.j.zbyva, esc(tx('hra.mesic')), esc(tx('hra.mesice')), esc(tx('hra.mesicu'))), p4: ODSTUPNE_MAX, p5: esc(tx('hra.odstupne_2')), p6: kcFull(r.j.odstupne), p7: kcFull(S.cash - r.j.odstupne), p8: esc(tx('hra.zaplatit_a_odejit')), p9: esc(tx('hra.nechat_byt_2')) }));
        var o = $('do-odstupne');
        if (o) o.onclick = function () {
          o.disabled = true;
          S.cash -= r.j.odstupne;
          zapis('poplatek', tx('veta.odstupne_z_najmu', { p1: (u.name || '') }), -r.j.odstupne);
          vypovedMisto(u, true, null);
        };
        var z = $('do-zustat');
        if (z) z.onclick = function () { closeSheet(); };
        return;
      }
      if (!r.ok) { if (rb) rb.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_11')), 'err'); }
      S.units = S.units.filter(function (x) { return x.spotId !== u.spotId; });
      S.stock[u.eco.model] = inStock(u.eco.model) + 1;
      osirelyUver(u.spotId);
      delete CLAIMS[u.spotId];
      save(); prehodnotRamec(false, true); paint(); drawMap(); closeSheet(); syncState(true);
      toast(tx('veta.ceka_na_sklade', { p1: esc(tx('hra.misto_vypovezeno')), p2: MODELS[u.eco.model].name }), 'ok');
  }).catch(function () { if (rb) rb.disabled = false; toast(esc(tx('hra.server_neodpovida_11')), 'err'); });
}

// ─── Výměna stroje za jiný model ─────────────────────────────────────────────
// Místo zůstává i s nájmem a přípojkami, mění se jen stroj. Starý jde na sklad,
// nový se bere ze skladu — stejné pravidlo jako u stavby. Platí se doprava
// nového stroje a u silnějšího modelu rozdíl v přípojkách; co je jednou v zemi,
// se nevrací, takže při výměně za slabší se nevrací nic.
function mistoUnitu(u) {
  return { id: u.spotId, name: u.name, kind: u.kind, score: u.score, lat: u.lat, lon: u.lon,
    parking: u.parking, competition: u.competition, anchors: u.anchors };
}
function vymenaCena(u, novy) {
  var sp = mistoUnitu(u);
  var doprava = dopravaNa(sp, novy);
  var doplatek = Math.max(0, connPrice(sp, novy) - connPrice(sp, u.eco.model));
  return { doprava: doprava, doplatek: doplatek, celkem: doprava + doplatek };
}
function vymenaHtml(u) {
  // Místo ve výpovědi se nevyměňuje — stroj se odtud stejně brzy stěhuje.
  if (jeVeVypovedi(u)) return '';
  var sp = mistoUnitu(u);
  var jine = MODEL_ORDER.filter(function (k) { return k !== u.eco.model; });
  var radky = jine.map(function (k) {
    var skladem = inStock(k), m = MODELS[k];
    var e = economics(sp, k, u.eco.podil);
    var rozdil = e.profit - u.eco.profit;
    var c = vymenaCena(u, k);
    return '<div class="vym-r' + (skladem ? '' : ' nic') + tx('veta.div_class_vym_t_b_b', { p1: esc(m.name), p2: String(m.kapacita).replace('.', desZnak()), p3: kcFull(e.profit) }) + (rozdil > 0 ? 'ok' : (rozdil < 0 ? 'err' : 'muted')) + '">('
      + (rozdil > 0 ? '+' : (rozdil < 0 ? '\u2212' : '')) + kcFull(Math.abs(rozdil)) + ')</span></i>'
      + '<i>' + (skladem ? tx('hra.u00d7_skladem_vymena_za', { p1: skladem, p2: kcFull(c.celkem) })
          : esc(tx('hra.nemas_skladem_kup_ho_v'))) + '</i></div>'
      + (skladem ? '<button class="btn sm" data-vymena="' + k + '">' + esc(tx('hra.vymenit')) + '</button>' : '')
      + '</div>';
  }).join('');
  return '<h3 style="margin:18px 0 4px">' + tx('veta.h3_p_class_muted_small_stary', { p1: esc(tx('hra.vymenit_stroj')), p2: esc(tx('hra.najem_pripojky_i_zabor_mista')), p3: radky });
}
function bindVymena(u) {
  [].forEach.call(document.querySelectorAll('#sheet-body [data-vymena]'), function (b) {
    b.onclick = function () { vymenaSheet(u, b.getAttribute('data-vymena')); };
  });
}
function vymenaSheet(u, novy) {
  var sp = mistoUnitu(u), m = MODELS[novy], stary = MODELS[u.eco.model];
  var c = vymenaCena(u, novy);
  var e = economics(sp, novy, u.eco.podil);
  var rozdil = e.profit - u.eco.profit;
  var malo = S.cash < c.celkem;
  sheet(tx('veta.h3_vymenit_za_h3_p_class', { p1: esc(stary.name), p2: esc(m.name), p3: esc(jmenoStroje(u.name)) }) + (mestoUnit(u) ? ' \u00b7 ' + esc(mestoUnit(u)) : '') + '</p>'
    + '<div class="kv"><span>' + esc(tx('hra.doprava_stroje_2')) + '</span><b>' + kcFull(c.doprava) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.doplatek_pripojek')) + '</span><b' + (c.doplatek ? ' class="warn"' : ' class="ok"') + '>'
    + (c.doplatek ? kcFull(c.doplatek) : esc(tx('hra.zadny'))) + '</b></div>'
    + '<div class="kv souhrn"><span>' + esc(tx('hra.zaplatis')) + '</span><b>' + kcFull(c.celkem) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.zisk_mista_ted')) + '</span><b>' + kcFull(u.eco.profit) + ' ' + esc(tx('hra.mesic_14')) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.po_vymene')) + '</span><b class="' + (rozdil >= 0 ? 'ok' : 'err') + '">'
    + kcFull(e.profit) + ' ' + esc(tx('hra.mesic_15')) + '</b></div>'
    + (rozdil > 0 ? tx('hra.p_class_fine_ok_vymena_se', { p1: etaText(Math.max(1, Math.round(c.celkem / Math.max(1, rozdil) * MONTH_MS))) })
      : rozdil < 0 ? '<p class="fine warn">' + esc(tx('hra.tohle_misto_tolik_lidi_neuzivi')) + ' '
        + esc(tx('hra.dava_smysl_jen_tehdy_kdyz')) + '</p>' : '')
    + tx('veta.p_class_fine_se_vrati_na', { p1: esc(stary.name), p2: esc(m.name) })
    + (malo ? '<p class="fine err">' + esc(tx('hra.na_vymenu_nemas_dost_hotovosti')) + '</p>' : '')
    + '<button class="btn big" id="do-vymena"' + (malo ? ' disabled' : '') + tx('veta.style_width_100_margin_top_10px', { p1: kcFull(c.celkem), p2: esc(tx('hra.nechat_byt_3')) }));
  var ne = $('do-vymena-ne');
  if (ne) ne.onclick = function () { closeSheet(); unitSheet(u); };
  var ok = $('do-vymena');
  if (ok) ok.onclick = function () { ok.disabled = true; vymenStroj(u, novy, ok); };
}
function vymenStroj(u, novy, btn) {
  var stary = u.eco.model;
  if (inStock(novy) < 1) { if (btn) btn.disabled = false; return toast(esc(tx('hra.tenhle_model_nemas_skladem')), 'err'); }
  var c = vymenaCena(u, novy);
  if (S.cash < c.celkem) { if (btn) btn.disabled = false; return toast(esc(tx('hra.na_vymenu_nemas_dost_hotovosti_2')), 'err'); }
  apiJson('/spots/model', { spot_id: u.spotId, model: novy }).then(function (r) {
    if (!r.ok) { if (btn) btn.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_12')), 'err'); }
    S.stock[novy] = inStock(novy) - 1;
    S.stock[stary] = inStock(stary) + 1;
    S.cash -= c.celkem;
    zapis('nakup', tx('veta.vymena_stroje', { p1: (u.name || '') }) + MODELS[stary].name + ' \u2192 '
      + MODELS[novy].name + ')', -c.celkem);
    u.eco = economics(mistoUnitu(u), novy, u.eco.podil);
    if (CLAIMS[u.spotId]) CLAIMS[u.spotId].model = novy;
    save(); paint(); drawMap(); closeSheet(); syncState(true);
    toast(tx('veta.je_na_sklade_na_miste_ted', { p1: MODELS[stary].name, p2: MODELS[novy].name }), 'ok');
  }).catch(function () { if (btn) btn.disabled = false; toast(esc(tx('hra.server_neodpovida_26')), 'err'); });
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
  var txt = esc(tx('hra.stavim_sit_pradlomatu_v_laundromat'));
  if (navigator.share) {
    navigator.share({ title: esc(tx('hra.laundromat_tycoon_2')), text: txt, url: url }).catch(function () {});
    return;
  }
  var done = function () { btn.textContent = esc(tx('hra.odkaz_zkopirovan')); setTimeout(function () { btn.textContent = esc(tx('hra.zkopirovat_odkaz_2')); }, 2000); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(function () { prompt(esc(tx('hra.zkopiruj_odkaz')), url); });
  else prompt(esc(tx('hra.zkopiruj_odkaz_2')), url);
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
  toast(tx('veta.sidlo_firmy_mas_v_zmenit_se_2', { p1: S.sidlo.name }), 'ok');
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
    t: esc(tx('hra.vyber_si_mesto')),
    p: esc(tx('hra.napis_mesto_a_posli_tam')),
    proc: esc(tx('hra.bez_mist_nemas_kam_stavet')),
    pozor: tx('veta.cesta_stoji_sidlo_se_pozdeji_zmenit', { p1: kcFull(SCOUT_COST) }),
    cil: '#sidlo-mesto, #sidlo-go', nouze: '#open-areas'
  };
  if (k === 2) {
    var proveril = Object.keys(S.revealed || {}).length > 0;
    if (!proveril) return {
      t: esc(tx('hra.prover_si_misto')),
      p: esc(tx('hra.klepni_na_domecek_na_mape')),
      proc: esc(tx('hra.dokud_misto_neproveris_vidis_jen')),
      pozor: tx('veta.obhlidka_stoji_cim_vyssi_skore_tim', { p1: kcFull(REVEAL_COST) }),
      cil: '#do-reveal', nouze: '#tab-map'
    };
    return {
      t: esc(tx('hra.domluv_najem')),
      p: esc(tx('hra.vyber_vazanost_a_vypovedni_dobu')),
      proc: esc(tx('hra.bez_smlouvy_se_stavet_neda')),
      pozor: esc(tx('hra.delsi_vazanost_je_drazsi_ale')),
      cil: '.najem-seg, #do-lease', nouze: '#tab-map'
    };
  }
  if (k === 3) return {
    t: esc(tx('hra.kup_pradlomat')),
    p: esc(tx('hra.v_obchode_vezmi_mini_zaplatis')),
    proc: esc(tx('hra.mini_je_nejlevnejsi_stroj_na')),
    pozor: esc(tx('hra.nech_si_rezervu_pripojky_na')),
    cil: '#v-shop [data-buy="mini"], [data-doobchodu="mini"]', nouze: '#tab-shop'
  };
  if (k === 4) return ownedOf('rush') ? {
    t: esc(tx('hra.doruc_ho_hned')),
    p: esc(tx('hra.pouzij_kartu_expresni_dovoz_a')),
    proc: esc(tx('hra.bezne_dodani_jsou_dva_herni')),
    pozor: esc(tx('hra.kartu_mas_jednu_do_zacatku')),
    cil: '#v-shop .btn.rush', nouze: '#tab-shop'
  } : {
    t: esc(tx('hra.stroj_je_na_ceste')),
    p: esc(tx('hra.dopravce_ho_veze_az_dorazi')),
    proc: esc(tx('hra.dodani_trva_dva_herni_mesice')),
    pozor: esc(tx('hra.mezitim_si_muzes_proverit_dalsi')),
    cil: '#tab-shop', nouze: '#tab-shop'
  };
  if (k === 5) return {
    t: esc(tx('hra.postav_pradlomat')),
    p: esc(tx('hra.klepni_na_misto_s_domluvenym')),
    proc: esc(tx('hra.tim_ti_zacne_tect_prvni')),
    pozor: esc(tx('hra.pri_stavbe_zaplatis_pripojky_vodu')),
    cil: '[data-build], #do-build', nouze: '#tab-map'
  };
  return null;
}
// Standa — provozní, co prádlomaty dělá roky. Provede hráče prvním strojem.
var TUT_KDO = { jmeno: esc(tx('hra.standa')), role: esc(tx('hra.provozni_40_pradlomatu')) };
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
      toast(esc(tx('hra.prvni_pradlomat_stoji_ted_uz')), 'ok');
      // Teď má smysl se ptát, jaký je podnikatel — a nabídnout účet.
      if (!S.profilVybran) setTimeout(otevriDotaznik, 1400);
    }
    return;
  }
  bar.classList.remove('hidden');
  // Kolik lidí který krok vůbec uvidí. Bez toho nevíme, kde se cesta
  // k prvnímu prádlomatu láme — v administraci je to v trychtýři.
  ev('game_tut' + k);
  $('tut-krok').textContent = tx('veta.krok_z', { p1: k, p2: TUT_KROKU });
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
      + (info.pozor ? '<p class="tut-pozor">' + esc(tx('hra.pozor')) + ' ' + esc(info.pozor) + '</p>' : '')
      + '<div class="tut-akce"><button class="btn sm" id="tut-ok">' + esc(tx('hra.rozumim_3')) + '</button>'
      + '<button class="tut-preskoc" id="tut-pres">' + esc(tx('hra.preskocit')) + '</button></div>';
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
  toast(esc(tx('hra.tutorial_vypnuty_naseptavat_uz_ti')), 'ok');
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
  sheet(tx('veta.h3_h3_p_class_muted_small_2', { p1: esc(tx('hra.kde_bude_mit_firma_sidlo')), p2: esc(tx('hra.mesto')), p3: esc(tx('hra.poslat_tam_cloveka')), p4: kcFull(SCOUT_COST) }));
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
  // Uprostřed lišty je vidět, jaký je herní měsíc a jak na tom je ekonomika —
  // sezóna a krize se násobí, takže se ukazuje výsledek obojího.
  var e = S ? ekonomika() : null;
  var stav = '';
  if (e) {
    var nad = Math.round((e.koef - 1) * 100);
    stav = '<u class="' + (e.krize ? 'err' : nad > 1 ? 'ok' : nad < -1 ? 'warn' : '') + '">'
      + MESICE[e.mesic] + ' ' + (nad > 0 ? '+' : '') + nad + ' %</u>';
  }
  if (ME) {
    var firma = ME.company || (ME.nick + ' s.r.o.');
    // Místo nicku ukazujeme hodnost: svoje jméno hráč zná, ale kde zrovna je
    // na žebříku, se mění — a to je informace, kvůli které se na lištu dívá.
    el.innerHTML = (ME.emblem ? znakSvg(ME.emblem, 20) + ' ' : '')
      + '<b>' + esc(firma) + '</b>' + stav + '<i>' + esc(mojeHodnost().nazev) + '</i>';
  } else {
    el.innerHTML = '<b class="muted">' + esc(tx('hra.hrajes_bez_uctu')) + '</b>' + stav + '<i>' + esc(tx('hra.zalozit_firmu')) + '</i>';
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
    pod.textContent = sklad ? sklad + ' skladem' : (vezou ? tx('veta.na_ceste', { p1: vezou }): '');
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
    // Agenda míst se musí překreslit taky — po výměně stroje nebo stavbě
    // v ní jinak svítí starý model, dokud hráč hru neobnoví.
    else if (!$('net-mista').classList.contains('hidden')) paintMista();
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
  var zm = !o.zmena ? esc(tx('hra.beze_zmeny_od_zacatku'))
    : (o.zmena > 0 ? '▲ +' : '▼ −') + tx('veta.od_zacatku', { p1: o.jed(Math.abs(o.zmena)) });
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
  $('net-mista').classList.toggle('hidden', kam !== 'mista');
  $('net-vyvoj').classList.toggle('hidden', kam !== 'vyvoj');
  $('net-zebricek').classList.toggle('hidden', kam !== 'zebricek');
  if (kam === 'zebricek') { ZEB = null; paintZeb(); }
  else if (kam === 'vyvoj') paintVyvoj();
  else if (kam === 'stroje') paintStroje();
  else if (kam === 'mista') paintMista();
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
    el.innerHTML = '<div class="empty">' + esc(tx('hra.na_graf_je_jeste_brzo')) + '<br>'
      + esc(tx('hra.bod_pribyva_kazdy_herni_mesic')) + '</div>';
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
  var kus = function (v) { return tCislo(v) + '×'; };
  var mez = [];
  h.forEach(function (x, i) { if (i && x.m % 12 === 0) mez.push(i); });
  var odtok = h.map(function (x) { return Math.round((Number(x.s) || 0) + (Number(x.o) || 0)); });
  var zbyde = posl.z - odtok[odtok.length - 1];
  var souhrn = '<div class="card graf-karta">'
    + '<div class="row"><h3>' + esc(tx('hra.vsechno_dohromady')) + '</h3><b class="' + (zbyde >= 0 ? 'ok' : 'err') + '">'
    + kcFull(zbyde) + '</b></div>'
    + '<p class="graf-zmena muted">' + (zbyde >= 0 ? esc(tx('hra.tolik_ti_ted_mesicne_zbyde'))
        : esc(tx('hra.tolik_ti_ted_kazdy_mesic'))) + '</p>'
    + grafSouhrn({ trzby: vzit('t'), zisk: vzit('z'), odtok: odtok, pocty: vzit('p'), mezniky: mez })
    + tx('veta.div_class_legenda_div_p_class', { p1: legendaRadek('#4fd1ff', esc(tx('hra.trzby')), kcFull(posl.t)), p2: legendaRadek('#2fe3a0', esc(tx('hra.zisk')), kcFull(posl.z)), p3: legendaRadek('#ffd866', esc(tx('hra.splatky_a_provoz')), kcFull(odtok[odtok.length - 1])), p4: legendaRadek('#7c5cff', esc(tx('hra.pradlomaty')), kus(posl.p), true) });
  el.innerHTML = souhrn
    + grafKarta({ nadpis: esc(tx('hra.trzby_pradlomatu')), body: vzit('t'), barva: '#4fd1ff', jed: kcFull,
        ted: posl.t, zmena: posl.t - prvni.t,
        pod: esc(tx('hra.co_pradlomaty_za_mesic_vyberou')), mezniky: mez })
    + grafKarta({ nadpis: esc(tx('hra.zisk_pred_splatkou')), body: vzit('z'), barva: '#2fe3a0', jed: kcFull,
        ted: posl.z, zmena: posl.z - prvni.z,
        pod: esc(tx('hra.trzby_minus_energie_servis_a')), mezniky: mez })
    + grafKarta({ nadpis: esc(tx('hra.zavazky_bance')), body: vzit('d'), barva: '#ff5d6c', jed: kcFull,
        ted: posl.d, zmena: posl.d - prvni.d, dobreNahoru: false,
        pod: tx('hra.kolik_jeste_zbyva_splatit_bance_na', { p1: kcFull(posl.s) }), mezniky: mez })
    + grafKarta({ nadpis: esc(tx('hra.pradlomaty_2')), body: vzit('p'), barva: '#7c5cff', jed: kus, schody: true,
        ted: posl.p, zmena: posl.p - prvni.p,
        pod: esc(tx('hra.kolik_jich_v_siti_stalo')), mezniky: mez })
    + tx('veta.p_class_fine_style_margin_4px', { p1: esc(tx('hra.jeden_bod_je_jeden_herni')) }) + (Math.floor(prvni.m / 12) + 1) + '.'
    + (h.some(function (x) { return x.r; })
        ? tx('hra.cast_pred_dneskem_je_dopocitana_ze')
        : '')
    + '</p>';
}
// ─── Žebříček vlastních strojů ──────────────────────────────────────
// Které místo táhne a které se jen veze. Řadí se podle vybraného sloupce, ale
// každá řádka ukáže všechno podstatné najednou, ať se nemusí přebírat záložkami.
var STROJE_KAT = 'zisk';
var STROJE_POPIS = {
  zisk: { nadpis: esc(tx('hra.co_ktery_stroj_vydela')), vic: esc(tx('hra.nejvic_nahore')),
    pod: esc(tx('hra.zisk_mista_po_zaplaceni_jeho')),
    hodnota: function (u) { return zbydeZMista(u); }, jed: kcFull, dolu: false,
    shrn: function (a, b) { return tx('veta.nejvic_vydela', { p1: tx('veta.nejmene', { p1: a, p2: b }) }); } },
  trzby: { nadpis: esc(tx('hra.nejvetsi_trzby')), vic: esc(tx('hra.nejvic_nahore_2')),
    pod: esc(tx('hra.co_stroj_za_mesic_vybere')),
    hodnota: function (u) { return u.eco.revenue; }, jed: kcFull, dolu: false,
    shrn: function (a, b) { return tx('veta.nejvetsi_trzbu_ma', { p1: tx('veta.nejmensi', { p1: a, p2: b }) }); } },
  poruchy: { nadpis: esc(tx('hra.nejvic_poruch')), vic: esc(tx('hra.nejhorsi_nahore')),
    pod: esc(tx('hra.kolikrat_se_stroj_od_postaveni')),
    hodnota: function (u) { return u.vady || 0; },
    jed: function (n) { return n + '×'; }, dolu: false,
    shrn: function (a, b) { return tx('veta.nejvic_poruch_ma', { p1: tx('veta.nejmene', { p1: a, p2: b }) }); } },
  navratnost: { nadpis: esc(tx('hra.nejrychlejsi_navratnost')), vic: esc(tx('hra.nejkratsi_nahore')),
    pod: esc(tx('hra.za_jak_dlouho_se_investice')),
    hodnota: function (u) { return u.eco.payback == null ? 1e9 : u.eco.payback; },
    jed: function (v) { return v >= 1e8 ? '—' : v.toFixed(1).replace('.', desZnak()) + ' roku'; }, dolu: true,
    shrn: function (a, b) { return tx('veta.nejrychleji_se_vrati_nejpomaleji', { p1: a, p2: b }); } }
};
// Místo, o které hráč může přijít. Buď ho někdo přeplatil u majitele pozemku,
// nebo mu vypověděl sám majitel — v obou případech se s tím ještě dá něco dělat.
function vypovedStav(u) {
  if (!u) return null;
  var v = vyzvaNaMiste(u.spotId);
  if (v) return { typ: 'preplaceno', do: v.do, kdo: v.nick, rent: v.rent,
    text: tx('veta.preplatil_najem', { p1: v.nick }), akce: esc(tx('hra.dorovnat')) };
  if (u.vypoved && u.vypoved.do) return { typ: 'majitel', do: u.vypoved.do,
    text: esc(tx('hra.majitel_dal_vypoved')), akce: u.vypoved.navyseni ? esc(tx('hra.prisadit')) : esc(tx('hra.resit')) };
  return null;
}
// Město, ve kterém stroj stojí. Oblast se jmenuje po městě, do kterého hráč
// poslal průzkum. U úplně starých strojů může chybět — pak radši nepíšeme nic.
function mestoUnit(u) {
  var a = u && u.areaId && S.areas ? S.areas[u.areaId] : null;
  return a && a.name ? a.name : '';
}
function strojRadek(u, i) {
  var popis = STROJE_POPIS[STROJE_KAT];
  var im = MODEL_IMG[u.eco && u.eco.model] || MODEL_IMG.flex;
  var m = MODELS[u.eco && u.eco.model];
  var vada = jeVPoruse(u) || jeVKatastrofe(u);
  var spl = Math.round(spolehlivost(u) * 100);
  var hod = popis.hodnota(u);
  var zisk = zbydeZMista(u);
  // Pod názvem jedna řádka se vším podstatným — model, tržba, poruchy, spolehlivost.
  var vady = u.vady || 0;
  var zem = zemUnit(u);
  var mesto = mestoUnit(u);
  var detail = (m ? m.name : '') + (mesto ? ' · ' + mesto : '')
    + (zem === 'moje' ? ' ' + esc(tx('hra.na_tvem_pozemku')) : zem === 'najem' ? ' ' + esc(tx('hra.na_pronajatem_pozemku')) : '')
    + tx('veta.trzba_bez_zavady', { p1: kc(u.eco.revenue), p2: vady, p3: mn(vady, 'porucha', 'poruchy', 'poruch'), p4: spl });
  var vyp = vypovedStav(u);
  return '<div class="zeb-row stroj' + (vada ? ' vada' : '') + (vyp ? ' vypoved' : '')
      + '" data-stroj-id="' + esc(u.spotId) + '">'
    + '<i class="poradi' + (i < 3 ? ' medaile m' + (i + 1) : '') + '">' + (i + 1) + '</i>'
    + '<img class="stroj-foto" src="' + esc(im.src) + '" alt="">'
    + '<span class="nick">' + esc(jmenoStroje(u.name))
      + (vyp ? ' <em class="vyp-znak">\u25B2</em>' : '')
      + (vada ? ' <em class="vada-znak">⚠️</em>' : '')
    + '<i>' + esc(detail) + '</i>'
    + (vyp ? tx('veta.i_class_vyp_radka_u25b2_zbyva', { p1: esc(vyp.text), p2: etaText(Math.max(0, vyp.do - Date.now())).replace('za ', ''), p3: esc(u.spotId), p4: esc(vyp.akce) }): '')
    + '</span>'
    + '<b class="' + (STROJE_KAT === 'zisk' ? (zisk >= 0 ? 'ok' : 'err')
        : (STROJE_KAT === 'poruchy' && hod ? 'warn' : '')) + '">' + popis.jed(hod) + '</b></div>';
}
// ─── Agenda míst ─────────────────────────────────────────────────────────────
// Všechna prověřená místa v jednom seznamu od nejlepšího po nejhorší. Hráč
// s velkou sítí jinak nemá jak poznat, že na devadesátce dusí MINI a stovka
// vedle je pořád volná. Řádek nic nemění — jen otevře to, co dává smysl:
// vlastní místo detail prádlomatu (tam je výměna i výpověď), volné stavbu,
// cizí přeplacení nájmu.
var MISTA_FILTR = 'vse';
var MISTA_STRANKA = 40;
var MISTA_VIC = 0;
// Všechna prověřená místa ze všech prozkoumaných měst, s tím, co na nich je.
function vsechnaMista() {
  var out = [];
  Object.keys(S.areas || {}).forEach(function (aid) {
    var a = S.areas[aid];
    (a.spots || []).forEach(function (sp) {
      if (!S.revealed || !S.revealed[sp.id]) return;      // neprověřené nemá smysl řadit
      // Na vlastním pozemku může stát víc strojů pod id „místo#1"; bereme je taky,
      // jinak by místo zůstalo v seznamu jako volné, i když na něm hráč staví.
      var moje = (S.units || []).filter(function (x) {
        return x.spotId === sp.id || String(x.spotId || '').indexOf(sp.id + '#') === 0;
      });
      var u = moje[0] || null;
      var c = !u && CLAIMS[sp.id] && !CLAIMS[sp.id].mine ? CLAIMS[sp.id] : null;
      out.push({ sp: sp, areaId: aid, mesto: a.name || '', u: u, kolik: moje.length, cizi: c,
        stav: u ? 'moje' : (c ? 'cizi' : 'volna') });
    });
  });
  return out.sort(function (x, y) { return (y.sp.score || 0) - (x.sp.score || 0); });
}
function mistoRadek(r) {
  var sp = r.sp, u = r.u;
  var m = u ? MODELS[u.eco && u.eco.model] : null;
  var im = u ? (MODEL_IMG[u.eco && u.eco.model] || MODEL_IMG.flex) : null;
  var e = u ? u.eco : economics(sp, 'flex', 1);
  var zem = jePozemek(sp) || mamPozemek(sp.id);
  var stav = u
    ? '<b class="ok">' + esc(m ? m.name : '') + '</b>'
      + (r.kolik > 1 ? tx('veta.a_dalsi', { p1: (r.kolik - 1) }) : '')
      + tx('hra.zisk_dvojtecka', { p1: kcFull(r.kolik > 1
          ? (S.units || []).filter(function (x) {
              return x.spotId === sp.id || String(x.spotId || '').indexOf(sp.id + '#') === 0;
            }).reduce(function (a, x) { return a + zbydeZMista(x); }, 0)
          : zbydeZMista(u)) })
    : r.cizi
      ? '<span class="err">' + esc(r.cizi.firma || r.cizi.nick || 'konkurence') + '</span> · '
        + esc((MODELS[r.cizi.model] || {}).name || '') + tx('veta.najem', { p1: kcFull(r.cizi.rent || 0) })
      : tx('veta.span_class_warn_span_najem', { p1: esc(tx('hra.volne_2')) }) + (zem ? esc(tx('hra.zadny_pozemek')) : kcFull(rentOf(sp)))
        + tx('veta.flex_by_vydelal', { p1: kcFull(e.profit) });
  return '<div class="zeb-row misto" data-misto-id="' + esc(sp.id) + '">'
    + (im ? '<img class="misto-ico" src="' + esc(im.src) + '" alt="">'
        : '<i class="misto-ico prazdna">' + (r.cizi ? '\u26A0\uFE0F' : '\u25CB') + '</i>')
    + '<span class="nick">' + esc(sp.name || esc(tx('hra.misto_4')))
    + '<i>' + [KIND_LABEL[sp.kind] || '', r.mesto || ''].filter(Boolean).map(esc).join(' · ') + '</i>'
    + '<i>' + stav + '</i></span>'
    + '<b class="' + skoreTrida(sp.score) + '">' + Math.round(sp.score) + '</b></div>';
}
function paintMista() {
  var box = $('mista-body');
  if (!box) return;
  var vse = vsechnaMista();
  var list = MISTA_FILTR === 'vse' ? vse : vse.filter(function (r) { return r.stav === MISTA_FILTR; });
  var pocty = { moje: 0, volna: 0, cizi: 0 };
  vse.forEach(function (r) { pocty[r.stav]++; });
  if (!vse.length) {
    box.innerHTML = '<div class="empty">' + esc(tx('hra.zatim_nemas_proverene_ani_jedno')) + '<br>'
      + esc(tx('hra.prozkoumej_mesto_a_mista_si')) + '</div>';
    return;
  }
  var kolik = MISTA_STRANKA + MISTA_VIC;
  var videt = list.slice(0, kolik);
  box.innerHTML = tx('veta.h3_style_margin_14px_0_2px', { p1: tx('veta.span_class_muted_small_style_font', { p1: esc(tx('hra.nejlepsi_nahore')), p2: esc(tx('hra.proverena_mista_ze_vsech_tvych')), p3: pocty.moje, p4: pocty.volna, p5: pocty.cizi }), p2: (list.length ? videt.map(mistoRadek).join('')
        : '<div class="empty">' + esc(tx('hra.v_tehle_skupine_nic_nemas')) + '</div>'), p3: (list.length > videt.length
        ? tx('hra.button_class_btn_sec_id_mista', { p1: Math.min(MISTA_STRANKA, list.length - videt.length) }) : '') });
  var vic = $('mista-vic');
  if (vic) vic.onclick = function () { MISTA_VIC += MISTA_STRANKA; paintMista(); };
  [].forEach.call(box.querySelectorAll('[data-misto-id]'), function (el) {
    el.onclick = function () { otevriMisto(el.getAttribute('data-misto-id')); };
  });
}
// Co se po klepnutí otevře, rozhoduje stav místa.
function otevriMisto(id) {
  var r = vsechnaMista().filter(function (x) { return x.sp.id === id; })[0];
  if (!r) return;
  if (r.u) return unitSheet(r.u);
  spotSheet(r.sp, r.areaId);
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
    box.innerHTML = '<div class="empty">' + esc(tx('mapa.zatim_nemas_ani_jeden_pradlomat')) + '<br>'
      + esc(tx('hra.zacni_tim_ze_na_mape_2')) + '</div>';
    return;
  }
  var vad = list.reduce(function (a, u) { return a + (u.vady || 0); }, 0);
  var nej = list[0], posl = list[list.length - 1];
  var vypovedi = list.filter(function (u) { return !!vypovedStav(u); });
  box.innerHTML = '<h3 style="margin:14px 0 2px">' + popis.nadpis
    + ' <span class="muted small" style="font-weight:600">(' + popis.vic + ')</span></h3>'
    + '<p class="muted small" style="margin:0 0 10px">' + popis.pod + '</p>'
    + (vypovedi.length
        ? tx('hra.div_class_vyp_lista_u25b2_ve', { p1: vypovedi.length, p2: mn(vypovedi.length, esc(tx('mapa.misto_je')), esc(tx('mapa.mista_jsou')), esc(tx('mapa.mist_je'))), p3: esc(tx('hra.dokud_lhuta_bezi_vydelavaji_dal')) })
        : '')
    + tx('veta.div_class_zeb_div_p_class', { p1: list.map(strojRadek).join(''), p2: list.length, p3: mn(list.length, 'stroj', 'stroje', esc(tx('mapa.stroju'))), p4: vad, p5: mn(vad, 'porucha', 'poruchy', 'poruch') })
    + (list.length > 1 && popis.hodnota(nej) !== popis.hodnota(posl)
        ? ' ' + popis.shrn(esc(nej.name), esc(posl.name)) : '')
    + '</p>';
  [].forEach.call(box.querySelectorAll('[data-stroj-id]'), function (r) {
    r.onclick = function () { unitSheet(najdiJednotku(r.getAttribute('data-stroj-id'))); };
  });
  // Tlačítko u výpovědi otevře detail místa, kde se dá přihodit nebo dorovnat.
  [].forEach.call(box.querySelectorAll('[data-vyp-id]'), function (b) {
    b.onclick = function (ev2) {
      ev2.stopPropagation();
      unitSheet(najdiJednotku(b.getAttribute('data-vyp-id')));
    };
  });
}
// ─── Žebříčky ────────────────────────────────────────────────────────────────
var ZEB = null, ZEB_KAT = 'pradlomaty';
var ZEB_POPIS = {
  pradlomaty: { nadpis: esc(tx('mapa.nejvic_pradlomatu')), jed: function (v) { return v + '×'; },
    pod: esc(tx('mapa.pocitaji_se_postavene_pradlomaty_to')) + ' '
      + esc(tx('mapa.koupeny_pozemek_bez_stroje_se')) },
  zisk: { nadpis: esc(tx('mapa.nejvyssi_mesicni_zisk')), jed: function (v) { return kcFull(v); },
    pod: tx('veta.co_hraci_mesicne_zbyde_po_splatkach')},
  hvezdy: { nadpis: esc(tx('mapa.nejlepsi_hodnoceni_zakazniku')),
    jed: function (v) { return hvezdyText(v); },
    pod: esc(tx('mapa.jedna_az_pet_hvezdicek_podle')) + ' '
      + esc(tx('mapa.kdo_jeste_zadny_hovor_nemel')) },
  pozvanky: { nadpis: esc(tx('mapa.nejvic_pozvanek')), jed: function (v) { return v + '×'; },
    pod: esc(tx('mapa.kolikrat_nekdo_otevrel_sdileny_odkaz')) },
  zeme: { nadpis: esc(tx('mapa.pradlomaty_po_zemich')), jed: function (v) { return v + '×'; },
    pod: tx('veta.kolik_pradlomatu_stoji_v_ktere_zemi')},
  jmeni: { nadpis: esc(tx('mapa.nejvetsi_ciste_jmeni')), jed: function (v) { return kcFull(v); },
    pod: tx('veta.co_hrac_ma_minus_co_dluzi')}
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
var ZEME_NAZEV = { cz: esc(tx('hra.cesko')), sk: esc(tx('hra.slovensko')), pl: esc(tx('hra.polsko')), de: esc(tx('hra.nemecko')), at: esc(tx('hra.rakousko')),
  hu: esc(tx('hra.madarsko')), si: esc(tx('hra.slovinsko')), hr: esc(tx('hra.chorvatsko')), it: esc(tx('hra.italie')), es: esc(tx('hra.spanelsko')),
  fr: esc(tx('hra.francie')), nl: esc(tx('hra.nizozemsko')), be: esc(tx('hra.belgie')), ch: esc(tx('hra.svycarsko')), gb: esc(tx('hra.velka_britanie')),
  ie: esc(tx('hra.irsko')), dk: esc(tx('hra.dansko')), se: esc(tx('hra.svedsko')), no: esc(tx('hra.norsko')), fi: esc(tx('hra.finsko')), pt: esc(tx('hra.portugalsko')),
  ro: esc(tx('hra.rumunsko')), bg: esc(tx('hra.bulharsko')), gr: esc(tx('hra.recko')), ua: esc(tx('hra.ukrajina')), us: esc(tx('hra.spojene_staty')),
  ca: esc(tx('hra.kanada')) };
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
  return n + (n === 1 ? ' ' + esc(tx('hra.hrac_4')) : (n >= 2 && n <= 4 ? ' ' + esc(tx('hra.hraci_4')) : ' ' + esc(tx('hra.hracu_4'))));
}
// Země místo hráčů: vlaječka, název, rozpis po modelích a celkový počet.
function zemeRadek(z) {
  var mod = ['mini', 'flex', 'max'].map(function (k) {
    return '<i class="' + (z[k] ? 'je' : 'nic') + '">' + k.toUpperCase() + ' ' + (z[k] || 0) + '</i>';
  }).join('');
  // Kdo v zemi vede: první tři firmy se znakem, nickem a počtem prádlomatů.
  // Ať je vidět nejen král, ale i s kým se dá o druhé místo poprat.
  var top = z.top && z.top.length ? z.top : (z.kral ? [z.kral] : []);
  var MEDAILE = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
  return '<div class="zeb-row zeme">'
    + '<i class="zeb-vlaj">' + (vlajka(z.kod) || esc(String(z.kod || '').toUpperCase())) + '</i>'
    + '<span class="nick">' + esc(zemeNazev(z.kod))
    + '<i class="zeme-mod">' + mod + '<b>' + hracuSlovy(z.hracu) + '</b></i>'
    + top.map(function (k, i) {
        return '<i class="zeme-kral">'
          + '<em class="zeme-por">' + (MEDAILE[i] || (i + 1) + '.') + '</em>'
          + (k.znak ? znakSvg(k.znak, 15) : '')
          + '<b>' + esc(k.firma) + '</b> <span>' + esc(k.nick) + '</span>'
          + ' \u00b7 ' + k.pocet + '\u00d7</i>';
      }).join('')
    + '</span>'
    + '<b>' + z.celkem + '×</b></div>';
}
// Ke kterému okamžiku žebříček platí. Server ho počítá po třicetivteřinových
// oknech přibitých na hodiny, takže všichni, kdo se zeptají ve stejném okně,
// vidí tatáž čísla. Bez téhle věty vypadaly dva telefony vedle sebe jako chyba.
function zebKdy() {
  if (!ZEB || !ZEB.aktualizovano) return '';
  var d = new Date(ZEB.aktualizovano);
  if (isNaN(d.getTime())) return '';
  var dv = function (n) { return (n < 10 ? '0' : '') + n; };
  return tx('veta.plati_k', { p1: tx('veta.prepocitava_se_po_pulminute_takze_kdo', { p1: dv(d.getHours()), p2: dv(d.getMinutes()), p3: dv(d.getSeconds()) }) });
}
function paintZeb() {
  var box = $('zeb-body');
  if (!ZEB) { box.innerHTML = '<p class="muted small">' + esc(tx('hra.nacitam_4')) + '</p>'; return loadZeb().then(paintZeb); }
  var list = ZEB[ZEB_KAT] || [], popis = ZEB_POPIS[ZEB_KAT];
  if (ZEB_KAT === 'zeme') {
    box.innerHTML = '<h3 style="margin:14px 0 2px">' + popis.nadpis + '</h3>'
      + '<p class="muted small" style="margin:0 0 10px">' + popis.pod + zebKdy() + '</p>'
      + (list.length
        ? '<div class="zeb">' + list.map(zemeRadek).join('') + '</div>'
        : '<div class="empty">' + (ZEB.chyba
            ? esc(tx('hra.zebricek_se_nepodarilo_nacist_zkus'))
            : esc(tx('hra.zatim_nikde_nic_nestoji'))) + '</div>')
      + (list.length ? '<p class="fine">' + esc(tx('hra.celkem_2')) + ' ' + list.reduce(function (a, z) { return a + z.celkem; }, 0)
          + tx('veta.pradlomatu_v', { p1: list.length }) + (list.length === 1 ? ' zemi.' : (list.length <= 4 ? ' ' + esc(tx('hra.zemich')) : ' ' + esc(tx('hra.zemich_2')))) + '</p>' : '');
    return;
  }
  var ja = ZEB.ja ? ZEB.ja[ZEB_KAT] : null;
  box.innerHTML = '<h3 style="margin:14px 0 2px">' + popis.nadpis + '</h3>'
    + '<p class="muted small" style="margin:0 0 10px">' + popis.pod + zebKdy() + '</p>'
    + (list.length
      ? '<div class="zeb">' + list.map(function (x) {
          return '<div class="zeb-row' + (x.ja ? ' ja' : '') + '"'
            + (x.id ? ' data-hrac="' + x.id + '"' : '') + '>'
            + '<i class="poradi' + (x.poradi <= 3 ? ' medaile m' + x.poradi : '') + '">' + x.poradi + '</i>'
            + (x.znak ? znakSvg(x.znak, 26) : '<i class="znak-mezera"></i>')
            + '<span class="nick">' + esc(x.firma || x.nick)
            // Pod firmou je hodnost místo nicku: v žebříčku je zajímavější,
            // jak velký ten soupeř je, než jak si říká. Hodnost počítá server.
            + '<i>' + esc(x.hodnost ? hodnostNazev(x.hodnost) || x.nick : x.nick) + '</i></span>'
            + vlajkyHtml(x.zeme)
            + '<b>' + popis.jed(x.hodnota) + '</b></div>';
        }).join('') + '</div>'
      : '<div class="empty">' + (ZEB.chyba ? esc(tx('hra.zebricek_se_nepodarilo_nacist_zkus_2')) : esc(tx('hra.tady_zatim_nikdo_neni_bud'))) + '</div>')
    + (ja && ja.poradi > list.length
      ? tx('veta.p_class_muted_small_style_margin_6', { p1: ja.poradi, p2: ja.z, p3: popis.jed(ja.hodnota) })
      : '')
    + (ZEB.hracu
        ? '<p class="fine">' + esc(tx('hra.hracu_ve_hre')) + ' ' + ZEB.hracu
          + (ZEB.se_siti != null ? tx('veta.s_postavenym_pradlomatem', { p1: ZEB.se_siti }) : '') + '</p>'
        : '');
  [].forEach.call(box.querySelectorAll('[data-hrac]'), function (el) {
    el.onclick = function () { strukturaSheet(Number(el.getAttribute('data-hrac'))); };
  });
}

// ─── Vlastnická struktura firmy ──────────────────────────────────────────────
// Kdo drží kus téhle firmy a kde má její majitel podíl jinde. Ceny a výplaty
// tu nejsou — to je věc těch, co se domluvili. Tohle je obchodní rejstřík.
function strukturaSheet(id) {
  sheet('<h3>' + esc(tx('hra.vlastnicka_struktura')) + '</h3><p class="muted small">' + esc(tx('hra.nacitam_5')) + '</p>');
  api('/trade/struktura/' + id).then(function (r) {
    if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_13')), 'err');
    var d = r.j;
    var radek = function (x) {
      return '<div class="area-item struk-r" data-struk="' + x.id + '">'
        + '<div style="display:flex;align-items:center;gap:10px;min-width:0">'
        + (x.znak ? znakSvg(x.znak, 26) : '<i class="znak-mezera"></i>')
        + '<div style="min-width:0"><div class="nm">' + esc(x.firma) + '</div>'
        + '<div class="sub">' + esc(x.nick)
        + (x.smluv > 1 ? ' · ' + x.smluv + ' ' + mn(x.smluv, 'smlouva', 'smlouvy', 'smluv') : '')
        + '</div></div></div>'
        + '<b>' + procentaPodilu(x.podil) + '</b></div>';
    };
    var odz = (d.hrac.odznaky || []);
    var mista = d.pradlomaty || [];
    sheet('<h3>' + esc(d.hrac.firma) + '</h3>'
      + '<p class="muted small">' + esc(d.hrac.nick)
      + (d.hrac.hodnost_nazev ? ' · <b>' + esc(d.hrac.hodnost_nazev) + '</b>' : '')
      + ' ' + esc(tx('hra.kdo_vlastni_kus_tehle_firmy')) + '</p>'
      // Odznaky jsou tady to nejcennější: než někomu půjčíš, chceš vědět,
      // jestli to je člověk, co půjčky vrací.
      + (odz.length
          ? '<div class="odz-rada">' + odz.map(function (o) {
              return '<span class="odz-chip" title="' + esc(o.popis) + '">' + o.ikona + ' '
                + esc(o.nazev) + '</span>'; }).join('') + '</div>'
          : '')
      + '<div class="kv souhrn"><span>' + esc(tx('hra.majitel_drzi')) + '</span><b class="' + (d.prodano > 0 ? '' : 'ok') + '">'
      + procentaPodilu(1 - d.prodano) + '</b></div>'
      + '<h3 style="margin-top:16px">' + esc(tx('hra.podilnici')) + '</h3>'
      + (d.podilnici.length
          ? d.podilnici.map(function (x) { return radek(x); }).join('')
          : '<p class="muted small">' + esc(tx('hra.firmu_nedrzi_nikdo_jiny_je')) + '</p>')
      + '<h3 style="margin-top:18px">' + esc(tx('hra.podily_v_cizich_firmach')) + '</h3>'
      + (d.drzi.length
          ? d.drzi.map(function (x) { return radek(x); }).join('')
          : '<p class="muted small">' + esc(tx('hra.v_zadne_cizi_firme_podil')) + '</p>')
      // Kde má provozovny. Klepnutí přiletí mapou — kde komu stojí prádlomat,
      // je stejně vidět, tohle k tomu jen ušetří hledání.
      + '<h3 style="margin-top:18px">' + esc(tx('mapa.pradlomaty'))
      + (mista.length ? ' <span class="muted small">(' + mista.length + ')</span>' : '') + '</h3>'
      + (mista.length
          ? mista.map(function (m, i) {
              var mo = MODELS[m.model];
              return '<div class="area-item struk-m" data-struk-misto="' + i + '">'
                + '<div style="min-width:0"><div class="nm">' + esc(jmenoStroje(m.name || tx('hra.pradlomat_5'))) + '</div>'
                + '<div class="sub">' + esc(mestoZKlice(m.area_key))
                + (mo ? ' · ' + esc(mo.name) : '') + '</div></div>'
                + (m.lat != null ? '<span class="muted small">' + esc(tx('mapa.ukazat_na_mape')) + '</span>' : '')
                + '</div>';
            }).join('')
          : '<p class="muted small">' + esc(tx('hra.zadny_pradlomat_zatim_nema')) + '</p>')
      + '<p class="fine" style="margin-top:12px">' + esc(tx('hra.klepnutim_na_firmu_se_podivas')) + '</p>'
      // Proklik na hráče: odsud se dá rovnou obchodovat, nebo si ho prohlédnout
      // na mapě celého.
      + (d.hrac.id !== (ME && ME.id)
          ? '<button class="btn big" id="struk-obchod" style="width:100%;margin-top:10px">'
            + esc(tx('hra.obchodovat_s_nim')) + '</button>'
          : '')
      + (mista.filter(function (m) { return m.lat != null; }).length
          ? '<button class="btn sec" id="struk-mapa" style="width:100%;margin-top:8px">'
            + esc(tx('hra.ukazat_ho_na_mape')) + '</button>'
          : ''));
    [].forEach.call($('sheet-body').querySelectorAll('[data-struk]'), function (el) {
      el.onclick = function () { strukturaSheet(Number(el.getAttribute('data-struk'))); };
    });
    [].forEach.call($('sheet-body').querySelectorAll('[data-struk-misto]'), function (el) {
      el.onclick = function () {
        var m = mista[Number(el.getAttribute('data-struk-misto'))];
        if (!m || !naMapu(m.lat, m.lon)) return toast(esc(tx('hra.tohle_misto_na_mape_nenajdu')), 'err');
      };
    });
    if ($('struk-obchod')) {
      $('struk-obchod').onclick = function () { majetekSheet(d.hrac.id); };
    }
    if ($('struk-mapa')) {
      $('struk-mapa').onclick = function () {
        var b = mista.filter(function (m) { return m.lat != null; });
        if (!b.length || !map) return;
        closeSheet();
        if (b.length === 1) return map.setView([b[0].lat, b[0].lon], Math.max(16, map.getZoom()));
        // Víc provozoven: mapa se nastaví tak, aby byly vidět všechny najednou.
        var hr = L.latLngBounds([]);
        b.forEach(function (m) { hr.extend([m.lat, m.lon]); });
        if (hr.isValid()) map.fitBounds(hr, { padding: [40, 40], maxZoom: 15 });
        else map.setView([b[0].lat, b[0].lon], 13);
      };
    }
  }).catch(function () { toast(esc(tx('hra.server_neodpovida_18')), 'err'); });
}
// Procenta podílu tak, aby se neztratila desetina u malých podílů.
function procentaPodilu(x) {
  var v = Math.round((Number(x) || 0) * 1000) / 10;
  return tCislo2(String(v)) + ' %';
}

// Pověst z infolinky — ať je vidět i mimo hovor, co to s návštěvností dělá.
function povestHtml() {
  var p = povest();
  var zmena = Math.round((povestKoef() - 1) * 100);
  return ekonomikaHtml()
    + udalostiHtml()
    + pojisteniHtml()
    + '<div class="card"><div class="row"><h3>' + esc(tx('hra.infolinka_3')) + '</h3>'
    + '<b class="' + (p > 0 ? 'ok' : (p < 0 ? 'err' : '')) + tx('veta.b_div_p_class_muted_small', { p1: hvezdyText(), p2: povestSlovy() }) + ((p + 100) / 2) + '%"></i></div>'
    + '<div class="kv"><span>' + esc(tx('hra.navstevnost_z_povesti')) + '</span><b class="'
    + (zmena > 0 ? 'ok' : (zmena < 0 ? 'err' : '')) + '">' + (zmena > 0 ? '+' : '') + tx('veta.b_div_p_class_fine_style', { p1: zmena, p2: esc(tx('hra.zakaznici_voli_jen_kdyz_jsi')), p3: esc(tx('hra.kdo_hovor_vezme_a_umi')) })
    // Pozastavená linka je třetí stav: zaplacená, ale hovory bere hráč.
    + (linkaStoji() ? tx('linka.stoji_zbyva', { p1: etaText(linkaZbyva()) })
        : maLinku() ? tx('hra.infolinku_mas_zaplacenou_jeste_takze_hovory', { p1: etaText(linkaZbyva()) })
          : esc(tx('hra.zaplacena_infolinka_je_vezme_za'))) + '</p></div>';
}
// Pojištění provozoven. Požár ani vytopení technik nespraví — oprava stojí
// desetitisíce a stroj do té doby nevydělává. Pojistné běží měsíčně za každý
// postavený prádlomat a sráží opravu na pětinu.
function pojisteniHtml() {
  var zap = !!(S && S.pojisteni);
  var mes = (S.units || []).reduce(function (a, u) {
    return a + machinePrice(MODELS[(u.eco && u.eco.model) || 'mini']) * POJISTNE_PODIL;
  }, 0);
  return '<div class="card"><div class="row"><h3>' + esc(tx('hra.pojisteni_provozoven')) + '</h3>'
    + '<button class="prep-sam' + (zap ? ' on' : '') + '" id="do-pojisteni">'
    + (zap ? esc(tx('hra.sjednane')) : esc(tx('hra.nemas'))) + tx('veta.button_div_p_class_muted_small', { p1: Math.round(POJISTENI_SPOLUUCAST * 100), p2: esc(tx('hra.pojistne_za_celou_sit')) }) + (zap ? ' class="warn"' : '') + '>'
    + kcFull(Math.round(mes)) + ' ' + esc(tx('hra.mesic_30')) + '</b></div>'
    + '<p class="fine">' + (zap
        ? esc(tx('hra.pojistne_se_strhava_kazdy_herni'))
        : esc(tx('hra.kdyz_ho_sjednas_plati_se'))) + '</p></div>';
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
  if (!S.sidlo) return '<div class="card"><h3>' + esc(tx('hra.sidlo_firmy')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 0">' + esc(tx('hra.vznikne_tam_kde_postavis_prvni')) + ' '
    + esc(tx('hra.od_sidla_se_pak_pocita')) + '</p></div>';
  return '<div class="card"><h3>' + tx('veta.h3_p_class_muted_small_style_3', { p1: esc(tx('hra.sidlo_a_pobocky')), p2: kcFull(POBOCKA_CENA), p3: kcFull(POBOCKA_MESICNE), p4: esc(tx('hra.sidlo')), p5: esc(S.sidlo.name || esc(tx('hra.nezname'))) })
    + (sidloLze()
        ? tx('hra.button_class_btn_sec_sm_id_2', { p1: kcFull(SIDLO_STEHOVANI) })
        : tx('hra.p_class_fine_sidlo_pujde_prestehovat', { p1: etaText(sidloOd() - Date.now()), p2: kcFull(SIDLO_STEHOVANI) }))
    // Pozor na esc(): křížek a jeho title jsou kus HTML, ne text. Když se
    // prohnaly přes esc(), uvozovka v atributu se změnila na &quot;, značka
    // <button> se nezavřela a spolkla zbytek řádku — pobočky se pak slily do
    // jednoho odstavce a křížek zmizel. Stavba patří do kódu, z katalogu jde
    // jen popisek.
    + (S.pobocky || []).map(function (b, i) {
        return '<div class="kv"><span>' + esc(tx('hra.pobocka')) + '</span><b>'
          + esc(b.name || tx('hra.pobocka_2'))
          + ' <button class="pob-zrus" data-pob-zrus="' + i + '" title="'
          + esc(tx('hra.zrusit_pobocku')) + '">\u00d7</button></b></div>';
      }).join('')
    + (pobockyMesicne() > 0 ? '<div class="kv"><span>' + esc(tx('hra.provoz_pobocek')) + '</span><b class="warn">'
      + kcFull(pobockyMesicne()) + ' ' + esc(tx('hra.mesic_17')) + '</b></div>' : '')
    + (zaMorem().length
        ? tx('hra.p_class_fine_warn_style_margin', { p1: zaMoremSlovy(zaMorem().length) }) + esc(zaMorem().map(function (u) { return u.name; }).slice(0, 3).join(', '))
          + tx('hra.servis_tam_musi_trajektem_nebo_letadlem')
        : '')
    + tx('veta.button_class_btn_sec_id_do', { p1: kcFull(POBOCKA_CENA) })
    + ((S.pobocky || []).length
        ? tx('hra.p_class_fine_zrusena_pobocka_vrati', { p1: kcFull(Math.round(POBOCKA_CENA * POBOCKA_VRATKA)), p2: esc(tx('hra.vybaveni_a_sklad_se_rozprodaji')) }) : '')
    + '</div>';
}
// Vlastní stavební četa — karta v Síti.
function cetaHtml() {
  if (!S.sidlo) return '';
  if (!maCetu()) {
    return '<div class="card"><h3>' + tx('veta.h3_p_class_muted_small_style_4', { p1: esc(tx('hra.vlastni_stavebni_ceta')), p2: Math.round(CETA_PODIL * 100), p3: CETA_MIST, p4: esc(tx('hra.vyplati_se_od_dvou_mist')), p5: kcFull(CETA_CENA), p6: esc(tx('hra.mzdy_dvou_lidi')), p7: kcFull(CETA_MZDY), p8: esc(tx('hra.mesic_23')), p9: esc(tx('hra.poridit_cetu')) });
  }
  var zbyva = cetaZbyva();
  return '<div class="card"><h3>' + esc(tx('hra.vlastni_stavebni_ceta_2')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('hra.volna_kapacita_tenhle_mesic')) + '</span><b class="' + (zbyva ? 'ok' : 'warn') + tx('veta.z_mist_b_div_div_class', { p1: zbyva, p2: CETA_MIST, p3: kcFull(CETA_MZDY), p4: esc(tx('hra.mesic_24')) })
    + (maShanece() ? '<div class="kv"><span>' + esc(tx('hra.shanec_mist')) + '</span><b class="warn">' + kcFull(SHANEC_MZDA) + ' ' + esc(tx('hra.mesic_25')) + '</b></div>' : '')
    + ((S.ceta.phm || 0) > 0 ? '<div class="kv"><span>' + esc(tx('hra.phm_tenhle_mesic')) + '</span><b class="warn">' + kcFull(S.ceta.phm) + '</b></div>' : '')
    + tx('veta.p_class_fine_pripojky_na_panenskem', { p1: Math.round(CETA_PODIL * 100), p2: Math.round(INSTALACE_PODIL * 100) })
    + (maShanece()
        ? '<button class="btn sec" id="do-shanec" style="width:100%;margin-top:8px">' + esc(tx('hra.propustit_shanece')) + '</button>'
        : tx('hra.button_class_btn_sec_id_do', { p1: kcFull(SHANEC_MZDA), p2: esc(tx('hra.mesic_26')) }))
    + '</div>';
}
function cetaSheet() {
  var f = canFinance(CETA_CENA, FIN_OWN);
  sheet(tx('veta.h3_h3_p_class_muted_small_18', { p1: esc(tx('hra.poridit_stavebni_cetu')) })
    + CETA_TECHNIKA.map(function (t) {
        return '<div class="kv"><span>' + esc(t.nazev) + '</span><b>' + kcFull(t.cena) + '</b></div>';
      }).join('')
    + tx('veta.div_class_kv_souhrn_span_span', { p1: financeRows(f), p2: esc(tx('hra.mzdy_dvou_lidi_2')), p3: kcFull(CETA_MZDY), p4: esc(tx('hra.mesic_31')) }) + (f.ok ? '' : ' disabled') + '>' + esc(tx('hra.poridit')) + '</button>'
    + (f.ok ? '' : '<p class="fine err">' + esc(f.duvod || '') + '</p>'));
  bindFinance(function () { cetaSheet(); });
  var b = $('do-ceta-ano');
  if (b) b.onclick = function () {
    var g = canFinance(CETA_CENA, FIN_OWN);
    if (!g.ok) return;
    doFinance(g, { druh: 'technika', popis: esc(tx('hra.stavebni_technika')) });
    S.ceta = { od: Date.now(), shanec: false, mesic: Math.floor(Date.now() / MONTH_MS), hotovo: 0, phm: 0 };
    save(); paint(); closeSheet(); syncState(true);
    toast(esc(tx('hra.ceta_je_tvoje_pripojky_ted')), 'ok');
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
  sheet(tx('veta.h3_h3_p_class_muted_small_14', { p1: esc(tx('hra.zridit_pobocku')), p2: kcFull(POBOCKA_CENA), p3: kcFull(POBOCKA_MESICNE) })
    + (S.cash < POBOCKA_CENA ? tx('hra.p_class_fine_err_na_pobocku', { p1: kcFull(POBOCKA_CENA - S.cash) }) : '')
    + (mesta.length
      ? '<div class="zeb">' + mesta.map(function (m) {
          return '<div class="zeb-row"><span class="nick">' + esc(m.name)
            + '<i>' + (m.uz ? esc(tx('hra.tady_uz_zakladnu_mas')) : esc(tx('hra.prozkoumane_mesto'))) + '</i></span>'
            + (m.uz || S.cash < POBOCKA_CENA ? '' : '<button class="btn sm" data-pob="' + esc(m.id) + '">' + esc(tx('hra.zridit')) + '</button>')
            + '</div>';
        }).join('') + '</div>'
      : '<div class="empty">' + esc(tx('hra.nemas_prozkoumane_zadne_mesto')) + '</div>'));
  [].forEach.call(document.querySelectorAll('[data-pob]'), function (b) {
    b.onclick = function () {
      var m = mesta.filter(function (x) { return x.id === b.getAttribute('data-pob'); })[0];
      if (!m || S.cash < POBOCKA_CENA) return;
      S.cash -= POBOCKA_CENA;
      zapis('nakup', tx('veta.pobocka', { p1: m.name }), -POBOCKA_CENA);
      S.pobocky.push({ name: m.name, lat: m.lat, lon: m.lon, od: Date.now() });
      save(); paint(); closeSheet(); syncState(true);
      toast(tx('veta.pobocka_v_otevrena', { p1: m.name }), 'ok');
    };
  });
}
function paintNet() {
  // Dlaždice se čtou shora dolů jako výpis: co síť vydělá, co z toho odteče,
  // a co zbyde. Aby to sedělo, musí každé číslo vycházet ze stejného základu.
  var zbyde = cistyZisk();
  var odtece = splatkyMesicne() + pobockyMesicne() + cetaMesicne() + pojisteniMesicne();
  $('net-sum').innerHTML = '<div><span>' + esc(tx('hra.pradlomaty_3')) + '</span><b>' + S.units.length + '</b></div>'
    // Dokud se nemá co odečítat, je zisk prádlomatů zároveň tím, co zbyde —
    // dvě stejná čísla vedle sebe by jen pletla.
    + (odtece > 0
        ? '<div><span>' + esc(tx('hra.zisk_pred_splatkou_2')) + '</span><b class="' + (monthlyProfit() < 0 ? 'err' : 'ok') + '">' + kc(monthlyProfit()) + '</b></div>'
        : '<div><span>' + esc(tx('hra.zisk_mesic_2')) + '</span><b class="' + (zbyde < 0 ? 'err' : 'ok') + '">' + kc(zbyde) + '</b></div>')
    + (splatkyMesicne() > 0
        ? '<div><span>' + esc(tx('hra.splatky_bance')) + '</span><b class="warn">' + kc(-splatkyMesicne()) + '</b></div>' : '')
    + (pobockyMesicne() > 0
        ? '<div><span>' + esc(tx('hra.provoz_pobocek_2')) + '</span><b class="warn">' + kc(-pobockyMesicne()) + '</b></div>' : '')
    + (cetaMesicne() > 0
        ? '<div><span>' + esc(tx('hra.vlastni_ceta')) + '</span><b class="warn">' + kc(-cetaMesicne()) + '</b></div>' : '')
    + (pojisteniMesicne() > 0
        ? '<div><span>' + esc(tx('hra.pojisteni')) + '</span><b class="warn">' + kc(-pojisteniMesicne()) + '</b></div>' : '')
    + (odtece > 0
        ? '<div><span>' + esc(tx('hra.zbyde_mesicne')) + '</span><b class="' + (zbyde >= 0 ? 'ok' : 'err') + '">' + kc(zbyde) + '</b></div>' : '')
    + '<div><span>' + esc(tx('hra.investovano')) + '</span><b>' + kc(investedTotal()) + '</b></div>'
    + '<div><span>' + esc(tx('hra.vydelano_celkem')) + '</span><b>' + kc(S.stats.earned) + '</b></div>';
  var note = $('net-note');
  if (note) {
    note.textContent = splatkyMesicne() > 0
      ? tx('veta.ze_splatky_je_urok_ten_je', { p1: kcFull(splatkyMesicne()), p2: kcFull(urokMesicne()), p3: kcFull(Math.max(0, splatkyMesicne() - urokMesicne())) }): esc(tx('hra.nikomu_nic_nesplacis_takze_ti'));
  }
  // Odkaz na grafy — čísla nahoře jsou dnešní stav, tohle je cesta k němu.
  var vyv = $('net-do-vyvoje');
  if (vyv) vyv.onclick = function () { netZalozka('vyvoj'); };
  if (!S.units.length) {
    $('net-list').innerHTML = povestHtml() + zakladnyHtml() + cetaHtml()
      + '<div class="empty">' + esc(tx('hra.zatim_nemas_ani_jeden_pradlomat')) + '<br>' + esc(tx('hra.zacni_tim_ze_na_mape')) + '</div>';
    bindZakladny();
    return;
  }
  $('net-list').innerHTML = povestHtml() + zakladnyHtml() + cetaHtml() + S.units.slice().sort(function (a, b) { return b.eco.profit - a.eco.profit; }).map(function (u) {
    return '<div class="card" data-unit="' + esc(u.spotId) + '">'
      + '<div class="row"><h3>' + esc(jmenoStroje(u.name)) + '</h3>' + verdictPill(u.score) + '</div>'
      + '<p class="muted small" style="margin:2px 0 6px">' + esc(KIND_LABEL[u.kind] || esc(tx('hra.misto_2'))) + ' · ' + MODELS[u.eco.model].name + '</p>'
      + (function () {
        var l = uverMista(u);
        if (!l) return '<div class="row"><span class="muted small">' + esc(tx('hra.zisk_mesic_3')) + '</span><b class="ok">' + kcFull(u.eco.profit) + '</b></div></div>';
        // Místo na dluh: číslo před splátkou je jen mezikrok, rozhoduje to pod ním.
        var splatka = splatkaMista(u);
        var cisty = zbydeZMista(u);
        return '<div class="row"><span class="muted small">' + esc(tx('hra.zisk_pred_splatkou_3')) + '</span><b>' + kcFull(u.eco.profit) + '</b></div>'
          + '<div class="row"><span class="muted small">' + esc(tx('hra.splatka_uveru')) + '</span><b class="warn">' + kcFull(Math.round(splatka)) + '</b></div>'
          + '<div class="row"><span class="muted small">' + esc(tx('hra.zbyde_z_mista')) + '</span><b class="' + (cisty >= 0 ? 'ok' : 'err') + '">'
          + kcFull(Math.round(cisty)) + '</b></div></div>';
      })();
  }).join('');
  [].forEach.call($('net-list').querySelectorAll('[data-unit]'), function (c) {
    c.onclick = function () { unitSheet(S.units.filter(function (u) { return u.spotId === c.getAttribute('data-unit'); })[0]); };
  });
  bindZakladny();
}
// Zrušení pobočky. Vrací se polovina ceny — zbytek je utopený ve vybavení.
function zrusPobockuSheet(i) {
  var b = (S.pobocky || [])[i];
  if (!b) return;
  var vratka = Math.round(POBOCKA_CENA * POBOCKA_VRATKA);
  sheet(tx('veta.h3_zrusit_pobocku_h3_p_class', { p1: esc(b.name || ''), p2: esc(tx('hra.vrati_se_ti')), p3: kcFull(vratka), p4: esc(tx('hra.usetris_mesicne')), p5: kcFull(POBOCKA_MESICNE), p6: esc(tx('hra.zrusit_pobocku')), p7: esc(tx('hra.nechat_byt_4')) }));
  if ($('do-zrus-ne')) $('do-zrus-ne').onclick = closeSheet;
  if ($('do-zrus-ano')) $('do-zrus-ano').onclick = function () {
    S.pobocky.splice(i, 1);
    S.cash += vratka;
    zapis('prijem', tx('veta.zrusena_pobocka', { p1: (b.name || '') }), vratka);
    save(); paint(); drawMap(); closeSheet(); syncState(true);
    toast(tx('veta.pobocka_6', { p1: (b.name || '') }) + tx('veta.zrusena_vratilo_se', { p1: kcFull(vratka) }), 'ok');
  };
}
// Přestěhování sídla. Sídlo je adresa firmy, takže to stojí a jde jen jednou
// za tři herní roky — jinak by si ho hráč vozil za každou vlnou stavby.
function sidloSheet() {
  var mesta = Object.keys(S.areas || {}).map(function (id) {
    var a = S.areas[id], str = stredOblasti(a);
    if (!str) return null;
    var tady = S.sidlo && kmMezi(S.sidlo, str) < 8;
    return { id: id, name: a.name || id, lat: str.lat, lon: str.lon, tady: tady };
  }).filter(Boolean);
  var malo = S.cash < SIDLO_STEHOVANI;
  sheet(tx('sidlo.okno', { p1: kcFull(SIDLO_STEHOVANI) })
    + (malo ? tx('sidlo.nemas', { p1: kcFull(SIDLO_STEHOVANI - S.cash) }) : '')
    + (mesta.length
        ? '<div class="zeb">' + mesta.map(function (m) {
            return '<div class="zeb-row"><span class="nick">' + esc(m.name)
              + '<i>' + (m.tady ? esc(tx('sidlo.tady_sidlo_mas')) : esc(tx('sidlo.prozkoumane_mesto'))) + '</i></span>'
              + (m.tady || malo ? '' : '<button class="btn sm" data-sidlo="' + esc(m.id) + '">' + esc(tx('sidlo.sem')) + '</button>')
              + '</div>';
          }).join('') + '</div>'
        : '<div class="empty">' + esc(tx('sidlo.zadne_mesto')) + '</div>'));
  [].forEach.call(document.querySelectorAll('[data-sidlo]'), function (b) {
    b.onclick = function () {
      var m = mesta.filter(function (x) { return x.id === b.getAttribute('data-sidlo'); })[0];
      if (!m || S.cash < SIDLO_STEHOVANI || !sidloLze()) return;
      S.cash -= SIDLO_STEHOVANI;
      zapis('nakup', tx('sidlo.zapis', { p1: m.name }), -SIDLO_STEHOVANI);
      S.sidlo = { name: m.name, lat: m.lat, lon: m.lon, od: Date.now() };
      save(); paint(); drawMap(); closeSheet(); syncState(true);
      toast(tx('sidlo.hotovo', { p1: m.name }), 'ok');
    };
  });
}
function bindZakladny() {
  var sd = $('do-sidlo');
  if (sd) sd.onclick = sidloSheet;
  [].forEach.call(document.querySelectorAll('[data-pob-zrus]'), function (b) {
    b.onclick = function (e) { e.stopPropagation(); zrusPobockuSheet(Number(b.getAttribute('data-pob-zrus'))); };
  });
  var pj = $('do-pojisteni');
  if (pj) pj.onclick = function () {
    S.pojisteni = !S.pojisteni;
    save(); paint(); syncState(true); paintNet();
    toast(S.pojisteni
      ? tx('veta.provozovny_jsou_pojistene_pojistne_mesicne', { p1: kcFull(pojisteniMesicne()) }): esc(tx('hra.pojisteni_zruseno_skody_si_ted')), 'ok');
  };
  var b = $('do-pobocka');
  if (b) b.onclick = function () { pobockaSheet(); };
  var c = $('do-ceta');
  if (c) c.onclick = function () { FIN_OWN = null; cetaSheet(); };
  var sh = $('do-shanec');
  if (sh) sh.onclick = function () {
    S.ceta.shanec = !S.ceta.shanec;
    save(); paint(); syncState(true);
    toast(S.ceta.shanec ? esc(tx('hra.shanec_nastoupil_mista_bude_hledat')) : esc(tx('hra.shanec_skoncil')), 'ok');
  };
}
// Přehled jednotlivých úvěrů — co je na co, za kolik a kolik ještě zbývá.
// Rámcový úvěr v bance: cesta k němu, stav a čerpání.
function ramecHtml() {
  if (maRamec()) {
    var volny = ramecVolny();
    return '<div class="card"><h3>' + esc(tx('banka.ramcovy_uver')) + '</h3>'
      + '<div class="kv"><span>' + esc(tx('banka.schvaleny_limit')) + '</span><b>' + kcFull(S.ramec.limit) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('banka.vycerpano')) + '</span><b>' + kcFull(ramecCerpano()) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('banka.k_cerpani')) + '</span><b class="' + (volny > 0 ? 'ok' : 'warn') + '">' + kcFull(volny) + '</b></div>'
      + (S.ramec.slabyOd
          ? tx('veta.p_class_fine_err_cerpani_je', { p1: slabaMista().length, p2: tx('veta.na_svou_splatku_banka_da_ramci', { p1: mn(slabaMista().length, esc(tx('banka.misto_nevydela')), esc(tx('banka.mista_nevydelaji')), esc(tx('banka.mist_nevydela'))), p2: etaText(S.ramec.slabyOd + RAMEC_LHUTA - Date.now()) }) })
          : tx('veta.p_class_fine_cerpat_muzes_bez'))
      + ramecRozborHtml()
      + (volny >= 1000 ? '<button class="btn sec big" id="do-cerpat">' + esc(tx('banka.cerpat_z_ramce')) + '</button>' : '')
      + '<button class="btn sec" id="do-prehodnotit" style="width:100%;margin-top:8px">' + esc(tx('banka.pozadat_o_navyseni')) + '</button>'
      + '</div>';
  }
  if (S.ramec && S.ramec.zavreny) {
    return '<div class="card"><h3>' + esc(tx('banka.ramcovy_uver_2')) + '</h3>'
      + '<p class="muted small" style="margin:2px 0 0">' + esc(tx('hra.banka_ti_ramec_zavrela_protoze')) + ' '
      + esc(tx('hra.co_je_nacerpane_splacis_dal')) + '</p></div>';
  }
  var doplaceno = doplacenychMist();
  return '<div class="card"><h3>' + tx('veta.h3_p_class_muted_small_style_6', { p1: esc(tx('banka.ramcovy_uver_3')), p2: esc(tx('banka.plne_doplacenych_pradlomatu')) }) + (doplaceno >= 2 ? 'ok' : '') + '">'
    + doplaceno + ' ze 2</b></div>'
    + (maSkraloup() ? '<p class="fine err">' + esc(tx('banka.po_konkurzu_ti_banka_herni')) + '</p>' : '')
    + (ramecLze()
        ? '<p class="fine">' + esc(tx('banka.mas_na_nej_narok_ceka')) + '</p>'
          + '<button class="btn sec big" id="do-ramec">' + esc(tx('banka.pozadat_o_ramec')) + '</button>'
        : '<p class="fine">' + esc(tx('banka.splat_nejdriv_dva_pradlomaty_do')) + '</p>')
    + '</div>';
}
// Z čeho limit vychází a co s ním pohne — bez toho hráč jen kouká na číslo.
function ramecRozborHtml() {
  var sl = ramecSlozky();
  var drziHru = sl.zisk < sl.historie ? 'zisk' : 'historie';
  var drzi = sl.strop !== null && sl.strop < Math.min(sl.zisk, sl.historie) ? 'strop' : drziHru;
  return tx('veta.div_class_kv_style_margin_top', { p1: doplacenychMist(), p2: (drzi === 'historie' ? 'warn' : ''), p3: kcFull(sl.historie), p4: esc(tx('hra.co_unese_vydelek_site')), p5: (drzi === 'zisk' ? 'warn' : ''), p6: kcFull(sl.zisk), p7: esc(tx('hra.strop_balicku')), p8: (drzi === 'strop' ? 'warn' : 'ok'), p9: (sl.strop === null ? 'bez stropu' : kcFull(sl.strop)), p10: esc(tx('hra.plati_ten_nejmensi_z_nich')), p11: (drzi === 'strop'
        ? esc(tx('hra.limit_ted_drzi_strop_tveho'))
        : drzi === 'zisk'
          ? esc(tx('hra.limit_ted_drzi_vydelek_zvedne'))
          : tx('hra.limit_ted_drzi_historie_kazdy_dalsi', { p1: kcFull(RAMEC_ZA_MISTO) })), p12: tx('veta.banka_ho_sama_srovna_jednou_za', { p1: esc(tx('hra.dolu_jde_po_ctvrtinach_a')) }) });
}
function ramecSheet() {
  pohovorSheet(10, esc(tx('hra.pohovor_o_ramci')), function (st) {
    if (!st.ok) { toast(esc(tx('hra.rizikor_to_zamitl_zkus_to')), 'err'); return; }
    var limit = Math.round(ramecNavrh() * st.limit / 10000) * 10000;
    if (limit < 10000) { toast(esc(tx('hra.na_ramec_zatim_nevydelavas_dost')), 'err'); return; }
    sheet(tx('veta.h3_h3_div_class_kv_span', { p1: esc(tx('hra.ramec_schvalen')), p2: kcFull(limit), p3: esc(tx('hra.hodnoceni_pohovoru')), p4: esc(st.nazev) }));
    $('ram-ok').onclick = function () {
      S.ramec = { limit: limit, cerpano: 0, od: Date.now(), slabyOd: null, zavreny: null,
        bonus: st.sazba, puvodniCil: ramecNavrh() || limit, prehodnoceno: Date.now() };
      save(); paint(); closeSheet(); syncState(true);
      toast(tx('veta.ramec_je_schvaleny', { p1: kcFull(limit) }), 'ok');
    };
  });
}
function cerpatSheet(chci) {
  var volny = ramecVolny();
  if (volny < 1000) { closeSheet(); return toast(esc(tx('hra.z_ramce_ted_cerpat_nemuzes')), 'err'); }
  var castka = Math.max(1000, Math.min(volny, Math.round((chci == null ? volny : chci) / 1000) * 1000));
  var prirazka = prirazkaZa(castka) + (S.ramec.bonus || 0);
  var sazba = Math.max(0.02, rateOf() + prirazka);
  var splatka = anuita(castka, sazba, UVER_MESICU);
  sheet('<h3>' + esc(tx('hra.cerpani_z_ramce')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('hra.k_dispozici_4')) + '</span><b>' + kcFull(volny) + '</b></div>'
    + '<label class="fld"><span>' + esc(tx('hra.kolik_si_vezmes')) + '</span>'
    + '<input id="cer-amt" class="inp" type="number" min="1000" step="1000" max="' + volny + '" value="' + castka + '"></label>'
    + '<div class="kv"><span>' + esc(tx('hra.urok_3')) + '</span><b>' + (sazba * 100).toFixed(1).replace('.', desZnak()) + tx('veta.rocne_b_div_div_class_kv_2', { p1: esc(tx('hra.splatka_3')), p2: kcFull(splatka), p3: esc(tx('hra.mesic_po_5_let')), p4: esc(tx('hra.cerpat')), p5: esc(tx('hra.zpatky')) }));
  var inp = $('cer-amt');
  if (inp) inp.onchange = function () { cerpatSheet(Number(inp.value) || 0); };
  $('cer-ne').onclick = closeSheet;
  $('cer-ano').onclick = function () {
    var c = Math.max(1000, Math.min(ramecVolny(), Math.round((Number(inp.value) || 0) / 1000) * 1000));
    // Krátký pohovor — tři otázky, ať to po desáté neotravuje.
    pohovorSheet(3, esc(tx('hra.kratka_kontrola')), function (st) {
      if (!st.ok) { toast(esc(tx('hra.rizikor_cerpani_zastavil_zkus_to')), 'err'); return; }
      S.cash += c;
      zapis('uver', esc(tx('hra.cerpani_z_ramce_2')), c);
      pricistDluh(c, prirazkaZa(c) + (S.ramec.bonus || 0), { druh: 'ramec', popis: esc(tx('hra.cerpani_z_ramce_3')) });
      save(); paint(); syncState(true);
      toast(tx('veta.nacerpano', { p1: kcFull(c) }), 'ok');
    });
  };
}
function uveryHtml() {
  var l = (S.loans || []).slice().sort(function (a, b) { return b.zbyva - a.zbyva; });
  if (!l.length) return '';
  return '<div class="card"><h3>' + esc(tx('banka.tvoje_uvery')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">' + esc(tx('hra.kazdy_ma_svoji_sazbu_a')) + ' '
    + esc(tx('hra.kterykoli_muzes_kdykoli_predcasne_splatit')) + '</p>'
    + l.map(function (u) {
        var urok = Math.round(u.zbyva * u.sazba / 12);
        var splatka = Math.min(u.splatka, u.zbyva + urok);
        return '<div class="uver' + (u.zmeskano ? ' dluzi' : '') + '">'
          + '<div class="uver-hl"><b>' + esc(u.popis || esc(tx('banka.uver_2'))) + '</b>'
          + '<span>' + (u.sazba * 100).toFixed(1).replace('.', desZnak()) + tx('veta.span_div_div_class_kv_span', { p1: esc(tx('banka.zbyva_splatit')), p2: kcFull(u.zbyva), p3: esc(tx('banka.splatka_mesic_2')), p4: kcFull(splatka), p5: kcFull(urok), p6: esc(tx('banka.zbyva_mesicu')) }) + (u.zbyvaMesicu || 0) + ' z ' + (u.mesicu || 60) + '</b></div>'
          + ((u.prepsano || u.prodlouzeno) ? tx('veta.p_class_fine_delku_splaceni_uz', { p1: ((u.prepsano || u.prodlouzeno) > 1 ? ' (' + (u.prepsano || u.prodlouzeno) + '×)' : '') }) : '')
          + (u.zmeskano ? tx('hra.p_class_fine_err_ze_kdyz', { p1: esc(tx('hra.nezaplacena_splatka')), p2: u.zmeskano, p3: KRACH_SPLATEK })
              + (u.zmeskano >= KRACH_SPLATEK - 1
                  ? esc(tx('banka.jeste_jedna_a_banka_posle')) + ' '
                  : esc(tx('banka.pri_treti_jde_firma_do')) + ' ')
              + esc(tx('hra.jakmile_jednu_splatku_zaplatis_celou')) + '</p>' : '')
          + '<div class="uver-akce">'
          + '<button class="btn sec sm" data-splatit="' + esc(u.id) + '"' + (S.cash < 1 ? ' disabled' : '') + '>Splatit tenhle</button>'
          + '<button class="btn sec sm" data-prodlouzit="' + esc(u.id) + '">' + esc(tx('banka.zmenit_splatnost')) + '</button>'
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
  if (max < 1) return toast(esc(tx('hra.na_mimoradnou_splatku_ted_nemas')), 'err');
  sheet(tx('veta.h3_splatit_h3_p_class_muted', { p1: esc(l.popis || esc(tx('hra.uver_2'))), p2: esc(tx('hra.splatka_zustane_stejne_vysoka_a')), p3: esc(tx('hra.zbyva_splatit')), p4: kcFull(l.zbyva) }) + (l.sazba * 100).toFixed(1).replace('.', desZnak()) + tx('veta.mesicne_span_b_class_warn_b', { p1: kcFull(Math.round(l.zbyva * l.sazba / 12)), p2: esc(tx('hra.mas_v_hotovosti')), p3: kcFull(S.cash), p4: kcFull(max), p5: max, p6: max }));
  var i = $('sp-amt'), note = $('sp-note');
  var prepis = function () {
    var v = Math.max(0, Math.min(max, Math.round(Number(i.value) || 0)));
    note.textContent = v >= Math.round(l.zbyva)
      ? tx('veta.timhle_uver_uplne_zmizi_usetris_na', { p1: kcFull(Math.round(l.zbyva * l.sazba / 12)) }): tx('veta.po_splatce_zustane_urok_klesne_na', { p1: kcFull(Math.round(l.zbyva) - v), p2: kcFull(Math.round((l.zbyva - v) * l.sazba / 12)) });
  };
  i.oninput = prepis; prepis();
  $('sp-go').onclick = function () {
    var dal = splatitUver(id, Number(i.value) || 0);
    if (!dal) return toast(esc(tx('hra.zadej_castku_kterou_mas')), 'err');
    save(); paint(); paintBank(); closeSheet(); syncState(true);
    toast(tx('veta.splaceno_2', { p1: kcFull(dal) }), 'ok');
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
    sheet('<h3>' + esc(tx('hra.zmenit_delku_splaceni')) + '</h3>'
      + '<div class="nalada ' + nalada.id + '"><b>' + nalada.nazev + '</b><span>' + esc(nalada.slovo) + '</span></div>'
      + '<p class="muted small">' + esc(tx('hra.tenhle_uver_uz_neni_kam')) + '</p>'
      + '<button class="btn sec big" id="pr-zavrit">' + esc(tx('hra.rozumim')) + '</button>');
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
  sheet(tx('veta.h3_h3_p_class_muted_small_5', { p1: esc(tx('hra.zmenit_delku_splaceni_2')), p2: esc(l.popis || esc(tx('hra.uver'))), p3: kcFull(l.zbyva) }) + SPLATNOSTI[ted].nazev + '</p>'
    + '<div class="nalada ' + nalada.id + '"><b>' + nalada.nazev + '</b><span>' + esc(nalada.slovo) + '</span></div>'
    + '<label class="fld"><span>' + esc(tx('hra.na_jak_dlouho_kratka_stoji')) + '</span></label>'
    + '<div class="splat">'
    + SPLATNOSTI.map(function (x, k) {
        if (k === ted) return '<button class="splat-b ted" disabled><b>' + x.nazev + '</b><span>' + esc(tx('hra.ted')) + '</span></button>';
        var moznost = lze.indexOf(k) >= 0;
        if (!moznost) return '<button class="splat-b zamceno" disabled><b>' + x.nazev + '</b><span>' + esc(tx('hra.zamceno_2')) + '</span></button>';
        var m = zmenaNavrh(l, k);
        return '<button class="splat-b' + (k === i ? ' on' : '') + '" data-pr-sp="' + k + '">'
          + '<b>' + x.nazev + '</b><span>' + kcFull(m.splatka) + ' ' + esc(tx('hra.mes_4')) + '</span></button>';
      }).join('')
    + '</div>'
    + (strop < SPLATNOSTI.length - 1 ? '<p class="fine">' + esc(tx('hra.zkratit_muzes_vzdycky_na_delsi')) + ' '
        + esc(splatnostDuvod(strop + 1)) + '</p>' : '')
    + '<div class="kv"><span>' + esc(tx('hra.splatka_ted')) + '</span><b>' + kcFull(splatkaTed) + ' ' + esc(tx('hra.mesic_8')) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.splatka_po_prepsani')) + '</span><b class="' + (n.rozdilSplatky <= 0 ? 'ok' : 'warn') + '">'
    + kcFull(n.splatka) + ' ' + esc(tx('hra.mesic_9')) + '</b></div>'
    + '<div class="kv souhrn"><span>' + (n.rozdilSplatky <= 0 ? esc(tx('hra.usetris_kazdy_mesic')) : esc(tx('hra.zaplatis_kazdy_mesic_navic'))) + '</span>'
    + '<b class="' + (n.rozdilSplatky <= 0 ? 'ok' : 'warn') + '">' + kcFull(Math.abs(n.rozdilSplatky)) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.urok_2')) + '</span><b>' + (l.sazba * 100).toFixed(1).replace('.', desZnak()) + ' % → '
    + (n.sazba * 100).toFixed(1).replace('.', desZnak()) + tx('veta.rocne_b_div_div_class_kv') + (n.rozdilUroku <= 0 ? esc(tx('hra.na_urocich_usetris_celkem')) : esc(tx('hra.na_urocich_zaplatis_navic'))) + '</span>'
    + '<b class="' + (n.rozdilUroku <= 0 ? 'ok' : 'warn') + tx('veta.b_div_div_class_kv_span_2', { p1: kcFull(Math.abs(n.rozdilUroku)) }) + (PRODLOUZENI_POPLATEK * 100).toFixed(1).replace('.', desZnak()) + ' %)</span><b class="warn">'
    + kcFull(n.poplatek) + '</b></div>'
    + '<p class="fine' + (zbydePak < 0 ? ' err' : '') + '">' + (n.delsi
        ? tx('veta.splatka_klesne_hned_ale_uver_pobezi', { p1: n.mesicu, p2: (l.zbyvaMesicu || 0) })
        : tx('veta.uver_budes_mit_z_krku_za', { p1: n.mesicu, p2: (l.zbyvaMesicu || 0) }))
    + tx('veta.po_prepsani_ti_mesicne_zbyde_p', { p1: kcFull(zbydePak) }) + tx('veta.prepsat_na', { p1: (S.cash < n.poplatek ? ' disabled' : '') }) + SPLATNOSTI[i].nazev + '</button>'
    + (S.cash < n.poplatek ? tx('veta.p_class_fine_err_na_poplatek', { p1: kcFull(n.poplatek) }) : '')
    + '<button class="btn ghost" id="pr-zavrit">' + esc(tx('hra.necham_to_tak')) + '</button>');
  var z = $('pr-zavrit');
  if (z) z.onclick = closeSheet;
  [].forEach.call($('sheet-body').querySelectorAll('[data-pr-sp]'), function (b) {
    b.onclick = function () { prodlouzitSheet(id, Number(b.getAttribute('data-pr-sp'))); };
  });
  var g = $('pr-go');
  if (g) g.onclick = function () {
    var r = zmenitSplatnost(id, i);
    if (!r) return toast(esc(tx('hra.na_poplatek_nemas_hotovost')), 'err');
    save(); paint(); paintBank(); closeSheet(); syncState(true);
    toast(tx('veta.prepsano_na_splatka_mesicne', { p1: r.nazev, p2: kcFull(r.splatka) }), 'ok');
  };
}
function paintBank() {
  var p = PROFILES[S.profile];
  // Do majetku patří i stroje skladem a na cestě — banka je bere jako zástavu stejně jako postavené.
  var room = Math.max(0, zastavaStrop() - S.loan);
  // Procenta se v češtině píšou s desetinnou čárkou, v angličtině s tečkou —
  // formát čísla si proto nechá udělat katalog, ne ruční replace.
  var sazba = function (x) {
    return (x * 100).toFixed(1).replace('.', JAZYK === 'en' ? '.' : ',');
  };
  $('bank-body').innerHTML = '<div class="card">'
    + '<div class="row"><span class="muted small">' + esc(tx('banka.hotovost')) + '</span><b>' + tPenize(S.cash) + '</b></div>'
    + '<div class="row"><span class="muted small">' + esc(tx('banka.volny_ramec')) + '</span><b>' + tPenize(S.bank) + '</b></div>'
    + ((S.duvera || 0) > 0 ? '<div class="row"><span class="muted small">' + esc(tx('banka.zastava')) + '</span><b>' + tPenize(S.duvera)
        + (duveraVolna() < S.duvera ? ' <span class="muted">(' + esc(tx('banka.zastava_volna', { kolik: duveraVolna() })) + ')</span>' : '') + '</b></div>' : '')
    + '<p class="fine" style="margin-top:6px">' + esc(tx('banka.ramec_roste', { denne: BANK_PER_DAY })) + '</p>'
    + '</div>'
    // Dobití patří hned pod přehled účtu — je to nejrychlejší cesta, jak
    // zvednout rámec, a dole pod úvěry ho nikdo nenašel.
    + cashPacksHtml()
    + '<div class="card"><h3>' + esc(tx('banka.uver')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('banka.dluzis')) + '</span><b class="' + (S.loan > 0 ? 'warn' : '') + '">' + tPenize(S.loan) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx(S.loan > 0 ? 'banka.urok_z_dluhu' : 'banka.zakladni_sazba')) + '</span><b>'
    + esc(tx('banka.rocne', { sazba: sazba(S.loan > 0 ? urokSazba() : rateOf()) }))
    + (S.loan > 0 && S.loanPrem > 0.0005
        ? ' <span class="warn">' + esc(tx('banka.za_riziko', { sazba: sazba(S.loanPrem) })) + '</span>' : '')
    + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('banka.splatka_mesic')) + '</span><b class="' + (splatkyMesicne() > 0 ? 'warn' : '') + '">'
    + tPenize(splatkyMesicne()) + (urokMesicne() > 0 ? ' <span class="muted">' + esc(tx('banka.z_toho_urok', { urok: urokMesicne() })) + '</span>' : '') + '</b></div>'
    + dalsiSplatkaHtml()
    + '<div class="kv"><span>' + esc(tx('banka.na_urocich')) + '</span><b>' + tPenize(S.stats.interest) + '</b></div>'
    + ((S.stats.splaceno || 0) > 0 ? '<div class="kv"><span>' + esc(tx('banka.splacenych')) + '</span><b class="ok">'
      + S.stats.splaceno + '</b></div>' : '')
    + '<div class="kv"><span>' + esc(tx('banka.jeste_pujcit')) + '</span><b>' + tPenize(Math.min(room, S.bank)) + '</b></div>'
    + (uverNabidka(null).max >= 1000
        ? '<button class="btn sec big" id="do-ask">' + esc(tx('banka.pozadat')) + '</button>'
          + '<p class="fine">' + esc(tx('banka.pozadat_fine')) + '</p>'
        : '<p class="fine">' + uverDuvod() + '</p>')
    + (S.loan > 0 && S.cash >= 1 ? '<button class="btn big" id="do-repay">'
        + esc(tx('banka.splatit_mimo', { kolik: Math.min(S.cash, S.loan) })) + '</button>'
        + '<p class="fine">' + esc(tx('banka.splatit_fine')) + '</p>' : '')
    + (S.loan > 0 && S.cash < 1 ? '<p class="fine">' + esc(tx('banka.splacet_pozdeji')) + '</p>' : '')
    + '</div>'
    + ramecHtml()
    + uveryHtml();
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
    zapis('splatka', tx('banka.doplaceni'), -pay);
    save(); paint(); syncState(true); toast(tx('banka.splaceno', { kolik: pay }), 'ok');
  };
}
// Klepnutí na hotovost v hlavičce. Když peníze dojdou, hráč nemá hledat,
// kde se berou — tady je rovnou vidí všechny cesty, jak si přidat.
function penizeSheet() {
  var room = Math.max(0, zastavaStrop() - S.loan);
  var muze = uverNabidka(null).max >= 1000;
  sheet('<h3>' + esc(tx('hra.penize')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('hra.hotovost')) + '</span><b>' + kcFull(S.cash) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.dluzis_bance')) + '</span><b class="' + (S.loan > 0 ? 'warn' : '') + tx('veta.b_div_div_class_kv_span_4', { p1: kcFull(S.loan), p2: esc(tx('hra.jeste_si_muzes_pujcit')), p3: kcFull(Math.min(room, S.bank)), p4: dalsiSplatkaHtml(), p5: esc(tx('hra.hotovost_roste_sama_tim_co')) })
    + (PAYMENTS_ON ? esc(tx('hra.nebo_si_dobij_balicek_laundry')) : '.') + '</p>'
    + (muze
        ? '<button class="btn big" id="pen-uver" style="margin-top:12px">' + esc(tx('hra.pozadat_banku_o_uver')) + '</button>'
        : '<p class="fine" style="margin-top:12px">' + uverDuvod() + '</p>')
    + (S.loan > 0 && S.cash >= 1
        ? tx('veta.button_class_btn_sec_id_pen', { p1: kcFull(Math.min(S.cash, S.loan)) }) : '')
    + (PAYMENTS_ON ? '<button class="btn sec" id="pen-balicek" style="width:100%;margin-top:8px">' + esc(tx('hra.dobit_balicek_laundry')) + '</button>' : '')
    + '<button class="btn sec" id="pen-ceka" style="width:100%;margin-top:8px">' + esc(tx('hra.zkontrolovat_co_na_me_ceka')) + '</button>'
    + '<p class="fine">' + esc(tx('hra.cekat_muze_hotovost_pridana_rucne')) + '</p>');
  var u = $('pen-uver');
  if (u) u.onclick = function () { uverSheet(); };
  var sp = $('pen-splatit');
  if (sp) sp.onclick = function () {
    var pay = Math.min(S.cash, S.loan);
    S.cash -= pay; splatitDluh(pay); S.bank = Math.min(bankCap(), S.bank + pay);
    zapis('splatka', esc(tx('hra.doplaceni_uveru')), -pay);
    save(); paint(); syncState(true); closeSheet(); toast(tx('veta.splaceno', { p1: kcFull(pay) }), 'ok');
  };
  var ba = $('pen-balicek');
  if (ba) ba.onclick = function () { closeSheet(); switchTab('bank'); };
  var ck = $('pen-ceka');
  if (ck) ck.onclick = function () {
    ck.disabled = true; ck.textContent = esc(tx('hra.koukam_u2026'));
    var pred = S.cash;
    loadCards().then(function () {
      claimCash(function () {
        closeSheet();
        if (S.cash <= pred) toast(esc(tx('hra.nic_na_tebe_neceka')));
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
  ['#84cc16', '#3f6212', '#ffffff'],
  ['#14b8a6', '#134e4a', '#ffffff'],
  ['#6366f1', '#312e81', '#ffffff'],
  ['#f43f5e', '#881337', '#ffffff'],
  ['#0ea5e9', '#075985', '#ffffff'],
  ['#d946ef', '#701a75', '#ffffff'],
  ['#10b981', '#064e3b', '#ffffff']
];
var ZNAK_TVAR = [
  '<path d="M50 3 L93 17 v33 c0 25-19 40-43 47 C26 90 7 75 7 50 V17z"/>',
  '<circle cx="50" cy="50" r="46"/>',
  '<rect x="5" y="5" width="90" height="90" rx="24"/>',
  '<path d="M50 3 L89 26 v48 L50 97 11 74V26z"/>',
  '<path d="M50 3 L97 50 50 97 3 50z"/>',
  '<path d="M31 5h38l26 26v38l-26 26H31L5 69V31z"/>',
  '<path d="M50 6 L94 86 H6z"/>',
  '<path d="M28 8h44l26 42-26 42H28L2 50z"/>',
  '<path d="M50 4 L95 37 78 93H22L5 37z"/>',
  '<rect x="16" y="16" width="68" height="68" rx="14" transform="rotate(45 50 50)"/>'
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
,
  '<path d="M36 22 L20 32 L26 45 L34 41 V79 H66 V41 L74 45 L80 32 L64 22 L57 28 Q50 33 43 28 Z" fill="%F%"/>',
  '<path d="M22 44 h56 l-6 34 H28z" fill="%F%"/><path d="M34 44 a16 13 0 0 1 32 0" fill="none" stroke="%F%" stroke-width="6"/>',
  '<ellipse cx="50" cy="32" rx="23" ry="8" fill="%F%"/><ellipse cx="50" cy="50" rx="23" ry="8" fill="%F%"/><ellipse cx="50" cy="68" rx="23" ry="8" fill="%F%"/>',
  '<rect x="22" y="48" width="40" height="27" rx="9" fill="%F%"/><circle cx="69" cy="39" r="9" fill="%F%"/><circle cx="81" cy="56" r="5" fill="%F%"/>',
  '<path d="M50 79 C24 63 20 46 28 37 c7-8 17-6 22 3 5-9 15-11 22-3 8 9 4 26-22 42z" fill="%F%"/>',
  '<path d="M77 23 C46 25 28 42 28 64 q0 7 4 12 Q41 51 71 37 Q45 56 39 81 q31 4 39-25 4-15 -1-33z" fill="%F%"/>',
  '<path d="M27 52 L43 69 75 33" fill="none" stroke="%F%" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>',
  '<circle cx="36" cy="38" r="14" fill="none" stroke="%F%" stroke-width="7"/><path d="M46 48 L78 80" fill="none" stroke="%F%" stroke-width="8" stroke-linecap="round"/><path d="M60 62 l11-11" fill="none" stroke="%F%" stroke-width="7" stroke-linecap="round"/><path d="M69 71 l9-9" fill="none" stroke="%F%" stroke-width="7" stroke-linecap="round"/>',
  '<path d="M50 14 c13 12 19 27 19 41 l-6 9H37l-6-9c0-14 6-29 19-41z" fill="%F%"/><circle cx="50" cy="40" r="7" fill="%D%"/><path d="M31 52 L19 74 l14-6z" fill="%F%"/><path d="M69 52 L81 74 67 68z" fill="%F%"/><path d="M43 70 h14 l-7 16z" fill="%F%"/>',
  '<path d="M14 75 L38 35 53 59 63 44 86 75z" fill="%F%"/>',
  '<rect x="28" y="48" width="44" height="32" rx="7" fill="%F%"/><path d="M38 48 v-8 a12 12 0 0 1 24 0 v8" fill="none" stroke="%F%" stroke-width="7"/><circle cx="50" cy="63" r="5" fill="%D%"/>',
  '<path d="M32 25h36l14 19-32 33-32-33z" fill="%F%"/><path d="M18 44h64" fill="none" stroke="%D%" stroke-width="4"/><path d="M50 77 L41 44 50 25 59 44z" fill="none" stroke="%D%" stroke-width="4"/>',
  '<path d="M24 74 h13V54H24zM43 74h13V38H43zM62 74h13V24H62z" fill="%F%"/>',
  '<path d="M75 50a25 25 0 1 1-11-20" fill="none" stroke="%F%" stroke-width="9" stroke-linecap="round"/><path d="M68 15 l4 20-20 1z" fill="%F%"/>',
  '<circle cx="50" cy="50" r="15" fill="%F%"/><path d="M50 13v11M50 76v11M13 50h11M76 50h11M24 24l8 8M68 68l8 8M76 24l-8 8M32 68l-8 8" fill="none" stroke="%F%" stroke-width="7" stroke-linecap="round"/>',
  '<path d="M50 19 L83 46 v33H17V46z" fill="%F%"/><rect x="40" y="55" width="20" height="24" rx="3" fill="%D%"/>'
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
  var gid = 'zg' + c.join('_');
  return '<svg class="znak" width="' + px + '" height="' + px + '" viewBox="0 0 100 100" aria-hidden="true">'
    + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="' + pal[0] + '"/><stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>'
    + '<g fill="url(#' + gid + ')">' + tvar + '</g>'
    + sym.split('%F%').join(pal[2]).split('%D%').join(pal[1])
    + '</svg>';
}
// Výběr znaku — nabídne osmnáct náhodných a dá zamíchat další.
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
    for (var i = 0; i < 18; i++) {
      navrhy.push(Math.floor(Math.random() * ZNAK_TVAR.length) + '-' + pa[i % pa.length] + '-' + sy[i % sy.length]);
    }
    if (vybrano && navrhy.indexOf(vybrano) < 0) navrhy[0] = vybrano;
  }
  zamichej();
  function kresli() {
    sheet('<h3>' + esc(tx('hra.znak_firmy')) + '</h3>'
      + '<p class="muted small">' + esc(tx('hra.vyber_si_znak_pro')) + ' ' + '<b>' + esc((ME && (ME.company || ME.nick)) || 'svou firmu') + '</b>. '
      + esc(tx('hra.uvidi_ho_konkurence_v_zebricku')) + '</p>'
      + '<div class="znak-grid">' + navrhy.map(function (k) {
          return '<button class="znak-opt' + (k === vybrano ? ' on' : '') + '" data-k="' + esc(k) + '">' + znakSvg(k, 54) + '</button>';
        }).join('') + '</div>'
      + '<button class="btn sec" id="znak-mix" style="width:100%;margin-top:12px">' + esc(tx('hra.zamichat_jine')) + '</button>'
      + '<button class="btn big" id="znak-ulozit" style="margin-top:8px"' + (vybrano ? '' : ' disabled') + '>' + esc(tx('hra.pouzit_tenhle_znak')) + '</button>');
    Array.prototype.forEach.call(document.querySelectorAll('.znak-opt'), function (b) {
      b.onclick = function () { vybrano = b.getAttribute('data-k'); kresli(); };
    });
    $('znak-mix').onclick = function () { zamichej(); kresli(); };
    $('znak-ulozit').onclick = function () {
      var b = $('znak-ulozit');
      if (!vybrano) return;
      b.disabled = true; b.textContent = esc(tx('hra.ukladam_2'));
      apiJson('/account/emblem', { emblem: vybrano }).then(function (r) {
        if (!r.ok) { b.disabled = false; b.textContent = esc(tx('hra.pouzit_tenhle_znak_2')); return toast(r.j.error || esc(tx('hra.nepovedlo_se_14')), 'err'); }
        ME = r.j.player; ZEB = null; closeSheet(); loadClaims(); paintMe();
        toast(esc(tx('hra.znak_firmy_je_nastaveny')), 'ok');
      }).catch(function () { b.disabled = false; b.textContent = esc(tx('hra.pouzit_tenhle_znak_3')); toast(esc(tx('hra.server_neodpovida_4')), 'err'); });
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
  sheet('<h3>' + esc(tx('hra.provize_2')) + '</h3><p class="muted small">' + esc(tx('hra.nacitam_6')) + '</p>');
  api('/account/provize').then(function (r) {
    var list = (r.ok && r.j.provize) || [];
    var celkem = list.reduce(function (a, x) { return a + (x.castka || 0); }, 0);
    sheet(tx('veta.h3_provize_h3_p_class_muted')
      + (list.length
          ? '<div class="sum-grid" style="margin:12px 0">'
            + '<div><span>' + esc(tx('hra.dohromady')) + '</span><b class="ok">' + kcFull(celkem) + '</b></div>'
            + '<div><span>' + esc(tx('hra.provizi')) + '</span><b>' + list.length + '×</b></div></div>'
            + '<div class="srv">' + list.map(function (x) {
                return '<div class="srv-radek">'
                  + '<i class="srv-tecka ' + (x.vyzvednuto ? 'ok' : 'warn') + '"></i>'
                  + '<span><b>' + esc(x.zac || 'provize') + '</b>'
                  + '<i>' + esc(datumCas(x.kdy)) + (x.vyzvednuto ? '' : ' ' + esc(tx('hra.ceka_na_vyzvednuti'))) + '</i></span>'
                  + '<b class="ok">' + kcFull(x.castka) + '</b></div>';
              }).join('') + '</div>'
          : tx('hra.div_class_empty_br_prived_nekoho', { p1: esc(tx('hra.zatim_zadna_provize')) }))
      + (list.length >= 200 ? '<p class="fine">' + esc(tx('hra.ukazuje_se_poslednich_200')) + '</p>' : ''));
  }).catch(function () {
    sheet('<h3>' + esc(tx('hra.provize_2')) + '</h3><p class="muted small">' + esc(tx('hra.rozpis_se_nepodarilo_nacist_zkus')) + '</p>');
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
  if (!DIST) return '<div class="card"><h3>' + esc(tx('hra.distributor_2')) + '</h3><p class="fine">' + esc(tx('hra.nacitam')) + '</p></div>';
  var aktivni = DIST.aktivni, rezie = DIST.rezie;
  return '<div class="card"><h3>' + tx('veta.h3_p_class_muted_small_style', { p1: esc(tx('hra.distributor_pradlomatu')), p2: Math.round(DIST.provize * 100), p3: esc(tx('hra.plati_to_i_na_jeho')) }) + (aktivni ? 'ok' : 'warn') + '">'
    + (aktivni ? tx('dist.aktivni_konci', { p1: etaText(new Date(DIST.do).getTime() - Date.now()) }) : esc(tx('hra.neaktivni'))) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.privedenych_hracu')) + '</span><b>' + DIST.privedeno + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.rezie_na_mesic')) + '</span><b class="' + (rezie > 0 ? 'warn' : 'ok') + '">'
    + (rezie > 0 ? kcFull(rezie) : 'zdarma') + '</b></div>'
    + (DIST.provize_celkem > 0
        ? '<button class="kv kv-klik" id="do-provize"><span>' + esc(tx('hra.vydelano_na_provizich')) + '</span>'
          + '<b class="ok">' + kcFull(DIST.provize_celkem) + ' ›</b></button>' : '')
    + '<p class="fine">' + (rezie > 0
        ? tx('hra.rezie_roste_o_s_kazdymi_peti', { p1: kcFull(40000) })
        : tx('hra.do_peti_privedenych_hracu_je_distribuce', { p1: kcFull(40000) }))
    + ' ' + esc(tx('hra.obnovit_se_musi_kazdy_herni')) + '</p>'
    + (S.cash >= rezie
        ? '<button class="btn sec" id="do-dist" style="width:100%;margin-top:8px">'
          + (aktivni
              ? tx('veta.prodlouzit_o_mesic', { p1: (rezie > 0 ? ' za ' + kcFull(rezie) : ' zdarma') })
              : tx('veta.zapnout_na_mesic', { p1: (rezie > 0 ? ' za ' + kcFull(rezie) : ' zdarma') })) + '</button>'
        : tx('hra.p_class_fine_err_na_rezii', { p1: kcFull(rezie - S.cash) }))
    + '</div>';
}
function bindDist() {
  var pr = $('do-provize');
  if (pr) pr.onclick = provizeSheet;
  var b = $('do-dist');
  if (!b) return;
  b.onclick = function () {
    if (!DIST || S.cash < DIST.rezie) return;
    b.disabled = true; b.textContent = esc(tx('hra.platim'));
    var rezie = DIST.rezie;
    apiJson('/account/distributor', {}).then(function (r) {
      if (!r.ok) { b.disabled = false; return toast(r.j.error || esc(tx('hra.nepovedlo_se_15')), 'err'); }
      S.cash -= rezie;
      zapis('poplatek', esc(tx('hra.distributorsky_program_mesicni_rezie')), -rezie);
      save(); syncState(true);
      loadDist(function () { paintMe(); });
      toast(rezie > 0 ? esc(tx('hra.distribuce_zaplacena_na_dalsi_herni'))
        : esc(tx('hra.distribuce_zapnuta_na_dalsi_herni')), 'ok');
    }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida_27')), 'err'); });
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
  if (!ME) return '<p class="fine">' + esc(tx('hra.prihlasenym_hracum_se_tady_vypise')) + '</p>';
  if (POZVANI == null) return '<p class="fine">' + esc(tx('hra.nacitam_3')) + '</p>';
  if (!POZVANI.length) return '<p class="fine">' + esc(tx('hra.pres_tvuj_odkaz_se_zatim')) + ' '
    + esc(tx('hra.otevreni_odkazu_ti_zveda_navstevnost')) + '</p>';
  return tx('veta.p_class_fine_style_margin_bottom', { p1: mn(POZVANI.length, 'je', 'jsou', 'je'), p2: POZVANI.length, p3: mn(POZVANI.length, esc(tx('hra.hrac')), esc(tx('hra.hraci')), esc(tx('hra.hracu'))) }) + POZVANI.map(function (h) {
        // U každého je vidět, kolik má strojů a za kolik z nich už provize přišla.
        // Když se čísla rozcházejí, je hned jasné, u koho to vázne.
        var stroju = h.stroju || 0, provizi = h.provizi || 0;
        var chybi = stroju > provizi;
        return '<div class="zeb-row">' + (h.znak ? znakSvg(h.znak, 24) : '<i class="znak-mezera"></i>')
          + '<span class="nick">' + esc(h.firma)
          + '<i>' + esc(h.nick) + ' · ' + stroju + ' '
          + mn(stroju, 'stroj', 'stroje', esc(tx('hra.stroju'))) + tx('hra.provize_z', { p1: provizi }) + '</i></span>'
          + '<b class="' + (h.provize ? 'ok' : (chybi ? 'warn' : 'muted')) + '">'
          + (h.provize ? kc(h.provize) : datumKratce(h.kdy)) + '</b></div>';
      }).join('') + '</div>'
    + (POZVANI.some(function (h) { return (h.stroju || 0) > (h.provizi || 0); })
        ? tx('veta.p_class_fine_style_margin_top'): '');
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
    { n: esc(tx('hra.postavene_pradlomaty')), m: S.units.length + '×', v: investedTotal() },
    { n: esc(tx('hra.stroje_skladem_a_na_ceste')), m: tx('veta.skladem', { p1: skladem, p2: (cesta ? ', ' + cesta + esc(tx('hra.na_ceste')) : '') }), v: stockValue() },
    { n: esc(tx('hra.pozemky_a_zaplacene_plochy')), m: zem.length + '×', v: pozemkyHodnota() },
    { n: esc(tx('hra.pobocky_a_servisni_ceta')), m: (S.pobocky || []).length + tx('veta.pobocka_5', { p1: (maCetu() ? esc(tx('hra.ceta_v_souhrnu')) : '') }), v: zazemi }
  ];
  var najem = najmyMesicne();
  return '<div class="card"><h3>' + esc(tx('hra.muj_majetek')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 8px">' + esc(tx('hra.co_vsechno_vlastnis_a_kolik')) + '</p>'
    + polozky.map(function (x) {
        return '<div class="kv"><span>' + esc(x.n) + ' <i class="muted small">' + esc(x.m) + '</i></span><b>'
          + kcFull(x.v) + '</b></div>';
      }).join('')
    + (najem ? tx('veta.div_class_kv_span_span_b', { p1: esc(tx('hra.najem_z_pronajatych_pozemku')), p2: kcFull(najem) }): '')
    + '<div class="kv souhrn"><span>' + esc(tx('hra.majetek_celkem')) + '</span><b>' + kcFull(majetek) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.hotovost_2')) + '</span><b>' + kcFull(S.cash) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.dluh_u_banky')) + '</span>' + '<b class="' + (S.loan ? 'err' : '') + '">'
    + (S.loan ? '\u2212' + kcFull(S.loan) : kcFull(0)) + '</b></div>'
    + '<div class="kv souhrn"><span>' + esc(tx('hra.ciste_jmeni_2')) + '</span><b class="' + (cisteJmeni() >= 0 ? 'ok' : 'err') + '">'
    + kcFull(cisteJmeni()) + '</b></div>'
    + '<h3 style="margin:16px 0 4px">' + esc(tx('hra.moje_pozemky')) + '</h3>'
    + (zem.length
        ? zem.map(function (z) {
            var pl = planMista(z.spotId);
            var mist = pl && pl.hotovo && pl.zaplaceno ? planStroje(pl).length : 0;
            var stoji = strojuNaPozemku(z.spotId);
            var stav = stoji
              ? tx('veta.u00d7_pradlomat', { p1: stoji }) + (mist > stoji ? tx('veta.volna_stani', { p1: (mist - stoji) }) : '')
              : mist ? tx('veta.plocha_pripravena_na_ceka_na_stroj', { p1: mist, p2: mn(mist, esc(tx('hra.stani_2')), esc(tx('hra.stani_3')), esc(tx('hra.stani_4'))) }): esc(tx('hra.hola_parcela_plocha_se_musi'));
            return '<div class="area-item" data-zem="' + esc(z.spotId) + '">'
              + '<div><div class="nm">\u2302 ' + esc(z.name || esc(tx('hra.pozemek'))) + '</div>'
              + '<div class="sub">' + (z.m2 || '?') + ' m\u00b2 · ' + stav + '</div></div>'
              + '<b>' + kcFull((z.cena || 0) + (z.priprava || 0)) + '</b></div>';
          }).join('')
        : tx('veta.p_class_fine_zatim_zadny_na'))
    + '</div>';
}
function bindMajetek() {
  [].forEach.call(document.querySelectorAll('[data-zem]'), function (r) {
    r.onclick = function () {
      var n = spotPodle(r.getAttribute('data-zem'));
      if (!n) return toast(esc(tx('hra.tenhle_pozemek_je_v_meste')), 'err');
      switchTab('map');
      if (map) map.setView([n.sp.lat, n.sp.lon], Math.max(16, map.getZoom()));
      spotSheet(n.sp, n.areaId);
    };
  });
}
// ─── Změna jména hráče ───────────────────────────────────────────────────────
// Jméno vidí ostatní na mapě i v žebříčku, takže mezi změnami je pauza —
// jak dlouhá, řídí nastavení hry. Opravu velkých písmen pauza neblokuje.
var NICK_PAUZA_MS = 30 * 86400000;
var NICK_RE_HRA = /^[\p{L}\p{N}_.-]{3,24}$/u;   // stejné pravidlo jako na serveru
function nickVolneZa() {
  if (!ME || !ME.nick_at || !NICK_PAUZA_MS) return 0;
  return Math.max(0, NICK_PAUZA_MS - (Date.now() - Number(new Date(ME.nick_at))));
}
function nickSheet() {
  var zbyva = nickVolneZa();
  var dnu = Math.ceil(zbyva / 86400000);
  sheet('<h3>' + esc(tx('hra.jmeno_hrace')) + '</h3>'
    + '<p class="muted small">' + esc(tx('hra.pod_timhle_jmenem_te_vidi')) + ' '
    + esc(tx('hra.prepise_se_vsude_i_u'))
    + (NICK_PAUZA_MS ? tx('veta.menit_ho_jde_jednou_za_dnu', { p1: Math.round(NICK_PAUZA_MS / 86400000) }) : '')
    + '</p>'
    + (zbyva ? tx('veta.p_class_fine_warn_naposledy_sis', { p1: dnu, p2: esc(tx('hra.ted_jde_opravit_jen_velka')) }) : '')
    + '<label class="fld"><span>' + esc(tx('hra.jmeno_hrace_2')) + '</span>'
    + '<input id="nick-novy" class="inp" type="text" maxlength="24" autocapitalize="off" '
    + 'autocorrect="off" spellcheck="false" value="' + esc(ME ? ME.nick : '') + '"></label>'
    + '<p class="fine" id="nick-stav">' + esc(tx('hra.3_24_znaku_pismena_cislice')) + '</p>'
    + '<button class="btn big" id="nick-ok" style="width:100%;margin-top:6px">' + esc(tx('hra.ulozit_jmeno')) + '</button>');
  var hledam = null;
  var stav = function (txt, tr) { var el = $('nick-stav'); el.textContent = txt; el.className = 'fine' + (tr ? ' ' + tr : ''); };
  $('nick-novy').oninput = function () {
    var v = $('nick-novy').value.trim();
    if (hledam) { clearTimeout(hledam); hledam = null; }
    if (v === (ME ? ME.nick : '')) return stav(esc(tx('hra.tohle_jmeno_uz_mas')));
    if (!NICK_RE_HRA.test(v)) return stav(esc(tx('hra.3_24_znaku_pismena_cislice_2')), 'err');
    if (ME && v.toLowerCase() === String(ME.nick).toLowerCase()) return stav(esc(tx('hra.jen_jinak_velka_pismena_to')), 'ok');
    stav(esc(tx('hra.zjistuji_jestli_je_volne')));
    hledam = setTimeout(function () {
      api('/account/nick-free?nick=' + encodeURIComponent(v)).then(function (r) {
        if ($('nick-novy').value.trim() !== v) return;
        stav(r.ok && r.j.free ? esc(tx('hra.jmeno_je_volne')) : esc(tx('hra.tohle_jmeno_uz_nekdo_ma')), r.ok && r.j.free ? 'ok' : 'err');
      }).catch(function () { stav(esc(tx('hra.volnost_jmena_se_nepovedlo_overit'))); });
    }, 400);
  };
  $('nick-ok').onclick = function () {
    var v = $('nick-novy').value.trim(), b = $('nick-ok');
    if (!NICK_RE_HRA.test(v)) return toast(esc(tx('hra.jmeno_musi_mit_3_24')), 'err');
    b.disabled = true; b.textContent = esc(tx('hra.ukladam_3'));
    apiJson('/account/nick', { nick: v }).then(function (r) {
      b.disabled = false; b.textContent = esc(tx('hra.ulozit_jmeno_2'));
      if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_16')), 'err');
      ME = r.j.player;
      ZEB = null; TRADES = null; FINANCE = null;
      closeSheet(); loadClaims(); paintMe(); drawMap();
      toast(tx('veta.od_ted_hrajes_jako', { p1: ME.nick }), 'ok');
    }).catch(function () { b.disabled = false; b.textContent = esc(tx('hra.ulozit_jmeno_3')); toast(esc(tx('hra.server_neodpovida_5')), 'err'); });
  };
}

// ─── Podíly: kdo vlastní kus mě a kde mám kus já ─────────────────────────────
// Podíl se vyrovnává každý herní měsíc, takže se vyplatí vidět, jestli to
// dává smysl: za kolik se koupil, kolik už vynesl a kolik nese teď.
// Kdy z podílu příjde další výplata. Bez toho hráč u čerstvě koupeného podílu
// vidí „Zatím vyneslo 0" a nemá jak poznat, jestli je to rozbité, nebo jen
// ještě nebyl termín. Vyplácí se jednou za herní měsíc, tedy po dvanácti
// skutečných hodinách; server je obchází po pěti minutách, takže „teď"
// znamená do pěti minut.
function vyplataZa(e) {
  if (!e || !e.dalsi) return esc(tx('hra.po_hernim_mesici'));
  var ms = new Date(e.dalsi).getTime() - Date.now();
  if (!(ms > 0)) return esc(tx('hra.ted_2'));
  var h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
  if (h >= 1) return 'za ' + h + ' h ' + (m ? m + ' min' : '');
  return 'za ' + Math.max(1, m) + ' min';
}
function podilRadek(e, mam) {
  var pct = Math.round(e.podil * 100);
  // U podílu jde o firmu, ne o člověka — proto název firmy, když ho známe.
  var kdo = e.kdo_firma || e.kdo;
  var navratnost = e.mesicne > 0 ? e.cena / (e.mesicne * 12) : null;
  var vraceno = e.cena > 0 ? Math.round(e.vyplaceno / e.cena * 100) : 0;
  return '<div class="trade"><div class="row"><b>' + pct + ' % · ' + esc(kdo) + '</b>'
    + '<b class="' + (e.mesicne > 0 ? 'ok' : e.mesicne < 0 ? 'err' : '') + '">'
    + (e.mesicne > 0 ? '+' : '') + kcFull(e.mesicne) + ' ' + esc(tx('hra.mes_5')) + '</b></div>'
    + '<div class="kv"><span>' + (mam ? esc(tx('hra.koupil_jsi_za')) : esc(tx('hra.prodal_jsi_za'))) + '</span><b>'
    + kcFull(e.cena) + '</b></div>'
    + '<div class="kv"><span>' + (e.vyplaceno >= 0
        ? (mam ? esc(tx('drazba.zatim_vyneslo')) : esc(tx('drazba.zatim_jsi_vyplatil')))
        : (mam ? esc(tx('drazba.zatim_jsi_doplatil')) : esc(tx('drazba.zatim_ti_doplatil')))) + '</span><b class="'
    + (e.vyplaceno > 0 ? (mam ? 'ok' : 'warn') : '') + '">' + kcFull(Math.abs(e.vyplaceno)) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('drazba.nejblizsi_vyplata')) + '</span><b class="'
    + (vyplataZa(e) === esc(tx('drazba.ted')) ? 'ok' : '') + '">' + vyplataZa(e) + '</b></div>'
    + (mam
        ? '<div class="bar"><i style="width:' + Math.min(100, Math.max(0, vraceno)) + '%"></i></div>'
          + '<p class="fine">' + (e.vyplaceno >= e.cena
              ? tx('veta.vraceno_cele_a_nad_to_od', { p1: kcFull(e.vyplaceno - e.cena) })
              : tx('veta.vraceno_ceny', { p1: Math.max(0, vraceno) })
                + (navratnost ? tx('hra.pri_dnesnim_vydelku_zbyva_roku_do', { p1: navratnost.toFixed(1).replace('.', desZnak()) }) : esc(tx('podil.firma_nevydelava')))) + '</p>'
        : '<p class="fine">' + esc(tx('hra.vyrovnava_se_kazdy_herni_mesic')) + ' '
          + esc(tx('hra.odkoupit_ho_zpatky_jde_jen')) + '</p>')
    + '<div class="akce"><button class="btn sm sec" data-odkup-ja="' + e.id + '">'
      + (mam ? esc(tx('drazba.nabidnout_odkup_majiteli')) : esc(tx('drazba.nabidnout_odkup'))) + '</button>'
      + (mam ? '<button class="btn sm sec" data-prevod="' + e.id + '">' + esc(tx('drazba.prodat_jinemu')) + '</button>' : '')
      + '</div>'
    + '</div>';
}
// Dividendová politika firmy: kolik procent měsíčního zisku se vyplácí
// podílníkům. Určuje ji ten, kdo drží víc než polovinu — majitel ne.
function dividendaFirmy(id) {
  return (FINANCE && FINANCE.dividendy && FINANCE.dividendy[id]) || null;
}
function dividendaRadek(id, mojeFirma) {
  var d = dividendaFirmy(id);
  if (!d) return '';
  var pct = Math.round(d.pct * 100);
  return '<div class="row" style="margin-top:6px"><span class="muted small">'
    + esc(tx('dividenda.vyplaci_se')) + '</span><span class="' + (pct < 100 ? 'warn' : '') + '">'
    + pct + ' %</span></div>'
    + '<p class="fine">'
    + (d.urcuje
        ? (d.smim ? esc(tx('dividenda.urcujes_ty'))
          : tx('veta.dividendu_urcuje', { p1: esc(d.urcuje_nick || '') }))
        : esc(tx(mojeFirma ? 'dividenda.nikdo_neurcuje_moje' : 'dividenda.nikdo_neurcuje')))
    + '</p>'
    + (d.smim ? '<div class="gcard-act"><button class="btn sm" data-dividenda="' + id + '">'
        + esc(tx('dividenda.nastavit')) + '</button></div>' : '')
    + zastavaRadek(id, d, mojeFirma)
    + blokyRadek(d, mojeFirma)
    + vystupniRadek(id, d);
}
// Aliance, které ve firmě drží podíl. Majitel musí vidět, že proti němu
// stojí blok, ne pět nesouvisejících lidí — skrytý kartel by byl past.
function blokyRadek(d, mojeFirma) {
  var l = (d && d.bloky) || [];
  if (!l.length) return '';
  return l.map(function (b) {
    return '<div class="row" style="margin-top:6px"><span class="muted small">'
      + esc(tx('aliance.blok')) + '</span><span>' + esc(b.nazev) + ' \u00b7 '
      + pctHra(b.podil) + ' %</span></div>'
      + '<p class="fine">' + tx(mojeFirma ? 'veta.blok_ve_tve_firme' : 'veta.blok_ve_firme',
        { p1: b.clenu, p2: esc(b.mluvci || '') }) + '</p>';
  }).join('');
}
// Výstupní nabídka. Kdo drží tři čtvrtiny firmy, může nechat viset trvalý
// odkup zbytku — menšina pak má kudy ven, i když se měsíc neukáže. Prodat
// nikdo nemusí: tahle hra nikomu podíl násilím nebere.
function vystupniRadek(id, d) {
  if (!d.smim_vystupni) return '';
  return '<p class="fine">' + esc(tx('veta.vystupni_k_cemu_je')) + '</p>'
    + '<div class="gcard-act"><button class="btn sm" data-vystupni="' + id + '">'
    + esc(tx('vystupni.vyhlasit')) + '</button></div>';
}
// Okno výstupní nabídky. Oproti obyčejné nemá lhůtu ani strop — vykoupí,
// co kdo přinese, a visí, dokud ji útočník nestáhne.
function vystupniSheet(id, nazev, dno) {
  sheet('<h3>' + tx('veta.vystupni_nabidka_na', { p1: esc(nazev || '') }) + '</h3>'
    + '<p class="muted small">' + esc(tx('veta.vystupni_popis')) + '</p>'
    + '<label class="fld"><span>' + esc(tx('prevzeti.cena_za_procento')) + '</span>'
    + '<input id="vn-cena" class="inp" type="number" inputmode="numeric" min="' + dno
    + '" value="' + dno + '"></label>'
    + '<div class="kv"><span>' + esc(tx('vystupni.nejmene')) + '</span><b>' + kcFull(dno) + '</b></div>'
    + '<p class="fine" id="vn-dno"></p>'
    + '<p class="fine">' + esc(tx('veta.vystupni_rada')) + '</p>'
    + '<button class="btn big" id="vn-ok" style="width:100%;margin-top:10px">'
    + esc(tx('vystupni.vyhlasit')) + '</button>');
  var prepocti = function () {
    var v = Math.round(Number($('vn-cena').value) || 0);
    $('vn-dno').className = 'fine' + (v < dno ? ' err' : '');
    $('vn-dno').textContent = v < dno ? tx('veta.vystupni_pod_ocenenim', { p1: kcFull(dno) }) : '';
  };
  $('vn-cena').oninput = prepocti; prepocti();
  $('vn-ok').onclick = function () {
    var v = Math.round(Number($('vn-cena').value) || 0);
    if (v < dno) return toast(tx('veta.vystupni_pod_ocenenim', { p1: kcFull(dno) }), 'err');
    $('vn-ok').disabled = true;
    apiJson('/trade/prevzeti', { firma_id: id, cena_za_pct: v, trvala: true }).then(function (r) {
      if (!r.ok) { $('vn-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
      closeSheet(); PREVZETI = null; FINANCE = null; loadTrades(paintMe);
      toast(esc(tx('vystupni.vyhlasena')), 'ok', true);
    }).catch(function () { $('vn-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}
// Blokační menšina: kdo drží čtvrtinu firmy, může zakázat dát ji do zástavy.
// Není to žádost o souhlas — je to přepínač, který si podílník nastaví
// dopředu. Majitel tak na nikoho nečeká a rovnou vidí, na čem je.
function zastavaRadek(id, d, mojeFirma) {
  if (!d.smim_blokovat && !d.blokuje) return '';
  var h = '<div class="row" style="margin-top:6px"><span class="muted small">'
    + esc(tx('zastava.zastavit_majetek')) + '</span><span class="'
    + (d.blokuje ? 'err' : 'ok') + '">'
    + esc(tx(d.blokuje ? 'zastava.zakazano' : 'zastava.povoleno')) + '</span></div>';
  if (d.blokuje && !d.smim_blokovat) {
    h += '<p class="fine">' + (mojeFirma
      ? tx('veta.zastavu_ti_blokuje', { p1: esc(d.blokuje_nick || '') })
      : tx('veta.zastavu_blokuje', { p1: esc(d.blokuje_nick || '') })) + '</p>';
  }
  if (d.smim_blokovat) {
    h += '<p class="fine">' + esc(tx('veta.zastava_blokace_rada')) + '</p>'
      + '<div class="gcard-act"><button class="btn sm' + (d.muj_zakaz ? ' sec' : '')
      + '" data-zastava="' + id + '" data-zakaz="' + (d.muj_zakaz ? '0' : '1') + '">'
      + esc(tx(d.muj_zakaz ? 'zastava.zase_povolit' : 'zastava.zakazat')) + '</button></div>';
  }
  return h;
}
// Okno na nastavení. Je v něm jediné číslo, protože jediné číslo se tu mění:
// zbytek firmy zůstává majiteli, nikdo mu do ní nesahá.
function dividendaSheet(id, nazev, mesicneTed) {
  var d = dividendaFirmy(id); if (!d) return;
  var ted = Math.round(d.pct * 100);
  sheet('<h3>' + tx('veta.vyplata_zisku_ve_firme', { p1: esc(nazev || '') }) + '</h3>'
    + '<p class="muted small">' + esc(tx('veta.dividenda_popis')) + '</p>'
    + '<label class="fld"><span>' + esc(tx('dividenda.kolik_se_vyplaci')) + '</span>'
    + '<input id="dv-pct" class="inp" type="number" inputmode="numeric" min="0" max="100" value="'
    + ted + '"></label>'
    + '<div class="kv souhrn"><span>' + esc(tx('dividenda.tobe_mesicne')) + '</span>'
    + '<b id="dv-vysledek">\u2014</b></div>'
    + '<p class="fine">' + esc(tx('veta.dividenda_rada')) + '</p>'
    + '<button class="btn big" id="dv-ok" style="width:100%;margin-top:10px">'
    + esc(tx('hra.ulozit')) + '</button>');
  var pct = function () {
    var v = Math.round(Number($('dv-pct').value) || 0);
    return Math.max(0, Math.min(100, v)) / 100;
  };
  var prepocti = function () {
    if (Number($('dv-pct').value) > 100) $('dv-pct').value = 100;
    // Náhled se počítá z toho, co teče teď, přepočtené na novou politiku.
    var zaklad = d.pct > 0 ? mesicneTed / d.pct : 0;
    $('dv-vysledek').textContent = kcFull(Math.round(zaklad * pct()));
  };
  $('dv-pct').oninput = prepocti; prepocti();
  $('dv-ok').onclick = function () {
    $('dv-ok').disabled = true;
    apiJson('/trade/dividenda', { firma_id: id, pct: pct() }).then(function (r) {
      if (!r.ok) { $('dv-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
      closeSheet(); FINANCE = null; loadTrades(paintMe);
      toast(tx('veta.vyplata_nastavena_na', { p1: Math.round(r.j.pct * 100) }), 'ok', true);
    }).catch(function () { $('dv-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}

// ─── Investiční aliance ─────────────────────────────────────────────────────
// Podíly členů se v jedné firmě sčítají, takže blok dosáhne na prahy, na
// které sám nedosáhne nikdo. Za blok jedná ten, kdo v té firmě drží nejvíc.
var ALIANCE = null;
function loadAliance(then) {
  api('/trade/aliance').then(function (r) {
    ALIANCE = (r.ok && r.j) || { aliance: null, pozvanky: [] };
    if (then) then();
  }).catch(function () { ALIANCE = { aliance: null, pozvanky: [] }; if (then) then(); });
}
function alianceHtml() {
  if (!ALIANCE) return '';
  var a = ALIANCE.aliance;
  var h = '<div class="card"><h3>\uD83E\uDD1D ' + esc(tx('aliance.nadpis')) + '</h3>';
  if (a) {
    h += '<div class="row"><b>' + esc(a.nazev) + '</b><span class="pill good">'
      + tx('veta.clenu_z', { p1: a.clenove.filter(function (c) { return c.stav === 'clen'; }).length,
        p2: ALIANCE.max_clenu }) + '</span></div>'
      + a.clenove.map(function (c) {
          return '<div class="row"><span>' + esc(c.kdo) + (c.ja ? ' \u00b7 ' + esc(tx('aliance.ty')) : '') + '</span>'
            + '<span class="muted small">' + esc(tx(c.stav === 'clen' ? 'aliance.clen' : 'aliance.pozvan')) + '</span></div>';
        }).join('')
      + '<p class="fine">' + esc(tx('veta.aliance_jak_funguje')) + '</p>'
      + '<div class="gcard-act"><button class="btn sec sm" id="al-odejit">'
      + esc(tx('aliance.odejit')) + '</button></div>';
  } else {
    h += '<p class="muted small" style="margin:2px 0 8px">' + esc(tx('veta.aliance_k_cemu_je')) + '</p>';
    (ALIANCE.pozvanky || []).forEach(function (p) {
      h += '<div class="row"><b>' + esc(p.nazev) + '</b>'
        + '<button class="btn sm" data-al-prijmout="' + p.aliance_id + '">'
        + esc(tx('aliance.prijmout')) + '</button></div>';
    });
    if ((ALIANCE.pozvanky || []).length) {
      h += '<p class="fine warn">' + esc(tx('veta.aliance_cena_za_vstup')) + '</p>';
    }
    h += '<div class="gcard-act"><button class="btn sm" id="al-zalozit">'
      + esc(tx('aliance.zalozit')) + '</button></div>';
  }
  return h + '</div>';
}
function zalozAlianceSheet() {
  sheet('<h3>' + esc(tx('aliance.zalozit')) + '</h3>'
    + '<p class="muted small">' + esc(tx('veta.aliance_popis')) + '</p>'
    + '<label class="fld"><span>' + esc(tx('aliance.nazev')) + '</span>'
    + '<input id="al-nazev" class="inp" type="text" maxlength="24" value=""></label>'
    + '<p class="fine">' + esc(tx('veta.aliance_cena_za_vstup')) + '</p>'
    + '<button class="btn big" id="al-ok" style="width:100%;margin-top:10px">'
    + esc(tx('aliance.zalozit')) + '</button>');
  $('al-ok').onclick = function () {
    var n = String($('al-nazev').value || '').trim();
    if (n.length < 2) return toast(esc(tx('aliance.zadej_nazev')), 'err');
    $('al-ok').disabled = true;
    apiJson('/trade/aliance', { nazev: n }).then(function (r) {
      if (!r.ok) { $('al-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
      closeSheet(); ALIANCE = null; FINANCE = null; loadAliance(paintMe);
      toast(esc(tx('aliance.zalozena')), 'ok', true);
    }).catch(function () { $('al-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}
function bindAliance(kde) {
  var box = $(kde); if (!box) return;
  if ($('al-zalozit')) $('al-zalozit').onclick = zalozAlianceSheet;
  if ($('al-odejit')) $('al-odejit').onclick = function () {
    apiJson('/trade/aliance/odejit', {}).then(function (r) {
      if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err');
      ALIANCE = null; FINANCE = null; loadAliance(paintMe);
      toast(esc(tx('aliance.odesel_jsi')), 'ok', true);
    }).catch(function () { toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
  [].forEach.call(box.querySelectorAll('[data-al-prijmout]'), function (b) {
    b.onclick = function () {
      b.disabled = true;
      apiJson('/trade/aliance/prijmout', { aliance_id: Number(b.getAttribute('data-al-prijmout')) })
        .then(function (r) {
          if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
          ALIANCE = null; FINANCE = null; loadAliance(paintMe);
          toast(esc(tx('aliance.vstoupil_jsi')), 'ok', true);
        }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
    };
  });
}

function podilyHtml() {
  if (!FINANCE) return '';
  var moje = (FINANCE.podily || []).filter(function (e) { return e.moje === 'mam' && bezici(e); });
  var ciziVeMne = (FINANCE.podily || []).filter(function (e) { return e.moje === 'prodal' && bezici(e); });
  if (!moje.length && !ciziVeMne.length) return '';
  var h = '<div class="card"><h3>' + esc(tx('hra.podily')) + '</h3>';
  if (ciziVeMne.length) {
    var celkem = ciziVeMne.reduce(function (a, e) { return a + e.podil; }, 0);
    var mesicne = ciziVeMne.reduce(function (a, e) { return a + e.mesicne; }, 0);
    h += tx('veta.p_class_muted_small_style_margin_4', { p1: tx('veta.podilnikum_z_ni_mesicne_odchazi', { p1: Math.round(celkem * 100), p2: kcFull(mesicne) }), p2: (mesicne < 0 ? ' ' + esc(tx('hra.pri_ztrate_ti_naopak_doplaceji')) : '.') })
      + dividendaRadek(ME && ME.id, true)
      + ciziVeMne.map(function (e) { return podilRadek(e, false); }).join('');
  }
  if (moje.length) {
    var videno = {};
    moje.forEach(function (e) {
      e.prvni_v_firme = !videno[e.kdo_id]; videno[e.kdo_id] = true;
    });
    var nese = moje.reduce(function (a, e) { return a + e.mesicne; }, 0);
    var dal = moje.reduce(function (a, e) { return a + e.cena; }, 0);
    var vzal = moje.reduce(function (a, e) { return a + e.vyplaceno; }, 0);
    h += '<h3 style="margin-top:' + (ciziVeMne.length ? '18px' : '2px') + tx('veta.h3_p_class_muted_small_style_5', { p1: esc(tx('hra.tvoje_podily_v_cizich_firmach')), p2: kcFull(dal), p3: kcFull(vzal), p4: kcFull(nese) })
      + moje.map(function (e) { return podilRadek(e, true)
          + (e.prvni_v_firme ? dividendaRadek(e.kdo_id, false) : ''); }).join('');
  }
  return h + '</div>';
}
function bindPodily() {
  if (ALIANCE == null) loadAliance(paintMe);
  bindAliance('me-body');
  [].forEach.call($('me-body').querySelectorAll('[data-dividenda]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-dividenda'));
      var mych = ((FINANCE && FINANCE.podily) || []).filter(function (x) {
        return x.moje === 'mam' && x.kdo_id === id; });
      var nazev = mych.length ? (mych[0].kdo_firma || mych[0].kdo) : (ME && ME.company) || '';
      var mesicne = mych.reduce(function (a, x) { return a + x.mesicne; }, 0);
      dividendaSheet(id, nazev, mesicne);
    };
  });
  [].forEach.call($('me-body').querySelectorAll('[data-vystupni]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-vystupni'));
      var d = dividendaFirmy(id); if (!d) return;
      var mych = ((FINANCE && FINANCE.podily) || []).filter(function (x) {
        return x.moje === 'mam' && x.kdo_id === id; });
      var nazev = mych.length ? (mych[0].kdo_firma || mych[0].kdo) : '';
      vystupniSheet(id, nazev, d.min_cena || 1000);
    };
  });
  [].forEach.call($('me-body').querySelectorAll('[data-zastava]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-zastava'));
      var zakaz = b.getAttribute('data-zakaz') === '1';
      b.disabled = true;
      apiJson('/trade/zastava-souhlas', { firma_id: id, zakaz: zakaz }).then(function (r) {
        if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
        FINANCE = null; loadTrades(paintMe);
        toast(esc(tx(r.j.zakaz ? 'zastava.zakaz_zapnut' : 'zastava.zakaz_vypnut')), 'ok', true);
      }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
    };
  });
  [].forEach.call($('me-body').querySelectorAll('[data-odkup-ja]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-odkup-ja'));
      var e = ((FINANCE && FINANCE.podily) || []).filter(function (x) { return x.id === id; })[0];
      if (e) odkupSheet(e);
    };
  });
  bindPrevod('me-body');
}
// Prodat podíl dál — stejné tlačítko v Já i na Burze.
function bindPrevod(kde) {
  [].forEach.call($(kde).querySelectorAll('[data-prevod]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-prevod'));
      var e = ((FINANCE && FINANCE.podily) || []).filter(function (x) { return x.id === id; })[0];
      if (e) prevodSheet(e);
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
      + '<p class="muted small" style="margin:3px 0 0">' + esc(tx('hra.hrajes_jako')) + ' ' + '<b>' + esc(ME.nick) + '</b></p>'
      + '<p class="muted small" style="margin:2px 0 0">' + esc(mojeHodnost().nazev) + '</p></div></div>'
      + odznakyPruhHtml()
      + '<p class="muted small" style="margin:10px 0 8px">' + esc(tx('hra.pod_jmenem_a_znakem_firmy')) + '</p>'
      + '<label class="fld"><span>' + esc(tx('hra.nazev_firmy')) + '</span>'
      + '<input id="me-firma" class="inp" type="text" maxlength="60" value="' + esc(ME.company || '') + '"></label>'
      + '<button class="btn sec" id="me-firma-ulozit" style="width:100%;margin-top:8px">' + esc(tx('hra.prejmenovat_firmu')) + '</button>'
      + '<button class="btn sec" id="me-znak" style="width:100%;margin-top:8px">'
      + (ME.emblem ? esc(tx('hra.zmenit_znak_firmy')) : esc(tx('hra.vygenerovat_znak_firmy'))) + '</button>'
      + '<button class="btn sec" id="me-nick" style="width:100%;margin-top:8px">' + esc(tx('hra.zmenit_jmeno_hrace')) + '</button>'
      // Kde se má otevřít mapa. Má smysl teprve, když je z čeho vybírat.
      + (zakladny().length > 1
          ? '<p class="muted small" style="margin:14px 0 6px"><b>' + esc(tx('hra.kde_zacina_mapa')) + '</b><br>'
            + esc(tx('hra.po_prihlaseni_te_mapa_vezme')) + '</p>'
            + '<div class="drz-tl">'
            + zakladny().map(function (z) {
                var je = vychoziZakladna() && vychoziZakladna().id === z.id;
                return '<button class="btn sm' + (je ? '' : ' sec') + '" data-mapa-od="' + esc(z.id) + '">'
                  + (z.sidlo ? esc(tx('hra.sidlo')) + ' · ' : '') + esc(z.nazev) + '</button>';
              }).join('')
            + '</div>'
          : '')
      // Jazyk sedí u účtu, takže přepnutí platí i na druhém zařízení.
      + '<p class="muted small" style="margin:14px 0 6px"><b>' + esc(tx('jazyk.nadpis')) + '</b><br>'
      + esc(tx('jazyk.popis')) + '</p>'
      // Tlačítka se skládají ze seznamu, který přišel se stránkou. Další řeč
      // se tím objeví sama, jakmile je přeložená — bez sahání do hry.
      + '<div class="drz-tl">'
      + JAZYKY_HOTOVE.map(function (j) {
          return '<button class="btn sm' + (JAZYK === j ? '' : ' sec') + '" data-jazyk="' + esc(j) + '">'
            + esc(tx('jazyk.' + j)) + '</button>';
        }).join('')
      + '</div>'
      + '</div>'
    : '')
    + '<div class="card"><h3>' + esc(p.name) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 8px">' + esc(p.desc) + '</p>'
    + '<div class="kv"><span>' + esc(tx('hra.herni_rok')) + '</span><b>' + gameYear() + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.ciste_jmeni')) + '</span><b class="' + (net >= 0 ? 'ok' : 'err') + '">' + kcFull(net) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.prozkoumanych_oblasti')) + '</span><b>' + Object.keys(S.areas).length + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.proverenych_mist')) + '</span><b>' + Object.keys(S.revealed).length + '</b></div>'
    + '</div>'
    + hodnostHtml()
    + odznakyHtml()
    + podilyHtml()
    + alianceHtml()
    + majetekHtml()
    + '<div class="card"><h3>' + esc(tx('hra.jak_se_hraje')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 0">' + esc(tx('hra.jeden_skutecny_den_jsou_ve')) + ' '
    + esc(tx('hra.mista_na_mape_jsou_skutecna')) + ' '
    + esc(tx('hra.plati_se_v')) + ' ' + '<b>' + esc(tx('hra.laundrech')) + '</b>' + ' ' + esc(tx('hra.herni_mene_ktera_nema_zadnou')) + '</p></div>'
    + '<div class="card"><h3>' + esc(tx('hra.pozvi_lidi_a_pribydou_ti')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">' + esc(tx('hra.kazdy_kdo_otevre_tvuj_odkaz')) + ' '
    + esc(tx('hra.pocita_se_otevreni_odkazu_nekym')) + '</p>'
    + '<div class="kv"><span>' + esc(tx('hra.otevreli_tvuj_odkaz')) + '</span><b class="ok">' + (S.refs || 0) + '×</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.navstevnost')) + '</span><b>' + Math.round(traffic() * 100) + ' % '
    + (traffic() >= trafficMax() ? esc(tx('hra.na_maximu')) : '(z ' + Math.round(trafficMax() * 100) + ' %)') + '</b></div>'
    + '<div class="bar"><i style="width:' + Math.round(traffic() / trafficMax() * 100) + '%"></i></div>'
    + '<button class="btn big" id="do-share" style="margin-top:12px">' + (navigator.share ? esc(tx('hra.poslat_odkaz')) : esc(tx('hra.zkopirovat_odkaz'))) + '</button>'
    + '</div>'
    + '<div class="card"><h3>' + esc(tx('hra.tvoje_sit_hracu')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">' + esc(tx('hra.kdo_si_pres_tvuj_odkaz')) + ' '
    + esc(tx('hra.tohle_zustava_zapsane_natrvalo')) + '</p>'
    + pozvaniHtml() + '</div>'
    + knihaHtml()
    + distHtml()
    + '<button class="btn sec big" id="do-reset">' + esc(tx('hra.zacit_znovu_od_nuly')) + '</button>'
    + '<button class="btn sec" id="do-smazat" style="width:100%;margin-top:8px">' + esc(tx('hra.smazat_ucet')) + '</button>';
  if (drzFirma != null && $('me-firma')) $('me-firma').value = drzFirma;
  var fb = $('me-firma-ulozit');
  if (fb) fb.onclick = function () {
    var f = $('me-firma').value.trim();
    if (f.length < 2) return toast(esc(tx('hra.nazev_firmy_ma_aspon_2')), 'err');
    fb.disabled = true; fb.textContent = esc(tx('hra.ukladam'));
    apiJson('/account/company', { company: f }).then(function (r) {
      fb.disabled = false; fb.textContent = esc(tx('hra.prejmenovat_firmu_2'));
      if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_17')), 'err');
      ME = r.j.player;
      ZEB = null; loadClaims(); paintMe();
      toast(tx('veta.firma_se_ted_jmenuje', { p1: ME.company }), 'ok');
    }).catch(function () { fb.disabled = false; fb.textContent = esc(tx('hra.prejmenovat_firmu_3')); toast(esc(tx('hra.server_neodpovida_2')), 'err'); });
  };
  if (FINANCE == null) loadFinance(paintMe);
  if (ODZNAKY_HRA == null) loadOdznaky(paintMe);
  bindPodily();
  bindOdznaky();
  bindDist();
  bindMajetek();
  var kn = $('do-kniha');
  if (kn) kn.onclick = function () { KNIHA_FILTR = 'vse'; knihaSheet(); };
  var zb = $('me-znak');
  if (zb) zb.onclick = function () { znakSheet(); };
  var nb = $('me-nick');
  if (nb) nb.onclick = function () { nickSheet(); };
  // Přepínač jazyka. Po přepnutí se panel překreslí, ať je hned vidět, co to udělalo.
  [].forEach.call($('me-body').querySelectorAll('[data-jazyk]'), function (b) {
    b.onclick = function () { prepniJazyk(b.getAttribute('data-jazyk'), paintMe); };
  });
  [].forEach.call($('me-body').querySelectorAll('[data-mapa-od]'), function (b) {
    b.onclick = function () {
      S.mapaOd = b.getAttribute('data-mapa-od');
      save(); syncState(true).catch(function () {});
      var z = vychoziZakladna();
      // Ať je vidět, co se vybralo: mapa tam rovnou skočí.
      if (z && map) map.setView([z.lat, z.lon], Math.max(MAPA_ZOOM, map.getZoom()));
      paintMe();
      if (z) toast(tx('veta.mapa_bude_zacinat_u', { p1: z.nazev }), 'ok');
    };
  });
  $('do-share').onclick = function () { shareGame($('do-share')); };
  // Výdej údajů: prohlížeč si soubor stáhne sám, server ho posílá jako
  // přílohu. Žádné potvrzování — nic se tím nemění.
  if ($('do-udaje')) $('do-udaje').onclick = function () {
    window.location.href = '/api/game/account/udaje';
  };
  $('do-reset').onclick = zacniZnovuSheet;
  if ($('do-smazat')) $('do-smazat').onclick = smazUcetSheet;
}
// Čistý štít. Smazat jen prohlížeč nestačí — stav i zabraná místa drží server
// a po obnovení stránky by se hra vrátila přesně tam, kde byla.
function zacniZnovuSheet() {
  potvrdSlovem({
    nadpis: tx('hra.zacit_znovu'),
    popis: esc(tx('hra.prijdes_o_celou_sit_o')),
    slovo: tx('server.potvrzeni_zacit_znovu'),
    tlacitko: tx('hra.ano_smazat_a_zacit_znovu'),
    pak: function (slovo, zpet) {
      // Napřed stav uložíme: server z něj vyrovnává půjčky a podíly, takže
      // musí mít tu hotovost, kterou hráč opravdu má, ne tu z minulé minuty.
      syncState(true).catch(function () {}).then(function () {
        apiJson('/account/reset', { potvrzeni: slovo }).then(function (r) {
          if (!r.ok) { zpet(); return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_18')), 'err'); }
          wiped = true;
          try { localStorage.removeItem(KEY); } catch (e) { /* nevadí */ }
          location.replace(location.pathname);
        }).catch(function () { zpet(); toast(esc(tx('hra.server_neodpovida_3')), 'err'); });
      });
    },
  });
}
// Smazání účtu. Nevratné a jiné než čistý štít: tohle je odchod ze hry.
function smazUcetSheet() {
  potvrdSlovem({
    nadpis: tx('hra.smazat_ucet'),
    popis: esc(tx('hra.ucet_zmizi_i_s_udaji')),
    slovo: tx('server.potvrzeni_smazat'),
    tlacitko: tx('hra.ano_smazat_ucet'),
    pak: function (slovo, zpet) {
      syncState(true).catch(function () {}).then(function () {
        apiJson('/account/smazat', { potvrzeni: slovo }).then(function (r) {
          if (!r.ok) { zpet(); return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_18')), 'err'); }
          wiped = true;
          try { localStorage.removeItem(KEY); } catch (e) { /* nevadí */ }
          location.replace(location.pathname);
        }).catch(function () { zpet(); toast(esc(tx('hra.server_neodpovida_3')), 'err'); });
      });
    },
  });
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

// Tečka na záložce svítí, když na hráče čeká nabídka obchodu.
var CEKA_NABIDKA = false;
function chatOdznak() {
  var dot = $('burza-dot');
  if (!dot) return;
  dot.classList.toggle('hidden', !CEKA_NABIDKA);
}
// ─── Výběr hráče ─────────────────────────────────────────────────────────────
// Používá se dvakrát: komu napsat a komu nabídnout obchod. Kdo je zrovna u hry,
// odpoví hned — proto filtr a stav u každého jména. Řazení dělá server podle
// posledního uložení hry, takže nahoře jsou ti nejčerstvější.
var ONLINE_MS = 10 * 60000;       // kdo si uložil hru za posledních deset minut
var DNES_MS = 24 * 3600000;
function hracStav(h) {
  // Přednost má tep z otevřené hry — ten chodí pořád. Poslední uložení je jen
  // záloha pro případ, že server tepy ještě neposílá.
  if (h.online === 'tady') return { kde: 'online', text: esc(tx('hra.u_hry_ted')), tr: 'ok' };
  if (h.online === 'pozadi') return { kde: 'online', text: esc(tx('hra.hru_ma_otevrenou')), tr: 'ok' };
  var t = h.naposledy ? new Date(h.naposledy).getTime() : 0;
  if (!t) return { kde: 'nikdy', text: esc(tx('hra.jeste_nehral')), tr: '' };
  var pred = Date.now() - t;
  if (pred <= ONLINE_MS) return { kde: 'online', text: esc(tx('hra.u_hry_ted_2')), tr: 'ok' };
  if (pred <= DNES_MS) {
    var min = Math.round(pred / 60000);
    return { kde: 'dnes', text: min < 60 ? tx('veta.pred_min', { p1: min }): tx('veta.pred_h', { p1: Math.round(min / 60) }), tr: 'warn' };
  }
  var dnu = Math.round(pred / 86400000);
  return { kde: 'dav', text: tx('veta.pred', { p1: dnu, p2: mn(dnu, 'dnem', 'dny', 'dny') }), tr: '' };
}
function hraciVyberSheet(nadpis, popisTlacitka, pak) {
  sheet('<h3>' + esc(nadpis) + '</h3><p class="muted small">' + esc(tx('hra.nacitam_hrace')) + '</p>');
  api('/trade/players').then(function (r) {
    if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_19')), 'err');
    var hraci = r.j.players || [];
    var podleId = {};
    hraci.forEach(function (h) { podleId[h.id] = h; });
    if (!hraci.length) {
      return sheet('<h3>' + esc(tx('hra.zatim_neni_komu')) + '</h3><p class="muted small">' + esc(tx('hra.az_pribude_dalsi_hrac_objevi')) + '</p>');
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
      sheet(tx('veta.h3_h3_div_class_seg_sub', { p1: esc(nadpis), p2: (filtr === 'online' ? 'on' : ''), p3: (online ? ' (' + online + ')' : ''), p4: (filtr === 'dnes' ? 'on' : ''), p5: (dnes ? ' (' + dnes + ')' : ''), p6: (filtr === 'vse' ? 'on' : '') }) + tx('veta.data_f_vse_vsichni_button_div', { p1: hraci.length, p2: esc(hledam) })
        + (k.length ? k.map(function (h) {
            var st = hracStav(h);
            return '<div class="area-item"><div><div class="nm">' + esc(h.firma) + '</div>'
              + '<div class="sub">' + esc(h.hodnost_nazev || h.nick) + ' · <i class="' + st.tr + '">'
              + (st.kde === 'online' ? '● ' : '') + esc(st.text) + '</i></div></div>'
              + '<button class="btn sec sm" data-h="' + h.id + '">' + esc(popisTlacitka) + '</button></div>';
          }).join('')
          : '<p class="muted small" style="margin-top:14px">'
            + (filtr === 'online' ? esc(tx('hra.zrovna_nikdo_u_hry_neni'))
               : esc(tx('hra.nikdo_takovy_tu_neni'))) + '</p>'));
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
        b.onclick = function () { var i = Number(b.getAttribute('data-h')); pak(i, podleId[i]); };
      });
    };
    vykresli();
  }).catch(function () { toast(esc(tx('hra.server_neodpovida_24')), 'err'); });
}
// Komu napsat — seznam všech hráčů, stejný jako u nabídky.
// ─── Kolik mám doopravdy volných peněz ───────────────────────────────────────
// Rozjednaná nabídka, u které platím já, drží hotovost stejně jako objednávka.
// Bez toho jde rozeslat deset nabídek po milionu s milionem v kase a devět
// z nich pak nejde přijmout.
function jaPlatimNabidku(t) {
  var kupuji = (t.smer === 'koupim' && t.moje) || (t.smer === 'prodam' && !t.moje);
  return t.predmet === 'pujcka' ? !kupuji : kupuji;   // u půjčky platí věřitel
}
function vazanaHotovost(krome) {
  return (TRADES || []).reduce(function (a, t) {
    // Jen vlastní nabídky — co posílá někdo mně, mě k ničemu nezavazuje.
    return a + (t.moje && t.stav === 'ceka' && t.id !== krome && jaPlatimNabidku(t)
      ? (t.cena || 0) : 0);
  }, 0);
}
function volnaHotovost(krome) { return S.cash - vazanaHotovost(krome); }
// Věta pod formulář: kolik mi zbývá a co to drží.
function volneHtml(krome) {
  var vaz = vazanaHotovost(krome);
  if (!vaz) return '';
  return tx('veta.p_class_fine_hotovost', { p1: tx('veta.z_toho_drzi_rozjednane_nabidky_volnych', { p1: kcFull(S.cash), p2: kcFull(vaz), p3: kcFull(Math.max(0, S.cash - vaz)) }) });
}

function predmetPopis(t) {
  if (t.predmet === 'stroj') return 'stroj ' + ((MODELS[t.model] || {}).name || t.model);
  if (t.predmet === 'pradlomat') return esc(tx('hra.pradlomat_na_miste'));
  if (t.predmet === 'pujcka') {
    var d = t.data || {};
    return tx('veta.pujcka_rocne_na_hernich_mesicu', { p1: kcFull(t.cena), p2: procenta(d.urok), p3: (d.mesicu || 0) });
  }
  if (t.predmet === 'podil') return tx('veta.podil_ve_firme_2', { p1: Math.round(((t.data || {}).podil || 0) * 100) });
  if (t.predmet === 'odkup') return tx('veta.zpetny_odkup_podilu', { p1: Math.round(((t.data || {}).podil || 0) * 100) });
  if (t.predmet === 'prevod') return tx('veta.podil_ve_firme', { p1: pctHra((t.data || {}).podil), p2: ((t.data || {}).firma || (t.data || {}).firma_nick || '') });
  if (t.predmet === 'vstup') {
    var dv = t.data || {};
    return tx('veta.popis_vstup', { p1: Math.round((dv.podil || 0) * 100) });
  }
  if (t.predmet === 'odklad') {
    var dd = t.data || {};
    return tx('veta.popis_odklad', { p1: (dd.odklad_mesicu || 1) });
  }
  // Karta je poslední známý předmět, ne odkladiště pro všechno ostatní.
  // Dokud tu tahle větev byla jako „co zbyde", každý nový druh obchodu se
  // hráči ukázal jako „karta" bez názvu — a ten se pak právem ptal, co to
  // má být.
  if (t.predmet === 'karta') {
    var c = (CARDS_CAT || []).filter(function (x) { return x.kind === t.card_kind; })[0];
    return tx('hra.karta_x', { p1: (c ? polNazev(c) : (t.card_kind || '?')) });
  }
  return esc(String(t.predmet || '?'));
}
function cenaPopis(t) {
  var casti = [];
  if (t.cena) casti.push(kcFull(t.cena));
  (t.karty || []).forEach(function (k) {
    var c = (CARDS_CAT || []).filter(function (x) { return x.kind === k; })[0];
    casti.push(c ? polNazev(c) : k);
  });
  return casti.join(' + ') || '—';
}

// ─── Co běží: půjčky a podíly ────────────────────────────────────────────────
// Server to vypořádá sám každý herní měsíc, hráč tu jen vidí, na čem je.
var FINANCE = null;
// ─── Odznaky ─────────────────────────────────────────────────────────────────
// Sbírku drží server, hra si ji jen vyzvedne. Nový odznak hlásíme jednou —
// podle toho, co už hráč viděl, ne podle toho, co zrovna přišlo ze serveru.
var ODZNAKY_HRA = null;
function loadOdznaky(then) {
  if (!ME) { ODZNAKY_HRA = []; if (then) then(); return; }
  api('/account/odznaky').then(function (r) {
    ODZNAKY_HRA = (r.ok && r.j.odznaky) || [];
    hlidejNoveOdznaky();
    if (then) then();
  }).catch(function () { ODZNAKY_HRA = ODZNAKY_HRA || []; if (then) then(); });
}
function hlidejNoveOdznaky() {
  if (!S || !ODZNAKY_HRA) return;
  var videl = S.odznakyVidene || [];
  var nove = ODZNAKY_HRA.filter(function (o) { return o.mam && videl.indexOf(o.kod) < 0; });
  S.odznakyVidene = ODZNAKY_HRA.filter(function (o) { return o.mam; }).map(function (o) { return o.kod; });
  save();
  if (!nove.length) return;
  var o = nove[0];
  sheet('<div class="odz-det">' + odznakMedaile(o, true)
    + '<h3>' + esc(tx('hra.novy_odznak')) + '</h3><span class="odz-stuha">' + esc(o.nazev) + '</span></div>'
    + '<p class="muted small" style="text-align:center">' + esc(o.popis) + '</p>'
    + (nove.length > 1 ? tx('veta.p_class_fine_a_k_tomu', { p1: (nove.length - 1) }) : '')
    + '<p class="fine">' + esc(tx('hra.odmenu_pripisuje_server_objevi_se')) + '</p>'
    + '<button class="btn big" id="odz-ok" style="width:100%;margin-top:10px">' + esc(tx('hra.diky_2')) + '</button>');
  if ($('odz-ok')) $('odz-ok').onclick = closeSheet;
  toast(tx('veta.mas_odznak', { p1: o.nazev }), 'ok', true);
}
// Jeden odznak jako medaile. Nesplněný je tmavá silueta se zámkem — má být
// vidět, že tam něco chybí, ne že tam nic není.
function odznakMedaile(o, velky) {
  var b = o.barva || ['#94a3b8', '#475569'];
  var styl = o.mam
    ? 'background:linear-gradient(145deg,' + b[0] + ',' + b[1] + ')'
    : '';
  return '<span class="odz-m' + (o.mam ? ' mam' : '') + (velky ? ' vel' : '') + '" style="' + styl + '">'
    + '<span class="odz-m-in">' + (o.mam ? o.ikona : '\u{1F512}') + '</span></span>';
}
// Získané odznaky hned v hlavičce Já, aby se na ně nemuselo scrollovat.
// Menší medaile, jen to, co hráč má — prázdná místa patří do sbírky níž.
function odznakyPruhHtml() {
  if (!ODZNAKY_HRA || !ODZNAKY_HRA.length) return '';
  var mam = [];
  ODZNAKY_HRA.forEach(function (o, i) { if (o.mam) mam.push({ o: o, i: i }); });
  if (!mam.length) {
    return tx('veta.p_class_fine_style_margin_10px');
  }
  return '<div class="odz-pruh">' + mam.map(function (x) {
    return '<button type="button" class="odz-b mal mam" data-odz="' + x.i + '" title="'
      + esc(x.o.nazev) + '">' + odznakMedaile(x.o) + '</button>';
  }).join('') + '<span class="odz-pruh-p">' + mam.length + ' z ' + ODZNAKY_HRA.length + '</span></div>';
}
function odznakyHtml() {
  if (!ME) return '';
  if (ODZNAKY_HRA == null) return '<div class="card"><h3>' + esc(tx('hra.odznaky_2')) + '</h3><p class="muted small">' + esc(tx('hra.nacitam_7')) + '</p></div>';
  if (!ODZNAKY_HRA.length) return '';
  var mam = ODZNAKY_HRA.filter(function (o) { return o.mam; }).length;
  var cel = ODZNAKY_HRA.length;
  return '<div class="card"><h3>' + esc(tx('hra.odznaky')) + '</h3>'
    + '<div class="odz-hlava"><b>' + mam + '</b><span>z ' + cel + '</span></div>'
    + '<div class="bar odz-bar"><i style="width:' + Math.round(mam / cel * 100) + '%"></i></div>'
    + '<p class="muted small" style="margin:8px 0 12px">' + esc(tx('hra.nejsou_za_velikost_firmy_ale')) + ' '
    + esc(tx('hra.vidi_je_i_ostatni_kdyz')) + '</p>'
    + '<div class="odz-mriz">'
    + ODZNAKY_HRA.map(function (o, i) {
        return '<button type="button" class="odz-b' + (o.mam ? ' mam' : '') + '" data-odz="' + i + '">'
          + odznakMedaile(o) + '<span class="odz-jm">' + esc(o.nazev) + '</span></button>';
      }).join('')
    + '</div></div>';
}
// Detail po klepnutí — tady je prostor říct, co to znamená a jak na to.
function odznakSheet(o) {
  sheet('<div class="odz-det">' + odznakMedaile(o, true)
    + '<h3>' + esc(o.nazev) + '</h3>'
    + (o.mam ? '<span class="odz-stuha">' + esc(tx('hra.ziskano')) + '</span>'
             : '<span class="odz-stuha zamek">' + esc(tx('hra.zatim_nemas')) + '</span>') + '</div>'
    + '<p class="muted small" style="text-align:center">' + esc(o.popis) + '</p>'
    + (o.mam
        ? (o.kdy ? '<div class="kv"><span>' + esc(tx('hra.ziskano_2')) + '</span><b>' + datumCZ(o.kdy) + '</b></div>' : '')
        : '<div class="kv"><span>' + esc(tx('hra.jak_na_nej')) + '</span></div><p class="fine">' + esc(o.jak) + '</p>')
    + (o.odmena && o.odmena.karta
        ? '<div class="kv"><span>' + esc(tx('hra.odmena_2')) + '</span><b>' + esc(odmenaSlovy(o.odmena)) + '</b></div>' : '')
    + '<button class="btn sec" id="odz-zpet" style="width:100%;margin-top:12px">' + esc(tx('hra.zpatky_2')) + '</button>');
  if ($('odz-zpet')) $('odz-zpet').onclick = closeSheet;
}
function datumCZ(t) {
  var d = new Date(t);
  if (isNaN(d)) return '';
  return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear();
}
function bindOdznaky() {
  var box = $('me-body');
  if (!box) return;
  [].forEach.call(box.querySelectorAll('[data-odz]'), function (b) {
    b.onclick = function () {
      var o = (ODZNAKY_HRA || [])[Number(b.getAttribute('data-odz'))];
      if (o) odznakSheet(o);
    };
  });
}
function loadFinance(then) {
  api('/trade/finance').then(function (r) { FINANCE = (r.ok && r.j) || { pujcky: [], podily: [] }; if (then) then(); })
    .catch(function () { FINANCE = { pujcky: [], podily: [] }; if (then) then(); });
}
// Úrok v českém zápisu — 12,5 %, ne 12.5 %.
function procenta(x) {
  var v = Math.round((Number(x) || 0) * 1000) / 10;
  return tCislo2(String(v)) + ' %';
}
function zaKolik(ms) {
  var d = Number(ms ? new Date(ms) : 0) - Date.now();
  if (!(d > 0)) return esc(tx('hra.kazdou_chvili'));
  var min = Math.max(1, Math.round(d / 60000)), h = Math.floor(min / 60);
  var zb = min - h * 60;
  return 'za ' + (h ? h + ' h' + (zb ? ' ' + zb + ' min' : '') : zb + ' min');
}
// Doplacení půjčky dřív, než doběhne. Platí se současná hodnota zbývajících
// splátek — úrok tedy jen za dobu, kterou dlužník peníze opravdu měl.
function splatitSheet(id, castka) {
  var chybi = castka - S.cash;
  sheet(tx('veta.h3_h3_p_class_muted_small_20', { p1: esc(tx('hra.doplatit_pujcku')), p2: kcFull(castka) }) + (chybi > 0 ? 'err' : 'ok') + '">'
    + kcFull(S.cash) + '</b></div>'
    + (chybi > 0
        ? tx('hra.p_class_fine_err_chybi_ti', { p1: kcFull(chybi) })
        : tx('veta.button_class_btn_big_id_spl', { p1: kcFull(castka) })));
  if ($('spl-ok')) $('spl-ok').onclick = function () {
    var b = $('spl-ok'); b.disabled = true;
    apiJson('/trade/pujcka/' + id + '/splatit', {}).then(function (r) {
      if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_20')), 'err'); }
      closeSheet(); vyzvedniNasledky(); FINANCE = null; loadFinance(paintBurza);
      toast(esc(tx('hra.pujcka_je_doplacena')), 'ok');
    }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida_22')), 'err'); });
  };
}
// Co je uzavřené, v přehledu nepřekáží — zůstává u své nabídky v historii.
var bezici = function (x) {
  return x.stav !== 'splaceno' && x.stav !== 'propadlo' && x.stav !== 'odkoupeno';
};
// ─── Veřejná nabídka na odkup podílů ────────────────────────────────────────
// Míří na všechny podílníky firmy najednou. Prodat musí chtít, mlčení je
// odmítnutí a převede se jen to, co kdo doopravdy prodal.
var PREVZETI = null;
function loadPrevzeti(then) {
  api('/trade/prevzeti').then(function (r) {
    PREVZETI = (r.ok && r.j.nabidky) || [];
    if (then) then();
  }).catch(function () { PREVZETI = []; if (then) then(); });
}
function prevzetiHtml() {
  var l = PREVZETI || [];
  if (!l.length) return '';
  return '<div class="card"><h3>\uD83C\uDFF4 ' + esc(tx('prevzeti.nadpis')) + '</h3>'
    + l.slice(0, 10).map(function (t) {
        var jaProdam = !t.moje && t.muj_podil > 0;
        return '<div class="trade">'
          + '<div class="row"><b>' + esc(t.firma) + '</b>'
          + '<span class="pill ' + (t.na_moji_firmu ? 'bad' : t.moje ? 'good' : 'mid') + '">'
          + esc(tx(t.na_moji_firmu ? 'prevzeti.na_tvoji_firmu'
              : t.moje ? 'prevzeti.tvoje' : 'prevzeti.drzis_podil')) + '</span></div>'
          + '<p class="muted small" style="margin:2px 0 6px">'
          + tx('veta.prevzeti_radek', { p1: esc(t.utocnik), p2: kcFull(t.cena_za_pct) }) + '</p>'
          + '<div class="row"><span class="muted small">' + esc(tx('prevzeti.chce_koupit')) + '</span>'
          + '<span>' + pctHra(t.max_pct) + ' % \u00b7 ' + esc(tx('prevzeti.uz_koupeno')) + ' '
          + pctHra(t.koupeno_pct) + ' %</span></div>'
          + '<div class="row"><span class="muted small">'
          + esc(tx(t.trvala ? 'prevzeti.plati' : 'prevzeti.dobehne')) + '</span>'
          + '<span>' + (t.trvala ? esc(tx('prevzeti.bez_lhuty')) : zaKolik(t.do)) + '</span></div>'
          + (jaProdam
              ? '<div class="row"><span class="muted small">' + esc(tx('prevzeti.ty_drzis')) + '</span>'
                + '<span class="ok">' + pctHra(t.muj_podil) + ' % \u00b7 '
                + kcFull(Math.round(t.muj_podil * 100 * t.cena_za_pct)) + '</span></div>'
                + '<div class="gcard-act"><button class="btn sm" data-prevzeti="' + t.id + '">'
                + esc(tx('prevzeti.prodat_do_nabidky')) + '</button></div>'
              : t.na_moji_firmu
                ? '<p class="fine warn">' + esc(tx('veta.prevzeti_na_tvoji_firmu_rada')) + '</p>'
                : t.moje
                  ? '<div class="gcard-act"><button class="btn sm sec" data-prevzeti-zrus="' + t.id + '">'
                    + esc(tx('prevzeti.stahnout')) + '</button></div>'
                  : '')
          + '</div>';
      }).join('')
    + '</div>';
}
// Prodej do nabídky. Prodat jde i kus — kdo si chce část podílu nechat,
// nemá důvod pouštět všechno.
function prevzetiSheet(t) {
  var maxPct = Math.min(t.muj_podil, t.zbyva_pct);
  sheet('<h3>' + tx('veta.prodat_podil_v', { p1: esc(t.firma) }) + '</h3>'
    + '<p class="muted small">' + tx('veta.prevzeti_prodej_popis', { p1: esc(t.utocnik), p2: kcFull(t.cena_za_pct) }) + '</p>'
    + '<div class="kv"><span>' + esc(tx('prevzeti.ty_drzis')) + '</span><b>' + pctHra(t.muj_podil) + ' %</b></div>'
    + '<div class="kv"><span>' + esc(tx('prevzeti.jeste_vykoupi')) + '</span><b>' + pctHra(t.zbyva_pct) + ' %</b></div>'
    + '<label class="fld"><span>' + esc(tx('prevzeti.kolik_prodas')) + '</span>'
    + '<input id="pz-pct" class="inp" type="number" inputmode="decimal" min="0.1" step="0.1" max="'
    + pctHra(maxPct) + '" value="' + pctHra(maxPct) + '"></label>'
    + '<div class="kv souhrn"><span>' + esc(tx('prevzeti.dostanes')) + '</span>'
    + '<b id="pz-vysledek">\u2014</b></div>'
    + '<p class="fine">' + esc(tx('veta.prevzeti_prodej_rada')) + '</p>'
    + '<button class="btn big" id="pz-ok" style="width:100%;margin-top:10px">'
    + esc(tx('prevzeti.prodat_do_nabidky')) + '</button>'
    + '<button class="btn sec" id="pz-ne" style="width:100%;margin-top:8px">'
    + esc(tx('hra.nechat_byt')) + '</button>');
  var pct = function () {
    var v = Number(($('pz-pct') || {}).value) || 0;
    return Math.max(0, Math.min(maxPct, v / 100));
  };
  // Pole se srovná rovnou na místě. Číslo, které se jinak počítá, než jak je
  // napsané, je horší než zakázané pole — hráč pak nevěří ani jednomu.
  var prepocti = function () {
    var p = pct();
    if (Number($('pz-pct').value) > pctHra(maxPct)) $('pz-pct').value = pctHra(maxPct);
    $('pz-vysledek').textContent = kcFull(Math.round(p * 100 * t.cena_za_pct));
  };
  $('pz-pct').oninput = prepocti; prepocti();
  $('pz-ne').onclick = closeSheet;
  $('pz-ok').onclick = function () {
    if (!(pct() > 0)) return toast(esc(tx('prevzeti.zadej_kolik')), 'err');
    $('pz-ok').disabled = true;
    apiJson('/trade/prevzeti/' + t.id + '/prodat', { podil: pct() }).then(function (r) {
      if (!r.ok) { $('pz-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
      closeSheet();
      vyzvedniNasledky(); FINANCE = null; PREVZETI = null;
      loadTrades(paintBurza);
      toast(tx('veta.prodal_jsi_pct_za', { p1: pctHra(r.j.prodano), p2: kcFull(r.j.cena) }), 'ok', true);
    }).catch(function () { $('pz-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}
// Vyhlášení nabídky. Cena se zadává za procento — je to jediné číslo, které
// dává smysl porovnávat mezi firmami různé velikosti.
function vyhlasitSheet(toId, kdo, a) {
  var oc = (a && a.oceneni) || null;
  var zaProcento = oc && oc.jmeni > 0 ? Math.round(oc.jmeni / 100) : 100000;
  sheet('<h3>' + tx('veta.vyhlasit_nabidku_na', { p1: esc(kdo.firma || kdo.nick) }) + '</h3>'
    + '<p class="muted small">' + esc(tx('veta.vyhlaseni_popis')) + '</p>'
    + (oc ? oceneniHtml(oc, 'koupim-podil') : '')
    + '<label class="fld"><span>' + esc(tx('prevzeti.cena_za_procento')) + '</span>'
    + '<input id="vy-cena" class="inp" type="number" inputmode="numeric" min="1000" value="'
    + zaProcento + '"></label>'
    + '<label class="fld"><span>' + esc(tx('prevzeti.kolik_chces_koupit')) + '</span>'
    + '<input id="vy-pct" class="inp" type="number" inputmode="numeric" min="1" max="100" value="30"></label>'
    + '<label class="fld"><span>' + esc(tx('prevzeti.jak_dlouho_plati')) + '</span>'
    + '<input id="vy-hodin" class="inp" type="number" inputmode="numeric" min="6" max="72" value="48"></label>'
    + '<div class="kv souhrn"><span>' + esc(tx('prevzeti.celkem_slibujes')) + '</span>'
    + '<b id="vy-vysledek">\u2014</b></div>'
    + '<p class="fine" id="vy-kryti"></p>'
    + '<p class="fine">' + esc(tx('veta.vyhlaseni_rada')) + '</p>'
    + '<button class="btn big" id="vy-ok" style="width:100%;margin-top:10px">'
    + esc(tx('prevzeti.vyhlasit')) + '</button>');
  var celkem = function () {
    var c = Math.max(0, Math.round(Number($('vy-cena').value) || 0));
    var p = Math.max(1, Math.min(100, Math.round(Number($('vy-pct').value) || 0)));
    return c * p;
  };
  var prepocti = function () {
    var v = celkem();
    $('vy-vysledek').textContent = kcFull(v);
    var volne = volnaHotovost(null);
    $('vy-kryti').className = 'fine' + (v > volne ? ' err' : '');
    $('vy-kryti').textContent = v > volne
      ? tx('veta.na_to_nemas_volne_mas', { p1: kcFull(Math.max(0, volne)) })
      : '';
  };
  ['vy-cena', 'vy-pct', 'vy-hodin'].forEach(function (id) { if ($(id)) $(id).oninput = prepocti; });
  prepocti();
  $('vy-ok').onclick = function () {
    if (celkem() > volnaHotovost(null)) {
      return toast(tx('veta.na_to_nemas_volne_mas', { p1: kcFull(Math.max(0, volnaHotovost(null))) }), 'err');
    }
    $('vy-ok').disabled = true;
    apiJson('/trade/prevzeti', { firma_id: toId,
      cena_za_pct: Math.max(1000, Math.round(Number($('vy-cena').value) || 0)),
      pct: Math.max(1, Math.min(100, Math.round(Number($('vy-pct').value) || 0))) / 100,
      hodin: Math.max(6, Math.min(72, Math.round(Number($('vy-hodin').value) || 48))) })
      .then(function (r) {
        if (!r.ok) { $('vy-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
        closeSheet(); PREVZETI = null; loadTrades(paintBurza);
        toast(esc(tx('prevzeti.vyhlaseno')), 'ok', true);
      }).catch(function () { $('vy-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}

// ─── Firmy v nouzi ───────────────────────────────────────────────────────────
// Kdo nemá na splátku, je vidět. Není to udání — je to ta chvíle, kdy se dá
// přijít s penězi a říct si o podmínky. Dokud to nikdo neviděl, propadla
// zástava a hra se ani nestihla odehrát.
var KRIZE = null;
function loadKrize(then) {
  api('/trade/krize').then(function (r) {
    KRIZE = (r.ok && r.j) || { ja: null, firmy: [] };
    if (then) then();
  }).catch(function () { KRIZE = { ja: null, firmy: [] }; if (then) then(); });
}
// Vlastní stav. Varování vidí jen dlužník sám — proto je tady, ne v seznamu.
function mojeKrizeHtml() {
  var j = KRIZE && KRIZE.ja;
  if (!j || j.stupen === 'ok') return '';
  var zle = j.stupen === 'propadne';
  return '<div class="card' + (zle ? ' agent' : '') + '">'
    + '<h3>' + (zle ? '\u26A0\uFE0F ' : '') + esc(tx(zle ? 'krize.propadne_nadpis'
        : j.stupen === 'krize' ? 'krize.krize_nadpis' : 'krize.varovani_nadpis')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('krize.splatne_brzy')) + '</span><b>'
    + kcFull(j.splatne_brzy) + '</b></div>'
    + (j.chybi > 0
        ? '<div class="kv"><span>' + esc(tx('krize.chybi')) + '</span><b class="err">'
          + kcFull(j.chybi) + '</b></div>'
        : '')
    + (j.zmeskano
        ? '<div class="kv"><span>' + esc(tx('krize.zmeskanych_splatek')) + '</span><b class="err">'
          + j.zmeskano + '</b></div>'
        : '')
    + '<p class="fine ' + (zle ? 'err' : '') + '">'
    + esc(tx(zle ? 'veta.krize_propadne_rada' : 'veta.krize_krize_rada')) + '</p>'
    + '<p class="fine">' + esc(tx('veta.krize_jsi_videt')) + '</p>'
    + '</div>';
}
// Nástěnka ostatních. Nejhorší nahoře — tam je nejmíň času a nejvíc prostoru
// říct si o podmínky.
function krizeHtml() {
  if (!KRIZE) return '';
  var f = (KRIZE.firmy) || [];
  return '<div class="card"><h3>\uD83D\uDD25 ' + esc(tx('krize.nadpis_seznamu')) + '</h3>'
    + '<p class="muted small" style="margin:2px 0 10px">' + esc(tx('veta.krize_k_cemu_to_je')) + '</p>'
    + (f.length ? '' : '<p class="muted small">' + esc(tx('krize.zatim_nikdo')) + '</p>')
    + f.slice(0, 12).map(function (x) {
        return '<div class="trade"><div class="row"><b>' + esc(x.firma) + '</b>'
          + '<span class="pill ' + (x.stupen === 'propadne' ? 'bad' : 'mid') + '">'
          + esc(tx(x.stupen === 'propadne' ? 'krize.stitek_propadne' : 'krize.stitek_krize')) + '</span></div>'
          + '<div class="row"><span class="muted small">' + esc(tx('krize.chybi_mu')) + '</span>'
          + '<span class="err">' + kcFull(x.chybi) + '</span></div>'
          + '<div class="row"><span class="muted small">' + esc(tx('krize.dalsi_splatka_2')) + '</span>'
          + '<span>' + (x.dalsi_at ? zaKolik(x.dalsi_at) : '\u2014') + '</span></div>'
          + (x.zmeskano
              ? '<div class="row"><span class="muted small">' + esc(tx('krize.uz_zmeskal')) + '</span>'
                + '<span class="err">' + x.zmeskano + '</span></div>'
              : '')
          + '<p class="fine">' + esc(tx('krize.cim_muze_rucit')) + ' '
          + tx('veta.krize_ruceni', { p1: x.volnych_mist,
              p2: Math.round((x.volny_podil || 0) * 100) }) + '</p>'
          + '<div class="gcard-act"><button class="btn sm" data-krize-pujcit="' + x.id + '">'
          + esc(tx('krize.nabidnout_pujcku')) + '</button></div>'
          + '</div>';
      }).join('')
    + '</div>';
}

// Odklad splátky. Dlužník si o něj řekne sám a může za něj nabídnout
// poplatek — věřitel na tom bývá líp než na propadlé zástavě, protože
// z rozprodané firmy dostane zlomek toho, co by mu přinesla splacená půjčka.
function odkladSheet(p) {
  sheet('<h3>' + esc(tx('hra.pozadat_o_odklad')) + '</h3>'
    + '<p class="muted small">' + tx('veta.odklad_jak_to_funguje', { p1: esc(p.kdo) }) + '</p>'
    + '<div class="kv"><span>' + esc(tx('hra.splatka')) + '</span><b>' + kcFull(p.splatka) + '</b></div>'
    + (p.zmeskano
        ? '<div class="kv"><span>' + esc(tx('hra.zmeskane_splatky')) + '</span><b class="err">'
          + p.zmeskano + '</b></div>'
        : '')
    + '<label class="fld"><span>' + esc(tx('hra.o_kolik_hernich_mesicu')) + '</span>'
    + '<input id="od-mesicu" class="inp" type="number" inputmode="numeric" min="1" max="6" value="2"></label>'
    + '<label class="fld"><span>' + esc(tx('hra.poplatek_za_odklad')) + '</span>'
    + '<input id="od-cena" class="inp" type="number" inputmode="numeric" min="0" value="'
    + Math.round((p.splatka || 0) * 0.1) + '"></label>'
    + '<p class="fine">' + esc(tx('veta.odklad_poplatek_rada')) + '</p>'
    + '<label class="fld"><span>' + esc(tx('hra.vzkaz_nepovinny')) + '</span>'
    + '<input id="od-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<button class="btn big" id="od-ok" style="width:100%;margin-top:10px">'
    + esc(tx('hra.poslat_nabidku')) + '</button>');
  $('od-ok').onclick = function () {
    var c = Math.max(0, Math.round(Number($('od-cena').value) || 0));
    if (c > volnaHotovost(null)) {
      return toast(tx('veta.volne_hotovosti_mas_jen', { p1: kcFull(Math.max(0, volnaHotovost(null))), p2: esc(tx('hra.zbytek_drzi_rozjednane_nabidky')) }), 'err');
    }
    $('od-ok').disabled = true;
    apiJson('/trade/offer', { to_id: p.kdo_id, predmet: 'odklad', cena: c, smer: 'koupim',
      loan_id: p.id, odklad_mesicu: Math.max(1, Math.min(6, Math.round(Number($('od-mesicu').value) || 1))),
      vzkaz: ($('od-vzkaz').value || '').slice(0, 200) })
      .then(function (r) {
        if (!r.ok) { $('od-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
        closeSheet(); loadTrades(paintBurza);
        toast(esc(tx('hra.nabidka_odeslana_ted_je_to')), 'ok');
      }).catch(function () { $('od-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}

function financeHtml() {
  var f = FINANCE;
  if (!f || (!(f.pujcky || []).filter(bezici).length && !(f.podily || []).filter(bezici).length)) return '';
  var h = '<div class="card"><h3>' + esc(tx('hra.pujcky_a_podily')) + '</h3>';
  (f.pujcky || []).filter(bezici).forEach(function (p) {
    var dluzim = p.moje === 'dluzim';
    h += '<div class="trade"><div class="row"><b>' + (dluzim ? esc(tx('hra.dluzis_2')) + ' ' : esc(tx('hra.pujcil_jsi')) + ' ') + tx('veta.b_b_b_div_p_class', { p1: esc(p.kdo), p2: kcFull(p.castka), p3: procenta(p.urok), p4: p.splaceno, p5: p.mesicu }) + (p.zastava ? tx('hra.zastava_4', { p1: esc(p.zastava) })
          : p.zastava_podil
            ? tx('hra.zastava_4', { p1: tx('veta.pct_firmy_do_zastavy', { p1: Math.round(p.zastava_podil * 100) }) })
            : esc(tx('hra.bez_zastavy_4'))) + '</p>'
      + '<div class="row"><span class="muted small">' + (dluzim ? esc(tx('hra.zaplatil_jsi')) : esc(tx('hra.zaplatil_ti')))
      + '</span><span>' + kcFull(p.zaplaceno) + ' z ' + kcFull(p.celkem) + '</span></div>'
      + '<div class="row"><span class="muted small">' + (dluzim ? esc(tx('hra.dalsi_splatka')) : esc(tx('hra.dalsi_prijem'))) + '</span>'
      + '<span>' + kcFull(p.splatka) + ' ' + zaKolik(p.dalsi) + '</span></div>'
      + ((p.zastava || p.zastava_podil)
          ? '<p class="fine ' + (dluzim ? 'err' : 'ok') + '">' + (dluzim
              ? esc(tx('hra.staci_jedna_nezaplacena_splatka_a'))
              : p.zastava_podil
                ? esc(tx('hra.jedna_nezaplacena_splatka_a_podil'))
                : esc(tx('hra.jedna_nezaplacena_splatka_a_zastava'))) + '</p>'
          : p.zmeskano
            ? '<p class="small err" style="margin-top:6px">' + esc(tx('hra.zmeskane_splatky')) + ' ' + tx('hra.ze_tri', { p1: p.zmeskano })
              + (dluzim ? esc(tx('hra.po_treti_se_zbytek_dluhu'))
                : esc(tx('hra.po_treti_se_dluh_vymaha'))) + '</p>'
            : '')
      + (dluzim && p.doplatek > 0
          ? tx('hra.div_class_akce_button_class_btn', { p1: p.id, p2: p.doplatek, p3: kcFull(p.doplatek) })
          : '')
      // Odklad si řekne dlužník sám. Má cenu ho nabízet, i když zrovna
      // nic nezmeškal — kdo ví dopředu, že na příští splátku nemá, má
      // zkusit domluvu dřív, než mu propadne zástava.
      + (dluzim
          ? '<div class="akce"><button class="btn sm sec" data-odklad="' + p.id
            + '" data-kdo="' + esc(p.kdo_id || '') + '">'
            + esc(tx('hra.pozadat_o_odklad')) + '</button></div>'
          : '')
      + '</div>';
  });
  (f.podily || []).filter(bezici).forEach(function (e) {
    var mam = e.moje === 'mam';
    h += '<div class="trade"><div class="row"><b>' + Math.round(e.podil * 100) + ' % '
      + (mam ? tx('hra.ve_firme', { p1: esc(e.kdo_firma || e.kdo) }) : tx('hra.tve_firmy_drzi', { p1: esc(e.kdo) })) + '</b>'
      + '<b>' + kcFull(e.cena) + '</b></div>'
      + '<p class="muted small" style="margin:2px 0 6px">'
      + (e.vyplaceno >= 0 ? esc(tx('hra.zatim_vyplaceno')) + ' ' : esc(tx('hra.zatim_doplaceno')) + ' ') + tx('veta.dalsi_vyrovnani_p_div_class_akce', { p1: kcFull(Math.abs(e.vyplaceno)), p2: zaKolik(e.dalsi), p3: e.id })
      + (mam ? esc(tx('hra.nabidnout_odkup')) : esc(tx('hra.odkoupit_zpet'))) + '</button>'
      + (mam ? '<button class="btn sm sec" data-prevod="' + e.id + '">' + esc(tx('hra.prodat_jinemu')) + '</button>' : '')
      + '</div>'
      + '</div>';
  });
  return h + '</div>';
}
function bindFinance() {
  [].forEach.call($('burza-body').querySelectorAll('[data-odklad]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-odklad'));
      var p = ((FINANCE && FINANCE.pujcky) || []).filter(function (x) { return x.id === id; })[0];
      if (p) odkladSheet(p);
    };
  });
  [].forEach.call($('burza-body').querySelectorAll('[data-splatit]'), function (b) {
    b.onclick = function () { splatitSheet(b.getAttribute('data-splatit'), Number(b.getAttribute('data-castka'))); };
  });
  [].forEach.call($('burza-body').querySelectorAll('[data-odkup]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-odkup'));
      var e = ((FINANCE && FINANCE.podily) || []).filter(function (x) { return x.id === id; })[0];
      if (e) odkupSheet(e);
    };
  });
  bindPrevod('burza-body');
}

// Konkurzní rozprodej — kdo zkrachoval, toho majetek je tu měsíc za klesající cenu.
var AUKCE = null;
function loadAukce(then) {
  api('/trade/aukce').then(function (r) { AUKCE = (r.ok && r.j.aukce) || []; if (then) then(); })
    .catch(function () { AUKCE = []; if (then) then(); });
}
function aukceHtml() {
  if (!AUKCE || !AUKCE.length) return '';
  return '<div class="card"><h3>' + tx('veta.h3_p_class_muted_small_style_8', { p1: esc(tx('hra.konkurzni_rozprodej')) })
    + AUKCE.map(function (a) {
        return '<div class="trade"><div class="row"><b>' + tx('hra.b_b_class_ok_b_div', { p1: esc(a.popis), p2: kcFull(a.cena), p3: esc(a.nick), p4: kcFull(a.hodnota) }) + etaText(new Date(a.konci).getTime() - Date.now()) + '</p>'
          + (a.moje ? '<p class="fine">' + esc(tx('hra.tohle_je_tvuj_majetek_z')) + '</p>'
            : S.cash < a.cena ? tx('veta.p_class_fine_err_chybi_ti', { p1: kcFull(a.cena - S.cash) })
            : tx('veta.button_class_btn_sm_data_aukce', { p1: a.id, p2: kcFull(a.cena) }))
          + '</div>';
      }).join('')
    + '</div>';
}
function bindAukce() {
  [].forEach.call(document.querySelectorAll('[data-aukce]'), function (b) {
    b.onclick = function () {
      b.disabled = true; b.textContent = esc(tx('hra.kupuju'));
      apiJson('/trade/aukce/' + b.getAttribute('data-aukce') + '/koupit', {}).then(function (r) {
        if (!r.ok) { b.disabled = false; return toast(r.j.error || esc(tx('hra.nepovedlo_se_21')), 'err'); }
        toast(tx('veta.koupeno_za', { p1: kcFull(r.j.cena) }), 'ok');
        S.mrchozrout = true; save();
        loadAukce(function () { vyzvedniNasledky(); paintBurza(); });
      }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida_36')), 'err'); });
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
  // Jen ikona — na popisek „Tržiště" není v jedné řadě nad mapou místo.
  // Kolik je na prodej, řekne bublinka v rohu; prázdné tržiště je bez ní.
  el.innerHTML = '<i>\uD83E\uDD1D</i>' + (kolik ? '<b>' + kolik + '</b>' : '');
  el.title = kolik
    ? tx('veta.trziste_na_prodej', { p1: kolik, p2: mn(kolik, esc(tx('hra.hotova_provozovna')), esc(tx('hra.hotove_provozovny')), esc(tx('hra.hotovych_provozoven'))) }): esc(tx('hra.trziste_zrovna_nikdo_nic_nenabizi'));
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
    return 'za ' + d + ' ' + mn(d, 'den', 'dny', esc(tx('hra.dni_2')));
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
      + '<div class="trh-hl"><b>' + esc(n.name || esc(tx('hra.misto_5'))) + '</b>'
      + '<b class="' + (moje ? 'warn' : 'ok') + '">' + kcFull(n.cena) + '</b></div>'
      + '<i>' + esc(m.name) + (moje ? '' : ' · ' + esc(n.firma || n.nick)) + '</i>'
      + '<i>' + (moje ? tx('hra.vydelava_ti', { p1: kcFull(n.zisk) })
                      : 'u tebe ' + kcFull(Math.round(trhZiskUMe(n).profit)))
      + tx('veta.mesic_konci_i_button_class_btn', { p1: konci }) + (moje ? 'sec ' : '') + 'sm" style="width:100%;margin-top:7px" '
      + (moje ? 'data-trh-stop="' + n.id + '">' + esc(tx('hra.stahnout_z_nabidky_4')) : 'data-trh-n="' + n.id + '">' + esc(tx('hra.prohlednout_a_koupit')))
      + '</button>'
    + '</div></div>';
}
function trhSeznamSheet() {
  var vse = TRH || [];
  var cizi = vse.filter(function (n) { return !n.moje; });
  var moje = vse.filter(function (n) { return n.moje; });
  sheet(tx('veta.h3_h3_p_class_muted_small_7', { p1: esc(tx('hra.trziste')), p2: esc(tx('hra.hotove_provozovny_stroj_najemni_smlouva')), p3: Math.round(TRH_SPOLUUCAST * 100) })
    + (cizi.length
        ? '<div class="trh-seznam">' + cizi.map(function (n) { return trhPolozka(n, false); }).join('') + '</div>'
        : '<p class="muted small" style="margin-top:12px">' + esc(tx('hra.zrovna_tu_nikdo_nic_nenabizi')) + '</p>')
    + (moje.length
        ? '<h3 style="margin:18px 0 6px">' + esc(tx('hra.tvoje_nabidky')) + '</h3>'
          + '<p class="muted small" style="margin:0 0 8px">' + esc(tx('hra.dokud_se_neprodaji_vydelavaji_dal')) + '</p>'
          + '<div class="trh-seznam">' + moje.map(function (n) { return trhPolozka(n, true); }).join('') + '</div>'
        : '')
    + ((S.units || []).length
        ? '<button class="btn" id="trh-nabidnout-2" style="width:100%;margin-top:14px">'
          + (moje.length ? esc(tx('hra.nabidnout_dalsi_pradlomat')) : esc(tx('hra.nabidnout_vlastni_pradlomat'))) + '</button>'
        : '')
    + (drazbaBezi()
        ? '<button class="btn" id="trh-drazba-bezi" style="width:100%;margin-top:8px">'
          + esc(tx('hra.u_1f528_zrovna_se_drazi')) + '</button>'
        : '<button class="btn sec" id="trh-drazba" style="width:100%;margin-top:8px">'
          + esc(tx('hra.u_1f528_vyvolat_drazbu')) + '</button>'));
  if ($('trh-drazba')) $('trh-drazba').onclick = drazbaVyvolatSheet;
  if ($('trh-drazba-bezi')) $('trh-drazba-bezi').onclick = drazbaSheet;
  [].forEach.call($('sheet-body').querySelectorAll('[data-trh-n]'), function (b) {
    b.onclick = function () {
      var n = (TRH || []).filter(function (x) { return String(x.id) === b.getAttribute('data-trh-n'); })[0];
      if (n) trhKoupitSheet(n);
    };
  });
  [].forEach.call($('sheet-body').querySelectorAll('[data-trh-stop]'), function (b) {
    b.onclick = function () {
      b.disabled = true; b.textContent = esc(tx('hra.stahuju'));
      apiJson('/trade/trh/' + b.getAttribute('data-trh-stop') + '/stahnout', {}).then(function (r) {
        if (!r.ok) { b.disabled = false; b.textContent = esc(tx('hra.stahnout_z_nabidky_2'));
          return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_22')), 'err'); }
        toast(esc(tx('hra.nabidka_stazena_2')), 'ok');
        loadTrh(function () { drawMap(); trhSeznamSheet(); });
      }).catch(function () { b.disabled = false; b.textContent = esc(tx('hra.stahnout_z_nabidky_3'));
        toast(esc(tx('hra.server_neodpovida_14')), 'err'); });
    };
  });
  var nb = $('trh-nabidnout-2');
  if (nb) nb.onclick = trhVyberSheet;
}

// Výběr, který prádlomat chci vystavit — ať se to nemusí hledat po mapě.
function trhVyberSheet() {
  var u = (S.units || []).slice();
  if (!u.length) return toast(esc(tx('hra.nemas_co_nabidnout_zatim_nic')), 'err');
  sheet(tx('veta.h3_h3_p_class_muted_small_21', { p1: esc(tx('hra.ktery_pradlomat_nabidnout')) })
    + u.map(function (x) {
        var n = trhMoje(x.spotId);
        return '<button class="btn sec" style="width:100%;text-align:left" data-trh-u="' + esc(x.spotId) + '">'
          + '<b>' + esc(x.name) + '</b> · ' + esc((MODELS[x.eco.model] || {}).name || '')
          + tx('hra.mesic_34', { p1: kcFull(x.eco.profit) })
          + (n ? tx('veta.br_i_class_muted_small_uz', { p1: kcFull(n.cena) }) : '')
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
    f.duvod = tx('veta.banka_chce_spoluucast_aspon', { p1: tx('veta.a_tolik_hotovosti_nemas', { p1: kcFull(minVlastni), p2: Math.round(TRH_SPOLUUCAST * 100) }) });
  }
  return f;
}
function trhKoupitSheet(n) {
  var m = MODELS[n.model] || { name: n.model };
  var f = trhFinance(n, null);
  var muj = Math.round(trhZiskUMe(n).profit);
  var navratnost = muj > 0 ? (n.cena / (muj * 12)) : null;
  sheet(tx('veta.h3_h3_p_class_muted_small_10', { p1: esc(n.name || esc(tx('mapa.misto_2'))), p2: esc(m.name), p3: esc(n.firma || n.nick) }) + etaText(new Date(n.konci).getTime() - Date.now()) + '</p>'
    + '<div class="card" style="margin-top:12px">'
      + '<div class="kv"><span>' + esc(tx('hra.cena_3')) + '</span><b>' + kcFull(n.cena) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('mapa.u_tebe_vydela')) + '</span><b class="' + (muj > 0 ? 'ok' : 'err') + '">'
        + kcFull(muj) + ' ' + esc(tx('hra.mesic_19')) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('mapa.u_prodavajiciho_vydelava')) + '</span><b>' + kcFull(n.zisk) + ' ' + esc(tx('hra.mesic_20')) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('mapa.z_toho_najem')) + '</span><b>' + kcFull(n.rent) + ' ' + esc(tx('hra.mesic_21')) + '</b></div>'
      + (navratnost ? '<div class="kv"><span>' + esc(tx('mapa.navratnost_2')) + '</span><b>'
          + (Math.round(navratnost * 10) / 10).toString().replace('.', desZnak()) + ' roku</b></div>' : '')
      + (Math.abs(muj - n.zisk) > Math.max(500, n.zisk * 0.08)
          ? '<p class="fine warn">' + esc(tx('hra.cisla_se_lisi_protoze_navstevnost')) + ' '
            + esc(tx('hra.pocitej_s_tim_svym')) + '</p>' : '')
      + '<p class="fine">' + esc(tx('hra.dostanes_stroj_najemni_smlouvu_pripojky')) + ' '
      + esc(tx('hra.vydelava_od_prvni_minuty_na')) + '</p>'
    + '</div>'
    + '<div class="card">'
      + '<div class="kv"><span>' + esc(tx('mapa.zaplatis_ze_sveho')) + '</span><b>' + kcFull(f.own) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('mapa.doplati_banka')) + '</span><b class="' + (f.need ? 'warn' : '') + '">'
        + kcFull(f.need) + '</b></div>'
      + (f.need ? '<div class="kv"><span>' + esc(tx('mapa.splatka')) + '</span><b>'
          + kcFull(anuita(f.need, Math.max(0.02, rateOf() + prirazkaZa(f.need)), UVER_MESICU))
          + ' ' + esc(tx('hra.mesic_22')) + '</b></div>' : '')
      + tx('veta.p_class_fine_banka_tohle_bere', { p1: Math.round(TRH_SPOLUUCAST * 100), p2: kcFull(f.minVlastni) })
    + (f.ok
        ? tx('veta.button_class_btn_big_id_trh', { p1: kcFull(n.cena) })
        : '<p class="fine err">' + esc(f.duvod || esc(tx('mapa.na_tohle_banka_nepujci'))) + '</p>'));
  var g = $('trh-go');
  if (g) g.onclick = function () {
    g.disabled = true; g.textContent = esc(tx('hra.kupuju_2'));
    apiJson('/trade/trh/' + n.id + '/koupit', {}).then(function (r) {
      if (!r.ok) {
        g.disabled = false; g.textContent = tx('veta.koupit_za', { p1: kcFull(n.cena) });
        return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_23')), 'err');
      }
      // Celou cenu strhne doručenka ze serveru. Z našeho tu přibude jen to, co
      // na nákup půjčila banka — jinak by hráč platil i tu část, kterou nedal.
      var f2 = trhFinance(n, null);
      if (f2.need > 0) {
        S.bank -= f2.need;
        pricistDluh(f2.need, prirazkaZa(f2.need), { druh: 'misto', spotId: n.spot_id,
          popis: tx('veta.pradlomat_z_trziste', { p1: (n.name || '') }) });
        S.cash += f2.need;
        zapis('uver', tx('veta.uver_na_pradlomat_z_trziste', { p1: (n.name || '') }), f2.need);
      }
      save();
      closeSheet();
      toast(tx('veta.koupeno_je_tvuj_a_hned_vydelava', { p1: (n.name || esc(tx('mapa.pradlomat'))) }), 'ok');
      loadTrh(function () { vyzvedniNasledky(function () { loadClaims(); paintBurza(); }); });
    }).catch(function () {
      g.disabled = false; g.textContent = tx('veta.koupit_za', { p1: kcFull(n.cena) });
      toast(esc(tx('mapa.server_neodpovida_3')), 'err');
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
    return m + ' ' + mn(m, esc(tx('hra.herni_mesic_4')), esc(tx('hra.herni_mesice_3')), esc(tx('hra.hernich_mesicu_3')));
  }
  var roky = mesicu / 12;
  var cele = Math.round(roky);
  if (Math.abs(roky - cele) < 0.05) return cele + ' ' + mn(cele, 'rok', 'roky', 'let');
  return cisloM(Math.round(roky * 10) / 10) + ' roku';
}
function rozvahaHtml(r) {
  return tx('veta.div_class_card_div_class_row', { p1: esc(tx('hra.co_te_to_stalo')), p2: kcFull(r.vlozeno), p3: esc(tx('hra.stroj_2')), p4: kcFull(r.stroj), p5: esc(tx('hra.pripojky_a_instalace')), p6: kcFull(r.pripojky), p7: (r.obhlidka ? '<div class="kv"><span>' + esc(tx('hra.obhlidka_mista')) + '</span><b>' + kcFull(r.obhlidka) + '</b></div>' : ''), p8: (r.pozemek ? '<div class="kv"><span>' + esc(tx('hra.pozemek_a_priprava_plochy')) + '</span><b>' + kcFull(r.pozemek) + '</b></div>' : ''), p9: esc(tx('hra.co_to_zatim_vydelalo')), p10: (r.vydelal >= 0 ? 'ok' : 'err'), p11: kcFull(r.vydelal), p12: dobaProvozu(r.mesicu), p13: (r.vady ? ' · ' + r.vady + ' ' + mn(r.vady, 'porucha', 'poruchy', 'poruch') : ''), p14: esc(tx('hra.obrat_2')), p15: kcFull(r.obrat), p16: esc(tx('hra.najem_2')), p17: kcFull(r.najem), p18: esc(tx('hra.energie')), p19: kcFull(r.energie), p20: esc(tx('hra.servis_a_uklid')), p21: kcFull(r.servis), p22: esc(tx('hra.odhad_z_mesicnich_cisel_a')), p23: esc(tx('hra.doba_kdy_stal_porouchany_je')), p24: esc(tx('hra.kde_je_nula')), p25: (r.nula > 0 ? 'warn' : 'ok'), p26: (r.nula > 0 ? kcFull(r.nula) : esc(tx('hra.uz_je_zaplaceny'))), p27: (r.nula > 0
        ? tx('veta.tolik_z_vlozenych_penez_se_ti')
        : esc(tx('hra.provoz_uz_vlozene_penize_vratil'))), p28: (r.dluh ? '<div class="kv" style="margin-top:8px"><span>' + esc(tx('hra.zbyva_splatit_uver_na_miste')) + '</span>'
        + '<b class="err">' + kcFull(r.dluh) + '</b></div>'
        + '<p class="fine">' + esc(tx('hra.uver_prodejem_nezmizi_zustava_tobe')) + '</p>' : '') });
}

// Nabídnutí vlastního prádlomatu na tržiště.
function trhProdejSheet(u) {
  var bezi = trhMoje(u.spotId);
  if (bezi) {
    sheet(tx('veta.h3_h3_p_class_muted_small_9', { p1: esc(tx('hra.na_trzisti')), p2: esc(jmenoStroje(u.name)), p3: kcFull(bezi.cena) }) + etaText(new Date(bezi.konci).getTime() - Date.now()) + '. '
      + esc(tx('hra.do_te_doby_pradlomat_normalne')) + '</p>'
      + '<button class="btn sec" id="trh-stop" style="width:100%;margin-top:12px">' + esc(tx('hra.stahnout_z_nabidky')) + '</button>');
    var st = $('trh-stop');
    if (st) st.onclick = function () {
      st.disabled = true;
      apiJson('/trade/trh/' + bezi.id + '/stahnout', {}).then(function (r) {
        if (!r.ok) { st.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_24')), 'err'); }
        loadTrh(function () { closeSheet(); unitSheet(u); });
        toast(esc(tx('hra.nabidka_stazena')), 'ok');
      }).catch(function () { st.disabled = false; toast(esc(tx('hra.server_neodpovida_6')), 'err'); });
    };
    return;
  }
  if (S.trhVolba == null) S.trhVolba = { mesicu: 3 };
  var cena = trhNavrhCeny(u);
  var r = rozvahaMista(u);
  var vykresli = function () {
    sheet(tx('veta.h3_h3_p_class_muted_small_8', { p1: esc(tx('hra.nabidnout_na_trzisti')), p2: esc(jmenoStroje(u.name)), p3: rozvahaHtml(r), p4: esc(tx('hra.vydela_mesicne')), p5: kcFull(u.eco.profit), p6: kcFull(Math.round(u.eco.profit * 12)) })
        + (splatkyMista(u.spotId) ? '<div class="kv"><span>' + esc(tx('hra.splatky_na_miste')) + '</span><b class="warn">'
            + kcFull(splatkyMista(u.spotId)) + ' ' + esc(tx('hra.mesic_18')) + '</b></div>' : '')
      + tx('veta.div_p_class_muted_small_style', { p1: cena, p2: kcFull(trhNavrhCeny(u)), p3: esc(tx('hra.co_jsi_do_mista_dal')), p4: esc(tx('hra.cena_je_na_tobe_kupujici')) })
      + (r.nula > 0 ? tx('hra.pod_bys_prodelal', { p1: kcFull(r.nula) }) : ' ' + esc(tx('hra.cokoli_utrzis_je_cisty_zisk'))) + '</p>'
      + '<p class="muted small" style="margin:12px 0 4px"><b>' + esc(tx('hra.jak_dlouho_ma_nabidka_viset')) + '</b></p>'
      + '<div class="seg sub najem-seg">' + TRH_MESICE.map(function (mm) {
          return '<button class="' + (mm === S.trhVolba.mesicu ? 'on' : '') + tx('hra.data_trh_m_mes_button', { p1: mm, p2: mm });
        }).join('') + tx('veta.div_p_class_fine_hernich_mesicu', { p1: S.trhVolba.mesicu, p2: Math.round(S.trhVolba.mesicu * 12), p3: esc(tx('hra.vystavit_na_trzisti')), p4: esc(tx('hra.jakmile_nekdo_koupi_penize_mas')), p5: esc(tx('hra.uver_ktery_na_miste_visi')) }));
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
      if (!(c >= 1000)) return toast(esc(tx('hra.cena_musi_byt_aspon_1')), 'err');
      d.disabled = true; d.textContent = esc(tx('hra.vystavuju'));
      apiJson('/trade/trh', { spot_id: u.spotId, cena: c, mesicu: S.trhVolba.mesicu,
        zisk: Math.round(u.eco.profit), obrat: Math.round(u.eco.revenue),
        investice: Math.round((u.eco && u.eco.invest) || 0),
        kind: u.kind, score: u.score, plan: planMista(zakladniSpotId(u.spotId)) || null
      }).then(function (r) {
        if (!r.ok) {
          d.disabled = false; d.textContent = esc(tx('hra.vystavit_na_trzisti_2'));
          return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_25')), 'err');
        }
        loadTrh(function () { closeSheet(); paint(); });
        toast(tx('veta.vystaveno_na_trzisti_za', { p1: kcFull(c) }), 'ok');
      }).catch(function () {
        d.disabled = false; d.textContent = esc(tx('hra.vystavit_na_trzisti_3'));
        toast(esc(tx('hra.server_neodpovida_7')), 'err');
      });
    };
  };
  vykresli();
}

function paintBurza() {
  var box = $('burza-body');
  if (!TRADES) { box.innerHTML = '<p class="muted small">' + esc(tx('drazba.nacitam')) + '</p>'; return loadTrades(paintBurza); }
  var ceka = TRADES.filter(function (t) { return t.stav === 'ceka'; });
  // Nabídka, ze které vznikl protinávrh, není uzavřená — řeší se dál v tom
  // novém. Mezi hotové patří až tehdy, když někdo řekne ano nebo ne.
  var hotove = TRADES.filter(function (t) {
    return t.stav !== 'ceka' && t.stav !== 'protinavrh';
  }).slice(0, 20);
  var naMe = ceka.filter(function (t) { return t.na_tahu; });
  var odeslane = ceka.filter(function (t) { return !t.na_tahu; });

  if (AUKCE == null) loadAukce(paintBurza);

  if (FINANCE == null) loadFinance(paintBurza);

  if (KRIZE == null) loadKrize(paintBurza);

  if (PREVZETI == null) loadPrevzeti(paintBurza);

  // Co čeká na odpověď hráče, je to nejdůležitější — když tam něco je, patří to
  // úplně nahoru, ještě před aukce a finance. Prázdná sekce zůstává na svém místě.
  var naMeHtml = sekce(esc(tx('drazba.ceka_na_tvoji_odpoved')), naMe, esc(tx('drazba.nikdo_ti_ted_nic_nenabizi')));
  box.innerHTML = (naMe.length ? naMeHtml : '')
    + mojeKrizeHtml()
    + prevzetiHtml()
    + aukceHtml()
    + financeHtml()
    + krizeHtml()
    + (naMe.length ? '' : naMeHtml)
    + sekce(esc(tx('drazba.cekas_na_odpoved')), odeslane, esc(tx('drazba.nemas_rozjednanou_zadnou_nabidku')))
    + (hotove.length ? sekce(esc(tx('drazba.uzavrene')), hotove, '') : '');
  bindAukce();
  bindFinance();
  [].forEach.call(box.querySelectorAll('[data-prevzeti-zrus]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-prevzeti-zrus'));
      b.disabled = true;
      apiJson('/trade/prevzeti/' + id + '/zrusit', {}).then(function (r) {
        if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
        PREVZETI = null; loadTrades(paintBurza);
        toast(esc(tx('prevzeti.stazena')), 'ok', true);
      }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
    };
  });
  [].forEach.call(box.querySelectorAll('[data-prevzeti]'), function (b) {
    b.onclick = function () {
      var id = Number(b.getAttribute('data-prevzeti'));
      var t = (PREVZETI || []).filter(function (x) { return x.id === id; })[0];
      if (t) prevzetiSheet(t);
    };
  });
  [].forEach.call(box.querySelectorAll('[data-krize-pujcit]'), function (b) {
    b.onclick = function () {
      var id = parseInt(b.getAttribute('data-krize-pujcit'), 10);
      var x = ((KRIZE && KRIZE.firmy) || []).filter(function (y) { return y.id === id; })[0];
      if (!x) return;
      // Nabídka půjčky je ta, co ve hře dávno je — jen se otevře rovnou
      // na tom, komu chybí peníze.
      majetekSheet(x.id, 'pujcka');
    };
  });

  [].forEach.call(box.querySelectorAll('[data-tr]'), function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-tr'), co = b.getAttribute('data-akce');
      var t = TRADES.filter(function (x) { return String(x.id) === id; })[0];
      if (co === 'counter') return protinavrhSheet(t);
      // Věřitel si zástavu vymínil — ať dlužník ví, co dává v sázku, dřív než kývne.
      if (co === 'accept' && t.predmet === 'pujcka'
        && (t.data || {}).zadam_zastavu && !(t.data || {}).zastava) return zastavaSheet(t);
      // Platím-li já, ať to nepadne až na serveru. U půjčky platí věřitel.
      var jaPlatim = jaPlatimNabidku(t);
      if (co === 'accept' && jaPlatim && t.cena > S.cash) {
        return toast(tx('veta.na_tohle_nemas_hotovost_chybi', { p1: kcFull(t.cena - S.cash) }), 'err');
      }
      var proved = function () {
        b.disabled = true;
        apiJson('/trade/' + id + '/' + co, {}).then(function (r) {
          if (!r.ok) { b.disabled = false; return toast(r.j.error || esc(tx('hra.nepovedlo_se_26')), 'err'); }
          toast(co === 'accept' ? esc(tx('drazba.obchod_uzavren')) : esc(tx('drazba.nabidka_zamitnuta')), 'ok');
          if (co === 'accept') { vyzvedniNasledky(); FINANCE = null; }
          loadTrades(paintBurza);
        }).catch(function () { b.disabled = false; toast(esc(tx('drazba.server_neodpovida_3')), 'err'); });
      };
      // Prodávám většinu vlastní firmy — tohle si nikdo nesmí odkliknout omylem.
      if (co === 'accept' && t.predmet === 'podil' && (t.data || {}).vetsina && !jaPlatim) {
        return vetsinaSheet(t, proved);
      }
      proved();
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
  var protistrana = t.moje ? (t.komu.firma || t.komu.nick) : (t.od.firma || t.od.nick);
  var veta = t.moje
    ? (t.smer === 'koupim' ? tx('veta.chces_koupit_od', { p1: esc(protistrana) }): tx('veta.nabizis', { p1: esc(protistrana) }))
    : (t.smer === 'koupim' ? esc(protistrana) + ' ' + esc(tx('hra.chce_koupit_od_tebe')) : tx('veta.ti_nabizi', { p1: esc(protistrana) }));
  // U půjčky platí ten, kdo peníze dává — tedy „prodávající".
  if (t.predmet === 'pujcka') jaKupuji = !jaKupuji;
  if (t.predmet === 'pujcka') {
    // „koupim" znamená, že si o půjčku žádá ten, kdo nabídku poslal.
    veta = t.moje
      ? (t.smer === 'koupim' ? tx('veta.zadas_o_pujcku', { p1: esc(protistrana) }): tx('veta.nabizis_pujcku', { p1: esc(protistrana) }))
      : (t.smer === 'koupim' ? tx('veta.te_zada_o_pujcku', { p1: esc(protistrana) }): tx('veta.ti_nabizi_pujcku', { p1: esc(protistrana) }));
  }
  return '<div class="trade' + (t.na_tahu ? ' na-tahu' : '') + '">'
    + '<h4>' + esc(predmetPopis(t)) + '</h4>'
    + '<p class="kdo">' + veta + ' · ' + (jaKupuji ? esc(tx('hra.platis_ty')) : esc(tx('hra.plati_on'))) + '</p>'
    + (t.predmet === 'pujcka'
      ? '<div class="row"><span class="muted small">' + esc(tx('hra.splatka_za_herni_mesic_2')) + '</span><span>'
        + kcFull((t.data || {}).splatka || 0) + '</span></div>'
        + '<div class="row"><span class="muted small">' + esc(tx('hra.zastava_2')) + '</span><span' 
        + (zastavaChybi(t.data) ? ' class="warn"' : '') + '>'
        + zastavaPopis(t.data) + '</span></div>'
      : '')
    + '<div class="row"><span class="muted small">' + esc(tx('hra.cena_4')) + '</span><span class="cena">' + esc(cenaPopis(t)) + '</span></div>'
    + (t.vzkaz ? '<p class="muted small" style="margin-top:6px">„' + esc(t.vzkaz) + '"</p>' : '')
    + nekrytoHtml(t)
    + (t.stav !== 'ceka' ? '<p style="margin-top:8px"><span class="stav ' + esc(t.stav) + '">' + esc(stavNabidky(t.stav)) + '</span></p>' : '')
    + jakToDopadloHtml(t)
    + (t.na_tahu
      ? '<div class="akce"><button class="btn sm" data-tr="' + t.id + '" data-akce="accept">' + esc(tx('hra.prijmout')) + '</button>'
        + '<button class="btn sm sec" data-tr="' + t.id + '" data-akce="counter">' + esc(tx('hra.protinavrh_2')) + '</button>'
        + '<button class="btn sm sec" data-tr="' + t.id + '" data-akce="decline">' + esc(tx('hra.odmitnout')) + '</button></div>'
      : t.stav === 'ceka' && t.moje
        ? '<div class="akce"><button class="btn sm sec" data-tr="' + t.id + '" data-akce="decline">' + esc(tx('hra.zrusit_nabidku')) + '</button></div>'
        : '')
    + '</div>';
}

// Prodat podíl dál, třetímu hráči. Podíl je majetek investora jako každý
// jiný — firma do převodu nemluví, jen se jí změní jméno v rejstříku. Pro
// kupujícího začíná výnos od nuly: pořizovací cena je ta, za kterou koupil on.
function prevodSheet(e) {
  hraciVyberSheet(esc(tx('hra.komu_podil_prodas')), esc(tx('hra.vybrat')), function (id, h) {
    if (id === e.kdo_id) {
      return toast(esc(tx('hra.majiteli_firmy_se_podil_vraci')), 'err');
    }
    prevodCenaSheet(e, id, h);
  });
}
function prevodCenaSheet(e, komuId, komu) {
  var kdo = komu ? (komu.firma || komu.nick) : esc(tx('drazba.vybranemu_hraci'));
  // Pustit jde i kus podílu — po procentech, stejně jako v dražbě.
  var maxPct = Math.round(e.podil * 1000) / 10;
  var krok = maxPct < 1 ? 0.1 : 1;
  sheet(tx('veta.h3_h3_p_class_muted_small_13', { p1: esc(tx('drazba.prodat_podil_dal')), p2: pctHra(e.podil), p3: esc(e.kdo_firma || e.kdo), p4: esc(kdo), p5: esc(tx('hra.plati_on_a_jen_kdyz')), p6: esc(tx('drazba.kolik_procent_pustis')), p7: Math.min(1, maxPct), p8: maxPct, p9: krok, p10: maxPct, p11: esc(tx('drazba.podil')), p12: pctHra(e.podil), p13: kcFull(e.cena), p14: esc(tx('drazba.zatim_ti_vyneslo')) })
    + (e.vyplaceno > 0 ? 'ok' : '') + '">' + kcFull(Math.abs(e.vyplaceno)) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('drazba.nese_mesicne')) + '</span><b id="prev-mesdil" class="'
    + (e.mesicne > 0 ? 'ok' : e.mesicne < 0 ? 'err' : '') + '">'
    + (e.mesicne > 0 ? '+' : '') + kcFull(e.mesicne) + '</b></div>'
    + '<label class="fld"><span>' + esc(tx('hra.cena_l')) + '</span>'
    + '<input id="prev-cena" class="inp" type="number" min="0" step="10000" value="'
    + (e.odkup || e.cena) + '"></label>'
    + '<p class="fine" id="prev-rada"></p>'
    + '<label class="fld"><span>' + esc(tx('drazba.vzkaz_nepovinny')) + '</span>'
    + '<input id="prev-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<button class="btn big" id="prev-ok" style="width:100%;margin-top:6px">' + esc(tx('drazba.poslat_nabidku')) + '</button>'
    + '<p class="fine">' + esc(tx('hra.nejblizsi_vyrovnani_dostane_cele_ten')) + ' '
    + esc(tx('hra.majitel_firmy_do_prevodu_nemluvi')) + '</p>');
  // Jaká část podílu se zrovna nabízí (0–1) a kolik z čísel na ni připadá.
  var castPodilu = function () {
    var p = Number($('prev-podil').value) || maxPct;
    return Math.max(0.0001, Math.min(1, (Math.round(p * 10) / 1000) / e.podil));
  };
  var rada = function () {
    var c = Math.max(0, Math.round(Number($('prev-cena').value) || 0)), t = [];
    var k = castPodilu();
    var porCena = Math.round(e.cena * k), porVypl = Math.round(e.vyplaceno * k);
    var porMes = Math.round(e.mesicne * k);
    if (porCena > 0) {
      var o = Math.round((c - porCena) / porCena * 100);
      t.push(o === 0 ? esc(tx('drazba.presne_za_to_za_co'))
        : o > 0 ? tx('veta.o_vic_nez_jsi_za_nej', { p1: o }): tx('veta.o_min_nez_jsi_za_nej', { p1: (-o) }));
      var cely = porVypl + (c - porCena);
      t.push(cely >= 0 ? tx('veta.i_s_vyplacenym_bys_na_nem_2', { p1: kcFull(cely) }): tx('veta.i_s_vyplacenym_bys_na_nem', { p1: kcFull(-cely) }));
    }
    if (porMes > 0) {
      t.push(tx('veta.roku_zpatky', { p1: tx('veta.kupujicimu_nese_mesicne_za_tuhle_cenu', { p1: kcFull(porMes) }), p2: (c / (porMes * 12)).toFixed(1).replace('.', desZnak()) }));
    } else if (porMes < 0) {
      t.push(esc(tx('drazba.pozor_firma_je_ted_ve')));
    }
    if (k < 0.9999) t.push(esc(tx('drazba.zbytek_ti_zustava')));
    $('prev-rada').textContent = t.join(' ');
  };
  // Ubereš procenta, uberou se i čísla pod nimi i navržená cena.
  var dlePodilu = function () {
    var k = castPodilu();
    $('prev-pct').textContent = pctHra(e.podil * k) + ' %';
    $('prev-pordil').textContent = kcFull(Math.round(e.cena * k));
    $('prev-vyndil').textContent = kcFull(Math.abs(Math.round(e.vyplaceno * k)));
    var m = Math.round(e.mesicne * k);
    $('prev-mesdil').textContent = (m > 0 ? '+' : '') + kcFull(m);
    $('prev-cena').value = Math.max(0, Math.round((e.odkup || e.cena) * k));
    rada();
  };
  $('prev-podil').oninput = dlePodilu;
  $('prev-cena').oninput = rada; rada();
  $('prev-ok').onclick = function () {
    var c = Math.max(0, Math.round(Number($('prev-cena').value) || 0)), b = $('prev-ok');
    if (!c) return toast(esc(tx('hra.zadej_cenu')), 'err');
    b.disabled = true;
    var pp = Number($('prev-podil').value) || maxPct;
    apiJson('/trade/offer', { to_id: komuId, predmet: 'prevod', equity_id: e.id,
      podil: Math.max(0.001, Math.min(e.podil, Math.round(pp * 10) / 1000)),
      smer: 'prodam', cena: c, vzkaz: $('prev-vzkaz').value })
      .then(function (r) {
        if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_27')), 'err'); }
        closeSheet(); TRADES = null; loadTrades(paintBurza);
        toast(esc(tx('drazba.nabidka_odeslana_ted_je_to')), 'ok');
      }).catch(function () { b.disabled = false; toast(esc(tx('drazba.server_neodpovida_2')), 'err'); });
  };
}

// Poslední brzda před prodejem většiny vlastní firmy. Hra prodej nezakazuje —
// je to majitelovo rozhodnutí — ale nenechá ho projít jedním kliknutím.
function vetsinaSheet(t, pak) {
  var d = t.data || {};
  var pct = Math.round((d.podil || 0) * 100);
  var po = Math.round((d.po_prodeji || d.podil || 0) * 100);
  var kdo = t.moje ? (t.komu.firma || t.komu.nick) : (t.od.firma || t.od.nick);
  sheet(tx('veta.h3_h3_p_class_muted_small_6', { p1: esc(tx('hra.u26a0_ufe0f_prodavas_vetsinu_firmy')), p2: esc(kdo), p3: po }) + (po > pct ? tx('veta.ted_ma', { p1: (po - pct) }) + tx('hra.kupuje_dalsich', { p1: pct }) : '')
    + tx('veta.vic_nez_polovinu_p_div_class', { p1: esc(tx('hra.prodavas')), p2: pct, p3: kcFull(t.cena), p4: esc(tx('hra.zustane_ti')), p5: Math.max(0, 100 - Math.round(podilProdano() * 100) - pct), p6: esc(tx('hra.zpatky_ji_dostanes_jen_tak')), p7: esc(tx('hra.vynutit_to_nejde_a_cenu')), p8: esc(tx('hra.rozumim_tomu_a_vetsinu_prodavam')), p9: esc(tx('hra.prijmout_nabidku')), p10: esc(tx('hra.zatim_ne')) }));
  $('vet-ne').onclick = closeSheet;
  $('vet-ok').onclick = function () {
    if (!$('vet-chk').checked) return toast(esc(tx('hra.nejdriv_to_odklikni')), 'err');
    closeSheet(); pak();
  };
}

// Zpětný odkup podílu. Není to tlačítko, které by to udělalo samo —
// je to nabídka jako každá jiná: souhlasit musí obě strany a cenu si řeknou.
function odkupSheet(e) {
  var majitel = e.moje === 'prodal';       // odkupuje majitel firmy
  sheet('<h3>' + (majitel ? esc(tx('drazba.odkoupit_podil_zpatky')) : esc(tx('drazba.nabidnout_podil_k_odkupu'))) + '</h3>'
    + '<p class="muted small">' + (majitel
        ? tx('veta.drzi_tve_firmy_posli_mu_nabidku', { p1: esc(e.kdo), p2: Math.round(e.podil * 100) }): tx('veta.drzis_firmy', { p1: Math.round(e.podil * 100), p2: esc(e.kdo_firma || e.kdo), p3: esc(tx('drazba.nabidni_jejimu_majiteli_at_si')) })) + '</p>'
    + '<div class="kv"><span>' + esc(tx('drazba.podil_2')) + '</span><b>' + Math.round(e.podil * 100) + ' %</b></div>'
    + '<div class="kv"><span>' + (majitel ? esc(tx('hra.prodal_jsi_ho_za')) : esc(tx('hra.koupil_jsi_ho_za'))) + '</span><b>'
    + kcFull(e.cena) + '</b></div>'
    + '<div class="kv"><span>' + (e.vyplaceno >= 0 ? esc(tx('drazba.zatim_vyplaceno')) : esc(tx('drazba.zatim_doplaceno'))) + '</span><b>'
    + kcFull(Math.abs(e.vyplaceno)) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('drazba.nese_mesicne_2')) + '</span><b class="' + (e.mesicne > 0 ? 'ok' : e.mesicne < 0 ? 'err' : '')
    + '">' + (e.mesicne > 0 ? '+' : '') + kcFull(e.mesicne) + '</b></div>'
    + '<label class="fld"><span>' + esc(tx('hra.cena_odkupu_l')) + '</span>'
    + '<input id="odk-cena" class="inp" type="number" min="0" step="10000" value="' + (e.odkup || e.cena) + '"></label>'
    + '<p class="fine" id="odk-rada"></p>'
    + '<label class="fld"><span>' + esc(tx('drazba.vzkaz_nepovinny_2')) + '</span><input id="odk-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<button class="btn big" id="odk-ok" style="width:100%;margin-top:6px">' + esc(tx('drazba.poslat_nabidku_2')) + '</button>'
    + '<p class="fine">' + esc(tx('drazba.rozhodne_druha_strana_nabidku_muze')) + '</p>'
    + (majitel ? volneHtml(null) : ''));
  var rada = function () {
    var c = Math.max(0, Math.round(Number($('odk-cena').value) || 0));
    var t = [];
    if (e.cena > 0) {
      var o = Math.round((c - e.cena) / e.cena * 100);
      t.push(o === 0 ? esc(tx('drazba.presne_za_to_za_co_2'))
        : o > 0 ? tx('veta.o_vic_nez_za_kolik_se', { p1: o }): tx('veta.o_min_nez_za_kolik_se', { p1: (-o) }));
    }
    if (e.mesicne > 0) {
      t.push(tx('veta.roku_zpatky_2', { p1: tx('veta.podilnikovi_nese_mesicne_za_nabizenou_cenu', { p1: kcFull(e.mesicne) }), p2: (c / (e.mesicne * 12)).toFixed(1).replace('.', desZnak()) }));
    }
    var el = $('odk-rada');
    el.className = majitel && c > volnaHotovost(null) ? 'fine err' : 'fine';
    el.textContent = (majitel && c > volnaHotovost(null)
      ? tx('veta.na_tohle_nemas_volnou_hotovost_chybi', { p1: kcFull(c - volnaHotovost(null)) }): '') + t.join(' ');
  };
  $('odk-cena').oninput = rada; rada();
  $('odk-ok').onclick = function () {
    var c = Math.max(0, Math.round(Number($('odk-cena').value) || 0)), b = $('odk-ok');
    if (!c) return toast(esc(tx('hra.zadej_cenu_2')), 'err');
    if (majitel && c > volnaHotovost(null)) {
      return toast(esc(tx('drazba.na_tohle_nemas_volnou_hotovost')), 'err');
    }
    b.disabled = true;
    apiJson('/trade/offer', { to_id: e.kdo_id, predmet: 'odkup', equity_id: e.id,
      smer: majitel ? 'koupim' : 'prodam', cena: c, vzkaz: $('odk-vzkaz').value })
      .then(function (r) {
        if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_28')), 'err'); }
        closeSheet(); TRADES = null; loadTrades(paintBurza);
        toast(esc(tx('drazba.nabidka_na_odkup_odeslana_ted')), 'ok');
      }).catch(function () { b.disabled = false; toast(esc(tx('drazba.server_neodpovida_4')), 'err'); });
  };
}

// Jak uzavřený obchod pokračuje. U půjčky i podílu se platí dál měsíce potom,
// co se ruka plácla — tady je vidět, kolik už proteklo a co ještě přijde.
function jakToDopadloHtml(t) {
  if (t.stav !== 'prijato' || !FINANCE) return '';
  if (t.predmet === 'pujcka') {
    var p = (FINANCE.pujcky || []).filter(function (x) { return x.trade_id === t.id; })[0];
    if (!p) return '';
    var dluzim = p.moje === 'dluzim';
    var pct = p.celkem > 0 ? Math.min(100, Math.round(p.zaplaceno / p.celkem * 100)) : 0;
    var konec = p.stav === 'splaceno' ? (dluzim ? esc(tx('hra.splaceno_mas_cisty_stit')) : esc(tx('hra.splacene_penize_mas_zpatky')))
      : p.stav === 'propadlo' ? (dluzim ? esc(tx('hra.nesplatil_jsi_to_a_propadla')) : esc(tx('hra.nesplatil_to_zastava_je_tvoje')))
      : p.stav === 'vymahano' ? (dluzim ? esc(tx('hra.nesplatil_jsi_to_zbytek_ti')) : esc(tx('hra.nesplatil_to_zbytek_se_vymohl')))
      : null;
    return '<div class="kv" style="margin-top:8px"><span class="muted small">'
      + (dluzim ? esc(tx('hra.zaplatil_jsi_2')) : esc(tx('hra.zaplatil_ti_2'))) + '</span><span>'
      + kcFull(p.zaplaceno) + ' z ' + kcFull(p.celkem) + '</span></div>'
      + '<div class="bar"><i style="width:' + pct + '%"></i></div>'
      + (konec
          ? '<p class="fine ' + (p.stav === 'splaceno' ? 'ok' : 'err') + '">' + konec + '</p>'
          : tx('veta.p_class_fine_zbyva', { p1: (p.mesicu - p.splaceno) }) + tx('veta.po_doplatit_naraz_by_ted_stalo', { p1: mn(p.mesicu - p.splaceno, esc(tx('hra.splatka_4')), esc(tx('hra.splatky')), esc(tx('hra.splatek'))), p2: kcFull(p.splatka), p3: kcFull(p.doplatek) }));
  }
  if (t.predmet === 'podil') {
    var e = (FINANCE.podily || []).filter(function (x) { return x.trade_id === t.id; })[0];
    if (!e) return '';
    var mam = e.moje === 'mam';
    return '<div class="kv" style="margin-top:8px"><span class="muted small">'
      + (e.vyplaceno >= 0 ? (mam ? esc(tx('hra.vyplaceno_tobe')) : esc(tx('hra.vyplatil_jsi'))) : (mam ? esc(tx('hra.doplatil_jsi')) : esc(tx('hra.doplatil_ti'))))
      + '</span><span>' + kcFull(Math.abs(e.vyplaceno)) + '</span></div>'
      + '<p class="fine' + (e.stav === 'odkoupeno' ? ' ok' : '') + '">'
      + (e.stav === 'odkoupeno' ? esc(tx('hra.podil_je_odkoupeny_zpatky_vyrovnano'))
        : esc(tx('hra.podil_bezi_dal_vyrovnava_se'))) + '</p>';
  }
  return '';
}

// Nabídka, na kterou plátce nemá: dokud se to nespraví, přijmout nejde.
function nekrytoHtml(t) {
  if (t.stav !== 'ceka' || !jaPlatimNabidku(t)) return '';
  // U vlastní nabídky počítáme i s tím, co drží ostatní vlastní nabídky.
  // U cizí stačí hotovost: přijmout ji buď jde, nebo ne.
  var volne = t.moje ? volnaHotovost(t.id) : S.cash;
  if ((t.cena || 0) <= volne) return '';
  return tx('veta.p_class_small_err_style_margin', { p1: (t.moje ? 'volnou hotovost' : 'hotovost'), p2: tx('veta.chybi_dokud_ji_nedas_dohromady_obchod', { p1: kcFull(t.cena - volne) }) });
}

// Výběr zástavy při přijetí půjčky, u které si ji věřitel vymínil.
function zastavaSheet(t) {
  var mista = (S.units || []).map(function (u) {
    return { id: u.spotId, name: u.name, pod: tx('veta.zisk_2', { p1: (MODELS[u.eco.model] || {}).name, p2: kcFull(u.eco.profit), p3: esc(tx('hra.mes_3')) }) };
  });
  if (!mista.length) {
    return toast(esc(tx('hra.veritel_chce_zastavu_ale_ty')) + ' '
      + esc(tx('hra.posli_protinavrh_a_domluv_se')), 'err', true);
  }
  sheet(tx('veta.h3_h3_p_class_muted_small_11', { p1: esc(tx('hra.cim_rucis')), p2: esc(t.od.firma || t.od.nick), p3: esc(tx('hra.zastava_3')) })
    + mista.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' — ' + esc(m.pod) + '</option>';
      }).join('') + '</select></label>'
    + '<div class="kv"><span>' + esc(tx('hra.pujcka')) + '</span><b>' + kcFull(t.cena) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.splatka_za_herni_mesic_3')) + '</span><b>' + kcFull((t.data || {}).splatka || 0) + '</b></div>'
    + '<button class="btn big" id="za-ok" style="width:100%;margin-top:10px">' + esc(tx('hra.prijmout_se_zastavou')) + '</button>');
  $('za-ok').onclick = function () {
    var b = $('za-ok'); b.disabled = true;
    apiJson('/trade/' + t.id + '/accept', { zastava: $('za-spot').value }).then(function (r) {
      if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_29')), 'err'); }
      closeSheet(); vyzvedniNasledky(); FINANCE = null; loadTrades(paintBurza);
      toast(esc(tx('hra.pujcka_prijata_splatky_chodi_kazdy')), 'ok');
    }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida_16')), 'err'); });
  };
}

// ─── Protinávrh ──────────────────────────────────────────────────────────────
function protinavrhSheet(t) {
  var vybrane = [];
  var d = t.data || {};
  // Protinávrh otáčí role: kdo kupoval, teď prodává. U půjčky se tím mění
  // i to, kdo platí a kdo ručí.
  var pujcka = t.predmet === 'pujcka';
  var podil = t.predmet === 'podil';
  var buduPlatit = pujcka ? t.smer === 'koupim' : t.smer === 'prodam';
  var buduDluznik = pujcka && !buduPlatit;
  var mojeMista = (S.units || []).map(function (u) {
    return { id: u.spotId, name: u.name + ' · ' + (MODELS[u.eco.model] || {}).name };
  });
  sheet(tx('veta.h3_h3_p_class_muted_small_17', { p1: esc(tx('hra.protinavrh')), p2: esc(predmetPopis(t)) })
    + (pujcka ? tx('veta.castku_urok_i_delka_zustavaji', { p1: (buduDluznik ? ' ' + esc(tx('hra.a_zastavu')) : '') })
      : podil ? esc(tx('hra.cenu_i_to_o_kolik')) : esc(tx('hra.jen_cenu'))) + '</p>'
    + '<div class="kv"><span>' + esc(tx('hra.puvodni_nabidka')) + '</span><b>' + esc(cenaPopis(t)) + '</b></div>'
    + (pujcka ? '<div class="kv"><span>' + esc(tx('hra.zastava')) + '</span><b' + (zastavaChybi(d) ? ' class="warn"' : '') + '>'
        + zastavaPopis(d) + '</b></div>'
      + (zastavaChybi(d) && buduDluznik
          ? '<p class="fine warn">' + esc(tx('hra.bez_vybrane_zastavy_tuhle_pujcku')) + '</p>' : '') : '')
    + '<label class="fld"><span>' + esc(tx('hra.co_nabizis_ty_l')) + '</span>'
    + '<input id="pn-cena" class="inp" type="number" min="0" step="1000" value="' + (t.cena || 0) + '"></label>'
    + (podil
        ? '<label class="fld"><span>' + esc(tx('hra.podil_v_2')) + '</span>'
          + '<input id="pn-podil" class="inp" type="number" inputmode="numeric" min="1" max="'
          + PODIL_MAX_HRA + '" value="' + Math.round((d.podil || 0) * 100) + '"></label>'
          + '<p class="fine" id="pn-podil-pop"></p>'
        : '')
    + (pujcka ? '<p class="fine" id="pn-splatka"></p>' : '')
    + (buduDluznik && mojeMista.length
        ? '<label class="fld"><span>' + esc(tx('hra.rucim_pradlomatem')) + '</span><select id="pn-zastava" class="inp">'
          + '<option value="-">' + esc(tx('hra.bez_zastavy_3')) + '</option>'
          + mojeMista.map(function (m) {
              return '<option value="' + esc(m.id) + '"' + (m.id === d.zastava ? ' selected' : '') + '>'
                + esc(m.name) + '</option>';
            }).join('')
          + '</select></label>'
        : '')
    + kartyVyber('pn')
    + '<label class="fld"><span>' + esc(tx('hra.vzkaz_nepovinny_3')) + '</span><input id="pn-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<p class="fine" id="pn-kryti"></p>'
    + '<button class="btn big" id="pn-ok">' + esc(tx('hra.poslat_protinavrh')) + '</button>'
    + (buduPlatit ? volneHtml(t.id) : ''));
  vybrane = bindKartyVyber('pn');
  var prepocti = function () {
    var c = Math.max(0, Math.round(Number($('pn-cena').value) || 0));
    if (podil && $('pn-podil-pop')) {
      var pp = Math.max(1, Math.min(PODIL_MAX_HRA, Math.round(Number($('pn-podil').value) || 0)));
      var puv = Math.round((d.podil || 0) * 100);
      $('pn-podil-pop').textContent = (pp === puv ? esc(tx('hra.procenta_beze_zmeny')) + ' '
          : tx('hra.puvodne_slo_o_ty_chces', { p1: puv, p2: pp }))
        + tx('veta.za_jedno_procento_to_vychazi_na', { p1: kcFull(Math.round(c / pp)) });
    }
    if (pujcka && $('pn-splatka')) {
      var sp = anuitaHra(c, (Number(d.urok) || 0) * 100, Math.max(1, Number(d.mesicu) || 1));
      $('pn-splatka').textContent = tx('veta.splatka_by_vysla_na', { p1: tx('veta.za_herni_mesic', { p1: kcFull(sp) }) });
    }
    var el = $('pn-kryti');
    if (!buduPlatit) { el.textContent = ''; return; }
    var volne = volnaHotovost(t.id);
    if (c > volne) {
      el.className = 'fine err';
      el.textContent = tx('veta.na_tohle_nemas_volnou_hotovost_chybi_2', { p1: kcFull(c - volne) });
    } else { el.className = 'fine'; el.textContent = ''; }
  };
  $('pn-cena').oninput = prepocti;
  if ($('pn-podil')) $('pn-podil').oninput = prepocti;
  prepocti();
  $('pn-ok').onclick = function () {
    var b = $('pn-ok');
    if (buduPlatit && (Number($('pn-cena').value) || 0) > volnaHotovost(t.id)) {
      return toast(esc(tx('hra.na_tohle_nemas_volnou_hotovost_2')), 'err');
    }
    b.disabled = true;
    apiJson('/trade/' + t.id + '/counter', { cena: Number($('pn-cena').value) || 0, karty: vybrane(),
      zastava: $('pn-zastava') ? $('pn-zastava').value : null,
      podil: $('pn-podil')
        ? Math.max(1, Math.min(PODIL_MAX_HRA, Math.round(Number($('pn-podil').value) || 0))) / 100
        : null,
      vzkaz: $('pn-vzkaz').value })
      .then(function (r) {
        b.disabled = false;
        if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_30')), 'err');
        closeSheet(); loadTrades(paintBurza); toast(esc(tx('hra.protinavrh_odeslan')), 'ok');
      }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida_9')), 'err'); });
  };
}
// Výběr karet, které hráč přihodí k ceně (platí vždy ten, kdo kupuje).
function kartyVyber(pref) {
  var moje = (CARDS_CAT || []).filter(function (c) { return ownedOf(c.kind) > 0; });
  if (!moje.length) return '';
  return '<p class="muted small" style="margin:10px 0 2px">' + esc(tx('hra.prihodit_karty')) + '</p><div class="vyber" id="' + pref + '-karty">'
    + moje.map(function (c) { return '<button type="button" data-k="' + c.kind + '">' + esc(polNazev(c)) + ' (' + ownedOf(c.kind) + ')</button>'; }).join('')
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
  hraciVyberSheet(esc(tx('hra.komu_chces_nabidnout')), esc(tx('hra.vybrat_2')), function (id) { majetekSheet(id); });
}

// rovnouKat = otevřít rovnou danou kategorii místo rozcestníku. Používá to
// nástěnka firem v nouzi: tam je jasné, o co jde, a klikat se přes rozcestník
// na půjčku je zbytečná překážka v situaci, kde jde o čas.
function majetekSheet(id, rovnouKat) {
  sheet('<h3>' + esc(tx('mapa.co_ma')) + '</h3><p class="muted small">' + esc(tx('mapa.nacitam')) + '</p>');
  api('/trade/assets/' + id).then(function (r) {
    if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_31')), 'err');
    var a = r.j, polozky = [];
    MODEL_ORDER.forEach(function (k) {
      if (a.sklad[k] > 0) polozky.push({ smer: 'koupim', predmet: 'stroj', model: k,
        popis: 'stroj ' + MODELS[k].name, pod: a.sklad[k] + esc(tx('hra.skladem')) });
    });
    (a.pradlomaty || []).forEach(function (m) {
      // Co cizí místo vydělává a za kolik tam má nájem, je věc majitele.
      polozky.push({ smer: 'koupim', predmet: 'pradlomat', spot_id: m.spot_id, model: m.model,
        popis: esc(m.name || m.spot_id), pod: (MODELS[m.model] || {}).name + ' ' + esc(tx('mapa.postaveny_pradlomat')) });
    });
    (a.pobocky || []).forEach(function (b) {
      polozky.push({ smer: 'koupim', predmet: 'pobocka', pobocka: b.name,
        popis: tx('veta.pobocka_2', { p1: esc(b.name) }), pod: esc(tx('mapa.zakladna_pro_dopravu_a_cetu')) });
    });
    Object.keys(a.karty || {}).forEach(function (k) {
      var c = (CARDS_CAT || []).filter(function (x) { return x.kind === k; })[0];
      if (c && a.karty[k] > 0) polozky.push({ smer: 'koupim', predmet: 'karta', card_kind: k,
        popis: tx('hra.karta_x', { p1: polNazev(c) }), pod: a.karty[k] + esc(tx('hra.k_dispozici')) });
    });
    // A co můžu nabídnout já
    var moje = [];
    MODEL_ORDER.forEach(function (k) {
      if (inStock(k) > 0) moje.push({ smer: 'prodam', predmet: 'stroj', model: k,
        popis: tx('veta.muj_stroj', { p1: MODELS[k].name }), pod: inStock(k) + esc(tx('hra.skladem_2')) });
    });
    S.units.forEach(function (u) {
      var l = uverMista(u), dluh = l ? Math.round(l.zbyva) : 0;
      moje.push({ smer: 'prodam', predmet: 'pradlomat', spot_id: u.spotId, model: u.eco.model,
        zisk: u.eco.profit, invest: u.eco.invest, obrat: u.eco.revenue, skore: u.score, rent: u.eco.rent,
        dluh: dluh, splatka: l ? Math.round(l.splatka) : 0,
        popis: tx('veta.muj', { p1: esc(jmenoStroje(u.name)) }), pod: MODELS[u.eco.model].name
          + tx('veta.100_zisk_mes_br_i_class', { p1: Math.round(u.score), p2: kcFull(u.eco.profit), p3: kcFull(cenaPradlomatu(u.eco.profit, u.eco.invest)) })
          + (dluh > 0 ? tx('hra.i_class_cena_dluh_visi_na', { p1: kcFull(dluh) }) : '') });
    });
    (S.pobocky || []).forEach(function (b) {
      moje.push({ smer: 'prodam', predmet: 'pobocka', pobocka: b.name,
        popis: tx('veta.moje_pobocka', { p1: esc(b.name) }), pod: tx('veta.provoz_te_stoji', { p1: kcFull(POBOCKA_MESICNE), p2: esc(tx('mapa.mesic')) })});
    });
    (CARDS_CAT || []).forEach(function (c) {
      if (ownedOf(c.kind) > 0) moje.push({ smer: 'prodam', predmet: 'karta', card_kind: c.kind,
        popis: tx('hra.moje_karta_x', { p1: polNazev(c) }), pod: ownedOf(c.kind) + esc(tx('hra.k_dispozici_2')) });
    });

    // ── Rozcestník ─────────────────────────────────────────────────────────
    // Všechno naráz byl na mobilu nekonečný seznam. Nejdřív tedy kategorie
    // s počty, samotné položky až po rozkliknutí.
    var KATEGORIE = [
      { k: 'pradlomat', ico: '🧺', nazev: esc(tx('mapa.pradlomaty')), pod: esc(tx('mapa.hotove_provozovny_i_s_mistem')) },
      { k: 'stroj', ico: '📦', nazev: esc(tx('hra.stroje')), pod: esc(tx('mapa.co_ma_kdo_skladem')) },
      { k: 'pobocka', ico: '🏢', nazev: esc(tx('mapa.pobocky')), pod: esc(tx('mapa.zakladny_pro_dopravu_a_cetu')) },
      { k: 'karta', ico: '⚡', nazev: esc(tx('hra.karty')), pod: esc(tx('mapa.zrychlovace_cekani')) },
      { k: 'pujcka', ico: '🏦', nazev: esc(tx('mapa.pujcka')), pod: esc(tx('mapa.penize_na_urok')) },
      { k: 'podil', ico: '📈', nazev: esc(tx('mapa.podil_ve_firme')), pod: esc(tx('mapa.procento_ze_zisku_i_ztraty')) },
      { k: 'vstup', ico: '💉', nazev: esc(tx('mapa.kapitalovy_vstup')), pod: esc(tx('mapa.penize_do_firmy_za_novy_podil')) },
      { k: 'prevzeti', ico: '🏴', nazev: esc(tx('prevzeti.nadpis')), pod: esc(tx('prevzeti.dlazdice_pod')) },
      { k: 'aliance', ico: '🤝', nazev: esc(tx('aliance.nadpis')), pod: esc(tx('aliance.dlazdice_pod')) }
    ];
    var kolikJe = function (kat) {
      var f = function (list) { return list.filter(function (x) { return x.predmet === kat; }).length; };
      return { k: f(polozky), p: f(moje) };
    };
    var hlava = '<h3>' + esc(a.hrac.firma) + '</h3>'
      + '<p class="muted small">' + esc(a.hrac.nick) + ' ' + esc(tx('hra.vyber_o_co_ti_jde')) + '</p>';

    var rozcestnik = function () {
      sheet(hlava + '<div class="rozc">' + KATEGORIE.map(function (c) {
        var n = c.k === 'pujcka' || c.k === 'podil' || c.k === 'vstup' || c.k === 'prevzeti'
          || c.k === 'aliance' ? null : kolikJe(c.k);
        var pocty = n == null ? c.pod
          : !n.k && !n.p ? esc(tx('mapa.nema_ani_jeden_z_vas'))
            : [n.k ? n.k + esc(tx('hra.jeho')) : '', n.p ? n.p + esc(tx('mapa.tvych')) : ''].filter(Boolean).join(' · ');
        return '<button type="button" class="rozc-b' + (n && !n.k && !n.p ? ' prazdna' : '')
          + '" data-kat="' + c.k + '"><i>' + c.ico + '</i>'
          + '<b>' + c.nazev + '</b><span>' + esc(pocty) + '</span></button>';
      }).join('') + '</div>');
      [].forEach.call($('sheet-body').querySelectorAll('[data-kat]'), function (b) {
        b.onclick = function () { kategorie(b.getAttribute('data-kat')); };
      });
    };

    var radek = function (x, i, pref) {
      return '<div class="area-item"><div><div class="nm">' + x.popis + '</div>'
        + '<div class="sub">' + x.pod + '</div></div>'
        + '<button class="btn sec sm" data-p="' + pref + i + '">' + esc(tx('mapa.nabidnout')) + '</button></div>';
    };
    // Položky si drží původní pořadí, jen se vypisují po kategoriích —
    // index v data-p tak pořád ukazuje do stejného pole.
    var vypis = function (list, kat, pref) {
      return list.map(function (x, i) { return x.predmet === kat ? radek(x, i, pref) : ''; }).join('');
    };

    var kategorie = function (kat) {
      var c = KATEGORIE.filter(function (x) { return x.k === kat; })[0] || {};
      var zpet = '<button type="button" class="btn sec sm zpet" id="rozc-zpet">' + esc(tx('mapa.zpet')) + '</button>';
      var telo;
      if (kat === 'pujcka') {
        telo = tx('veta.p_class_muted_small_splaci_se', { p1: tx('veta.pradlomat_hned_pri_prvni_nezaplacene_splatce', { p1: esc(tx('mapa.pujcit_mu_penize')), p2: esc(tx('mapa.ty_das_hotovost_on_splaci')), p3: esc(tx('mapa.pozadat_ho_o_pujcku')), p4: esc(tx('mapa.on_da_hotovost_ty_splacis')) }) });
      } else if (kat === 'aliance') {
        var mam = ALIANCE && ALIANCE.aliance;
        telo = '<p class="muted small">' + esc(tx(mam ? 'veta.aliance_pozvat_popis' : 'veta.aliance_nemas')) + '</p>'
          + (mam
            ? '<div class="area-item"><div><div class="nm">' + esc(mam.nazev)
              + '</div><div class="sub">' + esc(tx('veta.aliance_cena_za_vstup')) + '</div></div>'
              + '<button class="btn sec sm" id="aliance-go">' + esc(tx('aliance.pozvat')) + '</button></div>'
            : '');
      } else if (kat === 'prevzeti') {
        telo = '<p class="muted small">' + esc(tx('veta.prevzeti_k_cemu_je')) + '</p>'
          + '<div class="area-item"><div><div class="nm">' + esc(tx('prevzeti.nadpis'))
          + '</div><div class="sub">' + esc(tx('prevzeti.dlazdice_pod')) + '</div></div>'
          + '<button class="btn sec sm" id="prevzeti-go">' + esc(tx('prevzeti.vyhlasit')) + '</button></div>';
      } else if (kat === 'vstup') {
        telo = '<p class="muted small">' + esc(tx('veta.vstup_k_cemu_je')) + '</p>'
          + '<div class="area-item"><div><div class="nm">'
          + esc(tx('mapa.kapitalovy_vstup')) + '</div><div class="sub">'
          + esc(tx('mapa.penize_do_firmy_za_novy_podil')) + '</div></div>'
          + '<button class="btn sec sm" id="vstup-go">' + esc(tx('mapa.nabidnout')) + '</button></div>';
      } else if (kat === 'podil') {
        telo = tx('veta.p_class_muted_small_podilnik_nese', { p1: tx('veta.mesicne_chodi_nebo_doplaci_odkoupit_ho', { p1: esc(tx('mapa.koupit_podil_v_jeho_firme')), p2: esc(tx('mapa.dostavas_procento_z_jeho_zisku')), p3: esc(tx('mapa.nabidnout_mu_podil_ve_sve')), p4: esc(tx('mapa.dostanes_hotovost_on_procento_z')) }) });
      } else {
        var od = vypis(polozky, kat, 'k'), mu = vypis(moje, kat, 'p');
        telo = '<h3 style="margin-top:14px">' + esc(tx('mapa.koupit_od_nej')) + '</h3>'
          + (od || '<p class="muted small">' + esc(tx('mapa.nic_takoveho_nema')) + '</p>')
          + '<h3 style="margin-top:18px">' + esc(tx('hra.prodat_mu')) + '</h3>'
          + (mu || '<p class="muted small">' + esc(tx('mapa.ty_zatim_nemas_co_nabidnout')) + '</p>');
      }
      sheet('<div class="rozc-hlava">' + zpet + '<h3>' + (c.ico || '') + ' ' + esc(c.nazev || '') + '</h3></div>'
        + '<p class="muted small" style="margin:0 0 4px">' + esc(a.hrac.nick) + '</p>' + telo);
      $('rozc-zpet').onclick = rozcestnik;
      if ($('vstup-go')) $('vstup-go').onclick = function () { vstupSheet(id, a.hrac, a); };
      if ($('prevzeti-go')) $('prevzeti-go').onclick = function () { vyhlasitSheet(id, a.hrac, a); };
      if ($('aliance-go')) $('aliance-go').onclick = function () {
        var b = $('aliance-go'); b.disabled = true;
        apiJson('/trade/aliance/pozvat', { player_id: id }).then(function (r) {
          if (!r.ok) { b.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
          closeSheet();
          toast(tx('veta.pozvanka_odeslana', { p1: esc(a.hrac.firma || a.hrac.nick) }), 'ok', true);
        }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
      };
      [].forEach.call($('sheet-body').querySelectorAll('[data-fin]'), function (b) {
        b.onclick = function () { financeSheet(id, a.hrac, b.getAttribute('data-fin'), a); };
      });
      [].forEach.call($('sheet-body').querySelectorAll('[data-p]'), function (b) {
        b.onclick = function () {
          var v = b.getAttribute('data-p');
          var x = v.charAt(0) === 'k' ? polozky[Number(v.slice(1))] : moje[Number(v.slice(1))];
          cenaSheet(id, a.hrac, x);
        };
      });
    };

    if (rovnouKat) kategorie(rovnouKat); else rozcestnik();
  }).catch(function () { toast(esc(tx('mapa.server_neodpovida_5')), 'err'); });
}

// ─── Půjčka a podíl mezi hráči ───────────────────────────────────────────────
// Nabídka jako každá jiná: pošle se protistraně a ta ji přijme nebo odmítne.
// Splátky i výplaty podílu pak řeší server každý herní měsíc sám.
// Prodat jde i většina firmy. Hra do toho majiteli nemluví, jen ho nenechá
// kliknout naslepo — nad padesáti procenty musí potvrdit, že ví, co dělá.
var UROK_MAX_HRA = 60, PODIL_MAX_HRA = 100, PODIL_VETSINA_HRA = 50, PUJCKA_MIN_HRA = 10000;
// Kolik procent vlastní firmy už hráč prodal. Server to ví jistě, tohle je
// jen pro formulář, než nabídku odešle.
function podilProdano() {
  return ((FINANCE && FINANCE.podily) || []).reduce(function (a, e) {
    return a + (e.moje === 'prodal' ? (e.podil || 0) : 0);
  }, 0);
}
// Našeptávač ceny podílu. Hráč si cenu určí sám — tohle je jen opora,
// aby nestřílel od boku.
function oceneniHtml(oc, co) {
  if (!oc) return '<p class="fine">' + esc(tx('hra.hodnotu_tehle_firmy_nezname_cena')) + '</p>';
  var cizi = co === 'koupim-podil';
  // Rozšířené finanční údaje náleží až od desetiny firmy. Cena zůstává
  // všem — bez ní by se podíl nedal koupit ani prodat.
  if (oc.zkracene) {
    return '<div class="kv" style="margin-top:10px"><span>' + esc(tx('hra.ciste_jmeni_firmy'))
      + '</span><b class="' + (oc.jmeni >= 0 ? '' : 'err') + '">' + kcFull(oc.jmeni) + '</b></div>'
      + '<div class="kv"><span>' + esc(tx('hra.velikost_site')) + '</span><b>' + oc.pradlomatu + ' '
      + mn(oc.pradlomatu, esc(tx('hra.pradlomat_2')), esc(tx('hra.pradlomaty_5')), esc(tx('hra.pradlomatu_2'))) + '</b></div>'
      + '<p class="fine">' + tx('veta.rozsirene_udaje_az_od', { p1: oc.prah_pct || 10 }) + '</p>';
  }
  return tx('veta.div_class_kv_style_margin_top_2', { p1: (cizi ? esc(tx('hra.jeho_majetek')) : esc(tx('hra.tvuj_majetek'))), p2: oc.pradlomatu, p3: mn(oc.pradlomatu, esc(tx('hra.pradlomat_2')), esc(tx('hra.pradlomaty_5')), esc(tx('hra.pradlomatu_2'))), p4: kcFull(oc.majetek), p5: esc(tx('hra.hotovost_3')), p6: kcFull(oc.hotovost), p7: esc(tx('hra.dluh_u_banky_2')), p8: (oc.dluh ? 'warn' : ''), p9: kcFull(oc.dluh), p10: esc(tx('hra.ciste_jmeni_firmy')), p11: (oc.jmeni >= 0 ? '' : 'err'), p12: kcFull(oc.jmeni), p13: esc(tx('hra.podle_zisku_4_rocni')), p14: kcFull(oc.podle_zisku) });
}
// Kolik téhle firmy drží jeden konkrétní hráč. Většinu dělá jeden držitel,
// ne součet všech podílníků — padesát procent rozdrobených mezi pět lidí
// nikomu kontrolu nedává.
function podilJednoho(toId, co) {
  var klic = co === 'koupim-podil' ? 'mam' : 'prodal';
  return ((FINANCE && FINANCE.podily) || []).filter(function (e) {
    return e.moje === klic && e.kdo_id === toId && bezici(e);
  }).reduce(function (a, e) { return a + (e.podil || 0); }, 0);
}
function anuitaHra(castka, urokProcent, mesicu) {
  var r = (Number(urokProcent) || 0) / 100 / 12;
  if (!(mesicu > 0)) return castka;
  if (r <= 0) return Math.ceil(castka / mesicu);
  return Math.ceil(castka * r / (1 - Math.pow(1 + r, -mesicu)));
}
// Kolik stojí moje firma. Stejný recept, jakým server oceňuje cizí: každá
// provozovna za čtyřnásobek ročního zisku (držený tím, co stavba stála),
// plus hotovost, minus dluh u banky.
function hodnotaMojiFirmy() {
  var hotovost = Math.max(0, Math.round(S.cash));
  var dluh = Math.max(0, Math.round(S.loan));
  var jmeni = Math.round(cisteJmeni());
  var zbyde = Math.round(cistyZisk());
  return { majetek: jmeni - hotovost + dluh, hotovost: hotovost, dluh: dluh, jmeni: jmeni,
    podle_zisku: Math.max(0, Math.round(zbyde * 12 * CENA_NASOBEK)),
    zbyde_mesicne: zbyde, pradlomatu: (S.units || []).length,
    hodnota: Math.max(0, jmeni) };
}
// Jak se zástava u půjčky jmenuje v přehledech. Podíl má přednost — je to
// tvrdší krytí než jeden prádlomat a vylučují se navzájem.
function zastavaPopis(d) {
  d = d || {};
  if (d.zastava_podil) return tx('veta.pct_firmy_do_zastavy', { p1: Math.round(d.zastava_podil * 100) });
  if (d.zastava_nazev) return esc(d.zastava_nazev);
  if (d.zadam_zastavu) return esc(tx('hra.veritel_ji_vyzaduje'));
  return esc(tx('hra.bez_zastavy_2'));
}
function zastavaChybi(d) {
  d = d || {};
  return !!(d.zadam_zastavu && !d.zastava_nazev && !d.zastava_podil);
}
function financeSheet(toId, kdo, co, a) {
  var pujcka = co === 'pujcim' || co === 'pujcim-si';
  // Ocenění firmy, o jejíž podíl jde: u sebe spočítáme, u cizí přišlo ze serveru.
  var oc = pujcka ? null
    : (co === 'prodam-podil' ? hodnotaMojiFirmy() : ((a && a.oceneni) || null));
  var prodano = co === 'koupim-podil' ? ((a && a.prodany_podil) || 0) : podilProdano();
  // Kolik procent z firmy ještě vůbec jde prodat. Bez toho hráč zadal šest
  // procent do firmy, kde zbývala čtyři, a nabídku mu odmítl až server.
  var zbyvaPodilu = Math.max(0, PODIL_MAX_HRA - Math.round(prodano * 100));
  // U zástavy podílem jde o firmu dlužníka, ne o moji — kolik je v ní volného,
  // přišlo ze serveru spolu s oceněním.
  var zbyvaCizi = Math.max(0, PODIL_MAX_HRA - Math.round(((a && a.prodany_podil) || 0) * 100));
  var jaDavam = co === 'pujcim' || co === 'koupim-podil';     // z mé hotovosti
  var nadpis = co === 'pujcim' ? tx('veta.pujcit', { p1: esc(kdo.firma) }): co === 'pujcim-si' ? esc(tx('hra.pozadat_o_pujcku'))
    : co === 'koupim-podil' ? tx('veta.koupit_podil_v', { p1: esc(kdo.firma) }): esc(tx('hra.nabidnout_podil_ve_sve_firme'));
  // Zástavu dává vždycky dlužník. Když si půjčuju já, vybírám ze svých míst.
  var mojeMista = (S.units || []).map(function (u) {
    return { id: u.spotId, name: u.name + ' · ' + (MODELS[u.eco.model] || {}).name };
  });
  sheet('<h3>' + nadpis + '</h3>'
    + '<p class="muted small">' + (pujcka
        ? tx('veta.splaci_se_anuitne_kazdy_herni_mesic'): tx('veta.podilnik_dostava_svoje_procento_z_toho')) + '</p>'
    + '<label class="fld"><span>' + (pujcka ? esc(tx('hra.kolik')) : esc(tx('hra.za_kolik'))) + '</span>'
    + '<input id="fin-castka" class="inp" type="number" inputmode="numeric" min="0" value="'
    + (pujcka ? 500000 : 1000000) + '"></label>'
    + (pujcka
        ? '<label class="fld"><span>' + esc(tx('hra.rocni_urok_v')) + '</span>'
          + '<input id="fin-urok" class="inp" type="number" inputmode="decimal" min="0" max="'
          + UROK_MAX_HRA + '" step="0.5" value="10"></label>'
          + '<label class="fld"><span>' + esc(tx('hra.na_kolik_hernich_mesicu')) + '</span>'
          + '<input id="fin-mesicu" class="inp" type="number" inputmode="numeric" min="1" max="60" value="12"></label>'
          + (co === 'pujcim-si'
              ? (mojeMista.length
                  ? '<label class="fld"><span>' + esc(tx('hra.zastava_nepovinna')) + '</span><select id="fin-zastava" class="inp">'
                    + '<option value="">' + esc(tx('hra.bez_zastavy')) + '</option>'
                    + mojeMista.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('')
                    + '</select></label>'
                  : '<p class="fine">' + esc(tx('hra.nemas_postaveny_pradlomat_takze_nabizis')) + '</p>')
              : tx('veta.div_class_row_style_margin_10px', { p1: esc(tx('hra.chci_zastavu')) })
                // Strop políčka je padesát, protože se používá i pro konverzi,
                // kde volný podíl ve firmě nerozhoduje — podíl se vydá nový.
                // Na to, co je u zástavy volné, ořízne číslo zastavaProcento().
                + '<label class="fld" id="fin-pod-box" style="display:none"><span>'
                + esc(tx('hra.jaky_podil_chces_do_zastavy')) + '</span>'
                + '<input id="fin-zast-podil" class="inp" type="number" inputmode="numeric" min="1" max="50"'
                + ' value="' + Math.min(20, Math.max(1, zbyvaCizi || 20)) + '"></label>')
        : '<label class="fld"><span>' + esc(tx('hra.podil_v')) + '</span>'
          + '<input id="fin-podil" class="inp" type="number" inputmode="numeric" min="1" max="'
          + zbyvaPodilu + '" value="' + Math.min(10, zbyvaPodilu) + '"'
          + (zbyvaPodilu < 1 ? ' disabled' : '') + '></label>'
          + (zbyvaPodilu < PODIL_MAX_HRA
              ? '<p class="fine' + (zbyvaPodilu < 1 ? ' err' : '') + '">'
                + (zbyvaPodilu < 1
                    ? esc(tx('hra.tahle_firma_je_rozprodana_cela'))
                    : tx('veta.prodano_je_zbyva_tedy', { p1: Math.round(prodano * 100), p2: zbyvaPodilu })) + '</p>'
              : '')
          + '<p class="fine" id="fin-vetsina"></p>'
          + oceneniHtml(oc, co))
    + '<label class="fld"><span>' + esc(tx('hra.vzkaz_nepovinny')) + '</span>'
    + '<input id="fin-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<div class="kv souhrn"><span id="fin-popis">' + esc(tx('hra.splatka')) + '</span><b id="fin-vysledek">' + '—' + '</b></div>'
    + '<p class="fine" id="fin-kryti"></p>'
    + '<button class="btn big" id="fin-ok" style="width:100%;margin-top:10px">' + esc(tx('hra.poslat_nabidku')) + '</button>'
    + '<p class="fine">' + (jaDavam ? esc(tx('hra.penize_odejdou_az_nabidku_prijme')) : esc(tx('hra.penize_dorazi_az_nabidku_prijme'))) + '</p>'
    + (jaDavam ? volneHtml(null) : ''));
  // Věřitel si zástavu může vymínit, aniž by věděl, čím mu dlužník ručí —
  // konkrétní prádlomat vybere dlužník, až bude půjčku přijímat.
  // 0 = bez krytí, 1 = prádlomat (vybere si dlužník), 2 = podíl ve firmě.
  // Podíl si na rozdíl od prádlomatu určuje věřitel — je to cena za půjčku
  // stejně jako úrok.
  // 0 = bez krytí, 1 = prádlomat (vybere si dlužník), 2 = zastavený podíl,
  // 3 = konverze na nově vydaný podíl.
  //
  // Dvojka potřebuje ve firmě volný podíl — zastavit jde jen to, co ještě
  // není prodané. Trojka ne: podíl se vydá nový a všichni dosavadní se
  // zředí. Proto je trojka v nabídce vždycky, i u firmy, kde je prodané
  // všechno, a často je to tam jediná možnost, jak půjčku vůbec krýt.
  var STAVY = zbyvaCizi > 0 ? [0, 1, 2, 3] : [0, 1, 3];
  var zadam = 0;
  if ($('fin-zadam')) {
    $('fin-zadam').onclick = function () {
      zadam = STAVY[(STAVY.indexOf(zadam) + 1) % STAVY.length];
      $('fin-zadam').classList.toggle('on', zadam > 0);
      $('fin-zadam').textContent = zadam === 3 ? esc(tx('hra.konverze_na_podil'))
        : zadam === 2 ? esc(tx('mapa.podil_ve_firme'))
        : zadam === 1 ? esc(tx('hra.zastava_pradlomatem')) : esc(tx('hra.nechci'));
      $('fin-zadam-pop').textContent = zadam === 3
        ? tx('veta.konverze_popis', { p1: zastavaProcento() })
        : zadam === 2
        ? tx('veta.pri_prvni_nezaplacene_splatce_ti_podil', { p1: zastavaProcento() })
        : zadam === 1 ? tx('veta.dluznik_vybere_pradlomat_kterym_ruci_az')
        : tx('veta.pujcis_bez_kryti_kdyz_prestane_splacet');
      if ($('fin-pod-box')) $('fin-pod-box').style.display = (zadam === 2 || zadam === 3) ? '' : 'none';
    };
  }
  // Kolik procent je zrovna v políčku, ořezané na to, co je ve firmě volné.
  var zastavaProcento = function () {
    var v = Math.max(1, Math.round(Number(($('fin-zast-podil') || {}).value) || 0));
    // U konverze se podíl vydává nově, takže ho volný podíl ve firmě
    // neomezuje — jen společný strop, který platí i pro kapitálový vstup.
    return zadam === 3 ? Math.min(50, v) : Math.min(zbyvaCizi, v);
  };
  if ($('fin-zast-podil')) {
    $('fin-zast-podil').oninput = function () {
      if (zadam === 2 && $('fin-zadam-pop')) {
        $('fin-zadam-pop').textContent = tx('veta.pri_prvni_nezaplacene_splatce_ti_podil', { p1: zastavaProcento() });
      } else if (zadam === 3 && $('fin-zadam-pop')) {
        $('fin-zadam-pop').textContent = tx('veta.konverze_popis', { p1: zastavaProcento() });
      }
    };
  }
  var prepocti = function () {
    var c = Math.max(0, Math.round(Number(($('fin-castka') || {}).value) || 0));
    if (pujcka) {
      var u = Math.max(0, Math.min(UROK_MAX_HRA, Number(($('fin-urok') || {}).value) || 0));
      var m = Math.max(1, Math.min(60, Math.round(Number(($('fin-mesicu') || {}).value) || 1)));
      var sp = anuitaHra(c, u, m);
      $('fin-popis').textContent = esc(tx('hra.splatka_za_herni_mesic'));
      $('fin-vysledek').textContent = kcFull(sp) + '  (celkem ' + kcFull(sp * m) + ')';
    } else {
      var p = Math.max(1, Math.min(zbyvaPodilu || PODIL_MAX_HRA,
      Math.round(Number(($('fin-podil') || {}).value) || 0)));
      $('fin-popis').textContent = esc(tx('hra.co_z_firmy_ukroji'));
      $('fin-vysledek').textContent = oc
        ? p + ' % · ' + kcFull(Math.round(oc.zbyde_mesicne * p / 100)) + ' ' + esc(tx('hra.mes'))
        : tx('veta.z_toho_co_firme_mesicne_zbyde', { p1: p });
      if (oc && $('fin-rada')) {
        var podleJmeni = Math.round(oc.jmeni * p / 100);
        var podleZisku = Math.round(oc.podle_zisku * p / 100);
        var mesicne = Math.round(oc.zbyde_mesicne * p / 100);
        var roky = mesicne > 0 && c > 0 ? (c / (mesicne * 12)) : null;
        $('fin-rada').innerHTML = (oc.jmeni > 0
            ? tx('veta.b_jmeni_je', { p1: p, p2: kcFull(podleJmeni) })
              + (podleZisku > podleJmeni
                  ? tx('veta.podle_zisku', { p1: kcFull(podleZisku), p2: esc(tx('hra.firma_vydelava_vic_nez_na')) })
                  : '.') + '</b> '
            : '<b>' + esc(tx('hra.firma_ma_zapornou_hodnotu_dluh')) + '</b> '
              + (podleZisku > 0 ? tx('veta.podle_zisku_by_melo_cenu_ale', { p1: p, p2: kcFull(podleZisku) }): ''))
          + (mesicne > 0
              ? tx('veta.pri_dnesnim_vydelku_by_z_podilu', { p1: kcFull(mesicne) })
                + (roky ? tx('hra.za_zadanou_cenu_navratnost_roku', { p1: roky.toFixed(1).replace('.', desZnak()) }) : '.')
              : esc(tx('hra.firma_ted_nevydelava_takze_by')))
          + ' ' + esc(tx('hra.za_kolik_se_nakonec_dohodnete'))
          + (prodano > 0 ? tx('veta.z_firmy_je_uz_prodano', { p1: Math.round(prodano * 100) }): '');
      }
    }
  };
  var kryti = function () {
    var el = $('fin-kryti');
    if (!jaDavam) return;
    var c = Math.max(0, Math.round(Number(($('fin-castka') || {}).value) || 0));
    var volne = volnaHotovost(null);
    if (c > volne) {
      el.className = 'fine err';
      el.textContent = tx('veta.na_tohle_nemas_volnou_hotovost_chybi_3', { p1: tx('veta.dokud_ji_nemas_nabidku_nikdo_nemuze', { p1: kcFull(c - volne) }) });
    } else { el.className = 'fine'; el.textContent = ''; }
  };
  // Většina firmy. Hláška je živá, ať ji hráč vidí dřív, než klikne — a u
  // prodeje vlastní firmy si ji musí odkliknout, aby nešla přehlédnout.
  var drziUz = co === 'koupim-podil' || co === 'prodam-podil' ? podilJednoho(toId, co) : 0;
  var poProdeji = function () {
    var i = $('fin-podil');
    if (!i) return 0;
    return Math.round(drziUz * 100) + Math.max(0, Math.round(Number(i.value) || 0));
  };
  var vetsinaVar = function () {
    var el = $('fin-vetsina');
    if (!el) return;
    var po = poProdeji();
    if (po <= PODIL_VETSINA_HRA) {
      el.className = 'fine'; el.textContent = '';
      var s1 = $('fin-souhlas'); if (s1) s1.parentNode.removeChild(s1);
      return;
    }
    var kdoBude = co === 'koupim-podil' ? esc(tx('hra.budes')) : esc(kdo.firma || kdo.nick) + ' bude';
    el.className = 'fine err';
    el.innerHTML = '<b>' + tx('veta.b_drzet_firmy', { p1: esc(tx('hra.vetsinovy_podil')), p2: kdoBude, p3: po })
      + (drziUz > 0 ? tx('hra.uz_ma', { p1: Math.round(drziUz * 100) }) : '') + '. '
      + (co === 'prodam-podil'
          ? tx('hra.prodavas_tim_vetsinu_vlastni_firmy_zpatky')
          : esc(tx('hra.ziskavas_tim_vetsinu_v_cizi')));
    if (co === 'prodam-podil' && !$('fin-souhlas')) {
      var w = document.createElement('label');
      w.className = 'fld chk'; w.id = 'fin-souhlas';
      w.innerHTML = '<input type="checkbox" id="fin-souhlas-in"> '
        + '<span>' + esc(tx('hra.rozumim_prodavam_vetsinu_sve_firmy')) + '</span>';
      el.parentNode.insertBefore(w, el.nextSibling);
    }
  };
  var puvodni = prepocti;
  prepocti = function () { puvodni(); kryti(); vetsinaVar(); };
  // Částku napoprvé napovíme z ocenění a držíme ji s procentem, dokud do ní
  // hráč sám nesáhne — pak je jeho.
  var rucne = false;
  var zaklad = function () { return oc ? (oc.hodnota > 0 ? oc.hodnota : oc.podle_zisku) : 0; };
  if (oc && $('fin-castka')) $('fin-castka').value = Math.round(zaklad() * 0.1) || 1000000;
  if ($('fin-castka')) $('fin-castka').addEventListener('input', function () { rucne = true; });
  if (oc && $('fin-podil')) $('fin-podil').addEventListener('input', function () {
    if (rucne) return;
    var p = Math.max(1, Math.min(zbyvaPodilu || PODIL_MAX_HRA,
      Math.round(Number($('fin-podil').value) || 0)));
    $('fin-castka').value = Math.round(zaklad() * p / 100);
  });
  ['fin-castka', 'fin-urok', 'fin-mesicu', 'fin-podil'].forEach(function (id) {
    if ($(id)) $(id).oninput = prepocti;
  });
  prepocti();
  $('fin-ok').onclick = function () {
    var c = Math.max(0, Math.round(Number($('fin-castka').value) || 0));
    if (pujcka && c < PUJCKA_MIN_HRA) return toast(tx('veta.nejmensi_pujcka_je', { p1: kcFull(PUJCKA_MIN_HRA) }), 'err');
    if (!c) return toast(esc(tx('hra.zadej_castku')), 'err');
    if (jaDavam && c > volnaHotovost(null)) {
      return toast(tx('veta.volne_hotovosti_mas_jen', { p1: kcFull(Math.max(0, volnaHotovost(null))), p2: esc(tx('hra.zbytek_drzi_rozjednane_nabidky')) }), 'err');
    }
    var telo = { to_id: toId, predmet: pujcka ? 'pujcka' : 'podil', cena: c,
      smer: (co === 'pujcim' || co === 'prodam-podil') ? 'prodam' : 'koupim',
      vzkaz: ($('fin-vzkaz').value || '').slice(0, 200) };
    if (pujcka) {
      telo.urok = Math.max(0, Math.min(UROK_MAX_HRA, Number($('fin-urok').value) || 0)) / 100;
      telo.mesicu = Math.max(1, Math.min(60, Math.round(Number($('fin-mesicu').value) || 1)));
      if ($('fin-zastava') && $('fin-zastava').value) telo.zastava = $('fin-zastava').value;
      if (co === 'pujcim') {
        telo.zadam_zastavu = zadam === 1;
        if (zadam === 2) telo.zastava_podil = zastavaProcento() / 100;
        if (zadam === 3) telo.konverze_podil = zastavaProcento() / 100;
      }
    } else {
      var pp = Math.max(1, Math.round(Number($('fin-podil').value) || 0));
      if (co === 'prodam-podil' && poProdeji() > PODIL_VETSINA_HRA
        && !(($('fin-souhlas-in') || {}).checked)) {
        return toast(esc(tx('hra.prodavas_vetsinu_firmy_odklikni_ze')), 'err');
      }
      if (pp > zbyvaPodilu) {
        return toast(zbyvaPodilu < 1
          ? esc(tx('hra.tahle_firma_je_rozprodana_cela_2'))
          : tx('veta.z_firmy_zbyva_cela_firma_je', { p1: zbyvaPodilu }), 'err');
      }
      telo.podil = pp / 100;
    }
    $('fin-ok').disabled = true;
    apiJson('/trade/offer', telo).then(function (r) {
      if (!r.ok) { $('fin-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
      closeSheet(); loadTrades(paintBurza);
      toast(esc(tx('hra.nabidka_odeslana_ted_je_to')), 'ok');
    }).catch(function () { $('fin-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}
// ─── Kapitálový vstup ────────────────────────────────────────────────────────
// Peníze jdou do firmy a investor za ně dostane nově vydaný podíl. Všichni
// dosavadní podílníci se o stejný poměr zředí — včetně majitele.
//
// Má to vlastní okno, ne další větev v financeSheet: tam se řeší úrok,
// splátky a zástava, což sem nepatří ani jedno, a ta funkce je rozvětvená
// dost i bez toho.
function vstupSheet(toId, kdo, a) {
  var oc = (a && a.oceneni) || null;
  // Hodnota firmy před vstupem. Když ji neznáme, nedá se poradit podíl —
  // hráč si ho určí sám a je to jeho věc.
  var pred = oc ? Math.max(0, oc.jmeni) : 0;
  var VSTUP_MAX_HRA = 50;
  sheet('<h3>' + tx('veta.vstoupit_do', { p1: esc(kdo.firma || kdo.nick) }) + '</h3>'
    + '<p class="muted small">' + esc(tx('veta.vstup_jak_to_funguje')) + '</p>'
    + '<label class="fld"><span>' + esc(tx('hra.kolik_vlozis')) + '</span>'
    + '<input id="vs-castka" class="inp" type="number" inputmode="numeric" min="0" value="'
    + (Math.round(pred * 0.25) || 1000000) + '"></label>'
    + '<label class="fld"><span>' + esc(tx('hra.za_jaky_podil')) + '</span>'
    + '<input id="vs-podil" class="inp" type="number" inputmode="numeric" min="1" max="'
    + VSTUP_MAX_HRA + '" value="25"></label>'
    + (oc ? oceneniHtml(oc, 'koupim-podil') : '')
    + '<p class="fine" id="vs-rada"></p>'
    + '<label class="fld"><span>' + esc(tx('hra.vzkaz_nepovinny')) + '</span>'
    + '<input id="vs-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<div class="kv souhrn"><span>' + esc(tx('hra.po_vstupu_budes_drzet')) + '</span>'
    + '<b id="vs-vysledek">\u2014</b></div>'
    + '<button class="btn big" id="vs-ok" style="width:100%;margin-top:10px">'
    + esc(tx('hra.poslat_nabidku')) + '</button>'
    + '<p class="fine">' + esc(tx('hra.penize_odejdou_az_nabidku_prijme')) + '</p>'
    + volneHtml(null));
  var procento = function () {
    return Math.max(1, Math.min(VSTUP_MAX_HRA, Math.round(Number($('vs-podil').value) || 0)));
  };
  var castka = function () { return Math.max(0, Math.round(Number($('vs-castka').value) || 0)); };
  var prepocti = function () {
    var p = procento(), c = castka();
    // Co je v poli, musí být i ve výsledku. Když hráč napsal devadesát a
    // hra mu tiše počítá s padesáti, pošle nabídku, o které si myslí něco
    // jiného než server.
    if ($('vs-podil').value !== String(p)) $('vs-podil').value = p;
    $('vs-vysledek').textContent = p + ' % ' + esc(kdo.firma || kdo.nick);
    // Kolik procent by za ty peníze slušelo: vklad děleno hodnotou po vstupu.
    // Je to vodítko, ne povinnost — plácnout si můžou na čemkoli.
    var el = $('vs-rada');
    if (!oc || !c) { el.textContent = ''; return; }
    var slusne = Math.round(c / (pred + c) * 100);
    // Žlutě, když si investor říká o víc, než by za ty peníze slušelo —
    // ne proto, že by to bylo zakázané, ale protože to majitel nejspíš
    // odmítne a nabídka vyjde naprázdno.
    el.className = 'fine' + (p > slusne + 5 ? ' warn' : '');
    el.innerHTML = tx('veta.vstup_rada', { p1: kcFull(pred), p2: slusne, p3: p })
      + (p > slusne + 5 ? ' ' + esc(tx('veta.vstup_chces_vic')) : '')
      + (oc.zbyde_mesicne > 0
          ? ' ' + tx('veta.vstup_vynos', { p1: kcFull(Math.round(oc.zbyde_mesicne * p / 100)) })
          : '');
  };
  ['vs-castka', 'vs-podil'].forEach(function (id) { if ($(id)) $(id).oninput = prepocti; });
  prepocti();
  $('vs-ok').onclick = function () {
    var c = castka();
    if (!c) return toast(esc(tx('hra.zadej_castku')), 'err');
    if (c > volnaHotovost(null)) {
      return toast(tx('veta.volne_hotovosti_mas_jen', { p1: kcFull(Math.max(0, volnaHotovost(null))), p2: esc(tx('hra.zbytek_drzi_rozjednane_nabidky')) }), 'err');
    }
    $('vs-ok').disabled = true;
    apiJson('/trade/offer', { to_id: toId, predmet: 'vstup', cena: c, smer: 'koupim',
      podil: procento() / 100, vzkaz: ($('vs-vzkaz').value || '').slice(0, 200) })
      .then(function (r) {
        if (!r.ok) { $('vs-ok').disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_32')), 'err'); }
        closeSheet(); loadTrades(paintBurza);
        toast(esc(tx('hra.nabidka_odeslana_ted_je_to')), 'ok');
      }).catch(function () { $('vs-ok').disabled = false; toast(esc(tx('hra.server_neodpovida')), 'err'); });
  };
}

function cenaSheet(toId, kdo, x) {
  var jaPlatim = x.smer === 'koupim';
  // U cizího prádlomatu neumíme nic počítat — a neměli bychom: jeho čísla
  // zná jen majitel. U vlastního majetku a u strojů cena dává smysl.
  var orient = (jaPlatim && x.predmet === 'pradlomat') ? null : cenaPredmetu(x);
  sheet('<h3>' + (jaPlatim ? esc(tx('hra.nabidka_na_odkup')) : esc(tx('hra.nabidka_k_prodeji'))) + '</h3>'
    + '<p class="muted small">' + x.popis + ' · ' + esc(kdo.firma) + '</p>'
    + (x.predmet === 'pradlomat' && !jaPlatim
        ? '<div class="kv"><span>' + esc(tx('hra.zisk_mesic')) + '</span><b class="ok">' + kcFull(x.zisk || 0) + '</b></div>'
          + (x.obrat ? '<div class="kv"><span>' + esc(tx('hra.obrat_mesic')) + '</span><b>' + kcFull(x.obrat) + '</b></div>' : '')
          + (x.rent ? '<div class="kv"><span>' + esc(tx('hra.najem_mesic')) + '</span><b class="warn">' + kcFull(x.rent) + '</b></div>' : '')
          + (x.skore != null ? '<div class="kv"><span>' + esc(tx('hra.skore_mista')) + '</span><b>' + Math.round(x.skore) + '/100</b></div>' : '')
          + ((x.dluh || 0) > 0
              ? '<div class="kv"><span>' + esc(tx('hra.uver_na_miste')) + '</span><b class="warn">' + kcFull(x.dluh) + '</b></div>' : '')
        : '')
    + (x.predmet === 'pradlomat' && jaPlatim
        ? tx('veta.p_class_fine_co_to_misto'): '')
    + (orient != null
        ? '<div class="kv souhrn"><span>' + esc(tx('hra.orientacni_cena')) + '</span><b>' + kcFull(orient) + '</b></div>'
          + '<p class="fine">' + (x.predmet === 'pradlomat'
              ? tx('veta.tolik_dava_trh_za_pradlomat_s', { p1: CENA_NASOBEK }): esc(tx('hra.tolik_se_za_to_na'))) + '</p>'
        : '<p class="fine">' + esc(tx('hra.tohle_trh_nema_jak_ocenit')) + '</p>')
    + '<label class="fld"><span>' + esc(tx('hra.cena_l_2')) + '</span>'
    + '<input id="na-cena" class="inp" type="number" min="0" step="1000" value="' + (orient || 0) + '"></label>'
    + '<p class="fine" id="na-verdikt"></p>'
    + (jaPlatim ? kartyVyber('na') : '')
    + '<label class="fld"><span>' + esc(tx('hra.vzkaz_nepovinny_2')) + '</span><input id="na-vzkaz" class="inp" type="text" maxlength="200"></label>'
    + '<button class="btn big" id="na-ok">' + esc(tx('hra.odeslat_nabidku')) + '</button>'
    + '<p class="fine">' + esc(tx('hra.rozhodne_protistrana_nabidku_muze_prijmout')) + '</p>'
    + (jaPlatim ? volneHtml(null) : ''));
  // Verdikt se přepíše při každém úderu do klávesnice.
  var ci = $('na-cena'), vd = $('na-verdikt');
  var verdikt = function () {
    var c = Math.max(0, Math.round(Number(ci.value) || 0));
    var t = [], tr = 'fine';
    if (orient != null && orient > 0) {
      var o = Math.round((c - orient) / orient * 100);
      t.push(Math.abs(o) < 3 ? esc(tx('hra.sedi_na_orientacni_cene'))
        : o > 0 ? tx('veta.o_nad_orientacni_cenou', { p1: o }): tx('veta.o_pod_orientacni_cenou', { p1: (-o) }));
    }
    if (x.predmet === 'pradlomat' && x.zisk > 0 && !jaPlatim) {
      var r = rokyNavratnosti(c, x.zisk);
      if (r) t.push(tx('veta.jemu_se_to_vrati_za_roku', { p1: r.toFixed(1).replace('.', desZnak()) }));
    }
    // Pod dluh, který na místě visí, prodávající nepůjde — doplácel by ze svého.
    var dluh = jaPlatim ? 0 : (x.dluh || 0);
    if (dluh > 0) {
      if (c < dluh) {
        t.push(tx('veta.pod_uver_ktery_na_miste_visi', { p1: kcFull(dluh - c) }));
        tr = 'fine err';
      } else {
        t.push(tx('veta.uver_to_pokryje_a_jeste_ti', { p1: kcFull(c - dluh) }));
      }
    }
    if (jaPlatim) {
      var volne = volnaHotovost(null);
      if (c > volne) {
        t.push(volne === S.cash ? tx('veta.tolik_hotovosti_nemas_mas', { p1: kcFull(S.cash) }): tx('veta.volne_hotovosti_mas_jen_2', { p1: kcFull(Math.max(0, volne)), p2: esc(tx('hra.zbytek_drzi_rozjednane_nabidky_2')) }));
        tr = 'fine err';
      }
    }
    vd.className = tr;
    vd.textContent = t.join(' ');
  };
  ci.oninput = verdikt; verdikt();
  var vybrane = jaPlatim ? bindKartyVyber('na') : function () { return []; };
  $('na-ok').onclick = function () {
    var b = $('na-ok');
    if (jaPlatim && (Number(ci.value) || 0) > volnaHotovost(null)) {
      return toast(esc(tx('hra.na_tohle_nemas_volnou_hotovost')), 'err');
    }
    b.disabled = true;
    apiJson('/trade/offer', { to_id: toId, smer: x.smer, predmet: x.predmet, model: x.model || null,
      spot_id: x.spot_id || null, card_kind: x.card_kind || null, pobocka: x.pobocka || null,
      cena: Number($('na-cena').value) || 0, karty: vybrane(), vzkaz: $('na-vzkaz').value })
      .then(function (r) {
        b.disabled = false;
        if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_33')), 'err');
        closeSheet(); loadTrades(paintBurza); toast(esc(tx('hra.nabidka_odeslana')), 'ok');
      }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida_8')), 'err'); });
  };
}

// ─── Následky uzavřených obchodů ─────────────────────────────────────────────
// Hotovost, sklad a postavené prádlomaty žijí v prohlížeči, takže si je sem
// musíme donést sami. Server si pak poznamená, že je máme vyřízené.
function vyzvedniNasledky(then) {
  if (!ME) { if (then) then(); return; }
  api('/trade/deliveries').then(function (r) {
    var vse = (r.ok && r.j.deliveries) || [];
    if (!vse.length) { if (then) then(); return; }
    // Potvrzení „vyzvedl jsem si to" je jen fire-and-forget požadavek. Když
    // nedojde (vypadne síť, hráč zavře hru), server pošle totéž znovu a hra by
    // si to připsala podruhé — což se stalo u dražby: doplatek se strhl dvakrát.
    // Proto si vedeme seznam už zapsaných doručenek a nespoléháme na server.
    S.vyzvednute = S.vyzvednute || {};
    var d = vse.filter(function (x) { return !S.vyzvednute[x.id]; });
    // Označíme je dřív, než se začnou připisovat peníze, a hned uložíme.
    d.forEach(function (x) { S.vyzvednute[x.id] = 1; });
    var klice = Object.keys(S.vyzvednute);
    if (klice.length > 400) {
      klice.sort(function (a, b) { return Number(a) - Number(b); })
        .slice(0, klice.length - 400)
        .forEach(function (k) { delete S.vyzvednute[k]; });
    }
    save();
    if (!d.length) {
      // Všechno už máme zapsané, jen se to nestihlo potvrdit — přibalíme to
      // k nejbližšímu uložení hry.
      vse.forEach(function (x) { if (NEPOTVRZENE.indexOf(x.id) < 0) NEPOTVRZENE.push(x.id); });
      syncState(true);
      if (then) then();
      return;
    }
    var zpravy = [];
    d.forEach(function (x) {
      if (x.kind === 'cash') {
        S.cash += x.amount || 0;
        zapis('prijem', x.popis || esc(tx('hra.pripsano_na_ucet')), x.amount || 0, 0, x.vzniklo);
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
          var sp = { id: x.spot_id, name: dd.name || esc(tx('hra.koupeny_pradlomat')), kind: dd.kind || 'unknown',
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
    // Nejdřív do fronty k potvrzení, teprve pak uložení — ať jede obojí naráz.
    vse.forEach(function (x) { if (NEPOTVRZENE.indexOf(x.id) < 0) NEPOTVRZENE.push(x.id); });
    save(); paint(); drawMap(); syncState(true);
    if (zpravy.length) toast(zpravy[0] + (zpravy.length > 1 ? tx('veta.dalsich', { p1: (zpravy.length - 1) }) : ''), 'ok', true);
    if (then) then();
  }).catch(function () { if (then) then(); });
}

// ─── Dražby na tržišti ──────────────────────────────────────────────────────
// Obrácená aukce: příhozy cenu snižují. Minuta odpočtu, každý příhoz přidá tři
// vteřiny a vyhrává ten, kdo přihodil naposledy. Okno vyskočí všem, kdo jsou
// zrovna ve hře — proto se na stav ptáme i mimo tržiště.
var DRAZBA = null;          // poslední známý stav ze serveru
var DRAZBA_T = null;        // rychlé dotazování po dobu dražby
var DRAZBA_TIK = null;      // překreslování odpočtu
var DRAZBA_VIDENA = 0;      // kterou dražbu už hráč viděl — ať okno nevyskakuje dokola
var DRAZBA_PREDVOLBY = [1000, 5000, 25000, 100000];
var DRAZBA_MIN = 1000;

function drazbaZbyva() {
  if (!DRAZBA || !DRAZBA.konec) return 0;
  return Math.max(0, new Date(DRAZBA.konec).getTime() - Date.now());
}
function drazbaBezi() { return !!(DRAZBA && DRAZBA.stav === 'bezi' && drazbaZbyva() > 0); }
function hlidejDrazbu() {
  if (!ME || !S || S.tut !== 'done') return;
  // vidim=1 říká serveru, že hráč má okno dražby opravdu před sebou. Schovaná
  // záložka se ptá dál, aby o dražbě věděla, ale mezi diváky nepatří.
  var divam = !document.hidden && !!$('drz-okno');
  api('/trade/drazba' + (divam ? '?vidim=1' : '')).then(function (r) {
    if (!r.ok) return;
    DRAZBA = r.j.drazba || null;
    DRAZBA_PRIHOZY = r.j.prihozy || [];
    if (r.j.predvolby) DRAZBA_PREDVOLBY = r.j.predvolby;
    if (r.j.min) DRAZBA_MIN = r.j.min;
    if (drazbaBezi()) {
      rychleNaDrazbu(true);
      // Vlastní dražbu hráči nevnucujeme, tu spustil sám.
      if (DRAZBA.id !== DRAZBA_VIDENA && !DRAZBA.moje) { DRAZBA_VIDENA = DRAZBA.id; drazbaSheet(); }
      else if ($('drz-okno')) {
        // Okno je otevřené. Celé se překresluje jen když se mění jeho stavba
        // (jiná dražba, nebo hráč začal/přestal vést a mizí mu tlačítka) —
        // jinak by se restartovaly hodiny a tlačítko by zmizelo zpod prstu.
        if (DRZ_STAVBA.id !== DRAZBA.id || DRZ_STAVBA.vedu !== !!DRAZBA.vedu
          || DRZ_STAVBA.moje !== !!DRAZBA.moje
          || DRZ_STAVBA.pv !== (DRAZBA_PREDVOLBY || []).join(',')
          || (DRAZBA.moje && DRZ_STAVBA.pod !== (DRAZBA.suma > DRAZBA.vyvolavaci))) paintDrazba();
        else paintDrazbaZiva();
      }
    } else {
      rychleNaDrazbu(false);
      if (DRAZBA && DRAZBA.stav === 'hotovo' && $('drz-okno')) paintDrazba();
    }
  }).catch(function () { /* dražba hru shodit nesmí */ });
}
var DRAZBA_PRIHOZY = [];
function rychleNaDrazbu(zap) {
  if (zap && !DRAZBA_T) DRAZBA_T = setInterval(hlidejDrazbu, 2000);
  if (!zap && DRAZBA_T) { clearInterval(DRAZBA_T); DRAZBA_T = null; }
}
// Kruh se vztahuje k základní minutě, takže každý příhoz je na něm vidět
// jako kousek, který se vrátí zpátky.
var DRAZBA_ZAKLAD_MS = 60000, DRAZBA_OBVOD = 326.7;
function paintDrazbaHodiny() {
  var el = $('drz-hodiny'), cislo = $('drz-odpocet'), popis = $('drz-odpocet-p'), kruh = $('drz-kruh');
  if (!el || !cislo || !kruh) return;
  var ms = drazbaZbyva(), sek = Math.ceil(ms / 1000);
  // Záporný posun drží konec oblouku na dvanáctce a ukrajuje ho od začátku,
  // takže prázdné místo narůstá po směru hodinových ručiček.
  kruh.setAttribute('stroke-dashoffset',
    String(-DRAZBA_OBVOD * (1 - Math.max(0, Math.min(1, ms / DRAZBA_ZAKLAD_MS)))));
  if (!drazbaBezi()) {
    cislo.textContent = 'konec';
    if (popis) popis.textContent = esc(tx('hra.drazba_dobehla'));
    el.className = 'drz-hodiny dobehlo';
    kruh.setAttribute('stroke-dashoffset', String(-DRAZBA_OBVOD));
    return;
  }
  cislo.textContent = sek;
  if (popis) popis.textContent = sek === 1 ? esc(tx('hra.vterina')) : (sek < 5 ? esc(tx('hra.vteriny_2')) : esc(tx('hra.vterin_3')));
  el.className = 'drz-hodiny' + (ms <= 7000 ? ' dochazi' : ms <= 15000 ? ' spech' : '');
}
// Okno dražby. Překresluje se celé jen při změně dat; odpočet a cena tikají
// zvlášť, aby se pod prstem nepřekreslovala tlačítka.
function drazbaSheet() {
  if (!DRAZBA) return;
  sheet('<div id="drz-okno"></div>');
  paintDrazba();
  if (DRAZBA_TIK) clearInterval(DRAZBA_TIK);
  DRAZBA_TIK = setInterval(function () {
    if (!$('drz-okno')) { clearInterval(DRAZBA_TIK); DRAZBA_TIK = null; return; }
    paintDrazbaHodiny();
    if (DRAZBA && DRAZBA.stav === 'bezi' && drazbaZbyva() <= 0) paintDrazba();
  }, 150);
}
// Stavba posledního vykreslení okna — podle ní se pozná, jestli stačí přepsat
// čísla, nebo se musí postavit celé okno znovu.
var DRZ_STAVBA = { id: null, vedu: false, moje: false, pod: false, pv: '' };
// Strop na příhozy prodávajícího žádný není — dražbu smí držet naživu, jak
// dlouho chce. Zůstává jako funkce kvůli jednomu místu v překreslování.
function drzStrop() { return Infinity; }
// Krátké bliknutí, když se změní jméno vedoucího. Bez toho se v běžící dražbě
// přehodí jméno tak potichu, že si toho nikdo nevšimne.
function drzBlik(el) {
  if (!el) return;
  el.classList.remove('drz-blik');
  void el.offsetWidth;
  el.classList.add('drz-blik');
}
function drzLideHtml(d) {
  // Sám sebe hráč vidí vždycky — server o něm ví z posledního dotazu.
  var oci = Math.max(1, d.divaku || 1), pri = d.prihazujicich || 0;
  return '<span><b>' + tx('veta.b_u_drazby_span_span', { p1: oci, p2: mn(oci, esc(tx('hra.hrac_3')), esc(tx('hra.hraci_3')), esc(tx('hra.hracu_3'))) }) + (pri
        ? '<b>' + pri + '</b> ' + mn(pri, esc(tx('hra.prihazuje')), esc(tx('hra.prihazuji')), esc(tx('hra.prihazuje_2')))
        : esc(tx('hra.zatim_nikdo_neprihodil'))) + '</span>';
}
function drzFeedHtml() {
  return (DRAZBA_PRIHOZY || []).map(function (p) {
    return '<span><i>' + esc(p.nick) + '</i> ' + kc(p.castka) + '</span>';
  }).join('');
}
// Dražba se mění pod rukama. Tohle sahá jen na čísla, ne na stavbu okna.
// Název dražby vidí všichni hráči naráz, takže ho server posílá i jako kód
// s proměnnou částí (ve sloupci data). Složí si ho každý prohlížeč ve svém
// jazyce; u starších dražeb, které kód nemají, zůstane české znění ze serveru.
function drzNazev(d) {
  var k = d && d.data && d.data.nazev_kod;
  if (!k || !k.kod) return (d && d.nazev) || '';
  var v = tx(k.kod, { p1: k.cast, p2: k.pct });
  return v === k.kod ? (d.nazev || '') : v;
}
function paintDrazbaZiva() {
  var d = DRAZBA, box = $('drz-okno');
  if (!d || !box || !drazbaBezi()) return;
  if ($('drz-castka')) $('drz-castka').textContent = kcFull(Math.abs(d.vyvolavaci - d.suma));
  if ($('drz-prihozu-l')) $('drz-prihozu-l').textContent = tx('veta.prihozy', { p1: d.prihozu });
  if ($('drz-suma')) $('drz-suma').textContent = kcFull(d.suma);
  if ($('drz-pod')) $('drz-pod').style.display = d.suma > d.vyvolavaci ? '' : 'none';
  var v = $('drz-vede');
  if (v) {
    var jmeno = d.vedouci_nick || esc(tx('hra.zatim_nikdo')), zmena = v.textContent !== jmeno;
    if (zmena) v.textContent = jmeno;
    // Třída se přepisuje celá, takže bliknutí musí přijít až po ní.
    v.className = d.vedu ? 'ok' : '';
    if (zmena) drzBlik(v);
  }
  if ($('drz-lide')) $('drz-lide').innerHTML = drzLideHtml(d);
  if ($('drz-moje-r')) {
    $('drz-moje-r').style.display = d.moje_prihozy > 0 ? '' : 'none';
    if ($('drz-moje')) $('drz-moje').textContent = kcFull(d.moje_prihozy || 0);
  }
  if ($('drz-feed')) $('drz-feed').innerHTML = drzFeedHtml();
  var volne = Math.max(0, volnaHotovost(null) - (d.moje_prihozy || 0));
  var limit = Math.min(volne, drzStrop(d));
  if ($('drz-volne')) $('drz-volne').textContent = kcFull(volne);
  if ($('drz-strop')) $('drz-strop').textContent = kcFull(drzStrop(d));
  [].forEach.call(box.querySelectorAll('[data-prihoz]'), function (b) {
    var c = Number(b.getAttribute('data-prihoz'));
    b.disabled = c > limit;
    b.className = 'btn sm' + (c > limit ? ' sec' : '');
  });
}
function paintDrazba() {
  var box = $('drz-okno');
  if (!box || !DRAZBA) return;
  var d = DRAZBA, bezi = drazbaBezi();
  var cena = Math.abs(d.vyvolavaci - d.suma);
  var pod = d.suma > d.vyvolavaci;
  if (!bezi) {
    box.innerHTML = '<h3>' + esc(tx('drazba.drazba_skoncila')) + '</h3>'
      + '<p class="muted small">' + esc(drzNazev(d))
      + (d.prodavajici_nick ? tx('veta.vyvolal_2', { p1: esc(d.prodavajici_nick) }) : '') + '</p>'
      + (d.vitez_nick
          ? '<div class="kv souhrn"><span>' + esc(d.vitez_nick) + '</span><b class="ok">'
            + kcFull(d.cena != null ? d.cena : cena) + '</b></div>'
            + '<p class="fine">' + (d.vitez_id === (ME && ME.id)
                ? esc(tx('drazba.vyhral_jsi_vec_i_doplatek'))
                : esc(tx('drazba.vyhral_posledni_prihazujici'))) + '</p>'
          : '<p class="fine">' + esc(tx('drazba.nikdo_neprihodil_vec_zustava_prodavajicimu')) + '</p>')
      + '<button class="btn big" id="drz-ok" style="width:100%;margin-top:10px">' + esc(tx('drazba.zavrit')) + '</button>';
    if ($('drz-ok')) $('drz-ok').onclick = closeSheet;
    return;
  }
  var volne = Math.max(0, volnaHotovost(null) - (d.moje_prihozy || 0));
  var strop = drzStrop(d), limit = Math.min(volne, strop);
  var minim = DRAZBA_MIN || 1000;
  box.innerHTML = tx('veta.h3_drazba', { p1: tx('veta.h3_p_class_muted_small_style_10', { p1: esc(drzNazev(d)), p2: (d.moje ? esc(tx('hra.vyvolal_jsi_ji_ty'))
        : d.tajny_prodavajici ? esc(tx('drazba.kdo_ji_vyvolal_se_ukaze'))
          : tx('veta.vyvolal', { p1: esc(d.prodavajici_nick) })) }) })
    // Hodiny jsou hrdina okna — odpočet rozhoduje, cena je až druhá v pořadí.
    + tx('veta.div_class_drz_hodiny_id_drz', { p1: esc(tx('drazba.vterin')), p2: drzLideHtml(d), p3: esc(tx('drazba.cena_ted')), p4: kcFull(cena), p5: esc(tx('drazba.vyvolavaci_cena')), p6: kcFull(d.vyvolavaci), p7: d.prihozu, p8: kcFull(d.suma) }) + (pod ? '' : ' style="display:none"')
    + tx('veta.prihozy_prerostly_vyvolavaci_cenu_od_tehle') + (d.vedu ? 'ok' : '') + '">'
    + esc(d.vedouci_nick || esc(tx('drazba.zatim_nikdo'))) + '</b></div>'
    + '<div class="kv" id="drz-moje-r"' + (d.moje_prihozy > 0 ? '' : ' style="display:none"')
    + '><span>' + esc(tx('drazba.uz_jsi_prihodil')) + '</span><b class="warn" id="drz-moje">'
    + kcFull(d.moje_prihozy || 0) + '</b></div>'
    + (d.vedu
        ? '<p class="fine ok">' + esc(tx('drazba.vedes_dal_prihazovat_nemuzes_pockej')) + '</p>'
        : '<div class="drz-tl">' + DRAZBA_PREDVOLBY.map(function (c) {
              return '<button class="btn sm' + (c > limit ? ' sec' : '') + '" data-prihoz="' + c + '"'
                + (c > limit ? ' disabled' : '') + '>+' + kc(c) + '</button>';
            }).join('') + '</div>'
            + (d.moje
                ? tx('hra.p_class_fine_tohle_je_tvoje') + (pod
                      ? tx('veta.nad_vyvolavaci_cenou_ti_prihoz_vydela')
                      : tx('veta.dokud_jsou_prihozy_pod_vyvolavaci_cenou'))
                  + tx('hra.prihodit_musis_aspon_tolik_dal_posledni', { p1: kcFull(minim), p2: esc(tx('hra.svou_vlastni_vec_vyhrat_nemuzes')) })
                : tx('hra.p_class_fine_b_b_tolik', { p1: esc(tx('drazba.prihazuje_se_nahoru_aspon')), p2: kcFull(minim), p3: kcFull(volne) })))
    + '<div class="drz-feed" id="drz-feed">' + drzFeedHtml() + '</div>'
    + '<button class="btn sec" id="drz-pryc" style="width:100%;margin-top:10px">' + esc(tx('drazba.zavrit_2')) + '</button>';
  // pod = příhozy přerostly vyvolávací cenu. Prodávajícímu se tím mění text
  // pod tlačítky, takže se okno v tu chvíli musí postavit znovu.
  DRZ_STAVBA = { id: d.id, vedu: !!d.vedu, moje: !!d.moje, pod: pod,
    pv: (DRAZBA_PREDVOLBY || []).join(',') };
  paintDrazbaHodiny();
  if ($('drz-pryc')) $('drz-pryc').onclick = closeSheet;
  [].forEach.call(box.querySelectorAll('[data-prihoz]'), function (b) {
    b.onclick = function () { prihodDrazba(Number(b.getAttribute('data-prihoz')), b); };
  });
}
// Vyvolání dražby: co mám a za kolik to chci vyvolat. Draží se všechno,
// s čím jde obchodovat — včetně podílu v cizí firmě, který hráč jen drží.
function drazbaVyvolatSheet() {
  if (drazbaBezi()) return drazbaSheet();
  // Podíly v cizích firmách žijí v přehledu financí. Když se ještě nestáhl,
  // vypadalo to, že hráč žádný nemá — vyžádáme si ho a okno postavíme potom.
  if (FINANCE == null) {
    sheet('<h3>' + esc(tx('drazba.u_1f528_vyvolat_drazbu')) + '</h3><p class="muted small">' + esc(tx('drazba.nacitam_co_mas')) + '</p>');
    return loadFinance(function () { drazbaVyvolatSheet(); });
  }
  var polozky = [];
  (S.units || []).forEach(function (u) {
    polozky.push({ predmet: 'pradlomat', spot_id: u.spotId,
      popis: esc(jmenoStroje(u.name)), pod: tx('veta.zisk', { p1: (MODELS[u.eco.model] || {}).name, p2: kcFull(u.eco.profit), p3: esc(tx('drazba.mes')) }),
      navrh: cenaPradlomatu(u.eco.profit, u.eco.invest) });
  });
  MODEL_ORDER.forEach(function (k) {
    if (inStock(k) > 0) polozky.push({ predmet: 'stroj', model: k,
      popis: 'stroj ' + MODELS[k].name, pod: inStock(k) + esc(tx('hra.skladem_3')),
      navrh: machinePrice(MODELS[k]) });
  });
  (S.pobocky || []).forEach(function (bq) {
    polozky.push({ predmet: 'pobocka', pobocka: bq.name, popis: tx('veta.pobocka_3', { p1: esc(bq.name) }),
      pod: esc(tx('drazba.zakladna_pro_dopravu_a_cetu')), navrh: POBOCKA_CENA });
  });
  (CARDS_CAT || []).forEach(function (c) {
    if (ownedOf(c.kind) > 0) polozky.push({ predmet: 'karta', card_kind: c.kind,
      popis: tx('hra.karta_x', { p1: polNazev(c) }), pod: ownedOf(c.kind) + esc(tx('hra.k_dispozici_3')), navrh: 100000 });
  });
  ((FINANCE && FINANCE.podily) || []).forEach(function (e) {
    if (e.moje !== 'mam' || !bezici(e)) return;
    polozky.push({ predmet: 'prevod', equity_id: e.id, podil_max: e.podil,
      popis: tx('veta.ve_firme', { p1: pctHra(e.podil), p2: esc(e.kdo_firma || e.kdo) }),
      pod: tx('veta.podil_ktery_drzis_nese', { p1: kcFull(e.mesicne), p2: esc(tx('drazba.mes_jde_drazit_i_po')) }),
      navrh: e.odkup || e.cena });
  });
  polozky.push({ predmet: 'podil', podil: 10, popis: esc(tx('drazba.podil_ve_vlastni_firme')),
    pod: esc(tx('drazba.procento_ze_zisku_i_ze')), navrh: Math.round(hodnotaMojiFirmy().hodnota * 0.1) || 1000000 });

  // Padesát prádlomatů v jednom seznamu se na mobilu neprojde. Napřed tedy
  // kategorie s počty, samotné věci až po rozkliknutí — stejně jako u nabídky.
  var KAT = [
    { k: 'pradlomat', ico: '\u{1F9FA}', nazev: esc(tx('drazba.pradlomaty')), pod: esc(tx('drazba.hotove_provozovny_i_s_mistem')) },
    { k: 'stroj', ico: '\u{1F4E6}', nazev: esc(tx('hra.stroje_2')), pod: esc(tx('drazba.co_mas_skladem')) },
    { k: 'pobocka', ico: '\u{1F3E2}', nazev: esc(tx('drazba.pobocky')), pod: esc(tx('drazba.zakladny_pro_dopravu_a_cetu')) },
    { k: 'karta', ico: '\u26A1', nazev: esc(tx('hra.karty_2')), pod: esc(tx('drazba.zrychlovace_cekani')) },
    { k: 'prevod', ico: '\u{1F4C8}', nazev: esc(tx('drazba.podily_v_cizich')), pod: esc(tx('drazba.co_drzis_v_cizich_firmach')) },
    { k: 'podil', ico: '\u{1F3E6}', nazev: esc(tx('drazba.podil_ve_sve_firme')), pod: esc(tx('drazba.procento_ze_zisku_i_ztraty')) }
  ];
  var hlava = '<h3>' + tx('veta.h3_p_class_muted_small_b', { p1: esc(tx('drazba.u_1f528_vyvolat_drazbu_2')), p2: esc(tx('hra.drazba_bezi_minutu_a_kazdy')), p3: esc(tx('hra.prihozy_cenu')), p4: esc(tx('drazba.snizuji')), p5: esc(tx('drazba.vyskoci_vsem_kdo_jsou_zrovna')) });
  var vKategorii = function (k) {
    return polozky.filter(function (x) { return x.predmet === k; });
  };
  var rozcestnik = function () {
    sheet(hlava + '<div class="rozc">' + KAT.map(function (c) {
      var n = c.k === 'podil' ? null : vKategorii(c.k).length;
      var pod = n == null ? c.pod : (n ? n + esc(tx('drazba.u00d7_k_drazbe')) : esc(tx('drazba.nemas_zadne')));
      return '<button type="button" class="rozc-b' + (n === 0 ? ' prazdna' : '')
        + '" data-drz-k="' + c.k + '"><i>' + c.ico + '</i>'
        + '<b>' + c.nazev + '</b><span>' + esc(pod) + '</span></button>';
    }).join('') + '</div>');
    [].forEach.call($('sheet-body').querySelectorAll('[data-drz-k]'), function (b) {
      b.onclick = function () { kategorie(b.getAttribute('data-drz-k')); };
    });
  };
  var kategorie = function (k) {
    var v = vKategorii(k), c = KAT.filter(function (x) { return x.k === k; })[0] || {};
    if (k === 'podil') return drazbaCenaSheet(v[0]);
    if (!v.length) return rozcestnik();
    sheet('<h3>' + c.ico + ' ' + esc(c.nazev) + '</h3>'
      + '<p class="muted small">' + esc(tx('drazba.vyber_co_das_do_drazby')) + '</p>'
      + '<div style="margin-top:10px">' + v.map(function (x) {
          return '<div class="area-item" data-drz-p="' + polozky.indexOf(x) + '">'
            + '<div style="min-width:0"><div class="nm">' + x.popis + '</div>'
            + '<div class="sub">' + x.pod + '</div></div>'
            + '<b class="cena">' + kc(Math.max(10000, Math.round(x.navrh || 100000))) + '</b></div>';
        }).join('') + '</div>'
      + '<button class="btn sec" id="drz-zpet" style="width:100%;margin-top:12px">' + esc(tx('drazba.zpatky_na_vyber')) + '</button>');
    if ($('drz-zpet')) $('drz-zpet').onclick = rozcestnik;
    [].forEach.call($('sheet-body').querySelectorAll('[data-drz-p]'), function (b) {
      b.onclick = function () { drazbaCenaSheet(polozky[Number(b.getAttribute('data-drz-p'))]); };
    });
  };
  rozcestnik();
}
// Procenta ve hře: 0,05 → „5", 0,025 → „2,5". Musí sedět s pct() na serveru.
function pctHra(x) { return String(Math.round((Number(x) || 0) * 1000) / 10).replace('.', desZnak()); }
function drazbaCenaSheet(x) {
  var jePodil = x.predmet === 'podil';
  // Držený podíl v cizí firmě jde rozdražit po kouskách — nabídneme stejné
  // políčko jako u vlastní firmy, jen se stropem na tom, co hráč opravdu drží.
  var jePrevod = x.predmet === 'prevod' && Number(x.podil_max) > 0;
  var maxPct = jePrevod ? Math.round(Number(x.podil_max) * 1000) / 10 : 100;
  // Základ, ke kterému se váže navržená cena: u vlastní firmy deset procent,
  // u drženého podílu celý balík. Od něj se cena přepočítává.
  var zakladPct = jePodil ? 10 : maxPct;
  var vychozi = jePodil ? 10 : maxPct;
  var krok = jePrevod && maxPct < 1 ? 0.1 : 1;
  sheet('<h3>' + esc(tx('drazba.vyvolavaci_cena_2')) + '</h3>'
    + '<p class="muted small">' + x.popis + '</p>'
    + (jePodil || jePrevod
        ? tx('veta.label_class_fld_span_kolik_procent', { p1: (jePrevod ? ' ' + esc(tx('drazba.z_podilu_pustis')) : ' firmy'), p2: Math.min(1, maxPct), p3: maxPct, p4: krok, p5: vychozi, p6: (jePrevod ? tx('hra.p_class_fine_drzis_co_nevydrazis', { p1: pctHra(x.podil_max) }) : '') })
        : '')
    + tx('veta.label_class_fld_span_span_input', { p1: esc(tx('drazba.vyvolavaci_cena_l')), p2: Math.max(10000, Math.round(x.navrh || 100000)), p3: esc(tx('drazba.spustit_drazbu')) }));
  var rada = function () {
    var c = Math.max(0, Math.round(Number($('drz-cena-in').value) || 0));
    $('drz-rada').textContent = tx('veta.pri_prihozech_za', { p1: tx('veta.zaplati_vitez_a_ty_dostanes_kdyz', { p1: kcFull(Math.round(c / 2)), p2: kcFull(Math.round(c / 2)), p3: kcFull(c) }) });
  };
  // Když hráč ubere procenta, musí jít dolů i cena — jinak by za procento
  // chtěl tolik, co za celý balík, a nikdo by nepřihodil.
  var dlePodilu = function () {
    if (!$('drz-podil') || !(zakladPct > 0)) return;
    var p = Number($('drz-podil').value) || 0;
    if (!(p > 0)) return;
    $('drz-cena-in').value = Math.max(10000,
      Math.round((Number(x.navrh) || 100000) * p / zakladPct));
    rada();
  };
  if ($('drz-podil')) $('drz-podil').oninput = dlePodilu;
  $('drz-cena-in').oninput = rada; rada();
  $('drz-start').onclick = function () {
    var b = $('drz-start');
    var telo = { predmet: x.predmet, model: x.model, spot_id: x.spot_id, pobocka: x.pobocka,
      card_kind: x.card_kind, equity_id: x.equity_id,
      vyvolavaci: Math.max(0, Math.round(Number($('drz-cena-in').value) || 0)) };
    if (jePodil) {
      telo.podil = Math.max(1, Math.min(100, Math.round(Number($('drz-podil').value) || 10))) / 100;
    } else if (jePrevod) {
      var pp = Number($('drz-podil').value) || maxPct;
      telo.podil = Math.max(0.001, Math.min(Number(x.podil_max),
        Math.round(pp * 10) / 1000));
    }
    b.disabled = true; b.textContent = esc(tx('drazba.spoustim'));
    apiJson('/trade/drazba', telo).then(function (r) {
      b.disabled = false; b.textContent = esc(tx('drazba.spustit_drazbu_2'));
      if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_34')), 'err');
      DRAZBA = r.j.drazba; DRAZBA_PRIHOZY = []; DRAZBA_VIDENA = DRAZBA.id;
      rychleNaDrazbu(true);
      drazbaSheet();
    }).catch(function () { b.disabled = false; b.textContent = esc(tx('drazba.spustit_drazbu_3')); toast(esc(tx('drazba.server_neodpovida')), 'err'); });
  };
}
function prihodDrazba(castka, b) {
  if (!drazbaBezi()) return toast(esc(tx('hra.drazba_uz_skoncila')), 'err');
  if (b) b.disabled = true;
  apiJson('/trade/drazba/prihoz', { castka: castka }).then(function (r) {
    if (b) b.disabled = false;
    if (!r.ok) { hlidejDrazbu(); return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_35')), 'err'); }
    DRAZBA = r.j.drazba;
    DRAZBA.moje_prihozy = r.j.moje_prihozy;
    // Příhozem se zvedlo minimum — tlačítka se musí přepsat na nový žebřík.
    if (r.j.predvolby) DRAZBA_PREDVOLBY = r.j.predvolby;
    if (r.j.min) DRAZBA_MIN = r.j.min;
    DRAZBA_PRIHOZY = [{ nick: (ME && ME.nick) || 'ty', castka: castka }].concat(DRAZBA_PRIHOZY || []).slice(0, 6);
    // Bez hlášky: nové minimum je vidět rovnou na tlačítkách a v textu pod nimi,
    // a toast by v poslední vteřině dražby přikryl zrovna ta tlačítka.
    paintDrazba();
  }).catch(function () { if (b) b.disabled = false; toast(esc(tx('hra.server_neodpovida_33')), 'err'); });
}

// ─── Podržení prstu na mapě ─────────────────────────────────────────────────
// Hráč podrží prst nad městem a rovnou mu naskočí průzkum s vyplněným názvem.
// Dlouhý stisk si hlídáme sami: `contextmenu` se na mobilech chová pokaždé
// jinak a spoléhat se na něj nejde.
function dlouhyStisk(el, cb) {
  var t = null, x0 = 0, y0 = 0, pohyb = false;
  function zrus() { if (t) { clearTimeout(t); t = null; } }
  el.addEventListener('touchstart', function (e) {
    if (!e.touches || e.touches.length !== 1) return zrus();
    var p = e.touches[0], cil = e.target;
    x0 = p.clientX; y0 = p.clientY; pohyb = false;
    zrus();
    t = setTimeout(function () { if (!pohyb) cb(x0, y0, cil); }, 550);
  }, { passive: true });
  el.addEventListener('touchmove', function (e) {
    var p = e.touches && e.touches[0];
    if (!p) return;
    // Posun prstem je tah mapy, ne podržení — pár pixelů ale tolerujeme.
    if (Math.abs(p.clientX - x0) > 12 || Math.abs(p.clientY - y0) > 12) { pohyb = true; zrus(); }
  }, { passive: true });
  ['touchend', 'touchcancel'].forEach(function (n) {
    el.addEventListener(n, zrus, { passive: true });
  });
  // Na počítači je to pravé tlačítko.
  el.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    cb(e.clientX, e.clientY, e.target);
  });
}
var MISTO_CEKA = false;
function mapaPodrzeni(x, y, cil) {
  if (!map || MISTO_CEKA || !S) return;
  // Nad špendlíkem nebo tlačítkem se nic nespouští — tam má podržení svůj smysl.
  if (cil && cil.closest && cil.closest('.leaflet-marker-icon, button, .map-vrstva, .map-hint')) return;
  if (S.tut !== 'done') return;
  if (!$('sheet').classList.contains('hidden')) return;
  var box = $('map').getBoundingClientRect();
  var bod = map.containerPointToLatLng([x - box.left, y - box.top]);
  MISTO_CEKA = true;
  toast(esc(tx('hra.koukam_co_je_to_tam')), 'ok');
  api('/misto-podle?lat=' + bod.lat.toFixed(5) + '&lon=' + bod.lng.toFixed(5)).then(function (r) {
    MISTO_CEKA = false;
    if (r.ok && r.j.name) {
      // Co už je prozkoumané, nemá cenu hledat znovu — rovnou tam skočíme.
      var mam = null;
      Object.keys(S.areas || {}).forEach(function (id) {
        if (S.areas[id].name === r.j.name) mam = S.areas[id];
      });
      if (mam && mam.lat) {
        map.setView([mam.lat, mam.lon], MISTA_ZOOM);
        return toast(tx('veta.uz_mas_prozkoumane', { p1: r.j.name }), 'ok');
      }
      return areasSheet(r.j.name);
    }
    areasSheet();
    toast((r.j && r.j.error) || esc(tx('hra.tady_zadne_mesto_nevidim_napis')), 'err');
  }).catch(function () {
    MISTO_CEKA = false; areasSheet(); toast(esc(tx('hra.server_neodpovida_29')), 'err');
  });
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
$('open-areas').onclick = function () { areasSheet(); };
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
[].forEach.call(document.querySelectorAll('[data-misto]'), function (b) {
  b.onclick = function () {
    MISTA_FILTR = b.getAttribute('data-misto');
    [].forEach.call(document.querySelectorAll('[data-misto]'), function (x) { x.classList.toggle('on', x === b); });
    paintMista();
  };
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

// ─── Úvodní obrazovka: A/B test ──────────────────────────────────────────────
// A = původní úvod, B = nadpis „Postav první prádlomat za 60 sekund", jméno a tlačítko hned nahoře,
// pod nimi skutečný počet hráčů (social proof) a zbytek úvodu níž. Režim přepíná administrace
// (off / 50 / b). game_intro = návštěvník úvod opravdu viděl (správný jmenovatel konverze na registraci).
var AB_KEY = 'lt_ab_intro';
function introAB() {
  // Úvod je od téhle chvíle na obrazovce a nic ho už nepřebije. Hlásíme to
  // hned, ne až po odpovědi serveru — dvě kolečka na server (/account/me
  // a /intro, k tomu 2,5s pojistka) trvají na mobilu dost na to, aby se
  // návštěvník stihl otočit a v číslech pak chyběl, i když úvod viděl.
  ev('game_intro');
  var hotovo = false;
  var dokonci = function (cfg) {
    if (hotovo) return; hotovo = true;
    cfg = cfg || {};
    var rezim = cfg.ab === '50' || cfg.ab === 'b' ? cfg.ab : 'off', v = 'a';
    if (rezim === 'b') v = 'b';
    else if (rezim === '50') {
      try { v = localStorage.getItem(AB_KEY); } catch (e) { v = null; }
      if (v !== 'a' && v !== 'b') { v = Math.random() < 0.5 ? 'a' : 'b'; try { localStorage.setItem(AB_KEY, v); } catch (e) { /* bez úložiště */ } }
    }
    if (v === 'b') introVariantaB(cfg);
    if (rezim !== 'off') ev('game_ab_' + v);
  };
  api('/intro').then(function (r) { dokonci(r && r.ok ? r.j : null); }).catch(function () { dokonci(null); });
  setTimeout(function () { dokonci(null); }, 2500);   // server mlčí → původní úvod, nečekáme
}
function introPlural(n, a, b, c) { return n === 1 ? a : (n >= 2 && n <= 4 ? b : c); }
function introVariantaB(cfg) {
  try {
    var box = document.querySelector('#intro .intro-in'); if (!box || box.querySelector('.ib-hero')) return;
    var online = Number(cfg.online) || 0, firem = Number(cfg.firem) || 0, proof = '';
    if (online >= 5) proof = '<span class="ib-dot"></span>' + esc(tx('hra.prave_hraje')) + ' ' + '<b>' + online + '</b> ' + introPlural(online, esc(tx('hra.hrac_2')), esc(tx('hra.hraci_2')), esc(tx('hra.hracu_2'))) + (firem >= 20 ? tx('veta.b_b_uz_stavi', { p1: firem, p2: introPlural(firem, 'firma', 'firmy', 'firem') }): '');
    else if (firem >= 20) proof = '<b>' + tx('veta.b_svou_sit', { p1: firem, p2: introPlural(firem, esc(tx('hra.firma_uz_stavi')), esc(tx('hra.firmy_uz_stavi')), esc(tx('hra.firem_uz_stavi'))) });
    var hero = document.createElement('div');
    hero.className = 'ib-hero';
    hero.innerHTML = '<h2 class="ib-h">' + esc(tx('hra.postav_prvni_pradlomat')) + ' ' + '<span class="g">' + 'za 60 sekund' + '</span></h2>'
      + '<p class="ib-sub">' + esc(tx('hra.skutecna_mapa_skutecna_ekonomika_hrajes')) + '</p>'
      + (proof ? '<div class="ib-proof">' + proof + '</div>' : '');
    var brand = box.querySelector('.brand'), jmeno = box.querySelector('.intro-jmeno'), go = $('go-quiz'), login = $('go-login');
    var zbytek = ['.hero-flex', '.lead', '.intro-pts', '#sb'].map(function (q) { return box.querySelector(q); }).filter(Boolean);
    var kotva = brand ? brand.nextSibling : box.firstChild;
    box.insertBefore(hero, kotva);
    [jmeno, go, login].forEach(function (el) { if (el) box.insertBefore(el, kotva); });
    zbytek.forEach(function (el) { box.insertBefore(el, kotva); });
    $('intro').classList.add('ab-b');
  } catch (e) { /* úvod musí fungovat i bez varianty B */ }
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
  if (!st.pocet) v.push(esc(tx('hra.zatim_nic_nepostavil')));
  else {
    var sk = st.mista.reduce(function (a, m) { return a + (m.score || 0); }, 0) / st.pocet;
    v.push(tx('veta.prumerne_skore_mist', { p1: Math.round(sk) }));
    var modely = {}; st.mista.forEach(function (m) { modely[m.model] = (modely[m.model] || 0) + 1; });
    v.push('stroje: ' + Object.keys(modely).map(function (k) { return k + '×' + modely[k]; }).join(', '));
  }
  var majetek = assetsTotal();
  if (majetek > 0) v.push(tx('veta.dluh_je_majetku', { p1: Math.round((st.dluh / majetek) * 100) }));
  if (st.splatky > 0) v.push(tx('veta.hotovost_pokryje_splatky', { p1: (st.cash / st.splatky).toFixed(1).replace('.', desZnak()) }));
  else if (!st.dluh) v.push(esc(tx('hra.nema_zadny_uver')));
  if (st.poruchy) v.push(esc(tx('hra.nechava_stat_porouchane_stroje')));
  return v.join(', ');
}
function poradceOtazky() {
  if (!(S.units || []).length) {
    return [esc(tx('hra.jak_mam_zacit')), esc(tx('hra.jak_poznam_dobre_misto')), esc(tx('hra.mam_si_na_prvni_pradlomat'))];
  }
  var q = [esc(tx('hra.co_mam_postavit_dal')), esc(tx('hra.jak_si_stojim'))];
  if (S.loan > 0) q.push(esc(tx('hra.nemam_moc_dluhu')));
  if (maRamec()) q.push(esc(tx('hra.jak_funguje_ramcovy_uver'))); else q.push(esc(tx('hra.jak_se_dostanu_k_ramcovemu')));
  if ((S.units || []).some(function (u) { return !!u.porucha; })) q.push(esc(tx('hra.co_mam_delat_s_poruchou')));
  else q.push(esc(tx('hra.vyplati_se_mi_neco_prodat')));
  return q.slice(0, 4);
}
function poradceSheet() {
  PORADCE_CEKA = false;
  sheet(tx('veta.h3_ud83d_udca1_poradce_h3_p'));
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
  if (PORADCE_CEKA) h += '<div class="por-z ai cekam">' + esc(tx('hra.premyslim_u2026')) + '</div>';
  if (!h) h = '<div class="por-uvod">' + esc(tx('hra.nevis_kde_zacit_klikni_na')) + '</div>';
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
  // Jazyk posílá hra — poradce sedí na veřejné cestě, kde se hráč nepřihlašuje,
  // takže by jinak odpovídal vždycky česky.
  apiJson('/poradce', { otazka: q, stav: poradceStav(), jazyk: JAZYK,
    historie: PORADCE_H.slice(0, -1).slice(-6) })
    .then(function (r) {
      PORADCE_CEKA = false;
      var j = r.j || {};
      if (j.ok && j.text) PORADCE_H.push({ role: 'ai', text: j.text });
      else PORADCE_H.push({ role: 'ai', text: j.error || esc(tx('hra.poradce_ted_nemuze_odpovedet_zkus')) });
      poradcePaint();
    })
    .catch(function () {
      PORADCE_CEKA = false;
      PORADCE_H.push({ role: 'ai', text: esc(tx('hra.server_neodpovida_zkus_to_za_3')) });
      poradcePaint();
    });
}

// Otisk zařízení pro ochranu proti multi účtům (posílá se v hlavičkách, hráči
// se nikde neukazuje). fp = prohlížeč (canvas, WebGL, písma, obrazovka, jazyk…),
// hw = hardware (WebGL čip, obrazovka, jádra, paměť, časová zóna) — přežije
// smazání dat i jiný prohlížeč na stejném zařízení. Počítá se jednou.
var OTISK = null;
function otisk() {
  if (OTISK) return OTISK;
  var h = function (str) { var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822507); } return ((a >>> 0).toString(36) + (b >>> 0).toString(36)).slice(0, 20); };
  var cv = '', gl = '', fonty = '';
  try { var c = document.createElement('canvas'); c.width = 240; c.height = 60; var x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(100, 1, 62, 20); x.fillStyle = '#069'; x.fillText('Laundromat Tycoon ✓ ž 9', 2, 15);
    x.fillStyle = 'rgba(102,204,0,0.7)'; x.font = '18px Georgia'; x.fillText('Pračka 18 kg €', 4, 32); cv = c.toDataURL(); } catch (e) { /* bez canvasu */ }
  try { var g = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl');
    if (g) { var d = g.getExtension('WEBGL_debug_renderer_info'); gl = [d ? g.getParameter(d.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR), d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER), g.getParameter(g.MAX_TEXTURE_SIZE), g.getParameter(g.MAX_RENDERBUFFER_SIZE)].join('|'); } } catch (e) { /* bez WebGL */ }
  try { var m = document.createElement('canvas').getContext('2d'), zaklad = 'mmmmmmmmmmlli1WW', sir = function (f) { m.font = '72px ' + f; return m.measureText(zaklad).width; }, b0 = sir('monospace');
    fonty = ['Arial', 'Calibri', 'Cambria', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Ubuntu', 'Tahoma', 'Verdana', 'Courier New', 'Comic Sans MS', 'SF Pro Text', 'Noto Sans', 'Georgia', 'Trebuchet MS']
      .map(function (f) { return sir("'" + f + "',monospace") !== b0 ? 1 : 0; }).join(''); } catch (e) { /* bez písem */ }
  var n = navigator || {}, sc = screen || {}, tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* nevadí */ }
  var hw = [gl, sc.width + 'x' + sc.height + 'x' + sc.colorDepth, window.devicePixelRatio, n.hardwareConcurrency, n.deviceMemory, tz, n.maxTouchPoints, n.platform].join('#');
  OTISK = { fp: h([hw, cv, fonty, (n.languages || []).join(','), n.userAgent].join('#')), hw: h(hw) };
  return OTISK;
}
function hlavickyZarizeni() {
  var o = {}; try { var ot = otisk(); o['X-LM-Fp'] = ot.fp; o['X-LM-Hw'] = ot.hw; var d = trvalePid(); if (d) o['X-LM-Dev'] = d; } catch (e) { /* nevadí */ }
  return o;
}
function api(path, opts) {
  opts = Object.assign({}, opts || {});
  opts.headers = Object.assign({}, opts.headers || {}, hlavickyZarizeni());
  return fetch('/api/game' + path, Object.assign({ credentials: 'same-origin' }, opts))
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
}
// ─── Překlady ────────────────────────────────────────────────────────────────
// Jazyk drží účet, ne prohlížeč — hráč hraje na telefonu i na počítači a chce
// to mít stejně. Katalog se tahá ze serveru; než dorazí, jede hra na češtině
// zadrátované v kódu, takže se při výpadku nestane vůbec nic.
// tx('drazba.vyvolal', { nick: 'Lord-P' }) vrátí hotovou větu.
// Katalog se po drátě netahá vůbec — oba jazyky jsou ve stránce dřív než hra.
// Zůstává jen kvůli volajícím, kteří čekají, že si texty vyžádají.
function nactiTexty(jazyk, pak) {
  if (pak) pak();
}
function nactiTextyPoDrate(jazyk, pak) {
  var j = jazyk || 'cs';
  if (!PREKLADY) { JAZYK = 'cs'; if (pak) pak(); return; }
  if (j === 'cs') { JAZYK = 'cs'; if (pak) pak(); return; }
  api('/texty/' + encodeURIComponent(j)).then(function (r) {
    if (r.ok && r.j && r.j.texty) {
      PREKLADY.nastav(r.j.jazyk || j, r.j.texty);
      JAZYK = r.j.jazyk || j;
    }
    if (pak) pak();
  }).catch(function () { if (pak) pak(); });
}
// Jazyk se přepíná znovunačtením stránky. Datové tabulky v tomhle souboru
// se počítají jen jednou, při načtení — překreslení by je nechalo české.
// Rozehraná hra se napřed uloží, ať se o nic nepřijde.
function prepniJazyk(j, pak) {
  apiJson('/account/jazyk', { jazyk: j }).then(function (r) {
    if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_4')), 'err');
    if (ME) ME.jazyk = j;
    toast((r.j && r.j.hlaska) || esc(tx('hra.hotovo_3')), 'ok');
    var dal = function () { location.reload(); };
    if (S) { try { save(); } catch (e) { /* uložit se nemuselo povést */ } syncState(true).then(dal, dal); }
    else dal();
    if (pak) pak();
  }).catch(function () { toast(esc(tx('hra.server_neodpovida_34')), 'err'); });
}

function apiJson(path, body, method, extra) {
  return api(path, Object.assign({ method: method || 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, extra || {}));
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
// Doručenky, které jsme si zapsali do stavu, ale server o tom ještě neví.
// Jedou s nejbližším uložením hry, aby se potvrzení a zápis staly naráz —
// bez toho projde jedno bez druhého a peníze se připíšou dvakrát.
var NEPOTVRZENE = [];
// Zaseknutý požadavek nesmí ukládání zastavit navždy. Na mobilu se fetch při
// přepnutí sítě (5G ↔ Wi-Fi) umí nevrátit vůbec — a protože se další uložení
// pouští jen když zrovna žádné neběží, hra by sice běžela dál, ale na server
// by se nic neuložilo. Hráč by viděl svoje čísla, všichni ostatní jeho hodinu
// starý stav, a o postup by přišel při příštím načtení.
// Pozor na pořadí: strážce musí počkat déle, než trvá vlastní timeout, jinak
// by zahazoval uložení, která ještě mají šanci dojít. Velký stav na pomalém
// mobilu umí letět i půl minuty, takže je tu čas vrchovatě.
var SYNC_ZASEK_MS = 30000;     // po téhle době se zaseknuté uložení zahodí
var SYNC_TIMEOUT_MS = 25000;   // a tolik se na odpověď vůbec čeká
var syncBusyAt = 0, syncOk = 0, syncVarovano = 0;
// Proč se neukládá. Bez toho hráč i my vidíme jen „neuložilo se" a hádáme.
var SYNC_CHYBA = null;
// Počitadla, ze kterých se pozná, kde se to zaseklo: kolik pokusů se vůbec
// rozjelo, kolik jich doběhlo (ať už dobře, nebo chybou) a jaký byl poslední
// stavový kód. Když je pokusů hodně a odpovědí nula, neodpovídá server; když
// je nula i pokusů, hra uložení vůbec nepustila a chyba je na naší straně.
var SYNC_POKUSU = 0, SYNC_ODPOVEDI = 0, SYNC_STATUS = null;
var SYNC_SITE_PO_SOBE = 0, SYNC_KONFLIKTU_PO_SOBE = 0;   // krátký výpadek ani jednorázový konflikt se nehlásí
// Chyby ukládání a hry se hráči neukazují — jdou tiše na server do adminu hry
// (záložka Chyby). Stejná chyba se z jednoho zařízení hlásí nejvýš jednou za 10 minut;
// co se nepovede odeslat (výpadek sítě), čeká ve frontě a odejde s dalším hlášením.
var CHYBY_FRONTA = [], CHYBY_POSLANO = {}, CHYBY_ODESILANI = false, CHYBY_JS = 0;
function hlasChybu(typ, text, detail) {
  try {
    var klic = typ + '|' + String(text || '').slice(0, 80), ted = Date.now();
    if (CHYBY_POSLANO[klic] && ted - CHYBY_POSLANO[klic] < 600000) return;
    CHYBY_POSLANO[klic] = ted;
    var d = Object.assign({ online: navigator.onLine !== false, skryto: !!document.hidden,
      ua: String(navigator.userAgent || '').slice(0, 160), cesta: location.pathname,
      kb: S ? Math.round(JSON.stringify(S).length / 1024) : null }, detail || {});
    CHYBY_FRONTA.push({ typ: typ, text: String(text || '').slice(0, 300), detail: d, kdy: new Date().toISOString() });
    if (CHYBY_FRONTA.length > 20) CHYBY_FRONTA.shift();
    odesliChyby();
  } catch (e) { /* hlášení chyb nesmí rozbít hru */ }
}
function odesliChyby() {
  if (CHYBY_ODESILANI || !CHYBY_FRONTA.length || !ME) return;
  CHYBY_ODESILANI = true;
  var davka = CHYBY_FRONTA.slice(0, 10);
  apiJson('/account/chyba', { chyby: davka }).then(function (r) {
    CHYBY_ODESILANI = false;
    if (r && r.ok) { CHYBY_FRONTA.splice(0, davka.length); if (CHYBY_FRONTA.length) odesliChyby(); }
  }).catch(function () { CHYBY_ODESILANI = false; });
}
window.addEventListener('error', function (e) {
  if (CHYBY_JS++ < 10) hlasChybu('js', (e && e.message) || 'chyba skriptu', { zdroj: String((e && e.filename) || '').split('/').pop(), radek: e && e.lineno, sloupec: e && e.colno });
});
window.addEventListener('unhandledrejection', function (e) {
  if (CHYBY_JS++ < 10) hlasChybu('js-promise', String((e && e.reason && (e.reason.message || e.reason)) || esc(tx('hra.odmitnuty_slib'))), {});
});
function syncState(force) {
  if (wiped || !ME || !S) return Promise.resolve();
  if (syncBusy) {
    if (Date.now() - syncBusyAt < SYNC_ZASEK_MS) return Promise.resolve();
    syncBusy = false;   // předchozí uložení se nevrátilo, zkusíme znovu
  }
  // Hra na pozadí (druhá záložka, telefon v kapse) neukládá — jinak by svým
  // starým stavem přepsala to, co hráč zrovna dělá jinde. Výjimka je poslední
  // uložení při odchodu, to si vynutíme přes force.
  if (!force && document.hidden) return Promise.resolve();
  if (!force && Date.now() - syncAt < 15000) return Promise.resolve();
  syncBusy = true; syncAt = Date.now(); syncBusyAt = syncAt; SYNC_POKUSU++;
  // Vlastní strážce na úrovni požadavku: když server mlčí, spojení přerušíme
  // a pustíme ho příště znovu.
  var prerus = null;
  try {
    var ac = new AbortController();
    prerus = setTimeout(function () { try { ac.abort(); } catch (e) { /* nevadí */ } }, SYNC_TIMEOUT_MS);
    var signal = ac.signal;
  } catch (e) { /* starý prohlížeč bez AbortController — jede se bez toho */ }
  // aktivni říká serveru, jestli má hráč hru doopravdy před sebou — podle toho
  // se počítá čas strávený ve hře.
  var potvrzuju = NEPOTVRZENE.slice(0, 50);
  return apiJson('/account/state', { state: S, aktivni: !document.hidden, rev: STATE_REV,
    vyzvednuto: potvrzuju }, 'PUT', signal ? { signal: signal } : null)
    .then(function (r) {
      syncBusy = false;
      SYNC_ODPOVEDI++; SYNC_STATUS = r.status;
      if (prerus) clearTimeout(prerus);
      if (r.ok) {
        syncOk = Date.now(); syncVarovano = 0; SYNC_CHYBA = null; SYNC_SITE_PO_SOBE = 0; SYNC_KONFLIKTU_PO_SOBE = 0; odesliChyby();
        // Server stav uložil a ve stejném zápisu potvrdil doručenky.
        NEPOTVRZENE = NEPOTVRZENE.filter(function (id) { return potvrzuju.indexOf(id) < 0; });
        if (r.j && r.j.rev != null) STATE_REV = r.j.rev;
        return;
      }
      if (r.status === 409 && r.j) {
        // Jinde je novější hra. Vezmeme ji — svoje poslední vteřiny raději
        // obětujeme než cizí postup z druhého zařízení.
        // Konflikt není ztráta spojení, ale uložení taky neproběhlo. Když se
        // takhle točí dokola, hraje hráč na dvou místech a jeho postup padá
        // pod stůl — hlídač neukládání to pak řekne i s důvodem.
        SYNC_CHYBA = esc(tx('hra.hru_mas_rozehranou_i_jinde'));
        // Jednorázový konflikt je normální (druhé zařízení); hlásí se až když se opakuje.
        if (++SYNC_KONFLIKTU_PO_SOBE >= 3) hlasChybu('ulozeni-konflikt', SYNC_CHYBA, { status: 409, po_sobe: SYNC_KONFLIKTU_PO_SOBE });
        if (prevezmiStav(r.j.state, r.j.rev)) {
          // Náš zápis propadl i s doručenkami — ty zůstanou na serveru
          // nepotvrzené a přijdou znovu k tomu stavu, který vyhrál.
          NEPOTVRZENE = [];
          toast(esc(tx('hra.tuhle_hru_mas_rozehranou_i')), 'ok');
        } else if (r.j.rev != null) { STATE_REV = r.j.rev; }
        return;
      }
      // Cokoli jiného než 409 se dosud mlčky zahodilo. Server přitom posílá
      // důvod — je potřeba ho vidět, jinak se dlouhé neukládání nedá vysvětlit.
      SYNC_CHYBA = (r.j && r.j.error) ? r.j.error : (tx('veta.server_odpovedel', { p1: r.status }));
      if (r.status === 413) {
        SYNC_CHYBA = tx('veta.stav_hry_je_na_server_moc', { p1: Math.round(JSON.stringify(S).length / 1024) });
      }
      hlasChybu('ulozeni', SYNC_CHYBA, { status: r.status });
      console.warn(esc(tx('hra.hra_ulozeni_selhalo')), r.status, SYNC_CHYBA);
    })
    .catch(function (err) {
      syncBusy = false;
      SYNC_ODPOVEDI++;
      if (prerus) clearTimeout(prerus);
      SYNC_CHYBA = (err && err.name === 'AbortError')
        ? tx('veta.server_neodpovedel_do_s', { p1: Math.round(SYNC_TIMEOUT_MS / 1000) }): esc(tx('hra.spojeni_se_serverem_se_nepovedlo'));
      // Krátký výpadek sítě (5G ↔ Wi-Fi, tunel) se hlásí až při třetím selhání za sebou.
      if (++SYNC_SITE_PO_SOBE >= 3) hlasChybu((err && err.name === 'AbortError') ? 'ulozeni-timeout' : 'ulozeni-sit', SYNC_CHYBA, { zprava: err && err.message, po_sobe: SYNC_SITE_PO_SOBE });
      console.warn(esc(tx('hra.hra_ulozeni_selhalo_2')), SYNC_CHYBA, err && err.message);
    });
}
// Když se hra dlouho neuloží, musí to hráč vědět. Jinak hraje dál do stavu,
// o který při příštím načtení přijde, a v žebříčku svítí stará čísla.
var SYNC_TICHO_MS = 180000;
function hlidejUkladani() {
  if (wiped || !ME || !S || document.hidden) return;
  if (!syncOk) { syncOk = Date.now(); return; }
  var ticho = Date.now() - syncOk;
  // Po minutě ticha zkusíme uložit natvrdo. Vynucené uložení obejde brzdu
  // patnácti vteřin i pravidlo „na pozadí se neukládá", takže ani jedno
  // z nich nemůže být příčinou dlouhého ticha.
  if (ticho > 60000) syncState(true);
  if (ticho < SYNC_TICHO_MS) return;
  if (Date.now() - syncVarovano < 300000) return;
  syncVarovano = Date.now();
  // Do hlášky patří i počitadla — bez nich se nedá poznat, jestli hra uložení
  // vůbec pustila, nebo jestli server mlčí.
  // Hráči se nic neukazuje; do adminu jde i s počitadly, podle kterých se pozná příčina.
  hlasChybu('ulozeni-ticho', tx('veta.hra_se_min_neulozila_na_server', { p1: Math.round(ticho / 60000) }) + (SYNC_CHYBA ? ': ' + SYNC_CHYBA : ''),
    { pokusu: SYNC_POKUSU, odpovedi: SYNC_ODPOVEDI, status: SYNC_STATUS || null, bezi: !!syncBusy, ticho_s: Math.round(ticho / 1000) });
}

// ─── Heslo k rozehranému účtu ────────────────────────────────────────────────
// Hráč začal jen se jménem firmy. Dokud si nevymyslí heslo, drží ho ve hře
// jediná cookie v tomhle prohlížeči — a to mu musíme říct narovinu, ne až
// ve chvíli, kdy o síť přijde.
function potrebujeHeslo() { return !!(ME && ME.ma_heslo === false); }
function hesloSheet() {
  if (!potrebujeHeslo()) return;
  sheet('<h3>' + esc(tx('hra.zamkni_si_firmu_heslem')) + '</h3>'
    + '<p class="muted small">' + esc(tx('hra.hrajes_jako_2')) + ' ' + '<b>' + esc(ME.nick) + '</b>'
    + (ME.company ? ' za ' + esc(ME.company) : '') + tx('veta.tvoje_sit_je_ulozena_u_nas', { p1: esc(tx('hra.ted_ne')), p2: esc(tx('hra.e_mail_po_tobe_nikdo')) }));
  var inp = $('hs-pass');
  var posli = function () {
    var pwd = inp ? inp.value : '';
    var e = $('hs-err');
    if (pwd.length < 6) { if (e) { e.textContent = esc(tx('hra.heslo_musi_mit_aspon_6')); e.classList.remove('hidden'); } return; }
    var b = $('hs-go'); b.disabled = true; b.textContent = esc(tx('hra.ukladam_4'));
    apiJson('/account/heslo', { password: pwd }).then(function (r) {
      b.disabled = false; b.textContent = esc(tx('hra.nastavit_heslo'));
      if (!r.ok) { if (e) { e.textContent = r.j.error || esc(tx('hra.nepovedlo_se_36')); e.classList.remove('hidden'); } return; }
      ME = r.j.player;
      closeSheet(); paintHeslo();
      toast(tx('veta.hotovo_ted_se_k_siti_dostanes', { p1: ME.nick }), 'ok');
    }).catch(function () {
      b.disabled = false; b.textContent = esc(tx('hra.nastavit_heslo_2'));
      if (e) { e.textContent = esc(tx('hra.server_neodpovida_zkus_to_za')); e.classList.remove('hidden'); }
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
  el.innerHTML = '<span>' + esc(tx('hra.firma_je_zatim_jen_v')) + '</span><b>' + esc(tx('hra.nastavit_heslo_3')) + '</b>';
  el.onclick = hesloSheet;
}

// ─── Registrace / přihlášení ────────────────────────────────────────────────
function showAcct(mode) {
  ['intro', 'quiz', 'role'].forEach(function (id) { $(id).classList.add('hidden'); });
  $('acct').classList.remove('hidden');
  var login = mode === 'login';
  $('acct').querySelector('h2').textContent = login ? esc(tx('hra.prihlas_se_ke_sve_siti')) : esc(tx('hra.vyber_si_herni_nick'));
  $('ac-go').textContent = login ? esc(tx('hra.prihlasit_a_pokracovat')) : esc(tx('hra.zalozit_a_hrat'));
  $('ac-have').textContent = login ? esc(tx('hra.chci_zacit_znovu_s_novym')) : esc(tx('hra.uz_ucet_mam_prihlasit_se'));
  $('ac-nick-hint').classList.toggle('hidden', login);
  $('ac-firma-f').classList.toggle('hidden', login);
  $('ac-firma-hint').classList.toggle('hidden', login);
  $('ac-pass').setAttribute('autocomplete', login ? 'current-password' : 'new-password');
  $('ac-err').classList.add('hidden');
  $('ac-have').onclick = function () { showAcct(login ? 'register' : 'login'); };
  var zp = $('ac-zpet');
  // Kdo už hraje, se účtem nesmí být zdržený — hra běží i bez něj.
  if (zp) zp.textContent = (S && S.units && S.units.length) ? esc(tx('hra.ted_ne_hrat_dal')) : esc(tx('hra.zpet'));
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
  if (nick.length < 3) return acctErr(esc(tx('hra.nick_musi_mit_aspon_3')));
  if (pass.length < 6) return acctErr(esc(tx('hra.heslo_musi_mit_aspon_6_2')));
  $('ac-go').disabled = true;
  var firma = $('ac-firma').value.trim();
  if (!login && firma.length && firma.length < 2) return acctErr(esc(tx('hra.nazev_firmy_ma_aspon_2_2')));
  apiJson('/account/' + (login ? 'login' : 'register'),
    { nick: nick, password: pass, company: firma, ref: trvalePid(), odkud: prichoziRef(),
      zdroj: zjistiZdroj(), sid: visitId() }).then(function (r) {
    $('ac-go').disabled = false;
    if (!r.ok) return acctErr(r.j.error || esc(tx('hra.nepovedlo_se_37')));
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
        return toast(esc(tx('hra.prihlaseno_ted_si_jeste_vyber')), 'ok');
      }
    }
    $('acct').classList.add('hidden');
    srovnejRef();   // znovu: po přihlášení mohl přijít stav se starým pid
    startGame();
    syncState(true);
  }).catch(function () { $('ac-go').disabled = false; acctErr(esc(tx('hra.server_neodpovida_zkus_to_za_2'))); });
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
    // Měna skutečných plateb. Rozhoduje server podle jazyka hráče a stejnou
    // hodnotou pak účtuje Stripe, takže si ji klient nedopočítává.
    if (r.j.mena) { MENA = r.j.mena; MENA_ZNAK = r.j.mena_znak || MENA_ZNAK; }
    if (typeof r.j.mena_des === 'number') MENA_DES = r.j.mena_des;
    if (typeof r.j.mena_pred === 'boolean') MENA_PRED = r.j.mena_pred;
    SUBS_CAT = r.j.subs || null; PREDPLATNE = r.j.predplatne || [];
    LINKA_CAT = r.j.linka || null;
    KAMPAN_CAT = r.j.kampan || null;
    if (typeof r.j.onboarding_rychly === 'boolean') ONBOARDING_RYCHLY = r.j.onboarding_rychly;
    if (typeof r.j.nick_pauza_ms === 'number') NICK_PAUZA_MS = r.j.nick_pauza_ms;
    if (r.j.ramec) { RAMEC = r.j.ramec; RAMEC_ZDARMA = r.j.ramec.zdarma || RAMEC_ZDARMA; }
    IG = r.j.instagram || null;
    FB = r.j.facebook || null;
    RUSH_ZA = r.j.rush_zdarma_za; RUSH_MAX = r.j.rush_zdarma_max || 5;
    if (r.j.owned && ME) ME.cards = r.j.owned;
  }).catch(function () { });
}
function ownedOf(kind) { return (ME && ME.cards && ME.cards[kind]) || 0; }
// ─── Předplatné: vedoucí servisních techniků ─────────────────────────────────
// Jestli běží, rozhoduje server — klient si to nesmí odkývat sám. Dispečer
// nechává hráči čtvrt hodiny: kdo u hry sedí, zareaguje stejně rychleji sám,
// a předplatné tak šetří pozornost, ne že by kupovalo výhodu.
var SUBS_CAT = null, PREDPLATNE = [], LINKA_CAT = null, KAMPAN_CAT = null;
// ─── Zrychlený start ────────────────────────────────────────────────────────
// Cesta od založení firmy k prvnímu prádlomatu vedla přes osm úkonů, dva z nich
// stály peníze a jeden se čekal. Tohle ji zkracuje na tři: město, místo, postav.
// Vypíná se v administraci (Nastavení hry), takže jde porovnat, co to udělalo.
var ONBOARDING_RYCHLY = true;
// Platí jen do postavení prvního prádlomatu — pak už hra běží normálně.
function zacatecnik() {
  return ONBOARDING_RYCHLY && !!S && !(S.units || []).length;
}
function obhlidkaCena() {
  // První obhlídka je zdarma. Nováček stejně neumí posoudit, jestli se mu
  // vyplatí, a je to zbytečná překážka hned v prvním kroku.
  return (zacatecnik() && !Object.keys(S.revealed || {}).length) ? 0 : REVEAL_COST;
}
var DISPECER_PRODLEVA = 60e3;      // než vedoucí sestaví plán výjezdu
function predplatneNa(kind) {
  var ted = Date.now();
  return (PREDPLATNE || []).filter(function (x) {
    return x.kind === kind && (!x.plati_do || new Date(x.plati_do).getTime() > ted);
  })[0] || null;
}
// Stejný strop jako na serveru (MAX_TECHNIKU v game-stripe.routes.js) — ať
// tlačítko nenabízí, co by se stejně odmítlo.
var DISPECER_MAX = 10;
function dispecerKapacita() {
  var p = predplatneNa('dispecer');
  if (!p) return 0;
  var c = (SUBS_CAT || []).filter(function (x) { return x.kind === 'dispecer'; })[0];
  return (p.qty || 1) * ((c && c.kapacita) || 35);
}
// Kolik techniků by síť potřebovala.
function dispecerPotreba(pocet) {
  var c = (SUBS_CAT || []).filter(function (x) { return x.kind === 'dispecer'; })[0];
  var kap = (c && c.kapacita) || 35;
  return Math.max(1, Math.ceil((pocet == null ? (S.units || []).length : pocet) / kap));
}
// Které pobočky vedoucí vůbec hlídá. Obslouží jen tolik, kolik je zaplaceno —
// bere je od nejstarší, aby to bylo pokaždé stejné a dalo se na to spolehnout.
var DISP_CACHE = null;
function dispecerHlidane() {
  var kap = dispecerKapacita();
  if (!kap || !S || !S.units) return [];
  // Panel se ptá za každý řádek zvlášť; bez tohohle by se u velké sítě
  // seznam přetřídil stokrát za jedno vykreslení.
  var ted = Date.now();
  if (DISP_CACHE && DISP_CACHE.do > ted && DISP_CACHE.kap === kap
    && DISP_CACHE.n === S.units.length) return DISP_CACHE.v;
  var v = S.units.slice().sort(function (a, b) { return (a.builtAt || 0) - (b.builtAt || 0); }).slice(0, kap);
  DISP_CACHE = { do: ted + 1000, kap: kap, n: S.units.length, v: v };
  return v;
}
// Hlídá vedoucí tenhle konkrétní prádlomat? Podle toho se v servisu ukazuje,
// jestli tam někdo vyrazí sám, nebo si hráč musí poslat technika ručně.
function dispecerHlida(u) {
  if (!u) return false;
  return dispecerHlidane().indexOf(u) >= 0;
}
// Kdy u téhle poruchy vyrazí technik sám. null = vedoucí ji neřeší.
function dispecerVyrazi(u) {
  if (!u || !jeVPoruse(u) || u.technik || !dispecerHlida(u)) return null;
  return ((u.porucha && u.porucha.od) || Date.now()) + DISPECER_PRODLEVA;
}
// Když síť přeroste zaplacenou kapacitu, zbytek vedoucí nehlídá vůbec —
// tam stroj stojí, dokud si toho hráč nevšimne sám. Hlásíme to jednou za
// každou výši kapacity, ať to nemele pořád dokola.
function hlidejDispecer() {
  if (!S) return;
  var kap = dispecerKapacita();
  var pocet = (S.units || []).length;
  if (!kap || pocet <= kap) { S.dispecerMalo = 0; return; }
  if (S.dispecerMalo === kap) return;
  S.dispecerMalo = kap;
  toast(tx('veta.vedouci_nestiha_hlidat', { p1: kap, p2: pocet, p3: dispecerPotreba(pocet) }), 'err');
}
// Vedoucí obchází poruchy sám.
function dispecerKolo() {
  if (!dispecerKapacita() || !S || !S.units) return;
  var ted = Date.now();
  var poslal = 0;
  dispecerHlidane().forEach(function (u) {
    if (!jeVPoruse(u) || u.technik) return;
    if (ted - ((u.porucha && u.porucha.od) || ted) < DISPECER_PRODLEVA) return;
    // Počítáme jen ty, kdo opravdu vyjeli — bez základny se technik nepošle
    // a hláška „vedoucí poslal technika" by lhala.
    if (vyslatTechnika(u, true)) poslal++;
  });
  if (poslal) {
    // Držená hláška se sama zapíše i do seznamu upozornění, takže hráč to
    // najde, i když byl zrovna pryč.
    toast(tx('veta.vedouci_servisu_poslal_k', { p1: (poslal === 1 ? 'technika' : poslal + ' techniky'), p2: mn(poslal, esc(tx('hra.porouchanemu_stroji')), esc(tx('hra.porouchanym_strojum')), esc(tx('hra.porouchanym_strojum_2'))) }), 'ok', true);
  }
}
// Kdy přibude další Expresní dovoz zdarma. Počítá to server, klient jen ukazuje.
var RUSH_ZA = null, RUSH_MAX = 5;
function paintCards() {
  var box = $('cards-body');
  if (!CARDS_CAT) { box.innerHTML = '<p class="muted small">' + esc(tx('hra.nacitam_2')) + '</p>'; return loadCards().then(paintCards); }
  var total = CARDS_CAT.reduce(function (a, c) { return a + ownedOf(c.kind); }, 0);
  var vsechny = CARDS_CAT.length && CARDS_CAT.every(function (c) { return ownedOf(c.kind) >= 1; });
  box.innerHTML = instagramHtml()
    + (total ? '' : '<p class="muted small">' + esc(tx('hra.zatim_zadnou_kartu_nemas')) + '</p>')
    + (vsechny ? '<p class="muted small">' + esc(tx('hra.od_kazde_karty_mas_jednu')) + '</p>' : '')
    + CARDS_CAT.map(function (c) {
      var n = ownedOf(c.kind), art = CARD_ART[c.kind] || { emoji: '⚡', tone: 'blue' };
      // Stažená karta se ukazuje jen tomu, kdo ji má — koupit už nejde.
      if (c.skryty && !n) return '';
      return '<div class="gcard ' + art.tone + '">'
        + '<div class="gcard-top"><span class="gcard-ico">' + art.emoji + '</span>'
        + '<div><h3>' + esc(polNazev(c)) + '</h3><p class="gcard-short">' + esc(polKratce(c)) + '</p></div>'
        + (n ? '<b class="gcard-n">' + n + '×</b>' : '') + '</div>'
        + '<p class="muted small">' + esc(polPopis(c)) + '</p>'
        + (c.kind === 'rush' && RUSH_ZA != null
            ? tx('veta.p_class_fine_ok_jedna_ti', { p1: etaText(RUSH_ZA) }) + (n >= RUSH_MAX ? tx('hra.dokud_mas_nevyuzitych_dalsi_zdarma_nechodi', { p1: RUSH_MAX }) : '.') + '</p>'
            : '')
        + '<div class="gcard-act">'
        + (n ? '<button class="btn sm" data-use="' + c.kind + '">' + esc(tx('hra.pouzit')) + '</button>' : '')
        + (c.skryty ? '<span class="fine">' + esc(tx('hra.uz_se_neprodava')) + '</span>'
          : PAYMENTS_ON ? tx('veta.button_class_btn_sm_ghost_data', { p1: c.kind, p2: cenaReal(c.price_czk), p3: '', p4: ((c.bundles || []).length ? '<span class="fine bal-tip">nebo ' + c.bundles[c.bundles.length - 1].qty
              + '\u00d7 se slevou ' + c.bundles[c.bundles.length - 1].sleva + ' %</span>' : '') })
          : '<span class="fine">' + esc(tx('hra.prodej_se_teprve_spousti_4')) + '</span>')
        + '</div></div>';
    }).join('');
  box.innerHTML += ramecPacksHtml() + predplatneHtml() + kampanPacksHtml() + linkaPacksHtml();
  bindPredplatne();
  [].forEach.call(box.querySelectorAll('[data-kampan]'), function (el) {
    el.onclick = function () {
      var kind = el.getAttribute('data-kampan');
      if (kampanAuto() && KAMPAN_SUB[kind]) return zapniPredplatne(KAMPAN_SUB[kind], 1);
      buyCash(kind);
    };
  });
  if ($('kampan-auto')) $('kampan-auto').onclick = function () {
    nastavKampanAuto(!kampanAuto()); paintCards();
  };
  var kz = box.querySelector('[data-kampan-zrus]');
  if (kz) kz.onclick = function () {
    var obnovit = kz.getAttribute('data-kampan-zrus') === '0';
    kz.disabled = true; kz.textContent = esc(tx('hra.menim_u2026'));
    apiJson('/stripe/subscribe/zrusit', { kind: kz.getAttribute('data-kind'), obnovit: obnovit })
      .then(function (r) {
        kz.disabled = false;
        if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_38')), 'err');
        PREDPLATNE = r.j.predplatne || [];
        paint(); paintCards();
        toast(r.j.obnovi_se ? esc(tx('hra.kampan_pobezi_dal'))
          : esc(tx('hra.zruseno_zaplacene_obdobi_jeste_dojede')), 'ok', true);
      }).catch(function () { kz.disabled = false; toast(esc(tx('hra.server_neodpovida_17')), 'err'); });
  };
  [].forEach.call(box.querySelectorAll('[data-linka]'), function (el) {
    el.onclick = function () {
      var kind = el.getAttribute('data-linka');
      if (linkaAuto() && LINKA_SUB[kind]) return zapniPredplatne(LINKA_SUB[kind], 1);
      buyCash(kind);
    };
  });
  if ($('linka-auto')) $('linka-auto').onclick = function () {
    nastavLinkaAuto(!linkaAuto()); paintCards();
  };
  if ($('linka-stop')) $('linka-stop').onclick = function () {
    if (linkaStoji()) {
      spustLinku();
      toast(esc(tx('linka.zapnuta')), 'ok');
    } else {
      pozastavLinku();
      toast(esc(tx('linka.vypnuta')), 'ok');
    }
    paintCards();
  };
  var lz = box.querySelector('[data-linka-zrus]');
  if (lz) lz.onclick = function () {
    var obnovit = lz.getAttribute('data-linka-zrus') === '0';
    lz.disabled = true; lz.textContent = esc(tx('hra.menim_u2026'));
    apiJson('/stripe/subscribe/zrusit', { kind: lz.getAttribute('data-kind'), obnovit: obnovit })
      .then(function (r) {
        lz.disabled = false;
        if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_38')), 'err');
        PREDPLATNE = r.j.predplatne || [];
        paintCards();
        toast(r.j.obnovi_se ? esc(tx('hra.infolinka_pobezi_dal'))
          : esc(tx('hra.zruseno_zaplacene_obdobi_jeste_dojede')), 'ok', true);
      }).catch(function () { lz.disabled = false; toast(esc(tx('hra.server_neodpovida_17')), 'err'); });
  };
  [].forEach.call(box.querySelectorAll('[data-ramec]'), function (el) {
    el.onclick = function () { buyCash(el.getAttribute('data-ramec')); };
  });

  [].forEach.call(box.querySelectorAll('[data-use]'), function (b) { b.onclick = function () { useCard(b.getAttribute('data-use')); }; });
  [].forEach.call(box.querySelectorAll('[data-buy-card]'), function (b) { b.onclick = function () { buyCard(b.getAttribute('data-buy-card')); }; });
  bindInstagram();
}

// ─── Kartičky za sledování na Instagramu ─────────────────────────────────────
// Že nás někdo opravdu sleduje, ověřit nejde — Instagram na to nemá rozhraní.
// Stojí to tedy na důvěře a vydá se to jednou za účet: hráč si otevře profil
// a pak si řekne o tři Expresní dovozy. Po vyzvednutí karta mizí.
var IG = null, FB = null;    // { odkaz, …, vzato } ze serveru
function socialHtml(s) {
  var otevrel = !!(S && S[s.klicOtevren]);
  return '<div class="gcard ' + s.trida + '">'
    + '<div class="gcard-top"><span class="gcard-ico">' + s.ikona + '</span>'
    + '<div><h3>' + s.nadpis + '</h3>'
    + '<p class="gcard-short">' + s.odmena + '</p></div></div>'
    + '<p class="muted small">' + s.popis + '</p>'
    + '<div class="gcard-act">'
    + '<a class="btn sm" id="' + s.id + '-open" href="' + esc(s.odkaz) + '" target="_blank" rel="noopener">'
    + s.tlacitko + '</a>'
    + (otevrel ? '<button class="btn sm ghost" id="' + s.id + '-vzit">' + esc(tx('hra.sleduju_vzit')) + '</button>' : '')
    + '</div>'
    + (otevrel ? '' : '<p class="fine">' + esc(tx('hra.az_nas_sledovat_budes_vrat')) + '</p>')
    + '</div>';
}
// Odměny za sledování. Že nás někdo opravdu sleduje, ověřit nejde — Instagram
// ani Facebook na to nemají rozhraní — takže to stojí na důvěře a vydá se to
// jednou za účet.
function socialKarty() {
  var out = [];
  if (IG && IG.odkaz && !IG.vzato) out.push({
    id: 'ig', trida: 'ig', ikona: '\uD83D\uDCF8', klicOtevren: 'igOtevren', odkaz: IG.odkaz,
    nadpis: esc(tx('hra.sleduj_nas_na_instagramu')), tlacitko: esc(tx('hra.otevrit_instagram')),
    odmena: IG.karet + esc(tx('hra.u00d7_expresni_dovoz_zdarma')),
    popis: tx('veta.davame_tam_co_se_ve_hre', { p1: IG.karet }),
    cesta: '/account/instagram',
    hotovo: function (r) { return tx('veta.diky_pridali_jsme_ti', { p1: r.karet, p2: esc(tx('hra.u00d7_expresni_dovoz')) }); }
  });
  if (FB && FB.odkaz && !FB.vzato) out.push({
    id: 'fb', trida: 'fb', ikona: '\uD83D\uDC4D', klicOtevren: 'fbOtevren', odkaz: FB.odkaz,
    nadpis: esc(tx('hra.sleduj_nas_na_facebooku')), tlacitko: esc(tx('hra.otevrit_facebook')),
    odmena: kcFull(FB.laundry) + ' do banky',
    popis: tx('veta.za_sledovani_stranky_ti_zvedneme_ramec', { p1: kcFull(FB.laundry) }),
    cesta: '/account/facebook',
    hotovo: function (r) { return tx('veta.diky_ramec_v_bance_ti_stoupl', { p1: kcFull(r.laundry) }); }
  });
  return out;
}
function instagramHtml() {
  if (!ME) return '';
  return socialKarty().map(socialHtml).join('');
}
function bindInstagram() {
  socialKarty().forEach(function (s) {
    var o = $(s.id + '-open');
    if (o) o.onclick = function () { S[s.klicOtevren] = true; save(); setTimeout(paintCards, 400); };
    var v = $(s.id + '-vzit');
    if (v) v.onclick = function () {
      v.disabled = true;
      apiJson(s.cesta, {}).then(function (r) {
        if (!r.ok) { v.disabled = false; return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_39')), 'err'); }
        if (s.id === 'ig' && IG) IG.vzato = true;
        if (s.id === 'fb' && FB) FB.vzato = true;
        if (ME) ME.cards = r.j.owned || ME.cards;
        // Dárek do banky si hra vyzvedne jako každý jiný balíček.
        claimCash(function () { paint(); paintCards(); });
        toast(s.hotovo(r.j), 'ok', true);
      }).catch(function () { v.disabled = false; toast(esc(tx('hra.server_neodpovida_35')), 'err'); });
    };
  });
}

// Balíčky infolinky. Kredit je jeden hovor, který vyřídí operátor — hráč si
// kupuje klid, ne výhodu: hovor vzatý osobně pořád vynese víc.
// ─── Balíčky rámcového úvěru ────────────────────────────────────────────────
// Rámec je linka proti zástavě — kolik si z ní hráč smí vzít, odemyká balíček.
// Kupuje se jednou a platí napořád; kdo má nižší stupeň, doplácí jen rozdíl.
function ramecPacksHtml() {
  if (!RAMEC || !(RAMEC.balicky || []).length) return '';
  var muj = RAMEC.uroven || 0;
  var mujStrop = ramecStrop();
  var cena = function (b) {
    var nizsi = (RAMEC.balicky || []).filter(function (x) { return x.uroven === muj; })[0];
    return Math.max(0, b.price_czk - (nizsi ? nizsi.price_czk : 0));
  };
  return '<div class="card"><h3>' + tx('veta.h3_p_class_muted_small_style_2', { p1: esc(tx('hra.ud83c_udfe6_objem_ramcoveho_uveru')), p2: esc(tx('hra.tvuj_strop')) }) + (muj ? 'ok' : '') + '">'
    + (mujStrop === null ? esc(tx('hra.bez_stropu')) : kcFull(mujStrop)) + (muj ? '' : ' ' + esc(tx('hra.zdarma_zavorka'))) + '</b></div>'
    + (maRamec() && ramecCerpano() > (mujStrop === null ? Infinity : mujStrop)
        ? tx('hra.p_class_fine_warn_nacerpano_mas', { p1: kcFull(ramecCerpano()), p2: esc(tx('hra.o_penize_neprijdes_ale_dokud')), p3: esc(tx('hra.vyssi_balicek_to_otevre_hned')) })
        : '')
    + (PAYMENTS_ON
        ? (RAMEC.balicky || []).map(function (b) {
            var mam = b.uroven <= muj;
            var dop = cena(b);
            return '<div class="pack' + (mam ? ' hotovo' : '') + '"'
              + (mam ? '' : ' data-ramec="' + esc(b.kind) + '"') + '>'
              + '<div class="pack-l"><b>' + (b.strop === null ? esc(tx('hra.bez_stropu')) : kcFull(b.strop)) + '</b>'
              + '<span>' + (mam ? esc(tx('hra.mas_koupeno'))
                  : muj && dop < b.price_czk ? esc(tx('hra.doplatek_z_tveho_stupne')) : esc(tx('hra.jednorazove_naporad'))) + '</span></div>'
              + '<button class="btn sm"' + (mam ? ' disabled' : '') + '>'
              + (mam ? '\u2713' : cenaReal(dop)) + '</button></div>';
          }).join('')
          + '<p class="fine">' + esc(tx('hra.platbu_zpracovava_stripe_strop_se')) + ' '
          + esc(tx('hra.kdo_ma_nizsi_stupen_plati')) + '</p>'
        : '<p class="fine">' + esc(tx('hra.prodej_se_teprve_spousti_3')) + '</p>')
    + '</div>';
}
// Přepínač „obnovovat automaticky": když je zapnutý, nekupuje se balíček na
// čas, ale předplatné, které se samo platí dál.
//
// Bydlí ve stavu hry, ne v proměnné stránky. Cesta k platbě vede přes Stripe
// a zpátky, což je nové načtení stránky — v proměnné by volba zhasla přesně
// ve chvíli, kdy ji hráč zapnul a šel podle ní koupit. Vypadalo to, že
// přepínač nedrží.
function linkaAuto() { return !!(S && S.linkaAuto); }
function nastavLinkaAuto(zap) {
  if (!S) return;
  S.linkaAuto = zap ? 1 : 0;
  save(); syncState(true);
}
// Balíček na čas → odpovídající předplatné. Jiný kalendář, stejná linka.
var LINKA_SUB = { linka1d: 'linka_sub1d', linka3d: 'linka_sub3d', linka7d: 'linka_sub7d',
  linka30d: 'linka_sub30d', linka365d: 'linka_sub365d' };
// Jak dlouho balíček vydrží, lidsky.
function dobaSlovy(dnu) {
  return dnu === 1 ? 'den' : dnu === 7 ? esc(tx('hra.tyden')) : dnu === 30 ? esc(tx('hra.mesic_4'))
    : dnu === 365 ? 'rok' : dnu + ' dny';
}
// ─── Reklamní kampaň: karta v záložce Karty ─────────────────────────────
// Staví se stejně jako infolinka: tři balíčky, nebo totéž na předplatné,
// které se samo obnovuje. Běží vždycky jedna — proto se u každého balíčku
// píše, co se stane s tou, co zrovna jede.
function kampanPacksHtml() {
  if (!KAMPAN_CAT || !KAMPAN_CAT.length) return '';
  var pred = kampanPredplatne();
  var bezi = kampanBezi();
  return '<div class="card"><h3>\uD83D\uDCE3 ' + esc(tx('hra.reklamni_kampan')) + '</h3>'
    + '<div class="kv"><span>' + esc(tx('hra.stav')) + '</span><b class="' + (bezi ? 'ok' : 'warn') + '">'
    + (bezi ? '+' + Math.round(kampanAdd() * 100) + ' %' : esc(tx('hra.nebezi'))) + '</b></div>'
    + (pred
        ? '<div class="kv"><span>' + (pred.obnovi_se ? esc(tx('hra.dalsi_platba_2')) : esc(tx('hra.dobehne_2'))) + '</span><b'
          + (pred.obnovi_se ? '' : ' class="warn"') + '>'
          + (pred.plati_do ? datumCas(new Date(pred.plati_do)) : esc(tx('hra.brzy'))) + '</b></div>'
          + (pred.status === 'past_due'
              ? '<p class="fine err">' + esc(tx('hra.posledni_platba_neprosla_dokud_se')) + '</p>' : '')
          + '<div class="gcard-act"><button class="btn sm ghost" data-kampan-zrus="'
          + (pred.obnovi_se ? '1' : '0') + '" data-kind="' + esc(pred.kind) + '">'
          + (pred.obnovi_se ? esc(tx('hra.zrusit_obnovovani_2')) : esc(tx('hra.nechat_bezet_dal_2'))) + '</button></div>'
        : bezi
          ? '<div class="kv"><span>' + esc(tx('hra.dobehne_2')) + '</span><b>' + zbyvaDnyText(kampanZbyva()) + '</b></div>'
          : '')
    + '<p class="fine">' + esc(tx('veta.kampan_jak_funguje', { p1: pct(navstevnostBez()) })) + '</p>'
    + (PAYMENTS_ON && !pred
        ? '<div class="kv" style="margin-top:10px"><span>' + esc(tx('hra.obnovovat_automaticky')) + '</span>'
          + '<button class="prep-sam' + (kampanAuto() ? ' on' : '') + '" id="kampan-auto">'
          + (kampanAuto() ? esc(tx('hra.zapnuto')) : esc(tx('hra.vypnuto'))) + '</button></div>'
          + '<p class="fine">' + (kampanAuto()
              ? esc(tx('hra.koupis_si_to_jako_predplatne'))
              : esc(tx('hra.jednorazovy_nakup_kampan'))) + '</p>'
          + KAMPAN_CAT.map(function (c) {
              return '<div class="pack" data-kampan="' + esc(c.kind) + '">'
                + '<div class="pack-l"><b>' + esc(polNazev(c)) + '</b><span class="fine">'
                + esc(tx('veta.kampan_radek_balicku', { p1: pct(navstevnostBez()),
                    p2: pct(navstevnostBez() + c.add), p3: kampanTrzby(c.add), p4: dobaSlovy(c.dnu) }))
                + (kampanAuto() ? ' ' + esc(tx('hra.obnovuje_se')) : '') + '</span></div>'
                + '<button class="btn sm">' + cenaReal(c.price_czk) + '</button></div>';
            }).join('')
          + '<p class="fine">' + esc(tx('hra.kampan_naskoci_po_zaplaceni')) + '</p>'
        : PAYMENTS_ON ? '' : '<p class="fine">' + esc(tx('hra.prodej_se_teprve_spousti_2')) + '</p>')
    + '</div>';
}
function linkaPacksHtml() {
  if (!LINKA_CAT || !LINKA_CAT.length) return '';
  var pred = linkaPredplatne();
  var bezi = maLinku();
  return '<div class="card"><h3>\u260E\uFE0F Infolinka</h3>'
    + tx('veta.p_class_muted_small_style_margin_2') + (bezi ? 'ok' : 'warn') + '">'
    + (pred ? esc(tx('hra.bezi_na_predplatne')) : bezi ? tx('hra.bezi_jeste', { p1: etaText(linkaZbyva()) }) : esc(tx('hra.nebezi'))) + '</b></div>'
    + (pred
        ? '<div class="kv"><span>' + (pred.obnovi_se ? esc(tx('hra.dalsi_platba_2')) : esc(tx('hra.dobehne_2'))) + '</span><b'
          + (pred.obnovi_se ? '' : ' class="warn"') + '>'
          + (pred.plati_do ? datumCas(new Date(pred.plati_do)) : 'brzy') + '</b></div>'
          + (pred.status === 'past_due'
              ? '<p class="fine err">' + esc(tx('hra.posledni_platba_neprosla_dokud_se')) + '</p>' : '')
          + '<div class="gcard-act"><button class="btn sm ghost" data-linka-zrus="'
          + (pred.obnovi_se ? '1' : '0') + '" data-kind="' + esc(pred.kind) + '">'
          + (pred.obnovi_se ? esc(tx('hra.zrusit_obnovovani_2')) : esc(tx('hra.nechat_bezet_dal_2'))) + '</button></div>'
        : bezi ? '<p class="fine">' + esc(tx('hra.koupeny_balicek_se_pricte_k')) + '</p>'
          : '<p class="fine">' + esc(tx('hra.bez_ni_telefon_zvoni_a')) + '</p>')
    // Přepínač linky. Hodnocení roste jen z hovorů, které hráč vyřídí sám,
    // takže kdo má linku zaplacenou dopředu, nemá jak si ho zvednout. Pauza
    // zbývající čas zmrazí — nic se jí neutratí.
    + ((bezi || linkaStoji() || pred)
        ? '<div class="kv" style="margin-top:10px"><span>' + esc(tx('linka.operator_bere_hovory')) + '</span>'
          + '<button class="prep-sam' + (linkaStoji() ? '' : ' on') + '" id="linka-stop">'
          + (linkaStoji() ? esc(tx('hra.vypnuto')) : esc(tx('hra.zapnuto'))) + '</button></div>'
          + '<p class="fine">' + (linkaStoji()
              ? esc(tx('linka.pauza_bezi'))
              : esc(tx('linka.pauza_nabidka'))) + '</p>'
        : '')
    + (PAYMENTS_ON && !pred
        ? '<div class="kv" style="margin-top:10px"><span>' + esc(tx('hra.obnovovat_automaticky')) + '</span>'
          + '<button class="prep-sam' + (linkaAuto() ? ' on' : '') + '" id="linka-auto">'
          + (linkaAuto() ? esc(tx('hra.zapnuto')) : esc(tx('hra.vypnuto'))) + '</button></div>'
          + '<p class="fine">' + (linkaAuto()
              ? esc(tx('hra.koupis_si_to_jako_predplatne'))
              : esc(tx('hra.jednorazovy_nakup_az_cas_dobehne'))) + '</p>'
          + LINKA_CAT.map(function (c) {
              return '<div class="pack" data-linka="' + tx('hra.div_class_pack_l_b_b', { p1: esc(c.kind), p2: esc(polNazev(c)), p3: cenaDen(c.za_den) })
                + (linkaAuto() ? ' ' + esc(tx('hra.obnovuje_se')) : '') + '</span></div>'
                + '<button class="btn sm">' + cenaReal(c.price_czk) + '</button></div>';
            }).join('')
          + '<p class="fine">' + esc(tx('hra.platbu_zpracovava_stripe_infolinka_naskoci')) + '</p>'
        : PAYMENTS_ON ? '' : '<p class="fine">' + esc(tx('hra.prodej_se_teprve_spousti_2')) + '</p>')
    + hovorLogHtml()
    + '</div>';
}
// Evidence hovorů. Ukazujeme posledních dvacet z padesáti, co si hra pamatuje —
// u každého, kdo volal, o co šlo a jestli ho vzal hráč, nebo operátor.
// Záznam hovoru drží jméno a téma tak, jak se zapsaly. Starší záznamy mají místo
// jména holý klíč katalogu (překlad tehdy chyběl), jiné český text. Při zobrazení
// obojí převedeme na jazyk hráče: klíč přímo, český text zpětným dohledáním klíče.
// Názvy míst se stavbou druhého a dalšího stroje dostanou příponu „— 2. stání“,
// která se zapíše do názvu hotová. Při zobrazení ji složíme znovu v jazyce hráče.
function jmenoStroje(n) {
  n = String(n == null ? '' : n);
  if (JAZYK === 'cs') return n;
  return n.replace(/ \u2014 (\d+)\. st\u00e1n\u00ed$/, function (m, c) { return tx('veta.stani', { p1: +c }); })
    .replace(/ \u00b7 (\d+)\. st\u00e1n\u00ed$/, function (m, c) { return tx('veta.stani_3', { p1: +c }); });
}
var HOVOR_OBRAT = null;
function hovorText(t) {
  t = String(t == null ? '' : t);
  if (/^[a-z]+(\.[a-z0-9_]+)+$/.test(t)) return tx(t);
  if (JAZYK === 'cs') return t;
  if (!HOVOR_OBRAT) {
    HOVOR_OBRAT = {};
    var cz = window.__TEXTY_CS || {};
    Object.keys(cz).forEach(function (k) { if (typeof cz[k] === 'string' && !HOVOR_OBRAT[cz[k]]) HOVOR_OBRAT[cz[k]] = k; });
  }
  return HOVOR_OBRAT[t] ? tx(HOVOR_OBRAT[t]) : t;
}
function hovorLogHtml() {
  var l = ((S && S.hovorLog) || []).slice().reverse().slice(0, 20);
  if (!l.length) return '';
  var kolik = ((S && S.hovorLog) || []).length;
  var vzal = { ja: esc(tx('hra.vzal_jsem')), operator: esc(tx('hra.vzal_operator')), nevzat: esc(tx('hra.nevzaty')) };
  return '<h3 style="margin:18px 0 2px">' + esc(tx('hra.evidence_hovoru')) + '</h3>'
    + '<p class="muted small" style="margin:0 0 8px">'
    + mn(l.length, esc(tx('hra.posledni_hovor')), tx('veta.posledni_hovory', { p1: l.length }), tx('veta.poslednich_hovoru', { p1: l.length }))
    + (kolik > l.length ? tx('veta.z_zapsanych', { p1: kolik }): '') + '.</p>'
    + '<div class="hov-log">' + l.map(function (z) {
        var tr = z.konec === 'ja' ? (z.zmena > 0 ? 'ok' : (z.zmena < 0 ? 'err' : 'muted'))
          : (z.konec === 'operator' ? 'muted' : 'err');
        return '<div class="hov-radek">'
          + '<div class="hov-kdo"><b>' + esc(hovorText(z.jmeno)) + '</b><i>' + esc(hovorText(z.tema)) + '</i></div>'
          + '<div class="hov-vysl"><span class="' + tr + '">' + (vzal[z.konec] || z.konec) + '</span>'
          + '<em>' + casPred(z.kdy)
          + (z.zmena ? tx('veta.povest', { p1: (z.zmena > 0 ? '+' : '\u2212'), p2: String(Math.abs(z.zmena)).replace('.', desZnak()) }) : '') + '</em></div></div>';
      }).join('') + '</div>';
}
// „před 4 min" se čte líp než čas, protože hovory padají po minutách.
function casPred(kdy) {
  var s = Math.max(0, Math.round((Date.now() - kdy) / 1000));
  if (s < 90) return esc(tx('hra.pred_chvili'));
  var m = Math.round(s / 60);
  if (m < 60) return tx('veta.pred_min_2', { p1: m });
  var h = Math.round(m / 60);
  if (h < 24) return tx('hra.pred_hodin', { p1: h });
  var d = Math.round(h / 24);
  return tx('hra.pred_dnu', { p1: d });
}
// Karta předplatného — jediná věc ve hře, která se strhává opakovaně, takže
// se o tom musí psát narovinu: co to stojí, kdy se to strhne a jak to zrušit.
function predplatneHtml() {
  var c = (SUBS_CAT || []).filter(function (x) { return x.kind === 'dispecer'; })[0];
  if (!c) return '';
  var p = predplatneNa('dispecer');
  var pocet = (S.units || []).length;
  var treba = dispecerPotreba(pocet);
  var kap = dispecerKapacita();
  var do_ = p && p.plati_do ? new Date(p.plati_do) : null;
  return '<div class="gcard sub">'
    + '<div class="gcard-top"><span class="gcard-ico">\uD83D\uDD27</span>'
    + '<div><h3>' + esc(polNazev(c)) + '</h3><p class="gcard-short">' + esc(polKratce(c)) + '</p></div>'
    + (p ? '<b class="gcard-n ok">' + esc(tx('hra.jede')) + '</b>' : '') + '</div>'
    + '<p class="muted small">' + esc(polPopis(c)) + '</p>'
    + (p
        ? tx('veta.div_class_kv_span_span_b_2', { p1: esc(tx('hra.techniku')), p2: p.qty, p3: kap, p4: esc(tx('hra.platis')) }) + cenaReal((c.price_czk * p.qty)) + '</b></div>'
          + (do_ ? '<div class="kv"><span>' + (p.obnovi_se ? esc(tx('hra.dalsi_platba')) : esc(tx('hra.dobehne')))
            + '</span><b' + (p.obnovi_se ? '' : ' class="warn"') + '>' + datumCas(do_) + '</b></div>' : '')
          + (p.status === 'past_due' ? '<p class="fine err">' + esc(tx('hra.posledni_platba_neprosla')) + ' '
              + esc(tx('hra.dokud_se_nestrhne_vedouci_nevyjizdi')) + '</p>' : '')
          + (pocet > kap ? tx('hra.p_class_fine_warn_mas_pobocek', { p1: pocet, p2: kap }) : '')
          + '<div class="gcard-act">'
          // Počet techniků šel dřív nastavit jen při prvním nákupu. Kdo měl
          // jednoho a potřeboval čtyři, musel zrušit a koupit znovu.
          + (PAYMENTS_ON
              ? '<button class="btn sm" data-sub-pocet="' + (p.qty + 1) + '"'
                + (p.qty >= DISPECER_MAX ? ' disabled' : '') + '>'
                + esc(tx('hra.prikoupit_technika')) + '</button>'
                + (p.qty > 1
                    ? '<button class="btn sm ghost" data-sub-pocet="' + (p.qty - 1) + '">'
                      + esc(tx('hra.ubrat_technika')) + '</button>'
                    : '')
              : '')
          + '<button class="btn sm ghost" data-sub-zrus="' + (p.obnovi_se ? '1' : '0') + '">'
          + (p.obnovi_se ? esc(tx('hra.zrusit_obnovovani')) : esc(tx('hra.nechat_bezet_dal'))) + '</button></div>'
          + (PAYMENTS_ON && treba > p.qty
              ? tx('hra.na_vsechny_pobocky_potrebujes', { p1: treba, p2: cenaReal(c.price_czk * treba) })
              : '')
        : tx('veta.div_class_kv_span_cena_span', { p1: cenaReal(c.price_czk), p2: esc(tx('hra.za_technika_a_tyden')), p3: esc(tx('hra.jeden_technik_zvladne')), p4: c.kapacita, p5: pocet, p6: mn(pocet, esc(tx('hra.pobocku')), esc(tx('hra.pobocky')), esc(tx('hra.pobocek'))), p7: treba, p8: esc(tx('hra.tydne_zaplatis')) })
            + cenaReal((c.price_czk * treba)) + '</b></div>'
          + (PAYMENTS_ON
              ? tx('veta.button_class_btn_big_data_sub', { p1: treba, p2: cenaReal(c.price_czk * treba), p3: tx('hra.button_p_class_fine_strhava_se', { p1: esc(tx('hra.kc_tydne_2')) }) })
              : '<p class="fine">' + esc(tx('hra.prodej_se_teprve_spousti')) + '</p>'))
    + '</div>';
}
function bindPredplatne() {
  var k = document.querySelector('[data-sub-koupit]');
  if (k) k.onclick = function () { zapniPredplatne('dispecer', k.getAttribute('data-sub-koupit')); };
  [].forEach.call(document.querySelectorAll('[data-sub-pocet]'), function (b) {
    b.onclick = function () {
      var qty = parseInt(b.getAttribute('data-sub-pocet'), 10) || 1;
      b.disabled = true; b.textContent = esc(tx('hra.menim_u2026_2'));
      apiJson('/stripe/subscribe/pocet', { kind: 'dispecer', qty: qty }).then(function (r) {
        if (!r.ok) {
          b.disabled = false;
          return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_40')), 'err');
        }
        PREDPLATNE = r.j.predplatne || [];
        toast(tx('hra.techniku_ted_mas', { p1: r.j.qty }), 'ok');
        paintCards();
      }).catch(function () { b.disabled = false; toast(esc(tx('hra.server_neodpovida_8')), 'err'); });
    };
  });
  var z = document.querySelector('[data-sub-zrus]');
  if (z) z.onclick = function () {
    var obnovit = z.getAttribute('data-sub-zrus') === '0';
    z.disabled = true; z.textContent = esc(tx('hra.menim_u2026_2'));
    apiJson('/stripe/subscribe/zrusit', { kind: 'dispecer', obnovit: obnovit }).then(function (r) {
      z.disabled = false;
      if (!r.ok) return toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_40')), 'err');
      PREDPLATNE = r.j.predplatne || [];
      paintCards();
      toast(r.j.obnovi_se ? esc(tx('hra.predplatne_pobezi_dal')) : esc(tx('hra.zruseno_zaplaceny_tyden_jeste_dojede')), 'ok', true);
    }).catch(function () { z.disabled = false; toast(esc(tx('hra.server_neodpovida_30')), 'err'); });
  };
}
function zapniPredplatne(kind, qty) {
  if (!ME) return toast(esc(tx('hra.nejdriv_se_prihlas_3')), 'err');
  if (!ME.has_details) return detailsSheet(null, null, null, kind);
  apiJson('/stripe/subscribe', { kind: kind, qty: qty }).then(function (r) {
    if (r.ok && r.j.url) { location.href = r.j.url; return; }
    if (r.status === 428) return detailsSheet(null, null, null, kind);
    toast((r.j && r.j.error) || esc(tx('hra.nepovedlo_se_zalozit_platbu')), 'err');
  }).catch(function () { toast(esc(tx('hra.server_neodpovida_31')), 'err'); });
}
// Karta se spotřebuje NA SERVERU a teprve pak se projeví ve hře.
// Zrychlí JEDNU vybranou zásilku, ne tu nejbližší — hráč si kliknul na konkrétní.
function rushOrder(orderedAt, btn) {
  var o = (S.orders || []).filter(function (x) { return x.orderedAt === orderedAt; })[0];
  if (!o) return toast(esc(tx('hra.tahle_zasilka_uz_dorazila')), 'err');
  if (!ownedOf('rush')) return toast(esc(tx('hra.nemas_kartu_expresni_dovoz')), 'err');
  if (btn) { btn.disabled = true; btn.textContent = esc(tx('hra.volam_dopravci')); }
  apiJson('/cards/use', { kind: 'rush', on: o.model }).then(function (r) {
    if (!r.ok) { if (btn) { btn.disabled = false; btn.textContent = esc(tx('hra.dorucit_hned')); } return toast(r.j.error || esc(tx('hra.nepovedlo_se_41')), 'err'); }
    if (ME) ME.cards = r.j.owned;
    o.arrivesAt = Date.now() - 1;
    deliverOrders();
    save(); syncState(true); paint(); paintShop();
    toast(tx('veta.je_skladem_muzes_stavet', { p1: MODELS[o.model].name }), 'ok');
  }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = esc(tx('hra.dorucit_hned_2')); } toast(esc(tx('hra.server_neodpovida_23')), 'err'); });
}
function useCard(kind) {
  if (kind === 'rush' && !(S.orders || []).length) return toast(esc(tx('hra.nemas_nic_na_ceste_nejdriv')), 'err');
  if (kind === 'connect' && S.connDiscount) return toast(esc(tx('hra.slevu_na_pripojky_uz_mas')), 'err');
  // Běží vždycky jedna kampaň. Když by ta nová byla slabší než běžící,
  // zeptáme se — zaplacený náskok se nemá zahodit omylem.
  var nova = (KAMPAN_CAT || []).filter(function (c) { return c.kind === kind; })[0];
  if (nova && kampanBezi() && nova.add < kampanAdd()) {
    return potvrdAno({
      nadpis: tx('hra.prebit_bezici_kampan'),
      popis: tx('veta.ted_ti_bezi_kampan_novou_prebijes', {
        p1: Math.round(kampanAdd() * 100),
        p2: kampanPredplatne() ? esc(tx('hra.bezi_na_predplatne')) : zbyvaDnyText(kampanZbyva()),
        p3: Math.round(nova.add * 100) }),
      tlacitko: tx('hra.presto_spustit'),
      pak: function () { pouzijKartu(kind); },
    });
  }
  pouzijKartu(kind);
}
function pouzijKartu(kind) {
  apiJson('/cards/use', { kind: kind }).then(function (r) {
    if (!r.ok) return toast(r.j.error || esc(tx('hra.kartu_se_nepovedlo_pouzit')), 'err');
    if (ME) ME.cards = r.j.owned;
    applyCard(r.j.result);
    if (r.j.result && r.j.result.effect === 'kampan') spustKampan(r.j.result.add, r.j.result.dnu);
    save(); syncState(true); paint(); paintCards();
    toast(r.j.result.msg, 'ok');
  }).catch(function () { toast(esc(tx('hra.server_neodpovida_28')), 'err'); });
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
    return tx('veta.po_konkurzu_ti_banka_herni_rok', { p1: tx('veta.do_te_doby_musis_vystacit_s', { p1: etaText((S.skraloupDo || 0) - Date.now()) }) });
  }
  var p = PROFILES[S.profile];
  var majetek = assetsTotal();
  var strop = Math.max(0, zastavaStrop() - S.loan);
  if (majetek <= 0 && strop < 1000) return esc(tx('hra.banka_pujcuje_proti_majetku_a'));
  if (strop < 1000) {
    return tx('veta.banka_ti_pujci_nejvys', { p1: tx('veta.hodnoty_majetku_coz_je_a_tolik', { p1: Math.round(p.ltv * 100), p2: kcFull(Math.round(p.ltv * majetek)) }) });
  }
  var zbyva = monthlyProfit() - splatkyMesicne();
  if (stropPodleZisku(zbyva, 0) < 1000) {
    return tx('veta.banka_se_diva_na_to_co', { p1: tx('hra.mesicne_na_dalsi_splatku_to_nestaci', { p1: kcFull(Math.max(0, zbyva)), p2: esc(tx('hra.postav_dalsi_pradlomat_nebo_splat')) }) });
  }
  return tx('veta.volny_ramec_v_bance_je_vycerpany', { p1: tx('veta.za_den_nebo_ho_doplnis_tim', { p1: kcFull(BANK_PER_DAY) }) });
}
function uverSheet(chci, iSplatnosti) {
  var n = uverNabidka(chci, iSplatnosti);
  if (n.max < 1000) { closeSheet(); return toast(esc(tx('hra.banka_ti_ted_nepujci_ani')), 'err'); }
  // Hodnotíme PŮJČKU, ne hráče: přirážka se řídí tím, jak bude zadlužený až
  // si tuhle částku vezme. Dřív tu stálo „jsi zadlužený" i tomu, kdo neměl ani korunu dluhu.
  var po = Math.round(n.zadluzenost * 100);
  var hodnoceni = n.prirazka === 0
      ? tx('veta.pri_tehle_castce_budes_dluzit_hodnoty', { p1: po }): n.prirazka <= 0.008
      ? tx('veta.po_nacerpani_budes_dluzit_hodnoty_majetku_3', { p1: po }): n.prirazka <= 0.018
      ? tx('veta.po_nacerpani_budes_dluzit_hodnoty_majetku_2', { p1: po }): tx('veta.po_nacerpani_budes_dluzit_hodnoty_majetku', { p1: po });
  var rada = n.prirazka > 0 && n.bezPrirazky >= 1000 && n.bezPrirazky < n.castka
      ? tx('veta.do_je_sazba_bez_prirazky', { p1: kcFull(n.bezPrirazky) }): n.prirazka > 0.008 && n.levnejsi >= 1000 && n.levnejsi < n.castka
      ? tx('veta.do_by_byla_prirazka_jen_0', { p1: kcFull(n.levnejsi) }): '';
  var maxS = maxSplatnost();
  sheet('<h3>' + esc(tx('hra.nabidka_banky')) + '</h3>'
    + '<div class="nalada ' + n.nalada.id + '"><b>' + n.nalada.nazev + '</b>'
    + '<span>' + esc(n.nalada.slovo) + '</span></div>'
    + '<p class="muted small">' + hodnoceni + (rada ? ' ' + rada : '')
    + ' ' + esc(tx('hra.podminky_plati_dokud_je_neprijmes')) + '</p>'
    + (n.brzdiVydelek ? '<div class="kv"><span>' + esc(tx('hra.strop_podle_vydelku_firmy')) + '</span><b class="warn">' + kcFull(n.dscr) + '</b></div>'
        + tx('uver.zastava_by_dovolila_vic_splatka')
        + KRYTI_MIN.toFixed(2).replace('.', desZnak()) + esc(tx('hra.tolik_co_splatka_dela')) + '</p>' : '')
    + (duveraVolna() > 0 ? '<div class="kv"><span>' + esc(tx('hra.z_toho_proti_zastave')) + '</span><b class="ok">'
        + kcFull(duveraVolna()) + '</b></div>'
        + '<p class="fine">' + esc(tx('hra.tolik_ti_banka_pujci_i')) + '</p>' : '')
    + '<div class="kv"><span>' + esc(tx('hra.dnes_dluzis')) + '</span><b' + (S.loan > 0 ? ' class="warn"' : '') + '>' + kcFull(S.loan)
    + (S.loan > 0 ? tx('veta.majetku', { p1: Math.round(n.ted * 100) }) : '') + tx('veta.b_div_label_class_fld_span', { p1: kcFull(n.max), p2: n.max, p3: n.castka }) + SPLATNOSTI.slice(SPL_ZAKLAD).map(function (x, j) {
        var i = SPL_ZAKLAD + j, lze = i <= maxS;
        return '<button class="splat-b' + (i === n.iSplatnosti ? ' on' : '') + (lze ? '' : ' zamceno')
          + '" data-splat="' + i + '"' + (lze ? '' : ' disabled') + '>'
          + '<b>' + x.nazev + '</b><span>' + (lze ? kcFull(anuita(n.castka, Math.max(0.02, rateOf() + prirazkaZa(n.castka) + x.prirazka + n.nalada.sazba), x.mesicu)) + ' ' + esc(tx('hra.mes_2')) : esc(tx('hra.zamceno'))) + '</span></button>';
      }).join('') + tx('veta.div_div_class_kv_span_span', { p1: (maxS < SPLATNOSTI.length - 1 ? '<p class="fine">' + esc(splatnostDuvod(maxS + 1)) + '</p>' : ''), p2: esc(tx('hra.urok')), p3: (n.sazba * 100).toFixed(1).replace('.', desZnak()), p4: (n.prirazka > 0.0005 ? tx('veta.span_class_warn_za_riziko_a', { p1: (n.prirazka * 100).toFixed(1).replace('.', desZnak()) }) : ''), p5: tx('veta.b_div_div_class_kv_span', { p1: esc(tx('hra.poplatek_za_sjednani_1')), p2: kcFull(n.poplatek), p3: esc(tx('hra.dostanes_na_ruku')), p4: kcFull(n.naruku), p5: esc(tx('hra.splatka_2')), p6: kcFull(n.splatkaMes), p7: n.splatnost.nazev, p8: esc(tx('hra.celkem_na_urocich_zaplatis')), p9: kcFull(n.celkemUrok), p10: esc(tx('hra.dluh_po_nacerpani')), p11: kcFull(S.loan + n.castka) }), p6: (S.loan > 0 && Math.abs(n.poSjednani - n.sazba) > 0.0005
        ? '<div class="kv"><span>' + esc(tx('hra.sazba_z_celeho_dluhu')) + '</span><b>'
          + tx('uver.rocne_b_div', { p1: (n.poSjednani * 100).toFixed(1).replace('.', desZnak()) })
          + '<p class="fine">' + esc(tx('hra.stary_dluh_ma_svoji_sazbu')) + '</p>'
        : ''), p7: esc(tx('hra.diky_necham_si_to_projit')), p8: esc(tx('hra.splatka_se_strhne_kazdy_herni')) }));
  // Při změně částky přepočítáme celou nabídku — sazba se může hnout.
  var inp = $('uv-amt');
  if (inp) inp.onchange = function () { uverSheet(Number(inp.value) || 0, n.iSplatnosti); };
  [].forEach.call(document.querySelectorAll('[data-splat]'), function (b) {
    b.onclick = function () { uverSheet(Number(inp.value) || 0, Number(b.getAttribute('data-splat'))); };
  });
  $('uv-ne').onclick = closeSheet;
  $('uv-ano').onclick = function () {
    var m = uverNabidka(Number(inp.value) || 0, n.iSplatnosti);
    if (m.castka < 1000) return toast(esc(tx('hra.takhle_malou_castku_banka_neresi')), 'err');
    S.bank -= m.castka;
    pricistDluh(m.castka, m.prirazka, { druh: 'provoz', popis: tx('veta.uver_z_banky_na_2', { p1: m.splatnost.nazev })}, m.splatnost.mesicu);
    S.cash += m.naruku;
    zapis('uver', tx('veta.uver_z_banky_na', { p1: m.splatnost.nazev }), m.naruku);
    S.stats.interest += m.poplatek;   // poplatek bereme jako náklad úvěru
    save(); paint(); paintBank(); closeSheet(); syncState(true);
    toast(tx('veta.uver_sjednan_na_uctu_mas_o', { p1: kcFull(m.naruku) }), 'ok');
  };
}

// ─── Balíčky herních peněz ───────────────────────────────────────────────────
// Laundry se kupují stejnou cestou jako karty: po zaplacení visí balíček na
// účtu a klient si ho vyzvedne — díky tomu se peníze nepřipíšou dvakrát ani
// se neztratí, když hráč zavře stránku hned po platbě.
var CASH_CAT = null;
// Názvy a popisy věcí v obchodě skládá hra, ne server. Ceník je společný
// pro všechny a server ho posílá stejný, takže by v něm byl jeden jazyk pro
// všechny; podle kódu položky si text vezme z katalogu. Co v katalogu není
// (stará položka, nová ze seedu), zůstane tak, jak přišlo ze serveru.
function obchodText(x, pole) {
  if (!x) return '';
  var k = 'obchod.' + (x.kind || '') + '.' + pole;
  var v = x.kind ? tx(k) : null;
  return (v && v !== k) ? v : (x[pole] || '');
}
function polNazev(x) { return obchodText(x, 'name'); }
function polKratce(x) { return obchodText(x, 'short'); }
function polPopis(x) { return obchodText(x, 'desc'); }
// Skutečné peníze (ne herní L$). Měnu i počet desetinných míst říká server
// podle jazyka hráče, protože stejnou hodnotou pak účtuje Stripe. Kdyby si to
// klient počítal sám, dřív nebo později by ukázal jinou cenu, než jaká se
// strhne.
// Výchozí hodnoty platí jen do načtení ceníku, pak je přebije server.
// Než doběhne ceník ze serveru, platí značka, kterou poslal se stránkou —
// podle jazyka hráče, ne podle překladu. Překladatel o měně nerozhoduje.
var MENA = 'czk';
// Bez značky raději holé číslo než cizí měna — na okamžik, než doběhne ceník,
// je to lepší než ukázat koruny Španělovi.
var MENA_ZNAK = HRAC_TEXTY.mena_znak || '';
var MENA_DES = typeof HRAC_TEXTY.mena_des === 'number' ? HRAC_TEXTY.mena_des : 0;
var MENA_PRED = !!HRAC_TEXTY.mena_pred;
// Kde která řeč píše tisíce a desetinnou čárku. Neznámý jazyk bere češtinu —
// pořád lepší než rozhozená čísla.
var LOCALE_JAZYKA = { cs: 'cs-CZ', en: 'en-GB', pl: 'pl-PL', sk: 'sk-SK', de: 'de-DE', es: 'es-ES', fr: 'fr-FR' };
function localeHrace() { return LOCALE_JAZYKA[JAZYK] || 'cs-CZ'; }
// Značka patří k číslu tak, jak se to v té měně píše: 5 Kč, 5 zł, ale $5.
// Říká to server spolu s měnou — klient si to nesmí odvozovat sám, jinak se
// dřív nebo později ukáže číslo v jedné měně se značkou jiné.
function sMenou(txt) {
  if (!MENA_ZNAK) return txt;          // značka ještě nedorazila
  return MENA_PRED ? MENA_ZNAK + txt : txt + ' ' + MENA_ZNAK;
}
// Cena za den vychází z dělení, takže potřebuje desetinné místo i v korunách.
function cenaDen(x) {
  var n = Number(x) || 0;
  var txt;
  try {
    txt = n.toLocaleString(localeHrace(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) { txt = n.toFixed(2); }
  return sMenou(txt);
}
function cenaReal(x) {
  var n = Number(x) || 0;
  var txt;
  try {
    txt = n.toLocaleString(localeHrace(),
      { minimumFractionDigits: MENA_DES, maximumFractionDigits: MENA_DES });
  } catch (e) { txt = String(MENA_DES ? n.toFixed(MENA_DES) : Math.round(n)); }
  return sMenou(txt);
}
function cashPacksHtml() {
  if (!PAYMENTS_ON) {
    return '<div class="card"><h3>' + esc(tx('banka.dobit_banku')) + '</h3><p class="muted small" style="margin:2px 0 0">'
      + esc(tx('hra.balicky_hernich_penez_se_teprve')) + '</p></div>';
  }
  if (!CASH_CAT) return '<div class="card"><h3>' + esc(tx('banka.dobit_banku_2')) + '</h3><p class="muted small" style="margin:2px 0 0">' + esc(tx('banka.nacitam')) + '</p></div>';
  return '<div class="card"><h3>' + tx('veta.h3_p_class_muted_small_style_9', { p1: esc(tx('banka.dobit_banku_3')) })
    + CASH_CAT.map(function (c) {
      return '<div class="pack" data-pack="' + c.kind + '">'
        + '<div class="pack-l"><b>' + kcFull(c.laundry) + '</b>'
        + '<span>' + esc(polNazev(c)) + (c.bonus > 0 ? tx('hra.o_vyhodnejsi', { p1: c.bonus }) : '') + '</span></div>'
        + '<button class="btn sm">' + cenaReal(c.price_czk) + '</button></div>';
    }).join('')
    + '<p class="fine">' + esc(tx('banka.platbu_zpracovava_stripe_penize_se')) + '</p></div>';
}
function bindCashPacks() {
  [].forEach.call(document.querySelectorAll('#bank-body [data-pack]'), function (el) {
    el.onclick = function () { buyCash(el.getAttribute('data-pack')); };
  });
}
function buyCash(kind) {
  var c = (CASH_CAT || []).concat(LINKA_CAT || []).concat(KAMPAN_CAT || [])
    .concat((RAMEC && RAMEC.balicky) || [])
    .filter(function (x) { return x.kind === kind; })[0];
  if (!c) return;
  if (!ME) return toast(esc(tx('hra.nejdriv_se_prihlas')), 'err');
  if (!ME.has_details) return detailsSheet(null, kind);
  // Kampaň má taky dnu, ale není to infolinka — rozhoduje add.
  var kamp = c.add != null;
  var hovory = !kamp && !!c.dnu;
  var ramec = c.uroven != null;
  // U rámce se platí jen rozdíl proti stupni, který hráč má.
  var nizsi = ramec ? ((RAMEC.balicky || []).filter(function (x) { return x.uroven === (RAMEC.uroven || 0); })[0]) : null;
  var platba = ramec ? Math.max(0, c.price_czk - (nizsi ? nizsi.price_czk : 0)) : c.price_czk;
  sheet('<h3>' + esc(polNazev(c)) + '</h3>'
    + (ramec
        ? '<div class="kv"><span>' + esc(tx('hra.z_ramce_smis_cerpat')) + '</span><b class="ok">'
          + (c.strop === null ? 'bez stropu' : kcFull(c.strop)) + '</b></div>'
          + '<div class="kv"><span>' + esc(tx('hra.ted_mas')) + '</span><b>'
          + (ramecStrop() === null ? 'bez stropu' : kcFull(ramecStrop())) + '</b></div>'
        : kamp
          ? '<div class="kv"><span>' + esc(tx('hra.navstevnost')) + '</span><b class="ok">'
            + pct(navstevnostBez()) + ' \u2192 ' + pct(navstevnostBez() + c.add) + '</b></div>'
            + '<div class="kv"><span>' + esc(tx('hra.trzby')) + '</span><b class="ok">+'
            + kampanTrzby(c.add) + ' %</b></div>'
            + '<div class="kv"><span>' + esc(tx('hra.kampan_potrva')) + '</span><b>' + dobaSlovy(c.dnu) + '</b></div>'
        : hovory
          ? '<div class="kv"><span>' + esc(tx('hra.infolinka_pobezi')) + '</span><b class="ok">'
            + (maLinku() ? etaText(linkaZbyva() + c.dnu * 86400000) + ' ' + esc(tx('hra.vcetne_zbytku'))
                : dobaSlovy(c.dnu)) + '</b></div>'
          : '<div class="kv"><span>' + esc(tx('hra.ramec_a_zastava_v_bance')) + '</span><b class="ok">+' + kcFull(c.laundry) + '</b></div>')
    + '<div class="kv"><span>' + esc(tx('hra.cena_5')) + '</span><b>' + cenaReal(platba) + '</b></div>'
    + (ramec
        ? (platba < c.price_czk
            ? tx('veta.p_class_fine_ok_plna_cena', { p1: cenaReal(c.price_czk), p2: esc(tx('hra.doplacis_jen_rozdil_proti')) }) : '')
        : kamp
          ? (kampanBezi()
              ? '<p class="fine warn">' + esc(tx('hra.kampan_nahradi_bezici')) + '</p>' : '')
        : hovory
          ? '<div class="kv"><span>' + esc(tx('hra.za_den')) + '</span><b>' + cenaDen(c.za_den) + '</b></div>'
          // „Za korunu" platilo, dokud se platilo jen v korunách. Číslo je
          // přitom správně za jednotku měny hráče — lhal jen popisek, takže
          // Polák viděl „Za złotówkę" u čísla počítaného z eura. Značku teď
          // dává server stejně jako u cen.
          : '<div class="kv"><span>' + tx('veta.za_jednotku_meny', { p1: sMenou('1') })
            + '</span><b>' + tCislo(c.za_jednotku != null ? c.za_jednotku : c.per_czk)
            + ' L$</b></div>')
    + '<div class="kv"><span>' + esc(tx('hra.plati')) + '</span><b>' + esc(ME.first_name + ' ' + ME.last_name) + '</b></div>'
    + '<button class="btn big" id="do-pay">' + esc(tx('hra.zaplatit_kartou')) + '</button>'
    + '<p class="fine">' + (ramec
        ? tx('veta.strop_plati_naporad_a_nerusi_herni')
        : kamp
          ? esc(tx('hra.kampan_cas_bezi_od_zaplaceni'))
        : hovory
          ? esc(tx('hra.cas_bezi_od_zaplaceni_a')) + ' '
            + esc(tx('hra.po_celou_dobu_bere_operator'))
          : esc(tx('hra.laundry_jsou_herni_mena_bez'))) + '</p>');
  $('do-pay').onclick = function () {
    $('do-pay').disabled = true;
    apiJson('/stripe/checkout', { kind: kind, qty: 1 }).then(function (r) {
      if (r.ok && r.j.url) { location.href = r.j.url; return; }
      $('do-pay').disabled = false;
      if (r.status === 428) return detailsSheet(null, kind);
      toast(r.j.error || esc(tx('hra.platbu_se_nepodarilo_zalozit')), 'err');
    }).catch(function () { $('do-pay').disabled = false; toast(esc(tx('hra.server_neodpovida_12')), 'err'); });
  };
}
// Zaplacené balíčky si vyzvedneme sami, hráč na nic klikat nemusí.
function claimCash(then) {
  if (!ME || !ME.cards) { if (then) then(); return; }
  // Nejdřív ručně přidaná hotovost z administrace, pak koupené balíčky.
  var k = null;
  if ((ME.cards.cash_dar || 0) > 0) k = 'cash_dar';
  // Dárek za Facebook není v nabídce, takže ho v katalogu nenajdeme — hlídáme
  // ho zvlášť, jinak by hráči zůstal ležet nevyzvednutý.
  else if ((ME.cards.cash_fb || 0) > 0) k = 'cash_fb';
  else {
    // Kampaň se spustí sama, ale jen když tím hráč nepřijde o silnější,
    // která mu zrovna běží. Slabší počká v Kartách, až ta běžící doběhne —
    // jinak by si zaplacenou kampaň sám přebil tou levnější.
    var fond = (CASH_CAT || []).concat(LINKA_CAT || [])
      .concat((KAMPAN_CAT || []).filter(function (c) { return c.add >= kampanAdd(); }));
    var dluzne = fond.filter(function (c) { return (ME.cards[c.kind] || 0) > 0; });
    if (dluzne.length) k = dluzne[0].kind;
    // Staré kreditové balíčky infolinky už v nabídce nejsou, ale kdo si nějaký
    // koupil a nevyzvedl, o něj přijít nesmí — převede se na čas.
    if (!k) {
      Object.keys(ME.cards).forEach(function (kind) {
        if (!k && /^linka/.test(kind) && ME.cards[kind] > 0) k = kind;
      });
    }
  }
  if (!k) { if (then) then(); return; }
  apiJson('/cards/use', { kind: k }).then(function (r) {
    var v = r.ok && r.j.result;
    if (v && (v.effect === 'cash' || v.effect === 'ramec')) {
      // Hotovost přidaná z administrace jde do kapsy, koupený balíček do rámce.
      // Koupený balík je zároveň zástava: banka proti němu půjčí i bez výdělku.
      if (v.effect === 'ramec') { S.bank += v.amount; S.duvera = (S.duvera || 0) + v.amount; }
      else { S.cash += v.amount; zapis('prijem', tx('veta.karta', { p1: (v.name || 'hotovost') }), v.amount); }
      ME.cards = r.j.owned;
      save(); paint(); syncState(true);
      toast(v.msg, 'ok');
      if (v.effect === 'ramec') agentNavrat();
      return claimCash(then);   // může jich čekat víc
    }
    if (v && v.effect === 'kampan') {
      spustKampan(v.add, v.dnu);
      ME.cards = r.j.owned;
      save(); paint(); syncState(true);
      toast(v.msg, 'ok', true);
      return claimCash(then);
    }
    if (v && v.effect === 'linka') {
      prodluzLinku(v.dnu || 0);
      ME.cards = r.j.owned;
      save(); paint(); syncState(true);
      toast(v.msg, 'ok', true);
      return claimCash(then);
    }
    if (then) then();
  }).catch(function () { if (then) then(); });
}

// ─── Nákup karty ─────────────────────────────────────────────────────────────
// Kartu jde koupit po jednom kuse, nebo ve slevovém balíčku. Ceny počítá
// server a posílá je v katalogu — klient je jen ukazuje.
function buyCard(kind, qty) {
  var c = (CARDS_CAT || []).filter(function (x) { return x.kind === kind; })[0];
  if (!c) return;
  if (!ME) return toast(esc(tx('hra.nejdriv_se_prihlas_2')), 'err');
  qty = Math.max(1, parseInt(qty, 10) || 1);
  if (!ME.has_details) return detailsSheet(kind, null, qty);
  var bal = c.bundles || [];
  var vybrany = bal.filter(function (b) { return b.qty === qty; })[0];
  var cena = vybrany ? vybrany.price_czk : c.price_czk * qty;
  var dlazdice = [{ qty: 1, price_czk: c.price_czk, sleva: 0 }].concat(bal);
  sheet('<h3>' + esc(polNazev(c)) + '</h3>'
    + '<p class="muted small">' + esc(polPopis(c)) + '</p>'
    + (bal.length ? '<p class="muted small" style="margin:12px 0 6px">' + esc(tx('hra.kolik_kusu')) + '</p>'
        + '<div class="balicky">' + dlazdice.map(function (b) {
            return '<button class="balik' + (b.qty === qty ? ' on' : '') + '" data-qty="' + b.qty + '">'
              + '<b>' + b.qty + '\u00d7</b>'
              + '<span>' + cenaReal(b.price_czk) + '</span>'
              + (b.sleva > 0 ? '<i>' + cenaReal((c.price_czk * b.qty)) + '</i>'
                  + '<em>\u2212' + b.sleva + ' %</em>' : '<i class="prazdno">' + esc(tx('hra.za_kus')) + '</i>')
              + '</button>';
          }).join('') + '</div>' : '')
    + '<div class="kv"><span>' + esc(tx('hra.zaplatis_2')) + '</span><b>' + cenaReal(cena) + '</b></div>'
    + (qty > 1 ? '<div class="kv"><span>' + esc(tx('hra.dostanes')) + '</span><b class="ok">' + qty + '\u00d7 ' + esc(c.name) + '</b></div>' : '')
    + '<div class="kv"><span>' + esc(tx('hra.plati_2')) + '</span><b>' + esc(ME.first_name + ' ' + ME.last_name) + '</b></div>'
    + '<div class="kv"><span>' + esc(tx('hra.e_mail')) + '</span><b>' + esc(ME.email) + '</b></div>'
    + '<button class="btn big" id="do-pay">' + esc(tx('hra.zaplatit_kartou_2')) + '</button>'
    + '<p class="fine">' + esc(tx('hra.platbu_zpracovava_stripe')) + ' '
    + (qty > 1 ? esc(tx('hra.karty_se_ti_pripisou')) : esc(tx('hra.karta_se_ti_pripise'))) + tx('veta.hned_po_zaplaceni_p', { p1: esc(tx('hra.nespotrebovane_zustavaji_na_uctu_nekazi')) }));
  [].forEach.call(document.querySelectorAll('#sheet-body [data-qty]'), function (b) {
    b.onclick = function () { buyCard(kind, b.getAttribute('data-qty')); };
  });
  $('do-pay').onclick = function () {
    $('do-pay').disabled = true;
    apiJson('/stripe/checkout', { kind: kind, qty: qty }).then(function (r) {
      if (r.ok && r.j.url) { location.href = r.j.url; return; }
      $('do-pay').disabled = false;
      if (r.status === 428) return detailsSheet(kind);
      toast(r.j.error || esc(tx('hra.platbu_se_nepodarilo_zalozit_2')), 'err');
    }).catch(function () { $('do-pay').disabled = false; toast(esc(tx('hra.server_neodpovida_15')), 'err'); });
  };
}
// Jméno a e-mail chceme až tady — do té chvíle je hra úplně anonymní.
function detailsSheet(thenKind, thenCash, thenQty, thenSub) {
  sheet('<h3>' + esc(tx('hra.jeste_dva_udaje')) + '</h3>'
    + '<p class="muted small">' + esc(tx('hra.k_platbe_potrebujeme_vedet_komu')) + '</p>'
    + '<label class="fld"><span>' + esc(tx('hra.jmeno')) + '</span><input id="d-first" class="inp" type="text" maxlength="60" value="' + esc((ME && ME.first_name) || '') + '"></label>'
    + '<label class="fld"><span>' + esc(tx('hra.prijmeni')) + '</span><input id="d-last" class="inp" type="text" maxlength="60" value="' + esc((ME && ME.last_name) || '') + '"></label>'
    + '<label class="fld"><span>' + esc(tx('hra.e_mail_2')) + '</span>' + '<input id="d-mail" class="inp" type="email" maxlength="160" value="' + esc((ME && ME.email) || '') + '"></label>'
    + '<button class="btn big" id="d-save">' + esc(tx('hra.ulozit_a_pokracovat')) + '</button>');
  $('d-save').onclick = function () {
    apiJson('/account/details', {
      first_name: $('d-first').value, last_name: $('d-last').value, email: $('d-mail').value
    }).then(function (r) {
      if (!r.ok) return toast(r.j.error || esc(tx('hra.nepovedlo_se_ulozit')), 'err');
      ME = r.j.player; closeSheet();
      if (thenKind) buyCard(thenKind, thenQty);
      else if (thenCash) buyCash(thenCash);
      else if (thenSub) zapniPredplatne(thenSub, dispecerPotreba());
    }).catch(function () { toast(esc(tx('hra.server_neodpovida_25')), 'err'); });
  };
}

// Návrat z platby: ?platba=ok&s=cs_… — karta se připisuje na webhook, takže
// chvíli počkáme, než se na serveru objeví.
function checkPayment() {
  var pm = /[?&]predplatne=([a-z]+)/.exec(location.search);
  if (pm) {
    var psid = (/[?&]s=([^&]+)/.exec(location.search) || [])[1];
    history.replaceState(null, '', location.pathname);
    if (pm[1] !== 'ok' || !psid) return toast(esc(tx('hra.predplatne_nezapnute_nic_se_nestrhlo')), 'err');
    var pt = 0;
    return (function cekej() {
      api('/stripe/status?s=' + encodeURIComponent(psid)).then(function (r) {
        if (r.ok && r.j.status === 'paid') {
          PREDPLATNE = r.j.predplatne || PREDPLATNE;
          ev('game_paid', true);
          paintCards(); switchTab('cards');
          return toast(/^linka_sub/.test(r.j.kind || '')
            ? esc(tx('hra.infolinka_bezi_a_sama_se'))
            : esc(tx('hra.vedouci_servisu_nastoupil_od_ted')), 'ok', true);
        }
        if (++pt < 10) return setTimeout(cekej, 1500);
        loadCards().then(paintCards);
        toast(esc(tx('hra.platba_se_jeste_potvrzuje_vedouci')), 'ok', true);
      }).catch(function () { });
    })();
  }
  var m = /[?&]platba=([a-z]+)/.exec(location.search);
  if (!m) return;
  var sid = (/[?&]s=([^&]+)/.exec(location.search) || [])[1];
  history.replaceState(null, '', location.pathname);
  if (m[1] !== 'ok' || !sid) return toast(esc(tx('hra.platba_zrusena_nic_se_nestrhlo')), 'err');
  var tries = 0;
  (function poll() {
    api('/stripe/status?s=' + encodeURIComponent(sid)).then(function (r) {
      if (r.ok && r.j.status === 'paid') {
        ev('game_paid', true);
        if (ME) ME.cards = r.j.owned;
        if (/^linka/.test(r.j.kind || '') || /^kampan/.test(r.j.kind || '')) {
          // Kampaň se musí spustit hned po návratu z platby. Dřív spadla do
          // větve „karta je tvoje" a na kampaň se čekalo až na minutový tik.
          return claimCash(function () { paintCards(); switchTab('cards'); });
        }
        if (/^ramec/.test(r.j.kind || '')) {
          // Strop se nepoužívá jako karta — jen si znovu načteme ceník, kde
          // server pošle novou úroveň, a ukážeme ji v bance.
          return loadCards().then(function () {
            paintCards(); paintBank(); switchTab('bank');
            toast(tx('veta.objem_ramce_se_zvedl_na', { p1: (ramecStrop() === null ? esc(tx('hra.neomezeny')) : kcFull(ramecStrop())) }), 'ok', true);
          });
        }
        if (/^cash/.test(r.j.kind || '')) {
          // Když si hráč balík kupoval kvůli konkrétní stavbě, agent ho tam
          // vrátí sám — pak by přepnutí na banku jen zmátlo.
          return claimCash(function () { paintBank(); if (!AGENT_VRACENO) switchTab('bank'); });
        }
        paintCards(); switchTab('cards');
        var kusu = Math.max(1, parseInt(r.j.qty, 10) || 1);
        return toast(kusu > 1 ? tx('veta.zaplaceno_karty_jsou_na_uctu', { p1: kusu }): esc(tx('hra.zaplaceno_karta_je_tvoje')),
          'ok', true);
      }
      if (++tries < 10) return setTimeout(poll, 1500);
      toast(esc(tx('hra.platba_se_jeste_potvrzuje_karta')), 'ok');
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
  if ($('map')) dlouhyStisk($('map'), mapaPodrzeni);
  tutStart();
  hlidejDenni();
  // Kdo hraje přes půlnoc, ať na odměnu nečeká do dalšího spuštění. Nabídka
  // karty jde až po odměně — otevřený panel ji stejně odloží na příště.
  setInterval(function () {
    hlidejDenni(); hlidejNabidky();
    // Předplatné může skončit nebo ho hráč zruší na jiném zařízení — stav si
    // proto pravidelně bereme ze serveru, nikdy si ho nedržíme natvrdo.
    loadCards();
  }, 600000);
  setTimeout(hlidejNabidky, 20000);
  var gained = S.cash - before;
  if (arrived) toast(tx('veta.dorazilo_stroju_cekaji_na_sklade_v', { p1: arrived }), 'ok', true);
  else if (gained > 1000) toast(tx('veta.nez_ses_vratil_sit_vydelala', { p1: kcFull(gained) }), 'ok', true);
  pullRefs();
  loadCards().then(function () {
    claimCash();   // co je zaplacené a nevyzvednuté, připíšeme hned
    if (!$('v-cards').classList.contains('hidden')) paintCards();
    if (!$('v-bank').classList.contains('hidden')) paintBank();
  });
  loadClaims();
  setInterval(loadClaims, 45000);
  // Co se děje ve světě. Načte se hned a pak každé dvě minuty — události
  // běží v hodinách, častěji to nemá smysl.
  loadUdalosti(function () { hlidejUdalosti(); refreshUnits(); paint(); });
  setInterval(function () {
    loadUdalosti(function () { hlidejUdalosti(); refreshUnits(); paint(); });
  }, 120000);
  // Tržiště chceme mít i na mapě, ne až po otevření Burzy.
  paintTrhBadge();
  loadTrh(drawMap);
  vyzvedniNasledky();
  loadTrades();
  setInterval(function () { loadTrades(); loadTrh(drawMap); nactiNajmy(vyzvedniNasledky); loadCards().then(function () { claimCash(); }); }, 60000);
  checkPayment();
  setInterval(function () { tick(); save(); paint(); syncState(); hlidejUkladani(); }, 5000);
  // Vlastní, rychlejší tep jen pro naskakující čísla nad prádlomaty.
  setInterval(function () { tick(); dripTick(); }, 1000);
  setInterval(pullRefs, 60000);
  // Dražba je událost — běží minutu a musí doletět i k tomu, kdo zrovna kouká
  // do mapy. Mimo dražbu se ptáme líně, během ní často.
  setInterval(hlidejDrazbu, 15000);
  hlidejDrazbu();
  document.addEventListener('visibilitychange', function () {
    // Po návratu do hry se hned podíváme, jestli nám konkurence nevyfoukla místo.
    if (!document.hidden) { syncOk = Date.now(); syncState(true); tep(); tick(); save(); paint(); loadClaims(); loadTrades(); nactiNajmy(vyzvedniNasledky); loadCards().then(function () { claimCash(); }); }
    else { tep(); syncState(true); }
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
// Tep přihlášeného hráče každou půlminutu — i ze schované záložky, jinak by
// hráč, který zrovna sleduje dražbu, vypadal na burze jako dávno pryč.
// vidim rozlišuje, jestli má hru na očích, nebo ji jen drží otevřenou.
function tep() {
  if (!ME || wiped) return;
  apiJson('/account/ping', { vidim: !document.hidden }, 'POST').catch(function () {});
}
setInterval(tep, 30000);
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
    // Žebřík hodností má jediného vlastníka: server. Kopie v hře je jen záloha
    // pro případ, že by starý server seznam ještě neposílal.
    if (Array.isArray(r.j.hodnosti) && r.j.hodnosti.length) HODNOSTI_HRA = r.j.hodnosti;
    // Katalog textů v jazyce účtu. Dokud nedorazí, jede hra na češtině
    // zadrátované v kódu — výpadek katalogu tedy hru nikdy nerozbije.
    // Překreslit smíme až když je stav načtený — /account/me se vrací dřív,
    // než hra stihne postavit S, a paint() by si na prázdnu podtrhl nohy.
    nactiTexty(ME.jazyk || 'cs', function () { if (S) paint(); });
    nactiScenare(ME.jazyk || 'cs');
    tep();   // ať je hráč na burze vidět hned, ne až za půl minuty
    var srv = r.j.state;
    if (r.j.rev != null) STATE_REV = r.j.rev;
    if (srv && (!S || (srv.lastTick || 0) >= (S.lastTick || 0))) { S = dosypStav(srv) || S; save(); }
    srovnejRef();   // až tady: stav ze serveru může mít staré pid
    if (S) { ev('game_zpet'); return startGame(); }
  }
  // Vracející se hráč úvod nikdy neuvidí — bez tohohle vypadal v trychtýři
  // jako někdo, kdo odešel před úvodem, a kazil tak celý jmenovatel.
  if (S) { ev('game_zpet'); startGame(); }   // rozehraná hra bez účtu (z doby před účty)
  else introAB();                            // nový návštěvník opravdu vidí úvod
}).catch(function () { if (S) { ev('game_zpet'); startGame(); } else introAB(); });

})();
