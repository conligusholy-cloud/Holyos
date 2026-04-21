/* ============================================
   factorify-api.ts — Napojení na Factorify API
   Konfigurace se čte z .env souboru
   ============================================ */
import { showToast } from './renderer.js';
// Cesty kde hledat .env soubor (zkouší postupně)
const ENV_PATHS = [
    '../../.env', // kořen Výroba (vedle modules/)
    '../../../.env', // nadřazená složka (mimo Výroba)
    './.env', // aktuální složka
];
export const FactorifyAPI = {
    connected: false,
    workstations: [],
    entities: [],
    loading: false,
    error: null,
    configLoaded: false,
    config: {
        baseUrl: 'https://bs.factorify.cloud',
        proxyUrl: window.location.origin,
        useProxy: true,
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
    parseEnv(text) {
        const result = {};
        text.split('\n').forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#'))
                return;
            const eq = line.indexOf('=');
            if (eq < 0)
                return;
            const key = line.substring(0, eq).trim();
            let val = line.substring(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            result[key] = val;
        });
        return result;
    },
    async loadEnv() {
        for (const path of ENV_PATHS) {
            try {
                const resp = await fetch(path, { cache: 'no-store' });
                if (resp.ok) {
                    const text = await resp.text();
                    const env = this.parseEnv(text);
                    if (env.FACTORIFY_BASE_URL)
                        this.config.baseUrl = env.FACTORIFY_BASE_URL;
                    if (env.FACTORIFY_TOKEN)
                        this.config.securityToken = env.FACTORIFY_TOKEN;
                    if (env.FACTORIFY_ENTITY)
                        this.config.workstationEntity = env.FACTORIFY_ENTITY;
                    this.configLoaded = true;
                    console.log('Factorify .env načten z:', path);
                    return true;
                }
            }
            catch (e) {
                // Zkusit další cestu
            }
        }
        // Fallback
        if (typeof window.FACTORIFY_CONFIG !== 'undefined') {
            const cfg = window.FACTORIFY_CONFIG;
            this.config.baseUrl = cfg.baseUrl || this.config.baseUrl;
            this.config.securityToken = cfg.securityToken || '';
            this.config.workstationEntity = cfg.workstationEntity || 'Stage';
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
        if (cfg.useProxy) {
            const url = cfg.proxyUrl + path;
            const fetchOpts = {
                method: method,
                headers: { 'Accept': 'application/json', 'X-FySerialization': 'ui2' },
            };
            if (body) {
                fetchOpts.headers = { ...fetchOpts.headers, 'Content-Type': 'application/json' };
                fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
            }
            const resp = await fetch(url, fetchOpts);
            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                throw new Error(`API chyba: ${resp.status} ${resp.statusText} — ${errText.substring(0, 200)}`);
            }
            return await resp.json();
        }
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
            fetchOpts.headers = { ...fetchOpts.headers, 'Content-Type': 'application/json' };
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
        const path = this.config.endpoints.query + entityName;
        const body = filter || {};
        return await this.fetchAPI(path, { method: 'POST', body: body });
    },
    async loadWorkstations() {
        this.loading = true;
        this.error = null;
        updateFactorifyUI();
        try {
            // Přepojeno z externí Factorify API na lokální HolyOS endpoint.
            // Data jdou z prisma.workstation (viz routes/production.routes.js).
            const token = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('token')) || '';
            const headers = { 'Accept': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            console.log('GET /api/production/workstations ...');
            const resp = await fetch('/api/production/workstations', {
                credentials: 'include',
                headers,
            });
            if (!resp.ok) {
                const txt = await resp.text().catch(() => '');
                throw new Error(`API ${resp.status}: ${txt.substring(0, 200)}`);
            }
            const data = await resp.json();
            this.workstations = (Array.isArray(data) ? data : []).map((item) => ({
                id: item.id,
                name: item.name || ('Pracoviště ' + item.id),
                code: item.code || '',
                width_m: item.width_m != null ? parseFloat(item.width_m) : null,
                length_m: item.length_m != null ? parseFloat(item.length_m) : null,
                type: '',
                active: true,
                raw: item,
            }));
            this.connected = true;
            this.loading = false;
            updateFactorifyUI();
            showToast(`Načteno ${this.workstations.length} pracovišť`);
            return this.workstations;
        }
        catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
            this.loading = false;
            this.connected = false;
            updateFactorifyUI();
            showToast('Chyba: ' + this.error);
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
        }
        catch (err) {
            console.error('findWorkstationEntity error:', err);
            return [];
        }
    },
};
// === WORKSTATION DIMENSIONS ===
const wsDimensions = {};
let defaultWsSize = { w: 2, h: 2 };
const wsEnabledSet = new Set();
export function getWsDimensions(wsId) {
    const ws = FactorifyAPI.workstations.find(w => String(w.id) === wsId);
    if (ws && ws.width_m != null && ws.length_m != null) {
        return { w: parseFloat(ws.width_m), h: parseFloat(ws.length_m) };
    }
    if (!wsDimensions[wsId]) {
        wsDimensions[wsId] = { w: defaultWsSize.w, h: defaultWsSize.h };
    }
    return wsDimensions[wsId];
}
export function setWsDimension(wsId, axis, value) {
    const dims = getWsDimensions(wsId);
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0 && v <= 100) {
        dims[axis] = v;
        const preview = document.querySelector(`.ws-card[data-ws-id="${wsId}"] .ws-card-preview`);
        if (preview)
            renderWsPreview(preview, dims.w, dims.h);
    }
}
export function applyDefaultSize(w, h) {
    if (w != null)
        defaultWsSize.w = w;
    if (h != null)
        defaultWsSize.h = h;
    const usedIds = getUsedWsIds();
    FactorifyAPI.workstations.forEach(ws => {
        if (!usedIds.has(String(ws.id))) {
            wsDimensions[ws.id] = { w: defaultWsSize.w, h: defaultWsSize.h };
        }
    });
    updateFactorifyUI();
    if (typeof showToast === 'function')
        showToast(`Výchozí velikost: ${defaultWsSize.w}×${defaultWsSize.h} m`);
}
export function getUsedWsIds() {
    const used = new Set();
    if (typeof window.state !== 'undefined' && window.state.objects) {
        window.state.objects.forEach((obj) => {
            if (obj.factorifyId)
                used.add(String(obj.factorifyId));
        });
    }
    return used;
}
export function markUsedWorkstations() {
    const usedIds = getUsedWsIds();
    document.querySelectorAll('.ws-card').forEach(card => {
        const wsId = card.dataset.wsId;
        if (usedIds.has(wsId || '')) {
            card.classList.add('on-canvas');
            card.setAttribute('draggable', 'false');
            card.removeAttribute('ondragstart');
        }
        else {
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
export function renderWsPreview(container, wMeters, hMeters) {
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
      <text x="${maxW / 2}" y="${maxH / 2}" text-anchor="middle" dominant-baseline="central"
        fill="rgba(255,255,255,0.5)" font-size="9" font-family="Segoe UI, sans-serif">
        ${wMeters}×${hMeters} m
      </text>
    </svg>`;
}
// === UI UPDATE ===
export function updateFactorifyUI() {
    const panel = document.getElementById('factorify-panel');
    if (!panel)
        return;
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
        <button class="btn-small-tool" onclick="window.__module__.FactorifyAPI.loadWorkstations()">Zkusit znovu</button>
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
        <button class="btn btn-primary" onclick="window.__module__.FactorifyAPI.loadWorkstations()" style="font-size:12px;">
          Načíst pracoviště z Factorify
        </button>
      </div>`;
        return;
    }
    if (countEl)
        countEl.textContent = `(${FactorifyAPI.workstations.length})`;
    let html = '';
    const showAll = wsEnabledSet.size === 0;
    FactorifyAPI.workstations.filter(ws => showAll || wsEnabledSet.has(String(ws.id))).forEach(ws => {
        const dims = getWsDimensions(String(ws.id));
        html += `
      <div class="ws-card" draggable="true"
        data-ws-id="${ws.id}" data-ws-name="${ws.name}" data-ws-code="${ws.code || ''}"
        ondragstart="window.__module__.dragWorkstation(event, '${ws.id}')"
        title="${ws.code ? ws.code + ' — ' : ''}${ws.name}">
        <div class="ws-card-preview"></div>
        <div class="ws-card-info">
          <div class="ws-card-name">${ws.name}</div>
          <div class="ws-card-dims">
            <input type="number" value="${dims.w}" min="0.5" max="50" step="0.5"
              onclick="event.stopPropagation()" ondragstart="event.stopPropagation()"
              onchange="window.__module__.setWsDimension('${ws.id}','w',this.value)" title="Šířka (m)">
            <span>×</span>
            <input type="number" value="${dims.h}" min="0.5" max="50" step="0.5"
              onclick="event.stopPropagation()" ondragstart="event.stopPropagation()"
              onchange="window.__module__.setWsDimension('${ws.id}','h',this.value)" title="Výška (m)">
            <span>m</span>
          </div>
        </div>
      </div>`;
    });
    panel.innerHTML = html;
    panel.querySelectorAll('.ws-card').forEach(card => {
        const wsId = card.dataset.wsId;
        if (!wsId)
            return;
        const dims = getWsDimensions(wsId);
        const preview = card.querySelector('.ws-card-preview');
        if (preview)
            renderWsPreview(preview, dims.w, dims.h);
    });
    markUsedWorkstations();
}
export function filterWorkstationList(query) {
    const q = (query || '').toLowerCase();
    document.querySelectorAll('.ws-card').forEach(card => {
        const name = (card.dataset.wsName || '').toLowerCase();
        const code = (card.dataset.wsCode || '').toLowerCase();
        card.style.display = (name.includes(q) || code.includes(q)) ? '' : 'none';
    });
}
export function dragWorkstation(e, wsId) {
    const usedIds = getUsedWsIds();
    if (usedIds.has(String(wsId))) {
        e.preventDefault();
        return;
    }
    const ws = FactorifyAPI.workstations.find(w => String(w.id) === String(wsId));
    if (!ws)
        return;
    const dims = getWsDimensions(wsId);
    if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', 'pracoviste');
        e.dataTransfer.setData('application/x-factorify-ws', JSON.stringify({ ...ws, w: dims.w, h: dims.h }));
        const ghost = document.getElementById('drag-ghost');
        if (ghost) {
            ghost.textContent = ws.name + ` (${dims.w}×${dims.h}m)`;
            ghost.style.display = 'block';
            if (e.dataTransfer.setDragImage) {
                e.dataTransfer.setDragImage(ghost, 40, 15);
            }
            setTimeout(() => ghost.style.display = 'none', 0);
        }
    }
}
// === WORKSTATION CONFIG DIALOG ===
export function openWsConfigDialog() {
    const dialog = document.getElementById('ws-config-dialog');
    if (!dialog)
        return;
    const tbody = document.getElementById('ws-config-tbody');
    if (!tbody)
        return;
    tbody.innerHTML = '';
    const usedIds = getUsedWsIds();
    FactorifyAPI.workstations.forEach(ws => {
        const dims = getWsDimensions(String(ws.id));
        const isUsed = usedIds.has(String(ws.id));
    const isEnabled = wsEnabledSet.size === 0 || wsEnabledSet.has(String(ws.id));
        const row = document.createElement('tr');
        row.innerHTML = `
      <td><input type="checkbox" class="ws-cfg-checkbox" data-ws-id="${ws.id}" ${isUsed ? 'checked disabled' : (isEnabled ? 'checked' : '')}></td>
      <td>${ws.name}</td>
      <td style="color:var(--text2);font-size:11px;">${ws.code || '-'}</td>
      <td style="color:var(--text2);font-size:12px;">${ws.width_m != null ? ws.width_m : '—'} m</td>
      <td style="color:var(--text2);font-size:12px;">${ws.length_m != null ? ws.length_m : '—'} m</td>
      <td style="color:${isUsed ? 'var(--accent2)' : 'var(--text2)'}; font-size:11px;">${isUsed ? '✓ Umístěno' : '-'}</td>
    `;
        tbody.appendChild(row);
    });
    dialog.style.display = 'flex';
}
export function closeWsConfigDialog() {
    const dialog = document.getElementById('ws-config-dialog');
    if (dialog)
        dialog.style.display = 'none';
}
export function saveWsConfig() {
    const checkboxes = document.querySelectorAll('.ws-cfg-checkbox');
    const totalCount = checkboxes.length;
    let checkedCount = 0;
    const newEnabledIds = [];
    checkboxes.forEach(cb => {
        const wsId = cb.dataset.wsId || '';
        if (cb.checked) {
            checkedCount++;
            if (wsId) newEnabledIds.push(wsId);
        }
    });
    wsEnabledSet.clear();
    if (checkedCount > 0 && checkedCount < totalCount) {
        for (const id of newEnabledIds) wsEnabledSet.add(id);
    }
    closeWsConfigDialog();
    updateFactorifyUI();
    showToast('Konfigurace pracovišť uložena');
}
export function wsConfigApplyDefaults() {
    const defaultWInput = document.getElementById('ws-cfg-default-w');
    const defaultHInput = document.getElementById('ws-cfg-default-h');
    if (!defaultWInput || !defaultHInput)
        return;
    const w = parseFloat(defaultWInput.value);
    const h = parseFloat(defaultHInput.value);
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
        applyDefaultSize(w, h);
    }
}
export function wsConfigToggleAll(checked) {
    const checkboxes = document.querySelectorAll('.ws-cfg-checkbox:not(:disabled)');
    checkboxes.forEach(cb => {
        cb.checked = checked;
    });
}
//# sourceMappingURL=factorify-api.js.map