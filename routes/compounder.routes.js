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
      select: { id: true, name: true, email: true, phone: true, role: true, lang: true, visible_sections: true, visible_templates: true, owner_person_id: true, password_hash: true, source: true, access_approved_at: true },
    });
    if (!lead) return res.status(404).json({ ok: false, error: 'Registrace nenalezena.' });
    if (!leadAccessAllowed(lead)) {
      return res.status(403).json({ ok: false, pending: true, error: 'Tvoje žádost o přístup zatím čeká na schválení. Jakmile ho povolíme, dostaneš přihlašovací odkaz e-mailem.' });
    }
    const templates = (lead.visible_templates ? lead.visible_templates.split(',') : []).map((s) => s.trim()).filter(Boolean);
    // Přiřazený obchodník = "Compounder konzultant" pro kontaktní sekci portálu.
    let consultant = null;
    if (lead.owner_person_id) {
      try {
        const p = await prisma.person.findUnique({ where: { id: lead.owner_person_id }, select: { first_name: true, last_name: true, phone: true, email: true } });
        if (p) consultant = { name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(), phone: p.phone || '', email: p.email || '' };
      } catch (e) { /* fallback na majitele */ }
    }
    return res.json({ ok: true, id: lead.id, name: lead.name, email: lead.email || '', phone: lead.phone || '', role: lead.role, lang: lead.lang, sections: resolveSections(lead.visible_sections), templates: templates, consultant: consultant, has_password: !!lead.password_hash });
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
    const rows = await prisma.compoundingContract.findMany({
      where: { kiosk_code: { in: codes }, share_token: { not: null } },
      orderBy: { created_at: 'desc' },
      select: { type: true, status: true, kiosk_code: true, kiosk_label: true, share_token: true, signed_at: true },
    });
    const out = rows.map((r) => ({
      type: r.type,
      typeLabel: contracts.TYPE_LABEL[r.type] || 'Smlouva',
      status: r.status,
      kiosk_code: r.kiosk_code,
      kiosk_label: r.kiosk_label,
      url: '/smlouva/' + r.share_token,
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
        select: { type: true, status: true, kiosk_code: true, kiosk_label: true, share_token: true, signed_at: true, created_at: true, updated_at: true },
      });
    }
    const msgs = []; // { ts, icon, text }
    const push = (ts, icon, text) => { if (ts && text) msgs.push({ ts: new Date(ts).toISOString(), icon, text }); };
    let actionable = 0;
    const docs = [];
    reservations.forEach((r) => {
      const lbl = r.kiosk_code || 'lokalita';
      docs.push({ kind: 'reservation', label: lbl, status: r.status, statusLabel: RES_STATUS_LABEL[r.status] || r.status, reserved_until: r.reserved_until, sign_until: r.sign_until, fee_until: r.fee_until, fee_paid: !!r.fee_paid_at, purchase_paid: !!r.purchase_paid_at });
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
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim().slice(0, 40);
    const message = String(b.message || '').trim().slice(0, 2000);
    const name = String(b.name || '').trim().slice(0, 255);
    if (!email || email.indexOf('@') === -1) return res.status(400).json({ ok: false, error: 'Neplatný e-mail.' });
    if (!phone) return res.status(400).json({ ok: false, error: 'Zadejte telefon.' });
    if (!message) return res.status(400).json({ ok: false, error: 'Napište důvod žádosti.' });

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
    const noteText = '[' + stamp + '] POPTÁVKA NÁKUPU — ' + d.count + '× Compounder'
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
      props: { lead_id: leadId, count: d.count, locations: String(d.locations).slice(0, 300), ico: d.ico || null, address: (d.address || '').slice(0, 200) || null, phone: phone, note: (d.note || '').slice(0, 300) || null },
      path: '/portal', ip: clientIp(req),
    } }).catch(() => {});
    compounderNotify.notifyPurchaseInquiry(prisma, { lead, count: d.count, locations: d.locations, phone: phone })
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

    res.json({
      ok: true,
      totals: { leads: leads.length, converted, conversionPct: leads.length ? Math.round((converted / leads.length) * 100) : 0, unassigned },
      sellers,
      reservations: { total: resv.length, byStatus: resvByStatus, items: resvItems.slice(0, 50) },
      recent,
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
    where: { owner_person_id: personId },
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
    const where = { owner_person_id: meId };
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
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().max(255).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  // Viditelné sekce portálu: pole klíčů skupin nebo CSV. [] => jen úvodní filozofie.
  sections: z.union([z.array(z.string()), z.string()]).optional(),
  // Zpřístupněné vzory smluv (mustry): pole/CSV typů rezervacni,kupni,servisni.
  templates: z.union([z.array(z.string()), z.string()]).optional(),
  // Individuální nabídka lokalit navíc (pole/CSV kódů kiosků).
  extraOffers: z.union([z.array(z.string()), z.string()]).optional(),
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
      prisma.compounderLead.count({ where: { created_at: { gte: since } } }),
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
    await setSetting(COMPOUNDING_SETTINGS_KEY, parsed.data, {
      type: 'json',
      scope: 'compounding',
      description: 'Compounding — ceník V2/V3/V4 (EUR bez DPH) + počet měsíců pro cenu lokality',
      userId: req.user && req.user.id,
    });
    res.json({ ok: true, settings: parsed.data });
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

    for (const f of files) {
      if (photos.length >= 3) break;
      if (!/^image\//.test(f.mimetype || '')) continue;
      const ext = (f.mimetype === 'image/png') ? '.png' : (f.mimetype === 'image/webp') ? '.webp' : '.jpg';
      const key = 'compounding/' + code + '/' + crypto.randomUUID() + ext;
      const { url } = await r2Put(key, f.buffer, f.mimetype);
      if (url) photos.push(url);
    }

    next_[code] = { ...cur, photos: photos.slice(0, 3) };
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
    res.json(contracts.getPrefill(type, pseudoSite, our));
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

// POST vygenerovat PDF z uložené smlouvy (volitelně z upravených polí)
router.post('/contracts/:id(\\d+)/pdf', requireAuth, async (req, res, next) => {
  try {
    const row = await prisma.compoundingContract.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Smlouva nenalezena' });
    const fields = (req.body && req.body.fields) || row.fields || {};
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
    fields.forEach((f) => { values[f.name] = (row.fields && row.fields[f.name] != null) ? row.fields[f.name] : ''; });
    res.json({
      typeLabel: contracts.TYPE_LABEL[row.type] || 'Smlouva',
      kioskLabel: row.kiosk_label || '',
      status: row.status,
      fields, values,
    });
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
    Object.keys(incoming).forEach((k) => { if (allowed.has(k)) merged[k] = String(incoming[k] == null ? '' : incoming[k]).slice(0, 500); });
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
      return res.json({ ok: true, fully_signed: true });
    }
    // Klasický flow: zákazník podepsal → čeká na náš podpis (Jan/Tomáš dostanou push + odkaz).
    const awaitingRow = await prisma.compoundingContract.update({
      where: { id: row.id },
      data: { fields: merged, status: 'k_podpisu', filled_at: row.filled_at || signedAt },
    });
    const signUrl = (getAppUrl() || '') + '/modules/podpis-smlouvy/index.html?id=' + row.id;
    compounderNotify.notifyContractAwaitingCountersign(prisma, awaitingRow, signUrl).catch(() => {});
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
      return res.json({ ok: true, awaiting_customer: true });
    }
    const signedRow = await prisma.compoundingContract.update({
      where: { id: row.id }, data: { fields: merged, status: 'podepsano', signed_at: signedAt },
    });
    compounderNotify.notifyContractEvent(prisma, { contract: signedRow, event: 'signed' }).catch(() => {});
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
        };
      })
      // Lokality bez fotky: na portálu skrýt, v admin/obchodník náhledu ponechat (s flagem noPhoto).
      .filter((o) => opts.includeHidden || !o.noPhoto)
      .sort((a, b) => {
        // VIP (individuální) nabídky nahoru, pak podle ročního výnosu.
        if (!!a.individual !== !!b.individual) return a.individual ? -1 : 1;
        return (b.yearlyYield || 0) - (a.yearlyYield || 0);
      });

    return { ok: true, currency: 'CZK', defaultCurrency: defCur, eurRate: eur, rates: fx, feePerDayCzk: feePerDay, reservation: { feePerDayCzk: feePerDay, holdHours, signDays, payDays, reblockDays }, count: list.length, locations: list };
}

router.get('/portal/offered-locations', async (req, res, next) => {
  try {
    const leadId = verifyPortalToken(String(req.query.t || ''));
    if (!leadId) return res.status(401).json({ ok: false, error: 'Neplatný nebo chybějící přístupový odkaz.' });
    res.json(await buildOfferedLocations(leadId));
  } catch (err) { next(err); }
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
  buyer: z.object({
    name: z.string().max(255).optional(),
    email: z.string().max(255).optional(),
    phone: z.string().max(40).optional(),
    ico: z.string().max(20).optional(),
    address: z.string().max(500).optional(),
  }).optional(),
});

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
      buyer_ico: b.ico || null, buyer_address: b.address || null,
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
        const pseudoSite = { name: 'Lokalita ' + code, address: rec.buyer_address || '', pradlomat_ref: code, purchase_price: (rec.purchase_price != null) ? rec.purchase_price : null, contacts: [] };
        let cf = {};
        try { cf = contracts.getPrefill('rezervacni', pseudoSite, our) || {}; } catch (e) { cf = {}; }
        cf.buyer_name = rec.buyer_name || cf.buyer_name || '';
        cf.buyer_address = rec.buyer_address || cf.buyer_address || '';
        cf.buyer_ico = rec.buyer_ico || cf.buyer_ico || '';
        cf.location_desc = code;
        const token = crypto.randomBytes(24).toString('hex');
        const contract = await prisma.compoundingContract.create({
          data: { kiosk_code: code, kiosk_label: null, type: 'rezervacni', status: 'k_autorizaci', fields: cf, share_token: token, share_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        });
        const signUrl = (getAppUrl() || '') + '/modules/podpis-smlouvy/index.html?id=' + contract.id;
        compounderNotify.notifyContractAwaitingCountersign(prisma, contract, signUrl).catch(() => {});
      }
    } catch (e) { console.error('[compounder] auto rezervační smlouva selhala:', e.message); }

    res.json({ ok: true, id: rec.id, code, days, feePerDay, feeTotal, signUntil, feeUntil, reservedUntil });
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

const resPatchSchema = z.object({
  action: z.enum(['fee_paid', 'purchase_paid', 'cancel', 'reopen']),
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
      case 'purchase_paid': data.purchase_paid_at = now; data.status = 'completed'; break;
      case 'cancel': data.status = 'cancelled'; data.cancel_reason = parsed.data.cancel_reason || 'Zrušeno ručně'; break;
      case 'reopen': data.status = 'cancelled'; data.cancel_reason = 'Uvolněno ručně'; break;
    }
    const rec = await prisma.locationReservation.update({ where: { id }, data });
    const evMap = { fee_paid: 'fee_paid', purchase_paid: 'purchase_paid', cancel: 'cancelled', reopen: 'cancelled' };
    compounderNotify.notifyReservationEvent(prisma, { reservation: rec, event: evMap[parsed.data.action] }).catch(() => {});
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
      contracts = await prisma.compoundingContract.findMany({
        where: { kiosk_code: { in: codes } },
        orderBy: { created_at: 'desc' },
        select: { id: true, kiosk_code: true, kiosk_label: true, type: true, status: true, signed_at: true, updated_at: true },
      });
    }
    res.json({ reservations, contracts });
  } catch (err) { next(err); }
});

module.exports = router;
