// Rychlá kontrola: kolik adminTasků má screenshot v DB.
const { prisma } = require('../config/database');

(async () => {
  try {
    const tasks = await prisma.adminTask.findMany({
      orderBy: { created_at: 'desc' },
      take: 15,
      select: { id: true, description: true, screenshot: true, created_by: true },
    });
    for (const t of tasks) {
      const ss = t.screenshot || '';
      console.log(`#${t.id} | screenshot: ${ss ? 'len=' + ss.length + ', starts="' + ss.slice(0, 40) + '…"' : 'NULL'} | desc: ${String(t.description || '').slice(0, 50)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
})();
