/* ============================================
   app.ts — Inicializace (Simulace výroby)
   ============================================ */

import { initDom, resizeSVG, zoomFit, updateTransform } from './renderer.js';
import { FactorifyAPI, getAllProgramming, openProductDialog, closeProductDialog, openConfigDialog, closeConfigDialog, applyConfig } from './factorify-sim.js';
import { startSimulation, pauseSimulation, stopSimulation, stepSimulation } from './simulation.js';
import { state } from './state.js';

export function showToast(message: string): void {
  let toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Expose functions on window for HTML onclick handlers
const w = window as any;
w.openProductDialog = openProductDialog;
w.closeProductDialog = closeProductDialog;
w.openConfigDialog = openConfigDialog;
w.closeConfigDialog = closeConfigDialog;
w.applyConfig = applyConfig;
w.startSimulation = startSimulation;
w.pauseSimulation = pauseSimulation;
w.stopSimulation = stopSimulation;
w.stepSimulation = stepSimulation;

export function autoLoadProgramming(): boolean {
  // Zkontrolovat URL parametry
  const params = new URLSearchParams(window.location.search);
  const progId = params.get('prog');
  if (progId) {
    return (window as any).loadProgramming(progId);
  }

  // Zkusit načíst poslední uloženou konfiguraci
  const progs = getAllProgramming();
  if (progs.length > 0) {
    // Seřadit podle updatedAt
    progs.sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return (window as any).loadProgramming(progs[0].id);
  }

  return false;
}

// ---- Pan & Zoom na canvasu ----

function initCanvasInteraction(): void {
  let isPanning = false;
  let panStart = { x: 0, y: 0 };

  const container = document.getElementById('canvas-container');
  if (!container) return;

  container.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 1 || e.button === 0) { // middle or left
      isPanning = true;
      panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      container.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    // Coords display
    const world = (window as any).screenToWorld(e.clientX, e.clientY);
    const coordsDisplay = document.getElementById('coords-display');
    if (coordsDisplay) {
      coordsDisplay.textContent = `X: ${world.x.toFixed(1)} Y: ${world.y.toFixed(1)}`;
    }

    if (!isPanning) return;
    state.panX = e.clientX - panStart.x;
    state.panY = e.clientY - panStart.y;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
    container.style.cursor = 'default';
  });

  // Zoom kolečkem
  container.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = state.zoom;
    state.zoom = Math.max(0.05, Math.min(10, state.zoom * delta));

    const scale = state.zoom / oldZoom;
    state.panX = mx - (mx - state.panX) * scale;
    state.panY = my - (my - state.panY) * scale;

    updateTransform();
  }, { passive: false });
}

// ---- Inicializace ----

document.addEventListener('DOMContentLoaded', () => {
  initDom();
  resizeSVG();

  window.addEventListener('resize', resizeSVG);

  // Inicializace pan & zoom
  initCanvasInteraction();

  // Načíst Factorify konfiguraci
  FactorifyAPI.loadEnv().then(() => {
    console.log('Factorify config načten');
  });

  // Zkusit načíst poslední programování
  requestAnimationFrame(() => {
    resizeSVG();
    const loaded = autoLoadProgramming();
    if (loaded) {
      (window as any).renderAll();
      zoomFit();
    } else {
      // Vykreslit prázdný canvas s mřížkou
      updateTransform();
    }
  });

  console.log('Simulace výroby — inicializováno.');
});
