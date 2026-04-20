// =============================================================================
// HolyOS — Admin Tasks routes (úkoly pro vývojáře / správce)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('./notifications.routes');
const messagesRouter = require('./messages.routes');

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

// GET /api/tasks/stats/summary (musí být PŘED /:id)
router.get('/stats/summary', async (req, res, next) => {
  try {
    const [total, newTasks, inProgress, done] = await Promise.all([
      prisma.adminTask.count(),
      prisma.adminTask.count({ where: { status: 'new' } }),
      prisma.adminTask.count({ where: { status: 'in_progress' } }),
      prisma.adminTask.count({ where: { status: 'done' } }),
    ]);
    res.json({ total, new: newTasks, in_progress: inProgress, done });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks — seznam úkolů
router.get('/', async (req, res, next) => {
  try {
    const { status, priority, page } = req.query;
    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (page) where.page = page;

    const tasks = await prisma.adminTask.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { created_at: 'desc' }],
      include: TASK_INCLUDE,
    });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
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
    const task = await prisma.adminTask.create({
      data: {
        ...req.body,
        created_by: req.user.id,
      },
      include: TASK_INCLUDE,
    });
    res.status(201).json(task);
  } catch (err) {
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

    // Pokud se změnil status a máme autora — pošli mu notifikaci (a zprávu do thread kanálu, pokud existuje)
    if (previous && previous.status !== task.status && task.created_by && task.created_by !== req.user.id) {
      const statusLabel = STATUS_LABELS[task.status] || task.status;
      const actor = req.user.displayName || req.user.username;
      const title = `Požadavek #${task.id}: ${statusLabel}`;
      const body = `${actor} změnil stav požadavku "${(task.description || '').slice(0, 60)}${(task.description || '').length > 60 ? '…' : ''}"`;

      createNotification({
        userId: task.created_by,
        type: 'task_status',
        title,
        body,
        link: `/modules/admin-tasks/?task=${task.id}`,
        meta: { task_id: task.id, new_status: task.status, old_status: previous.status },
      }).catch(e => console.error('Notif error:', e.message));

      // Pokud existuje task-channel, napiš tam systémovou zprávu
      try {
        const channel = await prisma.chatChannel.findFirst({
          where: { type: 'task', admin_task_id: task.id },
          select: { id: true },
        });
        if (channel && messagesRouter.postSystemMessage) {
          messagesRouter.postSystemMessage(
            channel.id,
            `🔄 ${actor} změnil stav z "${STATUS_LABELS[previous.status] || previous.status}" na "${statusLabel}"`
          ).catch(e => console.error('Sys msg error:', e.message));
        }
      } catch (_) { /* ignore */ }
    }

    res.json(task);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.adminTask.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
