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
const MAX_HISTORY_TURNS = 10;

// ─── Persona ───────────────────────────────────────────────────────────────

function buildSystemPrompt({ partner, language, retrievedArticles }) {
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

${knowledgeBlock}

Pravidla:
- **Vždy** vychazej z výše uvedených článků, když jsou relevantní. Pokud cituješ článek, zmínit jeho číslo v hranatých závorkách na konci věty, např. "Odpojte přívod vody [1]."
- Pokud žádný článek neodpovídá problému, řekni že nemáš v bázi konkrétní postup, a navrhni postupovat obecně + zavolat servis.
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

  // 4. Retrieval — najdi relevantní články
  const retrieved = await retrieveArticles({ query: message, partner });

  // 5. Sestav prompty pro Claude
  const systemPrompt = buildSystemPrompt({
    partner,
    language: session.language,
    retrievedArticles: retrieved,
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
    return await persistAssistantTurn({ session, userMessage, assistantBody, retrieved, tokensIn: null, tokensOut: null });
  }

  const client = new Anthropic({ apiKey });
  let assistantBody = '';
  let tokensIn = null;
  let tokensOut = null;

  try {
    const resp = await client.messages.create({
      model: HUGO_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });
    assistantBody = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    if (resp.usage) {
      tokensIn = resp.usage.input_tokens;
      tokensOut = resp.usage.output_tokens;
    }
  } catch (err) {
    console.error('[hugo] Claude API chyba:', err.message);
    assistantBody = '⚠️ Omlouvám se, AI služba má momentálně problém. Zkus to prosím za chvíli, nebo zavolej servis Best Series.';
  }

  return await persistAssistantTurn({ session, userMessage, assistantBody, retrieved, tokensIn, tokensOut });
}

async function persistAssistantTurn({ session, userMessage, assistantBody, retrieved, tokensIn, tokensOut }) {
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
  recordFeedback,
  HUGO_MODEL,
};
