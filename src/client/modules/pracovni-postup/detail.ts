/* ============================================
   detail.ts — Detail výrobku
   Hierarchická sestava zboží s rozbalováním
   ============================================ */

import { FactorifyAPI } from './factorify-api.js';
import { escapeHtml, showToast } from './app.js';

interface ManualAssignment {
  stageId: string;
  stageName: string;
  norm: number;
  unit: string;
  assignedAt?: string;
}

interface BOMItem {
  id: string | null;
  code: string;
  name: string;
  type: string;
  unit: string;
  quantity: number;
  perQuantity: number;
  operation: string;
  operationPos: number;
  parentCode: string;
  hasSubWorkflow: boolean;
  children: BOMItem[];
  expanded: boolean;
}

interface OperationNode {
  nodeType: 'operation' | 'goods';
  id?: string;
  code?: string;
  name: string;
  type?: string;
  unit?: string;
  quantity?: number;
  position?: number;
  stage?: string;
  stageType?: string;
  normDuration?: number;
  normUnit?: string;
  bomCount?: number;
  isExpandable?: boolean;
  children: OperationNode[];
  isMainOp?: boolean;
  isKoop?: boolean;
  raw?: unknown;
}

interface DOMReferences {
  productName: HTMLElement | null;
  productCode: HTMLElement | null;
  statusDot: HTMLElement | null;
  statusText: HTMLElement | null;
  tabContent: HTMLElement | null;
}

const state = {
  goodsId: null as string | null,
  product: null as unknown,
  workflow: null as unknown,
  operations: [] as unknown[],
  bomTree: [] as BOMItem[],
  totalCount: 0,
  goodsCache: {} as Record<string, unknown>,
  currentTab: 'sestava' as string,
  loading: false,
  manualAssignments: {} as Record<string, ManualAssignment>,
  stagesLoaded: false,
  stagesList: [] as any[],
};

const dom: DOMReferences = {
  productName: null,
  productCode: null,
  statusDot: null,
  statusText: null,
  tabContent: null,
};

// ---- Inicializace ----

document.addEventListener('DOMContentLoaded', () => {
  dom.productName = document.getElementById('product-name');
  dom.productCode = document.getElementById('product-code');
  dom.statusDot = document.getElementById('status-dot');
  dom.statusText = document.getElementById('status-text');
  dom.tabContent = document.getElementById('tab-content');

  const params = new URLSearchParams(window.location.search);
  state.goodsId = params.get('id');

  if (!state.goodsId) {
    if (dom.productName) dom.productName.textContent = 'Chybí ID výrobku';
    if (dom.tabContent) {
      dom.tabContent.innerHTML = '<div class="error-state"><div class="error-msg">V URL chybí parametr ?id=</div><a href="modules/pracovni-postup/index.html" class="btn">Zpět na seznam</a></div>';
    }
    return;
  }

  loadProductDetail(state.goodsId);
  loadStagesForAssignment();
});

// ---- Helpers pro lokalizovaný text ----

function locName(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'object' && val !== null) {
    const objVal = val as Record<string, unknown>;
    return String(objVal['2'] || objVal['1'] || Object.values(objVal)[0] || '');
  }
  return String(val);
}

// ---- Načíst detail jednoho zboží (s cache) ----

async function fetchGoodsDetail(goodsId: string | number): Promise<unknown> {
  const key = String(goodsId);
  if (state.goodsCache[key]) return state.goodsCache[key];

  // Zkusit různé endpointy — CARD token může mít jiná oprávnění
  const endpoints = [
    { path: '/api/goods/' + goodsId, method: 'GET', body: null },
    { path: '/api/query/Goods/' + goodsId, method: 'GET', body: null },
    { path: '/api/query/Goods', method: 'POST', body: { filter: { id: goodsId } } },
    { path: '/api/grid/Goods', method: 'POST', body: { filter: { id: goodsId } } },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await FactorifyAPI.fetchAPI(ep.path, {
        method: ep.method,
        body: ep.body,
      });
      // Pokud to je přímo objekt s workflow — je to detail
      if (resp && typeof resp === 'object' && 'workflow' in resp) {
        state.goodsCache[key] = resp;
        console.log(`[PP] Goods ${goodsId} načten přes ${ep.method} ${ep.path}`);
        return resp;
      }
      // Pokud to je seznam — najít odpovídající záznam
      const rows = FactorifyAPI.extractArray(resp);
      if (rows.length > 0) {
        const match = (rows as any[]).find(r => r.id == goodsId) || rows[0];
        state.goodsCache[key] = match;
        console.log(`[PP] Goods ${goodsId} načten přes ${ep.method} ${ep.path} (z ${rows.length} řádků)`);
        return match;
      }
    } catch (e) {
      console.log(`[PP] ${ep.method} ${ep.path} → ${(e as Error).message}`);
    }
  }

  console.warn(`[PP] Nelze načíst goods ${goodsId} — žádný endpoint nefungoval`);
  return null;
}

// ---- Extrahovat BOM z jednoho goods detailu ----

function extractBomFromGoods(goodsData: unknown, parentCode: string): BOMItem[] {
  const items: BOMItem[] = [];
  if (!goodsData || typeof goodsData !== 'object') return items;

  const gd = goodsData as any;
  if (!gd.workflow || !gd.workflow.operations) return items;

  const operations = (gd.workflow.operations as any[]).sort((a: any, b: any) => {
    return (a.position || a.operationPosition || 0) - (b.position || b.operationPosition || 0);
  });

  operations.forEach((op: any, opIdx: number) => {
    const bomItems = op.billOfMaterialsItems || [];
    const opName = locName(op.name) || locName(op.operationName) || '';

    bomItems.forEach((bom: any) => {
      const goods = bom.goods || {};
      const typeName = goods.type ? (goods.type.name || goods.type.referenceName || locName(goods.type)) : '';

      const unitObj = goods.unit || goods.measureUnit || bom.unit || {};
      const unitName = typeof unitObj === 'string' ? unitObj : (unitObj.name || unitObj.referenceName || locName(unitObj) || '');

      items.push({
        id: goods.id || null,
        code: goods.code || '',
        name: locName(goods.name),
        type: typeName,
        unit: unitName,
        quantity: bom.quantity || 0,
        perQuantity: bom.perQuantity || 1,
        operation: opName,
        operationPos: opIdx + 1,
        parentCode: parentCode || '',
        hasSubWorkflow: typeName.toLowerCase().includes('polotovar') || typeName.toLowerCase().includes('výrobek'),
        children: [],
        expanded: false,
      });
    });
  });

  return items;
}

// ---- Rekurzivní načítání — vrací stromovou strukturu ----

async function loadFullBom(goodsId: string | number, parentCode: string, depth: number, visited: Set<string>): Promise<BOMItem[]> {
  if (depth > 10) return [];
  const idStr = String(goodsId);
  if (visited.has(idStr)) return [];
  visited.add(idStr);

  const goodsData = await fetchGoodsDetail(goodsId);
  if (!goodsData) return [];

  const directItems = extractBomFromGoods(goodsData, parentCode);

  // Pro první úroveň uložit operace
  if (depth === 0) {
    state.product = goodsData;
    const gd = goodsData as any;
    if (gd.workflow && gd.workflow.operations) {
      state.workflow = gd.workflow;
      state.operations = (gd.workflow.operations as any[]).sort((a: any, b: any) =>
        (a.position || 0) - (b.position || 0)
      );
    }
  }

  // Počítat průběžně
  state.totalCount += directItems.length;
  updateStatus('loading', `Načítám sestavu... ${state.totalCount} položek`);
  renderSestavaCounts();

  // Rekurzivně načíst children pro pod-sestavy
  const subItems = directItems.filter(i => i.hasSubWorkflow && i.id && !visited.has(String(i.id)));

  for (let i = 0; i < subItems.length; i += 5) {
    const batch = subItems.slice(i, i + 5);
    await Promise.all(
      batch.map(async item => {
        item.children = await loadFullBom(item.id!, item.code, depth + 1, visited);
      })
    );
  }

  return directItems;
}

// ---- Spočítat celkový počet v podstromu ----

function countTree(items: BOMItem[]): number {
  let n = 0;
  for (const item of items) {
    n += 1;
    if (item.children && item.children.length > 0) {
      n += countTree(item.children);
    }
  }
  return n;
}

// ---- Hlavní načítání ----

async function loadProductDetail(goodsId: string): Promise<void> {
  updateStatus('loading', 'Načítám detail...');
  state.bomTree = [];
  state.totalCount = 0;
  state.goodsCache = {};
  state.loading = true;

  try {
    if (!FactorifyAPI.configLoaded) await FactorifyAPI.loadEnv();

    const mainData = await fetchGoodsDetail(goodsId);
    if (!mainData) throw new Error('Výrobek nenalezen');

    state.product = mainData;
    const md = mainData as any;
    const name = locName(md.name);
    const code = md.code || '';

    if (dom.productName) dom.productName.textContent = name || 'Bez názvu';
    if (dom.productCode) dom.productCode.textContent = code;
    document.title = `${code} ${name} | Pracovní postup`;

    if (md.workflow && md.workflow.operations) {
      state.workflow = md.workflow;
      state.operations = (md.workflow.operations as any[]).sort((a: any, b: any) =>
        (a.position || 0) - (b.position || 0)
      );
    }

    renderCurrentTab();

    // Rekurzivně načíst kompletní strom BOM
    const visited = new Set<string>();
    state.totalCount = 0;
    state.bomTree = await loadFullBom(goodsId, code, 0, visited);

    state.loading = false;
    state.totalCount = countTree(state.bomTree);
    updateStatus('connected', `${state.operations.length} operací · ${state.totalCount} položek`);
    renderCurrentTab();

  } catch (err) {
    state.loading = false;
    updateStatus('disconnected', 'Chyba');
    if (dom.tabContent) {
      dom.tabContent.innerHTML = `
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <div class="error-msg">${escapeHtml((err as Error).message)}</div>
          <button class="btn" onclick="loadProductDetail('${state.goodsId}')">Zkusit znovu</button>
        </div>`;
    }
  }
}

// ---- Záložky ----

export function switchTab(tabId: string): void {
  state.currentTab = tabId;
  document.querySelectorAll('.tab').forEach(t => {
    (t as HTMLElement).classList.toggle('active', (t as HTMLElement).dataset.tab === tabId);
  });
  renderCurrentTab();
}

function renderCurrentTab(): void {
  switch (state.currentTab) {
    case 'sestava': renderSestava(); break;
    case 'postup': renderPostup(); break;
    case 'normovane': renderNormovane(); break;
    case 'vizualizace': renderVizualizace(); break;
  }
}

// ---- TAB: Sestava zboží (hierarchický strom) ----

function renderSestavaCounts(): void {
  const badge = document.querySelector('.count-badge');
  if (badge) badge.textContent = state.totalCount + ' položek' + (state.loading ? '...' : '');
}

function renderSestava(): void {
  const items = state.bomTree;

  if (!dom.tabContent) return;

  if (items.length === 0 && !state.loading) {
    dom.tabContent.innerHTML = '<div class="empty-state"><p>Žádné položky v sestavě</p></div>';
    return;
  }

  // Unikátní typy pro dropdown filtr
  const allTypes = new Set<string>();
  function collectTypes(arr: BOMItem[]): void {
    arr.forEach(i => {
      if (i.type) allTypes.add(i.type);
      if (i.children) collectTypes(i.children);
    });
  }
  collectTypes(items);
  const uniqueTypes = [...allTypes].sort();

  let html = `
    <div class="table-toolbar">
      <span class="count-badge" id="visible-count">${state.totalCount} položek${state.loading ? '...' : ''}</span>
      ${state.loading ? '<span class="loading-inline"><span class="loading-spinner-sm"></span> Načítám pod-sestavy...</span>' : ''}
    </div>
    <div class="table-wrapper">
      <table class="data-table tree-table" id="bom-table">
        <thead>
          <tr>
            <th class="col-expand"></th>
            <th class="col-id">ID zboží</th>
            <th class="col-code">Kód</th>
            <th class="col-name">Zboží</th>
            <th class="col-qty">Množství</th>
            <th class="col-unit">Jednotka</th>
            <th class="col-type">Typ</th>
            <th class="col-op">Operace</th>
          </tr>
          <tr class="filter-row">
            <td class="filter-tree-actions">
              <span class="filter-icon-btn" onclick="expandAll()" title="Rozbalit vše">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span class="filter-icon-btn" onclick="collapseAll()" title="Zabalit vše">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </td>
            <td><input type="text" class="col-filter" data-col="id" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter" data-col="code" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter" data-col="name" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter col-filter-narrow" data-col="qty" placeholder="=" oninput="applyFilters()"></td>
            <td><input type="text" class="col-filter col-filter-narrow" data-col="unit" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
            <td>
              <select class="col-filter-select" data-col="type" onchange="applyFilters()">
                <option value="">&#x25BD;</option>
                ${uniqueTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
              </select>
            </td>
            <td><input type="text" class="col-filter" data-col="op" placeholder="&#x1F50D;" oninput="applyFilters()"></td>
          </tr>
        </thead>
        <tbody>`;

  // Vykreslit strom s konektorovými čarami
  html += renderTreeRows(items, 0, []);

  html += '</tbody></table></div>';
  dom.tabContent.innerHTML = html;
}

// Generovat SVG čáry pro stromovou strukturu
function renderTreeLines(ancestors: boolean[], isLast: boolean, hasKids: boolean): string {
  const W = 20; // šířka jedné úrovně
  const depth = ancestors.length;
  const totalW = (depth + 1) * W;
  let svg = `<svg class="tree-lines" width="${totalW}" height="32" viewBox="0 0 ${totalW} 32">`;

  // Vertikální čáry pro předchozí úrovně (tam kde rodič má další sourozence)
  for (let i = 0; i < ancestors.length; i++) {
    if (ancestors[i]) {
      const x = i * W + W / 2;
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="32" class="tl"/>`;
    }
  }

  // Aktuální úroveň — vodorovná větev
  if (depth > 0) {
    const x = (depth - 1) * W + W / 2;
    const xEnd = depth * W;
    // Vertikální čára shora dolů (nebo jen do poloviny pokud je poslední)
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${isLast ? 16 : 32}" class="tl"/>`;
    // Vodorovná čára
    svg += `<line x1="${x}" y1="16" x2="${xEnd}" y2="16" class="tl"/>`;
  }

  svg += '</svg>';
  return svg;
}

// Rekurzivně generovat HTML řádky stromu
function renderTreeRows(items: BOMItem[], depth: number, ancestors: boolean[]): string {
  let html = '';
  items.forEach((item, idx) => {
    const typeClass = getTypeClass(item.type);
    const qtyStr = item.quantity + (item.perQuantity > 1 ? ' / ' + item.perQuantity : '');
    const hasKids = item.children && item.children.length > 0;
    const rowId = `row-${depth}-${item.id || idx}-${Math.random().toString(36).substr(2, 5)}`;
    const childCount = hasKids ? countTree(item.children) : 0;
    const isLast = idx === items.length - 1;

    // Stromové čáry
    const treeLines = renderTreeLines(ancestors, isLast, hasKids);

    // Toggle tlačítko
    const toggleBtn = hasKids
      ? `<span class="tree-toggle" data-row-id="${rowId}" onclick="toggleTreeNode(this, '${rowId}')">
           <span class="tree-icon">&#9654;</span>
           <span class="tree-child-count">${childCount}</span>
         </span>`
      : '';

    html += `
      <tr class="tree-row depth-${depth}" data-depth="${depth}" data-row-id="${rowId}"
          data-id="${item.id || ''}" data-code="${escapeHtml(item.code).toLowerCase()}"
          data-name="${escapeHtml(item.name).toLowerCase()}" data-qty="${qtyStr}"
          data-unit="${escapeHtml(item.unit || '').toLowerCase()}" data-type="${escapeHtml(item.type).toLowerCase()}"
          data-op="${escapeHtml(item.operation).toLowerCase()}">
        <td class="col-expand"><div class="tree-cell">${treeLines}${toggleBtn}</div></td>
        <td class="col-id">${item.id || '—'}</td>
        <td class="col-code"><strong>${escapeHtml(item.code)}</strong></td>
        <td class="col-name">${escapeHtml(item.name) || '—'}</td>
        <td class="col-qty">${qtyStr}</td>
        <td class="col-unit">${escapeHtml(item.unit || '')}</td>
        <td class="col-type"><span class="type-badge ${typeClass}">${escapeHtml(item.type) || '—'}</span></td>
        <td class="col-op"><span class="op-badge">${item.operationPos}</span> ${escapeHtml(item.operation)}</td>
      </tr>`;

    // Children — skryté, vyrenderované rovnou
    if (hasKids) {
      // Pro children: ancestors rozšířit o to, jestli MÁ aktuální item ještě sourozence pod sebou
      const childAncestors = [...ancestors, !isLast];
      html += `<tr class="tree-children-container" data-parent-row="${rowId}" style="display:none"><td colspan="8" style="padding:0">
        <table class="tree-subtable"><tbody>`;
      html += renderTreeRows(item.children, depth + 1, childAncestors);
      html += `</tbody></table></td></tr>`;
    }
  });
  return html;
}

// Rozbalit / sbalit uzel stromu
export function toggleTreeNode(toggleEl: HTMLElement, rowId: string): void {
  const childRow = document.querySelector(`tr.tree-children-container[data-parent-row="${rowId}"]`) as HTMLElement | null;
  if (!childRow) return;

  const isOpen = childRow.style.display !== 'none';
  childRow.style.display = isOpen ? 'none' : '';

  const icon = toggleEl.querySelector('.tree-icon') as HTMLElement | null;
  if (icon) {
    icon.innerHTML = isOpen ? '&#9654;' : '&#9660;'; // ► vs ▼
  }
  toggleEl.classList.toggle('expanded', !isOpen);
}

// Rozbalit/sbalit vše
export function expandAll(): void {
  document.querySelectorAll('tr.tree-children-container').forEach(tr => (tr as HTMLElement).style.display = '');
  document.querySelectorAll('.tree-toggle').forEach(t => {
    t.classList.add('expanded');
    const icon = t.querySelector('.tree-icon');
    if (icon) icon.innerHTML = '&#9660;';
  });
}

export function collapseAll(): void {
  document.querySelectorAll('tr.tree-children-container').forEach(tr => (tr as HTMLElement).style.display = 'none');
  document.querySelectorAll('.tree-toggle').forEach(t => {
    t.classList.remove('expanded');
    const icon = t.querySelector('.tree-icon');
    if (icon) icon.innerHTML = '&#9654;';
  });
}

function getTypeClass(type: string): string {
  const t = (type || '').toLowerCase();
  if (t.includes('výrobek')) return 'type-vyrobek';
  if (t.includes('polotovar')) return 'type-polotovar';
  if (t.includes('materiál') || t.includes('material')) return 'type-material';
  if (t.includes('zboží') || t.includes('zbozi')) return 'type-zbozi';
  return '';
}

// ---- TAB: Normované (strom operací → polotovary/výrobky → jejich operace → ...) ----

// Postavit strom operací z cache dat pro dané goodsId
function buildOpTree(goodsId: string | number, visited: Set<string>): OperationNode[] {
  const idStr = String(goodsId);
  if (!goodsId || visited.has(idStr)) return [];
  visited.add(idStr);

  const data = state.goodsCache[idStr];
  if (!data || typeof data !== 'object') return [];

  const d = data as any;
  if (!d.workflow || !d.workflow.operations) return [];

  const ops = (d.workflow.operations as any[])
    .slice()
    .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

  return ops.map((op: any, idx: number) => {
    const opName = locName(op.name) || locName(op.operationName) || '';
    const stageName = op.stage ? (locName(op.stage.name) || op.stage.referenceName || '') : '';
    const stageType = op.stage ? (op.stage.type || '') : '';

    // Jen polotovary a výrobky — materiály odfiltrovat
    const bomItems = ((op.billOfMaterialsItems || []) as any[])
      .map(bom => {
        const g = bom.goods || {};
        const typeName = g.type ? (g.type.name || g.type.referenceName || locName(g.type)) : '';
        const t = typeName.toLowerCase();
        const isExpandable = t.includes('polotovar') || t.includes('výrobek') || t.includes('vyrobek');
        if (!isExpandable) return null;
        const unitObj = g.unit || g.measureUnit || bom.unit || {};
        const unitName = typeof unitObj === 'string' ? unitObj : (unitObj.name || unitObj.referenceName || locName(unitObj) || '');

        return {
          nodeType: 'goods' as const,
          id: g.id,
          code: g.code || '',
          name: locName(g.name),
          type: typeName,
          unit: unitName,
          quantity: bom.quantity || 0,
          isExpandable,
          children: buildOpTree(g.id, visited),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const normDuration = op.perProcessingDuration || 0;
    const normUnit = op.perProcessingUnit || '';

    return {
      nodeType: 'operation' as const,
      position: idx + 1,
      name: opName,
      stage: stageName,
      stageType,
      normDuration,
      normUnit,
      bomCount: bomItems.length,
      children: bomItems,
    };
  });
}

// Spočítat uzly ve stromě
function countOpTree(nodes: OperationNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n++;
    if (node.children) n += countOpTree(node.children);
  }
  return n;
}

function renderNormovane(): void {
  if (!dom.tabContent) return;

  if (!state.product && !state.loading) {
    dom.tabContent.innerHTML = '<div class="empty-state"><p>Žádná data</p></div>';
    return;
  }

  // Postavit strom operací z hlavního výrobku
  const visited = new Set<string>();
  const opTree = buildOpTree(state.goodsId!, visited);

  if (opTree.length === 0 && !state.loading) {
    dom.tabContent.innerHTML = '<div class="empty-state"><p>Žádné operace</p></div>';
    return;
  }

  // Hlavní výrobek jako kořenový uzel
  const sp = state.product as any;
  const productName = locName(sp.name);
  const productCode = sp.code || '';
  const productType = sp.type ? (sp.type.name || sp.type.referenceName || '') : '';

  const rootNode: OperationNode = {
    nodeType: 'goods',
    id: state.goodsId!,
    code: productCode,
    name: productName,
    type: productType,
    unit: '',
    quantity: 0,
    isExpandable: true,
    children: opTree,
  };

  const totalNodes = countOpTree([rootNode]);

  // Analýza norem
  const normStats = collectNormStats([rootNode], '');

  let html = renderNormSummary(normStats);

  html += `
    <div class="norm-tree-frame">
      <div class="norm-tree-frame-header">
        <span class="norm-tree-frame-title">Struktura operací</span>
        <span class="count-badge">${totalNodes} uzlů</span>
        ${state.loading ? '<span class="loading-inline"><span class="loading-spinner-sm"></span> Načítám...</span>' : ''}
        <div class="toolbar-spacer"></div>
        <button class="toolbar-btn" onclick="normExpandAll()" title="Rozbalit vše">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Rozbalit vše
        </button>
        <button class="toolbar-btn" onclick="normCollapseAll()" title="Zabalit vše">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 9l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Zabalit vše
        </button>
      </div>
      <div class="table-wrapper">
        <table class="data-table tree-table" id="norm-table">
        <thead>
          <tr>
            <th class="col-expand"></th>
            <th class="col-name-wide">Název</th>
            <th class="col-qty">Množství</th>
            <th class="col-unit">Jednotka</th>
            <th class="col-type">Typ</th>
            <th class="col-stage">Pracoviště</th>
            <th class="col-norm">Norma</th>
            <th class="col-workflow">Má prac. postup</th>
          </tr>
        </thead>
        <tbody>`;

  html += renderNormTreeRows([rootNode], 0, []);
  html += '</tbody></table></div></div>';
  dom.tabContent.innerHTML = html;
}

// Rekurzivně renderovat strom operací a zboží
function renderNormTreeRows(nodes: OperationNode[], depth: number, ancestors: boolean[]): string {
  let html = '';
  nodes.forEach((node, idx) => {
    const isLast = idx === nodes.length - 1;
    const hasKids = node.children && node.children.length > 0;
    const rowId = `norm-${depth}-${idx}-${Math.random().toString(36).substr(2, 5)}`;
    const childCount = hasKids ? countOpTree(node.children) : 0;

    // SVG čáry
    const treeLines = renderTreeLines(ancestors, isLast, hasKids);
    const toggleBtn = hasKids
      ? `<span class="tree-toggle" data-row-id="${rowId}" onclick="toggleTreeNode(this, '${rowId}')">
           <span class="tree-icon">&#9654;</span>
           <span class="tree-child-count">${childCount}</span>
         </span>`
      : '';

    if (node.nodeType === 'operation') {
      // Norma formátování
      const normText = node.normDuration ? `${node.normDuration} ${formatNormUnit(node.normUnit || '')}` : '';

      html += `
        <tr class="tree-row norm-op-row depth-${depth}" data-depth="${depth}" data-row-id="${rowId}">
          <td class="col-expand"><div class="tree-cell">${treeLines}${toggleBtn}</div></td>
          <td class="col-name-wide norm-op-name">
            <span class="op-badge">${node.position}</span>
            <strong>${escapeHtml(node.name)}</strong>
          </td>
          <td class="col-qty"></td>
          <td class="col-unit"></td>
          <td class="col-type"><span class="type-badge type-operace">Operace</span></td>
          <td class="col-stage">${escapeHtml(node.stage || '')}</td>
          <td class="col-norm">${normText}</td>
          <td class="col-workflow"></td>
        </tr>`;
    } else {
      // Řádek zboží (polotovar/výrobek)
      const typeClass = getTypeClass(node.type || '');
      const wfIcon = node.isExpandable
        ? '<span class="wf-yes" title="Ano">&#10003;</span>'
        : '<span class="wf-no" title="Ne">&#10005;</span>';

      // Propsání ručního přiřazení pracoviště + normy
      const manualA = state.manualAssignments[node.code || ''];
      let stageHtml = '';
      let normHtml = '';
      let wfFinal = wfIcon;
      if (manualA) {
        stageHtml = `<span class="assigned-stage">${escapeHtml(manualA.stageName || manualA.stageId || '')}</span>`;
        normHtml = `<span class="assigned-norm">${manualA.norm} min</span>`;
        wfFinal = '<span class="wf-yes" title="Ručně přiřazeno">&#10003;</span>';
      }

      html += `
        <tr class="tree-row norm-goods-row depth-${depth}${manualA ? ' norm-row-assigned' : ''}" data-depth="${depth}" data-row-id="${rowId}">
          <td class="col-expand"><div class="tree-cell">${treeLines}${toggleBtn}</div></td>
          <td class="col-name-wide">
            <span class="norm-goods-code">${escapeHtml(node.code || '')}</span>
            ${escapeHtml(node.name) || '—'}
          </td>
          <td class="col-qty">${node.quantity !== undefined ? node.quantity : ''}</td>
          <td class="col-unit">${escapeHtml(node.unit || '')}</td>
          <td class="col-type"><span class="type-badge ${typeClass}">${escapeHtml(node.type || '') || '—'}</span></td>
          <td class="col-stage">${stageHtml}</td>
          <td class="col-norm">${normHtml}</td>
          <td class="col-workflow">${wfFinal}</td>
        </tr>`;
    }

    // Children
    if (hasKids) {
      const childAncestors = [...ancestors, !isLast];
      html += `<tr class="tree-children-container" data-parent-row="${rowId}" style="display:none"><td colspan="8" style="padding:0">
        <table class="tree-subtable"><tbody>`;
      html += renderNormTreeRows(node.children, depth + 1, childAncestors);
      html += `</tbody></table></td></tr>`;
    }
  });
  return html;
}

// Normované expand/collapse all
export function normExpandAll(): void {
  document.querySelectorAll('#norm-table tr.tree-children-container').forEach(tr => (tr as HTMLElement).style.display = '');
  document.querySelectorAll('#norm-table .tree-toggle').forEach(t => {
    t.classList.add('expanded');
    const icon = t.querySelector('.tree-icon');
    if (icon) icon.innerHTML = '&#9660;';
  });
}

export function normCollapseAll(): void {
  document.querySelectorAll('#norm-table tr.tree-children-container').forEach(tr => (tr as HTMLElement).style.display = 'none');
  document.querySelectorAll('#norm-table .tree-toggle').forEach(t => {
    t.classList.remove('expanded');
    const icon = t.querySelector('.tree-icon');
    if (icon) icon.innerHTML = '&#9654;';
  });
}

// ---- TAB: Pracovní postup ----

function renderPostup(): void {
  if (!dom.tabContent) return;

  if (!state.operations || state.operations.length === 0) {
    dom.tabContent.innerHTML = '<div class="empty-state"><p>Žádné operace</p></div>';
    return;
  }

  let html = '<div class="operations-list">';
  (state.operations as any[]).forEach((op, idx) => {
    const opName = locName(op.name) || locName(op.operationName) || '';
    const stageName = op.stage ? (op.stage.referenceName || op.stage.name || '') : '';
    const bomCount = (op.billOfMaterialsItems || []).length;

    html += `
      <div class="operation-card">
        <div class="operation-num">${idx + 1}</div>
        <div class="operation-info">
          <div class="operation-name">${escapeHtml(opName)}</div>
          <div class="operation-meta">
            <span>🏭 ${escapeHtml(stageName)}</span>
            ${bomCount > 0 ? `<span>📦 ${bomCount} položek</span>` : ''}
          </div>
        </div>
        <div class="operation-arrow" onclick="toggleOperationBom(this, ${idx})">▼</div>
      </div>
      <div class="operation-bom" id="op-bom-${idx}" style="display:none;"></div>`;
  });
  html += '</div>';
  dom.tabContent.innerHTML = html;
}

export function toggleOperationBom(arrow: HTMLElement, opIdx: number): void {
  const bomEl = document.getElementById('op-bom-' + opIdx) as HTMLElement | null;
  if (!bomEl) return;
  const isOpen = bomEl.style.display !== 'none';

  if (isOpen) {
    bomEl.style.display = 'none';
    arrow.textContent = '▼';
    return;
  }

  arrow.textContent = '▲';
  const op = (state.operations as any[])[opIdx];
  const items = op.billOfMaterialsItems || [];

  if (items.length === 0) {
    bomEl.innerHTML = '<div class="bom-empty">Žádné zboží v operaci</div>';
    bomEl.style.display = 'block';
    return;
  }

  let html = '<table class="data-table bom-sub-table"><thead><tr><th>Kód</th><th>Zboží</th><th>Typ</th><th>Množství</th></tr></thead><tbody>';
  items.forEach((item: any) => {
    const goods = item.goods || {};
    const name = locName(goods.name);
    const typeName = goods.type ? (goods.type.name || goods.type.referenceName || '') : '';
    const typeClass = getTypeClass(typeName);
    html += `<tr>
      <td><strong>${escapeHtml(goods.code || '')}</strong></td>
      <td>${escapeHtml(name) || '—'}</td>
      <td><span class="type-badge ${typeClass}">${escapeHtml(typeName)}</span></td>
      <td>${item.quantity || 0}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  bomEl.innerHTML = html;
  bomEl.style.display = 'block';
}

// ---- TAB: Vizualizace (Ganttův diagram) ----

function renderVizualizace(): void {
  if (!dom.tabContent) return;

  if (!state.product && !state.loading) {
    dom.tabContent.innerHTML = '<div class="empty-state"><p>Žádná data</p></div>';
    return;
  }

  const visited = new Set<string>();
  const opTree = buildOpTree(state.goodsId!, visited);

  if (opTree.length === 0 && !state.loading) {
    dom.tabContent.innerHTML = '<div class="empty-state"><p>Žádné operace k vizualizaci</p></div>';
    return;
  }

  const sp = state.product as any;
  const productName = locName(sp.name);
  const productCode = sp.code || '';

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Collect all schedulable tasks from the operation tree
  // ═══════════════════════════════════════════════════════════════
  const tasks: any[] = [];
  let nextId = 0;
  let currentMainPos: number | null = null;

  function collectGoodsOps(goodsNode: OperationNode): number[] {
    const ops = (goodsNode.children || []).filter(n => n.nodeType === 'operation');

    if (ops.length === 0) {
      const manual = state.manualAssignments[goodsNode.code || ''];
      if (manual && manual.norm > 0) {
        const id = nextId++;
        tasks.push({
          id, name: goodsNode.name,
          stage: manual.stageName || manual.stageId || '?',
          seconds: (manual.norm || 0) * 60,
          dependsOn: [],
          label: goodsNode.code, goodsCode: goodsNode.code,
          isMainOp: false, feedsIntoMainPos: currentMainPos,
        });
        return [id];
      }
      return [];
    }

    let prevOpId: number | null = null;
    ops.forEach(op => {
      const secs = normToSeconds(op.normDuration || 0, op.normUnit || '');
      const deps: number[] = prevOpId !== null ? [prevOpId] : [];

      (op.children || [])
        .filter(g => g.nodeType === 'goods')
        .forEach(g => {
          if (g.children && g.children.length > 0) {
            deps.push(...collectGoodsOps(g));
          } else {
            const m = state.manualAssignments[g.code || ''];
            if (m && m.norm > 0) {
              const sid = nextId++;
              tasks.push({
                id: sid, name: g.name,
                stage: m.stageName || m.stageId || '?',
                seconds: (m.norm || 0) * 60, dependsOn: [],
                label: g.code, goodsCode: g.code,
                isMainOp: false, feedsIntoMainPos: currentMainPos,
              });
              deps.push(sid);
            }
          }
        });

      const id = nextId++;
      tasks.push({
        id, name: op.name,
        stage: op.stage || '?',
        seconds: secs, dependsOn: deps,
        label: goodsNode.code, goodsCode: goodsNode.code,
        isMainOp: false, feedsIntoMainPos: currentMainPos,
        position: op.position,
        normDuration: op.normDuration, normUnit: op.normUnit,
      });
      prevOpId = id;
    });
    return prevOpId !== null ? [prevOpId] : [];
  }

  let prevMainId: number | null = null;
  opTree.forEach(mainOp => {
    const secs = normToSeconds(mainOp.normDuration || 0, mainOp.normUnit || '');
    const deps: number[] = prevMainId !== null ? [prevMainId] : [];
    const isKoop = (mainOp.stageType || '').toUpperCase() === 'COOPERATION';

    currentMainPos = mainOp.position || null;

    (mainOp.children || [])
      .filter(g => g.nodeType === 'goods')
      .forEach(g => {
        if (g.children && g.children.length > 0) {
          deps.push(...collectGoodsOps(g));
        } else {
          const m = state.manualAssignments[g.code || ''];
          if (m && m.norm > 0) {
            const sid = nextId++;
            tasks.push({
              id: sid, name: g.name,
              stage: m.stageName || m.stageId || '?',
              seconds: (m.norm || 0) * 60, dependsOn: [],
              label: g.code, goodsCode: g.code,
              isMainOp: false, feedsIntoMainPos: currentMainPos,
            });
            deps.push(sid);
          }
        }
      });

    const id = nextId++;
    tasks.push({
      id, name: mainOp.name,
      stage: mainOp.stage || '?',
      seconds: secs, dependsOn: deps,
      label: 'Op ' + mainOp.position,
      isMainOp: true, isKoop,
      position: mainOp.position,
      normDuration: mainOp.normDuration, normUnit: mainOp.normUnit,
    });
    prevMainId = id;
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Backward schedule — plan from the end
  // ═══════════════════════════════════════════════════════════════
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // 2a: Forward pass
  {
    const scheduled = new Set<number>();
    const workplaceEnd: Record<string, number> = {};
    const remaining = new Set(tasks.map((t: any) => t.id));
    let safety = 0;
    while (remaining.size > 0 && safety++ < 50000) {
      let progress = false;
      for (const id of remaining) {
        const task = taskMap.get(id);
        if (!task.dependsOn.every((d: number) => scheduled.has(d))) continue;
        const depEnd = task.dependsOn.length > 0
          ? Math.max(...task.dependsOn.map((d: number) => taskMap.get(d)!.endSec || 0))
          : 0;
        const wpEnd = workplaceEnd[task.stage] || 0;
        task.startSec = Math.max(depEnd, wpEnd);
        task.endSec = task.startSec + task.seconds;
        workplaceEnd[task.stage] = task.endSec;
        scheduled.add(id);
        remaining.delete(id);
        progress = true;
      }
      if (!progress) break;
    }
  }

  const makespan = Math.max(...tasks.map((t: any) => t.endSec || 0), 0);

  // 2b: Build successors map + workplace ordering
  const successors = new Map<number, number[]>(tasks.map((t: any) => [t.id, []]));
  tasks.forEach((t: any) => t.dependsOn.forEach((d: number) => {
    const succ = successors.get(d);
    if (succ) succ.push(t.id);
  }));

  const wpTaskOrder: Record<string, number[]> = {};
  tasks.forEach((t: any) => {
    if (!wpTaskOrder[t.stage]) wpTaskOrder[t.stage] = [];
    wpTaskOrder[t.stage].push(t.id);
  });
  Object.values(wpTaskOrder).forEach(arr =>
    arr.sort((a: number, b: number) => taskMap.get(a)!.startSec - taskMap.get(b)!.startSec)
  );
  const wpNextTask = new Map<number, number>();
  Object.values(wpTaskOrder).forEach((ids: number[]) => {
    ids.forEach((id, i) => {
      if (i < ids.length - 1) wpNextTask.set(id, ids[i + 1]);
    });
  });

  // 2c: Backward pass
  {
    const scheduledBack = new Set<number>();
    const remainingBack = new Set(tasks.map((t: any) => t.id));
    let safety = 0;
    while (remainingBack.size > 0 && safety++ < 50000) {
      let progress = false;
      for (const id of remainingBack) {
        const task = taskMap.get(id);
        const succs = successors.get(id);
        if (!succs!.every(s => scheduledBack.has(s))) continue;

        let latestEnd = succs!.length > 0
          ? Math.min(...succs!.map(s => taskMap.get(s)!.startSec || 0))
          : makespan;

        if (wpNextTask.has(id)) {
          latestEnd = Math.min(latestEnd, taskMap.get(wpNextTask.get(id)!)!.startSec || 0);
        }

        task.endSec = latestEnd;
        task.startSec = task.endSec - task.seconds;
        scheduledBack.add(id);
        remainingBack.delete(id);
        progress = true;
      }
      if (!progress) break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Render — Ganttův diagram
  // ═══════════════════════════════════════════════════════════════
  const mainTasks = tasks.filter((t: any) => t.isMainOp && t.endSec != null)
    .sort((a: any, b: any) => a.startSec - b.startSec);
  const subTasks = tasks.filter((t: any) => !t.isMainOp && t.endSec != null);

  // Color per main op
  const MC = ['#5b8def','#27ae60','#e67e22','#9b59b6','#e74c3c','#1abc9c','#f39c12','#3498db','#e91e63','#00bcd4'];
  const mainColorMap: Record<number, string> = {};
  mainTasks.forEach((mt: any, i: number) => {
    mainColorMap[mt.position] = mt.isKoop ? '#e67e22' : MC[i % MC.length];
  });

  // Group sub-tasks by workplace
  const wpMap: Record<string, any[]> = {};
  subTasks.forEach((t: any) => {
    if (!wpMap[t.stage]) wpMap[t.stage] = [];
    wpMap[t.stage].push(t);
  });
  const wpNames = Object.keys(wpMap).sort((a: string, b: string) => a.localeCompare(b));

  const maxEnd = Math.max(...tasks.filter((t: any) => t.endSec != null).map((t: any) => t.endSec), 0);

  // Build rows
  const ROW_H = 36;
  const rows = [{ label: 'HLAVNÍ LINKA', isMain: true, tasks: mainTasks }];
  wpNames.forEach(wp => rows.push({ label: wp, isMain: false, tasks: wpMap[wp].sort((a: any, b: any) => a.startSec - b.startSec) }));

  // Render function (called on zoom changes)
  function renderGantt(zoomLevel: number): void {
    const TW = Math.max(maxEnd * 0.15 * zoomLevel, 800);
    const toPx = (sec: number) => maxEnd > 0 ? sec * (TW / maxEnd) : 0;
    const tickInterval = maxEnd > 36000 ? 3600 : (maxEnd > 7200 ? 1800 : 600);

    let h = `<div class="gantt" data-zoom="${zoomLevel}">`;

    // Header
    h += `<div class="gantt-header">
      <div class="gantt-header-left"><span class="gantt-title">${escapeHtml(productCode)} ${escapeHtml(productName)}</span></div>
      <div class="gantt-header-right">
        <span class="gantt-stat">${tasks.length} úkolů · ${formatDuration(maxEnd)}</span>
        <span class="gantt-zoom-info">${Math.round(zoomLevel * 100)}%</span>
        <button class="gantt-zoom-btn" data-dir="-" title="Oddálit">−</button>
        <button class="gantt-zoom-btn" data-dir="+" title="Přiblížit">+</button>
      </div>
    </div>`;

    // Body
    h += `<div class="gantt-body">`;

    // Fixed labels
    h += `<div class="gantt-labels" id="gantt-labels">`;
    h += `<div class="gantt-label gantt-label-axis">Pracoviště</div>`;
    rows.forEach(r => {
      const cls = r.isMain ? 'gantt-label gantt-label-main' : 'gantt-label';
      h += `<div class="${cls}" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>`;
    });
    h += `</div>`;

    // Timeline
    h += `<div class="gantt-timeline" id="gantt-timeline">`;
    h += `<div class="gantt-timeline-inner" style="width:${TW + 80}px;">`;

    // Time axis
    h += `<div class="gantt-row gantt-row-axis">`;
    for (let t = 0; t <= maxEnd; t += tickInterval) {
      h += `<div class="gantt-tick" style="left:${toPx(t)}px;">${formatDuration(t) || '0'}</div>`;
      h += `<div class="gantt-vline gantt-vline-axis" style="left:${toPx(t)}px;"></div>`;
    }
    h += `</div>`;

    // Data rows
    rows.forEach((r, ri) => {
      const isMain = r.isMain;
      const cls = isMain ? 'gantt-row gantt-row-main' : ('gantt-row' + (ri % 2 === 0 ? ' gantt-row-even' : ''));
      h += `<div class="${cls}">`;

      // Grid
      for (let t = 0; t <= maxEnd; t += tickInterval) {
        h += `<div class="gantt-vline" style="left:${toPx(t)}px;"></div>`;
      }

      // Bars
      r.tasks.forEach((t: any) => {
        const left = toPx(t.startSec);
        const width = Math.max(toPx(t.seconds), 4);
        const color = isMain ? mainColorMap[t.position] : (mainColorMap[t.feedsIntoMainPos] || '#666');
        const normText = t.normDuration ? `${t.normDuration} ${formatNormUnit(t.normUnit || '')}` : '';

        const l1 = isMain ? `Op ${t.position}` : (t.label || t.goodsCode || '');
        const l2 = t.name;
        const l3 = isMain ? t.stage : `→ Op ${t.feedsIntoMainPos}`;
        const tip = [l1, l2, t.stage, normText].filter(Boolean).join('\n');

        const bCls = isMain ? 'gantt-bar gantt-bar-main' : 'gantt-bar gantt-bar-sub';

        h += `<div class="${bCls}" style="left:${left}px;width:${width}px;background:${color};" title="${escapeHtml(tip)}">`;
        h += `<span class="gantt-bar-l1">${escapeHtml(l1)}</span>`;
        if (width > 30) h += `<span class="gantt-bar-l2">${escapeHtml(l2)}</span>`;
        h += '</div>';
      });

      h += `</div>`;
    });

    // SVG dependency arrows
    const AXIS_H = 32;
    const svgH = AXIS_H + rows.length * ROW_H + 10;
    h += `<svg class="gantt-arrows" width="${TW + 80}" height="${svgH}">`;
    mainTasks.forEach((mt: any) => {
      const subs = subTasks.filter((st: any) => st.feedsIntoMainPos === mt.position);
      if (!subs.length) return;
      const color = mainColorMap[mt.position];
      const mainX = toPx(mt.startSec);
      const mainBotY = AXIS_H + ROW_H;

      const wps = [...new Set(subs.map((s: any) => s.stage))];
      wps.forEach((wp: string) => {
        const wpIdx = wpNames.indexOf(wp) + 1;
        if (wpIdx <= 0) return;
        const wpMidY = AXIS_H + wpIdx * ROW_H + ROW_H / 2;
        const lastEndX = toPx(Math.max(...subs.filter((s: any) => s.stage === wp).map((s: any) => s.endSec || 0)));

        if (lastEndX < mainX - 2) {
          h += `<path d="M${lastEndX},${wpMidY} L${mainX},${wpMidY} L${mainX},${mainBotY}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.35" stroke-dasharray="4,3"/>`;
          h += `<polygon points="${mainX-4},${mainBotY+1} ${mainX+4},${mainBotY+1} ${mainX},${mainBotY-4}" fill="${color}" opacity="0.45"/>`;
        }
      });
    });
    h += `</svg>`;

    h += `</div></div>`; // inner, timeline
    h += `</div>`; // body
    h += `</div>`; // gantt

    dom.tabContent!.innerHTML = h;

    // ── Wire up events ──
    const timeline = document.getElementById('gantt-timeline') as HTMLElement | null;
    const labels = document.getElementById('gantt-labels') as HTMLElement | null;

    // Sync vertical scroll
    if (timeline && labels) {
      timeline.addEventListener('scroll', () => {
        labels.scrollTop = timeline.scrollTop;
      });
    }

    // Zoom buttons
    document.querySelectorAll('.gantt-zoom-btn').forEach(btn => {
      (btn as HTMLElement).addEventListener('click', () => {
        const dir = (btn as HTMLElement).dataset.dir;
        const newZoom = dir === '+' ? Math.min(zoomLevel * 1.4, 20) : Math.max(zoomLevel / 1.4, 0.2);
        renderGantt(newZoom);
      });
    });

    // Mouse wheel zoom on timeline
    if (timeline) {
      timeline.addEventListener('wheel', e => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const scrollLeftBefore = timeline.scrollLeft;
          const mouseXInTimeline = e.clientX - timeline.getBoundingClientRect().left + scrollLeftBefore;
          const ratioX = mouseXInTimeline / (TW + 80);

          const factor = e.deltaY < 0 ? 1.15 : 0.87;
          const newZoom = Math.min(Math.max(zoomLevel * factor, 0.2), 20);
          renderGantt(newZoom);

          // Restore scroll position centered on cursor
          const newTimeline = document.getElementById('gantt-timeline') as HTMLElement | null;
          if (newTimeline) {
            const newTW = Math.max(maxEnd * 0.15 * newZoom, 800) + 80;
            newTimeline.scrollLeft = ratioX * newTW - (e.clientX - newTimeline.getBoundingClientRect().left);
          }
        }
      }, { passive: false });
    }
  }

  // Initial render
  renderGantt(1);
}

// ---- Filtrování tabulky (per-column) ----

export function applyFilters(): void {
  const filters: Record<string, string> = {};
  document.querySelectorAll('.col-filter, .col-filter-select').forEach(el => {
    const col = (el as HTMLElement).dataset.col;
    const val = ((el as HTMLInputElement | HTMLSelectElement).value || '').toLowerCase().trim();
    if (col && val) filters[col] = val;
  });

  const hasFilters = Object.keys(filters).length > 0;

  // Pokud jsou filtry aktivní, rozbalíme vše a filtrujeme ploše
  if (hasFilters) {
    document.querySelectorAll('tr.tree-children-container').forEach(tr => (tr as HTMLElement).style.display = '');
  }

  let visible = 0;
  document.querySelectorAll('#bom-table .tree-row').forEach(tr => {
    if (!hasFilters) {
      (tr as HTMLElement).style.display = '';
      visible++;
      return;
    }
    let show = true;
    for (const [col, query] of Object.entries(filters)) {
      const cellVal = ((tr as HTMLElement).dataset[col] || '').toLowerCase();
      if (!cellVal.includes(query)) {
        show = false;
        break;
      }
    }
    (tr as HTMLElement).style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const badge = document.getElementById('visible-count');
  if (badge) {
    const total = state.totalCount;
    badge.textContent = hasFilters ? `${visible} / ${total} položek` : `${total} položek`;
  }
}

export function resetFilters(): void {
  document.querySelectorAll('.col-filter, .col-filter-select').forEach(el => {
    (el as HTMLInputElement | HTMLSelectElement).value = '';
  });
  applyFilters();
  collapseAll();
}

// ---- Analýza norem — sběr dat ze stromu operací ----

interface NormStats {
  totalSeconds: number;
  operations: Array<{ position: number; name: string; stage: string; stageType: string; duration: number; unit: string; seconds: number; parentGoods: string }>;
  errors: any[];
  warnings: any[];
}

function collectNormStats(nodes: OperationNode[], parentGoods: string): NormStats {
  const stats: NormStats = { totalSeconds: 0, operations: [], errors: [], warnings: [] };

  for (const node of nodes) {
    if (node.nodeType === 'operation') {
      const seconds = normToSeconds(node.normDuration || 0, node.normUnit || '');
      stats.totalSeconds += seconds;
      stats.operations.push({
        position: node.position || 0,
        name: node.name,
        stage: node.stage || '',
        stageType: node.stageType || '',
        duration: node.normDuration || 0,
        unit: node.normUnit || '',
        seconds,
        parentGoods: parentGoods || '',
      });

      // Chyba: norma < 30s, ALE vyloučit pracoviště typu COOPERATION
      const isKooperace = (node.stageType || '').toUpperCase() === 'COOPERATION';
      if (seconds < 30 && !isKooperace) {
        stats.errors.push({
          position: node.position,
          name: node.name,
          stage: node.stage,
          stageType: node.stageType || '',
          duration: node.normDuration,
          unit: node.normUnit,
          seconds,
          parentGoods: parentGoods || '',
        });
      }
    }

    // Varování: polotovar/výrobek bez pracovního postupu
    if (node.nodeType === 'goods' && node.isExpandable) {
      const hasWorkflow = node.children && node.children.length > 0;
      if (!hasWorkflow && parentGoods) { // Přeskočit root výrobek
        stats.warnings.push({
          code: node.code,
          name: node.name,
          type: node.type,
          parentGoods: parentGoods || '',
        });
      }
    }

    if (node.children && node.children.length > 0) {
      const goodsLabel = node.nodeType === 'goods' ? (node.code + ' ' + node.name) : parentGoods;
      const sub = collectNormStats(node.children, goodsLabel);
      stats.totalSeconds += sub.totalSeconds;
      stats.operations.push(...sub.operations);
      stats.errors.push(...sub.errors);
      stats.warnings.push(...sub.warnings);
    }
  }
  return stats;
}

function normToSeconds(duration: number, unit: string): number {
  if (!duration) return 0;
  const u = (unit || '').toUpperCase();
  if (u === 'HOUR' || u === 'HOURS') return duration * 3600;
  if (u === 'MINUTE' || u === 'MINUTES') return duration * 60;
  if (u === 'SECOND' || u === 'SECONDS') return duration;
  return duration * 60; // Fallback: předpokládáme minuty
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 min';
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(hours + ' hod');
  if (mins > 0) parts.push(mins + ' min');
  if (secs > 0 && hours === 0) parts.push(secs + ' s');
  return parts.join(' ');
}

function renderNormSummary(stats: NormStats): string {
  const errCount = stats.errors.length;
  const warnCount = stats.warnings.length;
  const totalOps = stats.operations.length;

  let errListHtml = '';
  if (errCount > 0) {
    errListHtml = `
      <div class="norm-errors-list">
        <div class="norm-issues-header norm-issues-header-error">Operace bez časové dotace (mimo Kooperaci)</div>
        <table class="norm-errors-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Operace</th>
              <th>Pracoviště</th>
              <th>Norma</th>
              <th>Zboží</th>
            </tr>
          </thead>
          <tbody>
            ${stats.errors.map(e => {
              const normText = e.duration ? `${e.duration} ${formatNormUnit(e.unit)}` : '<em>chybí</em>';
              return `<tr>
                <td>${e.position}</td>
                <td>${escapeHtml(e.name)}</td>
                <td>${escapeHtml(e.stage)}</td>
                <td class="norm-err-value">${normText}</td>
                <td class="norm-err-goods">${escapeHtml(e.parentGoods)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Rozdělit varování na přiřazené a nepřiřazené
  const assignedWarnings = stats.warnings.filter(w => state.manualAssignments[w.code]);
  const unassignedWarnings = stats.warnings.filter(w => !state.manualAssignments[w.code]);
  const realWarnCount = unassignedWarnings.length;

  let warnListHtml = '';
  if (assignedWarnings.length > 0) {
    warnListHtml += `
      <div class="norm-assigned-list">
        <div class="norm-issues-header norm-issues-header-ok">Ručně přiřazené pracoviště a norma</div>
        <table class="norm-warnings-table norm-assigned-table">
          <thead>
            <tr>
              <th>Kód</th>
              <th>Název</th>
              <th>Pracoviště</th>
              <th>Norma</th>
              <th>Nadřazené zboží</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${assignedWarnings.map(w => {
              const a = state.manualAssignments[w.code];
              return `<tr class="norm-assigned-row">
                <td><strong>${escapeHtml(w.code)}</strong></td>
                <td>${escapeHtml(w.name)}</td>
                <td><span class="assigned-stage">${escapeHtml(a.stageName)}</span></td>
                <td><span class="assigned-norm">${a.norm} min</span></td>
                <td class="norm-err-goods">${escapeHtml(w.parentGoods)}</td>
                <td><button class="btn-remove-assign" onclick="removeAssignment('${escapeHtml(w.code)}')" title="Odebrat přiřazení">✕</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  if (unassignedWarnings.length > 0) {
    warnListHtml += `
      <div class="norm-warnings-list">
        <div class="norm-issues-header norm-issues-header-warn">
          Polotovary / výrobky bez pracovního postupu
          <button class="btn-bulk-assign" onclick="openBulkAssignModal()" title="Hromadně přiřadit vybraným">&#9881; Hromadně přiřadit vybrané</button>
        </div>
        <table class="norm-warnings-table" id="warn-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" id="warn-check-all" onchange="toggleAllWarnings(this.checked)" title="Vybrat vše"></th>
              <th>Kód</th>
              <th>Název</th>
              <th>Typ</th>
              <th>Nadřazené zboží</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${unassignedWarnings.map((w, i) => {
              const typeClass = getTypeClass(w.type);
              return `<tr>
                <td class="col-check"><input type="checkbox" class="warn-check" data-code="${escapeHtml(w.code)}" data-name="${escapeHtml(w.name)}" onchange="updateBulkCount()"></td>
                <td><strong>${escapeHtml(w.code)}</strong></td>
                <td>${escapeHtml(w.name)}</td>
                <td><span class="type-badge ${typeClass}">${escapeHtml(w.type)}</span></td>
                <td class="norm-err-goods">${escapeHtml(w.parentGoods)}</td>
                <td><button class="btn-assign" onclick="openAssignModal('${escapeHtml(w.code)}', '${escapeHtml(w.name)}')" title="Přiřadit pracoviště a normu">&#9881; Přiřadit</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Přičíst manuálně přiřazené normy k celkovému času
  let manualSeconds = 0;
  for (const code of Object.keys(state.manualAssignments)) {
    manualSeconds += (state.manualAssignments[code].norm || 0) * 60;
  }
  const totalWithManual = stats.totalSeconds + manualSeconds;
  const manualOpsCount = Object.keys(state.manualAssignments).length;

  // Status card
  let statusCard;
  if (errCount > 0 && realWarnCount > 0) {
    statusCard = `
      <div class="norm-card norm-card-error">
        <div class="norm-card-label">Chyby</div>
        <div class="norm-card-value">${errCount}</div>
      </div>
      <div class="norm-card norm-card-warn">
        <div class="norm-card-label">Varování</div>
        <div class="norm-card-value">${realWarnCount}</div>
      </div>`;
  } else if (errCount > 0) {
    statusCard = `
      <div class="norm-card norm-card-error">
        <div class="norm-card-label">Chyby (norma &lt; 30 s)</div>
        <div class="norm-card-value">${errCount} operací</div>
      </div>`;
  } else if (realWarnCount > 0) {
    statusCard = `
      <div class="norm-card norm-card-warn">
        <div class="norm-card-label">Varování</div>
        <div class="norm-card-value">${realWarnCount}</div>
      </div>`;
  } else {
    statusCard = `
      <div class="norm-card norm-card-ok">
        <div class="norm-card-label">Stav</div>
        <div class="norm-card-value">✓ OK</div>
      </div>`;
  }

  // Karta pro manuální přiřazení
  const manualCard = manualOpsCount > 0 ? `
    <div class="norm-card norm-card-manual">
      <div class="norm-card-label">Ručně přiřazeno</div>
      <div class="norm-card-value">${manualOpsCount} dílů · ${formatDuration(manualSeconds)}</div>
    </div>` : '';

  return `
    <div class="norm-summary-panel">
      <div class="norm-summary-cards">
        <div class="norm-card">
          <div class="norm-card-label">Celková norma</div>
          <div class="norm-card-value">${formatDuration(totalWithManual)}</div>
        </div>
        <div class="norm-card">
          <div class="norm-card-label">Počet operací</div>
          <div class="norm-card-value">${totalOps + manualOpsCount}</div>
        </div>
        ${statusCard}
        ${manualCard}
      </div>
      ${errListHtml}
      ${warnListHtml}
    </div>`;
}

function formatNormUnit(unit: string): string {
  const u = (unit || '').toUpperCase();
  if (u === 'MINUTE' || u === 'MINUTES') return 'min';
  if (u === 'SECOND' || u === 'SECONDS') return 's';
  if (u === 'HOUR' || u === 'HOURS') return 'hod';
  return unit || '';
}

function updateStatus(s: string, text: string): void {
  if (dom.statusDot) dom.statusDot.className = 'status-dot ' + s;
  if (dom.statusText) dom.statusText.textContent = text;
}

// ---- Načíst pracoviště pro přiřazování ----

async function loadStagesForAssignment(): Promise<void> {
  if (state.stagesLoaded) return;
  try {
    if (!FactorifyAPI.configLoaded) await FactorifyAPI.loadEnv();
    const stages = await FactorifyAPI.loadStages();
    state.stagesList = stages.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'cs'));
    state.stagesLoaded = true;
    // Načíst uložené přiřazení z localStorage
    loadAssignmentsFromStorage();
  } catch (e) {
    console.warn('[PP] Nepodařilo se načíst pracoviště:', (e as Error).message);
  }
}

// ---- Persistence: localStorage ----

function getStorageKey(): string {
  return 'manualAssignments_' + state.goodsId;
}

function saveAssignmentsToStorage(): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state.manualAssignments));
  } catch (e) {
    // Ignorovat
  }
}

function loadAssignmentsFromStorage(): void {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (raw) state.manualAssignments = JSON.parse(raw);
  } catch (e) {
    // Ignorovat
  }
}

// ---- Modal pro přiřazení pracoviště a normy ----

export function openAssignModal(code: string, name: string): void {
  // Odstraň existující modal
  closeAssignModal();

  const stageOptions = state.stagesList.map(s =>
    `<option value="${s.id}" data-name="${escapeHtml(s.name || s.code)}">${escapeHtml(s.name || s.code)}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'assign-modal-overlay';
  modal.className = 'assign-modal-overlay';
  modal.innerHTML = `
    <div class="assign-modal">
      <div class="assign-modal-header">
        <span class="assign-modal-title">Přiřadit pracoviště a normu</span>
        <button class="assign-modal-close" onclick="closeAssignModal()">✕</button>
      </div>
      <div class="assign-modal-body">
        <div class="assign-modal-goods">
          <span class="assign-modal-code">${escapeHtml(code)}</span>
          <span class="assign-modal-name">${escapeHtml(name)}</span>
        </div>
        <div class="assign-modal-field">
          <label for="assign-stage">Pracoviště</label>
          <select id="assign-stage">
            <option value="">— vyberte pracoviště —</option>
            ${stageOptions}
          </select>
        </div>
        <div class="assign-modal-field">
          <label for="assign-norm">Norma (min)</label>
          <input type="number" id="assign-norm" min="0" step="0.1" placeholder="0" />
        </div>
      </div>
      <div class="assign-modal-footer">
        <button class="btn-cancel" onclick="closeAssignModal()">Zrušit</button>
        <button class="btn-confirm" onclick="confirmAssignment('${escapeHtml(code)}')">Přiřadit</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Focus na select
  setTimeout(() => document.getElementById('assign-stage')?.focus(), 100);
}

export function closeAssignModal(): void {
  const existing = document.getElementById('assign-modal-overlay');
  if (existing) existing.remove();
}

export function confirmAssignment(code: string): void {
  const stageSelect = document.getElementById('assign-stage') as HTMLSelectElement | null;
  const normInput = document.getElementById('assign-norm') as HTMLInputElement | null;
  if (!stageSelect || !normInput) return;

  const stageId = stageSelect.value;
  const stageName = (stageSelect.selectedOptions[0] as HTMLOptionElement)?.dataset?.name || stageSelect.selectedOptions[0]?.text || '';
  const norm = parseFloat(normInput.value) || 0;

  if (!stageId) {
    stageSelect.style.borderColor = '#e74c3c';
    stageSelect.focus();
    return;
  }
  if (norm <= 0) {
    normInput.style.borderColor = '#e74c3c';
    normInput.focus();
    return;
  }

  state.manualAssignments[code] = {
    stageId,
    stageName,
    norm,
    unit: 'MINUTE',
    assignedAt: new Date().toISOString(),
  };

  saveAssignmentsToStorage();
  closeAssignModal();
  renderCurrentTab();
  showToast(`${code}: ${stageName}, ${norm} min`);
}

export function removeAssignment(code: string): void {
  delete state.manualAssignments[code];
  saveAssignmentsToStorage();
  renderCurrentTab();
  showToast(`${code}: přiřazení odebráno`);
}

// ---- Hromadné přiřazení ----

export function toggleAllWarnings(checked: boolean): void {
  document.querySelectorAll('.warn-check').forEach(cb => {
    (cb as HTMLInputElement).checked = checked;
  });
  updateBulkCount();
}

export function updateBulkCount(): void {
  const checked = document.querySelectorAll('.warn-check:checked').length;
  const btn = document.querySelector('.btn-bulk-assign') as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = checked > 0
      ? `\u2699 Hromadně přiřadit vybrané (${checked})`
      : '\u2699 Hromadně přiřadit vybrané';
    btn.disabled = checked === 0;
    btn.classList.toggle('btn-bulk-active', checked > 0);
  }
  // Sync "select all" checkbox
  const all = document.querySelectorAll('.warn-check').length;
  const allCb = document.getElementById('warn-check-all') as HTMLInputElement | null;
  if (allCb) allCb.indeterminate = checked > 0 && checked < all;
  if (allCb && checked === all && all > 0) allCb.checked = true;
  if (allCb && checked === 0) allCb.checked = false;
}

function getSelectedWarnings(): Array<{ code: string; name: string }> {
  const selected: Array<{ code: string; name: string }> = [];
  document.querySelectorAll('.warn-check:checked').forEach(cb => {
    selected.push({ code: (cb as any).dataset.code, name: (cb as any).dataset.name });
  });
  return selected;
}

export function openBulkAssignModal(): void {
  const selected = getSelectedWarnings();
  if (selected.length === 0) {
    showToast('Nejdřív zaškrtněte položky k přiřazení');
    return;
  }

  closeAssignModal();

  const stageOptions = state.stagesList.map(s =>
    `<option value="${s.id}" data-name="${escapeHtml(s.name || s.code)}">${escapeHtml(s.name || s.code)}</option>`
  ).join('');

  const itemsList = selected.map(s =>
    `<div class="bulk-item"><span class="assign-modal-code">${escapeHtml(s.code)}</span> ${escapeHtml(s.name)}</div>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'assign-modal-overlay';
  modal.className = 'assign-modal-overlay';
  modal.innerHTML = `
    <div class="assign-modal assign-modal-bulk">
      <div class="assign-modal-header">
        <span class="assign-modal-title">Hromadné přiřazení (${selected.length} položek)</span>
        <button class="assign-modal-close" onclick="closeAssignModal()">✕</button>
      </div>
      <div class="assign-modal-body">
        <div class="bulk-items-list">${itemsList}</div>
        <div class="assign-modal-field">
          <label for="assign-stage">Pracoviště (společné)</label>
          <select id="assign-stage">
            <option value="">— vyberte pracoviště —</option>
            ${stageOptions}
          </select>
        </div>
        <div class="bulk-norm-mode">
          <label>Norma</label>
          <div class="bulk-norm-tabs">
            <button class="bulk-norm-tab active" onclick="switchBulkNormMode('same', this)">Stejná pro všechny</button>
            <button class="bulk-norm-tab" onclick="switchBulkNormMode('individual', this)">Individuální</button>
          </div>
        </div>
        <div id="bulk-norm-same" class="assign-modal-field">
          <label for="assign-norm">Norma (min) — pro všechny</label>
          <input type="number" id="assign-norm" min="0" step="0.1" placeholder="0" />
        </div>
        <div id="bulk-norm-individual" style="display:none">
          <table class="bulk-norm-table">
            <thead><tr><th>Kód</th><th>Název</th><th>Norma (min)</th></tr></thead>
            <tbody>
              ${selected.map(s => `<tr>
                <td><strong>${escapeHtml(s.code)}</strong></td>
                <td>${escapeHtml(s.name)}</td>
                <td><input type="number" class="bulk-norm-input" data-code="${escapeHtml(s.code)}" min="0" step="0.1" placeholder="0" /></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="assign-modal-footer">
        <button class="btn-cancel" onclick="closeAssignModal()">Zrušit</button>
        <button class="btn-confirm" onclick="confirmBulkAssignment()">Přiřadit všem</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

export function switchBulkNormMode(mode: string, btn: HTMLElement): void {
  document.querySelectorAll('.bulk-norm-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const sameEl = document.getElementById('bulk-norm-same') as HTMLElement | null;
  const indEl = document.getElementById('bulk-norm-individual') as HTMLElement | null;
  if (sameEl) sameEl.style.display = mode === 'same' ? '' : 'none';
  if (indEl) indEl.style.display = mode === 'individual' ? '' : 'none';
  (state as any)._bulkNormMode = mode;
}

export function confirmBulkAssignment(): void {
  const stageSelect = document.getElementById('assign-stage') as HTMLSelectElement | null;
  if (!stageSelect) return;

  const stageId = stageSelect.value;
  const stageName = (stageSelect.selectedOptions[0] as HTMLOptionElement)?.dataset?.name || stageSelect.selectedOptions[0]?.text || '';

  if (!stageId) {
    stageSelect.style.borderColor = '#e74c3c';
    stageSelect.focus();
    return;
  }

  const selected = getSelectedWarnings();
  const mode = (state as any)._bulkNormMode || 'same';
  let count = 0;

  if (mode === 'same') {
    const normInput = document.getElementById('assign-norm') as HTMLInputElement | null;
    const norm = parseFloat(normInput?.value || '0') || 0;
    if (norm <= 0) {
      if (normInput) { normInput.style.borderColor = '#e74c3c'; normInput.focus(); }
      return;
    }
    selected.forEach(s => {
      state.manualAssignments[s.code] = { stageId, stageName, norm, unit: 'MINUTE', assignedAt: new Date().toISOString() };
      count++;
    });
  } else {
    const inputs = document.querySelectorAll('.bulk-norm-input');
    let hasError = false;
    inputs.forEach((inp: Element) => {
      const normInput = inp as HTMLInputElement;
      const norm = parseFloat(normInput.value) || 0;
      if (norm <= 0) { normInput.style.borderColor = '#e74c3c'; hasError = true; return; }
      const code = normInput.dataset.code;
      if (code) {
        state.manualAssignments[code] = { stageId, stageName, norm, unit: 'MINUTE', assignedAt: new Date().toISOString() };
        count++;
      }
    });
    if (hasError && count === 0) return;
  }

  saveAssignmentsToStorage();
  closeAssignModal();
  renderCurrentTab();
  showToast(`Přiřazeno ${count} položkám: ${stageName}`);
}

// Expose global functions for onclick handlers in HTML
(window as any).loadProductDetail = loadProductDetail;
(window as any).switchTab = switchTab;
(window as any).applyFilters = applyFilters;
(window as any).toggleTreeNode = toggleTreeNode;
(window as any).expandAll = expandAll;
(window as any).collapseAll = collapseAll;
(window as any).normExpandAll = normExpandAll;
(window as any).normCollapseAll = normCollapseAll;
(window as any).toggleOperationBom = toggleOperationBom;
(window as any).openAssignModal = openAssignModal;
(window as any).closeAssignModal = closeAssignModal;
(window as any).confirmAssignment = confirmAssignment;
(window as any).removeAssignment = removeAssignment;
(window as any).openBulkAssignModal = openBulkAssignModal;
(window as any).switchBulkNormMode = switchBulkNormMode;
(window as any).confirmBulkAssignment = confirmBulkAssignment;
