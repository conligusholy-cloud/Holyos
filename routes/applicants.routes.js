// =============================================================================
// HolyOS — Uchazeči o práci (job applicants)
// =============================================================================
// CRUD + časová osa komunikace (notes) + konverze na zaměstnance (Person)
// + Meta (Facebook) Lead Ads webhook pro automatický příjem leadů z FB reklamy.
//
// Routy mount-ovaná v app.js pod /api/hr/applicants — webhook záměrně BEZ
// requireAuth (FB volá veřejnou URL s ověřením přes signed payload).

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// ─── Konstanty ───────────────────────────────────────────────────────────
const APPLICANT_STATUSES = ['new', 'contacted', 'interview', 'offer', 'hired', 'rejected'];
const APPLICANT_SOURCES = ['manual', 'facebook_ads', 'referral', 'web', 'csv_import', 'other'];

// ─── META WEBHOOK (BEZ autentizace) ──────────────────────────────────────
// FB Lead Ads pošle GET pro ověření (hub.challenge) a POST s leadgen událostí.

// GET — verifikace tokenu při subscribování webhooku
router.get('/meta-webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.META_LEAD_VERIFY_TOKEN || 'holyos-meta-verify';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

// POST — příjem leadgen události z FB
router.post('/meta-webhook', async (req, res, next) => {
  try {
    // Ověření podpisu (X-Hub-Signature-256) — pokud máme app secret v env
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
        const adId = value.ad_id;
        if (!leadId) continue;

        // Idempotence — pokud už máme lead s tímto ID, přeskoč
        const existing = await prisma.jobApplicant.findUnique({
          where: { meta_lead_id: String(leadId) },
        });
        if (existing) continue;

        // Stáhnout pole leadu z Graph API (vyžaduje Page Access Token)
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
            console.error('Meta Graph fetch error:', e.message);
          }
        }

        const fullName = fields.full_name || fields.name || '';
        const [first, ...rest] = fullName.split(' ');
        const last = rest.join(' ') || null;

        await prisma.jobApplicant.create({
          data: {
            first_name: first || 'Neznámý',
            last_name: last,
            email: fields.email || null,
            phone: fields.phone_number || fields.phone || null,
            position: fields.position || fields.job_title || null,
            source: 'facebook_ads',
            source_detail: adId ? `ad:${adId}` : (formId ? `form:${formId}` : null),
            status: 'new',
            meta_lead_id: String(leadId),
            meta_form_id: formId ? String(formId) : null,
            meta_page_id: pageId ? String(pageId) : null,
            meta_ad_id: adId ? String(adId) : null,
            meta_raw: rawLead,
            applicant_notes: {
              create: {
                kind: 'system',
                content: `Lead přijat z Facebook Lead Ads (lead_id=${leadId})`,
              },
            },
          },
        });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Meta webhook error:', err);
    // FB očekává 200; chybu zaloguj, ale neodmítej znovu-doručení
    res.status(200).send('OK');
  }
});

// ─── od tady všechno za přihlášením ──────────────────────────────────────
router.use(requireAuth);

// GET /api/hr/applicants — seznam s filtry
router.get('/', async (req, res, next) => {
  try {
    const { status, source, search } = req.query;
    const where = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { position: { contains: search, mode: 'insensitive' } },
      ];
    }

    const applicants = await prisma.jobApplicant.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        first_name: true, last_name: true,
        email: true, phone: true, position: true,
        source: true, source_detail: true, status: true,
        notes: true,
        cv_filename: true, cv_mime: true,
        meta_lead_id: true,
        created_at: true, updated_at: true,
        converted_person_id: true, converted_at: true,
        assigned_to: { select: { id: true, first_name: true, last_name: true } },
        _count: { select: { applicant_notes: true } },
      },
    });

    res.json(applicants);
  } catch (err) { next(err); }
});

// GET /api/hr/applicants/stats — počty podle statusu
router.get('/stats', async (req, res, next) => {
  try {
    const rows = await prisma.jobApplicant.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const result = { total: 0 };
    APPLICANT_STATUSES.forEach(s => { result[s] = 0; });
    for (const r of rows) {
      result[r.status] = r._count._all;
      result.total += r._count._all;
    }
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/applicants/:id — detail vč. časové osy
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const applicant = await prisma.jobApplicant.findUnique({
      where: { id },
      include: {
        assigned_to: { select: { id: true, first_name: true, last_name: true } },
        converted_person: { select: { id: true, first_name: true, last_name: true } },
        applicant_notes: {
          orderBy: { created_at: 'desc' },
          include: { author: { select: { id: true, first_name: true, last_name: true } } },
        },
      },
    });
    if (!applicant) return res.status(404).json({ error: 'Uchazeč nenalezen' });
    // CV obsah neposíláme v detailu (může být velký) — má vlastní endpoint
    delete applicant.cv_data;
    res.json(applicant);
  } catch (err) { next(err); }
});

// GET /api/hr/applicants/:id/cv — stažení CV
router.get('/:id(\\d+)/cv', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const a = await prisma.jobApplicant.findUnique({
      where: { id },
      select: { cv_data: true, cv_filename: true, cv_mime: true },
    });
    if (!a || !a.cv_data) return res.status(404).json({ error: 'CV nenahráno' });
    const buf = Buffer.from(a.cv_data, 'base64');
    res.setHeader('Content-Type', a.cv_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.cv_filename || 'cv')}"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// POST /api/hr/applicants — vytvoření
router.post('/', async (req, res, next) => {
  try {
    const {
      first_name, last_name, email, phone, position,
      source = 'manual', source_detail, notes,
      assigned_to_id, status = 'new',
      cv_data, cv_filename, cv_mime,
    } = req.body || {};

    if (!first_name || !first_name.trim()) {
      return res.status(400).json({ error: 'Křestní jméno je povinné' });
    }
    if (!APPLICANT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Neplatný status' });
    }
    if (!APPLICANT_SOURCES.includes(source)) {
      return res.status(400).json({ error: 'Neplatný zdroj' });
    }

    const created = await prisma.jobApplicant.create({
      data: {
        first_name: first_name.trim(),
        last_name: last_name ? last_name.trim() : null,
        email: email || null,
        phone: phone || null,
        position: position || null,
        source, source_detail: source_detail || null,
        status, notes: notes || null,
        assigned_to_id: assigned_to_id ? parseInt(assigned_to_id, 10) : null,
        cv_data: cv_data || null,
        cv_filename: cv_filename || null,
        cv_mime: cv_mime || null,
        applicant_notes: {
          create: {
            kind: 'system',
            content: 'Uchazeč vytvořen',
            author_id: req.user.person ? req.user.person.id : null,
          },
        },
      },
    });

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/hr/applicants/:id — úprava
router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.jobApplicant.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Uchazeč nenalezen' });

    const {
      first_name, last_name, email, phone, position,
      source, source_detail, notes, assigned_to_id, status,
      cv_data, cv_filename, cv_mime,
    } = req.body || {};

    if (status && !APPLICANT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Neplatný status' });
    }
    if (source && !APPLICANT_SOURCES.includes(source)) {
      return res.status(400).json({ error: 'Neplatný zdroj' });
    }

    // Pokud se mění status, zaloguj do timeline
    const data = {};
    if (first_name !== undefined) data.first_name = first_name.trim();
    if (last_name !== undefined) data.last_name = last_name ? last_name.trim() : null;
    if (email !== undefined) data.email = email || null;
    if (phone !== undefined) data.phone = phone || null;
    if (position !== undefined) data.position = position || null;
    if (source !== undefined) data.source = source;
    if (source_detail !== undefined) data.source_detail = source_detail || null;
    if (notes !== undefined) data.notes = notes || null;
    if (assigned_to_id !== undefined) data.assigned_to_id = assigned_to_id ? parseInt(assigned_to_id, 10) : null;
    if (status !== undefined) data.status = status;
    if (cv_data !== undefined) {
      data.cv_data = cv_data || null;
      data.cv_filename = cv_filename || null;
      data.cv_mime = cv_mime || null;
    }

    const statusChanged = status && status !== existing.status;

    const updated = await prisma.jobApplicant.update({
      where: { id }, data,
    });

    if (statusChanged) {
      await prisma.applicantNote.create({
        data: {
          applicant_id: id,
          kind: 'status_change',
          old_status: existing.status,
          new_status: status,
          content: `Status: ${existing.status} → ${status}`,
          author_id: req.user.person ? req.user.person.id : null,
        },
      });
    }

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/hr/applicants/:id
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.jobApplicant.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/hr/applicants/:id/notes — přidání záznamu do časové osy
router.post('/:id(\\d+)/notes', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { kind = 'note', content } = req.body || {};
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Obsah poznámky je povinný' });
    }
    const allowedKinds = ['note', 'call', 'email', 'meeting', 'sms'];
    if (!allowedKinds.includes(kind)) {
      return res.status(400).json({ error: 'Neplatný typ záznamu' });
    }

    const note = await prisma.applicantNote.create({
      data: {
        applicant_id: id,
        kind, content: content.trim(),
        author_id: req.user.person ? req.user.person.id : null,
      },
      include: { author: { select: { id: true, first_name: true, last_name: true } } },
    });
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// DELETE /api/hr/applicants/:applicantId/notes/:noteId
router.delete('/:applicantId(\\d+)/notes/:noteId(\\d+)', async (req, res, next) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    await prisma.applicantNote.delete({ where: { id: noteId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/hr/applicants/:id/convert — převod uchazeče na Person (zaměstnance)
router.post('/:id(\\d+)/convert', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const applicant = await prisma.jobApplicant.findUnique({ where: { id } });
    if (!applicant) return res.status(404).json({ error: 'Uchazeč nenalezen' });
    if (applicant.converted_person_id) {
      return res.status(400).json({ error: 'Uchazeč už byl převeden', person_id: applicant.converted_person_id });
    }

    const {
      hire_date, contract_type, department_id, role_id,
      employee_number, hourly_rate, monthly_salary,
    } = req.body || {};

    const person = await prisma.$transaction(async (tx) => {
      const newPerson = await tx.person.create({
        data: {
          type: 'employee',
          first_name: applicant.first_name,
          last_name: applicant.last_name || '',
          email: applicant.email,
          phone: applicant.phone,
          notes: applicant.notes,
          hire_date: hire_date ? new Date(hire_date) : new Date(),
          contract_type: contract_type || null,
          department_id: department_id ? parseInt(department_id, 10) : null,
          role_id: role_id ? parseInt(role_id, 10) : null,
          employee_number: employee_number || null,
          hourly_rate: hourly_rate ? Number(hourly_rate) : null,
          monthly_salary: monthly_salary ? Number(monthly_salary) : null,
          active: true,
        },
      });

      await tx.jobApplicant.update({
        where: { id },
        data: {
          status: 'hired',
          converted_person_id: newPerson.id,
          converted_at: new Date(),
        },
      });

      await tx.applicantNote.create({
        data: {
          applicant_id: id,
          kind: 'status_change',
          old_status: applicant.status,
          new_status: 'hired',
          content: `Uchazeč přijat — vytvořen zaměstnanec #${newPerson.id} (${newPerson.first_name} ${newPerson.last_name})`,
          author_id: req.user.person ? req.user.person.id : null,
        },
      });

      return newPerson;
    });

    res.status(201).json({ ok: true, person });
  } catch (err) { next(err); }
});

module.exports = router;
