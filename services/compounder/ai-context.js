// =============================================================================
// HolyOS — Sdílený kontext pro AI o prádlomatech (chat i hlas)
// =============================================================================
// Pojistky proti vymýšlení + přesná matematika + ZÁVAZNÉ firemní podklady
// (stejná znalostní báze jako AI specialista). Používá chat i telefonní AI,
// aby se všude drželo scénáře a nevymýšlela si fakta.
'use strict';

const { getSetting } = require('../settings');
const knowledge = require('./knowledge');

// Pojistka proti vymýšlení — platí vždy (i pro vlastní scénář).
const GUARDRAILS =
  'PŘÍSNÉ DODRŽENÍ SCÉNÁŘE — NEJDŮLEŽITĚJŠÍ PRAVIDLO: ' +
  'Odpovídej VÝHRADNĚ na základě informací ve scénáři, v kontextu a v přiložených podkladech. ' +
  'NIKDY si nevymýšlej ani neodhaduj údaje, které tam nejsou — ceny, čísla, návratnost, verze, parametry strojů (kapacity v kg, rozměry), dostupnost, názvy lokalit, termíny. ' +
  'Nepoužívej interní kódy (V2, V3, BOTH) a netvař se, že „BOTH" je název modelu. ' +
  'Když se ptají na něco, co nemáš podložené, NEIMPROVIZUJ: přiznej to, řekni, že přesné údaje potvrdí kolega, a nabídni další krok (schůzka / zavolání). Radši polož upřesňující otázku, než abys tipoval.';

const MATH_RULE =
  'MATEMATIKA: Když počítáš (návratnost, tržby, náklady), postupuj krok za krokem a používej JEN čísla z podkladů/scénáře. Výsledek rozumně zaokrouhli a v duchu si ho ověř. Když chybí vstup, zeptej se na něj místo odhadu.';

// Styl pro TELEFON (mluvený projev) — bez markdownu, krátké věty.
const VOICE_STYLE =
  'MLUVENÝ PROJEV (telefon): Mluvíš, nepíšeš. Krátké přirozené věty, žádný markdown, odrážky ani emoji. ' +
  'Neříkej nahlas „hvězdička" ani „odrážka". Buď stručný a lidský, nech prostor druhé straně a ptej se.';

// Načte znalostní bázi (nahrané podklady AI specialisty) jako blok do promptu.
async function loadKnowledgeBlock() {
  try {
    const docs = await getSetting('compounder.ai_specialist_docs', { type: 'json', defaultValue: [] });
    const block = knowledge.buildKnowledgeBlock(Array.isArray(docs) ? docs : []);
    if (!block) return '';
    return '\n\n=== ZÁVAZNÉ FIREMNÍ PODKLADY (nejvyšší zdroj pravdy — čísla a fakta přebírej PŘESNĚ odsud) ===\n'
      + block + '\n=== KONEC PODKLADŮ ===';
  } catch (e) { return ''; }
}

// Sestaví doplněk k libovolnému scénáři: guardrails + matematika + (volitelně hlasový styl) + podklady.
async function augmentSystem(baseSystem, { voice = false } = {}) {
  const kb = await loadKnowledgeBlock();
  const parts = [String(baseSystem || ''), GUARDRAILS, MATH_RULE];
  if (voice) parts.push(VOICE_STYLE);
  return parts.join('\n\n') + kb;
}

module.exports = { GUARDRAILS, MATH_RULE, VOICE_STYLE, loadKnowledgeBlock, augmentSystem };
