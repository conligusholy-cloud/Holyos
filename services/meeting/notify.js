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

const MODE_LABEL = { online: 'online video hovor', osobne: 'osobní schůzka', hala: '🏭 schůzka na hale' };
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
      select: { id: true, name: true, phone: true, email: true, owner_person_id: true, is_test: true, source: true },
    }).catch(() => null) : null;

    // Kdo schůzku domluvil — stejné pravidlo jako statistiky schůzek (Laundromats admin → Statistiky):
    // obchodník = rezervace s booked_by_person_id, reklama = zákazník sám a kontakt přišel z reklamy, jinak sám z webu.
    let origin = '';
    try {
      const resv = reservationId ? await prisma.meetingReservation.findUnique({ where: { id: reservationId }, select: { booked_by_person_id: true } }) : null;
      if (resv && resv.booked_by_person_id) {
        const bp = await prisma.person.findUnique({ where: { id: resv.booked_by_person_id }, select: { first_name: true, last_name: true } });
        origin = '👤 domluvil ' + (bp ? [bp.first_name, bp.last_name].filter(Boolean).join(' ') : 'obchodník');
      } else if (lead && lead.source && /(facebook|fb_|meta|google|gads|linkedin|instagram|tiktok|_ads$|^ads)/i.test(lead.source)) {
        const src = /google|gads/i.test(lead.source) ? 'Google' : /linkedin/i.test(lead.source) ? 'LinkedIn' : /tiktok/i.test(lead.source) ? 'TikTok' : /instagram/i.test(lead.source) ? 'Instagram' : 'FB';
        origin = '📣 z reklamy (' + src + ') — vybral sám';
      } else origin = '🌐 vybral sám (web)';
    } catch (e) { origin = ''; }

    const ids = new Set(await alwaysPersonIds(prisma));
    if (lead && lead.owner_person_id) ids.add(lead.owner_person_id);
    if (!ids.size) return;

    const who = (lead && lead.name) || 'Zákazník';
    const title = (rebooked ? '🔁 Přesunutá schůzka: ' : '🤝 Nová schůzka: ') + who + (lead && lead.is_test ? ' 🧪' : '');
    const parts = [fmtWhen(startsAt)];
    if (mode && MODE_LABEL[mode]) parts.push(MODE_LABEL[mode]);
    if (financingPath && PATH_LABEL[financingPath]) parts.push(PATH_LABEL[financingPath]);
    if (lead && lead.phone) parts.push(lead.phone);
    const body = parts.join(' · ') + (origin ? '\n' + origin : '');
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

// ── Zrušení schůzky: push + zvonek do Velína (Jan, Tomáš, obchodník) a zákazníkovi SMS + e-mail v jeho jazyce ──
const PL_MON = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const PL_DAY = { Sunday: 'niedziela', Monday: 'poniedziałek', Tuesday: 'wtorek', Wednesday: 'środa', Thursday: 'czwartek', Friday: 'piątek', Saturday: 'sobota' };
const CS_MON = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
function whenText(d, pl) {
  const dt = new Date(d);
  if (pl) { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt).reduce((a, x) => (a[x.type] = x.value, a), {}); return PL_DAY[p.weekday] + ' ' + p.day + ' ' + PL_MON[(+p.month) - 1] + ' o ' + p.hour + ':' + p.minute; }
  const p = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(dt).reduce((a, x) => (a[x.type] = x.value, a), {});
  return p.weekday + ' ' + p.day + '. ' + CS_MON[(+p.month) - 1] + ' v ' + p.hour + ':' + p.minute;
}
function isPolish(lead, resv) {
  const lang = String((lead && lead.lang) || '').toLowerCase();
  if (lang) return lang.startsWith('pl');
  const ph = String((resv && resv.phone) || (lead && lead.phone) || '').replace(/[\s()-]/g, '');
  return /^(\+|00)48/.test(ph);
}

// Fire-and-forget. { by? } — kdo zrušil (jméno do notifikace)
async function notifyMeetingCanceled(prisma, reservationId, { by } = {}) {
  try {
    const resv = await prisma.meetingReservation.findUnique({ where: { id: reservationId }, include: { slot: { select: { starts_at: true } } } });
    if (!resv || !resv.slot) return;
    const lead = resv.compounder_lead_id ? await prisma.compounderLead.findUnique({ where: { id: resv.compounder_lead_id }, select: { id: true, name: true, phone: true, email: true, owner_person_id: true, lang: true, is_test: true } }).catch(() => null) : null;
    const starts = resv.slot.starts_at; const past = new Date(starts).getTime() < Date.now();
    const pl = isPolish(lead, resv);
    const name = resv.name || (lead && lead.name) || 'Zákazník';

    // 1) Velín push + zvonek
    const ids = new Set(await alwaysPersonIds(prisma));
    if (lead && lead.owner_person_id) ids.add(lead.owner_person_id);
    if (resv.booked_by_person_id) ids.add(resv.booked_by_person_id);
    const title = '❌ Zrušená schůzka: ' + name + (lead && lead.is_test ? ' 🧪' : '');
    const parts = [fmtWhen(starts)]; if (resv.phone || (lead && lead.phone)) parts.push(resv.phone || lead.phone); if (by) parts.push('zrušil: ' + by);
    const body = parts.join(' · '); const link = '/modules/prodejni-objednavky/index.html?gs_tab=terminy';
    if (ids.size) {
      const persons = await prisma.person.findMany({ where: { id: { in: Array.from(ids) } }, select: { id: true, user_id: true } });
      for (const p of persons) {
        notifyPerson(prisma, p.id, { title, body, data: { type: 'meeting_canceled', lead_id: (lead && lead.id) || null, reservation_id: reservationId, link }, sound: 'default' }).catch((e) => console.warn('[meeting-cancel] push', p.id, e.message));
        if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link, meta: { lead_id: (lead && lead.id) || null, reservation_id: reservationId } }).catch((e) => console.warn('[meeting-cancel] zvonek', p.user_id, e.message));
      }
    }
    if (past) { console.log('[meeting-cancel] rezervace', reservationId, '— termín už proběhl, zákazníkovi se nepíše'); return; }

    // 2) Zákazníkovi SMS + e-mail (jeho jazyk)
    const when = whenText(starts, pl); const phone = resv.phone || (lead && lead.phone); const email = resv.email || (lead && lead.email);
    const base = String(process.env.LM_URL || 'https://www.laundromats.eu').replace(/\/$/, '');
    if (phone) {
      try {
        const first = require('../vocative').vocativeFirstName(name);
        const sms = pl ? 'Spotkanie ' + when + ' zostało odwołane. Nowy termin wybierzesz tutaj: ' + base + '/cesta/pl/schuzka'
          : (first ? first + ', schůzka' : 'Schůzka') + ' ' + when + ' byla zrušena. Nový termín si vyberete zde: ' + base + '/cesta/schuzka';
        await require('../voice/sms').sendSms(phone, sms, { context: 'schuzka_zruseni', leadId: (lead && lead.id) || undefined });
      } catch (e) { console.warn('[meeting-cancel] SMS:', e.message); }
    }
    if (email) {
      try {
        const text = pl
          ? 'Dzień dobry,\n\nz przykrością informujemy, że spotkanie zaplanowane na ' + when + ' zostało odwołane.\n\nJeśli nadal jesteś zainteresowany, wybierz nowy termin za pomocą przycisku poniżej.\n\nLaundromats.eu'
          : 'Dobrý den,\n\nbohužel vám musíme oznámit, že schůzka naplánovaná na ' + when + ' byla zrušena.\n\nPokud máte stále zájem, vyberte si prosím nový termín tlačítkem níže.\n\nLaundromats.eu';
        const from = (await require('../../routes/compounder.routes').funnelMailFrom('schuzka', pl ? 'pl' : undefined).catch(() => null)) || process.env.COMPOUNDER_MAIL_FROM || undefined;
        await require('../email').sendMail({ to: email, from, brand: 'pradlomaty', fromName: '💧 PRÁDLOMATY 💧', subject: (pl ? 'Spotkanie odwołane – ' : 'Schůzka zrušena – ') + when, body: text,
          link: base + (pl ? '/cesta/pl/schuzka' : '/cesta/schuzka'), linkLabel: pl ? 'Wybierz nowy termin' : 'Vybrat nový termín' });
      } catch (e) { console.warn('[meeting-cancel] e-mail:', e.message); }
    }
    console.log('[meeting-cancel] rezervace', reservationId, 'lead', lead && lead.id, pl ? 'PL' : 'CS', 'SMS:', !!phone, 'e-mail:', !!email);
  } catch (e) { console.warn('[meeting-cancel] selhalo:', e.message); }
}

module.exports = { notifyMeetingBooked, notifyMeetingCanceled };
