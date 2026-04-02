/* ============================================
   storage.js — Uložení/načtení (Programování výroby)
   ============================================ */

const AREAL_STORAGE_KEY = 'vyroba_simulations';     // Areály (read-only zdroj)
const PROG_STORAGE_KEY = 'vyroba_programovani';      // Programování pracovišť

// ---- Areály (read-only) ----

function getAllAreals() {
  try {
    const raw = PersistentStorage.getItemSync(AREAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function loadArealById(arealId) {
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

function getAllProgramming() {
  try {
    const raw = PersistentStorage.getItemSync(PROG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveAllProgramming(progs) {
  PersistentStorage.setItem(PROG_STORAGE_KEY, JSON.stringify(progs));
}

// ---- Inicializace persistentního úložiště ----
function initPersistentStorage() {
  return PersistentStorage.migrateFromLocalStorage([AREAL_STORAGE_KEY, PROG_STORAGE_KEY]).then(function() {
    return PersistentStorage.init([AREAL_STORAGE_KEY, PROG_STORAGE_KEY]);
  });
}

function getAllSimulations() {
  return getAllProgramming();
}

function saveAllSimulations(progs) {
  saveAllProgramming(progs);
}

// ---- Uložit aktuální projekt ----

function saveProject() {
  if (state.currentSimId && state.currentSimName) {
    doSaveProject(state.currentSimName, state.currentSimId);
    return;
  }
  showSaveDialog();
}

function saveProjectAs() {
  showSaveDialog();
}

function doSaveProject(name, simId) {
  // Uložit konfiguraci pracovišť (rozměry, výběr) spolu s projektem
  const wsConfig = {};
  if (typeof wsDimensions !== 'undefined') {
    wsConfig.dimensions = JSON.parse(JSON.stringify(wsDimensions));
  }
  if (typeof defaultWsSize !== 'undefined') {
    wsConfig.defaultWsSize = { ...defaultWsSize };
  }
  if (typeof wsEnabledSet !== 'undefined' && wsEnabledSet.size > 0) {
    wsConfig.enabledIds = Array.from(wsEnabledSet);
  }

  const data = {
    id: simId || ('prog_' + Date.now()),
    name: name || 'Bez názvu',
    version: 1,
    arealId: state.arealId,
    arealName: state.arealName,
    objects: JSON.parse(JSON.stringify(state.objects)),
    connections: JSON.parse(JSON.stringify(state.connections)),
    nextId: state.nextId,
    viewport: { zoom: state.zoom, panX: state.panX, panY: state.panY },
    wsConfig: wsConfig,
    createdAt: null,
    updatedAt: new Date().toISOString(),
    objectCount: state.objects.length,
    connectionCount: state.connections.length,
  };

  const progs = getAllProgramming();
  const existingIdx = progs.findIndex(s => s.id === data.id);

  if (existingIdx >= 0) {
    data.createdAt = progs[existingIdx].createdAt;
    progs[existingIdx] = data;
  } else {
    data.createdAt = data.updatedAt;
    progs.unshift(data);
  }

  try {
    saveAllProgramming(progs);
    state.currentSimId = data.id;
    state.currentSimName = data.name;
    updateTitleBar();
    closeSaveDialog();

    // Aktualizovat URL aby obsahovala prog parametr — po refreshi se načte zpět
    updateUrlWithProg(data.id);

    showToast('Konfigurace uložena: ' + data.name);
  } catch (e) {
    alert('Chyba při ukládání: ' + e.message);
  }
}

function updateUrlWithProg(progId) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('prog', progId);
    window.history.replaceState(null, '', url.toString());
  } catch (e) { /* ignore */ }
}

// ---- Save Dialog ----

function showSaveDialog() {
  let dialog = document.getElementById('save-dialog');
  if (!dialog) return;

  const nameInput = dialog.querySelector('#save-name');
  const existingList = dialog.querySelector('#save-existing-list');

  nameInput.value = state.currentSimName || '';

  // Zobrazit existující konfigurace pro tento areál
  const progs = getAllProgramming().filter(p => p.arealId === state.arealId);
  if (progs.length > 0) {
    existingList.innerHTML = '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Přepsat existující:</div>' +
      progs.map(s => `
        <div class="save-existing-item" onclick="selectExistingSave('${s.id}', '${s.name.replace(/'/g, "\\'")}')">
          <span class="save-existing-name">${s.name}</span>
          <span class="save-existing-date">${formatDate(s.updatedAt)}</span>
        </div>
      `).join('');
  } else {
    existingList.innerHTML = '';
  }

  dialog.style.display = 'flex';
  dialog.dataset.selectedId = state.currentSimId || '';
  nameInput.focus();
  nameInput.select();
}

function selectExistingSave(id, name) {
  const dialog = document.getElementById('save-dialog');
  dialog.dataset.selectedId = id;
  dialog.querySelector('#save-name').value = name;

  dialog.querySelectorAll('.save-existing-item').forEach(el => el.classList.remove('selected'));
  const items = dialog.querySelectorAll('.save-existing-item');
  const progs = getAllProgramming().filter(p => p.arealId === state.arealId);
  const idx = progs.findIndex(s => s.id === id);
  if (idx >= 0 && items[idx]) items[idx].classList.add('selected');
}

function confirmSave() {
  const dialog = document.getElementById('save-dialog');
  const name = dialog.querySelector('#save-name').value.trim();
  if (!name) {
    dialog.querySelector('#save-name').focus();
    return;
  }
  const selectedId = dialog.dataset.selectedId || null;
  doSaveProject(name, selectedId);
}

function closeSaveDialog() {
  const dialog = document.getElementById('save-dialog');
  if (dialog) dialog.style.display = 'none';
}

// ---- Načtení projektu (ze souboru) ----

function loadProject() {
  dom.fileInput.click();
}

function initFileLoader() {
  dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        loadSimulationData(data);
      } catch (err) {
        alert('Chyba při načítání souboru: ' + err.message);
      }
    };
    reader.readAsText(file);
    dom.fileInput.value = '';
  });
}

// ---- Načtení konfigurace programování ----

function loadSimulationById(simId) {
  const progs = getAllProgramming();
  const prog = progs.find(s => s.id === simId);
  if (!prog) {
    console.warn('Konfigurace nenalezena:', simId);
    return false;
  }
  loadSimulationData(prog);
  return true;
}

function loadSimulationData(data) {
  // Načíst areál pokud je uvedený
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

  // Obnovit konfiguraci pracovišť
  if (data.wsConfig) {
    if (data.wsConfig.defaultWsSize && typeof defaultWsSize !== 'undefined') {
      defaultWsSize.w = data.wsConfig.defaultWsSize.w || 2;
      defaultWsSize.h = data.wsConfig.defaultWsSize.h || 2;
    }
    if (data.wsConfig.enabledIds && typeof wsEnabledSet !== 'undefined') {
      wsEnabledSet.clear();
      data.wsConfig.enabledIds.forEach(id => wsEnabledSet.add(String(id)));
    }
    if (data.wsConfig.dimensions && typeof wsDimensions !== 'undefined') {
      Object.keys(data.wsConfig.dimensions).forEach(wsId => {
        wsDimensions[wsId] = { ...data.wsConfig.dimensions[wsId] };
      });
    }
  }

  deselectAll();
  renderAll();
  updateTitleBar();

  // Označit pracoviště jako použitá v panelu
  if (typeof markUsedWorkstations === 'function') {
    markUsedWorkstations();
  }
  if (typeof updateFactorifyUI === 'function') {
    updateFactorifyUI();
  }
}

// ---- Title bar update ----

function updateTitleBar() {
  const h1 = document.querySelector('#toolbar h1');
  if (h1) {
    let title = 'Programování výroby';
    if (state.arealName) title += ' — ' + state.arealName;
    if (state.currentSimName) title += ' / ' + state.currentSimName;
    h1.textContent = title;
  }
}

// ---- Export JSON ----

function exportJSON() {
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

function exportPNG() {
  const tempSvg = dom.svg.cloneNode(true);
  const allObjs = [...state.arealObjects, ...state.objects];
  const minX = allObjs.reduce((m, o) => Math.min(m, o.x), 0) - 5;
  const minY = allObjs.reduce((m, o) => Math.min(m, o.y), 0) - 5;
  const maxX = allObjs.reduce((m, o) => Math.max(m, o.x + o.w), 100) + 5;
  const maxY = allObjs.reduce((m, o) => Math.max(m, o.y + o.h), 80) + 5;

  const scale = 4;
  const width = (maxX - minX) * state.pxPerMeter * scale;
  const height = (maxY - minY) * state.pxPerMeter * scale;

  tempSvg.setAttribute('width', width);
  tempSvg.setAttribute('height', height);
  tempSvg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

  const objLayer = tempSvg.querySelector('#object-layer');
  objLayer.setAttribute('transform', '');
  const connLayer = tempSvg.querySelector('#connection-layer');
  connLayer.setAttribute('transform', '');

  const svgData = new XMLSerializer().serializeToString(tempSvg);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
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

// ---- Toast ----

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ---- Pomocné ----

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

// ---- Kontrola URL parametrů při startu ----

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);

  // Nejprve zkontrolovat areál
  let arealId = params.get('areal');
  if (!arealId && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    arealId = hashParams.get('areal');
  }
  if (arealId) {
    console.log('Načítám areál:', arealId);
    loadArealById(arealId);
  }

  // Zkontrolovat uloženou konfiguraci programování
  let progId = params.get('prog');
  if (!progId && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    progId = hashParams.get('prog');
  }
  if (progId) {
    console.log('Načítám konfiguraci:', progId);
    return loadSimulationById(progId);
  }

  // Pokud je areál ale žádné prog — zkusit načíst poslední uloženou konfiguraci pro tento areál
  if (arealId) {
    const progs = getAllProgramming().filter(p => p.arealId === arealId);
    if (progs.length > 0) {
      // Seřadit podle updatedAt (nejnovější první)
      progs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      console.log('Auto-načítám poslední konfiguraci pro areál:', progs[0].name);
      loadSimulationData(progs[0]);
      updateUrlWithProg(progs[0].id);
      return true;
    }
  }

  return !!arealId;
}
