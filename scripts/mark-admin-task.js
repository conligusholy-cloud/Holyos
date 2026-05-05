// Označí admin task daným ID jako "done" (nebo libovolný stav).
// Použití:
//   node scripts/mark-admin-task.js 40            # → done
//   node scripts/mark-admin-task.js 39 done
//   node scripts/mark-admin-task.js 41 in_progress
//
// Nahrazuje jednorázové skripty mark-task-XX-done.js.

require('dotenv').config({ override: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const idArg = process.argv[2];
  const status = process.argv[3] || 'done';
  const id = parseInt(idArg, 10);

  if (!id || Number.isNaN(id)) {
    console.error('Použití: node scripts/mark-admin-task.js <id> [status]');
    console.error('Např.:  node scripts/mark-admin-task.js 39 done');
    process.exit(1);
  }
  const validStatuses = ['new', 'in_progress', 'done', 'cancelled'];
  if (!validStatuses.includes(status)) {
    console.error('Neplatný status. Povolené:', validStatuses.join(', '));
    process.exit(1);
  }

  try {
    const before = await prisma.adminTask.findUnique({ where: { id } });
    if (!before) {
      console.log(`Task #${id} nenalezen`);
      process.exit(0);
    }
    console.log('Před:', { id: before.id, status: before.status, page_title: before.page_title });
    const after = await prisma.adminTask.update({
      where: { id },
      data: { status },
    });
    console.log('Po:', { id: after.id, status: after.status });
  } catch (e) {
    console.error('Chyba:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
