/* ============================================
   factorify-api.ts — Napojení na Factorify API
   Konfigurace se čte z .env souboru
   ============================================ */

import type { FactorifyWorkstation, WorkstationConfig } from '../../../shared/types.js';
import { showToast } from './renderer.js';

// Cesty kde hledat .env soubor (zkouší postupně)
const ENV_PATHS = [
  '../../.env',       // kořen Výroba (vedle modules/)
  '../../../.env',    // nadřazená složka (mimo Výroba)
  './.env',           // aktuální složka
];

export interface FactorifyConfig {
  baseUrl: string;
  proxyUrl: string;
  useProxy: boolean;
  securityToken: string;
  workstationEntity: string;
  endpoints: {
    entities: string;
    entityMeta: string;
    query: string;
  };
  headers: Record<string, string>;
}

export const FactorifyAPI = {
  connected: false,
  workstations: [] as FactorifyWorkstation[],
  entities: [] as any[],
  loading: false,
  error: null as string | null,
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
  } as FactorifyConfig,

  parseEnv(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq < 0) return;
      const key = line.substring(0, eq).trim();
      let val = line.substring(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    });
    return result;
  },

  async loadEnv(): Promise<boolean> {
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

    // Fallback
    if (typeof (window as any).FACTORIFY_CONFIG !== 'undefined') {
      const cfg = (window as any).FACTORIFY_CONFIG;
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

  getConfig(): FactorifyConfig {
    return this.config;
  },

  getHeaders(): Record<string, string> {
    const cfg = this.config;
    const headers = { ...cfg.headers };
    if (cfg.securityToken) {
      headers['Cookie'] = 'securityToken=' + cfg.securityToken;
    }
    return headers;
  },

  async fetchAPI(path: string, options: any = {}): Promise<any> {
    const cfg = this.config;
    if (!cfg.baseUrl) {
      throw new Error('Factorify API není nakonfigurováno');
    }

    const method = options.method || 'GET';
    const body = options.body || null;

    if (cfg.useProxy) {
      const url = cfg.proxyUrl + path;
      const fetchOpts: RequestInit = {
        method: method,
        headers: { 'Accept': 'application/json', 'X-FySerialization': 'ui2' },
      };
      if (body) {
        fetchOpts.headers = { ...(fetchOpts.headers as Record<string, string>), 'Content-Type': 'application/json' };
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
    const fetchOpts: RequestInit = {
      method: method,
      headers: this.getHeaders(),
      credentials: 'include',
    };
    if (body) {
      fetchOpts.headers = { ...(fetchOpts.headers as Record<string, string>), 'Content-Type': 'application/json' };
      fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const resp = await fetch(url, fetchOpts);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`API chyba: ${resp.status} ${resp.statusText} — ${errText.substring(0, 200)}`);
    }

    return await resp.json();
  },

  async loadEntities(): Promise<any[]> {
    const data = await this.fetchAPI(this.config.endpoints.entities);
    this.entities = Array.isArray(data) ? data : [];
    return this.entities;
  },

  async loadEntityMeta(entityName: string): Promise<any> {
    return await this.fetchAPI(this.config.endpoints.entityMeta + entityName);
  },

  async queryEntity(entityName: string, filter?: any): Promise<any> {
    const path = this.config.endpoints.query + entityName;
    const body = filter || {};
    return await this.fetchAPI(path, { method: 'POST', body: body });
  },

  async loadWorkstations(): Promise<FactorifyWorkstation[]> {
    this.loading = true;
    this.error = null;
    updateFactorifyUI();

    try {
      // Přepojeno z externí Factorify API na lokální HolyOS endpoint.
      // Data jdou z prisma.workstation (viz routes/production.routes.js).
      // JWT auth: browser pošle HttpOnly cookie díky credentials:'include'.
      const token = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('token')) || '';
      const headers: Record<string, string> = { 'Accept': 'application/json' };
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

      this.workstations = (Array.isArray(data) ? data : []).map((item: any) => ({
        id: item.id,
        name: item.name || ('Pracoviště ' + item.id),
        code: item.code || '',
        type: '',
        active: true,
        raw: item,
      }));

      this.connected = true;
      this.loading = false;
      updateFactorifyUI();

      showToast(`Načteno ${this.workstations.length} pracovišť`);
      return this.workstations;

    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.loading = false;
      this.connected = false;
      updateFactorifyUI();
      showToast('Chyba: ' + this.error);
      throw err;
    }
  },

  async findWorkstationEntity(): Promise<any[]> {
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

// === WORKSTATION DIMENSIONS ===

const wsDimensions: Record<string, WorkstationConfig> = {};
let defaultWsSize: WorkstationConfig = { w: 2, h: 2 };
const wsEnabledSet = new Set<string>();

export function getWsDimensions(wsId: string): WorkstationConfig {
  if (!wsDimensions[wsId]) {
    wsDimensions[wsId] = { w: defaultWsSize.w, h: defaultWsSize.h };
  }
  return wsDimensions[wsId];
}

export function setWsDimension(wsId: string, axis: 'w' | 'h', value: string): void {
  const dims = getWsDimensions(wsId);
  const v = parseFloat(value);
  if (!isNaN(v) && v > 0 && v <= 100) {
    dims[axis] = v;
    const preview = document.querySelector(`.ws-card[data-ws-id="${wsId}"] .ws-card-preview`);
    if (preview) renderWsPreview(preview as HTMLElement, dims.w, dims.h);
  }
}

export function applyDefaultSize(w?: number, h?: number): void {
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

export function getUsedWsIds(): Set<string> {
  const used = new Set<string>();
  if (typeof (window as any).state !== 'undefined' && (window as any).state.objects) {
    (window as any).state.objects.forEach((obj: any) => {
      if (obj.factorifyId) used.add(String(obj.factorifyId));
    });
  }
  return used;
}

export function markUsedWorkstations(): void {
  const usedIds = getUsedWsIds();
  document.querySelectorAll('.ws-card').forEach(card => {
    const wsId = (card as HTMLElement).dataset.wsId;
    if (usedIds.has(wsId || '')) {
      card.classList.add('on-canvas');
      (card as HTMLElement).setAttribute('draggable', 'false');
      (card as HTMLElement).removeAttribute('ondragstart');
    } else {
      card.classList.remove('on-canvas');
      (card as HTMLElement).setAttribute('draggable', 'true');
    }
  });
  const countEl = document.getElementById('ws-count');
  if (countEl) {
    const total = FactorifyAPI.workstations.length;
    const used = usedIds.size;
    countEl.textContent = `(${used}/${total} umístěno)`;
  }
}

export function renderWsPreview(container: HTMLElement, wMeters: number, hMeters: number): void {
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

export function updateFactorifyUI(): void {
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

  if (countEl) countEl.textContent = `(${FactorifyAPI.workstations.length})`;

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
    const wsId = (card as HTMLElement).dataset.wsId;
    if (!wsId) return;
    const dims = getWsDimensions(wsId);
    const preview = card.querySelector('.ws-card-preview');
    if (preview) renderWsPreview(preview as HTMLElement, dims.w, dims.h);
  });

  markUsedWorkstations();
}

export function filterWorkstationList(query: string): void {
  const q = (query || '').toLowerCase();
  document.querySelectorAll('.ws-card').forEach(card => {
    const name = ((card as HTMLElement).dataset.wsName || '').toLowerCase();
    const code = ((card as HTMLElement).dataset.wsCode || '').toLowerCase();
    (card as HTMLElement).style.display = (name.includes(q) || code.includes(q)) ? '' : 'none';
  });
}

export function dragWorkstation(e: DragEvent, wsId: string): void {
  const usedIds = getUsedWsIds();
  if (usedIds.has(String(wsId))) {
    e.preventDefault();
    return;
  }
  const ws = FactorifyAPI.workstations.find(w => String(w.id) === String(wsId));
  if (!ws) return;
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

export function openWsConfigDialog(): void {
  const dialog = document.getElementById('ws-config-dialog');
  if (!dialog) return;

  const tbody = document.getElementById('ws-config-tbody');
  if (!tbody) return;

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

export function closeWsConfigDialog(): void {
  const dialog = document.getElementById('ws-config-dialog');
  if (dialog) dialog.style.display = 'none';
}

export function saveWsConfig(): void {
  const wInputs = document.querySelectorAll('.ws-cfg-w');
  const hInputs = document.querySelectorAll('.ws-cfg-h');

  wInputs.forEach(input => {
    const wsId = (input as HTMLInputElement).dataset.wsId;
    const value = (input as HTMLInputElement).value;
    if (wsId && value) {
      setWsDimension(wsId, 'w', value);
    }
  });

  hInputs.forEach(input => {
    const wsId = (input as HTMLInputElement).dataset.wsId;
    const value = (input as HTMLInputElement).value;
    if (wsId && value) {
      setWsDimension(wsId, 'h', value);
    }
  });

  const defaultWInput = document.getElementById('ws-cfg-default-w') as HTMLInputElement | null;
  const defaultHInput = document.getElementById('ws-cfg-default-h') as HTMLInputElement | null;

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

export function wsConfigApplyDefaults(): void {
  const defaultWInput = document.getElementById('ws-cfg-default-w') as HTMLInputElement | null;
  const defaultHInput = document.getElementById('ws-cfg-default-h') as HTMLInputElement | null;

  if (!defaultWInput || !defaultHInput) return;

  const w = parseFloat(defaultWInput.value);
  const h = parseFloat(defaultHInput.value);
  if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
    applyDefaultSize(w, h);
  }
}

export function wsConfigToggleAll(checked: boolean): void {
  const checkboxes = document.querySelectorAll('.ws-cfg-checkbox:not(:disabled)');
  checkboxes.forEach(cb => {
    (cb as HTMLInputElement).checked = checked;
  });
}
