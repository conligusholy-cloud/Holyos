/* ============================================
   storage.js — Uložení/načtení (persistent-storage + localStorage fallback)
   ============================================ */

const STORAGE_KEY = 'vyroba_simulations';

// ---- Získání všech simulací ----

function getAllSimulations() {
  try {
    const raw = PersistentStorage.getItemSync(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Chyba při čtení simulací:', e);
    return [];
  }
}

function saveAllSimulations(sims) {
  PersistentStorage.setItem(STORAGE_KEY, JSON.stringify(sims));
}

// ---- Inicializace: načíst data ze souboru při startu ----
function initPersistentStorage() {
  return PersistentStorage.migrateFromLocalStorage([STORAGE_KEY]).then(function() {
    return PersistentStorage.init([STORAGE_KEY]);
  });
}

// ---- Uložit aktuální projekt ----

function saveProject() {
  // Pokud už máme uloženou simulaci, rovnou přepsat (bez dialogu)
  if (state.currentSimId && state.currentSimName) {
    doSaveProject(state.currentSimName, state.currentSimId);
    return;
  }
  // Jinak zobrazit dialog pro pojmenování
  showSaveDialog();
}

function saveProjectAs() {
  // Vždy zobrazit dialog (Uložit jako...)
  showSaveDialog();
}

function doSaveProject(name, simId) {
  // Deep copy dat aby se uložil skutečný stav
  const data = {
    id: simId || ('sim_' + Date.now()),
    name: name || 'Bez názvu',
    version: 1,
    objects: JSON.parse(JSON.stringify(state.objects)),
    connections: JSON.parse(JSON.stringify(state.connections)),
    nextId: state.nextId,
    viewport: { zoom: state.zoom, panX: state.panX, panY: state.panY },
    createdAt: null,
    updatedAt: new Date().toISOString(),
    objectCount: state.objects.length,
    connectionCount: state.connections.length,
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
    alert('Chyba při ukládání: ' + e.message);
  }
}

// ---- Save Dialog ----

function showSaveDialog() {
  let dialog = document.getElementById('save-dialog');
  if (!dialog) return;

  const nameInput = dialog.querySelector('#save-name');
  const existingList = dialog.querySelector('#save-existing-list');

  // Předvyplnit aktuální název
  nameInput.value = state.currentSimName || '';

  // Zobrazit existující simulace
  const sims = getAllSimulations();
  if (sims.length > 0) {
    existingList.innerHTML = '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Přepsat existující:</div>' +
      sims.map(s => `
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

  // Zvýraznit vybraný
  dialog.querySelectorAll('.save-existing-item').forEach(el => el.classList.remove('selected'));
  const items = dialog.querySelectorAll('.save-existing-item');
  const sims = getAllSimulations();
  const idx = sims.findIndex(s => s.id === id);
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

// ---- Načtení simulace z localStorage podle ID ----

function loadSimulationById(simId) {
  const sims = getAllSimulations();
  const sim = sims.find(s => s.id === simId);
  if (!sim) {
    console.warn('Simulace nenalezena:', simId);
    return false;
  }
  loadSimulationData(sim);
  return true;
}

function loadSimulationData(data) {
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

function updateTitleBar() {
  const h1 = document.querySelector('#toolbar h1');
  if (h1) {
    h1.textContent = state.currentSimName
      ? 'Vytvoření areálu — ' + state.currentSimName
      : 'Vytvoření areálu';
  }
}

// ---- Export JSON souboru ----

function exportJSON() {
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

function exportPNG() {
  const tempSvg = dom.svg.cloneNode(true);
  const minX = state.objects.reduce((m, o) => Math.min(m, o.x), 0) - 5;
  const minY = state.objects.reduce((m, o) => Math.min(m, o.y), 0) - 5;
  const maxX = state.objects.reduce((m, o) => Math.max(m, o.x + o.w), 100) + 5;
  const maxY = state.objects.reduce((m, o) => Math.max(m, o.y + o.h), 80) + 5;

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
    a.download = (state.currentSimName || 'pudorys-vyroby') + '.png';
    a.click();
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
}

// ---- Toast notifikace ----

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
