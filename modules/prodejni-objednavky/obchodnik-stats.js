// =============================================================================
// HolyOS — Schůzky obchodníků: denní vyhodnocení (self-injecting záložka)
// =============================================================================
// Tabulka den × obchodník (kolik schůzek domluvil), úspěšnost schůzek, cíl za den.
// Každý pracovní den po nastavené hodině odchází report do Velína (Jan + Tomáš).
// API: GET /api/compounder/owner-meetings/daily, PUT .../settings, POST .../report-now
(function () {
  'use strict';

  var TAB = 'obchodnik-stats';
  var state = { data: null, days: 14 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'include';
    if (opts.body && typeof opts.body !== 'string') { opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}); opts.body = JSON.stringify(opts.body); }
    return fetch('/api/compounder' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }
  function dayLabel(k) { var p = k.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); return ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'][d.getDay()] + ' ' + (+p[2]) + '.' + (+p[1]) + '.'; }
  function isWeekend(k) { var p = k.split('-'); var g = new Date(+p[0], +p[1] - 1, +p[2]).getDay(); return g === 0 || g === 6; }

  function injectTab() {
    if (document.getElementById('tab-' + TAB)) return;
    var bar = document.querySelector('.tab-bar');
    if (bar) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'tab-btn'; btn.setAttribute('data-tab', TAB);
      btn.textContent = '📊 Schůzky obchodníků';
      btn.onclick = function () { window.switchTab(TAB); };
      bar.appendChild(btn);
    }
    var host = document.getElementById('tab-orders');
    var parent = host ? host.parentNode : document.querySelector('.main-wrapper') || document.body;
    var div = document.createElement('div');
    div.id = 'tab-' + TAB; div.style.display = 'none'; div.style.padding = '20px 24px 24px';
    div.innerHTML = ''
      + '<h3 style="margin:0 0 4px;font-size:16px;">📊 Schůzky domluvené obchodníky — denní vyhodnocení</h3>'
      + '<div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.5;">Počítají se schůzky domluvené tlačítkem <b>Online schůzka s majitelem</b> v aplikaci obchodníka (den = den domluvení). '
      + '<b>Úspěšnost</b> = proběhlé ÷ (proběhlé + nedorazil + zrušené + prošlé bez označení). Nadcházející schůzky se do úspěšnosti nepočítají. Stav schůzky (proběhla / nedorazil) se označuje v administraci schůzek.</div>'
      + '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface,#141418);">'
      + '  <label style="font-size:13px;">Cíl schůzek / den / obchodník: <input type="number" id="obst-target" min="0" max="100" style="width:64px;margin-left:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--text);"></label>'
      + '  <label style="font-size:13px;">Denní report do Velína po: <input type="number" id="obst-hour" min="0" max="23" style="width:56px;margin-left:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--text);"> h (po–pá)</label>'
      + '  <button type="button" id="obst-save" style="border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;color:#fff;background:#3b82f6;">💾 Uložit</button>'
      + '  <button type="button" id="obst-now" style="border:1px solid var(--border);background:transparent;color:var(--text2);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;">📨 Poslat report teď</button>'
      + '  <select id="obst-days" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text);font-size:13px;"><option value="7">7 dní</option><option value="14" selected>14 dní</option><option value="30">30 dní</option><option value="60">60 dní</option></select>'
      + '  <span id="obst-msg" style="font-size:13px;color:var(--text2);"></span>'
      + '</div>'
      + '<div id="obst-kpis" style="margin-bottom:12px;"></div>'
      + '<div id="obst-body" style="overflow-x:auto;color:var(--text2);">Načítám…</div>';
    parent.appendChild(div);

    var orig = window.switchTab;
    window.switchTab = function (name) {
      if (typeof orig === 'function') { try { orig(name); } catch (e) {} }
      var mine = document.getElementById('tab-' + TAB);
      var myBtn = document.querySelector('.tab-btn[data-tab="' + TAB + '"]');
      if (mine) mine.style.display = (name === TAB) ? '' : 'none';
      if (myBtn) myBtn.classList.toggle('active', name === TAB);
      if (name === TAB) load();
    };
    document.getElementById('obst-save').onclick = save;
    document.getElementById('obst-now').onclick = sendNow;
    document.getElementById('obst-days').onchange = function (e) { state.days = parseInt(e.target.value, 10) || 14; load(); };
  }

  function msg(t, cls) { var m = document.getElementById('obst-msg'); if (!m) return; m.textContent = t; m.style.color = cls === 'err' ? '#ef4444' : cls === 'ok' ? '#10b981' : 'var(--text2)'; }

  async function load() {
    var box = document.getElementById('obst-body'); if (!box) return;
    box.textContent = 'Načítám…';
    try {
      var j = await api('/owner-meetings/daily?days=' + state.days);
      state.data = j;
      document.getElementById('obst-target').value = j.target || 0;
      document.getElementById('obst-hour').value = j.report_hour != null ? j.report_hour : 18;
      render();
    } catch (e) { box.innerHTML = '<span style="color:#ef4444">Chyba: ' + esc(e.message) + '</span>'; }
  }

  function kpi(label, val, color) { return '<span style="display:inline-block;margin-right:22px;font-size:12px;color:var(--text2);">' + esc(label) + '<br><b style="font-size:20px;color:' + (color || 'var(--text)') + ';">' + val + '</b></span>'; }

  function render() {
    var d = state.data, box = document.getElementById('obst-body'); if (!d || !box) return;
    var t = d.totals || {}, target = d.target || 0;
    var today = d.days[d.days.length - 1];
    var todayTotal = d.people.reduce(function (a, p) { return a + ((p.per_day[today] || {}).booked || 0); }, 0);
    document.getElementById('obst-kpis').innerHTML =
      kpi('Dnes domluveno', todayTotal, todayTotal ? '#10b981' : '#f59e0b')
      + kpi('Za období', t.booked || 0)
      + kpi('Proběhlo', t.done || 0, '#10b981')
      + kpi('Nedorazil', t.no_show || 0, t.no_show ? '#f59e0b' : null)
      + kpi('Zrušeno', t.canceled || 0, t.canceled ? '#ef4444' : null)
      + kpi('Nadcházející', t.upcoming || 0, '#60a5fa')
      + kpi('Úspěšnost', d.rate != null ? d.rate + ' %' : '—', d.rate != null ? (d.rate >= 60 ? '#10b981' : d.rate >= 40 ? '#f59e0b' : '#ef4444') : null);
    if (!d.people.length) { box.innerHTML = 'Žádní obchodníci k vyhodnocení.'; return; }
    var th = 'style="text-align:center;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);white-space:nowrap;"';
    var html = '<table style="border-collapse:collapse;width:100%;font-size:13px;"><thead><tr>'
      + '<th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">Obchodník</th>'
      + d.days.map(function (k) { return '<th ' + th + (isWeekend(k) ? ' title="víkend"' : '') + '>' + (k === today ? '<span style="color:#60a5fa">dnes</span>' : dayLabel(k)) + '</th>'; }).join('')
      + '<th ' + th + '>Σ</th><th ' + th + '>Proběhlo</th><th ' + th + '>Nedor.</th><th ' + th + '>Zruš.</th><th ' + th + '>Úspěšnost</th></tr></thead><tbody>';
    d.people.forEach(function (p) {
      html += '<tr><td style="padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.05);white-space:nowrap;font-weight:600;color:var(--text);">' + esc(p.name) + '</td>';
      d.days.forEach(function (k) {
        var c = p.per_day[k] || { booked: 0 }, n = c.booked || 0;
        var col = n > 0 ? (target > 0 && n < target ? '#f59e0b' : '#10b981') : (isWeekend(k) ? 'var(--text2)' : (target > 0 ? '#ef4444' : 'var(--text2)'));
        html += '<td style="text-align:center;padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.05);color:' + col + ';font-weight:' + (n ? '700' : '400') + ';' + (isWeekend(k) ? 'opacity:.5;' : '') + '" title="' + esc(p.name + ' · ' + k + ' · domluveno ' + n) + '">' + (n || '·') + '</td>';
      });
      var r = p.rate;
      html += '<td style="text-align:center;font-weight:700;border-bottom:1px solid rgba(255,255,255,.05);color:var(--text);">' + p.totals.booked + '</td>'
        + '<td style="text-align:center;border-bottom:1px solid rgba(255,255,255,.05);color:#10b981;">' + p.totals.done + '</td>'
        + '<td style="text-align:center;border-bottom:1px solid rgba(255,255,255,.05);">' + p.totals.no_show + '</td>'
        + '<td style="text-align:center;border-bottom:1px solid rgba(255,255,255,.05);">' + p.totals.canceled + '</td>'
        + '<td style="text-align:center;font-weight:700;border-bottom:1px solid rgba(255,255,255,.05);color:' + (r == null ? 'var(--text2)' : r >= 60 ? '#10b981' : r >= 40 ? '#f59e0b' : '#ef4444') + ';">' + (r != null ? r + ' %' : '—') + '</td></tr>';
    });
    html += '</tbody></table>'
      + '<div style="font-size:11.5px;color:var(--text2);margin-top:10px;">Zeleně = splněný cíl (nebo bez cíle), oranžově = pod cílem, červeně = nula v pracovní den (při nastaveném cíli). Víkendy jsou zašedlé.</div>';
    box.innerHTML = html;
  }

  async function save() {
    msg('Ukládám…', '');
    try { await api('/owner-meetings/settings', { method: 'PUT', body: { target: parseInt(document.getElementById('obst-target').value, 10) || 0, report_hour: parseInt(document.getElementById('obst-hour').value, 10) } }); msg('✅ Uloženo', 'ok'); load(); }
    catch (e) { msg(e.message, 'err'); }
  }
  async function sendNow() {
    if (!confirm('Poslat dnešní report do Velína (Jan + Tomáš) hned teď?')) return;
    msg('Odesílám…', '');
    try { var j = await api('/owner-meetings/report-now', { method: 'POST', body: {} }); msg('✅ Odesláno: ' + j.title, 'ok'); }
    catch (e) { msg(e.message, 'err'); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectTab); else injectTab();
})();
