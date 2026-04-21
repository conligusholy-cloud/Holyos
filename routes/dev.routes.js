// =============================================================================
// HolyOS — Dev Hub routes (vývojářští agenti, CRUD + chat + proposals)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');
const { getDevTools, executeDevTool } = require('../mcp-servers/dev-server');
const fs = require('fs');
const path = require('path');

router.use(requireAuth);
router.use(requireSuperAdmin);

// ─── Výchozí agenti — seedují se do DB, pokud je prázdná ─────────────────

// Společný základ pro všechny agenty — stručný a akční
const AGENT_BASE = `PRAVIDLA:
- Piš česky, stručně, bez zbytečného konverzování.
- Když dostaneš úkol, ROVNOU analyzuj kód (read_file, analyze_module) a navrhni KONKRÉTNÍ změny přes propose_change.
- NEPTEJ SE zpět "co přesně chceš?" — místo toho analyzuj kód a navrhni nejlepší řešení.
- Každá odpověď musí obsahovat buď konkrétní kód/návrh, nebo jasný technický závěr.
- Neopisuj co vidíš v kódu — rovnou řekni co je špatně a jak to opravit.
- Tech: Node.js, Express, Prisma ORM (nikdy raw SQL), vanilla JS frontend, PostgreSQL.`;

const DEFAULT_AGENTS = [
  {
    slug: 'hr',
    name: 'HR Developer',
    icon: '👥',
    module: 'lide-hr',
    context_file: 'hr-developer.md',
    color: '#6c5ce7',
    system_prompt: `Jsi senior vývojář zodpovědný za HR modul HolyOS (lidé, oddělení, docházka, dovolená, dokumenty).
${AGENT_BASE}
Tvůj modul: routes/hr.routes.js, modules/lide-hr/, mcp-servers/hr-server/.`,
  },
  {
    slug: 'warehouse',
    name: 'Warehouse Developer',
    icon: '📦',
    module: 'nakup-sklad',
    context_file: 'warehouse-developer.md',
    color: '#10b981',
    system_prompt: `Jsi senior vývojář zodpovědný za modul Sklad v HolyOS (materiály, objednávky, firmy, sklady, inventury).
${AGENT_BASE}
Tvůj modul: routes/warehouse.routes.js, modules/nakup-sklad/, mcp-servers/warehouse-server/.`,
  },
  {
    slug: 'production',
    name: 'Production Developer',
    icon: '⚙️',
    module: 'pracovni-postup',
    context_file: 'production-developer.md',
    color: '#f59e0b',
    system_prompt: `Jsi senior vývojář zodpovědný za výrobní moduly HolyOS (výrobky, operace, pracoviště, simulace, pracovní postupy).
${AGENT_BASE}
Tvůj modul: routes/production.routes.js, modules/pracovni-postup/, modules/programovani-vyroby/, modules/simulace-vyroby/, mcp-servers/production-server/.`,
  },
  {
    slug: 'assistant',
    name: 'Assistant Developer',
    icon: '🤖',
    module: 'ai-agenti',
    context_file: 'assistant-developer.md',
    color: '#8b5cf6',
    system_prompt: `Jsi senior vývojář zodpovědný za AI systém HolyOS (orchestrátor, MCP servery, chat panel, AI agenti).
${AGENT_BASE}
Tvůj modul: routes/ai.routes.js, services/ai/, modules/ai-agenti/, mcp-servers/*, js/ai-chat-panel.js.`,
  },
  {
    slug: 'frontend',
    name: 'Frontend Developer',
    icon: '🎨',
    module: null,
    context_file: 'frontend-developer.md',
    color: '#3b82f6',
    system_prompt: `Jsi senior frontend vývojář zodpovědný za celý frontend HolyOS (dashboard, sidebar, CSS, login, společné komponenty).
${AGENT_BASE}
Tvůj scope: index.html, js/sidebar.js, js/ai-chat-panel.js, css/dashboard.css, public/login.html. Dark mode, CSS variables, vanilla JS.`,
  },
];

// Seed výchozích agentů při prvním požadavku
let seeded = false;
async function ensureDefaultAgents() {
  if (seeded) return;
  seeded = true;
  try {
    const count = await prisma.devAgent.count();
    if (count === 0) {
      // Prázdná DB — vytvoř výchozí agenty
      for (const a of DEFAULT_AGENTS) {
        await prisma.devAgent.create({ data: a });
      }
      console.log(`[Dev Hub] Vytvořeno ${DEFAULT_AGENTS.length} výchozích agentů`);
    } else {
      // Aktualizuj system_prompt + model existujících výchozích agentů
      for (const a of DEFAULT_AGENTS) {
        const existing = await prisma.devAgent.findUnique({ where: { slug: a.slug } });
        if (existing) {
          const updates = {};
          if (existing.system_prompt !== a.system_prompt) updates.system_prompt = a.system_prompt;
          if (existing.model !== 'claude-sonnet-4-6') updates.model = 'claude-sonnet-4-6';
          if (Object.keys(updates).length > 0) {
            await prisma.devAgent.update({ where: { slug: a.slug }, data: updates });
            console.log(`[Dev Hub] Aktualizován agent: ${a.slug}`, Object.keys(updates));
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Dev Hub] DevAgent tabulka neexistuje, používám fallback:', err.message);
    seeded = false;
  }
}

// Helper — načíst agenta z DB nebo fallback
async function getAgent(slug) {
  try {
    await ensureDefaultAgents();
    const agent = await prisma.devAgent.findUnique({ where: { slug } });
    if (agent) return agent;
  } catch (err) {
    // Fallback na hardcoded
  }
  const def = DEFAULT_AGENTS.find(a => a.slug === slug);
  return def || null;
}

// ─── GET /api/dev/agents — seznam dev agentů ──────────────────────────────

router.get('/agents', async (req, res, next) => {
  try {
    await ensureDefaultAgents();
    const agents = await prisma.devAgent.findMany({
      orderBy: { created_at: 'asc' },
    });
    res.json(agents);
  } catch (err) {
    // Fallback — tabulka neexistuje
    res.json(DEFAULT_AGENTS.map(a => ({ ...a, id: a.slug, is_active: true })));
  }
});

// ─── GET /api/dev/agents/:slug — detail agenta ───────────────────────────

router.get('/agents/:slug', async (req, res, next) => {
  try {
    const agent = await getAgent(req.params.slug);
    if (!agent) return res.status(404).json({ error: 'Agent nenalezen' });
    res.json(agent);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/dev/agents — vytvořit nového agenta ───────────────────────

router.post('/agents', async (req, res, next) => {
  try {
    const { slug, name, icon, module, context_file, system_prompt, model, color } = req.body;

    if (!slug || !name || !system_prompt) {
      return res.status(400).json({ error: 'Povinná pole: slug, name, system_prompt' });
    }

    // Ověř unikátní slug
    const exists = await prisma.devAgent.findUnique({ where: { slug } });
    if (exists) {
      return res.status(409).json({ error: `Agent se slugem "${slug}" už existuje` });
    }

    const agent = await prisma.devAgent.create({
      data: {
        slug,
        name,
        icon: icon || '🤖',
        module: module || null,
        context_file: context_file || null,
        system_prompt,
        model: model || 'claude-sonnet-4-6',
        color: color || '#8b5cf6',
      },
    });

    res.status(201).json(agent);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/dev/agents/:slug — editovat agenta ─────────────────────────

router.put('/agents/:slug', async (req, res, next) => {
  try {
    const { name, icon, module, context_file, system_prompt, model, color, is_active } = req.body;

    const agent = await prisma.devAgent.findUnique({ where: { slug: req.params.slug } });
    if (!agent) return res.status(404).json({ error: 'Agent nenalezen' });

    const updated = await prisma.devAgent.update({
      where: { slug: req.params.slug },
      data: {
        ...(name !== undefined && { name }),
        ...(icon !== undefined && { icon }),
        ...(module !== undefined && { module: module || null }),
        ...(context_file !== undefined && { context_file: context_file || null }),
        ...(system_prompt !== undefined && { system_prompt }),
        ...(model !== undefined && { model }),
        ...(color !== undefined && { color }),
        ...(is_active !== undefined && { is_active }),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/dev/agents/:slug — smazat agenta ────────────────────────

router.delete('/agents/:slug', async (req, res, next) => {
  try {
    const agent = await prisma.devAgent.findUnique({ where: { slug: req.params.slug } });
    if (!agent) return res.status(404).json({ error: 'Agent nenalezen' });

    await prisma.devAgent.delete({ where: { slug: req.params.slug } });
    res.json({ ok: true, deleted: req.params.slug });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/dev/tasks — seznam dev úkolů ────────────────────────────────

router.get('/tasks', async (req, res, next) => {
  try {
    const tasks = await prisma.adminTask.findMany({
      where: { category: 'dev' },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/dev/chat — hlavní dev agent chat endpoint ──────────────────

router.post('/chat', async (req, res, next) => {
  try {
    const { message, agent: agentSlug, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Chybí zpráva' });
    }

    const agentDef = await getAgent(agentSlug || 'frontend');
    if (!agentDef) {
      return res.status(400).json({ error: `Neznámý agent: ${agentSlug}` });
    }

    // Načíst kontextový soubor — plná verze pro Tier 1+
    let context = '';
    const ctxFile = agentDef.context_file || agentDef.contextFile;
    if (ctxFile) {
      const contextPath = path.join(__dirname, '..', '.claude', 'agents', ctxFile);
      if (fs.existsSync(contextPath)) {
        context = fs.readFileSync(contextPath, 'utf-8').slice(0, 6000);
      }
    }

    const systemPrompt = [
      agentDef.system_prompt || agentDef.systemPrompt,
      context ? '---\n## Kontext modulu\n' + context : '',
      `## Jak pracuješ
- Když dostaneš úkol, IHNED čti relevantní soubory a Prisma schema.
- Po max 2 čteních MUSÍŠ navrhnout konkrétní kód přes propose_change.
- NIKDY nepiš "analyzuji" nebo "čtu" jako hlavní odpověď — to je jen mezikrok.
- Tvá finální odpověď MUSÍ obsahovat buď propose_change s kódem, nebo konkrétní technický plán s ukázkami kódu.
- Piš stručně. Žádné zbytečné odrážky nebo seznamy možností.`,
    ].filter(Boolean).join('\n\n');

    // Sestavit messages — poslední 6 zpráv z historie
    const messages = [
      ...history.slice(-6).map(h => ({
        role: h.role,
        content: typeof h.content === 'string' ? h.content : h.content,
      })),
      { role: 'user', content: message },
    ];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY není nastaven' });
    }

    const anthropic = new Anthropic({ apiKey });
    const { getDevToolsFull } = require('../mcp-servers/dev-server');
    const tools = typeof getDevToolsFull === 'function' ? getDevToolsFull() : getDevTools();
    const useModel = agentDef.model || 'claude-sonnet-4-6';
    const MAX_ITERATIONS = 5;
    const startTime = Date.now();

    // Helper — API call s retry při rate limitu
    async function callClaude(msgs) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await anthropic.messages.create({
            model: useModel,
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages: msgs,
          });
        } catch (err) {
          if (err.status === 429 && attempt < 2) {
            const wait = (attempt + 1) * 15000; // 15s, 30s
            console.log(`[Dev Hub] Rate limit, čekám ${wait/1000}s...`);
            await new Promise(r => setTimeout(r, wait));
          } else {
            throw err;
          }
        }
      }
    }

    // Tool-use loop
    let currentMessages = messages;
    let finalResponse = '';
    let toolsUsed = [];
    let proposals = [];
    let lastCompletion = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      console.log(`[Dev Hub] Iterace ${i + 1}/${MAX_ITERATIONS}, model: ${useModel}`);

      const completion = await callClaude(currentMessages);
      lastCompletion = completion;

      // Sbírej text
      const textParts = completion.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      if (textParts) {
        finalResponse += (finalResponse ? '\n' : '') + textParts;
      }

      // Pokud žádné tool_use, konec
      const toolBlocks = completion.content.filter(b => b.type === 'tool_use');
      if (toolBlocks.length === 0 || completion.stop_reason === 'end_turn') {
        break;
      }

      // Spustit všechny tool cally
      const toolResults = [];

      for (const tb of toolBlocks) {
        console.log(`[Dev Hub] Tool: ${tb.name}`);
        const result = await executeDevTool(tb.name, tb.input);
        toolsUsed.push(tb.name);

        if (tb.name === 'propose_change' && result.proposal) {
          proposals.push(result.proposal);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: completion.content },
        { role: 'user', content: toolResults },
      ];
    }

    const duration = Date.now() - startTime;

    // Fallback — pokud finalResponse je stále prázdný
    if (!finalResponse && lastCompletion) {
      finalResponse = 'Agent zpracoval požadavek (použité nástroje: ' + (toolsUsed.join(', ') || 'žádné') + ').';
      if (proposals.length) {
        finalResponse += ' Připravil ' + proposals.length + ' návrh(ů) ke schválení.';
      }
    }

    res.json({
      ok: true,
      response: finalResponse || 'Agent nevrátil žádný text.',
      agent: {
        slug: agentDef.slug || agentSlug,
        name: agentDef.name,
        icon: agentDef.icon,
      },
      toolsUsed: [...new Set(toolsUsed)],
      proposals,
      duration,
    });
  } catch (err) {
    console.error('Dev chat error:', err?.message || err, err?.status, JSON.stringify(err?.error || {}).slice(0, 500));

    if (res.headersSent) return;

    // Anthropic API chyby — vrať srozumitelnou zprávu
    const status = err.status || err.statusCode || 500;
    let errorMsg = err.message || 'Neznámá chyba';

    if (status === 429 || (errorMsg && errorMsg.includes('rate'))) {
      errorMsg = 'Rate limit — příliš mnoho požadavků. Počkej minutu a zkus znovu.';
    } else if (status === 401 || status === 403) {
      errorMsg = 'Neplatný ANTHROPIC_API_KEY. Zkontroluj env proměnnou.';
    } else if (err.error?.message) {
      errorMsg = err.error.message;
    }

    res.status(status).json({ error: errorMsg });
  }
});

// ─── POST /api/dev/apply-proposal — aplikace schválené změny ─────────────

router.post('/apply-proposal', async (req, res, next) => {
  try {
    const { file, old_code, new_code, description, autoCommit } = req.body;

    if (!file || old_code === undefined || new_code === undefined) {
      return res.status(400).json({ error: 'Chybí povinná pole: file, old_code, new_code' });
    }

    const fullPath = path.join(__dirname, '..', file);
    const projectRoot = path.resolve(__dirname, '..');
    const resolvedPath = path.resolve(fullPath);

    if (!resolvedPath.startsWith(projectRoot)) {
      return res.status(403).json({ error: 'Přístup mimo projektový adresář není povolen' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: `Soubor neexistuje: ${file}` });
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    if (!content.includes(old_code)) {
      return res.status(400).json({
        error: 'Starý kód nebyl nalezen v souboru — možná se soubor od návrhu změnil.',
        hint: 'Zkus nechat agenta znovu analyzovat aktuální stav.',
      });
    }

    const newContent = content.replace(old_code, new_code);
    fs.writeFileSync(resolvedPath, newContent, 'utf-8');

    let commitResult = null;
    if (autoCommit) {
      const { execSync } = require('child_process');
      try {
        execSync(`git add "${file}"`, { cwd: projectRoot });
        const msg = `Dev Hub: ${description || 'Schválená změna v ' + file}`;
        execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: projectRoot });
        commitResult = { committed: true, message: msg };
      } catch (gitErr) {
        commitResult = { committed: false, error: gitErr.message };
      }
    }

    res.json({
      ok: true,
      file,
      linesChanged: old_code.split('\n').length,
      commit: commitResult,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/dev/analyze — analýza modulu ──────────────────────────────

router.post('/analyze', async (req, res, next) => {
  try {
    const { module } = req.body;
    if (!module) return res.status(400).json({ error: 'Chybí module' });

    const result = await executeDevTool('analyze_module', { module });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
