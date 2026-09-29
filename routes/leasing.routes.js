// =============================================================================
// HolyOS — Leasing / financující společnosti (financování prádlomatu)
// =============================================================================
// CRUD pro společnosti, které dokáží zákazníkovi zafinancovat prádlomat.
// Záložka „Leasing" v Prodejních objednávkách. IČO se doplňuje z ARES na webu
// (frontend volá /api/compounder/ares?ico=…).
// Mount: /api/leasing v app.js.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Úložiště dokumentů (Railway persistent volume přes DATA_DIR).
const DATA_ROOT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LEASING_DOCS_DIR = path.join(DATA_ROOT, 'leasing-docs');
try { if (!fs.existsSync(LEASING_DOCS_DIR)) fs.mkdirSync(LEASING_DOCS_DIR, { recursive: true }); } catch (e) { /* ignore */ }

// Kategorie žadatele o financování.
// fo/po_firma/po_zivnost = podklady k žádosti dle typu žadatele; nabidka = nabídky financování zaslané pro naše klienty
const DOC_CATEGORIES = ['fo', 'po_firma', 'po_zivnost', 'nabidka'];

const emptyToNull = (v) => { const s = (v == null ? '' : String(v)).trim(); return s ? s : null; };

const schema = z.object({
  name: z.string().trim().min(1).max(255),
  ico: z.string().trim().max(20).optional(),
  dic: z.string().trim().max(20).optional(),
  address: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  zip: z.string().trim().max(20).optional(),
  country: z.string().trim().max(4).optional(),
  contact_name: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(255).optional(),
  note: z.string().trim().max(6000).optional(),
  active: z.boolean().optional(),
});

// GET /api/leasing — seznam (volitelně ?q= a ?active=1)
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = {};
    if (req.query.active === '1') where.active = true;
    if (q) where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { ico: { contains: q } },
      { city: { contains: q, mode: 'insensitive' } },
      { contact_name: { contains: q, mode: 'insensitive' } },
    ];
    const rows = await prisma.leasingCompany.findMany({ where, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    // Počty dokumentů / nabídek pro sloupce v seznamu.
    const counts = rows.length ? await prisma.leasingDocument.groupBy({ by: ['leasing_company_id', 'category'], where: { leasing_company_id: { in: rows.map((x) => x.id) } }, _count: { _all: true } }).catch(() => []) : [];
    const byId = {};
    counts.forEach((c) => { const o = (byId[c.leasing_company_id] = byId[c.leasing_company_id] || { docs: 0, offers: 0 }); if (c.category === 'nabidka') o.offers += c._count._all; else o.docs += c._count._all; });
    res.json(rows.map((x) => Object.assign({}, x, { docs_count: (byId[x.id] || {}).docs || 0, offers_count: (byId[x.id] || {}).offers || 0 })));
  } catch (err) { next(err); }
});

function dataFrom(d) {
  return {
    name: d.name,
    ico: emptyToNull(d.ico), dic: emptyToNull(d.dic),
    address: emptyToNull(d.address), city: emptyToNull(d.city), zip: emptyToNull(d.zip),
    country: emptyToNull(d.country) || 'CZ',
    contact_name: emptyToNull(d.contact_name), phone: emptyToNull(d.phone), email: emptyToNull(d.email),
    note: emptyToNull(d.note),
    active: d.active === undefined ? true : !!d.active,
  };
}

// POST /api/leasing — nová společnost
router.post('/', async (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Vyplň název společnosti.' });
    const created = await prisma.leasingCompany.create({ data: dataFrom(parsed.data) });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/leasing/:id — úprava
router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const parsed = schema.partial({ name: true }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const d = parsed.data;
    const data = {};
    ['name'].forEach((k) => { if (d[k] !== undefined) data[k] = d[k]; });
    ['ico', 'dic', 'address', 'city', 'zip', 'contact_name', 'phone', 'email', 'note'].forEach((k) => { if (d[k] !== undefined) data[k] = emptyToNull(d[k]); });
    if (d.country !== undefined) data.country = emptyToNull(d.country) || 'CZ';
    if (d.active !== undefined) data.active = !!d.active;
    const updated = await prisma.leasingCompany.update({ where: { id: Number(req.params.id) }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/leasing/:id
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    // Smazat i soubory dokumentů (best-effort), DB kaskáduje.
    const docs = await prisma.leasingDocument.findMany({ where: { leasing_company_id: Number(req.params.id) }, select: { file_path: true } });
    for (const d of docs) { if (d.file_path) { try { const p = path.join(DATA_ROOT, d.file_path); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ } } }
    await prisma.leasingCompany.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOKUMENTY K ŽÁDOSTI O FINANCOVÁNÍ (dle typu žadatele)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/leasing/:id/documents — seznam dokumentů společnosti
router.get('/:id(\\d+)/documents', async (req, res, next) => {
  try {
    const items = await prisma.leasingDocument.findMany({
      where: { leasing_company_id: Number(req.params.id) },
      orderBy: [{ category: 'asc' }, { created_at: 'asc' }],
    });
    res.json({ items, categories: DOC_CATEGORIES });
  } catch (err) { next(err); }
});

// POST /api/leasing/:id/documents — nahrát dokument (base64 data URL) nebo jen položku
// Body: { category, title, note?, data_url?, filename? }
router.post('/:id(\\d+)/documents', async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const s = z.object({
      category: z.enum(DOC_CATEGORIES),
      title: z.string().trim().min(1).max(300),
      note: z.string().trim().max(2000).optional().nullable(),
      data_url: z.string().optional().nullable(),
      filename: z.string().max(300).optional().nullable(),
    });
    const parsed = s.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.format() });
    const d = parsed.data;

    const company = await prisma.leasingCompany.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) return res.status(404).json({ error: 'Společnost nenalezena' });

    let file_path = null, size_bytes = null, mime_type = null;
    if (d.data_url) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(d.data_url);
      if (!m) return res.status(400).json({ error: 'Očekávám data URL (data:...;base64,...)' });
      mime_type = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Soubor je větší než 25 MB' });
      const rawExt = (d.filename && d.filename.includes('.')) ? d.filename.split('.').pop() : (mime_type.split('/')[1] || 'bin');
      const ext = String(rawExt).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
      const fname = `leasing-${companyId}-${d.category}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(LEASING_DOCS_DIR, fname), buf);
      file_path = `leasing-docs/${fname}`;
      size_bytes = buf.length;
    }

    const doc = await prisma.leasingDocument.create({
      data: { leasing_company_id: companyId, category: d.category, title: d.title, note: d.note || null, file_path, mime_type, size_bytes },
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// GET /api/leasing/documents/:did/download — stažení souboru
router.get('/documents/:did(\\d+)/download', async (req, res, next) => {
  try {
    const doc = await prisma.leasingDocument.findUnique({ where: { id: Number(req.params.did) } });
    if (!doc || !doc.file_path) return res.status(404).json({ error: 'Soubor nenalezen' });
    const full = path.join(DATA_ROOT, doc.file_path);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Soubor na disku chybí' });
    const ext = doc.file_path.split('.').pop();
    const safeTitle = String(doc.title || 'dokument').replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 100);
    if (doc.mime_type) res.type(doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
    res.sendFile(full);
  } catch (err) { next(err); }
});

// DELETE /api/leasing/documents/:did
router.delete('/documents/:did(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.did);
    const doc = await prisma.leasingDocument.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ error: 'Dokument nenalezen' });
    if (doc.file_path) { try { const p = path.join(DATA_ROOT, doc.file_path); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ } }
    await prisma.leasingDocument.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// KALKULAČKA — AI vytěžení parametrů z nabídek + koeficienty
// ═══════════════════════════════════════════════════════════════

// Text z nahraného souboru (PDF přes pdf-parse; obrázky/ostatní se posílají Claude jako dokument/obrázek).
async function docToClaudeContent(doc) {
  const full = path.join(DATA_ROOT, doc.file_path);
  if (!fs.existsSync(full)) throw new Error('Soubor na disku chybí');
  const buf = fs.readFileSync(full);
  const mime = String(doc.mime_type || '');
  if (mime === 'application/pdf' || /\.pdf$/i.test(doc.file_path)) {
    // Nativní PDF pro Claude (umí i naskenované) — do 20 MB.
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }];
  }
  if (/^image\/(png|jpe?g|webp|gif)$/.test(mime)) {
    return [{ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } }];
  }
  // DOCX/XLSX apod. — vytáhnout text jednoduše (mammoth/xlsx jsou v projektu)
  try {
    if (/wordprocessingml/.test(mime) || /\.docx$/i.test(doc.file_path)) { const mammoth = require('mammoth'); const r = await mammoth.extractRawText({ buffer: buf }); return [{ type: 'text', text: r.value.slice(0, 60000) }]; }
    if (/spreadsheetml|ms-excel/.test(mime) || /\.xlsx?$/i.test(doc.file_path)) { const XLSX = require('xlsx'); const wb = XLSX.read(buf, { type: 'buffer' }); const out = []; wb.SheetNames.forEach((n) => { out.push('--- ' + n + ' ---'); out.push(XLSX.utils.sheet_to_csv(wb.Sheets[n])); }); return [{ type: 'text', text: out.join('\n').slice(0, 60000) }]; }
  } catch (e) { /* fallback níže */ }
  return [{ type: 'text', text: buf.toString('utf8').slice(0, 60000) }];
}

const EXTRACT_PROMPT = `Jsi analytik financování. Z přiložené nabídky leasingu / úvěru vytěž parametry a vrať POUZE JSON (bez komentáře) s klíči:
{
 "client": string|null,            // jméno klienta / firmy, pro kterou je nabídka
 "machine": string|null,           // předmět financování (stroj, model)
 "product": string|null,           // typ produktu: "finanční leasing" | "operativní leasing" | "úvěr" | jiné
 "currency": "CZK"|"EUR"|null,
 "price_excl_vat": number|null,    // pořizovací cena bez DPH
 "price_incl_vat": number|null,    // pořizovací cena s DPH
 "akontace_pct": number|null,      // akontace / mimořádná splátka v % z ceny
 "akontace_amount": number|null,   // akontace v penězích (bez DPH pokud lze)
 "months": number|null,            // délka financování v měsících
 "monthly_excl_vat": number|null,  // pravidelná měsíční splátka bez DPH
 "monthly_incl_vat": number|null,  // měsíční splátka s DPH
 "residual_value": number|null,    // zůstatková / odkupní hodnota na konci (bez DPH pokud lze)
 "insurance_monthly": number|null, // pojištění měsíčně, pokud je uvedeno zvlášť
 "fees": number|null,              // jednorázové poplatky (zpracování smlouvy apod.)
 "interest_rate_pct": number|null, // úrok / RPSN p.a., pokud uveden
 "valid_until": string|null,       // platnost nabídky (ISO datum nebo text)
 "offer_number": string|null,      // číslo nabídky
 "notes": string|null              // krátká poznámka o podmínkách (max 300 znaků)
}
Čísla zapisuj jako čistá čísla (bez mezer, měny, %). Pokud je v nabídce více variant, vyber tu hlavní/doporučenou a do notes napiš, že existují další varianty. Když údaj chybí, dej null.`;

async function extractOfferParams(doc) {
  const Anthropic = require('@anthropic-ai/sdk');
  const { messagesCreate } = require('../services/anthropic-retry');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nakonfigurovaný');
  const client = new Anthropic({ apiKey });
  const content = await docToClaudeContent(doc);
  content.push({ type: 'text', text: EXTRACT_PROMPT + '\n\nNázev souboru / nabídky: ' + (doc.title || '') + (doc.note ? '\nPoznámka obchodníka: ' + doc.note : '') });
  const resp = await messagesCreate(client, { model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content }] });
  const txt = (resp.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI nevrátila JSON');
  const p = JSON.parse(m[0]);
  const num = (v) => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
  const out = {
    client: p.client || null, machine: p.machine || null, product: p.product || null, currency: p.currency || null,
    price_excl_vat: num(p.price_excl_vat), price_incl_vat: num(p.price_incl_vat),
    akontace_pct: num(p.akontace_pct), akontace_amount: num(p.akontace_amount),
    months: num(p.months), monthly_excl_vat: num(p.monthly_excl_vat), monthly_incl_vat: num(p.monthly_incl_vat),
    residual_value: num(p.residual_value), insurance_monthly: num(p.insurance_monthly), fees: num(p.fees),
    interest_rate_pct: num(p.interest_rate_pct), valid_until: p.valid_until || null, offer_number: p.offer_number || null,
    notes: p.notes ? String(p.notes).slice(0, 400) : null,
    extracted_at: new Date().toISOString(),
  };
  // Dopočty: chybějící akontace % / částka, koeficienty pro kalkulačku (vše bez DPH, pokud jde)
  const price = out.price_excl_vat || (out.price_incl_vat ? out.price_incl_vat / 1.21 : null);
  const monthly = out.monthly_excl_vat || (out.monthly_incl_vat ? out.monthly_incl_vat / 1.21 : null);
  if (price && out.akontace_amount == null && out.akontace_pct != null) out.akontace_amount = Math.round(price * out.akontace_pct / 100);
  if (price && out.akontace_pct == null && out.akontace_amount != null) out.akontace_pct = Math.round(out.akontace_amount / price * 1000) / 10;
  if (price && monthly && out.months) {
    const ak = out.akontace_amount || 0, rv = out.residual_value || 0;
    const financed = price - ak;
    out.calc = {
      price, monthly, financed,
      monthly_factor: financed > 0 ? monthly / financed : null,           // splátka / financovaná částka
      total_paid: ak + monthly * out.months + rv + (out.fees || 0),
      overpay_pct: Math.round(((ak + monthly * out.months + rv + (out.fees || 0)) / price - 1) * 1000) / 10,
    };
  }
  return out;
}

// POST /api/leasing/documents/:did/extract — AI vytěžení parametrů jedné nabídky
router.post('/documents/:did(\\d+)/extract', async (req, res, next) => {
  try {
    const doc = await prisma.leasingDocument.findUnique({ where: { id: Number(req.params.did) } });
    if (!doc) return res.status(404).json({ error: 'Dokument nenalezen' });
    if (!doc.file_path) return res.status(400).json({ error: 'Nabídka nemá přiložený soubor' });
    const params = await extractOfferParams(doc);
    const saved = await prisma.leasingDocument.update({ where: { id: doc.id }, data: { params } });
    res.json(saved);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/leasing/:id/documents/extract-all — vytěžit všechny nabídky společnosti bez parametrů (nebo ?force=1 všechny)
router.post('/:id(\\d+)/documents/extract-all', async (req, res, next) => {
  try {
    const docs = await prisma.leasingDocument.findMany({ where: { leasing_company_id: Number(req.params.id), category: 'nabidka', file_path: { not: null } } });
    const out = [];
    for (const d of docs) {
      if (d.params && !req.query.force) { out.push({ id: d.id, skipped: true }); continue; }
      try { const params = await extractOfferParams(d); await prisma.leasingDocument.update({ where: { id: d.id }, data: { params } }); out.push({ id: d.id, ok: true }); }
      catch (e) { out.push({ id: d.id, error: e.message }); }
    }
    res.json({ ok: true, results: out });
  } catch (err) { next(err); }
});

// GET /api/leasing/calc-data — všechny vytěžené nabídky (pro kalkulačku), seskupené po společnostech
router.get('/calc-data', async (req, res, next) => {
  try {
    const docs = await prisma.leasingDocument.findMany({
      where: { category: 'nabidka', params: { not: null } },
      include: { company: { select: { id: true, name: true, active: true } } },
      orderBy: { created_at: 'desc' },
    });
    const byCo = {};
    docs.forEach((d) => {
      const p = d.params || {}; if (!p.calc || !p.calc.monthly_factor) return;
      const c = (byCo[d.company.id] = byCo[d.company.id] || { company_id: d.company.id, company: d.company.name, active: d.company.active, offers: [] });
      c.offers.push({ id: d.id, title: d.title, client: p.client, machine: p.machine, product: p.product, months: p.months, akontace_pct: p.akontace_pct,
        price: p.calc.price, monthly: p.calc.monthly, residual_value: p.residual_value || 0, fees: p.fees || 0, interest_rate_pct: p.interest_rate_pct,
        monthly_factor: p.calc.monthly_factor, overpay_pct: p.calc.overpay_pct, created_at: d.created_at });
    });
    res.json({ companies: Object.values(byCo), total_offers: docs.length });
  } catch (err) { next(err); }
});

module.exports = router;
