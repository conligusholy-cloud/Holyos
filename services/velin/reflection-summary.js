// =============================================================================
// HolyOS — Velín: AI summary večerní reflexe (Fáze 2 Krok F)
// =============================================================================
// Po submitu večerní reflexe vygeneruje krátké shrnutí pro vedoucího přes
// Claude Haiku (rychlý, levný). Uloží do EveningReflection.ai_summary.
//
// Volá se fire-and-forget z POST /api/velin/feedback/evening — neblokuje
// odpověď kolegovi. Když Anthropic selže, reflexe se uloží bez summary.

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate } = require('../anthropic-retry');
const { prisma } = require('../../config/database');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 400;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nakonfigurovaný');
  return new Anthropic({ apiKey });
}

function moodLabel(n) {
  return ['', '😞 mizerná', '😕 slabší', '😐 průměr', '🙂 dobrá', '😀 výborná'][n] || '—';
}

function buildPrompt(reflection, personName) {
  const parts = [];
  parts.push(`Kolega: ${personName || 'neznámý'}`);
  if (reflection.mood) parts.push(`Nálada: ${reflection.mood}/5 (${moodLabel(reflection.mood)})`);
  if (reflection.energy) parts.push(`Energie: ${reflection.energy}/5`);
  if (reflection.wins) parts.push(`Co se povedlo: ${reflection.wins}`);
  if (reflection.struggles) parts.push(`S čím bojoval: ${reflection.struggles}`);
  if (reflection.tomorrow_focus) parts.push(`Plán na zítra: ${reflection.tomorrow_focus}`);
  if (reflection.free_text) parts.push(`Volný text: ${reflection.free_text}`);

  return (
    'Tohle je večerní reflexe výrobního kolegy. Napiš vedoucímu výroby ' +
    'shrnutí ve 2-3 větách česky: jak na tom kolega je, na co si dát pozor, ' +
    'jestli něco vyžaduje akci vedoucího (blokátor, nízká nálada/energie ' +
    'několik dní po sobě by byl důvod promluvit si). Buď věcný, žádné fráze. ' +
    'Pokud reflexe nic závažného neukazuje, klidně napiš jen "Bez problémů, ' +
    'běžný den."\n\n' +
    parts.join('\n')
  );
}

/**
 * Vygeneruje a uloží ai_summary pro danou reflexi.
 * @param reflectionId — EveningReflection.id
 * @returns { summary } nebo null při chybě
 */
async function generateAndStore(reflectionId) {
  const reflection = await prisma.eveningReflection.findUnique({
    where: { id: reflectionId },
    include: { person: { select: { first_name: true, last_name: true } } },
  });
  if (!reflection) return null;

  // Pokud je reflexe úplně prázdná (jen submit bez obsahu), nezatěžuj API
  const hasContent =
    reflection.mood || reflection.energy || reflection.wins ||
    reflection.struggles || reflection.tomorrow_focus || reflection.free_text;
  if (!hasContent) return null;

  const personName = reflection.person
    ? `${reflection.person.first_name} ${reflection.person.last_name}`.trim()
    : null;

  const client = getClient();
  const response = await messagesCreate(client, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system:
      'Jsi asistent vedoucího výroby. Čteš večerní reflexe kolegů a píšeš ' +
      'krátká, věcná shrnutí česky. Nepřeháníš, neradíš zbytečně, ale ' +
      'upozorníš na cokoliv, co vyžaduje pozornost vedoucího.',
    messages: [{ role: 'user', content: buildPrompt(reflection, personName) }],
  }, { label: 'velin/reflection-summary' });

  const summary = (response.content.find((c) => c.type === 'text') || {}).text || '';
  const trimmed = summary.trim();
  if (!trimmed) return null;

  await prisma.eveningReflection.update({
    where: { id: reflectionId },
    data: { ai_summary: trimmed },
  });

  return { summary: trimmed, model: MODEL };
}

/**
 * Fire-and-forget varianta — zaloguje chybu, ale nikdy nehodí výjimku.
 * Použij v request handleru, kde nechceš blokovat odpověď.
 */
function generateInBackground(reflectionId) {
  generateAndStore(reflectionId).catch((e) => {
    console.warn('[velin/reflection-summary] generování selhalo:', e.message);
  });
}

module.exports = { generateAndStore, generateInBackground };
