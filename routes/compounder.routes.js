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
const { getSetting, setSetting, getOurCompany } = require('../services/settings');
const contracts = require('../services/pdf/contracts');
const compounderNotify = require('../services/compounder/notify');
const digestWorker = require('../services/compounder/daily-digest-worker');
const salesMgr = require('../services/ai/sales-manager');
const multer = require('multer');
const { putObject: r2Put } = require('../services/storage/r2');
const kioskPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 3 } });
const crypto = require('crypto');
const { buildShareUrl, getAppUrl } = require('../services/share-url');
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
    if (await _isBlocked(d.email, null)) { console.log('[compounder] Registrace blokována (blocklist): ' + d.email); return res.json({ ok: true }); }
    // Dedup: e-mail smí být zaregistrovaný jen jednou. Při opakované registraci
    // nezakládáme duplicitu, ale pošleme přihlašovací odkaz v jazyce stránky.
    const existing = await prisma.compounderLead.findFirst({
      where: { email: { equals: d.email, mode: 'insensitive' } },
      orderBy: { created_at: 'desc' },
      select: { id: true, name: true, email: true, lang: true, source: true, access_approved_at: true },
    });
    if (existing) {
      // Nezvaný čekající na schválení: odkaz neposíláme, jen potvrdíme příjem.
      if (!leadAccessAllowed(existing)) {
        console.log(`[compounder] Duplicitní registrace ${d.email} → čeká na schválení přístupu (lead #${existing.id})`);
        return res.json({ ok: true, existing: true, pending: true });
      }
      const loginUrl = `${portalBase()}/portal?t=${makeLoginToken(existing.id)}`;
      sendPortalLogin({ name: existing.name || d.name, email: existing.email, lang: d.lang || existing.lang }, loginUrl)
        .catch((e) => console.error('[compounder] login e-mail (duplicitní registrace):', e.message));
      console.log(`[compounder] Duplicitní registrace ${d.email} → poslán přihlašovací odkaz (lead #${existing.id})`);
      return res.json({ ok: true, existing: true });
    }
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

// GET /api/compounder/lokality-analytics?days=30 — návštěvnost webu Lokality (events lok_*).
router.get('/lokality-analytics', requireAuth, async (req, res, next) => {
  try {
    const raw = String(req.query.days || '30');
    let days, since;
    if (raw === 'today') {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      since = t; days = 1;
    } else {
      days = Math.min(Math.max(parseInt(raw, 10) || 30, 1), 365);
      since = new Date(Date.now() - days * 86400000);
    }
    const evs = await prisma.compounderEvent.findMany({
      where: { event: { startsWith: 'lok_' }, created_at: { gte: since } },
      select: { sid: true, event: true, props: true, created_at: true },
      take: 50000,
    });
    const viewSids = new Set(), onlineSids = new Set();
    let views = 0, clicks = 0, submits = 0;
    const bySource = {}, byLabel = {}, byDay = {}, byRegion = {};
    const REGION = { Europe: 'Evropa', America: 'Amerika', Asia: 'Asie', Africa: 'Afrika', Australia: 'Austrálie', Pacific: 'Pacifik', Atlantic: 'Atlantik', Indian: 'Indický oceán', Antarctica: 'Antarktida' };
    // Časové pásmo → země (Czech). Město bereme z části za '/'. Neúplné, ale bez externí geolokace.
    const TZ_COUNTRY = { 'Europe/Prague': 'Česko', 'Europe/Bratislava': 'Slovensko', 'Europe/Berlin': 'Německo', 'Europe/Vienna': 'Rakousko', 'Europe/Warsaw': 'Polsko', 'Europe/Budapest': 'Maďarsko', 'Europe/Paris': 'Francie', 'Europe/Madrid': 'Španělsko', 'Europe/Rome': 'Itálie', 'Europe/Amsterdam': 'Nizozemsko', 'Europe/Brussels': 'Belgie', 'Europe/Zurich': 'Švýcarsko', 'Europe/London': 'Velká Británie', 'Europe/Dublin': 'Irsko', 'Europe/Lisbon': 'Portugalsko', 'Europe/Copenhagen': 'Dánsko', 'Europe/Stockholm': 'Švédsko', 'Europe/Oslo': 'Norsko', 'Europe/Helsinki': 'Finsko', 'Europe/Athens': 'Řecko', 'Europe/Bucharest': 'Rumunsko', 'Europe/Sofia': 'Bulharsko', 'Europe/Zagreb': 'Chorvatsko', 'Europe/Ljubljana': 'Slovinsko', 'Europe/Kiev': 'Ukrajina', 'Europe/Kyiv': 'Ukrajina', 'Europe/Moscow': 'Rusko', 'Europe/Istanbul': 'Turecko', 'America/New_York': 'USA', 'America/Chicago': 'USA', 'America/Denver': 'USA', 'America/Los_Angeles': 'USA', 'America/Toronto': 'Kanada', 'America/Sao_Paulo': 'Brazílie', 'Asia/Dubai': 'SAE', 'Asia/Tokyo': 'Japonsko', 'Asia/Shanghai': 'Čína', 'Australia/Sydney': 'Austrálie' };
    const nowMs = Date.now();
    evs.forEach((e) => {
      const p = e.props || {};
      if (nowMs - e.created_at.getTime() <= 90000) onlineSids.add(e.sid); // aktivní za posledních 90 s
      if (e.event === 'lok_view') {
        views++; viewSids.add(e.sid);
        const s = (p.utm_source ? String(p.utm_source) : (p.ref ? 'referral' : 'přímý')).slice(0, 40);
        bySource[s] = (bySource[s] || 0) + 1;
        const d = e.created_at.toISOString().slice(0, 10); byDay[d] = (byDay[d] || 0) + 1;
        const tz = p.tz ? String(p.tz) : '';
        let geo = 'Neznámé';
        if (tz) {
          const parts = tz.split('/');
          const city = (parts[parts.length - 1] || '').replace(/_/g, ' ');
          const country = TZ_COUNTRY[tz] || REGION[parts[0]] || parts[0];
          geo = city ? (country + ' · ' + city) : country;
        }
        byRegion[geo] = (byRegion[geo] || 0) + 1;
      } else if (e.event === 'lok_click') {
        clicks++; const l = (p.label ? String(p.label) : '').slice(0, 40); if (l) byLabel[l] = (byLabel[l] || 0) + 1;
      }
    });
    // Odeslané nabídky = REÁLNĚ uložené nabídky z veřejného webu (Site.public_source), ne klik-eventy.
    // Vyloučíme vlastní/testovací e-maily (@bestseries.cz/.cash/.global).
    try {
      const sub = await prisma.site.findMany({
        where: { public_source: { not: null }, created_at: { gte: since } },
        select: { owner_email: true },
      });
      submits = sub.filter((s) => !/@bestseries\.(cz|cash|global)/i.test(String(s.owner_email || ''))).length;
    } catch (e) { submits = 0; }
    const uniqueVisitors = viewSids.size;
    const topSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ source: k, count: v }));
    const topClicks = Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ label: k, count: v }));
    const daily = [];
    for (let i = days - 1; i >= 0; i--) { const dt = new Date(Date.now() - i * 86400000); const d = dt.toISOString().slice(0, 10); daily.push({ date: d, label: dt.getDate() + '.' + (dt.getMonth() + 1) + '.', count: byDay[d] || 0 }); }
    const conversionPct = uniqueVisitors > 0 ? Math.round((submits / uniqueVisitors) * 1000) / 10 : 0;
    const topRegions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ region: k, count: v }));
    res.json({ days, views, uniqueVisitors, clicks, submits, conversionPct, onlineNow: onlineSids.size, topSources, topClicks, topRegions, daily });
  } catch (err) { next(err); }
});

// POST /api/compounder/lokality-ai — AI vyhodnocení návštěvnosti + návrhy na vyšší konverzi.
router.post('/lokality-ai', requireAuth, async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI není nakonfigurováno (chybí ANTHROPIC_API_KEY).' });
    const stats = (req.body && req.body.analytics) || {};
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi konverzní analytik landing page. Web bestseries.global láká majitele míst/pozemků, aby nabídli místo pro samoobslužný prádlomat (platíme nájem nebo místo odkoupíme, o provoz/servis se staráme my). Cíl konverze = odeslání formuláře „Nabídnout místo". Dostaneš statistiky návštěvnosti (views, uniqueVisitors, clicks, submits, conversionPct, topSources = zdroje/UTM, topClicks = na co lidé klikají, denní řada) a strukturu stránky. Vyhodnoť, co brání vyšší konverzi, a navrhni KONKRÉTNÍ úpravy (nadpisy, CTA, formulář, důvěra/sociální důkaz, rychlost, cílení návštěvnosti). Odpověz POUZE platným JSON bez markdownu: {"summary":"<2-4 věty>","conversionRating":"<slovně: slabá/průměrná/dobrá>","insights":[{"label":"<krátce>","detail":"<1-2 věty>"}],"actions":["<konkrétní úprava od nejvíc dopadové>", "..."]}. Piš česky.';
    const pageInfo = 'Stránka: nadpis „Máte volných pár metrů? Nabídněte místo pro prádlomat." · CTA „Nabídnout místo na mapě" a „Jak to funguje" · formulář (adresa na mapě, telefon/e-mail, vlastnictví místa, přípojky: elektřina/voda/kanalizace/parkoviště) · nabízíme nájem nebo odkup, provoz řešíme my. Prádlomat = samoobslužná prádelna 6,4 m².';
    const usr = 'Statistiky (JSON):\n' + JSON.stringify(stats) + '\n\nStruktura stránky:\n' + pageInfo;
    const msg = await client.messages.create({ model, max_tokens: 1000, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    let j; try { j = JSON.parse(text); } catch (e) { return res.json({ ok: true, summary: text.slice(0, 1200), insights: [], actions: [] }); }
    res.json({
      ok: true,
      summary: String(j.summary || '').slice(0, 1200),
      conversionRating: String(j.conversionRating || '').slice(0, 40),
      insights: Array.isArray(j.insights) ? j.insights.slice(0, 8).map((x) => ({ label: String(x.label || '').slice(0, 80), detail: String(x.detail || '').slice(0, 300) })) : [],
      actions: Array.isArray(j.actions) ? j.actions.slice(0, 10).map((a) => String(a).slice(0, 300)) : [],
    });
  } catch (err) { next(err); }
});

// POST /api/compounder/lokality-persona — AI vytvoří obraz ideálního zákazníka z nabídek + návštěvnosti.
router.post('/lokality-persona', requireAuth, async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI není nakonfigurováno (chybí ANTHROPIC_API_KEY).' });
    const analytics = (req.body && req.body.analytics) || {};
    let sites = [];
    try {
      sites = await prisma.site.findMany({
        orderBy: { id: 'desc' }, take: 150,
        select: { site_type: true, status: true, city: true, country: true, area_m2: true, water_supply: true, sewage: true, parking: true, score: true, rent_monthly: true, purchase_price: true },
      });
    } catch (e) { sites = []; }
    const n = sites.length;
    const by = (f) => { const m = {}; sites.forEach((s) => { const k = (s[f] != null && s[f] !== '') ? String(s[f]) : '—'; m[k] = (m[k] || 0) + 1; }); return m; };
    const pct = (pred) => n ? Math.round(sites.filter(pred).length / n * 100) : 0;
    const facts = {
      offers_total: n,
      by_type: by('site_type'), by_country: by('country'), by_status: by('status'),
      pct_parking: pct((s) => s.parking === true), pct_water: pct((s) => s.water_supply === true), pct_sewage: pct((s) => s.sewage === true),
      avg_area_m2: n ? Math.round(sites.reduce((a, s) => a + (Number(s.area_m2) || 0), 0) / n) : null,
      analytics: { views: analytics.views, unique: analytics.uniqueVisitors, submits: analytics.submits, conversionPct: analytics.conversionPct, topSources: analytics.topSources, topRegions: analytics.topRegions, topClicks: analytics.topClicks },
    };
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi marketingový stratég. Best Series shání přes web bestseries.global majitele míst/pozemků, kteří nabídnou místo pro samoobslužný prádlomat (6,4 m²) — Best Series platí nájem nebo místo odkoupí a o provoz se stará. Cíl: definuj OBRAZ IDEÁLNÍHO ZÁKAZNÍKA (persona toho, kdo nabídne dobré místo a snadno konvertuje), aby na něj šla cílit reklama. Vyjdi z dat: reálné nabídky (typy nájem/odkup, země, přípojky, plocha, stavy) a návštěvnost (zdroje, regiony, prokliky). Když je dat málo, dopň odborným odhadem podle byznysu a označ to. Odpověz POUZE platným JSON bez markdownu: {"persona_name":"<výstižný název, např. Majitel parkoviště u supermarketu>","summary":"<2-4 věty kdo to je>","demographics":["<bod>"],"motivations":["<co ho motivuje>"],"ideal_place":["<jaké místo nabízí>"],"where_to_reach":["<kde ho hledat / kanály / cílení reklamy>"],"messaging":["<jak ho oslovit, jaké argumenty>"],"red_flags":["<koho spíš nechceme / co nefunguje>"]}. Buď konkrétní a použitelné pro nastavení reklamy. Piš česky.';
    const usr = 'Data (JSON):\n' + JSON.stringify(facts);
    const msg = await client.messages.create({ model, max_tokens: 1100, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    let j; try { j = JSON.parse(text); } catch (e) { return res.json({ ok: true, persona_name: '', summary: text.slice(0, 1200) }); }
    const arr = (x) => Array.isArray(x) ? x.slice(0, 8).map((v) => String(v).slice(0, 200)) : [];
    res.json({ ok: true, persona_name: String(j.persona_name || '').slice(0, 120), summary: String(j.summary || '').slice(0, 1200), demographics: arr(j.demographics), motivations: arr(j.motivations), ideal_place: arr(j.ideal_place), where_to_reach: arr(j.where_to_reach), messaging: arr(j.messaging), red_flags: arr(j.red_flags) });
  } catch (err) { next(err); }
});

// ─── VEŘEJNÉ: aktuální kurzy (ČNB) pro přepočet měny v modelech ──────────────
// GET /api/compounder/fx-rates → { rates: { EUR, USD, GBP } } (CZK za 1 jednotku)
router.get('/fx-rates', async (req, res) => {
  try {
    const rates = await fxRatesCzk();
    res.json({ ok: true, rates });
  } catch (e) {
    res.json({ ok: false, rates: { EUR: 25, USD: 23, GBP: 29 } });
  }
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
// Odemykatelné skupiny sekcí portálu. Úvodní "filozofie" je vždy viditelná (mimo tento seznam).
// null/prázdné = nic odemčeno → lead vidí jen úvodní stránku s filozofií.
const SECTION_GROUPS = ['ekonomika', 'nabidka', 'distributor'];

// Aktuální lidské názvy sekcí webu compounder.world + Portalu (klíč eventu → název).
// Používá se pro AI vyhodnocení, aby popisovalo aktuální strukturu, ne interní klíče.
const SECTION_LABELS = {
  // Landing (compounder.world)
  top: 'Úvod', compounder: 'Co je Compounder', compounding: 'Co je Compounding',
  machine: 'Compounder Machine', traits: 'Proč to funguje', who: 'Pro koho',
  card: 'Compounder Card', register: 'Registrace',
  // Portal
  filozofie: 'Filozofie', ekonomika: 'Provozovatel', nabidka: 'Investor', navratnost: 'Distributor',
  milniky: 'Milníky (Gold & Diamond)', parametry: 'Parametry', galerie: 'Galerie',
  pripojky: 'Přípojky', pudorysy: 'Půdorysy', distribuce: 'Distribuce', lokalita: 'Lokalita', kontakt: 'Kontakt',
};
function relabelSections(sections) {
  const out = {};
  Object.keys(sections || {}).forEach((k) => { out[SECTION_LABELS[k] || k] = sections[k]; });
  return out;
}
function resolveSections(csv) {
  if (csv == null || String(csv).trim() === '') return [];
  const set = String(csv).split(',').map((s) => s.trim()).filter((s) => SECTION_GROUPS.includes(s));
  return Array.from(new Set(set));
}

// Má lead povolený přístup k portálu? Nezvaní (source='access_request') potřebují
// ruční schválení (access_approved_at). Ostatní zdroje (web/pozvánka) mají přístup
// jako dosud — pole se u nich neuplatňuje, aby stávající leady o přístup nepřišly.
function leadAccessAllowed(lead) {
  if (!lead) return false;
  if (lead.source === 'access_request') return !!lead.access_approved_at;
  return true;
}

// GET /api/compounder/portal/session?t=TOKEN
// Token je HMAC-podepsaný (lead id + podpis), bez DB sloupce. Ověří se serverem.
router.get('/portal/session', async (req, res, next) => {
  try {
    const id = verifyPortalToken(String(req.query.t || ''));
    if (!id) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    const lead = await prisma.compounderLead.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, phone: true, role: true, lang: true, visible_sections: true, visible_templates: true, show_revenue_stats: true, show_example: true, created_at: true, owner_person_id: true, external_rep_id: true, password_hash: true, source: true, access_approved_at: true },
    });
    if (!lead) return res.status(404).json({ ok: false, error: 'Registrace nenalezena.' });
    if (!leadAccessAllowed(lead)) {
      return res.status(403).json({ ok: false, pending: true, error: 'Tvoje žádost o přístup zatím čeká na schválení. Jakmile ho povolíme, dostaneš přihlašovací odkaz e-mailem.' });
    }
    const templates = (lead.visible_templates ? lead.visible_templates.split(',') : []).map((s) => s.trim()).filter(Boolean);
    // Kontakt pro sekci portálu. Přednost má externí obchodník (má-li vyplněný e-mail/telefon),
    // jinak přiřazený interní obchodník; jinak fallback na majitele (řeší frontend).
    let consultant = null;
    let consultantExternal = false;
    if (lead.external_rep_id) {
      try {
        const reps = await _loadExternalReps();
        const rep = reps.find((r) => Number(r.id) === Number(lead.external_rep_id));
        if (rep && (rep.email || rep.telefon)) {
          consultant = { name: rep.jmeno || '', phone: rep.telefon || '', email: rep.email || '' };
          consultantExternal = true;
        }
      } catch (e) { /* fallback níže */ }
    }
    if (!consultant && lead.owner_person_id) {
      try {
        const p = await prisma.person.findUnique({ where: { id: lead.owner_person_id }, select: { first_name: true, last_name: true, phone: true, email: true } });
        if (p) consultant = { name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(), phone: p.phone || '', email: p.email || '' };
      } catch (e) { /* fallback na majitele */ }
    }
    return res.json({ ok: true, id: lead.id, name: lead.name, email: lead.email || '', phone: lead.phone || '', role: lead.role, lang: lead.lang, sections: resolveSections(lead.visible_sections), templates: templates, showRevenueStats: !!lead.show_revenue_stats, showExample: !!lead.show_example, accountCreatedAt: lead.created_at, consultant: consultant, consultantExternal: consultantExternal, has_password: !!lead.password_hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/compounder/portal/template/:type?t=TOKEN — VZOR (mustr) smlouvy ke čtení.
// Vrací PDF inline (otevře se v prohlížeči, nestahuje). Jen typy zpřístupněné obchodníkem.
router.get('/portal/template/:type(kupni|servisni|rezervacni)', async (req, res, next) => {
  try {
    const type = req.params.type;
    const leadId = verifyPortalToken(String(req.query.t || ''));
    if (!leadId) return res.status(401).send('Neplatný nebo chybějící přístupový odkaz.');
    const lead = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { visible_templates: true } });
    const allowed = (lead && lead.visible_templates ? lead.visible_templates.split(',') : []).map((s) => s.trim());
    if (allowed.indexOf(type) === -1) return res.status(403).send('Tento vzor není zpřístupněn.');
    let pdf;
    try { pdf = await contracts.generateContractPdf(type, {}); }
    catch (e) { return res.status(500).send('Vzor se nepodařilo vygenerovat.'); }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="vzor-' + type + '.pdf"');
    res.send(pdf);
  } catch (err) { next(err); }
});

// GET /api/compounder/ares?ico=XXXXXXXX — doplnění firemních údajů z ARES rejstříku.
router.get('/ares', async (req, res, next) => {
  try {
    const ico = String(req.query.ico || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(ico)) return res.status(400).json({ ok: false, error: 'Neplatné IČO (8 číslic).' });
    let r;
    try {
      r = await fetch('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/' + ico, { headers: { Accept: 'application/json' } });
    } catch (e) { return res.status(502).json({ ok: false, error: 'ARES je nedostupný.' }); }
    if (r.status === 404) return res.status(404).json({ ok: false, error: 'IČO nenalezeno v ARESu.' });
    if (!r.ok) return res.status(502).json({ ok: false, error: 'ARES vrátil chybu.' });
    const d = await r.json();
    res.json({
      ok: true,
      ico,
      name: d.obchodniJmeno || '',
      address: (d.sidlo && (d.sidlo.textovaAdresa || '')) || '',
      dic: d.dic || '',
    });
  } catch (err) { next(err); }
});

// GET /api/compounder/portal/contracts?t=TOKEN — smlouvy leada u jeho rezervovaných
// lokalit, které mu obchodník zpřístupnil (mají share_token). K přečtení a podpisu.
router.get('/portal/contracts', async (req, res, next) => {
  try {
    const id = verifyPortalToken(String(req.query.t || ''));
    if (!id) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    let resv = [];
    try {
      resv = await prisma.locationReservation.findMany({
        where: { lead_id: id }, select: { kiosk_code: true },
      });
    } catch (e) { resv = []; }
    const codes = Array.from(new Set(resv.map((r) => r.kiosk_code).filter(Boolean)));
    if (!codes.length) return res.json({ ok: true, contracts: [] });
    let rows = await prisma.compoundingContract.findMany({
      where: { kiosk_code: { in: codes }, share_token: { not: null } },
      orderBy: { created_at: 'desc' },
      select: { type: true, status: true, kiosk_code: true, kiosk_label: true, share_token: true, signed_at: true, fields: true },
    });
    rows = rows.filter((r) => !(r.fields && r.fields._archived)); // archivované zákazníkovi skryté
    const out = rows.map((r) => ({
      type: r.type,
      typeLabel: contracts.TYPE_LABEL[r.type] || 'Smlouva',
      status: r.status,
      kiosk_code: r.kiosk_code,
      kiosk_label: r.kiosk_label,
      url: '/smlouva/' + r.share_token,
      pdf_url: '/api/compounder/contracts/public/' + r.share_token + '/pdf',
      signed_at: r.signed_at,
    }));
    res.json({ ok: true, contracts: out });
  } catch (err) { next(err); }
});

// GET /api/compounder/portal/status?t=<token>
// Stav dokumentů (rezervace + 3 smlouvy + platba) přihlášeného leada a z toho
// automaticky vygenerovaná časová osa zpráv ("na tom se pracuje"). Bez ruční práce.
function fmtCz(d) {
  if (!d) return '';
  const x = new Date(d);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${x.getDate()}.${x.getMonth() + 1}.${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
}
const CT_STATUS_MSG = { koncept: 'je připravena', odeslano: 'vám byla zpřístupněna', vyplneno: 'čeká na váš podpis', k_autorizaci: 'se připravuje k podpisu', k_podpisu: 'čeká na dokončení', k_podpisu_zakaznik: 'čeká na váš podpis', podepsano: 'je podepsaná' };
const RES_STATUS_LABEL = { hold: 'Blokace lokality (1 h)', reserved: 'Rezervováno — čeká na podpis rezervační smlouvy', active: 'Rezervováno — poplatek přijat', completed: 'Rezervace dokončena', cancelled: 'Rezervace zrušena', expired: 'Rezervace vypršela' };
router.get('/portal/status', async (req, res, next) => {
  try {
    const id = verifyPortalToken(String(req.query.t || ''));
    if (!id) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    // Dohledáme leada kvůli e-mailu/telefonu — rezervace mohla vzniknout pod jiným
    // lead záznamem nebo bez lead_id (starší data), ale se stejným kontaktem.
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { email: true, phone: true } });
    const or = [{ lead_id: id }];
    if (lead && lead.email) or.push({ buyer_email: { equals: lead.email, mode: 'insensitive' } });
    if (lead && lead.phone) or.push({ buyer_phone: lead.phone });
    let reservations = [];
    try {
      reservations = await prisma.locationReservation.findMany({
        where: { OR: or, status: { notIn: ['cancelled', 'expired'] } },
        orderBy: { created_at: 'desc' }, take: 20,
      });
    } catch (e) { reservations = []; }
    const codes = Array.from(new Set(reservations.map((r) => r.kiosk_code).filter(Boolean)));
    let contractRows = [];
    if (codes.length) {
      contractRows = await prisma.compoundingContract.findMany({
        where: { kiosk_code: { in: codes } },
        orderBy: { created_at: 'desc' },
        select: { type: true, status: true, kiosk_code: true, kiosk_label: true, share_token: true, signed_at: true, created_at: true, updated_at: true, fields: true },
      });
      // Archivované smlouvy zákazníkovi neukazujeme.
      contractRows = contractRows.filter((c) => !(c.fields && c.fields._archived));
    }
    const msgs = []; // { ts, icon, text }
    const push = (ts, icon, text) => { if (ts && text) msgs.push({ ts: new Date(ts).toISOString(), icon, text }); };
    let actionable = 0;
    const docs = [];
    reservations.forEach((r) => {
      const lbl = r.kiosk_code || 'lokalita';
      docs.push({ kind: 'reservation', label: lbl, status: r.status, statusLabel: RES_STATUS_LABEL[r.status] || r.status, reserved_until: r.reserved_until, sign_until: r.sign_until, fee_until: r.fee_until, fee_paid: !!r.fee_paid_at, purchase_paid: !!r.purchase_paid_at, pay_url: (['reserved', 'active'].indexOf(r.status) !== -1) ? ('/api/compounder/reservations/pay/' + makePayToken(r.id) + '/pdf') : null });
      push(r.created_at, '📥', `Rezervace lokality ${lbl} přijata.`);
      if (r.status === 'reserved') { push(r.updated_at, '✅', `Rezervace ${lbl} potvrzena — čeká na podpis rezervační smlouvy${r.sign_until ? ' do ' + fmtCz(r.sign_until) : ''}.`); }
      if (r.status === 'active') { push(r.fee_paid_at || r.updated_at, '💰', `Rezervační poplatek přijat — lokalita ${lbl} držena${r.reserved_until ? ' do ' + fmtCz(r.reserved_until) : ''}.`); }
      if (r.status === 'completed') { push(r.updated_at, '🎉', `Rezervace ${lbl} dokončena — vítejte mezi provozovateli Compounderu.`); }
      if (r.fee_paid_at) push(r.fee_paid_at, '💰', `Rezervační poplatek za ${lbl} zaplacen.`);
      if (r.purchase_paid_at) push(r.purchase_paid_at, '💰', `Kupní cena za ${lbl} zaplacena.`);
      if ((r.status === 'reserved' || r.status === 'active') && !r.fee_paid_at) actionable++;
    });
    // Stavy, kde je na řadě ZÁKAZNÍK (má podepsat).
    const CUST_ACTION = ['odeslano', 'vyplneno', 'k_podpisu_zakaznik'];
    contractRows.forEach((c) => {
      const tl = (contracts.TYPE_LABEL && contracts.TYPE_LABEL[c.type]) || 'Smlouva';
      const signed = c.status === 'podepsano';
      const custAct = CUST_ACTION.indexOf(c.status) !== -1;
      // Odkaz k podpisu zpřístupníme jen když je na řadě zákazník (ne během naší autorizace).
      const url = (c.share_token && custAct) ? ('/smlouva/' + c.share_token) : null;
      docs.push({ kind: 'contract', type: c.type, typeLabel: tl, status: c.status, url: url, signed_at: c.signed_at });
      if (signed) { push(c.signed_at || c.updated_at, '✅', `${tl} je podepsaná.`); }
      else if (c.status === 'k_autorizaci') { push(c.updated_at || c.created_at, '⏳', `${tl} se připravuje k podpisu.`); }
      else {
        push(c.updated_at || c.created_at, custAct ? '✍️' : '📄', `${tl} ${CT_STATUS_MSG[c.status] || 'byla aktualizována'}.`);
        if (custAct && c.share_token) actionable++;
      }
    });
    msgs.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    res.json({ ok: true, docs, messages: msgs.slice(0, 40), actionable, count: msgs.length });
  } catch (err) { next(err); }
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

    // 2) parkoviště + okolní podniky + populace v okruhu 15 km (OSM Overpass)
    const [near, pop] = await Promise.all([
      osmNearby(geo.lat, geo.lon),
      populationLookup(geo.lat, geo.lon, 15),
    ]);
    const parking = near.parking, anchors = near.anchors;

    const monthlyCustomers = Math.round(perDay * 30.4);
    const requiredPct = (pop.population > 0) ? (monthlyCustomers / pop.population * 100) : null;
    // U velkého obchodu (do 150 m) nebo s parkovištěm do 30 m je parkování bezprostřední.
    const parkingImmediate = (parking.nearest_m != null && parking.nearest_m <= 30) || (anchors.nearest_retail_m != null && anchors.nearest_retail_m <= 150);
    const reg = regionBenchmark(geo.country_code);

    const facts = {
      address: geo.display_name, lat: geo.lat, lon: geo.lon,
      country: geo.country, country_code: geo.country_code,
      region: reg.region, region_perday_norm: reg.perday,
      parking_count: parking.count, nearest_parking_m: parking.nearest_m, parking_immediate: parkingImmediate,
      population_15km: pop.population, population_source: pop.source || 'OpenStreetMap', places: pop.places.slice(0, 12),
      anchors: anchors.list, anchor_count: anchors.count, nearest_retail_m: anchors.nearest_retail_m,
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

// ─── VEŘEJNÉ: žádost o kontakt (Compounder Portal) ──────────────────────────
// POST /api/compounder/portal/contact-request  { t, phone }
// Uloží telefon k profilu leada a pošle notifikaci majitelům Best Series.
const contactSchema = z.object({
  t: z.string().min(1),
  phone: z.string().trim().min(5).max(40),
  intent: z.enum(['contact', 'distributor']).optional(),
});
router.post('/portal/contact-request', async (req, res, next) => {
  try {
    const parsed = contactSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Zadej platné telefonní číslo.' });
    const leadId = verifyPortalToken(parsed.data.t);
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný přístup.' });
    if (!locRateOk(clientIp(req), leadId)) return res.status(429).json({ ok: false, error: 'Příliš mnoho požadavků. Zkus to prosím za chvíli.' });

    const phone = parsed.data.phone.replace(/[^\d+ ()\/-]/g, '').slice(0, 40);
    const lead = await prisma.compounderLead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, email: true, role: true, notes: true },
    });
    if (!lead) return res.status(404).json({ ok: false, error: 'Účet nenalezen.' });

    const isDist = parsed.data.intent === 'distributor';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const note = '[' + stamp + '] ' + (isDist ? 'Zájem o DISTRIBUCI — kontakt: ' : 'Požádal o telefonický kontakt: ') + phone;
    await prisma.compounderLead.update({
      where: { id: leadId },
      data: { phone: phone, status: 'qualified', notes: lead.notes ? (lead.notes + '\n' + note) : note },
    });

    prisma.compounderEvent.create({ data: {
      sid: 'contact:' + leadId, event: 'contact_request',
      props: { lead_id: leadId, phone: phone, intent: isDist ? 'distributor' : 'contact' }, path: '/portal', ip: clientIp(req),
    } }).catch(() => {});
    notifyOwnersContact(lead, phone, isDist).catch((e) => console.error('[compounder] contact mail:', e && e.message));
    // Velín push + zvonek Janovi & Tomášovi (stejný kanál jako rezervace, nastavitelní příjemci).
    compounderNotify.notifyContactRequest(prisma, { lead, phone, isDist }).catch((e) => console.error('[compounder] contact velín:', e && e.message));
    notifyContactTask(lead, phone, isDist).catch((e) => console.error('[compounder] velín task:', e && e.message));
    console.log('[compounder] Žádost o kontakt: lead #' + leadId);
    return res.json({ ok: true });
  } catch (err) { next(err); }
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
      select: { id: true, name: true, email: true, role: true, lang: true, password_hash: true, source: true, access_approved_at: true },
    });

    // ── Přihlášení HESLEM ──────────────────────────────────────────────────
    if (password) {
      const ok = lead && lead.password_hash && leadAccessAllowed(lead) && await bcrypt.compare(password, lead.password_hash);
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
    if (lead && leadAccessAllowed(lead)) {
      const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
      sendPortalLogin({ name: lead.name, email: lead.email, lang: lead.lang }, url)
        .catch((e) => console.error('[compounder] login e-mail selhal:', e.message));
      console.log(`[compounder] Přihlašovací odkaz odeslán pro lead #${lead.id}`);
    } else if (lead) {
      console.log(`[compounder] Přihlášení blokováno (nepovolený přístup): lead #${lead.id}`);
    } else {
      console.log(`[compounder] Přihlášení – neznámý e-mail: ${email}`);
    }
    // Vždy stejná odpověď (anti-enumeration).
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /portal/login-check — zjistí, zda e-mail patří pozvanému; pokud ano, pošle odkaz.
router.post('/portal/login-check', async (req, res, next) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) return res.status(400).json({ ok: false, error: 'Neplatný e-mail.' });
    const lead = await prisma.compounderLead.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { created_at: 'desc' },
      select: { id: true, name: true, email: true, lang: true, source: true, access_approved_at: true },
    });
    if (!lead) return res.json({ ok: true, exists: false });
    // Nezvaný bez schválení = tváříme se jako neexistující (nedostane odkaz).
    if (!leadAccessAllowed(lead)) return res.json({ ok: true, exists: false, pending: true });
    const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
    sendPortalLogin({ name: lead.name, email: lead.email, lang: lead.lang }, url)
      .catch((e) => console.error('[compounder] login e-mail selhal:', e.message));
    return res.json({ ok: true, exists: true });
  } catch (err) { next(err); }
});

// POST /portal/access-request — nepozvaný žádá o přístup (telefon + zpráva povinné) → lead „nezvaný".
router.post('/portal/access-request', async (req, res, next) => {
  // Samoregistrace je VYPNUTÁ — přístup jen na pozvání od obchodníka.
  // (Tomáš 2026-07-29: nikdo cizí se nesmí přidat sám.) Neutrální odpověď.
  if (process.env.COMPOUNDER_ALLOW_ACCESS_REQUEST !== '1') {
    console.log('[compounder] access-request odmítnut (samoregistrace vypnuta).');
    return res.json({ ok: true });
  }
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim().slice(0, 40);
    const message = String(b.message || '').trim().slice(0, 2000);
    const name = String(b.name || '').trim().slice(0, 255);
    if (!email || email.indexOf('@') === -1) return res.status(400).json({ ok: false, error: 'Neplatný e-mail.' });
    if (!phone) return res.status(400).json({ ok: false, error: 'Zadejte telefon.' });
    if (!message) return res.status(400).json({ ok: false, error: 'Napište důvod žádosti.' });
    if (await _isBlocked(email, phone)) { console.log('[compounder] Žádost o přístup blokována (blocklist): ' + email); return res.json({ ok: true }); }

    const noteText = 'ŽÁDOST O PŘÍSTUP (nezvaný) — ' + new Date().toLocaleString('cs-CZ') + '\nDůvod: ' + message;
    const existing = await prisma.compounderLead.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { created_at: 'desc' }, select: { id: true, notes: true },
    });
    let leadId;
    if (existing) {
      leadId = existing.id;
      await prisma.compounderLead.update({
        where: { id: existing.id },
        data: { phone: phone || undefined, notes: (existing.notes ? (existing.notes + '\n\n') : '') + noteText },
      });
    } else {
      const lead = await prisma.compounderLead.create({
        data: {
          name: name || '(žádost o přístup)',
          email, phone,
          role: 'compounder',
          source: 'access_request',
          status: 'new',
          notes: noteText,
          ip: clientIp(req),
          user_agent: (req.headers['user-agent'] || '').slice(0, 1000) || null,
        },
        select: { id: true },
      });
      leadId = lead.id;
    }
    try {
      const ids = await resolveOwnerUserIds();
      const link = (getAppUrl() || '') + '/modules/prodejni-objednavky/index.html';
      const title = 'Žádost o přístup (nezvaný): ' + email;
      const body = 'E-mail: ' + email + ' • Tel: ' + phone + '\nDůvod: ' + message;
      for (const uid of ids) {
        await createNotification({ userId: uid, type: 'compounder_access_request', title, body, link, forceEmail: true }).catch(() => {});
      }
    } catch (e) { console.error('[access-request notify]', e); }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── VEŘEJNÉ: poptávka nákupu Compounderu (rezervace volného výrobního slotu) ─
// POST /api/compounder/portal/purchase-inquiry
// Zákazník z portálu pošle poptávku (hlavička + počet kiosků + umístění). Uloží se
// jako poznámka + event k leadovi a odejde upozornění majitelům (Velín push+zvonek).
// GET /api/compounder/portal/machines — ceník verzí (V2/V3/V4) pro zákaznický portál
router.get('/portal/machines', async (req, res, next) => {
  try {
    const cs = (await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT })) || {};
    const fx = await fxRatesCzk().catch(() => ({ EUR: 25 }));
    const eur = fx.EUR || 25;
    const pl = cs.pricelist || {};
    const vp = (cs.versionPhotos && typeof cs.versionPhotos === 'object') ? cs.versionPhotos : {};
    const machines = ['v2', 'v3', 'v4'].map((v) => {
      const eurP = (pl[v] && pl[v].eur != null && isFinite(Number(pl[v].eur))) ? Number(pl[v].eur) : null;
      if (eurP == null) return null;
      return { ver: v.toUpperCase(), priceCzk: Math.round(eurP * eur), photo: vp[v] || null };
    }).filter(Boolean);
    res.json({ machines });
  } catch (err) { next(err); }
});

const purchaseSchema = z.object({
  t: z.string().min(3),
  name: z.string().max(255).optional().nullable(),
  ico: z.string().max(20).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  count: z.coerce.number().int().min(1).max(999),
  locations: z.string().trim().min(1).max(2000),
  note: z.string().max(2000).optional().nullable(),
  version: z.string().max(10).optional().nullable(),
});
router.post('/portal/purchase-inquiry', async (req, res, next) => {
  try {
    const parsed = purchaseSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Vyplňte prosím počet kiosků a jejich umístění.' });
    const leadId = verifyPortalToken(parsed.data.t);
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný přístup.' });
    if (!locRateOk(clientIp(req), leadId)) return res.status(429).json({ ok: false, error: 'Příliš mnoho požadavků. Zkus to prosím za chvíli.' });

    const d = parsed.data;
    const phone = d.phone ? d.phone.replace(/[^\d+ ()\/-]/g, '').slice(0, 40) : null;
    const lead = await prisma.compounderLead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, email: true, role: true, notes: true },
    });
    if (!lead) return res.status(404).json({ ok: false, error: 'Účet nenalezen.' });

    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const noteText = '[' + stamp + '] POPTÁVKA NÁKUPU — ' + d.count + '× Compounder' + (d.version ? (' ' + d.version) : '')
      + '\nUmístění: ' + d.locations
      + (d.name ? ('\nHlavička: ' + d.name + (d.ico ? (' · IČO ' + d.ico) : '')) : '')
      + (d.address ? ('\nAdresa: ' + d.address) : '')
      + (phone ? ('\nTel: ' + phone) : '')
      + (d.email ? ('\nE-mail: ' + d.email) : '')
      + (d.note ? ('\nPoznámka: ' + d.note) : '');
    await prisma.compounderLead.update({
      where: { id: leadId },
      data: { phone: phone || undefined, status: 'qualified', notes: lead.notes ? (lead.notes + '\n\n' + noteText) : noteText },
    });

    prisma.compounderEvent.create({ data: {
      sid: 'buy:' + leadId, event: 'purchase_inquiry',
      props: { lead_id: leadId, count: d.count, version: d.version || null, locations: String(d.locations).slice(0, 300), ico: d.ico || null, address: (d.address || '').slice(0, 200) || null, phone: phone, note: (d.note || '').slice(0, 300) || null },
      path: '/portal', ip: clientIp(req),
    } }).catch(() => {});
    compounderNotify.notifyPurchaseInquiry(prisma, { lead, count: d.count, locations: d.locations, phone: phone, version: d.version || null })
      .catch((e) => console.error('[compounder] purchase velín:', e && e.message));
    console.log('[compounder] Poptávka nákupu: lead #' + leadId + ' (' + d.count + ' ks)');
    return res.json({ ok: true });
  } catch (err) { next(err); }
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
router.post('/leads', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 255);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 255);
    const role = (b.role === 'distributor') ? 'distributor' : 'compounder';
    const lang = b.lang ? String(b.lang).trim().toLowerCase().slice(0, 10) : null;
    const phone = b.phone ? String(b.phone).trim().slice(0, 40) : null;
    if (email && email.indexOf('@') === -1) return res.status(400).json({ error: 'Neplatný e-mail' });
    if (!email && !phone) return res.status(400).json({ error: 'Zadej aspoň jeden kontaktní údaj — e-mail nebo telefon.' });
    // Ověření duplicity v DB: shoda na e-mailu, telefonu nebo jménu.
    const dupOr = [];
    if (email) dupOr.push({ email: { equals: email, mode: 'insensitive' } });
    if (phone) dupOr.push({ phone: phone });
    if (name) dupOr.push({ name: { equals: name, mode: 'insensitive' } });
    const existing = dupOr.length ? await prisma.compounderLead.findFirst({
      where: { OR: dupOr },
      select: { id: true, owner_person_id: true, name: true },
    }) : null;
    if (existing) {
      // Zjisti, kdo kontakt spravuje (aby se obchodníci mohli domluvit).
      let owner = null;
      if (existing.owner_person_id) {
        owner = await prisma.person.findUnique({
          where: { id: existing.owner_person_id },
          select: { first_name: true, last_name: true, email: true },
        });
      }
      const ownerName = owner ? ((owner.first_name || '') + ' ' + (owner.last_name || '')).trim() : null;
      return res.status(409).json({
        error: ownerName
          ? ('Tento kontakt už spravuje ' + ownerName + '. Domluv se prosím s ním.')
          : 'Tento kontakt už je v systému (zatím bez přiřazeného obchodníka).',
        id: existing.id,
        owner_person_id: existing.owner_person_id || null,
        owner_name: ownerName,
        owner_email: owner ? owner.email : null,
      });
    }
    if (await _isBlocked(email, phone)) return res.status(409).json({ error: 'Tento kontakt je na seznamu „neoslovovat".' });
    const myPersonId = (req.user && req.user.person) ? req.user.person.id : null;
    const lead = await prisma.compounderLead.create({
      data: {
        name: name || email || phone, email: email || null, role, lang, phone, source: 'admin', status: 'new',
        created_by_person_id: myPersonId,
        owner_person_id: myPersonId, // kdo kontakt založil, ten je i jeho obchodník (lze přepsat)
      },
      select: { id: true, name: true, email: true, role: true, lang: true },
    });
    console.log(`[compounder] Admin vytvořil lead #${lead.id} (${role}, ${lang || '—'}): ${email}`);
    if (b.sendInvite) {
      const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
      sendPortalLogin({ name: lead.name, email: lead.email, lang: lead.lang }, url)
        .catch((e) => console.error('[compounder] pozvánka e-mail selhala:', e.message));
    }
    res.status(201).json({ ok: true, lead });
  } catch (err) { next(err); }
});

// GET /api/compounder/sellers — obchodníci pro přiřazení vlastníka leadu.
//   Aktivní Person s rolí "Obchodník" nebo "Vedoucí obchodu". Dostupné přihlášenému
//   internímu uživateli (na rozdíl od /api/sales/sellers, které je jen pro vedoucí/admin).
router.get('/sellers', requireAuth, async (req, res, next) => {
  try {
    const sellers = await prisma.person.findMany({
      where: { active: true, OR: [{ is_salesperson: true }, { is_sales_lead: true }] },
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
      select: { id: true, first_name: true, last_name: true },
    });
    res.json(sellers);
  } catch (err) { next(err); }
});

// GET /api/compounder/sales-overview — přehled pro vedoucího obchodu (výkon týmu).
router.get('/sales-overview', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    const isMgr = u.isSuperAdmin || u.role === 'admin' || (u.person && u.person.is_sales_lead);
    if (!isMgr) return res.status(403).json({ error: 'Jen vedoucí obchodu nebo admin' });

    const leads = await prisma.compounderLead.findMany({
      where: { is_test: false }, // testovací kontakty do statistik nepočítáme
      select: { id: true, name: true, status: true, owner_person_id: true, created_at: true, updated_at: true },
      orderBy: { updated_at: 'desc' },
      take: 5000,
    });
    const ownerIds = Array.from(new Set(leads.map((l) => l.owner_person_id).filter(Boolean)));
    const persons = ownerIds.length
      ? await prisma.person.findMany({ where: { id: { in: ownerIds } }, select: { id: true, first_name: true, last_name: true } })
      : [];
    const nameById = {};
    persons.forEach((p) => { nameById[p.id] = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || ('#' + p.id); });

    const bySeller = {};
    let unassigned = 0, converted = 0;
    leads.forEach((l) => {
      if (l.status === 'converted') converted++;
      if (!l.owner_person_id) { unassigned++; return; }
      const sid = l.owner_person_id;
      const s = bySeller[sid] || (bySeller[sid] = { id: sid, name: nameById[sid] || ('#' + sid), total: 0, byStatus: { new: 0, contacted: 0, qualified: 0, converted: 0, rejected: 0 }, converted: 0, lastActivityAt: null });
      s.total++;
      if (s.byStatus[l.status] != null) s.byStatus[l.status]++;
      if (l.status === 'converted') s.converted++;
      const t = l.updated_at ? new Date(l.updated_at).getTime() : 0;
      if (t && (!s.lastActivityAt || t > new Date(s.lastActivityAt).getTime())) s.lastActivityAt = l.updated_at;
    });
    const sellers = Object.keys(bySeller).map((k) => {
      const s = bySeller[k];
      s.conversionPct = s.total ? Math.round((s.converted / s.total) * 100) : 0;
      return s;
    }).sort((a, b) => b.total - a.total);

    let resv = [];
    try { resv = await prisma.locationReservation.findMany({ select: { lead_id: true, kiosk_code: true, status: true, reserved_until: true }, orderBy: { created_at: 'desc' }, take: 500 }); } catch (e) { resv = []; }
    const leadById = {}; leads.forEach((l) => { leadById[l.id] = l; });
    const resvByStatus = {};
    const resvItems = resv.map((r) => {
      resvByStatus[r.status] = (resvByStatus[r.status] || 0) + 1;
      const lead = leadById[r.lead_id];
      return { kiosk_code: r.kiosk_code, status: r.status, reserved_until: r.reserved_until, lead_name: lead ? lead.name : null, owner_name: (lead && lead.owner_person_id) ? (nameById[lead.owner_person_id] || null) : null };
    });

    const recent = leads.slice(0, 15).map((l) => ({ lead_id: l.id, name: l.name, status: l.status, owner_name: l.owner_person_id ? (nameById[l.owner_person_id] || null) : null, updated_at: l.updated_at }));

    // Dnes aktivní leady (bez testovacích @bestseries.cz) — stejná logika jako denní hodnocení.
    let activeToday = [];
    try { const dg = await digestWorker.computeDigest(); activeToday = (dg && dg.perLead) || []; } catch (e) { activeToday = []; }

    res.json({
      ok: true,
      totals: { leads: leads.length, converted, conversionPct: leads.length ? Math.round((converted / leads.length) * 100) : 0, unassigned },
      sellers,
      reservations: { total: resv.length, byStatus: resvByStatus, items: resvItems.slice(0, 50) },
      recent,
      activeToday,
    });
  } catch (err) { next(err); }
});

// ─── Osobní prodejní plán ────────────────────────────────────────────────
const PLAN_METRICS = [
  { key: 'new_contacts', label: 'Nové kontakty' },
  { key: 'conversions', label: 'Převedené' },
  { key: 'reservations', label: 'Rezervace' },
  { key: 'revenue', label: 'Obrat (Kč)' },
];
const PLAN_PERIODS = ['day', 'week', 'month', 'year'];

function planPeriodStart(period) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  if (period === 'week') { const wd = (d.getDay() + 6) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd); }
  if (period === 'month') return new Date(n.getFullYear(), n.getMonth(), 1);
  if (period === 'year') return new Date(n.getFullYear(), 0, 1);
  return d;
}

async function computePlanActuals(personId) {
  const leads = await prisma.compounderLead.findMany({
    where: { owner_person_id: personId, is_test: false },
    select: { id: true, status: true, created_at: true, updated_at: true },
    take: 10000,
  });
  const leadIds = leads.map((l) => l.id);
  let resv = [];
  if (leadIds.length) {
    try { resv = await prisma.locationReservation.findMany({ where: { lead_id: { in: leadIds } }, select: { created_at: true, purchase_price: true } }); } catch (e) { resv = []; }
  }
  const out = { new_contacts: {}, conversions: {}, reservations: {}, revenue: {} };
  PLAN_PERIODS.forEach((p) => {
    const from = planPeriodStart(p).getTime();
    out.new_contacts[p] = leads.filter((l) => l.created_at && new Date(l.created_at).getTime() >= from).length;
    out.conversions[p] = leads.filter((l) => l.status === 'converted' && l.updated_at && new Date(l.updated_at).getTime() >= from).length;
    const rIn = resv.filter((r) => r.created_at && new Date(r.created_at).getTime() >= from);
    out.reservations[p] = rIn.length;
    out.revenue[p] = rIn.reduce((s, r) => s + (r.purchase_price || 0), 0);
  });
  return out;
}

// GET /api/compounder/my-plan?person_id= — cíle + skutečnost. person_id jen pro vedoucí/admin.
router.get('/my-plan', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    const isMgr = u.isSuperAdmin || u.role === 'admin' || (u.person && u.person.is_sales_lead);
    let personId = (u.person && u.person.id) || null;
    if (req.query.person_id && isMgr) personId = Number(req.query.person_id);
    if (!personId) return res.json({ ok: true, metrics: PLAN_METRICS, periods: PLAN_PERIODS, data: {} });
    const targetsRows = await prisma.salesTarget.findMany({ where: { person_id: personId } });
    const targets = {};
    targetsRows.forEach((t) => { (targets[t.metric] || (targets[t.metric] = {}))[t.period] = t.value; });
    const actuals = await computePlanActuals(personId);
    const data = {};
    PLAN_METRICS.forEach((m) => {
      data[m.key] = {};
      PLAN_PERIODS.forEach((p) => {
        data[m.key][p] = { actual: (actuals[m.key] && actuals[m.key][p]) || 0, target: (targets[m.key] && targets[m.key][p]) || 0 };
      });
    });
    res.json({ ok: true, person_id: personId, metrics: PLAN_METRICS, periods: PLAN_PERIODS, data });
  } catch (err) { next(err); }
});

// POST /api/compounder/sales-targets {person_id, metric, period, value} — nastaví cíl (vedoucí/admin).
router.post('/sales-targets', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    const isMgr = u.isSuperAdmin || u.role === 'admin' || (u.person && u.person.is_sales_lead);
    if (!isMgr) return res.status(403).json({ error: 'Jen vedoucí obchodu nebo admin' });
    const b = req.body || {};
    const person_id = Number(b.person_id);
    const metric = String(b.metric || '');
    const period = String(b.period || '');
    const value = Math.max(0, Math.round(Number(b.value) || 0));
    if (!Number.isInteger(person_id)) return res.status(400).json({ error: 'Neplatné person_id' });
    if (!PLAN_METRICS.some((m) => m.key === metric)) return res.status(400).json({ error: 'Neplatná metrika' });
    if (PLAN_PERIODS.indexOf(period) === -1) return res.status(400).json({ error: 'Neplatná perioda' });
    const row = await prisma.salesTarget.upsert({
      where: { person_id_metric_period: { person_id, metric, period } },
      update: { value },
      create: { person_id, metric, period, value },
    });
    res.json({ ok: true, id: row.id, value: row.value });
  } catch (err) { next(err); }
});

// ─── Notifikace obchodníka (do Velína) ──────────────────────────────────────
const NOTIFY_DEFAULTS = { new_contact: true, contact_activity: true, invite_unopened: true };
async function getNotifyPrefs(personId) {
  const v = await getSetting('sales_notify.' + personId, { type: 'json', defaultValue: null }).catch(() => null);
  return Object.assign({}, NOTIFY_DEFAULTS, v || {});
}
function notifySalesperson(personId, payload) {
  try {
    const { notifyPerson } = require('../services/push/expo-push');
    notifyPerson(prisma, personId, payload);
  } catch (e) { /* push nesmí shodit operaci */ }
}

// GET /api/compounder/my-notify-settings — notifikační předvolby přihlášeného obchodníka.
router.get('/my-notify-settings', requireAuth, async (req, res, next) => {
  try {
    const pid = req.user && req.user.person && req.user.person.id;
    res.json({ ok: true, prefs: pid ? await getNotifyPrefs(pid) : NOTIFY_DEFAULTS });
  } catch (err) { next(err); }
});
// POST /api/compounder/my-notify-settings {new_contact, contact_activity, invite_unopened}
router.post('/my-notify-settings', requireAuth, async (req, res, next) => {
  try {
    const pid = req.user && req.user.person && req.user.person.id;
    if (!pid) return res.status(400).json({ error: 'Uživatel nemá přiřazenou osobu' });
    const b = req.body || {};
    const prefs = { new_contact: !!b.new_contact, contact_activity: !!b.contact_activity, invite_unopened: !!b.invite_unopened };
    await setSetting('sales_notify.' + pid, prefs);
    res.json({ ok: true, prefs });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTONOMNÍ AI VEDOUCÍ OBCHODU — denní úkoly, hodnocení, výplatní podklad
// ═══════════════════════════════════════════════════════════════════════════
function salesIsMgr(u) {
  u = u || {};
  return !!(u.isSuperAdmin || u.role === 'admin' || (u.person && u.person.is_sales_lead));
}
function salesMyPersonId(req) { return (req.user && req.user.person && req.user.person.id) || null; }
function todayStr() { return salesMgr.tzTodayStr(); }

async function loadDayPlan(personId, dateStr) {
  const date = new Date((dateStr || todayStr()) + 'T00:00:00Z');
  const plan = await prisma.salesDayPlan.findUnique({
    where: { person_id_date: { person_id: personId, date } },
    include: { tasks: { orderBy: [{ status: 'asc' }, { priority: 'asc' }, { id: 'asc' }] } },
  });
  return plan;
}

// GET /api/compounder/my-day?date=&person_id= — dnešní plán + úkoly.
// person_id smí zadat jen vedoucí/admin. generate=1 vytvoří plán, pokud chybí.
// Živý postup kvótových úkolů podle reálné aktivity v systému (jen zobrazení,
// úkol se NEuzavírá automaticky). Počítá se za daný den a jen aktivita obchodníka:
//   prospecting = nové kontakty, které obchodník sám založil (ne přidělené firmou)
//   meeting     = schůzky domluvené (vytvořené) dnes
//   call        = hovory zaznamenané přes tlačítko (SiteCommunication channel='call')
async function attachTaskProgress(plan, personId, dateStr) {
  if (!plan || !Array.isArray(plan.tasks) || !plan.tasks.length) return;
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(start.getTime() + 86400000);
  const [newContacts, meetings, calls] = await Promise.all([
    prisma.compounderLead.count({ where: { created_by_person_id: personId, is_test: false, created_at: { gte: start, lt: end } } }).catch(() => 0),
    prisma.salesEvent.count({ where: { organizer_id: personId, created_at: { gte: start, lt: end } } }).catch(() => 0),
    prisma.siteCommunication.count({ where: { author_id: personId, channel: 'call', occurred_at: { gte: start, lt: end } } }).catch(() => 0),
  ]);
  const actualByKind = { prospecting: newContacts, meeting: meetings, call: calls };
  plan.tasks.forEach((t) => {
    const actual = actualByKind[t.kind];
    if (actual === undefined) return;
    const m = String(t.title || '').match(/\d+/); // cílové číslo z názvu úkolu ("Oslov 12 nových…")
    const target = m ? Number(m[0]) : null;
    if (!target) return;
    t.progress = { actual, target, metric: t.kind };
  });
}

router.get('/my-day', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    let personId = salesMyPersonId(req);
    if (req.query.person_id && salesIsMgr(u)) personId = Number(req.query.person_id);
    if (!personId) return res.status(400).json({ error: 'Uživatel nemá přiřazenou osobu' });
    const dateStr = String(req.query.date || todayStr()).slice(0, 10);
    let plan = await loadDayPlan(personId, dateStr);
    if (!plan && req.query.generate === '1') {
      await salesMgr.planDay(personId, dateStr, {});
      plan = await loadDayPlan(personId, dateStr);
    }
    const dayReview = await prisma.salesReview.findUnique({ where: { person_id_kind_period_start: { person_id: personId, kind: 'day', period_start: new Date(dateStr + 'T00:00:00Z') } } }).catch(() => null);
    // Hodnocení včerejšího dne (obchodník ho chce vidět i tady).
    const prevStr = new Date(new Date(dateStr + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    const prevDayReview = await prisma.salesReview.findUnique({ where: { person_id_kind_period_start: { person_id: personId, kind: 'day', period_start: new Date(prevStr + 'T00:00:00Z') } } }).catch(() => null);
    if (plan) await attachTaskProgress(plan, personId, dateStr).catch(() => {});
    res.json({ ok: true, person_id: personId, date: dateStr, plan: plan || null, review: dayReview || null, prevDayReview: prevDayReview || null, prevDayDate: prevStr });
  } catch (err) { next(err); }
});

// POST /api/compounder/tasks/:id/done {note}
router.post('/tasks/:id/done', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const task = await prisma.salesTask.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    if (task.person_id !== salesMyPersonId(req) && !salesIsMgr(req.user)) return res.status(403).json({ error: 'Není váš úkol' });
    const note = req.body && req.body.note ? String(req.body.note).slice(0, 1000) : null;
    const upd = await prisma.salesTask.update({ where: { id }, data: { status: 'done', done_at: new Date(), done_note: note } });
    res.json({ ok: true, task: upd });
  } catch (err) { next(err); }
});

// POST /api/compounder/tasks/:id/skip {reason}
router.post('/tasks/:id/skip', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const task = await prisma.salesTask.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    if (task.person_id !== salesMyPersonId(req) && !salesIsMgr(req.user)) return res.status(403).json({ error: 'Není váš úkol' });
    const reason = req.body && req.body.reason ? String(req.body.reason).slice(0, 1000).trim() : '';
    if (!reason) return res.status(400).json({ error: 'Uveď důvod přeskočení.' });
    const upd = await prisma.salesTask.update({ where: { id }, data: { status: 'skipped', skipped_reason: reason } });
    // Uvolněný čas nesmí propadnout: AI dogeneruje náhradní úkol(y) na stejný čas
    // (zohlední důvod). Fond dne zkrátí jen dovolená/lékař → tehdy se nedoplňuje.
    let replacement = null;
    try { replacement = await salesMgr.replaceSkippedTask(upd); } catch (e) { replacement = null; }
    res.json({ ok: true, task: upd, replacement });
  } catch (err) { next(err); }
});

// POST /api/compounder/tasks/:id/reopen — vrátí úkol do open.
router.post('/tasks/:id/reopen', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const task = await prisma.salesTask.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Úkol nenalezen' });
    if (task.person_id !== salesMyPersonId(req) && !salesIsMgr(req.user)) return res.status(403).json({ error: 'Není váš úkol' });
    const upd = await prisma.salesTask.update({ where: { id }, data: { status: 'open', done_at: null, done_note: null, skipped_reason: null } });
    res.json({ ok: true, task: upd });
  } catch (err) { next(err); }
});

// POST /api/compounder/tasks {title, detail, kind, priority, lead_id, date} — ruční úkol (self/manager).
router.post('/tasks', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    let personId = salesMyPersonId(req);
    const b = req.body || {};
    if (b.person_id && salesIsMgr(u)) personId = Number(b.person_id);
    if (!personId) return res.status(400).json({ error: 'Uživatel nemá přiřazenou osobu' });
    const title = String(b.title || '').trim().slice(0, 480);
    if (!title) return res.status(400).json({ error: 'Chybí název úkolu' });
    const dateStr = String(b.date || todayStr()).slice(0, 10);
    const date = new Date(dateStr + 'T00:00:00Z');
    const plan = await prisma.salesDayPlan.upsert({
      where: { person_id_date: { person_id: personId, date } },
      create: { person_id: personId, date, generated_by: salesIsMgr(u) && Number(b.person_id) === personId ? 'manager' : 'self', status: 'published' },
      update: {},
    });
    const kinds = ['call', 'followup', 'invite', 'close', 'reservation', 'meeting', 'admin', 'other'];
    const task = await prisma.salesTask.create({
      data: {
        day_plan_id: plan.id, person_id: personId,
        lead_id: Number.isInteger(Number(b.lead_id)) && Number(b.lead_id) > 0 ? Number(b.lead_id) : null,
        kind: kinds.indexOf(String(b.kind)) >= 0 ? String(b.kind) : 'other',
        title, detail: b.detail ? String(b.detail).slice(0, 1000) : null,
        priority: Math.max(1, Math.min(5, Math.round(Number(b.priority) || 3))),
        status: 'open',
      },
    });
    res.json({ ok: true, task });
  } catch (err) { next(err); }
});

// GET /api/compounder/my-reviews?kind=day|week|month&limit=&person_id=
router.get('/my-reviews', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    let personId = salesMyPersonId(req);
    if (req.query.person_id && salesIsMgr(u)) personId = Number(req.query.person_id);
    if (!personId) return res.status(400).json({ error: 'Uživatel nemá přiřazenou osobu' });
    const kind = ['day', 'week', 'month'].indexOf(String(req.query.kind)) >= 0 ? String(req.query.kind) : null;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 14));
    const where = { person_id: personId };
    if (kind) where.kind = kind;
    const rows = await prisma.salesReview.findMany({ where, orderBy: { period_start: 'desc' }, take: limit });
    res.json({ ok: true, person_id: personId, reviews: rows });
  } catch (err) { next(err); }
});

// ─── Vedoucí / admin ─────────────────────────────────────────────────────────
// POST /api/compounder/sales/generate-day {person_id?, date?, force?}
router.post('/sales/generate-day', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    const b = req.body || {};
    let personId = salesMyPersonId(req);
    if (b.person_id && salesIsMgr(u)) personId = Number(b.person_id);
    if (!personId) return res.status(400).json({ error: 'Chybí person_id' });
    if (personId !== salesMyPersonId(req) && !salesIsMgr(u)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const dateStr = String(b.date || todayStr()).slice(0, 10);
    const r = await salesMgr.planDay(personId, dateStr, { force: !!b.force });
    res.json({ ok: true, created: r.created, skipped: r.skipped, plan: r.plan });
  } catch (err) { next(err); }
});

// POST /api/compounder/sales/generate-team {date?, force?} — rozdá denní plán VŠEM obchodníkům (vedoucí/admin).
router.post('/sales/generate-team', requireAuth, async (req, res, next) => {
  try {
    if (!salesIsMgr(req.user)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const b = req.body || {};
    const dateStr = String(b.date || todayStr()).slice(0, 10);
    const worker = require('../services/sales/sales-manager-worker');
    const out = await worker.runMorning(dateStr, { force: !!b.force });
    res.json({ ok: true, planned: out.planned, detail: out.detail || [] });
  } catch (err) { next(err); }
});

// POST /api/compounder/sales/review-day {person_id?, date?}
router.post('/sales/review-day', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    const b = req.body || {};
    let personId = salesMyPersonId(req);
    if (b.person_id && salesIsMgr(u)) personId = Number(b.person_id);
    if (!personId) return res.status(400).json({ error: 'Chybí person_id' });
    if (personId !== salesMyPersonId(req) && !salesIsMgr(u)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const dateStr = String(b.date || todayStr()).slice(0, 10);
    const review = await salesMgr.reviewDay(personId, dateStr);
    res.json({ ok: true, review });
  } catch (err) { next(err); }
});

// POST /api/compounder/sales/review-period {person_id, kind, date?} — jen vedoucí/admin.
router.post('/sales/review-period', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    if (!salesIsMgr(u)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const b = req.body || {};
    const personId = Number(b.person_id);
    const kind = ['week', 'month'].indexOf(String(b.kind)) >= 0 ? String(b.kind) : null;
    if (!Number.isInteger(personId) || !kind) return res.status(400).json({ error: 'Chybí person_id nebo kind (week|month)' });
    const dateStr = String(b.date || todayStr()).slice(0, 10);
    const review = await salesMgr.reviewPeriod(personId, kind, dateStr);
    res.json({ ok: true, review });
  } catch (err) { next(err); }
});

// GET /api/compounder/sales/team-day?date= — přehled dne za celý tým (vedoucí/admin).
router.get('/sales/team-day', requireAuth, async (req, res, next) => {
  try {
    if (!salesIsMgr(req.user)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const dateStr = String(req.query.date || todayStr()).slice(0, 10);
    const report = await salesMgr.buildOwnerReport(dateStr);
    res.json({ ok: true, ...report });
  } catch (err) { next(err); }
});

// GET /api/compounder/sales/reviews?kind=month&period_start= — hodnocení celého týmu (vedoucí/admin).
router.get('/sales/reviews', requireAuth, async (req, res, next) => {
  try {
    if (!salesIsMgr(req.user)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const kind = ['day', 'week', 'month'].indexOf(String(req.query.kind)) >= 0 ? String(req.query.kind) : 'month';
    const where = { kind };
    if (req.query.period_start) where.period_start = new Date(String(req.query.period_start).slice(0, 10) + 'T00:00:00Z');
    const rows = await prisma.salesReview.findMany({ where, orderBy: [{ period_start: 'desc' }, { person_id: 'asc' }], take: 200 });
    const pids = [...new Set(rows.map((r) => r.person_id))];
    const people = pids.length ? await prisma.person.findMany({ where: { id: { in: pids } }, select: { id: true, first_name: true, last_name: true } }) : [];
    const nameById = {}; people.forEach((p) => { nameById[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
    res.json({ ok: true, kind, reviews: rows.map((r) => ({ ...r, person_name: nameById[r.person_id] || ('#' + r.person_id) })) });
  } catch (err) { next(err); }
});

// POST /api/compounder/sales/reviews/:id/approve {approved_total, approved_note} — schválení výplaty (vedoucí/admin).
router.post('/sales/reviews/:id/approve', requireAuth, async (req, res, next) => {
  try {
    const u = req.user || {};
    if (!salesIsMgr(u)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const b = req.body || {};
    const approvedTotal = (b.approved_total == null || b.approved_total === '') ? null : Math.round(Number(b.approved_total));
    const upd = await prisma.salesReview.update({
      where: { id },
      data: { approved_at: new Date(), approved_by_person_id: salesMyPersonId(req), approved_total: approvedTotal, approved_note: b.approved_note ? String(b.approved_note).slice(0, 1200) : null },
    });
    res.json({ ok: true, review: upd });
  } catch (err) { next(err); }
});

// POST /api/compounder/sales/owner-report {date} — ruční odeslání denního reportu majitelům (vedoucí/admin).
router.post('/sales/owner-report', requireAuth, async (req, res, next) => {
  try {
    if (!salesIsMgr(req.user)) return res.status(403).json({ error: 'Jen vedoucí/admin' });
    const dateStr = String((req.body && req.body.date) || todayStr()).slice(0, 10);
    const out = await salesMgr.reportToOwners(dateStr);
    res.json({ ok: true, title: out.title, body: out.body });
  } catch (err) { next(err); }
});

// POST /api/compounder/leads/:id/send-access — pošle leadovi přihlašovací odkaz na portál.
router.post('/leads/:id/send-access', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const lead = await prisma.compounderLead.findUnique({
      where: { id }, select: { id: true, name: true, email: true, lang: true },
    });
    if (!lead) return res.status(404).json({ error: 'Lead nenalezen' });
    if (!lead.email) return res.status(400).json({ error: 'Kontakt nemá e-mail — přístup nelze odeslat.' });
    const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
    await sendPortalLogin({ name: lead.name, email: lead.email, lang: lead.lang }, url);
    const updated = await prisma.compounderLead.update({
      where: { id },
      data: { access_sent_count: { increment: 1 }, access_last_sent_at: new Date() },
      select: { access_sent_count: true, access_last_sent_at: true },
    });
    console.log(`[compounder] Přístup (odkaz) odeslán: lead #${id} (${updated.access_sent_count}×)`);
    res.json({ ok: true, access_sent_count: updated.access_sent_count, access_last_sent_at: updated.access_last_sent_at });
  } catch (err) { next(err); }
});

// POST /api/compounder/leads/:id/access-link — vrátí přihlašovací odkaz + text pro WhatsApp
// (neposílá e-mail; obchodník odkaz odešle přes WhatsApp). Počítá se jako odeslání přístupu.
const WA_MSG = {
  cs: (n, u) => `Dobrý den${n ? ', ' + n : ''}, zde je Váš osobní přístup do Compounder Portalu (platí 24 h): ${u}`,
  sk: (n, u) => `Dobrý deň${n ? ', ' + n : ''}, tu je Váš osobný prístup do Compounder Portálu (platí 24 h): ${u}`,
  en: (n, u) => `Hello${n ? ' ' + n : ''}, here is your personal access to the Compounder Portal (valid 24 h): ${u}`,
  de: (n, u) => `Hallo${n ? ' ' + n : ''}, hier ist Ihr persönlicher Zugang zum Compounder Portal (24 h gültig): ${u}`,
  pl: (n, u) => `Dzień dobry${n ? ', ' + n : ''}, oto Twój osobisty dostęp do Compounder Portal (ważny 24 h): ${u}`,
};
router.post('/leads/:id/access-link', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const lead = await prisma.compounderLead.findUnique({
      where: { id }, select: { id: true, name: true, phone: true, lang: true },
    });
    if (!lead) return res.status(404).json({ error: 'Lead nenalezen' });
    if (!lead.phone) return res.status(400).json({ error: 'Kontakt nemá telefon — WhatsApp nelze použít.' });
    const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
    const code = String(lead.lang || 'cs').toLowerCase().split(/[-_]/)[0];
    const msgFn = WA_MSG[code] || WA_MSG.cs;
    const message = msgFn(lead.name || '', url);
    // Telefon → jen číslice (wa.me formát), odstraň +, mezery, 00 prefix.
    let wa = String(lead.phone).replace(/[^\d]/g, '');
    if (wa.startsWith('00')) wa = wa.slice(2);
    const updated = await prisma.compounderLead.update({
      where: { id },
      data: { access_sent_count: { increment: 1 }, access_last_sent_at: new Date() },
      select: { access_sent_count: true, access_last_sent_at: true },
    });
    res.json({ ok: true, url, phone: wa, message, access_sent_count: updated.access_sent_count, access_last_sent_at: updated.access_last_sent_at });
  } catch (err) { next(err); }
});

// POST /api/compounder/leads/:id/activity-log — přidá řádek do append-only logu aktivit.
router.post('/leads/:id/activity-log', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const line = String((req.body && req.body.line) || '').trim().slice(0, 2000);
    if (!line) return res.status(400).json({ error: 'Prázdná aktivita' });
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { activity_log: true } });
    if (!lead) return res.status(404).json({ error: 'Lead nenalezen' });
    const updated = lead.activity_log ? (line + '\n' + lead.activity_log) : line;
    await prisma.compounderLead.update({ where: { id }, data: { activity_log: updated } });
    res.json({ ok: true, activity_log: updated });
  } catch (err) { next(err); }
});

// Pozn.: /leads/:id/reservations je definována níže (vrací {reservations, contracts}).
// Starší duplicitní verze (vracela holé pole) odstraněna — stínila správnou routu.

// GET /api/compounder/my-leads — kontakty přiřazené přihlášenému obchodníkovi.
//   Používá obrazovka obchodníka (modules/obchodnik). Vrací jen vlastní kontakty.
router.get('/my-leads', requireAuth, async (req, res, next) => {
  try {
    const meId = (req.user && req.user.person) ? req.user.person.id : null;
    if (!meId) return res.json([]);
    const where = { owner_person_id: meId, is_test: false };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.search) {
      const q = String(req.query.search);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    const leads = await prisma.compounderLead.findMany({
      where, orderBy: { created_at: 'desc' }, take: 500,
    });
    await enrichWarmth(leads);
    res.json(leads);
  } catch (err) { next(err); }
});

// Doplní leads o warmthPct, lastActivityAt, requestedContact, hasPhone (z eventů).
async function enrichWarmth(leads) {
  if (!leads.length || leads.length > 200) return;
  const ids = leads.map((l) => l.id);
  const evs = await prisma.compounderEvent.findMany({
    where: { OR: ids.map((id) => ({ props: { path: ['lead_id'], equals: id } })) },
    select: { event: true, props: true, created_at: true },
    take: 20000,
  });
  const c = {}; const last = {};
  evs.forEach((e) => {
    const lid = e.props && e.props.lead_id; if (lid == null) return;
    const x = c[lid] || (c[lid] = { portal: 0, doc: 0, loc: 0, contact: 0 });
    if (e.event === 'portal_view') x.portal++;
    else if (e.event === 'doc_download') x.doc++;
    else if (e.event === 'location_assess') x.loc++;
    else if (e.event === 'contact_request') x.contact++;
    const t = e.created_at ? new Date(e.created_at).getTime() : 0;
    if (t && (!last[lid] || t > last[lid])) last[lid] = t;
  });
  leads.forEach((l) => {
    const x = c[l.id] || { portal: 0, doc: 0, loc: 0, contact: 0 };
    l.lastActivityAt = last[l.id] ? new Date(last[l.id]).toISOString() : null;
    let s = 10;
    if (x.portal > 0) s += 15;
    if (x.doc > 0) s += 10;
    if (x.loc > 0) s += 15; if (x.loc >= 3) s += 5;
    const requested = x.contact > 0 || /Požádal o telefonický kontakt/.test(l.notes || '');
    if (requested) s += 40;
    if (l.status === 'qualified' || l.status === 'converted') s += 10;
    l.warmthPct = Math.max(0, Math.min(100, s));
    l.requestedContact = requested;
    l.hasPhone = !!l.phone;
    l.portalOpened = x.portal > 0;
  });
}

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
    // Levná míra zahřátí z eventů otagovaných lead_id (bez AI) — pro rozumný počet leadů.
    if (leads.length && leads.length <= 200) {
      const ids = leads.map((l) => l.id);
      const evs = await prisma.compounderEvent.findMany({
        where: { OR: ids.map((id) => ({ props: { path: ['lead_id'], equals: id } })) },
        select: { event: true, props: true, created_at: true },
        take: 20000,
      });
      const c = {};
      const last = {}; // poslední aktivita (max created_at) na leada
      evs.forEach((e) => {
        const lid = e.props && e.props.lead_id; if (lid == null) return;
        const x = c[lid] || (c[lid] = { portal: 0, doc: 0, loc: 0, contact: 0 });
        if (e.event === 'portal_view') x.portal++;
        else if (e.event === 'doc_download') x.doc++;
        else if (e.event === 'location_assess') x.loc++;
        else if (e.event === 'contact_request') x.contact++;
        const t = e.created_at ? new Date(e.created_at).getTime() : 0;
        if (t && (!last[lid] || t > last[lid])) last[lid] = t;
      });
      leads.forEach((l) => {
        const x = c[l.id] || { portal: 0, doc: 0, loc: 0, contact: 0 };
        l.lastActivityAt = last[l.id] ? new Date(last[l.id]).toISOString() : null;
        let s = 10;
        if (x.portal > 0) s += 15;
        if (x.doc > 0) s += 10;
        if (x.loc > 0) s += 15; if (x.loc >= 3) s += 5;
        const requested = x.contact > 0 || /Požádal o telefonický kontakt/.test(l.notes || '');
        if (requested) s += 40;
        if (l.status === 'qualified' || l.status === 'converted') s += 10;
        l.warmthPct = Math.max(0, Math.min(100, s));
        l.requestedContact = requested;
        l.hasPhone = !!l.phone;
      });
    }
    // Dohledej jména přiřazených obchodníků (owner) — jedním dotazem.
    const ownerIds = Array.from(new Set(leads.map((l) => l.owner_person_id).filter(Boolean)));
    if (ownerIds.length) {
      const owners = await prisma.person.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, first_name: true, last_name: true },
      });
      const nameById = {};
      owners.forEach((p) => { nameById[p.id] = ((p.first_name || '') + ' ' + (p.last_name || '')).trim(); });
      leads.forEach((l) => { l.owner_name = l.owner_person_id ? (nameById[l.owner_person_id] || null) : null; });
    }
    // Dohledej jména externích obchodníků (kdo lead založil) — pro odznak v seznamu.
    if (leads.some((l) => l.external_rep_id)) {
      try {
        const reps = await _loadExternalReps();
        const repById = {}; reps.forEach((r) => { repById[Number(r.id)] = r.jmeno || (r.email || ('#' + r.id)); });
        leads.forEach((l) => { l.external_rep_name = l.external_rep_id ? (repById[Number(l.external_rep_id)] || null) : null; });
      } catch (e) { /* AppSetting nemusí existovat */ }
    }
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/compounder/leads/:id — změna stavu / poznámky
const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'rejected']).optional(),
  notes: z.string().max(5000).optional().nullable(),
  lang: z.string().trim().max(10).optional().nullable(),
  owner_person_id: z.number().int().positive().optional().nullable(),
  external_rep_id: z.number().int().positive().optional().nullable(),
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().max(255).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  // Viditelné sekce portálu: pole klíčů skupin nebo CSV. [] => jen úvodní filozofie.
  sections: z.union([z.array(z.string()), z.string()]).optional(),
  // Zpřístupněné vzory smluv (mustry): pole/CSV typů rezervacni,kupni,servisni.
  templates: z.union([z.array(z.string()), z.string()]).optional(),
  // Individuální nabídka lokalit navíc (pole/CSV kódů kiosků).
  extraOffers: z.union([z.array(z.string()), z.string()]).optional(),
  // Zda zákazník v portálu (Investor) vidí statistiky tržeb lokalit.
  showRevenueStats: z.boolean().optional(),
  // Testovací kontakt — vyřazuje lead ze statistik obchodníka.
  isTest: z.boolean().optional(),
  // Zpřístupnění sekce „Příklad" (skládačka portfolia) v portálu jen tomuto leadu.
  showExample: z.boolean().optional(),
});

router.patch('/leads/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data', detail: parsed.error.flatten() });
    const data = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.lang !== undefined) {
      data.lang = parsed.data.lang ? String(parsed.data.lang).toLowerCase().split(/[-_]/)[0].slice(0, 10) : null;
    }
    if (parsed.data.owner_person_id !== undefined) data.owner_person_id = parsed.data.owner_person_id;
    if (parsed.data.external_rep_id !== undefined) {
      data.external_rep_id = parsed.data.external_rep_id;
      if (parsed.data.external_rep_id) data.owner_person_id = null; // externí a interní obchodník se vylučují
    }
    if (parsed.data.owner_person_id) data.external_rep_id = null;
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.email !== undefined) {
      const em = parsed.data.email ? String(parsed.data.email).trim().toLowerCase() : '';
      if (em && em.indexOf('@') === -1) return res.status(400).json({ error: 'Neplatný e-mail' });
      data.email = em || null;
    }
    if (parsed.data.phone !== undefined) data.phone = parsed.data.phone ? String(parsed.data.phone).trim() : null;
    if (parsed.data.sections !== undefined) {
      const arr = Array.isArray(parsed.data.sections)
        ? parsed.data.sections
        : String(parsed.data.sections).split(',');
      const clean = arr.map((s) => String(s).trim()).filter((s) => SECTION_GROUPS.includes(s));
      data.visible_sections = clean.length ? Array.from(new Set(clean)).join(',') : '';
    }
    if (parsed.data.templates !== undefined) {
      const arr = Array.isArray(parsed.data.templates) ? parsed.data.templates : String(parsed.data.templates).split(',');
      const valid = ['rezervacni', 'kupni', 'servisni'];
      const clean = arr.map((s) => String(s).trim()).filter((s) => valid.includes(s));
      data.visible_templates = clean.length ? Array.from(new Set(clean)).join(',') : '';
    }
    if (parsed.data.extraOffers !== undefined) {
      const arr = Array.isArray(parsed.data.extraOffers) ? parsed.data.extraOffers : String(parsed.data.extraOffers).split(',');
      const clean = arr.map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 50);
      data.extra_offers = clean.length ? Array.from(new Set(clean)).join(',') : '';
    }
    if (parsed.data.showRevenueStats !== undefined) data.show_revenue_stats = !!parsed.data.showRevenueStats;
    if (parsed.data.isTest !== undefined) data.is_test = !!parsed.data.isTest;
    if (parsed.data.showExample !== undefined) data.show_example = !!parsed.data.showExample;
    const lead = await prisma.compounderLead.update({ where: { id }, data });
    // Notifikace: nový přidělený kontakt (jinému obchodníkovi než ten, kdo přiřazuje).
    if (parsed.data.owner_person_id) {
      const actorPid = (req.user && req.user.person) ? req.user.person.id : null;
      const newOwner = parsed.data.owner_person_id;
      if (newOwner !== actorPid) {
        getNotifyPrefs(newOwner).then((pr) => {
          if (pr.new_contact) notifySalesperson(newOwner, { title: 'Nový přidělený kontakt', body: (lead.name || 'Kontakt') + ' byl přiřazen tobě.', data: { type: 'lead_assigned', lead_id: id } });
        }).catch(() => {});
      }
    }
    res.json(lead);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Lead nenalezen' });
    next(err);
  }
});

// POST /api/compounder/leads/:id/access — povolení / odebrání přístupu k portálu.
// Při povolení (approved=true) nastaví access_approved_at a pošle leadovi uvítací
// odkaz do portálu. Při odebrání (approved=false) přístup zruší (portál i login).
router.post('/leads/:id/access', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const approved = !!(req.body && req.body.approved);
    const lead = await prisma.compounderLead.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, lang: true, access_approved_at: true },
    });
    if (!lead) return res.status(404).json({ error: 'Lead nenalezen' });

    if (!approved) {
      await prisma.compounderLead.update({ where: { id }, data: { access_approved_at: null } });
      console.log(`[compounder] Přístup ODEBRÁN: lead #${id}`);
      return res.json({ ok: true, approved: false });
    }

    await prisma.compounderLead.update({
      where: { id },
      data: { access_approved_at: lead.access_approved_at || new Date(), status: 'qualified' },
    });
    // Uvítací odkaz do portálu (permanentní) — lead se dozví, že má přístup.
    let emailSent = false;
    try {
      const url = `${portalBase()}/portal?t=${makePortalToken(id)}`;
      await sendPortalInvite({ name: lead.name, email: lead.email, lang: lead.lang }, url);
      emailSent = true;
      console.log(`[compounder] Přístup POVOLEN + odkaz odeslán: lead #${id}`);
    } catch (e) { console.error('[compounder] access-grant e-mail selhal:', e.message); }
    return res.json({ ok: true, approved: true, emailSent });
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
// GET /api/compounder/leads/:id/example-model — uložený model zákazníka (sekce
// Příklad = skládačka portfolia) + historie všech uložení. Data jsou v
// example_model.history (snapshoty codes/investment/buyDate/at, max 50).
router.get('/leads/:id/example-model', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { example_model: true, show_example: true, created_at: true } });
    if (!lead) return res.status(404).json({ error: 'Lead nenalezen' });
    let model = null;
    try { model = lead.example_model ? JSON.parse(lead.example_model) : null; } catch (e) { model = null; }
    const history = (model && Array.isArray(model.history)) ? model.history : [];
    const invHistory = (model && Array.isArray(model.invHistory)) ? model.invHistory : [];
    const current = model ? { codes: model.codes || [], investment: model.investment || null, buyDate: model.buyDate || null, savedAt: model.savedAt || null } : null;
    res.json({ ok: true, showExample: !!lead.show_example, accountCreatedAt: lead.created_at, hasModel: !!model, current, history, invHistory });
  } catch (err) { next(err); }
});

// AI přepíše e-mail se ztrátou do POKAŽDÉ JINÉ podoby (stejná fakta a čísla, jiný
// text + vkusné emoji). Vrací {subject, body} nebo null (pak se použije fallback).
async function lossEmailAI(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const LANG_NAMES = { cs: 'česky', en: 'anglicky', de: 'německy', sk: 'slovensky', pl: 'polsky', es: 'španělsky', it: 'italsky', fr: 'francouzsky', pt: 'portugalsky', hr: 'chorvatsky', nl: 'nizozemsky', hu: 'maďarsky', ro: 'rumunsky', uk: 'ukrajinsky', ru: 'rusky' };
    const lc = (facts.lang || 'cs').toLowerCase().slice(0, 2);
    const langWord = LANG_NAMES[lc] || ('v jazyce s ISO kódem ' + lc);
    const sys = 'Jsi špičkový copywriter prémiové značky Compounder (samoobslužné prádelny provozované jako investiční aktivum). Napiš KRÁTKÝ, elegantní a profesionální, ale živý a lidský e-mail vracejícímu se zájemci, který VÁHÁ s rozhodnutím a kvůli tomu mu uniká výnos. Cíl: vzbudit touhu vrátit se do Compounder portálu a jednat — vkusně, bez laciného nátlaku a bez klišé prodejních frází. Použij 2–4 vkusné emoji (ne přehnaně). Piš ' + langWord + '. DŮLEŽITÉ: použij PŘESNĚ tato čísla a neměň je — ušlá částka "' + facts.missed + '" a denní ztráta "' + facts.per_day + '"; zmíni i datum založení účtu "' + facts.account_opened + '". Oslov jménem, pokud je zadané. POKAŽDÉ napiš úplně jinak formulovaný e-mail (jiný začátek, jiná metafora, jiný spád, jiný předmět), i když je sdělení stejné — ať to nikdy nevypadá jako stejný e-mail. Do těla NEDÁVEJ žádný odkaz ani podpis — doplní se automaticky. Předmět MUSÍ obsahovat konkrétní ušlou částku "' + facts.missed + '" (ať je vidět i ve výpisu schránky, že čím déle čeká, tím víc ztrácí). Odpověz POUZE platným JSON bez markdownu: {"subject":"<poutavý předmět s ušlou částkou, klidně s 1 emoji>","body":"<tělo, 4–6 krátkých odstavců oddělených \\n\\n>"}';
    const usr = 'Fakta (JSON):\n' + JSON.stringify(facts) + '\nNáhodné semínko pro rozmanitost: ' + Math.random().toString(36).slice(2);
    const msg = await client.messages.create({ model, max_tokens: 900, temperature: 1, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    const j = JSON.parse(text);
    if (!j || !j.subject || !j.body) return null;
    return { subject: String(j.subject).slice(0, 200), body: String(j.body).slice(0, 3000) };
  } catch (e) { console.error('[compounder] lossEmailAI selhal:', e.message); return null; }
}

// POST /api/compounder/leads/:id/send-loss-email — elegantní e-mail s aktuální
// ušlou částkou (ze zákazníkova modelu) + odkaz zpět do portálu. Ztráta se počítá
// stejně jako v portálu: (roční výnos vybraného portfolia / 365) × dny od založení účtu.
router.post('/leads/:id/send-loss-email', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'Neplatné ID' });
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, name: true, email: true, lang: true, created_at: true, example_model: true } });
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead nenalezen' });
    if (!lead.email) return res.status(400).json({ ok: false, error: 'Kontakt nemá e-mail.' });
    // Jakmile lead vlastní lokalitu (kupní cena zaplacena / rezervace completed),
    // upomínky se ztrátou se už NEPOSÍLAJÍ.
    const owned = await prisma.locationReservation.findFirst({ where: { lead_id: id, OR: [{ purchase_paid_at: { not: null } }, { status: 'completed' }] }, select: { id: true } }).catch(() => null);
    if (owned) return res.status(400).json({ ok: false, error: 'Lead už vlastní lokalitu — upomínky se ztrátou se neposílají.' });
    let model = null; try { model = lead.example_model ? JSON.parse(lead.example_model) : null; } catch (e) { model = null; }
    const codes = (model && Array.isArray(model.codes)) ? model.codes : [];
    if (!codes.length) return res.status(400).json({ ok: false, error: 'Zákazník si zatím neuložil žádný model — není z čeho počítat ztrátu.' });
    const buyDate = (model && model.buyDate) ? model.buyDate : null;
    const offered = await buildOfferedLocations(id, { includeHidden: true }).catch(() => null);
    const byCode = {}; if (offered && Array.isArray(offered.locations)) offered.locations.forEach((o) => { byCode[String(o.code).toUpperCase()] = o; });
    let yr = 0, matched = 0; codes.forEach((c) => { const o = byCode[String(c).toUpperCase()]; if (o) { yr += (o.yearlyYield || 0); matched++; } });
    if (yr <= 0) return res.status(400).json({ ok: false, error: 'Nelze spočítat roční výnos vybraných lokalit (chybí data ze SIS).' });
    const from = new Date(lead.created_at).getTime();
    let to = Date.now();
    if (buyDate) { const bd = new Date(buyDate + 'T23:59:59').getTime(); if (bd > to) to = bd; }
    const days = Math.max(0, (to - from) / 86400000);
    const missed = Math.round((yr / 365) * days);
    const perDay = Math.round(yr / 365);
    const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
    const first = (lead.name || '').split(' ')[0] || '';
    const lang2 = (lead.lang || '').toLowerCase().slice(0, 2);
    const isCs = (lang2 === 'cs' || lang2 === '');
    const isEn = !isCs; // pro volbu statického fallbacku (CS vs EN)
    // Měna dle leada (buildOfferedLocations: CZK pro cs, jinak EUR). Částky v CZK
    // převedeme kurzem eurRate (CZK za 1 EUR).
    const dispCur = (offered && offered.defaultCurrency) || (isCs ? 'CZK' : 'EUR');
    const eurRate = (offered && (offered.eurRate || (offered.rates && offered.rates.EUR))) || 25;
    const CUR_SYM = { CZK: 'Kč', EUR: '€', USD: '$', GBP: '£', PLN: 'zł' };
    const moneyStr = (czk) => {
      const v = (dispCur === 'CZK') ? czk : (eurRate > 0 ? czk / eurRate : czk);
      const sym = CUR_SYM[dispCur] || dispCur;
      return Math.round(Number(v) || 0).toLocaleString(isCs ? 'cs-CZ' : 'en-US') + ' ' + sym;
    };
    const acctStr = new Date(lead.created_at).toLocaleDateString(isCs ? 'cs-CZ' : 'en-GB');
    const missedStr = moneyStr(missed);
    const perDayStr = moneyStr(perDay);
    const linkLabel = isEn ? 'Open my portal' : 'Otevřít můj portál';
    // Statický fallback (s emoji) — použije se, když AI není dostupná.
    let subject, body;
    if (isEn) {
      subject = `⏳ ${first ? first + ', ' : ''}your hesitation has cost about ${missedStr}`;
      body = `Hello ${first || ''}, 👋\n\nCompounding means value grows on its own — every single day. 📈 The portfolio you saved in your Compounder portal shows exactly what you are missing in the meantime.\n\nSince your account was opened (${acctStr}), waiting has cost you an estimated ${missedStr} in missed return. ⏱️ Every further day costs about ${perDayStr}.\n\nThe sooner you step onto an established, already-earning location, the sooner the asset starts working for you. 🔑\n\nOpen your portfolio again below — it recalculates live.`;
    } else {
      subject = `⏳ ${first ? first + ', ' : ''}vaše váhání zatím stálo ${missedStr}`;
      body = `Dobrý den${first ? ' ' + first : ''}, 👋\n\nCompounding znamená, že hodnota roste sama — každý den. 📈 Portfolio, které jste si uložil(a) ve svém Compounder portálu, přesně ukazuje, kolik vám mezitím uniká.\n\nOd založení účtu (${acctStr}) vás odklad rozhodnutí stál přibližně ${missedStr} ušlého výnosu. ⏱️ Každý další den vás stojí zhruba ${perDayStr}.\n\nČím dřív vstoupíte na zavedenou, už vydělávající lokalitu, tím dřív začne aktivum pracovat za vás. 🔑\n\nVraťte se ke svému modelu níže — přepočítává se živě podle aktuálních tržeb.`;
    }
    // Pokaždé JINÁ varianta přes AI (stejná fakta + čísla, jiný text a vkusné emoji).
    try {
      const ai = await lossEmailAI({ name: first || null, missed: missedStr, per_day: perDayStr, account_opened: acctStr, lang: lead.lang || (isCs ? 'cs' : 'en') });
      if (ai && ai.subject && ai.body) { subject = ai.subject; body = ai.body; }
    } catch (e) { /* při chybě zůstane fallback */ }
    // Částka MUSÍ být vždy v předmětu (aby byla vidět i ve výpisu/filtru schránky).
    if (subject.indexOf(missedStr) === -1) {
      subject = subject.replace(/[\s.!?—–-]+$/u, '') + ' — ' + missedStr;
    }
    const mailFrom = process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || process.env.INVOICE_IMAP_USER;
    await sendMail({ to: lead.email, subject, body, from: mailFrom, fromName: compounderMailFromName(), link: url, linkLabel, brand: 'compounder' });
    try { await prisma.compounderEvent.create({ data: { sid: 'admin-loss-' + id, event: 'loss_email_sent', props: { lead_id: id, missed, yr, days: Math.round(days) }, path: '/admin' } }); } catch (e) { /* log best-effort */ }
    console.log(`[compounder] Loss e-mail odeslán lead #${id}: ${missed} Kč (${matched}/${codes.length} lokalit).`);
    res.json({ ok: true, missed, perDay, yr, days: Math.round(days), matched });
  } catch (err) { next(err); }
});

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
    // Bereme NEJNOVĚJŠÍCH 500 eventů (desc) a otočíme do chronologie — jinak by se
    // u leada s >500 eventy nikdy nenačetla nedávná aktivita (např. ekonomika).
    const events = (await prisma.compounderEvent.findMany({
      where: { OR: or },
      orderBy: { created_at: 'desc' },
      take: 500,
    })).reverse();
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

// GET /api/compounder/leads/:id/ai-eval — AI vyhodnocení leada (warmth, byznys, signály)
router.get('/leads/:id/ai-eval', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const lead = await prisma.compounderLead.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, lang: true, status: true, notes: true, phone: true, created_at: true },
    });
    if (!lead) return res.status(404).json({ error: 'Lead nenalezen' });

    const reg = await prisma.compounderEvent.findFirst({
      where: { event: 'register_success', props: { path: ['lead_id'], equals: id } },
      orderBy: { created_at: 'asc' }, select: { sid: true },
    });
    const or = [{ props: { path: ['lead_id'], equals: id } }];
    if (reg && reg.sid) or.push({ sid: reg.sid });
    const events = (await prisma.compounderEvent.findMany({ where: { OR: or }, orderBy: { created_at: 'desc' }, take: 500 })).reverse();

    const sections = {}; const evCounts = {}; const locChecks = []; let portalOpened = false; let totalMs = 0;
    events.forEach((e) => {
      const p = e.props || {}; evCounts[e.event] = (evCounts[e.event] || 0) + 1;
      if (e.event === 'section_view' && p.section) sections[p.section] = (sections[p.section] || 0) + 1;
      if (e.event === 'portal_view') portalOpened = true;
      if (e.event === 'page_leave' && p.ms) totalMs += Number(p.ms) || 0;
      if (e.event === 'location_assess') locChecks.push({ address: p.address, pop: p.pop, req_pct: p.req_pct, score: p.score });
    });
    const facts = {
      name: lead.name, role: lead.role, lang: lead.lang, status: lead.status,
      has_phone: !!lead.phone,
      requested_contact: (evCounts['contact_request'] > 0) || /Požádal o telefonický kontakt/.test(lead.notes || ''),
      notes: (lead.notes || '').slice(0, 1500), created_at: lead.created_at,
      total_events: events.length, portal_opened: portalOpened, minutes: totalMs > 0 ? Math.round(totalMs / 60000) : null,
      sections: relabelSections(sections), event_counts: evCounts, location_checks: locChecks.slice(0, 6),
      site_sections: Object.values(SECTION_LABELS),
    };
    let out = await leadEvalAI(facts);
    if (!out) out = leadEvalFallback(facts);
    res.json(out);
  } catch (err) { next(err); }
});

// GET /api/compounder/analytics/summary?days=30 — souhrnné metriky webu
router.get('/analytics/summary', requireAuth, async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const [events, sessions, registrations, secEvents] = await Promise.all([
      prisma.compounderEvent.count({ where: { created_at: { gte: since } } }),
      prisma.compounderEvent.findMany({ where: { created_at: { gte: since } }, select: { sid: true }, distinct: ['sid'] }),
      prisma.compounderLead.count({ where: { created_at: { gte: since }, is_test: false } }),
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

// ─── SIS API proxy: hodnota lokalit prádlomatů (kiosk-values) ──────────────
// Modul Compounding (tab v Prodejních objednávkách) potřebuje obraty a hodnoty
// lokalit z externího SIS API. Klíč DRŽÍME NA SERVERU (X-API-Key) — do frontendu
// posíláme jen data, nikdy klíč. Krátká in-memory cache šetří volání SIS.
//
// GET /api/compounder/kiosk-values
//   → { generatedAt, period, yearFrom, valueCurrency, kiosks:[...], summary:{...} }
let _kioskCache = { at: 0, data: null };
const KIOSK_CACHE_MS = 60 * 1000; // 60 s

router.get('/kiosk-values', requireAuth, async (req, res, next) => {
  try {
    const apiKey = process.env.SIS_KIOSK_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'SIS API není nakonfigurováno',
        detail: 'Chybí SIS_KIOSK_API_KEY v prostředí serveru.',
      });
    }
    const apiUrl = process.env.SIS_KIOSK_API_URL
      || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';

    // Cache (obejít přes ?fresh=1)
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    if (!fresh && _kioskCache.data && (Date.now() - _kioskCache.at) < KIOSK_CACHE_MS) {
      return res.json({ ..._kioskCache.data, cached: true });
    }

    // Volání SIS s timeoutem, ať nám nevisí request donekonečna.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let sisRes;
    try {
      sisRes = await fetch(apiUrl, {
        headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      const aborted = e && e.name === 'AbortError';
      return res.status(502).json({
        error: aborted ? 'SIS API neodpovědělo včas' : 'Nepodařilo se spojit se SIS API',
        detail: String(e && e.message || e),
      });
    }
    clearTimeout(timeout);

    if (sisRes.status === 401) {
      return res.status(502).json({ error: 'SIS API: chybí nebo neplatný klíč (401)' });
    }
    if (sisRes.status === 403) {
      return res.status(502).json({ error: 'SIS API: špatný klíč (403)' });
    }
    if (!sisRes.ok) {
      return res.status(502).json({ error: 'SIS API vrátilo chybu ' + sisRes.status });
    }

    let payload;
    try {
      payload = await sisRes.json();
    } catch (e) {
      return res.status(502).json({ error: 'SIS API: neplatná JSON odpověď', detail: String(e.message || e) });
    }

    const kiosks = Array.isArray(payload.kiosks) ? payload.kiosks : [];
    // Souhrn: hodnota lokalit (kioskValue) je vždy v CZK (viz valueCurrency).
    // Obraty jsou v měně kiosku, takže je do jednoho čísla neslučujeme.
    const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
    const summary = {
      kioskCount: kiosks.length,
      inIncubator: kiosks.filter((k) => k.inIncubator).length,
      totalKioskValue: kiosks.reduce((s, k) => s + num(k.kioskValue), 0), // CZK
      totalTransactions: kiosks.reduce((s, k) => s + num(k.transactions), 0),
      valueCurrency: payload.valueCurrency || 'CZK',
    };

    const out = {
      generatedAt: payload.generatedAt || null,
      period: payload.period || null,
      yearFrom: payload.yearFrom || null,
      valueCurrency: payload.valueCurrency || 'CZK',
      kiosks,
      summary,
      cached: false,
    };
    _kioskCache = { at: Date.now(), data: out };
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// ─── SIS API proxy: transakce lokality (kiosk-transactions) ────────────────
// Detail stroje v tabu Compounding: poslední transakce kiosku (pračky/sušičky,
// částky, platby). Klíč opět DRŽÍME NA SERVERU, frontend dostává jen data.
//
// GET /api/compounder/kiosk-transactions/:code?limit=20&offset=0
//   → { generatedAt, code, total, limit, offset, transactions:[...] }
router.get('/kiosk-transactions/:code', requireAuth, async (req, res, next) => {
  try {
    const apiKey = process.env.SIS_KIOSK_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'SIS API není nakonfigurováno',
        detail: 'Chybí SIS_KIOSK_API_KEY v prostředí serveru.',
      });
    }
    const code = String(req.params.code || '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) {
      return res.status(400).json({ error: 'Neplatný kód kiosku' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // URL odvodíme z SIS_KIOSK_API_URL (…/kiosk-values → …/kiosk-transactions),
    // případně jde přenastavit vlastní proměnnou SIS_KIOSK_TX_API_URL.
    const baseUrl = process.env.SIS_KIOSK_TX_API_URL
      || (process.env.SIS_KIOSK_API_URL
        ? process.env.SIS_KIOSK_API_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions')
        : 'https://sis-test.infinitygrid.cloud/api/public/kiosk-transactions');
    const apiUrl = baseUrl.replace(/\/$/, '') + '/' + encodeURIComponent(code)
      + '?limit=' + limit + '&offset=' + offset;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let sisRes;
    try {
      sisRes = await fetch(apiUrl, {
        headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      const aborted = e && e.name === 'AbortError';
      return res.status(502).json({
        error: aborted ? 'SIS API neodpovědělo včas' : 'Nepodařilo se spojit se SIS API',
        detail: String(e && e.message || e),
      });
    }
    clearTimeout(timeout);

    if (sisRes.status === 401 || sisRes.status === 403) {
      return res.status(502).json({ error: 'SIS API: chybí nebo neplatný klíč (' + sisRes.status + ')' });
    }
    if (sisRes.status === 404) {
      return res.status(404).json({ error: 'Kiosek "' + code + '" nebyl v SIS nalezen' });
    }
    if (!sisRes.ok) {
      return res.status(502).json({ error: 'SIS API vrátilo chybu ' + sisRes.status });
    }

    let payload;
    try {
      payload = await sisRes.json();
    } catch (e) {
      return res.status(502).json({ error: 'SIS API: neplatná JSON odpověď', detail: String(e.message || e) });
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// ─── SIS: tržby lokality po obdobích (den/týden/měsíc/rok) ──────────────────
// Sečte částky transakcí ze SIS do košů podle data. Transakce bereme stránkovaně
// (řazené od nejnovějších); končíme, když je celá stránka starší než rok, nebo
// při stropu stránek. Krátká cache per kód.
let _revCache = {};
const REV_CACHE_MS = 5 * 60 * 1000;

// Sdílený výpočet tržeb kiosku (interní i portálový endpoint). Vrací data objekt.
// Vyhodí Error('SIS_NOT_CONFIGURED') / Error('BAD_CODE') když je vstup špatný.
async function _computeKioskRevenue(code, fresh) {
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  if (!apiKey) { const e = new Error('SIS_NOT_CONFIGURED'); e.code = 'SIS_NOT_CONFIGURED'; throw e; }
  code = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) { const e = new Error('BAD_CODE'); e.code = 'BAD_CODE'; throw e; }
  const cc = _revCache[code];
  if (cc && (Date.now() - cc.at) < REV_CACHE_MS && !fresh) return { ...cc.data, cached: true };
  const baseUrl = (process.env.SIS_KIOSK_TX_API_URL
    || (process.env.SIS_KIOSK_API_URL ? process.env.SIS_KIOSK_API_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions') : 'https://sis-test.infinitygrid.cloud/api/public/kiosk-transactions')).replace(/\/$/, '');
  const now = Date.now();
  const nowD = new Date(now);
  const CZ_MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const startToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  const dow = (nowD.getDay() + 6) % 7;
  const startThisWeek = startToday - dow * 86400000;
  const startPrevWeek = startThisWeek - 7 * 86400000;
  const startThisMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
  const startPrevMonth = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1).getTime();
  const yearRoll = now - 365 * 86400000;
  const year2Roll = now - 730 * 86400000;
  const chartCut = new Date(nowD.getFullYear(), nowD.getMonth() - 23, 1).getTime();
  const day30 = now - 30 * 86400000;
  const sums = { day: 0, thisWeek: 0, prevWeek: 0, thisMonth: 0, prevMonth: 0, year: 0, year2: 0 };
  const daily = {}, monthly = {};
  let currency = null, count = 0, offset = 0, pages = 0, complete = false, total = 0;
  while (pages < 200) {
    if (Date.now() - now > 18000) break; // časový rozpočet — ať request neběží donekonečna
    const url = baseUrl + '/' + encodeURIComponent(code) + '?limit=200&offset=' + offset;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 12000);
    let sisRes;
    try { sisRes = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: controller.signal }); }
    catch (e) { clearTimeout(to); break; }
    clearTimeout(to);
    if (!sisRes.ok) break;
    const payload = await sisRes.json().catch(() => ({}));
    const txs = Array.isArray(payload.transactions) ? payload.transactions : [];
    if (typeof payload.total === 'number') total = payload.total;
    if (!txs.length) { complete = true; break; }
    let allOlder = true;
    for (const t of txs) {
      const ts = t.datetime ? new Date(t.datetime).getTime() : 0;
      const inRange = ts && ts >= chartCut;
      if (inRange) allOlder = false;
      if (String(t.status) !== 'Successful') continue;
      const amt = Number(t.amount) || 0;
      if (!currency && t.currency) currency = t.currency;
      if (!ts) continue;
      if (ts >= startToday) sums.day += amt;
      if (ts >= startThisWeek) sums.thisWeek += amt;
      if (ts >= startPrevWeek && ts < startThisWeek) sums.prevWeek += amt;
      if (ts >= startThisMonth) sums.thisMonth += amt;
      if (ts >= startPrevMonth && ts < startThisMonth) sums.prevMonth += amt;
      if (ts >= yearRoll) { sums.year += amt; count++; }
      if (ts >= year2Roll) sums.year2 += amt;
      if (inRange) {
        const dO = new Date(ts);
        const ym = dO.getFullYear() + '-' + String(dO.getMonth() + 1).padStart(2, '0');
        monthly[ym] = (monthly[ym] || 0) + amt;
        if (ts >= day30) { const dk = ym + '-' + String(dO.getDate()).padStart(2, '0'); daily[dk] = (daily[dk] || 0) + amt; }
      }
    }
    offset += txs.length; pages++;
    if (allOlder) { complete = true; break; }
    if (total && offset >= total) { complete = true; break; }
  }
  const monthsArr = [];
  for (let i = 11; i >= 0; i--) { const dt = new Date(now); dt.setDate(1); dt.setMonth(dt.getMonth() - i); const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); monthsArr.push({ label: (dt.getMonth() + 1) + '/' + String(dt.getFullYear()).slice(2), amount: Math.round(monthly[ym] || 0) }); }
  const monthsArr24 = [];
  for (let i = 23; i >= 0; i--) { const dt = new Date(now); dt.setDate(1); dt.setMonth(dt.getMonth() - i); const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); monthsArr24.push({ label: (dt.getMonth() + 1) + '/' + String(dt.getFullYear()).slice(2), amount: Math.round(monthly[ym] || 0) }); }
  const daysArr = [];
  for (let i = 29; i >= 0; i--) { const dt = new Date(now - i * 86400000); const dk = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); daysArr.push({ label: dt.getDate() + '.' + (dt.getMonth() + 1) + '.', amount: Math.round(daily[dk] || 0) }); }
  const data = { code, currency: currency || 'CZK', day: sums.day, thisWeek: sums.thisWeek, prevWeek: sums.prevWeek, thisMonth: sums.thisMonth, prevMonth: sums.prevMonth, year: sums.year, year2: sums.year2, thisMonthName: CZ_MONTHS[nowD.getMonth()], prevMonthName: CZ_MONTHS[new Date(startPrevMonth).getMonth()], txCount: count, complete, monthly: monthsArr, monthly24: monthsArr24, daily: daysArr, generatedAt: new Date().toISOString() };
  _revCache[code] = { at: Date.now(), data };
  return data;
}

router.get('/kiosk-revenue/:code', requireAuth, async (req, res, next) => {
  try {
    const data = await _computeKioskRevenue(req.params.code, req.query.fresh === '1');
    return res.json(data);
  } catch (err) {
    if (err.code === 'SIS_NOT_CONFIGURED') return res.status(503).json({ error: 'SIS API není nakonfigurováno' });
    if (err.code === 'BAD_CODE') return res.status(400).json({ error: 'Neplatný kód kiosku' });
    return next(err);
  }
});


// ─── SIS: jednotlivé transakce daného období (drill-down z karty tržeb) ──────
// GET /api/compounder/kiosk-revenue/:code/transactions?period=day|thisWeek|prevWeek|thisMonth|prevMonth|year
//   → { code, period, currency, start, end, count, successfulSum, complete, transactions:[...] }
// Sdílený výpočet transakcí daného období (interní i portálový endpoint).
async function _computeKioskPeriodTx(code, period) {
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  if (!apiKey) { const e = new Error('SIS_NOT_CONFIGURED'); e.code = 'SIS_NOT_CONFIGURED'; throw e; }
  code = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) { const e = new Error('BAD_CODE'); e.code = 'BAD_CODE'; throw e; }
  period = String(period || 'thisWeek');
  const now = Date.now();
  const nowD = new Date(now);
  const startToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  const dow = (nowD.getDay() + 6) % 7;
  const startThisWeek = startToday - dow * 86400000;
  const startPrevWeek = startThisWeek - 7 * 86400000;
  const startThisMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
  const startPrevMonth = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1).getTime();
  const yearRoll = now - 365 * 86400000;
  // Hranice ve stejném rámci jako časy transakcí (SIS vrací lokální čas bez zóny).
  // Nepoužíváme reálné „teď" jako horní mez — kvůli TZ serveru by to ořízlo dnešní
  // transakce. Bereme přirozený konec dne/týdne/měsíce.
  const startTomorrow = startToday + 86400000;
  const startNextWeek = startThisWeek + 7 * 86400000;
  const startNextMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 1).getTime();
  const RANGES = {
    day: [startToday, startTomorrow],
    thisWeek: [startThisWeek, startNextWeek],
    prevWeek: [startPrevWeek, startThisWeek],
    thisMonth: [startThisMonth, startNextMonth],
    prevMonth: [startPrevMonth, startThisMonth],
    year: [yearRoll, startTomorrow],
    year2: [now - 730 * 86400000, startTomorrow],
  };
  const range = RANGES[period];
  if (!range) { const e = new Error('BAD_PERIOD'); e.code = 'BAD_PERIOD'; throw e; }
  const [start, end] = range;
  const baseUrl = (process.env.SIS_KIOSK_TX_API_URL
    || (process.env.SIS_KIOSK_API_URL ? process.env.SIS_KIOSK_API_URL.replace(/kiosk-values\/?$/, 'kiosk-transactions') : 'https://sis-test.infinitygrid.cloud/api/public/kiosk-transactions')).replace(/\/$/, '');
  let currency = null, offset = 0, pages = 0, total = 0, complete = false, successfulSum = 0;
  const out = [];
  const CAP = 20000;
  while (pages < 400) {
    if (Date.now() - now > 18000) break; // časový rozpočet
    const url = baseUrl + '/' + encodeURIComponent(code) + '?limit=200&offset=' + offset;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 12000);
    let sisRes;
    try { sisRes = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: controller.signal }); }
    catch (e) { clearTimeout(to); break; }
    clearTimeout(to);
    if (!sisRes.ok) break;
    const payload = await sisRes.json().catch(() => ({}));
    const txs = Array.isArray(payload.transactions) ? payload.transactions : [];
    if (typeof payload.total === 'number') total = payload.total;
    if (!txs.length) { complete = true; break; }
    let allOlder = true;
    for (const t of txs) {
      const ts = t.datetime ? new Date(t.datetime).getTime() : 0;
      if (!ts) continue;
      if (ts >= start) allOlder = false;
      if (ts >= start && ts < end) {
        if (!currency && t.currency) currency = t.currency;
        if (String(t.status) === 'Successful') successfulSum += (Number(t.amount) || 0);
        if (out.length < CAP) out.push(t);
      }
    }
    offset += txs.length; pages++;
    if (allOlder) { complete = true; break; }
    if (total && offset >= total) { complete = true; break; }
  }
  out.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  return {
    code, period, currency: currency || 'CZK', start, end,
    count: out.length, successfulSum, complete,
    truncated: out.length >= CAP,
    transactions: out, generatedAt: new Date().toISOString(),
  };
}

function _sisErrToHttp(err, res, next) {
  if (err.code === 'SIS_NOT_CONFIGURED') return res.status(503).json({ error: 'SIS API není nakonfigurováno' });
  if (err.code === 'BAD_CODE') return res.status(400).json({ error: 'Neplatný kód kiosku' });
  if (err.code === 'BAD_PERIOD') return res.status(400).json({ error: 'Neplatné období' });
  return next(err);
}

router.get('/kiosk-revenue/:code/transactions', requireAuth, async (req, res, next) => {
  try {
    const data = await _computeKioskPeriodTx(req.params.code, req.query.period);
    res.json(data);
  } catch (err) { _sisErrToHttp(err, res, next); }
});

// ─── SIS: adresa/měna lokality podle kódu kiosku ────────────────────────────
// Bere z cache kiosk-values; když je prošlá, načte čerstvě ze SIS (klíč na serveru).
async function _sisKiosks() {
  if (_kioskCache.data && (Date.now() - _kioskCache.at) < KIOSK_CACHE_MS && Array.isArray(_kioskCache.data.kiosks)) {
    return _kioskCache.data.kiosks;
  }
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  const stale = (_kioskCache.data && Array.isArray(_kioskCache.data.kiosks)) ? _kioskCache.data.kiosks : [];
  if (!apiKey) return stale;
  const apiUrl = process.env.SIS_KIOSK_API_URL
    || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(apiUrl, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return stale;
    const payload = await r.json();
    return Array.isArray(payload.kiosks) ? payload.kiosks : stale;
  } catch (e) { return stale; }
}
// → { label, currency } lokality; prázdné label = kiosek v SIS nenalezen.
async function _sisKioskInfo(code) {
  try {
    const ks = await _sisKiosks();
    const kk = ks.find((k) => k.code === code);
    return {
      label: (kk && kk.label) ? String(kk.label) : '',
      currency: (kk && kk.currency) ? String(kk.currency).toUpperCase() : 'CZK',
    };
  } catch (e) { return { label: '', currency: 'CZK' }; }
}

// ─── Nastavení modulu Compounding (ceník V2/V3/V4 + cena lokality) ─────────
// Uloženo jako jeden JSON AppSetting (klíč 'compounding.settings'), sdílené pro
// všechny uživatele. Ceny ceníku se zadávají v EUR bez DPH (CZK se dopočítá
// kurzem na frontendu). locationMonths = násobitel pro cenu lokality
// (cena lokality = Ø top 3 × locationMonths).
const COMPOUNDING_SETTINGS_KEY = 'compounding.settings';
const COMPOUNDING_SETTINGS_DEFAULT = {
  pricelist: { v2: { eur: null }, v3: { eur: null }, v4: { eur: null } },
  locationMonths: 12,
  servicePct: 15,
  energyPct: 9.5,
  locationPriceMode: 'months',
  locationRoiPct: 25,
  buybackPct: 65,
  buybackYears: 5,
  reservationFeePerDayCzk: 20000,
  reservationHoldHours: 1,
  reservationSignDays: 1,
  reservationPayDays: 1,
  reservationReblockDays: 2,
  defaultCurrency: 'CZK',
  externalCommissionPct: 10,
  externalCommissionMachinePct: 5,
  externalCommissionLocationPct: 12,
  externalMarkupPct: 20,
};

const compoundingSettingsSchema = z.object({
  pricelist: z.object({
    v2: z.object({ eur: z.number().nonnegative().nullable() }),
    v3: z.object({ eur: z.number().nonnegative().nullable() }),
    v4: z.object({ eur: z.number().nonnegative().nullable() }),
  }),
  locationMonths: z.number().int().min(1).max(600),
  servicePct: z.number().min(0).max(100).optional(),
  energyPct: z.number().min(0).max(100).optional(),
  locationPriceMode: z.enum(['months', 'roi']).optional(),
  locationRoiPct: z.number().min(1).max(100).optional(),
  buybackPct: z.number().min(0).max(100).optional(),
  buybackYears: z.number().min(1).max(50).optional(),
  reservationFeePerDayCzk: z.number().int().min(0).max(10000000).optional(),
  reservationHoldHours: z.number().min(0).max(720).optional(),
  reservationSignDays: z.number().int().min(0).max(365).optional(),
  reservationPayDays: z.number().int().min(0).max(365).optional(),
  reservationReblockDays: z.number().int().min(0).max(365).optional(),
  defaultCurrency: z.enum(['CZK', 'EUR']).optional(),
  externalCommissionPct: z.number().min(0).max(100).optional(),
  externalCommissionMachinePct: z.number().min(0).max(100).optional(),
  externalCommissionLocationPct: z.number().min(0).max(100).optional(),
  externalMarkupPct: z.number().min(0).max(1000).optional(),
  versionPhotos: z.object({ v2: z.string().max(600).nullable().optional(), v3: z.string().max(600).nullable().optional(), v4: z.string().max(600).nullable().optional() }).optional(),
});

// GET /api/compounder/compounding-settings
router.get('/compounding-settings', requireAuth, async (req, res, next) => {
  try {
    const val = await getSetting(COMPOUNDING_SETTINGS_KEY, {
      type: 'json',
      defaultValue: COMPOUNDING_SETTINGS_DEFAULT,
    });
    // Sloučení s defaultem — kdyby v uložené hodnotě chyběl nějaký klíč.
    const merged = {
      pricelist: {
        v2: { eur: (val && val.pricelist && val.pricelist.v2 && val.pricelist.v2.eur != null) ? val.pricelist.v2.eur : null },
        v3: { eur: (val && val.pricelist && val.pricelist.v3 && val.pricelist.v3.eur != null) ? val.pricelist.v3.eur : null },
        v4: { eur: (val && val.pricelist && val.pricelist.v4 && val.pricelist.v4.eur != null) ? val.pricelist.v4.eur : null },
      },
      locationMonths: (val && Number.isFinite(val.locationMonths)) ? val.locationMonths : 12,
      servicePct: (val && Number.isFinite(val.servicePct)) ? val.servicePct : 15,
      energyPct: (val && Number.isFinite(val.energyPct)) ? val.energyPct : 9.5,
      locationPriceMode: (val && (val.locationPriceMode === 'roi' || val.locationPriceMode === 'months')) ? val.locationPriceMode : 'months',
      locationRoiPct: (val && Number.isFinite(val.locationRoiPct)) ? val.locationRoiPct : 25,
      buybackPct: (val && Number.isFinite(val.buybackPct)) ? val.buybackPct : 65,
      buybackYears: (val && Number.isFinite(val.buybackYears)) ? val.buybackYears : 5,
      reservationFeePerDayCzk: (val && Number.isFinite(val.reservationFeePerDayCzk)) ? val.reservationFeePerDayCzk : 20000,
      reservationHoldHours: (val && Number.isFinite(val.reservationHoldHours)) ? val.reservationHoldHours : 1,
      reservationSignDays: (val && Number.isFinite(val.reservationSignDays)) ? val.reservationSignDays : 1,
      reservationPayDays: (val && Number.isFinite(val.reservationPayDays)) ? val.reservationPayDays : 1,
      reservationReblockDays: (val && Number.isFinite(val.reservationReblockDays)) ? val.reservationReblockDays : 2,
      defaultCurrency: (val && (val.defaultCurrency === 'EUR' || val.defaultCurrency === 'CZK')) ? val.defaultCurrency : 'CZK',
      externalCommissionPct: (val && Number.isFinite(val.externalCommissionPct)) ? val.externalCommissionPct : 10,
      externalCommissionMachinePct: (val && Number.isFinite(val.externalCommissionMachinePct)) ? val.externalCommissionMachinePct : 5,
      externalCommissionLocationPct: (val && Number.isFinite(val.externalCommissionLocationPct)) ? val.externalCommissionLocationPct : 12,
      externalMarkupPct: (val && Number.isFinite(val.externalMarkupPct)) ? val.externalMarkupPct : 20,
      versionPhotos: (val && val.versionPhotos && typeof val.versionPhotos === 'object') ? val.versionPhotos : {},
    };
    res.json(merged);
  } catch (err) {
    next(err);
  }
});

// PUT /api/compounder/compounding-settings
router.put('/compounding-settings', requireAuth, async (req, res, next) => {
  try {
    const parsed = compoundingSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data nastavení', detail: parsed.error.flatten() });
    }
    const _data = parsed.data;
    if (_data.versionPhotos === undefined) { const _ex = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: {} }); if (_ex && _ex.versionPhotos) _data.versionPhotos = _ex.versionPhotos; }
    await setSetting(COMPOUNDING_SETTINGS_KEY, _data, {
      type: 'json',
      scope: 'compounding',
      description: 'Compounding — ceník V2/V3/V4 (EUR bez DPH) + počet měsíců pro cenu lokality',
      userId: req.user && req.user.id,
    });
    res.json({ ok: true, settings: _data });
  } catch (err) {
    next(err);
  }
});

// ─── Per-lokalita konfigurace (verze kiosku + měsíční nájem) ───────────────
// Uloženo jako jedna JSON mapa (klíč 'compounding.kiosks'), kde klíč = kód kiosku
// a hodnota = { version: 'v2'|'v3'|'v4'|null, rentMonthlyCzk: number|null }.
const COMPOUNDING_KIOSKS_KEY = 'compounding.kiosks';

const kioskConfigSchema = z.object({
  version: z.enum(['v2', 'v3', 'v4']).nullable().optional(),
  rentMonthlyCzk: z.number().nonnegative().nullable().optional(),
  forSale: z.boolean().optional(),
  photos: z.array(z.string().max(600)).max(3).optional(),
});

// GET /api/compounder/kiosk-config → celá mapa { [code]: {version, rentMonthlyCzk} }
router.get('/kiosk-config', requireAuth, async (req, res, next) => {
  try {
    const map = await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} });
    res.json(map && typeof map === 'object' ? map : {});
  } catch (err) {
    next(err);
  }
});

// GET /api/compounder/kiosk-options → lokality k INDIVIDUÁLNÍ nabídce
// (Best Series, které NEJSOU v globální nabídce forSale a mají nastavenou verzi,
// aby se u nich dala dopočítat ekonomika). Vrací [{ code, label }].
router.get('/kiosk-options', requireAuth, async (req, res, next) => {
  try {
    const cfgMap = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
    const kiosks = await portalKiosks();
    const opts = kiosks
      .filter((k) => String(k.companyName || '').toLowerCase().includes('best series'))
      .filter((k) => { const c = cfgMap[k.code] || {}; return !c.forSale && c.version; })
      .map((k) => { const c = cfgMap[k.code] || {}; return { code: k.code, label: k.label || k.code, hasPhoto: Array.isArray(c.photos) && c.photos.length > 0 }; })
      .sort((a, b) => String(a.label).localeCompare(String(b.label), 'cs'));
    res.json(opts);
  } catch (err) { next(err); }
});

// POST /api/compounder/digest/run — ruční spuštění denního hodnocení leadů (test).
// Normálně běží automaticky ve 23:55 (daily-digest-worker).
router.post('/digest/run', requireAuth, async (req, res, next) => {
  try {
    const worker = require('../services/compounder/daily-digest-worker');
    const r = await worker.runNow();
    res.json(r || { ok: true });
  } catch (err) { next(err); }
});

// PUT /api/compounder/kiosk-config/:code → upsert konfigurace jedné lokality
router.put('/kiosk-config/:code', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().slice(0, 40);
    if (!code) return res.status(400).json({ error: 'Chybí kód lokality' });
    const parsed = kioskConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data konfigurace', detail: parsed.error.flatten() });
    }
    const map = await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} });
    const next_ = (map && typeof map === 'object') ? { ...map } : {};
    next_[code] = { ...(next_[code] || {}), ...parsed.data };
    await setSetting(COMPOUNDING_KIOSKS_KEY, next_, {
      type: 'json',
      scope: 'compounding',
      description: 'Compounding — per-lokalita: verze kiosku + měsíční nájem (CZK)',
      userId: req.user && req.user.id,
    });
    res.json({ ok: true, code, config: parsed.data });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// EXTERNÍ OBCHODNÍCI — ruční agenda. Ukládá se do AppSetting JSON (stejně jako
// Ceník / compounding nastavení), klíč external.sales_reps = pole záznamů.
// ─────────────────────────────────────────────────────────────────────────
const EXTERNAL_REPS_KEY = 'external.sales_reps';

const externalRepSchema = z.object({
  jmeno: z.string().trim().min(1).max(255),
  ico: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  telefon: z.string().trim().max(60).nullable().optional(),
  adresa: z.string().trim().max(400).nullable().optional(),
  sazba: z.number().min(0).max(1000).nullable().optional(),
  zpusob_vypoctu: z.enum(['lokalita', 'celkova', 'fix']).optional(),
  splatnost: z.enum(['podpis', 'provoz', 'mesicne', 'individ']).optional(),
  lokality: z.array(z.string().max(40)).max(2000).optional(),
  stav: z.enum(['aktivni', 'neaktivni', 've_schvalovani']).optional(),
  poznamky: z.string().max(5000).nullable().optional(),
  login: z.string().trim().max(80).nullable().optional(),
  password: z.string().max(200).optional(),
});

async function _loadExternalReps() {
  const arr = await getSetting(EXTERNAL_REPS_KEY, { type: 'json', defaultValue: [] });
  return Array.isArray(arr) ? arr : [];
}
async function _saveExternalReps(arr, userId) {
  await setSetting(EXTERNAL_REPS_KEY, arr, {
    type: 'json', scope: 'external',
    description: 'Externí obchodníci — ruční agenda (seznam zástupců, provize, lokality)',
    userId,
  });
}

// Nikdy neposílej hash hesla do frontendu; místo toho příznak has_password.
function _sanitizeRep(r) {
  const c = Object.assign({}, r);
  c.has_password = !!c.password_hash;
  delete c.password_hash; delete c.password;
  return c;
}

// Zaznamenej aktivitu obchodníka: last_seen + volitelně počítadlo (incKey) a řádek do logu (text).
async function _repActivity(repId, text, incKey) {
  try {
    const arr = await _loadExternalReps();
    const i = arr.findIndex((r) => Number(r.id) === repId);
    if (i === -1) return;
    const rep = Object.assign({}, arr[i]);
    const now = new Date().toISOString();
    rep.last_seen_at = now;
    if (incKey) rep[incKey] = (Number(rep[incKey]) || 0) + 1;
    if (text) {
      const act = Array.isArray(rep.activity) ? rep.activity.slice() : [];
      act.unshift({ at: now, text: String(text).slice(0, 200) });
      rep.activity = act.slice(0, 50);
    }
    arr[i] = rep;
    await _saveExternalReps(arr, null);
  } catch (e) { /* aktivita neblokuje hlavní request */ }
}
// Zpracuj login (normalizace + unikátnost) a heslo (bcrypt hash). Mutuje data.
// Vrací { status, error } při chybě, jinak null.
async function _prepRepCredentials(data, arr, selfId) {
  if (data.login !== undefined) {
    const loginNorm = String(data.login || '').trim();
    if (loginNorm) {
      const dup = arr.find((r) => Number(r.id) !== selfId && String(r.login || '').trim().toLowerCase() === loginNorm.toLowerCase());
      if (dup) return { status: 409, error: 'Přihlašovací jméno už používá jiný obchodník.' };
    }
    data.login = loginNorm;
  }
  if (data.password !== undefined) {
    const pw = String(data.password || '');
    if (pw.length >= 4) data.password_hash = await bcrypt.hash(pw, 12);
    else if (pw.length > 0) return { status: 400, error: 'Heslo musí mít aspoň 4 znaky.' };
    delete data.password;
  }
  return null;
}
// Session token externího obchodníka (HMAC, formát id.exp.sig, ~1 rok).
function makeExtRepToken(id, ttlMs) {
  const exp = Date.now() + (ttlMs || 365 * 24 * 3600 * 1000);
  return id + '.' + exp + '.' + hmacSig('extrep:' + id + ':' + exp);
}
function verifyExtRepToken(token) {
  if (!token || typeof token !== 'string') return null;
  const p = String(token).split('.');
  if (p.length !== 3) return null;
  const id = Number(p[0]), exp = Number(p[1]);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(exp) || !p[2]) return null;
  if (Date.now() > exp) return null;
  return safeEqStr(p[2], hmacSig('extrep:' + id + ':' + exp)) ? id : null;
}

// GET /api/compounder/external-reps — seznam
router.get('/external-reps', requireAuth, async (req, res, next) => {
  try { res.json((await _loadExternalReps()).map(_sanitizeRep)); } catch (err) { next(err); }
});

// POST /api/compounder/external-reps — založ
router.post('/external-reps', requireAuth, async (req, res, next) => {
  try {
    const parsed = externalRepSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data obchodníka', detail: parsed.error.flatten() });
    const arr = await _loadExternalReps();
    const id = arr.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const data = Object.assign({}, parsed.data);
    const cerr = await _prepRepCredentials(data, arr, id);
    if (cerr) return res.status(cerr.status).json({ error: cerr.error });
    const rec = Object.assign({
      id, jmeno: '', ico: '', email: '', telefon: '', adresa: '',
      sazba: null, zpusob_vypoctu: 'lokalita', splatnost: 'individ',
      lokality: [], stav: 'aktivni', poznamky: '', login: '', password_hash: null,
      datum_zalozeni: new Date().toISOString().slice(0, 10),
    }, data, { id });
    arr.push(rec);
    await _saveExternalReps(arr, req.user && req.user.id);
    // Automaticky založ ukázkový self-lead v Compounder portálu (aby obchodník viděl, jak to vypadá)
    try { rec.self_lead_id = await _ensureRepSelfLead(rec); } catch (e) { /* neblokovat vytvoření obchodníka */ }
    res.status(201).json(_sanitizeRep(rec));
  } catch (err) { next(err); }
});

// POST /api/compounder/external-reps/login — přihlášení externího obchodníka (veřejné)
router.post('/external-reps/login', async (req, res, next) => {
  try {
    const login = String((req.body && req.body.login) || '').trim();
    const password = String((req.body && req.body.password) || '');
    if (!login || !password) return res.status(400).json({ error: 'Zadejte přihlašovací jméno a heslo.' });
    const arr = await _loadExternalReps();
    const rep = arr.find((r) => String(r.login || '').trim().toLowerCase() === login.toLowerCase());
    if (!rep || !rep.password_hash || rep.stav !== 'aktivni') return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const ok = await bcrypt.compare(password, rep.password_hash);
    if (!ok) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    await _repActivity(rep.id, 'Přihlášení do portálu', 'logins');
    res.json({ ok: true, token: makeExtRepToken(rep.id), rep: _sanitizeRep(rep) });
  } catch (err) { next(err); }
});

// PUT /api/compounder/external-reps/:id — uprav (i změna stavu = deaktivace)
router.put('/external-reps/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = externalRepSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data obchodníka', detail: parsed.error.flatten() });
    const arr = await _loadExternalReps();
    const i = arr.findIndex((r) => Number(r.id) === id);
    if (i === -1) return res.status(404).json({ error: 'Obchodník nenalezen' });
    const data = Object.assign({}, parsed.data);
    const cerr = await _prepRepCredentials(data, arr, id);
    if (cerr) return res.status(cerr.status).json({ error: cerr.error });
    arr[i] = Object.assign({}, arr[i], data, { id });
    await _saveExternalReps(arr, req.user && req.user.id);
    // Doplň chybějící ukázkový self-lead i u dříve založených obchodníků
    try { if (!arr[i].self_lead_id) arr[i].self_lead_id = await _ensureRepSelfLead(arr[i]); } catch (e) { /* neblokovat uložení */ }
    res.json(_sanitizeRep(arr[i]));
  } catch (err) { next(err); }
});

// DELETE /api/compounder/external-reps/:id — smaž
router.delete('/external-reps/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const arr = await _loadExternalReps();
    const kept = arr.filter((r) => Number(r.id) !== id);
    if (kept.length === arr.length) return res.status(404).json({ error: 'Obchodník nenalezen' });
    await _saveExternalReps(kept, req.user && req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Zajistí „ukázkový" lead pro obchodníka (aby viděl portál jako zákazník). Idempotentní.
async function _ensureRepSelfLead(rep) {
  try {
    if (rep.self_lead_id) {
      const ex = await prisma.compounderLead.findUnique({ where: { id: Number(rep.self_lead_id) }, select: { id: true } }).catch(() => null);
      if (ex) return rep.self_lead_id;
    }
    const lead = await prisma.compounderLead.create({
      data: {
        name: (rep.jmeno || 'Obchodník') + ' (ukázka)',
        email: rep.email || null,
        phone: rep.telefon || null,
        role: 'compounder', source: 'obchodnik_ext_self', status: 'new',
        external_rep_id: rep.id,
        visible_sections: 'ekonomika,nabidka',
        visible_templates: 'rezervacni,kupni,servisni',
        show_revenue_stats: true,
      },
      select: { id: true },
    });
    const arr = await _loadExternalReps();
    const i = arr.findIndex((r) => Number(r.id) === Number(rep.id));
    if (i !== -1) { arr[i] = Object.assign({}, arr[i], { self_lead_id: lead.id }); await _saveExternalReps(arr, null); }
    return lead.id;
  } catch (e) { return rep.self_lead_id || null; }
}

// Serverový výpočet dat portálu externího obchodníka (metriky lokalit + provize).
async function _extRepPortalData(rep) {
  const kiosks = await _sisKiosks().catch(() => []);
  const cs = (await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT })) || {};
  const cfgMap = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
  // Společná nabídka (forSale) = základ pro KAŽDÉHO obchodníka; rep.lokality = VIP navíc.
  const forSaleSet = {}; Object.keys(cfgMap).forEach((c) => { if (cfgMap[c] && cfgMap[c].forSale) forSaleSet[String(c)] = true; });
  const vipList = (Array.isArray(rep.lokality) ? rep.lokality : []).map(String);
  const vipSet = {}; vipList.forEach((c) => { vipSet[c] = true; });
  const codes = Array.from(new Set(Object.keys(forSaleSet).concat(vipList)));
  const fx = await fxRatesCzk().catch(() => ({ CZK: 1, EUR: 25 }));
  const eur = fx.EUR || 25;
  const months = Number.isFinite(cs.locationMonths) ? cs.locationMonths : 12;
  const svc = Number.isFinite(cs.servicePct) ? cs.servicePct : 15;
  const en = Number.isFinite(cs.energyPct) ? cs.energyPct : 9.5;
  const priceMode = (cs.locationPriceMode === 'roi') ? 'roi' : 'months';
  const roiPct = Number.isFinite(cs.locationRoiPct) ? cs.locationRoiPct : 25;
  const buybackPct = Number.isFinite(cs.buybackPct) ? cs.buybackPct : 65;
  const buybackYears = Number.isFinite(cs.buybackYears) ? cs.buybackYears : 5;
  const pl = cs.pricelist || {};
  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
  const rate = Number(rep.sazba) || 0;
  let resMap = {};
  try {
    const resvs = await prisma.locationReservation.findMany({ where: { kiosk_code: { in: codes }, status: { in: ['reserved', 'active'] } }, select: { kiosk_code: true, status: true, reserved_until: true, fee_until: true, sign_until: true }, orderBy: { created_at: 'desc' } });
    resvs.forEach((r) => { if (!resMap[r.kiosk_code]) resMap[r.kiosk_code] = r; });
  } catch (e) { /* tabulka nemusí existovat */ }
  const rows = codes.map((code) => {
    const isVip = !!(vipSet[code] && !forSaleSet[code]);
    const rv = resMap[String(code)];
    const resObj = rv ? { reserved: true, res_until: (rv.reserved_until || rv.fee_until || rv.sign_until || null), res_status: rv.status } : { reserved: false, res_until: null, res_status: null };
    const k = kiosks.find((x) => String(x.code) === String(code));
    if (!k) return Object.assign({ code, label: '(mimo seznam)', total: null, loc: null, machine: null, yearNet: 0, commission: null, navratnost: null, vip: isVip }, resObj);
    const cfg = cfgMap[code] || {};
    const ver = String(cfg.version || '').toLowerCase();
    const machine = (pl[ver] && pl[ver].eur != null && isFinite(Number(pl[ver].eur))) ? Math.round(Number(pl[ver].eur) * eur) : null;
    const curRate = fx[k.currency || 'CZK'] || 1;
    const obratBez = num(k.avgTop3) / 1.21;
    const servis = num(k.avgTop3) * (svc / 100);
    const najem = (typeof cfg.rentMonthlyCzk === 'number' && isFinite(cfg.rentMonthlyCzk)) ? cfg.rentMonthlyCzk : 0;
    const energie = obratBez * (en / 100);
    let loc;
    if (priceMode === 'roi') {
      if (machine == null) loc = 0;
      else { const cisty = obratBez - servis - najem - energie; const target = cisty * (1200 / (roiPct > 0 ? roiPct : 25)); loc = Math.max(0, target - machine); }
    } else { loc = num(k.avgTop3) * curRate * months; }
    const total = (machine != null) ? (loc + machine) : null;
    const yearNet = (obratBez - servis - najem - energie) * 12;
    let commission = null;
    if (rep.zpusob_vypoctu === 'fix') commission = rate;
    else if (rep.zpusob_vypoctu === 'celkova') commission = Math.round((total || 0) * rate / 100);
    else commission = Math.round((loc || 0) * rate / 100);
    const navratnost = (total > 0 && yearNet > 0) ? (Math.round(total / yearNet * 10) / 10) : null;
    const buyback = (total != null) ? Math.round(total * buybackPct / 100) : null;
    const profit5 = (total != null) ? Math.round(buybackYears * yearNet + total * buybackPct / 100) : null;
    const photo = (cfg.photos && cfg.photos.length) ? cfg.photos[0] : null;
    return Object.assign({ code, label: k.label || code, verze: ver ? ver.toUpperCase() : null, total: total != null ? Math.round(total) : null, loc: Math.round(loc || 0), machine, obrat_bez: Math.round(obratBez), servis: Math.round(servis), servis_pct: svc, najem: Math.round(najem), energie: Math.round(energie), energie_pct: en, yearNet: Math.round(yearNet), profit5, buyback, buyback_pct: buybackPct, buyback_years: buybackYears, commission, navratnost, photo, vip: isVip }, resObj);
  });
  const objem = rows.reduce((a, r) => a + (r.total || 0), 0);
  const provize = rows.reduce((a, r) => a + (r.commission || 0), 0);
  const obratSum = rows.reduce((a, r) => a + (r.obrat_bez || 0), 0);
  // Ceník strojů (bez lokality) — z pricelistu + fotek verzí.
  const _rateM = Number(rep.sazba) || 0;
  const vpMap = (cs.versionPhotos && typeof cs.versionPhotos === 'object') ? cs.versionPhotos : {};
  const machines = ['v2', 'v3', 'v4'].map((v) => {
    const eurP = (pl[v] && pl[v].eur != null && isFinite(Number(pl[v].eur))) ? Number(pl[v].eur) : null;
    if (eurP == null) return null;
    const priceCzk = Math.round(eurP * eur);
    const commission = (rep.zpusob_vypoctu === 'fix') ? _rateM : Math.round(priceCzk * _rateM / 100);
    return { ver: v.toUpperCase(), priceCzk, photo: vpMap[v] || null, commission };
  }).filter(Boolean);
  return {
    rep: _sanitizeRep(rep),
    lokality: rows,
    machines: machines,
    currency: 'CZK',
    kpi: { pocet: codes.length, objem: Math.round(objem), provize: Math.round(provize), obrat: Math.round(obratSum), sazba: rep.sazba, zpusob_vypoctu: rep.zpusob_vypoctu, splatnost: rep.splatnost },
  };
}

// GET /api/compounder/external-reps/me — data portálu (token v ?t= nebo Authorization: Bearer)
router.get('/external-reps/me', async (req, res, next) => {
  try {
    const token = String(req.query.t || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '');
    const repId = verifyExtRepToken(token);
    if (!repId) return res.status(401).json({ error: 'Neplatné nebo vypršelé přihlášení.' });
    const arr = await _loadExternalReps();
    const rep = arr.find((r) => Number(r.id) === repId);
    if (!rep) return res.status(404).json({ error: 'Obchodník nenalezen.' });
    if (rep.stav !== 'aktivni') return res.status(403).json({ error: 'Účet není aktivní.' });
    _repActivity(repId).catch(() => {});
    const data = await _extRepPortalData(rep);
    try {
      const selfLeadId = await _ensureRepSelfLead(rep);
      if (selfLeadId) data.self_portal_url = _extPortalBase() + '/portal?t=' + makeLoginToken(selfLeadId, 365 * 24 * 3600 * 1000);
    } catch (e) { /* ukázkový lead je best-effort */ }
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/compounder/external-reps/:id/send-login — pošle přihlašovací údaje e-mailem
router.post('/external-reps/:id/send-login', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const arr = await _loadExternalReps();
    const rep = arr.find((r) => Number(r.id) === id);
    if (!rep) return res.status(404).json({ error: 'Obchodník nenalezen.' });
    if (!rep.email) return res.status(400).json({ error: 'Obchodník nemá vyplněný e-mail.' });
    if (!rep.login) return res.status(400).json({ error: 'Obchodník nemá nastavené přihlašovací jméno.' });
    const base = (process.env.COMPOUNDER_BASE_URL || 'https://www.compounder.world').replace(/\/+$/, '');
    const portalUrl = base + '/obchodnik-ext';
    const autoUrl = portalUrl + '?t=' + encodeURIComponent(makeExtRepToken(rep.id, 30 * 24 * 3600 * 1000));
    const from = process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || process.env.INVOICE_IMAP_USER;
    const jmeno = String(rep.jmeno || '').trim();
    const body = 'Dobrý den' + (jmeno ? (', ' + jmeno) : '') + ',\n\n'
      + 'zde je přístup do vašeho obchodního portálu.\n\n'
      + 'Adresa portálu: ' + portalUrl + '\n'
      + 'Přihlašovací jméno: ' + rep.login + '\n'
      + 'Heslo vám bylo předáno zvlášť.\n\n'
      + 'Tlačítkem níže se přihlásíte jedním klikem (odkaz je platný 30 dní a je osobní — nesdílejte ho).';
    await sendMail({
      to: rep.email, from, fromName: compounderMailFromName(),
      replyTo: process.env.COMPOUNDER_MAIL_REPLYTO || from,
      brand: 'compounder',
      subject: 'Přístup do portálu obchodníka',
      preheader: 'Vaše přihlašovací údaje a odkaz na portál.',
      body,
      link: autoUrl,
      linkLabel: 'Otevřít portál obchodníka',
    });
    // Zaznamenej odeslání do záznamu obchodníka.
    const i = arr.findIndex((r) => Number(r.id) === id);
    if (i !== -1) { arr[i] = Object.assign({}, arr[i], { login_sent_at: new Date().toISOString(), login_sent_count: (Number(arr[i].login_sent_count) || 0) + 1 }); await _saveExternalReps(arr, req.user && req.user.id); }
    res.json({ ok: true, email: rep.email });
  } catch (err) { next(err); }
});

// ─── Kontakty externího obchodníka (token, portál obchodníka) ────────────────
function _extRepTokenFrom(req) {
  return String((req.body && req.body.t) || req.query.t || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '');
}
function _extPortalBase() {
  return (process.env.COMPOUNDER_BASE_URL || 'https://www.compounder.world').replace(/\/+$/, '');
}

// Do-not-contact: kontakt je blokovaný, pokud jeho e-mail nebo telefon je v compounder_blocklist.
async function _isBlocked(email, phone) {
  const em = String(email || '').trim().toLowerCase();
  const ph = String(phone || '').replace(/\D/g, '').slice(-9);
  const or = [];
  if (em && /.+@.+\..+/.test(em)) or.push({ email: em });
  if (ph && ph.length >= 6) or.push({ phone: ph });
  if (!or.length) return false;
  const hit = await prisma.compounderBlocklist.findFirst({ where: { OR: or }, select: { id: true } }).catch(() => null);
  return !!hit;
}

// GET /api/compounder/blocklist?search=&limit=&offset= — výpis do-not-contact seznamu
router.get('/blocklist', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.search || '').trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    let where = {};
    if (q) {
      const or = [{ email: { contains: q.toLowerCase() } }];
      const ph = q.replace(/\D/g, '');
      if (ph) or.push({ phone: { contains: ph } });
      where = { OR: or };
    }
    const [total, items] = await Promise.all([
      prisma.compounderBlocklist.count({ where }),
      prisma.compounderBlocklist.findMany({ where, orderBy: { id: 'asc' }, skip: offset, take: limit, select: { id: true, email: true, phone: true, note: true } }),
    ]);
    res.json({ total, items });
  } catch (err) { next(err); }
});

// POST /api/compounder/blocklist — ruční přidání záznamu
router.post('/blocklist', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase() || null;
    const phone = String(b.phone || '').replace(/\D/g, '').slice(-9) || null;
    if (!email && !phone) return res.status(400).json({ error: 'Zadej e-mail nebo telefon.' });
    const rec = await prisma.compounderBlocklist.create({ data: { email, phone, note: 'ručně' } });
    res.status(201).json(rec);
  } catch (err) { next(err); }
});

// DELETE /api/compounder/blocklist/:id — odebrání záznamu
router.delete('/blocklist/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné ID' });
    await prisma.compounderBlocklist.delete({ where: { id } }).catch(() => null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/compounder/external-reps/me/leads — vlastní kontakty
router.get('/external-reps/me/leads', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const where = { external_rep_id: repId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.search) { const q = String(req.query.search); where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }]; }
    const leads = await prisma.compounderLead.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
    await enrichWarmth(leads);
    const base = _extPortalBase();
    leads.forEach((l) => { l.portal_url = base + '/portal?t=' + makeLoginToken(l.id); });
    res.json(leads);
  } catch (err) { next(err); }
});

// POST /api/compounder/external-reps/me/leads — nový kontakt (do Compounderu, označený jako od externího obchodníka)
router.post('/external-reps/me/leads', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 255);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 255);
    const phone = b.phone ? String(b.phone).trim().slice(0, 40) : null;
    const lang = b.lang ? String(b.lang).trim().toLowerCase().slice(0, 10) : null;
    if (email && email.indexOf('@') === -1) return res.status(400).json({ error: 'Neplatný e-mail.' });
    if (!email && !phone) return res.status(400).json({ error: 'Zadej aspoň e-mail nebo telefon.' });
    const dupOr = [];
    if (email) dupOr.push({ email: { equals: email, mode: 'insensitive' } });
    if (phone) dupOr.push({ phone: phone });
    if (name) dupOr.push({ name: { equals: name, mode: 'insensitive' } });
    const existing = dupOr.length ? await prisma.compounderLead.findFirst({ where: { OR: dupOr }, select: { id: true } }) : null;
    if (existing) return res.status(409).json({ error: 'Tento kontakt už je v systému.' });
    if (await _isBlocked(email, phone)) return res.status(409).json({ error: 'Tento kontakt je na seznamu „neoslovovat" — nelze ho přidat.' });
    const lead = await prisma.compounderLead.create({
      data: { name: name || email || phone, email: email || null, role: 'compounder', lang, phone, source: 'obchodnik_ext', status: 'new', external_rep_id: repId },
      select: { id: true, name: true, email: true, phone: true, status: true },
    });
    _repActivity(repId, 'Založil kontakt: ' + (lead.name || ''), 'contacts_created').catch(() => {});
    res.status(201).json({ ok: true, lead, portal_url: _extPortalBase() + '/portal?t=' + makeLoginToken(lead.id) });
  } catch (err) { next(err); }
});

// PATCH /api/compounder/external-reps/me/leads/:id — změna stavu / poznámky / aktivita (jen vlastní)
router.patch('/external-reps/me/leads/:id', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const id = Number(req.params.id);
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, external_rep_id: true, activity_log: true } });
    if (!lead || lead.external_rep_id !== repId) return res.status(404).json({ error: 'Kontakt nenalezen.' });
    const b = req.body || {};
    const data = {};
    if (b.status && ['new', 'contacted', 'qualified', 'converted', 'rejected'].indexOf(b.status) !== -1) data.status = b.status;
    if (b.notes !== undefined) data.notes = (b.notes === null) ? null : String(b.notes).slice(0, 5000);
    if (b.activity) { const line = '[' + new Date().toLocaleString('cs-CZ') + '] ' + String(b.activity).slice(0, 500); data.activity_log = (lead.activity_log ? (lead.activity_log + '\n') : '') + line; }
    if (b.sections !== undefined) { const a = Array.isArray(b.sections) ? b.sections : String(b.sections || '').split(','); data.visible_sections = a.map((x) => String(x).trim()).filter(Boolean).join(','); }
    if (b.templates !== undefined) { const a = Array.isArray(b.templates) ? b.templates : String(b.templates || '').split(','); data.visible_templates = a.map((x) => String(x).trim()).filter(Boolean).join(','); }
    if (b.show_revenue_stats !== undefined) data.show_revenue_stats = !!b.show_revenue_stats;
    const upd = await prisma.compounderLead.update({ where: { id }, data });
    _repActivity(repId, 'Upravil kontakt #' + id, null).catch(() => {});
    res.json({ ok: true, lead: upd });
  } catch (err) { next(err); }
});

// POST /api/compounder/external-reps/me/leads/:id/send-access — pošle zákazníkovi přístup e-mailem (jen vlastní)
router.post('/external-reps/me/leads/:id/send-access', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const id = Number(req.params.id);
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, name: true, email: true, lang: true, external_rep_id: true } });
    if (!lead || lead.external_rep_id !== repId) return res.status(404).json({ error: 'Kontakt nenalezen.' });
    if (!lead.email) return res.status(400).json({ error: 'Kontakt nemá e-mail.' });
    const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
    await sendPortalLogin({ name: lead.name, email: lead.email, lang: lead.lang }, url);
    const updated = await prisma.compounderLead.update({ where: { id }, data: { access_sent_count: { increment: 1 }, access_last_sent_at: new Date() }, select: { access_sent_count: true, access_last_sent_at: true } });
    _repActivity(repId, 'Odeslal přístup e-mailem: ' + (lead.name || lead.email), null).catch(() => {});
    res.json({ ok: true, access_sent_count: updated.access_sent_count, access_last_sent_at: updated.access_last_sent_at });
  } catch (err) { next(err); }
});

// POST /api/compounder/external-reps/me/leads/:id/access-link — přístupový odkaz + text pro WhatsApp (jen vlastní)
router.post('/external-reps/me/leads/:id/access-link', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const id = Number(req.params.id);
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, name: true, phone: true, lang: true, external_rep_id: true } });
    if (!lead || lead.external_rep_id !== repId) return res.status(404).json({ error: 'Kontakt nenalezen.' });
    if (!lead.phone) return res.status(400).json({ error: 'Kontakt nemá telefon.' });
    const url = `${portalBase()}/portal?t=${makeLoginToken(lead.id)}`;
    const code = String(lead.lang || 'cs').toLowerCase().split(/[-_]/)[0];
    const msgFn = WA_MSG[code] || WA_MSG.cs;
    const message = msgFn(lead.name || '', url);
    let wa = String(lead.phone).replace(/[^\d]/g, ''); if (wa.startsWith('00')) wa = wa.slice(2);
    const updated = await prisma.compounderLead.update({ where: { id }, data: { access_sent_count: { increment: 1 }, access_last_sent_at: new Date() }, select: { access_sent_count: true, access_last_sent_at: true } });
    _repActivity(repId, 'Poslal přístup na WhatsApp: ' + (lead.name || ''), null).catch(() => {});
    res.json({ ok: true, url, phone: wa, message, access_sent_count: updated.access_sent_count, access_last_sent_at: updated.access_last_sent_at });
  } catch (err) { next(err); }
});

// GET /api/compounder/external-reps/me/leads/:id/activity — cesta zákazníka / analytika (jen vlastní)
router.get('/external-reps/me/leads/:id/activity', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const id = Number(req.params.id);
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, external_rep_id: true } });
    if (!lead || lead.external_rep_id !== repId) return res.status(404).json({ error: 'Kontakt nenalezen.' });
    const reg = await prisma.compounderEvent.findFirst({ where: { event: 'register_success', props: { path: ['lead_id'], equals: id } }, orderBy: { created_at: 'asc' }, select: { sid: true } });
    const or = [{ props: { path: ['lead_id'], equals: id } }];
    if (reg && reg.sid) or.push({ sid: reg.sid });
    const events = (await prisma.compounderEvent.findMany({ where: { OR: or }, orderBy: { created_at: 'desc' }, take: 500 })).reverse();
    const sections = {}; let portalOpened = false; let totalMs = 0;
    events.forEach((e) => { const p = e.props || {}; if (e.event === 'section_view' && p.section) sections[p.section] = (sections[p.section] || 0) + 1; if (e.event === 'portal_view') portalOpened = true; if (e.event === 'page_leave' && p.ms) totalMs += Number(p.ms) || 0; });
    res.json({ count: events.length, portalOpened, totalMs, sections, events: events.map((e) => ({ event: e.event, props: e.props, at: e.created_at })) });
  } catch (err) { next(err); }
});

// GET /api/compounder/external-reps/me/profile — vlastní profil obchodníka
router.get('/external-reps/me/profile', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const arr = await _loadExternalReps();
    const rep = arr.find((r) => Number(r.id) === repId);
    if (!rep) return res.status(404).json({ error: 'Nenalezeno.' });
    res.json({
      jmeno: rep.jmeno || '', login: rep.login || '',
      email: rep.email || '', telefon: rep.telefon || '', adresa: rep.adresa || '',
      fakturacni_adresa: rep.fakturacni_adresa || '',
      notify_email: rep.notify_email || '',
      notify_contact_open: !!rep.notify_contact_open,
      notify_contact_request: rep.notify_contact_request !== false,
      notify_reservation: rep.notify_reservation !== false,
      has_password: !!rep.password_hash,
    });
  } catch (err) { next(err); }
});

// PUT /api/compounder/external-reps/me/profile — úprava vlastního profilu
router.put('/external-reps/me/profile', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const b = req.body || {};
    const arr = await _loadExternalReps();
    const i = arr.findIndex((r) => Number(r.id) === repId);
    if (i === -1) return res.status(404).json({ error: 'Nenalezeno.' });
    const rep = Object.assign({}, arr[i]);
    if (b.email !== undefined) rep.email = String(b.email || '').trim().slice(0, 255) || null;
    if (b.telefon !== undefined) rep.telefon = String(b.telefon || '').trim().slice(0, 60) || null;
    if (b.adresa !== undefined) rep.adresa = String(b.adresa || '').trim().slice(0, 400) || null;
    if (b.fakturacni_adresa !== undefined) rep.fakturacni_adresa = String(b.fakturacni_adresa || '').trim().slice(0, 400) || null;
    if (b.notify_email !== undefined) rep.notify_email = String(b.notify_email || '').trim().slice(0, 255) || null;
    if (b.notify_contact_open !== undefined) rep.notify_contact_open = !!b.notify_contact_open;
    if (b.notify_contact_request !== undefined) rep.notify_contact_request = !!b.notify_contact_request;
    if (b.notify_reservation !== undefined) rep.notify_reservation = !!b.notify_reservation;
    arr[i] = rep;
    await _saveExternalReps(arr, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/compounder/external-reps/me/password — změna vlastního hesla
router.post('/external-reps/me/password', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const pw = String((req.body && req.body.password) || '');
    if (pw.length < 4) return res.status(400).json({ error: 'Heslo musí mít aspoň 4 znaky.' });
    const arr = await _loadExternalReps();
    const i = arr.findIndex((r) => Number(r.id) === repId);
    if (i === -1) return res.status(404).json({ error: 'Nenalezeno.' });
    arr[i] = Object.assign({}, arr[i], { password_hash: await bcrypt.hash(pw, 12) });
    await _saveExternalReps(arr, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/compounder/external-reps/me/leads/:id/offer-preview — nabídka lokalit, kterou lead vidí (jen vlastní)
router.get('/external-reps/me/leads/:id/offer-preview', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const id = Number(req.params.id);
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, external_rep_id: true } });
    if (!lead || lead.external_rep_id !== repId) return res.status(404).json({ error: 'Kontakt nenalezen.' });
    res.json(await buildOfferedLocations(id, { includeHidden: true }));
  } catch (err) { next(err); }
});

// GET /api/compounder/external-reps/me/kiosk-revenue?code=&t= — tržby lokality pro obchodníka
router.get('/external-reps/me/kiosk-revenue', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Chybí kód lokality.' });
    const arr = await _loadExternalReps();
    const rep = arr.find((r) => Number(r.id) === repId);
    if (!rep) return res.status(404).json({ error: 'Obchodník nenalezen.' });
    const cfgMap = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
    const isVip = Array.isArray(rep.lokality) && rep.lokality.map(String).indexOf(code) !== -1;
    const isOffered = !!(cfgMap[code] && cfgMap[code].forSale);
    if (!isVip && !isOffered) return res.status(403).json({ error: 'K této lokalitě nemáte přístup.' });
    _repActivity(repId, 'Zobrazil tržby: ' + code, 'revenue_views').catch(() => {});
    const data = await _computeKioskRevenue(code, req.query.fresh === '1');
    return res.json(data);
  } catch (err) {
    if (err.code === 'SIS_NOT_CONFIGURED') return res.status(503).json({ error: 'SIS API není nakonfigurováno.' });
    if (err.code === 'BAD_CODE') return res.status(400).json({ error: 'Neplatný kód kiosku.' });
    return next(err);
  }
});

// GET /api/compounder/external-reps/me/kiosk-revenue/transactions?code=&period=&t= — drill-down transakcí
router.get('/external-reps/me/kiosk-revenue/transactions', async (req, res, next) => {
  try {
    const repId = verifyExtRepToken(_extRepTokenFrom(req));
    if (!repId) return res.status(401).json({ error: 'Neplatné přihlášení.' });
    const code = String(req.query.code || '').trim();
    const period = String(req.query.period || '').trim();
    if (!code) return res.status(400).json({ error: 'Chybí kód lokality.' });
    const arr = await _loadExternalReps();
    const rep = arr.find((r) => Number(r.id) === repId);
    if (!rep) return res.status(404).json({ error: 'Obchodník nenalezen.' });
    const cfgMap = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
    const isVip = Array.isArray(rep.lokality) && rep.lokality.map(String).indexOf(code) !== -1;
    const isOffered = !!(cfgMap[code] && cfgMap[code].forSale);
    if (!isVip && !isOffered) return res.status(403).json({ error: 'K této lokalitě nemáte přístup.' });
    const data = await _computeKioskPeriodTx(code, period);
    return res.json(data);
  } catch (err) {
    if (err.code === 'SIS_NOT_CONFIGURED') return res.status(503).json({ error: 'SIS API není nakonfigurováno.' });
    if (err.code === 'BAD_CODE' || err.code === 'BAD_PERIOD') return res.status(400).json({ error: 'Neplatný vstup.' });
    return next(err);
  }
});

// POST /api/compounder/kiosk-config/:code/photos → nahraje až 3 fotky lokality do R2
router.post('/kiosk-config/:code/photos', requireAuth, kioskPhotoUpload.array('photos', 3), async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().slice(0, 40);
    if (!code) return res.status(400).json({ error: 'Chybí kód lokality' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Žádné soubory' });

    const map = await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} });
    const next_ = (map && typeof map === 'object') ? { ...map } : {};
    const cur = next_[code] || {};
    const photos = Array.isArray(cur.photos) ? cur.photos.slice() : [];
    const newUrls = [];

    for (const f of files) {
      if (photos.length >= 3) break;
      if (!/^image\//.test(f.mimetype || '')) continue;
      const ext = (f.mimetype === 'image/png') ? '.png' : (f.mimetype === 'image/webp') ? '.webp' : '.jpg';
      const key = 'compounding/' + code + '/' + crypto.randomUUID() + ext;
      const { url } = await r2Put(key, f.buffer, f.mimetype);
      if (url) { photos.push(url); newUrls.push(url); }
    }

    // Automatická detekce středu prádlomatu u nových fotek (Claude vision).
    const focusMap = (cur.photoFocus && typeof cur.photoFocus === 'object') ? { ...cur.photoFocus } : {};
    try {
      const { detectPhotoFocus } = require('../services/compounder/photo-focus');
      for (const u of newUrls) { const fp = await detectPhotoFocus(u); if (fp) focusMap[u] = fp; }
    } catch (e) { /* detekce je best-effort */ }

    next_[code] = { ...cur, photos: photos.slice(0, 3), photoFocus: focusMap };
    await setSetting(COMPOUNDING_KIOSKS_KEY, next_, {
      type: 'json', scope: 'compounding',
      description: 'Compounding — per-lokalita: verze kiosku + nájem + fotky',
      userId: req.user && req.user.id,
    });
    res.json({ ok: true, code, photos: next_[code].photos });
  } catch (err) {
    if (err && err.status === 503) return res.status(503).json({ error: 'Úložiště fotek (R2) není nakonfigurované.' });
    next(err);
  }
});

// POST /api/compounder/version-photo/:ver → nahraje obrázek verze kiosku (v2/v3/v4) do R2
router.post('/version-photo/:ver', requireAuth, kioskPhotoUpload.single('photo'), async (req, res, next) => {
  try {
    const ver = String(req.params.ver || '').toLowerCase();
    if (['v2', 'v3', 'v4'].indexOf(ver) === -1) return res.status(400).json({ error: 'Neplatná verze.' });
    const fl = req.file;
    if (!fl || !/^image\//.test(fl.mimetype || '')) return res.status(400).json({ error: 'Nahraj obrázek.' });
    const ext = (fl.mimetype === 'image/png') ? '.png' : (fl.mimetype === 'image/webp') ? '.webp' : '.jpg';
    const key = 'compounding/versions/' + ver + '-' + crypto.randomUUID() + ext;
    const { url } = await r2Put(key, fl.buffer, fl.mimetype);
    if (!url) return res.status(503).json({ error: 'Úložiště (R2) není nakonfigurované.' });
    const cs = (await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT })) || {};
    const vp = (cs.versionPhotos && typeof cs.versionPhotos === 'object') ? { ...cs.versionPhotos } : {};
    vp[ver] = url;
    await setSetting(COMPOUNDING_SETTINGS_KEY, { ...cs, versionPhotos: vp }, { type: 'json', scope: 'compounding', description: 'Compounding — nastavení + fotky verzí', userId: req.user && req.user.id });
    res.json({ ok: true, ver, url });
  } catch (err) {
    if (err && err.status === 503) return res.status(503).json({ error: 'Úložiště (R2) není nakonfigurované.' });
    next(err);
  }
});

// Notifikace na nový lead. Cíl = env COMPOUNDER_NOTIFY_USER_ID (konkrétní kompetentní
// osoba), jinak fallback na všechny super-adminy (ať Tomáš dostane upozornění i bez configu).
// Vytvoří in-app notifikaci (zvonek + SSE realtime); chyba se jen zaloguje.
// Cíloví uživatelé notifikací = Jan & Tomáš (COMPOUNDER_OWNER_EMAILS / _IDS),
// fallback super-admini. Sdíleno pro nový lead i žádost o kontakt.
async function resolveOwnerUserIds() {
  const envIds = (process.env.COMPOUNDER_NOTIFY_USER_IDS || '')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (envIds.length) return envIds;
  const ownerEmails = (process.env.COMPOUNDER_OWNER_EMAILS || 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const persons = await prisma.person.findMany({
    where: { user_id: { not: null }, OR: ownerEmails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) },
    select: { user_id: true },
  });
  const ids = persons.map((p) => p.user_id).filter(Boolean);
  if (ids.length) return ids;
  const admins = await prisma.user.findMany({ where: { is_super_admin: true }, select: { id: true } });
  return admins.map((u) => u.id);
}
async function notifyNewLead(leadId, d) {
  const userIds = await resolveOwnerUserIds();
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
    replyTo: process.env.COMPOUNDER_MAIL_REPLYTO || from,
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
    replyTo: process.env.COMPOUNDER_MAIL_REPLYTO || from,
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
  const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=' + encodeURIComponent(address);
  const j = await locFetchJson(url);
  if (!Array.isArray(j) || !j.length) return null;
  const x = j[0];
  const lat = parseFloat(x.lat), lon = parseFloat(x.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cc = (x.address && x.address.country_code) ? String(x.address.country_code).toLowerCase() : '';
  const country = (x.address && x.address.country) || '';
  return { lat, lon, display_name: x.display_name || address, country_code: cc, country: country };
}
// Regionální zvyk prát ve veřejných prádelnách → typický počet zákazníků/den.
function regionBenchmark(cc) {
  var west = ['gb', 'ie', 'fr', 'es', 'pt', 'it', 'be', 'nl', 'lu', 'mt', 'cy'];
  var east = ['bg', 'ro', 'hr', 'rs', 'lt', 'lv', 'ee', 'ua', 'gr', 'md', 'ba', 'mk', 'al', 'me', 'xk'];
  if (west.indexOf(cc) >= 0) return { region: 'West', perday: 12 };
  if (east.indexOf(cc) >= 0) return { region: 'East', perday: 6 };
  return { region: 'Central', perday: 7.5 };
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
// Jedním dotazem: parkoviště + okolní podniky generující provoz (anchors).
async function osmNearby(lat, lon) {
  const q = '[out:json][timeout:25];(' +
    'nwr[amenity=parking](around:600,' + lat + ',' + lon + ');' +
    'nwr[shop~"^(supermarket|hypermarket|mall|department_store|convenience|wholesale)$"](around:700,' + lat + ',' + lon + ');' +
    'nwr[amenity~"^(marketplace|fuel)$"](around:700,' + lat + ',' + lon + ');' +
    ');out center 80;';
  const j = await overpassQuery(q);
  const els = (j && j.elements) || [];
  let parkCount = 0, parkNearest = null, nearestRetail = null;
  const anchors = [];
  const retail = { supermarket: 1, hypermarket: 1, mall: 1, department_store: 1, convenience: 1, wholesale: 1 };
  els.forEach((e) => {
    const ll = e.center || e; if (ll.lat == null) return;
    const t = e.tags || {};
    const d = haversineM(lat, lon, ll.lat, ll.lon);
    if (t.amenity === 'parking') {
      parkCount++;
      if (parkNearest == null || d < parkNearest) parkNearest = d;
      return;
    }
    const type = t.shop || t.amenity || '?';
    anchors.push({ name: t.name || t.brand || type, type: type, dist: d });
    if (retail[t.shop] && (nearestRetail == null || d < nearestRetail)) nearestRetail = d;
  });
  anchors.sort((a, b) => a.dist - b.dist);
  return {
    parking: { count: parkCount, nearest_m: parkNearest },
    anchors: { list: anchors.slice(0, 15), count: anchors.length, nearest_retail_m: nearestRetail },
  };
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
// GeoNames: populace obcí v okruhu (z národních statistik) — funguje po celé
// Evropě/světě a je výrazně úplnější než OSM. Vyžaduje free username
// v GEONAMES_USERNAME (geonames.org → Free Web Services).
async function geonamesPopulation(lat, lon, radiusKm) {
  const user = process.env.GEONAMES_USERNAME;
  if (!user) return null;
  const url = 'https://secure.geonames.org/findNearbyPlaceNameJSON?lat=' + lat + '&lng=' + lon +
    '&radius=' + radiusKm + '&maxRows=500&style=FULL&featureClass=P&username=' + encodeURIComponent(user);
  const j = await locFetchJson(url, null, 12000);
  if (!j || !Array.isArray(j.geonames)) return null;
  let total = 0; const places = [];
  j.geonames.forEach((g) => {
    const p = parseInt(g.population, 10);
    if (!Number.isFinite(p) || p <= 0) return;
    total += p;
    places.push({ name: g.name, population: p, place: g.fcodeName || g.fcode });
  });
  places.sort((a, b) => b.population - a.population);
  return { population: total, places: places };
}
// Nejdřív GeoNames (přesnější), fallback OpenStreetMap.
async function populationLookup(lat, lon, radiusKm) {
  const gn = await geonamesPopulation(lat, lon, radiusKm);
  if (gn && gn.population > 0) return Object.assign(gn, { source: 'GeoNames' });
  const osm = await osmPopulation(lat, lon, radiusKm * 1000);
  return Object.assign(osm, { source: 'OpenStreetMap' });
}
async function locationReportAI(facts, lang) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi analytik lokality pro venkovní samoobslužnou prádelnu (Compounder Machine). Z dodaných dat napiš stručné, věcné zhodnocení místa. Odpověz POUZE platným JSON bez markdownu ve tvaru: {"verdict":"<2-4 slova>","scorePct":<celé 0-100>,"summary":"<2-4 věty>","factors":[{"label":"<krátké>","value":"<krátké>","good":<true|false>}],"recommendation":"<1-2 věty>","estPerDay":<celé číslo, odhad zákazníků/den>}. Klíčový faktor je required_pct = jaké procento populace v okruhu musí přijít prát; čím nižší, tím lépe (do 1,5 % velmi dobré, 1,5-3 % dobré, 3-6 % náročné, >6 % velmi náročné). Zohledni i absolutní spádovou populaci v okruhu 15 km: ~15 000 a více je dobré, ~10 000 je hraniční a výrazně pod 10 000 je rizikové (málo lidí provoz neuživí). Zohledni také regionální zvyk prát ve veřejných prádelnách (pole region a region_perday_norm): v západní Evropě jsou lidé zvyklejší (IE, GB, ES, FR apod. ~12 zákazníků/den), střední Evropa ~7,5/den, východní Evropa ~6/den. Porovnej předpokládaný per_day s region_perday_norm — pokud je per_day pod regionálním zvykem, je plán reálnější (vyšší šance), pokud výrazně nad, je optimistický; krátce to zmiň. V datech je i seznam okolních podniků (anchors) s typem a vzdáleností — supermarkety, hypermarkety, obchodní domy, tržnice a čerpací stanice generují denní provoz lidí; odhadni z nich potenciální denní průtok zákazníků kolem místa a zohledni ho ve skóre (vyšší provoz = vyšší šance) a přidej faktor o provozu/návštěvnosti v okolí. Parkoviště poblíž je zásadní plus; pokud parking_immediate je true (místo je přímo u velkého obchodu), ber parkování jako bezprostřední (u vchodu). Populace pochází ze zdroje population_source (GeoNames je výrazně přesnější než OpenStreetMap) a je orientační — u velkých měst zasahujících jen částečně do okruhu může být nadhodnocená, u malých obcí bez dat naopak podhodnocená; krátce to zmiň. Pokud population_15km = 0, jde o chybějící data — buď opatrný. Pole estPerDay = realistický odhad zákazníků/den pro jeden kiosk na této lokalitě: vyjdi z region_perday_norm a uprav podle velikosti obce, okolního provozu (anchors) a parkování; spádová populace je sekundární. Kalibrace: středoevropské okresní město ~10 tis. obyvatel se supermarkety v okolí ≈ 9 zákazníků/den. Piš v jazyce s kódem: ' + lang + '.';
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
      estPerDay: (j.estPerDay != null && isFinite(j.estPerDay)) ? Math.max(0, Math.min(100, Math.round(Number(j.estPerDay)))) : null,
    };
  } catch (e) { return null; }
}
function locationReportFallback(facts, lang) {
  const rp = facts.required_pct;
  let score = 50;
  if (rp != null) score = rp <= 1.5 ? 85 : rp < 3 ? 60 : rp < 6 ? 38 : 18;
  if (facts.parking_count > 0) score = Math.min(100, score + 6);
  // Absolutní práh spádové populace: ~15k dobré, ~10k hraniční, méně rizikové.
  var pop15 = facts.population_15km || 0;
  if (pop15 > 0 && pop15 < 10000) score = Math.min(score, 35);
  else if (pop15 >= 10000 && pop15 < 15000) score = Math.min(score, 55);
  // Regionální zvyk: per_day pod normou regionu = reálnější (+), výrazně nad = optimistické (−).
  var norm = facts.region_perday_norm;
  if (norm && facts.per_day) {
    if (facts.per_day <= norm) score = Math.min(100, score + 5);
    else if (facts.per_day > norm * 1.3) score = Math.max(0, score - 10);
  }
  const cs = lang === 'cs';
  const summary = cs
    ? ('V okruhu 15 km žije přibližně ' + facts.population_15km.toLocaleString('cs') + ' lidí. Pro ' + facts.monthly_customers + ' zákazníků měsíčně potřebuješ přesvědčit ' + (rp == null ? '— (chybí data)' : (rp + ' %')) + ' z nich. Parkoviště v okolí: ' + facts.parking_count + '. Čísla jsou orientační (OpenStreetMap).')
    : ('About ' + facts.population_15km.toLocaleString('en') + ' people live within 15 km. For ' + facts.monthly_customers + ' monthly customers you need ' + (rp == null ? '— (no data)' : (rp + ' %')) + ' of them. Nearby parking: ' + facts.parking_count + '. Figures are indicative (OpenStreetMap).');
  // Odhad zákazníků/den: regionální norma upravená o okolní provoz, parkování a populaci.
  var est = facts.region_perday_norm || 7.5;
  if (facts.anchor_count >= 4) est += 1; else if (facts.anchor_count >= 1) est += 0.5;
  if (facts.parking_immediate) est += 0.5;
  if (pop15 > 0 && pop15 < 8000) est -= 2; else if (pop15 > 0 && pop15 < 12000) est -= 1;
  est = Math.max(1, Math.round(est));
  return { verdict: cs ? 'Orientační' : 'Indicative', scorePct: score, summary, factors: [], recommendation: '', estPerDay: est };
}

// E-mail majitelům Best Series, když lead z portálu požádá o kontakt.
async function notifyOwnersContact(lead, phone, isDist) {
  const recipients = (process.env.COMPOUNDER_OWNER_EMAILS || 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const from = process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || process.env.INVOICE_IMAP_USER;
  const base = process.env.HOLYOS_BASE_URL || 'https://app.holyos.cz';
  const adminUrl = base + '/modules/prodejni-objednavky/index.html';
  const roleLabel = lead.role === 'distributor' ? 'Distributor' : 'Compounder';
  const subject = isDist
    ? ('Compounder: zájem o DISTRIBUCI — ' + (lead.name || lead.email))
    : ('Compounder: žádost o kontakt — ' + (lead.name || lead.email));
  const intro = isDist
    ? ((lead.name || '(bez jména)') + ' (' + roleLabel + ') má zájem o DISTRIBUCI a žádá o osobní kontakt.')
    : ((lead.name || '(bez jména)') + ' (' + roleLabel + ') žádá, abychom se s ním spojili.');
  const body =
    intro + '\n\n' +
    'Telefon: ' + phone + '\n' +
    'E-mail: ' + lead.email + '\n\n' +
    'Telefonní číslo je uložené u profilu kontaktu v administraci leadů — odtud mu můžeš zavolat.';
  for (const to of recipients) {
    await sendMail({
      to: to, from: from, fromName: compounderMailFromName(), brand: 'compounder',
      subject: subject, body: body, link: adminUrl, linkLabel: 'Otevřít kontakt',
    }).catch((e) => console.error('[compounder] owner mail ' + to + ':', e && e.message));
  }
}

// Začátek dnešního dne ve VELIN_TZ — shodné s velin.routes (klíč denního plánu).
function startOfTodayCmp() {
  const tz = process.env.VELIN_TZ || 'Europe/Prague';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(parts + 'T00:00:00Z');
}
// Vytvoří úkol "Zavolat …" na dnešek do Velínu (denní plán) Janovi/Tomášovi + push.
async function notifyContactTask(lead, phone, isDist) {
  const ownerEmails = (process.env.COMPOUNDER_OWNER_EMAILS || 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const persons = await prisma.person.findMany({
    where: { OR: ownerEmails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) },
    select: { id: true },
  });
  let personIds = persons.map((p) => p.id);
  if (!personIds.length) {
    const admins = await prisma.user.findMany({ where: { is_super_admin: true }, select: { person: { select: { id: true } } } });
    personIds = admins.map((a) => a.person && a.person.id).filter(Boolean);
  }
  if (!personIds.length) return;
  const today = startOfTodayCmp();
  const title = (isDist ? 'Zavolat zájemci o distribuci: ' : 'Zavolat kontaktu: ') + (lead.name || lead.email);
  const desc = 'Telefon: ' + phone + '\nE-mail: ' + lead.email + (isDist ? '\nZájem: distribuce' : '') + '\nZdroj: Compounder portál.';
  let notifyPerson = null;
  try { notifyPerson = require('../services/push/expo-push').notifyPerson; } catch (e) { /* push volitelný */ }
  for (const personId of personIds) {
    try {
      const plan = await prisma.dailyPlan.upsert({
        where: { person_id_date: { person_id: personId, date: today } },
        create: { person_id: personId, date: today, generated_by: 'manager', status: 'published' },
        update: {},
      });
      const task = await prisma.taskAssignment.create({
        data: {
          daily_plan_id: plan.id, person_id: personId,
          created_by: 'manager', source: 'manager',
          title: title, description: desc, priority: 2, status: 'proposed',
        },
      });
      // Push + zvonek řeší sjednocený compounderNotify.notifyContactRequest (bez duplicit).
      void task;
    } catch (e) { console.error('[compounder] velín task person ' + personId + ':', e && e.message); }
  }
}

// In-app notifikace (zvonek + Velín) majitelům při žádosti o kontakt.
async function notifyContactUsers(lead, phone, isDist) {
  let userIds = [];
  const envIds = (process.env.COMPOUNDER_NOTIFY_USER_IDS || '')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (envIds.length) {
    userIds = envIds;
  } else {
    const ownerEmails = (process.env.COMPOUNDER_OWNER_EMAILS || 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const persons = await prisma.person.findMany({
      where: { user_id: { not: null }, OR: ownerEmails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) },
      select: { user_id: true },
    });
    userIds = persons.map((p) => p.user_id).filter(Boolean);
  }
  if (!userIds.length) {
    const admins = await prisma.user.findMany({ where: { is_super_admin: true }, select: { id: true } });
    userIds = admins.map((u) => u.id);
  }
  const roleLabel = lead.role === 'distributor' ? 'Distributor' : 'Compounder';
  const title = isDist ? ('📞 Zájem o distribuci: ' + (lead.name || lead.email)) : ('📞 Žádost o kontakt: ' + (lead.name || lead.email));
  const body = roleLabel + ' · tel: ' + phone;
  for (const userId of userIds) {
    await createNotification({
      userId, type: 'compounder_contact', title, body,
      link: '/modules/prodejni-objednavky/index.html',
      meta: { lead_id: lead.id, phone: phone, intent: isDist ? 'distributor' : 'contact' },
    }).catch(() => {});
  }
}

// AI vyhodnocení leada (pro administraci, výstup česky).
async function leadEvalAI(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
    const sys = 'Jsi obchodní analytik. Z aktivity zájemce (lead) na webu compounder.world (prémiové samoobslužné prádelny jako investiční aktivum) vyhodnoť, jak je "zahřátý" a o jak velkém byznysu uvažuje. Data: počet eventů, čas na webu, jestli otevřel Portal, navštívené sekce (sections), počty typů eventů (event_counts), kontroly lokalit (location_checks – populace/potřebný podíl/skóre), jestli požádal o kontakt (requested_contact / has_phone), stav a poznámky. Silné signály zájmu: požádal o kontakt, opakované kontroly lokalit, čas v ekonomice/návratnosti/Gold & Diamond, otevřený Portal. Odpověz POUZE platným JSON bez markdownu: {"warmthPct":<celé 0-100>,"warmth":"<2-3 slova, např. Studený/Vlažný/Zahřátý/Horký>","summary":"<2-4 věty česky>","businessSize":"<krátce: o jakém rozsahu uvažuje, např. jeden kiosk / malá síť / regionální síť / nejasné>","signals":[{"label":"<krátké>","value":"<krátké>","good":<true|false>}]}. Pokud je minutes null nebo 0, čas na webu se nezměřil — neber to jako slabinu ani nezájem, jen to nezmiňuj. DŮLEŽITÉ: názvy sekcí v poli "sections" jsou už aktuální lidské názvy webu (např. Provozovatel, Investor, Distributor, Compounder Machine, Milníky, Lokalita). Odkazuj se VÝHRADNĚ na tyto názvy z dat; nevymýšlej ani nepoužívej žádné jiné/staré názvy sekcí. Kompletní aktuální struktura webu je v poli "site_sections". Piš česky.';
    const usr = 'Lead (JSON):\n' + JSON.stringify(facts);
    const msg = await client.messages.create({ model, max_tokens: 700, system: sys, messages: [{ role: 'user', content: usr }] });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    const j = JSON.parse(text);
    return {
      warmthPct: Math.max(0, Math.min(100, Math.round(Number(j.warmthPct) || 0))),
      warmth: String(j.warmth || '').slice(0, 40),
      summary: String(j.summary || '').slice(0, 1200),
      businessSize: String(j.businessSize || '').slice(0, 200),
      signals: Array.isArray(j.signals) ? j.signals.slice(0, 8).map((s) => ({ label: String(s.label || '').slice(0, 60), value: String(s.value || '').slice(0, 80), good: !!s.good })) : [],
    };
  } catch (e) { return null; }
}
function leadEvalFallback(facts) {
  let s = 15;
  if (facts.requested_contact || facts.has_phone) s += 35;
  if (facts.portal_opened) s += 15;
  s += Math.min(20, Object.keys(facts.sections || {}).length * 3);
  if ((facts.location_checks || []).length > 0) s += 12;
  if (facts.minutes >= 5) s += 8;
  s = Math.max(0, Math.min(100, s));
  const warmth = s >= 70 ? 'Horký' : s >= 45 ? 'Zahřátý' : s >= 25 ? 'Vlažný' : 'Studený';
  const summary = 'Lead s ' + facts.total_events + ' eventy' + (facts.portal_opened ? ', otevřel Portal' : '') +
    ((facts.location_checks || []).length ? (', ' + facts.location_checks.length + 'x kontrola lokality') : '') +
    (facts.requested_contact ? ', požádal o telefonický kontakt' : '') + '.';
  return { warmthPct: s, warmth: warmth, summary: summary, businessSize: '—', signals: [] };
}


// ─── Smlouvy k lokalitě prádlomatu (Compounding tab) ─────────────────────────
// Bezstavové: data lokality přijdou z frontendu (SIS kiosk-values), ne z DB.
// GET prefill — schéma polí + předvyplněné hodnoty (prodávající = naše firma,
// protistrana zůstává prázdná k ručnímu doplnění).
router.get('/contracts/:type(kupni|servisni|rezervacni)/prefill', requireAuth, async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!contracts.isValidType(type)) return res.status(400).json({ error: 'Neznámý typ smlouvy' });
    const q = req.query || {};
    const code = String(q.code || '').slice(0, 40);
    const label = String(q.label || '').slice(0, 300);
    const priceNum = (q.price != null && q.price !== '') ? Number(q.price) : null;
    const avgNum = (q.avg != null && q.avg !== '') ? Number(q.avg) : null;
    const monthsNum = (q.months != null && q.months !== '') ? Number(q.months) : null;
    const machineNum = (q.machine != null && q.machine !== '') ? Number(q.machine) : null;
    const ver = String(q.ver || '').slice(0, 4);
    const _cs = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT }).catch(() => null);
    const _servicePct = (_cs && Number.isFinite(_cs.servicePct)) ? _cs.servicePct : 15;
    const _buybackPct = (_cs && Number.isFinite(_cs.buybackPct)) ? _cs.buybackPct : 65;
    const _buybackYears = (_cs && Number.isFinite(_cs.buybackYears)) ? _cs.buybackYears : 5;
    const pseudoSite = {
      name: code ? ('Lokalita ' + code) : (label || ''),
      address: label, city: '', zip: '', country: 'CZ',
      purchase_price: (priceNum != null && isFinite(priceNum)) ? priceNum : null,
      pradlomat_ref: code, contacts: [],
      _avgTurnover: (avgNum != null && isFinite(avgNum)) ? avgNum : null,
      _locationMonths: (monthsNum != null && isFinite(monthsNum)) ? monthsNum : 12,
      _version: ver || null,
      _machinePrice: (machineNum != null && isFinite(machineNum)) ? machineNum : null,
      _servicePct,
      _buybackPct,
      _buybackYears,
    };
    const our = await getOurCompany().catch(() => null);
    const pf = contracts.getPrefill(type, pseudoSite, our);
    if (pf && pf.values && !pf.values.seller_bank) pf.values.seller_bank = OUR_BANK_LINE;
    res.json(pf);
  } catch (err) { next(err); }
});

// POST vygenerovat PDF smlouvy z (upravených) polí. Vrací PDF ke stažení.
router.post('/contracts/:type(kupni|servisni|rezervacni)/pdf', requireAuth, async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!contracts.isValidType(type)) return res.status(400).json({ error: 'Neznámý typ smlouvy' });
    const fields = (req.body && req.body.fields) || {};
    let pdf;
    try {
      pdf = await contracts.generateContractPdf(type, fields);
    } catch (e) {
      console.error('[compounder-contract-pdf] Generování selhalo:', e);
      return res.status(500).json({ error: 'PDF generování selhalo: ' + e.message });
    }
    const safe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    const base = safe(contracts.TYPE_LABEL[type]) + (req.body && req.body.code ? ('_' + safe(req.body.code)) : '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + base + '.pdf"');
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) { next(err); }
});



// ─── Evidence smluv u lokality (Compounding) ─────────────────────────────────
const CONTRACT_STATES = ['koncept', 'odeslano', 'vyplneno', 'k_podpisu', 'podepsano'];
function _safeContractName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

// GET seznam smluv u lokality (dle kódu)
router.get('/contracts/list', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.query.code || '').slice(0, 40);
    if (!code) return res.status(400).json({ error: 'Chybí kód lokality' });
    const rows = await prisma.compoundingContract.findMany({
      where: { kiosk_code: code },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, type: true, status: true, kiosk_label: true, fields: true,
        share_token: true, filled_at: true, signed_at: true,
        created_at: true, updated_at: true,
      },
    });
    res.json(rows);
  } catch (err) { next(err); }
});

// POST uložit koncept / aktualizovat smlouvu
router.post('/contracts/save', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const type = String(b.type || '');
    if (!contracts.isValidType(type)) return res.status(400).json({ error: 'Neznámý typ smlouvy' });
    const code = String(b.code || '').slice(0, 40);
    if (!code) return res.status(400).json({ error: 'Chybí kód lokality' });
    const fields = (b.fields && typeof b.fields === 'object') ? b.fields : {};
    let row;
    if (b.id) {
      row = await prisma.compoundingContract.update({
        where: { id: Number(b.id) },
        data: { fields, kiosk_label: b.label ? String(b.label).slice(0, 300) : undefined },
      });
    } else {
      row = await prisma.compoundingContract.create({
        data: {
          kiosk_code: code,
          kiosk_label: b.label ? String(b.label).slice(0, 300) : null,
          type, fields, status: 'koncept',
          created_by_id: (req.user && req.user.id) || null,
        },
      });
      compounderNotify.notifyContractEvent(prisma, { contract: row, event: 'created' }).catch(() => {});
    }
    res.json({ id: row.id, status: row.status });
  } catch (err) { next(err); }
});

// PATCH změna stavu smlouvy
router.patch('/contracts/:id(\\d+)/status', requireAuth, async (req, res, next) => {
  try {
    const status = String((req.body && req.body.status) || '');
    if (!CONTRACT_STATES.includes(status)) return res.status(400).json({ error: 'Neplatný stav' });
    const data = { status };
    if (status === 'podepsano') data.signed_at = new Date();
    const row = await prisma.compoundingContract.update({ where: { id: Number(req.params.id) }, data });
    const cEv = { odeslano: 'sent', vyplneno: 'filled', podepsano: 'signed' };
    if (cEv[status]) compounderNotify.notifyContractEvent(prisma, { contract: row, event: cEv[status] }).catch(() => {});
    res.json({ id: row.id, status: row.status });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Smlouva nenalezena' });
    next(err);
  }
});

// DELETE smlouvu
router.delete('/contracts/:id(\\d+)', requireAuth, async (req, res, next) => {
  try {
    await prisma.compoundingContract.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Smlouva nenalezena' });
    next(err);
  }
});

// POST archivovat / obnovit smlouvu — archivovaná se ZÁKAZNÍKOVI v portálu nezobrazí
// (skrytá), ale v HolyOS zůstává kvůli historii. Příznak fields._archived.
router.post('/contracts/:id(\\d+)/archive', requireAuth, async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Smlouva nenalezena' });
    const archived = !!(req.body && req.body.archived);
    const merged = Object.assign({}, row.fields || {});
    if (archived) merged._archived = true; else delete merged._archived;
    await prisma.compoundingContract.update({ where: { id: row.id }, data: { fields: merged } });
    res.json({ ok: true, archived });
  } catch (err) { next(err); }
});

// POST vygenerovat PDF z uložené smlouvy (volitelně z upravených polí)
// Starší auto-vytvořené rezervační smlouvy měly ve fields omylem uloženou celou
// obálku getPrefill ({type,label,groups,values,...}) místo plochých polí — PDF pak
// vycházelo prázdné. Tohle je srovná do plochého tvaru (podpisy zůstávají).
function _flattenLegacyContractFields(f) {
  if (!f || typeof f !== 'object') return {};
  if (!f.values || typeof f.values !== 'object' || !Array.isArray(f.groups)) return f;
  const flat = Object.assign({}, f.values);
  Object.keys(f).forEach((k) => {
    if (k !== 'type' && k !== 'label' && k !== 'groups' && k !== 'values') flat[k] = f[k];
  });
  // U starých rozbitých smluv doplníme chybějící údaje poskytovatele (Best Series).
  const sellerFallback = {
    seller_name: 'BEST SERIES s.r.o.',
    seller_address: 'Zámostní 1155/27, Slezská Ostrava, 71000 Ostrava',
    seller_ico: '05643724',
    seller_dic: 'CZ05643724',
    seller_bank: '221913663/0600',
  };
  Object.keys(sellerFallback).forEach((k) => { if (!flat[k]) flat[k] = sellerFallback[k]; });
  return flat;
}

// Částka slovy (česky), pro celé koruny. 60000 → „šedesát tisíc".
const _CZ_ONES = ['', 'jedna', 'dva', 'tři', 'čtyři', 'pět', 'šest', 'sedm', 'osm', 'devět', 'deset', 'jedenáct', 'dvanáct', 'třináct', 'čtrnáct', 'patnáct', 'šestnáct', 'sedmnáct', 'osmnáct', 'devatenáct'];
const _CZ_TENS = ['', '', 'dvacet', 'třicet', 'čtyřicet', 'padesát', 'šedesát', 'sedmdesát', 'osmdesát', 'devadesát'];
const _CZ_HUNDREDS = ['', 'sto', 'dvě stě', 'tři sta', 'čtyři sta', 'pět set', 'šest set', 'sedm set', 'osm set', 'devět set'];
function _czTriplet(n) {
  let s = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) s += _CZ_HUNDREDS[h];
  if (r) {
    if (s) s += ' ';
    if (r < 20) s += _CZ_ONES[r];
    else { s += _CZ_TENS[Math.floor(r / 10)]; if (r % 10) s += ' ' + _CZ_ONES[r % 10]; }
  }
  return s;
}
function czAmountWords(n) {
  n = Math.round(Number(n) || 0);
  if (n <= 0) return '';
  const out = [];
  const mil = Math.floor(n / 1000000);
  const th = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (mil) out.push(mil === 1 ? 'jeden milion' : (_czTriplet(mil) + (mil <= 4 ? ' miliony' : ' milionů')));
  if (th) out.push(th === 1 ? 'tisíc' : (_czTriplet(th) + (th >= 2 && th <= 4 ? ' tisíce' : ' tisíc')));
  if (rest) out.push(_czTriplet(rest));
  return out.join(' ');
}

// Částka slovy (anglicky), pro celé částky. 60000 → "sixty thousand".
const _EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const _EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function _enTriplet(n) {
  let s = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) s += _EN_ONES[h] + ' hundred';
  if (r) {
    if (s) s += ' ';
    if (r < 20) s += _EN_ONES[r];
    else { s += _EN_TENS[Math.floor(r / 10)]; if (r % 10) s += '-' + _EN_ONES[r % 10]; }
  }
  return s;
}
function enAmountWords(n) {
  n = Math.round(Number(n) || 0);
  if (n <= 0) return '';
  const out = [];
  const mil = Math.floor(n / 1000000);
  const th = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (mil) out.push(_enTriplet(mil) + ' million');
  if (th) out.push(_enTriplet(th) + ' thousand');
  if (rest) out.push(_enTriplet(rest));
  return out.join(' ');
}

// Zpětné doplnění starých (rozbitých) smluv při generování PDF: zástupci dle
// podpisů, adresa lokality ze SIS, podmínky rezervace z rezervace v DB.
async function _enrichLegacyContract(row, fields) {
  if (!(row.fields && row.fields.groups)) return fields; // jen legacy tvar
  // Zastoupen(a) = jména z uložených podpisů.
  if (!fields.seller_rep && fields._signature_bestseries && fields._signature_bestseries.name) {
    fields.seller_rep = fields._signature_bestseries.name;
  }
  if (!fields.buyer_rep && fields._signature_customer && fields._signature_customer.name) {
    fields.buyer_rep = fields._signature_customer.name;
  }
  if (row.kiosk_code) {
    const ki = await _sisKioskInfo(row.kiosk_code);
    if (ki.label) {
      fields.location_name = row.kiosk_code + ' — ' + ki.label;
      fields.location_address = ki.label;
    }
  }
  // Podmínky rezervace z poslední rezervace této lokality.
  if (row.type === 'rezervacni' && row.kiosk_code) {
    const resv = await prisma.locationReservation.findFirst({
      where: { kiosk_code: row.kiosk_code },
      orderBy: { created_at: 'desc' },
    }).catch(() => null);
    if (resv) {
      if (!fields.reservation_fee && resv.fee_total != null) {
        fields.reservation_fee = Math.round(resv.fee_total).toLocaleString('cs-CZ');
        fields.reservation_fee_currency = 'Kč';
        const words = czAmountWords(resv.fee_total);
        if (words) fields.reservation_fee_words = words + ' korun českých';
      }
      if (resv.days) fields.reservation_period = resv.days + ' dní';
      if (!fields.reserved_until && resv.reserved_until) {
        fields.reserved_until = new Date(resv.reserved_until).toLocaleDateString('cs-CZ');
      }
      fields.fee_due_days = ''; // splatnost = den podpisu
    }
  }
  return fields;
}

router.post('/contracts/:id(\\d+)/pdf', requireAuth, async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Smlouva nenalezena' });
    let fields = (req.body && req.body.fields) || _flattenLegacyContractFields(row.fields);
    // U starých rozbitých smluv doplň chybějící údaje (zástupci, lokalita, poplatek…).
    if (!(req.body && req.body.fields)) fields = await _enrichLegacyContract(row, fields);
    let pdf;
    try {
      pdf = await contracts.generateContractPdf(row.type, fields);
    } catch (e) {
      console.error('[contract-pdf] Generování selhalo:', e);
      return res.status(500).json({ error: 'PDF generování selhalo: ' + e.message });
    }
    const base = _safeContractName(contracts.TYPE_LABEL[row.type]) + '_' + _safeContractName(row.kiosk_code || ('id' + row.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + base + '.pdf"');
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) { next(err); }
});


// ─── Sdílený odkaz pro protistranu (vyplnění hlavičky) ───────────────────────
// POST vygenerovat/obnovit veřejný odkaz; nastaví stav na 'odeslano'.
router.post('/contracts/:id(\\d+)/share', requireAuth, async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Smlouva nenalezena' });
    const token = row.share_token || crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await prisma.compoundingContract.update({
      where: { id: row.id },
      data: {
        share_token: token,
        share_expires_at: expires,
        status: row.status === 'koncept' ? 'odeslano' : row.status,
      },
    });
    if (row.status === 'koncept') compounderNotify.notifyContractEvent(prisma, { contract: row, event: 'sent' }).catch(() => {});
    res.json({ url: buildShareUrl('/smlouva/' + token), token });
  } catch (err) { next(err); }
});

// GET veřejné (bez auth) — schéma hlavičky + případně už vyplněné hodnoty
router.get('/contracts/public/:token', async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { share_token: String(req.params.token || '') } });
    if (!row) return res.status(404).json({ error: 'Odkaz nenalezen nebo neplatný' });
    if (row.share_expires_at && new Date(row.share_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Platnost odkazu vypršela' });
    }
    const groups = contracts.SCHEMAS[row.type] || [];
    const buyerGroup = groups.find((g) => g.key === 'buyer');
    const fields = buyerGroup ? buyerGroup.fields : [];
    const values = {};
    const rowFields = _flattenLegacyContractFields(row.fields);
    fields.forEach((f) => { values[f.name] = (rowFields[f.name] != null) ? rowFields[f.name] : ''; });
    // Jazyk smlouvy → formulář zákazníka se zobrazí ve stejném jazyce (cs/en).
    const _cl = String((row.fields && row.fields._lang) || 'cs').toLowerCase();
    const _clEn = _cl.indexOf('cs') !== 0;
    const CT_LABEL_EN = { kupni: 'Purchase Agreement', servisni: 'Service Agreement', rezervacni: 'Reservation Agreement' };
    res.json({
      typeLabel: _clEn ? (CT_LABEL_EN[row.type] || 'Contract') : (contracts.TYPE_LABEL[row.type] || 'Smlouva'),
      kioskLabel: row.kiosk_label || '',
      status: row.status,
      lang: _clEn ? _cl : 'cs',
      fields, values,
    });
  } catch (err) { next(err); }
});

// GET veřejné PDF smlouvy podle tokenu — zákazník si smlouvu přečte před podpisem.
router.get('/contracts/public/:token/pdf', async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { share_token: String(req.params.token || '') } });
    if (!row) return res.status(404).json({ error: 'Odkaz nenalezen nebo neplatný' });
    // Plně podepsanou smlouvu si zákazník může stáhnout i po vypršení odkazu.
    if (row.status !== 'podepsano' && row.share_expires_at && new Date(row.share_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Platnost odkazu vypršela' });
    }
    const pubFields = await _enrichLegacyContract(row, _flattenLegacyContractFields(row.fields));
    let pdf;
    try { pdf = await contracts.generateContractPdf(row.type, pubFields); }
    catch (e) { console.error('[contract public pdf]', e); return res.status(500).json({ error: 'PDF se nepodařilo vytvořit' }); }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + _safeContractName(contracts.TYPE_LABEL[row.type]) + '.pdf"');
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) { next(err); }
});

// POST veřejné (bez auth) — protistrana uloží hlavičku; stav 'vyplneno' + notifikace
router.post('/contracts/public/:token', async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { share_token: String(req.params.token || '') } });
    if (!row) return res.status(404).json({ error: 'Odkaz nenalezen' });
    if (row.share_expires_at && new Date(row.share_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Platnost odkazu vypršela' });
    }
    const groups = contracts.SCHEMAS[row.type] || [];
    const buyerGroup = groups.find((g) => g.key === 'buyer');
    const allowed = new Set((buyerGroup ? buyerGroup.fields : []).map((f) => f.name));
    const incoming = (req.body && req.body.fields) || {};
    const merged = Object.assign({}, row.fields || {});
    Object.keys(incoming).forEach((k) => {
      if (allowed.has(k)) merged[k] = String(incoming[k] == null ? '' : incoming[k]).slice(0, 500);
    });
    // Plátce DPH z jiné země EU → režim reverse charge (dle prefixu DIČ).
    merged._reverse_charge = _isEuReverseCharge(merged.buyer_dic);
    const filledRow = await prisma.compoundingContract.update({
      where: { id: row.id },
      data: { fields: merged, status: 'vyplneno', filled_at: new Date() },
    });
    compounderNotify.notifyContractEvent(prisma, { contract: filledRow, event: 'filled' }).catch(() => {});
    try {
      const ids = await resolveOwnerUserIds();
      const label = (contracts.TYPE_LABEL[row.type] || 'Smlouva') + ' — ' + (row.kiosk_code || '');
      const link = (getAppUrl() || '') + '/modules/prodejni-objednavky/index.html';
      for (const uid of ids) {
        await createNotification({
          userId: uid, type: 'contract_filled',
          title: 'Vyplněná hlavička smlouvy',
          body: label + ' — protistrana vyplnila své údaje.',
          link,
        }).catch(() => {});
      }
    } catch (e) { console.error('[contract-fill notify]', e); }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Provázané podpisy (rezervační ⇄ kupní) ─────────────────────────────────
// V okamžiku podpisu rezervační smlouvy se stejným podpisem podepisuje i
// provázaná kupní smlouva (fields._linked_contract_id) — a naopak.
async function _propagateCustomerSign(row, sigObj, buyerData, placeSigned) {
  try {
    const linkedId = row.fields && row.fields._linked_contract_id;
    if (!linkedId) return;
    const linked = await prisma.compoundingContract.findUnique({ where: { id: Number(linkedId) } });
    if (!linked || linked.status === 'podepsano') return;
    if (linked.fields && linked.fields._signature_customer) return;
    const m = Object.assign({}, linked.fields || {});
    Object.keys(buyerData || {}).forEach((k) => { m[k] = buyerData[k]; });
    if (!m.buyer_rep) m.buyer_rep = sigObj.name;
    if (placeSigned) m.place_signed = placeSigned;
    m._reverse_charge = _isEuReverseCharge(m.buyer_dic);
    // Hash obsahu provázané smlouvy (bez podpisů).
    const noSig = Object.assign({}, m); delete noSig._signature_customer; delete noSig._signature_bestseries;
    m._signature_customer = Object.assign({}, sigObj, {
      content_hash: crypto.createHash('sha256').update(JSON.stringify({ type: linked.type, kiosk: linked.kiosk_code, fields: noSig })).digest('hex'),
    });
    const signedAt = new Date();
    if (m._signature_bestseries) {
      const fr = await prisma.compoundingContract.update({
        where: { id: linked.id },
        data: { fields: m, status: 'podepsano', filled_at: linked.filled_at || signedAt, signed_at: signedAt },
      });
      compounderNotify.notifyContractEvent(prisma, { contract: fr, event: 'signed' }).catch(() => {});
    } else {
      const ar = await prisma.compoundingContract.update({
        where: { id: linked.id },
        data: { fields: m, status: 'k_podpisu', filled_at: linked.filled_at || signedAt },
      });
      const signUrl = (getAppUrl() || '') + '/modules/podpis-smlouvy/index.html?id=' + linked.id;
      compounderNotify.notifyContractAwaitingCountersign(prisma, ar, signUrl).catch(() => {});
    }
  } catch (e) { console.error('[contract propagate customer sign]', e); }
}

async function _propagateCountersign(row, sigObj, placeSigned) {
  try {
    const linkedId = row.fields && row.fields._linked_contract_id;
    if (!linkedId) return;
    const linked = await prisma.compoundingContract.findUnique({ where: { id: Number(linkedId) } });
    if (!linked || linked.status === 'podepsano') return;
    if (linked.fields && linked.fields._signature_bestseries) return;
    const m = Object.assign({}, linked.fields || {});
    if (!m.seller_rep) m.seller_rep = sigObj.name;
    if (placeSigned && !m.place_signed) m.place_signed = placeSigned;
    m._signature_bestseries = sigObj;
    const weFirst = (linked.status === 'k_autorizaci') && !(linked.fields && linked.fields._signature_customer);
    if (weFirst) {
      const token = linked.share_token || crypto.randomBytes(24).toString('hex');
      await prisma.compoundingContract.update({
        where: { id: linked.id },
        data: { fields: m, status: 'k_podpisu_zakaznik', share_token: token, share_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
      });
    } else {
      const signedAt = new Date();
      const sr = await prisma.compoundingContract.update({
        where: { id: linked.id },
        data: { fields: m, status: 'podepsano', signed_at: signedAt },
      });
      compounderNotify.notifyContractEvent(prisma, { contract: sr, event: 'signed' }).catch(() => {});
    }
  } catch (e) { console.error('[contract propagate countersign]', e); }
}

// POST veřejné (bez auth) — protistrana ELEKTRONICKY PODEPÍŠE (SES). Uloží podpis
// (obrázek), jméno, souhlas, čas, IP, user-agent a hash obsahu → stav 'podepsano'.
router.post('/contracts/public/:token/sign', async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { share_token: String(req.params.token || '') } });
    if (!row) return res.status(404).json({ error: 'Odkaz nenalezen' });
    if (row.share_expires_at && new Date(row.share_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Platnost odkazu vypršela' });
    }
    if (row.status === 'podepsano') return res.status(409).json({ error: 'Smlouva už je podepsaná.' });
    if (row.status === 'k_autorizaci') return res.status(409).json({ error: 'Smlouva zatím čeká na autorizaci Best Series. Podepíšete ji hned, jakmile ji schválíme.' });
    const b = req.body || {};
    const signerName = String(b.signer_name || '').trim().slice(0, 200);
    const signature = String(b.signature || '');
    const consent = !!b.consent;
    if (!consent) return res.status(400).json({ error: 'Chybí souhlas s podpisem.' });
    if (!signerName) return res.status(400).json({ error: 'Chybí jméno podepisujícího.' });
    if (!/^data:image\/(png|jpeg);base64,/.test(signature) || signature.length > 400000) {
      return res.status(400).json({ error: 'Neplatný nebo příliš velký podpis.' });
    }
    // Sloučení případně došlých polí hlavičky (jako u /public POST)
    const groups = contracts.SCHEMAS[row.type] || [];
    const buyerGroup = groups.find((g) => g.key === 'buyer');
    const allowed = new Set((buyerGroup ? buyerGroup.fields : []).map((f) => f.name));
    const incoming = (b.fields && typeof b.fields === 'object') ? b.fields : {};
    const merged = Object.assign({}, row.fields || {});
    const buyerData = {};
    Object.keys(incoming).forEach((k) => {
      if (allowed.has(k)) { merged[k] = String(incoming[k] == null ? '' : incoming[k]).slice(0, 500); buyerData[k] = merged[k]; }
    });
    // Plátce DPH z jiné země EU → režim reverse charge (dle prefixu DIČ).
    merged._reverse_charge = _isEuReverseCharge(merged.buyer_dic);
    // Zájemce zastoupen(a) = podepisující zákazník; místo podpisu z formuláře.
    if (!merged.buyer_rep) merged.buyer_rep = signerName;
    const placeSignedCust = String(b.place_signed || '').trim().slice(0, 120);
    if (placeSignedCust) merged.place_signed = placeSignedCust;
    // Povinné údaje: adresa, bankovní spojení a místo podpisu.
    if (!String(merged.buyer_address || '').trim() || !String(merged.buyer_bank || '').trim()) {
      return res.status(400).json({ error: 'Vyplňte prosím adresu a bankovní spojení.' });
    }
    if (!String(merged.place_signed || '').trim()) {
      return res.status(400).json({ error: 'Vyplňte prosím místo podpisu.' });
    }
    // Hash obsahu smlouvy (bez podpisu) jako důkaz integrity.
    const noSig = Object.assign({}, merged); delete noSig._signature;
    const contentHash = crypto.createHash('sha256').update(JSON.stringify({ type: row.type, kiosk: row.kiosk_code, fields: noSig })).digest('hex');
    const signedAt = new Date();
    merged._signature_customer = {
      name: signerName,
      image: signature,
      signed_at: signedAt.toISOString(),
      ip: (req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || '').toString().split(',')[0].trim().slice(0, 64),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      content_hash: contentHash,
      method: 'SES-drawn',
    };
    // Když jsme smlouvu podepsali už dřív (rezervační flow – my první), pak podpisem
    // zákazníka je smlouva PLNĚ podepsaná → uloží se a Velín (Jan/Tomáš) dostane notifikaci.
    if (row.fields && row.fields._signature_bestseries) {
      const fullRow = await prisma.compoundingContract.update({
        where: { id: row.id },
        data: { fields: merged, status: 'podepsano', filled_at: row.filled_at || signedAt, signed_at: signedAt },
      });
      compounderNotify.notifyContractEvent(prisma, { contract: fullRow, event: 'signed' }).catch(() => {});
      // Pozn.: podpisy se NEpropagují mezi smlouvami — každá se podepisuje zvlášť.
      // Rezervace: lhůty se počítají od DATA PODPISU rezervační smlouvy (ne od vytvoření).
      // Kontrola platby = den po podpisu; konec rezervace = podpis + počet dní ze smlouvy.
      if (row.type === 'rezervacni') {
        try {
          const resv = await prisma.locationReservation.findFirst({
            where: { kiosk_code: row.kiosk_code, status: { in: ['reserved', 'active'] } },
            orderBy: { created_at: 'desc' },
          });
          if (resv) {
            const feeUntil = new Date(signedAt.getTime() + 86400000);
            const reservedUntil = new Date(signedAt.getTime() + (resv.days || 0) * 86400000);
            await prisma.locationReservation.update({
              where: { id: resv.id },
              data: { signed_at: signedAt, fee_until: feeUntil, reserved_until: reservedUntil },
            });
          }
        } catch (e) { console.error('[compounder] přepočet lhůt rezervace po podpisu selhal:', e.message); }
      }
      return res.json({ ok: true, fully_signed: true });
    }
    // Klasický flow: zákazník podepsal → čeká na náš podpis (Jan/Tomáš dostanou push + odkaz).
    const awaitingRow = await prisma.compoundingContract.update({
      where: { id: row.id },
      data: { fields: merged, status: 'k_podpisu', filled_at: row.filled_at || signedAt },
    });
    const signUrl = (getAppUrl() || '') + '/modules/podpis-smlouvy/index.html?id=' + row.id;
    compounderNotify.notifyContractAwaitingCountersign(prisma, awaitingRow, signUrl).catch(() => {});
    // Pozn.: podpisy se NEpropagují mezi smlouvami — každá se podepisuje zvlášť.
    res.json({ ok: true, awaiting_countersign: true });
  } catch (err) { next(err); }
});


// Je přihlášený uživatel podepisující za Best Series? (admin/superadmin nebo v seznamu příjemců)
async function isContractSigner(req) {
  const u = req.user || {};
  if (u.isSuperAdmin || u.role === 'admin') return true;
  const pid = u.person && u.person.id;
  if (!pid) return false;
  try {
    const ids = await compounderNotify.resolveRecipientPersonIds(prisma);
    return Array.isArray(ids) && ids.indexOf(pid) !== -1;
  } catch (e) { return false; }
}

// GET /api/compounder/contracts/:id/for-sign — data pro podpis za Best Series (auth, podepisující).
router.get('/contracts/:id(\\d+)/for-sign', requireAuth, async (req, res, next) => {
  try {
    if (!(await isContractSigner(req))) return res.status(403).json({ error: 'Jen podepisující za Best Series.' });
    const row = await prisma.compoundingContract.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Smlouva nenalezena' });
    const f = row.fields || {};
    const cust = f._signature_customer || null;
    res.json({
      ok: true, id: row.id, type: row.type, typeLabel: contracts.TYPE_LABEL[row.type] || 'Smlouva',
      kiosk_code: row.kiosk_code, kiosk_label: row.kiosk_label, status: row.status,
      share_token: row.share_token || null,
      customer_signature: cust ? cust.image : null,
      customer_name: cust ? cust.name : null,
      customer_signed_at: cust ? cust.signed_at : null,
    });
  } catch (err) { next(err); }
});

// POST /api/compounder/contracts/:id/countersign — podpis za Best Series → stav podepsano.
router.post('/contracts/:id(\\d+)/countersign', requireAuth, async (req, res, next) => {
  try {
    if (!(await isContractSigner(req))) return res.status(403).json({ error: 'Jen podepisující za Best Series.' });
    const row = await prisma.compoundingContract.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Smlouva nenalezena' });
    if (row.status === 'podepsano') return res.status(409).json({ error: 'Smlouva už je plně podepsaná.' });
    const b = req.body || {};
    const signature = String(b.signature || '');
    if (!b.consent) return res.status(400).json({ error: 'Chybí souhlas s podpisem.' });
    if (!/^data:image\/(png|jpeg);base64,/.test(signature) || signature.length > 400000) return res.status(400).json({ error: 'Neplatný nebo příliš velký podpis.' });
    const person = req.user.person;
    const signerName = person ? ((person.first_name || '') + ' ' + (person.last_name || '')).trim() : (req.user.displayName || 'Best Series');
    const merged = Object.assign({}, row.fields || {});
    // Poskytovatel zastoupen(a) = podepisující za Best Series; místo podpisu z formuláře.
    if (!merged.seller_rep) merged.seller_rep = signerName;
    const placeSigned = String(b.place_signed || '').trim().slice(0, 120);
    if (placeSigned) merged.place_signed = placeSigned;
    const signedAt = new Date();
    merged._signature_bestseries = {
      name: signerName, image: signature, signed_at: signedAt.toISOString(),
      person_id: person ? person.id : null,
      ip: (req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || '').toString().split(',')[0].trim().slice(0, 64),
      method: 'SES-drawn',
    };
    // "My podepisujeme první" (rezervační flow): stav k_autorizaci + zákazník ještě
    // nepodepsal → náš podpis smlouvu NEUZAVÍRÁ, ale zpřístupní ji zákazníkovi k podpisu.
    const weFirst = (row.status === 'k_autorizaci') && !(row.fields && row.fields._signature_customer);
    if (weFirst) {
      const token = row.share_token || crypto.randomBytes(24).toString('hex');
      await prisma.compoundingContract.update({
        where: { id: row.id },
        data: { fields: merged, status: 'k_podpisu_zakaznik', share_token: token, share_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
      });
      // Pozn.: podpisy se NEpropagují mezi smlouvami — každá se podepisuje zvlášť.
      return res.json({ ok: true, awaiting_customer: true });
    }
    const signedRow = await prisma.compoundingContract.update({
      where: { id: row.id }, data: { fields: merged, status: 'podepsano', signed_at: signedAt },
    });
    compounderNotify.notifyContractEvent(prisma, { contract: signedRow, event: 'signed' }).catch(() => {});
    // Pozn.: podpisy se NEpropagují mezi smlouvami — každá se podepisuje zvlášť.
    // TODO Fáze B: po plném podpisu automaticky vytvořit koncept faktury dle smlouvy.
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Portál: nabídka lokalit k prodeji (jen forSale, kurátorovaná ekonomika) ──
// Kurzy z ČNB (CZK za 1 jednotku měny). Hodinová cache + fallback, když ČNB nedostupné.
let _fxRates = null, _fxAt = 0;
const FX_WANT = ['EUR', 'USD', 'GBP'];
const FX_FALLBACK = { EUR: 25, USD: 23, GBP: 29 };
async function fxRatesCzk() {
  if (_fxRates && (Date.now() - _fxAt) < 3600000) return _fxRates;
  try {
    const r = await fetch('https://api.cnb.cz/cnbapi/exrates/daily?lang=EN');
    if (r.ok) {
      const d = await r.json();
      const out = {};
      FX_WANT.forEach((c) => {
        const row = (d.rates || []).find((x) => x.currencyCode === c);
        if (row) {
          const amt = parseFloat(row.amount) || 1;
          const rate = parseFloat(row.rate);
          if (rate > 0) out[c] = rate / amt;
        }
      });
      if (out.EUR) { _fxRates = Object.assign({}, FX_FALLBACK, out); _fxAt = Date.now(); return _fxRates; }
    }
  } catch (e) { /* fallback níže */ }
  return _fxRates || FX_FALLBACK;
}
async function eurToCzk() { const f = await fxRatesCzk(); return f.EUR || 25; }

async function portalKiosks() {
  if (_kioskCache.data && Array.isArray(_kioskCache.data.kiosks) && (Date.now() - _kioskCache.at) < KIOSK_CACHE_MS) {
    return _kioskCache.data.kiosks;
  }
  const apiKey = process.env.SIS_KIOSK_API_KEY;
  if (!apiKey) return (_kioskCache.data && _kioskCache.data.kiosks) || [];
  const apiUrl = process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(apiUrl, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return (_kioskCache.data && _kioskCache.data.kiosks) || [];
    const payload = await r.json();
    return Array.isArray(payload.kiosks) ? payload.kiosks : [];
  } catch (e) {
    clearTimeout(timeout);
    return (_kioskCache.data && _kioskCache.data.kiosks) || [];
  }
}

// Lazy doplnění středu prádlomatu (Claude vision) u fotek, které ho ještě nemají.
// Běží na pozadí, max pár detekcí na běh, aby to nezatěžovalo ani neopakovalo.
let _focusBgRunning = false;
async function _ensurePhotoFocusBg() {
  if (_focusBgRunning) return;
  _focusBgRunning = true;
  try {
    const { detectPhotoFocus } = require('../services/compounder/photo-focus');
    const map = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
    let changed = false, done = 0;
    for (const code of Object.keys(map)) {
      if (done >= 5) break;
      const cfg = map[code] || {};
      const photos = Array.isArray(cfg.photos) ? cfg.photos : [];
      if (!photos.length) continue;
      const focus = (cfg.photoFocus && typeof cfg.photoFocus === 'object') ? cfg.photoFocus : {};
      const u = photos[0];
      if (focus[u]) continue;
      const fp = await detectPhotoFocus(u);
      done++;
      focus[u] = fp || { fx: 50, fy: 50 }; // i neúspěch uložíme (default střed), ať to nezkoušíme donekonečna
      map[code] = { ...cfg, photoFocus: focus };
      changed = true;
    }
    if (changed) await setSetting(COMPOUNDING_KIOSKS_KEY, map, { type: 'json', scope: 'compounding', description: 'Compounding kiosk config (photoFocus)' });
  } catch (e) { /* best-effort */ } finally { _focusBgRunning = false; }
}

// Sdílený výpočet nabídky lokalit pro daného leada (globální forSale + jeho VIP).
// Používá veřejný token endpoint i admin náhled (ikonka v HolyOS / u obchodníka).
async function buildOfferedLocations(leadId, opts) {
    opts = opts || {}; // opts.includeHidden = i lokality bez fotky (pro admin/obchodník náhled)
    const cs = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT });
    const cfgMap = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
    const kiosks = await portalKiosks();
    const fx = await fxRatesCzk();
    const eur = fx.EUR || 25;
    const busyInfo = await activeReservationInfo();
    const feePerDay = Number.isFinite(cs.reservationFeePerDayCzk) ? cs.reservationFeePerDayCzk : 20000;
    const holdHours = Number.isFinite(cs.reservationHoldHours) ? cs.reservationHoldHours : 1;
    const signDays = Number.isFinite(cs.reservationSignDays) ? cs.reservationSignDays : 1;
    const payDays = Number.isFinite(cs.reservationPayDays) ? cs.reservationPayDays : 1;
    const reblockDays = Number.isFinite(cs.reservationReblockDays) ? cs.reservationReblockDays : 2;
    // Výchozí měna se řídí jazykem leada: čeština → CZK, jinak EUR (fallback = globální nastavení).
    const _lead = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { lang: true, extra_offers: true } }).catch(() => null);
    const _leadLang = (_lead && _lead.lang) ? _lead.lang.toLowerCase() : null;
    // Individuální nabídka lokalit navíc pro tohoto leada (union se společnou forSale nabídkou).
    const extraSet = new Set(String((_lead && _lead.extra_offers) || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
    const defCur = _leadLang ? (_leadLang.indexOf('cs') === 0 ? 'CZK' : 'EUR') : ((cs.defaultCurrency === 'EUR') ? 'EUR' : 'CZK');

    const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
    const svcPct = Number.isFinite(cs.servicePct) ? cs.servicePct : 15;
    const enPct = Number.isFinite(cs.energyPct) ? cs.energyPct : 9.5;
    const months = Number.isFinite(cs.locationMonths) ? cs.locationMonths : 12;
    const mode = cs.locationPriceMode === 'roi' ? 'roi' : 'months';
    const roiPct = Number.isFinite(cs.locationRoiPct) ? cs.locationRoiPct : 25;
    const buybackPct = Number.isFinite(cs.buybackPct) ? cs.buybackPct : 65;
    const buybackYears = Number.isFinite(cs.buybackYears) ? cs.buybackYears : 5;
    const pl = cs.pricelist || {};

    const machinePrice = (ver) => {
      const v = pl[ver] && pl[ver].eur != null ? Number(pl[ver].eur) : null;
      return v != null && isFinite(v) ? Math.round(v * eur) : null;
    };

    const list = kiosks
      .filter((k) => {
        const code = String(k.code || '').toUpperCase();
        if (extraSet.has(code)) return true; // individuální nabídka — vždy zobrazit (i mimo Best Series / ne-forSale)
        if (!String(k.companyName || '').toLowerCase().includes('best series')) return false;
        return (cfgMap[k.code] || {}).forSale;
      })
      .map((k) => {
        const cfg = cfgMap[k.code] || {};
        const isIndividual = !(cfg.forSale) && extraSet.has(String(k.code || '').toUpperCase());
        const bi = busyInfo.get(k.code);
        const ver = String(cfg.version || '').toLowerCase();
        const machine = machinePrice(ver);
        const avg = num(k.avgTop3);
        const obratBez = avg / 1.21;
        const servis = avg * (svcPct / 100);
        const najem = (typeof cfg.rentMonthlyCzk === 'number' && isFinite(cfg.rentMonthlyCzk)) ? cfg.rentMonthlyCzk : 0;
        const energie = obratBez * (enPct / 100);
        const cisty = obratBez - servis - najem - energie;
        let locality;
        if (mode === 'roi') {
          locality = machine != null ? Math.max(0, Math.round(cisty * (1200 / (roiPct > 0 ? roiPct : 25)) - machine)) : null;
        } else {
          locality = Math.round(avg * months);
        }
        const total = (machine != null && locality != null) ? (machine + locality) : null;
        const yearly = Math.round(cisty * 12);
        return {
          code: k.code,
          label: k.label,
          version: ver ? ver.toUpperCase() : null,
          totalPrice: total,
          yearlyYield: yearly,
          roiPct: (total > 0) ? Math.round(cisty * 12 / total * 1000) / 10 : null,
          guaranteePct: buybackPct,
          guaranteeYears: buybackYears,
          guaranteeValue: total != null ? Math.round(total * buybackPct / 100) : null,
          reserved: !!bi,
          reservedUntil: bi ? (bi.reserved_until || null) : null,
          mine: bi ? (bi.lead_id === leadId) : false,
          resStatus: bi ? bi.status : null,
          resUntil: bi ? (bi.until || null) : null,
          individual: isIndividual,
          noPhoto: !(Array.isArray(cfg.photos) && cfg.photos.length > 0),
          photos: Array.isArray(cfg.photos) ? cfg.photos : [],
          thumbFocus: (function(){ var ps = Array.isArray(cfg.photos) ? cfg.photos : []; var fm = (cfg.photoFocus && typeof cfg.photoFocus === 'object') ? cfg.photoFocus : {}; return (ps[0] && fm[ps[0]]) ? fm[ps[0]] : null; })(),
        };
      })
      // Lokality bez fotky: na portálu skrýt, v admin/obchodník náhledu ponechat (s flagem noPhoto).
      .filter((o) => opts.includeHidden || !o.noPhoto)
      .sort((a, b) => {
        // VIP (individuální) nabídky nahoru, pak podle ročního výnosu.
        if (!!a.individual !== !!b.individual) return a.individual ? -1 : 1;
        return (b.yearlyYield || 0) - (a.yearlyYield || 0);
      });

    try { _ensurePhotoFocusBg(); } catch (e) {}
    return { ok: true, currency: 'CZK', defaultCurrency: defCur, eurRate: eur, rates: fx, feePerDayCzk: feePerDay, reservation: { feePerDayCzk: feePerDay, holdHours, signDays, payDays, reblockDays }, count: list.length, locations: list };
}

router.get('/portal/offered-locations', async (req, res, next) => {
  try {
    const leadId = verifyPortalToken(String(req.query.t || ''));
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    res.json(await buildOfferedLocations(leadId));
  } catch (err) { next(err); }
});

// ─── Sekce „Příklad" (skládačka portfolia) — jen pro lead se show_example ─────
// GET /portal/example?t= → uložený model + datum založení účtu (pro ušlý zisk).
router.get('/portal/example', async (req, res, next) => {
  try {
    const leadId = verifyPortalToken(String(req.query.t || ''));
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    const lead = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { show_example: true, example_model: true, created_at: true } });
    if (!lead) return res.status(404).json({ ok: false, error: 'Registrace nenalezena.' });
    if (!lead.show_example) return res.status(403).json({ ok: false, error: 'Sekce není zpřístupněna.' });
    let codes = [], buyDate = null, investment = null, invHistory = [];
    try {
      const m = lead.example_model ? JSON.parse(lead.example_model) : null;
      if (m && Array.isArray(m.codes)) codes = m.codes.map((c) => String(c).toUpperCase());
      if (m && m.buyDate) buyDate = String(m.buyDate).slice(0, 10);
      if (m && m.investment != null && Number.isFinite(Number(m.investment))) investment = Number(m.investment);
      if (m && Array.isArray(m.invHistory)) invHistory = m.invHistory;
    } catch (e) { /* poškozený JSON ignoruj */ }
    res.json({ ok: true, enabled: true, accountCreatedAt: lead.created_at, model: { codes, buyDate, investment, invHistory } });
  } catch (err) { next(err); }
});

// POST /portal/example?t= { codes:[...] } → ulož model + zaloguj vizi.
router.post('/portal/example', async (req, res, next) => {
  try {
    const leadId = verifyPortalToken(String(req.query.t || ''));
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    const lead = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { show_example: true } });
    if (!lead || !lead.show_example) return res.status(403).json({ ok: false, error: 'Sekce není zpřístupněna.' });
    const body = req.body || {};
    let codes = Array.isArray(body.codes) ? body.codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean).slice(0, 200) : [];
    codes = Array.from(new Set(codes));
    // Plánované datum nákupu (start projekce) — jen YYYY-MM-DD.
    const bd = String(body.buyDate || '').slice(0, 10);
    const buyDate = /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : null;
    // Objem investice + historie zadaných hodnot (ať obchodník vidí, jak se vize vyvíjela).
    const invNum = Number(body.investment);
    const investment = (Number.isFinite(invNum) && invNum > 0) ? Math.round(invNum) : null;
    let prev = null;
    try { prev = (await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { example_model: true } })).example_model; } catch (e) { prev = null; }
    let invHistory = [], history = [];
    try {
      const pm = prev ? JSON.parse(prev) : null;
      if (pm && Array.isArray(pm.invHistory)) invHistory = pm.invHistory;
      if (pm && Array.isArray(pm.history)) history = pm.history;
    } catch (e) { invHistory = []; history = []; }
    if (investment != null && (!invHistory.length || Number(invHistory[invHistory.length - 1].amount) !== investment)) {
      invHistory.push({ amount: investment, at: new Date().toISOString() });
      if (invHistory.length > 50) invHistory = invHistory.slice(-50);
    }
    // Historie celých modelů — ať obchodník vidí, jak zákazník nad portfoliem přemýšlel.
    const snap = { codes, investment, buyDate, at: new Date().toISOString() };
    const lastSnap = history.length ? history[history.length - 1] : null;
    const sameAsLast = lastSnap
      && String((lastSnap.codes || []).join(',')) === String(codes.join(','))
      && Number(lastSnap.investment || 0) === Number(investment || 0)
      && String(lastSnap.buyDate || '') === String(buyDate || '');
    if (!sameAsLast) {
      history.push(snap);
      if (history.length > 50) history = history.slice(-50);
    }
    const model = { codes, buyDate, investment, invHistory, history, savedAt: new Date().toISOString() };
    await prisma.compounderLead.update({ where: { id: leadId }, data: { example_model: JSON.stringify(model) } });
    try { await prisma.compounderEvent.create({ data: { sid: 'portal-lead-' + leadId, event: 'example_save', props: { lead_id: leadId, codes, investment, buyDate }, path: '/portal#priklad' } }); } catch (e) { /* log best-effort */ }
    res.json({ ok: true, model });
  } catch (err) { next(err); }
});

// Brána pro portálové statistiky: ověří token → lead, že má show_revenue_stats
// a že daný kód lokality je v jeho nabídce. Vrací { leadId } nebo { status, error }.
async function _portalRevenueGate(token, code) {
  const leadId = verifyPortalToken(String(token || ''));
  if (!leadId) return { status: 401, error: 'Neplatný nebo chybějící přístupový odkaz.' };
  const lead = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { show_revenue_stats: true } }).catch(() => null);
  if (!lead || !lead.show_revenue_stats) return { status: 403, error: 'Statistiky nejsou pro tento účet dostupné.' };
  const want = String(code || '').toUpperCase();
  if (!want) return { status: 400, error: 'Chybí kód lokality.' };
  const offer = await buildOfferedLocations(leadId).catch(() => null);
  const codes = new Set(((offer && offer.locations) || []).map((l) => String(l.code || '').toUpperCase()));
  if (!codes.has(want)) return { status: 404, error: 'Lokalita není ve tvé nabídce.' };
  return { leadId };
}

// GET /api/compounder/portal/kiosk-revenue?t=<token>&code=<code> — tržby lokality pro zákazníka.
router.get('/portal/kiosk-revenue', async (req, res, next) => {
  try {
    const g = await _portalRevenueGate(req.query.t, req.query.code);
    if (g.status) return res.status(g.status).json({ ok: false, error: g.error });
    const data = await _computeKioskRevenue(req.query.code, req.query.fresh === '1');
    res.json(data);
  } catch (err) { _sisErrToHttp(err, res, next); }
});

// GET /api/compounder/portal/kiosk-revenue/transactions?t=&code=&period= — transakce období pro zákazníka.
router.get('/portal/kiosk-revenue/transactions', async (req, res, next) => {
  try {
    const g = await _portalRevenueGate(req.query.t, req.query.code);
    if (g.status) return res.status(g.status).json({ ok: false, error: g.error });
    const data = await _computeKioskPeriodTx(req.query.code, req.query.period);
    res.json(data);
  } catch (err) { _sisErrToHttp(err, res, next); }
});

// ADMIN náhled nabídky, kterou lead reálně vidí na portálu (společné + VIP).
router.get('/leads/:id(\\d+)/offer-preview', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    res.json(await buildOfferedLocations(id, { includeHidden: true }));
  } catch (err) { next(err); }
});

router.post('/portal/reserve-interest', async (req, res, next) => {
  try {
    const b = req.body || {};
    const leadId = verifyPortalToken(String(b.t || ''));
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    const code = String(b.code || '').slice(0, 40);
    const lead = await prisma.compounderLead.findUnique({
      where: { id: leadId }, select: { id: true, name: true, email: true, phone: true },
    }).catch(() => null);
    try {
      const ids = await resolveOwnerUserIds();
      const who = (lead && (lead.name || lead.email)) || ('lead #' + leadId);
      const title = 'Zájem o rezervaci lokality ' + (code || '');
      const body = who + ' má zájem rezervovat lokalitu ' + (code || '') + '.' + (lead && lead.phone ? (' Tel: ' + lead.phone) : '') + (lead && lead.email ? (' E-mail: ' + lead.email) : '');
      const link = (getAppUrl() || '') + '/modules/prodejni-objednavky/index.html';
      for (const uid of ids) {
        await createNotification({ userId: uid, type: 'compounder_reserve_interest', title, body, link }).catch(() => {});
      }
    } catch (e) { console.error('[reserve-interest notify]', e); }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// COMPOUNDING — rezervace lokalit
// =============================================================================
const RES_ACTIVE = ['reserved', 'active'];
const RES_BUSY = ['hold', 'reserved', 'active']; // obsazeno pro ostatní

// Lazy expirace prošlých rezervací (uvolní lokalitu ostatním).
async function expireStaleReservations() {
  const now = new Date();
  try {
    // Vypršelý 1h hold → smazat (nikdy se nestal rezervací, neblokuje re-rezervaci).
    await prisma.locationReservation.deleteMany({
      where: { status: 'hold', hold_until: { lt: now } },
    });
    await prisma.locationReservation.updateMany({
      where: { status: 'reserved', fee_until: { lt: now } },
      data: { status: 'expired', cancel_reason: 'Rezervační poplatek nepřišel včas' },
    });
    await prisma.locationReservation.updateMany({
      where: { status: 'active', reserved_until: { lt: now } },
      data: { status: 'expired', cancel_reason: 'Kupní smlouva nedokončena v rezervační době' },
    });
  } catch (e) { /* tabulka nemusí existovat před migrací */ }
}

async function activeReservationCodes() {
  await expireStaleReservations();
  try {
    const rows = await prisma.locationReservation.findMany({
      where: { status: { in: RES_BUSY } }, select: { kiosk_code: true },
    });
    return new Set(rows.map((r) => r.kiosk_code));
  } catch (e) { return new Set(); }
}

// Mapa obsazených lokalit (vč. holdu): kiosk_code → { until, status, lead_id }.
async function activeReservationInfo() {
  await expireStaleReservations();
  try {
    const rows = await prisma.locationReservation.findMany({
      where: { status: { in: RES_BUSY } },
      select: { kiosk_code: true, reserved_until: true, hold_until: true, status: true, lead_id: true },
    });
    const m = new Map();
    for (const r of rows) {
      const until = r.status === 'hold' ? r.hold_until : r.reserved_until;
      const u = until ? new Date(until).getTime() : 0;
      const cur = m.get(r.kiosk_code);
      if (!cur || u > cur._t) m.set(r.kiosk_code, { _t: u, until: until, reserved_until: r.reserved_until, status: r.status, lead_id: r.lead_id });
    }
    return m;
  } catch (e) { return new Map(); }
}

const reserveSchema = z.object({
  t: z.string(),
  code: z.string().min(1).max(40),
  days: z.number().int().min(1).max(365),
  totalPrice: z.number().int().nonnegative().optional(),
  lang: z.string().max(10).optional(),     // jazyk nastavený na portálu → jazyk smlouvy
  currency: z.string().max(5).optional(),  // měna zvolená na portálu → měna ve smlouvě
  buyer: z.object({
    name: z.string().max(255).optional(),
    email: z.string().max(255).optional(),
    phone: z.string().max(40).optional(),
    ico: z.string().max(20).optional(),
    dic: z.string().max(20).optional(), // DIČ / VAT ID (plátce DPH)
    address: z.string().max(500).optional(),
    rep: z.string().max(255).optional(),
    bank: z.string().max(120).optional(),
  }).optional(),
});

// Plátce DPH z jiné země EU → fakturace bez DPH (reverse charge, čl. 196 směrnice 2006/112/ES).
// Určuje se z prefixu DIČ/VAT ID (DE…, SK…, PL…); CZ a neplátci = běžný režim s DPH.
const EU_VAT_PREFIXES = ['AT', 'BE', 'BG', 'HR', 'CY', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'EL', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
function _isEuReverseCharge(dic) {
  const p = String(dic || '').trim().toUpperCase().slice(0, 2);
  return !!p && p !== 'CZ' && EU_VAT_PREFIXES.indexOf(p) !== -1;
}

// POST /api/compounder/portal/reserve — vytvoří rezervaci (blokuje lokalitu)
// POST /api/compounder/portal/hold { t, code } — 1h blokace lokality po kliknutí Rezervovat.
router.post('/portal/hold', async (req, res, next) => {
  try {
    const t = String((req.body || {}).t || '');
    const code = String((req.body || {}).code || '').slice(0, 40);
    const leadId = verifyPortalToken(t);
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    if (!code) return res.status(400).json({ ok: false, error: 'Chybí lokalita.' });
    await expireStaleReservations();
    const cs = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT });
    const holdHours = Number.isFinite(cs.reservationHoldHours) ? cs.reservationHoldHours : 1;
    // Obsazeno někým jiným?
    const busy = await prisma.locationReservation.findFirst({ where: { kiosk_code: code, status: { in: RES_BUSY }, NOT: { lead_id: leadId } }, select: { id: true } });
    if (busy) return res.status(409).json({ ok: false, error: 'Tato lokalita je právě obsazená někým jiným.' });
    // Moje existující blokace/rezervace? → vrátíme ji (můžu pokračovat).
    const mine = await prisma.locationReservation.findFirst({ where: { kiosk_code: code, lead_id: leadId, status: { in: RES_BUSY } }, orderBy: { created_at: 'desc' } });
    if (mine) return res.json({ ok: true, id: mine.id, status: mine.status, hold_until: mine.hold_until, reserved_until: mine.reserved_until });
    // Blokace po nedávném zrušení
    const reblockDays = Number.isFinite(cs.reservationReblockDays) ? cs.reservationReblockDays : 2;
    if (reblockDays > 0) {
      const since = new Date(Date.now() - reblockDays * 86400000);
      const recent = await prisma.locationReservation.findFirst({ where: { kiosk_code: code, lead_id: leadId, status: { in: ['cancelled', 'expired'] }, updated_at: { gt: since } }, select: { id: true } });
      if (recent) return res.status(429).json({ ok: false, error: 'Tuto lokalitu můžete znovu rezervovat až za ' + reblockDays + ' dny.' });
    }
    const holdUntil = new Date(Date.now() + holdHours * 3600000);
    const rec = await prisma.locationReservation.create({ data: { kiosk_code: code, lead_id: leadId, status: 'hold', hold_until: holdUntil } });
    // Notifikace: Jan/Tomáš + obchodník vlastnící kontakt.
    (async () => {
      try {
        const l = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { name: true, owner_person_id: true } });
        compounderNotify.notifyReservationHold(prisma, { reservation: rec, leadName: l && l.name, ownerPersonId: l && l.owner_person_id });
      } catch (_) {}
    })();
    res.json({ ok: true, id: rec.id, status: 'hold', hold_until: holdUntil });
  } catch (err) { next(err); }
});

router.post('/portal/reserve', async (req, res, next) => {
  try {
    const parsed = reserveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Neplatná data rezervace.' });
    const { t, code, days } = parsed.data;
    const leadId = verifyPortalToken(t);
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });

    await expireStaleReservations();

    const busy = await prisma.locationReservation.findFirst({
      where: { kiosk_code: code, status: { in: RES_BUSY }, NOT: { lead_id: leadId } }, select: { id: true },
    });
    if (busy) return res.status(409).json({ ok: false, error: 'Tato lokalita je právě rezervovaná někým jiným. Zkuste to prosím později nebo vyberte jinou.' });

    const cs = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT });
    const feePerDay = Number.isFinite(cs.reservationFeePerDayCzk) ? cs.reservationFeePerDayCzk : 20000;
    const signDays = Number.isFinite(cs.reservationSignDays) ? cs.reservationSignDays : 1;
    const payDays = Number.isFinite(cs.reservationPayDays) ? cs.reservationPayDays : 1;
    const reblockDays = Number.isFinite(cs.reservationReblockDays) ? cs.reservationReblockDays : 2;

    if (reblockDays > 0) {
      const since = new Date(Date.now() - reblockDays * 86400000);
      const recent = await prisma.locationReservation.findFirst({
        where: { kiosk_code: code, lead_id: leadId, status: { in: ['cancelled', 'expired'] }, updated_at: { gt: since } },
        select: { id: true },
      });
      if (recent) return res.status(429).json({ ok: false, error: 'Tuto lokalitu můžete znovu rezervovat až za ' + reblockDays + ' dny (od zrušení předchozí rezervace).' });
    }

    const now = new Date();
    const feeTotal = days * feePerDay;
    const signUntil = new Date(now.getTime() + signDays * 86400000);
    const feeUntil = new Date(signUntil.getTime() + payDays * 86400000);
    const reservedUntil = new Date(now.getTime() + days * 86400000);
    const b = parsed.data.buyer || {};

    const commonData = {
      buyer_name: b.name || null, buyer_email: b.email || null, buyer_phone: b.phone || null,
      buyer_ico: b.ico || null, buyer_dic: b.dic || null, buyer_address: b.address || null,
      buyer_rep: b.rep || null, buyer_bank: b.bank || null,
      days, fee_per_day: feePerDay, fee_total: feeTotal,
      purchase_price: (parsed.data.totalPrice != null) ? parsed.data.totalPrice : null,
      currency: 'CZK', status: 'reserved', hold_until: null,
      sign_until: signUntil, fee_until: feeUntil, reserved_until: reservedUntil,
    };
    // Převezmi můj 1h hold (pokud existuje), jinak vytvoř novou rezervaci.
    const myHold = await prisma.locationReservation.findFirst({ where: { kiosk_code: code, lead_id: leadId, status: 'hold' }, orderBy: { created_at: 'desc' } });
    const rec = myHold
      ? await prisma.locationReservation.update({ where: { id: myHold.id }, data: commonData })
      : await prisma.locationReservation.create({ data: Object.assign({ kiosk_code: code, lead_id: leadId }, commonData) });

    // Velín push + zvonek nastaveným osobám (Jan/Tomáš) o nové rezervaci.
    compounderNotify.notifyReservationEvent(prisma, { reservation: rec, event: 'created' }).catch(() => {});

    // Automaticky vytvoř rezervační smlouvu předvyplněnou z hlavičky a pošli ji do
    // Velína k autorizaci (podpisu za Best Series). Zákazník ji podepíše až po nás.
    try {
      const already = await prisma.compoundingContract.findFirst({
        where: { kiosk_code: code, type: 'rezervacni', status: { notIn: ['podepsano'] } }, select: { id: true },
      });
      if (!already) {
        const our = await getOurCompany().catch(() => null);
        // Jazyk smlouvy = jazyk nastavený na portálu; fallback jazyk leada; jinak čeština.
        let contractLang = String(parsed.data.lang || '').toLowerCase().slice(0, 2);
        if (!contractLang) {
          const _lead = await prisma.compounderLead.findUnique({ where: { id: leadId }, select: { lang: true } }).catch(() => null);
          contractLang = String((_lead && _lead.lang) || 'cs').toLowerCase().slice(0, 2);
        }
        const isCs = contractLang === 'cs' || !contractLang;
        // Adresu lokality a měnu vezmeme ze SIS (kiosk-values), ne z adresy zákazníka.
        const _ki = await _sisKioskInfo(code);
        const kioskLabel = _ki.label;
        // Měna smlouvy = měna zvolená na portálu; fallback měna lokality; jinak CZK.
        const _curBody = String(parsed.data.currency || '').toUpperCase();
        const contractCur = (['CZK', 'EUR', 'USD', 'GBP'].indexOf(_curBody) !== -1) ? _curBody : (_ki.currency || 'CZK');
        const pseudoSite = { name: (isCs ? 'Lokalita ' : 'Location ') + code, address: kioskLabel, pradlomat_ref: code, purchase_price: (rec.purchase_price != null) ? rec.purchase_price : null, contacts: [] };
        // POZOR: getPrefill vrací { type, label, groups, values } — pole smlouvy jsou ve .values!
        let cf = {};
        try {
          const pf = contracts.getPrefill('rezervacni', pseudoSite, our, contractLang);
          cf = Object.assign({}, (pf && pf.values) || {});
        } catch (e) { cf = { _lang: isCs ? 'cs' : contractLang }; }
        if (!isCs) cf._lang = contractLang;
        // Zájemce = zákazník (údaje z rezervačního formuláře v portálu).
        cf.buyer_name = rec.buyer_name || cf.buyer_name || '';
        cf.buyer_address = rec.buyer_address || cf.buyer_address || '';
        cf.buyer_ico = rec.buyer_ico || cf.buyer_ico || '';
        cf.buyer_dic = rec.buyer_dic || cf.buyer_dic || '';
        cf.buyer_rep = rec.buyer_rep || cf.buyer_rep || '';
        cf.buyer_bank = rec.buyer_bank || cf.buyer_bank || '';
        cf._reverse_charge = _isEuReverseCharge(cf.buyer_dic);
        cf.seller_bank = cf.seller_bank || OUR_BANK_LINE;
        // Podmínky rezervace z právě vytvořené rezervace.
        cf.location_name = kioskLabel ? (code + ' — ' + kioskLabel) : ((isCs ? 'Lokalita ' : 'Location ') + code);
        if (kioskLabel) cf.location_address = kioskLabel;
        // Poplatek = dny × sazba (v CZK). Když je zvolená jiná měna, přepočteme
        // aktuálním kurzem ČNB a do smlouvy dáme částku i měnu.
        if (rec.fee_total != null) {
          let feeAmount = Math.round(rec.fee_total);
          let feeCur = isCs ? 'Kč' : 'CZK';
          if (contractCur !== 'CZK') {
            try {
              const rates = await fxRatesCzk();
              const rate = rates && rates[contractCur];
              if (rate > 0) {
                feeAmount = Math.round(rec.fee_total / rate);
                feeCur = contractCur;
              }
            } catch (e) { /* zůstane CZK */ }
          }
          cf.reservation_fee = feeAmount.toLocaleString('cs-CZ');
          cf.reservation_fee_currency = feeCur;
          // Částka slovy: česky pro Kč, anglicky pro EN smlouvy (jen celé částky).
          cf.reservation_fee_words = '';
          if (Number.isInteger(feeAmount)) {
            const CUR_CZ = { 'Kč': 'korun českých', CZK: 'korun českých', EUR: 'eur', USD: 'amerických dolarů', GBP: 'britských liber' };
            const CUR_EN = { CZK: 'Czech crowns', 'Kč': 'Czech crowns', EUR: 'euros', USD: 'US dollars', GBP: 'pounds sterling' };
            if (isCs) {
              const w = czAmountWords(feeAmount);
              if (w) cf.reservation_fee_words = w + ' ' + (CUR_CZ[feeCur] || feeCur);
            } else {
              const w = enAmountWords(feeAmount);
              if (w) cf.reservation_fee_words = w + ' ' + (CUR_EN[feeCur] || feeCur);
            }
          }
        }
        // Splatnost poplatku = den podpisu smlouvy (prázdné fee_due_days → „v den podpisu").
        cf.fee_due_days = '';
        cf.reservation_period = days + (isCs ? ' dní' : ' days');
        cf.reserved_until = reservedUntil.toLocaleDateString(isCs ? 'cs-CZ' : 'en-GB');
        const token = crypto.randomBytes(24).toString('hex');
        const contract = await prisma.compoundingContract.create({
          data: { kiosk_code: code, kiosk_label: kioskLabel || null, type: 'rezervacni', status: 'k_autorizaci', fields: cf, share_token: token, share_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        });

        // KUPNÍ smlouva se podepisuje SPOLEČNĚ s rezervační — vytvoří se hned a
        // provázáním (_linked_contract_id) se podpisy z rezervační propisují i do ní.
        let kupniContract = null;
        try {
          const alreadyKupni = await prisma.compoundingContract.findFirst({
            where: { kiosk_code: code, type: 'kupni', status: { notIn: ['podepsano'] } }, select: { id: true },
          });
          if (alreadyKupni) {
            // Kupní už existuje → jen ji provaž s rezervační, ať se podpisy propisují.
            const exist = await prisma.compoundingContract.findUnique({ where: { id: alreadyKupni.id } });
            if (exist) {
              const ef = Object.assign({}, exist.fields || {}, { _linked_contract_id: contract.id });
              await prisma.compoundingContract.update({
                where: { id: exist.id },
                data: { fields: ef, status: (exist.status === 'koncept' ? 'k_autorizaci' : exist.status) },
              });
              await prisma.compoundingContract.update({
                where: { id: contract.id },
                data: { fields: Object.assign({}, cf, { _linked_contract_id: exist.id }) },
              });
              kupniContract = exist;
            }
          }
          if (!alreadyKupni) {
            const cfgMap2 = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
            const cfg2 = cfgMap2[code] || {};
            const ks2 = await _sisKiosks();
            const kk2 = ks2.find((k) => k.code === code) || {};
            const fx2 = await fxRatesCzk();
            const eur2 = fx2.EUR || 25;
            const ver2 = String(cfg2.version || '').toLowerCase();
            const pl2 = cs.pricelist || {};
            const machineCzk = (pl2[ver2] && pl2[ver2].eur != null && isFinite(Number(pl2[ver2].eur))) ? Math.round(Number(pl2[ver2].eur) * eur2) : null;
            const totalCzk = (rec.purchase_price != null) ? Number(rec.purchase_price) : null;
            const localityCzk = (totalCzk != null && machineCzk != null) ? Math.max(0, totalCzk - machineCzk) : null;
            const pseudoKupni = {
              name: (isCs ? 'Lokalita ' : 'Location ') + code,
              address: kioskLabel, city: '', zip: '', country: 'CZ',
              purchase_price: localityCzk,
              pradlomat_ref: code, contacts: [],
              _avgTurnover: (typeof kk2.avgTop3 === 'number' && isFinite(kk2.avgTop3)) ? kk2.avgTop3 : null,
              _locationMonths: Number.isFinite(cs.locationMonths) ? cs.locationMonths : 12,
              _version: ver2 || null,
              _machinePrice: machineCzk,
              _servicePct: Number.isFinite(cs.servicePct) ? cs.servicePct : 15,
              _buybackPct: Number.isFinite(cs.buybackPct) ? cs.buybackPct : 65,
              _buybackYears: Number.isFinite(cs.buybackYears) ? cs.buybackYears : 5,
            };
            let kf = {};
            try {
              const pf2 = contracts.getPrefill('kupni', pseudoKupni, our, contractLang);
              kf = Object.assign({}, (pf2 && pf2.values) || {});
            } catch (e) { kf = {}; }
            if (!isCs) kf._lang = contractLang;
            kf.buyer_name = rec.buyer_name || '';
            kf.buyer_address = rec.buyer_address || '';
            kf.buyer_ico = rec.buyer_ico || '';
            kf.buyer_dic = rec.buyer_dic || '';
            kf.buyer_rep = rec.buyer_rep || '';
            kf.buyer_bank = rec.buyer_bank || '';
            kf._reverse_charge = _isEuReverseCharge(kf.buyer_dic);
            kf.location_desc = kioskLabel ? (code + ' — ' + kioskLabel) : code;
            // Ceny v měně zvolené na portálu (kurz ČNB).
            const rate2 = (contractCur !== 'CZK') ? ((fx2 && fx2[contractCur]) || 0) : 1;
            const priceInCur = (czk) => {
              if (czk == null || !isFinite(czk)) return '';
              if (contractCur !== 'CZK' && rate2 > 0) return (Math.round((czk / rate2) * 100) / 100).toLocaleString('cs-CZ');
              return Math.round(czk).toLocaleString('cs-CZ');
            };
            kf.price_currency = (contractCur !== 'CZK' && rate2 > 0) ? contractCur : (isCs ? 'Kč' : 'CZK');
            if (machineCzk != null) kf.price_machine = priceInCur(machineCzk);
            if (localityCzk != null) kf.price_location = priceInCur(localityCzk);
            if (totalCzk != null) kf.price_total = priceInCur(totalCzk);
            if (rec.fee_total != null) kf.reservation_credit = priceInCur(rec.fee_total);
            kf._linked_contract_id = contract.id;
            const token2 = crypto.randomBytes(24).toString('hex');
            kupniContract = await prisma.compoundingContract.create({
              data: { kiosk_code: code, kiosk_label: kioskLabel || null, type: 'kupni', status: 'k_autorizaci', fields: kf, share_token: token2, share_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
            });
            // Zpětná vazba: rezervační smlouva zná ID kupní.
            await prisma.compoundingContract.update({
              where: { id: contract.id },
              data: { fields: Object.assign({}, cf, { _linked_contract_id: kupniContract.id }) },
            });
          }
        } catch (e) { console.error('[compounder] auto kupní smlouva selhala:', e.message); }

        const signUrl = (getAppUrl() || '') + '/modules/podpis-smlouvy/index.html?id=' + contract.id;
        compounderNotify.notifyContractAwaitingAuthorization(prisma, contract, signUrl).catch(() => {});
      }
    } catch (e) { console.error('[compounder] auto rezervační smlouva selhala:', e.message); }

    res.json({ ok: true, id: rec.id, code, days, feePerDay, feeTotal, signUntil, feeUntil, reservedUntil });
  } catch (err) { next(err); }
});

// POST /api/compounder/reservations/:id/regenerate-contracts — admin
// Přegeneruje pole nepodepsaných smluv (rezervační + kupní) této rezervace podle
// aktuálního kódu. Měnu a jazyk odvodí z existujících smluv (rezervace si je sama
// nepamatuje). ID, tokeny, provázání i stav smluv zůstávají zachované.
router.post('/reservations/:id/regenerate-contracts', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Neplatné ID.' });
    const rec = await prisma.locationReservation.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ ok: false, error: 'Rezervace nenalezena.' });
    const code = rec.kiosk_code;
    const rezC = await prisma.compoundingContract.findFirst({ where: { kiosk_code: code, type: 'rezervacni', status: { notIn: ['podepsano'] } }, orderBy: { id: 'desc' } });
    const kupC = await prisma.compoundingContract.findFirst({ where: { kiosk_code: code, type: 'kupni', status: { notIn: ['podepsano'] } }, orderBy: { id: 'desc' } });
    if (!rezC && !kupC) return res.status(404).json({ ok: false, error: 'K teto rezervaci neni zadna nepodepsana smlouva k pregenerovani.' });

    const exRez = (rezC && rezC.fields) || {};
    const exKup = (kupC && kupC.fields) || {};
    const contractLang = String(exRez._lang || exKup._lang || 'cs').toLowerCase().slice(0, 2);
    const isCs = contractLang === 'cs' || !contractLang;
    let contractCur = String(exKup.price_currency || exRez.reservation_fee_currency || rec.currency || 'CZK').toUpperCase();
    if (contractCur === 'KC' || contractCur === 'KČ') contractCur = 'CZK';
    if (['CZK', 'EUR', 'USD', 'GBP'].indexOf(contractCur) === -1) contractCur = 'CZK';

    const our = await getOurCompany().catch(() => null);
    const _ki = await _sisKioskInfo(code);
    const kioskLabel = _ki.label;
    const cs = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT });
    const fx = await fxRatesCzk();

    // ---- Rezervacni smlouva ----
    if (rezC) {
      const pseudoSite = { name: (isCs ? 'Lokalita ' : 'Location ') + code, address: kioskLabel, pradlomat_ref: code, purchase_price: (rec.purchase_price != null) ? rec.purchase_price : null, contacts: [] };
      let cf = {};
      try { const pf = contracts.getPrefill('rezervacni', pseudoSite, our, contractLang); cf = Object.assign({}, (pf && pf.values) || {}); } catch (e) { cf = { _lang: isCs ? 'cs' : contractLang }; }
      if (!isCs) cf._lang = contractLang;
      cf.buyer_name = rec.buyer_name || cf.buyer_name || '';
      cf.buyer_address = rec.buyer_address || cf.buyer_address || '';
      cf.buyer_ico = rec.buyer_ico || cf.buyer_ico || '';
      cf.buyer_dic = rec.buyer_dic || cf.buyer_dic || '';
      cf.buyer_rep = rec.buyer_rep || cf.buyer_rep || '';
      cf.buyer_bank = rec.buyer_bank || cf.buyer_bank || '';
      cf._reverse_charge = _isEuReverseCharge(cf.buyer_dic);
      cf.seller_bank = cf.seller_bank || OUR_BANK_LINE;
      cf.location_name = kioskLabel ? (code + ' — ' + kioskLabel) : ((isCs ? 'Lokalita ' : 'Location ') + code);
      if (kioskLabel) cf.location_address = kioskLabel;
      if (rec.fee_total != null) {
        let feeAmount = Math.round(rec.fee_total);
        let feeCur = isCs ? 'Kč' : 'CZK';
        if (contractCur !== 'CZK') {
          const rate = fx && fx[contractCur];
          if (rate > 0) { feeAmount = Math.round(rec.fee_total / rate); feeCur = contractCur; }
        }
        cf.reservation_fee = feeAmount.toLocaleString('cs-CZ');
        cf.reservation_fee_currency = feeCur;
        cf.reservation_fee_words = '';
        if (Number.isInteger(feeAmount)) {
          const CUR_CZ = { 'Kč': 'korun českých', CZK: 'korun českých', EUR: 'eur', USD: 'amerických dolarů', GBP: 'britských liber' };
          const CUR_EN = { CZK: 'Czech crowns', 'Kč': 'Czech crowns', EUR: 'euros', USD: 'US dollars', GBP: 'pounds sterling' };
          if (isCs) { const w = czAmountWords(feeAmount); if (w) cf.reservation_fee_words = w + ' ' + (CUR_CZ[feeCur] || feeCur); }
          else { const w = enAmountWords(feeAmount); if (w) cf.reservation_fee_words = w + ' ' + (CUR_EN[feeCur] || feeCur); }
        }
      }
      cf.fee_due_days = '';
      if (rec.days != null) cf.reservation_period = rec.days + (isCs ? ' dní' : ' days');
      if (rec.reserved_until) cf.reserved_until = new Date(rec.reserved_until).toLocaleDateString(isCs ? 'cs-CZ' : 'en-GB');
      cf._linked_contract_id = kupC ? kupC.id : (exRez._linked_contract_id || null);
      await prisma.compoundingContract.update({ where: { id: rezC.id }, data: { fields: cf } });
    }

    // ---- Kupni smlouva ----
    if (kupC) {
      const cfgMap = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
      const cfg = cfgMap[code] || {};
      const ks = await _sisKiosks();
      const kk = ks.find((k) => k.code === code) || {};
      const eur = fx.EUR || 25;
      const ver = String(cfg.version || '').toLowerCase();
      const pl = cs.pricelist || {};
      const machineCzk = (pl[ver] && pl[ver].eur != null && isFinite(Number(pl[ver].eur))) ? Math.round(Number(pl[ver].eur) * eur) : null;
      const totalCzk = (rec.purchase_price != null) ? Number(rec.purchase_price) : null;
      const localityCzk = (totalCzk != null && machineCzk != null) ? Math.max(0, totalCzk - machineCzk) : null;
      const pseudoKupni = {
        name: (isCs ? 'Lokalita ' : 'Location ') + code, address: kioskLabel, city: '', zip: '', country: 'CZ',
        purchase_price: localityCzk, pradlomat_ref: code, contacts: [],
        _avgTurnover: (typeof kk.avgTop3 === 'number' && isFinite(kk.avgTop3)) ? kk.avgTop3 : null,
        _locationMonths: Number.isFinite(cs.locationMonths) ? cs.locationMonths : 12,
        _version: ver || null, _machinePrice: machineCzk,
        _servicePct: Number.isFinite(cs.servicePct) ? cs.servicePct : 15,
        _buybackPct: Number.isFinite(cs.buybackPct) ? cs.buybackPct : 65,
        _buybackYears: Number.isFinite(cs.buybackYears) ? cs.buybackYears : 5,
      };
      let kf = {};
      try { const pf = contracts.getPrefill('kupni', pseudoKupni, our, contractLang); kf = Object.assign({}, (pf && pf.values) || {}); } catch (e) { kf = {}; }
      if (!isCs) kf._lang = contractLang;
      kf.buyer_name = rec.buyer_name || '';
      kf.buyer_address = rec.buyer_address || '';
      kf.buyer_ico = rec.buyer_ico || '';
      kf.buyer_dic = rec.buyer_dic || '';
      kf.buyer_rep = rec.buyer_rep || '';
      kf.buyer_bank = rec.buyer_bank || '';
      kf._reverse_charge = _isEuReverseCharge(kf.buyer_dic);
      kf.location_desc = kioskLabel ? (code + ' — ' + kioskLabel) : code;
      const rate2 = (contractCur !== 'CZK') ? ((fx && fx[contractCur]) || 0) : 1;
      const priceInCur = (czk) => {
        if (czk == null || !isFinite(czk)) return '';
        if (contractCur !== 'CZK' && rate2 > 0) return (Math.round((czk / rate2) * 100) / 100).toLocaleString('cs-CZ');
        return Math.round(czk).toLocaleString('cs-CZ');
      };
      kf.price_currency = (contractCur !== 'CZK' && rate2 > 0) ? contractCur : (isCs ? 'Kč' : 'CZK');
      if (machineCzk != null) kf.price_machine = priceInCur(machineCzk);
      if (localityCzk != null) kf.price_location = priceInCur(localityCzk);
      if (totalCzk != null) kf.price_total = priceInCur(totalCzk);
      if (rec.fee_total != null) kf.reservation_credit = priceInCur(rec.fee_total);
      kf._linked_contract_id = rezC ? rezC.id : (exKup._linked_contract_id || null);
      await prisma.compoundingContract.update({ where: { id: kupC.id }, data: { fields: kf } });
    }

    res.json({ ok: true, currency: contractCur, lang: contractLang, regenerated: { rezervacni: rezC ? rezC.id : null, kupni: kupC ? kupC.id : null } });
  } catch (err) { next(err); }
});

// GET /api/compounder/reservations — admin přehled
router.get('/reservations', requireAuth, async (req, res, next) => {
  try {
    await expireStaleReservations();
    const status = req.query.status ? String(req.query.status) : null;
    const where = {};
    if (status) where.status = status;
    const rows = await prisma.locationReservation.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
    res.json(rows);
  } catch (err) { next(err); }
});

// Pojistka: když k rezervaci chybí kupní smlouva (starý deploy, dřívější přeskočení…),
// dovytvoří se při akci „Poplatek přišel" a Velín dostane výzvu k podpisu za Best Series.
async function _ensureKupniContract(rec) {
  const code = rec.kiosk_code;
  if (!code) return;
  const already = await prisma.compoundingContract.findFirst({
    where: { kiosk_code: code, type: 'kupni', status: { notIn: ['podepsano'] } }, select: { id: true },
  });
  if (already) return;
  const our = await getOurCompany().catch(() => null);
  let lang = 'cs';
  try {
    const l = rec.lead_id ? await prisma.compounderLead.findUnique({ where: { id: rec.lead_id }, select: { lang: true } }) : null;
    if (l && l.lang) lang = String(l.lang).toLowerCase().slice(0, 2);
  } catch (e) {}
  const isCs = lang === 'cs' || !lang;
  const ki = await _sisKioskInfo(code);
  const cs = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT });
  const cfgMap = (await getSetting(COMPOUNDING_KIOSKS_KEY, { type: 'json', defaultValue: {} })) || {};
  const cfg = cfgMap[code] || {};
  const ks = await _sisKiosks();
  const kk = ks.find((k) => k.code === code) || {};
  const fx = await fxRatesCzk();
  const eur = fx.EUR || 25;
  const ver = String(cfg.version || '').toLowerCase();
  const pl = cs.pricelist || {};
  const machineCzk = (pl[ver] && pl[ver].eur != null && isFinite(Number(pl[ver].eur))) ? Math.round(Number(pl[ver].eur) * eur) : null;
  const totalCzk = (rec.purchase_price != null) ? Number(rec.purchase_price) : null;
  const localityCzk = (totalCzk != null && machineCzk != null) ? Math.max(0, totalCzk - machineCzk) : null;
  const pseudo = {
    name: (isCs ? 'Lokalita ' : 'Location ') + code,
    address: ki.label, city: '', zip: '', country: 'CZ',
    purchase_price: localityCzk, pradlomat_ref: code, contacts: [],
    _avgTurnover: (typeof kk.avgTop3 === 'number' && isFinite(kk.avgTop3)) ? kk.avgTop3 : null,
    _locationMonths: Number.isFinite(cs.locationMonths) ? cs.locationMonths : 12,
    _version: ver || null, _machinePrice: machineCzk,
    _servicePct: Number.isFinite(cs.servicePct) ? cs.servicePct : 15,
    _buybackPct: Number.isFinite(cs.buybackPct) ? cs.buybackPct : 65,
    _buybackYears: Number.isFinite(cs.buybackYears) ? cs.buybackYears : 5,
  };
  let kf = {};
  try {
    const pf = contracts.getPrefill('kupni', pseudo, our, lang);
    kf = Object.assign({}, (pf && pf.values) || {});
  } catch (e) { kf = {}; }
  if (!isCs) kf._lang = lang;
  kf.buyer_name = rec.buyer_name || '';
  kf.buyer_address = rec.buyer_address || '';
  kf.buyer_ico = rec.buyer_ico || '';
  kf.buyer_dic = rec.buyer_dic || '';
  kf.buyer_rep = rec.buyer_rep || '';
  kf.buyer_bank = rec.buyer_bank || '';
  kf._reverse_charge = _isEuReverseCharge(kf.buyer_dic);
  kf.location_desc = ki.label ? (code + ' — ' + ki.label) : code;
  const cur = (String(rec.currency || 'CZK').toUpperCase() !== 'CZK') ? String(rec.currency).toUpperCase() : 'CZK';
  const rate = (cur !== 'CZK') ? ((fx && fx[cur]) || 0) : 1;
  const priceInCur = (czk) => {
    if (czk == null || !isFinite(czk)) return '';
    if (cur !== 'CZK' && rate > 0) return (Math.round((czk / rate) * 100) / 100).toLocaleString('cs-CZ');
    return Math.round(czk).toLocaleString('cs-CZ');
  };
  kf.price_currency = (cur !== 'CZK' && rate > 0) ? cur : (isCs ? 'Kč' : 'CZK');
  if (machineCzk != null) kf.price_machine = priceInCur(machineCzk);
  if (localityCzk != null) kf.price_location = priceInCur(localityCzk);
  if (totalCzk != null) kf.price_total = priceInCur(totalCzk);
  if (rec.fee_total != null) kf.reservation_credit = priceInCur(rec.fee_total);
  // Provaž s poslední rezervační smlouvou téže lokality (podpisy se propisují).
  const rez = await prisma.compoundingContract.findFirst({
    where: { kiosk_code: code, type: 'rezervacni' }, orderBy: { created_at: 'desc' },
  }).catch(() => null);
  if (rez) kf._linked_contract_id = rez.id;
  const token = crypto.randomBytes(24).toString('hex');
  const kupni = await prisma.compoundingContract.create({
    data: { kiosk_code: code, kiosk_label: ki.label || null, type: 'kupni', status: 'k_autorizaci', fields: kf, share_token: token, share_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
  });
  if (rez) {
    await prisma.compoundingContract.update({
      where: { id: rez.id },
      data: { fields: Object.assign({}, rez.fields || {}, { _linked_contract_id: kupni.id }) },
    }).catch(() => {});
  }
  // Výzva do Velína: podepsat kupní smlouvu za Best Series.
  const signUrl = (getAppUrl() || '') + '/modules/podpis-smlouvy/index.html?id=' + kupni.id;
  compounderNotify.notifyContractAwaitingAuthorization(prisma, kupni, signUrl).catch(() => {});
}

// Po zaplacení kupní ceny nabídneme zákazníkovi KOMPLETNÍ SERVIS: připraví se
// servisní smlouva se sdíleným odkazem — zákazník ji uvidí v portálu (Moje
// smlouvy) a pokud o servis stojí, podepíše ji; jinak ji nechá být.
async function _offerServiceContract(rec) {
  const code = rec.kiosk_code;
  if (!code) return;
  const already = await prisma.compoundingContract.findFirst({
    where: { kiosk_code: code, type: 'servisni', status: { notIn: ['podepsano'] } }, select: { id: true },
  });
  if (already) return;
  const our = await getOurCompany().catch(() => null);
  let lang = 'cs';
  try {
    const l = rec.lead_id ? await prisma.compounderLead.findUnique({ where: { id: rec.lead_id }, select: { lang: true } }) : null;
    if (l && l.lang) lang = String(l.lang).toLowerCase().slice(0, 2);
  } catch (e) {}
  const isCs = lang === 'cs' || !lang;
  const ki = await _sisKioskInfo(code);
  const cs = await getSetting(COMPOUNDING_SETTINGS_KEY, { type: 'json', defaultValue: COMPOUNDING_SETTINGS_DEFAULT });
  const pseudo = {
    name: (isCs ? 'Lokalita ' : 'Location ') + code, address: ki.label, pradlomat_ref: code, contacts: [],
    _servicePct: Number.isFinite(cs.servicePct) ? cs.servicePct : 15,
  };
  let sf = {};
  try {
    const pf = contracts.getPrefill('servisni', pseudo, our, lang);
    sf = Object.assign({}, (pf && pf.values) || {});
  } catch (e) { sf = {}; }
  if (!isCs) sf._lang = lang;
  sf.buyer_name = rec.buyer_name || '';
  sf.buyer_address = rec.buyer_address || '';
  sf.buyer_ico = rec.buyer_ico || '';
  sf.buyer_dic = rec.buyer_dic || '';
  sf.buyer_rep = rec.buyer_rep || '';
  sf.buyer_bank = rec.buyer_bank || '';
  sf._reverse_charge = _isEuReverseCharge(sf.buyer_dic);
  sf.location_desc = ki.label ? (code + ' — ' + ki.label) : code;
  const token = crypto.randomBytes(24).toString('hex');
  await prisma.compoundingContract.create({
    data: { kiosk_code: code, kiosk_label: ki.label || null, type: 'servisni', status: 'odeslano', fields: sf, share_token: token, share_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
  });
  try {
    const ids = await resolveOwnerUserIds();
    for (const uid of ids) {
      await createNotification({
        userId: uid, type: 'compounder_service_offer',
        title: 'Nabídka servisní smlouvy — ' + code,
        body: 'Kupní cena zaplacena. Zákazníkovi byla v portálu nabídnuta servisní smlouva (kompletní servis) k podpisu.',
        link: (getAppUrl() || '') + '/modules/prodejni-objednavky/index.html',
      }).catch(() => {});
    }
  } catch (e) {}
}

const resPatchSchema = z.object({
  action: z.enum(['fee_paid', 'fee_unpaid', 'purchase_paid', 'purchase_unpaid', 'cancel', 'reopen']),
  cancel_reason: z.string().max(200).optional(),
});

// PATCH /api/compounder/reservations/:id — admin akce (platba / zrušení)
router.patch('/reservations/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID' });
    const parsed = resPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const now = new Date();
    const data = {};
    switch (parsed.data.action) {
      case 'fee_paid': data.fee_paid_at = now; data.signed_at = now; data.status = 'active'; break;
      case 'fee_unpaid': data.fee_paid_at = null; data.status = 'reserved'; break;
      case 'purchase_paid': data.purchase_paid_at = now; data.status = 'completed'; break;
      case 'purchase_unpaid': data.purchase_paid_at = null; data.status = 'active'; break;
      case 'cancel': data.status = 'cancelled'; data.cancel_reason = parsed.data.cancel_reason || 'Zrušeno ručně'; break;
      case 'reopen': data.status = 'cancelled'; data.cancel_reason = 'Uvolněno ručně'; break;
    }
    const rec = await prisma.locationReservation.update({ where: { id }, data });
    const evMap = { fee_paid: 'fee_paid', purchase_paid: 'purchase_paid', cancel: 'cancelled', reopen: 'cancelled' };
    if (evMap[parsed.data.action]) compounderNotify.notifyReservationEvent(prisma, { reservation: rec, event: evMap[parsed.data.action] }).catch(() => {});
    // Poplatek přišel → pojistka: chybí-li kupní smlouva, dovytvoř ji a pošli k podpisu.
    if (parsed.data.action === 'fee_paid') {
      _ensureKupniContract(rec).catch((e) => console.error('[kupni ensure]', e));
    }
    // Kupní cena zaplacena → nabídnout zákazníkovi kompletní servis (servisní smlouva v portálu).
    if (parsed.data.action === 'purchase_paid') {
      _offerServiceContract(rec).catch((e) => console.error('[servisni offer]', e));
    }
    res.json(rec);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Rezervace nenalezena' });
    next(err);
  }
});

// ─── Nastavení příjemců Velín notifikací (ozubené kolečko) ───────────────────
// GET vrátí seznam Velín osob + aktuálně vybrané (fallback = majitelé Jan/Tomáš).
router.get('/notify-settings', requireAuth, async (req, res, next) => {
  try {
    const people = await compounderNotify.getEligibleVelinPeople(prisma);
    let selected = await getSetting(compounderNotify.NOTIFY_SETTING_KEY, { type: 'json', defaultValue: null });
    if (!Array.isArray(selected)) selected = await compounderNotify.defaultRecipientPersonIds(prisma);
    res.json({ people, selected });
  } catch (err) { next(err); }
});

const notifySettingsSchema = z.object({ person_ids: z.array(z.number().int().positive()).max(50) });

// PUT uloží vybrané Person.id příjemců.
router.put('/notify-settings', requireAuth, async (req, res, next) => {
  try {
    const parsed = notifySettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neplatná data' });
    const ids = Array.from(new Set(parsed.data.person_ids));
    await setSetting(compounderNotify.NOTIFY_SETTING_KEY, ids, { type: 'json' });
    res.json({ ok: true, selected: ids });
  } catch (err) { next(err); }
});

// ─── Rezervace + smlouvy konkrétního leada (pro detail v tabu Compounder) ─────
router.get('/leads/:id(\\d+)/reservations', requireAuth, async (req, res, next) => {
  try {
    await expireStaleReservations();
    const leadId = Number(req.params.id);
    const reservations = await prisma.locationReservation.findMany({
      where: { lead_id: leadId }, orderBy: { created_at: 'desc' }, take: 50,
    });
    const codes = Array.from(new Set(reservations.map((r) => r.kiosk_code).filter(Boolean)));
    let contracts = [];
    if (codes.length) {
      const raw = await prisma.compoundingContract.findMany({
        where: { kiosk_code: { in: codes } },
        orderBy: { created_at: 'desc' },
        select: { id: true, kiosk_code: true, kiosk_label: true, type: true, status: true, signed_at: true, updated_at: true, fields: true },
      });
      // Nevracíme celá fields (obsahují base64 podpisy) — jen příznak archivace.
      contracts = raw.map((c) => ({
        id: c.id, kiosk_code: c.kiosk_code, kiosk_label: c.kiosk_label, type: c.type,
        status: c.status, signed_at: c.signed_at, updated_at: c.updated_at,
        archived: !!(c.fields && c.fields._archived),
      }));
    }
    res.json({ reservations, contracts });
  } catch (err) { next(err); }
});

// ─── Pokyny k platbě (Compounding rezervace) ─────────────────────────────────
const paymentInstructions = require('../services/pdf/payment-instructions');
function makePayToken(id) { return id + '.' + hmacSig('pay:' + id); }
function verifyPayToken(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  const p = String(token).split('.'); const id = Number(p[0]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return safeEqStr(p[1], hmacSig('pay:' + id)) ? id : null;
}
// Naše bankovní účty (Best Series s.r.o.): CZK pro tuzemské platby, EUR pro zahraniční.
const OUR_BANK = {
  czk: { account: '221913663', bankCode: '0600', iban: 'CZ6706000000000221913663', bic: 'AGBACZPP', name: 'BEST SERIES S.R.O.' },
  eur: { account: '222043452', bankCode: '0600', iban: 'CZ8306000000000222043452', bic: 'AGBACZPP', name: 'BEST SERIES S.R.O.' },
};
const OUR_BANK_LINE = 'CZK: 221913663/0600 (IBAN CZ6706000000000221913663); EUR: 222043452/0600 (IBAN CZ8306000000000222043452, BIC AGBACZPP)';
const PAY_L = {
  cs: { fee: 'Rezervační poplatek', buy: 'Kupní cena (po odečtení poplatku)', title: 'Pokyny k platbě — rezervace', subj: 'Pokyny k platbě — Compounder', pre: 'Údaje k úhradě rezervace a kupní ceny.', body: (n) => 'Dobrý den' + (n ? ', ' + n : '') + ',\n\nv příloze posíláme pokyny k platbě (rezervační poplatek a kupní cena) včetně QR kódů. Po přijetí platby vám vystavíme fakturu.', wa: (n, k, u) => 'Dobrý den' + (n ? ', ' + n : '') + ', zde jsou pokyny k platbě za rezervaci ' + k + ' (QR uvnitř PDF): ' + u },
  en: { fee: 'Reservation fee', buy: 'Purchase price (less reservation fee)', title: 'Payment instructions — reservation', subj: 'Payment instructions — Compounder', pre: 'Details to pay the reservation and purchase price.', body: (n) => 'Hello' + (n ? ' ' + n : '') + ',\n\nplease find attached the payment instructions (reservation fee and purchase price) including QR codes. Once received, we will issue an invoice.', wa: (n, k, u) => 'Hello' + (n ? ' ' + n : '') + ', here are the payment instructions for reservation ' + k + ' (QR inside the PDF): ' + u },
  sk: { fee: 'Rezervačný poplatok', buy: 'Kúpna cena (po odčítaní poplatku)', title: 'Pokyny na platbu — rezervácia', subj: 'Pokyny na platbu — Compounder', pre: 'Údaje na úhradu rezervácie a kúpnej ceny.', body: (n) => 'Dobrý deň' + (n ? ', ' + n : '') + ',\n\nv prílohe posielame pokyny na platbu (rezervačný poplatok a kúpna cena) vrátane QR kódov. Po prijatí platby vystavíme faktúru.', wa: (n, k, u) => 'Dobrý deň' + (n ? ', ' + n : '') + ', tu sú pokyny na platbu za rezerváciu ' + k + ' (QR v PDF): ' + u },
  de: { fee: 'Reservierungsgebühr', buy: 'Kaufpreis (abzüglich Gebühr)', title: 'Zahlungsanweisungen — Reservierung', subj: 'Zahlungsanweisungen — Compounder', pre: 'Angaben zur Zahlung von Reservierung und Kaufpreis.', body: (n) => 'Hallo' + (n ? ' ' + n : '') + ',\n\nim Anhang senden wir die Zahlungsanweisungen (Reservierungsgebühr und Kaufpreis) inkl. QR-Codes. Nach Zahlungseingang stellen wir eine Rechnung aus.', wa: (n, k, u) => 'Hallo' + (n ? ' ' + n : '') + ', hier sind die Zahlungsanweisungen für die Reservierung ' + k + ' (QR im PDF): ' + u },
  pl: { fee: 'Opłata rezerwacyjna', buy: 'Cena zakupu (po odjęciu opłaty)', title: 'Instrukcje płatności — rezerwacja', subj: 'Instrukcje płatności — Compounder', pre: 'Dane do zapłaty rezerwacji i ceny zakupu.', body: (n) => 'Dzień dobry' + (n ? ' ' + n : '') + ',\n\nw załączniku przesyłamy instrukcje płatności (opłata rezerwacyjna i cena zakupu) wraz z kodami QR. Po otrzymaniu płatności wystawimy fakturę.', wa: (n, k, u) => 'Dzień dobry' + (n ? ' ' + n : '') + ', oto instrukcje płatności za rezerwację ' + k + ' (QR w PDF): ' + u },
};
function payL(l) { const c = String(l || 'cs').toLowerCase().split(/[-_]/)[0]; return PAY_L[c] || PAY_L.en; }
const PAY_PORTAL_BTN = { cs: 'Otevřít Compounder Portal', en: 'Open the Compounder Portal', sk: 'Otvoriť Compounder Portál', de: 'Compounder Portal öffnen', pl: 'Otwórz Compounder Portal' };
function payPortalBtn(l) { const c = String(l || 'cs').toLowerCase().split(/[-_]/)[0]; return PAY_PORTAL_BTN[c] || PAY_PORTAL_BTN.en; }
async function _buildPaymentCtx(resId) {
  const resv = await prisma.locationReservation.findUnique({ where: { id: resId } });
  if (!resv) return null;
  let lang = 'cs';
  if (resv.lead_id) { try { const l = await prisma.compounderLead.findUnique({ where: { id: resv.lead_id }, select: { lang: true } }); if (l && l.lang) lang = l.lang; } catch (e) {} }
  const tr = payL(lang);
  // Tuzemské (CZK) i zahraniční (EUR) platby jdou na naše účty Best Series.
  const bank = {
    czk: { account: OUR_BANK.czk.account, bankCode: OUR_BANK.czk.bankCode, iban: OUR_BANK.czk.iban, name: OUR_BANK.czk.name },
    eur: { iban: OUR_BANK.eur.iban, bic: OUR_BANK.eur.bic, name: OUR_BANK.eur.name },
  };
  const cur = resv.currency || 'CZK';
  const vs = String(resv.id);
  const items = [];
  if (resv.fee_total) items.push({ label: tr.fee + ' — ' + resv.kiosk_code, amount: resv.fee_total, currency: cur, due: resv.fee_until, vs });
  if (resv.purchase_price != null) {
    const rest = Math.max(0, resv.purchase_price - (resv.fee_total || 0));
    items.push({ label: tr.buy + ' — ' + resv.kiosk_code, amount: rest, currency: cur, due: resv.reserved_until, vs });
  }
  let eurRate = 25;
  try { const fx = await fxRatesCzk(); if (fx && fx.EUR) eurRate = fx.EUR; } catch (e) {}
  // Neplátce / CZ plátce → přičteme 21 % DPH; EU plátce (zahraniční DIČ) → reverse charge (0 %).
  const reverseCharge = _isEuReverseCharge(resv.buyer_dic);
  return { resv, bank, items, lang, tr, eurRate, reverseCharge, buyer: { name: resv.buyer_name, email: resv.buyer_email, phone: resv.buyer_phone } };
}
async function _payPdf(resId) {
  const ctx = await _buildPaymentCtx(resId);
  if (!ctx) return null;
  return paymentInstructions.generatePaymentInstructionsPdf({
    title: ctx.tr.title + ' ' + ctx.resv.kiosk_code,
    buyer: ctx.buyer, items: ctx.items, bank: ctx.bank, lang: ctx.lang, eurRate: ctx.eurRate,
    reverseCharge: ctx.reverseCharge, vatRate: 0.21,
  });
}
router.get('/reservations/:id(\\d+)/payment-instructions.pdf', requireAuth, async (req, res, next) => {
  try {
    const pdf = await _payPdf(Number(req.params.id));
    if (!pdf) return res.status(404).json({ error: 'Rezervace nenalezena' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="pokyny-k-platbe.pdf"');
    res.send(pdf);
  } catch (err) { console.error('[pay-pdf]', err); return res.status(500).type('text/plain; charset=utf-8').send('Nepodařilo se vytvořit PDF pokynů k platbě: ' + ((err && err.message) || String(err))); }
});
router.get('/reservations/pay/:token/pdf', async (req, res, next) => {
  try {
    const id = verifyPayToken(String(req.params.token || ''));
    if (!id) return res.status(404).json({ error: 'Neplatný odkaz' });
    const pdf = await _payPdf(id);
    if (!pdf) return res.status(404).json({ error: 'Rezervace nenalezena' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="pokyny-k-platbe.pdf"');
    res.send(pdf);
  } catch (err) { console.error('[pay-pdf]', err); return res.status(500).type('text/plain; charset=utf-8').send('Nepodařilo se vytvořit PDF pokynů k platbě: ' + ((err && err.message) || String(err))); }
});
router.post('/reservations/:id(\\d+)/payment-instructions/email', requireAuth, async (req, res, next) => {
  try {
    const ctx = await _buildPaymentCtx(Number(req.params.id));
    if (!ctx.buyer.email) return res.status(400).json({ error: 'Rezervace nemá e-mail kupujícího.' });
    const pdf = await _payPdf(Number(req.params.id));
    const from = process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || process.env.INVOICE_IMAP_USER;
    // Odkaz na PORTÁL (compounder.world), přihlášený přes token leada — žádná vazba na HolyOS.
    const portalLink = ctx.resv.lead_id
      ? (portalBase() + '/portal?t=' + makeLoginToken(ctx.resv.lead_id))
      : (portalBase() + '/portal');
    await sendMail({
      to: ctx.buyer.email, from, fromName: compounderMailFromName(),
      replyTo: process.env.COMPOUNDER_MAIL_REPLYTO || from, brand: 'compounder',
      subject: ctx.tr.subj, preheader: ctx.tr.pre,
      body: ctx.tr.body(ctx.buyer.name || ''),
      link: portalLink, linkLabel: payPortalBtn(ctx.lang),
      attachments: [{ filename: 'pokyny-k-platbe.pdf', content: pdf, contentType: 'application/pdf' }],
    });
    const upd = await prisma.locationReservation.update({ where: { id: Number(req.params.id) }, data: { pay_instr_sent_count: { increment: 1 }, pay_instr_last_sent_at: new Date() }, select: { pay_instr_sent_count: true, pay_instr_last_sent_at: true } });
    res.json({ ok: true, pay_instr_sent_count: upd.pay_instr_sent_count, pay_instr_last_sent_at: upd.pay_instr_last_sent_at });
  } catch (err) { next(err); }
});
router.post('/reservations/:id(\\d+)/payment-instructions/whatsapp', requireAuth, async (req, res, next) => {
  try {
    const ctx = await _buildPaymentCtx(Number(req.params.id));
    if (!ctx) return res.status(404).json({ error: 'Rezervace nenalezena' });
    if (!ctx.buyer.phone) return res.status(400).json({ error: 'Rezervace nemá telefon kupujícího.' });
    const url = portalBase() + '/api/compounder/reservations/pay/' + makePayToken(Number(req.params.id)) + '/pdf';
    const msg = ctx.tr.wa(ctx.buyer.name || '', ctx.resv.kiosk_code, url);
    let wa = String(ctx.buyer.phone).replace(/[^\d]/g, ''); if (wa.startsWith('00')) wa = wa.slice(2);
    const upd = await prisma.locationReservation.update({ where: { id: Number(req.params.id) }, data: { pay_instr_sent_count: { increment: 1 }, pay_instr_last_sent_at: new Date() }, select: { pay_instr_sent_count: true, pay_instr_last_sent_at: true } });
    res.json({ ok: true, phone: wa, message: msg, url, pay_instr_sent_count: upd.pay_instr_sent_count, pay_instr_last_sent_at: upd.pay_instr_last_sent_at });
  } catch (err) { next(err); }
});

module.exports = router;
