// =============================================================================
// HolyOS — Compounder: Velín notifikace o rezervacích lokalit a smlouvách
// =============================================================================
// Posílá push do Velína + zvonek v HolyOS nastaveným osobám při událostech
// celého procesu prodeje lokality prádlomatu:
//   rezervace (vznik / poplatek / dokončení / zrušení / expirace) a
//   smlouvy (koncept / odesláno / vyplněno / PODEPSÁNO), kupní/rezervační/servisní.
// Příjemci jsou uloženi v AppSetting jako JSON pole Person.id. Když není nic
// nastaveno, fallback na majitele (Jan + Tomáš) přes COMPOUNDER_OWNER_EMAILS.
// =============================================================================

'use strict';

const { getSetting } = require('../settings');
const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');

const NOTIFY_SETTING_KEY = 'compounder.velin_notify_person_ids';
const OWNER_EMAILS_DEFAULT = 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz';
const LINK = '/modules/prodejni-objednavky/index.html';

// Osoby, které lze zvolit jako příjemce — jen lidé s aktivovaným Velínem a
// alespoň jedním aktivním zařízením (push jim reálně dorazí).
async function getEligibleVelinPeople(prisma) {
  const people = await prisma.person.findMany({
    where: {
      active: true,
      velin_activated_at: { not: null },
      velin_devices: { some: { active: true } },
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      role: { select: { name: true } },
      velin_devices: { where: { active: true }, select: { id: true } },
    },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  });
  return people.map((p) => ({
    id: p.id,
    name: `${p.first_name} ${p.last_name}`.trim(),
    role: p.role?.name || null,
    devices: p.velin_devices.length,
  }));
}

// Výchozí příjemci (Person.id majitelů) — použije se, když v nastavení nic není.
async function defaultRecipientPersonIds(prisma) {
  const emails = (process.env.COMPOUNDER_OWNER_EMAILS || OWNER_EMAILS_DEFAULT)
    .split(',').map((s) => s.trim()).filter(Boolean);
  const persons = await prisma.person.findMany({
    where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) },
    select: { id: true },
  });
  return persons.map((p) => p.id);
}

// Aktuálně nastavení příjemci (Person.id). Fallback na majitele.
async function resolveRecipientPersonIds(prisma) {
  const ids = await getSetting(NOTIFY_SETTING_KEY, { type: 'json', defaultValue: [] });
  if (Array.isArray(ids) && ids.length) return ids.filter((n) => Number.isInteger(n) && n > 0);
  return defaultRecipientPersonIds(prisma);
}

// Jádro: rozešle push + zvonek. Fire-and-forget, chyby jen logujeme.
async function dispatch(prisma, { title, body, data }) {
  let personIds = [];
  try { personIds = await resolveRecipientPersonIds(prisma); } catch (e) { console.warn('[compounder-notify] příjemci:', e.message); }
  if (!personIds.length) return;

  const persons = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, user_id: true },
  });

  for (const p of persons) {
    notifyPerson(prisma, p.id, {
      title, body,
      data: Object.assign({ link: LINK }, data || {}),
      sound: 'default',
    }).catch((e) => console.warn('[compounder-notify] push', p.id, ':', e.message));

    // Zvonek v HolyOS (jen když má účet). Typ 'system' nepushuje web push → bez duplicit.
    if (p.user_id) {
      createNotification({ userId: p.user_id, type: 'system', title, body, link: LINK })
        .catch((e) => console.warn('[compounder-notify] zvonek', p.user_id, ':', e.message));
    }
  }
}

function fmtDate(d) {
  try { return d ? new Date(d).toLocaleDateString('cs-CZ') : '—'; } catch (e) { return '—'; }
}
function fmtCzk(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('cs-CZ') + ' Kč';
}
function reservationWho(r) {
  return r.buyer_name || r.buyer_email || (r.lead_id ? ('lead #' + r.lead_id) : 'zájemce');
}

const RES_EVENT_TEXT = {
  created: (r) => ({
    title: '🏠 Nová rezervace lokality ' + r.kiosk_code,
    body: reservationWho(r) + ' rezervoval(a) ' + r.kiosk_code + ' na ' + r.days + ' dní. Poplatek ' + fmtCzk(r.fee_total)
      + '. Podpis do ' + fmtDate(r.sign_until) + ', poplatek do ' + fmtDate(r.fee_until) + ', rezervace do ' + fmtDate(r.reserved_until) + '.'
      + (r.buyer_phone ? (' Tel: ' + r.buyer_phone) : ''),
  }),
  fee_paid: (r) => ({
    title: '💰 Rezervační poplatek zaplacen — ' + r.kiosk_code,
    body: reservationWho(r) + ': poplatek přijat, rezervace je aktivní. Kupní smlouva do ' + fmtDate(r.reserved_until) + '.',
  }),
  purchase_paid: (r) => ({
    title: '✅ Lokalita prodána — ' + r.kiosk_code,
    body: reservationWho(r) + ': kupní cena zaplacena, prodej dokončen.',
  }),
  cancelled: (r) => ({
    title: '❌ Rezervace zrušena — ' + r.kiosk_code,
    body: reservationWho(r) + ': rezervace zrušena' + (r.cancel_reason ? (' (' + r.cancel_reason + ')') : '') + '. Lokalita je opět volná.',
  }),
  expired: (r) => ({
    title: '⌛ Rezervace vypršela — ' + r.kiosk_code,
    body: reservationWho(r) + ': rezervace vypršela' + (r.cancel_reason ? (' (' + r.cancel_reason + ')') : '') + '. Lokalita je opět volná.',
  }),
};

async function notifyReservationEvent(prisma, { reservation, event }) {
  try {
    const make = RES_EVENT_TEXT[event];
    if (!make || !reservation) return;
    const { title, body } = make(reservation);
    await dispatch(prisma, { title, body, data: { type: 'compounder_reservation', event, reservation_id: reservation.id, kiosk_code: reservation.kiosk_code } });
  } catch (e) { console.error('[compounder-notify] reservation', event, e.message); }
}

const CONTRACT_TYPE_LABEL = { kupni: 'Kupní smlouva', rezervacni: 'Rezervační smlouva', servisni: 'Servisní smlouva' };
const CONTRACT_EVENT_TEXT = {
  created: { icon: '📝', verb: 'vytvořena (koncept)' },
  sent: { icon: '📤', verb: 'odeslána protistraně' },
  filled: { icon: '✍️', verb: 'vyplněna protistranou' },
  signed: { icon: '📄', verb: 'PODEPSÁNA' },
};

async function notifyContractEvent(prisma, { contract, event }) {
  try {
    const meta = CONTRACT_EVENT_TEXT[event];
    if (!meta || !contract) return;
    const typeLabel = CONTRACT_TYPE_LABEL[contract.type] || 'Smlouva';
    const loc = contract.kiosk_label || contract.kiosk_code || '';
    const title = meta.icon + ' ' + typeLabel + ' ' + meta.verb + (loc ? (' — ' + loc) : '');
    const body = typeLabel + ' k lokalitě ' + (contract.kiosk_code || '') + ' byla ' + meta.verb + '.';
    await dispatch(prisma, { title, body, data: { type: 'compounder_contract', event, contract_id: contract.id, kiosk_code: contract.kiosk_code, contract_type: contract.type } });
  } catch (e) { console.error('[compounder-notify] contract', event, e.message); }
}

// Zákazník podepsal → čeká na náš podpis. Push našim podepisujícím + odkaz na podpis.
async function notifyContractAwaitingCountersign(prisma, contract, signUrl) {
  try {
    if (!contract) return;
    const typeLabel = CONTRACT_TYPE_LABEL[contract.type] || 'Smlouva';
    const loc = contract.kiosk_label || contract.kiosk_code || '';
    const title = '✍️ K podpisu: ' + typeLabel + (loc ? (' — ' + loc) : '');
    const body = 'Zákazník podepsal — klepni pro podpis za Best Series.';
    await dispatch(prisma, { title, body, data: { type: 'compounder_contract', event: 'awaiting_sign', contract_id: contract.id, kiosk_code: contract.kiosk_code, link: signUrl } });
  } catch (e) { console.error('[compounder-notify] awaiting_sign', e.message); }
}

// Žádost o telefonický kontakt z portálu (lead nechal telefon) → Velín push + zvonek
// stejným kanálem jako rezervace/smlouvy. Příjemci = compounder.velin_notify_person_ids
// (fallback majitelé Jan + Tomáš).
async function notifyContactRequest(prisma, { lead, phone, isDist }) {
  try {
    if (!lead) return;
    const who = lead.name || lead.email || ('lead #' + lead.id);
    const roleLabel = lead.role === 'distributor' ? 'Distributor' : 'Compounder';
    const title = isDist ? ('📞 Zájem o distribuci — ' + who) : ('📞 Žádost o kontakt — ' + who);
    const body = roleLabel + ' žádá o telefonický kontakt. Tel: ' + (phone || '—') + (lead.email ? (' · ' + lead.email) : '');
    await dispatch(prisma, { title, body, data: { type: 'compounder_contact', lead_id: lead.id, phone: phone, intent: isDist ? 'distributor' : 'contact' } });
  } catch (e) { console.error('[compounder-notify] contact', e.message); }
}

// Poptávka nákupu Compounderu z portálu (rezervace volného výrobního slotu) →
// Velín push + zvonek stejným kanálem jako rezervace/kontakt.
async function notifyPurchaseInquiry(prisma, { lead, count, locations, phone }) {
  try {
    if (!lead) return;
    const who = lead.name || lead.email || ('lead #' + lead.id);
    const n = Number(count) || 1;
    const title = '🛒 Poptávka nákupu — ' + n + '× Compounder';
    const body = who + ' poptává ' + n + '× Compounder (volné výrobní sloty).'
      + (locations ? (' Umístění: ' + String(locations).slice(0, 120) + '.') : '')
      + (phone ? (' Tel: ' + phone) : '');
    await dispatch(prisma, { title, body, data: { type: 'compounder_purchase', lead_id: lead.id, count: n } });
  } catch (e) { console.error('[compounder-notify] purchase', e.message); }
}

module.exports = {
  NOTIFY_SETTING_KEY,
  getEligibleVelinPeople,
  defaultRecipientPersonIds,
  resolveRecipientPersonIds,
  notifyReservationEvent,
  notifyContractEvent,
  notifyContractAwaitingCountersign,
  notifyContactRequest,
  notifyPurchaseInquiry,
};
