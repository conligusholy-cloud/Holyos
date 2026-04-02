/* ============================================
   factorify-api.js — Napojení na Factorify API
   Konfigurace se čte z .env souboru
   ============================================ */

// Cesty kde hledat .env soubor (zkouší postupně)
const ENV_PATHS = [
  '../../.env',       // kořen Výroba (vedle modules/)
  '../../../.env',    // nadřazená složka (mimo Výroba)
  './.env',           // aktuální složka
];

const FactorifyAPI = {

  // Stav
  connected: false,
  workstations: [],
  entities: [],
  loading: false,
  error: null,
  configLoaded: false,

  // Konfigurace (načtená z .env)
  config: {
    baseUrl: 'https://bs.factorify.cloud',
    proxyUrl: window.location.origin,  // CORS proxy
    useProxy: true,                      // true = volat přes proxy
    securityToken: '',
    workstationEntity: 'Stage',
    endpoints: {
      entities: '/api/metadata/entities',
      entityMeta: '/api/metadata/entity/',
      query: '/api/query/',
    },
    headers: {
      'Accept': 'application/json',
      'X-FySerialization': 'ui2',
    },
  },

  // Parsovat .env obsah
  parseEnv(text) {
    const result = {};
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq < 0) return;
      const key = line.substring(0, eq).trim();
      let val = line.substring(eq + 1).trim();
      // Odstranit uvozovky
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    });
    return result;
  },

  // Načíst .env — zkouší všechny cesty
  async loadEnv() {
    for (const path of ENV_PATHS) {
      try {
        const resp = await fetch(path, { cache: 'no-store' });
        if (resp.ok) {
          const text = await resp.text();
          const env = this.parseEnv(text);

          if (env.FACTORIFY_BASE_URL) this.config.baseUrl = env.FACTORIFY_BASE_URL;
          if (env.FACTORIFY_TOKEN) this.config.securityToken = env.FACTORIFY_TOKEN;
          if (env.FACTORIFY_ENTITY) this.config.workstationEntity = env.FACTORIFY_ENTITY;

          this.configLoaded = true;
          console.log('Factorify .env načten z:', path);
          return true;
        }
      } catch (e) {
        // Zkusit další cestu
      }
    }

    // Fallback: zkusit FACTORIFY_CONFIG z api-config.js (pokud existuje)
    if (typeof FACTORIFY_CONFIG !== 'undefined') {
      this.config.baseUrl = FACTORIFY_CONFIG.baseUrl || this.config.baseUrl;
      this.config.securityToken = FACTORIFY_CONFIG.securityToken || '';
      this.config.workstationEntity = FACTORIFY_CONFIG.workstationEntity || 'Stage';
      this.configLoaded = true;
      console.log('Factorify config z api-config.js');
      return true;
    }

    console.warn('Factorify .env nenalezen. Zkontrolujte cestu.');
    return false;
  },

  getConfig() {
    return this.config;
  },

  getHeaders() {
    const cfg = this.config;
    const headers = { ...cfg.headers };
    if (cfg.securityToken) {
      headers['Cookie'] = 'securityToken=' + cfg.securityToken;
    }
    return headers;
  },

  async fetchAPI(path, options = {}) {
    const cfg = this.config;
    if (!cfg.baseUrl) {
      throw new Error('Factorify API není nakonfigurováno');
    }

    const method = options.method || 'GET';
    const body = options.body || null;

    // Přes proxy — token posílá proxy server
    if (cfg.useProxy) {
      const url = cfg.proxyUrl + path;
      const fetchOpts = {
        method: method,
        headers: { 'Accept': 'application/json', 'X-FySerialization': 'ui2' },
      };
      if (body) {
        fetchOpts.headers['Content-Type'] = 'application/json';
        fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API chyba: ${resp.status} ${resp.statusText} — ${errText.substring(0, 200)}`);
      }
      return await resp.json();
    }

    // Přímé volání (vyžaduje CORS na serveru)
    if (!cfg.securityToken) {
      throw new Error('Chybí FACTORIFY_TOKEN v .env souboru');
    }
    const url = cfg.baseUrl + path;
    const fetchOpts = {
      method: method,
      headers: this.getHeaders(),
      credentials: 'include',
    };
    if (body) {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const resp = await fetch(url, fetchOpts);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`API chyba: ${resp.status} ${resp.statusText} — ${errText.substring(0, 200)}`);
    }

    return await resp.json();
  },

  async loadEntities() {
    const data = await this.fetchAPI(this.config.endpoints.entities);
    this.entities = Array.isArray(data) ? data : [];
    return this.entities;
  },

  async loadEntityMeta(entityName) {
    return await this.fetchAPI(this.config.endpoints.entityMeta + entityName);
  },

  async queryEntity(entityName, filter) {
    let path = this.config.endpoints.query + entityName;
    // Factorify vyžaduje POST s tělem pro query endpoint
    const body = filter || {};
    return await this.fetchAPI(path, { method: 'POST', body: body });
  },

  async loadWorkstations() {
    this.loading = true;
    this.error = null;
    updateFactorifyUI();

    try {
      // Nejdřív načíst .env pokud ještě nebylo
      if (!this.configLoaded) {
        await this.loadEnv();
      }

      const entityName = this.config.workstationEntity || 'Stage';
      let data = null;

      // POST /api/query/Stage s prázdným tělem — ověřeno přes test-endpoints
      console.log(`POST /api/query/${entityName} ...`);
      data = await this.queryEntity(entityName);

      console.log('API odpověď (ukázka):', JSON.stringify(data).substring(0, 500));

      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data && data.items) {
        items = data.items;
      } else if (data && data.records) {
        items = data.records;
      } else if (data && data.data) {
        items = data.data;
      } else if (data && data.rows) {
        items = data.rows;
      } else if (data && typeof data === 'object') {
        // Zkusit první pole v odpovědi
        for (const key of Object.keys(data)) {
          if (Array.isArray(data[key])) {
            items = data[key];
            console.log(`Data nalezena v klíči: "${key}"`);
            break;
          }
        }
      }

      if (items.length === 0 && data) {
        console.warn('Neznámá struktura odpovědi:', JSON.stringify(data).substring(0, 300));
      }

      this.workstations = items.map(item => ({
        id: item.id || item.ID || item.Id || item.name,
        name: item.label || item.name || item.Name || item.title || item.Title || ('Pracoviště ' + (item.id || item.ID || '')),
        code: item.code || item.Code || item.referenceName || item.ReferenceName || '',
        type: item.type || item.Type || '',
        active: item.active !== false && item.Active !== false && item.archived !== true,
        raw: item,
      }));

      this.workstations = this.workstations.filter(w => w.active);
      this.connected = true;
      this.loading = false;
      updateFactorifyUI();

      showToast(`Načteno ${this.workstations.length} pracovišť z Factorify`);
      return this.workstations;

    } catch (err) {
      this.error = err.message;
      this.loading = false;
      this.connected = false;
      updateFactorifyUI();
      showToast('Chyba: ' + err.message);
      throw err;
    }
  },

  async findWorkstationEntity() {
    try {
      const entities = await this.loadEntities();
      return entities.filter(e => {
        const name = (e.name || '').toLowerCase();
        const label = (e.label || '').toLowerCase();
        return name.includes('stage') || name.includes('work') || name.includes('machine')
          || label.includes('pracov') || label.includes('stroj') || label.includes('stage');
      });
    } catch (err) {
      console.error('findWorkstationEntity error:', err);
      return [];
    }
  },
};

// === WORKSTATION DIMENSIONS (uživatelem nastavené rozměry v metrech) ===
// Klíč: wsId → { w: metrů, h: metrů }
const wsDimensions = {};
let defaultWsSize = { w: 2, h: 2 };
// Množina povolených pracovišť (pokud prázdná — zobrazit vše)
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

// Aplikovat výchozí velikost na všechna nepoužitá pracoviště
function applyDefaultSize(w, h) {
  if (w != null) defaultWsSize.w = w;
  if (h != null) defaultWsSize.h = h;

  const usedIds = getUsedWsIds();
  FactorifyAPI.workstations.forEach(ws => {
    if (!usedIds.has(String(ws.id))) {
      wsDimensions[ws.id] = { w: defaultWsSize.w, h: defaultWsSize.h };
    }
  });
  updateFactorifyUI();
  if (typeof showToast === 'function') showToast(`Výchozí velikost: ${defaultWsSize.w}×${defaultWsSize.h} m`);
}

// Zjistit, která pracoviště jsou už na plátně
function getUsedWsIds() {
  const used = new Set();
  if (typeof state !== 'undefined' && state.objects) {
    state.objects.forEach(obj => {
      if (obj.factorifyId) used.add(String(obj.factorifyId));
    });
  }
  return used;
}

// Označit karty použitých pracovišť
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
    const total = FactorifyAPI.workstations.length;
    const used = usedIds.size;
    countEl.textContent = `(${used}/${total} umístěno)`;
  }
}

// Generuje SVG obdélník v měřítku do karty
function renderWsPreview(container, wMeters, hMeters) {
  const maxW = 120, maxH = 70;
  const scale = Math.min(maxW / wMeters, maxH / hMeters, 30); // max 30px/m
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

function updateFactorifyUI() {
  const panel = document.getElementById('factorify-panel');
  if (!panel) return;

  const countEl = document.getElementById('ws-count');
  const hasToken = FactorifyAPI.config.securityToken;
  const useProxy = FactorifyAPI.config.useProxy;

  if (FactorifyAPI.loading) {
    panel.innerHTML = `<div style="padding:20px;color:var(--text2);font-size:12px;">Načítám pracoviště...</div>`;
    return;
  }

  if (FactorifyAPI.error) {
    panel.innerHTML = `
      <div style="padding:12px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:11px;color:#ef4444;">${FactorifyAPI.error}</span>
        <button class="btn-small-tool" onclick="FactorifyAPI.loadWorkstations()">Zkusit znovu</button>
      </div>`;
    return;
  }

  if (!hasToken && !useProxy) {
    panel.innerHTML = `
      <div style="padding:12px;font-size:11px;color:var(--text2);">
        Vyplňte <b>FACTORIFY_TOKEN</b> v souboru <code style="color:#60a5fa;">.env</code>
      </div>`;
    return;
  }

  if (!FactorifyAPI.connected || FactorifyAPI.workstations.length === 0) {
    panel.innerHTML = `
      <div style="padding:12px;">
        <button class="btn btn-primary" onclick="FactorifyAPI.loadWorkstations()" style="font-size:12px;">
          Načíst pracoviště z Factorify
        </button>
      </div>`;
    return;
  }

  // Aktualizovat počet
  if (countEl) countEl.textContent = `(${FactorifyAPI.workstations.length})`;

  // Generovat karty pracovišť (filtrovat podle povolených)
  let html = '';
  const showAll = wsEnabledSet.size === 0;
  FactorifyAPI.workstations.filter(ws => showAll || wsEnabledSet.has(String(ws.id))).forEach(ws => {
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

  // Vykreslit SVG preview pro každou kartu
  panel.querySelectorAll('.ws-card').forEach(card => {
    const wsId = card.dataset.wsId;
    const dims = getWsDimensions(wsId);
    const preview = card.querySelector('.ws-card-preview');
    if (preview) renderWsPreview(preview, dims.w, dims.h);
  });

  // Označit použitá pracoviště
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
  if (!FactorifyAPI.workstations.length) {
    if (typeof showToast === 'function') showToast('Nejprve načtěte pracoviště z Factorify');
    return;
  }
  const dialog = document.getElementById('ws-config-dialog');
  if (!dialog) return;

  // Naplnit defaults
  document.getElementById('ws-cfg-default-w').value = defaultWsSize.w;
  document.getElementById('ws-cfg-default-h').value = defaultWsSize.h;

  // Naplnit tabulku
  const tbody = document.getElementById('ws-config-tbody');
  const usedIds = getUsedWsIds();
  let html = '';
  FactorifyAPI.workstations.forEach(ws => {
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
  // Uložit default
  defaultWsSize.w = parseFloat(document.getElementById('ws-cfg-default-w').value) || 2;
  defaultWsSize.h = parseFloat(document.getElementById('ws-cfg-default-h').value) || 2;

  // Uložit enabled set
  wsEnabledSet.clear();
  document.querySelectorAll('.ws-cfg-check').forEach(cb => {
    if (cb.checked) wsEnabledSet.add(cb.dataset.wsId);
  });

  // Uložit rozměry
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

  // Persist to file + localStorage
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
  updateFactorifyUI();
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

function promptFactorifyToken() {
  const token = prompt('Zadejte Factorify securityToken:');
  if (token) {
    FactorifyAPI.config.securityToken = token;
    FactorifyAPI.configLoaded = true;
    updateFactorifyUI();
  }
}

// Drag pracoviště z karty na plátno
function dragWorkstation(e, wsId) {
  // Zabránit opakovanému použití
  const usedIds = getUsedWsIds();
  if (usedIds.has(String(wsId))) {
    e.preventDefault();
    return;
  }
  const ws = FactorifyAPI.workstations.find(w => String(w.id) === String(wsId));
  if (!ws) return;
  const dims = getWsDimensions(wsId);
  e.dataTransfer.setData('text/plain', 'pracoviste');
  e.dataTransfer.setData('application/x-factorify-ws', JSON.stringify({ ...ws, w: dims.w, h: dims.h }));
  const ghost = document.getElementById('drag-ghost');
  if (ghost) {
    ghost.textContent = ws.name + ` (${dims.w}×${dims.h}m)`;
    ghost.style.display = 'block';
    e.dataTransfer.setDragImage(ghost, 40, 15);
    setTimeout(() => ghost.style.display = 'none', 0);
  }
}
