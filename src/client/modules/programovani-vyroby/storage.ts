/* ============================================
   storage.ts — Uložení/načtení (Programování výroby)
   ============================================ */

import type { ProgrammingProject, DrawingObject, SavedSimulation } from '../../../shared/types.js';
import { PersistentStorage } from '../../js/persistent-storage.js';
import { state } from './state.js';
import { renderAll, showToast, resizeSVG, updateTransform } from './renderer.js';
import { deselectAll } from './objects.js';
import { markUsedWorkstations, updateFactorifyUI } from './factorify-api.js';

const AREAL_STORAGE_KEY = 'vyroba_simulations';
const PROG_STORAGE_KEY = 'vyroba_programovani';

// ---- Areály (read-only) ----

export function getAllAreals(): SavedSimulation[] {
  try {
    const raw = PersistentStorage.getItemSync(AREAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

export function loadArealById(arealId: string | null): boolean {
  if (!arealId) return false;
  const areals = getAllAreals();
  const areal = areals.find(s => s.id === arealId);
  if (!areal) {
    console.warn('Areál nenalezen:', arealId);
    return false;
  }
  state.arealId = areal.id;
  state.arealName = areal.name;
  state.arealObjects = JSON.parse(JSON.stringify(areal.objects || []));
  return true;
}

// ---- Programování (editovatelné) ----

export function getAllProgramming(): ProgrammingProject[] {
  try {
    const raw = PersistentStorage.getItemSync(PROG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

export function saveAllProgramming(progs: ProgrammingProject[]): void {
  PersistentStorage.setItem(PROG_STORAGE_KEY, JSON.stringify(progs));
}

// ---- Inicializace persistentního úložiště ----

export async function initPersistentStorage(): Promise<void> {
  await PersistentStorage.migrateFromLocalStorage([AREAL_STORAGE_KEY, PROG_STORAGE_KEY]);
  await PersistentStorage.init([AREAL_STORAGE_KEY, PROG_STORAGE_KEY]);
}

export function getAllSimulations(): ProgrammingProject[] {
  return getAllProgramming();
}

export function saveAllSimulations(progs: ProgrammingProject[]): void {
  saveAllProgramming(progs);
}

// ---- Uložit aktuální projekt ----

export function saveProject(): void {
  if (state.currentSimId && state.currentSimName) {
    doSaveProject(state.currentSimName, state.currentSimId);
    return;
  }
  showSaveDialog();
}

export function saveProjectAs(): void {
  showSaveDialog();
}

export function doSaveProject(name: string, simId: string | null): void {
  const wsConfig: any = {};
  if (typeof (window as any).wsDimensions !== 'undefined') {
    wsConfig.dimensions = JSON.parse(JSON.stringify((window as any).wsDimensions));
  }
  if (typeof (window as any).defaultWsSize !== 'undefined') {
    wsConfig.defaultWsSize = { ...(window as any).defaultWsSize };
  }
  if (typeof (window as any).wsEnabledSet !== 'undefined' && (window as any).wsEnabledSet.size > 0) {
    wsConfig.enabledIds = Array.from((window as any).wsEnabledSet);
  }

  const data: ProgrammingProject = {
    id: simId || ('prog_' + Date.now()),
    name: name || 'Bez názvu',
    version: 1,
    arealId: state.arealId || '',
    arealName: state.arealName,
    objects: JSON.parse(JSON.stringify(state.objects)),
    connections: JSON.parse(JSON.stringify(state.connections)),
    nextId: state.nextId,
    viewport: { zoom: state.zoom, panX: state.panX, panY: state.panY },
    wsConfig: wsConfig,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const progs = getAllProgramming();
  const existingIdx = progs.findIndex(s => s.id === data.id);

  if (existingIdx >= 0) {
    data.createdAt = progs[existingIdx].createdAt;
    progs[existingIdx] = data;
  } else {
    progs.unshift(data);
  }

  try {
    saveAllProgramming(progs);
    state.currentSimId = data.id;
    state.currentSimName = data.name;
    updateTitleBar();
    closeSaveDialog();
    updateUrlWithProg(data.id);
    showToast('Konfigurace uložena: ' + data.name);
  } catch (e) {
    alert('Chyba při ukládání: ' + (e instanceof Error ? e.message : String(e)));
  }
}

export function updateUrlWithProg(progId: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('prog', progId);
    window.history.replaceState(null, '', url.toString());
  } catch (e) { /* ignore */ }
}

// ---- Save Dialog ----

export function showSaveDialog(): void {
  const dialog = document.getElementById('save-dialog');
  if (!dialog) return;

  const nameInput = dialog.querySelector('#save-name') as HTMLInputElement | null;
  const existingList = dialog.querySelector('#save-existing-list');

  if (nameInput) nameInput.value = state.currentSimName || '';

  const progs = getAllProgramming().filter(p => p.arealId === state.arealId);
  if (existingList) {
    if (progs.length > 0) {
      existingList.innerHTML = '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Přepsat existující:</div>' +
        progs.map(s => `
          <div class="save-existing-item" onclick="window.__module__.selectExistingSave('${s.id}', '${s.name.replace(/'/g, "\\'")}')">
            <span class="save-existing-name">${s.name}</span>
            <span class="save-existing-date">${formatDate(s.updatedAt)}</span>
          </div>
        `).join('');
    } else {
      existingList.innerHTML = '';
    }
  }

  dialog.style.display = 'flex';
  (dialog as any).dataset.selectedId = state.currentSimId || '';
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
}

export function selectExistingSave(id: string, name: string): void {
  const dialog = document.getElementById('save-dialog');
  if (!dialog) return;

  (dialog as any).dataset.selectedId = id;
  const nameInput = dialog.querySelector('#save-name') as HTMLInputElement | null;
  if (nameInput) nameInput.value = name;

  dialog.querySelectorAll('.save-existing-item').forEach(el => el.classList.remove('selected'));
  const items = dialog.querySelectorAll('.save-existing-item');
  const progs = getAllProgramming().filter(p => p.arealId === state.arealId);
  const idx = progs.findIndex(s => s.id === id);
  if (idx >= 0 && items[idx]) items[idx].classList.add('selected');
}

export function confirmSave(): void {
  const dialog = document.getElementById('save-dialog');
  if (!dialog) return;

  const nameInput = dialog.querySelector('#save-name') as HTMLInputElement | null;
  const name = (nameInput?.value || '').trim();
  if (!name) {
    if (nameInput) nameInput.focus();
    return;
  }
  const selectedId = (dialog as any).dataset.selectedId || null;
  doSaveProject(name, selectedId);
}

export function closeSaveDialog(): void {
  const dialog = document.getElementById('save-dialog');
  if (dialog) dialog.style.display = 'none';
}

// ---- Načtení projektu (ze souboru) ----

export function loadProject(): void {
  if (!document.getElementById('file-input')) return;
  (document.getElementById('file-input') as HTMLInputElement).click();
}

export function initFileLoader(): void {
  const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
  if (!fileInput) return;

  fileInput.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev: ProgressEvent<FileReader>) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        loadSimulationData(data);
      } catch (err) {
        alert('Chyba při načítání souboru: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.readAsText(file);
    target.value = '';
  });
}

// ---- Načtení konfigurace programování ----

export function loadSimulationById(simId: string): boolean {
  const progs = getAllProgramming();
  const prog = progs.find(s => s.id === simId);
  if (!prog) {
    console.warn('Konfigurace nenalezena:', simId);
    return false;
  }
  loadSimulationData(prog);
  return true;
}

export function loadSimulationData(data: any): void {
  if (data.arealId) {
    loadArealById(data.arealId);
  }
  state.objects = data.objects || [];
  state.connections = data.connections || [];
  state.nextId = data.nextId || 1;
  if (data.viewport) {
    state.zoom = data.viewport.zoom || 1;
    state.panX = data.viewport.panX || 0;
    state.panY = data.viewport.panY || 0;
  }
  state.currentSimId = data.id || null;
  state.currentSimName = data.name || '';

  if (data.wsConfig) {
    if (data.wsConfig.defaultWsSize && typeof (window as any).defaultWsSize !== 'undefined') {
      (window as any).defaultWsSize.w = data.wsConfig.defaultWsSize.w || 2;
      (window as any).defaultWsSize.h = data.wsConfig.defaultWsSize.h || 2;
    }
    if (data.wsConfig.enabledIds && typeof (window as any).wsEnabledSet !== 'undefined') {
      (window as any).wsEnabledSet.clear();
      data.wsConfig.enabledIds.forEach((id: string) => (window as any).wsEnabledSet.add(String(id)));
    }
    if (data.wsConfig.dimensions && typeof (window as any).wsDimensions !== 'undefined') {
      Object.keys(data.wsConfig.dimensions).forEach((wsId: string) => {
        (window as any).wsDimensions[wsId] = { ...(data.wsConfig.dimensions[wsId]) };
      });
    }
  }

  deselectAll();
  renderAll();
  updateTitleBar();

  if (typeof markUsedWorkstations === 'function') {
    markUsedWorkstations();
  }
  if (typeof updateFactorifyUI === 'function') {
    updateFactorifyUI();
  }
}

// ---- Title bar update ----

export function updateTitleBar(): void {
  const h1 = document.querySelector('#toolbar h1');
  if (h1) {
    let title = 'Programování výroby';
    if (state.arealName) title += ' — ' + state.arealName;
    if (state.currentSimName) title += ' / ' + state.currentSimName;
    h1.textContent = title;
  }
}

// ---- Export JSON ----

export function exportJSON(): void {
  const data = {
    version: 1,
    name: state.currentSimName || 'Bez názvu',
    arealId: state.arealId,
    arealName: state.arealName,
    objects: state.objects,
    connections: state.connections,
    nextId: state.nextId,
    viewport: { zoom: state.zoom, panX: state.panX, panY: state.panY },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.currentSimName || 'programovani-vyroby').replace(/[^a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ _-]/g, '') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Export PNG ----

export function exportPNG(): void {
  const svg = document.getElementById('canvas') as SVGSVGElement | null;
  if (!svg) return;

  const tempSvg = svg.cloneNode(true) as SVGSVGElement;
  const allObjs = [...state.arealObjects, ...state.objects];
  const minX = allObjs.reduce((m, o) => Math.min(m, o.x), 0) - 5;
  const minY = allObjs.reduce((m, o) => Math.min(m, o.y), 0) - 5;
  const maxX = allObjs.reduce((m, o) => Math.max(m, o.x + o.w), 100) + 5;
  const maxY = allObjs.reduce((m, o) => Math.max(m, o.y + o.h), 80) + 5;

  const scale = 4;
  const width = (maxX - minX) * state.pxPerMeter * scale;
  const height = (maxY - minY) * state.pxPerMeter * scale;

  tempSvg.setAttribute('width', String(width));
  tempSvg.setAttribute('height', String(height));
  tempSvg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

  const objLayer = tempSvg.querySelector('#object-layer') as SVGGElement | null;
  if (objLayer) objLayer.setAttribute('transform', '');
  const connLayer = tempSvg.querySelector('#connection-layer') as SVGGElement | null;
  if (connLayer) connLayer.setAttribute('transform', '');

  const svgData = new XMLSerializer().serializeToString(tempSvg);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = '#141422';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (state.currentSimName || 'programovani-vyroby') + '.png';
    a.click();
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
}

// ---- Pomocné ----

export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

// ---- Kontrola URL parametrů při startu ----

export function checkUrlParams(): boolean {
  const params = new URLSearchParams(window.location.search);

  let arealId = params.get('areal');
  if (!arealId && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    arealId = hashParams.get('areal');
  }
  if (arealId) {
    console.log('Načítám areál:', arealId);
    loadArealById(arealId);
  }

  let progId = params.get('prog');
  if (!progId && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    progId = hashParams.get('prog');
  }
  if (progId) {
    console.log('Načítám konfiguraci:', progId);
    return loadSimulationById(progId);
  }

  if (arealId) {
    const progs = getAllProgramming().filter(p => p.arealId === arealId);
    if (progs.length > 0) {
      progs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      console.log('Auto-načítám poslední konfiguraci pro areál:', progs[0].name);
      loadSimulationData(progs[0]);
      updateUrlWithProg(progs[0].id);
      return true;
    }
  }

  return !!arealId;
}
