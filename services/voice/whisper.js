// =============================================================================
// HolyOS — Přepis nahrávky hovoru přes OpenAI Whisper (řeč → text).
// Pro Infolinku: umožní přepsat CELÝ hovor včetně části zákazník–technik
// (ConversationRelay přepisuje jen AI část; zbytek je jen v nahrávce).
// Env: OPENAI_API_KEY.
// =============================================================================
const fs = require('fs');

function isConfigured() { return !!process.env.OPENAI_API_KEY; }

// Přepíše lokální audio soubor (mp3) na text. Vrací string (přepis).
async function transcribeFile(filePath, opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Chybí OPENAI_API_KEY');
  if (/^sk-ant/i.test(key)) throw new Error('OPENAI_API_KEY vypadá jako Anthropic klíč (sk-ant-…). Whisper je od OpenAI — vlož OpenAI klíč z platform.openai.com/api-keys.');
  if (!fs.existsSync(filePath)) throw new Error('Nahrávka nenalezena na disku');
  const size = fs.statSync(filePath).size;
  if (size > 25 * 1024 * 1024) throw new Error('Nahrávka je větší než 25 MB (limit Whisper)');
  const buf = fs.readFileSync(filePath);
  const { Blob } = require('buffer');
  const model = process.env.OPENAI_WHISPER_MODEL || 'whisper-1';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'hovor.mp3');
  fd.append('model', model);
  fd.append('language', opts.language || 'cs');
  fd.append('response_format', 'text');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key },
    body: fd,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('Whisper ' + r.status + ': ' + String(t).slice(0, 300));
  }
  return String(await r.text()).trim();
}

module.exports = { isConfigured, transcribeFile };
