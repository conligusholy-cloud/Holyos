// Laundry Unlimited — Úkoly týmu: seznam (standardní filtry ColFilters), rychlé filtry, detail s historií a komentáři
(function () {
  'use strict';
  var D = { tasks: [], people: [], me: {}, statuses: {}, priorities: {} };
  var QF = 'mine', T = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var OPEN = function (t) { return t.status !== 'done' && t.status !== 'cancel'; };
  var dOnly = function (v) { return v ? String(v).slice(0, 10) : ''; };
  var fd = function (v) { if (!v) return ''; var d = new Date(String(v).length === 10 ? v + 'T12:00:00' : v); return d.toLocaleDateString('cs-CZ'); };
  var fdt = function (v) { return v ? new Date(v).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
  var today = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var late = function (t) { return OPEN(t) && t.due_date && dOnly(t.due_date) < today(); };
  function call(url, body) { return fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'Spojení selhalo' }; }); }
  function st(msg) { var e = $('#tk-st'); if (e) e.textContent = msg || ''; }

  var QUICK = [
    ['mine', 'Moje', function (t) { return t.assignee_key === D.me.key && OPEN(t); }],
    ['given', 'Zadal(a) jsem', function (t) { return t.creator_key === D.me.key && t.assignee_key !== D.me.key && OPEN(t); }],
    ['open', 'Všechny otevřené', OPEN],
    ['late', 'Po termínu', late],
    ['done', 'Hotové / zrušené', function (t) { return !OPEN(t); }],
    ['all', 'Vše', function () { return true; }],
  ];
  function quickBar() {
    $('#tk-q').innerHTML = QUICK.map(function (x) { var n = D.tasks.filter(x[2]).length; return '<button type="button" data-q="' + x[0] + '"' + (x[0] === QF ? ' class="on"' : '') + '>' + esc(x[1]) + '<b>' + n + '</b></button>'; }).join('');
  }
  function stSel(t) {
    return '<select class="st" data-st="' + t.id + '" title="Změnit stav">' + Object.keys(D.statuses).map(function (k) { return '<option value="' + k + '"' + (k === t.status ? ' selected' : '') + '>' + esc(D.statuses[k]) + '</option>'; }).join('') + '</select>';
  }
  function rowHtml(t) {
    return '<tr data-id="' + t.id + '"' + (OPEN(t) ? '' : ' class="dn"') + '>' +
      '<td><div class="tt">' + esc(t.title) + '</div>' + (t.description ? '<div class="ds">' + esc(t.description) + '</div>' : '') + '</td>' +
      '<td>' + stSel(t) + '</td>' +
      '<td class="p-' + esc(t.priority) + '">' + esc(D.priorities[t.priority] || t.priority) + '</td>' +
      '<td>' + (t.assignee_name ? esc(t.assignee_name) + (t.assignee_key === D.me.key ? ' <span class="mut">(já)</span>' : '') : '<span class="mut">nepřiřazeno</span>') + '</td>' +
      '<td>' + esc(t.creator_name || '') + '</td>' +
      '<td' + (late(t) ? ' class="late" title="Po termínu"' : '') + '>' + (t.due_date ? fd(dOnly(t.due_date)) + (late(t) ? ' ⚠' : '') : '<span class="mut">—</span>') + '</td>' +
      '<td class="mut">' + fdt(t.updated_at) + '</td>' +
      '<td class="lcm">' + (t.last_comment ? '<div class="lct" title="' + esc(t.last_comment) + '">' + esc(t.last_comment) + '</div><div class="mut lcs">' + esc(t.last_comment_by || '') + ' · ' + fdt(t.last_comment_at) + '</div>' : '<span class="mut">—</span>') + '</td>' +
      '<td class="mut">' + (t.comments ? '💬 ' + t.comments : '') + (t.files ? ' 📎 ' + t.files : '') + '</td></tr>';
  }
  function build() {
    $('#tk').innerHTML = '<thead><tr><th>Úkol</th><th>Stav</th><th>Priorita</th><th>Řešitel</th><th>Zadal</th><th>Termín</th><th>Změna</th><th>Poslední komentář</th><th></th></tr></thead><tbody></tbody>';
    var cols = [
      { key: 'title', label: 'Úkol', type: 'text', ph: 'Hledat…', get: function (t) { return t.title + ' ' + (t.description || ''); }, sortGet: function (t) { return t.title; }, enum: false },
      { key: 'status', label: 'Stav', type: 'text', get: function (t) { return D.statuses[t.status] || t.status; }, enum: true },
      { key: 'priority', label: 'Priorita', type: 'text', get: function (t) { return D.priorities[t.priority] || t.priority; }, sortGet: function (t) { return { urgent: 0, high: 1, normal: 2, low: 3 }[t.priority]; }, enum: true },
      { key: 'assignee', label: 'Řešitel', type: 'text', get: function (t) { return t.assignee_name || 'nepřiřazeno'; }, enum: true },
      { key: 'creator', label: 'Zadal', type: 'text', get: function (t) { return t.creator_name || ''; }, enum: true },
      { key: 'due', label: 'Termín', type: 'date', ph: 'dd.mm.rrrr', get: function (t) { return t.due_date ? dOnly(t.due_date) : null; } },
      { key: 'upd', label: 'Změna', type: 'date', ph: 'dd.mm.rrrr', get: function (t) { return t.updated_at; } },
      { key: 'lcm', label: 'Poslední komentář', type: 'text', ph: 'Hledat…', get: function (t) { return t.last_comment || ''; }, sortGet: function (t) { return t.last_comment_at || ''; } },
      null,
    ];
    if (window.ColFilters && window.ColFilters.table) T = window.ColFilters.table({ table: '#tk', columns: cols, renderRow: rowHtml, noun: 'tasků', emptyText: 'Žádné tasky. Nový založíte tlačítkem „＋ Nový task“.' });
  }
  function render() {
    quickBar();
    var f = (QUICK.filter(function (x) { return x[0] === QF; })[0] || QUICK[0])[2];
    var rows = D.tasks.filter(f);
    if (T) T.setRows(rows);
    else $('#tk tbody').innerHTML = rows.map(rowHtml).join('') || '<tr><td colspan="10" class="mut">Žádné tasky.</td></tr>';
  }
  function load(openId) {
    return call('/admin/api/tasks').then(function (j) {
      if (!j.ok) { st(j.error || 'Chyba načtení'); return; }
      D = j; if (!T) build(); render(); st('');
      if (openId) openTask(openId);
    });
  }

  // ── Okno: nový úkol / detail ──
  function closeModal() { var m = $('.mov'); if (m) m.remove(); document.removeEventListener('keydown', onEsc); }
  function onEsc(e) { if (e.key === 'Escape') closeModal(); }
  function peopleOpts(sel) {
    return '<option value="">— nepřiřazeno —</option>' + D.people.map(function (p) { return '<option value="' + esc(p.key) + '"' + (p.key === sel ? ' selected' : '') + '>' + esc(p.name) + (p.key === D.me.key ? ' (já)' : '') + '</option>'; }).join('');
  }
  // ── Přílohy ──
  var MAXF = 15 * 1024 * 1024, MAXN = 20;
  var fsz = function (b) { return b >= 1048576 ? (Math.round(b / 104857.6) / 10) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' kB' : b + ' B'; };
  function fico(m) { m = String(m || ''); return /^image\//.test(m) ? '🖼' : /pdf/.test(m) ? '📕' : /zip|rar|7z|compressed/.test(m) ? '🗜' : /sheet|excel|csv/.test(m) ? '📊' : /word|document|rtf/.test(m) ? '📝' : /^video\//.test(m) ? '🎞' : /^audio\//.test(m) ? '🎵' : '📎'; }
  function upload(tid, file) {
    return fetch('/admin/api/tasks/' + tid + '/files?name=' + encodeURIComponent(file.name || 'priloha'), { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'Spojení selhalo' }; });
  }
  function attItem(tid, f) {
    var url = '/admin/api/tasks/' + tid + '/files/' + f.id, img = /^image\/(png|jpe?g|gif|webp)$/i.test(f.mime || '');
    return '<div class="at">' + (img ? '<img src="' + url + '" alt="">' : '<span class="ic">' + fico(f.mime) + '</span>') + '<div><a href="' + url + '" target="_blank" rel="noopener">' + esc(f.name) + '</a><div class="sz">' + fsz(f.size) + ' · ' + esc(f.author_name || '') + ' · ' + fdt(f.created_at) + '</div></div><a class="sz" href="' + url + '?dl=1" title="Stáhnout">⬇</a><button type="button" class="x" data-fd="' + f.id + '" title="Smazat přílohu">✕</button></div>';
  }
  function attBox() {
    return '<div class="atw"><label>Přílohy</label><div class="atl" id="at-list"></div><label class="dz" id="at-dz">📎 Přetáhni sem soubory, vlož je (Ctrl+V) nebo klikni pro výběr — libovolný typ, do 15 MB<input type="file" multiple id="at-in"></label><div class="attst" id="at-st"></div></div>';
  }
  // Výběr souborů: tlačítko, přetažení i vložení ze schránky (např. snímek obrazovky)
  function wireAttach(o, onFiles) {
    var dz = o.querySelector('#at-dz'), inp = o.querySelector('#at-in');
    var take = function (list) { var a = [].slice.call(list || []); if (a.length) onFiles(a); };
    inp.onchange = function () { take(inp.files); inp.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { take(e.dataTransfer && e.dataTransfer.files); });
    o.addEventListener('paste', function (e) { var fs = []; [].forEach.call((e.clipboardData && e.clipboardData.items) || [], function (it) { if (it.kind === 'file') { var f = it.getAsFile(); if (f) { if (!f.name || f.name === 'image.png') { try { f = new File([f], 'snimek-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.png', { type: f.type }); } catch (x) { /* ponechat */ } } fs.push(f); } } }); if (fs.length) { e.preventDefault(); onFiles(fs); } });
  }
  function formHtml(t) {
    t = t || { status: 'todo', priority: 'normal' };
    var opt = function (map, v) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); };
    return '<label>Co je potřeba udělat *</label><input name="title" maxlength="200" value="' + esc(t.title || '') + '" required autocomplete="off">' +
      '<label>Popis / zadání</label><textarea name="description" maxlength="8000" placeholder="Podrobnosti, odkazy, co má být výsledkem…">' + esc(t.description || '') + '</textarea>' +
      '<div class="mrow"><div><label>Řešitel</label><select name="assignee_key">' + peopleOpts(t.assignee_key || (t.id ? '' : '')) + '</select></div>' +
      '<div><label>Termín</label><input name="due_date" type="date" value="' + esc(dOnly(t.due_date)) + '"></div>' +
      '<div><label>Priorita</label><select name="priority">' + opt(D.priorities, t.priority) + '</select></div>' +
      '<div><label>Stav</label><select name="status">' + opt(D.statuses, t.status) + '</select></div></div>' + attBox();
  }
  function readForm(box) { var d = {}; box.querySelectorAll('input[name],textarea[name],select[name]').forEach(function (i) { d[i.name] = i.value; }); return d; }
  function modal(title, inner) {
    closeModal();
    var o = document.createElement('div'); o.className = 'mov';
    o.innerHTML = '<div class="mbox"><button type="button" class="mx" aria-label="Zavřít">✕</button><h3>' + title + '</h3>' + inner + '</div>';
    document.body.appendChild(o); o.querySelector('.mx').onclick = closeModal; document.addEventListener('keydown', onEsc);
    return o;
  }
  function newTask() {
    var o = modal('Nový task', '<form>' + formHtml(null) + '<div class="mer"></div><div class="mact"><span class="mut">Řešiteli přijde upozornění do Velínu (kdo v HolyOS není, dostane e-mail).</span><button class="btn sm" type="submit">Založit task</button></div></form>');
    var f = o.querySelector('form'); f.querySelector('input[name="title"]').focus();
    var PF = [];
    function draw() {
      o.querySelector('#at-list').innerHTML = PF.map(function (x, i) { return '<div class="at"><span class="ic">' + fico(x.type) + '</span><div><b>' + esc(x.name) + '</b><div class="sz">' + fsz(x.size) + ' · nahraje se po založení tasku</div></div><button type="button" class="x" data-pf="' + i + '" title="Odebrat">✕</button></div>'; }).join('');
    }
    wireAttach(o, function (files) {
      var msg = '';
      files.forEach(function (x) { if (x.size > MAXF) msg = '„' + x.name + '“ je větší než 15 MB — vynecháno.'; else if (!x.size) msg = '„' + x.name + '“ je prázdný — vynecháno.'; else if (PF.length >= MAXN) msg = 'Nejvýše ' + MAXN + ' souborů.'; else PF.push(x); });
      o.querySelector('#at-st').style.color = msg ? '#fca5a5' : ''; o.querySelector('#at-st').textContent = msg; draw();
    });
    o.querySelector('#at-list').onclick = function (e) { var b = e.target.closest('[data-pf]'); if (b) { PF.splice(+b.getAttribute('data-pf'), 1); draw(); } };
    f.onsubmit = function (e) {
      e.preventDefault(); var d = readForm(f); if (!d.title.trim()) return;
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      call('/admin/api/tasks', d).then(function (j) {
        if (!j.ok) { btn.disabled = false; f.querySelector('.mer').textContent = j.error || 'Chyba'; return; }
        var errs = [], i = 0, st2 = o.querySelector('#at-st'); st2.style.color = '';
        (function next() {
          if (i >= PF.length) { closeModal(); load(); if (errs.length) alert('Task je založený, ale tyto přílohy se nenahrály:\n' + errs.join('\n')); return; }
          st2.textContent = 'Nahrávám přílohy… ' + (i + 1) + ' / ' + PF.length;
          var cur = PF[i++]; upload(j.task.id, cur).then(function (r) { if (!r.ok) errs.push(cur.name + ' — ' + (r.error || 'chyba')); next(); });
        })();
      });
    };
  }
  function logHtml(log) {
    return log.map(function (l) {
      if (l.kind === 'comment') return '<div class="li"><div class="h"><b>' + esc(l.author_name) + '</b> · ' + fdt(l.created_at) + '</div><div class="t">' + esc(l.text) + '</div></div>';
      return '<div class="li sys">' + fdt(l.created_at) + ' · <b>' + esc(l.author_name) + '</b> — ' + esc(l.text) + '</div>';
    }).join('') || '<div class="mut">Zatím žádná historie.</div>';
  }
  function openTask(id) {
    call('/admin/api/tasks/' + id).then(function (j) {
      if (!j.ok) { alert(j.error || 'Task nenalezen'); return; }
      var t = j.task, files = j.files || [];
      var o = modal('Task #' + t.id, '<form>' + formHtml(t) + '<div class="mer"></div><div class="mact"><span class="mut">Založil(a) ' + esc(t.creator_name || '') + ' · ' + fdt(t.created_at) + (t.done_at ? ' · hotovo ' + fdt(t.done_at) : '') + '</span><span style="display:flex;gap:8px">' + (t.creator_key === D.me.key || !t.creator_key ? '<button class="btn sm ghost" type="button" data-del>Smazat</button>' : '') + '<button class="btn sm" type="submit">Uložit změny</button></span></div></form>' +
        '<div class="lg"><h4>Průběh řešení</h4><div id="tk-log">' + logHtml(j.log) + '</div><div class="cm"><textarea id="tk-cm" maxlength="5000" placeholder="Napište komentář — jak to vypadá, co je potřeba…"></textarea><button class="btn sm" type="button" id="tk-cmb">Přidat</button></div></div>');
      var f = o.querySelector('form');
      var drawFiles = function () { o.querySelector('#at-list').innerHTML = files.map(function (x) { return attItem(t.id, x); }).join(''); };
      drawFiles();
      wireAttach(o, function (list) {
        var st2 = o.querySelector('#at-st'), i = 0, errs = []; st2.style.color = '';
        (function next() {
          if (i >= list.length) { st2.style.color = errs.length ? '#fca5a5' : ''; st2.textContent = errs.join(' · '); call('/admin/api/tasks/' + t.id).then(function (k) { if (k.ok) { files = k.files || []; drawFiles(); o.querySelector('#tk-log').innerHTML = logHtml(k.log); } }); load(); return; }
          var cur = list[i++];
          if (cur.size > MAXF) { errs.push('„' + cur.name + '“ je větší než 15 MB'); return next(); }
          if (!cur.size) { errs.push('„' + cur.name + '“ je prázdný'); return next(); }
          st2.textContent = 'Nahrávám ' + cur.name + '…';
          upload(t.id, cur).then(function (r) { if (!r.ok) errs.push(cur.name + ': ' + (r.error || 'chyba')); next(); });
        })();
      });
      o.querySelector('#at-list').onclick = function (e) {
        var b = e.target.closest('[data-fd]'); if (!b) return;
        if (!confirm('Smazat přílohu?')) return;
        call('/admin/api/tasks/' + t.id + '/files/' + b.getAttribute('data-fd') + '/delete', {}).then(function (r) {
          if (!r.ok) { alert(r.error || 'Chyba'); return; }
          files = files.filter(function (x) { return String(x.id) !== b.getAttribute('data-fd'); }); drawFiles(); load();
        });
      };
      f.onsubmit = function (e) {
        e.preventDefault(); var d = readForm(f);
        call('/admin/api/tasks/' + t.id, d).then(function (r) { if (!r.ok) { f.querySelector('.mer').textContent = r.error || 'Chyba'; return; } closeModal(); load(); });
      };
      var del = o.querySelector('[data-del]');
      if (del) del.onclick = function () { if (!confirm('Opravdu smazat task „' + t.title + '“ i s historií?')) return; call('/admin/api/tasks/' + t.id + '/delete', {}).then(function (r) { if (!r.ok) { alert(r.error || 'Chyba'); return; } closeModal(); load(); }); };
      o.querySelector('#tk-cmb').onclick = function () {
        var ta = o.querySelector('#tk-cm'), text = ta.value.trim(); if (!text) return;
        call('/admin/api/tasks/' + t.id + '/comment', { text: text }).then(function (r) {
          if (!r.ok) { alert(r.error || 'Chyba'); return; }
          ta.value = ''; call('/admin/api/tasks/' + t.id).then(function (k) { if (k.ok) o.querySelector('#tk-log').innerHTML = logHtml(k.log); }); load();
        });
      };
    });
  }

  document.addEventListener('click', function (e) {
    var q = e.target.closest('#tk-q button'); if (q) { QF = q.getAttribute('data-q'); render(); return; }
    if (e.target.closest('select.st')) return;
    var tr = e.target.closest('#tk tbody tr[data-id]'); if (tr) openTask(tr.getAttribute('data-id'));
  });
  document.addEventListener('change', function (e) {
    var s = e.target.closest('select.st'); if (!s) return;
    var id = s.getAttribute('data-st');
    call('/admin/api/tasks/' + id, { status: s.value }).then(function (r) { if (!r.ok) { alert(r.error || 'Chyba'); } load(); });
  });
  $('#tk-new').onclick = newTask;
  var m = /[?&]id=(\d+)/.exec(location.search);
  if (m) QF = 'all';
  load(m ? m[1] : null);
})();
