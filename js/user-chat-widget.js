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

    .uchat-main { display: flex; flex-direction: column; min-width: 0; }
    .uchat-main header { padding: 10px 14px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .uchat-main h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .uchat-main .close-btn { background: none; border: none; color: var(--text2, #a3a3b2); cursor: pointer; font-size: 18px; padding: 2px 6px; border-radius: 4px; }
    .uchat-main .close-btn:hover { background: rgba(255,255,255,0.08); color: var(--text, #fff); }
    .uchat-main .ai-btn { background: rgba(168,139,250,0.15); color: #a78bfa; border: 1px solid rgba(168,139,250,0.3); padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; }
    .uchat-main .ai-btn:hover { background: rgba(168,139,250,0.3); }

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

    .uchat-compose { padding: 10px 12px; border-top: 1px solid var(--border, rgba(255,255,255,0.08)); display: flex; gap: 8px; }
    .uchat-compose textarea { flex: 1; min-height: 36px; max-height: 120px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border, rgba(255,255,255,0.1)); background: var(--surface, #1e1e2f); color: var(--text, #fff); font-size: 13px; resize: none; font-family: inherit; }
    .uchat-compose textarea:focus { outline: 1px solid #6c5ce7; }
    .uchat-compose button { background: linear-gradient(135deg, #6c5ce7, #3b82f6); color: #fff; border: none; padding: 0 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .uchat-compose button:disabled { opacity: 0.5; cursor: not-allowed; }

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
    if (photo) {
      return `<span class="${cls}" style="background-image:url('${String(photo).replace(/'/g, "\\'")}');background-color:${color};"></span>`;
    }
    return `<span class="${cls}" style="background:${color};">${escapeHtml(initials(user))}</span>`;
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

  async function sendMessage(text, useAi = false) {
    if (!activeChannelId || !text.trim()) return;
    // Optimistic UI — uka\u017e zpr\u00e1vu hned, bez \u010dek\u00e1n\u00ed na server
    const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const myIdVal = meId();
    const optimistic = {
      id: tempId,
      channel_id: activeChannelId,
      sender_id: myIdVal,
      sender_type: 'user',
      content: text,
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
        body: JSON.stringify({ content: text, ai: useAi }),
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
        <h3 style="display:flex;align-items:center;gap:8px;">${headerAvatar}<span>${escapeHtml(title)}</span></h3>
        <div style="display:flex;gap:6px;">
          <button class="ai-btn" title="Zapoj AI asistenta do této konverzace">✨ Zeptat se AI</button>
          <button class="close-btn" title="Zavřít">✕</button>
        </div>
      </header>
      <div class="uchat-messages"></div>
      <div class="uchat-compose">
        <textarea placeholder="Napiš zprávu… (Enter = odeslat, Shift+Enter = nový řádek)" rows="1"></textarea>
        <button class="send-btn">Odeslat</button>
      </div>`;

    const msgBox = main.querySelector('.uchat-messages');
    if (messagesLoading && messages.length === 0) {
      msgBox.innerHTML = '<div class="uchat-loader" style="padding:20px;">Načítám zprávy…</div>';
    } else {
    msgBox.innerHTML = messages.map(m => {
      const mine = m.sender_type === 'user' && m.sender_id === myId;
      const cls = m.sender_type === 'system' ? 'system' : m.sender_type === 'ai' ? 'ai' : (mine ? 'mine' : 'other');
      const author = m.sender_type === 'user'
        ? (m.sender?.display_name || m.sender?.username || 'Neznámý')
        : (m.sender_label || (m.sender_type === 'ai' ? 'Claude' : 'HolyOS'));
      const extraCls = m._pending ? ' pending' : (m._failed ? ' failed' : '');
      return `
        <div class="uchat-msg ${cls}${extraCls}">
          ${!mine && cls !== 'system' ? `<div class="author">${escapeHtml(author)}</div>` : ''}
          <div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
          <div class="ts">${formatTime(m.created_at)}${m._pending ? ' ⏳' : ''}${m._failed ? ' ⚠️' : ''}</div>
        </div>`;
    }).join('');
    msgBox.scrollTop = msgBox.scrollHeight;
    }

    const ta = main.querySelector('textarea');
    const sendBtn = main.querySelector('.send-btn');
    const aiBtn = main.querySelector('.ai-btn');

    const doSend = (useAi = false) => {
      const txt = ta.value.trim();
      if (!txt) return;
      ta.value = '';
      sendMessage(txt, useAi);
    };

    sendBtn.addEventListener('click', () => doSend(false));
    aiBtn.addEventListener('click', () => {
      const txt = ta.value.trim();
      if (!txt) { ta.placeholder = 'Napiš dotaz pro AI…'; ta.focus(); return; }
      doSend(true);
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(false); }
    });
    main.querySelector('.close-btn').addEventListener('click', closePanel);
  }

  // ─── Channel management ────────────────────────────────────────────────────

  async function openChannel(channelId) {
    activeChannelId = channelId;
    activeChannel = channels.find(c => c.id === channelId) || null;
    messages = [];
    messagesLoading = true;
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
      <section class="uchat-main"></section>`;
    panel.querySelector('.new-btn').addEventListener('click', openNewChannelModal);
    document.body.appendChild(panel);

    renderMessages();

    // SSE reakce — nové zprávy, updaty kanálů
    if (window.HolyOSEvents) {
      window.HolyOSEvents.on('message', (payload) => {
        if (!payload) return;
        const { channel_id, message } = payload;

        // Pokud je otevřený tenhle kanál — přidej do view
        if (channel_id === activeChannelId) {
          messages.push(message);
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
