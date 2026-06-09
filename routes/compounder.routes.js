// =============================================================================
// HolyOS — Compounder (brandový web compounder.world) routes
// Veřejné API pro registraci leadů z webu + příjem analytiky a push reakcí.
// Mountováno pod /api/compounder.
//
// POZOR: /register, /track a /push-reaction jsou VEŘEJNÉ (bez auth) — volá je
// anonymní návštěvník webu. Admin endpointy (/leads) vyžadují requireAuth.
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('./notifications.routes');
const { sendMail } = require('../services/email');
const crypto = require('crypto');

// ─── Pomocné ─────────────────────────────────────────────────────────────

function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (xff || req.ip || '').slice(0, 64) || null;
}

// ─── VEŘEJNÉ: registrace leadu ─────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255),
  role: z.enum(['compounder', 'distributor']).default('compounder'),
  lang: z.string().trim().max(10).optional().nullable(),
  ref: z.string().trim().max(500).optional().nullable(),
});

// POST /api/compounder/register
router.post('/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    }
    const d = parsed.data;
    const lead = await prisma.compounderLead.create({
      data: {
        name: d.name,
        email: d.email,
        role: d.role,
        lang: d.lang || null,
        ref: d.ref || null,
        source: 'web',
        ip: clientIp(req),
        user_agent: (req.headers['user-agent'] || '').slice(0, 1000) || null,
      },
      select: { id: true, role: true, created_at: true },
    });
    console.log(`[compounder] Nový lead #${lead.id} (${d.role}): ${d.email}`);
    const portalUrl = `${portalBase()}/portal?t=${makePortalToken(lead.id)}`;
    // Notifikace kompetentní osobě (in-app zvonek) — fire-and-forget, ať chyba neshodí registraci.
    notifyNewLead(lead.id, d).catch((e) => console.error('[compounder] notifikace selhala:', e.message));
    // Magic-link e-mail do Portalu — fire-and-forget.
    sendPortalInvite(d, portalUrl).catch((e) => console.error('[compounder] e-mail Portalu selhal:', e.message));
    return res.status(201).json({ ok: true, id: lead.id, portalUrl });
  } catch (err) {
    next(err);
  }
});

// ─── VEŘEJNÉ: analytika chování ─────────────────────────────────────────────
// Frontend posílá beacon s eventy (page_view, section_view, cta_click, portal_view…).
// register_success nese v props lead_id → spojení session ↔ lead. Nikdy nesmí shodit web.
router.post('/track', async (req, res) => {
  try {
    const b = req.body || {};
    if (b && b.event && b.sid) {
      await prisma.compounderEvent.create({
        data: {
          sid: String(b.sid).slice(0, 64),
          event: String(b.event).slice(0, 60),
          props: (b.props && typeof b.props === 'object') ? b.props : undefined,
          path: b.path ? String(b.path).slice(0, 300) : null,
          lang: b.lang ? String(b.lang).slice(0, 10) : null,
          ua: req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 1000) : null,
          ip: clientIp(req),
        },
      });
    }
  } catch (e) {
    // analytika je best-effort
  }
  res.status(204).end();
});

// ─── VEŘEJNÉ: reakce na push notifikaci (stub) ──────────────────────────────
// Service worker hlásí open/dismiss/akci na notifikaci.
// TODO (další fáze): párovat s odeslanou notifikací a měřit reakci.
router.post('/push-reaction', (req, res) => {
  res.status(204).end();
});

// ─── VEŘEJNÉ: Compounder Portal — validace magic-link tokenu ─────────────────
// GET /api/compounder/portal/session?t=TOKEN
// Token je HMAC-podepsaný (lead id + podpis), bez DB sloupce. Ověří se serverem.
router.get('/portal/session', async (req, res, next) => {
  try {
    const id = verifyPortalToken(String(req.query.t || ''));
    if (!id) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    const lead = await prisma.compounderLead.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, lang: true },
    });
    if (!lead) return res.status(404).json({ ok: false, error: 'Registrace nenalezena.' });
    return res.json({ ok: true, id: lead.id, name: lead.name, role: lead.role, lang: lead.lang });
  } catch (err) {
    next(err);
  }
});

// ─── ADMIN: výpis leadů (vyžaduje přihlášení) ───────────────────────────────

// GET /api/compounder/leads?status=new&role=compounder&search=...
router.get('/leads', requireAuth, async (req, res, next) => {
  try {
    const { status, role, search } = req.query;
    const where = {};
    if (status) where.status = String(status);
    if (role) where.role = String(role);
    if (search) {
      const q = String(search);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    const leads = await prisma.compounderLead.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 500,
    });
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/compounder/leads/:id — změna stavu / poznámky
const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'rejected']).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

router.patch('/leads/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const lead = await prisma.compounderLead.update({ where: { id }, data: parsed.data });
    res.json(lead);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Lead nenalezen' });
    next(err);
  }
});

// ─── ADMIN: cesta konkrétního leadu (per-lead analytika) ────────────────────
// GET /api/compounder/leads/:id/activity — eventy svázané s leadem přes sid
// (z register_success) NEBO přímo otagované props.lead_id (portal).
router.get('/leads/:id/activity', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const reg = await prisma.compounderEvent.findFirst({
      where: { event: 'register_success', props: { path: ['lead_id'], equals: id } },
      orderBy: { created_at: 'asc' },
      select: { sid: true },
    });
    const or = [{ props: { path: ['lead_id'], equals: id } }];
    if (reg && reg.sid) or.push({ sid: reg.sid });
    const events = await prisma.compounderEvent.findMany({
      where: { OR: or },
      orderBy: { created_at: 'asc' },
      take: 500,
    });
    const sections = {};
    let portalOpened = false;
    let totalMs = 0;
    events.forEach((e) => {
      const p = e.props || {};
      if (e.event === 'section_view' && p.section) sections[p.section] = (sections[p.section] || 0) + 1;
      if (e.event === 'portal_view') portalOpened = true;
      if (e.event === 'page_leave' && p.ms) totalMs += Number(p.ms) || 0;
    });
    res.json({
      count: events.length,
      first: events[0] ? events[0].created_at : null,
      last: events.length ? events[events.length - 1].created_at : null,
      portalOpened,
      totalMs,
      sections,
      events: events.map((e) => ({ event: e.event, props: e.props, path: e.path, at: e.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/compounder/analytics/summary?days=30 — souhrnné metriky webu
router.get('/analytics/summary', requireAuth, async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const [events, sessions, registrations, secEvents] = await Promise.all([
      prisma.compounderEvent.count({ where: { created_at: { gte: since } } }),
      prisma.compounderEvent.findMany({ where: { created_at: { gte: since } }, select: { sid: true }, distinct: ['sid'] }),
      prisma.compounderEvent.count({ where: { created_at: { gte: since }, event: 'register_success' } }),
      prisma.compounderEvent.findMany({ where: { created_at: { gte: since }, event: 'section_view' }, select: { props: true }, take: 5000 }),
    ]);
    const sessionCount = sessions.length;
    const sec = {};
    secEvents.forEach((e) => { const s = e.props && e.props.section; if (s) sec[s] = (sec[s] || 0) + 1; });
    const topSections = Object.keys(sec).map((k) => ({ section: k, count: sec[k] })).sort((a, b) => b.count - a.count).slice(0, 8);
    res.json({
      days,
      sessions: sessionCount,
      events,
      registrations,
      conversionPct: sessionCount ? Math.round((registrations / sessionCount) * 1000) / 10 : 0,
      topSections,
    });
  } catch (err) {
    next(err);
  }
});

// Notifikace na nový lead. Cíl = env COMPOUNDER_NOTIFY_USER_ID (konkrétní kompetentní
// osoba), jinak fallback na všechny super-adminy (ať Tomáš dostane upozornění i bez configu).
// Vytvoří in-app notifikaci (zvonek + SSE realtime); chyba se jen zaloguje.
async function notifyNewLead(leadId, d) {
  let userIds = [];
  const envId = Number(process.env.COMPOUNDER_NOTIFY_USER_ID);
  if (Number.isInteger(envId) && envId > 0) {
    userIds = [envId];
  } else {
    const admins = await prisma.user.findMany({ where: { is_super_admin: true }, select: { id: true } });
    userIds = admins.map((u) => u.id);
  }
  const roleLabel = d.role === 'distributor' ? 'Distributor' : 'Compounder';
  for (const userId of userIds) {
    await createNotification({
      userId,
      type: 'compounder_lead',
      title: `🌐 Nový Compounder lead: ${d.name}`,
      body: `${roleLabel} — ${d.email}`,
      link: '/modules/prodejni-objednavky/index.html',
      meta: { lead_id: leadId, role: d.role, email: d.email },
    });
  }
}

// ─── Compounder Portal — magic-link token (HMAC, bez DB sloupce) ─────────────
function portalSecret() {
  return process.env.COMPOUNDER_TOKEN_SECRET || process.env.JWT_SECRET || 'compounder-portal-secret';
}
function portalBase() {
  return (process.env.COMPOUNDER_BASE_URL || 'https://www.compounder.world').replace(/\/+$/, '');
}
function makePortalToken(leadId) {
  const sig = crypto.createHmac('sha256', portalSecret()).update('compounder:' + leadId).digest('base64url');
  return leadId + '.' + sig;
}
function verifyPortalToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  const id = Number(parts[0]);
  const sig = parts[1];
  if (!Number.isInteger(id) || id <= 0 || !sig) return null;
  const expected = crypto.createHmac('sha256', portalSecret()).update('compounder:' + id).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}
async function sendPortalInvite(d, portalUrl) {
  const from = process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || process.env.INVOICE_IMAP_USER;
  await sendMail({
    to: d.email,
    from,
    subject: 'Vstup do Compounder Portalu',
    preheader: 'Váš osobní přístup k ekonomice, návratnosti a parametrům Compounderu.',
    body:
      `Dobrý den, ${d.name},\n\n` +
      `děkujeme za zájem o Compounding. Tímto odkazem se dostanete do Compounder Portalu — ` +
      `ekonomika, návratnost, technické parametry, přípojky, půdorysy a distribuční model.\n\n` +
      `Odkaz je osobní, nesdílejte ho.`,
    link: portalUrl,
    linkLabel: 'Otevřít Compounder Portal',
  });
}

module.exports = router;
