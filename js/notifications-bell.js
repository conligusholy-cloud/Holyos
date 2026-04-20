/* ============================================
   notifications-bell.js — Zvonek notifikací
   vpravo nahoře, badge s počtem nepřečtených,
   dropdown se seznamem posledních notifikací.
   Reaguje na live eventy z HolyOSEvents (SSE).
   ============================================ */

(function() {
  'use strict';
  if (window.__notifBellLoaded) return;
  window.__notifBellLoaded = true;

  const CSS = `
    .holyos-bell {
      position: fixed; top: 22px; right: 74px; z-index: 9001;
      width: 40px; height: 40px; border-radius: 50%;
      background: var(--surface, #1e1e2f); color: var(--text, #fff);
      border: 1px solid var(--border, rgba(255,255,255,0.15));
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; font-size: 18px;
      transition: all 0.2s; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    .holyos-bell:hover { background: rgba(108,92,231,0.15); border-color: rgba(108,92,231,0.5); }
    .holyos-bell .dot {
      position: absolute; top: -2px; right: -2px;
      min-width: 18px; height: 18px; padding: 0 5px;
      border-radius: 9px; background: #ef4444; color: #fff;
      font-size: 10px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
      border: 2px solid var(--bg, #0f0f1a);
    }
    .holyos-bell .dot.show { display: flex; }

    .holyos-bell-panel {
      position: fixed; top: 72px; right: 16px; z-index: 9000;
      width: 360px; max-width: calc(100vw - 24px); max-height: 70vh;
      background: var(--bg, #12121c); border: 1px solid var(--border, rgba(255,255,255,0.1));
      border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
      overflow: hidden; display: none; flex-direction: column;
    }
    .holyos-bell-panel.open { display: flex; }
    .holyos-bell-panel header {
      padding: 12px 16px; display: flex; justify-content: space-between;
      align-items: center; border-bottom: 1px solid var(--border, rgba(255,255,255,0.1));
    }
    .holyos-bell-panel h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text, #fff); }
    .holyos-bell-panel .read-all {
      font-size: 11px; background: none; border: none; color: var(--text2, #a3a3b2); cursor: pointer;
    }
    .holyos-bell-panel .read-all:hover { color: #a78bfa; }
    .holyos-bell-list { overflow-y: auto; flex: 1; }
    .holyos-bell-item {
      padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);
      cursor: pointer; transition: background 0.15s; display: flex; gap: 10px;
    }
    .holyos-bell-item:hover { background: rgba(108,92,231,0.08); }
    .holyos-bell-item.unread { background: rgba(108,92,231,0.04); }
    .holyos-bell-item.unread::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: #a78bfa; margin-top: 6px; flex-shrink: 0;
    }
    .holyos-bell-item .content { flex: 1; min-width: 0; }
    .holyos-bell-item .title { font-size: 13px; font-weight: 600; color: var(--text, #fff); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .holyos-bell-item .body { font-size: 12px; color: var(--text2, #a3a3b2); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .holyos-bell-item .time { font-size: 10px; color: var(--text2, #6c6c7e); margin-top: 3px; }
    .holyos-bell-empty { padding: 30px 16px; text-align: center; color: var(--text2, #a3a3b2); font-size: 12px; }

    @media (max-width: 768px) {
      .holyos-bell { top: 14px; right: 62px; width: 34px; height: 34px; font-size: 15px; }
      .holyos-bell .dot { min-width: 16px; height: 16px; font-size: 9px; }
      .holyos-bell-panel { top: 54px; right: 8px; width: calc(100vw - 16px); }
    }
    @media print {
      .holyos-bell, .holyos-bell-panel { display: none !important; }
    }
  `;

  let items = [];
  let unread = 0;
  let open = false;

  function getToken() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }

  function fetchOpts(extra) {
    const t = getToken();
    const headers = (extra && extra.headers) ? { ...extra.headers } : {};
    if (t) headers['Authorization'] = 'Bearer ' + t;
    return { credentials: 'include', ...(extra || {}), headers };
  }

  function injectCSS() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'právě teď';
    if (diff < 3600) return Math.floor(diff/60) + ' min';
    if (diff < 86400) return Math.floor(diff/3600) + ' h';
    if (diff < 604800) return Math.floor(diff/86400) + ' d';
    return d.toLocaleDateString('cs-CZ');
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function render() {
    const dot = document.querySelector('.holyos-bell .dot');
    if (dot) {
      dot.textContent = unread > 99 ? '99+' : String(unread);
      dot.classList.toggle('show', unread > 0);
    }

    const list = document.querySelector('.holyos-bell-list');
    if (!list) return;

    if (items.length === 0) {
      list.innerHTML = '<div class="holyos-bell-empty">Žádné notifikace 🎉</div>';
      return;
    }

    list.innerHTML = items.map(n => `
      <div class="holyos-bell-item ${n.read_at ? '' : 'unread'}" data-id="${escapeHtml(n.id)}" data-link="${escapeHtml(n.link || '')}">
        <div class="content">
          <div class="title">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="body">${escapeHtml(n.body)}</div>` : ''}
          <div class="time">${formatTime(n.created_at)}</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.holyos-bell-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        const link = el.dataset.link;
        await markRead(id);
        if (link) window.location.href = link;
        else closePanel();
      });
    });
  }

  async function load() {
    try {
      const [listRes, countRes] = await Promise.all([
        fetch('/api/notifications?limit=30', fetchOpts()),
        fetch('/api/notifications/unread-count', fetchOpts()),
      ]);
      if (listRes.ok) items = await listRes.json();
      if (countRes.ok) unread = (await countRes.json()).count || 0;
      render();
    } catch (e) {
      console.warn('[NotifBell] load error', e);
    }
  }

  async function markRead(id) {
    try {
      await fetch('/api/notifications/' + id + '/read', fetchOpts({ method: 'POST' }));
      const item = items.find(x => x.id === id);
      if (item && !item.read_at) { item.read_at = new Date().toISOString(); unread = Math.max(0, unread - 1); }
      render();
    } catch (e) { /* ignore */ }
  }

  async function markAllRead() {
    try {
      await fetch('/api/notifications/read-all', fetchOpts({ method: 'POST' }));
      items.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString(); });
      unread = 0;
      render();
    } catch (e) { /* ignore */ }
  }

  function togglePanel() {
    const panel = document.querySelector('.holyos-bell-panel');
    if (!panel) return;
    open = !open;
    panel.classList.toggle('open', open);
    if (open) load();
  }

  function closePanel() {
    open = false;
    const panel = document.querySelector('.holyos-bell-panel');
    if (panel) panel.classList.remove('open');
  }

  function mount() {
    if (document.querySelector('.holyos-bell')) return;
    // Přihlášení je řešené v sidebar.js (redirect na /login při 401).
    // Pokud zvonek visí na login stránce, nic se nerozbije — API vrátí 401 tiše.
    // Skrýt zvonek na login stránce podle URL:
    if (/\/login(\.html)?$/i.test(location.pathname)) return;

    injectCSS();

    const bell = document.createElement('button');
    bell.className = 'holyos-bell';
    bell.title = 'Notifikace';
    bell.innerHTML = '🔔<span class="dot">0</span>';
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(bell);

    const panel = document.createElement('div');
    panel.className = 'holyos-bell-panel';
    panel.innerHTML = `
      <header>
        <h3>🔔 Notifikace</h3>
        <button class="read-all" title="Označit vše jako přečtené">Vše přečteno</button>
      </header>
      <div class="holyos-bell-list"></div>
    `;
    panel.querySelector('.read-all').addEventListener('click', markAllRead);
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(panel);

    document.addEventListener('click', () => { if (open) closePanel(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closePanel(); });

    // SSE live updaty
    if (window.HolyOSEvents) {
      window.HolyOSEvents.on('notification', (n) => {
        if (!n) return;
        // Přidej na začátek (pokud ještě neni)
        if (!items.some(x => x.id === n.id)) items.unshift(n);
        if (items.length > 50) items.length = 50;
        if (!n.read_at) unread++;
        render();
      });
    }

    load();
    // Periodická aktualizace (zálohá pro případ, že SSE spadne)
    setInterval(load, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
