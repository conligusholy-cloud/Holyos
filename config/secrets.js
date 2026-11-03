// HolyOS — Centrální tajné klíče. Bez záložních (veřejně známých) hodnot.
// V produkci chybějící JWT_SECRET zastaví start serveru; ve vývoji se vygeneruje náhodný klíč na dobu běhu procesu.
'use strict';
const crypto = require('crypto');

let devSecret = null;
function jwtSecret() {
  const s = process.env.JWT_SECRET || process.env.SECRET;
  if (s) {
    if (s.length < 24) console.warn('[SECURITY] JWT_SECRET je krátký (' + s.length + ' znaků) — doporučeno aspoň 32 náhodných znaků.');
    return s; // existující klíč nikdy neměníme, ať nepřestanou platit přihlášení
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('[SECURITY] Chybí JWT_SECRET — server se nespustí. Nastav ho v Railway Variables.');
    process.exit(1);
  }
  if (!devSecret) { devSecret = crypto.randomBytes(32).toString('hex'); console.warn('[SECURITY] JWT_SECRET není nastaven — používám náhodný dočasný klíč (po restartu přestanou platit přihlášení).'); }
  return devSecret;
}

// Porovnání tajných hodnot v konstantním čase (proti odhadování klíče měřením času odpovědi)
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const y = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(x, y) && String(a || '').length > 0;
}

module.exports = { jwtSecret, safeEqual };
