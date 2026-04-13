/* ============================================
   production-sim.js — Simulace výroby
   Přepojeno na vlastní HolyOS API (Fáze 3)
   ============================================ */

const ProductionAPI = {

  connected: false,
  loading: false,
  error: null,
  configLoaded: true,

  config: {
    useProxy: true,
    securityToken: 'local',
  },

  // Cache
  products: [],
  stages: [],
  routes: {},
  entities: [],

  async loadEnv() {
    this.configLoaded = true;
    return true;
  },

  async fetchAPI(path) {
    const resp = await fetch(path, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
    }
    return await resp.json();
  },

  // ---- Načíst produkty ----
  async loadProducts() {
    this.loading = true;
    this.error = null;

    try {
      console.log('GET /api/production/products ...');
      const products = await this.fetchAPI('/api/production/products');
      console.log(`Načteno ${products.length} produktů`);

      this.products = products.map(p => ({
        id: p.id,
        name: p.name || ('Produkt ' + p.id),
        code: p.code || '',
        type: p.type || 'product',
      }));

      this.connected = true;
      this.loading = false;
      return this.products;

    } catch (err) {
      this.error = err.message;
      this.loading = false;
      throw err;
    }
  },

  // ---- Načíst pracoviště ----
  async loadStages() {
    try {
      const workstations = await this.fetchAPI('/api/production/workstations');
      this.stages = workstations.map(ws => ({
        id: ws.id,
        name: ws.name || ('Pracoviště ' + ws.id),
        code: ws.code || '',
      }));
      return this.stages;
    } catch (e) {
      console.error('loadStages error:', e);
      return [];
    }
  },

  // ---- Načíst operace pro produkt ----
  async loadRoute(productId) {
    if (this.routes[productId]) return this.routes[productId];

    try {
      console.log(`GET /api/production/operations?product_id=${productId} ...`);
      const ops = await this.fetchAPI(`/api/production/operations?product_id=${productId}`);

      const operations = ops.map((op, idx) => ({
        id: op.id,
        name: op.name || ('Operace ' + (idx + 1)),
        stageId: op.workstation_id || null,
        stageName: op.workstation ? op.workstation.name : '',
        duration: op.duration || 60,
        order: op.step_number || idx + 1,
      }));

      operations.sort((a, b) => a.order - b.order);
      this.routes[productId] = operations;
      console.log(`Postup pro produkt ${productId}: ${operations.length} operací`);
      return operations;

    } catch (err) {
      console.error('loadRoute error:', err);
      return [];
    }
  },
};

// ---- UI funkce ----

function openProductDialog() {
  const dialog = document.getElementById('product-dialog');
  dialog.style.display = 'flex';
  loadProductList();
}

function closeProductDialog() {
  document.getElementById('product-dialog').style.display = 'none';
}

async function loadProductList() {
  const tbody = document.getElementById('product-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Načítám produkty…</td></tr>';

  try {
    const products = await ProductionAPI.loadProducts();
    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Žádné produkty nenalezeny</td></tr>';
      return;
    }

    let html = '';
    products.forEach(p => {
      html += `<tr>
        <td><strong>${p.name}</strong></td>
        <td style="color:var(--text2);">${p.code || '—'}</td>
        <td style="color:var(--text2);">${p.type || '—'}</td>
        <td><button class="btn" onclick="selectProduct('${p.id}')">Vybrat</button></td>
      </tr>`;
    });
    tbody.innerHTML = html;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger);">${err.message}</td></tr>`;
  }
}

function filterProducts(query) {
  const q = (query || '').toLowerCase();
  document.querySelectorAll('#product-tbody tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? '' : 'none';
  });
}

async function selectProduct(productId) {
  const product = ProductionAPI.products.find(p => String(p.id) === String(productId));
  if (!product) return;

  state.selectedProduct = product;
  closeProductDialog();
  showToast('Produkt vybrán: ' + product.name);

  document.getElementById('product-info').innerHTML = `
    <div class="product-card">
      <div class="product-name">${product.name}</div>
      <div class="product-code">${product.code || ''}</div>
    </div>`;

  document.getElementById('route-info').innerHTML = '<div class="empty-state">Načítám pracovní postup…</div>';

  try {
    const route = await ProductionAPI.loadRoute(product.id);
    state.route = route;

    if (route.length === 0) {
      document.getElementById('route-info').innerHTML = `
        <div class="empty-state">
          Pracovní postup nenalezen.<br>
          Můžete definovat postup ručně.
        </div>
        <button class="btn" onclick="openManualRouteEditor()" style="margin-top:8px;width:100%;">Definovat postup ručně</button>`;
      return;
    }

    renderRouteInfo();
    mapRouteToFloorPlan();
  } catch (err) {
    document.getElementById('route-info').innerHTML = `
      <div style="color:var(--danger);font-size:12px;">${err.message}</div>
      <button class="btn" onclick="openManualRouteEditor()" style="margin-top:8px;width:100%;">Definovat postup ručně</button>`;
  }
}

function renderRouteInfo() {
  const container = document.getElementById('route-info');
  if (!state.route || state.route.length === 0) {
    container.innerHTML = '<div class="empty-state">Žádné operace</div>';
    return;
  }

  let html = '';
  state.route.forEach((op, idx) => {
    const timeStr = formatDuration(op.duration);
    const stageInfo = op.stageName || 'Nepřiřazeno';
    html += `
      <div class="route-step" id="route-step-${idx}" data-step="${idx}">
        <div class="route-step-num">${idx + 1}</div>
        <div class="route-step-name">
          <div>${op.name}</div>
          <div style="font-size:10px;color:var(--text2);">${stageInfo}</div>
        </div>
        <div class="route-step-time">${timeStr}</div>
      </div>`;
  });
  container.innerHTML = html;
}

function mapRouteToFloorPlan() {
  if (!state.route || !state.objects) return;

  state.route.forEach(op => {
    const match = state.objects.find(obj => {
      if (!obj.workstationId) return false;
      return String(obj.workstationId) === String(op.stageId);
    });

    if (match) {
      op.floorX = match.x + match.w / 2;
      op.floorY = match.y + match.h / 2;
      op.floorObj = match;
    } else {
      const nameMatch = state.objects.find(obj =>
        obj.name && op.stageName && obj.name.toLowerCase().includes(op.stageName.toLowerCase())
      );
      if (nameMatch) {
        op.floorX = nameMatch.x + nameMatch.w / 2;
        op.floorY = nameMatch.y + nameMatch.h / 2;
        op.floorObj = nameMatch;
      }
    }
  });
}

// ---- Ruční editor postupu ----

function openManualRouteEditor() {
  const wsObjects = state.objects.filter(o => o.type === 'pracoviste' || o.workstationId);
  if (wsObjects.length === 0) {
    showToast('Nejsou žádná pracoviště na plátně');
    return;
  }

  let html = '<div style="margin-bottom:12px;font-size:12px;color:var(--text2);">Vyberte pracoviště a nastavte časy operací:</div>';
  wsObjects.forEach((ws, idx) => {
    html += `
      <div class="route-step" style="margin-bottom:6px;">
        <div class="route-step-num">${idx + 1}</div>
        <div style="flex:1;">
          <input type="checkbox" id="manual-ws-${ws.id}" checked data-ws-id="${ws.id}" data-ws-name="${ws.name}"
            style="accent-color:var(--accent);margin-right:6px;">
          <label for="manual-ws-${ws.id}" style="font-size:12px;">${ws.name}</label>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <input type="number" id="manual-time-${ws.id}" value="60" min="1" step="10"
            style="width:60px;padding:3px 5px;font-size:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:5px;">
          <span style="font-size:11px;color:var(--text2);">s</span>
        </div>
      </div>`;
  });

  document.getElementById('route-info').innerHTML = html +
    `<button class="btn btn-primary" onclick="applyManualRoute()" style="width:100%;margin-top:10px;">Použít postup</button>`;
}

function applyManualRoute() {
  const route = [];
  const checkboxes = document.querySelectorAll('[id^="manual-ws-"]:checked');
  checkboxes.forEach((cb, idx) => {
    const wsId = cb.dataset.wsId;
    const wsName = cb.dataset.wsName;
    const timeInput = document.getElementById('manual-time-' + wsId);
    const duration = parseFloat(timeInput?.value) || 60;

    const wsObj = state.objects.find(o => String(o.id) === String(wsId));
    route.push({
      id: idx + 1,
      name: 'Operace na ' + wsName,
      stageId: wsObj?.workstationId || wsId,
      stageName: wsName,
      duration: duration,
      order: idx + 1,
      floorX: wsObj ? wsObj.x + wsObj.w / 2 : null,
      floorY: wsObj ? wsObj.y + wsObj.h / 2 : null,
      floorObj: wsObj || null,
    });
  });

  state.route = route;
  renderRouteInfo();
  showToast(`Postup nastaven: ${route.length} operací`);
}

// ---- Config dialog ----

function openConfigDialog() {
  const dialog = document.getElementById('config-dialog');
  document.getElementById('cfg-batch-size').value = state.simBatchSize;
  document.getElementById('cfg-move-speed').value = state.simMoveSpeed;

  const select = document.getElementById('cfg-prog-select');
  const progs = getAllProgramming();
  select.innerHTML = progs.map(p =>
    `<option value="${p.id}" ${p.id === state.currentProgId ? 'selected' : ''}>${p.name} (${p.arealName || ''})</option>`
  ).join('');

  dialog.style.display = 'flex';
}

function closeConfigDialog() {
  document.getElementById('config-dialog').style.display = 'none';
}

function applyConfig() {
  state.simBatchSize = parseInt(document.getElementById('cfg-batch-size').value) || 1;
  state.simMoveSpeed = parseFloat(document.getElementById('cfg-move-speed').value) || 1;

  const progId = document.getElementById('cfg-prog-select').value;
  if (progId && progId !== state.currentProgId) {
    loadProgramming(progId);
  }

  closeConfigDialog();
  showToast('Nastavení aplikováno');
}

// ---- Helpers ----

function getAllProgramming() {
  try {
    var raw = (typeof PersistentStorage !== 'undefined')
      ? PersistentStorage.getItemSync(PROG_STORAGE_KEY)
      : localStorage.getItem(PROG_STORAGE_KEY);
    return JSON.parse(raw) || [];
  } catch (e) { return []; }
}

function getAllAreals() {
  try {
    var raw = (typeof PersistentStorage !== 'undefined')
      ? PersistentStorage.getItemSync(AREAL_STORAGE_KEY)
      : localStorage.getItem(AREAL_STORAGE_KEY);
    return JSON.parse(raw) || [];
  } catch (e) { return []; }
}

function loadProgramming(progId) {
  const progs = getAllProgramming();
  const prog = progs.find(p => p.id === progId);
  if (!prog) {
    showToast('Konfigurace nenalezena');
    return false;
  }

  if (prog.arealId) {
    const areals = getAllAreals();
    const areal = areals.find(a => a.id === prog.arealId);
    if (areal) {
      state.arealId = areal.id;
      state.arealName = areal.name;
      state.arealObjects = JSON.parse(JSON.stringify(areal.objects || []));
    }
  }

  state.objects = prog.objects || [];
  state.connections = prog.connections || [];
  state.currentProgId = prog.id;
  state.currentProgName = prog.name;

  if (prog.viewport) {
    state.zoom = prog.viewport.zoom || 1;
    state.panX = prog.viewport.panX || 0;
    state.panY = prog.viewport.panY || 0;
  }

  renderAll();
  zoomFit();

  document.querySelector('#toolbar h1').textContent = 'Simulace výroby — ' + (prog.name || '');
  showToast('Načteno: ' + prog.name);

  if (state.route.length > 0) {
    mapRouteToFloorPlan();
  }

  return true;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
