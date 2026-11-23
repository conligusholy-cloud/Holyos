// HolyOS — Laundromat Tycoon: e-mailing (seznam kontaktů, jednorázové a pravidelné kampaně)
// Napojeno na /api/game-admin/mailing. Spouští se ze záložek v modules/milionar/index.html přes window.GMail.open(...).
(function () {
  var API = '/api/game-admin/mailing';
  var S = { senders: [], senderInfo: null, facets: { stage: [], kind: [], country: [] }, tags: [], extraKeys: [], list: { q: '', status: '', tag: '', stage: '', kind: '', country: '', offset: 0, sel: {}, last: null } };
  var LANG = { cs: 'Čeština', en: 'English', pl: 'Polski', sk: 'Slovenčina', de: 'Deutsch', hu: 'Magyar', ro: 'Română', it: 'Italiano', es: 'Español', fr: 'Français' };
  var STATUS = { draft: 'Koncept', scheduled: 'Naplánováno', sending: 'Odesílá se', sent: 'Odesláno', active: 'Zapnuto', paused: 'Pozastaveno' };
  var CSTATUS = { active: 'Aktivní', unsubscribed: 'Odhlášen', bounced: 'Nedoručitelný', excluded: 'Vyřazen (nezasílat)' };
  var DOW = ['', 'každé pondělí', 'každé úterý', 'každou středu', 'každý čtvrtek', 'každý pátek', 'každou sobotu', 'každou neděli'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function api(method, url, body) {
    return fetch(API + url, { method: method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function fdt(s) { return s ? new Date(s).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function fd(s) { return s ? new Date(s).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }) : '—'; }
  function err(el, e) { el.innerHTML = '<p class="note" style="color:#f87171">' + esc(e.message || e) + '</p>'; }

  // ── styly ─────────────────────────────────────────────────────
  var st = document.createElement('style');
  st.textContent = [
    '.gm-in{background:var(--surface2,#1b2234);border:1px solid var(--border,#2a344d);color:var(--text,#e8edf7);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;box-sizing:border-box}',
    '.gm-in:focus{outline:none;border-color:#7c5cff}textarea.gm-in{width:100%;min-height:200px;resize:vertical;line-height:1.5;font-family:inherit}select.gm-in{padding-right:24px}',
    '.gm-ovl{position:fixed;inset:0;background:rgba(5,8,16,.72);z-index:9000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:4vh 12px}',
    '.gm-dlg{background:var(--surface,#131a2b);border:1px solid var(--border,#2a344d);border-radius:16px;width:min(900px,100%);padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
    '.gm-dlg h3{margin:0 0 4px;font-size:18px}.gm-row{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:start;margin:10px 0}.gm-row>label{font-size:12px;color:var(--text2,#8ea2c2);padding-top:8px}',
    '.gm-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gm-ph{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0}.gm-ph button{cursor:pointer;border:1px dashed #7c5cff;background:transparent;color:#b9a8ff;border-radius:999px;font-size:11px;padding:2px 9px}',
    '.gm-step{border:1px solid var(--border,#2a344d);border-radius:12px;padding:12px;margin:10px 0;background:rgba(255,255,255,.02)}',
    '.gm-c{border:1px solid var(--border,#2a344d);border-radius:14px;padding:14px 16px;margin:0 0 12px;background:var(--surface,#131a2b)}.gm-c h4{margin:0;font-size:15px}',
    '.gm-meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin:6px 0 10px;font-size:12px;color:var(--text2,#8ea2c2)}.gm-meta b{color:var(--text,#e8edf7);font-weight:600}',
    '.gm-dlg{position:relative}.gm-dlg .gm-x{position:absolute;top:12px;right:14px;background:none;border:0;color:var(--text2,#8ea2c2);font-size:22px;line-height:1;cursor:pointer;padding:4px 8px}.gm-dlg .gm-x:hover{color:#fff}.gm-dlg h3{padding-right:36px}',
    '.gm-dlg.wide{width:min(1500px,100%)}.gm-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,600px);gap:20px;align-items:start}@media(max-width:1100px){.gm-split{grid-template-columns:1fr}}',
    '.gm-pv{position:sticky;top:10px;border:1px solid var(--border,#2a344d);border-radius:12px;overflow:hidden;background:#eaf2ff}.gm-pvh{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 12px;background:var(--surface2,#1b2234);color:var(--text2,#8ea2c2);font-size:12px}.gm-pvh b{color:var(--text,#e8edf7)}.gm-pv iframe{display:block;width:100%;height:calc(92vh - 120px);border:0;background:#eaf2ff}',
    '.gm-ai{border:1px dashed rgba(124,92,255,.55);border-radius:10px;padding:10px;background:rgba(124,92,255,.06)}.gm-ai textarea.gm-in{min-height:70px}.gm-img{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gm-img img{max-height:70px;max-width:160px;border-radius:8px;border:1px solid var(--border,#2a344d)}',
    '.gm-btns{display:flex;flex-wrap:wrap;gap:8px}.gm-btn{cursor:pointer}.gm-st{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:rgba(142,162,194,.18)}',
    '.gm-st.active,.gm-st.sent{background:rgba(34,197,94,.18);color:#22c55e}.gm-st.scheduled,.gm-st.sending{background:rgba(245,158,11,.18);color:#f59e0b}.gm-st.paused{background:rgba(239,68,68,.15);color:#f87171}',
    '.gm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:10px}.gm-stats div{background:rgba(255,255,255,.03);border:1px solid var(--border,#2a344d);border-radius:10px;padding:8px 10px}.gm-stats b{display:block;font-size:18px}.gm-stats span{font-size:10.5px;color:var(--text2,#8ea2c2);text-transform:uppercase;letter-spacing:.05em}',
    '.gm-warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);color:#fbbf24;border-radius:10px;padding:9px 12px;font-size:12.5px;margin:10px 0}',
    '.gm-map td,.gm-map th{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12.5px;text-align:left;vertical-align:middle}.gm-map .pv{color:var(--text2,#8ea2c2);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '@media(max-width:700px){.gm-row,.gm-2{grid-template-columns:1fr}.gm-row>label{padding-top:0}}'
  ].join('\n');
  document.head.appendChild(st);

  // ── dialog ────────────────────────────────────────────────────
  var ovl = null;
  // Okna se zavírají JEN křížkem / tlačítkem (ne kliknutím mimo ani Esc) — ať se rozdělaná kampaň neztratí
  function openDlg(html, opt) {
    closeDlg(); opt = opt || {};
    ovl = document.createElement('div'); ovl.className = 'gm-ovl'; ovl.setAttribute('data-no-backdrop-close', '');
    ovl.innerHTML = '<div class="gm-dlg' + (opt.wide ? ' wide' : '') + '"><button type="button" class="gm-x" title="Zavřít" aria-label="Zavřít">✕</button>' + html + '</div>';
    ovl.querySelector('.gm-x').onclick = function () { closeDlg(); if (opt.onClose) opt.onClose(); };
    document.body.appendChild(ovl);
    return ovl.firstChild;
  }
  function closeDlg() { if (ovl) { ovl.remove(); ovl = null; } }

  function loadSenders() {
    return api('GET', '/senders').then(function (j) { S.senders = j.senders || []; S.senderInfo = j; return j; }).catch(function () { S.senders = []; });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SEZNAM KONTAKTŮ
  // ═══════════════════════════════════════════════════════════════
  function openList() {
    var box = $('gm-list'); if (!box) return;
    if (!box.__init) {
      box.__init = true;
      box.innerHTML =
        '<div class="toolbar"><span style="flex:1"></span><button class="btn sm" id="gml-add">＋ Kontakt</button><button class="btn on sm" id="gml-imp">⬆ Importovat CSV</button></div>' +
        '<p class="note" style="margin:0 0 12px">Samostatný seznam pro e-mailing hry — nesouvisí s hráči ani s ostatními seznamy v HolyOS. Kontakty sem přesuneš importem z jiného systému (CSV); sloupce, které nemají vlastní pole, se uloží jako vlastní pole a půjdou vložit do textu e-mailu jako <code>{{název_sloupce}}</code>. Odhlášení a nedoručitelné adresy se do kampaní nikdy nezahrnou.</p>' +
        '<div id="gml-kpi" class="kpis"></div><div id="gml-bulk" class="toolbar" style="margin:6px 0"></div>' +
        '<div class="tbl-wrap"><table class="data-table" id="gml-tbl"></table></div>';
      $('gml-add').onclick = function () { contactDlg(null); };
      $('gml-imp').onclick = importDlg;
      var tb = $('gml-tbl');
      tb.addEventListener('change', function (e) {
        var t = e.target;
        if (t.id === 'gml-all') { (S.list.table ? S.list.table.getVisible() : []).forEach(function (r) { if (t.checked) S.list.sel[r.id] = true; else delete S.list.sel[r.id]; }); [].forEach.call(tb.querySelectorAll('[data-sel]'), function (cb) { cb.checked = t.checked; }); bulkBar(); return; }
        var id = t.getAttribute && t.getAttribute('data-sel'); if (id) { if (t.checked) S.list.sel[id] = true; else delete S.list.sel[id]; bulkBar(); }
      });
      tb.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-edit],[data-del]'); if (!b) return;
        if (b.hasAttribute('data-edit')) { var id = +b.getAttribute('data-edit'); contactDlg((S.list.rows || []).filter(function (x) { return x.id === id; })[0]); }
        else { if (!confirm('Smazat kontakt?')) return; api('DELETE', '/contacts/' + b.getAttribute('data-del')).then(loadContacts).catch(function (er) { alert(er.message); }); }
      });
    }
    loadContacts();
  }

  function contactRow(r) {
    var ex = r.extra && Object.keys(r.extra).length ? ' title="' + esc(Object.keys(r.extra).map(function (k) { return k + ': ' + r.extra[k]; }).join('\n')) + '"' : '';
    return '<tr><td><input type="checkbox" data-sel="' + r.id + '"' + (S.list.sel[r.id] ? ' checked' : '') + '></td><td><b>' + esc(r.email) + '</b></td><td>' + esc(((r.first_name || '') + ' ' + (r.last_name || '')).trim() || '—') + '</td><td>' + esc(r.company || '') + '</td><td>' + esc(r.phone || '') + '</td><td>' + esc(r.country || '') + '</td><td>' + esc(r.kind || '') + '</td><td>' + esc(r.stage || '') + '</td><td>' + esc(r.lang || '') + '</td><td>' + esc(r.tags || '') + '</td>' +
      '<td><span class="chip' + (r.status === 'active' ? ' ok' : '') + '">' + esc(CSTATUS[r.status] || r.status) + '</span></td><td' + ex + ' class="note">' + esc(r.source || '') + (ex ? ' ⓘ' : '') + '</td><td class="note">' + fd(r.created_at) + '</td>' +
      '<td style="white-space:nowrap"><button class="btn sm" data-edit="' + r.id + '">Upravit</button> <button class="btn sm" data-del="' + r.id + '">✕</button></td></tr>';
  }
  function contactCols() {
    var T = function (key, label, get, en) { return { key: key, label: label, type: 'text', enum: en ? true : undefined, ph: en ? 'Vyber…' : 'Hledat…', get: get }; };
    return [
      null,
      T('email', 'E-mail', function (r) { return r.email; }),
      T('name', 'Jméno', function (r) { return ((r.first_name || '') + ' ' + (r.last_name || '')).trim(); }),
      T('company', 'Firma', function (r) { return r.company || ''; }),
      T('phone', 'Telefon', function (r) { return r.phone || ''; }),
      T('country', 'Země', function (r) { return r.country || ''; }, true),
      T('kind', 'Typ kontaktu', function (r) { return r.kind || ''; }, true),
      T('stage', 'Stav CRM', function (r) { return r.stage || ''; }, true),
      T('lang', 'Jazyk', function (r) { return r.lang || ''; }, true),
      T('tags', 'Štítky', function (r) { return r.tags || ''; }),
      T('status', 'Stav e-mailu', function (r) { return CSTATUS[r.status] || r.status; }, true),
      T('source', 'Zdroj', function (r) { return r.source || ''; }, true),
      { key: 'created', label: 'Přidáno', type: 'date', ph: 'dd.mm.rrrr', get: function (r) { return r.created_at ? new Date(r.created_at) : null; } },
      null
    ];
  }
  function loadContacts() {
    var L = S.list;
    api('GET', '/contacts?all=1').then(function (j) {
      L.last = j; L.rows = j.items || []; S.tags = j.tags || []; S.extraKeys = j.extra_keys || [];
      var c = j.counts || {};
      $('gml-kpi').innerHTML = '<div class="kpi"><div class="v">' + (c.active || 0) + '</div><div class="l">Aktivních kontaktů</div></div><div class="kpi"><div class="v">' + (c.excluded || 0) + '</div><div class="l">Vyřazených (nezasílat)</div></div><div class="kpi"><div class="v">' + (c.unsubscribed || 0) + '</div><div class="l">Odhlášených</div></div><div class="kpi"><div class="v">' + (c.bounced || 0) + '</div><div class="l">Nedoručitelných</div></div><div class="kpi"><div class="v">' + j.total + '</div><div class="l">Celkem kontaktů</div></div>';
      var th = '<thead><tr><th><input type="checkbox" id="gml-all"></th><th>E-mail</th><th>Jméno</th><th>Firma</th><th>Telefon</th><th>Země</th><th>Typ kontaktu</th><th>Stav CRM</th><th>Jazyk</th><th>Štítky</th><th>Stav e-mailu</th><th>Zdroj</th><th>Přidáno</th><th></th></tr></thead><tbody></tbody>';
      if (!window.ColFilters) { $('gml-tbl').innerHTML = th; $('gml-tbl').querySelector('tbody').innerHTML = L.rows.slice(0, 500).map(contactRow).join(''); bulkBar(); return; }
      if (!L.table) { $('gml-tbl').innerHTML = th; L.table = window.ColFilters.table({ table: '#gml-tbl', columns: contactCols(), renderRow: contactRow, limit: Infinity, noun: 'kontaktů', emptyText: 'Seznam je zatím prázdný — přidej kontakt nebo naimportuj CSV.', onRender: function () { bulkBar(); } }); }
      L.table.setRows(L.rows);
    }).catch(function (e) { err($('gml-tbl'), e); });
  }
  function bulkBar() {
    var L = S.list, n = Object.keys(L.sel).length, el = $('gml-bulk'); if (!el) return;
    var vis = L.table ? L.table.getVisible() : (L.rows || []), filtered = !!(L.table && L.table.cf.activeCount());
    el.innerHTML = n ? '<span class="note"><b>' + n + '</b> vybráno:</span><button class="btn sm" data-b="tag">＋ Štítek</button><button class="btn sm" data-b="active">Označit aktivní</button><button class="btn sm" data-b="excl">Vyřadit (nezasílat)</button><button class="btn sm" data-b="unsub">Označit odhlášené</button><button class="btn sm" data-b="del">Smazat vybrané</button>' :
      '<button class="btn sm" data-b="delall">Smazat všech ' + vis.length + (filtered ? ' podle filtru' : ' kontaktů') + '</button>';
    [].forEach.call(el.querySelectorAll('[data-b]'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-b'), ids = n ? Object.keys(L.sel).map(Number) : vis.map(function (r) { return r.id; });
        if (!ids.length) return;
        var body = { ids: ids };
        if (a === 'tag') { var t = prompt('Štítek, který se přidá vybraným kontaktům:', ''); if (!t) return; body.action = 'tag'; body.tag = t; }
        else if (a === 'active' || a === 'unsub' || a === 'excl') { body.action = 'status'; body.status = a === 'active' ? 'active' : (a === 'excl' ? 'excluded' : 'unsubscribed'); }
        else { if (!confirm(a === 'delall' ? 'Opravdu smazat ' + ids.length + ' kontaktů? Nelze vrátit.' : 'Smazat ' + n + ' vybraných kontaktů? Nelze vrátit.')) return; body.action = 'delete'; }
        api('POST', '/contacts/bulk', body).then(function () { L.sel = {}; loadContacts(); }).catch(function (er) { alert(er.message); });
      };
    });
  }

  function contactDlg(c) {
    c = c || {};
    var ex = c.extra || {};
    var d = openDlg('<h3>' + (c.id ? 'Upravit kontakt' : 'Nový kontakt') + '</h3><div id="gmc-body">' +
      '<div class="gm-2"><div><label class="note">E-mail *</label><input id="gmc-email" class="gm-in" style="width:100%" value="' + esc(c.email || '') + '"></div><div><label class="note">Telefon</label><input id="gmc-phone" class="gm-in" style="width:100%" value="' + esc(c.phone || '') + '"></div>' +
      '<div><label class="note">Jméno</label><input id="gmc-fn" class="gm-in" style="width:100%" value="' + esc(c.first_name || '') + '"></div><div><label class="note">Příjmení</label><input id="gmc-ln" class="gm-in" style="width:100%" value="' + esc(c.last_name || '') + '"></div>' +
      '<div><label class="note">Firma</label><input id="gmc-co" class="gm-in" style="width:100%" value="' + esc(c.company || '') + '"></div><div><label class="note">Země</label><input id="gmc-country" class="gm-in" style="width:100%" value="' + esc(c.country || '') + '"></div><div><label class="note">Typ kontaktu</label><input id="gmc-kind" class="gm-in" style="width:100%" value="' + esc(c.kind || '') + '"></div><div><label class="note">Stav v CRM</label><input id="gmc-stage" class="gm-in" style="width:100%" value="' + esc(c.stage || '') + '"></div><div><label class="note">Datum získání kontaktu</label><input id="gmc-acq" type="date" class="gm-in" style="width:100%" value="' + esc(c.acquired_at ? String(c.acquired_at).slice(0, 10) : '') + '"></div><div><label class="note">ID v původním systému</label><input id="gmc-ext" class="gm-in" style="width:100%" value="' + esc(c.ext_id || '') + '"></div><div><label class="note">Jazyk e-mailů</label><select id="gmc-lang" class="gm-in" style="width:100%"><option value="">(podle kampaně)</option>' + Object.keys(LANG).map(function (k) { return '<option value="' + k + '"' + (c.lang === k ? ' selected' : '') + '>' + LANG[k] + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="note">Štítky (oddělené čárkou)</label><input id="gmc-tags" class="gm-in" style="width:100%" value="' + esc(c.tags || '') + '"></div>' +
      (c.id ? '<div><label class="note">Stav</label><select id="gmc-status" class="gm-in" style="width:100%">' + Object.keys(CSTATUS).map(function (k) { return '<option value="' + k + '"' + (c.status === k ? ' selected' : '') + '>' + CSTATUS[k] + '</option>'; }).join('') + '</select></div>' : '') + '</div>' +
      '<div style="margin-top:12px"><label class="note">Vlastní pole (jedno na řádek: <code>název: hodnota</code>)</label><textarea id="gmc-extra" class="gm-in" style="min-height:90px">' + esc(Object.keys(ex).map(function (k) { return k + ': ' + ex[k]; }).join('\n')) + '</textarea></div>' +
      '<p id="gmc-err" class="note" style="color:#f87171"></p><div class="gm-btns"><button class="btn on" id="gmc-save">Uložit</button><button class="btn" id="gmc-x">Zrušit</button></div></div>');
    d.querySelector('#gmc-x').onclick = closeDlg;
    d.querySelector('#gmc-save').onclick = function () {
      var extra = {}; d.querySelector('#gmc-extra').value.split('\n').forEach(function (l) { var i = l.indexOf(':'); if (i > 0) { var k = l.slice(0, i).trim(), v = l.slice(i + 1).trim(); if (k && v) extra[k] = v; } });
      var body = { email: d.querySelector('#gmc-email').value, phone: d.querySelector('#gmc-phone').value, first_name: d.querySelector('#gmc-fn').value, last_name: d.querySelector('#gmc-ln').value, company: d.querySelector('#gmc-co').value, country: d.querySelector('#gmc-country').value, kind: d.querySelector('#gmc-kind').value, stage: d.querySelector('#gmc-stage').value, acquired_at: d.querySelector('#gmc-acq').value, ext_id: d.querySelector('#gmc-ext').value, lang: d.querySelector('#gmc-lang').value, tags: d.querySelector('#gmc-tags').value, extra: extra };
      if (c.id) body.status = d.querySelector('#gmc-status').value;
      api(c.id ? 'PUT' : 'POST', '/contacts' + (c.id ? '/' + c.id : ''), body).then(function () { closeDlg(); loadContacts(); }).catch(function (e) { d.querySelector('#gmc-err').textContent = e.message; });
    };
  }

  // ── Import CSV ────────────────────────────────────────────────
  function decodeBuf(buf) {
    var u = new Uint8Array(buf), txt;
    try { txt = new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { txt = new TextDecoder('windows-1250').decode(u); }
    return txt.replace(/^﻿/, '');
  }
  function parseCSV(text) {
    var first = text.slice(0, 2000).split(/\r?\n/)[0] || '';
    var delims = [';', ',', '\t', '|'], best = ';', bc = -1;
    delims.forEach(function (d) { var n = first.split(d).length; if (n > bc) { bc = n; best = d; } });
    var rows = [], row = [], cur = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === best) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row); row = []; }
      else cur += ch;
    }
    row.push(cur); if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row);
    return rows;
  }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  var FIELDS = [['', '— ignorovat —'], ['email', 'E-mail'], ['first_name', 'Jméno'], ['last_name', 'Příjmení'], ['full_name', 'Celé jméno (rozdělí se)'], ['company', 'Firma'], ['phone', 'Telefon'], ['country', 'Země'], ['kind', 'Typ kontaktu'], ['stage', 'Stav (z CRM)'], ['acquired', 'Datum získání kontaktu'], ['ext_id', 'ID v původním systému'], ['lang', 'Jazyk (cs, en, pl…)'], ['tags', 'Štítky'], ['extra', 'Vlastní pole (uloží se pod názvem sloupce)']];
  function guessField(h) {
    var n = norm(h);
    if (/^(e ?mail|email|mail|e mailova adresa|emailova adresa|email address)$/.test(n) || /\be ?mail\b/.test(n)) return 'email';
    if (/^(jmeno|first name|firstname|krestni jmeno|given name)$/.test(n)) return 'first_name';
    if (/^(prijmeni|prijimeni|last name|lastname|surname|family name)$/.test(n)) return 'last_name';
    if (/^(stav|stav kontaktu|stav pripadu|status|stage)$/.test(n)) return 'stage';
    if (/^(typ kontaktu|typ|druh kontaktu|kind|type)$/.test(n)) return 'kind';
    if (/^(zeme|stat|country)$/.test(n)) return 'country';
    if (/^(datum ziskani kontaktu|datum ziskani|datum vzniku|datum zalozeni|created|date)$/.test(n)) return 'acquired';
    if (/^(id|ext id|id kontaktu|id v crm|crm id)$/.test(n)) return 'ext_id';
    if (/^(jmeno a prijmeni|cele jmeno|full name|name|nazev kontaktu|kontakt)$/.test(n)) return 'full_name';
    if (/^(firma|spolecnost|company|organizace|organization|nazev firmy|obchodni jmeno)$/.test(n)) return 'company';
    if (/^(telefon|phone|mobil|tel|mobile|cislo)$/.test(n) || /telefon|phone|mobil/.test(n)) return 'phone';
    if (/^(jazyk|lang|language|locale)$/.test(n)) return 'lang';
    if (/^(stitky|tags|tag|skupina|group|segment|kategorie)$/.test(n)) return 'tags';
    return 'extra';
  }
  function importDlg() {
    var data = null;
    var d = openDlg('<h3>Import kontaktů z CSV</h3><p class="note" style="margin:4px 0 12px">Exportuj seznam z původního systému do CSV (Excel: Uložit jako → CSV). Oddělovač a kódování (UTF-8 / Windows-1250) se rozpozná samo. První řádek musí obsahovat názvy sloupců.</p>' +
      '<div id="gmi-body"><input type="file" id="gmi-file" accept=".csv,.txt,.tsv" class="gm-in"><div class="note" style="margin:10px 0 4px">…nebo vlož text:</div><textarea id="gmi-text" class="gm-in" style="min-height:110px" placeholder="email;jmeno;firma&#10;jan@firma.cz;Jan;Firma s.r.o."></textarea><div class="gm-btns" style="margin-top:10px"><button class="btn on" id="gmi-next">Pokračovat →</button><button class="btn" id="gmi-x">Zrušit</button></div></div>');
    d.querySelector('#gmi-x').onclick = closeDlg;
    d.querySelector('#gmi-file').onchange = function () { var f = this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { d.querySelector('#gmi-text').value = decodeBuf(r.result); }; r.readAsArrayBuffer(f); };
    d.querySelector('#gmi-next').onclick = function () {
      var rows = parseCSV(d.querySelector('#gmi-text').value); if (rows.length < 2) { alert('V datech musí být hlavička a alespoň jeden řádek.'); return; }
      data = { head: rows[0].map(function (x) { return String(x).trim(); }), rows: rows.slice(1) }; mapStep(d, data);
    };
  }
  function mapStep(d, data) {
    var guess = data.head.map(guessField);
    var hasEmail = guess.indexOf('email') >= 0;
    if (!hasEmail) { data.head.forEach(function (h, i) { if (guess[i] === 'extra' && data.rows.slice(0, 20).some(function (r) { return /@/.test(r[i] || ''); })) { guess[i] = 'email'; hasEmail = true; } }); }
    var body = '<div id="gmi-body"><p class="note" style="margin:0 0 8px">Načteno <b>' + data.rows.length + '</b> řádků a <b>' + data.head.length + '</b> sloupců. Zkontroluj, do jakého pole se který sloupec uloží.</p>' +
      '<div style="overflow:auto;max-height:46vh"><table class="gm-map" style="width:100%;border-collapse:collapse"><thead><tr><th>Sloupec v souboru</th><th>Ukázka</th><th>Uložit do</th></tr></thead><tbody>' +
      data.head.map(function (h, i) { return '<tr><td><b>' + esc(h || '(bez názvu)') + '</b></td><td class="pv">' + esc(data.rows.slice(0, 3).map(function (r) { return r[i] || ''; }).filter(Boolean).join(' · ')) + '</td><td><select class="gm-in" data-col="' + i + '">' + FIELDS.map(function (f) { return '<option value="' + f[0] + '"' + (guess[i] === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div id="gmi-info" style="margin-top:12px"></div><div id="gmi-excl"></div>' +
      '<div class="gm-2" style="margin-top:12px"><div><label class="note">Přidat štítek všem importovaným</label><input id="gmi-tag" class="gm-in" style="width:100%" placeholder="např. import-2026-11"></div><div><label class="note">Když e-mail už v seznamu je</label><select id="gmi-mode" class="gm-in" style="width:100%"><option value="upsert">Doplnit chybějící údaje</option><option value="skip">Přeskočit</option></select></div></div>' +
      '<p id="gmi-err" class="note" style="color:#f87171"></p><div class="gm-btns"><button class="btn on" id="gmi-go">Importovat ' + data.rows.length + ' řádků</button><button class="btn" id="gmi-back">← Zpět</button></div><div id="gmi-prog" class="note" style="margin-top:10px"></div></div>';
    d.querySelector('#gmi-body').outerHTML = body;
    d.querySelector('#gmi-back').onclick = function () { closeDlg(); importDlg(); };
    var EXCL_RE = /nem[aá]\s*z[aá]jem|nelze\s*pou[zž]|nechce|odhl[aá]|spam|storn|nekontakt/i;
    function colOf(f) { var i = -1; [].forEach.call(d.querySelectorAll('[data-col]'), function (sel) { if (sel.value === f && i < 0) i = +sel.getAttribute('data-col'); }); return i; }
    function refresh() {
      var ei = colOf('email'), info = d.querySelector('#gmi-info'), box = d.querySelector('#gmi-excl');
      if (ei >= 0) {
        var ok = 0, multi = 0, bad = 0, seen = {}, dup = 0;
        data.rows.forEach(function (r) { var parts = String(r[ei] || '').split(/[\s,;]+/).filter(function (x) { return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]{2,}$/.test(x); }); if (!parts.length) { bad++; return; } ok++; if (parts.length > 1) multi++; var k = parts[0].toLowerCase(); if (seen[k]) dup++; else seen[k] = 1; });
        info.innerHTML = '<div class="gm-warn" style="background:rgba(124,92,255,.1);border-color:rgba(124,92,255,.35);color:#c9bdff">Použitelný e-mail má <b>' + ok + '</b> z ' + data.rows.length + ' řádků. Bez platné adresy: <b>' + bad + '</b> (přeskočí se). Různých adres: <b>' + Object.keys(seen).length + '</b> (duplicity <b>' + dup + '</b> se sloučí). Buněk s více adresami: <b>' + multi + '</b> — použije se první, ostatní se uloží do pole „Další e-maily“.</div>';
      } else info.innerHTML = '';
      var si = colOf('stage'), cnt = {};
      if (si >= 0) data.rows.forEach(function (r) { var v = String(r[si] || '').trim(); if (v) cnt[v] = (cnt[v] || 0) + 1; });
      var keys = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
      var prev = {}; [].forEach.call(box.querySelectorAll('[data-ex]'), function (cb) { prev[cb.value] = cb.checked; });
      box.innerHTML = keys.length ? '<div style="margin-top:12px"><label class="note">Kontakty v těchto stavech CRM se naimportují jako <b>vyřazené (nezasílat)</b> — do kampaní se nezahrnou:</label><div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:6px">' + keys.map(function (k) { var on = prev[k] != null ? prev[k] : EXCL_RE.test(k); return '<label style="font-size:13px"><input type="checkbox" data-ex value="' + esc(k) + '"' + (on ? ' checked' : '') + '> ' + esc(k) + ' <span class="note">(' + cnt[k] + ')</span></label>'; }).join('') + '</div></div>' : '';
    }
    [].forEach.call(d.querySelectorAll('[data-col]'), function (sel) { sel.addEventListener('change', refresh); });
    refresh();
    d.querySelector('#gmi-go').onclick = function () {
      var map = data.head.map(function (h, i) { return d.querySelector('[data-col="' + i + '"]').value; });
      if (map.indexOf('email') < 0) { d.querySelector('#gmi-err').textContent = 'Vyber sloupec s e-mailem.'; return; }
      var recs = data.rows.map(function (r) {
        var o = { extra: {} };
        map.forEach(function (f, i) {
          var v = String(r[i] == null ? '' : r[i]).trim(); if (!v || !f) return;
          if (f === 'extra') o.extra[data.head[i] || ('sloupec_' + (i + 1))] = v;
          else if (f === 'full_name') { var p = v.split(/\s+/); o.first_name = o.first_name || p.shift(); o.last_name = o.last_name || p.join(' '); }
          else o[f] = o[f] ? o[f] + (f === 'tags' ? ',' : ' ') + v : v;
        });
        return o;
      });
      var exStages = [].filter.call(d.querySelectorAll('[data-ex]'), function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
      var tag = d.querySelector('#gmi-tag').value.trim(), mode = d.querySelector('#gmi-mode').value, tot = { created: 0, updated: 0, skipped: 0, invalid: 0, blocked: 0, excluded: 0, multi: 0 }, i = 0, src = 'import ' + new Date().toLocaleDateString('cs-CZ');
      d.querySelector('#gmi-go').disabled = true; d.querySelector('#gmi-back').disabled = true;
      (function chunk() {
        if (i >= recs.length) {
          d.querySelector('#gmi-prog').innerHTML = '<div class="gm-warn" style="background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.4);color:#4ade80">Hotovo: nových <b>' + tot.created + '</b>, sloučeno s existujícími <b>' + tot.updated + '</b>, přeskočeno <b>' + tot.skipped + '</b>, bez platného e-mailu <b>' + tot.invalid + '</b>, vyřazeno (nezasílat) <b>' + tot.excluded + '</b>' + (tot.blocked ? ', z toho <b>' + tot.blocked + '</b> už dříve odhlášených (vloženo jako odhlášené)' : '') + '.</div><div class="gm-btns"><button class="btn on" id="gmi-done">Zavřít</button></div>';
          d.querySelector('#gmi-done').onclick = function () { closeDlg(); S.list.offset = 0; loadContacts(); }; return;
        }
        d.querySelector('#gmi-prog').textContent = 'Importuji… ' + i + ' / ' + recs.length;
        api('POST', '/contacts/import', { rows: recs.slice(i, i + 500), tag: tag, mode: mode, source: src, exclude_stages: exStages }).then(function (r) { Object.keys(tot).forEach(function (k) { tot[k] += r[k] || 0; }); i += 500; chunk(); })
          .catch(function (e) { d.querySelector('#gmi-prog').innerHTML = '<span style="color:#f87171">Chyba po ' + i + ' řádcích: ' + esc(e.message) + '</span>'; d.querySelector('#gmi-go').disabled = false; });
      })();
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  KAMPANĚ
  // ═══════════════════════════════════════════════════════════════
  var CAMP = { oneoff: { box: 'gm-oneoff', kinds: ['oneoff'] }, recurring: { box: 'gm-recurring', kinds: ['recurring', 'sequence'] } };
  function schedText(c) {
    if (c.kind === 'oneoff') return c.status === 'scheduled' ? 'odešle se ' + fdt(c.next_run_at) : (c.last_run_at ? 'odesláno ' + fdt(c.last_run_at) : 'ještě neodesláno');
    if (c.kind === 'sequence') return (Array.isArray(c.steps) ? c.steps.length : 0) + ' kroků: ' + (Array.isArray(c.steps) ? c.steps.map(function (s) { return 'den ' + s.day; }).join(', ') : '');
    var s = c.schedule || {}, h = String(s.hour == null ? 9 : s.hour) + ':00';
    return (s.freq === 'daily' ? 'každý den v ' + h : s.freq === 'monthly' ? 'každý ' + (s.dom || 1) + '. v měsíci v ' + h : DOW[s.dow || 1] + ' v ' + h) + (c.status === 'active' && c.next_run_at ? ' · příště ' + fdt(c.next_run_at) : '');
  }
  function audText(a) {
    a = a || {}; var p = []; if (a.contacts !== false) { var fl = [].concat(a.kinds || [], a.stages || [], a.countries || []); p.push('seznam kontaktů' + (a.tag ? ' (štítek: ' + a.tag + ')' : '') + (fl.length ? ' [' + fl.join(', ') + ']' : '')); } if (a.players) p.push('hráči hry' + (a.player_lang ? ' (' + a.player_lang + ')' : '')); return p.join(' + ') || '—';
  }
  // Podrobný popis publika pro kartu kampaně: seznam, typy, stavy CRM, země, jazyk hráčů
  function audDetail(a) {
    a = a || {}; var L = function (t, arr) { return '<div>' + t + ': <b>' + (arr && arr.length ? esc(arr.join(', ')) : 'všechny') + '</b></div>'; }, h = '';
    if (a.contacts !== false) h += '<div>Seznam: <b>Seznam kontaktů</b>' + (a.tag ? ' · štítek <b>' + esc(a.tag) + '</b>' : '') + '</div>' + L('Typ kontaktu', a.kinds) + L('Stav v CRM', a.stages) + L('Země', a.countries);
    if (a.players) h += '<div>Seznam: <b>Hráči hry</b> (jen s vyplněným e-mailem) · jazyk: <b>' + (a.player_lang ? esc(a.player_lang) : 'všechny') + '</b></div>';
    return h || '<div>—</div>';
  }
  function openCamps(which) {
    var cfg = CAMP[which], box = $(cfg.box); if (!box) return;
    if (!box.__init) {
      box.__init = true;
      var btns = which === 'oneoff' ? '<button class="btn on sm" data-new="oneoff">＋ Nový jednorázový e-mail</button>' : '<button class="btn on sm" data-new="recurring">＋ Opakovaná kampaň (podle rozvrhu)</button><button class="btn on sm" data-new="sequence">＋ Sekvence (série po přidání do seznamu)</button>';
      var help = which === 'oneoff' ? 'Jedna zpráva pro vybrané publikum — odešle se hned, nebo v naplánovaný čas. Každý příjemce dostane zprávu nejvýše jednou.' : '<b>Opakovaná kampaň</b> posílá stejnou zprávu podle rozvrhu (denně, týdně, měsíčně). <b>Sekvence</b> posílá sérii zpráv každému kontaktu v určených dnech od jeho přidání do seznamu (den 0 = hned, den 3, den 7 …).';
      box.innerHTML = '<div class="toolbar">' + btns + '<span style="flex:1"></span><span class="note" id="' + cfg.box + '-info"></span></div><p class="note" style="margin:0 0 12px">' + help + ' Odesílá se přes Amazon SES z adresy domény Laundromats; každá zpráva obsahuje odkaz pro odhlášení.</p><div id="' + cfg.box + '-list"></div>';
      [].forEach.call(box.querySelectorAll('[data-new]'), function (b) { b.onclick = function () { campDlg(null, b.getAttribute('data-new'), which); }; });
    }
    Promise.all([loadSenders(), api('GET', '/contacts/facets').then(function (f) { S.facets = f; }).catch(function () {}), api('GET', '/contacts?limit=1').then(function (j) { S.tags = j.tags || []; S.extraKeys = j.extra_keys || []; }).catch(function () {})]).then(function () { listCamps(which); });
  }
  function listCamps(which) {
    var cfg = CAMP[which], el = $(cfg.box + '-list');
    var info = S.senderInfo || {}; $(cfg.box + '-info').innerHTML = info.configured === false ? '<span style="color:#f87171">Amazon SES není nastaveno</span>' : (info.tracking ? '' : '<span style="color:#fbbf24">Měření otevření/prokliků je vypnuto (chybí SES_CONFIGURATION_SET)</span>');
    api('GET', '/campaigns').then(function (j) {
      var items = j.items.filter(function (c) { return cfg.kinds.indexOf(c.kind) >= 0; });
      if (!items.length) { el.innerHTML = '<p class="note" style="padding:24px;text-align:center">Zatím žádná kampaň.</p>'; return; }
      el.innerHTML = items.map(function (c) {
        var a = [];
        a.push('<button class="btn sm" data-a="edit" data-id="' + c.id + '">Upravit</button>');
        if (c.kind === 'oneoff') { if (c.status === 'draft') a.push('<button class="btn on sm" data-a="send" data-id="' + c.id + '">Odeslat…</button>'); if (c.status === 'scheduled') a.push('<button class="btn sm" data-a="unsched" data-id="' + c.id + '">Zrušit plán</button>'); }
        else { if (c.status === 'active') a.push('<button class="btn sm" data-a="pause" data-id="' + c.id + '">Pozastavit</button>'); else a.push('<button class="btn on sm" data-a="activate" data-id="' + c.id + '">Zapnout</button>'); }
        a.push('<button class="btn sm" data-a="test" data-id="' + c.id + '">Test na e-mail</button><button class="btn sm" data-a="stats" data-id="' + c.id + '">📊 Statistiky</button><button class="btn sm" data-a="dup" data-id="' + c.id + '">Duplikovat</button><button class="btn sm" data-a="del" data-id="' + c.id + '">Smazat</button>');
        return '<div class="gm-c" id="gmc-' + c.id + '"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h4>' + esc(c.name) + '</h4><span class="gm-st ' + c.status + '">' + esc(STATUS[c.status] || c.status) + '</span>' + (c.kind !== 'oneoff' ? '<span class="chip">' + (c.kind === 'sequence' ? 'sekvence' : 'opakovaná') + '</span>' : '') + '</div>' +
          '<div class="gm-aud" style="margin:8px 0 2px;padding:9px 12px;border:1px solid rgba(124,92,255,.35);border-radius:10px;background:rgba(124,92,255,.07);font-size:13px;line-height:1.55"><div style="font-size:15px">Příjemců: <b id="gma-' + c.id + '">…</b></div>' + audDetail(c.audience) + '</div>' + '<div class="gm-meta"><span>Předmět: <b>' + esc(c.subject || (c.steps && c.steps[0] && c.steps[0].subject) || '—') + '</b></span><span>Od: <b>' + esc(c.from_address || '— nevybráno —') + '</b></span><span>' + esc(schedText(c)) + '</span><span>Odesláno celkem: <b>' + (c.sent_count || 0) + '</b></span></div>' +
          (c.last_error ? '<div class="gm-warn">Poslední chyba: ' + esc(c.last_error) + '</div>' : '') + '<div class="gm-btns">' + a.join('') + '</div><div id="gms-' + c.id + '"></div></div>';
      }).join('');
      items.forEach(function (c) { api('POST', '/audience-count', { audience: c.audience }).then(function (n) { var e = $('gma-' + c.id); if (e) e.innerHTML = n.sendable + '</b> <span class="note">(kontaktů ' + n.contacts + ', hráčů ' + n.players + (n.suppressed ? '; vynecháno ' + n.suppressed + ' odhlášených / nedoručitelných' : '') + ')</span><b>'; }).catch(function () { var e = $('gma-' + c.id); if (e) e.textContent = '?'; }); });
      [].forEach.call(el.querySelectorAll('[data-a]'), function (b) { b.onclick = function () { campAction(b.getAttribute('data-a'), +b.getAttribute('data-id'), items, which); }; });
    }).catch(function (e) { err(el, e); });
  }
  function campAction(a, id, items, which) {
    var c = items.filter(function (x) { return x.id === id; })[0]; var done = function () { listCamps(which); }; var fail = function (e) { alert(e.message); };
    if (a === 'edit') return campDlg(c, c.kind, which);
    if (a === 'send') return sendDlg(c, which);
    if (a === 'unsched') return api('POST', '/campaigns/' + id + '/unschedule').then(done).catch(fail);
    if (a === 'pause') return api('POST', '/campaigns/' + id + '/pause').then(done).catch(fail);
    if (a === 'activate') {
      return api('POST', '/audience-count', { audience: c.audience }).then(function (n) {
        if (!confirm('Zapnout kampaň „' + c.name + '“? Aktuálně by oslovila ' + n.sendable + ' příjemců' + (c.kind === 'sequence' ? ' (první krok se odešle hned po zapnutí, další podle dnů)' : '') + '.')) return;
        return api('POST', '/campaigns/' + id + '/activate').then(function () { setTimeout(done, 400); });
      }).catch(fail);
    }
    if (a === 'test') { var to = prompt('Na jakou adresu poslat zkušební e-mail?', ''); if (!to) return; return api('POST', '/campaigns/' + id + '/test', { to: to }).then(function () { alert('Zkušební e-mail odeslán na ' + to + '.'); }).catch(fail); }
    if (a === 'del') { if (!confirm('Smazat kampaň „' + c.name + '“ i s evidencí odeslání?')) return; return api('DELETE', '/campaigns/' + id).then(done).catch(fail); }
    if (a === 'dup') { var cp = JSON.parse(JSON.stringify(c)); delete cp.id; cp.name = c.name + ' (kopie)'; return api('POST', '/campaigns', cp).then(done).catch(fail); }
    if (a === 'stats') {
      var el = $('gms-' + id); if (el.innerHTML) { el.innerHTML = ''; return; } el.innerHTML = '<p class="note">Načítám…</p>';
      return api('GET', '/campaigns/' + id + '/stats').then(function (s) {
        var cell = function (v, l) { return '<div><b>' + (v == null ? '—' : v) + '</b><span>' + l + '</span></div>'; };
        el.innerHTML = '<div class="gm-stats">' + cell(s.sent, 'Odesláno') + cell(s.delivered, 'Doručeno') + cell(s.opened + (s.open_rate != null ? ' (' + s.open_rate + ' %)' : ''), 'Otevřeno') + cell(s.clicked + (s.click_rate != null ? ' (' + s.click_rate + ' %)' : ''), 'Prokliknuto') + cell(s.bounced, 'Nedoručeno') + cell(s.unsubscribed, 'Odhlášeno') + cell(s.errors, 'Chyb při odeslání') + '</div>' +
          (s.tracking ? '' : '<p class="note">Otevření a prokliky se neměří — v HolyOS chybí SES_CONFIGURATION_SET.</p>') + (s.last_errors && s.last_errors.length ? '<p class="note" style="color:#f87171">' + s.last_errors.map(function (x) { return esc(x.email_lower + ': ' + x.error); }).join('<br>') + '</p>' : '');
      }).catch(function (e) { err(el, e); });
    }
  }

  function sendDlg(c, which) {
    var d = openDlg('<h3>Odeslat „' + esc(c.name) + '“</h3><div id="gms-body"><p class="note">Počítám příjemce…</p></div>');
    api('POST', '/audience-count', { audience: c.audience }).then(function (n) {
      var b = d.querySelector('#gms-body');
      var soon = new Date(Date.now() + 3600000); var loc = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      b.innerHTML = '<p>Zprávu dostane <b>' + n.sendable + '</b> příjemců' + (n.suppressed ? ' <span class="note">(' + n.suppressed + ' vynecháno — odhlášení / nedoručitelní)</span>' : '') + '. Odesílatel: <b>' + esc(c.from_address || '—') + '</b>.</p>' +
        '<label style="display:block;margin:10px 0"><input type="radio" name="gms-m" value="now" checked> Odeslat hned</label><label style="display:block;margin:10px 0"><input type="radio" name="gms-m" value="schedule"> Naplánovat na <input type="datetime-local" id="gms-at" class="gm-in" value="' + loc + '"></label>' +
        '<p id="gms-err" class="note" style="color:#f87171"></p><div class="gm-btns"><button class="btn on" id="gms-go"' + (n.sendable ? '' : ' disabled') + '>Odeslat</button><button class="btn" id="gms-x">Zrušit</button></div>';
      b.querySelector('#gms-x').onclick = closeDlg;
      b.querySelector('#gms-go').onclick = function () {
        var m = b.querySelector('[name=gms-m]:checked').value, body = { mode: m };
        if (m === 'schedule') body.at = new Date(b.querySelector('#gms-at').value).toISOString();
        else if (!confirm('Opravdu odeslat ' + n.sendable + ' e-mailů teď?')) return;
        b.querySelector('#gms-go').disabled = true;
        api('POST', '/campaigns/' + c.id + '/send', body).then(function () { closeDlg(); setTimeout(function () { listCamps(which); }, 1500); }).catch(function (e) { b.querySelector('#gms-err').textContent = e.message; b.querySelector('#gms-go').disabled = false; });
      };
    }).catch(function (e) { err(d.querySelector('#gms-body'), e); });
  }

  var lastTa = null;
  function campDlg(c, kind, which) {
    var isNew = !c; c = c || { kind: kind, name: '', subject: '', body: '', lang: 'cs', audience: { contacts: true, tag: '', players: false, player_lang: '' }, schedule: kind === 'recurring' ? { freq: 'weekly', dow: 1, hour: 9, dom: 1 } : {}, steps: kind === 'sequence' ? [{ day: 0, subject: '', body: '' }] : undefined };
    var a = c.audience || {}, s = c.schedule || {}, steps = JSON.parse(JSON.stringify(c.steps || []));
    var title = (isNew ? 'Nová ' : 'Úprava: ') + { oneoff: 'jednorázová kampaň', recurring: 'opakovaná kampaň', sequence: 'sekvence' }[kind];
    var wantFrom = c.from_address || (S.senderInfo && S.senderInfo.default) || '';
    if (!wantFrom && isNew) { var lm = S.senders.filter(function (x) { return /laundromats/i.test(x.domain); })[0]; if (lm) wantFrom = lm.address; }
    var senderHtml = S.senders.length ? '<select id="gme-from" class="gm-in" style="width:100%"><option value="">— vyber odesílatele —</option>' + S.senders.map(function (x) { return '<option value="' + esc(x.address) + '"' + (x.address === wantFrom ? ' selected' : '') + '>' + esc(x.address) + '</option>'; }).join('') + '</select>' : '<input id="gme-from" class="gm-in" style="width:100%" placeholder="info@laundromats.eu" value="' + esc(c.from_address || '') + '">';
    var warn = !S.senders.length ? '<div class="gm-warn">V HolyOS nejsou nastavení žádní odesílatelé Amazon SES. Adresu z domény Laundromats přidej v HolyOS → Nastavení → odesílatelé SES (doména musí být ověřená v SES), jinak se e-maily neodešlou.</div>' : (!S.senders.some(function (x) { return /laundromats/i.test(x.domain); }) ? '<div class="gm-warn">Mezi odesílateli SES není žádná adresa z domény Laundromats — přidej ji v HolyOS → Nastavení → odesílatelé SES (a ověř doménu v AWS SES).</div>' : '');
    var phs = ['osloveni', 'jmeno', 'prijmeni', 'firma', 'email', 'telefon'].concat(S.extraKeys.map(function (k) { return k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }).filter(function (k) { return k && ['jmeno', 'prijmeni', 'firma', 'email', 'telefon'].indexOf(k) < 0; }));
    var phHtml = '<div class="gm-ph"><span class="note">Vložit proměnnou:</span>' + phs.map(function (p) { return '<button type="button" data-ph="' + esc(p) + '">{{' + esc(p) + '}}</button>'; }).join('') + '<button type="button" data-ins="[[tlacitko]]" title="Vloží tlačítko s odkazem do textu na kurzor (dole zůstane tlačítko vždy)">🔘 tlačítko</button></div>';
    var tagOpts = '<option value="">všechny kontakty</option>' + S.tags.map(function (t) { return '<option value="' + esc(t) + '"' + (a.tag === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    var schedHtml = kind === 'recurring' ? '<div class="gm-row"><label>Rozvrh</label><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="gme-freq" class="gm-in"><option value="daily">každý den</option><option value="weekly">každý týden</option><option value="monthly">každý měsíc</option></select><span id="gme-dowbox">v <select id="gme-dow" class="gm-in">' + ['pondělí', 'úterý', 'středu', 'čtvrtek', 'pátek', 'sobotu', 'neděli'].map(function (n, i) { return '<option value="' + (i + 1) + '">' + n + '</option>'; }).join('') + '</select></span><span id="gme-dombox">dne <select id="gme-dom" class="gm-in">' + Array.apply(null, Array(28)).map(function (_, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + '.</option>'; }).join('') + '</select></span> v <select id="gme-hour" class="gm-in">' + Array.apply(null, Array(24)).map(function (_, i) { return '<option value="' + i + '">' + i + ':00</option>'; }).join('') + '</select> <span class="note">(čas Praha)</span></div></div>' : '';
    var contentHtml = kind === 'sequence' ? '<div class="gm-row"><label>Kroky sekvence</label><div><div id="gme-steps"></div><button class="btn sm" id="gme-addstep" type="button">＋ Přidat krok</button><div class="note" style="margin-top:6px">Den 0 = ihned po zapnutí / po přidání kontaktu do seznamu, den 3 = o tři dny později. Nové kontakty začínají odpočet od svého přidání, stávající od zapnutí kampaně.</div></div></div>' :
      '<div class="gm-row"><label>Předmět *</label><input id="gme-subj" class="gm-in" style="width:100%" value="' + esc(c.subject || '') + '"></div><div class="gm-row"><label>Text zprávy *</label><div><textarea id="gme-body" class="gm-in">' + esc(c.body || '') + '</textarea>' + phHtml + '</div></div>';
    var aiHtml = '<div class="gm-row"><label>✨ AI návrh</label><div class="gm-ai"><textarea id="gme-brief" class="gm-in" placeholder="Zadání: o čem má e-mail být, komu, jaký tón a výzva k akci… (např. Pozvi zájemce o prádlomat, ať si zahrají Laundromat Tycoon a vyzkouší si podnikání nanečisto; tón přátelský, výzva Zahrát si)"></textarea><div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">' + (kind === 'sequence' ? '<span class="note">Počet kroků</span><input id="gme-aisteps" type="number" min="1" max="8" value="' + Math.max(1, steps.length || 3) + '" class="gm-in" style="width:70px">' : '') + '<button class="btn sm on" type="button" id="gme-aigo">✨ Vygenerovat</button><span id="gme-aires" class="note">Napíše předmět i text v jazyce šablony; současný text přepíše (Uložit až po kontrole).</span></div></div></div>';
    var d = openDlg('<h3>' + title + '</h3><div class="gm-split"><div id="gme-body-wrap">' + warn +
      '<div class="gm-row"><label>Název (interní) *</label><input id="gme-name" class="gm-in" style="width:100%" value="' + esc(c.name || '') + '"></div>' +
      '<div class="gm-row"><label>Odesílatel *</label><div class="gm-2"><div>' + senderHtml + '</div><input id="gme-fname" class="gm-in" placeholder="Jméno odesílatele (Laundromats)" value="' + esc(c.from_name || 'Laundromats') + '"></div></div>' +
      '<div class="gm-row"><label>Odpovědi na</label><div class="gm-2"><input id="gme-reply" class="gm-in" placeholder="Reply-To (volitelné)" value="' + esc(c.reply_to || '') + '"><select id="gme-lang" class="gm-in">' + Object.keys(LANG).map(function (k) { return '<option value="' + k + '"' + ((c.lang || 'cs') === k ? ' selected' : '') + '>Šablona: ' + LANG[k] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="gm-row"><label>Komu</label><div><label style="display:block;margin:2px 0"><input type="checkbox" id="gme-ac"' + (a.contacts !== false ? ' checked' : '') + '> Seznam kontaktů &nbsp;<select id="gme-atag" class="gm-in">' + tagOpts + '</select></label>' +
      '<label style="display:block;margin:8px 0 2px"><input type="checkbox" id="gme-ap"' + (a.players ? ' checked' : '') + '> Hráči hry (jen s vyplněným e-mailem) &nbsp;<select id="gme-apl" class="gm-in"><option value="">všechny jazyky</option>' + ['cs', 'en', 'pl', 'sk', 'de'].map(function (k) { return '<option value="' + k + '"' + (a.player_lang === k ? ' selected' : '') + '>' + LANG[k] + '</option>'; }).join('') + '</select></label>' +
      '<div id="gme-facets"></div>' +
      '<div style="margin-top:8px"><button class="btn sm" id="gme-count" type="button">Spočítat příjemce</button> <span id="gme-cnt" class="note"></span></div></div></div>' +
      schedHtml + aiHtml + contentHtml +
      '<div class="gm-row"><label>Tlačítko v e-mailu</label><div><div class="gm-2"><input id="gme-link" class="gm-in" placeholder="https://… (volitelné)" value="' + esc(c.link || '') + '"><input id="gme-ll" class="gm-in" placeholder="Popisek tlačítka" value="' + esc(c.link_label || '') + '"></div><div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap"><button class="btn sm" type="button" id="gme-game">🎮 Odkaz na hru</button><label class="note" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="gme-top"' + (/\[\[\s*tlacitko\s*\]\]/i.test(c.body || '') ? ' checked' : '') + '> Tlačítko i nahoře (po úvodním odstavci)</label><span class="note">Odkaz na hru dostane u každého příjemce značku kampaně — v detailu hráče pak uvidíš v „Odkud přišel“ <b>email / gm-č. kampaně / k-č. kontaktu</b>.</span></div></div></div>' +
      '<div class="gm-row"><label>Obrázek v e-mailu</label><div><div class="gm-img"><input type="file" id="gme-imgf" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none"><button class="btn sm" type="button" id="gme-imgb">🖼 Nahrát obrázek</button><input id="gme-img" class="gm-in" style="flex:1;min-width:220px" placeholder="nebo adresa obrázku https://…" value="' + esc(c.image_url || '') + '"><span id="gme-imgt"></span></div><div class="note" style="margin-top:4px">Zobrazí se pod textem (šířka e-mailu ~500 px, ideálně 1000 px široký). Když je vyplněné tlačítko, obrázek na něj také prokliká.</div></div></div>' +
      '<div class="gm-row"><label>Testovací e-mail</label><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input id="gme-tto" class="gm-in" style="flex:1;min-width:220px" placeholder="kam poslat test (prázdné = tvůj e-mail z HolyOS)"><button class="btn sm" type="button" id="gme-tbtn">✉ Poslat test</button><span id="gme-tres" class="note"></span></div></div>' +
      '<p id="gme-err" class="note" style="color:#f87171"></p><div class="gm-btns"><button class="btn on" id="gme-save">Uložit</button><button class="btn" id="gme-x">Zavřít</button></div></div>' +
      '<div class="gm-pv"><div class="gm-pvh"><span>Náhled · <b id="gme-pvs">—</b></span><span id="gme-pvf"></span></div><div class="gm-pvh" style="border-top:1px solid var(--border,#2a344d)"><span>Jazyk příjemce <select id="gme-pvl" class="gm-in" style="padding:3px 6px"><option value="">jako šablona</option>' + Object.keys(LANG).map(function (k) { return '<option value="' + k + '">' + LANG[k] + '</option>'; }).join('') + '</select></span><span id="gme-pvt" class="note">Každý dostane e-mail v jazyce své země (překlad AI).</span></div><iframe id="gme-pvi" title="Náhled e-mailu"></iframe></div></div>', { wide: true, onClose: function () { listCamps(which); } });
    var q = function (id) { return d.querySelector('#' + id); };
    if (kind === 'recurring') { q('gme-freq').value = s.freq || 'weekly'; q('gme-dow').value = s.dow || 1; q('gme-dom').value = s.dom || 1; q('gme-hour').value = s.hour == null ? 9 : s.hour; var vis = function () { q('gme-dowbox').style.display = q('gme-freq').value === 'weekly' ? '' : 'none'; q('gme-dombox').style.display = q('gme-freq').value === 'monthly' ? '' : 'none'; }; q('gme-freq').onchange = vis; vis(); }
    d.addEventListener('focusin', function (e) { if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.id === 'gme-subj')) lastTa = e.target; });
    d.addEventListener('click', function (e) { var ins = e.target.getAttribute && e.target.getAttribute('data-ins'); if (ins) { var ta0 = lastTa && d.contains(lastTa) ? lastTa : (q('gme-body') || null); if (!ta0) return; var p0 = ta0.selectionStart == null ? ta0.value.length : ta0.selectionStart; var pre = p0 > 0 && ta0.value.charAt(p0 - 1) !== '\n' ? '\n\n' : ''; ta0.value = ta0.value.slice(0, p0) + pre + ins + '\n\n' + ta0.value.slice(ta0.selectionEnd == null ? p0 : ta0.selectionEnd); ta0.focus(); ta0.selectionStart = ta0.selectionEnd = p0 + pre.length + ins.length + 2; return; } var p = e.target.getAttribute && e.target.getAttribute('data-ph'); if (!p) return; var ta = lastTa && d.contains(lastTa) ? lastTa : (q('gme-body') || null); if (!ta) return; var pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart; ta.value = ta.value.slice(0, pos) + '{{' + p + '}}' + ta.value.slice(ta.selectionEnd == null ? pos : ta.selectionEnd); ta.focus(); ta.selectionStart = ta.selectionEnd = pos + p.length + 4; });
    function renderSteps() {
      var el = q('gme-steps'); if (!el) return;
      el.innerHTML = steps.map(function (st, i) {
        return '<div class="gm-step"><div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><b>Krok ' + (i + 1) + '</b><span class="note">odešle se ve dni</span><input type="number" min="0" class="gm-in" style="width:80px" data-sf="day" data-i="' + i + '" value="' + st.day + '"><span style="flex:1"></span>' + (steps.length > 1 ? '<button class="btn sm" data-rm="' + i + '" type="button">Odebrat</button>' : '') + '</div>' +
          '<input class="gm-in" style="width:100%;margin-bottom:8px" placeholder="Předmět" data-sf="subject" data-i="' + i + '" value="' + esc(st.subject) + '"><textarea class="gm-in" style="min-height:130px" placeholder="Text zprávy" data-sf="body" data-i="' + i + '">' + esc(st.body) + '</textarea></div>';
      }).join('') + phHtml;
      [].forEach.call(el.querySelectorAll('[data-sf]'), function (inp) { inp.oninput = function () { var i = +inp.getAttribute('data-i'), f = inp.getAttribute('data-sf'); steps[i][f] = f === 'day' ? Math.max(0, parseInt(inp.value, 10) || 0) : inp.value; }; });
      [].forEach.call(el.querySelectorAll('[data-rm]'), function (b) { b.onclick = function () { steps.splice(+b.getAttribute('data-rm'), 1); renderSteps(); }; });
    }
    if (kind === 'sequence') { renderSteps(); q('gme-addstep').onclick = function () { var last = steps[steps.length - 1]; steps.push({ day: last ? last.day + 3 : 0, subject: '', body: '' }); renderSteps(); }; }
    var FACETS = [['kinds', 'kind', 'Typ kontaktu'], ['stages', 'stage', 'Stav v CRM'], ['countries', 'country', 'Země']];
    var picked = { kinds: (a.kinds || []).slice(), stages: (a.stages || []).slice(), countries: (a.countries || []).slice() };
    function drawFacets() {
      q('gme-facets').innerHTML = FACETS.map(function (f) {
        var list = (S.facets && S.facets[f[1]]) || []; if (!list.length) return '';
        return '<div style="margin-top:10px"><div class="note" style="margin-bottom:4px">' + f[2] + ' — vyber, komu poslat (nic nevybráno = všichni):</div><div style="display:flex;flex-wrap:wrap;gap:6px">' + list.map(function (o) { var on = picked[f[0]].indexOf(o.v) >= 0; return '<button type="button" class="btn sm' + (on ? ' on' : '') + '" data-f="' + f[0] + '" data-v="' + esc(o.v) + '">' + esc(o.v) + ' (' + o.n + ')</button>'; }).join('') + '</div></div>';
      }).join('');
      [].forEach.call(q('gme-facets').querySelectorAll('[data-f]'), function (b) { b.onclick = function () { var arr = picked[b.getAttribute('data-f')], v = b.getAttribute('data-v'), i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); drawFacets(); }; });
    }
    drawFacets();
    function audience() { return { contacts: q('gme-ac').checked, tag: q('gme-atag').value, kinds: picked.kinds, stages: picked.stages, countries: picked.countries, players: q('gme-ap').checked, player_lang: q('gme-apl').value }; }
    q('gme-count').onclick = function () { q('gme-cnt').textContent = 'Počítám…'; api('POST', '/audience-count', { audience: audience() }).then(function (n) { q('gme-cnt').innerHTML = '<b>' + n.sendable + '</b> příjemců' + (n.suppressed ? ' (vynecháno ' + n.suppressed + ' odhlášených / nedoručitelných)' : '') + ' — kontaktů ' + n.contacts + ', hráčů ' + n.players + (n.langs ? '<br>Jazyky: ' + Object.keys(n.langs).sort(function (x, y) { return n.langs[y] - n.langs[x]; }).map(function (k) { return (k === '?' ? 'neznámý → ' + (LANG[q('gme-lang').value] || q('gme-lang').value) : (LANG[k] || k)) + ' ' + n.langs[k]; }).join(', ') : ''); }).catch(function (e) { q('gme-cnt').textContent = e.message; }); };
    q('gme-x').onclick = function () { closeDlg(); listCamps(which); };
    function collect() {
      var body = { kind: kind, name: q('gme-name').value, from_address: q('gme-from').value, from_name: q('gme-fname').value, reply_to: q('gme-reply').value, lang: q('gme-lang').value, audience: audience(), link: q('gme-link').value, link_label: q('gme-ll').value, image_url: q('gme-img').value.trim() };
      if (kind === 'sequence') body.steps = steps; else { body.subject = q('gme-subj').value; body.body = q('gme-body').value; }
      if (kind === 'recurring') body.schedule = { freq: q('gme-freq').value, dow: +q('gme-dow').value, dom: +q('gme-dom').value, hour: +q('gme-hour').value };
      body.translations = trans;
      return body;
    }
    // ── živý náhled vpravo (volitelně v jazyce příjemce — překlad AI se uloží s kampaní) ──
    var trans = c.translations && typeof c.translations === 'object' ? c.translations : {}, viewLang = '';
    var pvT = null, pvStep = 0;
    function preview() {
      clearTimeout(pvT);
      pvT = setTimeout(function () {
        var b = collect(); b.step = pvStep; b.view_lang = viewLang;
        if (viewLang && viewLang !== q('gme-lang').value) q('gme-pvt').textContent = 'Překládám do jazyka ' + (LANG[viewLang] || viewLang) + '…';
        api('POST', '/preview', b).then(function (r) { if (!ovl || !d.isConnected) return; if (r.translations) trans = r.translations; q('gme-pvt').textContent = viewLang && viewLang !== q('gme-lang').value ? 'Překlad AI — uloží se s kampaní.' : 'Každý dostane e-mail v jazyce své země (překlad AI).'; q('gme-pvi').srcdoc = r.html; q('gme-pvs').textContent = r.subject || '(bez předmětu)'; q('gme-pvf').textContent = r.from || ''; }).catch(function (e) { q('gme-pvs').textContent = 'Náhled se nepodařil: ' + e.message; });
      }, 450);
    }
    // při psaní náhled přepne zpět na jazyk šablony (překlad by se dělal při každém písmenu)
    function backToBase() { if (viewLang) { viewLang = ''; q('gme-pvl').value = ''; } }
    d.addEventListener('input', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-i') != null) pvStep = +e.target.getAttribute('data-i') || 0; if (e.target.id !== 'gme-brief' && e.target.id !== 'gme-tto') { backToBase(); preview(); } });
    d.addEventListener('change', function (e) { if (e.target.id === 'gme-pvl') { viewLang = e.target.value; preview(); return; } if (e.target.id !== 'gme-tto') preview(); });
    d.addEventListener('click', function (e) { if (e.target.getAttribute && (e.target.getAttribute('data-ph') || e.target.getAttribute('data-ins') || e.target.getAttribute('data-rm') != null)) preview(); });
    preview();
    // ── obrázek ──
    function imgThumb() { var u = q('gme-img').value.trim(); q('gme-imgt').innerHTML = /^https:\/\//.test(u) ? '<img src="' + esc(u) + '" alt=""> <button class="btn sm" type="button" id="gme-imgx">Odebrat</button>' : ''; var x = q('gme-imgx'); if (x) x.onclick = function () { q('gme-img').value = ''; imgThumb(); preview(); }; }
    imgThumb(); q('gme-img').addEventListener('change', imgThumb);
    // ── tlačítko nahoře: vloží / odebere značku [[tlacitko]] za úvodní odstavec (první blok po oslovení) ──
    (function () {
      var cb = q('gme-top'); if (!cb) return;
      if (!q('gme-body')) { cb.parentNode.style.display = 'none'; return; }
      var RE = /\n*\[\[\s*tlacitko\s*\]\]\n*/gi;
      cb.onchange = function () {
        var ta = q('gme-body'), t = ta.value.replace(RE, '\n\n');
        if (cb.checked) {
          var blocks = t.replace(/^\s+|\s+$/g, '').split(/\n{2,}/), at = blocks.length > 2 ? 2 : blocks.length;
          if (/^(dobr|ahoj|vážen|hello|hi|dear)/i.test(blocks[0] || '') === false) at = Math.min(1, blocks.length);
          blocks.splice(at, 0, '[[tlacitko]]'); t = blocks.join('\n\n');
        } else t = t.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
        ta.value = t;
      };
    })();
    q('gme-imgb').onclick = function () { q('gme-imgf').click(); };
    q('gme-imgf').onchange = function () {
      var f = q('gme-imgf').files[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { alert('Obrázek je větší než 5 MB.'); return; }
      var rd = new FileReader(); q('gme-imgb').disabled = true; q('gme-imgb').textContent = 'Nahrávám…';
      rd.onload = function () { api('POST', '/image', { data: rd.result }).then(function (r) { q('gme-img').value = r.url; imgThumb(); preview(); }).catch(function (e) { alert(e.message); }).then(function () { q('gme-imgb').disabled = false; q('gme-imgb').textContent = '🖼 Nahrát obrázek'; q('gme-imgf').value = ''; }); };
      rd.readAsDataURL(f);
    };
    // ── test bez uložení ──
    try { q('gme-tto').value = localStorage.getItem('gm_test_to') || ''; } catch (e) { /* bez paměti */ }
    q('gme-game').onclick = function () {
      var g = (S.senderInfo && S.senderInfo.game_url) || 'https://pradlomaty.info/game';
      q('gme-link').value = g;
      if (!q('gme-ll').value.trim()) q('gme-ll').value = { cs: 'Zahrát si zdarma', sk: 'Zahrať si zadarmo', pl: 'Zagraj za darmo', de: 'Kostenlos spielen' }[q('gme-lang').value] || 'Play for free';
      preview();
    };
    q('gme-tbtn').onclick = function () {
      var b = collect(); b.to = q('gme-tto').value.trim(); b.view_lang = viewLang; try { if (b.to) localStorage.setItem('gm_test_to', b.to); } catch (e) { /* bez paměti */ }
      if (kind !== 'sequence' && !String(b.subject || '').trim()) { q('gme-tres').textContent = 'Vyplň předmět.'; return; }
      q('gme-tres').style.color = ''; q('gme-tres').textContent = 'Odesílám…';
      api('POST', '/test-draft', b).then(function (r) { if (r.translations) trans = r.translations; q('gme-tres').style.color = '#4ade80'; q('gme-tres').textContent = '✓ Test odeslán na ' + r.to + (viewLang ? ' (' + (LANG[viewLang] || viewLang) + ')' : '') + (kind === 'sequence' ? ' (1. krok)' : ''); }).catch(function (e) { q('gme-tres').style.color = '#f87171'; q('gme-tres').textContent = e.message; });
    };
    // ── AI návrh ──
    q('gme-aigo').onclick = function () {
      var brief = q('gme-brief').value.trim(); if (!brief) { q('gme-aires').textContent = 'Napiš zadání.'; return; }
      var cur = kind === 'sequence' ? null : { subject: q('gme-subj').value, body: q('gme-body').value };
      if (cur && (cur.subject || cur.body) && !confirm('AI přepíše současný předmět a text. Pokračovat?')) return;
      if (kind === 'sequence' && steps.some(function (s) { return s.subject || s.body; }) && !confirm('AI přepíše současné kroky sekvence. Pokračovat?')) return;
      q('gme-aigo').disabled = true; q('gme-aires').textContent = 'AI píše… (10–30 s)';
      api('POST', '/ai-draft', { brief: brief, lang: q('gme-lang').value, kind: kind, steps: kind === 'sequence' ? +q('gme-aisteps').value : 0, placeholders: phs, current: cur }).then(function (r) {
        if (kind === 'sequence') { if (r.steps && r.steps.length) { steps = r.steps; renderSteps(); } }
        else { q('gme-subj').value = r.subject || ''; q('gme-body').value = r.body || ''; if (r.link_label && !q('gme-ll').value) q('gme-ll').value = r.link_label; }
        q('gme-aires').textContent = '✓ Hotovo — zkontroluj text a pak Ulož.'; preview();
      }).catch(function (e) { q('gme-aires').textContent = e.message; }).then(function () { q('gme-aigo').disabled = false; });
    };
    q('gme-save').onclick = function () {
      var body = collect();
      if (kind === 'sequence' && !steps.length) { q('gme-err').textContent = 'Přidej alespoň jeden krok.'; return; }
      if (kind !== 'sequence' && !body.subject.trim()) { q('gme-err').textContent = 'Vyplň předmět.'; return; }
      api(isNew ? 'POST' : 'PUT', '/campaigns' + (isNew ? '' : '/' + c.id), body).then(function () { closeDlg(); listCamps(which); }).catch(function (e) { q('gme-err').textContent = e.message; });
    };
  }

  window.GMail = { open: function (w) { if (w === 'list') openList(); else openCamps(w); } };
})();
