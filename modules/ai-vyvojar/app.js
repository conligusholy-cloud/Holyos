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

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'metrics-days') loadMetrics();
  });

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
    if (tab === 'rules') loadRules();
    if (tab === 'approvals') loadApprovals();
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
    // Metriky se nahrávají samostatně (jiný endpoint, jiné period filter)
    loadMetrics();
  }

  // Připoj seeder tlačítko k recent-runs-host (po prvním loadDashboard)
  document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'btn-open-seeder') {
      openSeederModal();
    }
  });

  // Window-level wrapper pro openSeederModal a closeSeederModal (volaný z onclick)
  window.openSeederModal = function() { openSeederModal(); };
  window.closeSeederModal = function() { closeSeederModal(); };

  async function loadMetrics() {
    const daysSel = $('#metrics-days');
    const days = daysSel ? (parseInt(daysSel.value, 10) || 30) : 30;
    try {
      const m = await api('/metrics?days=' + days);
      renderMetrics(m);
    } catch (err) {
      $('#metrics-host').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function formatPct(rate) {
    if (rate === null || rate === undefined) return '—';
    return Math.round(rate * 100) + ' %';
  }

  function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '—';
    if (seconds < 60) return seconds + ' s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ' min ' + (s > 0 ? s + ' s' : '');
  }

  function renderMetrics(m) {
    if (!m || m.total_runs === 0) {
      $('#metrics-host').innerHTML = '<div class="empty">Žádné běhy za posledních ' + (m && m.period_days) + ' dní.</div>';
      return;
    }
    const bs = m.by_status || {};
    const mergeRateColor = m.merge_rate === null ? '#888' : (m.merge_rate >= 0.7 ? '#22c55e' : (m.merge_rate >= 0.4 ? '#f59e0b' : '#ef4444'));
    const retryRateColor = m.retry && m.retry.retry_rate !== null
      ? (m.retry.retry_rate >= 0.4 ? '#ef4444' : (m.retry.retry_rate >= 0.2 ? '#f59e0b' : '#22c55e'))
      : '#888';

    let html = '<div class="counters" style="margin-top:0;">';
    html += counterCardWithSub(
      'Merge rate',
      '<span style="color:' + mergeRateColor + ';">' + formatPct(m.merge_rate) + '</span>',
      (bs.merged + (bs.completed || 0)) + ' z ' + ((bs.merged || 0) + (bs.completed || 0) + (bs.failed || 0) + (bs.escalated || 0)) + ' rozhodnuto'
    );
    html += counterCardWithSub(
      'Retry rate',
      '<span style="color:' + retryRateColor + ';">' + formatPct(m.retry ? m.retry.retry_rate : null) + '</span>',
      (m.retry ? m.retry.tasks_with_retry : 0) + ' z ' + (m.retry ? m.retry.unique_tasks : 0) + ' úkolů'
    );
    html += counterCardWithSub(
      'Tokenů / run',
      (m.tokens.avg_per_run || 0).toLocaleString('cs-CZ'),
      'celkem ' + (m.tokens.total || 0).toLocaleString('cs-CZ') + ' (' + m.tokens.finished_runs + ' runů)'
    );
    html += counterCardWithSub(
      'Doba / run',
      formatDuration(m.avg_duration_seconds),
      m.tokens.finished_runs + ' dokončených'
    );
    const pa = m.plan_approvals || {};
    const planTotal = pa.approved + pa.rejected;
    html += counterCardWithSub(
      'Plán approval',
      formatPct(pa.approval_rate),
      pa.approved + ' z ' + planTotal + ' schváleno' + (pa.pending ? ' (' + pa.pending + ' pending)' : '')
    );
    html += counterCardWithSub(
      'Běhů celkem',
      m.total_runs.toLocaleString('cs-CZ'),
      (bs.merged || 0) + ' merged · ' + (bs.failed || 0) + ' failed · ' + (bs.escalated || 0) + ' escalated'
    );
    html += '</div>';
    $('#metrics-host').innerHTML = html;
  }

  function counterCardWithSub(label, value, sub) {
    return '<div class="counter-card">' +
      '<div class="label">' + escapeHtml(label) + '</div>' +
      '<div class="value">' + value + '</div>' +
      '<div class="hint">' + escapeHtml(sub) + '</div>' +
      '</div>';
  }

  // ─── AI Seeder (Fáze 4: AI navrhuje úkoly z historie) ───────────────────

  async function openSeederModal() {
    document.getElementById('modal-root') ||
      (function() { const d = document.createElement('div'); d.id = 'modal-root'; document.body.appendChild(d); })();
    const root = document.getElementById('modal-root') || (function() {
      const d = document.createElement('div'); d.id = 'modal-root'; document.body.appendChild(d); return d;
    })();

    root.innerHTML =
      '<div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;" onclick="closeSeederModal()">' +
        '<div style="background:var(--surface);padding:20px;border-radius:8px;min-width:600px;max-width:95vw;max-height:90vh;overflow-y:auto;color:var(--text);border:1px solid var(--border);" onclick="event.stopPropagation()">' +
          '<h3 style="margin:0 0 10px;">🌱 AI navrhuje úkoly</h3>' +
          '<p style="font-size:12px;color:var(--text2);margin-bottom:14px;">' +
            'Alan se podívá na poslední failed/escalated runs + rejected plans a navrhne 1-3 úkoly, které stojí za vytvoření. Bez DB persistence — návrhy zatím nikam neukládám.' +
          '</p>' +
          '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;">' +
            '<label style="font-size:13px;">Období: <input id="seeder-lookback" type="number" value="30" min="1" max="365" style="width:70px;padding:4px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:4px;"></label>' +
            '<span style="font-size:13px;">dní</span>' +
            '<button class="btn" id="btn-seeder-run" style="background:#22c55e;color:white;border-color:#22c55e;margin-left:auto;">🌱 Spustit návrh</button>' +
          '</div>' +
          '<div id="seeder-results"><div class="empty">Klikni „🌱 Spustit návrh" pro vygenerování návrhů.</div></div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">' +
            '<button class="btn" onclick="closeSeederModal()">Zavřít</button>' +
            '<button class="btn primary" id="btn-seeder-accept" style="display:none;">✅ Vytvořit vybrané úkoly</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-seeder-run').addEventListener('click', runSeeder);
    document.getElementById('btn-seeder-accept').addEventListener('click', acceptSelectedProposals);
  }

  function closeSeederModal() {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
  }

  let _seederProposals = [];

  async function runSeeder() {
    const days = parseInt(document.getElementById('seeder-lookback').value, 10) || 30;
    const btn = document.getElementById('btn-seeder-run');
    btn.disabled = true; btn.textContent = '⏳ Alan přemýšlí...';
    try {
      const data = await api('/seeder/propose', {
        method: 'POST',
        body: JSON.stringify({ lookback_days: days }),
      });
      _seederProposals = data.proposals || [];
      renderSeederResults(data);
    } catch (err) {
      document.getElementById('seeder-results').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    } finally {
      btn.disabled = false; btn.textContent = '🌱 Spustit znovu';
    }
  }

  function renderSeederResults(data) {
    const host = document.getElementById('seeder-results');
    const proposals = data.proposals || [];
    if (proposals.length === 0) {
      host.innerHTML = '<div class="empty">Alan nenavrhl žádné úkoly. Reason: ' +
        escapeHtml(data.reason || 'Nedostatek dat / patternů') +
        '<br><small>Stats: ' + escapeHtml(JSON.stringify(data.stats)) + '</small></div>';
      document.getElementById('btn-seeder-accept').style.display = 'none';
      return;
    }
    let html = '<div style="margin-bottom:8px;font-size:12px;color:var(--text2);">' +
      '🪙 ' + (data.tokensUsed || 0) + ' tokens spotřebováno. Vyber, které chceš vytvořit:' +
      '</div>';
    proposals.forEach((p, i) => {
      const priorityColor = p.priority === 'high' ? '#ef4444' : (p.priority === 'low' ? '#22c55e' : '#f59e0b');
      html += '<div style="background:var(--surface2,rgba(0,0,0,0.2));border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;">' +
        '<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;">' +
          '<input type="checkbox" class="seeder-pick" data-idx="' + i + '" checked style="margin-top:4px;">' +
          '<div style="flex:1;">' +
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">' +
              '<strong>' + escapeHtml(p.page_title) + '</strong>' +
              '<span class="chip" style="background:' + priorityColor + '22;color:' + priorityColor + ';">' + escapeHtml(p.priority) + '</span>' +
              (p.change_type ? '<span class="chip" style="background:rgba(14,165,233,0.15);color:#0ea5e9;">' + escapeHtml(p.change_type) + '</span>' : '') +
              (p.affected_module ? '<span class="chip" style="background:rgba(168,139,250,0.15);color:#a78bfa;">' + escapeHtml(p.affected_module) + '</span>' : '') +
            '</div>' +
            '<div style="font-size:12px;color:var(--text);margin-bottom:4px;white-space:pre-wrap;">' + escapeHtml(p.description) + '</div>' +
            (p.acceptance_criteria ? '<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:11px;color:var(--text2);">📋 Akceptační kritéria</summary><pre style="font-size:11px;font-family:ui-monospace,monospace;background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;margin-top:4px;white-space:pre-wrap;">' + escapeHtml(p.acceptance_criteria) + '</pre></details>' : '') +
            (p.seeder_reason ? '<div style="font-size:11px;color:var(--text2);font-style:italic;margin-top:4px;">💡 ' + escapeHtml(p.seeder_reason) + '</div>' : '') +
          '</div>' +
        '</label>' +
      '</div>';
    });
    host.innerHTML = html;
    document.getElementById('btn-seeder-accept').style.display = 'inline-block';
  }

  async function acceptSelectedProposals() {
    const checks = Array.from(document.querySelectorAll('.seeder-pick:checked'));
    if (checks.length === 0) { alert('Vyber alespoň 1 návrh.'); return; }
    const drafts = checks.map((c) => _seederProposals[parseInt(c.dataset.idx, 10)]).filter(Boolean);
    if (!confirm('Vytvořit ' + drafts.length + ' nové úkoly?')) return;
    try {
      const data = await api('/seeder/accept', {
        method: 'POST',
        body: JSON.stringify({ drafts }),
      });
      alert('✅ Vytvořeno ' + (data.created || []).length + ' úkolů. Najdi je v Požadavcích.');
      closeSeederModal();
    } catch (err) {
      alert('Chyba: ' + err.message);
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
        '<div><strong>Repo:</strong> ' + escapeHtml(run.repo && run.repo.name ? run.repo.name : '—') + '</div>' +
        '<div><strong>Branch:</strong> ' + escapeHtml(run.branch || '—') + '</div>' +
        '<div><strong>PR:</strong> ' + (run.pr_url ? '<a href="' + escapeHtml(run.pr_url) + '" target="_blank">' + escapeHtml(run.pr_url) + '</a>' : '—') + '</div>' +
        '<div><strong>Tokeny:</strong> ' + (run.tokens_used || 0).toLocaleString('cs-CZ') + ' &nbsp; <strong>Commitů:</strong> ' + (run.commits_count || 0) + '</div>' +
        '<div><strong>Spuštěno:</strong> ' + fmtDate(run.started_at) + ' &nbsp; <strong>Ukončeno:</strong> ' + fmtDate(run.ended_at) + '</div>' +
        (run.failure_reason ? '<div style="color:#ef4444; margin-top:6px;"><strong>Chyba:</strong> ' + escapeHtml(run.failure_reason) + '</div>' : '') +
        (run.summary ? '<div style="margin-top:8px;"><strong>Shrnutí:</strong> ' + escapeHtml(run.summary) + '</div>' : '') +
        '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
          (run.status === 'pr_open' ? '<button class="btn" id="btn-merge-pr" style="background:#22c55e;color:white;border-color:#22c55e;">🟢 Mergnout PR</button>' : '') +
          (run.status === 'pr_open' ? '<button class="btn" id="btn-close-pr" style="background:#ef4444;color:white;border-color:#ef4444;">🔴 Zavřít PR</button>' : '') +
          '<button class="btn" id="btn-reassign-repo" style="background:#0ea5e9;color:white;border-color:#0ea5e9;">🔁 Změnit repo</button>' +
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

      const reassignBtn = $('#btn-reassign-repo');
      if (reassignBtn) {
        reassignBtn.addEventListener('click', () => {
          openReassignRepoModal(runId, run.task_id, run.repo && run.repo.id);
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

  // ─── Reassign target_repa z detailu run ────────────────────────────────
  //
  // Inline modal (žádný shared modal-root v tomhle modulu). Volá stejný PUT
  // endpoint jako admin-tasks UI: /api/admin-tasks/:id { target_repo_id }.
  // Backend (admin-tasks.routes.js) odmítne s 409, pokud existuje aktivní run
  // — tj. tlačítko stiskneš na pr_open / coding / queued runu, dostaneš zpět
  // hlášku „nejdřív cancelni run". Po cancelu reassign smí proběhnout.
  async function openReassignRepoModal(runId, taskId, currentRepoId) {
    let allRepos;
    try {
      allRepos = await api('/repos');
    } catch (err) {
      alert('Nelze načíst repozitáře: ' + err.message);
      return;
    }
    const active = (Array.isArray(allRepos) ? allRepos : []).filter((r) => r.active !== false);
    if (!active.length) {
      alert('Žádné aktivní repozitáře. Přidej nejdřív v záložce Repozitáře.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface,#1a1b2e);padding:20px;border-radius:8px;min-width:480px;max-width:95vw;color:var(--text,#e8e8f0);border:1px solid var(--border,#333);';
    const optionsHtml = active.map((r) => {
      const sel = r.id === currentRepoId ? ' selected' : '';
      return '<option value="' + escapeHtml(r.id) + '"' + sel + '>' + escapeHtml(r.name) + ' — ' + escapeHtml(r.git_url) + '</option>';
    }).join('');
    box.innerHTML =
      '<h3 style="margin:0 0 10px;">🔁 Změnit cílový repo úkolu #' + taskId + '</h3>' +
      '<p style="font-size:13px;color:var(--text2,#aaa);margin-bottom:14px;">' +
        'Pokud běží aktivní run (RUNNING nebo pr_open), reassign se odmítne se zprávou — nejdřív ho cancelni tlačítkem „Zrušit běh".' +
      '</p>' +
      '<label style="display:block;font-size:12px;color:var(--text2,#aaa);margin-bottom:4px;">Cílový repozitář</label>' +
      '<select id="ai-reassign-select" style="width:100%;padding:8px;background:var(--surface,#0f1020);border:1px solid var(--border,#333);color:var(--text,#e8e8f0);border-radius:6px;margin-bottom:12px;font-size:13px;">' +
        optionsHtml +
      '</select>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
        '<button class="btn" id="ai-reassign-cancel">Zrušit</button>' +
        '<button class="btn" id="ai-reassign-save" style="background:#0ea5e9;color:white;border-color:#0ea5e9;">🔁 Reassign</button>' +
      '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => { try { document.body.removeChild(overlay); } catch (_) {} };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    box.querySelector('#ai-reassign-cancel').addEventListener('click', close);
    box.querySelector('#ai-reassign-save').addEventListener('click', async () => {
      const newRepoId = box.querySelector('#ai-reassign-select').value;
      if (!newRepoId) { alert('Vyber repozitář.'); return; }
      if (newRepoId === currentRepoId) { close(); return; }
      try {
        const r = await fetch('/api/admin-tasks/' + taskId, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_repo_id: newRepoId }),
        });
        if (r.status === 409) {
          let err = {};
          try { err = await r.json(); } catch (_) {}
          alert((err && err.message) || 'Aktivní AI run blokuje reassign. Cancelni ho a zkus to znovu.');
          return;
        }
        if (!r.ok) { alert('Reassign selhal (HTTP ' + r.status + ').'); return; }
        close();
        openRunDetail(runId);
      } catch (e) {
        alert('Chyba: ' + e.message);
      }
    });
  }


  // ─── Pravidla (kind=forbidden / requires_approval / allowed) ─────────────
  //
  // Frontend nad /api/agent/rules. Backend (services/ai-developer/runner.js)
  // aktuálně aplikuje jen kind='forbidden' + scope='path_pattern' v každém
  // runu — ostatní kombinace jsou rezerva pro Fázi 3 (approval workflow).

  let _rules = [];

  async function loadRules() {
    try {
      const params = [];
      const kind = $('#rule-filter-kind') && $('#rule-filter-kind').value;
      const scope = $('#rule-filter-scope') && $('#rule-filter-scope').value;
      const onlyActive = $('#rule-filter-active-only') && $('#rule-filter-active-only').checked;
      if (kind) params.push('kind=' + encodeURIComponent(kind));
      if (scope) params.push('scope=' + encodeURIComponent(scope));
      if (onlyActive) params.push('active=true');
      const qs = params.length ? '?' + params.join('&') : '';
      _rules = await api('/rules' + qs);
      renderRules();
    } catch (err) {
      $('#rules-host').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderRules() {
    if (!_rules || _rules.length === 0) {
      $('#rules-host').innerHTML = '<div class="empty">Žádná pravidla. Klikni „+ Přidat pravidlo".</div>';
      return;
    }
    let html = '<table class="data-table" style="width:100%; border-collapse:collapse;">' +
      '<thead><tr>' +
      '<th>KIND</th><th>SCOPE</th><th>VALUE</th><th>POPIS</th>' +
      '<th>AKTIVNÍ</th><th>ZABLOK.</th><th></th>' +
      '</tr></thead><tbody>';
    for (const r of _rules) {
      const kindColor = r.kind === 'forbidden' ? '#ef4444' : (r.kind === 'requires_approval' ? '#f59e0b' : '#22c55e');
      html += '<tr>' +
        '<td><span class="chip" style="background:' + kindColor + '22; color:' + kindColor + ';">' + escapeHtml(r.kind) + '</span></td>' +
        '<td>' + escapeHtml(r.scope) + '</td>' +
        '<td style="font-family:ui-monospace,monospace; font-size:12px; max-width:300px; word-break:break-all;">' + escapeHtml(r.value) + '</td>' +
        '<td style="font-size:12px; color:var(--text2); max-width:280px;">' + escapeHtml(r.description || '—') + '</td>' +
        '<td>' + (r.active ? '✓' : '—') + '</td>' +
        '<td>' + (r.blocked_count || 0) + '</td>' +
        '<td>' +
          '<button class="btn" data-edit-rule="' + escapeHtml(r.id) + '">Upravit</button> ' +
          '<button class="btn danger" data-del-rule="' + escapeHtml(r.id) + '">Smazat</button>' +
        '</td>' +
      '</tr>';
    }
    html += '</tbody></table>';
    $('#rules-host').innerHTML = html;

    $$('[data-edit-rule]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = _rules.find((x) => x.id === b.dataset.editRule);
        if (r) openRuleForm(r);
      });
    });
    $$('[data-del-rule]').forEach((b) => {
      b.addEventListener('click', () => deleteRule(b.dataset.delRule));
    });
  }

  function openRuleForm(rule) {
    $('#rule-form-title').textContent = rule ? 'Upravit pravidlo' : 'Nové pravidlo';
    $('#rule-id').value = rule ? rule.id : '';
    $('#rule-kind').value = rule ? rule.kind : 'forbidden';
    $('#rule-scope').value = rule ? rule.scope : 'path_pattern';
    $('#rule-value').value = rule ? rule.value : '';
    $('#rule-description').value = rule ? (rule.description || '') : '';
    $('#rule-active').checked = rule ? !!rule.active : true;
    $('#rule-form-host').style.display = 'block';
    $('#rule-value').focus();
  }

  async function deleteRule(id) {
    const r = _rules.find((x) => x.id === id);
    if (!r) return;
    if (!confirm('Smazat pravidlo ' + r.kind + '/' + r.scope + ' "' + r.value + '"?')) return;
    try {
      await api('/rules/' + id, { method: 'DELETE' });
      loadRules();
    } catch (err) {
      alert('Smazání selhalo: ' + err.message);
    }
  }

  $('#btn-new-rule').addEventListener('click', () => openRuleForm(null));
  $('#btn-cancel-rule').addEventListener('click', () => { $('#rule-form-host').style.display = 'none'; });
  $('#rule-filter-kind').addEventListener('change', loadRules);
  $('#rule-filter-scope').addEventListener('change', loadRules);
  $('#rule-filter-active-only').addEventListener('change', loadRules);

  $('#btn-save-rule').addEventListener('click', async () => {
    const id = $('#rule-id').value;
    const body = {
      kind: $('#rule-kind').value,
      scope: $('#rule-scope').value,
      value: $('#rule-value').value.trim(),
      description: $('#rule-description').value.trim() || null,
      active: $('#rule-active').checked,
    };
    if (!body.value) { alert('Vyplň value.'); return; }
    try {
      if (id) {
        await api('/rules/' + id, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/rules', { method: 'POST', body: JSON.stringify(body) });
      }
      $('#rule-form-host').style.display = 'none';
      loadRules();
    } catch (err) {
      alert('Uložení selhalo: ' + err.message);
    }
  });


  // ─── Schvalovací fronta (approvals) ──────────────────────────────────────
  //
  // Frontend nad /api/agent/approvals. MVP bez napojení na runner — runner
  // zatím netvoří approvaly automaticky. Schvalování (Schválit / Zamítnout)
  // ale funguje end-to-end přes /approvals/:id/decide.

  let _approvals = [];

  async function loadApprovals() {
    try {
      const decision = $('#approval-filter-decision').value;
      const qs = decision ? '?decision=' + encodeURIComponent(decision) : '';
      _approvals = await api('/approvals' + qs);
      renderApprovals();
    } catch (err) {
      $('#approvals-host').innerHTML = '<div class="empty">Chyba: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderApprovals() {
    if (!_approvals || _approvals.length === 0) {
      $('#approvals-host').innerHTML = '<div class="empty">Žádné approvaly. Runner zatím netvoří automaticky — vytvoř manuálně přes API pro test.</div>';
      return;
    }
    let html = '<table class="data-table" style="width:100%; border-collapse:collapse;">' +
      '<thead><tr>' +
      '<th>KIND</th><th>ÚKOL</th><th>REPO</th><th>RUN STATUS</th>' +
      '<th>VYŽÁDÁNO</th><th>DECISION</th><th>ROZHODL</th><th></th>' +
      '</tr></thead><tbody>';
    for (const a of _approvals) {
      const decisionColor = a.decision === 'pending' ? '#f59e0b'
        : (a.decision === 'approved' ? '#22c55e'
        : (a.decision === 'rejected' ? '#ef4444' : '#888'));
      const taskTitle = a.run && a.run.task ? a.run.task.page_title : '';
      const taskId = a.run && a.run.task ? a.run.task.id : '?';
      const repoName = a.run && a.run.repo ? a.run.repo.name : '—';
      const runStatus = a.run ? a.run.status : '—';
      const deciderName = a.decider ? (a.decider.display_name || a.decider.username) : '—';
      html += '<tr>' +
        '<td><span class="chip" style="background:rgba(14,165,233,0.15);color:#0ea5e9;">' + escapeHtml(a.kind) + '</span></td>' +
        '<td>#' + taskId + ' ' + escapeHtml(shortSummary(taskTitle, 50)) + '</td>' +
        '<td>' + escapeHtml(repoName) + '</td>' +
        '<td><span class="chip ' + escapeHtml(runStatus) + '">' + escapeHtml(runStatus) + '</span></td>' +
        '<td style="font-size:12px;">' + fmtDate(a.requested_at) + '</td>' +
        '<td><span class="chip" style="background:' + decisionColor + '22; color:' + decisionColor + ';">' + escapeHtml(a.decision) + '</span></td>' +
        '<td style="font-size:12px;">' + escapeHtml(deciderName) + (a.decided_at ? '<br><span style="color:var(--text2);font-size:11px;">' + fmtDate(a.decided_at) + '</span>' : '') + '</td>' +
        '<td>';
      if (a.decision === 'pending') {
        html +=
          '<button class="btn" data-approve="' + escapeHtml(a.id) + '" style="background:#22c55e;color:white;border-color:#22c55e;">✓ Schválit</button> ' +
          '<button class="btn" data-reject="' + escapeHtml(a.id) + '" style="background:#ef4444;color:white;border-color:#ef4444;">✕ Zamítnout</button>';
      } else {
        html += '<button class="btn" data-detail-approval="' + escapeHtml(a.id) + '">Detail</button>';
      }
      html += '</td>' +
      '</tr>';
      // Payload preview pod řádkem
      if (a.payload && Object.keys(a.payload).length > 0) {
        html += '<tr><td colspan="8" style="font-family:ui-monospace,monospace;font-size:11px;color:var(--text2);background:rgba(0,0,0,0.2);padding:6px 12px;">' +
          'payload: ' + escapeHtml(JSON.stringify(a.payload).slice(0, 300)) +
          '</td></tr>';
      }
      if (a.comment) {
        html += '<tr><td colspan="8" style="font-size:12px;color:var(--text2);background:rgba(0,0,0,0.1);padding:6px 12px;">' +
          '💬 ' + escapeHtml(a.comment) +
          '</td></tr>';
      }
    }
    html += '</tbody></table>';
    $('#approvals-host').innerHTML = html;

    $$('[data-approve]').forEach((b) => {
      b.addEventListener('click', () => decideApproval(b.dataset.approve, 'approved'));
    });
    $$('[data-reject]').forEach((b) => {
      b.addEventListener('click', () => decideApproval(b.dataset.reject, 'rejected'));
    });
    $$('[data-detail-approval]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = _approvals.find((x) => x.id === b.dataset.detailApproval);
        if (a) alert(JSON.stringify(a, null, 2));
      });
    });
  }

  async function decideApproval(id, decision) {
    const a = _approvals.find((x) => x.id === id);
    if (!a) return;
    const verbCs = decision === 'approved' ? 'Schválit' : 'Zamítnout';
    if (!confirm(verbCs + ' approval ' + a.kind + ' pro úkol #' + (a.run && a.run.task ? a.run.task.id : '?') + '?')) return;
    const comment = prompt('Komentář (volitelně):') || '';
    try {
      await api('/approvals/' + id + '/decide', {
        method: 'POST',
        body: JSON.stringify({ decision, comment }),
      });
      loadApprovals();
    } catch (err) {
      alert('Rozhodnutí selhalo: ' + err.message);
    }
  }

  $('#approval-filter-decision').addEventListener('change', loadApprovals);

  // ─── Init ──────────────────────────────────────────────────────────────

  loadDashboard();
})();
