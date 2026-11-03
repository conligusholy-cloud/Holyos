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

// Upozornění Jan Holý + Tomáš Holý (Velín push + zvonek), že rezervace slotu vypršela a slot je zase volný.
async function notifyReleased(details) {
  if (!details || !details.length) return;
  const { notifyPerson } = require('./push/expo-push');
  const { createNotification } = require('../routes/notifications.routes');
  const people = [];
  for (const [fn, ln] of [['Jan', 'Holý'], ['Tomáš', 'Holý']]) {
    const p = await prisma.person.findFirst({ where: { active: true, first_name: { equals: fn, mode: 'insensitive' }, last_name: { equals: ln, mode: 'insensitive' } }, select: { id: true, user_id: true } }).catch(() => null);
    if (p) people.push(p);
  }
  const slotIds = Array.from(new Set(details.map((d) => d.slot_id)));
  const slots = await prisma.productionSlot.findMany({ where: { id: { in: slotIds } } }).catch(() => []);
  const fmt = (x) => { try { return new Date(x).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }); } catch (e) { return ''; } };
  for (const d of details) {
    const sl = slots.find((x) => x.id === d.slot_id) || {};
    const when = sl.start_date ? fmt(sl.start_date) + (sl.end_date ? '–' + fmt(sl.end_date) : '') : ('slot #' + d.slot_id);
    const title = '⏰ Rezervace slotu vypršela: ' + (d.customer_name || d.product_name || 'bez jména');
    const body = when + (d.product_name ? ' · ' + d.product_name : '') + (d.order_id ? ' · objednávka #' + d.order_id : '') + ' — slot je zase volný.';
    for (const p of people) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'slot_released', slot_id: d.slot_id, order_id: d.order_id || null, link: '/modules/vyrobni-sloty/index.html' }, sound: 'default' }).catch(() => {});
      if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link: '/modules/vyrobni-sloty/index.html', meta: { slot_id: d.slot_id, order_id: d.order_id || null } }).catch(() => {});
    }
  }
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
      // Podrobný záznam kdo/co se uvolnilo — ať jde rezervaci dohledat a obnovit (assignment se maže natvrdo)
      result.details.forEach((d) => console.log('[slot-reservation-worker]   • slot ' + d.slot_id + ' · zákazník: ' + (d.customer_name || '—') + ' · produkt: ' + (d.product_name || '—') + ' · objednávka #' + (d.order_id || '—') + ' · rezervace platila do ' + (d.reserved_until ? new Date(d.reserved_until).toISOString() : '—')));
      notifyReleased(result.details).catch((e) => console.warn('[slot-reservation-worker] notifikace selhala:', e.message));
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
