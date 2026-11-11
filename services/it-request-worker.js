// =============================================================================
// HolyOS — Worker: IT požadavky nevyplněné zákazníkem v termínu → upozornění Radkovi Bečkovi
// =============================================================================
// Poll každých 30 minut: požadavky ve stavu „sent" s prošlým termínem (výchozí 3 dny) a bez odeslaného upozornění.
// Upozornění jde jednou: e-mail + push do Velína + zvonek v HolyOS (logika v services/orders/it-request.js).

'use strict';

const POLL_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;
let _timer = null; let _running = false;

async function runOnce() {
  if (_running) return;
  _running = true;
  try {
    const r = await require('./orders/it-request').sweepOverdue();
    if (r && r.notified) console.log('[it-request-worker] upozorněno na ' + r.notified + ' nevyplněných IT požadavků');
  } catch (err) { console.error('[it-request-worker] run selhal:', err && err.message); }
  finally { _running = false; }
}

function start() {
  console.log('[it-request-worker] Start, poll každých ' + POLL_INTERVAL_MS / 60000 + ' min.');
  setTimeout(() => { runOnce(); _timer = setInterval(runOnce, POLL_INTERVAL_MS); }, STARTUP_DELAY_MS);
}
function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { start, stop, runOnce };
