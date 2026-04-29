// =============================================================================
// HolyOS — Normování (mobile-first kiosk)
// =============================================================================
// 4 obrazovky: bootstrap auth → dávka → operace → měření.
// Identifikace přes HolyOS JWT cookie (/api/auth/me) — žádný PIN keypad.
// FY data se tahají přes /api/normovani/fy/batch/{id} (jeden request = vše).
// =============================================================================

(function () {
  'use strict';

  const LS_KEY = 'normovani_state_v1';

  const state = {
    person: null,        // { id, name } z user.person
    batch: null,         // { id, number, goods, operations: [...] }
    selectedOp: null,    // operations[i]
    session: null,       // { id, ... } — aktivní DB session
    events: [],          // NormovaniEvent[]
  };

  // ─── Util ─────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, Object.assign({
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    }, opts));
    const txt = await res.text();
    let body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch (_) { /* ne-JSON */ }
    if (!res.ok) {
      const msg = (body && (body.error || body.message)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return body;
  }

  function saveLS() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        session_id: state.session ? state.session.id : null,
        batch_id: state.batch ? state.batch.id : null,
        op_id: state.selectedOp ? state.selectedOp.id : null,
      }));
    } catch (_) { /* QuotaExceeded apod. */ }
  }
  function loadLS() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { return null; }
  }
  function clearLS() {
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
  }

  // ─── Screen routing ───────────────────────────────────────────────
  function show(screenId, title, step) {
    $$('.screen').forEach(function (s) { s.classList.remove('active'); });
    const el = $('#' + screenId);
    if (el) el.classList.add('active');
    $('#screen-title').textContent = title;
    $('#step-badge').textContent = step;
    $('#back-btn').style.display = screenId === 'screen-identify' ? 'none' : '';
    $('#person-name').textContent = (state.person && state.person.name) || '';
  }

  // ─── Screen 1: Auth bootstrap (HolyOS login) ─────────────────────
  function showAuthError(msg) {
    $('#auth-loading').style.display = 'none';
    $('#auth-error').style.display = '';
    $('#auth-error-msg').textContent = msg;
  }

  function redirectToLogin() {
    const back = encodeURIComponent(location.pathname + location.search);
    location.href = '/login.html?redirect=' + back;
  }

  async function bootstrapAuth() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.status === 401) {
        redirectToLogin();
        return false;
      }
      if (!res.ok) {
        showAuthError('Server vrátil ' + res.status + '. Zkus refresh.');
        return false;
      }
      const data = await res.json();
      const user = data && data.user;
      if (!user) {
        showAuthError('Nepodařilo se načíst přihlášeného uživatele.');
        return false;
      }
      if (!user.person || !user.person.id) {
        showAuthError(
          'Účet "' + (user.displayName || user.username) + '" nemá v HR navázaného pracovníka. ' +
          'Bez toho nelze normovat — kontaktuj admina, ať tě napojí na záznam Person.'
        );
        return false;
      }
      state.person = {
        id: user.person.id,
        name: ((user.person.first_name || '') + ' ' + (user.person.last_name || '')).trim()
              || user.displayName
              || user.username
              || ('#' + user.person.id),
      };
      saveLS();
      return true;
    } catch (e) {
      showAuthError('Chyba spojení: ' + (e.message || e));
      return false;
    }
  }

  async function logoutAndReturn() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {}
    clearLS();
    redirectToLogin();
  }

  // ─── Screen 2: Dávka ────────────────────────────────────────────
  function goBatch() {
    show('screen-batch', 'Číslo dávky', '2/4');
    $('#batch-input').value = '';
    $('#batch-input').focus();
  }

  function setupBatch() {
    $('#batch-find-btn').addEventListener('click', function () {
      fetchBatch($('#batch-input').value.trim());
    });
    $('#batch-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') fetchBatch($('#batch-input').value.trim());
    });
    $('#batch-scan-btn').addEventListener('click', async function () {
      const code = await scanQR('Naskenuj QR dávky');
      if (!code) return;
      const m = String(code).match(/\d+/);
      if (m) {
        $('#batch-input').value = m[0];
        fetchBatch(m[0]);
      } else {
        toast('Z QR se nepodařilo přečíst číslo', 'error');
      }
    });
    $('#batch-back-btn').addEventListener('click', logoutAndReturn);
  }

  async function fetchBatch(id) {
    if (!id || !/^\d+$/.test(id)) { toast('Zadej číslo dávky', 'error'); return; }
    setLoading('screen-batch');
    try {
      const batch = await api('/api/normovani/fy/batch/' + id);
      state.batch = batch;
      saveLS();
      goOperations();
    } catch (e) {
      toast(e.message, 'error');
      goBatch();
    }
  }

  // ─── Screen 3: Operace ──────────────────────────────────────────
  function goOperations() {
    show('screen-operations', 'Vyber operaci', '3/4');
    const b = state.batch;
    $('#batch-info').innerHTML =
      '<span class="icon">📦</span>' +
      '<div class="info">' +
        '<div class="title">Dávka ' + escapeHtml(b.number) + '</div>' +
        '<div class="sub">' + escapeHtml((b.goods && b.goods.code) || '') + ' ' +
        escapeHtml((b.goods && b.goods.name) || '') + ' (' + b.quantity + '×)</div>' +
      '</div>';
    const list = $('#op-list');
    list.innerHTML = '';
    if (!b.operations || b.operations.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="icon">📋</div>' +
        '<div class="msg">Tahle dávka nemá v FY žádné operace.</div></div>';
      return;
    }
    b.operations.forEach(function (op, i) {
      const div = document.createElement('button');
      div.className = 'op-card';
      div.style.cssText = 'background: #1e293b; border-color: #334155; cursor: pointer; text-align: left; width: 100%; font: inherit; color: inherit;';
      div.innerHTML =
        '<div class="op-position">' + escapeHtml(String(op.position != null ? op.position : (i + 1))) + '</div>' +
        '<div class="op-info">' +
          '<div class="op-name">' + escapeHtml(op.name) + '</div>' +
          '<div class="op-meta">' + escapeHtml(op.workplace || '') + '</div>' +
        '</div>' +
        '<div class="op-bom-count">' + op.bomItems.length + ' ks</div>';
      div.addEventListener('click', function () { startSession(op); });
      list.appendChild(div);
    });
  }

  // ─── Screen 4: Měření ──────────────────────────────────────────
  async function startSession(op) {
    state.selectedOp = op;
    setLoading('screen-operations');
    try {
      const res = await api('/api/normovani/sessions', {
        method: 'POST',
        body: JSON.stringify({
          person_id: state.person.id,
          fy_batch_id: state.batch.id,
          fy_operation_id: op.id,
        }),
      });
      state.session = res.session;
      if (res.resumed) {
        const evs = await api('/api/normovani/sessions/' + state.session.id + '/events');
        state.events = evs;
      } else {
        state.events = [];
      }
      saveLS();
      goMeasure();
    } catch (e) {
      toast(e.message, 'error');
      goOperations();
    }
  }

  function goMeasure() {
    show('screen-measure', state.selectedOp.name, '4/4');
    $('#session-info').innerHTML =
      '<span class="icon">⏱</span>' +
      '<div class="info">' +
        '<div class="title">' + escapeHtml(state.selectedOp.name) + '</div>' +
        '<div class="sub">' + escapeHtml(state.batch.number) + ' · ' +
        escapeHtml(state.selectedOp.workplace || '') + '</div>' +
      '</div>';
    renderItems();
  }

  function getItemStatus(itemId) {
    const evs = state.events.filter(function (e) {
      return String(e.fy_item_id) === String(itemId);
    });
    if (evs.length === 0) return 'idle';
    const last = evs[evs.length - 1];
    return last.event_type === 'start' ? 'in-progress' : 'done';
  }

  function renderItems() {
    const q = $('#item-search').value.trim().toLowerCase();
    const list = $('#item-list');
    list.innerHTML = '';
    const items = state.selectedOp.bomItems.filter(function (it) {
      if (!q) return true;
      const hay = ((it.code || '') + ' ' + (it.name || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="icon">🔍</div>' +
        '<div class="msg">Žádný díl neodpovídá hledání.</div></div>';
      return;
    }
    items.forEach(function (it) {
      const status = getItemStatus(it.id);
      const card = document.createElement('div');
      card.className = 'item-card ' + status;
      card.dataset.itemId = it.id;
      const startDisabled = (status === 'in-progress' || status === 'done') ? 'btn-disabled' : '';
      const endDisabled = (status !== 'in-progress') ? 'btn-disabled' : '';
      card.innerHTML =
        '<div class="item-header">' +
          '<div class="item-code">' + escapeHtml(it.code || '?') + '</div>' +
          '<div class="item-name">' + escapeHtml(it.name || '?') + '</div>' +
          '<div class="item-qty">' + formatQty(it.quantity) + ' ' + escapeHtml(it.unit || '') + '</div>' +
        '</div>' +
        '<div class="item-buttons">' +
          '<button class="btn btn-start ' + startDisabled + '" data-action="start">▶ Start</button>' +
          '<button class="btn btn-end ' + endDisabled + '" data-action="end">■ Konec</button>' +
        '</div>';
      card.querySelectorAll('button[data-action]').forEach(function (b) {
        b.addEventListener('click', function () { recordEvent(it, b.dataset.action); });
      });
      list.appendChild(card);
    });
  }

  async function recordEvent(item, eventType) {
    try {
      const ev = await api('/api/normovani/sessions/' + state.session.id + '/events', {
        method: 'POST',
        body: JSON.stringify({
          event_type: eventType,
          fy_item_id: item.id,
          fy_goods_id: item.goods_id,
          item_code: item.code,
          item_name: item.name,
          item_unit: item.unit,
          quantity: item.quantity,
        }),
      });
      state.events.push(ev);
      renderItems();
      toast(eventType === 'start' ? '▶ ' + (item.code || item.name) : '■ ' + (item.code || item.name), 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function setupMeasure() {
    $('#item-search').addEventListener('input', renderItems);
    $('#item-scan-btn').addEventListener('click', async function () {
      const code = await scanQR('Naskenuj QR dílu');
      if (!code) return;
      const norm = String(code).trim().toUpperCase();
      const found = state.selectedOp.bomItems.find(function (it) {
        return (it.code && it.code.toUpperCase() === norm) ||
               (it.goods_id && String(it.goods_id) === String(code).trim());
      });
      if (found) {
        $('#item-search').value = found.code || found.name || '';
        renderItems();
        toast('Nalezeno: ' + (found.code || found.name), 'success');
      } else {
        toast('Tento díl není v BOM operace', 'error');
      }
    });
    $('#end-session-btn').addEventListener('click', endSession);
  }

  async function endSession() {
    if (!confirm('Opravdu ukončit měření této operace?')) return;
    try {
      await api('/api/normovani/sessions/' + state.session.id + '/end', { method: 'POST' });
      toast('Měření ukončeno', 'success');
      state.session = null;
      state.selectedOp = null;
      state.events = [];
      saveLS();
      goOperations();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Back button ───────────────────────────────────────────────
  function setupBack() {
    $('#back-btn').addEventListener('click', function () {
      const active = document.querySelector('.screen.active').id;
      if (active === 'screen-batch') {
        logoutAndReturn();
      } else if (active === 'screen-operations') {
        state.batch = null;
        saveLS();
        goBatch();
      } else if (active === 'screen-measure') {
        goOperations();
      }
    });
    $('#auth-login-btn').addEventListener('click', redirectToLogin);
  }

  function relabelLogoutButton() {
    const btn = $('#batch-back-btn');
    if (btn) btn.textContent = 'Odhlásit';
  }

  // ─── QR scanner ─────────────────────────────────────────────────
  let videoStream = null;
  let scanRaf = null;

  function scanQR(infoText) {
    return new Promise(async function (resolve) {
      $('#scanner-info').textContent = infoText;
      $('#scanner-overlay').classList.add('active');

      function close(val) {
        if (scanRaf) cancelAnimationFrame(scanRaf);
        scanRaf = null;
        if (videoStream) {
          videoStream.getTracks().forEach(function (t) { t.stop(); });
          videoStream = null;
        }
        $('#scanner-overlay').classList.remove('active');
        resolve(val);
      }

      $('#scanner-close-btn').onclick = function () { close(null); };

      if (!('BarcodeDetector' in window)) {
        close(prompt(infoText));
        return;
      }

      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, audio: false,
        });
        const video = $('#scanner-video');
        video.srcObject = videoStream;
        await video.play();

        const detector = new BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'],
        });
        async function tick() {
          if (!videoStream) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length > 0) { close(codes[0].rawValue); return; }
          } catch (_) {}
          scanRaf = requestAnimationFrame(tick);
        }
        tick();
      } catch (e) {
        toast('Nepodařilo se spustit kameru: ' + e.message, 'error');
        close(prompt(infoText));
      }
    });
  }

  // ─── Util ──────────────────────────────────────────────────────
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatQty(q) {
    if (q == null) return '';
    const n = Number(q);
    if (!Number.isFinite(n)) return String(q);
    return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  }
  function setLoading(screenId) {
    const s = $('#' + screenId);
    if (!s) return;
    if (s.querySelector('.spinner-overlay')) return;
    const sp = document.createElement('div');
    sp.className = 'spinner spinner-overlay';
    sp.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:500;';
    s.style.position = 'relative';
    s.appendChild(sp);
    setTimeout(function () { sp.remove(); }, 10000);
  }

  // ─── Resume po reloadu ──────────────────────────────────────────
  async function resumeIfPossible() {
    const ls = loadLS();
    if (!ls) return false;
    if (ls.session_id && ls.batch_id) {
      try {
        const session = await api('/api/normovani/sessions/' + ls.session_id);
        if (session && session.status === 'active') {
          const batch = await api('/api/normovani/fy/batch/' + ls.batch_id);
          state.batch = batch;
          state.selectedOp = batch.operations.find(function (o) {
            return String(o.id) === String(ls.op_id || session.fy_operation_id);
          });
          if (state.selectedOp) {
            state.session = session;
            state.events = session.events || [];
            goMeasure();
            toast('Pokračuji v měření', 'success');
            return true;
          }
        }
      } catch (_) {}
    }
    if (ls.batch_id) {
      try {
        const batch = await api('/api/normovani/fy/batch/' + ls.batch_id);
        state.batch = batch;
        goOperations();
        return true;
      } catch (_) {}
    }
    return false;
  }

  // ─── Init ───────────────────────────────────────────────────────
  async function init() {
    setupBatch();
    setupMeasure();
    setupBack();
    relabelLogoutButton();

    show('screen-identify', 'Normování', '1/4');
    const authed = await bootstrapAuth();
    if (!authed) return;

    const resumed = await resumeIfPossible();
    if (!resumed) goBatch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
