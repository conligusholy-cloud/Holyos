// =============================================================================
// Laundromat Tycoon — sny hráče
// =============================================================================
// Hráč napíše, co by jednou chtěl mít. Model z toho udělá tři věci: název,
// odhad běžné ceny v Kč a kreslený obrázek. Cena jde do hry jedna ku jedné —
// auto za tři miliony stojí tři miliony laundry, tedy skoro tři prádlomaty.
//
// Obrázek je kreslená ilustrace, ne fotka a ne značka: z „Porsche 911" vyjde
// elegantní sporťák bez loga. Kdo chce svůj přesný kousek, nahraje si fotku.
//
// SVG od modelu nikdy nevěříme — projde filtrem a v prohlížeči se ukazuje
// uvnitř <img>, kde se ani případný skript nespustí.

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate, humanizeAiError } = require('../anthropic-retry');

const MODEL = process.env.GAME_SEN_MODEL || process.env.VOICE_MODEL || 'claude-haiku-4-5-20251001';
const CENA_MIN = 1000;
const CENA_MAX = 2000000000;
const SVG_MAX = 9000;

const SYSTEM = [
  'Hráč hry o budování sítě prádlomatů si zapisuje, co by si jednou chtěl dopřát.',
  'Z jeho věty udělej položku na nástěnku snů. Odpovídáš POUZE JSON objektem, bez uvozovek kolem,',
  'bez markdownu, bez vysvětlování.',
  '',
  'Tvar: {"nazev":"…","popis":"…","cena":123456,"svg":"<svg …>…</svg>"}',
  '',
  '- nazev: dvě až čtyři slova česky, konkrétní (například „Sportovní auto", „Chata v horách").',
  '  Značku nebo model do názvu nedávej.',
  '- popis: jedna věta česky, co to je a proč se na to vyplatí šetřit. Bez patosu.',
  '- cena: běžná pořizovací cena v Kč jako celé číslo, nová věc, české ceny, bez extrémů.',
  '  U nehmotných přání (klid, zdraví, čas) dej symbolickou cenu podle toho, co by stálo',
  '  si to dopřát — třeba rok volna jako roční náklady života.',
  '- svg: jednoduchá plochá ilustrace té věci. Pravidla, která musíš dodržet:',
  '  xmlns a viewBox="0 0 320 200" musí být uvedené, šířku ani výšku nedávej, nejvýš osm tisíc znaků;',
  '  jen tvary (path, rect, circle, ellipse, polygon, line, g, defs, linearGradient, stop);',
  '  žádný text, žádné obrázky, žádné skripty, žádné odkazy ven;',
  '  tmavé pozadí ladící s hrou (#111a2b až #1b2740) a barvy #4fd1ff, #7c5cff, #2fe3a0, #ffd866;',
  '  nikdy nekresli loga, znaky značek, nápisy ani skutečné osoby — kresli druh věci,',
  '  ne konkrétní model.',
].join('\n');

// Z modelu leze leccos; chceme jen bezpečné tvary.
function ocistiSvg(svg) {
  let s = String(svg || '').trim();
  if (!s || s.indexOf('<svg') !== 0) return null;
  if (s.length > SVG_MAX) return null;
  if (/<\s*(script|foreignObject|image|use|a|iframe|style|animate)\b/i.test(s)) return null;
  if (/\son[a-z]+\s*=/i.test(s)) return null;           // onclick a spol.
  if (/(javascript:|data:text\/html|<!ENTITY|xlink:href|href\s*=)/i.test(s)) return null;
  if (!/viewBox\s*=/.test(s)) return null;
  // Bez jmenného prostoru se SVG uvnitř <img> nevykreslí — doplníme ho.
  if (!/xmlns\s*=/.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

function cislo(x) {
  const n = Math.round(Number(x) || 0);
  if (!Number.isFinite(n) || n < CENA_MIN) return 0;
  return Math.min(CENA_MAX, n);
}

function vytahniJson(text) {
  const t = String(text || '').trim();
  const od = t.indexOf('{'), kam = t.lastIndexOf('}');
  if (od < 0 || kam <= od) return null;
  try { return JSON.parse(t.slice(od, kam + 1)); } catch (e) { return null; }
}

async function vymysli(zadani) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Sny teď nejde zakládat.' };
  const client = new Anthropic({ apiKey });
  try {
    const resp = await messagesCreate(client, {
      model: MODEL, max_tokens: 4000, system: SYSTEM,
      messages: [{ role: 'user', content: 'Sen hráče: ' + String(zadani || '').slice(0, 200) }],
    }, { label: 'game-sen' });
    const text = ((resp && resp.content) || [])
      .filter((c) => c && c.type === 'text').map((c) => c.text).join('').trim();
    const j = vytahniJson(text);
    if (!j) return { ok: false, error: 'Tomuhle snu jsem nerozuměl. Zkus to napsat jinak.' };
    const cena = cislo(j.cena);
    if (!cena) return { ok: false, error: 'Nepovedlo se odhadnout cenu. Zkus to popsat konkrétněji.' };
    return { ok: true, sen: {
      nazev: String(j.nazev || zadani).slice(0, 80),
      popis: String(j.popis || '').slice(0, 300) || null,
      cena,
      obrazek: ocistiSvg(j.svg),
    } };
  } catch (e) {
    console.warn('[game-sen]', e && e.message);
    return { ok: false, error: humanizeAiError ? humanizeAiError(e) : 'Sny teď nejde zakládat.' };
  }
}

module.exports = { vymysli, ocistiSvg };
