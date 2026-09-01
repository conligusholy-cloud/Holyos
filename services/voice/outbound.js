// =============================================================================
// HolyOS — Voice: odchozí volání (Twilio REST) pro kampaně
// =============================================================================
// placeCall() zavolá leadovi. Twilio při spojení zavolá /api/voice/outgoing,
// které vrátí TwiML s ConversationRelay napojeným na WS (?target=<id>).

let twilioLib = null;
try {
  twilioLib = require('twilio');
} catch (_) {
  twilioLib = null;
}

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://app.holyos.cz';

function client() {
  if (!twilioLib || !SID || !TOKEN) return null;
  return twilioLib(SID, TOKEN);
}

function isConfigured() {
  return !!client();
}

async function placeCall(target, campaign) {
  const c = client();
  if (!c) throw new Error('Twilio není nakonfigurováno (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');

  const from = (campaign && campaign.from_number) || process.env.VOICE_DEFAULT_FROM;
  if (!from) throw new Error('Kampaň nemá odchozí číslo (from_number)');
  if (!target || !target.phone) throw new Error('Cíl nemá telefonní číslo');

  const call = await c.calls.create({
    to: target.phone,
    from,
    url: `${PUBLIC_BASE}/api/voice/outgoing?target=${encodeURIComponent(target.id)}`,
    method: 'POST',
    statusCallback: `${PUBLIC_BASE}/api/voice/status`,
    statusCallbackEvent: ['completed'],
    timeout: 30,
  });
  return call.sid;
}

module.exports = { placeCall, isConfigured, client };
