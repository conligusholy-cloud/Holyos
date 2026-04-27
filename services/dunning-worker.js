// HolyOS — Cron worker pro automatické upomínky AR faktur (Fáze 7)
// =============================================================================
// Startuje z app.js. Tikne každý den v 08:00 lokálního času.
// Najde AR faktury po splatnosti, které ještě nedostaly upomínku dané úrovně,
// a pošle email z faktury@bestseries.cz (resp. INVOICE_IMAP_USER) přes Graph
// send-as. Šablony jsou v services/reminders/templates.js (multi-jazyk podle
// Company.country).
//
// Pause flag: AppSetting key="reminders_paused" hodnota "true" → worker tikne,
// ale nic nepošle (vrací { ok:true, paused:true }).
// =============================================================================

'use strict';

const { prisma } = require('../config/database');
const { sendMail } = require('./email');
const { buildReminder } = require('./reminders/templates');
const { logAudit } = require('./audit');
const { getOurCompany } = require('./settings');

let timer = null;
let running = false;
let lastRun = null;
let lastResult = null;

const REMINDER_DAYS = [
  { level: 1, threshold: 7 },
  { level: 2, threshold: 14 },
  { level: 3, threshold: 21 },
];

function getHourLocal() {
  return Number(process.env.REMINDER_HOUR_LOCAL || 8); // default 8:00 ráno
}

/**
 * Spočte ms do nejbližšího dalšího TIČKU v zadanou hodinu lokálního času.
 * Pokud je teď před hodinou X, čeká do dnešního X. Jinak do zítřejšího X.
 */
function msUntilNextTick(hourLocal) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hourLocal, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

/**
 * AppSetting reminders_paused — vrací true, pokud je worker pozastavený.
 */
async function isPaused() {
  try {
    const s = await prisma.appSetting.findUnique({ where: { key: 'reminders_paused' } });
    return s && (s.value === 'true' || s.value === '1');
  } catch {
    return false;
  }
}

/**
 * Hlavní logika — najde overdue AR faktury, pro každou určí level upomínky
 * a pokud ji ještě neposlala, pošle.
 */
async function processReminders() {
  const paused = await isPaused();
  if (paused) {
    return { ok: true, paused: true, sent: 0, errors: [] };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Stavy AR, které jsou kandidáty na upomínku:
  //   sent, reminder_1_sent, reminder_2_sent, overdue
  // Vyloučeno: paid, cancelled, written_off, draft
  const candidates = await prisma.invoice.findMany({
    where: {
      direction: 'ar',
      status: { in: ['sent', 'reminder_1_sent', 'reminder_2_sent', 'overdue'] },
      date_due: { lt: today },
    },
    include: {
      company: true,
      reminders: { select: { level: true, status: true, sent_at: true } },
    },
  });

  const ourCompany = await getOurCompany().catch(() => null);
  const us = {
    name: ourCompany?.name || 'Best Series s.r.o.',
    iban: ourCompany?.iban || null,
  };

  const stats = { sent: 0, skipped: 0, errors: [] };

  for (const inv of candidates) {
    // Faktura plně zaplacena? Přeskoč (paid_amount filtr výš jsme vyřadili pro Decimal porovnání)
    if (Number(inv.paid_amount) >= Number(inv.total)) continue;

    const due = new Date(inv.date_due);
    due.setHours(0, 0, 0, 0);
    const daysOverdue = Math.floor((today - due) / (1000 * 60 * 60 * 24));
    if (daysOverdue < REMINDER_DAYS[0].threshold) continue;

    // Najdi nejvyšší level, který už byl poslaný (status='sent')
    const sentLevels = inv.reminders.filter(r => r.status === 'sent').map(r => r.level);
    const maxSent = sentLevels.length ? Math.max(...sentLevels) : 0;

    // Najdi další level k odeslání (první neodeslaný splňující threshold)
    const nextStep = REMINDER_DAYS.find(s => s.level > maxSent && daysOverdue >= s.threshold);
    if (!nextStep) {
      stats.skipped++;
      continue;
    }

    // Email odběratele (z faktury preferovaně z order, jinak z Company)
    const toEmail = inv.company?.email;
    if (!toEmail) {
      stats.skipped++;
      stats.errors.push({ invoice_id: inv.id, reason: 'Company nemá email' });
      continue;
    }

    let built;
    try {
      built = buildReminder({
        level: nextStep.level,
        invoice: inv,
        partner: inv.company,
        us,
        today,
      });
    } catch (err) {
      stats.errors.push({ invoice_id: inv.id, reason: 'template: ' + err.message });
      continue;
    }

    // Záznam Reminder předem (zabrání duplicitnímu odeslání pokud worker tikne dvakrát)
    let reminder;
    try {
      reminder = await prisma.reminder.create({
        data: {
          invoice_id: inv.id,
          level: nextStep.level,
          scheduled_at: today,
          subject: built.subject,
          body: built.body,
          sent_to_email: toEmail,
          status: 'scheduled',
        },
      });
    } catch (err) {
      // Unikátní [invoice_id, level] mohlo selhat — někdo už záznam vytvořil
      stats.skipped++;
      continue;
    }

    // Odešli email
    const fromUpn = process.env.INVOICE_IMAP_USER || 'faktury@bestseries.cz';
    try {
      const result = await sendMail({
        to: toEmail,
        subject: built.subject,
        body: built.body,
        from: fromUpn,
      });
      if (result?.sent) {
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { status: 'sent', sent_at: new Date() },
        });
        // Update Invoice.reminder_X_sent_at + status
        const reminderField = `reminder_${nextStep.level}_sent_at`;
        const newStatus = nextStep.level === 1 ? 'reminder_1_sent'
          : nextStep.level === 2 ? 'reminder_2_sent'
          : 'reminder_3_sent';
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { [reminderField]: new Date(), status: newStatus },
        });
        await logAudit({
          action: 'reminder_sent', entity: 'invoice', entity_id: inv.id,
          description: `Upomínka ${nextStep.level}/${REMINDER_DAYS.length} (${built.language}) odeslána na ${toEmail}, ${built.days_overdue} dní po splatnosti`,
          user: null,
        }).catch(() => {});
        stats.sent++;
      } else {
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { status: 'bounced' },
        });
        stats.errors.push({ invoice_id: inv.id, reason: result?.skipped || 'email se nepodařilo odeslat' });
      }
    } catch (err) {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'bounced' },
      }).catch(() => {});
      stats.errors.push({ invoice_id: inv.id, reason: err.message });
    }
  }

  return { ok: true, paused: false, ...stats };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    lastRun = new Date();
    lastResult = await processReminders();
    if (lastResult.sent > 0 || lastResult.errors?.length > 0) {
      console.log(`[dunning-worker] Odesláno ${lastResult.sent} upomínek, ${lastResult.errors?.length || 0} chyb${lastResult.paused ? ' (PAUSED)' : ''}`);
    }
  } catch (err) {
    console.error('[dunning-worker] Tick selhal:', err);
    lastResult = { ok: false, error: err.message };
  } finally {
    running = false;
    scheduleNext();
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const ms = msUntilNextTick(getHourLocal());
  timer = setTimeout(tick, ms);
}

function start() {
  if (timer) return;
  const h = getHourLocal();
  console.log(`[dunning-worker] Start, denně v ${h}:00 lokálního času.`);
  scheduleNext();
}

function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
}

function status() {
  const h = getHourLocal();
  const next = new Date();
  next.setHours(h, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  return {
    running,
    hour_local: h,
    last_run: lastRun,
    next_run_at: next,
    last_result: lastResult,
  };
}

async function triggerNow() {
  await tick();
  return status();
}

module.exports = { start, stop, status, triggerNow, processReminders };
