/* ============================================
   interactions.ts — Drag, pan, zoom, klávesy
   ============================================ */

import { state } from './state.js';
import { dom, screenToWorld, updateTransform, renderAll, snapToGrid, getPolygonBBox, svgEl, renderDrawPreview, renderEntrancePlacePreview, renderWallDrawPreview, renderWallSnapHover, renderGatePlacePreview, isPointInPolygon } from './renderer.js';
import { COLORS, DEFAULT_SIZES, ENTRANCE_TYPES } from './config.js';
import { createObject, createPolygonObject, findObjectAt, selectObject, deleteObject, duplicateObject, moveVertex, movePolygon, findNearestArealEdge, addWall, findNearestWall, projectOntoWall, addGate, addRoomLabel, rotatePolygon, addEntrance } from './objects.js';
import type { ObjectType } from '../../../shared/types.js';
import { pushUndo, undo, redo } from './history.js';
import { showProperties, deselectAll, getRotateCenter, updateVertex, updateEdgeDistance, removeVertex, updateGateProp, toggleLock } from './properties.js';
import { showToast, saveProject, closeSaveDialog } from './storage.js';

// ============================
// Global drag state
// ============================

let isDragging = false, isResizing = false, isPanning = false;
let isMovingVertex = false, movingVertexIndex = -1;
let isRotatingAroundVertex = false, rotateAnchorIndex = -1;
let rotateStartAngle = 0, rotateOrigPoints: any = null;
let dragStartWorld: any = null, dragObjStart: any = null;
let dragType: string | null = null;
let entrancePlaceObjId: number | null = null;
let dragUndoPushed = false;
let isDraggingRoomLabel = false, dragRoomLabelObj: any = null, dragRoomLabel: any = null, dragRoomLabelStart: any = null;

// ============================
// DRAW MODE (kreslení polygonů)
// ============================

export function startDrawMode(type: any): void {
  cancelAllModes();
  state.drawMode = true;
  state.drawType = type;
  state.drawPoints = [];
  state.drawConstraint = null;
  state.drawDistance = null;
  if (dom.container) dom.container.style.cursor = 'crosshair';
  updateDrawStatus();
  if (dom.container) dom.container.classList.add('drawing');
}

export function cancelDrawMode(): void {
  state.drawMode = false;
  state.drawType = null;
  state.drawPoints = [];
  state.drawConstraint = null;
  state.drawDistance = null;
  if (dom.drawLayer) dom.drawLayer.innerHTML = '';
  if (dom.container) dom.container.style.cursor = '';
  if (dom.container) dom.container.classList.remove('drawing');
  hideDistanceInput();
  updateDrawStatus();
}

export function finishPolygon(): void {
  if (state.drawPoints.length >= 3) {
    createPolygonObject(state.drawType, state.drawPoints);
  }
  cancelDrawMode();
}

export function applyDrawConstraint(snapped: any): any {
  if (state.drawPoints.length === 0) return snapped;
  const last = state.drawPoints[state.drawPoints.length - 1];
  let x = snapped.x, y = snapped.y;

  if (state.drawConstraint === 'h') y = last.y;
  else if (state.drawConstraint === 'v') x = last.x;

  if (state.drawDistance != null && state.drawDistance > 0) {
    const dx = x - last.x;
    const dy = y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.01) {
      x = last.x + (dx / dist) * state.drawDistance;
      y = last.y + (dy / dist) * state.drawDistance;
    }
  }

  return { x: snapToGrid(x), y: snapToGrid(y) };
}

export function toggleDrawConstraint(type: any): void {
  if (!state.drawMode || state.drawPoints.length === 0) return;
  state.drawConstraint = (state.drawConstraint === type) ? null : type;
  updateDrawStatus();
}

// ---- Distance Input ----
export function showDistanceInput(): void {
  let input = document.getElementById('draw-distance-input') as HTMLElement;
  if (!input) return;
  input.style.display = 'flex';
  const field = input.querySelector('input') as HTMLInputElement;
  field.value = state.drawDistance?.toString() || '';
  field.focus();
  field.select();
}

export function hideDistanceInput(): void {
  let input = document.getElementById('draw-distance-input');
  if (input) input.style.display = 'none';
}

export function setDrawDistance(val: any): void {
  const num = parseFloat(val);
  state.drawDistance = (num > 0) ? num : null;
  updateDrawStatus();
}

export function confirmDistanceAndPlace(): void {
  if (!state.drawMode || state.drawPoints.length === 0) return;
  const val = (document.getElementById('draw-dist-field') as HTMLInputElement)?.value;
  setDrawDistance(val);

  if (state.drawDistance && state.drawConstraint) {
    const last = state.drawPoints[state.drawPoints.length - 1];
    let x = last.x, y = last.y;
    if (state.drawConstraint === 'h') x = last.x + state.drawDistance;
    else if (state.drawConstraint === 'v') y = last.y + state.drawDistance;
    const snapped = { x: snapToGrid(x), y: snapToGrid(y) };
    state.drawPoints.push(snapped);
    state.drawDistance = null;
    hideDistanceInput();
    updateDrawStatus();
    renderDrawPreview(snapped);
  }
}

// ============================
// ENTRANCE PLACEMENT (dva body)
// ============================

export function startEntrancePlacement(objId: number, type: any): void {
  cancelAllModes();
  state.entrancePlaceMode = true;
  state.entrancePlaceType = type || 'vjezd';
  state.entrancePlaceStep = 0;
  state.entrancePlaceFirstPoint = null;
  entrancePlaceObjId = objId;
  if (dom.container) dom.container.style.cursor = 'crosshair';
  if (dom.container) dom.container.classList.add('drawing');
  updateDrawStatus();
}

export function startEntrancePlacementGlobal(type: any): void {
  cancelAllModes();
  state.entrancePlaceMode = true;
  state.entrancePlaceType = type || 'vjezd';
  state.entrancePlaceStep = 0;
  state.entrancePlaceFirstPoint = null;
  entrancePlaceObjId = null;
  if (dom.container) dom.container.style.cursor = 'crosshair';
  if (dom.container) dom.container.classList.add('drawing');
  updateDrawStatus();
}

export function cancelEntrancePlacement(): void {
  state.entrancePlaceMode = false;
  state.entrancePlaceStep = 0;
  state.entrancePlaceFirstPoint = null;
  entrancePlaceObjId = null;
  if (dom.snapLayer) dom.snapLayer.innerHTML = '';
  if (dom.container) dom.container.style.cursor = '';
  if (dom.container) dom.container.classList.remove('drawing');
  updateDrawStatus();
}

export function handleEntranceClick(world: any): void {
  const nearest = findNearestArealEdge(world.x, world.y);
  if (!nearest) {
    showToast('Klikni blíž k hraně areálu nebo haly');
    return;
  }

  if (entrancePlaceObjId && nearest.objId !== entrancePlaceObjId) {
    showToast('Klikni na hranu vybraného objektu');
    return;
  }

  if (state.entrancePlaceStep === 0) {
    // První bod
    state.entrancePlaceStep = 1;
    state.entrancePlaceFirstPoint = {
      objId: nearest.objId,
      edgeIndex: nearest.edgeIndex,
      t: nearest.t,
      px: nearest.px,
      py: nearest.py,
    };
    updateDrawStatus();
  } else {
    // Druhý bod — musí být na stejné hraně
    const fp = state.entrancePlaceFirstPoint;
    if (!fp) {
      showToast('Chyba: první bod vjezdu nenalezen');
      return;
    }
    if (nearest.objId !== fp.objId || nearest.edgeIndex !== fp.edgeIndex) {
      showToast('Druhý bod musí být na stejné hraně');
      return;
    }

    addEntrance(fp.objId, fp.edgeIndex, fp.t, nearest.t, state.entrancePlaceType);
    selectObject(fp.objId);
    cancelEntrancePlacement();
  }
}

// ============================
// WALL DRAW MODE (stěny v hale)
// ============================

export function startWallDrawMode(objId: number): void {
  cancelAllModes();
  state.wallDrawMode = true;
  state.wallDrawObjId = objId;
  state.wallDrawStart = null;
  state.wallDrawSnap = null;
  if (dom.container) dom.container.style.cursor = 'crosshair';
  if (dom.container) dom.container.classList.add('drawing');
  updateDrawStatus();
  showWallDistInput();
}

export function cancelWallDrawMode(): void {
  state.wallDrawMode = false;
  state.wallDrawObjId = null;
  state.wallDrawStart = null;
  if (dom.snapLayer) dom.snapLayer.innerHTML = '';
  if (dom.container) dom.container.style.cursor = '';
  if (dom.container) dom.container.classList.remove('drawing');
  hideWallDistInput();
  updateDrawStatus();
}

interface EdgeSnap {
  edgeType: string;
  edgeIndex?: number;
  wallId?: number;
  x: number;
  y: number;
  t: number;
  edgeStart: any;
  edgeEnd: any;
  edgeLen: number;
  distFromStart: number;
}

function findNearestEdgeInHall(obj: any, wx: number, wy: number): EdgeSnap | null {
  let best: EdgeSnap | null = null;
  let bestDist = Infinity;

  // 1. Hrany obvodu polygonu
  if (obj.points && obj.points.length >= 3) {
    for (let i = 0; i < obj.points.length; i++) {
      const j = (i + 1) % obj.points.length;
      const p1 = obj.points[i], p2 = obj.points[j];
      const snap = projectPointOnEdge(wx, wy, p1.x, p1.y, p2.x, p2.y);
      if (snap.dist < bestDist) {
        bestDist = snap.dist;
        best = { edgeType: 'perimeter', edgeIndex: i,
          x: snap.px, y: snap.py, t: snap.t,
          edgeStart: { x: p1.x, y: p1.y }, edgeEnd: { x: p2.x, y: p2.y },
          edgeLen: snap.edgeLen, distFromStart: snap.t * snap.edgeLen };
      }
    }
  }

  // 2. Existující stěny
  if (obj.walls) {
    for (const wall of obj.walls) {
      const snap = projectPointOnEdge(wx, wy, wall.x1, wall.y1, wall.x2, wall.y2);
      if (snap.dist < bestDist) {
        bestDist = snap.dist;
        best = { edgeType: 'wall', wallId: wall.id,
          x: snap.px, y: snap.py, t: snap.t,
          edgeStart: { x: wall.x1, y: wall.y1 }, edgeEnd: { x: wall.x2, y: wall.y2 },
          edgeLen: snap.edgeLen, distFromStart: snap.t * snap.edgeLen };
      }
    }
  }

  return bestDist < 3 / state.zoom ? best : null;
}

function projectPointOnEdge(wx: number, wy: number, x1: number, y1: number, x2: number, y2: number): any {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const edgeLen = Math.sqrt(lenSq);
  if (lenSq < 0.001) return { px: x1, py: y1, t: 0, dist: Math.sqrt((wx - x1) ** 2 + (wy - y1) ** 2), edgeLen: 0 };

  let t = ((wx - x1) * dx + (wy - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const dist = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);

  return { px, py, t, dist, edgeLen };
}

function getPointOnEdgeByDist(edgeStart: any, edgeEnd: any, distance: number): any {
  const dx = edgeEnd.x - edgeStart.x;
  const dy = edgeEnd.y - edgeStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return { x: edgeStart.x, y: edgeStart.y };
  const t = Math.max(0, Math.min(1, distance / len));
  return { x: edgeStart.x + t * dx, y: edgeStart.y + t * dy };
}

export function handleWallClick(world: any): void {
  const obj = state.objects.find(o => o.id === state.wallDrawObjId);
  if (!obj) return;

  const snap = findNearestEdgeInHall(obj, world.x, world.y);

  if (!state.wallDrawStart) {
    if (snap) {
      state.wallDrawSnap = snap;
      updateWallDistInput(snap.distFromStart, snap.edgeLen, 'start');
      state.wallDrawStart = null;
      updateDrawStatus();
      renderWallSnapHover(snap);
    } else {
      const snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
      state.wallDrawStart = snapped;
      state.wallDrawSnap = null;
      updateDrawStatus();
      hideWallDistInput();
    }
  } else {
    if (snap) {
      state.wallDrawSnap = snap;
      updateWallDistInput(snap.distFromStart, snap.edgeLen, 'end');
      updateDrawStatus();
      renderWallSnapHover(snap);
    } else {
      const snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
      finishWall(snapped);
    }
  }
}

export function confirmWallPoint(): void {
  const input = document.getElementById('wall-dist-field') as HTMLInputElement;
  if (!input) return;
  const dist = parseFloat(input.value);
  if (isNaN(dist) || dist < 0) return;

  const snap = state.wallDrawSnap;
  if (!snap) return;

  const pt = getPointOnEdgeByDist(snap.edgeStart, snap.edgeEnd, dist);

  if (!state.wallDrawStart) {
    state.wallDrawStart = pt;
    state.wallDrawSnap = null;
    hideWallDistInput();
    updateDrawStatus();
  } else {
    finishWall(pt);
  }
}

export function finishWall(endPoint: any): void {
  const s = state.wallDrawStart;
  if (!s) return;
  const dist = Math.sqrt((endPoint.x - s.x) ** 2 + (endPoint.y - s.y) ** 2);
  if (dist < 0.3) {
    showToast('Stěna je příliš krátká');
    return;
  }
  addWall(state.wallDrawObjId!, s.x, s.y, endPoint.x, endPoint.y);
  state.wallDrawStart = null;
  state.wallDrawSnap = null;
  hideWallDistInput();
  updateDrawStatus();
}

// === Wall distance input UI ===
function showWallDistInput(): void {
  let box = document.getElementById('wall-dist-input');
  if (box) { box.style.display = 'none'; return; }
  box = document.createElement('div');
  box.id = 'wall-dist-input';
  box.style.cssText = 'display:none;position:fixed;bottom:50px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:8px 12px;z-index:999;gap:8px;align-items:center;font-size:13px;color:var(--text);box-shadow:0 4px 16px rgba(0,0,0,0.4);';
  box.innerHTML = `
    <span id="wall-dist-label" style="white-space:nowrap;color:var(--text2);font-size:12px;">Vzdálenost:</span>
    <input type="number" id="wall-dist-field" step="0.5" min="0" style="width:70px;padding:4px 8px;font-size:13px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:5px;outline:none;"
      onkeydown="if(event.key==='Enter'){window.editorAPI.confirmWallPoint();event.preventDefault();}">
    <span id="wall-dist-max" style="font-size:11px;color:var(--text2);"></span>
    <button class="btn" onclick="window.editorAPI.confirmWallPoint()" style="padding:4px 10px;font-size:12px;">OK</button>
  `;
  document.body.appendChild(box);
}

function updateWallDistInput(distValue: number, maxLen: number, step: string): void {
  let box = document.getElementById('wall-dist-input');
  if (!box) { showWallDistInput(); box = document.getElementById('wall-dist-input'); }
  (box as HTMLElement).style.display = 'flex';
  const label = document.getElementById('wall-dist-label');
  const field = document.getElementById('wall-dist-field') as HTMLInputElement;
  const maxSpan = document.getElementById('wall-dist-max');
  if (label) label.textContent = step === 'start' ? 'Počátek — vzdálenost od rohu:' : 'Konec — vzdálenost od rohu:';
  field.value = distValue.toFixed(1);
  field.max = maxLen.toString();
  if (maxSpan) maxSpan.textContent = `/ ${maxLen.toFixed(1)} m`;
  field.focus();
  field.select();
}

function hideWallDistInput(): void {
  const box = document.getElementById('wall-dist-input');
  if (box) box.style.display = 'none';
}

// ============================
// GATE PLACEMENT MODE (vrata)
// ============================

export function startGatePlacement(objId: number, wallId: number): void {
  cancelAllModes();
  state.gatePlaceMode = true;
  state.gatePlaceObjId = objId;
  state.gatePlaceWallId = wallId;
  if (dom.container) dom.container.style.cursor = 'crosshair';
  if (dom.container) dom.container.classList.add('drawing');
  updateDrawStatus();
}

export function cancelGatePlacement(): void {
  state.gatePlaceMode = false;
  state.gatePlaceObjId = null;
  state.gatePlaceWallId = null;
  if (dom.snapLayer) dom.snapLayer.innerHTML = '';
  if (dom.container) dom.container.style.cursor = '';
  if (dom.container) dom.container.classList.remove('drawing');
  updateDrawStatus();
}

export function handleGateClick(world: any): void {
  const objId = state.gatePlaceObjId;
  const wallId = state.gatePlaceWallId;
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;

  const projected = projectOntoWall(obj, wallId!, world.x, world.y);
  if (!projected || projected.dist > 8) {
    showToast('Klikni blíž ke stěně');
    return;
  }

  addGate(objId!, wallId!, projected.t, 3);
  cancelGatePlacement();
  selectObject(objId!);
}

// ============================
// ROOM LABEL PLACEMENT MODE
// ============================

export function startRoomLabelPlacement(objId: number): void {
  cancelAllModes();
  state.roomLabelPlaceMode = true;
  state.roomLabelPlaceObjId = objId;
  if (dom.container) dom.container.style.cursor = 'crosshair';
  if (dom.container) dom.container.classList.add('drawing');
  updateDrawStatus();
}

export function cancelRoomLabelPlacement(): void {
  state.roomLabelPlaceMode = false;
  state.roomLabelPlaceObjId = null;
  if (dom.snapLayer) dom.snapLayer.innerHTML = '';
  if (dom.container) dom.container.style.cursor = '';
  if (dom.container) dom.container.classList.remove('drawing');
  updateDrawStatus();
}

export function handleRoomLabelClick(world: any): void {
  const objId = state.roomLabelPlaceObjId;
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;

  if (obj.points && !isPointInPolygon(world.x, world.y, obj.points)) {
    showToast('Klikni dovnitř objektu');
    return;
  }

  addRoomLabel(objId!, world.x, world.y);
  cancelRoomLabelPlacement();
  selectObject(objId!);
}

// ============================
// CANCEL ALL MODES
// ============================

export function cancelAllModes(): void {
  if (state.drawMode) cancelDrawMode();
  if (state.entrancePlaceMode) cancelEntrancePlacement();
  if (state.wallDrawMode) cancelWallDrawMode();
  if (state.gatePlaceMode) cancelGatePlacement();
  if (state.roomLabelPlaceMode) cancelRoomLabelPlacement();
  state.connectMode = false;
  state.connectFrom = null;
}

// ============================
// DRAW STATUS BAR
// ============================

export function updateDrawStatus(): void {
  if (!dom.drawStatus) return;

  if (state.gatePlaceMode) {
    dom.drawStatus.textContent = 'Umísťuji vrata — klikni na stěnu  |  Escape pro zrušení';
    dom.drawStatus.style.display = 'flex';
    dom.drawStatus.style.borderColor = '#f59e0b';
  } else if (state.wallDrawMode) {
    let msg;
    if (state.wallDrawStart) msg = 'Stěna — klikni na obvod/stěnu pro koncový bod  |  Escape';
    else msg = 'Stěna — klikni na obvod nebo stěnu pro počáteční bod  |  Escape';
    dom.drawStatus.textContent = msg;
    dom.drawStatus.style.display = 'flex';
    dom.drawStatus.style.borderColor = '#a0a0c0';
  } else if (state.entrancePlaceMode) {
    const eType = ENTRANCE_TYPES[state.entrancePlaceType] || ENTRANCE_TYPES.vjezd;
    const step = state.entrancePlaceStep === 1
      ? 'klikni pro druhý bod šířky'
      : 'klikni na hranu — první bod šířky';
    dom.drawStatus.textContent = `${eType.label} — ${step}  |  Escape pro zrušení`;
    dom.drawStatus.style.display = 'flex';
    dom.drawStatus.style.borderColor = eType.color;
  } else if (state.roomLabelPlaceMode) {
    dom.drawStatus.textContent = 'Místnost — klikni dovnitř prostoru pro umístění popisku  |  Escape pro zrušení';
    dom.drawStatus.style.display = 'flex';
    dom.drawStatus.style.borderColor = '#60a5fa';
  } else if (state.drawMode) {
    const color = COLORS[state.drawType!] || COLORS.hala;
    const count = state.drawPoints.length;
    let msg = `Kreslím: ${color.label} — `;
    if (count === 0) msg += 'klikni pro první bod';
    else if (count < 3) msg += `${count} bodů — pokračuj klikáním`;
    else msg += `${count} bodů — dvojklik/Enter pro uzavření`;

    if (state.drawConstraint === 'h') msg += '  |  ⟷ Vodorovně (H)';
    else if (state.drawConstraint === 'v') msg += '  |  ⟰ Svisle (V)';
    if (count > 0 && !state.drawConstraint) msg += '  |  H=vodorovně  V=svisle  D=délka';
    if (state.drawDistance) msg += `  |  Délka: ${state.drawDistance} m`;

    dom.drawStatus.textContent = msg;
    dom.drawStatus.style.display = 'flex';
    dom.drawStatus.style.borderColor = color.stroke;
  } else {
    dom.drawStatus.style.display = 'none';
  }
}

// ============================
// DRAG FROM PALETTE
// ============================

export function initPaletteDrag(): void {
  document.querySelectorAll('.palette-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', (e: any) => {
      dragType = (item as any).dataset.type;
      e.dataTransfer.setData('text/plain', dragType);
      e.dataTransfer.effectAllowed = 'copy';
      if (dom.ghost) {
        dom.ghost.style.display = 'block';
        const color = COLORS[dragType as ObjectType] || COLORS.hala;
        dom.ghost.innerHTML = `<div style="background:${color.stroke}33; border:2px solid ${color.stroke}; border-radius:8px; padding:8px 14px; color:${color.stroke}; font-size:13px; font-weight:500;">${color.label}</div>`;
        e.dataTransfer.setDragImage(dom.ghost, 40, 20);
      }
    });
    item.addEventListener('dragend', () => {
      if (dom.ghost) dom.ghost.style.display = 'none';
      dragType = null;
    });
  });

  document.querySelectorAll('.palette-item[data-draw]').forEach(item => {
    item.addEventListener('click', () => {
      const type = (item as any).dataset.draw;
      if (state.drawMode && state.drawType === type) {
        cancelDrawMode();
      } else {
        startDrawMode(type);
      }
    });
  });

  if (dom.container) {
    dom.container.addEventListener('dragover', (e: any) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    dom.container.addEventListener('drop', (e: any) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/plain');
      if (!type || !COLORS[type as ObjectType]) return;
      const world = screenToWorld(e.clientX, e.clientY);
      const sz = DEFAULT_SIZES[type as ObjectType];
      createObject(type as ObjectType, world.x - sz.w / 2, world.y - sz.h / 2);
    });
  }
}

// ============================
// MOUSE ON CANVAS
// ============================

export function initCanvasMouse(): void {
  if (!dom.container) return;

  dom.container.addEventListener('mousedown', (e: any) => {
    // Pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      dragStartWorld = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      dom.container!.classList.add('panning');
      return;
    }

    if (e.button !== 0) return;
    const world = screenToWorld(e.clientX, e.clientY);

    if (state.gatePlaceMode) {
      handleGateClick(world);
      return;
    }

    if (state.roomLabelPlaceMode) {
      handleRoomLabelClick(world);
      return;
    }

    if (state.wallDrawMode) {
      handleWallClick(world);
      return;
    }

    if (state.entrancePlaceMode) {
      handleEntranceClick(world);
      return;
    }

    if (state.drawMode) {
      handleDrawClick(world);
      return;
    }

    // ---- ROOM LABEL DRAG ----
    {
      const target = e.target;
      if (target && (target as any).dataset && (target as any).dataset.action === 'drag-room-label') {
        const rlObjId = parseInt((target as any).dataset.objId);
        const rlRoomId = parseInt((target as any).dataset.roomId);
        const rlObj = state.objects.find(o => o.id === rlObjId);
        if (rlObj && rlObj.rooms) {
          const rlRoom = rlObj.rooms.find(r => r.id === rlRoomId);
          if (rlRoom) {
            pushUndo();
            isDraggingRoomLabel = true;
            dragRoomLabelObj = rlObj;
            dragRoomLabel = rlRoom;
            dragStartWorld = { x: world.x, y: world.y };
            dragRoomLabelStart = { x: rlRoom.x, y: rlRoom.y };
            if (dom.container) dom.container.style.cursor = 'grabbing';
            selectObject(rlObjId);
            return;
          }
        }
      }
    }

    // ---- VERTEX: ROTATE nebo MOVE ----
    if (state.selected) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (obj && obj.points && !obj.locked) {
        for (let i = 0; i < obj.points.length; i++) {
          const p = obj.points[i];
          const dist = Math.sqrt((world.x - p.x) ** 2 + (world.y - p.y) ** 2);
          const vertexThreshold = 0.7 / state.zoom;
          const rotateThreshold = 2.0 / state.zoom;

          if (dist < rotateThreshold) {
            pushUndo();
            if (e.shiftKey || dist >= vertexThreshold) {
              isRotatingAroundVertex = true;
              rotateAnchorIndex = i;
              rotateOrigPoints = obj.points.map((pt: any) => ({ ...pt }));
              rotateStartAngle = Math.atan2(world.y - p.y, world.x - p.x);
              if (dom.container) dom.container.style.cursor = 'grabbing';
            } else {
              isMovingVertex = true;
              movingVertexIndex = i;
            }
            dragStartWorld = { x: world.x, y: world.y };
            return;
          }
        }
      }
    }

    // ---- RESIZE HANDLE ----
    if (state.selected) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (obj && !obj.points && !obj.locked) {
        const hx = obj.x + obj.w;
        const hy = obj.y + obj.h;
        const dist = Math.sqrt((world.x - hx) ** 2 + (world.y - hy) ** 2);
        if (dist < 1.5 / state.zoom) {
          pushUndo();
          isResizing = true;
          dragStartWorld = { x: world.x, y: world.y };
          dragObjStart = { w: obj.w, h: obj.h };
          return;
        }
      }
    }

    // ---- KLIK NA OBJEKT ----
    const clicked = findObjectAt(world.x, world.y);

    if (state.connectMode && clicked) {
      handleConnectClick(clicked);
      return;
    }

    if (clicked) {
      selectObject(clicked.id);
      if (!clicked.locked) {
        pushUndo();
        isDragging = true;
        dragStartWorld = { x: world.x, y: world.y };
        if (clicked.points) {
          dragObjStart = { points: clicked.points.map((p: any) => ({ ...p })) };
        } else {
          dragObjStart = { x: clicked.x, y: clicked.y };
        }
      }
    } else {
      deselectAll();
    }
  });

  dom.container.addEventListener('dblclick', (e: any) => {
    if (state.drawMode && state.drawPoints.length >= 3) {
      finishPolygon();
    }
  });

  dom.container.addEventListener('mousemove', (e: any) => {
    const world = screenToWorld(e.clientX, e.clientY);
    if (dom.coordsDisplay) {
      dom.coordsDisplay.textContent = `X: ${world.x.toFixed(1)} m   Y: ${world.y.toFixed(1)} m`;
    }

    if (state.gatePlaceMode) {
      const gObj = state.objects.find(o => o.id === state.gatePlaceObjId);
      if (gObj) {
        const projected = projectOntoWall(gObj, state.gatePlaceWallId!, world.x, world.y);
        renderGatePlacePreview(gObj, state.gatePlaceWallId!, projected);
      }
    }

    if (state.selected && !isDragging && !isMovingVertex && !isRotatingAroundVertex && !isResizing && !state.drawMode && !state.gatePlaceMode && !state.wallDrawMode && !state.entrancePlaceMode) {
      const hoverObj = state.objects.find(o => o.id === state.selected);
      if (hoverObj && hoverObj.points && !hoverObj.locked) {
        let nearVertex = false;
        for (let i = 0; i < hoverObj.points.length; i++) {
          const p = hoverObj.points[i];
          const d = Math.sqrt((world.x - p.x) ** 2 + (world.y - p.y) ** 2);
          if (d < 2.0 / state.zoom) {
            nearVertex = true;
            if (d >= 0.7 / state.zoom) {
              if (dom.container) dom.container.style.cursor = 'grab';
            }
            break;
          }
        }
        if (!nearVertex && dom.container && dom.container.style.cursor === 'grab') {
          dom.container.style.cursor = '';
        }
      }
    }

    if (state.wallDrawMode && state.wallDrawStart === null) {
      const obj = state.objects.find(o => o.id === state.wallDrawObjId);
      if (obj) {
        const hoverSnap = findNearestEdgeInHall(obj, world.x, world.y);
        if (hoverSnap) {
          renderWallSnapHover(hoverSnap);
        } else {
          if (dom.snapLayer) dom.snapLayer.innerHTML = '';
          if (state.wallDrawStart) renderWallDrawPreview(world);
        }
        if (state.wallDrawStart && hoverSnap) {
          renderWallSnapHover(hoverSnap);
        }
      }
    }

    if (state.entrancePlaceMode) {
      renderEntrancePlacePreview(world);
    }

    if (state.drawMode) {
      let preview = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
      preview = applyDrawConstraint(preview);
      renderDrawPreview(preview);
    }

    if (isPanning) {
      state.panX = e.clientX - dragStartWorld.x;
      state.panY = e.clientY - dragStartWorld.y;
      updateTransform();
      return;
    }

    if (isRotatingAroundVertex && state.selected) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (obj && rotateOrigPoints) {
        const anchor = rotateOrigPoints[rotateAnchorIndex];
        const currentAngle = Math.atan2(world.y - anchor.y, world.x - anchor.x);
        let angleDelta = currentAngle - rotateStartAngle;

        const snapDeg = 5;
        const snapRad = snapDeg * Math.PI / 180;
        angleDelta = Math.round(angleDelta / snapRad) * snapRad;

        const cos = Math.cos(angleDelta);
        const sin = Math.sin(angleDelta);

        obj.points = rotateOrigPoints.map((p: any) => ({
          x: anchor.x + (p.x - anchor.x) * cos - (p.y - anchor.y) * sin,
          y: anchor.y + (p.x - anchor.x) * sin + (p.y - anchor.y) * cos,
        }));

        const bbox = getPolygonBBox(obj.points || []);
        obj.x = bbox.minX;
        obj.y = bbox.minY;
        obj.w = bbox.maxX - bbox.minX;
        obj.h = bbox.maxY - bbox.minY;

        renderAll();

        if (dom.snapLayer) {
          dom.snapLayer.innerHTML = '';
          const angleDeg = (angleDelta * 180 / Math.PI).toFixed(0);
          const label = svgEl('text');
          label.setAttribute('x', anchor.x.toString());
          label.setAttribute('y', (anchor.y - 2).toString());
          label.setAttribute('font-size', '0.8');
          label.setAttribute('fill', '#f59e0b');
          label.setAttribute('text-anchor', 'middle');
          label.setAttribute('dominant-baseline', 'middle');
          label.setAttribute('font-family', "'Segoe UI', sans-serif");
          label.textContent = angleDeg + '°';
          dom.snapLayer.appendChild(label);

          const radius = 3;
          const startA = rotateStartAngle;
          const endA = rotateStartAngle + angleDelta;
          const x1 = anchor.x + radius * Math.cos(startA);
          const y1 = anchor.y + radius * Math.sin(startA);
          const x2 = anchor.x + radius * Math.cos(endA);
          const y2 = anchor.y + radius * Math.sin(endA);
          const largeArc = Math.abs(angleDelta) > Math.PI ? 1 : 0;
          const sweep = angleDelta > 0 ? 1 : 0;

          if (Math.abs(angleDelta) > 0.01) {
            const arc = svgEl('path');
            arc.setAttribute('d', `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${x2} ${y2}`);
            arc.setAttribute('fill', 'none');
            arc.setAttribute('stroke', '#f59e0b');
            arc.setAttribute('stroke-width', '0.1');
            arc.setAttribute('opacity', '0.6');
            dom.snapLayer.appendChild(arc);
          }

          const circle = svgEl('circle');
          circle.setAttribute('cx', anchor.x.toString());
          circle.setAttribute('cy', anchor.y.toString());
          circle.setAttribute('r', '1');
          circle.setAttribute('fill', '#f59e0b');
          circle.setAttribute('opacity', '0.5');
          dom.snapLayer.appendChild(circle);
        }
      }
      return;
    }

    if (isDraggingRoomLabel && dragRoomLabel) {
      const dx = world.x - dragStartWorld.x;
      const dy = world.y - dragStartWorld.y;
      dragRoomLabel.x = snapToGrid(dragRoomLabelStart.x + dx);
      dragRoomLabel.y = snapToGrid(dragRoomLabelStart.y + dy);
      renderAll();
      return;
    }

    if (isMovingVertex && state.selected) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (obj) {
        moveVertex(obj, movingVertexIndex, snapToGrid(world.x), snapToGrid(world.y));
        renderAll();
      }
      return;
    }

    if (isDragging && state.selected) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (!obj) return;
      const dx = world.x - dragStartWorld.x;
      const dy = world.y - dragStartWorld.y;
      if (obj.points) {
        const snappedDx = snapToGrid(dx);
        const snappedDy = snapToGrid(dy);
        obj.points = dragObjStart.points.map((p: any) => ({
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

    if (isResizing && state.selected) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (!obj) return;
      obj.w = Math.max(1, snapToGrid(dragObjStart.w + (world.x - dragStartWorld.x)));
      obj.h = Math.max(1, snapToGrid(dragObjStart.h + (world.y - dragStartWorld.y)));
      renderAll();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isRotatingAroundVertex) {
      if (dom.snapLayer) dom.snapLayer.innerHTML = '';
      if (dom.container) dom.container.style.cursor = '';
    }
    if (isDraggingRoomLabel) {
      if (dom.container) dom.container.style.cursor = '';
    }
    isDragging = false;
    isResizing = false;
    isPanning = false;
    isMovingVertex = false;
    movingVertexIndex = -1;
    isRotatingAroundVertex = false;
    rotateAnchorIndex = -1;
    rotateOrigPoints = null;
    isDraggingRoomLabel = false;
    dragRoomLabelObj = null;
    dragRoomLabel = null;
    dragRoomLabelStart = null;
    if (dom.container) dom.container.classList.remove('panning');
  });
}

function handleDrawClick(world: any): void {
  let snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
  snapped = applyDrawConstraint(snapped);

  if (state.drawPoints.length >= 3) {
    const first = state.drawPoints[0];
    const dist = Math.sqrt((snapped.x - first.x) ** 2 + (snapped.y - first.y) ** 2);
    if (dist < 2) {
      finishPolygon();
      return;
    }
  }

  state.drawPoints.push(snapped);
  state.drawDistance = null;
  hideDistanceInput();
  updateDrawStatus();
  renderDrawPreview(snapped);
}

function handleConnectClick(clicked: any): void {
  if (!state.connectFrom) {
    state.connectFrom = clicked.id;
    selectObject(clicked.id);
  } else if (state.connectFrom !== clicked.id) {
    pushUndo();
    const exists = state.connections.some((c: any) =>
      (c.from === state.connectFrom && c.to === clicked.id) ||
      (c.from === clicked.id && c.to === state.connectFrom)
    );
    if (!exists) {
      state.connections.push({ from: state.connectFrom, to: clicked.id });
    }
    state.connectFrom = null;
    state.connectMode = false;
    const btn = document.getElementById('connect-mode-btn');
    if (btn) btn.classList.remove('active-connect');
    selectObject(clicked.id);
  }
}

// ============================
// ZOOM
// ============================

export function initZoom(): void {
  if (!dom.container) return;
  dom.container.addEventListener('wheel', (e: any) => {
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
  const cx = dom.container!.clientWidth / 2;
  const cy = dom.container!.clientHeight / 2;
  const newZoom = Math.min(5, state.zoom * 1.3);
  state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
  state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
  state.zoom = newZoom;
  updateTransform();
}

export function zoomOut(): void {
  const cx = dom.container!.clientWidth / 2;
  const cy = dom.container!.clientHeight / 2;
  const newZoom = Math.max(0.1, state.zoom * 0.7);
  state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
  state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
  state.zoom = newZoom;
  updateTransform();
}

export function zoomFit(): void {
  if (state.objects.length === 0) {
    state.zoom = 1; state.panX = 50; state.panY = 50;
    updateTransform();
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.objects.forEach(o => {
    if (o.points) {
      o.points.forEach(p => {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      });
    } else {
      minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + o.w); maxY = Math.max(maxY, o.y + o.h);
    }
  });
  const ww = maxX - minX + 10;
  const wh = maxY - minY + 10;
  const cw = dom.container!.clientWidth;
  const ch = dom.container!.clientHeight;
  state.zoom = Math.min(cw / (ww * state.pxPerMeter), ch / (wh * state.pxPerMeter)) * 0.9;
  state.zoom = Math.max(0.1, Math.min(5, state.zoom));
  state.panX = (cw - ww * state.zoom * state.pxPerMeter) / 2 - minX * state.zoom * state.pxPerMeter + 5 * state.zoom * state.pxPerMeter;
  state.panY = (ch - wh * state.zoom * state.pxPerMeter) / 2 - minY * state.zoom * state.pxPerMeter + 5 * state.zoom * state.pxPerMeter;
  updateTransform();
}

// ============================
// GRID & SNAP & CONNECT
// ============================

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
  state.connectFrom = null;
  if (state.drawMode) cancelDrawMode();
  const btn = document.getElementById('connect-mode-btn');
  if (btn) {
    btn.classList.toggle('active-connect', state.connectMode);
    btn.style.borderColor = state.connectMode ? 'var(--accent2)' : '';
  }
  if (dom.container) dom.container.style.cursor = state.connectMode ? 'crosshair' : '';
}

// ============================
// KEYBOARD
// ============================

export function initKeyboard(): void {
  window.addEventListener('keydown', (e: any) => {
    if (e.key === 'z' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.key === 'y' && e.ctrlKey) || (e.key === 'z' && e.ctrlKey && e.shiftKey)) {
      e.preventDefault();
      redo();
      return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.key === 'Escape') {
      const saveDialog = document.getElementById('save-dialog');
      if (saveDialog && saveDialog.style.display !== 'none') {
        closeSaveDialog();
        return;
      }
      if (state.gatePlaceMode) { cancelGatePlacement(); }
      else if (state.roomLabelPlaceMode) { cancelRoomLabelPlacement(); }
      else if (state.wallDrawMode) { cancelWallDrawMode(); }
      else if (state.entrancePlaceMode) { cancelEntrancePlacement(); }
      else if (state.drawMode) { cancelDrawMode(); }
      else if (state.connectMode) { toggleConnectMode(); }
      else { deselectAll(); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.drawMode && state.drawPoints.length > 0) {
        state.drawPoints.pop();
        updateDrawStatus();
        renderDrawPreview(null);
      } else if (state.selected) {
        const selObj = state.objects.find(o => o.id === state.selected);
        if (selObj && !selObj.locked) deleteObject(state.selected);
      }
    }
    if (e.key === 'Enter' && state.drawMode && state.drawPoints.length >= 3) {
      finishPolygon();
    }
    if (state.drawMode && state.drawPoints.length > 0) {
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        toggleDrawConstraint('h');
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        toggleDrawConstraint('v');
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey) {
        e.preventDefault();
        showDistanceInput();
        return;
      }
    }
    if (e.key === 'd' && e.ctrlKey) {
      e.preventDefault();
      if (state.selected) duplicateObject(state.selected);
    }
    if (e.key === 's' && e.ctrlKey) {
      e.preventDefault();
      saveProject();
    }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && state.selected) {
      const obj = state.objects.find(o => o.id === state.selected);
      if (obj && obj.points) {
        e.preventDefault();
        const center = typeof getRotateCenter === 'function' ? getRotateCenter() : -1;
        rotatePolygon(state.selected, e.shiftKey ? -90 : 90, center);
        return;
      }
    }
    if (e.key === 'g') toggleGrid();
  });
}

// ============================
// RESIZE SVG
// ============================

export function resizeSVG(): void {
  if (dom.svg && dom.container) {
    dom.svg.setAttribute('width', dom.container.clientWidth.toString());
    dom.svg.setAttribute('height', dom.container.clientHeight.toString());
    updateTransform();
  }
}
