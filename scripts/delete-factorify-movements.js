// HolyOS — Odstranění skladových pohybů importovaných z Factorify
//
// Bez parametru jen UKÁŽE, co by se smazalo (nic nemění).
//   node scripts/delete-factorify-movements.js
// Smazání (před tím uloží zálohu všech mazaných pohybů do backups/factorify-movements-<datum>.json):
//   node scripts/delete-factorify-movements.js --apply
//
// Factorify pohyb = má factorify_id NEBO factorify_moved_at NEBO poznámku začínající „Factorify".
// POZOR: Skladové zásoby (záložka) se počítají z pohybů — po smazání v nich zůstanou jen pohyby z HolyOS.
// Tabulka Stock ani Material.current_stock se NEMĚNÍ.

const fs = require('fs');
const path = require('path');
const { prisma } = require('../config/database');

const WHERE = {
  OR: [
    { factorify_id: { not: null } },
    { factorify_moved_at: { not: null } },
    { note: { startsWith: 'Factorify' } },
  ],
  // pohyby navázané na sériová čísla / šarže necháme (cizí klíče by mazání shodily)
  serials_received: { none: {} },
  serials_issued: { none: {} },
  lots_received: { none: {} },
};

(async () => {
  const apply = process.argv.includes('--apply');
  const total = await prisma.inventoryMovement.count({ where: WHERE });
  const all = await prisma.inventoryMovement.count();
  const byType = await prisma.inventoryMovement.groupBy({ by: ['type'], where: WHERE, _count: { _all: true } });
  console.log(`Factorify pohybů: ${total} z ${all} celkem (zůstane ${all - total}).`);
  byType.forEach((t) => console.log(`  ${t.type}: ${t._count._all}`));
  const docRefs = await prisma.inventoryMovement.count({ where: { AND: [WHERE, { document_id: { not: null } }] } });
  if (docRefs) console.log(`  (z toho ${docRefs} navázaných na skladový doklad — doklady zůstanou, jen bez těchto řádků)`);

  if (!apply) {
    console.log('\nNic se nesmazalo. Pro smazání spusť znovu s parametrem --apply.');
    await prisma.$disconnect(); process.exit(0);
  }

  // Záloha
  // Na Railway (railway ssh) ukládat na trvalý volume /app/data, lokálně do backups/
  const dir = fs.existsSync('/app/data') ? '/app/data/backups' : path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'factorify-movements-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json');
  const out = fs.createWriteStream(file); out.write('[\n');
  let lastId = 0, saved = 0, first = true;
  for (;;) {
    const rows = await prisma.inventoryMovement.findMany({ where: { AND: [WHERE, { id: { gt: lastId } }] }, orderBy: { id: 'asc' }, take: 2000 });
    if (!rows.length) break;
    for (const r of rows) { out.write((first ? '' : ',\n') + JSON.stringify(r)); first = false; }
    saved += rows.length; lastId = rows[rows.length - 1].id;
    process.stdout.write(`\rZáloha: ${saved}/${total}`);
  }
  out.write('\n]\n'); await new Promise((r) => out.end(r));
  console.log(`\nZáloha uložena: ${file}`);
  if (saved !== total) { console.error('Počet v záloze nesedí — mazání přerušeno.'); await prisma.$disconnect(); process.exit(1); }

  // Mazání po dávkách
  let deleted = 0;
  for (;;) {
    const ids = (await prisma.inventoryMovement.findMany({ where: WHERE, select: { id: true }, take: 2000 })).map((r) => r.id);
    if (!ids.length) break;
    const r = await prisma.inventoryMovement.deleteMany({ where: { id: { in: ids } } });
    deleted += r.count; process.stdout.write(`\rSmazáno: ${deleted}/${total}`);
  }
  console.log(`\n✅ Hotovo — smazáno ${deleted} Factorify pohybů. Záloha: ${file}`);
  await prisma.$disconnect(); process.exit(0);
})().catch(async (e) => { console.error('Chyba:', e.message); await prisma.$disconnect(); process.exit(1); });
