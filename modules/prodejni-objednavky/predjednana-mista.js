// HolyOS — Předjednaná místa pro prádlomat (správa)
// =============================================================================
// Self-injecting záložka v Prodejních objednávkách. Do index.html se přidává
// jen jeden <script> odkaz — veškerá logika (tlačítko, obsah, styly) se vloží
// odsud, aby se nemuselo sahat do velkého index.html (riziko ořezu přes mount).
//
// API: /api/pradlomat-spots (interní CRUD, veřejný web čte /public).
// =============================================================================
(function () {
  'use strict';

  var API = '/api/pradlomat-spots';
  var state = { spots: [], filter: '', search: '', editing: null, editMap: null, editMarker: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function attr(s) { return esc(s).replace(/'/g, '&#39;'); }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function fmtMoney(v, cur) { return v == null ? '—' : Math.round(v).toLocaleString('cs-CZ') + ' ' + (cur || 'CZK'); }

  var STATUS_LABEL = { draft: 'Rozpracované', published: 'Zveřejněné', reserved: 'Rezervováno', taken: 'Obsazené', archived: 'Archiv' };
  var STATUS_COLOR = { draft: '#9aa0ad', published: '#22c55e', reserved: '#eab308', taken: '#3b82f6', archived: '#6b7280' };

  // ── API helpers ──
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    if (opts.body && typeof opts.body !== 'string') { opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}); opts.body = JSON.stringify(opts.body); }
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
      return r.status === 204 ? {} : r.json();
    });
  }

  // ── Styly (jen pro tuto záložku) ──
  function injectStyles() {
    if (document.getElementById('pm-styles')) return;
    var css = ''
      + '#tab-predjednana .pm-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}'
      + '#tab-predjednana .pm-toolbar select,#tab-predjednana .pm-toolbar input{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px}'
      + '#tab-predjednana .pm-toolbar input.pm-search{flex:1;min-width:180px}'
      + '#tab-predjednana .pm-badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em}'
      + '#tab-predjednana .pm-pub{font-size:12px;font-weight:700}'
      + '#tab-predjednana .pm-inq{display:inline-block;min-width:20px;text-align:center;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--surface2);color:var(--text2)}'
      + '#tab-predjednana .pm-inq.hot{background:rgba(239,68,68,.18);color:#f7a1a1}'
      + '#tab-predjednana .pm-actions button{background:none;border:none;cursor:pointer;font-size:15px;padding:3px 5px;opacity:.85}'
      + '#tab-predjednana .pm-actions button:hover{opacity:1}'
      // modal
      + '.pm-ov{position:fixed;inset:0;background:rgba(4,10,18,.66);backdrop-filter:blur(3px);z-index:2000;display:none;align-items:flex-start;justify-content:center;padding:24px 14px;overflow-y:auto}'
      + '.pm-ov.open{display:flex}'
      + '.pm-modal{width:100%;max-width:760px;background:var(--surface,#171a21);border:1px solid var(--border);border-radius:16px;overflow:hidden}'
      + '.pm-modal .pm-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)}'
      + '.pm-modal .pm-head h2{font-size:18px;font-weight:700}'
      + '.pm-modal .pm-x{background:none;border:none;color:var(--text2);font-size:24px;cursor:pointer;line-height:1}'
      + '.pm-modal .pm-body{padding:18px 20px 22px;max-height:76vh;overflow-y:auto}'
      + '.pm-sect{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);margin:18px 0 8px}'
      + '.pm-sect:first-child{margin-top:0}'
      + '.pm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}'
      + '.pm-grid.three{grid-template-columns:1fr 1fr 1fr}'
      + '.pm-f{display:flex;flex-direction:column;gap:5px}'
      + '.pm-f.full{grid-column:1/-1}'
      + '.pm-f label{font-size:12px;color:var(--text2)}'
      + '.pm-f input,.pm-f select,.pm-f textarea{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 11px;color:var(--text);font-size:14px;font-family:inherit}'
      + '.pm-f textarea{resize:vertical;min-height:70px}'
      + '.pm-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)}'
      + '.pm-check input{width:16px;height:16px}'
      + '#pm-editmap{height:200px;border-radius:10px;border:1px solid var(--border);margin-top:8px;background:var(--bg)}'
      + '.pm-btn{border:none;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}'
      + '.pm-btn.primary{background:#eab308;color:#0e1a22}'
      + '.pm-btn.ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border)}'
      + '.pm-btn.geo{background:var(--surface2);color:var(--text);border:1px solid var(--border);padding:9px 12px;font-size:13px}'
      + '.pm-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:22px;flex-wrap:wrap}'
      + '.pm-inqbox{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:8px}'
      + '.pm-inqbox .row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}'
      + '.pm-inqbox .row:last-child{border-bottom:none}'
      + '.pm-msg{min-height:18px;font-size:13px}'
      + '.pm-msg.ok{color:#7ee2a4}.pm-msg.err{color:#f7a1a1}'
      + '.pm-hint{font-size:12px;color:var(--text2);margin-top:4px}'
      + '.pm-btn.find{background:#2a3550;color:#cfe0ff;border:1px solid #3b4a6b}'
      // finder panel
      + '.pmf-modal{width:100%;max-width:1000px;background:var(--surface,#171a21);border:1px solid var(--border);border-radius:16px;overflow:hidden}'
      + '.pmf-cfg{background:linear-gradient(180deg,rgba(42,53,80,.35),var(--bg));border:1px solid var(--border);border-radius:14px;padding:18px 18px 20px;margin-bottom:16px}'
      + '.pmf-cfg .pm-grid.three{gap:12px 14px}'
      + '.pmf-cfg .pm-f label{font-size:11.5px;color:var(--text2);text-transform:none}'
      + '.pmf-cfg .pm-f input{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:9px 11px;color:var(--text);font-size:14px}'
      + '.pmf-cfg .pm-f input:focus{outline:none;border-color:#eab308;box-shadow:0 0 0 3px rgba(234,179,8,.14)}'
      + '.pmf-cfg .pm-sect{color:#eab308;border-top:1px solid var(--border);padding-top:14px}'
      + '.pmf-cfg .pm-sect:first-child{border-top:none;padding-top:0}'
      + '.pmf-types{display:flex;flex-wrap:wrap;gap:10px}'
      + '.pmf-types label{display:flex;align-items:center;gap:7px;font-size:13px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:7px 13px;cursor:pointer;user-select:none}'
      + '.pmf-types label:has(input:checked){background:rgba(234,179,8,.14);border-color:rgba(234,179,8,.5);color:#f2d675}'
      + '.pmf-types input{width:15px;height:15px;accent-color:#eab308}'
      // lišta výběru + checkboxy kandidátů
      + '.pmf-bulk{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface,#171a21);border:1px solid var(--border);border-radius:10px;padding:9px 12px;margin-bottom:10px}'
      + '.pmf-bulk .cnt{font-size:13px;color:var(--text);font-weight:600}'
      + '.pmf-bulk .sp{flex:1}'
      + '.pmf-card{position:relative;padding-left:44px}'
      + '.pmf-card .pick{position:absolute;left:14px;top:14px;width:20px;height:20px;accent-color:#eab308;cursor:pointer}'
      + '.pmf-card.sel{border-color:#eab308;box-shadow:0 0 0 1px #eab308 inset}'
      + '.pmf-searchrow{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}'
      + '.pmf-searchrow input{flex:1;min-width:200px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:11px 13px;color:var(--text);font-size:14px}'
      + '#pmf-map{height:280px;border-radius:10px;border:1px solid var(--border);background:var(--bg);margin-bottom:12px}'
      + '.pmf-sum{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--text2);margin-bottom:10px}'
      + '.pmf-sum b{color:var(--text)}'
      + '.pmf-card{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:10px}'
      + '.pmf-card .top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}'
      + '.pmf-score{font-size:22px;font-weight:800;line-height:1}'
      + '.pmf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}'
      + '.pmf-chip{font-size:11.5px;padding:3px 8px;border-radius:999px;border:1px solid var(--border);background:var(--surface2);color:var(--text2)}'
      + '.pmf-chip.good{background:rgba(34,197,94,.15);color:#7ee2a4;border-color:rgba(34,197,94,.4)}'
      + '.pmf-chip.bad{background:rgba(239,68,68,.15);color:#f7a1a1;border-color:rgba(239,68,68,.4)}'
      + '.pmf-cardact{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}'
      + '.pmf-ai{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:10px;font-size:13px}'
      + '@media(max-width:560px){.pm-grid,.pm-grid.three{grid-template-columns:1fr}}';
    var st = document.createElement('style'); st.id = 'pm-styles'; st.textContent = css; document.head.appendChild(st);
  }

  // ── Vložení tlačítka + kontejneru + napojení na switchTab ──
  function injectTab() {
    if (document.getElementById('tab-predjednana')) return;
    injectStyles();

    var bar = document.querySelector('.tab-bar');
    if (bar) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'tab-btn'; btn.setAttribute('data-tab', 'predjednana');
      btn.textContent = '🧺📍 Předjednaná místa';
      btn.onclick = function () { window.switchTab('predjednana'); };
      // Za "Lokality", ať jsou geografické záložky u sebe.
      var after = bar.querySelector('.tab-btn[data-tab="lokality"]');
      if (after && after.nextSibling) bar.insertBefore(btn, after.nextSibling); else bar.appendChild(btn);
    }

    var host = document.getElementById('tab-orders');
    var parent = host ? host.parentNode : document.querySelector('.main-wrapper') || document.body;
    var div = document.createElement('div');
    div.id = 'tab-predjednana';
    div.style.display = 'none';
    div.style.padding = '20px 24px 24px';
    div.innerHTML = viewHtml();
    parent.appendChild(div);

    // Obalení switchTab, ať naši záložku ukazuje/skrývá jako ostatní.
    var orig = window.switchTab;
    window.switchTab = function (name) {
      if (typeof orig === 'function') { try { orig(name); } catch (e) {} }
      var mine = document.getElementById('tab-predjednana');
      var myBtn = document.querySelector('.tab-btn[data-tab="predjednana"]');
      if (mine) mine.style.display = (name === 'predjednana') ? '' : 'none';
      if (myBtn) myBtn.classList.toggle('active', name === 'predjednana');
      if (name === 'predjednana') load();
    };

    wireView();
  }

  function viewHtml() {
    return ''
      + '<div class="pm-toolbar">'
      + '  <select id="pm-filter">'
      + '    <option value="">Všechny stavy</option>'
      + '    <option value="draft">Rozpracované</option>'
      + '    <option value="published">Zveřejněné</option>'
      + '    <option value="reserved">Rezervováno</option>'
      + '    <option value="taken">Obsazené</option>'
      + '    <option value="archived">Archiv</option>'
      + '  </select>'
      + '  <input type="text" class="pm-search" id="pm-search" placeholder="Hledat město / název / majitele…">'
      + '  <button class="pm-btn ghost" id="pm-refresh">↻ Obnovit</button>'
      + '  <button class="pm-btn find" id="pm-finder">🔎 Vyhledávač lokalit</button>'
      + '  <button class="pm-btn primary" id="pm-new">＋ Nové místo</button>'
      + '  <a class="pm-btn ghost" href="https://pradlomaty.info/location" target="_blank" rel="noopener" title="Náhled veřejné stránky">🌐 Veřejný přehled</a>'
      + '</div>'
      + '<div style="overflow-x:auto"><table class="data-table" id="pm-table">'
      + '  <thead><tr><th>Místo</th><th>Lokalita</th><th>Stav</th><th title="Zveřejněno na pradlomaty.info/location">Web</th><th>Nájem</th><th title="Poptávky z webu">Poptávky</th><th>Akce</th></tr></thead>'
      + '  <tbody><tr><td colspan="7" style="color:var(--text2);padding:16px">Načítám…</td></tr></tbody>'
      + '</table></div>';
  }

  function wireView() {
    var f = document.getElementById('pm-filter'); if (f) f.onchange = function () { state.filter = f.value; render(); };
    var s = document.getElementById('pm-search'); if (s) s.oninput = function () { state.search = s.value.trim().toLowerCase(); render(); };
    var r = document.getElementById('pm-refresh'); if (r) r.onclick = load;
    var n = document.getElementById('pm-new'); if (n) n.onclick = function () { openEditor(null); };
    var fb = document.getElementById('pm-finder'); if (fb) fb.onclick = openFinder;
  }

  // ── Načtení a vykreslení ──
  function load() {
    var q = state.filter ? ('?status=' + encodeURIComponent(state.filter)) : '';
    api(q).then(function (list) { state.spots = Array.isArray(list) ? list : []; render(); })
      .catch(function (e) {
        var tb = document.querySelector('#pm-table tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="7" style="color:#f7a1a1;padding:16px">Chyba: ' + esc(e.message) + '</td></tr>';
      });
  }

  function render() {
    var tb = document.querySelector('#pm-table tbody'); if (!tb) return;
    var list = state.spots.slice();
    if (state.search) list = list.filter(function (x) {
      return [x.title, x.city, x.region, x.owner_name].filter(Boolean).join(' ').toLowerCase().indexOf(state.search) >= 0;
    });
    if (!list.length) { tb.innerHTML = '<tr><td colspan="7" style="color:var(--text2);padding:16px">Žádná místa. Klikni na „＋ Nové místo".</td></tr>'; return; }
    tb.innerHTML = list.map(function (s) {
      var stt = '<span class="pm-badge" style="background:' + STATUS_COLOR[s.status] + '22;color:' + STATUS_COLOR[s.status] + ';border:.5px solid ' + STATUS_COLOR[s.status] + '66">' + esc(STATUS_LABEL[s.status] || s.status) + '</span>';
      var onWeb = ['published', 'reserved'].indexOf(s.status) >= 0;
      var pub = onWeb ? '<span class="pm-pub" style="color:#22c55e">● Ano</span>' : '<span class="pm-pub" style="color:var(--text2)">○ Ne</span>';
      var inqN = s.new_inquiries || 0, inqT = s.inquiries_count || 0;
      var inq = '<span class="pm-inq' + (inqN ? ' hot' : '') + '" title="' + inqT + ' celkem, ' + inqN + ' nových">' + (inqN ? inqN + ' / ' : '') + inqT + '</span>';
      var loc = [s.city, s.region].filter(Boolean).join(', ') || '<span style="color:var(--text2)">—</span>';
      return '<tr onclick="__pmEdit(' + s.id + ')">'
        + '<td><b>' + esc(s.title) + '</b><div style="font-size:11px;color:var(--text2)">' + esc(s.code) + '</div></td>'
        + '<td>' + loc + '</td>'
        + '<td>' + stt + '</td>'
        + '<td>' + pub + '</td>'
        + '<td>' + fmtMoney(s.rent_monthly, s.rent_currency) + '</td>'
        + '<td>' + inq + '</td>'
        + '<td class="pm-actions" onclick="event.stopPropagation()">'
        + '  <button title="Upravit" onclick="__pmEdit(' + s.id + ')">✏️</button>'
        + (s.is_public ? '<button title="Otevřít na webu" onclick="window.open(\'https://pradlomaty.info/location\',\'_blank\')">🌐</button>' : '')
        + '  <button title="Smazat" onclick="__pmDelete(' + s.id + ',\'' + attr(s.title) + '\')">🗑️</button>'
        + '</td></tr>';
    }).join('');
  }

  // ── Editor ──
  function fieldsHtml(s) {
    s = s || {};
    function v(k) { return s[k] == null ? '' : s[k]; }
    function chk(k) { return s[k] ? 'checked' : ''; }
    function opt(val, lbl, cur) { return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + lbl + '</option>'; }
    var cur = s.status || 'draft';
    return ''
      + '<div class="pm-sect">Základní</div>'
      + '<div class="pm-grid">'
      + '  <div class="pm-f full"><label>Název místa *</label><input id="pmf-title" value="' + attr(v('title')) + '" placeholder="např. Praha 4 – Nusle, OC okolí"></div>'
      + '  <div class="pm-f"><label>Stav</label><select id="pmf-status">'
      +      opt('draft', 'Rozpracované', cur) + opt('published', 'Zveřejněné', cur) + opt('reserved', 'Rezervováno', cur) + opt('taken', 'Obsazené', cur) + opt('archived', 'Archiv', cur)
      + '  </select></div>'
      + '  <div class="pm-f"><label>Kód (URL)</label><input id="pmf-code" value="' + attr(v('code')) + '" placeholder="automaticky z názvu"></div>'
      + '  <div class="pm-f full"><div class="pm-hint">🌐 Na <b>pradlomaty.info/location</b> se místo zobrazí automaticky při stavu <b>Zveřejněné</b> nebo <b>Rezervováno</b>. Ve stavu Rozpracované/Obsazené/Archiv je skryté.</div></div>'
      + '  <div class="pm-f full"><label>👁️ Veřejný název <span style="color:var(--text2)">(co uvidí zákazník místo jména partnera)</span></label><input id="pmf-public_title" value="' + attr(v('public_title')) + '" placeholder="např. Lokalita u supermarketu – Rychnov n. Kn."></div>'
      + '  <div class="pm-f full"><label>Odznak (highlight)</label><input id="pmf-highlight" value="' + attr(v('highlight')) + '" placeholder="např. Bez konkurence do 2 km"></div>'
      + '</div>'

      + '<div class="pm-sect">Lokalita</div>'
      + '<div class="pm-grid three">'
      + '  <div class="pm-f"><label>Město</label><input id="pmf-city" value="' + attr(v('city')) + '"></div>'
      + '  <div class="pm-f"><label>Kraj / oblast</label><input id="pmf-region" value="' + attr(v('region')) + '"></div>'
      + '  <div class="pm-f"><label>Země</label><input id="pmf-country" value="' + attr(s.country || 'CZ') + '"></div>'
      + '</div>'
      + '<div class="pm-grid" style="margin-top:12px">'
      + '  <div class="pm-f full"><label>Adresa (interní)</label><input id="pmf-address" value="' + attr(v('address')) + '"></div>'
      + '  <div class="pm-f full"><label class="pm-check"><input type="checkbox" id="pmf-showaddr" ' + chk('show_address') + '> Zobrazit přesnou adresu i na webu</label></div>'
      + '  <div class="pm-f"><label>Zeměpisná šířka</label><input id="pmf-lat" value="' + attr(v('latitude')) + '"></div>'
      + '  <div class="pm-f"><label>Zeměpisná délka</label><input id="pmf-lng" value="' + attr(v('longitude')) + '"></div>'
      + '</div>'
      + '<div style="margin-top:8px"><button type="button" class="pm-btn geo" id="pmf-geocode">📍 Najít souřadnice z adresy</button> <span class="pm-msg" id="pmf-geomsg"></span></div>'
      + '<div id="pm-editmap"></div>'
      + '<div class="pm-hint">Klikni do mapy pro ruční umístění bodu.</div>'

      + '<div class="pm-sect">Parametry</div>'
      + '<div class="pm-grid three">'
      + '  <div class="pm-f"><label>Plocha (m²)</label><input id="pmf-area" value="' + attr(v('area_m2')) + '"></div>'
      + '  <div class="pm-f"><label>Nájem / měsíc</label><input id="pmf-rent" value="' + attr(v('rent_monthly')) + '"></div>'
      + '  <div class="pm-f"><label>Měna</label><input id="pmf-cur" value="' + attr(s.rent_currency || 'CZK') + '"></div>'
      + '  <div class="pm-f"><label>Příkon (kW)</label><input id="pmf-kw" value="' + attr(v('electricity_kw')) + '"></div>'
      + '  <div class="pm-f"><label class="pm-check"><input type="checkbox" id="pmf-water" ' + chk('water_supply') + '> Voda</label></div>'
      + '  <div class="pm-f"><label class="pm-check"><input type="checkbox" id="pmf-sewage" ' + chk('sewage') + '> Odpad</label></div>'
      + '  <div class="pm-f full"><label>Spádovost / návštěvnost</label><input id="pmf-footfall" value="' + attr(v('footfall_note')) + '" placeholder="např. 12 000 lidí v docházkové vzdálenosti"></div>'
      + '  <div class="pm-f full"><label>Dostupnost</label><input id="pmf-avail" value="' + attr(v('availability_note')) + '" placeholder="např. Volné od 09/2026"></div>'
      + '</div>'

      + '<div class="pm-sect">📊 Parametry z analýzy <span style="font-weight:400;text-transform:none;color:var(--text2)">(vyhledávač vyplní, lze upravit — zobrazí se zákazníkovi)</span></div>'
      + '<div class="pm-grid three">'
      + '  <div class="pm-f"><label class="pm-check"><input type="checkbox" id="pmf-has_parking" ' + chk('has_parking') + '> 🅿️ Parkoviště poblíž</label></div>'
      + '  <div class="pm-f"><label>Vzdálenost parkoviště (m)</label><input id="pmf-parking_distance_m" value="' + attr(v('parking_distance_m')) + '"></div>'
      + '  <div class="pm-f"><label>👥 Spádová populace</label><input id="pmf-population" value="' + attr(v('population')) + '"></div>'
      + '  <div class="pm-f"><label>🏪 Tahouni provozu (počet)</label><input id="pmf-anchor_count" value="' + attr(v('anchor_count')) + '"></div>'
      + '  <div class="pm-f"><label>⚔️ Konkurence (počet)</label><input id="pmf-competition_count" value="' + attr(v('competition_count')) + '"></div>'
      + '  <div class="pm-f"><label>⭐ Skóre vhodnosti (0–100)</label><input id="pmf-score" value="' + attr(v('score')) + '"></div>'
      + '</div>'
      + '<div class="pm-sect">Veřejný popis a fotky</div>'
      + '<div class="pm-grid">'
      + '  <div class="pm-f full"><label>Veřejný popis (zobrazí se návštěvníkovi)</label><textarea id="pmf-desc">' + esc(v('public_description')) + '</textarea></div>'
      + '  <div class="pm-f full"><label>Hlavní fotka (URL)</label><input id="pmf-cover" value="' + attr(v('cover_image_url')) + '" placeholder="https://…"></div>'
      + '  <div class="pm-f full"><label>Další fotky (URL, každá na řádek)</label><textarea id="pmf-gallery">' + esc((Array.isArray(s.gallery) ? s.gallery : []).join('\n')) + '</textarea></div>'
      + '</div>'

      + '<div class="pm-sect">Interní</div>'
      + '<div class="pm-grid three">'
      + '  <div class="pm-f"><label>Majitel / kontakt</label><input id="pmf-owner" value="' + attr(v('owner_name')) + '"></div>'
      + '  <div class="pm-f"><label>Telefon</label><input id="pmf-ophone" value="' + attr(v('owner_phone')) + '"></div>'
      + '  <div class="pm-f"><label>E-mail</label><input id="pmf-oemail" value="' + attr(v('owner_email')) + '"></div>'
      + '  <div class="pm-f full"><label>Interní poznámky</label><textarea id="pmf-notes">' + esc(v('internal_notes')) + '</textarea></div>'
      + '</div>';
  }

  function collect() {
    function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
    function chk(id) { var el = document.getElementById(id); return el ? el.checked : false; }
    var gallery = val('pmf-gallery').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    return {
      title: val('pmf-title'),
      code: val('pmf-code') || undefined,
      status: val('pmf-status'),
      public_title: val('pmf-public_title'),
      has_parking: chk('pmf-has_parking'),
      parking_distance_m: num(val('pmf-parking_distance_m')),
      population: num(val('pmf-population')),
      anchor_count: num(val('pmf-anchor_count')),
      competition_count: num(val('pmf-competition_count')),
      score: num(val('pmf-score')),
      highlight: val('pmf-highlight'),
      city: val('pmf-city'), region: val('pmf-region'), country: val('pmf-country'),
      address: val('pmf-address'), show_address: chk('pmf-showaddr'),
      latitude: num(val('pmf-lat')), longitude: num(val('pmf-lng')),
      area_m2: num(val('pmf-area')), rent_monthly: num(val('pmf-rent')), rent_currency: val('pmf-cur'),
      electricity_kw: num(val('pmf-kw')), water_supply: chk('pmf-water'), sewage: chk('pmf-sewage'),
      footfall_note: val('pmf-footfall'), availability_note: val('pmf-avail'),
      public_description: val('pmf-desc'), cover_image_url: val('pmf-cover'), gallery: gallery,
      owner_name: val('pmf-owner'), owner_phone: val('pmf-ophone'), owner_email: val('pmf-oemail'),
      internal_notes: val('pmf-notes')
    };
  }

  function inquiriesHtml(inqs) {
    if (!inqs || !inqs.length) return '<div class="pm-hint">Zatím žádné poptávky.</div>';
    return '<div class="pm-inqbox">' + inqs.map(function (q) {
      var when = new Date(q.created_at).toLocaleString('cs-CZ');
      var contact = [q.name, q.phone, q.email].filter(Boolean).join(' · ');
      var badge = q.status === 'new' ? '<span style="color:#f7a1a1;font-weight:700">nová</span>' : '<span style="color:var(--text2)">vyřízená</span>';
      return '<div class="row"><div><div style="font-size:13px"><b>' + esc(contact || 'Zájemce') + '</b> — ' + badge + '</div>'
        + (q.message ? '<div style="font-size:13px;color:var(--text2);margin-top:2px">' + esc(q.message) + '</div>' : '')
        + '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc(when) + '</div></div>'
        + '<button class="pm-btn ghost" style="padding:5px 10px;font-size:12px" onclick="__pmInq(' + q.id + ',\'' + (q.status === 'new' ? 'handled' : 'new') + '\')">' + (q.status === 'new' ? 'Označit vyřízené' : 'Zpět na nové') + '</button></div>';
    }).join('') + '</div>';
  }

  function openEditor(id) {
    var ov = document.getElementById('pm-ov') || (function () {
      var o = document.createElement('div'); o.id = 'pm-ov'; o.className = 'pm-ov';
      o.onclick = function (e) { if (e.target === o) closeEditor(); };
      document.body.appendChild(o); return o;
    })();

    function build(spot) {
      state.editing = spot ? spot.id : null;
      ov.innerHTML = '<div class="pm-modal"><div class="pm-head"><h2>' + (spot ? 'Upravit místo' : 'Nové předjednané místo') + '</h2><button class="pm-x" onclick="__pmClose()">×</button></div>'
        + '<div class="pm-body">'
        + fieldsHtml(spot)
        + (spot ? ('<div class="pm-sect">Poptávky z webu</div>' + inquiriesHtml(spot.inquiries)) : '')
        + '<div class="pm-foot">'
        + (spot ? '<a class="pm-hint" href="https://pradlomaty.info/location" target="_blank" rel="noopener">🌐 Zobrazit veřejný přehled</a>' : '<span></span>')
        + '<div style="display:flex;gap:10px;align-items:center"><span class="pm-msg" id="pm-savemsg"></span>'
        + '<button class="pm-btn ghost" onclick="__pmClose()">Zrušit</button>'
        + '<button class="pm-btn primary" id="pm-save">' + (spot ? 'Uložit změny' : 'Vytvořit místo') + '</button></div>'
        + '</div></div></div>';
      ov.classList.add('open'); document.body.style.overflow = 'hidden';
      document.getElementById('pm-save').onclick = save;
      var geo = document.getElementById('pmf-geocode'); if (geo) geo.onclick = doGeocode;
      setupEditMap(spot);
    }

    if (id) { api('/' + id).then(build).catch(function (e) { alert('Nepodařilo se načíst: ' + e.message); }); }
    else build(null);
  }

  function setupEditMap(spot) {
    if (typeof L === 'undefined') return;
    setTimeout(function () {
      var el = document.getElementById('pm-editmap'); if (!el) return;
      var lat = spot && spot.latitude != null ? spot.latitude : 49.82;
      var lng = spot && spot.longitude != null ? spot.longitude : 15.47;
      var zoom = (spot && spot.latitude != null) ? 14 : 7;
      try {
        state.editMap = L.map('pm-editmap', { scrollWheelZoom: false }).setView([lat, lng], zoom);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }).addTo(state.editMap);
        if (spot && spot.latitude != null) placeMarker(lat, lng);
        state.editMap.on('click', function (e) { placeMarker(e.latlng.lat, e.latlng.lng); setLatLng(e.latlng.lat, e.latlng.lng); });
      } catch (e) {}
    }, 60);
  }
  function placeMarker(lat, lng) {
    if (!state.editMap) return;
    if (state.editMarker) state.editMap.removeLayer(state.editMarker);
    state.editMarker = L.marker([lat, lng]).addTo(state.editMap);
  }
  function setLatLng(lat, lng) {
    var a = document.getElementById('pmf-lat'), b = document.getElementById('pmf-lng');
    if (a) a.value = (Math.round(lat * 1e6) / 1e6); if (b) b.value = (Math.round(lng * 1e6) / 1e6);
  }

  function doGeocode() {
    var addr = [document.getElementById('pmf-address').value, document.getElementById('pmf-city').value, document.getElementById('pmf-country').value].filter(Boolean).join(', ');
    var msg = document.getElementById('pmf-geomsg');
    if (addr.trim().length < 3) { msg.className = 'pm-msg err'; msg.textContent = 'Zadej adresu nebo město.'; return; }
    msg.className = 'pm-msg'; msg.textContent = 'Hledám…';
    api('/geocode?q=' + encodeURIComponent(addr)).then(function (arr) {
      if (arr && arr.length) {
        setLatLng(arr[0].lat, arr[0].lon); placeMarker(arr[0].lat, arr[0].lon);
        if (state.editMap) state.editMap.setView([arr[0].lat, arr[0].lon], 15);
        msg.className = 'pm-msg ok'; msg.textContent = '✓ ' + (arr[0].display_name || '').slice(0, 60);
      } else { msg.className = 'pm-msg err'; msg.textContent = 'Nenalezeno.'; }
    }).catch(function () { msg.className = 'pm-msg err'; msg.textContent = 'Chyba geokódování.'; });
  }

  function save() {
    var data = collect();
    var msg = document.getElementById('pm-savemsg');
    if (!data.title) { msg.className = 'pm-msg err'; msg.textContent = 'Vyplň název.'; return; }
    var btn = document.getElementById('pm-save'); btn.disabled = true; msg.className = 'pm-msg'; msg.textContent = 'Ukládám…';
    var p = state.editing ? api('/' + state.editing, { method: 'PUT', body: data }) : api('', { method: 'POST', body: data });
    p.then(function () { closeEditor(); load(); })
      .catch(function (e) { msg.className = 'pm-msg err'; msg.textContent = e.message; btn.disabled = false; });
  }

  function closeEditor() {
    var ov = document.getElementById('pm-ov'); if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
    if (state.editMap) { try { state.editMap.remove(); } catch (e) {} state.editMap = null; state.editMarker = null; }
    state.editing = null;
  }

  // ── Globální handlery (onclick z HTML) ──
  window.__pmEdit = function (id) { openEditor(id); };
  window.__pmClose = closeEditor;
  window.__pmDelete = function (id, title) {
    if (!confirm('Opravdu smazat místo „' + title + '"? Smažou se i jeho poptávky.')) return;
    api('/' + id, { method: 'DELETE' }).then(load).catch(function (e) { alert('Nepodařilo se smazat: ' + e.message); });
  };
  window.__pmInq = function (iid, status) {
    api('/inquiries/' + iid, { method: 'PUT', body: { status: status } }).then(function () {
      if (state.editing) openEditor(state.editing); // refresh detailu
      load();
    }).catch(function (e) { alert('Chyba: ' + e.message); });
  };

  // ==========================================================================
  // VYHLEDÁVAČ LOKALIT (AI + OSM)
  // ==========================================================================
  var fstate = { config: null, defaults: null, result: null, map: null, markers: [], cfgOpen: false, selected: {} };
  var CAND_TYPES = [
    { k: 'supermarket', l: 'Supermarkety' }, { k: 'hypermarket', l: 'Hypermarkety' },
    { k: 'mall', l: 'Obch. centra' }, { k: 'department_store', l: 'Obch. domy' },
    { k: 'wholesale', l: 'Velkoobchody' }, { k: 'convenience', l: 'Večerky' }
  ];

  function fapi(path, opts) { return api('/finder' + path, opts); }

  function openFinder() {
    var ov = document.getElementById('pmf-ov') || (function () {
      var o = document.createElement('div'); o.id = 'pmf-ov'; o.className = 'pm-ov';
      o.onclick = function (e) { if (e.target === o) closeFinder(); };
      document.body.appendChild(o); return o;
    })();
    ov.innerHTML = '<div class="pmf-modal"><div class="pm-head"><h2>🔎 Vyhledávač lokalit</h2><button class="pm-x" onclick="__pmfClose()">×</button></div>'
      + '<div class="pm-body">'
      + '  <div class="pmf-searchrow">'
      + '    <input id="pmf-area" placeholder="Zadej město nebo oblast (např. Kolín, Praha 4, Kladno)…">'
      + '    <button class="pm-btn ghost" id="pmf-cfgbtn" title="Nastavení logiky">⚙️ Konfigurace</button>'
      + '    <button class="pm-btn primary" id="pmf-go" title="Najít konkrétní kandidátní místa">🔎 Hledat místa</button>'
      + '  </div>'
      + '  <div class="pmf-searchrow" style="margin-top:-4px">'
      + '    <span style="font-size:12.5px;color:var(--text2)">Spádová oblast:</span>'
      + '    <label style="font-size:12.5px;color:var(--text2);display:flex;align-items:center;gap:6px">poloměr <input id="pmf-radius" type="number" value="15" style="width:64px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:13px"> km</label>'
      + '    <button class="pm-btn find" id="pmf-areabtn" title="Kružítko kolem města — populace a hustota v okruhu">🎯 Analýza oblasti</button>'
      + '  </div>'
      + '  <div id="pmf-cfgwrap" style="display:none"></div>'
      + '  <div class="pm-msg" id="pmf-msg"></div>'
      + '  <div id="pmf-map" style="display:none"></div>'
      + '  <div id="pmf-results"></div>'
      + '</div></div>';
    ov.classList.add('open'); document.body.style.overflow = 'hidden';
    document.getElementById('pmf-go').onclick = runSearch;
    document.getElementById('pmf-area').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
    document.getElementById('pmf-cfgbtn').onclick = toggleCfg;
    document.getElementById('pmf-areabtn').onclick = runAreaAnalysis;
    loadConfig();
  }

  function loadConfig() {
    fapi('/config').then(function (r) { fstate.config = r.config; fstate.defaults = r.defaults; }).catch(function () { fstate.config = null; });
  }

  function toggleCfg() {
    var wrap = document.getElementById('pmf-cfgwrap');
    fstate.cfgOpen = !fstate.cfgOpen;
    if (!fstate.cfgOpen) { wrap.style.display = 'none'; return; }
    wrap.style.display = ''; wrap.innerHTML = '<div class="pmf-cfg">Načítám…</div>';
    fapi('/config').then(function (r) { fstate.config = r.config; fstate.defaults = r.defaults; wrap.innerHTML = cfgHtml(r.config); wireCfg(); })
      .catch(function () { wrap.innerHTML = '<div class="pmf-cfg" style="color:#f7a1a1">Konfiguraci se nepodařilo načíst.</div>'; });
  }

  function cfgHtml(c) {
    function inp(id, val) { return '<input id="' + id + '" type="number" inputmode="numeric" value="' + attr(val) + '">'; }
    var types = CAND_TYPES.map(function (t) {
      var on = (c.candidate_types || []).indexOf(t.k) >= 0;
      return '<label><input type="checkbox" data-ctype="' + t.k + '" ' + (on ? 'checked' : '') + '> ' + t.l + '</label>';
    }).join('');
    return '<div class="pmf-cfg">'
      + '<div class="pm-sect">📏 Poloměry a prahy</div>'
      + '<div class="pm-grid three">'
      + '  <div class="pm-f"><label>🅿️ Parkoviště do (m)</label>' + inp('cfg-parking_radius', c.parking_radius) + '</div>'
      + '  <div class="pm-f"><label>⚔️ Konkurence do (m)</label>' + inp('cfg-competition_radius', c.competition_radius) + '</div>'
      + '  <div class="pm-f"><label>🏪 Tahouni provozu do (m)</label>' + inp('cfg-anchor_radius', c.anchor_radius) + '</div>'
      + '  <div class="pm-f"><label>👥 Populace — okruh (km)</label>' + inp('cfg-population_radius_km', c.population_radius_km) + '</div>'
      + '  <div class="pm-f"><label>👥 Min. spádová populace</label>' + inp('cfg-min_population', c.min_population) + '</div>'
      + '  <div class="pm-f"><label>✅ Práh „vhodné" (skóre 0–100)</label>' + inp('cfg-min_score', c.min_score) + '</div>'
      + '</div>'
      + '<div class="pm-sect">⚖️ Váhy faktorů <span style="font-weight:400;text-transform:none;color:var(--text2)">(jejich poměr určuje výsledné skóre)</span></div>'
      + '<div class="pm-grid three">'
      + '  <div class="pm-f"><label>Parkování</label>' + inp('cfg-w-parking', c.weights.parking) + '</div>'
      + '  <div class="pm-f"><label>Konkurence (bez ní)</label>' + inp('cfg-w-competition', c.weights.competition) + '</div>'
      + '  <div class="pm-f"><label>Populace</label>' + inp('cfg-w-population', c.weights.population) + '</div>'
      + '  <div class="pm-f"><label>Tahouni provozu</label>' + inp('cfg-w-anchors', c.weights.anchors) + '</div>'
      + '  <div class="pm-f"><label>🔢 Max. kandidátů</label>' + inp('cfg-max_candidates', c.max_candidates) + '</div>'
      + '</div>'
      + '<div class="pm-sect">🎯 Co brát jako kandidáta</div>'
      + '<div class="pmf-types">' + types + '</div>'
      + '<div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="pm-btn primary" id="cfg-save">💾 Uložit konfiguraci</button><button class="pm-btn ghost" id="cfg-reset">↺ Výchozí</button><span class="pm-msg" id="cfg-msg"></span></div>'
      + '</div>';
  }
  function wireCfg() {
    var b = document.getElementById('cfg-save'); if (b) b.onclick = saveConfig;
    var r = document.getElementById('cfg-reset'); if (r) r.onclick = function () {
      var d = fstate.defaults; if (!d) return;
      var wrap = document.getElementById('pmf-cfgwrap'); wrap.innerHTML = cfgHtml(d); wireCfg();
      var m = document.getElementById('cfg-msg'); if (m) { m.className = 'pm-msg'; m.textContent = 'Výchozí hodnoty — nezapomeň uložit.'; }
    };
  }

  function collectCfg() {
    function n(id) { var el = document.getElementById(id); return el ? num(el.value) : null; }
    var types = [];
    document.querySelectorAll('[data-ctype]').forEach(function (el) { if (el.checked) types.push(el.getAttribute('data-ctype')); });
    return {
      parking_radius: n('cfg-parking_radius'), competition_radius: n('cfg-competition_radius'),
      anchor_radius: n('cfg-anchor_radius'), population_radius_km: n('cfg-population_radius_km'),
      min_population: n('cfg-min_population'), min_score: n('cfg-min_score'), max_candidates: n('cfg-max_candidates'),
      weights: { parking: n('cfg-w-parking'), competition: n('cfg-w-competition'), population: n('cfg-w-population'), anchors: n('cfg-w-anchors') },
      candidate_types: types
    };
  }
  function saveConfig() {
    var msg = document.getElementById('cfg-msg'); msg.className = 'pm-msg'; msg.textContent = 'Ukládám…';
    fapi('/config', { method: 'PUT', body: collectCfg() }).then(function (r) {
      fstate.config = r.config; msg.className = 'pm-msg ok'; msg.textContent = '✓ Uloženo';
    }).catch(function (e) { msg.className = 'pm-msg err'; msg.textContent = e.message; });
  }

  function runSearch() {
    var area = document.getElementById('pmf-area').value.trim();
    var msg = document.getElementById('pmf-msg');
    if (area.length < 2) { msg.className = 'pm-msg err'; msg.textContent = 'Zadej město nebo oblast.'; return; }
    msg.className = 'pm-msg'; msg.textContent = 'Hledám v OpenStreetMap… (může to pár sekund trvat)';
    document.getElementById('pmf-results').innerHTML = '';
    var go = document.getElementById('pmf-go'); go.disabled = true;
    fapi('/search', { method: 'POST', body: { area: area } }).then(function (r) {
      go.disabled = false; fstate.result = r; msg.textContent = ''; renderResults(r);
    }).catch(function (e) { go.disabled = false; msg.className = 'pm-msg err'; msg.textContent = e.message; });
  }

  function renderResults(r) {
    var box = document.getElementById('pmf-results');
    if (!r || !r.candidates || !r.candidates.length) {
      document.getElementById('pmf-map').style.display = 'none';
      box.innerHTML = '<div class="pm-hint">' + esc((r && r.note) || 'Žádní kandidáti. Zkus jinou oblast nebo uprav konfiguraci.') + '</div>';
      return;
    }
    var pop = r.population != null ? r.population.toLocaleString('cs-CZ') : '—';
    var sum = '<div class="pmf-sum">'
      + '<span>Oblast: <b>' + esc((r.area.display_name || '').slice(0, 60)) + '</b></span>'
      + '<span>Spádová populace: <b>' + pop + '</b>' + (r.population_source ? ' (' + esc(r.population_source) + ')' : '') + '</span>'
      + '<span>Kandidátů: <b>' + r.candidates.length + '</b></span>'
      + '<span>Konkurence v oblasti: <b>' + (r.counts ? r.counts.competition : '?') + '</b></span>'
      + '</div>';
    fstate.selected = {};
    var bulk = '<div class="pmf-bulk">'
      + '<input type="checkbox" id="pmf-selall" title="Vybrat vše" style="width:18px;height:18px;accent-color:#eab308">'
      + '<span class="cnt" id="pmf-selcnt">Vybráno: 0</span>'
      + '<span class="sp"></span>'
      + '<button class="pm-btn ghost" id="pmf-selsuit">Vybrat vhodné</button>'
      + '<button class="pm-btn primary" id="pmf-savesel">＋ Založit vybraná</button>'
      + '</div>';
    box.innerHTML = sum + bulk + r.candidates.map(cardHtml).join('');
    document.getElementById('pmf-map').style.display = '';
    document.getElementById('pmf-selall').onchange = function () { toggleAll(this.checked); };
    document.getElementById('pmf-selsuit').onclick = selectSuitable;
    document.getElementById('pmf-savesel').onclick = saveSelected;
    updateSelCount();
    setTimeout(function () { drawMap(r); }, 60);
  }

  function scoreColor(s) { return s >= (fstate.config ? fstate.config.min_score : 55) ? '#22c55e' : (s >= 40 ? '#eab308' : '#ef4444'); }

  function cardHtml(c, i) {
    var m = c.metrics;
    var chips = '';
    chips += '<span class="pmf-chip ' + (m.parking.count ? 'good' : 'bad') + '">🅿️ ' + (m.parking.count ? ('parkoviště ' + (m.parking.nearest_m != null ? m.parking.nearest_m + ' m' : 'ano')) : 'bez parkoviště') + '</span>';
    chips += '<span class="pmf-chip ' + (m.competition.count ? 'bad' : 'good') + '">⚔️ ' + (m.competition.count ? ('konkurence ' + m.competition.count + '×' + (m.competition.nearest_m != null ? ', nejbl. ' + m.competition.nearest_m + ' m' : '')) : 'bez konkurence') + '</span>';
    chips += '<span class="pmf-chip">🏪 tahouni ' + m.anchors.count + '</span>';
    var addr = c.name ? esc(c.name) : 'Místo';
    return '<div class="pmf-card" id="pmf-card-' + i + '">'
      + '<input type="checkbox" class="pick" data-pick="' + i + '" onchange="__pmfPick(' + i + ',this.checked)">'
      + '<div class="top"><div><div style="font-weight:700;font-size:15px">' + addr + (c.shop ? ' <span style="font-size:12px;color:var(--text2)">· ' + esc(c.shop) + '</span>' : '') + '</div>'
      + '<div style="font-size:12px;color:var(--text2);margin-top:2px">' + c.lat.toFixed(5) + ', ' + c.lon.toFixed(5) + ' · <span style="color:' + scoreColor(c.score) + '">' + esc(c.verdict) + '</span></div></div>'
      + '<div class="pmf-score" style="color:' + scoreColor(c.score) + '">' + c.score + '</div></div>'
      + '<div class="pmf-chips">' + chips + '</div>'
      + '<div class="pmf-cardact">'
      + '  <button class="pm-btn ghost" onclick="__pmfFocus(' + i + ')">📍 Na mapě</button>'
      + '  <button class="pm-btn ghost" onclick="__pmfAnalyze(' + i + ')">🤖 Analyzovat (AI)</button>'
      + '  <button class="pm-btn primary" onclick="__pmfSave(' + i + ')">＋ Založit jako místo</button>'
      + '  <a class="pm-btn ghost" href="https://www.openstreetmap.org/?mlat=' + c.lat + '&mlon=' + c.lon + '&zoom=18" target="_blank" rel="noopener">🗺️ OSM</a>'
      + '</div>'
      + '<div class="pmf-ai" id="pmf-ai-' + i + '" style="display:none"></div>'
      + '</div>';
  }

  function drawMap(r) {
    if (typeof L === 'undefined') return;
    var el = document.getElementById('pmf-map'); if (!el) return;
    if (fstate.map) { try { fstate.map.remove(); } catch (e) {} fstate.map = null; }
    fstate.markers = [];
    try {
      fstate.map = L.map('pmf-map', { scrollWheelZoom: false }).setView([r.area.lat, r.area.lon], 12);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }).addTo(fstate.map);
      var pts = [];
      r.candidates.forEach(function (c, i) {
        var col = scoreColor(c.score);
        var icon = L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 24],
          html: '<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' + col + ';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>' });
        var mk = L.marker([c.lat, c.lon], { icon: icon }).addTo(fstate.map);
        mk.bindTooltip((c.name || 'Místo') + ' — ' + c.score, { direction: 'top', offset: [0, -22] });
        mk.on('click', function () { var card = document.getElementById('pmf-card-' + i); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        fstate.markers.push(mk); pts.push([c.lat, c.lon]);
      });
      if (pts.length) { try { fstate.map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); } catch (e) {} }
    } catch (e) {}
  }

  window.__pmfFocus = function (i) {
    var c = fstate.result && fstate.result.candidates[i]; if (!c || !fstate.map) return;
    document.getElementById('pmf-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    fstate.map.setView([c.lat, c.lon], 16);
    if (fstate.markers[i]) fstate.markers[i].openTooltip();
  };

  window.__pmfAnalyze = function (i) {
    var c = fstate.result && fstate.result.candidates[i]; if (!c) return;
    var box = document.getElementById('pmf-ai-' + i); box.style.display = ''; box.innerHTML = '🤖 Analyzuji okolí a píšu zhodnocení…';
    fapi('/analyze', { method: 'POST', body: { lat: c.lat, lon: c.lon, ai: true } }).then(function (r) {
      var ai = r.ai;
      if (!ai) { box.innerHTML = '<b>Skóre ' + r.score + '/100 — ' + esc(r.verdict) + '</b><div class="pm-hint">AI report není dostupný (chybí klíč), zobrazeny jen metriky.</div>'; return; }
      var facs = (ai.factors || []).map(function (f) { return '<span class="pmf-chip ' + (f.good ? 'good' : 'bad') + '">' + esc(f.label) + ': ' + esc(f.value) + '</span>'; }).join('');
      box.innerHTML = '<div style="font-weight:700;margin-bottom:4px">' + esc(ai.verdict || '') + ' · ' + ai.scorePct + '/100</div>'
        + '<div>' + esc(ai.summary || '') + '</div>'
        + (facs ? '<div class="pmf-chips" style="margin-top:8px">' + facs + '</div>' : '')
        + (ai.recommendation ? '<div class="pm-hint" style="margin-top:8px">💡 ' + esc(ai.recommendation) + '</div>' : '');
    }).catch(function (e) { box.innerHTML = '<span style="color:#f7a1a1">Chyba analýzy: ' + esc(e.message) + '</span>'; });
  };

  window.__pmfSave = function (i) {
    var c = fstate.result && fstate.result.candidates[i]; if (!c) return;
    var city = (fstate.result.area.display_name || '').split(',')[0].trim();
    var note = 'Z vyhledávače lokalit — skóre ' + c.score + '/100 (' + c.verdict + '). '
      + 'Parkoviště: ' + (c.metrics.parking.count ? 'ano' : 'ne') + ', konkurence v okruhu: ' + c.metrics.competition.count + ', tahouni: ' + c.metrics.anchors.count + '.';
    fapi('/save-candidate', { method: 'POST', body: candPayload(c, city, note) })
      .then(function () {
        var btn = document.querySelector('#pmf-card-' + i + ' .pm-btn.primary'); if (btn) { btn.textContent = '✓ Založeno'; btn.disabled = true; }
        load();
      }).catch(function (e) { alert('Nepodařilo se založit: ' + e.message); });
  };

  // ── Výběr kandidátů + hromadné založení ──
  window.__pmfPick = function (i, on) {
    if (on) fstate.selected[i] = true; else delete fstate.selected[i];
    var card = document.getElementById('pmf-card-' + i); if (card) card.classList.toggle('sel', !!on);
    updateSelCount();
  };
  function selCount() { return Object.keys(fstate.selected).length; }
  function updateSelCount() {
    var el = document.getElementById('pmf-selcnt'); if (el) el.textContent = 'Vybráno: ' + selCount();
    var sv = document.getElementById('pmf-savesel'); if (sv) sv.textContent = '＋ Založit vybraná' + (selCount() ? ' (' + selCount() + ')' : '');
  }
  function toggleAll(on) {
    if (!fstate.result) return;
    fstate.selected = {};
    fstate.result.candidates.forEach(function (c, i) { if (on) fstate.selected[i] = true; });
    document.querySelectorAll('[data-pick]').forEach(function (cb) { cb.checked = on; var card = cb.closest('.pmf-card'); if (card) card.classList.toggle('sel', on); });
    updateSelCount();
  }
  function selectSuitable() {
    if (!fstate.result) return;
    fstate.selected = {};
    fstate.result.candidates.forEach(function (c, i) { if (c.suitable) fstate.selected[i] = true; });
    document.querySelectorAll('[data-pick]').forEach(function (cb) { var i = Number(cb.getAttribute('data-pick')); var on = !!fstate.selected[i]; cb.checked = on; var card = cb.closest('.pmf-card'); if (card) card.classList.toggle('sel', on); });
    var sa = document.getElementById('pmf-selall'); if (sa) sa.checked = false;
    updateSelCount();
  }
  function candPayload(c, city, note) {
    var m = c.metrics || {};
    return {
      lat: c.lat, lon: c.lon, name: c.name, city: city, score: c.score, verdict: c.verdict, note: note,
      has_parking: !!(m.parking && m.parking.count > 0),
      parking_distance_m: (m.parking && m.parking.nearest_m != null) ? m.parking.nearest_m : null,
      population: fstate.result ? fstate.result.population : null,
      anchor_count: m.anchors ? m.anchors.count : null,
      competition_count: m.competition ? m.competition.count : null
    };
  }

  function saveSelected() {
    var idx = Object.keys(fstate.selected); if (!idx.length) { alert('Nejdřív zaškrtni aspoň jedno místo.'); return; }
    var city = (fstate.result.area.display_name || '').split(',')[0].trim();
    var items = idx.map(function (i) {
      var c = fstate.result.candidates[i];
      var note = 'Z vyhledávače lokalit — skóre ' + c.score + '/100 (' + c.verdict + '). Parkoviště: ' + (c.metrics.parking.count ? 'ano' : 'ne') + ', konkurence: ' + c.metrics.competition.count + ', tahouni: ' + c.metrics.anchors.count + '.';
      return candPayload(c, city, note);
    });
    var btn = document.getElementById('pmf-savesel'); btn.disabled = true; btn.textContent = 'Zakládám…';
    fapi('/save-candidates', { method: 'POST', body: { candidates: items } }).then(function (r) {
      btn.textContent = '✓ Založeno: ' + (r.created || items.length);
      load();
      setTimeout(function () { btn.disabled = false; updateSelCount(); }, 1500);
    }).catch(function (e) { btn.disabled = false; updateSelCount(); alert('Nepodařilo se založit: ' + e.message); });
  }

  // ── Analýza spádové oblasti (kružítko kolem města) ──
  function popColor(p) { return p >= 50000 ? '#7f0000' : p >= 20000 ? '#b30000' : p >= 10000 ? '#d7301f' : p >= 5000 ? '#ef6548' : p >= 2000 ? '#fc8d59' : p >= 1000 ? '#fdbb84' : p >= 500 ? '#fdd49e' : '#fee8c8'; }
  function popRadius(p) { return Math.max(4, Math.min(34, Math.sqrt(p) / 3)); }

  function runAreaAnalysis() {
    var area = document.getElementById('pmf-area').value.trim();
    var radius = parseInt(document.getElementById('pmf-radius').value, 10) || 15;
    var msg = document.getElementById('pmf-msg');
    if (area.length < 2) { msg.className = 'pm-msg err'; msg.textContent = 'Zadej město nebo oblast.'; return; }
    msg.className = 'pm-msg'; msg.textContent = 'Analyzuji spádovou oblast ' + radius + ' km… (počítám populaci a hustotu)';
    document.getElementById('pmf-results').innerHTML = '';
    var btn = document.getElementById('pmf-areabtn'); btn.disabled = true;
    fapi('/area-analysis', { method: 'POST', body: { area: area, radius_km: radius } }).then(function (r) {
      btn.disabled = false; msg.textContent = ''; fstate.area = r; renderArea(r);
    }).catch(function (e) { btn.disabled = false; msg.className = 'pm-msg err'; msg.textContent = e.message; });
  }

  function renderArea(r) {
    var box = document.getElementById('pmf-results');
    document.getElementById('pmf-map').style.display = '';
    var tot = r.total_population != null ? r.total_population.toLocaleString('cs-CZ') : '—';
    var dens = r.density_per_km2 != null ? r.density_per_km2.toLocaleString('cs-CZ') : '—';
    var ai = r.ai;
    var top = r.places.slice(0, 10).map(function (p) {
      return '<span class="pmf-chip"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + popColor(p.population) + ';margin-right:5px"></span>' + esc(p.name) + ' — ' + p.population.toLocaleString('cs-CZ') + (p.dist_km != null ? ' · ' + p.dist_km + ' km' : '') + '</span>';
    }).join('');
    var bands = [['<500', '#fee8c8'], ['500+', '#fdd49e'], ['1k+', '#fdbb84'], ['2k+', '#fc8d59'], ['5k+', '#ef6548'], ['10k+', '#d7301f'], ['20k+', '#b30000'], ['50k+', '#7f0000']];
    var legend = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center"><span style="font-size:11.5px;color:var(--text2)">Velikost obce:</span>'
      + bands.map(function (x) { return '<span style="font-size:11px;display:inline-flex;align-items:center;gap:4px;color:var(--text2)"><span style="width:12px;height:12px;border-radius:50%;background:' + x[1] + ';border:1px solid rgba(255,255,255,.35)"></span>' + x[0] + '</span>'; }).join('') + '</div>';
    var noData = (!r.places.length) ? '<div class="pm-hint" style="margin-top:8px;color:#f2d675">⚠️ Nenašla se data o populaci obcí. Pro přesnou spádovou populaci nastav na serveru <b>GEONAMES_USERNAME</b> (zdarma na geonames.org).</div>' : '';
    box.innerHTML = '<div class="pmf-card">'
      + '<div class="top"><div><div style="font-weight:700;font-size:16px">🎯 Spádová oblast ' + r.radius_km + ' km — ' + esc((r.center.display_name || '').split(',')[0]) + '</div>'
      + '<div style="font-size:12px;color:var(--text2);margin-top:2px">Zdroj dat: ' + esc(r.source || '') + ' · obcí v okruhu: ' + (r.places_count || r.places.length) + '</div></div>'
      + '<div style="text-align:right"><div class="pmf-score" style="color:#4aa3ea">' + tot + '</div><div style="font-size:11px;color:var(--text2)">obyvatel · ' + dens + ' /km²</div></div></div>'
      + (ai ? ('<div class="pmf-ai" style="display:block">' + (ai.density_label ? '<b>' + esc(ai.density_label) + '</b> · ' : '') + esc(ai.summary || '') + (ai.recommendation ? '<div class="pm-hint" style="margin-top:6px">💡 ' + esc(ai.recommendation) + '</div>' : '') + '</div>') : '')
      + noData + legend
      + (top ? ('<div style="font-size:11.5px;color:var(--text2);margin-top:12px;margin-bottom:4px">Největší obce v okruhu</div><div class="pmf-chips">' + top + '</div>') : '')
      + '</div>';
    setTimeout(function () { drawAreaMap(r); }, 60);
  }

  function drawAreaMap(r) {
    if (typeof L === 'undefined') return;
    var el = document.getElementById('pmf-map'); if (!el) return;
    if (fstate.map) { try { fstate.map.remove(); } catch (e) {} fstate.map = null; }
    fstate.markers = [];
    try {
      fstate.map = L.map('pmf-map', { scrollWheelZoom: false }).setView([r.center.lat, r.center.lon], 10);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }).addTo(fstate.map);
      var ring = L.circle([r.center.lat, r.center.lon], { radius: r.radius_km * 1000, color: '#1e86e0', weight: 2, fill: true, fillColor: '#1e86e0', fillOpacity: .04, dashArray: '6 6' }).addTo(fstate.map);
      L.circleMarker([r.center.lat, r.center.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#1e86e0', fillOpacity: 1 }).addTo(fstate.map).bindTooltip('Střed oblasti', { direction: 'top' });
      r.places.forEach(function (p) {
        L.circleMarker([p.lat, p.lon], { radius: popRadius(p.population), color: 'rgba(0,0,0,.4)', weight: .5, fillColor: popColor(p.population), fillOpacity: .82 })
          .addTo(fstate.map).bindTooltip(esc(p.name) + ': ' + p.population.toLocaleString('cs-CZ'), { direction: 'top' });
      });
      try { fstate.map.fitBounds(ring.getBounds(), { padding: [20, 20] }); } catch (e) {}
    } catch (e) {}
  }

  window.__pmfClose = closeFinder;
  function closeFinder() {
    var ov = document.getElementById('pmf-ov'); if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
    if (fstate.map) { try { fstate.map.remove(); } catch (e) {} fstate.map = null; fstate.markers = []; }
  }

  // ── Start ──
  function boot() { injectTab(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
