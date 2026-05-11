// =============================================================================
// HolyOS — AI Vývojář / AC chat (doptávání akceptačních kritérií, Fáze 3)
// =============================================================================
// Brief kap. 6. AI haiku vede konverzaci se zadavatelem o úkolu a postupně
// vyplňuje povinná pole (cíl, definice hotovo, modul, typ změny) + doporučená
// (kontext, omezení, testovatelnost, priorita).
//
// Heuristika: úkol je hotový, když AI dokáže shrnout do tvaru
//   "Když uživatel udělá X, systém má udělat Y, a poznáme to podle Z"
// Pokud ne, doptává se konkrétními otázkami. Pokud zadavatel řekne "nevím"
// třikrát, AI doporučí přiřadit člověku (request_human tool).
//
// Volání: chat({ task, history, userMessage }) → {
//   aiMessage, updates, finalized, summary, escalate, tokensUsed
// }
// History = pole { role: 'user' | 'assistant', content: string|array }
// Frontend si history pamatuje a posílá ji s každým requestem.

const Anthropic = require('@anthropic-ai/sdk');

const AC_CHAT_MODEL = process.env.AI_DEV_AC_CHAT_MODEL || 'claude-haiku-4-5-20251001';
const AC_CHAT_MAX_TOKENS = 2048;

const TOOLS = [
  {
    name: 'update_ac_fields',
    description: 'Aktualizuj pole akceptačních kritérií úkolu na základě informací od zadavatele. Volej průběžně, jak se konverzace vyvíjí — aktualizuj jen pole, která už znáš. Volej DŘÍVE než kladeš další otázku.',
    input_schema: {
      type: 'object',
      properties: {
        acceptance_criteria: {
          type: 'string',
          description: 'Strukturovaný text AC — pole "Cíl:", "Definice hotovo:" (bullet list), "Modul:", "Typ změny:", volitelně "Kontext:", "Omezení:", "Testovatelnost:", "Priorita:". Český jazyk.',
        },
        affected_module: {
          type: 'string',
          description: 'Modul HolyOSu nebo "globální" / "infrastruktura". Např. "HR", "Sklad", "Účetní doklady".',
        },
        change_type: {
          type: 'string',
          enum: ['bug_fix', 'new_feature', 'refactor', 'ui_change', 'integration', 'documentation', 'data_migration'],
          description: 'Typ změny (určuje výchozí autonomy v runneru).',
        },
        autonomy_override: {
          type: 'string',
          enum: ['full_auto', 'pr_review', 'plan_review'],
          description: 'Volitelný override autonomy. Nech prázdné, pokud má rozhodnout mapping podle change_type.',
        },
      },
    },
  },
  {
    name: 'finalize_with_ac',
    description: 'Zavolej, jakmile máš všechna povinná pole vyplněná a dokážeš úkol shrnout do When-Then-Detect formy. Předtím zavolej update_ac_fields s finální verzí všech polí.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Krátké shrnutí úkolu v tvaru "Když uživatel udělá X, systém má udělat Y, a poznáme to podle Z" (max 200 znaků, česky).',
        },
      },
      required: ['summary'],
    },
  },
  {
    name: 'request_human',
    description: 'Zavolej, pokud zadavatel opakovaně neumí odpovědět a úkol není zralý pro AI Vývojáře. Doporuč přiřadit člověku.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Krátké vysvětlení proč není úkol zralý (česky, 1-2 věty).',
        },
      },
      required: ['reason'],
    },
  },
];

function buildSystemPrompt(task) {
  return `Jsi "Alan, AI Vývojář" v HolyOS. Tvoje role v této konverzaci: doptat se zadavatele na akceptační kritéria (AC) úkolu, aby byl připravený pro autonomní coding agent.

ÚKOL #${task.id}: ${task.page_title || '(bez názvu)'}

POPIS OD ZADAVATELE:
${task.description || '(prázdný popis — zeptej se na cíl)'}

SOUČASNÝ STAV AC POLÍ (může být prázdný):
- acceptance_criteria: ${task.acceptance_criteria ? JSON.stringify(task.acceptance_criteria) : '(prázdné)'}
- affected_module: ${task.affected_module || '(prázdné)'}
- change_type: ${task.change_type || '(prázdné)'}
- autonomy_override: ${task.autonomy_override || '(prázdné, použije se mapping)'}

POVINNÁ POLE (musíš vytáhnout):
1. Cíl jednou větou — "Co se má stát?"
2. Definice hotovo — "Jak poznáme, že je to hotové?" Konkrétní ověřitelné body.
3. affected_module — jeden z 12 modulů HolyOSu nebo "globální" / "infrastruktura"
4. change_type — bug_fix | new_feature | refactor | ui_change | integration | documentation | data_migration

DOPORUČENÁ (zeptej se, ale nepřerušuj pokud zadavatel neví):
- Kontext (navazuje na něco?)
- Omezení (termín, design, kompatibilita)
- Dotčená data (která DB tabulka, citlivá data)
- Testovatelnost
- Priorita a dopad

HEURISTIKA HOTOVO:
Úkol je zralý pro AI Vývojáře, když dokážeš shrnout do tvaru:
"Když uživatel udělá X, systém má udělat Y, a poznáme to podle Z."
Pokud to po 2-3 výměnách nedokážeš a zadavatel říká "nevím", zavolej request_human.

POSTUP:
1. Přečti popis úkolu. Pokud chybí jakékoli povinné pole, zeptej se na NEJDŮLEŽITĚJŠÍ chybějící.
2. Ptej se KRÁTCE a JEDNODUCHE — jedna otázka per zpráva. Žádné dlouhé úvody.
3. PRŮBĚŽNĚ aktualizuj AC pole přes update_ac_fields (po každé odpovědi, kde dostaneš novou informaci).
4. Pokud máš všechna povinná pole, zavolej finalize_with_ac.
5. Pokud zadavatel opakovaně řekne "nevím" / "rozhodni sám", zavolej request_human.

STYL:
- Český jazyk, tykání.
- Konkrétní, ne abstraktní.
- Žádné "děkuji za informaci", "skvělé", "samozřejmě" — drž to věcné.`;
}

/**
 * chat — jeden krok AC konverzace.
 *
 * @param {object} opts.task - AdminTask z DB
 * @param {Array} opts.history - předchozí messages [{role, content}]
 * @param {string} opts.userMessage - aktuální user input
 * @returns {Promise<{
 *   aiMessage: string,
 *   updates: object|null,
 *   finalized: boolean,
 *   summary: string|null,
 *   escalate: boolean,
 *   escalateReason: string|null,
 *   tokensUsed: number,
 *   newHistory: Array
 * }>}
 */
async function chat({ task, history = [], userMessage }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY chybí — AC chat nelze spustit');
  }
  const client = new Anthropic({ apiKey });

  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model: AC_CHAT_MODEL,
    max_tokens: AC_CHAT_MAX_TOKENS,
    system: buildSystemPrompt(task),
    tools: TOOLS,
    messages,
  });

  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

  // Extract text + tool uses
  let aiMessage = '';
  let updates = null;
  let finalized = false;
  let summary = null;
  let escalate = false;
  let escalateReason = null;

  for (const block of response.content) {
    if (block.type === 'text') {
      aiMessage += (aiMessage ? '\n\n' : '') + block.text;
    } else if (block.type === 'tool_use') {
      if (block.name === 'update_ac_fields') {
        updates = { ...(updates || {}), ...block.input };
      } else if (block.name === 'finalize_with_ac') {
        finalized = true;
        summary = (block.input && block.input.summary) || null;
      } else if (block.name === 'request_human') {
        escalate = true;
        escalateReason = (block.input && block.input.reason) || 'AI doporučuje přiřadit člověku.';
      }
    }
  }

  // Fallback aiMessage pokud Claude nic netextoval (jen tool calls)
  if (!aiMessage) {
    if (finalized) {
      aiMessage = '✅ Mám všechna povinná pole. Souhrn: ' + (summary || '(bez shrnutí)') + '\n\nMůžeš úkol předat AI Vývojáři.';
    } else if (escalate) {
      aiMessage = '🛑 Doporučuji přiřadit člověku: ' + escalateReason;
    } else {
      aiMessage = '(Alan: bez textu, viz updates)';
    }
  }

  // Build new history (push our turn + assistant turn)
  const newHistory = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: response.content },
  ];

  return {
    aiMessage,
    updates,
    finalized,
    summary,
    escalate,
    escalateReason,
    tokensUsed,
    newHistory,
  };
}

module.exports = {
  chat,
  AC_CHAT_MODEL,
};
