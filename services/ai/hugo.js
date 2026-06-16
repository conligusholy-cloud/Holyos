// =============================================================================
// HolyOS — Hugo AI Servisák
// Anthropic Claude orchestrator pro chat s partnery na bestseries.cash.
// Načte relevantní ServiceArticle z DB (RAG bez embeddings — MVP fulltext),
// předá Claudovi jako kontext, uloží konverzaci + citace.
// =============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const { prisma } = require('../../config/database');

const HUGO_MODEL = process.env.HUGO_MODEL || 'claude-sonnet-4-6';
const RETRIEVAL_LIMIT = 6;
const MANUAL_PASSAGE_LIMIT = 4;     // max kolik PDF pasáží přidáme do kontextu
const MANUAL_PASSAGE_CHARS = 1500;  // délka okna kolem zásahu v extrahovaném textu
const MAX_HISTORY_TURNS = 10;
const TOOL_USE_MAX_ITERATIONS = 4; // ochrana proti smyčkám tool-use ↔ tool_result (3 nástroje: shop, list, search)

// ─── Tool: search_shop_products (Spare Parts Shop) ─────────────────────────
//
// Hugo umí během konverzace zavolat tento nástroj a vyhledat náhradní díly v
// eshopu pro konkrétní firmu partnera (cena z přiřazeného ceníku, dostupnost
// v eshop skladu po odečtu rezervací). Pokud partner nemá ceník, tool vrátí
// prázdný seznam s hintem.

const SHOP_TOOL = {
  name: 'search_shop_products',
  description: 'Vyhledá náhradní díly v eshopu Best Series Spare Parts Shop. Použij když partner ptá na konkrétní díl (motor, řemen, ventil, čerpadlo, displej...) nebo když navrhuješ co objednat. Vrátí seznam položek s názvem, cenou v partnerově ceníku a dostupností. Pokud partner nemá přiřazený ceník nebo položka není v katalogu, vrátí prázdný seznam s hintem. URL na detail produktu posílej partnerovi v odpovědi.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Klíčová slova pro hledání — název dílu, kód, EAN. Hledá v kódu, názvu i marketing popisu.' },
    },
    required: ['query'],
  },
};

async function executeSearchShopProducts({ query, partner }) {
  if (!partner || !partner.company || !partner.company.id) {
    return { products: [], hint: 'Partner nemá v profilu firmu — eshop dostupný není.' };
  }
  const co = await prisma.company.findUnique({
    where: { id: partner.company.id },
    select: {
      eshop_pricelist_id: true,
      eshop_pricelist: { select: { id: true, currency: true, vat_pct: true, active: true, name: true } },
    },
  });
  if (!co || !co.eshop_pricelist_id || !co.eshop_pricelist || !co.eshop_pricelist.active) {
    return { products: [], hint: 'Partner nemá přiřazený aktivní ceník pro Spare Parts Shop. Neuvádět konkrétní ceny.' };
  }
  const q = String(query || '').trim();
  if (q.length < 2) return { products: [], hint: 'Příliš krátký dotaz, zadej alespoň 2 znaky.' };

  const materials = await prisma.material.findMany({
    where: {
      sells_on_eshop: true,
      status: 'active',
      OR: [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { eshop_description: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, code: true, name: true, unit: true, eshop_warehouse_id: true, eshop_description: true },
    take: 10,
  });
  if (!materials.length) return { products: [], hint: 'Nic v katalogu Spare Parts Shop neodpovídá.' };

  const items = await prisma.eshopPricelistItem.findMany({
    where: { pricelist_id: co.eshop_pricelist_id, material_id: { in: materials.map(m => m.id) } },
    select: { material_id: true, price_excl_vat: true },
  });
  const priceMap = new Map(items.map(i => [i.material_id, Number(i.price_excl_vat)]));

  const out = [];
  const vat = Number(co.eshop_pricelist.vat_pct);
  const baseUrl = process.env.SHARE_BASE_URL || 'https://bestseries.cash';
  for (const m of materials) {
    const price = priceMap.get(m.id);
    if (price == null) continue;
    let stock = 0;
    if (m.eshop_warehouse_id) {
      const s = await prisma.stock.aggregate({
        where: { material_id: m.id, location: { warehouse_id: m.eshop_warehouse_id } },
        _sum: { quantity: true },
      });
      stock = Number(s._sum.quantity || 0);
    }
    const reserved = await prisma.shopOrderItem.aggregate({
      where: { material_id: m.id, order: { status: { in: ['new', 'confirmed', 'picking'] } } },
      _sum: { quantity: true },
    });
    const available = Math.max(0, stock - Number(reserved._sum.quantity || 0));
    if (available <= 0) continue;
    out.push({
      code: m.code,
      name: m.name,
      unit: m.unit,
      price_excl_vat: price,
      price_incl_vat: Math.round(price * (1 + vat / 100) * 100) / 100,
      currency: co.eshop_pricelist.currency,
      available_qty: available,
      url: `${baseUrl}/spare-parts`,
    });
  }
  return out.length
    ? { products: out, hint: `Nalezeno ${out.length} položek pro "${q}".` }
    : { products: [], hint: 'Položky odpovídají dotazu, ale nejsou skladem v eshop skladu.' };
}

// ─── Tool: list_appliance_manuals (PDF návody ke stažení) ──────────────────
//
// Hugo standardně čerpá z extrahovaného textu manuálů (pasáže [M1], [M2]).
// Tento nástroj použije JEN když partner explicitně chce samotný PDF dokument
// ("pošli mi instalační manuál", "kde stáhnu katalog ND"). Vrátí seznam manuálů
// dostupných pro spotřebiče v partnerových produktech + přímý odkaz ke stažení.

const MANUALS_TOOL = {
  name: 'list_appliance_manuals',
  description: 'Vrátí seznam PDF manuálů (návody, katalogy náhradních dílů, instalační/programovací manuály) dostupných pro spotřebiče v produktech partnera, včetně přímého odkazu ke stažení (download_url). Volej POUZE když partner výslovně chce samotný dokument/PDF ke stažení nebo se ptá "kde najdu / pošli mi / stáhnu manuál/návod/katalog". NEVOLÁJ jen pro zodpovězení technického dotazu — na to slouží pasáže [M1], [M2] v kontextu. Vrácené download_url předej partnerovi v odpovědi jako klikatelný odkaz.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Volitelný filtr podle názvu manuálu, názvu spotřebiče nebo modelu (např. "instalační", "programovací", "katalog", "SY180"). Prázdné = vrátit všechny dostupné manuály.' },
    },
  },
};

async function executeListApplianceManuals({ query, partner }) {
  const productIds = (partner?.products || []).map(p => p.product_id);
  if (!productIds.length) {
    return { manuals: [], hint: 'Partner nemá přiřazené produkty — manuály nejsou dostupné. Navrhni kontakt na servis.' };
  }
  const q = String(query || '').trim();
  const baseUrl = process.env.SHARE_BASE_URL || 'https://bestseries.cash';

  const manuals = await prisma.serviceApplianceManual.findMany({
    where: {
      appliance: { product_links: { some: { product_id: { in: productIds } } } },
      ...(q.length >= 2 ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { appliance: { name: { contains: q, mode: 'insensitive' } } },
          { appliance: { model_code: { contains: q, mode: 'insensitive' } } },
          { appliance: { manufacturer: { contains: q, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: { appliance: { select: { name: true, manufacturer: true } } },
    orderBy: { title: 'asc' },
    take: 25,
  });

  if (!manuals.length) {
    return { manuals: [], hint: q ? `Žádný manuál neodpovídá "${q}".` : 'Pro produkty partnera nejsou nahrané žádné manuály.' };
  }
  return {
    manuals: manuals.map(m => ({
      title: m.title,
      appliance: m.appliance?.name || '',
      manufacturer: m.appliance?.manufacturer || null,
      page_count: m.page_count,
      language: m.language,
      download_url: `${baseUrl}/api/hugo/manuals/${m.id}/download`,
    })),
    hint: `Nalezeno ${manuals.length} manuálů. Pošli partnerovi download_url jako odkaz.`,
  };
}

// ─── Tool: search_manuals (aktivní fulltext v PDF manuálech) ───────────────
//
// Na rozdíl od pasivních pasáží [M1]/[M2] (předpočítané z celé otázky) dává
// tento nástroj Hugovi možnost cíleně hledat konkrétní klíčová slova (chybový
// kód, díl, operace) — sám si zvolí dotaz a najde přesnější pasáž.

const SEARCH_MANUALS_TOOL = {
  name: 'search_manuals',
  description: 'Fulltextově prohledá PDF manuály výrobce (instalační, programovací, katalog ND) navázané na spotřebiče v produktech partnera a vrátí relevantní pasáže. Volej VŽDY, když partner řeší technický problém (chybový kód, porucha, postup, parametr, programování) a v kontextu výše nemáš dost informací z pasáží [M1]/[M2]. Zadej konkrétní klíčová slova z dotazu (např. chybový kód "E11", "ložisko", "odčerpání vody"). Z vrácených pasáží poraď a uveď, z jakého manuálu informace pochází.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Klíčová slova k vyhledání v manuálech — chybový kód, název dílu, název operace. Klidně víc slov.' },
    },
    required: ['query'],
  },
};

async function executeSearchManuals({ query, partner }) {
  const passages = await retrieveManualPassages({ query, partner, limit: MANUAL_PASSAGE_LIMIT });
  if (!passages.length) {
    return { passages: [], hint: 'V manuálech jsem k tomuto dotazu nic nenašel. Poraď obecně a zvaž doporučení servisu.' };
  }
  return {
    passages: passages.map(p => ({
      manual: p.title,
      appliance: p.appliance_name,
      page_count: p.page_count,
      passage: p.passage,
    })),
    hint: `Nalezeno ${passages.length} pasáží. Poraď z nich a uveď, z jakého manuálu informace pochází.`,
  };
}

async function executeHugoTool({ name, input, partner }) {
  if (name === 'search_shop_products') return executeSearchShopProducts({ query: input.query, partner });
  if (name === 'list_appliance_manuals') return executeListApplianceManuals({ query: input.query, partner });
  if (name === 'search_manuals') return executeSearchManuals({ query: input.query, partner });
  return { error: `Neznámý nástroj: ${name}` };
}

// ─── Persona ───────────────────────────────────────────────────────────────

function buildSystemPrompt({ partner, language, retrievedArticles, retrievedManuals }) {
  const partnerName = partner?.display_name || 'partner';
  const companyName = partner?.company?.name || 'svojí firmě';
  const productList = (partner?.products || [])
    .map(p => `#${p.product_id}${p.serial_no ? ` (SN ${p.serial_no})` : ''}`)
    .join(', ') || '(nepřiřazené)';

  const lang = (language || partner?.language || 'cs').toLowerCase();
  const langInstruction = ({
    cs: 'Odpovídej česky (Czech).',
    sk: 'Odpovedaj po slovensky (Slovak).',
    en: 'Reply in English.',
    de: 'Antworte auf Deutsch (German).',
    pl: 'Odpowiadaj po polsku (Polish).',
    hu: 'Válaszolj magyarul (Hungarian).',
    ro: 'Răspunde în limba română (Romanian).',
    hr: 'Odgovaraj na hrvatskom (Croatian).',
    sl: 'Odgovori v slovenščini (Slovenian).',
    sr: 'Одговарај на српском (Serbian).',
    bg: 'Отговаряй на български (Bulgarian).',
    es: 'Responde en español (Spanish).',
    it: 'Rispondi in italiano (Italian).',
    fr: 'Réponds en français (French).',
    pt: 'Responde em português (Portuguese).',
    nl: 'Antwoord in het Nederlands (Dutch).',
    el: 'Απάντησε στα ελληνικά (Greek).',
    da: 'Svar på dansk (Danish).',
    sv: 'Svara på svenska (Swedish).',
    no: 'Svar på norsk (Norwegian).',
    fi: 'Vastaa suomeksi (Finnish).',
    et: 'Vasta eesti keeles (Estonian).',
    lv: 'Atbildi latviešu valodā (Latvian).',
    lt: 'Atsakyk lietuviškai (Lithuanian).',
    ru: 'Отвечай по-русски (Russian).',
    uk: 'Відповідай українською (Ukrainian).',
  })[lang] || `Reply in the user's language (detect from their message).`;

  const knowledgeBlock = (retrievedArticles && retrievedArticles.length)
    ? retrievedArticles.map((a, i) => `
[${i + 1}] ${a.title}  (kind=${a.kind}, id=${a.id})
${a.summary ? 'Souhrn: ' + a.summary + '\n' : ''}${(a.body_md || '').slice(0, 2500)}
`).join('\n---\n')
    : '(žádné dohledané články z databáze)';

  // Pasáže z PDF manuálů výrobců (extrahované při uploadu, čerpá z nich Hugo)
  const manualBlock = (retrievedManuals && retrievedManuals.length)
    ? '\n\n## Pasáže z PDF manuálů výrobců (relevantní podle dotazu):\n\n' + retrievedManuals.map((m, i) => `
[M${i + 1}] Manuál "${m.title}" — spotřebič: ${m.appliance_name}${m.appliance_manufacturer ? ' (' + m.appliance_manufacturer + ')' : ''}${m.page_count ? ' · ' + m.page_count + ' str.' : ''}
${m.passage}
`).join('\n---\n')
    : '';

  return `Jsi **Hugo**, AI servisní asistent společnosti Best Series pro partnery provozující naše prádlomaty.

Tvoje role:
- Pomáháš partnerům (provozovatelům prádlomatů Best Series) v terénu řešit problémy se zařízením.
- Rady jsou konkrétní, krok po kroku (1. 2. 3.).
- Pokud problém vyžaduje výjezd technika, řekni to jasně a navrhni objednat servis.
- Když si nejsi jistý — řekni to a doporuč kontakt na servisního technika Best Series.

${langInstruction}

Partner, se kterým mluvíš:
- Jméno: ${partnerName}
- Firma: ${companyName}
- Provozované produkty: ${productList}

K dispozici máš tyto články z naší servisní znalostní báze (filtrované podle produktů partnera):

${knowledgeBlock}${manualBlock}

Můžeš zavolat nástroj **search_shop_products** pokud zjistíš, že partner potřebuje konkrétní náhradní díl. Nástroj vyhledá v eshopu Best Series Spare Parts Shop, vrátí ti název, cenu z partnerova ceníku, dostupnost a URL na detail produktu. Když vrátí položku, uveď ji v odpovědi (kód, název, cena s DPH a URL). Pokud vrátí prázdný seznam s hintem o chybějícím ceníku, NEUVÁDĚJ konkrétní cenu a navrhni partnerovi kontakt na servis.

Pro technické dotazy máš nástroj **search_manuals** — cíleně prohledá PDF manuály výrobce a vrátí relevantní pasáže. **Vždy** ho použij, když partner řeší konkrétní problém (chybový kód, porucha, postup, parametr, programování) a pasáže [M1]/[M2] výše ti nestačí. Zadej konkrétní klíčová slova (chybový kód, název dílu, operace). Z vrácených pasáží poraď krok po kroku a uveď, z jakého manuálu informace pochází. Teprve když ani v manuálech nic nenajdeš, postupuj obecně a doporuč servis.

Máš také nástroj **list_appliance_manuals** — vrátí PDF manuály ke stažení (návody, katalogy ND, instalační/programovací manuály) pro spotřebiče partnerových produktů včetně odkazu. Pravidla pro manuály:
- Na běžné technické dotazy odpovídej z pasáží [M1], [M2] nebo z nástroje search_manuals — **nevolej** list_appliance_manuals jen kvůli zodpovězení dotazu.
- Nástroj zavolej **jen když partner výslovně chce samotný dokument** ("pošli mi instalační manuál", "kde stáhnu katalog ND", "máš celý návod?").
- Když nástroj vrátí manuály, předej partnerovi pole download_url jako odkaz spolu s názvem manuálu. Nikdy odkaz nevymýšlej — použij přesně to, co nástroj vrátil.
- Manuály vypisuj jako jednoduchý seznam (NE tabulku), každý na samostatném řádku ve formátu markdown odkazu: 📄 [Název manuálu (počet stran)](download_url). Pokud je manuálů víc spotřebičů, seskup je krátkým nadpisem podle spotřebiče.

Pravidla:
- **Vždy** vychazej z výše uvedených článků a manuálů, když jsou relevantní.
- Když cituješ článek, zmínit jeho číslo v hranatých závorkách: "Odpojte přívod vody [1]."
- Když cituješ pasáž z PDF manuálu výrobce, použij notaci [M1], [M2] atd. — partner v UI uvidí, ze kterého manuálu informace pochází.
- Pokud žádný zdroj neodpovídá problému, řekni že nemáš v bázi konkrétní postup, a navrhni postupovat obecně + zavolat servis.
- Neimprovizuj nebezpečné rady (vysoké napětí, plyn, voda pod tlakem) — vždy doporuč odborníka.
- Buď stručný — 3–6 vět maximum, pokud nejde o detailní návod.
- Konec odpovědi: pokud problém nezavíráš, polož 1 upřesňující otázku.`;
}

// ─── Retrieval — najdi relevantní články pro partnerovu otázku ─────────────

/**
 * MVP retrieval bez embeddings: ILIKE/trigram search nad title+summary+body_search,
 * filtrované podle partnerových produktů.
 * Budoucí upgrade: pgvector + Voyage/OpenAI embeddings (schema připraveno).
 */
async function retrieveArticles({ query, partner, limit = RETRIEVAL_LIMIT }) {
  const productIds = (partner?.products || []).map(p => p.product_id);
  const q = String(query || '').trim();

  // Tokeny pro multi-word OR matching
  const tokens = q.split(/\s+/).filter(t => t.length >= 3).slice(0, 8);

  const baseWhere = {
    status: 'published',
    visibility: 'partner',
  };
  // Pokud má partner přiřazené produkty, filtrujeme podle nich. Pokud žádné,
  // zatím vracíme global znalost (partner v onboardingu).
  if (productIds.length) {
    baseWhere.products = { some: { product_id: { in: productIds } } };
  }

  let articles = [];
  if (tokens.length) {
    const or = [];
    for (const t of tokens) {
      or.push({ title: { contains: t, mode: 'insensitive' } });
      or.push({ summary: { contains: t, mode: 'insensitive' } });
      or.push({ body_search: { contains: t, mode: 'insensitive' } });
      or.push({ tags: { array_contains: t.toLowerCase() } });
    }
    articles = await prisma.serviceArticle.findMany({
      where: { ...baseWhere, OR: or },
      orderBy: [{ helpful_count: 'desc' }, { views_count: 'desc' }, { updated_at: 'desc' }],
      take: limit * 2, // víc kandidátů, pak osekáme
    });
  }

  // Pokud retrieval nenašel nic (např. krátký dotaz), vezmi top published v rámci produktů
  if (!articles.length) {
    articles = await prisma.serviceArticle.findMany({
      where: baseWhere,
      orderBy: [{ helpful_count: 'desc' }, { updated_at: 'desc' }],
      take: limit,
    });
  }

  // Naivní rerank — počet shod tokenů v title
  if (tokens.length) {
    articles = articles.map(a => {
      const hay = (a.title + ' ' + (a.summary || '') + ' ' + (a.body_search || '')).toLowerCase();
      const score = tokens.reduce((s, t) => s + (hay.includes(t.toLowerCase()) ? 1 : 0), 0);
      return { ...a, _score: score };
    }).sort((a, b) => b._score - a._score);
  }

  return articles.slice(0, limit);
}

/**
 * Najdi relevantní pasáže z PDF manuálů výrobců. Spotřebič musí být v jednom
 * z produktů, které partner provozuje. Vracíme okno ~MANUAL_PASSAGE_CHARS znaků
 * kolem prvního zásahu, aby kontextové okno Claude nepřeteklo.
 */
async function retrieveManualPassages({ query, partner, limit = MANUAL_PASSAGE_LIMIT }) {
  const productIds = (partner?.products || []).map(p => p.product_id);
  const q = String(query || '').trim();
  if (!q || q.length < 3) return [];

  const tokens = q.split(/\s+/).filter(t => t.length >= 3).slice(0, 6).map(t => t.toLowerCase());
  if (!tokens.length) return [];

  // Najdi manuály vázané na spotřebiče, které jsou v partnerových produktech.
  // Pokud partner nemá přiřazené produkty (onboarding), zatím manuály nevracíme,
  // ať Hugo nezmate kontextem k cizím spotřebičům.
  if (!productIds.length) return [];

  const manuals = await prisma.serviceApplianceManual.findMany({
    where: {
      extracted_text: { not: null },
      OR: tokens.map(t => ({ extracted_text: { contains: t, mode: 'insensitive' } })),
      appliance: {
        product_links: { some: { product_id: { in: productIds } } },
      },
    },
    include: {
      appliance: { select: { name: true, manufacturer: true, model_code: true } },
    },
    take: limit * 3,
  });

  // Pro každý manuál vytáhni okno textu kolem prvního zásahu nejdelšího tokenu
  const longestToken = tokens.slice().sort((a, b) => b.length - a.length)[0];
  const passages = manuals.map(m => {
    const text = (m.extracted_text || '').replace(/\s+/g, ' ');
    const idxFor = (tok) => {
      const i = text.toLowerCase().indexOf(tok);
      return i >= 0 ? i : -1;
    };
    // Najdi pozici zásahu — preferuj nejdelší token
    let hit = idxFor(longestToken);
    if (hit < 0) {
      for (const t of tokens) {
        hit = idxFor(t);
        if (hit >= 0) break;
      }
    }
    if (hit < 0) return null;
    const start = Math.max(0, hit - Math.floor(MANUAL_PASSAGE_CHARS / 3));
    const end = Math.min(text.length, start + MANUAL_PASSAGE_CHARS);
    const passage = (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
    // Skóre = počet různých tokenů, které se v textu vyskytují
    const score = tokens.reduce((s, t) => s + (text.toLowerCase().includes(t) ? 1 : 0), 0);
    return {
      id: m.id,
      title: m.title,
      page_count: m.page_count,
      appliance_name: m.appliance?.name || '',
      appliance_manufacturer: m.appliance?.manufacturer || null,
      passage,
      score,
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);

  return passages;
}

// ─── Hlavní entry point ───────────────────────────────────────────────────

/**
 * Pošle zprávu Hugovi. Pokud session_id chybí, vytvoří novou.
 * @returns { session, userMessage, assistantMessage, citations[], retrieved[] }
 */
async function sendMessage({ partner, sessionId, message }) {
  if (!partner) throw new Error('Partner je povinný');
  if (!message || !message.trim()) throw new Error('Zpráva nesmí být prázdná');

  // 1. Najdi/vytvoř session
  let session;
  if (sessionId) {
    session = await prisma.serviceChatSession.findFirst({
      where: { id: parseInt(sessionId, 10), partner_id: partner.id },
    });
  }
  if (!session) {
    session = await prisma.serviceChatSession.create({
      data: {
        partner_id: partner.id,
        title: message.slice(0, 200),
        language: partner.language || 'cs',
        status: 'active',
      },
    });
  }

  // 2. Načti historii (poslední N kol pro kontext)
  const previousMessages = await prisma.serviceChatMessage.findMany({
    where: { session_id: session.id },
    orderBy: { created_at: 'asc' },
    take: MAX_HISTORY_TURNS * 2,
  });

  // 3. Ulož user message
  const userMessage = await prisma.serviceChatMessage.create({
    data: { session_id: session.id, role: 'user', body: message },
  });

  // 4. Retrieval — najdi relevantní články + pasáže z PDF manuálů
  const [retrieved, retrievedManuals] = await Promise.all([
    retrieveArticles({ query: message, partner }),
    retrieveManualPassages({ query: message, partner }),
  ]);

  // 5. Sestav prompty pro Claude
  const systemPrompt = buildSystemPrompt({
    partner,
    language: session.language,
    retrievedArticles: retrieved,
    retrievedManuals,
  });

  const messages = previousMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.body }));
  messages.push({ role: 'user', content: message });

  // 6. Volej Claude
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback — když chybí klíč, dej alespoň hint z retrieval
    const assistantBody = retrieved.length
      ? `Mám pro tebe relevantní článek: **${retrieved[0].title}**.\n\n${retrieved[0].summary || retrieved[0].body_md.slice(0, 500)}\n\n_(AI služba není v tuto chvíli aktivní — vrátil jsem ti přímý odkaz na nejbližší článek.)_`
      : 'Nepodařilo se mi v naší databázi najít konkrétní postup. Doporučuji kontaktovat servis Best Series.';
    return await persistAssistantTurn({ session, userMessage, assistantBody, retrieved, retrievedManuals, tokensIn: null, tokensOut: null });
  }

  const client = new Anthropic({ apiKey });
  let assistantBody = '';
  let tokensIn = 0;
  let tokensOut = 0;
  const toolCalls = []; // audit, co Hugo volal

  try {
    // Tool-use smyčka: Claude může chtít zavolat tool, my mu pošleme výsledek
    // a počkáme na další stop_reason. Max 3 iterace, aby se nezacyklilo.
    let iter = 0;
    while (iter < TOOL_USE_MAX_ITERATIONS) {
      iter++;
      const resp = await client.messages.create({
        model: HUGO_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: [SHOP_TOOL, MANUALS_TOOL, SEARCH_MANUALS_TOOL],
        messages,
      });
      if (resp.usage) {
        tokensIn += resp.usage.input_tokens || 0;
        tokensOut += resp.usage.output_tokens || 0;
      }
      // Vyextrahuj text bloky pro assistant body (pokud končí stop=end_turn)
      const textParts = (resp.content || []).filter(b => b.type === 'text').map(b => b.text);
      const toolUseBlocks = (resp.content || []).filter(b => b.type === 'tool_use');
      if (resp.stop_reason === 'tool_use' && toolUseBlocks.length) {
        // Připojíme celou assistant content (text + tool_use bloky) do historie
        messages.push({ role: 'assistant', content: resp.content });
        const toolResults = [];
        for (const tu of toolUseBlocks) {
          const result = await executeHugoTool({ name: tu.name, input: tu.input || {}, partner });
          toolCalls.push({ name: tu.name, input: tu.input, result_summary: result.hint || (Array.isArray(result.products) ? `${result.products.length} produkts` : 'ok') });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue; // další iterace s tool_result v historii
      }
      // Konec — má text odpověď
      assistantBody = textParts.join('\n').trim();
      if (!assistantBody) {
        assistantBody = '⚠️ Neumím momentálně odpovědět. Zkus to prosím znovu nebo zavolej servis Best Series.';
      }
      break;
    }
    if (iter >= TOOL_USE_MAX_ITERATIONS && !assistantBody) {
      assistantBody = '⚠️ Konverzace byla příliš dlouhá na automatické vyřešení. Doporučuji zavolat servis Best Series.';
    }
  } catch (err) {
    console.error('[hugo] Claude API chyba:', err.message);
    assistantBody = '⚠️ Omlouvám se, AI služba má momentálně problém. Zkus to prosím za chvíli, nebo zavolej servis Best Series.';
  }

  return await persistAssistantTurn({ session, userMessage, assistantBody, retrieved, retrievedManuals, tokensIn: tokensIn || null, tokensOut: tokensOut || null, toolCalls });
}

async function persistAssistantTurn({ session, userMessage, assistantBody, retrieved, retrievedManuals, tokensIn, tokensOut, toolCalls }) {
  if (toolCalls && toolCalls.length) {
    console.log(`[hugo] tool calls for session ${session.id}:`, JSON.stringify(toolCalls));
  }
  const retrievedIds = retrieved.map(a => a.id);

  const assistantMessage = await prisma.$transaction(async (tx) => {
    const m = await tx.serviceChatMessage.create({
      data: {
        session_id: session.id,
        role: 'assistant',
        body: assistantBody,
        retrieved_article_ids: retrievedIds,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        model: HUGO_MODEL,
      },
    });
    // Vyparsuj [1], [2]… citace a propoj na konkrétní články
    const citationMatches = Array.from(assistantBody.matchAll(/\[(\d+)\]/g));
    const citedPositions = Array.from(new Set(citationMatches.map(cm => parseInt(cm[1], 10))))
      .filter(p => p >= 1 && p <= retrieved.length);
    if (citedPositions.length) {
      await tx.serviceChatCitation.createMany({
        data: citedPositions.map((pos, idx) => ({
          message_id: m.id,
          article_id: retrieved[pos - 1].id,
          position: idx + 1,
        })),
        skipDuplicates: true,
      });
    }
    // Update session — counter a updated_at
    await tx.serviceChatSession.update({
      where: { id: session.id },
      data: {
        message_count: { increment: 2 },
        updated_at: new Date(),
      },
    });
    return m;
  });

  return {
    session,
    user_message: userMessage,
    assistant_message: assistantMessage,
    retrieved: retrieved.map(a => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      slug: a.slug,
      summary: a.summary,
    })),
    retrieved_manuals: (retrievedManuals || []).map(m => ({
      id: m.id,
      title: m.title,
      appliance: m.appliance_name,
      manufacturer: m.appliance_manufacturer,
      page_count: m.page_count,
    })),
  };
}

/**
 * Zaznamenej feedback na konkrétní zprávu od partnera.
 */
async function recordFeedback({ partner, messageId, feedback }) {
  if (!['helpful', 'not_helpful'].includes(feedback)) {
    throw new Error('feedback musí být helpful | not_helpful');
  }
  const msg = await prisma.serviceChatMessage.findUnique({
    where: { id: parseInt(messageId, 10) },
    include: { session: true },
  });
  if (!msg) throw new Error('Zpráva nenalezena');
  if (msg.session.partner_id !== partner.id) {
    throw Object.assign(new Error('Cizí zpráva'), { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.serviceChatMessage.update({
      where: { id: msg.id },
      data: { feedback },
    });
    // Pokud not_helpful, označ session pro pozornost servisáků
    if (feedback === 'not_helpful') {
      await tx.serviceChatSession.update({
        where: { id: msg.session_id },
        data: { needs_attention: true },
      });
    }
    // Update counter na zdrojových článcích
    const articleIds = Array.isArray(msg.retrieved_article_ids) ? msg.retrieved_article_ids : [];
    if (articleIds.length) {
      const field = feedback === 'helpful' ? 'helpful_count' : 'not_helpful_count';
      await tx.serviceArticle.updateMany({
        where: { id: { in: articleIds } },
        data: { [field]: { increment: 1 } },
      });
    }
  });

  return { ok: true };
}

module.exports = {
  sendMessage,
  retrieveArticles,
  retrieveManualPassages,
  recordFeedback,
  HUGO_MODEL,
};
