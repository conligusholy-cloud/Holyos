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

// ═══════════════════════════════════════════════════════════════
// VEŘEJNÉ (bez auth): odpověď leasingové společnosti na poptávku přes odkaz s tokenem
// ═══════════════════════════════════════════════════════════════
const INQ_STATUS_LABEL = { sent: 'Odesláno', opened: 'Otevřeno', in_progress: 'Zpracovává se', approved: 'Schváleno', rejected: 'Zamítnuto', canceled: 'Zrušeno' };
function fmtKcSrv(n) { return Math.round(Number(n) || 0).toLocaleString('cs-CZ') + ' Kč'; }
function escH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function inquiryReplyHtml(inq, company, msg) {
  const client = ((inq.client_first_name || '') + ' ' + (inq.client_last_name || '')).trim();
  const st = inq.status;
  const done = st === 'approved' || st === 'rejected';
  const btn = (val, label, color) => `<button type="submit" name="status" value="${val}" style="flex:1;min-width:140px;border:none;border-radius:12px;padding:16px 14px;font-size:16px;font-weight:700;color:#fff;background:${color};cursor:pointer;font-family:inherit;${st === val ? 'outline:3px solid #fff;' : ''}">${label}</button>`;
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Poptávka financování – ${escH(client)}</title>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#eaf2ff;color:#0f2444}.wrap{max-width:640px;margin:0 auto;padding:28px 18px 60px}.card{background:#fff;border:1px solid #cfe0fb;border-radius:18px;overflow:hidden;margin-bottom:16px}.head{padding:22px 26px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#fff}.head .b{font-size:20px;font-weight:800;letter-spacing:.04em}.head small{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#dbe8ff;margin-top:4px}.body{padding:22px 26px}h1{font-size:20px;margin:0 0 6px}.kv{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}.kv div{background:#f3f7ff;border:1px solid #dbe8ff;border-radius:10px;padding:10px 12px}.kv small{display:block;font-size:10.5px;color:#6b7d99;text-transform:uppercase;letter-spacing:.05em}.kv b{font-size:15px}.muted{color:#6b7d99;font-size:13px}.btns{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}label{display:block;font-size:12.5px;color:#425774;font-weight:600;margin:12px 0 5px}textarea,input{width:100%;box-sizing:border-box;border:1px solid #cfe0fb;border-radius:10px;padding:11px 12px;font-size:15px;font-family:inherit}.ok{background:#e8f8ef;border:1px solid #9fe0b8;color:#0f6b3a;border-radius:10px;padding:12px 14px;font-weight:600;margin-bottom:12px}.pill{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12.5px;font-weight:700;background:#dbe8ff;color:#1d4ed8}.foot{font-size:11.5px;color:#6b7d99;text-align:center;margin-top:16px;line-height:1.6}</style></head>
<body><div class="wrap">
<div class="card"><div class="head"><div class="b">💧 PRÁDLOMATY</div><small>Best Series s.r.o. · poptávka financování</small></div>
<div class="body">
${msg ? `<div class="ok">${escH(msg)}</div>` : ''}
<h1>Poptávka financování pro klienta ${escH(client)}</h1>
<div class="muted">Pro ${escH(company.name)}${company.contact_name ? ' · k rukám ' + escH(company.contact_name) : ''} · odesláno ${new Date(inq.sent_at).toLocaleDateString('cs-CZ')} · aktuální stav: <span class="pill">${escH(INQ_STATUS_LABEL[st] || st)}</span></div>
<div class="kv">
<div><small>Klient</small><b>${escH(client)}</b>${inq.client_company ? '<div class="muted">' + escH(inq.client_company) + (inq.client_ico ? ' · IČO ' + escH(inq.client_ico) : '') + '</div>' : ''}</div>
<div><small>Kontakt</small><b>${escH(inq.client_phone || '—')}</b><div class="muted">${escH(inq.client_email || '')}</div></div>
<div><small>Předmět financování</small><b>${escH(inq.subject)}</b></div>
<div><small>Cena bez DPH</small><b>${fmtKcSrv(inq.price)}</b>${inq.akontace_pct != null ? '<div class="muted">akontace ' + Number(inq.akontace_pct) + ' %' + (inq.months ? ' · ' + inq.months + ' měs.' : '') + '</div>' : (inq.months ? '<div class="muted">' + inq.months + ' měs.</div>' : '')}</div>
</div>
${inq.note ? '<div class="muted" style="margin-bottom:8px"><b>Poznámka obchodníka:</b> ' + escH(inq.note) + '</div>' : ''}
<form method="POST" action="/api/leasing/inquiry/${escH(inq.token)}/respond">
<label>Označte prosím stav poptávky (stačí jedno kliknutí):</label>
<div class="btns">${btn('in_progress', '⏳ Zpracováváme', '#f59e0b')}${btn('approved', '✅ Schváleno', '#16a34a')}${btn('rejected', '❌ Zamítnuto', '#dc2626')}</div>
<label>Podmínky / měsíční splátka / důvod (volitelné)</label>
<textarea name="result_note" rows="4" placeholder="např. schváleno na 60 měsíců, akontace 10 %, splátka 24 500 Kč bez DPH, platnost do 15. 10.">${escH(inq.result_note || '')}</textarea>
<label>Měsíční splátka bez DPH (Kč, volitelné)</label>
<input name="result_monthly" inputmode="numeric" value="${inq.result_monthly != null ? Math.round(Number(inq.result_monthly)) : ''}" placeholder="např. 24500">
<div class="muted" style="margin-top:10px">Odpověď se okamžitě zobrazí obchodníkovi Best Series. Očekáváme výsledek do 3 pracovních dnů — děkujeme.</div>
</form>
</div></div>
<div class="foot">Best Series s.r.o. · IČO 05643724 · Česká republika · tento odkaz je určen pouze pro ${escH(company.name)}</div>
</div></body></html>`;
}

// GET /api/leasing/inquiry/:token — stránka pro leasingovku (první otevření = stav „opened")
router.get('/inquiry/:token', async (req, res) => {
  try {
    const inq = await prisma.leasingInquiry.findUnique({ where: { token: String(req.params.token) }, include: { company: true } });
    if (!inq) return res.status(404).send('Odkaz je neplatný.');
    if (!inq.opened_at) {
      const upd = await prisma.leasingInquiry.update({ where: { id: inq.id }, data: { opened_at: new Date(), status: inq.status === 'sent' ? 'opened' : inq.status } });
      try { require('../services/leasing/notify').notifyLeasingInquiry(prisma, upd, 'opened'); } catch (e) { /* */ }
      inq.status = upd.status;
    }
    res.set('Content-Type', 'text/html; charset=utf-8').send(inquiryReplyHtml(inq, inq.company, null));
  } catch (err) { res.status(500).send('Chyba: ' + err.message); }
});

// POST /api/leasing/inquiry/:token/respond — leasingovka označí stav + podmínky
router.post('/inquiry/:token/respond', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const inq = await prisma.leasingInquiry.findUnique({ where: { token: String(req.params.token) }, include: { company: true } });
    if (!inq) return res.status(404).send('Odkaz je neplatný.');
    const status = ['in_progress', 'approved', 'rejected'].indexOf(req.body.status) !== -1 ? req.body.status : null;
    if (!status) return res.status(400).send('Neplatný stav.');
    const monthlyRaw = String(req.body.result_monthly || '').replace(/[^0-9.,]/g, '').replace(',', '.');
    const data = { status, responded_at: new Date(), result_note: String(req.body.result_note || '').trim().slice(0, 4000) || null, result_monthly: monthlyRaw ? Number(monthlyRaw) : null };
    const upd = await prisma.leasingInquiry.update({ where: { id: inq.id }, data });
    try { require('../services/leasing/notify').notifyLeasingInquiry(prisma, upd, status); } catch (e) { /* */ }
    res.set('Content-Type', 'text/html; charset=utf-8').send(inquiryReplyHtml(Object.assign({}, inq, upd), inq.company, 'Děkujeme, stav „' + INQ_STATUS_LABEL[status] + '" byl předán obchodníkovi Best Series.'));
  } catch (err) { res.status(500).send('Chyba: ' + err.message); }
});

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
// POPTÁVKY FINANCOVÁNÍ (chráněné) — odeslání za klienta, přehled, změna stavu
// ═══════════════════════════════════════════════════════════════
const crypto = require('crypto');
function inquiryPublicUrl(token) {
  const { getShareBaseUrl } = require('../services/share-url');
  return (getShareBaseUrl() || (process.env.APP_URL || '')).replace(/\/$/, '') + '/api/leasing/inquiry/' + token;
}


// Založí poptávky a odešle e-mail + SMS každé vybrané leasingovce. Vrací pole výsledků.
async function createAndSendInquiries(companies, d, personId, senderName) {
  const { sendMail } = require('../services/email');
  const sms = require('../services/voice/sms');
  // Odesílatel: schránka Prádlomaty (stejná jako e-mail AI specialisty), až pak Compounder.
  const from = process.env.LEASING_MAIL_FROM || process.env.COMPOUNDER_SPECIALIST_MAIL_FROM || process.env.COMPOUNDER_MAIL_FROM || null;
  // Podpis: celé jméno obchodníka z Person (ne login), fallback obecný.
  let signer = 'Obchodní tým';
  if (personId) { try { const pp = await prisma.person.findUnique({ where: { id: personId }, select: { first_name: true, last_name: true, phone: true, email: true } }); if (pp) { signer = ((pp.first_name || '') + ' ' + (pp.last_name || '')).trim() || signer; signer += (pp.phone ? '\n' + pp.phone : '') + (pp.email ? '\n' + pp.email : ''); } } catch (e) { /* */ } }
  else if (senderName && senderName.indexOf('.') === -1 && senderName.indexOf('@') === -1) signer = senderName;
  const out = [];
  for (const c of companies) {
    const token = crypto.randomBytes(24).toString('base64url').slice(0, 40);
    const deadline = new Date(Date.now() + 3 * 86400000);
    let inq = await prisma.leasingInquiry.create({ data: {
      leasing_company_id: c.id, compounder_lead_id: d.lead_id || null, sent_by_person_id: personId, token,
      client_first_name: d.client_first_name, client_last_name: d.client_last_name, client_company: d.client_company || null, client_ico: d.client_ico || null,
      client_email: d.client_email || null, client_phone: d.client_phone || null, subject: d.subject, price: d.price,
      akontace_pct: d.akontace_pct == null ? null : d.akontace_pct, months: d.months || null, note: d.note || null, deadline_at: deadline,
    } });
    const url = inquiryPublicUrl(token);
    const client = d.client_first_name + ' ' + d.client_last_name;
    const errs = [];
    let email_sent = false;
    if (c.email && from) {
      const greetName = (c.contact_name && c.contact_name.indexOf('.') === -1 && c.contact_name.indexOf('@') === -1) ? c.contact_name : '';
      const body = 'Dobrý den' + (greetName ? ', ' + greetName : '') + ',\n\nposíláme Vám poptávku financování pro našeho klienta:\n\n'
        + 'Klient: ' + client + (d.client_company ? ' (' + d.client_company + (d.client_ico ? ', IČO ' + d.client_ico : '') + ')' : '') + '\n'
        + 'Kontakt: ' + [d.client_phone, d.client_email].filter(Boolean).join(', ') + '\n'
        + 'Předmět financování: ' + d.subject + '\n'
        + 'Cena bez DPH: ' + fmtKcSrv(d.price) + (d.akontace_pct != null ? ', akontace ' + d.akontace_pct + ' %' : '') + (d.months ? ', ' + d.months + ' měsíců' : '') + '\n'
        + (d.note ? 'Poznámka: ' + d.note + '\n' : '')
        + '\nProsíme o označení stavu (zpracováváme / schváleno / zamítnuto) a podmínek přes tlačítko níže — výsledek očekáváme do 3 pracovních dnů.\n\nDěkujeme,\n' + signer + '\nBest Series s.r.o. – Prádlomaty';
      try {
        const r = await sendMail({ to: c.email, subject: 'Poptávka financování – ' + client + ' – ' + d.subject, body, from, fromName: 'Best Series – Prádlomaty', link: url, linkLabel: 'Otevřít poptávku a označit stav', brand: 'pradlomaty' });
        email_sent = !!(r && r.sent); if (!email_sent) errs.push('e-mail: ' + ((r && (r.error || r.skipped)) || '?'));
      } catch (e) { errs.push('e-mail: ' + e.message); }
    } else errs.push(!c.email ? 'leasingovka nemá e-mail' : 'není nastavený odesílatel (LEASING_MAIL_FROM / COMPOUNDER_MAIL_FROM)');
    let sms_sent = false, sms_id = null;
    const phoneDigits = String(c.phone || '').replace(/[^0-9+]/g, '');
    if (phoneDigits.replace(/\D/g, '').length >= 9) {
      try {
        const text = 'Best Series: poptavka financovani pro klienta ' + client + ' (' + d.subject + ', ' + Math.round(d.price).toLocaleString('cs-CZ') + ' Kc bez DPH). Detail + potvrzeni stavu: ' + url;
        sms_id = await sms.sendSms(phoneDigits, text, { context: 'leasing_inquiry', inquiryId: inq.id });
        sms_sent = true;
      } catch (e) { errs.push('SMS: ' + e.message); }
    } else errs.push(c.phone ? 'telefon leasingovky je neúplný (' + c.phone + ')' : 'leasingovka nemá telefon');
    inq = await prisma.leasingInquiry.update({ where: { id: inq.id }, data: { email_sent, sms_sent, sms_id: sms_id ? String(sms_id) : null } });
    if (d.lead_id) {
      prisma.compounderEvent.create({ data: { sid: 'server', event: 'leasing_inquiry_sent', path: '/leasing', props: { lead_id: d.lead_id, inquiry_id: inq.id, company: c.name, price: d.price, subject: d.subject, email_sent, sms_sent } } }).catch(() => {});
    }
    out.push({ id: inq.id, company: c.name, email_sent, sms_sent, public_url: url, deadline_at: deadline, errors: errs });
  }
  return out;
}

// POST /api/leasing/inquiries/test — pošle testovací poptávku na zadaný e-mail + telefon (jako by byl leasingovka).
// Založí/aktualizuje skrytou společnost „🧪 Test – <jméno>" (active=false), ať jde vidět i stránka pro odpověď.
router.post('/inquiries/test', async (req, res, next) => {
  try {
    const email = String((req.body && req.body.email) || '').trim() || null;
    const phone = String((req.body && req.body.phone) || '').trim() || null;
    if (!email && !phone) return res.status(400).json({ error: 'Zadej e-mail nebo telefon' });
    const personId = (req.user && req.user.person_id) || (req.user && req.user.person && req.user.person.id) || null;
    let who = (req.user && req.user.display_name) || null;
    if (personId) { try { const pp = await prisma.person.findUnique({ where: { id: personId }, select: { first_name: true, last_name: true } }); if (pp) who = ((pp.first_name || '') + ' ' + (pp.last_name || '')).trim() || who; } catch (e) { /* */ } }
    who = who || (req.user && req.user.username) || 'já';
    const name = '🧪 Test – ' + who;
    let c = await prisma.leasingCompany.findFirst({ where: { name } });
    c = c ? await prisma.leasingCompany.update({ where: { id: c.id }, data: { email, phone, contact_name: who, active: false } })
          : await prisma.leasingCompany.create({ data: { name, email, phone, contact_name: who, active: false, note: 'Testovací záznam pro zkoušku poptávek — neposílat klientům.' } });
    const d = { lead_id: null, client_first_name: 'Jan', client_last_name: 'Testovací', client_company: 'Testovací s.r.o.', client_ico: '05643724', client_email: 'jan.testovaci@example.cz', client_phone: '+420 777 000 000',
      subject: 'Prádlomat MINI SK, 1 ks (TEST)', price: 1500000, akontace_pct: 10, months: 60, note: 'Testovací poptávka z HolyOS — takhle to uvidí leasingovka.' };
    const out = await createAndSendInquiries([c], d, personId, who);
    res.status(201).json({ ok: true, sent: out });
  } catch (err) { next(err); }
});

// GET /api/leasing/inquiries?lead_id=&company_id=&status=
router.get('/inquiries', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.lead_id) where.compounder_lead_id = Number(req.query.lead_id);
    if (req.query.company_id) where.leasing_company_id = Number(req.query.company_id);
    if (req.query.status) where.status = String(req.query.status);
    const rows = await prisma.leasingInquiry.findMany({ where, orderBy: { sent_at: 'desc' }, take: 500, include: { company: { select: { id: true, name: true, contact_name: true, phone: true, email: true } } } });
    const pids = Array.from(new Set(rows.map((r) => r.sent_by_person_id).filter(Boolean)));
    const people = pids.length ? await prisma.person.findMany({ where: { id: { in: pids } }, select: { id: true, first_name: true, last_name: true } }) : [];
    const pname = {}; people.forEach((p) => { pname[p.id] = ((p.first_name || '') + ' ' + (p.last_name || '')).trim(); });
    res.json(rows.map((r) => Object.assign({}, r, { sent_by_name: pname[r.sent_by_person_id] || null, public_url: inquiryPublicUrl(r.token), overdue: !!(r.deadline_at && new Date(r.deadline_at) < new Date() && ['sent', 'opened', 'in_progress'].indexOf(r.status) !== -1) })));
  } catch (err) { next(err); }
});

// POST /api/leasing/inquiries — odeslat poptávku leasingovce (e-mail + SMS s odkazem pro odpověď)
// { company_ids: [..], lead_id?, client_first_name, client_last_name, client_company?, client_ico?, client_email?, client_phone?, subject, price, akontace_pct?, months?, note? }
router.post('/inquiries', async (req, res, next) => {
  try {
    const s = z.object({
      company_ids: z.array(z.number().int()).min(1, 'Vyber alespoň jednu leasingovou společnost'),
      lead_id: z.number().int().optional().nullable(),
      client_first_name: z.string().trim().min(1, 'Zadej jméno').max(120),
      client_last_name: z.string().trim().min(1, 'Zadej příjmení').max(120),
      client_company: z.string().trim().max(255).optional().nullable(),
      client_ico: z.string().trim().max(20).optional().nullable(),
      client_email: z.string().trim().max(255).optional().nullable(),
      client_phone: z.string().trim().max(60).optional().nullable(),
      subject: z.string().trim().min(1, 'Napiš, co se bude financovat').max(300),
      price: z.number().positive('Zadej cenu'),
      akontace_pct: z.number().min(0).max(100).optional().nullable(),
      months: z.number().int().min(1).max(120).optional().nullable(),
      note: z.string().trim().max(4000).optional().nullable(),
    });
    const parsed = s.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(', ') });
    const d = parsed.data;
    const personId = (req.user && req.user.person_id) || (req.user && req.user.person && req.user.person.id) || null;
    const senderName = (req.user && (req.user.display_name || req.user.username)) || 'obchodník Best Series';
    const companies = await prisma.leasingCompany.findMany({ where: { id: { in: d.company_ids } } });
    if (!companies.length) return res.status(404).json({ error: 'Leasingová společnost nenalezena' });
    const out = await createAndSendInquiries(companies, d, personId, senderName);
    res.status(201).json({ ok: true, sent: out });
  } catch (err) { next(err); }
});

// PATCH /api/leasing/inquiries/:id — ruční změna stavu / poznámky (např. po telefonátu)
router.patch('/inquiries/:id(\\d+)', async (req, res, next) => {
  try {
    const b = req.body || {}; const data = {};
    if (b.status && Object.keys(INQ_STATUS_LABEL).indexOf(b.status) !== -1) { data.status = b.status; if (['approved', 'rejected', 'in_progress'].indexOf(b.status) !== -1) data.responded_at = new Date(); }
    if (b.result_note !== undefined) data.result_note = String(b.result_note || '').slice(0, 4000) || null;
    if (b.result_monthly !== undefined) data.result_monthly = b.result_monthly == null || b.result_monthly === '' ? null : Number(b.result_monthly);
    const upd = await prisma.leasingInquiry.update({ where: { id: Number(req.params.id) }, data });
    res.json(upd);
  } catch (err) { next(err); }
});

// POST /api/leasing/inquiries/:id/resend — znovu poslat e-mail + SMS (připomínka)
router.post('/inquiries/:id(\\d+)/resend', async (req, res, next) => {
  try {
    const inq = await prisma.leasingInquiry.findUnique({ where: { id: Number(req.params.id) }, include: { company: true } });
    if (!inq) return res.status(404).json({ error: 'Poptávka nenalezena' });
    const url = inquiryPublicUrl(inq.token); const client = inq.client_first_name + ' ' + inq.client_last_name; const errs = [];
    const { sendMail } = require('../services/email'); const sms = require('../services/voice/sms');
    const from = process.env.LEASING_MAIL_FROM || process.env.COMPOUNDER_SPECIALIST_MAIL_FROM || process.env.COMPOUNDER_MAIL_FROM || null;
    if (inq.company.email && from) { try { await sendMail({ to: inq.company.email, subject: 'Připomínka: poptávka financování – ' + client, body: 'Dobrý den,\n\ndovolujeme si připomenout poptávku financování pro klienta ' + client + ' (' + inq.subject + ', ' + fmtKcSrv(inq.price) + ' bez DPH). Prosíme o označení stavu přes odkaz níže.\n\nDěkujeme, Best Series – Prádlomaty', from, fromName: 'Best Series – Prádlomaty', link: url, linkLabel: 'Otevřít poptávku', brand: 'pradlomaty' }); } catch (e) { errs.push('e-mail: ' + e.message); } }
    if (inq.company.phone) { try { await sms.sendSms(inq.company.phone, 'Best Series: pripominka poptavky financovani pro ' + client + '. Stav prosim oznacte zde: ' + url, { context: 'leasing_inquiry', inquiryId: inq.id }); } catch (e) { errs.push('SMS: ' + e.message); } }
    res.json({ ok: true, errors: errs });
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
Čísla zapisuj jako čistá čísla (bez mezer, měny, %). Pokud je v nabídce více variant, vyber tu hlavní/doporučenou a do notes napiš, že existují další varianty. Když údaj chybí, dej null.
DŮLEŽITÉ: Pečlivě rozliš částky BEZ DPH a S DPH (s DPH = 1,21× bez DPH) — nikdy nemíchej cenu s DPH se splátkou bez DPH. Pokud je uvedena jen jedna z hodnot, druhou NEdopočítávej, nech null. Splátka = pravidelná měsíční splátka za financování BEZ pojištění (pojištění dej zvlášť). Doba = počet měsíčních splátek. Zůstatková/odkupní hodnota = částka placená na konci; pokud není uvedena (typicky finanční leasing s odkupem za symbolickou cenu), dej 0.`;

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
  // Kontrola věrohodnosti — typické chyby čtení PDF (míchání DPH, špatná doba, splátka s pojištěním).
  const warns = [];
  if (out.price_excl_vat && out.price_incl_vat) { const r = out.price_incl_vat / out.price_excl_vat; if (r < 1.15 || r > 1.27) warns.push('cena s DPH / bez DPH nesedí (poměr ' + r.toFixed(2) + ', čekám 1,21)'); }
  if (out.monthly_excl_vat && out.monthly_incl_vat) { const r = out.monthly_incl_vat / out.monthly_excl_vat; if (r < 1.15 || r > 1.27) warns.push('splátka s DPH / bez DPH nesedí (poměr ' + r.toFixed(2) + ')'); }
  if (out.calc) {
    const o = out.calc.overpay_pct, n = out.months;
    if (o < 3) warns.push('navýšení jen ' + o + ' % — pravděpodobně cena s DPH vs. splátka bez DPH, nebo chybí zůstatek');
    else if (n <= 36 && o > 25) warns.push('navýšení ' + o + ' % na ' + n + ' měs. je neobvykle vysoké — zkontroluj splátku (pojištění?) a DPH');
    else if (n > 36 && o > 40) warns.push('navýšení ' + o + ' % na ' + n + ' měs. je neobvykle vysoké — zkontroluj splátku (pojištění?) a DPH');
    if (n && (n < 12 || n > 96)) warns.push('doba ' + n + ' měsíců je neobvyklá');
  } else warns.push('chybí cena, splátka nebo doba — nabídku nelze použít v kalkulačce');
  out.warnings = warns;
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

// POST /api/leasing/extract-all — vytěžit nabídky napříč všemi společnostmi (bez params; ?force=1 vše)
router.post('/extract-all', async (req, res, next) => {
  try {
    const where = { category: 'nabidka', file_path: { not: null } };
    if (!req.query.force) where.params = { equals: null };
    const docs = await prisma.leasingDocument.findMany({ where, take: 50 });
    const out = [];
    for (const d of docs) {
      try { const params = await extractOfferParams(d); await prisma.leasingDocument.update({ where: { id: d.id }, data: { params } }); out.push({ id: d.id, ok: true }); }
      catch (e) { out.push({ id: d.id, error: e.message }); }
    }
    res.json({ ok: true, processed: out.length, results: out });
  } catch (err) { next(err); }
});

// POST /api/leasing/:id/generate-offer — AI sestaví nabídku pro zadání z podmínek známých z uložených nabídek společnosti.
// Body: { price, akontace_pct, months, vat?, client?, machine? }
router.post('/:id(\\d+)/generate-offer', async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const b = req.body || {};
    const price = Number(b.price) || 0, akPct = Number(b.akontace_pct) || 0, months = Number(b.months) || 60;
    if (!price || !months) return res.status(400).json({ error: 'Zadej cenu a dobu' });
    const company = await prisma.leasingCompany.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ error: 'Společnost nenalezena' });
    const docs = await prisma.leasingDocument.findMany({ where: { leasing_company_id: companyId, category: 'nabidka' }, orderBy: { created_at: 'desc' } });
    const known = docs.filter((d) => d.params).map((d) => Object.assign({ title: d.title, note: d.note }, d.params));
    if (!known.length) return res.status(400).json({ error: 'Tato společnost nemá žádnou vytěženou nabídku — nejdřív nech AI přečíst nabídky.' });

    // Deterministická matematika (stejná jako v kalkulačce): koeficient z nejbližších nabídek, anuitní přepočet doby.
    const ak = price * akPct / 100, financed = price - ak;
    const withCalc = known.filter((p) => p.calc && p.calc.monthly_factor);
    let best = withCalc.slice().sort((a, b2) => Math.abs((a.months || 0) - months) - Math.abs((b2.months || 0) - months));
    const near = best.filter((o) => Math.abs((o.months || 0) - months) <= 6); if (near.length) best = near; else best = best.slice(0, 1);
    const annuity = (r, n) => (r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n)));
    const solveRate = (mf, n) => { if (!mf || !n || mf <= 1 / n) return 0; let lo = 0, hi = 0.1; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (annuity(mid, n) > mf) hi = mid; else lo = mid; } return (lo + hi) / 2; };
    let monthly = null, rate = null, rvPct = 0;
    if (best.length) {
      const mf = best.reduce((s, o) => s + o.calc.monthly_factor, 0) / best.length;
      const refMonths = best[0].months || months;
      rate = solveRate(mf, refMonths);
      monthly = (refMonths !== months) ? financed * annuity(rate, months) : financed * mf;
      rvPct = best.reduce((s, o) => s + ((o.residual_value || 0) / (o.calc.price || 1)), 0) / best.length;
    }
    const residual = price * rvPct;
    const fees = best.length ? Math.round(best.reduce((s, o) => s + (o.fees || 0), 0) / best.length) : 0;
    const insurance = best.length ? Math.round(best.reduce((s, o) => s + (o.insurance_monthly || 0), 0) / best.length) : 0;
    const total = ak + (monthly || 0) * months + residual + fees;
    const calc = { price, akontace_pct: akPct, akontace: Math.round(ak), financed: Math.round(financed), months, monthly: monthly != null ? Math.round(monthly) : null,
      residual: Math.round(residual), fees, insurance_monthly: insurance, total: Math.round(total), overpay_pct: Math.round((total / price - 1) * 1000) / 10,
      rate_pa_pct: rate != null ? Math.round(rate * 12 * 1000) / 10 : null, based_on: best.map((o) => o.title) };

    // AI: sestaví text nabídky + podmínky známé z podkladů (nic nevymýšlí, co v nabídkách není).
    const Anthropic = require('@anthropic-ai/sdk');
    const { messagesCreate } = require('../services/anthropic-retry');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY není nakonfigurovaný' });
    const client = new Anthropic({ apiKey });
    const prompt = `Jsi obchodní specialista na financování strojů (prádlomatů) společnosti Best Series s.r.o. Připrav INDIKATIVNÍ NABÍDKU financování přes leasingovou společnost „${company.name}" pro klienta.

ZADÁNÍ:
- Klient: ${b.client || '(nevyplněno)'}; Předmět: ${b.machine || 'prádlomat'}
- Cena bez DPH: ${price} Kč, akontace ${akPct} % (${Math.round(ak)} Kč), doba ${months} měsíců, financováno ${Math.round(financed)} Kč
- Vypočtené (použij PŘESNĚ tato čísla, nepřepočítávej): měsíční splátka bez DPH ${calc.monthly} Kč, zůstatek ${calc.residual} Kč, poplatky ${fees} Kč, pojištění ${insurance} Kč/měs, celkem zaplaceno ${calc.total} Kč, navýšení ${calc.overpay_pct} %, implicitní úrok ~${calc.rate_pa_pct} % p.a.

ZNÁMÉ PODMÍNKY této společnosti (vytěženo z jejích dřívějších nabídek — JSON):
${JSON.stringify(known.slice(0, 8), null, 0)}

Poznámka o společnosti: ${company.note || '—'}

Vrať POUZE JSON:
{
 "title": string,                 // název nabídky (např. "Indikativní nabídka financování – MINI SK – 3V leasing")
 "summary": string,               // 2–3 věty pro klienta (česky, srozumitelně, bez přehánění)
 "conditions": string[],          // konkrétní podmínky vyplývající z podkladů (typ produktu, co je v ceně, pojištění, poplatky, DPH, odkup, platnost) – jen to, co je v podkladech známé
 "required_docs": string[],       // co bude klient potřebovat doložit, pokud je to z podkladů známé (jinak prázdné pole)
 "assumptions": string[],         // co je odhad / co je třeba potvrdit u leasingovky
 "next_steps": string[]           // 2–4 kroky
}`;
    const resp = await messagesCreate(client, { model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] });
    const txt = (resp.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const m = txt.match(/\{[\s\S]*\}/);
    const ai = m ? JSON.parse(m[0]) : { title: 'Indikativní nabídka financování', summary: '', conditions: [], required_docs: [], assumptions: [], next_steps: [] };
    res.json({ ok: true, company: { id: company.id, name: company.name, contact_name: company.contact_name, phone: company.phone, email: company.email }, input: { client: b.client || null, machine: b.machine || null, vat: !!b.vat }, calc, ai, generated_at: new Date().toISOString() });
  } catch (err) { res.status(400).json({ error: err.message }); }
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
        monthly_factor: p.calc.monthly_factor, overpay_pct: p.calc.overpay_pct, warnings: p.warnings || [], created_at: d.created_at });
    });
    res.json({ companies: Object.values(byCo), total_offers: docs.length });
  } catch (err) { next(err); }
});

module.exports = router;
