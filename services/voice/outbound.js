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

// Doplní E.164: české 9místné číslo → +420…, "00…" → "+…", jinak nechá.
function toE164(num) {
  num = (num || '').replace(/[\s\-()]/g, '');
  if (!num) return num;
  if (num.startsWith('+')) return num;
  if (num.startsWith('00')) return '+' + num.slice(2);
  if (/^\d{9}$/.test(num)) return '+420' + num;
  return num;
}

async function placeCall(target, campaign) {
  const c = client();
  if (!c) throw new Error('Twilio není nakonfigurováno (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');

  // Odchozí (from) MUSÍ být Twilio číslo. Bereme napevno z env VOICE_DEFAULT_FROM,
  // teprve pak z pole kampaně — aby se nedalo omylem volat z vlastního mobilu.
  const from = toE164(process.env.VOICE_DEFAULT_FROM || (campaign && campaign.from_number) || '');
  if (!from) throw new Error('Není nastavené odchozí Twilio číslo (VOICE_DEFAULT_FROM)');
  if (!target || !target.phone) throw new Error('Cíl nemá telefonní číslo');
  const to = toE164(target.phone);

  const call = await c.calls.create({
    to,
    from,
    url: `${PUBLIC_BASE}/api/voice/outgoing?target=${encodeURIComponent(target.id)}`,
    method: 'POST',
    statusCallback: `${PUBLIC_BASE}/api/voice/status`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    // Nahrávání hovoru → po skončení Twilio pošle URL na /api/voice/recording
    record: true,
    recordingStatusCallback: `${PUBLIC_BASE}/api/voice/recording`,
    recordingStatusCallbackEvent: ['completed'],
    timeout: 30,
  });
  return call.sid;
}

module.exports = { placeCall, isConfigured, client, toE164 };
