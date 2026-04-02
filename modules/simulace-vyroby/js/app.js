/* ============================================
   app.js — Inicializace (Simulace výroby)
   ============================================ */

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
      renderAll();
      zoomFit();
    } else {
      // Vykreslit prázdný canvas s mřížkou
      updateTransform();
    }
  });

  console.log('Simulace výroby — inicializováno.');
});

// Automaticky načíst poslední programování
function autoLoadProgramming() {
  // Zkontrolovat URL parametry
  const params = new URLSearchParams(window.location.search);
  const progId = params.get('prog');
  if (progId) {
    return loadProgramming(progId);
  }

  // Zkusit načíst poslední uloženou konfiguraci
  const progs = getAllProgramming();
  if (progs.length > 0) {
    // Seřadit podle updatedAt
    progs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return loadProgramming(progs[0].id);
  }

  return false;
}

// ---- Pan & Zoom na canvasu ----

function initCanvasInteraction() {
  let isPanning = false;
  let panStart = { x: 0, y: 0 };

  dom.container.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 0) { // middle or left
      isPanning = true;
      panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      dom.container.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    // Coords display
    const world = screenToWorld(e.clientX, e.clientY);
    if (dom.coordsDisplay) {
      dom.coordsDisplay.textContent = `X: ${world.x.toFixed(1)} Y: ${world.y.toFixed(1)}`;
    }

    if (!isPanning) return;
    state.panX = e.clientX - panStart.x;
    state.panY = e.clientY - panStart.y;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
    dom.container.style.cursor = 'default';
  });

  // Zoom kolečkem
  dom.container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = dom.container.getBoundingClientRect();
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
