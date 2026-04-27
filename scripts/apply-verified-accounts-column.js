// Manuální aplikace ALTER TABLE — `prisma db execute` selhal s P1014 (introspekční problém),
// ale migrate resolve označil migraci jako applied. Sloupec fyzicky chybí v Railway DB,
// takže ho přidáme přímo přes prisma.$executeRawUnsafe.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  // Schema mapuje model Company → tabulku "companies" přes @@map (lowercase plural)
  const exists = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'verified_bank_accounts'
  `;
  if (exists.length > 0) {
    console.log('✓ Sloupec verified_bank_accounts už v companies existuje. Není třeba nic dělat.');
    await prisma.$disconnect();
    return;
  }

  console.log('Přidávám sloupec verified_bank_accounts do companies...');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "companies" ADD COLUMN "verified_bank_accounts" JSONB NOT NULL DEFAULT '[]'::jsonb`
  );
  console.log('✓ Sloupec přidán.');

  // Verifikace
  const after = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'verified_bank_accounts'
  `;
  console.log('Stav po přidání:', after);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
