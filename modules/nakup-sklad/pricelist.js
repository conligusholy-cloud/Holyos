// HolyOS — Nákupní ceník (UI): záložka „Nákupní ceník“ + podzáložka „Dodavatelé a ceny“ v kartě zboží
(function () {
  var st = document.createElement('style');
  st.textContent =
    '.pl-in{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 9px;color:var(--text);font-size:13px;font-family:inherit;min-width:0;width:100%;box-sizing:border-box}' +
    '.pl-box{border:1px solid var(--border);background:var(--surface2);border-radius:10px;padding:14px;margin-top:12px}' +
    '.pl-tier{display:grid;grid-template-columns:90px 110px 80px 90px 90px 30px;gap:6px;align-items:center;margin-bottom:6px}' +
    '.pl-mh td{background:var(--surface2);font-weight:600;cursor:pointer}' +
    '.pl-b{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9px;font-size:10.5px;font-weight:600}';
  document.head.appendChild(st);

  function T(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function A(s) { return T(s).replace(/"/g, '&quot;'); }
  function nf(n, d) { return n == null ? '—' : Number(n).toLocaleString('cs-CZ', { maximumFractionDigits: d == null ? 2 : d }); }
  function d10(v) { return v ? String(v).slice(0, 10) : ''; }
  function dcz(v) { var p = d10(v).split('-'); return p.length === 3 ? parseInt(p[2], 10) + '. ' + parseInt(p[1], 10) + '. ' + p[0] : ''; }
  function jerr(r) { return r.json().then(function (j) { return j.error || ('Chyba ' + r.status); }, function () { return 'Chyba ' + r.status; }); }
  function sups() { return (typeof companies !== 'undefined' ? companies : []).filter(function (c) { return c.type === 'supplier' || c.type === 'both'; }); }
  async function ensureCompanies() {
    if (typeof companies !== 'undefined' && companies.length === 0) {
      try { var r = await fetch('/api/wh/companies?type=supplier'); companies = await r.json(); } catch (e) {}
    }
  }
  function badges(o) {
    var h = '';
    if (o.is_primary) h += '<span class="pl-b" style="background:rgba(245,158,11,.2);color:#f59e0b">★ primární</span>';
    if (o.cheapest) h += '<span class="pl-b" style="background:rgba(16,185,129,.18);color:#10b981">nejlevnější</span>';
    if (o.fastest) h += '<span class="pl-b" style="background:rgba(59,130,246,.18);color:#60a5fa">nejrychlejší</span>';
    if (o.expired) h += '<span class="pl-b" style="background:rgba(239,68,68,.18);color:#ef4444">vypršelo</span>';
    else if (o.future) h += '<span class="pl-b" style="background:rgba(148,163,184,.2);color:#94a3b8">zatím neplatí</span>';
    else if (!o.is_valid) h += '<span class="pl-b" style="background:rgba(148,163,184,.2);color:#94a3b8">neplatné</span>';
    return h;
  }
  function priceCell(o) {
    var tt = o.tiers.length > 1 ? o.tiers.map(function (t) { return 'od ' + nf(t.quantity_min || 0) + ': ' + nf(t.price, 4) + ' ' + t.currency; }).join('\n') : '';
    return '<td title="' + A(tt) + '"><b>' + nf(o.price, 4) + '</b> ' + T(o.currency || '') +
      (o.tiers.length > 1 ? ' <span class="pl-b" style="background:rgba(148,163,184,.2);color:#94a3b8">' + o.tiers.length + ' cen dle množství</span>' : '') + '</td>';
  }
  function validCell(o) { return o.valid_from || o.valid_to ? (o.valid_from ? 'od ' + dcz(o.valid_from) : '') + (o.valid_to ? ' do ' + dcz(o.valid_to) : '') : 'bez omezení'; }

  // ============================================================
  // Karta zboží → podzáložka „Dodavatelé a ceny“
  // ============================================================
  var cur = { matId: null, offers: [] };

  function applySync(s) {
    var root = document.getElementById('modal-root');
    if (!s || !root) return;
    ['supplier_id', 'unit_price', 'lead_time_days'].forEach(function (k) {
      var el = root.querySelector('[name="' + k + '"]');
      if (el && s[k] !== undefined && s[k] !== null) el.value = s[k];
    });
  }

  function renderPanel() {
    var box = document.getElementById('mat-pricing-panel');
    if (!box) return;
    var rows = cur.offers.map(function (o) {
      return '<tr style="cursor:default"><td style="width:28px">' + (o.is_primary ? '★' : '') + '</td>' +
        '<td><b>' + T(o.supplier_name) + '</b>' + badges(o) + (o.note ? '<div style="font-size:11px;color:var(--text2)">' + T(o.note) + '</div>' : '') + '</td>' +
        priceCell(o) +
        '<td>' + (o.delivery_days == null ? '—' : o.delivery_days + ' dní') + '</td>' +
        '<td>' + (o.moq == null ? '—' : nf(o.moq)) + '</td>' +
        '<td style="font-size:12px">' + validCell(o) + '</td>' +
        '<td style="font-size:12px">' + T(o.supplier_part_no || '') + '</td>' +
        '<td style="white-space:nowrap;text-align:right">' +
          (o.is_primary ? '' : '<button type="button" class="btn btn-secondary btn-sm" title="Nastavit jako primárního dodavatele" onclick="plPrimary(' + o.id + ')">★</button> ') +
          '<button type="button" class="btn btn-secondary btn-sm" onclick="plEdit(' + o.id + ')">Upravit</button> ' +
          '<button type="button" class="btn btn-secondary btn-sm" onclick="plDel(' + o.id + ')">🗑</button></td></tr>';
    }).join('');
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b>Dodavatelé, ceny a dodací lhůty</b><div style="flex:1"></div>' +
      '<button type="button" class="btn btn-primary btn-sm" onclick="plEdit(null)">＋ Přidat dodavatele</button></div>' +
      (cur.offers.length
        ? '<div style="overflow-x:auto"><table class="data-table"><thead><tr><th></th><th>Dodavatel</th><th>Cena / ks</th><th>Dodání</th><th>Min. odběr</th><th>Platnost</th><th>Č. dílu</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<div style="font-size:11.5px;color:var(--text2);margin-top:6px">★ primární dodavatel se zapisuje do karty zboží (dodavatel, nákupní cena, doba dodání) a používá ho nákupní asistent a plánování.</div>'
        : '<div style="padding:20px;text-align:center;color:var(--text2)">Zboží zatím nemá žádného dodavatele s cenou. Přidej prvního tlačítkem výše.</div>') +
      '<div id="pl-editor"></div>';
  }

  window.loadMatPricing = async function (matId) {
    cur.matId = matId;
    var box = document.getElementById('mat-pricing-panel');
    if (!box) return;
    await ensureCompanies();
    box.innerHTML = '<div style="color:var(--text2)">Načítám…</div>';
    try {
      var r = await fetch('/api/wh/pricelist/material/' + matId, { cache: 'no-store' });
      if (!r.ok) throw new Error(await jerr(r));
      cur.offers = await r.json();
    } catch (e) { box.innerHTML = '<div style="color:#ef4444">Nepodařilo se načíst: ' + T(e.message) + '</div>'; return; }
    renderPanel();
  };

  function tierRow(t) {
    t = t || {};
    var cur2 = t.currency || 'CZK';
    var opts = ['CZK', 'EUR', 'USD', 'PLN', 'GBP'].map(function (c) { return '<option' + (c === cur2 ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    return '<div class="pl-tier">' +
      '<input class="pl-in pl-q" type="number" step="any" min="0" placeholder="od ks" value="' + A(t.quantity_min == null ? '' : t.quantity_min) + '">' +
      '<input class="pl-in pl-p" type="number" step="any" min="0" placeholder="cena / ks" value="' + A(t.price == null ? '' : t.price) + '">' +
      '<select class="pl-in pl-c">' + opts + '</select>' +
      '<input class="pl-in pl-d" type="number" step="1" min="0" placeholder="dny" value="' + A(t.delivery_time_days == null ? '' : t.delivery_time_days) + '">' +
      '<input class="pl-in pl-m" type="number" step="any" min="0" placeholder="MOQ" value="' + A(t.min_order_quantity == null ? '' : t.min_order_quantity) + '">' +
      '<button type="button" class="btn btn-secondary btn-sm" title="Odebrat řádek" onclick="this.parentNode.remove()">✕</button></div>';
  }
  window.plAddTier = function () { var w = document.getElementById('pl-tiers'); if (w) w.insertAdjacentHTML('beforeend', tierRow()); };
  window.plCancel = function () { var e = document.getElementById('pl-editor'); if (e) e.innerHTML = ''; };

  window.plEdit = function (id) {
    var o = id ? cur.offers.filter(function (x) { return x.id === id; })[0] : null;
    var list = sups();
    if (o && !list.some(function (c) { return c.id === o.supplier_id; })) list = list.concat([{ id: o.supplier_id, name: o.supplier_name }]);
    var opts = '<option value="">— vyber dodavatele —</option>' + list.map(function (c) { return '<option value="' + c.id + '"' + (o && o.supplier_id === c.id ? ' selected' : '') + '>' + T(c.name) + '</option>'; }).join('');
    var tiers = o && o.tiers.length ? o.tiers : [{}];
    var ed = document.getElementById('pl-editor');
    if (!ed) return;
    ed.innerHTML = '<div class="pl-box" onkeydown="if(event.key===\'Enter\'&&event.target.tagName!==\'TEXTAREA\'){event.preventDefault();}">' +
      '<div style="font-weight:600;margin-bottom:10px">' + (o ? 'Upravit nabídku dodavatele' : 'Nový dodavatel') + '</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label style="font-size:12px;color:var(--text2)">Dodavatel *</label><select class="pl-in" id="pl-sup">' + opts + '</select></div>' +
        '<div><label style="font-size:12px;color:var(--text2)">Platné od</label><input class="pl-in" id="pl-vf" type="date" value="' + A(o ? d10(o.valid_from) : '') + '"></div>' +
        '<div><label style="font-size:12px;color:var(--text2)">Platné do</label><input class="pl-in" id="pl-vt" type="date" value="' + A(o ? d10(o.valid_to) : '') + '"></div>' +
        '<div><label style="font-size:12px;color:var(--text2)">Č. dílu dodavatele</label><input class="pl-in" id="pl-pn" type="text" value="' + A(o ? o.supplier_part_no : '') + '"></div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">Ceny — první řádek je základní cena; další řádky jsou množstevní slevy (od kolika kusů platí cena)</div>' +
      '<div class="pl-tier" style="font-size:11px;color:var(--text2)"><span>Od množství</span><span>Cena / ks</span><span>Měna</span><span>Dodání (dny)</span><span>Min. odběr</span><span></span></div>' +
      '<div id="pl-tiers">' + tiers.map(tierRow).join('') + '</div>' +
      '<button type="button" class="btn btn-secondary btn-sm" onclick="plAddTier()">＋ množstevní cena</button>' +
      '<div style="margin-top:10px"><label style="font-size:12px;color:var(--text2)">Poznámka</label><input class="pl-in" id="pl-note" type="text" value="' + A(o ? o.note : '') + '"></div>' +
      '<div style="display:flex;gap:18px;margin-top:10px;font-size:13px">' +
        '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pl-pri"' + (o ? (o.is_primary ? ' checked' : '') : (cur.offers.length === 0 ? ' checked' : '')) + '> Primární dodavatel</label>' +
        '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pl-val"' + (!o || o.is_valid ? ' checked' : '') + '> Nabídka platí</label></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="plCancel()">Zrušit</button>' +
        '<button type="button" class="btn btn-primary btn-sm" onclick="plSave(' + (o ? o.id : 'null') + ')">Uložit</button></div></div>';
    if (ed.scrollIntoView) ed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  window.plSave = async function (id) {
    var tiers = [].map.call(document.querySelectorAll('#pl-editor .pl-tier[class*="pl-tier"]'), function (el) {
      var p = el.querySelector('.pl-p'); if (!p) return null;
      return { quantity_min: el.querySelector('.pl-q').value, price: p.value, currency: el.querySelector('.pl-c').value, delivery_time_days: el.querySelector('.pl-d').value, min_order_quantity: el.querySelector('.pl-m').value };
    }).filter(function (t) { return t && String(t.price).trim() !== ''; });
    var body = {
      supplier_id: document.getElementById('pl-sup').value, valid_from: document.getElementById('pl-vf').value, valid_to: document.getElementById('pl-vt').value,
      supplier_part_no: document.getElementById('pl-pn').value, note: document.getElementById('pl-note').value,
      is_primary: document.getElementById('pl-pri').checked, is_valid: document.getElementById('pl-val').checked, tiers: tiers,
    };
    if (!body.supplier_id) { alert('Vyber dodavatele.'); return; }
    if (!tiers.length) { alert('Zadej alespoň jednu cenu.'); return; }
    try {
      var r = await fetch(id ? '/api/wh/pricelist/' + id : '/api/wh/pricelist/material/' + cur.matId, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { alert('Uložení selhalo: ' + await jerr(r)); return; }
      var j = await r.json(); applySync(j.material_sync);
      await window.loadMatPricing(cur.matId);
    } catch (e) { alert('Uložení selhalo: ' + e.message); }
  };

  window.plPrimary = async function (id) {
    try {
      var r = await fetch('/api/wh/pricelist/' + id + '/primary', { method: 'POST' });
      if (!r.ok) { alert('Chyba: ' + await jerr(r)); return; }
      var j = await r.json(); applySync(j.material_sync); await window.loadMatPricing(cur.matId);
    } catch (e) { alert('Chyba: ' + e.message); }
  };

  window.plDel = async function (id) {
    if (!confirm('Smazat tuto nabídku dodavatele včetně všech cen?')) return;
    try {
      var r = await fetch('/api/wh/pricelist/' + id, { method: 'DELETE' });
      if (!r.ok) { alert('Chyba: ' + await jerr(r)); return; }
      var j = await r.json(); applySync(j.material_sync); await window.loadMatPricing(cur.matId);
    } catch (e) { alert('Chyba: ' + e.message); }
  };

  // ============================================================
  // Záložka „Nákupní ceník“ — přehled zboží × dodavatelé
  // ============================================================
  var pl = { groups: [], total: 0, timer: null };

  function fillSupplierFilter() {
    var sel = document.getElementById('pl-supplier');
    if (!sel || sel.dataset.filled === '1' || !sups().length) return;
    sel.innerHTML = '<option value="">Všichni dodavatelé</option>' + sups().map(function (c) { return '<option value="' + c.id + '">' + T(c.name) + '</option>'; }).join('');
    sel.dataset.filled = '1';
  }

  function renderList() {
    var box = document.getElementById('pl-table');
    if (!box) return;
    if (!pl.groups.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><h3>Žádné nabídky dodavatelů</h3><div>Zboží bez ceníku se tu neukazuje. Přidej nabídku tlačítkem „＋ Přidat nabídku“ nebo v kartě zboží na záložce „Dodavatelé a ceny“.</div></div>';
      return;
    }
    var h = '<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Dodavatel</th><th>Cena / ks</th><th>Dodání</th><th>Min. odběr</th><th>Platnost</th><th>Č. dílu dodavatele</th></tr></thead><tbody>';
    pl.groups.forEach(function (g) {
      h += '<tr class="pl-mh" onclick="plOpen(' + g.material.id + ')" title="Otevřít kartu zboží"><td colspan="6"><b>' + T(g.material.code) + '</b> — ' + T(g.material.name) + ' <span style="color:var(--text2);font-weight:400">(' + T(g.material.unit || 'ks') + ')</span></td></tr>';
      g.offers.forEach(function (o) {
        h += '<tr onclick="plOpen(' + g.material.id + ')"><td style="padding-left:28px"><b>' + T(o.supplier_name) + '</b>' + badges(o) + '</td>' + priceCell(o) +
          '<td>' + (o.delivery_days == null ? '—' : o.delivery_days + ' dní') + '</td><td>' + (o.moq == null ? '—' : nf(o.moq)) + '</td><td style="font-size:12px">' + validCell(o) + '</td><td style="font-size:12px">' + T(o.supplier_part_no || '') + '</td></tr>';
      });
    });
    h += '</tbody></table></div><div style="margin:12px 0;color:var(--text2);font-size:12.5px">Zobrazeno ' + pl.groups.length + ' z ' + pl.total + ' položek zboží' +
      (pl.groups.length < pl.total ? ' <button class="btn btn-secondary btn-sm" style="margin-left:10px" onclick="loadPriceList(true)">Načíst další</button>' : '') + '</div>';
    box.innerHTML = h;
  }

  window.loadPriceList = async function (append) {
    var box = document.getElementById('pl-table');
    if (!box) return;
    await ensureCompanies(); fillSupplierFilter();
    if (!append) { pl.groups = []; box.innerHTML = '<div class="empty-state">Načítám…</div>'; }
    var q = document.getElementById('pl-search').value.trim();
    var sid = document.getElementById('pl-supplier').value;
    var url = '/api/wh/pricelist?limit=150&offset=' + pl.groups.length + (q ? '&q=' + encodeURIComponent(q) : '') + (sid ? '&supplier_id=' + sid : '') + (document.getElementById('pl-active').checked ? '' : '&only_active=0');
    try {
      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(await jerr(r));
      var j = await r.json(); pl.total = j.total; pl.groups = pl.groups.concat(j.items);
    } catch (e) { box.innerHTML = '<div class="empty-state" style="color:#ef4444">Načtení selhalo: ' + T(e.message) + '</div>'; return; }
    renderList();
  };
  window.plSearchSoon = function () { clearTimeout(pl.timer); pl.timer = setTimeout(function () { window.loadPriceList(false); }, 300); };

  window.plOpen = async function (matId, add) {
    await openMaterialModal(matId);
    switchMatTab('pricing');
    await window.loadMatPricing(matId);
    if (add) window.plEdit(null);
  };

  // Přidání nabídky z přehledu: nejdřív vyhledat zboží
  window.plPick = function () {
    document.getElementById('modal-root').innerHTML = '<div class="modal-overlay"><div class="modal"><h2>＋ Přidat nabídku dodavatele</h2>' +
      '<div style="color:var(--text2);font-size:13px;margin-bottom:10px">Najdi zboží, ke kterému chceš přidat dodavatele a cenu.</div>' +
      '<input class="pl-in" id="pl-pick-q" type="text" placeholder="Kód nebo název zboží…" oninput="plPickSearch()" autocomplete="off">' +
      '<div id="pl-pick-res" style="margin-top:10px;max-height:320px;overflow-y:auto"></div>' +
      '<div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Zavřít</button></div></div></div>';
    setTimeout(function () { var i = document.getElementById('pl-pick-q'); if (i) i.focus(); }, 50);
  };
  window.plPickSearch = function () {
    clearTimeout(pl.timer);
    pl.timer = setTimeout(async function () {
      var q = (document.getElementById('pl-pick-q') || {}).value || '', res = document.getElementById('pl-pick-res');
      if (!res || q.trim().length < 2) { if (res) res.innerHTML = ''; return; }
      try {
        var r = await fetch('/api/wh/materials?search=' + encodeURIComponent(q.trim()));
        var l = await r.json(); var arr = (Array.isArray(l) ? l : (l.items || [])).slice(0, 15);
        res.innerHTML = arr.length ? arr.map(function (m) { return '<div class="pn-row" style="padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer" onclick="plOpen(' + m.id + ',true)"><b>' + T(m.code) + '</b> — ' + T(m.name) + '</div>'; }).join('') : '<div style="color:var(--text2)">Nic nenalezeno</div>';
      } catch (e) { res.innerHTML = '<div style="color:#ef4444">Hledání selhalo</div>'; }
    }, 250);
  };
})();
