/* ============================================
   app.js — Inicializace aplikace
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Inicializace DOM referencí
  initDom();

  // Inicializace interakcí
  initPaletteDrag();
  initCanvasMouse();
  initZoom();
  initKeyboard();
  initFileLoader();

  // Resize SVG na velikost okna
  resizeSVG();
  window.addEventListener('resize', resizeSVG);

  // Výchozí stav
  state.panX = 40;
  state.panY = 40;
  document.getElementById('btn-grid').classList.add('active');
  document.getElementById('btn-snap').classList.add('active');
  updateTransform();

  // Načíst data z persistentního úložiště, pak z URL parametru
  initPersistentStorage().then(function() {
    const loaded = checkUrlParams();
    if (loaded) {
      console.log('Simulace načtena:', state.currentSimName);
    }
    console.log('Editor půdorysu inicializován (persistentní úložiště).');
  }).catch(function() {
    // Fallback: načíst rovnou z localStorage
    const loaded = checkUrlParams();
    if (loaded) {
      console.log('Simulace načtena (localStorage fallback):', state.currentSimName);
    }
    console.log('Editor půdorysu inicializován (localStorage fallback).');
  });
});
