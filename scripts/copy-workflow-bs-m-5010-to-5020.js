// HolyOS — jednorázové kopírování pracovního postupu z BS-M-5010 do BS-M-5020.
// Zkopíruje všechny operace (kroky), jejich materiály (BOM per operation)
// a požadované kompetence. Konfigurační volby a snapshoty se nekopírují
// (vážou se k samotnému produktu, ne k postupu).
//
// Spuštění:
//   node scripts/copy-workflow-bs-m-5010-to-5020.js          # dry-run (jen vypíše plán)
//   node scripts/copy-workflow-bs-m-5010-to-5020.js --apply  # provede kopii v transakci
//
// Bezpečnostní pojistky:
//  • Pokud cíl (BS-M-5020) už nějaké operace má, script skončí chybou.
//    (Vynutit přepis se dá flagem --force, který smaže existující operace.)
//  • Vše se děje v jedné transakci — buď proběhne všechno, nebo nic.

const { PrismaClient } = require('@prisma/client');

const SOURCE_CODE = 'BS-M-5010';
const TARGET_CODE = 'BS-M-5020';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  const source = await prisma.product.findUnique({
    where: { code: SOURCE_CODE },
    include: {
      operations: {
        include: {
          materials: true,
          required_competencies: true,
        },
        orderBy: [{ step_number: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!source) throw new Error(`Zdrojový produkt ${SOURCE_CODE} nenalezen.`);

  const target = await prisma.product.findUnique({
    where: { code: TARGET_CODE },
    include: { operations: { select: { id: true } } },
  });
  if (!target) throw new Error(`Cílový produkt ${TARGET_CODE} nenalezen.`);

  console.log(`Zdroj : ${source.code} (id=${source.id}) — ${source.operations.length} operací`);
  console.log(`Cíl   : ${target.code} (id=${target.id}) — ${target.operations.length} stávajících operací`);

  if (target.operations.length > 0 && !force) {
    throw new Error(
      `Cíl ${TARGET_CODE} už má ${target.operations.length} operací. Spusť s --force pro přepsání (smaže existující).`
    );
  }

  // Spočti, kolik se vytvoří záznamů (pro výpis)
  let totalMats = 0;
  let totalComps = 0;
  for (const op of source.operations) {
    totalMats += op.materials.length;
    totalComps += op.required_competencies.length;
  }
  console.log(
    `Plán  : ${source.operations.length} operací, ${totalMats} materiálů, ${totalComps} kompetencí.`
  );

  if (!apply) {
    console.log('\nDRY-RUN — nic se nemění. Pro skutečnou kopii spusť s --apply.');
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // Pozn.: default timeout je 5 s — pro 53 operací přes Railway proxy nestačí.
    if (force && target.operations.length > 0) {
      // Cascade: OperationMaterial + OperationRequiredCompetency + ConfigOptionOperation
      // všechny mají onDelete: Cascade z ProductOperation.
      const del = await tx.productOperation.deleteMany({ where: { product_id: target.id } });
      console.log(`Smazáno ${del.count} stávajících operací cíle.`);
    }

    let createdOps = 0;
    let createdMats = 0;
    let createdComps = 0;

    for (const op of source.operations) {
      const newOp = await tx.productOperation.create({
        data: {
          product_id: target.id,
          workstation_id: op.workstation_id,
          step_number: op.step_number,
          name: op.name,
          phase: op.phase,
          duration: op.duration,
          duration_unit: op.duration_unit,
          preparation_time: op.preparation_time,
          workers_count: op.workers_count,
          description: op.description,
          bom_count: op.bom_count,
          from_factorify: op.from_factorify,
          last_calibrated_at: op.last_calibrated_at,
          last_calibrated_by_id: op.last_calibrated_by_id,
          is_staging: op.is_staging,
        },
      });
      createdOps++;

      if (op.materials.length) {
        await tx.operationMaterial.createMany({
          data: op.materials.map((m) => ({
            operation_id: newOp.id,
            material_id: m.material_id,
            product_id: m.product_id,
            quantity: m.quantity,
            unit: m.unit,
          })),
        });
        createdMats += op.materials.length;
      }

      if (op.required_competencies.length) {
        await tx.operationRequiredCompetency.createMany({
          data: op.required_competencies.map((c) => ({
            operation_id: newOp.id,
            competency_id: c.competency_id,
            min_level: c.min_level,
          })),
        });
        createdComps += op.required_competencies.length;
      }
    }

    return { createdOps, createdMats, createdComps };
  }, {
    maxWait: 10_000,   // čekání na získání transakce
    timeout: 120_000,  // 2 min pro běh celé transakce
  });

  console.log(
    `Hotovo: vytvořeno ${result.createdOps} operací, ${result.createdMats} materiálů, ${result.createdComps} kompetencí v ${TARGET_CODE}.`
  );
}

main()
  .catch((err) => {
    console.error('CHYBA:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
