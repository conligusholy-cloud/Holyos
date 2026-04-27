// Doplnění opravy FP-2026-00011: minulý fix přepnul direction a company,
// ale typ dokladu zůstal 'issued' (UI to ukazuje jako "Vydaná"). Doplníme.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  const inv = await prisma.invoice.findFirst({ where: { invoice_number: 'FP-2026-00011' } });
  if (!inv) {
    console.error('FP-2026-00011 nenalezena.');
    process.exit(1);
  }
  console.log(`Před: type=${inv.type} direction=${inv.direction} number=${inv.invoice_number}`);

  const updated = await prisma.invoice.update({
    where: { id: inv.id },
    data: { type: 'received' },
  });
  console.log(`Po:   type=${updated.type} direction=${updated.direction} number=${updated.invoice_number}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
