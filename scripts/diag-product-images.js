// Diagnostika importu fotek produktů a materiálů.
// Spuštění: node scripts/diag-product-images.js
require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // 1) Statistiky DB
  const matWithPhoto = await prisma.material.count({ where: { photo_url: { not: null } } });
  const matWithApi = await prisma.material.count({ where: { photo_url: { startsWith: '/api/' } } });
  const matWithFid = await prisma.material.count({ where: { factorify_id: { not: null } } });
  const prodWithImg = await prisma.product.count({ where: { image_path: { not: null } } });
  const prodWithFid = await prisma.product.count({ where: { factorify_id: { not: null } } });

  console.log('=== DB ===');
  console.log(`Material s factorify_id: ${matWithFid}`);
  console.log(`Material s photo_url:    ${matWithPhoto}`);
  console.log(`Material s photo_url startsWith /api/: ${matWithApi}`);
  console.log(`Product  s factorify_id: ${prodWithFid}`);
  console.log(`Product  s image_path:   ${prodWithImg}`);

  // 2) Filesystem
  const dir = path.join(__dirname, '..', 'data', 'product-images');
  if (fs.existsSync(dir)) {
    const all = fs.readdirSync(dir);
    const matFiles = all.filter(f => f.startsWith('mat-'));
    const prodFiles = all.filter(f => !f.startsWith('mat-'));
    console.log('\n=== Soubory v data/product-images ===');
    console.log(`Celkem:    ${all.length}`);
    console.log(`Product:   ${prodFiles.length}`);
    console.log(`Material:  ${matFiles.length}`);
    if (matFiles.length > 0) {
      console.log('Vzorek mat-: ' + matFiles.slice(0, 5).join(', '));
    }
  } else {
    console.log('Adresář product-images neexistuje!');
  }

  // 3) Vzorek záznamů
  console.log('\n=== Materiál #2852 ===');
  console.log(await prisma.material.findUnique({
    where: { id: 2852 },
    select: { id: true, code: true, name: true, factorify_id: true, photo_url: true },
  }));

  console.log('\n=== První Material s photo_url ===');
  console.log(await prisma.material.findFirst({
    where: { photo_url: { not: null } },
    select: { id: true, code: true, name: true, factorify_id: true, photo_url: true },
    orderBy: { id: 'asc' },
  }));

  console.log('\n=== První Product s image_path ===');
  console.log(await prisma.product.findFirst({
    where: { image_path: { not: null } },
    select: { id: true, code: true, name: true, factorify_id: true, image_path: true },
    orderBy: { id: 'asc' },
  }));

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
