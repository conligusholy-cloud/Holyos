// scripts/auto-link-products-to-materials.js
//
// Účel: Pro každý Material typu polotovar/výrobek najít odpovídající Product záznam
// (přes shodu code, name nebo fuzzy stripped code) a propojit je nastavením
// Product.material_id. Tím začne `findLinkedProduct` v production routes
// vracet `linked_product`, takže Pracovní postup i strom umí polotovary rozbalit.
//
// Použití:
//   DATABASE_URL=<railway public url> node scripts/auto-link-products-to-materials.js          # dry-run, jen report
//   DATABASE_URL=<railway public url> node scripts/auto-link-products-to-materials.js --apply  # skutečně provede update
//
// Priority scoring kandidátů:
//   100 = exact code + exact name shoda  → silný link, vždy vyhraje
//    80 = exact code shoda jen           → silný link
//    50 = fuzzy stripped code shoda      → akceptovatelný
//    30 = exact name jen (různé kódy)    → SKIP (riziko false positive)
// Vítěz musí mít jednoznačně nejvyšší skóre, jinak se skipne.

const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

function stripCodeSuffix(code) {
  if (!code) return code;
  return code.replace(/-[A-Za-z0-9]{1,3}$/, '');
}

function isCompositeType(type) {
  const t = String(type || '').toLowerCase();
  return t.includes('semi') || t.includes('polotovar') || t.includes('product') || t.includes('výrobek') || t.includes('vyrobek');
}

function scoreCandidate(c) {
  const r = c.reasons;
  const hasExactCode = r.includes('exact code');
  const hasExactName = r.includes('exact name');
  const hasStripped = r.some(x => x.startsWith('Product[') || x.startsWith('Material['));
  if (hasExactCode && hasExactName) return 100;
  if (hasExactCode) return 80;
  if (hasStripped) return 50;
  if (hasExactName) return 30;
  return 0;
}

async function main() {
  const prisma = new PrismaClient();
  console.log(APPLY ? '🚀 APPLY mode — provedu skutečné updaty' : '🔍 DRY-RUN — žádné změny v DB, jen report');
  console.log('');

  const allMaterials = await prisma.material.findMany({
    select: { id: true, code: true, name: true, type: true },
  });
  const composites = allMaterials.filter(m => isCompositeType(m.type));
  console.log(`Materials celkem: ${allMaterials.length}, z toho polotovar/výrobek: ${composites.length}`);

  const allProducts = await prisma.product.findMany({
    select: { id: true, code: true, name: true, material_id: true },
  });
  console.log(`Products celkem: ${allProducts.length}`);
  console.log('');

  const productsByCode = new Map();
  const productsByName = new Map();
  const productsByMatId = new Map();
  const productsByStrippedCode = new Map();

  for (const p of allProducts) {
    if (p.material_id) productsByMatId.set(p.material_id, p);
    if (p.code) {
      const lc = p.code.toLowerCase();
      const arr = productsByCode.get(lc) || [];
      arr.push(p);
      productsByCode.set(lc, arr);

      const stripped = stripCodeSuffix(lc);
      if (stripped && stripped !== lc) {
        const arrS = productsByStrippedCode.get(stripped) || [];
        arrS.push(p);
        productsByStrippedCode.set(stripped, arrS);
      }
    }
    if (p.name) {
      const ln = p.name.toLowerCase();
      const arr = productsByName.get(ln) || [];
      arr.push(p);
      productsByName.set(ln, arr);
    }
  }

  let alreadyLinked = 0;
  let linked = 0;
  let conflictMultipleCandidates = 0;
  let conflictWeakNameOnly = 0;
  let conflictAlreadyLinkedToOther = 0;
  let noCandidate = 0;
  const actions = [];

  for (const m of composites) {
    const code = (m.code || '').toLowerCase();
    const name = (m.name || '').toLowerCase();
    const stripped = stripCodeSuffix(code);

    if (productsByMatId.has(m.id)) {
      const existing = productsByMatId.get(m.id);
      console.log(`✅ ${m.code} (mat#${m.id}) už propojeno s Product#${existing.id} (${existing.code})`);
      alreadyLinked++;
      continue;
    }

    const candidatesById = new Map();
    function addCandidate(p, reason) {
      if (!candidatesById.has(p.id)) {
        candidatesById.set(p.id, { product: p, reasons: [reason] });
      } else {
        candidatesById.get(p.id).reasons.push(reason);
      }
    }

    if (code) {
      for (const p of (productsByCode.get(code) || [])) addCandidate(p, 'exact code');
    }
    if (name) {
      for (const p of (productsByName.get(name) || [])) addCandidate(p, 'exact name');
    }
    if (code) {
      for (const p of (productsByStrippedCode.get(code) || [])) addCandidate(p, `Product[${p.code}] strip → matches Material[${m.code}]`);
    }
    if (stripped && stripped !== code) {
      for (const p of (productsByCode.get(stripped) || [])) addCandidate(p, `Material[${m.code}] strip → matches Product[${p.code}]`);
    }

    const candidates = [...candidatesById.values()];

    if (candidates.length === 0) {
      console.log(`❌ ${m.code} (mat#${m.id}, "${m.name}") — žádný kandidát Product nenalezen`);
      noCandidate++;
      continue;
    }

    candidates.forEach(c => { c.score = scoreCandidate(c); });
    candidates.sort((a, b) => b.score - a.score);
    const topScore = candidates[0].score;
    const winners = candidates.filter(c => c.score === topScore);

    if (winners.length > 1) {
      console.log(`⚠️  ${m.code} (mat#${m.id}) — ${winners.length} kandidátů se stejným score=${topScore}, skipuju:`);
      for (const c of winners) {
        console.log(`     · Product#${c.product.id} (${c.product.code}) — ${c.reasons.join(', ')}`);
      }
      conflictMultipleCandidates++;
      continue;
    }

    const cand = winners[0];

    if (cand.score < 50) {
      // Jen name match → moc rizikové (různé kódy, stejný název)
      console.log(`⚠️  ${m.code} (mat#${m.id}) — jen name match (Product#${cand.product.id} ${cand.product.code}, score=${cand.score}), skipuju (riziko false positive)`);
      conflictWeakNameOnly++;
      continue;
    }

    if (cand.product.material_id && cand.product.material_id !== m.id) {
      console.log(`⚠️  ${m.code} (mat#${m.id}) — kandidát Product#${cand.product.id} má již material_id=${cand.product.material_id}, skipuju`);
      conflictAlreadyLinkedToOther++;
      continue;
    }

    console.log(`🔗 ${m.code} (mat#${m.id}) → Product#${cand.product.id} (${cand.product.code}) [score=${cand.score}] — ${cand.reasons.join(', ')}`);
    actions.push({ productId: cand.product.id, materialId: m.id });
    linked++;
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`✅ Už propojeno:                  ${alreadyLinked}`);
  console.log(`🔗 K propojení:                   ${linked}`);
  console.log(`⚠️  Více vítězů se stejným skóre: ${conflictMultipleCandidates}`);
  console.log(`⚠️  Jen name match (riskantní):   ${conflictWeakNameOnly}`);
  console.log(`⚠️  Product zabrán jiným mat:     ${conflictAlreadyLinkedToOther}`);
  console.log(`❌ Bez kandidáta (Product chybí): ${noCandidate}`);
  console.log('═══════════════════════════════════════════════════════');

  if (!APPLY) {
    console.log('');
    console.log('Toto byl DRY-RUN. Pro provedení updatů spusť znovu s --apply:');
    console.log('  node scripts/auto-link-products-to-materials.js --apply');
    await prisma.$disconnect();
    return;
  }

  if (actions.length === 0) {
    console.log('');
    console.log('Žádná akce k provedení.');
    await prisma.$disconnect();
    return;
  }

  console.log('');
  console.log(`🚀 Provádím ${actions.length} updatů...`);
  let done = 0;
  for (const a of actions) {
    await prisma.product.update({
      where: { id: a.productId },
      data: { material_id: a.materialId },
    });
    done++;
  }
  console.log(`✅ Hotovo: ${done} Productů propojeno s Materialy přes material_id`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Chyba:', err);
  process.exit(1);
});
