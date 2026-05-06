// =============================================================================
// HolyOS — AI Vývojář / runner (orchestrace jednoho běhu)
// =============================================================================
// Jeden run nad jedním AdminTaskem:
//   1) vytvoř pracovní adresář v tmp
//   2) klonuj repo, vytvoř feature větev
//   3) spusť Claude agenta (services/ai-developer/agent.js)
//   4) zkontroluj forbidden cesty ve změnách
//   5) commit + push
//   6) otevři PR přes GitHub API
//   7) zaloguj events, pošli zprávu do chat threadu, vytvoř notifikaci

const path = require('path');
const os = require('os');
const fs = require('fs/promises');

const repository = require('./repository');
const chat = require('./chat');
const git = require('./git');
const github = require('./github');
const { runAgent, isForbidden } = require('./agent');

const TMP_ROOT = process.env.AI_DEV_TMP_DIR || path.join(os.tmpdir(), 'holyos-agent');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[áčďéěíňóřšťúůýž]/g, (c) => 'acdeeinorstuuyz'['áčďéěíňóřšťúůýž'.indexOf(c)] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    || 'task';
}

async function rmrf(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (_e) {
    // best effort
  }
}

/**
 * Hlavní entry — spustí kompletní běh nad daným úkolem.
 * @param {object} task — AdminTask záznam
 * @param {object} options — { aiUserId }
 */
async function processTask(task, options = {}) {
  const githubToken = process.env.AI_DEV_GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error('AI_DEV_GITHUB_TOKEN env chybí — nelze klonovat ani otevřít PR');
  }

  if (!task.target_repo_id) {
    throw new Error('Úkol nemá target_repo_id');
  }

  const repo = await repository.getRepo(task.target_repo_id);
  if (!repo || !repo.active) {
    throw new Error(`Repo ${task.target_repo_id} neexistuje nebo není aktivní`);
  }

  const ghRepo = github.parseRepo(repo.git_url);
  if (!ghRepo) {
    throw new Error(`Nelze rozpoznat owner/repo z git_url: ${repo.git_url}`);
  }

  // Vytvoř DB záznam běhu
  const settings = await repository.getSettings();
  const run = await repository.createRun({
    taskId: task.id,
    repoId: repo.id,
    autonomyMode: settings.default_autonomy,
  });

  const log = (kind, payload) => repository.appendEvent(run.id, kind, payload);

  // Pomocná funkce — uloží failure a commitne run jako failed
  async function fail(reason, extra = {}) {
    await log('error', { reason, ...extra });
    await repository.updateRun(run.id, {
      status: 'failed',
      ended_at: new Date(),
      failure_reason: reason,
    });
    try {
      await chat.postMessage(task.id, '', { template: 'failed', args: [reason] });
    } catch (e) {
      console.error('[ai-dev] chat.postMessage failed:', e.message);
    }
    return run;
  }

  // Akceptační kritéria jsou nutná
  if (!task.acceptance_criteria || task.acceptance_criteria.trim().length < 5) {
    return fail('Chybí akceptační kritéria — úkol není připravený pro AI Vývojáře');
  }

  // Setup pracovního adresáře
  const workdir = path.join(TMP_ROOT, run.id, 'repo');
  const branch = `ai/REQ-${task.id}-${slugify(task.page_title || '')}-${run.id.slice(0, 8)}`;

  try {
    await log('decision', { action: 'start', branch, workdir });

    await chat.postMessage(task.id, '', { template: 'accept' });

    // ── 1) Clone ───────────────────────────────────────────────────────
    await fs.mkdir(path.dirname(workdir), { recursive: true });
    await repository.updateRun(run.id, { status: 'triaging', branch });

    await log('decision', { action: 'clone', git_url: repo.git_url, default_branch: repo.default_branch });
    await git.clone({
      gitUrl: repo.git_url,
      branch: repo.default_branch || 'main',
      dir: workdir,
      token: githubToken,
      depth: 1,
    });

    await git.setIdentity({
      cwd: workdir,
      name: 'Alan, AI Vývojář',
      email: 'ai-vyvojar@holyos.local',
    });

    // ── 2) Větev ────────────────────────────────────────────────────────
    await git.checkoutNewBranch({ cwd: workdir, branch });

    // ── 3) Claude agent ────────────────────────────────────────────────
    await repository.updateRun(run.id, { status: 'coding' });

    const agentResult = await runAgent({
      workdir,
      task,
      repo,
      onEvent: async (kind, payload) => log(kind, payload),
    });

    await log('decision', {
      action: 'agent_done',
      summary: agentResult.summary,
      tokens_used: agentResult.tokensUsed,
      file_changes: agentResult.fileChanges,
    });

    // Ulož summary + tokens hned — kdyby commit/push/PR selhalo, summary
    // zůstane v DB pro Audit log (aby uživatel viděl, co agent navrhoval).
    await repository.updateRun(run.id, {
      summary: agentResult.summary,
      tokens_used: agentResult.tokensUsed,
    });

    // ── 4) Forbidden check ─────────────────────────────────────────────
    const status = await git.statusPorcelain({ cwd: workdir });
    if (status.length === 0) {
      return fail('Agent neudělal žádné změny — buď úkol nebyl proveditelný, nebo skončil příliš brzy.', {
        agent_summary: agentResult.summary,
      });
    }

    const violations = status.filter((s) => isForbidden(s.path));
    if (violations.length > 0) {
      await log('rule_blocked', { violations: violations.map((v) => v.path) });
      await repository.updateRun(run.id, {
        status: 'escalated',
        ended_at: new Date(),
        failure_reason: 'Změna sahala na zakázané cesty',
        tokens_used: agentResult.tokensUsed,
      });
      await chat.postMessage(task.id, '', {
        template: 'escalated',
        args: [`Agent se pokusil změnit zakázané cesty: ${violations.map((v) => v.path).join(', ')}`],
      });
      return run;
    }

    // ── 5) Commit + push ───────────────────────────────────────────────
    await git.addAll({ cwd: workdir });
    const commitMessage = `${task.page_title || `Úkol #${task.id}`}\n\n` +
      `${agentResult.summary}\n\n` +
      `AI Vývojář (HolyOS) — úkol #${task.id}`;
    await git.commit({ cwd: workdir, message: commitMessage });
    const sha = await git.getHeadSha({ cwd: workdir });
    await log('commit', { sha, message: commitMessage });

    await repository.updateRun(run.id, { status: 'pr_open', commits_count: 1 });

    await git.push({
      cwd: workdir,
      branch,
      gitUrl: repo.git_url,
      token: githubToken,
    });

    // ── 6) Otevři PR ───────────────────────────────────────────────────
    const prTitle = task.page_title || `Úkol #${task.id}`;
    const prBody = `${agentResult.summary}\n\n` +
      `---\n` +
      `**HolyOS úkol:** #${task.id}\n` +
      `**Akceptační kritéria:**\n${task.acceptance_criteria}\n\n` +
      `_Otevřeno automaticky AI Vývojářem (modul HolyOS). Veškeré změny ke schválení._`;

    const pr = await github.openPullRequest({
      token: githubToken,
      owner: ghRepo.owner,
      repo: ghRepo.repo,
      head: branch,
      base: repo.default_branch || 'main',
      title: prTitle,
      body: prBody,
    });

    await repository.updateRun(run.id, {
      status: 'pr_open',
      pr_url: pr.html_url,
      pr_number: pr.number,
      tokens_used: agentResult.tokensUsed,
      summary: agentResult.summary,
    });

    // ── 7) Chat + notifikace ───────────────────────────────────────────
    await chat.postMessage(task.id, '', { template: 'done', args: [pr.html_url] });
    await chat.notifyTaskCreator(task.id, {
      type: 'task_status',
      title: `AI Vývojář otevřel PR k úkolu #${task.id}`,
      body: `${prTitle}\n${pr.html_url}`,
      link: pr.html_url,
      meta: { pr_url: pr.html_url, pr_number: pr.number, run_id: run.id },
    });

    // Fáze 1: žádný auto-merge → běh končí v pr_open. UI Audit log si přebere
    // status z webhooku (Fáze 2) nebo manuálního refreshe.
    return run;
  } catch (err) {
    return fail(err.message || String(err), { stack: err.stack });
  } finally {
    // Sandbox cleanup — promaž tmp adresář, ať nezasviníme disk
    await rmrf(path.join(TMP_ROOT, run.id));
  }
}

module.exports = {
  processTask,
  TMP_ROOT,
  slugify,
};
