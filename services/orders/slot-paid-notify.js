// =============================================================================
// HolyOS — Notifikace řediteli výroby: výrobní slot je zaplacený → začít vyrábět
// =============================================================================
// Volá se v okamžiku, kdy se rezervace slotu změní na 'confirmed' (platba zálohy /
// plná platba / ruční potvrzení). Push do Velína + zvonek v HolyOS.
// Příjemci: AppSetting production.velin_notify_person_ids (pole Person.id).
// Bez nastavení: Radek Bečka (ředitel výroby) — dohledáno podle jména.
// Nikdy nehází — notifikace nesmí shodit platbu.
// =============================================================================

'use strict';

const { prisma: defaultPrisma } = require('../../config/database');
const { getSetting } = require('../settings');
const { notifyPerson } = require('../push/expo-push');

const NOTIFY_SETTING_KEY = 'production.velin_notify_person_ids';

async function recipients(prisma) {
  let ids = await getSetting(NOTIFY_SETTING_KEY, { type: 'json', defaultValue: [] }).catch(() => []);
  ids = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n) && n > 0) : [];
  if (ids.length) {
    return prisma.person.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, user_id: true } });
  }
  return prisma.person.findMany({
    where: {
      active: true,
      first_name: { startsWith: 'Rad', mode: 'insensitive' }, // Radomír / Radek
      last_name: { contains: 'Beč', mode: 'insensitive' },
    },
    select: { id: true, user_id: true },
  });
}

/**
 * @param {object} prisma
 * @param {number} orderId
 * @param {number[]} [assignmentIds] jen nově potvrzené sloty (jinak všechny confirmed objednávky)
 */
async function notifySlotPaid(prisma, orderId, assignmentIds) {
  try {
    const db = prisma || defaultPrisma;
    const id = parseInt(orderId, 10);
    if (!id) return;
    const order = await db.order.findUnique({
      where: { id },
      select: { order_number: true, company: { select: { name: true } } },
    });
    const where = assignmentIds && assignmentIds.length
      ? { id: { in: assignmentIds } }
      : { order_id: id, reservation_status: 'confirmed' };
    const slots = await db.slotAssignment.findMany({
      where,
      select: { product_name: true, quantity: true, customer_name: true, slot: { select: { name: true, start_date: true } } },
      orderBy: { id: 'asc' },
    });
    if (!slots.length) return;

    const fmt = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ') : '');
    const customer = (order && order.company && order.company.name) || slots[0].customer_name || '';
    const what = slots.map((s) => `${Number(s.quantity)}× ${s.product_name}`).join(', ');
    const first = slots.reduce((m, s) => (!m || (s.slot && s.slot.start_date < m) ? (s.slot && s.slot.start_date) : m), null);
    const title = '🏭 Slot zaplacen — začít vyrábět';
    const parts = [];
    if (order && order.order_number) parts.push(`Obj. ${order.order_number}`);
    if (customer) parts.push(customer);
    parts.push(what);
    if (first) parts.push(`slot od ${fmt(first)}`);
    const body = parts.join(' · ');
    const link = '/modules/programovani-vyroby/index.html';

    const people = await recipients(db);
    let createNotification = null;
    try { ({ createNotification } = require('../../routes/notifications.routes')); } catch (_) { /* volitelné */ }

    for (const p of people) {
      notifyPerson(db, p.id, {
        title, body,
        data: { type: 'slot_paid', order_id: id, link },
        sound: 'default',
      }).catch((e) => console.warn('[slot-paid] push', p.id, e.message));
      if (p.user_id && createNotification) {
        createNotification({ userId: p.user_id, type: 'system', title, body, link })
          .catch((e) => console.warn('[slot-paid] zvonek', p.user_id, e.message));
      }
    }
  } catch (e) {
    console.warn('[slot-paid] notifikace selhala:', e.message);
  }
}

module.exports = { notifySlotPaid, NOTIFY_SETTING_KEY };
