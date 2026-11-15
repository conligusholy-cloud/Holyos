// HolyOS — Laundromats Milionář: přítomnost hráčů (kdo má hru právě otevřenou)
// Ukládání stavu se na pozadí (skrytá záložka) zastaví, proto hráč, který má hru
// otevřenou jinde, vypadal jako offline. Tady si pamatujeme lehké "tepy" z otevřené hry
// i ze skryté záložky. Jen v paměti — po restartu se zaplní do minuty.
'use strict';
const seen = new Map(); // playerId -> ms poslední tep
function ping(id) { if (id) seen.set(Number(id), Date.now()); }
function recent(maxMs) {
  const lim = Date.now() - maxMs, out = [];
  for (const [id, t] of seen) { if (t >= lim) out.push({ id, t }); else if (t < Date.now() - 3600e3) seen.delete(id); }
  return out;
}
module.exports = { ping, recent };
