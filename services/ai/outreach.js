// =============================================================================
// HolyOS — Compounder: AI generátor oslovení (LinkedIn / e-mail / WhatsApp)
// =============================================================================
// Z kontextu leada vytvoří personalizované oslovení šité na kanál a v jazyce leada.
// Vrací { subject, body } (subject je null u kanálů bez předmětu). Při chybě vrací null.

'use strict';

const LANG_NAMES = { cs: 'česky', sk: 'slovensky', en: 'anglicky', de: 'německy', pl: 'polsky', it: 'italsky', es: 'španělsky', fr: 'francouzsky', hr: 'chorvatsky', hu: 'maďarsky', nl: 'nizozemsky', pt: 'portugalsky', uk: 'ukrajinsky', ru: 'rusky' };

const CHANNEL_RULES = {
  linkedin: 'Kanál: LinkedIn (krátká zpráva / pozvánka ke spojení). Buď stručný a lidský, MAX ~500 znaků, bez předmětu, bez formálního podpisu. Cílem je navázat kontakt a vzbudit zájem o krátký hovor.',
  email: 'Kanál: e-mail. Napiš výstižný předmět a tělo o 2–4 krátkých odstavcích. Profesionální, ale živé. Bez patičky a bez odkazu (doplní se automaticky).',
  whatsapp: 'Kanál: WhatsApp (krátká, přátelská zpráva). MAX ~400 znaků, bez předmětu, uvolněnější tón, klidně 1 vhodné emoji.',
  sms: 'Kanál: SMS. Velmi krátce, MAX ~300 znaků, bez předmětu.',
};

// leadFacts: { name, firma, funkce, lang, status, notes, city, web }
async function generateOutreach(leadFacts, opts) {
  opts = opts || {};
  const channel = CHANNEL_RULES[opts.channel] ? opts.channel : 'email';
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'Chybí ANTHROPIC_API_KEY na serveru.' };
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.COMPOUNDER_OUTREACH_MODEL || process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const lc = String(leadFacts.lang || 'cs').toLowerCase().slice(0, 2);
    const langWord = LANG_NAMES[lc] || ('v jazyce s ISO kódem ' + lc);
    const first = String(leadFacts.name || '').trim().split(/\s+/)[0] || '';

    const facts = {
      jmeno: leadFacts.name || null,
      krestni: first || null,
      firma: leadFacts.firma || null,
      funkce: leadFacts.funkce || null,
      mesto: leadFacts.city || null,
      web: leadFacts.web || null,
      stav_leada: leadFacts.status || null,
      poznamky: (leadFacts.notes || '').slice(0, 800) || null,
    };

    const sys = 'Jsi špičkový B2B obchodník firmy Best Series, která prodává prémiové samoobslužné prádelny „Compounder" jako investiční aktivum (ověřené místo s reálným obratem, kompletní servis, garance zpětného odkupu). Píšeš obchodníkovi PRVNÍ oslovení konkrétního leada — má být krátké, lidské, konkrétní a bez laciných prodejních klišé. Personalizuj podle dostupných faktů (jméno, firma, funkce, město, poznámky), ale nevymýšlej si údaje, které nemáš. Cíl: vzbudit zájem a domluvit krátký hovor. '
      + CHANNEL_RULES[channel] + ' '
      + (opts.goal ? ('Konkrétní cíl této zprávy: ' + String(opts.goal).slice(0, 300) + '. ') : '')
      + (opts.tone ? ('Tón: ' + String(opts.tone).slice(0, 100) + '. ') : '')
      + 'Piš ' + langWord + '. Oslov křestním jménem, pokud je k dispozici. '
      + 'Odpověz POUZE platným JSON bez markdownu ve tvaru: {"subject":"<předmět nebo prázdný řetězec u kanálů bez předmětu>","body":"<text zprávy, odstavce oddělené \\n\\n>"}.';
    const usr = 'Fakta o leadovi (JSON):\n' + JSON.stringify(facts) + '\nNáhodné semínko pro rozmanitost: ' + Math.random().toString(36).slice(2);

    const msg = await client.messages.create({ model, max_tokens: 900, temperature: 0.9, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    const j = JSON.parse(text);
    if (!j || !j.body) return { error: 'AI vrátila prázdnou nebo neplatnou odpověď.' };
    return {
      subject: (channel === 'email' && j.subject) ? String(j.subject).slice(0, 300) : null,
      body: String(j.body).slice(0, 4000),
    };
  } catch (e) {
    console.error('[outreach] generateOutreach selhal:', e.message);
    return { error: e.message };
  }
}

module.exports = { generateOutreach };
