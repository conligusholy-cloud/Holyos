// =============================================================================
// HolyOS — AI Vývojář / planner (proactive plánovací approval workflow)
// =============================================================================
// Po clone repa, PŘED coding loopem. Krátký Sonnet tool-use call (jen read-only:
// list_files + read_file, žádné write/shell) → strukturovaný plán v JSON.
// Plán prochází AgentApproval(kind='plan_review') pokud autonomy != 'full_auto'
// nebo pokud planner sám označí plán jako vysoké riziko.
//
// Cíl: Tomáš schvaluje *plán*, ne nárazové rule hity v coding loopu. Tokeny
// na planning ~5-10k (Sonnet, ~5 turns); coding loop pak běží jen pro schválené
// plány. Pokud plán neprojde approval, ušetří se ~30k coding tokenů.
//
// Output JSON v <plan>...</plan> tagu:
// {
//   "summary": "krátký český popis co plán dělá",
//   "files_to_change": [{ "path": "...", "action": "create|modify|delete", "reason": "..." }],
//   "tests_to_run": ["npm test", ...],
//   "risk_level": "low|medium|high",
//   "risk_reasoning": "proč to riziko je takové",
//   "affected_areas": ["modul HR", "API routes", ...],
//   "estimated_complexity": "small|medium|large",
//   "requires_approval": true|false   // planner sám rozhodne — true pokud high risk / DB / auth / payment
// }

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs/promises');
const path = require('path');

const PLANNER_MODEL = process.env.AI_DEV_PLANNER_MODEL || process.env.AI_DEV_MODEL || 'claude-sonnet-4-6';
const PLANNER_MAX_TURNS = 8;
const PLANNER_MAX_TOKENS_PER_TURN = 4096;
const MAX_READ_BYTES = 200_000;

const TOOLS = [
  {
    name: 'list_files',
    description: 'Vrátí seznam souborů a adresářů v relativním adresáři repa. Pro root použij ".".',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Přečte obsah souboru (UTF-8, max 200 kB). Forbidden cesty (.env, secrets, migrations, ...) jsou odmítnuté.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'submit_plan',
    description: 'Odešli finální plán jako JSON. Volej až máš dost kontextu z list_files / read_file (max 8 kol celkem).',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Krátký český popis (1-2 věty) co plán dělá' },
        files_to_change: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              action: { type: 'string', enum: ['create', 'modify', 'delete'] },
              reason: { type: 'string' },
            },
            required: ['path', 'action', 'reason'],
          },
        },
        tests_to_run: { type: 'array', items: { type: 'string' } },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
        risk_reasoning: { type: 'string' },
        affected_areas: { type: 'array', items: { type: 'string' } },
        estimated_complexity: { type: 'string', enum: ['small', 'medium', 'large'] },
        requires_approval: { type: 'boolean', description: 'true pokud plán vyžaduje schválení (high risk / DB / auth / payment / migrations)' },
      },
      required: ['summary', 'files_to_change', 'risk_level', 'requires_approval'],
    },
  },
];

function safeJoin(workdir, relPath) {
  const target = path.resolve(workdir, relPath);
  if (!target.startsWith(path.resolve(workdir))) {
    throw new Error(`Path traversal blokována: ${relPath}`);
  }
  return target;
}

async function execTool(name, input, workdir, forbiddenCheck) {
  switch (name) {
    case 'list_files': {
      const hit = forbiddenCheck(input.path);
      if (hit) return { error: 'Cesta je zakázaná (forbidden_pattern).', rule_id: hit.rule_id };
      const dir = safeJoin(workdir, input.path);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const list = entries
        .filter((e) => !forbiddenCheck(path.join(input.path, e.name)))
        .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
      return { entries: list };
    }
    case 'read_file': {
      const hit = forbiddenCheck(input.path);
      if (hit) return { error: 'Cesta je zakázaná (forbidden_pattern).', rule_id: hit.rule_id };
      const file = safeJoin(workdir, input.path);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) return { error: 'Soubor neexistuje.' };
      if (stat.size > MAX_READ_BYTES) {
        return { error: `Soubor je moc velký (${stat.size} B, limit ${MAX_READ_BYTES} B).` };
      }
      const content = await fs.readFile(file, 'utf-8');
      return { content };
    }
    case 'submit_plan':
      return { ok: true };
    default:
      return { error: `Neznámý tool: ${name}` };
  }
}

function buildSystemPrompt(task, repo) {
  return `Jsi "Alan, AI Vývojář" — autonomní agent v HolyOS, fáze PLÁNOVÁNÍ.

ÚKOL #${task.id}:
${task.page_title || '(bez názvu)'}

POPIS:
${task.description || '(bez popisu)'}

AKCEPTAČNÍ KRITÉRIA:
${task.acceptance_criteria || '(bez AC)'}

CÍLOVÝ REPO:
- Název: ${repo.name}
- Default branch: ${repo.default_branch || 'main'}
- Tech stack: ${JSON.stringify(repo.tech_stack || {})}

POSTUP:
1. Prozkoumej strukturu repa přes list_files (root + relevantní adresáře).
2. Přečti klíčové soubory přes read_file (README, package.json, případně 1-3 soubory které budeš měnit).
3. Sestav plán a zavolej submit_plan() s JSON.

PRAVIDLA PRO submit_plan:
- Buď konkrétní: které soubory přesně, jakou akcí (create/modify/delete), proč.
- risk_level: "high" pokud plán sahá na DB schema/migrace, auth, payment flow, secrets, deployment configy. "medium" pokud mění sdílené komponenty nebo více modulů. Jinak "low".
- requires_approval: true vždy když risk_level=high; jinak false (nech runneru rozhodnout podle autonomy mode).
- Maximum ${PLANNER_MAX_TURNS} kol nástrojů — buď efektivní.
- NIKDY nevolej write_file (tu nemáš), tvoje role je jen číst a plánovat. Coding loop přijde po schválení plánu.`;
}

/**
 * runPlanner — krátký tool-use Claude call, vrátí plán + tokens used.
 *
 * @param {object} opts
 * @param {string} opts.workdir
 * @param {object} opts.task
 * @param {object} opts.repo
 * @param {Function} opts.forbiddenCheck - z buildForbiddenChecker(rules)
 * @param {Function} opts.onEvent - per-turn logger
 * @returns {Promise<{ plan: object|null, tokensUsed: number, reason: string }>}
 *
 * Při chybě (síť, parser) vrací plan=null + reason — runner pak fallbackne
 * na bez-plánu coding loop (status zůstane v 'planning', logged warning).
 */
async function runPlanner({ workdir, task, repo, forbiddenCheck, onEvent }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY chybí — planner nelze spustit');
  }
  const client = new Anthropic({ apiKey });

  const messages = [
    { role: 'user', content: 'Začni — prozkoumej repo a navrhni plán pro tento úkol.' },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let plan = null;

  for (let turn = 0; turn < PLANNER_MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: PLANNER_MODEL,
      max_tokens: PLANNER_MAX_TOKENS_PER_TURN,
      system: buildSystemPrompt(task, repo),
      tools: TOOLS,
      messages,
    });

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    if (onEvent) {
      await onEvent('llm_message', {
        phase: 'planning',
        turn,
        stop_reason: response.stop_reason,
        tool_uses: response.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ name: b.name, input_keys: Object.keys(b.input || {}) })),
        usage: response.usage,
      });
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      break;
    }

    const toolResults = [];
    let submitted = false;

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      let result;
      try {
        result = await execTool(block.name, block.input || {}, workdir, forbiddenCheck);
      } catch (e) {
        result = { error: e.message || String(e) };
      }

      if (onEvent) {
        await onEvent('tool_call', {
          phase: 'planning',
          tool: block.name,
          input: block.input,
        });
      }

      if (block.name === 'submit_plan') {
        submitted = true;
        plan = block.input || null;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });

    if (submitted) break;
  }

  return {
    plan,
    tokensUsed: totalInputTokens + totalOutputTokens,
    reason: plan ? 'OK' : `Plán neodevzdán po ${PLANNER_MAX_TURNS} kolech`,
  };
}

module.exports = {
  runPlanner,
  PLANNER_MODEL,
};
