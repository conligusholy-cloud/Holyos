// HolyOS — Compounder i18n sync
// =============================================================================
// JEDINÝ ZDROJ PRAVDY = anglická báze v public/compounder/i18n.js (strings.en).
// Uprav anglický text TAM, spusť tento skript a ten dopřeloží JEN změněné/chybějící
// klíče do všech jazyků z LANGS a zapíše public/compounder/i18n/<code>.json.
// Co se nezměnilo, zůstává beze změny (žádné zbytečné přepisování ani náklady).
//
// Použití (z kořene repa):
//   node scripts/compounder-i18n-sync.js            # dopřeloží změny do všech jazyků
//   node scripts/compounder-i18n-sync.js --all      # přeloží VŠECHNO znovu (rebuild)
//   node scripts/compounder-i18n-sync.js --lang fr  # jen jeden jazyk
//   node scripts/compounder-i18n-sync.js --dry      # jen ukáže, co by přeložil
//
// Vyžaduje ANTHROPIC_API_KEY (stejné jako zbytek HolyOS AI). Model: claude-sonnet-4-6.
// Po doběhnutí: git add public/compounder/i18n scripts/.compounder-i18n-en-snapshot.json && railway up
// =============================================================================

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..');
const I18N_JS = path.join(ROOT, 'public', 'compounder', 'i18n.js');
const I18N_DIR = path.join(ROOT, 'public', 'compounder', 'i18n');
const SNAP = path.join(__dirname, '.compounder-i18n-en-snapshot.json');
const MODEL = process.env.COMPOUNDER_I18N_MODEL || 'claude-sonnet-4-6';

// Klíče, které zůstávají v angličtině napříč jazyky (brand slogany) — nepřekládat.
const BRAND_KEEP = new Set(['hero.freedom', 's4.title', 's4.t1k', 's4.t2k', 's4.t3k']);

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const DRY = args.includes('--dry');
const ONLY = (args.indexOf('--lang') >= 0) ? args[args.indexOf('--lang') + 1] : null;

function loadI18n() {
  const code = fs.readFileSync(I18N_JS, 'utf8');
  const w = {};
  // i18n.js dělá: window.COMPOUNDER_I18N = {...}
  new Function('window', code)(w);
  if (!w.COMPOUNDER_I18N) throw new Error('Nepodařilo se načíst COMPOUNDER_I18N z i18n.js');
  return w.COMPOUNDER_I18N;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function stripFences(t) {
  return String(t || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
}

async function translateBatch(client, code, name, src) {
  const sys =
    'You are a professional translator for a premium fintech / real-estate brand website (Compounder by Best Series). ' +
    'Translate the given UI strings from English into ' + name + ' (' + code + '). Rules:\n' +
    '- Keep these brand terms EXACTLY as-is, untranslated: Compounder, Compounding, Compounder Machine, Compounder Card, Compounder Portal, Best Series.\n' +
    '- Keep ALL placeholders unchanged, e.g. {pct}.\n' +
    '- Keep units / symbols unchanged: €, V, A, m, 24/7, 3/4", LTE, 5G, ROI.\n' +
    '- Tone: concise, confident, premium. Use the natural formal register of the language.\n' +
    '- Return ONLY a minified JSON object mapping each input key to its translated string. No commentary, no code fences.';
  const user = 'Target language: ' + name + ' (' + code + ')\nTranslate the values of this JSON (keep the keys identical):\n' + JSON.stringify(src, null, 1);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: sys,
      messages: [{ role: 'user', content: user }],
    });
    const text = stripFences(resp.content.map((b) => b.text || '').join(''));
    try {
      const obj = JSON.parse(text);
      // jistota: jen klíče, které jsme poslali
      const out = {};
      Object.keys(src).forEach((k) => { if (typeof obj[k] === 'string' && obj[k].trim()) out[k] = obj[k]; });
      return out;
    } catch (e) {
      if (attempt === 2) throw new Error('Claude nevrátil validní JSON (' + code + '): ' + e.message);
    }
  }
}

(async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('CHYBA: ANTHROPIC_API_KEY není nastaven. (echo $env:ANTHROPIC_API_KEY)');
    process.exit(1);
  }
  const I18N = loadI18n();
  const base = I18N.base || 'en';
  const EN = I18N.strings[base] || {};
  const snapshot = ALL ? {} : readJson(SNAP, {});
  const translatable = Object.keys(EN).filter((k) => !BRAND_KEEP.has(k));
  const changed = translatable.filter((k) => EN[k] !== snapshot[k]); // nové nebo změněné

  let langs = Object.keys(I18N.LANGS).filter((c) => c !== base);
  if (ONLY) langs = langs.filter((c) => c === ONLY);

  console.log('Báze: ' + base + ' · klíčů: ' + translatable.length + ' · změněných od minule: ' + changed.length + (ALL ? ' (--all: vše)' : ''));
  if (!ALL && !changed.length && !ONLY) {
    console.log('Nic se nezměnilo — jazyky jsou aktuální. (Pokud chybí klíče, doplní se i tak.)');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let touched = 0;

  for (const code of langs) {
    const file = path.join(I18N_DIR, code + '.json');
    const existing = readJson(file, {});
    const todo = ALL
      ? translatable.slice()
      : translatable.filter((k) => changed.includes(k) || !(k in existing));
    if (!todo.length) { console.log('  ' + code + ' — aktuální'); continue; }

    const src = {};
    todo.forEach((k) => { src[k] = EN[k]; });
    console.log('  ' + code + ' — překládám ' + todo.length + ' klíčů…' + (DRY ? ' (dry)' : ''));
    if (DRY) { touched++; continue; }

    try {
      const translated = await translateBatch(client, code, I18N.LANGS[code], src);
      Object.assign(existing, translated);
      fs.writeFileSync(file, JSON.stringify(existing, null, 1), 'utf8');
      touched++;
    } catch (e) {
      console.error('  ' + code + ' — CHYBA: ' + e.message + ' (přeskakuji)');
    }
  }

  if (!DRY) {
    fs.writeFileSync(SNAP, JSON.stringify(EN, null, 1), 'utf8');
    console.log('Snapshot aktualizován. Hotovo — ' + touched + ' jazyk(ů) upraveno.');
    console.log('Dál: git add public/compounder/i18n scripts/.compounder-i18n-en-snapshot.json && git commit -m "i18n sync" && railway up');
  } else {
    console.log('DRY běh — ' + touched + ' jazyk(ů) by se upravilo. Nic nezapsáno.');
  }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
