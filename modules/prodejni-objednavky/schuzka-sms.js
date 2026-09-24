// =============================================================================
// HolyOS — SMS schůzka (self-injecting záložka v Prodejních objednávkách)
// =============================================================================
// Varianta „SCHŮZKA": leadům vybraných obchodníků se místo AI specialisty pošle
// SMS s odkazem na cestu k rozhodnutí (pradlomaty.info → rezervace termínu).
// Záložka: pravidla (obchodníci + text) s kontrolou překryvu proti specialistovi,
// testovací odeslání na vybraný lead a přehled odeslaných SMS.
// API: /api/compounder/ai-specialist-autosend (částečný PUT), /leads/:id/send-schuzka-sms,
//      /schuzka-sms-stats, /leads?search=, /sellers
(function () {
  'use strict';

  var TAB = 'schuzka-sms';
  var state = { cfg: null, sellers: [], lead: null, stats: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDt(s) { try { return new Date(s).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s || ''; } }
  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'include';
    if (opts.body && typeof opts.body !== 'string') { opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}); opts.body = JSON.stringify(opts.body); }
    return fetch('/api/compounder' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }
  function sellerName(s) { return ((s.first_name || '') + ' ' + (s.last_name || '')).trim() || ('#' + s.id); }

  function injectStyles() {
    if (document.getElementById('ss-styles')) return;
    var css = ''
      + '#tab-' + TAB + ' .ss-card{border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px;background:var(--surface,#141418)}'
      + '#tab-' + TAB + ' .ss-card.hl{border-color:rgba(16,185,129,.5);background:rgba(16,185,129,.05)}'
      + '#tab-' + TAB + ' h4{margin:0 0 8px;font-size:14px}'
      + '#tab-' + TAB + ' .ss-hint{font-size:12px;color:var(--text2);margin-bottom:10px;line-height:1.5}'
      + '#tab-' + TAB + ' .ss-owners{display:flex;flex-wrap:wrap;gap:10px 16px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);font-size:13px}'
      + '#tab-' + TAB + ' .ss-owners label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--text)}'
      + '#tab-' + TAB + ' .ss-owners label.dis{opacity:.5;cursor:not-allowed}'
      + '#tab-' + TAB + ' textarea,#tab-' + TAB + ' input[type=text]{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;font-family:inherit}'
      + '#tab-' + TAB + ' .ss-btn{border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;color:#fff;background:#3b82f6}'
      + '#tab-' + TAB + ' .ss-btn.green{background:#10b981;color:#06281a}'
      + '#tab-' + TAB + ' .ss-btn.ghost{background:transparent;border:1px solid var(--border);color:var(--text2);font-weight:600}'
      + '#tab-' + TAB + ' .ss-msg{margin-left:10px;font-size:13px;color:var(--text2)}'
      + '#tab-' + TAB + ' .ss-err{color:#ef4444}'
      + '#tab-' + TAB + ' .ss-ok{color:#10b981}'
      + '#tab-' + TAB + ' .ss-results{margin-top:6px;border:1px solid var(--border);border-radius:8px;max-height:220px;overflow:auto;background:var(--bg)}'
      + '#tab-' + TAB + ' .ss-row{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:10px}'
      + '#tab-' + TAB + ' .ss-row:hover{background:rgba(255,255,255,.04)}'
      + '#tab-' + TAB + ' .ss-row small{color:var(--text2)}'
      + '#tab-' + TAB + ' .ss-lead{margin-top:10px;padding:12px 14px;border:1px solid rgba(59,130,246,.45);border-radius:10px;background:rgba(59,130,246,.06);font-size:13px}'
      + '#tab-' + TAB + ' .ss-tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;margin-right:4px}'
      + '#tab-' + TAB + ' .ss-preview{margin-top:10px;padding:10px 12px;border-radius:10px;background:#0f1a2a;border:1px solid rgba(46,140,224,.35);font-family:ui-monospace,Menlo,monospace;font-size:12.5px;white-space:pre-wrap;word-break:break-all;color:#dceaf6}'
      + '#tab-' + TAB + ' table{width:100%;border-collapse:collapse;font-size:12.5px}'
      + '#tab-' + TAB + ' th{text-align:left;color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid var(--border)}'
      + '#tab-' + TAB + ' td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}'
      + '#tab-' + TAB + ' .ss-kpi{display:inline-block;margin-right:14px;font-size:13px;color:var(--text2)}'
      + '#tab-' + TAB + ' .ss-kpi b{color:var(--text);font-size:15px}';
    var st = document.createElement('style'); st.id = 'ss-styles'; st.textContent = css; document.head.appendChild(st);
  }

  function injectTab() {
    if (document.getElementById('tab-' + TAB)) return;
    injectStyles();
    var bar = document.querySelector('.tab-bar');
    if (bar) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'tab-btn'; btn.setAttribute('data-tab', TAB);
      btn.textContent = '📨 SMS schůzka';
      btn.onclick = function () { window.switchTab(TAB); };
      var after = bar.querySelector('.tab-btn[data-tab="terminy"]');
      if (after && after.nextSibling) bar.insertBefore(btn, after.nextSibling); else bar.appendChild(btn);
    }
    var host = document.getElementById('tab-orders');
    var parent = host ? host.parentNode : document.querySelector('.main-wrapper') || document.body;
    var div = document.createElement('div');
    div.id = 'tab-' + TAB; div.style.display = 'none'; div.style.padding = '20px 24px 24px'; div.style.maxWidth = '860px';
    div.innerHTML = ''
      + '<h3 style="margin:0 0 4px;font-size:16px;">📨 SMS schůzka — cesta k rozhodnutí</h3>'
      + '<div class="ss-hint">Leadům vybraných obchodníků se místo AI specialisty pošle SMS s odkazem na <b>pradlomaty.info</b> (klíčové informace → vlastní kapitál / financování → rezervace termínu). '
      + '<b>Pojistka:</b> jednomu leadovi se nikdy nepošle obojí a obchodník nemůže být v obou variantách zároveň.</div>'

      + '<div class="ss-card">'
      + '  <h4>⚙️ Automatické odeslání — kteří obchodníci</h4>'
      + '  <div class="ss-hint">Nový lead z reklamy přiřazený těmto obchodníkům dostane SMS se schůzkou (platí stejná pravidla jako u specialisty: zdroj, jen nové, black list). Obchodníci zaškrtnutí u <b>AI specialisty</b> jsou tady zašedlí.</div>'
      + '  <div class="ss-owners" id="ss-owners">Načítám obchodníky…</div>'
      + '  <div style="font-size:12px;color:var(--text2);margin:10px 0 4px;">Text SMS (<code>{link}</code> = odkaz na cestu):</div>'
      + '  <textarea id="ss-text" rows="2" placeholder="PRADLOMATY: vyberte si termin schuzky {link}"></textarea>'
      + '  <div style="margin-top:10px;"><button class="ss-btn" id="ss-save">💾 Uložit</button><span class="ss-msg" id="ss-save-msg"></span></div>'
      + '</div>'

      + '<div class="ss-card hl">'
      + '  <h4>🧪 Testovací odeslání na konkrétní lead</h4>'
      + '  <div class="ss-hint">Vyber lead (klidně svůj testovací kontakt 🧪), pošli mu SMS a projdi si celou cestu z telefonu. Odešle se skutečná SMS přes nastavenou bránu a zapíše se leadovi stejně jako u automatu.</div>'
      + '  <input type="text" id="ss-search" placeholder="Hledat lead: jméno, e-mail nebo telefon…">'
      + '  <div class="ss-results" id="ss-results" style="display:none"></div>'
      + '  <div id="ss-lead"></div>'
      + '</div>'

      + '<div class="ss-card">'
      + '  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><h4 style="margin:0">📊 Odeslané SMS schůzky</h4><button class="ss-btn ghost" id="ss-reload">↻ Načíst</button><span id="ss-kpis"></span></div>'
      + '  <div id="ss-stats" style="margin-top:10px;font-size:12px;color:var(--text2);"></div>'
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

    document.getElementById('ss-save').onclick = save;
    document.getElementById('ss-reload').onclick = loadStats;
    var t = null;
    document.getElementById('ss-search').addEventListener('input', function (e) {
      clearTimeout(t); var q = e.target.value.trim();
      if (q.length < 2) { document.getElementById('ss-results').style.display = 'none'; return; }
      t = setTimeout(function () { searchLeads(q); }, 250);
    });
  }

  // ── Nastavení ────────────────────────────────────────────────────────────
  async function load() {
    try {
      var sr = await fetch('/api/compounder/sellers', { credentials: 'include' });
      state.sellers = sr.ok ? await sr.json() : [];
    } catch (e) { state.sellers = []; }
    try {
      var j = await api('/ai-specialist-autosend');
      state.cfg = (j && j.config) || {};
    } catch (e) { state.cfg = {}; }
    renderOwners();
    document.getElementById('ss-text').value = state.cfg.schuzkaText || 'PRADLOMATY: vyberte si termin schuzky {link}';
    loadStats();
  }
  function renderOwners() {
    var box = document.getElementById('ss-owners'); if (!box) return;
    var sel = (state.cfg.schuzkaOwnerPersonIds || []).map(Number);
    var spec = (state.cfg.ownerPersonIds || []).map(Number);
    if (!state.sellers.length) { box.innerHTML = '<span style="color:var(--text2)">Žádní obchodníci k dispozici.</span>'; return; }
    box.innerHTML = state.sellers.map(function (s) {
      var id = Number(s.id), isSpec = spec.indexOf(id) !== -1;
      return '<label class="' + (isSpec ? 'dis' : '') + '" title="' + (isSpec ? 'Je zaškrtnutý u AI specialisty — nejdřív ho tam odškrtni' : '') + '">'
        + '<input type="checkbox" class="ss-owner" value="' + id + '"' + (sel.indexOf(id) !== -1 ? ' checked' : '') + (isSpec ? ' disabled' : '') + '> ' + esc(sellerName(s))
        + (isSpec ? ' <span style="font-size:11px;color:#a78bfa;">(specialista)</span>' : '') + '</label>';
    }).join('');
  }
  async function save() {
    var msg = document.getElementById('ss-save-msg'); msg.className = 'ss-msg'; msg.textContent = 'Ukládám…';
    var ids = Array.prototype.slice.call(document.querySelectorAll('.ss-owner:checked')).map(function (c) { return parseInt(c.value, 10); }).filter(Boolean);
    var spec = (state.cfg.ownerPersonIds || []).map(Number);
    var overlap = ids.filter(function (id) { return spec.indexOf(id) !== -1; });
    if (overlap.length) { msg.className = 'ss-msg ss-err'; msg.textContent = 'Obchodník nemůže být zároveň u specialisty i u schůzky.'; return; }
    try {
      var j = await api('/ai-specialist-autosend', { method: 'PUT', body: { schuzkaOwnerPersonIds: ids, schuzkaText: document.getElementById('ss-text').value } });
      state.cfg = (j && j.config) || state.cfg;
      msg.className = 'ss-msg ss-ok'; msg.textContent = '✅ Uloženo';
    } catch (e) { msg.className = 'ss-msg ss-err'; msg.textContent = e.message; }
  }

  // ── Testovací odeslání ───────────────────────────────────────────────────
  async function searchLeads(q) {
    var box = document.getElementById('ss-results');
    box.style.display = ''; box.innerHTML = '<div class="ss-row"><small>Hledám…</small></div>';
    try {
      var r = await fetch('/api/compounder/leads?search=' + encodeURIComponent(q), { credentials: 'include' });
      var list = await r.json();
      list = Array.isArray(list) ? list : (list.leads || list.items || []);
      if (!list.length) { box.innerHTML = '<div class="ss-row"><small>Nic nenalezeno.</small></div>'; return; }
      box.innerHTML = list.slice(0, 30).map(function (l) {
        return '<div class="ss-row" data-id="' + l.id + '"><span>' + (l.is_test ? '🧪 ' : '') + esc(l.name || '—') + ' <small>' + esc(l.phone || 'bez telefonu') + '</small></span><small>' + esc(l.email || '') + '</small></div>';
      }).join('');
      var byId = {}; list.forEach(function (l) { byId[l.id] = l; });
      box.querySelectorAll('.ss-row').forEach(function (row) { row.onclick = function () { pickLead(byId[row.getAttribute('data-id')]); box.style.display = 'none'; }; });
    } catch (e) { box.innerHTML = '<div class="ss-row ss-err">Chyba: ' + esc(e.message) + '</div>'; }
  }
  function pickLead(l) {
    state.lead = l; var box = document.getElementById('ss-lead'); if (!l) { box.innerHTML = ''; return; }
    var tpl = document.getElementById('ss-text').value || 'PRADLOMATY: vyberte si termin schuzky {link}';
    var warn = [];
    if (!l.phone) warn.push('Lead nemá telefon — SMS nelze odeslat.');
    if (l.outreach_variant === 'specialist') warn.push('Leadovi už byl odeslán <b>specialista</b> — pojistka odeslání zablokuje (pro test zaškrtni „Ignorovat pojistku").');
    if (l.schuzka_sms_sent_at) warn.push('SMS se schůzkou už byla odeslána ' + fmtDt(l.schuzka_sms_sent_at) + ' — pro opakování zaškrtni „Ignorovat pojistku".');
    box.innerHTML = '<div class="ss-lead">'
      + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">'
      + '  <div><b style="font-size:14px;">' + (l.is_test ? '🧪 ' : '') + esc(l.name || '—') + '</b> <span style="color:var(--text2);">' + esc(l.phone || '') + (l.email ? ' · ' + esc(l.email) : '') + '</span>'
      + '  <div style="margin-top:4px;"><span class="ss-tag" style="background:rgba(59,130,246,.18);color:#93c5fd;">stav: ' + esc(l.status || 'new') + '</span>'
      + (l.outreach_variant ? '<span class="ss-tag" style="background:rgba(167,139,250,.18);color:#c4b5fd;">osloveno: ' + esc(l.outreach_variant) + '</span>' : '')
      + (l.source ? '<span class="ss-tag" style="background:rgba(255,255,255,.06);color:var(--text2);">' + esc(l.source) + '</span>' : '') + '</div></div>'
      + '  <button class="ss-btn ghost" id="ss-unpick">✕ jiný lead</button>'
      + '</div>'
      + (warn.length ? '<div style="margin-top:8px;font-size:12px;color:#f59e0b;">' + warn.map(function (w) { return '⚠️ ' + w; }).join('<br>') + '</div>' : '')
      + '<div style="font-size:12px;color:var(--text2);margin-top:10px;">Náhled SMS (odkaz se doplní při odeslání):</div>'
      + '<div class="ss-preview">' + esc(tpl.indexOf('{link}') !== -1 ? tpl.replace('{link}', 'https://pradlomaty.info/c/…') : tpl + ' https://pradlomaty.info/c/…') + '</div>'
      + '<div style="margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">'
      + '  <button class="ss-btn green" id="ss-send"' + (l.phone ? '' : ' disabled') + '>📨 Odeslat testovací SMS</button>'
      + '  <label style="font-size:12.5px;color:var(--text2);display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="ss-force"> Ignorovat pojistku (opakované / po specialistovi)</label>'
      + '  <span class="ss-msg" id="ss-send-msg"></span>'
      + '</div>'
      + '<div id="ss-send-result"></div>'
      + '</div>';
    document.getElementById('ss-unpick').onclick = function () { state.lead = null; box.innerHTML = ''; document.getElementById('ss-search').value = ''; };
    document.getElementById('ss-send').onclick = sendTest;
  }
  async function sendTest() {
    var l = state.lead; if (!l) return;
    var msg = document.getElementById('ss-send-msg'), out = document.getElementById('ss-send-result'), btn = document.getElementById('ss-send');
    if (!confirm('Opravdu odeslat SMS na ' + (l.phone || '?') + ' (' + (l.name || '') + ')?')) return;
    btn.disabled = true; msg.className = 'ss-msg'; msg.textContent = 'Odesílám…'; out.innerHTML = '';
    try {
      var j = await api('/leads/' + l.id + '/send-schuzka-sms', { method: 'POST', body: { text: document.getElementById('ss-text').value, force: !!document.getElementById('ss-force').checked } });
      msg.className = 'ss-msg ss-ok'; msg.textContent = '✅ Odesláno';
      out.innerHTML = '<div style="margin-top:10px;font-size:12.5px;">'
        + '<div>Odkaz v SMS: <a href="' + esc(j.link) + '" target="_blank" style="color:#4aa3ea;">' + esc(j.link) + '</a> <button class="ss-btn ghost" style="padding:3px 8px;font-size:11px;" onclick="navigator.clipboard&&navigator.clipboard.writeText(\'' + esc(j.link) + '\')">kopírovat</button></div>'
        + '<div style="color:var(--text2);margin-top:4px;">SID: ' + esc(j.sid || '—') + ' · ' + fmtDt(j.sentAt) + ' · stav leada přepnut na <b>odeslana_schuzka</b>. Otevření odkazu a rezervaci uvidíš v tabulce níže (↻ Načíst) a v cestě zákazníka u leada.</div>'
        + '</div>';
      state.lead.schuzka_sms_sent_at = j.sentAt; state.lead.outreach_variant = 'schuzka';
      loadStats();
    } catch (e) { msg.className = 'ss-msg ss-err'; msg.textContent = e.message; }
    btn.disabled = false;
  }

  // ── Statistika ───────────────────────────────────────────────────────────
  async function loadStats() {
    var box = document.getElementById('ss-stats'), k = document.getElementById('ss-kpis'); if (!box) return;
    box.textContent = 'Načítám…';
    try {
      var j = await api('/schuzka-sms-stats');
      k.innerHTML = '<span class="ss-kpi">odesláno <b>' + j.total + '</b></span><span class="ss-kpi">otevřelo <b>' + j.opened + '</b></span><span class="ss-kpi">rezervovalo <b>' + j.booked + '</b></span><span class="ss-kpi" style="font-size:11px;">(bez 🧪 testovacích)</span>';
      if (!j.list.length) { box.innerHTML = 'Zatím žádná odeslaná SMS se schůzkou.'; return; }
      box.innerHTML = '<table><thead><tr><th>Odesláno</th><th>Lead</th><th>Telefon</th><th>SMS</th><th>Otevřel</th><th>Rezervace</th><th>Forma / cesta</th></tr></thead><tbody>'
        + j.list.map(function (r) {
          return '<tr><td>' + fmtDt(r.sentAt) + '</td><td>' + (r.is_test ? '🧪 ' : '') + esc(r.name || '—') + '</td><td>' + esc(r.phone || '') + '</td><td>' + esc(r.smsStatus) + '</td>'
            + '<td>' + (r.opened ? '<span class="ss-ok">✓</span>' : '<span style="color:var(--text2)">—</span>') + '</td>'
            + '<td>' + (r.bookedAt ? '<span class="ss-ok">🤝 ' + fmtDt(r.bookedAt) + '</span>' : '<span style="color:var(--text2)">—</span>') + '</td>'
            + '<td>' + (r.mode ? (r.mode === 'online' ? '💻 online' : '👤 osobně') : '') + (r.financing_path ? ' · ' + (r.financing_path === 'vlastni' ? '💰 vlastní' : '🏦 financování') : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    } catch (e) { box.innerHTML = '<span class="ss-err">Chyba: ' + esc(e.message) + '</span>'; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectTab); else injectTab();
})();
