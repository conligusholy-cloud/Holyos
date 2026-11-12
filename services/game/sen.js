// =============================================================================
// Laundromat Tycoon — sny hráče
// =============================================================================
// Hráč napíše, co by jednou chtěl mít. Model z toho udělá tři věci: název,
// odhad běžné ceny v Kč a značku ikony ze sady, kterou má hra nakreslenou.
// Cena jde do hry jedna ku jedné — auto za tři miliony stojí tři miliony
// laundry, tedy skoro tři prádlomaty.
//
// Kreslit obrázek modelem jsme zkoušeli a nestálo to za to: z auta byla
// šmouha. Ikona vypadá vždycky k světu a kdo chce svůj přesný kousek, nahraje
// si fotku.

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate, humanizeAiError } = require('../anthropic-retry');

const MODEL = process.env.GAME_SEN_MODEL || process.env.VOICE_MODEL || 'claude-haiku-4-5-20251001';
const CENA_MIN = 1000;
const CENA_MAX = 2000000000;

// Musí sedět se sadou ikon v public/compounder/game/game.js.
const IKONY = ['auto', 'motorka', 'kolo', 'lod', 'letadlo', 'dum', 'chata', 'byt',
  'bazen', 'strom', 'hodinky', 'diamant', 'technika', 'nabytek', 'cinka', 'hory',
  'nota', 'kniha', 'tlapka', 'jidlo', 'slunce', 'penize', 'srdce', 'hvezda'];

const SYSTEM = [
  'Hráč hry o budování sítě prádlomatů si zapisuje, co by si jednou chtěl dopřát.',
  'Z jeho věty udělej položku na nástěnku snů. Odpovídáš POUZE JSON objektem, bez markdownu.',
  '',
  'Tvar: {"nazev":"…","popis":"…","cena":123456,"rezie":1234,"ikona":"auto"}',
  '',
  '- nazev: dvě až čtyři slova česky, konkrétní („Sportovní auto", „Chata v horách").',
  '  Značku ani model do názvu nedávej.',
  '- popis: jedna věta česky, co to je a proč se na to vyplatí šetřit. Bez patosu.',
  '- cena: běžná pořizovací cena v Kč jako celé číslo, nová věc, české ceny, bez extrémů.',
  '  U nehmotných přání (klid, čas, rok volna) dej cenu toho, co by to doopravdy stálo.',
  '- rezie: běžné MĚSÍČNÍ náklady na provoz té věci v Kč jako celé číslo — servis, pojištění,',
  '  palivo, garáž či hangár, poplatky, u letadla i pilot. Co se neprovozuje (hodinky, šperk,',
  '  obraz), má rezie 0. Drž se skutečnosti: auto za tři miliony stojí měsíčně řádově tisíce,',
  '  soukromé letadlo řádově statisíce.',
  '- ikona: právě jedna značka z této sady, ta nejbližší: ' + IKONY.join(', ') + '.',
  '  Když nic nesedí, dej hvezda.',
].join('\n');

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
      model: MODEL, max_tokens: 400, system: SYSTEM,
      messages: [{ role: 'user', content: 'Sen hráče: ' + String(zadani || '').slice(0, 200) }],
    }, { label: 'game-sen' });
    const text = ((resp && resp.content) || [])
      .filter((c) => c && c.type === 'text').map((c) => c.text).join('').trim();
    const j = vytahniJson(text);
    if (!j) return { ok: false, error: 'Tomuhle snu jsem nerozuměl. Zkus to napsat jinak.' };
    const cena = cislo(j.cena);
    if (!cena) return { ok: false, error: 'Nepovedlo se odhadnout cenu. Zkus to popsat konkrétněji.' };
    const ikona = IKONY.indexOf(String(j.ikona || '').trim()) >= 0 ? String(j.ikona).trim() : 'hvezda';
    return { ok: true, sen: {
      nazev: String(j.nazev || zadani).slice(0, 80),
      popis: String(j.popis || '').slice(0, 300) || null,
      cena, ikona,
      rezie: Math.max(0, Math.min(cena, Math.round(Number(j.rezie) || 0))),
    } };
  } catch (e) {
    console.warn('[game-sen]', e && e.message);
    return { ok: false, error: humanizeAiError ? humanizeAiError(e) : 'Sny teď nejde zakládat.' };
  }
}

module.exports = { vymysli, IKONY };
