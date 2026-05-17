// =============================================================================
// HolyOS MCP Server — Servis (znalostní báze)
// Nástroje pro interní AI agenty (AI Vývojář, AI Agenti) ke čtení/zápisu
// servisních článků a vyhledávání v bázi.
// =============================================================================

function getServiceTools() {
  return [
    {
      name: 'list_service_categories',
      description: 'Vrátí seznam kategorií servisních článků (Mechanika, Elektro, Voda…).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'list_service_articles',
      description: 'Seznam servisních článků. Lze filtrovat podle stavu, druhu, kategorie, produktu, spotřebiče nebo fulltextem.',
      input_schema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Fulltext (název + summary + body)' },
          kind: { type: 'string', enum: ['GUIDE', 'CASE', 'CHECKLIST', 'FAQ'] },
          status: { type: 'string', enum: ['draft', 'published', 'archived'] },
          visibility: { type: 'string', enum: ['internal', 'partner'] },
          category_id: { type: 'number' },
          product_id: { type: 'number' },
          appliance_id: { type: 'number' },
          limit: { type: 'number', default: 30 },
        },
      },
    },
    {
      name: 'get_service_article',
      description: 'Detail článku včetně těla v Markdownu, kategorie, vázaných produktů a spotřebičů.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'ID článku' },
          slug: { type: 'string', description: 'Slug (URL fragment) — alternativa k id' },
        },
      },
    },
    {
      name: 'search_service_knowledge',
      description: 'Hugo-like retrieval: najde top relevantní články pro danou otázku, volitelně filtrovat podle produktů partnera. Vrací max 5 záznamů seřazených podle skóre.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Dotaz partnera nebo problém k řešení', required: true },
          product_ids: { type: 'array', items: { type: 'number' }, description: 'Filtr na partnerovy produkty' },
          limit: { type: 'number', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_service_article',
      description: 'Vytvoří nový servisní článek. Použij když AI servisák nasbíral z konverzace s partnerem postup, který se vyplatí uložit do znalostní báze.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['GUIDE', 'CASE', 'CHECKLIST', 'FAQ'], default: 'GUIDE' },
          body_md: { type: 'string', description: 'Tělo v Markdownu' },
          summary: { type: 'string' },
          category_id: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
          product_ids: { type: 'array', items: { type: 'number' } },
          appliance_ids: { type: 'array', items: { type: 'number' } },
          visibility: { type: 'string', enum: ['internal', 'partner'], default: 'partner' },
          status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
        },
        required: ['title', 'body_md'],
      },
    },
    {
      name: 'list_partner_accounts',
      description: 'Seznam partnerů (PartnerAccount) — kdo se loguje k Hugovi na bestseries.cash.',
      input_schema: {
        type: 'object',
        properties: {
          active: { type: 'boolean', default: true },
          company_id: { type: 'number' },
          limit: { type: 'number', default: 50 },
        },
      },
    },
    {
      name: 'list_hugo_failed_sessions',
      description: 'Konverzace, kde partner označil Hugovu odpověď jako "nepomohlo" (needs_attention). Vraty se ti vážné mezery v znalostní bázi.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20 },
        },
      },
    },
  ];
}

async function executeServiceTool(toolName, params, prisma) {
  switch (toolName) {

    case 'list_service_categories': {
      return await prisma.serviceCategory.findMany({
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { articles: true } } },
      });
    }

    case 'list_service_articles': {
      const where = {};
      if (params.kind) where.kind = params.kind;
      if (params.status) where.status = params.status;
      if (params.visibility) where.visibility = params.visibility;
      if (params.category_id) where.category_id = params.category_id;
      if (params.product_id) where.products = { some: { product_id: params.product_id } };
      if (params.appliance_id) where.appliances = { some: { appliance_id: params.appliance_id } };
      if (params.q) {
        where.OR = [
          { title: { contains: params.q, mode: 'insensitive' } },
          { summary: { contains: params.q, mode: 'insensitive' } },
          { body_search: { contains: params.q, mode: 'insensitive' } },
        ];
      }
      return await prisma.serviceArticle.findMany({
        where,
        take: params.limit || 30,
        orderBy: { updated_at: 'desc' },
        select: {
          id: true, title: true, slug: true, kind: true, status: true, visibility: true,
          summary: true, tags: true, category_id: true, updated_at: true,
          _count: { select: { products: true, appliances: true } },
        },
      });
    }

    case 'get_service_article': {
      const where = params.id ? { id: params.id } : { slug: params.slug };
      return await prisma.serviceArticle.findUnique({
        where,
        include: {
          category: true,
          products: true,
          appliances: { include: { appliance: true } },
          attachments: true,
        },
      });
    }

    case 'search_service_knowledge': {
      const q = String(params.query || '').trim();
      const tokens = q.split(/\s+/).filter(t => t.length >= 3).slice(0, 8);
      const productIds = Array.isArray(params.product_ids) ? params.product_ids : [];
      const limit = params.limit || 5;

      const baseWhere = { status: 'published' };
      if (productIds.length) baseWhere.products = { some: { product_id: { in: productIds } } };

      let articles = [];
      if (tokens.length) {
        const or = [];
        for (const t of tokens) {
          or.push({ title: { contains: t, mode: 'insensitive' } });
          or.push({ summary: { contains: t, mode: 'insensitive' } });
          or.push({ body_search: { contains: t, mode: 'insensitive' } });
        }
        articles = await prisma.serviceArticle.findMany({
          where: { ...baseWhere, OR: or },
          orderBy: [{ helpful_count: 'desc' }, { updated_at: 'desc' }],
          take: limit * 2,
        });
      }
      if (!articles.length) {
        articles = await prisma.serviceArticle.findMany({
          where: baseWhere,
          orderBy: [{ helpful_count: 'desc' }, { updated_at: 'desc' }],
          take: limit,
        });
      }
      if (tokens.length) {
        articles = articles.map(a => {
          const hay = (a.title + ' ' + (a.summary || '') + ' ' + (a.body_search || '')).toLowerCase();
          const score = tokens.reduce((s, t) => s + (hay.includes(t.toLowerCase()) ? 1 : 0), 0);
          return { ...a, _score: score };
        }).sort((a, b) => b._score - a._score);
      }
      return articles.slice(0, limit).map(a => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        kind: a.kind,
        summary: a.summary,
        score: a._score,
      }));
    }

    case 'create_service_article': {
      const slugify = (s) => String(s || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'a-' + Date.now();
      const stripMd = (s) => String(s || '').replace(/[*_`~#>]/g, ' ').replace(/\s+/g, ' ').trim();
      const slug = slugify(params.title) + '-' + Date.now().toString(36);
      const created = await prisma.$transaction(async (tx) => {
        const a = await tx.serviceArticle.create({
          data: {
            title: params.title,
            slug,
            kind: params.kind || 'GUIDE',
            body_md: params.body_md,
            body_search: stripMd(params.body_md),
            summary: params.summary || null,
            category_id: params.category_id || null,
            tags: params.tags || [],
            visibility: params.visibility || 'partner',
            status: params.status || 'draft',
            published_at: params.status === 'published' ? new Date() : null,
          },
        });
        if (Array.isArray(params.product_ids) && params.product_ids.length) {
          await tx.serviceArticleProduct.createMany({
            data: params.product_ids.map(pid => ({ article_id: a.id, product_id: pid })),
            skipDuplicates: true,
          });
        }
        if (Array.isArray(params.appliance_ids) && params.appliance_ids.length) {
          await tx.serviceArticleAppliance.createMany({
            data: params.appliance_ids.map(aid => ({ article_id: a.id, appliance_id: aid })),
            skipDuplicates: true,
          });
        }
        return a;
      });
      return { ok: true, article: created };
    }

    case 'list_partner_accounts': {
      const where = {};
      if (typeof params.active === 'boolean') where.active = params.active;
      if (params.company_id) where.company_id = params.company_id;
      return await prisma.partnerAccount.findMany({
        where,
        take: params.limit || 50,
        orderBy: { created_at: 'desc' },
        select: {
          id: true, username: true, display_name: true, email: true, active: true,
          language: true, last_login_at: true, company_id: true,
          _count: { select: { chat_sessions: true } },
        },
      });
    }

    case 'list_hugo_failed_sessions': {
      return await prisma.serviceChatSession.findMany({
        where: { needs_attention: true },
        take: params.limit || 20,
        orderBy: { updated_at: 'desc' },
        include: {
          partner: { select: { id: true, display_name: true, company: { select: { name: true } } } },
          messages: {
            where: { feedback: 'not_helpful' },
            select: { id: true, body: true, retrieved_article_ids: true, created_at: true },
          },
        },
      });
    }

    default:
      throw new Error(`Unknown service tool: ${toolName}`);
  }
}

module.exports = { getServiceTools, executeServiceTool };
