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
// Veřejná adresa serveru (pro action URL TwiML). Z WS_URL odvodíme https host.
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL
  || (WS_URL.replace(/^wss?:\/\//, 'https://').replace(/\/api\/voice\/relay.*$/, ''))
  || 'https://app.holyos.cz';
const VOICE_DEFAULT_FROM = process.env.VOICE_DEFAULT_FROM || '';

// WS url + sdílené tajemství (+ volitelně další query, např. target pro outbound)
function relayUrl(extra) {
  let url = WS_URL;
  const params = [];
  if (RELAY_SECRET) params.push('key=' + encodeURIComponent(RELAY_SECRET));
  if (extra) params.push(extra);
  if (params.length) url += (url.includes('?') ? '&' : '?') + params.join('&');
  return url;
}

// XML-escape hodnoty do atributu (hlavně & → &amp;, jinak „Document parse failure").
function xmlAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// TwiML pro spojení hovoru s ConversationRelay. actionUrl = kam Twilio zavolá,
// až AI relace skončí (buď zákazník zavěsí, nebo AI pošle {type:'end'} kvůli
// přepojení na živého člověka). Bez action by hovor po konci relace jen spadl.
function twimlConnect(wsUrl, actionUrl, welcomeGreeting) {
  const u = xmlAttr(wsUrl);
  const act = actionUrl ? ` action="${xmlAttr(actionUrl)}" method="POST"` : '';
  // Úvodní věta jako welcomeGreeting → Twilio ji řekne stejným hlasem (ElevenLabs)
  // a s welcomeGreetingInterruptible="none" ji NELZE přerušit (dořekne se celá,
  // i když do toho volaný mluví). Teprve pak běží běžná (přerušitelná) konverzace.
  const wg = welcomeGreeting && String(welcomeGreeting).trim()
    ? ` welcomeGreeting="${xmlAttr(String(welcomeGreeting).trim())}" welcomeGreetingInterruptible="none"`
    : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Response>\n' +
    `  <Connect${act}>\n` +
    `    <ConversationRelay url="${u}" language="cs-CZ" ` +
    `ttsProvider="${TTS_PROVIDER}" transcriptionProvider="${STT_PROVIDER}"${wg} />\n` +
    '  </Connect>\n' +
    '</Response>'
  );
}

// E.164 normalizace (české 9místné → +420…, 00… → +…).
function e164(num) {
  num = (num || '').replace(/[\s\-()]/g, '');
  if (!num) return '';
  if (num.startsWith('+')) return num;
  if (num.startsWith('00')) return '+' + num.slice(2);
  if (/^\d{9}$/.test(num)) return '+420' + num;
  return num;
}
function encList(arr) {
  return Buffer.from(JSON.stringify(arr || []), 'utf8').toString('base64');
}
function decList(s) {
  try { return JSON.parse(Buffer.from(String(s || ''), 'base64').toString('utf8')) || []; }
  catch (_) { return []; }
}

// Omluvná zpráva + zavěšení, když se nikoho nepodařilo zastihnout.
function twimlApology() {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Response>\n' +
    '  <Say language="cs-CZ">Omlouvám se, teď se nedaří nikoho zastihnout. Ozveme se vám co nejdříve. Na shledanou.</Say>\n' +
    '  <Hangup/>\n' +
    '</Response>'
  );
}

// TwiML, které postupně vytáčí čísla ze seznamu (fronta už obsahuje i opakování
// koleček). Po skončení každého <Dial> Twilio zavolá action s tailem — když se
// nikdo nezvedl, zkusí se další; když zvedl, hovor běží a po zavěšení dostane
// action completed → zavěsíme. ctx = {mode, target} se veze dál kvůli notifikaci
// do Velína, když se nikoho nepodaří zastihnout.
function twimlDial(numbers, timeout, ctx) {
  const list = (numbers || []).map(e164).filter(Boolean);
  const t = Math.max(8, Math.min(60, parseInt(timeout, 10) || 20));
  if (!list.length) return twimlApology();
  const first = xmlAttr(list[0]);
  const tail = encList(list.slice(1));
  const callerId = VOICE_DEFAULT_FROM ? ` callerId="${xmlAttr(e164(VOICE_DEFAULT_FROM))}"` : '';
  const c = ctx || {};
  const q = [`q=${tail}`, `t=${t}`];
  if (c.mode) q.push('m=' + encodeURIComponent(c.mode));
  if (c.target) q.push('tg=' + encodeURIComponent(c.target));
  const action = xmlAttr(`${PUBLIC_BASE}/api/voice/transfer?${q.join('&')}`);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Response>\n' +
    '  <Say language="cs-CZ">Přepojuji vás na kolegu, chvilku prosím vydržte.</Say>\n' +
    `  <Dial timeout="${t}"${callerId} action="${action}" method="POST">\n` +
    `    <Number>${first}</Number>\n` +
    '  </Dial>\n' +
    '</Response>'
  );
}

// Rozbalí uložený seznam kontaktů (JSON pořadí obchodníků/čísel, nebo legacy CSV)
// na telefonní čísla v pořadí. Obchodníci se přeloží na Person.phone.
async function fallbackNumbersFromStored(stored) {
  const s = String(stored || '').trim();
  if (!s) return [];
  let entries = null;
  try { const p = JSON.parse(s); if (Array.isArray(p)) entries = p; } catch (_) { entries = null; }
  if (!entries) {
    // legacy: čísla oddělená čárkou / středníkem / novým řádkem
    return s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  }
  const out = [];
  for (const e of entries) {
    if (e == null) continue;
    if (typeof e === 'string') { out.push(e); continue; }
    if (e.v || e.number) { out.push(String(e.v || e.number)); continue; }
    const pid = parseInt(e.id || e.person_id, 10);
    if (pid) {
      try {
        const p = await prisma.person.findUnique({ where: { id: pid }, select: { phone: true, active: true } });
        if (p && p.active !== false && p.phone) out.push(p.phone);
      } catch (_) { /* přeskoč */ }
    }
  }
  return out;
}

// Sestaví plán přepojení: povoleno? + pořadí čísel + doba vyzvánění.
// Odchozí (kampaň): nastavení se bere Z KAMPANĚ (každá může mít jiné). Primární
// cíl je mobil obchodníka přiřazeného k leadu, pak záložní čísla kampaně.
// Příchozí (recepční): globální nastavení (voice.transfer_*).
async function resolveTransferPlan(mode, targetId) {
  const get = settings ? settings.getSetting : null;
  const base = [];              // pořadí kontaktů v jednom kolečku
  let enabled = true;
  let timeout = 20;
  let rounds = 2;

  if (mode === 'outbound' && targetId && prisma.voiceCampaignTarget) {
    try {
      const t = await prisma.voiceCampaignTarget.findUnique({
        where: { id: targetId },
        include: { campaign: true },
      });
      const camp = t && t.campaign;
      enabled = camp ? camp.transfer_enabled !== false : true;
      timeout = (camp && camp.transfer_ring_timeout) || 20;
      rounds = (camp && camp.transfer_rounds) || 2;
      // 1) mobil obchodníka přiřazeného k leadu (automaticky)
      if (t && t.phone) {
        const owner = await ownerPhoneForPhone(t.phone);
        if (owner) base.push(owner);
      }
      // 2) nakonfigurované záložní kontakty (obchodníci / čísla) v pořadí
      const fb = await fallbackNumbersFromStored(camp && camp.transfer_fallback_numbers);
      fb.forEach((f) => base.push(f));
    } catch (e) { console.warn('[voice] resolve kampaň přepojení selhal:', e.message); }
  } else {
    // inbound — globální nastavení
    const enRaw = get ? await get('voice.transfer_enabled') : true;
    enabled = enRaw === undefined || enRaw === null ? true : (enRaw === true || enRaw === 'true' || enRaw === 1 || enRaw === '1');
    timeout = get ? parseInt(await get('voice.transfer_ring_timeout'), 10) || 20 : 20;
    rounds = get ? parseInt(await get('voice.transfer_rounds'), 10) || 2 : 2;
    const inboundNum = get ? (await get('voice.transfer_inbound_number')) || '' : '';
    if (inboundNum) base.push(inboundNum);
    const fb = await fallbackNumbersFromStored(get ? (await get('voice.transfer_fallback_numbers')) || '' : '');
    fb.forEach((f) => base.push(f));
  }

  // deduplikace jednoho kolečka v E.164
  const seen = new Set();
  const oneRound = base.map(e164).filter((n) => n && !seen.has(n) && seen.add(n));
  rounds = Math.max(1, Math.min(5, parseInt(rounds, 10) || 2));
  // fronta = seznam zopakovaný „rounds"-krát dokola
  const queue = [];
  for (let i = 0; i < rounds; i++) queue.push(...oneRound);
  return {
    enabled,
    numbers: queue,
    perRound: oneRound.length,
    rounds,
    timeout: Math.max(8, Math.min(60, parseInt(timeout, 10) || 20)),
  };
}

// Kontext pro notifikaci do Velína, když se nikoho nepodaří zastihnout.
async function transferContext(mode, targetId) {
  const ctx = { who: null, phone: null, leadId: null, campaignName: null };
  try {
    if (mode === 'outbound' && targetId && prisma.voiceCampaignTarget) {
      const t = await prisma.voiceCampaignTarget.findUnique({
        where: { id: targetId },
        include: { campaign: true },
      });
      if (t) {
        ctx.who = t.name || t.phone || null;
        ctx.phone = t.phone || null;
        ctx.campaignName = t.campaign && t.campaign.name;
        // dohledej lead_id podle telefonu (kvůli prokliku na kontakt)
        const digits = String(t.phone || '').replace(/\D/g, '');
        if (digits.length >= 6 && prisma.compounderLead) {
          const tail = digits.slice(-9);
          const leads = await prisma.compounderLead.findMany({
            where: { phone: { contains: tail } }, select: { id: true, phone: true, name: true }, take: 5,
          });
          const lead = leads.find((l) => String(l.phone || '').replace(/\D/g, '').slice(-9) === tail);
          if (lead) { ctx.leadId = lead.id; if (!ctx.who) ctx.who = lead.name; }
        }
      }
    }
  } catch (e) { console.warn('[voice] transferContext:', e.message); }
  return ctx;
}

// Pošle do Velína, že zákazník nebyl přepojen na obchodníka.
async function notifyTransferFailed(mode, targetId, attempts) {
  try {
    const notify = require('../services/compounder/notify');
    if (!notify.notifyTransferFailed) return;
    const c = await transferContext(mode, targetId);
    await notify.notifyTransferFailed(prisma, { who: c.who, phone: c.phone, leadId: c.leadId, campaignName: c.campaignName, attempts });
  } catch (e) { console.warn('[voice] notifyTransferFailed:', e.message); }
}

// Najde mobil obchodníka přiřazeného k leadu podle telefonu (posledních 9 číslic).
async function ownerPhoneForPhone(phone) {
  try {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 6) return '';
    const tail = digits.slice(-9);
    const leads = await prisma.compounderLead.findMany({
      where: { phone: { contains: tail } },
      select: { phone: true, owner_person_id: true },
      take: 5,
      orderBy: { updated_at: 'desc' },
    });
    const lead = leads.find((l) => String(l.phone || '').replace(/\D/g, '').slice(-9) === tail && l.owner_person_id);
    if (!lead) return '';
    const p = await prisma.person.findUnique({ where: { id: lead.owner_person_id }, select: { phone: true, active: true } });
    if (p && p.active !== false && p.phone && p.phone.replace(/\D/g, '').length >= 6) return p.phone;
    return '';
  } catch (e) { console.warn('[voice] ownerPhoneForPhone:', e.message); return ''; }
}

// Twilio posílá application/x-www-form-urlencoded
const form = express.urlencoded({ extended: false });

// POST /api/voice/incoming — první webhook příchozího hovoru.
// Vrací TwiML, které předá hovor ConversationRelay (řeč↔text) a napojí ho na náš WS.
router.post('/incoming', form, async (req, res) => {
  const action = `${PUBLIC_BASE}/api/voice/relay-end?mode=inbound`;
  // Zapni nahrávání příchozího hovoru (odchozí se nahrávají už při vytvoření).
  // <Connect>/ConversationRelay nemá record atribut → spustíme nahrávku přes REST.
  const sid = req.body && req.body.CallSid;
  if (sid) {
    try {
      const c = require('../services/voice/outbound').client();
      if (c) {
        await c.calls(sid).recordings.create({
          recordingStatusCallback: `${PUBLIC_BASE}/api/voice/recording`,
          recordingStatusCallbackEvent: ['completed'],
        });
      }
    } catch (e) { console.warn('[voice] start nahrávky (příchozí):', e.message); }
  }
  let greeting = '';
  try {
    const get = settings ? settings.getSetting : null;
    greeting = (get ? await get('voice.inbound_greeting') : '') || '';
  } catch (_) { greeting = ''; }
  if (!String(greeting).trim()) {
    greeting = 'Dobrý den, dovolali jste se na asistenta. Hovor obsluhuje AI a je nahráván. Jak vám můžu pomoct?';
  }
  // wg=1 → WS ví, že úvod řekne Twilio (welcomeGreeting), takže ho sám neposílá.
  res.type('text/xml').send(twimlConnect(relayUrl('wg=1'), action, greeting));
});

// POST /api/voice/outgoing — TwiML pro odchozí hovor (kampaň). Twilio ho volá
// při spojení; ?target=<id> předáme do WS, aby AI vedla rozhovor podle scénáře.
router.post('/outgoing', form, async (req, res) => {
  const target = req.query.target || (req.body && req.body.target) || '';
  const answeredBy = ((req.body && req.body.AnsweredBy) || '').toLowerCase();
  const isMachine = answeredBy.startsWith('machine') || answeredBy === 'fax';

  // Záznamník / hlasová schránka → ber jako nedovolané: zavěs, no_answer, SMS
  if (isMachine && target && prisma.voiceCampaignTarget) {
    try {
      const t = await prisma.voiceCampaignTarget.findUnique({ where: { id: target } });
      if (t && t.status !== 'done') {
        await prisma.voiceCampaignTarget.update({
          where: { id: t.id },
          data: { status: 'no_answer', result_summary: 'Hlasová schránka / záznamník' },
        });
        try {
          require('../services/voice/sms').maybeSendNoAnswerSms(t);
        } catch (e) {
          console.warn('[voice] SMS (schránka):', e.message);
        }
      }
    } catch (e) {
      console.warn('[voice] AMD handling:', e.message);
    }
    return res
      .type('text/xml')
      .send('<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>');
  }

  // Úvodní věta kampaně jako neinteruptovatelný welcomeGreeting (dořekne se celá).
  let greeting = '';
  if (target && prisma.voiceCampaign && prisma.voiceCampaignTarget) {
    try {
      const t = await prisma.voiceCampaignTarget.findUnique({ where: { id: target }, include: { campaign: true } });
      greeting = (t && t.campaign && t.campaign.greeting) || '';
    } catch (_) { greeting = ''; }
  }
  const parts = [];
  if (target) parts.push('target=' + encodeURIComponent(target));
  if (String(greeting).trim()) parts.push('wg=1');
  const extra = parts.join('&');
  const action = `${PUBLIC_BASE}/api/voice/relay-end?mode=outbound` + (target ? '&target=' + encodeURIComponent(target) : '');
  res.type('text/xml').send(twimlConnect(relayUrl(extra), action, greeting));
});

// POST /api/voice/relay-end — Twilio sem zavolá, když AI relace (ConversationRelay)
// skončí. Když AI poslala {type:'end', handoffData:{transfer:true}} (zákazník chce
// živého člověka), přepojíme hovor přes <Dial>. Jinak hovor zavěsíme.
router.post('/relay-end', form, async (req, res) => {
  try {
    const mode = (req.query.mode || 'inbound') === 'outbound' ? 'outbound' : 'inbound';
    const target = req.query.target || '';
    let handoff = {};
    try { handoff = JSON.parse((req.body && req.body.HandoffData) || '{}'); } catch (_) { handoff = {}; }
    const wantsTransfer = !!(handoff && handoff.transfer);
    console.log('[voice] relay-end: mode=' + mode + ' target=' + target
      + ' sessionStatus=' + ((req.body && req.body.SessionStatus) || '-')
      + ' handoff=' + JSON.stringify((req.body && req.body.HandoffData) || null)
      + ' wantsTransfer=' + wantsTransfer);
    if (!wantsTransfer) {
      return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>');
    }
    const plan = await resolveTransferPlan(mode, target);
    console.log('[voice] relay-end plán: enabled=' + plan.enabled + ' čísla=' + plan.numbers.length
      + ' [' + plan.numbers.map((n) => String(n).replace(/\d(?=\d{3})/g, '•')).join(', ') + ']'
      + ' timeout=' + plan.timeout + ' kolecek=' + plan.rounds);
    if (!plan.enabled) {
      return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>');
    }
    if (!plan.numbers.length) {
      // Přepojení zapnuto, ale není koho volat → řekni to zákazníkovi + info do Velína.
      console.warn('[voice] relay-end: přepojení chtěné, ale ŽÁDNÉ číslo (obchodník leadu bez telefonu a žádná záložní čísla u kampaně).');
      notifyTransferFailed(mode, target, 0);
      return res.type('text/xml').send(twimlApology());
    }
    return res.type('text/xml').send(twimlDial(plan.numbers, plan.timeout, { mode, target }));
  } catch (e) {
    console.warn('[voice] relay-end:', e.message);
    return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>');
  }
});

// POST /api/voice/transfer — sekvenční vytáčení dalších čísel v pořadí (?q=<base64 zbytek>).
// Twilio sem zavolá po každém <Dial>: když se dovolalo (completed), zavěsíme;
// jinak zkusíme další číslo ze zbytku; když už žádné není, omluvíme se a zavěsíme.
router.post('/transfer', form, (req, res) => {
  try {
    const status = ((req.body && req.body.DialCallStatus) || '').toLowerCase();
    if (status === 'completed' || status === 'answered') {
      return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>');
    }
    const rest = decList(req.query.q);
    const timeout = parseInt(req.query.t, 10) || 20;
    const mode = req.query.m || 'inbound';
    const target = req.query.tg || '';
    if (!rest.length) {
      // Vyčerpána všechna čísla i kolečka a nikdo se nedovolal → info do Velína.
      notifyTransferFailed(mode, target, undefined);
      return res.type('text/xml').send(twimlApology());
    }
    return res.type('text/xml').send(twimlDial(rest, timeout, { mode, target }));
  } catch (e) {
    console.warn('[voice] transfer:', e.message);
    return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>');
  }
});

// Vytvoří „stub" záznam hovoru, když pro daný CallSid ještě žádný neexistuje
// (dovolané konverzace ukládá kompletně WS; tohle pokrývá nedovolané atd.).
async function ensureVoiceCallStub(sid, { from, to, durationSec, summary, campaignTargetId }) {
  if (!sid || !prisma.voiceCall) return;
  const existing = await prisma.voiceCall.findFirst({ where: { twilio_call_sid: sid }, select: { id: true } });
  if (existing) return; // WS už uložil kompletní záznam
  const now = new Date();
  await prisma.voiceCall.create({
    data: {
      direction: 'outbound',
      agent_kind: 'campaign',
      from_number: from || '',
      to_number: to || '',
      twilio_call_sid: sid,
      started_at: now,
      ended_at: now,
      duration_sec: durationSec || 0,
      transcript: [],
      summary: summary || null,
      caller_name: null,
      caller_intent: null,
      campaign_target_id: campaignTargetId || null,
    },
  });
}

// POST /api/voice/status — status callback po skončení hovoru.
// Shrnutí + uložení + push řeší WS close v services/voice/relay-ws.js
// (tam máme kompletní přepis). Tady jen potvrdíme příjem.
// POST /api/voice/status — průběžné stavy hovoru z Twilia (ringing/in-progress/…).
// Aktualizuje cíl kampaně v reálném čase (živý stav v UI). Nikdy nepřepíše 'done'.
router.post('/status', form, async (req, res) => {
  try {
    const b = req.body || {};
    const sid = b.CallSid;
    const cs = (b.CallStatus || '').toLowerCase();
    if (sid && cs && prisma.voiceCampaignTarget) {
      const t = await prisma.voiceCampaignTarget.findFirst({ where: { last_call_sid: sid } });
      if (t && t.status !== 'done') {
        let next = null;
        if (cs === 'ringing') next = 'ringing';
        else if (cs === 'in-progress') next = 'in_progress';
        else if (cs === 'busy' || cs === 'no-answer') next = 'no_answer';
        else if (cs === 'failed' || cs === 'canceled') next = 'failed';
        else if (cs === 'completed') {
          // Hovor skončil. Přijatý (prošel in_progress) → WS to zpravidla už označil
          // jako done; pokud ne, done. Jinak (jen vyzvánělo) → bez odpovědi.
          next = t.status === 'in_progress' ? 'done' : t.status === 'ringing' || t.status === 'calling' ? 'no_answer' : null;
        }
        if (next && next !== t.status) {
          await prisma.voiceCampaignTarget.update({ where: { id: t.id }, data: { status: next } });
          if (next === 'no_answer' || next === 'failed') {
            try {
              require('../services/voice/sms').maybeSendNoAnswerSms(t);
            } catch (e) {
              console.warn('[voice] SMS trigger:', e.message);
            }
          }
        }
      }
      // Zaznamenej KAŽDÝ pokus o hovor do Záznamů (i nedovolané/obsazené/záznamník),
      // ať je log kompletní. Pro dovolané konverzace vytvoří kompletní záznam WS —
      // tady jen doplníme stub, když ještě žádný záznam pro tento hovor není.
      const terminal = ['completed', 'no-answer', 'busy', 'failed', 'canceled'];
      if (terminal.indexOf(cs) !== -1) {
        const OUTCOME = { 'no-answer': 'Bez odpovědi', busy: 'Obsazeno', failed: 'Volání selhalo', canceled: 'Zrušeno' };
        await ensureVoiceCallStub(sid, {
          from: b.From, to: b.To,
          durationSec: parseInt(b.CallDuration, 10) || 0,
          summary: OUTCOME[cs] || null,
          campaignTargetId: (typeof t !== 'undefined' && t) ? t.id : null,
        }).catch((e) => console.warn('[voice] stub záznamu:', e.message));
      }
    }
  } catch (e) {
    console.warn('[voice] status callback:', e.message);
  }
  res.sendStatus(204);
});

// POST /api/voice/amd — asynchronní výsledek detekce záznamníku. Přijde na pozadí
// pár vteřin po zvednutí (TwiML/AI už mezitím běží). Když to zvedl záznamník,
// hovor ukončíme (ať AI nemluví do schránky), cíl označíme jako nedovolané + SMS.
router.post('/amd', form, async (req, res) => {
  try {
    const b = req.body || {};
    const sid = b.CallSid;
    const answeredBy = (b.AnsweredBy || '').toLowerCase();
    const isMachine = answeredBy.startsWith('machine') || answeredBy === 'fax';
    if (isMachine && sid) {
      // 1) označ cíl (nejdřív DB, ať to WS close nepřepíše na 'done')
      try {
        if (prisma.voiceCampaignTarget) {
          const t = await prisma.voiceCampaignTarget.findFirst({ where: { last_call_sid: sid } });
          if (t && t.status !== 'done') {
            await prisma.voiceCampaignTarget.update({
              where: { id: t.id },
              data: { status: 'no_answer', result_summary: 'Hlasová schránka / záznamník' },
            });
            try { require('../services/voice/sms').maybeSendNoAnswerSms(t); } catch (e) { console.warn('[voice] amd SMS:', e.message); }
          }
        }
      } catch (e) { console.warn('[voice] amd target:', e.message); }
      // 2) ukonči hovor přes Twilio REST
      try {
        const { client } = require('../services/voice/outbound');
        const c = client && client();
        if (c) await c.calls(sid).update({ status: 'completed' });
      } catch (e) { console.warn('[voice] amd hangup:', e.message); }
    }
  } catch (e) { console.warn('[voice] amd:', e.message); }
  res.sendStatus(204);
});

// POST /api/voice/recording — Twilio pošle URL nahrávky po skončení hovoru.
router.post('/recording', form, async (req, res) => {
  try {
    const b = req.body || {};
    const sid = b.CallSid;
    const url = b.RecordingUrl;
    if (sid && url && prisma.voiceCall) {
      const upd = await prisma.voiceCall.updateMany({ where: { twilio_call_sid: sid }, data: { audio_url: url } });
      // RACE: nahrávka může dorazit DŘÍV, než WS uloží záznam hovoru (u dovolaných).
      // Když ještě žádný záznam není, založíme ho s URL, ať se nahrávka neztratí.
      // WS ho pak jen doplní (upsert podle sid).
      if (!upd.count) {
        try {
          await prisma.voiceCall.create({
            data: {
              direction: 'outbound', agent_kind: 'campaign',
              from_number: b.From || '', to_number: b.To || '',
              twilio_call_sid: sid, started_at: new Date(), ended_at: new Date(),
              duration_sec: parseInt(b.RecordingDuration, 10) || 0,
              transcript: [], audio_url: url,
            },
          });
        } catch (e) { console.warn('[voice] recording pre-create:', e.message); }
      }
      // Předstáhni nahrávku na disk, ať je hned připravená k přehrání (non-fatal).
      try {
        const call = await prisma.voiceCall.findFirst({ where: { twilio_call_sid: sid }, select: { id: true } });
        if (call) ensureLocalRecording(call.id, url).catch(() => {});
      } catch (_) { /* nevadí, stáhne se při prvním přehrání */ }
    }
  } catch (e) {
    console.warn('[voice] recording callback:', e.message);
  }
  res.sendStatus(204);
});

// Adresář pro lokální kopie nahrávek (perzistentní volume /app/data).
function recordingsDir() {
  const path = require('path');
  return path.join(__dirname, '..', 'data', 'voice-recordings');
}
// Stáhne nahrávku z Twilia jednou na disk (pokud tam ještě není) a vrátí lokální
// cestu. Servírování z lokálního souboru přes res.sendFile pak spolehlivě
// podporuje převíjení (Range) — proxy stream z Twilia přehrávač usekával.
// Zjistí skutečnou velikost nahrávky u Twilia (přes Range 0-0 → Content-Range total).
async function remoteRecordingSize(mediaUrl, auth) {
  try {
    const r = await fetch(mediaUrl, { headers: { Authorization: auth, Range: 'bytes=0-0' } });
    const cr = r.headers.get('content-range'); // "bytes 0-0/123456"
    if (cr) { const m = /\/(\d+)\s*$/.exec(cr); if (m) return parseInt(m[1], 10); }
    const cl = r.headers.get('content-length');
    if (r.status === 200 && cl) return parseInt(cl, 10);
    return 0;
  } catch (_) { return 0; }
}

async function ensureLocalRecording(callId, audioUrl) {
  const fs = require('fs');
  const path = require('path');
  const dir = recordingsDir();
  const file = path.join(dir, String(callId).replace(/[^a-zA-Z0-9._-]/g, '_') + '.mp3');
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  if (!SID || !TOKEN) throw new Error('Twilio není nakonfigurováno');
  const mediaUrl = audioUrl.endsWith('.mp3') ? audioUrl : audioUrl + '.mp3';
  const auth = 'Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64');

  const localSize = (fs.existsSync(file) ? fs.statSync(file).size : 0);
  // Ověř skutečnou velikost u Twilia — když je lokální kopie menší (uřízlá /
  // stažená dřív, než byla nahrávka hotová), stáhneme ji znovu celou.
  const remoteSize = await remoteRecordingSize(mediaUrl, auth);
  if (localSize > 0 && (remoteSize === 0 || localSize >= remoteSize)) return file;

  const r = await fetch(mediaUrl, { headers: { Authorization: auth } });
  if (!r.ok) {
    if (localSize > 0) return file; // radši starší kopie než nic
    throw new Error('Nahrávku nelze načíst (' + r.status + ')');
  }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.part';
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  console.log('[voice] nahrávka ' + callId + ' stažena: ' + buf.length + ' B (remote ' + remoteSize + ', lokálně bylo ' + localSize + ')');
  return file;
}

// GET /api/voice/recording/:callId — nahrávku stáhneme jednou na disk a servírujeme
// s RUČNÍ obsluhou HTTP Range (206) → plynulé přehrávání i převíjení. (res.sendFile
// za některými proxy/kompresí neposlal Content-Length/Range a přehrávač se sekal.)
router.get('/recording/:callId', requireAuth, async (req, res, next) => {
  try {
    if (!prisma.voiceCall) return res.status(404).send('Bez nahrávky');
    const call = await prisma.voiceCall.findUnique({
      where: { id: req.params.callId },
      select: { audio_url: true },
    });
    if (!call || !call.audio_url) return res.status(404).send('Bez nahrávky');
    const file = await ensureLocalRecording(req.params.callId, call.audio_url);
    const fs = require('fs');
    const size = fs.statSync(file).size;
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= size) end = size - 1;
      if (start > end || start >= size) {
        res.status(416).set('Content-Range', 'bytes */' + size).end();
        return;
      }
      res.status(206);
      res.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
      res.set('Content-Length', String(end - start + 1));
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.set('Content-Length', String(size));
      fs.createReadStream(file).pipe(res);
    }
  } catch (err) {
    console.warn('[voice] recording serve:', err.message);
    if (!res.headersSent) return res.status(502).send('Nahrávku nelze načíst');
  }
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
        audio_url: true,
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
    const inbound_greeting = get ? (await get('voice.inbound_greeting')) || '' : '';
    let notify_person_ids = get ? await get('voice.notify_person_ids') : [];
    if (typeof notify_person_ids === 'string') {
      try {
        notify_person_ids = JSON.parse(notify_person_ids);
      } catch (_) {
        notify_person_ids = notify_person_ids.split(',').map((s) => parseInt(s, 10)).filter(Boolean);
      }
    }
    const default_from = get ? (await get('voice.default_from')) || '' : '';
    const smsRaw = get ? await get('voice.sms_on_no_answer') : false;
    const sms_on_no_answer = smsRaw === true || smsRaw === 'true' || smsRaw === 1 || smsRaw === '1';
    const sms_text = get ? (await get('voice.sms_text')) || '' : '';
    // Brána SMS (provider + kanál/odesílatel), včetně readiness klíčů (bez tajných hodnot)
    let sms_gateway = { provider: 'twilio', gosms_channel: '', twilio_sms_from: '', gosms_ready: false, twilio_ready: false };
    try { sms_gateway = await require('../services/voice/sms').getSmsConfigView(); } catch (_) { /* fallback */ }
    // Přepojení na živého člověka
    const trRaw = get ? await get('voice.transfer_enabled') : true;
    const transfer_enabled = trRaw === undefined || trRaw === null ? true : (trRaw === true || trRaw === 'true' || trRaw === 1 || trRaw === '1');
    const transfer_fallback_numbers = get ? (await get('voice.transfer_fallback_numbers')) || '' : '';
    const transfer_inbound_number = get ? (await get('voice.transfer_inbound_number')) || '' : '';
    const transfer_ring_timeout = get ? parseInt(await get('voice.transfer_ring_timeout'), 10) || 20 : 20;
    const transfer_rounds = get ? parseInt(await get('voice.transfer_rounds'), 10) || 2 : 2;
    res.json({ inbound_prompt, inbound_greeting, notify_person_ids: notify_person_ids || [], default_from, sms_on_no_answer, sms_text, sms_gateway,
      transfer_enabled, transfer_fallback_numbers, transfer_inbound_number, transfer_ring_timeout, transfer_rounds });
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
    if (req.body.inbound_greeting !== undefined)
      await settings.setSetting('voice.inbound_greeting', String(req.body.inbound_greeting || ''), { type: 'string', userId: uid });
    if (notify_person_ids !== undefined) {
      const arr = (Array.isArray(notify_person_ids) ? notify_person_ids : [])
        .map((x) => parseInt(x, 10))
        .filter(Boolean);
      await settings.setSetting('voice.notify_person_ids', arr, { type: 'json', userId: uid });
    }
    if (default_from !== undefined)
      await settings.setSetting('voice.default_from', String(default_from || ''), { type: 'string', userId: uid });
    const { sms_on_no_answer, sms_text } = req.body || {};
    if (sms_on_no_answer !== undefined)
      await settings.setSetting('voice.sms_on_no_answer', !!sms_on_no_answer, { type: 'boolean', userId: uid });
    if (sms_text !== undefined)
      await settings.setSetting('voice.sms_text', String(sms_text || ''), { type: 'string', userId: uid });
    // Brána SMS — jen NEtajné hodnoty (provider, kanál, odesílatel). Klíče zůstávají v env.
    const { sms_provider, gosms_channel, twilio_sms_from } = req.body || {};
    if (sms_provider !== undefined) {
      const p = String(sms_provider || '').toLowerCase() === 'gosms' ? 'gosms' : 'twilio';
      await settings.setSetting('voice.sms_provider', p, { type: 'string', userId: uid });
    }
    if (gosms_channel !== undefined)
      await settings.setSetting('voice.gosms_channel', String(gosms_channel || '').trim(), { type: 'string', userId: uid });
    if (twilio_sms_from !== undefined)
      await settings.setSetting('voice.twilio_sms_from', String(twilio_sms_from || '').trim(), { type: 'string', userId: uid });
    // Přepojení na živého člověka
    const { transfer_enabled, transfer_fallback_numbers, transfer_inbound_number, transfer_ring_timeout } = req.body || {};
    if (transfer_enabled !== undefined)
      await settings.setSetting('voice.transfer_enabled', !!transfer_enabled, { type: 'boolean', userId: uid });
    if (transfer_fallback_numbers !== undefined)
      await settings.setSetting('voice.transfer_fallback_numbers', String(transfer_fallback_numbers || '').trim(), { type: 'string', userId: uid });
    if (transfer_inbound_number !== undefined)
      await settings.setSetting('voice.transfer_inbound_number', String(transfer_inbound_number || '').trim(), { type: 'string', userId: uid });
    if (transfer_ring_timeout !== undefined)
      await settings.setSetting('voice.transfer_ring_timeout', String(parseInt(transfer_ring_timeout, 10) || 20), { type: 'string', userId: uid });
    if (req.body.transfer_rounds !== undefined)
      await settings.setSetting('voice.transfer_rounds', String(parseInt(req.body.transfer_rounds, 10) || 2), { type: 'string', userId: uid });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/voice/sms — ruční / testovací odeslání SMS (přes VOICE_SMS_FROM)
router.post('/sms', requireAuth, express.json(), async (req, res) => {
  try {
    const { to, body } = req.body || {};
    if (!to || !String(to).trim()) return res.status(400).json({ error: 'Chybí telefonní číslo' });
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'Chybí text zprávy' });
    const sms = require('../services/voice/sms');
    const sid = await sms.sendSms(String(to).trim(), String(body), { context: 'manual' });
    res.json({ ok: true, sid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/voice/sms-log — jednotný přehled odeslaných SMS + stav doručení.
// ?refresh=1 → nejdřív dotáhne aktuální stavy z GoSMS (u nedokončených).
router.get('/sms-log', requireAuth, async (req, res, next) => {
  try {
    if (!prisma.smsLog) return res.json({ rows: [] });
    if (req.query.refresh === '1') {
      try { await require('../services/voice/sms').refreshSmsLogStatuses(60); } catch (_) { /* nevadí */ }
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 150, 400);
    const rows = await prisma.smsLog.findMany({ orderBy: { created_at: 'desc' }, take: limit });
    // Otevření odkazu (proxy „přečteno") u specialistních SMS podle leadu.
    const leadIds = Array.from(new Set(rows.filter((r) => r.lead_id).map((r) => r.lead_id)));
    const leadMap = {};
    if (leadIds.length && prisma.compounderLead) {
      const leads = await prisma.compounderLead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, name: true, ai_specialist_opened_at: true },
      });
      leads.forEach((l) => { leadMap[l.id] = l; });
    }
    const out = rows.map((r) => {
      const l = r.lead_id ? leadMap[r.lead_id] : null;
      return {
        id: r.id, provider: r.provider, to: r.to_number, body: r.body, context: r.context,
        status: r.status, delivered: r.delivered, error: r.error, created_at: r.created_at,
        lead_id: r.lead_id, name: l ? l.name : null,
        opened: l ? !!l.ai_specialist_opened_at : null,
        opened_at: l ? l.ai_specialist_opened_at : null,
      };
    });
    res.json({ rows: out });
  } catch (err) { next(err); }
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
        transfer_enabled: b.transfer_enabled === undefined ? true : !!b.transfer_enabled,
        transfer_fallback_numbers: b.transfer_fallback_numbers ? String(b.transfer_fallback_numbers).trim() : null,
        transfer_ring_timeout: b.transfer_ring_timeout != null ? (parseInt(b.transfer_ring_timeout, 10) || null) : null,
        created_by_user_id: req.user && req.user.id,
        status: 'draft',
      },
    });
    res.status(201).json(camp);
  } catch (err) {
    next(err);
  }
});

// Úprava kampaně (scénář, název, číslo, časové okno)
router.put('/campaigns/:id', requireAuth, express.json(), async (req, res, next) => {
  try {
    const b = req.body || {};
    const data = {};
    if (b.name !== undefined) data.name = String(b.name);
    if (b.script !== undefined) data.script = b.script ? String(b.script) : null;
    if (b.greeting !== undefined) data.greeting = b.greeting ? String(b.greeting) : null;
    if (b.from_number !== undefined) data.from_number = b.from_number ? String(b.from_number).replace(/[\s\-()]/g, '') : null;
    if (b.call_from !== undefined) data.call_from = b.call_from || null;
    if (b.call_to !== undefined) data.call_to = b.call_to || null;
    if (b.transfer_enabled !== undefined) data.transfer_enabled = !!b.transfer_enabled;
    if (b.transfer_fallback_numbers !== undefined) data.transfer_fallback_numbers = b.transfer_fallback_numbers ? String(b.transfer_fallback_numbers).trim() : null;
    if (b.transfer_ring_timeout !== undefined) data.transfer_ring_timeout = b.transfer_ring_timeout != null && b.transfer_ring_timeout !== '' ? (parseInt(b.transfer_ring_timeout, 10) || null) : null;
    const camp = await prisma.voiceCampaign.update({ where: { id: req.params.id }, data });
    res.json(camp);
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

    // Doplň k cílům info o hovoru (kdy voláno, délka, nahrávka)
    const callIds = camp.targets.map((t) => t.voice_call_id).filter(Boolean);
    const callMap = {};
    if (callIds.length && prisma.voiceCall) {
      const cs = await prisma.voiceCall.findMany({
        where: { id: { in: callIds } },
        select: { id: true, started_at: true, duration_sec: true, audio_url: true },
      });
      cs.forEach((c) => (callMap[c.id] = c));
    }
    camp.targets = camp.targets.map((t) => ({
      ...t,
      call: t.voice_call_id && callMap[t.voice_call_id]
        ? {
            id: t.voice_call_id,
            started_at: callMap[t.voice_call_id].started_at,
            duration_sec: callMap[t.voice_call_id].duration_sec,
            has_audio: !!callMap[t.voice_call_id].audio_url,
          }
        : null,
    }));
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

    const batch = camp.current_batch || 1;
    await prisma.voiceCampaignTarget.createMany({
      data: clean.map((i) => ({ campaign_id: camp.id, name: i.name, phone: i.phone, status: 'pending', batch_no: batch })),
    });
    res.status(201).json({ added: clean.length, batch });
  } catch (err) {
    next(err);
  }
});

// Uzavře aktuální seznam (kolo) a založí nový — kampaň běží dál, staré kolo
// zůstává kvůli statistikám. Nové leady půjdou do nového kola.
router.post('/campaigns/:id/new-batch', requireAuth, async (req, res, next) => {
  try {
    const camp = await prisma.voiceCampaign.findUnique({ where: { id: req.params.id }, select: { current_batch: true } });
    if (!camp) return res.status(404).json({ error: 'Kampaň nenalezena' });
    const next = (camp.current_batch || 1) + 1;
    const updated = await prisma.voiceCampaign.update({ where: { id: req.params.id }, data: { current_batch: next } });
    res.json({ ok: true, current_batch: next, campaign: updated });
  } catch (err) { next(err); }
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

// Volat znovu konkrétní cíl — vrátí ho na pending a rozjede kampaň
router.post('/campaigns/:id/targets/:tid/retry', requireAuth, async (req, res, next) => {
  try {
    const t = await prisma.voiceCampaignTarget.update({
      where: { id: req.params.tid },
      data: { status: 'pending', result_summary: null },
    });
    await prisma.voiceCampaign
      .update({ where: { id: req.params.id }, data: { status: 'running' } })
      .catch(() => {});
    res.json({ ok: true, target: t });
  } catch (err) {
    next(err);
  }
});

// Archivace sady (kvůli statistikám ji necháme, jen ji v UI sbalíme dolů).
router.post('/campaigns/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const camp = await prisma.voiceCampaign.update({ where: { id: req.params.id }, data: { status: 'archived' } });
    res.json(camp);
  } catch (err) { next(err); }
});
router.post('/campaigns/:id/unarchive', requireAuth, async (req, res, next) => {
  try {
    const camp = await prisma.voiceCampaign.update({ where: { id: req.params.id }, data: { status: 'paused' } });
    res.json(camp);
  } catch (err) { next(err); }
});

// Statistika kampaně: celkem + rozpad po kolech (seznamech). Trychtýř dovolání
// + čas hovorů + SMS + výsledky (schůzka/volat/nezájem dle stavu kontaktů).
router.get('/campaigns/:id/stats', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const camp = await prisma.voiceCampaign.findUnique({ where: { id }, select: { current_batch: true } });
    const targets = await prisma.voiceCampaignTarget.findMany({
      where: { campaign_id: id },
      select: { status: true, sms_sent: true, phone: true, voice_call_id: true, batch_no: true },
    });
    // Délky hovorů (jeden dotaz).
    const callMap = {};
    const callIds = targets.map((t) => t.voice_call_id).filter(Boolean);
    if (callIds.length && prisma.voiceCall) {
      const calls = await prisma.voiceCall.findMany({ where: { id: { in: callIds } }, select: { id: true, duration_sec: true, audio_url: true, started_at: true, ended_at: true } });
      calls.forEach((c) => { callMap[c.id] = c; });
    }
    // Stavy spárovaných kontaktů (jeden dotaz) → mapa podle posledních 9 číslic.
    const leadByTail = {};
    try {
      if (prisma.compounderLead) {
        const leads = await prisma.compounderLead.findMany({
          where: { status: { in: ['schuzka', 'schuzka_online', 'volat_pristi', 'nezajem'] } },
          select: { phone: true, status: true }, take: 8000,
        });
        leads.forEach((l) => { const tl = String(l.phone || '').replace(/\D/g, '').slice(-9); if (tl.length >= 6) leadByTail[tl] = l.status; });
      }
    } catch (_) { /* best-effort */ }

    const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    function computeStats(list) {
      const total = list.length;
      const by = {};
      list.forEach((t) => { by[t.status] = (by[t.status] || 0) + 1; });
      const reached = by.done || 0, noAnswer = by.no_answer || 0, failed = by.failed || 0, pending = by.pending || 0;
      const inProgress = (by.calling || 0) + (by.ringing || 0) + (by.in_progress || 0);
      const attempted = total - pending;
      const smsSent = list.filter((t) => t.sms_sent).length;
      let totalSec = 0, withAudio = 0, durs = [];
      let minStart = null, maxEnd = null;
      list.forEach((t) => { const c = t.voice_call_id && callMap[t.voice_call_id]; if (c) {
        totalSec += (c.duration_sec || 0); if (c.audio_url) withAudio++; if (c.duration_sec) durs.push(c.duration_sec);
        const st = c.started_at ? new Date(c.started_at).getTime() : null;
        const en = c.ended_at ? new Date(c.ended_at).getTime() : (st && c.duration_sec ? st + c.duration_sec * 1000 : st);
        if (st && (minStart === null || st < minStart)) minStart = st;
        if (en && (maxEnd === null || en > maxEnd)) maxEnd = en;
      } });
      const avgSec = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
      const spanSec = (minStart !== null && maxEnd !== null && maxEnd > minStart) ? Math.round((maxEnd - minStart) / 1000) : 0;
      let meeting = 0, callback = 0, nointerest = 0;
      list.forEach((t) => {
        const tl = String(t.phone || '').replace(/\D/g, '').slice(-9);
        const st = leadByTail[tl]; if (!st) return;
        if (st === 'nezajem') nointerest++; else if (st === 'volat_pristi') callback++; else meeting++;
      });
      return { total, attempted, reached, noAnswer, failed, pending, inProgress, smsSent, totalSec, avgSec, spanSec, withAudio, meeting, callback, nointerest, rates: { reachedOfAttempted: pct(reached, attempted), reachedOfTotal: pct(reached, total) } };
    }

    // Rozpad po kolech.
    const byBatch = {};
    targets.forEach((t) => { const b = t.batch_no || 1; (byBatch[b] = byBatch[b] || []).push(t); });
    const batches = Object.keys(byBatch).map((b) => Object.assign({ batch_no: parseInt(b, 10) }, computeStats(byBatch[b])))
      .sort((a, b) => b.batch_no - a.batch_no);

    res.json(Object.assign({ ok: true, current_batch: (camp && camp.current_batch) || 1, batches }, computeStats(targets)));
  } catch (err) { next(err); }
});

// Dohledá u dovolaných hovorů chybějící nahrávky přímo z Twilia (podle CallSid).
// Řeší starší hovory, u kterých se URL nahrávky kdysi neuložila.
router.post('/campaigns/:id/backfill-recordings', requireAuth, async (req, res, next) => {
  try {
    if (!prisma.voiceCall || !prisma.voiceCampaignTarget) return res.json({ ok: true, fixed: 0 });
    const targets = await prisma.voiceCampaignTarget.findMany({ where: { campaign_id: req.params.id }, select: { voice_call_id: true } });
    const ids = targets.map((t) => t.voice_call_id).filter(Boolean);
    if (!ids.length) return res.json({ ok: true, fixed: 0 });
    const calls = await prisma.voiceCall.findMany({
      where: { id: { in: ids }, audio_url: null, twilio_call_sid: { not: null } },
      select: { id: true, twilio_call_sid: true },
    });
    if (!calls.length) return res.json({ ok: true, fixed: 0 });
    const c = require('../services/voice/outbound').client();
    if (!c) return res.status(500).json({ error: 'Twilio není nakonfigurováno' });
    let fixed = 0;
    for (const call of calls) {
      if (!call.twilio_call_sid || String(call.twilio_call_sid).startsWith('local-')) continue;
      try {
        const recs = await c.recordings.list({ callSid: call.twilio_call_sid, limit: 1 });
        if (recs && recs.length) {
          const uri = String(recs[0].uri || '').replace(/\.json$/, '');
          const url = 'https://api.twilio.com' + uri; // ensureLocalRecording doplní .mp3
          await prisma.voiceCall.update({ where: { id: call.id }, data: { audio_url: url } });
          fixed++;
        }
      } catch (e) { console.warn('[voice] backfill rec', call.twilio_call_sid, ':', e.message); }
    }
    res.json({ ok: true, fixed, checked: calls.length });
  } catch (err) { next(err); }
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
