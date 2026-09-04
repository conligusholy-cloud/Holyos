// =============================================================================
// HolyOS — Voice: SMS po nedovolání (follow-up leadovi)
// =============================================================================
// Když se odchozí hovor nespojí (no_answer/busy/failed), pošle leadovi SMS,
// aby příště číslo poznal. Odesílatel = VOICE_SMS_FROM (alfanumerický „Pradlomaty"
// nebo Messaging Service SID „MG…"). Jen jednou na lead (target.sms_sent).

const { prisma } = require('../../config/database');
const outbound = require('./outbound');

let getSetting = null;
try {
  ({ getSetting } = require('../settings'));
} catch (_) {
  getSetting = null;
}

const DEFAULT_TEXT =
  'Dobrý den, volali jsme Vám ohledně prádelen Prádlomat (Best Series). ' +
  'Nedovolali jsme se. Napište si kdykoli s naším specialistou: {link}';

// Nastavení lze měnit za běhu přes AppSetting (voice.sms_provider / voice.gosms_channel /
// voice.twilio_sms_from) — nadřazené env. Když v nastavení nic není, použije se env.
// TAJNÉ klíče (GOSMS_CLIENT_SECRET, TWILIO_AUTH_TOKEN) zůstávají VŽDY jen v env, ne v UI/DB.
async function setting(key) {
  if (!getSetting) return null;
  try {
    const v = await getSetting(key);
    return v === undefined || v === null || v === '' ? null : v;
  } catch (_) {
    return null;
  }
}

// Poskytovatel SMS: 'gosms' (český GoSMS.cz) nebo 'twilio' (default).
async function smsProvider() {
  const s = await setting('voice.sms_provider');
  return String(s || process.env.SMS_PROVIDER || 'twilio').toLowerCase();
}
async function gosmsChannel() {
  const s = await setting('voice.gosms_channel');
  return String(s || process.env.GOSMS_CHANNEL || '').trim();
}
async function twilioFrom() {
  const s = await setting('voice.twilio_sms_from');
  return String(s || process.env.VOICE_SMS_FROM || '').trim();
}

// Přehled nastavení brány pro UI (bez tajných hodnot — jen zda jsou klíče přítomné).
async function getSmsConfigView() {
  return {
    provider: await smsProvider(),
    gosms_channel: await gosmsChannel(),
    twilio_sms_from: await twilioFrom(),
    gosms_ready: !!(process.env.GOSMS_CLIENT_ID && process.env.GOSMS_CLIENT_SECRET),
    twilio_ready: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  };
}

async function sendViaTwilio(to, body) {
  const c = outbound.client();
  if (!c) throw new Error('Twilio není nakonfigurováno');
  const from = await twilioFrom();
  if (!from) throw new Error('Není nastavený odesílatel SMS (Twilio odesílatel / VOICE_SMS_FROM)');
  const params = { to: outbound.toE164(to), body };
  if (from.startsWith('MG')) params.messagingServiceSid = from;
  else params.from = from;
  const msg = await c.messages.create(params);
  return msg.sid;
}

// GoSMS.cz — OAuth2 (client_credentials) → POST /api/v1/messages. Odesílatel
// ("Pradlomaty") se nastaví jako KANÁL v GoSMS portálu → GOSMS_CHANNEL = jeho ID.
async function sendViaGoSms(to, body) {
  const id = process.env.GOSMS_CLIENT_ID;
  const secret = process.env.GOSMS_CLIENT_SECRET;
  const channel = await gosmsChannel();
  if (!id || !secret || !channel) {
    throw new Error('GoSMS není nakonfigurováno (GOSMS_CLIENT_ID / GOSMS_CLIENT_SECRET v env, kanál v nastavení / GOSMS_CHANNEL)');
  }
  const base = (process.env.GOSMS_BASE || 'https://app.gosms.eu').replace(/\/+$/, '');
  const tokUrl =
    base + '/oauth/v2/token?grant_type=client_credentials' +
    '&client_id=' + encodeURIComponent(id) +
    '&client_secret=' + encodeURIComponent(secret);
  const tokRes = await fetch(tokUrl);
  if (!tokRes.ok) throw new Error('GoSMS token HTTP ' + tokRes.status);
  const tokJson = await tokRes.json();
  const accessToken = tokJson.access_token;
  if (!accessToken) throw new Error('GoSMS nevrátil access_token');

  const res = await fetch(base + '/api/v1/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: body,
      recipients: [outbound.toE164(to)],
      channel: Number(channel),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('GoSMS send HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  const j = await res.json().catch(() => ({}));
  let msgId = extractGoSmsId(j);
  // Fallback: API Platform vrací nový záznam i v hlavičce Location: /api/v1/messages/123
  if (!msgId) {
    const loc = res.headers && res.headers.get && res.headers.get('location');
    const m = loc && String(loc).match(/(\d+)\/?$/);
    if (m) msgId = m[1];
  }
  if (!msgId) {
    console.warn('[gosms] id zprávy nenalezeno v odpovědi, tvar:', JSON.stringify(j).slice(0, 400));
    msgId = 'gosms';
  }
  return msgId;
}

// Robustně vytáhne id GoSMS zprávy z různých tvarů odpovědi
// (API Platform JSON-LD @id, pole, hydra:member, data.id, prosté id).
function extractGoSmsId(j) {
  if (j == null) return null;
  if (Array.isArray(j)) {
    for (const it of j) {
      const r = extractGoSmsId(it);
      if (r) return r;
    }
    return null;
  }
  if (typeof j !== 'object') return null;
  // GoSMS POST /messages vrací id v poli "link" = "api/v1/messages/<id>".
  if (j.link) { const m = String(j.link).match(/(\d+)\/?$/); if (m) return m[1]; }
  if (j.links && j.links.self) { const m = String(j.links.self).match(/(\d+)\/?$/); if (m) return m[1]; }
  if (j.id != null && String(j.id).trim()) return String(j.id);
  if (j['@id']) {
    const m = String(j['@id']).match(/(\d+)\/?$/);
    if (m) return m[1];
  }
  if (Array.isArray(j['hydra:member'])) {
    const r = extractGoSmsId(j['hydra:member']);
    if (r) return r;
  }
  if (j.data) {
    const r = extractGoSmsId(j.data);
    if (r) return r;
  }
  if (Array.isArray(j.messages)) {
    const r = extractGoSmsId(j.messages);
    if (r) return r;
  }
  return null;
}

// Zaloguje odeslání SMS do sms_log (nikdy neshodí odeslání kvůli logu).
async function logSms({ provider, to, body, message_id, context, lead_id, status, error }) {
  try {
    if (!prisma.smsLog) return;
    await prisma.smsLog.create({
      data: {
        provider: String(provider || '').slice(0, 20),
        to_number: String(to || '').slice(0, 40),
        body: body ? String(body) : null,
        message_id: message_id ? String(message_id).slice(0, 64) : null,
        context: context ? String(context).slice(0, 40) : 'other',
        lead_id: lead_id != null ? Number(lead_id) : null,
        status: status || 'sent',
        delivered: false,
        error: error ? String(error).slice(0, 500) : null,
      },
    });
  } catch (e) { console.warn('[sms] log selhal:', e.message); }
}

async function sendSms(to, body, meta = {}) {
  const p = await smsProvider();
  let id = null;
  let err = null;
  try {
    id = (p === 'gosms') ? await sendViaGoSms(to, body) : await sendViaTwilio(to, body);
  } catch (e) { err = e; }
  await logSms({
    provider: p, to, body, message_id: id,
    context: meta.context, lead_id: meta.leadId,
    status: err ? 'failed' : 'sent', error: err ? err.message : null,
  });
  if (err) throw err;
  return id;
}

// Projde nedokončené GoSMS zprávy v logu a doplní stav doručení z GoSMS API.
async function refreshSmsLogStatuses(limit = 40) {
  if (!prisma.smsLog) return 0;
  const since = new Date(Date.now() - 14 * 86400000);
  const rows = await prisma.smsLog.findMany({
    where: {
      provider: 'gosms',
      created_at: { gte: since },
      message_id: { not: null },
      status: { in: ['sent', 'unknown'] },
    },
    orderBy: { created_at: 'desc' },
    take: Math.min(limit, 100),
  });
  let n = 0;
  for (const r of rows) {
    if (!r.message_id || r.message_id === 'gosms') continue;
    try {
      const st = await getGoSmsStatus(r.message_id);
      const label = st.label;
      let status = 'sent', delivered = false;
      if (label === 'doručeno') { status = 'delivered'; delivered = true; }
      else if (label === 'nedoručeno') { status = 'undelivered'; }
      await prisma.smsLog.update({
        where: { id: r.id },
        data: { status, delivered, status_checked_at: new Date() },
      });
      n++;
    } catch (e) { /* přeskoč jednotlivé chyby */ }
  }
  return n;
}

// Zjistí stav doručení GoSMS zprávy podle id → { raw, label }.
async function getGoSmsStatus(id) {
  const cid = process.env.GOSMS_CLIENT_ID;
  const secret = process.env.GOSMS_CLIENT_SECRET;
  if (!cid || !secret) throw new Error('GoSMS není nakonfigurováno');
  const base = (process.env.GOSMS_BASE || 'https://app.gosms.eu').replace(/\/+$/, '');
  const tokRes = await fetch(
    base + '/oauth/v2/token?grant_type=client_credentials&client_id=' + encodeURIComponent(cid) + '&client_secret=' + encodeURIComponent(secret)
  );
  if (!tokRes.ok) throw new Error('GoSMS token HTTP ' + tokRes.status);
  const at = (await tokRes.json()).access_token;
  const r = await fetch(base + '/api/v1/messages/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + at } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('GoSMS status HTTP ' + r.status + ' ' + t.slice(0, 150));
  }
  const j = await r.json().catch(() => ({}));
  // GoSMS detail: delivery.isDelivered (bool) + sendingInfo.status (CONCEPT/QUEUE/SENT/DELIVERED/…)
  // + recipients.notSent/invalid. Vyhodnotíme nejvýznamnější stav.
  let label = 'odesláno';
  try {
    const delivered = !!(j.delivery && j.delivery.isDelivered);
    const sstatus = String((j.sendingInfo && j.sendingInfo.status) || '').toLowerCase();
    const notSent = (j.recipients && Array.isArray(j.recipients.notSent) && j.recipients.notSent.length) ? j.recipients.notSent.length : 0;
    const invalid = (j.recipients && Array.isArray(j.recipients.invalid) && j.recipients.invalid.length) ? j.recipients.invalid.length : 0;
    if (delivered || /deliver|doru/.test(sstatus)) label = 'doručeno';
    else if (notSent || invalid || /(fail|undeliver|expir|reject|error|nedoru)/.test(sstatus)) label = 'nedoručeno';
    else if (/(sent|sending|queue|concept|pending|accepted|odesl)/.test(sstatus)) label = 'odesláno';
    else {
      // fallback na hrubé prohledání
      const blob = JSON.stringify(j).toLowerCase();
      if (/isdelivered":true|deliver|doru/.test(blob)) label = 'doručeno';
      else if (/(fail|undeliver|expir|reject|error|nedoru)/.test(blob)) label = 'nedoručeno';
    }
  } catch (_) { /* fallback */ }
  return { raw: j, label };
}

// Pošle follow-up SMS leadovi po nedovolání (pokud je zapnuto a ještě neodešla).
async function maybeSendNoAnswerSms(target) {
  try {
    if (!target || target.sms_sent) return;
    if (!getSetting) return;

    const on = await getSetting('voice.sms_on_no_answer');
    const enabled = on === true || on === 'true' || on === 1 || on === '1';
    if (!enabled) return;
    const provider = await smsProvider();
    if (provider === 'gosms' && !(await gosmsChannel())) {
      console.log('[voice] SMS přeskočena — chybí GoSMS kanál');
      return;
    }
    if (provider !== 'gosms' && !(await twilioFrom())) {
      console.log('[voice] SMS přeskočena — chybí Twilio odesílatel (VOICE_SMS_FROM)');
      return;
    }

    let text = await getSetting('voice.sms_text');
    if (!text || !String(text).trim()) text = DEFAULT_TEXT;
    text = String(text);

    // Jedinečný odkaz na specialistu pro daného leada (spárováno podle telefonu).
    // Podporuje placeholder {link}; když ho text nemá, odkaz připojíme na konec.
    let leadId = null;
    try {
      const digits = String(target.phone || '').replace(/\D/g, '');
      if (digits.length >= 6 && prisma.compounderLead) {
        const tail = digits.slice(-9);
        const leads = await prisma.compounderLead.findMany({
          where: { phone: { contains: tail } },
          select: { id: true, phone: true, show_ai_specialist: true },
          take: 5, orderBy: { updated_at: 'desc' },
        });
        const lead = leads.find((l) => String(l.phone || '').replace(/\D/g, '').slice(-9) === tail);
        if (lead) {
          leadId = lead.id;
          let link = '';
          try { link = require('../../routes/compounder.routes').specialistShortLink(lead.id, 'sms'); } catch (_) { link = ''; }
          if (link) {
            // Odkaz funguje jen když lead vidí specialistu — zapneme mu ho.
            if (!lead.show_ai_specialist) {
              await prisma.compounderLead.update({ where: { id: lead.id }, data: { show_ai_specialist: true } }).catch(() => {});
            }
            if (text.indexOf('{link}') !== -1) text = text.replace('{link}', link);
            else text = text.trim() + ' ' + link;
          } else if (text.indexOf('{link}') !== -1) {
            text = text.replace('{link}', '').replace(/\s+/g, ' ').trim();
          }
        }
      }
    } catch (e) { console.warn('[voice] no-answer link:', e.message); }
    if (text.indexOf('{link}') !== -1) text = text.replace('{link}', '').replace(/\s+/g, ' ').trim();

    await sendSms(target.phone, text, { context: 'no_answer', leadId });
    await prisma.voiceCampaignTarget
      .update({ where: { id: target.id }, data: { sms_sent: true } })
      .catch(() => {});
    console.log('[voice] follow-up SMS odeslána na', target.phone);
  } catch (e) {
    console.warn('[voice] SMS po nedovolání selhala:', e.message);
  }
}

module.exports = { sendSms, maybeSendNoAnswerSms, getGoSmsStatus, getSmsConfigView, refreshSmsLogStatuses, DEFAULT_TEXT };
