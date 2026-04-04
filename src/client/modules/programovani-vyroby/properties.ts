/* ============================================
   properties.ts — Panel vlastností
   ============================================ */

import type { DrawingObject } from '../../../shared/types.js';
import { state } from './state.js';
import { COLORS, COLOR_SWATCHES, ENTRANCE_TYPES } from './config.js';
import { getPolygonArea, getPolygonBBox } from './renderer.js';
import { updateProp, updateColor, duplicateObject, deleteObject, rotatePolygon, rotateRect, removeEntrance, updateEntranceProp, updateEntranceWidth, removeWall, addGate, removeRoomLabel, updateRoomLabelProp } from './objects.js';

export function showProperties(id: number): void {
  const obj = state.objects.find(o => o.id === id);
  if (!obj) return;

  const propsPanel = document.getElementById('properties');
  if (!propsPanel) return;

  propsPanel.className = '';
  const colorType = COLORS[obj.type] || COLORS.hala;
  const isPolygon = obj.points && obj.points.length >= 3;

  const connFrom = state.connections.filter(c => c.from === id).map(c => {
    const t = state.objects.find(o => o.id === c.to);
    return t ? t.name : '?';
  });
  const connTo = state.connections.filter(c => c.to === id).map(c => {
    const f = state.objects.find(o => o.id === c.from);
    return f ? f.name : '?';
  });

  const isLocked = !!obj.locked;
  let html = `<h2>${colorType.label}</h2>`;

  // Zámek + Název
  html += `
    <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px;">
      <button class="btn btn-icon ${isLocked ? 'btn-lock-active' : ''}" onclick="window.__module__.toggleLock(${id})" title="${isLocked ? 'Odemknout' : 'Zamknout'}" style="font-size:16px; flex-shrink:0;">
        ${isLocked ? '&#128274;' : '&#128275;'}
      </button>
      <span style="font-size:11px; color:${isLocked ? '#f59e0b' : 'var(--text2)'};">
        ${isLocked ? 'Zamčeno — nelze přesouvat ani editovat' : 'Odemčeno'}
      </span>
    </div>
    <div class="prop-group">
      <label>Název</label>
      <input type="text" value="${obj.name}" onchange="window.__module__.updateProp('name', this.value)" ${isLocked ? 'disabled style="opacity:0.5"' : ''}>
    </div>`;

  if (isPolygon) {
    // Polygon — zobrazit plochu a body
    const area = getPolygonArea(obj.points!);
    const bbox = getPolygonBBox(obj.points!);
    html += `
    <div class="prop-group">
      <label>Plocha</label>
      <input type="text" value="${area.toFixed(1)} m²" disabled style="opacity:0.6">
    </div>
    <div class="prop-row">
      <div class="prop-group">
        <label>Šířka celková</label>
        <input type="text" value="${(bbox.maxX - bbox.minX).toFixed(1)} m" disabled style="opacity:0.6">
      </div>
      <div class="prop-group">
        <label>Výška celková</label>
        <input type="text" value="${(bbox.maxY - bbox.minY).toFixed(1)} m" disabled style="opacity:0.6">
      </div>
    </div>
    <div class="prop-group">
      <label>Rotace</label>
      <div style="margin-bottom:6px;">
        <label style="font-size:10px;color:var(--text2);margin-bottom:2px;display:block;">Střed otáčení</label>
        <select id="rotate-center" style="width:100%;padding:5px 8px;font-size:12px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;outline:none;">
          <option value="-1">Těžiště</option>
          ${obj.points!.map((p, i) => `<option value="${i}">Bod ${i + 1}  (${p.x.toFixed(1)}, ${p.y.toFixed(1)})</option>`).join('')}
        </select>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button class="btn btn-small" onclick="window.__module__.rotatePolygon(${id}, -90, window.__module__.getRotateCenter())" title="−90°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">↺ 90°</button>
        <button class="btn btn-small" onclick="window.__module__.rotatePolygon(${id}, -45, window.__module__.getRotateCenter())" title="−45°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">↺ 45°</button>
        <input type="number" value="0" step="5" id="rotate-custom"
          style="width:60px;padding:4px 6px;font-size:12px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;outline:none;"
          onkeydown="if(event.key==='Enter'){window.__module__.rotatePolygon(${id}, parseFloat(this.value), window.__module__.getRotateCenter());this.value='0';}">
        <span style="font-size:11px;color:var(--text2);">°</span>
        <button class="btn btn-small" onclick="window.__module__.rotatePolygon(${id}, 45, window.__module__.getRotateCenter())" title="+45°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">45° ↻</button>
        <button class="btn btn-small" onclick="window.__module__.rotatePolygon(${id}, 90, window.__module__.getRotateCenter())" title="+90°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">90° ↻</button>
      </div>
    </div>
    <div class="prop-group">
      <label>Body a vzdálenosti</label>
      <div class="vertex-list">
        ${obj.points!.map((p, i) => {
          const j = (i + 1) % obj.points!.length;
          const p2 = obj.points![j];
          const dist = Math.sqrt((p2.x - p.x) ** 2 + (p2.y - p.y) ** 2);
          return `
          <div class="vertex-row">
            <span class="vertex-num">${i + 1}</span>
            <input type="number" value="${p.x.toFixed(1)}" step="0.5"
              onchange="window.__module__.updateVertex(${id}, ${i}, 'x', parseFloat(this.value))">
            <input type="number" value="${p.y.toFixed(1)}" step="0.5"
              onchange="window.__module__.updateVertex(${id}, ${i}, 'y', parseFloat(this.value))">
            ${obj.points!.length > 3 ? `<button class="btn btn-icon btn-small" onclick="window.__module__.removeVertex(${id}, ${i})" title="Odebrat bod">×</button>` : ''}
          </div>
          <div class="edge-dist-row">
            <span class="edge-arrow">${i + 1}→${j + 1}</span>
            <input type="number" value="${dist.toFixed(1)}" step="0.5" min="0.1"
              onchange="window.__module__.updateEdgeDistance(${id}, ${i}, parseFloat(this.value))">
            <span class="edge-unit">m</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;

    // Vjezdy/Výjezdy (jen pro areál a halu)
    if (obj.type === 'areal' || obj.type === 'hala') {
    const entrances = obj.entrances || [];
    html += `
    <div class="prop-group">
      <label>Vjezdy / Výjezdy</label>
      ${entrances.length > 0 ? entrances.map(ent => {
        const eType = ENTRANCE_TYPES[ent.type] || ENTRANCE_TYPES.vjezd;
        // Vypočítat šířku
        const ei = ent.edgeIndex;
        const ej = (ei + 1) % obj.points!.length;
        const ep1 = obj.points![ei], ep2 = obj.points![ej];
        const edgeLen = Math.sqrt((ep2.x - ep1.x) ** 2 + (ep2.y - ep1.y) ** 2);
        const t1 = ent.t1 != null ? ent.t1 : 0.4;
        const t2 = ent.t2 != null ? ent.t2 : 0.6;
        const width = ((t2 - t1) * edgeLen).toFixed(1);
        return `
        <div class="entrance-card">
          <div class="entrance-card-header">
            <span class="entrance-dot" style="background:${eType.color};"></span>
            <input type="text" value="${ent.name}" style="flex:1;padding:4px 6px;font-size:12px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
              onchange="window.__module__.updateEntranceProp(${id}, ${ent.id}, 'name', this.value)">
            <button class="btn btn-danger" onclick="window.__module__.removeEntrance(${id}, ${ent.id})" title="Smazat vjezd" style="padding:4px 8px;font-size:12px;font-weight:600;">✕</button>
          </div>
          <div class="entrance-card-body">
            <div style="display:flex;align-items:center;gap:6px;">
              <label style="font-size:11px;color:var(--text2);white-space:nowrap;margin:0;">Typ:</label>
              <select style="flex:1;padding:3px 6px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.__module__.updateEntranceProp(${id}, ${ent.id}, 'type', this.value)">
                <option value="vjezd" ${ent.type==='vjezd'?'selected':''}>Vjezd</option>
                <option value="vyjezd" ${ent.type==='vyjezd'?'selected':''}>Výjezd</option>
                <option value="oboji" ${ent.type==='oboji'?'selected':''}>Vjezd/Výjezd</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <label style="font-size:11px;color:var(--text2);white-space:nowrap;margin:0;">Šířka:</label>
              <input type="number" value="${width}" step="0.5" min="0.5" style="width:60px;padding:3px 6px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.__module__.updateEntranceWidth(${id}, ${ent.id}, parseFloat(this.value))">
              <span style="font-size:11px;color:var(--text2);">m</span>
            </div>
          </div>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Zatím žádné vjezdy</div>'}
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn" onclick="window.__module__.startEntrancePlacement(${id}, 'vjezd')" style="flex:1;font-size:11px;padding:5px 6px;">+ Vjezd</button>
        <button class="btn" onclick="window.__module__.startEntrancePlacement(${id}, 'vyjezd')" style="flex:1;font-size:11px;padding:5px 6px;">+ Výjezd</button>
      </div>
    </div>`;
    } // konec vjezdy/výjezdy if

    // Stěny a vrata (pro haly)
    if (obj.type === 'hala') {
      const walls = obj.walls || [];
      html += `
      <div class="prop-group">
        <label>Stěny a vrata</label>
        ${walls.length > 0 ? walls.map(wall => {
          const wLen = Math.sqrt((wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2);
          return `
          <div class="wall-row">
            <span style="font-size:12px;font-weight:500;color:var(--text);flex:1;">${wall.name} <span style="color:var(--text2);font-weight:400;">(${wLen.toFixed(1)}m)</span></span>
            <button class="btn btn-small" onclick="window.__module__.startGatePlacement(${id}, ${wall.id})" title="Přidat vrata" style="width:auto!important;padding:0 6px!important;font-size:11px!important;">+ Vrata</button>
            <button class="btn btn-icon btn-small btn-danger" onclick="window.__module__.removeWall(${id}, ${wall.id})" title="Smazat">×</button>
          </div>
          ${wall.gates && wall.gates.length > 0 ? wall.gates.map(gate => `
            <div class="gate-row">
              <span style="font-size:11px;color:#f59e0b;">⊟</span>
              <input type="text" value="${gate.name}" style="flex:1;padding:3px 5px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.__module__.updateGateProp(${id}, ${wall.id}, ${gate.id}, 'name', this.value)">
              <input type="number" value="${gate.width}" step="0.5" min="0.5" style="width:45px;padding:3px 4px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.__module__.updateGateProp(${id}, ${wall.id}, ${gate.id}, 'width', parseFloat(this.value))">
              <span style="font-size:10px;color:var(--text2);">m</span>
              <button class="btn btn-icon btn-small btn-danger" onclick="window.__module__.removeGate(${id}, ${wall.id}, ${gate.id})" title="Odebrat">×</button>
            </div>
          `).join('') : ''}`;
        }).join('') : '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Zatím žádné stěny</div>'}
        <button class="btn" onclick="window.__module__.startWallDrawMode(${id})" style="width:100%;margin-top:6px;font-size:12px;">Kreslit stěnu</button>
      </div>`;

        // Místnosti (room labels)
        const rooms = obj.rooms || [];
        html += `
        <div class="prop-group">
          <label>Místnosti</label>
          ${rooms.length > 0 ? rooms.map(room => `
            <div class="wall-row" style="gap:4px;">
              <span style="font-size:11px;color:#60a5fa;">◻</span>
              <input type="text" value="${room.name}" style="flex:1;padding:3px 5px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.__module__.updateRoomLabelProp(${id}, ${room.id}, 'name', this.value)">
              <button class="btn btn-icon btn-small btn-danger" onclick="window.__module__.removeRoomLabel(${id}, ${room.id})" title="Odebrat">×</button>
            </div>
          `).join('') : '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Zatím žádné místnosti</div>'}
          <button class="btn" onclick="window.__module__.startRoomLabelPlacement(${id})" style="width:100%;margin-top:6px;font-size:12px;">+ Místnost</button>
        </div>`;
    }
  } else {
    // Obdélník — šířka, výška, pozice
    html += `
    <div class="prop-row">
      <div class="prop-group">
        <label>Šířka (m)</label>
        <input type="number" value="${obj.w}" step="0.5" min="0.5" onchange="window.__module__.updateProp('w', parseFloat(this.value))">
      </div>
      <div class="prop-group">
        <label>Výška (m)</label>
        <input type="number" value="${obj.h}" step="0.5" min="0.5" onchange="window.__module__.updateProp('h', parseFloat(this.value))">
      </div>
    </div>
    <div class="prop-row">
      <div class="prop-group">
        <label>Pozice X (m)</label>
        <input type="number" value="${obj.x.toFixed(1)}" step="0.5" onchange="window.__module__.updateProp('x', parseFloat(this.value))">
      </div>
      <div class="prop-group">
        <label>Pozice Y (m)</label>
        <input type="number" value="${obj.y.toFixed(1)}" step="0.5" onchange="window.__module__.updateProp('y', parseFloat(this.value))">
      </div>
    </div>
    <div class="prop-group">
      <label>Plocha</label>
      <input type="text" value="${(obj.w * obj.h).toFixed(1)} m²" disabled style="opacity:0.6">
    </div>
    <div class="prop-group">
      <label>Rotace (°)</label>
      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
        <button class="btn btn-small" onclick="window.__module__.rotateRect(${id}, -90)" title="−90°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">↺ 90°</button>
        <button class="btn btn-small" onclick="window.__module__.rotateRect(${id}, -45)" title="−45°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">↺ 45°</button>
        <input type="number" value="${obj.rotation || 0}" step="5" style="width:60px;padding:4px 6px;font-size:12px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;outline:none;"
          onchange="window.__module__.setRectRotation(${id}, parseFloat(this.value))">
        <span style="font-size:11px;color:var(--text2);">°</span>
        <button class="btn btn-small" onclick="window.__module__.rotateRect(${id}, 45)" title="+45°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">45° ↻</button>
        <button class="btn btn-small" onclick="window.__module__.rotateRect(${id}, 90)" title="+90°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">90° ↻</button>
      </div>
    </div>`;
  }

  // Barva
  html += `
    <div class="prop-group">
      <label>Barva</label>
      <div class="prop-color">
        ${COLOR_SWATCHES.map(c =>
          `<div class="prop-color-swatch ${obj.color === c ? 'active' : ''}" style="background:${c}" onclick="window.__module__.updateColor('${c}')"></div>`
        ).join('')}
      </div>
    </div>`;

  // Návaznosti
  if (connFrom.length || connTo.length) {
    html += `
    <div class="prop-group">
      <label>Návaznosti</label>
      <div style="font-size:12px; color:var(--text2); line-height:1.6;">
        ${connTo.map(n => `<div>← ${n}</div>`).join('')}
        ${connFrom.map(n => `<div>→ ${n}</div>`).join('')}
      </div>
    </div>`;
  }

  // Akce
  html += `
    <div style="margin-top: 20px; display: flex; gap: 6px;">
      <button class="btn" onclick="window.__module__.duplicateObject(${id})" style="flex:1">Duplikovat</button>
      <button class="btn btn-danger" onclick="window.__module__.deleteObject(${id})" style="flex:1" ${isLocked ? 'disabled style="flex:1;opacity:0.4;pointer-events:none;"' : ''}>Smazat</button>
    </div>`;

  propsPanel.innerHTML = html;
}

// ---- Střed rotace z dropdownu ----

export function getRotateCenter(): number {
  const sel = document.getElementById('rotate-center') as HTMLSelectElement | null;
  return sel ? parseInt(sel.value) : -1;
}

// ---- Editace vertexů z properties panelu ----

export function updateVertex(objId: number, index: number, axis: 'x' | 'y', value: number): void {
  (window as any).__module__.updateVertex(objId, index, axis, value);
}

export function updateEdgeDistance(objId: number, fromIndex: number, newDist: number): void {
  (window as any).__module__.updateEdgeDistance(objId, fromIndex, newDist);
}

export function removeVertex(objId: number, index: number): void {
  (window as any).__module__.removeVertex(objId, index);
}

export function updateGateProp(objId: number, wallId: number, gateId: number, key: string, value: any): void {
  (window as any).__module__.updateGateProp(objId, wallId, gateId, key, value);
}

// ---- Zamykání objektů ----

export function toggleLock(objId: number): void {
  (window as any).__module__.toggleLock(objId);
}

export function deselectAll(): void {
  state.selected = null;
  const propsPanel = document.getElementById('properties');
  if (propsPanel) {
    propsPanel.className = 'empty-state';
    propsPanel.innerHTML = '<p>Vyber objekt na plátně<br>nebo přetáhni z palety</p>';
  }
}

// Export stub for updateTitleBar (delegates to window.__module__)
export function updateTitleBar(): void {
  (window as any).__module__?.updateTitleBar?.();
}
