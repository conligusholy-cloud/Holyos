// HolyOS — TOTP (RFC 6238) bez externích závislostí + zálohovací kódy + šifrování secretu v DB
'use strict';
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function base32Decode(str) {
  let bits = '';
  for (const c of String(str).replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; bits += i.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

function hotp(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1000000).padStart(6, '0');
}
// Ověří 6místný kód; tolerance ±1 okno (30 s) kvůli posunu hodin
function verify(secretB32, code, now) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor((now || Date.now()) / 30000);
  for (let w = -1; w <= 1; w++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secretB32, step + w)), Buffer.from(c))) return true;
  }
  return false;
}
function otpauthUri(secretB32, account, issuer) {
  const iss = issuer || 'HolyOS';
  return 'otpauth://totp/' + encodeURIComponent(iss + ':' + account) + '?secret=' + secretB32 + '&issuer=' + encodeURIComponent(iss) + '&algorithm=SHA1&digits=6&period=30';
}

// ── Šifrování secretu (AES-256-GCM); klíč TOTP_ENC_KEY, jinak odvozený z JWT secretu ──
function encKey() {
  const base = process.env.TOTP_ENC_KEY || require('../config/secrets').jwtSecret();
  return crypto.createHash('sha256').update('totp:' + base).digest();
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(stored) {
  const s = String(stored || '');
  if (!s.startsWith('v1:')) return null;
  try {
    const raw = Buffer.from(s.slice(3), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

// ── Zálohovací kódy (jednorázové, v DB jen hash) ──
function generateBackupCodes(n) {
  const codes = [];
  for (let i = 0; i < (n || 8); i++) codes.push(crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})(.{5})/, '$1-$2'));
  return codes;
}
const hashCode = (c) => crypto.createHash('sha256').update(String(c).replace(/[^A-Z0-9]/gi, '').toUpperCase()).digest('hex');

module.exports = { generateSecret, verify, otpauthUri, encrypt, decrypt, generateBackupCodes, hashCode, hotp };
