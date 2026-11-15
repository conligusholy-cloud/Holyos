// HolyOS — Laundromats Milionář: přítomnost hráčů (kdo má hru právě otevřenou)
// Ukládání stavu se na pozadí (skrytá záložka) zastaví a i jinak se děje jen
// po akcích, takže z něj nejde poznat, kdo u hry opravdu sedí. Tady se drží
// lehké „tepy" z otevřené hry — ty chodí pořád, i ze schované záložky.
// Jen v paměti: po restartu serveru se do půl minuty zaplní znovu.
'use strict';
const seen = new Map();   // playerId -> { t: poslední tep, v: poslední tep s hrou na očích }
function ping(id, vidim) {
  if (!id) return;
  const ted = Date.now();
  const z = seen.get(Number(id)) || { t: 0, v: 0 };
  z.t = ted;
  if (vidim) z.v = ted;
  seen.set(Number(id), z);
  // Kdo se neozval hodinu, ať nedrží paměť.
  if (seen.size > 500) {
    for (const [k, x] of seen) if (ted - x.t > 3600e3) seen.delete(k);
  }
}
// Vrací [{ id, t, v }] pro ty, kdo se ozvali za posledních maxMs.
function recent(maxMs) {
  const ted = Date.now(), lim = ted - maxMs, out = [];
  for (const [id, x] of seen) {
    if (x.t >= lim) out.push({ id, t: x.t, v: x.v });
    else if (ted - x.t > 3600e3) seen.delete(id);
  }
  return out;
}
module.exports = { ping, recent };
