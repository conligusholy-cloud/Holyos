/* ============================================
   interactions.ts — Drag, pan, zoom, klávesy
   ============================================ */

import type { Point, DrawingObject } from '../../../shared/types.js';
import { state } from './state.js';
import { dom, screenToWorld, snapToGrid, updateTransform, svgEl, showToast, resizeSVG, renderAll, getPolygonBBox } from './renderer.js';
import { selectObject, findObjectAt, deleteObject, duplicateObject, createObject, addRoomLabel, createPolygonObject, movePolygon, moveVertex, addWall, addGate, rotatePolygon, deselectAll } from './objects.js';
import { pushUndo } from './history.js';
import { updateTitleBar } from './storage.js';

let isDragging = false, isResizing = false, isPanning = false;
let isMovingVertex = false, movingVertexIndex = -1;
let isRotatingAroundVertex = false, rotateAnchorIndex = -1;
let rotateStartAngle = 0, rotateOrigPoints: Point[] | null = null;
let dragStartWorld: Point | null = null, dragObjStart: any = null;
let dragType: string | null = null;
let dragUndoPushed = false;
let isDraggingRoomLabel = false;

// ============================
// INICIALIZACE
// ============================

export function isPointInPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;

    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ============================
// SPLIT HANDLE
// ============================

export function initSplitHandle(): void {
  const handle = document.getElementById('split-handle');
  const topSection = document.getElementById('top-section');
  const bottomPanel = document.getElementById('bottom-panel');
  if (!handle || !topSection || !bottomPanel) return;

  let startY = 0, startHeight = 0;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    startY = e.clientY;
    startHeight = bottomPanel.offsetHeight;
    document.addEventListener('mousemove', onSplitMove);
    document.addEventListener('mouseup', onSplitUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });

  function onSplitMove(e: MouseEvent): void {
    const diff = startY - e.clientY;
    const newH = Math.max(120, Math.min(window.innerHeight - 200, startHeight + diff));
    bottomPanel!.style.height = newH + 'px';
    resizeSVG();
  }

  function onSplitUp(): void {
    document.removeEventListener('mousemove', onSplitMove);
    document.removeEventListener('mouseup', onSplitUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    resizeSVG();
  }
}

// ============================
// PALETTE DRAG
// ============================

export function initPaletteDrag(): void {
  if (!dom.container) return;

  document.querySelectorAll('.palette-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', ((e: DragEvent) => {
      const el = e.target as HTMLElement;
      dragType = el.dataset.type || null;
      if (e.dataTransfer && dragType) {
        e.dataTransfer.setData('text/plain', dragType);
        e.dataTransfer.effectAllowed = 'copy';
      }
    }) as EventListener);
  });

  dom.container.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  dom.container.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer?.getData('text/plain');
    if (!type) return;

    const world = screenToWorld(e.clientX, e.clientY);
    const obj: any = createObject(type as any, world.x, world.y);

    // Pokud karta nese metadata pracoviste (WS z palety), preneseme je na novy objekt.
    const wsJson = e.dataTransfer?.getData('application/x-factorify-ws');
    if (wsJson && obj) {
      try {
        const ws: any = JSON.parse(wsJson);
        if (ws.name) obj.name = ws.name;
        if (ws.w != null) obj.w = ws.w;
        if (ws.h != null) obj.h = ws.h;
        if (ws.id != null) obj.factorifyId = ws.id;
        if (ws.code) obj.wsCode = ws.code;
        // Rerender (primo) + sediva karta v palete (drag-and-drop jedenkrat).
        renderAll();
        const mod = (window as any).__module__;
        if (mod && typeof mod.markUsedWorkstations === 'function') mod.markUsedWorkstations();
      } catch (err) {
        console.warn('drop WS metadata parse fail', err);
      }
    }
  });
}

// ============================
// CANVAS MOUSE
// ============================

export function initCanvasMouse(): void {
  if (!dom.container) return;

  dom.container.addEventListener('mousedown', (e: MouseEvent) => {
    // Pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      dragStartWorld = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      dom.container!.classList.add('panning');
      return;
    }

    if (e.button !== 0) return;
    const world = screenToWorld(e.clientX, e.clientY);

    // Klik na objekt
    const clicked = findObjectAt(world.x, world.y);
    if (clicked && !clicked.locked) {
      pushUndo();
      isDragging = true;
      dragStartWorld = { x: world.x, y: world.y };
      if (clicked.points) {
        dragObjStart = { points: clicked.points.map(p => ({ ...p })) };
      } else {
        dragObjStart = { x: clicked.x, y: clicked.y };
      }
      selectObject(clicked.id);
    } else if (clicked) {
      selectObject(clicked.id);
    } else {
      deselectAll();
    }
  });

  dom.container.addEventListener('mousemove', (e: MouseEvent) => {
    const world = screenToWorld(e.clientX, e.clientY);

    if (isPanning && dragStartWorld) {
      state.panX = e.clientX - dragStartWorld.x;
      state.panY = e.clientY - dragStartWorld.y;
      updateTransform();
      return;
    }

    if (isDragging && state.selected && dragStartWorld && dragObjStart) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (!obj) return;
      const dx = world.x - dragStartWorld.x;
      const dy = world.y - dragStartWorld.y;
      if (obj.points) {
        const snappedDx = snapToGrid(dx);
        const snappedDy = snapToGrid(dy);
        obj.points = dragObjStart.points.map((p: Point) => ({
          x: p.x + snappedDx,
          y: p.y + snappedDy
        }));
        const bbox = getPolygonBBox(obj.points || []);
        obj.x = bbox.minX;
        obj.y = bbox.minY;
        obj.w = bbox.maxX - bbox.minX;
        obj.h = bbox.maxY - bbox.minY;
      } else {
        obj.x = snapToGrid(dragObjStart.x + dx);
        obj.y = snapToGrid(dragObjStart.y + dy);
      }
      renderAll();
    }
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    isPanning = false;
    dragStartWorld = null;
    dragObjStart = null;
    dom.container!.classList.remove('panning');
  });
}

// ============================
// ZOOM
// ============================

export function initZoom(): void {
  if (!dom.container) return;

  dom.container.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, state.zoom * delta));
    const rect = dom.container!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
    state.panY = my - (my - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;
    updateTransform();
  }, { passive: false });
}

export function zoomIn(): void {
  state.zoom = Math.min(5, state.zoom * 1.2);
  updateTransform();
}

export function zoomOut(): void {
  state.zoom = Math.max(0.1, state.zoom / 1.2);
  updateTransform();
}

export function zoomFit(): void {
  const allObjects = [...(state.arealObjects || []), ...state.objects];
  if (allObjects.length === 0) {
    state.zoom = 1;
    state.panX = 50;
    state.panY = 50;
    updateTransform();
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  allObjects.forEach(o => {
    if (o.points) {
      o.points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    } else {
      minX = Math.min(minX, o.x);
      minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + (o.w || 0));
      maxY = Math.max(maxY, o.y + (o.h || 0));
    }
  });
  const ww = maxX - minX + 10;
  const wh = maxY - minY + 10;
  const cw = dom.container?.clientWidth || 800;
  const ch = dom.container?.clientHeight || 600;
  if (ww <= 0 || wh <= 0) {
    state.zoom = 1;
    state.panX = 50;
    state.panY = 50;
    updateTransform();
    return;
  }
  state.zoom = Math.min(cw / (ww * state.pxPerMeter), ch / (wh * state.pxPerMeter)) * 0.9;
  state.zoom = Math.max(0.1, Math.min(5, state.zoom));
  if (isNaN(state.zoom)) state.zoom = 1;
  state.panX = (cw - ww * state.zoom * state.pxPerMeter) / 2 - minX * state.zoom * state.pxPerMeter + 5 * state.zoom * state.pxPerMeter;
  state.panY = (ch - wh * state.zoom * state.pxPerMeter) / 2 - minY * state.zoom * state.pxPerMeter + 5 * state.zoom * state.pxPerMeter;
  if (isNaN(state.panX)) state.panX = 50;
  if (isNaN(state.panY)) state.panY = 50;
  updateTransform();
}

export function toggleGrid(): void {
  state.gridVisible = !state.gridVisible;
  const gridLayer = document.getElementById('grid-layer');
  if (gridLayer) gridLayer.style.display = state.gridVisible ? '' : 'none';
  const btn = document.getElementById('btn-grid');
  if (btn) btn.classList.toggle('active', state.gridVisible);
}

export function toggleSnap(): void {
  state.snapEnabled = !state.snapEnabled;
  const btn = document.getElementById('btn-snap');
  if (btn) btn.classList.toggle('active', state.snapEnabled);
}

export function toggleConnectMode(): void {
  state.connectMode = !state.connectMode;
  const btn = document.getElementById('connect-mode-btn');
  if (btn) {
    btn.classList.toggle('active', state.connectMode);
  }
  if (dom.container) {
    dom.container.style.cursor = state.connectMode ? 'crosshair' : '';
  }
}

export function confirmDistanceAndPlace(): void {
  const input = document.getElementById('distance-input') as HTMLInputElement | null;
  if (input && input.value) {
    const distance = parseFloat(input.value);
    if (!isNaN(distance) && distance > 0) {
      console.log('Distance confirmed:', distance);
      hideDistanceInput();
    }
  }
}

export function hideDistanceInput(): void {
  const dialog = document.getElementById('distance-dialog');
  if (dialog) dialog.style.display = 'none';
}

// ============================
// KEYBOARD
// ============================

export function initKeyboard(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      (window as any).__module__?.undo?.();
      return;
    }
    if (((e.key === 'y' || e.key === 'Y') && e.ctrlKey) || ((e.key === 'z' || e.key === 'Z') && e.ctrlKey && e.shiftKey)) {
      e.preventDefault();
      (window as any).__module__?.redo?.();
      return;
    }

    if (e.key === 'Escape') {
      deselectAll();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selected) {
        const selObj = state.objects.find(o => o.id === state.selected);
        if (selObj && !selObj.locked) deleteObject(state.selected);
      }
    }
    if ((e.key === 'd' || e.key === 'D') && e.ctrlKey) {
      e.preventDefault();
      if (state.selected) duplicateObject(state.selected);
    }
    if ((e.key === 's' || e.key === 'S') && e.ctrlKey) {
      e.preventDefault();
      (window as any).__module__?.saveProject?.();
    }
    if (e.key === 'g' || e.key === 'G') {
      toggleGrid();
    }
  });
}
