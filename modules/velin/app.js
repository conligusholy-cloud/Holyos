// =============================================================================
// Velín — Admin UI logika
// =============================================================================
// 5 záložek: Dnes (live), Úkoly, Zařízení (aktivace), Skill profily, Geo fence.
// Auth: HolyOS JWT z httpOnly cookie nebo sessionStorage (kompatibilní s ostatními moduly).

(function () {
  'use strict';

  const API = '/api/velin';
  const $ = (sel) => document.querySelector(sel);

  function authHeaders() {
    const t = sessionStorage.getItem('token');
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }
  async function apiGet(path) {
    const r = await fetch(API + path, { credentials: 'include', headers: authHeaders() });
    if (!r.ok) throw new Error(await r.text() || r.statusText);
    return r.json();
  }
  async function apiSend(method, path, body) {
    const r = await fetch(API + path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(await r.text() || r.statusText);
    return r.json();
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const panel = document.getElementById('tab-' + t.dataset.tab);
      if (panel) panel.classList.add('active');
      loadTab(t.dataset.tab);
    });
  });
  $('#vln-refresh').addEventListener('click', () => loadTab(currentTab()));

  function currentTab() {
    const a = document.querySelector('.tab.active');
    return a ? a.dataset.tab : 'today';
  }

  // ─── Modal helpers ────────────────────────────────────────────────────
  function openModal(html) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal">${html}</div></div>`;
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  window.__velinCloseModal = closeModal;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function initials(p) {
    if (!p) return '?';
    const a = (p.first_name || '').charAt(0);
    const b = (p.last_name || '').charAt(0);
    return (a + b).toUpperCase() || '?';
  }
  function statusBadge(status) {
    const map = {
      proposed:    ['Navrženo', 'b-proposed'],
      accepted:    ['Přijato', 'b-accepted'],
      in_progress: ['Probíhá', 'b-progress'],
      blocked:     ['Blokováno', 'b-blocked'],
      done:        ['Hotovo', 'b-done'],
      cancelled:   ['Zrušeno', 'b-cancelled'],
      timed_out:   ['Vypršelo', 'b-cancelled'],
    };
    const [label, cls] = map[status] || [status, 'b-proposed'];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  // ─── Tab: Dnes ─────────────────────────────────────────────────────────
  async function loadToday() {
    const wrap = $('#today-list');
    wrap.innerHTML = '<div class="empty-state">Načítám…</div>';
    try {
      const { plans } = await apiGet('/admin/live-day');
      const totalPeople = plans.length;
      const totalTasks = plans.reduce((sum, p) => sum + (p.assignments?.length || 0), 0);
      const inProgress = plans.reduce((s, p) => s + p.assignments.filter((a) => a.status === 'in_progress').length, 0);
      const done = plans.reduce((s, p) => s + p.assignments.filter((a) => a.status === 'done').length, 0);
      const blocked = plans.reduce((s, p) => s + p.assignments.filter((a) => a.status === 'blocked').length, 0);
      $('#today-stats').innerHTML = `
        <div class="stat-card"><div class="stat-label">Plány dnes</div><div class="stat-value">${totalPeople}</div></div>
        <div class="stat-card"><div class="stat-label">Úkoly celkem</div><div class="stat-value">${totalTasks}</div></div>
        <div class="stat-card"><div class="stat-label">Probíhá</div><div class="stat-value" style="color:#f59e0b">${inProgress}</div></div>
        <div class="stat-card"><div class="stat-label">Hotovo</div><div class="stat-value" style="color:#22c55e">${done}</div></div>
        <div class="stat-card"><div class="stat-label">Blokátoři</div><div class="stat-value" style="color:#ef4444">${blocked}</div></div>
      `;

      if (plans.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><h3>Žádné plány na dnešek</h3><p>Vygenerují se ráno automaticky, nebo přidej kolegovi úkol ručně.</p></div>`;
        return;
      }
      wrap.innerHTML = plans.map((p) => {
        const a = p.assignments || [];
        const sum = a.length;
        const inP = a.filter((x) => x.status === 'in_progress').length;
        const dn = a.filter((x) => x.status === 'done').length;
        const bl = a.filter((x) => x.status === 'blocked').length;
        return `
          <div class="live-row">
            <div class="avatar">${initials(p.person)}</div>
            <div class="info">
              <div class="name">${escapeHtml((p.person.first_name||'') + ' ' + (p.person.last_name||''))}</div>
              <div class="meta">Plán: <b>${p.status}</b> · vygenerovaný ${escapeHtml(p.generated_by)}</div>
            </div>
            <div class="stats">
              <b>${sum}</b> úkol${sum===1?'':sum>=2&&sum<=4?'y':'ů'} · probíhá <b style="color:#f59e0b">${inP}</b> · hotovo <b style="color:#22c55e">${dn}</b> ${bl ? '· blokováno <b style="color:#ef4444">'+bl+'</b>' : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      wrap.innerHTML = `<div class="empty-state" style="color:#ef4444">Chyba: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ─── Tab: Úkoly ────────────────────────────────────────────────────────
  async function loadTasks() {
    const wrap = $('#tasks-table-wrap');
    wrap.innerHTML = '<div class="empty-state">Načítám…</div>';
    try {
      const { plans } = await apiGet('/admin/live-day');
      const filterStatus = $('#task-filter-status').value;
      let rows = [];
      for (const p of plans) {
        for (const a of (p.assignments || [])) {
          if (filterStatus && a.status !== filterStatus) continue;
          rows.push({ ...a, person: p.person });
        }
      }
      if (rows.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><h3>Žádné úkoly</h3></div>`;
        return;
      }
      wrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Osoba</th><th>Úkol</th><th>Zdroj</th><th>Priorita</th>
              <th>Odhad</th><th>Termín</th><th>Stav</th>
            </tr>
          </thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td>${escapeHtml((r.person.first_name||'') + ' ' + (r.person.last_name||''))}</td>
              <td><b>${escapeHtml(r.title)}</b>${r.description ? '<div style="font-size:12px;color:var(--text2);margin-top:2px">'+escapeHtml(r.description.slice(0,120))+'</div>' : ''}</td>
              <td>${escapeHtml(r.source)}</td>
              <td>${r.priority}</td>
              <td>${r.estimated_min ? r.estimated_min + ' min' : '—'}</td>
              <td>${r.due_at ? new Date(r.due_at).toLocaleString('cs-CZ') : '—'}</td>
              <td>${statusBadge(r.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      wrap.innerHTML = `<div class="empty-state" style="color:#ef4444">Chyba: ${escapeHtml(e.message)}</div>`;
    }
  }
  $('#task-filter-status').addEventListener('change', loadTasks);
  $('#btn-new-task').addEventListener('click', openNewTaskModal);

  async function openNewTaskModal() {
    let people = [];
    try {
      const r = await fetch('/api/hr/people?active=true', { credentials: 'include', headers: authHeaders() });
      const data = await r.json();
      people = Array.isArray(data) ? data : (data.people || []);
    } catch {}
    openModal(`
      <h2>Nový úkol pro kolegu</h2>
      <form id="form-new-task">
        <div class="form-grid">
          <div class="form-group">
            <label>Komu</label>
            <select name="person_id" required>
              <option value="">— vyber osobu —</option>
              ${people.map((p) => `<option value="${p.id}">${escapeHtml((p.first_name||'') + ' ' + (p.last_name||''))}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Priorita (1=kritická, 5=nízká)</label>
            <select name="priority"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option></select>
          </div>
          <div class="form-group full">
            <label>Název úkolu *</label>
            <input name="title" required maxlength="500" placeholder="Co se má udělat?" />
          </div>
          <div class="form-group full">
            <label>Popis</label>
            <textarea name="description" placeholder="Detaily, podmínky, co je hotovo, atd."></textarea>
          </div>
          <div class="form-group">
            <label>Odhad (min)</label>
            <input name="estimated_min" type="number" min="1" max="1440" />
          </div>
          <div class="form-group">
            <label>Termín</label>
            <input name="due_at" type="datetime-local" />
          </div>
          <div class="form-group full">
            <label>Místo (nápověda)</label>
            <input name="location_hint" maxlength="255" placeholder="Hala A, Sklad-A-RK, …" />
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="__velinCloseModal()">Zrušit</button>
          <button type="submit" class="btn btn-primary">Vytvořit a poslat push</button>
        </div>
      </form>
    `);
    document.getElementById('form-new-task').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const data = {
        person_id: parseInt(f.person_id.value, 10),
        title: f.title.value.trim(),
        description: f.description.value.trim() || undefined,
        priority: parseInt(f.priority.value, 10),
        estimated_min: f.estimated_min.value ? parseInt(f.estimated_min.value, 10) : undefined,
        due_at: f.due_at.value ? new Date(f.due_at.value).toISOString() : undefined,
        location_hint: f.location_hint.value.trim() || undefined,
        push: true,
      };
      try {
        await apiSend('POST', '/admin/tasks', data);
        closeModal();
        loadTasks();
        loadToday();
      } catch (e) {
        alert('Chyba: ' + e.message);
      }
    });
  }

  // ─── Tab: Zařízení ─────────────────────────────────────────────────────
  async function loadDevices() {
    const wrap = $('#devices-table-wrap');
    wrap.innerHTML = '<div class="empty-state">Načítám…</div>';
    try {
      const { devices } = await apiGet('/admin/devices');
      if (devices.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📱</div><h3>Žádné zařízení</h3><p>Klikni na <b>Aktivovat zařízení</b> a předej kolegovi 6-místný kód.</p></div>`;
        return;
      }
      wrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>Osoba</th><th>Platforma</th><th>Štítek</th><th>Verze</th><th>Naposled</th><th>Stav</th><th></th></tr>
          </thead>
          <tbody>${devices.map((d) => `
            <tr>
              <td>${d.person ? escapeHtml((d.person.first_name||'') + ' ' + (d.person.last_name||'')) : '—'}</td>
              <td><span class="badge b-platform-${d.platform}">${d.platform}</span></td>
              <td>${escapeHtml(d.device_label || '')}</td>
              <td>${escapeHtml(d.app_version || '')} ${d.os_version ? '· '+escapeHtml(d.os_version) : ''}</td>
              <td>${new Date(d.last_seen_at).toLocaleString('cs-CZ')}</td>
              <td>${d.active ? '<span class="badge b-done">Aktivní</span>' : '<span class="badge b-cancelled">Zrušeno</span>'}</td>
              <td>${d.active ? `<button class="btn btn-danger btn-sm" data-revoke="${d.id}">Odebrat</button>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      `;
      wrap.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Opravdu odebrat přístup tomuto zařízení?')) return;
        try { await apiSend('POST', '/admin/devices/' + b.dataset.revoke + '/revoke', { reason: 'admin_revoke_ui' }); loadDevices(); }
        catch (e) { alert(e.message); }
      }));
    } catch (e) {
      wrap.innerHTML = `<div class="empty-state" style="color:#ef4444">Chyba: ${escapeHtml(e.message)}</div>`;
    }
  }
  $('#btn-activate-device').addEventListener('click', openActivationModal);

  async function openActivationModal() {
    let people = [];
    try {
      const r = await fetch('/api/hr/people?active=true', { credentials: 'include', headers: authHeaders() });
      const data = await r.json();
      people = Array.isArray(data) ? data : (data.people || []);
    } catch {}
    openModal(`
      <h2>Aktivovat zařízení</h2>
      <p style="color:var(--text2); font-size:13px; margin-bottom:12px;">Vyber kolegu — vygenerujeme jednorázový kód, který kolega zadá ve Velínu spolu s vlastním PIN.</p>
      <div class="form-group full">
        <label>Osoba</label>
        <select id="act-person">
          <option value="">— vyber —</option>
          ${people.map((p) => `<option value="${p.id}">${escapeHtml((p.first_name||'') + ' ' + (p.last_name||''))}</option>`).join('')}
        </select>
      </div>
      <div id="act-result"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="__velinCloseModal()">Zavřít</button>
        <button class="btn btn-primary" id="act-generate">Vygenerovat kód</button>
      </div>
    `);
    document.getElementById('act-generate').addEventListener('click', async () => {
      const pid = parseInt(document.getElementById('act-person').value, 10);
      if (!pid) { alert('Vyber kolegu'); return; }
      try {
        const r = await apiSend('POST', '/admin/activation/' + pid);
        const expires = new Date(r.expires_at).toLocaleString('cs-CZ');
        document.getElementById('act-result').innerHTML = `
          <div class="activation-code">${r.activation_code}</div>
          <div class="activation-meta">Platí do <b>${expires}</b>. Kód kolegovi opiš, foť, pošli — po aktivaci přestane fungovat.</div>
        `;
      } catch (e) { alert('Chyba: ' + e.message); }
    });
  }

  // ─── Tab: Skill profily ────────────────────────────────────────────────
  async function loadSkills() {
    const wrap = $('#skills-list');
    wrap.innerHTML = '<div class="empty-state">Načítám…</div>';
    try {
      const { profiles } = await apiGet('/admin/skill-profiles');
      if (profiles.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⭐</div><h3>Žádné skill profily</h3><p>Až bude potřeba (Fáze 5: AI dispečer), naplníme profily kolegů.</p></div>`;
        return;
      }
      wrap.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Osoba</th><th>Skills</th><th>Směna</th><th>Speed factor</th><th>Poznámka</th></tr></thead>
          <tbody>${profiles.map((p) => `
            <tr>
              <td>${escapeHtml((p.person.first_name||'') + ' ' + (p.person.last_name||''))}</td>
              <td><code style="font-size:11px">${escapeHtml(JSON.stringify(p.skills || []))}</code></td>
              <td>${escapeHtml(p.preferred_shift || '—')}</td>
              <td>${p.speed_factor}×</td>
              <td>${escapeHtml(p.notes || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      wrap.innerHTML = `<div class="empty-state" style="color:#ef4444">Chyba: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ─── Tab: Geo fence ────────────────────────────────────────────────────
  async function loadFences() {
    const wrap = $('#fences-list');
    wrap.innerHTML = '<div class="empty-state">Načítám…</div>';
    try {
      const { fences } = await apiGet('/admin/fences');
      if (fences.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🗺️</div><h3>Žádné provozy</h3><p>Definuj GPS zónu kolem provozu — Velín podle ní pozná, že kolega přišel do práce.</p></div>`;
        return;
      }
      wrap.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Název</th><th>Souřadnice</th><th>Radius</th><th>Stav</th><th></th></tr></thead>
          <tbody>${fences.map((f) => `
            <tr>
              <td><b>${escapeHtml(f.name)}</b>${f.notes ? '<div style="font-size:12px;color:var(--text2)">'+escapeHtml(f.notes)+'</div>' : ''}</td>
              <td><code style="font-size:11px">${f.center_lat.toFixed(5)}, ${f.center_lng.toFixed(5)}</code></td>
              <td>${f.radius_m} m</td>
              <td>${f.active ? '<span class="badge b-done">Aktivní</span>' : '<span class="badge b-cancelled">Vypnuto</span>'}</td>
              <td><a class="btn btn-sm btn-secondary" target="_blank" href="https://www.google.com/maps/@${f.center_lat},${f.center_lng},18z">Mapa</a></td>
            </tr>`).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      wrap.innerHTML = `<div class="empty-state" style="color:#ef4444">Chyba: ${escapeHtml(e.message)}</div>`;
    }
  }
  $('#btn-new-fence').addEventListener('click', openNewFenceModal);

  function openNewFenceModal() {
    openModal(`
      <h2>Nový provoz (geo fence)</h2>
      <form id="form-fence">
        <div class="form-grid">
          <div class="form-group full">
            <label>Název *</label>
            <input name="name" required maxlength="255" placeholder="Provoz Velké Hamry" />
          </div>
          <div class="form-group">
            <label>Latitude *</label>
            <input name="center_lat" type="number" step="any" required placeholder="50.7236" />
          </div>
          <div class="form-group">
            <label>Longitude *</label>
            <input name="center_lng" type="number" step="any" required placeholder="15.2497" />
          </div>
          <div class="form-group">
            <label>Radius (m)</label>
            <input name="radius_m" type="number" min="50" max="2000" value="150" />
          </div>
          <div class="form-group full">
            <label>Poznámka</label>
            <textarea name="notes" placeholder="Volitelné — popis, kontakt…"></textarea>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="__velinCloseModal()">Zrušit</button>
          <button type="submit" class="btn btn-primary">Vytvořit</button>
        </div>
      </form>
    `);
    document.getElementById('form-fence').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const data = {
        name: f.name.value.trim(),
        center_lat: parseFloat(f.center_lat.value),
        center_lng: parseFloat(f.center_lng.value),
        radius_m: parseInt(f.radius_m.value, 10) || 150,
        notes: f.notes.value.trim() || undefined,
      };
      try {
        await apiSend('POST', '/admin/fences', data);
        closeModal();
        loadFences();
      } catch (e) { alert('Chyba: ' + e.message); }
    });
  }

  // ─── Dispatcher ────────────────────────────────────────────────────────
  function loadTab(name) {
    if (name === 'today')   return loadToday();
    if (name === 'tasks')   return loadTasks();
    if (name === 'devices') return loadDevices();
    if (name === 'skills')  return loadSkills();
    if (name === 'fences')  return loadFences();
  }

  // Init
  loadToday();
})();
