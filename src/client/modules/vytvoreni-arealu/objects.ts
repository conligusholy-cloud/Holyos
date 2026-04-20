/* ============================================
   objects.ts — CRUD operace s objekty
   ============================================ */

import type { DrawingObject, Point, ObjectType, EntranceType } from '../../../shared/types.js';
import { state } from './state.js';
import { COLORS, DEFAULT_SIZES, ENTRANCE_TYPES } from './config.js';
import { pushUndo, getStateSnapshot } from './history.js';
import { renderAll } from './renderer.js';
import { snapToGrid, getPolygonBBox, getPolygonArea, getPolygonCentroid, isPointInPolygon } from './renderer.js';
import { showProperties, deselectAll } from './properties.js';

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

export function createPolygonObject(type: ObjectType | null, points: Point[]): DrawingObject | null {
  if (!type || points.length < 3) return null;
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
  // Najdi všechny objekty, které bod obsahují; vrať ten s nejmenší plochou
  // (řeší vnořené polygony — hala uvnitř areálu, místnost uvnitř haly atd.)
  const hits: { obj: DrawingObject; area: number }[] = [];
  for (const o of state.objects) {
    if (o.points && o.points.length >= 3) {
      if (isPointInPolygon(wx, wy, o.points)) {
        // Spočítej plochu polygonu (shoelace formula)
        let a = 0;
        for (let i = 0; i < o.points.length; i++) {
          const j = (i + 1) % o.points.length;
          a += o.points[i].x * o.points[j].y - o.points[j].x * o.points[i].y;
        }
        hits.push({ obj: o, area: Math.abs(a / 2) });
      }
    } else if (o.x !== undefined && o.w !== undefined) {
      if (wx >= o.x && wx <= o.x + o.w && wy >= o.y && wy <= o.y + o.h) {
        hits.push({ obj: o, area: o.w * o.h });
      }
    }
  }
  if (hits.length === 0) return null;
  // Vrať ten s nejmenší plochou (nejvíce vnořený)
  hits.sort((a, b) => a.area - b.area);
  return hits[0].obj;
}

// ---- Výběr ----

export function selectObject(id: number): void {
  state.selected = id;
  renderAll();
  showProperties(id);
}

// ---- Úprava vlastností ----

export function updateProp(key: string, value: unknown): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) return;
  (obj as unknown as Record<string, unknown>)[key] = value;
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

export function addEntrance(objId: number, edgeIndex: number, t1: number, t2: number, type: EntranceType, wallId?: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.points) return;
  if (!obj.entrances) obj.entrances = [];

  // Zajistit t1 < t2
  if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }

  // Spočítej délku hrany — buď obvod polygonu nebo vnitřní stěna
  let edgeLen: number;
  if (wallId != null && obj.walls) {
    const wall = obj.walls.find(w => w.id === wallId);
    if (!wall) return;
    edgeLen = Math.sqrt((wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2);
  } else {
    const pts = obj.points;
    const j = (edgeIndex + 1) % pts.length;
    const p1 = pts[edgeIndex], p2 = pts[j];
    edgeLen = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }
  const width = (t2 - t1) * edgeLen;

  const eType = ENTRANCE_TYPES[type] || ENTRANCE_TYPES.vjezd;
  obj.entrances.push({
    id: state.nextId++,
    edgeIndex: wallId != null ? -1 : edgeIndex,
    ...(wallId != null ? { wallId } : {}),
    t1: Math.max(0.01, t1),
    t2: Math.min(0.99, t2),
    type: type,
    name: eType.label + ' ' + (obj.entrances.length + 1),
    width: Math.round(width * 10) / 10,
  });

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

export function updateEntranceProp(objId: number, entranceId: number, key: string, value: unknown): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.entrances) return;
  const ent = obj.entrances.find(e => e.id === entranceId);
  if (!ent) return;
  (ent as unknown as Record<string, unknown>)[key] = value;
  renderAll();
  showProperties(objId);
}

export function updateEntranceWidth(objId: number, entranceId: number, newWidthMeters: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.entrances) return;
  const ent = obj.entrances.find(e => e.id === entranceId);
  if (!ent) return;

  // Délka hrany — pro entrance na stěně i na obvodu
  let edgeLen = 0;
  if ((ent as any).wallId != null && obj.walls) {
    const wall = obj.walls.find(w => w.id === (ent as any).wallId);
    if (wall) edgeLen = Math.sqrt((wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2);
  } else if (obj.points && ent.edgeIndex >= 0 && ent.edgeIndex < obj.points.length) {
    const ei = ent.edgeIndex;
    const ej = (ei + 1) % obj.points.length;
    const ep1 = obj.points[ei], ep2 = obj.points[ej];
    edgeLen = Math.sqrt((ep2.x - ep1.x) ** 2 + (ep2.y - ep1.y) ** 2);
  }
  if (edgeLen < 0.01) return;

  // Střed vjezdu zůstane na místě, změní se šířka
  const t1 = ent.t1 != null ? ent.t1 : (ent.t2 != null ? ent.t2 - 0.04 : 0.4);
  const t2 = ent.t2 != null ? ent.t2 : (ent.t1 != null ? ent.t1 + 0.04 : 0.6);
  const center = (t1 + t2) / 2;
  const halfWidthT = (newWidthMeters / edgeLen) / 2;

  // Omezit na hranice hrany
  ent.t1 = Math.max(0.01, center - halfWidthT);
  ent.t2 = Math.min(0.99, center + halfWidthT);

  renderAll();
  showProperties(objId);
}

// Najít nejbližší hranu areálu k danému bodu.
// Hledá v obvodu (polygon hala/areál) i ve vnitřních stěnách hal.
interface NearestEdgeResult {
  objId: number;
  edgeIndex: number;    // -1 pokud je to vnitřní stěna (použij wallId)
  wallId?: number;
  t: number;
  dist: number;
  px: number;
  py: number;
}

export function findNearestArealEdge(wx: number, wy: number): NearestEdgeResult | null {
  let best: NearestEdgeResult | null = null;
  let bestDist = Infinity;

  for (const obj of state.objects) {
    if ((obj.type !== 'areal' && obj.type !== 'hala') || !obj.points) continue;

    // 1) Hrany obvodu polygonu
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

    // 2) Vnitřní stěny haly (místnosti)
    if (obj.type === 'hala' && obj.walls) {
      for (const wall of obj.walls) {
        const dx = wall.x2 - wall.x1;
        const dy = wall.y2 - wall.y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 0.001) continue;

        let t = ((wx - wall.x1) * dx + (wy - wall.y1) * dy) / lenSq;
        t = Math.max(0.02, Math.min(0.98, t));

        const px = wall.x1 + t * dx;
        const py = wall.y1 + t * dy;
        const dist = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);

        if (dist < bestDist) {
          bestDist = dist;
          best = { objId: obj.id, edgeIndex: -1, wallId: wall.id, t, dist, px, py };
        }
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

  obj.walls.push({
    id: state.nextId++,
    x1: snapToGrid(x1),
    y1: snapToGrid(y1),
    x2: snapToGrid(x2),
    y2: snapToGrid(y2),
    name: 'Stěna ' + (obj.walls.length + 1),
    gates: [],
  });

  renderAll();
  showProperties(objId);
}

export function removeWall(objId: number, wallId: number): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  if (wall.locked) return; // zamčenou nemazat
  pushUndo();
  obj.walls = obj.walls.filter(w => w.id !== wallId);
  renderAll();
  showProperties(objId);
}

// ============================================
// Editace stěn — úprava parametrů
// ============================================

export function updateWallName(objId: number, wallId: number, name: string): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  if (wall.locked) return;
  pushUndo();
  wall.name = name;
  renderAll();
}

// Aktualizuj souřadnici počátečního/koncového bodu stěny
export function updateWallPoint(objId: number, wallId: number, which: 'start' | 'end', axis: 'x' | 'y', value: number): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  if (wall.locked) return;
  pushUndo();
  const key = (which === 'start' ? (axis === 'x' ? 'x1' : 'y1') : (axis === 'x' ? 'x2' : 'y2')) as 'x1' | 'y1' | 'x2' | 'y2';
  wall[key] = value;
  renderAll();
  showProperties(objId);
}

// Nastav délku stěny — posune koncový bod podél směrového vektoru
export function updateWallLength(objId: number, wallId: number, newLength: number): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall || newLength <= 0) return;
  if (wall.locked) return;
  pushUndo();
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const curLen = Math.sqrt(dx * dx + dy * dy);
  if (curLen < 0.001) {
    // Pokud je stěna zdegenerovaná, vytvoř ji vodorovně na východ
    wall.x2 = wall.x1 + newLength;
    wall.y2 = wall.y1;
  } else {
    const ux = dx / curLen;
    const uy = dy / curLen;
    wall.x2 = wall.x1 + ux * newLength;
    wall.y2 = wall.y1 + uy * newLength;
  }
  renderAll();
  showProperties(objId);
}

// Nastav úhel stěny vůči ose +X ve stupních (0° = doprava, 90° = dolů ve world souřadnicích)
// Otáčí kolem počátečního bodu a zachová délku
export function updateWallAngle(objId: number, wallId: number, angleDeg: number): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  if (wall.locked) return;
  pushUndo();
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const rad = (angleDeg * Math.PI) / 180;
  wall.x2 = wall.x1 + Math.cos(rad) * length;
  wall.y2 = wall.y1 + Math.sin(rad) * length;
  renderAll();
  showProperties(objId);
}

// Najdi nejbližší hranu haly k danému bodu a vrať informace o ní
interface HallEdgeInfo {
  edgeIndex: number;
  x: number; y: number;              // projekční bod
  edgeStart: { x: number; y: number };
  edgeEnd: { x: number; y: number };
  edgeLen: number;
  distFromStart: number;              // vzdálenost od začátku hrany
  perpAngleDeg: number;               // úhel kolmice do vnitřku (doplňkový výpočet si dělá volající)
}

function findNearestHallEdge(obj: DrawingObject, wx: number, wy: number): HallEdgeInfo | null {
  if (!obj.points || obj.points.length < 3) return null;
  let best: HallEdgeInfo | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < obj.points.length; i++) {
    const p1 = obj.points[i];
    const p2 = obj.points[(i + 1) % obj.points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.001) continue;
    const edgeLen = Math.sqrt(lenSq);
    let t = ((wx - p1.x) * dx + (wy - p1.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = p1.x + t * dx;
    const py = p1.y + t * dy;
    const d = Math.sqrt((wx - px) ** 2 + (wy - py) ** 2);
    if (d < bestDist) {
      bestDist = d;
      const perpAngleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI; // kolmice vlevo od směru hrany
      best = {
        edgeIndex: i,
        x: px, y: py,
        edgeStart: { x: p1.x, y: p1.y },
        edgeEnd: { x: p2.x, y: p2.y },
        edgeLen,
        distFromStart: t * edgeLen,
        perpAngleDeg,
      };
    }
  }
  return best;
}

// Otoč stěnu tak, aby byla kolmá na nejbližší hranu haly (vůči počátečnímu bodu stěny)
export function snapWallPerpendicular(objId: number, wallId: number): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  if (wall.locked) return;
  const edge = findNearestHallEdge(obj, wall.x1, wall.y1);
  if (!edge) return;
  pushUndo();
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  // směr hrany
  const ex = edge.edgeEnd.x - edge.edgeStart.x;
  const ey = edge.edgeEnd.y - edge.edgeStart.y;
  const eLen = Math.sqrt(ex * ex + ey * ey) || 1;
  // kolmice (otočená o 90° od směru hrany) — dovnitř haly
  // Pro správné určení "dovnitř" otestuj oba směry a vyber ten, kde je (x1+n) uvnitř polygonu
  let nx = -ey / eLen;
  let ny = ex / eLen;
  // Test uvnitř
  const testX = wall.x1 + nx * 0.1;
  const testY = wall.y1 + ny * 0.1;
  if (!pointInPolygon(testX, testY, obj.points!)) {
    nx = -nx; ny = -ny;
  }
  wall.x2 = wall.x1 + nx * length;
  wall.y2 = wall.y1 + ny * length;
  renderAll();
  showProperties(objId);
}

// Najdi všechny stěny spojené s danou stěnou přes sdílené koncové body
// (BFS tranzitivně — celá propojená skupina = místnost)
function findConnectedWalls(walls: any[], startWallId: number, eps: number = 0.15): any[] {
  const startWall = walls.find(w => w.id === startWallId);
  if (!startWall) return [];
  const connected = new Map<number, any>();
  connected.set(startWall.id, startWall);
  const queue: any[] = [startWall];
  while (queue.length > 0) {
    const w = queue.shift()!;
    const endpoints = [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
    for (const other of walls) {
      if (connected.has(other.id)) continue;
      const oEndpoints = [{ x: other.x1, y: other.y1 }, { x: other.x2, y: other.y2 }];
      let shares = false;
      for (const a of endpoints) {
        for (const b of oEndpoints) {
          if (Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps) { shares = true; break; }
        }
        if (shares) break;
      }
      if (shares) { connected.set(other.id, other); queue.push(other); }
    }
  }
  return Array.from(connected.values());
}

// Posuň stěnu (a všechny s ní spojené) po nejbližší hraně haly o zadanou vzdálenost od rohu.
// Všechny propojené stěny se posunou stejným vektorem — celá místnost zůstane konzistentní.
export function updateWallDistFromCorner(objId: number, wallId: number, distFromStart: number): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  if (wall.locked) return;
  // Pokud je jakákoli ze spojených stěn zamčená, neposouvej
  const group = findConnectedWalls(obj.walls, wallId);
  if (group.some((w: any) => w.locked)) return;
  const edge = findNearestHallEdge(obj, wall.x1, wall.y1);
  if (!edge) return;
  pushUndo();
  const clamped = Math.max(0, Math.min(edge.edgeLen, distFromStart));
  const dx = edge.edgeEnd.x - edge.edgeStart.x;
  const dy = edge.edgeEnd.y - edge.edgeStart.y;
  const eLen = Math.sqrt(dx * dx + dy * dy) || 1;
  const newStartX = edge.edgeStart.x + (dx / eLen) * clamped;
  const newStartY = edge.edgeStart.y + (dy / eLen) * clamped;
  const offsetX = newStartX - wall.x1;
  const offsetY = newStartY - wall.y1;
  // Posuň všechny stěny spojené s touto (celá místnost)
  for (const w of group) {
    w.x1 += offsetX; w.y1 += offsetY;
    w.x2 += offsetX; w.y2 += offsetY;
  }
  renderAll();
  showProperties(objId);
}

// Přepne stav zámku pro celou propojenou místnost (skupinu stěn).
// Pokud je některá ze skupiny zamčená, všechny odemkne. Jinak všechny zamkne.
export function toggleRoomLocked(objId: number, wallId: number): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;
  const group = findConnectedWalls(obj.walls, wallId);
  pushUndo();
  const anyLocked = group.some((w: any) => w.locked);
  for (const w of group) {
    w.locked = !anyLocked;
  }
  renderAll();
  showProperties(objId);
}

// Point-in-polygon test (ray casting)
function pointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function addGate(objId: number, wallId: number, t: number, width: number): void {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;

  wall.gates.push({
    id: state.nextId++,
    t: Math.max(0.05, Math.min(0.95, t)),
    width: width || 3,
    name: 'Vrata ' + (wall.gates.length + 1),
  });

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
interface NearestWallResult {
  wallId: number;
  t: number;
  dist: number;
  px: number;
  py: number;
}

export function findNearestWall(obj: DrawingObject, wx: number, wy: number): NearestWallResult | null {
  if (!obj || !obj.walls) return null;
  let best: NearestWallResult | null = null;
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
interface ProjectedResult {
  wallId: number;
  t: number;
  dist: number;
  px: number;
  py: number;
}

export function projectOntoWall(obj: DrawingObject, wallId: number, wx: number, wy: number): ProjectedResult | null {
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
  obj.rooms.push({
    id: state.nextId++,
    name: 'Místnost ' + num,
    x: snapToGrid(x),
    y: snapToGrid(y),
  });
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

export function updateRoomLabelProp(objId: number, roomId: number, prop: string, value: unknown): void {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.rooms) return;
  const room = obj.rooms.find(r => r.id === roomId);
  if (!room) return;
  (room as unknown as Record<string, unknown>)[prop] = value;
  renderAll();
}
