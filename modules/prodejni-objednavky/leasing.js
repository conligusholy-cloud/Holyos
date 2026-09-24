// =============================================================================
// HolyOS — Leasing / financující společnosti (self-injecting záložka)
// =============================================================================
// Záložka „Leasing" v Prodejních objednávkách: evidence společností, které
// zákazníkovi zafinancují prádlomat. Základ + kontakt (tel/e-mail) + IČO s
// autofillem z ARES (/api/compounder/ares?ico=). API: /api/leasing.
(function () {
  'use strict';

  var API = '/api/leasing';
  var state = { rows: [], search: '', editing: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function attr(s) { return esc(s).replace(/'/g, '&#39;'); }

  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'include';
    if (opts.body && typeof opts.body !== 'string') { opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}); opts.body = JSON.stringify(opts.body); }
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
      return r.status === 204 ? {} : r.json();
    });
  }

  function injectStyles() {
    if (document.getElementById('lc-styles')) return;
    var css = ''
      + '#tab-leasing .lc-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}'
      + '#tab-leasing .lc-toolbar input{flex:1;min-width:200px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px}'
      + '#tab-leasing table{width:100%;border-collapse:collapse;font-size:13px}'
      + '#tab-leasing th{text-align:left;color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:8px 10px;border-bottom:1px solid var(--border)}'
      + '#tab-leasing td{padding:10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}'
      + '#tab-leasing tr:hover td{background:rgba(255,255,255,.02)}'
      + '#tab-leasing .lc-badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px}'
      + '#tab-leasing .lc-on{background:rgba(34,197,94,.16);color:#7ee2a4}'
      + '#tab-leasing .lc-off{background:rgba(107,114,128,.2);color:#9aa0ad}'
      + '#tab-leasing .lc-act{background:none;border:none;cursor:pointer;font-size:15px;padding:4px 6px}'
      + '.lc-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:flex-start;justify-content:center;z-index:9999;overflow-y:auto;padding:40px 16px}'
      + '.lc-ov.open{display:flex}'
      + '.lc-modal{width:100%;max-width:640px;background:var(--surface,#171a21);border:1px solid var(--border);border-radius:16px;overflow:hidden}'
      + '.lc-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)}'
      + '.lc-head h2{font-size:18px;font-weight:700}'
      + '.lc-x{background:none;border:none;color:var(--text2);font-size:24px;cursor:pointer;line-height:1}'
      + '.lc-body{padding:16px 20px 20px;max-height:74vh;overflow-y:auto}'
      + '.lc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}'
      + '.lc-f{display:flex;flex-direction:column;gap:5px}'
      + '.lc-f.full{grid-column:1/-1}'
      + '.lc-f label{font-size:12px;color:var(--text2)}'
      + '.lc-f input,.lc-f textarea{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:14px;font-family:inherit}'
      + '.lc-f textarea{resize:vertical;min-height:60px}'
      + '.lc-icorow{display:flex;gap:8px}'
      + '.lc-icorow input{flex:1}'
      + '.lc-btn{border:1px solid var(--border);background:var(--surface2,#232630);color:var(--text);border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer}'
      + '.lc-btn.primary{background:#6366f1;border-color:#6366f1;color:#fff;font-weight:700}'
      + '.lc-foot{display:flex;justify-content:flex-end;gap:10px;align-items:center;margin-top:16px}'
      + '.lc-msg{font-size:13px}';
    var s = document.createElement('style'); s.id = 'lc-styles'; s.textContent = css; document.head.appendChild(s);
  }

  function injectTab() {
    if (document.getElementById('tab-leasing')) return;
    injectStyles();
    var bar = document.querySelector('.tab-bar');
    if (bar) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'tab-btn'; btn.setAttribute('data-tab', 'leasing');
      btn.textContent = '🏦 Leasing';
      btn.onclick = function () { window.switchTab('leasing'); };
      var after = bar.querySelector('.tab-btn[data-tab="servis-smlouvy"]');
      if (after && after.nextSibling) bar.insertBefore(btn, after.nextSibling); else bar.appendChild(btn);
    }
    var host = document.getElementById('tab-orders');
    var parent = host ? host.parentNode : document.querySelector('.main-wrapper') || document.body;
    var div = document.createElement('div');
    div.id = 'tab-leasing'; div.style.display = 'none'; div.style.padding = '20px 24px 24px';
    div.innerHTML = ''
      + '<div class="lc-toolbar">'
      + '  <input id="lc-search" placeholder="Hledat firmu / IČO / město / kontakt…">'
      + '  <button class="lc-btn primary" id="lc-new">+ Nová společnost</button>'
      + '</div>'
      + '<div id="lc-list"><div style="color:var(--text2)">Načítám…</div></div>';
    parent.appendChild(div);

    var orig = window.switchTab;
    window.switchTab = function (name) {
      if (typeof orig === 'function') { try { orig(name); } catch (e) {} }
      var mine = document.getElementById('tab-leasing');
      var myBtn = document.querySelector('.tab-btn[data-tab="leasing"]');
      if (mine) mine.style.display = (name === 'leasing') ? '' : 'none';
      if (myBtn) myBtn.classList.toggle('active', name === 'leasing');
      if (name === 'leasing') load();
    };

    document.getElementById('lc-new').onclick = function () { openEditor(null); };
    document.getElementById('lc-search').addEventListener('input', function (e) { state.search = e.target.value.toLowerCase(); render(); });
  }

  function load() {
    api('').then(function (rows) { state.rows = Array.isArray(rows) ? rows : []; render(); })
      .catch(function (e) { document.getElementById('lc-list').innerHTML = '<div style="color:#ef4444">Chyba: ' + esc(e.message) + '</div>'; });
  }

  function render() {
    var q = state.search;
    var rows = state.rows.filter(function (r) { return !q || ((r.name || '') + ' ' + (r.ico || '') + ' ' + (r.city || '') + ' ' + (r.contact_name || '')).toLowerCase().indexOf(q) !== -1; });
    var box = document.getElementById('lc-list'); if (!box) return;
    if (!rows.length) { box.innerHTML = '<div style="color:var(--text2);padding:20px 0">Zatím žádné leasingové společnosti. Přidej první přes „+ Nová společnost".</div>'; return; }
    box.innerHTML = '<table><thead><tr><th>Společnost</th><th>IČO</th><th>Kontakt</th><th>Telefon</th><th>E-mail</th><th>Město</th><th>Stav</th><th></th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr onclick="__lcEdit(' + r.id + ')" style="cursor:pointer">'
          + '<td><b>' + esc(r.name) + '</b>' + (r.note ? '<div style="font-size:11px;color:var(--text2);max-width:260px">' + esc(String(r.note).slice(0, 80)) + '</div>' : '') + '</td>'
          + '<td>' + esc(r.ico || '—') + '</td>'
          + '<td>' + esc(r.contact_name || '—') + '</td>'
          + '<td>' + (r.phone ? '<a href="tel:' + attr(r.phone) + '" onclick="event.stopPropagation()">' + esc(r.phone) + '</a>' : '—') + '</td>'
          + '<td>' + (r.email ? '<a href="mailto:' + attr(r.email) + '" onclick="event.stopPropagation()">' + esc(r.email) + '</a>' : '—') + '</td>'
          + '<td>' + esc(r.city || '—') + '</td>'
          + '<td><span class="lc-badge ' + (r.active ? 'lc-on' : 'lc-off') + '">' + (r.active ? 'Aktivní' : 'Neaktivní') + '</span></td>'
          + '<td class="lc-actions" onclick="event.stopPropagation()"><button class="lc-act" title="Upravit" onclick="__lcEdit(' + r.id + ')">✏️</button>'
          + '<button class="lc-act" title="Smazat" onclick="__lcDelete(' + r.id + ",'" + attr(r.name) + "')\">🗑️</button></td>"
          + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function ov() {
    var o = document.getElementById('lc-ov');
    if (!o) { o = document.createElement('div'); o.id = 'lc-ov'; o.className = 'lc-ov'; o.onclick = function (e) { if (e.target === o) close(); }; document.body.appendChild(o); }
    return o;
  }
  function close() { var o = document.getElementById('lc-ov'); if (o) o.classList.remove('open'); document.body.style.overflow = ''; state.editing = null; }

  function openEditor(id) {
    var r = id ? (state.rows.filter(function (x) { return x.id === id; })[0] || {}) : {};
    state.editing = id;
    var v = function (k) { return attr(r[k] == null ? '' : r[k]); };
    ov().innerHTML = '<div class="lc-modal">'
      + '<div class="lc-head"><h2>' + (id ? 'Upravit společnost' : 'Nová leasingová společnost') + '</h2><button class="lc-x" onclick="__lcClose()">×</button></div>'
      + '<div class="lc-body">'
      + '  <div class="lc-grid">'
      + '    <div class="lc-f full"><label>IČO (načte firmu z ARES)</label><div class="lc-icorow"><input id="lc-ico" value="' + v('ico') + '" placeholder="8 číslic"><button class="lc-btn" id="lc-ares">🔎 Načíst z ARES</button></div></div>'
      + '    <div class="lc-f full"><label>Název společnosti *</label><input id="lc-name" value="' + v('name') + '"></div>'
      + '    <div class="lc-f"><label>Kontaktní osoba</label><input id="lc-contact" value="' + v('contact_name') + '"></div>'
      + '    <div class="lc-f"><label>DIČ</label><input id="lc-dic" value="' + v('dic') + '"></div>'
      + '    <div class="lc-f"><label>Telefon</label><input id="lc-phone" value="' + v('phone') + '" placeholder="+420…"></div>'
      + '    <div class="lc-f"><label>E-mail</label><input id="lc-email" value="' + v('email') + '"></div>'
      + '    <div class="lc-f full"><label>Adresa</label><input id="lc-address" value="' + v('address') + '"></div>'
      + '    <div class="lc-f"><label>Město</label><input id="lc-city" value="' + v('city') + '"></div>'
      + '    <div class="lc-f"><label>PSČ</label><input id="lc-zip" value="' + v('zip') + '"></div>'
      + '    <div class="lc-f full"><label>Poznámka / podmínky financování</label><textarea id="lc-note">' + esc(r.note || '') + '</textarea></div>'
      + '    <div class="lc-f full"><label style="flex-direction:row;display:flex;align-items:center;gap:8px"><input type="checkbox" id="lc-active" ' + (r.active === false ? '' : 'checked') + ' style="width:auto"> Aktivní</label></div>'
      + '  </div>'
      + '  <div class="lc-foot"><span class="lc-msg" id="lc-msg"></span>'
      + '    <button class="lc-btn" onclick="__lcClose()">Zrušit</button>'
      + '    <button class="lc-btn primary" id="lc-save">' + (id ? 'Uložit změny' : 'Vytvořit') + '</button>'
      + '  </div>'
      + '</div></div>';
    ov().classList.add('open'); document.body.style.overflow = 'hidden';
    document.getElementById('lc-save').onclick = save;
    document.getElementById('lc-ares').onclick = aresFill;
  }

  function aresFill() {
    var ico = (document.getElementById('lc-ico').value || '').replace(/\D/g, '');
    var msg = document.getElementById('lc-msg');
    if (ico.length !== 8) { msg.style.color = '#ef4444'; msg.textContent = 'Zadej 8místné IČO.'; return; }
    msg.style.color = 'var(--text2)'; msg.textContent = 'Načítám z ARES…';
    fetch('/api/compounder/ares?ico=' + ico, { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) {
        if (d.name) document.getElementById('lc-name').value = d.name;
        if (d.address) document.getElementById('lc-address').value = d.address;
        if (d.dic) document.getElementById('lc-dic').value = d.dic;
        msg.style.color = '#22c55e'; msg.textContent = '✓ Načteno z ARES';
      } else { msg.style.color = '#ef4444'; msg.textContent = (d && d.error) || 'ARES nenašel IČO.'; }
    }).catch(function () { msg.style.color = '#ef4444'; msg.textContent = 'ARES je nedostupný.'; });
  }

  function save() {
    var g = function (id) { return (document.getElementById(id).value || '').trim(); };
    var body = {
      name: g('lc-name'), ico: g('lc-ico'), dic: g('lc-dic'),
      address: g('lc-address'), city: g('lc-city'), zip: g('lc-zip'),
      contact_name: g('lc-contact'), phone: g('lc-phone'), email: g('lc-email'),
      note: g('lc-note'), active: document.getElementById('lc-active').checked,
    };
    var msg = document.getElementById('lc-msg');
    if (!body.name) { msg.style.color = '#ef4444'; msg.textContent = 'Vyplň název společnosti.'; return; }
    var btn = document.getElementById('lc-save'); btn.disabled = true; msg.style.color = 'var(--text2)'; msg.textContent = 'Ukládám…';
    var p = state.editing ? api('/' + state.editing, { method: 'PUT', body: body }) : api('', { method: 'POST', body: body });
    p.then(function () { close(); load(); }).catch(function (e) { msg.style.color = '#ef4444'; msg.textContent = e.message; btn.disabled = false; });
  }

  window.__lcEdit = function (id) { openEditor(id); };
  window.__lcClose = close;
  window.__lcDelete = function (id, name) {
    if (!confirm('Opravdu smazat „' + name + '"?')) return;
    api('/' + id, { method: 'DELETE' }).then(load).catch(function (e) { alert('Nepodařilo se smazat: ' + e.message); });
  };

  function boot() { injectTab(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
