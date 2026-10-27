// HolyOS — Platba přijatého dokladu přes QR kód (Czech QR Platba / SPD)
// Token v e-mailu: <invoiceId>.<exp>.<podpis> (HMAC, bez DB). Stav dokladu `qr_pending` = „platí se přes QR".
'use strict';
const crypto = require('crypto');

const SECRET = process.env.QR_PAY_SECRET || process.env.JWT_SECRET || process.env.SECRET || 'holyos-dev-secret-change-me';
const TTL_DAYS = 14;

// Stavy, ve kterých se doklad už platit nesmí / nemá (zaplaceno, zrušeno, na příkazu…)
const BLOCKED = {
  paid: 'Doklad je už zaplacený.',
  cancelled: 'Doklad je zrušený.',
  written_off: 'Doklad je odepsaný.',
  archived: 'Doklad je archivovaný.',
  payment_queued: 'Doklad je už na platebním příkazu — nic dalšího platit nemusíš (po nalezení ve výpisu se označí jako zaplacený).',
};

const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(id, exp) { return crypto.createHmac('sha256', SECRET).update('qrpay|' + id + '|' + exp).digest('base64url'); }
function makeToken(invoiceId, days) {
  const exp = Math.floor(Date.now() / 1000) + (days || TTL_DAYS) * 86400;
  return invoiceId + '.' + exp + '.' + sign(invoiceId, exp);
}
function verifyToken(token) {
  const m = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!m) return null;
  const id = parseInt(m[1], 10), exp = parseInt(m[2], 10);
  const want = sign(id, exp);
  const a = Buffer.from(m[3]), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (exp < Math.floor(Date.now() / 1000)) return { id, expired: true };
  return { id, expired: false };
}

// Tuzemský účet (prefix-číslo/banka) → IBAN
function czAccountToIban(acc) {
  const s = String(acc || '').replace(/\s+/g, '');
  if (/^CZ\d{22}$/i.test(s)) return s.toUpperCase();
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const bban = m[3] + String(m[1] || '').padStart(6, '0') + String(m[2]).padStart(10, '0');
  const num = (bban + 'CZ00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of num) rem = (rem * 10 + Number(ch)) % 97;
  return 'CZ' + String(98 - rem).padStart(2, '0') + bban;
}

const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();

/** SPD řetězec pro QR platbu. Vrací { spd, iban } nebo { error }. */
// Kontrolní součet IBAN (mod 97) — banky QR s neplatným IBANem zahodí a nevyplní nic
function ibanValid(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const n = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0; for (const ch of n) r = (r * 10 + Number(ch)) % 97;
  return r === 1;
}
function buildSpd(inv, remaining) {
  // Přednost má IBAN složený z čísla účtu (to se ověřuje proti podvodu); IBAN z dokladu jen když je platný
  // a nebo když tuzemský účet chybí. OCR občas IBAN přečte s posunutými číslicemi.
  const fromAcc = czAccountToIban(inv.partner_bank_account);
  const fromDoc = inv.partner_iban ? String(inv.partner_iban).replace(/\s+/g, '').toUpperCase() : null;
  let iban = null;
  if (fromAcc && ibanValid(fromAcc)) iban = fromAcc;
  else if (fromDoc && ibanValid(fromDoc)) iban = fromDoc;
  if (!iban) return { error: fromDoc ? 'IBAN na dokladu (' + fromDoc + ') má neplatný kontrolní součet a tuzemský účet chybí — oprav účet příjemce v detailu dokladu.' : 'Účet příjemce na dokladu není ve tvaru, ze kterého jde složit IBAN.' };
  const parts = ['SPD*1.0', 'ACC:' + iban, 'AM:' + Number(remaining).toFixed(2), 'CC:' + (inv.currency || 'CZK')];
  const digits = (v, n) => String(v || '').replace(/\D/g, '').slice(0, n);
  if (digits(inv.variable_symbol, 10)) parts.push('X-VS:' + digits(inv.variable_symbol, 10));
  if (digits(inv.constant_symbol, 10)) parts.push('X-KS:' + digits(inv.constant_symbol, 10));
  if (digits(inv.specific_symbol, 10)) parts.push('X-SS:' + digits(inv.specific_symbol, 10));
  const rn = ascii(inv.company && inv.company.name).slice(0, 35);
  if (rn) parts.push('RN:' + rn);
  // Jediné volné textové pole, které banky z QR opravdu převezmou, je „Zpráva pro příjemce" (MSG) — proto tam jde i „za co platím".
  // (Poznámka pro mě v SPAYD neexistuje.) Doklad + popis, max 60 znaků.
  const msg = ascii(['Uhrada ' + (inv.external_number || inv.invoice_number), inv.payment_note].filter(Boolean).join(' ')).slice(0, 60);
  if (msg) parts.push('MSG:' + msg);
  // „Poznámka pro mě" (zpráva pro plátce) = za co platím + dodavatel. Standard QR Platby: X-SELF, max 60 znaků.
  const self = ascii([inv.payment_note, inv.company && inv.company.name].filter(Boolean).join(' - ')).slice(0, 60);
  if (self) parts.push('X-SELF:' + self);
  return { spd: parts.join('*'), iban };
}

module.exports = { makeToken, verifyToken, czAccountToIban, ibanValid, buildSpd, BLOCKED, TTL_DAYS };
