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
const { inviteEmail, loginEmail } = require('../services/compounder-emails');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

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

// ─── VEŘEJNÉ: reakce na push notifikaci ─────────────────────────────────────
// Service worker hlásí open/dismiss/akci. id = "<lead_id>.<nonce>" → svážeme s leadem.
router.post('/push-reaction', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.id || '');
    const leadId = Number(id.split('.')[0]) || null;
    await prisma.compounderEvent.create({
      data: {
        sid: 'push' + (leadId ? ':' + leadId : ''),
        event: 'push_reaction',
        props: { action: b.action || 'open', push_id: id, lead_id: leadId || undefined },
        ip: clientIp(req),
      },
    });
  } catch (e) { /* best-effort */ }
  res.status(204).end();
});

// ─── PUSH: VAPID public key (veřejné) ───────────────────────────────────────
router.get('/push/key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// ─── PUSH: uložení odběru (veřejné). t = portal token → svázání s leadem ─────
router.post('/push/subscribe', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sub = b.subscription || {};
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'Neplatná subscription' });
    }
    const leadId = b.t ? verifyPortalToken(String(b.t)) : null;
    const endpoint = String(sub.endpoint).slice(0, 500);
    const data = {
      p256dh: String(sub.keys.p256dh).slice(0, 255),
      auth: String(sub.keys.auth).slice(0, 255),
      lead_id: leadId || null,
      sid: b.sid ? String(b.sid).slice(0, 64) : null,
      lang: b.lang ? String(b.lang).slice(0, 10) : null,
      ua: req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 1000) : null,
    };
    await prisma.compounderPushSub.upsert({
      where: { endpoint },
      update: data,
      create: Object.assign({ endpoint }, data),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── PUSH: odeslání (admin). { leadId? | broadcast:true, title, body, url? } ──
router.post('/push/send', requireAuth, async (req, res, next) => {
  try {
    const { leadId, broadcast, title, body, url } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Chybí titulek' });
    if (!leadId && !broadcast) return res.status(400).json({ error: 'Zadej leadId nebo broadcast=true' });
    const r = await sendCompounderPush({ leadId: leadId ? Number(leadId) : null, title, body, url });
    res.json(r);
  } catch (err) { next(err); }
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
      select: { id: true, name: true, role: true, lang: true, password_hash: true },
    });
    if (!lead) return res.status(404).json({ ok: false, error: 'Registrace nenalezena.' });
    return res.json({ ok: true, id: lead.id, name: lead.name, role: lead.role, lang: lead.lang, has_password: !!lead.password_hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/compounder/portal/economy-link?t=<token>
// Vrátí (a při prvním přístupu vytvoří) OSOBNÍ share odkaz na detailní model
// "Ekonomika prádlomatu" pro daného leada. Každý účet z Portalu má vlastní
// token, takže prohlížení detailní ekonomiky lze sledovat per účet.
router.get('/portal/economy-link', async (req, res, next) => {
  try {
    const id = verifyPortalToken(String(req.query.t || ''));
    if (!id) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    const lead = await prisma.compounderLead.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, lang: true },
    });
    if (!lead) return res.status(404).json({ ok: false, error: 'Registrace nenalezena.' });

    const TOOL = 'pradlomat-economy';
    // Jazyky shodné s compounder webem (model je přeložený do všech); první kód
    // = výchozí jazyk odkazu, nastavený podle jazyka leada z registrace.
    const ALL_LANGS = ['cs', 'en', 'de', 'fr', 'bg', 'da', 'el', 'es', 'et', 'fi', 'ga', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'];
    const code = String(lead.lang || '').toLowerCase().split(/[-_]/)[0];
    const pref = ALL_LANGS.includes(code) ? code : 'en';
    const languages = [pref, ...ALL_LANGS.filter((l) => l !== pref)];

    // Najdi existující osobní odkaz tohoto leada, jinak ho vytvoř.
    let recipient = await prisma.businessToolRecipient.findFirst({
      where: { tool: TOOL, compounder_lead_id: lead.id },
      select: { id: true, share_token: true },
    });
    if (!recipient) {
      recipient = await prisma.businessToolRecipient.create({
        data: {
          tool: TOOL,
          name: lead.name,
          email: lead.email,
          company: 'Compounder Portal',
          note: 'Auto: lead z compounder.world (per-účet sledování ekonomiky)',
          share_token: crypto.randomBytes(24).toString('hex'),
          languages,
          compounder_lead_id: lead.id,
          created_by: null,
        },
        select: { id: true, share_token: true },
      });
    } else {
      // Udrž jazykovou paritu i pro dříve vytvořené odkazy (default = jazyk leada).
      await prisma.businessToolRecipient.update({
        where: { id: recipient.id },
        data: { languages },
      }).catch(() => {});
    }
    // Odkaz vede na compounder.world (ne bestseries.cash) — share stránka se
    // tam zobrazí v Compounder brandu. Routa /share/tools/* je host-agnostická.
    const url = portalBase() + '/share/tools/' + TOOL + '/' + recipient.share_token;
    return res.json({ ok: true, url });
  } catch (err) {
    next(err);
  }
});

// ─── VEŘEJNÉ: AI zhodnocení místa (Compounder Portal, pro přihlášené leady) ──
// POST /api/compounder/portal/location-assess  { t, address, perDay }
// Geokóduje adresu (OSM Nominatim), zjistí parkoviště a populaci v okruhu 15 km
// (OSM Overpass) a nechá Claude napsat krátkou statistickou zprávu + odhad úspěchu.
const locAssessSchema = z.object({
  t: z.string().min(1),
  address: z.string().trim().min(3).max(200),
  perDay: z.coerce.number().min(0).max(100000).optional(),
  lang: z.string().trim().max(10).optional(),
});
router.post('/portal/location-assess', async (req, res, next) => {
  try {
    const parsed = locAssessSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Neplatný vstup.' });
    const leadId = verifyPortalToken(parsed.data.t);
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný přístup.' });

    // jednoduchý rate limit proti zneužití (každé zhodnocení je placené AI volání)
    if (!locRateOk(clientIp(req), leadId)) {
      return res.status(429).json({ ok: false, error: 'Příliš mnoho dotazů. Zkus to prosím za chvíli.' });
    }

    const lead = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { lang: true } });
    // Jazyk zprávy = aktuálně zvolený jazyk stránky (z požadavku), jinak jazyk leada, jinak EN.
    const reqLang = parsed.data.lang ? String(parsed.data.lang).toLowerCase().split(/[-_]/)[0] : '';
    const leadLang = (lead && lead.lang) ? String(lead.lang).toLowerCase().split(/[-_]/)[0] : '';
    const lang = /^[a-z]{2}$/.test(reqLang) ? reqLang : (/^[a-z]{2}$/.test(leadLang) ? leadLang : 'en');
    const perDay = Number(parsed.data.perDay) > 0 ? Number(parsed.data.perDay) : 8;

    // 1) geokódování adresy
    const geo = await geocodeAddress(parsed.data.address);
    if (!geo) return res.status(422).json({ ok: false, error: 'Adresu se nepodařilo najít.' });

    // 2) parkoviště poblíž + populace v okruhu 15 km (OSM Overpass)
    const [parking, pop] = await Promise.all([
      osmParking(geo.lat, geo.lon),
      osmPopulation(geo.lat, geo.lon, 15000),
    ]);

    const monthlyCustomers = Math.round(perDay * 30.4);
    const requiredPct = (pop.population > 0) ? (monthlyCustomers / pop.population * 100) : null;

    const facts = {
      address: geo.display_name, lat: geo.lat, lon: geo.lon,
      parking_count: parking.count, nearest_parking_m: parking.nearest_m,
      population_15km: pop.population, places: pop.places.slice(0, 12),
      per_day: perDay, monthly_customers: monthlyCustomers,
      required_pct: requiredPct == null ? null : Number(requiredPct.toFixed(2)),
    };

    // 3) AI zpráva (s fallbackem, kdyby AI selhala)
    let report = await locationReportAI(facts, lang);
    if (!report) report = locationReportFallback(facts, lang);

    // log do analytiky (best-effort)
    try {
      await prisma.compounderEvent.create({ data: {
        sid: 'loc:' + leadId, event: 'location_assess',
        props: { lead_id: leadId, address: geo.display_name, pop: pop.population, req_pct: facts.required_pct, score: report.scorePct },
        path: '/portal', ip: clientIp(req),
      }});
    } catch (e) { /* best-effort */ }

    return res.json({ ok: true, facts, report });
  } catch (err) {
    next(err);
  }
});

// ─── VEŘEJNÉ: přihlášení vracejícího se leada (magic link na e-mail) ─────────
// POST /api/compounder/login  { email, lang? }
// Najde lead dle e-mailu a pošle přihlašovací odkaz (platí 24 h). Odpověď je
// VŽDY neutrální ({ ok: true }) — neprozrazuje, zda e-mail známe.
const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200).optional().nullable(),
  lang: z.string().trim().max(10).optional().nullable(),
});
router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Neplatný e-mail.' });
    const email = parsed.data.email;
    const password = parsed.data.password;
    const lead = await prisma.compounderLead.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { created_at: 'desc' },
      select: { id: true, name: true, email: true, role: true, lang: true, password_hash: true },
    });

    // ── Přihlášení HESLEM ──────────────────────────────────────────────────
    if (password) {
      const ok = lead && lead.password_hash && await bcrypt.compare(password, lead.password_hash);
      if (!ok) {
        // generická hláška (neprozrazuje, zda chyba je e-mail nebo heslo)
        return res.status(401).json({ ok: false, error: 'Neplatný e-mail nebo heslo.' });
      }
      console.log(`[compounder] Přihlášení heslem: lead #${lead.id}`);
      return res.json({
        ok: true, token: makeSessionToken(lead.id),
        id: lead.id, name: lead.name, role: lead.role, lang: lead.lang,
      });
    }

    // ── Přihlášení ODKAZEM (magic link) ────────────────────────────────────
    if (lead) {
      const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
      sendPortalLogin({ name: lead.name, email: lead.email, lang: lead.lang }, url)
        .catch((e) => console.error('[compounder] login e-mail selhal:', e.message));
      console.log(`[compounder] Přihlašovací odkaz odeslán pro lead #${lead.id}`);
    } else {
      console.log(`[compounder] Přihlášení – neznámý e-mail: ${email}`);
    }
    // Vždy stejná odpověď (anti-enumeration).
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/compounder/set-password  { t: token, password }
// Nastaví/změní heslo přihlášeného leada. Vyžaduje platný token (z odkazu nebo session).
const setPwSchema = z.object({
  t: z.string().min(3),
  password: z.string().min(6).max(200),
});
router.post('/set-password', async (req, res, next) => {
  try {
    const parsed = setPwSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Heslo musí mít alespoň 6 znaků.' });
    const id = verifyPortalToken(parsed.data.t);
    if (!id) return res.status(401).json({ ok: false, error: 'Neplatný nebo vypršelý přístup.' });
    const hash = await bcrypt.hash(parsed.data.password, 10);
    await prisma.compounderLead.update({ where: { id }, data: { password_hash: hash } });
    console.log(`[compounder] Heslo nastaveno pro lead #${id}`);
    // vrať čerstvý dlouhý token, ať zůstane přihlášen
    return res.json({ ok: true, token: makeSessionToken(id) });
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

// DELETE /api/compounder/leads/:id — smazání leadu (testovací průchod procesem)
router.delete('/leads/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    await prisma.compounderLead.delete({ where: { id } });
    res.json({ ok: true });
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
function hmacSig(payload) {
  return crypto.createHmac('sha256', portalSecret()).update(payload).digest('base64url');
}
function safeEqStr(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
// Permanentní token (registrace) — formát: id.sig
function makePortalToken(leadId) {
  return leadId + '.' + hmacSig('compounder:' + leadId);
}
// Časově omezený přihlašovací token — formát: id.exp.sig (exp = ms epoch). Default 24 h.
function makeLoginToken(leadId, ttlMs) {
  const exp = Date.now() + (ttlMs || 24 * 3600 * 1000);
  return leadId + '.' + exp + '.' + hmacSig('compounder:' + leadId + ':' + exp);
}
// Dlouhá session ("zůstat přihlášen") — ~1 rok. Stejný formát id.exp.sig.
function makeSessionToken(leadId) {
  return makeLoginToken(leadId, 365 * 24 * 3600 * 1000);
}
// Ověří oba formáty: 2-part permanentní (registrace) i 3-part s expirací (login).
function verifyPortalToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  const id = Number(parts[0]);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (parts.length === 2) {
    // permanentní (registrace)
    if (!parts[1]) return null;
    return safeEqStr(parts[1], hmacSig('compounder:' + id)) ? id : null;
  }
  if (parts.length === 3) {
    // časově omezený login token: id.exp.sig
    const exp = Number(parts[1]);
    if (!Number.isInteger(exp) || !parts[2]) return null;
    if (Date.now() > exp) return null; // expirovaný
    return safeEqStr(parts[2], hmacSig('compounder:' + id + ':' + exp)) ? id : null;
  }
  return null;
}
function compounderMailFromName() {
  return process.env.COMPOUNDER_MAIL_FROM_NAME || 'Compounder · World';
}
async function sendPortalInvite(d, portalUrl) {
  const from = process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || process.env.INVOICE_IMAP_USER;
  // E-mail v jazyce, který zájemce zvolil na webu (d.lang); fallback angličtina.
  const t = inviteEmail(d.name, d.lang);
  await sendMail({
    to: d.email,
    from,
    fromName: compounderMailFromName(),
    brand: 'compounder',
    subject: t.subject,
    preheader: t.preheader,
    body: t.body,
    link: portalUrl,
    linkLabel: t.linkLabel,
  });
}
async function sendPortalLogin(d, url) {
  const from = process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || process.env.INVOICE_IMAP_USER;
  const t = loginEmail(d.name, d.lang);
  await sendMail({
    to: d.email,
    from,
    fromName: compounderMailFromName(),
    brand: 'compounder',
    subject: t.subject,
    preheader: t.preheader,
    body: t.body,
    link: url,
    linkLabel: t.linkLabel,
  });
}

// ─── Web Push (VAPID) — odesílání ────────────────────────────────────────────
let _webpush = null;
let _webpushReady = false;
function getWebpush() {
  if (_webpushReady) return _webpush;
  _webpushReady = true;
  try { _webpush = require('web-push'); } catch (e) { _webpush = null; return null; }
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    try { _webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@bestseries.cz', pub, priv); }
    catch (e) { console.error('[compounder] VAPID setup:', e.message); }
  }
  return _webpush;
}

// Odešle push odběrům leada (leadId) nebo všem (leadId=null = broadcast).
// Vrací { sent, failed, removed }. Volatelné i z workeru (automatika).
async function sendCompounderPush({ leadId, title, body, url }) {
  const wp = getWebpush();
  if (!wp) return { sent: 0, failed: 0, removed: 0, error: 'web-push není nainstalován' };
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { sent: 0, failed: 0, removed: 0, error: 'chybí VAPID klíče v env' };
  }
  const where = leadId ? { lead_id: leadId } : {};
  const subs = await prisma.compounderPushSub.findMany({ where, take: 5000 });
  let sent = 0, failed = 0, removed = 0;
  const nonce = Date.now().toString(36);
  for (const s of subs) {
    const payload = JSON.stringify({
      title,
      body: body || '',
      url: url || (process.env.COMPOUNDER_BASE_URL || 'https://www.compounder.world') + '/portal',
      id: (s.lead_id || 0) + '.' + nonce,
    });
    try {
      await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
      await prisma.compounderPushSub.update({ where: { endpoint: s.endpoint }, data: { last_sent_at: new Date() } }).catch(() => {});
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        removed++;
        await prisma.compounderPushSub.delete({ where: { endpoint: s.endpoint } }).catch(() => {});
      } else {
        failed++;
      }
    }
  }
  await prisma.compounderEvent.create({
    data: { sid: 'admin', event: 'push_sent', props: { lead_id: leadId || undefined, sent, failed, removed, title } },
  }).catch(() => {});
  return { sent, failed, removed };
}

// ─── Location-assess helpers ────────────────────────────────────────────────
const _locHits = new Map(); // "ip|lead" → [timestamps]; jednoduchý in-memory limiter
function locRateOk(ip, leadId) {
  const key = (ip || '?') + '|' + leadId;
  const now = Date.now(), win = 60 * 60 * 1000, max = 8;
  const arr = (_locHits.get(key) || []).filter((t) => now - t < win);
  if (arr.length >= max) { _locHits.set(key, arr); return false; }
  arr.push(now); _locHits.set(key, arr);
  if (_locHits.size > 5000) _locHits.clear();
  return true;
}
function locUA() { return 'CompounderPortal/1.0 (+https://compounder.world)'; }
async function locFetchJson(url, opts, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms || 9000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal, headers: { 'User-Agent': locUA(), 'Accept': 'application/json' } }, opts || {}));
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(to); }
}
async function geocodeAddress(address) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
  const j = await locFetchJson(url);
  if (!Array.isArray(j) || !j.length) return null;
  const x = j[0];
  const lat = parseFloat(x.lat), lon = parseFloat(x.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, display_name: x.display_name || address };
}
async function overpassQuery(query) {
  return locFetchJson('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': locUA(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  }, 14000);
}
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
async function osmParking(lat, lon) {
  const q = '[out:json][timeout:20];(nwr[amenity=parking](around:600,' + lat + ',' + lon + '););out center 40;';
  const j = await overpassQuery(q);
  const els = (j && j.elements) || [];
  let nearest = null;
  els.forEach((e) => {
    const ll = e.center || e;
    if (ll.lat == null) return;
    const d = haversineM(lat, lon, ll.lat, ll.lon);
    if (nearest == null || d < nearest) nearest = d;
  });
  return { count: els.length, nearest_m: nearest };
}
async function osmPopulation(lat, lon, radius) {
  const q = '[out:json][timeout:25];node(around:' + radius + ',' + lat + ',' + lon + ')[place][population];out 100;';
  const j = await overpassQuery(q);
  const els = (j && j.elements) || [];
  let total = 0; const places = [];
  els.forEach((e) => {
    const raw = (e.tags && e.tags.population) || '';
    const p = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(p) || p <= 0) return;
    total += p;
    places.push({ name: (e.tags && (e.tags.name || e.tags['name:en'])) || '?', population: p, place: e.tags && e.tags.place });
  });
  places.sort((a, b) => b.population - a.population);
  return { population: total, places };
}
async function locationReportAI(facts, lang) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi analytik lokality pro venkovní samoobslužnou prádelnu (Compounder Machine). Z dodaných dat napiš stručné, věcné zhodnocení místa. Odpověz POUZE platným JSON bez markdownu ve tvaru: {"verdict":"<2-4 slova>","scorePct":<celé 0-100>,"summary":"<2-4 věty>","factors":[{"label":"<krátké>","value":"<krátké>","good":<true|false>}],"recommendation":"<1-2 věty>"}. Klíčový faktor je required_pct = jaké procento populace v okruhu musí přijít prát; čím nižší, tím lépe (<0,5 % výborné, 0,5-1 % dobré, 1-2 % střední, 2-5 % náročné, >5 % velmi náročné). Parkoviště poblíž je zásadní plus. Pokud population_15km = 0, jde o chybějící data z OpenStreetMap — uveď to a buď opatrný. Populace z OSM je orientační. Piš v jazyce s kódem: ' + lang + '.';
    const usr = 'Data o místě (JSON):\n' + JSON.stringify(facts);
    const msg = await client.messages.create({ model, max_tokens: 900, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    const j = JSON.parse(text);
    return {
      verdict: String(j.verdict || '').slice(0, 60),
      scorePct: Math.max(0, Math.min(100, Math.round(Number(j.scorePct) || 0))),
      summary: String(j.summary || '').slice(0, 1200),
      factors: Array.isArray(j.factors) ? j.factors.slice(0, 8).map((f) => ({ label: String(f.label || '').slice(0, 60), value: String(f.value || '').slice(0, 80), good: !!f.good })) : [],
      recommendation: String(j.recommendation || '').slice(0, 600),
    };
  } catch (e) { return null; }
}
function locationReportFallback(facts, lang) {
  const rp = facts.required_pct;
  let score = 50;
  if (rp != null) score = rp < 0.5 ? 88 : rp < 1 ? 74 : rp < 2 ? 58 : rp < 5 ? 38 : 18;
  if (facts.parking_count > 0) score = Math.min(100, score + 6);
  const cs = lang === 'cs';
  const summary = cs
    ? ('V okruhu 15 km žije přibližně ' + facts.population_15km.toLocaleString('cs') + ' lidí. Pro ' + facts.monthly_customers + ' zákazníků měsíčně potřebuješ přesvědčit ' + (rp == null ? '— (chybí data)' : (rp + ' %')) + ' z nich. Parkoviště v okolí: ' + facts.parking_count + '. Čísla jsou orientační (OpenStreetMap).')
    : ('About ' + facts.population_15km.toLocaleString('en') + ' people live within 15 km. For ' + facts.monthly_customers + ' monthly customers you need ' + (rp == null ? '— (no data)' : (rp + ' %')) + ' of them. Nearby parking: ' + facts.parking_count + '. Figures are indicative (OpenStreetMap).');
  return { verdict: cs ? 'Orientační' : 'Indicative', scorePct: score, summary, factors: [], recommendation: '' };
}

module.exports = router;
