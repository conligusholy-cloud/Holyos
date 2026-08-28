// HolyOS — úklid zaseknutých kalendářních událostí (SalesEvent), které se v úkolech
// vrací jako „PROŠVIHNUTO" i po dokončení / u mrtvých kontaktů.
//
// Zavře (status):
//  1) 'cancelled' — všechny OTEVŘENÉ události kontaktů se stavem nezajem / nelze_pouzit / rejected
//     (mrtvé leady do úkolů nepatří).
//  2) 'done' — OTEVŘENÉ minulé události (start_at < dnešní půlnoc) typu call/followup/task/meeting,
//     u nichž existuje už DOKONČENÝ/PŘESKOČENÝ úkol stejného kontaktu (krok už byl vyřízen).
//
// Spuštění:
//   node scripts/cleanup-stale-sales-events.js            # DRY-RUN (jen vypíše)
//   node scripts/cleanup-stale-sales-events.js --apply    # provede změny
//
// Vyžaduje DATABASE_URL (Railway) nebo DATABASE_PUBLIC_URL v prostředí.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEAD = ['nezajem', 'nelze_pouzit', 'rejected'];
const OPEN = { notIn: ['done', 'cancelled', 'canceled'] };
const APPLY = process.argv.includes('--apply');

async function main() {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // (1) Mrtvé leady → zruš jejich otevřené události.
  const deadLeads = await prisma.compounderLead.findMany({ where: { status: { in: DEAD } }, select: { id: true } });
  const deadIds = deadLeads.map((l) => l.id);
  const deadEvents = deadIds.length
    ? await prisma.salesEvent.findMany({ where: { compounder_lead_id: { in: deadIds }, status: OPEN }, select: { id: true, title: true, compounder_lead_id: true } })
    : [];

  // (2) Minulé otevřené události, u nichž je už hotový/přeskočený úkol stejného kontaktu.
  const pastOpen = await prisma.salesEvent.findMany({
    where: { status: OPEN, start_at: { lt: todayStart }, event_type: { in: ['call', 'followup', 'task', 'meeting', 'demo'] }, compounder_lead_id: { not: null } },
    select: { id: true, title: true, compounder_lead_id: true, start_at: true },
  });
  const leadIds = Array.from(new Set(pastOpen.map((e) => e.compounder_lead_id)));
  const doneTasks = leadIds.length
    ? await prisma.salesTask.findMany({ where: { lead_id: { in: leadIds }, status: { in: ['done', 'skipped'] } }, select: { lead_id: true } })
    : [];
  const handledLeads = new Set(doneTasks.map((t) => t.lead_id));
  const staleHandled = pastOpen.filter((e) => handledLeads.has(e.compounder_lead_id) && !deadIds.includes(e.compounder_lead_id));

  console.log('=== Úklid zaseknutých SalesEvent ===');
  console.log('Mrtvé leady:', deadIds.length, '→ otevřených událostí k zrušení:', deadEvents.length);
  console.log('Minulé otevřené události u vyřízených kontaktů → k uzavření:', staleHandled.length);
  const sample = (arr) => arr.slice(0, 10).map((e) => `#${e.id} lead ${e.compounder_lead_id} „${(e.title || '').slice(0, 40)}"`).join('\n  ');
  if (deadEvents.length) console.log('  ' + sample(deadEvents));
  if (staleHandled.length) console.log('  ' + sample(staleHandled));

  if (!APPLY) { console.log('\nDRY-RUN — nic nezměněno. Spusť s --apply pro provedení.'); return; }

  if (deadEvents.length) {
    const r = await prisma.salesEvent.updateMany({ where: { id: { in: deadEvents.map((e) => e.id) } }, data: { status: 'cancelled' } });
    console.log('Zrušeno událostí mrtvých leadů:', r.count);
  }
  if (staleHandled.length) {
    const r = await prisma.salesEvent.updateMany({ where: { id: { in: staleHandled.map((e) => e.id) } }, data: { status: 'done' } });
    console.log('Uzavřeno vyřízených minulých událostí:', r.count);
  }
  console.log('Hotovo.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
