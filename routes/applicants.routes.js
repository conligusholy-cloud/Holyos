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
    console.log('[meta-webhook] POST received', {
      headers: { signature: req.headers['x-hub-signature-256'], ua: req.headers['user-agent'] },
      body_preview: JSON.stringify(req.body).slice(0, 500),
    });
    // Ověření podpisu (X-Hub-Signature-256) — pokud máme app secret v env
    const appSecret = process.env.META_APP_SECRET;
    if (appSecret) {
      const signature = req.headers['x-hub-signature-256'];
      if (!signature) {
        console.warn('[meta-webhook] Missing signature header — request rejected');
        return res.status(401).json({ error: 'Chybí podpis' });
      }
      const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        console.warn('[meta-webhook] Signature mismatch', { received: signature, expected });
        return res.status(401).json({ error: 'Neplatný podpis' });
      }
      console.log('[meta-webhook] Signature OK');
    } else {
      console.log('[meta-webhook] META_APP_SECRET not set — skipping signature check');
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

// ─── MAKE.COM WEBHOOK (BEZ autentizace pro requireAuth, ALE s API key) ───
// Make.com FB Lead Ads modul stáhne lead z FB a pošle HTTP POST na náš endpoint.
// Ověření: Authorization header musí mít Bearer token shodný s ENV MAKE_WEBHOOK_API_KEY.
//
// Očekávaný payload (přímo z Make HTTP modulu, mapování polí z FB Lead Ads):
// {
//   "first_name": "Jan", "last_name": "Novák",       // nebo "full_name": "Jan Novák"
//   "email": "jan@example.com",
//   "phone": "+420...",                              // nebo "phone_number"
//   "position": "operátor",                          // volitelné
//   "lead_id": "12345",                              // ID leadu z FB (idempotence)
//   "form_id": "...", "page_id": "...", "ad_id": "...", // volitelné metadata
//   "raw": { ... }                                   // celý lead JSON (volitelné)
// }
router.post('/make-webhook', async (req, res, next) => {
  try {
    // Ověření API klíče
    const apiKey = process.env.MAKE_WEBHOOK_API_KEY;
    if (!apiKey) {
      console.warn('[make-webhook] MAKE_WEBHOOK_API_KEY není nastaven v env — odmítám');
      return res.status(503).json({ error: 'Webhook není nakonfigurován' });
    }
    const authHeader = req.headers.authorization || '';
    // Make.com a podobné nástroje občas posílají Authorization bez prefixu „Bearer".
    // Akceptujeme: „Bearer <key>", samotný „<key>", x-api-key, nebo ?api_key=
    const provided = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (authHeader || req.query.api_key || req.headers['x-api-key'] || '');
    if (provided !== apiKey) {
      console.warn('[make-webhook] Neplatný API key', { providedPrefix: provided.slice(0, 8) });
      return res.status(401).json({ error: 'Neplatný API klíč' });
    }

    const body = req.body || {};
    console.log('[make-webhook] Přijat lead', { preview: JSON.stringify(body).slice(0, 500) });

    // Mapování polí — Make může poslat různé varianty
    let firstName = body.first_name || body.firstName || '';
    let lastName = body.last_name || body.lastName || '';
    if (!firstName && body.full_name) {
      const parts = String(body.full_name).trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
    if (!firstName && body.name) {
      const parts = String(body.name).trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
    if (!firstName) firstName = 'Neznámý';

    const email = body.email || null;
    const phone = body.phone || body.phone_number || body.telefon || null;
    const position = body.position || body.job_title || body.pozice || null;
    const leadId = body.lead_id || body.leadgen_id || body.id || null;
    const formId = body.form_id || null;
    const pageId = body.page_id || null;
    const adId = body.ad_id || null;

    // Idempotence — pokud Make poslal stejný lead znovu, neulož duplikát
    if (leadId) {
      const existing = await prisma.jobApplicant.findUnique({
        where: { meta_lead_id: String(leadId) },
      });
      if (existing) {
        console.log('[make-webhook] Lead už existuje, ignoruji', { leadId, applicantId: existing.id });
        return res.json({ ok: true, applicant_id: existing.id, duplicate: true });
      }
    }

    const created = await prisma.jobApplicant.create({
      data: {
        first_name: firstName,
        last_name: lastName || null,
        email,
        phone,
        position,
        source: 'facebook_ads',
        source_detail: adId ? `ad:${adId}` : (formId ? `form:${formId}` : 'via Make.com'),
        status: 'new',
        meta_lead_id: leadId ? String(leadId) : null,
        meta_form_id: formId ? String(formId) : null,
        meta_page_id: pageId ? String(pageId) : null,
        meta_ad_id: adId ? String(adId) : null,
        meta_raw: body.raw || body,
        applicant_notes: {
          create: {
            kind: 'system',
            content: leadId
              ? `Lead přijat z Facebook Lead Ads přes Make.com (lead_id=${leadId})`
              : 'Lead přijat z Facebook Lead Ads přes Make.com',
          },
        },
      },
    });

    console.log('[make-webhook] Vytvořen applicant', { id: created.id, name: `${firstName} ${lastName}`.trim() });
    res.status(201).json({ ok: true, applicant_id: created.id });
  } catch (err) {
    console.error('[make-webhook] Chyba:', err);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// ─── od tady všechno za přihlášením ──────────────────────────────────────
router.use(requireAuth);

// POST /api/hr/applicants/import-csv — hromadný import CSV z FB Lead Center
// Očekávaný formát (česky export):
//   Vytvořeno,Jméno,E-mail,Zdroj,Formulář,Kanál,Fáze,Vlastník,Štítky,Telefon,...
//   05/13/2026 1:47am,Josef Hauk,haukjosef1@gmail.com,Placeno,Nábor -nábor - platny,...,+420604373206,,
//
// Body: { csv: "<celý obsah CSV souboru jako string>" }
// Vrací: { ok, imported, skipped, errors }
router.post('/import-csv', async (req, res, next) => {
  try {
    const csv = (req.body && req.body.csv) || '';
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'Chybí CSV obsah v poli "csv"' });
    }

    // Naivní CSV parser — bere v potaz uvozovky a oddělovač čárkou
    function parseCsvLine(line) {
      const out = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { cur += ch; }
        } else {
          if (ch === ',') { out.push(cur); cur = ''; }
          else if (ch === '"' && cur === '') { inQuotes = true; }
          else { cur += ch; }
        }
      }
      out.push(cur);
      return out.map(s => s.trim());
    }

    const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV neobsahuje žádná data (jen hlavička nebo prázdné)' });
    }

    // Hlavička — normalizovat (lower, bez diakritiky) pro mapování
    function norm(s) {
      return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    const header = parseCsvLine(lines[0]).map(norm);
    const idx = {
      created:  header.indexOf('vytvoreno'),
      name:     header.indexOf('jmeno'),
      email:    header.indexOf('e-mail'),
      source:   header.indexOf('zdroj'),
      form:     header.indexOf('formular'),
      phone:    header.indexOf('telefon'),
    };
    // E-mail někdy uveden jako "email"
    if (idx.email === -1) idx.email = header.indexOf('email');

    if (idx.name === -1 || idx.email === -1) {
      return res.status(400).json({
        error: 'CSV neobsahuje povinné sloupce Jméno / E-mail',
        header,
      });
    }

    // Parser data 05/13/2026 1:47am → Date
    // FB Lead Center exportuje časy v lokálním pražském čase, takže
    // interpretujeme jako Europe/Prague a převedeme na UTC pro uložení.
    function parseDate(s) {
      if (!s) return null;
      const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
      if (!m) return null;
      const mm = parseInt(m[1], 10);
      const dd = parseInt(m[2], 10);
      const yyyy = parseInt(m[3], 10);
      let hh = parseInt(m[4], 10);
      const mi = parseInt(m[5], 10);
      const ap = (m[6] || '').toLowerCase();
      if (ap === 'pm' && hh < 12) hh += 12;
      if (ap === 'am' && hh === 12) hh = 0;
      // Heuristika DST: duben–říjen = CEST (+02:00), zbytek = CET (+01:00).
      // Drobné nepřesnosti kolem přechodu DST nás nezajímají, jde o lead timestamps.
      const isCEST = mm >= 4 && mm <= 10;
      const offsetHours = isCEST ? 2 : 1;
      // Naivní Praha → UTC: odečteme offset.
      const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh - offsetHours, mi));
      return isNaN(d.getTime()) ? null : d;
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const fullName = (idx.name >= 0 ? row[idx.name] : '') || '';
      const email = (idx.email >= 0 ? row[idx.email] : '') || '';
      const phone = (idx.phone >= 0 ? row[idx.phone] : '') || '';
      const form = (idx.form >= 0 ? row[idx.form] : '') || '';
      const created = (idx.created >= 0 ? row[idx.created] : '') || '';

      if (!fullName && !email) {
        skipped++; continue;
      }
      // Pomineme zjevné dummy testovací leady
      if (/^<\s*test/i.test(fullName) || /dummy data/i.test(fullName)) {
        skipped++; continue;
      }

      const parts = fullName.trim().split(/\s+/);
      const firstName = parts[0] || 'Neznámý';
      const lastName = parts.slice(1).join(' ') || null;

      // Idempotence: pokud už existuje uchazeč se stejným email nebo telefon,
      // přeskočíme (nepřepisujeme).
      const dupWhere = [];
      if (email) dupWhere.push({ email: { equals: email, mode: 'insensitive' } });
      if (phone) dupWhere.push({ phone });
      if (dupWhere.length > 0) {
        const existing = await prisma.jobApplicant.findFirst({ where: { OR: dupWhere } });
        if (existing) { skipped++; continue; }
      }

      try {
        const createdAt = parseDate(created);
        await prisma.jobApplicant.create({
          data: {
            first_name: firstName,
            last_name: lastName,
            email: email || null,
            phone: phone || null,
            source: 'facebook_ads',
            source_detail: form ? `csv:${form}` : 'csv:lead-center',
            status: 'new',
            ...(createdAt ? { created_at: createdAt } : {}),
            applicant_notes: {
              create: {
                kind: 'system',
                content: `Importováno z FB Lead Center CSV (formulář: ${form || 'neznámý'}, vytvořeno: ${created || '—'})`,
                author_id: req.user.person ? req.user.person.id : null,
              },
            },
          },
        });
        imported++;
      } catch (e) {
        errors.push({ row: i + 1, name: fullName, error: e.message });
      }
    }

    res.json({ ok: true, imported, skipped, errors, total: lines.length - 1 });
  } catch (err) { next(err); }
});

// DELETE /api/hr/applicants/bulk-csv — smaže všechny uchazeče importované z CSV
// (source_detail začíná "csv:"). Pomocník pro reimport po opravě parseru.
router.delete('/bulk-csv', async (req, res, next) => {
  try {
    const result = await prisma.jobApplicant.deleteMany({
      where: { source_detail: { startsWith: 'csv:' } },
    });
    res.json({ ok: true, deleted: result.count });
  } catch (err) { next(err); }
});

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
