// =============================================================================
// HolyOS — Doprava: notifikace o novém požadavku na dopravu
// =============================================================================
// Když z eshopu (nebo ručně) vznikne nový ShippingRequest, pošli push do Velína
// + zvonek v HolyOS nastaveným odpovědným osobám.
// Příjemci jsou uloženi v AppSetting jako JSON pole Person.id.
// =============================================================================

'use strict';

const { getSetting } = require('../settings');
const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');

const NOTIFY_SETTING_KEY = 'shipping.velin_notify_person_ids';

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

// Fire-and-forget rozeslání. `order` je volitelný objekt s poli objednávky pro
// hezčí text; pokud není, dohledá se přes orderId.
async function notifyNewShippingRequest(prisma, { orderId, order = null } = {}) {
  const personIds = await getSetting(NOTIFY_SETTING_KEY, { type: 'json', defaultValue: [] });
  if (!Array.isArray(personIds) || personIds.length === 0) return;

  let o = order;
  if (!o && orderId) {
    o = await prisma.shopOrder.findUnique({
      where: { id: orderId },
      select: {
        order_number: true, ship_to_country: true,
        ship_to_name: true, ship_to_company: true,
      },
    }).catch(() => null);
  }

  const title = '🚚 Nový požadavek na dopravu';
  const recipient = (o && (o.ship_to_company || o.ship_to_name)) || '';
  const parts = [];
  if (o && o.order_number) parts.push(`Obj. ${o.order_number}`);
  if (o && o.ship_to_country) parts.push(o.ship_to_country);
  if (recipient) parts.push(recipient);
  const body = parts.length ? parts.join(' · ') : 'Vznikl nový požadavek na nacenění dopravy.';
  const link = '/modules/doprava/index.html';

  const persons = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, user_id: true },
  });

  for (const p of persons) {
    // Push na Velín zařízení
    notifyPerson(prisma, p.id, {
      title,
      body,
      data: { type: 'shipping_request_new', order_id: orderId || (o && o.id) || null, link },
      sound: 'default',
    }).catch((e) => console.warn('[shipping] push příjemci', p.id, ':', e.message));

    // Zvonek v HolyOS (jen když má účet). 'system' typ nepushuje → bez dvojitého pushe.
    if (p.user_id) {
      createNotification({
        userId: p.user_id,
        type: 'system',
        title,
        body,
        link,
      }).catch((e) => console.warn('[shipping] zvonek příjemci', p.user_id, ':', e.message));
    }
  }
}

module.exports = {
  NOTIFY_SETTING_KEY,
  getEligibleVelinPeople,
  notifyNewShippingRequest,
};
