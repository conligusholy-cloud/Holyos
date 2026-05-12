// =============================================================================
// HolyOS — Cancel stuck AgentRun záznamy
// =============================================================================
// Po Railway redeployi zůstanou v DB runy ve stavech 'coding', 'planning',
// 'triage', atd., které ale v Node procesu už neběží (proces ID se restartoval).
// Worker je nikdy nezvedne, ale UI je dál ukazuje jako "aktivní".
//
// Skript je vyčistí jedním tahem — nastaví status='cancelled' a ended_at=NOW.
//
// SPUŠTĚNÍ (z lokálu, ne přes railway run — pak se použije DATABASE_PUBLIC_URL z .env):
//   node scripts/cancel-stuck-agent-runs.js
//
// Pokud chceš jen vidět co by se cancelovalo bez změny:
//   node scripts/cancel-stuck-agent-runs.js --dry-run
//
// POZOR: skript se připojuje k Railway produkční DB přes public networking.
// Vyžaduje DATABASE_PUBLIC_URL v .env (viz memory railway_public_db).

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const DRY_RUN = process.argv.includes('--dry-run');

const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('❌ Chybí DATABASE_PUBLIC_URL ani DATABASE_URL v .env');
  process.exit(1);
}
if (dbUrl.includes('railway.internal')) {
  console.error('❌ DATABASE_URL ukazuje na railway.internal — z lokálu nedostupné.');
  console.error('   Nastav DATABASE_PUBLIC_URL v .env (public networking URL z Railway dashboardu).');
  process.exit(1);
}
console.log(`Connecting to: ${dbUrl.replace(/:[^:@]+@/, ':***@')}\n`);

const STUCK_STATUSES = [
  'queued',
  'triage',
  'cloning',
  'planning',
  'coding',
  'awaiting_clarification',
];

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });

  const stuck = await prisma.agentRun.findMany({
    where: { status: { in: STUCK_STATUSES } },
    select: {
      id: true,
      task_id: true,
      status: true,
      started_at: true,
      updated_at: true,
    },
    orderBy: { id: 'desc' },
  });

  if (stuck.length === 0) {
    console.log('✅ Žádné zaseknuté runy. Vše čisté.');
    return;
  }

  console.log(`Nalezeno ${stuck.length} runů v ne-terminálních stavech:\n`);
  for (const r of stuck) {
    const ageMin = Math.round((Date.now() - new Date(r.updated_at).getTime()) / 60000);
    console.log(`  #${r.id}  task=${r.task_id}  ${r.status.padEnd(22)} age=${ageMin}min`);
  }

  if (DRY_RUN) {
    console.log('\n(dry-run — nic neměním)');
    return;
  }

  console.log('\nCancel je všechny...');
  const result = await prisma.agentRun.updateMany({
    where: { status: { in: STUCK_STATUSES } },
    data: {
      status: 'cancelled',
      ended_at: new Date(),
      updated_at: new Date(),
      failure_reason: 'Cancel po Railway redeploy (Node restart vyhodil in-memory state)',
    },
  });
  console.log(`✅ Cancelled: ${result.count} runů.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Chyba:', err);
  process.exit(1);
});
