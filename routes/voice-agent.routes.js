// =============================================================================
// HolyOS — Voice agent: Twilio webhooky (REST)
// =============================================================================
// Mount v app.js:  app.use('/api/voice', require('./routes/voice-agent.routes'));
// Endpointy jsou volané Twiliem (ne prohlížečem), proto bez requireAuth.
// Bezpečnost: v produkci ověřovat X-Twilio-Signature (twilio.validateRequest)
// — doplní se, až budou TWILIO_* creds (Fáze 0).

const express = require('express');
const router = express.Router();

const WS_URL = process.env.VOICE_RELAY_WS_URL || 'wss://app.holyos.cz/api/voice/relay';
const TTS_PROVIDER = process.env.VOICE_TTS_PROVIDER || 'ElevenLabs';
const STT_PROVIDER = process.env.VOICE_STT_PROVIDER || 'Deepgram';
const RELAY_SECRET = process.env.VOICE_RELAY_SECRET || '';

// WS url + sdílené tajemství (ověří se v services/voice/relay-ws.js)
function relayUrl() {
  if (!RELAY_SECRET) return WS_URL;
  return WS_URL + (WS_URL.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(RELAY_SECRET);
}

// Twilio posílá application/x-www-form-urlencoded
const form = express.urlencoded({ extended: false });

// POST /api/voice/incoming — první webhook příchozího hovoru.
// Vrací TwiML, které předá hovor ConversationRelay (řeč↔text) a napojí ho na náš WS.
router.post('/incoming', form, (req, res) => {
  // TODO Fáze 1: validace X-Twilio-Signature
  const twiml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Response>\n' +
    '  <Connect>\n' +
    `    <ConversationRelay url="${relayUrl()}" language="cs-CZ" ` +
    `ttsProvider="${TTS_PROVIDER}" transcriptionProvider="${STT_PROVIDER}" />\n` +
    '  </Connect>\n' +
    '</Response>';
  res.type('text/xml').send(twiml);
});

// POST /api/voice/status — status callback po skončení hovoru.
// Fáze 2: dohledat VoiceCall dle CallSid, doplnit délku + shrnutí (agent.summarize)
// a poslat push do Velína (services/push/expo-push.notifyPerson).
router.post('/status', form, (req, res) => {
  // TODO Fáze 2: shrnutí + push + (infolinka) založení leadu
  res.sendStatus(204);
});

module.exports = router;
