// =============================================================================
// HolyOS — Admin Tasks routes (úkoly pro vývojáře / správce)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

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
    });
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// PUT /api/tasks/:id
router.put('/:id', async (req, res, next) => {
  try {
    const task = await prisma.adminTask.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
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
