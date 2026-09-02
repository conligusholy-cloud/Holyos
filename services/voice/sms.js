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
  'Nedovolali jsme se, zkusíme to ještě jednou. Děkujeme, Best Series.';

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

async function sendSms(to, body) {
  const p = await smsProvider();
  if (p === 'gosms') return sendViaGoSms(to, body);
  return sendViaTwilio(to, body);
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
  // GoSMS vrací pole recipients se stavem doručení; sesbíráme nejvýznamnější stav.
  let label = 'odesláno';
  try {
    const recs = Array.isArray(j.recipients) ? j.recipients : (j.data && Array.isArray(j.data.recipients) ? j.data.recipients : []);
    const states = recs.map((x) => String(x.status || x.state || x.deliveryStatus || '').toLowerCase());
    const blob = (states.join(',') + ' ' + JSON.stringify(j)).toLowerCase();
    if (/deliver|doru|3\b/.test(blob)) label = 'doručeno';
    else if (/(fail|undeliver|expired|reject|nedoru|error)/.test(blob)) label = 'nedoručeno';
    else if (/(sent|sending|queue|pending|accepted|odesl)/.test(blob)) label = 'odesláno';
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

    await sendSms(target.phone, String(text));
    await prisma.voiceCampaignTarget
      .update({ where: { id: target.id }, data: { sms_sent: true } })
      .catch(() => {});
    console.log('[voice] follow-up SMS odeslána na', target.phone);
  } catch (e) {
    console.warn('[voice] SMS po nedovolání selhala:', e.message);
  }
}

module.exports = { sendSms, maybeSendNoAnswerSms, getGoSmsStatus, getSmsConfigView, DEFAULT_TEXT };
