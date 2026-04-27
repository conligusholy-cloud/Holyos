// HolyOS — Diagnostika: najít produkty s operacemi a materiály (vhodné pro BomSnapshot test)

const { prisma } = require('../config/database');

async function main() {
  const products = await prisma.product.findMany({
    where: { operations: { some: {} } },
    select: {
      id: true, code: true, name: true,
      _count: { select: { operations: true } },
    },
    take: 20,
  });

  console.log(`Produkty s operacemi (top 20):\n`);
  for (const p of products) {
    // Sečti počet OperationMaterial pro tento produkt
    const matCount = await prisma.operationMaterial.count({
      where: { operation: { product_id: p.id } },
    });
    console.log(`  id=${String(p.id).padStart(4)}  ops=${String(p._count.operations).padStart(3)}  mat=${String(matCount).padStart(3)}  ${p.code}  ${p.name?.slice(0, 50) || ''}`);
  }

  console.log(`\nPříklad volání BomSnapshot:`);
  if (products[0]) {
    console.log(`  Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/planning/snapshot-bom \``);
    console.log(`    -ContentType 'application/json' \``);
    console.log(`    -Body '{ "product_id": ${products[0].id} }'`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
