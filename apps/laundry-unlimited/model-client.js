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
  // záloha v prohlížeči — kdyby uložení na server selhalo nebo se stránka zavřela, data se při dalším otevření obnoví
  function backup() { if (board) { try { localStorage.setItem('lu_mb_bk_' + board.id, JSON.stringify({ rev: rev, t: Date.now(), data: S })); } catch (e) { /* bez paměti */ } } }
  function clearBackup() { if (board) { try { localStorage.removeItem('lu_mb_bk_' + board.id); } catch (e) { /* bez paměti */ } } }
  function changed() { dirtyFlag = true; backup(); status('Ukládám…', false); clearTimeout(saveT); saveT = setTimeout(save, 350); updateBar(); }
  function undo() { if (hi > 0) { hi--; S = JSON.parse(hist[hi]); sel = null; renderAll(); changed(); } }
  function redo() { if (hi < hist.length - 1) { hi++; S = JSON.parse(hist[hi]); sel = null; renderAll(); changed(); } }
  function save(keepalive) {
    if (!board || conflict) return;
    if (saving) { clearTimeout(saveT); saveT = setTimeout(save, 400); return; }
    saving = true; var snap = snapshot(), data = JSON.parse(snap), bid = board.id;
    fetch('/admin/api/model/boards/' + board.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: data, rev: rev }), keepalive: !!keepalive })
      .then(function (r) { return r.json().then(function (j) { j.__status = r.status; return j; }); })
      .then(function (j) {
        saving = false;
        if (!board || board.id !== bid) return;
        if (j.__status === 409) { conflict = true; status('Plátno mezitím změnil někdo jiný — obnov stránku (F5). Tvoje změny zůstaly zálohované v tomto prohlížeči.', true); return; }
        if (!j.ok) { status((j.error || 'Uložení se nepovedlo') + ' — zkusím znovu', true); clearTimeout(saveT); saveT = setTimeout(save, 4000); return; }
        rev = j.rev;
        if (snapshot() !== snap) { backup(); clearTimeout(saveT); saveT = setTimeout(save, 150); return; } // mezitím přibyla další změna
        dirtyFlag = false; clearBackup(); status('Uloženo ✓', false);
      }).catch(function () { saving = false; status('Uložení se nepovedlo (offline?) — zkusím znovu', true); clearTimeout(saveT); saveT = setTimeout(save, 4000); });
  }
  function flush() { if (editing) stopEdit(true); if (dirtyFlag && !conflict) { clearTimeout(saveT); saving = false; save(true); } }
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

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
      if (n.w || n.h) { d.classList.add('sized'); if (n.w) d.style.width = n.w + 'px'; if (n.h) d.style.height = n.h + 'px'; }
      var fm = document.createElement('div'); fm.className = 'fmt';
      fm.innerHTML = '<button type="button" data-f="dn" title="Menší písmo">A−</button><span class="fz">' + (n.fz || 15) + '</span><button type="button" data-f="up" title="Větší písmo">A+</button><button type="button" data-f="b" class="fb' + (n.b ? ' on' : '') + '" title="Tučně">B</button>'
        + [['l', 'Zarovnat doleva', '3,6 21,6 3,12 15,12 3,18 18,18'], ['c', 'Zarovnat na střed', '3,6 21,6 6,12 18,12 4.5,18 19.5,18'], ['r', 'Zarovnat doprava', '3,6 21,6 9,12 21,12 6,18 21,18']].map(function (a) {
          var p = a[2].split(' '), dd = ''; for (var i = 0; i < p.length; i += 2) dd += 'M' + p[i] + ' L' + p[i + 1] + ' ';
          return '<button type="button" data-f="al-' + a[0] + '" class="fa' + ((n.al || 'l') === a[0] ? ' on' : '') + '" title="' + a[1] + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="' + dd + '"/></svg></button>';
        }).join('');
      d.appendChild(fm);
      var pb = document.createElement('button'); pb.type = 'button'; pb.className = 'ed'; pb.title = 'Upravit text (přepsat název)';
      pb.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'; d.appendChild(pb);
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (r) { var z = document.createElement('b'); z.className = 'rz rz-' + r; z.setAttribute('data-r', r); d.appendChild(z); });
      var t = document.createElement('div'); t.className = 't'; t.textContent = n.text || ''; d.appendChild(t);
      if (n.fz) t.style.fontSize = n.fz + 'px'; if (n.b) t.style.fontWeight = '700'; if (n.al === 'c' || n.al === 'r') t.style.textAlign = n.al === 'c' ? 'center' : 'right';
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
  var pendingIns = null;
  // střed Bézierovy křivky (t = 0.5)
  function edgeMid(p, q) {
    var k = Math.max(40, Math.min(160, Math.hypot(q.x - p.x, q.y - p.y) / 2));
    var c1 = { x: p.x + (p.d === 'r' ? k : p.d === 'l' ? -k : 0), y: p.y + (p.d === 'b' ? k : p.d === 't' ? -k : 0) };
    var c2 = { x: q.x + (q.d === 'r' ? k : q.d === 'l' ? -k : 0), y: q.y + (q.d === 'b' ? k : q.d === 't' ? -k : 0) };
    return { x: Math.round((p.x + 3 * c1.x + 3 * c2.x + q.x) / 8), y: Math.round((p.y + 3 * c1.y + 3 * c2.y + q.y) / 8) };
  }
  // vloží nový uzel doprostřed existujícího spojení (A → B  ⇒  A → nový → B)
  function insertOnEdge(eid) {
    var e = S.edges.filter(function (x) { return x.id === eid; })[0]; if (!e) return;
    var a = nodeById(e.from), b = nodeById(e.to); if (!a || !b) return;
    var p = e.fs ? sidePoint(a, e.fs) : anchor(a, b), q = e.ts ? sidePoint(b, e.ts) : anchor(b, a), m = edgeMid(p, q);
    var n = addNode(m.x - 70, m.y - 20, '', a.color || COLORS[0]);
    S.edges = S.edges.filter(function (x) { return x.id !== eid; });
    pendingIns = { nid: n.id, edge: e };
    var e1 = addEdge(a.id, n.id, e.fs, null), e2 = addEdge(n.id, b.id, null, e.ts);
    sel = { t: 'n', id: n.id }; renderAll();
    // vystředění podle skutečné velikosti uzlu
    var s = size(n); n.x = Math.round(m.x - s.w / 2); n.y = Math.round(m.y - s.h / 2); renderAll();
    startEdit(n.id, true);
  }
  function drawEdges() {
    var h = '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7aa8ff"/></marker><marker id="ars" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#22e6ff"/></marker></defs>';
    S.edges.forEach(function (e) {
      var a = nodeById(e.from), b = nodeById(e.to); if (!a || !b) return;
      var p = e.fs ? sidePoint(a, e.fs) : anchor(a, b), q = e.ts ? sidePoint(b, e.ts) : anchor(b, a), d = curve(p, q), on = sel && sel.t === 'e' && sel.id === e.id;
      h += '<path d="' + d + '" fill="none" stroke="' + (on ? '#22e6ff' : '#7aa8ff') + '" stroke-width="' + (on ? 3 : 2) + '" marker-end="url(#' + (on ? 'ars' : 'ar') + ')" opacity="' + (on ? 1 : .85) + '"/>';
      h += '<path class="eh" data-e="' + e.id + '" d="' + d + '" fill="none" stroke="transparent" stroke-width="16" style="pointer-events:stroke;cursor:pointer"/>';
      if (on) { var m = edgeMid(p, q); h += '<g class="ei" data-e="' + e.id + '" style="pointer-events:all;cursor:pointer"><title>Vložit uzel doprostřed spojení</title><circle cx="' + m.x + '" cy="' + m.y + '" r="13" fill="#0b1630" stroke="#22e6ff" stroke-width="2"/><path d="M' + (m.x - 6) + ',' + m.y + ' H' + (m.x + 6) + ' M' + m.x + ',' + (m.y - 6) + ' V' + (m.y + 6) + '" stroke="#22e6ff" stroke-width="2.5" stroke-linecap="round"/></g>'; }
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
    if (!txt && e.isNew) { S.nodes = S.nodes.filter(function (x) { return x.id !== n.id; }); S.edges = S.edges.filter(function (x) { return x.from !== n.id && x.to !== n.id; }); sel = null;
      // zrušené vložení doprostřed spojení → vrátit původní spojení
      if (pendingIns && pendingIns.nid === n.id) { S.edges.push(pendingIns.edge); }
      pendingIns = null; renderAll(); return; }
    if (pendingIns && pendingIns.nid === n.id) pendingIns = null;
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
    if (t.closest && t.closest('.ed')) return; // tužka — obslouží se v click
    var rz = t.closest && t.closest('.rz');
    if (rz && nd && !nd.classList.contains('edit')) {
      var rid = nd.getAttribute('data-id'), rn = nodeById(rid), rs = size(rn); select({ t: 'n', id: rid });
      drag = { type: 'resize', id: rid, dir: rz.getAttribute('data-r'), sx: ev.clientX, sy: ev.clientY, x0: rn.x, y0: rn.y, w0: rs.w, h0: rs.h, hadW: !!rn.w, hadH: !!rn.h, moved: false };
      view.setPointerCapture(ev.pointerId); ev.preventDefault(); return;
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
    var ei = t.closest && t.closest('.ei');
    if (ei) { ev.preventDefault(); insertOnEdge(ei.getAttribute('data-e')); return; }
    if (eh) { select({ t: 'e', id: eh.getAttribute('data-e') }); return; }
    if (nd) return;
    select(null);
    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: V.x, vy: V.y }; view.setPointerCapture(ev.pointerId); view.classList.add('pan');
  });
  view.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    if (drag.type === 'pan') { V.x = drag.vx + ev.clientX - drag.sx; V.y = drag.vy + ev.clientY - drag.sy; applyView(); }
    else if (drag.type === 'resize') {
      var dx0 = (ev.clientX - drag.sx) / V.k, dy0 = (ev.clientY - drag.sy) / V.k;
      if (!drag.moved && Math.hypot(dx0, dy0) < 2) return; drag.moved = true;
      var rn2 = nodeById(drag.id), dr = drag.dir, W = drag.w0, H = drag.h0, X = drag.x0, Y = drag.y0;
      if (dr.indexOf('e') >= 0) W = Math.max(60, drag.w0 + dx0);
      if (dr.indexOf('w') >= 0) { W = Math.max(60, drag.w0 - dx0); X = drag.x0 + drag.w0 - W; }
      if (dr.indexOf('s') >= 0) H = Math.max(34, drag.h0 + dy0);
      if (dr.indexOf('n') >= 0) { H = Math.max(34, drag.h0 - dy0); Y = drag.y0 + drag.h0 - H; }
      var horiz = /[ew]/.test(dr), vert = /[ns]/.test(dr);
      rn2.x = Math.round(X); rn2.y = Math.round(Y);
      if (horiz || drag.hadW) rn2.w = Math.round(horiz ? W : drag.w0);
      if (vert || drag.hadH) rn2.h = Math.round(vert ? H : drag.h0);
      var re = elOf(rn2.id); re.classList.add('sized'); re.style.left = rn2.x + 'px'; re.style.top = rn2.y + 'px';
      re.style.width = rn2.w ? rn2.w + 'px' : ''; re.style.height = rn2.h ? rn2.h + 'px' : '';
      drawEdges();
    }
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
    if ((d.type === 'move' || d.type === 'resize') && d.moved) commit();
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
  // formát textu uzlu (velikost, tučně) — lišta se ukazuje při úpravě textu; mousedown nesmí vzít focus textu
  view.addEventListener('mousedown', function (ev) { if (ev.target.closest && ev.target.closest('.fmt')) ev.preventDefault(); });
  var FZ = [10, 12, 13, 15, 18, 22, 28, 36, 48, 64];
  view.addEventListener('click', function (ev) {
    var fb = ev.target.closest && ev.target.closest('.fmt button');
    if (fb) {
      var fn = fb.closest('.n'), fnode = nodeById(fn.getAttribute('data-id')), f = fb.getAttribute('data-f'); if (!fnode) return;
      var cur = fnode.fz || 15, i = 0; FZ.forEach(function (v, k) { if (Math.abs(v - cur) < Math.abs(FZ[i] - cur)) i = k; });
      if (f === 'up') fnode.fz = FZ[Math.min(FZ.length - 1, i + 1)]; else if (f === 'dn') fnode.fz = FZ[Math.max(0, i - 1)]; else if (f === 'b') fnode.b = !fnode.b;
      else if (f.indexOf('al-') === 0) { var av = f.slice(3); if (av === 'l') delete fnode.al; else fnode.al = av; }
      if (fnode.fz === 15) delete fnode.fz; if (!fnode.b) delete fnode.b;
      var tt = fn.querySelector('.t'); tt.style.fontSize = fnode.fz ? fnode.fz + 'px' : ''; tt.style.fontWeight = fnode.b ? '700' : '';
      tt.style.textAlign = fnode.al === 'c' ? 'center' : fnode.al === 'r' ? 'right' : '';
      fn.querySelectorAll('.fa').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === 'al-' + (fnode.al || 'l')); });
      fn.querySelector('.fz').textContent = fnode.fz || 15; fn.querySelector('.fb').classList.toggle('on', !!fnode.b);
      drawEdges(); commit(); return;
    }
    var pe = ev.target.closest && ev.target.closest('.ed'); if (!pe) return;
    var pn = pe.closest('.n'); if (!pn) return; var pid = pn.getAttribute('data-id');
    select({ t: 'n', id: pid }); startEdit(pid, false);
  });
  view.addEventListener('dblclick', function (ev) {
    var nd = ev.target.closest && ev.target.closest('.n');
    if (nd) { startEdit(nd.getAttribute('data-id'), false); return; }
    var eh2 = ev.target.closest && ev.target.closest('.eh');
    if (eh2) { insertOnEdge(eh2.getAttribute('data-e')); return; }
    if (ev.target.closest && (ev.target.closest('.ei') || ev.target.closest('#mb-empty'))) return;
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
      // obnova nedoukládaných změn ze zálohy (pokud server od té doby nikdo neměnil)
      var restored = false;
      try {
        var bk = JSON.parse(localStorage.getItem('lu_mb_bk_' + id) || 'null');
        if (bk && bk.data && Array.isArray(bk.data.nodes) && bk.rev === j.rev && JSON.stringify({ nodes: bk.data.nodes, edges: bk.data.edges || [] }) !== snapshot()) { S = { nodes: bk.data.nodes, edges: bk.data.edges || [] }; restored = true; }
        else if (bk) localStorage.removeItem('lu_mb_bk_' + id);
      } catch (e) { /* bez zálohy */ }
      fillBoards(); renderAll(); status('', false);
      if (restored) { hist = [snapshot()]; hi = 0; changed(); }
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

  // ── AI zpracování mapy: pochopení, mezery, dopracování, plán ──
  var AI = { res: null, tab: 'p', busy: false, added: {}, err: '' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function uAttr(u) { var ids = arr(u).filter(function (id) { return nodeById(String(id)); }); return ids.length ? ' data-u="' + esc(ids.join(',')) + '" title="Klikni — ukáže to v mapě"' : ''; }
  function focusNodes(ids) {
    var list = ids.map(nodeById).filter(Boolean); if (!list.length) return;
    var r = view.getBoundingClientRect(), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (n) { var s = size(n); x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h); });
    var k = Math.max(0.35, Math.min(1, Math.min((r.width * 0.5) / (x1 - x0 + 120), (r.height * 0.7) / (y1 - y0 + 120))));
    V.k = k; V.x = (r.width * 0.32) - ((x0 + x1) / 2) * k; V.y = r.height / 2 - ((y0 + y1) / 2) * k; applyView();
    nodesEl.querySelectorAll('.n').forEach(function (e) { e.classList.toggle('hl', ids.indexOf(e.getAttribute('data-id')) >= 0); });
    setTimeout(function () { nodesEl.querySelectorAll('.n.hl').forEach(function (e) { e.classList.remove('hl'); }); }, 4000);
  }
  var AI_TABS = [['a', '💬 Poradce'], ['p', 'Jak jsem to pochopil'], ['m', 'Mezery a rizika'], ['d', 'Dopracování mapy'], ['f', 'Plán uvedení']];
  function aiRender() {
    var R = AI.res, body = $('#mb-ai-body'), tabs = $('#mb-ai-tabs');
    var cnt = R ? { m: arr(R.mezery).length + arr(R.rizika).length, d: arr(R.dopracovani).filter(function (x, i) { return !AI.added[x.ref || ('i' + i)]; }).length } : {};
    tabs.innerHTML = AI_TABS.map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (AI.tab === t[0] ? 'on' : '') + '">' + t[1] + (cnt[t[0]] ? ' (' + cnt[t[0]] + ')' : '') + '</button>'; }).join('');
    var h = '';
    if (AI.tab === 'a') { chatRender(); return; }
    if (!R) {
      body.innerHTML = AI.busy ? '<div class="ld"><div class="sp"></div>AI čte celou mapu (' + S.nodes.length + ' uzlů, ' + S.edges.length + ' spojení)…<br>trvá to asi 1–2 minuty</div>' : (AI.err ? '<div class="ld" style="color:#fca5a5">' + esc(AI.err) + '</div>' : '') + '<div class="ld">Celý rozbor mapy ještě nebyl spuštěn.<br><button type="button" id="mb-ai-retry" style="margin-top:12px">✨ Zpracovat mapu</button></div>';
      return;
    }
    if (AI.tab === 'p') {
      h += '<h4>Podstata</h4><div class="it">' + esc(R.souhrn) + '</div>';
      if (arr(R.aktery).length) h += '<h4>Kdo je kdo</h4>' + R.aktery.map(function (a) { return '<div class="it"' + uAttr(a.uzly) + '><b>' + esc(a.nazev) + '</b><div class="m">' + esc(a.role) + '</div></div>'; }).join('');
      if (arr(R.toky).length) h += '<h4>Hlavní toky</h4>' + R.toky.map(function (t) { return '<div class="it"' + uAttr(t.uzly) + '><b>' + esc(t.nazev) + '</b><ol>' + arr(t.kroky).map(function (k) { return '<li>' + esc(k) + '</li>'; }).join('') + '</ol></div>'; }).join('');
      if (arr(R.prijmy).length) h += '<h4>Jak se vydělává</h4>' + R.prijmy.map(function (p) { return '<div class="it"' + uAttr(p.uzly) + '><b>' + esc(p.zdroj) + '</b> — ' + esc(p.hodnota) + '<div class="m">platí: ' + esc(p['platí'] || p.plati) + ' · ' + esc(p.jak) + '</div></div>'; }).join('');
      if (arr(R.predpoklady).length) h += '<h4>Co jsem si musel domyslet</h4><div class="it"><ul>' + R.predpoklady.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    } else if (AI.tab === 'm') {
      h += '<h4>Co chybí nebo je nejasné</h4>' + (arr(R.mezery).map(function (m) {
        var p = String(m.priorita || '').toLowerCase(), c = p.indexOf('vys') === 0 ? 'v' : p.indexOf('st') === 0 ? 's' : 'n';
        return '<div class="it"' + uAttr(m.uzly) + '><b>' + esc(m.otazka) + '</b><span class="pr ' + c + '">' + esc(m.priorita || '') + '</span><div class="m">' + esc(m.proc) + '</div><button type="button" class="ask" data-q="' + esc('Pojďme vyřešit tuto mezeru: ' + m.otazka) + '">💬 Probrat s poradcem</button></div>';
      }).join('') || '<div class="m">Nic zásadního.</div>');
      if (arr(R.rizika).length) h += '<h4>Rizika</h4>' + R.rizika.map(function (r) { return '<div class="it"><b>' + esc(r.riziko) + '</b><div class="m">Dopad: ' + esc(r.dopad) + '</div><div class="m">Opatření: ' + esc(r.opatreni) + '</div></div>'; }).join('');
    } else if (AI.tab === 'd') {
      var list = arr(R.dopracovani), open = list.filter(function (x, i) { return !AI.added[x.ref || ('i' + i)]; });
      h += '<div class="m" style="margin-bottom:10px">Návrh nových uzlů, které v mapě chybí, aby šlo firmu provozovat. Odškrtni, co nechceš; přidají se zeleně a napojí na uvedené uzly (jde vrátit zpět Ctrl+Z).</div>';
      h += open.length ? open.map(function (x, i) {
        var k = x.ref || ('i' + list.indexOf(x)), par = arr(x.navazuje).map(function (id) { var n = nodeById(String(id)); if (n) return n.text; var o = list.filter(function (y) { return y.ref === id; })[0]; return o ? o.text : ''; }).filter(Boolean).join(', ');
        return '<label class="it"><input type="checkbox" class="aick" data-k="' + esc(k) + '" checked><span><b>' + esc(x.text) + '</b><div class="m">' + esc(x.duvod) + '</div>' + (par ? '<div class="m">↳ navazuje na: ' + esc(par) + '</div>' : '') + '</span></label>';
      }).join('') + '<button type="button" class="go" id="mb-ai-add">Přidat vybrané do plátna</button>' : '<div class="m">Všechny návrhy jsou už v plátně ✓</div>';
    } else {
      h += arr(R.plan).map(function (f) { return '<div class="it"><b>Fáze ' + esc(f.faze) + ': ' + esc(f.nazev) + '</b> <span class="m">· ' + esc(f.doba) + '</span><ul>' + arr(f.kroky).map(function (k) { return '<li>' + esc(k) + '</li>'; }).join('') + '</ul><div class="m">Výstup: ' + esc(f.vystup) + '</div></div>'; }).join('');
      if (arr(R.kpi).length) h += '<h4>Co sledovat (KPI)</h4>' + R.kpi.map(function (k) { return '<div class="it"><b>' + esc(k.nazev) + '</b> — cíl: ' + esc(k.cil) + '<div class="m">' + esc(k.jak_merit) + '</div></div>'; }).join('');
    }
    if (AI.truncated) h += '<div class="m" style="margin-top:12px;color:#fca5a5">Odpověď AI byla zkrácena — spusť zpracování znovu.</div>';
    body.innerHTML = h;
  }
  function aiOpen() {
    $('#mb-ai-p').style.display = 'flex';
    if (!AI.res) { try { var c = JSON.parse(localStorage.getItem('lu_mb_ai_' + (board && board.id)) || 'null'); if (c && c.res) { AI.res = c.res; AI.truncated = false; AI.added = c.added || {}; } } catch (e) { /* bez cache */ } }
    if (!CH.msgs.length) chLoad();
    if (AI.res || AI.busy) aiRender(); else aiRun(); // poprvé se mapa zpracuje hned; mezitím jde přepnout na záložku Poradce
  }
  function aiRun() {
    if (!board || AI.busy) return;
    if (S.nodes.length < 2) { AI.err = 'Na plátně je zatím málo uzlů.'; aiRender(); return; }
    AI.busy = true; AI.res = null; AI.added = {}; AI.err = ''; if (AI.tab !== 'a') AI.tab = 'p'; aiRender();
    var bid = board.id;
    req('/admin/api/model/boards/' + bid + '/analyze', { data: S }).then(function (j) {
      AI.busy = false;
      if (!board || board.id !== bid) return;
      if (!j.ok) { AI.err = j.error || 'Zpracování se nepovedlo'; aiRender(); return; }
      AI.res = j.result; AI.truncated = !!j.truncated; if (AI.tab !== 'a') AI.tab = 'p'; aiSave(); aiRender();
    }).catch(function () { AI.busy = false; AI.err = 'Spojení se serverem se přerušilo.'; aiRender(); });
  }
  function aiSave() { if (board && AI.res) { try { localStorage.setItem('lu_mb_ai_' + board.id, JSON.stringify({ res: AI.res, added: AI.added, t: Date.now() })); } catch (e) { /* bez paměti */ } } }
  // rozmístění nových uzlů: vedle prvního rodiče, mimo kolize
  function layoutNew(newIds, parents) {
    var placed = {}, rects = S.nodes.filter(function (n) { return newIds.indexOf(n.id) < 0; }).map(function (n) { var s = size(n); return { x: n.x, y: n.y, w: s.w, h: s.h }; });
    function free(x, y, w, h) { return !rects.some(function (r) { return x < r.x + r.w + 24 && x + w + 24 > r.x && y < r.y + r.h + 18 && y + h + 18 > r.y; }); }
    for (var pass = 0; pass < 6; pass++) {
      newIds.forEach(function (id) {
        if (placed[id]) return; var n = nodeById(id), ps = (parents[id] || []).map(nodeById).filter(function (p) { return p && (newIds.indexOf(p.id) < 0 || placed[p.id]); });
        if (!ps.length && pass < 5) return; var p = ps[0];
        var w = Math.max(120, Math.min(260, 24 + String(n.text).length * 8)), h = 56;
        var x = p ? p.x + size(p).w + 90 : viewCenterWorld().x, y = p ? p.y : viewCenterWorld().y, guard = 0;
        while (!free(x, y, w, h) && guard < 60) { guard++; y += 76; if (guard % 15 === 0) { y = p ? p.y : y; x += 40; } }
        n.x = Math.round(x); n.y = Math.round(y); placed[id] = true; rects.push({ x: n.x, y: n.y, w: w, h: h });
      });
    }
  }
  function aiAddNodes() {
    var R = AI.res, list = arr(R.dopracovani), pick = {};
    $('#mb-ai-body').querySelectorAll('.aick').forEach(function (c) { if (c.checked) pick[c.getAttribute('data-k')] = true; });
    var items = list.map(function (x, i) { return { x: x, k: x.ref || ('i' + i) }; }).filter(function (o) { return pick[o.k] && !AI.added[o.k]; });
    if (!items.length) return;
    var idOf = {}; // ref → nové id uzlu
    items.forEach(function (o) { var n = addNode(0, 0, String(o.x.text || '').slice(0, 200), '#34d399'); idOf[o.k] = n.id; idOf[o.x.ref || o.k] = n.id; });
    var newIds = items.map(function (o) { return idOf[o.k]; }), parents = {};
    items.forEach(function (o) {
      arr(o.x.navazuje).forEach(function (t) {
        var to = nodeById(String(t)) ? String(t) : idOf[String(t)]; if (!to || to === idOf[o.k]) return;
        addEdge(to, idOf[o.k], null, null); (parents[idOf[o.k]] = parents[idOf[o.k]] || []).push(to);
      });
    });
    layoutNew(newIds, parents);
    items.forEach(function (o) { AI.added[o.k] = true; });
    renderAll(); commit(); aiSave(); aiRender();
    status('Přidáno ' + items.length + ' uzlů (zeleně) ✓', false);
    focusNodes(newIds);
  }
  function aiMarkdown() {
    var R = AI.res; if (!R) return;
    var L = ['# ' + (board ? board.name : 'Business model') + ' — rozbor mapy', '', '## Podstata', R.souhrn || ''];
    function sec(t, items, fn) { if (arr(items).length) { L.push('', '## ' + t); items.forEach(function (x) { L.push(fn(x)); }); } }
    sec('Kdo je kdo', R.aktery, function (a) { return '- **' + a.nazev + '** — ' + a.role; });
    sec('Hlavní toky', R.toky, function (t) { return '- **' + t.nazev + '**\n' + arr(t.kroky).map(function (k, i) { return '  ' + (i + 1) + '. ' + k; }).join('\n'); });
    sec('Jak se vydělává', R.prijmy, function (p) { return '- **' + p.zdroj + '** — ' + p.hodnota + ' (platí: ' + (p['platí'] || p.plati || '') + '; ' + p.jak + ')'; });
    sec('Předpoklady', R.predpoklady, function (x) { return '- ' + x; });
    sec('Mezery (co rozhodnout před spuštěním)', R.mezery, function (m) { return '- [' + (m.priorita || '') + '] **' + m.otazka + '** — ' + m.proc; });
    sec('Rizika', R.rizika, function (r) { return '- **' + r.riziko + '** — dopad: ' + r.dopad + '; opatření: ' + r.opatreni; });
    sec('Plán uvedení do života', R.plan, function (f) { return '### Fáze ' + f.faze + ': ' + f.nazev + ' (' + f.doba + ')\n' + arr(f.kroky).map(function (k) { return '- ' + k; }).join('\n') + '\n*Výstup:* ' + f.vystup + '\n'; });
    sec('KPI', R.kpi, function (k) { return '- **' + k.nazev + '** — cíl: ' + k.cil + ' (' + k.jak_merit + ')'; });
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' })); a.download = 'rozbor-mapy.md'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  // ── AI poradce nad mapou: rozhovor, hlídání logiky, zápis dohodnutých změn na plátno ──
  var CH = { msgs: [], busy: false };
  function chLoad() { CH.msgs = []; CH.busy = false; try { var c = JSON.parse(localStorage.getItem('lu_mb_ch_' + (board && board.id)) || 'null'); if (c && Array.isArray(c.msgs)) CH.msgs = c.msgs; } catch (e) { /* bez historie */ } }
  function chSave() { if (board) { try { localStorage.setItem('lu_mb_ch_' + board.id, JSON.stringify({ msgs: CH.msgs.slice(-60) })); } catch (e) { /* bez paměti */ } } }
  function short(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  var OPS = ['pridat_uzel', 'upravit_uzel', 'smazat_uzel', 'pridat_spojeni', 'smazat_spojeni'];
  function cleanOps(z) {
    return arr(z).filter(function (o) { return o && OPS.indexOf(o.op) >= 0; }).slice(0, 40).map(function (o) {
      return { op: o.op, ref: o.ref ? String(o.ref) : undefined, id: o.id ? String(o.id) : undefined, text: o.text != null ? String(o.text).slice(0, 2000) : undefined, od: Array.isArray(o.od) ? o.od.map(String) : (o.od ? [String(o.od)] : []), 'do': Array.isArray(o['do']) ? o['do'].map(String) : (o['do'] ? [String(o['do'])] : []) };
    });
  }
  function opDescribe(ops) {
    var refText = {}; ops.forEach(function (o) { if (o.op === 'pridat_uzel' && o.ref) refText[o.ref] = o.text; });
    var nm = function (id) { var n = nodeById(id); return '„' + short(n ? n.text : (refText[id] || id), 36) + '“'; };
    return ops.map(function (o) {
      if (o.op === 'pridat_uzel') return '<div>➕ nový uzel <b>„' + esc(short(o.text, 60)) + '“</b>' + (o.od.length ? ' ← ' + esc(o.od.map(nm).join(', ')) : '') + (o['do'].length ? ' → ' + esc(o['do'].map(nm).join(', ')) : '') + '</div>';
      if (o.op === 'upravit_uzel') { var n = nodeById(o.id); return '<div>✎ ' + esc(nm(o.id)) + ' → <b>„' + esc(short(o.text, 70)) + '“</b>' + (n ? '' : ' <span class="m">(uzel nenalezen)</span>') + '</div>'; }
      if (o.op === 'smazat_uzel') return '<div>🗑 smazat uzel ' + esc(nm(o.id)) + '</div>';
      if (o.op === 'pridat_spojeni') return '<div>↳ spojit ' + esc(nm(o.od[0])) + ' → ' + esc(nm(o['do'][0])) + '</div>';
      return '<div>✂ zrušit spojení ' + esc(nm(o.od[0])) + ' → ' + esc(nm(o['do'][0])) + '</div>';
    }).join('');
  }
  // jednoduchý Markdown (tučné, nadpisy, odrážky, číslování) — vstup se nejdřív escapuje
  function mdLite(t) {
    var out = [], list = null;
    // technická ID uzlů se v textu nikdy neukazují: ID v závorce se odstraní, ostatní se nahradí textem uzlu
    t = String(t || '');
    var idsRe = S.nodes.length ? new RegExp('\\s*\\(\\s*(?:`?(?:' + S.nodes.map(function (n) { return n.id.replace(/[^\w-]/g, ''); }).filter(Boolean).join('|') + ')`?\\s*[,;]?\\s*)+\\)', 'g') : null;
    if (idsRe) {
      t = t.replace(idsRe, '');
      t = t.replace(new RegExp('`?\\b(' + S.nodes.map(function (n) { return n.id.replace(/[^\w-]/g, ''); }).filter(Boolean).join('|') + ')\\b`?', 'g'), function (_, id) { var n = nodeById(id); return n ? '„' + short(n.text, 40) + '“' : ''; });
    }
    t = t.replace(/`([^`]+)`/g, '$1');
    var inl = function (x) { return esc(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>'); };
    var close = function () { if (list) { out.push('</' + list + '>'); list = null; } };
    t.split(/\r?\n/).forEach(function (ln) {
      var m;
      if ((m = /^\s*[-•*]\s+(.*)$/.exec(ln))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inl(m[1]) + '</li>'); }
      else if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(ln))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li value="' + m[1] + '">' + inl(m[2]) + '</li>'); }
      else if ((m = /^\s*#{1,4}\s+(.*)$/.exec(ln)) || (m = /^\s*\*\*([^*]+?)\*\*:?\s*$/.exec(ln))) { close(); out.push('<div class="mh">' + esc(m[1].replace(/\*\*/g, '')) + '</div>'); }
      else if (!ln.trim()) { close(); }
      else { close(); out.push('<p>' + inl(ln) + '</p>'); }
    });
    close(); return out.join('');
  }
  function chatRender() {
    var body = $('#mb-ai-body'), h = '';
    if (!CH.msgs.length) {
      var open = AI.res ? arr(AI.res.mezery).length : 0;
      h += '<div class="cb a">Ahoj, jsem tvůj poradce nad touto mapou. Znám všechny uzly a spojení a vidím je i při každé odpovědi znovu, takže se mnou můžeš mapu průběžně měnit.<br><br>Pomůžu ti probrat otevřené otázky' + (open ? ' (v rozboru jich je ' + open + ')' : '') + ', pohlídám, aby spolu věci logicky a v toku navazovaly, a co spolu dohodneme, zapíšu do mapy — ty to jedním kliknutím potvrdíš.</div>' +
        '<div class="chips"><button type="button" data-send="Začni nejdůležitější otevřenou otázkou, která blokuje spuštění.">Začni nejdůležitější otázkou</button><button type="button" data-send="Zkontroluj logiku a tok celé mapy a řekni mi, kde to nedává smysl nebo chybí návaznost.">Zkontroluj logiku a tok</button><button type="button" data-send="Projdi všechny uzly s otazníky nebo chybějícími hodnotami a postupně se mě na ně zeptej.">Projít všechna ???</button></div>';
    }
    CH.msgs.forEach(function (m, i) {
      if (m.role === 'user') { h += '<div class="cb u">' + esc(m.text) + '</div>'; return; }
      h += '<div class="cb a' + (m.err ? '' : ' md') + '"' + (m.err ? ' style="color:#fca5a5;white-space:pre-wrap"' : '') + '>' + (m.err ? esc(m.text) : mdLite(m.text));
      if (m.zmeny && m.zmeny.length) h += '<div class="chg"><b>Navržené změny na plátně:</b>' + opDescribe(m.zmeny) + '<button type="button" class="ap" data-i="' + i + '"' + (m.applied ? ' disabled' : '') + '>' + (m.applied ? 'Provedeno ✓' : '✓ Provést na plátně') + '</button></div>';
      if (i === CH.msgs.length - 1 && !CH.busy && m.quick && m.quick.length) h += '<div class="chips">' + m.quick.map(function (q) { return '<button type="button" data-send="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
      h += '</div>';
    });
    if (CH.busy) h += '<div class="cb a m">Poradce přemýšlí…</div>';
    body.innerHTML = h; body.scrollTop = body.scrollHeight;
    $('#mb-ai-send').disabled = CH.busy;
  }
  function chBrief() {
    var R = AI.res; if (!R) return '';
    return 'Souhrn: ' + String(R.souhrn || '') + '\nOtevřené otázky z rozboru: ' + arr(R.mezery).map(function (m) { return '- ' + m.otazka; }).join('\n');
  }
  function chatSend(text) {
    text = String(text || '').trim(); if (!text || CH.busy || !board) return;
    var hist = CH.msgs.filter(function (m) { return !m.err; }).map(function (m) { return { role: m.role, content: m.text + (m.role === 'assistant' && m.zmeny && m.zmeny.length ? (m.applied ? ' [změny byly provedeny na plátně]' : ' [navržené změny zatím nebyly provedeny]') : '') }; });
    CH.msgs.push({ role: 'user', text: text }); CH.busy = true; chSave(); AI.tab = 'a'; aiRender();
    var bid = board.id;
    req('/admin/api/model/boards/' + bid + '/chat', { data: S, message: text, history: hist, brief: chBrief() }).then(function (j) {
      CH.busy = false; if (!board || board.id !== bid) return;
      if (!j.ok) CH.msgs.push({ role: 'assistant', text: j.error || 'Poradce neodpověděl — zkus to znovu.', err: true });
      else CH.msgs.push({ role: 'assistant', text: String(j.odpoved || ''), zmeny: cleanOps(j.zmeny), quick: arr(j.rychle).map(String).slice(0, 4) });
      chSave(); if (AI.tab === 'a') aiRender();
    }).catch(function () { CH.busy = false; CH.msgs.push({ role: 'assistant', text: 'Spojení se serverem se přerušilo — zkus to znovu.', err: true }); if (AI.tab === 'a') aiRender(); });
  }
  function chatApply(i) {
    var m = CH.msgs[i]; if (!m || m.applied || !m.zmeny) return;
    var ops = m.zmeny, idOf = {}, newIds = [], parents = {}, touched = [], n = 0;
    var rid = function (x) { return nodeById(x) ? x : idOf[x]; };
    ops.forEach(function (o) { if (o.op === 'pridat_uzel' && o.text) { var nn = addNode(0, 0, o.text, '#34d399'); idOf[o.ref || nn.id] = nn.id; o._id = nn.id; newIds.push(nn.id); } });
    ops.forEach(function (o) {
      if (o.op === 'pridat_uzel' && o._id) {
        o.od.forEach(function (x) { var f = rid(x); if (f && addEdge(f, o._id)) { (parents[o._id] = parents[o._id] || []).push(f); } });
        o['do'].forEach(function (x) { var t = rid(x); if (t) addEdge(o._id, t); }); n++;
      } else if (o.op === 'upravit_uzel') { var nd = nodeById(o.id); if (nd && o.text != null) { nd.text = o.text; touched.push(nd.id); n++; } }
      else if (o.op === 'smazat_uzel') { if (nodeById(o.id)) { S.nodes = S.nodes.filter(function (x) { return x.id !== o.id; }); S.edges = S.edges.filter(function (e) { return e.from !== o.id && e.to !== o.id; }); n++; } }
      else if (o.op === 'pridat_spojeni') { var a = rid(o.od[0]), b = rid(o['do'][0]); if (a && b && addEdge(a, b)) n++; }
      else if (o.op === 'smazat_spojeni') { var a2 = rid(o.od[0]), b2 = rid(o['do'][0]); var before = S.edges.length; S.edges = S.edges.filter(function (e) { return !(e.from === a2 && e.to === b2); }); if (S.edges.length < before) n++; }
    });
    if (newIds.length) layoutNew(newIds, parents);
    ops.forEach(function (o) { delete o._id; });
    if (sel && sel.t === 'n' && !nodeById(sel.id)) sel = null;
    m.applied = true; renderAll(); if (n) commit(); chSave(); aiRender();
    status(n ? 'Poradce upravil plátno (' + n + ' změn) ✓' : 'Nebylo co změnit', false);
    var f = newIds.concat(touched); if (f.length) focusNodes(f);
  }
  $('#mb-ai-send').onclick = function () { var t = $('#mb-ai-in'); var v = t.value; t.value = ''; chatSend(v); };
  $('#mb-ai-in').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('#mb-ai-send').click(); } });
  $('#mb-ai').onclick = function () { var p = $('#mb-ai-p'); if (p.style.display === 'none') aiOpen(); else p.style.display = 'none'; };
  $('#mb-ai-x').onclick = function () { $('#mb-ai-p').style.display = 'none'; };
  $('#mb-ai-re').onclick = function () { if (AI.busy) return; if (AI.res && !confirm('Zpracovat mapu znovu? Aktuální rozbor se nahradí novým.')) return; aiRun(); };
  $('#mb-ai-md').onclick = aiMarkdown;
  $('#mb-ai-p').addEventListener('click', function (ev) {
    var t = ev.target, tb = t.closest && t.closest('#mb-ai-tabs button'); if (tb) { AI.tab = tb.getAttribute('data-t'); aiRender(); $('#mb-ai-body').scrollTop = 0; return; }
    var ask = t.closest && t.closest('.ask'); if (ask) { chatSend(ask.getAttribute('data-q')); return; }
    var ap = t.closest && t.closest('.ap'); if (ap) { chatApply(Number(ap.getAttribute('data-i'))); return; }
    var sd = t.closest && t.closest('[data-send]'); if (sd) { chatSend(sd.getAttribute('data-send')); return; }
    if (t.id === 'mb-ai-add') { aiAddNodes(); return; }
    if (t.id === 'mb-ai-retry') { aiRun(); return; }
    var it = t.closest && t.closest('.it[data-u]'); if (it && !(t.closest('label'))) focusNodes(it.getAttribute('data-u').split(','));
  });
  // při přepnutí plátna se rozbor vyčistí (každé plátno má vlastní, uložený v prohlížeči)
  var _lb = loadBoard; loadBoard = function (id) { AI.res = null; AI.added = {}; AI.busy = false; AI.err = ''; CH.msgs = []; CH.busy = false; if ($('#mb-ai-p').style.display !== 'none') $('#mb-ai-p').style.display = 'none'; return _lb(id); };

  // ── Start ──
  req('/admin/api/model/boards').then(function (j) {
    if (!j.ok) { status(j.error || 'Plátna se nepodařilo načíst', true); return; }
    boards = j.boards || []; var want = 0; try { want = Number(localStorage.getItem('lu_mb_board')) || 0; } catch (e) { want = 0; }
    var pick = boards.find(function (b) { return b.id === want; }) || boards[0];
    if (pick) loadBoard(pick.id);
  });
  window.addEventListener('resize', function () { drawEdges(); });
})();
