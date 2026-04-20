/* ============================================================================
   top-bar.js — HolyOS horní lišta
   Rezervovaný pruh na horním kraji stránky, kde bydlí:
     • Úkoly   — rychlý modal pro zadání požadavku (admin-tasks)
     • Zprávy  — zkratka do /modules/chat + badge nepřečtených
     • Zvonek  — notifikace (dropdown s posledními + "označit přečtené")
     • AI      — zkratka do /modules/ai-agenti
   Nahrazuje starou sadu floatujících widgetů
   (notifications-bell.js, user-chat-widget.js, ai-chat-panel.js).
   ============================================================================ */
(function () {
  'use strict';
  if (window.__holyosTopBarLoaded) return;
  window.__holyosTopBarLoaded = true;

  // ─── Utils ────────────────────────────────────────────────────────────────
  function getToken() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }
  function fetchOpts(extra) {
    var t = getToken();
    var headers = (extra && extra.headers) ? Object.assign({}, extra.headers) : {};
    if (t) headers['Authorization'] = 'Bearer ' + t;
    if (!headers['Content-Type'] && extra && extra.method && extra.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }
    return Object.assign({ credentials: 'include' }, extra || {}, { headers: headers });
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'teď';
    if (diff < 3600) return Math.floor(diff / 60) + ' min';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h';
    if (diff < 604800) return Math.floor(diff / 86400) + ' d';
    return d.toLocaleDateString('cs-CZ');
  }
  function isLoginPage() {
    return /\/login(\.html)?$/i.test(location.pathname);
  }

  // ─── CSS ──────────────────────────────────────────────────────────────────
  var CSS = [
    '.holyos-topbar {',
    '  position: fixed; top: 0; left: var(--sidebar-w, 250px); right: 0; height: 44px;',
    '  background: var(--bg, #1e1e2e); border-bottom: 1px solid var(--border, #3a3a5c);',
    '  display: flex; align-items: center; justify-content: flex-end;',
    '  padding: 0 16px; gap: 6px; z-index: 900;',
    '}',
    '.holyos-topbar .tb-btn {',
    '  position: relative; width: 34px; height: 34px; border-radius: 8px;',
    '  background: transparent; border: 1px solid transparent; color: var(--text, #e0e0f0);',
    '  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;',
    '  font-size: 16px; transition: background 0.15s, border-color 0.15s;',
    '  text-decoration: none;',
    '}',
    '.holyos-topbar .tb-btn:hover { background: var(--surface2, #313150); border-color: var(--border, #3a3a5c); }',
    '.holyos-topbar .tb-btn.active { background: var(--surface2, #313150); border-color: var(--accent, #6c8cff); }',
    /* Modrý "ufon" (AI chat pro zadání úprav) — malá verze starého .ai-fab */
    '.holyos-topbar .tb-btn.tb-btn-ai {',
    '  background: linear-gradient(135deg, #6c5ce7, #0984e3, #00b894);',
    '  border-color: transparent; box-shadow: 0 2px 10px rgba(108,92,231,0.35);',
    '}',
    '.holyos-topbar .tb-btn.tb-btn-ai:hover { transform: scale(1.05); box-shadow: 0 4px 16px rgba(108,92,231,0.55); border-color: transparent; }',
    '.holyos-topbar .tb-btn.tb-btn-ai svg { display: block; }',
    '.holyos-topbar .tb-badge {',
    '  position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px;',
    '  padding: 0 4px; border-radius: 8px; background: #ef4444; color: #fff;',
    '  font-size: 10px; font-weight: 700; display: none; align-items: center; justify-content: center;',
    '  border: 2px solid var(--bg, #1e1e2e);',
    '}',
    '.holyos-topbar .tb-badge.show { display: inline-flex; }',
    '',
    /* Push main content down */
    'body.holyos-has-topbar .main-wrapper { padding-top: 44px; }',
    'body.holyos-has-topbar .sidebar { padding-top: 0; }',
    '',
    /* Dropdown panel (notifications) */
    '.holyos-tb-panel {',
    '  position: fixed; top: 52px; right: 16px; z-index: 899;',
    '  width: 360px; max-width: calc(100vw - 32px); max-height: 70vh;',
    '  background: var(--surface, #282840); border: 1px solid var(--border, #3a3a5c);',
    '  border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);',
    '  overflow: hidden; display: none; flex-direction: column;',
    '}',
    '.holyos-tb-panel.open { display: flex; }',
    '.holyos-tb-panel header {',
    '  padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;',
    '  border-bottom: 1px solid var(--border, #3a3a5c);',
    '}',
    '.holyos-tb-panel header h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }',
    '.holyos-tb-panel header button { background: none; border: none; color: var(--text2); cursor: pointer; font-size: 12px; }',
    '.holyos-tb-panel header button:hover { color: var(--accent); }',
    '.holyos-tb-list { overflow-y: auto; flex: 1; }',
    '.holyos-tb-item {',
    '  padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);',
    '  cursor: pointer; display: flex; gap: 10px; align-items: flex-start;',
    '}',
    '.holyos-tb-item:hover { background: rgba(108,140,255,0.08); }',
    '.holyos-tb-item.unread { background: rgba(108,140,255,0.05); }',
    '.holyos-tb-item .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-top: 6px; flex-shrink: 0; visibility: hidden; }',
    '.holyos-tb-item.unread .dot { visibility: visible; }',
    '.holyos-tb-item .content { flex: 1; min-width: 0; }',
    '.holyos-tb-item .title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 2px; }',
    '.holyos-tb-item .body { font-size: 12px; color: var(--text2); }',
    '.holyos-tb-item .time { font-size: 10px; color: var(--text2); margin-top: 4px; }',
    '.holyos-tb-empty { padding: 30px 20px; text-align: center; color: var(--text2); font-size: 13px; }',
    '',
    /* Starý floatující FAB ("modrý ufon") skryjeme — stejnou funkci teď plní ikona v liště,
       ale iniciujeme ho kvůli CSS a DOM strukturám, které používá openAiChat(). */
    '.ai-fab { display: none !important; }',
    '',
    /* Mobile */
    '@media (max-width: 768px) {',
    '  .holyos-topbar { left: 0; padding-right: 56px; }',
    '  .holyos-tb-panel { top: 48px; right: 8px; width: calc(100vw - 16px); }',
    '}',
    '@media print { .holyos-topbar, .holyos-tb-panel { display: none !important; } }',
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('holyos-topbar-css')) return;
    var s = document.createElement('style');
    s.id = 'holyos-topbar-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ─── DOM ──────────────────────────────────────────────────────────────────
  function buildBar() {
    var bar = document.createElement('div');
    bar.className = 'holyos-topbar';
    bar.id = 'holyos-topbar';
    // "Modrý ufon" — spustí AI chat panel pro zadání požadavku na úpravu systému.
    // Samotná logika chatu (analyzeRequest, submitAiTask, …) je v sidebar.js jako
    // openAiChat(). Stylizujeme ho stejně jako starý floatující .ai-fab (gradient).
    var aiSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 110 2h-1.07A7 7 0 0113 22h-2a7 7 0 01-6.93-6H3a1 1 0 110-2h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2z"/>'
      + '<circle cx="9" cy="14" r="1.5" fill="#fff"/><circle cx="15" cy="14" r="1.5" fill="#fff"/>'
      + '<path d="M9 18h6"/></svg>';
    bar.innerHTML = [
      '<a class="tb-btn" id="tb-btn-chat" href="/modules/chat/index.html" title="Zprávy">💬<span class="tb-badge" id="tb-badge-chat">0</span></a>',
      '<button class="tb-btn" id="tb-btn-bell" title="Notifikace">🔔<span class="tb-badge" id="tb-badge-bell">0</span></button>',
      '<button class="tb-btn tb-btn-ai" id="tb-btn-ai" title="Zadat požadavek na úpravu systému (AI asistent)">' + aiSvg + '</button>',
    ].join('');
    document.body.appendChild(bar);
    document.body.classList.add('holyos-has-topbar');

    // Notifications panel
    var panel = document.createElement('div');
    panel.className = 'holyos-tb-panel';
    panel.id = 'tb-panel-bell';
    panel.innerHTML = [
      '<header>',
      '  <h3>🔔 Notifikace</h3>',
      '  <button id="tb-bell-readall">Označit vše přečtené</button>',
      '</header>',
      '<div class="holyos-tb-list" id="tb-bell-list">',
      '  <div class="holyos-tb-empty">Načítám…</div>',
      '</div>',
    ].join('');
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(panel);

    // Bind listeners
    document.getElementById('tb-btn-bell').addEventListener('click', function (e) {
      e.stopPropagation(); toggleBellPanel();
    });
    document.getElementById('tb-bell-readall').addEventListener('click', markAllRead);
    document.getElementById('tb-btn-ai').addEventListener('click', function (e) {
      e.stopPropagation();
      openAiChatFromSidebar();
    });

    document.addEventListener('click', function () { closeBellPanel(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeBellPanel();
    });
  }

  // ─── Notifications (bell) ────────────────────────────────────────────────
  var notifItems = [];
  var notifUnread = 0;
  var bellOpen = false;

  function renderBell() {
    var badge = document.getElementById('tb-badge-bell');
    if (badge) {
      badge.textContent = notifUnread > 99 ? '99+' : String(notifUnread);
      badge.classList.toggle('show', notifUnread > 0);
    }
    var list = document.getElementById('tb-bell-list');
    if (!list) return;
    if (!notifItems.length) {
      list.innerHTML = '<div class="holyos-tb-empty">Žádné notifikace 🎉</div>';
      return;
    }
    list.innerHTML = notifItems.map(function (n) {
      return [
        '<div class="holyos-tb-item ' + (n.read_at ? '' : 'unread') + '" data-id="' + escapeHtml(n.id) + '" data-link="' + escapeHtml(n.link || '') + '">',
        '  <div class="dot"></div>',
        '  <div class="content">',
        '    <div class="title">' + escapeHtml(n.title || '(bez názvu)') + '</div>',
        (n.body ? '    <div class="body">' + escapeHtml(n.body) + '</div>' : ''),
        '    <div class="time">' + formatTime(n.created_at) + '</div>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.holyos-tb-item'), function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.id;
        var link = el.dataset.link;
        markRead(id);
        if (link) window.location.href = link;
      });
    });
  }

  function loadNotifications() {
    Promise.all([
      fetch('/api/notifications?limit=30', fetchOpts()).then(function (r) { return r.ok ? r.json() : []; }),
      fetch('/api/notifications/unread-count', fetchOpts()).then(function (r) { return r.ok ? r.json() : { count: 0 }; }),
    ]).then(function (results) {
      notifItems = results[0] || [];
      notifUnread = (results[1] && results[1].count) || 0;
      renderBell();
    }).catch(function (e) { console.warn('[TopBar] notif load failed', e); });
  }

  function markRead(id) {
    fetch('/api/notifications/' + encodeURIComponent(id) + '/read', fetchOpts({ method: 'POST' }))
      .catch(function () {});
    var item = notifItems.find(function (x) { return x.id === id; });
    if (item && !item.read_at) {
      item.read_at = new Date().toISOString();
      notifUnread = Math.max(0, notifUnread - 1);
    }
    renderBell();
  }

  function markAllRead() {
    fetch('/api/notifications/read-all', fetchOpts({ method: 'POST' }))
      .catch(function () {});
    notifItems.forEach(function (n) { if (!n.read_at) n.read_at = new Date().toISOString(); });
    notifUnread = 0;
    renderBell();
  }

  function toggleBellPanel() {
    var panel = document.getElementById('tb-panel-bell');
    if (!panel) return;
    bellOpen = !bellOpen;
    panel.classList.toggle('open', bellOpen);
    if (bellOpen) loadNotifications();
  }
  function closeBellPanel() {
    if (!bellOpen) return;
    bellOpen = false;
    var panel = document.getElementById('tb-panel-bell');
    if (panel) panel.classList.remove('open');
  }

  // ─── Chat unread badge ───────────────────────────────────────────────────
  function loadChatUnread() {
    fetch('/api/messages/channels', fetchOpts())
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (channels) {
        var total = 0;
        (channels || []).forEach(function (c) { total += (c.unread || 0); });
        var badge = document.getElementById('tb-badge-chat');
        if (badge) {
          badge.textContent = total > 99 ? '99+' : String(total);
          badge.classList.toggle('show', total > 0);
        }
      })
      .catch(function () {});
  }

  // ─── AI chat (spouští ho modrý ufon) ─────────────────────────────────────
  // Interaktivní chat panel definovaný v sidebar.js: openAiChat(), analyzeRequest(),
  // submitAiTask(). CSS a původní floatující FAB se tam injektují skrz initAiButton().
  // Tady jen zaručíme, že initAiButton byl volaný (aby byly k dispozici styly
  // .ai-chat, .ai-msg, …) a hned potom otevřeme chat.
  function ensureAiChatInitialized() {
    if (window.__holyosAiChatInited) return true;
    if (typeof window.initAiButton === 'function') {
      try { window.initAiButton(); window.__holyosAiChatInited = true; return true; }
      catch (e) { console.warn('[TopBar] initAiButton selhal:', e); return false; }
    }
    return false;
  }
  function openAiChatFromSidebar() {
    if (!ensureAiChatInitialized()) {
      console.warn('[TopBar] AI chat není k dispozici — sidebar.js se ještě nenačetl.');
      return;
    }
    if (typeof window.openAiChat === 'function') {
      window.openAiChat();
    } else {
      console.warn('[TopBar] window.openAiChat() chybí.');
    }
  }

  // ─── Live updates (SSE via HolyOSEvents, pokud existuje) ─────────────────
  function hookLiveEvents() {
    if (!window.HolyOSEvents || typeof window.HolyOSEvents.on !== 'function') return;
    window.HolyOSEvents.on('notification', function (n) {
      if (!n) return;
      if (!notifItems.some(function (x) { return x.id === n.id; })) {
        notifItems.unshift(n);
        if (notifItems.length > 50) notifItems.length = 50;
      }
      if (!n.read_at) notifUnread++;
      renderBell();
    });
    window.HolyOSEvents.on('message', function () { loadChatUnread(); });
  }

  // ─── Init ────────────────────────────────────────────────────────────────
  function init() {
    if (isLoginPage()) return;       // nebuduj na /public/login.html
    if (document.getElementById('holyos-topbar')) return;
    injectCSS();
    buildBar();
    loadNotifications();
    loadChatUnread();
    hookLiveEvents();
    // Re-refresh periodically (fallback, pokud SSE vypadne)
    setInterval(loadNotifications, 60000);
    setInterval(loadChatUnread, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
