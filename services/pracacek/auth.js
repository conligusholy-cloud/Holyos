// =============================================================================
// HolyOS — Pracáček: auth helpers (aktivační kód, PIN, device token)
// =============================================================================
// Aktivační flow:
//   1) Admin v HolyOS klikne "Aktivovat zařízení" pro Person → vygenerujeme
//      6-místný numerický kód + expiraci (default 24 h) a uložíme do Person.
//   2) Kolega kód zadá v mobilní aplikaci spolu s vlastním PIN (4–6 číslic).
//   3) Server ověří kód+expiraci, uloží bcrypt hash PINu do Person, vygeneruje
//      device_token (UUID) → odpoví push_token registrací do DeviceRegistration.
//      Hash device_tokenu zůstává v DB; plain token vidí jen aplikace v keychainu.
//   4) Pro každý další request mobil posílá Authorization: Bearer <device_token>.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ACTIVATION_TTL_HOURS = parseInt(process.env.PRACACEK_ACTIVATION_TTL_HOURS || '24', 10);
const PIN_MIN_LEN = 4;
const PIN_MAX_LEN = 8;

/**
 * Vygeneruje 6-místný numerický aktivační kód. Lidsky čitelný a snadno
 * zadatelný do mobilu i v terénu (žádné O/0/I/1 zmatky — jen čísla).
 */
function generateActivationCode() {
  // crypto.randomInt je rovnoměrné; nepoužíváme Math.random kvůli auditu.
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

/**
 * Vygeneruje raw device token (32 znaků hex). Plain hodnotu pošleme aplikaci,
 * v DB držíme jen bcrypt hash → kompromitace DB neumožní podvržení mobilu.
 */
function generateDeviceToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function hashSecret(secret) {
  return bcrypt.hash(String(secret), 10);
}

async function verifySecret(secret, hash) {
  if (!hash) return false;
  try {
    return await bcrypt.compare(String(secret), hash);
  } catch {
    return false;
  }
}

function activationExpiresAt(hoursFromNow = ACTIVATION_TTL_HOURS) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

function isPinValidFormat(pin) {
  const s = String(pin || '');
  if (!/^\d+$/.test(s)) return false;
  return s.length >= PIN_MIN_LEN && s.length <= PIN_MAX_LEN;
}

module.exports = {
  generateActivationCode,
  generateDeviceToken,
  hashSecret,
  verifySecret,
  activationExpiresAt,
  isPinValidFormat,
  ACTIVATION_TTL_HOURS,
  PIN_MIN_LEN,
  PIN_MAX_LEN,
};
