// HolyOS — Politika povinného 2FA pro všechny uživatele
// Nastavení v AppSetting 'security.require_2fa' = { enabled, since (ISO), grace_days, exempt: [username,...] }.
// Dokud není enabled, nic se nevynucuje. Po zapnutí běží odklad (grace_days), potom bez 2FA jen stránka Zabezpečení účtu.
'use strict';
const { getSetting, setSetting } = require('./settings');

const KEY = 'security.require_2fa';
const DEFAULT = { enabled: false, since: null, grace_days: 7, exempt: [] };
let cache = null, cacheAt = 0;

async function getPolicy() {
  if (cache && Date.now() - cacheAt < 15000) return cache;
  let v = null;
  try { v = await getSetting(KEY, { type: 'json', defaultValue: null }); } catch (e) { v = null; }
  cache = Object.assign({}, DEFAULT, v && typeof v === 'object' ? v : {});
  cache.exempt = Array.isArray(cache.exempt) ? cache.exempt.map((x) => String(x).toLowerCase()) : [];
  cacheAt = Date.now();
  return cache;
}
async function setPolicy(p) {
  const cur = await getPolicy();
  const next = {
    enabled: p.enabled !== undefined ? !!p.enabled : cur.enabled,
    since: cur.since,
    grace_days: p.grace_days !== undefined ? Math.max(0, Math.min(90, parseInt(p.grace_days, 10) || 0)) : cur.grace_days,
    exempt: Array.isArray(p.exempt) ? p.exempt.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : cur.exempt,
  };
  if (next.enabled && !cur.enabled) next.since = new Date().toISOString(); // odklad běží od zapnutí
  if (!next.enabled) next.since = null;
  await setSetting(KEY, next, { type: 'json', scope: 'security' });
  cache = null;
  return getPolicy();
}

// Stav pro konkrétního uživatele: { required, enabled, enforced, grace_days_left }
async function statusFor(user) {
  const p = await getPolicy();
  const has = !!user.totp_enabled;
  const exempt = p.exempt.includes(String(user.username || '').toLowerCase());
  if (!p.enabled || has || exempt) return { required: p.enabled && !exempt, enabled: has, enforced: false, grace_days_left: null };
  const deadline = new Date(p.since || Date.now()).getTime() + p.grace_days * 86400000;
  const left = Math.ceil((deadline - Date.now()) / 86400000);
  return { required: true, enabled: false, enforced: Date.now() > deadline, grace_days_left: Math.max(0, left) };
}

module.exports = { getPolicy, setPolicy, statusFor };
