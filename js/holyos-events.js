/* ============================================
   holyos-events.js — Sdílený SSE klient pro
   notifikace a chat zprávy. Jedno spojení,
   více posluchačů.
   Použití:
     HolyOSEvents.on('notification', (n) => {...});
     HolyOSEvents.on('message', ({channel_id, message}) => {...});
     HolyOSEvents.on('channel_update', ({channel_id}) => {...});
     HolyOSEvents.on('connected', () => {...});
   ============================================ */

(function() {
  'use strict';
  if (window.HolyOSEvents) return;

  const listeners = new Map(); // event -> Set<handler>
  let es = null;
  let connected = false;
  let reconnectTimer = null;
  let reconnectDelay = 1000;

  function emit(event, data) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(data); } catch (e) { console.error('[HolyOSEvents]', event, e); }
    }
  }

  function getToken() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }

  function connect() {
    if (es) return;
    const token = getToken();
    // Token může být v sessionStorage/localStorage NEBO v HttpOnly cookie.
    // Pokud není v JS-accessible storage, vsadíme na cookie (withCredentials: true).
    const url = token
      ? '/api/notifications/stream?token=' + encodeURIComponent(token)
      : '/api/notifications/stream';
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch (e) {
      console.warn('[HolyOSEvents] EventSource init failed', e);
      scheduleReconnect();
      return;
    }

    es.addEventListener('connected', (ev) => {
      connected = true;
      reconnectDelay = 1000;
      try { emit('connected', JSON.parse(ev.data)); } catch (_) { emit('connected', null); }
    });

    ['notification', 'message', 'channel_update', 'ping', 'presence', 'read'].forEach(name => {
      es.addEventListener(name, (ev) => {
        let data = null;
        try { data = JSON.parse(ev.data); } catch (_) {}
        emit(name, data);
      });
    });

    es.onerror = () => {
      connected = false;
      try { es.close(); } catch (_) {}
      es = null;
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connect();
    }, reconnectDelay);
  }

  const api = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      // Lazy connect při prvním registru
      if (!es) connect();
      return () => api.off(event, handler);
    },
    off(event, handler) {
      const set = listeners.get(event);
      if (set) set.delete(handler);
    },
    isConnected() { return connected; },
    reconnect() {
      if (es) { try { es.close(); } catch (_) {} es = null; }
      connect();
    },
  };

  window.HolyOSEvents = api;

  // Automatické připojení. Nepředpokládáme token v storage — spojení se
  // autentizuje buď query tokenem, nebo HttpOnly cookie (withCredentials).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }

  // Disconnect při odchodu
  window.addEventListener('beforeunload', () => {
    if (es) { try { es.close(); } catch (_) {} }
  });
})();
