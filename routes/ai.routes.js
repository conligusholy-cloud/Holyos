// =============================================================================
// HolyOS — AI routes (asistenti, konverzace, skilly)
// =============================================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { prisma } = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);

// ─── MODULY (auto-detekce) ───────────────────────────────────────────────
// GET /api/ai/modules — vrátí seznam všech modulů z adresáře modules/
router.get('/modules', async (req, res, next) => {
  try {
    const modulesDir = path.join(__dirname, '..', 'modules');
    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
    const modules = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const slug = e.name;
        // Pokus o čtení title z index.html
        let title = slug;
        try {
          const indexPath = path.join(modulesDir, slug, 'index.html');
          const html = fs.readFileSync(indexPath, 'utf-8');
          const match = html.match(/<title>([^|<]+)/);
          if (match) title = match[1].trim();
        } catch (_) {}
        return { slug, title };
      });
    res.json(modules);
  } catch (err) {
    next(err);
  }
});

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────

// GET /api/ai/dashboard/stats — statistiky pro monitoring
router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const [
      totalAssistants,
      activeAssistants,
      totalSkills,
      totalConversations,
      totalMessages,
      recentExecutions,
      executionsByStatus,
      executionsBySkill,
      conversationsLast7Days,
      avgDuration,
    ] = await Promise.all([
      prisma.assistant.count(),
      prisma.assistant.count({ where: { is_active: true } }),
      prisma.skill.count({ where: { is_active: true } }),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.skillExecution.findMany({
        take: 20,
        orderBy: { created_at: 'desc' },
        include: {
          skill: { select: { name: true, slug: true, category: true } },
        },
      }),
      prisma.skillExecution.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.skillExecution.groupBy({
        by: ['skill_id'],
        _count: true,
        _avg: { duration_ms: true },
        orderBy: { _count: { skill_id: 'desc' } },
        take: 10,
      }),
      prisma.conversation.count({
        where: { created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      prisma.skillExecution.aggregate({ _avg: { duration_ms: true } }),
    ]);

    // Resolve skill names for executionsBySkill
    const skillIds = executionsBySkill.map(e => e.skill_id);
    const skills = await prisma.skill.findMany({
      where: { id: { in: skillIds } },
      select: { id: true, name: true, slug: true, category: true },
    });
    const skillMap = Object.fromEntries(skills.map(s => [s.id, s]));

    const statusCounts = {};
    executionsByStatus.forEach(e => { statusCounts[e.status] = e._count; });

    res.json({
      overview: {
        totalAssistants,
        activeAssistants,
        totalSkills,
        totalConversations,
        totalMessages,
        conversationsLast7Days,
        avgDurationMs: Math.round(avgDuration._avg?.duration_ms || 0),
      },
      executionsByStatus: statusCounts,
      topSkills: executionsBySkill.map(e => ({
        skillId: e.skill_id,
        skill: skillMap[e.skill_id] || null,
        count: e._count,
        avgDurationMs: Math.round(e._avg?.duration_ms || 0),
      })),
      recentExecutions: recentExecutions.map(e => ({
        id: e.id,
        skill: e.skill?.name || 'Unknown',
        category: e.skill?.category || '',
        status: e.status,
        durationMs: e.duration_ms,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── ASISTENTI ────────────────────────────────────────────────────────────

// GET /api/ai/assistants
router.get('/assistants', async (req, res, next) => {
  try {
    const assistants = await prisma.assistant.findMany({
      where: { is_active: true },
      include: {
        skills: {
          include: { skill: { select: { id: true, name: true, slug: true, category: true } } },
          orderBy: { priority: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json(assistants);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/assistants/:slug
router.get('/assistants/:slug', async (req, res, next) => {
  try {
    const assistant = await prisma.assistant.findUnique({
      where: { slug: req.params.slug },
      include: {
        skills: {
          include: { skill: true },
          orderBy: { priority: 'desc' },
        },
      },
    });
    if (!assistant) return res.status(404).json({ error: 'Asistent nenalezen' });
    res.json(assistant);
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/assistants (admin)
router.post('/assistants', requireAdmin, async (req, res, next) => {
  try {
    const assistant = await prisma.assistant.create({ data: req.body });
    res.status(201).json(assistant);
  } catch (err) {
    next(err);
  }
});

// PUT /api/ai/assistants/:id (admin)
router.put('/assistants/:id', requireAdmin, async (req, res, next) => {
  try {
    const assistant = await prisma.assistant.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(assistant);
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/assistants/:id/skills — přiřadit skill
router.post('/assistants/:id/skills', requireAdmin, async (req, res, next) => {
  try {
    const link = await prisma.assistantSkill.create({
      data: {
        assistant_id: req.params.id,
        skill_id: req.body.skill_id,
        priority: req.body.priority || 0,
        config_override: req.body.config_override || null,
      },
    });
    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/ai/assistants/:id (admin) — smazat agenta
router.delete('/assistants/:id', requireAdmin, async (req, res, next) => {
  try {
    // Cascade smaže i AssistantSkill propojení (definováno v Prisma schema)
    await prisma.assistant.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    // Pokud má agent konverzace, jen deaktivovat
    if (err.code === 'P2003') {
      await prisma.assistant.update({
        where: { id: req.params.id },
        data: { is_active: false },
      });
      return res.json({ ok: true, deactivated: true });
    }
    next(err);
  }
});

// DELETE /api/ai/assistants/:id/skills/:skillId
router.delete('/assistants/:id/skills/:skillId', requireAdmin, async (req, res, next) => {
  try {
    await prisma.assistantSkill.delete({
      where: {
        assistant_id_skill_id: {
          assistant_id: req.params.id,
          skill_id: req.params.skillId,
        },
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── SKILLY ───────────────────────────────────────────────────────────────

// GET /api/ai/skills
router.get('/skills', async (req, res, next) => {
  try {
    const { category } = req.query;
    const where = { is_active: true };
    if (category) where.category = category;

    const skills = await prisma.skill.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json(skills);
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/skills (admin)
router.post('/skills', requireAdmin, async (req, res, next) => {
  try {
    const skill = await prisma.skill.create({ data: req.body });
    res.status(201).json(skill);
  } catch (err) {
    next(err);
  }
});

// PUT /api/ai/skills/:id (admin)
router.put('/skills/:id', requireAdmin, async (req, res, next) => {
  try {
    const skill = await prisma.skill.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(skill);
  } catch (err) {
    next(err);
  }
});

// ─── KONVERZACE ───────────────────────────────────────────────────────────

// GET /api/ai/conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const { assistant_id } = req.query;
    const where = { user_id: req.user.id };
    if (assistant_id) where.assistant_id = assistant_id;

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        assistant: { select: { id: true, name: true, slug: true, avatar_url: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { updated_at: 'desc' },
    });
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/conversations/:id
router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        assistant: { select: { id: true, name: true, slug: true, avatar_url: true, system_prompt: true } },
        messages: {
          orderBy: { created_at: 'asc' },
          include: {
            executions: {
              include: { skill: { select: { id: true, name: true, slug: true } } },
            },
          },
        },
      },
    });
    if (!conv) return res.status(404).json({ error: 'Konverzace nenalezena' });
    res.json(conv);
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/conversations
router.post('/conversations', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.create({
      data: {
        user_id: req.user.id,
        assistant_id: req.body.assistant_id,
        title: req.body.title || null,
        context: req.body.context || null,
      },
    });
    res.status(201).json(conv);
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/conversations/:id/messages
router.post('/conversations/:id/messages', async (req, res, next) => {
  try {
    const message = await prisma.message.create({
      data: {
        conversation_id: req.params.id,
        role: req.body.role,
        content: req.body.content,
        skill_calls: req.body.skill_calls || null,
      },
    });

    // Aktualizovat updated_at konverzace
    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { updated_at: new Date() },
    });

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/ai/conversations/:id
router.delete('/conversations/:id', async (req, res, next) => {
  try {
    await prisma.conversation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── SKILL EXECUTIONS ─────────────────────────────────────────────────────

// POST /api/ai/skill-executions
router.post('/skill-executions', async (req, res, next) => {
  try {
    const execution = await prisma.skillExecution.create({ data: req.body });
    res.status(201).json(execution);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/skill-executions — historie spuštění skillů
router.get('/skill-executions', async (req, res, next) => {
  try {
    const { skill_id, status, limit } = req.query;
    const where = {};
    if (skill_id) where.skill_id = skill_id;
    if (status) where.status = status;

    const executions = await prisma.skillExecution.findMany({
      where,
      include: {
        skill: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit ? parseInt(limit) : 50,
    });
    res.json(executions);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
