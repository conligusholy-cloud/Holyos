// HolyOS — Compounder: pravidelné uvolňování prošlých rezervací lokalit.
// Každou minutu: smaže vypršelé 1h holdy a označí prošlé rezervace/aktivní za expirované.
'use strict';

const { prisma } = require('../../config/database');

async function sweep() {
  const now = new Date();
  try {
    await prisma.locationReservation.deleteMany({ where: { status: 'hold', hold_until: { lt: now } } });
    await prisma.locationReservation.updateMany({
      where: { status: 'reserved', fee_until: { lt: now } },
      data: { status: 'expired', cancel_reason: 'Rezervační poplatek nepřišel včas' },
    });
    await prisma.locationReservation.updateMany({
      where: { status: 'active', reserved_until: { lt: now } },
      data: { status: 'expired', cancel_reason: 'Kupní smlouva nedokončena v rezervační době' },
    });
  } catch (e) { /* tabulka nemusí existovat před migrací */ }
}

let _timer = null;
function start() {
  if (_timer) return;
  _timer = setInterval(() => { sweep().catch(() => {}); }, 60 * 1000);
  sweep().catch(() => {});
  console.log('[reservation-sweep] spuštěn (interval 60 s)');
}

module.exports = { start, sweep };
