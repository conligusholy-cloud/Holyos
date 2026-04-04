/* ============================================
   renderer.ts — Vykreslování SVG (simulace)
   ============================================ */
import { state } from './state.js';
let dom = {
    svg: null,
    container: null,
    objectLayer: null,
    connectionLayer: null,
    animationLayer: null,
    gridRect: null,
    zoomDisplay: null,
    coordsDisplay: null,
};
export function initDom() {
    dom = {
        svg: document.getElementById('canvas'),
        container: document.getElementById('canvas-container'),
        objectLayer: document.getElementById('object-layer'),
        connectionLayer: document.getElementById('connection-layer'),
        animationLayer: document.getElementById('animation-layer'),
        gridRect: document.getElementById('grid-rect'),
        zoomDisplay: document.getElementById('zoom-display'),
        coordsDisplay: document.getElementById('coords-display'),
    };
}
function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}
export function screenToWorld(sx, sy) {
    if (!dom.container)
        return { x: 0, y: 0 };
    const rect = dom.container.getBoundingClientRect();
    return {
        x: (sx - rect.left - state.panX) / (state.zoom * state.pxPerMeter),
        y: (sy - rect.top - state.panY) / (state.zoom * state.pxPerMeter)
    };
}
export function worldToScreen(wx, wy) {
    return {
        x: wx * state.zoom * state.pxPerMeter + state.panX,
        y: wy * state.zoom * state.pxPerMeter + state.panY
    };
}
// ---- COLORS (shared) ----
const COLORS = {
    areal: { fill: 'rgba(139,92,246,0.1)', stroke: '#8b5cf6', label: 'Areál' },
    hala: { fill: 'rgba(59,130,246,0.15)', stroke: '#3b82f6', label: 'Hala' },
    pracoviste: { fill: 'rgba(245,158,11,0.2)', stroke: '#f59e0b', label: 'Pracoviště' },
    sklad: { fill: 'rgba(16,185,129,0.15)', stroke: '#10b981', label: 'Sklad' },
    cesta: { fill: 'rgba(16,185,129,0.1)', stroke: '#10b981', label: 'Cesta' },
    vstup: { fill: 'rgba(108,140,255,0.2)', stroke: '#6c8cff', label: 'Vstup/Výstup' },
};
// ---- Transform & Grid ----
export function updateTransform() {
    if (!dom.objectLayer || !dom.connectionLayer || !dom.animationLayer)
        return;
    const s = state.zoom * state.pxPerMeter;
    const transform = `translate(${state.panX},${state.panY}) scale(${s})`;
    dom.objectLayer.setAttribute('transform', transform);
    dom.connectionLayer.setAttribute('transform', transform);
    dom.animationLayer.setAttribute('transform', transform);
    const gs = state.pxPerMeter * state.zoom;
    const gs5 = gs * 5;
    const gridSmall = document.getElementById('grid-small');
    const gridLarge = document.getElementById('grid-large');
    if (gridSmall && gridLarge) {
        gridSmall.setAttribute('width', String(gs));
        gridSmall.setAttribute('height', String(gs));
        const gridPath = gridSmall.querySelector('path');
        if (gridPath)
            gridPath.setAttribute('d', `M ${gs} 0 L 0 0 0 ${gs}`);
        gridLarge.setAttribute('width', String(gs5));
        gridLarge.setAttribute('height', String(gs5));
        const gridRect = gridLarge.querySelector('rect');
        if (gridRect) {
            gridRect.setAttribute('width', String(gs5));
            gridRect.setAttribute('height', String(gs5));
        }
        const gridPathLarge = gridLarge.querySelector('path');
        if (gridPathLarge)
            gridPathLarge.setAttribute('d', `M ${gs5} 0 L 0 0 0 ${gs5}`);
        if (dom.gridRect) {
            dom.gridRect.setAttribute('x', String(-5000 + (state.panX % gs5)));
            dom.gridRect.setAttribute('y', String(-5000 + (state.panY % gs5)));
        }
    }
    if (dom.zoomDisplay) {
        dom.zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
    }
}
// ---- Main render ----
export function renderAll() {
    if (!dom.objectLayer || !dom.connectionLayer)
        return;
    dom.objectLayer.innerHTML = '';
    dom.connectionLayer.innerHTML = '';
    // Areál pozadí
    if (state.arealObjects && state.arealObjects.length > 0) {
        const arealGroup = svgEl('g');
        arealGroup.setAttribute('opacity', '0.45');
        arealGroup.style.pointerEvents = 'none';
        state.arealObjects.forEach(obj => renderBackgroundObject(arealGroup, obj));
        dom.objectLayer.appendChild(arealGroup);
    }
    // Spojení
    renderConnections();
    // Objekty (pracoviště atd.)
    state.objects.forEach(obj => renderObject(obj));
    // Trasa — zobrazit cestu pokud je definovaná
    renderRoutePath();
    updateTransform();
}
function renderBackgroundObject(parent, obj) {
    const g = svgEl('g');
    g.style.pointerEvents = 'none';
    const color = COLORS[obj.type] || COLORS.hala;
    const strokeColor = obj.color || color.stroke;
    const fillColor = obj.fillColor || color.fill;
    if (obj.points && obj.points.length >= 3) {
        const poly = svgEl('polygon');
        poly.setAttribute('points', obj.points.map(p => `${p.x},${p.y}`).join(' '));
        poly.setAttribute('fill', fillColor);
        poly.setAttribute('stroke', strokeColor);
        poly.setAttribute('stroke-width', '0.08');
        poly.setAttribute('stroke-opacity', '0.5');
        poly.setAttribute('stroke-linejoin', 'round');
        if (obj.type === 'areal')
            poly.setAttribute('stroke-dasharray', '0.8 0.4');
        g.appendChild(poly);
        // Label
        const bbox = getPolygonBBox(obj.points);
        const fontSize = Math.max(0.7, Math.min(1.2, (bbox.maxX - bbox.minX) / 15));
        const text = svgEl('text');
        text.classList.add('obj-label-corner');
        text.setAttribute('x', String(bbox.minX + 1.5));
        text.setAttribute('y', String(bbox.minY + 2));
        text.setAttribute('font-size', String(fontSize));
        text.textContent = obj.name;
        g.appendChild(text);
        // Entrances
        if (obj.entrances)
            obj.entrances.forEach(ent => renderEntranceSimple(g, obj, ent));
        // Walls
        if (obj.walls)
            obj.walls.forEach(wall => renderWallSimple(g, wall));
    }
    else {
        const rect = svgEl('rect');
        rect.setAttribute('width', String(obj.w));
        rect.setAttribute('height', String(obj.h));
        rect.setAttribute('rx', '0.3');
        rect.setAttribute('fill', fillColor);
        rect.setAttribute('stroke', strokeColor);
        rect.setAttribute('stroke-width', '0.08');
        rect.setAttribute('stroke-opacity', '0.4');
        g.appendChild(rect);
        g.setAttribute('transform', `translate(${obj.x},${obj.y})`);
    }
    parent.appendChild(g);
}
function renderObject(obj) {
    if (!dom.objectLayer)
        return;
    const g = svgEl('g');
    g.classList.add('obj');
    g.setAttribute('data-id', String(obj.id));
    const color = COLORS[obj.type] || COLORS.hala;
    const strokeColor = obj.color || color.stroke;
    const fillColor = obj.fillColor || color.fill;
    if (obj.points && obj.points.length >= 3) {
        const poly = svgEl('polygon');
        poly.setAttribute('points', obj.points.map(p => `${p.x},${p.y}`).join(' '));
        poly.setAttribute('fill', fillColor);
        poly.setAttribute('stroke', strokeColor);
        poly.setAttribute('stroke-width', '0.08');
        poly.setAttribute('stroke-opacity', '0.6');
        poly.setAttribute('stroke-linejoin', 'round');
        g.appendChild(poly);
    }
    else if (obj.type === 'vstup') {
        const cx = obj.w / 2, cy = obj.h / 2;
        const poly = svgEl('polygon');
        poly.setAttribute('points', `${cx},0 ${obj.w},${cy} ${cx},${obj.h} 0,${cy}`);
        poly.setAttribute('fill', fillColor);
        poly.setAttribute('stroke', strokeColor);
        poly.setAttribute('stroke-width', '0.08');
        g.appendChild(poly);
        addLabel(g, obj);
        const rot = obj.rotation || 0;
        g.setAttribute('transform', rot ? `translate(${obj.x},${obj.y}) rotate(${rot},${obj.w / 2},${obj.h / 2})` : `translate(${obj.x},${obj.y})`);
    }
    else {
        const rect = svgEl('rect');
        rect.setAttribute('width', String(obj.w));
        rect.setAttribute('height', String(obj.h));
        rect.setAttribute('rx', '0.3');
        rect.setAttribute('fill', fillColor);
        rect.setAttribute('stroke', strokeColor);
        rect.setAttribute('stroke-width', '0.08');
        rect.setAttribute('stroke-opacity', '0.5');
        g.appendChild(rect);
        addLabel(g, obj);
        const rot = obj.rotation || 0;
        g.setAttribute('transform', rot ? `translate(${obj.x},${obj.y}) rotate(${rot},${obj.w / 2},${obj.h / 2})` : `translate(${obj.x},${obj.y})`);
    }
    dom.objectLayer.appendChild(g);
}
function addLabel(g, obj) {
    const padding = 0.2;
    const availW = obj.w - padding * 2;
    const nameLen = (obj.name || '').length || 1;
    const fontByW = availW / (nameLen * 0.55);
    const fontByH = (obj.h - padding * 2) / 3;
    const fontSize = Math.max(0.25, Math.min(0.75, fontByW, fontByH));
    let displayName = obj.name || '';
    const maxChars = Math.floor(availW / (fontSize * 0.55));
    if (displayName.length > maxChars && maxChars > 2) {
        displayName = displayName.substring(0, maxChars - 1) + '…';
    }
    const text = svgEl('text');
    text.classList.add('obj-label-corner');
    text.setAttribute('x', String(padding));
    text.setAttribute('y', String(padding + fontSize));
    text.setAttribute('font-size', String(fontSize));
    text.textContent = displayName;
    g.appendChild(text);
}
function renderConnections() {
    if (!state.connections || !dom.connectionLayer)
        return;
    state.connections.forEach(conn => {
        const from = state.objects.find(o => o.id === conn.from);
        const to = state.objects.find(o => o.id === conn.to);
        if (!from || !to)
            return;
        const fc = getObjectCenter(from);
        const tc = getObjectCenter(to);
        const line = svgEl('line');
        line.setAttribute('x1', String(fc.x));
        line.setAttribute('y1', String(fc.y));
        line.setAttribute('x2', String(tc.x));
        line.setAttribute('y2', String(tc.y));
        line.setAttribute('stroke', 'rgba(108,140,255,0.4)');
        line.setAttribute('stroke-width', '0.12');
        line.setAttribute('stroke-dasharray', '0.5 0.3');
        dom.connectionLayer.appendChild(line);
    });
}
// ---- Route path ----
function renderRoutePath() {
    if (!state.route || state.route.length < 2 || !dom.objectLayer)
        return;
    const mappedOps = state.route.filter(op => op.floorX != null);
    if (mappedOps.length < 2)
        return;
    for (let i = 0; i < mappedOps.length - 1; i++) {
        const from = mappedOps[i];
        const to = mappedOps[i + 1];
        // Šipka
        const line = svgEl('line');
        line.setAttribute('x1', String(from.floorX));
        line.setAttribute('y1', String(from.floorY));
        line.setAttribute('x2', String(to.floorX));
        line.setAttribute('y2', String(to.floorY));
        line.setAttribute('stroke', '#f59e0b');
        line.setAttribute('stroke-width', '0.15');
        line.setAttribute('stroke-dasharray', '0.6 0.3');
        line.setAttribute('stroke-opacity', '0.6');
        line.setAttribute('marker-end', 'url(#arrow-marker)');
        dom.objectLayer.appendChild(line);
    }
    // Přidat arrow marker do defs pokud neexistuje
    if (dom.svg && !document.getElementById('arrow-marker')) {
        let defs = dom.svg.querySelector('defs');
        if (!defs) {
            defs = svgEl('defs');
            dom.svg.appendChild(defs);
        }
        const marker = svgEl('marker');
        marker.setAttribute('id', 'arrow-marker');
        marker.setAttribute('markerWidth', '3');
        marker.setAttribute('markerHeight', '3');
        marker.setAttribute('refX', '3');
        marker.setAttribute('refY', '1.5');
        marker.setAttribute('orient', 'auto');
        const path = svgEl('path');
        path.setAttribute('d', 'M0,0 L3,1.5 L0,3 Z');
        path.setAttribute('fill', '#f59e0b');
        path.setAttribute('fill-opacity', '0.6');
        marker.appendChild(path);
        defs.appendChild(marker);
    }
}
// ---- Animation tokens ----
export function renderTokens() {
    if (!dom.animationLayer)
        return;
    dom.animationLayer.innerHTML = '';
    state.tokens.forEach(token => {
        if (token.state === 'done' && !token.visible)
            return;
        const g = svgEl('g');
        g.setAttribute('transform', `translate(${token.x},${token.y})`);
        // Kruh
        const circle = svgEl('circle');
        circle.setAttribute('cx', '0');
        circle.setAttribute('cy', '0');
        circle.setAttribute('r', '0.5');
        if (token.state === 'processing') {
            circle.setAttribute('fill', '#22c55e');
            circle.setAttribute('stroke', '#fff');
        }
        else if (token.state === 'moving') {
            circle.setAttribute('fill', '#6c8cff');
            circle.setAttribute('stroke', '#fff');
        }
        else if (token.state === 'waiting') {
            circle.setAttribute('fill', '#f59e0b');
            circle.setAttribute('stroke', '#fff');
        }
        else {
            circle.setAttribute('fill', '#10b981');
            circle.setAttribute('stroke', '#fff');
        }
        circle.setAttribute('stroke-width', '0.08');
        g.appendChild(circle);
        // Číslo tokenu
        if (state.simBatchSize > 1) {
            const label = svgEl('text');
            label.setAttribute('x', '0');
            label.setAttribute('y', '0.15');
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            label.setAttribute('font-size', '0.4');
            label.setAttribute('fill', '#fff');
            label.setAttribute('font-weight', '600');
            label.textContent = String(token.id);
            g.appendChild(label);
        }
        // Pulsace pro processing
        if (token.state === 'processing') {
            const pulse = svgEl('circle');
            pulse.setAttribute('cx', '0');
            pulse.setAttribute('cy', '0');
            pulse.setAttribute('r', '0.7');
            pulse.setAttribute('fill', 'none');
            pulse.setAttribute('stroke', '#22c55e');
            pulse.setAttribute('stroke-width', '0.05');
            pulse.setAttribute('opacity', '0.5');
            const anim = svgEl('animate');
            anim.setAttribute('attributeName', 'r');
            anim.setAttribute('from', '0.5');
            anim.setAttribute('to', '1.2');
            anim.setAttribute('dur', '1s');
            anim.setAttribute('repeatCount', 'indefinite');
            pulse.appendChild(anim);
            const anim2 = svgEl('animate');
            anim2.setAttribute('attributeName', 'opacity');
            anim2.setAttribute('from', '0.5');
            anim2.setAttribute('to', '0');
            anim2.setAttribute('dur', '1s');
            anim2.setAttribute('repeatCount', 'indefinite');
            pulse.appendChild(anim2);
            g.appendChild(pulse);
        }
        dom.animationLayer.appendChild(g);
    });
}
// Highlight pracoviště kde probíhá operace
export function highlightStation(obj, active) {
    const gEl = dom.objectLayer?.querySelector(`[data-id="${obj.id}"]`);
    if (!gEl)
        return;
    const rect = gEl.querySelector('rect') || gEl.querySelector('polygon');
    if (!rect)
        return;
    if (active) {
        rect.setAttribute('stroke', '#22c55e');
        rect.setAttribute('stroke-width', '0.2');
        rect.setAttribute('stroke-opacity', '1');
    }
    else {
        const color = COLORS[obj.type] || COLORS.pracoviste;
        rect.setAttribute('stroke', obj.color || color.stroke);
        rect.setAttribute('stroke-width', '0.08');
        rect.setAttribute('stroke-opacity', '0.5');
    }
}
// ---- Helpers ----
function getObjectCenter(obj) {
    if (obj.points && obj.points.length >= 3) {
        let cx = 0, cy = 0;
        obj.points.forEach(p => { cx += p.x; cy += p.y; });
        return { x: cx / obj.points.length, y: cy / obj.points.length };
    }
    return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
}
function getPolygonBBox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });
    return { minX, minY, maxX, maxY };
}
function renderEntranceSimple(g, obj, ent) {
    if (!obj.points)
        return;
    const i = ent.edgeIndex;
    if (i < 0 || i >= obj.points.length)
        return;
    const j = (i + 1) % obj.points.length;
    const p1 = obj.points[i], p2 = obj.points[j];
    const t1 = ent.t1 || 0.4, t2 = ent.t2 || 0.6;
    const x1 = p1.x + t1 * (p2.x - p1.x), y1 = p1.y + t1 * (p2.y - p1.y);
    const x2 = p1.x + t2 * (p2.x - p1.x), y2 = p1.y + t2 * (p2.y - p1.y);
    const line = svgEl('line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    const eColor = ent.type === 'vyjezd' ? '#ef4444' : ent.type === 'oboji' ? '#f59e0b' : '#22c55e';
    line.setAttribute('stroke', eColor);
    line.setAttribute('stroke-width', '0.3');
    line.setAttribute('stroke-linecap', 'round');
    g.appendChild(line);
}
function renderWallSimple(g, wall) {
    const line = svgEl('line');
    line.setAttribute('x1', String(wall.x1));
    line.setAttribute('y1', String(wall.y1));
    line.setAttribute('x2', String(wall.x2));
    line.setAttribute('y2', String(wall.y2));
    line.setAttribute('stroke', 'rgba(255,255,255,0.3)');
    line.setAttribute('stroke-width', '0.15');
    g.appendChild(line);
}
// ---- Resize & Zoom ----
export function resizeSVG() {
    if (!dom.container || !dom.svg)
        return;
    const w = dom.container.clientWidth || 800;
    const h = dom.container.clientHeight || 600;
    dom.svg.setAttribute('width', String(w));
    dom.svg.setAttribute('height', String(h));
}
export function zoomFit() {
    const allObjects = [...(state.arealObjects || []), ...(state.objects || [])];
    if (allObjects.length === 0)
        return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allObjects.forEach(o => {
        if (o.points && o.points.length >= 3) {
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
    if (!isFinite(minX) || !dom.container)
        return;
    const cw = dom.container.clientWidth || 800;
    const ch = dom.container.clientHeight || 600;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    if (worldW < 0.1 || worldH < 0.1)
        return;
    const padding = 40;
    const scaleX = (cw - padding * 2) / (worldW * state.pxPerMeter);
    const scaleY = (ch - padding * 2) / (worldH * state.pxPerMeter);
    state.zoom = Math.min(scaleX, scaleY, 5);
    state.panX = padding - minX * state.zoom * state.pxPerMeter + (cw - padding * 2 - worldW * state.zoom * state.pxPerMeter) / 2;
    state.panY = padding - minY * state.zoom * state.pxPerMeter + (ch - padding * 2 - worldH * state.zoom * state.pxPerMeter) / 2;
    updateTransform();
}
//# sourceMappingURL=renderer.js.map