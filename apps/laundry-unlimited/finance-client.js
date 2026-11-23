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
  function changed() { dirty = true; backup(); status('Ukládám…', false); clearTimeout(saveT); saveT = setTimeout(save, 450); }
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
  var FREQ = [['', '—'], ['once', 'Jednorázově'], ['tx', 'Z každé transakce'], ['day', 'Denně'], ['week', 'Týdně'], ['month', 'Měsíčně'], ['quarter', 'Čtvrtletně'], ['year', 'Ročně']];
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
  }
  function rowSum(r) { var s = 0, any = false; D.cols.forEach(function (c) { var x = r.v && r.v[c.id]; if (typeof x === 'number') { s += x; any = true; } }); return any ? Math.round(s * 100) / 100 : null; }
  function sumChip(r) {
    var s = rowSum(r); if (s == null) return '<span class="fxc n">—</span>';
    if (Math.abs(s - 100) < 0.005) return '<span class="fxc ok">✓ 100 %</span>';
    var d = Math.round((100 - s) * 100) / 100;
    return s < 100 ? '<span class="fxc w">chybí ' + fmt(d) + ' %</span>' : '<span class="fxc bad">přebývá ' + fmt(-d) + ' %</span>';
  }

  // ── Vykreslení ──
  function render() {
    var t = $('#fx'), h = '<thead><tr><th class="c0">#</th><th class="cn">Co se dělí (řádek)</th><th class="cr">Cena <span class="sub">z čeho se počítá</span></th><th class="cm">Volné prostředky na rozdělení <span class="dph">EUR · bez DPH</span><span class="sub">% z ceny&nbsp;&nbsp;|&nbsp;&nbsp;částka</span></th><th class="cf">Frekvence</th>';
    D.cols.forEach(function (c) { h += '<th class="cp"><div class="ch"><input class="hin" data-c="' + c.id + '" value="' + esc(c.name) + '" maxlength="60" title="Název pozice"><button type="button" class="x" data-dc="' + c.id + '" title="Odebrat pozici">✕</button></div></th>'; });
    h += '<th class="cs">Součet</th><th class="ca"></th></tr></thead><tbody>';
    D.rows.forEach(function (r, i) {
      h += '<tr data-r="' + r.id + '"><td class="c0">' + (i + 1) + '</td><td class="cn"><input class="rin" data-f="name" value="' + esc(r.name) + '" maxlength="200" placeholder="např. Prodej prádlomatu"></td><td class="cr"><span class="pc"><input class="ain" data-f="price" value="' + esc(fmtAmt(r.price)) + '" inputmode="decimal" autocomplete="off" placeholder="0" title="Cena, ze které se volné prostředky vypočítávají (EUR)"><i>€</i></span></td><td class="cm"><div class="sp"><span class="pc"><input class="ain" data-f="pct" value="' + esc(fmt(showPct(r))) + '" inputmode="decimal" autocomplete="off" placeholder="0" title="Kolik % z ceny jsou volné prostředky na rozdělení"><i>%</i></span><span class="pc"><input class="ain" data-f="amt" value="' + esc(fmtAmt(r.amt)) + '" inputmode="decimal" autocomplete="off" placeholder="0" title="Volné prostředky na rozdělení v EUR, bez DPH (editovatelné)"><i>€</i></span></div></td><td class="cf">' + freqSel(r.freq) + '</td>';
      D.cols.forEach(function (c) { var x = r.v && r.v[c.id]; h += '<td class="cp"><span class="pc"><input class="vin" data-c="' + c.id + '" value="' + esc(fmt(typeof x === 'number' ? x : null)) + '" inputmode="decimal" autocomplete="off"><i>%</i></span></td>'; });
      h += '<td class="cs">' + sumChip(r) + '</td><td class="ca"><button type="button" class="ib" data-eq="' + r.id + '" title="Rozdělit rovným dílem">⚖</button><button type="button" class="ib" data-up="' + r.id + '" title="Posunout nahoru">↑</button><button type="button" class="ib" data-dn="' + r.id + '" title="Posunout dolů">↓</button><button type="button" class="ib" data-dr="' + r.id + '" title="Smazat řádek">🗑</button></td></tr>';
    });
    if (!D.rows.length) h += '<tr><td colspan="' + (D.cols.length + 7) + '" class="empty">Zatím žádné řádky. Přidej první tlačítkem <b>＋ Přidat řádek</b> — řádek je cokoli, co se mezi pozice dělí (např. cena prádlomatu, provize, servis…).</td></tr>';
    h += '</tbody>';
    t.innerHTML = h;
  }
  function updateRowSum(tr) { var r = D.rows.filter(function (x) { return x.id === tr.getAttribute('data-r'); })[0]; if (r) tr.querySelector('.cs').innerHTML = sumChip(r); }

  // ── Události ──
  var tbl = $('#fx');
  tbl.addEventListener('input', function (ev) {
    var t = ev.target, tr = t.closest('tr'); if (!tr) return;
    if (t.classList.contains('hin')) { var c = D.cols.filter(function (x) { return x.id === t.getAttribute('data-c'); })[0]; if (c) { c.name = t.value; changed(); } return; }
    var r = D.rows.filter(function (x) { return x.id === tr.getAttribute('data-r'); })[0]; if (!r) return;
    if (t.classList.contains('vin')) {
      var v = num(t.value); r.v = r.v || {}; if (v == null) delete r.v[t.getAttribute('data-c')]; else r.v[t.getAttribute('data-c')] = v;
      updateRowSum(tr); changed();
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
      var n = D.cols.length, part = Math.floor(10000 / n) / 100, rest = Math.round((100 - part * (n - 1)) * 100) / 100; q.v = {};
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
    D = { cols: (j.data && j.data.cols) || [], rows: (j.data && j.data.rows) || [] }; rev = j.rev; loaded = true;
    var restored = false;
    try { var bk = JSON.parse(localStorage.getItem('lu_fx_bk') || 'null'); if (bk && bk.data && bk.rev === j.rev && JSON.stringify(bk.data) !== JSON.stringify(D)) { D = { cols: bk.data.cols || [], rows: bk.data.rows || [] }; restored = true; } else if (bk) localStorage.removeItem('lu_fx_bk'); } catch (e) { /* bez zálohy */ }
    render(); if (restored) changed(); else status('', false);
  }).catch(function () { status('Tabulku se nepodařilo načíst', true); });
})();
