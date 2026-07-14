/* =============================================================================
 * Best Series — veřejný web bestseries.global: nabídka místa pro prádlomat.
 * Leaflet mapa se satelitem + obdélník půdorysu stroje ve skutečném měřítku
 * (3182 × 2015 mm), s tažením a otáčením. Adresní našeptávač přes /api/lokality.
 * =========================================================================== */
(function () {
  'use strict';

  // Skutečné rozměry stroje v metrech (3182 × 2015 mm).
  var MACHINE_W = 3.182;
  var MACHINE_H = 2.015;
  var DEFAULT_CENTER = [49.8175, 15.4730]; // střed ČR
  var DEFAULT_ZOOM = 7;

  var state = {
    center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] }, // .lat/.lng kompatibilní s L.latLng
    rotation: 0,          // stupně
    hasLocation: false,   // uživatel už vybral adresu / polohu?
    utils: { electricity: null, water: null, sewage: null, parking: null }, // body přípojek {lat,lng}
  };

  // Přípojky — ikona, barva, popisek a výchozí odsazení od středu (metry V, S).
  var UTIL_META = {
    electricity: { icon: '⚡', color: '#f5b301', label: 'Elektřina', off: [-5, 4] },
    water:       { icon: '💧', color: '#3b82f6', label: 'Voda',       off: [5, 4] },
    sewage:      { icon: '🚿', color: '#14b8a6', label: 'Kanalizace', off: [5, -4] },
    parking:     { icon: '🅿️', color: '#8b5cf6', label: 'Parkoviště', off: [-5, -4] },
  };
  var utilMarkers = {}, utilLines = {};

  var $ = function (id) { return document.getElementById(id); };
  document.getElementById('year').textContent = new Date().getFullYear();

  // ─── Geo matematika: metry → posun v lat/lng ───────────────────────────────
  function metersToLatLng(centerLat, centerLng, dxEast, dyNorth) {
    var dLat = dyNorth / 111320;
    var dLng = dxEast / (111320 * Math.cos(centerLat * Math.PI / 180));
    return L.latLng(centerLat + dLat, centerLng + dLng);
  }
  function latLngToMeters(centerLat, centerLng, ll) {
    var dyNorth = (ll.lat - centerLat) * 111320;
    var dxEast = (ll.lng - centerLng) * 111320 * Math.cos(centerLat * Math.PI / 180);
    return { dx: dxEast, dy: dyNorth };
  }
  // Rotace lokálního bodu (x = východ, y = sever) o úhel state.rotation.
  function rot(x, y) {
    var a = state.rotation * Math.PI / 180;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  }
  function footprintCorners() {
    var hw = MACHINE_W / 2, hh = MACHINE_H / 2;
    var pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    var c = state.center;
    return pts.map(function (p) {
      var r = rot(p[0], p[1]);
      return metersToLatLng(c.lat, c.lng, r.x, r.y);
    });
  }
  // Úchyt rotace: 2 m nad horní hranou obdélníku.
  function handleLatLng() {
    var r = rot(0, MACHINE_H / 2 + 2);
    return metersToLatLng(state.center.lat, state.center.lng, r.x, r.y);
  }

  // ─── Mapa ───────────────────────────────────────────────────────────────────
  // Vše kolem mapy je odolné: když se Leaflet z CDN nenačte, formulář dál funguje
  // (adresu vybere zájemce z našeptávače, souřadnice vezmeme z geokódování).
  var map = null, footprint = null, centerMarker = null, handleMarker = null, rotLine = null;
  var mapReady = false;

  function redraw() {
    if (!mapReady) return;
    footprint.setLatLngs(footprintCorners());
    var h = handleLatLng();
    centerMarker.setLatLng(state.center);
    handleMarker.setLatLng(h);
    rotLine.setLatLngs([state.center, h]);
    $('rot').value = Math.round(state.rotation) % 360;
    $('rot-val').textContent = (Math.round(state.rotation) % 360) + '°';
    // spojnice od středu stroje k označeným přípojkám (start se posouvá se strojem)
    Object.keys(utilLines).forEach(function (k) {
      if (utilLines[k] && state.utils[k]) utilLines[k].setLatLngs([state.center, [state.utils[k].lat, state.utils[k].lng]]);
    });
  }

  function makeUtilIcon(key) {
    var m = UTIL_META[key];
    return L.divIcon({
      className: '', iconSize: [30, 40], iconAnchor: [15, 38],
      html: '<div style="width:30px;height:40px;position:relative;">'
        + '<div style="position:absolute;top:0;left:0;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' + m.color + ';border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.5);"></div>'
        + '<div style="position:absolute;top:3px;left:0;width:30px;height:24px;display:grid;place-items:center;font-size:15px;">' + m.icon + '</div>'
        + '</div>',
    });
  }

  function toggleUtil(key) {
    if (!mapReady) return;
    var btn = document.querySelector('.util-btn[data-util="' + key + '"]');
    if (state.utils[key]) {
      if (utilMarkers[key]) { map.removeLayer(utilMarkers[key]); delete utilMarkers[key]; }
      if (utilLines[key]) { map.removeLayer(utilLines[key]); delete utilLines[key]; }
      state.utils[key] = null;
      if (btn) btn.classList.remove('on');
      return;
    }
    var meta = UTIL_META[key];
    var ll = metersToLatLng(state.center.lat, state.center.lng, meta.off[0], meta.off[1]);
    var mk = L.marker(ll, { icon: makeUtilIcon(key), draggable: true, zIndexOffset: 400 }).addTo(map);
    mk.bindTooltip(meta.label, { direction: 'top', offset: [0, -34] });
    var line = L.polyline([state.center, ll], { color: meta.color, weight: 2, dashArray: '3 5', opacity: 0.85 }).addTo(map);
    utilMarkers[key] = mk; utilLines[key] = line;
    state.utils[key] = { lat: ll.lat, lng: ll.lng };
    mk.on('drag', function (e) {
      var p = e.target.getLatLng();
      state.utils[key] = { lat: p.lat, lng: p.lng };
      if (utilLines[key]) utilLines[key].setLatLngs([state.center, p]);
    });
    if (btn) btn.classList.add('on');
    state.hasLocation = true;
    // označený bod = přípojka k dispozici → zaškrtnout odpovídající checkbox
    var cb = document.querySelector('#offer-form [name="' + key + '"]');
    if (cb && !cb.checked) { cb.checked = true; var ev = document.createEvent('Event'); ev.initEvent('change', true, true); cb.dispatchEvent(ev); }
  }

  function flyToLocation(lat, lon) {
    state.center = (typeof L !== 'undefined' && L.latLng) ? L.latLng(lat, lon) : { lat: lat, lng: lon };
    state.hasLocation = true;
    if (mapReady) { map.setView([lat, lon], 20); redraw(); }
  }

  function initMap() {
    if (typeof L === 'undefined') throw new Error('Leaflet se nenačetl');
    map = L.map('map', { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, maxZoom: 20, zoomControl: true });

    var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
    // Esri World Imagery: satelitní dlaždice existují spolehlivě do z18 (globálně),
    // z19 jen místy. maxNativeZoom:18 → výš se dlaždice dopočítají (žádné „not available").
    var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 18, attribution: 'Tiles © Esri, Maxar, Earthstar Geographics' });
    var labels = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', { maxZoom: 20, maxNativeZoom: 19, pane: 'overlayPane', opacity: 0.9 });
    satellite.addTo(map);
    L.control.layers({ '🛰️ Satelit': satellite, '🗺️ Mapa': streets }, { 'Popisky ulic': labels }, { position: 'topright', collapsed: false }).addTo(map);

    footprint = L.polygon(footprintCorners(), { color: '#16b981', weight: 2, fillColor: '#16b981', fillOpacity: 0.35 }).addTo(map);

    var centerIcon = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div style="width:26px;height:26px;border-radius:50%;background:rgba(22,185,129,0.95);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);cursor:move;display:grid;place-items:center;color:#04241a;font-weight:900;font-size:13px;">✥</div>' });
    var handleIcon = L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10], html: '<div style="width:20px;height:20px;border-radius:50%;background:#a855f7;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);cursor:grab;"></div>' });

    centerMarker = L.marker(state.center, { icon: centerIcon, draggable: true, zIndexOffset: 500 }).addTo(map);
    handleMarker = L.marker(handleLatLng(), { icon: handleIcon, draggable: true, zIndexOffset: 600 }).addTo(map);
    rotLine = L.polyline([state.center, handleLatLng()], { color: '#a855f7', weight: 2, dashArray: '4 4' }).addTo(map);

    centerMarker.on('drag', function (e) { state.center = e.target.getLatLng(); redraw(); });
    centerMarker.on('dragstart', function () { state.hasLocation = true; });

    handleMarker.on('drag', function (e) {
      var m = latLngToMeters(state.center.lat, state.center.lng, e.target.getLatLng());
      var a = Math.atan2(-m.dx, m.dy) * 180 / Math.PI; // viz footprintCorners()
      state.rotation = (a + 360) % 360;
      footprint.setLatLngs(footprintCorners());
      rotLine.setLatLngs([state.center, e.target.getLatLng()]);
      $('rot').value = Math.round(state.rotation) % 360;
      $('rot-val').textContent = (Math.round(state.rotation) % 360) + '°';
    });
    handleMarker.on('dragend', redraw);

    // Klik do mapy = přesun středu (při dostatečném zoomu).
    map.on('click', function (e) { if (map.getZoom() < 16) return; state.center = e.latlng; state.hasLocation = true; redraw(); });

    mapReady = true;
    redraw();
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 200);
  }

  try {
    initMap();
  } catch (e) {
    console.warn('[lokality] mapa se nenačetla:', e && e.message);
    var mapEl = $('map');
    if (mapEl) mapEl.innerHTML = '<div style="padding:24px;color:var(--text2);text-align:center;">Mapu se nepodařilo načíst. Nabídku můžete přesto odeslat — stačí vybrat adresu z našeptávače výše.</div>';
  }

  // Tlačítka přípojek (fungují jen s načtenou mapou).
  Array.prototype.forEach.call(document.querySelectorAll('.util-btn'), function (b) {
    if (!mapReady) { b.disabled = true; b.style.opacity = '0.45'; b.style.cursor = 'not-allowed'; return; }
    b.addEventListener('click', function () { toggleUtil(b.getAttribute('data-util')); });
  });

  // Posuvník otočení.
  $('rot').addEventListener('input', function () {
    state.rotation = parseInt(this.value, 10) || 0; redraw();
  });

  $('btn-locate').addEventListener('click', function () {
    if (!navigator.geolocation) return;
    var btn = this; btn.textContent = '📍 Hledám…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      flyToLocation(pos.coords.latitude, pos.coords.longitude);
      btn.textContent = '📍 Moje poloha';
    }, function () { btn.textContent = '📍 Moje poloha'; }, { enableHighAccuracy: true, timeout: 8000 });
  });

  // ─── Adresní našeptávač ─────────────────────────────────────────────────────
  var addrInput = $('f-address');
  var acList = $('ac-list');
  var acItems = [];
  var acActive = -1;
  var acTimer = null;

  function closeAc() { acList.classList.remove('open'); acList.innerHTML = ''; acItems = []; acActive = -1; }

  function renderAc(results) {
    if (!results.length) { closeAc(); return; }
    acItems = results;
    acList.innerHTML = results.map(function (r, i) {
      return '<div class="ac-item" data-i="' + i + '">' + escapeHtml(r.label) + '</div>';
    }).join('');
    acList.classList.add('open');
    Array.prototype.forEach.call(acList.querySelectorAll('.ac-item'), function (el) {
      el.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        pickAddress(acItems[parseInt(el.getAttribute('data-i'), 10)]);
      });
    });
  }

  function pickAddress(r) {
    if (!r) return;
    addrInput.value = r.label;
    addrInput.dataset.city = r.city || '';
    addrInput.dataset.zip = r.zip || '';
    closeAc();
    flyToLocation(r.lat, r.lon);
  }

  addrInput.addEventListener('input', function () {
    var q = addrInput.value.trim();
    addrInput.dataset.city = ''; addrInput.dataset.zip = '';
    if (acTimer) clearTimeout(acTimer);
    if (q.length < 3) { closeAc(); return; }
    acTimer = setTimeout(function () {
      fetch('/api/lokality/geocode?q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (j) { renderAc((j && j.results) || []); })
        .catch(function () { closeAc(); });
    }, 350);
  });
  addrInput.addEventListener('keydown', function (e) {
    if (!acList.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acActive + 1, acItems.length - 1); highlightAc(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(acActive - 1, 0); highlightAc(); }
    else if (e.key === 'Enter') { if (acActive >= 0) { e.preventDefault(); pickAddress(acItems[acActive]); } }
    else if (e.key === 'Escape') { closeAc(); }
  });
  function highlightAc() {
    Array.prototype.forEach.call(acList.querySelectorAll('.ac-item'), function (el, i) {
      el.classList.toggle('active', i === acActive);
    });
  }
  document.addEventListener('click', function (e) { if (!acList.contains(e.target) && e.target !== addrInput) closeAc(); });

  // ─── Checkbox vizuál ─────────────────────────────────────────────────────────
  Array.prototype.forEach.call(document.querySelectorAll('.check input'), function (cb) {
    var upd = function () { cb.closest('.check').classList.toggle('on', cb.checked); };
    cb.addEventListener('change', upd); upd();
  });

  // ─── Odeslání ────────────────────────────────────────────────────────────────
  var form = $('offer-form');
  var msg = $('form-msg');
  var submitBtn = $('submit-btn');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.textContent = ''; msg.className = 'form-msg';

    var name = $('f-name').value.trim();
    var phone = $('f-phone').value.trim();
    var email = $('f-email').value.trim();
    var address = addrInput.value.trim();

    if (name.length < 2) return showErr('Vyplňte prosím jméno.');
    if (!phone && !email) return showErr('Uveďte prosím telefon nebo e-mail.');
    if (address.length < 3) return showErr('Vyplňte prosím adresu místa.');
    if (!state.hasLocation) return showErr('Ukažte prosím na mapě, kam prádlomat umístit (vyberte adresu nebo posuňte obdélník).');

    var payload = {
      owner_name: name,
      owner_phone: phone,
      owner_email: email,
      address: address,
      city: addrInput.dataset.city || '',
      zip: addrInput.dataset.zip || '',
      latitude: state.center.lat,
      longitude: state.center.lng,
      footprint_rotation: Math.round(state.rotation * 100) / 100,
      electricity: $('offer-form').elements['electricity'].checked,
      water: $('offer-form').elements['water'].checked,
      sewage: $('offer-form').elements['sewage'].checked,
      parking: $('offer-form').elements['parking'].checked,
      utility_points: {
        electricity: state.utils.electricity,
        water: state.utils.water,
        sewage: state.utils.sewage,
        parking: state.utils.parking,
      },
      note: $('f-note').value.trim(),
    };

    submitBtn.disabled = true; submitBtn.textContent = 'Odesílám…';
    fetch('/api/lokality/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) {
          form.style.display = 'none';
          $('success').classList.add('show');
          $('success').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          showErr((res.j && res.j.error) || 'Nabídku se nepodařilo odeslat. Zkuste to prosím znovu.');
          submitBtn.disabled = false; submitBtn.textContent = 'Odeslat nabídku';
        }
      })
      .catch(function () {
        showErr('Chyba spojení. Zkontrolujte připojení a zkuste to znovu.');
        submitBtn.disabled = false; submitBtn.textContent = 'Odeslat nabídku';
      });
  });

  function showErr(t) { msg.textContent = t; msg.className = 'form-msg err'; }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
