// =============================================================================
// HolyOS — Modul Servis (admin UI)
// CRUD pro znalostní bázi, spotřebiče, kategorie, partnery + audit Hugo chatu.
// =============================================================================

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────

  let categories = [];
  let products = [];      // všechny produkty (Product, type='product' nebo 'semi-product')
  let appliances = [];
  let partners = [];
  let companies = [];

  // Helper: jen "skutečné" výrobky (ne polotovary) — používáme pro výběr,
  // kde se má spotřebič / článek / partner napojit na hotový výrobek (prádlomat).
  function realProducts() {
    return products.filter(p => !p.type || p.type === 'product');
  }

  // ─── HTTP helper ──────────────────────────────────────────────────────────

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = sessionStorage.getItem('token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!resp.ok) {
      let err = null;
      try { err = await resp.json(); } catch (_) {}
      throw new Error((err && err.error) || ('HTTP ' + resp.status));
    }
    return resp.status === 204 ? null : resp.json();
  }

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
        else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (k === 'html') e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    children.flat().forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ─── Tab routing ──────────────────────────────────────────────────────────

  document.querySelectorAll('.module-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.module-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.module-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'panel-' + tab);
      });
      if (tab === 'articles') loadArticles();
      if (tab === 'appliances') loadAppliances();
      if (tab === 'categories') loadCategories();
      if (tab === 'partners') loadPartners();
      if (tab === 'chat') loadChatSessions();
    });
  });

  // ─── Initial load ─────────────────────────────────────────────────────────

  (async function init() {
    try {
      const [cats, prods, comps] = await Promise.all([
        api('/api/service/categories'),
        api('/api/production/products').catch(() => []),
        api('/api/wh/companies?active=true').catch(() => []),
      ]);
      categories = cats || [];
      products = Array.isArray(prods) ? prods : (prods && prods.items) || [];
      companies = Array.isArray(comps) ? comps : [];
      fillCategoryFilter();
      fillProductFilter();
      await loadArticles();
    } catch (err) {
      console.error('Init failed:', err);
      alert('Chyba při načtení: ' + err.message);
    }
  })();

  function fillCategoryFilter() {
    const sel = document.getElementById('filter-category');
    if (!sel) return;
    sel.innerHTML = '<option value="">Všechny kategorie</option>' +
      categories.map(c => `<option value="${c.id}">${(c.icon || '')} ${c.name}</option>`).join('');
  }
  function fillProductFilter() {
    const sel = document.getElementById('filter-product');
    if (!sel) return;
    sel.innerHTML = '<option value="">Všechny výrobky</option>' +
      realProducts().map(p => `<option value="${p.id}">${p.code || ''} ${p.name}</option>`).join('');
  }

  // ─── ČLÁNKY ──────────────────────────────────────────────────────────────

  window.loadArticles = async function loadArticles() {
    const params = new URLSearchParams();
    const q = document.getElementById('filter-q').value.trim();
    const kind = document.getElementById('filter-kind').value;
    const status = document.getElementById('filter-status').value;
    const cat = document.getElementById('filter-category').value;
    const prod = document.getElementById('filter-product').value;
    if (q) params.set('q', q);
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (cat) params.set('category_id', cat);
    if (prod) params.set('product_id', prod);

    const articles = await api('/api/service/articles?' + params.toString());
    const tbody = document.getElementById('articles-tbody');
    tbody.innerHTML = '';
    if (!articles.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="ico">📭</div>Žádné články neodpovídají filtru. <a href="#" onclick="openArticleModal();return false" style="color:#22d3ee">Vytvořte první</a>.</div></td></tr>`;
      return;
    }
    articles.forEach(a => {
      const kindLabels = { GUIDE: 'Návod', CASE: 'Případ', CHECKLIST: 'Kontrola', FAQ: 'FAQ' };
      const statusLabels = { draft: 'Koncept', published: 'Publikováno', archived: 'Archiv' };
      const productNames = a.products.map(p => {
        const prod = products.find(x => x.id === p.product_id);
        return prod ? (prod.code || prod.name) : ('#' + p.product_id);
      }).join(', ');
      const tr = el('tr', null,
        el('td', null, el('strong', null, a.title), a.summary ? el('div', { style: { fontSize: '11px', color: 'var(--text2)', marginTop: '2px' } }, a.summary.slice(0, 120) + (a.summary.length > 120 ? '…' : '')) : null),
        el('td', null, el('span', { class: 'badge badge-' + a.kind.toLowerCase() }, kindLabels[a.kind] || a.kind)),
        el('td', null, a.category ? `${a.category.icon || ''} ${a.category.name}` : '—'),
        el('td', null, productNames || '—'),
        el('td', null, el('span', { class: 'badge badge-' + a.visibility }, a.visibility === 'partner' ? 'Partner' : 'Interní')),
        el('td', null, el('span', { class: 'badge badge-' + a.status }, statusLabels[a.status] || a.status)),
        el('td', null, new Date(a.updated_at).toLocaleDateString('cs-CZ')),
        el('td', null,
          el('button', { class: 'btn btn-sm btn-secondary', onclick: () => openArticleModal(a.id) }, 'Upravit'),
        ),
      );
      tbody.appendChild(tr);
    });
  };

  window.openArticleModal = async function openArticleModal(id) {
    const article = id ? await api('/api/service/articles/' + id) : null;
    if (!appliances.length) {
      appliances = await api('/api/service/appliances');
    }
    showArticleModal(article);
  };

  function showArticleModal(article) {
    const root = document.getElementById('modal-root');
    const data = article || {
      title: '', kind: 'GUIDE', summary: '', body_md: '', tags: [],
      visibility: 'partner', status: 'draft', category_id: null,
      products: [], appliances: [],
    };
    const productIds = (data.products || []).map(p => p.product_id);
    const applianceIds = (data.appliances || []).map(a => a.appliance_id || a.id);
    const tags = Array.isArray(data.tags) ? data.tags : [];

    root.innerHTML = '';
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal' });
    overlay.appendChild(modal);

    modal.innerHTML = `
      <h2>${article ? '✏️ Upravit článek' : '📝 Nový článek'}</h2>
      <div class="form-row">
        <label>Název</label>
        <input id="a-title" value="${escapeHtml(data.title)}" placeholder="Např. Výměna motoru bubnu prádlomatu 750">
      </div>
      <div class="form-grid-3">
        <div class="form-row">
          <label>Druh</label>
          <select id="a-kind">
            <option value="GUIDE" ${data.kind==='GUIDE'?'selected':''}>Návod</option>
            <option value="CASE" ${data.kind==='CASE'?'selected':''}>Řešený případ</option>
            <option value="CHECKLIST" ${data.kind==='CHECKLIST'?'selected':''}>Kontrolní postup</option>
            <option value="FAQ" ${data.kind==='FAQ'?'selected':''}>FAQ</option>
          </select>
        </div>
        <div class="form-row">
          <label>Kategorie</label>
          <select id="a-category">
            <option value="">— bez kategorie —</option>
            ${categories.map(c => `<option value="${c.id}" ${data.category_id===c.id?'selected':''}>${c.icon||''} ${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label>Stav</label>
          <select id="a-status">
            <option value="draft" ${data.status==='draft'?'selected':''}>Koncept</option>
            <option value="published" ${data.status==='published'?'selected':''}>Publikováno</option>
            <option value="archived" ${data.status==='archived'?'selected':''}>Archivováno</option>
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Viditelnost</label>
          <select id="a-visibility">
            <option value="partner" ${data.visibility==='partner'?'selected':''}>Partner (vidí Hugo + partneři)</option>
            <option value="internal" ${data.visibility==='internal'?'selected':''}>Interní (jen servisáci v HolyOS)</option>
          </select>
        </div>
        <div class="form-row">
          <label>Tagy (oddělené čárkou)</label>
          <input id="a-tags" value="${tags.join(', ')}" placeholder="motor, hlučnost, vibrace">
        </div>
      </div>
      <div class="form-row">
        <label>Krátký souhrn (volitelně)</label>
        <input id="a-summary" value="${escapeHtml(data.summary || '')}" placeholder="Jedna věta — co tento článek řeší. Použije Hugo pro citace.">
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Produkty</label>
          <div class="chip-pick" id="pick-products">
            <select onchange="window.__servis_pickProduct(this)">
              <option value="">+ Přidat produkt…</option>
              ${realProducts().map(p => `<option value="${p.id}">${p.code || ''} ${p.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label>Spotřebiče</label>
          <div class="chip-pick" id="pick-appliances">
            <select onchange="window.__servis_pickAppliance(this)">
              <option value="">+ Přidat spotřebič…</option>
              ${appliances.map(a => `<option value="${a.id}">${a.name}${a.manufacturer ? ' ('+a.manufacturer+')' : ''}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>Tělo článku (Markdown)</label>
        <div class="md-editor">
          <textarea id="a-body" placeholder="# Postup
1. ...
2. ...

**Tip:** ..."></textarea>
          <div class="md-preview" id="a-preview"></div>
        </div>
      </div>
      <div class="modal-actions">
        ${article ? '<button class="btn btn-danger" onclick="window.__servis_deleteArticle('+article.id+')">Smazat</button>' : ''}
        <button class="btn btn-secondary" onclick="document.getElementById('modal-root').innerHTML=''">Zrušit</button>
        <button class="btn btn-primary" onclick="window.__servis_saveArticle(${article ? article.id : 'null'})">Uložit</button>
      </div>
    `;
    root.appendChild(overlay);
    document.getElementById('a-body').value = data.body_md || '';

    // Render product/appliance chips
    const pickedProducts = new Set(productIds);
    const pickedAppliances = new Set(applianceIds);
    renderPickChips('pick-products', pickedProducts, id => products.find(p => p.id === id), (id) => `${products.find(p => p.id === id)?.code || ''} ${products.find(p => p.id === id)?.name || '#'+id}`);
    renderPickChips('pick-appliances', pickedAppliances, id => appliances.find(a => a.id === id), (id) => `${appliances.find(a => a.id === id)?.name || '#'+id}`);

    window.__servis_pickProduct = function (sel) {
      const id = parseInt(sel.value, 10);
      if (id) pickedProducts.add(id);
      sel.value = '';
      renderPickChips('pick-products', pickedProducts, id => products.find(p => p.id === id), (id) => `${products.find(p => p.id === id)?.code || ''} ${products.find(p => p.id === id)?.name || '#'+id}`);
    };
    window.__servis_pickAppliance = function (sel) {
      const id = parseInt(sel.value, 10);
      if (id) pickedAppliances.add(id);
      sel.value = '';
      renderPickChips('pick-appliances', pickedAppliances, id => appliances.find(a => a.id === id), (id) => `${appliances.find(a => a.id === id)?.name || '#'+id}`);
    };

    // Markdown preview (basic, no XSS — admin only)
    const bodyEl = document.getElementById('a-body');
    const prevEl = document.getElementById('a-preview');
    function renderPrev() { prevEl.innerHTML = mdToHtml(bodyEl.value); }
    bodyEl.addEventListener('input', renderPrev);
    renderPrev();

    window.__servis_saveArticle = async function (id) {
      const payload = {
        title: document.getElementById('a-title').value.trim(),
        kind: document.getElementById('a-kind').value,
        status: document.getElementById('a-status').value,
        visibility: document.getElementById('a-visibility').value,
        category_id: parseInt(document.getElementById('a-category').value, 10) || null,
        summary: document.getElementById('a-summary').value.trim() || null,
        body_md: bodyEl.value,
        tags: document.getElementById('a-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        product_ids: Array.from(pickedProducts),
        appliance_ids: Array.from(pickedAppliances),
      };
      if (!payload.title || !payload.body_md.trim()) {
        alert('Vyplň název a tělo článku.');
        return;
      }
      try {
        if (id) await api('/api/service/articles/' + id, { method: 'PUT', body: payload });
        else await api('/api/service/articles', { method: 'POST', body: payload });
        root.innerHTML = '';
        await loadArticles();
      } catch (err) {
        alert('Chyba uložení: ' + err.message);
      }
    };

    window.__servis_deleteArticle = async function (id) {
      if (!confirm('Opravdu smazat článek?')) return;
      try {
        await api('/api/service/articles/' + id, { method: 'DELETE' });
        root.innerHTML = '';
        await loadArticles();
      } catch (err) {
        alert('Chyba smazání: ' + err.message);
      }
    };
  }

  function renderPickChips(containerId, set, getter, labelFn) {
    const c = document.getElementById(containerId);
    if (!c) return;
    const select = c.querySelector('select');
    Array.from(c.querySelectorAll('.chip')).forEach(n => n.remove());
    Array.from(set).forEach(id => {
      const chip = el('span', { class: 'chip' },
        labelFn(id),
        el('span', { class: 'x', onclick: () => { set.delete(id); renderPickChips(containerId, set, getter, labelFn); } }, '✕'),
      );
      c.insertBefore(chip, select);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Naivní Markdown → HTML pro náhled (admin-only, ne pro user content sanitizace)
  function mdToHtml(md) {
    if (!md) return '<em style="color:var(--text2)">(Náhled bude zde…)</em>';
    let s = escapeHtml(md);
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    s = s.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>').replace(/<\/ul>\s*<ul>/g, '');
    s = s.split(/\n{2,}/).map(p => /^<(h\d|ul|ol|pre)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
    return s;
  }

  // ─── SPOTŘEBIČE ──────────────────────────────────────────────────────────

  window.loadAppliances = async function () {
    const q = (document.getElementById('filter-app-q')?.value || '').trim();
    appliances = await api('/api/service/appliances' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const tbody = document.getElementById('appliances-tbody');
    tbody.innerHTML = '';
    if (!appliances.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="ico">⚙️</div>Žádné spotřebiče. <a href="#" onclick="openApplianceModal();return false" style="color:#22d3ee">Přidat první</a>.</div></td></tr>`;
      return;
    }
    appliances.forEach(a => {
      const productCount = (a.product_links || []).length;
      const articleCount = (a._count && a._count.articles) || 0;
      const tr = el('tr', null,
        el('td', null, el('strong', null, a.name)),
        el('td', null, a.manufacturer || '—'),
        el('td', null, a.model_code || '—'),
        el('td', null, productCount ? productCount + '×' : '—'),
        el('td', null, articleCount ? articleCount + ' článků' : '—'),
        el('td', null, el('button', { class: 'btn btn-sm btn-secondary', onclick: () => openApplianceModal(a.id) }, 'Upravit')),
      );
      tbody.appendChild(tr);
    });
  };

  // ─── Manuály k spotřebiči — upload / list / delete ───────────────────────

  function fmtBytes(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return Math.round(b / 1024) + ' kB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  async function loadManualsList(applianceId) {
    const listEl = document.getElementById('manuals-list');
    if (!listEl) return;
    try {
      const manuals = await api('/api/service/appliances/' + applianceId + '/manuals');
      if (!manuals.length) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--text2);font-style:italic;padding:6px 0;">Zatím žádné nahrané manuály.</div>';
        return;
      }
      listEl.innerHTML = manuals.map(m => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--bg); border:1px solid var(--border); border-radius:8px; margin-bottom:6px;">
          <div style="font-size:20px;">${(m.mime_type || '').includes('pdf') ? '📕' : '📎'}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(m.title)}</div>
            <div style="font-size:11px; color:var(--text2);">
              ${fmtBytes(m.size_bytes)}${m.page_count ? ' · ' + m.page_count + ' str.' : ''}${m.language ? ' · ' + m.language.toUpperCase() : ''}
              · ${new Date(m.created_at).toLocaleDateString('cs-CZ')}
            </div>
          </div>
          <a class="btn btn-sm btn-secondary" href="/api/service/manuals/${m.id}/download" target="_blank" title="Otevřít">↗</a>
          <button class="btn btn-sm btn-danger" onclick="window.__servis_deleteManual(${m.id}, ${applianceId})" title="Smazat">✕</button>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<div style="font-size:12px;color:#ef4444;">Chyba: ${escapeHtml(err.message)}</div>`;
    }
  }

  window.__servis_deleteManual = async function (manualId, applianceId) {
    if (!confirm('Smazat tento manuál? Soubor se odstraní z disku a Hugo už z něj nebude čerpat.')) return;
    try {
      await api('/api/service/manuals/' + manualId, { method: 'DELETE' });
      await loadManualsList(applianceId);
    } catch (err) { alert('Chyba mazání: ' + err.message); }
  };

  function setupManualsSection(applianceId) {
    loadManualsList(applianceId);
    const drop = document.getElementById('manuals-drop');
    const fileInput = document.getElementById('manuals-file');
    if (!drop || !fileInput) return;

    drop.addEventListener('click', () => fileInput.click());

    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.style.borderColor = '#22d3ee';
      drop.style.background = 'rgba(34,211,238,0.06)';
    });
    drop.addEventListener('dragleave', () => {
      drop.style.borderColor = 'var(--border)';
      drop.style.background = '';
    });
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.style.borderColor = 'var(--border)';
      drop.style.background = '';
      const files = Array.from(e.dataTransfer.files || []);
      await uploadManuals(applianceId, files);
    });

    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      await uploadManuals(applianceId, files);
      fileInput.value = '';
    });
  }

  async function uploadManuals(applianceId, files) {
    if (!files.length) return;
    const listEl = document.getElementById('manuals-list');
    for (const file of files) {
      // Show uploading row
      const tmpRow = document.createElement('div');
      tmpRow.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(34,211,238,0.05); border:1px solid rgba(34,211,238,0.2); border-radius:8px; margin-bottom:6px; opacity:0.7;';
      tmpRow.innerHTML = `<div style="font-size:20px;">⏳</div><div style="flex:1;"><div style="font-size:13px;">${escapeHtml(file.name)}</div><div style="font-size:11px;color:var(--text2);">Nahrávám a extrahuji text…</div></div>`;
      if (listEl) listEl.prepend(tmpRow);

      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name.replace(/\.[^.]+$/, ''));
        const token = sessionStorage.getItem('token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const r = await fetch('/api/service/appliances/' + applianceId + '/manuals', {
          method: 'POST', headers, credentials: 'include', body: fd,
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || ('HTTP ' + r.status));
        }
      } catch (err) {
        alert('Chyba uploadu "' + file.name + '": ' + err.message);
      } finally {
        tmpRow.remove();
      }
    }
    await loadManualsList(applianceId);
  }

  // ─── Searchable Material picker — kód spotřebiče vybíraný ze zboží ────────
  // Debounce + ILIKE search přes /api/wh/materials. Zobrazuje top 20 výsledků.
  function setupMaterialPicker(containerId, opts) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let selected = null; // { id, code, name }

    function renderEmpty() {
      container.innerHTML = `
        <input class="search" placeholder="🔍 Vyhledej v katalogu zboží (kód nebo název)…" autocomplete="off">
        <div class="results" style="display:none;"></div>
      `;
      const input = container.querySelector('input.search');
      const results = container.querySelector('.results');
      let timer = null;
      let activeIdx = -1;
      let lastItems = [];

      function close() { results.style.display = 'none'; activeIdx = -1; }
      function open() { results.style.display = 'block'; }

      async function search(q) {
        try {
          const url = '/api/wh/materials' + (q ? '?search=' + encodeURIComponent(q) : '');
          const data = await api(url);
          lastItems = (data || []).slice(0, 20);
          if (!lastItems.length) {
            results.innerHTML = '<div class="empty">Žádné položky neodpovídají</div>';
          } else {
            results.innerHTML = lastItems.map((m, i) => `
              <div class="item" data-idx="${i}">
                <span class="code">${escapeHtml(m.code || '—')}</span>
                <span style="flex:1;">${escapeHtml(m.name || '')}</span>
                ${m.barcode ? `<span style="font-size:11px;color:var(--text2);">${escapeHtml(m.barcode)}</span>` : ''}
              </div>
            `).join('');
            results.querySelectorAll('.item').forEach(node => {
              node.addEventListener('click', () => {
                const idx = parseInt(node.dataset.idx, 10);
                pick(lastItems[idx]);
              });
            });
          }
          open();
        } catch (err) {
          results.innerHTML = `<div class="empty">Chyba: ${escapeHtml(err.message)}</div>`;
          open();
        }
      }

      function pick(mat) {
        selected = { id: mat.id, code: mat.code, name: mat.name };
        opts && opts.onPick && opts.onPick(selected);
        close();
        renderPicked();
      }

      input.addEventListener('input', () => {
        const q = input.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => search(q), 200);
      });
      input.addEventListener('focus', () => {
        if (!results.children.length) search('');
        else open();
      });
      input.addEventListener('keydown', (e) => {
        const items = results.querySelectorAll('.item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIdx = Math.min(items.length - 1, activeIdx + 1);
          items.forEach((n, i) => n.classList.toggle('kbd', i === activeIdx));
          if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIdx = Math.max(0, activeIdx - 1);
          items.forEach((n, i) => n.classList.toggle('kbd', i === activeIdx));
        } else if (e.key === 'Enter') {
          if (activeIdx >= 0 && lastItems[activeIdx]) {
            e.preventDefault();
            pick(lastItems[activeIdx]);
          }
        } else if (e.key === 'Escape') {
          close();
        }
      });

      document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) close();
      });
    }

    function renderPicked() {
      if (!selected) return renderEmpty();
      container.innerHTML = `
        <div class="picked">
          <span class="code">${escapeHtml(selected.code || '—')}</span>
          <span class="name">${escapeHtml(selected.name || '')}</span>
          <span class="clear" title="Odebrat výběr">✕</span>
        </div>
      `;
      container.querySelector('.picked .clear').addEventListener('click', () => {
        selected = null;
        opts && opts.onPick && opts.onPick(null);
        renderEmpty();
      });
      // Klik kdekoli na picked → odemkne search input pro výměnu výběru
      container.querySelector('.picked .name').addEventListener('click', () => {
        renderEmpty();
        setTimeout(() => container.querySelector('input.search')?.focus(), 10);
      });
    }

    // Inicializace — pokud máme initial material_id, dotahneme jeho data
    if (opts && opts.initialId) {
      // Doptáme se backendu, ať máme aktuální code/name (pokud byl Material smazaný, fallback na initialCode)
      api('/api/wh/materials/' + opts.initialId).then(m => {
        if (m && m.id) {
          selected = { id: m.id, code: m.code, name: m.name };
          renderPicked();
        } else if (opts.initialCode) {
          // Fallback — material nenalezen, zobraz placeholder s kódem
          selected = { id: null, code: opts.initialCode, name: '(materiál v katalogu nenalezen)' };
          renderPicked();
        } else {
          renderEmpty();
        }
      }).catch(() => renderEmpty());
    } else {
      renderEmpty();
    }
  }

  window.openApplianceModal = async function (id) {
    const item = id ? await api('/api/service/appliances/' + id) : null;
    const root = document.getElementById('modal-root');
    const data = item || { name: '', manufacturer: '', model_code: '', description: '', manual_url: '', photo_url: '', material_id: null, product_links: [] };
    const links = new Map();
    (data.product_links || []).forEach(pl => links.set(pl.product_id, pl));

    root.innerHTML = '';
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal', style: { width: '720px' } });
    overlay.appendChild(modal);

    modal.innerHTML = `
      <h2>${item ? '⚙️ Upravit spotřebič' : '⚙️ Nový spotřebič'}</h2>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Název</label>
          <input id="ap-name" value="${escapeHtml(data.name)}" placeholder="Motor bubnu">
        </div>
        <div class="form-row">
          <label>Výrobce</label>
          <input id="ap-mfr" value="${escapeHtml(data.manufacturer || '')}" placeholder="Selni / Bonfiglioli…">
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Kód ze zboží (Material z katalogu)</label>
          <div id="ap-material-picker" class="searchable-pick"></div>
          <!-- skryté pole — drží vybrané material_id pro save -->
          <input type="hidden" id="ap-material-id" value="${data.material_id || ''}">
          <input type="hidden" id="ap-model" value="${escapeHtml(data.model_code || '')}">
        </div>
        <div class="form-row">
          <label>Odkaz na manuál výrobce (volitelné)</label>
          <input id="ap-manual" value="${escapeHtml(data.manual_url || '')}" placeholder="https://…">
        </div>
      </div>
      <div class="form-row">
        <label>Popis</label>
        <textarea id="ap-desc" rows="3" placeholder="Krátký popis funkce a umístění…">${escapeHtml(data.description || '')}</textarea>
      </div>
      <div class="form-row">
        <label>V kterých výrobcích je</label>
        <div class="chip-pick" id="pick-app-products">
          <select onchange="window.__servis_pickAppProduct(this)">
            <option value="">+ Přidat produkt…</option>
            ${realProducts().map(p => `<option value="${p.id}">${p.code || ''} ${p.name}</option>`).join('')}
          </select>
        </div>
      </div>
      ${item ? `
        <div class="form-row" id="manuals-section">
          <label>Manuály a dokumenty (PDF — Hugo z nich čerpá)</label>
          <div id="manuals-list" style="margin-bottom:10px;"></div>
          <div id="manuals-drop" style="border:2px dashed var(--border); border-radius:10px; padding:18px; text-align:center; color:var(--text2); font-size:13px; cursor:pointer;">
            <div style="font-size:24px; margin-bottom:4px;">📎</div>
            <div>Přetáhni sem PDF (max 50 MB) nebo <span style="color:#22d3ee; text-decoration:underline;">klikni a vyber soubor</span></div>
            <div style="font-size:11px; margin-top:6px;">Po nahrání Hugo z dokumentu čerpá při dotazech partnerů.</div>
            <input type="file" id="manuals-file" accept="application/pdf,image/*,text/plain" multiple style="display:none;">
          </div>
        </div>
      ` : `
        <div class="form-row" style="font-size:12px; color:var(--text2); padding:10px; background:rgba(34,211,238,0.04); border-radius:8px; border:1px solid rgba(34,211,238,0.15);">
          ℹ️ Nejdřív spotřebič ulož — pak budeš moct přidávat PDF manuály.
        </div>
      `}
      <div class="modal-actions">
        ${item ? '<button class="btn btn-danger" onclick="window.__servis_deleteAppliance('+item.id+')">Smazat</button>' : ''}
        <button class="btn btn-secondary" onclick="document.getElementById('modal-root').innerHTML=''">Zrušit</button>
        <button class="btn btn-primary" onclick="window.__servis_saveAppliance(${item ? item.id : 'null'})">Uložit</button>
      </div>
    `;
    root.appendChild(overlay);

    // Pokud editujeme existující spotřebič → načti manuály a nabídni upload
    if (item && item.id) {
      setupManualsSection(item.id);
    }

    // Inicializace Material pickeru pro „Kód ze zboží"
    setupMaterialPicker('ap-material-picker', {
      initialId: data.material_id || null,
      initialCode: data.model_code || null,
      onPick: (mat) => {
        document.getElementById('ap-material-id').value = mat ? mat.id : '';
        document.getElementById('ap-model').value = mat ? (mat.code || '') : '';
      },
    });

    const pickedSet = new Set(Array.from(links.keys()));
    renderPickChips('pick-app-products', pickedSet, id => products.find(p => p.id === id), id => `${products.find(p => p.id === id)?.code || ''} ${products.find(p => p.id === id)?.name || '#'+id}`);

    window.__servis_pickAppProduct = function (sel) {
      const id = parseInt(sel.value, 10);
      if (id) pickedSet.add(id);
      sel.value = '';
      renderPickChips('pick-app-products', pickedSet, id => products.find(p => p.id === id), id => `${products.find(p => p.id === id)?.code || ''} ${products.find(p => p.id === id)?.name || '#'+id}`);
    };

    window.__servis_saveAppliance = async function (id) {
      const payload = {
        name: document.getElementById('ap-name').value.trim(),
        manufacturer: document.getElementById('ap-mfr').value.trim() || null,
        model_code: document.getElementById('ap-model').value.trim() || null,
        manual_url: document.getElementById('ap-manual').value.trim() || null,
        description: document.getElementById('ap-desc').value.trim() || null,
        material_id: parseInt(document.getElementById('ap-material-id').value, 10) || null,
        product_links: Array.from(pickedSet).map(pid => ({ product_id: pid })),
      };
      if (!payload.name) { alert('Název je povinný'); return; }
      try {
        if (id) await api('/api/service/appliances/' + id, { method: 'PUT', body: payload });
        else await api('/api/service/appliances', { method: 'POST', body: payload });
        root.innerHTML = '';
        await loadAppliances();
      } catch (err) { alert('Chyba: ' + err.message); }
    };

    window.__servis_deleteAppliance = async function (id) {
      if (!confirm('Smazat spotřebič?')) return;
      try {
        await api('/api/service/appliances/' + id, { method: 'DELETE' });
        root.innerHTML = '';
        await loadAppliances();
      } catch (err) { alert('Chyba: ' + err.message); }
    };
  };

  // ─── KATEGORIE ────────────────────────────────────────────────────────────

  window.loadCategories = async function () {
    categories = await api('/api/service/categories');
    const tbody = document.getElementById('categories-tbody');
    tbody.innerHTML = '';
    categories.forEach(c => {
      const tr = el('tr', null,
        el('td', null, el('strong', null, c.name)),
        el('td', null, c.icon || '—'),
        el('td', null, c.color ? el('span', { style: { display: 'inline-block', width: '16px', height: '16px', background: c.color, borderRadius: '4px', verticalAlign: 'middle', marginRight: '4px' } }) : '', c.color || '—'),
        el('td', null, String(c.sort_order || 0)),
        el('td', null, (c._count && c._count.articles) || 0),
        el('td', null, el('button', { class: 'btn btn-sm btn-secondary', onclick: () => openCategoryModal(c.id) }, 'Upravit')),
      );
      tbody.appendChild(tr);
    });
    fillCategoryFilter();
  };

  window.openCategoryModal = async function (id) {
    const data = id ? categories.find(c => c.id === id) : { name: '', icon: '', color: '#22d3ee', sort_order: 0 };
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal', style: { width: '500px' } });
    overlay.appendChild(modal);
    modal.innerHTML = `
      <h2>${id ? '🏷️ Upravit kategorii' : '🏷️ Nová kategorie'}</h2>
      <div class="form-row"><label>Název</label><input id="c-name" value="${escapeHtml(data.name)}"></div>
      <div class="form-grid-2">
        <div class="form-row"><label>Ikona (emoji)</label><input id="c-icon" value="${escapeHtml(data.icon || '')}" placeholder="⚙️"></div>
        <div class="form-row"><label>Barva</label><input id="c-color" type="color" value="${data.color || '#22d3ee'}"></div>
      </div>
      <div class="form-row"><label>Pořadí</label><input id="c-sort" type="number" value="${data.sort_order || 0}"></div>
      <div class="modal-actions">
        ${id ? '<button class="btn btn-danger" onclick="window.__servis_deleteCategory('+id+')">Smazat</button>' : ''}
        <button class="btn btn-secondary" onclick="document.getElementById('modal-root').innerHTML=''">Zrušit</button>
        <button class="btn btn-primary" onclick="window.__servis_saveCategory(${id || 'null'})">Uložit</button>
      </div>
    `;
    root.appendChild(overlay);

    window.__servis_saveCategory = async function (id) {
      const payload = {
        name: document.getElementById('c-name').value.trim(),
        icon: document.getElementById('c-icon').value.trim() || null,
        color: document.getElementById('c-color').value || null,
        sort_order: parseInt(document.getElementById('c-sort').value, 10) || 0,
      };
      if (!payload.name) { alert('Název je povinný'); return; }
      try {
        if (id) await api('/api/service/categories/' + id, { method: 'PUT', body: payload });
        else await api('/api/service/categories', { method: 'POST', body: payload });
        root.innerHTML = '';
        await loadCategories();
      } catch (err) { alert('Chyba: ' + err.message); }
    };
    window.__servis_deleteCategory = async function (id) {
      if (!confirm('Smazat kategorii?')) return;
      try {
        await api('/api/service/categories/' + id, { method: 'DELETE' });
        root.innerHTML = '';
        await loadCategories();
      } catch (err) { alert('Chyba: ' + err.message); }
    };
  };

  // ─── PARTNEŘI ────────────────────────────────────────────────────────────

  // Robustní copy-to-clipboard — fallback přes execCommand pro HTTP / staré prohlížeče
  async function copyText(text) {
    // Cesta 1: moderní async API (vyžaduje HTTPS nebo localhost)
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) { /* spadneme na fallback */ }
    }
    // Cesta 2: skrytá textarea + execCommand (funguje skoro všude)
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch (_) {}
    return false;
  }

  function visualConfirm(btn, okText, originalText) {
    const orig = originalText || btn.innerHTML;
    btn.innerHTML = okText;
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }

  // Napojení copy tlačítka v banneru (DOMContentLoaded už proběhl než se sem dostaneme,
  // ale element je v staticky vyrenderovaném HTML, takže ho najdeme rovnou).
  (function attachShareBannerCopy() {
    const btn = document.getElementById('hugo-copy-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const url = 'https://bestseries.cash/hugo';
      const ok = await copyText(url);
      if (ok) {
        visualConfirm(btn, '✓ Zkopírováno');
      } else {
        // Poslední záchrana — prompt s předvybraným textem, který může ručně Ctrl+C
        prompt('Stiskni Ctrl+C pro zkopírování:', url);
      }
    });
  })();

  // Zachováno pro starší volání (modul Partner detail) — používá stejnou robustní funkci.
  window.__servis_copyHugoUrl = async function (btn) {
    const url = 'https://bestseries.cash/hugo';
    const ok = await copyText(url);
    if (ok) visualConfirm(btn, '✓ Zkopírováno');
    else prompt('Stiskni Ctrl+C:', url);
  };

  window.loadPartners = async function () {
    partners = await api('/api/service/partners');
    const tbody = document.getElementById('partners-tbody');
    tbody.innerHTML = '';
    if (!partners.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="ico">👥</div>Žádní partneři. <a href="#" onclick="openPartnerModal();return false" style="color:#22d3ee">Vytvořit prvního</a>.</div></td></tr>`;
      return;
    }
    // Naplň také filter pro chat audit
    const chatPartnerSel = document.getElementById('chat-filter-partner');
    chatPartnerSel.innerHTML = '<option value="">Všichni partneři</option>' +
      partners.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');

    partners.forEach(p => {
      const productCount = (p.products || []).length;
      const tr = el('tr', null,
        el('td', null, el('code', null, p.username)),
        el('td', null, p.display_name),
        el('td', null, p.company ? p.company.name : '—'),
        el('td', null, p.email || '—'),
        el('td', null, productCount ? productCount + '×' : '—'),
        el('td', null, (p._count && p._count.chat_sessions) || 0),
        el('td', null, p.last_login_at ? new Date(p.last_login_at).toLocaleString('cs-CZ') : '—'),
        el('td', null, el('span', { class: 'badge ' + (p.active ? 'badge-published' : 'badge-archived') }, p.active ? 'Aktivní' : 'Neaktivní')),
        el('td', null, el('button', { class: 'btn btn-sm btn-secondary', onclick: () => openPartnerModal(p.id) }, 'Upravit')),
      );
      tbody.appendChild(tr);
    });
  };

  window.openPartnerModal = async function (id) {
    const data = id ? partners.find(p => p.id === id) : { username: '', display_name: '', email: '', phone: '', language: 'cs', active: true, products: [], company: null };
    const productIds = new Set((data.products || []).map(p => p.product_id));
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal', style: { width: '680px' } });
    overlay.appendChild(modal);
    const shareBlock = id ? `
      <div style="margin-bottom:18px; background:rgba(34,211,238,0.06); border:1px solid rgba(34,211,238,0.2); border-radius:10px; padding:12px 14px;">
        <div style="font-size:11px; color:var(--text2); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">Sdílet přístup s partnerem</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <code style="background:var(--bg); padding:6px 10px; border-radius:6px; font-size:12px;">https://bestseries.cash/hugo</code>
          <button class="btn btn-sm btn-secondary" onclick="window.__servis_copyShareInfo(${id})">📋 Kopírovat údaje</button>
          <button class="btn btn-sm btn-secondary" onclick="window.__servis_emailShareInfo(${id})">✉️ Poslat e-mailem</button>
        </div>
      </div>
    ` : '';

    modal.innerHTML = `
      <h2>${id ? '👤 Upravit partnera' : '👤 Nový partner'}</h2>
      ${shareBlock}
      <div class="form-grid-2">
        <div class="form-row"><label>Username (login)</label><input id="p-username" value="${escapeHtml(data.username)}" ${id ? 'readonly style="opacity:0.6"' : ''}></div>
        <div class="form-row"><label>Zobrazované jméno</label><input id="p-name" value="${escapeHtml(data.display_name)}"></div>
      </div>
      <div class="form-row">
        <label>Firma (z adresáře)</label>
        <select id="p-company">
          <option value="">— bez firmy / soukromý partner —</option>
          ${companies.map(c => `<option value="${c.id}" ${(data.company?.id || data.company_id) === c.id ? 'selected' : ''}>${escapeHtml(c.name)}${c.ico ? ' (IČO ' + escapeHtml(c.ico) + ')' : ''}</option>`).join('')}
        </select>
        <div style="font-size:11px; color:var(--text2); margin-top:4px;">
          Firma se hledá v <a href="/modules/nakup-sklad/index.html#companies" target="_blank" style="color:#22d3ee;">adresáři</a>. Pokud tam ještě není, založ ji nejdřív tam.
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row"><label>Email</label><input id="p-email" type="email" value="${escapeHtml(data.email || '')}" placeholder="kontakt@firma.cz"></div>
        <div class="form-row"><label>Telefon</label><input id="p-phone" value="${escapeHtml(data.phone || '')}" placeholder="+420 ..."></div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Výchozí jazyk</label>
          <select id="p-lang">
            <option value="cs" ${data.language==='cs'?'selected':''}>CZ — Čeština</option>
            <option value="sk" ${data.language==='sk'?'selected':''}>SK — Slovenčina</option>
            <option value="en" ${data.language==='en'?'selected':''}>EN — English</option>
            <option value="de" ${data.language==='de'?'selected':''}>DE — Deutsch</option>
            <option value="pl" ${data.language==='pl'?'selected':''}>PL — Polski</option>
            <option value="hu" ${data.language==='hu'?'selected':''}>HU — Magyar</option>
            <option value="ro" ${data.language==='ro'?'selected':''}>RO — Română</option>
            <option value="hr" ${data.language==='hr'?'selected':''}>HR — Hrvatski</option>
            <option value="sl" ${data.language==='sl'?'selected':''}>SI — Slovenščina</option>
            <option value="sr" ${data.language==='sr'?'selected':''}>RS — Srpski</option>
            <option value="bg" ${data.language==='bg'?'selected':''}>BG — Български</option>
            <option value="fr" ${data.language==='fr'?'selected':''}>FR — Français</option>
            <option value="es" ${data.language==='es'?'selected':''}>ES — Español</option>
            <option value="it" ${data.language==='it'?'selected':''}>IT — Italiano</option>
            <option value="pt" ${data.language==='pt'?'selected':''}>PT — Português</option>
            <option value="nl" ${data.language==='nl'?'selected':''}>NL — Nederlands</option>
            <option value="el" ${data.language==='el'?'selected':''}>GR — Ελληνικά</option>
            <option value="da" ${data.language==='da'?'selected':''}>DK — Dansk</option>
            <option value="sv" ${data.language==='sv'?'selected':''}>SE — Svenska</option>
            <option value="no" ${data.language==='no'?'selected':''}>NO — Norsk</option>
            <option value="fi" ${data.language==='fi'?'selected':''}>FI — Suomi</option>
            <option value="et" ${data.language==='et'?'selected':''}>EE — Eesti</option>
            <option value="lv" ${data.language==='lv'?'selected':''}>LV — Latviešu</option>
            <option value="lt" ${data.language==='lt'?'selected':''}>LT — Lietuvių</option>
            <option value="uk" ${data.language==='uk'?'selected':''}>UA — Українська</option>
            <option value="ru" ${data.language==='ru'?'selected':''}>RU — Русский</option>
          </select>
        </div>
        <div class="form-row">
          <label>${id ? 'Nové heslo (vyplň jen pro reset)' : 'Heslo'}</label>
          <input id="p-password" type="password" placeholder="${id ? 'Nechej prázdné = beze změny' : 'Min. 6 znaků'}">
        </div>
      </div>
      <div class="form-row">
        <label>Stav</label>
        <select id="p-active">
          <option value="true" ${data.active!==false?'selected':''}>Aktivní</option>
          <option value="false" ${data.active===false?'selected':''}>Neaktivní (zablokovaný login)</option>
        </select>
      </div>
      <div class="form-row">
        <label>Produkty (prádlomaty) přiřazené partnerovi — Hugo bude omezený na tyto</label>
        <div class="chip-pick" id="pick-p-products">
          <select onchange="window.__servis_pickPProduct(this)">
            <option value="">+ Přidat produkt…</option>
            ${realProducts().map(p => `<option value="${p.id}">${p.code || ''} ${p.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-actions">
        ${id ? '<button class="btn btn-danger" onclick="window.__servis_deletePartner('+id+')">Smazat</button>' : ''}
        <button class="btn btn-secondary" onclick="document.getElementById('modal-root').innerHTML=''">Zrušit</button>
        <button class="btn btn-primary" onclick="window.__servis_savePartner(${id || 'null'})">Uložit</button>
      </div>
    `;
    root.appendChild(overlay);
    renderPickChips('pick-p-products', productIds, id => products.find(p => p.id === id), id => `${products.find(p => p.id === id)?.code || ''} ${products.find(p => p.id === id)?.name || '#'+id}`);
    window.__servis_pickPProduct = function (sel) {
      const id = parseInt(sel.value, 10);
      if (id) productIds.add(id);
      sel.value = '';
      renderPickChips('pick-p-products', productIds, id => products.find(p => p.id === id), id => `${products.find(p => p.id === id)?.code || ''} ${products.find(p => p.id === id)?.name || '#'+id}`);
    };

    window.__servis_copyShareInfo = async function (partnerId) {
      const p = partners.find(x => x.id === partnerId);
      if (!p) return;
      const txt = `Vítejte v servisní podpoře Best Series.\n\n` +
        `Adresa: https://bestseries.cash/hugo\n` +
        `Přihlašovací jméno: ${p.username}\n` +
        `Heslo: (zaslané samostatně)\n\n` +
        `Po přihlášení vám bude k dispozici AI servisní asistent Hugo — pomůže s běžnými dotazy 24/7.`;
      try {
        await navigator.clipboard.writeText(txt);
        alert('Údaje zkopírovány do schránky.');
      } catch (_) {
        prompt('Zkopíruj ručně:', txt);
      }
    };

    window.__servis_emailShareInfo = function (partnerId) {
      const p = partners.find(x => x.id === partnerId);
      if (!p) return;
      const subject = encodeURIComponent('Přístup k servisní podpoře Best Series (Hugo)');
      const body = encodeURIComponent(
        `Dobrý den ${p.display_name || ''},\n\n` +
        `níže najdete přístup k naší servisní podpoře a AI asistentovi Hugovi.\n\n` +
        `Adresa:           https://bestseries.cash/hugo\n` +
        `Přihlašovací jméno: ${p.username}\n` +
        `Heslo:            (zasíláme samostatně z bezpečnostních důvodů)\n\n` +
        `Hugo zná naše návody a postupy a je k dispozici 24/7. Pokud byste potřebovali přímý kontakt na servisního technika, ozvěte se nám.\n\n` +
        `S pozdravem,\nBest Series s.r.o.`
      );
      const to = p.email || '';
      window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    };

    window.__servis_savePartner = async function (id) {
      const payload = {
        username: document.getElementById('p-username').value.trim(),
        display_name: document.getElementById('p-name').value.trim(),
        email: document.getElementById('p-email').value.trim() || null,
        phone: document.getElementById('p-phone').value.trim() || null,
        company_id: parseInt(document.getElementById('p-company').value, 10) || null,
        language: document.getElementById('p-lang').value,
        active: document.getElementById('p-active').value === 'true',
        product_ids: Array.from(productIds),
      };
      const pwd = document.getElementById('p-password').value;
      if (pwd) payload.password = pwd;
      if (!payload.username || !payload.display_name) { alert('Username a jméno jsou povinné'); return; }
      if (!id && !pwd) { alert('Heslo je povinné při zakládání'); return; }
      try {
        if (id) await api('/api/service/partners/' + id, { method: 'PUT', body: payload });
        else await api('/api/service/partners', { method: 'POST', body: payload });
        root.innerHTML = '';
        await loadPartners();
      } catch (err) { alert('Chyba: ' + err.message); }
    };
    window.__servis_deletePartner = async function (id) {
      if (!confirm('Smazat partnera (smazaná je i celá historie chatu)?')) return;
      try {
        await api('/api/service/partners/' + id, { method: 'DELETE' });
        root.innerHTML = '';
        await loadPartners();
      } catch (err) { alert('Chyba: ' + err.message); }
    };
  };

  // ─── CHAT AUDIT ──────────────────────────────────────────────────────────

  window.loadChatSessions = async function () {
    const params = new URLSearchParams();
    const pid = document.getElementById('chat-filter-partner').value;
    const attn = document.getElementById('chat-filter-attn').checked;
    if (pid) params.set('partner_id', pid);
    if (attn) params.set('needs_attention', 'true');
    const sessions = await api('/api/service/chat-sessions?' + params.toString());
    const tbody = document.getElementById('chat-sessions-tbody');
    tbody.innerHTML = '';
    if (!sessions.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="ico">💬</div>Zatím žádné konverzace.</div></td></tr>`;
      return;
    }
    sessions.forEach(s => {
      const tr = el('tr', { style: { cursor: 'pointer' }, onclick: () => openChatSessionModal(s.id) },
        el('td', null,
          s.needs_attention ? el('span', { style: { color: '#ef4444', marginRight: '4px' } }, '⚠️') : null,
          s.title || '(bez názvu)'),
        el('td', null, s.partner ? s.partner.display_name : '—'),
        el('td', null, String(s._count?.messages || 0)),
        el('td', null, el('span', { class: 'badge badge-' + (s.status === 'active' ? 'published' : 'draft') }, s.status === 'active' ? 'Aktivní' : 'Uzavřená')),
        el('td', null, new Date(s.updated_at).toLocaleString('cs-CZ')),
      );
      tbody.appendChild(tr);
    });
  };

  window.openChatSessionModal = async function (id) {
    const s = await api('/api/service/chat-sessions/' + id);
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal' });
    overlay.appendChild(modal);
    modal.innerHTML = `
      <h2>💬 ${escapeHtml(s.title || 'Konverzace')}</h2>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">
        Partner: <strong>${escapeHtml(s.partner?.display_name || '—')}</strong>
        ${s.partner?.company ? ' (' + escapeHtml(s.partner.company.name) + ')' : ''}
        · Zpráv: ${s.messages.length}
        · ${s.needs_attention ? '<span style="color:#ef4444">⚠️ Hugo nepomohl</span>' : ''}
      </div>
      <div class="chat-log" id="chat-log"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-root').innerHTML=''">Zavřít</button>
      </div>
    `;
    root.appendChild(overlay);
    const log = document.getElementById('chat-log');
    s.messages.forEach(m => {
      const bubble = el('div', { class: 'chat-bubble ' + m.role });
      bubble.innerHTML = mdToHtml(m.body) + (
        m.citations && m.citations.length
          ? '<div class="meta">📎 ' + m.citations.map(c => `<a href="#" onclick="event.stopPropagation();return false">${escapeHtml(c.article?.title || '#'+c.article_id)}</a>`).join(', ') + '</div>'
          : ''
      ) + (
        m.feedback ? `<div class="meta">${m.feedback === 'helpful' ? '👍 Partner ohodnotil jako užitečné' : '👎 Partner: nepomohlo'}</div>` : ''
      );
      log.appendChild(bubble);
    });
    log.scrollTop = log.scrollHeight;
  };
})();
