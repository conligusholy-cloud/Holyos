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

function getSmartQuestions(description) {
  var d = (description || '').toLowerCase();
  var questions = [];

  if (d.match(/tabulk|seznam|výpis|přehled/)) {
    questions.push('Jaké sloupce má tabulka obsahovat?');
    questions.push('Chcete filtrování nebo řazení?');
  }
  if (d.match(/formulář|pole|vstup|editac/)) {
    questions.push('Jaká pole má formulář obsahovat?');
    questions.push('Jsou některá pole povinná?');
  }
  if (d.match(/tlačítko|akce|klik/)) {
    questions.push('Co se má stát po kliknutí?');
    questions.push('Kde přesně má být tlačítko umístěno?');
  }
  if (d.match(/barv|styl|design|vzhled/)) {
    questions.push('Máte konkrétní barvu nebo styl?');
  }
  if (d.match(/graf|statistik|report|přehled/)) {
    questions.push('Jaký typ grafu? (sloupcový, koláčový, čárový…)');
    questions.push('Jaká data se mají zobrazovat?');
  }
  if (d.match(/notifik|upozorn|alert/)) {
    questions.push('Kdy se má upozornění zobrazit?');
    questions.push('Komu má být odesláno?');
  }
  if (d.match(/export|pdf|csv|excel/)) {
    questions.push('V jakém formátu? (PDF, Excel, CSV)');
  }

  // Always add general questions
  if (questions.length === 0) {
    questions.push('Kde přesně to chcete vidět na stránce?');
    questions.push('Jak by to mělo vypadat?');
  }
  questions.push('Ovlivní to nějakou jinou část systému?');
  questions.push('Jak urgentní je tento požadavek?');

  return questions;
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

  // Smart question chips (after first user message)
  if (_aiChatState.step === 1) {
    var qDiv = document.createElement('div');
    qDiv.className = 'ai-msg';
    var questions = getSmartQuestions(_aiChatState.description);
    var chipsHtml = '<div class="ai-msg-label">🤖 AI</div><div class="ai-msg-bot">Díky! Ještě pár otázek pro upřesnění:<div class="ai-q-chips">';
    questions.forEach(function(q) {
      chipsHtml += '<span class="ai-q-chip" onclick="answerAiQuestion(this, \'' + q.replace(/'/g, "\\'") + '\')">' + q + '</span>';
    });
    chipsHtml += '</div><div style="margin-top:10px;font-size:12px;color:#8888aa;">Klikněte na otázku a odpovězte, nebo rovnou odešlete požadavek.</div>';
    chipsHtml += '<div style="margin-top:10px;"><button class="ai-send-btn" style="width:auto;padding:8px 16px;border-radius:8px;font-size:12px;" onclick="submitAiTask()">✅ Odeslat požadavek</button></div></div>';
    qDiv.innerHTML = chipsHtml;
    body.appendChild(qDiv);
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

  if (_aiChatState.step === 0) {
    // First message — this is the main description
    _aiChatState.description = text;
    _aiChatState.messages.push({ role: 'user', text: text });
    _aiChatState.step = 1;
  } else {
    // Additional detail
    _aiChatState.messages.push({ role: 'user', text: text });
    var aKey = 'detail_' + Object.keys(_aiChatState.answers).length;
    _aiChatState.answers[aKey] = text;
  }

  renderAiChat();
}

function answerAiQuestion(chip, question) {
  // Highlight chip and focus input with question context
  var input = document.getElementById('ai-input');
  if (input) {
    input.placeholder = question;
    input.focus();
  }
}

function submitAiTask() {
  var task = {
    page: _aiChatState.pagePath,
    page_title: _aiChatState.pageTitle,
    description: _aiChatState.description,
    ai_questions: getSmartQuestions(_aiChatState.description),
    ai_answers: _aiChatState.answers,
    screenshot: _aiChatState.screenshot,
    priority: 'medium',
  };

  // Collect all user messages as context
  var allMessages = _aiChatState.messages.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.text; });
  task.description = allMessages.join('\n---\n');

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
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initAiButton, 500);
  });
}
