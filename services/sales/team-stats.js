// =============================================================================
// HolyOS — Statistiky obchodu: tým + jednotliví obchodníci (dnes / týden / měsíc)
// =============================================================================
// Pro aplikaci „Výsledky obchodu" ve Velínu (Moderní HOME). Každé období se porovná se stejně
// dlouhým úsekem předchozího období (dnes vs. včera, týden do dneška vs. minulý týden ke stejnému dni…).
// Zdroje:
//   hovory / akce  … CompounderEvent event='sales_action' (props.person_id, action, dur_min)
//   schůzky        … MeetingReservation.booked_by_person_id (domluveno = created_at, proběhlo/nedorazil = termín slotu)
//   prodáno        … CompounderLead.status prodano/converted (čas = updated_at, přibližně)
//   nové kontakty  … CompounderLead.created_at (bez testovacích)

'use strict';

const { prisma } = require('../../config/database');
const ownerStats = require('../meeting/owner-stats');

const DEAL_STATUSES = ['prodano', 'converted'];
const CLOSED = ['nezajem', 'nelze_pouzit', 'rejected', 'prodano', 'converted', 'schuzka', 'schuzka_online'];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function workingDays(from, to) { let n = 0; for (let d = startOfDay(from); d < to; d = addDays(d, 1)) { const w = d.getDay(); if (w >= 1 && w <= 5) n++; } return n; }

// Období: [from, to) a srovnávací [pFrom, pTo) stejné délky v předchozím období
function periods(now) {
  const today = startOfDay(now);
  const wd = (today.getDay() + 6) % 7; const week = addDays(today, -wd);
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const elapsed = now.getTime() - today.getTime();
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthTo = new Date(Math.min(new Date(prevMonth.getFullYear(), prevMonth.getMonth(), today.getDate()).getTime() + elapsed, month.getTime()));
  return {
    today: { label: 'Dnes', vs: 'včera', from: today, to: now, pFrom: addDays(today, -1), pTo: new Date(addDays(today, -1).getTime() + elapsed) },
    week: { label: 'Tento týden', vs: 'minulý týden', from: week, to: now, pFrom: addDays(week, -7), pTo: addDays(now, -7) },
    month: { label: 'Tento měsíc', vs: 'minulý měsíc', from: month, to: now, pFrom: prevMonth, pTo: prevMonthTo },
  };
}

function emptyM() { return { calls: 0, talk_min: 0, actions: 0, booked: 0, done: 0, no_show: 0, canceled: 0, deals: 0, new_leads: 0 }; }
const inR = (t, a, b) => t >= a.getTime() && t < b.getTime();

async function compute() {
  const now = new Date();
  const P = periods(now);
  const since = P.month.pFrom < P.week.pFrom ? P.month.pFrom : P.week.pFrom;

  const [persons, events, reservations, leadsNew, leadsDeal, target] = await Promise.all([
    prisma.person.findMany({ where: { active: true, OR: [{ is_salesperson: true }, { is_sales_lead: true }] }, select: { id: true, first_name: true, last_name: true, is_sales_lead: true }, orderBy: [{ last_name: 'asc' }] }),
    prisma.compounderEvent.findMany({ where: { event: 'sales_action', created_at: { gte: since } }, select: { props: true, created_at: true }, take: 100000 }),
    prisma.meetingReservation.findMany({ where: { OR: [{ created_at: { gte: since } }, { slot: { starts_at: { gte: since } } }] }, select: { booked_by_person_id: true, status: true, created_at: true, slot: { select: { starts_at: true } } }, take: 20000 }),
    prisma.compounderLead.findMany({ where: { is_test: false, created_at: { gte: since } }, select: { owner_person_id: true, created_at: true }, take: 50000 }),
    prisma.compounderLead.findMany({ where: { is_test: false, status: { in: DEAL_STATUSES }, updated_at: { gte: since } }, select: { owner_person_id: true, updated_at: true }, take: 5000 }),
    ownerStats.getTarget().catch(() => 0),
  ]);

  // Aktuální zásoba nevolaných kontaktů na obchodníka
  const backlog = await prisma.compounderLead.groupBy({ by: ['owner_person_id'], where: { is_test: false, last_called_at: null, status: { notIn: CLOSED } }, _count: { _all: true } }).catch(() => []);
  const backlogBy = {}; let backlogTotal = 0, unassigned = 0;
  backlog.forEach((b) => { const n = b._count._all; backlogTotal += n; if (b.owner_person_id) backlogBy[b.owner_person_id] = n; else unassigned += n; });

  const out = {};
  for (const [key, p] of Object.entries(P)) {
    const tot = emptyM(), prev = emptyM(), by = {};
    const get = (pid) => (by[pid] = by[pid] || emptyM());
    const add = (pid, t, field, val) => {
      const v = val == null ? 1 : val;
      if (inR(t, p.from, p.to)) { tot[field] += v; if (pid) get(pid)[field] += v; }
      else if (inR(t, p.pFrom, p.pTo)) prev[field] += v;
    };
    events.forEach((e) => { const pr = e.props || {}; const t = new Date(e.created_at).getTime(); const pid = pr.person_id || null;
      if (pr.action === 'import') return;
      add(pid, t, 'actions');
      if (pr.action === 'call') { add(pid, t, 'calls'); if (pr.dur_min) add(pid, t, 'talk_min', Number(pr.dur_min) || 0); } });
    reservations.forEach((r) => { const pid = r.booked_by_person_id || null;
      if (r.status !== 'canceled') add(pid, new Date(r.created_at).getTime(), 'booked'); else add(pid, new Date(r.created_at).getTime(), 'canceled');
      const st = r.slot && r.slot.starts_at ? new Date(r.slot.starts_at).getTime() : 0;
      if (st && r.status === 'done') add(pid, st, 'done'); if (st && r.status === 'no_show') add(pid, st, 'no_show'); });
    leadsNew.forEach((l) => add(l.owner_person_id || null, new Date(l.created_at).getTime(), 'new_leads'));
    leadsDeal.forEach((l) => add(l.owner_person_id || null, new Date(l.updated_at).getTime(), 'deals'));

    const wdays = Math.max(key === 'today' ? 1 : 0, workingDays(p.from, addDays(startOfDay(now), 1)));
    const perPersonTarget = target > 0 ? target * wdays : 0;
    const people = persons.map((x) => { const m = by[x.id] || emptyM(); return Object.assign({ id: x.id, name: ((x.first_name || '') + ' ' + (x.last_name || '')).trim(), lead: !!x.is_sales_lead, target: perPersonTarget, backlog: backlogBy[x.id] || 0,
      calls_per_meeting: m.booked ? Math.round((m.calls / m.booked) * 10) / 10 : null }, m); });
    people.sort((a, b) => (b.booked - a.booked) || (b.calls - a.calls) || (b.actions - a.actions));
    const held = tot.done + tot.no_show;
    out[key] = {
      label: p.label, vs: p.vs, from: p.from, to: p.to,
      total: tot, prev,
      team_target: perPersonTarget * persons.length,
      show_rate: held ? Math.round((tot.done / held) * 1000) / 10 : null,
      calls_per_meeting: tot.booked ? Math.round((tot.calls / tot.booked) * 10) / 10 : null,
      people,
    };
  }
  return { generated_at: now, target_per_day: target, backlog: { total: backlogTotal, unassigned }, periods: out };
}

module.exports = { compute };
