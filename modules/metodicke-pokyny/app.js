// HolyOS — Metodické pokyny a směrnice (frontend)
// Vanilla JS modul. Používá JWT v HttpOnly cookie (credentials: 'include')
// + fallback na sessionStorage token (přechodná kompatibilita).

(function () {
  'use strict';

  // ─── Stav ────────────────────────────────────────────────────────────────
  const state = {
    items: [],
    filtered: [],
    search: '',
    category: 'all',
    status: 'all',
    editing: null,    // null = nová, jinak ID upravované směrnice
    attachments: [],  // pole { url, name, size, mime }
    tags: [],         // pole stringů
  };

  const CATEGORY_LABELS = {
    obecne: 'Obecné',
    hr: 'HR',
    vyroba: 'Výroba',
    sklad: 'Sklad',
    kvalita: 'Kvalita',
    bozp: 'BOZP',
    it: 'IT',
    ekonomika: 'Ekonomika',
  };

  const STATUS_LABELS = {
    active: 'Platná',
    draft: 'Pracovní verze',
    archived: 'Archivovaná',
  };

  // ─── HTTP helper ────────────────────────────────────────────────────────
  function authHeaders(extra) {
    const h = Object.assign({}, extra || {});
    const t = sessionStorage.getItem('token');
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  async function api(path, opts) {
    const init = Object.assign({ credentials: 'include' }, opts || {});
    init.headers = authHeaders(init.headers);
    const res = await fetch(path, init);
    if (!res.ok) {
      const txt = await res.text();
      let msg = txt;
      try { msg = JSON.parse(txt).error || txt; } catch (_) {}
      throw new Error(msg || ('HTTP ' + res.status));
    }
    return res.json();
  }

  // ─── Načtení dat ────────────────────────────────────────────────────────
  async function loadData() {
    try {
      const params = new URLSearchParams();
      if (state.search) params.set('search', state.search);
      if (state.category !== 'all') params.set('category', state.category);
      if (state.status !== 'all') params.set('status', state.status);
      const url = '/api/directives' + (params.toString() ? '?' + params.toString() : '');
      state.items = await api(url);
      state.filtered = state.items;
      renderTable();
      renderStats();
    } catch (e) {
      console.error('loadData', e);
      document.getElementById('tbody').innerHTML =
        '<tr><td colspan="7" class="empty-hint">Chyba načítání: ' + escapeHtml(e.message) + '</td></tr>';
    }
  }

  // ─── Render: souhrnné karty ─────────────────────────────────────────────
  function renderStats() {
    const counts = { active: 0, draft: 0, archived: 0 };
    state.items.forEach(d => {
      if (counts[d.status] !== undefined) counts[d.status]++;
    });

    const html = [
      ['Celkem', state.items.length, '#a78bfa'],
      ['Platné', counts.active, '#22c55e'],
      ['Pracovní verze', counts.draft, '#f59e0b'],
      ['Archiv', counts.archived, '#94a3b8'],
    ].map(([label, value, color]) => `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="color:${color};">${value}</div>
      </div>
    `).join('');

    document.getElementById('statsRow').innerHTML = html;
    document.getElementById('totalCount').textContent = '(' + state.items.length + ')';
  }

  // ─── Render: tabulka ────────────────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById('tbody');
    if (!state.items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-hint">Žádné směrnice. Vytvoř první přes "+ Nová směrnice".</td></tr>';
      return;
    }

    tbody.innerHTML = state.items.map(d => `
      <tr onclick="window.HolyDir.openEditModal(${d.id})">
        <td class="code-cell">${escapeHtml(d.code)}</td>
        <td>
          <div style="font-weight:500;">${escapeHtml(d.title)}</div>
          ${d.effective_from ? `<div style="font-size:11px; color:var(--text2); margin-top:2px;">Platí od ${formatDate(d.effective_from)}${d.effective_to ? ' do ' + formatDate(d.effective_to) : ''}</div>` : ''}
        </td>
        <td><span class="badge badge-cat">${escapeHtml(CATEGORY_LABELS[d.category] || d.category || '—')}</span></td>
        <td>${escapeHtml(d.version || '—')}</td>
        <td>${d.effective_from ? formatDate(d.effective_from) : '—'}</td>
        <td>${renderStatusBadge(d.status)}</td>
        <td onclick="event.stopPropagation();">
          <button class="btn btn-sm btn-danger" onclick="window.HolyDir.deleteItem(${d.id})">Smazat</button>
        </td>
      </tr>
    `).join('');
  }

  function renderStatusBadge(s) {
    const cls = 'badge-' + (s || 'draft');
    const lbl = STATUS_LABELS[s] || s || '—';
    return `<span class="badge ${cls}">${escapeHtml(lbl)}</span>`;
  }

  // ─── Modal: vytvoření / úprava ─────────────────────────────────────────
  function openCreateModal() {
    state.editing = null;
    state.attachments = [];
    state.tags = [];
    showModal({
      code: '',
      title: '',
      category: 'obecne',
      content: '',
      version: '1.0',
      status: 'draft',
      effective_from: '',
      effective_to: '',
      tags: [],
      attachments: [],
    });
  }

  async function openEditModal(id) {
    try {
      const item = await api('/api/directives/' + id);
      state.editing = item.id;
      state.attachments = Array.isArray(item.attachments) ? item.attachments.slice() : [];
      state.tags = Array.isArray(item.tags) ? item.tags.slice() : [];
      showModal(item);
    } catch (e) {
      alert('Nepodařilo se načíst detail: ' + e.message);
    }
  }

  function showModal(d) {
    closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modalOverlay';
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    overlay.innerHTML = `
      <div class="modal">
        <h2>${state.editing ? '✏️ Úprava směrnice' : '+ Nová směrnice'}</h2>

        <div class="form-grid">
          <div class="form-row">
            <label for="f-code">Kód *</label>
            <input id="f-code" type="text" placeholder="např. SM-001" value="${escapeAttr(d.code || '')}">
          </div>
          <div class="form-row">
            <label for="f-version">Verze</label>
            <input id="f-version" type="text" placeholder="1.0" value="${escapeAttr(d.version || '1.0')}">
          </div>

          <div class="form-row full">
            <label for="f-title">Název *</label>
            <input id="f-title" type="text" placeholder="Název směrnice" value="${escapeAttr(d.title || '')}">
          </div>

          <div class="form-row">
            <label for="f-category">Kategorie</label>
            <select id="f-category">
              ${Object.entries(CATEGORY_LABELS).map(([k, v]) =>
                `<option value="${k}" ${d.category === k ? 'selected' : ''}>${v}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-row">
            <label for="f-status">Stav</label>
            <select id="f-status">
              <option value="draft"    ${d.status === 'draft'    ? 'selected' : ''}>Pracovní verze</option>
              <option value="active"   ${d.status === 'active'   ? 'selected' : ''}>Platná</option>
              <option value="archived" ${d.status === 'archived' ? 'selected' : ''}>Archivovaná</option>
            </select>
          </div>

          <div class="form-row">
            <label for="f-from">Platnost od</label>
            <input id="f-from" type="date" value="${formatDateInput(d.effective_from)}">
          </div>
          <div class="form-row">
            <label for="f-to">Platnost do</label>
            <input id="f-to" type="date" value="${formatDateInput(d.effective_to)}">
          </div>

          <div class="form-row full">
            <label for="f-content">Obsah / popis (volitelně, podporuje markdown)</label>
            <textarea id="f-content" placeholder="Tělo směrnice…">${escapeHtml(d.content || '')}</textarea>
          </div>

          <div class="form-row full">
            <label>Přílohy (PDF, Word, atd.)</label>
            <label class="att-zone" id="attZone">
              <input type="file" multiple accept="*/*" onchange="window.HolyDir.handleFilePick(this)">
              📎 Klikni nebo přetáhni soubory pro nahrání
            </label>
            <div class="att-list" id="attList"></div>
          </div>
        </div>

        <div class="modal-actions">
          ${state.editing ? `<button class="btn btn-danger" onclick="window.HolyDir.deleteItem(${state.editing}, true)">Smazat</button>` : ''}
          <button class="btn btn-secondary" onclick="window.HolyDir.closeModal()">Zrušit</button>
          <button class="btn btn-primary" onclick="window.HolyDir.saveItem()">${state.editing ? 'Uložit změny' : 'Vytvořit'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    renderAttachmentList();
    setupDropZone();
  }

  function closeModal() {
    const el = document.getElementById('modalOverlay');
    if (el) el.remove();
  }

  // ─── Přílohy ─────────────────────────────────────────────────────────
  function renderAttachmentList() {
    const list = document.getElementById('attList');
    if (!list) return;
    if (!state.attachments.length) { list.innerHTML = ''; return; }

    list.innerHTML = state.attachments.map((a, i) => `
      <div class="att-item">
        <span class="ico">${attIcon(a)}</span>
        <span class="nm" title="${escapeAttr(a.name || '')}">${escapeHtml(a.name || 'soubor')}</span>
        <span class="sz">${formatSize(a.size)}</span>
        ${a.url ? `<a class="dl" href="${escapeAttr(a.url)}" target="_blank">stáhnout</a>` : ''}
        <button class="rm" onclick="window.HolyDir.removeAttachment(${i})" title="Odebrat">✕</button>
      </div>
    `).join('');
  }

  function attIcon(a) {
    const m = (a.mime || '').toLowerCase();
    const n = (a.name || '').toLowerCase();
    if (m.startsWith('image')) return '🖼️';
    if (m.includes('pdf') || n.endsWith('.pdf')) return '📕';
    if (m.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return '📄';
    if (m.includes('sheet') || m.includes('excel') || n.endsWith('.xlsx') || n.endsWith('.xls')) return '📊';
    return '📎';
  }

  function setupDropZone() {
    const zone = document.getElementById('attZone');
    if (!zone) return;
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      zone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      zone.classList.remove('dragging');
    }));
    zone.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) uploadFiles(files);
    });
  }

  function handleFilePick(input) {
    if (input.files && input.files.length) uploadFiles(input.files);
    input.value = '';
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) {
        alert('Soubor "' + f.name + '" je větší než 20 MB.');
        continue;
      }
      try {
        const saved = await uploadOne(f);
        state.attachments.push({ url: saved.url, name: f.name, size: f.size, mime: f.type || '' });
        renderAttachmentList();
      } catch (e) {
        alert('Nepodařilo se nahrát "' + f.name + '": ' + e.message);
      }
    }
  }

  function uploadOne(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        const comma = s.indexOf(',');
        const b64 = comma >= 0 ? s.slice(comma + 1) : s;
        api('/api/storage/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_data: b64,
            file_name: file.name,
            file_type: file.type || null,
            folder: 'directives',
          }),
        }).then(resolve).catch(reject);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function removeAttachment(idx) {
    state.attachments.splice(idx, 1);
    renderAttachmentList();
  }

  // ─── Save / delete ──────────────────────────────────────────────────────
  async function saveItem() {
    const code = (document.getElementById('f-code').value || '').trim();
    const title = (document.getElementById('f-title').value || '').trim();
    if (!code) { alert('Kód je povinný.'); return; }
    if (!title) { alert('Název je povinný.'); return; }

    const payload = {
      code,
      title,
      category: document.getElementById('f-category').value || 'obecne',
      version: (document.getElementById('f-version').value || '1.0').trim(),
      status: document.getElementById('f-status').value || 'draft',
      content: document.getElementById('f-content').value || null,
      effective_from: document.getElementById('f-from').value || null,
      effective_to: document.getElementById('f-to').value || null,
      attachments: state.attachments,
      tags: state.tags,
    };

    try {
      if (state.editing) {
        await api('/api/directives/' + state.editing, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/directives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      await loadData();
    } catch (e) {
      alert('Chyba ukládání: ' + e.message);
    }
  }

  async function deleteItem(id, fromModal) {
    if (!confirm('Opravdu smazat tuto směrnici?')) return;
    try {
      await api('/api/directives/' + id, { method: 'DELETE' });
      if (fromModal) closeModal();
      await loadData();
    } catch (e) {
      alert('Chyba mazání: ' + e.message);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function formatDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('cs-CZ'); } catch (_) { return ''; }
  }
  function formatDateInput(d) {
    if (!d) return '';
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toISOString().slice(0, 10);
    } catch (_) { return ''; }
  }
  function formatSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return Math.round(b / 1024) + ' kB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  // Debounce helper pro vyhledávání
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // ─── Init ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchBox').addEventListener('input', debounce((e) => {
      state.search = e.target.value || '';
      loadData();
    }, 250));
    document.getElementById('filterCategory').addEventListener('change', (e) => {
      state.category = e.target.value;
      loadData();
    });
    document.getElementById('filterStatus').addEventListener('change', (e) => {
      state.status = e.target.value;
      loadData();
    });
    loadData();
  });

  // Globální namespace pro inline onclick handlers
  window.HolyDir = {
    openCreateModal, openEditModal, closeModal,
    saveItem, deleteItem, removeAttachment,
    handleFilePick,
  };
  // Také vystavit pro kompatibilitu s onclick="openCreateModal()" v HTML
  window.openCreateModal = openCreateModal;
})();
