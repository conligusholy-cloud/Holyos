/* ============================================
   production-api.js — Programování výroby
   Přepojeno na vlastní HolyOS API (Fáze 3)
   ============================================ */

const ProductionAPI = {

  // Stav
  connected: false,
  workstations: [],
  loading: false,
  error: null,
  configLoaded: true,

  config: {
    useProxy: true,
    securityToken: 'local',
  },

  // loadEnv — není potřeba, data jdou z vlastní DB
  async loadEnv() {
    this.configLoaded = true;
    return true;
  },

  getConfig() { return this.config; },

  async fetchAPI(path) {
    // credentials: 'include' → prohlížeč pošle HttpOnly JWT cookie. Bez toho
    // API vrátí 401 a loadWorkstations skončí s prázdným polem (typický
    // příznak: "Programování výroby nevidí žádná pracoviště"). Pro jistotu
    // přidáváme taky Authorization header ze sessionStorage, pokud tam je.
    const token = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('token')) || '';
    const headers = { 'Accept': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch(path, { credentials: 'include', headers });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
    }
    return await resp.json();
  },

  async loadWorkstations() {
    this.loading = true;
    this.error = null;
    updateProductionUI();

    try {
      console.log('GET /api/production/workstations ...');
      const data = await this.fetchAPI('/api/production/workstations');

      this.workstations = data.map(ws => ({
        id: ws.id,
        name: ws.name || ('Pracoviště ' + ws.id),
        code: ws.code || '',
        type: '',
        active: true,
        raw: ws,
      }));

      this.connected = true;
      this.loading = false;
      updateProductionUI();

      showToast(`Načteno ${this.workstations.length} pracovišť`);
      return this.workstations;

    } catch (err) {
      this.error = err.message;
      this.loading = false;
      this.connected = false;
      updateProductionUI();
      showToast('Chyba: ' + err.message);
      throw err;
    }
  },
};

// === WORKSTATION DIMENSIONS (uživatelem nastavené rozměry v metrech) ===
const wsDimensions = {};
let defaultWsSize = { w: 2, h: 2 };
const wsEnabledSet = new Set();

function getWsDimensions(wsId) {
  if (!wsDimensions[wsId]) {
    wsDimensions[wsId] = { w: defaultWsSize.w, h: defaultWsSize.h };
  }
  return wsDimensions[wsId];
}

function setWsDimension(wsId, axis, value) {
  const dims = getWsDimensions(wsId);
  const v = parseFloat(value);
  if (!isNaN(v) && v > 0 && v <= 100) {
    dims[axis] = v;
    const preview = document.querySelector(`.ws-card[data-ws-id="${wsId}"] .ws-card-preview`);
    if (preview) renderWsPreview(preview, dims.w, dims.h);
  }
}

function applyDefaultSize(w, h) {
  if (w != null) defaultWsSize.w = w;
  if (h != null) defaultWsSize.h = h;

  const usedIds = getUsedWsIds();
  ProductionAPI.workstations.forEach(ws => {
    if (!usedIds.has(String(ws.id))) {
      wsDimensions[ws.id] = { w: defaultWsSize.w, h: defaultWsSize.h };
    }
  });
  updateProductionUI();
  if (typeof showToast === 'function') showToast(`Výchozí velikost: ${defaultWsSize.w}×${defaultWsSize.h} m`);
}

function getUsedWsIds() {
  const used = new Set();
  if (typeof state !== 'undefined' && state.objects) {
    state.objects.forEach(obj => {
      if (obj.workstationId) used.add(String(obj.workstationId));
    });
  }
  return used;
}

function markUsedWorkstations() {
  const usedIds = getUsedWsIds();
  document.querySelectorAll('.ws-card').forEach(card => {
    const wsId = card.dataset.wsId;
    if (usedIds.has(wsId)) {
      card.classList.add('on-canvas');
      card.setAttribute('draggable', 'false');
      card.removeAttribute('ondragstart');
    } else {
      card.classList.remove('on-canvas');
      card.setAttribute('draggable', 'true');
    }
  });
  const countEl = document.getElementById('ws-count');
  if (countEl) {
    const total = ProductionAPI.workstations.length;
    const used = usedIds.size;
    countEl.textContent = `(${used}/${total} umístěno)`;
  }
}

function renderWsPreview(container, wMeters, hMeters) {
  const maxW = 120, maxH = 70;
  const scale = Math.min(maxW / wMeters, maxH / hMeters, 30);
  const pw = wMeters * scale;
  const ph = hMeters * scale;
  const ox = (maxW - pw) / 2;
  const oy = (maxH - ph) / 2;
  container.innerHTML = `
    <svg width="${maxW}" height="${maxH}" viewBox="0 0 ${maxW} ${maxH}">
      <rect x="${ox}" y="${oy}" width="${pw}" height="${ph}"
        fill="rgba(245,158,11,0.15)" stroke="#f59e0b" stroke-width="1.5" rx="2"/>
      <text x="${maxW/2}" y="${maxH/2}" text-anchor="middle" dominant-baseline="central"
        fill="rgba(255,255,255,0.5)" font-size="9" font-family="Segoe UI, sans-serif">
        ${wMeters}×${hMeters} m
      </text>
    </svg>`;
}

// === UI UPDATE ===

function updateProductionUI() {
  const panel = document.getElementById('production-panel');
  if (!panel) return;

  const countEl = document.getElementById('ws-count');

  if (ProductionAPI.loading) {
    panel.innerHTML = `<div style="padding:20px;color:var(--text2);font-size:12px;">Načítám pracoviště...</div>`;
    return;
  }

  if (ProductionAPI.error) {
    panel.innerHTML = `
      <div style="padding:12px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:11px;color:#ef4444;">${ProductionAPI.error}</span>
        <button class="btn-small-tool" onclick="ProductionAPI.loadWorkstations()">Zkusit znovu</button>
      </div>`;
    return;
  }

  if (!ProductionAPI.connected || ProductionAPI.workstations.length === 0) {
    panel.innerHTML = `
      <div style="padding:12px;">
        <button class="btn btn-primary" onclick="ProductionAPI.loadWorkstations()" style="font-size:12px;">
          Načíst pracoviště
        </button>
      </div>`;
    return;
  }

  if (countEl) countEl.textContent = `(${ProductionAPI.workstations.length})`;

  let html = '';
  const showAll = wsEnabledSet.size === 0;
  ProductionAPI.workstations.filter(ws => showAll || wsEnabledSet.has(String(ws.id))).forEach(ws => {
    const dims = getWsDimensions(ws.id);
    html += `
      <div class="ws-card" draggable="true"
        data-ws-id="${ws.id}" data-ws-name="${ws.name}" data-ws-code="${ws.code || ''}"
        ondragstart="dragWorkstation(event, '${ws.id}')"
        title="${ws.code ? ws.code + ' — ' : ''}${ws.name}">
        <div class="ws-card-preview"></div>
        <div class="ws-card-info">
          <div class="ws-card-name">${ws.name}</div>
          <div class="ws-card-dims">
            <input type="number" value="${dims.w}" min="0.5" max="50" step="0.5"
              onclick="event.stopPropagation()" ondragstart="event.stopPropagation()"
              onchange="setWsDimension('${ws.id}','w',this.value)" title="Šířka (m)">
            <span>×</span>
            <input type="number" value="${dims.h}" min="0.5" max="50" step="0.5"
              onclick="event.stopPropagation()" ondragstart="event.stopPropagation()"
              onchange="setWsDimension('${ws.id}','h',this.value)" title="Výška (m)">
            <span>m</span>
          </div>
        </div>
      </div>`;
  });

  panel.innerHTML = html;

  panel.querySelectorAll('.ws-card').forEach(card => {
    const wsId = card.dataset.wsId;
    const dims = getWsDimensions(wsId);
    const preview = card.querySelector('.ws-card-preview');
    if (preview) renderWsPreview(preview, dims.w, dims.h);
  });

  markUsedWorkstations();
}

function filterWorkstationList(query) {
  const q = (query || '').toLowerCase();
  document.querySelectorAll('.ws-card').forEach(card => {
    const name = (card.dataset.wsName || '').toLowerCase();
    const code = (card.dataset.wsCode || '').toLowerCase();
    card.style.display = (name.includes(q) || code.includes(q)) ? '' : 'none';
  });
}

// === WORKSTATION CONFIG DIALOG ===

function openWsConfigDialog() {
  if (!ProductionAPI.workstations.length) {
    if (typeof showToast === 'function') showToast('Nejprve načtěte pracoviště');
    return;
  }
  const dialog = document.getElementById('ws-config-dialog');
  if (!dialog) return;

  document.getElementById('ws-cfg-default-w').value = defaultWsSize.w;
  document.getElementById('ws-cfg-default-h').value = defaultWsSize.h;

  const tbody = document.getElementById('ws-config-tbody');
  const usedIds = getUsedWsIds();
  let html = '';
  ProductionAPI.workstations.forEach(ws => {
    const dims = getWsDimensions(ws.id);
    const isUsed = usedIds.has(String(ws.id));
    const isEnabled = wsEnabledSet.size === 0 || wsEnabledSet.has(String(ws.id));
    html += `<tr data-ws-id="${ws.id}">
      <td><input type="checkbox" class="ws-cfg-check" data-ws-id="${ws.id}" ${isEnabled ? 'checked' : ''} ${isUsed ? 'disabled title="Již na plátně"' : ''}></td>
      <td class="ws-cfg-name">${ws.name}</td>
      <td class="ws-cfg-code">${ws.code || '—'}</td>
      <td><input type="number" class="ws-cfg-w" data-ws-id="${ws.id}" value="${dims.w}" min="0.5" max="50" step="0.5"></td>
      <td><input type="number" class="ws-cfg-h" data-ws-id="${ws.id}" value="${dims.h}" min="0.5" max="50" step="0.5"></td>
      <td style="font-size:11px;color:${isUsed ? '#f59e0b' : '#10b981'};">${isUsed ? 'Na plátně' : 'Volné'}</td>
    </tr>`;
  });
  tbody.innerHTML = html;

  dialog.style.display = 'flex';
}

function closeWsConfigDialog() {
  const dialog = document.getElementById('ws-config-dialog');
  if (dialog) dialog.style.display = 'none';
}

function wsConfigToggleAll(checked) {
  document.querySelectorAll('.ws-cfg-check:not(:disabled)').forEach(cb => {
    cb.checked = checked;
  });
}

function wsConfigApplyDefaults() {
  const w = parseFloat(document.getElementById('ws-cfg-default-w').value) || 2;
  const h = parseFloat(document.getElementById('ws-cfg-default-h').value) || 2;
  document.querySelectorAll('.ws-cfg-w').forEach(inp => { inp.value = w; });
  document.querySelectorAll('.ws-cfg-h').forEach(inp => { inp.value = h; });
}

function saveWsConfig() {
  defaultWsSize.w = parseFloat(document.getElementById('ws-cfg-default-w').value) || 2;
  defaultWsSize.h = parseFloat(document.getElementById('ws-cfg-default-h').value) || 2;

  wsEnabledSet.clear();
  document.querySelectorAll('.ws-cfg-check').forEach(cb => {
    if (cb.checked) wsEnabledSet.add(cb.dataset.wsId);
  });

  document.querySelectorAll('.ws-cfg-w').forEach(inp => {
    const wsId = inp.dataset.wsId;
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) {
      const dims = getWsDimensions(wsId);
      dims.w = v;
    }
  });
  document.querySelectorAll('.ws-cfg-h').forEach(inp => {
    const wsId = inp.dataset.wsId;
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) {
      const dims = getWsDimensions(wsId);
      dims.h = v;
    }
  });

  const cfgData = {
    defaultWsSize: { ...defaultWsSize },
    enabledIds: Array.from(wsEnabledSet),
    dimensions: { ...wsDimensions },
  };
  try {
    if (typeof PersistentStorage !== 'undefined') {
      PersistentStorage.setItem('vyroba_ws_config', JSON.stringify(cfgData));
    } else {
      localStorage.setItem('vyroba_ws_config', JSON.stringify(cfgData));
    }
  } catch (e) { /* ignore */ }

  closeWsConfigDialog();
  updateProductionUI();
  if (typeof showToast === 'function') showToast('Konfigurace pracovišť uložena');
}

function loadWsConfig() {
  try {
    const raw = (typeof PersistentStorage !== 'undefined')
      ? PersistentStorage.getItemSync('vyroba_ws_config')
      : localStorage.getItem('vyroba_ws_config');
    if (!raw) return;
    const cfg = JSON.parse(raw);
    if (cfg.defaultWsSize) {
      defaultWsSize.w = cfg.defaultWsSize.w || 2;
      defaultWsSize.h = cfg.defaultWsSize.h || 2;
    }
    if (cfg.enabledIds && Array.isArray(cfg.enabledIds)) {
      wsEnabledSet.clear();
      cfg.enabledIds.forEach(id => wsEnabledSet.add(String(id)));
    }
    if (cfg.dimensions) {
      Object.keys(cfg.dimensions).forEach(wsId => {
        wsDimensions[wsId] = { ...cfg.dimensions[wsId] };
      });
    }
  } catch (e) { /* ignore */ }
}

function dragWorkstation(e, wsId) {
  const usedIds = getUsedWsIds();
  if (usedIds.has(String(wsId))) {
    e.preventDefault();
    return;
  }
  const ws = ProductionAPI.workstations.find(w => String(w.id) === String(wsId));
  if (!ws) return;
  const dims = getWsDimensions(wsId);
  e.dataTransfer.setData('text/plain', 'pracoviste');
  e.dataTransfer.setData('application/x-production-ws', JSON.stringify({ ...ws, w: dims.w, h: dims.h }));
  const ghost = document.getElementById('drag-ghost');
  if (ghost) {
    ghost.textContent = ws.name + ` (${dims.w}×${dims.h}m)`;
    ghost.style.display = 'block';
    e.dataTransfer.setDragImage(ghost, 40, 15);
    setTimeout(() => ghost.style.display = 'none', 0);
  }
}
