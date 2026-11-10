// =============================================================================
// HolyOS — Worker pro hromadný přepočet nároku na dovolenou (požadavek #139)
// =============================================================================
// Startuje z app.js. Jednou za hodinu se podívá, jestli už nastalo datum
// z „Nastavení dovolených" (effective_from), a pokud ano a přepočet pro něj
// ještě neproběhl, spustí ho. Datum v budoucnu tedy počká, až nastane.
'use strict';

const rollover = require('./leave-rollover');

const INTERVAL_MS = 60 * 60 * 1000; // každou hodinu
let timer = null;
let lastRun = null;
let lastResult = null;

async function tick() {
  try {
    const r = await rollover.spustPokudJeCas();
    lastRun = new Date();
    if (r) {
      lastResult = r;
      console.log('[leave-rollover] přepočet proběhl pro ' + r.ucinnost_od.toISOString().slice(0, 10)
        + ' — zaměstnanců: ' + r.pocet);
    }
  } catch (e) {
    console.warn('[leave-rollover] přepočet selhal:', e.message);
    lastResult = { ok: false, error: e.message };
  }
}

function start() {
  if (timer) return;
  // Po startu chvíli počkáme, ať se server stihne rozběhnout.
  setTimeout(tick, 30 * 1000);
  timer = setInterval(tick, INTERVAL_MS);
  console.log('  Leave rollover worker: každou hodinu');
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }
function status() { return { running: !!timer, lastRun, lastResult }; }

module.exports = { start, stop, status, tick };
