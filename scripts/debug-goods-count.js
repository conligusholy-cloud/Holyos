// =============================================================================
// HolyOS — Debug: kolik má Factorify Goods, kolik HolyOS Materials, jaký gap?
// =============================================================================

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const factorify = require('../services/factorify/client.service');

const prisma = new PrismaClient({ log: ['warn', 'error'] });

async function main() {
  console.log('Stahuji Factorify Goods (jen ID, code, name + state)…');
  const goods = await factorify.query('Goods');
  console.log(`  Factorify Goods total: ${goods.length}`);

  // Distribuce podle state
  const byState = {};
  for (const g of goods) {
    const code = g?.state?.code || '?';
    byState[code] = (byState[code] || 0) + 1;
  }
  console.log('  Distribuce per state:');
  for (const [k, v] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${k.padEnd(20)} ${v}`);
  }

  // Match s HolyOS Materials
  const factorifyIds = new Set(goods.map(g => String(g.id)));
  const matsInHolyos = await prisma.material.findMany({
    where: { factorify_id: { not: null } },
    select: { factorify_id: true },
  });
  const holyosIds = new Set(matsInHolyos.map(m => m.factorify_id));

  const onlyFactorify = [...factorifyIds].filter(id => !holyosIds.has(id));
  const inBoth = [...factorifyIds].filter(id => holyosIds.has(id));

  console.log(`\nHolyOS Materials s factorify_id: ${matsInHolyos.length}`);
  console.log(`  V obou (paruje):       ${inBoth.length}`);
  console.log(`  Jen ve Factorify:      ${onlyFactorify.length}`);

  // Které ARCHIVED Goods jsou v Factorify
  const archivedGoods = goods.filter(g => {
    const code = g?.state?.code;
    return code !== 'ACTIVE' && code !== 'NEW';
  });
  console.log(`  Z toho ne-ACTIVE Goods: ${archivedGoods.length}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
