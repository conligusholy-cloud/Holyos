// HolyOS — Cron worker pro periodický fetch faktur z e-mailu
// Startuje z app.js, default interval 5 min (INVOICE_POLL_MINUTES env)

const { fetchNew, isImapConfigured } = require('./email-ingest');

let timer = null;
let running = false;
let lastRun = null;
let lastResult = null;

function getIntervalMs() {
  const min = Number(process.env.INVOICE_POLL_MINUTES || 10);
  return Math.max(1, min) * 60 * 1000;
}

async function tick() {
  if (running) return; // překrývání běhů zakázáno
  running = true;
  try {
    lastRun = new Date();
    lastResult = await fetchNew({ markSeen: true, onlyRecent: true });
    const { ok, fetched, parsed, invoices_created, errors } = lastResult;
    if (ok && fetched > 0) {
      console.log(`[email-ingest-worker] Zpracováno ${parsed}/${fetched} zpráv, ${errors?.length || 0} chyb`);
    }
  } catch (err) {
    console.error('[email-ingest-worker] Tick selhal:', err);
    lastResult = { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  if (!isImapConfigured()) {
    console.log('[email-ingest-worker] Neběží — IMAP není nakonfigurovaný (chybí INVOICE_IMAP_USER/PASS).');
    return;
  }
  const ms = getIntervalMs();
  console.log(`[email-ingest-worker] Start, poll každých ${ms / 60000} min.`);
  timer = setInterval(tick, ms);
  // První spuštění po 30 sekundách (nech server nastartovat)
  setTimeout(tick, 30 * 1000);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function status() {
  const intervalMs = getIntervalMs();
  const nextRunAt = lastRun ? new Date(lastRun.getTime() + intervalMs) : null;
  return {
    running,
    configured: isImapConfigured(),
    interval_ms: intervalMs,
    last_run: lastRun,
    next_run_at: nextRunAt,
    last_result: lastResult,
  };
}

async function triggerNow() {
  await tick();
  return status();
}

module.exports = { start, stop, status, triggerNow };
