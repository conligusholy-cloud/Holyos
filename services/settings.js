// HolyOS — App Settings helper
// =============================================================================
// Universální key/value čtení/zápis pro user-configurable parametry.
//
// Klíče používáme dot-notation per modul:
//   "accounting.payment_batch.approval_limit_czk"
//   "accounting.invoice.default_due_days"
//   "banking.kpc.file_seq_today"
//
// Hodnoty jsou v DB stringy; getter umí cast na number/boolean/json přes
// value_type column nebo explicit parametr.
//
// Fallback chain pro getSetting:
//   1) AppSetting v DB (pokud existuje)
//   2) process.env[ENV_NAME] (pokud parametr envFallback předán)
//   3) defaultValue
//
// Toto pořadí umožňuje per-projekt override v .env a runtime override v UI.
// =============================================================================

'use strict';

const { prisma } = require('../config/database');

// In-memory cache (per-instance, malý TTL). Settings se nemění často,
// nemá smysl zatěžovat DB při každém requestu.
const _cache = new Map(); // key -> { value, expiresAt }
const CACHE_TTL_MS = 30 * 1000; // 30 s

function _getCache(key) {
  const hit = _cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function _setCache(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function _invalidate(key) {
  _cache.delete(key);
}

/** Cast string z DB na typovanou hodnotu dle value_type. */
function _cast(rawValue, valueType) {
  if (rawValue === null || rawValue === undefined) return null;
  switch ((valueType || 'string').toLowerCase()) {
    case 'number':
    case 'int':
    case 'integer':
    case 'float':
    case 'decimal': {
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
    case 'bool':
      return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
    case 'json':
      try { return JSON.parse(rawValue); } catch { return null; }
    case 'string':
    default:
      return String(rawValue);
  }
}

/**
 * Načti hodnotu nastavení.
 *
 * @param {string} key                Klíč, např. "accounting.payment_batch.approval_limit_czk"
 * @param {Object} [opts]
 * @param {*}      [opts.defaultValue]  Pokud key v DB ani v env neexistuje
 * @param {string} [opts.envFallback]   Název env proměnné (např. "PAYMENT_BATCH_APPROVAL_LIMIT_CZK")
 * @param {string} [opts.type]          Override value_type (string|number|boolean|json)
 * @returns {Promise<*>}
 */
async function getSetting(key, opts = {}) {
  if (!key) throw new Error('getSetting: chybí key');

  // 1) Cache hit
  const cached = _getCache(key);
  if (cached !== undefined) return cached;

  // 2) DB lookup
  const row = await prisma.appSetting.findUnique({ where: { key } }).catch(() => null);
  if (row) {
    const v = _cast(row.value, opts.type || row.value_type);
    _setCache(key, v);
    return v;
  }

  // 3) Env fallback
  if (opts.envFallback) {
    const envVal = process.env[opts.envFallback];
    if (envVal !== undefined && envVal !== '') {
      const v = _cast(envVal, opts.type || 'string');
      _setCache(key, v);
      return v;
    }
  }

  // 4) Default
  const def = opts.defaultValue !== undefined ? opts.defaultValue : null;
  _setCache(key, def);
  return def;
}

/**
 * Zapiš hodnotu nastavení (upsert).
 *
 * @param {string} key
 * @param {*}      value
 * @param {Object} [opts]
 * @param {string} [opts.type]         "string"|"number"|"boolean"|"json"
 * @param {string} [opts.description]
 * @param {string} [opts.scope]
 * @param {number} [opts.userId]       Kdo to změnil (pro audit)
 */
async function setSetting(key, value, opts = {}) {
  if (!key) throw new Error('setSetting: chybí key');
  const type = opts.type || (
    typeof value === 'number' ? 'number'
    : typeof value === 'boolean' ? 'boolean'
    : (value && typeof value === 'object') ? 'json'
    : 'string'
  );
  const stored = type === 'json' ? JSON.stringify(value) : String(value);

  await prisma.appSetting.upsert({
    where: { key },
    update: {
      value: stored,
      value_type: type,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
      ...(opts.userId ? { updated_by_user_id: opts.userId } : {}),
    },
    create: {
      key,
      value: stored,
      value_type: type,
      description: opts.description || null,
      scope: opts.scope || null,
      updated_by_user_id: opts.userId || null,
    },
  });

  _invalidate(key);
}

/**
 * Vypiš všechna nastavení (volitelně filtrovaná podle scope).
 */
async function listSettings(scope) {
  const where = scope ? { scope } : {};
  const rows = await prisma.appSetting.findMany({
    where,
    orderBy: [{ scope: 'asc' }, { key: 'asc' }],
  });
  return rows.map(r => ({
    ...r,
    typed_value: _cast(r.value, r.value_type),
  }));
}

/** Smazat nastavení (vrátí na default + env fallback). */
async function deleteSetting(key) {
  await prisma.appSetting.delete({ where: { key } }).catch(() => null);
  _invalidate(key);
}

// ─── Předdefinované konvence pro modul Účetní doklady ───────────────────────
//
// Wrapper kolem getSetting — drží zde jediný zdroj pravdy o klíčích a
// env-fallbacích, aby se nehledaly napříč codebase.

const KEY_APPROVAL_LIMIT = 'accounting.payment_batch.approval_limit_czk';
const KEY_OUR_COMPANY_ID  = 'accounting.our_company_id';
const KEY_INVOICE_DUE_DAYS = 'accounting.invoice.default_due_days';

/**
 * Vrátí limit (Kč), nad kterým PaymentBatch vyžaduje super admin potvrzení.
 * 0 = bez limitu (vypnuto). Výchozí stav projektu.
 */
async function getPaymentBatchApprovalLimit() {
  const v = await getSetting(KEY_APPROVAL_LIMIT, {
    envFallback: 'PAYMENT_BATCH_APPROVAL_LIMIT_CZK',
    type: 'number',
    defaultValue: 0,
  });
  return Number(v) || 0;
}

/**
 * Vrátí Company záznam, který reprezentuje **nás** (dodavatel u AR faktur,
 * odběratel u AP faktur). Tomáš nastaví `accounting.our_company_id` v UI nebo
 * přes Prisma Studio. Fallback: env OUR_COMPANY_ID, jinak null.
 *
 * @returns {Promise<Object|null>} Company objekt nebo null pokud nenastavená
 */
async function getOurCompany() {
  const id = await getSetting(KEY_OUR_COMPANY_ID, {
    envFallback: 'OUR_COMPANY_ID',
    type: 'number',
  });
  if (!id) return null;
  return prisma.company.findUnique({
    where: { id: Number(id) },
  }).catch(() => null);
}

/**
 * Default počet dní splatnosti pro nově vystavené faktury.
 * env: INVOICE_DEFAULT_DUE_DAYS, default 14.
 */
async function getDefaultInvoiceDueDays() {
  const v = await getSetting(KEY_INVOICE_DUE_DAYS, {
    envFallback: 'INVOICE_DEFAULT_DUE_DAYS',
    type: 'number',
    defaultValue: 14,
  });
  return Number(v) || 14;
}

module.exports = {
  getSetting,
  setSetting,
  listSettings,
  deleteSetting,
  // Convenience accessors
  getPaymentBatchApprovalLimit,
  getOurCompany,
  getDefaultInvoiceDueDays,
  KEYS: {
    PAYMENT_BATCH_APPROVAL_LIMIT: KEY_APPROVAL_LIMIT,
    OUR_COMPANY_ID: KEY_OUR_COMPANY_ID,
    INVOICE_DUE_DAYS: KEY_INVOICE_DUE_DAYS,
  },
};
