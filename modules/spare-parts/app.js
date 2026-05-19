// =============================================================================
// HolyOS — Spare Parts Shop (admin) — frontend modul
// 7 tabů: Objednávky / Katalog / Ceníky / Přiřazení / Doprava / Platby /
//          Kategorie / Nastavení.
// API: /api/eshop-admin/* (požaduje interní login, JWT v cookie).
// =============================================================================

(function () {
  'use strict';

  const API = '/api/eshop-admin';

  // ─── Společné helpery ─────────────────────────────────────────────────────

  async function fetchJSON(url, opts) {
    const res = await fetch(url, { credentials: 'same-origin', ...(opts || {}) });
    if (res.status === 401) { window.location = '/public/login.html'; throw new Error('401'); }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_e) {}
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function fmtMoney(n, currency) {
    if (n == null) return '—';
    const v = Number(n).toFixed(2);
    return v + ' ' + (currency || '');
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('cs-CZ') + ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  }

  function statusBadge(status) {
    const labels = {
      new: 'Nová', confirmed: 'Potvrzená', picking: 'Pickování',
      shipped: 'Odeslaná', delivered: 'Doručená', closed: 'Uzavřená',
      cancelled: 'Zrušená',
    };
    return `<span class="badge badge-${esc(status)}">${esc(labels[status] || status)}</span>`;
  }

  // Modal helpers
  function openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.add('active');
  }
  window.closeModal = function () { document.getElementById('modal-overlay').classList.remove('active'); };

  function confirm2(msg) { return window.confirm(msg); }

  // ─── Tab switching ────────────────────────────────────────────────────────

  document.querySelectorAll('.module-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.tab;
      document.querySelectorAll('.module-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.module-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
      loadTab(id);
    });
  });

  function loadTab(id) {
    if (id === 'stats') loadStats();
    else if (id === 'orders') loadOrders();
    else if (id === 'catalog') loadCatalog();
    else if (id === 'pricelists') loadPricelists();
    else if (id === 'assignments') loadAssignments();
    else if (id === 'shipping') loadShipping();
    else if (id === 'payments') loadPayments();
    else if (id === 'categories') loadCategories();
    else if (id === 'settings') loadSettings();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // STATISTIKY (dashboard)
  // ═════════════════════════════════════════════════════════════════════════

  async function loadStats() {
    const root = document.getElementById('stats-content');
    root.innerHTML = '<div class="empty-state">Načítám…</div>';
    const fromEl = document.getElementById('stats-from');
    const toEl = document.getElementById('stats-to');
    const params = new URLSearchParams();
    if (fromEl.value) params.set('from', fromEl.value);
    if (toEl.value) params.set('to', toEl.value);
    try {
      const s = await fetchJSON(`${API}/stats/dashboard?${params}`);
      renderStats(s);
    } catch (err) {
      root.innerHTML = `<div class="empty-state">Chyba: ${esc(err.message)}</div>`;
    }
  }

  function renderStats(s) {
    const cur = (s.top_items[0] && s.top_items[0].currency) || (s.revenue_by_month[0] && 'EUR') || 'EUR';
    // Top item bar chart
    const maxRevenue = Math.max(...s.top_items.map(t => t.revenue), 1);
    const topItemsHtml = s.top_items.length ? s.top_items.map(t => `
      <div style="display:grid; grid-template-columns:160px 1fr 110px 70px; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border);">
        <code style="font-size:11px; color:var(--text2);">${esc(t.code)}</code>
        <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(t.name)}</div>
        <div style="background:rgba(245,158,11,0.15); border-radius:4px; height:18px; position:relative; overflow:hidden;">
          <div style="background:#f59e0b; height:100%; width:${(t.revenue / maxRevenue * 100).toFixed(0)}%;"></div>
        </div>
        <div class="num" style="font-size:12px; font-weight:600;">${Number(t.revenue).toFixed(0)} ${cur}</div>
      </div>`).join('') : '<div class="empty-state">Žádné prodeje v období.</div>';

    // Revenue by month bars
    const maxMonth = Math.max(...s.revenue_by_month.map(m => m.revenue), 1);
    const monthsHtml = s.revenue_by_month.length ? `
      <div style="display:grid; grid-template-columns:repeat(${s.revenue_by_month.length}, 1fr); gap:6px; align-items:flex-end; height:140px; margin-bottom:8px;">
        ${s.revenue_by_month.map(m => `
          <div style="display:flex; flex-direction:column; align-items:center; height:100%;">
            <div style="flex:1; display:flex; align-items:flex-end; width:100%;">
              <div style="background:linear-gradient(180deg, #fbbf24, #f59e0b); width:100%; height:${(m.revenue / maxMonth * 100).toFixed(0)}%; border-radius:4px 4px 0 0; min-height:2px;" title="${m.revenue.toFixed(0)} ${cur}"></div>
            </div>
            <div style="font-size:10px; color:var(--text2); margin-top:4px;">${esc(m.month.slice(5))}</div>
            <div style="font-size:11px; font-weight:600;">${m.revenue >= 1000 ? (m.revenue/1000).toFixed(1) + 'k' : Math.round(m.revenue)}</div>
          </div>`).join('')}
      </div>` : '<div class="empty-state">Žádná data.</div>';

    // Top companies
    const topCoHtml = s.top_companies.length ? s.top_companies.map(c => `
      <tr><td>${esc(c.name)}</td><td class="num">${c.orders}</td><td class="num">${Number(c.revenue).toFixed(0)} ${cur}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty-state">Žádné firmy v období.</td></tr>';

    // Status distribution
    const statusOrder = ['new','confirmed','picking','shipped','delivered','closed','cancelled'];
    const statusLabels = { new:'Nové', confirmed:'Potvrzené', picking:'Pickování', shipped:'Odeslané', delivered:'Doručené', closed:'Uzavřené', cancelled:'Zrušené' };
    const totalStatus = statusOrder.reduce((a, k) => a + (s.status_counts[k] || 0), 0);
    const statusHtml = statusOrder.map(k => {
      const n = s.status_counts[k] || 0;
      const pct = totalStatus > 0 ? (n / totalStatus * 100).toFixed(0) : 0;
      return `<tr>
        <td>${esc(statusLabels[k])}</td>
        <td class="num">${n}</td>
        <td><div style="background:rgba(245,158,11,0.15); border-radius:4px; height:8px; overflow:hidden;"><div style="background:#f59e0b; height:100%; width:${pct}%;"></div></div></td>
        <td class="num">${pct} %</td>
      </tr>`;
    }).join('');

    const c = s.conversion || {};
    document.getElementById('stats-content').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Objednávky</div><div class="value">${s.summary.total_orders}</div></div>
        <div class="stat-card"><div class="label">Tržby (s DPH)</div><div class="value">${Math.round(s.summary.total_revenue).toLocaleString('cs-CZ')} ${cur}</div></div>
        <div class="stat-card"><div class="label">Průměrná objednávka</div><div class="value">${Math.round(s.summary.avg_order_value)} ${cur}</div></div>
        <div class="stat-card"><div class="label">Zrušené</div><div class="value" style="color:#ef4444;">${s.summary.cancelled}</div></div>
        ${c.hugo_sessions != null ? `
          <div class="stat-card"><div class="label">Hugo sessions</div><div class="value">${c.hugo_sessions}</div></div>
          <div class="stat-card"><div class="label">Konverze sessions→nákup</div><div class="value">${c.rate} %</div></div>
        ` : ''}
      </div>

      <h3 style="font-size:14px; margin:20px 0 8px;">Tržby per měsíc (12 měsíců)</h3>
      ${monthsHtml}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:20px;">
        <div>
          <h3 style="font-size:14px; margin:0 0 8px;">Top 10 prodávaných položek (revenue)</h3>
          ${topItemsHtml}
        </div>
        <div>
          <h3 style="font-size:14px; margin:0 0 8px;">Top 10 firem (revenue)</h3>
          <table class="data-table">
            <thead><tr><th>Firma</th><th class="num">Obj.</th><th class="num">Tržby</th></tr></thead>
            <tbody>${topCoHtml}</tbody>
          </table>
        </div>
      </div>

      <h3 style="font-size:14px; margin:20px 0 8px;">Rozdělení objednávek podle stavu</h3>
      <table class="data-table">
        <thead><tr><th>Stav</th><th class="num">Počet</th><th>Graf</th><th class="num">%</th></tr></thead>
        <tbody>${statusHtml}</tbody>
      </table>

      ${(s.low_stock || []).length ? `
        <h3 style="font-size:14px; margin:20px 0 8px;">⚠️ Nízké zásoby (${s.low_stock.length})</h3>
        <div style="font-size:12px; color:var(--text2); margin-bottom:8px;">Položky prodávané v eshopu, jejichž current_stock klesl pod min_stock. Doporučení: doplnit u dodavatele, případně dočasně skrýt v Katalog tabu.</div>
        <table class="data-table">
          <thead><tr><th>Kód</th><th>Název</th><th class="num">Skladem</th><th class="num">Min.</th><th class="num">Chybí</th></tr></thead>
          <tbody>${s.low_stock.map(ls => `
            <tr>
              <td><code>${esc(ls.code)}</code></td>
              <td>${esc(ls.name)}</td>
              <td class="num">${Number(ls.current_stock).toFixed(2)} ${esc(ls.unit || '')}</td>
              <td class="num">${Number(ls.min_stock).toFixed(2)}</td>
              <td class="num" style="color:#ef4444; font-weight:600;">${Number(ls.shortage).toFixed(2)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}
    `;
  }

  document.getElementById('stats-refresh').addEventListener('click', loadStats);
  document.getElementById('stats-from').addEventListener('change', loadStats);
  document.getElementById('stats-to').addEventListener('change', loadStats);

  // ═════════════════════════════════════════════════════════════════════════
  // OBJEDNÁVKY
  // ═════════════════════════════════════════════════════════════════════════

  async function loadOrders() {
    const tbody = document.getElementById('orders-tbody');
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Načítám…</td></tr>';

    const q = document.getElementById('orders-search').value.trim();
    const status = document.getElementById('orders-status').value;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);

    try {
      const [orders, stats] = await Promise.all([
        fetchJSON(`${API}/orders?${params}`),
        fetchJSON(`${API}/orders/stats`),
      ]);
      renderOrderStats(stats);
      if (!orders.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Žádné objednávky.</td></tr>';
        return;
      }
      tbody.innerHTML = orders.map(o => `
        <tr>
          <td><strong>${esc(o.order_number)}</strong></td>
          <td>${statusBadge(o.status)}</td>
          <td>${esc(fmtDate(o.created_at))}</td>
          <td>${esc(o.partner ? o.partner.display_name : '—')}</td>
          <td>${esc(o.company ? o.company.name : (o.ship_to_company || '—'))}</td>
          <td class="num">${o._count ? o._count.items : '—'}</td>
          <td class="num">${esc(fmtMoney(o.total_incl_vat, o.currency))}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="openOrder(${o.id})">Detail</button></td>
        </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`;
    }
  }

  function renderOrderStats(stats) {
    const order = ['new', 'confirmed', 'picking', 'shipped', 'delivered', 'closed', 'cancelled'];
    const labels = { new:'Nové', confirmed:'Potvrzené', picking:'Pickování', shipped:'Odeslané', delivered:'Doručené', closed:'Uzavřené', cancelled:'Zrušené' };
    document.getElementById('orders-stats').innerHTML = order.map(s => `
      <div class="stat-card">
        <div class="label">${esc(labels[s])}</div>
        <div class="value">${stats[s] || 0}</div>
      </div>`).join('');
  }

  document.getElementById('orders-refresh').addEventListener('click', loadOrders);
  document.getElementById('orders-search').addEventListener('input', debounce(loadOrders, 350));
  document.getElementById('orders-status').addEventListener('change', loadOrders);

  window.exportOrdersCsv = function () {
    const status = document.getElementById('orders-status').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    // Otevře v novém okně — browser stáhne soubor díky Content-Disposition
    window.location.href = `${API}/orders/export.csv?${params}`;
  };

  window.openOrder = async function (id) {
    try {
      const o = await fetchJSON(`${API}/orders/${id}`);
      const itemsHtml = o.items.map(it => `
        <tr>
          <td>${esc(it.material_code)}</td>
          <td>${esc(it.material_name)}</td>
          <td class="num">${Number(it.quantity)} ${esc(it.unit)}</td>
          <td class="num">${esc(fmtMoney(it.unit_price_excl, o.currency))}</td>
          <td class="num">${esc(fmtMoney(it.total_excl, o.currency))}</td>
        </tr>`).join('');
      const statuses = ['new','confirmed','picking','shipped','delivered','closed','cancelled'];
      const statusOptions = statuses.map(s => `<option value="${s}"${s===o.status?' selected':''}>${s}</option>`).join('');
      const body = `
        <div class="order-detail-grid">
          <div class="block">
            <div class="label">Partner</div>
            <div class="value">${esc(o.partner ? o.partner.display_name : '—')}<br><small style="color:var(--text2)">${esc(o.partner ? (o.partner.email || o.partner.username) : '')}</small></div>
          </div>
          <div class="block">
            <div class="label">Firma</div>
            <div class="value">${esc(o.company ? o.company.name : (o.ship_to_company || '—'))}</div>
          </div>
          <div class="block" style="grid-column:1 / -1">
            <div class="label">Adresa dodání</div>
            <div class="value">
              ${esc(o.ship_to_name)}<br>
              ${o.ship_to_company ? esc(o.ship_to_company) + '<br>' : ''}
              ${esc(o.ship_to_address)}<br>
              ${esc(o.ship_to_zip)} ${esc(o.ship_to_city)}, ${esc(o.ship_to_country)}<br>
              ${o.ship_to_phone ? '📞 ' + esc(o.ship_to_phone) + '<br>' : ''}
              ${o.ship_to_email ? '✉️ ' + esc(o.ship_to_email) : ''}
            </div>
          </div>
          <div class="block">
            <div class="label">Doprava</div>
            <div class="value">${esc(o.shipping_method.name)}<br>${esc(fmtMoney(o.shipping_excl, o.currency))} bez DPH</div>
          </div>
          <div class="block">
            <div class="label">Platba</div>
            <div class="value">${esc(o.payment_method.name)}${Number(o.payment_fee_excl) > 0 ? '<br>+ ' + esc(fmtMoney(o.payment_fee_excl, o.currency)) + ' poplatek' : ''}</div>
          </div>
        </div>
        ${o.customer_note ? `<div class="block" style="margin-bottom:16px;"><div class="label">Poznámka zákazníka</div><div class="value">${esc(o.customer_note)}</div></div>` : ''}
        <h3 style="font-size:14px; margin:16px 0 8px;">Položky</h3>
        <table class="data-table">
          <thead><tr><th>Kód</th><th>Název</th><th class="num">Množství</th><th class="num">Cena/ks</th><th class="num">Celkem</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr><td colspan="4" class="num"><strong>Mezisoučet</strong></td><td class="num"><strong>${esc(fmtMoney(o.subtotal_excl, o.currency))}</strong></td></tr>
            <tr><td colspan="4" class="num">Doprava</td><td class="num">${esc(fmtMoney(o.shipping_excl, o.currency))}</td></tr>
            ${Number(o.payment_fee_excl) > 0 ? `<tr><td colspan="4" class="num">Poplatek za platbu</td><td class="num">${esc(fmtMoney(o.payment_fee_excl, o.currency))}</td></tr>` : ''}
            <tr><td colspan="4" class="num"><strong>Celkem bez DPH</strong></td><td class="num"><strong>${esc(fmtMoney(o.total_excl, o.currency))}</strong></td></tr>
            <tr><td colspan="4" class="num"><strong>Celkem s DPH (${Number(o.vat_pct)} %)</strong></td><td class="num"><strong>${esc(fmtMoney(o.total_incl_vat, o.currency))}</strong></td></tr>
          </tfoot>
        </table>
        <div class="order-actions">
          <label style="font-size:12px; align-self:center;">Změnit stav:</label>
          <select id="order-status-select" class="filter-select">${statusOptions}</select>
          <input type="text" id="order-tracking" class="filter-input" placeholder="Tracking number" value="${esc(o.tracking_number || '')}" style="flex:1; min-width:160px;">
          <input type="text" id="order-carrier" class="filter-input" placeholder="Dopravce" value="${esc(o.tracking_carrier || '')}" style="width:140px;">
          <button class="btn btn-primary btn-sm" onclick="saveOrder(${o.id})">Uložit</button>
        </div>
        ${o.invoice ? `
          <div style="margin-top:12px; padding:12px; background:rgba(34,197,94,0.05); border:1px solid rgba(34,197,94,0.2); border-radius:10px;">
            <div style="font-size:11px; color:var(--text2); text-transform:uppercase; margin-bottom:4px;">🧾 Faktura</div>
            <a href="/modules/ucetni-doklady/index.html?invoice=${o.invoice.id}" target="_blank" style="font-weight:600; color:var(--text); text-decoration:none;">
              ${esc(o.invoice.invoice_number)} ↗
            </a>
            — ${esc(fmtMoney(o.invoice.total, o.invoice.currency))}
            <span class="badge badge-${esc(o.invoice.status)}" style="margin-left:8px;">${esc(o.invoice.status)}</span>
            ${Number(o.invoice.paid_amount || 0) > 0 ? ` · zaplaceno ${esc(fmtMoney(o.invoice.paid_amount, o.invoice.currency))}` : ''}
          </div>
        ` : (['shipped', 'delivered', 'closed'].includes(o.status) && o.company_id ? `
          <div style="margin-top:12px; padding:12px; background:rgba(245,158,11,0.05); border:1px solid rgba(245,158,11,0.2); border-radius:10px;">
            <div style="font-size:12px; color:var(--text2); margin-bottom:8px;">Objednávka je dodaná — můžeš z ní vygenerovat fakturu vydanou (AR).</div>
            <button class="btn btn-primary btn-sm" onclick="createInvoiceFromOrder(${o.id})">🧾 Vytvořit fakturu</button>
          </div>
        ` : '')}`;
      openModal(`Objednávka ${o.order_number}`, body);
    } catch (err) {
      alert('Chyba: ' + err.message);
    }
  };

  window.createInvoiceFromOrder = async function (id) {
    if (!confirm2('Vygenerovat fakturu (AR/issued) z této objednávky?')) return;
    try {
      const r = await fetchJSON(`${API}/orders/${id}/invoice`, { method: 'POST' });
      alert(`Faktura ${r.invoice_number} vytvořena.\nVS: ${r.variable_symbol}\nCelkem: ${r.total} ${r.currency}`);
      closeModal();
      loadOrders();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.saveOrder = async function (id) {
    const status = document.getElementById('order-status-select').value;
    const tracking_number = document.getElementById('order-tracking').value.trim() || null;
    const tracking_carrier = document.getElementById('order-carrier').value.trim() || null;
    try {
      await fetchJSON(`${API}/orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, tracking_number, tracking_carrier }),
      });
      closeModal();
      loadOrders();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // KATALOG (Materials s eshop nastavením)
  // ═════════════════════════════════════════════════════════════════════════

  let _catalogCategories = [];
  let _catalogSelected = new Set();
  let _catalogWarehouses = [];

  function refreshCatalogBulkBar() {
    const bar = document.getElementById('catalog-bulk-bar');
    if (!bar) return;
    const n = _catalogSelected.size;
    if (n === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    document.getElementById('catalog-bulk-count').textContent = n;
  }

  window.toggleCatalogRow = function (id, checked) {
    if (checked) _catalogSelected.add(id);
    else _catalogSelected.delete(id);
    refreshCatalogBulkBar();
  };

  window.toggleCatalogAll = function (checked) {
    document.querySelectorAll('.catalog-row-cb').forEach(cb => {
      cb.checked = checked;
      const id = parseInt(cb.dataset.id, 10);
      if (checked) _catalogSelected.add(id);
      else _catalogSelected.delete(id);
    });
    refreshCatalogBulkBar();
  };

  window.applyCatalogBulk = async function () {
    const action = document.getElementById('catalog-bulk-action').value;
    let value = null;
    if (action === 'set_category') {
      const sel = document.getElementById('catalog-bulk-category');
      value = sel && sel.value ? parseInt(sel.value, 10) : null;
    } else if (action === 'set_warehouse') {
      const sel = document.getElementById('catalog-bulk-warehouse');
      value = sel && sel.value ? parseInt(sel.value, 10) : null;
    }
    if (!_catalogSelected.size) { alert('Nic není vybráno.'); return; }
    const ids = Array.from(_catalogSelected);
    if (!confirm2(`Aplikovat akci "${action}" na ${ids.length} položek?`)) return;
    try {
      const r = await fetchJSON(`${API}/materials/bulk-eshop`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ material_ids: ids, action, value }),
      });
      _catalogSelected.clear();
      loadCatalog();
      alert(`Aktualizováno ${r.updated} položek.`);
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.onCatalogBulkActionChange = function () {
    const action = document.getElementById('catalog-bulk-action').value;
    document.getElementById('catalog-bulk-category-wrap').style.display = action === 'set_category' ? 'block' : 'none';
    document.getElementById('catalog-bulk-warehouse-wrap').style.display = action === 'set_warehouse' ? 'block' : 'none';
  };

  async function loadCatalog() {
    if (!_catalogCategories.length) {
      try { _catalogCategories = await fetchJSON(`${API}/categories`); } catch (_e) { _catalogCategories = []; }
      const sel = document.getElementById('catalog-category');
      sel.innerHTML = '<option value="">Všechny kategorie</option>' +
        _catalogCategories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      // Také naplň bulk dropdowny
      const bcSel = document.getElementById('catalog-bulk-category');
      if (bcSel) bcSel.innerHTML = '<option value="">— bez kategorie —</option>' +
        _catalogCategories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    }
    if (!_catalogWarehouses.length) {
      try { _catalogWarehouses = await fetchJSON(`${API}/warehouses`); } catch (_e) { _catalogWarehouses = []; }
      const bwSel = document.getElementById('catalog-bulk-warehouse');
      if (bwSel) bwSel.innerHTML = '<option value="">— žádný —</option>' +
        _catalogWarehouses.map(w => `<option value="${w.id}">${esc(w.name)}${w.code ? ' (' + esc(w.code) + ')' : ''}</option>`).join('');
    }

    const tbody = document.getElementById('catalog-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Načítám…</td></tr>';
    const q = document.getElementById('catalog-search').value.trim();
    const cat = document.getElementById('catalog-category').value;
    const onlyEshop = document.getElementById('catalog-only-eshop').checked;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cat) params.set('category_id', cat);
    if (onlyEshop) params.set('only_eshop', '1');

    try {
      const items = await fetchJSON(`${API}/materials?${params}`);
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Žádné položky.</td></tr>';
        return;
      }
      tbody.innerHTML = items.map(m => `
        <tr>
          <td><input type="checkbox" class="catalog-row-cb" data-id="${m.id}" ${_catalogSelected.has(m.id) ? 'checked' : ''} onchange="toggleCatalogRow(${m.id}, this.checked)"></td>
          <td><code>${esc(m.code)}</code></td>
          <td>${esc(m.name)}</td>
          <td>${m.sells_on_eshop ? '<span class="badge badge-active">Ano</span>' : '<span class="badge badge-inactive">Ne</span>'}</td>
          <td>${esc(m.eshop_warehouse ? m.eshop_warehouse.name : '—')}</td>
          <td>${esc(m.eshop_category ? m.eshop_category.name : '—')}</td>
          <td class="num">${Number(m.current_stock || 0).toFixed(2)} ${esc(m.unit || '')}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="editMaterialEshop(${m.id})">Eshop nastavení</button></td>
        </tr>`).join('');
      refreshCatalogBulkBar();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`;
    }
  }

  document.getElementById('catalog-refresh').addEventListener('click', loadCatalog);
  document.getElementById('catalog-search').addEventListener('input', debounce(loadCatalog, 350));
  document.getElementById('catalog-category').addEventListener('change', loadCatalog);
  document.getElementById('catalog-only-eshop').addEventListener('change', loadCatalog);

  window.editMaterialEshop = async function (id) {
    try {
      const [warehouses, categories] = await Promise.all([
        fetchJSON(`${API}/warehouses`),
        _catalogCategories.length ? Promise.resolve(_catalogCategories) : fetchJSON(`${API}/categories`),
      ]);
      const materials = await fetchJSON(`${API}/materials?q=`);
      const m = materials.find(x => x.id === id);
      if (!m) { alert('Materiál nenalezen'); return; }
      const whOpts = '<option value="">— žádný —</option>' +
        warehouses.map(w => `<option value="${w.id}"${m.eshop_warehouse_id===w.id?' selected':''}>${esc(w.name)} (${esc(w.code||'')})</option>`).join('');
      const catOpts = '<option value="">— bez kategorie —</option>' +
        categories.map(c => `<option value="${c.id}"${m.eshop_category_id===c.id?' selected':''}>${esc(c.name)}</option>`).join('');
      openModal(`${m.code} — ${m.name}`, `
        <div class="form-row">
          <div>
            <label><input type="checkbox" id="m-sells" ${m.sells_on_eshop?'checked':''}> Prodávat na eshopu</label>
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>Sklad pro výpočet dostupnosti</label>
            <select id="m-warehouse">${whOpts}</select>
          </div>
          <div>
            <label>Kategorie</label>
            <select id="m-category">${catOpts}</select>
          </div>
        </div>
        <div class="form-row">
          <div style="flex:none; width:100%;">
            <label>Marketing popis (Markdown, zobrazí se v partner UI)</label>
            <textarea id="m-description" rows="4">${esc(m.eshop_description || '')}</textarea>
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>URL obrázku pro eshop</label>
            <input type="text" id="m-image" value="${esc(m.eshop_image_path || '')}" placeholder="/data/product-images/...">
            <div style="font-size:11px; color:var(--text2); margin-top:4px;">Pokud prázdné, použije se obecný photo_url Materialu.</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
          <button class="btn btn-primary" onclick="saveMaterialEshop(${id})">Uložit</button>
        </div>`);
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.saveMaterialEshop = async function (id) {
    const data = {
      sells_on_eshop: document.getElementById('m-sells').checked,
      eshop_warehouse_id: parseInt(document.getElementById('m-warehouse').value, 10) || null,
      eshop_category_id: parseInt(document.getElementById('m-category').value, 10) || null,
      eshop_description: document.getElementById('m-description').value.trim() || null,
      eshop_image_path: document.getElementById('m-image').value.trim() || null,
    };
    try {
      await fetchJSON(`${API}/materials/${id}/eshop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      closeModal();
      loadCatalog();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // CENÍKY
  // ═════════════════════════════════════════════════════════════════════════

  async function loadPricelists() {
    const tbody = document.getElementById('pricelists-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Načítám…</td></tr>';
    try {
      const items = await fetchJSON(`${API}/pricelists`);
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Zatím žádný ceník. Klikni „+ Nový ceník".</td></tr>';
        return;
      }
      tbody.innerHTML = items.map(p => `
        <tr>
          <td><strong>${esc(p.name)}</strong>${p.description ? `<br><small style="color:var(--text2)">${esc(p.description)}</small>` : ''}</td>
          <td>${esc(p.currency)}</td>
          <td class="num">${Number(p.vat_pct)} %</td>
          <td class="num">${p._count ? p._count.items : 0}</td>
          <td class="num">${p._count ? p._count.companies : 0}</td>
          <td>${p.active ? '<span class="badge badge-active">Aktivní</span>' : '<span class="badge badge-inactive">Neaktivní</span>'}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" onclick="editPricelist(${p.id})">Položky</button>
            <button class="btn btn-secondary btn-sm" onclick="renamePricelist(${p.id})">✎</button>
            <button class="btn btn-danger btn-sm" onclick="deletePricelist(${p.id})">×</button>
          </td>
        </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`;
    }
  }

  document.getElementById('pricelist-refresh').addEventListener('click', loadPricelists);
  document.getElementById('pricelist-new').addEventListener('click', () => renamePricelist(null));

  window.renamePricelist = function (id) {
    const isNew = id == null;
    openModal(isNew ? 'Nový ceník' : 'Upravit ceník', `
      <div class="form-row">
        <div><label>Název</label><input type="text" id="pl-name" placeholder="Standard EUR"></div>
        <div><label>Měna (3 znaky)</label><input type="text" id="pl-currency" maxlength="3" value="EUR"></div>
        <div><label>DPH (%)</label><input type="number" id="pl-vat" step="0.01" value="21"></div>
      </div>
      <div class="form-row">
        <div style="flex:none; width:100%;"><label>Popis (volitelný)</label><textarea id="pl-description" rows="2"></textarea></div>
      </div>
      <div class="form-row">
        <div><label><input type="checkbox" id="pl-active" checked> Aktivní</label></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
        <button class="btn btn-primary" onclick="savePricelist(${isNew ? 'null' : id})">Uložit</button>
      </div>`);
    if (!isNew) {
      fetchJSON(`${API}/pricelists/${id}`).then(p => {
        document.getElementById('pl-name').value = p.name;
        document.getElementById('pl-currency').value = p.currency;
        document.getElementById('pl-vat').value = p.vat_pct;
        document.getElementById('pl-description').value = p.description || '';
        document.getElementById('pl-active').checked = p.active;
      });
    }
  };

  window.savePricelist = async function (id) {
    const data = {
      name: document.getElementById('pl-name').value.trim(),
      currency: (document.getElementById('pl-currency').value.trim() || 'EUR').toUpperCase(),
      vat_pct: parseFloat(document.getElementById('pl-vat').value),
      description: document.getElementById('pl-description').value.trim() || null,
      active: document.getElementById('pl-active').checked,
    };
    if (!data.name) { alert('Vyplň název.'); return; }
    try {
      if (id) {
        await fetchJSON(`${API}/pricelists/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      } else {
        await fetchJSON(`${API}/pricelists`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      }
      closeModal(); loadPricelists();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.deletePricelist = async function (id) {
    if (!confirm2('Opravdu smazat ceník?')) return;
    try {
      await fetchJSON(`${API}/pricelists/${id}`, { method: 'DELETE' });
      loadPricelists();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.editPricelist = async function (id) {
    try {
      const pl = await fetchJSON(`${API}/pricelists/${id}`);
      const itemsHtml = pl.items.map(it => `
        <tr>
          <td><code>${esc(it.material.code)}</code></td>
          <td>${esc(it.material.name)}</td>
          <td><input type="number" step="0.01" value="${esc(it.price_excl_vat)}" id="pi-${it.id}" style="width:100px;" class="filter-input"> ${esc(pl.currency)}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="savePricelistItem(${pl.id}, ${it.id})">Uložit</button>
              <button class="btn btn-danger btn-sm" onclick="deletePricelistItem(${pl.id}, ${it.id})">×</button></td>
        </tr>`).join('');
      openModal(`Položky: ${pl.name}`, `
        <div style="margin-bottom:12px; display:flex; gap:8px; align-items:center;">
          <input type="text" id="pi-search" placeholder="Hledat materiál (kód/název)" class="filter-input" style="flex:1;">
          <button class="btn btn-secondary btn-sm" onclick="findMaterialForPricelist(${pl.id})">Najít a přidat</button>
          <button class="btn btn-primary btn-sm" onclick="bulkImportPricelist(${pl.id})" title="Vlož z Excelu (kód, cena)">📥 Hromadný import</button>
        </div>
        <table class="data-table">
          <thead><tr><th>Kód</th><th>Název</th><th>Cena bez DPH</th><th></th></tr></thead>
          <tbody>${itemsHtml || '<tr><td colspan="4" class="empty-state">Zatím žádné položky.</td></tr>'}</tbody>
        </table>`);
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.findMaterialForPricelist = async function (pricelistId) {
    const q = document.getElementById('pi-search').value.trim();
    if (!q) return;
    try {
      const mats = await fetchJSON(`${API}/materials?q=${encodeURIComponent(q)}&limit=20`);
      if (!mats.length) { alert('Nic nenalezeno'); return; }
      // Inline výběr — pro MVP vybíráme první match
      const m = mats[0];
      const price = prompt(`Cena bez DPH pro "${m.name}":`, '0');
      if (price == null) return;
      await fetchJSON(`${API}/pricelists/${pricelistId}/items`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ material_id: m.id, price_excl_vat: parseFloat(price) }),
      });
      editPricelist(pricelistId);
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.savePricelistItem = async function (pricelistId, itemId) {
    const price = parseFloat(document.getElementById(`pi-${itemId}`).value);
    try {
      await fetchJSON(`${API}/pricelists/${pricelistId}/items/${itemId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ price_excl_vat: price }),
      });
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.deletePricelistItem = async function (pricelistId, itemId) {
    if (!confirm2('Smazat položku z ceníku?')) return;
    try {
      await fetchJSON(`${API}/pricelists/${pricelistId}/items/${itemId}`, { method: 'DELETE' });
      editPricelist(pricelistId);
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.bulkImportPricelist = function (pricelistId) {
    openModal('Hromadný import cen', `
      <p style="font-size:13px; color:var(--text2); margin:0 0 8px;">
        Vlož data z Excelu — dva sloupce: <strong>kód materiálu</strong>, <strong>cena bez DPH</strong>. Tabem nebo čárkou oddělené.
        Header se přeskočí automaticky. Existující položky se přepíšou novou cenou.
      </p>
      <textarea id="bulk-csv" rows="14" style="width:100%; font-family:monospace; font-size:12px; padding:10px; background:var(--surface2); color:var(--text); border:1px solid var(--border); border-radius:8px; box-sizing:border-box;" placeholder="kód\tcena\nM-001\t89.00\nM-002\t12.50\n..."></textarea>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
        <button class="btn btn-primary" onclick="runBulkImport(${pricelistId})">Importovat</button>
      </div>`);
  };

  window.runBulkImport = async function (pricelistId) {
    const csv = document.getElementById('bulk-csv').value;
    if (!csv.trim()) { alert('Žádná data k importu.'); return; }
    try {
      const r = await fetchJSON(`${API}/pricelists/${pricelistId}/import-csv`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ csv }),
      });
      const errPreview = r.errors.slice(0, 8).map(e => `  ř. ${e.line}: ${e.error} (${e.raw || ''})`).join('\n');
      alert(`Import dokončen.\n\nVloženo:     ${r.inserted}\nAktualizováno: ${r.updated}\nPřeskočeno:    ${r.skipped} (header)\nChyby:         ${r.errors.length}\n${errPreview ? '\n' + errPreview : ''}${r.errors.length > 8 ? '\n…a další' : ''}`);
      closeModal();
      editPricelist(pricelistId);
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // PŘIŘAZENÍ CENÍKŮ FIRMÁM
  // ═════════════════════════════════════════════════════════════════════════

  let _allPricelists = [];

  async function loadAssignments() {
    const tbody = document.getElementById('assignments-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Načítám…</td></tr>';
    const q = document.getElementById('assign-search').value.trim();
    const filter = document.getElementById('assign-filter').value;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (filter === 'assigned') params.set('only_assigned', '1');
    if (filter === 'unassigned') params.set('only_unassigned', '1');
    try {
      const [companies, pricelists] = await Promise.all([
        fetchJSON(`${API}/companies?${params}`),
        _allPricelists.length ? Promise.resolve(_allPricelists) : fetchJSON(`${API}/pricelists`),
      ]);
      _allPricelists = pricelists;
      if (!companies.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Žádné firmy.</td></tr>';
        return;
      }
      tbody.innerHTML = companies.map(c => {
        const opts = '<option value="">— bez ceníku —</option>' +
          pricelists.map(p => `<option value="${p.id}"${c.eshop_pricelist_id===p.id?' selected':''}>${esc(p.name)} (${esc(p.currency)})</option>`).join('');
        return `
        <tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${esc(c.ico || '—')}</td>
          <td>${esc(c.country || '—')}</td>
          <td class="num">${c._count ? c._count.partner_accounts : 0}</td>
          <td><select class="filter-select" id="as-${c.id}" style="min-width:180px;">${opts}</select></td>
          <td><button class="btn btn-primary btn-sm" onclick="saveAssignment(${c.id})">Uložit</button></td>
        </tr>`;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`;
    }
  }

  document.getElementById('assign-refresh').addEventListener('click', loadAssignments);
  document.getElementById('assign-search').addEventListener('input', debounce(loadAssignments, 350));
  document.getElementById('assign-filter').addEventListener('change', loadAssignments);

  window.saveAssignment = async function (companyId) {
    const sel = document.getElementById(`as-${companyId}`);
    const pricelist_id = sel.value ? parseInt(sel.value, 10) : null;
    try {
      await fetchJSON(`${API}/companies/${companyId}/pricelist`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pricelist_id }),
      });
      sel.style.borderColor = '#22c55e';
      setTimeout(() => { sel.style.borderColor = ''; }, 1500);
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // DOPRAVA
  // ═════════════════════════════════════════════════════════════════════════

  async function loadShipping() {
    const tbody = document.getElementById('shipping-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Načítám…</td></tr>';
    try {
      const items = await fetchJSON(`${API}/shipping-methods`);
      if (!items.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Žádné způsoby dopravy.</td></tr>'; return; }
      tbody.innerHTML = items.map(s => `
        <tr>
          <td><strong>${esc(s.name)}</strong>${s.description ? `<br><small style="color:var(--text2)">${esc(s.description)}</small>` : ''}</td>
          <td class="num">${esc(fmtMoney(s.price_excl_vat, s.currency))}</td>
          <td>${esc(s.currency)}</td>
          <td class="num">${s.free_above_amount != null ? esc(fmtMoney(s.free_above_amount, s.currency)) : '—'}</td>
          <td>${s.active ? '<span class="badge badge-active">Aktivní</span>' : '<span class="badge badge-inactive">Neaktivní</span>'}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editShipping(${s.id})">✎</button>
            <button class="btn btn-danger btn-sm" onclick="deleteShipping(${s.id})">×</button>
          </td>
        </tr>`).join('');
    } catch (err) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`; }
  }

  document.getElementById('shipping-refresh').addEventListener('click', loadShipping);
  document.getElementById('shipping-new').addEventListener('click', () => editShipping(null));

  window.editShipping = async function (id) {
    let s = { name:'', description:'', price_excl_vat:0, vat_pct:21, free_above_amount:null, currency:'EUR', active:true };
    if (id) {
      try { const all = await fetchJSON(`${API}/shipping-methods`); s = all.find(x => x.id === id) || s; }
      catch (e) {}
    }
    openModal(id ? 'Upravit dopravu' : 'Nový způsob dopravy', `
      <div class="form-row">
        <div><label>Název</label><input type="text" id="sh-name" value="${esc(s.name)}"></div>
        <div><label>Měna</label><input type="text" id="sh-currency" maxlength="3" value="${esc(s.currency || 'EUR')}"></div>
      </div>
      <div class="form-row">
        <div><label>Cena bez DPH</label><input type="number" step="0.01" id="sh-price" value="${esc(s.price_excl_vat)}"></div>
        <div><label>DPH (%)</label><input type="number" step="0.01" id="sh-vat" value="${esc(s.vat_pct || 21)}"></div>
        <div><label>Zdarma od (volitelné)</label><input type="number" step="0.01" id="sh-free" value="${s.free_above_amount != null ? esc(s.free_above_amount) : ''}"></div>
      </div>
      <div class="form-row">
        <div style="flex:none; width:100%;"><label>Popis</label><textarea id="sh-description" rows="2">${esc(s.description || '')}</textarea></div>
      </div>
      <div class="form-row">
        <div><label><input type="checkbox" id="sh-active" ${s.active?'checked':''}> Aktivní</label></div>
        <div><label>Pořadí</label><input type="number" id="sh-sort" value="${esc(s.sort_order || 0)}"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
        <button class="btn btn-primary" onclick="saveShipping(${id == null ? 'null' : id})">Uložit</button>
      </div>`);
  };

  window.saveShipping = async function (id) {
    const data = {
      name: document.getElementById('sh-name').value.trim(),
      description: document.getElementById('sh-description').value.trim() || null,
      price_excl_vat: parseFloat(document.getElementById('sh-price').value),
      vat_pct: parseFloat(document.getElementById('sh-vat').value),
      free_above_amount: document.getElementById('sh-free').value ? parseFloat(document.getElementById('sh-free').value) : null,
      currency: (document.getElementById('sh-currency').value.trim() || 'EUR').toUpperCase(),
      active: document.getElementById('sh-active').checked,
      sort_order: parseInt(document.getElementById('sh-sort').value, 10) || 0,
    };
    if (!data.name) { alert('Vyplň název.'); return; }
    try {
      if (id) await fetchJSON(`${API}/shipping-methods/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      else await fetchJSON(`${API}/shipping-methods`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      closeModal(); loadShipping();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.deleteShipping = async function (id) {
    if (!confirm2('Smazat způsob dopravy?')) return;
    try { await fetchJSON(`${API}/shipping-methods/${id}`, { method: 'DELETE' }); loadShipping(); }
    catch (err) { alert('Chyba: ' + err.message); }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // PLATBY
  // ═════════════════════════════════════════════════════════════════════════

  async function loadPayments() {
    const tbody = document.getElementById('payments-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Načítám…</td></tr>';
    try {
      const items = await fetchJSON(`${API}/payment-methods`);
      if (!items.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Žádné způsoby platby.</td></tr>'; return; }
      tbody.innerHTML = items.map(p => `
        <tr>
          <td><strong>${esc(p.name)}</strong>${p.description ? `<br><small style="color:var(--text2)">${esc(p.description)}</small>` : ''}</td>
          <td><code>${esc(p.code)}</code></td>
          <td class="num">${Number(p.fee_excl_vat) > 0 ? esc(Number(p.fee_excl_vat).toFixed(2)) : '—'}</td>
          <td>${p.active ? '<span class="badge badge-active">Aktivní</span>' : '<span class="badge badge-inactive">Neaktivní</span>'}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editPayment(${p.id})">✎</button>
            <button class="btn btn-danger btn-sm" onclick="deletePayment(${p.id})">×</button>
          </td>
        </tr>`).join('');
    } catch (err) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`; }
  }

  document.getElementById('payment-refresh').addEventListener('click', loadPayments);
  document.getElementById('payment-new').addEventListener('click', () => editPayment(null));

  window.editPayment = async function (id) {
    let p = { name:'', code:'', description:'', fee_excl_vat:0, vat_pct:21, active:true, sort_order:0 };
    if (id) {
      const all = await fetchJSON(`${API}/payment-methods`);
      p = all.find(x => x.id === id) || p;
    }
    openModal(id ? 'Upravit platbu' : 'Nový způsob platby', `
      <div class="form-row">
        <div><label>Název</label><input type="text" id="pm-name" value="${esc(p.name)}"></div>
        <div><label>Kód (unikátní)</label><input type="text" id="pm-code" value="${esc(p.code)}" placeholder="bank_transfer"></div>
      </div>
      <div class="form-row">
        <div><label>Poplatek bez DPH</label><input type="number" step="0.01" id="pm-fee" value="${esc(p.fee_excl_vat)}"></div>
        <div><label>DPH (%)</label><input type="number" step="0.01" id="pm-vat" value="${esc(p.vat_pct)}"></div>
      </div>
      <div class="form-row">
        <div style="flex:none; width:100%;"><label>Popis</label><textarea id="pm-description" rows="2">${esc(p.description || '')}</textarea></div>
      </div>
      <div class="form-row">
        <div><label><input type="checkbox" id="pm-active" ${p.active?'checked':''}> Aktivní</label></div>
        <div><label>Pořadí</label><input type="number" id="pm-sort" value="${esc(p.sort_order || 0)}"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
        <button class="btn btn-primary" onclick="savePayment(${id == null ? 'null' : id})">Uložit</button>
      </div>`);
  };

  window.savePayment = async function (id) {
    const data = {
      name: document.getElementById('pm-name').value.trim(),
      code: document.getElementById('pm-code').value.trim(),
      description: document.getElementById('pm-description').value.trim() || null,
      fee_excl_vat: parseFloat(document.getElementById('pm-fee').value),
      vat_pct: parseFloat(document.getElementById('pm-vat').value),
      active: document.getElementById('pm-active').checked,
      sort_order: parseInt(document.getElementById('pm-sort').value, 10) || 0,
    };
    if (!data.name || !data.code) { alert('Vyplň název i kód.'); return; }
    try {
      if (id) await fetchJSON(`${API}/payment-methods/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      else await fetchJSON(`${API}/payment-methods`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      closeModal(); loadPayments();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.deletePayment = async function (id) {
    if (!confirm2('Smazat platbu?')) return;
    try { await fetchJSON(`${API}/payment-methods/${id}`, { method: 'DELETE' }); loadPayments(); }
    catch (err) { alert('Chyba: ' + err.message); }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // KATEGORIE
  // ═════════════════════════════════════════════════════════════════════════

  async function loadCategories() {
    const tbody = document.getElementById('categories-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Načítám…</td></tr>';
    try {
      const items = await fetchJSON(`${API}/categories`);
      _catalogCategories = items;
      if (!items.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Žádné kategorie. Klikni „+ Nová kategorie".</td></tr>'; return; }
      tbody.innerHTML = items.map(c => `
        <tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td><code>${esc(c.slug)}</code></td>
          <td style="font-size:18px;">${esc(c.icon || '')}</td>
          <td class="num">${c._count ? c._count.materials : 0}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editCategory(${c.id})">✎</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCategory(${c.id})">×</button>
          </td>
        </tr>`).join('');
    } catch (err) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Chyba: ${esc(err.message)}</td></tr>`; }
  }

  document.getElementById('category-refresh').addEventListener('click', loadCategories);
  document.getElementById('category-new').addEventListener('click', () => editCategory(null));

  window.editCategory = async function (id) {
    let c = { name:'', icon:'', description:'', sort_order:0 };
    if (id) {
      const all = await fetchJSON(`${API}/categories`);
      c = all.find(x => x.id === id) || c;
    }
    openModal(id ? 'Upravit kategorii' : 'Nová kategorie', `
      <div class="form-row">
        <div><label>Název</label><input type="text" id="cat-name" value="${esc(c.name)}"></div>
        <div><label>Ikona (1 emoji)</label><input type="text" id="cat-icon" maxlength="4" value="${esc(c.icon || '')}"></div>
        <div><label>Pořadí</label><input type="number" id="cat-sort" value="${esc(c.sort_order || 0)}"></div>
      </div>
      <div class="form-row">
        <div style="flex:none; width:100%;"><label>Popis</label><textarea id="cat-description" rows="2">${esc(c.description || '')}</textarea></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
        <button class="btn btn-primary" onclick="saveCategory(${id == null ? 'null' : id})">Uložit</button>
      </div>`);
  };

  window.saveCategory = async function (id) {
    const data = {
      name: document.getElementById('cat-name').value.trim(),
      icon: document.getElementById('cat-icon').value.trim() || null,
      description: document.getElementById('cat-description').value.trim() || null,
      sort_order: parseInt(document.getElementById('cat-sort').value, 10) || 0,
    };
    if (!data.name) { alert('Vyplň název.'); return; }
    try {
      if (id) await fetchJSON(`${API}/categories/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      else await fetchJSON(`${API}/categories`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      closeModal(); loadCategories();
    } catch (err) { alert('Chyba: ' + err.message); }
  };

  window.deleteCategory = async function (id) {
    if (!confirm2('Smazat kategorii?')) return;
    try { await fetchJSON(`${API}/categories/${id}`, { method: 'DELETE' }); loadCategories(); }
    catch (err) { alert('Chyba: ' + err.message); }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // NASTAVENÍ
  // ═════════════════════════════════════════════════════════════════════════

  async function loadSettings() {
    try {
      const [s, people] = await Promise.all([
        fetchJSON(`${API}/settings`),
        fetchJSON(`${API}/people`),
      ]);
      const sel = document.getElementById('set-notification-person');
      sel.innerHTML = '<option value="">— žádná —</option>' +
        people.map(p => `<option value="${p.id}"${s && s.notification_person_id===p.id?' selected':''}>${esc(p.first_name)} ${esc(p.last_name)}${p.email ? ' (' + esc(p.email) + ')' : ''}</option>`).join('');
      document.getElementById('set-notification-email').value = (s && s.notification_email) || '';
      document.getElementById('set-default-currency').value = (s && s.default_currency) || 'EUR';
      document.getElementById('set-default-vat').value = (s && s.default_vat_pct) || 21;
      document.getElementById('set-reservation-hours').value = (s && s.reservation_hours) || 72;
      document.getElementById('set-contact-email').value = (s && s.contact_email) || '';
      document.getElementById('set-contact-phone').value = (s && s.contact_phone) || '';
      document.getElementById('set-footer-html').value = (s && s.footer_html) || '';
    } catch (err) {
      document.getElementById('settings-msg').textContent = 'Chyba: ' + err.message;
    }
  }

  document.getElementById('settings-save').addEventListener('click', async () => {
    const data = {
      notification_email: document.getElementById('set-notification-email').value.trim() || null,
      notification_person_id: parseInt(document.getElementById('set-notification-person').value, 10) || null,
      default_currency: (document.getElementById('set-default-currency').value.trim() || 'EUR').toUpperCase(),
      default_vat_pct: parseFloat(document.getElementById('set-default-vat').value) || 21,
      reservation_hours: parseInt(document.getElementById('set-reservation-hours').value, 10) || 72,
      contact_email: document.getElementById('set-contact-email').value.trim() || null,
      contact_phone: document.getElementById('set-contact-phone').value.trim() || null,
      footer_html: document.getElementById('set-footer-html').value.trim() || null,
    };
    const msg = document.getElementById('settings-msg');
    msg.textContent = 'Ukládám…';
    try {
      await fetchJSON(`${API}/settings`, {
        method: 'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(data),
      });
      msg.textContent = '✓ Uloženo';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    } catch (err) { msg.textContent = 'Chyba: ' + err.message; }
  });

  // ─── debounce util + start ────────────────────────────────────────────────

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  loadStats(); // initial load — dashboard tab je defaultní
})();
