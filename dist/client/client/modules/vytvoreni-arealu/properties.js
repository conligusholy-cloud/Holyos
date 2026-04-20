/* ============================================
   properties.ts — Panel vlastností
   ============================================ */
import { state } from './state.js';
import { COLORS, COLOR_SWATCHES, ENTRANCE_TYPES } from './config.js';
import { getPolygonArea, getPolygonBBox, renderAll, snapToGrid } from './renderer.js';
import { pushUndo } from './history.js';
export function showProperties(id) {
    const obj = state.objects.find(o => o.id === id);
    if (!obj)
        return;
    const propsPanel = document.getElementById('properties');
    if (!propsPanel)
        return;
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
      <button class="btn btn-icon ${isLocked ? 'btn-lock-active' : ''}" onclick="window.editorAPI.toggleLock(${id})" title="${isLocked ? 'Odemknout' : 'Zamknout'}" style="font-size:16px; flex-shrink:0;">
        ${isLocked ? '&#128274;' : '&#128275;'}
      </button>
      <span style="font-size:11px; color:${isLocked ? '#f59e0b' : 'var(--text2)'};">
        ${isLocked ? 'Zamčeno — nelze přesouvat ani editovat' : 'Odemčeno'}
      </span>
    </div>
    <div class="prop-group">
      <label>Název</label>
      <input type="text" value="${obj.name}" onchange="window.editorAPI.updateProp('name', this.value)" ${isLocked ? 'disabled style="opacity:0.5"' : ''}>
    </div>`;
    if (isPolygon) {
        // Polygon — zobrazit plochu a body
        const area = getPolygonArea(obj.points);
        const bbox = getPolygonBBox(obj.points);
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
          ${obj.points.map((p, i) => `<option value="${i}">Bod ${i + 1}  (${p.x.toFixed(1)}, ${p.y.toFixed(1)})</option>`).join('')}
        </select>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button class="btn btn-small" onclick="window.editorAPI.rotatePolygon(${id}, -90, window.editorAPI.getRotateCenter())" title="−90°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">↺ 90°</button>
        <button class="btn btn-small" onclick="window.editorAPI.rotatePolygon(${id}, -45, window.editorAPI.getRotateCenter())" title="−45°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">↺ 45°</button>
        <input type="number" value="0" step="5" id="rotate-custom"
          style="width:60px;padding:4px 6px;font-size:12px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;outline:none;"
          onkeydown="if(event.key==='Enter'){window.editorAPI.rotatePolygon(${id}, parseFloat(this.value), window.editorAPI.getRotateCenter());this.value='0';}">
        <span style="font-size:11px;color:var(--text2);">°</span>
        <button class="btn btn-small" onclick="window.editorAPI.rotatePolygon(${id}, 45, window.editorAPI.getRotateCenter())" title="+45°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">45° ↻</button>
        <button class="btn btn-small" onclick="window.editorAPI.rotatePolygon(${id}, 90, window.editorAPI.getRotateCenter())" title="+90°" style="width:auto!important;padding:0 8px!important;font-size:13px!important;">90° ↻</button>
      </div>
    </div>
    <div class="prop-group">
      <label>Body a vzdálenosti</label>
      <div class="vertex-list">
        ${obj.points.map((p, i) => {
            const j = (i + 1) % obj.points.length;
            const p2 = obj.points[j];
            const dist = Math.sqrt((p2.x - p.x) ** 2 + (p2.y - p.y) ** 2);
            return `
          <div class="vertex-row">
            <span class="vertex-num">${i + 1}</span>
            <input type="number" value="${p.x.toFixed(1)}" step="0.5"
              onchange="window.editorAPI.updateVertex(${id}, ${i}, 'x', parseFloat(this.value))">
            <input type="number" value="${p.y.toFixed(1)}" step="0.5"
              onchange="window.editorAPI.updateVertex(${id}, ${i}, 'y', parseFloat(this.value))">
            ${obj.points.length > 3 ? `<button class="btn btn-icon btn-small" onclick="window.editorAPI.removeVertex(${id}, ${i})" title="Odebrat bod">×</button>` : ''}
          </div>
          <div class="edge-dist-row">
            <span class="edge-arrow">${i + 1}→${j + 1}</span>
            <input type="number" value="${dist.toFixed(1)}" step="0.5" min="0.1"
              onchange="window.editorAPI.updateEdgeDistance(${id}, ${i}, parseFloat(this.value))">
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
                // Vypočítat šířku — buď z obvodu polygonu, nebo z vnitřní stěny
                let edgeLen = 0;
                if (ent.wallId != null && obj.walls) {
                    const wall = obj.walls.find(w => w.id === ent.wallId);
                    if (wall) {
                        edgeLen = Math.sqrt((wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2);
                    }
                }
                else if (obj.points && ent.edgeIndex >= 0 && ent.edgeIndex < obj.points.length) {
                    const ei = ent.edgeIndex;
                    const ej = (ei + 1) % obj.points.length;
                    const ep1 = obj.points[ei], ep2 = obj.points[ej];
                    edgeLen = Math.sqrt((ep2.x - ep1.x) ** 2 + (ep2.y - ep1.y) ** 2);
                }
                const t1 = ent.t1 != null ? ent.t1 : 0.4;
                const t2 = ent.t2 != null ? ent.t2 : 0.6;
                const width = ((t2 - t1) * edgeLen).toFixed(1);
                return `
        <div class="entrance-card">
          <div class="entrance-card-header">
            <span class="entrance-dot" style="background:${eType.color};"></span>
            <input type="text" value="${ent.name}" style="flex:1;padding:4px 6px;font-size:12px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
              onchange="window.editorAPI.updateEntranceProp(${id}, ${ent.id}, 'name', this.value)">
            <button class="btn btn-danger" onclick="window.editorAPI.removeEntrance(${id}, ${ent.id})" title="Smazat vjezd" style="padding:4px 8px;font-size:12px;font-weight:600;">✕</button>
          </div>
          <div class="entrance-card-body">
            <div style="display:flex;align-items:center;gap:6px;">
              <label style="font-size:11px;color:var(--text2);white-space:nowrap;margin:0;">Typ:</label>
              <select style="flex:1;padding:3px 6px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.editorAPI.updateEntranceProp(${id}, ${ent.id}, 'type', this.value)">
                <option value="vjezd" ${ent.type === 'vjezd' ? 'selected' : ''}>Vjezd</option>
                <option value="vyjezd" ${ent.type === 'vyjezd' ? 'selected' : ''}>Výjezd</option>
                <option value="oboji" ${ent.type === 'oboji' ? 'selected' : ''}>Vjezd/Výjezd</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <label style="font-size:11px;color:var(--text2);white-space:nowrap;margin:0;">Šířka:</label>
              <input type="number" value="${width}" step="0.5" min="0.5" style="width:60px;padding:3px 6px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.editorAPI.updateEntranceWidth(${id}, ${ent.id}, parseFloat(this.value))">
              <span style="font-size:11px;color:var(--text2);">m</span>
            </div>
          </div>
        </div>`;
            }).join('') : '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Zatím žádné vjezdy</div>'}
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn" onclick="window.editorAPI.startEntrancePlacement(${id}, 'vjezd')" style="flex:1;font-size:11px;padding:5px 6px;">+ Vjezd</button>
        <button class="btn" onclick="window.editorAPI.startEntrancePlacement(${id}, 'vyjezd')" style="flex:1;font-size:11px;padding:5px 6px;">+ Výjezd</button>
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
                const wAngle = (Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1) * 180 / Math.PI);
                const expandedId = `wall-expanded-${wall.id}`;
                const wLocked = !!wall.locked;
                const isHighlighted = state.highlightedWallId === wall.id;
                const rowStyle = [
                    wLocked ? 'opacity:0.85;' : '',
                    isHighlighted ? 'background:rgba(245,158,11,0.18);border:1px solid #f59e0b;border-radius:6px;padding:4px 6px;margin:2px 0;' : '',
                ].join('');
                return `
          <div class="wall-row" data-wall-id="${wall.id}" style="${rowStyle}">
            <input type="text" value="${wall.name}" ${wLocked ? 'disabled' : ''} style="flex:1;padding:3px 6px;font-size:12px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;${wLocked ? 'opacity:0.6;' : ''}"
              onchange="window.editorAPI.updateWallName(${id}, ${wall.id}, this.value)">
            <span style="color:var(--text2);font-weight:400;font-size:11px;white-space:nowrap;">(${wLen.toFixed(1)}m)</span>
            <button class="btn btn-small" onclick="window.editorAPI.toggleRoomLocked(${id}, ${wall.id})" title="${wLocked ? 'Odemknout místnost' : 'Zamknout místnost'}" style="width:auto!important;padding:0 6px!important;font-size:12px!important;${wLocked ? 'background:rgba(245,158,11,0.2);color:#f59e0b;border-color:rgba(245,158,11,0.4);' : ''}">${wLocked ? '🔒' : '🔓'}</button>
            <button class="btn btn-small" onclick="document.getElementById('${expandedId}').style.display = document.getElementById('${expandedId}').style.display === 'none' ? 'block' : 'none'" title="Upravit" style="width:auto!important;padding:0 6px!important;font-size:11px!important;">⚙</button>
            <button class="btn btn-small" onclick="window.editorAPI.startGatePlacement(${id}, ${wall.id})" title="Přidat vrata" ${wLocked ? 'disabled' : ''} style="width:auto!important;padding:0 6px!important;font-size:11px!important;${wLocked ? 'opacity:0.4;pointer-events:none;' : ''}">+ Vrata</button>
            <button class="btn btn-icon btn-small btn-danger" onclick="window.editorAPI.removeWall(${id}, ${wall.id})" title="${wLocked ? 'Zamčeno' : 'Smazat'}" ${wLocked ? 'disabled' : ''} style="${wLocked ? 'opacity:0.4;pointer-events:none;' : ''}">×</button>
          </div>
          <div id="${expandedId}" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin:4px 0 8px;font-size:12px;${wLocked ? 'opacity:0.6;pointer-events:none;' : ''}">
            ${wLocked ? '<div style="color:#f59e0b;font-size:11px;margin-bottom:6px;">🔒 Místnost je zamčená — odemkni pro úpravy</div>' : ''}
            <div style="display:grid;grid-template-columns:70px 1fr 20px;gap:8px 8px;align-items:center;margin-bottom:8px;">
              <label style="color:var(--text2);">Délka:</label>
              <input type="number" value="${wLen.toFixed(2)}" step="0.1" min="0.1" ${wLocked ? 'disabled' : ''} style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;font-size:12px;min-width:0;width:100%;"
                onchange="window.editorAPI.updateWallLength(${id}, ${wall.id}, parseFloat(this.value))">
              <span style="color:var(--text2);font-size:11px;">m</span>

              <label style="color:var(--text2);">Úhel:</label>
              <input type="number" value="${wAngle.toFixed(1)}" step="0.5" ${wLocked ? 'disabled' : ''} style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;font-size:12px;min-width:0;width:100%;"
                onchange="window.editorAPI.updateWallAngle(${id}, ${wall.id}, parseFloat(this.value))">
              <span style="color:var(--text2);font-size:11px;">°</span>

              <label style="color:var(--text2);">Start X:</label>
              <input type="number" value="${wall.x1.toFixed(2)}" step="0.1" ${wLocked ? 'disabled' : ''} style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;font-size:12px;min-width:0;width:100%;"
                onchange="window.editorAPI.updateWallPoint(${id}, ${wall.id}, 'start', 'x', parseFloat(this.value))">
              <span style="color:var(--text2);font-size:11px;">m</span>

              <label style="color:var(--text2);">Start Y:</label>
              <input type="number" value="${wall.y1.toFixed(2)}" step="0.1" ${wLocked ? 'disabled' : ''} style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;font-size:12px;min-width:0;width:100%;"
                onchange="window.editorAPI.updateWallPoint(${id}, ${wall.id}, 'start', 'y', parseFloat(this.value))">
              <span style="color:var(--text2);font-size:11px;">m</span>

              <label style="color:var(--text2);">Konec X:</label>
              <input type="number" value="${wall.x2.toFixed(2)}" step="0.1" ${wLocked ? 'disabled' : ''} style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;font-size:12px;min-width:0;width:100%;"
                onchange="window.editorAPI.updateWallPoint(${id}, ${wall.id}, 'end', 'x', parseFloat(this.value))">
              <span style="color:var(--text2);font-size:11px;">m</span>

              <label style="color:var(--text2);">Konec Y:</label>
              <input type="number" value="${wall.y2.toFixed(2)}" step="0.1" ${wLocked ? 'disabled' : ''} style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;font-size:12px;min-width:0;width:100%;"
                onchange="window.editorAPI.updateWallPoint(${id}, ${wall.id}, 'end', 'y', parseFloat(this.value))">
              <span style="color:var(--text2);font-size:11px;">m</span>

              <label style="color:var(--text2);">Od rohu:</label>
              <input type="number" value="0" step="0.1" min="0" placeholder="m" ${wLocked ? 'disabled' : ''} style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;font-size:12px;min-width:0;width:100%;"
                onchange="window.editorAPI.updateWallDistFromCorner(${id}, ${wall.id}, parseFloat(this.value))">
              <span style="color:var(--text2);font-size:11px;">m</span>
            </div>
            <div style="border-top:1px dashed var(--border);padding-top:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <span style="color:var(--text2);font-size:10px;line-height:1.3;">„Od rohu" posune celou propojenou místnost po hraně haly.</span>
              <button class="btn btn-small" onclick="window.editorAPI.snapWallPerpendicular(${id}, ${wall.id})" ${wLocked ? 'disabled' : ''} style="font-size:11px;padding:4px 10px;white-space:nowrap;flex-shrink:0;">⊥ Kolmo k hraně</button>
            </div>
            <div style="border-top:1px dashed var(--border);padding-top:8px;margin-top:8px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
              <span style="color:var(--text2);font-size:10px;flex-shrink:0;">Do stěny přidat:</span>
              <button class="btn btn-small" onclick="window.editorAPI.startEntrancePlacement(${id}, 'vjezd')" ${wLocked ? 'disabled' : ''} style="font-size:11px;padding:3px 8px;background:rgba(34,197,94,0.15);color:#22c55e;border-color:rgba(34,197,94,0.3);">→ Vjezd</button>
              <button class="btn btn-small" onclick="window.editorAPI.startEntrancePlacement(${id}, 'vyjezd')" ${wLocked ? 'disabled' : ''} style="font-size:11px;padding:3px 8px;background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.3);">← Výjezd</button>
              <button class="btn btn-small" onclick="window.editorAPI.startEntrancePlacement(${id}, 'oboji')" ${wLocked ? 'disabled' : ''} style="font-size:11px;padding:3px 8px;background:rgba(245,158,11,0.15);color:#f59e0b;border-color:rgba(245,158,11,0.3);">↔ Obojí</button>
            </div>
          </div>
          ${wall.gates && wall.gates.length > 0 ? wall.gates.map(gate => `
            <div class="gate-row">
              <span style="font-size:11px;color:#f59e0b;">⊟</span>
              <input type="text" value="${gate.name}" style="flex:1;padding:3px 5px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.editorAPI.updateGateProp(${id}, ${wall.id}, ${gate.id}, 'name', this.value)">
              <input type="number" value="${gate.width}" step="0.5" min="0.5" style="width:45px;padding:3px 4px;font-size:11px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;"
                onchange="window.editorAPI.updateGateProp(${id}, ${wall.id}, ${gate.id}, 'width', parseFloat(this.value))">
              <span style="font-size:10px;color:var(--text2);">m</span>
              <button class="btn btn-icon btn-small btn-danger" onclick="window.editorAPI.removeGate(${id}, ${wall.id}, ${gate.id})" title="Odebrat">×</button>
            </div>
          `).join('') : ''}`;
            }).join('') : '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Zatím žádné stěny — v levém panelu klikni na <b>Stěna</b> a veď čáru 2× klikem na plátno. Potom si ji tady upřesníš.</div>'}
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
              onchange="window.editorAPI.updateRoomLabelProp(${id}, ${room.id}, 'name', this.value)">
            <button class="btn btn-icon btn-small btn-danger" onclick="window.editorAPI.removeRoomLabel(${id}, ${room.id})" title="Odebrat">×</button>
          </div>
        `).join('') : '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Zatím žádné místnosti</div>'}
        <button class="btn" onclick="window.editorAPI.startRoomLabelPlacement(${id})" style="width:100%;margin-top:6px;font-size:12px;">+ Místnost</button>
      </div>`;
        }
    }
    else {
        // Obdélník — šířka, výška, pozice
        html += `
    <div class="prop-row">
      <div class="prop-group">
        <label>Šířka (m)</label>
        <input type="number" value="${obj.w}" step="0.5" min="0.5" onchange="window.editorAPI.updateProp('w', parseFloat(this.value))">
      </div>
      <div class="prop-group">
        <label>Výška (m)</label>
        <input type="number" value="${obj.h}" step="0.5" min="0.5" onchange="window.editorAPI.updateProp('h', parseFloat(this.value))">
      </div>
    </div>
    <div class="prop-row">
      <div class="prop-group">
        <label>Pozice X (m)</label>
        <input type="number" value="${obj.x.toFixed(1)}" step="0.5" onchange="window.editorAPI.updateProp('x', parseFloat(this.value))">
      </div>
      <div class="prop-group">
        <label>Pozice Y (m)</label>
        <input type="number" value="${obj.y.toFixed(1)}" step="0.5" onchange="window.editorAPI.updateProp('y', parseFloat(this.value))">
      </div>
    </div>
    <div class="prop-group">
      <label>Plocha</label>
      <input type="text" value="${(obj.w * obj.h).toFixed(1)} m²" disabled style="opacity:0.6">
    </div>`;
    }
    // Barva
    html += `
    <div class="prop-group">
      <label>Barva</label>
      <div class="prop-color">
        ${COLOR_SWATCHES.map(c => `<div class="prop-color-swatch ${obj.color === c ? 'active' : ''}" style="background:${c}" onclick="window.editorAPI.updateColor('${c}')"></div>`).join('')}
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
      <button class="btn" onclick="window.editorAPI.duplicateObject(${id})" style="flex:1">Duplikovat</button>
      <button class="btn btn-danger" onclick="window.editorAPI.deleteObject(${id})" style="flex:1" ${isLocked ? 'disabled style="flex:1;opacity:0.4;pointer-events:none;"' : ''}>Smazat</button>
    </div>`;
    propsPanel.innerHTML = html;
    // Auto-scroll + auto-rozbalení detailů pro zvýrazněnou stěnu
    const hlId = state.highlightedWallId;
    if (hlId != null) {
        setTimeout(() => {
            const row = propsPanel.querySelector(`[data-wall-id="${hlId}"]`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const expanded = document.getElementById(`wall-expanded-${hlId}`);
                if (expanded)
                    expanded.style.display = 'block';
            }
        }, 30);
    }
}
// ---- Střed rotace z dropdownu ----
export function getRotateCenter() {
    const sel = document.getElementById('rotate-center');
    return sel ? parseInt(sel.value) : -1;
}
// ---- Editace vertexů z properties panelu ----
export function updateVertex(objId, index, axis, value) {
    pushUndo();
    const obj = state.objects.find(o => o.id === objId);
    if (!obj || !obj.points || !obj.points[index])
        return;
    obj.points[index][axis] = value;
    const bbox = getPolygonBBox(obj.points);
    obj.x = bbox.minX;
    obj.y = bbox.minY;
    obj.w = bbox.maxX - bbox.minX;
    obj.h = bbox.maxY - bbox.minY;
    renderAll();
}
export function updateEdgeDistance(objId, fromIndex, newDist) {
    pushUndo();
    const obj = state.objects.find(o => o.id === objId);
    if (!obj || !obj.points)
        return;
    if (newDist < 0.1)
        newDist = 0.1;
    const pts = obj.points;
    const toIndex = (fromIndex + 1) % pts.length;
    const p1 = pts[fromIndex];
    const p2 = pts[toIndex];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const currentDist = Math.sqrt(dx * dx + dy * dy);
    if (currentDist < 0.001)
        return;
    const scale = newDist / currentDist;
    pts[toIndex].x = p1.x + dx * scale;
    pts[toIndex].y = p1.y + dy * scale;
    pts[toIndex].x = snapToGrid(pts[toIndex].x);
    pts[toIndex].y = snapToGrid(pts[toIndex].y);
    const bbox = getPolygonBBox(pts);
    obj.x = bbox.minX;
    obj.y = bbox.minY;
    obj.w = bbox.maxX - bbox.minX;
    obj.h = bbox.maxY - bbox.minY;
    renderAll();
    showProperties(objId);
}
export function removeVertex(objId, index) {
    pushUndo();
    const obj = state.objects.find(o => o.id === objId);
    if (!obj || !obj.points || obj.points.length <= 3)
        return;
    obj.points.splice(index, 1);
    const bbox = getPolygonBBox(obj.points);
    obj.x = bbox.minX;
    obj.y = bbox.minY;
    obj.w = bbox.maxX - bbox.minX;
    obj.h = bbox.maxY - bbox.minY;
    renderAll();
    showProperties(objId);
}
export function updateGateProp(objId, wallId, gateId, key, value) {
    pushUndo();
    const obj = state.objects.find(o => o.id === objId);
    if (!obj || !obj.walls)
        return;
    const wall = obj.walls.find(w => w.id === wallId);
    if (!wall)
        return;
    const gate = wall.gates.find(g => g.id === gateId);
    if (!gate)
        return;
    gate[key] = value;
    renderAll();
    showProperties(objId);
}
// ---- Zamykání objektů ----
export function toggleLock(objId) {
    pushUndo();
    const obj = state.objects.find(o => o.id === objId);
    if (!obj)
        return;
    obj.locked = !obj.locked;
    renderAll();
    showProperties(objId);
}
export function deselectAll() {
    state.selected = null;
    renderAll();
    const propsPanel = document.getElementById('properties');
    if (propsPanel) {
        propsPanel.className = 'empty-state';
        propsPanel.innerHTML = '<p>Vyber objekt na plátně<br>nebo přetáhni z palety</p>';
    }
}
//# sourceMappingURL=properties.js.map