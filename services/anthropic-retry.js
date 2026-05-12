// =============================================================================
// HolyOS — Anthropic SDK retry wrapper
// =============================================================================
// Obaluje `client.messages.create(params)` exponenciálním backoffem pro
// rate_limit_error (429) a overloaded (529). Čte `retry-after` hlavičku, pokud
// API ji vrátí, jinak používá exponenciální delay (2 s → 4 s → 8 s → 16 s).
//
// Použití:
//   const { messagesCreate } = require('../anthropic-retry');
//   const response = await messagesCreate(client, { model, max_tokens, ... });
//
// Důvody:
// - Tier 1 limit (30k ITPM) snadno spadne, pokud běží paralelně víc volání.
// - Při 429 SDK vyhodí, runner padl a úkol skončil failed.
// - Stojí stejně jako jeden retry, ale šetří celý běh.

const DEFAULT_MAX_ATTEMPTS = parseInt(process.env.ANTHROPIC_RETRY_MAX_ATTEMPTS || '4', 10);
const DEFAULT_BASE_DELAY_MS = parseInt(process.env.ANTHROPIC_RETRY_BASE_MS || '2000', 10);
const DEFAULT_MAX_DELAY_MS = parseInt(process.env.ANTHROPIC_RETRY_MAX_MS || '60000', 10);

function isRetryableError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status === 429 || status === 529) return true;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  // SDK občas serializuje status jen do message
  const msg = err.message || '';
  if (/rate_limit_error/i.test(msg)) return true;
  if (/overloaded_error/i.test(msg)) return true;
  return false;
}

function getRetryAfterMs(err) {
  // Anthropic SDK vystavuje response headers v err.headers
  const headers = err?.headers || err?.response?.headers || {};
  const raw =
    headers['retry-after'] ||
    headers['Retry-After'] ||
    headers['anthropic-ratelimit-input-tokens-reset'] ||
    null;
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return null;
  return Math.max(0, seconds * 1000);
}

async function messagesCreate(client, params, options = {}) {
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const baseDelay = options.baseDelayMs || DEFAULT_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs || DEFAULT_MAX_DELAY_MS;
  const label = options.label || 'anthropic';

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableError(err);
      const isLast = attempt === maxAttempts - 1;
      if (!retryable || isLast) throw err;

      const exponential = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const retryAfter = getRetryAfterMs(err);
      const wait = retryAfter ? Math.max(retryAfter, baseDelay) : exponential;

      const status = err.status || err.statusCode || '?';
      console.warn(
        `[${label}] ${status} ${err.message?.slice(0, 120) || 'retryable'} — retry ${attempt + 1}/${maxAttempts} za ${wait}ms`
      );

      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // Defensive — sem se reálně nedostaneme (throw v isLast), ale ESLint
  throw lastErr;
}

module.exports = {
  messagesCreate,
  isRetryableError,
};
