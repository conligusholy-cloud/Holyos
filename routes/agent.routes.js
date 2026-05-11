// =============================================================================
// HolyOS — AI Vývojář (modul #13) routes
// =============================================================================
// Super-admin only. Endpointy pro Dashboard, repozitáře, settings/limity,
// audit log běhů a kill switch. Worker (services/ai-developer/worker.js) píše
// do DB přímo přes repository.js, není to volání nad těmito routy.

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const repo = require('../services/ai-developer/repository');
const { prisma } = require('../config/database');

// Všechny routy jen pro super admina
router.use(requireAuth);
router.use(requireSuperAdmin);

// ─── Schémata ──────────────────────────────────────────────────────────────

const SettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  default_autonomy: z.enum(['full_auto', 'pr_review', 'plan_review']).optional(),
  max_concurrent_runs: z.number().int().min(0).max(20).optional(),
  max_runs_per_day: z.number().int().min(0).max(1000).optional(),
  daily_token_budget: z.number().int().min(0).optional(),
  default_timeout_minutes: z.number().int().min(1).max(360).optional(),
  max_commits_per_run: z.number().int().min(1).max(100).optional(),
  auto_merge_wait_minutes: z.number().int().min(0).max(1440).optional(),
});

const RepoCreateSchema = z.object({
  name: z.string().min(1).max(100),
  git_url: z.string().min(5).max(500),
  default_branch: z.string().max(100).optional(),
  protected_branches: z.array(z.string()).optional(),
  allow_auto_merge: z.boolean().optional(),
  required_checks: z.array(z.string()).optional(),
  tech_stack: z.record(z.string(), z.any()).optional(),
  active: z.boolean().optional(),
});

const RepoPatchSchema = RepoCreateSchema.partial();

const KillSwitchSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
});

const RULE_KINDS = ['forbidden', 'requires_approval', 'allowed'];
const RULE_SCOPES = ['path_pattern', 'module', 'operation_type', 'db_table', 'repo'];

const RuleCreateSchema = z.object({
  kind: z.enum(RULE_KINDS),
  scope: z.enum(RULE_SCOPES),
  value: z.string().min(1).max(1000),
  description: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
});

const RulePatchSchema = RuleCreateSchema.partial();

// ─── Dashboard ─────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await repo.getDashboard();
    res.json(data);
  } catch (err) { next(err); }
});

// ─── Settings ──────────────────────────────────────────────────────────────

router.get('/settings', async (req, res, next) => {
  try {
    const s = await repo.getSettings();
    res.json(s);
  } catch (err) { next(err); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const patch = SettingsPatchSchema.parse(req.body);
    const updated = await repo.updateSettings(patch, req.user.id);
    // Audit
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'update',
        entity: 'agent_settings',
        entity_id: 1,
        description: 'AI Vývojář — update nastavení',
        changes: patch,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── Repos CRUD ────────────────────────────────────────────────────────────

router.get('/repos', async (req, res, next) => {
  try {
    const activeOnly = req.query.active === 'true';
    const items = await repo.listRepos({ activeOnly });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/repos/:id', async (req, res, next) => {
  try {
    const item = await repo.getRepo(req.params.id);
    if (!item) return res.status(404).json({ error: 'Repo nenalezen' });
    res.json(item);
  } catch (err) { next(err); }
});

router.post('/repos', async (req, res, next) => {
  try {
    const data = RepoCreateSchema.parse(req.body);
    const created = await repo.createRepo(data, req.user.id);
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'create',
        entity: 'agent_repo',
        description: `AI Vývojář — vytvořen repo '${created.name}'`,
        changes: data,
      },
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.put('/repos/:id', async (req, res, next) => {
  try {
    const patch = RepoPatchSchema.parse(req.body);
    const updated = await repo.updateRepo(req.params.id, patch);
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'update',
        entity: 'agent_repo',
        description: `AI Vývojář — update repo '${updated.name}'`,
        changes: patch,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/repos/:id', async (req, res, next) => {
  try {
    const target = await repo.getRepo(req.params.id);
    if (!target) return res.status(404).json({ error: 'Repo nenalezen' });
    await repo.deleteRepo(req.params.id);
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'delete',
        entity: 'agent_repo',
        description: `AI Vývojář — smazán repo '${target.name}'`,
      },
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ─── Runs (audit log) ──────────────────────────────────────────────────────

router.get('/runs', async (req, res, next) => {
  try {
    const { status, task_id, limit } = req.query;
    const items = await repo.listRuns({
      status: status || undefined,
      taskId: task_id ? parseInt(task_id, 10) : undefined,
      limit,
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/runs/:id', async (req, res, next) => {
  try {
    const run = await repo.getRunWithEvents(req.params.id);
    if (!run) return res.status(404).json({ error: 'Běh nenalezen' });
    res.json(run);
  } catch (err) { next(err); }
});

router.post('/runs/:id/cancel', async (req, res, next) => {
  try {
    const reason = (req.body && req.body.reason) || `Cancelled by ${req.user.username}`;
    const cancelled = await repo.cancelRun(req.params.id, reason);
    await repo.appendEvent(req.params.id, 'decision', {
      action: 'cancel',
      by: req.user.username,
      reason,
    });
    res.json(cancelled);
  } catch (err) { next(err); }
});

// ─── PR review (merge / close) ─────────────────────────────────────────────
//
// Tlačítka v Detail run modálu vyřeší PR bez chození na GitHub.
// Worker po otevření PR nastaví status=pr_open. Uživatel zkontroluje diff
// na GitHubu (link v Detail), vrátí se a klikne Mergnout/Zavřít.
// Backend volá GitHub API + updatuje agent_run.status + posune AdminTask.

const github = require('../services/ai-developer/github');

async function getRunWithRepo(runId) {
  const { prisma: db } = require('../config/database');
  return db.agentRun.findUnique({
    where: { id: runId },
    include: { repo: true, task: true },
  });
}

router.post('/runs/:id/merge', async (req, res, next) => {
  try {
    const run = await getRunWithRepo(req.params.id);
    if (!run) return res.status(404).json({ error: 'Běh nenalezen' });
    if (!run.pr_url || !run.pr_number) return res.status(400).json({ error: 'Běh nemá otevřený PR' });
    if (run.status !== 'pr_open') return res.status(400).json({ error: `PR nelze mergnout v stavu ${run.status}` });

    const ghRepo = github.parseRepo(run.repo.git_url);
    const token = process.env.AI_DEV_GITHUB_TOKEN;
    if (!token) return res.status(500).json({ error: 'AI_DEV_GITHUB_TOKEN chybí' });

    let mergeResult;
    try {
      mergeResult = await github.mergePullRequest({
        token, owner: ghRepo.owner, repo: ghRepo.repo, number: run.pr_number,
        mergeMethod: 'squash',
      });
    } catch (e) {
      return res.status(409).json({ error: 'GitHub merge selhal: ' + e.message });
    }

    await repo.updateRun(run.id, { status: 'merged', ended_at: new Date() });
    await repo.appendEvent(run.id, 'decision', { action: 'merged_via_ui', by: req.user.username, sha: mergeResult.sha });

    // Posun AdminTask na done
    if (run.task && run.task.status !== 'done') {
      await prisma.adminTask.update({ where: { id: run.task_id }, data: { status: 'done' } });
    }

    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'update',
        entity: 'agent_run',
        description: `AI Vývojář — PR #${run.pr_number} mergnut, úkol #${run.task_id} done`,
        changes: { run_id: run.id, sha: mergeResult.sha },
      },
    });
    res.json({ ok: true, sha: mergeResult.sha, run_status: 'merged' });
  } catch (err) { next(err); }
});

router.post('/runs/:id/close', async (req, res, next) => {
  try {
    const run = await getRunWithRepo(req.params.id);
    if (!run) return res.status(404).json({ error: 'Běh nenalezen' });
    if (!run.pr_url || !run.pr_number) return res.status(400).json({ error: 'Běh nemá otevřený PR' });
    if (run.status !== 'pr_open') return res.status(400).json({ error: `PR nelze zavřít v stavu ${run.status}` });

    const ghRepo = github.parseRepo(run.repo.git_url);
    const token = process.env.AI_DEV_GITHUB_TOKEN;
    if (!token) return res.status(500).json({ error: 'AI_DEV_GITHUB_TOKEN chybí' });

    try {
      await github.closePullRequest({
        token, owner: ghRepo.owner, repo: ghRepo.repo, number: run.pr_number,
      });
    } catch (e) {
      return res.status(409).json({ error: 'GitHub close selhal: ' + e.message });
    }

    await repo.updateRun(run.id, {
      status: 'cancelled',
      ended_at: new Date(),
      failure_reason: req.body && req.body.reason ? req.body.reason : `PR zavřen bez mergeru (${req.user.username})`,
    });
    await repo.appendEvent(run.id, 'decision', { action: 'closed_via_ui', by: req.user.username, reason: req.body && req.body.reason });

    res.json({ ok: true, run_status: 'cancelled' });
  } catch (err) { next(err); }
});

// ─── Queue ─────────────────────────────────────────────────────────────────

router.get('/queue', async (req, res, next) => {
  try {
    const items = await repo.listQueue({ limit: req.query.limit });
    res.json(items);
  } catch (err) { next(err); }
});

// ─── Rules (forbidden / requires_approval / allowed) ──────────────────────
//
// Fáze 2 feature: dynamická pravidla nahrazují hardcoded FORBIDDEN_PATTERNS
// v services/ai-developer/agent.js. Runner načítá aktivní pravidla per-run
// přes repository.listForbiddenPathRules() a předává do runAgent. Aktuálně
// se aplikuje jen kind='forbidden' + scope='path_pattern' (Fáze 1+2). Ostatní
// kind/scope hodnoty jsou ve schématu pro budoucí approval workflow.

router.get('/rules', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.kind) filter.kind = req.query.kind;
    if (req.query.scope) filter.scope = req.query.scope;
    if (req.query.active === 'true') filter.active = true;
    else if (req.query.active === 'false') filter.active = false;
    const items = await repo.listRules(filter);
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/rules/:id', async (req, res, next) => {
  try {
    const item = await repo.getRule(req.params.id);
    if (!item) return res.status(404).json({ error: 'Pravidlo nenalezeno' });
    res.json(item);
  } catch (err) { next(err); }
});

router.post('/rules', async (req, res, next) => {
  try {
    const data = RuleCreateSchema.parse(req.body);
    // Validuj že value je valid regex — pravidlo s špatným regex by jinak
    // crashlo buildForbiddenChecker (i když ten už chyby logujeme a vynecháme).
    if (data.scope === 'path_pattern') {
      try { new RegExp(data.value); }
      catch (e) { return res.status(400).json({ error: `Hodnota není validní regex: ${e.message}` }); }
    }
    const created = await repo.createRule({ ...data, createdBy: req.user.id });
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'create',
        entity: 'agent_rule',
        description: `AI Vývojář — vytvořeno pravidlo ${data.kind}/${data.scope} '${data.value.slice(0, 80)}'`,
        changes: data,
      },
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.put('/rules/:id', async (req, res, next) => {
  try {
    const patch = RulePatchSchema.parse(req.body);
    if (patch.scope === 'path_pattern' && patch.value) {
      try { new RegExp(patch.value); }
      catch (e) { return res.status(400).json({ error: `Hodnota není validní regex: ${e.message}` }); }
    }
    const target = await repo.getRule(req.params.id);
    if (!target) return res.status(404).json({ error: 'Pravidlo nenalezeno' });
    const updated = await repo.updateRule(req.params.id, patch);
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'update',
        entity: 'agent_rule',
        description: `AI Vývojář — update pravidla ${updated.kind}/${updated.scope}`,
        changes: patch,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/rules/:id', async (req, res, next) => {
  try {
    const target = await repo.getRule(req.params.id);
    if (!target) return res.status(404).json({ error: 'Pravidlo nenalezeno' });
    await repo.deleteRule(req.params.id);
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'delete',
        entity: 'agent_rule',
        description: `AI Vývojář — smazáno pravidlo ${target.kind}/${target.scope} '${target.value.slice(0, 80)}'`,
      },
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ─── Kill switch ───────────────────────────────────────────────────────────
//
// POST /api/agent/kill-switch  body { enabled: boolean, reason?: string }
// enabled = false  → master switch OFF, worker přestane brát nové úkoly
// enabled = true   → znovu zapne (efektivní podle AGENT_WORKER_ENABLED env)

router.post('/kill-switch', async (req, res, next) => {
  try {
    const { enabled, reason } = KillSwitchSchema.parse(req.body);
    const updated = await repo.updateSettings({ enabled }, req.user.id);
    await prisma.auditLog.create({
      data: {
        user_name: req.user.username,
        user_display: req.user.display_name || null,
        action: 'update',
        entity: 'agent_settings',
        entity_id: 1,
        description: `AI Vývojář — kill switch ${enabled ? 'ZAPNUT' : 'VYPNUT'}`,
        changes: { enabled, reason: reason || null },
      },
    });
    res.json({ ok: true, enabled: updated.enabled });
  } catch (err) { next(err); }
});

module.exports = router;
