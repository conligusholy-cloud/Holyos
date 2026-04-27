// HolyOS — Smoke test seed pro kiosek pracoviště (F6)
//
// Vytvoří 1 testovací ProductionBatch a BatchOperation pro každou
// ProductOperation, která je přiřazená k danému pracovišti. Bez tohoto
// seedu je kiosek prázdný — BatchOperation se zatím nevytváří automaticky
// (plánovač F3 ještě není).
//
// Použití:
//   node scripts/seed-test-batch.js                # default ws=1
//   node scripts/seed-test-batch.js --ws=2
//   node scripts/seed-test-batch.js --product=5    # konkrétní produkt
//
// Skript je idempotentní v tom smyslu, že tvoří NOVOU dávku každým spuštěním
// (s novým batch_number). Hotové dávky neuklízí.

const { prisma } = require('../config/database');

function arg(name, fallback) {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : fallback;
}

const wsId = parseInt(arg('ws', 1), 10);
const productIdArg = arg('product', null);
const quantity = parseInt(arg('qty', 5), 10);

// Generátor batch_number — musí odpovídat routes/production.routes.js generateBatchNumber.
// Formát: {rok}-{seq3} (např. "2026-001").
async function generateBatchNumber() {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const last = await prisma.productionBatch.findFirst({
    where: { batch_number: { startsWith: prefix } },
    orderBy: { batch_number: 'desc' },
    select: { batch_number: true },
  });
  let seq = 1;
  if (last) {
    const m = last.batch_number.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return prefix + String(seq).padStart(3, '0');
}

async function main() {
  console.log(`Smoke test seed pro kiosek pracoviště ws=${wsId}, qty=${quantity}\n`);

  // 1. Ověř pracoviště
  const ws = await prisma.workstation.findUnique({ where: { id: wsId } });
  if (!ws) {
    console.error(`✗ Pracoviště id=${wsId} neexistuje. Vyber jiné --ws=N.`);
    const list = await prisma.workstation.findMany({ select: { id: true, name: true }, take: 10 });
    console.log('Dostupná pracoviště:', list);
    process.exit(1);
  }
  console.log(`✓ Pracoviště: ${ws.name} (${ws.code || 'bez kódu'})`);

  // 2. Najdi produkt s operacemi na tomto pracovišti
  let productId = productIdArg ? parseInt(productIdArg, 10) : null;
  let operations;

  if (productId) {
    operations = await prisma.productOperation.findMany({
      where: { product_id: productId, workstation_id: wsId },
      orderBy: { step_number: 'asc' },
    });
    if (operations.length === 0) {
      console.error(`✗ Produkt ${productId} nemá operace na pracovišti ${wsId}.`);
      process.exit(1);
    }
  } else {
    // Najdi první produkt, který má alespoň 1 operaci na tomto pracovišti
    const candidate = await prisma.productOperation.findFirst({
      where: { workstation_id: wsId },
      include: { product: true },
      orderBy: { product_id: 'asc' },
    });
    if (!candidate) {
      console.error(`✗ Žádná ProductOperation neukazuje na pracoviště ${wsId}.`);
      console.log('Tip: nastav workstation_id u nějaké operace v modulu Pracovní postup.');
      process.exit(1);
    }
    productId = candidate.product_id;
    operations = await prisma.productOperation.findMany({
      where: { product_id: productId, workstation_id: wsId },
      orderBy: { step_number: 'asc' },
    });
    console.log(`✓ Vybrán produkt ${candidate.product.code} — ${candidate.product.name}`);
  }

  console.log(`✓ Operací na pracovišti: ${operations.length}`);
  operations.forEach(op => console.log(`    [${op.step_number}] ${op.name} (${op.duration || '?'} min)`));

  // 3. Vytvoř ProductionBatch
  const batchNumber = await generateBatchNumber();
  const batch = await prisma.productionBatch.create({
    data: {
      batch_number: batchNumber,
      product_id: productId,
      quantity,
      batch_type: 'main',
      status: 'released', // hned dostupné v kiosku
      priority: 100,
      planned_start: new Date(),
      note: 'Smoke test pro kiosek pracoviště — vytvořeno scripts/seed-test-batch.js',
    },
  });
  console.log(`\n✓ Vytvořena dávka ${batch.batch_number} (id=${batch.id}, status=released)`);

  // 4. Vytvoř BatchOperation pro každou operaci
  const created = [];
  for (const op of operations) {
    const bo = await prisma.batchOperation.create({
      data: {
        batch_id: batch.id,
        operation_id: op.id,
        workstation_id: wsId,
        sequence: op.step_number,
        status: 'ready', // dostupné v kiosku
      },
    });
    created.push(bo);
  }
  console.log(`✓ Vytvořeno ${created.length} BatchOperation (status=ready)`);

  console.log(`\n--- Hotovo ---`);
  console.log(`Otevři kiosek: /modules/kiosky/pracoviste.html?ws=${wsId}`);
  console.log(`Přilož čip pracovníka, který má všechny required_competencies operací.`);
  console.log(`(Pokud operace nemají required_competencies nastavené, uvidí ji každý.)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('CHYBA:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
