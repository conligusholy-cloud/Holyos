/* ============================================
   objects.js — CRUD operace s objekty
   ============================================ */

// ---- Vytvoření obdélníkového objektu (drag & drop) ----

function createObject(type, x, y) {
  pushUndo();
  const sz = DEFAULT_SIZES[type] || { w: 10, h: 8 };
  const color = COLORS[type] || COLORS.hala;
  const obj = {
    id: state.nextId++,
    type: type,
    name: color.label + ' ' + state.nextId,
    x: snapToGrid(x),
    y: snapToGrid(y),
    w: sz.w,
    h: sz.h,
    points: null,
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

function createPolygonObject(type, points) {
  if (points.length < 3) return null;
  pushUndo();
  const color = COLORS[type] || COLORS.hala;
  const bbox = getPolygonBBox(points);
  const obj = {
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

function deleteObject(id) {
  pushUndo();
  state.objects = state.objects.filter(o => o.id !== id);
  state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
  deselectAll();
}

// ---- Duplikování ----

function duplicateObject(id) {
  pushUndo();
  const src = state.objects.find(o => o.id === id);
  if (!src) return;
  const obj = {
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

function findObjectAt(wx, wy) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i];
    if (o.points && o.points.length >= 3) {
      if (isPointInPolygon(wx, wy, o.points)) return o;
    } else {
      if (wx >= o.x && wx <= o.x + o.w && wy >= o.y && wy <= o.y + o.h) return o;
    }
  }
  return null;
}

// ---- Výběr ----

function selectObject(id) {
  state.selected = id;
  renderAll();
  showProperties(id);
}

function deselectAll() {
  state.selected = null;
  renderAll();
  dom.propsPanel.className = 'empty-state';
  dom.propsPanel.innerHTML = '<p>Vyber objekt na plátně<br>nebo přetáhni z palety</p>';
}

// ---- Úprava vlastností ----

function updateProp(key, value) {
  pushUndo();
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) return;
  obj[key] = value;
  renderAll();
}

function updateColor(color) {
  pushUndo();
  const obj = state.objects.find(o => o.id === state.selected);
  if (!obj) return;
  obj.color = color;
  obj.fillColor = color + '26';
  renderAll();
  showProperties(obj.id);
}

// ---- Posun celého polygonu ----

function movePolygon(obj, dx, dy) {
  if (!obj.points) return;
  obj.points.forEach(p => { p.x += dx; p.y += dy; });
  const bbox = getPolygonBBox(obj.points);
  obj.x = bbox.minX;
  obj.y = bbox.minY;
  obj.w = bbox.maxX - bbox.minX;
  obj.h = bbox.maxY - bbox.minY;
}

// ---- Posun jednoho vertexu ----

function moveVertex(obj, index, newX, newY) {
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

function rotatePolygon(objId, angleDeg, centerIndex) {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.points) return;

  let center;
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

function addEntrance(objId, edgeIndex, t1, t2, type) {
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
  obj.entrances.push({
    id: state.nextId++,
    edgeIndex: edgeIndex,
    t1: Math.max(0.01, t1),
    t2: Math.min(0.99, t2),
    type: type,
    name: eType.label + ' ' + (obj.entrances.length + 1),
    width: Math.round(width * 10) / 10,
  });

  renderAll();
  showProperties(objId);
}

function removeEntrance(objId, entranceId) {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.entrances) return;
  obj.entrances = obj.entrances.filter(e => e.id !== entranceId);
  renderAll();
  showProperties(objId);
}

function updateEntranceProp(objId, entranceId, key, value) {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.entrances) return;
  const ent = obj.entrances.find(e => e.id === entranceId);
  if (!ent) return;
  ent[key] = value;
  renderAll();
  showProperties(objId);
}

function updateEntranceWidth(objId, entranceId, newWidthMeters) {
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

  // Střed vjezdu zůstane na místě, změní se šířka
  const t1 = ent.t1 != null ? ent.t1 : (ent.t ? ent.t - 0.02 : 0.4);
  const t2 = ent.t2 != null ? ent.t2 : (ent.t ? ent.t + 0.02 : 0.6);
  const center = (t1 + t2) / 2;
  const halfWidthT = (newWidthMeters / edgeLen) / 2;

  // Omezit na hranice hrany
  ent.t1 = Math.max(0.01, center - halfWidthT);
  ent.t2 = Math.min(0.99, center + halfWidthT);

  renderAll();
  showProperties(objId);
}

// Najít nejbližší hranu areálu k danému bodu
function findNearestArealEdge(wx, wy) {
  let best = null;
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

function addWall(objId, x1, y1, x2, y2) {
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

function removeWall(objId, wallId) {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.walls) return;
  obj.walls = obj.walls.filter(w => w.id !== wallId);
  renderAll();
  showProperties(objId);
}

function addGate(objId, wallId, t, width) {
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

function removeGate(objId, wallId, gateId) {
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
function findNearestWall(obj, wx, wy) {
  if (!obj || !obj.walls) return null;
  let best = null;
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
function projectOntoWall(obj, wallId, wx, wy) {
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

function addRoomLabel(objId, x, y) {
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

function removeRoomLabel(objId, roomId) {
  pushUndo();
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.rooms) return;
  obj.rooms = obj.rooms.filter(r => r.id !== roomId);
  renderAll();
  showProperties(objId);
}

function updateRoomLabelProp(objId, roomId, prop, value) {
  const obj = state.objects.find(o => o.id === objId);
  if (!obj || !obj.rooms) return;
  const room = obj.rooms.find(r => r.id === roomId);
  if (!room) return;
  room[prop] = value;
  renderAll();
}
