// HolyOS — Obchodní pomůcky (sales tools) API
// Sdílení sales-aid nástrojů (např. Ekonomika prádlomatu) se zákazníky
// přes tokenovaný odkaz + tracking využití.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { sendMail } = require('../services/email');
const { generateSummary: generateBusinessToolAiSummary } = require('../services/ai/business-tool-summary');
const { buildShareUrl: buildPublicShareUrl } = require('../services/share-url');

// Seznam podporovaných pomůcek (rozšiřitelný)
const SUPPORTED_TOOLS = {
  'pradlomat-economy': {
    title: 'Ekonomika prádlomatu',
    description: 'Editovatelný model návratnosti pro jeden prádlomat',
  },
  'pradlomat-balicek': {
    title: 'Prádlomat — servisní balíček',
    description: 'Model návratnosti se servisním balíčkem (% z obratu) z pohledu provozovatele',
  },
};

function isSupportedTool(slug) {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_TOOLS, slug);
}

// Podporované jazykové mutace pro veřejnou share stránku.
// Při rozšíření o další jazyk přidej i překlady v pradlomat-economy.js (window.PRADLOMAT_I18N).
const SUPPORTED_LANGUAGES = ['cs', 'en', 'de', 'fr'];

// Vrátí očištěné pole jazykových kódů; vždy obsahuje alespoň 'cs'.
function sanitizeLanguages(input) {
  if (!Array.isArray(input)) return ['cs'];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const code = raw.toLowerCase().trim();
    if (!SUPPORTED_LANGUAGES.includes(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  if (!out.length) out.push('cs');
  // Garantovat 'cs' jako fallback (always-available default)
  if (!seen.has('cs')) out.push('cs');
  return out;
}

function generateShareToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 hex znaků
}

function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

async function logEvent(recipient_id, event_type, payload, req) {
  try {
    await prisma.businessToolEvent.create({
      data: {
        recipient_id,
        event_type,
        payload: payload || null,
        ip: req ? getClientIp(req) : null,
        user_agent: req ? (req.headers['user-agent'] || null) : null,
      },
    });
  } catch (e) {
    console.error('[BusinessTools] Nepodařilo se uložit event:', e.message);
  }
}

// =============================================================================
// VEŘEJNÉ ENDPOINTY (token-based, bez requireAuth)
// =============================================================================
// POZOR: tyto musí být PŘED `router.use(requireAuth)` a před dynamickou /:id
// route — viz memory "HolyOS Express route order".

// GET /api/tools/share/:token  — načte recipient + tool meta + poslední model
router.get('/share/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').toLowerCase().replace(/[^a-f0-9]/g, '');
    if (!token || token.length < 32) {
      return res.status(404).json({ error: 'Neplatný odkaz' });
    }

    const recipient = await prisma.businessToolRecipient.findUnique({
      where: { share_token: token },
      include: {
        models: { orderBy: { created_at: 'desc' }, take: 20 },
      },
    });

    if (!recipient) return res.status(404).json({ error: 'Odkaz nenalezen nebo expiroval' });

    // Globální výchozí hodnoty pomůcky (pokud admin nějaké uložil) — slouží jako
    // fallback pro initial state, když zákazník zatím nic neuložil.
    const defaultsRow = await prisma.businessToolDefaults.findUnique({
      where: { tool: recipient.tool },
    });

    // Tichá aktualizace last_opened + open_count (jen pokud to není první 'sent' event tohoto okamžiku)
    await prisma.businessToolRecipient.update({
      where: { id: recipient.id },
      data: {
        last_opened: new Date(),
        open_count: { increment: 1 },
      },
    });

    await logEvent(recipient.id, 'opened', null, req);

    const meta = SUPPORTED_TOOLS[recipient.tool] || { title: recipient.tool, description: '' };

    // languages může být null pro staré záznamy před migrací — fallback na ['cs'].
    const languages = (Array.isArray(recipient.languages) && recipient.languages.length)
      ? recipient.languages
      : ['cs'];

    res.json({
      recipient: {
        id: recipient.id,
        tool: recipient.tool,
        name: recipient.name,
        email: recipient.email,
        company: recipient.company,
        note: recipient.note,
      },
      tool: { slug: recipient.tool, ...meta },
      languages,
      defaults_json: defaultsRow ? defaultsRow.data_json : null,
      locks_json: defaultsRow ? (defaultsRow.locks_json || {}) : {},
      models: recipient.models.map((m) => ({
        id: m.id,
        name: m.name,
        data_json: m.data_json,
        created_at: m.created_at,
        saved_from: m.saved_from,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/tools/share/:token/event  — log custom event (edited, exported, ...)
router.post('/share/:token/event', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').toLowerCase().replace(/[^a-f0-9]/g, '');
    const { event_type, payload } = req.body || {};
    if (!event_type) return res.status(400).json({ error: 'Chybí event_type' });

    const recipient = await prisma.businessToolRecipient.findUnique({
      where: { share_token: token },
      select: { id: true },
    });
    if (!recipient) return res.status(404).json({ error: 'Odkaz nenalezen' });

    // Whitelist event_type, aby nám klient nemohl ukládat "sent" / "deleted" apod.
    const allowed = ['opened', 'edited', 'exported', 'viewed'];
    const safeType = allowed.includes(event_type) ? event_type : 'edited';

    await logEvent(recipient.id, safeType, payload || null, req);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/tools/share/:token/model  — uložit verzi modelu
router.post('/share/:token/model', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').toLowerCase().replace(/[^a-f0-9]/g, '');
    const { name, data_json, computed_json } = req.body || {};
    if (!data_json || typeof data_json !== 'object') {
      return res.status(400).json({ error: 'Chybí data_json' });
    }

    const recipient = await prisma.businessToolRecipient.findUnique({
      where: { share_token: token },
      select: { id: true },
    });
    if (!recipient) return res.status(404).json({ error: 'Odkaz nenalezen' });

    const model = await prisma.businessToolModel.create({
      data: {
        recipient_id: recipient.id,
        name: name && String(name).trim() ? String(name).trim().slice(0, 255) : 'Pracovní model',
        data_json,
        computed_json: computed_json || null,
        saved_from: 'customer',
      },
    });

    await prisma.businessToolRecipient.update({
      where: { id: recipient.id },
      data: { save_count: { increment: 1 } },
    });

    await logEvent(recipient.id, 'saved', { model_id: model.id, name: model.name }, req);

    res.status(201).json({ id: model.id, name: model.name, created_at: model.created_at });
  } catch (e) {
    next(e);
  }
});

// GET /api/tools/defaults/:tool  — globální výchozí hodnoty (veřejné, bez auth)
// Public proto, aby šly načíst i ze share stránky, kde zákazník nemá auth.
// PUT je naopak admin-only (viz dál).
router.get('/defaults/:tool', async (req, res, next) => {
  try {
    const tool = String(req.params.tool || '').toLowerCase();
    if (!isSupportedTool(tool)) return res.status(404).json({ error: 'Neznámá pomůcka' });

    const row = await prisma.businessToolDefaults.findUnique({
      where: { tool },
      include: {
        updater: { select: { id: true, display_name: true, username: true } },
      },
    });
    if (!row) return res.json({ tool, data_json: null, locks_json: {}, updated_at: null, updater: null });

    res.json({
      tool: row.tool,
      data_json: row.data_json,
      locks_json: row.locks_json || {},
      updated_at: row.updated_at,
      updater: row.updater,
    });
  } catch (e) {
    next(e);
  }
});

// =============================================================================
// ADMIN ENDPOINTY (vyžadují auth)
// =============================================================================

router.use(requireAuth);

// PUT /api/tools/defaults/:tool  — uloží/aktualizuje výchozí hodnoty (admin)
// Přijímá { data_json, locks_json? }. locks_json se sanitizuje na boolean values.
router.put('/defaults/:tool', async (req, res, next) => {
  try {
    const tool = String(req.params.tool || '').toLowerCase();
    if (!isSupportedTool(tool)) return res.status(404).json({ error: 'Neznámá pomůcka' });

    const { data_json, locks_json } = req.body || {};
    if (!data_json || typeof data_json !== 'object') {
      return res.status(400).json({ error: 'Chybí data_json' });
    }

    // Normalizace locks: jen klíče s hodnotou true
    let locks = {};
    if (locks_json && typeof locks_json === 'object') {
      for (const k of Object.keys(locks_json)) {
        if (locks_json[k] === true) locks[k] = true;
      }
    }

    const row = await prisma.businessToolDefaults.upsert({
      where: { tool },
      update: { data_json, locks_json: locks, updated_by: req.user.id },
      create: { tool, data_json, locks_json: locks, updated_by: req.user.id },
    });

    res.json({
      tool: row.tool,
      data_json: row.data_json,
      locks_json: row.locks_json || {},
      updated_at: row.updated_at,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/tools/recipients?tool=pradlomat-economy
router.get('/recipients', async (req, res, next) => {
  try {
    const tool = req.query.tool ? String(req.query.tool) : undefined;
    const where = {};
    if (tool) where.tool = tool;

    const list = await prisma.businessToolRecipient.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        creator: { select: { id: true, display_name: true, username: true } },
        _count: { select: { models: true, events: true } },
      },
    });

    res.json(list.map((r) => ({
      id: r.id,
      tool: r.tool,
      tool_meta: SUPPORTED_TOOLS[r.tool] || null,
      name: r.name,
      email: r.email,
      company: r.company,
      note: r.note,
      share_token: r.share_token,
      share_link: buildPublicShareUrl('/share/tools/' + r.tool + '/' + r.share_token),
      languages: (Array.isArray(r.languages) && r.languages.length) ? r.languages : ['cs'],
      created_at: r.created_at,
      last_opened: r.last_opened,
      open_count: r.open_count,
      save_count: r.save_count,
      models_count: r._count.models,
      events_count: r._count.events,
      creator: r.creator,
    })));
  } catch (e) {
    next(e);
  }
});

// GET /api/tools/tools-meta — seznam podporovaných pomůcek
router.get('/tools-meta', (req, res) => {
  const list = Object.entries(SUPPORTED_TOOLS).map(([slug, meta]) => ({ slug, ...meta }));
  res.json(list);
});

// POST /api/tools/recipients — založí příjemce + pošle email
router.post('/recipients', async (req, res, next) => {
  try {
    const { tool, name, email, company, note, send_email, languages } = req.body || {};

    if (!tool || !isSupportedTool(tool)) {
      return res.status(400).json({ error: 'Neznámá pomůcka (tool)' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Chybí jméno' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Neplatný e-mail' });
    }

    // Pořadí v poli definuje výchozí jazyk při prvním otevření (první kód).
    const langs = sanitizeLanguages(languages);

    const token = generateShareToken();

    const recipient = await prisma.businessToolRecipient.create({
      data: {
        tool,
        name: String(name).trim().slice(0, 255),
        email: String(email).trim().toLowerCase().slice(0, 255),
        company: company ? String(company).trim().slice(0, 255) : null,
        note: note ? String(note).trim().slice(0, 2000) : null,
        share_token: token,
        languages: langs,
        created_by: req.user.id,
      },
    });

    const shareLink = buildPublicShareUrl('/share/tools/' + tool + '/' + token);
    const toolMeta = SUPPORTED_TOOLS[tool];

    // Tichá poznámka 'sent' do event logu (i když email selže, máme stopu)
    await logEvent(recipient.id, 'sent', { email, send_email: !!send_email }, req);

    let emailResult = { sent: false, skipped: 'not-requested' };
    if (send_email !== false) {
      const subject = toolMeta.title + ' — kalkulace návratnosti';
      const greet = recipient.company ? recipient.name + ' (' + recipient.company + ')' : recipient.name;
      const noteBlock = recipient.note ? '\n\n' + recipient.note : '';
      const body =
        'Dobrý den, ' + greet + ',\n\n' +
        'připravil jsem pro Vás interaktivní model "' + toolMeta.title + '". ' +
        'Po kliknutí níže můžete měnit vstupy (žlutá pole) — výpočty se přepočítají v reálném čase. ' +
        'Pokud si chcete uložit konkrétní variantu, použijte v nástroji tlačítko Uložit model.' +
        noteBlock +
        '\n\nS pozdravem,\n' + (req.user.display_name || req.user.username);

      // Pokud je k uživateli připojen Person.work_email, použij jeho UPN jako 'from'
      // (Microsoft Graph send-as). Fallback na SMTP_FROM.
      let fromUpn = null;
      try {
        const person = await prisma.person.findFirst({
          where: { user_id: req.user.id },
          select: { work_email: true },
        });
        if (person && person.work_email) fromUpn = person.work_email;
      } catch (e) { /* noop */ }

      emailResult = await sendMail({
        to: recipient.email,
        from: fromUpn || undefined,
        subject,
        body,
        link: shareLink,
        linkLabel: 'Otevřít ' + toolMeta.title,
        preheader: 'Interaktivní model návratnosti pro ' + (recipient.company || recipient.name),
      });
    }

    res.status(201).json({
      id: recipient.id,
      share_token: recipient.share_token,
      share_link: shareLink,
      email_result: emailResult,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/tools/recipients/:id/resend  — pošle stejný odkaz znovu
router.post('/recipients/:id/resend', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Neplatné ID' });

    const recipient = await prisma.businessToolRecipient.findUnique({ where: { id } });
    if (!recipient) return res.status(404).json({ error: 'Příjemce nenalezen' });

    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const shareLink = buildPublicShareUrl('/share/tools/' + recipient.tool + '/' + recipient.share_token);
    const toolMeta = SUPPORTED_TOOLS[recipient.tool] || { title: recipient.tool };

    const body =
      'Dobrý den, ' + recipient.name + ',\n\n' +
      'posílám znovu odkaz na kalkulaci "' + toolMeta.title + '". ' +
      'Odkaz je stále platný a vaše uložené varianty jsou v něm dostupné.' +
      '\n\nS pozdravem,\n' + (req.user.display_name || req.user.username);

    let fromUpn = null;
    try {
      const person = await prisma.person.findFirst({
        where: { user_id: req.user.id },
        select: { work_email: true },
      });
      if (person && person.work_email) fromUpn = person.work_email;
    } catch (e) { /* noop */ }

    const emailResult = await sendMail({
      to: recipient.email,
      from: fromUpn || undefined,
      subject: toolMeta.title + ' — připomenutí',
      body,
      link: shareLink,
      linkLabel: 'Otevřít ' + toolMeta.title,
    });

    await logEvent(recipient.id, 'resent', { email_result: emailResult }, req);

    res.json({ ok: true, share_link: shareLink, email_result: emailResult });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/tools/recipients/:id  — úprava jména / poznámky
router.patch('/recipients/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Neplatné ID' });

    const data = {};
    if (typeof req.body.name === 'string') data.name = req.body.name.trim().slice(0, 255);
    if (typeof req.body.company === 'string') data.company = req.body.company.trim().slice(0, 255) || null;
    if (typeof req.body.note === 'string') data.note = req.body.note.trim().slice(0, 2000) || null;
    if (typeof req.body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)) {
      data.email = req.body.email.trim().toLowerCase().slice(0, 255);
    }
    if (Array.isArray(req.body.languages)) {
      data.languages = sanitizeLanguages(req.body.languages);
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nic k aktualizaci' });

    const updated = await prisma.businessToolRecipient.update({ where: { id }, data });
    res.json({ id: updated.id });
  } catch (e) {
    next(e);
  }
});

// GET /api/tools/recipients/:id  — detail + posledních 50 eventů + uložené modely
router.get('/recipients/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Neplatné ID' });

    const recipient = await prisma.businessToolRecipient.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, display_name: true, username: true } },
        models: { orderBy: { created_at: 'desc' }, take: 50 },
        events: { orderBy: { created_at: 'desc' }, take: 50 },
      },
    });
    if (!recipient) return res.status(404).json({ error: 'Příjemce nenalezen' });

    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const shareLink = buildPublicShareUrl('/share/tools/' + recipient.tool + '/' + recipient.share_token);

    // Detekce, jestli je cache stale (zákazník mezitím něco změnil)
    let ai_summary_stale = false;
    if (recipient.ai_summary_generated_at) {
      const lastActivity = recipient.events.length ? new Date(recipient.events[0].created_at) : null;
      if (lastActivity && lastActivity > recipient.ai_summary_generated_at) ai_summary_stale = true;
    }

    res.json({
      ...recipient,
      tool_meta: SUPPORTED_TOOLS[recipient.tool] || null,
      share_link: shareLink,
      ai_summary_stale,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/tools/recipients/:id/ai-summary  — vygeneruje (nebo regeneruje) AI shrnutí
router.post('/recipients/:id/ai-summary', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Neplatné ID' });

    const recipient = await prisma.businessToolRecipient.findUnique({
      where: { id },
      include: {
        models: { orderBy: { created_at: 'desc' }, take: 30 },
        events: { orderBy: { created_at: 'desc' }, take: 200 },
      },
    });
    if (!recipient) return res.status(404).json({ error: 'Příjemce nenalezen' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'AI shrnutí není k dispozici (ANTHROPIC_API_KEY není nakonfigurovaný).' });
    }

    const tool_meta = SUPPORTED_TOOLS[recipient.tool] || { title: recipient.tool };

    let result;
    try {
      result = await generateBusinessToolAiSummary(
        { ...recipient, tool_meta },
        recipient.events,
        recipient.models
      );
    } catch (e) {
      console.error('[BusinessTools] AI summary call failed:', e.message);
      return res.status(502).json({ error: 'Volání AI selhalo: ' + e.message });
    }

    const now = new Date();
    await prisma.businessToolRecipient.update({
      where: { id },
      data: {
        ai_summary_text: result.text,
        ai_summary_generated_at: now,
        ai_summary_model: result.model,
      },
    });

    res.json({
      text: result.text,
      model: result.model,
      generated_at: now,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
    });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/tools/recipients/:id
router.delete('/recipients/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Neplatné ID' });
    await prisma.businessToolRecipient.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Příjemce nenalezen' });
    next(e);
  }
});

module.exports = router;
