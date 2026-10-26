// HolyOS — Poptávky u dodavatelů (poptávkový list s odkazem)
// Interní API (přihlášení): /api/wh/inquiries/*   — vytvořit, odeslat, seznam, historie cen
// Veřejné API (token):      /api/public/inquiry/*  — dodavatel doplní ceny, lhůty, termín; uloží nebo odešle
const express = require('express');
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { buildShareUrl } = require('../services/share-url');

const router = express.Router();
const publicRouter = express.Router();
router.use(requireAuth);

const OUR_COMPANY = process.env.OUR_COMPANY_NAME || 'Best Series s.r.o.';
const LOCKED = ['answered', 'cancelled', 'converted'];

const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const dateOrNull = (v) => { if (!v) return null; const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00Z') : null; };
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const txt = (v, max) => (v == null ? null : String(v).trim().slice(0, max || 2000) || null);

async function nextInquiryNumber() {
  const year = new Date().getFullYear(); const series = 'POP-' + year;
  for (let k = 0; k < 3; k++) {
    try {
      const row = await prisma.documentCounter.upsert({ where: { series }, create: { series, last_seq: 1 }, update: { last_seq: { increment: 1 } } });
      const n = series + '-' + String(row.last_seq).padStart(4, '0');
      if (!(await prisma.purchaseInquiry.findUnique({ where: { number: n }, select: { id: true } }))) return n;
    } catch (e) { if (k === 2) throw e; }
  }
  return series + '-' + Date.now().toString().slice(-6);
}

// Odesílatel poptávek: firemní schránka přes Microsoft Graph (spolehlivé). Bez `from` by sendMail
// spadl na SMTP fallback (SMTP_USER/SMTP_PASS), který po výměně klíčů vracel 535 Invalid credentials.
function inquiryFrom() {
  return process.env.PURCHASE_MAIL_FROM || process.env.GRAPH_DEFAULT_FROM || process.env.INVOICE_IMAP_USER || undefined;
}
function inquiryFromName(req) {
  const n = req && req.user && (req.user.display_name || req.user.username);
  return (n ? n + ' | ' : '') + OUR_COMPANY;
}

function inquiryLink(token) { return buildShareUrl('/poptavka/' + token); }

function serializeItem(it) {
  return {
    id: it.id, line_order: it.line_order, material_id: it.material_id, name: it.name, code: it.code,
    quantity: Number(it.quantity), unit: it.unit, needed_by: ymd(it.needed_by),
    offered_price: it.offered_price == null ? null : Number(it.offered_price),
    lead_time_days: it.lead_time_days, offered_delivery: ymd(it.offered_delivery),
    min_order_qty: it.min_order_qty == null ? null : Number(it.min_order_qty), supplier_note: it.supplier_note,
  };
}

// ─── Interní API ────────────────────────────────────────────────────────────

// GET /api/wh/inquiries/contacts?company_id= — komu lze poslat poptávku (lidé u firmy s e-mailem + e-mail firmy)
router.get('/contacts', async (req, res, next) => {
  try {
    const cid = parseInt(req.query.company_id, 10);
    if (!cid) return res.status(400).json({ error: 'Chybí company_id' });
    const [company, people, last] = await Promise.all([
      prisma.company.findUnique({ where: { id: cid }, select: { id: true, name: true, email: true, contact_person: true, order_contact_person_id: true } }),
      prisma.person.findMany({ where: { company_id: cid, active: true, email: { not: null } }, select: { id: true, first_name: true, last_name: true, email: true, phone: true }, orderBy: [{ last_name: 'asc' }] }),
      prisma.purchaseInquiry.findFirst({ where: { company_id: cid, contact_email: { not: null } }, orderBy: { id: 'desc' }, select: { contact_email: true, contact_name: true, contact_person_id: true } }),
    ]);
    if (!company) return res.status(404).json({ error: 'Firma nenalezena' });
    const list = people.filter((p) => p.email && p.email.includes('@')).map((p) => ({ person_id: p.id, name: (p.first_name + ' ' + p.last_name).trim(), email: p.email }));
    if (company.email && company.email.includes('@') && !list.some((c) => c.email.toLowerCase() === company.email.toLowerCase())) list.push({ person_id: null, name: company.contact_person || company.name, email: company.email, company: true });
    res.json({ company, contacts: list.map((c) => ({ ...c, is_default: !!c.person_id && c.person_id === company.order_contact_person_id })), default_person_id: company.order_contact_person_id || null, last_used: last || null });
  } catch (err) { next(err); }
});

// POST /api/wh/inquiries/contacts — rychle přidat kontakt k firmě. Body: { company_id, first_name, last_name, email, phone, make_default }
router.post('/contacts', async (req, res, next) => {
  try {
    const b = req.body || {};
    const cid = parseInt(b.company_id, 10);
    const email = String(b.email || '').trim();
    if (!cid) return res.status(400).json({ error: 'Chybí firma.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Zadej platný e-mail.' });
    const company = await prisma.company.findUnique({ where: { id: cid }, select: { id: true, name: true } });
    if (!company) return res.status(404).json({ error: 'Firma nenalezena' });
    const dup = await prisma.person.findFirst({ where: { company_id: cid, email: { equals: email, mode: 'insensitive' } } });
    const full = String(b.name || '').trim();
    const first = txt(b.first_name, 255) || (full ? full.split(/\s+/)[0] : '') || '';
    const last = txt(b.last_name, 255) || (full ? full.split(/\s+/).slice(1).join(' ') : '') || company.name.slice(0, 255);
    const person = dup || await prisma.person.create({ data: { type: 'contact', first_name: first || 'Nákup', last_name: last, email, phone: txt(b.phone, 20), company_id: cid, active: true, notes: 'Kontakt pro objednávky a poptávky' } });
    if (b.make_default !== false) await prisma.company.update({ where: { id: cid }, data: { order_contact_person_id: person.id } });
    logAudit({ action: 'create', entity: 'company_contact', entity_id: person.id, description: `Kontakt ${email} přidán k firmě ${company.name}${b.make_default !== false ? ' (výchozí pro objednávky)' : ''}`, user: req.user }).catch(() => {});
    res.status(201).json({ ok: true, person_id: person.id, existing: !!dup });
  } catch (err) { next(err); }
});

// POST /api/wh/inquiries/contacts/default — nastavit výchozí kontakt firmy. Body: { company_id, person_id | null }
router.post('/contacts/default', async (req, res, next) => {
  try {
    const cid = parseInt(req.body && req.body.company_id, 10);
    const pid = parseInt(req.body && req.body.person_id, 10) || null;
    if (!cid) return res.status(400).json({ error: 'Chybí firma.' });
    if (pid) { const p = await prisma.person.findFirst({ where: { id: pid, company_id: cid }, select: { id: true } }); if (!p) return res.status(400).json({ error: 'Kontakt nepatří k firmě.' }); }
    await prisma.company.update({ where: { id: cid }, data: { order_contact_person_id: pid } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/wh/inquiries/test — testovací e-mail sobě (nic se nevytváří, dodavatel nic nedostane). Body: { items, name, message, required_delivery, to }
router.post('/test', async (req, res, next) => {
  try {
    const b = req.body || {};
    const own = req.user && req.user.person && req.user.person.email;
    const to = String(own || b.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Nemáš v profilu e-mail — zadej ho ve formuláři „Test na e-mail“.' });
    const items = (Array.isArray(b.items) ? b.items : []).filter((it) => it && String(it.name || '').trim());
    const lines = items.map((it) => '• ' + String(it.name).trim() + ' — ' + (num(it.quantity) || 0) + ' ' + (txt(it.unit, 20) || 'ks')).join('\n');
    const name = txt(b.name, 255);
    const body = '*** TESTOVACÍ E-MAIL — dodavateli nic neodešlo ***\n\nDobrý den' + (name ? ', ' + name : '') + ',\n\nprosíme o cenovou nabídku na níže uvedené zboží. Ceny, dodací lhůtu a termín dodání můžete vyplnit přímo v poptávkovém listu přes tlačítko níže.\n\n' + lines + (txt(b.message, 4000) ? '\n\n' + txt(b.message, 4000) : '') + '\n\nDěkujeme,\n' + OUR_COMPANY;
    const { sendMail } = require('../services/email');
    const r = await sendMail({ from: inquiryFrom(), fromName: inquiryFromName(req), to, subject: '[TEST] Poptávka — ' + OUR_COMPANY, preheader: 'Testovací náhled poptávky', body, link: inquiryLink('0'.repeat(48)), linkLabel: 'Otevřít poptávkový list (ukázka)' });
    if (r && r.sent === false) return res.status(502).json({ error: 'E-mail se nepodařilo odeslat: ' + (r.error || r.skipped || 'neznámá chyba') });
    res.json({ ok: true, sent_to: to });
  } catch (err) { next(err); }
});

// GET /api/wh/inquiries/price-history?material_id= — za kolik a kdy se zboží objednávalo / poptávalo
router.get('/price-history', async (req, res, next) => {
  try {
    const mid = parseInt(req.query.material_id, 10);
    if (!mid) return res.status(400).json({ error: 'Chybí material_id' });
    const [orderItems, inqItems] = await Promise.all([
      prisma.orderItem.findMany({
        where: { material_id: mid, unit_price: { gt: 0 }, order: { type: { in: ['purchase', 'cooperation'] }, status: { not: 'cancelled' } } },
        orderBy: { id: 'desc' }, take: 100,
        select: { quantity: true, unit: true, unit_price: true, order: { select: { id: true, order_number: true, created_at: true, currency: true, company: { select: { id: true, name: true } } } } },
      }),
      prisma.purchaseInquiryItem.findMany({
        where: { material_id: mid, inquiry: { status: { in: ['answered', 'converted', 'in_progress'] } } },
        orderBy: { id: 'desc' }, take: 100,
        select: { quantity: true, unit: true, offered_price: true, lead_time_days: true, offered_delivery: true, min_order_qty: true, inquiry: { select: { id: true, number: true, status: true, currency: true, company_id: true, answered_at: true, saved_at: true, sent_at: true } } },
      }),
    ]);
    const cids = [...new Set(inqItems.map((i) => i.inquiry.company_id))];
    const comps = cids.length ? await prisma.company.findMany({ where: { id: { in: cids } }, select: { id: true, name: true } }) : [];
    const cname = Object.fromEntries(comps.map((c) => [c.id, c.name]));
    res.json({
      orders: orderItems.map((o) => ({ date: o.order.created_at, order_id: o.order.id, order_number: o.order.order_number, company: o.order.company && o.order.company.name, unit_price: Number(o.unit_price), currency: o.order.currency, quantity: Number(o.quantity), unit: o.unit })),
      inquiries: inqItems.filter((i) => i.offered_price != null || i.lead_time_days != null).map((i) => ({ date: i.inquiry.answered_at || i.inquiry.saved_at || i.inquiry.sent_at, inquiry_id: i.inquiry.id, number: i.inquiry.number, status: i.inquiry.status, company: cname[i.inquiry.company_id] || null, unit_price: i.offered_price == null ? null : Number(i.offered_price), currency: i.inquiry.currency, quantity: Number(i.quantity), unit: i.unit, lead_time_days: i.lead_time_days, offered_delivery: ymd(i.offered_delivery), min_order_qty: i.min_order_qty == null ? null : Number(i.min_order_qty) })),
    });
  } catch (err) { next(err); }
});

// GET /api/wh/inquiries?company_id=&status= — seznam poptávek
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.company_id) where.company_id = parseInt(req.query.company_id, 10);
    if (req.query.status) where.status = { in: String(req.query.status).split(',') };
    const list = await prisma.purchaseInquiry.findMany({ where, orderBy: { id: 'desc' }, take: 200, include: { items: { orderBy: { line_order: 'asc' } } } });
    const cids = [...new Set(list.map((i) => i.company_id))];
    const comps = cids.length ? await prisma.company.findMany({ where: { id: { in: cids } }, select: { id: true, name: true } }) : [];
    const cname = Object.fromEntries(comps.map((c) => [c.id, c.name]));
    res.json(list.map((i) => ({ ...i, token: undefined, link: inquiryLink(i.token), company_name: cname[i.company_id] || null, required_delivery: ymd(i.required_delivery), items: i.items.map(serializeItem) })));
  } catch (err) { next(err); }
});

// GET /api/wh/inquiries/:id
router.get('/:id', async (req, res, next) => {
  try {
    const inq = await prisma.purchaseInquiry.findUnique({ where: { id: parseInt(req.params.id, 10) }, include: { items: { orderBy: { line_order: 'asc' } } } });
    if (!inq) return res.status(404).json({ error: 'Poptávka nenalezena' });
    const company = await prisma.company.findUnique({ where: { id: inq.company_id }, select: { id: true, name: true } });
    res.json({ ...inq, token: undefined, link: inquiryLink(inq.token), company_name: company && company.name, required_delivery: ymd(inq.required_delivery), items: inq.items.map(serializeItem) });
  } catch (err) { next(err); }
});

// POST /api/wh/inquiries — vytvořit poptávku (koncept) z položek průvodce
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const cid = parseInt(b.company_id, 10);
    if (!cid) return res.status(400).json({ error: 'Vyber dodavatele.' });
    const items = (Array.isArray(b.items) ? b.items : []).filter((it) => it && String(it.name || '').trim() && num(it.quantity) > 0);
    if (!items.length) return res.status(400).json({ error: 'Poptávka nemá žádnou položku.' });
    const mids = items.map((it) => parseInt(it.material_id, 10)).filter(Boolean);
    const mats = mids.length ? await prisma.material.findMany({ where: { id: { in: mids } }, select: { id: true, code: true } }) : [];
    const code = Object.fromEntries(mats.map((m) => [m.id, m.code]));
    const inq = await prisma.purchaseInquiry.create({
      data: {
        number: await nextInquiryNumber(), company_id: cid, token: crypto.randomBytes(24).toString('hex'),
        currency: b.currency === 'EUR' ? 'EUR' : 'CZK', required_delivery: dateOrNull(b.required_delivery), note: txt(b.note, 4000),
        created_by: req.user ? req.user.id : null,
        items: { create: items.map((it, i) => ({ line_order: i + 1, material_id: parseInt(it.material_id, 10) || null, code: code[parseInt(it.material_id, 10)] || txt(it.code, 100), name: String(it.name).trim().slice(0, 255), quantity: num(it.quantity), unit: txt(it.unit, 20) || 'ks', needed_by: dateOrNull(it.needed_by || it.expected_delivery) })) },
      },
      include: { items: true },
    });
    logAudit({ action: 'create', entity: 'purchase_inquiry', entity_id: inq.id, description: `Vytvořena poptávka ${inq.number} (${inq.items.length} položek)`, user: req.user }).catch(() => {});
    res.status(201).json({ ...inq, token: undefined, link: inquiryLink(inq.token), items: inq.items.map(serializeItem) });
  } catch (err) { next(err); }
});

// POST /api/wh/inquiries/:id/send — odeslat odkaz na poptávkový list e-mailem. Body: { email, name, person_id, message }
router.post('/:id/send', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const email = String(b.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Zadej platný e-mail dodavatele.' });
    const inq = await prisma.purchaseInquiry.findUnique({ where: { id }, include: { items: { orderBy: { line_order: 'asc' } } } });
    if (!inq) return res.status(404).json({ error: 'Poptávka nenalezena' });
    if (LOCKED.includes(inq.status)) return res.status(409).json({ error: 'Poptávka je už uzavřená.' });
    const link = inquiryLink(inq.token);
    const fmtD = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ', { timeZone: 'UTC' }) : null);
    const lines = inq.items.map((it) => '• ' + it.name + (it.code ? ' (' + it.code + ')' : '') + ' — ' + Number(it.quantity) + ' ' + it.unit + (it.needed_by ? ', dodat do ' + fmtD(it.needed_by) : '')).join('\n');
    const name = txt(b.name, 255);
    const body = 'Dobrý den' + (name ? ', ' + name : '') + ',\n\n' +
      'prosíme o cenovou nabídku na níže uvedené zboží. Ceny, dodací lhůtu a termín dodání můžete vyplnit přímo v poptávkovém listu přes tlačítko níže — rozpracovanou nabídku si můžete uložit a dokončit později.\n\n' +
      lines + (inq.required_delivery ? '\n\nPožadované dodání: ' + fmtD(inq.required_delivery) : '') +
      (txt(b.message, 4000) || inq.note ? '\n\n' + (txt(b.message, 4000) || inq.note) : '') +
      '\n\nDěkujeme,\n' + ((req.user && (req.user.display_name || req.user.username)) || OUR_COMPANY) + '\n' + OUR_COMPANY;
    const { sendMail } = require('../services/email');
    const replyTo = req.user && req.user.person && req.user.person.email ? req.user.person.email : undefined;
    const r = await sendMail({ from: inquiryFrom(), fromName: inquiryFromName(req), to: email, subject: 'Poptávka ' + inq.number + ' — ' + OUR_COMPANY, preheader: 'Prosíme o cenovou nabídku a dodací lhůtu', body, link, linkLabel: 'Otevřít poptávkový list', replyTo });
    if (r && r.sent === false) return res.status(502).json({ error: 'E-mail se nepodařilo odeslat: ' + (r.error || r.skipped || 'neznámá chyba') });
    const upd = await prisma.purchaseInquiry.update({ where: { id }, data: { status: inq.status === 'draft' ? 'sent' : inq.status, sent_at: new Date(), contact_email: email, contact_name: name, contact_person_id: parseInt(b.person_id, 10) || null, note: txt(b.message, 4000) || inq.note } });
    logAudit({ action: 'update', entity: 'purchase_inquiry', entity_id: id, description: `Poptávka ${inq.number} odeslána na ${email}`, user: req.user }).catch(() => {});
    res.json({ ok: true, status: upd.status, link, sent_to: email });
  } catch (err) { next(err); }
});

// POST /api/wh/inquiries/:id/cancel
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const inq = await prisma.purchaseInquiry.update({ where: { id }, data: { status: 'cancelled' } });
    logAudit({ action: 'update', entity: 'purchase_inquiry', entity_id: id, description: `Poptávka ${inq.number} zrušena`, user: req.user }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/wh/inquiries/:id/converted — z poptávky vznikla objednávka. Body: { order_id }
router.post('/:id/converted', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.purchaseInquiry.update({ where: { id }, data: { status: 'converted', order_id: parseInt(req.body && req.body.order_id, 10) || null } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Veřejné API (dodavatel přes odkaz) ─────────────────────────────────────

async function loadByToken(token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null;
  return prisma.purchaseInquiry.findUnique({ where: { token: String(token) }, include: { items: { orderBy: { line_order: 'asc' } } } });
}

// GET /api/public/inquiry/:token
// Ukázkový poptávkový list pro „Poslat test sobě" (token samé nuly) — nic se neukládá
const DEMO_TOKEN = '0'.repeat(48);
function demoInquiry() {
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  return {
    number: 'POP-UKÁZKA', status: 'sent', locked: false, demo: true, currency: 'CZK', required_delivery: d(14),
    note: 'Toto je UKÁZKA poptávkového listu — takhle ho uvidí dodavatel. Vyplnění si můžete vyzkoušet, nic se neuloží ani neodešle.',
    supplier_note: null, supplier_name: null, supplier: 'Ukázkový dodavatel s.r.o.', buyer: OUR_COMPANY, answered_at: null, saved_at: null,
    items: [
      { id: 1, line_order: 1, name: 'Ukázková položka – profil 100x50x2 mm', code: 'HU0049', quantity: 6, unit: 'm', needed_by: d(14), offered_price: null, lead_time_days: null, offered_delivery: null, min_order_qty: null, supplier_note: null },
      { id: 2, line_order: 2, name: 'Ukázková položka – tyč Ø 20 mm', code: 'HU0057', quantity: 2.5, unit: 'm', needed_by: d(14), offered_price: null, lead_time_days: null, offered_delivery: null, min_order_qty: null, supplier_note: null },
    ],
  };
}

publicRouter.get('/:token', async (req, res, next) => {
  try {
    if (req.params.token === DEMO_TOKEN) return res.json(demoInquiry());
    const inq = await loadByToken(req.params.token);
    if (!inq) return res.status(404).json({ error: 'Poptávka nenalezena' });
    if (inq.status === 'cancelled') return res.status(410).json({ error: 'Tato poptávka byla zrušena.' });
    if (!inq.opened_at) {
      await prisma.purchaseInquiry.update({ where: { id: inq.id }, data: { opened_at: new Date(), status: inq.status === 'sent' ? 'opened' : inq.status } }).catch(() => {});
    }
    const company = await prisma.company.findUnique({ where: { id: inq.company_id }, select: { name: true } });
    res.json({
      number: inq.number, status: inq.status, locked: LOCKED.includes(inq.status), currency: inq.currency,
      required_delivery: ymd(inq.required_delivery), note: inq.note, supplier_note: inq.supplier_note, supplier_name: inq.supplier_name || inq.contact_name,
      supplier: company && company.name, buyer: OUR_COMPANY, answered_at: inq.answered_at, saved_at: inq.saved_at,
      items: inq.items.map((it) => { const s = serializeItem(it); delete s.material_id; return s; }),
    });
  } catch (err) { next(err); }
});

// POST /api/public/inquiry/:token — uložit rozpracované / odeslat. Body: { items:[{id, offered_price, lead_time_days, offered_delivery, min_order_qty, supplier_note}], supplier_note, supplier_name, submit }
publicRouter.post('/:token', express.json({ limit: '200kb' }), async (req, res, next) => {
  try {
    if (req.params.token === DEMO_TOKEN) return res.status(400).json({ error: 'Toto je jen ukázka poptávkového listu — nic se neukládá. Skutečnou poptávku dostane dodavatel s vlastním odkazem.' });
    const inq = await loadByToken(req.params.token);
    if (!inq) return res.status(404).json({ error: 'Poptávka nenalezena' });
    if (LOCKED.includes(inq.status)) return res.status(410).json({ error: inq.status === 'cancelled' ? 'Tato poptávka byla zrušena.' : 'Nabídka už byla odeslána. Pro změnu nás prosím kontaktujte.' });
    const b = req.body || {};
    const submit = b.submit === true;
    const byId = Object.fromEntries(inq.items.map((it) => [it.id, it]));
    const rows = (Array.isArray(b.items) ? b.items : []).filter((r) => r && byId[parseInt(r.id, 10)]);
    if (submit) {
      const missing = inq.items.filter((it) => { const r = rows.find((x) => parseInt(x.id, 10) === it.id); return !r || !(num(r.offered_price) >= 0 && num(r.offered_price) !== null); });
      if (missing.length) return res.status(400).json({ error: 'Doplňte prosím cenu u všech položek (' + missing.map((m) => m.name).join(', ') + '). Pokud položku nedodáváte, uveďte 0 a napište to do poznámky.' });
    }
    await prisma.$transaction(rows.map((r) => {
      const lead = num(r.lead_time_days);
      return prisma.purchaseInquiryItem.update({
        where: { id: parseInt(r.id, 10) },
        data: { offered_price: num(r.offered_price), lead_time_days: lead === null ? null : Math.max(0, Math.round(lead)), offered_delivery: dateOrNull(r.offered_delivery), min_order_qty: num(r.min_order_qty), supplier_note: txt(r.supplier_note, 2000) },
      });
    }));
    const now = new Date();
    await prisma.purchaseInquiry.update({ where: { id: inq.id }, data: { supplier_note: txt(b.supplier_note, 4000), supplier_name: txt(b.supplier_name, 255), saved_at: now, status: submit ? 'answered' : 'in_progress', answered_at: submit ? now : null } });

    if (submit) {
      // Dodací lhůta od hlavního dodavatele → karta zboží (aby průvodce nákupem počítal „objednat do" správně)
      try {
        const mids = inq.items.filter((it) => it.material_id).map((it) => it.material_id);
        const mats = mids.length ? await prisma.material.findMany({ where: { id: { in: mids } }, select: { id: true, supplier_id: true } }) : [];
        for (const m of mats) {
          if (m.supplier_id !== inq.company_id) continue;
          const it = inq.items.find((x) => x.material_id === m.id); const r = rows.find((x) => parseInt(x.id, 10) === it.id);
          const lead = r ? num(r.lead_time_days) : null;
          if (lead !== null && lead >= 0) await prisma.material.update({ where: { id: m.id }, data: { lead_time_days: Math.round(lead) } });
        }
      } catch (e) { console.warn('[inquiry] lhůta do karty zboží:', e.message); }
      // Upozornit toho, kdo poptávku založil (zvonek v HolyOS)
      if (inq.created_by) {
        try {
          const { createNotification } = require('./notifications.routes');
          const company = await prisma.company.findUnique({ where: { id: inq.company_id }, select: { name: true } });
          await createNotification({ userId: inq.created_by, type: 'system', title: '💰 Odpověď na poptávku ' + inq.number, body: (company ? company.name + ' ' : '') + 'doplnil ceny a dodací lhůty.', link: '/modules/nakup-sklad/index.html?inquiry=' + inq.id });
        } catch (e) { console.warn('[inquiry] notifikace:', e.message); }
      }
    }
    res.json({ ok: true, status: submit ? 'answered' : 'in_progress', saved_at: now });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
