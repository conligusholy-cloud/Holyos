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
      const text = (first ? first + ', připomínáme' : 'Připomínáme') + ': schůzka dnes v ' + t + ', online videohovor. Těšíme se na Vás.';
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

// ─── Nedorazil → po 20 minutách (pokud se stav mezi tím nezměnil) automatický e-mail s odkazem na nový termín ───
const NOSHOW_KEY = 'meeting.noshow_pending';
const NOSHOW_DELAY_MS = 20 * 60 * 1000;
let _nsBusy = false;

async function _loadPending() {
  const v = await getSetting(NOSHOW_KEY, { type: 'json', defaultValue: [] });
  return Array.isArray(v) ? v : [];
}
// Zavolá se při kliknutí na „Nedorazil" (a stav se tím zapíše)
async function markNoShow(id) {
  const list = (await _loadPending()).filter((x) => x.id !== id);
  list.push({ id, at: Date.now() });
  await setSetting(NOSHOW_KEY, list.slice(-200), { type: 'json', description: 'Rezervace označené „nedorazil" čekající na e-mail s novým termínem' });
}
// Jakákoli jiná změna stavu čekající e-mail zruší
async function clearNoShow(id) {
  const cur = await _loadPending();
  const list = cur.filter((x) => x.id !== id);
  if (list.length !== cur.length) await setSetting(NOSHOW_KEY, list, { type: 'json' });
}

async function _sendNoShowMail(r) {
  const first = vocativeFirstName(r.name);
  const base = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
  const when = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(r.slot.starts_at);
  const subject = 'Schůzka se dnes nekonala — vyberte si nový termín';
  const body = (first ? 'Dobrý den, ' + first + ',' : 'Dobrý den,') + '\n\nschůzka domluvená na ' + when + ' se bohužel neuskutečnila a nepodařilo se nám spojit. Nic se neděje — stává se to.\n\nPokud o prádlomat stále stojíte, stačí si jedním kliknutím vybrat nový termín (zabere to jen minutu). Rádi si na vás vyhradíme čas.\n\nBest Series s.r.o.';
  const mailer = require('../email');
  const preferred = process.env.BS2_MAIL_FROM || 'info@pradlomaty.info';
  let our = null; try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  const fallback = process.env.SERVICE_BILLING_MAIL_FROM || (our && our.email) || process.env.COMPOUNDER_MAIL_FROM || undefined;
  const opts = { to: r.email, brand: 'bs2', fromName: process.env.BS2_MAIL_FROM_NAME || 'Best Series 2.0', subject, body, link: base + '/cesta/schuzka', linkLabel: 'Vybrat nový termín' };
  let res = await mailer.sendMail(Object.assign({}, opts, { from: preferred }));
  if ((!res || !res.sent) && fallback && fallback !== preferred) res = await mailer.sendMail(Object.assign({}, opts, { from: fallback }));
  if (!res || !res.sent) throw new Error((res && (res.error || res.skipped)) || 'E-mail se nepodařilo odeslat');
  // Záznam do historie komunikace s leadem
  if (r.compounder_lead_id) {
    try { await prisma.leadMessage.create({ data: { lead_id: r.compounder_lead_id, channel: 'email', direction: 'out', subject, body, status: 'sent', sent_at: new Date() } }); } catch (e) { /* historie je bonus */ }
  }
}

async function noShowTick() {
  if (_nsBusy) return;
  _nsBusy = true;
  try {
    const pending = await _loadPending();
    if (!pending.length) return;
    const now = Date.now();
    const due = pending.filter((x) => now - x.at >= NOSHOW_DELAY_MS);
    if (!due.length) return;
    // Nejdřív vyřadit z fronty (ať se e-mail nikdy neodešle dvakrát), pak teprve odeslat
    await setSetting(NOSHOW_KEY, pending.filter((x) => now - x.at < NOSHOW_DELAY_MS), { type: 'json' });
    for (const p of due) {
      try {
        const r = await prisma.meetingReservation.findUnique({ where: { id: p.id }, include: { slot: { select: { starts_at: true } } } });
        if (!r || r.status !== 'no_show') continue; // stav se mezitím změnil → nic neposílat
        if (!r.email) { console.log('[meeting-noshow] rezervace ' + r.id + ' nemá e-mail'); continue; }
        await _sendNoShowMail(r);
        console.log('[meeting-noshow] e-mail s novým termínem odeslán, rezervace', r.id);
      } catch (e) { console.warn('[meeting-noshow] rezervace ' + p.id + ':', e.message); }
    }
  } catch (e) {
    console.warn('[meeting-noshow] tick:', e.message);
  } finally { _nsBusy = false; }
}

function start() {
  if (process.env.MEETING_REMINDER_DISABLED === '1') { console.log('[meeting-reminder] DISABLED'); return; }
  if (_tick) return;
  console.log('[meeting-reminder] start — tick 60 s, SMS 15 min před schůzkou, e-mail 20 min po „nedorazil".');
  _tick = setInterval(() => { tick(); noShowTick(); }, TICK_MS);
}
function stop() { if (_tick) { clearInterval(_tick); _tick = null; } }

module.exports = { start, stop, tick, noShowTick, markNoShow, clearNoShow };
