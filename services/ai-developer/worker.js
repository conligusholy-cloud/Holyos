// =============================================================================
// HolyOS — AI Vývojář / worker (poller orchestrace)
// =============================================================================
// Běží uvnitř HolyOS procesu jako interval poller. Spouští se z app.js za
// env flagem AGENT_WORKER_ENABLED. Aktivní práce probíhá jen pokud současně
// agent_settings.enabled = true (kill switch).
//
// Postup:
//   - každých POLL_INTERVAL_MS přečte settings
//   - pokud enabled, načte queue (AdminTask čekající na AI)
//   - pro každý úkol spustí runner.processTask v pozadí
//   - respektuje max_concurrent_runs a max_runs_per_day

const repository = require('./repository');
const runner = require('./runner');
const github = require('./github');
const chat = require('./chat');
const { prisma } = require('../../config/database');

const POLL_INTERVAL_MS = parseInt(process.env.AI_DEV_POLL_INTERVAL_MS || '30000', 10);
let _timer = null;
let _stopping = false;
const _activeRuns = new Set();

async function pollOnce() {
  if (_stopping) return;

  let settings;
  try {
    settings = await repository.getSettings();
  } catch (err) {
    console.error('[ai-dev/worker] getSettings failed:', err.message);
    return;
  }

  if (!settings.enabled) return; // Kill switch OFF

  // Auto-merge nezávisí na queue capacity — pr_open run, který se mergne,
  // už neblokuje slot (pr_open je v TERMINAL_STATUSES). Spustíme paralelně,
  // ať se nezpožďuje kvůli capacity checkům dole.
  pollAutoMerge(settings).catch((e) =>
    console.error('[ai-dev/worker] pollAutoMerge failed:', e.message)
  );

  // Limit běžících
  let running;
  try {
    running = await repository.countRunningRuns();
  } catch (err) {
    console.error('[ai-dev/worker] countRunningRuns failed:', err.message);
    return;
  }
  const slotsAvailable = Math.max(0, settings.max_concurrent_runs - running);
  if (slotsAvailable <= 0) return;

  // Denní limit
  const todayCount = await repository.todayRunsCount();
  if (todayCount >= settings.max_runs_per_day) {
    return;
  }
  const dailySlotsLeft = Math.max(0, settings.max_runs_per_day - todayCount);

  // Token budget
  const tokensToday = await repository.todayTokensUsed();
  if (tokensToday >= settings.daily_token_budget) {
    console.warn(`[ai-dev/worker] daily_token_budget reached: ${tokensToday}/${settings.daily_token_budget}`);
    return;
  }

  const take = Math.min(slotsAvailable, dailySlotsLeft);
  if (take <= 0) return;

  let queue;
  try {
    queue = await repository.listQueue({ limit: take });
  } catch (err) {
    console.error('[ai-dev/worker] listQueue failed:', err.message);
    return;
  }
  if (!queue.length) return;

  for (const task of queue) {
    if (_activeRuns.size >= settings.max_concurrent_runs) break;

    // Mark task as in-flight v procesu (DB record vznikne v processTask)
    const guardKey = `task:${task.id}`;
    if (_activeRuns.has(guardKey)) continue;
    _activeRuns.add(guardKey);

    // Spusť asynchronně — nečekáme na výsledek, polling pokračuje
    runner.processTask(task)
      .catch((err) => {
        console.error(`[ai-dev/worker] processTask(#${task.id}) failed:`, err.message);
      })
      .finally(() => {
        _activeRuns.delete(guardKey);
      });
  }
}

// ─── Auto-merge ────────────────────────────────────────────────────────────
//
// Pro pr_open runs s repo.allow_auto_merge=true, kterým uplynula čekací doba,
// zavoláme GitHub API merge a updatneme DB. Volá se ze stejného pollu jako
// processTask, ale jen pokud je settings.enabled.

async function pollAutoMerge(settings) {
  const githubToken = process.env.AI_DEV_GITHUB_TOKEN;
  if (!githubToken) return;

  let candidates;
  try {
    candidates = await repository.listAutoMergeCandidates({
      waitMinutes: settings.auto_merge_wait_minutes || 15,
    });
  } catch (err) {
    console.error('[ai-dev/worker] listAutoMergeCandidates failed:', err.message);
    return;
  }
  if (!candidates.length) return;

  for (const run of candidates) {
    try {
      const ghRepo = github.parseRepo(run.repo.git_url);
      if (!ghRepo) continue;

      const result = await github.mergePullRequest({
        token: githubToken,
        owner: ghRepo.owner,
        repo: ghRepo.repo,
        number: run.pr_number,
        mergeMethod: 'squash',
      });

      await repository.updateRun(run.id, {
        status: 'merged',
        ended_at: new Date(),
      });
      await repository.appendEvent(run.id, 'decision', {
        action: 'auto_merged',
        sha: result.sha,
        wait_minutes: settings.auto_merge_wait_minutes,
      });

      if (run.task && run.task.status !== 'done') {
        await prisma.adminTask.update({ where: { id: run.task_id }, data: { status: 'done' } });
      }

      try {
        await chat.postMessage(run.task_id, '✅ Auto-merge proběhl. Úkol je hotový.', {});
      } catch (_e) {}

      console.log(`[ai-dev/worker] auto-merged run ${run.id} (PR #${run.pr_number}, sha ${result.sha})`);
    } catch (err) {
      console.error(`[ai-dev/worker] auto-merge failed for run ${run.id}:`, err.message);
      await repository.appendEvent(run.id, 'error', {
        phase: 'auto_merge',
        message: err.message,
      });
      // Nezamykáme run jako failed — člověk může mergnout ručně, jen log a jdeme dál
    }
  }
}

function start() {
  if (_timer) return; // Idempotentní
  if (process.env.AGENT_WORKER_ENABLED !== 'true') {
    console.log('[ai-dev/worker] AGENT_WORKER_ENABLED != true — worker neběží (master switch v env je vypnutý)');
    return;
  }

  console.log(`[ai-dev/worker] start — poll každých ${POLL_INTERVAL_MS}ms`);
  // První tick za 10 s (necháme zbytek HolyOSu doinicializovat)
  setTimeout(() => {
    pollOnce().catch((e) => console.error('[ai-dev/worker] tick failed:', e.message));
    _timer = setInterval(() => {
      pollOnce().catch((e) => console.error('[ai-dev/worker] tick failed:', e.message));
    }, POLL_INTERVAL_MS);
  }, 10_000);
}

async function stop() {
  _stopping = true;
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = { start, stop, pollOnce };
