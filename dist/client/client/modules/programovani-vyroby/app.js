/* ============================================
   app.ts — Inicializace (Programování výroby)
   ============================================ */
import { state } from './state.js';
import { initDom, renderAll, updateTransform, resizeSVG } from './renderer.js';
import { initPaletteDrag, initCanvasMouse, initZoom, initKeyboard, initSplitHandle, zoomIn, zoomOut, zoomFit, toggleGrid, toggleSnap, toggleConnectMode, confirmDistanceAndPlace } from './interactions.js';
import { initFileLoader, initPersistentStorage, checkUrlParams, updateTitleBar, saveProject, saveProjectAs, loadProject, exportJSON, exportPNG, confirmSave, closeSaveDialog } from './storage.js';
import { FactorifyAPI, markUsedWorkstations, updateFactorifyUI, openWsConfigDialog, closeWsConfigDialog, saveWsConfig, wsConfigApplyDefaults, wsConfigToggleAll, dragWorkstation, setWsDimension } from './factorify-api.js';
import * as objects from './objects.js';
import * as properties from './properties.js';
import * as history from './history.js';
import * as storage from './storage.js';
// Expose functions directly on window for HTML toolbar onclick handlers
const w = window;
w.zoomIn = zoomIn;
w.zoomOut = zoomOut;
w.zoomFit = zoomFit;
w.undo = history.undo;
w.redo = history.redo;
w.toggleGrid = toggleGrid;
w.toggleSnap = toggleSnap;
w.toggleConnectMode = toggleConnectMode;
w.saveProject = saveProject;
w.saveProjectAs = saveProjectAs;
w.loadProject = loadProject;
w.exportJSON = exportJSON;
w.exportPNG = exportPNG;
w.confirmSave = confirmSave;
w.closeSaveDialog = closeSaveDialog;
w.confirmDistanceAndPlace = confirmDistanceAndPlace;
w.FactorifyAPI = FactorifyAPI;
w.openWsConfigDialog = openWsConfigDialog;
w.closeWsConfigDialog = closeWsConfigDialog;
w.saveWsConfig = saveWsConfig;
w.wsConfigApplyDefaults = wsConfigApplyDefaults;
w.wsConfigToggleAll = wsConfigToggleAll;
// Exportovat klíčové funkce na window pro HTML event handlers
window.__module__ = {
    // State
    state,
    // Interactions
    toggleGrid,
    toggleSnap,
    initZoom,
    zoomFit,
    // API
    FactorifyAPI,
    markUsedWorkstations,
    updateFactorifyUI,
    dragWorkstation,
    setWsDimension,
    // Import alle nezbytné funkce z ostatních modulů
    ...objects,
    ...properties,
    ...history,
    ...storage,
};
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializace DOM referencí
    initDom();
    // Inicializace interakcí
    initPaletteDrag();
    initCanvasMouse();
    initZoom();
    initKeyboard();
    initFileLoader();
    // Výchozí stav
    state.panX = 40;
    state.panY = 40;
    const btnGrid = document.getElementById('btn-grid');
    const btnSnap = document.getElementById('btn-snap');
    if (btnGrid)
        btnGrid.classList.add('active');
    if (btnSnap)
        btnSnap.classList.add('active');
    // Resize SVG na velikost okna
    window.addEventListener('resize', resizeSVG);
    requestAnimationFrame(() => {
        resizeSVG();
        updateTransform();
        // Načíst data z persistentního úložiště, pak z URL parametrů
        initPersistentStorage()
            .then(() => {
            const loaded = checkUrlParams();
            if (loaded) {
                renderAll();
                updateTitleBar();
                zoomFit();
                console.log('Programování výroby — areál načten:', state.arealName);
            }
        })
            .catch(() => {
            const loaded = checkUrlParams();
            if (loaded) {
                renderAll();
                updateTitleBar();
                zoomFit();
            }
            console.log('Programování výroby — localStorage fallback');
        });
    });
    // Inicializace split-handle
    initSplitHandle();
    // Inicializace vyhledávání pracovišť
    const wsSearch = document.getElementById('ws-search');
    if (wsSearch) {
        wsSearch.addEventListener('input', (e) => {
            const target = e.target;
            window.__module__.filterWorkstationList?.(target.value);
        });
    }
    // Inicializace — pracoviště načteme přímo z lokálního HolyOS endpointu.
    // Dřívější FactorifyAPI.loadEnv() se snažila fetchnout /.env co hází 403
    // a vyžadovala externí token — to už nepotřebujeme (data jsou v naší DB).
    if (typeof FactorifyAPI !== 'undefined') {
        if (typeof window.loadWsConfig === 'function') {
            window.loadWsConfig();
        }
        updateFactorifyUI();
        FactorifyAPI.loadWorkstations().catch((e) => {
            console.warn('[Programování výroby] loadWorkstations selhalo:', e);
        });
    }
    console.log('Programování výroby — Editor inicializován.');
});
//# sourceMappingURL=app.js.map