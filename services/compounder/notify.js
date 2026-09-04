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

// Lokalita zablokována (1h hold po kliknutí Rezervovat). Push Janovi/Tomášovi
// + obchodníkovi, kterému lead patří.
async function notifyReservationHold(prisma, { reservation, leadName, ownerPersonId }) {
  try {
    if (!reservation) return;
    const who = leadName || (reservation.lead_id ? ('lead #' + reservation.lead_id) : 'zájemce');
    const title = '⏳ Lokalita blokována — ' + reservation.kiosk_code;
    const body = who + ' zahájil(a) rezervaci ' + reservation.kiosk_code + ' (blokace 1 h na vyplnění hlavičky).';
    const data = { type: 'compounder_reservation', event: 'hold', reservation_id: reservation.id, kiosk_code: reservation.kiosk_code };
    await dispatch(prisma, { title, body, data });
    if (ownerPersonId) {
      notifyPerson(prisma, ownerPersonId, { title, body, data: Object.assign({ link: LINK }, data), sound: 'default' }).catch(() => {});
    }
  } catch (e) { console.error('[compounder-notify] hold', e.message); }
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

// Nová rezervační smlouva čeká na NAŠI autorizaci (my podepisujeme první, pak zákazník).
async function notifyContractAwaitingAuthorization(prisma, contract, signUrl) {
  try {
    if (!contract) return;
    const typeLabel = CONTRACT_TYPE_LABEL[contract.type] || 'Smlouva';
    const loc = contract.kiosk_label || contract.kiosk_code || '';
    const title = '✍️ K autorizaci: ' + typeLabel + (loc ? (' — ' + loc) : '');
    const body = 'Nová rezervační smlouva k autorizaci — klepni pro podpis za Best Series.';
    await dispatch(prisma, { title, body, data: { type: 'compounder_contract', event: 'awaiting_authorize', contract_id: contract.id, kiosk_code: contract.kiosk_code, link: signUrl } });
  } catch (e) { console.error('[compounder-notify] awaiting_authorize', e.message); }
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
async function notifyPurchaseInquiry(prisma, { lead, count, locations, phone, version }) {
  try {
    if (!lead) return;
    const who = lead.name || lead.email || ('lead #' + lead.id);
    const n = Number(count) || 1;
    const verLbl = version ? (' ' + version) : '';
    const title = '🛒 Poptávka nákupu — ' + n + '× Compounder' + verLbl;
    const body = who + ' poptává ' + n + '× Compounder' + verLbl + ' (volné výrobní sloty).'
      + (locations ? (' Umístění: ' + String(locations).slice(0, 120) + '.') : '')
      + (phone ? (' Tel: ' + phone) : '');
    await dispatch(prisma, { title, body, data: { type: 'compounder_purchase', lead_id: lead.id, count: n } });
  } catch (e) { console.error('[compounder-notify] purchase', e.message); }
}

// Obecná zpráva do Velína (push + zvonek) nastaveným příjemcům (fallback Jan/Tomáš).
// Používá denní hodnocení leadů (daily-digest-worker).
async function notifyOwnersMessage(prisma, { title, body, data }) {
  try {
    await dispatch(prisma, { title, body, data: data || { type: 'compounder_digest' } });
  } catch (e) { console.error('[compounder-notify] message', e.message); }
}

// Nová PŘÍCHOZÍ odpověď leada na e-mail — push + zvonek majitelům (Jan + Tomáš).
async function notifyLeadReply(prisma, { lead, preview }) {
  try {
    const name = (lead && lead.name) ? lead.name : 'Lead';
    await dispatch(prisma, {
      title: '📩 Odpověď: ' + name,
      body: preview || 'Zákazník odpověděl na e-mail.',
      data: { type: 'lead_reply', lead_id: (lead && lead.id) ? lead.id : null },
    });
  } catch (e) { console.error('[compounder-notify] lead reply', e.message); }
}

// Nový kontakt z FB reklamy (rychlý formulář) → push + zvonek majitelům
// (Jan + Tomáš, resp. nastavení compounder.velin_notify_person_ids).
async function notifyFbLead(prisma, { lead, campaign, ownerName }) {
  try {
    if (!lead) return;
    const who = lead.name || lead.email || lead.phone || ('lead #' + lead.id);
    const title = '📢 Nový kontakt z FB reklamy — ' + who;
    const body = (campaign ? ('Kampaň: ' + campaign + '. ') : '')
      + (lead.email ? ('E-mail: ' + lead.email + '. ') : '')
      + (lead.phone ? ('Tel: ' + lead.phone + '. ') : '')
      + (ownerName ? ('Přiřazeno: ' + ownerName + '.') : 'Zatím bez obchodníka.');
    await dispatch(prisma, { title, body, data: { type: 'compounder_fb_lead', lead_id: lead.id, campaign: campaign || null } });
  } catch (e) { console.error('[compounder-notify] fb lead', e.message); }
}

// Zájemce právě ZAČAL psát s AI specialistou (přechod do stavu „Píše s chatem")
// → push + zvonek nastaveným příjemcům a navíc přímo obchodníkovi, jemuž lead patří.
async function notifyChatStarted(prisma, { lead, ownerPersonId, preview }) {
  try {
    if (!lead) return;
    const who = lead.name || lead.email || lead.phone || ('lead #' + lead.id);
    const raw = preview ? String(preview).replace(/\s+/g, ' ').trim() : '';
    const snippet = raw.slice(0, 120);
    const title = '💬 Začal chatovat — ' + who;
    const body = 'Zájemce právě začal psát s AI specialistou'
      + (snippet ? (': „' + snippet + (raw.length > 120 ? '…' : '') + '"') : '.')
      + (lead.phone ? (' Tel: ' + lead.phone + '.') : '');
    const data = { type: 'compounder_chat_started', lead_id: lead.id };
    await dispatch(prisma, { title, body, data });
    if (ownerPersonId) {
      notifyPerson(prisma, ownerPersonId, { title, body, data: Object.assign({ link: LINK }, data), sound: 'default' }).catch(() => {});
    }
  } catch (e) { console.error('[compounder-notify] chat started', e.message); }
}

// Zájemce v chatu s AI specialistou chce schůzku → push + zvonek majitelům,
// včetně navržených termínů, ať je obchodník rychle potvrdí.
async function notifyMeetingRequest(prisma, { lead, terms, note }) {
  try {
    const who = (lead && (lead.name || lead.email || lead.phone)) ? (lead.name || lead.email || lead.phone) : ('lead #' + (lead && lead.id));
    const termsTxt = Array.isArray(terms) && terms.length ? terms.join(' | ') : (terms || 'termín neuveden');
    const title = '📅 Zájem o schůzku — ' + who;
    const body = 'Zájemce v chatu se specialistou chce schůzku. Navržené termíny: ' + termsTxt + '.'
      + (lead && lead.phone ? (' Tel: ' + lead.phone + '.') : '')
      + (note ? (' ' + note) : '');
    await dispatch(prisma, { title, body, data: { type: 'compounder_meeting_request', lead_id: (lead && lead.id) ? lead.id : null } });
  } catch (e) { console.error('[compounder-notify] meeting request', e.message); }
}

// Zájemce v chatu chce, abychom mu ZAVOLALI → push + zvonek majitelům, s kdy a tel.
async function notifyCallbackRequest(prisma, { lead, when, note }) {
  try {
    const who = (lead && (lead.name || lead.email || lead.phone)) ? (lead.name || lead.email || lead.phone) : ('lead #' + (lead && lead.id));
    const title = '📞 Žádost o zavolání — ' + who;
    const body = 'Zájemce v chatu chce, abychom mu zavolali.'
      + (when ? (' Kdy: ' + when + '.') : '')
      + (lead && lead.phone ? (' Tel: ' + lead.phone + '.') : ' (telefon není u kontaktu vyplněn)')
      + (note ? (' ' + note) : '');
    await dispatch(prisma, { title, body, data: { type: 'compounder_callback_request', lead_id: (lead && lead.id) ? lead.id : null } });
  } catch (e) { console.error('[compounder-notify] callback request', e.message); }
}

module.exports = {
  NOTIFY_SETTING_KEY,
  notifyChatStarted,
  notifyMeetingRequest,
  notifyCallbackRequest,
  getEligibleVelinPeople,
  defaultRecipientPersonIds,
  resolveRecipientPersonIds,
  notifyReservationEvent,
  notifyReservationHold,
  notifyContractEvent,
  notifyContractAwaitingCountersign,
  notifyContractAwaitingAuthorization,
  notifyContactRequest,
  notifyPurchaseInquiry,
  notifyOwnersMessage,
  notifyLeadReply,
  notifyFbLead,
};
