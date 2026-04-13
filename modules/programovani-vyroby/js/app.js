/* ============================================
   app.js — Inicializace (Programování výroby)
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

  // Výchozí stav
  state.panX = 40;
  state.panY = 40;
  document.getElementById('btn-grid').classList.add('active');
  document.getElementById('btn-snap').classList.add('active');

  // Resize SVG na velikost okna (po krátkém zpoždění aby se layout stihl vykreslit)
  window.addEventListener('resize', resizeSVG);
  requestAnimationFrame(() => {
    resizeSVG();
    updateTransform();

    // Načíst data z persistentního úložiště, pak z URL parametrů
    initPersistentStorage().then(function() {
      const loaded = checkUrlParams();
      if (loaded) {
        renderAll();
        updateTitleBar();
        zoomFit();
        console.log('Programování výroby — areál načten:', state.arealName);
      }
    }).catch(function() {
      const loaded = checkUrlParams();
      if (loaded) {
        renderAll();
        updateTitleBar();
        zoomFit();
      }
      console.log('Programování výroby — localStorage fallback');
    });
  });

  // Inicializace split-handle (přetahování hranice nahoře/dole)
  initSplitHandle();

  // Inicializace vyhledávání pracovišť
  const wsSearch = document.getElementById('ws-search');
  if (wsSearch) {
    wsSearch.addEventListener('input', (e) => filterWorkstationList(e.target.value));
  }

  // Inicializace Production API — načíst .env a automaticky načíst pracoviště
  if (typeof ProductionAPI !== 'undefined') {
    // Načíst uloženou konfiguraci pracovišť
    if (typeof loadWsConfig === 'function') loadWsConfig();
    ProductionAPI.loadEnv().then(() => {
      updateProductionUI();
      // Automaticky načíst pracoviště pokud je token
      if (ProductionAPI.config.securityToken || ProductionAPI.config.useProxy) {
        ProductionAPI.loadWorkstations().catch(() => {});
      }
    });
  }

  console.log('Programování výroby — Editor inicializován.');
});
