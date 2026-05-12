// HolyOS — AI shrnutí chování zákazníka u obchodní pomůcky
// Volá Claude (sonnet-4-6) na vyžádání. Vstup: recipient + události + uložené
// modely. Výstup: srozumitelné shrnutí v češtině pro obchodníka (Tomáš).

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate } = require('../anthropic-retry');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_EVENTS = 100;
const MAX_MODELS = 20;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nakonfigurovaný');
  return new Anthropic({ apiKey });
}

function fmtCzDateTime(d) {
  try {
    return new Date(d).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return String(d || '');
  }
}

// ─── Builder promptu ──────────────────────────────────────────────────────

function buildEventsTimeline(events) {
  if (!events || !events.length) return '(žádné události)';
  // V chronologickém pořadí (nejstarší první)
  const sorted = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const limited = sorted.slice(-MAX_EVENTS); // ponecháme nejnovější MAX_EVENTS
  const lines = limited.map((e) => {
    const t = fmtCzDateTime(e.created_at);
    let extra = '';
    if (e.payload && typeof e.payload === 'object') {
      if (e.payload.name) extra = ' — ' + e.payload.name;
      else if (e.payload.kind) extra = ' (' + e.payload.kind + ')';
      else if (e.payload.sample && typeof e.payload.sample === 'object') {
        const s = e.payload.sample;
        if (s.zakazniku_za_den != null) {
          extra = ' (zákazníků/den=' + s.zakazniku_za_den + (s.zisk != null ? ', zisk=' + Math.round(s.zisk) + ' €' : '') + ')';
        }
      }
    }
    return `- ${t}: ${e.event_type}${extra}`;
  });
  return lines.join('\n');
}

function shortenInputs(data) {
  if (!data || typeof data !== 'object') return {};
  // Klíčové vstupy, které Tomáše zajímají
  const keys = [
    'cena_pradlomatu', 'cena_projekt', 'cena_pripojek',
    'obrat_na_zakaznika', 'zakazniku_za_den',
    'udrzba', 'software', 'internet', 'infolinka', 'pojisteni', 'najem', 'servis',
    'cena_elektriny', 'cena_vodne', 'cena_stocne', 'dph',
  ];
  const r = {};
  for (const k of keys) {
    if (data[k] != null) r[k] = data[k];
  }
  return r;
}

function shortenComputed(c) {
  if (!c || typeof c !== 'object') return {};
  const keys = [
    'investice_celkem', 'obrat_mesic', 'naklad_pracich_cyklu_mesic',
    'fixni_mesic', 'zisk', 'navratnost_mesicu', 'navratnost_roku',
    'zakazniku_mesic',
  ];
  const r = {};
  for (const k of keys) {
    const v = c[k];
    if (typeof v === 'number' && isFinite(v)) r[k] = Math.round(v * 100) / 100;
  }
  return r;
}

function buildModelsSection(models) {
  if (!models || !models.length) return '(žádné uložené modely)';
  const sorted = [...models].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const limited = sorted.slice(-MAX_MODELS);
  const lines = limited.map((m, i) => {
    const inputs = shortenInputs(m.data_json);
    const computed = shortenComputed(m.computed_json);
    const header = `Model #${i + 1} "${m.name}" (uloženo ${fmtCzDateTime(m.created_at)})`;
    const ins = Object.keys(inputs).length
      ? '  vstupy: ' + JSON.stringify(inputs)
      : '  vstupy: (chybí)';
    const out = Object.keys(computed).length
      ? '  výstupy: ' + JSON.stringify(computed)
      : '  výstupy: (nedopočítáno)';
    return [header, ins, out].join('\n');
  });
  return lines.join('\n\n');
}

function buildPrompt(recipient, events, models) {
  const head =
    `Příjemce: ${recipient.name}` +
    (recipient.company ? ` (${recipient.company})` : '') +
    `\nE-mail: ${recipient.email}` +
    `\nPomůcka: ${recipient.tool_meta && recipient.tool_meta.title || recipient.tool}` +
    `\nOdkaz odeslán: ${fmtCzDateTime(recipient.created_at)}` +
    `\nOtevření celkem: ${recipient.open_count || 0}` +
    `\nUložené modely: ${recipient.save_count || 0}` +
    (recipient.last_opened ? `\nPoslední otevření: ${fmtCzDateTime(recipient.last_opened)}` : '') +
    (recipient.note ? `\nPoznámka od obchodníka při založení: ${recipient.note}` : '');

  const eventsBlock = buildEventsTimeline(events);
  const modelsBlock = buildModelsSection(models);

  return (
    '## Kontext\n' +
    head +
    '\n\n## Časová osa událostí\n' +
    eventsBlock +
    '\n\n## Uložené verze modelu\n' +
    modelsBlock +
    '\n\n---\nÚkol: Připrav krátké, konkrétní shrnutí pro obchodníka (Tomáš), jak tento zákazník s pomůckou pracuje. ' +
    'Mluv česky, formálně-přátelsky, bez markdown bullet pointů na začátku odstavců, v souvislých větách.\n\n' +
    'Struktura odpovědi (v tomto pořadí, každá sekce nadpisem na vlastním řádku **TUČNĚ**, krátké odstavce):\n' +
    '**Co dělá**: 2–4 věty o tom, jak často odkaz otevírá, jestli si projde celý model nebo jen vstupy, kolik si uložil variant, jestli mění reálné podnikatelské proměnné (zákazníci/den, nájem, investice) nebo si spíš hraje se zdrojovými daty (energie, DPH, spotřeba strojů).\n' +
    '**Klíčové scénáře**: konkrétní čísla z uložených modelů — pokud má víc verzí, popiš rozdíly mezi nimi (např. "v první verzi počítal s 2 zákazníky/den, ve druhé zkusil 4"). Pokud má jen jeden model, srovnej ho s výchozími hodnotami (defaults).\n' +
    '**Signál zájmu**: subjektivní odhad 1–10 (1=jen otevřel a zavřel, 10=evidentně si dělá obchodní case). Jednou větou zdůvodni.\n' +
    '**Doporučení**: 1–2 věty, co by Tomáš měl udělat dál (zavolat? poslat doplňující info? nechat dozrát?).\n\n' +
    'Pokud zákazník odkaz vůbec neotevřel nebo otevřel jen jednou bez interakce, řekni to rovnou a zbytek sekcí drž krátké.'
  );
}

// ─── Hlavní funkce ────────────────────────────────────────────────────────

/**
 * Vygeneruje AI shrnutí.
 * @param {Object} recipient — BusinessToolRecipient + tool_meta
 * @param {Array}  events
 * @param {Array}  models
 * @returns {Promise<{text: string, model: string, tokens_in: number, tokens_out: number}>}
 */
async function generateSummary(recipient, events, models) {
  const client = getClient();
  const prompt = buildPrompt(recipient, events || [], models || []);

  const response = await messagesCreate(client, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system:
      'Jsi asistent obchodníka v B2B prodeji prádlomatů. Odpovídáš česky, věcně, ' +
      'bez vaty a marketingových frází. Cílem je dát obchodníkovi praktické vodítko, ' +
      'jak se zákazníkem dál pracovat. Neutíkej do generického jazyka — vždy zmiň ' +
      'konkrétní čísla z uložených modelů, pokud existují.',
    messages: [{ role: 'user', content: prompt }],
  }, { label: 'business-tool/summary' });

  const text = (response.content.find((c) => c.type === 'text') || {}).text || '';
  return {
    text: text.trim(),
    model: MODEL,
    tokens_in: response.usage ? response.usage.input_tokens : null,
    tokens_out: response.usage ? response.usage.output_tokens : null,
  };
}

module.exports = { generateSummary, MODEL };
