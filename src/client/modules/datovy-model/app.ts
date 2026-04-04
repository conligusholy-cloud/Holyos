/* ============================================
   app.ts — Factorify Browser
   Exact UI clone of bs.factorify.cloud/ui/
   ============================================ */

import { FactorifyBrowser, EntityFieldMeta } from './factorify-api.js';
import { MENU, TOP_ITEMS, MenuCategory, MenuItem, buildEntityResolver } from './factorify-menu.js';

// ---- State ----

interface AppState {
  // Navigation
  activeSlug: string | null;
  activeEntityName: string | null;
  activeLabel: string | null;
  expandedCategories: Set<string>;
  sidebarSearch: string;
  sidebarCollapsed: boolean;

  // Table
  rows: any[];
  totalCount: number;
  fields: EntityFieldMeta[];
  page: number;
  pageSize: number;
  orderBy: string;
  orderDir: string;
  search: string;
  columnFilters: Record<string, string>;
  loading: boolean;

  // Detail
  detailRecord: any | null;
  detailTab: string;

  // Entity name resolver
  entityResolver: Map<string, string>;
}

const state: AppState = {
  activeSlug: null,
  activeEntityName: null,
  activeLabel: null,
  expandedCategories: new Set<string>(),
  sidebarSearch: '',
  sidebarCollapsed: false,

  rows: [],
  totalCount: 0,
  fields: [],
  page: 0,
  pageSize: 50,
  orderBy: '',
  orderDir: 'ASC',
  search: '',
  columnFilters: {},
  loading: false,

  detailRecord: null,
  detailTab: 'OBECNÉ',

  entityResolver: new Map(),
};

// ---- Init ----

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await FactorifyBrowser.loadEntities();
    // Build comprehensive entity resolver from API metadata
    state.entityResolver = buildEntityResolver(
      FactorifyBrowser.entities.map(e => ({ name: e.name, endpointUrl: e.endpointUrl, label: e.label }))
    );
    // Expand all categories by default
    for (const cat of MENU) {
      state.expandedCategories.add(cat.name);
    }
    renderNav();
    renderMain();
    updateStatus('connected', FactorifyBrowser.entities.length + ' entit');
  } catch (err) {
    updateStatus('disconnected', 'Chyba: ' + (err as Error).message);
  }

  // Sidebar search
  const searchEl = document.getElementById('entity-search') as HTMLInputElement;
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.sidebarSearch = searchEl.value;
      renderNav();
    });
  }
});

// ---- Resolve entity name from menu item ----

function resolveEntity(item: MenuItem): string {
  // 1. Direct match in API entities
  if (FactorifyBrowser.entityMap.has(item.entityName)) {
    return item.entityName;
  }
  // 2. Try resolver with entityName
  const byName = state.entityResolver.get(item.entityName) || state.entityResolver.get(item.entityName.toLowerCase());
  if (byName) return byName;
  // 3. Try resolver with slug
  const bySlug = state.entityResolver.get(item.slug);
  if (bySlug) return bySlug;
  // 4. Fallback: return entityName (will show error in UI if not found)
  return item.entityName;
}

// ---- Sidebar navigation ----

function renderNav(): void {
  const container = document.getElementById('fy-nav');
  if (!container) return;

  const q = state.sidebarSearch.toLowerCase();
  let html = '';

  // Top items
  for (const item of TOP_ITEMS) {
    if (q && !item.label.toLowerCase().includes(q)) continue;
    const isActive = state.activeSlug === item.slug;
    const icon = item.slug === 'daily-report' ? '📋' : '📊';
    html += '<div class="fy-nav-top-item' + (isActive ? ' active' : '') + '" data-slug="' + item.slug + '">' +
      '<span class="fy-nav-top-icon">' + icon + '</span>' +
      '<span>' + esc(item.label) + '</span>' +
    '</div>';
  }

  // Categories with items
  for (const cat of MENU) {
    const filtered = q
      ? cat.items.filter(it => it.label.toLowerCase().includes(q))
      : cat.items;
    if (filtered.length === 0) continue;

    const isExpanded = state.expandedCategories.has(cat.name) || !!q;
    const arrow = isExpanded ? '▾' : '▸';

    html += '<div class="fy-cat-header" data-cat="' + esc(cat.name) + '">' +
      '<span class="fy-cat-arrow">' + arrow + '</span>' +
      '<span>' + esc(cat.name) + '</span>' +
    '</div>';

    if (isExpanded) {
      for (const item of filtered) {
        const isActive = state.activeSlug === item.slug;
        html += '<div class="fy-nav-item' + (isActive ? ' active' : '') + '" data-slug="' + esc(item.slug) + '">' +
          '<span class="fy-nav-item-icon">●</span>' +
          '<span>' + esc(item.label) + '</span>' +
        '</div>';
      }
    }
  }

  container.innerHTML = html;

  // Event delegation for nav clicks
  container.onclick = (e: Event) => {
    const target = e.target as HTMLElement;

    // Category toggle
    const catHeader = target.closest('.fy-cat-header') as HTMLElement;
    if (catHeader && catHeader.dataset.cat) {
      toggleCategory(catHeader.dataset.cat);
      return;
    }

    // Nav item click
    const navItem = target.closest('.fy-nav-item, .fy-nav-top-item') as HTMLElement;
    if (navItem && navItem.dataset.slug) {
      openBySlug(navItem.dataset.slug);
    }
  };
}

// ---- Main content ----

function renderMain(): void {
  const main = document.getElementById('fy-main');
  if (!main) return;

  if (state.detailRecord) {
    renderDetail(main);
    return;
  }

  if (!state.activeEntityName) {
    main.innerHTML = '<div class="fy-welcome">' +
      '<div class="fy-welcome-icon">📋</div>' +
      '<h2>Factorify Browser</h2>' +
      '<p>Vyberte položku z navigace vlevo</p>' +
    '</div>';
    return;
  }

  if (state.loading) {
    main.innerHTML = '<div class="fy-loading"><div class="fy-spinner"></div><p style="color:#999">Načítám data...</p></div>';
    return;
  }

  renderTable(main);
}

// ---- Table view ----

function renderTable(container: HTMLElement): void {
  const visibleFields = state.fields.slice(0, 12);
  const label = state.activeLabel || state.activeEntityName || '';

  // Toolbar
  let html = '<div class="fy-toolbar">' +
    '<div class="fy-toolbar-title">' +
      '<span class="fy-toolbar-title-icon">📋</span>' +
      '<span>' + esc(label) + '</span>' +
    '</div>' +
    '<div class="fy-toolbar-spacer"></div>' +
    '<div class="fy-toolbar-actions">' +
      '<div class="fy-search-box">' +
        '<input type="text" id="fy-search-input" placeholder="Fulltextové hledání..." value="' + esc(state.search) + '">' +
        '<button id="fy-search-btn">&#128269;</button>' +
      '</div>' +
      '<span class="fy-record-count">' + state.totalCount.toLocaleString('cs-CZ') + ' záznamů</span>' +
    '</div>' +
  '</div>';

  // Tab row (entity name as single tab, like Factorify)
  html += '<div class="fy-tabs">' +
    '<div class="fy-tab active">' + esc(label) + '</div>' +
  '</div>';

  // Table
  html += '<div class="fy-table-wrapper"><table class="fy-table"><thead>';

  // Header row
  html += '<tr>';
  for (const f of visibleFields) {
    const isSorted = state.orderBy === f.name;
    const sortIcon = isSorted ? (state.orderDir === 'ASC' ? '<span class="fy-sort-icon">▲</span>' : '<span class="fy-sort-icon">▼</span>') : '';
    html += '<th data-field="' + esc(f.name) + '">' + esc(f.label) + sortIcon + '</th>';
  }
  html += '</tr>';

  // Filter row
  html += '<tr class="filter-row">';
  for (const f of visibleFields) {
    const filterVal = state.columnFilters[f.name] || '';
    html += '<th><input class="fy-filter-input" data-filter-field="' + esc(f.name) + '" placeholder="=" value="' + esc(filterVal) + '"></th>';
  }
  html += '</tr>';

  html += '</thead><tbody>';

  // Rows
  if (state.rows.length === 0) {
    html += '<tr><td colspan="' + visibleFields.length + '" class="fy-no-data">Žádné záznamy</td></tr>';
  } else {
    for (const row of state.rows) {
      const rowId = row.id || row.ID || '';
      html += '<tr data-entity="' + esc(state.activeEntityName || '') + '" data-id="' + esc(String(rowId)) + '">';
      for (const f of visibleFields) {
        html += '<td>' + formatCell(row[f.name], f.name) + '</td>';
      }
      html += '</tr>';
    }
  }

  html += '</tbody></table></div>';

  // Bottom bar (pagination)
  const totalPages = Math.ceil(state.totalCount / state.pageSize);
  const currentPage = state.page + 1;
  const from = state.totalCount > 0 ? state.page * state.pageSize + 1 : 0;
  const to = Math.min((state.page + 1) * state.pageSize, state.totalCount);

  html += '<div class="fy-bottom-bar">' +
    '<button class="fy-page-btn" data-page="0" ' + (state.page === 0 ? 'disabled' : '') + '>&#171;</button>' +
    '<button class="fy-page-btn" data-page="' + (state.page - 1) + '" ' + (state.page === 0 ? 'disabled' : '') + '>&#8249;</button>' +
    '<span class="fy-page-info">' + currentPage + ' / ' + (totalPages || 1) + '</span>' +
    '<button class="fy-page-btn" data-page="' + (state.page + 1) + '" ' + (currentPage >= totalPages ? 'disabled' : '') + '>&#8250;</button>' +
    '<button class="fy-page-btn" data-page="' + (totalPages - 1) + '" ' + (currentPage >= totalPages ? 'disabled' : '') + '>&#187;</button>' +
    '<select class="fy-page-size" id="fy-page-size">' +
      '<option value="25"' + (state.pageSize === 25 ? ' selected' : '') + '>25</option>' +
      '<option value="50"' + (state.pageSize === 50 ? ' selected' : '') + '>50</option>' +
      '<option value="100"' + (state.pageSize === 100 ? ' selected' : '') + '>100</option>' +
    '</select>' +
    '<span class="fy-page-spacer"></span>' +
    '<span class="fy-page-secondary">' + from + '–' + to + ' z ' + state.totalCount.toLocaleString('cs-CZ') + '</span>' +
  '</div>';

  container.innerHTML = html;
  bindTableEvents(container);
}

function bindTableEvents(container: HTMLElement): void {
  // Row clicks
  const tableWrapper = container.querySelector('.fy-table-wrapper');
  if (tableWrapper) {
    tableWrapper.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('fy-ref')) return;

      // Sort click on th
      const th = target.closest('thead tr:first-child th') as HTMLElement;
      if (th && th.dataset.field && !th.closest('.filter-row')) {
        sortBy(th.dataset.field);
        return;
      }

      // Row click
      const row = target.closest('tbody tr') as HTMLElement;
      if (row && row.dataset.entity && row.dataset.id) {
        openRecord(row.dataset.entity, row.dataset.id);
      }
    });
  }

  // Column filter inputs
  const filterInputs = container.querySelectorAll('.fy-filter-input');
  filterInputs.forEach((input) => {
    (input as HTMLInputElement).addEventListener('keydown', (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        applyColumnFilters();
      }
    });
  });

  // Search
  const searchInput = container.querySelector('#fy-search-input') as HTMLInputElement;
  const searchBtn = container.querySelector('#fy-search-btn');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') doSearch();
    });
  }
  if (searchBtn) {
    searchBtn.addEventListener('click', () => doSearch());
  }

  // Pagination
  container.querySelectorAll('.fy-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt((btn as HTMLElement).dataset.page || '0', 10);
      goToPage(p);
    });
  });

  const pageSizeSelect = container.querySelector('#fy-page-size') as HTMLSelectElement;
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      state.pageSize = parseInt(pageSizeSelect.value, 10) || 50;
      state.page = 0;
      refreshData();
    });
  }
}

// ---- Record detail view ----

function renderDetail(container: HTMLElement): void {
  const rec = state.detailRecord;
  const entityName = state.activeEntityName || '';
  const label = state.activeLabel || entityName;

  // Toolbar
  let html = '<div class="fy-detail-toolbar">' +
    '<button class="fy-back-btn" id="fy-back-btn">&#8592; Zpět</button>' +
    '<span class="fy-detail-title">' + esc(label) + ': ' + (rec.id || rec.ID || '') + '</span>' +
  '</div>';

  // Tabs
  const tabs = ['OBECNÉ', 'SOUVISEJÍCÍ ENTITY', 'HISTORIE'];
  html += '<div class="fy-detail-tabs">';
  for (const tab of tabs) {
    html += '<div class="fy-detail-tab' + (state.detailTab === tab ? ' active' : '') + '" data-tab="' + esc(tab) + '">' + esc(tab) + '</div>';
  }
  html += '</div>';

  // Form fields
  html += '<div class="fy-detail-form">';

  // Group fields: first the ones we have metadata for, then the rest
  const knownKeys = state.fields.map(f => f.name);
  const allKeys = Object.keys(rec).filter(k => k !== 'warnings' && k !== 'classNameForRequestHash' && k !== 'requestHash');

  // Separate into sections: primary fields, then extra
  const primaryKeys = allKeys.filter(k => knownKeys.includes(k));
  const extraKeys = allKeys.filter(k => !knownKeys.includes(k) && k !== 'id' && k !== 'ID');

  // Primary section
  html += '<div class="fy-detail-section">';
  html += '<div class="fy-detail-section-header">▾ Obecné údaje</div>';
  html += '<div class="fy-detail-fields">';
  // Always show ID first
  html += '<div class="fy-field">' +
    '<div class="fy-field-label">ID</div>' +
    '<div class="fy-field-value">' + esc(String(rec.id || rec.ID || '')) + '</div>' +
  '</div>';

  for (const key of primaryKeys) {
    const val = rec[key];
    const fieldMeta = state.fields.find(f => f.name === key);
    const fieldLabel = fieldMeta?.label || key;
    html += '<div class="fy-field">' +
      '<div class="fy-field-label">' + esc(fieldLabel) + '</div>' +
      '<div class="fy-field-value">' + formatDetailVal(val, key) + '</div>' +
    '</div>';
  }
  html += '</div></div>'; // close fields + section

  // Extra fields section
  if (extraKeys.length > 0) {
    html += '<div class="fy-detail-section">';
    html += '<div class="fy-detail-section-header">▾ Další pole</div>';
    html += '<div class="fy-detail-fields">';
    for (const key of extraKeys) {
      html += '<div class="fy-field">' +
        '<div class="fy-field-label">' + esc(key) + '</div>' +
        '<div class="fy-field-value">' + formatDetailVal(rec[key], key) + '</div>' +
      '</div>';
    }
    html += '</div></div>';
  }

  html += '</div>'; // close form

  // Action bar
  const now = new Date();
  const timestamp = now.toLocaleDateString('cs-CZ') + ' ' + now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  html += '<div class="fy-action-bar">' +
    '<button class="fy-action-btn" id="fy-action-menu">AKCE ▾</button>' +
    '<div class="fy-action-spacer"></div>' +
    '<span class="fy-action-timestamp">' + timestamp + '</span>' +
  '</div>';

  container.innerHTML = html;

  // Bind events
  const backBtn = container.querySelector('#fy-back-btn');
  if (backBtn) backBtn.addEventListener('click', closeDetail);

  // Tab clicks
  container.querySelectorAll('.fy-detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.detailTab = (tab as HTMLElement).dataset.tab || 'OBECNÉ';
      renderMain();
    });
  });
}

// ---- Format values ----

function formatCell(val: any, _fieldName: string): string {
  if (val === null || val === undefined) return '<span class="fy-null">—</span>';
  if (typeof val === 'boolean') return val ? '<span class="fy-bool-true">✓</span>' : '<span class="fy-bool-false"></span>';

  // Reference object
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const display = val.referenceName || val.name || val.label || val.code || val.id || '';
    const targetEntity = val.classNameForRequestHash || '';
    const targetId = val.id || '';
    if (targetEntity && targetId) {
      return '<a class="fy-ref" data-entity="' + esc(targetEntity) + '" data-id="' + esc(String(targetId)) + '" onclick="event.stopPropagation(); window.__openRecord(this.dataset.entity, this.dataset.id)">' + esc(String(display)) + '</a>';
    }
    return '<span style="color:#1976d2">' + esc(String(display)) + '</span>';
  }

  if (Array.isArray(val)) return '<span class="fy-array">[' + val.length + ']</span>';

  // DateTime
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    try {
      const d = new Date(val);
      return d.toLocaleDateString('cs-CZ') + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    } catch { return esc(val); }
  }

  // Date
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    try { return new Date(val).toLocaleDateString('cs-CZ'); } catch { return esc(val); }
  }

  // Number
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : val.toLocaleString('cs-CZ', { maximumFractionDigits: 4 });
  }

  const s = String(val);
  return s.length > 80 ? esc(s.substring(0, 77)) + '…' : esc(s);
}

function formatDetailVal(val: any, key: string): string {
  if (val === null || val === undefined) return '<span class="fy-null">—</span>';
  if (typeof val === 'boolean') return val ? '<span class="fy-bool-true">Ano</span>' : '<span class="fy-bool-false">Ne</span>';

  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const targetEntity = val.classNameForRequestHash || '';
    const targetId = val.id || '';
    const display = val.referenceName || val.name || val.label || val.code || String(val.id || '');
    if (targetEntity && targetId) {
      return '<a class="fy-ref" data-entity="' + esc(targetEntity) + '" data-id="' + esc(String(targetId)) + '" onclick="window.__openRecord(this.dataset.entity, this.dataset.id)">' + esc(String(display)) + '</a>';
    }
    return '<span style="color:#1976d2">' + esc(String(display)) + '</span>';
  }

  if (Array.isArray(val)) {
    if (val.length === 0) return '<span class="fy-null">prázdné</span>';
    return '<span class="fy-array">' + val.length + ' položek</span>';
  }

  return formatCell(val, key);
}

// ---- Actions ----

async function openBySlug(slug: string): Promise<void> {
  // Find the menu item
  let item: MenuItem | undefined;
  for (const top of TOP_ITEMS) {
    if (top.slug === slug) { item = top; break; }
  }
  if (!item) {
    for (const cat of MENU) {
      for (const it of cat.items) {
        if (it.slug === slug) { item = it; break; }
      }
      if (item) break;
    }
  }
  if (!item) return;

  const entityName = resolveEntity(item);

  state.activeSlug = slug;
  state.activeEntityName = entityName || null;
  state.activeLabel = item.label;
  state.detailRecord = null;
  state.detailTab = 'OBECNÉ';
  state.page = 0;
  state.search = '';
  state.orderBy = '';
  state.orderDir = 'ASC';
  state.columnFilters = {};
  state.rows = [];
  state.totalCount = 0;
  state.fields = [];

  renderNav();

  // UI-only view (no queryable entity)
  if (!entityName) {
    state.loading = false;
    const main = document.getElementById('fy-main');
    if (main) {
      main.innerHTML = '<div class="fy-welcome">' +
        '<div class="fy-welcome-icon" style="font-size:48px">📊</div>' +
        '<h2>' + esc(item.label) + '</h2>' +
        '<p style="color:#999">Tato položka je v originálním Factorify speciální pohled (view), který není dostupný přes datové API.</p>' +
      '</div>';
    }
    updateStatus('connected', item.label + ' — pohled');
    return;
  }

  state.loading = true;
  renderMain();

  try {
    const [fields, result] = await Promise.all([
      FactorifyBrowser.loadFields(entityName),
      FactorifyBrowser.queryRecords(entityName, { offset: 0, limit: state.pageSize }),
    ]);
    state.fields = fields;
    state.rows = result.rows;
    state.totalCount = result.totalCount;
    state.loading = false;
    renderMain();
    updateStatus('connected', entityName + ' — ' + result.totalCount.toLocaleString('cs-CZ') + ' záznamů');
  } catch (err) {
    state.loading = false;
    state.rows = [];
    state.totalCount = 0;
    state.fields = [];
    renderMain();
    const errMsg = (err as Error).message || '';
    if (errMsg.includes('404') || errMsg.includes('Entity')) {
      updateStatus('disconnected', 'Entita "' + entityName + '" není dostupná v API');
      // Show inline error in main area
      const main = document.getElementById('fy-main');
      if (main) {
        main.innerHTML = '<div class="fy-welcome">' +
          '<div class="fy-welcome-icon" style="font-size:48px">⚠️</div>' +
          '<h2 style="color:#f57c00">Entita nenalezena</h2>' +
          '<p>API vrátilo chybu pro entitu: <strong>' + esc(entityName) + '</strong></p>' +
          '<p style="font-size:12px;color:#999;margin-top:8px">Tato položka nemusí být dostupná přes API, nebo má jiný název entity.</p>' +
        '</div>';
      }
    } else {
      updateStatus('disconnected', 'Chyba: ' + errMsg);
    }
  }
}

async function openEntityDirect(entityName: string): Promise<void> {
  state.activeEntityName = entityName;
  state.activeLabel = entityName;
  state.activeSlug = null;
  state.detailRecord = null;
  state.detailTab = 'OBECNÉ';
  state.page = 0;
  state.search = '';
  state.orderBy = '';
  state.orderDir = 'ASC';
  state.columnFilters = {};
  state.loading = true;

  renderNav();
  renderMain();

  try {
    const [fields, result] = await Promise.all([
      FactorifyBrowser.loadFields(entityName),
      FactorifyBrowser.queryRecords(entityName, { offset: 0, limit: state.pageSize }),
    ]);
    state.fields = fields;
    state.rows = result.rows;
    state.totalCount = result.totalCount;
    state.loading = false;
    renderMain();
    updateStatus('connected', entityName + ' — ' + result.totalCount.toLocaleString('cs-CZ') + ' záznamů');
  } catch (err) {
    state.loading = false;
    state.rows = [];
    state.totalCount = 0;
    renderMain();
    updateStatus('disconnected', 'Chyba: ' + (err as Error).message);
  }
}

async function refreshData(): Promise<void> {
  if (!state.activeEntityName) return;
  state.loading = true;
  renderMain();

  try {
    const result = await FactorifyBrowser.queryRecords(state.activeEntityName, {
      offset: state.page * state.pageSize,
      limit: state.pageSize,
      orderBy: state.orderBy || undefined,
      orderDir: state.orderDir,
      search: state.search || undefined,
    });
    state.rows = result.rows;
    state.totalCount = result.totalCount;
    state.loading = false;
    renderMain();
  } catch (err) {
    state.loading = false;
    renderMain();
    updateStatus('disconnected', 'Chyba: ' + (err as Error).message);
  }
}

async function openRecord(entityName: string, recordId: string): Promise<void> {
  if (entityName !== state.activeEntityName) {
    state.activeEntityName = entityName;
    state.activeLabel = entityName;
    state.fields = await FactorifyBrowser.loadFields(entityName);
    renderNav();
  }

  state.loading = true;
  renderMain();

  try {
    const record = await FactorifyBrowser.getRecord(entityName, recordId);
    if (record) {
      state.detailRecord = record;
      state.detailTab = 'OBECNÉ';
      state.loading = false;
      renderMain();
    } else {
      state.loading = false;
      renderMain();
      updateStatus('disconnected', 'Záznam nenalezen');
    }
  } catch (err) {
    state.loading = false;
    renderMain();
    updateStatus('disconnected', 'Chyba: ' + (err as Error).message);
  }
}

function closeDetail(): void {
  state.detailRecord = null;
  renderMain();
}

function toggleCategory(cat: string): void {
  if (state.expandedCategories.has(cat)) {
    state.expandedCategories.delete(cat);
  } else {
    state.expandedCategories.add(cat);
  }
  renderNav();
}

function sortBy(field: string): void {
  if (state.orderBy === field) {
    state.orderDir = state.orderDir === 'ASC' ? 'DESC' : 'ASC';
  } else {
    state.orderBy = field;
    state.orderDir = 'ASC';
  }
  state.page = 0;
  refreshData();
}

function goToPage(p: number): void {
  const totalPages = Math.ceil(state.totalCount / state.pageSize);
  if (p < 0 || p >= totalPages) return;
  state.page = p;
  refreshData();
}

function doSearch(): void {
  const input = document.getElementById('fy-search-input') as HTMLInputElement;
  state.search = input?.value || '';
  state.page = 0;
  refreshData();
}

function applyColumnFilters(): void {
  // Gather all filter inputs
  const inputs = document.querySelectorAll('.fy-filter-input');
  state.columnFilters = {};
  inputs.forEach(input => {
    const el = input as HTMLInputElement;
    if (el.value.trim() && el.dataset.filterField) {
      state.columnFilters[el.dataset.filterField] = el.value.trim();
    }
  });
  // For now, use the first non-empty filter as search (Factorify API fulltext)
  // Column-level filtering would need server support
  const vals = Object.values(state.columnFilters);
  if (vals.length > 0) {
    state.search = vals.join(' ');
  } else {
    state.search = '';
  }
  state.page = 0;
  refreshData();
}

// ---- Helpers ----

function updateStatus(s: string, text: string): void {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (dot) dot.className = 'fy-status-dot ' + s;
  if (txt) txt.textContent = text;
}

function esc(str: string): string {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Expose to window ----

(window as any).__openRecord = openRecord;
(window as any).__openEntity = openEntityDirect;
(window as any).__closeDetail = closeDetail;
