/* ============================================
   renderer.ts — Vykreslování SVG
   ============================================ */

import type { Point, DrawingObject, Entrance } from '../../../shared/types.js';
import { state } from './state.js';
import { COLORS, ENTRANCE_TYPES } from './config.js';

export interface DomElements {
  svg: SVGSVGElement | null;
  container: HTMLElement | null;
  objectLayer: SVGGElement | null;
  connectionLayer: SVGGElement | null;
  snapLayer: SVGGElement | null;
  labelLayer: SVGGElement | null;
  drawLayer: SVGGElement | null;
  gridRect: SVGRectElement | null;
  zoomDisplay: HTMLElement | null;
  coordsDisplay: HTMLElement | null;
  propsPanel: HTMLElement | null;
  fileInput: HTMLInputElement | null;
  ghost: HTMLElement | null;
  drawStatus: HTMLElement | null;
}

export const dom: DomElements = {
  svg: null,
  container: null,
  objectLayer: null,
  connectionLayer: null,
  snapLayer: null,
  labelLayer: null,
  drawLayer: null,
  gridRect: null,
  zoomDisplay: null,
  coordsDisplay: null,
  propsPanel: null,
  fileInput: null,
  ghost: null,
  drawStatus: null,
};

export function initDom(): void {
  dom.svg = document.getElementById('canvas') as unknown as SVGSVGElement;
  dom.container = document.getElementById('canvas-container') as HTMLElement;
  dom.objectLayer = document.getElementById('object-layer') as unknown as SVGGElement;
  dom.connectionLayer = document.getElementById('connection-layer') as unknown as SVGGElement;
  dom.snapLayer = document.getElementById('snap-layer') as unknown as SVGGElement;
  dom.labelLayer = document.getElementById('label-layer') as unknown as SVGGElement;
  dom.drawLayer = document.getElementById('draw-layer') as unknown as SVGGElement;
  dom.gridRect = document.getElementById('grid-rect') as unknown as SVGRectElement;
  dom.zoomDisplay = document.getElementById('zoom-display');
  dom.coordsDisplay = document.getElementById('coords-display');
  dom.propsPanel = document.getElementById('properties');
  dom.fileInput = document.getElementById('file-input') as HTMLInputElement;
  dom.ghost = document.getElementById('drag-ghost');
  dom.drawStatus = document.getElementById('draw-status');
}

// ---- Souřadnicové utility ----

export interface ScreenCoord {
  x: number;
  y: number;
}

export function screenToWorld(sx: number, sy: number): ScreenCoord {
  if (!dom.container) return { x: 0, y: 0 };
  const rect = dom.container.getBoundingClientRect();
  return {
    x: (sx - rect.left - state.panX) / (state.zoom * state.pxPerMeter),
    y: (sy - rect.top - state.panY) / (state.zoom * state.pxPerMeter)
  };
}

export function worldToScreen(wx: number, wy: number): ScreenCoord {
  return {
    x: wx * state.zoom * state.pxPerMeter + state.panX,
    y: wy * state.zoom * state.pxPerMeter + state.panY
  };
}

export function snapToGrid(val: number): number {
  if (!state.snapEnabled) return val;
  return Math.round(val / state.snapSize) * state.snapSize;
}

// ---- Transformace a mřížka ----

export function updateTransform(): void {
  if (!dom.objectLayer || !dom.connectionLayer || !dom.snapLayer || !dom.drawLayer) return;

  const s = state.zoom * state.pxPerMeter;
  const transform = `translate(${state.panX},${state.panY}) scale(${s})`;
  dom.objectLayer.setAttribute('transform', transform);
  dom.connectionLayer.setAttribute('transform', transform);
  dom.snapLayer.setAttribute('transform', transform);
  dom.drawLayer.setAttribute('transform', transform);

  const gs = state.pxPerMeter * state.zoom;
  const gs5 = gs * 5;
  const gridSmall = document.getElementById('grid-small');
  const gridLarge = document.getElementById('grid-large');

  if (gridSmall && gridLarge && dom.gridRect && dom.zoomDisplay) {
    gridSmall.setAttribute('width', String(gs));
    gridSmall.setAttribute('height', String(gs));
    const pathSmall = gridSmall.querySelector('path');
    if (pathSmall) pathSmall.setAttribute('d', `M ${gs} 0 L 0 0 0 ${gs}`);

    gridLarge.setAttribute('width', String(gs5));
    gridLarge.setAttribute('height', String(gs5));
    const rectLarge = gridLarge.querySelector('rect');
    if (rectLarge) {
      rectLarge.setAttribute('width', String(gs5));
      rectLarge.setAttribute('height', String(gs5));
    }
    const pathLarge = gridLarge.querySelector('path');
    if (pathLarge) pathLarge.setAttribute('d', `M ${gs5} 0 L 0 0 0 ${gs5}`);

    dom.gridRect.setAttribute('x', String(-5000 + (state.panX % gs5)));
    dom.gridRect.setAttribute('y', String(-5000 + (state.panY % gs5)));

    dom.zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
    renderLabels();
  }
}

// ---- Hlavní renderování ----

export function renderAll(): void {
  if (!dom.objectLayer || !dom.connectionLayer) return;

  dom.objectLayer.innerHTML = '';
  dom.connectionLayer.innerHTML = '';

  // Nejprve vykreslit areál jako read-only pozadí (ztlumené)
  if (state.arealObjects && state.arealObjects.length > 0) {
    const arealGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    arealGroup.setAttribute('opacity', '0.75');
    arealGroup.style.pointerEvents = 'none';
    state.arealObjects.forEach(obj => {
      renderArealBackgroundObject(arealGroup, obj);
    });
    dom.objectLayer.appendChild(arealGroup);
  }

  renderConnections();
  state.objects.forEach(obj => renderObject(obj));
  updateTransform();
}

function renderArealBackgroundObject(parent: SVGGElement, obj: DrawingObject): void {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.style.pointerEvents = 'none';

  const color = COLORS[obj.type] || COLORS.hala;
  const strokeColor = obj.color || color.stroke;
  const fillColor = obj.fillColor || color.fill;

  if (obj.points && obj.points.length >= 3) {
    const pts = obj.points;
    const poly = svgEl('polygon');
    poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('fill', fillColor);
    poly.setAttribute('stroke', strokeColor);
    poly.setAttribute('stroke-width', '0.3');
    poly.setAttribute('stroke-opacity', '0.9');
    poly.setAttribute('stroke-linejoin', 'round');
    if (obj.type === 'areal') poly.setAttribute('stroke-dasharray', '0.8 0.4');
    g.appendChild(poly);

    const bbox = getPolygonBBox(pts);
    const labelX = bbox.minX + 1.5;
    const labelY = bbox.minY + 2;
    const fontSize = Math.max(0.7, Math.min(1.2, (bbox.maxX - bbox.minX) / 15));
    const text = svgEl('text');
    text.classList.add('obj-label-corner');
    text.setAttribute('x', String(labelX));
    text.setAttribute('y', String(labelY));
    text.setAttribute('font-size', String(fontSize));
    text.textContent = obj.name;
    g.appendChild(text);

    if (obj.entrances && obj.entrances.length > 0) {
      obj.entrances.forEach(ent => renderEntranceMarker(g, obj, ent));
    }
    if (obj.walls && obj.walls.length > 0) {
      obj.walls.forEach(wall => renderWall(g, obj, wall));
    }
  } else {
    const rect = svgEl('rect');
    rect.setAttribute('width', String(obj.w));
    rect.setAttribute('height', String(obj.h));
    rect.setAttribute('rx', obj.type === 'cesta' ? '0.2' : '0.3');
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', '0.3');
    rect.setAttribute('stroke-opacity', '0.9');
    g.appendChild(rect);
    g.setAttribute('transform', `translate(${obj.x},${obj.y})`);
  }

  parent.appendChild(g);
}

function renderObject(obj: DrawingObject): void {
  if (!dom.objectLayer) return;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('obj');
  if (obj.locked) g.classList.add('locked');
  g.setAttribute('data-id', String(obj.id));
  if (state.selected === obj.id) g.classList.add('selected');

  const color = COLORS[obj.type] || COLORS.hala;
  const strokeColor = obj.color || color.stroke;
  const fillColor = obj.fillColor || color.fill;

  if (obj.points && obj.points.length >= 3) {
    renderPolygonObject(g, obj, strokeColor, fillColor);
  } else if (obj.type === 'vstup') {
    renderDiamondObject(g, obj, strokeColor, fillColor);
  } else {
    renderRectangleObject(g, obj, strokeColor, fillColor);
  }

  dom.objectLayer.appendChild(g);
}

function renderDiamondObject(g: SVGGElement, obj: DrawingObject, strokeColor: string, fillColor: string): void {
  const cx = obj.w / 2, cy = obj.h / 2;
  const poly = svgEl('polygon');
  poly.setAttribute('points', `${cx},0 ${obj.w},${cy} ${cx},${obj.h} 0,${cy}`);
  poly.setAttribute('fill', fillColor);
  poly.setAttribute('stroke', strokeColor);
  poly.setAttribute('stroke-width', '0.08');
  poly.setAttribute('stroke-opacity', '0.5');
  g.appendChild(poly);
  addCornerLabels(g, obj);
  const rotV = obj.rotation || 0;
  if (rotV) {
    const cxV = obj.w / 2, cyV = obj.h / 2;
    g.setAttribute('transform', `translate(${obj.x},${obj.y}) rotate(${rotV},${cxV},${cyV})`);
  } else {
    g.setAttribute('transform', `translate(${obj.x},${obj.y})`);
  }
}

function renderRectangleObject(g: SVGGElement, obj: DrawingObject, strokeColor: string, fillColor: string): void {
  const rect = svgEl('rect');
  rect.setAttribute('width', String(obj.w));
  rect.setAttribute('height', String(obj.h));
  rect.setAttribute('rx', obj.type === 'cesta' ? '0.2' : '0.3');
  rect.setAttribute('fill', fillColor);
  rect.setAttribute('stroke', strokeColor);
  rect.setAttribute('stroke-width', '0.08');
  rect.setAttribute('stroke-opacity', '0.5');
  if (obj.type === 'areal') rect.setAttribute('stroke-dasharray', '0.8 0.4');
  g.appendChild(rect);
  addCornerLabels(g, obj);

  const rot = obj.rotation || 0;
  if (rot) {
    const cx = obj.w / 2, cy = obj.h / 2;
    g.setAttribute('transform', `translate(${obj.x},${obj.y}) rotate(${rot},${cx},${cy})`);
  } else {
    g.setAttribute('transform', `translate(${obj.x},${obj.y})`);
  }

  // Lock icon pro obdélníky
  if (obj.locked) {
    const lockIcon = svgEl('text');
    lockIcon.setAttribute('x', String(obj.w - 1.2));
    lockIcon.setAttribute('y', '1.2');
    lockIcon.setAttribute('font-size', '0.8');
    lockIcon.setAttribute('fill', '#f59e0b');
    lockIcon.setAttribute('opacity', '0.7');
    lockIcon.setAttribute('text-anchor', 'end');
    lockIcon.textContent = '\u{1F512}';
    g.appendChild(lockIcon);
  }

  // Resize handle (ne pro zamčené)
  if (state.selected === obj.id && !obj.locked) {
    const s = 0.4;
    const rh = svgEl('polygon');
    rh.classList.add('resize-handle');
    rh.setAttribute('points', `${obj.w},${obj.h - s} ${obj.w},${obj.h} ${obj.w - s},${obj.h}`);
    rh.setAttribute('fill', '#fff');
    rh.setAttribute('stroke', 'var(--accent)');
    rh.setAttribute('stroke-width', '0.05');
    rh.style.cursor = 'nwse-resize';
    rh.setAttribute('data-action', 'resize');
    g.appendChild(rh);
  }
}

function renderPolygonObject(g: SVGGElement, obj: DrawingObject, strokeColor: string, fillColor: string): void {
  if (!obj.points) return;

  const pts = obj.points;
  const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');

  const poly = svgEl('polygon');
  poly.setAttribute('points', pointsStr);
  poly.setAttribute('fill', fillColor);
  poly.setAttribute('stroke', strokeColor);
  poly.setAttribute('stroke-width', '0.08');
  poly.setAttribute('stroke-opacity', '0.6');
  poly.setAttribute('stroke-linejoin', 'round');
  if (obj.type === 'areal') poly.setAttribute('stroke-dasharray', '0.8 0.4');
  g.appendChild(poly);

  const bbox = getPolygonBBox(pts);
  const labelX = bbox.minX + 1.5;
  const labelY = bbox.minY + 2;
  const fontSize = Math.max(0.7, Math.min(1.2, (bbox.maxX - bbox.minX) / 15));

  const text = svgEl('text');
  text.classList.add('obj-label-corner');
  text.setAttribute('x', String(labelX));
  text.setAttribute('y', String(labelY));
  text.setAttribute('font-size', String(fontSize));
  text.textContent = obj.name;
  g.appendChild(text);

  const area = getPolygonArea(pts);
  const dim = svgEl('text');
  dim.classList.add('obj-dim-corner');
  dim.setAttribute('x', String(labelX));
  dim.setAttribute('y', String(labelY + fontSize * 1.2));
  dim.setAttribute('font-size', String(fontSize * 0.7));
  dim.textContent = `${area.toFixed(0)} m²`;
  g.appendChild(dim);

  // Ikona zámku
  if (obj.locked) {
    const lockIcon = svgEl('text');
    lockIcon.classList.add('lock-icon');
    lockIcon.setAttribute('x', String(labelX + fontSize * (obj.name.length * 0.5 + 1)));
    lockIcon.setAttribute('y', String(labelY));
    lockIcon.setAttribute('font-size', String(fontSize * 0.9));
    lockIcon.setAttribute('fill', '#f59e0b');
    lockIcon.setAttribute('opacity', '0.7');
    lockIcon.setAttribute('dominant-baseline', 'auto');
    lockIcon.textContent = '\u{1F512}';
    g.appendChild(lockIcon);
  }

  // Vertex handles + edge distances
  if (state.selected === obj.id && !obj.locked) {
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const p1 = pts[i], p2 = pts[j];
      const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;

      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const offset = 1.2;

      const edgeFontSize = Math.max(0.55, Math.min(0.8, dist / 12));
      const bg = svgEl('rect');
      const textW = dist >= 10 ? edgeFontSize * 3.2 : edgeFontSize * 2.4;
      const textH = edgeFontSize * 1.4;
      bg.setAttribute('x', String(mx + nx * offset - textW / 2));
      bg.setAttribute('y', String(my + ny * offset - textH * 0.7));
      bg.setAttribute('width', String(textW));
      bg.setAttribute('height', String(textH));
      bg.setAttribute('rx', '0.2');
      bg.setAttribute('fill', 'rgba(30,30,46,0.85)');
      bg.setAttribute('stroke', strokeColor);
      bg.setAttribute('stroke-width', '0.04');
      bg.setAttribute('stroke-opacity', '0.4');
      g.appendChild(bg);

      const edgeLabel = svgEl('text');
      edgeLabel.classList.add('edge-dist-label');
      edgeLabel.setAttribute('x', String(mx + nx * offset));
      edgeLabel.setAttribute('y', String(my + ny * offset));
      edgeLabel.setAttribute('font-size', String(edgeFontSize));
      edgeLabel.setAttribute('text-anchor', 'middle');
      edgeLabel.setAttribute('dominant-baseline', 'middle');
      edgeLabel.textContent = dist.toFixed(1) + 'm';
      g.appendChild(edgeLabel);
    }

    pts.forEach((p, i) => {
      const rotHandle = svgEl('circle');
      rotHandle.classList.add('rotate-handle');
      rotHandle.setAttribute('cx', String(p.x));
      rotHandle.setAttribute('cy', String(p.y));
      rotHandle.setAttribute('r', '1.2');
      rotHandle.setAttribute('data-action', 'rotate-vertex');
      rotHandle.setAttribute('data-vertex-index', String(i));
      g.appendChild(rotHandle);

      const handle = svgEl('circle');
      handle.classList.add('vertex-handle');
      handle.setAttribute('cx', String(p.x));
      handle.setAttribute('cy', String(p.y));
      handle.setAttribute('r', '0.5');
      handle.setAttribute('data-action', 'move-vertex');
      handle.setAttribute('data-vertex-index', String(i));
      g.appendChild(handle);

      const icon = svgEl('text');
      icon.classList.add('rotate-icon');
      icon.setAttribute('x', String(p.x + 1.0));
      icon.setAttribute('y', String(p.y - 1.0));
      icon.setAttribute('font-size', '0.9');
      icon.setAttribute('text-anchor', 'middle');
      icon.setAttribute('dominant-baseline', 'middle');
      icon.setAttribute('fill', '#f59e0b');
      icon.setAttribute('opacity', '0');
      icon.setAttribute('pointer-events', 'none');
      icon.textContent = '↻';
      g.appendChild(icon);
    });
  }

  // Vjezdy/Výjezdy
  if (obj.entrances && obj.entrances.length > 0) {
    obj.entrances.forEach(ent => {
      renderEntranceMarker(g, obj, ent);
    });
  }

  // Stěny a vrata
  if (obj.walls && obj.walls.length > 0) {
    obj.walls.forEach(wall => {
      renderWall(g, obj, wall);
    });
  }

  // Popisky místností
  if (obj.rooms && obj.rooms.length > 0) {
    obj.rooms.forEach(room => {
      renderRoomLabel(g, obj, room);
    });
  }

  g.setAttribute('transform', '');
}

function renderRoomLabel(g: SVGGElement, obj: DrawingObject, room: any): void {
  const textWidth = room.name.length * 0.45;
  const textHeight = 1.0;

  const hitArea = svgEl('rect');
  hitArea.setAttribute('x', String(room.x - 0.2));
  hitArea.setAttribute('y', String(room.y - 0.2));
  hitArea.setAttribute('width', String(textWidth + 0.4));
  hitArea.setAttribute('height', String(textHeight + 0.4));
  hitArea.setAttribute('fill', 'transparent');
  hitArea.setAttribute('cursor', 'grab');
  hitArea.setAttribute('data-action', 'drag-room-label');
  hitArea.setAttribute('data-obj-id', String(obj.id));
  hitArea.setAttribute('data-room-id', String(room.id));
  g.appendChild(hitArea);

  const label = svgEl('text');
  label.setAttribute('x', String(room.x));
  label.setAttribute('y', String(room.y));
  label.setAttribute('font-size', '0.8');
  label.setAttribute('fill', '#94a3b8');
  label.setAttribute('font-family', "'Segoe UI', sans-serif");
  label.setAttribute('font-weight', '400');
  label.setAttribute('text-anchor', 'start');
  label.setAttribute('dominant-baseline', 'hanging');
  label.setAttribute('opacity', '0.7');
  label.setAttribute('pointer-events', 'none');
  label.textContent = room.name;
  g.appendChild(label);

  const underline = svgEl('line');
  underline.setAttribute('x1', String(room.x));
  underline.setAttribute('y1', String(room.y + textHeight));
  underline.setAttribute('x2', String(room.x + textWidth));
  underline.setAttribute('y2', String(room.y + textHeight));
  underline.setAttribute('stroke', '#60a5fa');
  underline.setAttribute('stroke-width', '0.06');
  underline.setAttribute('opacity', '0.4');
  underline.setAttribute('pointer-events', 'none');
  g.appendChild(underline);
}

function renderEntranceMarker(g: SVGGElement, obj: DrawingObject, entrance: Entrance): void {
  if (!obj.points) return;

  const pts = obj.points;
  const i = entrance.edgeIndex;
  if (i < 0 || i >= pts.length) return;
  const j = (i + 1) % pts.length;
  const p1 = pts[i], p2 = pts[j];

  const t1 = entrance.t1 != null ? entrance.t1 : 0.4;
  const t2 = entrance.t2 != null ? entrance.t2 : 0.6;

  const x1 = p1.x + t1 * (p2.x - p1.x);
  const y1 = p1.y + t1 * (p2.y - p1.y);
  const x2 = p1.x + t2 * (p2.x - p1.x);
  const y2 = p1.y + t2 * (p2.y - p1.y);

  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  const edx = p2.x - p1.x;
  const edy = p2.y - p1.y;
  const elen = Math.sqrt(edx * edx + edy * edy) || 1;
  const ex = edx / elen;
  const ey = edy / elen;
  let nx = -ey;
  let ny = ex;

  let centX = 0, centY = 0;
  for (let k = 0; k < pts.length; k++) { centX += pts[k].x; centY += pts[k].y; }
  centX /= pts.length; centY /= pts.length;

  const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
  const toCentX = centX - midX, toCentY = centY - midY;
  if (nx * toCentX + ny * toCentY > 0) {
    nx = -nx; ny = -ny;
  }

  const eType = ENTRANCE_TYPES[entrance.type] || ENTRANCE_TYPES.vjezd;
  const color = eType.color;

  const gate = svgEl('line');
  gate.setAttribute('x1', String(x1));
  gate.setAttribute('y1', String(y1));
  gate.setAttribute('x2', String(x2));
  gate.setAttribute('y2', String(y2));
  gate.setAttribute('stroke', color);
  gate.setAttribute('stroke-width', '0.35');
  gate.setAttribute('stroke-linecap', 'round');
  g.appendChild(gate);

  [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(pt => {
    const dot = svgEl('circle');
    dot.setAttribute('cx', String(pt.x));
    dot.setAttribute('cy', String(pt.y));
    dot.setAttribute('r', '0.35');
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', '0.08');
    g.appendChild(dot);
  });

  const arrowLen = 2.0;
  const arrowW = 0.6;
  const isBoth = entrance.type === 'oboji';
  const tangentOffset = isBoth ? 1.2 : 0;

  if (entrance.type === 'vjezd' || isBoth) {
    const acx = cx - ex * tangentOffset;
    const acy = cy - ey * tangentOffset;
    const tipX = acx - nx * 0.3;
    const tipY = acy - ny * 0.3;
    const baseX = acx + nx * arrowLen;
    const baseY = acy + ny * arrowLen;
    const arrow = svgEl('polygon');
    arrow.setAttribute('points',
      `${tipX},${tipY} ${baseX + ex * arrowW},${baseY + ey * arrowW} ${baseX - ex * arrowW},${baseY - ey * arrowW}`
    );
    arrow.setAttribute('fill', '#22c55e');
    arrow.setAttribute('opacity', '0.85');
    g.appendChild(arrow);
  }

  if (entrance.type === 'vyjezd' || isBoth) {
    const acx = cx + ex * tangentOffset;
    const acy = cy + ey * tangentOffset;
    const tipX = acx + nx * (arrowLen + 0.3);
    const tipY = acy + ny * (arrowLen + 0.3);
    const baseX = acx;
    const baseY = acy;
    const arrow = svgEl('polygon');
    arrow.setAttribute('points',
      `${tipX},${tipY} ${baseX + ex * arrowW},${baseY + ey * arrowW} ${baseX - ex * arrowW},${baseY - ey * arrowW}`
    );
    arrow.setAttribute('fill', '#ef4444');
    arrow.setAttribute('opacity', '0.85');
    g.appendChild(arrow);
  }

  const labelOffset = arrowLen + 1.8;
  const labelX = cx + nx * labelOffset;
  const labelY = cy + ny * labelOffset;
  const label = svgEl('text');
  label.classList.add('entrance-label');
  label.setAttribute('x', String(labelX));
  label.setAttribute('y', String(labelY));
  label.setAttribute('font-size', '0.65');
  label.setAttribute('fill', color);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'middle');
  label.setAttribute('font-weight', '500');
  label.textContent = entrance.name;
  g.appendChild(label);
}

function renderWall(g: SVGGElement, obj: DrawingObject, wall: any): void {
  const wx1 = wall.x1, wy1 = wall.y1;
  const wx2 = wall.x2, wy2 = wall.y2;
  const dx = wx2 - wx1, dy = wy2 - wy1;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  if (wallLen < 0.01) return;
  const ex = dx / wallLen, ey = dy / wallLen;

  const gates = (wall.gates || []).slice().sort((a: any, b: any) => a.t - b.t);

  let segments: any[] = [];
  let lastT = 0;
  gates.forEach((gate: any) => {
    const halfW = (gate.width / 2) / wallLen;
    const gStart = Math.max(0, gate.t - halfW);
    const gEnd = Math.min(1, gate.t + halfW);
    if (gStart > lastT) {
      segments.push({ t1: lastT, t2: gStart });
    }
    lastT = gEnd;
  });
  if (lastT < 1) {
    segments.push({ t1: lastT, t2: 1 });
  }

  segments.forEach(seg => {
    const line = svgEl('line');
    line.setAttribute('x1', String(wx1 + seg.t1 * dx));
    line.setAttribute('y1', String(wy1 + seg.t1 * dy));
    line.setAttribute('x2', String(wx1 + seg.t2 * dx));
    line.setAttribute('y2', String(wy1 + seg.t2 * dy));
    line.setAttribute('stroke', '#a0a0c0');
    line.setAttribute('stroke-width', '0.2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.8');
    g.appendChild(line);
  });

  gates.forEach((gate: any) => {
    const halfW = (gate.width / 2) / wallLen;
    const gStart = Math.max(0, gate.t - halfW);
    const gEnd = Math.min(1, gate.t + halfW);

    const gx1 = wx1 + gStart * dx;
    const gy1 = wy1 + gStart * dy;
    const gx2 = wx1 + gEnd * dx;
    const gy2 = wy1 + gEnd * dy;

    [{ x: gx1, y: gy1 }, { x: gx2, y: gy2 }].forEach(pt => {
      const dot = svgEl('circle');
      dot.setAttribute('cx', String(pt.x));
      dot.setAttribute('cy', String(pt.y));
      dot.setAttribute('r', '0.25');
      dot.setAttribute('fill', '#f59e0b');
      dot.setAttribute('stroke', '#fff');
      dot.setAttribute('stroke-width', '0.06');
      g.appendChild(dot);
    });

    const gmx = (gx1 + gx2) / 2;
    const gmy = (gy1 + gy2) / 2;
    const nx = -ey, ny = ex;
    const arcR = gate.width / 2;

    const arcPath = svgEl('path');
    arcPath.setAttribute('d', `M ${gx1} ${gy1} A ${arcR} ${arcR} 0 0 1 ${gx2} ${gy2}`);
    arcPath.setAttribute('fill', 'none');
    arcPath.setAttribute('stroke', '#f59e0b');
    arcPath.setAttribute('stroke-width', '0.08');
    arcPath.setAttribute('stroke-dasharray', '0.3 0.2');
    arcPath.setAttribute('opacity', '0.6');
    g.appendChild(arcPath);
  });
}

// ---- Spojení ----

function renderConnections(): void {
  if (!dom.connectionLayer) return;

  dom.connectionLayer.innerHTML = '';
  state.connections.forEach(conn => {
    const from = state.objects.find(o => o.id === conn.from);
    const to = state.objects.find(o => o.id === conn.to);
    if (!from || !to) return;

    const c1 = getObjectCenter(from);
    const c2 = getObjectCenter(to);

    const line = svgEl('line');
    line.classList.add('connection-line');
    line.setAttribute('x1', String(c1.x));
    line.setAttribute('y1', String(c1.y));
    line.setAttribute('x2', String(c2.x));
    line.setAttribute('y2', String(c2.y));
    dom.connectionLayer!.appendChild(line);

    const angle = Math.atan2(c2.y - c1.y, c2.x - c1.x);
    const arrowSize = 1.2;
    const ax = c2.x - Math.cos(angle) * 2;
    const ay = c2.y - Math.sin(angle) * 2;
    const arrow = svgEl('polygon');
    const p2x = ax - arrowSize * Math.cos(angle - 0.4);
    const p2y = ay - arrowSize * Math.sin(angle - 0.4);
    const p3x = ax - arrowSize * Math.cos(angle + 0.4);
    const p3y = ay - arrowSize * Math.sin(angle + 0.4);
    arrow.setAttribute('points', `${ax},${ay} ${p2x},${p2y} ${p3x},${p3y}`);
    arrow.setAttribute('fill', '#4ecdc4');
    arrow.setAttribute('opacity', '0.7');
    dom.connectionLayer!.appendChild(arrow);
  });
}

function renderLabels(): void {
  if (!dom.labelLayer) return;

  dom.labelLayer.innerHTML = '';
  const s = state.zoom * state.pxPerMeter;
  const step = state.zoom > 0.5 ? 5 : (state.zoom > 0.2 ? 10 : 25);

  for (let m = 0; m <= 200; m += step) {
    const px = m * s + state.panX;
    const py = m * s + state.panY;
    if (dom.container && px > 0 && px < dom.container.clientWidth) {
      const lbl = svgEl('text');
      lbl.classList.add('grid-label');
      lbl.setAttribute('x', String(px));
      lbl.setAttribute('y', '14');
      lbl.textContent = m + 'm';
      dom.labelLayer!.appendChild(lbl);
    }
    if (dom.container && py > 20 && py < dom.container.clientHeight) {
      const lbl = svgEl('text');
      lbl.classList.add('grid-label');
      lbl.setAttribute('x', '4');
      lbl.setAttribute('y', String(py + 4));
      lbl.textContent = m + 'm';
      dom.labelLayer!.appendChild(lbl);
    }
  }
}

// ---- Pomocné funkce ----

export function svgEl(tag: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function addCornerLabels(g: SVGGElement, obj: DrawingObject): void {
  const clipId = 'clip-obj-' + obj.id;
  const defs = document.querySelector('#canvas defs');
  if (!defs) return;

  const oldClip = document.getElementById(clipId);
  if (oldClip) oldClip.remove();

  const clipPath = svgEl('clipPath');
  clipPath.setAttribute('id', clipId);
  const clipRect = svgEl('rect');
  const pad = 0.15;
  clipRect.setAttribute('x', String(pad));
  clipRect.setAttribute('y', String(pad));
  clipRect.setAttribute('width', String(Math.max(0.3, obj.w - pad * 2)));
  clipRect.setAttribute('height', String(Math.max(0.3, obj.h - pad * 2)));
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);

  const labelGroup = svgEl('g');
  labelGroup.setAttribute('clip-path', `url(#${clipId})`);

  const padding = 0.2;
  const availW = obj.w - padding * 2;
  const availH = obj.h - padding * 2;
  const nameLen = (obj.name || '').length || 1;
  const fontByW = availW / (nameLen * 0.55);
  const fontByH = availH / 3;
  const fontSize = Math.max(0.25, Math.min(0.75, fontByW, fontByH));

  let displayName = obj.name || '';
  const maxChars = Math.floor(availW / (fontSize * 0.55));
  if (displayName.length > maxChars && maxChars > 2) {
    displayName = displayName.substring(0, maxChars - 1) + '…';
  } else if (maxChars <= 2 && displayName.length > 2) {
    displayName = displayName.substring(0, 2);
  }

  const text = svgEl('text');
  text.classList.add('obj-label-corner');
  text.setAttribute('x', String(padding));
  text.setAttribute('y', String(padding + fontSize));
  text.setAttribute('font-size', String(fontSize));
  text.textContent = displayName;
  labelGroup.appendChild(text);

  const dimFontSize = fontSize * 0.6;
  if (availH >= fontSize + dimFontSize * 1.5) {
    const dim = svgEl('text');
    dim.classList.add('obj-dim-corner');
    dim.setAttribute('x', String(padding));
    dim.setAttribute('y', String(padding + fontSize + dimFontSize * 1.3));
    dim.setAttribute('font-size', String(dimFontSize));
    dim.textContent = `${obj.w.toFixed(1)}×${obj.h.toFixed(1)} m`;
    labelGroup.appendChild(dim);
  }

  g.appendChild(labelGroup);
}

export function getObjectCenter(obj: DrawingObject): Point {
  if (obj.points && obj.points.length >= 3) {
    return getPolygonCentroid(obj.points);
  }
  return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
}

export function getPolygonCentroid(pts: Point[]): Point {
  let cx = 0, cy = 0;
  pts.forEach(p => { cx += p.x; cy += p.y; });
  return { x: cx / pts.length, y: cy / pts.length };
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getPolygonBBox(pts: Point[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  return { minX, minY, maxX, maxY };
}

export function getPolygonArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

export function getPolygonSignedArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

export function showToast(message: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast!.classList.remove('show'), 2500);
}

export function resizeSVG(): void {
  if (!dom.svg || !dom.container) return;

  const w = dom.container.clientWidth || dom.container.offsetWidth || 800;
  const h = dom.container.clientHeight || dom.container.offsetHeight || 600;
  if (w > 0 && h > 0) {
    dom.svg.setAttribute('width', String(w));
    dom.svg.setAttribute('height', String(h));
  }
  if (isNaN(state.panX)) state.panX = 40;
  if (isNaN(state.panY)) state.panY = 40;
  if (isNaN(state.zoom) || state.zoom <= 0) state.zoom = 1;
  updateTransform();
}
