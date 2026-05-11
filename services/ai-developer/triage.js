// =============================================================================
// HolyOS — AI Vývojář / triage (preflight rozhodnutí PŘED coding loopem)
// =============================================================================
// Krátký Claude haiku call, který před plným coding agentem rozhodne,
// jestli má úkol smysl pouštět:
//   - ok                    → pokračuj na clone + coding loop
//   - needs_clarification   → AC vágní, agent posílá 1–3 otázky do task chatu
//   - stop                  → fundamentální problém (špatný target_repo,
//                              forbidden, db drop, …) → eskalace
//
// Cíl: nepálit tokeny na úkolech, kde je špatný target_repo nebo neúplné AC.
// Reference incident 2026-05-06: úkol #42 spálil 395 090 tokenů ve 39 retry
// pokusech, kde triage by ho zastavil v 1. cyklu za ~650 tokenů.
//
// Triage neklonuje repo — pracuje jen s task metadaty + repo metadaty.

const Anthropic = require('@anthropic-ai/sdk');

const TRIAGE_MODEL = process.env.AI_DEV_TRIAGE_MODEL || 'claude-haiku-4-5-20251001';
const TRIAGE_MAX_TOKENS = 600;

const SYSTEM_PROMPT = `Jsi triage AI pro HolyOS modul "AI Vývojář". Tvůj úkol: rozhodnout, zda zadaný úkol má dostatečný kontext, aby ho autonomní coding agent mohl provést v cílovém repu.

Triage NESMÍ klonovat repo, pracuje pouze s metadaty (název, URL, tech stack) a textem akceptačních kritérií.

VRAŤ POUZE jeden XML tag <triage_result>...</triage_result> obsahující JSON. Nic mimo tag, žádný markdown, žádný komentář.

Tvar JSON:
{
  "verdict": "ok" | "needs_clarification" | "stop",
  "reason": "krátké česky vysvětlení (1–2 věty)",
  "questions": ["otázka 1", "otázka 2"]
}

VERDIKTY:
- "ok" — AC jsou dostatečně konkrétní, repo dává smysl pro tento typ změny, agent může začít. questions = [].
- "needs_clarification" — AC je vágní, chybí klíčový detail, ale úkol je v principu řešitelný. questions = 1–3 konkrétní české otázky pro zadavatele.
- "stop" — fundamentální problém: špatný target_repo, nesplnitelné AC, sahá na forbidden, požadavek nedává smysl. Eskaluj na člověka. questions = [].

PRAVIDLA PRO ROZHODOVÁNÍ:
1. Pokud AC má méně než 20 znaků → needs_clarification.
2. Pokud AC mluví o modulu / featuře, který repo evidentně nemá podle názvu a tech stacku (např. "uprav HR modul" v repu "holyos-ai-playground" — sandbox repa nemají HolyOS moduly) → stop, do reason napiš, který repo by se hodil víc.
3. Pokud AC žádá změnu .env / prisma/migrations / secrets / *.key|*.pem → stop (forbidden).
4. Pokud AC žádá force push, změnu autentizační logiky, DROP / TRUNCATE / DELETE FROM bez WHERE → stop.
5. Jinak ok.

PRIORITIZACE V NEJISTOTĚ:
- Mezi "needs_clarification" a "ok" → preferuj "ok" (agent si poradí, ať jsou tokeny dobře využité).
- Mezi "stop" a "needs_clarification" → preferuj "needs_clarification" (dej zadavateli šanci doplnit).`;

function buildUserMessage(task, repo) {
  const desc = (task.description || '(bez popisu)').slice(0, 1500);
  const ac = task.acceptance_criteria || '(prázdné)';
  const tech = repo.tech_stack ? JSON.stringify(repo.tech_stack) : '{}';
  return `ÚKOL #${task.id}: ${task.page_title || '(bez názvu)'}

POPIS:
${desc}

AKCEPTAČNÍ KRITÉRIA:
${ac}

CÍLOVÝ REPO:
- Název: ${repo.name}
- URL: ${repo.git_url}
- Default branch: ${repo.default_branch || 'main'}
- Tech stack: ${tech}

Vrať <triage_result>{...}</triage_result>.`;
}

function parseTriageResult(text) {
  const m = text.match(/<triage_result>([\s\S]*?)<\/triage_result>/i);
  const candidate = m ? m[1].trim() : text.trim();
  // Robustnost: někdy haiku obalí JSON do code fences ```json ... ```
  const cleaned = candidate
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/**
 * runTriage — krátký Claude haiku call, vrátí verdict + reason + questions.
 *
 * @param {object} task — AdminTask (page_title, description, acceptance_criteria)
 * @param {object} repo — AgentRepo (name, git_url, default_branch, tech_stack)
 * @returns {Promise<{verdict: 'ok'|'needs_clarification'|'stop', reason: string, questions: string[], tokensUsed: number}>}
 *
 * Při jakékoli chybě (síť, parser, ...) raději vrací verdict='ok' s reason
 * popisujícím chybu — chceme, aby coding loop dostal šanci, ne abychom úkol
 * zablokovali kvůli vlastnímu bugu v triage. Stávající "no-changes" safety
 * net v runner.js zachytí případy, kde agent stejně nic neprovede.
 */
async function runTriage({ task, repo }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY chybí — triage nelze spustit');
  }
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: TRIAGE_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: buildUserMessage(task, repo) },
    ],
  });

  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    return {
      verdict: 'ok',
      reason: 'Triage: Claude vrátil žádný text blok (fallback ok).',
      questions: [],
      tokensUsed,
    };
  }

  let parsed;
  try {
    parsed = parseTriageResult(textBlock.text);
  } catch (err) {
    return {
      verdict: 'ok',
      reason: `Triage parser fail (fallback ok): ${err.message}`,
      questions: [],
      tokensUsed,
      raw: textBlock.text.slice(0, 500),
    };
  }

  // Validace verdiktu (cokoliv mimo whitelist → ok fallback)
  const verdict = ['ok', 'needs_clarification', 'stop'].includes(parsed.verdict)
    ? parsed.verdict
    : 'ok';

  return {
    verdict,
    reason: String(parsed.reason || '').slice(0, 1000),
    questions: Array.isArray(parsed.questions)
      ? parsed.questions
          .map((q) => String(q || '').slice(0, 500))
          .filter(Boolean)
          .slice(0, 5)
      : [],
    tokensUsed,
  };
}

module.exports = {
  runTriage,
  TRIAGE_MODEL,
};
