// =============================================================================
// HolyOS — Admin Tasks routes (úkoly pro vývojáře / správce)
// =============================================================================

const express = require('express');
const { Prisma } = require('@prisma/client');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('./notifications.routes');

router.use(requireAuth);

// Společný include pro vracené záznamy (autor požadavku)
const TASK_INCLUDE = {
  creator: {
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
        created_by: true, deleted_at: true,
        created_at: true, updated_at: true,
        creator: { select: { id: true, username: true, display_name: true } },
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
  } catch (err) {
    console.error('[admin-tasks] POST chyba:', err.message);
    next(err);
  }
});

// PUT /api/tasks/:id
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const previous = await prisma.adminTask.findUnique({
      where: { id },
      select: { id: true, status: true, created_by: true, page_title: true, page: true, description: true },
    });

    const task = await prisma.adminTask.update({
      where: { id },
      data: req.body,
      include: TASK_INCLUDE,
    });

    // Pokud se změnil status a máme autora — pošli mu notifikaci do zvonku.
    // Systémové zprávy do task-chatu jsme odstranili, aby notifikace o požadavcích
    // nezamořovaly chat. Task-channel si může autor sám otevřít tlačítkem „Diskuze",
    // pokud chce o požadavku pokecat s řešitelem.
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
