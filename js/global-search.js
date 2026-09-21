/* ============================================================================
   global-search.js — HolyOS globální vyhledávání (CTRL + PAUSE)
   ----------------------------------------------------------------------------
   Kdekoliv v systému stiskni CTRL + PAUSE a ve spodní čtvrtině obrazovky
   vyskočí prázdné vyhledávací pole s našeptávačem. Při psaní se nabízí vše,
   co obsahuje nebo začíná zadaným textem:
     • moduly, stránky a formuláře  — statický katalog níže (okamžitě, bez serveru)
     • zboží, výrobky a činnosti    — GET /api/search (materiály, produkty, operace)
   Klik nebo Enter = rovnou přechod na cílovou stránku, okno se zavře.
   ESC okno zavře bez výběru.

   Skript se načítá automaticky ze sidebar.js (tbScripts), na stránkách bez
   sidebaru je vložen přímo <script> tagem.
   ============================================================================ */
(function () {
  'use strict';

  if (window.__holyosGlobalSearchLoaded) return;
  window.__holyosGlobalSearchLoaded = true;

  // Na přihlašovací stránce hledání nedává smysl.
  if (/\/login(\.html)?$/i.test(location.pathname)) return;

  var API_MIN_CHARS = 2;       // od kolika znaků se ptáme serveru
  var DEBOUNCE_MS = 220;       // prodleva před dotazem na server
  var MAX_STATIC = 8;          // kolik položek katalogu max. zobrazit
  var MAX_API = 12;            // kolik položek z databáze max. zobrazit

  // ─── Katalog modulů, stránek a formulářů ──────────────────────────────────
  // module  — id modulu kvůli oprávnění (allowed_modules z /api/auth/me)
  // kw      — klíčová slova; hledá se v názvu i v nich (bez ohledu na diakritiku)
  // deep    — volitelný přechod na konkrétní záložku / předvyplnění pole
  // sa/adm  — položka jen pro super admina / admina
  var CATALOG = [
    // — Obchod ——————————————————————————————————————————————————————————————
    { name: 'Obchod', url: '/modules/obchod/index.html', module: 'obchod', icon: '💼',
      kw: 'crm leady poptavky obchodni pripady pipeline zakaznici kontakty nabidky rezervace' },
    { name: 'Obchodník — moje kontakty', url: '/modules/obchodnik/index.html', module: 'obchod', icon: '💼',
      kw: 'obchodnik kontakty kalendar schuzky ukoly moje' },
    { name: 'Import kontaktů', url: '/modules/obchodnik/import-kontaktu.html', module: 'obchod', icon: '📥',
      kw: 'import kontaktu csv excel nacteni leadu formular' },
    { name: 'Vedoucí obchodu — přehled', url: '/modules/vedouci-obchodu/index.html', module: 'obchod', icon: '📈',
      kw: 'vedouci obchodu prehled vykon obchodniku statistiky' },
    { name: 'Prodejní objednávky', url: '/modules/prodejni-objednavky/index.html', module: 'prodejni-objednavky', icon: '💰',
      kw: 'zakazky objednavky odberatel konfigurator cenik prodej' },
    { name: 'Spare Parts Shop', url: '/modules/spare-parts/index.html', module: 'spare-parts', icon: '🛒',
      kw: 'nahradni dily eshop obchod partneri objednavky dilu' },

    // — Lidé ————————————————————————————————————————————————————————————————
    { name: 'Lidé a HR', url: '/modules/lide-hr/index.html', module: 'lide-hr', icon: '👥',
      kw: 'zamestnanci lide personalistika dochazka dovolena absence smeny mzdy uchazeci nastup kompetence' },
    { name: 'Můj profil', url: '/modules/muj-profil/index.html', module: null, icon: '👤',
      kw: 'profil moje udaje heslo nastaveni uctu' },
    { name: 'Správa uživatelů', url: '/admin/users', module: null, adm: true, icon: '⚙️',
      kw: 'uzivatele opravneni role prava ucty administrace' },

    // — Výroba ——————————————————————————————————————————————————————————————
    { name: 'Pracovní postup', url: '/modules/pracovni-postup/index.html', module: 'pracovni-postup', icon: '🔧',
      kw: 'technologicky postup operace cinnost cinnosti kusovnik bom vyrobky vyrobek normy casy' },
    { name: 'Koncept plánování — pracovní postup', url: '/modules/pracovni-postup/koncept.html', module: 'pracovni-postup', icon: '📐',
      kw: 'koncept planovani navrh postupu' },
    { name: 'Plánování výroby', url: '/modules/planovani-vyroby/index.html', module: 'planovani-vyroby', icon: '📅',
      kw: 'plan vyroby gantt davky kapacity terminy harmonogram' },
    { name: 'Výrobní sloty', url: '/modules/vyrobni-sloty/index.html', module: 'vyrobni-sloty', icon: '📆',
      kw: 'sloty kapacita vyroby rezervace slotu schema' },
    { name: 'Pracoviště', url: '/modules/pracoviste/index.html', module: 'pracoviste', icon: '🏭',
      kw: 'pracoviste stroje haly obsluha pracovnici linky' },
    { name: 'Kiosky', url: '/modules/kiosky/index.html', module: 'kiosky', icon: '🖥️',
      kw: 'kiosky terminaly vyrobni kiosek odvadeni prace' },
    { name: 'Pickovací dávky', url: '/modules/davky/index.html', module: 'davky', icon: '📦',
      kw: 'davky picking vychystani sarze batch' },
    { name: 'Normování', url: '/modules/normovani-fy/index.html', module: 'normovani-fy', icon: '⏱️',
      kw: 'normovani casy operaci mereni normy snimek dne' },
    { name: 'Normy — přehled', url: '/modules/normovani-prehled/index.html', module: 'normovani-prehled', icon: '📊',
      kw: 'normy prehled casy porovnani kalibrace' },
    { name: 'Simulace výroby', url: '/modules/simulace-vyroby/index.html', module: 'simulace-vyroby', icon: '▶️',
      kw: 'simulace vyroby beh modelu prutok' },
    { name: 'Programování výroby — výběr areálu', url: '/modules/programovani-vyroby/simulace.html', module: 'programovani-vyroby', icon: '⚙️',
      kw: 'programovani vyroby areal vyber program linky' },
    { name: 'Programování výroby — editor', url: '/modules/programovani-vyroby/index.html', module: 'programovani-vyroby', icon: '⚙️',
      kw: 'editor programu vyroby uprava programu' },
    { name: 'Vytvoření areálu — správa areálů', url: '/modules/vytvoreni-arealu/simulace.html', module: 'vytvoreni-arealu', icon: '✏️',
      kw: 'arealy sprava layout hala pudorys' },
    { name: 'Vytvoření areálu — editor půdorysu', url: '/modules/vytvoreni-arealu/index.html', module: 'vytvoreni-arealu', icon: '✏️',
      kw: 'editor pudorysu layout kresleni haly' },

    // — Sklad a nákup ———————————————————————————————————————————————————————
    { name: 'Nákup a sklad', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '📦',
      kw: 'nakup sklad materialy dodavatele objednavky zasoby' },
    { name: 'Zboží (katalog)', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '📦',
      deep: { tab: 'materials' }, kw: 'zbozi materialy katalog polozky kody skladove karty' },
    { name: 'Nákupní objednávky', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '📋',
      deep: { tab: 'orders' }, kw: 'nakupni objednavky dodavatelum poptavky formular' },
    { name: 'Společnosti (dodavatelé)', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '🏢',
      deep: { tab: 'companies' }, kw: 'spolecnosti dodavatele firmy odberatele ico' },
    { name: 'Skladové zásoby', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '📦',
      deep: { tab: 'stock' }, kw: 'zasoby stav skladu mnozstvi lokace' },
    { name: 'Skladové pohyby', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '🔄',
      deep: { tab: 'movements' }, kw: 'pohyby prijem vydej presun historie skladu' },
    { name: 'Inventury', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '📋',
      deep: { tab: 'inventories' }, kw: 'inventura inventury scitani stavu' },
    { name: 'Výhled nákupu', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '📈',
      deep: { tab: 'forecast' }, kw: 'vyhled nakupu potreba materialu forecast' },
    { name: 'Kategorie zboží', url: '/modules/nakup-sklad/index.html', module: 'nakup-sklad', icon: '🗂️',
      deep: { tab: 'categories' }, kw: 'kategorie zbozi strom clenani' },
    { name: 'Sklady', url: '/modules/sklady/index.html', module: 'sklady', icon: '🏭',
      kw: 'sklady lokace regaly pozice skladova mista' },
    { name: 'Skladové doklady', url: '/modules/doklady/index.html', module: 'doklady', icon: '📑',
      kw: 'prijemky vydejky doklady skladove prevodky' },
    { name: 'Tiskárny', url: '/modules/tiskarny/index.html', module: 'tiskarny', icon: '🖨️',
      kw: 'tiskarny etikety stitky tisk sablony' },

    // — Ekonomika ———————————————————————————————————————————————————————————
    { name: 'Účetní doklady', url: '/modules/ucetni-doklady/index.html', module: 'ucetni-doklady', icon: '💵',
      kw: 'faktura faktury prijate vydane doklady ucetnictvi dph schvalovani dodaci listy zalohy' },
    { name: 'Banky', url: '/modules/banky/index.html', module: 'banky', icon: '🏦',
      kw: 'banka ucty vypisy transakce platby parovani' },
    { name: 'Pravidla párování', url: '/modules/banka-pravidla/index.html', module: 'banka-pravidla', icon: '⚖️',
      kw: 'parovani pravidla banka transakce automaticke' },
    { name: 'Pokladna', url: '/modules/pokladna/index.html', module: 'pokladna', icon: '💶',
      kw: 'pokladna hotovost prijmy vydaje pokladni doklad' },
    { name: 'Náklady', url: '/modules/naklady/index.html', module: 'naklady', icon: '📊',
      kw: 'naklady strediska rozpocty analyza nakladu' },
    { name: 'Bankovní plán', url: '/modules/bankovni-plan/index.html', module: null, sa: true, icon: '🏦',
      kw: 'bankovni business plan financni model dscr unit economics' },

    // — Provoz ——————————————————————————————————————————————————————————————
    { name: 'Servis', url: '/modules/servis/index.html', module: 'servis', icon: '🔧',
      kw: 'servis pozadavky zavady udrzba pradlomat pradlomaty kiosek znalostni baze hlaseni' },
    { name: 'Infolinka — hovory', url: '/modules/servis/infolinka-hovory.html', module: 'servis', icon: '☎️',
      kw: 'infolinka hovory zaznamy prepisy operatori' },
    { name: 'Velín (mobil)', url: '/modules/velin/index.html', module: 'velin', icon: '🕐',
      kw: 'velin den kolegu mobil rizeni dne ukoly' },
    { name: 'Doprava', url: '/modules/doprava/index.html', module: 'doprava', icon: '🚚',
      kw: 'doprava prepravy pozadavky na dopravu rozvoz' },
    { name: 'Vozový park', url: '/modules/vozovy-park/index.html', module: 'vozovy-park', icon: '🚗',
      kw: 'vozidla vozy vuz auta stk pojisteni servis pneumatiky tankovani skody' },
    { name: 'Site Development', url: '/modules/site-development/index.html', module: 'site-development', icon: '🗺️',
      kw: 'lokality pozemky expanze site development smlouvy mista' },
    { name: 'Metodické pokyny a směrnice', url: '/modules/metodicke-pokyny/index.html', module: 'metodicke-pokyny', icon: '📚',
      kw: 'smernice metodicke pokyny dokumentace predpisy postupy' },
    { name: 'Zprávy (chat)', url: '/modules/chat/index.html', module: 'chat', icon: '💬',
      kw: 'zpravy chat komunikace kanaly konverzace' },
    { name: 'Překladač', url: '/modules/prekladac/index.html', module: 'prekladac', icon: '🗣️',
      kw: 'prekladac preklad jazyky tlumoceni' },

    // — Super admin —————————————————————————————————————————————————————————
    { name: 'CAD výkresy', url: '/modules/cad-vykresy/index.html', module: null, sa: true, icon: '📄',
      kw: 'cad vykresy konstrukce dxf komponenty' },
    { name: 'AI Agenti', url: '/modules/ai-agenti/index.html', module: null, sa: true, icon: '🤖',
      kw: 'ai agenti asistenti dovednosti skills' },
    { name: 'AI Vývojář', url: '/modules/ai-vyvojar/index.html', module: null, sa: true, icon: '💻',
      kw: 'ai vyvojar kod uprava systemu' },
    { name: 'Dev Hub', url: '/modules/dev-hub/index.html', module: null, sa: true, icon: '🛠️',
      kw: 'dev hub nasazeni deploy logy vyvoj' },
    { name: 'Myšlenková mapa', url: '/modules/holyos-mindmap.html', module: null, sa: true, icon: '🧠',
      kw: 'myslenkova mapa mindmap poznamky struktura systemu' },
    { name: 'Požadavky na úpravy', url: '/modules/admin-tasks/index.html', module: null, sa: true, icon: '📋',
      kw: 'pozadavky ukoly upravy admin tasks zadani' },
    { name: 'Historie změn', url: '/modules/audit-log/index.html', module: null, sa: true, icon: '📜',
      kw: 'audit log historie zmen kdo co zmenil' },
    { name: 'Databáze leadů', url: '/modules/crm-databaze/index.html', module: null, sa: true, icon: '🗃️',
      kw: 'databaze leadu crm adepti import' },
    { name: 'Factorify Browser (datový model)', url: '/modules/datovy-model/index.html', module: null, sa: true, icon: '🗂️',
      kw: 'datovy model factorify browser struktura dat' },
  ];

  // ─── Pomocné funkce ───────────────────────────────────────────────────────

  // Porovnáváme bez diakritiky a bez ohledu na velikost písmen — ať „prac"
  // najde „Pracoviště" i „PRACOVNÍ POSTUP".
  function norm(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getToken() {
    try { return sessionStorage.getItem('token') || localStorage.getItem('token') || ''; }
    catch (_) { return ''; }
  }

  function fetchOpts() {
    var t = getToken();
    var o = { credentials: 'include' };
    if (t) o.headers = { 'Authorization': 'Bearer ' + t };
    return o;
  }

  // Zvýrazní shodu v textu (porovnává se bez diakritiky, vypisuje se originál).
  function highlight(text, q) {
    var raw = String(text == null ? '' : text);
    if (!q) return escapeHtml(raw);
    var idx = norm(raw).indexOf(norm(q));
    if (idx < 0) return escapeHtml(raw);
    return escapeHtml(raw.slice(0, idx)) +
      '<mark class="gs-mark">' + escapeHtml(raw.slice(idx, idx + q.length)) + '</mark>' +
      escapeHtml(raw.slice(idx + q.length));
  }

  // ─── Oprávnění (sdílená s /api/auth/me) ───────────────────────────────────

  var permsPromise = null;
  function loadPerms() {
    if (permsPromise) return permsPromise;
    permsPromise = fetch('/api/auth/me', fetchOpts())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return { allowed: null, sa: false, admin: false };
        var u = d.user || d;
        var sa = !!(u.isSuperAdmin || u.is_super_admin);
        var admin = sa || u.role === 'admin';
        return { allowed: (admin ? null : (d.allowed_modules || {})), sa: sa, admin: admin };
      })
      .catch(function () { return { allowed: null, sa: false, admin: false }; });
    return permsPromise;
  }

  // Do načtení oprávnění nabízíme vše kromě super-admin položek — sidebar
  // se chová stejně (síťová chyba = radši ukázat, 401 stejně přesměruje).
  var perms = { allowed: null, sa: false, admin: false };
  loadPerms().then(function (p) { perms = p; });

  function maySee(entry) {
    if (entry.sa) return perms.sa;
    if (entry.adm) return perms.admin;
    if (!entry.module) return true;          // osobní stránky — vidí každý
    if (perms.allowed === null) return true; // admin / super admin
    return !!perms.allowed[entry.module];
  }

  // ─── Hledání v katalogu ───────────────────────────────────────────────────

  function searchCatalog(q) {
    var n = norm(q);
    var out = [];
    for (var i = 0; i < CATALOG.length; i++) {
      var e = CATALOG[i];
      if (!maySee(e)) continue;
      var nameN = norm(e.name);
      var kwN = norm(e.kw);
      var s = -1;
      if (nameN.indexOf(n) === 0) s = 0;                        // název začíná dotazem
      else if (nameN.indexOf(n) > 0) s = 10 + nameN.indexOf(n); // název obsahuje
      else if ((' ' + kwN).indexOf(' ' + n) >= 0) s = 40;       // klíčové slovo začíná
      else if (kwN.indexOf(n) >= 0) s = 50;                     // klíčové slovo obsahuje
      if (s < 0) continue;
      out.push({
        kind: 'stranka', kindLabel: 'Stránka', icon: e.icon || '📄',
        title: e.name,
        subtitle: e.url.replace(/^\/modules\//, '').replace(/\/index\.html$/, ''),
        url: e.url, deep: e.deep || null, _score: s
      });
    }
    out.sort(function (a, b) { return a._score - b._score || a.title.localeCompare(b.title, 'cs'); });
    return out.slice(0, MAX_STATIC);
  }

  // ─── Přechod na cíl (včetně „deep-linku" na záložku / do filtru) ──────────

  // Cílová stránka se otevře normálně; případný deep-link předáme v URL jako
  // gs_tab / gs_field / gs_q a po načtení si ho tenhle skript sám vyzvedne
  // (applyDeepLink níže). Díky tomu nemusí jednotlivé moduly nic řešit.
  function buildUrl(item) {
    var url = item.url;
    var d = item.deep;
    if (!d) return url;
    var parts = [];
    if (d.tab) parts.push('gs_tab=' + encodeURIComponent(d.tab));
    if (d.field) parts.push('gs_field=' + encodeURIComponent(d.field));
    if (d.value) parts.push('gs_q=' + encodeURIComponent(d.value));
    if (!parts.length) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
  }

  function go(item) {
    if (!item) return;
    close();
    window.location.href = buildUrl(item);
  }

  // Po příchodu na stránku: přepni záložku a předvyplň filtr, pak URL uklid.
  // Moduly načítají data asynchronně, takže to zkoušíme opakovaně (max ~4 s).
  function applyDeepLink() {
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (_) { return; }
    var tab = sp.get('gs_tab');
    var field = sp.get('gs_field');
    var value = sp.get('gs_q');
    if (!tab && !field) return;

    var tabDone = !tab, fieldDone = !field, tries = 0;

    function attempt() {
      tries++;
      if (!tabDone) {
        var tabEl = document.querySelector('[data-tab="' + String(tab).replace(/["\\\]]/g, '') + '"]');
        if (tabEl) { try { tabEl.click(); } catch (_) {} tabDone = true; }
      }
      if (!fieldDone) {
        var inp = document.getElementById(field);
        if (inp) {
          inp.value = value || '';
          try {
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('keyup', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (_) {}
          fieldDone = true;
        }
      }
      if ((tabDone && fieldDone) || tries > 12) {
        // Parametry v URL už nejsou potřeba — ať nepřekáží při obnovení stránky.
        try {
          sp.delete('gs_tab'); sp.delete('gs_field'); sp.delete('gs_q');
          var qs = sp.toString();
          history.replaceState({}, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
        } catch (_) {}
        return;
      }
      setTimeout(attempt, 300);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(attempt, 60); });
    } else {
      setTimeout(attempt, 60);
    }
  }

  // ─── UI ───────────────────────────────────────────────────────────────────

  var el = {};         // odkazy na DOM prvky okna
  var results = [];    // aktuálně zobrazené položky
  var activeIdx = -1;  // vybraná položka (klávesnice)
  var debounceT = null;
  var apiCtrl = null;  // AbortController posledního dotazu
  var lastQuery = '';

  function injectStyles() {
    if (document.getElementById('holyos-gs-styles')) return;
    var css = [
      '#holyos-gs-overlay{position:fixed;inset:0;z-index:3000;display:none;',
      '  background:rgba(10,10,20,.45);}',
      '#holyos-gs-overlay.open{display:block;}',
      /* Panel sedí uprostřed spodní čtvrtiny obrazovky (střed ~87,5 % výšky). */
      '#holyos-gs-panel{position:fixed;left:50%;bottom:12.5vh;transform:translateX(-50%);',
      '  width:min(720px,94vw);background:var(--surface,#282840);color:var(--text,#e0e0f0);',
      '  border:1px solid var(--border,#3a3a5c);border-radius:14px;',
      '  box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden;font-size:14px;',
      "  font-family:'Segoe UI',system-ui,sans-serif;}",
      /* Výsledky se rozbalují nahoru, ať okno nepřeteče přes spodní hranu. */
      '#holyos-gs-list{max-height:42vh;overflow-y:auto;}',
      '#holyos-gs-list:not(:empty){border-bottom:1px solid var(--border,#3a3a5c);}',
      '.gs-item{display:flex;align-items:center;gap:12px;padding:9px 16px;cursor:pointer;',
      '  border-bottom:1px solid rgba(255,255,255,.04);}',
      '.gs-item:last-child{border-bottom:none;}',
      '.gs-item:hover,.gs-item.active{background:rgba(108,140,255,.16);}',
      '.gs-icon{width:26px;text-align:center;font-size:16px;flex-shrink:0;}',
      '.gs-texts{min-width:0;flex:1;}',
      '.gs-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.gs-sub{font-size:11px;color:var(--text2,#a0a0c0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.gs-tag{flex-shrink:0;font-size:10px;text-transform:uppercase;letter-spacing:.5px;',
      '  color:var(--text2,#a0a0c0);border:1px solid var(--border,#3a3a5c);border-radius:6px;padding:2px 7px;}',
      '.gs-mark{background:rgba(78,205,196,.28);color:inherit;border-radius:3px;padding:0 1px;}',
      '#holyos-gs-inputwrap{display:flex;align-items:center;gap:10px;padding:12px 16px;}',
      '#holyos-gs-input{flex:1;background:transparent;border:none;outline:none;color:var(--text,#e0e0f0);',
      '  font-size:16px;font-family:inherit;}',
      '#holyos-gs-input::placeholder{color:var(--text2,#a0a0c0);}',
      '#holyos-gs-hint{display:flex;justify-content:space-between;gap:12px;padding:7px 16px;',
      '  font-size:11px;color:var(--text2,#a0a0c0);background:rgba(0,0,0,.18);',
      '  border-top:1px solid var(--border,#3a3a5c);}',
      '#holyos-gs-spinner{font-size:11px;color:var(--text2,#a0a0c0);}',
      '@media (max-width:640px){#holyos-gs-panel{bottom:8vh;width:96vw;}#holyos-gs-list{max-height:38vh;}}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'holyos-gs-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function ensureUi() {
    if (el.overlay) return;
    injectStyles();

    var overlay = document.createElement('div');
    overlay.id = 'holyos-gs-overlay';
    overlay.innerHTML =
      '<div id="holyos-gs-panel" role="dialog" aria-label="Globální vyhledávání">' +
        '<div id="holyos-gs-list" role="listbox"></div>' +
        '<div id="holyos-gs-inputwrap">' +
          '<span style="font-size:16px;opacity:.75">&#128269;</span>' +
          '<input id="holyos-gs-input" type="text" autocomplete="off" spellcheck="false" ' +
            'placeholder="Co hledáte? (modul, stránka, zboží, činnost…)">' +
          '<span id="holyos-gs-spinner"></span>' +
        '</div>' +
        '<div id="holyos-gs-hint">' +
          '<span>&#8593; &#8595; výběr &middot; Enter otevřít &middot; Esc zavřít</span>' +
          '<span>CTRL + PAUSE</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    el.overlay = overlay;
    el.panel = overlay.querySelector('#holyos-gs-panel');
    el.list = overlay.querySelector('#holyos-gs-list');
    el.input = overlay.querySelector('#holyos-gs-input');
    el.spinner = overlay.querySelector('#holyos-gs-spinner');

    // Klik mimo panel zavírá.
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });

    el.input.addEventListener('input', onInput);
    el.input.addEventListener('keydown', onInputKey);
  }

  function render() {
    if (!el.list) return;
    if (!results.length) {
      el.list.innerHTML = lastQuery
        ? '<div class="gs-item" style="cursor:default;opacity:.7"><div class="gs-icon">&#128270;</div>' +
          '<div class="gs-texts"><div class="gs-title">Nic nenalezeno</div>' +
          '<div class="gs-sub">Zkuste jiné slovo nebo jeho část</div></div></div>'
        : '';
      return;
    }
    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      html += '<div class="gs-item' + (i === activeIdx ? ' active' : '') + '" data-idx="' + i + '" role="option">' +
        '<div class="gs-icon">' + (r.icon || '&#128196;') + '</div>' +
        '<div class="gs-texts">' +
          '<div class="gs-title">' + highlight(r.title, lastQuery) + '</div>' +
          (r.subtitle ? '<div class="gs-sub">' + escapeHtml(r.subtitle) + '</div>' : '') +
        '</div>' +
        '<div class="gs-tag">' + escapeHtml(r.kindLabel || '') + '</div>' +
      '</div>';
    }
    el.list.innerHTML = html;

    Array.prototype.forEach.call(el.list.querySelectorAll('.gs-item[data-idx]'), function (node) {
      node.addEventListener('click', function () {
        go(results[parseInt(node.getAttribute('data-idx'), 10)]);
      });
      node.addEventListener('mousemove', function () {
        var i = parseInt(node.getAttribute('data-idx'), 10);
        if (i !== activeIdx) { activeIdx = i; markActive(); }
      });
    });
    markActive();
  }

  function markActive() {
    if (!el.list) return;
    Array.prototype.forEach.call(el.list.querySelectorAll('.gs-item[data-idx]'), function (node, i) {
      if (i === activeIdx) {
        node.classList.add('active');
        if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
      } else {
        node.classList.remove('active');
      }
    });
  }

  function onInput() {
    var q = el.input.value.trim();
    lastQuery = q;
    if (apiCtrl) { try { apiCtrl.abort(); } catch (_) {} apiCtrl = null; }
    if (debounceT) { clearTimeout(debounceT); debounceT = null; }

    if (!q) { results = []; activeIdx = -1; el.spinner.textContent = ''; render(); return; }

    // Katalog odpovídá okamžitě, data z databáze doplníme po doběhnutí dotazu.
    results = searchCatalog(q);
    activeIdx = results.length ? 0 : -1;
    render();

    if (q.length < API_MIN_CHARS) { el.spinner.textContent = ''; return; }

    el.spinner.textContent = 'hledám…';
    debounceT = setTimeout(function () { queryApi(q); }, DEBOUNCE_MS);
  }

  function queryApi(q) {
    var ctrl = null;
    try { ctrl = new AbortController(); apiCtrl = ctrl; } catch (_) {}
    var opts = fetchOpts();
    if (ctrl) opts.signal = ctrl.signal;

    fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=' + MAX_API, opts)
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (data) {
        if (lastQuery !== q) return; // mezitím uživatel dopsal něco jiného
        el.spinner.textContent = '';
        var apiItems = (data && data.items) || [];
        results = searchCatalog(q).concat(apiItems.slice(0, MAX_API));
        if (activeIdx < 0 && results.length) activeIdx = 0;
        if (activeIdx >= results.length) activeIdx = results.length - 1;
        render();
      })
      .catch(function () {
        if (lastQuery === q) el.spinner.textContent = '';
      });
  }

  function onInputKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length) { activeIdx = (activeIdx + 1) % results.length; markActive(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) { activeIdx = (activeIdx - 1 + results.length) % results.length; markActive(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && results[activeIdx]) go(results[activeIdx]);
    } else if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function isOpen() { return !!(el.overlay && el.overlay.classList.contains('open')); }

  function open() {
    ensureUi();
    loadPerms().then(function (p) { perms = p; });
    el.overlay.classList.add('open');
    el.input.value = '';
    lastQuery = '';
    results = [];
    activeIdx = -1;
    el.spinner.textContent = '';
    render();
    setTimeout(function () { try { el.input.focus(); } catch (_) {} }, 0);
  }

  function close() {
    if (!el.overlay) return;
    el.overlay.classList.remove('open');
    if (debounceT) { clearTimeout(debounceT); debounceT = null; }
    if (apiCtrl) { try { apiCtrl.abort(); } catch (_) {} apiCtrl = null; }
  }

  function toggle() { if (isOpen()) close(); else open(); }

  // ─── Klávesová zkratka ────────────────────────────────────────────────────
  // CTRL + PAUSE (klávesa Pause/Break, keyCode 19). Odchytáváme v capture fázi,
  // ať nás nepředběhne handler konkrétního modulu.
  document.addEventListener('keydown', function (e) {
    var isPause = (e.code === 'Pause' || e.key === 'Pause' || e.keyCode === 19);
    if (isPause && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }, true);

  // Deep-link z předchozí navigace (přepnutí záložky, předvyplnění filtru).
  applyDeepLink();

  // Veřejné API — kdyby chtěl nějaký modul okno otevřít vlastním tlačítkem.
  window.holyosGlobalSearch = { open: open, close: close, toggle: toggle };
})();
