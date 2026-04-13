// =============================================================================
// HolyOS — Audit routes (audit log)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/audit — seznam záznamů audit logu
router.get('/', async (req, res, next) => {
  try {
    const { entity, entity_id, action, user_name, date_from, date_to, limit } = req.query;
    const where = {};
    if (entity) where.entity = entity;
    if (entity_id) where.entity_id = parseInt(entity_id);
    if (action) where.action = action;
    if (user_name) where.user_name = { contains: user_name, mode: 'insensitive' };
    if (date_from || date_to) {
      where.timestamp = {};
      if (date_from) where.timestamp.gte = new Date(date_from);
      if (date_to) where.timestamp.lte = new Date(date_to);
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit ? parseInt(limit) : 100,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// POST /api/audit — zapsat záznam (interní, volá se z ostatních modulů)
router.post('/', async (req, res, next) => {
  try {
    const log = await prisma.auditLog.create({
      data: {
        ...req.body,
        user_name: req.body.user_name || req.user.username,
        user_display: req.body.user_display || req.user.display_name,
      },
    });
    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/entity/:entity/:entityId — historie entity (PŘED /:id)
router.get('/entity/:entity/:entityId', async (req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        entity: req.params.entity,
        entity_id: parseInt(req.params.entityId),
      },
      orderBy: { timestamp: 'desc' },
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/:id
router.get('/:id', async (req, res, next) => {
  try {
    const log = await prisma.auditLog.findUnique({
      where: { id: parseInt(req.params.id) },
    });
    if (!log) return res.status(404).json({ error: 'Záznam nenalezen' });
    res.json(log);
  } catch (err) {
    next(err);
  }
});

// POST /api/audit/:id/rollback — vrátit entitu do stavu ze snapshotu
router.post('/:id/rollback', requireAdmin, async (req, res, next) => {
  try {
    const log = await prisma.auditLog.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!log) return res.status(404).json({ error: 'Záznam nenalezen' });
    if (!log.snapshot) return res.status(400).json({ error: 'Záznam nemá snapshot pro rollback' });

    // Generický rollback — použije entity + entity_id + snapshot
    const entity = log.entity;
    const entityId = log.entity_id;
    const snapshot = typeof log.snapshot === 'string' ? JSON.parse(log.snapshot) : log.snapshot;

    // Odstranit systémová pole
    delete snapshot.id;
    delete snapshot.created_at;
    delete snapshot.updated_at;

    // Dynamický update podle entity
    const modelMap = {
      person: 'person',
      department: 'department',
      role: 'role',
      shift: 'shift',
      attendance: 'attendance',
      leave_request: 'leaveRequest',
      company: 'company',
      material: 'material',
      order: 'order',
      document: 'document',
    };

    const model = modelMap[entity];
    if (!model || !entityId) {
      return res.status(400).json({ error: `Rollback pro entitu "${entity}" není podporován` });
    }

    await prisma[model].update({ where: { id: entityId }, data: snapshot });

    // Zalogovat rollback
    await prisma.auditLog.create({
      data: {
        action: 'rollback',
        entity: entity,
        entity_id: entityId,
        description: `Rollback na stav z audit záznamu #${log.id}`,
        user_name: req.user.username,
        user_display: req.user.display_name,
      },
    });

    res.json({ ok: true, entity, entity_id: entityId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/audit/cleanup — smazat staré záznamy (jen admin)
router.delete('/cleanup', requireAdmin, async (req, res, next) => {
  try {
    const { older_than_days } = req.query;
    const days = parseInt(older_than_days) || 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await prisma.auditLog.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
