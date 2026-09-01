// =============================================================================
// HolyOS — Voice agent: Twilio webhooky (REST)
// =============================================================================
// Mount v app.js:  app.use('/api/voice', require('./routes/voice-agent.routes'));
// Endpointy jsou volané Twiliem (ne prohlížečem), proto bez requireAuth.
// Bezpečnost: v produkci ověřovat X-Twilio-Signature (twilio.validateRequest)
// — doplní se, až budou TWILIO_* creds (Fáze 0).

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

let settings = null;
try {
  settings = require('../services/settings');
} catch (_) {
  settings = null;
}

const WS_URL = process.env.VOICE_RELAY_WS_URL || 'wss://app.holyos.cz/api/voice/relay';
const TTS_PROVIDER = process.env.VOICE_TTS_PROVIDER || 'ElevenLabs';
const STT_PROVIDER = process.env.VOICE_STT_PROVIDER || 'Deepgram';
const RELAY_SECRET = process.env.VOICE_RELAY_SECRET || '';

// WS url + sdílené tajemství (+ volitelně další query, např. target pro outbound)
function relayUrl(extra) {
  let url = WS_URL;
  const params = [];
  if (RELAY_SECRET) params.push('key=' + encodeURIComponent(RELAY_SECRET));
  if (extra) params.push(extra);
  if (params.length) url += (url.includes('?') ? '&' : '?') + params.join('&');
  return url;
}

function twimlConnect(wsUrl) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Response>\n' +
    '  <Connect>\n' +
    `    <ConversationRelay url="${wsUrl}" language="cs-CZ" ` +
    `ttsProvider="${TTS_PROVIDER}" transcriptionProvider="${STT_PROVIDER}" />\n` +
    '  </Connect>\n' +
    '</Response>'
  );
}

// Twilio posílá application/x-www-form-urlencoded
const form = express.urlencoded({ extended: false });

// POST /api/voice/incoming — první webhook příchozího hovoru.
// Vrací TwiML, které předá hovor ConversationRelay (řeč↔text) a napojí ho na náš WS.
router.post('/incoming', form, (req, res) => {
  res.type('text/xml').send(twimlConnect(relayUrl()));
});

// POST /api/voice/outgoing — TwiML pro odchozí hovor (kampaň). Twilio ho volá
// při spojení; ?target=<id> předáme do WS, aby AI vedla rozhovor podle scénáře.
router.post('/outgoing', form, (req, res) => {
  const target = req.query.target || (req.body && req.body.target) || '';
  const extra = target ? 'target=' + encodeURIComponent(target) : '';
  res.type('text/xml').send(twimlConnect(relayUrl(extra)));
});

// POST /api/voice/status — status callback po skončení hovoru.
// Shrnutí + uložení + push řeší WS close v services/voice/relay-ws.js
// (tam máme kompletní přepis). Tady jen potvrdíme příjem.
router.post('/status', form, (req, res) => {
  res.sendStatus(204);
});

// GET /api/voice/calls — seznam odbavených hovorů (pro obrazovku Hovory ve Velíně).
// Chráněno HolyOS JWT (requireAuth). Volá se s Bearer/cookie tokenem.
router.get('/calls', requireAuth, async (req, res, next) => {
  try {
    if (!prisma.voiceCall) return res.json([]);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const calls = await prisma.voiceCall.findMany({
      orderBy: { started_at: 'desc' },
      take: limit,
      select: {
        id: true,
        direction: true,
        agent_kind: true,
        from_number: true,
        to_number: true,
        started_at: true,
        ended_at: true,
        duration_sec: true,
        caller_name: true,
        caller_intent: true,
        summary: true,
        transcript: true,
        campaign_target_id: true,
      },
    });
    res.json(calls);
  } catch (err) {
    next(err);
  }
});

// ─── Nastavení příchozí recepční ───────────────────────────────────────────
router.get('/config', requireAuth, async (req, res, next) => {
  try {
    const get = settings ? settings.getSetting : null;
    const inbound_prompt = get ? (await get('voice.inbound_prompt')) || '' : '';
    let notify_person_ids = get ? await get('voice.notify_person_ids') : [];
    if (typeof notify_person_ids === 'string') {
      try {
        notify_person_ids = JSON.parse(notify_person_ids);
      } catch (_) {
        notify_person_ids = notify_person_ids.split(',').map((s) => parseInt(s, 10)).filter(Boolean);
      }
    }
    const default_from = get ? (await get('voice.default_from')) || '' : '';
    res.json({ inbound_prompt, notify_person_ids: notify_person_ids || [], default_from });
  } catch (err) {
    next(err);
  }
});

router.put('/config', requireAuth, express.json(), async (req, res, next) => {
  try {
    if (!settings) return res.status(500).json({ error: 'settings nedostupné' });
    const { inbound_prompt, notify_person_ids, default_from } = req.body || {};
    const uid = req.user && req.user.id;
    if (inbound_prompt !== undefined)
      await settings.setSetting('voice.inbound_prompt', String(inbound_prompt || ''), { type: 'string', userId: uid });
    if (notify_person_ids !== undefined) {
      const arr = (Array.isArray(notify_person_ids) ? notify_person_ids : [])
        .map((x) => parseInt(x, 10))
        .filter(Boolean);
      await settings.setSetting('voice.notify_person_ids', arr, { type: 'json', userId: uid });
    }
    if (default_from !== undefined)
      await settings.setSetting('voice.default_from', String(default_from || ''), { type: 'string', userId: uid });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Odchozí kampaně ────────────────────────────────────────────────────────
router.get('/campaigns', requireAuth, async (req, res, next) => {
  try {
    if (!prisma.voiceCampaign) return res.json([]);
    const camps = await prisma.voiceCampaign.findMany({ orderBy: { created_at: 'desc' }, take: 100 });
    const withCounts = await Promise.all(
      camps.map(async (c) => {
        const grp = await prisma.voiceCampaignTarget.groupBy({
          by: ['status'],
          where: { campaign_id: c.id },
          _count: { _all: true },
        });
        const counts = {};
        grp.forEach((g) => (counts[g.status] = g._count._all));
        return { ...c, counts };
      })
    );
    res.json(withCounts);
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns', requireAuth, express.json(), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Chybí název kampaně' });
    const camp = await prisma.voiceCampaign.create({
      data: {
        name: String(b.name).trim(),
        script: b.script ? String(b.script) : null,
        from_number: b.from_number ? String(b.from_number).replace(/[\s\-()]/g, '') : null,
        max_attempts: parseInt(b.max_attempts, 10) || 1,
        call_from: b.call_from || null,
        call_to: b.call_to || null,
        created_by_user_id: req.user && req.user.id,
        status: 'draft',
      },
    });
    res.status(201).json(camp);
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    const camp = await prisma.voiceCampaign.findUnique({
      where: { id: req.params.id },
      include: { targets: { orderBy: { created_at: 'asc' } } },
    });
    if (!camp) return res.status(404).json({ error: 'Kampaň nenalezena' });
    res.json(camp);
  } catch (err) {
    next(err);
  }
});

// Přidání cílů: body { targets: [{name, phone}] } NEBO { raw: "Jméno; +420...\n..." }
router.post('/campaigns/:id/targets', requireAuth, express.json(), async (req, res, next) => {
  try {
    const camp = await prisma.voiceCampaign.findUnique({ where: { id: req.params.id } });
    if (!camp) return res.status(404).json({ error: 'Kampaň nenalezena' });

    let items = Array.isArray(req.body && req.body.targets) ? req.body.targets : [];
    if ((!items || !items.length) && req.body && req.body.raw) {
      items = String(req.body.raw)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/[;,\t]/).map((s) => s.trim());
          // formát: "Jméno; +420..." nebo jen "+420..."
          if (parts.length >= 2) return { name: parts[0], phone: parts[1] };
          return { name: null, phone: parts[0] };
        });
    }

    const clean = items
      .map((i) => ({ name: i.name ? String(i.name).slice(0, 255) : null, phone: String(i.phone || '').replace(/[\s\-()]/g, '') }))
      .filter((i) => /^\+?\d{6,}$/.test(i.phone));

    if (!clean.length) return res.status(400).json({ error: 'Žádná platná telefonní čísla' });

    await prisma.voiceCampaignTarget.createMany({
      data: clean.map((i) => ({ campaign_id: camp.id, name: i.name, phone: i.phone, status: 'pending' })),
    });
    res.status(201).json({ added: clean.length });
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns/:id/start', requireAuth, async (req, res, next) => {
  try {
    const camp = await prisma.voiceCampaign.update({ where: { id: req.params.id }, data: { status: 'running' } });
    res.json(camp);
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns/:id/pause', requireAuth, async (req, res, next) => {
  try {
    const camp = await prisma.voiceCampaign.update({ where: { id: req.params.id }, data: { status: 'paused' } });
    res.json(camp);
  } catch (err) {
    next(err);
  }
});

router.delete('/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.voiceCampaign.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
