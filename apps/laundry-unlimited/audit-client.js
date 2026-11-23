// Laundry Unlimited — Historie změn (auditní log): tabulka s filtry, živé obnovování
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var DAYS = 7, ROWS = [], T = null, timer = null;
  var fdt = function (d) { return new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  var AREA_ICO = { 'Přihlášení': '🔑', 'Tasky': '✅', 'Leady': '👥', 'Rozdělení financí': '💶', 'Modelace business modelu': '🧩', 'Uživatelé administrace': '👤', 'Můj účet': '⚙️' };

  function ago(d) {
    var s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
    if (s < 60) return 'před ' + s + ' s'; if (s < 3600) return 'před ' + Math.round(s / 60) + ' min'; if (s < 86400) return 'před ' + Math.round(s / 3600) + ' h'; return 'před ' + Math.round(s / 86400) + ' dny';
  }
  function whatHtml(r) {
    var ch = Array.isArray(r.changes) ? r.changes : [];
    var head = (r.label ? '<b>' + esc(r.label) + '</b>' + (r.summary || ch.length ? '<br>' : '') : '');
    var body;
    if (ch.length > 1) body = '<details><summary>' + esc(r.summary || ch[0]) + '</summary><ul class="au-ch">' + ch.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></details>';
    else body = esc(r.summary || ch[0] || '');
    var meta = (r.n > 1 ? ' <span class="au-n" title="Průběžné ukládání se sloučilo do jedné položky">' + r.n + '× uloženo</span>' : '');
    return head + body + meta + (r.ok === false && r.error ? '<div class="au-err">' + esc(r.error) + '</div>' : '');
  }
  function rowHtml(r) {
    return '<tr class="' + (r.ok === false ? 'au-bad' : '') + '"><td class="au-t" title="' + esc(r.at) + '">' + esc(fdt(r.at)) + '<div class="au-ago">' + esc(ago(r.at)) + '</div></td>' +
      '<td><b>' + esc(r.actor_name || r.actor_email || '—') + '</b>' + (r.actor_email && r.actor_name && r.actor_name !== r.actor_email ? '<div class="au-sub">' + esc(r.actor_email) + '</div>' : '') + '</td>' +
      '<td>' + (AREA_ICO[r.area] || '•') + ' ' + esc(r.area) + '</td><td>' + esc(r.action) + '</td><td class="au-w">' + whatHtml(r) + '</td>' +
      '<td class="au-sub">' + esc(r.device || '') + (r.ip ? '<div>' + esc(r.ip) + '</div>' : '') + '</td><td>' + (r.ok === false ? '<span class="au-pill bad">Nepovedlo se</span>' : '<span class="au-pill ok">OK</span>') + '</td></tr>';
  }
  function head() {
    return '<thead><tr><th>Kdy</th><th>Kdo</th><th>Kde</th><th>Akce</th><th>Co se změnilo</th><th>Zařízení · IP</th><th>Výsledek</th></tr></thead><tbody></tbody>';
  }
  function cols() {
    return [
      { key: 'at', label: 'Kdy', type: 'date', ph: 'dd.mm.rrrr', get: function (r) { return new Date(r.at); } },
      { key: 'who', label: 'Kdo', type: 'text', enum: true, ph: 'Vyber…', get: function (r) { return r.actor_name || r.actor_email || '—'; } },
      { key: 'area', label: 'Kde', type: 'text', enum: true, ph: 'Vyber…', get: function (r) { return r.area; } },
      { key: 'action', label: 'Akce', type: 'text', ph: 'Hledat…', get: function (r) { return r.action; } },
      { key: 'what', label: 'Co se změnilo', type: 'text', ph: 'Hledat…', sort: false, get: function (r) { return [r.label, r.summary].concat(r.changes || []).join(' '); } },
      { key: 'dev', label: 'Zařízení · IP', type: 'text', ph: 'Hledat…', get: function (r) { return (r.device || '') + ' ' + (r.ip || ''); } },
      { key: 'ok', label: 'Výsledek', type: 'text', enum: true, ph: 'Vyber…', get: function (r) { return r.ok === false ? 'Nepovedlo se' : 'OK'; } }
    ];
  }
  function kpis() {
    var day = Date.now() - 86400000, today = ROWS.filter(function (r) { return new Date(r.at).getTime() > day; });
    var users = {}; ROWS.forEach(function (r) { users[r.actor_name || r.actor_email || '—'] = 1; });
    var bad = ROWS.filter(function (r) { return r.ok === false; }).length;
    $('#au-kpi').innerHTML = '<div class="aukp"><b>' + today.length + '</b><span>záznamů za 24 h</span></div><div class="aukp"><b>' + ROWS.length + '</b><span>záznamů v období</span></div><div class="aukp"><b>' + Object.keys(users).length + '</b><span>různých uživatelů</span></div><div class="aukp' + (bad ? ' bad' : '') + '"><b>' + bad + '</b><span>nepovedených pokusů</span></div>';
  }
  function load(quiet) {
    if (!quiet) $('#au-st').textContent = 'Načítám…';
    return fetch('/admin/api/audit?days=' + DAYS, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { $('#au-st').textContent = j.error || 'Načtení se nepovedlo'; return; }
      ROWS = j.rows || [];
      if (!window.ColFilters) { $('#au').innerHTML = head(); $('#au').querySelector('tbody').innerHTML = ROWS.map(rowHtml).join(''); }
      else {
        if (!T) { $('#au').innerHTML = head(); T = window.ColFilters.table({ table: '#au', columns: cols(), renderRow: rowHtml, limit: 1500, noun: 'záznamů', emptyText: 'V tomto období zatím žádné záznamy.' }); }
        T.setRows(ROWS);
      }
      kpis(); $('#au-st').textContent = 'Aktualizováno ' + new Date().toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague' });
    }).catch(function () { $('#au-st').textContent = 'Načtení se nepovedlo'; });
  }
  function busy() { var a = document.activeElement; return !!($('#au details[open]') || (a && a.closest && a.closest('#au') && /INPUT|SELECT|TEXTAREA/.test(a.tagName))); }
  function arm() { clearInterval(timer); if ($('#au-live').checked) timer = setInterval(function () { if (!document.hidden && !busy()) load(true); }, 15000); }
  [].forEach.call(document.querySelectorAll('[data-days]'), function (b) {
    b.onclick = function () { DAYS = +b.getAttribute('data-days'); [].forEach.call(document.querySelectorAll('[data-days]'), function (x) { x.classList.toggle('on', x === b); }); load(); };
  });
  $('#au-live').onchange = arm; $('#au-reload').onclick = function () { load(); };
  load(); arm();
})();
