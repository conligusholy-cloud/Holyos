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

// Odhad pohlaví z českého jména/příjmení → 'male' | 'female' | null.
// Nejsilnější signál je příjmení (ženská skoro vždy končí na -á). Doplňkově křestní.
function detectGenderCz(firstName, lastName, fullName) {
  const low = (s) => String(s || '').trim().toLowerCase();               // ponechá diakritiku (kvůli „-á")
  const strip = (s) => low(s).normalize('NFD').replace(/[̀-ͯ]/g, '');    // bez diakritiky (na porovnání se sadami)
  let fnRaw = low(firstName), lnRaw = low(lastName);
  if (!fnRaw && !lnRaw && fullName) {
    const parts = low(fullName).split(/\s+/).filter(Boolean);
    if (parts.length >= 2) { fnRaw = parts[0]; lnRaw = parts[parts.length - 1]; }
    else if (parts.length === 1) { fnRaw = parts[0]; }
  }
  const fn = strip(fnRaw);

  const MALE = new Set(['jan', 'petr', 'josef', 'jiri', 'martin', 'tomas', 'pavel', 'jaroslav', 'miroslav', 'zdenek', 'frantisek', 'vaclav', 'michal', 'jakub', 'david', 'lukas', 'ondrej', 'radek', 'roman', 'marek', 'milan', 'ivan', 'karel', 'antonin', 'vladimir', 'daniel', 'filip', 'stanislav', 'ladislav', 'adam', 'vojtech', 'matej', 'dominik', 'patrik', 'robert', 'rostislav', 'boris', 'mirek', 'honza', 'petr']);
  const FEMALE = new Set(['jana', 'eva', 'hana', 'anna', 'lenka', 'katerina', 'lucie', 'vera', 'alena', 'petra', 'veronika', 'jaroslava', 'marie', 'martina', 'jitka', 'zdena', 'ivana', 'barbora', 'barbara', 'michaela', 'tereza', 'monika', 'zuzana', 'kristyna', 'nikola', 'gabriela', 'dana', 'pavla', 'denisa', 'sarka', 'sona', 'radka', 'simona', 'marketa', 'liliana', 'aneta', 'bozena', 'natalie', 'natalia', 'iveta', 'drahoslava', 'bohuslava']);

  // 1) Křestní jméno ze známé sady (nejspolehlivější, řeší i mužská příjmení na -a).
  if (fn) {
    if (MALE.has(fn)) return 'male';
    if (FEMALE.has(fn)) return 'female';
  }
  // 2) Příjmení: české ženské příjmení končí na „á" (Nováková, Krátká) — s diakritikou;
  //    u dat bez diakritiky bereme koncovky -ova/-cka/-ska. Mužská na „a" (Svoboda, Čada) NE.
  if (lnRaw) {
    if (/á$/.test(lnRaw) || /(ova|cka|ska|na|la|ta|ra)$/.test(lnRaw) && /á$/.test(lnRaw)) return 'female';
    if (/(ová|cká|ská|á)$/.test(lnRaw)) return 'female';
    if (/(ova|cka|ska)$/.test(strip(lnRaw))) return 'female';
  }
  // 3) Koncovka křestního jména jako slabší signál.
  if (fn) {
    if (/(a|e)$/.test(fn)) return 'female';           // Jana, Marie, Lucie
    if (/[bcdfghjklmnprstvzx]$/.test(fn)) return 'male'; // většina mužských končí souhláskou
  }
  return null;
}

// Pokyn pro AI, jak oslovovat/skloňovat podle pohlaví (2. osoba, minulý čas, oslovení).
function genderInstruction(gender) {
  if (gender === 'female') {
    return 'POHLAVÍ ZÁKAZNÍKA: žena. Komunikuj v ŽENSKÉM rodě — 2. osoba minulého času a příčestí v ženském tvaru '
      + '(např. „byla byste", „měla byste", „uvažovala jste", „mohla byste"). Oslovení „paní". Nikdy nepoužij mužské tvary.';
  }
  if (gender === 'male') {
    return 'POHLAVÍ ZÁKAZNÍKA: muž. Komunikuj v MUŽSKÉM rodě — 2. osoba minulého času a příčestí v mužském tvaru '
      + '(např. „byl byste", „měl byste", „uvažoval jste", „mohl byste"). Oslovení „pane". Nikdy nepoužij ženské tvary.';
  }
  // neznámé pohlaví → neutrální, ať se netrefí špatně
  return 'POHLAVÍ ZÁKAZNÍKA: nejisté. Vol, prosím, neutrální formulace a vyhýbej se rodově vyhraněnému minulému času '
    + '(použij např. přítomný čas nebo neutrální obraty), ať nikoho neoslovíš špatným rodem.';
}

// Oddělené znalostní báze podle kontextu (mohou se lišit).
function docsSettingKey(scope) {
  if (scope === 'inbound') return 'voice.inbound_docs';
  // Per-kampaň: scope 'outbound:<id>' → vlastní podklady dané kampaně.
  if (typeof scope === 'string' && scope.indexOf('outbound:') === 0) return 'voice.outbound_docs.' + scope.slice(9);
  if (scope === 'outbound') return 'voice.outbound_docs';
  return 'compounder.ai_specialist_docs'; // 'specialist' (default)
}

// Načte znalostní bázi daného kontextu jako blok do promptu.
async function loadKnowledgeBlock(scope) {
  try {
    const docs = await getSetting(docsSettingKey(scope), { type: 'json', defaultValue: [] });
    const block = knowledge.buildKnowledgeBlock(Array.isArray(docs) ? docs : []);
    if (!block) return '';
    return '\n\n=== ZÁVAZNÉ FIREMNÍ PODKLADY (nejvyšší zdroj pravdy — čísla a fakta přebírej PŘESNĚ odsud) ===\n'
      + block + '\n=== KONEC PODKLADŮ ===';
  } catch (e) { return ''; }
}

// Sestaví doplněk k libovolnému scénáři: guardrails + matematika + (volitelně hlasový styl) + podklady.
async function augmentSystem(baseSystem, { voice = false, scope = 'specialist' } = {}) {
  const kb = await loadKnowledgeBlock(scope);
  const parts = [String(baseSystem || ''), GUARDRAILS, MATH_RULE];
  if (voice) parts.push(VOICE_STYLE);
  return parts.join('\n\n') + kb;
}

module.exports = { GUARDRAILS, MATH_RULE, VOICE_STYLE, docsSettingKey, loadKnowledgeBlock, augmentSystem, detectGenderCz, genderInstruction };
