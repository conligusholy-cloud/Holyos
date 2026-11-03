// HolyOS — Jednoduchý rate limiter v paměti (bez závislostí)
// Okno + max pokusů na klíč; při překročení vrací 429 s Retry-After.
'use strict';

function createLimiter({ windowMs, max, keyFn, message }) {
  const hits = new Map(); // klíč → { n, reset }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 60000));
  if (timer.unref) timer.unref();

  function take(key) {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    e.n++;
    return { blocked: e.n > max, retryAfter: Math.ceil((e.reset - now) / 1000) };
  }
  function reset(key) { hits.delete(key); }

  const mw = (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const r = take(key);
    if (r.blocked) {
      res.set('Retry-After', String(r.retryAfter));
      return res.status(429).json({ error: message || 'Příliš mnoho pokusů. Zkuste to později.' });
    }
    next();
  };
  mw.reset = reset; mw.take = take;
  return mw;
}

module.exports = { createLimiter };
