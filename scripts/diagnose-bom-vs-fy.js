// scripts/diagnose-bom-vs-fy.js
//
// Účel: Porovná materiály v Pracovním postupu (Product.operations.materials) s naimportovanou
// FY sestavou (ProductFyBom.items) a najde:
//   - duplicity (stejný material_id ve stejné operaci 2×+)
//   - přebytky (v postupu, ale ne ve FY exportu)
//   - chybějící (ve FY exportu, ale ne v postupu)
//
// Použití:
//   $env:DATABASE_URL = "postgresql://..."  # public Railway URL
//
//   1) FY snapshot existuje pro tento produkt:
//      node scripts/diagnose-bom-vs-fy.js --code BS-M-0004
//
//   2) FY snapshot je u rodiče (např. BS-M-0004 je polotovar v BS-M-4520):
//      node scripts/diagnose-bom-vs-fy.js --code BS-M-0004 --fy-from-code BS-M-4520
//
// Read-only — žádné DELETE/UPDATE.

const { PrismaClient } = require('@prisma/client');

function parseArgs() {
  const out = { productId: null, code: null, fyFromCode: null, fyFromId: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--product-id') out.productId = parseInt(argv[++i], 10);
    else if (argv[i] === '--code') out.code = argv[++i];
    else if (argv[i] === '--fy-from-code') out.fyFromCode = argv[++i];
    else if (argv[i] === '--fy-from-id') out.fyFromId = parseInt(argv[++i], 10);
  }
  return out;
}

function findTargetLevel(fyItems, targetCode, targetFactId) {
  for (const it of fyItems) {
    if (targetCode && it.name && it.name.toUpperCase().startsWith(String(targetCode).toUpperCase())) {
      return { prefix: String(it.level || '').replace(/\s+/g, '').trim(), parentItem: it };
    }
    if (targetFactId && it.factorify_item_id != null && Number(it.factorify_item_id) === Number(targetFactId)) {
      return { prefix: String(it.level || '').replace(/\s+/g, '').trim(), parentItem: it };
    }
  }
  return null;
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    const includeOps = {
      operations: {
        orderBy: { step_number: 'asc' },
        include: {
          materials: {
            include: { material: { select: { id: true, code: true, name: true } } },
          },
        },
      },
      fy_bom: { include: { items: true } },
    };
    let product;
    if (args.productId) {
      product = await prisma.product.findUnique({ where: { id: args.productId }, include: includeOps });
    } else if (args.code) {
      product = await prisma.product.findFirst({ where: { code: args.code }, include: includeOps });
    } else {
      console.error('Použití: --product-id <id>  nebo  --code <kod>  [--fy-from-code <root>]');
      process.exit(1);
    }
    if (!product) {
      console.error('Produkt nenalezen.');
      process.exit(1);
    }

    console.log(`\n=== PRODUKT #${product.id}  code="${product.code}"  "${product.name}" ===\n`);

    let totalMatRows = 0;
    const matIdToRows = new Map();
    for (const op of product.operations) {
      const rows = op.materials || [];
      totalMatRows += rows.length;
      console.log(`Operace #${op.id} "${op.name}" — ${rows.length} mat. řádků`);
      for (const om of rows) {
        const mid = om.material_id;
        if (!matIdToRows.has(mid)) matIdToRows.set(mid, []);
        matIdToRows.get(mid).push({
          om_id: om.id,
          op_id: op.id,
          op_name: op.name,
          qty: om.quantity,
          unit: om.unit,
          mat_code: om.material ? om.material.code : null,
          mat_name: om.material ? om.material.name : null,
        });
      }
    }
    console.log(`\nCelkem řádků v postupu: ${totalMatRows}`);
    console.log(`Unikátních material_id:  ${matIdToRows.size}`);

    const duplicates = [];
    for (const [mid, rows] of matIdToRows.entries()) {
      if (rows.length > 1) duplicates.push({ mid, rows });
    }
    if (duplicates.length > 0) {
      console.log(`\n⚠️  DUPLICITY — ${duplicates.length} materiálů má víc než 1 řádek:`);
      for (const d of duplicates.slice(0, 30)) {
        const sample = d.rows[0];
        console.log(`  Material#${d.mid} "${sample.mat_code}" — ${sample.mat_name}`);
        for (const r of d.rows) {
          console.log(`    om#${r.om_id}  op#${r.op_id} "${r.op_name}"  ${r.qty} ${r.unit}`);
        }
      }
      if (duplicates.length > 30) console.log(`  … a další ${duplicates.length - 30}`);
    } else {
      console.log(`\n✅ Žádné duplicity material_id napříč operacemi.`);
    }

    let fyBom = product.fy_bom;
    let fyItems = [];
    let levelPrefix = null;

    if (!fyBom && (args.fyFromCode || args.fyFromId)) {
      const parentWhere = args.fyFromId ? { id: args.fyFromId } : { code: args.fyFromCode };
      const parent = await prisma.product.findFirst({
        where: parentWhere,
        include: { fy_bom: { include: { items: true } } },
      });
      if (!parent || !parent.fy_bom) {
        console.log(`\nℹ️  Rodič ${args.fyFromCode || args.fyFromId} nenalezen, nebo nemá FY snapshot.`);
        return;
      }
      fyBom = parent.fy_bom;
      const allItems = fyBom.items || [];
      const target = findTargetLevel(allItems, product.code, product.factorify_id);
      if (!target) {
        console.log(`\n⚠️  Cíl ${product.code} (factorify_id=${product.factorify_id}) NENALEZEN ve FY snapshotu rodiče ${parent.code}.`);
        return;
      }
      levelPrefix = target.prefix;
      console.log(`\n📍 Cíl ${product.code} nalezen v rodiči ${parent.code} na úrovni ${levelPrefix}`);
      const prefixWithDot = levelPrefix + '.';
      fyItems = allItems.filter(it => {
        const lvl = String(it.level || '').replace(/\s+/g, '').trim();
        return lvl.startsWith(prefixWithDot);
      });
    } else if (!fyBom) {
      console.log(`\nℹ️  Žádný FY snapshot. Pro porovnání s rodičem použij --fy-from-code <root>`);
      return;
    } else {
      fyItems = (fyBom.items || []).filter(it => {
        const lvl = String(it.level || '').replace(/\s+/g, '').trim();
        return lvl !== '1' && lvl !== '';
      });
    }

    console.log(`\n=== FY SNAPSHOT ===  importováno ${fyBom.imported_at.toISOString()}`);
    console.log(`Položek (relevantních):  ${fyItems.length}`);

    const directRegex = levelPrefix
      ? new RegExp('^' + levelPrefix.replace(/\./g, '\\.') + '\\.\\d+$')
      : /^1\.\d+$/;
    const fyDirect = fyItems.filter(it => {
      const lvl = String(it.level || '').replace(/\s+/g, '').trim();
      return directRegex.test(lvl);
    });
    console.log(`Přímých dětí (úroveň ${levelPrefix || '1'}.X):  ${fyDirect.length}`);

    const fyIdSet = new Set();
    const fyDirectIdSet = new Set();
    for (const it of fyItems) {
      if (it.factorify_item_id != null) fyIdSet.add(Number(it.factorify_item_id));
    }
    for (const it of fyDirect) {
      if (it.factorify_item_id != null) fyDirectIdSet.add(Number(it.factorify_item_id));
    }
    console.log(`Unikátních FY ID rekurzivně: ${fyIdSet.size},  z toho přímých: ${fyDirectIdSet.size}`);

    const extras = [];
    const onlyDeeper = [];
    for (const [mid, rows] of matIdToRows.entries()) {
      const inFy = fyIdSet.has(mid);
      const inDirect = fyDirectIdSet.has(mid);
      if (!inFy) extras.push({ mid, rows });
      else if (!inDirect) onlyDeeper.push({ mid, rows });
    }
    if (extras.length > 0) {
      console.log(`\n🔴 PŘEBYTKY (mimo FY) — ${extras.length} materiálů:`);
      for (const e of extras.slice(0, 40)) {
        const r = e.rows[0];
        console.log(`  Material#${e.mid} "${r.mat_code}" — ${r.mat_name}`);
      }
      if (extras.length > 40) console.log(`  … a další ${extras.length - 40}`);
    } else {
      console.log(`\n✅ Žádné úplné přebytky.`);
    }

    if (onlyDeeper.length > 0) {
      console.log(`\n🟠 NEPŘÍMÉ — ${onlyDeeper.length} materiálů v postupu, ale ve FY jen uvnitř polotovaru:`);
      for (const e of onlyDeeper.slice(0, 40)) {
        const r = e.rows[0];
        console.log(`  Material#${e.mid} "${r.mat_code}" — ${r.mat_name}`);
      }
      if (onlyDeeper.length > 40) console.log(`  … a další ${onlyDeeper.length - 40}`);
    }

    const missingDirect = [];
    const matIdSet = new Set(matIdToRows.keys());
    for (const it of fyDirect) {
      const fid = it.factorify_item_id != null ? Number(it.factorify_item_id) : null;
      if (fid != null && !matIdSet.has(fid)) missingDirect.push(it);
    }
    if (missingDirect.length > 0) {
      console.log(`\n🟡 CHYBÍ — ${missingDirect.length} přímých FY dětí nemá Material v postupu:`);
      for (const m of missingDirect.slice(0, 40)) {
        console.log(`  FY#${m.factorify_item_id} level=${m.level} "${m.name}" ${m.quantity || ''} ${m.unit || ''}`);
      }
      if (missingDirect.length > 40) console.log(`  … a další ${missingDirect.length - 40}`);
    } else {
      console.log(`\n✅ Žádné přímé FY děti nechybí.`);
    }

    console.log(`\n=== SOUHRN ===`);
    console.log(`Postup:                       ${totalMatRows} řádků, ${matIdToRows.size} unikátních materiálů`);
    console.log(`FY (rekurzivně):              ${fyItems.length} položek (${fyDirect.length} přímých)`);
    console.log(`Duplicity:                    ${duplicates.length}`);
    console.log(`Přebytky (mimo FY):           ${extras.length}`);
    console.log(`Nepřímé (uvnitř polotovaru):  ${onlyDeeper.length}  ← hypotéza pro 46 vs 26`);
    console.log(`Chybí přímé děti:             ${missingDirect.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('Chyba:', err); process.exit(1); });
