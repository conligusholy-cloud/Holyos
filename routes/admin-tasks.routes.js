// =============================================================================
// HolyOS — Admin Tasks routes (úkoly pro vývojáře / správce)
// =============================================================================

const express = require('express');
const { Prisma } = require('@prisma/client');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('./notifications.routes');
const { getBlockingRunForTask, RUNNING_STATUSES } = require('../services/ai-developer/repository');
const acChat = require('../services/ai-developer/ac-chat');
const suitability = require('../services/ai-developer/suitability');
const chat = require('../services/ai-developer/chat');

router.use(requireAuth);

// Společný include pro vracené záznamy (autor požadavku + řešitel)
const TASK_INCLUDE = {
  creator: {
    select: { id: true, username: true, display_name: true }
  },
  assignee: {
    select: { id: true, username: true, display_name: true }
  }
};

// Mapping status → text pro notifikaci
const STATUS_LABELS = {
  new: 'Nový',
  in_progress: 'Rozpracovaný',
  done: '✅ Hotový',
  cancelled: '❌ Zrušený',
};

// GET /api/admin-tasks/debug/screenshots — diagnostika (jen pro mě, nikoho jiného vidět neobtěžuje)
router.get('/debug/screenshots', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, created_by, created_at,
             CASE WHEN screenshot IS NULL THEN NULL ELSE length(screenshot) END AS screenshot_len,
             substr(COALESCE(screenshot, ''), 1, 50) AS screenshot_prefix,
             substr(description, 1, 60) AS description_preview
      FROM admin_tasks
      ORDER BY id DESC
      LIMIT 30
    `;
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/admin-tasks/stats/summary (musí být PŘED /:id)
// Jeden raw SQL dotaz — vrací všechny counts najednou přes FILTER,
// nahrazuje 5 paralelních count queries (každý byl round-trip přes Railway proxy).
router.get('/stats/summary', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status IN ('new', 'in_progress'))  AS active,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'done')                   AS archived,
        COUNT(*) FILTER (WHERE deleted_at IS NOT NULL OR status = 'cancelled')           AS trashed,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'new')                    AS new_count,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'in_progress')            AS in_progress_count
      FROM admin_tasks
    `;
    const r = rows[0] || {};
    const active = Number(r.active || 0);
    const archived = Number(r.archived || 0);
    const trashed = Number(r.trashed || 0);
    res.json({
      active, archived, trashed,
      new: Number(r.new_count || 0),
      in_progress: Number(r.in_progress_count || 0),
      total: active + archived + trashed,  // backward compat
      done: archived,                       // backward compat
    });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// VLASTNÍ POŽADAVKY UŽIVATELE (osobní profil)
// Tyto routy MUSÍ být PŘED dynamickou /:id (jinak by „mine" spadlo do /:id).
// =============================================================================

// GET /api/admin-tasks/mine — moje vlastní požadavky (které jsem sám vytvořil)
// Vrací jen aktivní (nesmazané) položky s titulkem, datem a stavem. Slouží
// osobnímu profilu, aby si uživatel mohl spravovat (zrušit) své požadavky
// a nezatěžoval admina.
router.get('/mine', async (req, res, next) => {
  try {
    const tasks = await prisma.adminTask.findMany({
      where: {
        created_by: req.user.id,
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        page_title: true,
        description: true,
        status: true,
        priority: true,
        created_at: true,
      },
    });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin-tasks/mine/:id/cancel — zrušení vlastního požadavku
// Bezpečnostní pravidlo: uživatel smí zrušit jen SVŮJ požadavek (created_by).
// Zrušení = soft delete (přesun do Koše) + status 'cancelled', aby admin
// případně viděl historii. Hotové požadavky už zrušit nelze.
router.post('/mine/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const existing = await prisma.adminTask.findUnique({
      where: { id },
      select: { id: true, created_by: true, status: true, deleted_at: true },
    });
    if (!existing) return res.status(404).json({ error: 'Požadavek nenalezen' });

    // Vlastnictví — cizí požadavek zrušit nelze
    if (existing.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Tento požadavek nepatří tobě, nemůžeš ho zrušit.' });
    }
    if (existing.deleted_at) {
      return res.status(400).json({ error: 'Požadavek už byl zrušen.' });
    }
    if (existing.status === 'done') {
      return res.status(400).json({ error: 'Hotový požadavek nelze zrušit.' });
    }

    await prisma.adminTask.update({
      where: { id },
      data: { deleted_at: new Date(), status: 'cancelled' },
    });
    res.json({ ok: true, cancelled: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin-tasks — seznam úkolů
// Query param `view` přepíná sekci:
//   active (default) — naplánované + rozpracované (nejsou smazané)
//   archive          — hotové (nejsou smazané)
//   trash            — v koši (deleted_at != null NEBO status=cancelled)
//
// VÝKON: screenshot (base64, typicky 100-500 kB na úkol) NEVRACÍME v listu —
// jen flag `has_screenshot`. Pro plný screenshot volej GET /:id nebo /:id/screenshot.
router.get('/', async (req, res, next) => {
  try {
    const { status, priority, page, view } = req.query;
    const where = {};

    const viewMode = view || 'active';
    if (viewMode === 'archive') {
      where.deleted_at = null;
      where.status = 'done';
    } else if (viewMode === 'trash') {
      where.OR = [{ deleted_at: { not: null } }, { status: 'cancelled' }];
    } else {
      // active
      where.deleted_at = null;
      where.status = { in: ['new', 'in_progress'] };
    }

    // Manuální filtr stavu (přebije view, pokud je explicitně zadán)
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (page) where.page = page;

    const orderBy = viewMode === 'archive'
      ? [{ updated_at: 'desc' }]
      : viewMode === 'trash'
        ? [{ deleted_at: 'desc' }, { updated_at: 'desc' }]
        : [{ priority: 'asc' }, { created_at: 'desc' }];

    // Select explicitně — screenshot NEFETCHUJEME, ušetříme desítky kB na úkol
    const tasks = await prisma.adminTask.findMany({
      where,
      orderBy,
      select: {
        id: true, status: true, priority: true,
        page: true, page_title: true,
        description: true, spec: true,
        ai_questions: true, ai_answers: true,
        assignable_to_ai: true, target_repo_id: true,
        change_type: true, autonomy_override: true,
        ai_suitability_score: true, ai_suitability_reasoning: true,
        created_by: true, deleted_at: true,
        assigned_to: true, assigned_at: true,
        created_at: true, updated_at: true,
        creator: { select: { id: true, username: true, display_name: true } },
        assignee: { select: { id: true, username: true, display_name: true } },
      },
    });

    // Druhým rychlým dotazem zjistíme, které mají screenshot (jen flag, ne data)
    if (tasks.length) {
      const idsWithScreenshot = await prisma.$queryRaw`
        SELECT id FROM admin_tasks
        WHERE id IN (${Prisma.join(tasks.map(t => t.id))})
          AND screenshot IS NOT NULL
      `;
      const ssSet = new Set(idsWithScreenshot.map(r => r.id));
      tasks.forEach(t => { t.has_screenshot = ssSet.has(t.id); });

      // Active AI runs (RUNNING_STATUSES + pr_open) pro tasky s assignable_to_ai.
      // Bereme jen nejnovější per task — info ukazujeme jako badge „🤖 coding"
      // vedle assignee. Reuse logiky z getBlockingRunForTask, ale dávkově pro list.
      const aiTaskIds = tasks.filter(t => t.assignable_to_ai).map(t => t.id);
      if (aiTaskIds.length) {
        const runs = await prisma.agentRun.findMany({
          where: {
            task_id: { in: aiTaskIds },
            status: { in: [...RUNNING_STATUSES, 'pr_open'] },
          },
          orderBy: { started_at: 'desc' },
          select: {
            id: true, task_id: true, status: true,
            started_at: true, pr_url: true,
            repo: { select: { id: true, name: true } },
          },
        });
        // Nejnovější per task_id (sortováno desc, takže first wins)
        const runByTask = new Map();
        for (const r of runs) {
          if (!runByTask.has(r.task_id)) runByTask.set(r.task_id, r);
        }
        tasks.forEach(t => {
          t.active_run = runByTask.get(t.id) || null;
        });
      }
    }

    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin-tasks/:id/screenshot — lazy load plného screenshotu
// (posílá base64 jen když ho uživatel reálně chce vidět, ne v každém listu)
router.get('/:id/screenshot', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const row = await prisma.adminTask.findUnique({
      where: { id },
      select: { screenshot: true },
    });
    if (!row || !row.screenshot) return res.status(404).json({ error: 'Screenshot nenalezen' });
    res.json({ screenshot: row.screenshot });
  } catch (err) { next(err); }
});

// GET /api/tasks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const task = await prisma.adminTask.findUnique({
      where: { id: parseInt(req.params.id) },
      include: TASK_INCLUDE,
    });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks
router.post('/', async (req, res, next) => {
  try {
    // Diagnostika — kolik přišlo dat a jestli je screenshot součástí těla
    const ssLen = typeof req.body?.screenshot === 'string' ? req.body.screenshot.length : 0;
    console.log(`[admin-tasks] POST by user=${req.user.id}, screenshot=${ssLen ? ssLen + ' B' : 'NONE'}, page=${req.body?.page || '?'}`);

    const task = await prisma.adminTask.create({
      data: {
        ...req.body,
        created_by: req.user.id,
      },
      include: TASK_INCLUDE,
    });
    console.log(`[admin-tasks] → vytvořen úkol #${task.id}, screenshot v DB: ${task.screenshot ? task.screenshot.length + ' B' : 'NULL'}`);
    res.status(201).json(task);

    // Async fire-and-forget: vyhodnoť suitability score (Claude haiku) pro nový task.
    // Pokud Alan už task finalizoval (Alan chat), score je informativní; pokud ne,
    // pomůže Tomášovi rychle vidět, který task je pro AI vhodný.
    setImmediate(() => evaluateSuitabilityAsync(task.id).catch((e) =>
      console.error('[admin-tasks] suitability eval failed for', task.id, ':', e.message)
    ));
  } catch (err) {
    console.error('[admin-tasks] POST chyba:', err.message);
    next(err);
  }
});

// POST /api/admin-tasks/backfill-suitability — hromadná re-eval pro tasky bez score
// Defaultně max 20 tasků per call, aby se nezadřela DB / Anthropic API.
router.post('/backfill-suitability', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.body && req.body.limit, 10) || 20, 1), 100);
    const tasks = await prisma.adminTask.findMany({
      where: { ai_suitability_score: null, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { id: true },
    });
    if (tasks.length === 0) {
      return res.json({ evaluated: 0, message: 'Žádné tasky bez score.' });
    }
    // Spusť všechny eval paralelně (fire-and-forget, response vrátíme hned)
    const ids = tasks.map((t) => t.id);
    setImmediate(() => {
      Promise.all(ids.map((id) =>
        evaluateSuitabilityAsync(id).catch((e) =>
          console.error('[admin-tasks] backfill eval failed for', id, ':', e.message)
        )
      ));
    });
    res.json({
      evaluated: tasks.length,
      task_ids: ids,
      message: `Zpracovávám ${tasks.length} úkolů na pozadí — score se objeví do cca 30 s.`,
    });
  } catch (err) { next(err); }
});

// Helper — vyhodnotí task + uloží score/reasoning do DB.
async function evaluateSuitabilityAsync(taskId) {
  const task = await prisma.adminTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, page_title: true, description: true, page: true,
      acceptance_criteria: true, affected_module: true, change_type: true,
    },
  });
  if (!task) return;
  const result = await suitability.evaluate(task);
  const data = {
    ai_suitability_score: result.score,
    ai_suitability_reasoning: result.reasoning,
    ai_suitability_at: new Date(),
  };
  // Pokud Alan ještě nemá change_type / autonomy, můžeme nasadit doporučení.
  // Jen JEMNĚ — nepřepisujeme pokud už něco je (uživatel může mít vlastní volbu).
  if (result.recommendedChangeType && !task.change_type) data.change_type = result.recommendedChangeType;
  await prisma.adminTask.update({ where: { id: taskId }, data });

  // AUTO-ASSIGN: pokud score >= threshold, automaticky předej AI Vývojáři.
  await maybeAutoAssignToAI(taskId, result.score);
}

// AUTO-ASSIGN HELPER
// Když suitability skóre překročí threshold, automaticky nastav assignable_to_ai
// + target_repo_id (default první aktivní repo) + autonomy_override (default pr_review).
// Tomáš pak ručně už nemusí klikat 'Přidat AI Vývojáři'.
async function maybeAutoAssignToAI(taskId, score) {
  const threshold = parseInt(process.env.AI_AUTO_ASSIGN_THRESHOLD || '70', 10);
  if (!Number.isFinite(score) || score < threshold) return false;

  const task = await prisma.adminTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, page_title: true, assignable_to_ai: true,
      target_repo_id: true, autonomy_override: true,
      acceptance_criteria: true, status: true,
    },
  });
  if (!task) return false;
  if (task.assignable_to_ai) return false; // už předáno dřív
  if (!task.acceptance_criteria || task.acceptance_criteria.length < 20) {
    console.log('[auto-assign] task #' + taskId + ' skip — chybí AC');
    return false;
  }
  if (task.status === 'done' || task.status === 'archived') return false;

  // Vyber target_repo_id — pokud už ho task má, použij; jinak env nebo první aktivní
  let repoId = task.target_repo_id;
  if (!repoId) {
    if (process.env.AI_AUTO_ASSIGN_REPO_ID) {
      repoId = parseInt(process.env.AI_AUTO_ASSIGN_REPO_ID, 10);
    } else {
      const defaultRepo = await prisma.agentRepo.findFirst({
        where: { active: true },
        orderBy: { id: 'asc' },
      });
      if (!defaultRepo) {
        console.warn('[auto-assign] task #' + taskId + ' — žádný aktivní repo, skip');
        return false;
      }
      repoId = defaultRepo.id;
    }
  }

  const autonomy = task.autonomy_override || process.env.AI_AUTO_ASSIGN_AUTONOMY || 'pr_review';

  await prisma.adminTask.update({
    where: { id: taskId },
    data: {
      assignable_to_ai: true,
      target_repo_id: repoId,
      autonomy_override: autonomy,
    },
  });
  console.log('[auto-assign] task #' + taskId + ' → AI Vývojář (score=' + score + '/100, repo=' + repoId + ', autonomy=' + autonomy + ')');

  // Chat notif do task threadu
  try {
    await chat.postMessage(taskId,
      '🤖 **Úkol automaticky předán AI Vývojáři** (skóre ' + score + '/100 ≥ ' + threshold + ').\n\n' +
      'Worker ho vyzvedne v dalším pollu (~30 s). Pokud chceš zrušit, klikni "Uvolnit z AI" v UI úkolu.'
    );
  } catch (e) { console.warn('[auto-assign] chat notif failed:', e.message); }

  return true;
}

// POST /api/admin-tasks/:id/evaluate-suitability — re-evaluate manuálně z UI
router.post('/:id/evaluate-suitability', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    await evaluateSuitabilityAsync(id);
    const task = await prisma.adminTask.findUnique({
      where: { id },
      select: { ai_suitability_score: true, ai_suitability_reasoning: true, ai_suitability_at: true },
    });
    res.json(task);
  } catch (err) { next(err); }
});

// POST /api/admin-tasks/:id/claim — řešitel přebírá úkol (musí být PŘED PUT /:id)
// Klidně přepíše stávajícího řešitele — UI by se mělo zeptat, ale backend nevadí.
// Pokud je task ve stavu 'new', posune ho na 'in_progress' automaticky.
router.post('/:id/claim', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const existing = await prisma.adminTask.findUnique({
      where: { id }, select: { id: true, status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Úkol nenalezen' });

    const data = {
      assigned_to: req.user.id,
      assigned_at: new Date(),
    };
    if (existing.status === 'new') data.status = 'in_progress';

    const task = await prisma.adminTask.update({
      where: { id }, data, include: TASK_INCLUDE,
    });
    res.json(task);
  } catch (err) { next(err); }
});

// POST /api/admin-tasks/:id/unclaim — uvolnit (vynulovat assignee)
router.post('/:id/unclaim', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const task = await prisma.adminTask.update({
      where: { id },
      data: { assigned_to: null, assigned_at: null },
      include: TASK_INCLUDE,
    });
    res.json(task);
  } catch (err) { next(err); }
});

// PUT /api/tasks/:id
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const previous = await prisma.adminTask.findUnique({
      where: { id },
      select: {
        id: true, status: true, created_by: true, page_title: true, page: true, description: true,
        assigned_to: true,
        // Pro reassign-blocker check (target_repo_id změna na úkolu, co už je v AI):
        assignable_to_ai: true, target_repo_id: true,
      },
    });

    // Reassign target_repa na úkolu, který už byl předán AI Vývojáři — pokud
    // existuje aktivní run (RUNNING nebo pr_open), reassign odmítneme se 409.
    // Audit log a invariant `run.repo_id == co bylo na tasku v okamžiku startu`
    // tak zůstanou konzistentní. Cancel/uzavření runu provede uživatel ručně
    // v modulu AI Vývojář.
    if (
      previous &&
      previous.assignable_to_ai &&
      req.body &&
      Object.prototype.hasOwnProperty.call(req.body, 'target_repo_id') &&
      req.body.target_repo_id !== previous.target_repo_id
    ) {
      const blocking = await getBlockingRunForTask(id);
      if (blocking) {
        return res.status(409).json({
          error: 'AI_RUN_ACTIVE',
          message: `Aktivní run #${blocking.id} (${blocking.status}) v repu ${blocking.repo?.name || '?'}. Cancelni ho v modulu AI Vývojář a zkus to znovu.`,
          run: {
            id: blocking.id,
            status: blocking.status,
            repo_id: blocking.repo_id,
            repo_name: blocking.repo?.name || null,
          },
        });
      }
    }

    // Auto-claim při přechodu na in_progress (pokud nikdo jiný už nepracuje)
    // a auto-release při done/cancelled. Klient může explicitně poslat
    // `assigned_to` v body a tím auto-logiku přebít.
    const patch = { ...req.body };
    const sendsAssignedTo = Object.prototype.hasOwnProperty.call(req.body, 'assigned_to');
    if (!sendsAssignedTo && previous && req.body && req.body.status) {
      const newStatus = req.body.status;
      if (newStatus === 'in_progress' && previous.status !== 'in_progress' && !previous.assigned_to) {
        patch.assigned_to = req.user.id;
        patch.assigned_at = new Date();
      } else if ((newStatus === 'done' || newStatus === 'cancelled') && previous.assigned_to) {
        patch.assigned_to = null;
        patch.assigned_at = null;
      }
    }
    if (sendsAssignedTo) {
      // Pokud klient explicitně mění assignee, dorovnej i assigned_at
      patch.assigned_at = req.body.assigned_to ? new Date() : null;
    }

    const task = await prisma.adminTask.update({
      where: { id },
      data: patch,
      include: TASK_INCLUDE,
    });

    // Pokud se změnil status a máme autora — pošli mu notifikaci do zvonku.
    // Systémové zprávy do task-chatu jsme odstranili, aby notifikace o požadavcích
    // nezamořovaly chat. Task-channel si může autor sám otevřít tlačítkem „Diskuze",
    // pokud chce o požadavku pokecat s řešitelem.
    // Re-eval suitability pokud se měnily fields, na kterých score závisí
    // (popis, AC, change_type, affected_module). Async fire-and-forget.
    const evalRelevant = ['description', 'acceptance_criteria', 'change_type', 'affected_module', 'page_title']
      .some((k) => req.body && Object.prototype.hasOwnProperty.call(req.body, k));
    if (evalRelevant) {
      setImmediate(() => evaluateSuitabilityAsync(id).catch((e) =>
        console.error('[admin-tasks] re-eval suitability after PUT failed for', id, ':', e.message)
      ));
    }

    if (previous && previous.status !== task.status && task.created_by && task.created_by !== req.user.id) {
      const statusLabel = STATUS_LABELS[task.status] || task.status;
      const actor = req.user.displayName || req.user.username;
      const descShort = (task.description || '').slice(0, 60) + ((task.description || '').length > 60 ? '…' : '');

      // Konkrétnější titulky pro done/cancelled (jsou to „finální stavy")
      let title;
      let body;
      if (task.status === 'done') {
        title = `✅ Požadavek #${task.id} vyřešen`;
        body = `${actor} označil tvůj požadavek „${descShort}" jako hotový. Prosím zkontroluj, jestli vše funguje.`;
      } else if (task.status === 'cancelled') {
        title = `❌ Požadavek #${task.id} zamítnut`;
        body = `${actor} zamítl tvůj požadavek „${descShort}".`;
      } else {
        title = `Požadavek #${task.id}: ${statusLabel}`;
        body = `${actor} změnil stav požadavku „${descShort}"`;
      }

      createNotification({
        userId: task.created_by,
        type: 'task_status',
        title,
        body,
        link: `/modules/admin-tasks/?task=${task.id}`,
        meta: { task_id: task.id, new_status: task.status, old_status: previous.status },
      }).catch(e => console.error('Notif error:', e.message));
    }

    res.json(task);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin-tasks/draft-chat — AI doptává úkol BĚHEM vytváření (před DB)
// body: { message, history, draft, page_context }
// Žádná DB persistence — vše drží frontend mezi voláními. Po finalized=true
// frontend pošle POST / s draftem (existující create endpoint).
router.post('/draft-chat', async (req, res, next) => {
  try {
    const message = String((req.body && req.body.message) || '').trim();
    if (!message) return res.status(400).json({ error: 'Chybí message v body.' });

    const history = Array.isArray(req.body && req.body.history) ? req.body.history : [];
    const draft = (req.body && req.body.draft && typeof req.body.draft === 'object') ? req.body.draft : {};
    const pageContext = (req.body && req.body.page_context && typeof req.body.page_context === 'object') ? req.body.page_context : {};

    let result;
    try {
      result = await acChat.chatDraft({ draft, history, userMessage: message, pageContext });
    } catch (e) {
      // Detailní log pro debug — celá exception trace + Anthropic error code.
      console.error('[ac-chat draft] failed:', {
        message: e.message,
        status: e.status || e.statusCode || null,
        anthropicError: e.error || e.response?.data || null,
        stack: e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : null,
      });
      // Mapuj Anthropic chyby na proper HTTP status + retry hint pro klienta.
      const upstreamStatus = e.status || e.statusCode;
      const retryable = upstreamStatus === 429 || upstreamStatus === 503 ||
                        upstreamStatus === 529 || (upstreamStatus >= 500 && upstreamStatus < 600);
      const retryAfter = e.headers && e.headers['retry-after']
        ? Number(e.headers['retry-after'])
        : (retryable ? 5 : null);
      const httpStatus = upstreamStatus === 429 ? 429 : (retryable ? 503 : 500);
      return res.status(httpStatus).json({
        error: e.message || 'AC chat (draft) selhal',
        retryable,
        retry_after: retryAfter,
        code: upstreamStatus || 'unknown',
      });
    }

    res.json({
      ai_message: result.aiMessage,
      updates: result.updates,
      draft: result.updatedDraft,
      history: result.newHistory.slice(-100),
      finalized: result.finalized,
      summary: result.summary,
      escalate: result.escalate,
      escalate_reason: result.escalateReason,
      tokens_used: result.tokensUsed,
    });
  } catch (err) { next(err); }
});

// POST /api/admin-tasks/:id/ac-chat — AI doptává akceptační kritéria
// body: { message: string, reset?: boolean }
// History persistuje v task.ai_questions (JSONB pole {role, content}).
// Pokud reset=true, history se vynuluje (nový rozhovor).
router.post('/:id/ac-chat', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const message = String((req.body && req.body.message) || '').trim();
    const reset = !!(req.body && req.body.reset);
    if (!message && !reset) {
      return res.status(400).json({ error: 'Chybí message v body.' });
    }

    const task = await prisma.adminTask.findUnique({
      where: { id },
      select: {
        id: true, page_title: true, description: true,
        acceptance_criteria: true, affected_module: true,
        change_type: true, autonomy_override: true,
        ai_questions: true,
      },
    });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });

    if (reset) {
      await prisma.adminTask.update({ where: { id }, data: { ai_questions: [] } });
      return res.json({ ai_message: '(Nová konverzace — zeptej se mě na úkol.)', updates: null, finalized: false, escalate: false, history_reset: true });
    }

    const history = Array.isArray(task.ai_questions) ? task.ai_questions : [];

    let result;
    try {
      result = await acChat.chat({ task, history, userMessage: message });
    } catch (e) {
      console.error('[ac-chat] chat() failed:', e.message);
      return res.status(500).json({ error: 'AC chat selhal: ' + e.message });
    }

    // Persist new history (max 100 messages, aby se nepřetekla DB)
    const trimmedHistory = result.newHistory.slice(-100);

    // Apply suggested updates do task fields (partial, jen non-null/non-empty)
    const taskPatch = { ai_questions: trimmedHistory };
    if (result.updates) {
      const u = result.updates;
      if (u.acceptance_criteria && u.acceptance_criteria.trim()) taskPatch.acceptance_criteria = u.acceptance_criteria.trim();
      if (u.affected_module && u.affected_module.trim()) taskPatch.affected_module = u.affected_module.trim();
      if (u.change_type) taskPatch.change_type = u.change_type;
      if (u.autonomy_override) taskPatch.autonomy_override = u.autonomy_override;
    }
    await prisma.adminTask.update({ where: { id }, data: taskPatch });

    res.json({
      ai_message: result.aiMessage,
      updates: result.updates,
      finalized: result.finalized,
      summary: result.summary,
      escalate: result.escalate,
      escalate_reason: result.escalateReason,
      tokens_used: result.tokensUsed,
      // Frontend si znovu pamatuje aktuální AC fields přes updates
      current_ac: {
        acceptance_criteria: taskPatch.acceptance_criteria || task.acceptance_criteria || null,
        affected_module: taskPatch.affected_module || task.affected_module || null,
        change_type: taskPatch.change_type || task.change_type || null,
        autonomy_override: taskPatch.autonomy_override || task.autonomy_override || null,
      },
    });
  } catch (err) { next(err); }
});

// DELETE /api/admin-tasks/:id
// Soft delete — přesune do Koše. S query ?hard=true smaže trvale, ale jen pokud
// už v koši je (deleted_at != null nebo status=cancelled).
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const hard = req.query.hard === 'true' || req.query.hard === '1';
    const existing = await prisma.adminTask.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Požadavek nenalezen' });

    if (hard) {
      const isInTrash = existing.deleted_at || existing.status === 'cancelled';
      if (!isInTrash) {
        return res.status(400).json({ error: 'Trvalé smazání lze jen z Koše. Nejdřív přesuň do Koše.' });
      }
      await prisma.adminTask.delete({ where: { id } });
      return res.json({ ok: true, hardDeleted: true });
    }

    // Soft delete — označ jako smazané
    await prisma.adminTask.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
    res.json({ ok: true, softDeleted: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin-tasks/:id/restore — obnovit z Koše / Archivu
router.post('/:id/restore', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.adminTask.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Požadavek nenalezen' });

    // Obnov = vrátit do aktivního stavu
    const newStatus = (existing.status === 'done' || existing.status === 'cancelled') ? 'new' : existing.status;
    const task = await prisma.adminTask.update({
      where: { id },
      data: { deleted_at: null, status: newStatus },
      include: TASK_INCLUDE,
    });
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin-tasks/run-import-product-images
// Jednorázový trigger — spustí scripts/import-factorify-product-images.js jako child process
// v běžícím Railway containeru (aby fotky padaly do /app/data/product-images/, ne lokálně).
// Vrací 202 hned, skript běží na pozadí. Progress je v Railway logs (`railway logs`).
//
// Sekvenční ochrana: pokud už běží jiný import, nový request vrátí 409.
let _imageImportRunning = false;
router.post('/run-import-product-images', async (req, res, next) => {
  try {
    if (_imageImportRunning) {
      return res.status(409).json({ error: 'Import už běží', running: true });
    }
    _imageImportRunning = true;

    const { spawn } = require('child_process');
    const path = require('path');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'import-factorify-product-images.js');
    const args = [];
    if (req.body && req.body.only) args.push('--only=' + parseInt(req.body.only));
    if (req.body && req.body.dry_run) args.push('--dry-run');

    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    console.log(`[admin-tasks] spuštěn import-factorify-product-images (pid=${child.pid}, args=${JSON.stringify(args)}, by user=${req.user?.id})`);

    child.stdout.on('data', d => process.stdout.write(`[import-images] ${d}`));
    child.stderr.on('data', d => process.stderr.write(`[import-images] ${d}`));
    child.on('exit', (code, sig) => {
      _imageImportRunning = false;
      console.log(`[admin-tasks] import-factorify-product-images skončil: code=${code} sig=${sig}`);
    });
    child.on('error', (e) => {
      _imageImportRunning = false;
      console.error('[admin-tasks] import-factorify-product-images error:', e);
    });

    res.status(202).json({
      ok: true,
      pid: child.pid,
      args,
      message: 'Import běží na pozadí — sleduj `railway logs` (výstup označený [import-images])',
    });
  } catch (err) {
    _imageImportRunning = false;
    next(err);
  }
});

module.exports = router;
