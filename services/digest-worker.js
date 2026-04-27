// HolyOS — Cron worker pro týdenní bankovní digest
// =============================================================================
// Startuje z app.js. Default interval 7 dní (env DIGEST_INTERVAL_HOURS = 168).
// Příjemci: env DIGEST_RECIPIENTS (comma-separated emails)
//   nebo všechny aktivní Person s rolí 'accountant' nebo 'finance'.
//
// Pokud digest má 0 transakcí, e-mail se neodesílá (zbytečný spam).
// =============================================================================

'use strict';

const { prisma } = require('../config/database');
const { buildDigest } = require('./digest');
const { sendMail } = require('./email');

let timer = null;
let running = false;
let lastRun = null;
let lastResult = null;

function getIntervalMs() {
  const hours = Number(process.env.DIGEST_INTERVAL_HOURS || 168); // default 7 dní
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function getDays() {
  return Number(process.env.DIGEST_DAYS || 7);
}

/** Vrátí seznam e-mailových adres pro digest. */
async function resolveRecipients() {
  const envList = (process.env.DIGEST_RECIPIENTS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (envList.length > 0) return envList;

  // Fallback: aktivní Person s rolí účetní/finance (pokud Person model má roli;
  // jinak vrátíme prázdný seznam a worker odešle nic).
  try {
    const persons = await prisma.person.findMany({
      where: {
        active: true,
        email: { not: null },
        OR: [
          { role: { in: ['accountant', 'finance'] } },
          // Můžeme zde přidat jiné role v budoucnu
        ],
      },
      select: { email: true },
    });
    return persons.map(p => p.email).filter(Boolean);
  } catch {
    return [];
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    lastRun = new Date();
    const recipients = await resolveRecipients();

    if (recipients.length === 0) {
      lastResult = { ok: true, skipped: 'no-recipients', sent: 0 };
      return;
    }

    const digest = await buildDigest(prisma, { days: getDays() });

    if (digest.summary.total === 0) {
      lastResult = { ok: true, skipped: 'empty-digest', sent: 0 };
      return;
    }

    const link = '/modules/ucetni-doklady/index.html';
    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      const r = await sendMail({
        to,
        subject: digest.subject,
        body: digest.body,
        link,
        linkLabel: 'Otevřít účetní doklady',
        preheader: `${digest.summary.total} bankovních transakcí čeká na zpracování`,
      });
      if (r.sent) sent++;
      else failed++;
    }

    lastResult = {
      ok: true,
      sent,
      failed,
      summary: digest.summary,
      recipients_count: recipients.length,
    };
    if (sent > 0) {
      console.log(`[digest-worker] Odesláno ${sent} digestů (${digest.summary.total} transakcí).`);
    }
  } catch (err) {
    console.error('[digest-worker] Tick selhal:', err);
    lastResult = { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  const ms = getIntervalMs();
  console.log(`[digest-worker] Start, poll každých ${(ms / 3600000).toFixed(1)} h.`);
  timer = setInterval(tick, ms);
  // První spuštění po 60 sekundách (nech server nastartovat)
  setTimeout(tick, 60 * 1000);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function status() {
  const intervalMs = getIntervalMs();
  const nextRunAt = lastRun ? new Date(lastRun.getTime() + intervalMs) : null;
  return {
    running,
    interval_ms: intervalMs,
    interval_h: intervalMs / 3600000,
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
