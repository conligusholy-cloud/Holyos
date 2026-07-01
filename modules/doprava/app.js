// =============================================================================
// HolyOS — Doprava (agenda) — frontend modul
// Fronta požadavků na dopravu, nacenění (náklad + provize → prodejní cena),
// potvrzení ceny do objednávky. API: /api/shipping/*, lookup /api/eshop-admin/people.
// =============================================================================

(function () {
  'use strict';

  const API = '/api/shipping';

  async function fetchJSON(url, opts) {
    const res = await fetch(url, { credentials: 'same-origin', ...(opts || {}) });
    if (res.status === 401) { window.location = '/login.html'; throw new Error('401'); }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_e) {}
    if (!res.ok) throw new Error((json && (json.error || json.message)) || ('HTTP ' + res.status));
    return json;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function money(n, cur) {
    if (n == null || n === '') return '—';
    return Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || '');
  }
  const REQ_LABELS = { new: 'Nový', quoting: 'Poptávám', quoted: 'Naceněno', confirmed: 'Potvrzeno', cancelled: 'Zrušeno' };
  const ORDER_LABELS = { new: 'Nová', confirmed: 'Potvrzená', picking: 'Pickování', shipped: 'Odeslaná', delivered: 'Doručená', closed: 'Uzavřená', cancelled: 'Zrušená' };

  let _people = [];
  let _current = null; // otevřený požadavek

  // ─── Taby ───────────────────────────────────────────────────────────────────
  document.querySelectorAll('.module-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.module-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'settings') loadSettings();
    });
  });

  // ─── Modal helpers ────────────────────────────────────────────────────────────
  window.closeModal = function () { document.getElementById('modal-overlay').classList.remove('active'); };
  function openModal(title) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-overlay').classList.add('active');
  }

  // ─── Fronta ─────────────────────────────────────────────────────────────────
  async function loadQueue() {
    const tbody = document.getElementById('queue-tbody');
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Načítám…</td></tr>';
    const q = document.getElementById('q-search').value.trim();
    const status = document.getElementById('q-status').value;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    try {
      const rows = await fetchJSON(`${API}/requests?${params}`);
      document.getElementById('header-count').textContent = rows.length ? `(${rows.length})` : '';
      if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Žádné požadavky na dopravu.</td></tr>'; return; }
      tbody.innerHTML = rows.map(r => {
        const o = r.order || {};
        const recipient = esc(o.ship_to_company || o.ship_to_name || '—');
        return `<tr>
          <td><strong>${esc(o.order_number || '—')}</strong><br><span style="font-size:11px;color:var(--text2);">${esc(ORDER_LABELS[o.status] || o.status || '')}</span></td>
          <td>${esc(o.ship_to_country || '—')}</td>
          <td>${recipient}</td>
          <td>${esc(r.carrier || '—')}</td>
          <td class="num">${Number(r.sell_excl) > 0 ? money(r.sell_excl, r.currency) : '—'}</td>
          <td><span class="badge badge-${esc(o.shipping_price_status || 'pending')}">${o.shipping_price_status === 'defined' ? 'Definovaná' : 'Čeká'}</span></td>
          <td><span class="badge badge-${esc(r.status)}">${esc(REQ_LABELS[r.status] || r.status)}</span></td>
          <td><button class="btn btn-secondary btn-sm" onclick="openRequest(${r.id})">Otevřít</button></td>
        </tr>`;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`;
    }
  }

  // ─── Detail / nacenění ─────────────────────────────────────────────────────────
  window.openRequest = async function (id) {
    try {
      if (!_people.length) {
        try { _people = await fetchJSON('/api/eshop-admin/people'); } catch (_e) { _people = []; }
      }
      const r = await fetchJSON(`${API}/requests/${id}`);
      _current = r;
      const o = r.order || {};
      const itemsCount = (o.items || []).length;
      const isLocked = r.status === 'confirmed';
      const peopleOpts = '<option value="">— nepřiřazeno —</option>' + _people.map(p =>
        `<option value="${p.id}" ${r.assigned_to === p.id ? 'selected' : ''}>${esc((p.first_name || '') + ' ' + (p.last_name || ''))}</option>`).join('');

      openModal(`Zásilka — objednávka ${esc(o.order_number || '')}`);
      document.getElementById('modal-body').innerHTML = `
        <div class="info-grid">
          <div class="block"><div class="label">Příjemce</div><div class="value">${esc(o.ship_to_name || '')}${o.ship_to_company ? '<br>' + esc(o.ship_to_company) : ''}</div></div>
          <div class="block"><div class="label">Adresa dodání</div><div class="value">${esc(o.ship_to_address || '')}<br>${esc((o.ship_to_zip || '') + ' ' + (o.ship_to_city || ''))}<br><strong>${esc(o.ship_to_country || '')}</strong></div></div>
          <div class="block"><div class="label">Objednávka</div><div class="value">${esc(o.order_number || '')} · ${esc(ORDER_LABELS[o.status] || o.status || '')}<br>${itemsCount} položek · zboží ${money(o.subtotal_excl, o.currency)}</div></div>
          <div class="block"><div class="label">Stav ceny dopravy</div><div class="value"><span class="badge badge-${esc(o.shipping_price_status || 'pending')}">${o.shipping_price_status === 'defined' ? 'Definovaná' : 'Čeká na doplnění'}</span></div></div>
        </div>

        <div class="form-row">
          <div><label>Dopravce</label><input type="text" id="f-carrier" value="${esc(r.carrier || '')}" placeholder="DPD / GLS / DHL…" ${isLocked ? 'disabled' : ''}></div>
          <div><label>Řešitel</label><select id="f-assignee" ${isLocked ? 'disabled' : ''}>${peopleOpts}</select></div>
        </div>
        <div class="form-row">
          <div style="flex:none; width:100%;"><label>Kam / komu poptáno (poznámka)</label><textarea id="f-note" placeholder="Poptávky, nabídky, čísla…" ${isLocked ? 'disabled' : ''}>${esc(r.quote_note || '')}</textarea></div>
        </div>
        <div class="form-row">
          <div><label>Náklad dopravy (bez DPH)</label><input type="number" step="0.01" min="0" id="f-cost" value="${esc(r.cost_excl)}" ${isLocked ? 'disabled' : ''}></div>
          <div><label>Provize (%)</label><input type="number" step="0.01" min="0" id="f-markup" value="${esc(r.markup_pct)}" ${isLocked ? 'disabled' : ''}></div>
        </div>

        <div class="price-box">
          <div class="label" style="font-size:11px; color:var(--text2); text-transform:uppercase;">Prodejní cena dopravy (na fakturu, bez DPH)</div>
          <div class="big" id="f-sell">${money(r.sell_excl, r.currency)}</div>
          <div style="font-size:12px; color:var(--text2);" id="f-margin"></div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Zavřít</button>
          ${isLocked ? '<span style="align-self:center; color:#22c55e; font-size:13px;">✓ Cena potvrzena a zapsána do objednávky</span>'
            : `<button class="btn btn-secondary" onclick="saveRequest(${r.id})">Uložit</button>
               <button class="btn btn-success" onclick="confirmRequest(${r.id})">Potvrdit cenu → do objednávky</button>`}
        </div>`;

      if (!isLocked) {
        const recalc = () => {
          const cost = parseFloat(document.getElementById('f-cost').value) || 0;
          const markup = parseFloat(document.getElementById('f-markup').value) || 0;
          const sell = Math.round(cost * (1 + markup / 100) * 100) / 100;
          document.getElementById('f-sell').textContent = money(sell, r.currency);
          const marginVal = Math.round((sell - cost) * 100) / 100;
          document.getElementById('f-margin').textContent = `Náklad ${money(cost, r.currency)} · marže ${money(marginVal, r.currency)}`;
        };
        document.getElementById('f-cost').addEventListener('input', recalc);
        document.getElementById('f-markup').addEventListener('input', recalc);
        recalc();
      }
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  function collect() {
    return {
      carrier: document.getElementById('f-carrier').value.trim() || null,
      quote_note: document.getElementById('f-note').value.trim() || null,
      assigned_to: document.getElementById('f-assignee').value ? parseInt(document.getElementById('f-assignee').value, 10) : null,
      cost_excl: parseFloat(document.getElementById('f-cost').value) || 0,
      markup_pct: parseFloat(document.getElementById('f-markup').value) || 0,
    };
  }

  window.saveRequest = async function (id) {
    try {
      const data = collect();
      // Když už je zadaný náklad, posuň stav na 'quoted', jinak 'quoting'.
      data.status = data.cost_excl > 0 ? 'quoted' : 'quoting';
      await fetchJSON(`${API}/requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      closeModal(); loadQueue();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.confirmRequest = async function (id) {
    try {
      const data = collect();
      if (!(data.cost_excl >= 0)) { alert('Zadej náklad dopravy.'); return; }
      // Nejdřív ulož aktuální hodnoty, pak potvrď.
      await fetchJSON(`${API}/requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      const sell = Math.round(data.cost_excl * (1 + data.markup_pct / 100) * 100) / 100;
      if (!confirm(`Potvrdit prodejní cenu dopravy ${sell.toFixed(2)} a zapsat do objednávky?\n\nObjednávku pak půjde vyfakturovat.`)) return;
      const r = await fetchJSON(`${API}/requests/${id}/confirm`, { method: 'POST' });
      alert(`Cena dopravy potvrzena.\nCelkem objednávky (bez DPH): ${Number(r.order_total_excl).toFixed(2)}`);
      closeModal(); loadQueue();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  // ─── Nastavení ────────────────────────────────────────────────────────────────
  function renderNotifyList(people, selectedIds) {
    const box = document.getElementById('notify-list');
    if (!box) return;
    const sel = new Set((selectedIds || []).map(Number));
    if (!people || !people.length) {
      box.innerHTML = '<span style="font-size:12px; color:var(--text2);">Zatím nikdo nemá aktivovaný Velín se zařízením.</span>';
      return;
    }
    box.innerHTML = people.map(p => `
      <label style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; cursor:pointer;">
        <input type="checkbox" class="notify-cb" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''} style="width:16px; height:16px;">
        <span style="font-weight:600;">${esc(p.name)}</span>
        <span style="margin-left:auto; font-size:12px; color:var(--text2);">${p.role ? esc(p.role) + ' · ' : ''}${p.devices} zař.</span>
      </label>`).join('');
  }

  async function loadSettings() {
    try {
      const s = await fetchJSON(`${API}/settings`);
      document.getElementById('set-markup').value = s.shipping_markup_pct != null ? s.shipping_markup_pct : 0;
      renderNotifyList(s.people || [], s.notify_person_ids || []);
    } catch (err) { /* ignore */ }
  }
  document.getElementById('settings-save').addEventListener('click', async () => {
    const msg = document.getElementById('settings-msg');
    try {
      const pct = parseFloat(document.getElementById('set-markup').value) || 0;
      const notify_person_ids = Array.from(document.querySelectorAll('#notify-list .notify-cb:checked'))
        .map(cb => parseInt(cb.value, 10));
      await fetchJSON(`${API}/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipping_markup_pct: pct, notify_person_ids }),
      });
      msg.textContent = '✓ Uloženo';
      setTimeout(() => { msg.textContent = ''; }, 2500);
    } catch (err) { msg.textContent = 'Chyba: ' + err.message; }
  });

  // ─── Init ──────────────────────────────────────────────────────────────────────
  document.getElementById('q-refresh').addEventListener('click', loadQueue);
  document.getElementById('q-search').addEventListener('input', () => { clearTimeout(window._qt); window._qt = setTimeout(loadQueue, 300); });
  document.getElementById('q-status').addEventListener('change', loadQueue);
  document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

  loadQueue();
})();
