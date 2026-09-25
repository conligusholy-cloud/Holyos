// HolyOS — Lokality (nabídky míst z webu bestseries.global)
// =============================================================================
// Self-injecting záložka pro modul Site Development. Přesunuto z Prodejních
// objednávek. Injektuje tlačítko do .sd-tabs + panel a naslouchá události sd:tab.
// API: /api/sites?source=public , detail /api/sites/:id , /api/compounder/*
// =============================================================================
(function () {
  'use strict';

  // Lokální helpery (dřív sdílené s Compounding sekcí).
  function kvEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function kvNum(n){ n = Number(n); if(!isFinite(n)) n = 0; return n.toLocaleString('cs-CZ'); }

  function injectStyles(){
    if (document.getElementById('lok-tab-styles')) return;
    var css = ''
      + '#sd-tab-lokality .form-group{display:flex;flex-direction:column;gap:4px}'
      + '#sd-tab-lokality .form-group label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text2)}'
      + '#sd-tab-lokality .form-group select{padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;font-size:13px}'
      + '.lok-map-full{position:fixed!important;inset:3vh 3vw!important;height:auto!important;z-index:3000!important;box-shadow:0 10px 40px rgba(0,0,0,.6)}'
      + '#sd-tab-lokality .stats-bar{display:flex;gap:12px;flex-wrap:wrap}'
      + '#sd-tab-lokality .stats-bar .stat-card{flex:1;min-width:160px}';
    var st = document.createElement('style'); st.id='lok-tab-styles'; st.textContent=css; document.head.appendChild(st);
  }

  function panelHtml(){
    return ''
      + '<div class="toolbar" style="margin-bottom:14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">'
      + '  <select id="lok-status-filter" onchange="loadLokality()" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px;">'
      + '    <option value="">Všechny stavy</option>'
      + '    <option value="lead">Nová nabídka</option>'
      + '    <option value="researching">Prověřuje se</option>'
      + '    <option value="negotiating">Vyjednává se</option>'
      + '    <option value="contract">Smlouva</option>'
      + '    <option value="operational">V provozu</option>'
      + '    <option value="rejected">Zamítnuto</option>'
      + '    <option value="lost">Ztraceno</option>'
      + '  </select>'
      + '  <input type="text" id="lok-search" placeholder="Hledat adresu / město / kontakt…" onkeyup="if(event.key===\'Enter\')loadLokality()" style="flex:1; min-width:200px;">'
      + '  <button class="btn" onclick="loadLokality()">↻ Obnovit</button>'
      + '  <button class="btn" onclick="openLokalityStats()" title="Statistika návštěvnosti webu + AI návrhy na konverzi">📊 Statistika</button>'
      + '  <a class="btn" href="/lokality/" target="_blank" rel="noopener" title="Otevřít veřejný web pro nabídky lokalit">🌐 Veřejný web</a>'
      + '</div>'
      + '<div id="lok-summary" style="margin-bottom:14px;"></div>'
      + '<div id="lok-table"><div style="color:var(--text2);padding:20px;">Načítám…</div></div>';
  }

  function boot(){
    var bar = document.querySelector('.sd-tabs');
    if (!bar || document.getElementById('sd-tab-lokality')) return;
    injectStyles();
    var btn = document.createElement('button');
    btn.type='button'; btn.className='sd-tab'; btn.setAttribute('data-sdtab','lokality');
    btn.textContent='📍 Nabídky z webu';
    btn.onclick=function(){ window.sdSwitchTab('lokality'); };
    bar.appendChild(btn);
    var host = document.getElementById('sd-tab-host') || document.querySelector('.content') || document.body;
    var div = document.createElement('div');
    div.id='sd-tab-lokality'; div.className='sd-panel'; div.setAttribute('data-sdtab-panel','lokality');
    div.style.display='none';
    div.innerHTML = panelHtml();
    host.appendChild(div);
    document.addEventListener('sd:tab', function(e){ if (e && e.detail && e.detail.name==='lokality') loadLokality(); });
  }

    var _lokItems = [];
    var _lokMap = null, _lokFootprint = null, _lokCenter = null;
    var LOK_SELLERS = null; // seznam obchodníků (lazy z /api/compounder/sellers)
    async function lokLoadSellers() {
      if (LOK_SELLERS !== null) return LOK_SELLERS;
      try { var sr = await fetch('/api/compounder/sellers', { credentials: 'include' }); LOK_SELLERS = sr.ok ? await sr.json() : []; }
      catch (e) { LOK_SELLERS = []; }
      return LOK_SELLERS;
    }
    function lokSellerName(id) {
      if (!id) return '';
      var s = (LOK_SELLERS || []).filter(function(x){ return x.id === id; })[0];
      return s ? (((s.first_name||'')+' '+(s.last_name||'')).trim() || ('#'+s.id)) : ('#'+id);
    }
    function lokOwnerSelect(s) {
      if (!LOK_SELLERS || !LOK_SELLERS.length) {
        return '<span title="Zaškrtni u osoby Obchodník nebo Vedoucí obchodu v modulu Lidé a HR" style="color:var(--text2);font-size:11px;">— nejsou obchodníci —</span>';
      }
      var cur = s.assigned_to_id || (s.assigned_to && s.assigned_to.id) || '';
      var sel = '<select onclick="event.stopPropagation()" onchange="lokSetOwner(' + s.id + ', this.value)" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;max-width:150px;">';
      sel += '<option value="">— nepřiřazeno —</option>';
      LOK_SELLERS.forEach(function(x){ var nm = ((x.first_name||'')+' '+(x.last_name||'')).trim() || ('#'+x.id); sel += '<option value="' + x.id + '"' + (cur===x.id?' selected':'') + '>' + lokEsc(nm) + '</option>'; });
      sel += '</select>';
      return sel;
    }
    function lokDetailOwnerOpts(s) {
      var cur = (s.assigned_to && s.assigned_to.id) || s.assigned_to_id || '';
      var opts = '<option value="">— nepřiřazeno —</option>';
      (LOK_SELLERS || []).forEach(function(x){ var nm = ((x.first_name||'')+' '+(x.last_name||'')).trim() || ('#'+x.id); opts += '<option value="' + x.id + '"' + (cur===x.id?' selected':'') + '>' + lokEsc(nm) + '</option>'; });
      return opts;
    }
    async function lokSetOwner(id, val) {
      var assigned = val ? parseInt(val, 10) : null;
      try {
        var r = await fetch('/api/sites/' + id, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_to_id: assigned }),
        });
        if (!r.ok) throw new Error('http ' + r.status);
        var it = _lokItems.filter(function(x){ return x.id === id; })[0];
        if (it) { it.assigned_to_id = assigned; it.assigned_to = assigned ? { id: assigned } : null; }
      } catch (e) { alert('Přiřazení obchodníka se nepodařilo uložit.'); }
    }
    var LOK_STATUS = {
      lead: { label: 'Nová nabídka', color: '#22c55e' },
      researching: { label: 'Prověřuje se', color: '#eab308' },
      negotiating: { label: 'Vyjednává se', color: '#f97316' },
      contract: { label: 'Smlouva', color: '#6366f1' },
      operational: { label: 'V provozu', color: '#14b8a6' },
      rejected: { label: 'Zamítnuto', color: '#ef4444' },
      lost: { label: 'Ztraceno', color: '#94a3b8' },
    };
    function lokEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
    function lokStatusBadge(st){ var m = LOK_STATUS[st] || { label: st||'—', color: '#94a3b8' }; return '<span class="badge" style="background:'+m.color+'22;color:'+m.color+';">'+lokEsc(m.label)+'</span>'; }
    function lokYesNo(v){ return v===true ? '<span style="color:#22c55e;">ano</span>' : (v===false ? '<span style="color:#ef4444;">ne</span>' : '<span style="color:var(--text2);">?</span>'); }
    function lokDate(d){ try { return d ? new Date(d).toLocaleDateString('cs-CZ') : '—'; } catch(e){ return '—'; } }

    async function loadLokality() {
      var box = document.getElementById('lok-table');
      if (box) box.innerHTML = '<div style="color:var(--text2);padding:20px;">Načítám…</div>';
      try {
        var status = (document.getElementById('lok-status-filter')||{}).value || '';
        var q = ((document.getElementById('lok-search')||{}).value || '').trim();
        var url = '/api/sites?source=public&per_page=200' + (status ? '&status='+encodeURIComponent(status) : '') + (q ? '&q='+encodeURIComponent(q) : '');
        await lokLoadSellers();
        var r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error('http '+r.status);
        var data = await r.json();
        _lokItems = data.items || [];
        renderLokality(data);
      } catch (e) {
        if (box) box.innerHTML = '<div style="color:#ef4444;padding:20px;">Nepodařilo se načíst lokality: '+lokEsc(e.message)+'</div>';
      }
    }

    function renderLokality(data) {
      var box = document.getElementById('lok-table');
      var sum = document.getElementById('lok-summary');
      var items = _lokItems;
      if (sum) {
        var newCnt = items.filter(function(s){ return s.status==='lead'; }).length;
        sum.innerHTML = '<div class="stats-bar" style="padding:0;">'
          + '<div class="stat-card"><div class="stat-value">'+items.length+'</div><div class="stat-label">Nabídek z webu</div></div>'
          + '<div class="stat-card"><div class="stat-value">'+newCnt+'</div><div class="stat-label">Nových</div></div>'
          + '</div>';
      }
      if (!items.length) {
        box.innerHTML = '<div class="empty-state"><div class="empty-icon">📍</div><h3>Zatím žádné nabídky</h3><p>Nabídky míst pro prádlomat z webu bestseries.global se zobrazí zde.</p></div>';
        return;
      }
      var h = '<div style="overflow-x:auto;"><table class="data-table"><thead><tr>'
        + '<th>Přijato</th><th>Kontakt</th><th>Adresa</th><th>El.</th><th>Voda</th><th>Kanal.</th><th>Park.</th><th>Obchodník</th><th>Stav</th><th></th>'
        + '</tr></thead><tbody>';
      items.forEach(function(s){
        var contact = lokEsc(s.owner_name||'—') + (s.owner_phone?('<br><span style="color:var(--text2);font-size:11px;">'+lokEsc(s.owner_phone)+'</span>'):'') + (s.owner_email?('<br><span style="color:var(--text2);font-size:11px;">'+lokEsc(s.owner_email)+'</span>'):'');
        h += '<tr onclick="openLokalityDetail('+s.id+')">'
          + '<td style="white-space:nowrap;">'+lokDate(s.created_at)+'</td>'
          + '<td>'+contact+'</td>'
          + '<td>'+lokEsc(s.address||s.city||'—')+'</td>'
          + '<td>'+lokYesNo((s.utility_points&&s.utility_points.electricity)?true:(s.electricity_kw!=null?true:undefined))+'</td>'
          + '<td>'+lokYesNo(s.water_supply)+'</td>'
          + '<td>'+lokYesNo(s.sewage)+'</td>'
          + '<td>'+lokYesNo(s.parking)+'</td>'
          + '<td>'+lokOwnerSelect(s)+'</td>'
          + '<td>'+lokStatusBadge(s.status)+'</td>'
          + '<td style="text-align:right;">›</td>'
          + '</tr>';
      });
      h += '</tbody></table></div>';
      box.innerHTML = h;
    }

    async function openLokalityDetail(id) {
      var s;
      try {
        await lokLoadSellers();
        var r = await fetch('/api/sites/'+id, { credentials: 'include' });
        s = await r.json();
      } catch(e) { alert('Nepodařilo se načíst detail.'); return; }

      var statusOpts = Object.keys(LOK_STATUS).map(function(k){
        return '<option value="'+k+'"'+(s.status===k?' selected':'')+'>'+LOK_STATUS[k].label+'</option>';
      }).join('');

      var mapLinkBtn = s.map_link ? '<a class="btn btn-sm" href="'+lokEsc(s.map_link)+'" target="_blank" rel="noopener">🗺️ Otevřít v mapách</a>' : '';
      var up = s.utility_points || {};
      var slat = parseFloat(s.latitude), slng = parseFloat(s.longitude);
      var utilDist = function(k){
        var p = up[k]; if (!p || !isFinite(slat) || !isFinite(p.lat)) return null;
        try { return Math.round(L.latLng(slat, slng).distanceTo(L.latLng(p.lat, p.lng))); } catch(e){ return null; }
      };
      var pin = function(k){ if (!up[k]) return ''; var d = utilDist(k); return ' <span title="Označeno sloupkem na mapě" style="color:#16b981;">📍'+(d!=null?(' '+d+' m'):'')+'</span>'; };

      var body = ''
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
        +   '<div>'
        +     '<div style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Kontakt</div>'
        +     '<div style="font-weight:600;font-size:15px;">'+lokEsc(s.owner_name||'—')+'</div>'
        +     (s.owner_phone?'<div style="margin-top:4px;">📞 <a href="tel:'+lokEsc(s.owner_phone)+'">'+lokEsc(s.owner_phone)+'</a></div>':'')
        +     (s.owner_email?'<div style="margin-top:4px;">✉️ <a href="mailto:'+lokEsc(s.owner_email)+'">'+lokEsc(s.owner_email)+'</a></div>':'')
        +     '<div style="margin-top:6px;font-size:13px;">🏠 Vlastník místa: '+(s.is_property_owner===true?'<b style="color:#22c55e;">Ano</b>':(s.is_property_owner===false?'<b style="color:#f97316;">Ne</b>':'<span style="color:var(--text2);">neuvedeno</span>'))+'</div>'
        +     '<div style="margin-top:4px;font-size:13px;">🏷️ Zájem: <b>'+({rent:'Pronájem',purchase:'Prodej pozemku',other:'Zatím neví'}[s.site_type]||'Pronájem')+'</b></div>'
        +     '<div style="margin-top:12px;font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Adresa</div>'
        +     '<div>'+lokEsc(s.address||'—')+'</div>'
        +     (s.city?'<div style="color:var(--text2);font-size:13px;">'+lokEsc(s.zip||'')+' '+lokEsc(s.city)+'</div>':'')
        +     '<div style="margin-top:12px;font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Přípojky a okolí</div>'
        +     '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">'
        +       '<div>⚡ Elektřina: '+lokYesNo(up.electricity?true:(s.electricity_kw!=null?true:undefined))+pin('electricity')+'</div>'
        +       '<div>💧 Voda: '+lokYesNo(up.water?true:s.water_supply)+pin('water')+'</div>'
        +       '<div>🚿 Kanalizace: '+lokYesNo(up.sewage?true:s.sewage)+pin('sewage')+'</div>'
        +       '<div>🅿️ Parkoviště: '+lokYesNo(up.parking?true:s.parking)+pin('parking')+'</div>'
        +     '</div>'
        +     (s.capacity_note?'<div style="margin-top:8px;font-size:12px;color:var(--text2);">'+lokEsc(s.capacity_note)+'</div>':'')
        +     (s.owner_note?('<div style="margin-top:12px;font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Poznámka zájemce</div><div style="font-size:13px;white-space:pre-wrap;">'+lokEsc(s.owner_note)+'</div>'):'')
        +   '</div>'
        +   '<div>'
        +     '<div style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Umístění stroje na mapě</div>'
        +     '<div id="lok-detail-map" style="height:340px;border-radius:10px;border:1px solid var(--border);overflow:hidden;"></div>'
        +     '<div style="font-size:11px;color:var(--text2);margin-top:4px;">Klikni do mapy (nebo ⛶) pro zvětšení · vpravo nahoře přepneš Satelit/Mapu.</div>'
        +     '<div style="margin-top:8px;">'+mapLinkBtn+'</div>'
        +   '</div>'
        + '</div>'
        + '<div style="margin-top:18px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">'
        +   '<div class="form-group"><label>Stav</label><select id="lok-detail-status" style="min-width:180px;">'+statusOpts+'</select></div>'
        +   '<div class="form-group"><label>Obchodník</label><select id="lok-detail-owner" onchange="lokSetOwner('+s.id+', this.value)" style="min-width:180px;">'+lokDetailOwnerOpts(s)+'</select></div>'
        +   '<button class="btn btn-primary" onclick="saveLokalityStatus('+s.id+')">💾 Uložit stav</button>'
        +   '<span id="lok-detail-msg" style="font-size:13px;color:var(--text2);"></span>'
        + '</div>';

      document.getElementById('modal-root').innerHTML =
        '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">'
        + '<div class="modal" style="width:820px;max-width:96vw;">'
        + '<h2>📍 Nabídka lokality</h2>'
        + body
        + '<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Zavřít</button></div>'
        + '</div></div>';

      // Mapa s obdélníkem prádlomatu ve skutečném měřítku.
      setTimeout(function(){ renderLokDetailMap(s); }, 60);
    }

    function renderLokDetailMap(s) {
      var el = document.getElementById('lok-detail-map');
      if (!el || typeof L === 'undefined') return;
      var lat = parseFloat(s.latitude), lng = parseFloat(s.longitude);
      if (!isFinite(lat) || !isFinite(lng)) { el.innerHTML = '<div style="padding:20px;color:var(--text2);">Poloha neuvedena.</div>'; return; }
      var map = L.map(el, { center: [lat, lng], zoom: 20, maxZoom: 20 });
      var lokSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 18, attribution: 'Tiles © Esri' });
      var lokStreets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
      var lokLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', { maxZoom: 20, maxNativeZoom: 19, pane: 'overlayPane', opacity: 0.9 });
      lokSat.addTo(map);
      L.control.layers({ '🛰️ Satelit': lokSat, '🗺️ Mapa': lokStreets }, { 'Popisky ulic': lokLabels }, { position: 'topright', collapsed: false }).addTo(map);

      // Zvětšení mapy — tlačítko ⛶ i klik do mapy (když je malá).
      function lokToggleFull() { el.classList.toggle('lok-map-full'); setTimeout(function(){ try { map.invalidateSize(); } catch(e){} }, 120); }
      var FullCtl = L.Control.extend({ options: { position: 'topleft' }, onAdd: function() {
        var b = L.DomUtil.create('a', 'leaflet-bar');
        b.href = '#'; b.title = 'Zvětšit / zmenšit mapu';
        b.style.cssText = 'display:flex;align-items:center;justify-content:center;width:30px;height:30px;font-size:16px;background:#fff;color:#000;text-decoration:none;';
        b.innerHTML = '⛶';
        L.DomEvent.on(b, 'click', function(e){ L.DomEvent.stop(e); lokToggleFull(); });
        return b;
      }});
      map.addControl(new FullCtl());
      map.on('click', function(){ if (!el.classList.contains('lok-map-full')) lokToggleFull(); });
      var wMm = s.footprint_w_mm || 3182, hMm = s.footprint_h_mm || 2015;
      var W = wMm/1000, H = hMm/1000, rotDeg = parseFloat(s.footprint_rotation)||0;
      var a = rotDeg*Math.PI/180, hw = W/2, hh = H/2;
      var pts = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(function(p){
        var rx = p[0]*Math.cos(a)-p[1]*Math.sin(a), ry = p[0]*Math.sin(a)+p[1]*Math.cos(a);
        var dLat = ry/111320, dLng = rx/(111320*Math.cos(lat*Math.PI/180));
        return [lat+dLat, lng+dLng];
      });
      L.polygon(pts, { color:'#16b981', weight:2, fillColor:'#16b981', fillOpacity:0.35 }).addTo(map);

      // Přípojky (sloupky) označené zájemcem.
      var UMETA = {
        electricity: { icon:'⚡', color:'#f5b301', label:'Elektřina' },
        water:       { icon:'💧', color:'#3b82f6', label:'Voda' },
        sewage:      { icon:'🚿', color:'#14b8a6', label:'Kanalizace' },
        parking:     { icon:'🅿️', color:'#8b5cf6', label:'Parkoviště' },
      };
      var up = s.utility_points || {};
      Object.keys(UMETA).forEach(function(k){
        var p = up[k];
        if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return;
        var m = UMETA[k];
        var icon = L.divIcon({ className:'', iconSize:[28,38], iconAnchor:[14,36], html:
          '<div style="width:28px;height:38px;position:relative;">'
          + '<div style="position:absolute;top:0;left:0;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:'+m.color+';border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.5);"></div>'
          + '<div style="position:absolute;top:3px;left:0;width:28px;height:22px;display:grid;place-items:center;font-size:14px;">'+m.icon+'</div>'
          + '</div>' });
        var dm = null; try { dm = Math.round(L.latLng(lat,lng).distanceTo(L.latLng(p.lat,p.lng))); } catch(e){}
        L.marker([p.lat, p.lng], { icon: icon }).addTo(map).bindTooltip(m.label + (dm!=null?(' · '+dm+' m'):''), { permanent:true, direction:'top', offset:[0,-32] });
        L.polyline([[lat,lng],[p.lat,p.lng]], { color:m.color, weight:2, dashArray:'3 5', opacity:0.85 }).addTo(map);
      });
      setTimeout(function(){ try { map.invalidateSize(); } catch(e){} }, 120);
    }

    async function saveLokalityStatus(id) {
      var sel = document.getElementById('lok-detail-status');
      var msg = document.getElementById('lok-detail-msg');
      if (!sel) return;
      if (msg) msg.textContent = 'Ukládám…';
      try {
        var r = await fetch('/api/sites/'+id, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: sel.value }),
        });
        if (!r.ok) throw new Error('http '+r.status);
        if (msg) { msg.textContent = 'Uloženo ✓'; msg.style.color = '#22c55e'; }
        loadLokality();
      } catch(e) {
        if (msg) { msg.textContent = 'Chyba uložení.'; msg.style.color = '#ef4444'; }
      }
    }
    window.loadLokality = loadLokality;
    var _lokStats = null;
    async function openLokalityStats(daysArg) {
      var days = (daysArg === undefined || daysArg === null || daysArg === '') ? '30' : String(daysArg);
      var DAYS_OPTS = [['today', 'Dnes'], ['7', '7 dní'], ['30', '30 dní'], ['90', '90 dní'], ['365', 'Rok']];
      var optsHtml = DAYS_OPTS.map(function(o) { return '<option value="' + o[0] + '"' + (o[0] === days ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      document.getElementById('modal-root').innerHTML =
        '<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="width:720px;max-width:96vw;max-height:92vh;overflow:auto;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"><h2 style="margin:0;">📊 Návštěvnost webu Lokality</h2><div><select id="lok-stats-days" onchange="openLokalityStats(this.value)" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:13px;margin-right:8px;">' + optsHtml + '</select><button class="btn btn-secondary" onclick="closeModal()">Zavřít</button></div></div>' +
        '<div id="lok-stats-body"><div style="color:var(--text2);padding:16px;">Načítám statistiky…</div></div>' +
        '</div></div>';
      try {
        var r = await fetch('/api/compounder/lokality-analytics?days=' + days, { credentials: 'include' });
        var d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        _lokStats = d;
        function kpi(label, val, color) { return '<div style="flex:1;min-width:110px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);">' + label + '</div><div style="font-size:22px;font-weight:800;color:' + (color || 'var(--text)') + ';margin-top:4px;">' + val + '</div></div>'; }
        function bars(arr) { arr = arr || []; var max = 1; arr.forEach(function(x) { if (x.count > max) max = x.count; }); return '<div style="display:flex;align-items:flex-end;gap:2px;height:80px;margin-top:6px;">' + arr.map(function(x) { var h = Math.round((x.count / max) * 100); return '<div title="' + kvEsc(x.label + ': ' + x.count) + '" style="flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;"><div style="height:' + h + '%;min-height:2px;background:#3b82f6;border-radius:3px 3px 0 0;"></div></div>'; }).join('') + '</div>'; }
        function listBox(title, arr, keyName) { return '<div style="flex:1;min-width:220px;"><div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">' + title + '</div>' + (arr && arr.length ? arr.map(function(x) { return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + kvEsc(x[keyName] || '—') + '</span><b>' + x.count + '</b></div>'; }).join('') : '<div style="color:var(--text2);font-size:13px;">Zatím žádná data.</div>') + '</div>'; }
        var body = document.getElementById('lok-stats-body'); if (!body) return;
        body.innerHTML =
          '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + kpi('🟢 Online teď', '<span id="lok-online-val">' + kvNum(d.onlineNow || 0) + '</span>', '#22c55e') + kpi('Návštěvy', kvNum(d.views), '#3b82f6') + kpi('Unikátní', kvNum(d.uniqueVisitors), '#3b82f6') + kpi('Prokliky', kvNum(d.clicks)) + kpi('Odeslané nabídky', kvNum(d.submits), '#10b981') + kpi('Konverze', d.conversionPct + ' %', '#10b981') + '</div>' +
          '<div style="margin-top:16px;font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">📈 Návštěvy v čase</div>' + bars(d.daily) +
          '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:18px;">' + listBox('Zdroje návštěv', d.topSources, 'source') + listBox('Odkud (země · město)', d.topRegions, 'region') + listBox('Na co lidé klikají', d.topClicks, 'label') + '</div>' +
          '<div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-primary" onclick="lokalityAiEval(this)">🤖 AI vyhodnocení konverze</button><button class="btn btn-primary" onclick="lokalityPersona(this)">🧑 AI: obraz ideálního zákazníka</button></div><div id="lok-ai-out" style="margin-top:12px;"></div>';
        // Živý update čísla „Online teď" každých 20 s (dokud je okno otevřené).
        if (window._lokOnlineTimer) clearInterval(window._lokOnlineTimer);
        window._lokOnlineTimer = setInterval(async function() {
          var el = document.getElementById('lok-online-val');
          if (!el) { clearInterval(window._lokOnlineTimer); return; }
          try { var rr = await fetch('/api/compounder/lokality-analytics?days=' + days, { credentials: 'include' }); var dd = await rr.json(); if (rr.ok) el.textContent = kvNum(dd.onlineNow || 0); } catch (_) {}
        }, 20000);
      } catch (e) {
        var b = document.getElementById('lok-stats-body'); if (b) b.innerHTML = '<div style="color:#ef4444;padding:16px;">Statistiky se nepodařilo načíst: ' + kvEsc(e.message) + '</div>';
      }
    }
    window.openLokalityStats = openLokalityStats;
    async function lokalityAiEval(btn) {
      var out = document.getElementById('lok-ai-out'); if (btn) btn.disabled = true;
      if (out) out.innerHTML = '<div style="color:var(--text2);font-size:13px;">🤖 AI analyzuje web a návštěvnost…</div>';
      try {
        var r = await fetch('/api/compounder/lokality-ai', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: _lokStats }) });
        var d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        var html = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">';
        if (d.conversionRating) html += '<div style="font-size:12px;color:var(--text2);">Hodnocení konverze: <b style="color:var(--text);">' + kvEsc(d.conversionRating) + '</b></div>';
        if (d.summary) html += '<div style="font-size:14px;margin-top:6px;">' + kvEsc(d.summary) + '</div>';
        if (d.insights && d.insights.length) { html += '<div style="margin-top:10px;">' + d.insights.map(function(x) { return '<div style="font-size:13px;margin-bottom:4px;"><b>' + kvEsc(x.label) + ':</b> ' + kvEsc(x.detail) + '</div>'; }).join('') + '</div>'; }
        if (d.actions && d.actions.length) { html += '<div style="margin-top:10px;font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Doporučené úpravy</div><ol style="margin:6px 0 0;padding-left:18px;">' + d.actions.map(function(a) { return '<li style="font-size:13px;margin-bottom:4px;">' + kvEsc(a) + '</li>'; }).join('') + '</ol>'; }
        html += '</div>';
        if (out) out.innerHTML = html;
      } catch (e) { if (out) out.innerHTML = '<div style="color:#ef4444;font-size:13px;">AI vyhodnocení selhalo: ' + kvEsc(e.message) + '</div>'; }
      finally { if (btn) btn.disabled = false; }
    }
    window.lokalityAiEval = lokalityAiEval;
    async function lokalityPersona(btn) {
      var out = document.getElementById('lok-ai-out'); if (btn) btn.disabled = true;
      if (out) out.innerHTML = '<div style="color:var(--text2);font-size:13px;">🧑 AI sestavuje obraz ideálního zákazníka…</div>';
      try {
        var r = await fetch('/api/compounder/lokality-persona', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: _lokStats }) });
        var d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        function sec(title, arr) { if (!arr || !arr.length) return ''; return '<div style="margin-top:10px;"><div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">' + title + '</div><ul style="margin:4px 0 0;padding-left:18px;">' + arr.map(function(x) { return '<li style="font-size:13px;margin-bottom:3px;">' + kvEsc(x) + '</li>'; }).join('') + '</ul></div>'; }
        var html = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px;">';
        if (d.persona_name) html += '<div style="font-size:17px;font-weight:800;color:#eab308;">🧑 ' + kvEsc(d.persona_name) + '</div>';
        if (d.summary) html += '<div style="font-size:14px;margin-top:6px;">' + kvEsc(d.summary) + '</div>';
        html += sec('Kdo to je', d.demographics) + sec('Motivace', d.motivations) + sec('Ideální místo, které nabízí', d.ideal_place) + sec('Kde ho hledat (cílení)', d.where_to_reach) + sec('Jak ho oslovit', d.messaging) + sec('Koho spíš nechceme', d.red_flags);
        html += '</div>';
        if (out) out.innerHTML = html;
      } catch (e) { if (out) out.innerHTML = '<div style="color:#ef4444;font-size:13px;">Nepodařilo se vytvořit personu: ' + kvEsc(e.message) + '</div>'; }
      finally { if (btn) btn.disabled = false; }
    }
    window.lokalityPersona = lokalityPersona;
    window.openLokalityDetail = openLokalityDetail;
    window.saveLokalityStatus = saveLokalityStatus;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
