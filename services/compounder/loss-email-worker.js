// =============================================================================
// HolyOS — Compounder: týdenní automatická rozesílka e-mailu „se ztrátou"
// =============================================================================
// Každý ČTVRTEK ve 21:00 (Europe/Prague) pošle e-mail s aktuální ušlou částkou
// každému AKTIVNÍMU leadovi. „Aktivní" = byl aspoň jednou v portálu — tvrdé
// pravidlo hlídá sdílená funkce sendLossEmailForLead (portal_view), plus
// nevlastní lokalitu. Uložený model NENÍ podmínka: komu chybí, spočítá se ztráta
// z celé zpřístupněné nabídky. Nikomu, kdo v portálu nebyl, e-mail nikdy nedorazí.
//
// Startuje z app.js: require('./services/compounder/loss-email-worker').start();
// Ruční spuštění: .runNow(). Vypnutí: env LOSS_EMAIL_DISABLED=1.
// Ladění: LOSS_EMAIL_DAY (Mon..Sun, default Thu), LOSS_EMAIL_HOUR (21), LOSS_EMAIL_MIN (0).

'use strict';

const { prisma } = require('../../config/database');

const TZ = process.env.VELIN_TZ || 'Europe/Prague';
const TICK_INTERVAL_MS = 60 * 1000;
const DAY = process.env.LOSS_EMAIL_DAY || 'Thu';
const HOUR = Number(process.env.LOSS_EMAIL_HOUR || 21);
const MIN = Number(process.env.LOSS_EMAIL_MIN || 0);
let _tick = null;
let _lastFired = null;
let _last = null;

function tzParts() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date());
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return { hour: Number(g('hour')), minute: Number(g('minute')), weekday: g('weekday') };
}
function tzDayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

let _running = false;
// opts.skipSentWithinHours: nepřeposílat leadům, kterým loss e-mail odešel za posledních
// N hodin (kvůli ručnímu „doposlání" bez duplicit). 0/undefined = poslat všem kandidátům.
async function runNow(opts) {
  opts = opts || {};
  if (_running) { console.warn('[loss-email] Rozesílka už běží — druhý běh přeskočen.'); return { ok: false, busy: true }; }
  _running = true;
  try {
    let sendFn = null;
    try { sendFn = require('../../routes/compounder.routes').sendLossEmailForLead; } catch (e) { /* ignore */ }
    if (typeof sendFn !== 'function') { console.error('[loss-email] sendLossEmailForLead není dostupná.'); return { ok: false }; }
    // Kandidáti: všichni leadi s e-mailem. Uložený model NENÍ podmínka — komu chybí,
    // spočítá se ztráta z celé zpřístupněné nabídky (usedWholeOffer). Tvrdé strážce
    // dořeší sama funkce: musel být v portálu (portal_view), nesmí vlastnit lokalitu
    // a musí jít spočítat nenulový roční výnos.
    const leads = await prisma.compounderLead.findMany({
      where: { email: { not: null } },
      select: { id: true }, take: 5000,
    }).catch(() => []);
    // Nepřeposílat těm, kdo loss e-mail dostali v posledních N hodinách.
    const skipHours = Number(opts.skipSentWithinHours) || 0;
    const recent = new Set();
    if (skipHours > 0) {
      const since = new Date(Date.now() - skipHours * 3600 * 1000);
      const evs = await prisma.compounderEvent.findMany({
        where: { event: 'loss_email_sent', created_at: { gte: since } }, select: { props: true }, take: 20000,
      }).catch(() => []);
      evs.forEach((e) => { const lid = e.props && e.props.lead_id; if (lid != null) recent.add(lid); });
    }
    const toProcess = leads.filter((l) => !recent.has(l.id));
    const skippedRecent = leads.length - toProcess.length;
    // Náhled bez odeslání: nic neposílá, jen spočítá kolik by se zkusilo (finální
    // strážce portal_view/owned/yield se uplatní až při reálném odeslání).
    if (opts.dryRun) {
      _last = { at: new Date(), dryRun: true, candidates: leads.length, skippedRecent, wouldAttempt: toProcess.length };
      console.log(`[loss-email] DRY-RUN: kandidátů ${leads.length}, nedávno posláno ${skippedRecent}, zkusilo by se odeslat ${toProcess.length}.`);
      return _last;
    }
    let sent = 0, skipped = 0, failed = 0;
    for (const l of toProcess) {
      try {
        const r = await sendFn(l.id);
        if (r && r.ok) sent++; else skipped++;
      } catch (e) { failed++; console.error('[loss-email] lead ' + l.id + ':', e.message); }
    }
    _last = { at: new Date(), sent, skipped, failed, skippedRecent, candidates: leads.length };
    console.log(`[loss-email] Rozesílka: odesláno ${sent}, přeskočeno ${skipped}, nedávno posláno ${skippedRecent}, chyb ${failed} (z ${leads.length} kandidátů).`);
    return _last;
  } finally { _running = false; }
}

async function tick() {
  try {
    const t = tzParts();
    if (t.weekday === DAY && t.hour === HOUR && t.minute === MIN) {
      const key = tzDayKey();
      if (_lastFired === key) return;
      _lastFired = key;
      await runNow();
    }
  } catch (e) { console.error('[loss-email] tick:', e.message); }
}

function start() {
  if (process.env.LOSS_EMAIL_DISABLED === '1') { console.log('[loss-email] DISABLED via LOSS_EMAIL_DISABLED=1'); return; }
  if (_tick) return;
  console.log('[loss-email] start — tick 60 s, marker ' + DAY + ' ' + HOUR + ':' + ('0' + MIN).slice(-2) + ', týdenní rozesílka e-mailu se ztrátou aktivním leadům.');
  _tick = setInterval(tick, TICK_INTERVAL_MS);
}
function stop() { if (_tick) { clearInterval(_tick); _tick = null; } }

module.exports = { start, stop, runNow, lastResult: () => _last };
