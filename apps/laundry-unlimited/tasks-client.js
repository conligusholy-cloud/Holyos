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
    return '<tr data-id="' + t.id + '"' + (OPEN(t) ? '' : ' class="dn"') + '><td class="mut">' + t.id + '</td>' +
      '<td><div class="tt">' + esc(t.title) + '</div>' + (t.description ? '<div class="ds">' + esc(t.description) + '</div>' : '') + '</td>' +
      '<td>' + stSel(t) + '</td>' +
      '<td class="p-' + esc(t.priority) + '">' + esc(D.priorities[t.priority] || t.priority) + '</td>' +
      '<td>' + (t.assignee_name ? esc(t.assignee_name) + (t.assignee_key === D.me.key ? ' <span class="mut">(já)</span>' : '') : '<span class="mut">nepřiřazeno</span>') + '</td>' +
      '<td>' + esc(t.creator_name || '') + '</td>' +
      '<td' + (late(t) ? ' class="late" title="Po termínu"' : '') + '>' + (t.due_date ? fd(dOnly(t.due_date)) + (late(t) ? ' ⚠' : '') : '<span class="mut">—</span>') + '</td>' +
      '<td class="mut">' + fdt(t.updated_at) + '</td>' +
      '<td class="mut">' + (t.comments ? '💬 ' + t.comments : '') + '</td></tr>';
  }
  function build() {
    $('#tk').innerHTML = '<thead><tr><th>#</th><th>Úkol</th><th>Stav</th><th>Priorita</th><th>Řešitel</th><th>Zadal</th><th>Termín</th><th>Změna</th><th></th></tr></thead><tbody></tbody>';
    var cols = [
      { key: 'id', label: '#', type: 'num', get: function (t) { return t.id; } },
      { key: 'title', label: 'Úkol', type: 'text', ph: 'Hledat…', get: function (t) { return t.title + ' ' + (t.description || ''); }, sortGet: function (t) { return t.title; }, enum: false },
      { key: 'status', label: 'Stav', type: 'text', get: function (t) { return D.statuses[t.status] || t.status; }, enum: true },
      { key: 'priority', label: 'Priorita', type: 'text', get: function (t) { return D.priorities[t.priority] || t.priority; }, sortGet: function (t) { return { urgent: 0, high: 1, normal: 2, low: 3 }[t.priority]; }, enum: true },
      { key: 'assignee', label: 'Řešitel', type: 'text', get: function (t) { return t.assignee_name || 'nepřiřazeno'; }, enum: true },
      { key: 'creator', label: 'Zadal', type: 'text', get: function (t) { return t.creator_name || ''; }, enum: true },
      { key: 'due', label: 'Termín', type: 'date', ph: 'dd.mm.rrrr', get: function (t) { return t.due_date ? dOnly(t.due_date) : null; } },
      { key: 'upd', label: 'Změna', type: 'date', ph: 'dd.mm.rrrr', get: function (t) { return t.updated_at; } },
      null,
    ];
    if (window.ColFilters && window.ColFilters.table) T = window.ColFilters.table({ table: '#tk', columns: cols, renderRow: rowHtml, noun: 'úkolů', emptyText: 'Žádné úkoly. Nový založíte tlačítkem „＋ Nový úkol“.' });
  }
  function render() {
    quickBar();
    var f = (QUICK.filter(function (x) { return x[0] === QF; })[0] || QUICK[0])[2];
    var rows = D.tasks.filter(f);
    if (T) T.setRows(rows);
    else $('#tk tbody').innerHTML = rows.map(rowHtml).join('') || '<tr><td colspan="9" class="mut">Žádné úkoly.</td></tr>';
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
  function formHtml(t) {
    t = t || { status: 'todo', priority: 'normal' };
    var opt = function (map, v) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); };
    return '<label>Co je potřeba udělat *</label><input name="title" maxlength="200" value="' + esc(t.title || '') + '" required autocomplete="off">' +
      '<label>Popis / zadání</label><textarea name="description" maxlength="8000" placeholder="Podrobnosti, odkazy, co má být výsledkem…">' + esc(t.description || '') + '</textarea>' +
      '<div class="mrow"><div><label>Řešitel</label><select name="assignee_key">' + peopleOpts(t.assignee_key || (t.id ? '' : '')) + '</select></div>' +
      '<div><label>Termín</label><input name="due_date" type="date" value="' + esc(dOnly(t.due_date)) + '"></div>' +
      '<div><label>Priorita</label><select name="priority">' + opt(D.priorities, t.priority) + '</select></div>' +
      '<div><label>Stav</label><select name="status">' + opt(D.statuses, t.status) + '</select></div></div>';
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
    var o = modal('Nový úkol', '<form>' + formHtml(null) + '<div class="mer"></div><div class="mact"><span class="mut">Řešiteli přijde upozornění do Velínu (kdo v HolyOS není, dostane e-mail).</span><button class="btn sm" type="submit">Založit úkol</button></div></form>');
    var f = o.querySelector('form'); f.querySelector('input[name="title"]').focus();
    f.onsubmit = function (e) {
      e.preventDefault(); var d = readForm(f); if (!d.title.trim()) return;
      call('/admin/api/tasks', d).then(function (j) { if (!j.ok) { f.querySelector('.mer').textContent = j.error || 'Chyba'; return; } closeModal(); load(); });
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
      if (!j.ok) { alert(j.error || 'Úkol nenalezen'); return; }
      var t = j.task;
      var o = modal('Úkol #' + t.id, '<form>' + formHtml(t) + '<div class="mer"></div><div class="mact"><span class="mut">Založil(a) ' + esc(t.creator_name || '') + ' · ' + fdt(t.created_at) + (t.done_at ? ' · hotovo ' + fdt(t.done_at) : '') + '</span><span style="display:flex;gap:8px">' + (t.creator_key === D.me.key || !t.creator_key ? '<button class="btn sm ghost" type="button" data-del>Smazat</button>' : '') + '<button class="btn sm" type="submit">Uložit změny</button></span></div></form>' +
        '<div class="lg"><h4>Průběh řešení</h4><div id="tk-log">' + logHtml(j.log) + '</div><div class="cm"><textarea id="tk-cm" maxlength="5000" placeholder="Napište komentář — jak to vypadá, co je potřeba…"></textarea><button class="btn sm" type="button" id="tk-cmb">Přidat</button></div></div>');
      var f = o.querySelector('form');
      f.onsubmit = function (e) {
        e.preventDefault(); var d = readForm(f);
        call('/admin/api/tasks/' + t.id, d).then(function (r) { if (!r.ok) { f.querySelector('.mer').textContent = r.error || 'Chyba'; return; } closeModal(); load(); });
      };
      var del = o.querySelector('[data-del]');
      if (del) del.onclick = function () { if (!confirm('Opravdu smazat úkol „' + t.title + '“ i s historií?')) return; call('/admin/api/tasks/' + t.id + '/delete', {}).then(function (r) { if (!r.ok) { alert(r.error || 'Chyba'); return; } closeModal(); load(); }); };
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
