// =============================================================================
// HolyOS — AI Orchestrátor
// Multi-agent routing s Anthropic SDK
// Fáze 4: MCP servery + Agent SDK
// =============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const { prisma } = require('../../config/database');

// ─── MCP Server registry (in-process) ─────────────────────────────────────
const { getWarehouseTools, executeWarehouseTool } = require('../../mcp-servers/warehouse-server');
const { getHrTools, executeHrTool } = require('../../mcp-servers/hr-server');
const { getProductionTools, executeProductionTool } = require('../../mcp-servers/production-server');
const { getTasksTools, executeTasksTool } = require('../../mcp-servers/tasks-server');

// ─── Mapování: agent slug → MCP servery (tools + executory) ────────────────
const AGENT_MCP_MAP = {
  mistr: {
    servers: ['production', 'warehouse'],
    getTools: () => [...getProductionTools(), ...getWarehouseTools()],
    execute: (tool, params) => {
      const prodTools = getProductionTools().map(t => t.name);
      if (prodTools.includes(tool)) return executeProductionTool(tool, params, prisma);
      return executeWarehouseTool(tool, params, prisma);
    },
  },
  personalista: {
    servers: ['hr'],
    getTools: () => getHrTools(),
    execute: (tool, params) => executeHrTool(tool, params, prisma),
  },
  skladnik: {
    servers: ['warehouse'],
    getTools: () => getWarehouseTools(),
    execute: (tool, params) => executeWarehouseTool(tool, params, prisma),
  },
  koordinator: {
    servers: ['tasks', 'hr', 'production'],
    getTools: () => [...getTasksTools(), ...getHrTools(), ...getProductionTools()],
    execute: (tool, params) => {
      const taskTools = getTasksTools().map(t => t.name);
      const hrTools = getHrTools().map(t => t.name);
      if (taskTools.includes(tool)) return executeTasksTool(tool, params, prisma);
      if (hrTools.includes(tool)) return executeHrTool(tool, params, prisma);
      return executeProductionTool(tool, params, prisma);
    },
  },
  technik: {
    servers: ['production'],
    getTools: () => getProductionTools(),
    execute: (tool, params) => executeProductionTool(tool, params, prisma),
  },
};

// ─── Intent Detection (rychlý routing přes Haiku) ──────────────────────────

const KEYWORD_MAP = {
  mistr:        /operac|postup|pracoviš|výrob|výrobek|polotovar|krok|fáze|stroj|cnc|fréz|soustruh|svař/i,
  personalista: /zaměstnan|docházk|dovolen|směn|oddělení|osob|pracovník|kolega|hr|nepřítom|přítom|absenc|nemoc/i,
  skladnik:     /materiál|sklad|zásob|objednáv|dodavat|odběrat|minimum|pod minim|zboží|firma|společnost/i,
  koordinator:  /plán|simulac|kapacit|termín|priorit|optimaliz|rozvrh|úkol|task|přiřad|delegov/i,
  technik:      /údržb|seříz|poruch|oprav|servis|preventiv|kalibrac/i,
};

const MODULE_ASSISTANT_MAP = {
  'pracovní postup':      'mistr',
  'programování výroby':  'mistr',
  'simulace výroby':      'koordinator',
  'lidé a hr':            'personalista',
  'nákup a sklad':        'skladnik',
};

/**
 * Rychlý keyword routing (synchronní, <1ms)
 */
function detectIntentByKeywords(message, currentModule) {
  if (currentModule) {
    const mapped = MODULE_ASSISTANT_MAP[currentModule.toLowerCase()];
    if (mapped) {
      for (const [slug, regex] of Object.entries(KEYWORD_MAP)) {
        if (slug !== mapped && regex.test(message)) return slug;
      }
      return mapped;
    }
  }
  for (const [slug, regex] of Object.entries(KEYWORD_MAP)) {
    if (regex.test(message)) return slug;
  }
  return 'mistr';
}

/**
 * AI-powered routing — Haiku rozhodne, kteří agenti mají zpracovat dotaz
 * Vrací pole agent slugů (může jich být víc pro multi-agent spolupráci)
 */
async function detectIntentByAI(client, message, assistants) {
  try {
    const agentList = assistants.map(a => `- ${a.slug}: ${a.role}`).join('\n');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `Jsi router v systému HolyOS. Urči, který agent(i) mají zpracovat dotaz.
Dostupní agenti:
${agentList}

Pravidla:
- Vrať JSON pole se slugy agentů, např. ["skladnik"] nebo ["skladnik","koordinator"]
- Pokud dotaz vyžaduje spolupráci více agentů, vrať více slugů
- Pokud si nejsi jistý, vrať ["mistr"]
- Vrať POUZE JSON pole, nic jiného`,
      messages: [{ role: 'user', content: message }],
    });

    const text = response.content[0]?.text?.trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (e) {
    // Fallback na keyword routing
  }
  return null;
}

// ─── Hlavní orchestrátor ────────────────────────────────────────────────────

/**
 * Zpracuje uživatelský dotaz přes multi-agent orchestraci
 *
 * @param {Object} options
 * @param {string} options.message - Uživatelský dotaz
 * @param {string} [options.currentModule] - Aktuální modul
 * @param {string} [options.assistantSlug] - Vynucený agent
 * @param {Array} [options.history] - Historie konverzace
 * @param {boolean} [options.enableMultiAgent] - Povolit multi-agent (default false)
 * @returns {Promise<Object>} Odpověď orchestrátoru
 */
async function processQuery(options) {
  const { message, currentModule, assistantSlug, history, enableMultiAgent = false } = options;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nakonfigurovaný');

  const client = new Anthropic({ apiKey });

  // 1. Načti dostupné asistenty z DB
  const assistants = await prisma.assistant.findMany({
    where: { is_active: true },
    include: {
      skills: { where: { skill: { is_active: true } }, include: { skill: true } },
    },
  });

  if (assistants.length === 0) {
    throw new Error('Žádní aktivní asistenti. Spusťte: node prisma/seed-assistants.js');
  }

  // 2. Urči agenta/agenty
  let agentSlugs;
  if (assistantSlug) {
    agentSlugs = [assistantSlug];
  } else if (enableMultiAgent) {
    // AI routing — může vrátit více agentů
    agentSlugs = await detectIntentByAI(client, message, assistants);
    if (!agentSlugs) agentSlugs = [detectIntentByKeywords(message, currentModule)];
  } else {
    agentSlugs = [detectIntentByKeywords(message, currentModule)];
  }

  // 3. Single agent — přímé zpracování
  if (agentSlugs.length === 1) {
    return runSingleAgent(client, agentSlugs[0], message, currentModule, history, assistants);
  }

  // 4. Multi-agent — paralelní zpracování + syntéza
  return runMultiAgent(client, agentSlugs, message, currentModule, history, assistants);
}

/**
 * Spustí jednoho agenta s tool_use loop
 */
async function runSingleAgent(client, slug, message, currentModule, history, allAssistants) {
  const assistant = allAssistants.find(a => a.slug === slug) || allAssistants[0];
  const mcpConfig = AGENT_MCP_MAP[slug] || AGENT_MCP_MAP.mistr;

  // Tools z MCP serveru
  const tools = mcpConfig.getTools();
  const config = assistant.config || {};
  const model = assistant.model || 'claude-haiku-4-5-20251001';
  const maxTokens = config.max_tokens || 2048;
  const temperature = config.temperature || 0.3;

  // Základní kontext
  const basicContext = await getBasicContext();

  // Sestav messages
  const messages = [];
  if (history && Array.isArray(history)) {
    history.slice(-10).forEach(msg => messages.push({ role: msg.role, content: msg.content }));
  }
  messages.push({
    role: 'user',
    content: `KONTEXT SYSTÉMU:\n${basicContext}\n\nMODUL: ${currentModule || 'hlavní stránka'}\n\nDOTAZ: ${message}`,
  });

  // Tool use loop (max 8 iterací)
  const toolsUsed = [];
  const sources = { tables: new Set(), recordCount: 0 };
  let maxIterations = 8;

  let result = await client.messages.create({
    model, max_tokens: maxTokens, temperature,
    system: assistant.system_prompt,
    tools: tools.length > 0 ? tools : undefined,
    messages,
  });

  while (result.stop_reason === 'tool_use' && maxIterations-- > 0) {
    // Může být více tool_use bloků v jedné odpovědi
    const toolUseBlocks = result.content.filter(c => c.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    // Spusť tools paralelně
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const startTime = Date.now();
        try {
          const toolResult = await mcpConfig.execute(block.name, block.input);
          const duration = Date.now() - startTime;
          toolsUsed.push({ name: block.name, input: block.input, status: 'success', duration });
          sources.tables.add(block.name);
          if (toolResult.count !== undefined) sources.recordCount += toolResult.count;
          if (toolResult.total_checked !== undefined) sources.recordCount += toolResult.total_checked;
          return { tool_use_id: block.id, content: JSON.stringify(toolResult) };
        } catch (err) {
          toolsUsed.push({ name: block.name, input: block.input, status: 'error', error: err.message });
          return { tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true };
        }
      })
    );

    // Pokračuj v konverzaci
    messages.push({ role: 'assistant', content: result.content });
    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: tr.content,
        ...(tr.is_error ? { is_error: true } : {}),
      })),
    });

    result = await client.messages.create({
      model, max_tokens: maxTokens, temperature,
      system: assistant.system_prompt,
      tools: tools.length > 0 ? tools : undefined,
      messages,
    });
  }

  const textBlock = result.content?.find(c => c.type === 'text');
  const reply = textBlock?.text || 'Omlouvám se, nedokázal jsem zpracovat odpověď.';

  return {
    ok: true,
    response: reply,
    assistant: { name: assistant.name, slug: assistant.slug, icon: config.icon || '🤖' },
    agents: [slug],
    toolsUsed: toolsUsed.map(t => t.name),
    sources: { skills: [...sources.tables], recordCount: sources.recordCount },
    mcpServers: mcpConfig.servers,
  };
}

/**
 * Multi-agent: spustí více agentů paralelně a syntetizuje odpovědi
 */
async function runMultiAgent(client, slugs, message, currentModule, history, allAssistants) {
  // Spusť agenty paralelně
  const results = await Promise.all(
    slugs.map(slug => runSingleAgent(client, slug, message, currentModule, history, allAssistants))
  );

  // Pokud jen 1 agent uspěl, vrať jeho odpověď
  const successful = results.filter(r => r.ok);
  if (successful.length === 0) return results[0]; // Vrať chybu
  if (successful.length === 1) return successful[0];

  // Syntéza odpovědí více agentů
  const agentResponses = successful.map(r =>
    `[${r.assistant.name}]: ${r.response}`
  ).join('\n\n---\n\n');

  const synthesisResponse = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    temperature: 0.2,
    system: `Jsi orchestrátor HolyOS. Dostal jsi odpovědi od více AI agentů na stejný dotaz.
Tvým úkolem je:
1. Syntetizovat odpovědi do jedné ucelené odpovědi
2. Zachovat všechna fakta a data z obou odpovědí
3. Odpovídat česky
4. Uvést, kteří agenti se podíleli na odpovědi`,
    messages: [{
      role: 'user',
      content: `Původní dotaz: "${message}"\n\nOdpovědi agentů:\n\n${agentResponses}`,
    }],
  });

  const synthesisText = synthesisResponse.content?.find(c => c.type === 'text')?.text;

  // Merge výsledků
  const allToolsUsed = successful.flatMap(r => r.toolsUsed);
  const allSources = successful.flatMap(r => r.sources.skills);
  const totalRecords = successful.reduce((sum, r) => sum + r.sources.recordCount, 0);
  const allServers = [...new Set(successful.flatMap(r => r.mcpServers))];

  return {
    ok: true,
    response: synthesisText || agentResponses,
    assistant: { name: 'Orchestrátor', slug: 'orchestrator', icon: '🧠' },
    agents: slugs,
    toolsUsed: allToolsUsed,
    sources: { skills: [...new Set(allSources)], recordCount: totalRecords },
    mcpServers: allServers,
    multiAgent: true,
  };
}

// ─── Helper: základní kontext ────────────────────────────────────────────────

async function getBasicContext() {
  const [people, companies, materials, orders, products, workstations] = await Promise.all([
    prisma.person.count({ where: { active: true } }),
    prisma.company.count({ where: { active: true } }),
    prisma.material.count({ where: { status: 'active' } }),
    prisma.order.count(),
    prisma.product.count(),
    prisma.workstation.count(),
  ]);

  return JSON.stringify({
    přehled: { zaměstnanci: people, firmy: companies, materiály: materials, objednávky: orders, výrobky: products, pracoviště: workstations },
    datum: new Date().toISOString().split('T')[0],
  });
}

module.exports = { processQuery, detectIntentByKeywords, AGENT_MCP_MAP };
