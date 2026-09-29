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
      + '#tab-leasing td a{color:#4aa3ea;text-decoration:none;font-weight:600}'
      + '#tab-leasing td a:hover{color:#7cc1f5;text-decoration:underline}'
      + '#tab-leasing .lc-badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px}'
      + '#tab-leasing .lc-on{background:rgba(34,197,94,.16);color:#7ee2a4}'
      + '#tab-leasing .lc-off{background:rgba(107,114,128,.2);color:#9aa0ad}'
      + '#tab-leasing .lc-act{background:none;border:none;cursor:pointer;font-size:15px;padding:4px 6px}'
      + '#tab-leasing .lc-cnt{display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(99,102,241,.16);color:#a5b4fc;font-weight:700;font-size:12px;text-decoration:none}'
      + '#tab-leasing .lc-cnt:hover{background:rgba(99,102,241,.3)}'
      + '#tab-leasing .lc-cnt.zero{background:rgba(255,255,255,.05);color:var(--text2);font-weight:600}'
      + '#tab-leasing .lc-calcbtn{background:rgba(234,179,8,.16);color:#fbbf24;border:1px solid rgba(234,179,8,.4);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer}'
      + '#tab-leasing .lc-calcbtn:hover{background:rgba(234,179,8,.3)}'
      + '.lc-params{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}'
      + '.lc-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(99,102,241,.14);color:#c7d2fe;white-space:nowrap}'
      + '.lc-chip.k{background:rgba(234,179,8,.16);color:#fde68a;font-weight:700}'
      + '.lc-ai{background:rgba(139,92,246,.2);color:#c4b5fd;border:1px solid rgba(139,92,246,.5);border-radius:6px;padding:3px 9px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}'
      + '.lc-calc{padding:4px 0}'
      + '.lc-calc .in{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}'
      + '.lc-calc .in label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text2)}'
      + '.lc-calc .in input,.lc-calc .in select{background:var(--surface2,#232630);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:14px;font-weight:600;font-family:inherit}'
      + '.lc-calc table{width:100%;border-collapse:collapse;font-size:13px}'
      + '.lc-calc th{text-align:left;color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid var(--border)}'
      + '.lc-calc td{padding:8px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}'
      + '.lc-calc td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}'
      + '.lc-calc tr.best td{background:rgba(34,197,94,.08)}'
      + '.lc-calc .src{font-size:11px;color:var(--text2)}'
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
      + '.lc-msg{font-size:13px}'
      // záložky v editoru + dokumenty k financování
      + '.lc-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);padding:0 20px}'
      + '.lc-tab{padding:10px 14px;background:none;border:none;color:var(--text2);font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}'
      + '.lc-tab.active{color:#a5b4fc;border-bottom-color:#6366f1}'
      + '.lc-tab:disabled{opacity:.45;cursor:not-allowed}'
      + '.lc-cat{border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:12px;background:var(--bg)}'
      + '.lc-cat h3{font-size:13px;font-weight:700;margin:0 0 8px;display:flex;align-items:center;gap:8px}'
      + '.lc-cat h3 .cnt{font-size:11px;font-weight:700;background:var(--surface2,#232630);color:var(--text2);padding:2px 8px;border-radius:999px}'
      + '.lc-doc{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px}'
      + '.lc-doc:last-of-type{border-bottom:none}'
      + '.lc-doc .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.lc-doc .m{font-size:11px;color:var(--text2)}'
      + '.lc-doc a{color:#4aa3ea;text-decoration:none;font-weight:600;font-size:12px}'
      + '.lc-doc a:hover{text-decoration:underline}'
      + '.lc-doc .x{background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px}'
      + '.lc-add{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)}'
      + '.lc-add input[type=text]{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:13px}'
      + '.lc-add input[type=file]{font-size:12px;color:var(--text2)}'
      + '.lc-empty{font-size:12px;color:var(--text2);padding:4px 0}';
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
      + '  <button class="lc-btn" onclick="__lcCalc(0)" title="Porovnat všechny leasingovky">🧮 Kalkulačka</button>'
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
    box.innerHTML = '<table><thead><tr><th>Společnost</th><th>IČO</th><th>Kontakt</th><th>Telefon</th><th>E-mail</th><th>Město</th><th>📄 Dokumenty</th><th>💼 Nabídky</th><th>🧮 Kalkulačka</th><th>Stav</th><th></th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr onclick="__lcEdit(' + r.id + ')" style="cursor:pointer">'
          + '<td><b>' + esc(r.name) + '</b>' + (r.note ? '<div style="font-size:11px;color:var(--text2);max-width:260px">' + esc(String(r.note).slice(0, 80)) + '</div>' : '') + '</td>'
          + '<td>' + esc(r.ico || '—') + '</td>'
          + '<td>' + esc(r.contact_name || '—') + '</td>'
          + '<td>' + (r.phone ? '<a href="tel:' + attr(r.phone) + '" onclick="event.stopPropagation()">' + esc(r.phone) + '</a>' : '—') + '</td>'
          + '<td>' + (r.email ? '<a href="mailto:' + attr(r.email) + '" onclick="event.stopPropagation()">' + esc(r.email) + '</a>' : '—') + '</td>'
          + '<td>' + esc(r.city || '—') + '</td>'
          + '<td onclick="event.stopPropagation()"><a href="#" class="lc-cnt' + (r.docs_count ? '' : ' zero') + '" onclick="__lcOpenTab(' + r.id + ',\'docs\');return false" title="Otevřít potřebné dokumenty">📄 ' + (r.docs_count || 0) + '</a></td>'
          + '<td onclick="event.stopPropagation()"><a href="#" class="lc-cnt' + (r.offers_count ? '' : ' zero') + '" onclick="__lcOpenTab(' + r.id + ',\'offers\');return false" title="Otevřít nabídky">💼 ' + (r.offers_count || 0) + '</a></td>'
          + '<td onclick="event.stopPropagation()"><button class="lc-calcbtn" onclick="__lcCalc(' + r.id + ')" title="Rychlá kalkulačka z nabídek této společnosti"' + (r.offers_count ? '' : ' disabled style="opacity:.4"') + '>🧮 Spočítat</button></td>'
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var o = document.getElementById('lc-ov'); if (o && o.classList.contains('open')) close(); } });

  function openEditor(id) {
    var r = id ? (state.rows.filter(function (x) { return x.id === id; })[0] || {}) : {};
    state.editing = id;
    var v = function (k) { return attr(r[k] == null ? '' : r[k]); };
    ov().innerHTML = '<div class="lc-modal">'
      + '<div class="lc-head"><h2>' + (id ? 'Upravit společnost' : 'Nová leasingová společnost') + '</h2><button class="lc-x" onclick="__lcClose()">×</button></div>'
      + '<div class="lc-tabs">'
      + '  <button class="lc-tab active" data-lctab="info" onclick="__lcTab(\'info\')">🏢 Údaje</button>'
      + '  <button class="lc-tab" data-lctab="docs" onclick="__lcTab(\'docs\')" ' + (id ? '' : 'disabled title="Nejdřív společnost ulož"') + '>📄 Potřebné dokumenty</button>'
      + '  <button class="lc-tab" data-lctab="offers" onclick="__lcTab(\'offers\')" ' + (id ? '' : 'disabled title="Nejdřív společnost ulož"') + '>💼 Nabídky</button>'
      + '</div>'
      + '<div class="lc-body">'
      + '<div id="lc-pane-docs" style="display:none"></div>'
      + '<div id="lc-pane-offers" style="display:none"></div>'
      + '<div id="lc-pane-info">'
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
      + '</div>' // /lc-pane-info
      + '</div></div>';
    ov().classList.add('open'); document.body.style.overflow = 'hidden';
    document.getElementById('lc-save').onclick = save;
    document.getElementById('lc-ares').onclick = aresFill;
  }

  // ── Záložky editoru ──
  function switchEditorTab(name) {
    var info = document.getElementById('lc-pane-info'), docs = document.getElementById('lc-pane-docs'), offers = document.getElementById('lc-pane-offers');
    if (info) info.style.display = name === 'info' ? '' : 'none';
    if (docs) docs.style.display = name === 'docs' ? '' : 'none';
    if (offers) offers.style.display = name === 'offers' ? '' : 'none';
    document.querySelectorAll('.lc-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-lctab') === name); });
    if (name === 'docs') loadDocs();
    if (name === 'offers') loadOffers();
  }
  window.__lcTab = switchEditorTab;

  // ── Potřebné dokumenty k žádosti o financování (dle typu žadatele) ──
  var DOC_CATS = [
    { key: 'fo',         icon: '🧑', label: 'Fyzická osoba' },
    { key: 'po_firma',   icon: '🏢', label: 'Právnická osoba – firma' },
    { key: 'po_zivnost', icon: '🧾', label: 'Právnická osoba – živnost (OSVČ)' },
  ];
  var docsState = { items: [] };

  function fmtSize(b) { if (b == null) return ''; if (b < 1024) return b + ' B'; if (b < 1024 * 1024) return Math.round(b / 1024) + ' kB'; return (b / 1024 / 1024).toFixed(1) + ' MB'; }

  function loadDocs() {
    var pane = document.getElementById('lc-pane-docs');
    if (!pane || !state.editing) return;
    pane.innerHTML = '<div class="lc-empty">Načítám dokumenty…</div>';
    api('/' + state.editing + '/documents').then(function (d) {
      docsState.items = d.items || [];
      renderDocs();
    }).catch(function (e) { pane.innerHTML = '<div class="lc-empty" style="color:#ef4444">Nepodařilo se načíst: ' + esc(e.message) + '</div>'; });
  }

  function renderDocs() {
    var pane = document.getElementById('lc-pane-docs');
    if (!pane) return;
    pane.innerHTML = '<div class="lc-empty" style="margin-bottom:10px">Dokumenty, které tato společnost vyžaduje k žádosti o financování — podle typu žadatele.</div>'
      + DOC_CATS.map(function (c) {
        var items = docsState.items.filter(function (x) { return x.category === c.key; });
        var list = items.length ? items.map(function (x) {
          return '<div class="lc-doc">'
            + '<div class="t" title="' + attr(x.title) + '">📄 ' + esc(x.title) + (x.note ? '<div class="m">' + esc(x.note) + '</div>' : '') + '</div>'
            + (x.file_path ? '<a href="' + API + '/documents/' + x.id + '/download">⬇️ Stáhnout' + (x.size_bytes ? ' (' + fmtSize(x.size_bytes) + ')' : '') + '</a>' : '<span class="m">bez souboru</span>')
            + '<button class="x" title="Smazat" onclick="__lcDocDel(' + x.id + ')">🗑️</button>'
            + '</div>';
        }).join('') : '<div class="lc-empty">Zatím žádné dokumenty.</div>';
        return '<div class="lc-cat">'
          + '<h3>' + c.icon + ' ' + esc(c.label) + ' <span class="cnt">' + items.length + '</span></h3>'
          + list
          + '<div class="lc-add">'
          + '  <input type="text" id="lc-doc-title-' + c.key + '" placeholder="Název dokumentu (nebo se vezme z názvu souboru)">'
          + '  <input type="file" id="lc-doc-file-' + c.key + '" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png">'
          + '  <button class="lc-btn primary" onclick="__lcDocAdd(\'' + c.key + '\')">＋ Přidat</button>'
          + '</div>'
          + '</div>';
      }).join('');
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Nepodařilo se přečíst soubor')); };
      r.readAsDataURL(file);
    });
  }

  window.__lcDocAdd = function (cat) {
    if (!state.editing) return;
    var titleEl = document.getElementById('lc-doc-title-' + cat), fileEl = document.getElementById('lc-doc-file-' + cat);
    var file = fileEl && fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;
    var title = (titleEl && titleEl.value || '').trim() || (file ? file.name : '');
    if (!title) { alert('Zadej název nebo vyber soubor.'); return; }
    if (file && file.size > 25 * 1024 * 1024) { alert('Soubor je větší než 25 MB.'); return; }
    var body = { category: cat, title: title };
    var p = file ? readFileAsDataURL(file).then(function (du) { body.data_url = du; body.filename = file.name; }) : Promise.resolve();
    p.then(function () { return api('/' + state.editing + '/documents', { method: 'POST', body: body }); })
      .then(function () { loadDocs(); })
      .catch(function (e) { alert('Nepodařilo se přidat: ' + e.message); });
  };

  window.__lcDocDel = function (id) {
    if (!confirm('Smazat dokument?')) return;
    api('/documents/' + id, { method: 'DELETE' }).then(loadDocs).catch(function (e) { alert('Nepodařilo se smazat: ' + e.message); });
  };

  // ── Nabídky financování, které nám tato společnost zaslala pro naše klienty ──
  var offersState = { items: [] };
  function fmtDate(s) { try { return new Date(s).toLocaleDateString('cs-CZ'); } catch (e) { return ''; } }
  function loadOffers() {
    var pane = document.getElementById('lc-pane-offers');
    if (!pane || !state.editing) return;
    pane.innerHTML = '<div class="lc-empty">Načítám nabídky…</div>';
    api('/' + state.editing + '/documents').then(function (d) {
      offersState.items = (d.items || []).filter(function (x) { return x.category === 'nabidka'; }).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      renderOffers();
    }).catch(function (e) { pane.innerHTML = '<div class="lc-empty" style="color:#ef4444">Nepodařilo se načíst: ' + esc(e.message) + '</div>'; });
  }
  function renderOffers() {
    var pane = document.getElementById('lc-pane-offers'); if (!pane) return;
    var q = (offersState.q || '').toLowerCase();
    var items = offersState.items.filter(function (x) { return !q || ((x.title || '') + ' ' + (x.note || '')).toLowerCase().indexOf(q) !== -1; });
    var list = items.length ? items.map(function (x) {
      var p = x.params || null;
      var chips = '';
      if (p) {
        var c = [];
        if (p.client) c.push('👤 ' + p.client); if (p.machine) c.push('⚙️ ' + p.machine); if (p.product) c.push(p.product);
        if (p.calc && p.calc.price) c.push('cena ' + fmtKc(p.calc.price));
        if (p.akontace_pct != null) c.push('akontace ' + p.akontace_pct + ' %');
        if (p.months) c.push(p.months + ' měs.');
        if (p.calc && p.calc.monthly) c.push('splátka ' + fmtKc(p.calc.monthly) + '/měs');
        if (p.residual_value) c.push('zůstatek ' + fmtKc(p.residual_value));
        if (p.interest_rate_pct != null) c.push('úrok ' + p.interest_rate_pct + ' %');
        chips = '<div class="lc-params">' + c.map(function (s) { return '<span class="lc-chip">' + esc(s) + '</span>'; }).join('')
          + (p.calc && p.calc.overpay_pct != null ? '<span class="lc-chip k">navýšení ' + p.calc.overpay_pct + ' %</span>' : '') + '</div>'
          + (p.notes ? '<div class="m" style="margin-top:3px">🤖 ' + esc(p.notes) + '</div>' : '');
      }
      return '<div class="lc-doc" style="align-items:flex-start">'
        + '<div class="t" style="white-space:normal"><b>💼 ' + esc(x.title) + '</b>' + (x.note ? '<div class="m" style="white-space:pre-wrap">' + esc(x.note) + '</div>' : '') + chips + '<div class="m">přidáno ' + fmtDate(x.created_at) + (p && p.extracted_at ? ' · vytěženo AI ' + fmtDate(p.extracted_at) : '') + '</div></div>'
        + (x.file_path ? '<button class="lc-ai" onclick="__lcExtract(' + x.id + ',this)" title="Nechat AI přečíst nabídku a vytáhnout parametry">' + (p ? '🔁 AI znovu' : '🤖 Vytěžit AI') + '</button>' : '')
        + (x.file_path ? '<a href="' + API + '/documents/' + x.id + '/download">⬇️ Stáhnout' + (x.size_bytes ? ' (' + fmtSize(x.size_bytes) + ')' : '') + '</a>' : '<span class="m">bez souboru</span>')
        + '<button class="x" title="Smazat" onclick="__lcOfferDel(' + x.id + ')">🗑️</button>'
        + '</div>';
    }).join('') : '<div class="lc-empty">' + (q ? 'Nic neodpovídá hledání.' : 'Zatím žádné nabídky.') + '</div>';
    var missing = offersState.items.filter(function (x) { return x.file_path && !x.params; }).length;
    pane.innerHTML = '<div class="lc-empty" style="margin-bottom:10px">Nabídky financování, které nám tato společnost poslala pro naše klienty (kalkulace, indikativní nabídky, schválení). Do názvu dej klienta a stroj, ať se to dá najít.</div>'
      + '<div class="lc-cat">'
      + '<h3>💼 Zaslané nabídky <span class="cnt">' + offersState.items.length + '</span>'
      + (missing ? '<button class="lc-ai" onclick="__lcExtractAll(this)">🤖 Vytěžit AI vše (' + missing + ')</button>' : '')
      + '<button class="lc-calcbtn" onclick="__lcCalc(' + state.editing + ')">🧮 Kalkulačka</button>'
      + '<input type="text" id="lc-off-q" placeholder="Hledat klienta / stroj…" value="' + attr(offersState.q || '') + '" style="margin-left:auto;font-weight:400;font-size:12px;padding:5px 9px;background:var(--surface2,#232630);border:1px solid var(--border);border-radius:6px;color:var(--text);width:200px"></h3>'
      + list
      + '<div class="lc-add" style="grid-template-columns:1fr 1fr auto">'
      + '  <input type="text" id="lc-off-title" placeholder="Klient + stroj (např. Novák – MINI SK) *">'
      + '  <input type="file" id="lc-off-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.msg,.eml">'
      + '  <button class="lc-btn primary" onclick="__lcOfferAdd()">＋ Přidat nabídku</button>'
      + '  <textarea id="lc-off-note" placeholder="Poznámka: částka, splátka, doba, akontace, platnost nabídky…" style="grid-column:1/-1;min-height:54px;background:var(--surface2,#232630);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:8px 10px;font-size:13px;font-family:inherit"></textarea>'
      + '</div></div>';
    var qi = document.getElementById('lc-off-q');
    if (qi) qi.addEventListener('input', function (e) { offersState.q = e.target.value; var pos = e.target.selectionStart; renderOffers(); var n = document.getElementById('lc-off-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) {} } });
  }
  window.__lcOfferAdd = function () {
    if (!state.editing) return;
    var titleEl = document.getElementById('lc-off-title'), fileEl = document.getElementById('lc-off-file'), noteEl = document.getElementById('lc-off-note');
    var file = fileEl && fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;
    var title = (titleEl && titleEl.value || '').trim() || (file ? file.name : '');
    if (!title) { alert('Zadej klienta / stroj nebo vyber soubor.'); return; }
    if (file && file.size > 25 * 1024 * 1024) { alert('Soubor je větší než 25 MB.'); return; }
    var body = { category: 'nabidka', title: title, note: (noteEl && noteEl.value || '').trim() || null };
    var p = file ? readFileAsDataURL(file).then(function (du) { body.data_url = du; body.filename = file.name; }) : Promise.resolve();
    p.then(function () { return api('/' + state.editing + '/documents', { method: 'POST', body: body }); })
      .then(function () { loadOffers(); })
      .catch(function (e) { alert('Nepodařilo se přidat: ' + e.message); });
  };
  window.__lcOfferDel = function (id) {
    if (!confirm('Smazat nabídku?')) return;
    api('/documents/' + id, { method: 'DELETE' }).then(loadOffers).catch(function (e) { alert('Nepodařilo se smazat: ' + e.message); });
  };

  function fmtKc(n) { return Math.round(Number(n) || 0).toLocaleString('cs-CZ') + ' Kč'; }
  window.__lcExtract = function (id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ AI čte…'; }
    api('/documents/' + id + '/extract', { method: 'POST', body: {} }).then(function () { loadOffers(); })
      .catch(function (e) { alert('Vytěžení selhalo: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = '🤖 Vytěžit AI'; } });
  };
  window.__lcExtractAll = function (btn) {
    if (!state.editing) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ AI čte nabídky…'; }
    api('/' + state.editing + '/documents/extract-all', { method: 'POST', body: {} }).then(function (r) {
      var errs = (r.results || []).filter(function (x) { return x.error; });
      if (errs.length) alert('Některé nabídky se nepodařilo vytěžit:\n' + errs.map(function (x) { return '#' + x.id + ': ' + x.error; }).join('\n'));
      loadOffers();
    }).catch(function (e) { alert('Vytěžení selhalo: ' + e.message); loadOffers(); });
  };

  // ── Rychlá kalkulačka: z vytěžených nabídek odvodí koeficienty a přepočte na zadanou cenu ──
  var calcState = { data: null, companyId: 0, price: 1500000, months: 60, ak: 10, vat: false };
  window.__lcCalc = function (companyId) {
    calcState.companyId = companyId || 0;
    var o = ov();
    o.innerHTML = '<div class="lc-modal" style="max-width:860px">'
      + '<div class="lc-head"><h2>🧮 Rychlá kalkulačka financování</h2><button class="lc-x" onclick="__lcClose()">×</button></div>'
      + '<div class="lc-body"><div class="lc-calc" id="lc-calc"><div class="lc-empty">Načítám nabídky…</div></div></div></div>';
    o.classList.add('open'); document.body.style.overflow = 'hidden';
    api('/calc-data').then(function (d) { calcState.data = d; renderCalc(); }).catch(function (e) { document.getElementById('lc-calc').innerHTML = '<div class="lc-empty" style="color:#ef4444">' + esc(e.message) + '</div>'; });
  };
  function renderCalc() {
    var box = document.getElementById('lc-calc'); if (!box) return;
    var d = calcState.data || { companies: [] };
    var cos = d.companies.filter(function (c) { return !calcState.companyId || c.company_id === calcState.companyId; });
    var price = Number(calcState.price) || 0, months = Number(calcState.months) || 0, akPct = Number(calcState.ak) || 0;
    var ak = price * akPct / 100, financed = price - ak;
    var rows = cos.map(function (c) {
      // Vyber nabídky nejbližší zadané době; koeficient splátky vztáhnout na financovanou částku.
      var offs = c.offers.slice().sort(function (a, b) { return Math.abs((a.months || 0) - months) - Math.abs((b.months || 0) - months); });
      var best = offs.filter(function (o) { return Math.abs((o.months || 0) - months) <= 6; });
      if (!best.length) best = offs.slice(0, 1);
      if (!best.length) return null;
      var mf = best.reduce(function (s, o) { return s + o.monthly_factor; }, 0) / best.length;
      // Když je doba jiná než v nabídce, přepočti koeficient anuitně na stejné implicitní úrokové míře.
      var refMonths = best[0].months || months;
      var monthly = financed * mf;
      if (refMonths && months && refMonths !== months) {
        var r = solveRate(mf, refMonths); // měsíční úrok z koeficientu
        monthly = r != null ? financed * annuityFactor(r, months) : financed * mf * refMonths / months;
      }
      var rvPct = best.reduce(function (s, o) { return s + ((o.residual_value || 0) / (o.price || 1)); }, 0) / best.length;
      var rv = price * rvPct;
      var total = ak + monthly * months + rv;
      return { c: c, monthly: monthly, total: total, rv: rv, overpay: (total / price - 1) * 100, src: best, n: best.length, refMonths: refMonths, rate: solveRate(mf, refMonths) };
    }).filter(Boolean).sort(function (a, b) { return a.total - b.total; });
    var vat = calcState.vat ? 1.21 : 1;
    box.innerHTML = '<div class="in">'
      + '<label>Cena stroje bez DPH (Kč)<input type="text" inputmode="numeric" id="lcc-price" value="' + Math.round(price).toLocaleString('cs-CZ') + '"></label>'
      + '<label>Akontace (%)<input type="number" id="lcc-ak" value="' + akPct + '" step="5" min="0" max="90"></label>'
      + '<label>Doba (měsíců)<select id="lcc-months">' + [24, 36, 48, 60, 72, 84].map(function (m) { return '<option value="' + m + '"' + (m === months ? ' selected' : '') + '>' + m + ' měsíců</option>'; }).join('') + '</select></label>'
      + '<label>Zobrazit<select id="lcc-vat"><option value="0"' + (!calcState.vat ? ' selected' : '') + '>bez DPH</option><option value="1"' + (calcState.vat ? ' selected' : '') + '>s DPH 21 %</option></select></label>'
      + '</div>'
      + '<div style="font-size:12.5px;color:var(--text2);margin-bottom:10px">Akontace <b style="color:var(--text)">' + fmtKc(ak * vat) + '</b> · financováno <b style="color:var(--text)">' + fmtKc(financed * vat) + '</b>' + (calcState.companyId ? ' · <a href="#" onclick="__lcCalc(0);return false" style="color:#4aa3ea">porovnat všechny společnosti</a>' : '') + '</div>'
      + (rows.length ? '<table><thead><tr><th>Společnost</th><th style="text-align:right">Měsíční splátka</th><th style="text-align:right">Zůstatek</th><th style="text-align:right">Zaplaceno celkem</th><th style="text-align:right">Navýšení</th><th>Odvozeno z</th></tr></thead><tbody>'
        + rows.map(function (r, i) {
          return '<tr' + (i === 0 && rows.length > 1 ? ' class="best"' : '') + '><td><b>' + esc(r.c.company) + '</b>' + (i === 0 && rows.length > 1 ? ' <span class="lc-chip" style="background:rgba(34,197,94,.18);color:#86efac">nejlevnější</span>' : '') + '</td>'
            + '<td class="n">' + fmtKc(r.monthly * vat) + '</td><td class="n">' + fmtKc(r.rv * vat) + '</td><td class="n">' + fmtKc(r.total * vat) + '</td>'
            + '<td class="n" style="color:' + (r.overpay < 15 ? '#86efac' : r.overpay < 30 ? '#fde68a' : '#fca5a5') + '">' + r.overpay.toFixed(1) + ' %</td>'
            + '<td class="src">' + r.n + ' nabíd' + (r.n === 1 ? 'ka' : r.n < 5 ? 'ky' : 'ek') + ' (' + r.refMonths + ' měs.' + (r.rate != null ? ', ~' + (r.rate * 12 * 100).toFixed(1) + ' % p.a.' : '') + ')<br>' + r.src.slice(0, 3).map(function (o) { return esc((o.client || o.title || '').slice(0, 30)); }).join(', ') + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<div class="lc-empty">Zatím žádné vytěžené nabídky' + (calcState.companyId ? ' u této společnosti' : '') + '. V záložce Nabídky klikni na „🤖 Vytěžit AI".</div>')
      + '<div class="lc-empty" style="margin-top:12px;font-size:11.5px">Orientační odhad: splátka se odvozuje z poměru splátka/financovaná částka v nabídkách nejbližších zadané době (±6 měsíců), jiná doba se přepočítává anuitně při stejném implicitním úroku. Zůstatek jako průměrné % z ceny. Skutečnou nabídku vždy potvrď u leasingovky.</div>'
      + '<div class="lc-foot" style="margin-top:12px"><button class="lc-btn" onclick="__lcClose()">Zavřít</button>' + (calcState.companyId && rows.length ? '<button class="lc-btn primary" onclick="__lcOpenTab(' + calcState.companyId + ',\'offers\')">💼 Otevřít nabídky</button>' : '') + '</div>';
    ['lcc-price', 'lcc-ak', 'lcc-months', 'lcc-vat'].forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      el.addEventListener('change', function () { calcState.price = Number(String(document.getElementById('lcc-price').value).replace(/[^0-9]/g, '')) || 0; calcState.ak = document.getElementById('lcc-ak').value; calcState.months = Number(document.getElementById('lcc-months').value); calcState.vat = document.getElementById('lcc-vat').value === '1'; renderCalc(); });
    });
  }
  function annuityFactor(r, n) { return r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n)); }
  function solveRate(mf, n) { // najdi měsíční úrok r, aby annuityFactor(r,n) == mf (bisekce)
    if (!mf || !n || mf <= 1 / n) return 0;
    var lo = 0, hi = 0.1;
    for (var i = 0; i < 60; i++) { var mid = (lo + hi) / 2; if (annuityFactor(mid, n) > mf) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
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
  window.__lcOpenTab = function (id, tab) { openEditor(id); switchEditorTab(tab); };
  window.__lcClose = close;
  window.__lcDelete = function (id, name) {
    if (!confirm('Opravdu smazat „' + name + '"?')) return;
    api('/' + id, { method: 'DELETE' }).then(load).catch(function (e) { alert('Nepodařilo se smazat: ' + e.message); });
  };

  function boot() { injectTab(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
