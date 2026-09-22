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
      + '  <button class="pm-btn primary" id="pm-new">＋ Nové místo</button>'
      + '  <a class="pm-btn ghost" href="/compounder/location" target="_blank" rel="noopener" title="Náhled veřejné stránky">🌐 Veřejný přehled</a>'
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
      var pub = s.is_public ? '<span class="pm-pub" style="color:#22c55e">● Ano</span>' : '<span class="pm-pub" style="color:var(--text2)">○ Ne</span>';
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
        + (s.is_public ? '<button title="Otevřít na webu" onclick="window.open(\'/compounder/location\',\'_blank\')">🌐</button>' : '')
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
      + '  <div class="pm-f full"><label class="pm-check"><input type="checkbox" id="pmf-public" ' + chk('is_public') + '> Zveřejnit na pradlomaty.info/location</label><div class="pm-hint">Zveřejní se jen při stavu „Zveřejněné" nebo „Rezervováno".</div></div>'
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
      is_public: chk('pmf-public'),
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
        + (spot ? '<a class="pm-hint" href="/compounder/location" target="_blank" rel="noopener">🌐 Zobrazit veřejný přehled</a>' : '<span></span>')
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
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(state.editMap);
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

  // ── Start ──
  function boot() { injectTab(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
