// =============================================================================
// HolyOS — AI Vývojář / suitability scoring (Fáze 4)
// =============================================================================
// Claude haiku ohodnotí AdminTask 0-100 podle vhodnosti pro AI Vývojáře.
// Volá se asynchronně z POST /api/admin-tasks po vytvoření tasku (nebo manuálně
// přes 'Vyhodnotit pro AI' tlačítko). Výsledek do task.ai_suitability_score /
// _reasoning / _at. UI v admin-tasks ukazuje barevný badge na kartě.

const Anthropic = require('@anthropic-ai/sdk');

const SUITABILITY_MODEL = process.env.AI_DEV_SUITABILITY_MODEL || 'claude-haiku-4-5-20251001';
const SUITABILITY_MAX_TOKENS = 400;

const SYSTEM_PROMPT = `Jsi triage AI pro HolyOS. Hodnotíš, jak vhodný je daný úkol pro autonomního AI Vývojáře (Claude Sonnet agent, který klonuje GitHub repo, edituje kód, otevírá PR).

VRAŤ POUZE JSON v <suitability>...</suitability> tagu:
{
  "score": 0-100,
  "reasoning": "krátké česky (1-2 věty) proč",
  "recommended_change_type": "documentation|ui_change|bug_fix|refactor|new_feature|integration|data_migration" | null,
  "recommended_autonomy": "full_auto|pr_review|plan_review" | null
}

PRAVIDLA PRO SCORE:
- 80-100 (VYSOKÁ vhodnost): konkrétní popis, dobře vymezený rozsah, jeden modul, technický úkol (přidej tlačítko, refactor funkce, doplň test, README/docs, drobný UI). Autonomy obvykle full_auto nebo pr_review.
- 50-79 (STŘEDNÍ vhodnost): popis OK ale vyžaduje pochopení kontextu nebo víc modulů. Multi-file change, integrace. Autonomy obvykle pr_review.
- 20-49 (NÍZKÁ vhodnost): vágní zadání, vyžaduje doptávání, nebo zasahuje na sdílené komponenty / DB schema / auth. Autonomy obvykle plan_review nebo lepší přiřadit člověku.
- 0-19 (NEVHODNÉ): operational/manuální úkol (např. "zkontroluj logy", "zavolej dodavatele", "nastav cron job"), strategické rozhodnutí, design ("redesignuj UI"), požadavek mimo software ("najmout konzultanta").

PŘÍKLADY:
- "Přidej README sekci o licencování" → 90 (documentation, full_auto)
- "Oprav bug že tabulka neukazuje sloupec X" → 75 (bug_fix, pr_review)
- "Refactoruj auth middleware" → 35 (auth = high risk, plan_review)
- "Najmout nového programátora" → 5 (mimo software)
- "Předělej celý nákup-sklad modul" → 25 (moc velký scope, vágní)`;

function buildUserMessage(task) {
  return `ÚKOL #${task.id}: ${task.page_title || '(bez názvu)'}

POPIS:
${(task.description || '(bez popisu)').slice(0, 2000)}

AKCEPTAČNÍ KRITÉRIA:
${task.acceptance_criteria || '(prázdné)'}

KONTEXT:
- Stránka: ${task.page || '(neuvedeno)'}
- Modul: ${task.affected_module || '(neuvedeno)'}
- Typ změny: ${task.change_type || '(neuvedeno)'}

Vrať <suitability>{...}</suitability>.`;
}

function parseResult(text) {
  const m = text.match(/<suitability>([\s\S]*?)<\/suitability>/i);
  const candidate = m ? m[1].trim() : text.trim();
  const cleaned = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

async function evaluate(task) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY chybí — suitability nelze spustit');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: SUITABILITY_MODEL,
    max_tokens: SUITABILITY_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(task) }],
  });

  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return { score: null, reasoning: 'AI vrátila žádný text', tokensUsed };

  let parsed;
  try {
    parsed = parseResult(textBlock.text);
  } catch (e) {
    return { score: null, reasoning: 'Parser fail: ' + e.message, tokensUsed, raw: textBlock.text.slice(0, 300) };
  }

  const score = Number.isInteger(parsed.score) ? Math.max(0, Math.min(100, parsed.score)) : null;
  return {
    score,
    reasoning: String(parsed.reasoning || '').slice(0, 500),
    recommendedChangeType: parsed.recommended_change_type || null,
    recommendedAutonomy: parsed.recommended_autonomy || null,
    tokensUsed,
  };
}

module.exports = {
  evaluate,
  SUITABILITY_MODEL,
};
