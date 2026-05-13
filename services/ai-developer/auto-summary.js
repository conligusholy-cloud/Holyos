// =============================================================================
// HolyOS — AI Vývojář / auto-summary fallback (VRSTVA 3 robust řešení)
// =============================================================================
// Když agent skončí coding loop BEZ explicitního finish() callu (typicky kvůli
// MAX_TURNS, token budget guard, max_tokens cutoff bez recovery), ale má alespoň
// jednu file_change, runner.js zavolá tuto funkci. Haiku model vygeneruje
// 4–6 vět české PR description shrnutí z:
//   - akceptačních kritérií úkolu
//   - seznamu změněných souborů
//   - posledních text_blocks z llm_message eventů (Sonnetovy úvahy)
//
// Cíl: PR popis bude smysluplný i bez Sonnetova explicitního shrnutí.
// Cena: ~500 tokenů Haiku per run ≈ $0.001.

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate } = require('../anthropic-retry');

const MODEL = process.env.AI_DEV_AUTO_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;

const SYSTEM_PROMPT = `Jsi technický writer pro HolyOS PR descriptions.

Tvůj úkol: na základě úkolu + seznamu změněných souborů + posledních úvah AI vývojáře napiš 4–6 vět česky shrnujících CO bylo uděláno z pohledu uživatele.

PRAVIDLA:
- Věcný, suchý styl. Žádné marketingové fráze, žádné "úspěšně jsem", "podařilo se".
- Popisuj výsledek, ne proces. NE: "agent prozkoumal a našel". ANO: "Přidáno tlačítko X v záložce Y".
- Pokud changes pokrývají AC, řekni to. Pokud něco chybí, naznač co.
- Žádné emoji v textu (ne v hlavičce). Žádný markdown formatting kromě maximálně jednoho **tučného slova** pro důraz.
- Maximálně 6 vět, ideálně 4.

VRAŤ POUZE shrnutí. Žádný úvod, žádný komentář, žádné "Zde je shrnutí:".`;

function buildUserMessage({ task, fileChanges, recentTextBlocks }) {
  const fcList = (fileChanges || []).map((f) => `- ${f}`).join('\n') || '(žádné — pouze průzkum)';
  const blocks = (recentTextBlocks || []).filter(Boolean).slice(-5);
  const blocksStr = blocks.length
    ? blocks.map((b) => String(b).slice(0, 800)).join('\n---\n')
    : '(žádné textové úvahy v posledních eventech)';

  return `ÚKOL #${task.id}: ${task.page_title || '(bez názvu)'}

AKCEPTAČNÍ KRITÉRIA:
${task.acceptance_criteria || '(nestanovena)'}

ZMĚNĚNÉ SOUBORY (${(fileChanges || []).length}):
${fcList}

POSLEDNÍ ÚVAHY AGENTA (z llm_message eventů):
${blocksStr}

Napiš shrnutí pro PR description.`;
}

function extractRecentTextBlocks(events, n = 5) {
  if (!events || !events.length) return [];
  return events
    .filter((e) => e.kind === 'llm_message')
    .slice(-n)
    .flatMap((e) => {
      const payload = e.payload || {};
      return Array.isArray(payload.text_blocks) ? payload.text_blocks : [];
    })
    .filter(Boolean);
}

/**
 * generateSummary — Haiku auto-summary z task + fileChanges + recent events.
 * @returns {Promise<{ summary: string, tokensUsed: number }>}
 * Při chybě vyhazuje (caller v runner.js to chytí a fallbackne na původní summary).
 */
async function generateSummary({ task, fileChanges, events }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY chybí — auto-summary nelze spustit');
  const client = new Anthropic({ apiKey });

  const recentTextBlocks = extractRecentTextBlocks(events, 5);
  const userMsg = buildUserMessage({ task, fileChanges, recentTextBlocks });

  const response = await messagesCreate(
    client,
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    },
    { label: 'ai-dev/auto-summary' }
  );

  const tokensUsed =
    (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  const textBlock = response.content.find((b) => b.type === 'text');
  const summary = (textBlock?.text || '').trim();

  return { summary, tokensUsed };
}

module.exports = {
  generateSummary,
  MODEL,
};
