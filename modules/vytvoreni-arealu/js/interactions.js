/* ============================================
   interactions.js — Drag, pan, zoom, klávesy
   ============================================ */

let isDragging = false, isResizing = false, isPanning = false;
let isMovingVertex = false, movingVertexIndex = -1;
let isRotatingAroundVertex = false, rotateAnchorIndex = -1;
let rotateStartAngle = 0, rotateOrigPoints = null;
let dragStartWorld = null, dragObjStart = null;
let dragType = null;
let entrancePlaceObjId = null;
let dragUndoPushed = false; // prevent multiple undo pushes per drag
let isDraggingRoomLabel = false, dragRoomLabelObj = null, dragRoomLabel = null, dragRoomLabelStart = null;

// ============================
// DRAW MODE (kreslení polygonů)
// ============================

function startDrawMode(type) {
  cancelAllModes();
  state.drawMode = true;
  state.drawType = type;
  state.drawPoints = [];
  state.drawConstraint = null;
  state.drawDistance = null;
  dom.container.style.cursor = 'crosshair';
  updateDrawStatus();
  dom.container.classList.add('drawing');
}

function cancelDrawMode() {
  state.drawMode = false;
  state.drawType = null;
  state.drawPoints = [];
  state.drawConstraint = null;
  state.drawDistance = null;
  dom.drawLayer.innerHTML = '';
  dom.container.style.cursor = '';
  dom.container.classList.remove('drawing');
  hideDistanceInput();
  updateDrawStatus();
}

function finishPolygon() {
  if (state.drawPoints.length >= 3) {
    createPolygonObject(state.drawType, state.drawPoints);
  }
  cancelDrawMode();
}

function applyDrawConstraint(snapped) {
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

function toggleDrawConstraint(type) {
  if (!state.drawMode || state.drawPoints.length === 0) return;
  state.drawConstraint = (state.drawConstraint === type) ? null : type;
  updateDrawStatus();
}

// ---- Distance Input ----
function showDistanceInput() {
  let input = document.getElementById('draw-distance-input');
  if (!input) return;
  input.style.display = 'flex';
  const field = input.querySelector('input');
  field.value = state.drawDistance || '';
  field.focus();
  field.select();
}

function hideDistanceInput() {
  let input = document.getElementById('draw-distance-input');
  if (input) input.style.display = 'none';
}

function setDrawDistance(val) {
  const num = parseFloat(val);
  state.drawDistance = (num > 0) ? num : null;
  updateDrawStatus();
}

function confirmDistanceAndPlace() {
  if (!state.drawMode || state.drawPoints.length === 0) return;
  const val = document.getElementById('draw-dist-field').value;
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

function startEntrancePlacement(objId, type) {
  cancelAllModes();
  state.entrancePlaceMode = true;
  state.entrancePlaceType = type || 'vjezd';
  state.entrancePlaceStep = 0;
  state.entrancePlaceFirstPoint = null;
  entrancePlaceObjId = objId;
  dom.container.style.cursor = 'crosshair';
  dom.container.classList.add('drawing');
  updateDrawStatus();
}

function startEntrancePlacementGlobal(type) {
  cancelAllModes();
  state.entrancePlaceMode = true;
  state.entrancePlaceType = type || 'vjezd';
  state.entrancePlaceStep = 0;
  state.entrancePlaceFirstPoint = null;
  entrancePlaceObjId = null;
  dom.container.style.cursor = 'crosshair';
  dom.container.classList.add('drawing');
  updateDrawStatus();
}

function cancelEntrancePlacement() {
  state.entrancePlaceMode = false;
  state.entrancePlaceStep = 0;
  state.entrancePlaceFirstPoint = null;
  entrancePlaceObjId = null;
  dom.snapLayer.innerHTML = '';
  dom.container.style.cursor = '';
  dom.container.classList.remove('drawing');
  updateDrawStatus();
}

function handleEntranceClick(world) {
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

function startWallDrawMode(objId) {
  cancelAllModes();
  state.wallDrawMode = true;
  state.wallDrawObjId = objId;
  state.wallDrawStart = null;
  state.wallDrawStep = 0; // 0=čekám na snap bodu, 1=čekám na potvrzení vzdálenosti
  state.wallDrawSnap = null; // {edgeType, x, y, edgeStart, edgeEnd, t, edgeLen, distFromStart}
  dom.container.style.cursor = 'crosshair';
  dom.container.classList.add('drawing');
  updateDrawStatus();
  showWallDistInput();
}

function cancelWallDrawMode() {
  state.wallDrawMode = false;
  state.wallDrawObjId = null;
  state.wallDrawStart = null;
  state.wallDrawStep = 0;
  state.wallDrawSnap = null;
  dom.snapLayer.innerHTML = '';
  dom.container.style.cursor = '';
  dom.container.classList.remove('drawing');
  hideWallDistInput();
  updateDrawStatus();
}

// Najít nejbližší hranu (obvod haly nebo existující stěna) k bodu
function findNearestEdgeInHall(obj, wx, wy) {
  let best = null;
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

// Projekt bodu na hranu — vrátí {px, py, t, dist, edgeLen}
function projectPointOnEdge(wx, wy, x1, y1, x2, y2) {
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

// Přepočítat pozici na hraně podle zadané vzdálenosti
function getPointOnEdgeByDist(edgeStart, edgeEnd, distance) {
  const dx = edgeEnd.x - edgeStart.x;
  const dy = edgeEnd.y - edgeStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return { x: edgeStart.x, y: edgeStart.y };
  const t = Math.max(0, Math.min(1, distance / len));
  return { x: edgeStart.x + t * dx, y: edgeStart.y + t * dy };
}

function handleWallClick(world) {
  const obj = state.objects.find(o => o.id === state.wallDrawObjId);
  if (!obj) return;

  // Najdi nejbližší hranu
  const snap = findNearestEdgeInHall(obj, world.x, world.y);

  if (!state.wallDrawStart) {
    // === PRVNÍ BOD ===
    if (snap) {
      state.wallDrawSnap = snap;
      // Zobrazit input s vzdáleností
      updateWallDistInput(snap.distFromStart, snap.edgeLen, 'start');
      state.wallDrawStep = 1; // čekáme na potvrzení
      updateDrawStatus();
      renderWallSnapPreview(snap, null);
    } else {
      // Klik do volného prostoru — použít snapToGrid
      const snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
      state.wallDrawStart = snapped;
      state.wallDrawSnap = null;
      state.wallDrawStep = 0;
      updateDrawStatus();
      hideWallDistInput();
    }
  } else {
    // === DRUHÝ BOD ===
    if (snap) {
      state.wallDrawSnap = snap;
      updateWallDistInput(snap.distFromStart, snap.edgeLen, 'end');
      state.wallDrawStep = 2; // čekáme na potvrzení koncového bodu
      updateDrawStatus();
      renderWallSnapPreview(null, snap);
    } else {
      // Volný koncový bod
      const snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
      finishWall(snapped);
    }
  }
}

function confirmWallPoint() {
  const input = document.getElementById('wall-dist-field');
  if (!input) return;
  const dist = parseFloat(input.value);
  if (isNaN(dist) || dist < 0) return;

  const snap = state.wallDrawSnap;
  if (!snap) return;

  const pt = getPointOnEdgeByDist(snap.edgeStart, snap.edgeEnd, dist);

  if (state.wallDrawStep === 1) {
    // Potvrzení prvního bodu
    state.wallDrawStart = pt;
    state.wallDrawSnap = null;
    state.wallDrawStep = 0;
    hideWallDistInput();
    updateDrawStatus();
  } else if (state.wallDrawStep === 2) {
    // Potvrzení druhého bodu → vytvořit stěnu
    finishWall(pt);
  }
}

function finishWall(endPoint) {
  const s = state.wallDrawStart;
  if (!s) return;
  const dist = Math.sqrt((endPoint.x - s.x) ** 2 + (endPoint.y - s.y) ** 2);
  if (dist < 0.3) {
    showToast('Stěna je příliš krátká');
    return;
  }
  addWall(state.wallDrawObjId, s.x, s.y, endPoint.x, endPoint.y);
  state.wallDrawStart = null;
  state.wallDrawSnap = null;
  state.wallDrawStep = 0;
  hideWallDistInput();
  updateDrawStatus();
}

// === Wall distance input UI ===
function showWallDistInput() {
  let box = document.getElementById('wall-dist-input');
  if (box) { box.style.display = 'none'; return; }
  box = document.createElement('div');
  box.id = 'wall-dist-input';
  box.style.cssText = 'display:none;position:fixed;bottom:50px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:8px 12px;z-index:999;gap:8px;align-items:center;font-size:13px;color:var(--text);box-shadow:0 4px 16px rgba(0,0,0,0.4);';
  box.innerHTML = `
    <span id="wall-dist-label" style="white-space:nowrap;color:var(--text2);font-size:12px;">Vzdálenost:</span>
    <input type="number" id="wall-dist-field" step="0.5" min="0" style="width:70px;padding:4px 8px;font-size:13px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:5px;outline:none;"
      onkeydown="if(event.key==='Enter'){confirmWallPoint();event.preventDefault();}">
    <span id="wall-dist-max" style="font-size:11px;color:var(--text2);"></span>
    <button class="btn" onclick="confirmWallPoint()" style="padding:4px 10px;font-size:12px;">OK</button>
  `;
  document.body.appendChild(box);
}

function updateWallDistInput(distValue, maxLen, step) {
  let box = document.getElementById('wall-dist-input');
  if (!box) { showWallDistInput(); box = document.getElementById('wall-dist-input'); }
  box.style.display = 'flex';
  const label = document.getElementById('wall-dist-label');
  const field = document.getElementById('wall-dist-field');
  const maxSpan = document.getElementById('wall-dist-max');
  label.textContent = step === 'start' ? 'Počátek — vzdálenost od rohu:' : 'Konec — vzdálenost od rohu:';
  field.value = distValue.toFixed(1);
  field.max = maxLen;
  maxSpan.textContent = `/ ${maxLen.toFixed(1)} m`;
  field.focus();
  field.select();
}

function hideWallDistInput() {
  const box = document.getElementById('wall-dist-input');
  if (box) box.style.display = 'none';
}

// Vizuální náhled přichyceného bodu na hraně
function renderWallSnapPreview(startSnap, endSnap) {
  dom.snapLayer.innerHTML = '';
  const snap = startSnap || endSnap;
  if (!snap) return;

  // Zvýraznit hranu
  const edgeLine = svgEl('line');
  edgeLine.setAttribute('x1', snap.edgeStart.x);
  edgeLine.setAttribute('y1', snap.edgeStart.y);
  edgeLine.setAttribute('x2', snap.edgeEnd.x);
  edgeLine.setAttribute('y2', snap.edgeEnd.y);
  edgeLine.setAttribute('stroke', '#f59e0b');
  edgeLine.setAttribute('stroke-width', 0.15);
  edgeLine.setAttribute('stroke-dasharray', '0.5 0.3');
  edgeLine.setAttribute('opacity', '0.5');
  dom.snapLayer.appendChild(edgeLine);

  // Bod na hraně
  const dot = svgEl('circle');
  dot.setAttribute('cx', snap.x);
  dot.setAttribute('cy', snap.y);
  dot.setAttribute('r', 0.6);
  dot.setAttribute('fill', '#f59e0b');
  dot.setAttribute('stroke', '#fff');
  dot.setAttribute('stroke-width', 0.1);
  dom.snapLayer.appendChild(dot);

  // Vzdálenost od začátku hrany
  const distLabel = svgEl('text');
  distLabel.setAttribute('x', snap.x);
  distLabel.setAttribute('y', snap.y - 1.2);
  distLabel.setAttribute('font-size', 0.55);
  distLabel.setAttribute('fill', '#f59e0b');
  distLabel.setAttribute('text-anchor', 'middle');
  distLabel.textContent = snap.distFromStart.toFixed(1) + ' m';
  dom.snapLayer.appendChild(distLabel);

  // Pokud máme start, zobrazit čáru k němu
  if (endSnap && state.wallDrawStart) {
    const line = svgEl('line');
    line.setAttribute('x1', state.wallDrawStart.x);
    line.setAttribute('y1', state.wallDrawStart.y);
    line.setAttribute('x2', snap.x);
    line.setAttribute('y2', snap.y);
    line.setAttribute('stroke', '#a0a0c0');
    line.setAttribute('stroke-width', 0.12);
    line.setAttribute('stroke-dasharray', '0.4 0.3');
    dom.snapLayer.appendChild(line);

    // Startovní bod
    const startDot = svgEl('circle');
    startDot.setAttribute('cx', state.wallDrawStart.x);
    startDot.setAttribute('cy', state.wallDrawStart.y);
    startDot.setAttribute('r', 0.4);
    startDot.setAttribute('fill', '#22c55e');
    dom.snapLayer.appendChild(startDot);
  }
}

// ============================
// GATE PLACEMENT MODE (vrata)
// ============================

function startGatePlacement(objId, wallId) {
  cancelAllModes();
  state.gatePlaceMode = true;
  state.gatePlaceObjId = objId;
  state.gatePlaceWallId = wallId;
  dom.container.style.cursor = 'crosshair';
  dom.container.classList.add('drawing');
  updateDrawStatus();
}

function cancelGatePlacement() {
  state.gatePlaceMode = false;
  state.gatePlaceObjId = null;
  state.gatePlaceWallId = null;
  dom.snapLayer.innerHTML = '';
  dom.container.style.cursor = '';
  dom.container.classList.remove('drawing');
  updateDrawStatus();
}

function handleGateClick(world) {
  const objId = state.gatePlaceObjId;
  const wallId = state.gatePlaceWallId;
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;

  // Promítnout klik přímo na vybranou stěnu
  const projected = projectOntoWall(obj, wallId, world.x, world.y);
  if (!projected || projected.dist > 8) {
    showToast('Klikni blíž ke stěně');
    return;
  }

  addGate(objId, wallId, projected.t, 3);
  cancelGatePlacement();
  selectObject(objId);
}

// ============================
// ROOM LABEL PLACEMENT MODE
// ============================

function startRoomLabelPlacement(objId) {
  cancelAllModes();
  state.roomLabelPlaceMode = true;
  state.roomLabelPlaceObjId = objId;
  dom.container.style.cursor = 'crosshair';
  dom.container.classList.add('drawing');
  updateDrawStatus();
}

function cancelRoomLabelPlacement() {
  state.roomLabelPlaceMode = false;
  state.roomLabelPlaceObjId = null;
  dom.snapLayer.innerHTML = '';
  dom.container.style.cursor = '';
  dom.container.classList.remove('drawing');
  updateDrawStatus();
}

function handleRoomLabelClick(world) {
  const objId = state.roomLabelPlaceObjId;
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;

  // Ověřit, že bod je uvnitř polygonu (pokud má points)
  if (obj.points && !isPointInPolygon(world.x, world.y, obj.points)) {
    showToast('Klikni dovnitř objektu');
    return;
  }

  addRoomLabel(objId, world.x, world.y);
  cancelRoomLabelPlacement();
  selectObject(objId);
}

// ============================
// CANCEL ALL MODES
// ============================

function cancelAllModes() {
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

function updateDrawStatus() {
  if (!dom.drawStatus) return;

  if (state.gatePlaceMode) {
    dom.drawStatus.textContent = 'Umísťuji vrata — klikni na stěnu  |  Escape pro zrušení';
    dom.drawStatus.style.display = 'flex';
    dom.drawStatus.style.borderColor = '#f59e0b';
  } else if (state.wallDrawMode) {
    let msg;
    if (state.wallDrawStep === 1) msg = 'Stěna — uprav vzdálenost a potvrď OK/Enter';
    else if (state.wallDrawStep === 2) msg = 'Stěna — uprav vzdálenost konce a potvrď OK/Enter';
    else if (state.wallDrawStart) msg = 'Stěna — klikni na obvod/stěnu pro koncový bod  |  Escape';
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
    const color = COLORS[state.drawType] || COLORS.hala;
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

function initPaletteDrag() {
  document.querySelectorAll('.palette-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragType = item.dataset.type;
      e.dataTransfer.setData('text/plain', dragType);
      e.dataTransfer.effectAllowed = 'copy';
      dom.ghost.style.display = 'block';
      dom.ghost.innerHTML = `<div style="background:${COLORS[dragType].stroke}33; border:2px solid ${COLORS[dragType].stroke}; border-radius:8px; padding:8px 14px; color:${COLORS[dragType].stroke}; font-size:13px; font-weight:500;">${COLORS[dragType].label}</div>`;
      e.dataTransfer.setDragImage(dom.ghost, 40, 20);
    });
    item.addEventListener('dragend', () => {
      dom.ghost.style.display = 'none';
      dragType = null;
    });
  });

  document.querySelectorAll('.palette-item[data-draw]').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.draw;
      if (state.drawMode && state.drawType === type) {
        cancelDrawMode();
      } else {
        startDrawMode(type);
      }
    });
  });

  dom.container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  dom.container.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if (!type || !COLORS[type]) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const sz = DEFAULT_SIZES[type];
    createObject(type, world.x - sz.w / 2, world.y - sz.h / 2);
  });
}

// ============================
// MOUSE ON CANVAS
// ============================

function initCanvasMouse() {
  dom.container.addEventListener('mousedown', (e) => {
    // Pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      dragStartWorld = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      dom.container.classList.add('panning');
      return;
    }

    if (e.button !== 0) return;
    const world = screenToWorld(e.clientX, e.clientY);

    // ---- GATE PLACEMENT ----
    if (state.gatePlaceMode) {
      handleGateClick(world);
      return;
    }

    // ---- ROOM LABEL PLACEMENT ----
    if (state.roomLabelPlaceMode) {
      handleRoomLabelClick(world);
      return;
    }

    // ---- WALL DRAW MODE ----
    if (state.wallDrawMode) {
      handleWallClick(world);
      return;
    }

    // ---- ENTRANCE PLACEMENT ----
    if (state.entrancePlaceMode) {
      handleEntranceClick(world);
      return;
    }

    // ---- DRAW MODE ----
    if (state.drawMode) {
      handleDrawClick(world);
      return;
    }

    // ---- ROOM LABEL DRAG ----
    {
      const target = e.target;
      if (target && target.dataset && target.dataset.action === 'drag-room-label') {
        const rlObjId = parseInt(target.dataset.objId);
        const rlRoomId = parseInt(target.dataset.roomId);
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
            dom.container.style.cursor = 'grabbing';
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
        // Nejdřív zkontroluj, jestli kliknutí je na rotační zónu nebo přímo na vertex
        const target = e.target;
        const isRotateHandle = target && target.dataset && target.dataset.action === 'rotate-vertex';
        const isVertexHandle = target && target.dataset && target.dataset.action === 'move-vertex';

        for (let i = 0; i < obj.points.length; i++) {
          const p = obj.points[i];
          const dist = Math.sqrt((world.x - p.x) ** 2 + (world.y - p.y) ** 2);
          const vertexThreshold = 0.7 / state.zoom;   // Menší zóna = přesun vertexu
          const rotateThreshold = 2.0 / state.zoom;    // Větší zóna = rotace

          if (dist < rotateThreshold) {
            pushUndo();
            // Rotace: klik na rotační zónu (vnější prstenec), nebo Shift+klik kdekoliv blízko
            if (e.shiftKey || isRotateHandle || (dist >= vertexThreshold && !isVertexHandle)) {
              isRotatingAroundVertex = true;
              rotateAnchorIndex = i;
              rotateOrigPoints = obj.points.map(pt => ({ ...pt }));
              rotateStartAngle = Math.atan2(world.y - p.y, world.x - p.x);
              dom.container.style.cursor = 'grabbing';
            } else {
              // Normální klik na vertex → přesun vertexu
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
          pushUndo(); // Undo pro resize
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
        pushUndo(); // Undo pro přesun objektu
        isDragging = true;
        dragStartWorld = { x: world.x, y: world.y };
        if (clicked.points) {
          dragObjStart = { points: clicked.points.map(p => ({ ...p })) };
        } else {
          dragObjStart = { x: clicked.x, y: clicked.y };
        }
      }
    } else {
      deselectAll();
    }
  });

  dom.container.addEventListener('dblclick', (e) => {
    if (state.drawMode && state.drawPoints.length >= 3) {
      finishPolygon();
    }
  });

  dom.container.addEventListener('mousemove', (e) => {
    const world = screenToWorld(e.clientX, e.clientY);
    dom.coordsDisplay.textContent = `X: ${world.x.toFixed(1)} m   Y: ${world.y.toFixed(1)} m`;

    // Gate placement preview — ukázat kde bude vrata
    if (state.gatePlaceMode) {
      const gObj = state.objects.find(o => o.id === state.gatePlaceObjId);
      if (gObj) {
        const projected = projectOntoWall(gObj, state.gatePlaceWallId, world.x, world.y);
        renderGatePlacePreview(gObj, state.gatePlaceWallId, projected);
      }
    }

    // Vertex hover — ukázat rotační nápovědu
    if (state.selected && !isDragging && !isMovingVertex && !isRotatingAroundVertex && !isResizing && !state.drawMode && !state.gatePlaceMode && !state.wallDrawMode && !state.entrancePlaceMode) {
      const hoverObj = state.objects.find(o => o.id === state.selected);
      if (hoverObj && hoverObj.points && !hoverObj.locked) {
        let nearVertex = false;
        const target = e.target;
        const isOnRotateHandle = target && target.dataset && target.dataset.action === 'rotate-vertex';
        for (let i = 0; i < hoverObj.points.length; i++) {
          const p = hoverObj.points[i];
          const d = Math.sqrt((world.x - p.x) ** 2 + (world.y - p.y) ** 2);
          if (d < 2.0 / state.zoom) {
            nearVertex = true;
            // Když jsme na rotační zóně (ne přímo na vertexu)
            if (isOnRotateHandle || d >= 0.7 / state.zoom) {
              dom.container.style.cursor = 'grab';
            }
            break;
          }
        }
        if (!nearVertex && dom.container.style.cursor === 'grab') {
          dom.container.style.cursor = '';
        }
      }
    }

    // Wall draw preview — snap náhled při hoveru
    if (state.wallDrawMode && state.wallDrawStep === 0) {
      const obj = state.objects.find(o => o.id === state.wallDrawObjId);
      if (obj) {
        const hoverSnap = findNearestEdgeInHall(obj, world.x, world.y);
        if (hoverSnap) {
          renderWallSnapHover(hoverSnap);
        } else {
          dom.snapLayer.innerHTML = '';
          // Pokud máme start, ukázat čáru ke kurzoru
          if (state.wallDrawStart) renderWallDrawPreview(world);
        }
        // Pokud máme start a hover snap, ukázat i čáru
        if (state.wallDrawStart && hoverSnap) {
          renderWallSnapPreview(null, hoverSnap);
        }
      }
    }

    // Entrance placement preview
    if (state.entrancePlaceMode) {
      renderEntrancePlacePreview(world);
    }

    // Draw mode náhled
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

        // Snap na 5° kroky
        const snapDeg = 5;
        const snapRad = snapDeg * Math.PI / 180;
        angleDelta = Math.round(angleDelta / snapRad) * snapRad;

        const cos = Math.cos(angleDelta);
        const sin = Math.sin(angleDelta);

        obj.points = rotateOrigPoints.map(p => ({
          x: anchor.x + (p.x - anchor.x) * cos - (p.y - anchor.y) * sin,
          y: anchor.y + (p.x - anchor.x) * sin + (p.y - anchor.y) * cos,
        }));

        const bbox = getPolygonBBox(obj.points);
        obj.x = bbox.minX;
        obj.y = bbox.minY;
        obj.w = bbox.maxX - bbox.minX;
        obj.h = bbox.maxY - bbox.minY;

        renderAll();

        // Zobrazit úhel na snap layeru
        dom.snapLayer.innerHTML = '';
        const angleDeg = (angleDelta * 180 / Math.PI).toFixed(0);
        const label = svgEl('text');
        label.setAttribute('x', anchor.x);
        label.setAttribute('y', anchor.y - 2);
        label.setAttribute('font-size', 0.8);
        label.setAttribute('fill', '#f59e0b');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-family', "'Segoe UI', sans-serif");
        label.textContent = angleDeg + '°';
        dom.snapLayer.appendChild(label);

        // Kruhový oblouk jako vizuální vodítko
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
          arc.setAttribute('stroke-width', 0.1);
          arc.setAttribute('opacity', '0.6');
          dom.snapLayer.appendChild(arc);
        }

        // Tečkovaný kruh kolem kotvy
        const circle = svgEl('circle');
        circle.setAttribute('cx', anchor.x);
        circle.setAttribute('cy', anchor.y);
        circle.setAttribute('r', 1);
        circle.setAttribute('fill', '#f59e0b');
        circle.setAttribute('opacity', '0.5');
        dom.snapLayer.appendChild(circle);
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
        obj.points = dragObjStart.points.map(p => ({
          x: p.x + snappedDx,
          y: p.y + snappedDy
        }));
        const bbox = getPolygonBBox(obj.points);
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
      dom.snapLayer.innerHTML = '';
      dom.container.style.cursor = '';
    }
    if (isDraggingRoomLabel) {
      dom.container.style.cursor = '';
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
    dom.container.classList.remove('panning');
  });
}

function handleDrawClick(world) {
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

function handleConnectClick(clicked) {
  if (!state.connectFrom) {
    state.connectFrom = clicked.id;
    selectObject(clicked.id);
  } else if (state.connectFrom !== clicked.id) {
    pushUndo();
    const exists = state.connections.some(c =>
      (c.from === state.connectFrom && c.to === clicked.id) ||
      (c.from === clicked.id && c.to === state.connectFrom)
    );
    if (!exists) {
      state.connections.push({ from: state.connectFrom, to: clicked.id });
    }
    state.connectFrom = null;
    state.connectMode = false;
    document.getElementById('connect-mode-btn').classList.remove('active-connect');
    selectObject(clicked.id);
  }
}

// ============================
// ZOOM
// ============================

function initZoom() {
  dom.container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, state.zoom * delta));
    const rect = dom.container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
    state.panY = my - (my - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;
    updateTransform();
  }, { passive: false });
}

function zoomIn() {
  const cx = dom.container.clientWidth / 2;
  const cy = dom.container.clientHeight / 2;
  const newZoom = Math.min(5, state.zoom * 1.3);
  state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
  state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
  state.zoom = newZoom;
  updateTransform();
}

function zoomOut() {
  const cx = dom.container.clientWidth / 2;
  const cy = dom.container.clientHeight / 2;
  const newZoom = Math.max(0.1, state.zoom * 0.7);
  state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
  state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
  state.zoom = newZoom;
  updateTransform();
}

function zoomFit() {
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
  const cw = dom.container.clientWidth;
  const ch = dom.container.clientHeight;
  state.zoom = Math.min(cw / (ww * state.pxPerMeter), ch / (wh * state.pxPerMeter)) * 0.9;
  state.zoom = Math.max(0.1, Math.min(5, state.zoom));
  state.panX = (cw - ww * state.zoom * state.pxPerMeter) / 2 - minX * state.zoom * state.pxPerMeter + 5 * state.zoom * state.pxPerMeter;
  state.panY = (ch - wh * state.zoom * state.pxPerMeter) / 2 - minY * state.zoom * state.pxPerMeter + 5 * state.zoom * state.pxPerMeter;
  updateTransform();
}

// ============================
// GRID & SNAP & CONNECT
// ============================

function toggleGrid() {
  state.gridVisible = !state.gridVisible;
  document.getElementById('grid-layer').style.display = state.gridVisible ? '' : 'none';
  document.getElementById('btn-grid').classList.toggle('active', state.gridVisible);
}

function toggleSnap() {
  state.snapEnabled = !state.snapEnabled;
  document.getElementById('btn-snap').classList.toggle('active', state.snapEnabled);
}

function toggleConnectMode() {
  state.connectMode = !state.connectMode;
  state.connectFrom = null;
  if (state.drawMode) cancelDrawMode();
  document.getElementById('connect-mode-btn').classList.toggle('active-connect', state.connectMode);
  document.getElementById('connect-mode-btn').style.borderColor = state.connectMode ? 'var(--accent2)' : '';
  dom.container.style.cursor = state.connectMode ? 'crosshair' : '';
}

// ============================
// KEYBOARD
// ============================

function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    // Undo/Redo funguje i z inputů
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
    // Constraint klávesy v draw mode
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
    // R = rotace
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

function resizeSVG() {
  dom.svg.setAttribute('width', dom.container.clientWidth);
  dom.svg.setAttribute('height', dom.container.clientHeight);
  updateTransform();
}
