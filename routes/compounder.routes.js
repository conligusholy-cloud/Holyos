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
    // Notifikace kompetentní osobě (in-app zvonek) — fire-and-forget, ať chyba neshodí registraci.
    notifyNewLead(lead.id, d).catch((e) => console.error('[compounder] notifikace selhala:', e.message));
    return res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    next(err);
  }
});

// ─── VEŘEJNÉ: analytika chování (stub) ──────────────────────────────────────
// Frontend posílá beacon s eventy (page_view, section_view, cta_click, …).
// TODO (další fáze): ukládat do CompounderEvent + per-user dashboard.
// Zatím přijmeme a zahodíme, ať web nehází chyby.
router.post('/track', (req, res) => {
  res.status(204).end();
});

// ─── VEŘEJNÉ: reakce na push notifikaci (stub) ──────────────────────────────
// Service worker hlásí open/dismiss/akci na notifikaci.
// TODO (další fáze): párovat s odeslanou notifikací a měřit reakci.
router.post('/push-reaction', (req, res) => {
  res.status(204).end();
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

module.exports = router;
