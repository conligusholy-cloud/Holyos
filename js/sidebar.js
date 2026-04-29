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
    { id: 'prodejni-objednavky',  name: 'Prodejní objednávky', icon: '&#128176;', color: '#eab308', active: true },
    { id: 'vyrobni-sloty',        name: 'Výrobní sloty',       icon: '&#128197;', color: '#f97316', active: true },
    { id: 'sklady',                name: 'Sklady',              icon: '&#127981;', color: '#f59e0b', active: true },
    { id: 'tiskarny',              name: 'Tiskárny',            icon: '&#128424;', color: '#10b981', active: true },
    { id: 'doklady',               name: 'Skladové doklady',    icon: '&#128209;', color: '#8b5cf6', active: true },
    { id: 'ucetni-doklady',       name: 'Účetní doklady',      icon: '&#128178;', color: '#0891b2', active: true },
    { id: 'banky',                name: 'Banky',               icon: '&#127974;', color: '#0ea5e9', active: true },
    { id: 'banka-pravidla',       name: 'Pravidla párování',   icon: '&#9878;',   color: '#a855f7', active: true },
    { id: 'pokladna',             name: 'Pokladna',            icon: '&#128181;', color: '#10b981', active: true },
    { id: 'naklady',              name: 'Náklady',             icon: '&#128202;', color: '#ef4444', active: true },
    { id: 'davky',                 name: 'Pickovací dávky',     icon: '&#128230;', color: '#f59e0b', active: true },
    { id: 'pracoviste',           name: 'Pracoviště',          icon: '&#127981;', color: '#14b8a6', active: true },
    { id: 'normovani-fy',         name: 'Normování',           icon: '&#9201;',   color: '#6366f1', active: true },
    { id: 'vozovy-park',          name: 'Vozový park',         icon: '&#128663;', color: '#0ea5e9', active: true },
    { id: 'chat',                 name: 'Zprávy',              icon: '&#128172;', color: '#a78bfa', active: true },
    { id: 'kiosky',               name: 'Kiosky',              icon: '&#128433;', color: '#06b6d4', active: true },
    { id: 'planovani-vyroby',   name: 'Plánování výroby',    icon: '&#128197;', color: '#3b82f6', active: true },
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
    // Pokud je super admin, přidat sekci Super Admin (dovnitř hlavní sidebar-nav)
    if (u.isSuperAdmin || u.is_super_admin) {
      var nav = nav || document.querySelector('.sidebar-nav');
      if (nav) {
        var saLabel = document.createElement('div');
        saLabel.className = 'sidebar-label';
        saLabel.style.cssText = 'margin-top:8px; color:#ef4444; padding:12px 10px 6px;';
        saLabel.textContent = 'Super Admin';
        nav.appendChild(saLabel);

        var saItems = [
          { id: 'cad-vykresy', href: basePath + 'modules/cad-vykresy/index.html', icon: '&#128196;', color: 'rgba(2,132,199,0.15)', textColor: '#0284c7', name: 'CAD výkresy' },
          { id: 'ai-agenti', href: basePath + 'modules/ai-agenti/index.html', icon: '&#129302;', color: 'rgba(139,92,246,0.15)', textColor: '#8b5cf6', name: 'AI Agenti' },
          { id: 'dev-hub', href: basePath + 'modules/dev-hub/index.html', icon: '&#128736;', color: 'rgba(249,115,22,0.15)', textColor: '#f97316', name: 'Dev Hub' },
          { id: 'mindmap', href: basePath + 'modules/holyos-mindmap.html', icon: '&#129504;', color: 'rgba(239,68,68,0.15)', textColor: '#ef4444', name: 'Myšlenková mapa' },
          { id: 'admin-tasks', href: basePath + 'modules/admin-tasks/index.html', icon: '&#128203;', color: 'rgba(108,92,231,0.15)', textColor: '#a78bfa', name: 'Požadavky' },
          { id: 'audit-log', href: basePath + 'modules/audit-log/index.html', icon: '&#128220;', color: 'rgba(245,158,11,0.15)', textColor: '#f59e0b', name: 'Historie změn' },
        ];
        saItems.forEach(function(m) {
          var a = document.createElement('a');
          a.className = 'sidebar-item' + (activeModule === m.id ? ' active' : '');
          a.href = m.href;
          a.innerHTML = '<div class="sidebar-icon" style="background:' + m.color + '; color:' + m.textColor + ';">' + m.icon + '</div>' +
            '<div class="sidebar-item-info"><div class="sidebar-item-name">' + m.name + '</div></div>';
          nav.appendChild(a);
        });
      }
    }
  }).catch(function() {});

  // Create hamburger button for mobile
  initHamburger();

  // AI Voice Assistant — deaktivováno
  // if (!document.getElementById('ai-assistant-script')) {
  //   var aiScript = document.createElement('script');
  //   aiScript.id = 'ai-assistant-script';
  //   aiScript.src = basePath + 'js/ai-assistant.js?v=' + Date.now();
  //   document.body.appendChild(aiScript);
  // }

  // Load HolyOS top bar (úkoly / zprávy / zvonek / AI)
  // user-chat-widget.js se načítá zpět — 💬 ikonu v top-baru používáme jako
  // trigger pro jeho plovoucí panel (vlastní bublina widgetu je skrytá přes CSS).
  var tbScripts = [
    { id: 'holyos-events-script', src: 'js/holyos-events.js' },
    { id: 'holyos-chat-widget-script', src: 'js/user-chat-widget.js' },
    { id: 'holyos-topbar-script', src: 'js/top-bar.js' },
  ];
  tbScripts.forEach(function(s) {
    if (!document.getElementById(s.id)) {
      var tag = document.createElement('script');
      tag.id = s.id;
      tag.src = basePath + s.src + '?v=' + Date.now();
      document.body.appendChild(tag);
    }
  });
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
    /* Drag & drop stav — pulzující fialový obrys přes celý chat */
    .ai-chat.dragging { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(168,139,250,0.3), 0 20px 60px rgba(0,0,0,0.5); }
    .ai-chat-drop-hint { position: absolute; inset: 0; pointer-events: none; display: none; align-items: center; justify-content: center;
      background: rgba(108,92,231,0.15); border: 2px dashed #a78bfa; border-radius: 16px; color: #a78bfa; font-weight: 600; font-size: 15px; z-index: 10; }
    .ai-chat.dragging .ai-chat-drop-hint { display: flex; }

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

    /* Seznam přiložených souborů (PDF / Word / Excel / …) */
    .ai-attachments { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .ai-attachment { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #0f0f1a; border: 1px solid #222240; border-radius: 8px; font-size: 12px; }
    .ai-attachment .ico { font-size: 18px; }
    .ai-attachment .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e8e8f0; }
    .ai-attachment .sz { color: #8888aa; font-size: 10px; flex-shrink: 0; }
    .ai-attachment .rm { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 12px; padding: 0 4px; }
    .ai-attachment.uploading { opacity: 0.6; }
    .ai-attachment.uploading::after { content: '⏳'; margin-left: 4px; }

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
    screenshot: null,     // hlavní obrázek (pro preview + zachování zpětné kompat.)
    attachments: [],      // další soubory — PDF, Word, Excel, obrázky navíc atd.
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
  // Remove existing (i s cleanup document-level listenerů, ať nenabalujeme duplicitní)
  var existing = document.getElementById('ai-chat-root');
  if (existing) {
    if (typeof existing._aiChatDndCleanup === 'function') {
      try { existing._aiChatDndCleanup(); } catch (_) {}
    }
    existing.remove();
  }

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

  // Seznam dalších příloh (PDF / Word / Excel / obrázek navíc atd.)
  if (_aiChatState.attachments && _aiChatState.attachments.length) {
    var attWrap = document.createElement('div');
    attWrap.className = 'ai-attachments';
    _aiChatState.attachments.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'ai-attachment' + (a.status === 'uploading' ? ' uploading' : '');
      if (a.status === 'failed') row.style.borderColor = '#ef4444';
      row.innerHTML = '<span class="ico">' + _fileIconForAttachment(a) + '</span>' +
        '<span class="nm" title="' + (a.name || '').replace(/"/g, '&quot;') + '">' + (a.name || 'soubor') + '</span>' +
        '<span class="sz">' + _fmtAttachSize(a.size) + '</span>' +
        '<button class="rm" onclick="removeAiAttachment(\'' + a.localId + '\')" title="Odebrat">✕</button>';
      attWrap.appendChild(row);
    });
    body.appendChild(attWrap);
  }

  chat.appendChild(body);

  // Footer with input
  if (_aiChatState.step < 2) {
    var footer = document.createElement('div');
    footer.className = 'ai-chat-footer';
    footer.innerHTML = '<div class="ai-input-row">' +
      '<label class="ai-upload-btn" title="Připojit soubor (obrázek, PDF, Word, Excel…)"><input type="file" multiple accept="*/*" style="display:none" onchange="handleAiFilePick(this)">📎</label>' +
      '<textarea class="ai-input" id="ai-sidebar-input" placeholder="Popište svůj požadavek…" rows="1" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendAiMessage()}"></textarea>' +
      '<button class="ai-send-btn" onclick="sendAiMessage()">→</button>' +
      '</div>';
    chat.appendChild(footer);
  }

  // Drop hint overlay — zobrazí se jen když někdo táhne soubor nad chat
  var dropHint = document.createElement('div');
  dropHint.className = 'ai-chat-drop-hint';
  dropHint.innerHTML = '📥 Pusť obrázek pro rychlé vložení';
  chat.appendChild(dropHint);

  root.appendChild(chat);
  document.body.appendChild(root);

  // ─── Drag & drop souborů kamkoli do AI chatu ─────────────────────────
  // Safari na Macu má potvrzené problémy s tím, že drop events neprobublávají
  // spolehlivě skrz vrstvy overlay + chat. Proto registrujeme listenery na
  // DVOU úrovních:
  //   1) `root` (chat kontejner) — standardní cesta, funguje na Chrome/Firefox
  //   2) `document` — globální záchranná síť pro Safari. Aktivní jen dokud
  //      je chat otevřený; při closeAiChat se odregistruje (viz closeAiChat).
  var dragCounter = 0;

  function aiChatOnDragEnter(e) {
    if (!e.dataTransfer) return;
    if (_dragHasFiles(e)) {
      e.preventDefault();
      dragCounter++;
      chat.classList.add('dragging');
    }
  }
  function aiChatOnDragOver(e) {
    if (!e.dataTransfer) return;
    // VŽDY preventDefault — bez toho Safari odmítne následný drop.
    // Nestačí jen když _dragHasFiles; Safari reportuje types nestabilně.
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    if (_dragHasFiles(e)) chat.classList.add('dragging');
  }
  function aiChatOnDragLeave(e) {
    // Jen když uživatel opustí celé okno (relatedTarget === null) nebo
    // po zmenšení counteru na 0
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) chat.classList.remove('dragging');
  }
  function aiChatOnDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    chat.classList.remove('dragging');
    var dt = e.dataTransfer;
    var files = (dt && dt.files && dt.files.length) ? Array.prototype.slice.call(dt.files) : [];
    if (!files.length && dt && dt.items) {
      for (var i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind === 'file') {
          var f = dt.items[i].getAsFile();
          if (f) files.push(f);
        }
      }
    }
    console.log('[AI chat] drop:', files.length, 'soubor(ů)',
      files.map(function (f) { return f.name + ' (' + (f.type || '?') + ', ' + f.size + ' B)'; }));
    if (files.length) _addAiAttachmentsFromFiles(files);
    else console.warn('[AI chat] drop proběhl, ale dataTransfer neobsahoval žádné soubory ani items.');
  }

  // 1) Standardní cesta přes chat container
  root.addEventListener('dragenter', aiChatOnDragEnter);
  root.addEventListener('dragover', aiChatOnDragOver);
  root.addEventListener('dragleave', aiChatOnDragLeave);
  root.addEventListener('drop', aiChatOnDrop);

  // 2) Globální záchrana pro Safari Mac (drop events tam občas nedoprobublávají).
  //    Listenery zrušíme v closeAiChat() — uložíme je na root jako custom property.
  document.addEventListener('dragenter', aiChatOnDragEnter);
  document.addEventListener('dragover', aiChatOnDragOver);
  document.addEventListener('dragleave', aiChatOnDragLeave);
  document.addEventListener('drop', aiChatOnDrop);
  root._aiChatDndCleanup = function () {
    document.removeEventListener('dragenter', aiChatOnDragEnter);
    document.removeEventListener('dragover', aiChatOnDragOver);
    document.removeEventListener('dragleave', aiChatOnDragLeave);
    document.removeEventListener('drop', aiChatOnDrop);
  };

  // Scroll to bottom
  setTimeout(function() { body.scrollTop = body.scrollHeight; }, 50);
}

// Helper — jestli aktuální drag obsahuje soubory (ne text/html atd.)
// `dataTransfer.types` je DOMStringList (Safari) nebo Array (Chrome) —
// podpora obou variant přes for-loop + .contains() fallback.
function _dragHasFiles(e) {
  if (!e.dataTransfer) return false;
  var types = e.dataTransfer.types || [];
  for (var i = 0; i < types.length; i++) {
    var t = types[i];
    if (t === 'Files' || t === 'application/x-moz-file') return true;
  }
  if (typeof types.contains === 'function' && types.contains('Files')) return true;
  return false;
}

// Helper — vezme File objekt, načte ho jako data URL a uloží do stavu.
// Použije se pro obrázky, které zobrazujeme jako screenshot preview.
function _setAiScreenshotFromFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { alert('Obrázek je větší než 20 MB.'); return; }
  if (file.type && file.type.indexOf('image') !== 0) { alert('Soubor není obrázek.'); return; }
  var reader = new FileReader();
  reader.onload = function (ev) {
    _aiChatState.screenshot = ev.target.result;
    renderAiChat();
  };
  reader.readAsDataURL(file);
}

// Helper — vezme soubor (jakýkoliv typ), nahraje ho do /api/storage/upload
// a přidá referenci do _aiChatState.attachments. Obrázky jdou do attachments
// jen když už je přítomný hlavní screenshot — jinak se nastaví jako preview.
function _addAiAttachmentsFromFiles(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;

  files.forEach(function (file) {
    if (file.size > 20 * 1024 * 1024) {
      alert('Soubor "' + file.name + '" je větší než 20 MB, přeskakuji.');
      return;
    }
    var isImage = file.type && file.type.indexOf('image') === 0;
    // První obrázek bez screenshotu → uložíme jako screenshot preview
    if (isImage && !_aiChatState.screenshot) {
      _setAiScreenshotFromFile(file);
      return;
    }

    // Ostatní: upload do storage a reference v attachments
    var item = {
      localId: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: file.name,
      size: file.size,
      mime: file.type || '',
      kind: isImage ? 'image' : 'file',
      status: 'uploading',
      url: null,
    };
    _aiChatState.attachments.push(item);
    renderAiChat();

    _uploadFileToStorage(file).then(function (saved) {
      item.url = saved.url;
      item.status = 'ready';
      renderAiChat();
    }).catch(function (e) {
      console.warn('[AI chat] upload failed', e);
      item.status = 'failed';
      renderAiChat();
    });
  });
}

function _uploadFileToStorage(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var s = String(reader.result || '');
      var comma = s.indexOf(',');
      var b64 = comma >= 0 ? s.slice(comma + 1) : s;
      var headers = { 'Content-Type': 'application/json' };
      var t = sessionStorage.getItem('token');
      if (t) headers['Authorization'] = 'Bearer ' + t;
      fetch('/api/storage/upload', {
        method: 'POST',
        credentials: 'include',
        headers: headers,
        body: JSON.stringify({
          file_data: b64,
          file_name: file.name,
          file_type: file.type || null,
          folder: 'admin-tasks',
        }),
      }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(resolve).catch(reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function removeAiAttachment(localId) {
  _aiChatState.attachments = _aiChatState.attachments.filter(function (a) { return a.localId !== localId; });
  renderAiChat();
}

function _fileIconForAttachment(att) {
  var mime = (att.mime || '').toLowerCase();
  var name = (att.name || '').toLowerCase();
  if (mime.indexOf('image') === 0) return '🖼️';
  if (mime.indexOf('pdf') >= 0 || name.endsWith('.pdf')) return '📕';
  if (mime.indexOf('word') >= 0 || mime.indexOf('msword') >= 0 || name.endsWith('.docx') || name.endsWith('.doc')) return '📄';
  if (mime.indexOf('sheet') >= 0 || mime.indexOf('excel') >= 0 || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return '📊';
  if (mime.indexOf('zip') >= 0 || name.endsWith('.zip') || name.endsWith('.rar')) return '🗜️';
  if (mime.indexOf('text') === 0) return '📝';
  return '📎';
}

function _fmtAttachSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function closeAiChat() {
  var el = document.getElementById('ai-chat-root');
  if (el) {
    // Odregistruj globální document-level drop listenery (Safari backup)
    if (typeof el._aiChatDndCleanup === 'function') {
      try { el._aiChatDndCleanup(); } catch (_) {}
    }
    el.remove();
  }
}

function handleAiScreenshot(input) {
  if (!input.files || !input.files[0]) return;
  _setAiScreenshotFromFile(input.files[0]);
}

// Nový handler — přijímá jakýkoliv typ souboru (více najednou)
function handleAiFilePick(input) {
  if (!input.files || !input.files.length) return;
  _addAiAttachmentsFromFiles(input.files);
  input.value = ''; // reset, ať jde stejný soubor vybrat znovu
}

function removeAiScreenshot() {
  _aiChatState.screenshot = null;
  renderAiChat();
}

// Ctrl+V paste — obrázek nebo soubor ze schránky do AI chatu
document.addEventListener('paste', function(e) {
  // Funkční jen když je AI chat otevřený
  var chatEl = document.getElementById('ai-chat-root');
  if (!chatEl) return;
  var items = (e.clipboardData || e.originalEvent.clipboardData).items;
  var files = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') {
      var f = items[i].getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    _addAiAttachmentsFromFiles(files);
  }
});

function sendAiMessage() {
  var input = document.getElementById('ai-sidebar-input');
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

  // Zkontroluj, že všechny přílohy jsou uploadované (ne uprostřed uploadu / failed)
  var pending = (_aiChatState.attachments || []).filter(function (a) { return a.status !== 'ready'; });
  if (pending.length) {
    var uploading = pending.filter(function (a) { return a.status === 'uploading'; });
    if (uploading.length) { alert('Počkej, ' + uploading.length + ' příloha se ještě nahrává…'); return; }
    var failed = pending.filter(function (a) { return a.status === 'failed'; });
    if (failed.length) {
      if (!confirm(failed.length + ' příloha se nepodařila nahrát. Odeslat požadavek bez ní?')) return;
    }
  }
  var readyAttachments = (_aiChatState.attachments || [])
    .filter(function (a) { return a.status === 'ready' && a.url; })
    .map(function (a) { return { url: a.url, name: a.name, size: a.size, mime: a.mime, kind: a.kind }; });

  var task = {
    page: _aiChatState.pagePath,
    page_title: _aiChatState.pageTitle,
    description: userMessages.join('\n---\n'),
    ai_questions: [],
    ai_answers: {
      conversation: conversationLog,
      attachments: readyAttachments, // PDF/Word/Excel atd., pole { url, name, size, mime, kind }
    },
    screenshot: _aiChatState.screenshot,
    priority: 'medium',
  };

  // Diagnostika — vidíš v DevTools console, jestli screenshot vůbec posíláme
  console.log('[AI chat] submitAiTask',
    'screenshot:', _aiChatState.screenshot ? (_aiChatState.screenshot.length + ' znaků') : 'NULL',
    'attachments:', readyAttachments.length,
    'page:', _aiChatState.pagePath);

  var headers = { 'Content-Type': 'application/json' };
  var t = sessionStorage.getItem('token');
  if (t) headers['Authorization'] = 'Bearer ' + t;

  fetch('/api/admin-tasks', {
    method: 'POST',
    credentials: 'include',
    headers: headers,
    body: JSON.stringify(task)
  }).then(function(r) {
    if (!r.ok) throw new Error('Server vrátil chybu ' + r.status);
    return r.json();
  }).then(function(result) {
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

// Starý floatující AI FAB ("AI Asistent — navrhnout úpravu") byl nahrazen
// horní lištou v js/top-bar.js. Funkce initAiButton() zůstává jen proto, aby
// si ji případně mohl volat starší kód — auto-init je vypnutý.
