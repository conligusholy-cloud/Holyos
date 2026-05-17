// =============================================================================
// HolyOS — Velín scheduler (worker skeleton)
// =============================================================================
// Plánované akce pro Velín:
//   • 06:30 — vygeneruj DailyPlan pro každého aktivního zaměstnance s
//             registrovaným zařízením (zatím prázdný plán + převzaté úkoly
//             od vedoucích; integrace s plánovačem výroby přijde ve Fázi 4).
//   • 07:00 — pošli ranní push "Dobré ráno, máš N úkolů na dnešek".
//   • 30 min před due_at — pošli reminder pro každý úkol.
//   • 16:30 — pošli push k večerní reflexi.
//
// Pro Fázi 0 je tady jen kostra a interval-based smyčka (každých 60 sekund
// zkontroluje, jestli některý hour:minute marker právě uplynul). Až bude
// projekt přidávat node-cron jako dep, přepíšeme na cron expressions.
//
// V app.js se startuje:
//   require('./services/workers/velin-scheduler').start();

const { prisma } = require('../../config/database');
const { notifyPerson } = require('../push/expo-push');

const TICK_INTERVAL_MS = 60 * 1000; // 1 minuta — dostatečné rozlišení
let _tickHandle = null;
let _lastFiredAt = {}; // markerKey -> ISO date string (zabraňuje dvojím spuštěním v rámci minuty)

const MARKERS = [
  { key: 'morning_generate', h: 6, m: 30, handler: handleMorningGenerate },
  { key: 'morning_push',     h: 7, m: 0,  handler: handleMorningPush },
  { key: 'evening_push',     h: 16, m: 30, handler: handleEveningPush },
];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function handleMorningGenerate() {
  console.log('[velin-scheduler] 06:30 — generuj DailyPlan pro aktivní kolegy');
  try {
    // Najdi všechny aktivní lidi, kteří mají aktivní zařízení a ještě nemají
    // DailyPlan pro dnešek.
    const peopleWithDevice = await prisma.person.findMany({
      where: {
        active: true,
        velin_devices: { some: { active: true } },
      },
      select: { id: true },
    });
    const today = startOfToday();
    let created = 0;
    for (const p of peopleWithDevice) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await prisma.dailyPlan.findUnique({
        where: { person_id_date: { person_id: p.id, date: today } },
      });
      if (existing) continue;
      // eslint-disable-next-line no-await-in-loop
      await prisma.dailyPlan.create({
        data: {
          person_id: p.id,
          date: today,
          generated_by: 'system',
          status: 'draft',
        },
      });
      created += 1;
    }
    console.log(`[velin-scheduler] Vygenerováno ${created} nových plánů`);
  } catch (err) {
    console.error('[velin-scheduler] handleMorningGenerate selhal:', err);
  }
}

async function handleMorningPush() {
  console.log('[velin-scheduler] 07:00 — ranní push');
  try {
    const today = startOfToday();
    const plans = await prisma.dailyPlan.findMany({
      where: { date: today, morning_pushed_at: null },
      include: { _count: { select: { assignments: true } } },
    });
    for (const plan of plans) {
      const count = plan._count.assignments;
      const body = count === 0
        ? 'Dnes nemáš zatím přidělené žádné úkoly. Dobré ráno!'
        : `Dnes máš ${count} úkol${pluralCs(count)}. Pojďme na to!`;
      // eslint-disable-next-line no-await-in-loop
      await notifyPerson(prisma, plan.person_id, {
        title: 'Dobré ráno z Velína',
        body,
        data: { kind: 'morning_plan', plan_id: plan.id },
      });
      // eslint-disable-next-line no-await-in-loop
      await prisma.dailyPlan.update({
        where: { id: plan.id },
        data: { morning_pushed_at: new Date(), status: 'published' },
      });
    }
  } catch (err) {
    console.error('[velin-scheduler] handleMorningPush selhal:', err);
  }
}

async function handleEveningPush() {
  console.log('[velin-scheduler] 16:30 — večerní reflexe push');
  try {
    const today = startOfToday();
    const plans = await prisma.dailyPlan.findMany({
      where: { date: today, evening_pushed_at: null },
    });
    for (const plan of plans) {
      // eslint-disable-next-line no-await-in-loop
      await notifyPerson(prisma, plan.person_id, {
        title: 'Jak ti dnes šlo?',
        body: 'Vyplň krátkou reflexi — minuta tvého času pro lepší zítřek.',
        data: { kind: 'evening_reflection', plan_id: plan.id },
      });
      // eslint-disable-next-line no-await-in-loop
      await prisma.dailyPlan.update({
        where: { id: plan.id },
        data: { evening_pushed_at: new Date() },
      });
    }
  } catch (err) {
    console.error('[velin-scheduler] handleEveningPush selhal:', err);
  }
}

function pluralCs(n) {
  if (n === 1) return '';
  if (n >= 2 && n <= 4) return 'y';
  return 'ů';
}

async function tick() {
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  for (const marker of MARKERS) {
    if (marker.h === h && marker.m === m) {
      const dayKey = todayKey();
      if (_lastFiredAt[marker.key] === dayKey) continue; // už jsme dnes spustili
      _lastFiredAt[marker.key] = dayKey;
      // eslint-disable-next-line no-await-in-loop
      await marker.handler();
    }
  }
}

function start() {
  if (process.env.VELIN_SCHEDULER_DISABLED === '1') {
    console.log('[velin-scheduler] DISABLED via VELIN_SCHEDULER_DISABLED=1');
    return;
  }
  if (_tickHandle) return;
  console.log('[velin-scheduler] start — tick každých 60 s, markery 06:30 / 07:00 / 16:30');
  _tickHandle = setInterval(tick, TICK_INTERVAL_MS);
  // První tick hned, ať se nečeká plnou minutu po startu serveru.
  setTimeout(tick, 5000);
}

function stop() {
  if (_tickHandle) {
    clearInterval(_tickHandle);
    _tickHandle = null;
  }
}

module.exports = {
  start,
  stop,
  // Export pro testy / ruční trigger z admin UI
  handleMorningGenerate,
  handleMorningPush,
  handleEveningPush,
};
