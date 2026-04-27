// Diagnostika: jak se v Postgres jmenuje tabulka pro Company a v jakém schemu žije.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  // 1) Všechny tabulky obsahující "company" (case-insensitive, libovolné schema)
  const tables = await prisma.$queryRaw`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name ILIKE '%company%' OR table_name ILIKE '%firma%'
    ORDER BY table_schema, table_name
  `;
  console.log('Tabulky obsahující company/firma:');
  console.table(tables);

  // 2) Aktuální search_path
  const searchPath = await prisma.$queryRaw`SHOW search_path`;
  console.log('\nsearch_path:', searchPath);

  // 3) Jak Prisma vidí schema na connection stringu
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/\?.*schema=([^&]+)/);
  console.log('schema z DATABASE_URL:', m ? m[1] : '(default - public)');

  // 4) Sample query přes Prisma client (mělo by sedět)
  const count = await prisma.company.count();
  console.log(`\nprisma.company.count() = ${count} (kdyby tabulka neexistovala, hodilo by chybu)`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
