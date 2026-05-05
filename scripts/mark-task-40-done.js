// Jednorázový skript — označí požadavek #40 (založení modulu Metodické pokyny)
// jako "done". Spouští se z root projektu: `node scripts/mark-task-40-done.js`
require('dotenv').config({ override: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const before = await prisma.adminTask.findUnique({ where: { id: 40 } });
    if (!before) {
      console.log('Task #40 nenalezen');
      process.exit(0);
    }
    console.log('Před:', { id: before.id, status: before.status, page_title: before.page_title });
    const after = await prisma.adminTask.update({
      where: { id: 40 },
      data: { status: 'done' },
    });
    console.log('Po:', { id: after.id, status: after.status });
  } catch (e) {
    console.error('Chyba:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
