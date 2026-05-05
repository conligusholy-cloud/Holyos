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
