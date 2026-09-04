// =============================================================================
// HolyOS — Hlasový AI agent: jedno kolo konverzace nad Claude (+ volitelné MCP nástroje)
// =============================================================================
// Znovupoužitelné pro obě varianty:
//   - osobní recepční: toolset = null (žádná firemní data)
//   - prádlomatová infolinka: toolset = { getTools, execute } (čtecí + zápisové nástroje)
//
// Reuse retry wrapperu services/anthropic-retry.js. Model je záměrně rychlý
// (Haiku) kvůli latenci hlasového toku; shrnutí po hovoru může být delší.

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate } = require('../anthropic-retry');

const VOICE_MODEL = process.env.VOICE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOOL_ITERS = 5;

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Odbaví jedno kolo: vstup = text volajícího, výstup = { text, messages }.
// `messages` vrací aktualizovanou historii (předej ji do dalšího kola).
// toolset: null | { getTools: () => [...], execute: async (name, input) => any }
async function runTurn({ system, history = [], userText, toolset = null, maxTokens = 300 }) {
  const client = getClient();
  const messages = [...history, { role: 'user', content: userText }];
  const tools = toolset ? toolset.getTools() : undefined;

  for (let i = 0; i < MAX_TOOL_ITERS; i++) {
    const params = {
      model: VOICE_MODEL,
      max_tokens: maxTokens,
      temperature: 0.4,
      system,
      messages,
    };
    if (tools && tools.length) params.tools = tools;

    const resp = await messagesCreate(client, params, { label: 'voice' });
    const blocks = resp.content || [];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');

    if (!toolUses.length) {
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
      messages.push({ role: 'assistant', content: blocks });
      return { text, messages };
    }

    // Vykonej tool cally paralelně a vrať tool_result bloky
    messages.push({ role: 'assistant', content: blocks });
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        let out;
        try {
          out = await toolset.execute(tu.name, tu.input);
        } catch (e) {
          out = { error: e.message };
        }
        return {
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(out).slice(0, 4000),
        };
      })
    );
    messages.push({ role: 'user', content: results });
  }

  return {
    text: 'Omlouvám se, tohle teď nezvládnu vyřídit. Můžu vám vzít kontakt a kolega se vám ozve.',
    messages,
  };
}

// Po hovoru: shrnutí přepisu (kdo volal, co potřeboval, další krok).
async function summarize(transcript = []) {
  const client = getClient();
  const text = transcript
    .map((t) => `${t.role === 'caller' ? 'Volající' : 'Asistent'}: ${t.text}`)
    .join('\n');

  const resp = await messagesCreate(
    client,
    {
      model: VOICE_MODEL,
      max_tokens: 300,
      temperature: 0.2,
      system:
        'Shrň telefonní hovor česky ve 2–4 větách: kdo volal, co potřeboval a jaký je další krok. ' +
        'Buď věcný. Pokud volající uvedl jméno a kontakt, zmiň je.',
      messages: [{ role: 'user', content: text || '(prázdný přepis)' }],
    },
    { label: 'voice-summary' }
  );

  return (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

// Strukturované shrnutí + záměry pro automatizaci (stav kontaktu, kalendář).
// Vrací { summary, caller_name, caller_intent, no_interest, callback, callback_at,
//         meeting, meeting_at, when_text }.
async function summarizeStructured(transcript = [], opts = {}) {
  const text = transcript
    .map((t) => `${t.role === 'caller' ? 'Volající' : 'Asistent'}: ${t.text}`)
    .join('\n');
  const EMPTY = { summary: '', caller_name: null, caller_intent: null, no_interest: false, callback: false, callback_at: null, meeting: false, meeting_at: null, when_text: null };
  if (!text.trim()) return EMPTY;

  // Aktuální čas v Praze — aby AI mohla odvodit konkrétní termín ("pondělí v 10:00").
  const now = opts.now ? new Date(opts.now) : new Date();
  let nowStr = '';
  try {
    nowStr = now.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { nowStr = now.toISOString(); }

  const client = getClient();
  const resp = await messagesCreate(
    client,
    {
      model: VOICE_MODEL,
      max_tokens: 450,
      temperature: 0.2,
      system:
        'Shrň telefonní hovor a vytáhni záměry. Odpověz POUZE validním JSON bez markdownu, přesně ve tvaru ' +
        '{"caller_name": string|null, "caller_intent": string, "summary": string, "no_interest": boolean, ' +
        '"callback": boolean, "callback_at": string|null, "meeting": boolean, "meeting_at": string|null, "when_text": string|null}. ' +
        'caller_name = jméno volajícího pokud zaznělo, jinak null. caller_intent = krátce co volající potřeboval. summary = 1–3 věty. ' +
        'no_interest = true POUZE pokud volající jasně řekl, že NEMÁ zájem nebo si NEPŘEJE kontakt. ' +
        'callback = true, pokud volající chce, abychom mu zavolali jindy / v jiný čas. ' +
        'meeting = true, pokud si volající chce domluvit schůzku. ' +
        'when_text = doslovně jak termín řekl (např. „v pondělí v 10:00"), jinak null. ' +
        'callback_at / meeting_at = konkrétní termín v ISO 8601 s posunem +02:00 (Europe/Prague), pokud ho lze odvodit z hovoru vůči aktuálnímu času; jinak null. ' +
        'Aktuální datum a čas (Europe/Prague): ' + nowStr + '. ' +
        'Vše česky.',
      messages: [{ role: 'user', content: text }],
    },
    { label: 'voice-summary' }
  );

  const raw = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();

  try {
    const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const o = JSON.parse(jsonStr);
    return {
      summary: o.summary || raw,
      caller_name: o.caller_name || null,
      caller_intent: o.caller_intent || null,
      no_interest: o.no_interest === true || o.no_interest === 'true',
      callback: o.callback === true || o.callback === 'true',
      callback_at: o.callback_at || null,
      meeting: o.meeting === true || o.meeting === 'true',
      meeting_at: o.meeting_at || null,
      when_text: o.when_text || null,
    };
  } catch (_) {
    return Object.assign({}, EMPTY, { summary: raw });
  }
}

module.exports = { runTurn, summarize, summarizeStructured, VOICE_MODEL };
