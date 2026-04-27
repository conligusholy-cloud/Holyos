// HolyOS — Diagnostika: kolik ProductOperation má každé pracoviště
//
// Pomáhá vybrat smysluplné --ws=N pro seed-test-batch.js

const { prisma } = require('../config/database');

async function main() {
  const grouped = await prisma.productOperation.groupBy({
    by: ['workstation_id'],
    _count: { _all: true },
    where: { workstation_id: { not: null } },
  });
  grouped.sort((a, b) => b._count._all - a._count._all);

  console.log('Pracoviště s operacemi (sestupně):\n');
  for (const g of grouped.slice(0, 15)) {
    const ws = await prisma.workstation.findUnique({
      where: { id: g.workstation_id },
      select: { id: true, name: true, code: true },
    });
    console.log(`  ws=${String(g.workstation_id).padEnd(3)} ${String(g._count._all).padStart(3)} op  ${ws?.name || '?'} ${ws?.code ? '(' + ws.code + ')' : ''}`);
  }
  console.log('');
  console.log('Příklad seedu:');
  if (grouped[0]) console.log(`  node scripts/seed-test-batch.js --ws=${grouped[0].workstation_id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
