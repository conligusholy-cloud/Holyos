// =============================================================================
// HolyOS — Doplnění machine_id k servisním požadavkům (podle názvu lokality)
// =============================================================================
// Požadavky zadané před zavedením ServiceRequest.machine_id mají lokalitu jen
// jako text v poli `problem` ("Vlašim - Tesco"). Tenhle skript je spáruje se
// ServiceMachine podle názvu, ať infolinka i hlasový AI agent můžou párovat
// omezení provozu přes ID a ne přes porovnávání řetězců.
//
// Záměrně konzervativní: doplní jen JEDNOZNAČNOU shodu. Když na název sedí víc
// strojů stejně dobře, řádek přeskočí a vypíše ho — radši nic než špatný stroj
// (zámena lokality je přesně to, co u infolinky nesmí nastat).
//
// Spuštění (v kořeni projektu, .env s DATABASE_URL):
//   node scripts/backfill-service-request-machine.js            # DRY-RUN (nic nezapíše)
//   node scripts/backfill-service-request-machine.js --apply    # zapíše do DB
//   node scripts/backfill-service-request-machine.js --apply --all  # i už vyřešené požadavky
// =============================================================================

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { locationScore } = require('../services/service/restrictions');

const prisma = new PrismaClient({ log: ['warn', 'error'] });

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const ALL = ARGS.includes('--all');
const MIN_SCORE = 10; // aspoň jeden negenerický token nebo shoda celého názvu

(async () => {
  const machines = await prisma.serviceMachine.findMany({ select: { id: true, name: true } });
  if (!machines.length) {
    console.log('V databázi nejsou žádné stroje (ServiceMachine) — není s čím párovat.');
    return;
  }

  const where = { machine_id: null };
  if (!ALL) where.status = { in: ['novy', 'reseni'] };
  const rows = await prisma.serviceRequest.findMany({
    where,
    select: { id: true, problem: true, status: true, created_at: true },
    orderBy: { id: 'asc' },
  });

  console.log('Strojů: ' + machines.length + ' · požadavků bez machine_id: ' + rows.length +
    (ALL ? ' (včetně uzavřených)' : ' (jen aktivní)'));
  console.log(APPLY ? '>>> REŽIM ZÁPISU' : '>>> DRY-RUN — nic se nezapíše, použij --apply');
  console.log('');

  let matched = 0, ambiguous = 0, none = 0;

  for (const r of rows) {
    const scored = machines
      .map((m) => ({ m, score: locationScore(m.name, r.problem) }))
      .filter((x) => x.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      none++;
      console.log('  — #' + r.id + ' „' + r.problem + '" → žádná shoda');
      continue;
    }
    const best = scored[0];
    const tie = scored.filter((x) => x.score === best.score);
    if (tie.length > 1) {
      ambiguous++;
      console.log('  ? #' + r.id + ' „' + r.problem + '" → nejednoznačné: ' +
        tie.map((x) => '#' + x.m.id + ' ' + x.m.name).join(' | ') + ' → přeskakuji');
      continue;
    }

    matched++;
    console.log('  ✓ #' + r.id + ' „' + r.problem + '" → #' + best.m.id + ' ' + best.m.name + ' (skóre ' + best.score + ')');
    if (APPLY) {
      await prisma.serviceRequest.update({ where: { id: r.id }, data: { machine_id: best.m.id } });
    }
  }

  console.log('');
  console.log('Spárováno: ' + matched + ' · nejednoznačné: ' + ambiguous + ' · bez shody: ' + none);
  if (!APPLY && matched) console.log('Zápis spustíš stejným příkazem s --apply.');
  if (ambiguous || none) {
    console.log('Nespárované požadavky nevadí — omezení provozu u nich dál funguje přes název lokality.');
  }
})()
  .catch((e) => { console.error('CHYBA:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
