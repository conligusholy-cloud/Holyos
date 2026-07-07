// HolyOS — Site Development frontend logic
// Modul pro vyhledávání a řízení lokalit / pozemků pro prádlomaty.
// Auth: JWT v httpOnly cookie (credentials: 'include').
(function(){
'use strict';

// ─── Stav ──────────────────────────────────────────────────────────────────
let sites = [];
let stats = null;
let currentSite = null;
let compareIds = new Set();

const ALL_COLUMNS = [
  { id:'name',         label:'Lokalita',  always:true },
  { id:'status',       label:'Stav',      def:true },
  { id:'type',         label:'Typ',       def:true },
  { id:'city',         label:'Město',     def:true },
  { id:'address',      label:'Adresa',    def:false },
  { id:'rent',         label:'Nájem',     def:true },
  { id:'energy',       label:'Energie',   def:false },
  { id:'deposit',      label:'Záloha',    def:false },
  { id:'purchase',     label:'Kupní cena',def:false },
  { id:'area',         label:'Plocha',    def:false },
  { id:'owner',        label:'Vlastník',  def:true },
  { id:'score',        label:'Skóre',     def:true },
  { id:'comms',        label:'Komunikace',def:false },
  { id:'updated',      label:'Změna',     def:true },
];
const COL_STORAGE = 'siteDev.cols';
function getActiveCols() {
  const stored = localStorage.getItem(COL_STORAGE);
  if (stored) { try { return new Set(JSON.parse(stored)); } catch(e){} }
  return new Set(ALL_COLUMNS.filter(c => c.always || c.def).map(c => c.id));
}
let activeCols = getActiveCols();

// ─── Helpery ───────────────────────────────────────────────────────────────
const fetchOpts = (init) => Object.assign({ credentials:'include', headers:{'Content-Type':'application/json'} }, init || {});

function fmtCZK(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
}
function fmtNum(v, suffix) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + (suffix ? (' ' + suffix) : '');
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('cs-CZ');
}
function fmtRel(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const diff = (Date.now() - dt.getTime()) / 1000;
  if (diff < 60) return 'právě teď';
  if (diff < 3600) return Math.floor(diff/60) + ' min';
  if (diff < 86400) return Math.floor(diff/3600) + ' h';
  if (diff < 86400*7) return Math.floor(diff/86400) + ' d';
  return dt.toLocaleDateString('cs-CZ');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const STATUS_LABEL = {
  lead: 'Lead', researching:'Průzkum', negotiating:'Vyjednávání',
  contract:'Smlouva', operational:'V provozu', rejected:'Zamítnuto', lost:'Ztraceno',
};
const TYPE_LABEL = { rent:'Pronájem', purchase:'Nákup', other:'Jiné' };
const CHANNEL_LABEL = { call:'📞 Hovor', email:'✉️ E-mail', meeting:'🤝 Schůzka', sms:'💬 SMS', note:'📝 Poznámka' };

// ─── Načtení a render ──────────────────────────────────────────────────────
let _searchTimer = null;
function onSearchInput(){ clearTimeout(_searchTimer); _searchTimer = setTimeout(loadSites, 250); }
function applyFilters(){ loadSites(); }

async function loadSites() {
  const q = document.getElementById('site-search').value.trim();
  const status = document.getElementById('filter-status').value;
  const type = document.getElementById('filter-type').value;
  const city = document.getElementById('filter-city').value.trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (type) params.set('site_type', type);
  if (city) params.set('city', city);
  params.set('per_page', '200');
  try {
    const r = await fetch('/api/sites?' + params.toString(), fetchOpts());
    if (r.status === 401) { window.location = '/public/login.html'; return; }
    const data = await r.json();
    sites = data.items || [];
    stats = data.stats || null;
    renderStats();
    renderTable();
    renderColToggle();
    document.getElementById('site-count').textContent = '(' + (data.total ?? sites.length) + ')';
  } catch (err) {
    console.error('Chyba načítání lokalit:', err);
  }
}

function renderStats() {
  if (!stats) { document.getElementById('stats-row').innerHTML = ''; return; }
  const s = stats.by_status || {};
  const cards = [
    { cls:'',         label:'Celkem',       v: stats.total ?? 0 },
    { cls:'active',   label:'Aktivní',      v: (s.lead||0) + (s.researching||0) + (s.negotiating||0) },
    { cls:'contract', label:'Smlouva',      v: (s.contract||0) + (s.operational||0) },
    { cls:'lost',     label:'Zamítnuto/ztr.',v: (s.rejected||0) + (s.lost||0) },
    { cls:'',         label:'Ø měsíční nájem', v: stats.avg_rent ? fmtCZK(stats.avg_rent) : '—' },
  ];
  document.getElementById('stats-row').innerHTML = cards.map(c =>
    `<div class="stat-card ${c.cls}"><div class="stat-label">${esc(c.label)}</div><div class="stat-value">${esc(c.v)}</div></div>`
  ).join('');
}

function renderColToggle() {
  const html = ALL_COLUMNS.map(c => {
    const on = activeCols.has(c.id);
    const labelCls = on ? 'active' : '';
    const inputAttrs = c.always
      ? 'disabled checked'
      : (on ? 'checked' : '') + ' onchange="toggleCol(\'' + c.id + '\')"';
    return '<label class="' + labelCls + '"><input type="checkbox" ' + inputAttrs + '>' + esc(c.label) + '</label>';
  }).join('');
  document.getElementById('col-toggle').innerHTML = html;
}
function toggleCol(id) {
  if (activeCols.has(id)) activeCols.delete(id); else activeCols.add(id);
  localStorage.setItem(COL_STORAGE, JSON.stringify([...activeCols]));
  renderTable();
  renderColToggle();
}
window.toggleCol = toggleCol;

function renderTable() {
  if (!sites.length) {
    document.getElementById('sites-table').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗺️</div>
        <h3>Žádné lokality</h3>
        <div>Přidejte první lokalitu — adresu, fotky a parametry pro vyhodnocení.</div>
        <div style="margin-top:14px;"><button class="btn btn-primary" onclick="openSiteModal()">+ Nová lokalita</button></div>
      </div>`;
    return;
  }

  const cols = ALL_COLUMNS.filter(c => activeCols.has(c.id));
  const head = '<th style="width:30px;"></th>' + cols.map(c => `<th>${esc(c.label)}</th>`).join('');

  const rows = sites.map(s => {
    const isCompared = compareIds.has(s.id);
    const cells = cols.map(col => {
      switch (col.id) {
        case 'name':    return `<td><strong>${esc(s.name)}</strong>${s.cadastral_parcel ? `<div style="font-size:11px;color:var(--text2);">parc. ${esc(s.cadastral_parcel)}</div>` : ''}</td>`;
        case 'status':  return `<td><span class="badge badge-${esc(s.status)}">${esc(STATUS_LABEL[s.status]||s.status)}</span></td>`;
        case 'type':    return `<td><span class="badge badge-type-${esc(s.site_type)}">${esc(TYPE_LABEL[s.site_type]||s.site_type)}</span></td>`;
        case 'city':    return `<td>${esc(s.city || '—')}</td>`;
        case 'address': return `<td>${esc(s.address || '—')}</td>`;
        case 'rent':    return `<td>${fmtCZK(s.rent_monthly)}</td>`;
        case 'energy':  return `<td>${fmtCZK(s.energy_monthly)}</td>`;
        case 'deposit': return `<td>${fmtCZK(s.deposit)}</td>`;
        case 'purchase':return `<td>${fmtCZK(s.purchase_price)}</td>`;
        case 'area':    return `<td>${fmtNum(s.area_m2, 'm²')}</td>`;
        case 'owner':   return `<td>${esc(s.owner_name || (s.company && s.company.name) || '—')}</td>`;
        case 'score': {
          if (s.score == null) return '<td>—</td>';
          return `<td><span class="score-bar"><div style="width:${s.score}%"></div></span>${s.score}</td>`;
        }
        case 'comms':   return `<td>${s._count ? s._count.communications : 0}</td>`;
        case 'updated': return `<td title="${esc(s.updated_at)}">${esc(fmtRel(s.updated_at))}</td>`;
        default: return '<td>—</td>';
      }
    }).join('');
    return `<tr data-id="${s.id}" onclick="openSiteModal(${s.id})">
      <td onclick="event.stopPropagation(); toggleCompare(${s.id});" title="Vybrat do porovnání" style="cursor:pointer;text-align:center;">
        <input type="checkbox" ${isCompared?'checked':''} style="cursor:pointer;">
      </td>${cells}</tr>`;
  }).join('');

  document.getElementById('sites-table').innerHTML = `
    <table class="data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ─── Porovnání ─────────────────────────────────────────────────────────────
function toggleCompare(id) {
  if (compareIds.has(id)) compareIds.delete(id); else compareIds.add(id);
  renderCompareBar();
  renderTable();
}
window.toggleCompare = toggleCompare;
function clearCompare(){ compareIds.clear(); renderCompareBar(); renderTable(); }
window.clearCompare = clearCompare;

function renderCompareBar() {
  const bar = document.getElementById('compare-bar');
  if (compareIds.size === 0) { bar.classList.remove('visible'); return; }
  bar.classList.add('visible');
  const pills = [...compareIds].map(id => {
    const s = sites.find(x => x.id === id);
    return `<span class="pill">${esc(s ? s.name : ('#' + id))} <span class="x" onclick="toggleCompare(${id})">✕</span></span>`;
  }).join('');
  document.getElementById('compare-pills').innerHTML = pills;
}

function openCompareModal() {
  if (compareIds.size < 2) { alert('Vyber alespoň 2 lokality pro porovnání.'); return; }
  const selected = [...compareIds].map(id => sites.find(x => x.id === id)).filter(Boolean);
  const rows = [
    ['Stav', s => `<span class="badge badge-${esc(s.status)}">${esc(STATUS_LABEL[s.status]||s.status)}</span>`],
    ['Typ', s => `<span class="badge badge-type-${esc(s.site_type)}">${esc(TYPE_LABEL[s.site_type]||s.site_type)}</span>`],
    ['Adresa', s => esc((s.address || '') + (s.city ? ', ' + s.city : '')) || '—'],
    ['Měsíční nájem', s => fmtCZK(s.rent_monthly)],
    ['Záloha', s => fmtCZK(s.deposit)],
    ['Energie záloha', s => fmtCZK(s.energy_deposit)],
    ['Energie/měs.', s => fmtCZK(s.energy_monthly)],
    ['Další náklady/měs.', s => fmtCZK(s.other_costs_monthly)],
    ['Kupní cena', s => fmtCZK(s.purchase_price)],
    ['Plocha', s => fmtNum(s.area_m2, 'm²')],
    ['Výška', s => fmtNum(s.ceiling_height_m, 'm')],
    ['Příkon', s => fmtNum(s.electricity_kw, 'kW')],
    ['Parkování', s => s.parking == null ? '—' : (s.parking ? 'Ano' : 'Ne')],
    ['Voda', s => s.water_supply == null ? '—' : (s.water_supply ? 'Ano' : 'Ne')],
    ['Odpad', s => s.sewage == null ? '—' : (s.sewage ? 'Ano' : 'Ne')],
    ['Vlastník', s => esc(s.owner_name || (s.company && s.company.name) || '—')],
    ['Skóre', s => s.score == null ? '—' : (s.score + ' / 100')],
  ];
  // Identifikuj nejlepší hodnoty (pro nájem = min, pro skóre = max)
  const minIdxFor = (key) => {
    let bestIdx = -1, bestVal = Infinity;
    selected.forEach((s,i) => {
      const v = Number(s[key]); if (Number.isFinite(v) && v < bestVal) { bestVal = v; bestIdx = i; }
    });
    return bestIdx;
  };
  const maxIdxFor = (key) => {
    let bestIdx = -1, bestVal = -Infinity;
    selected.forEach((s,i) => {
      const v = Number(s[key]); if (Number.isFinite(v) && v > bestVal) { bestVal = v; bestIdx = i; }
    });
    return bestIdx;
  };
  const bestRent = minIdxFor('rent_monthly');
  const bestScore = maxIdxFor('score');
  const bestArea = maxIdxFor('area_m2');

  const head = '<th></th>' + selected.map(s => `<th class="name-cell">${esc(s.name)}</th>`).join('');
  const body = rows.map((r, ri) => {
    const cells = selected.map((s, ci) => {
      let cell = r[1](s);
      let highlight = '';
      if (r[0] === 'Měsíční nájem' && ci === bestRent && bestRent !== -1) highlight = 'background:rgba(20,184,166,0.15);font-weight:600;';
      if (r[0] === 'Skóre'         && ci === bestScore && bestScore !== -1) highlight = 'background:rgba(20,184,166,0.15);font-weight:600;';
      if (r[0] === 'Plocha'        && ci === bestArea && bestArea !== -1) highlight = 'background:rgba(20,184,166,0.15);font-weight:600;';
      return `<td style="${highlight}">${cell}</td>`;
    }).join('');
    return `<tr><td style="font-weight:600;color:var(--text2);">${esc(r[0])}</td>${cells}</tr>`;
  }).join('');

  openModal(`
    <h2>Porovnání lokalit (${selected.length})</h2>
    <table class="data-table compare-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Zavřít</button></div>
  `);
}
window.openCompareModal = openCompareModal;

// ─── Modal helpers ─────────────────────────────────────────────────────────
function openModal(html) { document.getElementById('modal-root').innerHTML = '<div class="modal-overlay" onclick="if(event.target===this) closeModal()"><div class="modal">' + html + '</div></div>'; }
function closeModal() { document.getElementById('modal-root').innerHTML = ''; currentSite = null; }
window.closeModal = closeModal;

// ─── Detail / editace lokality ─────────────────────────────────────────────
async function openSiteModal(id) {
  if (id) {
    const r = await fetch('/api/sites/' + id, fetchOpts());
    if (!r.ok) { alert('Nepodařilo se načíst lokalitu'); return; }
    currentSite = await r.json();
  } else {
    currentSite = {
      site_type:'rent', status:'lead', country:'CZ', rent_currency:'CZK',
      contacts:[], communications:[], photos:[], documents:[],
    };
  }
  renderSiteModal();
}
window.openSiteModal = openSiteModal;

function renderSiteModal() {
  const s = currentSite || {};
  const isNew = !s.id;
  openModal(`
    <h2>${isNew ? 'Nová lokalita' : esc(s.name || ('Lokalita #' + s.id))}</h2>
    <div class="site-tabs">
      <button class="site-tab active" data-tab="basic" onclick="switchTab('basic')">Základ</button>
      <button class="site-tab" data-tab="finance" onclick="switchTab('finance')">Finance &amp; smlouva</button>
      <button class="site-tab" data-tab="space" onclick="switchTab('space')">Prostor</button>
      <button class="site-tab" data-tab="cadastre" onclick="switchTab('cadastre')">Katastr</button>
      <button class="site-tab" data-tab="eval" onclick="switchTab('eval')">Vyhodnocení</button>
      ${isNew ? '' : `
        <button class="site-tab" data-tab="contacts" onclick="switchTab('contacts')">Kontakty (${(s.contacts||[]).length})</button>
        <button class="site-tab" data-tab="comm" onclick="switchTab('comm')">Komunikace (${(s.communications||[]).length})</button>
        <button class="site-tab" data-tab="photos" onclick="switchTab('photos')">Fotky &amp; mapa (${(s.photos||[]).length})</button>
        <button class="site-tab" data-tab="docs" onclick="switchTab('docs')">Smlouvy (${(s.documents||[]).length})</button>
      `}
    </div>

    <div class="site-tab-panel active" id="tab-basic">${renderBasicTab(s)}</div>
    <div class="site-tab-panel" id="tab-finance">${renderFinanceTab(s)}</div>
    <div class="site-tab-panel" id="tab-space">${renderSpaceTab(s)}</div>
    <div class="site-tab-panel" id="tab-cadastre">${renderCadastreTab(s)}</div>
    <div class="site-tab-panel" id="tab-eval">${renderEvalTab(s)}</div>
    ${isNew ? '' : `
      <div class="site-tab-panel" id="tab-contacts">${renderContactsTab(s)}</div>
      <div class="site-tab-panel" id="tab-comm">${renderCommTab(s)}</div>
      <div class="site-tab-panel" id="tab-photos">${renderPhotosTab(s)}</div>
      <div class="site-tab-panel" id="tab-docs">${renderDocsTab(s)}</div>
    `}

    <div class="modal-actions">
      ${!isNew ? '<button class="btn btn-danger" onclick="deleteSite()" style="margin-right:auto;">🗑️ Smazat</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
      <button class="btn btn-primary" onclick="saveSite()">Uložit</button>
    </div>
  `);
}
function switchTab(name) {
  document.querySelectorAll('.site-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.site-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}
window.switchTab = switchTab;

// ─── Záložky obsahu ────────────────────────────────────────────────────────
function inp(label, name, val, type, attrs) {
  type = type || 'text';
  attrs = attrs || '';
  const v = val == null ? '' : esc(val);
  return `<div class="form-row"><label>${esc(label)}</label><input type="${type}" name="${name}" value="${v}" ${attrs}></div>`;
}
function sel(label, name, val, options) {
  const opts = options.map(o => `<option value="${esc(o.v)}" ${String(o.v)===String(val||'')?'selected':''}>${esc(o.l)}</option>`).join('');
  return `<div class="form-row"><label>${esc(label)}</label><select name="${name}">${opts}</select></div>`;
}
function txt(label, name, val) {
  return `<div class="form-row span2"><label>${esc(label)}</label><textarea name="${name}">${esc(val||'')}</textarea></div>`;
}
function chk(label, name, val) {
  return `<label><input type="checkbox" name="${name}" ${val?'checked':''}> ${esc(label)}</label>`;
}

function renderBasicTab(s){
  return `<div class="form-grid">
    ${inp('Název lokality *','name', s.name, 'text', 'required')}
    ${sel('Typ','site_type', s.site_type, [{v:'rent',l:'Pronájem'},{v:'purchase',l:'Nákup pozemku'},{v:'other',l:'Jiné'}])}
    ${sel('Stav','status', s.status, Object.entries(STATUS_LABEL).map(([v,l])=>({v,l})))}
    ${inp('Vlastník (jméno)','owner_name', s.owner_name)}
    ${inp('Vlastník — telefon','owner_phone', s.owner_phone)}
    ${inp('Vlastník — e-mail','owner_email', s.owner_email)}
    ${inp('Adresa','address', s.address)}
    ${inp('Město','city', s.city)}
    ${inp('PSČ','zip', s.zip)}
    ${inp('Stát','country', s.country || 'CZ')}
    ${inp('GPS — šířka','latitude', s.latitude, 'number', 'step="0.0000001"')}
    ${inp('GPS — délka','longitude', s.longitude, 'number', 'step="0.0000001"')}
    ${inp('Odkaz na mapu','map_link', s.map_link)}
    ${txt('Poznámka k vlastníkovi','owner_note', s.owner_note)}
    ${txt('Popis lokality','description', s.description)}
  </div>`;
}
function renderFinanceTab(s){
  return `<div class="form-grid">
    ${inp('Měsíční nájem (Kč)','rent_monthly', s.rent_monthly, 'number','step="0.01"')}
    ${inp('Měna','rent_currency', s.rent_currency || 'CZK')}
    ${inp('Kauce (Kč)','deposit', s.deposit, 'number','step="0.01"')}
    ${inp('Záloha na energie (Kč)','energy_deposit', s.energy_deposit, 'number','step="0.01"')}
    ${inp('Energie / měsíc (Kč)','energy_monthly', s.energy_monthly, 'number','step="0.01"')}
    ${inp('Další náklady / měsíc (Kč)','other_costs_monthly', s.other_costs_monthly, 'number','step="0.01"')}
    ${inp('Kupní cena (Kč)','purchase_price', s.purchase_price, 'number','step="0.01"')}
    ${inp('Smlouva — od','contract_start', s.contract_start ? String(s.contract_start).slice(0,10) : '', 'date')}
    ${inp('Smlouva — do','contract_end', s.contract_end ? String(s.contract_end).slice(0,10) : '', 'date')}
    ${txt('Smluvní podmínky','contract_terms', s.contract_terms)}
  </div>`;
}
function renderSpaceTab(s){
  return `<div class="form-grid">
    ${inp('Plocha (m²)','area_m2', s.area_m2, 'number','step="0.01"')}
    ${inp('Světlá výška (m)','ceiling_height_m', s.ceiling_height_m, 'number','step="0.01"')}
    ${inp('Dostupný příkon (kW)','electricity_kw', s.electricity_kw, 'number','step="0.01"')}
  </div>
  <div class="checkbox-row" style="margin-top:14px;">
    ${chk('Voda', 'water_supply', s.water_supply)}
    ${chk('Odpad', 'sewage', s.sewage)}
    ${chk('Parkování', 'parking', s.parking)}
  </div>
  ${txt('Dispoziční poznámka — kolik prádlomatů, jaká variace','capacity_note', s.capacity_note)}`;
}
function renderCadastreTab(s){
  return `<div class="form-grid">
    ${inp('Katastrální území','cadastral_area', s.cadastral_area)}
    ${inp('Číslo parcely','cadastral_parcel', s.cadastral_parcel)}
    ${inp('Číslo LV','cadastral_lv', s.cadastral_lv)}
  </div>
  ${txt('Odkaz na ČÚZK / dokumenty','cadastral_link', s.cadastral_link)}`;
}
function renderEvalTab(s){
  return `<div class="form-grid">
    ${inp('Skóre (0–100)','score', s.score, 'number','min="0" max="100"')}
    ${inp('Prádlomat (referenční ID)','pradlomat_ref', s.pradlomat_ref)}
    ${txt('Plus body','pros', s.pros)}
    ${txt('Mínus body','cons', s.cons)}
    ${txt('Důvod zamítnutí','rejection_reason', s.rejection_reason)}
  </div>`;
}
function renderContactsTab(s){
  const list = (s.contacts||[]).map(c => `
    <div class="contact-card ${c.is_primary?'primary':''}">
      <div class="info">
        <div class="name">${esc(c.name)} ${c.is_primary?'<span class="badge badge-operational">primární</span>':''}</div>
        <div class="meta">${esc(c.role||'')} ${c.company?'• '+esc(c.company):''} ${c.phone?'• 📞 '+esc(c.phone):''} ${c.email?'• ✉️ '+esc(c.email):''}</div>
        ${c.note?`<div class="meta" style="margin-top:4px;">${esc(c.note)}</div>`:''}
      </div>
      <button class="btn btn-sm btn-danger" onclick="delContact(${c.id})">Smazat</button>
    </div>`).join('') || '<div style="color:var(--text2);font-size:13px;">Zatím žádné kontakty.</div>';

  return `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">${list}</div>
    <h3 style="font-size:14px;margin-bottom:8px;">Přidat kontakt</h3>
    <div class="form-grid" id="new-contact-form">
      ${inp('Jméno *','contact_name', '')}
      ${inp('Role (vlastník, realitka, ...)','contact_role','')}
      ${inp('Telefon','contact_phone','')}
      ${inp('E-mail','contact_email','')}
      ${inp('Firma','contact_company','')}
    </div>
    <div class="checkbox-row" style="margin-top:8px;">
      ${chk('Primární kontakt','contact_is_primary', false)}
    </div>
    ${txt('Poznámka','contact_note','')}
    <button class="btn btn-secondary btn-sm" onclick="addContact()" style="margin-top:10px;">+ Přidat kontakt</button>`;
}
function renderCommTab(s){
  const list = (s.communications||[]).map(c => `
    <div class="comm-item">
      <div class="head">
        <span class="channel">${esc(CHANNEL_LABEL[c.channel]||c.channel)}</span>
        <span>${esc(fmtDate(c.occurred_at))}</span>
        ${c.author?`<span>• ${esc(c.author.first_name||'')} ${esc(c.author.last_name||'')}</span>`:''}
        ${c.subject?`<span>• ${esc(c.subject)}</span>`:''}
        <button class="btn btn-sm btn-danger" style="margin-left:auto;" onclick="delComm(${c.id})">Smazat</button>
      </div>
      <div class="body">${esc(c.body)}</div>
      ${c.followup_at?`<div class="followup">Follow-up: ${esc(fmtDate(c.followup_at))} ${c.followup_done?'✓ hotovo':''}</div>`:''}
    </div>`).join('') || '<div style="color:var(--text2);font-size:13px;">Zatím žádné záznamy komunikace.</div>';

  return `<div class="comm-list">${list}</div>
    <h3 style="font-size:14px;margin:18px 0 8px;">Nový záznam komunikace</h3>
    <div class="form-grid">
      ${sel('Kanál','comm_channel','note',[
        {v:'note',l:'📝 Poznámka'},{v:'call',l:'📞 Hovor'},{v:'email',l:'✉️ E-mail'},
        {v:'meeting',l:'🤝 Schůzka'},{v:'sms',l:'💬 SMS'}
      ])}
      ${inp('Předmět','comm_subject','')}
      ${inp('Kdy se to stalo','comm_occurred_at', new Date().toISOString().slice(0,16), 'datetime-local')}
      ${inp('Follow-up (volitelné)','comm_followup_at','', 'date')}
    </div>
    ${txt('Obsah / poznámka','comm_body','')}
    <button class="btn btn-secondary btn-sm" onclick="addComm()" style="margin-top:10px;">+ Přidat záznam</button>`;
}
function renderPhotosTab(s){
  const photos = (s.photos||[]).map(p => `
    <div class="photo" onclick="window.open('${esc(p.url||'')}','_blank')" title="${esc(p.caption||'')}">
      <img src="${esc(p.url||'')}" alt="${esc(p.caption||'')}">
      <button class="del" onclick="event.stopPropagation(); delPhoto(${p.id})">✕</button>
    </div>`).join('');

  const mapBlock = (s.latitude && s.longitude)
    ? `<div style="margin-bottom:14px;"><a href="https://mapy.cz/zakladni?x=${s.longitude}&amp;y=${s.latitude}&amp;z=17" target="_blank" class="btn btn-secondary btn-sm">📍 Otevřít na Mapy.cz</a> <a href="https://www.google.com/maps/?q=${s.latitude},${s.longitude}" target="_blank" class="btn btn-secondary btn-sm">🌍 Otevřít na Google Maps</a></div>`
    : '<div style="color:var(--text2);font-size:12px;margin-bottom:14px;">⚠ Pro zobrazení na mapě vyplň GPS souřadnice v záložce „Základ".</div>';

  return `${mapBlock}
    <div class="photo-grid">
      ${photos}
      <label class="add" title="Přidat fotku">
        +
        <input type="file" accept="image/*" style="display:none;" onchange="onPhotoSelected(event)">
      </label>
    </div>`;
}
function renderDocsTab(s){
  const docs = (s.documents||[]).map(d => `
    <div class="contact-card">
      <div class="info">
        <div class="name">📄 ${esc(d.title)} <span class="badge badge-type-rent">${esc(d.doc_type)}</span></div>
        <div class="meta">
          ${d.signed_at?'Podepsáno: '+esc(fmtDate(d.signed_at)):''}
          ${d.valid_from?' • Platí od: '+esc(fmtDate(d.valid_from)):''}
          ${d.valid_to?' • Do: '+esc(fmtDate(d.valid_to)):''}
        </div>
        ${d.note?`<div class="meta" style="margin-top:4px;">${esc(d.note)}</div>`:''}
        ${d.external_url?`<a href="${esc(d.external_url)}" target="_blank" style="font-size:12px;color:#14b8a6;">Otevřít odkaz</a>`:''}
        ${d.file_path?`<a href="/api/sites/documents/${d.id}/download" style="font-size:12px;color:#14b8a6;">Stáhnout PDF</a>`:''}
      </div>
      <button class="btn btn-sm btn-danger" onclick="delDoc(${d.id})">Smazat</button>
    </div>`).join('') || '<div style="color:var(--text2);font-size:13px;">Zatím žádné dokumenty.</div>';

  return `<div class="contract-gen" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <button class="btn btn-sm btn-primary" onclick="openContractForm('kupni')">📄 Kupní smlouva</button>
      <button class="btn btn-sm btn-primary" onclick="openContractForm('servisni')">🔧 Servisní smlouva</button>
      <button class="btn btn-sm btn-primary" onclick="openContractForm('rezervacni')">📌 Rezervační smlouva</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">${docs}</div>
    <h3 style="font-size:14px;margin-bottom:8px;">Přidat dokument / smlouvu</h3>
    <div class="form-grid">
      ${inp('Název *','doc_title','')}
      ${sel('Typ','doc_type','other',[
        {v:'contract',l:'Smlouva'},{v:'offer',l:'Nabídka'},
        {v:'cadastre',l:'Katastr'},{v:'technical',l:'Technická'},{v:'other',l:'Jiné'}
      ])}
      ${inp('Externí URL','doc_external_url','')}
      ${inp('Podepsáno','doc_signed_at','','date')}
      ${inp('Platí od','doc_valid_from','','date')}
      ${inp('Platí do','doc_valid_to','','date')}
    </div>
    ${txt('Poznámka','doc_note','')}
    <button class="btn btn-secondary btn-sm" onclick="addDoc()" style="margin-top:10px;">+ Přidat</button>`;
}

// ─── Sbírání hodnot z formuláře ────────────────────────────────────────────
function collectForm() {
  const root = document.querySelector('.modal');
  if (!root) return {};
  const out = {};
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
    if (el.name.startsWith('contact_') || el.name.startsWith('comm_') || el.name.startsWith('doc_')) return;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.value === '') out[el.name] = null;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  });
  return out;
}

async function saveSite() {
  const data = collectForm();
  if (!data.name) { alert('Název je povinný'); switchTab('basic'); return; }
  const isNew = !currentSite || !currentSite.id;
  try {
    const r = await fetch(isNew ? '/api/sites' : ('/api/sites/' + currentSite.id), fetchOpts({
      method: isNew ? 'POST' : 'PUT',
      body: JSON.stringify(data),
    }));
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert('Chyba uložení: ' + (e.error || r.status));
      return;
    }
    closeModal();
    loadSites();
  } catch (err) {
    alert('Chyba uložení: ' + err.message);
  }
}
window.saveSite = saveSite;

async function deleteSite() {
  if (!currentSite || !currentSite.id) return;
  if (!confirm('Smazat lokalitu "' + currentSite.name + '"? Tato akce je nevratná.')) return;
  const r = await fetch('/api/sites/' + currentSite.id, fetchOpts({ method:'DELETE' }));
  if (!r.ok) { alert('Smazání selhalo'); return; }
  closeModal();
  loadSites();
}
window.deleteSite = deleteSite;

// ─── Kontakty ──────────────────────────────────────────────────────────────
async function addContact() {
  const body = {
    name: document.querySelector('[name=contact_name]').value.trim(),
    role: document.querySelector('[name=contact_role]').value.trim() || null,
    phone: document.querySelector('[name=contact_phone]').value.trim() || null,
    email: document.querySelector('[name=contact_email]').value.trim() || null,
    company: document.querySelector('[name=contact_company]').value.trim() || null,
    note: document.querySelector('[name=contact_note]').value.trim() || null,
    is_primary: document.querySelector('[name=contact_is_primary]').checked,
  };
  if (!body.name) { alert('Jméno je povinné'); return; }
  const r = await fetch('/api/sites/' + currentSite.id + '/contacts', fetchOpts({ method:'POST', body: JSON.stringify(body) }));
  if (!r.ok) { alert('Chyba'); return; }
  await refreshCurrent(); renderSiteModal(); switchTab('contacts');
}
window.addContact = addContact;

async function delContact(id) {
  if (!confirm('Smazat kontakt?')) return;
  await fetch('/api/sites/contacts/' + id, fetchOpts({ method:'DELETE' }));
  await refreshCurrent(); renderSiteModal(); switchTab('contacts');
}
window.delContact = delContact;

// ─── Komunikace ────────────────────────────────────────────────────────────
async function addComm() {
  const body = {
    channel: document.querySelector('[name=comm_channel]').value,
    subject: document.querySelector('[name=comm_subject]').value.trim() || null,
    body: document.querySelector('[name=comm_body]').value.trim(),
    occurred_at: document.querySelector('[name=comm_occurred_at]').value || null,
    followup_at: document.querySelector('[name=comm_followup_at]').value || null,
  };
  if (!body.body) { alert('Vyplň tělo komunikace'); return; }
  const r = await fetch('/api/sites/' + currentSite.id + '/communications', fetchOpts({ method:'POST', body: JSON.stringify(body) }));
  if (!r.ok) { alert('Chyba'); return; }
  await refreshCurrent(); renderSiteModal(); switchTab('comm');
}
window.addComm = addComm;

async function delComm(id) {
  if (!confirm('Smazat záznam?')) return;
  await fetch('/api/sites/communications/' + id, fetchOpts({ method:'DELETE' }));
  await refreshCurrent(); renderSiteModal(); switchTab('comm');
}
window.delComm = delComm;

// ─── Fotky ────────────────────────────────────────────────────────────────
async function onPhotoSelected(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  // Komprimace pomocí canvas (max 1600 px na delší straně)
  const img = await new Promise(res => {
    const i = new Image();
    i.onload = () => res(i);
    i.src = URL.createObjectURL(file);
  });
  const MAX = 1600;
  const ratio = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  const r = await fetch('/api/sites/' + currentSite.id + '/photos', fetchOpts({ method:'POST', body: JSON.stringify({ data_url: dataUrl }) }));
  if (!r.ok) { alert('Nahrání selhalo'); return; }
  await refreshCurrent(); renderSiteModal(); switchTab('photos');
}
window.onPhotoSelected = onPhotoSelected;

async function delPhoto(id) {
  if (!confirm('Smazat fotku?')) return;
  await fetch('/api/sites/photos/' + id, fetchOpts({ method:'DELETE' }));
  await refreshCurrent(); renderSiteModal(); switchTab('photos');
}
window.delPhoto = delPhoto;

// ─── Dokumenty ─────────────────────────────────────────────────────────────
async function addDoc() {
  const body = {
    title: document.querySelector('[name=doc_title]').value.trim(),
    doc_type: document.querySelector('[name=doc_type]').value,
    external_url: document.querySelector('[name=doc_external_url]').value.trim() || null,
    signed_at: document.querySelector('[name=doc_signed_at]').value || null,
    valid_from: document.querySelector('[name=doc_valid_from]').value || null,
    valid_to: document.querySelector('[name=doc_valid_to]').value || null,
    note: document.querySelector('[name=doc_note]').value.trim() || null,
  };
  if (!body.title) { alert('Název je povinný'); return; }
  const r = await fetch('/api/sites/' + currentSite.id + '/documents', fetchOpts({ method:'POST', body: JSON.stringify(body) }));
  if (!r.ok) { alert('Chyba'); return; }
  await refreshCurrent(); renderSiteModal(); switchTab('docs');
}
window.addDoc = addDoc;

async function delDoc(id) {
  if (!confirm('Smazat dokument?')) return;
  await fetch('/api/sites/documents/' + id, fetchOpts({ method:'DELETE' }));
  await refreshCurrent(); renderSiteModal(); switchTab('docs');
}
window.delDoc = delDoc;

async function refreshCurrent() {
  if (!currentSite || !currentSite.id) return;
  const r = await fetch('/api/sites/' + currentSite.id, fetchOpts());
  if (r.ok) currentSite = await r.json();
}

// ─── Hromadný import ───────────────────────────────────────────────────────
function openImportModal() {
  openModal(`
    <h2>Import seznamu lokalit</h2>
    <p style="color:var(--text2);font-size:13px;margin-bottom:14px;">
      Vlož data ve formátu CSV (středník nebo čárka), jedna lokalita na řádek.<br>
      Sloupce: <code>název ; adresa ; město ; PSČ ; nájem ; jméno_vlastníka ; telefon ; e-mail ; poznámka</code><br>
      První řádek se přeskočí pokud obsahuje slovo „název" nebo „name".
    </p>
    <textarea id="import-textarea" style="width:100%;min-height:220px;font-family:monospace;font-size:12px;padding:10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;" placeholder="Praha 5 - Anděl; Plzeňská 12; Praha; 15000; 35000; Jan Novák; 777111222; jan@example.cz; rohový obchod"></textarea>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Zrušit</button>
      <button class="btn btn-primary" onclick="doImport()">Importovat</button>
    </div>
  `);
}
window.openImportModal = openImportModal;

async function doImport() {
  const raw = document.getElementById('import-textarea').value.trim();
  if (!raw) { alert('Vlož data'); return; }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let startIdx = 0;
  if (/n[áa]zev|name/i.test(lines[0])) startIdx = 1;
  const sep = lines[startIdx].includes(';') ? ';' : ',';
  const items = lines.slice(startIdx).map(line => {
    const cols = line.split(sep).map(c => c.trim());
    return {
      name: cols[0] || 'Bez názvu',
      address: cols[1] || null,
      city: cols[2] || null,
      zip: cols[3] || null,
      rent_monthly: cols[4] ? Number(cols[4].replace(/\s/g,'').replace(',','.')) : null,
      owner_name: cols[5] || null,
      owner_phone: cols[6] || null,
      owner_email: cols[7] || null,
      note: cols[8] || null,
    };
  });
  if (!items.length) { alert('Nic k importu'); return; }
  if (!confirm('Naimportovat ' + items.length + ' lokalit?')) return;

  const r = await fetch('/api/sites/import', fetchOpts({ method:'POST', body: JSON.stringify({ items }) }));
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    alert('Import selhal: ' + (e.error || r.status));
    return;
  }
  const data = await r.json();
  alert('Naimportováno: ' + data.created + ' lokalit.');
  closeModal();
  loadSites();
}
window.doImport = doImport;

// ─── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadSites);

// Pokud DOM už je hotový (sidebar.js načítá až po onload), spustíme ručně.
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  setTimeout(loadSites, 0);
}

window.onSearchInput = onSearchInput;
window.applyFilters = applyFilters;


// ─── Generování smluv k lokalitě (kupní / servisní / rezervační) ─────────────
async function openContractForm(type) {
  if (!currentSite || !currentSite.id) { alert('Nejprve ulož lokalitu.'); return; }
  const r = await fetch('/api/sites/' + currentSite.id + '/contracts/' + type + '/prefill', fetchOpts());
  if (!r.ok) { alert('Nepodařilo se načíst předlohu smlouvy.'); return; }
  const pf = await r.json();
  const groupsHtml = (pf.groups || []).map(g => `
    <fieldset class="contract-group" style="border:1px solid var(--border,#e2e2e2);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
      <legend style="font-size:12px;font-weight:700;padding:0 6px;">${esc(g.title)}</legend>
      <div class="form-grid">
        ${g.fields.map(f => {
          const val = pf.values[f.name] != null ? pf.values[f.name] : '';
          return f.type === 'textarea' ? txt(f.label, 'cf_' + f.name, val) : inp(f.label, 'cf_' + f.name, val, 'text');
        }).join('')}
      </div>
    </fieldset>`).join('');
  openModal(`
    <h2>${esc(pf.label)} — ${esc(currentSite.name || ('Lokalita #' + currentSite.id))}</h2>
    <p style="color:var(--text2);font-size:12px;margin-bottom:12px;">Uprav pole a vygeneruj PDF. Prázdná pole se v PDF vykreslí jako tečkovaná linka k dopsání.</p>
    <div class="contract-form">${groupsHtml}</div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="renderSiteModal();switchTab('docs')" style="margin-right:auto;">← Zpět</button>
      <button class="btn btn-secondary" onclick="generateContract('${type}', true)">💾 Uložit + PDF</button>
      <button class="btn btn-primary" onclick="generateContract('${type}', false)">📄 Stáhnout PDF</button>
    </div>
  `);
}
window.openContractForm = openContractForm;

function collectContractFields() {
  const fields = {};
  document.querySelectorAll('[name^="cf_"]').forEach(el => { fields[el.name.slice(3)] = el.value; });
  return fields;
}

async function generateContract(type, save) {
  const fields = collectContractFields();
  const r = await fetch('/api/sites/' + currentSite.id + '/contracts/' + type + '/pdf',
    fetchOpts({ method: 'POST', body: JSON.stringify({ fields, save: !!save }) }));
  if (!r.ok) { alert('Generování PDF selhalo.'); return; }
  const blob = await r.blob();
  const cd = r.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const name = m ? m[1] : (type + '.pdf');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
  if (save) { await refreshCurrent(); renderSiteModal(); switchTab('docs'); }
}
window.generateContract = generateContract;


})();
