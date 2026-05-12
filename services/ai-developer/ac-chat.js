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
const { messagesCreate } = require('../anthropic-retry');

const AC_CHAT_MODEL = process.env.AI_DEV_AC_CHAT_MODEL || 'claude-haiku-4-5-20251001';
const AC_CHAT_MAX_TOKENS = 2048;

const TOOLS = [
  {
    name: 'update_basic_fields',
    description: 'V draft módu (vytváření nového požadavku) — nastav základní pole úkolu: titulek a popis. Volej včas, jakmile máš informace o tom CO uživatel chce. Pak pokračuj s update_ac_fields pro detailnější pole.',
    input_schema: {
      type: 'object',
      properties: {
        page_title: {
          type: 'string',
          description: 'Krátký titulek úkolu (max 100 znaků), např. "Přidej tlačítko Export v tabulce zaměstnanců".',
        },
        description: {
          type: 'string',
          description: 'Strukturovaný popis úkolu (1-3 odstavce) — co uživatel chce, na kterou stránku, jaký kontext.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Priorita podle naléhavosti (default medium).',
        },
      },
    },
  },
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

KOMU ALAN PÍŠE:
Zaměstnancům HolyOSu (skladnice, HR-istka, mistr, účetní). VĚTŠINOU NEZNAJÍ IT termíny. Nevědí co je "modul", "komponenta", "CSS", "DB tabulka", "endpoint". Vědí ale CO potřebují a kde to v HolyOSu vidí.

STYL:
- Český jazyk, tykání, přátelsky jako kolega ne jako technik.
- Krátké konkrétní otázky (1 věta), max 1 otázka per zpráva.
- Žádný IT žargon. Místo "komponenta" piš "část stránky", místo "DB záznam" piš "položka v seznamu", místo "API" prostě o tom nemluv.
- Žádné "děkuji za informaci", "skvělé", "samozřejmě" — drž to věcné.
- Pokud to vypadá na UI změnu, popros o screenshot s šipkou kde to má být.

PŘÍKLADY DOBRÝCH OTÁZEK:
- "V jaké části HolyOSu se to děje? (Vozový park, Sklady, HR…)"
- "Můžeš poslat screenshot kde to vidíš?"
- "Předveď to slovy: kliknu na X, vidím Y, chci ale Z."
- "Co by se mělo stát potom — email, změna stavu, něco jiného?"

PŘÍKLADY ŠPATNÝCH OTÁZEK (NIKDY):
- "Která komponenta se renderuje?" / "Jaký CSS selektor?" / "Která DB tabulka?"
- "Které soubory chceš upravit?" / "Jaká je current implementace?"
- "Endpoint?" / "Schema?" / "Routing?" / "State management?"

Pravidlo: pokud otázka má technické slovo, PŘEPIŠ ji do laického jazyka. Pokud to nejde, nesměj ji vůbec.`;
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

  const response = await messagesCreate(client, {
    model: AC_CHAT_MODEL,
    max_tokens: AC_CHAT_MAX_TOKENS,
    system: buildSystemPrompt(task),
    tools: TOOLS,
    messages,
  }, { label: 'ai-dev/ac-chat' });

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

/**
 * chatDraft — varianta pro vytváření nového požadavku (před existencí DB taska).
 *
 * Liší se od chat() tím, že místo `task` přijímá `draft` (jen powdered fields,
 * žádné DB ID). Plus extra tool `update_basic_fields` pro page_title/description.
 * History persistuje frontend (žádné DB updaty — task ještě neexistuje).
 *
 * Frontend sbírá draft mezi voláními a na konci POST /api/admin-tasks s draftem.
 *
 * @param {object} opts.draft - { page_title?, description?, page?, page_title?,
 *   acceptance_criteria?, affected_module?, change_type?, autonomy_override?, priority? }
 * @param {Array} opts.history - předchozí messages [{role, content}]
 * @param {string} opts.userMessage - aktuální user input
 * @param {object} opts.pageContext - { path, title } z frontendu (kde uživatel klikl AI)
 */
async function chatDraft({ draft = {}, history = [], userMessage, pageContext = {} }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY chybí — AC chat (draft) nelze spustit');
  }
  const client = new Anthropic({ apiKey });

  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const systemPrompt = `Jsi "Alan, AI Vývojář" v HolyOS. Aktuálně pomáháš uživateli vytvořit NOVÝ požadavek (úkol pro AI Vývojáře). Tvoje role: doptat se na povinná pole a postupně vyplnit:
  - page_title (krátký titulek)
  - description (1-3 odstavce popisu)
  - acceptance_criteria (strukturovaný "Cíl / Definice hotovo / Modul / Typ změny")
  - affected_module (modul HolyOSu, např. HR, Sklad, …)
  - change_type (bug_fix | new_feature | refactor | ui_change | integration | documentation | data_migration)
  - autonomy_override (volitelné: full_auto | pr_review | plan_review)

KONTEXT STRÁNKY (odkud uživatel chat vyvolal):
- path: ${pageContext.path || '(neuvedeno)'}
- title: ${pageContext.title || '(neuvedeno)'}

SOUČASNÝ STAV DRAFTU:
${JSON.stringify(draft, null, 2)}

POSTUP:
1. První zpráva uživatele = HRUBÝ POPIS toho co chce. Zachyť ho přes update_basic_fields (page_title + description).
2. Doptej se postupně: definice hotovo, modul, typ změny. Jedna otázka per zpráva.
3. PRŮBĚŽNĚ aktualizuj draft přes update_ac_fields.
4. Když máš všechna povinná pole + dokážeš shrnout úkol do tvaru "Když uživatel udělá X, systém má udělat Y, a poznáme to podle Z", zavolej finalize_with_ac.
5. Pokud uživatel opakovaně řekne "nevím" / "rozhodni sám", zavolej request_human.

STYL:
- Český jazyk, tykání, přátelsky jako kolega ne jako technik.
- KRÁTKÉ otázky, max 1 otázka per zpráva.
- Konkrétní, ne abstraktní.
- Žádný IT žargon ("modul", "komponenta", "CSS", "DB tabulka", "endpoint" — to neříkej). Místo toho: "část stránky", "položka v seznamu", apod.
- Žádné "děkuji", "skvělé" — drž to věcné.
- Pokud uživatel chat začíná otázkou (ne popisem), nejdřív se zeptej "Co potřebuješ?"
- Pokud to vypadá na UI změnu, popros o screenshot.

KOMU PÍŠEŠ: zaměstnancům HolyOSu (skladnice, HR-istka, mistr), kteří neznají IT termíny. Ptej se na CO chtějí a KDE v HolyOSu, ne na technické detaily (které soubory, jaké selectory, atd.) — ty si zjistí coding agent přes list_files / read_file.`;

  const response = await messagesCreate(client, {
    model: AC_CHAT_MODEL,
    max_tokens: AC_CHAT_MAX_TOKENS,
    system: systemPrompt,
    tools: TOOLS,
    messages,
  }, { label: 'ai-dev/ac-chat-draft' });

  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

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
      if (block.name === 'update_basic_fields' || block.name === 'update_ac_fields') {
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

  if (!aiMessage) {
    if (finalized) {
      aiMessage = '✅ Mám všechny potřebné informace. Souhrn: ' + (summary || '(bez shrnutí)') + '\n\nMůžeš požadavek odeslat — bude rovnou připravený pro AI Vývojáře.';
    } else if (escalate) {
      aiMessage = '🛑 Doporučuji přiřadit člověku: ' + escalateReason;
    } else {
      aiMessage = '(Alan: bez textu, viz updates)';
    }
  }

  const newHistory = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: response.content },
  ];

  // Merge updates do draftu (pro frontend pohodlí — vrátíme updated draft)
  const updatedDraft = updates ? { ...draft, ...updates } : draft;

  return {
    aiMessage,
    updates,
    updatedDraft,
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
  chatDraft,
  AC_CHAT_MODEL,
};
