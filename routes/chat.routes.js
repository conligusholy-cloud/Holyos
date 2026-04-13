// =============================================================================
// HolyOS — Chat AI routes (Fáze 4: MCP orchestrátor)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { processQuery } = require('../services/ai/orchestrator');

// ─── CHAT ENDPOINT (MCP orchestrátor) ───────────────────────────────────────

// POST /api/ai/chat
router.post('/chat', async (req, res) => {
  try {
    const { message, module: currentModule, history, assistantSlug, multiAgent } = req.body;
    if (!message) return res.status(400).json({ error: 'Chybí zpráva' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY není nakonfigurovaný' });
    }

    const startTime = Date.now();

    // Orchestrátor zpracuje dotaz (single nebo multi-agent)
    const result = await processQuery({
      message,
      currentModule,
      assistantSlug: assistantSlug || null,
      history: history || [],
      enableMultiAgent: multiAgent === true,
    });

    const duration = Date.now() - startTime;

    // Log do skill_executions (pokud byly použité tools)
    if (result.toolsUsed?.length > 0 && req.user) {
      try {
        // Najdi nebo vytvoř konverzaci
        let conversationId = req.body.conversationId;
        if (!conversationId) {
          const assistant = await prisma.assistant.findUnique({ where: { slug: result.assistant.slug } });
          if (assistant) {
            const conv = await prisma.conversation.create({
              data: {
                user_id: req.user.id,
                assistant_id: assistant.id,
                title: message.substring(0, 100),
              },
            });
            conversationId = conv.id;
          }
        }

        // Ulož zprávy
        if (conversationId) {
          await prisma.message.createMany({
            data: [
              { conversation_id: conversationId, role: 'user', content: message },
              { conversation_id: conversationId, role: 'assistant', content: result.response,
                skill_calls: result.toolsUsed.length > 0 ? result.toolsUsed : undefined },
            ],
          });
        }
      } catch (logErr) {
        console.error('Chat log error:', logErr.message);
        // Neblokující — odpověď se vrátí i při chybě logování
      }
    }

    res.json({
      ...result,
      duration,
      conversationId: req.body.conversationId || null,
    });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── LIST ASSISTANTS (bez auth — pro chat panel dropdown) ───────────────────

router.get('/assistants-public', async (req, res) => {
  try {
    const assistants = await prisma.assistant.findMany({
      where: { is_active: true },
      select: { name: true, slug: true, role: true, config: true },
      orderBy: { name: 'asc' },
    });
    res.json(assistants.map(a => ({
      name: a.name,
      slug: a.slug,
      role: a.role,
      icon: a.config?.icon || '🤖',
      modules: a.config?.modules || [],
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CAPABILITIES ───────────────────────────────────────────────────────────

router.get('/capabilities', async (req, res) => {
  try {
    const { AGENT_MCP_MAP } = require('../services/ai/orchestrator');

    // Dynamicky z DB
    const assistants = await prisma.assistant.findMany({
      where: { is_active: true },
      select: { slug: true, name: true, role: true, config: true },
    });

    res.json({
      version: '2.0',
      architecture: 'MCP + Anthropic SDK',
      modules: ['hr', 'warehouse', 'production', 'attendance', 'leaves', 'orders', 'tasks'],
      assistants: assistants.map(a => ({
        slug: a.slug,
        name: a.name,
        role: a.role,
        mcpServers: AGENT_MCP_MAP[a.slug]?.servers || [],
        modules: a.config?.modules || [],
      })),
      features: {
        multiAgent: true,
        toolUse: true,
        mcpProtocol: true,
        parallelToolExecution: true,
      },
      examples: [
        'Kolik máme zaměstnanců?',
        'Kdo je dnes přítomen?',
        'Jaké materiály jsou pod minimem?',
        'Kolik máme výrobků a polotovarů?',
        'Seznam pracovišť',
        'Ukáž mi nevyřízené žádosti o dovolenou',
        'Kolik máme objednávek?',
        'Vytvoř úkol: Zkontrolovat zásoby',
        'Potřebuji objednat materiál na zakázku — použij více agentů',
      ],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
