/* ============================================
   objects.ts — CRUD operace s objekty
   ============================================ */

import type { DrawingObject, Point, ObjectType, EntranceType, Wall, Gate, RoomLabel, Entrance } from '../../../shared/types.js';
import { state } from './state.js';
import { COLORS, DEFAULT_SIZES, ENTRANCE_TYPES } from './config.js';
import { pushUndo } from './history.js';
import { renderAll, snapToGrid, getPolygonBBox, getPolygonCentroid, getPolygonArea, getPolygonSignedArea } from './renderer.js';
import { showProperties } from './properties.js';
import { isPointInPolygon } from './interactions.js';

// ---- Vytvoření obdélníkového objektu (drag & drop) ----

export function createObject(type: ObjectType, x: number, y: number): DrawingObject {
  pushUndo();
  const sz = DEFAULT_SIZES[type] || { w: 10, h: 8 };
  const color = COLORS[type] || COLORS.hala;
  const obj: DrawingObject = {
    id: state.nextId++,
    type: type,
    name: color.label + ' ' + state.nextId,
    x: snapToGrid(x),
    y: snapToGrid(y),
    w: sz.w,
    h: sz.h,
    points: undefined,
    color: color.stroke,
    fillColor: color.fill,
    rotation: 0,
  };
  state.objects.push(obj);
  selectObject(obj.id);
  renderAll();
  return obj;
}

// ---- Vytvoření polygonového objektu ----

export function createPolygonObject(type: ObjectType, points: Point[]): DrawingObject | null {
  if (points.length < 3) return null;
  pushUndo();
  const color = COLORS[type] || COLORS.hala;
  const bbox = getPolygonBBox(points);
  const obj: DrawingObject = {
    id: state.nextId++,
    type: type,
    name: color.label + ' ' + state.nextId,
    x: bbox.minX,
    y: bbox.minY,
    w: bbox.maxX - bbox.minX,
    h: bbox.maxY - bbox.minY,
    points: points.map(p => ({ x: p.x, y: p.y })),
    color: color.stroke,
    fillColor: color.fill,
    rotation: 0,
  };
  state.objects.push(obj);
  selectObject(obj.id);
  renderAll();
  return obj;
}

// ---- Mazání ----

export function deleteObject(id: number): void {
  pushUndo();
  state.objects = state.objects.filter(o => o.id !== id);
  state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
  deselectAll();
  // Uvolnit pracoviště zpět do panelu
  if (typeof (window as any).markUsedWorkstations === 'function') {
    (window as any).markUsedWorkstations();
  }
}

// ---- Duplikování ----

export function duplicateObject(id: number): void {
  pushUndo();
  const src = state.objects.find(o => o.id === id);
  if (!src) return;
  const obj: DrawingObject = {
    ...src,
    id: state.nextId++,
    name: src.name + ' (kopie)',
  };
  if (src.points) {
    obj.points = src.points.map(p => ({ x: p.x + 3, y: p.y + 3 }));
    if (src.walls) obj.walls = JSON.parse(JSON.stringify(src.walls));
    if (src.entrances) obj.entrances = JSON.parse(JSON.stringify(src.entrances));
    const bbox = getPolygonBBox(obj.points);
    obj.x = bbox.minX;
    obj.y = bbox.minY;
    obj.w = bbox.maxX - bbox.minX;
    obj.h = bbox.maxY - bbox.minY;
  } else {
    obj.x = src.x + 2;
    obj.y = src.y + 2;
  }
  state.objects.push(obj);
  selectObject(obj.id);
}

// ---- Hledání objektu na pozici ----

export function findObjectAt(wx: number, wy: number): DrawingObject | null {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i];
    if (o.points && o.points.length >= 3) {
      if (isPointInPolygon(wx, wy, o.points)) return o;
    } else {
      // Pro rotované obdélníky: transformovat bod do lokálního souřadného systému
      let lx = wx, ly = wy;
      const rot = o.rotation || 0;
      if (rot) {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const rad = (-rot * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const dx = wx - cx, dy = wy - cy;
        lx = cx + dx * cos - dy * sin;
        ly = cy + dx * sin + dy * cos;
      }
      if (lx >= o.x && lx <= o.x + o.w && ly >= o.y && ly <= o.y + o.h) return o;
    }
  }
  return null;
}

// ---- Výběr ----

export function selectObject(id: number): void {
  state.selected = id;
  renderAll();
  showProperties(id);
}

export function deselectAll(): void {
  state.selected = null;
  renderAll();
  const propsPanel = document.getElementById('properties');
  if (propsPanel) {
    propsPanel.className = 'empty-state';
    propsPanel.innerHTML = '<p>Vyber objekt na plátně<br>nebo přetáhni z palety</p>';
  }
}

// ---- Úprava vlastností ----

export function updateProp(key: keyof DrawingObject, value: any): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) return;
  (obj as any)[key] = value;
  renderAll();
}

export function updateColor(color: string): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) return;
  obj.color = color;
  obj.fillColor = color + '26';
  renderAll();
  if (state.selected !== null) {
    showProperties(state.selected);
  }
}

// ---- Posun celého polygonu ----

export function movePolygon(obj: DrawingObject, dx: number, dy: number): void {
  if (!obj.points) return;
  obj.points.forEach(p => { p.x += dx; p.y += dy; });
  const bbox = getPolygonBBox(obj.points);
  obj.x = bbox.minX;
  obj.y = bbox.minY;
  obj.w = bbox.maxX - bbox.minX;
  obj.h = bbox.maxY - bbox.minY;
}

// ---- Posun jednoho vertexu ----

export function moveVertex(obj: DrawingObject, index: number, newX: number, newY: number): void {
  if (!obj.points || !obj.points[index]) return;
  obj.points[index].x = snapToGrid(newX);
  obj.points[index].y = snapToGrid(newY);
  const bbox = getPolygonBBox(obj.points);
  obj.x = bbox.minX;
  obj.y = bbox.minY;
  obj.w = bbox.maxX - bbox.minX;
  obj.h = bbox.maxY - bbox.minY;
}

// ---- Rotace obdélníku ----

export function rotateRect(objId: number, angleDeg: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;
  obj.rotation = ((obj.rotation || 0) + angleDeg) % 360;
  if (obj.rotation < 0) obj.rotation += 360;
  renderAll();
  showProperties(objId);
}

export function setRectRotation(objId: number, angle: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;
  obj.rotation = (angle % 360 + 360) % 360;
  renderAll();
  showProperties(objId);
}

// ---- Rotace polygonu kolem zvoleného středu ----

export function rotatePolygon(objId: number, angleDeg: number, centerIndex: number | null): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.points) return;

  let center: Point;
  if (centerIndex != null && centerIndex >= 0 && centerIndex < obj.points.length) {
    center = { x: obj.points[centerIndex].x, y: obj.points[centerIndex].y };
  } else {
    center = getPolygonCentroid(obj.points);
  }

  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  obj.points = obj.points.map(p => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
      x: snapToGrid(center.x + dx * cos - dy * sin),
      y: snapToGrid(center.y + dx * sin + dy * cos)
    };
  });

  const bbox = getPolygonBBox(obj.points);
  obj.x = bbox.minX;
  obj.y = bbox.minY;
  obj.w = bbox.maxX - bbox.minX;
  obj.h = bbox.maxY - bbox.minY;

  renderAll();
  showProperties(objId);
}

// ============================================
// Vjezdy/Výjezdy — dva body na hraně
// ============================================

export function addEntrance(objId: number, edgeIndex: number, t1: number, t2: number, type: EntranceType): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.points) return;
  if (!obj.entrances) obj.entrances = [];

  // Zajistit t1 < t2
  if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }

  const pts = obj.points;
  const j = (edgeIndex + 1) % pts.length;
  const p1 = pts[edgeIndex], p2 = pts[j];
  const edgeLen = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  const width = (t2 - t1) * edgeLen;

  const eType = ENTRANCE_TYPES[type] || ENTRANCE_TYPES.vjezd;
  const ent: Entrance = {
    id: state.nextId++,
    edgeIndex: edgeIndex,
    t1: Math.max(0.01, t1),
    t2: Math.min(0.99, t2),
    type: type,
    name: eType.label + ' ' + (obj.entrances.length + 1),
    width: Math.round(width * 10) / 10,
  };
  obj.entrances.push(ent);

  renderAll();
  showProperties(objId);
}

export function removeEntrance(objId: number, entranceId: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.entrances) return;
  obj.entrances = obj.entrances.filter(e => e.id !== entranceId);
  renderAll();
  showProperties(objId);
}

export function updateEntranceProp(objId: number, entranceId: number, key: keyof Entrance, value: any): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.entrances) return;
  const ent = obj.entrances.find(e => e.id === entranceId);
  if (!ent) return;
  (ent as any)[key] = value;
  renderAll();
  showProperties(objId);
}

export function updateEntranceWidth(objId: number, entranceId: number, newWidthMeters: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.entrances || !obj.points) return;
  const ent = obj.entrances.find(e => e.id === entranceId);
  if (!ent) return;

  const ei = ent.edgeIndex;
  const ej = (ei + 1) % obj.points.length;
  const ep1 = obj.points[ei], ep2 = obj.points[ej];
  const edgeLen = Math.sqrt((ep2.x - ep1.x) ** 2 + (ep2.y - ep1.y) ** 2);
  if (edgeLen < 0.01) return;

  const t1 = ent.t1 != null ? ent.t1 : 0.4;
  const t2 = ent.t2 != null ? ent.t2 : 0.6;
  const center = (t1 + t2) / 2;
  const halfWidthT = (newWidthMeters / edgeLen) / 2;

  ent.t1 = Math.max(0.01, center - halfWidthT);
  ent.t2 = Math.min(0.99, center + halfWidthT);

  renderAll();
  showProperties(objId);
}

// Najít nejbližší hranu areálu k danému bodu
export interface EdgeHit {
  objId: number;
  edgeIndex: number;
  t: number;
  dist: number;
  px: number;
  py: number;
}

export function findNearestArealEdge(wx: number, wy: number): EdgeHit | null {
  let best: EdgeHit | null = null;
  let bestDist = Infinity;

  for (const obj of state.objects) {
    if ((obj.type !== 'areal' && obj.type !== 'hala') || !obj.points) continue;

    for (let i = 0; i < obj.points.length; i++) {
      const j = (i + 1) % obj.points.length;
      const p1 = obj.points[i];
      const p2 = obj.points[j];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 0.001) continue;

      let t = ((wx - p1.x) * dx + (wy - p1.y) * dy) / lenSq;
      t = Math.max(0.02, Math.min(0.98, t));

      const px = p1.x + t * dx;
      const py = p1.y + t * dy;
      const dist = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);

      if (dist < bestDist) {
        bestDist = dist;
        best = { objId: obj.id, edgeIndex: i, t: t, dist: dist, px: px, py: py };
      }
    }
  }

  return bestDist < 5 ? best : null;
}

// ============================================
// Stěny a vrata uvnitř hal
// ============================================

export function addWall(objId: number, x1: number, y1: number, x2: number, y2: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;
  if (!obj.walls) obj.walls = [];

  const wall: Wall = {
    id: state.nextId++,
    x1: snapToGrid(x1),
    y1: snapToGrid(y1),
    x2: snapToGrid(x2),
    y2: snapToGrid(y2),
    name: 'Stěna ' + (obj.walls.length + 1),
    gates: [],
  };
  obj.walls.push(wall);

  renderAll();
  showProperties(objId);
}

export function removeWall(objId: number, wallId: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  obj.walls = obj.walls.filter(w => w.id !== wallId);
  renderAll();
  showProperties(objId);
}

export function addGate(objId: number, wallId: number, t: number, width?: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;

  const gate: Gate = {
    id: state.nextId++,
    t: Math.max(0.05, Math.min(0.95, t)),
    width: width || 3,
    name: 'Vrata ' + (wall.gates.length + 1),
  };
  wall.gates.push(gate);

  renderAll();
  showProperties(objId);
}

export function removeGate(objId: number, wallId: number, gateId: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  wall.gates = wall.gates.filter(g => g.id !== gateId);
  renderAll();
  showProperties(objId);
}

// Najít nejbližší stěnu objektu
export interface WallHit {
  wallId: number;
  t: number;
  dist: number;
  px: number;
  py: number;
}

export function findNearestWall(obj: DrawingObject, wx: number, wy: number): WallHit | null {
  if (!obj || !obj.walls) return null;
  let best: WallHit | null = null;
  let bestDist = Infinity;

  for (const wall of obj.walls) {
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.001) continue;

    let t = ((wx - wall.x1) * dx + (wy - wall.y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const px = wall.x1 + t * dx;
    const py = wall.y1 + t * dy;
    const dist = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);

    if (dist < bestDist) {
      bestDist = dist;
      best = { wallId: wall.id, t: t, dist: dist, px: px, py: py };
    }
  }

  return bestDist < 5 ? best : null;
}

// Promítnout bod na konkrétní stěnu (pro umístění vrat)
export interface WallProjection {
  wallId: number;
  t: number;
  dist: number;
  px: number;
  py: number;
}

export function projectOntoWall(obj: DrawingObject, wallId: number, wx: number, wy: number): WallProjection | null {
  if (!obj || !obj.walls) return null;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return null;

  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.001) return null;

  let t = ((wx - wall.x1) * dx + (wy - wall.y1) * dy) / lenSq;
  t = Math.max(0.05, Math.min(0.95, t));

  const px = wall.x1 + t * dx;
  const py = wall.y1 + t * dy;
  const dist = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);

  return { wallId: wall.id, t: t, dist: dist, px: px, py: py };
}

// ============================
// MÍSTNOSTI (room labels)
// ============================

export function addRoomLabel(objId: number, x: number, y: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;
  if (!obj.rooms) obj.rooms = [];
  const num = obj.rooms.length + 1;
  const room: RoomLabel = {
    id: state.nextId++,
    name: 'Místnost ' + num,
    x: snapToGrid(x),
    y: snapToGrid(y),
  };
  obj.rooms.push(room);
  renderAll();
  showProperties(objId);
}

export function removeRoomLabel(objId: number, roomId: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.rooms) return;
  obj.rooms = obj.rooms.filter(r => r.id !== roomId);
  renderAll();
  showProperties(objId);
}

export function updateRoomLabelProp(objId: number, roomId: number, prop: keyof RoomLabel, value: any): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.rooms) return;
  const room = obj.rooms.find(r => r.id === roomId);
  if (!room) return;
  (room as any)[prop] = value;
  renderAll();
}
