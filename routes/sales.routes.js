// =============================================================================
// HolyOS — Modul Obchod (Sales CRM)
// =============================================================================
// CRUD pro potenciální klienty (SalesContact) + časová osa (SalesContactNote)
// + kalendář schůzek (SalesEvent) + webhooky (FB / IG / LinkedIn) + převod na Company.
//
// Mount: /api/sales v app.js.
// Webhooky jsou bez requireAuth (volá je externí služba).

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// ─── Konstanty ───────────────────────────────────────────────────────────
const SALES_STATUSES   = ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost'];
const SALES_SOURCES    = ['manual', 'facebook', 'instagram', 'linkedin', 'web', 'referral', 'csv_import', 'other'];
const SALES_POTENTIALS = ['low', 'medium', 'high', 'hot'];
const NOTE_KINDS       = ['note', 'call', 'email', 'meeting', 'sms', 'system', 'status_change'];
const EVENT_TYPES      = ['meeting', 'call', 'demo', 'followup', 'task'];
const EVENT_STATUSES   = ['planned', 'done', 'cancelled'];

// ─── META WEBHOOK (FB Lead Ads + Instagram) — BEZ autentizace ────────────
// FB/IG sdílí stejný webhook protokol (graph.facebook.com leadgen events).
// Verifikace GET (hub.challenge) + příjem POST.

router.get('/webhook/meta', (req, res) => {
  const VERIFY_TOKEN = process.env.META_SALES_VERIFY_TOKEN || 'holyos-sales-verify';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.status(403).send('Forbidden');
});

router.post('/webhook/meta', async (req, res) => {
  try {
    // Ověření podpisu (pokud máme app secret)
    const appSecret = process.env.META_APP_SECRET;
    if (appSecret) {
      const signature = req.headers['x-hub-signature-256'];
      if (!signature) return res.status(401).json({ error: 'Chybí podpis' });
      const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) return res.status(401).json({ error: 'Neplatný podpis' });
    }

    const entries = req.body.entry || [];
    const PAGE_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'leadgen') continue;
        const value = change.value || {};
        const leadId = value.leadgen_id;
        const formId = value.form_id;
        const pageId = value.page_id;
        const adId   = value.ad_id;
        if (!leadId) continue;

        // Idempotence
        const existing = await prisma.salesContact.findUnique({ where: { meta_lead_id: String(leadId) } });
        if (existing) continue;

        // Stáhnout pole leadu z Graph API
        let fields = {};
        let rawLead = null;
        if (PAGE_TOKEN) {
          try {
            const url = `https://graph.facebook.com/v19.0/${leadId}?access_token=${encodeURIComponent(PAGE_TOKEN)}`;
            const r = await fetch(url);
            if (r.ok) {
              rawLead = await r.json();
              for (const fd of rawLead.field_data || []) {
                fields[fd.name] = Array.isArray(fd.values) ? fd.values[0] : fd.values;
              }
            }
          } catch (e) {
            console.error('[sales] Meta Graph fetch error:', e.message);
          }
        }

        const fullName = fields.full_name || fields.name || '';
        const [first, ...rest] = fullName.split(' ');
        const last = rest.join(' ') || null;

        // Heuristika — Instagram má v rawLead.platform 'ig' (zatím není v API, fallback na FB)
        const sourcePlatform = (rawLead && rawLead.platform === 'ig') ? 'instagram' : 'facebook';

        await prisma.salesContact.create({
          data: {
            first_name: first || 'Neznámý',
            last_name: last,
            email: fields.email || null,
            phone: fields.phone_number || fields.phone || null,
            company_name: fields.company_name || fields.company || null,
            position: fields.position || fields.job_title || null,
            city: fields.city || null,
            source: sourcePlatform,
            source_detail: adId ? `ad:${adId}` : (formId ? `form:${formId}` : null),
            status: 'new',
            potential: 'medium',
            meta_lead_id: String(leadId),
            meta_form_id: formId ? String(formId) : null,
            meta_page_id: pageId ? String(pageId) : null,
            meta_ad_id: adId ? String(adId) : null,
            meta_raw: rawLead,
            sales_notes: {
              create: {
                kind: 'system',
                content: `Lead přijat z ${sourcePlatform === 'instagram' ? 'Instagram' : 'Facebook'} Lead Ads (lead_id=${leadId})`,
              },
            },
          },
        });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[sales] Meta webhook error:', err);
    res.status(200).send('OK'); // FB očekává 200
  }
});

// ─── LINKEDIN WEBHOOK — BEZ autentizace ──────────────────────────────────
// LinkedIn Lead Sync API posílá JSON payload s leadem; minimální shim,
// detailní mapování doplníme po prvním reálném payloadu.
router.post('/webhook/linkedin', async (req, res) => {
  try {
    const SECRET = process.env.LINKEDIN_WEBHOOK_SECRET;
    if (SECRET) {
      const provided = req.headers['x-li-webhook-secret'];
      if (provided !== SECRET) return res.status(401).json({ error: 'Neplatný secret' });
    }

    const body = req.body || {};
    const linkedinId = body.id || body.lead_id || null;
    if (!linkedinId) return res.status(400).json({ error: 'Chybí ID leadu' });

    const existing = await prisma.salesContact.findFirst({ where: { linkedin_id: String(linkedinId) } });
    if (existing) return res.status(200).json({ ok: true, duplicate: true });

    const fields = body.fields || body.lead_fields || {};
    const fullName = fields.full_name || `${fields.first_name || ''} ${fields.last_name || ''}`.trim();
    const [first, ...rest] = fullName.split(' ');

    await prisma.salesContact.create({
      data: {
        first_name: fields.first_name || first || 'Neznámý',
        last_name: fields.last_name || rest.join(' ') || null,
        email: fields.email || null,
        phone: fields.phone || null,
        company_name: fields.company_name || fields.organization || null,
        position: fields.position || fields.job_title || null,
        source: 'linkedin',
        source_detail: body.campaign_id ? `campaign:${body.campaign_id}` : null,
        status: 'new',
        potential: 'medium',
        linkedin_id: String(linkedinId),
        linkedin_url: fields.linkedin_url || body.member_url || null,
        meta_raw: body,
        sales_notes: {
          create: { kind: 'system', content: `Lead přijat z LinkedIn (lead_id=${linkedinId})` },
        },
      },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[sales] LinkedIn webhook error:', err);
    res.status(200).json({ ok: true });
  }
});

// ─── Od tady všechno za přihlášením ──────────────────────────────────────
router.use(requireAuth);

// GET /api/sales/contacts — seznam s filtry
router.get('/contacts', async (req, res, next) => {
  try {
    const { status, source, potential, assigned_to_id, converted, search } = req.query;
    const where = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (potential) where.potential = potential;
    if (assigned_to_id) where.assigned_to_id = parseInt(assigned_to_id, 10);
    if (converted === 'yes') where.converted_company_id = { not: null };
    if (converted === 'no')  where.converted_company_id = null;
    if (search) {
      where.OR = [
        { first_name:   { contains: search, mode: 'insensitive' } },
        { last_name:    { contains: search, mode: 'insensitive' } },
        { email:        { contains: search, mode: 'insensitive' } },
        { phone:        { contains: search } },
        { company_name: { contains: search, mode: 'insensitive' } },
        { city:         { contains: search, mode: 'insensitive' } },
      ];
    }

    const contacts = await prisma.salesContact.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        first_name: true, last_name: true,
        email: true, phone: true,
        company_name: true, position: true, web: true,
        city: true,
        source: true, source_detail: true,
        status: true, potential: true,
        expected_value: true, next_action_at: true,
        notes: true,
        created_at: true, updated_at: true,
        converted_company_id: true, converted_at: true,
        assigned_to: { select: { id: true, first_name: true, last_name: true } },
        converted_company: { select: { id: true, name: true } },
        _count: { select: { sales_notes: true, sales_events: true } },
      },
    });

    res.json(contacts);
  } catch (err) { next(err); }
});

// GET /api/sales/contacts/stats — počty podle status / potential
router.get('/contacts/stats', async (req, res, next) => {
  try {
    const byStatus    = await prisma.salesContact.groupBy({ by: ['status'],    _count: { _all: true } });
    const byPotential = await prisma.salesContact.groupBy({ by: ['potential'], _count: { _all: true } });
    const bySource    = await prisma.salesContact.groupBy({ by: ['source'],    _count: { _all: true } });

    const result = { total: 0, by_status: {}, by_potential: {}, by_source: {} };
    SALES_STATUSES.forEach(s => { result.by_status[s] = 0; });
    SALES_POTENTIALS.forEach(p => { result.by_potential[p] = 0; });
    SALES_SOURCES.forEach(s => { result.by_source[s] = 0; });

    for (const r of byStatus)    { result.by_status[r.status]      = r._count._all; result.total += r._count._all; }
    for (const r of byPotential) { result.by_potential[r.potential] = r._count._all; }
    for (const r of bySource)    { result.by_source[r.source]       = r._count._all; }

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/sales/contacts/:id — detail vč. časové osy a událostí
router.get('/contacts/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const contact = await prisma.salesContact.findUnique({
      where: { id },
      include: {
        assigned_to:       { select: { id: true, first_name: true, last_name: true } },
        converted_company: { select: { id: true, name: true, ico: true } },
        sales_notes: {
          orderBy: { created_at: 'desc' },
          include: { author: { select: { id: true, first_name: true, last_name: true } } },
        },
        sales_events: {
          orderBy: { start_at: 'asc' },
          include: { organizer: { select: { id: true, first_name: true, last_name: true } } },
        },
      },
    });
    if (!contact) return res.status(404).json({ error: 'Kontakt nenalezen' });
    res.json(contact);
  } catch (err) { next(err); }
});

// POST /api/sales/contacts — vytvoření
router.post('/contacts', async (req, res, next) => {
  try {
    const {
      first_name, last_name, email, phone,
      company_name, position, web,
      address, city, zip,
      source = 'manual', source_detail,
      status = 'new', potential = 'medium',
      expected_value, next_action_at,
      notes, assigned_to_id,
    } = req.body || {};

    if (!first_name || !first_name.trim()) {
      return res.status(400).json({ error: 'Jméno je povinné' });
    }
    if (!SALES_STATUSES.includes(status))      return res.status(400).json({ error: 'Neplatný status' });
    if (!SALES_SOURCES.includes(source))       return res.status(400).json({ error: 'Neplatný zdroj' });
    if (!SALES_POTENTIALS.includes(potential)) return res.status(400).json({ error: 'Neplatný potenciál' });

    const created = await prisma.salesContact.create({
      data: {
        first_name: first_name.trim(),
        last_name: last_name ? last_name.trim() : null,
        email: email || null,
        phone: phone || null,
        company_name: company_name || null,
        position: position || null,
        web: web || null,
        address: address || null,
        city: city || null,
        zip: zip || null,
        source, source_detail: source_detail || null,
        status, potential,
        expected_value: expected_value != null && expected_value !== '' ? Number(expected_value) : null,
        next_action_at: next_action_at ? new Date(next_action_at) : null,
        notes: notes || null,
        assigned_to_id: assigned_to_id ? parseInt(assigned_to_id, 10) : null,
        sales_notes: {
          create: {
            kind: 'system',
            content: 'Kontakt vytvořen',
            author_id: req.user.person ? req.user.person.id : null,
          },
        },
      },
    });

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/sales/contacts/:id — úprava
router.put('/contacts/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.salesContact.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Kontakt nenalezen' });

    const b = req.body || {};
    if (b.status    && !SALES_STATUSES.includes(b.status))       return res.status(400).json({ error: 'Neplatný status' });
    if (b.source    && !SALES_SOURCES.includes(b.source))        return res.status(400).json({ error: 'Neplatný zdroj' });
    if (b.potential && !SALES_POTENTIALS.includes(b.potential))  return res.status(400).json({ error: 'Neplatný potenciál' });

    const data = {};
    const setIfDef = (k, v, transform) => { if (v !== undefined) data[k] = transform ? transform(v) : (v === '' ? null : v); };
    setIfDef('first_name',   b.first_name,   v => (v || '').trim() || null);
    setIfDef('last_name',    b.last_name,    v => v ? v.trim() : null);
    setIfDef('email',        b.email);
    setIfDef('phone',        b.phone);
    setIfDef('company_name', b.company_name);
    setIfDef('position',     b.position);
    setIfDef('web',          b.web);
    setIfDef('address',      b.address);
    setIfDef('city',         b.city);
    setIfDef('zip',          b.zip);
    setIfDef('source',       b.source);
    setIfDef('source_detail', b.source_detail);
    setIfDef('status',       b.status);
    setIfDef('potential',    b.potential);
    setIfDef('expected_value', b.expected_value, v => v == null || v === '' ? null : Number(v));
    setIfDef('next_action_at', b.next_action_at, v => v ? new Date(v) : null);
    setIfDef('notes',        b.notes);
    setIfDef('assigned_to_id', b.assigned_to_id, v => v ? parseInt(v, 10) : null);

    const statusChanged = b.status && b.status !== existing.status;

    const updated = await prisma.salesContact.update({ where: { id }, data });

    if (statusChanged) {
      await prisma.salesContactNote.create({
        data: {
          contact_id: id,
          kind: 'status_change',
          old_status: existing.status,
          new_status: b.status,
          content: `Status: ${existing.status} → ${b.status}`,
          author_id: req.user.person ? req.user.person.id : null,
        },
      });
    }

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/sales/contacts/:id
router.delete('/contacts/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.salesContact.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Časová osa (notes) ──────────────────────────────────────────────────

// POST /api/sales/contacts/:id/notes
router.post('/contacts/:id(\\d+)/notes', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { kind = 'note', content } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: 'Obsah poznámky je povinný' });
    if (!NOTE_KINDS.includes(kind))  return res.status(400).json({ error: 'Neplatný typ záznamu' });

    const note = await prisma.salesContactNote.create({
      data: {
        contact_id: id,
        kind, content: content.trim(),
        author_id: req.user.person ? req.user.person.id : null,
      },
      include: { author: { select: { id: true, first_name: true, last_name: true } } },
    });
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// DELETE /api/sales/contacts/:contactId/notes/:noteId
router.delete('/contacts/:contactId(\\d+)/notes/:noteId(\\d+)', async (req, res, next) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    await prisma.salesContactNote.delete({ where: { id: noteId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Kalendář (events) ────────────────────────────────────────────────────

// GET /api/sales/events — pro kalendářový pohled (filtr od/do, contact_id)
router.get('/events', async (req, res, next) => {
  try {
    const { from, to, contact_id, status } = req.query;
    const where = {};
    if (contact_id) where.contact_id = parseInt(contact_id, 10);
    if (status)     where.status = status;
    if (from || to) {
      where.start_at = {};
      if (from) where.start_at.gte = new Date(from);
      if (to)   where.start_at.lte = new Date(to);
    }

    const events = await prisma.salesEvent.findMany({
      where,
      orderBy: { start_at: 'asc' },
      include: {
        contact:   { select: { id: true, first_name: true, last_name: true, company_name: true } },
        organizer: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    res.json(events);
  } catch (err) { next(err); }
});

// POST /api/sales/events
router.post('/events', async (req, res, next) => {
  try {
    const {
      contact_id, title, description, event_type = 'meeting',
      location, start_at, end_at, all_day = false,
      status = 'planned', reminder_min,
    } = req.body || {};

    if (!title || !title.trim()) return res.status(400).json({ error: 'Název je povinný' });
    if (!start_at)               return res.status(400).json({ error: 'Začátek je povinný' });
    if (!EVENT_TYPES.includes(event_type))      return res.status(400).json({ error: 'Neplatný typ' });
    if (!EVENT_STATUSES.includes(status))       return res.status(400).json({ error: 'Neplatný status' });

    const created = await prisma.salesEvent.create({
      data: {
        contact_id: contact_id ? parseInt(contact_id, 10) : null,
        organizer_id: req.user.person ? req.user.person.id : null,
        title: title.trim(),
        description: description || null,
        event_type,
        location: location || null,
        start_at: new Date(start_at),
        end_at: end_at ? new Date(end_at) : null,
        all_day: !!all_day,
        status,
        reminder_min: reminder_min != null && reminder_min !== '' ? parseInt(reminder_min, 10) : null,
      },
      include: {
        contact:   { select: { id: true, first_name: true, last_name: true, company_name: true } },
        organizer: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/sales/events/:id
router.put('/events/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.salesEvent.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Událost nenalezena' });

    const b = req.body || {};
    if (b.event_type && !EVENT_TYPES.includes(b.event_type)) return res.status(400).json({ error: 'Neplatný typ' });
    if (b.status     && !EVENT_STATUSES.includes(b.status))  return res.status(400).json({ error: 'Neplatný status' });

    const data = {};
    if (b.contact_id !== undefined)  data.contact_id  = b.contact_id ? parseInt(b.contact_id, 10) : null;
    if (b.title !== undefined)       data.title       = (b.title || '').trim();
    if (b.description !== undefined) data.description = b.description || null;
    if (b.event_type !== undefined)  data.event_type  = b.event_type;
    if (b.location !== undefined)    data.location    = b.location || null;
    if (b.start_at !== undefined)    data.start_at    = b.start_at ? new Date(b.start_at) : null;
    if (b.end_at !== undefined)      data.end_at      = b.end_at ? new Date(b.end_at) : null;
    if (b.all_day !== undefined)     data.all_day     = !!b.all_day;
    if (b.status !== undefined)      data.status      = b.status;
    if (b.reminder_min !== undefined) data.reminder_min = b.reminder_min != null && b.reminder_min !== '' ? parseInt(b.reminder_min, 10) : null;

    const updated = await prisma.salesEvent.update({ where: { id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/sales/events/:id
router.delete('/events/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.salesEvent.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Převod kontaktu na Firmu (Company) ──────────────────────────────────
// Po vyhraném obchodu obchodník klikne "Převést na firmu". Vytvoří se záznam
// v Company (type='customer'), kontakt dostane converted_company_id + status='won'.
// Odtud už standardní vytváření Order.

router.post('/contacts/:id(\\d+)/convert-to-company', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const contact = await prisma.salesContact.findUnique({ where: { id } });
    if (!contact) return res.status(404).json({ error: 'Kontakt nenalezen' });
    if (contact.converted_company_id) {
      return res.status(400).json({
        error: 'Kontakt už byl převeden',
        company_id: contact.converted_company_id,
      });
    }

    const {
      name, ico, dic,
      address, city, zip, country,
      branch_address, branch_city, branch_zip,
      type = 'customer',
      contact_person, email, phone, web,
      bank_account, payment_terms_days, notes,
    } = req.body || {};

    const companyName = (name || contact.company_name || `${contact.first_name} ${contact.last_name || ''}`).trim();
    if (!companyName) return res.status(400).json({ error: 'Název firmy je povinný' });

    const result = await prisma.$transaction(async (tx) => {
      const newCompany = await tx.company.create({
        data: {
          name: companyName,
          ico: ico || null,
          dic: dic || null,
          address: address || contact.address || null,
          city: city || contact.city || null,
          zip: zip || contact.zip || null,
          country: country || 'CZ',
          branch_address: branch_address || null,
          branch_city: branch_city || null,
          branch_zip: branch_zip || null,
          type,
          contact_person: contact_person || `${contact.first_name} ${contact.last_name || ''}`.trim(),
          email: email || contact.email || null,
          phone: phone || contact.phone || null,
          web: web || contact.web || null,
          bank_account: bank_account || null,
          payment_terms_days: payment_terms_days != null ? parseInt(payment_terms_days, 10) : 14,
          notes: notes || contact.notes || null,
          active: true,
        },
      });

      await tx.salesContact.update({
        where: { id },
        data: {
          status: 'won',
          converted_company_id: newCompany.id,
          converted_at: new Date(),
        },
      });

      await tx.salesContactNote.create({
        data: {
          contact_id: id,
          kind: 'status_change',
          old_status: contact.status,
          new_status: 'won',
          content: `Kontakt převeden na firmu #${newCompany.id} (${newCompany.name})`,
          author_id: req.user.person ? req.user.person.id : null,
        },
      });

      return newCompany;
    });

    res.status(201).json({ ok: true, company: result });
  } catch (err) { next(err); }
});

module.exports = router;
