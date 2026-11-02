// =============================================================================
// HolyOS — Aplikace obchodníka: nastavení viditelnosti tlačítek u kontaktu
// =============================================================================
// Self-injecting záložka v Prodejních objednávkách. Vypíše všechny bloky / tlačítka,
// které obchodník vidí u kontaktu, a umožní zvolit, které budou výchozně vidět.
// API: GET/PUT /api/compounder/obchodnik-ui (PUT jen admin). Aplikace obchodníka
// (modules/obchodnik) schované bloky skryje podle data-obk.
(function () {
  'use strict';

  var TAB = 'obchodnik-ui';
  var state = { buttons: [], hidden: [] };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'include';
    if (opts.body && typeof opts.body !== 'string') { opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}); opts.body = JSON.stringify(opts.body); }
    return fetch('/api/compounder' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }

  function injectTab() {
    if (document.getElementById('tab-' + TAB)) return;
    var bar = document.querySelector('.tab-bar');
    if (bar) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'tab-btn'; btn.setAttribute('data-tab', TAB);
      btn.textContent = '📱 Aplikace obchodníka';
      btn.onclick = function () { window.switchTab(TAB); };
      bar.appendChild(btn);
    }
    var host = document.getElementById('tab-orders');
    var parent = host ? host.parentNode : document.querySelector('.main-wrapper') || document.body;
    var div = document.createElement('div');
    div.id = 'tab-' + TAB; div.style.display = 'none'; div.style.padding = '20px 24px 24px'; div.style.maxWidth = '860px';
    div.innerHTML = ''
      + '<h3 style="margin:0 0 4px;font-size:16px;">📱 Aplikace obchodníka — co vidí u kontaktu</h3>'
      + '<div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.5;">Zaškrtnuté bloky obchodník u kontaktu <b>vidí</b>, odškrtnuté jsou schované (platí pro všechny obchodníky, použije se po obnovení aplikace). Nic se nemaže — kdykoli jde zapnout zpět.</div>'
      + '<div id="obui-body" style="color:var(--text2);">Načítám…</div>'
      + '<div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      + '  <button type="button" id="obui-save" style="border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;color:#fff;background:#3b82f6;">💾 Uložit</button>'
      + '  <button type="button" id="obui-all" style="border:1px solid var(--border);background:transparent;color:var(--text2);border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer;">Zobrazit vše</button>'
      + '  <button type="button" id="obui-def" style="border:1px solid var(--border);background:transparent;color:var(--text2);border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer;">↺ Výchozí</button>'
      + '  <span id="obui-msg" style="font-size:13px;color:var(--text2);"></span>'
      + '</div>';
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
    document.getElementById('obui-save').onclick = save;
    document.getElementById('obui-all').onclick = function () { setAll(true); };
    document.getElementById('obui-def').onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.obui-cb'), function (c) { var b = state.buttons.filter(function (x) { return x.key === c.value; })[0]; c.checked = !(b && b.default_hidden); });
      msg('Výchozí nastavení načteno — nezapomeň Uložit.', '');
    };
  }

  function msg(t, cls) { var m = document.getElementById('obui-msg'); if (!m) return; m.textContent = t; m.style.color = cls === 'err' ? '#ef4444' : cls === 'ok' ? '#10b981' : 'var(--text2)'; }
  function setAll(v) { Array.prototype.forEach.call(document.querySelectorAll('.obui-cb'), function (c) { c.checked = v; }); msg('Změněno — nezapomeň Uložit.', ''); }

  async function load() {
    var box = document.getElementById('obui-body'); if (!box) return;
    box.textContent = 'Načítám…';
    try {
      var j = await api('/obchodnik-ui');
      state.buttons = j.buttons || []; state.hidden = j.hidden || [];
      var groups = [], by = {};
      state.buttons.forEach(function (b) { if (!by[b.group]) { by[b.group] = []; groups.push(b.group); } by[b.group].push(b); });
      box.innerHTML = groups.map(function (g) {
        return '<div style="border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:12px;background:var(--surface,#141418);">'
          + '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);margin-bottom:8px;">' + esc(g) + '</div>'
          + by[g].map(function (b) {
            return '<label style="display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13.5px;color:var(--text);cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04);">'
              + '<input type="checkbox" class="obui-cb" value="' + esc(b.key) + '"' + (state.hidden.indexOf(b.key) === -1 ? ' checked' : '') + '> <span>' + esc(b.label) + '</span></label>';
          }).join('') + '</div>';
      }).join('');
      msg('', '');
    } catch (e) { box.innerHTML = '<span style="color:#ef4444">Chyba: ' + esc(e.message) + '</span>'; }
  }

  async function save() {
    var hidden = Array.prototype.slice.call(document.querySelectorAll('.obui-cb')).filter(function (c) { return !c.checked; }).map(function (c) { return c.value; });
    msg('Ukládám…', '');
    try { var j = await api('/obchodnik-ui', { method: 'PUT', body: { hidden: hidden } }); state.hidden = j.hidden || hidden; msg('✅ Uloženo (schováno: ' + state.hidden.length + ')', 'ok'); }
    catch (e) { msg(e.message, 'err'); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectTab); else injectTab();
})();
