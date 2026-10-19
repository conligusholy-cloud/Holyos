// HolyOS — SMS připomínka schůzky 15 minut předem (rezervace z /cesta)
// Každou minutu hledá aktivní rezervace, které začínají za ≤ 15 minut, a pošle jedinou SMS.
// Odeslané rezervace si pamatuje v AppSetting 'meeting.reminded_ids' (bez změny schématu).

const { prisma } = require('../../config/database');
const { getSetting, setSetting } = require('../settings');
const { vocativeFirstName } = require('../vocative');

const TICK_MS = 60 * 1000;
const REMIND_BEFORE_MS = 15 * 60 * 1000;
const KEY = 'meeting.reminded_ids';
let _tick = null;
let _busy = false;

async function tick() {
  if (_busy) return;
  _busy = true;
  try {
    const now = new Date();
    const until = new Date(now.getTime() + REMIND_BEFORE_MS);
    const rows = await prisma.meetingReservation.findMany({
      where: { status: 'booked', slot: { starts_at: { gt: now, lte: until } } },
      include: { slot: { select: { starts_at: true } } },
    });
    if (!rows.length) return;
    let reminded = await getSetting(KEY, { type: 'json', defaultValue: [] });
    if (!Array.isArray(reminded)) reminded = [];
    let changed = false;
    for (const r of rows) {
      if (reminded.indexOf(r.id) !== -1) continue;
      // Rezervace vytvořená méně než 15 min před začátkem — připomínka by byla zbytečná (SMS s potvrzením právě odešla).
      if (r.created_at && r.slot.starts_at.getTime() - new Date(r.created_at).getTime() < REMIND_BEFORE_MS) { reminded.push(r.id); changed = true; continue; }
      if (!r.phone) { reminded.push(r.id); changed = true; continue; }
      const t = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }).format(r.slot.starts_at);
      const first = vocativeFirstName(r.name);
      const text = (first ? first + ', připomínáme' : 'Připomínáme') + ': schůzka dnes v ' + t + ', online videohovor přes WhatsApp. Těšíme se na Vás.';
      // Nejdřív označit (ať se při pádu SMS nikdy neposílá dvakrát), pak odeslat
      reminded.push(r.id); changed = true;
      try {
        await setSetting(KEY, reminded.slice(-500), { type: 'json', description: 'ID rezervací schůzek, kterým už odešla SMS připomínka' });
        changed = false;
        await require('../voice/sms').sendSms(r.phone, text, { context: 'schuzka_pripominka', leadId: r.compounder_lead_id || undefined });
        console.log('[meeting-reminder] SMS připomínka odeslána, rezervace', r.id);
      } catch (e) { console.warn('[meeting-reminder] SMS rezervace ' + r.id + ' selhala:', e.message); }
    }
    if (changed) await setSetting(KEY, reminded.slice(-500), { type: 'json' });
  } catch (e) {
    console.warn('[meeting-reminder] tick:', e.message);
  } finally { _busy = false; }
}

function start() {
  if (process.env.MEETING_REMINDER_DISABLED === '1') { console.log('[meeting-reminder] DISABLED'); return; }
  if (_tick) return;
  console.log('[meeting-reminder] start — tick 60 s, SMS 15 min před schůzkou.');
  _tick = setInterval(tick, TICK_MS);
}
function stop() { if (_tick) { clearInterval(_tick); _tick = null; } }

module.exports = { start, stop, tick };
