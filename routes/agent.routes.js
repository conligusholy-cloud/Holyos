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

// ─── Diagnostika prostředí workeru (git, node, env) ────────────────────────

router.get('/diag', async (req, res, next) => {
  try {
    const { execFile } = require('child_process');
    const probe = (cmd, args) => new Promise((resolve) => {
      try {
        execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
          resolve({
            ok: !err,
            stdout: (stdout || '').trim(),
            stderr: (stderr || '').trim(),
            err: err ? (err.code || err.message) : null,
          });
        });
      } catch (e) {
        resolve({ ok: false, err: e.code || e.message });
      }
    });
    const [git, node, which, path] = await Promise.all([
      probe('git', ['--version']),
      probe('node', ['--version']),
      probe('which', ['git']),
      probe('sh', ['-c', 'echo $PATH']),
    ]);
    res.json({
      git, node, which, path,
      env: {
        AGENT_WORKER_ENABLED: process.env.AGENT_WORKER_ENABLED || null,
        AI_DEV_GITHUB_TOKEN_present: !!process.env.AI_DEV_GITHUB_TOKEN,
        AI_DEV_GITHUB_TOKEN_len: (process.env.AI_DEV_GITHUB_TOKEN || '').length,
        ANTHROPIC_API_KEY_present: !!process.env.ANTHROPIC_API_KEY,
        AI_DEV_TMP_DIR: process.env.AI_DEV_TMP_DIR || '(default os.tmpdir)',
        NODE_VERSION: process.version,
      },
      platform: process.platform,
      cwd: process.cwd(),
    });
  } catch (err) { next(err); }
});

// ─── Queue ─────────────────────────────────────────────────────────────────

router.get('/queue', async (req, res, next) => {
  try {
    const items = await repo.listQueue({ limit: req.query.limit });
    res.json(items);
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
