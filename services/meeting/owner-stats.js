// =============================================================================
// HolyOS — Vyhodnocení schůzek domluvených obchodníky (denně, úspěšnost, cíl)
// =============================================================================
// Zdroj: MeetingReservation.booked_by_person_id (nastavuje „Online schůzka s majitelem" v aplikaci obchodníka).
// Den = kalendářní den v Europe/Prague podle vytvoření rezervace.
// Úspěšnost schůzky = proběhlé (done) / vyřešené (done + nedorazil + zrušené + termín už uplynul a stav nebyl označen).
// Nadcházející schůzky se do úspěšnosti nepočítají (výsledek ještě není znám).
// Cíl za den: AppSetting 'obchodnik.meeting_daily_target' (0 = bez cíle).

'use strict';

const { getSetting, setSetting } = require('../settings');

const TZ = 'Europe/Prague';
const TARGET_KEY = 'obchodnik.meeting_daily_target';

function dayKey(d) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  return p; // YYYY-MM-DD
}
function lastDays(n) {
  const out = []; const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(now - i * 86400000)));
  return Array.from(new Set(out));
}
function emptyCell() { return { booked: 0, done: 0, no_show: 0, canceled: 0, upcoming: 0, unmarked: 0 }; }
function addTo(c, r, now) {
  c.booked++;
  if (r.status === 'canceled') c.canceled++;
  else if (r.status === 'done') c.done++;
  else if (r.status === 'no_show') c.no_show++;
  else if (r.slot && new Date(r.slot.starts_at).getTime() > now) c.upcoming++;
  else c.unmarked++; // termín uplynul a stav nikdo neoznačil
}
function rate(c) {
  const resolved = c.done + c.no_show + c.canceled + c.unmarked;
  return resolved ? Math.round((c.done / resolved) * 1000) / 10 : null;
}

async function getTarget() { const v = await getSetting(TARGET_KEY, { type: 'number', defaultValue: 0 }).catch(() => 0); return Number(v) || 0; }
async function setTarget(n) { await setSetting(TARGET_KEY, Math.max(0, Math.min(100, Math.round(Number(n) || 0))), { type: 'number', description: 'Cíl: počet domluvených schůzek za den na obchodníka (0 = bez cíle)', scope: 'compounder' }); }

// days = počet dnů zpět včetně dneška. Vrací { target, days:[YYYY-MM-DD], people:[{id,name,per_day,totals,rate}], totals, rate }
async function compute(prisma, days = 14) {
  const keys = lastDays(days);
  const since = new Date(Date.now() - (days + 1) * 86400000);
  const now = Date.now();
  const rows = await prisma.meetingReservation.findMany({
    where: { booked_by_person_id: { not: null }, created_at: { gte: since }, OR: [{ mode: null }, { mode: { notIn: ['hala', 'hala_cont'] } }] }, // schůzky na hale mají vlastní statistiku
    select: { status: true, created_at: true, booked_by_person_id: true, slot: { select: { starts_at: true } } },
  });
  const sellers = await prisma.person.findMany({ where: { active: true, is_salesperson: true }, select: { id: true, first_name: true, last_name: true } });
  const ids = new Set(sellers.map((s) => s.id)); rows.forEach((r) => ids.add(r.booked_by_person_id));
  const extra = Array.from(ids).filter((id) => !sellers.some((s) => s.id === id));
  const more = extra.length ? await prisma.person.findMany({ where: { id: { in: extra } }, select: { id: true, first_name: true, last_name: true } }) : [];
  const people = sellers.concat(more).map((p) => ({ id: p.id, name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || ('#' + p.id), per_day: {}, totals: emptyCell(), rate: null }));
  const byId = {}; people.forEach((p) => { byId[p.id] = p; keys.forEach((k) => { p.per_day[k] = emptyCell(); }); });
  const all = emptyCell();
  rows.forEach((r) => {
    const k = dayKey(r.created_at); const p = byId[r.booked_by_person_id]; if (!p || !p.per_day[k]) return;
    addTo(p.per_day[k], r, now); addTo(p.totals, r, now); addTo(all, r, now);
  });
  people.forEach((p) => { p.rate = rate(p.totals); });
  people.sort((a, b) => b.totals.booked - a.totals.booked || a.name.localeCompare(b.name, 'cs'));
  return { target: await getTarget(), days: keys, people, totals: all, rate: rate(all) };
}

module.exports = { compute, getTarget, setTarget, dayKey, lastDays };
