// =============================================================================
// HolyOS — Hugo routes (partner-only, bestseries.cash)
// Login partnera, chat s Hugem, listování návodů pro vlastní produkty.
// =============================================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const {
  generateHugoToken,
  requireHugoAuth,
  hugoCookieOptions,
  HUGO_COOKIE_NAME,
} = require('../middleware/hugo-auth');
const hugoAi = require('../services/ai/hugo');

// ─── AUTH (bez requireHugoAuth) ───────────────────────────────────────────

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Vyplň jméno a heslo' });
    const { username, password } = parsed.data;

    const partner = await prisma.partnerAccount.findUnique({
      where: { username },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!partner || !partner.active) {
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }
    const ok = await bcrypt.compare(password, partner.password_hash);
    if (!ok) return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });

    // Update last_login_at + IP
    await prisma.partnerAccount.update({
      where: { id: partner.id },
      data: {
        last_login_at: new Date(),
        last_ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().slice(0, 45),
      },
    });

    const token = generateHugoToken(partner);
    res.cookie(HUGO_COOKIE_NAME, token, hugoCookieOptions(req));

    res.json({
      ok: true,
      partner: {
        id: partner.id,
        username: partner.username,
        display_name: partner.display_name,
        company: partner.company,
        language: partner.language,
      },
      token, // pro mobilní klienty, kteří nepoužívají cookie
    });
  } catch (err) { next(err); }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie(HUGO_COOKIE_NAME, hugoCookieOptions(req));
  res.json({ ok: true });
});

// ─── Vše níže vyžaduje Hugo auth ──────────────────────────────────────────

router.use(requireHugoAuth);

// GET /api/hugo/me — kdo jsem
router.get('/me', async (req, res) => {
  const p = req.partner;
  res.json({
    id: p.id,
    username: p.username,
    display_name: p.display_name,
    email: p.email,
    phone: p.phone,
    language: p.language,
    company: p.company,
    products: p.products,
  });
});

router.patch('/me', async (req, res, next) => {
  try {
    const schema = z.object({
      language: z.string().max(5).optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const updated = await prisma.partnerAccount.update({
      where: { id: req.partner.id },
      data: parsed.data,
    });
    res.json({ ok: true, language: updated.language });
  } catch (err) { next(err); }
});

router.post('/auth/change-password', async (req, res, next) => {
  try {
    const schema = z.object({
      old_password: z.string().min(1),
      new_password: z.string().min(6),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Nové heslo musí mít alespoň 6 znaků' });
    const account = await prisma.partnerAccount.findUnique({ where: { id: req.partner.id } });
    const ok = await bcrypt.compare(parsed.data.old_password, account.password_hash);
    if (!ok) return res.status(401).json({ error: 'Staré heslo nesedí' });
    const password_hash = await bcrypt.hash(parsed.data.new_password, 12);
    await prisma.partnerAccount.update({ where: { id: account.id }, data: { password_hash } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── ČLÁNKY pro partnera (read-only, filtrované) ──────────────────────────

// GET /api/hugo/articles?kind=GUIDE&q=...
router.get('/articles', async (req, res, next) => {
  try {
    const productIds = (req.partner.products || []).map(p => p.product_id);

    const where = {
      status: 'published',
      visibility: 'partner',
    };
    if (productIds.length) {
      where.products = { some: { product_id: { in: productIds } } };
    }
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.category_id) where.category_id = parseInt(req.query.category_id, 10);
    if (req.query.appliance_id) where.appliances = { some: { appliance_id: parseInt(req.query.appliance_id, 10) } };
    if (req.query.q) {
      const q = String(req.query.q).trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { body_search: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.serviceArticle.findMany({
      where,
      orderBy: [{ kind: 'asc' }, { updated_at: 'desc' }],
      take: 200,
      select: {
        id: true,
        title: true,
        slug: true,
        kind: true,
        summary: true,
        tags: true,
        category: { select: { id: true, name: true, icon: true, color: true } },
        updated_at: true,
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/articles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const productIds = (req.partner.products || []).map(p => p.product_id);

    const article = await prisma.serviceArticle.findFirst({
      where: {
        id,
        status: 'published',
        visibility: 'partner',
        // Partner vidí jen články pro své produkty (nebo články bez produktu = univerzální)
        OR: [
          { products: productIds.length ? { some: { product_id: { in: productIds } } } : undefined },
          { products: { none: {} } },
        ].filter(c => c.products !== undefined),
      },
      include: {
        category: true,
        attachments: { orderBy: { sort_order: 'asc' } },
      },
    });
    if (!article) return res.status(404).json({ error: 'Článek nenalezen nebo nemáš k němu přístup' });

    // Zvyš views_count (best-effort, nečekáme na něj)
    prisma.serviceArticle.update({
      where: { id },
      data: { views_count: { increment: 1 } },
    }).catch(() => {});

    res.json(article);
  } catch (err) { next(err); }
});

// ─── PDF MANUÁLY (download pro partnera) ──────────────────────────────────

// GET /api/hugo/manuals/:id/download — stáhne PDF manuál spotřebiče.
// Partner smí jen manuály spotřebičů, které jsou v jeho přiřazených produktech.
router.get('/manuals/:id/download', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const productIds = (req.partner.products || []).map(p => p.product_id);
    if (!productIds.length) {
      return res.status(403).json({ error: 'Nemáš přiřazené produkty, k manuálu nemáš přístup' });
    }
    // Manuál musí patřit spotřebiči, který je v některém z partnerových produktů
    const m = await prisma.serviceApplianceManual.findFirst({
      where: {
        id,
        appliance: { product_links: { some: { product_id: { in: productIds } } } },
      },
    });
    if (!m) return res.status(404).json({ error: 'Manuál nenalezen nebo k němu nemáš přístup' });

    const absPath = path.join(__dirname, '..', m.file_path);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Soubor chybí na disku' });
    if (m.mime_type) res.type(m.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(m.title)}"`);
    res.sendFile(absPath);
  } catch (err) { next(err); }
});

// ─── CHAT S HUGEM ─────────────────────────────────────────────────────────

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.number().int().optional().nullable(),
});

router.post('/chat', async (req, res, next) => {
  try {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });

    const result = await hugoAi.sendMessage({
      partner: req.partner,
      sessionId: parsed.data.session_id,
      message: parsed.data.message,
    });

    res.json({
      session_id: result.session.id,
      message: {
        id: result.assistant_message.id,
        role: 'assistant',
        body: result.assistant_message.body,
        created_at: result.assistant_message.created_at,
      },
      retrieved: result.retrieved,
      retrieved_manuals: result.retrieved_manuals || [],
    });
  } catch (err) { next(err); }
});

// GET /api/hugo/sessions — moje konverzace
router.get('/sessions', async (req, res, next) => {
  try {
    const items = await prisma.serviceChatSession.findMany({
      where: { partner_id: req.partner.id },
      orderBy: { updated_at: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        language: true,
        message_count: true,
        created_at: true,
        updated_at: true,
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const session = await prisma.serviceChatSession.findFirst({
      where: { id, partner_id: req.partner.id },
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
          include: { citations: { include: { article: { select: { id: true, title: true, slug: true } } } } },
        },
      },
    });
    if (!session) return res.status(404).json({ error: 'Konverzace nenalezena' });
    res.json(session);
  } catch (err) { next(err); }
});

// POST /api/hugo/messages/:id/feedback — partner ohodnotí, jestli mu Hugo pomohl
router.post('/messages/:id/feedback', async (req, res, next) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    const feedback = String(req.body.feedback || '');
    await hugoAi.recordFeedback({ partner: req.partner, messageId, feedback });
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: 'Cizí zpráva' });
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
