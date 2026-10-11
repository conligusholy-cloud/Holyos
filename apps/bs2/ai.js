// BS2 — AI chat: nastavení (app_settings, klíč 'ai_chat'), skládání systémových instrukcí a volání Claude.
// Nastavuje se v adminu (záložka „AI chat"); stejnou konfiguraci později použije chat přímo na stránkách.
// Env: ANTHROPIC_API_KEY (nutné pro odpovědi), BS2_AI_MODEL (volitelný výchozí model).
const { q } = require('./db');

const KEY = 'ai_chat';
const MODELS = [
  ['claude-haiku-4-5-20251001', 'Haiku 4.5 — nejrychlejší, nejlevnější'],
  ['claude-sonnet-4-6', 'Sonnet 4.6 — přesnější a pečlivější (pomalejší)'],
];
const TONES = {
  friendly: 'přátelský a vstřícný, ale věcný',
  expert: 'odborný a přesný, bez zbytečných ozdob',
  concise: 'maximálně stručný — nejdřív odpověď, pak případně jedna věta navíc',
  formal: 'formální a zdvořilý (vykání)',
};

const DEFAULTS = {
  enabled: false,
  name: 'Best Series asistent',
  greeting: 'Dobrý den, jsem asistent Best Series 2.0. S čím vám můžu pomoct?',
  tone: 'friendly',
  reply_in_user_language: true,
  instructions:
    'Jsi asistent soukromé sekce Best Series 2.0 (prádlomaty, Discount Credit, doporučování, Moje svoboda). ' +
    'Pomáháš přihlášeným uživatelům s orientací v nabídce a pravidlech. Odpovídáš přesně podle znalostí níže.',
  knowledge: '',
  include_products: true,
  rules:
    'Nevymýšlej si ceny, procenta ani podmínky, které nejsou ve znalostech. ' +
    'Neslibuj výnosy ani slevy nad rámec uvedených pravidel. Nesdílej interní informace, ceny jiných uživatelů ani údaje o jiných lidech.',
  unknown_reply:
    'Tohle bohužel přesně nevím. Napište prosím našemu týmu a rádi vám to upřesní.',
  contact: '',
  model: 'claude-haiku-4-5-20251001',
  temperature: 0.3,
  max_tokens: 600,
};

async function loadConfig() {
  let obj = {};
  try {
    const r = await q('SELECT value FROM app_settings WHERE key=$1', [KEY]);
    if (r.rows[0]) obj = JSON.parse(r.rows[0].value) || {};
  } catch (e) { obj = {}; }
  return { ...DEFAULTS, ...obj };
}

// Ořízne a ověří data z formuláře (checkboxy chodí jen když jsou zaškrtnuté).
function sanitize(b) {
  const s = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').slice(0, max).trim();
  const num = (v, lo, hi, def) => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  return {
    enabled: b.enabled === '1' || b.enabled === 'on' || b.enabled === true,
    name: s(b.name, 80) || DEFAULTS.name,
    greeting: s(b.greeting, 600),
    tone: Object.prototype.hasOwnProperty.call(TONES, b.tone) ? b.tone : DEFAULTS.tone,
    reply_in_user_language: b.reply_in_user_language === '1' || b.reply_in_user_language === 'on' || b.reply_in_user_language === true,
    instructions: s(b.instructions, 8000),
    knowledge: s(b.knowledge, 60000),
    include_products: b.include_products === '1' || b.include_products === 'on' || b.include_products === true,
    rules: s(b.rules, 6000),
    unknown_reply: s(b.unknown_reply, 800),
    contact: s(b.contact, 800),
    model: MODELS.some(m => m[0] === b.model) ? b.model : (process.env.BS2_AI_MODEL || DEFAULTS.model),
    temperature: num(b.temperature, 0, 1, DEFAULTS.temperature),
    max_tokens: Math.round(num(b.max_tokens, 100, 1500, DEFAULTS.max_tokens)),
  };
}

async function saveConfig(cfg) {
  await q("INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [KEY, JSON.stringify(cfg)]);
}

// Systémové instrukce: pořadí = role → pravidla → znalosti → produkty → nejistota/kontakt → závazné připomenutí na konci.
function buildSystem(cfg, productsText) {
  const parts = [];
  parts.push(`Jsi „${cfg.name}". ${cfg.instructions || ''}`.trim());
  parts.push(`STYL: ${TONES[cfg.tone] || TONES.friendly}. Odpovídej stručně a srozumitelně, bez markdownu, nadpisů a emoji. ` +
    (cfg.reply_in_user_language ? 'Odpovídej v jazyce, ve kterém se uživatel ptá (výchozí je čeština).' : 'Odpovídej vždy česky.'));
  if (cfg.rules) parts.push('PRAVIDLA A ZÁKAZY (závazná):\n' + cfg.rules);
  if (cfg.knowledge) parts.push('ZNALOSTI (jediný zdroj faktů):\n' + cfg.knowledge);
  if (cfg.include_products && productsText) parts.push('AKTUÁLNÍ NABÍDKA PRÁDLOMATŮ (ceny bez DPH, platí jen toto):\n' + productsText);
  parts.push('KDYŽ NEVÍŠ: Neodhaduj. Řekni: „' + (cfg.unknown_reply || DEFAULTS.unknown_reply) + '"' +
    (cfg.contact ? '\nKontakt, na který uživatele odkážeš:\n' + cfg.contact : ''));
  parts.push('=== ZÁVAZNÉ PŘIPOMENUTÍ === Odpovídej VÝHRADNĚ podle instrukcí, pravidel, znalostí a nabídky výše. ' +
    'Nic si nevymýšlej (ceny, procenta, termíny, podmínky). Při nejistotě použij větu pro nezodpovězené otázky. Odpověz co nejpřesněji a krátce.');
  return parts.join('\n\n');
}

async function chat(cfg, system, messages) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'Na serveru BS2 chybí proměnná ANTHROPIC_API_KEY (nastav ji v Railway projektu BS2).' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: cfg.max_tokens, temperature: cfg.temperature, system, messages }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: 'Claude vrátil chybu ' + r.status + (j.error && j.error.message ? ': ' + j.error.message : '') };
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
  return { reply: text };
}

module.exports = { DEFAULTS, MODELS, TONES, loadConfig, sanitize, saveConfig, buildSystem, chat };
