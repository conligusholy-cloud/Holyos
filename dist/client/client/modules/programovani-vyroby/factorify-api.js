/* ============================================
   factorify-api.js — Programování výroby
   Přepojeno na vlastní HolyOS API (Fáze 3)
   ============================================ */
import { showToast } from './renderer.js';
export const FactorifyAPI = {
    connected: false,
    workstations: [],
    loading: false,
    error: null,
    configLoaded: true,
    config: {
        useProxy: true,
        securityToken: 'local',
    },
    async loadEnv() {
        this.configLoaded = true;
        return true;
    },
    getConfig() { return this.config; },
    async fetchAPI(path) {
        const resp = await fetch(path, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
        }
        return await resp.json();
    },
    async loadWorkstations() {
        this.loading = true;
        this.error = null;
        updateFactorifyUI();
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
};
// === WORKSTATION DIMENSIONS ===
const wsDimensions = {};
let defaultWsSize = { w: 2, h: 2 };
const wsEnabledSet = new Set();
export function getWsDimensions(wsId) {
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
        const row = document.createElement('tr');
        row.innerHTML = `
      <td><input type="checkbox" class="ws-cfg-checkbox" data-ws-id="${ws.id}" ${isUsed ? 'checked disabled' : ''}></td>
      <td>${ws.name}</td>
      <td style="color:var(--text2);font-size:11px;">${ws.code || '-'}</td>
      <td><input type="number" class="ws-cfg-w" data-ws-id="${ws.id}" value="${dims.w}" min="0.5" max="50" step="0.5" style="width:60px;"></td>
      <td><input type="number" class="ws-cfg-h" data-ws-id="${ws.id}" value="${dims.h}" min="0.5" max="50" step="0.5" style="width:60px;"></td>
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
    const wInputs = document.querySelectorAll('.ws-cfg-w');
    const hInputs = document.querySelectorAll('.ws-cfg-h');
    wInputs.forEach(input => {
        const wsId = input.dataset.wsId;
        const value = input.value;
        if (wsId && value) {
            setWsDimension(wsId, 'w', value);
        }
    });
    hInputs.forEach(input => {
        const wsId = input.dataset.wsId;
        const value = input.value;
        if (wsId && value) {
            setWsDimension(wsId, 'h', value);
        }
    });
    const defaultWInput = document.getElementById('ws-cfg-default-w');
    const defaultHInput = document.getElementById('ws-cfg-default-h');
    if (defaultWInput && defaultHInput) {
        const w = parseFloat(defaultWInput.value);
        const h = parseFloat(defaultHInput.value);
        if (!isNaN(w) && !isNaN(h)) {
            applyDefaultSize(w, h);
        }
    }
    closeWsConfigDialog();
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