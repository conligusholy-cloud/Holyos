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

// Poskytovatel SMS: 'gosms' (český GoSMS.cz) nebo 'twilio' (default).
function smsProvider() {
  return (process.env.SMS_PROVIDER || 'twilio').toLowerCase();
}

function smsConfigured() {
  if (smsProvider() === 'gosms') {
    return !!(process.env.GOSMS_CLIENT_ID && process.env.GOSMS_CLIENT_SECRET && process.env.GOSMS_CHANNEL);
  }
  return !!process.env.VOICE_SMS_FROM;
}

async function sendViaTwilio(to, body) {
  const c = outbound.client();
  if (!c) throw new Error('Twilio není nakonfigurováno');
  const from = process.env.VOICE_SMS_FROM;
  if (!from) throw new Error('Není nastavený odesílatel SMS (VOICE_SMS_FROM)');
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
  const channel = process.env.GOSMS_CHANNEL;
  if (!id || !secret || !channel) {
    throw new Error('GoSMS není nakonfigurováno (GOSMS_CLIENT_ID / GOSMS_CLIENT_SECRET / GOSMS_CHANNEL)');
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
  return (j && (j.id || (j.data && j.data.id))) || 'gosms';
}

async function sendSms(to, body) {
  if (smsProvider() === 'gosms') return sendViaGoSms(to, body);
  return sendViaTwilio(to, body);
}

// Pošle follow-up SMS leadovi po nedovolání (pokud je zapnuto a ještě neodešla).
async function maybeSendNoAnswerSms(target) {
  try {
    if (!target || target.sms_sent) return;
    if (!getSetting) return;

    const on = await getSetting('voice.sms_on_no_answer');
    const enabled = on === true || on === 'true' || on === 1 || on === '1';
    if (!enabled) return;
    if (!process.env.VOICE_SMS_FROM) {
      console.log('[voice] SMS přeskočena — chybí VOICE_SMS_FROM');
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

module.exports = { sendSms, maybeSendNoAnswerSms, DEFAULT_TEXT };
