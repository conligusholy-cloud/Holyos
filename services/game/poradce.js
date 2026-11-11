// =============================================================================
// Laundromat Tycoon — AI poradce ve hře
// =============================================================================
// Hráč se zeptá vlastními slovy a dostane odpověď, která počítá s jeho hrou:
// kolik má hotovosti, co mu kde stojí, co ho dusí na splátkách. Pravidla hry
// jsou v systémovém promptu, čísla posílá klient (hra žije v prohlížeči).
//
// Zásady: krátce, česky, konkrétně a bez vymýšlení. Když se hráč ptá na něco
// mimo hru, poradce to řekne a vrátí ho zpátky ke hře.

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { messagesCreate, humanizeAiError } = require('../anthropic-retry');

const MODEL = process.env.GAME_PORADCE_MODEL || process.env.VOICE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 600;

const PRAVIDLA = [
  'Jsi poradce ve hře Laundromat Tycoon (pradlomaty.info/game). Hráč v ní staví síť venkovních',
  'samoobslužných prádlomatů na skutečné mapě. Mluvíš česky, tykáš, jsi stručný a konkrétní.',
  '',
  'JAK HRA FUNGUJE (drž se toho, nic si nevymýšlej):',
  '- Měna jsou laundry (L$). Jeden skutečný den = dva herní měsíce, síť vydělává i při zavřené hře.',
  '- Stroje: MINI (nejlevnější, ~1,07 M L$), FLEX (~1,58 M), MAX (~2,04 M). Větší stroj zvládne víc',
  '  zákazníků, ale na slabém místě se nevyplatí.',
  '- Místo se musí nejdřív najít: průzkum města stojí 20 000 L$, obhlídka jednoho místa 5 000 L$.',
  '  Každé místo má skóre 0–100 (parkování, tahouni provozu, konkurence do 1,5 km).',
  '- Na místě se platí nájem měsíčně a jednorázově přípojky (voda, odpad, elektřina) — ty bývají',
  '  desítky až stovky tisíc. Z obratu jde 9 % na energie a 13 % na servis a úklid.',
  '- Nájemní smlouva má vázanost a výpovědní dobu. Delší vázanost je dražší, ale chrání:',
  '  konkurence může místo přeplatit a majitel pozemku může sám vypovědět.',
  '- Pozemek se dá koupit (pak se neplatí nájem a nikdo místo nepřeplatí) a dál pronajmout.',
  '- Banka: každý profil má jiný strop zástavy a úrok (opatrný 70 %/9,6 %, vyvážený 85 %/11,4 %,',
  '  dravý 100 %/13,2 %). Banka půjčí jen tolik, kolik unese splátka — chce krytí aspoň 1,25×.',
  '- Rámcový úvěr: revolvingový limit pro ty, kdo už mají dva doplacené prádlomaty. Limit = 1,2 M',
  '  za každý doplacený stroj nad první, omezený tím, co unese zisk. Banka ho přehodnocuje.',
  '- Stroje se porouchají (v průměru 4× za herní rok). Porouchaný nevydělává, ale nájem a servis',
  '  běží dál — technika je potřeba poslat hned.',
  '- Karty: Expresní dovoz (stroj hned, jinak se veze dva herní měsíce), Reklamní kampaň',
  '  (+15 % návštěvnosti natrvalo), Známý řemeslník (přípojky −40 %), Lepší bankéř (úrok −2 pb).',
  '- Tržiště: hotová provozovna i s místem, nájemní smlouvou a přípojkami. Vydělává hned,',
  '  banka ji financuje se spoluúčastí 20 %.',
  '- Infolinka: hráč bere hovory zákazníků. Dobré odpovědi zvednou pověst a návštěvnost.',
  '',
  'JAK ODPOVÍDAT:',
  '- Nejvýš pět vět nebo pět odrážek. Žádné dlouhé úvody.',
  '- Používej hráčova čísla, která máš v přehledu níž. Když něco v přehledu není, řekni to',
  '  a nehádej.',
  '- Vždy skonči jedním konkrétním krokem, co má udělat teď.',
  '- Když se ptá na něco mimo hru, krátce to odmítni a nabídni, s čím ve hře poradíš.',
  '- Nikdy netvrď, že laundry mají skutečnou hodnotu — je to herní měna a hra není investice.',
].join('\n');

// Přehled hry do promptu. Jen čísla, nic osobního — hra žádné osobní údaje nemá.
function prehled(st) {
  if (!st || typeof st !== 'object') return 'Hráč zatím nemá rozehráno.';
  const r = [];
  const n = (x) => Math.round(Number(x) || 0).toLocaleString('cs-CZ');
  r.push('Herní rok: ' + (st.rok || 1) + ', profil: ' + (st.profil || 'neznámý'));
  r.push('Hotovost: ' + n(st.cash) + ' L$, dluh: ' + n(st.dluh) + ' L$, volno v bance: ' + n(st.bank) + ' L$');
  r.push('Měsíčně: zisk sítě ' + n(st.zisk) + ', splátky ' + n(st.splatky) + ', zbyde ' + n(st.zbyde) + ' L$');
  if (st.ramec) {
    r.push('Rámcový úvěr: limit ' + n(st.ramec.limit) + ', vyčerpáno ' + n(st.ramec.cerpano)
      + ', k čerpání ' + n(st.ramec.volny) + ' L$');
  } else r.push('Rámcový úvěr: zatím žádný (chce to dva doplacené prádlomaty)');
  r.push('Prádlomatů v provozu: ' + (st.pocet || 0)
    + (st.sklad ? ', na skladě: ' + st.sklad : '')
    + (st.cesta ? ', na cestě: ' + st.cesta : '')
    + ', měst prozkoumáno: ' + (st.mest || 0));
  if (st.poruchy) r.push('Právě porouchané stroje: ' + st.poruchy);
  if (st.vypovedi) r.push('Běžící výpovědi z místa: ' + st.vypovedi);
  if (st.povest != null) r.push('Pověst z infolinky: ' + st.povest + ' (−100 až +100)');
  if (Array.isArray(st.mista) && st.mista.length) {
    r.push('Místa (název · model · skóre · nájem · zisk za měsíc):');
    st.mista.slice(0, 20).forEach((m) => {
      r.push('  - ' + m.name + ' · ' + (m.model || '?') + ' · skóre ' + (m.score != null ? m.score : '?')
        + ' · nájem ' + n(m.rent) + ' · zisk ' + n(m.zisk)
        + (m.porucha ? ' · POROUCHANÝ' : '') + (m.vypoved ? ' · VÝPOVĚĎ' : ''));
    });
  }
  if (st.styl) r.push('Jak hraje: ' + st.styl);
  return r.join('\n');
}

async function poradit({ otazka, stav, historie }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Poradce teď není k dispozici.' };
  const client = new Anthropic({ apiKey });
  const zpravy = [];
  (Array.isArray(historie) ? historie.slice(-6) : []).forEach((h) => {
    if (!h || !h.role || !h.text) return;
    zpravy.push({ role: h.role === 'ai' ? 'assistant' : 'user', content: String(h.text).slice(0, 2000) });
  });
  zpravy.push({ role: 'user', content:
    'PŘEHLED MOJÍ HRY:\n' + prehled(stav) + '\n\nOTÁZKA: ' + String(otazka || '').slice(0, 600) });
  try {
    const resp = await messagesCreate(client, {
      model: MODEL, max_tokens: MAX_TOKENS, system: PRAVIDLA, messages: zpravy,
    }, { label: 'game-poradce' });
    const text = ((resp && resp.content) || [])
      .filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim();
    if (!text) return { ok: false, error: 'Poradce teď neví, co říct. Zkus to ještě jednou.' };
    return { ok: true, text };
  } catch (e) {
    console.warn('[game-poradce]', e && e.message);
    return { ok: false, error: humanizeAiError ? humanizeAiError(e) : 'Poradce teď není k dispozici.' };
  }
}

module.exports = { poradit };
