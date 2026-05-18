// =============================================================================
// HolyOS — Spare Parts Shop auto-release worker
// Periodicky uvolňuje rezervace skladu pro eshop objednávky ve stavu 'new',
// které ležely bez schválení administratorem déle než reservation_hours.
// =============================================================================
//
// Memory: holyos_eshop_iniciativa, holyos_slot_reservation_3day
//
// Konfigurace:
//   EshopSettings.reservation_hours  (DB override)
//   ESHOP_RESERVATION_HOURS          (env fallback, default 72)
//   ESHOP_AUTO_RELEASE_INTERVAL_MS   (env, default 15 min)
// =============================================================================

const { prisma } = require('../../config/database');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_HOURS = 72;

let timer = null;

/**
 * Najde a uvolní (cancel) všechny ShopOrder ve stavu 'new', kterým vypršela
 * 72h rezervace. Vrací počet uvolněných objednávek.
 */
async function runOnce() {
  try {
    let hours = DEFAULT_HOURS;
    const settings = await prisma.eshopSettings.findUnique({ where: { id: 1 } });
    if (settings && settings.reservation_hours) {
      hours = Number(settings.reservation_hours);
    } else if (process.env.ESHOP_RESERVATION_HOURS) {
      const n = parseInt(process.env.ESHOP_RESERVATION_HOURS, 10);
      if (!Number.isNaN(n) && n > 0) hours = n;
    }

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const expired = await prisma.shopOrder.findMany({
      where: { status: 'new', created_at: { lt: cutoff } },
      select: { id: true, order_number: true, partner_id: true, created_at: true },
    });

    if (expired.length === 0) return 0;

    const now = new Date();
    const result = await prisma.shopOrder.updateMany({
      where: { id: { in: expired.map(o => o.id) } },
      data: {
        status: 'cancelled',
        cancel_reason: 'auto_release_expired',
        cancelled_at: now,
      },
    });

    console.log(`[eshop-release] uvolněno ${result.count} expirovaných rezervací (>${hours} h staré):`,
      expired.map(o => o.order_number).join(', '));
    return result.count;
  } catch (err) {
    console.error('[eshop-release] selhalo:', err.message);
    return 0;
  }
}

function start() {
  if (timer) {
    console.warn('[eshop-release] worker už běží, ignoruji start()');
    return;
  }
  const intervalMs = parseInt(process.env.ESHOP_AUTO_RELEASE_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
  console.log(`[eshop-release] worker startuje, interval ${Math.round(intervalMs / 1000)} s`);
  // První běh za 30s po startu (ne hned, ať aplikace nabootuje)
  setTimeout(runOnce, 30000);
  timer = setInterval(runOnce, intervalMs);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[eshop-release] worker zastaven');
  }
}

module.exports = { start, stop, runOnce };
