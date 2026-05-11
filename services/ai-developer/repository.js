// =============================================================================
// HolyOS — AI Vývojář / repository (Prisma vrstva)
// =============================================================================
// Tenká vrstva nad Prisma pro modul AI Vývojář (Fáze 1 / MVP). Skupinuje
// dotazy nad agent_settings, agent_repos, agent_runs, agent_run_events.
// Routes a worker volají tyto funkce, neresolvují Prisma přímo.
//
// Viz docs/ai-vyvojar/plan-faze-1.md.

const { prisma } = require('../../config/database');

const AI_DEV_USERNAME = 'ai-vyvojar';

// ─── Servisní user ─────────────────────────────────────────────────────────

let _aiDevUserId = null;

async function getAiDeveloperUserId() {
  if (_aiDevUserId) return _aiDevUserId;
  const u = await prisma.user.findUnique({ where: { username: AI_DEV_USERNAME } });
  if (!u) {
    throw new Error(
      `Servisní user '${AI_DEV_USERNAME}' nenalezen. Spusť: node scripts/seed-ai-developer.js`
    );
  }
  _aiDevUserId = u.id;
  return u.id;
}

// ─── Settings (singleton id=1) ─────────────────────────────────────────────

async function getSettings() {
  let s = await prisma.agentSettings.findUnique({ where: { id: 1 } });
  if (!s) {
    // Self-heal — kdyby singleton chyběl (např. neproběhl seed)
    s = await prisma.agentSettings.create({
      data: {
        id: 1,
        enabled: false,
        default_autonomy: 'pr_review',
        max_concurrent_runs: 1,
        max_runs_per_day: 5,
        daily_token_budget: 1000000,
        default_timeout_minutes: 30,
        max_commits_per_run: 10,
        auto_merge_wait_minutes: 15,
      },
    });
  }
  return s;
}

async function updateSettings(patch, userId) {
  return prisma.agentSettings.update({
    where: { id: 1 },
    data: { ...patch, updated_by: userId },
  });
}

// ─── Repos ─────────────────────────────────────────────────────────────────

async function listRepos({ activeOnly = false } = {}) {
  return prisma.agentRepo.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: [{ active: 'desc' }, { created_at: 'desc' }],
    include: {
      creator: { select: { id: true, username: true, display_name: true } },
    },
  });
}

async function getRepo(id) {
  return prisma.agentRepo.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, username: true, display_name: true } },
    },
  });
}

async function createRepo(data, userId) {
  return prisma.agentRepo.create({
    data: {
      ...data,
      created_by: userId,
    },
  });
}

async function updateRepo(id, patch) {
  return prisma.agentRepo.update({ where: { id }, data: patch });
}

async function deleteRepo(id) {
  return prisma.agentRepo.delete({ where: { id } });
}

// ─── Runs ──────────────────────────────────────────────────────────────────

const RUN_LIST_INCLUDE = {
  task: {
    select: {
      id: true, status: true, priority: true, page_title: true,
      assignable_to_ai: true, acceptance_criteria: true,
    },
  },
  repo: { select: { id: true, name: true, git_url: true } },
};

// pr_open NENÍ running — agent skončil, PR čeká na review/merge u člověka.
// Pokud bychom ho měli jako running, blokovala by se fronta při max_concurrent_runs=1
// kvůli běhům, které už dávno dodělaly svou práci.
const RUNNING_STATUSES = [
  'queued', 'triaging', 'awaiting_clarification',
  'planning', 'awaiting_approval', 'coding', 'testing',
];

const TERMINAL_STATUSES = [
  'pr_open', 'merged', 'completed', 'failed', 'cancelled', 'escalated',
];

async function listRuns({ status, taskId, limit = 50 } = {}) {
  const where = {};
  if (status === 'running') {
    where.status = { in: RUNNING_STATUSES };
  } else if (status === 'terminal') {
    where.status = { in: TERMINAL_STATUSES };
  } else if (status) {
    where.status = status;
  }
  if (taskId) where.task_id = taskId;
  const runs = await prisma.agentRun.findMany({
    where,
    orderBy: { started_at: 'desc' },
    take: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200),
    include: RUN_LIST_INCLUDE,
  });

  // Spočítej file_change events per run (pro přehled v audit logu bez drilldownu)
  if (runs.length === 0) return runs;
  const counts = await prisma.agentRunEvent.groupBy({
    by: ['run_id'],
    where: { run_id: { in: runs.map((r) => r.id) }, kind: 'file_change' },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.run_id, c._count._all]));
  return runs.map((r) => ({ ...r, file_changes_count: countMap.get(r.id) || 0 }));
}

async function getRunWithEvents(id, { eventsLimit = 500 } = {}) {
  const run = await prisma.agentRun.findUnique({
    where: { id },
    include: RUN_LIST_INCLUDE,
  });
  if (!run) return null;
  const events = await prisma.agentRunEvent.findMany({
    where: { run_id: id },
    orderBy: { at: 'asc' },
    take: eventsLimit,
  });
  return { ...run, events };
}

async function createRun({ taskId, repoId, autonomyMode }) {
  return prisma.agentRun.create({
    data: {
      task_id: taskId,
      repo_id: repoId || null,
      autonomy_mode: autonomyMode || 'pr_review',
      status: 'queued',
    },
  });
}

async function updateRun(id, patch) {
  return prisma.agentRun.update({ where: { id }, data: patch });
}

async function cancelRun(id, reason) {
  return prisma.agentRun.update({
    where: { id },
    data: {
      status: 'cancelled',
      ended_at: new Date(),
      failure_reason: reason || 'Cancelled by operator',
    },
  });
}

async function appendEvent(runId, kind, payload) {
  return prisma.agentRunEvent.create({
    data: { run_id: runId, kind, payload: payload || null },
  });
}

// Vrátí run, který blokuje další "změny zadání" pro daný úkol — tj. je
// v RUNNING_STATUSES nebo `pr_open` (PR čeká na review/merge u člověka).
// Používá se v admin-tasks PUT pro odmítnutí reassignu target_repa, dokud
// aktivní run nedoběhne / není cancelnut. Vrací null, pokud nic neblokuje.
async function getBlockingRunForTask(taskId) {
  return prisma.agentRun.findFirst({
    where: {
      task_id: taskId,
      status: { in: [...RUNNING_STATUSES, 'pr_open'] },
    },
    orderBy: { started_at: 'desc' },
    include: { repo: { select: { id: true, name: true } } },
  });
}

// ─── AgentRule CRUD + helpers ───────────────────────────────────────────────

// Vrátí aktivní forbidden path-pattern pravidla. Načítá runner per-run při
// startu (rules se mění zřídka, žádný hot-reload uvnitř běhu).
async function listForbiddenPathRules() {
  return prisma.agentRule.findMany({
    where: { kind: 'forbidden', scope: 'path_pattern', active: true },
    orderBy: { created_at: 'asc' },
  });
}

async function listRules({ kind, scope, active } = {}) {
  const where = {};
  if (kind) where.kind = kind;
  if (scope) where.scope = scope;
  if (active !== undefined) where.active = active;
  return prisma.agentRule.findMany({
    where,
    orderBy: [{ kind: 'asc' }, { scope: 'asc' }, { created_at: 'asc' }],
    include: { creator: { select: { id: true, username: true, display_name: true } } },
  });
}

async function getRule(id) {
  return prisma.agentRule.findUnique({
    where: { id },
    include: { creator: { select: { id: true, username: true, display_name: true } } },
  });
}

async function createRule({ kind, scope, value, description, active, createdBy }) {
  return prisma.agentRule.create({
    data: {
      kind,
      scope,
      value,
      description: description || null,
      active: active !== false,
      created_by: createdBy || null,
    },
  });
}

async function updateRule(id, patch) {
  return prisma.agentRule.update({ where: { id }, data: patch });
}

async function deleteRule(id) {
  return prisma.agentRule.delete({ where: { id } });
}

// Fire-and-forget increment blocked_count po rule_blocked eventu. Nečekáme
// na výsledek — statistika nesmí blokovat critical path agenta.
function incrementRuleBlockedCount(ruleId) {
  prisma.agentRule
    .update({ where: { id: ruleId }, data: { blocked_count: { increment: 1 } } })
    .catch((e) => console.error('[ai-dev] incrementRuleBlockedCount:', e.message));
}

// ─── AgentApproval CRUD + decision ──────────────────────────────────────────

async function listApprovals({ decision, runId, limit = 50 } = {}) {
  const where = {};
  if (decision) where.decision = decision;
  if (runId) where.run_id = runId;
  return prisma.agentApproval.findMany({
    where,
    orderBy: [{ decision: 'asc' }, { requested_at: 'desc' }],
    take: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200),
    include: {
      run: {
        select: {
          id: true, task_id: true, status: true, branch: true,
          task: { select: { id: true, page_title: true } },
          repo: { select: { id: true, name: true } },
        },
      },
      decider: { select: { id: true, username: true, display_name: true } },
    },
  });
}

async function getApproval(id) {
  return prisma.agentApproval.findUnique({
    where: { id },
    include: {
      run: {
        select: {
          id: true, task_id: true, status: true, branch: true, pr_url: true,
          task: { select: { id: true, page_title: true, acceptance_criteria: true } },
          repo: { select: { id: true, name: true, git_url: true } },
        },
      },
      decider: { select: { id: true, username: true, display_name: true } },
    },
  });
}

async function createApproval({ runId, kind, payload }) {
  return prisma.agentApproval.create({
    data: {
      run_id: runId,
      kind,
      payload: payload || null,
      // decision default 'pending' z DB
    },
  });
}

// Schválit / zamítnout. decision musí být 'approved' nebo 'rejected'.
// decidedBy = userId (super-admin), comment je volitelný.
async function decideApproval(id, { decision, decidedBy, comment }) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error(`decideApproval: neplatný decision '${decision}' (smí jen approved|rejected)`);
  }
  return prisma.agentApproval.update({
    where: { id },
    data: {
      decision,
      decided_by: decidedBy,
      decided_at: new Date(),
      comment: comment || null,
    },
  });
}
// Najde runy v awaiting_approval, které mají rozhodnutý approval (approved
// nebo rejected). Worker pollApprovals to zvedne a buď spustí resume (approved)
// nebo eskaluje (rejected). Vrátí pole {run, approval} (latest approval per run).
async function listApprovalsToProcess() {
  // Najdi všechny awaiting_approval runy s alespoň jedním rozhodnutým approval
  const runs = await prisma.agentRun.findMany({
    where: {
      status: 'awaiting_approval',
      approvals: {
        some: {
          decision: { in: ['approved', 'rejected'] },
          decided_at: { not: null },
        },
      },
    },
    include: {
      task: { select: { id: true, page_title: true, description: true, acceptance_criteria: true, created_by: true } },
      repo: true,
      approvals: {
        where: { decision: { in: ['approved', 'rejected'] } },
        orderBy: { decided_at: 'desc' },
        take: 1,
      },
    },
  });

  // Mapuj na {run, approval}
  return runs
    .filter((r) => r.approvals && r.approvals.length > 0)
    .map((r) => ({ run: r, approval: r.approvals[0] }));
}




// ─── Queue (úkoly připravené pro AI Vývojáře) ──────────────────────────────
//
// Pravidla pro Fázi 1:
//   - AdminTask.assignable_to_ai = true
//   - AdminTask.deleted_at IS NULL
//   - status = 'new' nebo 'in_progress' (ale nikdy 'done' / 'cancelled')
//   - acceptance_criteria je vyplněné (jinak nic neumíme řešit)
//   - žádný aktivní AgentRun (running) pro tento úkol
//   - target_repo_id je vyplněný (jinak nevíme, kam pushnout)

async function listQueue({ limit = 10 } = {}) {
  const candidates = await prisma.adminTask.findMany({
    where: {
      assignable_to_ai: true,
      deleted_at: null,
      target_repo_id: { not: null },
      acceptance_criteria: { not: null },
      status: { in: ['new', 'in_progress'] },
    },
    orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
    take: Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50),
  });

  if (candidates.length === 0) return [];

  // Vyfiltruj ty, co mají běžící run, čekající PR, nebo nedávno failed run.
  // - RUNNING_STATUSES: agent právě pracuje
  // - pr_open: čeká na review člověka
  // - failed/escalated mladší než FAILED_BACKOFF_MINUTES: nedávno spadl,
  //   nezvedat 30 min, ať Tomáš stihne změnit target_repo / AC. Bez toho
  //   by se cyklus opakoval každých 30 s a pálil tokeny (viz incident
  //   2026-05-06: úkol #42 spálil 360 000 tokenů ve 39 retry pokusech).
  const FAILED_BACKOFF_MINUTES = 30;
  const backoffCutoff = new Date(Date.now() - FAILED_BACKOFF_MINUTES * 60_000);

  const taskIds = candidates.map((t) => t.id);
  const blocking = await prisma.agentRun.findMany({
    where: {
      task_id: { in: taskIds },
      OR: [
        { status: { in: [...RUNNING_STATUSES, 'pr_open'] } },
        {
          status: { in: ['failed', 'escalated'] },
          updated_at: { gte: backoffCutoff },
        },
      ],
    },
    select: { task_id: true },
  });
  const busyTaskIds = new Set(blocking.map((r) => r.task_id));

  return candidates.filter((t) => !busyTaskIds.has(t.id));
}

// ─── Auto-merge kandidáti ──────────────────────────────────────────────────
//
// Worker periodicky volá listAutoMergeCandidates(). Vrací pr_open runs, kde:
//   - repo.allow_auto_merge = true
//   - uplynulo auto_merge_wait_minutes od pr_open updatu
//   - run.repo a run.task existují
// Worker pak pro každý zavolá GitHub API merge a updatuje DB.

async function listAutoMergeCandidates({ waitMinutes }) {
  const cutoff = new Date(Date.now() - waitMinutes * 60_000);
  return prisma.agentRun.findMany({
    where: {
      status: 'pr_open',
      pr_url: { not: null },
      pr_number: { not: null },
      // updated_at se mění při přechodu na pr_open (commits_count=1, pr_url, ...)
      updated_at: { lte: cutoff },
      repo: { allow_auto_merge: true },
    },
    include: { repo: true, task: true },
    orderBy: { updated_at: 'asc' },
    take: 5,
  });
}

// ─── Counters pro limity ───────────────────────────────────────────────────

async function countRunningRuns() {
  return prisma.agentRun.count({
    where: { status: { in: RUNNING_STATUSES } },
  });
}

async function todayRunsCount() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.agentRun.count({ where: { started_at: { gte: start } } });
}

async function todayTokensUsed() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const agg = await prisma.agentRun.aggregate({
    where: { started_at: { gte: start } },
    _sum: { tokens_used: true },
  });
  return agg._sum.tokens_used || 0;
}

// ─── Dashboard agregát ─────────────────────────────────────────────────────

async function getDashboard() {
  const [settings, running, queue, runsToday, tokensToday, recent] = await Promise.all([
    getSettings(),
    countRunningRuns(),
    listQueue({ limit: 10 }),
    todayRunsCount(),
    todayTokensUsed(),
    listRuns({ limit: 20 }),
  ]);

  return {
    settings,
    counters: {
      running,
      queued: queue.length,
      runs_today: runsToday,
      tokens_today: tokensToday,
    },
    queue,
    recent_runs: recent,
  };
}


// ─── Metriky úspěšnosti (dashboard widget) ────────────────────────────────
//
// Agreguje za posledních N dní (default 30). Pomocí dvou Prisma groupBy
// a malého post-processingu — žádné raw SQL, žádný DB cache.
async function getMetrics({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Status counts
  const statusGroups = await prisma.agentRun.groupBy({
    by: ['status'],
    where: { started_at: { gte: since } },
    _count: { _all: true },
  });
  const statusMap = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));

  const merged = statusMap.merged || 0;
  const completed = statusMap.completed || 0;
  const failed = statusMap.failed || 0;
  const escalated = statusMap.escalated || 0;
  const cancelled = statusMap.cancelled || 0;
  const pr_open = statusMap.pr_open || 0;
  const awaiting = (statusMap.awaiting_approval || 0) + (statusMap.awaiting_clarification || 0);

  const total = statusGroups.reduce((s, g) => s + g._count._all, 0);

  // Decided runs = nepočítáme cancelled (uživatel zrušil ručně) ani in-progress.
  const decided = merged + completed + failed + escalated;
  const success = merged + completed;
  const mergeRate = decided > 0 ? success / decided : null;

  // Retry rate: kolik unique tasků mělo >1 run za období.
  const taskRunCounts = await prisma.agentRun.groupBy({
    by: ['task_id'],
    where: { started_at: { gte: since } },
    _count: { _all: true },
  });
  const uniqueTasks = taskRunCounts.length;
  const tasksWithRetry = taskRunCounts.filter((t) => t._count._all > 1).length;
  const retryRate = uniqueTasks > 0 ? tasksWithRetry / uniqueTasks : null;

  // Tokens a duration (jen runs s ended_at, ne in-progress)
  const finishedRuns = await prisma.agentRun.findMany({
    where: { started_at: { gte: since }, ended_at: { not: null } },
    select: { tokens_used: true, started_at: true, ended_at: true },
  });
  const totalTokens = finishedRuns.reduce((s, r) => s + (r.tokens_used || 0), 0);
  const avgTokens = finishedRuns.length > 0 ? Math.round(totalTokens / finishedRuns.length) : 0;
  const durations = finishedRuns
    .map((r) => (r.ended_at && r.started_at) ? (r.ended_at.getTime() - r.started_at.getTime()) / 1000 : null)
    .filter((d) => d !== null && d >= 0);
  const avgDurationSec = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : 0;

  // Plan approvals: kolik plan_review approvalů approved vs rejected
  const approvalGroups = await prisma.agentApproval.groupBy({
    by: ['decision'],
    where: { kind: 'plan_review', requested_at: { gte: since } },
    _count: { _all: true },
  });
  const approvalMap = Object.fromEntries(approvalGroups.map((g) => [g.decision, g._count._all]));
  const planApproved = approvalMap.approved || 0;
  const planRejected = approvalMap.rejected || 0;
  const planPending = approvalMap.pending || 0;
  const planDecided = planApproved + planRejected;
  const planApprovalRate = planDecided > 0 ? planApproved / planDecided : null;

  return {
    period_days: days,
    since: since.toISOString(),
    total_runs: total,
    by_status: {
      merged, completed, failed, escalated, cancelled, pr_open, awaiting,
    },
    merge_rate: mergeRate,
    retry: {
      unique_tasks: uniqueTasks,
      tasks_with_retry: tasksWithRetry,
      retry_rate: retryRate,
    },
    tokens: {
      total: totalTokens,
      avg_per_run: avgTokens,
      finished_runs: finishedRuns.length,
    },
    avg_duration_seconds: avgDurationSec,
    plan_approvals: {
      approved: planApproved,
      rejected: planRejected,
      pending: planPending,
      approval_rate: planApprovalRate,
    },
  };
}


// ─── Learning from history (Fáze 4) ────────────────────────────────────────

// Vrátí past N runs se status failed/escalated/cancelled, ideálně pro stejný
// affected_module. Plus rejected plan approvals. Triage + planner to dostane
// jako kontext, aby se učili z minulých chyb.
async function getPastFailures({ affectedModule, limit = 5 } = {}) {
  // 1) Failed/escalated runs (preferenčně pro stejný module, jinak global)
  const where = { status: { in: ['failed', 'escalated', 'cancelled'] } };
  if (affectedModule) {
    where.task = { affected_module: affectedModule };
  }
  const runs = await prisma.agentRun.findMany({
    where,
    orderBy: { ended_at: 'desc' },
    take: Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20),
    select: {
      id: true,
      status: true,
      failure_reason: true,
      summary: true,
      ended_at: true,
      task: {
        select: { id: true, page_title: true, affected_module: true, change_type: true },
      },
    },
  });

  // 2) Rejected plan approvals (klíčové insight — kde Tomáš odmítl plán)
  const rejectedApprovals = await prisma.agentApproval.findMany({
    where: {
      decision: 'rejected',
      kind: 'plan_review',
      ...(affectedModule
        ? { run: { task: { affected_module: affectedModule } } }
        : {}),
    },
    orderBy: { decided_at: 'desc' },
    take: Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20),
    select: {
      id: true,
      comment: true,
      decided_at: true,
      payload: true,
      run: {
        select: {
          id: true,
          task: { select: { id: true, page_title: true, affected_module: true } },
        },
      },
    },
  });

  return { failedRuns: runs, rejectedApprovals };
}

module.exports = {
  AI_DEV_USERNAME,
  RUNNING_STATUSES,
  TERMINAL_STATUSES,
  getAiDeveloperUserId,
  // settings
  getSettings,
  updateSettings,
  // repos
  listRepos,
  getRepo,
  createRepo,
  updateRepo,
  deleteRepo,
  // runs
  listRuns,
  getRunWithEvents,
  createRun,
  updateRun,
  cancelRun,
  appendEvent,
  getBlockingRunForTask,
  // rules
  listForbiddenPathRules,
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  incrementRuleBlockedCount,
  // approvals
  listApprovals,
  getApproval,
  createApproval,
  decideApproval,
  listApprovalsToProcess,
  // queue + counters
  listQueue,
  listAutoMergeCandidates,
  countRunningRuns,
  todayRunsCount,
  todayTokensUsed,
  // dashboard + metrics
  getDashboard,
  getMetrics,
  // learning from history
  getPastFailures,
};
