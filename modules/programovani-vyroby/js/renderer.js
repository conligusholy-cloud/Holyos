/* ============================================
   renderer.js — Vykreslování SVG
   ============================================ */

let dom = {};

function initDom() {
  dom = {
    svg: document.getElementById('canvas'),
    container: document.getElementById('canvas-container'),
    objectLayer: document.getElementById('object-layer'),
    connectionLayer: document.getElementById('connection-layer'),
    snapLayer: document.getElementById('snap-layer'),
    labelLayer: document.getElementById('label-layer'),
    drawLayer: document.getElementById('draw-layer'),
    gridRect: document.getElementById('grid-rect'),
    zoomDisplay: document.getElementById('zoom-display'),
    coordsDisplay: document.getElementById('coords-display'),
    propsPanel: document.getElementById('properties'),
    fileInput: document.getElementById('file-input'),
    ghost: document.getElementById('drag-ghost'),
    drawStatus: document.getElementById('draw-status'),
  };
}

// ---- Souřadnicové utility ----

function screenToWorld(sx, sy) {
  const rect = dom.container.getBoundingClientRect();
  return {
    x: (sx - rect.left - state.panX) / (state.zoom * state.pxPerMeter),
    y: (sy - rect.top - state.panY) / (state.zoom * state.pxPerMeter)
  };
}

function worldToScreen(wx, wy) {
  return {
    x: wx * state.zoom * state.pxPerMeter + state.panX,
    y: wy * state.zoom * state.pxPerMeter + state.panY
  };
}

function snapToGrid(val) {
  if (!state.snapEnabled) return val;
  return Math.round(val / state.snapSize) * state.snapSize;
}

// ---- Transformace a mřížka ----

function updateTransform() {
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
  gridSmall.setAttribute('width', gs);
  gridSmall.setAttribute('height', gs);
  gridSmall.querySelector('path').setAttribute('d', `M ${gs} 0 L 0 0 0 ${gs}`);
  gridLarge.setAttribute('width', gs5);
  gridLarge.setAttribute('height', gs5);
  gridLarge.querySelector('rect').setAttribute('width', gs5);
  gridLarge.querySelector('rect').setAttribute('height', gs5);
  gridLarge.querySelector('path').setAttribute('d', `M ${gs5} 0 L 0 0 0 ${gs5}`);

  dom.gridRect.setAttribute('x', -5000 + (state.panX % gs5));
  dom.gridRect.setAttribute('y', -5000 + (state.panY % gs5));

  dom.zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
  renderLabels();
}

// ---- Hlavní renderování ----

function renderAll() {
  dom.objectLayer.innerHTML = '';
  dom.connectionLayer.innerHTML = '';

  // Nejprve vykreslit areál jako read-only pozadí (ztlumené)
  if (state.arealObjects && state.arealObjects.length > 0) {
    const arealGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    arealGroup.setAttribute('opacity', '0.45');
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

function renderArealBackgroundObject(parent, obj) {
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
    poly.setAttribute('stroke-width', 0.08);
    poly.setAttribute('stroke-opacity', 0.5);
    poly.setAttribute('stroke-linejoin', 'round');
    if (obj.type === 'areal') poly.setAttribute('stroke-dasharray', '0.8 0.4');
    g.appendChild(poly);

    const bbox = getPolygonBBox(pts);
    const labelX = bbox.minX + 1.5;
    const labelY = bbox.minY + 2;
    const fontSize = Math.max(0.7, Math.min(1.2, (bbox.maxX - bbox.minX) / 15));
    const text = svgEl('text');
    text.classList.add('obj-label-corner');
    text.setAttribute('x', labelX);
    text.setAttribute('y', labelY);
    text.setAttribute('font-size', fontSize);
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
    rect.setAttribute('width', obj.w);
    rect.setAttribute('height', obj.h);
    rect.setAttribute('rx', obj.type === 'cesta' ? 0.2 : 0.3);
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', 0.08);
    rect.setAttribute('stroke-opacity', 0.4);
    g.appendChild(rect);
    g.setAttribute('transform', `translate(${obj.x},${obj.y})`);
  }

  parent.appendChild(g);
}

function renderObject(obj) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('obj');
  if (obj.locked) g.classList.add('locked');
  g.dataset.id = obj.id;
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
    poly.setAttribute('stroke-width', 0.08);
    poly.setAttribute('stroke-opacity', 0.5);
    g.appendChild(poly);
    addCornerLabels(g, obj);
    const rotV = obj.rotation || 0;
    if (rotV) {
      const cxV = obj.w / 2, cyV = obj.h / 2;
      g.setAttribute('transform', `translate(${obj.x},${obj.y}) rotate(${rotV},${cxV},${cyV})`);
    } else {
      g.setAttribute('transform', `translate(${obj.x},${obj.y})`);
    }
  } else {
    // ---- RECTANGLE ----
    const rect = svgEl('rect');
    rect.setAttribute('width', obj.w);
    rect.setAttribute('height', obj.h);
    rect.setAttribute('rx', obj.type === 'cesta' ? 0.2 : 0.3);
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', 0.08);
    rect.setAttribute('stroke-opacity', 0.5);
    if (obj.type === 'areal') rect.setAttribute('stroke-dasharray', '0.8 0.4');
    g.appendChild(rect);
    addCornerLabels(g, obj);
    // Rotace kolem středu obdélníku
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
      lockIcon.setAttribute('x', obj.w - 1.2);
      lockIcon.setAttribute('y', 1.2);
      lockIcon.setAttribute('font-size', 0.8);
      lockIcon.setAttribute('fill', '#f59e0b');
      lockIcon.setAttribute('opacity', '0.7');
      lockIcon.setAttribute('text-anchor', 'end');
      lockIcon.textContent = '\u{1F512}';
      g.appendChild(lockIcon);
    }

    // Resize handle (ne pro zamčené) — malý trojúhelník v rohu
    if (state.selected === obj.id && !obj.locked) {
      const s = 0.4; // velikost handle
      const rh = svgEl('polygon');
      rh.classList.add('resize-handle');
      rh.setAttribute('points', `${obj.w},${obj.h - s} ${obj.w},${obj.h} ${obj.w - s},${obj.h}`);
      rh.setAttribute('fill', '#fff');
      rh.setAttribute('stroke', 'var(--accent)');
      rh.setAttribute('stroke-width', '0.05');
      rh.style.cursor = 'nwse-resize';
      rh.dataset.action = 'resize';
      g.appendChild(rh);
    }
  }

  dom.objectLayer.appendChild(g);
}

function renderPolygonObject(g, obj, strokeColor, fillColor) {
  const pts = obj.points;
  const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');

  const poly = svgEl('polygon');
  poly.setAttribute('points', pointsStr);
  poly.setAttribute('fill', fillColor);
  poly.setAttribute('stroke', strokeColor);
  poly.setAttribute('stroke-width', 0.08);
  poly.setAttribute('stroke-opacity', 0.6);
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
  text.setAttribute('x', labelX);
  text.setAttribute('y', labelY);
  text.setAttribute('font-size', fontSize);
  text.textContent = obj.name;
  g.appendChild(text);

  // Plocha — malý text pod názvem
  const area = getPolygonArea(pts);
  const dim = svgEl('text');
  dim.classList.add('obj-dim-corner');
  dim.setAttribute('x', labelX);
  dim.setAttribute('y', labelY + fontSize * 1.2);
  dim.setAttribute('font-size', fontSize * 0.7);
  dim.textContent = `${area.toFixed(0)} m²`;
  g.appendChild(dim);

  // Ikona zámku pro zamčené objekty
  if (obj.locked) {
    const lockIcon = svgEl('text');
    lockIcon.classList.add('lock-icon');
    lockIcon.setAttribute('x', labelX + fontSize * (obj.name.length * 0.5 + 1));
    lockIcon.setAttribute('y', labelY);
    lockIcon.setAttribute('font-size', fontSize * 0.9);
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
      bg.setAttribute('x', mx + nx * offset - textW / 2);
      bg.setAttribute('y', my + ny * offset - textH * 0.7);
      bg.setAttribute('width', textW);
      bg.setAttribute('height', textH);
      bg.setAttribute('rx', 0.2);
      bg.setAttribute('fill', 'rgba(30,30,46,0.85)');
      bg.setAttribute('stroke', strokeColor);
      bg.setAttribute('stroke-width', 0.04);
      bg.setAttribute('stroke-opacity', 0.4);
      g.appendChild(bg);

      const edgeLabel = svgEl('text');
      edgeLabel.classList.add('edge-dist-label');
      edgeLabel.setAttribute('x', mx + nx * offset);
      edgeLabel.setAttribute('y', my + ny * offset);
      edgeLabel.setAttribute('font-size', edgeFontSize);
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
      rotHandle.setAttribute('cx', p.x);
      rotHandle.setAttribute('cy', p.y);
      rotHandle.setAttribute('r', 1.2);
      rotHandle.dataset.action = 'rotate-vertex';
      rotHandle.dataset.vertexIndex = i;
      g.appendChild(rotHandle);

      // Vertex handle — menší kruh pro přesun vrcholu
      const handle = svgEl('circle');
      handle.classList.add('vertex-handle');
      handle.setAttribute('cx', p.x);
      handle.setAttribute('cy', p.y);
      handle.setAttribute('r', 0.5);
      handle.dataset.action = 'move-vertex';
      handle.dataset.vertexIndex = i;
      g.appendChild(handle);

      // Rotační ikona (↻) vedle vrcholu
      const icon = svgEl('text');
      icon.classList.add('rotate-icon');
      icon.setAttribute('x', p.x + 1.0);
      icon.setAttribute('y', p.y - 1.0);
      icon.setAttribute('font-size', 0.9);
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

function renderRoomLabel(g, obj, room) {
  const textWidth = room.name.length * 0.45;
  const textHeight = 1.0;

  // Neviditelný hit-area obdélník pro přetahování
  const hitArea = svgEl('rect');
  hitArea.setAttribute('x', room.x - 0.2);
  hitArea.setAttribute('y', room.y - 0.2);
  hitArea.setAttribute('width', textWidth + 0.4);
  hitArea.setAttribute('height', textHeight + 0.4);
  hitArea.setAttribute('fill', 'transparent');
  hitArea.setAttribute('cursor', 'grab');
  hitArea.dataset.action = 'drag-room-label';
  hitArea.dataset.objId = obj.id;
  hitArea.dataset.roomId = room.id;
  g.appendChild(hitArea);

  // Decentní popisek místnosti — malý text
  const label = svgEl('text');
  label.setAttribute('x', room.x);
  label.setAttribute('y', room.y);
  label.setAttribute('font-size', 0.8);
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
  underline.setAttribute('x1', room.x);
  underline.setAttribute('y1', room.y + textHeight);
  underline.setAttribute('x2', room.x + textWidth);
  underline.setAttribute('y2', room.y + textHeight);
  underline.setAttribute('stroke', '#60a5fa');
  underline.setAttribute('stroke-width', 0.06);
  underline.setAttribute('opacity', '0.4');
  underline.setAttribute('pointer-events', 'none');
  g.appendChild(underline);
}

function renderEntranceMarker(g, obj, entrance) {
  const pts = obj.points;
  const i = entrance.edgeIndex;
  if (i < 0 || i >= pts.length) return;
  const j = (i + 1) % pts.length;
  const p1 = pts[i], p2 = pts[j];

  // Dva body (t1, t2) definující šířku vjezdu
  const t1 = entrance.t1 != null ? entrance.t1 : (entrance.t ? entrance.t - 0.02 : 0.4);
  const t2 = entrance.t2 != null ? entrance.t2 : (entrance.t ? entrance.t + 0.02 : 0.6);

  const x1 = p1.x + t1 * (p2.x - p1.x);
  const y1 = p1.y + t1 * (p2.y - p1.y);
  const x2 = p1.x + t2 * (p2.x - p1.x);
  const y2 = p1.y + t2 * (p2.y - p1.y);

  // Střed vjezdu
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  // Směr hrany a normála (VŽDY ven z polygonu)
  const edx = p2.x - p1.x;
  const edy = p2.y - p1.y;
  const elen = Math.sqrt(edx * edx + edy * edy) || 1;
  const ex = edx / elen;
  const ey = edy / elen;
  let nx = -ey;
  let ny = ex;
  // Zjistit těžiště polygonu
  let centX = 0, centY = 0;
  for (let k = 0; k < pts.length; k++) { centX += pts[k].x; centY += pts[k].y; }
  centX /= pts.length; centY /= pts.length;
  // Pokud normála ukazuje DOVNITŘ (směrem k těžišti), otočit ji
  const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
  const toCentX = centX - midX, toCentY = centY - midY;
  if (nx * toCentX + ny * toCentY > 0) {
    nx = -nx; ny = -ny;
  }

  const eType = ENTRANCE_TYPES[entrance.type] || ENTRANCE_TYPES.vjezd;
  const color = eType.color;

  // Brána — silnější čára mezi dvěma body na hraně
  const gate = svgEl('line');
  gate.setAttribute('x1', x1);
  gate.setAttribute('y1', y1);
  gate.setAttribute('x2', x2);
  gate.setAttribute('y2', y2);
  gate.setAttribute('stroke', color);
  gate.setAttribute('stroke-width', 0.35);
  gate.setAttribute('stroke-linecap', 'round');
  g.appendChild(gate);

  // Dva body na krajích
  [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(pt => {
    const dot = svgEl('circle');
    dot.setAttribute('cx', pt.x);
    dot.setAttribute('cy', pt.y);
    dot.setAttribute('r', 0.35);
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', 0.08);
    g.appendChild(dot);
  });

  const arrowLen = 2.0;
  const arrowW = 0.6;
  const isBoth = entrance.type === 'oboji';
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
  label.setAttribute('x', labelX);
  label.setAttribute('y', labelY);
  label.setAttribute('font-size', 0.65);
  label.setAttribute('fill', color);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'middle');
  label.setAttribute('font-weight', '500');
  label.textContent = entrance.name;
  g.appendChild(label);
}

// ---- Stěny a vrata ----

function renderWall(g, obj, wall) {
  const wx1 = wall.x1, wy1 = wall.y1;
  const wx2 = wall.x2, wy2 = wall.y2;
  const dx = wx2 - wx1, dy = wy2 - wy1;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  if (wallLen < 0.01) return;
  const ex = dx / wallLen, ey = dy / wallLen;

  // Najít segmenty stěny (přerušované vraty)
  const gates = (wall.gates || []).slice().sort((a, b) => a.t - b.t);

  // Nakreslit stěnu po segmentech (mezery = vrata)
  let segments = [];
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

  // Segmenty stěny
  segments.forEach(seg => {
    const line = svgEl('line');
    line.setAttribute('x1', wx1 + seg.t1 * dx);
    line.setAttribute('y1', wy1 + seg.t1 * dy);
    line.setAttribute('x2', wx1 + seg.t2 * dx);
    line.setAttribute('y2', wy1 + seg.t2 * dy);
    line.setAttribute('stroke', '#a0a0c0');
    line.setAttribute('stroke-width', 0.2);
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
      dot.setAttribute('cx', pt.x);
      dot.setAttribute('cy', pt.y);
      dot.setAttribute('r', 0.25);
      dot.setAttribute('fill', '#f59e0b');
      dot.setAttribute('stroke', '#fff');
      dot.setAttribute('stroke-width', 0.06);
      g.appendChild(dot);
    });

    // Oblouček symbolizující otevření vrat
    const gmx = (gx1 + gx2) / 2;
    const gmy = (gy1 + gy2) / 2;
    const nx = -ey, ny = ex; // normála
    const arcR = gate.width / 2;

    const arcPath = svgEl('path');
    arcPath.setAttribute('d', `M ${gx1} ${gy1} A ${arcR} ${arcR} 0 0 1 ${gx2} ${gy2}`);
    arcPath.setAttribute('fill', 'none');
    arcPath.setAttribute('stroke', '#f59e0b');
    arcPath.setAttribute('stroke-width', 0.08);
    arcPath.setAttribute('stroke-dasharray', '0.3 0.2');
    arcPath.setAttribute('opacity', '0.6');
    g.appendChild(arcPath);
  });
}

// ---- Náhled kreslení ----

function renderDrawPreview(mouseWorld) {
  dom.drawLayer.innerHTML = '';
  if (!state.drawMode || state.drawPoints.length === 0) return;

  const color = COLORS[state.drawType] || COLORS.hala;
  const last = state.drawPoints[state.drawPoints.length - 1];
  const pts = [...state.drawPoints];
  if (mouseWorld) pts.push(mouseWorld);

  // Constraint vodítko (nekonečná čára ve směru)
  if (state.drawConstraint && state.drawPoints.length > 0) {
    const guide = svgEl('line');
    const guideColor = state.drawConstraint === 'h' ? '#4ecdc4' : '#f59e0b';
    if (state.drawConstraint === 'h') {
      guide.setAttribute('x1', last.x - 500);
      guide.setAttribute('y1', last.y);
      guide.setAttribute('x2', last.x + 500);
      guide.setAttribute('y2', last.y);
    } else {
      guide.setAttribute('x1', last.x);
      guide.setAttribute('y1', last.y - 500);
      guide.setAttribute('x2', last.x);
      guide.setAttribute('y2', last.y + 500);
    }
    guide.setAttribute('stroke', guideColor);
    guide.setAttribute('stroke-width', 0.06);
    guide.setAttribute('stroke-dasharray', '0.4 0.3');
    guide.setAttribute('opacity', '0.6');
    dom.drawLayer.appendChild(guide);
  }

  if (pts.length >= 2) {
    // Čáry
    const polyline = svgEl('polyline');
    polyline.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', color.stroke);
    polyline.setAttribute('stroke-width', 0.15);
    polyline.setAttribute('stroke-dasharray', '0.5 0.3');
    polyline.setAttribute('opacity', '0.8');
    dom.drawLayer.appendChild(polyline);

    // Vyplněný náhled (pokud 3+ bodů)
    if (pts.length >= 3) {
      const preview = svgEl('polygon');
      preview.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
      preview.setAttribute('fill', color.fill);
      preview.setAttribute('stroke', 'none');
      preview.setAttribute('opacity', '0.4');
      dom.drawLayer.appendChild(preview);
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
        bg.setAttribute('x', mx + nx * off - tw / 2);
        bg.setAttribute('y', my + ny * off - th * 0.7);
        bg.setAttribute('width', tw);
        bg.setAttribute('height', th);
        bg.setAttribute('rx', 0.2);
        bg.setAttribute('fill', 'rgba(30,30,46,0.9)');
        bg.setAttribute('stroke', color.stroke);
        bg.setAttribute('stroke-width', 0.04);
        bg.setAttribute('stroke-opacity', 0.5);
        dom.drawLayer.appendChild(bg);

        const distLabel = svgEl('text');
        distLabel.classList.add('edge-dist-label');
        distLabel.setAttribute('x', mx + nx * off);
        distLabel.setAttribute('y', my + ny * off);
        distLabel.setAttribute('font-size', fs);
        distLabel.setAttribute('text-anchor', 'middle');
        distLabel.setAttribute('dominant-baseline', 'middle');
        distLabel.textContent = edgeDist.toFixed(1) + ' m';
        dom.drawLayer.appendChild(distLabel);
      }
    }
  }

  // Body
  state.drawPoints.forEach((p, i) => {
    const circle = svgEl('circle');
    circle.setAttribute('cx', p.x);
    circle.setAttribute('cy', p.y);
    circle.setAttribute('r', i === 0 ? 0.6 : 0.4);
    circle.setAttribute('fill', i === 0 ? '#fff' : color.stroke);
    circle.setAttribute('stroke', i === 0 ? color.stroke : 'none');
    circle.setAttribute('stroke-width', 0.15);
    dom.drawLayer.appendChild(circle);
  });

  // Ukazatel „uzavřít" u prvního bodu
  if (state.drawPoints.length >= 3 && mouseWorld) {
    const first = state.drawPoints[0];
    const dist = Math.sqrt((mouseWorld.x - first.x) ** 2 + (mouseWorld.y - first.y) ** 2);
    if (dist < 2) {
      const highlight = svgEl('circle');
      highlight.setAttribute('cx', first.x);
      highlight.setAttribute('cy', first.y);
      highlight.setAttribute('r', 1);
      highlight.setAttribute('fill', 'none');
      highlight.setAttribute('stroke', '#fff');
      highlight.setAttribute('stroke-width', 0.15);
      highlight.setAttribute('stroke-dasharray', '0.3 0.2');
      highlight.setAttribute('opacity', '0.6');
      dom.drawLayer.appendChild(highlight);
    }
  }
}

// ---- Spojení ----

function renderConnections() {
  dom.connectionLayer.innerHTML = '';
  state.connections.forEach(conn => {
    const from = state.objects.find(o => o.id === conn.from);
    const to = state.objects.find(o => o.id === conn.to);
    if (!from || !to) return;

    const c1 = getObjectCenter(from);
    const c2 = getObjectCenter(to);

    const line = svgEl('line');
    line.classList.add('connection-line');
    line.setAttribute('x1', c1.x);
    line.setAttribute('y1', c1.y);
    line.setAttribute('x2', c2.x);
    line.setAttribute('y2', c2.y);
    dom.connectionLayer.appendChild(line);

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
    dom.connectionLayer.appendChild(arrow);
  });
}

function renderLabels() {
  dom.labelLayer.innerHTML = '';
  const s = state.zoom * state.pxPerMeter;
  const step = state.zoom > 0.5 ? 5 : (state.zoom > 0.2 ? 10 : 25);

  for (let m = 0; m <= 200; m += step) {
    const px = m * s + state.panX;
    const py = m * s + state.panY;
    if (px > 0 && px < dom.container.clientWidth) {
      const lbl = svgEl('text');
      lbl.classList.add('grid-label');
      lbl.setAttribute('x', px);
      lbl.setAttribute('y', 14);
      lbl.textContent = m + 'm';
      dom.labelLayer.appendChild(lbl);
    }
    if (py > 20 && py < dom.container.clientHeight) {
      const lbl = svgEl('text');
      lbl.classList.add('grid-label');
      lbl.setAttribute('x', 4);
      lbl.setAttribute('y', py + 4);
      lbl.textContent = m + 'm';
      dom.labelLayer.appendChild(lbl);
    }
  }
}

// ---- Pomocné funkce ----

function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function addLabels(g, obj, w, h) {
  // Starý styl — zachován pro kompatibilitu, ale nepoužíváme
  addCornerLabels(g, obj);
}

function addCornerLabels(g, obj) {
  // ClipPath aby text nepřesahoval objekt
  const clipId = 'clip-obj-' + obj.id;
  const defs = document.querySelector('#canvas defs');
  // Odstranit starý clip pokud existuje
  const oldClip = document.getElementById(clipId);
  if (oldClip) oldClip.remove();
  const clipPath = svgEl('clipPath');
  clipPath.setAttribute('id', clipId);
  const clipRect = svgEl('rect');
  const pad = 0.15;
  clipRect.setAttribute('x', pad);
  clipRect.setAttribute('y', pad);
  clipRect.setAttribute('width', Math.max(0.3, obj.w - pad * 2));
  clipRect.setAttribute('height', Math.max(0.3, obj.h - pad * 2));
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);

  // Skupina s ořezem
  const labelGroup = svgEl('g');
  labelGroup.setAttribute('clip-path', `url(#${clipId})`);

  const padding = 0.2;
  // Dynamický font — přizpůsobit velikosti objektu
  const availW = obj.w - padding * 2;
  const availH = obj.h - padding * 2;
  // Odhadnout šířku textu: ~0.55 * fontSize * délka
  const nameLen = (obj.name || '').length || 1;
  const fontByW = availW / (nameLen * 0.55);
  const fontByH = availH / 3; // aby se vešel název + rozměry
  const fontSize = Math.max(0.25, Math.min(0.75, fontByW, fontByH));

  // Název — zkrátit pokud se nevejde
  let displayName = obj.name || '';
  const maxChars = Math.floor(availW / (fontSize * 0.55));
  if (displayName.length > maxChars && maxChars > 2) {
    displayName = displayName.substring(0, maxChars - 1) + '…';
  } else if (maxChars <= 2 && displayName.length > 2) {
    displayName = displayName.substring(0, 2);
  }

  const text = svgEl('text');
  text.classList.add('obj-label-corner');
  text.setAttribute('x', padding);
  text.setAttribute('y', padding + fontSize);
  text.setAttribute('font-size', fontSize);
  text.textContent = displayName;
  labelGroup.appendChild(text);

  // Rozměry — malý text pod názvem (jen pokud je dost místa)
  const dimFontSize = fontSize * 0.6;
  if (availH >= fontSize + dimFontSize * 1.5) {
    const dim = svgEl('text');
    dim.classList.add('obj-dim-corner');
    dim.setAttribute('x', padding);
    dim.setAttribute('y', padding + fontSize + dimFontSize * 1.3);
    dim.setAttribute('font-size', dimFontSize);
    dim.textContent = `${obj.w.toFixed(1)}×${obj.h.toFixed(1)} m`;
    labelGroup.appendChild(dim);
  }

  g.appendChild(labelGroup);
}

function getObjectCenter(obj) {
  if (obj.points && obj.points.length >= 3) {
    return getPolygonCentroid(obj.points);
  }
  return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
}

function getPolygonCentroid(pts) {
  let cx = 0, cy = 0;
  pts.forEach(p => { cx += p.x; cy += p.y; });
  return { x: cx / pts.length, y: cy / pts.length };
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

function getPolygonArea(pts) {
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

function getPolygonSignedArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

// Náhled umísťování vjezdu/výjezdu (dvoustupňové)
function renderEntrancePlacePreview(mouseWorld) {
  dom.snapLayer.innerHTML = '';
  if (!state.entrancePlaceMode || !mouseWorld) return;

  const nearest = findNearestArealEdge(mouseWorld.x, mouseWorld.y);
  if (!nearest) return;

  const obj = state.objects.find(o => o.id === nearest.objId);
  if (!obj) return;
  const pts = obj.points;
  const i = nearest.edgeIndex;
  const j = (i + 1) % pts.length;
  const p1 = pts[i], p2 = pts[j];

  const eType = ENTRANCE_TYPES[state.entrancePlaceType] || ENTRANCE_TYPES.vjezd;
  const color = eType.color;

  // Zvýrazněná hrana
  const edgeHighlight = svgEl('line');
  edgeHighlight.setAttribute('x1', p1.x);
  edgeHighlight.setAttribute('y1', p1.y);
  edgeHighlight.setAttribute('x2', p2.x);
  edgeHighlight.setAttribute('y2', p2.y);
  edgeHighlight.setAttribute('stroke', color);
  edgeHighlight.setAttribute('stroke-width', 0.15);
  edgeHighlight.setAttribute('stroke-dasharray', '0.5 0.3');
  edgeHighlight.setAttribute('opacity', '0.5');
  dom.snapLayer.appendChild(edgeHighlight);

  // Aktuální bod kurzoru na hraně
  const cx = p1.x + nearest.t * (p2.x - p1.x);
  const cy = p1.y + nearest.t * (p2.y - p1.y);

  const dot = svgEl('circle');
  dot.setAttribute('cx', cx);
  dot.setAttribute('cy', cy);
  dot.setAttribute('r', 0.6);
  dot.setAttribute('fill', color);
  dot.setAttribute('opacity', '0.8');
  dot.setAttribute('stroke', '#fff');
  dot.setAttribute('stroke-width', 0.1);
  dom.snapLayer.appendChild(dot);

  // Pokud je krok 1, ukázat i první bod a čáru mezi body
  if (state.entrancePlaceStep === 1 && state.entrancePlaceFirstPoint) {
    const fp = state.entrancePlaceFirstPoint;

    // První bod (fixní)
    const dot1 = svgEl('circle');
    dot1.setAttribute('cx', fp.px);
    dot1.setAttribute('cy', fp.py);
    dot1.setAttribute('r', 0.6);
    dot1.setAttribute('fill', color);
    dot1.setAttribute('opacity', '1');
    dot1.setAttribute('stroke', '#fff');
    dot1.setAttribute('stroke-width', 0.12);
    dom.snapLayer.appendChild(dot1);

    // Pokud kurzor na stejné hraně, ukázat preview šířky
    if (nearest.objId === fp.objId && nearest.edgeIndex === fp.edgeIndex) {
      const line = svgEl('line');
      line.setAttribute('x1', fp.px);
      line.setAttribute('y1', fp.py);
      line.setAttribute('x2', cx);
      line.setAttribute('y2', cy);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', 0.3);
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', '0.7');
      dom.snapLayer.appendChild(line);

      // Šířka popisek
      const w = Math.sqrt((cx - fp.px) ** 2 + (cy - fp.py) ** 2);
      if (w > 0.3) {
        const mx = (fp.px + cx) / 2;
        const my = (fp.py + cy) / 2;
        const edx = p2.x - p1.x, edy = p2.y - p1.y;
        const elen = Math.sqrt(edx * edx + edy * edy) || 1;
        const nnx = -edy / elen, nny = edx / elen;
        const wLabel = svgEl('text');
        wLabel.setAttribute('x', mx + nnx * 1.2);
        wLabel.setAttribute('y', my + nny * 1.2);
        wLabel.setAttribute('font-size', 0.6);
        wLabel.setAttribute('fill', color);
        wLabel.setAttribute('text-anchor', 'middle');
        wLabel.setAttribute('dominant-baseline', 'middle');
        wLabel.textContent = w.toFixed(1) + ' m';
        dom.snapLayer.appendChild(wLabel);
      }
    }
  }

  // Text popisek
  const label = svgEl('text');
  label.setAttribute('x', cx);
  label.setAttribute('y', cy - 1.5);
  label.setAttribute('font-size', 0.6);
  label.setAttribute('fill', color);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'middle');
  label.textContent = state.entrancePlaceStep === 1 ? 'Druhý bod šířky' : eType.label;
  dom.snapLayer.appendChild(label);
}

// Náhled kreslení stěny
function renderWallDrawPreview(mouseWorld) {
  dom.snapLayer.innerHTML = '';
  if (!state.wallDrawMode || !state.wallDrawStart || !mouseWorld) return;

  const s = state.wallDrawStart;
  const snapped = { x: snapToGrid(mouseWorld.x), y: snapToGrid(mouseWorld.y) };

  const line = svgEl('line');
  line.setAttribute('x1', s.x);
  line.setAttribute('y1', s.y);
  line.setAttribute('x2', snapped.x);
  line.setAttribute('y2', snapped.y);
  line.setAttribute('stroke', '#a0a0c0');
  line.setAttribute('stroke-width', 0.15);
  line.setAttribute('stroke-dasharray', '0.4 0.3');
  line.setAttribute('opacity', '0.7');
  dom.snapLayer.appendChild(line);

  // Počáteční bod
  const dot1 = svgEl('circle');
  dot1.setAttribute('cx', s.x);
  dot1.setAttribute('cy', s.y);
  dot1.setAttribute('r', 0.5);
  dot1.setAttribute('fill', '#a0a0c0');
  dot1.setAttribute('stroke', '#fff');
  dot1.setAttribute('stroke-width', 0.1);
  dom.snapLayer.appendChild(dot1);

  // Bod kurzoru
  const dot2 = svgEl('circle');
  dot2.setAttribute('cx', snapped.x);
  dot2.setAttribute('cy', snapped.y);
  dot2.setAttribute('r', 0.4);
  dot2.setAttribute('fill', '#a0a0c0');
  dot2.setAttribute('opacity', '0.6');
  dom.snapLayer.appendChild(dot2);

  // Délka
  const dist = Math.sqrt((snapped.x - s.x) ** 2 + (snapped.y - s.y) ** 2);
  if (dist > 0.5) {
    const mx = (s.x + snapped.x) / 2;
    const my = (s.y + snapped.y) / 2;
    const dx = snapped.x - s.x, dy = snapped.y - s.y;
    const len = dist || 1;
    const nx = -dy / len, ny = dx / len;
    const distLabel = svgEl('text');
    distLabel.setAttribute('x', mx + nx * 0.8);
    distLabel.setAttribute('y', my + ny * 0.8);
    distLabel.setAttribute('font-size', 0.55);
    distLabel.setAttribute('fill', '#a0a0c0');
    distLabel.setAttribute('text-anchor', 'middle');
    distLabel.setAttribute('dominant-baseline', 'middle');
    distLabel.textContent = dist.toFixed(1) + ' m';
    dom.snapLayer.appendChild(distLabel);
  }
}

function renderWallSnapHover(snap) {
  dom.snapLayer.innerHTML = '';
  if (!snap) return;
  const edgeLine = svgEl('line');
  edgeLine.setAttribute('x1', snap.edgeStart.x);
  edgeLine.setAttribute('y1', snap.edgeStart.y);
  edgeLine.setAttribute('x2', snap.edgeEnd.x);
  edgeLine.setAttribute('y2', snap.edgeEnd.y);
  edgeLine.setAttribute('stroke', '#f59e0b');
  edgeLine.setAttribute('stroke-width', 0.12);
  edgeLine.setAttribute('stroke-dasharray', '0.4 0.3');
  edgeLine.setAttribute('opacity', '0.5');
  dom.snapLayer.appendChild(edgeLine);
  const dot = svgEl('circle');
  dot.setAttribute('cx', snap.x);
  dot.setAttribute('cy', snap.y);
  dot.setAttribute('r', 0.5);
  dot.setAttribute('fill', '#f59e0b');
  dot.setAttribute('stroke', '#fff');
  dot.setAttribute('stroke-width', 0.08);
  dom.snapLayer.appendChild(dot);
  const label = svgEl('text');
  label.setAttribute('x', snap.x);
  label.setAttribute('y', snap.y - 1.0);
  label.setAttribute('font-size', 0.5);
  label.setAttribute('fill', '#f59e0b');
  label.setAttribute('text-anchor', 'middle');
  label.textContent = snap.distFromStart.toFixed(1) + ' m';
  dom.snapLayer.appendChild(label);
  if (state.wallDrawStart) {
    const line = svgEl('line');
    line.setAttribute('x1', state.wallDrawStart.x);
    line.setAttribute('y1', state.wallDrawStart.y);
    line.setAttribute('x2', snap.x);
    line.setAttribute('y2', snap.y);
    line.setAttribute('stroke', '#a0a0c0');
    line.setAttribute('stroke-width', 0.12);
    line.setAttribute('stroke-dasharray', '0.4 0.3');
    line.setAttribute('opacity', '0.6');
    dom.snapLayer.appendChild(line);
    const startDot = svgEl('circle');
    startDot.setAttribute('cx', state.wallDrawStart.x);
    startDot.setAttribute('cy', state.wallDrawStart.y);
    startDot.setAttribute('r', 0.4);
    startDot.setAttribute('fill', '#22c55e');
    startDot.setAttribute('stroke', '#fff');
    startDot.setAttribute('stroke-width', 0.06);
    dom.snapLayer.appendChild(startDot);
    const wallLen = Math.sqrt((snap.x - state.wallDrawStart.x) ** 2 + (snap.y - state.wallDrawStart.y) ** 2);
    const mx = (state.wallDrawStart.x + snap.x) / 2;
    const my = (state.wallDrawStart.y + snap.y) / 2;
    const wLabel = svgEl('text');
    wLabel.setAttribute('x', mx);
    wLabel.setAttribute('y', my - 0.8);
    wLabel.setAttribute('font-size', 0.5);
    wLabel.setAttribute('fill', '#a0a0c0');
    wLabel.setAttribute('text-anchor', 'middle');
    wLabel.textContent = wallLen.toFixed(1) + ' m';
    dom.snapLayer.appendChild(wLabel);
  }
}

// Náhled umístění vrat na stěnu
function renderGatePlacePreview(obj, wallId, projected) {
  dom.snapLayer.innerHTML = '';
  if (!obj || !obj.walls) return;
  const wall = obj.walls.find(w => w.id === wallId);
  if (!wall) return;

  // Zvýraznit celou stěnu (žlutě)
  const wallLine = svgEl('line');
  wallLine.setAttribute('x1', wall.x1);
  wallLine.setAttribute('y1', wall.y1);
  wallLine.setAttribute('x2', wall.x2);
  wallLine.setAttribute('y2', wall.y2);
  wallLine.setAttribute('stroke', '#f59e0b');
  wallLine.setAttribute('stroke-width', 0.3);
  wallLine.setAttribute('opacity', '0.6');
  wallLine.setAttribute('stroke-linecap', 'round');
  dom.snapLayer.appendChild(wallLine);

  if (projected) {
    // Bod kde budou vrata
    const dot = svgEl('circle');
    dot.setAttribute('cx', projected.px);
    dot.setAttribute('cy', projected.py);
    dot.setAttribute('r', 0.5);
    dot.setAttribute('fill', '#f59e0b');
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', 0.08);
    dom.snapLayer.appendChild(dot);

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
      gateLine.setAttribute('x1', gx1);
      gateLine.setAttribute('y1', gy1);
      gateLine.setAttribute('x2', gx2);
      gateLine.setAttribute('y2', gy2);
      gateLine.setAttribute('stroke', '#22c55e');
      gateLine.setAttribute('stroke-width', 0.4);
      gateLine.setAttribute('opacity', '0.8');
      gateLine.setAttribute('stroke-linecap', 'round');
      dom.snapLayer.appendChild(gateLine);
    }
  }
}

function isPointInPolygon(px, py, pts) {
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
