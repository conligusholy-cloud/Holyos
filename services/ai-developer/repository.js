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

  // Vyfiltruj ty, co mají běžící run NEBO čekající na merge (pr_open).
  // pr_open NENÍ v RUNNING_STATUSES (uvolňuje worker slot), ALE listQueue ho
  // bere v potaz — task s otevřeným PR nezvedáme znovu, dokud člověk
  // PR nemergne / nezamítne (a task ručně nezmění status). Bez tohoto by
  // worker úkol opakoval donekonečna a vyrobil hromadu duplicitních PR.
  const taskIds = candidates.map((t) => t.id);
  const blocking = await prisma.agentRun.findMany({
    where: {
      task_id: { in: taskIds },
      status: { in: [...RUNNING_STATUSES, 'pr_open'] },
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
  // queue + counters
  listQueue,
  listAutoMergeCandidates,
  countRunningRuns,
  todayRunsCount,
  todayTokensUsed,
  // dashboard
  getDashboard,
};
