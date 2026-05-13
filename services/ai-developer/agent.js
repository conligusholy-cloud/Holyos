// =============================================================================
// HolyOS — AI Vývojář / Claude tool-use agent (Anthropic SDK)
// =============================================================================
// Minimální in-process Claude agent pro Fázi 1. Žádný Claude Code CLI a žádný
// Docker — pracuje přímo v daném pracovním adresáři přes path-confined fs API.
// Tools: list_files, read_file, write_file, run_shell, finish.
//
// Volání: runAgent({ workdir, task, repo, settings, onEvent }) → { summary, tokensUsed, fileChanges }

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { messagesCreate } = require('../anthropic-retry');

const MODEL = process.env.AI_DEV_MODEL || 'claude-sonnet-4-6';
const MAX_TURNS = parseInt(process.env.AI_DEV_MAX_TURNS || '18', 10);
// 16 384 — výrazně více než 4 096, ať write_file velkého souboru (např. routes/*.js
// ~30–50 kB) projde v jednom turnu bez useknutí. Důvod: stop_reason='max_tokens'
// uřízne tool_use blok mid-content, agent.js to pak nesprávně interpretoval jako
// "skončil bez finish()" a celý běh zhavaroval (#49, 12.5.2026: 288k tokens, 0 commitů).
const MAX_TOKENS_PER_TURN = parseInt(process.env.AI_DEV_MAX_TOKENS_PER_TURN || '16384', 10);
// Hard cap na input tokens per run — pojistka proti runaway loopu, kdyby stagnation
// detection selhala. 800k * Sonnet input ~$3/M = max $2.40 na run.
const MAX_INPUT_TOKENS_PER_RUN = parseInt(process.env.AI_DEV_MAX_INPUT_TOKENS || '800000', 10);
// Po kolika turnech bez file_change pošleme stagnation nudge.
const STAGNATION_TURNS = parseInt(process.env.AI_DEV_STAGNATION_TURNS || '3', 10);
const MAX_READ_BYTES = 200_000;

// Forbidden paths — agent je nesmí číst ani psát.
//
// Primární zdroj: AgentRule tabulka (kind='forbidden', scope='path_pattern')
// načtená runnerem per-run a předaná do runAgent jako `rules` parametr. Tento
// HARDCODED_FORBIDDEN_FALLBACK se používá *jen* když rules pole je prázdné —
// typicky při selhání DB load nebo dokud někdo nesmaže všechna pravidla z UI.
// Bezpečnostní safety net, ať agent nikdy nemůže měnit .env apod. bez ohledu
// na stav DB.
const HARDCODED_FORBIDDEN_FALLBACK = [
  { id: 'hardcoded:env', value: '(^|/)\\.env(\\.|$)' },
  { id: 'hardcoded:secrets', value: '(^|/)secrets/' },
  { id: 'hardcoded:keys', value: '\\.(key|pem)$' },
  { id: 'hardcoded:migrations', value: '(^|/)migrations/' },
  { id: 'hardcoded:node_modules', value: '(^|/)node_modules/' },
  { id: 'hardcoded:dotgit', value: '\\.git/' },
];

// Backward compatibility export: FORBIDDEN_PATTERNS jako array regexů
// (některé starší volání může počítat s nimi přímo).
const FORBIDDEN_PATTERNS = HARDCODED_FORBIDDEN_FALLBACK.map(
  (r) => new RegExp(r.value, 'i')
);

// Whitelist příkazů pro run_shell. Cokoli mimo whitelist se odmítne.
const SHELL_WHITELIST = [
  /^npm\s+(test|run\s+lint|run\s+test|run\s+build)\b/,
  /^npx\s+(eslint|prettier|vitest|tsc)\b/,
  /^node\s+--check\s+/,
  /^pnpm\s+(test|lint|build)\b/,
  /^yarn\s+(test|lint|build)\b/,
];

// Factory — vrací checker `(relPath) => null | { rule_id, value }`.
// Pokud `rules` je prázdné / null, použije HARDCODED_FORBIDDEN_FALLBACK
// (safety net). Každé pravidlo se zkompiluje jako case-insensitive regex.
// Volá se 1× při startu runu (runner) — výsledek se předá do runAgent
// přes closure a používá v každém read/write/list tool callu.
function buildForbiddenChecker(rules) {
  const source = (Array.isArray(rules) && rules.length > 0)
    ? rules
    : HARDCODED_FORBIDDEN_FALLBACK;
  const compiled = source.map((r) => {
    try {
      return { id: r.id, value: r.value, re: new RegExp(r.value, 'i') };
    } catch (e) {
      console.error(`[ai-dev] AgentRule id=${r.id} má nevalidní regex "${r.value}": ${e.message}`);
      return null;
    }
  }).filter(Boolean);

  return function check(relPath) {
    const norm = String(relPath || '').replace(/\\/g, '/');
    for (const rule of compiled) {
      if (rule.re.test(norm)) {
        return { rule_id: rule.id, value: rule.value };
      }
    }
    return null;
  };
}

// Backward-compat boolean varianta (legacy callsites, hardcoded fallback).
function isForbidden(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  return FORBIDDEN_PATTERNS.some((re) => re.test(norm));
}

function safeJoin(workdir, relPath) {
  const target = path.resolve(workdir, relPath);
  if (!target.startsWith(path.resolve(workdir))) {
    throw new Error(`Path traversal blokována: ${relPath}`);
  }
  return target;
}

const TOOLS = [
  {
    name: 'list_files',
    description: 'Vrátí seznam souborů a adresářů v daném relativním adresáři repa. Pro root použij ".".',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relativní cesta v repu, např. "src" nebo "."' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Přečte obsah souboru (UTF-8). Maximum 200 kB. Forbidden: .env*, secrets/, migrations/, node_modules/.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Zapíše obsah do souboru (UTF-8). Vytvoří adresářovou strukturu, pokud chybí. Stejné forbidden jako read_file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_shell',
    description: 'Spustí povolený shell příkaz v repu. Whitelist: npm test/run lint/build, npx eslint/prettier/vitest/tsc, node --check, pnpm/yarn test/lint/build.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Celý příkaz včetně argumentů' },
      },
      required: ['command'],
    },
  },
  {
    name: 'finish',
    description: 'Volej, jakmile jsou všechny změny hotové, otestované a připravené ke commitu. Předej krátké shrnutí pro PR description.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Krátký český popis (4–6 vět) co bylo uděláno a proč' },
      },
      required: ['summary'],
    },
  },
];

async function execTool(name, input, workdir, forbiddenCheck) {
  // forbiddenCheck je vždy z buildForbiddenChecker (z DB pravidel) — runAgent
  // ho dodá přes closure. Vrací null | { rule_id, value } — pokud non-null,
  // vracíme error s rule_id, aby tool_call event v audit logu věděl, který
  // pravidlo to zablokovalo (runner pak inkrementuje rule.blocked_count).
  switch (name) {
    case 'list_files': {
      const hit = forbiddenCheck(input.path);
      if (hit) return { error: 'Cesta je zakázaná (forbidden_pattern).', rule_id: hit.rule_id, pattern: hit.value };
      const dir = safeJoin(workdir, input.path);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const list = entries
        .filter((e) => !forbiddenCheck(path.join(input.path, e.name)))
        .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
      return { entries: list };
    }
    case 'read_file': {
      const hit = forbiddenCheck(input.path);
      if (hit) return { error: 'Cesta je zakázaná (forbidden_pattern).', rule_id: hit.rule_id, pattern: hit.value };
      const file = safeJoin(workdir, input.path);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) return { error: 'Soubor neexistuje.' };
      if (stat.size > MAX_READ_BYTES) {
        return { error: `Soubor je moc velký (${stat.size} B, limit ${MAX_READ_BYTES} B).` };
      }
      const content = await fs.readFile(file, 'utf-8');
      return { content };
    }
    case 'write_file': {
      const hit = forbiddenCheck(input.path);
      if (hit) return { error: 'Cesta je zakázaná (forbidden_pattern).', rule_id: hit.rule_id, pattern: hit.value };
      const file = safeJoin(workdir, input.path);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, input.content, 'utf-8');
      return { ok: true, bytes: Buffer.byteLength(input.content, 'utf-8') };
    }
    case 'run_shell': {
      const cmd = String(input.command || '').trim();
      const allowed = SHELL_WHITELIST.some((re) => re.test(cmd));
      if (!allowed) return { error: `Příkaz mimo whitelist: ${cmd}` };
      return new Promise((resolve) => {
        const child = spawn('sh', ['-c', cmd], {
          cwd: workdir,
          env: { ...process.env, NO_COLOR: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('close', (code) => {
          // Trim výstupu — Claude nepotřebuje megabajty výstupu
          const trim = (s) => s.length > 8000 ? s.slice(0, 4000) + '\n...[truncated]...\n' + s.slice(-4000) : s;
          resolve({ exit_code: code, stdout: trim(stdout), stderr: trim(stderr) });
        });
        // 5 minut timeout
        setTimeout(() => { try { child.kill(); } catch (_) {} }, 5 * 60_000);
      });
    }
    case 'finish':
      return { ok: true };
    default:
      return { error: `Neznámý tool: ${name}` };
  }
}

function buildSystemPrompt(task, repo, presetPlan = null) {
  let prompt = `Jsi "Alan, AI Vývojář" — autonomní agent v HolyOS. Pracuješ v naklonovaném repu ${repo.name} (${repo.git_url}).

ÚKOL #${task.id}:
${task.page_title || '(bez názvu)'}

POPIS:
${task.description || '(bez popisu)'}

AKCEPTAČNÍ KRITÉRIA:
${task.acceptance_criteria || '(nestanovena — zeptej se přes finish s ohlášením, že chybí AC)'}

POSTUP:
1. Prozkoumej strukturu repa pomocí list_files / read_file (max 5–8 kol).
2. Najdi soubory, které je potřeba změnit nebo vytvořit.
3. Proveď změny pomocí write_file.
4. Pokud existují testy nebo lintery, spusť je přes run_shell (whitelist: npm test, npm run lint, npm run build, npx eslint, npx prettier).
5. JAKMILE tvoje write_file změny pokrývají všechna AC, ZAVOLEJ finish() OKAMŽITĚ.
   Shrnutí česky, 4–6 vět pro PR description. NEPOKRAČUJ v exploring po dokončení.

KRITICKÉ PRAVIDLO COST AWARENESS:
- Každý turn = celá historie znovu přes drahý Sonnet model. Zbytečné read_file po
  dokončení změn pálí peníze majitele (1 turn ≈ $0.10–$0.50 na Tier 2).
- Pokud si nejsi 100% jistý, jestli jsi hotov, finish() RADŠI BRZO s tím co máš.
  Review udělá člověk; nedotažené detaily se dají dořešit v dalším úkolu.
- Po 3 turnech bez write_file dostaneš nudge — pak okamžitě finish, nebo udělej
  konkrétní write_file (žádné další list_files).

PRAVIDLA:
- NIKDY neměň: .env*, secrets/, *.key, *.pem, prisma/migrations/, node_modules/.
- Drž se akceptačních kritérií, neexpanduj scope.
- Pokud zadání nedává smysl, volej finish s vysvětlením, co chybí. Lidský operátor to převezme.
- Žádné force push, žádné mazání cizích souborů, žádný npm install nových balíčků.
- Maximum ${MAX_TURNS} kol nástrojů. Buď rychlý a konkrétní.

REPO TECH STACK:
${JSON.stringify(repo.tech_stack || {}, null, 2)}`;

  if (presetPlan) {
    prompt += `\n\n══════════════════════════════════════════════════════\n`;
    prompt += `SCHVÁLENÝ PLÁN (od planneru, schváleno super-adminem):\n`;
    prompt += `══════════════════════════════════════════════════════\n`;
    prompt += JSON.stringify(presetPlan, null, 2);
    prompt += `\n\nDrž se tohoto plánu. Pokud potřebuješ udělat něco mimo plán, ` +
              `volej finish() s vysvětlením proč — lidský operátor to dořeší. ` +
              `Nedělej věci nad rámec plánu bez explicitního důvodu.`;
  }

  return prompt;
}

/**
 * Hlavní entry point — spustí Claude tool-use loop a vrátí výsledek.
 *
 * @param {object} opts.rules - Pole AgentRule záznamů typu forbidden+path_pattern
 *   z DB (načtené runnerem). Pokud prázdné/undefined, použije se hardcoded
 *   fallback. Checker se vyrábí 1× per run a používá se v každém tool callu.
 */
async function runAgent({ workdir, task, repo, rules, presetPlan, onEvent }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY chybí — agent nelze spustit');
  }
  const client = new Anthropic({ apiKey });

  // Vyrobíme forbidden checker z DB pravidel (nebo hardcoded fallbacku).
  // Předáme ho do execTool přes closure — žádné per-call DB volání.
  const forbiddenCheck = buildForbiddenChecker(rules);

  const messages = [
    { role: 'user', content: 'Začni — prozkoumej repo a implementuj úkol.' },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let summary = null;
  let _finishNudgeSent = false;
  let _stagnationNudgeSent = false;
  let _finishCalledAny = false;
  let lastFileChangeTurn = -1;
  const fileChanges = new Set();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await messagesCreate(client, {
      model: MODEL,
      max_tokens: MAX_TOKENS_PER_TURN,
      system: buildSystemPrompt(task, repo, presetPlan),
      tools: TOOLS,
      messages,
    }, { label: 'ai-dev/agent' });

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    // VRSTVA 2 — Token budget guard. Pokud agent přeskočí ekonomickou hranici,
    // okamžitě přerušíme. Runner pak otevře PR pokud existují file_changes.
    if (totalInputTokens > MAX_INPUT_TOKENS_PER_RUN) {
      summary = summary ||
        'Token budget vyčerpán (' + totalInputTokens + '/' + MAX_INPUT_TOKENS_PER_RUN +
        ' input tokens). PR otevřen pokud existují file_changes.';
      if (onEvent) {
        await onEvent('decision', {
          action: 'token_budget_exceeded',
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          file_changes: fileChanges.size,
        });
      }
      break;
    }

    if (onEvent) {
      await onEvent('llm_message', {
        turn,
        stop_reason: response.stop_reason,
        text_blocks: response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text),
        tool_uses: response.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ name: b.name, input: b.input })),
        usage: response.usage,
      });
    }

    // Přidej assistant turn do messages
    messages.push({ role: 'assistant', content: response.content });

    // stop_reason='max_tokens' znamená, že odpověď byla useknutá kvůli limitu —
    // tool_use blok je neúplný (např. write_file s mid-content cutoff).
    //
    // KRITICKÉ: Anthropic API vyžaduje, aby user message PO assistant message
    // s tool_use obsahovala tool_result pro KAŽDÉ tool_use_id. Jinak vrátí
    // 400 invalid_request_error. Takže nestačí poslat jen text nudge —
    // musíme nejdřív poslat is_error tool_result pro každý neúplný tool_use
    // a pak druhý user message s textovým nudge.
    if (response.stop_reason === 'max_tokens') {
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        messages.push({
          role: 'user',
          content: toolUseBlocks.map((b) => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content:
              'Tool nemohl být proveden — tvoje odpověď byla useknutá na max_tokens (' +
              MAX_TOKENS_PER_TURN +
              ' output tokenů). Rozděl výstup na menší kusy a zkus znovu.',
            is_error: true,
          })),
        });
      }
      messages.push({
        role: 'user',
        content:
          'Tvoje předchozí odpověď byla useknutá kvůli limitu max_tokens (' +
          MAX_TOKENS_PER_TURN +
          '). Tool_use bloky v ní nebyly dokončeny a nemohly se provést. ' +
          'Pokračuj — pokud potřebuješ napsat velký soubor, rozděl write_file ' +
          'na menší úseky (po sekcích) nebo nahraď jen klíčové změny místo ' +
          'celého obsahu. Až budeš mít všechny změny hotové, zavolej finish().',
      });
      if (onEvent) {
        await onEvent('decision', {
          action: 'max_tokens_recovery',
          turn,
          truncated_tool_uses: toolUseBlocks.length,
          note: 'Předchozí turn useknut, posílám nudge.',
        });
      }
      continue;
    }

    if (response.stop_reason !== 'tool_use') {
      // Sonnet vrátil text bez tool_use (end_turn / stop_sequence) — buď je
      // přesvědčen, že je hotov ale zapomněl finish(), nebo si není jistý.
      // Pošli jednorázový nudge; pokud i další turn skončí bez tool_use,
      // bereme to jako neúspěch.
      if (!_finishNudgeSent) {
        _finishNudgeSent = true;
        messages.push({
          role: 'user',
          content:
            'Skončil jsi turn bez volání žádného nástroje. Pokud jsi hotov, ' +
            'zavolej finish() s česky napsaným shrnutím změn (4–6 vět) pro PR ' +
            'description. Pokud ještě hotov nejsi, pokračuj s tool callem ' +
            '(write_file, read_file, run_shell). Žádný čistě textový turn už ' +
            'nedělej.',
        });
        if (onEvent) {
          await onEvent('decision', {
            action: 'no_tool_nudge',
            turn,
            note: 'Sonnet skončil bez tool_use, posílám připomenutí finish().',
          });
        }
        continue;
      }
      // I po nudge zase bez tool_use — vzdáváme to.
      summary = summary || 'Agent skončil bez volání finish() i po nudge.';
      break;
    }

    // Spusť všechny tool_use bloky a sestav tool_result
    const toolResults = [];
    let finishCalled = false;

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      let result;
      try {
        result = await execTool(block.name, block.input || {}, workdir, forbiddenCheck);
      } catch (e) {
        result = { error: e.message || String(e) };
      }

      // Pokud forbidden checker zachytil hit, zaloguj jako rule_blocked event
      // — runner pak může incrementnout AgentRule.blocked_count statistiku.
      if (result && result.rule_id && onEvent) {
        await onEvent('rule_blocked', {
          rule_id: result.rule_id,
          pattern: result.pattern,
          tool: block.name,
          path: block.input && block.input.path,
        });
      }

      if (onEvent) {
        await onEvent('tool_call', {
          tool: block.name,
          input: block.input,
          result_preview: typeof result === 'object'
            ? Object.keys(result).reduce((acc, k) => {
                const v = result[k];
                acc[k] = (typeof v === 'string' && v.length > 200) ? v.slice(0, 200) + '…' : v;
                return acc;
              }, {})
            : result,
        });
      }

      if (block.name === 'write_file' && result?.ok) {
        fileChanges.add(block.input.path);
        lastFileChangeTurn = turn;
        if (onEvent) await onEvent('file_change', { path: block.input.path, bytes: result.bytes });
      }

      if (block.name === 'finish') {
        finishCalled = true;
        _finishCalledAny = true;
        summary = (block.input && block.input.summary) || 'Hotovo.';
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });

    if (finishCalled) break;

    // VRSTVA 1 — Stagnation detection.
    // Agent legitimně exploruje na začátku (read_file / list_files), pak by měl
    // udělat changes a finishovat. Pokud po prvním write_file proběhly STAGNATION_TURNS
    // kol bez další změny, je vysoká pravděpodobnost že je hotov ale jen exploruje.
    // Pošleme mu jasný signál.
    if (
      !_stagnationNudgeSent &&
      lastFileChangeTurn >= 0 &&
      turn - lastFileChangeTurn >= STAGNATION_TURNS
    ) {
      _stagnationNudgeSent = true;
      messages.push({
        role: 'user',
        content:
          'Posledních ' + STAGNATION_TURNS + ' kol jsi neudělal žádnou změnu souboru. ' +
          'Pokud jsi splnil akceptační kritéria, zavolej OKAMŽITĚ finish() s česky ' +
          'napsaným shrnutím (4–6 vět) pro PR description. Nepokračuj v dalším ' +
          'exploring — pálíš peníze majitele. Pokud máš ještě jednu konkrétní ' +
          'změnu, popiš ji jednou větou a hned ji udělej write_file callem.',
      });
      if (onEvent) {
        await onEvent('decision', {
          action: 'stagnation_nudge',
          turn,
          last_file_change_turn: lastFileChangeTurn,
          stagnant_turns: turn - lastFileChangeTurn,
        });
      }
    }
  }

  if (!summary) {
    summary = 'Agent dosáhl maxima ' + MAX_TURNS + ' kol bez dokončení.';
  }

  return {
    summary,
    finishCalled: _finishCalledAny,
    tokensUsed: totalInputTokens + totalOutputTokens,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    fileChanges: Array.from(fileChanges),
  };
}

module.exports = {
  runAgent,
  isForbidden,
  buildForbiddenChecker,
  FORBIDDEN_PATTERNS,
  HARDCODED_FORBIDDEN_FALLBACK,
  SHELL_WHITELIST,
  TOOLS,
};
