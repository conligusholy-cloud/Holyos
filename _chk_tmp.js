const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const col = await prisma.$queryRawUnsafe("SELECT column_name FROM information_schema.columns WHERE table_name='materials' AND column_name='eshop_category_id'");
  const join = await prisma.$queryRawUnsafe("SELECT to_regclass('public.\"_MaterialEshopCategories\"') AS t");
  const mig = await prisma.$queryRawUnsafe("SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name LIKE '%eshop_categories_m2n%'");
  console.log('sloupec eshop_category_id existuje:', col.length ? 'ANO' : 'NE (dropnut)');
  console.log('join tabulka _MaterialEshopCategories:', join[0].t);
  console.log('migrace zaznam:', JSON.stringify(mig, (k,v)=> typeof v==='bigint'?v.toString():v));
  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
