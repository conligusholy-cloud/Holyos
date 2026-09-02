// HolyOS — úklid jednorázového návalu leadů z FB (Make „Watch Leads" natáhl historii).
//
// Vybere CompounderLead se source 'facebook_ads' vytvořené v posledních N minutách
// a buď je vypíše (dry-run), skryje (is_test=true, VRATNÉ) nebo smaže (--delete).
//
// Spuštění (DATABASE_URL / DATABASE_PUBLIC_URL musí být nastavené):
//   node scripts/cleanup-fb-import.js 60                 # DRY-RUN: vypíše leady z posl. 60 min
//   node scripts/cleanup-fb-import.js 60 --mark-test     # skryje je (vratné) — nepočítají se do statistik
//   node scripts/cleanup-fb-import.js 60 --delete        # NEVRATNĚ smaže
//
// Bezpečnostní strop: bere jen leady bez rezervace a bez uloženého modelu (ať se nic „živého" nesmaže).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const minutes = parseInt(process.argv[2], 10) || 60;
  const MARK = process.argv.includes('--mark-test');
  const DEL = process.argv.includes('--delete');
  const since = new Date(Date.now() - minutes * 60000);

  const BROKEN = process.argv.includes('--broken');
  // --broken: cíleně vadné leady, kam se místo hodnoty vložil popisek pilulky („Field data: …").
  const where = BROKEN
    ? { OR: [ { name: { contains: 'field data', mode: 'insensitive' } }, { email: { contains: 'field data', mode: 'insensitive' } } ] }
    : { source: 'facebook_ads', created_at: { gte: since } };
  const leads = await prisma.compounderLead.findMany({
    where,
    select: { id: true, name: true, email: true, phone: true, created_at: true, is_test: true },
    orderBy: { created_at: 'asc' },
  });
  // Neber leady, které už mají rezervaci (ochrana před smazáním „živého").
  const withResv = new Set((await prisma.locationReservation.findMany({
    where: { lead_id: { in: leads.map((l) => l.id) } }, select: { lead_id: true },
  }).catch(() => [])).map((r) => r.lead_id));
  const safe = leads.filter((l) => !withResv.has(l.id));

  console.log(BROKEN
    ? `Vadné leady (placeholder „field data"): ${leads.length} (bezpečných k úklidu: ${safe.length})`
    : `FB leady vytvořené za posledních ${minutes} min: ${leads.length} (bezpečných k úklidu: ${safe.length}, s rezervací vynecháno: ${leads.length - safe.length})`);
  safe.slice(0, 20).forEach((l) => console.log(`  #${l.id}  ${l.name || '—'}  ${l.email || l.phone || ''}  ${new Date(l.created_at).toLocaleString('cs-CZ')}`));
  if (safe.length > 20) console.log(`  … a dalších ${safe.length - 20}`);

  if (!MARK && !DEL) { console.log('\nDRY-RUN — nic nezměněno. Přidej --mark-test (skrýt, vratné) nebo --delete (smazat).'); return; }
  const ids = safe.map((l) => l.id);
  if (!ids.length) { console.log('Nic k úklidu.'); return; }

  if (MARK) {
    const r = await prisma.compounderLead.updateMany({ where: { id: { in: ids } }, data: { is_test: true } });
    console.log(`Skryto (is_test=true): ${r.count}. Vratné — v HolyOS je najdeš přes 🧪 a můžeš vrátit.`);
  } else if (DEL) {
    const r = await prisma.compounderLead.deleteMany({ where: { id: { in: ids } } });
    console.log(`Smazáno: ${r.count}.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
