// Laundry Unlimited — Modelace business modelu: plátno s myšlenkovou mapou (klient)
// Uzly se dají přetahovat, spojovat, barevně označit; plátno se posouvá a zoomuje; ukládá se automaticky do DB.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var view = $('#mb-view'), world = $('#mb-world'), svg = $('#mb-svg'), nodesEl = $('#mb-nodes');
  var COLORS = ['#22e6ff', '#3b82f6', '#a78bfa', '#34d399', '#fbbf24', '#fb923c', '#f87171', '#94a3b8'];
  var S = { nodes: [], edges: [] };          // data plátna
  var V = { x: 0, y: 0, k: 1 };               // pohled (posun + zoom) — pamatuje se jen v prohlížeči
  var board = null, boards = [], rev = 0;
  var sel = null;                              // { t: 'n'|'e', id }
  var hist = [], hi = -1, saveT = null, saving = false, dirtyFlag = false, conflict = false;
  var seq = Date.now();
  var uid = function (p) { return p + (seq++).toString(36) + Math.random().toString(36).slice(2, 5); };

  function req(url, body) {
    return fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { j.__status = r.status; return j; }); });
  }
  function status(t, bad) { var s = $('#mb-st'); s.textContent = t; s.style.color = bad ? '#fca5a5' : '#86efac'; }

  // ── Stav, historie, ukládání ──
  function snapshot() { return JSON.stringify(S); }
  function commit() {
    hist = hist.slice(0, hi + 1); hist.push(snapshot()); if (hist.length > 80) hist.shift(); hi = hist.length - 1;
    changed();
  }
  function changed() { dirtyFlag = true; status('Neuloženo…', false); clearTimeout(saveT); saveT = setTimeout(save, 700); updateBar(); }
  function undo() { if (hi > 0) { hi--; S = JSON.parse(hist[hi]); sel = null; renderAll(); changed(); } }
  function redo() { if (hi < hist.length - 1) { hi++; S = JSON.parse(hist[hi]); sel = null; renderAll(); changed(); } }
  function save(keepalive) {
    if (!board || conflict) return;
    if (saving) { clearTimeout(saveT); saveT = setTimeout(save, 400); return; }
    saving = true; var data = JSON.parse(snapshot());
    fetch('/admin/api/model/boards/' + board.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: data, rev: rev }), keepalive: !!keepalive })
      .then(function (r) { return r.json().then(function (j) { j.__status = r.status; return j; }); })
      .then(function (j) {
        saving = false;
        if (j.__status === 409) { conflict = true; status('Plátno mezitím změnil někdo jiný — obnov stránku (F5). Tvoje poslední změny se neuložily.', true); return; }
        if (!j.ok) { status(j.error || 'Uložení se nepovedlo', true); return; }
        rev = j.rev; dirtyFlag = false; status('Uloženo ✓', false);
      }).catch(function () { saving = false; status('Uložení se nepovedlo (offline?)', true); });
  }
  window.addEventListener('beforeunload', function () { if (dirtyFlag && !conflict) save(true); });

  // ── Pomocné ──
  function nodeById(id) { return S.nodes.find(function (n) { return n.id === id; }); }
  function elOf(id) { return nodesEl.querySelector('[data-id="' + id + '"]'); }
  function size(n) { var e = elOf(n.id); return e ? { w: e.offsetWidth, h: e.offsetHeight } : { w: 160, h: 50 }; }
  function toWorld(cx, cy) { var r = view.getBoundingClientRect(); return { x: (cx - r.left - V.x) / V.k, y: (cy - r.top - V.y) / V.k }; }
  function viewCenterWorld() { var r = view.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }

  // ── Vykreslení ──
  function applyView() {
    world.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(' + V.k + ')';
    var g = 28 * V.k; view.style.backgroundSize = g + 'px ' + g + 'px'; view.style.backgroundPosition = V.x + 'px ' + V.y + 'px';
    $('#mb-zoom').textContent = Math.round(V.k * 100) + ' %';
    if (board) { try { localStorage.setItem('lu_mb_v_' + board.id, JSON.stringify(V)); } catch (e) { /* bez paměti */ } }
  }
  function renderAll() {
    nodesEl.innerHTML = '';
    S.nodes.forEach(function (n) {
      var d = document.createElement('div'); d.className = 'n' + (sel && sel.t === 'n' && sel.id === n.id ? ' sel' : ''); d.setAttribute('data-id', n.id);
      d.style.left = n.x + 'px'; d.style.top = n.y + 'px'; d.style.setProperty('--c', n.color || COLORS[0]);
      var t = document.createElement('div'); t.className = 't'; t.textContent = n.text || ''; d.appendChild(t);
      ['t', 'r', 'b', 'l'].forEach(function (sd) { var h = document.createElement('i'); h.className = 'h h-' + sd; h.setAttribute('data-s', sd); h.title = 'Přetáhni na jiný uzel (nebo do prázdna) pro spojení'; d.appendChild(h); });
      nodesEl.appendChild(d);
    });
    drawEdges(); updateBar();
  }
  function anchor(n, other) {
    var a = size(n), b = size(other);
    var cx = n.x + a.w / 2, cy = n.y + a.h / 2, ox = other.x + b.w / 2, oy = other.y + b.h / 2, dx = ox - cx, dy = oy - cy;
    if (Math.abs(dx) * a.h >= Math.abs(dy) * a.w) return dx >= 0 ? { x: n.x + a.w, y: cy, d: 'r' } : { x: n.x, y: cy, d: 'l' };
    return dy >= 0 ? { x: cx, y: n.y + a.h, d: 'b' } : { x: cx, y: n.y, d: 't' };
  }
  function sidePoint(n, sd) {
    var a = size(n);
    return sd === 'r' ? { x: n.x + a.w, y: n.y + a.h / 2, d: 'r' } : sd === 'l' ? { x: n.x, y: n.y + a.h / 2, d: 'l' } : sd === 't' ? { x: n.x + a.w / 2, y: n.y, d: 't' } : { x: n.x + a.w / 2, y: n.y + a.h, d: 'b' };
  }
  var OPP = { r: 'l', l: 'r', t: 'b', b: 't' };
  function curve(p, q) {
    var k = Math.max(40, Math.min(160, Math.hypot(q.x - p.x, q.y - p.y) / 2));
    var c1 = { x: p.x + (p.d === 'r' ? k : p.d === 'l' ? -k : 0), y: p.y + (p.d === 'b' ? k : p.d === 't' ? -k : 0) };
    var c2 = { x: q.x + (q.d === 'r' ? k : q.d === 'l' ? -k : 0), y: q.y + (q.d === 'b' ? k : q.d === 't' ? -k : 0) };
    return 'M' + p.x + ',' + p.y + ' C' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + q.x + ',' + q.y;
  }
  function drawEdges() {
    var h = '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7aa8ff"/></marker><marker id="ars" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#22e6ff"/></marker></defs>';
    S.edges.forEach(function (e) {
      var a = nodeById(e.from), b = nodeById(e.to); if (!a || !b) return;
      var p = e.fs ? sidePoint(a, e.fs) : anchor(a, b), q = e.ts ? sidePoint(b, e.ts) : anchor(b, a), d = curve(p, q), on = sel && sel.t === 'e' && sel.id === e.id;
      h += '<path d="' + d + '" fill="none" stroke="' + (on ? '#22e6ff' : '#7aa8ff') + '" stroke-width="' + (on ? 3 : 2) + '" marker-end="url(#' + (on ? 'ars' : 'ar') + ')" opacity="' + (on ? 1 : .85) + '"/>';
      h += '<path class="eh" data-e="' + e.id + '" d="' + d + '" fill="none" stroke="transparent" stroke-width="16" style="pointer-events:stroke;cursor:pointer"/>';
    });
    svg.innerHTML = h;
  }
  function select(s) {
    sel = s;
    nodesEl.querySelectorAll('.n').forEach(function (e) { e.classList.toggle('sel', !!(sel && sel.t === 'n' && sel.id === e.getAttribute('data-id'))); });
    drawEdges(); updateBar();
  }
  function updateBar() {
    var on = !!(sel && sel.t === 'n'), n = on ? nodeById(sel.id) : null;
    $('#mb-selbox').style.display = sel ? 'inline-flex' : 'none';
    $('#mb-colors').style.display = on ? '' : 'none';
    $('#mb-child').style.display = on ? '' : 'none';
    if (n) { document.querySelectorAll('#mb-colors button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-c') === (n.color || COLORS[0])); }); }
    $('#mb-undo').disabled = hi <= 0; $('#mb-redo').disabled = hi >= hist.length - 1;
    $('#mb-empty').style.display = S.nodes.length ? 'none' : '';
  }

  // ── Úpravy ──
  function addNode(x, y, text, color) {
    var n = { id: uid('n'), x: Math.round(x), y: Math.round(y), text: text || '', color: color || COLORS[0] };
    S.nodes.push(n); return n;
  }
  function addEdge(a, b, fs, ts) {
    if (a === b) return null;
    if (S.edges.some(function (e) { return (e.from === a && e.to === b) || (e.from === b && e.to === a); })) return null;
    var e = { id: uid('e'), from: a, to: b }; if (fs) e.fs = fs; if (ts) e.ts = ts; S.edges.push(e); return e;
  }
  function removeSel() {
    if (!sel) return;
    if (sel.t === 'n') { S.nodes = S.nodes.filter(function (n) { return n.id !== sel.id; }); S.edges = S.edges.filter(function (e) { return e.from !== sel.id && e.to !== sel.id; }); }
    else S.edges = S.edges.filter(function (e) { return e.id !== sel.id; });
    sel = null; renderAll(); commit();
  }
  var editing = null;
  function startEdit(id, isNew) {
    var d = elOf(id), n = nodeById(id); if (!d || !n) return;
    if (editing) stopEdit(true);
    var t = $('.t', d); t.contentEditable = 'true'; d.classList.add('edit'); t.focus();
    var r = document.createRange(); r.selectNodeContents(t); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    editing = { id: id, old: n.text, isNew: !!isNew, el: t };
    t.onblur = function () { stopEdit(true); };
    t.onkeydown = function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); stopEdit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); stopEdit(false); }
      else if (ev.key === 'Tab') { ev.preventDefault(); var cur = editing && editing.id; stopEdit(true); if (cur) addChild(cur); }
      setTimeout(drawEdges, 0);
    };
    t.oninput = function () { drawEdges(); };
  }
  function stopEdit(ok) {
    if (!editing) return; var e = editing; editing = null;
    var n = nodeById(e.id), t = e.el; t.onblur = null; t.contentEditable = 'false'; var d = t.parentNode; if (d) d.classList.remove('edit');
    if (!n) return;
    var txt = ok ? String(t.innerText != null ? t.innerText : t.textContent || '').replace(/ /g, ' ').trim().slice(0, 2000) : e.old;
    if (!txt && e.isNew) { S.nodes = S.nodes.filter(function (x) { return x.id !== n.id; }); S.edges = S.edges.filter(function (x) { return x.from !== n.id && x.to !== n.id; }); sel = null; renderAll(); if (hist.length) { /* nový prázdný uzel se do historie nezapisuje */ } return; }
    var changedTxt = txt !== (e.old || '');
    n.text = txt; t.textContent = txt; drawEdges();
    if (changedTxt || e.isNew) commit();
  }
  function addChild(pid) {
    var p = nodeById(pid); if (!p) return;
    var sz = size(p), kids = S.edges.filter(function (e) { return e.from === pid; }).length;
    var n = addNode(p.x + sz.w + 90, p.y + kids * 80 - (kids ? 0 : 0), '', p.color);
    addEdge(pid, n.id, 'r', 'l'); sel = { t: 'n', id: n.id }; renderAll(); startEdit(n.id, true);
  }
  function newNodeAtCenter() {
    var c = viewCenterWorld(); var n = addNode(c.x - 80 + (Math.random() * 40 - 20), c.y - 25 + (Math.random() * 40 - 20), '', COLORS[0]);
    sel = { t: 'n', id: n.id }; renderAll(); startEdit(n.id, true);
  }

  // ── Myš / dotyk ──
  var drag = null;
  view.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    var t = ev.target;
    if (editing && !(t.closest && t.closest('.n.edit'))) stopEdit(true);
    var h = t.closest && t.closest('.h'), nd = t.closest && t.closest('.n'), eh = t.closest && t.closest('.eh');
    if (h && nd) {
      var id = nd.getAttribute('data-id'); drag = { type: 'link', from: id, side: h.getAttribute('data-s') || 'r' }; view.setPointerCapture(ev.pointerId); ev.preventDefault(); select({ t: 'n', id: id }); return;
    }
    if (nd && !nd.classList.contains('edit')) {
      var id2 = nd.getAttribute('data-id'), n = nodeById(id2); select({ t: 'n', id: id2 });
      var w = toWorld(ev.clientX, ev.clientY); drag = { type: 'move', id: id2, ox: w.x - n.x, oy: w.y - n.y, moved: false, sx: ev.clientX, sy: ev.clientY, kids: [] };
      // navazující uzly (po šipkách dál) se pohybují spolu s tažením; Alt = jen samotný uzel
      if (!ev.altKey) {
        var seen = {}; seen[id2] = 1; var qu = [id2];
        while (qu.length) { var cur = qu.shift(); S.edges.forEach(function (e) { if (e.from === cur && !seen[e.to]) { seen[e.to] = 1; qu.push(e.to); var k = nodeById(e.to); if (k) drag.kids.push({ n: k, x: k.x, y: k.y }); } }); }
      }
      drag.nx = n.x; drag.ny = n.y;
      view.setPointerCapture(ev.pointerId); return;
    }
    if (eh) { select({ t: 'e', id: eh.getAttribute('data-e') }); return; }
    if (nd) return;
    select(null);
    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: V.x, vy: V.y }; view.setPointerCapture(ev.pointerId); view.classList.add('pan');
  });
  view.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    if (drag.type === 'pan') { V.x = drag.vx + ev.clientX - drag.sx; V.y = drag.vy + ev.clientY - drag.sy; applyView(); }
    else if (drag.type === 'move') {
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return; drag.moved = true;
      var n = nodeById(drag.id), w = toWorld(ev.clientX, ev.clientY); n.x = Math.round(w.x - drag.ox); n.y = Math.round(w.y - drag.oy);
      var e = elOf(n.id); e.style.left = n.x + 'px'; e.style.top = n.y + 'px';
      var dx = n.x - drag.nx, dy = n.y - drag.ny;
      drag.kids.forEach(function (k) { k.n.x = k.x + dx; k.n.y = k.y + dy; var ke = elOf(k.n.id); if (ke) { ke.style.left = k.n.x + 'px'; ke.style.top = k.n.y + 'px'; } });
      drawEdges();
    } else if (drag.type === 'link') {
      var a = nodeById(drag.from), w2 = toWorld(ev.clientX, ev.clientY), p = sidePoint(a, drag.side);
      var q = { x: w2.x, y: w2.y, d: OPP[p.d] };
      drawEdges(); svg.insertAdjacentHTML('beforeend', '<path d="' + curve(p, q) + '" fill="none" stroke="#22e6ff" stroke-width="2" stroke-dasharray="6 5"/>');
      nodesEl.querySelectorAll('.n').forEach(function (x) { x.classList.remove('tgt'); });
      var under = document.elementFromPoint(ev.clientX, ev.clientY), un = under && under.closest && under.closest('.n');
      if (un && un.getAttribute('data-id') !== drag.from) un.classList.add('tgt');
    }
  });
  function endDrag(ev) {
    if (!drag) return; var d = drag; drag = null; view.classList.remove('pan');
    try { view.releasePointerCapture(ev.pointerId); } catch (e) { /* už uvolněno */ }
    nodesEl.querySelectorAll('.n').forEach(function (x) { x.classList.remove('tgt'); });
    if (d.type === 'move' && d.moved) commit();
    else if (d.type === 'link') {
      var under = document.elementFromPoint(ev.clientX, ev.clientY), un = under && under.closest && under.closest('.n');
      if (un && un.getAttribute('data-id') !== d.from) { if (addEdge(d.from, un.getAttribute('data-id'), d.side, nearestSide(un, ev.clientX, ev.clientY))) { renderAll(); commit(); } else drawEdges(); }
      else if (!un) { // puštěno do prázdna → nový uzel navázaný na původní (jako v myšlenkové mapě)
        var w = toWorld(ev.clientX, ev.clientY), src = nodeById(d.from), n = addNode(w.x - 20, w.y - 20, '', src ? src.color : COLORS[0]);
        addEdge(d.from, n.id, d.side, OPP[d.side]); sel = { t: 'n', id: n.id }; renderAll(); startEdit(n.id, true);
      } else drawEdges();
    }
  }
  function nearestSide(el, cx, cy) {
    var r = el.getBoundingClientRect(), dl = cx - r.left, dr = r.right - cx, dt = cy - r.top, db = r.bottom - cy, m = Math.min(dl, dr, dt, db);
    return m === dl ? 'l' : m === dr ? 'r' : m === dt ? 't' : 'b';
  }
  view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);
  view.addEventListener('dblclick', function (ev) {
    var nd = ev.target.closest && ev.target.closest('.n');
    if (nd) { startEdit(nd.getAttribute('data-id'), false); return; }
    if (ev.target.closest && (ev.target.closest('.eh') || ev.target.closest('#mb-empty'))) return;
    var w = toWorld(ev.clientX, ev.clientY), n = addNode(w.x - 70, w.y - 20, '', COLORS[0]); sel = { t: 'n', id: n.id }; renderAll(); startEdit(n.id, true);
  });
  view.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = view.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    var k = Math.max(0.2, Math.min(2.5, V.k * Math.exp(-ev.deltaY * 0.0015)));
    V.x = mx - (mx - V.x) * (k / V.k); V.y = my - (my - V.y) * (k / V.k); V.k = k; applyView();
  }, { passive: false });
  // Dva prsty = zoom (mobil)
  var pts = new Map(), pinch0 = null;
  view.addEventListener('pointerdown', function (e) { pts.set(e.pointerId, e); if (pts.size === 2) { var a = Array.from(pts.values()); pinch0 = { d: Math.hypot(a[0].clientX - a[1].clientX, a[0].clientY - a[1].clientY), k: V.k }; drag = null; } });
  view.addEventListener('pointermove', function (e) {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
    if (pts.size === 2 && pinch0) { var a = Array.from(pts.values()), d = Math.hypot(a[0].clientX - a[1].clientX, a[0].clientY - a[1].clientY), r = view.getBoundingClientRect(), mx = (a[0].clientX + a[1].clientX) / 2 - r.left, my = (a[0].clientY + a[1].clientY) / 2 - r.top; var k = Math.max(0.2, Math.min(2.5, pinch0.k * d / pinch0.d)); V.x = mx - (mx - V.x) * (k / V.k); V.y = my - (my - V.y) * (k / V.k); V.k = k; applyView(); }
  });
  var endPt = function (e) { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; };
  view.addEventListener('pointerup', endPt); view.addEventListener('pointercancel', endPt);

  function zoomBy(f) { var r = view.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2, k = Math.max(0.2, Math.min(2.5, V.k * f)); V.x = mx - (mx - V.x) * (k / V.k); V.y = my - (my - V.y) * (k / V.k); V.k = k; applyView(); }
  function fit() {
    var r = view.getBoundingClientRect();
    if (!S.nodes.length) { V = { x: r.width / 2, y: r.height / 2, k: 1 }; applyView(); return; }
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    S.nodes.forEach(function (n) { var s = size(n); x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h); });
    var pad = 80, k = Math.max(0.2, Math.min(1.2, Math.min((r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0))));
    V = { k: k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k }; applyView();
  }

  // ── Klávesy ──
  document.addEventListener('keydown', function (ev) {
    if (editing) return;
    var tag = (ev.target && ev.target.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    var mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
    else if (mod && (ev.key === 'y' || ev.key === 'Y')) { ev.preventDefault(); redo(); }
    else if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) { ev.preventDefault(); removeSel(); }
    else if (ev.key === 'Enter' && sel && sel.t === 'n') { ev.preventDefault(); startEdit(sel.id, false); }
    else if (ev.key === 'Tab' && sel && sel.t === 'n') { ev.preventDefault(); addChild(sel.id); }
    else if (ev.key === 'Escape') select(null);
  });

  // ── Panel nástrojů ──
  $('#mb-add').onclick = newNodeAtCenter;
  $('#mb-child').onclick = function () { if (sel && sel.t === 'n') addChild(sel.id); };
  $('#mb-del').onclick = removeSel;
  $('#mb-undo').onclick = undo; $('#mb-redo').onclick = redo;
  $('#mb-zin').onclick = function () { zoomBy(1.2); }; $('#mb-zout').onclick = function () { zoomBy(1 / 1.2); }; $('#mb-fit').onclick = fit;
  $('#mb-colors').innerHTML = COLORS.map(function (c) { return '<button type="button" data-c="' + c + '" title="Barva" style="background:' + c + '"></button>'; }).join('');
  $('#mb-colors').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || !sel || sel.t !== 'n') return; var n = nodeById(sel.id); if (!n) return;
    n.color = b.getAttribute('data-c'); var e = elOf(n.id); if (e) e.style.setProperty('--c', n.color); commit();
  });
  // Plátna
  function fillBoards() { $('#mb-sel').innerHTML = boards.map(function (b) { return '<option value="' + b.id + '"' + (board && b.id === board.id ? ' selected' : '') + '>' + String(b.name).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }) + '</option>'; }).join(''); }
  function loadBoard(id) {
    return req('/admin/api/model/boards/' + id).then(function (j) {
      if (!j.ok) { status(j.error || 'Plátno se nepodařilo načíst', true); return; }
      board = { id: j.id, name: j.name }; rev = j.rev; conflict = false; dirtyFlag = false;
      S = { nodes: (j.data && j.data.nodes) || [], edges: (j.data && j.data.edges) || [] };
      sel = null; hist = [snapshot()]; hi = 0; try { localStorage.setItem('lu_mb_board', String(id)); } catch (e) { /* bez paměti */ }
      fillBoards(); renderAll(); status('', false);
      var v = null; try { v = JSON.parse(localStorage.getItem('lu_mb_v_' + id) || 'null'); } catch (e) { v = null; }
      if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.k)) { V = v; applyView(); } else fit();
      $('#mb-title').textContent = j.name;
    });
  }
  $('#mb-sel').onchange = function () { if (dirtyFlag) save(); loadBoard(Number($('#mb-sel').value)); };
  $('#mb-newb').onclick = function () {
    var name = prompt('Název nového plátna:', 'Nové plátno'); if (!name) return;
    req('/admin/api/model/boards', { name: name }).then(function (j) { if (!j.ok) { alert(j.error || 'Chyba'); return; } boards.push({ id: j.id, name: j.name }); loadBoard(j.id); });
  };
  $('#mb-ren').onclick = function () {
    if (!board) return; var name = prompt('Nový název plátna:', board.name); if (!name || name === board.name) return;
    req('/admin/api/model/boards/' + board.id + '/rename', { name: name }).then(function (j) { if (!j.ok) { alert(j.error || 'Chyba'); return; } var oldName = board.name; board.name = j.name;
      // Úvodní uzel nese název plátna — při přejmenování plátna se přepíše i on (jen pokud ho nikdo ručně nezměnil)
      var renamed = false; S.nodes.forEach(function (n) { if (String(n.text || '').trim() === String(oldName).trim()) { n.text = j.name; renamed = true; } });
      if (renamed) { renderAll(); commit(); }
      var b = boards.find(function (x) { return x.id === board.id; }); if (b) b.name = j.name; fillBoards(); $('#mb-title').textContent = j.name; });
  };
  $('#mb-delb').onclick = function () {
    if (!board || boards.length < 2) { alert('Poslední plátno nejde smazat.'); return; }
    if (!confirm('Smazat plátno „' + board.name + '“ včetně všeho, co na něm je? Akci nelze vrátit.')) return;
    req('/admin/api/model/boards/' + board.id + '/delete', {}).then(function (j) { if (!j.ok) { alert(j.error || 'Chyba'); return; } boards = boards.filter(function (b) { return b.id !== board.id; }); loadBoard(boards[0].id); });
  };

  // ── Start ──
  req('/admin/api/model/boards').then(function (j) {
    if (!j.ok) { status(j.error || 'Plátna se nepodařilo načíst', true); return; }
    boards = j.boards || []; var want = 0; try { want = Number(localStorage.getItem('lu_mb_board')) || 0; } catch (e) { want = 0; }
    var pick = boards.find(function (b) { return b.id === want; }) || boards[0];
    if (pick) loadBoard(pick.id);
  });
  window.addEventListener('resize', function () { drawEdges(); });
})();
