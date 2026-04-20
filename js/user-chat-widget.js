/* ============================================
   user-chat-widget.js — Plovoucí messenger widget
   vpravo dole. Seznam konverzací + aktivní vlákno.
   Pro user↔user, skupiny, task thready i AI.
   ============================================ */

(function() {
  'use strict';
  if (window.__userChatLoaded) return;
  window.__userChatLoaded = true;

  const CSS = `
    .uchat-bubble {
      position: fixed; top: 22px; right: 124px; z-index: 9001;
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, #6c5ce7, #3b82f6);
      color: #fff; border: none; cursor: pointer;
      font-size: 18px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(108,92,231,0.35); transition: transform 0.2s;
    }
    .uchat-bubble:hover { transform: scale(1.08); }
    .uchat-bubble .dot {
      position: absolute; top: -2px; right: -2px;
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
      background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
      border: 2px solid var(--bg, #0f0f1a);
    }
    .uchat-bubble .dot.show { display: flex; }

    .uchat-panel {
      position: fixed; top: 72px; right: 16px; z-index: 9000;
      width: 720px; max-width: calc(100vw - 24px); height: 560px; max-height: calc(100vh - 100px);
      background: var(--bg, #12121c); border: 1px solid var(--border, rgba(255,255,255,0.1));
      border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.45);
      display: none; overflow: hidden;
    }
    .uchat-panel.open { display: grid; grid-template-columns: 240px 1fr; }
    /* Drag & drop stav — fialový obrys přes celý panel */
    .uchat-panel.dragging { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(168,139,250,0.35), 0 12px 40px rgba(0,0,0,0.45); }
    .uchat-drop-hint {
      position: absolute; inset: 0; pointer-events: none; z-index: 10;
      display: none; align-items: center; justify-content: center;
      background: rgba(108,92,231,0.2); border: 2px dashed #a78bfa; border-radius: 14px;
      color: #a78bfa; font-weight: 600; font-size: 15px;
    }
    .uchat-panel.dragging .uchat-drop-hint { display: flex; }

    .uchat-sidebar { border-right: 1px solid var(--border, rgba(255,255,255,0.08)); display: flex; flex-direction: column; min-width: 0; }
    .uchat-sidebar header { padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); }
    .uchat-sidebar h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text, #fff); }
    .uchat-sidebar .new-btn { background: rgba(108,92,231,0.2); color: #a78bfa; border: none; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; }
    .uchat-sidebar .new-btn:hover { background: rgba(108,92,231,0.3); }

    .uchat-channels { overflow-y: auto; flex: 1; }
    /* Avatar — kolečko s fotkou nebo iniciálami */
    .uchat-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; background-size: cover; background-position: center; overflow: hidden; }
    .uchat-avatar.sm { width: 24px; height: 24px; font-size: 9px; }
    .uchat-avatar.lg { width: 40px; height: 40px; font-size: 13px; }
    /* Wrapper s online tečkou */
    .uchat-avatar-wrap { position: relative; flex-shrink: 0; line-height: 0; }
    .uchat-avatar-wrap .online-dot {
      position: absolute; right: -1px; bottom: -1px;
      width: 10px; height: 10px; border-radius: 50%;
      background: #10b981; border: 2px solid var(--bg, #12121c);
      display: none;
    }
    .uchat-avatar-wrap.sm .online-dot { width: 8px; height: 8px; border-width: 1.5px; }
    .uchat-avatar-wrap.lg .online-dot { width: 12px; height: 12px; }
    .uchat-avatar-wrap.online .online-dot { display: block; }

    /* Read receipts — fajfky */
    .uchat-msg .ticks { display: inline-block; margin-left: 4px; font-size: 11px; letter-spacing: -2px; opacity: 0.9; }
    .uchat-msg .ticks.read { color: #5eead4; }     /* ✓✓ tyrkysová */
    .uchat-msg .ticks.sent { color: rgba(255,255,255,0.75); }
    .uchat-msg.other .ticks { display: none; }
    .uchat-msg.ai .ticks, .uchat-msg.system .ticks { display: none; }

    /* Header presence text */
    .uchat-main .presence { font-size: 10px; font-weight: 500; margin-left: 2px; }
    .uchat-main .presence.online { color: #10b981; }
    .uchat-main .presence.offline { color: var(--text2, #a3a3b2); }

    .uchat-channel { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s; display: flex; gap: 10px; align-items: center; }
    .uchat-channel:hover { background: rgba(108,92,231,0.06); }
    .uchat-channel.active { background: rgba(108,92,231,0.15); }
    .uchat-channel .body { flex: 1; min-width: 0; }
    .uchat-channel .name { font-size: 12px; font-weight: 600; color: var(--text, #fff); display: flex; justify-content: space-between; align-items: center; gap: 6px; }
    .uchat-channel .name .unread { background: #ef4444; color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 700; }
    .uchat-channel .preview { font-size: 11px; color: var(--text2, #a3a3b2); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .uchat-empty-list { padding: 30px 14px; text-align: center; color: var(--text2, #a3a3b2); font-size: 12px; }
    .uchat-loader { padding: 40px 14px; text-align: center; color: var(--text2, #a3a3b2); font-size: 12px; }
    .uchat-loader::before { content: ''; display: inline-block; width: 20px; height: 20px; border: 2px solid rgba(108,92,231,0.3); border-top-color: #a78bfa; border-radius: 50%; animation: uchat-spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
    @keyframes uchat-spin { to { transform: rotate(360deg); } }

    .uchat-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
    .uchat-main header { padding: 10px 14px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .uchat-main h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .uchat-main .close-btn { background: none; border: none; color: var(--text2, #a3a3b2); cursor: pointer; font-size: 18px; padding: 2px 6px; border-radius: 4px; }
    .uchat-main .close-btn:hover { background: rgba(255,255,255,0.08); color: var(--text, #fff); }

    .uchat-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
    .uchat-msg { max-width: 75%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.4; word-wrap: break-word; }
    .uchat-msg.mine { align-self: flex-end; background: linear-gradient(135deg, #6c5ce7, #3b82f6); color: #fff; border-bottom-right-radius: 4px; }
    .uchat-msg.other { align-self: flex-start; background: var(--surface, #1e1e2f); color: var(--text, #fff); border-bottom-left-radius: 4px; }
    .uchat-msg.ai { align-self: flex-start; background: rgba(168,139,250,0.1); border: 1px solid rgba(168,139,250,0.3); color: var(--text, #fff); }
    .uchat-msg.system { align-self: center; background: rgba(255,255,255,0.05); color: var(--text2, #a3a3b2); font-size: 11px; font-style: italic; padding: 4px 10px; }
    .uchat-msg.pending { opacity: 0.6; }
    .uchat-msg.failed { opacity: 0.7; border: 1px dashed #ef4444; }
    .uchat-msg .author { font-size: 10px; font-weight: 600; margin-bottom: 2px; opacity: 0.85; }
    .uchat-msg .ts { font-size: 9px; margin-top: 3px; opacity: 0.55; }

    .uchat-compose { padding: 10px 12px; border-top: 1px solid var(--border, rgba(255,255,255,0.08)); display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; }
    .uchat-compose textarea { flex: 1; min-height: 36px; max-height: 120px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border, rgba(255,255,255,0.1)); background: var(--surface, #1e1e2f); color: var(--text, #fff); font-size: 13px; resize: none; font-family: inherit; }
    .uchat-compose textarea:focus { outline: 1px solid #6c5ce7; }
    .uchat-compose .send-btn { background: linear-gradient(135deg, #6c5ce7, #3b82f6); color: #fff; border: none; padding: 0 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; height: 38px; }
    .uchat-compose .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .uchat-compose .attach-btn, .uchat-compose .emoji-btn { background: transparent; color: var(--text2, #a3a3b2); border: 1px solid var(--border, rgba(255,255,255,0.1)); padding: 0 10px; border-radius: 8px; cursor: pointer; font-size: 15px; height: 38px; transition: background 0.15s, color 0.15s; }
    .uchat-compose .attach-btn:hover, .uchat-compose .emoji-btn:hover { background: rgba(108,92,231,0.1); color: #a78bfa; border-color: #6c5ce7; }
    .uchat-compose .emoji-btn.active { background: rgba(108,92,231,0.15); color: #a78bfa; border-color: #6c5ce7; }

    /* Emoji picker popover — vystřelí nad composer */
    .uchat-emoji-popover {
      position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
      width: 340px; max-width: calc(100% - 20px); max-height: 320px;
      background: var(--bg, #12121c); border: 1px solid var(--border, rgba(255,255,255,0.12));
      border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      z-index: 20; display: flex; flex-direction: column; overflow: hidden;
    }
    .uchat-emoji-tabs { display: flex; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); flex-shrink: 0; }
    .uchat-emoji-tab { flex: 1; padding: 8px 4px; background: transparent; border: none; cursor: pointer; font-size: 16px; color: var(--text2, #a3a3b2); border-bottom: 2px solid transparent; }
    .uchat-emoji-tab:hover { color: var(--text, #fff); background: rgba(108,92,231,0.05); }
    .uchat-emoji-tab.active { color: #a78bfa; border-bottom-color: #a78bfa; }
    .uchat-emoji-grid { flex: 1; overflow-y: auto; padding: 8px; display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
    .uchat-emoji-btn { background: transparent; border: none; cursor: pointer; font-size: 20px; padding: 4px; border-radius: 4px; line-height: 1; transition: background 0.1s; }
    .uchat-emoji-btn:hover { background: rgba(108,92,231,0.15); }

    /* Pending přílohy (preview před odesláním) */
    .uchat-pending { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 0; flex-shrink: 0; }
    .uchat-pending:empty { display: none; }
    .uchat-pending .p-item { position: relative; background: var(--surface, #1e1e2f); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 6px; padding: 4px 26px 4px 8px; font-size: 11px; color: var(--text, #fff); display: flex; align-items: center; gap: 6px; max-width: 180px; }
    .uchat-pending .p-item.image { padding: 0 20px 0 0; border: 1px solid rgba(108,92,231,0.35); }
    .uchat-pending .p-item.image img { width: 56px; height: 56px; object-fit: cover; border-radius: 5px 0 0 5px; display: block; }
    .uchat-pending .p-item .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .uchat-pending .p-item .x { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0,0,0,0.5); color: #fff; border: none; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .uchat-pending .p-item .x:hover { background: #ef4444; }
    .uchat-pending .p-item.uploading { opacity: 0.6; }
    .uchat-pending .p-item.uploading::after { content: '⏳'; margin-left: 4px; }

    /* Přílohy ve zprávách */
    .uchat-msg .atts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .uchat-msg .atts .att-img { display: block; max-width: 220px; max-height: 220px; border-radius: 8px; cursor: zoom-in; background: rgba(0,0,0,0.2); }
    .uchat-msg .atts .att-file { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; background: rgba(255,255,255,0.08); border-radius: 8px; color: inherit; text-decoration: none; font-size: 12px; border: 1px solid rgba(255,255,255,0.12); }
    .uchat-msg .atts .att-file:hover { background: rgba(255,255,255,0.15); }

    .uchat-empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 30px; color: var(--text2, #a3a3b2); }
    .uchat-empty-state .icon { font-size: 48px; margin-bottom: 10px; }

    /* Modální dialog pro založení konverzace — musí být nad chat panelem (9000) i zvonkem (9001) */
    .uchat-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(2px); z-index: 10000; display: flex; align-items: center; justify-content: center; }
    .uchat-modal .box { background: var(--bg, #12121c); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; padding: 20px; width: 90%; max-width: 460px; }
    .uchat-modal h3 { margin: 0 0 12px; font-size: 15px; color: var(--text, #fff); }
    .uchat-modal .tabs { display: flex; gap: 6px; margin-bottom: 12px; }
    .uchat-modal .tabs button { flex: 1; padding: 7px; background: var(--surface, #1e1e2f); color: var(--text2, #a3a3b2); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 6px; cursor: pointer; font-size: 12px; }
    .uchat-modal .tabs button.active { background: rgba(108,92,231,0.2); color: #a78bfa; border-color: #6c5ce7; }
    .uchat-modal input, .uchat-modal .user-picker { width: 100%; padding: 8px 10px; background: var(--surface, #1e1e2f); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 6px; color: var(--text, #fff); font-size: 13px; margin-bottom: 10px; }
    .uchat-modal .user-picker { max-height: 180px; overflow-y: auto; padding: 0; }
    .uchat-modal .user-picker .user { padding: 7px 10px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px; display: flex; justify-content: space-between; }
    .uchat-modal .user-picker .user:hover { background: rgba(108,92,231,0.08); }
    .uchat-modal .user-picker .user.selected { background: rgba(108,92,231,0.2); color: #a78bfa; }
    .uchat-modal .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
    .uchat-modal .actions button { padding: 7px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; border: 1px solid var(--border, rgba(255,255,255,0.1)); }
    .uchat-modal .actions .primary { background: #6c5ce7; color: #fff; border-color: #6c5ce7; }
    .uchat-modal .actions .secondary { background: var(--surface, #1e1e2f); color: var(--text, #fff); }

    @media (max-width: 768px) {
      .uchat-bubble { top: 14px; right: 102px; width: 34px; height: 34px; font-size: 15px; }
      .uchat-bubble .dot { min-width: 16px; height: 16px; font-size: 9px; }
      .uchat-panel { top: 54px; right: 8px; left: 8px; width: auto; max-width: none; height: calc(100vh - 70px); grid-template-columns: 1fr; }
      .uchat-panel.open .uchat-sidebar { display: none; }
      .uchat-panel.open.show-list .uchat-sidebar { display: flex; }
      .uchat-panel.open.show-list .uchat-main { display: none; }
    }
    @media print {
      .uchat-bubble, .uchat-panel { display: none !important; }
    }
  `;

  let channels = [];
  let channelsLoaded = false;
  let channelsLoading = false;
  let activeChannelId = null;
  let activeChannel = null;
  let messages = [];
  let messagesLoading = false;
  let users = [];
  let totalUnread = 0;
  let panelOpen = false;

  // localStorage cache klí\u010d
  const CACHE_KEY = 'holyos_chat_channels_v1';
  function loadCachedChannels() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return null;
      return data;
    } catch (_) { return null; }
  }
  function saveCachedChannels(list) {
    try {
      // Ulo\u017e jen pot\u0159ebn\u00e9 fieldy, z\u016fstane to mal\u00e9 a r\u00fdchl\u00e9
      const slim = list.map(c => ({
        id: c.id, type: c.type, name: c.name, topic: c.topic,
        admin_task_id: c.admin_task_id, last_message_at: c.last_message_at,
        members: c.members, last_message: c.last_message, unread: 0, // reset unread v cachi (real s\u0159etez ze SSE)
      }));
      localStorage.setItem(CACHE_KEY, JSON.stringify(slim));
    } catch (_) { /* storage full, ignore */ }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function getToken() { return sessionStorage.getItem('token') || localStorage.getItem('token') || ''; }
  function authHeaders(extra = {}) {
    const t = getToken();
    const h = { ...extra };
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }
  // Moje user ID — plníme asynchronně přes /api/auth/me (funguje i s HttpOnly cookie).
  // Jako fallback parsujeme JWT ze storage. Volá se před každou iterací
  // loadChannels(), takže ke prvnímu renderu je cache vždy plná.
  let _myId = null;

  function meIdFromJwt() {
    try {
      const tok = getToken();
      if (!tok) return null;
      const parts = tok.split('.');
      if (parts.length < 2) return null;
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const json = decodeURIComponent(Array.prototype.map.call(atob(b64),
        function(c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }
      ).join(''));
      return JSON.parse(json).id || null;
    } catch (_) { return null; }
  }

  const MY_ID_KEY = 'holyos_my_id_v1';

  // Synchronn\u00ed read z cache \u2014 vola se p\u0159ed prvn\u00edm renderem cache
  function primeMyIdFromCache() {
    if (_myId) return _myId;
    if (window.__holyosMyId) { _myId = window.__holyosMyId; return _myId; }
    const jwtId = meIdFromJwt();
    if (jwtId) { _myId = jwtId; window.__holyosMyId = jwtId; return _myId; }
    try {
      const stored = parseInt(localStorage.getItem(MY_ID_KEY));
      if (stored && !isNaN(stored)) { _myId = stored; window.__holyosMyId = stored; return _myId; }
    } catch (_) {}
    return null;
  }

  async function ensureMyId() {
    if (_myId) return _myId;
    primeMyIdFromCache();
    if (_myId) return _myId;
    // In-flight promise dedupe — pokud někdo jiný už fetchuje, počkáme na stejný promise
    if (!window.__holyosMyIdPromise) {
      window.__holyosMyIdPromise = fetch('/api/auth/me', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => { const u = data?.user || data; return u?.id || null; })
        .catch(() => null);
    }
    _myId = await window.__holyosMyIdPromise;
    if (_myId) {
      window.__holyosMyId = _myId;
      try { localStorage.setItem(MY_ID_KEY, String(_myId)); } catch (_) {}
    }
    return _myId;
  }

  function meId() { return _myId; }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function channelDisplayName(c) {
    if (c.type === 'direct') {
      const other = (c.members || []).find(m => m.user_id !== meId());
      return other?.user?.display_name || other?.user?.username || 'Konverzace';
    }
    return c.name || '(bez názvu)';
  }

  function channelIcon(c) {
    if (c.type === 'direct') return '💬';
    if (c.type === 'group') return '👥';
    if (c.type === 'task') return '📋';
    if (c.type === 'system') return '⚙️';
    return '💬';
  }

  // Barva pozadí pro iniciály — deterministicky z jména
  function avatarColor(seed) {
    const colors = ['#6c5ce7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6'];
    let h = 0;
    for (let i = 0; i < String(seed || '').length; i++) h = (h * 31 + String(seed).charCodeAt(i)) & 0xffff;
    return colors[h % colors.length];
  }

  function initials(user) {
    if (!user) return '?';
    const p = user.person;
    if (p && (p.first_name || p.last_name)) {
      return ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || '?';
    }
    const name = user.display_name || user.username || '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  // HTML pro avatar - pokud má photo_url, zobrazí ho; jinak iniciály s barvou
  function avatarHtml(user, size) {
    if (!user) return `<span class="uchat-avatar ${size || ''}" style="background:#444">?</span>`;
    const cls = `uchat-avatar ${size || ''}`;
    const photo = user.person?.photo_url;
    const seed = user.username || user.display_name || 'x';
    const color = avatarColor(seed);
    const online = user.id && isUserOnline(user.id);
    const wrapCls = `uchat-avatar-wrap ${size || ''}${online ? ' online' : ''}`;
    const inner = photo
      ? `<span class="${cls}" style="background-image:url('${String(photo).replace(/'/g, "\\'")}');background-color:${color};"></span>`
      : `<span class="${cls}" style="background:${color};">${escapeHtml(initials(user))}</span>`;
    return `<span class="${wrapCls}" data-user-id="${user.id || ''}">${inner}<span class="online-dot"></span></span>`;
  }

  // Pro direct kanál vrátí "toho druhého" user objektu
  function channelOtherUser(c) {
    if (!c) return null;
    if (c.type === 'direct') {
      const other = (c.members || []).find(m => m.user_id !== meId());
      return other?.user || null;
    }
    return null;
  }

  // ─── API ──────────────────────────────────────────────────────────────────

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: authHeaders(opts.headers || {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('HTTP ' + res.status));
    }
    return res.json();
  }

  // ─── Přílohy ─────────────────────────────────────────────────────────────
  // Pending = ještě neodeslané soubory přichystané v composeru. Každý má
  // lokální ID pro UI, status (uploading/ready/failed) a po uploadu metadata.
  let pendingAttachments = [];   // [{ localId, name, size, mime, kind, previewUrl, url, status }]
  const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15 MB

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadPendingFile(item, file) {
    try {
      const b64 = await fileToBase64(file);
      const res = await api('/api/storage/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_data: b64,
          file_name: file.name || ('paste-' + Date.now()),
          file_type: file.type || null,
          folder: 'chat',
        }),
      });
      item.url = res.url;
      item.status = 'ready';
    } catch (e) {
      console.warn('[UChat] upload failed', e);
      item.status = 'failed';
      item._error = e.message;
    }
    renderPendingAttachments();
  }

  function addFilesToCompose(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    files.forEach(f => {
      if (f.size > MAX_ATTACHMENT_SIZE) {
        alert('Soubor "' + f.name + '" je příliš velký (max 15 MB).');
        return;
      }
      const isImg = (f.type || '').startsWith('image/');
      const item = {
        localId: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: f.name || (isImg ? 'obrázek.png' : 'soubor'),
        size: f.size,
        mime: f.type || '',
        kind: isImg ? 'image' : 'file',
        previewUrl: isImg ? URL.createObjectURL(f) : null,
        status: 'uploading',
      };
      pendingAttachments.push(item);
      uploadPendingFile(item, f);
    });
    renderPendingAttachments();
  }

  function removePendingAttachment(localId) {
    const idx = pendingAttachments.findIndex(x => x.localId === localId);
    if (idx < 0) return;
    const it = pendingAttachments[idx];
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    pendingAttachments.splice(idx, 1);
    renderPendingAttachments();
  }

  function renderPendingAttachments() {
    const box = document.querySelector('.uchat-pending');
    if (!box) return;
    if (!pendingAttachments.length) { box.innerHTML = ''; return; }
    box.innerHTML = pendingAttachments.map(a => {
      const cls = 'p-item ' + a.kind + (a.status === 'uploading' ? ' uploading' : '') + (a.status === 'failed' ? ' failed' : '');
      if (a.kind === 'image') {
        return `
          <div class="${cls}" data-id="${escapeHtml(a.localId)}">
            <img src="${escapeHtml(a.previewUrl || a.url || '')}" alt="">
            <button class="x" title="Odebrat">✕</button>
          </div>`;
      }
      return `
        <div class="${cls}" data-id="${escapeHtml(a.localId)}" title="${escapeHtml(a.name)}">
          📎 <span class="name">${escapeHtml(a.name)}</span>
          <button class="x" title="Odebrat">✕</button>
        </div>`;
    }).join('');
    box.querySelectorAll('.p-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.x')?.addEventListener('click', (e) => {
        e.stopPropagation();
        removePendingAttachment(id);
      });
    });
  }

  // ─── Presence (kdo je online) ─────────────────────────────────────────────
  const onlineUsers = new Set();   // Set<userId>
  let presenceLoaded = false;

  function isUserOnline(userId) {
    if (!userId) return false;
    return onlineUsers.has(Number(userId));
  }

  async function loadPresence() {
    try {
      const data = await api('/api/notifications/presence');
      onlineUsers.clear();
      (data?.online || []).forEach(id => onlineUsers.add(Number(id)));
      presenceLoaded = true;
      refreshPresenceInDom();
    } catch (e) {
      console.warn('[UChat] presence load', e);
    }
  }

  // Tiché update: nemusíme všechno re-renderovat, stačí toggle třídy
  // .uchat-avatar-wrap.online podle atributu data-user-id
  function refreshPresenceInDom() {
    document.querySelectorAll('.uchat-avatar-wrap[data-user-id]').forEach(el => {
      const uid = Number(el.getAttribute('data-user-id'));
      if (!uid) return;
      el.classList.toggle('online', onlineUsers.has(uid));
    });
    updateHeaderPresence();
  }

  function updateHeaderPresence() {
    const header = document.querySelector('.uchat-main header .presence');
    if (!header) return;
    const other = channelOtherUser(activeChannel);
    if (!other || !activeChannel || activeChannel.type !== 'direct') {
      header.textContent = '';
      header.className = 'presence';
      return;
    }
    const isOn = isUserOnline(other.id);
    header.textContent = isOn ? 'online' : 'offline';
    header.className = 'presence ' + (isOn ? 'online' : 'offline');
  }

  async function loadChannelsSafe() {
    try { await loadChannels(); } catch (_) { /* not logged in or server down */ }
  }

  async function loadChannels() {
    channelsLoading = true;
    renderSidebar();
    try {
      await ensureMyId();
      channels = await api('/api/messages/channels');
      channelsLoaded = true;
      channelsLoading = false;
      totalUnread = channels.reduce((s, c) => s + (c.unread || 0), 0);
      saveCachedChannels(channels);
      renderSidebar();
      renderBadge();
    } catch (e) {
      channelsLoading = false;
      console.warn('[UChat] channels', e);
      renderSidebar();
    }
  }

  async function loadMessages(channelId) {
    messagesLoading = true;
    renderMessages();
    try {
      const list = await api('/api/messages/channels/' + channelId + '/messages?limit=80');
      // Pokud u\u017eivatel mezitim p\u0159epnul na jin\u00fd kan\u00e1l, nep\u0159episuj
      if (activeChannelId !== channelId) return;
      messages = list;
      messagesLoading = false;
      renderMessages();
      // Po otevření = přečteno
      api('/api/messages/channels/' + channelId + '/read', { method: 'POST' }).catch(() => {});
      // Optimisticky zresetuj unread v seznamu
      const ch = channels.find(c => c.id === channelId);
      if (ch) { totalUnread = Math.max(0, totalUnread - (ch.unread || 0)); ch.unread = 0; }
      renderSidebar();
      renderBadge();
    } catch (e) {
      messagesLoading = false;
      console.warn('[UChat] messages', e);
      renderMessages();
    }
  }

  async function sendMessage(text, useAi = false, atts = []) {
    if (!activeChannelId) return;
    if (!text.trim() && (!atts || atts.length === 0)) return;
    // Optimistic UI — uka\u017e zpr\u00e1vu hned, bez \u010dek\u00e1n\u00ed na server
    const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const myIdVal = meId();
    const optimistic = {
      id: tempId,
      channel_id: activeChannelId,
      sender_id: myIdVal,
      sender_type: 'user',
      content: text,
      attachments: atts.length ? atts.map(a => ({ kind: a.kind, url: a.url, name: a.name, size: a.size, mime: a.mime })) : null,
      created_at: new Date().toISOString(),
      sender: { id: myIdVal, display_name: 'Vy', username: 'me' },
      _pending: true,
    };
    messages.push(optimistic);
    renderMessages();

    try {
      const real = await api('/api/messages/channels/' + activeChannelId + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          ai: useAi,
          attachments: atts.length ? atts.map(a => ({ kind: a.kind, url: a.url, name: a.name, size: a.size, mime: a.mime })) : undefined,
        }),
      });
      // Nahra\u010f optimistickou zpr\u00e1vu skute\u010dnou (nebo ji odstran\u00ed, pokud SSE u\u017e dorazil)
      const idx = messages.findIndex(m => m.id === tempId);
      if (idx >= 0) {
        // Je-li u\u017e re\u00e1ln\u00e1 v seznamu p\u0159es SSE, jen sma\u017e optimistickou
        const exists = messages.some(m => m.id === real.id);
        if (exists) messages.splice(idx, 1);
        else messages[idx] = real;
        renderMessages();
      }
    } catch (e) {
      // Ozna\u010d jako failed
      const idx = messages.findIndex(m => m.id === tempId);
      if (idx >= 0) { messages[idx]._failed = true; messages[idx]._pending = false; renderMessages(); }
      alert('Chyba: ' + e.message);
    }
  }

  // ─── Emoji picker ─────────────────────────────────────────────────────────
  // Malá kurátorská sada běžných emoji rozdělená do 6 kategorií. Žádná externí
  // knihovna — jen unicode znaky. Vybírá se podle poslední použité kategorie
  // (stored v localStorage) + posledně použité emoji (quick access — TODO).
  const EMOJI_CATEGORIES = [
    {
      key: 'smileys', icon: '😀', title: 'Smajlíci',
      items: [
        '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
        '😘','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶',
        '😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧',
        '🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯',
        '😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩',
        '😫','🥱','😤','😡','😠','🤬','💀','👻','👽','🤖','🎃',
      ],
    },
    {
      key: 'gestures', icon: '👋', title: 'Gesta',
      items: [
        '👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋',
        '🤚','🖐️','🖖','👋','🤝','🙏','✍️','💪','🦾','🦵','🦶','👂','👃','🧠','👀','👁️',
        '👄','👶','🧒','👦','👧','🧑','👨','👩','🧓','👴','👵','🙋','💁','🙅','🙆','🤷',
        '🙎','🙍','💇','💆','🧏','🚶','🏃','💃','🕺','🧎','🧍','👏','🙌','🤲',
      ],
    },
    {
      key: 'hearts', icon: '❤️', title: 'Srdce',
      items: [
        '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
        '💘','💝','💟','♥️','💌','💋','💑','💏','👪','🥂','🎀','🌹','🌷','🌸','🌺','🌻',
      ],
    },
    {
      key: 'objects', icon: '💼', title: 'Objekty',
      items: [
        '📁','📂','📃','📄','📋','📊','📈','📉','📝','✏️','📌','📍','📎','🖇️','📏','📐',
        '🖊️','🖋️','✒️','📑','🔖','🏷️','💼','💻','⌨️','🖥️','🖨️','🖱️','💾','📀','💿','📱',
        '☎️','📞','📠','📺','📻','🎙️','🎚️','🎛️','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋',
        '🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','💰','💳','🧾','💎',
        '⚖️','🪜','🧰','🔧','🔨','⚒️','🛠️','⛏️','🪓','🪚','🔩','⚙️','🧱','⛓️','🧲','🔫',
        '💣','🧨','🪃','🏹','🛡️','🪝','🔪','🗡️','⚔️','🪛','🔗','📦','📫','📬','📭','📮',
      ],
    },
    {
      key: 'food', icon: '🍕', title: 'Jídlo',
      items: [
        '🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝',
        '🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🫘',
        '🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴',
        '🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🫕','🥫','🍝','🍜','🍲',
        '🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦',
        '🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧃','🥤','🧋',
        '🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾','🧊',
      ],
    },
    {
      key: 'symbols', icon: '✨', title: 'Symboly',
      items: [
        '✅','❌','❓','❗','‼️','⭐','🌟','⚠️','🚫','💯','🔥','✨','⚡','💥','🎉','🎊',
        '📢','🔔','🔕','⏰','⏳','⌛','🕐','✔️','✖️','➕','➖','➗','💠','🔱','⚜️','〰️',
        '💭','💬','🗯️','💡','📖','🏆','🥇','🥈','🥉','🏅','🎖️','🎯','🎲','🧩','🎵','🎶',
        '♻️','⚛️','🅱️','🆎','🆑','🆒','🆓','🆕','🆖','🆗','🆙','🆚','🔰','⚠️','🚸','⛔',
        '🚷','🚯','🚳','🚱','🔞','📵','🚭','❇️','✳️','❎','🌀','Ⓜ️','🔸','🔹','🔶','🔷',
        '🔺','🔻','💠','🔘','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','⬛','⬜','🟥','🟧',
        '🟨','🟩','🟦','🟪','🟫','⚫','⚪','🔴','🟠','🟡','🟢','🔵','🟣','🟤',
      ],
    },
  ];

  const EMOJI_LAST_CATEGORY_KEY = 'holyos_chat_emoji_category';

  function getLastEmojiCategory() {
    try {
      const k = localStorage.getItem(EMOJI_LAST_CATEGORY_KEY);
      if (k && EMOJI_CATEGORIES.some(c => c.key === k)) return k;
    } catch (_) {}
    return 'smileys';
  }

  function setLastEmojiCategory(k) {
    try { localStorage.setItem(EMOJI_LAST_CATEGORY_KEY, k); } catch (_) {}
  }

  function buildEmojiPopover(onPick) {
    const pop = document.createElement('div');
    pop.className = 'uchat-emoji-popover';
    const activeKey = getLastEmojiCategory();

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'uchat-emoji-tabs';
    EMOJI_CATEGORIES.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'uchat-emoji-tab' + (cat.key === activeKey ? ' active' : '');
      btn.dataset.category = cat.key;
      btn.title = cat.title;
      btn.textContent = cat.icon;
      btn.addEventListener('click', () => {
        setLastEmojiCategory(cat.key);
        pop.querySelectorAll('.uchat-emoji-tab').forEach(b => b.classList.toggle('active', b.dataset.category === cat.key));
        renderGrid(cat.key);
      });
      tabs.appendChild(btn);
    });
    pop.appendChild(tabs);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'uchat-emoji-grid';
    pop.appendChild(grid);

    function renderGrid(key) {
      const cat = EMOJI_CATEGORIES.find(c => c.key === key) || EMOJI_CATEGORIES[0];
      grid.innerHTML = cat.items.map(e =>
        `<button type="button" class="uchat-emoji-btn" data-emoji="${e}" title="${e}">${e}</button>`
      ).join('');
      grid.querySelectorAll('.uchat-emoji-btn').forEach(b => {
        b.addEventListener('click', () => onPick(b.dataset.emoji));
      });
    }
    renderGrid(activeKey);

    // Klik dovnitř popoveru nesmí zavřít (stopPropagation)
    pop.addEventListener('click', e => e.stopPropagation());

    return pop;
  }

  // Vloží emoji na pozici kurzoru v textarei (nebo na konec)
  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + text + after;
    const newPos = start + text.length;
    textarea.selectionStart = textarea.selectionEnd = newPos;
    textarea.focus();
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  function renderBadge() {
    const dot = document.querySelector('.uchat-bubble .dot');
    if (!dot) return;
    dot.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
    dot.classList.toggle('show', totalUnread > 0);
  }

  function renderSidebar() {
    const list = document.querySelector('.uchat-channels');
    if (!list) return;
    if ((!channels || channels.length === 0) && channelsLoading) {
      list.innerHTML = '<div class="uchat-loader">Načítám konverzace…</div>';
      return;
    }
    if (!channels || channels.length === 0) {
      list.innerHTML = '<div class="uchat-empty-list">Zatím žádné konverzace. Klikni na <strong>+ Nová</strong> výše.</div>';
      return;
    }
    list.innerHTML = channels.map(c => {
      const name = channelDisplayName(c);
      const preview = c.last_message ? (c.last_message.content.length > 40 ? c.last_message.content.slice(0, 40) + '…' : c.last_message.content) : '—';
      const other = channelOtherUser(c);
      // Pro 1:1 avatar protistrany, pro skupinu ikona
      const avatar = other
        ? avatarHtml(other)
        : `<span class="uchat-avatar" style="background:#3b82f6">${channelIcon(c)}</span>`;
      return `
        <div class="uchat-channel ${c.id === activeChannelId ? 'active' : ''}" data-id="${escapeHtml(c.id)}">
          ${avatar}
          <div class="body">
            <div class="name">
              <span>${escapeHtml(name)}</span>
              ${c.unread > 0 ? `<span class="unread">${c.unread}</span>` : ''}
            </div>
            <div class="preview">${escapeHtml(preview)}</div>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.uchat-channel').forEach(el => {
      el.addEventListener('click', () => openChannel(el.dataset.id));
    });
  }

  function renderMessages() {
    const main = document.querySelector('.uchat-main');
    if (!main) return;

    if (!activeChannelId) {
      main.innerHTML = `
        <header><h3>Vyber konverzaci</h3><button class="close-btn" title="Zavřít">✕</button></header>
        <div class="uchat-empty-state">
          <div class="icon">💬</div>
          <div style="font-size:14px;font-weight:600;color:var(--text,#fff);">Začni konverzaci</div>
          <div style="font-size:12px;margin-top:6px;">Vyber ze seznamu nebo klikni na <strong>+ Nová</strong>.</div>
        </div>`;
      main.querySelector('.close-btn').addEventListener('click', closePanel);
      return;
    }

    const myId = meId();
    const title = activeChannel ? channelDisplayName(activeChannel) : '…';
    const other = channelOtherUser(activeChannel);
    const headerAvatar = other
      ? avatarHtml(other, 'sm')
      : `<span class="uchat-avatar sm" style="background:#3b82f6">${channelIcon(activeChannel || {})}</span>`;

    main.innerHTML = `
      <header>
        <h3 style="display:flex;align-items:center;gap:8px;">
          ${headerAvatar}
          <span style="display:flex;flex-direction:column;line-height:1.15;">
            <span>${escapeHtml(title)}</span>
            <span class="presence"></span>
          </span>
        </h3>
        <div style="display:flex;gap:6px;">
          <button class="close-btn" title="Zavřít">✕</button>
        </div>
      </header>
      <div class="uchat-messages"></div>
      <div class="uchat-pending"></div>
      <div class="uchat-compose" style="position:relative;">
        <button class="attach-btn" title="Přiložit soubor (nebo vlož obrázek přes Ctrl+V)">📎</button>
        <input type="file" class="file-input" multiple hidden>
        <button class="emoji-btn" title="Vložit smajlíka">😊</button>
        <textarea placeholder="Napiš zprávu… (Enter = odeslat, Shift+Enter = nový řádek, Ctrl+V = vložit screenshot)" rows="1"></textarea>
        <button class="send-btn">Odeslat</button>
      </div>`;

    const msgBox = main.querySelector('.uchat-messages');
    if (messagesLoading && messages.length === 0) {
      msgBox.innerHTML = '<div class="uchat-loader" style="padding:20px;">Načítám zprávy…</div>';
    } else {
    // Pro read receipts potřebujeme nejvyšší `last_read_at` někoho jiného
    // než my sami (typicky protistrany v 1:1 chatu).
    const othersReadAt = (() => {
      const times = (activeChannel?.members || [])
        .filter(m => m.user_id !== myId && m.last_read_at)
        .map(m => new Date(m.last_read_at).getTime());
      return times.length ? Math.max(...times) : 0;
    })();

    msgBox.innerHTML = messages.map(m => {
      const mine = m.sender_type === 'user' && m.sender_id === myId;
      const cls = m.sender_type === 'system' ? 'system' : m.sender_type === 'ai' ? 'ai' : (mine ? 'mine' : 'other');
      const author = m.sender_type === 'user'
        ? (m.sender?.display_name || m.sender?.username || 'Neznámý')
        : (m.sender_label || (m.sender_type === 'ai' ? 'Claude' : 'HolyOS'));
      const extraCls = m._pending ? ' pending' : (m._failed ? ' failed' : '');
      const atts = Array.isArray(m.attachments) ? m.attachments : [];
      const attsHtml = atts.length ? `<div class="atts">${atts.map(a => {
        if (a.kind === 'image' && a.url) {
          return `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img class="att-img" src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name || '')}"></a>`;
        }
        return `<a class="att-file" href="${escapeHtml(a.url || '#')}" target="_blank" rel="noopener" download="${escapeHtml(a.name || '')}">📎 ${escapeHtml(a.name || 'soubor')}</a>`;
      }).join('')}</div>` : '';
      const bodyHtml = m.content ? `<div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>` : '';

      // Fajfky (jen u mých zpráv, které už jsou na serveru)
      let ticksHtml = '';
      if (mine && !m._pending && !m._failed) {
        const sentAt = new Date(m.created_at).getTime();
        const isRead = othersReadAt >= sentAt;
        ticksHtml = isRead
          ? '<span class="ticks read" title="Přečteno">✓✓</span>'
          : '<span class="ticks sent" title="Odesláno">✓</span>';
      }

      return `
        <div class="uchat-msg ${cls}${extraCls}">
          ${!mine && cls !== 'system' ? `<div class="author">${escapeHtml(author)}</div>` : ''}
          ${bodyHtml}
          ${attsHtml}
          <div class="ts">${formatTime(m.created_at)}${m._pending ? ' ⏳' : ''}${m._failed ? ' ⚠️' : ''}${ticksHtml}</div>
        </div>`;
    }).join('');
    msgBox.scrollTop = msgBox.scrollHeight;
    }

    // Doplň text "online/offline" do headeru podle aktuální presence
    updateHeaderPresence();

    // Znovu vykresli pending přílohy (při přepnutí konverzace je vyčistíme)
    renderPendingAttachments();

    const ta = main.querySelector('textarea');
    const sendBtn = main.querySelector('.send-btn');
    const attachBtn = main.querySelector('.attach-btn');
    const fileInput = main.querySelector('.file-input');

    const doSend = (useAi = false) => {
      const txt = ta.value.trim();
      // Necháme poslat i jen samotné přílohy (bez textu), ale pouze pokud jsou ready
      const ready = pendingAttachments.filter(a => a.status === 'ready');
      const stillUploading = pendingAttachments.some(a => a.status === 'uploading');
      if (stillUploading) { alert('Počkej, soubor se ještě nahrává…'); return; }
      if (!txt && ready.length === 0) return;
      ta.value = '';
      // Vyčistit pending před odesláním — optimistická zpráva už je drží
      pendingAttachments.forEach(a => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      pendingAttachments = [];
      renderPendingAttachments();
      sendMessage(txt, useAi, ready);
    };

    sendBtn.addEventListener('click', () => doSend(false));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(false); }
    });

    // Přiložit soubor přes 📎 tlačítko
    attachBtn.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
    fileInput.addEventListener('change', () => {
      addFilesToCompose(fileInput.files);
      fileInput.value = ''; // umožní znovu vybrat stejný soubor
    });

    // Emoji picker 😊
    const emojiBtn = main.querySelector('.emoji-btn');
    const composeRow = main.querySelector('.uchat-compose');
    let emojiPopover = null;
    const closeEmojiPopover = () => {
      if (emojiPopover) {
        emojiPopover.remove();
        emojiPopover = null;
        emojiBtn.classList.remove('active');
        document.removeEventListener('click', onOutsideClick);
      }
    };
    const onOutsideClick = (e) => {
      if (emojiPopover && !emojiPopover.contains(e.target) && e.target !== emojiBtn) closeEmojiPopover();
    };
    emojiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (emojiPopover) { closeEmojiPopover(); return; }
      emojiPopover = buildEmojiPopover((emoji) => {
        insertAtCursor(ta, emoji);
      });
      composeRow.appendChild(emojiPopover);
      emojiBtn.classList.add('active');
      // Listener na outside click — registruj asynchronně, ať current click neprojde
      setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
    });

    // Ctrl+V paste — obrázek ze schránky (screenshot)
    ta.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault(); // ať se do textarea nevloží název souboru
        addFilesToCompose(files);
      }
    });

    // Drag & drop souborů na textareu
    ta.addEventListener('dragover', (e) => { e.preventDefault(); });
    ta.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      addFilesToCompose(e.dataTransfer.files);
    });

    main.querySelector('.close-btn').addEventListener('click', closePanel);
  }

  // ─── Channel management ────────────────────────────────────────────────────

  async function openChannel(channelId) {
    activeChannelId = channelId;
    activeChannel = channels.find(c => c.id === channelId) || null;
    messages = [];
    messagesLoading = true;
    // Rozpracované přílohy patří k té staré konverzaci, zahoď je
    pendingAttachments.forEach(a => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    pendingAttachments = [];
    renderSidebar();
    renderMessages();  // hned uk\u00e1\u017ee hlavi\u010dku s avatarem + loader
    loadMessages(channelId).catch(() => {});
  }

  function upsertChannel(ch) {
    const idx = channels.findIndex(c => c.id === ch.id);
    if (idx >= 0) channels[idx] = { ...channels[idx], ...ch };
    else channels.unshift({ ...ch, unread: 0 });
  }

  async function openDirectWith(userId) {
    try {
      // Optimisticky otev\u0159i panel hned \u2014 u\u017eivatel vid\u00ed reakci okam\u017eit\u011b
      openPanel();
      const ch = await api('/api/messages/channels/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      // P\u0159idej/updatni kan\u00e1l v lok\u00e1ln\u00edm state \u2014 bez dal\u0161\u00edho GET /channels
      upsertChannel(ch);
      renderSidebar();
      activeChannelId = ch.id;
      activeChannel = ch;
      messages = [];
      renderMessages();
      // Na\u010dti zpr\u00e1vy (pro existuj\u00edc\u00ed konverzace); pro nov\u00e9 je to pr\u00e1zdn\u00e9 a r\u00fdchl\u00e9
      loadMessages(ch.id).catch(() => {});
    } catch (e) { alert('Nelze otevřít konverzaci: ' + e.message); }
  }

  async function openTaskChannel(taskId) {
    try {
      openPanel();
      const ch = await api('/api/messages/channels/task/' + taskId, { method: 'POST' });
      upsertChannel(ch);
      renderSidebar();
      activeChannelId = ch.id;
      activeChannel = ch;
      messages = [];
      renderMessages();
      loadMessages(ch.id).catch(() => {});
    } catch (e) { alert('Nelze otevřít thread: ' + e.message); }
  }

  // ─── Modal pro založení konverzace ─────────────────────────────────────────

  async function loadUsers(q = '') {
    try {
      users = await api('/api/messages/users/searchable?q=' + encodeURIComponent(q));
      return users;
    } catch (_) { return []; }
  }

  function openNewChannelModal() {
    const modal = document.createElement('div');
    modal.className = 'uchat-modal';
    modal.innerHTML = `
      <div class="box">
        <h3>Nová konverzace</h3>
        <div class="tabs">
          <button data-tab="direct" class="active">1:1 chat</button>
          <button data-tab="group">Skupina</button>
        </div>
        <div class="body"></div>
        <div class="actions">
          <button class="secondary" data-action="cancel">Zrušit</button>
          <button class="primary" data-action="ok">Vytvořit</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    let tab = 'direct';
    let selectedUserIds = new Set();
    let groupName = '';

    const body = modal.querySelector('.body');
    function renderBody() {
      if (tab === 'direct') {
        body.innerHTML = `
          <input type="text" class="search" placeholder="Hledat uživatele...">
          <div class="user-picker"></div>`;
        const search = body.querySelector('.search');
        const picker = body.querySelector('.user-picker');
        const refresh = async () => {
          const list = await loadUsers(search.value);
          picker.innerHTML = list.map(u => `
            <div class="user" data-id="${u.id}" style="display:flex;align-items:center;gap:10px;">
              ${avatarHtml(u, 'sm')}
              <span style="flex:1;">${escapeHtml(u.display_name || u.username)}</span>
              <span style="color:var(--text2,#a3a3b2);font-size:11px;">@${escapeHtml(u.username)}</span>
            </div>`).join('') || '<div style="padding:14px;text-align:center;color:var(--text2,#a3a3b2);font-size:12px;">Nic nenalezeno</div>';
          picker.querySelectorAll('.user').forEach(el => {
            el.addEventListener('click', async () => {
              modal.remove();
              await openDirectWith(parseInt(el.dataset.id));
            });
          });
        };
        search.addEventListener('input', () => refresh());
        refresh();
      } else {
        body.innerHTML = `
          <input type="text" class="name" placeholder="Název skupiny (např. Vedení)" value="${escapeHtml(groupName)}">
          <input type="text" class="search" placeholder="Hledat uživatele...">
          <div class="user-picker"></div>
          <div style="font-size:11px;color:var(--text2,#a3a3b2);margin-top:6px;">Vybraných: <span class="count">${selectedUserIds.size}</span></div>`;
        const nameInput = body.querySelector('.name');
        const search = body.querySelector('.search');
        const picker = body.querySelector('.user-picker');
        const count = body.querySelector('.count');
        nameInput.addEventListener('input', (e) => { groupName = e.target.value; });
        const refresh = async () => {
          const list = await loadUsers(search.value);
          picker.innerHTML = list.map(u => `
            <div class="user ${selectedUserIds.has(u.id) ? 'selected' : ''}" data-id="${u.id}" style="display:flex;align-items:center;gap:10px;">
              ${avatarHtml(u, 'sm')}
              <span style="flex:1;">${escapeHtml(u.display_name || u.username)}</span>
              <span style="color:var(--text2,#a3a3b2);font-size:11px;">@${escapeHtml(u.username)}</span>
            </div>`).join('');
          picker.querySelectorAll('.user').forEach(el => {
            el.addEventListener('click', () => {
              const id = parseInt(el.dataset.id);
              if (selectedUserIds.has(id)) selectedUserIds.delete(id); else selectedUserIds.add(id);
              count.textContent = selectedUserIds.size;
              el.classList.toggle('selected');
            });
          });
        };
        search.addEventListener('input', () => refresh());
        refresh();
      }
    }
    renderBody();

    modal.querySelectorAll('.tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tab = btn.dataset.tab;
        renderBody();
      });
    });

    modal.querySelector('[data-action=cancel]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('[data-action=ok]').addEventListener('click', async () => {
      if (tab === 'direct') {
        alert('Klikni na uživatele v seznamu.');
        return;
      }
      if (!groupName.trim()) { alert('Zadej název skupiny'); return; }
      if (selectedUserIds.size === 0) { alert('Přidej alespoň jednoho uživatele'); return; }
      try {
        const ch = await api('/api/messages/channels/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: groupName.trim(), user_ids: [...selectedUserIds] }),
        });
        modal.remove();
        await loadChannels();
        openChannel(ch.id);
      } catch (e) { alert('Chyba: ' + e.message); }
    });
  }

  // ─── Panel toggle ─────────────────────────────────────────────────────────

  function openPanel() {
    panelOpen = true;
    document.querySelector('.uchat-panel')?.classList.add('open');
    // Jen prvn\u00ed otev\u0159en\u00ed = fetch. D\u00e1le je seznam \u017eiv\u00fd p\u0159es SSE, \u017e\u00e1dn\u00fd dal\u0161\u00ed roundtrip.
    if (!channelsLoaded) loadChannels();
  }
  function closePanel() {
    panelOpen = false;
    document.querySelector('.uchat-panel')?.classList.remove('open');
  }
  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  // ─── Mount ─────────────────────────────────────────────────────────────────

  function mount() {
    if (document.querySelector('.uchat-bubble')) return;
    // Skrýt na login stránce
    if (/\/login(\.html)?$/i.test(location.pathname)) return;
    // Na fullscreen chat stránce je widget zbytečný (překrýval by Send button)
    if (/\/modules\/chat(\/|$|\/index)/i.test(window.location.pathname)) return;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const bubble = document.createElement('button');
    bubble.className = 'uchat-bubble';
    bubble.title = 'Zprávy';
    bubble.innerHTML = '💬<span class="dot">0</span>';
    bubble.addEventListener('click', togglePanel);
    document.body.appendChild(bubble);

    const panel = document.createElement('div');
    panel.className = 'uchat-panel';
    panel.innerHTML = `
      <aside class="uchat-sidebar">
        <header>
          <h3>💬 Zprávy</h3>
          <button class="new-btn">+ Nová</button>
        </header>
        <div class="uchat-channels"></div>
      </aside>
      <section class="uchat-main"></section>
      <div class="uchat-drop-hint">📥 Pusť soubor pro vložení do zprávy</div>`;
    panel.querySelector('.new-btn').addEventListener('click', openNewChannelModal);
    document.body.appendChild(panel);

    // ─── Drag & drop souborů kamkoli do chat panelu ──────────────────────
    // Safari (Mac) občas nereportuje 'Files' v dataTransfer.types během dragover
    // tak spolehlivě jako Chrome. Řešení: v dragover VŽDY preventDefault (aby
    // Safari povolil drop), vizuální feedback drž na detekci souborů, a samotný
    // drop handler tolerantně přečti files i items jako fallback.
    let _uchatDragCounter = 0;
    function _dragHasFilesUchat(e) {
      if (!e.dataTransfer) return false;
      const types = e.dataTransfer.types || [];
      // 'types' může být DOMStringList (Safari) nebo Array — iterace přes for
      for (let i = 0; i < types.length; i++) {
        const t = types[i];
        if (t === 'Files' || t === 'application/x-moz-file') return true;
      }
      // DOMStringList.contains() varianta (starší Safari)
      if (typeof types.contains === 'function' && types.contains('Files')) return true;
      return false;
    }
    panel.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (_dragHasFilesUchat(e)) {
        _uchatDragCounter++;
        panel.classList.add('dragging');
      }
    });
    panel.addEventListener('dragover', (e) => {
      if (!e.dataTransfer) return;
      // VŽDY preventDefault — i když types neobsahuje 'Files' (Safari quirk),
      // potřebujeme přijmout drop. Skutečné soubory ověří až drop handler.
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    });
    panel.addEventListener('dragleave', (e) => {
      _uchatDragCounter = Math.max(0, _uchatDragCounter - 1);
      if (_uchatDragCounter === 0) panel.classList.remove('dragging');
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      _uchatDragCounter = 0;
      panel.classList.remove('dragging');
      // Primárně files; fallback na DataTransferItemList (pokud files prázdné)
      const dt = e.dataTransfer;
      let files = (dt && dt.files && dt.files.length) ? Array.from(dt.files) : [];
      if (!files.length && dt && dt.items) {
        for (let i = 0; i < dt.items.length; i++) {
          if (dt.items[i].kind === 'file') {
            const f = dt.items[i].getAsFile();
            if (f) files.push(f);
          }
        }
      }
      if (!files.length) return;
      if (!activeChannelId) {
        alert('Nejdřív vyber konverzaci v levém panelu, pak můžeš přetáhnout soubor.');
        return;
      }
      addFilesToCompose(files);
    });

    renderMessages();

    // SSE reakce — nové zprávy, updaty kanálů
    if (window.HolyOSEvents) {
      window.HolyOSEvents.on('message', (payload) => {
        if (!payload) return;
        const { channel_id, message } = payload;

        // Pokud je otevřený tenhle kanál — přidej do view
        if (channel_id === activeChannelId) {
          // Dedup: backend publikuje SSE i odesílateli, a my už máme zprávu
          // v messages z POST response. Pokud stejné ID je tam, ignoruj.
          // Zároveň pokud čeká optimistická zpráva se stejným obsahem od stejného
          // odesílatele (ještě nepřišla POST odpověď), nahraď ji reálnou.
          if (messages.some(m => m.id === message.id)) {
            return;
          }
          const pendingIdx = messages.findIndex(m =>
            m._pending && m.sender_id === message.sender_id && m.content === message.content
          );
          if (pendingIdx >= 0) {
            messages[pendingIdx] = message;
          } else {
            messages.push(message);
          }
          renderMessages();
          // A zároveň označ jako přečtené
          api('/api/messages/channels/' + channel_id + '/read', { method: 'POST' }).catch(() => {});
        } else {
          // Jinak zvedni unread count v boku
          const ch = channels.find(c => c.id === channel_id);
          if (ch) {
            if (message.sender_id !== meId()) { ch.unread = (ch.unread || 0) + 1; totalUnread++; }
            ch.last_message = message;
            ch.last_message_at = message.created_at;
          } else {
            // Nový kanál — přetáhneme celý seznam
            loadChannels();
            return;
          }
        }
        renderSidebar();
        renderBadge();
      });

      window.HolyOSEvents.on('channel_update', () => loadChannels());

      // Presence — někdo se připojil / odpojil
      window.HolyOSEvents.on('presence', (payload) => {
        if (!payload || !payload.user_id) return;
        const uid = Number(payload.user_id);
        if (payload.online) onlineUsers.add(uid);
        else onlineUsers.delete(uid);
        refreshPresenceInDom();
      });

      // Read receipts — protistrana právě něco přečetla
      window.HolyOSEvents.on('read', (payload) => {
        if (!payload || !payload.channel_id) return;
        const ch = channels.find(c => c.id === payload.channel_id);
        if (ch && Array.isArray(ch.members)) {
          const mm = ch.members.find(m => m.user_id === payload.reader_id);
          if (mm) mm.last_read_at = payload.last_read_at;
        }
        if (payload.channel_id === activeChannelId) {
          // Přepočti a překresli fajfky
          renderMessages();
        }
      });
    }

    // Externí API
    window.HolyOSChat = {
      openDirectWith,
      openTaskChannel,
      open: openPanel,
      close: closePanel,
      toggle: togglePanel,
    };

    // Stale-while-revalidate: nejd\u0159\u00edv naplnit meId z cache (synchronn\u011b),
    // pak uk\u00e1\u017e kan\u00e1ly z cache (se spr\u00e1vn\u00fdmi jm\u00e9ny), pak refresh na pozad\u00ed.
    primeMyIdFromCache();
    const cached = loadCachedChannels();
    if (cached && cached.length) {
      channels = cached;
      channelsLoaded = true;
      renderSidebar();
    }
    loadChannels();
    loadPresence(); // kdo je online PRÁVĚ TEĎ (pak už jen SSE eventy)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
