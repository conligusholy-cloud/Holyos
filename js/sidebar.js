/* ============================================
   sidebar.js — Shared sidebar navigation
   ============================================ */

function renderSidebar(activeModule) {
  var modules = [
    { id: 'lide-hr',             name: 'Lidé a HR',           icon: '&#128101;', color: '#6c5ce7', active: true },
    { id: 'vytvoreni-arealu',    name: 'Vytvoření areálu',    icon: '&#9998;', color: '#8b5cf6', active: true },
    { id: 'programovani-vyroby', name: 'Programování výroby', icon: '&#9881;', color: '#f59e0b', active: true },
    { id: 'simulace-vyroby',    name: 'Simulace výroby',     icon: '&#9654;', color: '#22c55e', active: true },
    { id: 'pracovni-postup',    name: 'Pracovní postup',     icon: '&#128295;', color: '#06b6d4', active: true },
    { id: 'planovani',           name: 'Plánování výroby',    icon: '&#128197;', color: '#3b82f6', active: false },
    { id: 'material',            name: 'Materiálový tok',     icon: '&#128666;', color: '#10b981', active: false },
    { id: 'sklady',              name: 'Správa skladů',       icon: '&#128230;', color: '#f59e0b', active: false },
    { id: 'reporty',             name: 'Reporty a analýzy',   icon: '&#128202;', color: '#ef4444', active: false },
    { id: 'nastaveni',           name: 'Nastavení',           icon: '&#9881;', color: '#6c8cff', active: false },
  ];

  // Compute base path to root
  var basePath = getBasePath();

  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="36" height="36">' +
    '<defs><linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" style="stop-color:#6C5CE7"/><stop offset="50%" style="stop-color:#0984E3"/><stop offset="100%" style="stop-color:#00B894"/>' +
    '</linearGradient></defs>' +
    '<rect width="100" height="100" rx="22" fill="url(#logoGrad)"/>' +
    '<rect x="22" y="22" width="10" height="56" rx="4" fill="white"/>' +
    '<rect x="68" y="22" width="10" height="56" rx="4" fill="white"/>' +
    '<rect x="32" y="42" width="36" height="10" rx="4" fill="white"/>' +
    '</svg>';

  var html = '' +
    '<a href="' + basePath + '" class="sidebar-header" style="text-decoration:none; color:inherit;">' +
      '<div class="sidebar-logo">' + logoSvg + '</div>' +
      '<div>' +
        '<h1>HOLYOS</h1>' +
        '<p>Řízení výroby</p>' +
      '</div>' +
    '</a>' +
    '<div class="sidebar-label">Moduly</div>' +
    '<nav class="sidebar-nav">';

  modules.forEach(function(m) {
    var isActive = m.id === activeModule;
    var cls = 'sidebar-item' + (isActive ? ' active' : '') + (!m.active ? ' disabled' : '');
    // Moduly s výběrovou stránkou (simulace.html) odkazují na ni, ostatní na index.html
    var entryPage = (m.id === 'vytvoreni-arealu' || m.id === 'programovani-vyroby') ? 'simulace.html' : 'index.html';
    var href = m.active ? (basePath + 'modules/' + m.id + '/' + entryPage) : '#';
    var tag = m.active ? '' : '<div class="sidebar-item-tag">Připravuje se</div>';

    html += '<a class="' + cls + '" href="' + href + '">' +
      '<div class="sidebar-icon" style="background:' + m.color + '22; color:' + m.color + ';">' + m.icon + '</div>' +
      '<div class="sidebar-item-info">' +
        '<div class="sidebar-item-name">' + m.name + '</div>' +
        tag +
      '</div>' +
    '</a>';
  });

  html += '</nav>';

  // Přihlášený uživatel + odhlášení
  html += '<div class="sidebar-user">';
  html += '  <div id="sidebar-user-info" style="padding:12px 20px; color:var(--text2); font-size:12px;">Načítám...</div>';
  html += '  <a href="/auth/logout" class="sidebar-item" style="color:var(--text2); font-size:13px;">';
  html += '    <div class="sidebar-icon" style="background:rgba(239,68,68,0.15); color:#ef4444;">&#10005;</div>';
  html += '    <div class="sidebar-item-info"><div class="sidebar-item-name">Odhlásit se</div></div>';
  html += '  </a>';
  html += '</div>';

  html += '<div class="sidebar-footer">HOLYOS v0.1 — Best Series</div>';

  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.innerHTML = html;

  // Načíst info o přihlášeném uživateli
  fetch('/auth/me').then(function(r) { return r.json(); }).then(function(u) {
    var el = document.getElementById('sidebar-user-info');
    if (el) el.textContent = u.displayName || u.username || '';
    // Pokud je admin, přidat odkaz na správu uživatelů
    if (u.role === 'admin') {
      var nav = document.querySelector('.sidebar-nav');
      if (nav) {
        var adminLink = document.createElement('a');
        adminLink.className = 'sidebar-item' + (activeModule === 'nastaveni' ? ' active' : '');
        adminLink.href = '/admin/users';
        adminLink.innerHTML = '<div class="sidebar-icon" style="background:rgba(108,140,255,0.15); color:#6c8cff;">&#9881;</div>' +
          '<div class="sidebar-item-info"><div class="sidebar-item-name">Správa uživatelů</div></div>';
        nav.appendChild(adminLink);
      }
    }
    // Pokud je super admin, přidat sekci Super Admin
    if (u.is_super_admin) {
      var userSection = document.querySelector('.sidebar-user');
      if (userSection) {
        var saSection = document.createElement('div');
        saSection.className = 'sidebar-sa-section';
        saSection.innerHTML = '<div class="sidebar-label" style="margin-top:8px; color:#ef4444;">Super Admin</div>' +
          '<nav class="sidebar-nav">' +
            '<a class="sidebar-item' + (activeModule === 'mindmap' ? ' active' : '') + '" href="' + basePath + 'modules/holyos-mindmap.html">' +
              '<div class="sidebar-icon" style="background:rgba(239,68,68,0.15); color:#ef4444;">&#129504;</div>' +
              '<div class="sidebar-item-info"><div class="sidebar-item-name">Myšlenková mapa</div></div>' +
            '</a>' +
            '<a class="sidebar-item' + (activeModule === 'admin-tasks' ? ' active' : '') + '" href="' + basePath + 'modules/admin-tasks/index.html">' +
              '<div class="sidebar-icon" style="background:rgba(108,92,231,0.15); color:#a78bfa;">&#128203;</div>' +
              '<div class="sidebar-item-info"><div class="sidebar-item-name">Požadavky</div></div>' +
            '</a>' +
            '<a class="sidebar-item' + (activeModule === 'audit-log' ? ' active' : '') + '" href="' + basePath + 'modules/audit-log/index.html">' +
              '<div class="sidebar-icon" style="background:rgba(245,158,11,0.15); color:#f59e0b;">&#128220;</div>' +
              '<div class="sidebar-item-info"><div class="sidebar-item-name">Historie změn</div></div>' +
            '</a>' +
          '</nav>';
        userSection.parentNode.insertBefore(saSection, userSection);
      }
    }
  }).catch(function() {});

  // Create hamburger button for mobile
  initHamburger();
}

function initHamburger() {
  if (document.getElementById('hamburger-btn')) return; // already exists

  // Hamburger button
  var btn = document.createElement('button');
  btn.id = 'hamburger-btn';
  btn.className = 'hamburger-btn';
  btn.innerHTML = '☰';
  btn.setAttribute('aria-label', 'Menu');
  btn.onclick = function() { toggleSidebar(); };
  document.body.appendChild(btn);

  // Overlay
  var overlay = document.createElement('div');
  overlay.id = 'sidebar-overlay';
  overlay.className = 'sidebar-overlay';
  overlay.onclick = function() { toggleSidebar(false); };
  document.body.appendChild(overlay);

  // Close sidebar when clicking a link (mobile)
  var sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.addEventListener('click', function(e) {
      if (e.target.closest('.sidebar-item') && window.innerWidth <= 768) {
        toggleSidebar(false);
      }
    });
  }
}

function toggleSidebar(forceState) {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;

  var isOpen = sidebar.classList.contains('open');
  var shouldOpen = forceState !== undefined ? forceState : !isOpen;

  if (shouldOpen) {
    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  } else {
    sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// Compute base path from current location to project root
function getBasePath() {
  // Always use absolute path to root
  return '/';
}

// Get path to module editor
function getEditorPath(simId) {
  var basePath = getBasePath();
  var url = basePath + 'modules/vytvoreni-arealu/index.html';
  if (simId) url += '?sim=' + simId;
  return url;
}

// Init date display
function initDate() {
  var el = document.getElementById('current-date');
  if (el) {
    var d = new Date();
    el.textContent = d.toLocaleDateString('cs-CZ', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }
}

// ============================================================
// AI FLOATING BUTTON + CHAT MODAL
// ============================================================

function initAiButton() {
  // Inject CSS
  var style = document.createElement('style');
  style.textContent = `
    .ai-fab { position: fixed; top: 20px; right: 20px; z-index: 9000; width: 44px; height: 44px; border-radius: 50%;
      background: linear-gradient(135deg, #6c5ce7, #0984e3); border: none; cursor: pointer; display: flex; align-items: center;
      justify-content: center; box-shadow: 0 4px 20px rgba(108,92,231,0.4); transition: all 0.3s; }
    .ai-fab:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(108,92,231,0.6); }
    .ai-fab svg { width: 22px; height: 22px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ai-fab .pulse { position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgba(108,92,231,0.4); animation: aipulse 2s infinite; }
    @keyframes aipulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }

    .ai-chat-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9998; backdrop-filter: blur(3px); }
    .ai-chat { position: fixed; top: 20px; right: 20px; z-index: 9999; width: 420px; max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px); background: #1a1a2e; border: 1px solid rgba(108,92,231,0.3); border-radius: 16px;
      display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.5); overflow: hidden; }
    .ai-chat-header { padding: 16px 20px; background: linear-gradient(135deg, rgba(108,92,231,0.15), rgba(9,132,227,0.1));
      border-bottom: 1px solid rgba(108,92,231,0.2); display: flex; align-items: center; justify-content: space-between; }
    .ai-chat-header h3 { font-size: 15px; color: #e8e8f0; margin: 0; }
    .ai-chat-close { background: none; border: none; color: #8888aa; font-size: 20px; cursor: pointer; padding: 0 4px; }
    .ai-chat-close:hover { color: #e8e8f0; }
    .ai-chat-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
    .ai-chat-footer { padding: 12px 20px; border-top: 1px solid #222240; }

    .ai-msg { margin-bottom: 14px; }
    .ai-msg-bot { background: #222240; border-radius: 12px 12px 12px 4px; padding: 10px 14px; font-size: 13px; color: #e8e8f0; line-height: 1.5; }
    .ai-msg-user { background: rgba(108,92,231,0.15); border-radius: 12px 12px 4px 12px; padding: 10px 14px; font-size: 13px;
      color: #e8e8f0; line-height: 1.5; margin-left: 30px; }
    .ai-msg-label { font-size: 10px; color: #8888aa; margin-bottom: 3px; font-weight: 600; }

    .ai-input-row { display: flex; gap: 8px; align-items: flex-end; }
    .ai-input { flex: 1; padding: 10px 14px; background: #0f0f1a; border: 1px solid #222240; border-radius: 10px;
      color: #e8e8f0; font-size: 13px; font-family: inherit; resize: none; min-height: 40px; max-height: 120px; }
    .ai-input:focus { outline: none; border-color: #6c5ce7; }
    .ai-input::placeholder { color: #666; }
    .ai-send-btn { width: 40px; height: 40px; border-radius: 10px; background: #6c5ce7; border: none; color: #fff;
      cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .ai-send-btn:hover { background: #5b4bd4; }
    .ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .ai-upload-btn { width: 40px; height: 40px; border-radius: 10px; background: #222240; border: 1px solid #333; color: #8888aa;
      cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
    .ai-upload-btn:hover { background: rgba(108,92,231,0.15); color: #a78bfa; border-color: rgba(108,92,231,0.3); }

    .ai-screenshot-preview { margin-top: 8px; border-radius: 8px; overflow: hidden; border: 1px solid #333; max-height: 150px; }
    .ai-screenshot-preview img { width: 100%; height: auto; display: block; }
    .ai-screenshot-remove { font-size: 11px; color: #ef4444; cursor: pointer; margin-top: 4px; }
    .ai-screenshot-remove:hover { text-decoration: underline; }

    .ai-q-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .ai-q-chip { padding: 5px 10px; border-radius: 14px; font-size: 11px; cursor: pointer; border: 1px solid #333;
      background: #0f0f1a; color: #8888aa; transition: all 0.2s; }
    .ai-q-chip:hover { border-color: #6c5ce7; color: #a78bfa; }

    .ai-page-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px;
      background: rgba(108,92,231,0.15); color: #a78bfa; margin-bottom: 8px; }

    @media (max-width: 768px) {
      .ai-fab { top: 12px; right: 12px; width: 38px; height: 38px; }
      .ai-fab svg { width: 18px; height: 18px; }
      .ai-chat { top: 0; right: 0; width: 100vw; max-width: 100vw; max-height: 100vh; border-radius: 0; }
      .ai-chat-body { padding: 12px 16px; }
      .ai-chat-footer { padding: 10px 12px; }
      .ai-input { font-size: 16px; } /* prevents iOS zoom */
      .ai-msg-user { margin-left: 10px; }
    }
  `;
  document.head.appendChild(style);

  // Create FAB
  var fab = document.createElement('button');
  fab.className = 'ai-fab';
  fab.title = 'AI Asistent — navrhnout úpravu';
  fab.innerHTML = '<div class="pulse"></div><svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 110 2h-1.07A7 7 0 0113 22h-2a7 7 0 01-6.93-6H3a1 1 0 110-2h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2z"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/><path d="M9 18h6"/></svg>';
  fab.onclick = openAiChat;
  document.body.appendChild(fab);
}

var _aiChatState = {
  messages: [],
  step: 0, // 0=initial, 1=ask details, 2=confirm
  description: '',
  screenshot: null,
  pagePath: '',
  pageTitle: '',
  answers: {}
};

function getCurrentPageInfo() {
  var path = window.location.pathname;
  var title = document.title || '';
  // Try to get a nicer page name
  var pageMap = {
    '/': 'Dashboard',
    '/modules/lide-hr/index.html': 'Lidé a HR',
    '/modules/vytvoreni-arealu/': 'Vytvoření areálu',
    '/modules/programovani-vyroby/': 'Programování výroby',
    '/modules/simulace-vyroby/': 'Simulace výroby',
    '/modules/pracovni-postup/': 'Pracovní postup',
    '/modules/audit-log/index.html': 'Historie změn',
    '/modules/holyos-mindmap.html': 'Myšlenková mapa',
  };
  for (var key in pageMap) {
    if (path.indexOf(key) !== -1 && key !== '/') return { path: path, title: pageMap[key] };
  }
  if (path === '/' || path === '/index.html') return { path: '/', title: 'Dashboard' };
  return { path: path, title: title || path };
}

function analyzeRequest(description, pageTitle) {
  // Analyze the user's request in context and generate a specific, thoughtful response
  var d = (description || '').toLowerCase();
  var page = (pageTitle || '').toLowerCase();

  // Build a contextual analysis
  var analysis = { response: '', followups: [] };

  // ---- Responsivita / mobilní přístup ----
  if (d.match(/responsiv|mobil|telefon|tablet|phone|touch/)) {
    var affectedPages = [];
    if (page.includes('dashboard') || d.match(/všech|celý|každ/)) affectedPages.push('všechny stránky');
    if (page.includes('hr') || d.match(/lidé|hr|zaměst/)) affectedPages.push('Lidé a HR');
    if (d.match(/sidebar|menu|navigac/)) affectedPages.push('sidebar navigaci');

    analysis.response = 'Rozumím — chcete, aby ' + (affectedPages.length ? affectedPages.join(', ') : 'aplikace') + ' fungoval/a na mobilních zařízeních. ';
    analysis.response += 'Teď mám v hlavě toto:\n\n';
    analysis.response += '• <strong>Sidebar</strong> — na mobilu se musí schovat do hamburger menu\n';
    analysis.response += '• <strong>Tabulky</strong> — široké tabulky (lidé, docházka, role) musí být horizontálně scrollovatelné nebo se přeložit do karet\n';
    analysis.response += '• <strong>Modální okna</strong> — formuláře musí být na 100% šířky displeje\n';
    analysis.response += '• <strong>Dashboard karty</strong> — přeskládat do jednoho sloupce\n\n';
    analysis.response += 'Na čem vám záleží nejvíc — chcete hlavně <strong>prohlížet data</strong> na telefonu, nebo i <strong>editovat</strong> (přidávat lidi, zapisovat docházku)?';
    return analysis;
  }

  // ---- Tabulky / seznamy ----
  if (d.match(/tabulk|seznam|výpis|sloup|řádk/)) {
    analysis.response = 'Jakou tabulku máte na mysli? ';
    if (page.includes('hr')) {
      analysis.response += 'Na stránce Lidé a HR máme tabulku zaměstnanců, docházky a rolí. ';
    }
    analysis.response += 'Co přesně vám na současné tabulce nevyhovuje — chybí sloupce, špatné řazení, nebo chcete úplně jiné rozložení?';
    return analysis;
  }

  // ---- Přidání funkce / pole ----
  if (d.match(/přidat|doplnit|chybí|nové pole|nová funkc/)) {
    analysis.response = 'Co přesně vám chybí na stránce <strong>' + pageTitle + '</strong>? ';
    analysis.response += 'Popište mi to konkrétně — např. "chybí mi pole pro bankovní účet u zaměstnance" nebo "chtěl bych tlačítko pro export do PDF". ';
    analysis.response += 'Čím konkrétnější budete, tím přesnější bude výsledek.';
    return analysis;
  }

  // ---- Design / vzhled ----
  if (d.match(/barv|styl|design|vzhled|hezč|oškli|font|motiv/)) {
    analysis.response = 'Rozumím, chcete vizuální změnu. Co konkrétně vám vadí na současném vzhledu? ';
    analysis.response += 'Zkuste nahrát screenshot a zakroužkovat místo, které chcete změnit — nebo popište, jak by to mělo vypadat jinak.';
    return analysis;
  }

  // ---- Export / tisk ----
  if (d.match(/export|pdf|tisk|csv|excel|vytisknout/)) {
    analysis.response = 'Jaká data chcete exportovat a v jakém formátu? ';
    if (page.includes('hr')) {
      analysis.response += 'Z modulu Lidé a HR můžeme exportovat seznam zaměstnanců, docházkové listy, nebo výplatní přehledy. ';
    }
    analysis.response += 'Pro koho je export určený — pro vás, pro účetní, nebo pro někoho dalšího?';
    return analysis;
  }

  // ---- Notifikace / upozornění ----
  if (d.match(/notifik|upozorn|alert|připomín|email/)) {
    analysis.response = 'Na co přesně chcete být upozorněni? ';
    analysis.response += 'Důležité je vědět: kdo má upozornění dostat, kdy se má spustit (okamžitě, denně, před termínem?), a jakým kanálem (v aplikaci, emailem, nebo obojí)?';
    return analysis;
  }

  // ---- Oprávnění / přístupy ----
  if (d.match(/oprávn|přístup|role|práv|viditelnost|zakáz/)) {
    analysis.response = 'Teď máme systém oprávnění na úrovni rolí (čtení/úprava/žádný přístup k modulům). ';
    analysis.response += 'Co přesně chcete omezit nebo povolit — a pro koho? Např. "technici by neměli vidět mzdy" nebo "vedoucí výroby potřebuje editovat jen svůj tým".';
    return analysis;
  }

  // ---- Docházka ----
  if (d.match(/docházk|příchod|odchod|směn|přesčas|dovolen/)) {
    analysis.response = 'Teď máme základní záznam docházky (ruční). Co potřebujete? ';
    analysis.response += 'Například: čipové karty, schvalování dovolených, přehled přesčasů, export pro účetní? ';
    analysis.response += 'Popište mi svůj ideální workflow — jak by to mělo denně fungovat.';
    return analysis;
  }

  // ---- Graf / dashboard / statistiky ----
  if (d.match(/graf|dashboard|statistik|přehled|report|analýz|chart/)) {
    analysis.response = 'Jaká data chcete vidět v grafickém přehledu? ';
    analysis.response += 'Je to pro vás jako šéfa (CEO dashboard), nebo pro vedoucí jednotlivých úseků? ';
    analysis.response += 'Popište mi, jaká čísla nebo trendy jsou pro vás nejdůležitější.';
    return analysis;
  }

  // ---- Obecný požadavek — ptáme se na kontext ----
  analysis.response = 'Rozumím vašemu požadavku. Abych mohl vytvořit přesné zadání, potřebuji vědět pár věcí:\n\n';
  analysis.response += '1. <strong>Jak přesně</strong> by to mělo vypadat nebo fungovat?\n';
  analysis.response += '2. <strong>Kdo</strong> s tím bude pracovat — vy, všichni zaměstnanci, nebo specifická role?\n\n';
  analysis.response += 'Čím víc detailů mi dáte (klidně i screenshot), tím přesnější bude výsledek na první dobrou.';
  return analysis;
}

function openAiChat() {
  var page = getCurrentPageInfo();
  _aiChatState = {
    messages: [],
    step: 0,
    description: '',
    screenshot: null,
    pagePath: page.path,
    pageTitle: page.title,
    answers: {}
  };

  // Add initial bot message
  _aiChatState.messages.push({
    role: 'bot',
    text: 'Ahoj! 👋 Vidím, že jste na stránce <strong>' + page.title + '</strong>.\n\nPopište, co byste chtěli upravit nebo přidat. Můžete také nahrát screenshot pro přesnější vyjádření.'
  });

  renderAiChat();
}

function renderAiChat() {
  // Remove existing
  var existing = document.getElementById('ai-chat-root');
  if (existing) existing.remove();

  var root = document.createElement('div');
  root.id = 'ai-chat-root';

  var overlay = document.createElement('div');
  overlay.className = 'ai-chat-overlay';
  overlay.onclick = closeAiChat;
  root.appendChild(overlay);

  var chat = document.createElement('div');
  chat.className = 'ai-chat';

  // Header
  chat.innerHTML = '<div class="ai-chat-header"><h3>🤖 AI Asistent</h3><button class="ai-chat-close" onclick="closeAiChat()">&times;</button></div>';

  // Body
  var body = document.createElement('div');
  body.className = 'ai-chat-body';
  body.id = 'ai-chat-body';

  // Page badge
  body.innerHTML = '<div class="ai-page-badge">📍 ' + _aiChatState.pageTitle + '</div>';

  // Messages
  _aiChatState.messages.forEach(function(msg) {
    var div = document.createElement('div');
    div.className = 'ai-msg';
    div.innerHTML = '<div class="ai-msg-label">' + (msg.role === 'bot' ? '🤖 AI' : '👤 Vy') + '</div>' +
      '<div class="ai-msg-' + (msg.role === 'bot' ? 'bot' : 'user') + '">' + msg.text + '</div>';
    body.appendChild(div);
  });

  // Contextual AI response after user messages
  if (_aiChatState.step >= 1 && _aiChatState.step < 2) {
    // Show submit button area
    var submitDiv = document.createElement('div');
    submitDiv.style.cssText = 'padding:10px 0; display:flex; gap:8px; align-items:center;';
    submitDiv.innerHTML = '<button class="ai-send-btn" style="width:auto;padding:8px 16px;border-radius:8px;font-size:12px;background:#6c5ce7;" onclick="submitAiTask()">✅ Odeslat požadavek</button>' +
      '<span style="font-size:11px;color:#8888aa;">nebo pokračujte v popisu</span>';
    body.appendChild(submitDiv);
  }

  // Screenshot preview
  if (_aiChatState.screenshot) {
    var ssDiv = document.createElement('div');
    ssDiv.innerHTML = '<div class="ai-screenshot-preview"><img src="' + _aiChatState.screenshot + '"></div>' +
      '<div class="ai-screenshot-remove" onclick="removeAiScreenshot()">✕ Odebrat screenshot</div>';
    body.appendChild(ssDiv);
  }

  chat.appendChild(body);

  // Footer with input
  if (_aiChatState.step < 2) {
    var footer = document.createElement('div');
    footer.className = 'ai-chat-footer';
    footer.innerHTML = '<div class="ai-input-row">' +
      '<label class="ai-upload-btn" title="Nahrát screenshot"><input type="file" accept="image/*" style="display:none" onchange="handleAiScreenshot(this)">📷</label>' +
      '<textarea class="ai-input" id="ai-input" placeholder="Popište svůj požadavek…" rows="1" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendAiMessage()}"></textarea>' +
      '<button class="ai-send-btn" onclick="sendAiMessage()">→</button>' +
      '</div>';
    chat.appendChild(footer);
  }

  root.appendChild(chat);
  document.body.appendChild(root);

  // Scroll to bottom
  setTimeout(function() { body.scrollTop = body.scrollHeight; }, 50);
}

function closeAiChat() {
  var el = document.getElementById('ai-chat-root');
  if (el) el.remove();
}

function handleAiScreenshot(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 2 * 1024 * 1024) { alert('Max 2 MB'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    _aiChatState.screenshot = e.target.result;
    renderAiChat();
  };
  reader.readAsDataURL(file);
}

function removeAiScreenshot() {
  _aiChatState.screenshot = null;
  renderAiChat();
}

function sendAiMessage() {
  var input = document.getElementById('ai-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text && !_aiChatState.screenshot) return;

  // Add user message
  _aiChatState.messages.push({ role: 'user', text: text });

  if (_aiChatState.step === 0) {
    // First message — analyze and respond contextually
    _aiChatState.description = text;
    var analysis = analyzeRequest(text, _aiChatState.pageTitle);
    _aiChatState.messages.push({ role: 'bot', text: analysis.response });
    _aiChatState.step = 1;
  } else {
    // Follow-up messages — acknowledge and ask for more if needed
    var allText = _aiChatState.messages.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.text; }).join(' ');
    var msgCount = _aiChatState.messages.filter(function(m) { return m.role === 'user'; }).length;

    if (msgCount <= 3) {
      // Still gathering info — respond to the new details
      var analysis = analyzeFollowup(text, allText, _aiChatState.pageTitle);
      _aiChatState.messages.push({ role: 'bot', text: analysis });
    }
    // After 3+ messages, just let user keep adding context or submit
  }

  renderAiChat();
}

function analyzeFollowup(newText, allText, pageTitle) {
  var d = newText.toLowerCase();
  var all = allText.toLowerCase();

  // If user answered about mobile/responsive
  if (all.match(/responsiv|mobil/) && d.match(/editovat|zapisovat|přidáv/)) {
    return 'Takže potřebujete na mobilu i editaci — to znamená, že formuláře musí být dotykově ovládatelné, s většími poli a tlačítky. Budete na telefonu zapisovat docházku nebo spíš upravovat záznamy zaměstnanců?';
  }
  if (all.match(/responsiv|mobil/) && d.match(/prohlíž|jen se díva|přehled/)) {
    return 'Jasně, hlavně prohlížení — to je jednodušší. Tabulky převedu do přehledných karet, sidebar schováme do menu. Chcete mít na mobilní verzi i dashboard se statistikami?';
  }

  // If talking about specific data
  if (d.match(/všech|celý|komplet/)) {
    return 'Rozumím, uplatníme to na celou aplikaci. Máte ještě nějaké specifické požadavky na konkrétní stránky, nebo to stačí? Pokud ano, klidně odešlete požadavek.';
  }

  // If user is adding more detail
  if (d.length > 30) {
    return 'Díky za upřesnění, tohle pomůže. Máte ještě něco, nebo můžeme požadavek odeslat?';
  }

  return 'Zachytil jsem. Chcete ještě něco doplnit, nebo to odešleme?';
}

function submitAiTask() {
  // Collect user messages and AI conversation as context
  var userMessages = _aiChatState.messages.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.text; });
  var conversationLog = _aiChatState.messages.map(function(m) {
    return (m.role === 'bot' ? 'AI: ' : 'Uživatel: ') + m.text.replace(/<[^>]*>/g, '');
  }).join('\n');

  var task = {
    page: _aiChatState.pagePath,
    page_title: _aiChatState.pageTitle,
    description: userMessages.join('\n---\n'),
    ai_questions: [],
    ai_answers: { conversation: conversationLog },
    screenshot: _aiChatState.screenshot,
    priority: 'medium',
  };

  fetch('/api/admin-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  }).then(function(r) { return r.json(); }).then(function(result) {
    _aiChatState.step = 2;
    _aiChatState.messages.push({
      role: 'bot',
      text: '✅ <strong>Požadavek #' + result.id + ' byl uložen!</strong>\n\nNajdete ho v sekci Super Admin → Požadavky. Odtud ho můžete přímo nasadit.'
    });
    renderAiChat();
  }).catch(function(e) {
    alert('Chyba při ukládání: ' + e.message);
  });
}

// Auto-init AI button when sidebar loads
// Runs immediately if DOM is ready, or waits for it
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { initAiButton(); });
  } else {
    // DOM already loaded (script loaded dynamically after page load)
    initAiButton();
  }
}
