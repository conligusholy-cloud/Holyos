// =============================================================================
// HolyOS — Worker: uvolnění expirovaných rezervací výrobních slotů
// =============================================================================
//
// Když obchodník vybere slot v Prodejní objednávce s flagem reserve=true,
// vznikne SlotAssignment s reservation_status='reserved' a reserved_until = NOW + 72 h
// (konfigurovatelné přes env SLOT_RESERVATION_HOURS).
//
// Po zaplacení zálohy se rezervace automaticky překlopí na 'confirmed' v platebním
// endpointu POST /api/wh/orders/:id/payment. Tento worker řeší druhý scénář:
// klient nezaplatil včas, rezervace vypršela → assignment se smaže, slot se vrátí
// jako volný a obchodník (i dashboard) ho uvidí jako dostupný.
//
// Strategie: poll každých 15 minut. Smaže záznamy, kde reservation_status='reserved'
// a reserved_until < NOW. Žádné soft-delete — držet je nemá smysl, audit už dělá
// notifikace + Order.deposit_paid stav.

const { prisma } = require('../config/database');

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minut
const STARTUP_DELAY_MS = 30 * 1000;      // 30 s — počká až DB migrace doběhnou

let _timer = null;
let _running = false;

// Najdi a uvolni expirované rezervace. Vrací { released, freed_slot_ids }.
// Idempotentní — pokud nic není k uvolnění, vrátí released=0.
async function sweepExpiredReservations() {
  const now = new Date();

  // Najdi expirované rezervace (pro audit log + reload slotů ve frontendu)
  const expired = await prisma.slotAssignment.findMany({
    where: {
      reservation_status: 'reserved',
      reserved_until: { lt: now },
    },
    select: {
      id: true,
      slot_id: true,
      order_id: true,
      product_name: true,
      customer_name: true,
      reserved_until: true,
    },
  });

  if (expired.length === 0) {
    return { released: 0, freed_slot_ids: [], details: [] };
  }

  // Smaž — Cascade na ProductionSlot není (smaže se jen assignment),
  // takže slot zůstane existovat a uvolní se.
  const ids = expired.map(e => e.id);
  await prisma.slotAssignment.deleteMany({ where: { id: { in: ids } } });

  // Vrať slot.status na 'open', pokud byl 'full' a teď už nemá žádný aktivní assignment.
  // updateMany kontrolu vazeb sám neudělá, takže jdeme přes Set unikátních slot_id.
  const slotIds = Array.from(new Set(expired.map(e => e.slot_id)));
  for (const slotId of slotIds) {
    const remaining = await prisma.slotAssignment.count({ where: { slot_id: slotId } });
    if (remaining === 0) {
      await prisma.productionSlot.updateMany({
        where: { id: slotId, status: 'full' },
        data: { status: 'open' },
      });
    }
  }

  return {
    released: expired.length,
    freed_slot_ids: slotIds,
    details: expired.map(e => ({
      assignment_id: e.id,
      slot_id: e.slot_id,
      order_id: e.order_id,
      product_name: e.product_name,
      customer_name: e.customer_name,
      reserved_until: e.reserved_until,
    })),
  };
}

async function runOnce() {
  if (_running) {
    console.log('[slot-reservation-worker] Předchozí run ještě běží, přeskakuji.');
    return;
  }
  _running = true;
  try {
    const result = await sweepExpiredReservations();
    if (result.released > 0) {
      console.log(`[slot-reservation-worker] ✓ Uvolněno ${result.released} expirovaných rezervací (sloty: ${result.freed_slot_ids.join(', ')}).`);
    }
  } catch (err) {
    console.error('[slot-reservation-worker] Run selhalo:', err);
  } finally {
    _running = false;
  }
}

function start() {
  console.log(`[slot-reservation-worker] Start, poll každých ${POLL_INTERVAL_MS / 60000} min.`);
  setTimeout(() => {
    runOnce().catch(err => console.error('[slot-reservation-worker] startup run failed:', err));
    _timer = setInterval(() => {
      runOnce().catch(err => console.error('[slot-reservation-worker] periodic run failed:', err));
    }, POLL_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, runOnce, sweepExpiredReservations };
