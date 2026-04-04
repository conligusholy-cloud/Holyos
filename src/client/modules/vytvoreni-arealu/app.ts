/* ============================================
   app.ts — Inicializace aplikace
   ============================================ */

import { state } from './state.js';
import { initDom, updateTransform, renderAll } from './renderer.js';
import { initPaletteDrag, initCanvasMouse, initZoom, initKeyboard, resizeSVG } from './interactions.js';
import { initFileLoader, initPersistentStorage, checkUrlParams } from './storage.js';
import { initEditorAPI } from './editor-api.js';

document.addEventListener('DOMContentLoaded', () => {
  // Inicializace DOM referencí
  initDom();

  // Inicializace interakcí
  initPaletteDrag();
  initCanvasMouse();
  initZoom();
  initKeyboard();
  initFileLoader();

  // Inicializace API
  initEditorAPI();

  // Resize SVG na velikost okna
  resizeSVG();
  window.addEventListener('resize', resizeSVG);

  // Výchozí stav
  state.panX = 40;
  state.panY = 40;
  const btnGrid = document.getElementById('btn-grid');
  if (btnGrid) btnGrid.classList.add('active');
  const btnSnap = document.getElementById('btn-snap');
  if (btnSnap) btnSnap.classList.add('active');
  updateTransform();

  // Načíst data z persistentního úložiště, pak z URL parametru
  initPersistentStorage().then(() => {
    const loaded = checkUrlParams();
    if (loaded) {
      console.log('Simulace načtena:', state.currentSimName);
    }
    console.log('Editor půdorysu inicializován (persistentní úložiště).');
  }).catch(() => {
    // Fallback: načíst rovnou z localStorage
    const loaded = checkUrlParams();
    if (loaded) {
      console.log('Simulace načtena (localStorage fallback):', state.currentSimName);
    }
    console.log('Editor půdorysu inicializován (localStorage fallback).');
  });
});
