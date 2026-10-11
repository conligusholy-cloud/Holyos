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

// Limity — kontrolují se VŽDY (v prohlížeči i na serveru). Nic se tiše neřeže: při překročení se uložení zamítne s hlášením.
const LIMITS = {
  name: 80, greeting: 600, instructions: 20000, rules: 20000, unknown_reply: 2000, contact: 2000,
  item_title: 120, item_text: 100000, items_max: 500, example_q: 500, example_a: 3000, examples_max: 300,
  temperature: [0, 1], max_tokens: [100, 4000],
  // Celkový rozpočet instrukcí (odhad tokenů = znaky / 3). Nad WARN je chat pomalejší a dražší, nad HARD se nedá uložit.
  tokens_warn: 40000, tokens_hard: 150000,
};
const estimateTokens = (chars) => Math.ceil(chars / 3);

const DEFAULTS = {
  enabled: false,
  name: 'Best Series asistent',
  greeting: 'Dobrý den, jsem asistent Best Series 2.0. S čím vám můžu pomoct?',
  tone: 'friendly',
  reply_in_user_language: true,
  instructions:
    'Jsi asistent soukromé sekce Best Series 2.0 (prádlomaty, Discount Credit, doporučování, Moje svoboda). ' +
    'Pomáháš přihlášeným uživatelům s orientací v nabídce a pravidlech. Odpovídáš přesně podle znalostí níže.',
  knowledge_items: [],   // [{ title, text, enabled }] — témata znalostí, počet není omezen (jen celkový rozpočet)
  examples: [],          // [{ q, a }] — vzorové otázky a přesné odpovědi
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
  const cfg = { ...DEFAULTS, ...obj };
  // Starší jednoblokové znalosti → první téma
  if (cfg.knowledge && !(cfg.knowledge_items || []).length) cfg.knowledge_items = [{ title: 'Obecné znalosti', text: cfg.knowledge, enabled: true }];
  delete cfg.knowledge;
  if (!Array.isArray(cfg.knowledge_items)) cfg.knowledge_items = [];
  if (!Array.isArray(cfg.examples)) cfg.examples = [];
  return cfg;
}

const cnt = (n) => Number(n).toLocaleString('cs-CZ');
const parseJson = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

// Vrací { cfg, errors } — cfg obsahuje zadané hodnoty vždy (bez ořezu), errors = seznam překročených limitů.
function sanitize(b) {
  const errors = [];
  const s = (v) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  const chk = (label, val, max) => { if (val.length > max) errors.push(`${label}: ${cnt(val.length)} znaků, limit je ${cnt(max)} (přebývá ${cnt(val.length - max)}).`); return val; };
  const yes = (v) => v === '1' || v === 'on' || v === true;
  const cfg = {
    enabled: yes(b.enabled),
    name: chk('Jméno asistenta', s(b.name) || DEFAULTS.name, LIMITS.name),
    greeting: chk('Úvodní zpráva', s(b.greeting), LIMITS.greeting),
    tone: Object.prototype.hasOwnProperty.call(TONES, b.tone) ? b.tone : DEFAULTS.tone,
    reply_in_user_language: yes(b.reply_in_user_language),
    instructions: chk('Role a úkol asistenta', s(b.instructions), LIMITS.instructions),
    rules: chk('Pravidla a zákazy', s(b.rules), LIMITS.rules),
    include_products: yes(b.include_products),
    unknown_reply: chk('Věta při nevědění', s(b.unknown_reply), LIMITS.unknown_reply),
    contact: chk('Kontakt', s(b.contact), LIMITS.contact),
    model: MODELS.some(m => m[0] === b.model) ? b.model : (process.env.BS2_AI_MODEL || DEFAULTS.model),
  };
  // Témata znalostí
  const items = parseJson(b.knowledge_json).map(x => ({ title: s(x && x.title), text: s(x && x.text), enabled: !(x && x.enabled === false) })).filter(x => x.title || x.text);
  if (items.length > LIMITS.items_max) errors.push(`Témat znalostí je ${items.length}, limit je ${LIMITS.items_max}.`);
  items.forEach((x, i) => {
    const nm = `Téma ${i + 1}${x.title ? ' „' + x.title + '"' : ''}`;
    if (!x.title) errors.push(`${nm}: chybí název.`);
    chk(nm + ' – název', x.title, LIMITS.item_title); chk(nm + ' – text', x.text, LIMITS.item_text);
  });
  cfg.knowledge_items = items;
  // Příklady odpovědí
  const ex = parseJson(b.examples_json).map(x => ({ q: s(x && x.q), a: s(x && x.a) })).filter(x => x.q || x.a);
  if (ex.length > LIMITS.examples_max) errors.push(`Příkladů je ${ex.length}, limit je ${LIMITS.examples_max}.`);
  ex.forEach((x, i) => {
    if (!x.q || !x.a) errors.push(`Příklad ${i + 1}: vyplň otázku i odpověď.`);
    chk(`Příklad ${i + 1} – otázka`, x.q, LIMITS.example_q); chk(`Příklad ${i + 1} – odpověď`, x.a, LIMITS.example_a);
  });
  cfg.examples = ex;
  // Čísla — mimo rozsah = chyba (neupravuje se potichu)
  const num = (label, v, [lo, hi], def) => {
    const n = Number(String(v == null ? '' : v).replace(',', '.'));
    if (!isFinite(n) || String(v).trim() === '') { errors.push(`${label}: zadej číslo.`); return def; }
    if (n < lo || n > hi) errors.push(`${label}: ${n} je mimo rozsah ${lo}–${hi}.`);
    return n;
  };
  cfg.temperature = num('Teplota', b.temperature, LIMITS.temperature, DEFAULTS.temperature);
  cfg.max_tokens = Math.round(num('Max. délka odpovědi', b.max_tokens, LIMITS.max_tokens, DEFAULTS.max_tokens));
  // Celkový rozpočet instrukcí
  const total = totalChars(cfg);
  const tok = estimateTokens(total);
  if (tok > LIMITS.tokens_hard) errors.push(`Celkový objem instrukcí a znalostí je přibližně ${cnt(tok)} tokenů, maximum je ${cnt(LIMITS.tokens_hard)}. Zkrať znalosti (nebo vypni některá témata).`);
  return { cfg, errors };
}

// Součet znaků, které půjdou do AI (bez produktů — ty se doplňují za běhu).
function totalChars(cfg) {
  let n = (cfg.instructions || '').length + (cfg.rules || '').length + (cfg.unknown_reply || '').length + (cfg.contact || '').length;
  (cfg.knowledge_items || []).forEach(x => { if (x.enabled !== false) n += (x.title || '').length + (x.text || '').length + 6; });
  (cfg.examples || []).forEach(x => { n += (x.q || '').length + (x.a || '').length + 20; });
  return n;
}

async function saveConfig(cfg) {
  await q("INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [KEY, JSON.stringify(cfg)]);
}

// Systémové instrukce: role → pravidla → znalosti (po tématech) → příklady → produkty → nejistota/kontakt → závazné připomenutí na konci.
function buildSystem(cfg, productsText) {
  const parts = [];
  parts.push(`Jsi „${cfg.name}". ${cfg.instructions || ''}`.trim());
  parts.push(`STYL: ${TONES[cfg.tone] || TONES.friendly}. Odpovídej stručně a srozumitelně, bez markdownu, nadpisů a emoji. ` +
    (cfg.reply_in_user_language ? 'Odpovídej v jazyce, ve kterém se uživatel ptá (výchozí je čeština).' : 'Odpovídej vždy česky.'));
  if (cfg.rules) parts.push('PRAVIDLA A ZÁKAZY (závazná):\n' + cfg.rules);
  const items = (cfg.knowledge_items || []).filter(x => x.enabled !== false && (x.title || x.text));
  if (items.length) parts.push('ZNALOSTI (jediný zdroj faktů):\n' + items.map(x => `### ${x.title}\n${x.text}`).join('\n\n'));
  const ex = (cfg.examples || []).filter(x => x.q && x.a);
  if (ex.length) parts.push('PŘÍKLADY SPRÁVNÝCH ODPOVĚDÍ (drž se jejich obsahu a formulace u podobných otázek):\n' + ex.map(x => `Otázka: ${x.q}\nOdpověď: ${x.a}`).join('\n\n'));
  if (cfg.include_products && productsText) parts.push('AKTUÁLNÍ NABÍDKA PRÁDLOMATŮ (ceny bez DPH, platí jen toto):\n' + productsText);
  parts.push('KDYŽ NEVÍŠ: Neodhaduj. Řekni: „' + (cfg.unknown_reply || DEFAULTS.unknown_reply) + '"' +
    (cfg.contact ? '\nKontakt, na který uživatele odkážeš:\n' + cfg.contact : ''));
  parts.push('=== ZÁVAZNÉ PŘIPOMENUTÍ === Odpovídej VÝHRADNĚ podle instrukcí, pravidel, znalostí, příkladů a nabídky výše. ' +
    'Nic si nevymýšlej (ceny, procenta, termíny, podmínky). Při nejistotě použij větu pro nezodpovězené otázky. Odpověz co nejpřesněji a krátce. ' +
    'FORMÁT: Piš prostý text bez markdownu — nikdy nepoužívej hvězdičky (*, **), podtržítka, křížky (#) ani zpětné apostrofy. Výčet piš jako řádky začínající číslem a tečkou nebo pomlčkou.');
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

module.exports = { DEFAULTS, LIMITS, MODELS, TONES, loadConfig, sanitize, saveConfig, buildSystem, chat, totalChars, estimateTokens };
