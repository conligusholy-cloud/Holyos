// HolyOS — záznamník událostí objednávky (best-effort; nikdy neshodí volající tok).
'use strict';

const { prisma } = require('../config/database');

/**
 * Zaloguj událost k objednávce.
 * @param {number} orderId
 * @param {{type:string,label:string,detail?:string,actor?:string,ts?:Date}} ev
 */
async function logOrderEvent(orderId, ev) {
  try {
    if (!orderId || !ev || !ev.type) return;
    await prisma.orderEvent.create({
      data: {
        order_id: Number(orderId),
        type: String(ev.type).slice(0, 40),
        label: String(ev.label || ev.type).slice(0, 160),
        detail: ev.detail != null ? String(ev.detail).slice(0, 2000) : null,
        actor: ev.actor != null ? String(ev.actor).slice(0, 120) : null,
        ts: ev.ts ? new Date(ev.ts) : undefined,
      },
    });
  } catch (e) {
    console.error('[order-events] log selhal:', e && e.message);
  }
}

/**
 * Zaloguj událost jen jednou (podle typu) — např. první zobrazení zákazníkem.
 */
async function logOrderEventOnce(orderId, ev) {
  try {
    if (!orderId || !ev || !ev.type) return;
    const exists = await prisma.orderEvent.findFirst({ where: { order_id: Number(orderId), type: ev.type } });
    if (exists) return;
    await logOrderEvent(orderId, ev);
  } catch (e) {
    console.error('[order-events] logOnce selhal:', e && e.message);
  }
}

module.exports = { logOrderEvent, logOrderEventOnce };
