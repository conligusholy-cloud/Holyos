// scripts/link-by-code.js
//
// Účel: Manuální helper pro propojení Material → Product přes Product.material_id.
// Použití pro polotovary, kde auto-link skript neuspěl (kvůli duplicitě, ambiguitě).
//
// Použití:
//   1) Diagnostika: vypíše všechny Materials i Products s daným kódem
//      DATABASE_URL=... node scripts/link-by-code.js --code BS-M-4500
//
//   2) Zobrazí konkrétní pár (dry-run, žádný update)
//      DATABASE_URL=... node scripts/link-by-code.js --material-id 4243 --product-id 667
//
//   3) Provede update (set Product.material_id = material_id)
//      DATABASE_URL=... node scripts/link-by-code.js --material-id 4243 --product-id 667 --apply

const { PrismaClient } = require('@prisma/client');

function parseArgs() {
  const out = { code: null, materialId: null, productId: null, apply: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--code') out.code = argv[++i];
    else if (a === '--material-id') out.materialId = parseInt(argv[++i], 10);
    else if (a === '--product-id') out.productId = parseInt(argv[++i], 10);
    else if (a === '--apply') out.apply = true;
  }
  return out;
}

async function diagnoseCode(prisma, code) {
  console.log(`\n🔍 Diagnostika kódu "${code}"\n`);

  const materials = await prisma.material.findMany({
    where: { code: { equals: code, mode: 'insensitive' } },
    select: { id: true, code: true, name: true, type: true },
  });
  console.log(`Materials s kódem "${code}":`);
  if (materials.length === 0) {
    console.log('  (žádný)');
  } else {
    materials.forEach(m => {
      console.log(`  • Material#${m.id} code="${m.code}" type="${m.type}" — "${m.name}"`);
    });
  }

  const products = await prisma.product.findMany({
    where: { code: { equals: code, mode: 'insensitive' } },
    select: { id: true, code: true, name: true, type: true, material_id: true },
  });
  console.log(`\nProducts s kódem "${code}":`);
  if (products.length === 0) {
    console.log('  (žádný)');
  } else {
    products.forEach(p => {
      const linkInfo = p.material_id ? `material_id=${p.material_id}` : 'material_id=null (nepropojeno)';
      console.log(`  • Product#${p.id} code="${p.code}" type="${p.type}" ${linkInfo} — "${p.name}"`);
    });
  }

  // Návrh akce
  console.log('\n💡 Návrh:');
  if (materials.length === 1 && products.length === 1) {
    const m = materials[0];
    const p = products[0];
    if (p.material_id === m.id) {
      console.log(`  ✅ Už propojeno: Material#${m.id} ↔ Product#${p.id}`);
    } else if (!p.material_id) {
      console.log(`  Spusť: node scripts/link-by-code.js --material-id ${m.id} --product-id ${p.id} --apply`);
    } else {
      console.log(`  ⚠️  Product#${p.id} má material_id=${p.material_id}, ale chceš propojit s Material#${m.id}. Přepiš jen po ověření.`);
    }
  } else if (materials.length > 1 || products.length > 1) {
    console.log(`  Více kandidátů. Vyber Material+Product pár (--material-id X --product-id Y) a spusť --apply.`);
  } else if (products.length === 0) {
    console.log(`  ❌ Pro tento Material neexistuje Product záznam. Musíš ho vytvořit ručně (přes UI Pracovní postup → Nový výrobek/polotovar).`);
  } else if (materials.length === 0) {
    console.log(`  ❌ Pro tento Product neexistuje Material záznam.`);
  }
}

async function applyLink(prisma, materialId, productId, doApply) {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) {
    console.error(`❌ Material#${materialId} neexistuje`);
    process.exit(1);
  }
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    console.error(`❌ Product#${productId} neexistuje`);
    process.exit(1);
  }

  console.log(`\nMaterial#${materialId}: code="${material.code}" type="${material.type}" — "${material.name}"`);
  console.log(`Product#${productId}: code="${product.code}" type="${product.type}" material_id=${product.material_id || 'null'} — "${product.name}"`);

  if (product.material_id === materialId) {
    console.log(`\n✅ Už propojeno, není co dělat.`);
    return;
  }

  if (product.material_id && product.material_id !== materialId) {
    console.log(`\n⚠️  Product už má material_id=${product.material_id}, který přepíšeme na ${materialId}.`);
  }

  if (!doApply) {
    console.log(`\n🔍 DRY-RUN — pro provedení přidej --apply`);
    console.log(`Provedlo by: UPDATE products SET material_id = ${materialId} WHERE id = ${productId}`);
    return;
  }

  await prisma.product.update({
    where: { id: productId },
    data: { material_id: materialId },
  });
  console.log(`\n✅ Propojeno: Material#${materialId} ↔ Product#${productId}`);
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    if (args.code) {
      await diagnoseCode(prisma, args.code);
    } else if (args.materialId && args.productId) {
      await applyLink(prisma, args.materialId, args.productId, args.apply);
    } else {
      console.log('Použití:');
      console.log('  node scripts/link-by-code.js --code BS-M-4500                              # diagnóza kódu');
      console.log('  node scripts/link-by-code.js --material-id 4243 --product-id 667           # dry-run páru');
      console.log('  node scripts/link-by-code.js --material-id 4243 --product-id 667 --apply   # provést update');
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Chyba:', err);
  process.exit(1);
});
