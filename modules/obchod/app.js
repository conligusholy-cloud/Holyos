// =============================================================================
// HolyOS — Modul Obchod (frontend logika)
// =============================================================================
// Vanilla JS, žádné frameworky. Komunikace přes /api/sales/*.

(function() {
'use strict';

// ─── Stav ───────────────────────────────────────────────────────────────
let contacts = [];
let events = [];
let stats = { total: 0, by_status: {}, by_potential: {}, by_source: {} };
let searchTimer = null;
let openContactId = null;
let calCursor = new Date(); calCursor.setDate(1);

// Role kontext — kdo je přihlášen, co smí
let roleCtx = { viewerPersonId: null, isAdmin: false, isSalesLead: false, canManageSales: false };
// Seznam obchodníků (jen pro vedoucí/admin) — pro filtr "podle obchodníka" a přidělování
let sellers = [];
// Aktivní filtr "zobraz kontakty obchodníka X" (jen pro vedoucí/admin)
let filterSellerId = '';
// Cache souhrnu provizí pro aktuálně zobrazený pohled (vedoucí přepíná, obchodník = svůj)
let commissionsSummary = null;

const STATUS_LABELS = {
  new: 'Nový', contacted: 'Kontaktován', qualified: 'Kvalifikován',
  meeting: 'Schůzka', proposal: 'Nabídka', won: 'Vyhráno', lost: 'Ztraceno',
};
const POTENTIAL_LABELS = { low: 'Nízký', medium: 'Střední', high: 'Vysoký', hot: '🔥 Horký' };
const SOURCE_LABELS = {
  manual: 'Manuálně', facebook: 'Facebook', instagram: 'Instagram',
  linkedin: 'LinkedIn', web: 'Web', referral: 'Doporučení',
  csv_import: 'CSV import', other: 'Jiný',
};
const NOTE_KIND_LABELS = {
  note: 'Poznámka', call: 'Hovor', email: 'E-mail', meeting: 'Schůzka',
  sms: 'SMS', system: 'Systém', status_change: 'Změna stavu',
};
const EVENT_TYPE_LABELS = {
  meeting: 'Schůzka', call: 'Hovor', demo: 'Demo', followup: 'Follow-up', task: 'Úkol',
};

const PIPELINE_COLS = ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost'];

// ─── Helpery ────────────────────────────────────────────────────────────
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const t = sessionStorage.getItem('token');
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('cs-CZ');
}
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('cs-CZ') + ' ' + dt.toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' });
}
function fmtMoney(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
}
function toLocalInputDT(d) {
  if (!d) return '';
  const dt = new Date(d);
  const off = dt.getTimezoneOffset() * 60000;
  return new Date(dt.getTime() - off).toISOString().slice(0, 16);
}

async function api(method, path, body) {
  const opts = { method, headers: authHeaders(), credentials: 'include' };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch('/api/sales' + path, opts);
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const e = await r.json(); if (e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

// ─── Načítání ───────────────────────────────────────────────────────────
async function loadStats() {
  try { stats = await api('GET', '/contacts/stats'); }
  catch (e) { console.error('Stats:', e); stats = { total: 0, by_status: {}, by_potential: {}, by_source: {} }; }
  renderStats();
}

async function loadContacts() {
  try {
    const params = new URLSearchParams();
    const fStatus    = document.getElementById('f-status').value;
    const fPotential = document.getElementById('f-potential').value;
    const fSource    = document.getElementById('f-source').value;
    const fConv      = document.getElementById('f-converted').value;
    const search     = document.getElementById('search').value.trim();
    if (fStatus)    params.set('status',    fStatus);
    if (fPotential) params.set('potential', fPotential);
    if (fSource)    params.set('source',    fSource);
    if (fConv)      params.set('converted', fConv);
    if (search)     params.set('search',    search);
    if (roleCtx.canManageSales && filterSellerId) params.set('seller_id', filterSellerId);
    contacts = await api('GET', '/contacts' + (params.toString() ? '?' + params.toString() : ''));
  } catch (e) {
    console.error('Contacts:', e);
    contacts = [];
    alert('Chyba při načítání kontaktů: ' + e.message);
  }
  document.getElementById('hdr-count').textContent = contacts.length ? '(' + contacts.length + ')' : '';
  renderContactsTable();
  renderPipeline();
}

// ─── Role + obchodníci ──────────────────────────────────────────────────
async function loadRoleAndSellers() {
  try { roleCtx = await api('GET', '/me'); }
  catch (e) { console.error('Role:', e); }
  if (roleCtx && roleCtx.canManageSales) {
    try { sellers = await api('GET', '/sellers'); }
    catch (e) { console.error('Sellers:', e); sellers = []; }
  }
  // Vyrenderuje filtr Obchodník + případnou záložku "Mé provize"
  renderRoleSpecificUI();
}

function renderRoleSpecificUI() {
  // Filtr "Obchodník" v toolbar — jen pro vedoucí/admin
  const slot = document.getElementById('seller-filter-slot');
  if (slot) {
    if (roleCtx.canManageSales) {
      const opts = ['<option value="">Všichni obchodníci</option>']
        .concat(sellers.map(s => `<option value="${s.id}" ${filterSellerId == s.id ? 'selected' : ''}>${esc(s.first_name)} ${esc(s.last_name || '')}</option>`));
      slot.innerHTML = `<select class="filter-select" id="f-seller" onchange="onSellerFilter()">${opts.join('')}</select>`;
    } else {
      slot.innerHTML = '';
    }
  }
  // Záložka "Mé provize" — vidí jak obchodník (sebe), tak vedoucí (přepínatelně)
  const tabSlot = document.getElementById('commissions-tab-slot');
  if (tabSlot) {
    tabSlot.innerHTML = '<button class="view-tab" data-view="commissions" onclick="switchView(\'commissions\')">💰 ' + (roleCtx.canManageSales ? 'Provize' : 'Mé provize') + '</button>';
  }
}

window.onSellerFilter = function() {
  const el = document.getElementById('f-seller');
  filterSellerId = el ? el.value : '';
  reload();
};

async function loadEvents() {
  try {
    const from = new Date(calCursor); from.setDate(1);
    const to   = new Date(calCursor); to.setMonth(to.getMonth() + 1); to.setDate(0);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    events = await api('GET', '/events?' + params.toString());
  } catch (e) { console.error('Events:', e); events = []; }
  renderCalendar();
}

// ─── Render: statistiky ─────────────────────────────────────────────────
function renderStats() {
  const row = document.getElementById('stats-row');
  const total = stats.total || 0;
  const hot = stats.by_potential.hot || 0;
  const high = stats.by_potential.high || 0;
  const won = stats.by_status.won || 0;
  const newCount = stats.by_status.new || 0;
  const meeting = stats.by_status.meeting || 0;

  row.innerHTML = `
    <div class="stat-card" onclick="clearFiltersAndReload()">
      <div class="stat-label">Celkem</div><div class="stat-value">${total}</div>
    </div>
    <div class="stat-card hot" onclick="setFilterAndReload('f-potential', 'hot')">
      <div class="stat-label">🔥 Horké</div><div class="stat-value">${hot}</div>
    </div>
    <div class="stat-card high" onclick="setFilterAndReload('f-potential', 'high')">
      <div class="stat-label">Vysoký potenciál</div><div class="stat-value">${high}</div>
    </div>
    <div class="stat-card" onclick="setFilterAndReload('f-status', 'new')">
      <div class="stat-label">Nové leady</div><div class="stat-value">${newCount}</div>
    </div>
    <div class="stat-card" onclick="setFilterAndReload('f-status', 'meeting')">
      <div class="stat-label">Schůzky</div><div class="stat-value">${meeting}</div>
    </div>
    <div class="stat-card won" onclick="setFilterAndReload('f-status', 'won')">
      <div class="stat-label">Vyhrané</div><div class="stat-value">${won}</div>
    </div>
  `;
}

window.clearFiltersAndReload = function() {
  ['f-status','f-potential','f-source','f-converted'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('search').value = '';
  reload();
};
window.setFilterAndReload = function(id, v) {
  document.getElementById(id).value = v;
  reload();
};

// ─── Render: tabulka ────────────────────────────────────────────────────
function renderContactsTable() {
  const container = document.getElementById('contacts-table');
  if (!contacts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>Žádné kontakty</h3>
        <p>Vytvořte první kontakt tlačítkem „+ Nový kontakt" v hlavičce.</p>
      </div>`;
    return;
  }

  let html = '<table class="data-table"><thead><tr>' +
    '<th>Jméno</th><th>Firma</th><th>Kontakt</th>' +
    '<th>Zdroj</th><th>Potenciál</th><th>Stav</th>' +
    '<th>Hodnota</th><th>Další akce</th><th>Vytvořeno</th><th></th>' +
    '</tr></thead><tbody>';

  for (const c of contacts) {
    const fullName = esc(c.first_name) + (c.last_name ? ' ' + esc(c.last_name) : '');
    const contactStr = [c.email, c.phone].filter(Boolean).map(esc).join('<br>');
    const convertedPill = c.converted_company
      ? `<br><span class="converted-pill">✓ ${esc(c.converted_company.name)}</span>`
      : '';

    html += `<tr onclick="openContactDetail(${c.id})">
      <td><strong>${fullName}</strong>${convertedPill}</td>
      <td>${esc(c.company_name || '—')}${c.position ? '<br><span style="font-size:11px;color:var(--text2)">' + esc(c.position) + '</span>' : ''}</td>
      <td>${contactStr || '—'}</td>
      <td><span class="badge badge-source">${esc(SOURCE_LABELS[c.source] || c.source)}</span></td>
      <td><span class="badge badge-pot-${esc(c.potential)}">${esc(POTENTIAL_LABELS[c.potential] || c.potential)}</span></td>
      <td><span class="badge badge-status-${esc(c.status)}">${esc(STATUS_LABELS[c.status] || c.status)}</span></td>
      <td>${fmtMoney(c.expected_value)}</td>
      <td>${c.next_action_at ? fmtDate(c.next_action_at) : '—'}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openContactDetail(${c.id})">Detail</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Render: pipeline (kanban) ──────────────────────────────────────────
function renderPipeline() {
  const board = document.getElementById('pipeline-board');
  const byStatus = {};
  PIPELINE_COLS.forEach(s => { byStatus[s] = []; });
  for (const c of contacts) {
    if (byStatus[c.status]) byStatus[c.status].push(c);
  }

  let html = '';
  for (const status of PIPELINE_COLS) {
    const items = byStatus[status];
    const sumValue = items.reduce((acc, c) => acc + (Number(c.expected_value) || 0), 0);
    html += `<div class="pipe-col">
      <header>
        <h4><span class="badge badge-status-${status}">${esc(STATUS_LABELS[status])}</span></h4>
        <span class="cnt">${items.length}${sumValue ? ' · ' + fmtMoney(sumValue) : ''}</span>
      </header>`;
    if (!items.length) {
      html += '<div style="font-size:11px; color:var(--text2); text-align:center; padding:18px 4px;">—</div>';
    } else {
      for (const c of items) {
        const fullName = esc(c.first_name) + (c.last_name ? ' ' + esc(c.last_name) : '');
        html += `<div class="pipe-card" onclick="openContactDetail(${c.id})">
          <div class="nm">${fullName}</div>
          <div class="cmp">${esc(c.company_name || '—')}</div>
          <div class="row">
            <span class="badge badge-pot-${esc(c.potential)}">${esc(POTENTIAL_LABELS[c.potential])}</span>
            ${c.expected_value ? '<span style="font-size:11px;color:var(--text2)">' + fmtMoney(c.expected_value) + '</span>' : ''}
          </div>
        </div>`;
      }
    }
    html += '</div>';
  }
  board.innerHTML = html;
}

// ─── Render: kalendář ───────────────────────────────────────────────────
function renderCalendar() {
  const title = document.getElementById('cal-title');
  const grid = document.getElementById('cal-grid');
  const monthNames = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
  title.textContent = monthNames[calCursor.getMonth()] + ' ' + calCursor.getFullYear();

  let html = '';
  ['Po','Út','St','Čt','Pá','So','Ne'].forEach(d => { html += `<div class="cal-cell-h">${d}</div>`; });

  const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
  const last  = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 0);
  // pondělí = 1, neděle = 0 — chceme pondělí jako start
  let startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const start = new Date(first); start.setDate(first.getDate() - startOffset);

  const today = new Date(); today.setHours(0,0,0,0);

  // skupina událostí podle data (YYYY-MM-DD)
  const byDate = {};
  for (const ev of events) {
    const d = new Date(ev.start_at);
    const key = d.toISOString().slice(0, 10);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(ev);
  }

  for (let i = 0; i < 42; i++) {
    const dt = new Date(start); dt.setDate(start.getDate() + i);
    const isOther = dt.getMonth() !== calCursor.getMonth();
    const isToday = dt.getTime() === today.getTime();
    const key = dt.toISOString().slice(0, 10);
    const dayEvents = byDate[key] || [];

    let cellHtml = `<div class="cal-cell ${isOther ? 'other' : ''} ${isToday ? 'today' : ''}">
      <div class="day">${dt.getDate()}</div>`;
    for (const ev of dayEvents.slice(0, 4)) {
      const cls = (ev.event_type || 'meeting') + (ev.status === 'done' ? ' done' : '');
      const time = ev.all_day ? '' : new Date(ev.start_at).toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' }) + ' ';
      cellHtml += `<div class="ev ${cls}" onclick="event.stopPropagation(); openEventModal(${ev.id})" title="${esc(ev.title)}">${esc(time + ev.title)}</div>`;
    }
    if (dayEvents.length > 4) cellHtml += `<div style="font-size:10px; color:var(--text2);">+${dayEvents.length - 4} dalších</div>`;
    cellHtml += '</div>';
    html += cellHtml;
    if (i >= 35 && dt > last) break; // 5 nebo 6 řádků
  }

  grid.innerHTML = html;
}

window.calPrev  = function() { calCursor.setMonth(calCursor.getMonth() - 1); loadEvents(); };
window.calNext  = function() { calCursor.setMonth(calCursor.getMonth() + 1); loadEvents(); };
window.calToday = function() { calCursor = new Date(); calCursor.setDate(1); loadEvents(); };

// ─── Hlavní záložky ─────────────────────────────────────────────────────
window.switchView = function(v) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  document.querySelectorAll('.view-panel').forEach(p => p.classList.toggle('active', p.dataset.view === v));
  if (v === 'calendar')    loadEvents();
  if (v === 'commissions') loadCommissions();
};

// ─── Mé provize / Provize (vedoucí přepíná obchodníka) ──────────────────
async function loadCommissions(personIdOverride) {
  const panel = document.getElementById('commissions-panel');
  if (!panel) return;
  panel.innerHTML = '<div style="padding:24px; color:var(--text2);">Načítám…</div>';
  try {
    let url = '/commissions/summary';
    const pid = personIdOverride != null ? personIdOverride : (roleCtx.canManageSales ? (document.getElementById('comm-seller') && document.getElementById('comm-seller').value) : null);
    if (pid) url += '?person_id=' + encodeURIComponent(pid);
    commissionsSummary = await api('GET', url);
  } catch (e) {
    panel.innerHTML = '<div style="padding:24px; color:#ef4444;">Chyba: ' + esc(e.message) + '</div>';
    return;
  }
  renderCommissions();
}

function renderCommissions() {
  const panel = document.getElementById('commissions-panel');
  if (!panel) return;
  const s = commissionsSummary;
  if (!s) { panel.innerHTML = ''; return; }
  const headerControls = roleCtx.canManageSales
    ? `<div style="display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:wrap;">
        <label style="font-size:12px; color:var(--text2);">Obchodník:</label>
        <select id="comm-seller" class="filter-select" onchange="loadCommissions(this.value)">
          ${sellers.map(x => `<option value="${x.id}" ${s.person && s.person.id === x.id ? 'selected' : ''}>${esc(x.first_name)} ${esc(x.last_name || '')}</option>`).join('')}
        </select>
       </div>`
    : `<div style="margin-bottom:14px; font-size:14px; color:var(--text2);">Provize pro: <strong>${esc((s.person && s.person.first_name) || '')} ${esc((s.person && s.person.last_name) || '')}</strong></div>`;

  const totalsRow = `
    <div class="stats-row" style="margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Kontakty</div><div class="stat-value">${s.totals.contacts}</div></div>
      <div class="stat-card won"><div class="stat-label">Vyhráno</div><div class="stat-value">${s.totals.won_count}</div></div>
      <div class="stat-card"><div class="stat-label">Předpokl. obrat</div><div class="stat-value">${fmtMoney(s.totals.expected_value)}</div></div>
      <div class="stat-card high"><div class="stat-label">Předpokl. provize</div><div class="stat-value">${fmtMoney(s.totals.est_commission)}</div></div>
      <div class="stat-card hot"><div class="stat-label">Uzamčeno</div><div class="stat-value">${fmtMoney(s.totals.locked_commission)}</div></div>
    </div>`;

  if (!s.items.length) {
    panel.innerHTML = headerControls + totalsRow + '<div class="empty-state"><div class="empty-icon">💸</div><h3>Žádné přidělené kontakty</h3><p>Až ti vedoucí přidělí kontakty, uvidíš tady svoje provize.</p></div>';
    return;
  }

  let table = '<table class="data-table"><thead><tr>'
    + '<th>Kontakt</th><th>Firma</th><th>Stav</th>'
    + '<th>Hodnota</th><th>Aktuální %</th><th>Uzamčené %</th><th>Odhad provize</th><th></th>'
    + '</tr></thead><tbody>';
  for (const it of s.items) {
    const c = it.contact;
    const fullName = esc(c.first_name) + (c.last_name ? ' ' + esc(c.last_name) : '');
    const wonBadge = it.is_won ? '<span class="badge badge-status-won">✓ Vyhráno</span>' : '';
    const lockBadge = it.is_locked ? '<span class="badge badge-status-proposal" style="margin-left:4px;">🔒 Uzamčeno</span>' : '';
    table += `<tr onclick="openContactDetail(${c.id})">
      <td><strong>${fullName}</strong> ${wonBadge}${lockBadge}</td>
      <td>${esc(c.company_name || '—')}</td>
      <td><span class="badge badge-status-${esc(c.status)}">${esc(STATUS_LABELS[c.status] || c.status)}</span></td>
      <td>${fmtMoney(c.expected_value)}</td>
      <td>${it.commission_pct != null ? Number(it.commission_pct).toFixed(2) + ' %' : '—'}</td>
      <td>${it.commission_locked_pct != null ? Number(it.commission_locked_pct).toFixed(2) + ' %' : '—'}</td>
      <td><strong>${fmtMoney(it.est_commission)}</strong></td>
      <td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openContactDetail(${c.id})">Detail</button></td>
    </tr>`;
  }
  table += '</tbody></table>';
  panel.innerHTML = headerControls + totalsRow + table;
}
window.loadCommissions = loadCommissions;

// ─── Search & filter ────────────────────────────────────────────────────
window.onSearch = function() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { reload(); }, 250);
};

window.reload = async function() {
  await Promise.all([loadContacts(), loadStats()]);
};

// ─── Modal helpers ──────────────────────────────────────────────────────
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
window.closeModal = closeModal;

function setupModalCloseOnOverlay() {
  const root = document.getElementById('modal-root');
  root.addEventListener('click', (e) => { if (e.target === root.querySelector('.modal-overlay')) closeModal(); });
}

// ─── Modal: nový / editace kontaktu ─────────────────────────────────────
window.openContactModal = function(prefill) {
  const c = prefill || {};
  const isEdit = !!c.id;
  const html = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h2>${isEdit ? '✏️ Upravit kontakt' : '➕ Nový kontakt'}</h2>
      <form id="contact-form" onsubmit="event.preventDefault(); saveContact(${isEdit ? c.id : 'null'})">
        <div class="form-section-title">Osoba</div>
        <div class="form-grid">
          <div class="form-group"><label>Jméno *</label><input name="first_name" required value="${esc(c.first_name || '')}"></div>
          <div class="form-group"><label>Příjmení</label><input name="last_name" value="${esc(c.last_name || '')}"></div>
          <div class="form-group"><label>E-mail</label><input name="email" type="email" value="${esc(c.email || '')}"></div>
          <div class="form-group"><label>Telefon</label><input name="phone" value="${esc(c.phone || '')}"></div>
        </div>

        <div class="form-section-title">Firma / kontext</div>
        <div class="form-grid">
          <div class="form-group"><label>Název firmy</label><input name="company_name" value="${esc(c.company_name || '')}"></div>
          <div class="form-group"><label>Pozice</label><input name="position" value="${esc(c.position || '')}" placeholder="CEO, majitel, manažer..."></div>
          <div class="form-group full"><label>Web</label><input name="web" value="${esc(c.web || '')}" placeholder="https://..."></div>
          <div class="form-group full"><label>Adresa</label><input name="address" value="${esc(c.address || '')}"></div>
          <div class="form-group"><label>Město</label><input name="city" value="${esc(c.city || '')}"></div>
          <div class="form-group"><label>PSČ</label><input name="zip" value="${esc(c.zip || '')}"></div>
        </div>

        <div class="form-section-title">Klasifikace</div>
        <div class="form-grid">
          <div class="form-group"><label>Zdroj</label>
            <select name="source">
              ${Object.entries(SOURCE_LABELS).map(([k,v]) => `<option value="${k}" ${c.source===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Stav</label>
            <select name="status">
              ${Object.entries(STATUS_LABELS).map(([k,v]) => `<option value="${k}" ${c.status===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Potenciál</label>
            <select name="potential">
              ${Object.entries(POTENTIAL_LABELS).map(([k,v]) => `<option value="${k}" ${(c.potential||'medium')===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Předpokládaná hodnota (Kč)</label>
            <input name="expected_value" type="number" min="0" step="1000" value="${c.expected_value != null ? c.expected_value : ''}">
          </div>
          <div class="form-group"><label>Další akce — datum</label>
            <input name="next_action_at" type="datetime-local" value="${c.next_action_at ? toLocalInputDT(c.next_action_at) : ''}">
          </div>
          <div class="form-group"><label>Detail zdroje</label>
            <input name="source_detail" value="${esc(c.source_detail || '')}" placeholder="kampaň, ID inzerátu...">
          </div>
        </div>

        <div class="form-section-title">Poznámka</div>
        <div class="form-grid">
          <div class="form-group full"><label>Souhrnná poznámka</label>
            <textarea name="notes" placeholder="Krátké info o kontaktu, kontext, požadavky...">${esc(c.notes || '')}</textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" onclick="deleteContact(${c.id})">🗑 Smazat</button>` : ''}
          <button type="submit" class="btn btn-primary">${isEdit ? '💾 Uložit' : '➕ Vytvořit'}</button>
        </div>
      </form>
    </div>
    </div>`;
  document.getElementById('modal-root').innerHTML = html;
};

window.saveContact = async function(id) {
  const form = document.getElementById('contact-form');
  const fd = new FormData(form);
  const data = {};
  for (const [k, v] of fd.entries()) data[k] = v === '' ? null : v;
  try {
    const method = id ? 'PUT' : 'POST';
    const path = id ? '/contacts/' + id : '/contacts';
    const saved = await api(method, path, data);
    closeModal();
    await reload();
    if (id) {
      // Pokud upravujeme z detailu, znovu otevřeme detail
      if (openContactId === id) openContactDetail(id);
    } else if (saved && saved.id) {
      openContactDetail(saved.id);
    }
  } catch (e) { alert('Chyba: ' + e.message); }
};

window.deleteContact = async function(id) {
  if (!confirm('Opravdu smazat tento kontakt a celou jeho historii?')) return;
  try {
    await api('DELETE', '/contacts/' + id);
    closeModal();
    openContactId = null;
    await reload();
  } catch (e) { alert('Chyba: ' + e.message); }
};

// ─── Detail modal ───────────────────────────────────────────────────────
window.openContactDetail = async function(id) {
  openContactId = id;
  let contact;
  try { contact = await api('GET', '/contacts/' + id); }
  catch (e) { alert('Chyba: ' + e.message); return; }

  const fullName = esc(contact.first_name) + (contact.last_name ? ' ' + esc(contact.last_name) : '');
  const convertedRow = contact.converted_company
    ? `<div style="padding:10px 14px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); border-radius:8px; margin-bottom:14px;">
         ✅ <strong>Převedeno na firmu</strong> #${contact.converted_company.id} — ${esc(contact.converted_company.name)}
         (${fmtDateTime(contact.converted_at)})
       </div>`
    : '';

  const html = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="width:880px;">
      <h2 style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span>${fullName}</span>
        <span class="badge badge-status-${esc(contact.status)}">${esc(STATUS_LABELS[contact.status])}</span>
        <span class="badge badge-pot-${esc(contact.potential)}">${esc(POTENTIAL_LABELS[contact.potential])}</span>
        <span class="badge badge-source">${esc(SOURCE_LABELS[contact.source] || contact.source)}</span>
        <button class="btn btn-sm btn-secondary" style="margin-left:auto;" onclick="openContactModal(${JSON.stringify(contact).replace(/"/g, '&quot;')})">✏️ Upravit</button>
      </h2>
      ${convertedRow}
      <div class="det-tabs">
        <button class="det-tab active" data-panel="info"     onclick="switchDetTab('info')">ℹ️ Info</button>
        <button class="det-tab"        data-panel="timeline" onclick="switchDetTab('timeline')">💬 Časová osa (${contact.sales_notes.length})</button>
        <button class="det-tab"        data-panel="events"   onclick="switchDetTab('events')">📅 Události (${contact.sales_events.length})</button>
        <button class="det-tab"        data-panel="assignments" onclick="switchDetTab('assignments')">👥 Obchodníci (${(contact.assignments || []).length})</button>
        ${!contact.converted_company_id ? '<button class="det-tab" data-panel="convert" onclick="switchDetTab(\'convert\')">🏢 Převést na firmu</button>' : ''}
      </div>

      <div class="det-panel active" data-panel="info">
        ${renderInfoPanel(contact)}
      </div>
      <div class="det-panel" data-panel="timeline">
        ${renderTimelinePanel(contact)}
      </div>
      <div class="det-panel" data-panel="events">
        ${renderEventsPanel(contact)}
      </div>
      <div class="det-panel" data-panel="assignments">
        ${renderAssignmentsPanel(contact)}
      </div>
      ${!contact.converted_company_id ? '<div class="det-panel" data-panel="convert">' + renderConvertPanel(contact) + '</div>' : ''}

      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Zavřít</button>
      </div>
    </div>
    </div>`;
  document.getElementById('modal-root').innerHTML = html;
};

window.switchDetTab = function(p) {
  document.querySelectorAll('.det-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === p));
  document.querySelectorAll('.det-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === p));
};

function renderInfoPanel(c) {
  const row = (label, value) => value ? `<div style="margin-bottom:10px;"><div style="font-size:11px; color:var(--text2); text-transform:uppercase;">${label}</div><div style="font-size:14px;">${value}</div></div>` : '';
  return `<div class="form-grid">
    <div>
      ${row('E-mail', c.email ? `<a href="mailto:${esc(c.email)}" style="color:#ec4899;">${esc(c.email)}</a>` : '')}
      ${row('Telefon', c.phone ? `<a href="tel:${esc(c.phone)}" style="color:#ec4899;">${esc(c.phone)}</a>` : '')}
      ${row('Firma', esc(c.company_name))}
      ${row('Pozice', esc(c.position))}
      ${row('Web', c.web ? `<a href="${esc(c.web)}" target="_blank" rel="noopener" style="color:#ec4899;">${esc(c.web)}</a>` : '')}
      ${row('LinkedIn', c.linkedin_url ? `<a href="${esc(c.linkedin_url)}" target="_blank" rel="noopener" style="color:#0a66c2;">${esc(c.linkedin_url)}</a>` : '')}
    </div>
    <div>
      ${row('Adresa', [c.address, c.city, c.zip].filter(Boolean).map(esc).join(', '))}
      ${row('Předpokládaná hodnota', fmtMoney(c.expected_value))}
      ${row('Další akce', c.next_action_at ? fmtDateTime(c.next_action_at) : '')}
      ${row('Zdroj — detail', esc(c.source_detail))}
      ${row('Přiřazeno', c.assigned_to ? esc(c.assigned_to.first_name + ' ' + (c.assigned_to.last_name || '')) : '')}
      ${row('Vytvořeno', fmtDateTime(c.created_at))}
    </div>
    <div class="form-group full">
      ${c.notes ? `<div style="font-size:11px; color:var(--text2); text-transform:uppercase; margin-bottom:4px;">Poznámka</div>
        <div style="padding:10px 14px; background:var(--bg); border:1px solid var(--border); border-radius:8px; white-space:pre-wrap;">${esc(c.notes)}</div>` : ''}
    </div>
  </div>`;
}

function renderTimelinePanel(c) {
  let html = `
    <div class="note-form">
      <div class="row">
        <select id="note-kind">
          <option value="note">📝 Poznámka</option>
          <option value="call">📞 Hovor</option>
          <option value="email">✉️ E-mail</option>
          <option value="meeting">🤝 Schůzka</option>
          <option value="sms">💬 SMS</option>
        </select>
        <button class="btn btn-sm btn-primary" style="margin-left:auto;" onclick="addNote(${c.id})">+ Přidat záznam</button>
      </div>
      <textarea id="note-content" placeholder="Co se domluvilo, co dalšího udělat…"></textarea>
    </div>
    <div class="timeline">`;
  if (!c.sales_notes.length) {
    html += '<div style="text-align:center; color:var(--text2); padding:24px;">Zatím žádné záznamy.</div>';
  } else {
    for (const n of c.sales_notes) {
      const author = n.author ? esc(n.author.first_name + ' ' + (n.author.last_name || '')) : 'Systém';
      html += `<div class="timeline-item">
        <header>
          <span><span class="kind-pill ${esc(n.kind)}">${esc(NOTE_KIND_LABELS[n.kind] || n.kind)}</span> · ${esc(author)}</span>
          <span>${fmtDateTime(n.created_at)}${n.kind !== 'system' && n.kind !== 'status_change' ? ' <span class="del" onclick="deleteNote(' + c.id + ',' + n.id + ')">✕</span>' : ''}</span>
        </header>
        <div class="body">${esc(n.content)}</div>
      </div>`;
    }
  }
  html += '</div>';
  return html;
}

window.addNote = async function(contactId) {
  const kind = document.getElementById('note-kind').value;
  const content = document.getElementById('note-content').value.trim();
  if (!content) { alert('Zadejte obsah poznámky'); return; }
  try {
    await api('POST', '/contacts/' + contactId + '/notes', { kind, content });
    openContactDetail(contactId);
  } catch (e) { alert('Chyba: ' + e.message); }
};

window.deleteNote = async function(contactId, noteId) {
  if (!confirm('Smazat tento záznam?')) return;
  try {
    await api('DELETE', '/contacts/' + contactId + '/notes/' + noteId);
    openContactDetail(contactId);
  } catch (e) { alert('Chyba: ' + e.message); }
};

function renderEventsPanel(c) {
  let html = `<div style="margin-bottom:12px;">
    <button class="btn btn-sm btn-primary" onclick="openEventModal(null, ${c.id})">+ Nová událost</button>
  </div>`;
  if (!c.sales_events.length) {
    html += '<div style="text-align:center; color:var(--text2); padding:24px;">Zatím žádné události.</div>';
    return html;
  }
  html += '<div class="timeline">';
  for (const ev of c.sales_events) {
    const typeBadge = `<span class="kind-pill ${esc(ev.event_type)}">${esc(EVENT_TYPE_LABELS[ev.event_type] || ev.event_type)}</span>`;
    const doneBadge = ev.status === 'done' ? '<span class="badge badge-status-won">✓ Hotovo</span>' :
                      ev.status === 'cancelled' ? '<span class="badge badge-status-lost">Zrušeno</span>' : '';
    html += `<div class="timeline-item" onclick="openEventModal(${ev.id})" style="cursor:pointer;">
      <header>
        <span>${typeBadge} · <strong>${esc(ev.title)}</strong> ${doneBadge}</span>
        <span>${fmtDateTime(ev.start_at)}</span>
      </header>
      ${ev.location ? '<div class="body" style="font-size:12px; color:var(--text2);">📍 ' + esc(ev.location) + '</div>' : ''}
      ${ev.description ? '<div class="body">' + esc(ev.description) + '</div>' : ''}
    </div>`;
  }
  html += '</div>';
  return html;
}

// ─── Přidělení obchodníků + provize ─────────────────────────────────────
function renderAssignmentsPanel(c) {
  const assignments = c.assignments || [];
  const canManage = !!roleCtx.canManageSales;

  let html = '<div style="padding:10px 14px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:8px; margin-bottom:14px; font-size:13px;">'
    + (canManage
        ? 'Přiděl kontakt jednomu nebo více obchodníkům. Provizi nastavuj individuálně. Po zaplacení objednávky % uzamkni — další změny defaultu už neovlivní vyplacenou provizi.'
        : 'Tady vidíš obchodníky přidělené k tomuto kontaktu a aktuální % provize. Změnu provádí vedoucí obchodu.')
    + '</div>';

  if (canManage) {
    const sellerOpts = sellers
      .filter(s => !assignments.some(a => a.person_id === s.id))
      .map(s => `<option value="${s.id}">${esc(s.first_name)} ${esc(s.last_name || '')}${s.role && s.role.name === 'Vedoucí obchodu' ? ' (vedoucí)' : ''}</option>`)
      .join('');
    html += `<div class="note-form" style="margin-bottom:14px;">
      <div class="row" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <label style="font-size:12px; color:var(--text2);">Přidělit obchodníka:</label>
        <select id="asg-person" style="flex:1; min-width:180px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:7px 9px; color:var(--text);">
          ${sellerOpts || '<option value="">— Nikdo k přidělení —</option>'}
        </select>
        <label style="font-size:12px; color:var(--text2);">% provize:</label>
        <input id="asg-pct" type="number" step="0.5" min="0" max="100" placeholder="(volitelně)" style="width:120px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:7px 9px; color:var(--text);">
        <button class="btn btn-sm btn-primary" onclick="addAssignment(${c.id})" ${!sellerOpts ? 'disabled' : ''}>+ Přidělit</button>
      </div>
    </div>`;
  }

  if (!assignments.length) {
    html += '<div style="text-align:center; color:var(--text2); padding:24px;">Zatím není přidělen žádný obchodník.</div>';
    return html;
  }

  html += '<table class="data-table"><thead><tr>'
    + '<th>Obchodník</th><th>Provize (%)</th><th>Uzamčená (%)</th><th>Přidělil</th><th>Datum</th>'
    + (canManage ? '<th>Akce</th>' : '')
    + '</tr></thead><tbody>';
  for (const a of assignments) {
    const p = a.person || {};
    const fullName = esc(p.first_name || '?') + (p.last_name ? ' ' + esc(p.last_name) : '');
    const by = a.assigned_by ? esc(a.assigned_by.first_name) + ' ' + esc(a.assigned_by.last_name || '') : '—';
    const lockBadge = a.commission_locked_at ? ' <span class="badge badge-status-proposal">🔒</span>' : '';
    const pctCell = canManage && !a.commission_locked_at
      ? `<input type="number" step="0.5" min="0" max="100" id="pct-${c.id}-${p.id}" value="${a.commission_pct != null ? a.commission_pct : ''}" placeholder="—" style="width:90px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:5px 8px; color:var(--text); font-size:12px;">`
      : (a.commission_pct != null ? Number(a.commission_pct).toFixed(2) + ' %' : '—');
    const lockedCell = a.commission_locked_pct != null ? Number(a.commission_locked_pct).toFixed(2) + ' %' : '—';
    const actionCell = canManage
      ? `<td style="white-space:nowrap;">`
        + (!a.commission_locked_at
            ? `<button class="btn btn-sm btn-secondary" onclick="updateAssignmentPct(${c.id}, ${p.id})">💾 Uložit %</button>
               <button class="btn btn-sm btn-success" onclick="lockAssignment(${c.id}, ${p.id})">🔒 Uzamknout</button>`
            : `<button class="btn btn-sm btn-secondary" onclick="unlockAssignment(${c.id}, ${p.id})">🔓 Odemknout</button>`)
        + ` <button class="btn btn-sm btn-danger" onclick="removeAssignment(${c.id}, ${p.id})">🗑</button>`
      + `</td>`
      : '';
    html += `<tr>
      <td><strong>${fullName}</strong>${lockBadge}</td>
      <td>${pctCell}</td>
      <td>${lockedCell}</td>
      <td>${by}</td>
      <td>${fmtDateTime(a.created_at)}</td>
      ${actionCell}
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

window.addAssignment = async function(contactId) {
  const personId = document.getElementById('asg-person').value;
  const pct      = document.getElementById('asg-pct').value;
  if (!personId) { alert('Vyberte obchodníka'); return; }
  try {
    await api('POST', '/contacts/' + contactId + '/assignments',
      { person_id: parseInt(personId, 10), commission_pct: pct === '' ? null : Number(pct) });
    openContactDetail(contactId);
  } catch (e) { alert('Chyba: ' + e.message); }
};

window.updateAssignmentPct = async function(contactId, personId) {
  const el = document.getElementById('pct-' + contactId + '-' + personId);
  const pct = el ? el.value : '';
  try {
    await api('PUT', '/contacts/' + contactId + '/assignments/' + personId,
      { commission_pct: pct === '' ? null : Number(pct) });
    openContactDetail(contactId);
  } catch (e) { alert('Chyba: ' + e.message); }
};

window.lockAssignment = async function(contactId, personId) {
  if (!confirm('Uzamknout aktuální % provize? Další změny defaultu už neovlivní tento záznam — používej až po zaplacení objednávky.')) return;
  const el = document.getElementById('pct-' + contactId + '-' + personId);
  const pct = el && el.value !== '' ? Number(el.value) : undefined;
  try {
    await api('POST', '/contacts/' + contactId + '/assignments/' + personId + '/lock',
      pct != null ? { commission_pct: pct } : {});
    openContactDetail(contactId);
  } catch (e) { alert('Chyba: ' + e.message); }
};

window.unlockAssignment = async function(contactId, personId) {
  if (!confirm('Odemknout uzamčenou provizi? Bude možné ji znovu měnit.')) return;
  try {
    await api('POST', '/contacts/' + contactId + '/assignments/' + personId + '/unlock');
    openContactDetail(contactId);
  } catch (e) { alert('Chyba: ' + e.message); }
};

window.removeAssignment = async function(contactId, personId) {
  if (!confirm('Odebrat tohoto obchodníka z kontaktu?')) return;
  try {
    await api('DELETE', '/contacts/' + contactId + '/assignments/' + personId);
    openContactDetail(contactId);
  } catch (e) { alert('Chyba: ' + e.message); }
};

function renderConvertPanel(c) {
  return `<form id="convert-form" onsubmit="event.preventDefault(); convertContact(${c.id})">
    <div style="padding:12px 14px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.3); border-radius:8px; margin-bottom:14px; font-size:13px;">
      Po převedení vznikne nová <strong>firma</strong> v adresáři a kontakt se označí jako „Vyhráno".
      Od té chvíle můžete pro firmu vytvářet objednávky standardním způsobem.
    </div>
    <div class="form-grid">
      <div class="form-group"><label>Název firmy *</label><input name="name" required value="${esc(c.company_name || (c.first_name + ' ' + (c.last_name || '')).trim())}"></div>
      <div class="form-group"><label>Typ</label>
        <select name="type">
          <option value="customer" selected>Zákazník</option>
          <option value="supplier">Dodavatel</option>
          <option value="both">Obojí</option>
          <option value="cooperation">Kooperace</option>
        </select>
      </div>
      <div class="form-group"><label>IČO</label><input name="ico" value=""></div>
      <div class="form-group"><label>DIČ</label><input name="dic" value=""></div>
      <div class="form-group full"><label>Adresa</label><input name="address" value="${esc(c.address || '')}"></div>
      <div class="form-group"><label>Město</label><input name="city" value="${esc(c.city || '')}"></div>
      <div class="form-group"><label>PSČ</label><input name="zip" value="${esc(c.zip || '')}"></div>
      <div class="form-group"><label>Kontaktní osoba</label><input name="contact_person" value="${esc((c.first_name + ' ' + (c.last_name || '')).trim())}"></div>
      <div class="form-group"><label>Splatnost (dnů)</label><input name="payment_terms_days" type="number" value="14"></div>
      <div class="form-group"><label>E-mail</label><input name="email" value="${esc(c.email || '')}"></div>
      <div class="form-group"><label>Telefon</label><input name="phone" value="${esc(c.phone || '')}"></div>
      <div class="form-group full"><label>Bankovní účet</label><input name="bank_account" value=""></div>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-success">✓ Převést na firmu a označit „Vyhráno"</button>
    </div>
  </form>`;
}

window.convertContact = async function(id) {
  const form = document.getElementById('convert-form');
  const fd = new FormData(form);
  const data = {};
  for (const [k, v] of fd.entries()) data[k] = v === '' ? null : v;
  try {
    const r = await api('POST', '/contacts/' + id + '/convert-to-company', data);
    alert('Hotovo! Firma #' + r.company.id + ' (' + r.company.name + ') byla vytvořena.');
    closeModal();
    openContactId = null;
    await reload();
  } catch (e) { alert('Chyba: ' + e.message); }
};

// ─── Modal: událost ─────────────────────────────────────────────────────
window.openEventModal = async function(eventId, prefillContactId) {
  let ev = {};
  if (eventId) {
    try {
      const all = await api('GET', '/events');
      ev = all.find(x => x.id === eventId) || {};
    } catch (e) { alert('Chyba: ' + e.message); return; }
  } else if (prefillContactId) {
    ev = { contact_id: prefillContactId };
  }
  const isEdit = !!ev.id;

  // Pro výběr kontaktu — použijeme aktuální seznam (nebo načteme rychle)
  const contactsForSelect = contacts.length ? contacts : await api('GET', '/contacts').catch(() => []);
  const contactOptions = contactsForSelect.map(c => {
    const nm = c.first_name + (c.last_name ? ' ' + c.last_name : '') + (c.company_name ? ' (' + c.company_name + ')' : '');
    return `<option value="${c.id}" ${ev.contact_id == c.id ? 'selected' : ''}>${esc(nm)}</option>`;
  }).join('');

  const html = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="width:640px;">
      <h2>${isEdit ? '✏️ Upravit událost' : '📅 Nová událost'}</h2>
      <form id="event-form" onsubmit="event.preventDefault(); saveEvent(${isEdit ? ev.id : 'null'})">
        <div class="form-grid">
          <div class="form-group full"><label>Název *</label><input name="title" required value="${esc(ev.title || '')}"></div>
          <div class="form-group"><label>Typ</label>
            <select name="event_type">
              ${Object.entries(EVENT_TYPE_LABELS).map(([k,v]) => `<option value="${k}" ${(ev.event_type||'meeting')===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Stav</label>
            <select name="status">
              <option value="planned"   ${(ev.status||'planned')==='planned'?'selected':''}>Naplánováno</option>
              <option value="done"      ${ev.status==='done'?'selected':''}>Hotovo</option>
              <option value="cancelled" ${ev.status==='cancelled'?'selected':''}>Zrušeno</option>
            </select>
          </div>
          <div class="form-group"><label>Začátek *</label>
            <input name="start_at" type="datetime-local" required value="${ev.start_at ? toLocalInputDT(ev.start_at) : ''}">
          </div>
          <div class="form-group"><label>Konec</label>
            <input name="end_at" type="datetime-local" value="${ev.end_at ? toLocalInputDT(ev.end_at) : ''}">
          </div>
          <div class="form-group full"><label>Kontakt</label>
            <select name="contact_id">
              <option value="">— Bez vazby na kontakt —</option>
              ${contactOptions}
            </select>
          </div>
          <div class="form-group full"><label>Místo / link</label><input name="location" value="${esc(ev.location || '')}" placeholder="Adresa, MS Teams link, telefon..."></div>
          <div class="form-group full"><label>Popis</label><textarea name="description">${esc(ev.description || '')}</textarea></div>
          <div class="form-group"><label>Připomínka (min. před)</label><input name="reminder_min" type="number" min="0" value="${ev.reminder_min || ''}"></div>
          <div class="form-group" style="flex-direction:row; align-items:center; gap:8px; padding-top:22px;">
            <input type="checkbox" name="all_day" id="ev-all-day" ${ev.all_day ? 'checked' : ''}>
            <label for="ev-all-day" style="margin:0;">Celodenní</label>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
          ${isEdit ? `<button type="button" class="btn btn-danger" onclick="deleteEvent(${ev.id})">🗑 Smazat</button>` : ''}
          <button type="submit" class="btn btn-primary">${isEdit ? '💾 Uložit' : '➕ Vytvořit'}</button>
        </div>
      </form>
    </div>
    </div>`;
  document.getElementById('modal-root').innerHTML = html;
};

window.saveEvent = async function(id) {
  const form = document.getElementById('event-form');
  const fd = new FormData(form);
  const data = {};
  for (const [k, v] of fd.entries()) data[k] = v === '' ? null : v;
  data.all_day = !!form.querySelector('[name=all_day]').checked;
  try {
    const method = id ? 'PUT' : 'POST';
    const path = id ? '/events/' + id : '/events';
    await api(method, path, data);
    closeModal();
    if (openContactId) { openContactDetail(openContactId); }
    await loadEvents();
  } catch (e) { alert('Chyba: ' + e.message); }
};

window.deleteEvent = async function(id) {
  if (!confirm('Smazat tuto událost?')) return;
  try {
    await api('DELETE', '/events/' + id);
    closeModal();
    if (openContactId) { openContactDetail(openContactId); }
    await loadEvents();
  } catch (e) { alert('Chyba: ' + e.message); }
};

// ─── Init ────────────────────────────────────────────────────────────────
(async function init() {
  // Nejdřív role + seznam obchodníků — frontend tak ví, jaké UI render­ovat
  await loadRoleAndSellers();
  await Promise.all([loadContacts(), loadStats(), loadEvents()]);
  // Pokud je v URL ?id=X, otevřeme detail (deeplink z notifikací)
  const params = new URLSearchParams(window.location.search);
  const openId = params.get('id');
  if (openId) openContactDetail(parseInt(openId, 10));
})();

})();
