/* ============================================
   interactions.ts — Drag, pan, zoom, klávesy
   ============================================ */
import { state } from './state.js';
import { dom, screenToWorld, updateTransform, renderAll, snapToGrid, getPolygonBBox, svgEl, renderDrawPreview, renderEntrancePlacePreview, renderGatePlacePreview, isPointInPolygon } from './renderer.js';
import { COLORS, DEFAULT_SIZES, ENTRANCE_TYPES } from './config.js';
import { createObject, createPolygonObject, findObjectAt, selectObject, deleteObject, duplicateObject, moveVertex, findNearestArealEdge, addWall, findNearestWall, projectOntoWall, addGate, addRoomLabel, rotatePolygon, addEntrance } from './objects.js';
import { pushUndo, undo, redo } from './history.js';
import { showProperties, deselectAll, getRotateCenter } from './properties.js';
import { showToast, saveProject, closeSaveDialog } from './storage.js';
// ============================
// Global drag state
// ============================
let isDragging = false, isResizing = false, isPanning = false;
let isMovingVertex = false, movingVertexIndex = -1;
let isRotatingAroundVertex = false, rotateAnchorIndex = -1;
let rotateStartAngle = 0, rotateOrigPoints = null;
let dragStartWorld = null, dragObjStart = null;
let dragType = null;
let entrancePlaceObjId = null;
let dragUndoPushed = false;
let isDraggingRoomLabel = false, dragRoomLabelObj = null, dragRoomLabel = null, dragRoomLabelStart = null;
// ============================
// DRAW MODE (kreslení polygonů)
// ============================
export function startDrawMode(type) {
    cancelAllModes();
    state.drawMode = true;
    state.drawType = type;
    state.drawPoints = [];
    state.drawConstraint = null;
    state.drawDistance = null;
    if (dom.container)
        dom.container.style.cursor = 'crosshair';
    updateDrawStatus();
    if (dom.container)
        dom.container.classList.add('drawing');
}
export function cancelDrawMode() {
    state.drawMode = false;
    state.drawType = null;
    state.drawPoints = [];
    state.drawConstraint = null;
    state.drawDistance = null;
    if (dom.drawLayer)
        dom.drawLayer.innerHTML = '';
    if (dom.container)
        dom.container.style.cursor = '';
    if (dom.container)
        dom.container.classList.remove('drawing');
    hideDistanceInput();
    updateDrawStatus();
}
export function finishPolygon() {
    if (state.drawType === 'stena') {
        // Enter/dvojklik v režimu stěny → otevřená polyline (stěny bez uzavření)
        if (state.drawPoints.length >= 2)
            finalizeWallsFromDrawPoints(false);
        else
            cancelDrawMode();
        return;
    }
    if (state.drawPoints.length >= 3 && state.drawType) {
        createPolygonObject(state.drawType, state.drawPoints);
    }
    cancelDrawMode();
}
export function applyDrawConstraint(snapped) {
    if (state.drawPoints.length === 0)
        return snapped;
    const last = state.drawPoints[state.drawPoints.length - 1];
    let x = snapped.x, y = snapped.y;
    if (state.drawConstraint === 'h')
        y = last.y;
    else if (state.drawConstraint === 'v')
        x = last.x;
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
export function toggleDrawConstraint(type) {
    if (!state.drawMode || state.drawPoints.length === 0)
        return;
    state.drawConstraint = (state.drawConstraint === type) ? null : type;
    updateDrawStatus();
}
// ---- Distance Input ----
export function showDistanceInput() {
    let input = document.getElementById('draw-distance-input');
    if (!input)
        return;
    input.style.display = 'flex';
    const field = input.querySelector('input');
    field.value = state.drawDistance?.toString() || '';
    field.focus();
    field.select();
}
export function hideDistanceInput() {
    let input = document.getElementById('draw-distance-input');
    if (input)
        input.style.display = 'none';
}
export function setDrawDistance(val) {
    const num = parseFloat(val);
    state.drawDistance = (num > 0) ? num : null;
    updateDrawStatus();
}
export function confirmDistanceAndPlace() {
    if (!state.drawMode || state.drawPoints.length === 0)
        return;
    const val = document.getElementById('draw-dist-field')?.value;
    setDrawDistance(val);
    if (state.drawDistance && state.drawConstraint) {
        const last = state.drawPoints[state.drawPoints.length - 1];
        let x = last.x, y = last.y;
        if (state.drawConstraint === 'h')
            x = last.x + state.drawDistance;
        else if (state.drawConstraint === 'v')
            y = last.y + state.drawDistance;
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
export function startEntrancePlacement(objId, type) {
    cancelAllModes();
    state.entrancePlaceMode = true;
    state.entrancePlaceType = type || 'vjezd';
    state.entrancePlaceStep = 0;
    state.entrancePlaceFirstPoint = null;
    entrancePlaceObjId = objId;
    if (dom.container)
        dom.container.style.cursor = 'crosshair';
    if (dom.container)
        dom.container.classList.add('drawing');
    updateDrawStatus();
}
export function startEntrancePlacementGlobal(type) {
    cancelAllModes();
    state.entrancePlaceMode = true;
    state.entrancePlaceType = type || 'vjezd';
    state.entrancePlaceStep = 0;
    state.entrancePlaceFirstPoint = null;
    entrancePlaceObjId = null;
    if (dom.container)
        dom.container.style.cursor = 'crosshair';
    if (dom.container)
        dom.container.classList.add('drawing');
    updateDrawStatus();
}
export function cancelEntrancePlacement() {
    state.entrancePlaceMode = false;
    state.entrancePlaceStep = 0;
    state.entrancePlaceFirstPoint = null;
    entrancePlaceObjId = null;
    if (dom.snapLayer)
        dom.snapLayer.innerHTML = '';
    if (dom.container)
        dom.container.style.cursor = '';
    if (dom.container)
        dom.container.classList.remove('drawing');
    updateDrawStatus();
}
export function handleEntranceClick(world) {
    const nearest = findNearestArealEdge(world.x, world.y);
    if (!nearest) {
        showToast('Klikni blíž k hraně areálu, haly nebo stěny');
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
            wallId: nearest.wallId,
            t: nearest.t,
            px: nearest.px,
            py: nearest.py,
        };
        updateDrawStatus();
    }
    else {
        // Druhý bod — musí být na stejné hraně nebo stejné stěně
        const fp = state.entrancePlaceFirstPoint;
        if (!fp) {
            showToast('Chyba: první bod vjezdu nenalezen');
            return;
        }
        const sameEdge = nearest.objId === fp.objId &&
            (fp.wallId != null
                ? nearest.wallId === fp.wallId
                : nearest.edgeIndex === fp.edgeIndex && nearest.wallId == null);
        if (!sameEdge) {
            showToast('Druhý bod musí být na stejné hraně/stěně');
            return;
        }
        addEntrance(fp.objId, fp.edgeIndex, fp.t, nearest.t, state.entrancePlaceType, fp.wallId);
        selectObject(fp.objId);
        cancelEntrancePlacement();
    }
}
// ============================
// WALL DRAW MODE (stěny v hale)
// ============================
// Kreslení stěny — zapne klasický drawMode s typem 'stena'.
// Stejné UX jako hala: bod-po-bodu klikáním, H/V zámek, input na délku hrany.
// Po druhém bodu se stěna automaticky dokončí (spec. větev v handleDrawClick).
export function startWallDrawModeGlobal() {
    startDrawMode('stena');
}
// Kompatibilita — staré volání, přesměrováno na cancelDrawMode
export function cancelWallDrawMode() {
    if (state.drawMode && state.drawType === 'stena')
        cancelDrawMode();
}
// Point-in-polygon test (ray casting) — lokální kopie
function wallPointInPoly(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect)
            inside = !inside;
    }
    return inside;
}
// Vzdálenost bodu k nejbližšímu bodu polygonu (0 pokud je bod uvnitř)
function distanceToPolygon(x, y, points) {
    if (wallPointInPoly(x, y, points))
        return 0;
    let minD = Infinity;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq > 0.0001 ? ((x - p1.x) * dx + (y - p1.y) * dy) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const px = p1.x + t * dx, py = p1.y + t * dy;
        const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
        if (d < minD)
            minD = d;
    }
    return minD;
}
// Najdi halu pro stěnu: primárně tu, uvnitř které bod leží;
// pokud žádná neobsahuje bod, vrať nejbližší halu.
// Pokud žádná hala neexistuje, vrátí null.
function findHallAt(x, y) {
    const halls = state.objects.filter((o) => o.type === 'hala' && o.points && o.points.length >= 3);
    if (halls.length === 0)
        return null;
    // 1) Haly, které bod obsahují — vezmi tu s nejmenší plochou
    const inside = halls.filter((o) => wallPointInPoly(x, y, o.points));
    if (inside.length > 0) {
        let best = inside[0];
        let bestArea = Infinity;
        for (const c of inside) {
            let area = 0;
            const pts = c.points;
            for (let i = 0; i < pts.length; i++) {
                const j = (i + 1) % pts.length;
                area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
            }
            area = Math.abs(area / 2);
            if (area < bestArea) {
                bestArea = area;
                best = c;
            }
        }
        return best;
    }
    // 2) Žádná neobsahuje — vezmi nejbližší
    let best = halls[0];
    let bestDist = Infinity;
    for (const h of halls) {
        const d = distanceToPolygon(x, y, h.points);
        if (d < bestDist) {
            bestDist = d;
            best = h;
        }
    }
    return best;
}
// Nasnapuj bod na nejbližší hranu haly (obvod nebo existující stěnu),
// pokud je v threshold vzdálenosti. Jinak vrátí původní bod.
function snapToHallEdge(x, y) {
    const threshold = 2 / state.zoom; // ve world jednotkách — závisí na zoomu
    let bestPx = x, bestPy = y, bestDist = Infinity;
    for (const obj of state.objects) {
        if (obj.type !== 'hala' || !obj.points || obj.points.length < 3)
            continue;
        // Obvodové hrany haly
        for (let i = 0; i < obj.points.length; i++) {
            const p1 = obj.points[i];
            const p2 = obj.points[(i + 1) % obj.points.length];
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq < 0.0001)
                continue;
            let t = ((x - p1.x) * dx + (y - p1.y) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const px = p1.x + t * dx, py = p1.y + t * dy;
            const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
            if (d < bestDist) {
                bestDist = d;
                bestPx = px;
                bestPy = py;
            }
        }
        // Existující stěny uvnitř haly
        if (obj.walls) {
            for (const wall of obj.walls) {
                const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
                const lenSq = dx * dx + dy * dy;
                if (lenSq < 0.0001)
                    continue;
                let t = ((x - wall.x1) * dx + (y - wall.y1) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
                const px = wall.x1 + t * dx, py = wall.y1 + t * dy;
                const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
                if (d < bestDist) {
                    bestDist = d;
                    bestPx = px;
                    bestPy = py;
                }
            }
        }
    }
    if (bestDist < threshold)
        return { x: bestPx, y: bestPy, onEdge: true };
    return { x, y, onEdge: false };
}
// Finalizace po nakreslení polyline/polygonu stěn.
// closed=true → vytvoří se i uzavírací stěna (z posledního bodu do prvního)
//   a doprostřed bounding boxu se umístí RoomLabel.
// closed=false → otevřená polyline jen ze segmentů mezi body.
function finalizeWallsFromDrawPoints(closed) {
    const pts = state.drawPoints;
    if (pts.length < 2) {
        cancelDrawMode();
        return;
    }
    const hall = findHallAt(pts[0].x, pts[0].y);
    if (!hall) {
        showToast('Nejprve vytvoř alespoň jednu halu');
        cancelDrawMode();
        return;
    }
    // Kolik segmentů — pokud uzavřené, přidáme i closing segment
    const segCount = closed ? pts.length : pts.length - 1;
    let created = 0;
    for (let i = 0; i < segCount; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const d = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        if (d < 0.3)
            continue;
        addWall(hall.id, a.x, a.y, b.x, b.y);
        created++;
    }
    // Pokud uzavřená místnost — umísti RoomLabel do těžiště
    if (closed && created >= 3) {
        let cx = 0, cy = 0;
        for (const p of pts) {
            cx += p.x;
            cy += p.y;
        }
        cx /= pts.length;
        cy /= pts.length;
        try {
            addRoomLabel(hall.id, cx, cy);
        }
        catch { }
    }
    cancelDrawMode();
    selectObject(hall.id);
}
// ============================
// GATE PLACEMENT MODE (vrata)
// ============================
export function startGatePlacement(objId, wallId) {
    cancelAllModes();
    state.gatePlaceMode = true;
    state.gatePlaceObjId = objId;
    state.gatePlaceWallId = wallId;
    if (dom.container)
        dom.container.style.cursor = 'crosshair';
    if (dom.container)
        dom.container.classList.add('drawing');
    updateDrawStatus();
}
export function cancelGatePlacement() {
    state.gatePlaceMode = false;
    state.gatePlaceObjId = null;
    state.gatePlaceWallId = null;
    if (dom.snapLayer)
        dom.snapLayer.innerHTML = '';
    if (dom.container)
        dom.container.style.cursor = '';
    if (dom.container)
        dom.container.classList.remove('drawing');
    updateDrawStatus();
}
export function handleGateClick(world) {
    const objId = state.gatePlaceObjId;
    const wallId = state.gatePlaceWallId;
    const obj = state.objects.find(o => o.id === objId);
    if (!obj)
        return;
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
export function startRoomLabelPlacement(objId) {
    cancelAllModes();
    state.roomLabelPlaceMode = true;
    state.roomLabelPlaceObjId = objId;
    if (dom.container)
        dom.container.style.cursor = 'crosshair';
    if (dom.container)
        dom.container.classList.add('drawing');
    updateDrawStatus();
}
export function cancelRoomLabelPlacement() {
    state.roomLabelPlaceMode = false;
    state.roomLabelPlaceObjId = null;
    if (dom.snapLayer)
        dom.snapLayer.innerHTML = '';
    if (dom.container)
        dom.container.style.cursor = '';
    if (dom.container)
        dom.container.classList.remove('drawing');
    updateDrawStatus();
}
export function handleRoomLabelClick(world) {
    const objId = state.roomLabelPlaceObjId;
    const obj = state.objects.find(o => o.id === objId);
    if (!obj)
        return;
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
export function cancelAllModes() {
    if (state.drawMode)
        cancelDrawMode();
    if (state.entrancePlaceMode)
        cancelEntrancePlacement();
    if (state.wallDrawMode)
        cancelWallDrawMode();
    if (state.gatePlaceMode)
        cancelGatePlacement();
    if (state.roomLabelPlaceMode)
        cancelRoomLabelPlacement();
    state.connectMode = false;
    state.connectFrom = null;
}
// ============================
// DRAW STATUS BAR
// ============================
export function updateDrawStatus() {
    if (!dom.drawStatus)
        return;
    if (state.gatePlaceMode) {
        dom.drawStatus.textContent = 'Umísťuji vrata — klikni na stěnu  |  Escape pro zrušení';
        dom.drawStatus.style.display = 'flex';
        dom.drawStatus.style.borderColor = '#f59e0b';
    }
    else if (state.entrancePlaceMode) {
        const eType = ENTRANCE_TYPES[state.entrancePlaceType] || ENTRANCE_TYPES.vjezd;
        const step = state.entrancePlaceStep === 1
            ? 'klikni pro druhý bod šířky'
            : 'klikni na hranu — první bod šířky';
        dom.drawStatus.textContent = `${eType.label} — ${step}  |  Escape pro zrušení`;
        dom.drawStatus.style.display = 'flex';
        dom.drawStatus.style.borderColor = eType.color;
    }
    else if (state.roomLabelPlaceMode) {
        dom.drawStatus.textContent = 'Místnost — klikni dovnitř prostoru pro umístění popisku  |  Escape pro zrušení';
        dom.drawStatus.style.display = 'flex';
        dom.drawStatus.style.borderColor = '#60a5fa';
    }
    else if (state.drawMode) {
        const color = COLORS[state.drawType] || COLORS.hala;
        const count = state.drawPoints.length;
        let msg = `Kreslím: ${color.label} — `;
        if (state.drawType === 'stena') {
            if (count === 0)
                msg += 'klikni pro první bod';
            else if (count === 1)
                msg += '1 bod — klikni pro další bod, Enter/dvojklik ukončí';
            else
                msg += `${count} bodů — klikni pro další, na 1. bod pro uzavření místnosti, Enter/dvojklik ukončí`;
        }
        else {
            if (count === 0)
                msg += 'klikni pro první bod';
            else if (count < 3)
                msg += `${count} bodů — pokračuj klikáním`;
            else
                msg += `${count} bodů — dvojklik/Enter pro uzavření`;
        }
        if (state.drawConstraint === 'h')
            msg += '  |  ⟷ Vodorovně (H)';
        else if (state.drawConstraint === 'v')
            msg += '  |  ⟰ Svisle (V)';
        if (count > 0 && !state.drawConstraint)
            msg += '  |  H=vodorovně  V=svisle  D=délka';
        if (state.drawDistance)
            msg += `  |  Délka: ${state.drawDistance} m`;
        dom.drawStatus.textContent = msg;
        dom.drawStatus.style.display = 'flex';
        dom.drawStatus.style.borderColor = color.stroke;
    }
    else {
        dom.drawStatus.style.display = 'none';
    }
}
// ============================
// DRAG FROM PALETTE
// ============================
export function initPaletteDrag() {
    document.querySelectorAll('.palette-item[draggable]').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragType = item.dataset.type;
            e.dataTransfer.setData('text/plain', dragType);
            e.dataTransfer.effectAllowed = 'copy';
            if (dom.ghost) {
                dom.ghost.style.display = 'block';
                const color = COLORS[dragType] || COLORS.hala;
                dom.ghost.innerHTML = `<div style="background:${color.stroke}33; border:2px solid ${color.stroke}; border-radius:8px; padding:8px 14px; color:${color.stroke}; font-size:13px; font-weight:500;">${color.label}</div>`;
                e.dataTransfer.setDragImage(dom.ghost, 40, 20);
            }
        });
        item.addEventListener('dragend', () => {
            if (dom.ghost)
                dom.ghost.style.display = 'none';
            dragType = null;
        });
    });
    document.querySelectorAll('.palette-item[data-draw]').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.dataset.draw;
            if (state.drawMode && state.drawType === type) {
                cancelDrawMode();
            }
            else {
                startDrawMode(type);
            }
        });
    });
    if (dom.container) {
        dom.container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        dom.container.addEventListener('drop', (e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData('text/plain');
            if (!type || !COLORS[type])
                return;
            const world = screenToWorld(e.clientX, e.clientY);
            const sz = DEFAULT_SIZES[type];
            createObject(type, world.x - sz.w / 2, world.y - sz.h / 2);
        });
    }
}
// ============================
// MOUSE ON CANVAS
// ============================
export function initCanvasMouse() {
    if (!dom.container)
        return;
    dom.container.addEventListener('mousedown', (e) => {
        // Pan
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            isPanning = true;
            dragStartWorld = { x: e.clientX - state.panX, y: e.clientY - state.panY };
            dom.container.classList.add('panning');
            return;
        }
        if (e.button !== 0)
            return;
        const world = screenToWorld(e.clientX, e.clientY);
        if (state.gatePlaceMode) {
            handleGateClick(world);
            return;
        }
        if (state.roomLabelPlaceMode) {
            handleRoomLabelClick(world);
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
                        if (dom.container)
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
                            rotateOrigPoints = obj.points.map((pt) => ({ ...pt }));
                            rotateStartAngle = Math.atan2(world.y - p.y, world.x - p.x);
                            if (dom.container)
                                dom.container.style.cursor = 'grabbing';
                        }
                        else {
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
        // Pokud klik spadl do haly, která je už vybraná, a je blízko některé její vnitřní stěny,
        // pouze tu stěnu zvýrazni v seznamu (neruš selekci haly a neaktivuj drag).
        if (clicked && clicked.id === state.selected && clicked.type === 'hala' && clicked.walls && clicked.walls.length > 0) {
            const nw = findNearestWall(clicked, world.x, world.y);
            if (nw && nw.dist < 1.2 / state.zoom) {
                state.highlightedWallId = nw.wallId;
                showProperties(clicked.id);
                return;
            }
        }
        if (clicked) {
            // Klik na jiný objekt → resetni zvýraznění stěny
            if (state.highlightedWallId != null && clicked.id !== state.selected) {
                state.highlightedWallId = null;
            }
            selectObject(clicked.id);
            if (!clicked.locked) {
                pushUndo();
                isDragging = true;
                dragStartWorld = { x: world.x, y: world.y };
                if (clicked.points) {
                    dragObjStart = { points: clicked.points.map((p) => ({ ...p })) };
                }
                else {
                    dragObjStart = { x: clicked.x, y: clicked.y };
                }
            }
        }
        else {
            state.highlightedWallId = null;
            deselectAll();
        }
    });
    dom.container.addEventListener('dblclick', (e) => {
        if (!state.drawMode)
            return;
        // Pro stěnu stačí 2 body (rovná stěna), pro ostatní typy 3 body (polygon)
        const minPts = state.drawType === 'stena' ? 2 : 3;
        if (state.drawPoints.length >= minPts) {
            finishPolygon();
        }
    });
    dom.container.addEventListener('mousemove', (e) => {
        const world = screenToWorld(e.clientX, e.clientY);
        if (dom.coordsDisplay) {
            dom.coordsDisplay.textContent = `X: ${world.x.toFixed(1)} m   Y: ${world.y.toFixed(1)} m`;
        }
        if (state.gatePlaceMode) {
            const gObj = state.objects.find(o => o.id === state.gatePlaceObjId);
            if (gObj) {
                const projected = projectOntoWall(gObj, state.gatePlaceWallId, world.x, world.y);
                renderGatePlacePreview(gObj, state.gatePlaceWallId, projected);
            }
        }
        if (state.selected && !isDragging && !isMovingVertex && !isRotatingAroundVertex && !isResizing && !state.drawMode && !state.gatePlaceMode && !state.entrancePlaceMode) {
            const hoverObj = state.objects.find(o => o.id === state.selected);
            if (hoverObj && hoverObj.points && !hoverObj.locked) {
                let nearVertex = false;
                for (let i = 0; i < hoverObj.points.length; i++) {
                    const p = hoverObj.points[i];
                    const d = Math.sqrt((world.x - p.x) ** 2 + (world.y - p.y) ** 2);
                    if (d < 2.0 / state.zoom) {
                        nearVertex = true;
                        if (d >= 0.7 / state.zoom) {
                            if (dom.container)
                                dom.container.style.cursor = 'grab';
                        }
                        break;
                    }
                }
                if (!nearVertex && dom.container && dom.container.style.cursor === 'grab') {
                    dom.container.style.cursor = '';
                }
            }
        }
        if (state.entrancePlaceMode) {
            renderEntrancePlacePreview(world);
        }
        if (state.drawMode) {
            let preview;
            let onEdge = false;
            if (state.drawType === 'stena') {
                const snap = snapToHallEdge(world.x, world.y);
                onEdge = snap.onEdge;
                preview = onEdge ? { x: snap.x, y: snap.y } : { x: snapToGrid(world.x), y: snapToGrid(world.y) };
            }
            else {
                preview = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
            }
            preview = applyDrawConstraint(preview);
            renderDrawPreview(preview);
            // Vizuální feedback při snapu na hranu haly
            if (dom.snapLayer) {
                if (onEdge) {
                    dom.snapLayer.innerHTML = `<circle cx="${preview.x}" cy="${preview.y}" r="0.6" fill="#f59e0b" stroke="#fff" stroke-width="0.12" opacity="0.9"></circle>`;
                }
                else {
                    dom.snapLayer.innerHTML = '';
                }
            }
        }
        else if (dom.snapLayer && dom.snapLayer.innerHTML) {
            dom.snapLayer.innerHTML = '';
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
                obj.points = rotateOrigPoints.map((p) => ({
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
            if (!obj)
                return;
            const dx = world.x - dragStartWorld.x;
            const dy = world.y - dragStartWorld.y;
            if (obj.points) {
                const snappedDx = snapToGrid(dx);
                const snappedDy = snapToGrid(dy);
                obj.points = dragObjStart.points.map((p) => ({
                    x: p.x + snappedDx,
                    y: p.y + snappedDy
                }));
                const bbox = getPolygonBBox(obj.points || []);
                obj.x = bbox.minX;
                obj.y = bbox.minY;
                obj.w = bbox.maxX - bbox.minX;
                obj.h = bbox.maxY - bbox.minY;
            }
            else {
                obj.x = snapToGrid(dragObjStart.x + dx);
                obj.y = snapToGrid(dragObjStart.y + dy);
            }
            renderAll();
        }
        if (isResizing && state.selected) {
            const obj = state.objects.find(o => o.id === state.selected);
            if (!obj)
                return;
            obj.w = Math.max(1, snapToGrid(dragObjStart.w + (world.x - dragStartWorld.x)));
            obj.h = Math.max(1, snapToGrid(dragObjStart.h + (world.y - dragStartWorld.y)));
            renderAll();
        }
    });
    window.addEventListener('mouseup', () => {
        if (isRotatingAroundVertex) {
            if (dom.snapLayer)
                dom.snapLayer.innerHTML = '';
            if (dom.container)
                dom.container.style.cursor = '';
        }
        if (isDraggingRoomLabel) {
            if (dom.container)
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
        if (dom.container)
            dom.container.classList.remove('panning');
    });
}
function handleDrawClick(world) {
    let snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
    snapped = applyDrawConstraint(snapped);
    // Kreslení stěny/místnosti: polyline jako hala — klik na první bod uzavře do místnosti.
    if (state.drawType === 'stena') {
        // Snap na obvod haly / existující stěnu (má přednost před gridem)
        const edgeSnap = snapToHallEdge(world.x, world.y);
        if (edgeSnap.onEdge) {
            // Aplikuj H/V zámek na snapnutý bod (pro pokračování od předchozího)
            snapped = applyDrawConstraint({ x: edgeSnap.x, y: edgeSnap.y });
        }
        if (state.drawPoints.length >= 3) {
            const first = state.drawPoints[0];
            const d = Math.sqrt((snapped.x - first.x) ** 2 + (snapped.y - first.y) ** 2);
            if (d < 2) {
                finalizeWallsFromDrawPoints(true);
                return;
            }
        }
        state.drawPoints.push(snapped);
        state.drawDistance = null;
        hideDistanceInput();
        updateDrawStatus();
        renderDrawPreview(snapped);
        return;
    }
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
    }
    else if (state.connectFrom !== clicked.id) {
        pushUndo();
        const exists = state.connections.some((c) => (c.from === state.connectFrom && c.to === clicked.id) ||
            (c.from === clicked.id && c.to === state.connectFrom));
        if (!exists) {
            state.connections.push({ from: state.connectFrom, to: clicked.id });
        }
        state.connectFrom = null;
        state.connectMode = false;
        const btn = document.getElementById('connect-mode-btn');
        if (btn)
            btn.classList.remove('active-connect');
        selectObject(clicked.id);
    }
}
// ============================
// ZOOM
// ============================
export function initZoom() {
    if (!dom.container)
        return;
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
export function zoomIn() {
    const cx = dom.container.clientWidth / 2;
    const cy = dom.container.clientHeight / 2;
    const newZoom = Math.min(5, state.zoom * 1.3);
    state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
    state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;
    updateTransform();
}
export function zoomOut() {
    const cx = dom.container.clientWidth / 2;
    const cy = dom.container.clientHeight / 2;
    const newZoom = Math.max(0.1, state.zoom * 0.7);
    state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
    state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;
    updateTransform();
}
export function zoomFit() {
    if (state.objects.length === 0) {
        state.zoom = 1;
        state.panX = 50;
        state.panY = 50;
        updateTransform();
        return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.objects.forEach(o => {
        if (o.points) {
            o.points.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
        }
        else {
            minX = Math.min(minX, o.x);
            minY = Math.min(minY, o.y);
            maxX = Math.max(maxX, o.x + o.w);
            maxY = Math.max(maxY, o.y + o.h);
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
export function toggleGrid() {
    state.gridVisible = !state.gridVisible;
    const gridLayer = document.getElementById('grid-layer');
    if (gridLayer)
        gridLayer.style.display = state.gridVisible ? '' : 'none';
    const btn = document.getElementById('btn-grid');
    if (btn)
        btn.classList.toggle('active', state.gridVisible);
}
export function toggleSnap() {
    state.snapEnabled = !state.snapEnabled;
    const btn = document.getElementById('btn-snap');
    if (btn)
        btn.classList.toggle('active', state.snapEnabled);
}
export function toggleConnectMode() {
    state.connectMode = !state.connectMode;
    state.connectFrom = null;
    if (state.drawMode)
        cancelDrawMode();
    const btn = document.getElementById('connect-mode-btn');
    if (btn) {
        btn.classList.toggle('active-connect', state.connectMode);
        btn.style.borderColor = state.connectMode ? 'var(--accent2)' : '';
    }
    if (dom.container)
        dom.container.style.cursor = state.connectMode ? 'crosshair' : '';
}
// ============================
// KEYBOARD
// ============================
export function initKeyboard() {
    window.addEventListener('keydown', (e) => {
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
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')
            return;
        if (e.key === 'Escape') {
            const saveDialog = document.getElementById('save-dialog');
            if (saveDialog && saveDialog.style.display !== 'none') {
                closeSaveDialog();
                return;
            }
            if (state.gatePlaceMode) {
                cancelGatePlacement();
            }
            else if (state.roomLabelPlaceMode) {
                cancelRoomLabelPlacement();
            }
            else if (state.wallDrawMode) {
                cancelWallDrawMode();
            }
            else if (state.entrancePlaceMode) {
                cancelEntrancePlacement();
            }
            else if (state.drawMode) {
                cancelDrawMode();
            }
            else if (state.connectMode) {
                toggleConnectMode();
            }
            else {
                deselectAll();
            }
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (state.drawMode && state.drawPoints.length > 0) {
                state.drawPoints.pop();
                updateDrawStatus();
                renderDrawPreview(null);
            }
            else if (state.selected) {
                const selObj = state.objects.find(o => o.id === state.selected);
                if (selObj && !selObj.locked)
                    deleteObject(state.selected);
            }
        }
        if (e.key === 'Enter' && state.drawMode) {
            const minPts = state.drawType === 'stena' ? 2 : 3;
            if (state.drawPoints.length >= minPts)
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
            if (state.selected)
                duplicateObject(state.selected);
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
        if (e.key === 'g')
            toggleGrid();
    });
}
// ============================
// RESIZE SVG
// ============================
export function resizeSVG() {
    if (dom.svg && dom.container) {
        dom.svg.setAttribute('width', dom.container.clientWidth.toString());
        dom.svg.setAttribute('height', dom.container.clientHeight.toString());
        updateTransform();
    }
}
//# sourceMappingURL=interactions.js.map