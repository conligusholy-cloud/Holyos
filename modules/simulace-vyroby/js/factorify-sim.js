/* ============================================
   factorify-sim.js — Factorify API pro simulaci
   Načtení zboží (Item), pracovních postupů a operací
   ============================================ */

const ENV_PATHS = [
  '../../.env',
  '../../../.env',
  './.env',
];

const FactorifyAPI = {

  connected: false,
  loading: false,
  error: null,
  configLoaded: false,

  config: {
    baseUrl: 'https://bs.factorify.cloud',
    proxyUrl: 'http://localhost:3001',
    useProxy: true,
    securityToken: '',
    headers: {
      'Accept': 'application/json',
      'X-FySerialization': 'ui2',
    },
  },

  // Cache
  products: [],           // zboží
  stages: [],             // pracoviště (pro mapování)
  routes: {},             // itemId → route operations
  entities: [],           // dostupné entity

  parseEnv(text) {
    const result = {};
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq < 0) return;
      let key = line.substring(0, eq).trim();
      let val = line.substring(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    });
    return result;
  },

  async loadEnv() {
    for (const path of ENV_PATHS) {
      try {
        const resp = await fetch(path, { cache: 'no-store' });
        if (resp.ok) {
          const text = await resp.text();
          const env = this.parseEnv(text);
          if (env.FACTORIFY_BASE_URL) this.config.baseUrl = env.FACTORIFY_BASE_URL;
          if (env.FACTORIFY_TOKEN) this.config.securityToken = env.FACTORIFY_TOKEN;
          this.configLoaded = true;
          console.log('Factorify .env načten z:', path);
          return true;
        }
      } catch (e) {}
    }
    return false;
  },

  async fetchAPI(path, options = {}) {
    const cfg = this.config;
    const method = options.method || 'GET';
    const body = options.body || null;

    if (cfg.useProxy) {
      const url = cfg.proxyUrl + path;
      const fetchOpts = {
        method,
        headers: { 'Accept': 'application/json', 'X-FySerialization': 'ui2' },
      };
      if (body) {
        fetchOpts.headers['Content-Type'] = 'application/json';
        fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
      }
      return await resp.json();
    }

    throw new Error('Přímé volání API není podporováno — spusťte proxy server');
  },

  async queryEntity(entityName, filter) {
    const path = '/api/query/' + entityName;
    const body = filter || {};
    return await this.fetchAPI(path, { method: 'POST', body });
  },

  // Extrahovat pole z API odpovědi (různé formáty)
  extractArray(data) {
    if (Array.isArray(data)) return data;
    if (data && data.rows) return data.rows;
    if (data && data.items) return data.items;
    if (data && data.records) return data.records;
    if (data && data.data) return data.data;
    if (data && typeof data === 'object') {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) return data[key];
      }
    }
    return [];
  },

  // ---- Načíst seznam entit ----
  async loadEntities() {
    try {
      const data = await this.fetchAPI('/api/metadata/entities');
      this.entities = Array.isArray(data) ? data : [];
      return this.entities;
    } catch (e) {
      console.error('loadEntities error:', e);
      return [];
    }
  },

  // ---- Načíst zboží (Item / Product) ----
  async loadProducts() {
    this.loading = true;
    this.error = null;

    try {
      if (!this.configLoaded) await this.loadEnv();

      // Zkusit entity: Item, Product, Goods, ...
      const entityNames = ['Item', 'Product', 'Goods', 'Article', 'Material'];
      let data = null;
      let usedEntity = null;

      for (const eName of entityNames) {
        try {
          console.log(`Zkouším POST /api/query/${eName} ...`);
          data = await this.queryEntity(eName);
          usedEntity = eName;
          console.log(`Entity ${eName} nalezena!`);
          break;
        } catch (e) {
          console.log(`Entity ${eName}: ${e.message}`);
        }
      }

      if (!data) {
        // Zkusit najít entity obsahující "item" nebo "product"
        const entities = await this.loadEntities();
        const candidates = entities.filter(e => {
          const n = (e.name || '').toLowerCase();
          const l = (e.label || '').toLowerCase();
          return n.includes('item') || n.includes('product') || n.includes('goods')
            || n.includes('zboz') || n.includes('artik') || n.includes('mater')
            || l.includes('zboží') || l.includes('výrobek') || l.includes('artikl');
        });

        if (candidates.length > 0) {
          for (const c of candidates) {
            try {
              console.log(`Zkouším kandidáta: ${c.name} (${c.label || ''})`);
              data = await this.queryEntity(c.name);
              usedEntity = c.name;
              break;
            } catch (e) {
              console.log(`Kandidát ${c.name} selhal:`, e.message);
            }
          }
        }
      }

      if (!data) {
        throw new Error('Nepodařilo se najít entitu pro zboží v Factorify');
      }

      const items = this.extractArray(data);
      console.log(`Načteno ${items.length} položek z entity ${usedEntity}`);

      const allProducts = items.map(item => {
        // Typ může být string nebo objekt { id, label }
        const rawType = item.type || item.Type || item.itemType || item.ItemType || '';
        let typeName = '';
        if (typeof rawType === 'object' && rawType !== null) {
          typeName = rawType.label || rawType.name || rawType.Name || String(rawType.id || '');
        } else {
          typeName = String(rawType);
        }
        return {
          id: item.id || item.ID || item.Id,
          name: item.label || item.name || item.Name || item.title || ('Položka ' + (item.id || '')),
          code: item.code || item.Code || item.referenceName || item.ReferenceName || '',
          type: typeName,
          raw: item,
        };
      });

      // Filtrovat pouze výrobky
      this.products = allProducts.filter(p => {
        const t = (p.type || '').toLowerCase();
        return t.includes('výrobek') || t.includes('vyrobek') || t.includes('product')
          || t.includes('manufactured') || t.includes('produced');
      });

      console.log(`Filtrováno: ${this.products.length} výrobků z ${allProducts.length} celkem`);

      // Pokud filtr nenašel nic, ukázat vše (fallback)
      if (this.products.length === 0) {
        console.warn('Žádné zboží s typem "výrobek" — zobrazuji vše');
        this.products = allProducts;
      }

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
      const data = await this.queryEntity('Stage');
      const items = this.extractArray(data);
      this.stages = items.map(item => ({
        id: item.id || item.ID,
        name: item.label || item.name || item.Name || ('Pracoviště ' + (item.id || '')),
        code: item.code || item.Code || item.referenceName || '',
        raw: item,
      }));
      return this.stages;
    } catch (e) {
      console.error('loadStages error:', e);
      return [];
    }
  },

  // ---- Načíst pracovní postup pro zboží ----
  async loadRoute(itemId) {
    if (this.routes[itemId]) return this.routes[itemId];

    try {
      // Zkusit entity: WorkOperation, Operation, Route, TechnologicalRoute, ...
      const routeEntities = [
        'WorkOperation', 'Operation', 'ProductionOperation',
        'TechnologicalRoute', 'Route', 'BOM', 'BillOfMaterial',
        'ManufacturingRoute', 'ProductionRoute', 'RoutingOperation',
      ];

      let data = null;
      let usedEntity = null;

      for (const eName of routeEntities) {
        try {
          // Zkusit s filtrem na item
          data = await this.queryEntity(eName, { itemId: itemId });
          if (this.extractArray(data).length > 0) {
            usedEntity = eName;
            break;
          }
          // Zkusit bez filtru a filtrovat lokálně
          data = await this.queryEntity(eName);
          const all = this.extractArray(data);
          if (all.length > 0) {
            usedEntity = eName;
            break;
          }
        } catch (e) {}
      }

      if (!data && !usedEntity) {
        // Hledat dynamicky
        if (this.entities.length === 0) await this.loadEntities();
        const candidates = this.entities.filter(e => {
          const n = (e.name || '').toLowerCase();
          const l = (e.label || '').toLowerCase();
          return n.includes('oper') || n.includes('route') || n.includes('routing')
            || n.includes('postup') || l.includes('operac') || l.includes('postup');
        });

        for (const c of candidates) {
          try {
            data = await this.queryEntity(c.name);
            if (this.extractArray(data).length > 0) {
              usedEntity = c.name;
              break;
            }
          } catch (e) {}
        }
      }

      let operations = [];
      if (data) {
        const rawOps = this.extractArray(data);
        // Pokusit se filtrovat na itemId
        let filtered = rawOps.filter(op =>
          op.itemId === itemId || op.item === itemId ||
          op.productId === itemId || op.product === itemId ||
          (op.item && op.item.id === itemId)
        );
        if (filtered.length === 0) filtered = rawOps; // ukázat vše pokud nelze filtrovat

        operations = filtered.map((op, idx) => ({
          id: op.id || op.ID || idx,
          name: op.label || op.name || op.Name || op.operationName || ('Operace ' + (idx + 1)),
          stageId: op.stageId || op.stage || (op.stage && op.stage.id) || null,
          stageName: op.stageName || (op.stage && (op.stage.label || op.stage.name)) || '',
          duration: op.duration || op.time || op.operationTime || op.cycleTime || 60, // sekundy
          order: op.order || op.sequence || op.operationOrder || op.sort || idx + 1,
          raw: op,
        }));

        // Seřadit podle pořadí
        operations.sort((a, b) => a.order - b.order);
      }

      this.routes[itemId] = operations;
      console.log(`Postup pro item ${itemId}: ${operations.length} operací (z entity ${usedEntity || '?'})`);
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
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Načítám zboží z Factorify…</td></tr>';

  try {
    const products = await FactorifyAPI.loadProducts();
    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Žádné zboží nenalezeno</td></tr>';
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
  const product = FactorifyAPI.products.find(p => String(p.id) === String(productId));
  if (!product) return;

  state.selectedProduct = product;
  closeProductDialog();
  showToast('Zboží vybráno: ' + product.name);

  // Zobrazit info o zboží
  document.getElementById('product-info').innerHTML = `
    <div class="product-card">
      <div class="product-name">${product.name}</div>
      <div class="product-code">${product.code || ''}</div>
    </div>`;

  // Načíst pracovní postup
  document.getElementById('route-info').innerHTML = '<div class="empty-state">Načítám pracovní postup…</div>';

  try {
    const route = await FactorifyAPI.loadRoute(product.id);
    state.route = route;

    if (route.length === 0) {
      document.getElementById('route-info').innerHTML = `
        <div class="empty-state">
          Pracovní postup nenalezen v API.<br>
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
    const cls = '';
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

// Mapovat operace na pracoviště v půdorysu
function mapRouteToFloorPlan() {
  if (!state.route || !state.objects) return;

  state.route.forEach(op => {
    // Hledat pracoviště v objektech na plátně
    const match = state.objects.find(obj => {
      if (!obj.factorifyId) return false;
      return String(obj.factorifyId) === String(op.stageId);
    });

    if (match) {
      op.floorX = match.x + match.w / 2;
      op.floorY = match.y + match.h / 2;
      op.floorObj = match;
    } else {
      // Zkusit match podle názvu
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
  // Sestavit postup z pracovišť na plátně
  const wsObjects = state.objects.filter(o => o.type === 'pracoviste' || o.factorifyId);
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
      stageId: wsObj?.factorifyId || wsId,
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

  // Naplnit seznam programování
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

  // Načíst areál
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

  // Re-mapovat postup pokud existuje
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
