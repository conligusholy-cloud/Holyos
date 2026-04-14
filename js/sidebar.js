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
    { id: 'nakup-sklad',          name: 'Nákup a sklad',       icon: '&#128230;', color: '#10b981', active: true },
    { id: 'sklady',                name: 'Sklady',              icon: '&#127981;', color: '#f59e0b', active: true },
    { id: 'pracoviste',           name: 'Pracoviště',          icon: '&#127981;', color: '#14b8a6', active: true },
    { id: 'ai-agenti',            name: 'AI Agenti',           icon: '&#129302;', color: '#8b5cf6', active: true },
    { id: 'dev-hub',              name: 'Dev Hub',             icon: '&#128736;', color: '#f97316', active: true },
    { id: 'planovani',           name: 'Plánování výroby',    icon: '&#128197;', color: '#3b82f6', active: false },
    { id: 'material',            name: 'Materiálový tok',     icon: '&#128666;', color: '#10b981', active: false },
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
  html += '  <a href="#" onclick="logoutUser(); return false;" class="sidebar-item" style="color:var(--text2); font-size:13px;">';
  html += '    <div class="sidebar-icon" style="background:rgba(239,68,68,0.15); color:#ef4444;">&#10005;</div>';
  html += '    <div class="sidebar-item-info"><div class="sidebar-item-name">Odhlásit se</div></div>';
  html += '  </a>';
  html += '</div>';

  html += '<div class="sidebar-footer">HOLYOS v0.1 — Best Series</div>';

  var sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.className = 'sidebar';
    sidebar.innerHTML = html;
  }

  // Načíst info o přihlášeném uživateli
  var _authHeaders = { credentials: 'include' };
  var _storedToken = sessionStorage.getItem('token');
  if (_storedToken) {
    _authHeaders.headers = { 'Authorization': 'Bearer ' + _storedToken };
  }
  fetch('/api/auth/me', _authHeaders).then(function(r) {
    if (r.status === 401) {
      // Nepřihlášen — přesměruj na login
      var currentPath = window.location.pathname + window.location.search;
      window.location.href = '/login.html?redirect=' + encodeURIComponent(currentPath);
      return null;
    }
    return r.json();
  }).then(function(data) {
    if (!data) return; // redirected
    var u = data.user || data;
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
    if (u.isSuperAdmin || u.is_super_admin) {
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

  // Load AI Voice Assistant
  if (!document.getElementById('ai-assistant-script')) {
    var aiScript = document.createElement('script');
    aiScript.id = 'ai-assistant-script';
    aiScript.src = basePath + 'js/ai-assistant.js';
    document.body.appendChild(aiScript);
  }

  // Load AI Chat Panel (Claude-powered)
  if (!document.getElementById('ai-chat-panel-script')) {
    var chatScript = document.createElement('script');
    chatScript.id = 'ai-chat-panel-script';
    chatScript.src = basePath + 'js/ai-chat-panel.js';
    document.body.appendChild(chatScript);
  }
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
  var d = (description || '').toLowerCase();
  var page = (pageTitle || '').toLowerCase();
  var analysis = { response: '', followups: [] };

  // Page context — what elements exist on current page
  var pageContext = getPageContext(page);

  // Extract key action words from the request
  var wantsReplace = d.match(/místo|nahrad|změn|přejmenuj|přepiš|zamění|vyměn/);
  var wantsAdd = d.match(/přidej|přidat|doplnit|dej|přidání|nové|nový|novou|chybí|chci|chtěl/);
  var wantsRemove = d.match(/odeber|smaž|zruš|odstraň|nechci|schovat|skrýt/);
  var wantsMove = d.match(/přesuň|přesunou|posun|přemíst/);
  var wantsChange = d.match(/uprav|změn|oprav|předělej|jinak|jiný/);

  // Extract what the user is talking about — the object of the request
  var mentions = extractMentions(d);

  // Build a specific, thoughtful response
  var r = '';

  // Specific understanding of the request
  if (wantsReplace) {
    var parts = d.split(/místo|nahrad|namísto|zamění/);
    r += 'Rozumím — na stránce <strong>' + pageTitle + '</strong> chcete ';
    if (parts.length >= 2) {
      r += 'nahradit jednu věc za druhou. ';
    } else {
      r += 'provést záměnu. ';
    }
    r += 'Řekněte mi přesně: co tam je teď a co tam má být místo toho? ';
    if (pageContext.elements.length > 0) {
      r += 'Na této stránce teď vidím: ' + pageContext.elements.join(', ') + '.';
    }
  } else if (wantsAdd) {
    r += 'Chcete přidat něco na stránku <strong>' + pageTitle + '</strong>. ';
    r += 'Zachytil jsem: <em>"' + description + '"</em>. ';
    r += 'Abych to uměl přesně realizovat — kam přesně to chcete umístit a jak to má vypadat?';
  } else if (wantsRemove) {
    r += 'Rozumím — chcete něco odebrat nebo skrýt na stránce <strong>' + pageTitle + '</strong>. ';
    r += 'Co přesně má zmizet? Úplně smazat, nebo jen schovat pro určité role?';
  } else if (wantsMove) {
    r += 'Chcete přemístit prvek na stránce <strong>' + pageTitle + '</strong>. ';
    r += 'Odkud a kam přesně? Klidně přiložte screenshot a zakroužkujte.';
  } else if (wantsChange) {
    r += 'Chcete upravit něco na stránce <strong>' + pageTitle + '</strong>. ';
    r += 'Zachytil jsem: <em>"' + description + '"</em>. ';
    r += 'Jak přesně by to mělo vypadat po úpravě?';
  } else {
    // No clear action — paraphrase and ask
    r += 'Zachytil jsem váš požadavek: <em>"' + description + '"</em>.\n\n';
    r += 'Pracujete na stránce <strong>' + pageTitle + '</strong>';
    if (pageContext.elements.length > 0) {
      r += ', kde teď máme: ' + pageContext.elements.join(', ');
    }
    r += '. Co přesně chcete změnit?';
  }

  analysis.response = r;
  return analysis;
}

function getPageContext(page) {
  var ctx = { elements: [] };
  if (page.includes('hr') || page.includes('lidé')) {
    ctx.elements = ['tabulku zaměstnanců', 'docházku', 'org. strukturu (strom rolí)', 'správu rolí s oprávněními', 'společnosti'];
  } else if (page.includes('mindmap') || page.includes('myšlenk')) {
    ctx.elements = ['myšlenkovou mapu modulů', 'deploy wizard', 'statusy nasazení'];
  } else if (page.includes('dashboard') || page.includes('přehled')) {
    ctx.elements = ['karty modulů', 'sidebar navigaci', 'statistiky'];
  } else if (page.includes('areál')) {
    ctx.elements = ['editor půdorysu', 'kreslení hal a cest'];
  } else if (page.includes('výrob') || page.includes('programov')) {
    ctx.elements = ['rozmísťování pracovišť', 'logistické trasy'];
  } else if (page.includes('audit') || page.includes('historie')) {
    ctx.elements = ['seznam změn', 'rollback', 'filtry'];
  } else if (page.includes('požadav') || page.includes('task')) {
    ctx.elements = ['seznam požadavků', 'statusy', 'deploy specifikace'];
  }
  return ctx;
}

function extractMentions(text) {
  var found = [];
  var keywords = {
    'oddělení': 'oddělení', 'společnost': 'společnost', 'firma': 'firma',
    'tabulk': 'tabulku', 'fotk': 'fotku', 'obrázek': 'obrázek',
    'sidebar': 'sidebar', 'menu': 'menu', 'tlačítk': 'tlačítko',
    'pole': 'pole', 'formulář': 'formulář', 'modal': 'modální okno',
    'role': 'role', 'oprávnění': 'oprávnění', 'barv': 'barvy',
    'graf': 'graf', 'docházk': 'docházku', 'export': 'export'
  };
  for (var key in keywords) {
    if (text.includes(key)) found.push(keywords[key]);
  }
  return found;
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
  if (file.size > 20 * 1024 * 1024) { alert('Max 20 MB'); return; }
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

// Ctrl+V paste support for AI chat screenshots
document.addEventListener('paste', function(e) {
  // Only handle if AI chat is open (root wrapper has id='ai-chat-root')
  var chatEl = document.getElementById('ai-chat-root');
  if (!chatEl) return;
  var items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      var file = items[i].getAsFile();
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { alert('Max 20 MB'); return; }
      var reader = new FileReader();
      reader.onload = function(ev) {
        _aiChatState.screenshot = ev.target.result;
        renderAiChat();
      };
      reader.readAsDataURL(file);
      return;
    }
  }
});

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

  // Build response that references what was said before
  var r = 'Zachytil jsem: <em>"' + newText + '"</em>.\n\n';

  // Check if user is confirming or adding detail
  if (d.match(/ano|jo|přesně|správně|souhlasí|ok|jasně|jojo/)) {
    r = 'Dobře, mám to. Chcete ještě něco doplnit, nebo odešleme požadavek?';
  } else if (d.match(/ne\b|nikoliv|špatně|blbě|jinak/)) {
    r = 'Rozumím, tak to upřesněte — co přesně máte na mysli?';
  } else {
    // User is adding more context — acknowledge specifically
    r += 'Tohle doplním k původnímu požadavku. Máte ještě něco, nebo to můžeme odeslat?';
  }

  return r;
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

// Odhlášení přes API
function logoutUser() {
  fetch('/api/auth/logout', { method: 'POST' }).then(function() {
    localStorage.removeItem('token');
    window.location.href = '/';
  }).catch(function() {
    window.location.href = '/';
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
