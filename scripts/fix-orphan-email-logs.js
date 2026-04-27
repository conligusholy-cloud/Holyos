// Reset existujících orphan EmailIngest záznamů (linked_to_invoice + 0 napojených faktur)
// na status 'archived' s poznámkou. Po opravě hard-delete cascade už nebudou vznikat.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  const ingests = await prisma.emailIngest.findMany({
    where: { status: 'linked_to_invoice' },
    select: {
      id: true,
      received_at: true,
      subject: true,
      _count: { select: { invoices: true } },
    },
  });

  const orphans = ingests.filter(i => i._count.invoices === 0);
  if (orphans.length === 0) {
    console.log('Žádné orphany — není co opravovat.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Opravuji ${orphans.length} orphan EmailIngest záznam${orphans.length === 1 ? '' : 'ů'}:`);
  for (const o of orphans) {
    console.log(`  - id=${o.id} (${o.received_at?.toISOString().slice(0, 16)}) ${(o.subject || '').slice(0, 50)}`);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const result = await prisma.emailIngest.updateMany({
    where: { id: { in: orphans.map(o => o.id) } },
    data: {
      status: 'archived',
      note: `Auto-archived ${stamp} — faktura byla smazána, e-mail osiřel. Klik Reprocess pro opětovné zpracování.`,
    },
  });

  console.log(`\n✓ Aktualizováno ${result.count} záznamů na status='archived'.`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
