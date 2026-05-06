// =============================================================================
// HolyOS — AI Vývojář (modul #13) — frontend
// =============================================================================
// Vanilla JS, používá fetch s credentials (httpOnly cookie JWT).
// 4 záložky: Dashboard, Repozitáře, Limity, Audit log.

(function () {
  // Sidebar
  if (typeof renderSidebar === 'function') renderSidebar('ai-vyvojar');

  const API = '/api/agent';

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('cs-CZ', { hour12: false });
    } catch (_e) { return iso; }
  }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch (_e) {}
      throw new Error(`${res.status}: ${msg}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ─── Tabs ──────────────────────────────────────────────────────────────

  $$('.aidev-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.aidev-tab').forEach((b) => b.classList.remove('active'));
      $$('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $('.tab-content[data-tab="' + tab + '"]').classList.add('active');
      onTabChange(tab);
    });
  });

  function onTabChange(tab) {
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'repos') loadRepos();
    if (tab === 'limits') loadLimits();
    if (tab === 'audit') loadAudit();
  }

  // ─── Kill switch ───────────────────────────────────────────────────────

  function renderKillSwitch(enabled) {
    const host = $('#kill-switch-host');
    const cls = enabled ? 'on' : 'off';
    const label = enabled ? 'Master switch ON' : 'Master switch OFF';
    host.innerHTML =
      '<div class="kill-switch ' + cls + '">' +
        '<span class="ks-dot"></span>' +
        '<span>' + label + '</span>' +
        '<button id="btn-toggle-switch">' + (enabled ? 'Vypnout' : 'Zapnout') + '</button>' +
      '</div>';
    $('#btn-toggle-switch').addEventListener('click', async () => {
      const reason = prompt('Důvod (volitelně):') || '';
      try {
        await api('/kill-switch', {
          method: 'POST',
          body: JSON.stringify({ enabled: !enabled, reason }),
        });
        loadDashboard();
      } catch (err) {
        alert('Kill switch selhal: ' + err.message);
      }
    });
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────

  async function loadDashboard() {
    try {
      const data = await api('/dashboard');
      renderKillSwitch(data.settings.enabled);
      renderCounters(data.counters);
      renderQueue(data.queue);
      renderRecentRuns(data.recent_runs);
    } catch (err) {
      $('#counters').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderCounters(c) {
    $('#counters').innerHTML =
      counterCard('Aktivní běhy', c.running) +
      counterCard('Ve frontě', c.queued) +
      counterCard('Dnes spuštěno', c.runs_today) +
      counterCard('Tokenů dnes', (c.tokens_today || 0).toLocaleString('cs-CZ'));
  }

  function counterCard(label, value) {
    return '<div class="counter-card">' +
      '<div class="label">' + escapeHtml(label) + '</div>' +
      '<div class="value">' + escapeHtml(value) + '</div>' +
      '</div>';
  }

  function renderQueue(items) {
    const host = $('#queue-host');
    if (!items || !items.length) {
      host.innerHTML = '<div class="empty">Žádné úkoly nečekají.</div>';
      return;
    }
    host.innerHTML =
      '<table class="data-table"><thead><tr>' +
        '<th>#</th><th>Název</th><th>Priorita</th><th>Status</th><th>Vytvořeno</th>' +
      '</tr></thead><tbody>' +
      items.map((t) =>
        '<tr>' +
          '<td>' + t.id + '</td>' +
          '<td>' + escapeHtml(t.page_title || '(bez názvu)') + '</td>' +
          '<td>' + escapeHtml(t.priority) + '</td>' +
          '<td><span class="chip ' + escapeHtml(t.status) + '">' + escapeHtml(t.status) + '</span></td>' +
          '<td>' + fmtDate(t.created_at) + '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table>';
  }

  function shortSummary(text, maxLen) {
    if (!text) return '';
    const trimmed = String(text).replace(/\s+/g, ' ').trim();
    if (trimmed.length <= maxLen) return trimmed;
    return trimmed.slice(0, maxLen - 1) + '…';
  }

  function renderRecentRuns(runs) {
    const host = $('#recent-runs-host');
    if (!runs || !runs.length) {
      host.innerHTML = '<div class="empty">Zatím žádné běhy.</div>';
      return;
    }
    host.innerHTML =
      '<table class="data-table"><thead><tr>' +
        '<th>Spuštěno</th><th>Úkol</th><th>Status</th><th>PR</th><th>Soub.</th><th>Tokens</th><th>Shrnutí</th><th></th>' +
      '</tr></thead><tbody>' +
      runs.map((r) =>
        '<tr>' +
          '<td>' + fmtDate(r.started_at) + '</td>' +
          '<td>#' + r.task_id + ' ' + escapeHtml(r.task && r.task.page_title ? r.task.page_title : '') + '</td>' +
          '<td><span class="chip ' + escapeHtml(r.status) + '">' + escapeHtml(r.status) + '</span></td>' +
          '<td>' + (r.pr_url ? '<a href="' + escapeHtml(r.pr_url) + '" target="_blank">PR #' + r.pr_number + '</a>' : '—') + '</td>' +
          '<td style="text-align:center;color:var(--text2);">' + (r.file_changes_count != null ? r.file_changes_count : '—') + '</td>' +
          '<td>' + (r.tokens_used || 0).toLocaleString('cs-CZ') + '</td>' +
          '<td title="' + escapeHtml(r.summary || r.failure_reason || '') + '" style="color:var(--text2);font-size:12px;max-width:340px;">' + escapeHtml(shortSummary(r.summary || r.failure_reason, 80)) + '</td>' +
          '<td><button class="btn" data-run-id="' + escapeHtml(r.id) + '">Detail</button></td>' +
        '</tr>'
      ).join('') +
      '</tbody></table>';

    host.querySelectorAll('button[data-run-id]').forEach((b) => {
      b.addEventListener('click', () => openRunDetail(b.dataset.runId));
    });
  }

  // ─── Repozitáře ────────────────────────────────────────────────────────

  let _repos = [];

  async function loadRepos() {
    try {
      _repos = await api('/repos');
      renderRepos();
    } catch (err) {
      $('#repos-host').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderRepos() {
    const host = $('#repos-host');
    if (!_repos.length) {
      host.innerHTML = '<div class="empty">Žádné repozitáře. Přidej první přes tlačítko nahoře.</div>';
      return;
    }
    host.innerHTML =
      '<table class="data-table"><thead><tr>' +
        '<th>Název</th><th>Git URL</th><th>Branch</th><th>Auto-merge</th><th>Aktivní</th><th></th>' +
      '</tr></thead><tbody>' +
      _repos.map((r) =>
        '<tr>' +
          '<td><strong>' + escapeHtml(r.name) + '</strong></td>' +
          '<td style="font-family:ui-monospace,monospace; font-size:12px;">' + escapeHtml(r.git_url) + '</td>' +
          '<td>' + escapeHtml(r.default_branch) + '</td>' +
          '<td>' + (r.allow_auto_merge ? '✓' : '—') + '</td>' +
          '<td>' + (r.active ? '✓' : '—') + '</td>' +
          '<td>' +
            '<button class="btn" data-edit-id="' + escapeHtml(r.id) + '">Upravit</button> ' +
            '<button class="btn danger" data-del-id="' + escapeHtml(r.id) + '">Smazat</button>' +
          '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table>';

    host.querySelectorAll('button[data-edit-id]').forEach((b) => {
      b.addEventListener('click', () => editRepo(b.dataset.editId));
    });
    host.querySelectorAll('button[data-del-id]').forEach((b) => {
      b.addEventListener('click', () => deleteRepo(b.dataset.delId));
    });
  }

  $('#btn-new-repo').addEventListener('click', () => openRepoForm(null));
  $('#btn-cancel-repo').addEventListener('click', () => { $('#repo-form-host').style.display = 'none'; });

  function openRepoForm(repo) {
    $('#repo-form-host').style.display = 'block';
    $('#repo-form-title').textContent = repo ? ('Upravit repozitář — ' + repo.name) : 'Nový repozitář';
    $('#repo-id').value = repo ? repo.id : '';
    $('#repo-name').value = repo ? repo.name : '';
    $('#repo-git-url').value = repo ? repo.git_url : '';
    $('#repo-default-branch').value = repo ? repo.default_branch : 'main';
    $('#repo-allow-auto-merge').checked = repo ? !!repo.allow_auto_merge : false;
    $('#repo-active').checked = repo ? !!repo.active : true;
    $('#repo-protected-branches').value = repo && repo.protected_branches ? repo.protected_branches.join(', ') : '';
    $('#repo-required-checks').value = repo && repo.required_checks ? repo.required_checks.join(', ') : '';
    $('#repo-tech-stack').value = repo && repo.tech_stack ? JSON.stringify(repo.tech_stack, null, 2) : '';
  }

  function editRepo(id) {
    const r = _repos.find((x) => x.id === id);
    if (r) openRepoForm(r);
  }

  async function deleteRepo(id) {
    const r = _repos.find((x) => x.id === id);
    if (!r) return;
    if (!confirm('Smazat repozitář "' + r.name + '"? Pokud na něj odkazují úkoly, smazání selže.')) return;
    try {
      await api('/repos/' + id, { method: 'DELETE' });
      loadRepos();
    } catch (err) {
      alert('Smazání selhalo: ' + err.message);
    }
  }

  $('#btn-save-repo').addEventListener('click', async () => {
    const id = $('#repo-id').value;
    const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    let techStack = undefined;
    const tsRaw = $('#repo-tech-stack').value.trim();
    if (tsRaw) {
      try { techStack = JSON.parse(tsRaw); }
      catch (e) { alert('tech_stack není platný JSON: ' + e.message); return; }
    }
    const body = {
      name: $('#repo-name').value.trim(),
      git_url: $('#repo-git-url').value.trim(),
      default_branch: $('#repo-default-branch').value.trim() || 'main',
      allow_auto_merge: $('#repo-allow-auto-merge').checked,
      active: $('#repo-active').checked,
      protected_branches: csv($('#repo-protected-branches').value),
      required_checks: csv($('#repo-required-checks').value),
    };
    if (techStack !== undefined) body.tech_stack = techStack;

    try {
      if (id) {
        await api('/repos/' + id, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/repos', { method: 'POST', body: JSON.stringify(body) });
      }
      $('#repo-form-host').style.display = 'none';
      loadRepos();
    } catch (err) {
      alert('Uložení selhalo: ' + err.message);
    }
  });

  // ─── Limity ────────────────────────────────────────────────────────────

  async function loadLimits() {
    try {
      const s = await api('/settings');
      $('#lim-default-autonomy').value = s.default_autonomy;
      $('#lim-max-concurrent').value = s.max_concurrent_runs;
      $('#lim-max-per-day').value = s.max_runs_per_day;
      $('#lim-token-budget').value = s.daily_token_budget;
      $('#lim-timeout').value = s.default_timeout_minutes;
      $('#lim-max-commits').value = s.max_commits_per_run;
      $('#lim-merge-wait').value = s.auto_merge_wait_minutes;
    } catch (err) {
      $('#limits-host').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    }
  }

  $('#btn-save-limits').addEventListener('click', async () => {
    const body = {
      default_autonomy: $('#lim-default-autonomy').value,
      max_concurrent_runs: parseInt($('#lim-max-concurrent').value, 10) || 0,
      max_runs_per_day: parseInt($('#lim-max-per-day').value, 10) || 0,
      daily_token_budget: parseInt($('#lim-token-budget').value, 10) || 0,
      default_timeout_minutes: parseInt($('#lim-timeout').value, 10) || 30,
      max_commits_per_run: parseInt($('#lim-max-commits').value, 10) || 10,
      auto_merge_wait_minutes: parseInt($('#lim-merge-wait').value, 10) || 0,
    };
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
      alert('Uloženo.');
      loadDashboard();
    } catch (err) {
      alert('Uložení selhalo: ' + err.message);
    }
  });

  // ─── Audit log ─────────────────────────────────────────────────────────

  async function loadAudit() {
    const status = $('#audit-status-filter').value;
    try {
      const items = await api('/runs' + (status ? '?status=' + encodeURIComponent(status) : ''));
      renderAuditList(items);
    } catch (err) {
      $('#audit-list-host').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderAuditList(items) {
    const host = $('#audit-list-host');
    if (!items.length) {
      host.innerHTML = '<div class="empty">Žádné záznamy pro vybraný filtr.</div>';
      return;
    }
    host.innerHTML =
      '<table class="data-table"><thead><tr>' +
        '<th>Spuštěno</th><th>Úkol</th><th>Repo</th><th>Status</th><th>PR</th><th>Soub.</th><th>Tokens</th><th>Shrnutí</th><th></th>' +
      '</tr></thead><tbody>' +
      items.map((r) =>
        '<tr>' +
          '<td>' + fmtDate(r.started_at) + '</td>' +
          '<td>#' + r.task_id + '</td>' +
          '<td>' + escapeHtml(r.repo ? r.repo.name : '—') + '</td>' +
          '<td><span class="chip ' + escapeHtml(r.status) + '">' + escapeHtml(r.status) + '</span></td>' +
          '<td>' + (r.pr_url ? '<a href="' + escapeHtml(r.pr_url) + '" target="_blank">PR #' + r.pr_number + '</a>' : '—') + '</td>' +
          '<td style="text-align:center;color:var(--text2);">' + (r.file_changes_count != null ? r.file_changes_count : '—') + '</td>' +
          '<td>' + (r.tokens_used || 0).toLocaleString('cs-CZ') + '</td>' +
          '<td title="' + escapeHtml(r.summary || r.failure_reason || '') + '" style="color:var(--text2);font-size:12px;max-width:340px;">' + escapeHtml(shortSummary(r.summary || r.failure_reason, 80)) + '</td>' +
          '<td><button class="btn" data-run-id="' + escapeHtml(r.id) + '">Detail</button></td>' +
        '</tr>'
      ).join('') +
      '</tbody></table>';

    host.querySelectorAll('button[data-run-id]').forEach((b) => {
      b.addEventListener('click', () => openRunDetail(b.dataset.runId));
    });
  }

  $('#btn-refresh-audit').addEventListener('click', loadAudit);
  $('#audit-status-filter').addEventListener('change', loadAudit);

  async function openRunDetail(runId) {
    // Přepni na audit tab a načti detail
    $$('.aidev-tab').forEach((b) => b.classList.remove('active'));
    $$('.tab-content').forEach((c) => c.classList.remove('active'));
    $('.aidev-tab[data-tab="audit"]').classList.add('active');
    $('.tab-content[data-tab="audit"]').classList.add('active');
    try {
      const run = await api('/runs/' + runId);
      $('#audit-detail-host').style.display = 'block';
      $('#audit-detail-summary').innerHTML =
        '<div><strong>Run:</strong> <span style="font-family:ui-monospace,monospace; font-size:12px;">' + escapeHtml(run.id) + '</span></div>' +
        '<div><strong>Úkol:</strong> #' + run.task_id + ' ' + escapeHtml(run.task && run.task.page_title ? run.task.page_title : '') + '</div>' +
        '<div><strong>Status:</strong> <span class="chip ' + escapeHtml(run.status) + '">' + escapeHtml(run.status) + '</span></div>' +
        '<div><strong>Branch:</strong> ' + escapeHtml(run.branch || '—') + '</div>' +
        '<div><strong>PR:</strong> ' + (run.pr_url ? '<a href="' + escapeHtml(run.pr_url) + '" target="_blank">' + escapeHtml(run.pr_url) + '</a>' : '—') + '</div>' +
        '<div><strong>Tokeny:</strong> ' + (run.tokens_used || 0).toLocaleString('cs-CZ') + ' &nbsp; <strong>Commitů:</strong> ' + (run.commits_count || 0) + '</div>' +
        '<div><strong>Spuštěno:</strong> ' + fmtDate(run.started_at) + ' &nbsp; <strong>Ukončeno:</strong> ' + fmtDate(run.ended_at) + '</div>' +
        (run.failure_reason ? '<div style="color:#ef4444; margin-top:6px;"><strong>Chyba:</strong> ' + escapeHtml(run.failure_reason) + '</div>' : '') +
        (run.summary ? '<div style="margin-top:8px;"><strong>Shrnutí:</strong> ' + escapeHtml(run.summary) + '</div>' : '') +
        '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
          (run.status === 'pr_open' ? '<button class="btn" id="btn-merge-pr" style="background:#22c55e;color:white;border-color:#22c55e;">🟢 Mergnout PR</button>' : '') +
          (run.status === 'pr_open' ? '<button class="btn" id="btn-close-pr" style="background:#ef4444;color:white;border-color:#ef4444;">🔴 Zavřít PR</button>' : '') +
          '<button class="btn danger" id="btn-cancel-run">Zrušit běh</button>' +
        '</div>';

      const mergeBtn = $('#btn-merge-pr');
      if (mergeBtn) {
        mergeBtn.addEventListener('click', async () => {
          if (!confirm('Mergnout PR #' + run.pr_number + ' (squash) a označit úkol jako Hotový?')) return;
          try {
            const res = await api('/runs/' + runId + '/merge', { method: 'POST', body: JSON.stringify({}) });
            alert('✅ PR mergnut. SHA: ' + (res.sha || '?'));
            openRunDetail(runId);
          } catch (err) { alert('Merge selhal: ' + err.message); }
        });
      }

      const closeBtn = $('#btn-close-pr');
      if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
          if (!confirm('Zavřít PR #' + run.pr_number + ' bez mergeru? Větev zůstane na GitHubu.')) return;
          const reason = prompt('Důvod (volitelně):') || '';
          try {
            await api('/runs/' + runId + '/close', { method: 'POST', body: JSON.stringify({ reason }) });
            alert('PR zavřen.');
            openRunDetail(runId);
          } catch (err) { alert('Zavření selhalo: ' + err.message); }
        });
      }

      const cancelBtn = $('#btn-cancel-run');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          if (!confirm('Opravdu zrušit tento běh?')) return;
          const reason = prompt('Důvod:') || 'Manual cancel';
          try {
            await api('/runs/' + runId + '/cancel', {
              method: 'POST', body: JSON.stringify({ reason }),
            });
            openRunDetail(runId);
          } catch (err) { alert('Zrušení selhalo: ' + err.message); }
        });
      }

      $('#audit-detail-events').innerHTML =
        '<div class="events-list">' +
        (run.events && run.events.length ? run.events.map((e) =>
          '<div class="event-row">' +
            '<div class="at">' + fmtDate(e.at) + '</div>' +
            '<div class="kind">' + escapeHtml(e.kind) + '</div>' +
            '<div class="payload">' + escapeHtml(e.payload ? JSON.stringify(e.payload, null, 2) : '') + '</div>' +
          '</div>'
        ).join('') : '<div class="empty">Žádné události.</div>') +
        '</div>';
    } catch (err) {
      $('#audit-detail-host').style.display = 'block';
      $('#audit-detail-summary').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
      $('#audit-detail-events').innerHTML = '';
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────

  loadDashboard();
})();
