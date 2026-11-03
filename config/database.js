// =============================================================================
// HolyOS — Database konfigurace (Prisma Client)
// =============================================================================

const { PrismaClient } = require('@prisma/client');

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['warn', 'error'],
});

// Historie změn rezervací výrobních slotů (SlotAssignment) → audit_log (services/slot-audit.js).
// Rozšíření zachytí všechny create/update/delete napříč aplikací; při chybě rozšíření běží klient dál bez něj.
let prisma = basePrisma;
try { prisma = basePrisma.$extends(require('../services/slot-audit').extension(basePrisma)); }
catch (e) { console.warn('[database] audit slotů nelze zapnout:', e.message); }

// Graceful shutdown
process.on('beforeExit', async () => {
  await basePrisma.$disconnect();
});

module.exports = { prisma };
