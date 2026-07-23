// =============================================================================
// HolyOS — Worker autonomního AI vedoucího obchodu
// =============================================================================
// Časované spouštění (tick 60 s, markery v Europe/Prague):
//   • 07:00  planDay pro každého obchodníka + push „Dnešní plán"
//   • 20:00  reviewDay pro každého + push „Hodnocení dne" → poté report majitelům
//   • neděle 20:05  reviewPeriod('week') za právě končící týden
//   • poslední den měsíce 20:10  reviewPeriod('month') s podkladem k výplatě
//
// Startuje z app.js: require('./services/sales/sales-manager-worker').start();
// Ruční spuštění: .runMorning() / .runEvening() / .runWeekly() / .runMonthly().
// Vypnutí: env SALES_MANAGER_DISABLED=1.

'use strict';

const { prisma } = require('../../config/database');
const mgr = require('../ai/sales-manager');
const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');

const TZ = process.env.VELIN_TZ || 'Europe/Prague';
const TICK_INTERVAL_MS = 60 * 1000;
const LINK = '/modules/obchodnik/index.html';
let _tick = null;
const _fired = {}; // marker -> dayKey
let _lastResult = null;

function tzToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function tzParts() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short', day: '2-digit', month: '2-digit' }).formatToParts(new Date());
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return { hour: Number(g('hour')), minute: Number(g('minute')), weekday: g('weekday'), day: Number(g('day')), month: Number(g('month')) };
}
function isLastDayOfMonth() {
  const now = new Date();
  const cur = tzToday();
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() + 86400000));
  return cur.slice(0, 7) !== tomorrow.slice(0, 7);
}

async function pushToPerson(personId, title, body, data) {
  try {
    await notifyPerson(prisma, personId, { title, body, data: Object.assign({ link: LINK }, data || {}), sound: 'default' });
  } catch (e) { /* push nesmí shodit worker */ }
  try {
    const p = await prisma.person.findUnique({ where: { id: personId }, select: { user_id: true } });
    if (p && p.user_id) await createNotification({ userId: p.user_id, type: 'system', title, body, link: LINK });
  } catch (e) { /* zvonek best-effort */ }
}

// ─── Denní plán (ráno) ─────────────────────────────────────────────────────
async function runMorning(dateStr, opts) {
  const ds = dateStr || tzToday();
  const force = !!(opts && opts.force);
  const people = (await mgr.getActiveSalespeople()).filter((p) => p.is_salesperson);
  let planned = 0;
  const detail = [];
  for (const p of people) {
    try {
      const r = await mgr.planDay(p.id, ds, { force });
      detail.push({ person_id: p.id, name: p.name, created: r.created, skipped: r.skipped });
      planned += 1;
      // Push jen když se plán reálně nově vygeneroval (created > 0) — catch-up po startu
      // tak nespamuje ty, kdo už plán mají.
      if (r && r.plan && r.created > 0) {
        const tasks = (r.plan.tasks || []).filter((t) => t.status === 'open');
        const title = '📋 Dnešní plán od AI vedoucího';
        const body = (r.plan.focus ? (r.plan.focus + '\n\n') : '') + tasks.length + ' úkolů na dnešek. Klepni pro otevření.';
        await pushToPerson(p.id, title, body, { type: 'sales_plan', date: ds });
        await prisma.salesDayPlan.update({ where: { id: r.plan.id }, data: { morning_pushed_at: new Date() } }).catch(() => {});
      }
    } catch (e) { console.error('[sales-worker] planDay person ' + p.id + ':', e.message); }
  }
  _lastResult = { kind: 'morning', at: new Date(), planned, detail };
  console.log(`[sales-worker] Ráno: naplánováno ${planned} obchodníkům (${ds}).`);
  return _lastResult;
}

// ─── Denní hodnocení + report majitelům (večer) ──────────────────────────────
async function runEvening(dateStr) {
  const ds = dateStr || tzToday();
  const people = (await mgr.getActiveSalespeople()).filter((p) => p.is_salesperson);
  let reviewed = 0;
  for (const p of people) {
    try {
      const rev = await mgr.reviewDay(p.id, ds);
      reviewed += 1;
      if (rev) {
        const title = '📊 Hodnocení dne — skóre ' + rev.score + (rev.grade ? (' · ' + rev.grade) : '');
        await pushToPerson(p.id, title, (rev.summary || '').slice(0, 300), { type: 'sales_review_day', date: ds });
      }
    } catch (e) { console.error('[sales-worker] reviewDay person ' + p.id + ':', e.message); }
  }
  let report = null;
  try { report = await mgr.reportToOwners(ds); } catch (e) { console.error('[sales-worker] reportToOwners:', e.message); }
  _lastResult = { kind: 'evening', at: new Date(), reviewed, report: !!report };
  console.log(`[sales-worker] Večer: zhodnoceno ${reviewed} obchodníků + report majitelům (${ds}).`);
  return _lastResult;
}

// ─── Týdenní / měsíční hodnocení ─────────────────────────────────────────────
async function runPeriod(kind, dateStr) {
  const ds = dateStr || tzToday();
  const people = (await mgr.getActiveSalespeople()).filter((p) => p.is_salesperson);
  let n = 0;
  for (const p of people) {
    try {
      const rev = await mgr.reviewPeriod(p.id, kind, ds);
      n += 1;
      if (rev) {
        const label = kind === 'month' ? 'Měsíční' : 'Týdenní';
        let body = (rev.summary || '').slice(0, 260);
        if (kind === 'month' && rev.pay_total != null) body += `\n\nNávrh odměny: ${rev.pay_total} ${rev.pay_currency || ''} (ke schválení vedoucím).`;
        await pushToPerson(p.id, `🏅 ${label} hodnocení — skóre ${rev.score}`, body, { type: 'sales_review_' + kind });
      }
    } catch (e) { console.error('[sales-worker] reviewPeriod ' + kind + ' person ' + p.id + ':', e.message); }
  }
  // Souhrn majitelům
  try {
    const notify = require('../compounder/notify');
    const label = kind === 'month' ? 'MĚSÍČNÍ' : 'TÝDENNÍ';
    await notify.notifyOwnersMessage(prisma, { title: `🏅 ${label} hodnocení obchodu hotové`, body: `AI vedoucí sestavil ${label.toLowerCase()} hodnocení pro ${n} obchodníků.` + (kind === 'month' ? ' Zkontroluj návrhy k výplatě na obrazovce vedoucího.' : ''), data: { type: 'sales_manager_period', kind } });
  } catch (e) { /* best effort */ }
  _lastResult = { kind, at: new Date(), reviewed: n };
  console.log(`[sales-worker] ${kind}: hotovo pro ${n} obchodníků (${ds}).`);
  return _lastResult;
}
async function runWeekly(dateStr) { return runPeriod('week', dateStr); }
async function runMonthly(dateStr) { return runPeriod('month', dateStr); }

// ─── Tick ────────────────────────────────────────────────────────────────────
async function fireOnce(marker, fn) {
  const key = tzToday();
  if (_fired[marker] === key) return;
  _fired[marker] = key;
  await fn();
}
async function tick() {
  try {
    const t = tzParts();
    if (t.hour === 7 && t.minute === 0) await fireOnce('morning', () => runMorning());
    if (t.hour === 20 && t.minute === 0) await fireOnce('evening', () => runEvening());
    if (t.hour === 20 && t.minute === 5 && t.weekday === 'Sun') await fireOnce('weekly', () => runWeekly());
    if (t.hour === 20 && t.minute === 10 && isLastDayOfMonth()) await fireOnce('monthly', () => runMonthly());
  } catch (e) { console.error('[sales-worker] tick:', e.message); }
}

function start() {
  if (process.env.SALES_MANAGER_DISABLED === '1') {
    console.log('[sales-worker] DISABLED via SALES_MANAGER_DISABLED=1');
    return;
  }
  if (_tick) return;
  console.log('[sales-worker] start — tick 60 s; 07:00 plán, 20:00 hodnocení+report, ne 20:05 týden, konec měsíce 20:10.');
  _tick = setInterval(tick, TICK_INTERVAL_MS);
  // Catch-up po startu serveru: pokud dnešní plány chybí, rozdej je automaticky
  // celému týmu (bez force → nepřepíše existující). Řeší i první nasazení během dne.
  if (process.env.SALES_MANAGER_CATCHUP !== '0') {
    setTimeout(() => {
      const key = tzToday();
      if (_fired.morning === key) return; // ranní běh už proběhl dnes
      _fired.morning = key;
      runMorning().catch((e) => console.error('[sales-worker] catch-up:', e.message));
    }, 20000);
  }
}
function stop() { if (_tick) { clearInterval(_tick); _tick = null; } }

module.exports = { start, stop, runMorning, runEvening, runWeekly, runMonthly, lastResult: () => _lastResult };
