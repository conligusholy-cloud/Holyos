/* ============================================
   storage.ts — Uložení/načtení (persistent-storage + localStorage fallback)
   ============================================ */

import { state } from './state.js';
import { renderAll, updateTransform, dom } from './renderer.js';
import { deselectAll } from './properties.js';
import type { SavedSimulation } from '../../../shared/types.js';
import { PersistentStorage } from '../../js/persistent-storage.js';

const STORAGE_KEY = 'vyroba_simulations';

// ---- Získání všech simulací ----

export function getAllSimulations(): SavedSimulation[] {
  try {
    const raw = PersistentStorage.getItemSync(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Chyba při čtení simulací:', e);
    return [];
  }
}

export function saveAllSimulations(sims: SavedSimulation[]): void {
  PersistentStorage.setItem(STORAGE_KEY, JSON.stringify(sims));
}

// ---- Inicializace: načíst data ze souboru při startu ----
export function initPersistentStorage(): Promise<void> {
  return Promise.resolve(
    PersistentStorage.migrateFromLocalStorage([STORAGE_KEY])
  ).then(() => PersistentStorage.init([STORAGE_KEY]));
}

// ---- Uložit aktuální projekt ----

export function saveProject(): void {
  // Pokud už máme uloženou simulaci, rovnou přepsat (bez dialogu)
  if (state.currentSimId && state.currentSimName) {
    doSaveProject(state.currentSimName, state.currentSimId);
    return;
  }
  // Jinak zobrazit dialog pro pojmenování
  showSaveDialog();
}

export function saveProjectAs(): void {
  // Vždy zobrazit dialog (Uložit jako...)
  showSaveDialog();
}

function doSaveProject(name: string, simId: string | null): void {
  // Deep copy dat aby se uložil skutečný stav
  const data: SavedSimulation = {
    id: simId || ('sim_' + Date.now()),
    name: name || 'Bez názvu',
    version: 1,
    objects: JSON.parse(JSON.stringify(state.objects)),
    connections: JSON.parse(JSON.stringify(state.connections)),
    nextId: state.nextId,
    viewport: { zoom: state.zoom, panX: state.panX, panY: state.panY },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  console.log('Ukládám simulaci:', name, '- objektů:', data.objects.length, data.objects);

  const sims = getAllSimulations();
  const existingIdx = sims.findIndex(s => s.id === data.id);

  if (existingIdx >= 0) {
    data.createdAt = sims[existingIdx].createdAt;
    sims[existingIdx] = data;
  } else {
    data.createdAt = data.updatedAt;
    sims.unshift(data);
  }

  try {
    saveAllSimulations(sims);
    state.currentSimId = data.id;
    state.currentSimName = data.name;
    updateTitleBar();
    closeSaveDialog();
    showToast('Areál uložen: ' + data.name);
  } catch (e) {
    alert('Chyba při ukládání: ' + (e instanceof Error ? e.message : String(e)));
  }
}

// ---- Save Dialog ----

function showSaveDialog(): void {
  let dialog = document.getElementById('save-dialog');
  if (!dialog) return;

  const nameInput = dialog.querySelector('#save-name') as HTMLInputElement;
  const existingList = dialog.querySelector('#save-existing-list') as HTMLElement;

  // Předvyplnit aktuální název
  nameInput.value = state.currentSimName || '';

  // Zobrazit existující simulace
  const sims = getAllSimulations();
  if (sims.length > 0) {
    existingList.innerHTML = '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Přepsat existující:</div>' +
      sims.map(s => `
        <div class="save-existing-item" onclick="window.editorAPI.selectExistingSave('${s.id}', '${s.name.replace(/'/g, "\\'")}')">
          <span class="save-existing-name">${s.name}</span>
          <span class="save-existing-date">${formatDate(s.updatedAt)}</span>
        </div>
      `).join('');
  } else {
    existingList.innerHTML = '';
  }

  dialog.style.display = 'flex';
  (dialog as any).dataset.selectedId = state.currentSimId || '';
  nameInput.focus();
  nameInput.select();
}

function selectExistingSave(id: string, name: string): void {
  const dialog = document.getElementById('save-dialog');
  if (!dialog) return;
  (dialog as any).dataset.selectedId = id;
  (dialog.querySelector('#save-name') as HTMLInputElement).value = name;

  // Zvýraznit vybraný
  dialog.querySelectorAll('.save-existing-item').forEach(el => el.classList.remove('selected'));
  const items = dialog.querySelectorAll('.save-existing-item');
  const sims = getAllSimulations();
  const idx = sims.findIndex(s => s.id === id);
  if (idx >= 0 && items[idx]) items[idx].classList.add('selected');
}

export function confirmSave(): void {
  const dialog = document.getElementById('save-dialog');
  if (!dialog) return;
  const name = (dialog.querySelector('#save-name') as HTMLInputElement).value.trim();
  if (!name) {
    (dialog.querySelector('#save-name') as HTMLInputElement).focus();
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
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.click();
}

export function initFileLoader(): void {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (!fileInput) return;
  fileInput.addEventListener('change', (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev: any) => {
      try {
        const data = JSON.parse(ev.target.result);
        loadSimulationData(data);
      } catch (err) {
        alert('Chyba při načítání souboru: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
}

// ---- Načtení simulace z localStorage podle ID ----

function loadSimulationById(simId: string): boolean {
  const sims = getAllSimulations();
  const sim = sims.find(s => s.id === simId);
  if (!sim) {
    console.warn('Simulace nenalezena:', simId);
    return false;
  }
  loadSimulationData(sim);
  return true;
}

function loadSimulationData(data: any): void {
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
  deselectAll();
  renderAll();
  updateTitleBar();
}

// ---- Title bar update ----

export function updateTitleBar(): void {
  const h1 = document.querySelector('#toolbar h1');
  if (h1) {
    h1.textContent = state.currentSimName
      ? 'Vytvoření areálu — ' + state.currentSimName
      : 'Vytvoření areálu';
  }
}

// ---- Export JSON souboru ----

export function exportJSON(): void {
  const data = {
    version: 1,
    name: state.currentSimName || 'Bez názvu',
    objects: state.objects,
    connections: state.connections,
    nextId: state.nextId,
    viewport: { zoom: state.zoom, panX: state.panX, panY: state.panY },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (state.currentSimName || 'pudorys-vyroby').replace(/[^a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ _-]/g, '') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Export PNG ----

export function exportPNG(): void {
  if (!dom.svg) return;

  const tempSvg = dom.svg.cloneNode(true) as SVGSVGElement;
  const minX = state.objects.reduce((m: number, o: any) => Math.min(m, o.x), 0) - 5;
  const minY = state.objects.reduce((m: number, o: any) => Math.min(m, o.y), 0) - 5;
  const maxX = state.objects.reduce((m: number, o: any) => Math.max(m, o.x + o.w), 100) + 5;
  const maxY = state.objects.reduce((m: number, o: any) => Math.max(m, o.y + o.h), 80) + 5;

  const scale = 4;
  const width = (maxX - minX) * state.pxPerMeter * scale;
  const height = (maxY - minY) * state.pxPerMeter * scale;

  tempSvg.setAttribute('width', width.toString());
  tempSvg.setAttribute('height', height.toString());
  tempSvg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

  const objLayer = tempSvg.querySelector('#object-layer') as SVGGElement;
  objLayer.setAttribute('transform', '');
  const connLayer = tempSvg.querySelector('#connection-layer') as SVGGElement;
  connLayer.setAttribute('transform', '');

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
    a.download = (state.currentSimName || 'pudorys-vyroby') + '.png';
    a.click();
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
}

// ---- Toast notifikace ----

export function showToast(message: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast!.classList.remove('show'), 2500);
}

// ---- Pomocné ----

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

// ---- Kontrola URL parametrů při startu ----

export function checkUrlParams(): boolean {
  // Zkontrolovat query string
  const params = new URLSearchParams(window.location.search);
  let simId = params.get('sim');

  // Fallback: zkontrolovat hash (pro případ že serve ztratilo query params)
  if (!simId && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    simId = hashParams.get('sim');
  }

  if (simId) {
    console.log('Načítám simulaci z URL:', simId);
    return loadSimulationById(simId);
  }
  return false;
}

// Export functions for global access
export function getGlobalAPI() {
  return {
    checkUrlParams,
    loadProject,
    saveProject,
    saveProjectAs,
    exportJSON,
    exportPNG,
    confirmSave,
    closeSaveDialog,
    selectExistingSave,
  };
}
