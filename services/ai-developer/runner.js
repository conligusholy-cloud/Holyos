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

const { prisma } = require('../../config/database');
const repository = require('./repository');
const chat = require('./chat');
const git = require('./git');
const github = require('./github');
const { runAgent, buildForbiddenChecker } = require('./agent');
const triageModule = require('./triage');
const plannerModule = require('./planner');

const TMP_ROOT = process.env.AI_DEV_TMP_DIR || path.join(os.tmpdir(), 'holyos-agent');

function shortenForBody(text, maxLen) {
  if (!text) return '';
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen - 1) + '…';
}

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

  // Wrapper kolem appendEvent — pro 'rule_blocked' kind ještě navíc
  // inkrementuje AgentRule.blocked_count statistiku (fire-and-forget,
  // nečekáme na výsledek). Hardcoded fallback pravidla (id='hardcoded:*')
  // se neinkrementují — nejsou v DB.
  const log = (kind, payload) => {
    if (
      kind === 'rule_blocked' &&
      payload && payload.rule_id &&
      !String(payload.rule_id).startsWith('hardcoded:')
    ) {
      repository.incrementRuleBlockedCount(payload.rule_id);
    }
    return repository.appendEvent(run.id, kind, payload);
  };

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

  // Tokens spotřebované triage + planner callem — sčítáme s coding loop tokeny
  // při updateRun. Když je triage/planner vypnutý nebo selže, zůstanou 0.
  let triageTokens = 0;
  let plannerTokens = 0;

  try {
    await log('decision', { action: 'start', branch, workdir });

    await chat.postMessage(task.id, '', { template: 'accept' });

    // ── 0) Triage (preflight Claude haiku call PŘED clone) ─────────────
    //
    // Cíl: nepálit tokeny na úkolech se špatným target_repo nebo neúplnými AC.
    // Triage neklonuje repo, jen vyhodnotí task + repo metadata. Možné výsledky:
    //   - ok                  → pokračuj na clone + coding loop (běžný flow)
    //   - needs_clarification → otázky do task chatu, status awaiting_clarification, run končí
    //   - stop                → eskalace, status escalated, run končí
    //
    // Vypínač: env AI_DEV_TRIAGE_ENABLED=false (default true). Při triage chybě
    // (síť, parser, …) triage modul fallbacks na verdict='ok', ať coding loop
    // dostane šanci — stávající "no-changes" safety net to zachytí níže.
    const triageEnabled = process.env.AI_DEV_TRIAGE_ENABLED !== 'false';
    if (triageEnabled) {
      await repository.updateRun(run.id, { status: 'triaging' });
      let triage;
      try {
        triage = await triageModule.runTriage({ task, repo });
        triageTokens = triage.tokensUsed || 0;
        await log('decision', {
          action: 'triage_done',
          verdict: triage.verdict,
          reason: triage.reason,
          questions_count: triage.questions.length,
          tokens_used: triageTokens,
        });
      } catch (e) {
        // Hard fail (např. ANTHROPIC_API_KEY chybí). Logujeme a fallback na ok.
        await log('error', { phase: 'triage', message: e.message });
        triage = { verdict: 'ok', reason: 'Triage hard fail → fallback ok', questions: [] };
      }

      if (triage.verdict === 'needs_clarification') {
        const qs = (triage.questions || []).filter(Boolean);
        const qsList = qs.length
          ? qs.map((q, i) => `${i + 1}. ${q}`).join('\n')
          : '_(triage neuvedl konkrétní otázky)_';
        const msg =
          `Než se pustím do úkolu, potřebuju upřesnit:\n\n` +
          `${qsList}\n\n` +
          `**Důvod:** ${triage.reason}\n\n` +
          `_Doplň prosím odpovědi v Požadavcích → akceptační kritéria. Po doplnění úkol znovu zvednu sám (do 30 min, viz failed backoff)._`;
        try { await chat.postMessage(task.id, msg); }
        catch (e) { console.error('[ai-dev] triage chat (clarification):', e.message); }
        try {
          await chat.notifyTaskCreator(task.id, {
            type: 'task_status',
            title: `🤔 AI Vývojář se ptá k úkolu #${task.id}`,
            body: shortenForBody(qs[0] || triage.reason, 200),
            link: `/modules/admin-tasks/?task=${task.id}`,
            meta: { run_id: run.id, kind: 'awaiting_clarification' },
          });
        } catch (_e) {}
        await repository.updateRun(run.id, {
          status: 'awaiting_clarification',
          ended_at: new Date(),
          tokens_used: triageTokens,
          summary: triage.reason,
        });
        return run;
      }

      if (triage.verdict === 'stop') {
        const msg =
          `**Tento úkol nemůžu zpracovat** — eskaluji na člověka.\n\n` +
          `**Důvod:** ${triage.reason}\n\n` +
          `_Změň prosím target_repo nebo akceptační kritéria a zkus znovu._`;
        try { await chat.postMessage(task.id, msg); }
        catch (e) { console.error('[ai-dev] triage chat (stop):', e.message); }
        try {
          await chat.notifySuperAdmins({
            type: 'task_status',
            title: `🛑 AI Vývojář eskaloval úkol #${task.id} (triage)`,
            body: shortenForBody(triage.reason, 200),
            link: '/modules/ai-vyvojar/',
            meta: { run_id: run.id, task_id: task.id, kind: 'triage_stop' },
          });
        } catch (_e) {}
        await repository.updateRun(run.id, {
          status: 'escalated',
          ended_at: new Date(),
          tokens_used: triageTokens,
          failure_reason: triage.reason,
          summary: triage.reason,
        });
        return run;
      }

      // verdict === 'ok' → pokračuj na clone + coding
    }

    // ── 1) Clone ───────────────────────────────────────────────────────
    await fs.mkdir(path.dirname(workdir), { recursive: true });
    // Branch nastavujeme až teď (status už je 'triaging' z triage fáze).
    await repository.updateRun(run.id, { branch });

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

    // Načti aktivní forbidden+path_pattern pravidla pro tento run (per-run
    // cache — rules se mění zřídka, žádný hot-reload uvnitř běhu). Předáme
    // je do plannerů, runAgentu i § 4 post-commit checku. Při chybě DB
    // čtení agent.js fallbackuje na HARDCODED_FORBIDDEN_FALLBACK.
    let forbiddenRules = [];
    try {
      forbiddenRules = await repository.listForbiddenPathRules();
    } catch (e) {
      console.error('[ai-dev] listForbiddenPathRules selhalo → hardcoded fallback:', e.message);
    }
    const forbiddenCheck = buildForbiddenChecker(forbiddenRules);

    // ── 2.5) Planning (preflight Claude Sonnet call PO clone, PŘED coding) ───
    //
    // Cíl: agent vrátí strukturovaný plán (které soubory změní, jaké riziko).
    // Plán prochází AgentApproval(kind='plan_review') pokud:
    //   - planner sám označil plán jako requires_approval=true (high risk / DB / auth)
    //   - NEBO settings.default_autonomy === 'plan_review'
    // Pokud autonomy='full_auto' a planner risk je low/medium, jdeme rovnou na coding.
    //
    // Vypínač: env AI_DEV_PLANNER_ENABLED=false. Při chybě fallback na bez-plánu
    // coding (forbidden check + no-changes safety net stejně chrání).
    const plannerEnabled = process.env.AI_DEV_PLANNER_ENABLED !== 'false';
    let plan = null;
    if (plannerEnabled) {
      await repository.updateRun(run.id, { status: 'planning' });
      try {
        const result = await plannerModule.runPlanner({
          workdir,
          task,
          repo,
          forbiddenCheck,
          onEvent: async (kind, payload) => log(kind, payload),
        });
        plan = result.plan;
        plannerTokens = result.tokensUsed || 0;
        await log('decision', {
          action: 'planning_done',
          summary: (plan && plan.summary) || result.reason,
          risk_level: plan && plan.risk_level,
          files_to_change_count: plan && plan.files_to_change ? plan.files_to_change.length : 0,
          requires_approval: plan && plan.requires_approval,
          tokens_used: plannerTokens,
        });
      } catch (e) {
        await log('error', { phase: 'planning', message: e.message });
        // fallback — pokračujeme na coding bez plánu (warning logged)
      }

      // Rozhodnutí: vyžaduje approval?
      const autonomy = settings.default_autonomy; // 'full_auto' | 'pr_review' | 'plan_review'
      const needsApproval = plan && (plan.requires_approval === true || autonomy === 'plan_review') && autonomy !== 'full_auto';

      if (needsApproval) {
        try {
          await repository.createApproval({
            runId: run.id,
            kind: 'plan_review',
            payload: plan,
          });
        } catch (e) {
          console.error('[ai-dev] createApproval selhalo:', e.message);
        }
        await log('decision', {
          action: 'approval_requested',
          kind: 'plan_review',
          reason: plan.requires_approval ? 'planner označil plán jako requires_approval=true' : `autonomy=${autonomy}`,
        });
        const planSummary = plan.summary || 'Plán k schválení';
        const riskBadge = plan.risk_level ? ` (risk: ${plan.risk_level})` : '';
        try {
          await chat.postMessage(task.id, `📋 **Plán k schválení**${riskBadge}\n\n${planSummary}\n\nDetaily v modulu AI Vývojář → záložka Schválení.`);
        } catch (e) { console.error('[ai-dev] chat plan_review:', e.message); }
        try {
          await chat.notifySuperAdmins({
            type: 'task_status',
            title: `📋 Plán čeká na schválení — úkol #${task.id}`,
            body: shortenForBody(planSummary + riskBadge, 200),
            link: '/modules/ai-vyvojar/',
            meta: { run_id: run.id, task_id: task.id, kind: 'plan_review' },
          });
        } catch (_e) {}
        await repository.updateRun(run.id, {
          status: 'awaiting_approval',
          ended_at: new Date(),
          tokens_used: triageTokens + plannerTokens,
          summary: planSummary,
        });
        return run;
      }
      // Plán schválen automaticky (full_auto + low/medium risk) nebo planner failed → coding
    }

    // ── 3) Claude agent ────────────────────────────────────────────────
    await repository.updateRun(run.id, { status: 'coding' });

    const agentResult = await runAgent({
      workdir,
      task,
      repo,
      rules: forbiddenRules,
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
      tokens_used: triageTokens + plannerTokens + agentResult.tokensUsed,
    });

    // ── 4) Forbidden check ─────────────────────────────────────────────
    const status = await git.statusPorcelain({ cwd: workdir });
    if (status.length === 0) {
      // Agent rozpoznal, že úkol není v tomto repu proveditelný (typicky:
      // úkol pro HolyOS modul, target_repo ale playground sandbox).
      // Pošleme do chat threadu úkolu detailní zprávu od Alana s vysvětlením,
      // aby Tomáš věděl PROČ a co s tím. Task zůstane assignable_to_ai=true,
      // ale listQueue ho po dobu backoff_minutes z fronty vyřadí (viz
      // repository.listQueue) — bez toho by worker úkol bral každých 30 s.
      const reason = agentResult.summary || 'Agent rozpoznal, že požadovaná změna není v cílovém repu proveditelná.';
      const helpMsg =
        `Nemohl jsem dokončit úkol v cílovém repu \`${repo.name}\`.\n\n` +
        `**Důvod (z mého pohledu):**\n${reason}\n\n` +
        `**Co s tím můžeš udělat:**\n` +
        `1. **Změnit target_repo** — pokud je úkol o jiném repu (např. HolyOS samotný, ne sandbox), přidej ten repo v Super Admin → AI Vývojář → Repozitáře a edituj úkol.\n` +
        `2. **Upřesnit akceptační kritéria** — pokud chceš úkol pojmout jako sandbox-friendly variantu (např. ukázku/prototyp), přepiš AC tak, aby šel udělat v aktuálním repu.\n` +
        `3. **Odznačit z AI fronty** — v Požadavcích zruš checkbox "Předat AI Vývojáři", úkol vyřeš ručně.\n\n` +
        `_Zatím úkol nebudu brát dalších 30 minut, ať zbytečně nespálíme tokeny. Až změníš nastavení, vrátím se k němu._`;
      try {
        await chat.postMessage(task.id, helpMsg);
      } catch (e) { console.error('[ai-dev] chat.postMessage no-changes failed:', e.message); }
      try {
        await chat.notifySuperAdmins({
          type: 'task_status',
          title: `⚠️ Úkol #${task.id} — agent nemohl pokračovat`,
          body: shortenForBody(reason, 200),
          link: `/modules/admin-tasks/index.html?task=${task.id}`,
          meta: { run_id: run.id, task_id: task.id, kind: 'no_changes' },
        });
      } catch (_e) {}
      return fail('Agent neudělal žádné změny — viz zpráva v chat threadu úkolu.', {
        agent_summary: agentResult.summary,
      });
    }

    // Post-commit forbidden check: použij stejný checker jako agent (DB pravidla).
    // Pokud Claude obešel tool-level forbidden přes nějaký kreativní filename trik
    // (např. relative path s `..` který by safeJoin propustil), zachytí ho tahle
    // poslední pojistka před commitem. Každá violation se zaloguje samostatně
    // s rule_id (inkrementuje blocked_count), pak agreguje do escalation reason.
    const violations = [];
    for (const s of status) {
      const hit = forbiddenCheck(s.path);
      if (hit) {
        violations.push({ path: s.path, rule_id: hit.rule_id, pattern: hit.value });
        await log('rule_blocked', {
          rule_id: hit.rule_id,
          pattern: hit.value,
          path: s.path,
          source: 'post_commit_check',
        });
      }
    }
    if (violations.length > 0) {
      await repository.updateRun(run.id, {
        status: 'escalated',
        ended_at: new Date(),
        failure_reason: 'Změna sahala na zakázané cesty',
        tokens_used: triageTokens + plannerTokens + agentResult.tokensUsed,
      });
      await chat.postMessage(task.id, '', {
        template: 'escalated',
        args: [`Agent se pokusil změnit zakázané cesty: ${violations.map((v) => v.path).join(', ')}`],
      });
      try {
        await chat.notifySuperAdmins({
          type: 'task_status',
          title: `⚠️ AI Vývojář eskaloval úkol #${task.id}`,
          body: `Agent narazil na forbidden cesty: ${violations.map((v) => v.path).join(', ').slice(0, 200)}`,
          link: '/modules/ai-vyvojar/index.html',
          meta: { run_id: run.id, task_id: task.id, kind: 'escalated' },
        });
      } catch (e) { console.error('[ai-dev] notifySuperAdmins (escalated) failed:', e.message); }
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
      tokens_used: triageTokens + plannerTokens + agentResult.tokensUsed,
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

    // Notifikace všem super adminům — jen ti reviewují a mergují
    try {
      await chat.notifySuperAdmins({
        excludeUserId: task.created_by,
        type: 'task_status',
        title: `🤖 PR #${pr.number} čeká na review (úkol #${task.id})`,
        body: `${prTitle} — ${shortenForBody(agentResult.summary, 140)}`,
        link: '/modules/ai-vyvojar/index.html',
        meta: { run_id: run.id, pr_url: pr.html_url, pr_number: pr.number, task_id: task.id },
      });
    } catch (e) {
      console.error('[ai-dev] notifySuperAdmins (pr_open) failed:', e.message);
    }

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
