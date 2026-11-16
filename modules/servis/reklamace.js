// HolyOS — Servis → Reklamace praní
// Žádosti z pradlomaty.info/podpora: o vrácení platby (refund) a o zaslání dokladu (receipt).
// Seznam s filtry (js/column-filters.js), detail se stavem, historií a akcemi, nastavení notifikací.
(function () {
  'use strict';
  var API = '/api/wash-complaints';
  var KIND = 'refund', ROWS = [], TBL = null, loaded = false;
  var ST = { new: ['Nová', '#f59e0b'], approved: ['Schváleno', '#3b82f6'], awaiting_payment: ['Čeká na platbu', '#a855f7'], done: ['Vyřízeno', '#22c55e'], rejected: ['Zrušeno', '#ef4444'] };
  var OPEN = ['new', 'approved', 'awaiting_payment'];
  var stLabel = function (r) { if (r.status === 'done') return r.kind === 'refund' ? 'Zaplaceno' : 'Doklad odeslán'; return (ST[r.status] || [r.status])[0]; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var kc = function (n) { return Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč'; };
  var dt = function (d) { return d ? new Date(d).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
  function api(path, opts) {
    return fetch(API + path, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('Chyba ' + r.status)); return j; }); });
  }
  var $ = function (id) { return document.getElementById(id); };
  var badge = function (r) { var c = (ST[r.status] || ['', '#94a3b8'])[1]; return '<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:' + c + '22;color:' + c + ';border:1px solid ' + c + '66;white-space:nowrap">' + esc(stLabel(r)) + '</span>'; };

  function shell() {
    var box = $('rp-root'); if (!box || box.__s) return; box.__s = 1;
    box.innerHTML = '<div style="margin:0 0 14px;background:linear-gradient(135deg,rgba(34,197,94,.08),rgba(34,211,238,.04));border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:12px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
      + '<div style="font-size:22px">🧺</div><div style="flex:1;min-width:240px"><div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Veřejný formulář pro zákazníky</div>'
      + '<div style="font-size:14px;font-weight:600"><span style="font-family:Consolas,monospace;color:#22d3ee">https://pradlomaty.info/podpora</span></div>'
      + '<div style="font-size:11px;color:var(--text2);margin-top:3px">Žádosti se sem zapíšou samy; nová žádost pošle upozornění do Velína.</div></div>'
      + '<button class="btn btn-sm btn-secondary" id="rp-copy">📋 Kopírovat</button><a class="btn btn-sm btn-secondary" href="https://pradlomaty.info/podpora" target="_blank" rel="noopener">↗ Otevřít</a>'
      + '<button class="btn btn-sm btn-secondary" id="rp-set">⚙️ Nastavení</button></div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">'
      + '<button class="btn" data-rpk="refund">💸 Žádosti o vrácení platby <span id="rp-n-refund"></span></button>'
      + '<button class="btn" data-rpk="receipt">🧾 Žádosti o zaslání dokladu <span id="rp-n-receipt"></span></button>'
      + '<span style="flex:1"></span><button class="btn btn-secondary btn-sm" id="rp-reload">↻ Obnovit</button></div>'
      + '<div id="rp-sum" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"></div>'
      + '<div id="rp-body" style="color:var(--text2)">Načítám…</div>';
    $('rp-copy').onclick = function () { var t = 'https://pradlomaty.info/podpora', b = this; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = '✅ Zkopírováno'; setTimeout(function () { b.textContent = '📋 Kopírovat'; }, 1500); }).catch(function () { prompt('Odkaz:', t); }); };
    $('rp-reload').onclick = load;
    $('rp-set').onclick = openSettings;
    box.querySelectorAll('[data-rpk]').forEach(function (b) { b.onclick = function () { KIND = b.getAttribute('data-rpk'); render(); }; });
  }

  var COLS = function () {
    var c = [
      { key: 'number', label: 'Číslo', type: 'text', ph: 'Číslo…', get: function (r) { return r.number; } },
      { key: 'created', label: 'Přijato', type: 'date', ph: 'dd.mm.rrrr', get: function (r) { return r.created_at; } },
      { key: 'stav', label: 'Stav', type: 'text', enum: true, ph: 'Vyber…', get: function (r) { return stLabel(r); } },
      { key: 'tx', label: 'Transakce', type: 'date', ph: 'dd.mm.rrrr', get: function (r) { return r.tx_at; } },
      { key: 'misto', label: 'Místo', type: 'text', ph: 'Místo…', get: function (r) { return r.place_label; } },
      { key: 'zak', label: 'Zákazník', type: 'text', ph: 'Jméno / e-mail…', get: function (r) { return r.customer_name + ' ' + r.email + ' ' + r.phone; } },
      { key: 'castka', label: 'Částka', type: 'num', get: function (r) { return Number(r.amount); } },
      { key: 'platba', label: 'Platba', type: 'text', enum: true, ph: 'Vyber…', get: function (r) { return r.pay_method; } },
      { key: 'sluzba', label: 'Služba', type: 'text', enum: true, ph: 'Vyber…', get: function (r) { return r.service; } },
    ];
    if (KIND === 'refund') c.push({ key: 'ucet', label: 'Účet', type: 'text', ph: 'Účet…', get: function (r) { return r.account || ''; } });
    if (KIND === 'receipt') c.push({ key: 'doklad', label: 'Doklad', type: 'text', ph: 'Doklad…', get: function (r) { return r.receipt_number || ''; } });
    return c;
  };
  function rowHtml(r) {
    var td = function (x, st) { return '<td style="padding:7px 8px;' + (st || '') + '">' + x + '</td>'; };
    return '<tr data-rpid="' + r.id + '" style="cursor:pointer">' + td('<b>' + esc(r.number) + '</b>') + td(esc(dt(r.created_at)), 'white-space:nowrap')
      + td(badge(r)) + td(esc(dt(r.tx_at)), 'white-space:nowrap') + td(esc(r.place_label)) + td('<b>' + esc(r.customer_name) + '</b><div style="font-size:11.5px;color:var(--text2)">' + esc(r.email) + ' · ' + esc(r.phone) + '</div>')
      + td('<b>' + kc(r.amount) + '</b>', 'white-space:nowrap;text-align:right') + td(esc(r.pay_method)) + td(esc(r.service))
      + (KIND === 'refund' ? td(esc(r.account || '—'), 'white-space:nowrap;font-family:Consolas,monospace;font-size:12px') : td(esc(r.receipt_number || '—'), 'white-space:nowrap'))
      + '</tr>';
  }
  function render() {
    var box = $('rp-body'); if (!box) return;
    document.querySelectorAll('[data-rpk]').forEach(function (b) { b.classList.toggle('btn-primary', b.getAttribute('data-rpk') === KIND); b.classList.toggle('btn-secondary', b.getAttribute('data-rpk') !== KIND); });
    ['refund', 'receipt'].forEach(function (k) { var n = ROWS.filter(function (r) { return r.kind === k && r.status === 'new'; }).length, e = $('rp-n-' + k); if (e) e.innerHTML = n ? '<span style="background:#f59e0b;color:#1a1200;border-radius:999px;padding:0 7px;font-size:11px;font-weight:800;margin-left:4px">' + n + '</span>' : ''; });
    var rows = ROWS.filter(function (r) { return r.kind === KIND; });
    var sum = function (f) { return rows.filter(f).reduce(function (s, r) { return s + Number(r.amount); }, 0); };
    var tile = function (l, v, sub, c) { return '<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ' + c + ';border-radius:10px;padding:8px 14px;min-width:170px"><div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.4px">' + l + '</div><div style="font-size:19px;font-weight:800">' + v + '</div><div style="font-size:11.5px;color:var(--text2)">' + sub + '</div></div>'; };
    var open = rows.filter(function (r) { return OPEN.indexOf(r.status) !== -1; });
    $('rp-sum').innerHTML = tile('K vyřízení', open.length, kc(sum(function (r) { return OPEN.indexOf(r.status) !== -1; })), '#f59e0b')
      + tile(KIND === 'refund' ? 'Zaplaceno' : 'Dokladů odesláno', rows.filter(function (r) { return r.status === 'done'; }).length, kc(sum(function (r) { return r.status === 'done'; })), '#22c55e')
      + tile('Zrušeno', rows.filter(function (r) { return r.status === 'rejected'; }).length, kc(sum(function (r) { return r.status === 'rejected'; })), '#ef4444')
      + tile('Celkem žádostí', rows.length, kc(sum(function () { return true; })), '#64748b');
    var cols = COLS();
    box.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:auto;padding:8px 0 0">'
      + '<table class="data-table" id="rp-table"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody></tbody></table></div>';
    if (window.ColFilters) {
      TBL = ColFilters.table({ table: '#rp-table', columns: cols, renderRow: rowHtml, noun: 'žádostí', emptyText: 'Zatím žádné žádosti.', limit: 1000 });
      TBL.setRows(rows);
    } else box.querySelector('tbody').innerHTML = rows.map(rowHtml).join('') || '<tr><td colspan="' + cols.length + '" style="padding:14px;color:var(--text2)">Zatím žádné žádosti.</td></tr>';
  }
  function load() {
    return api('/').then(function (j) { ROWS = j.rows || []; loaded = true; render(); })
      .catch(function (e) { var b = $('rp-body'); if (b) b.innerHTML = '<div style="color:#f87171">Nepodařilo se načíst: ' + esc(e.message) + '</div>'; });
  }

  // ─── Detail ────────────────────────────────────────────────────────────────
  function close() { var o = document.getElementById('rp-modal'); if (o) o.remove(); }
  function openDetail(id) {
    api('/' + id).then(function (r) {
      close();
      var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'rp-modal';
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      var kv = function (l, v) { return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)"><span style="width:170px;color:var(--text2);font-size:13px;flex:none">' + l + '</span><span style="font-size:13.5px">' + v + '</span></div>'; };
      var inp = 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text);font:inherit;font-size:13px';
      var hist = (Array.isArray(r.history) ? r.history.slice().reverse() : []).map(function (h) { return '<div style="font-size:12.5px;padding:4px 0;border-bottom:1px dashed var(--border)"><span style="color:var(--text2)">' + esc(dt(h.at)) + (h.who ? ' · ' + esc(h.who) : '') + '</span><br>' + esc(h.text) + '</div>'; }).join('');
      var act = '';
      if (r.status === 'new') act += '<button class="btn btn-primary" data-rpa="approved">' + (r.kind === 'refund' ? '✓ Schválit a vystavit dobropis' : '✓ Schválit') + '</button>';
      if (r.kind === 'refund' && r.status === 'approved' && !r.credit_note) act += '<button class="btn btn-primary" data-rpa="awaiting_payment">📄 Vystavit dobropis</button>';
      if (r.kind === 'refund' && (r.status === 'approved' || r.status === 'awaiting_payment')) act += '<button class="btn" style="background:#22c55e;color:#04130a" data-rpa="done" title="Normálně se přepne samo po spárování platby v bance">💸 Označit jako zaplaceno</button>';
      if (r.kind === 'receipt' && r.status !== 'rejected') act += '<a class="btn btn-secondary" href="' + API + '/' + r.id + '/receipt.pdf" target="_blank" rel="noopener">👁 Náhled dokladu</a><button class="btn" style="background:#22c55e;color:#04130a" data-rpa="send">🧾 ' + (r.receipt_sent_at ? 'Poslat doklad znovu' : 'Vystavit a poslat doklad') + '</button>';
      if (OPEN.indexOf(r.status) !== -1) act += '<button class="btn btn-secondary" style="color:#f87171" data-rpa="rejected">✕ Zrušit žádost</button>';
      if (r.status === 'rejected' || r.status === 'done') act += '<button class="btn btn-secondary" data-rpa="new">↺ Vrátit mezi nové</button>';
      ov.innerHTML = '<div class="modal" style="width:820px">'
        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><h2 style="margin:0;font-size:19px">' + (r.kind === 'refund' ? '💸 Vrácení platby' : '🧾 Zaslání dokladu') + ' ' + esc(r.number) + '</h2>' + badge(r) + '<span style="flex:1"></span>' + (r.credit_note ? '<a class="btn btn-secondary btn-sm" href="' + API + '/' + r.id + '/credit-note.pdf" target="_blank" rel="noopener" title="Otevřít dobropis (PDF)">📄 Dobropis ' + esc(r.credit_note.invoice_number) + ' ↗</a>' : '') + (r.kind === 'receipt' && r.receipt_number ? '<a class="btn btn-secondary btn-sm" href="' + API + '/' + r.id + '/receipt.pdf" target="_blank" rel="noopener" title="Otevřít doklad (PDF)">📄 Doklad ' + esc(r.receipt_number) + ' ↗</a>' : '') + '<button class="btn btn-secondary btn-sm" data-rpx>✕</button></div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px"><div>'
        + kv('Přijato', esc(dt(r.created_at))) + kv('Datum a čas transakce', '<b>' + esc(dt(r.tx_at)) + '</b>') + kv('Místo', esc(r.place_label) + (r.place_address ? '<div style="font-size:12px;color:var(--text2)">' + esc(r.place_address) + '</div>' : '') + (r.place_code ? '<div style="font-size:11px;color:var(--text2)">kód ' + esc(r.place_code) + '</div>' : ''))
        + kv('Zákazník', '<b>' + esc(r.customer_name) + '</b>') + kv('Telefon', '<a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>') + kv('E-mail', '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>')
        + kv('Částka', '<b>' + kc(r.amount) + '</b>') + kv('Způsob platby', esc(r.pay_method)) + kv('Služba', esc(r.service))
        + (r.kind === 'refund' ? kv('Účet pro vrácení', '<b style="font-family:Consolas,monospace">' + esc(r.account || '—') + '</b>') + kv('Důvod', '<span style="white-space:pre-line">' + esc(r.reason || '—') + '</span>') : '')
        + (r.receipt_number ? kv('Doklad', esc(r.receipt_number) + ' · odeslán ' + esc(dt(r.receipt_sent_at))) : '')
        + (r.credit_note ? kv('Dobropis', '<b>' + esc(r.credit_note.invoice_number) + '</b> · ' + ({ ready_to_pay: 'k proplacení (Účetní doklady → K platbě)', payment_queued: 'v platebním příkazu', paid: 'zaplacen', cancelled: 'stornován', partially_paid: 'částečně zaplacen' }[r.credit_note.status] || esc(r.credit_note.status)) + (r.credit_note.delivery_status === 'sent' ? ' · odeslán zákazníkovi' : '')) : '')
        + (r.paid_at ? kv('Zaplaceno', esc(dt(r.paid_at))) : '') + (r.reject_reason ? kv('Důvod zrušení', esc(r.reject_reason)) : '')
        + '</div><div>'
        + '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">Interní poznámka (zákazník nevidí)</div><textarea id="rp-note" rows="4" style="' + inp + ';width:100%;resize:vertical">' + esc(r.internal_note || '') + '</textarea>'
        + '<div style="display:flex;gap:6px;margin:6px 0 14px"><button class="btn btn-secondary btn-sm" data-rpa="note">💾 Uložit poznámku</button></div>'
        + (r.kind === 'receipt' ? '' : '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">Zpráva zákazníkovi (e-mail na ' + esc(r.email) + ')</div><textarea id="rp-msg" rows="3" style="' + inp + ';width:100%;resize:vertical" placeholder="Např. Platbu jsme vám vrátili na účet…"></textarea>'
        + '<div style="display:flex;gap:6px;margin:6px 0 14px"><button class="btn btn-secondary btn-sm" data-rpa="mail">✉️ Odeslat e-mail</button></div>')
        + '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">Historie</div><div style="max-height:200px;overflow:auto">' + (hist || '<span style="color:var(--text2);font-size:12.5px">—</span>') + '</div>'
        + '</div></div>'
        + '<div class="modal-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">' + act + '<span style="flex:1"></span><button class="btn btn-secondary" data-rpx>Zavřít</button></div></div>';
      document.body.appendChild(ov);
      ov.querySelectorAll('[data-rpx]').forEach(function (b) { b.onclick = close; });
      ov.querySelectorAll('[data-rpa]').forEach(function (b) {
        b.onclick = function () {
          var a = b.getAttribute('data-rpa'), p;
          if (a === 'note') p = api('/' + r.id, { method: 'PATCH', body: JSON.stringify({ internal_note: $('rp-note').value }) });
          else if (a === 'mail') { var t = $('rp-msg').value.trim(); if (t.length < 5) return alert('Napište text zprávy.'); if (!confirm('Odeslat e-mail zákazníkovi na ' + r.email + '?')) return; p = api('/' + r.id + '/email', { method: 'POST', body: JSON.stringify({ text: t }) }); }
          else if (a === 'send') { if (!confirm('Vystavit doklad a poslat ho e-mailem na ' + r.email + '?')) return; b.disabled = true; b.textContent = 'Odesílám…'; p = api('/' + r.id + '/send-receipt', { method: 'POST' }); }
          else if (a === 'rejected') { var why = prompt('Důvod zrušení (uloží se k žádosti):', ''); if (why === null) return; p = api('/' + r.id, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', reject_reason: why }) }); }
          else if (a === 'done') { if (!confirm('Označit dobropis jako zaplacený (' + kc(r.amount) + ' na účet ' + (r.account || '?') + ') a poslat zákazníkovi dobropis e-mailem?')) return; p = api('/' + r.id, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }); }
          else p = api('/' + r.id, { method: 'PATCH', body: JSON.stringify({ status: a }) });
          p.then(function () { load(); openDetail(r.id); }).catch(function (e) { b.disabled = false; alert('Chyba: ' + e.message); openDetail(r.id); });
        };
      });
    }).catch(function (e) { alert('Žádost se nepodařilo načíst: ' + e.message); });
  }
  document.addEventListener('click', function (e) { var tr = e.target.closest && e.target.closest('#rp-table tr[data-rpid]'); if (tr) openDetail(+tr.getAttribute('data-rpid')); });

  // ─── Nastavení ─────────────────────────────────────────────────────────────
  function openSettings() {
    api('/settings').then(function (j) {
      close();
      var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'rp-modal';
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      var sel = (j.notify_person_ids || []).map(Number);
      var st = j.settings || {};
      ov.innerHTML = '<div class="modal" style="width:560px"><h2 style="margin:0 0 12px;font-size:18px">⚙️ Reklamace praní — nastavení</h2>'
        + '<div style="font-size:13px;font-weight:700;margin-bottom:6px">Komu přijde upozornění do Velína při nové žádosti</div>'
        + '<div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px">'
        + ((j.people || []).length ? j.people.map(function (p) { return '<label style="display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer"><input type="checkbox" value="' + p.id + '"' + (sel.indexOf(p.id) !== -1 ? ' checked' : '') + '> ' + esc(p.name) + (p.role ? ' <span style="color:var(--text2);font-size:12px">· ' + esc(p.role) + '</span>' : '') + '</label>'; }).join('') : '<span style="color:var(--text2);font-size:12.5px">Nikdo nemá aktivní Velín.</span>')
        + '</div><div style="font-size:11.5px;color:var(--text2);margin:4px 0 14px">Bez výběru chodí upozornění Tomášovi. Ukazují se jen lidé s aktivním Velínem.</div>'
        + '<div style="font-size:13px;font-weight:700;margin-bottom:6px">Doklad</div>'
        + '<label style="font-size:12.5px;color:var(--text2)">Sazba DPH na dokladu <select id="rp-vat" style="margin-left:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px">' + [21, 12, 0].map(function (v) { return '<option value="' + v + '"' + (Number(st.vat_rate) === v ? ' selected' : '') + '>' + v + ' %</option>'; }).join('') + '</select></label>'
        + '<div style="font-size:12.5px;color:var(--text2);margin:10px 0 4px">Poznámka na dokladu (nepovinné)</div><input id="rp-rnote" value="' + esc(st.receipt_note || '') + '" maxlength="500" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text)">'
        + '<div style="font-size:11.5px;color:var(--text2);margin-top:6px">Doklad vystavuje naše firma (Nastavení → Naše firma). Zkontrolujte náhled dokladu před prvním odesláním.</div>'
        + '<div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn btn-secondary" data-rpx>Zrušit</button><button class="btn btn-primary" id="rp-save">Uložit</button></div></div>';
      document.body.appendChild(ov);
      ov.querySelectorAll('[data-rpx]').forEach(function (b) { b.onclick = close; });
      $('rp-save').onclick = function () {
        var ids = [].map.call(ov.querySelectorAll('input[type=checkbox]:checked'), function (c) { return Number(c.value); });
        api('/settings', { method: 'PUT', body: JSON.stringify({ notify_person_ids: ids, settings: { vat_rate: Number($('rp-vat').value), receipt_note: $('rp-rnote').value } }) })
          .then(close).catch(function (e) { alert('Chyba: ' + e.message); });
      };
    }).catch(function (e) { alert('Nastavení se nepodařilo načíst: ' + e.message); });
  }

  window.rpEnsure = function () { shell(); if (!loaded) load(); else render(); };
  // Hluboký odkaz z Velína / zvonku: ?tab=reklamace&id=N
  (function () {
    var q = new URLSearchParams(location.search);
    if (q.get('tab') !== 'reklamace') return;
    var tries = 0;
    (function go() {
      var btn = document.querySelector('.section-tab[data-section="reklamace"]');
      if (!btn) { if (tries++ < 40) setTimeout(go, 150); return; }
      btn.click();
      var id = parseInt(q.get('id'), 10);
      if (id) setTimeout(function () { openDetail(id); }, 300);
    })();
  })();
})();
