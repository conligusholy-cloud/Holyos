// HolyOS — diagnostika postupu BS-M-5010 a BS-M-5020 (jen výpis, nic nemění)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const codes = ['BS-M-5010', 'BS-M-5020'];
    const products = await prisma.product.findMany({
      where: { code: { in: codes } },
      include: {
        operations: {
          include: {
            materials: true,
            required_competencies: true,
          },
          orderBy: { step_number: 'asc' },
        },
      },
      orderBy: { code: 'asc' },
    });

    for (const p of products) {
      console.log(`\n=== ${p.code} (id=${p.id}, name="${p.name}") ===`);
      console.log(`  operations: ${p.operations.length}`);
      for (const op of p.operations) {
        console.log(
          `   #${op.step_number} "${op.name}" id=${op.id} ws=${op.workstation_id ?? '-'} dur=${op.duration ?? '-'}${op.duration_unit} prep=${op.preparation_time} workers=${op.workers_count} staging=${op.is_staging} mats=${op.materials.length} comps=${op.required_competencies.length}`
        );
        if (op.materials.length) {
          for (const m of op.materials) {
            console.log(`      mat=${m.material_id} prod=${m.product_id ?? '-'} qty=${m.quantity}${m.unit}`);
          }
        }
        if (op.required_competencies.length) {
          for (const c of op.required_competencies) {
            console.log(`      comp=${c.competency_id} min_level=${c.min_level}`);
          }
        }
      }
    }

    const missing = codes.filter((c) => !products.find((p) => p.code === c));
    if (missing.length) console.log(`\nCHYBÍ produkty: ${missing.join(', ')}`);
  } catch (err) {
    console.error('CHYBA:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
