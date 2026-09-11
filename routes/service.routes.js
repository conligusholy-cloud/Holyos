// =============================================================================
// HolyOS — Servis (interní admin) routes
// CRUD pro znalostní bázi: kategorie, spotřebiče, články, partneři, chat audit.
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Storage pro PDF manuály — Railway persistent volume mountnutý do /app/data
const MANUALS_DIR = path.join(__dirname, '..', 'data', 'service-manuals');
if (!fs.existsSync(MANUALS_DIR)) {
  fs.mkdirSync(MANUALS_DIR, { recursive: true });
}

// Fotky k servisním požadavkům (vyfoceno mobilem). Persistentní volume /app/data.
const REQUEST_PHOTOS_DIR = path.join(__dirname, '..', 'data', 'service-request-photos');
if (!fs.existsSync(REQUEST_PHOTOS_DIR)) {
  fs.mkdirSync(REQUEST_PHOTOS_DIR, { recursive: true });
}
// Multer jen pro obrázky (foto problému), do 15 MB.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//i.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Nahraj prosím obrázek (foto).'), false);
  },
});

// Multer — memory storage, 50 MB limit
const manualUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Akceptujeme: PDF, obrázky, Word, Excel
    const ok = /^(application\/pdf|image\/|application\/msword|application\/vnd\.openxmlformats-officedocument|application\/vnd\.ms-excel|text\/plain)/i
      .test(file.mimetype || '');
    if (!ok) return cb(new Error('Nepodporovaný typ souboru: ' + file.mimetype), false);
    cb(null, true);
  },
});

// Extrakce textu z PDF (best-effort, vrací prázdný řetězec při chybě)
async function extractPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    return {
      text: (parsed.text || '').trim(),
      pages: parsed.numpages || null,
    };
  } catch (err) {
    console.warn('[service-manuals] PDF parse failed:', err.message);
    return { text: '', pages: null };
  }
}

// Bezpečné jméno souboru — povolíme jen ASCII písmena, číslice, tečka, podtržítko, pomlčka
function safeFileName(original) {
  const base = (original || 'manual').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

// ─── Pomocné funkce ────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diakritika
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || ('a-' + Date.now());
}

// Markdown → plain text pro fulltext search (jednoduchá heuristika; jen pro lookup,
// ne pro rendering). Odstraní # ## ## headers, **bold**, *italic*, [text](link), `code`.
function stripMarkdown(md) {
  if (!md) return '';
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── KATEGORIE ─────────────────────────────────────────────────────────────

// GET /api/service/categories
router.get('/categories', async (req, res, next) => {
  try {
    const items = await prisma.serviceCategory.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    });
    res.json(items);
  } catch (err) { next(err); }
});

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  sort_order: z.number().int().optional(),
  description: z.string().optional().nullable(),
});

router.post('/categories', async (req, res, next) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const data = parsed.data;
    const cat = await prisma.serviceCategory.create({
      data: { ...data, slug: slugify(data.name) },
    });
    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Kategorie s tímto jménem už existuje' });
    next(err);
  }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = categorySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const data = { ...parsed.data };
    if (data.name) data.slug = slugify(data.name);
    const cat = await prisma.serviceCategory.update({ where: { id }, data });
    res.json(cat);
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceCategory.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── SPOTŘEBIČE (ServiceAppliance) ─────────────────────────────────────────

// GET /api/service/appliances?product_id=...&q=...
router.get('/appliances', async (req, res, next) => {
  try {
    const productId = req.query.product_id ? parseInt(req.query.product_id, 10) : null;
    const q = (req.query.q || '').toString().trim();

    const where = {};
    if (productId) {
      where.product_links = { some: { product_id: productId } };
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { manufacturer: { contains: q, mode: 'insensitive' } },
        { model_code: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.serviceAppliance.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        product_links: { select: { product_id: true, position: true, quantity: true } },
        _count: { select: { articles: true } },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

// ─── MANUÁLY KE SPOTŘEBIČŮM (PDF + extrakce textu pro Hugo) ────────────────
// POZOR: pevné podcesty pod /appliances/:id musí být NAD dynamickou route /:id.

// GET seznam manuálů pro spotřebič
router.get('/appliances/:id/manuals', async (req, res, next) => {
  try {
    const applianceId = parseInt(req.params.id, 10);
    const items = await prisma.serviceApplianceManual.findMany({
      where: { appliance_id: applianceId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, title: true, file_path: true, mime_type: true,
        size_bytes: true, page_count: true, language: true, created_at: true,
        // extracted_text: false — neposíláme do listu, je velký
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

// POST upload nového manuálu (multipart/form-data, field name "file")
router.post('/appliances/:id/manuals', manualUpload.single('file'), async (req, res, next) => {
  try {
    const applianceId = parseInt(req.params.id, 10);
    if (!req.file) return res.status(400).json({ error: 'Chybí soubor (form field "file")' });

    const appliance = await prisma.serviceAppliance.findUnique({ where: { id: applianceId } });
    if (!appliance) return res.status(404).json({ error: 'Spotřebič nenalezen' });

    // Extrakce textu pro Hugo retrieval — jen pro PDF
    let extracted = { text: '', pages: null };
    if ((req.file.mimetype || '').toLowerCase() === 'application/pdf') {
      extracted = await extractPdfText(req.file.buffer);
    }

    // Ulož soubor na disk
    const dir = path.join(MANUALS_DIR, String(applianceId));
    await fsp.mkdir(dir, { recursive: true });
    const fileName = Date.now() + '_' + safeFileName(req.file.originalname);
    const fullPath = path.join(dir, fileName);
    await fsp.writeFile(fullPath, req.file.buffer);

    // Relativní cesta od repo rootu (pro pozdější server.sendFile)
    const relPath = path.relative(path.join(__dirname, '..'), fullPath).replace(/\\/g, '/');

    const manual = await prisma.serviceApplianceManual.create({
      data: {
        appliance_id: applianceId,
        title: (req.body.title || req.file.originalname || 'Manuál').slice(0, 500),
        file_path: relPath,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        page_count: extracted.pages,
        language: req.body.language || null,
        extracted_text: extracted.text || null,
      },
      select: {
        id: true, title: true, file_path: true, mime_type: true,
        size_bytes: true, page_count: true, language: true, created_at: true,
      },
    });
    res.status(201).json({
      ...manual,
      extracted_chars: extracted.text ? extracted.text.length : 0,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Soubor je větší než 50 MB' });
    next(err);
  }
});

// Stažení / náhled jednoho manuálu (servíruje se inline pro PDF)
router.get('/manuals/:id/download', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const m = await prisma.serviceApplianceManual.findUnique({ where: { id } });
    if (!m) return res.status(404).json({ error: 'Manuál nenalezen' });
    const absPath = path.join(__dirname, '..', m.file_path);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Soubor chybí na disku' });
    if (m.mime_type) res.type(m.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(m.title)}"`);
    res.sendFile(absPath);
  } catch (err) { next(err); }
});

// PATCH — přejmenování / jazyk
router.patch('/manuals/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const schema = z.object({
      title: z.string().min(1).max(500).optional(),
      language: z.string().max(5).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const updated = await prisma.serviceApplianceManual.update({
      where: { id }, data: parsed.data,
      select: { id: true, title: true, language: true },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/manuals/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const m = await prisma.serviceApplianceManual.findUnique({ where: { id } });
    if (!m) return res.json({ ok: true });
    // Best-effort smazání souboru
    try {
      const absPath = path.join(__dirname, '..', m.file_path);
      await fsp.unlink(absPath);
    } catch (_) { /* soubor mohl být odstraněn jinak */ }
    await prisma.serviceApplianceManual.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/appliances/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = await prisma.serviceAppliance.findUnique({
      where: { id },
      include: {
        product_links: true,
        articles: {
          include: { article: { select: { id: true, title: true, kind: true, status: true } } },
        },
      },
    });
    if (!item) return res.status(404).json({ error: 'Spotřebič nenalezen' });
    res.json(item);
  } catch (err) { next(err); }
});

const applianceSchema = z.object({
  name: z.string().min(1).max(255),
  manufacturer: z.string().max(255).optional().nullable(),
  model_code: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
  manual_url: z.string().max(500).optional().nullable(),
  photo_url: z.string().max(500).optional().nullable(),
  material_id: z.number().int().optional().nullable(),
  // Volitelně rovnou linkneme na produkty: [{ product_id, position?, quantity? }]
  product_links: z.array(z.object({
    product_id: z.number().int(),
    position: z.string().max(255).optional().nullable(),
    quantity: z.number().int().optional(),
  })).optional(),
});

router.post('/appliances', async (req, res, next) => {
  try {
    const parsed = applianceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { product_links, ...data } = parsed.data;

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.serviceAppliance.create({ data });
      if (product_links && product_links.length) {
        await tx.serviceProductAppliance.createMany({
          data: product_links.map(pl => ({
            appliance_id: a.id,
            product_id: pl.product_id,
            position: pl.position || null,
            quantity: pl.quantity || 1,
          })),
          skipDuplicates: true,
        });
      }
      return a;
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.put('/appliances/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = applianceSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const { product_links, ...data } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.serviceAppliance.update({ where: { id }, data });
      if (Array.isArray(product_links)) {
        // Replace links
        await tx.serviceProductAppliance.deleteMany({ where: { appliance_id: id } });
        if (product_links.length) {
          await tx.serviceProductAppliance.createMany({
            data: product_links.map(pl => ({
              appliance_id: id,
              product_id: pl.product_id,
              position: pl.position || null,
              quantity: pl.quantity || 1,
            })),
            skipDuplicates: true,
          });
        }
      }
      return a;
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/appliances/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceAppliance.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── ČLÁNKY (ServiceArticle) ───────────────────────────────────────────────

// GET /api/service/articles?q=...&kind=...&status=...&category_id=...&product_id=...&appliance_id=...
router.get('/articles', async (req, res, next) => {
  try {
    const { q, kind, status, visibility, category_id, product_id, appliance_id, tag } = req.query;
    const where = {};
    if (kind) where.kind = String(kind);
    if (status) where.status = String(status);
    if (visibility) where.visibility = String(visibility);
    if (category_id) where.category_id = parseInt(category_id, 10);
    if (product_id) where.products = { some: { product_id: parseInt(product_id, 10) } };
    if (appliance_id) where.appliances = { some: { appliance_id: parseInt(appliance_id, 10) } };
    if (q) {
      const qs = String(q).trim();
      where.OR = [
        { title: { contains: qs, mode: 'insensitive' } },
        { summary: { contains: qs, mode: 'insensitive' } },
        { body_search: { contains: qs, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.serviceArticle.findMany({
      where,
      orderBy: [{ updated_at: 'desc' }],
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        products: { select: { product_id: true } },
        appliances: { select: { appliance_id: true } },
        _count: { select: { attachments: true } },
      },
      take: 200,
    });
    // tag filter (post-filter, tags je Json array)
    const filtered = tag ? items.filter(a => Array.isArray(a.tags) && a.tags.includes(String(tag))) : items;
    res.json(filtered);
  } catch (err) { next(err); }
});

router.get('/articles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = await prisma.serviceArticle.findUnique({
      where: { id },
      include: {
        category: true,
        products: true,
        appliances: { include: { appliance: { select: { id: true, name: true, manufacturer: true, model_code: true } } } },
        attachments: { orderBy: { sort_order: 'asc' } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Článek nenalezen' });
    res.json(item);
  } catch (err) { next(err); }
});

const articleSchema = z.object({
  title: z.string().min(1).max(500),
  kind: z.enum(['GUIDE', 'CASE', 'CHECKLIST', 'FAQ']).optional(),
  summary: z.string().max(1000).optional().nullable(),
  body_md: z.string().min(1),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['internal', 'partner']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  category_id: z.number().int().optional().nullable(),
  author_person_id: z.number().int().optional().nullable(),
  product_ids: z.array(z.number().int()).optional(),
  appliance_ids: z.array(z.number().int()).optional(),
});

router.post('/articles', async (req, res, next) => {
  try {
    const parsed = articleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { product_ids, appliance_ids, ...data } = parsed.data;

    const slug = slugify(data.title) + '-' + Date.now().toString(36);
    const body_search = stripMarkdown(data.body_md);
    const author_person_id = data.author_person_id || (req.user && req.user.person && req.user.person.id) || null;

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.serviceArticle.create({
        data: {
          ...data,
          slug,
          body_search,
          author_person_id,
          tags: data.tags || [],
          published_at: data.status === 'published' ? new Date() : null,
        },
      });
      if (product_ids && product_ids.length) {
        await tx.serviceArticleProduct.createMany({
          data: product_ids.map(pid => ({ article_id: a.id, product_id: pid })),
          skipDuplicates: true,
        });
      }
      if (appliance_ids && appliance_ids.length) {
        await tx.serviceArticleAppliance.createMany({
          data: appliance_ids.map(aid => ({ article_id: a.id, appliance_id: aid })),
          skipDuplicates: true,
        });
      }
      return a;
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

router.put('/articles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = articleSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { product_ids, appliance_ids, ...data } = parsed.data;

    if (data.body_md) data.body_search = stripMarkdown(data.body_md);
    if (data.title) data.slug = slugify(data.title) + '-' + id.toString(36);

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.serviceArticle.findUnique({ where: { id }, select: { status: true, published_at: true } });
      if (!current) throw Object.assign(new Error('Článek nenalezen'), { status: 404 });

      const updateData = { ...data };
      // Auto-set published_at při prvním přechodu na published
      if (data.status === 'published' && current.status !== 'published') {
        updateData.published_at = new Date();
      }

      const a = await tx.serviceArticle.update({ where: { id }, data: updateData });
      if (Array.isArray(product_ids)) {
        await tx.serviceArticleProduct.deleteMany({ where: { article_id: id } });
        if (product_ids.length) {
          await tx.serviceArticleProduct.createMany({
            data: product_ids.map(pid => ({ article_id: id, product_id: pid })),
            skipDuplicates: true,
          });
        }
      }
      if (Array.isArray(appliance_ids)) {
        await tx.serviceArticleAppliance.deleteMany({ where: { article_id: id } });
        if (appliance_ids.length) {
          await tx.serviceArticleAppliance.createMany({
            data: appliance_ids.map(aid => ({ article_id: id, appliance_id: aid })),
            skipDuplicates: true,
          });
        }
      }
      return a;
    });
    res.json(updated);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.delete('/articles/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceArticle.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Přílohy (zjednodušená verze — URL referencí, file upload jde přes /api/storage/upload)
const attachmentSchema = z.object({
  title: z.string().min(1).max(255),
  url: z.string().max(500).optional().nullable(),
  file_path: z.string().max(500).optional().nullable(),
  mime_type: z.string().max(80).optional().nullable(),
  size_bytes: z.number().int().optional().nullable(),
  sort_order: z.number().int().optional(),
});

router.post('/articles/:id/attachments', async (req, res, next) => {
  try {
    const article_id = parseInt(req.params.id, 10);
    const parsed = attachmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const att = await prisma.serviceArticleAttachment.create({
      data: { ...parsed.data, article_id },
    });
    res.status(201).json(att);
  } catch (err) { next(err); }
});

router.delete('/articles/:articleId/attachments/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceArticleAttachment.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── PARTNEŘI (PartnerAccount) ────────────────────────────────────────────

// GET /api/service/partners
router.get('/partners', async (req, res, next) => {
  try {
    const items = await prisma.partnerAccount.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        products: { select: { product_id: true, serial_no: true } },
        _count: { select: { chat_sessions: true } },
      },
    });
    res.json(items.map(p => {
      const { password_hash, ...safe } = p;
      return safe;
    }));
  } catch (err) { next(err); }
});

const partnerSchema = z.object({
  username: z.string().min(3).max(100),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  display_name: z.string().min(1).max(255),
  password: z.string().min(6).optional(), // jen při create
  company_id: z.number().int().optional().nullable(),
  contact_person_id: z.number().int().optional().nullable(),
  language: z.string().max(5).optional(),
  active: z.boolean().optional(),
  product_ids: z.array(z.number().int()).optional(),
});

router.post('/partners', async (req, res, next) => {
  try {
    const parsed = partnerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const { password, product_ids, ...data } = parsed.data;
    if (!password) return res.status(400).json({ error: 'Heslo je povinné při založení účtu' });

    const password_hash = await bcrypt.hash(password, 12);

    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.partnerAccount.create({ data: { ...data, password_hash } });
      if (product_ids && product_ids.length) {
        await tx.partnerProductAccess.createMany({
          data: product_ids.map(pid => ({ partner_id: p.id, product_id: pid })),
          skipDuplicates: true,
        });
      }
      return p;
    });
    const { password_hash: _, ...safe } = created;
    res.status(201).json(safe);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username už existuje' });
    next(err);
  }
});

router.put('/partners/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = partnerSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const { password, product_ids, ...data } = parsed.data;

    if (password) data.password_hash = await bcrypt.hash(password, 12);

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.partnerAccount.update({ where: { id }, data });
      if (Array.isArray(product_ids)) {
        await tx.partnerProductAccess.deleteMany({ where: { partner_id: id } });
        if (product_ids.length) {
          await tx.partnerProductAccess.createMany({
            data: product_ids.map(pid => ({ partner_id: id, product_id: pid })),
            skipDuplicates: true,
          });
        }
      }
      return p;
    });
    const { password_hash, ...safe } = updated;
    res.json(safe);
  } catch (err) { next(err); }
});

router.delete('/partners/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.partnerAccount.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── CHAT AUDIT — read-only přehled konverzací s Hugem ────────────────────

// GET /api/service/chat-sessions?partner_id=...&needs_attention=true
router.get('/chat-sessions', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partner_id) where.partner_id = parseInt(req.query.partner_id, 10);
    if (req.query.needs_attention === 'true') where.needs_attention = true;
    if (req.query.status) where.status = String(req.query.status);

    const items = await prisma.serviceChatSession.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: 200,
      include: {
        partner: { select: { id: true, username: true, display_name: true, company: { select: { name: true } } } },
        _count: { select: { messages: true } },
      },
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/chat-sessions/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const session = await prisma.serviceChatSession.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, username: true, display_name: true, company: { select: { name: true } } } },
        messages: {
          orderBy: { created_at: 'asc' },
          include: { citations: { include: { article: { select: { id: true, title: true, slug: true } } } } },
        },
      },
    });
    if (!session) return res.status(404).json({ error: 'Session nenalezena' });
    res.json(session);
  } catch (err) { next(err); }
});

// ─── Servisní požadavky ──────────────────────────────────────────────────────
const REQUEST_STATUSES = ['novy', 'reseni', 'vyreseno', 'zamitnuto'];

// Nastavení: kdo tvoří servisní tým (koho lze úkolovat jako řešitele).
let _settings = null;
try { _settings = require('../services/settings'); } catch (_) { _settings = null; }
const SOLVERS_KEY = 'service.solver_person_ids';
async function readSolverIds() {
  if (!_settings) return [];
  let ids = await _settings.getSetting(SOLVERS_KEY);
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch (_) { ids = ids.split(',').map((s) => parseInt(s, 10)); } }
  return Array.isArray(ids) ? ids.map((x) => parseInt(x, 10)).filter(Boolean) : [];
}
async function peopleByIds(ids) {
  if (!ids.length) return [];
  // POZN.: `role` je relace (Person.role → Role) — do selectu ji nedáváme, protože
  // frontend ji odsud nepoužívá a zbytečně by komplikovala serializaci.
  const people = await prisma.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, first_name: true, last_name: true, phone: true, email: true, work_email: true },
  });
  const byId = {}; people.forEach((p) => { byId[p.id] = p; });
  // Zachovej pořadí dle uloženého seznamu
  return ids.map((id) => byId[id]).filter(Boolean).map((p) => ({
    id: p.id,
    name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || ('#' + p.id),
    phone: (p.phone || '').trim(),
    email: (p.work_email || p.email || '').trim(),
    role: '',
  }));
}

// GET /api/service/request-settings — vrátí servisní tým (vybraní řešitelé).
router.get('/request-settings', async (req, res, next) => {
  try {
    const ids = await readSolverIds();
    res.json({ solver_ids: ids, solvers: await peopleByIds(ids) });
  } catch (err) { next(err); }
});

// PUT /api/service/request-settings { solver_ids: [] } — uloží servisní tým.
router.put('/request-settings', async (req, res, next) => {
  try {
    if (!_settings) return res.status(500).json({ error: 'settings nedostupné' });
    let ids = (req.body && req.body.solver_ids) || [];
    if (!Array.isArray(ids)) ids = [];
    ids = Array.from(new Set(ids.map((x) => parseInt(x, 10)).filter(Boolean)));
    await _settings.setSetting(SOLVERS_KEY, ids, { type: 'json', userId: req.user && req.user.id });
    let solvers = [];
    try { solvers = await peopleByIds(ids); } catch (e) { console.warn('[service] request-settings solvers:', e.message); }
    res.json({ ok: true, solver_ids: ids, solvers });
  } catch (err) { next(err); }
});

// Doplní ke každému požadavku jméno řešitele (Person) + jméno zadavatele (User).
async function _attachAssignees(rows) {
  const ids = Array.from(new Set(rows.map((r) => r.assignee_id).filter((x) => x != null)));
  let map = {};
  if (ids.length) {
    const people = await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, first_name: true, last_name: true } });
    people.forEach((p) => { map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || ('#' + p.id); });
  }
  // Zadavatel (created_by_user_id → User.display_name/username)
  const uids = Array.from(new Set(rows.map((r) => r.created_by_user_id).filter((x) => x != null)));
  let umap = {};
  if (uids.length) {
    const users = await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, display_name: true, username: true } });
    users.forEach((u) => { umap[u.id] = u.display_name || u.username || ('#' + u.id); });
  }
  return rows.map((r) => Object.assign({}, r, {
    assignee_name: r.assignee_id != null ? (map[r.assignee_id] || ('#' + r.assignee_id)) : null,
    created_by_name: r.created_by_user_id != null ? (umap[r.created_by_user_id] || ('#' + r.created_by_user_id)) : null,
  }));
}

// Person.id přihlášeného uživatele (řešitel = Person). Cache na req.
async function myPersonId(req) {
  try {
    if (req.user && req.user.person && req.user.person.id) return req.user.person.id;
    const p = await prisma.person.findFirst({ where: { user_id: req.user && req.user.id }, select: { id: true } });
    return p ? p.id : null;
  } catch (_) { return null; }
}

router.get('/requests', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status && REQUEST_STATUSES.includes(req.query.status)) where.status = req.query.status;
    // ?mine=1 → jen požadavky přiřazené přihlášenému servisákovi.
    if (req.query.mine === '1') {
      const pid = await myPersonId(req);
      where.assignee_id = pid || -1; // -1 = nikdo (když nemá Person, nevidí nic)
    }
    const rows = await prisma.serviceRequest.findMany({ where, orderBy: { created_at: 'desc' } });
    res.json(await _attachAssignees(rows));
  } catch (err) { next(err); }
});

// GET /api/service/requests/:id/trips — cesty (km) k požadavku.
router.get('/requests/:id/trips', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const trips = await prisma.serviceTrip.findMany({ where: { request_id: id }, orderBy: { started_at: 'asc' } });
    res.json(trips);
  } catch (err) { next(err); }
});

// POST /api/service/requests/:id/accept — servisák úkol přijme. NEROZJEDE se,
// dokud nezadá odkud vyjíždí a kam jede (kvůli logování ujetých km). Založí cestu,
// přiřadí požadavek přihlášenému a přepne stav na „reseni".
const acceptSchema = z.object({
  origin: z.string().min(1).max(255),
  destination: z.string().min(1).max(255),
  km: z.number().nonnegative().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});
router.post('/requests/:id/accept', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = acceptSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Vyplň, odkud vyjíždíš a kam jedeš.', detail: parsed.error.flatten() });
    const reqRow = await prisma.serviceRequest.findUnique({ where: { id } });
    if (!reqRow) return res.status(404).json({ error: 'Požadavek nenalezen' });
    const pid = await myPersonId(req);
    const trip = await prisma.serviceTrip.create({
      data: { request_id: id, person_id: pid, origin: parsed.data.origin, destination: parsed.data.destination, km: parsed.data.km ?? null, note: parsed.data.note || null },
    });
    const updated = await prisma.serviceRequest.update({ where: { id }, data: { status: 'reseni', assignee_id: pid || reqRow.assignee_id } });
    res.json({ ok: true, request: updated, trip });
  } catch (err) { next(err); }
});

// POST /api/service/trips/:id/finish — uzavře cestu a doplní ujeté km (když je znáš až po příjezdu).
router.post('/trips/:id/finish', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = { ended_at: new Date() };
    const km = req.body && req.body.km != null ? Number(req.body.km) : null;
    if (km != null && !Number.isNaN(km)) data.km = km;
    if (req.body && req.body.note != null) data.note = String(req.body.note);
    const trip = await prisma.serviceTrip.update({ where: { id }, data });
    res.json({ ok: true, trip });
  } catch (err) { next(err); }
});

const requestSchema = z.object({
  problem: z.string().min(1).max(255),
  action: z.string().max(255).optional().nullable(),
  task: z.string().max(255).optional().nullable(),
  description: z.string().optional().nullable(),
  photo_url: z.string().max(500).optional().nullable(),
  ordered_by: z.string().min(1).max(120),
});

router.post('/requests', async (req, res, next) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    // Zadavatel = přihlášený uživatel (autoritativně z tokenu, ne z klienta).
    const row = await prisma.serviceRequest.create({
      data: Object.assign({}, parsed.data, { status: 'novy', created_by_user_id: (req.user && req.user.id) || null }),
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

const requestPatchSchema = z.object({
  problem: z.string().min(1).max(255).optional(),
  action: z.string().max(255).optional().nullable(),
  task: z.string().max(255).optional().nullable(),
  description: z.string().optional().nullable(),
  photo_url: z.string().max(500).optional().nullable(),
  ordered_by: z.string().min(1).max(120).optional(),
  status: z.enum(['novy', 'reseni', 'vyreseno', 'zamitnuto']).optional(),
  assignee_id: z.number().int().optional().nullable(),
  resolution: z.string().optional().nullable(),
  fix_photo_urls: z.array(z.string().max(500)).optional().nullable(),
});

router.patch('/requests/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = requestPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const row = await prisma.serviceRequest.update({ where: { id }, data: parsed.data });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/requests/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceRequest.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/service/requests/photo — nahraje foto problému (vyfoceno mobilem).
// Vrací { url } pro uložení do pole photo_url požadavku. Za requireAuth (globálně).
router.post('/requests/photo', photoUpload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chybí foto (form field "photo")' });
    const mt = (req.file.mimetype || '').toLowerCase();
    const ext = mt.indexOf('png') >= 0 ? '.png' : mt.indexOf('webp') >= 0 ? '.webp' : mt.indexOf('heic') >= 0 ? '.heic' : '.jpg';
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    await fsp.writeFile(path.join(REQUEST_PHOTOS_DIR, name), req.file.buffer);
    res.status(201).json({ url: '/api/service/requests/photo/' + name });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Foto je větší než 15 MB' });
    next(err);
  }
});

// GET /api/service/requests/photo/:name — servíruje foto (jen přihlášeným).
router.get('/requests/photo/:name', async (req, res, next) => {
  try {
    const name = String(req.params.name || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!name) return res.status(404).send('Foto nenalezeno');
    const abs = path.join(REQUEST_PHOTOS_DIR, name);
    if (!fs.existsSync(abs)) return res.status(404).send('Foto nenalezeno');
    res.sendFile(abs);
  } catch (err) { next(err); }
});

// ─── Stroje v provozu ──────────────────────────────────────────────────────
// Evidence běžících strojů; slouží jako zdroj pole „Problém na stroji" v požadavku.
const MACHINE_STATUSES = ['v_provozu', 'mimo_provozu'];
// Datum z 'YYYY-MM-DD' (nebo prázdné → null). Uloží se jako @db.Date.
function _toDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v).length <= 10 ? String(v) + 'T00:00:00Z' : v);
  return isNaN(d.getTime()) ? null : d;
}

router.get('/machines', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status && MACHINE_STATUSES.includes(req.query.status)) where.status = req.query.status;
    const rows = await prisma.serviceMachine.findMany({ where, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    res.json(rows);
  } catch (err) { next(err); }
});

const machineSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(80).optional().nullable(),
  status: z.enum(['v_provozu', 'mimo_provozu']).optional(),
  commissioned_at: z.string().optional().nullable(),
  revision_at: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

router.post('/machines', async (req, res, next) => {
  try {
    const parsed = machineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const d = parsed.data;
    const row = await prisma.serviceMachine.create({
      data: {
        name: d.name,
        type: d.type || null,
        status: d.status || 'v_provozu',
        commissioned_at: _toDate(d.commissioned_at),
        revision_at: _toDate(d.revision_at),
        note: d.note || null,
      },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// POST /api/service/machines/bulk — hromadný import strojů z Excelu.
// Body: { machines: [{ name, type?, status?, commissioned_at?, revision_at?, note? }] }
router.post('/machines/bulk', async (req, res, next) => {
  try {
    let list = (req.body && req.body.machines) || [];
    if (!Array.isArray(list)) list = [];
    const norm = (s) => String(s == null ? '' : s).trim();
    const data = [];
    let skipped = 0;
    for (const m of list) {
      const name = norm(m && m.name);
      if (!name) { skipped++; continue; }
      const st = norm(m.status).toLowerCase();
      const status = (st.indexOf('mimo') >= 0) ? 'mimo_provozu' : 'v_provozu';
      data.push({
        name: name.slice(0, 200),
        type: norm(m.type).slice(0, 80) || null,
        status,
        commissioned_at: _toDate(m.commissioned_at),
        revision_at: _toDate(m.revision_at),
        note: norm(m.note) || null,
      });
    }
    if (!data.length) return res.status(400).json({ error: 'Žádné platné řádky (chybí název stroje).', skipped });
    const result = await prisma.serviceMachine.createMany({ data });
    res.status(201).json({ ok: true, imported: result.count, skipped });
  } catch (err) { next(err); }
});

const machinePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.string().max(80).optional().nullable(),
  status: z.enum(['v_provozu', 'mimo_provozu']).optional(),
  commissioned_at: z.string().optional().nullable(),
  revision_at: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

router.patch('/machines/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = machinePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const d = parsed.data;
    const data = {};
    if (d.name !== undefined) data.name = d.name;
    if (d.type !== undefined) data.type = d.type || null;
    if (d.status !== undefined) data.status = d.status;
    if (d.commissioned_at !== undefined) data.commissioned_at = _toDate(d.commissioned_at);
    if (d.revision_at !== undefined) data.revision_at = _toDate(d.revision_at);
    if (d.note !== undefined) data.note = d.note || null;
    const row = await prisma.serviceMachine.update({ where: { id }, data });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/machines/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.serviceMachine.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Odečty měřidel (voda/elektro) ─────────────────────────────────────────
// Mobilní formulář pro kolegyni: stavy vodoměru a elektroměru + fotky, k dané
// lokalitě/stroji. Ukládá se do modulu Servis → Odečty.
const METER_PHOTOS_DIR = path.join(__dirname, '..', 'data', 'meter-reading-photos');
if (!fs.existsSync(METER_PHOTOS_DIR)) { fs.mkdirSync(METER_PHOTOS_DIR, { recursive: true }); }

// POST /api/service/readings/photo — nahraje foto měřidla, vrací { url }.
router.post('/readings/photo', photoUpload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chybí foto (form field "photo")' });
    const mt = (req.file.mimetype || '').toLowerCase();
    const ext = mt.indexOf('png') >= 0 ? '.png' : mt.indexOf('webp') >= 0 ? '.webp' : mt.indexOf('heic') >= 0 ? '.heic' : '.jpg';
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    await fsp.writeFile(path.join(METER_PHOTOS_DIR, name), req.file.buffer);
    res.status(201).json({ url: '/api/service/readings/photo/' + name });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Foto je větší než 15 MB' });
    next(err);
  }
});

// GET /api/service/readings/photo/:name — servíruje foto (jen přihlášeným).
router.get('/readings/photo/:name', async (req, res, next) => {
  try {
    const name = String(req.params.name || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!name) return res.status(404).send('Foto nenalezeno');
    const abs = path.join(METER_PHOTOS_DIR, name);
    if (!fs.existsSync(abs)) return res.status(404).send('Foto nenalezeno');
    res.sendFile(abs);
  } catch (err) { next(err); }
});

// Doplní jméno zadavatele k odečtům.
async function _attachReadingUsers(rows) {
  const uids = Array.from(new Set(rows.map((r) => r.created_by_user_id).filter((x) => x != null)));
  let umap = {};
  if (uids.length) {
    const users = await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, display_name: true, username: true } });
    users.forEach((u) => { umap[u.id] = u.display_name || u.username || ('#' + u.id); });
  }
  return rows.map((r) => Object.assign({}, r, {
    water_m3: r.water_m3 != null ? Number(r.water_m3) : null,
    electricity_kwh: r.electricity_kwh != null ? Number(r.electricity_kwh) : null,
    created_by_name: r.created_by_user_id != null ? (umap[r.created_by_user_id] || ('#' + r.created_by_user_id)) : null,
  }));
}

// GET /api/service/readings — seznam odečtů (nejnovější první).
router.get('/readings', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.machine_id) where.machine_id = parseInt(req.query.machine_id, 10) || undefined;
    const rows = await prisma.meterReading.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
    res.json(await _attachReadingUsers(rows));
  } catch (err) { next(err); }
});

const readingSchema = z.object({
  water_m3: z.union([z.number(), z.string()]).optional().nullable(),
  water_photo_url: z.string().max(500).optional().nullable(),
  electricity_kwh: z.union([z.number(), z.string()]).optional().nullable(),
  electricity_photo_url: z.string().max(500).optional().nullable(),
  machine_id: z.number().int().optional().nullable(),
  machine_name: z.string().max(200).optional().nullable(),
  note: z.string().optional().nullable(),
});

// Bezpečný převod čísla z textu (přijme čárku i tečku).
function _num(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  return isNaN(n) ? null : n;
}

// POST /api/service/readings — vytvoří odečet.
router.post('/readings', async (req, res, next) => {
  try {
    const parsed = readingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const d = parsed.data;
    const water = _num(d.water_m3), elek = _num(d.electricity_kwh);
    if (water == null && elek == null && !d.water_photo_url && !d.electricity_photo_url) {
      return res.status(400).json({ error: 'Zadej aspoň jeden stav nebo fotku.' });
    }
    const row = await prisma.meterReading.create({
      data: {
        water_m3: water,
        water_photo_url: d.water_photo_url || null,
        electricity_kwh: elek,
        electricity_photo_url: d.electricity_photo_url || null,
        machine_id: d.machine_id || null,
        machine_name: d.machine_name || null,
        note: d.note || null,
        created_by_user_id: (req.user && req.user.id) || null,
      },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// DELETE /api/service/readings/:id
router.delete('/readings/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.meterReading.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
