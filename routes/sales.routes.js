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
const {
  SALES_LEAD_ROLE_NAME,
  resolveSalesRole,
  buildContactVisibilityFilter,
} = require('./sales.helpers');
const graph = require('../services/ms-graph-client');

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

// ═══════════════════════════════════════════════════════════════════════════
// CRM DATABÁZE LEADŮ (crm_leads) — import ze starého CRM po deduplikaci
// ═══════════════════════════════════════════════════════════════════════════
const CRM_SEGMENTS = ['horky', 'volat', 'nedovolano', 'novy', 'nezajem', 'smlouva', 'ostatni'];

// GET /api/sales/crm-leads/stats — KPI + rozpady (segment, země, zdroj, obchodník)
router.get('/crm-leads/stats', async (req, res, next) => {
  try {
    const [total, contactable, dupAgg, bySeg, byCountry, byOwner] = await Promise.all([
      prisma.crmLead.count(),
      prisma.crmLead.count({ where: { contactable: true } }),
      prisma.crmLead.aggregate({ _sum: { dup_count: true } }),
      prisma.crmLead.groupBy({ by: ['segment'], _count: { _all: true } }),
      prisma.crmLead.groupBy({ by: ['country'], _count: { _all: true } }),
      prisma.crmLead.groupBy({ by: ['owner_name'], _count: { _all: true } }),
    ]);
    const seg = {}; bySeg.forEach((r) => { seg[r.segment || 'ostatni'] = r._count._all; });
    const country = byCountry.map((r) => ({ country: r.country || '—', count: r._count._all })).sort((a, b) => b.count - a.count).slice(0, 15);
    const owner = byOwner.map((r) => ({ owner: r.owner_name || '—', count: r._count._all })).sort((a, b) => b.count - a.count).slice(0, 15);
    res.json({ ok: true, total, contactable, merged_duplicates: (dupAgg._sum.dup_count || 0), segments: seg, by_country: country, by_owner: owner });
  } catch (err) { next(err); }
});

// GET /api/sales/crm-leads — seznam s filtry a stránkováním
//   ?segment=&country=&owner=&q=&contactable=1&page=1&pageSize=50
router.get('/crm-leads', async (req, res, next) => {
  try {
    const q = req.query || {};
    const where = {};
    if (q.segment && CRM_SEGMENTS.indexOf(String(q.segment)) >= 0) where.segment = String(q.segment);
    if (q.country) where.country = String(q.country);
    if (q.owner) where.owner_name = String(q.owner);
    if (q.contactable === '1' || q.contactable === 'true') where.contactable = true;
    if (q.q) {
      const s = String(q.q).trim();
      where.OR = [
        { first_name: { contains: s, mode: 'insensitive' } },
        { last_name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
        { city: { contains: s, mode: 'insensitive' } },
      ];
    }
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(q.pageSize) || 50));
    const segOrder = { horky: 0, volat: 1, nedovolano: 2, novy: 3, nezajem: 4, smlouva: 5, ostatni: 6 };
    const [total, rows] = await Promise.all([
      prisma.crmLead.count({ where }),
      prisma.crmLead.findMany({ where, orderBy: [{ segment: 'asc' }, { dup_count: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ ok: true, total, page, pageSize, pages: Math.ceil(total / pageSize), rows });
  } catch (err) { next(err); }
});

// GET /api/sales/contacts — seznam s filtry (role-aware)
//   - admin / vedoucí obchodu: vidí vše, lze filtrovat ?seller_id=
//   - obchodník: jen kontakty, kde je sám přidělen a ZÁROVEŇ není sdílený
//     (sdílené kontakty vidí pouze vedoucí/admin)
router.get('/contacts', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    const { status, source, potential, assigned_to_id, seller_id, converted, search } = req.query;
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

    // Vedoucí/admin: volitelný filtr "zobraz kontakty, kde je obchodník X"
    if (roleCtx.canManageSales && seller_id) {
      where.assignments = { some: { person_id: parseInt(seller_id, 10) } };
    }

    // Obchodník: viditelnost vlastních (nesdílených) kontaktů
    const visibility = buildContactVisibilityFilter(roleCtx);
    if (visibility) Object.assign(where, visibility);

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
        assignments: {
          select: {
            id: true,
            person_id: true,
            commission_pct: true,
            commission_locked_pct: true,
            commission_locked_at: true,
            person: { select: { id: true, first_name: true, last_name: true } },
          },
        },
        _count: { select: { sales_notes: true, sales_events: true } },
      },
    });

    res.json(contacts);
  } catch (err) { next(err); }
});

// GET /api/sales/contacts/stats — počty podle status / potential (role-aware)
router.get('/contacts/stats', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    const visibility = buildContactVisibilityFilter(roleCtx);
    const baseWhere = visibility || {};

    // Pro role-filtrovaný groupBy musíme použít where
    const byStatus    = await prisma.salesContact.groupBy({ by: ['status'],    where: baseWhere, _count: { _all: true } });
    const byPotential = await prisma.salesContact.groupBy({ by: ['potential'], where: baseWhere, _count: { _all: true } });
    const bySource    = await prisma.salesContact.groupBy({ by: ['source'],    where: baseWhere, _count: { _all: true } });

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

// GET /api/sales/contacts/:id — detail vč. časové osy, událostí a přidělení
router.get('/contacts/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const roleCtx = await resolveSalesRole(req);
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
        assignments: {
          orderBy: { created_at: 'asc' },
          include: {
            person:       { select: { id: true, first_name: true, last_name: true } },
            assigned_by:  { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
    });
    if (!contact) return res.status(404).json({ error: 'Kontakt nenalezen' });

    // Kontrola viditelnosti — obchodník vidí jen vlastní (nesdílené)
    if (!roleCtx.canManageSales) {
      const assignedIds = contact.assignments.map(a => a.person_id);
      const isOnlyMine = assignedIds.length === 1 && assignedIds[0] === roleCtx.viewerPersonId;
      if (!isOnlyMine) {
        return res.status(403).json({ error: 'Nemáte oprávnění k tomuto kontaktu' });
      }
    }

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

// Má daný e-mail firemní M365 schránku? Osobní schránky (icloud, seznam, gmail…) nemají
// kalendář v našem tenantu → Graph by vracel ErrorInvalidUser. Volitelný allowlist přes
// env M365_MAIL_DOMAINS (CSV firemních domén); jinak se vyloučí známí spotřebitelští poskytovatelé.
const CONSUMER_MAIL_DOMAINS = new Set(['icloud.com', 'me.com', 'seznam.cz', 'gmail.com', 'email.cz', 'centrum.cz', 'post.cz', 'volny.cz', 'atlas.cz', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.cz', 'proton.me', 'protonmail.com']);
function _isOrgMailbox(email) {
  const domain = (String(email || '').split('@')[1] || '').toLowerCase();
  if (!domain) return false;
  const allow = String(process.env.M365_MAIL_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length) return allow.indexOf(domain) >= 0;
  return !CONSUMER_MAIL_DOMAINS.has(domain);
}

// Best-effort push SalesEvent do M365/Outlook kalendáře obchodníka (organizer).
// Vrací pole ke uložení: { graph_event_id, graph_calendar_user, graph_sync_error }.
async function _pushEventToGraph(ev) {
  try {
    if (!(graph.isConfigured && graph.isConfigured())) return { graph_sync_error: 'M365 není nakonfigurováno' };
    if (!ev.organizer_id) return { graph_sync_error: 'Událost nemá obchodníka (organizer)' };
    const person = await prisma.person.findUnique({ where: { id: ev.organizer_id }, select: { email: true } });
    const upn = person && person.email;
    if (!upn) return { graph_sync_error: 'Obchodník nemá e-mail (M365 schránku)' };
    // Nefiremní schránka (osobní e-mail) → do M365 nesynchronizujeme; schůzka je jen v HolyOS, bez chyby.
    if (!_isOrgMailbox(upn)) return { graph_sync_error: null, graph_calendar_user: null };
    const payload = { subject: ev.title, body: ev.description || '', start: ev.start_at, end: ev.end_at || ev.start_at, location: ev.location, allDay: ev.all_day, attendees: (ev.attendees ? String(ev.attendees).split(/[,;\s]+/).filter(Boolean) : []) };
    if (ev.graph_event_id) {
      await graph.updateCalendarEvent(upn, ev.graph_event_id, payload);
      return { graph_event_id: ev.graph_event_id, graph_calendar_user: upn, graph_sync_error: null };
    }
    const created = await graph.createCalendarEvent(upn, payload);
    return { graph_event_id: (created && created.id) || null, graph_calendar_user: upn, graph_sync_error: null };
  } catch (e) {
    const msg = String((e && e.message) || e);
    // Uživatel není v M365 tenantu (osobní/neexistující schránka) → benigní, jen HolyOS.
    if (/ErrorInvalidUser|MailboxNotEnabledForRESTAPI|does not exist|is invalid/i.test(msg)) {
      return { graph_sync_error: null, graph_calendar_user: null };
    }
    return { graph_sync_error: msg.slice(0, 500) };
  }
}

// GET /api/sales/colleagues — kolegové pro rychlé pozvání na schůzku (jméno + e-mail).
router.get('/colleagues', async (req, res, next) => {
  try {
    const people = await prisma.person.findMany({
      where: { active: true, email: { not: null } },
      select: { id: true, first_name: true, last_name: true, email: true, role: true },
      orderBy: [{ first_name: 'asc' }],
    });
    // Obchodní role napřed (nejčastěji zvané), pak ostatní.
    const salesRoles = ['Vedoucí obchodu', 'Obchodník'];
    const list = people
      .filter((p) => p.email && p.email.indexOf('@') > 0)
      .map((p) => ({ id: p.id, name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || p.email, first_name: p.first_name || '', email: p.email, _sales: salesRoles.indexOf(p.role) >= 0 ? 0 : 1 }))
      .sort((a, b) => (a._sales - b._sales) || a.name.localeCompare(b.name, 'cs'))
      .slice(0, 40)
      .map(({ _sales, ...rest }) => rest);
    res.json(list);
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
      compounder_lead_id, site_id, attendees,
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
        compounder_lead_id: compounder_lead_id ? parseInt(compounder_lead_id, 10) : null,
        site_id: site_id ? parseInt(site_id, 10) : null,
        attendees: Array.isArray(attendees) ? (attendees.filter(Boolean).join(',') || null) : ((attendees && String(attendees).trim()) || null),
      },
      include: {
        contact:   { select: { id: true, first_name: true, last_name: true, company_name: true } },
        organizer: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    const g = await _pushEventToGraph(created);
    const synced = await prisma.salesEvent.update({
      where: { id: created.id }, data: g,
      include: {
        contact:   { select: { id: true, first_name: true, last_name: true, company_name: true } },
        organizer: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    // POSLEDNÍ DOMLUVA VYHRÁVÁ: nová naplánovaná akce u kontaktu nahrazuje starší otevřené
    // kroky (dosledování/hovor) — aby systém neotravoval jindy, než jsme se domluvili.
    if (created.compounder_lead_id) {
      try {
        await prisma.salesEvent.updateMany({
          where: { compounder_lead_id: created.compounder_lead_id, status: 'planned', id: { not: created.id } },
          data: { status: 'cancelled' },
        });
        await prisma.salesTask.updateMany({
          where: { lead_id: created.compounder_lead_id, status: 'open', kind: { in: ['call', 'followup'] } },
          data: { status: 'skipped', skipped_reason: 'Nahrazeno novou domluvou' },
        });
      } catch (e) { /* supersede best-effort */ }
    }
    res.status(201).json(synced);
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
    if (b.compounder_lead_id !== undefined) data.compounder_lead_id = b.compounder_lead_id ? parseInt(b.compounder_lead_id, 10) : null;
    if (b.site_id !== undefined) data.site_id = b.site_id ? parseInt(b.site_id, 10) : null;
    if (b.attendees !== undefined) data.attendees = Array.isArray(b.attendees) ? (b.attendees.filter(Boolean).join(',') || null) : ((b.attendees && String(b.attendees).trim()) || null);

    let updated = await prisma.salesEvent.update({ where: { id }, data });
    const g = await _pushEventToGraph(updated);
    updated = await prisma.salesEvent.update({ where: { id }, data: g });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/sales/events/:id
router.delete('/events/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ex = await prisma.salesEvent.findUnique({ where: { id }, select: { graph_event_id: true, graph_calendar_user: true } });
    if (ex && ex.graph_event_id && ex.graph_calendar_user) {
      try { await graph.deleteCalendarEvent(ex.graph_calendar_user, ex.graph_event_id); } catch (e) { /* best-effort */ }
    }
    await prisma.salesEvent.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/sales/my-calendar?from&to — kalendář přihlášeného obchodníka:
// HolyOS SalesEvent (organizer = já) sloučené s událostmi z jeho Outlooku (M365).
router.get('/my-calendar', async (req, res, next) => {
  try {
    const meId = req.user.person ? req.user.person.id : null;
    if (!meId) return res.json({ events: [], outlook: [] });
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 86400000);
    const to   = req.query.to   ? new Date(req.query.to)   : new Date(Date.now() + 31 * 86400000);
    const events = await prisma.salesEvent.findMany({
      where: { organizer_id: meId, start_at: { gte: from, lte: to } },
      orderBy: { start_at: 'asc' },
    });
    // Lehký režim (?light=1): jen HolyOS schůzky, bez resyncu a Outlooku (pro odznaky u kontaktů).
    if (req.query.light === '1') return res.json({ events, outlook: [] });
    // Auto-resync: schůzky bez graph_event_id (dřív selhaly / vznikly před povolením) zkus doposlat
    // do M365 — NEBLOKUJÍCÍ (na pozadí), ať se kalendář načte rychle i na mobilu.
    const pending = events.filter((e) => !e.graph_event_id).slice(0, 5);
    if (pending.length) {
      Promise.all(pending.map(async (e) => {
        try { const g = await _pushEventToGraph(e); await prisma.salesEvent.update({ where: { id: e.id }, data: g }); } catch (err) {}
      })).catch(() => {});
    }
    let outlook = []; let outlookError = null; let outlookMailbox = null;
    try {
      const person = await prisma.person.findUnique({ where: { id: meId }, select: { email: true } });
      outlookMailbox = person && person.email ? person.email : null;
      if (!person || !person.email) { outlookError = 'Uživatel nemá v HolyOS e-mail (M365 schránku).'; }
      else if (!(graph.isConfigured && graph.isConfigured())) { outlookError = 'M365 (Graph) není nakonfigurováno.'; }
      else if (!_isOrgMailbox(person.email)) { /* osobní schránka → žádný Outlook, bez chyby */ }
      else {
        // Timeout na M365 — pomalá/nedostupná schránka nesmí zdržet (a shodit) načtení HolyOS událostí.
        const raw = await Promise.race([
          graph.listCalendarView(person.email, from.toISOString(), to.toISOString()),
          new Promise((_, rej) => setTimeout(() => rej(new Error('M365 časový limit (8 s)')), 8000)),
        ]);
        const holyIds = new Set(events.map((e) => e.graph_event_id).filter(Boolean));
        outlook = raw.filter((o) => !holyIds.has(o.id)).map((o) => ({
          id: o.id, source: 'outlook', title: o.subject || '(bez názvu)',
          start_at: (o.start && o.start.dateTime) ? (o.start.dateTime.endsWith('Z') ? o.start.dateTime : o.start.dateTime + 'Z') : null,
          end_at: (o.end && o.end.dateTime) ? (o.end.dateTime.endsWith('Z') ? o.end.dateTime : o.end.dateTime + 'Z') : null,
          all_day: !!o.isAllDay, location: (o.location && o.location.displayName) || null, web_link: o.webLink || null,
          organizer: (o.organizer && o.organizer.emailAddress) ? { name: o.organizer.emailAddress.name || '', address: o.organizer.emailAddress.address || '' } : null,
        }));
      }
    } catch (e) { outlookError = String((e && e.message) || e).slice(0, 300); }
    res.json({ events, outlook, outlookError, outlookMailbox });
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

// ─── Role & přidělení obchodníků (assignments) ───────────────────────────

// GET /api/sales/me — vrací informace o roli aktuálního uživatele
//   { viewerPersonId, isAdmin, isSalesLead, canManageSales }
// Frontend si z toho odvodí, jaké UI prvky zobrazit (filtr Obchodník,
// tlačítko Přidělit, vstup pro %).
router.get('/me', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    res.json(roleCtx);
  } catch (err) { next(err); }
});

// GET /api/sales/sellers — seznam aktivních obchodníků
//   Pouze vedoucí/admin smí volat (jinak nic užitečného nevrátí).
//   Vrací Person aktivní + s rolí "Obchodník" nebo "Vedoucí obchodu".
router.get('/sellers', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    if (!roleCtx.canManageSales) {
      return res.status(403).json({ error: 'Pouze vedoucí obchodu nebo admin' });
    }
    const sellers = await prisma.person.findMany({
      where: {
        active: true,
        role: { name: { in: ['Obchodník', SALES_LEAD_ROLE_NAME] } },
      },
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        role: { select: { id: true, name: true } },
      },
    });
    res.json(sellers);
  } catch (err) { next(err); }
});

// POST /api/sales/contacts/:id/assignments — přidělit obchodníka kontaktu
//   Body: { person_id, commission_pct? }
//   Pouze vedoucí/admin.
router.post('/contacts/:id(\\d+)/assignments', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    if (!roleCtx.canManageSales) {
      return res.status(403).json({ error: 'Pouze vedoucí obchodu nebo admin smí přidělovat' });
    }

    const contactId = parseInt(req.params.id, 10);
    const { person_id, commission_pct } = req.body || {};
    if (!person_id) return res.status(400).json({ error: 'Chybí person_id (obchodník)' });

    const personId = parseInt(person_id, 10);
    const contact = await prisma.salesContact.findUnique({ where: { id: contactId } });
    if (!contact) return res.status(404).json({ error: 'Kontakt nenalezen' });

    const person = await prisma.person.findUnique({ where: { id: personId } });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });

    // Validace %
    let pct = null;
    if (commission_pct !== undefined && commission_pct !== null && commission_pct !== '') {
      pct = Number(commission_pct);
      if (!isFinite(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: 'Provize musí být 0–100 %' });
      }
    }

    const assignment = await prisma.salesContactAssignment.upsert({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
      create: {
        contact_id: contactId,
        person_id: personId,
        commission_pct: pct,
        assigned_by_id: roleCtx.viewerPersonId,
      },
      update: {}, // existující přidělení nepřepisujeme — na to je PUT
      include: {
        person:      { select: { id: true, first_name: true, last_name: true } },
        assigned_by: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    await prisma.salesContactNote.create({
      data: {
        contact_id: contactId,
        kind: 'system',
        content: `Přidělen obchodník: ${person.first_name} ${person.last_name || ''}`.trim()
          + (pct != null ? ` (provize ${pct} %)` : ''),
        author_id: roleCtx.viewerPersonId,
      },
    });

    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// PUT /api/sales/contacts/:contactId/assignments/:personId — změna % provize
//   Body: { commission_pct }
//   Pouze vedoucí/admin. Pokud je už locked, zápis odmítneme (musí se nejdřív unlock).
router.put('/contacts/:contactId(\\d+)/assignments/:personId(\\d+)', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    if (!roleCtx.canManageSales) {
      return res.status(403).json({ error: 'Pouze vedoucí obchodu nebo admin' });
    }
    const contactId = parseInt(req.params.contactId, 10);
    const personId  = parseInt(req.params.personId, 10);
    const { commission_pct } = req.body || {};

    const existing = await prisma.salesContactAssignment.findUnique({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
    });
    if (!existing) return res.status(404).json({ error: 'Přidělení nenalezeno' });
    if (existing.commission_locked_at) {
      return res.status(400).json({
        error: 'Provize je uzamčená (objednávka zaplacena). Pro změnu musí vedoucí nejdříve odemknout.',
      });
    }

    let pct = null;
    if (commission_pct !== undefined && commission_pct !== null && commission_pct !== '') {
      pct = Number(commission_pct);
      if (!isFinite(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: 'Provize musí být 0–100 %' });
      }
    }

    const updated = await prisma.salesContactAssignment.update({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
      data: { commission_pct: pct },
      include: {
        person:      { select: { id: true, first_name: true, last_name: true } },
        assigned_by: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    await prisma.salesContactNote.create({
      data: {
        contact_id: contactId,
        kind: 'system',
        content: `Provize aktualizována: ${pct != null ? pct + ' %' : '—'}`,
        author_id: roleCtx.viewerPersonId,
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/sales/contacts/:contactId/assignments/:personId/lock — uzamknutí %
//   Volá se ve chvíli, kdy je objednávka zaplacena. Aktuální `commission_pct`
//   se zkopíruje do `commission_locked_pct` a další změny defaultu už tento
//   záznam neovlivní.
//   Body (volitelně): { commission_pct } — pokud chce vedoucí lockonout jinou
//   hodnotu než aktuální default.
router.post('/contacts/:contactId(\\d+)/assignments/:personId(\\d+)/lock', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    if (!roleCtx.canManageSales) {
      return res.status(403).json({ error: 'Pouze vedoucí obchodu nebo admin' });
    }
    const contactId = parseInt(req.params.contactId, 10);
    const personId  = parseInt(req.params.personId, 10);
    const existing = await prisma.salesContactAssignment.findUnique({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
    });
    if (!existing) return res.status(404).json({ error: 'Přidělení nenalezeno' });

    let pct = existing.commission_pct;
    if (req.body && req.body.commission_pct !== undefined) {
      pct = Number(req.body.commission_pct);
      if (!isFinite(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: 'Provize musí být 0–100 %' });
      }
    }
    if (pct == null) {
      return res.status(400).json({ error: 'Nelze uzamknout — provize není nastavena' });
    }

    const updated = await prisma.salesContactAssignment.update({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
      data: {
        commission_locked_pct: pct,
        commission_locked_at:  new Date(),
      },
      include: {
        person: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    await prisma.salesContactNote.create({
      data: {
        contact_id: contactId,
        kind: 'system',
        content: `Provize uzamčena (${pct} %) — obchod ukončen / objednávka zaplacena.`,
        author_id: roleCtx.viewerPersonId,
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/sales/contacts/:contactId/assignments/:personId/unlock — odemčení %
//   Audit-only operace. Pouze admin nebo vedoucí obchodu.
router.post('/contacts/:contactId(\\d+)/assignments/:personId(\\d+)/unlock', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    if (!roleCtx.canManageSales) {
      return res.status(403).json({ error: 'Pouze vedoucí obchodu nebo admin' });
    }
    const contactId = parseInt(req.params.contactId, 10);
    const personId  = parseInt(req.params.personId, 10);
    const updated = await prisma.salesContactAssignment.update({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
      data: { commission_locked_pct: null, commission_locked_at: null },
    });
    await prisma.salesContactNote.create({
      data: {
        contact_id: contactId,
        kind: 'system',
        content: 'Provize odemčena pro úpravu.',
        author_id: roleCtx.viewerPersonId,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/sales/contacts/:contactId/assignments/:personId — odebrat přidělení
router.delete('/contacts/:contactId(\\d+)/assignments/:personId(\\d+)', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    if (!roleCtx.canManageSales) {
      return res.status(403).json({ error: 'Pouze vedoucí obchodu nebo admin' });
    }
    const contactId = parseInt(req.params.contactId, 10);
    const personId  = parseInt(req.params.personId, 10);

    const existing = await prisma.salesContactAssignment.findUnique({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
      include: { person: { select: { first_name: true, last_name: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Přidělení nenalezeno' });
    if (existing.commission_locked_at) {
      return res.status(400).json({
        error: 'Přidělení má uzamčenou provizi — nejdřív odemkněte.',
      });
    }

    await prisma.salesContactAssignment.delete({
      where: { contact_id_person_id: { contact_id: contactId, person_id: personId } },
    });

    await prisma.salesContactNote.create({
      data: {
        contact_id: contactId,
        kind: 'system',
        content: `Odebráno přidělení: ${existing.person.first_name} ${existing.person.last_name || ''}`.trim(),
        author_id: roleCtx.viewerPersonId,
      },
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/sales/commissions/summary — souhrn provizí
//   - obchodník: jeho vlastní souhrn (forced filtr na Person.id přihlášeného)
//   - vedoucí/admin: lze předat ?person_id= pro filtr
//   Vrací: { person_id, person_name, items: [{ contact, commission_pct, locked_pct,
//     locked_at, expected_value, est_commission }], totals: { count, expected, est }}
router.get('/commissions/summary', async (req, res, next) => {
  try {
    const roleCtx = await resolveSalesRole(req);
    let targetPersonId = roleCtx.viewerPersonId;
    if (roleCtx.canManageSales && req.query.person_id) {
      targetPersonId = parseInt(req.query.person_id, 10);
    }
    if (!targetPersonId) {
      return res.status(400).json({ error: 'Chybí person_id (a uživatel není svázán s Person)' });
    }

    const assignments = await prisma.salesContactAssignment.findMany({
      where: { person_id: targetPersonId },
      orderBy: { created_at: 'desc' },
      include: {
        contact: {
          select: {
            id: true,
            first_name: true, last_name: true,
            company_name: true,
            status: true,
            expected_value: true,
            converted_company_id: true,
            converted_at: true,
          },
        },
      },
    });

    const person = await prisma.person.findUnique({
      where: { id: targetPersonId },
      select: { id: true, first_name: true, last_name: true },
    });

    let totalExpected = 0;
    let totalEstCommission = 0;
    let totalLockedCommission = 0;
    let wonCount = 0;

    const items = assignments.map(a => {
      const ev = a.contact.expected_value ? Number(a.contact.expected_value) : 0;
      const activePct = a.commission_locked_pct != null
        ? Number(a.commission_locked_pct)
        : (a.commission_pct != null ? Number(a.commission_pct) : null);
      const estCommission = (activePct != null && ev) ? (ev * activePct / 100) : 0;
      const isWon = a.contact.status === 'won' || !!a.contact.converted_company_id;

      totalExpected += ev;
      totalEstCommission += estCommission;
      if (a.commission_locked_pct != null) {
        totalLockedCommission += estCommission;
      }
      if (isWon) wonCount += 1;

      return {
        assignment_id: a.id,
        contact: a.contact,
        commission_pct: a.commission_pct,
        commission_locked_pct: a.commission_locked_pct,
        commission_locked_at:  a.commission_locked_at,
        expected_value: a.contact.expected_value,
        active_pct: activePct,
        est_commission: estCommission,
        is_locked: !!a.commission_locked_at,
        is_won: isWon,
      };
    });

    res.json({
      person,
      items,
      totals: {
        contacts:        items.length,
        won_count:       wonCount,
        expected_value:  totalExpected,
        est_commission:  totalEstCommission,
        locked_commission: totalLockedCommission,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
