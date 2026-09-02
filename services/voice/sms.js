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

async function sendSms(to, body) {
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
