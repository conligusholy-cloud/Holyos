// =============================================================================
// HolyOS — Schůzky: notifikace do Velína o nové rezervaci termínu
// =============================================================================
// Když si zákazník na pradlomaty.info rezervuje termín schůzky, pošli push do
// Velína + zvonek v HolyOS. Příjemci: VŽDY Jan Holý a Tomáš Holý + obchodník,
// kterému je lead přidělený (owner_person_id). Bez duplicit.
// =============================================================================

'use strict';

const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');

// Stálí příjemci — dohledávají se podle jména (bez natvrdo zadaných ID).
const ALWAYS = [
  { first_name: 'Jan', last_name: 'Holý' },
  { first_name: 'Tomáš', last_name: 'Holý' },
];

const MODE_LABEL = { online: 'online video hovor', osobne: 'osobní schůzka' };
const PATH_LABEL = { vlastni: 'vlastní kapitál', financovani: 'financování' };

async function alwaysPersonIds(prisma) {
  const ids = [];
  for (const who of ALWAYS) {
    try {
      const p = await prisma.person.findFirst({
        where: { active: true, first_name: { equals: who.first_name, mode: 'insensitive' }, last_name: { equals: who.last_name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (p) ids.push(p.id);
    } catch (e) { /* osoba nemusí existovat */ }
  }
  return ids;
}

function fmtWhen(d) {
  try {
    return new Date(d).toLocaleString('cs-CZ', { timeZone: process.env.VELIN_TZ || 'Europe/Prague', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(d); }
}

// Fire-and-forget. { leadId, reservationId, startsAt, mode, financingPath }
async function notifyMeetingBooked(prisma, { leadId, reservationId, startsAt, mode, financingPath, rebooked = false } = {}) {
  try {
    const lead = leadId ? await prisma.compounderLead.findUnique({
      where: { id: leadId },
      select: { id: true, name: true, phone: true, email: true, owner_person_id: true, is_test: true },
    }).catch(() => null) : null;

    const ids = new Set(await alwaysPersonIds(prisma));
    if (lead && lead.owner_person_id) ids.add(lead.owner_person_id);
    if (!ids.size) return;

    const who = (lead && lead.name) || 'Zákazník';
    const title = (rebooked ? '🔁 Přesunutá schůzka: ' : '🤝 Nová schůzka: ') + who + (lead && lead.is_test ? ' 🧪' : '');
    const parts = [fmtWhen(startsAt)];
    if (mode && MODE_LABEL[mode]) parts.push(MODE_LABEL[mode]);
    if (financingPath && PATH_LABEL[financingPath]) parts.push(PATH_LABEL[financingPath]);
    if (lead && lead.phone) parts.push(lead.phone);
    const body = parts.join(' · ');
    const link = '/modules/prodejni-objednavky/index.html?gs_tab=terminy';

    const persons = await prisma.person.findMany({ where: { id: { in: Array.from(ids) } }, select: { id: true, user_id: true } });
    for (const p of persons) {
      notifyPerson(prisma, p.id, {
        title, body,
        data: { type: 'meeting_booked', lead_id: leadId || null, reservation_id: reservationId || null, link },
        sound: 'default',
      }).catch((e) => console.warn('[meeting-notify] push příjemci', p.id, ':', e.message));
      if (p.user_id) {
        createNotification({ userId: p.user_id, type: 'system', title, body, link, meta: { lead_id: leadId || null, reservation_id: reservationId || null } })
          .catch((e) => console.warn('[meeting-notify] zvonek příjemci', p.user_id, ':', e.message));
      }
    }
    console.log('[meeting-notify] rezervace', reservationId, 'lead', leadId, '→ příjemci', Array.from(ids).join(','));
  } catch (e) { console.warn('[meeting-notify] selhalo:', e.message); }
}

module.exports = { notifyMeetingBooked };
