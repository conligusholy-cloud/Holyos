// Laundry Unlimited — Rozdělení financí: tabulka (řádek = co se dělí, sloupec = pozice, buňka = podíl v %)
// Ukládá se automaticky do DB (optimistický zámek rev), záloha v prohlížeči pro případ výpadku.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var D = { cols: [], rows: [] }, rev = 0, dirty = false, saving = false, conflict = false, saveT = null, loaded = false;
  var seq = Date.now(), uid = function (p) { return p + (seq++).toString(36) + Math.random().toString(36).slice(2, 4); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function status(t, bad) { var s = $('#fx-st'); s.textContent = t; s.style.color = bad ? '#fca5a5' : '#86efac'; }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: false })
      .then(function (r) { return r.json().then(function (j) { j.__status = r.status; return j; }); });
  }

  // ── Ukládání ──
  function backup() { try { localStorage.setItem('lu_fx_bk', JSON.stringify({ rev: rev, data: D })); } catch (e) { /* bez paměti */ } }
  function changed() { dirty = true; backup(); status('Ukládám…', false); clearTimeout(saveT); saveT = setTimeout(save, 450); var ae = document.activeElement; if (!(ae && ae.closest && ae.closest('#fx-model'))) renderModel(); }
  function save(keepalive) {
    if (!loaded || conflict) return;
    if (saving) { clearTimeout(saveT); saveT = setTimeout(save, 350); return; }
    saving = true; var snap = JSON.stringify(D);
    fetch('/admin/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: JSON.parse(snap), rev: rev }), keepalive: !!keepalive })
      .then(function (r) { return r.json().then(function (j) { j.__status = r.status; return j; }); })
      .then(function (j) {
        saving = false;
        if (j.__status === 409) { conflict = true; status('Tabulku mezitím změnil někdo jiný — obnov stránku (F5). Tvoje změny zůstaly zálohované v tomto prohlížeči.', true); return; }
        if (!j.ok) { status((j.error || 'Uložení se nepovedlo') + ' — zkusím znovu', true); clearTimeout(saveT); saveT = setTimeout(save, 4000); return; }
        rev = j.rev;
        if (JSON.stringify(D) !== snap) { backup(); clearTimeout(saveT); saveT = setTimeout(save, 150); return; }
        dirty = false; try { localStorage.removeItem('lu_fx_bk'); } catch (e) { /* bez paměti */ } status('Uloženo ✓', false);
      }).catch(function () { saving = false; status('Uložení se nepovedlo (offline?) — zkusím znovu', true); clearTimeout(saveT); saveT = setTimeout(save, 4000); });
  }
  function flush() { if (dirty && !conflict) { clearTimeout(saveT); saving = false; save(true); } }
  window.addEventListener('beforeunload', flush); window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  // ── Výpočty ──
  function num(v) { if (v === '' || v == null) return null; var x = Number(String(v).replace(',', '.').replace(/[^\d.\-]/g, '')); return isFinite(x) ? Math.max(0, Math.min(100, Math.round(x * 100) / 100)) : null; }
  function fmt(x) { return x == null ? '' : String(x).replace('.', ','); }
  var FREQ = [['', '—'], ['once', 'Jednorázově'], ['tx', 'Z každé transakce'], ['day', 'Denně'], ['week', 'Týdně'], ['month', 'Měsíčně'], ['month_unit', 'Měsíčně z prádlomatu'], ['quarter', 'Čtvrtletně'], ['half', 'Půlročně'], ['year', 'Ročně'], ['y5', 'Každých 5 let'], ['y10', 'Každých 10 let']];
  function freqSel(v) { return '<select class="fin">' + FREQ.map(function (f) { return '<option value="' + f[0] + '"' + ((v || '') === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select>'; }
  function parseAmt(v) { if (v === '' || v == null) return null; var x = Number(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')); return isFinite(x) ? Math.min(1e12, Math.round(x * 100) / 100) : null; }
  function fmtAmt(x) { if (typeof x !== 'number') return ''; var p = x.toFixed(2).replace(/\.00$/, '').split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); return p.join(','); }
  function parsePct(v) { if (v === '' || v == null) return null; var x = Number(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')); return isFinite(x) ? Math.min(1000, Math.round(x * 100) / 100) : null; }
  function showPct(r) { if (typeof r.pct === 'number') return r.pct; return (r.price > 0 && typeof r.amt === 'number') ? Math.round(r.amt / r.price * 10000) / 100 : null; }
  // propojení: % z ceny ↔ částka (při změně ceny zůstává %, pokud je zadané)
  function syncRow(tr, r, src) {
    if (src === 'pct' && r.price > 0 && typeof r.pct === 'number') r.amt = Math.round(r.price * r.pct) / 100;
    else if (src === 'amt' && r.price > 0 && typeof r.amt === 'number') r.pct = Math.round(r.amt / r.price * 10000) / 100;
    else if (src === 'price' && r.price > 0) { if (typeof r.pct === 'number') r.amt = Math.round(r.price * r.pct) / 100; else if (typeof r.amt === 'number') r.pct = Math.round(r.amt / r.price * 10000) / 100; }
    if (src === 'pct' && typeof r.pct !== 'number') { /* smazáno */ }
    [['pct', fmt(showPct(r))], ['amt', fmtAmt(r.amt)]].forEach(function (x) { var el = tr.querySelector('.ain[data-f="' + x[0] + '"]'); if (el && el !== document.activeElement) el.value = x[1]; });
    refreshRow(tr, r);
  }
  function rowSum(r) { var s = 0, any = false; D.cols.forEach(function (c) { var x = r.v && r.v[c.id]; if (typeof x === 'number') { s += x; any = true; } }); return any ? Math.round(s * 100) / 100 : null; }
  // Podíly pozic jsou v % z ceny a dohromady nesmí překročit „volné prostředky" (pool) daného řádku
  function poolOf(r) { var p = showPct(r); return p != null && p > 0 ? p : null; }
  function eurOf(r, v) { var P = poolOf(r); if (typeof v !== 'number') return null; if (r.price > 0) return Math.round(r.price * v) / 100; if (typeof r.amt === 'number' && P) return Math.round(r.amt * v / P * 100) / 100; return null; }
  function sumChip(r) {
    var P = poolOf(r), s = rowSum(r);
    if (!P) return '<span class="fxc n" title="Nejdřív zadej cenu a volné prostředky na rozdělení">— zadej pool</span>';
    if (s == null) return '<span class="fxc w">zbývá ' + fmt(P) + ' %</span>';
    var d = Math.round((P - s) * 100) / 100;
    if (Math.abs(d) < 0.005) return '<span class="fxc ok">✓ rozděleno ' + fmt(P) + ' %</span>';
    return d > 0 ? '<span class="fxc w">zbývá ' + fmt(d) + ' %</span>' : '<span class="fxc bad">přebývá ' + fmt(-d) + ' %</span>';
  }
  function refreshRow(tr, r) {
    var P = poolOf(r);
    tr.querySelectorAll('.vin').forEach(function (i) { i.disabled = !P; i.title = P ? '' : 'Nejdřív zadej cenu a volné prostředky na rozdělení'; });
    D.cols.forEach(function (c) { var e = tr.querySelector('.eu[data-c="' + c.id + '"]'); if (e) { var x = eurOf(r, r.v && r.v[c.id]); e.textContent = x == null ? '' : fmtAmt(x) + ' €'; } });
    tr.querySelector('.cs').innerHTML = sumChip(r);
  }

  // ── Vykreslení ──
  var EMPTY = 'Zatím žádné řádky. Přidej první tlačítkem ＋ Přidat řádek — řádek je cokoli, co se mezi pozice dělí (např. cena prádlomatu, provize, servis…).';
  function headHtml() {
    var h = '<thead><tr><th class="c0">#</th><th class="cn">Co se dělí (řádek)</th><th class="cr">Cena<span class="sub"><span class="dph">EUR · bez DPH</span> z čeho se počítá</span></th><th class="cm">Volné prostředky na rozdělení<span class="sub"><span class="dph">EUR · bez DPH</span> % z ceny | částka</span></th><th class="cf">Frekvence</th>';
    D.cols.forEach(function (c) { h += '<th class="cp"><button type="button" class="x" data-dc="' + c.id + '" title="Odebrat pozici">✕</button><input class="hin" data-c="' + c.id + '" value="' + esc(c.name) + '" maxlength="60" title="' + esc(c.name) + ' (klikni a přejmenuj)"></th>'; });
    return h + '<th class="cs">Součet</th><th class="ca"></th></tr></thead>';
  }
  function rowHtml(r, i) {
    var h = '<tr data-r="' + r.id + '"><td class="c0">' + (i + 1) + '</td><td class="cn"><input class="rin" data-f="name" value="' + esc(r.name) + '" maxlength="200" placeholder="např. Prodej prádlomatu"></td><td class="cr"><span class="pc"><input class="ain" data-f="price" value="' + esc(fmtAmt(r.price)) + '" inputmode="decimal" autocomplete="off" placeholder="0" title="Cena bez DPH, ze které se volné prostředky vypočítávají (EUR)"><i>€</i></span></td><td class="cm"><div class="sp"><span class="pc"><input class="ain" data-f="pct" value="' + esc(fmt(showPct(r))) + '" inputmode="decimal" autocomplete="off" placeholder="0" title="Kolik % z ceny jsou volné prostředky na rozdělení"><i>%</i></span><span class="pc"><input class="ain" data-f="amt" value="' + esc(fmtAmt(r.amt)) + '" inputmode="decimal" autocomplete="off" placeholder="0" title="Volné prostředky na rozdělení v EUR, bez DPH (editovatelné)"><i>€</i></span></div></td><td class="cf">' + freqSel(r.freq) + '</td>';
    D.cols.forEach(function (c) { var x = r.v && r.v[c.id]; var ev = eurOf(r, x); h += '<td class="cp"><span class="pc"><input class="vin" data-c="' + c.id + '" value="' + esc(fmt(typeof x === 'number' ? x : null)) + '" inputmode="decimal" autocomplete="off"' + (poolOf(r) ? '' : ' disabled title="Nejdřív zadej cenu a volné prostředky na rozdělení"') + '><i>%</i></span><div class="eu" data-c="' + c.id + '">' + (ev == null ? '' : esc(fmtAmt(ev)) + ' €') + '</div></td>'; });
    return h + '<td class="cs">' + sumChip(r) + '</td><td class="ca"><button type="button" class="ib" data-eq="' + r.id + '" title="Rozdělit rovným dílem">⚖</button><button type="button" class="ib" data-up="' + r.id + '" title="Posunout nahoru">↑</button><button type="button" class="ib" data-dn="' + r.id + '" title="Posunout dolů">↓</button><button type="button" class="ib" data-dr="' + r.id + '" title="Smazat řádek">🗑</button></td></tr>';
  }
  // Standardní filtry a řazení tabulek (sdílená komponenta ColFilters z HolyOS): řádek filtrů pod hlavičkou, šipky ↑↓, počítadlo řádků
  var T = null, colsSig = '';
  var FREQ_LABEL = {}; FREQ.forEach(function (f) { FREQ_LABEL[f[0]] = f[1]; });
  var numOrNull = function (x) { return typeof x === 'number' ? x : null; };
  function cfColumns() {
    var cols = [null,
      { key: 'name', label: 'Co se dělí', type: 'text', ph: 'Řádek…', get: function (r) { return r.name || ''; } },
      { key: 'price', label: 'Cena', type: 'num', ph: '€', get: function (r) { return numOrNull(r.price); } },
      { key: 'amt', label: 'Volné prostředky', type: 'num', ph: '€', get: function (r) { return numOrNull(r.amt); } },
      { key: 'freq', label: 'Frekvence', type: 'text', enum: true, ph: 'Vyber…', get: function (r) { return r.freq ? FREQ_LABEL[r.freq] : 'Neurčeno'; } }];
    D.cols.forEach(function (c) { cols.push({ key: 'v_' + c.id, label: c.name || 'Pozice', type: 'num', ph: '%', get: function (r) { return r.v && typeof r.v[c.id] === 'number' ? r.v[c.id] : null; } }); });
    cols.push({ key: 'sum', label: 'Součet', type: 'num', ph: '%', get: function (r) { return rowSum(r); } }, null);
    return cols;
  }
  function render() {
    var t = $('#fx');
    if (!window.ColFilters) { t.innerHTML = headHtml() + '<tbody>' + (D.rows.length ? D.rows.map(rowHtml).join('') : '<tr><td colspan="' + (D.cols.length + 7) + '" class="empty">' + esc(EMPTY) + '</td></tr>') + '</tbody>'; return; }
    var sig = D.cols.map(function (c) { return c.id; }).join(',');
    if (!T || sig !== colsSig) {
      t.innerHTML = headHtml() + '<tbody></tbody>'; colsSig = sig;
      T = window.ColFilters.table({ table: '#fx', columns: cfColumns(), renderRow: rowHtml, limit: 500, noun: 'řádků', emptyText: EMPTY });
    }
    T.setRows(D.rows);
    renderModel();
  }


  // ── Modelace výdělku pozic (z tržeb): objem × částka pozice z tabulky × frekvence ──
  var FACT = { once: 1, tx: 1, day: 365 / 12, week: 52 / 12, month: 1, month_unit: 1, quarter: 1 / 3, half: 1 / 6, year: 1 / 12, y5: 1 / 60, y10: 1 / 120 };
  var FLAT = { day: 1, week: 1, month: 1, quarter: 1, half: 1, year: 1, y5: 1, y10: 1 };   // pravidelné platby: prázdný objem = 1×
  var UNIT = { once: 'nových případů / měsíc', tx: 'transakcí / měsíc', month_unit: 'prádlomatů v provozu' };
  var ROLE = [[/master/i, 'Získává operátory, kteří naplní MARKET PLACE, prodává místa s prádlomaty a koordinuje umístění prádlomatů a infolinku.'], [/operát|operat/i, 'Hledá místo, nacení ho, dělá přípojky a prodává na MARKET PLACE; stará se o údržbu a servis strojů v provozu.']];
  function MD() { if (!D.model) D.model = { sel: null, vol: {} }; if (!D.model.vol) D.model.vol = {}; return D.model; }
  function selCols() {
    var m = MD(), ids = Array.isArray(m.sel) ? m.sel : D.cols.filter(function (c) { return /master|operát|operat/i.test(c.name); }).map(function (c) { return c.id; });
    return D.cols.filter(function (c) { return ids.indexOf(c.id) >= 0; });
  }
  function eur2(x) { return fmtAmt(Math.round(x * 100) / 100) + ' €'; }
  function volOf(c, r) { var v = MD().vol[c.id] && MD().vol[c.id][r.id]; return typeof v === 'number' ? v : null; }
  function monthlyOf(c, r) {
    var e = eurOf(r, r.v && r.v[c.id]); if (e == null || !r.freq) return 0;
    var v = volOf(c, r); if (v == null) v = FLAT[r.freq] ? 1 : 0;
    return v * e * (FACT[r.freq] || 0);
  }
  function cardRows(c) { return D.rows.filter(function (r) { return r.v && typeof r.v[c.id] === 'number' && r.v[c.id] > 0; }); }
  function kpiHtml(tot) { return '<b>' + esc(eur2(tot)) + '</b> / měsíc <span class="mu2">·</span> <b>' + esc(eur2(tot * 12)) + '</b> / rok'; }
  function cardHtml(c) {
    var rows = cardRows(c), tot = 0, role = ''; ROLE.forEach(function (x) { if (!role && x[0].test(c.name)) role = x[1]; });
    var body = rows.map(function (r) {
      var e = eurOf(r, r.v[c.id]), m = monthlyOf(c, r), v = volOf(c, r), noF = !r.freq; tot += m;
      var unit = noF ? 'doplň frekvenci v tabulce' : (UNIT[r.freq] || 'počet (prázdné = 1×)');
      return '<tr data-r="' + r.id + '"><td>' + esc(r.name || '(bez názvu)') + '</td><td class="m">' + esc(noF ? '—' : FREQ_LABEL[r.freq]) + '</td><td><input class="min" data-c="' + c.id + '" data-r="' + r.id + '" value="' + esc(v == null ? '' : fmt(v)) + '" inputmode="decimal" autocomplete="off" placeholder="' + (FLAT[r.freq] ? '1' : '0') + '"' + (noF ? ' disabled' : '') + '><span class="un">' + esc(unit) + '</span></td><td class="num">' + (e == null ? '—' : esc(eur2(e))) + '</td><td class="num mo">' + esc(eur2(m)) + '</td></tr>';
    }).join('');
    return '<div class="mcard" data-c="' + c.id + '"><div class="mch"><div><div class="mtt">' + esc(c.name || 'Pozice') + '</div>' + (role ? '<div class="mrole">' + esc(role) + '</div>' : '') + '</div><div class="mk">' + kpiHtml(tot) + '</div></div>' +
      (rows.length ? '<table class="mt"><thead><tr><th>Řádek</th><th>Frekvence</th><th>Objem</th><th class="num">€ za jednotku</th><th class="num">€ / měsíc</th></tr></thead><tbody>' + body + '</tbody></table>' : '<div class="mut" style="padding:10px 2px">Tato pozice zatím nemá v tabulce nahoře žádný podíl.</div>') + '</div>';
  }
  function renderModel() {
    var box = $('#fx-model'); if (!box) return;
    var sel = selCols().map(function (c) { return c.id; });
    var h = '<h3 class="mdh">Modelace výdělku pozic <span class="dph">z tržeb · bez nákladů · EUR bez DPH</span></h3>' +
      '<p class="mut" style="margin:4px 0 12px;max-width:900px">Výdělek pozice = objem × částka pozice z tabulky × frekvence. Objem je u jednorázových řádků počet nových případů za měsíc (např. nových operátorů, prodaných strojů), u transakcí počet transakcí za měsíc, u „Měsíčně z prádlomatu“ počet prádlomatů v provozu. U pravidelných plateb je prázdný objem 1×. Řádky bez frekvence se nepočítají.</p>' +
      '<div class="mchips"><span class="mut">Modelovat:</span>' + D.cols.map(function (c) { return '<button type="button" class="mchip' + (sel.indexOf(c.id) >= 0 ? ' on' : '') + '" data-mc="' + c.id + '">' + esc(c.name || 'Pozice') + '</button>'; }).join('') + '</div>' +
      '<div class="mcards">' + selCols().map(cardHtml).join('') + '</div>';
    box.innerHTML = h;
  }
  function paintCard(card) {
    var c = D.cols.filter(function (x) { return x.id === card.getAttribute('data-c'); })[0]; if (!c) return; var tot = 0;
    card.querySelectorAll('tbody tr').forEach(function (tr) { var r = D.rows.filter(function (x) { return x.id === tr.getAttribute('data-r'); })[0]; if (!r) return; var m = monthlyOf(c, r); tot += m; tr.querySelector('.mo').textContent = eur2(m); });
    card.querySelector('.mk').innerHTML = kpiHtml(tot);
  }
  (function () {
    var box = $('#fx-model'); if (!box) return;
    box.addEventListener('input', function (ev) {
      var t = ev.target; if (!t.classList || !t.classList.contains('min')) return;
      var m = MD(), cid = t.getAttribute('data-c'), rid = t.getAttribute('data-r'), v = parseAmt(t.value);
      m.vol[cid] = m.vol[cid] || {}; if (v == null) delete m.vol[cid][rid]; else m.vol[cid][rid] = v;
      paintCard(t.closest('.mcard')); changed();
    });
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.mchip'); if (!b) return;
      var m = MD(), cur = selCols().map(function (c) { return c.id; }), id = b.getAttribute('data-mc');
      m.sel = cur.indexOf(id) >= 0 ? cur.filter(function (x) { return x !== id; }) : cur.concat([id]);
      renderModel(); changed();
    });
  })();

  // ── Události ──
  var tbl = $('#fx');
  tbl.addEventListener('input', function (ev) {
    var t = ev.target, tr = t.closest('tr'); if (!tr) return;
    if (t.classList.contains('hin')) { var c = D.cols.filter(function (x) { return x.id === t.getAttribute('data-c'); })[0]; if (c) { c.name = t.value; changed(); } return; }
    var r = D.rows.filter(function (x) { return x.id === tr.getAttribute('data-r'); })[0]; if (!r) return;
    if (t.classList.contains('vin')) {
      var ck = t.getAttribute('data-c'), v = num(t.value), P = poolOf(r); r.v = r.v || {};
      if (v != null && P) {
        var others = 0; D.cols.forEach(function (c) { if (c.id !== ck && typeof r.v[c.id] === 'number') others += r.v[c.id]; });
        var room = Math.max(0, Math.round((P - others) * 100) / 100);
        if (v > room + 0.0001) { v = room; t.value = fmt(v); t.classList.add('cl'); setTimeout(function () { t.classList.remove('cl'); }, 700); }
      }
      if (v == null) delete r.v[ck]; else r.v[ck] = v;
      refreshRow(tr, r); changed();
    } else if (t.classList.contains('fin')) { if (t.value) r.freq = t.value; else delete r.freq; changed(); }
    else if (t.classList.contains('ain')) { var fk = t.getAttribute('data-f'), a = fk === 'pct' ? parsePct(t.value) : parseAmt(t.value); if (a == null) delete r[fk]; else r[fk] = a; syncRow(tr, r, fk); changed(); }
    else if (t.classList.contains('rin')) { r[t.getAttribute('data-f')] = t.value; changed(); }
  });
  tbl.addEventListener('focusout', function (ev) { var t = ev.target;
    if (t.classList && t.classList.contains('ain')) { var ar = D.rows.filter(function (x) { return x.id === t.closest('tr').getAttribute('data-r'); })[0]; var fk2 = t.getAttribute('data-f'); t.value = ar ? (fk2 === 'pct' ? fmt(showPct(ar)) : fmtAmt(ar[fk2])) : ''; return; }
    if (t.classList && t.classList.contains('vin')) { var tr = t.closest('tr'), r = D.rows.filter(function (x) { return x.id === tr.getAttribute('data-r'); })[0], x = r && r.v && r.v[t.getAttribute('data-c')]; t.value = fmt(typeof x === 'number' ? x : null); } });
  tbl.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button'); if (!b) return;
    var id;
    if ((id = b.getAttribute('data-dc'))) {
      var c = D.cols.filter(function (x) { return x.id === id; })[0];
      if (!c || !confirm('Odebrat pozici „' + (c.name || 'bez názvu') + '“ ze všech řádků?')) return;
      D.cols = D.cols.filter(function (x) { return x.id !== id; }); D.rows.forEach(function (r) { if (r.v) delete r.v[id]; }); render(); changed();
    } else if ((id = b.getAttribute('data-dr'))) {
      var r = D.rows.filter(function (x) { return x.id === id; })[0];
      if (!r || !confirm('Smazat řádek „' + (r.name || 'bez názvu') + '“?')) return;
      D.rows = D.rows.filter(function (x) { return x.id !== id; }); render(); changed();
    } else if ((id = b.getAttribute('data-eq'))) {
      var q = D.rows.filter(function (x) { return x.id === id; })[0]; if (!q || !D.cols.length) return;
      var P0 = poolOf(q); if (!P0) return alert('Nejdřív zadej cenu a volné prostředky na rozdělení.'); var n = D.cols.length, part = Math.floor(P0 * 100 / n) / 100, rest = Math.round((P0 - part * (n - 1)) * 100) / 100; q.v = {};
      D.cols.forEach(function (c, i) { q.v[c.id] = i === n - 1 ? rest : part; }); render(); changed();
    } else if ((id = b.getAttribute('data-up')) || (id = b.getAttribute('data-dn'))) {
      var i = D.rows.map(function (x) { return x.id; }).indexOf(id), j = b.hasAttribute('data-up') ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= D.rows.length) return; var tmp = D.rows[i]; D.rows[i] = D.rows[j]; D.rows[j] = tmp; render(); changed();
    }
  });
  $('#fx-addrow').onclick = function () {
    if (D.rows.length >= 300) return alert('Maximum je 300 řádků.');
    D.rows.push({ id: uid('r'), name: '', v: {} }); render(); changed();
    var ins = tbl.querySelectorAll('tbody tr:last-child .rin'); if (ins[0]) { ins[0].focus(); ins[0].scrollIntoView({ block: 'nearest' }); }
  };
  $('#fx-addcol').onclick = function () {
    if (D.cols.length >= 20) return alert('Maximum je 20 pozic.');
    var name = prompt('Název nové pozice:', ''); if (name == null) return; name = name.trim().slice(0, 60); if (!name) return;
    D.cols.push({ id: uid('c'), name: name }); render(); changed();
  };

  // ── Načtení (s obnovou nedoukládané zálohy) ──
  fetch('/admin/api/finance').then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok) { status(j.error || 'Tabulku se nepodařilo načíst', true); return; }
    D = { cols: (j.data && j.data.cols) || [], rows: (j.data && j.data.rows) || [], model: (j.data && j.data.model) || null }; rev = j.rev; loaded = true;
    var restored = false;
    try { var bk = JSON.parse(localStorage.getItem('lu_fx_bk') || 'null'); if (bk && bk.data && bk.rev === j.rev && JSON.stringify(bk.data) !== JSON.stringify(D)) { D = { cols: bk.data.cols || [], rows: bk.data.rows || [], model: bk.data.model || null }; restored = true; } else if (bk) localStorage.removeItem('lu_fx_bk'); } catch (e) { /* bez zálohy */ }
    render(); renderModel(); if (restored) changed(); else status('', false);
  }).catch(function () { status('Tabulku se nepodařilo načíst', true); });
})();
