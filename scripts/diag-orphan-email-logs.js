// Najde EmailIngest logy se statusem linked_to_invoice, jejichž relace invoices
// je prázdná. Tj. duchové po smazaných fakturách nebo bug v ingestu, který
// nastavil status bez vytvoření Invoice.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  // EmailIngest se statusem linked_to_invoice + count invoices přes _count
  const ingests = await prisma.emailIngest.findMany({
    where: { status: 'linked_to_invoice' },
    select: {
      id: true,
      received_at: true,
      from_email: true,
      from_name: true,
      subject: true,
      mailbox: true,
      confidence: true,
      _count: { select: { invoices: true, attachments: true } },
      invoices: {
        select: { id: true, invoice_number: true, external_number: true },
      },
    },
    orderBy: { received_at: 'desc' },
  });

  console.log(`Celkem EmailIngest se statusem linked_to_invoice: ${ingests.length}`);

  const orphans = ingests.filter(i => i._count.invoices === 0);

  console.log(`Orphan emaily (linked, ale 0 napojených faktur): ${orphans.length}\n`);
  if (orphans.length) {
    console.table(orphans.map(o => ({
      ingest_id: o.id,
      received: o.received_at?.toISOString().slice(0, 16),
      from: o.from_email,
      subject: (o.subject || '').slice(0, 60),
      attachments: o._count.attachments,
      confidence: o.confidence,
    })));
  }


  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
