// HolyOS — worker uvolnění výrobních slotů u nepodepsaných objednávek
// =============================================================================
// Objednávka odeslaná zákazníkovi (stav 'awaiting_customer') musí být podepsaná
// do 24 h. Pokud ne, tento worker:
//   1) uvolní VŠECHNY rezervované výrobní sloty objednávky (smaže SlotAssignment,
//      slot bez zbylých přiřazení vrátí na 'open'),
//   2) nastaví objednávce status 'expired' + expired_at (odkaz pro zákazníka se
//      tím automaticky deaktivuje — orderLinkLocked povoluje jen new/awaiting_customer),
//   3) pošle notifikaci majitelům do Velína.
//
// Lhůta je konfigurovatelná přes env ORDER_SIGN_DEADLINE_HOURS (default 24).
// Počítá se od Order.created_at (share_token + e-mail zákazníkovi vznikají spolu
// s objednávkou v create-sales-order).
// =============================================================================

'use strict';

const { prisma } = require('../../config/database');

const DEADLINE_HOURS = Math.max(1, parseInt(process.env.ORDER_SIGN_DEADLINE_HOURS || '24', 10));
const POLL_INTERVAL_MS = 15 * 60 * 1000; // každých 15 minut
const STARTUP_DELAY_MS = 45 * 1000; // 45 s po startu (po ostatních workerech)

let _timer = null;
let _running = false;

// Uvolní všechny sloty jedné objednávky. Vrací počet uvolněných přiřazení.
async function releaseOrderSlots(orderId) {
  const assignments = await prisma.slotAssignment.findMany({
    where: { order_id: orderId },
    select: { id: true, slot_id: true },
  });
  if (!assignments.length) return 0;

  const ids = assignments.map((a) => a.id);
  await prisma.slotAssignment.deleteMany({ where: { id: { in: ids } } });

  // Slot bez zbylých přiřazení → zpět na 'open'.
  const slotIds = Array.from(new Set(assignments.map((a) => a.slot_id).filter(Boolean)));
  for (const slotId of slotIds) {
    const remaining = await prisma.slotAssignment.count({ where: { slot_id: slotId } });
    if (remaining === 0) {
      await prisma.productionSlot.updateMany({ where: { id: slotId, status: 'full' }, data: { status: 'open' } });
    }
  }
  return assignments.length;
}

// Projde nepodepsané objednávky starší než lhůta a uvolní jejich sloty.
async function runOnce() {
  if (_running) return;
  _running = true;
  try {
    const cutoff = new Date(Date.now() - DEADLINE_HOURS * 3600 * 1000);
    const stale = await prisma.order.findMany({
      where: { status: 'awaiting_customer', created_at: { lt: cutoff } },
      include: { company: { select: { name: true } } },
    });
    if (!stale.length) return;

    for (const order of stale) {
      try {
        const released = await releaseOrderSlots(order.id);
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'expired', expired_at: new Date(), expected_delivery: null },
        });
        try {
          require('../compounder/notify').notifyOrderExpired(prisma, { order, slotCount: released });
        } catch (e) { /* notifikace nesmí shodit worker */ }
        console.log('[unsigned-order-worker] Objednávka ' + order.order_number + ' nepodepsána do '
          + DEADLINE_HOURS + ' h → status expired, uvolněno slotů: ' + released);
      } catch (e) {
        console.error('[unsigned-order-worker] chyba u objednávky ' + order.id + ':', e && e.message);
      }
    }
  } catch (e) {
    console.error('[unsigned-order-worker] runOnce selhal:', e && e.message);
  } finally {
    _running = false;
  }
}

function start() {
  setTimeout(() => {
    runOnce().catch((e) => console.error('[unsigned-order-worker]', e && e.message));
    _timer = setInterval(() => {
      runOnce().catch((e) => console.error('[unsigned-order-worker]', e && e.message));
    }, POLL_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  console.log('[unsigned-order-worker] spuštěn (lhůta ' + DEADLINE_HOURS + ' h, interval 15 min)');
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, runOnce, releaseOrderSlots };
