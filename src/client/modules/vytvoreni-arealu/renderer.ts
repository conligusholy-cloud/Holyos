/* ============================================
   renderer.ts — Vykreslování SVG
   ============================================ */

import type { DrawingObject, Point, Entrance, Wall, Gate, RoomLabel } from '../../../shared/types.js';
import { state } from './state.js';
import { COLORS, ENTRANCE_TYPES } from './config.js';
import { findNearestArealEdge } from './objects.js';

export interface DomElements {
  svg: SVGSVGElement | null;
  container: HTMLElement | null;
  objectLayer: SVGGElement | null;
  connectionLayer: SVGGElement | null;
  snapLayer: SVGGElement | null;
  labelLayer: SVGGElement | null;
  drawLayer: SVGGElement | null;
  gridRect: SVGElement | null;
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
  dom.gridRect = document.getElementById('grid-rect') as unknown as SVGElement;
  dom.zoomDisplay = document.getElementById('zoom-display') as HTMLElement;
  dom.coordsDisplay = document.getElementById('coords-display') as HTMLElement;
  dom.propsPanel = document.getElementById('properties') as HTMLElement;
  dom.fileInput = document.getElementById('file-input') as HTMLInputElement;
  dom.ghost = document.getElementById('drag-ghost') as HTMLElement;
  dom.drawStatus = document.getElementById('draw-status') as HTMLElement;
}

// ---- Souřadnicové utility ----

export function screenToWorld(sx: number, sy: number): Point {
  const rect = dom.container!.getBoundingClientRect();
  return {
    x: (sx - rect.left - state.panX) / (state.zoom * state.pxPerMeter),
    y: (sy - rect.top - state.panY) / (state.zoom * state.pxPerMeter)
  };
}

export function worldToScreen(wx: number, wy: number): Point {
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
  const s = state.zoom * state.pxPerMeter;
  const transform = `translate(${state.panX},${state.panY}) scale(${s})`;
  dom.objectLayer!.setAttribute('transform', transform);
  dom.connectionLayer!.setAttribute('transform', transform);
  dom.snapLayer!.setAttribute('transform', transform);
  dom.drawLayer!.setAttribute('transform', transform);

  const gs = state.pxPerMeter * state.zoom;
  const gs5 = gs * 5;
  const gridSmall = document.getElementById('grid-small') as unknown as SVGElement;
  const gridLarge = document.getElementById('grid-large') as unknown as SVGElement;
  gridSmall.setAttribute('width', gs.toString());
  gridSmall.setAttribute('height', gs.toString());
  const gridSmallPath = gridSmall.querySelector('path') as SVGPathElement;
  gridSmallPath.setAttribute('d', `M ${gs} 0 L 0 0 0 ${gs}`);
  gridLarge.setAttribute('width', gs5.toString());
  gridLarge.setAttribute('height', gs5.toString());
  const gridLargeRect = gridLarge.querySelector('rect') as SVGRectElement;
  gridLargeRect.setAttribute('width', gs5.toString());
  gridLargeRect.setAttribute('height', gs5.toString());
  const gridLargePath = gridLarge.querySelector('path') as SVGPathElement;
  gridLargePath.setAttribute('d', `M ${gs5} 0 L 0 0 0 ${gs5}`);

  dom.gridRect!.setAttribute('x', (-5000 + (state.panX % gs5)).toString());
  dom.gridRect!.setAttribute('y', (-5000 + (state.panY % gs5)).toString());

  if (dom.zoomDisplay) {
    dom.zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
  }
  renderLabels();
}

// ---- Hlavní renderování ----

export function renderAll(): void {
  dom.objectLayer!.innerHTML = '';
  dom.connectionLayer!.innerHTML = '';
  renderConnections();
  state.objects.forEach(obj => renderObject(obj));
  updateTransform();
}

function renderObject(obj: DrawingObject): void {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('obj');
  if (obj.locked) g.classList.add('locked');
  (g as any).dataset.id = obj.id;
  if (state.selected === obj.id) g.classList.add('selected');

  const color = COLORS[obj.type] || COLORS.hala;
  const strokeColor = obj.color || color.stroke;
  const fillColor = obj.fillColor || color.fill;

  if (obj.points && obj.points.length >= 3) {
    // ---- POLYGON ----
    renderPolygonObject(g, obj, strokeColor, fillColor);
  } else if (obj.type === 'vstup') {
    // ---- DIAMOND ----
    const cx = obj.w / 2, cy = obj.h / 2;
    const poly = svgEl('polygon');
    poly.setAttribute('points', `${cx},0 ${obj.w},${cy} ${cx},${obj.h} 0,${cy}`);
    poly.setAttribute('fill', fillColor);
    poly.setAttribute('stroke', strokeColor);
    poly.setAttribute('stroke-width', '0.08');
    poly.setAttribute('stroke-opacity', '0.5');
    g.appendChild(poly);
    addCornerLabels(g, obj);
    g.setAttribute('transform', `translate(${obj.x},${obj.y})`);
  } else {
    // ---- RECTANGLE ----
    const rect = svgEl('rect');
    rect.setAttribute('width', obj.w.toString());
    rect.setAttribute('height', obj.h.toString());
    rect.setAttribute('rx', obj.type === 'cesta' ? '0.2' : '0.3');
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', '0.08');
    rect.setAttribute('stroke-opacity', '0.5');
    if (obj.type === 'areal') rect.setAttribute('stroke-dasharray', '0.8 0.4');
    g.appendChild(rect);
    addCornerLabels(g, obj);
    g.setAttribute('transform', `translate(${obj.x},${obj.y})`);

    // Lock icon pro obdélníky
    if (obj.locked) {
      const lockIcon = svgEl('text');
      lockIcon.setAttribute('x', (obj.w - 1.2).toString());
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
      const rh = svgEl('rect');
      rh.classList.add('resize-handle');
      rh.setAttribute('x', (obj.w - 0.5).toString());
      rh.setAttribute('y', (obj.h - 0.5).toString());
      rh.setAttribute('width', '1');
      rh.setAttribute('height', '1');
      rh.setAttribute('rx', '0.15');
      (rh as any).dataset.action = 'resize';
      g.appendChild(rh);
    }
  }

  dom.objectLayer!.appendChild(g);
}

function renderPolygonObject(g: SVGGElement, obj: DrawingObject, strokeColor: string, fillColor: string): void {
  const pts = obj.points!;
  const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');

  const poly = svgEl('polygon');
  poly.setAttribute('points', pointsStr);
  poly.setAttribute('fill', fillColor);
  poly.setAttribute('stroke', strokeColor);
  // Hala má silnější a sytější obvod (aby měla vizuální přednost před vnitřními stěnami)
  if (obj.type === 'hala') {
    poly.setAttribute('stroke-width', '0.35');
    poly.setAttribute('stroke-opacity', '1');
  } else {
    poly.setAttribute('stroke-width', '0.08');
    poly.setAttribute('stroke-opacity', '0.6');
  }
  poly.setAttribute('stroke-linejoin', 'round');
  if (obj.type === 'areal') poly.setAttribute('stroke-dasharray', '0.8 0.4');
  g.appendChild(poly);

  // Popisek v levém horním rohu
  const bbox = getPolygonBBox(pts);
  const labelX = bbox.minX + 1.5;
  const labelY = bbox.minY + 2;
  const fontSize = Math.max(0.7, Math.min(1.2, (bbox.maxX - bbox.minX) / 15));

  const text = svgEl('text');
  text.classList.add('obj-label-corner');
  text.setAttribute('x', labelX.toString());
  text.setAttribute('y', labelY.toString());
  text.setAttribute('font-size', fontSize.toString());
  text.textContent = obj.name;
  g.appendChild(text);

  // Plocha — malý text pod názvem
  const area = getPolygonArea(pts);
  const dim = svgEl('text');
  dim.classList.add('obj-dim-corner');
  dim.setAttribute('x', labelX.toString());
  dim.setAttribute('y', (labelY + fontSize * 1.2).toString());
  dim.setAttribute('font-size', (fontSize * 0.7).toString());
  dim.textContent = `${area.toFixed(0)} m²`;
  g.appendChild(dim);

  // Ikona zámku pro zamčené objekty
  if (obj.locked) {
    const lockIcon = svgEl('text');
    lockIcon.classList.add('lock-icon');
    lockIcon.setAttribute('x', (labelX + fontSize * (obj.name.length * 0.5 + 1)).toString());
    lockIcon.setAttribute('y', labelY.toString());
    lockIcon.setAttribute('font-size', (fontSize * 0.9).toString());
    lockIcon.setAttribute('fill', '#f59e0b');
    lockIcon.setAttribute('opacity', '0.7');
    lockIcon.setAttribute('dominant-baseline', 'auto');
    lockIcon.textContent = '\u{1F512}';
    g.appendChild(lockIcon);
  }

  // Vertex handles + edge distances při výběru (ne pro zamčené)
  if (state.selected === obj.id && !obj.locked) {
    // Vzdálenosti na hranách
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const p1 = pts[i], p2 = pts[j];
      const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;

      // Odsadit label kolmo na hranu (ven z polygonu)
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len, ny = dx / len; // normála
      const offset = 1.2;

      // Background rect pro čitelnost
      const edgeFontSize = Math.max(0.55, Math.min(0.8, dist / 12));
      const bg = svgEl('rect');
      const textW = dist >= 10 ? edgeFontSize * 3.2 : edgeFontSize * 2.4;
      const textH = edgeFontSize * 1.4;
      bg.setAttribute('x', (mx + nx * offset - textW / 2).toString());
      bg.setAttribute('y', (my + ny * offset - textH * 0.7).toString());
      bg.setAttribute('width', textW.toString());
      bg.setAttribute('height', textH.toString());
      bg.setAttribute('rx', '0.2');
      bg.setAttribute('fill', 'rgba(30,30,46,0.85)');
      bg.setAttribute('stroke', strokeColor);
      bg.setAttribute('stroke-width', '0.04');
      bg.setAttribute('stroke-opacity', '0.4');
      g.appendChild(bg);

      const edgeLabel = svgEl('text');
      edgeLabel.classList.add('edge-dist-label');
      edgeLabel.setAttribute('x', (mx + nx * offset).toString());
      edgeLabel.setAttribute('y', (my + ny * offset).toString());
      edgeLabel.setAttribute('font-size', edgeFontSize.toString());
      edgeLabel.setAttribute('text-anchor', 'middle');
      edgeLabel.setAttribute('dominant-baseline', 'middle');
      edgeLabel.textContent = dist.toFixed(1) + 'm';
      g.appendChild(edgeLabel);
    }

    // Vertex handles + rotation handles
    pts.forEach((p, i) => {
      // Rotační úchyt — větší kruh kolem vrcholu
      const rotHandle = svgEl('circle');
      rotHandle.classList.add('rotate-handle');
      rotHandle.setAttribute('cx', p.x.toString());
      rotHandle.setAttribute('cy', p.y.toString());
      rotHandle.setAttribute('r', '1.2');
      (rotHandle as any).dataset.action = 'rotate-vertex';
      (rotHandle as any).dataset.vertexIndex = i;
      g.appendChild(rotHandle);

      // Vertex handle — menší kruh pro přesun vrcholu
      const handle = svgEl('circle');
      handle.classList.add('vertex-handle');
      handle.setAttribute('cx', p.x.toString());
      handle.setAttribute('cy', p.y.toString());
      handle.setAttribute('r', '0.5');
      (handle as any).dataset.action = 'move-vertex';
      (handle as any).dataset.vertexIndex = i;
      g.appendChild(handle);

      // Rotační ikona (↻) vedle vrcholu
      const icon = svgEl('text');
      icon.classList.add('rotate-icon');
      icon.setAttribute('x', (p.x + 1.0).toString());
      icon.setAttribute('y', (p.y - 1.0).toString());
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

  // Vjezdy/Výjezdy na obvodu
  if (obj.entrances && obj.entrances.length > 0) {
    obj.entrances.forEach(ent => {
      renderEntranceMarker(g, obj, ent);
    });
  }

  // Stěny a vrata (uvnitř hal)
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

  // Polygon nepotřebuje translate (body jsou v world-space)
  g.setAttribute('transform', '');
}

function renderRoomLabel(g: SVGGElement, obj: DrawingObject, room: RoomLabel): void {
  const textWidth = room.name.length * 0.45;
  const textHeight = 1.0;

  // Neviditelný hit-area obdélník pro přetahování
  const hitArea = svgEl('rect');
  hitArea.setAttribute('x', (room.x - 0.2).toString());
  hitArea.setAttribute('y', (room.y - 0.2).toString());
  hitArea.setAttribute('width', (textWidth + 0.4).toString());
  hitArea.setAttribute('height', (textHeight + 0.4).toString());
  hitArea.setAttribute('fill', 'transparent');
  hitArea.setAttribute('cursor', 'grab');
  (hitArea as any).dataset.action = 'drag-room-label';
  (hitArea as any).dataset.objId = obj.id;
  (hitArea as any).dataset.roomId = room.id;
  g.appendChild(hitArea);

  // Decentní popisek místnosti — malý text
  const label = svgEl('text');
  label.setAttribute('x', room.x.toString());
  label.setAttribute('y', room.y.toString());
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

  // Malý podtržítkový indikátor
  const underline = svgEl('line');
  underline.setAttribute('x1', room.x.toString());
  underline.setAttribute('y1', (room.y + textHeight).toString());
  underline.setAttribute('x2', (room.x + textWidth).toString());
  underline.setAttribute('y2', (room.y + textHeight).toString());
  underline.setAttribute('stroke', '#60a5fa');
  underline.setAttribute('stroke-width', '0.06');
  underline.setAttribute('opacity', '0.4');
  underline.setAttribute('pointer-events', 'none');
  g.appendChild(underline);
}

function renderEntranceMarker(g: SVGGElement, obj: DrawingObject, entrance: Entrance): void {
  // Zjisti dva krajní body hrany (buď hrana polygonu, nebo vnitřní stěna)
  let p1: { x: number; y: number }, p2: { x: number; y: number };
  if (entrance.wallId != null && obj.walls) {
    const wall = obj.walls.find(w => w.id === entrance.wallId);
    if (!wall) return;
    p1 = { x: wall.x1, y: wall.y1 };
    p2 = { x: wall.x2, y: wall.y2 };
  } else {
    const pts = obj.points!;
    const i = entrance.edgeIndex;
    if (i < 0 || !pts || i >= pts.length) return;
    const j = (i + 1) % pts.length;
    p1 = pts[i];
    p2 = pts[j];
  }

  // Dva body (t1, t2) definující šířku vjezdu
  const t1 = entrance.t1 != null ? entrance.t1 : 0.4;
  const t2 = entrance.t2 != null ? entrance.t2 : 0.6;

  const x1 = p1.x + t1 * (p2.x - p1.x);
  const y1 = p1.y + t1 * (p2.y - p1.y);
  const x2 = p1.x + t2 * (p2.x - p1.x);
  const y2 = p1.y + t2 * (p2.y - p1.y);

  // Střed vjezdu
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  // Směr hrany a normála
  const edx = p2.x - p1.x;
  const edy = p2.y - p1.y;
  const elen = Math.sqrt(edx * edx + edy * edy) || 1;
  const ex = edx / elen;
  const ey = edy / elen;
  let nx = -ey;
  let ny = ex;
  // Určit "vnějšek": u polygonu ven od těžiště; u vnitřní stěny nemá smysl orientace, tak vezmeme výchozí
  if (entrance.wallId == null && obj.points && obj.points.length >= 3) {
    const pts = obj.points;
    let centX = 0, centY = 0;
    for (let k = 0; k < pts.length; k++) { centX += pts[k].x; centY += pts[k].y; }
    centX /= pts.length; centY /= pts.length;
    const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
    const toCentX = centX - midX, toCentY = centY - midY;
    if (nx * toCentX + ny * toCentY > 0) {
      nx = -nx; ny = -ny;
    }
  }

  const eType = ENTRANCE_TYPES[entrance.type] || ENTRANCE_TYPES.vjezd;
  const color = eType.color;

  // Brána — silnější čára mezi dvěma body na hraně
  const gate = svgEl('line');
  gate.setAttribute('x1', x1.toString());
  gate.setAttribute('y1', y1.toString());
  gate.setAttribute('x2', x2.toString());
  gate.setAttribute('y2', y2.toString());
  gate.setAttribute('stroke', color);
  gate.setAttribute('stroke-width', '0.35');
  gate.setAttribute('stroke-linecap', 'round');
  g.appendChild(gate);

  // Dva body na krajích
  [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(pt => {
    const dot = svgEl('circle');
    dot.setAttribute('cx', pt.x.toString());
    dot.setAttribute('cy', pt.y.toString());
    dot.setAttribute('r', '0.35');
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', '0.08');
    g.appendChild(dot);
  });

  const arrowLen = 2.0;
  const arrowW = 0.6;
  const isBoth = entrance.type === 'oboji';
  // Pro obojí: odsadit šipky podél hrany, aby se nepřekrývaly
  const tangentOffset = isBoth ? 1.2 : 0;

  // Vjezd — šipka DOVNITŘ (hrot k hraně, základ venku)
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

  // Výjezd — šipka VEN (hrot pryč od polygonu, základ u hrany)
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

  // Popisek (venku)
  const labelOffset = arrowLen + 1.8;
  const labelX = cx + nx * labelOffset;
  const labelY = cy + ny * labelOffset;
  const label = svgEl('text');
  label.classList.add('entrance-label');
  label.setAttribute('x', labelX.toString());
  label.setAttribute('y', labelY.toString());
  label.setAttribute('font-size', '0.65');
  label.setAttribute('fill', color);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'middle');
  label.setAttribute('font-weight', '500');
  label.textContent = entrance.name;
  g.appendChild(label);
}

// ---- Stěny a vrata ----

function renderWall(g: SVGGElement, obj: DrawingObject, wall: Wall): void {
  const wx1 = wall.x1, wy1 = wall.y1;
  const wx2 = wall.x2, wy2 = wall.y2;
  const dx = wx2 - wx1, dy = wy2 - wy1;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  if (wallLen < 0.01) return;
  const ex = dx / wallLen, ey = dy / wallLen;

  // Najít segmenty stěny (přerušované vraty)
  const gates = (wall.gates || []).slice().sort((a, b) => a.t - b.t);

  // Nakreslit stěnu po segmentech (mezery = vrata)
  interface WallSegment {
    t1: number;
    t2: number;
  }
  let segments: WallSegment[] = [];
  let lastT = 0;
  gates.forEach(gate => {
    const halfW = (gate.width / 2) / wallLen; // half-width jako t
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

  // Segmenty stěny (vnitřní příčky/místnosti — slabší než obvod haly)
  segments.forEach(seg => {
    const line = svgEl('line');
    line.setAttribute('x1', (wx1 + seg.t1 * dx).toString());
    line.setAttribute('y1', (wy1 + seg.t1 * dy).toString());
    line.setAttribute('x2', (wx1 + seg.t2 * dx).toString());
    line.setAttribute('y2', (wy1 + seg.t2 * dy).toString());
    line.setAttribute('stroke', '#8a8aa0');
    line.setAttribute('stroke-opacity', '0.75');
    line.setAttribute('stroke-width', '0.15');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.8');
    g.appendChild(line);
  });

  // Vrata — naznačené obloučky/symboly
  gates.forEach(gate => {
    const halfW = (gate.width / 2) / wallLen;
    const gStart = Math.max(0, gate.t - halfW);
    const gEnd = Math.min(1, gate.t + halfW);

    const gx1 = wx1 + gStart * dx;
    const gy1 = wy1 + gStart * dy;
    const gx2 = wx1 + gEnd * dx;
    const gy2 = wy1 + gEnd * dy;

    // Dvě tečky na krajích vrat
    [{ x: gx1, y: gy1 }, { x: gx2, y: gy2 }].forEach(pt => {
      const dot = svgEl('circle');
      dot.setAttribute('cx', pt.x.toString());
      dot.setAttribute('cy', pt.y.toString());
      dot.setAttribute('r', '0.25');
      dot.setAttribute('fill', '#f59e0b');
      dot.setAttribute('stroke', '#fff');
      dot.setAttribute('stroke-width', '0.06');
      g.appendChild(dot);
    });

    // Oblouček symbolizující otevření vrat
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

// ---- Náhled kreslení ----

export function renderDrawPreview(mouseWorld: Point | null): void {
  dom.drawLayer!.innerHTML = '';
  if (!state.drawMode || state.drawPoints.length === 0) return;

  const color = (state.drawType ? COLORS[state.drawType] : null) || COLORS.hala;
  const last = state.drawPoints[state.drawPoints.length - 1];
  const pts: Point[] = [...state.drawPoints];
  if (mouseWorld) pts.push(mouseWorld);

  // Constraint vodítko (nekonečná čára ve směru)
  if (state.drawConstraint && state.drawPoints.length > 0) {
    const guide = svgEl('line');
    const guideColor = state.drawConstraint === 'h' ? '#4ecdc4' : '#f59e0b';
    if (state.drawConstraint === 'h') {
      guide.setAttribute('x1', (last.x - 500).toString());
      guide.setAttribute('y1', last.y.toString());
      guide.setAttribute('x2', (last.x + 500).toString());
      guide.setAttribute('y2', last.y.toString());
    } else {
      guide.setAttribute('x1', last.x.toString());
      guide.setAttribute('y1', (last.y - 500).toString());
      guide.setAttribute('x2', last.x.toString());
      guide.setAttribute('y2', (last.y + 500).toString());
    }
    guide.setAttribute('stroke', guideColor);
    guide.setAttribute('stroke-width', '0.06');
    guide.setAttribute('stroke-dasharray', '0.4 0.3');
    guide.setAttribute('opacity', '0.6');
    dom.drawLayer!.appendChild(guide);
  }

  if (pts.length >= 2) {
    // Čáry
    const polyline = svgEl('polyline');
    polyline.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', color.stroke);
    polyline.setAttribute('stroke-width', '0.15');
    polyline.setAttribute('stroke-dasharray', '0.5 0.3');
    polyline.setAttribute('opacity', '0.8');
    dom.drawLayer!.appendChild(polyline);

    // Vyplněný náhled (pokud 3+ bodů)
    if (pts.length >= 3) {
      const preview = svgEl('polygon');
      preview.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
      preview.setAttribute('fill', color.fill);
      preview.setAttribute('stroke', 'none');
      preview.setAttribute('opacity', '0.4');
      dom.drawLayer!.appendChild(preview);
    }

    // Vzdálenost aktuální hrany (poslední bod → kurzor)
    if (mouseWorld && state.drawPoints.length > 0) {
      const dx = mouseWorld.x - last.x;
      const dy = mouseWorld.y - last.y;
      const edgeDist = Math.sqrt(dx * dx + dy * dy);
      if (edgeDist > 1) {
        const mx = (last.x + mouseWorld.x) / 2;
        const my = (last.y + mouseWorld.y) / 2;
        const len = edgeDist || 1;
        const nx = -dy / len, ny = dx / len;
        const off = 1.0;
        const fs = 0.7;

        const bg = svgEl('rect');
        const tw = fs * 3.5;
        const th = fs * 1.4;
        bg.setAttribute('x', (mx + nx * off - tw / 2).toString());
        bg.setAttribute('y', (my + ny * off - th * 0.7).toString());
        bg.setAttribute('width', tw.toString());
        bg.setAttribute('height', th.toString());
        bg.setAttribute('rx', '0.2');
        bg.setAttribute('fill', 'rgba(30,30,46,0.9)');
        bg.setAttribute('stroke', color.stroke);
        bg.setAttribute('stroke-width', '0.04');
        bg.setAttribute('stroke-opacity', '0.5');
        dom.drawLayer!.appendChild(bg);

        const distLabel = svgEl('text');
        distLabel.classList.add('edge-dist-label');
        distLabel.setAttribute('x', (mx + nx * off).toString());
        distLabel.setAttribute('y', (my + ny * off).toString());
        distLabel.setAttribute('font-size', fs.toString());
        distLabel.setAttribute('text-anchor', 'middle');
        distLabel.setAttribute('dominant-baseline', 'middle');
        distLabel.textContent = edgeDist.toFixed(1) + ' m';
        dom.drawLayer!.appendChild(distLabel);
      }
    }
  }

  // Body
  state.drawPoints.forEach((p, i) => {
    const circle = svgEl('circle');
    circle.setAttribute('cx', p.x.toString());
    circle.setAttribute('cy', p.y.toString());
    circle.setAttribute('r', (i === 0 ? 0.6 : 0.4).toString());
    circle.setAttribute('fill', i === 0 ? '#fff' : color.stroke);
    circle.setAttribute('stroke', i === 0 ? color.stroke : 'none');
    circle.setAttribute('stroke-width', '0.15');
    dom.drawLayer!.appendChild(circle);
  });

  // Ukazatel „uzavřít" u prvního bodu
  if (state.drawPoints.length >= 3 && mouseWorld) {
    const first = state.drawPoints[0];
    const dist = Math.sqrt((mouseWorld.x - first.x) ** 2 + (mouseWorld.y - first.y) ** 2);
    if (dist < 2) {
      const highlight = svgEl('circle');
      highlight.setAttribute('cx', first.x.toString());
      highlight.setAttribute('cy', first.y.toString());
      highlight.setAttribute('r', '1');
      highlight.setAttribute('fill', 'none');
      highlight.setAttribute('stroke', '#fff');
      highlight.setAttribute('stroke-width', '0.15');
      highlight.setAttribute('stroke-dasharray', '0.3 0.2');
      highlight.setAttribute('opacity', '0.6');
      dom.drawLayer!.appendChild(highlight);
    }
  }
}

// ---- Spojení ----

function renderConnections(): void {
  dom.connectionLayer!.innerHTML = '';
  state.connections.forEach(conn => {
    const from = state.objects.find(o => o.id === conn.from);
    const to = state.objects.find(o => o.id === conn.to);
    if (!from || !to) return;

    const c1 = getObjectCenter(from);
    const c2 = getObjectCenter(to);

    const line = svgEl('line');
    line.classList.add('connection-line');
    line.setAttribute('x1', c1.x.toString());
    line.setAttribute('y1', c1.y.toString());
    line.setAttribute('x2', c2.x.toString());
    line.setAttribute('y2', c2.y.toString());
    dom.connectionLayer!.appendChild(line);

    // Šipka
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
  dom.labelLayer!.innerHTML = '';
  const s = state.zoom * state.pxPerMeter;
  const step = state.zoom > 0.5 ? 5 : (state.zoom > 0.2 ? 10 : 25);

  for (let m = 0; m <= 200; m += step) {
    const px = m * s + state.panX;
    const py = m * s + state.panY;
    if (px > 0 && px < dom.container!.clientWidth) {
      const lbl = svgEl('text');
      lbl.classList.add('grid-label');
      lbl.setAttribute('x', px.toString());
      lbl.setAttribute('y', '14');
      lbl.textContent = m + 'm';
      dom.labelLayer!.appendChild(lbl);
    }
    if (py > 20 && py < dom.container!.clientHeight) {
      const lbl = svgEl('text');
      lbl.classList.add('grid-label');
      lbl.setAttribute('x', '4');
      lbl.setAttribute('y', (py + 4).toString());
      lbl.textContent = m + 'm';
      dom.labelLayer!.appendChild(lbl);
    }
  }
}

// ---- Pomocné funkce ----

export function svgEl(tag: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function addLabels(g: SVGGElement, obj: DrawingObject, w: number, h: number): void {
  // Starý styl — zachován pro kompatibilitu, ale nepoužíváme
  addCornerLabels(g, obj);
}

function addCornerLabels(g: SVGGElement, obj: DrawingObject): void {
  // Popisek v levém horním rohu objektu
  const padding = 0.5;
  const fontSize = Math.max(0.5, Math.min(0.9, obj.w / 12, obj.h / 6));

  const text = svgEl('text');
  text.classList.add('obj-label-corner');
  text.setAttribute('x', padding.toString());
  text.setAttribute('y', (padding + fontSize).toString());
  text.setAttribute('font-size', fontSize.toString());
  text.textContent = obj.name;
  g.appendChild(text);

  // Rozměry — malý text pod názvem
  const dim = svgEl('text');
  dim.classList.add('obj-dim-corner');
  dim.setAttribute('x', padding.toString());
  dim.setAttribute('y', (padding + fontSize * 2.2).toString());
  dim.setAttribute('font-size', (fontSize * 0.65).toString());
  dim.textContent = `${obj.w.toFixed(1)}×${obj.h.toFixed(1)} m`;
  g.appendChild(dim);
}

function getObjectCenter(obj: DrawingObject): Point {
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

interface BBox {
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
  // Shoelace formula
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

export function isPointInPolygon(px: number, py: number, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Náhled umísťování vjezdu/výjezdu (dvoustupňové)
export function renderEntrancePlacePreview(mouseWorld: Point | null): void {
  dom.snapLayer!.innerHTML = '';
  if (!state.entrancePlaceMode || !mouseWorld) return;

  const nearest = findNearestArealEdge(mouseWorld.x, mouseWorld.y);
  if (!nearest) return;

  const obj = state.objects.find(o => o.id === nearest.objId);
  if (!obj) return;
  const pts = obj.points!;
  const i = nearest.edgeIndex;
  const j = (i + 1) % pts.length;
  const p1 = pts[i], p2 = pts[j];

  const eType = ENTRANCE_TYPES[state.entrancePlaceType] || ENTRANCE_TYPES.vjezd;
  const color = eType.color;

  // Zvýrazněná hrana
  const edgeHighlight = svgEl('line');
  edgeHighlight.setAttribute('x1', p1.x.toString());
  edgeHighlight.setAttribute('y1', p1.y.toString());
  edgeHighlight.setAttribute('x2', p2.x.toString());
  edgeHighlight.setAttribute('y2', p2.y.toString());
  edgeHighlight.setAttribute('stroke', color);
  edgeHighlight.setAttribute('stroke-width', '0.15');
  edgeHighlight.setAttribute('stroke-dasharray', '0.5 0.3');
  edgeHighlight.setAttribute('opacity', '0.5');
  dom.snapLayer!.appendChild(edgeHighlight);

  // Aktuální bod kurzoru na hraně
  const cx = p1.x + nearest.t * (p2.x - p1.x);
  const cy = p1.y + nearest.t * (p2.y - p1.y);

  const dot = svgEl('circle');
  dot.setAttribute('cx', cx.toString());
  dot.setAttribute('cy', cy.toString());
  dot.setAttribute('r', '0.6');
  dot.setAttribute('fill', color);
  dot.setAttribute('opacity', '0.8');
  dot.setAttribute('stroke', '#fff');
  dot.setAttribute('stroke-width', '0.1');
  dom.snapLayer!.appendChild(dot);

  // Text popisek
  const label = svgEl('text');
  label.setAttribute('x', cx.toString());
  label.setAttribute('y', (cy - 1.5).toString());
  label.setAttribute('font-size', '0.6');
  label.setAttribute('fill', color);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'middle');
  label.textContent = 'Klikni na hranu — první bod šířky';
  dom.snapLayer!.appendChild(label);
}

// Náhled kreslení stěny
export function renderWallDrawPreview(mouseWorld: Point | null): void {
  dom.snapLayer!.innerHTML = '';
  if (!state.wallDrawMode || !state.wallDrawStart || !mouseWorld) return;

  const s = state.wallDrawStart;
  const snapped = { x: snapToGrid(mouseWorld.x), y: snapToGrid(mouseWorld.y) };

  const line = svgEl('line');
  line.setAttribute('x1', s.x.toString());
  line.setAttribute('y1', s.y.toString());
  line.setAttribute('x2', snapped.x.toString());
  line.setAttribute('y2', snapped.y.toString());
  line.setAttribute('stroke', '#a0a0c0');
  line.setAttribute('stroke-width', '0.15');
  line.setAttribute('stroke-dasharray', '0.4 0.3');
  line.setAttribute('opacity', '0.7');
  dom.snapLayer!.appendChild(line);

  // Počáteční bod
  const dot1 = svgEl('circle');
  dot1.setAttribute('cx', s.x.toString());
  dot1.setAttribute('cy', s.y.toString());
  dot1.setAttribute('r', '0.5');
  dot1.setAttribute('fill', '#a0a0c0');
  dot1.setAttribute('stroke', '#fff');
  dot1.setAttribute('stroke-width', '0.1');
  dom.snapLayer!.appendChild(dot1);

  // Bod kurzoru
  const dot2 = svgEl('circle');
  dot2.setAttribute('cx', snapped.x.toString());
  dot2.setAttribute('cy', snapped.y.toString());
  dot2.setAttribute('r', '0.4');
  dot2.setAttribute('fill', '#a0a0c0');
  dot2.setAttribute('opacity', '0.6');
  dom.snapLayer!.appendChild(dot2);

  // Délka
  const dist = Math.sqrt((snapped.x - s.x) ** 2 + (snapped.y - s.y) ** 2);
  if (dist > 0.5) {
    const mx = (s.x + snapped.x) / 2;
    const my = (s.y + snapped.y) / 2;
    const dx = snapped.x - s.x, dy = snapped.y - s.y;
    const len = dist || 1;
    const nx = -dy / len, ny = dx / len;
    const distLabel = svgEl('text');
    distLabel.setAttribute('x', (mx + nx * 0.8).toString());
    distLabel.setAttribute('y', (my + ny * 0.8).toString());
    distLabel.setAttribute('font-size', '0.55');
    distLabel.setAttribute('fill', '#a0a0c0');
    distLabel.setAttribute('text-anchor', 'middle');
    distLabel.setAttribute('dominant-baseline', 'middle');
    distLabel.textContent = dist.toFixed(1) + ' m';
    dom.snapLayer!.appendChild(distLabel);
  }
}

// Hover náhled při kreslení stěn — ukazuje přichycení ke hraně
interface SnapInfo {
  x: number;
  y: number;
  distFromStart: number;
  edgeStart: Point;
  edgeEnd: Point;
}

export function renderWallSnapHover(snap: SnapInfo | null): void {
  dom.snapLayer!.innerHTML = '';
  if (!snap) return;

  // Zvýraznit hranu (žlutá čárkovaná)
  const edgeLine = svgEl('line');
  edgeLine.setAttribute('x1', snap.edgeStart.x.toString());
  edgeLine.setAttribute('y1', snap.edgeStart.y.toString());
  edgeLine.setAttribute('x2', snap.edgeEnd.x.toString());
  edgeLine.setAttribute('y2', snap.edgeEnd.y.toString());
  edgeLine.setAttribute('stroke', '#f59e0b');
  edgeLine.setAttribute('stroke-width', '0.12');
  edgeLine.setAttribute('stroke-dasharray', '0.4 0.3');
  edgeLine.setAttribute('opacity', '0.5');
  dom.snapLayer!.appendChild(edgeLine);

  // Bod na hraně
  const dot = svgEl('circle');
  dot.setAttribute('cx', snap.x.toString());
  dot.setAttribute('cy', snap.y.toString());
  dot.setAttribute('r', '0.5');
  dot.setAttribute('fill', '#f59e0b');
  dot.setAttribute('stroke', '#fff');
  dot.setAttribute('stroke-width', '0.08');
  dom.snapLayer!.appendChild(dot);

  // Vzdálenost od začátku
  const label = svgEl('text');
  label.setAttribute('x', snap.x.toString());
  label.setAttribute('y', (snap.y - 1.0).toString());
  label.setAttribute('font-size', '0.5');
  label.setAttribute('fill', '#f59e0b');
  label.setAttribute('text-anchor', 'middle');
  label.textContent = snap.distFromStart.toFixed(1) + ' m';
  dom.snapLayer!.appendChild(label);

  // Pokud máme start, zobrazit čáru od startu ke snap bodu
  if (state.wallDrawStart) {
    const line = svgEl('line');
    line.setAttribute('x1', state.wallDrawStart.x.toString());
    line.setAttribute('y1', state.wallDrawStart.y.toString());
    line.setAttribute('x2', snap.x.toString());
    line.setAttribute('y2', snap.y.toString());
    line.setAttribute('stroke', '#a0a0c0');
    line.setAttribute('stroke-width', '0.12');
    line.setAttribute('stroke-dasharray', '0.4 0.3');
    line.setAttribute('opacity', '0.6');
    dom.snapLayer!.appendChild(line);

    // Startovní bod (zelený)
    const startDot = svgEl('circle');
    startDot.setAttribute('cx', state.wallDrawStart.x.toString());
    startDot.setAttribute('cy', state.wallDrawStart.y.toString());
    startDot.setAttribute('r', '0.4');
    startDot.setAttribute('fill', '#22c55e');
    startDot.setAttribute('stroke', '#fff');
    startDot.setAttribute('stroke-width', '0.06');
    dom.snapLayer!.appendChild(startDot);

    // Délka stěny
    const wallLen = Math.sqrt((snap.x - state.wallDrawStart.x) ** 2 + (snap.y - state.wallDrawStart.y) ** 2);
    const mx = (state.wallDrawStart.x + snap.x) / 2;
    const my = (state.wallDrawStart.y + snap.y) / 2;
    const wLabel = svgEl('text');
    wLabel.setAttribute('x', mx.toString());
    wLabel.setAttribute('y', (my - 0.8).toString());
    wLabel.setAttribute('font-size', '0.5');
    wLabel.setAttribute('fill', '#a0a0c0');
    wLabel.setAttribute('text-anchor', 'middle');
    wLabel.textContent = wallLen.toFixed(1) + ' m';
    dom.snapLayer!.appendChild(wLabel);
  }
}

// Náhled umístění vrat na stěnu
interface ProjectedPoint {
  px: number;
  py: number;
  t: number;
}

export function renderGatePlacePreview(obj: DrawingObject | null, wallId: number | null, projected: ProjectedPoint | null): void {
  dom.snapLayer!.innerHTML = '';
  if (!obj || !obj.walls || wallId === null) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;

  // Zvýraznit celou stěnu (žlutě)
  const wallLine = svgEl('line');
  wallLine.setAttribute('x1', wall.x1.toString());
  wallLine.setAttribute('y1', wall.y1.toString());
  wallLine.setAttribute('x2', wall.x2.toString());
  wallLine.setAttribute('y2', wall.y2.toString());
  wallLine.setAttribute('stroke', '#f59e0b');
  wallLine.setAttribute('stroke-width', '0.3');
  wallLine.setAttribute('opacity', '0.6');
  wallLine.setAttribute('stroke-linecap', 'round');
  dom.snapLayer!.appendChild(wallLine);

  if (projected) {
    // Bod kde budou vrata
    const dot = svgEl('circle');
    dot.setAttribute('cx', projected.px.toString());
    dot.setAttribute('cy', projected.py.toString());
    dot.setAttribute('r', '0.5');
    dot.setAttribute('fill', '#f59e0b');
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', '0.08');
    dom.snapLayer!.appendChild(dot);

    // Naznačit šířku vrat (3m default)
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen > 0.1) {
      const gateWidth = 3; // default
      const halfW = (gateWidth / 2) / wallLen;
      const gStart = Math.max(0, projected.t - halfW);
      const gEnd = Math.min(1, projected.t + halfW);
      const gx1 = wall.x1 + gStart * dx;
      const gy1 = wall.y1 + gStart * dy;
      const gx2 = wall.x1 + gEnd * dx;
      const gy2 = wall.y1 + gEnd * dy;

      const gateLine = svgEl('line');
      gateLine.setAttribute('x1', gx1.toString());
      gateLine.setAttribute('y1', gy1.toString());
      gateLine.setAttribute('x2', gx2.toString());
      gateLine.setAttribute('y2', gy2.toString());
      gateLine.setAttribute('stroke', '#22c55e');
      gateLine.setAttribute('stroke-width', '0.4');
      gateLine.setAttribute('opacity', '0.8');
      gateLine.setAttribute('stroke-linecap', 'round');
      dom.snapLayer!.appendChild(gateLine);
    }
  }
}
