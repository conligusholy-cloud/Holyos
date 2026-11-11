// HolyOS — úklid kroků, které přebila domluvená schůzka.
//
// Kontakt s domluvenou schůzkou (stav schuzka / schuzka_online, nebo otevřená
// událost typu meeting/demo) nemá mít otevřené starší „zavolej" / „dosleduj"
// kroky — plánovač dne je pak obchodníkovi nabízí jako PROŠVIHNUTO, přestože
// je schůzka naplánovaná. Od teď to řeší sama aplikace; tenhle skript srovná,
// co v datech uvízlo dřív.
//
// Zavře:
//   • SalesEvent typu call/followup (otevřené) → 'cancelled'
//   • SalesTask kind call/followup (open)      → 'skipped' + důvod
// Slíbené kroky (event_type 'task') se NERUŠÍ — ty se mají splnit i před schůzkou.
//
// Spuštění:
//   node scripts/cleanup-meeting-superseded-steps.js            # DRY-RUN (jen vypíše)
//   node scripts/cleanup-meeting-superseded-steps.js --apply    # provede změny
//
// Vyžaduje DATABASE_URL (Railway) nebo DATABASE_PUBLIC_URL v prostředí.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OPEN = { notIn: ['done', 'cancelled', 'canceled'] };
const PREBIJENE = ['call', 'followup'];
const DUVOD = 'Nahrazeno domluvenou schůzkou';
const APPLY = process.argv.includes('--apply');

async function main() {
  // (1) Kontakty s domluvenou schůzkou — podle stavu…
  const byStatus = await prisma.compounderLead.findMany({
    where: { status: { in: ['schuzka', 'schuzka_online'] } },
    select: { id: true, name: true, status: true },
  });
  const leads = new Map(byStatus.map((l) => [l.id, l]));

  // …a podle otevřené události typu schůzka/demo (dnes nebo v budoucnu).
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const meetingEvents = await prisma.salesEvent.findMany({
    where: { status: OPEN, event_type: { in: ['meeting', 'demo'] }, start_at: { gte: todayStart }, compounder_lead_id: { not: null } },
    select: { compounder_lead_id: true },
  });
  const extraIds = Array.from(new Set(meetingEvents.map((e) => e.compounder_lead_id))).filter((id) => !leads.has(id));
  if (extraIds.length) {
    const extra = await prisma.compounderLead.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true, status: true } });
    extra.forEach((l) => leads.set(l.id, l));
  }

  const leadIds = Array.from(leads.keys());
  if (!leadIds.length) { console.log('Žádné kontakty s domluvenou schůzkou — není co uklízet.'); return; }
  console.log('Kontaktů s domluvenou schůzkou: ' + leadIds.length);

  // (2) Co u nich visí otevřené.
  const events = await prisma.salesEvent.findMany({
    where: { compounder_lead_id: { in: leadIds }, status: OPEN, event_type: { in: PREBIJENE } },
    select: { id: true, title: true, start_at: true, event_type: true, compounder_lead_id: true },
    orderBy: { start_at: 'asc' },
  });
  const tasks = await prisma.salesTask.findMany({
    where: { lead_id: { in: leadIds }, status: 'open', kind: { in: PREBIJENE } },
    select: { id: true, title: true, lead_id: true, kind: true },
  });

  const jmeno = (id) => { const l = leads.get(id); return l ? (l.name || ('#' + id)) + ' [' + l.status + ']' : '#' + id; };
  const den = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ') : '—');

  console.log('\n── Události k zavření: ' + events.length + ' ──');
  events.forEach((e) => console.log('  #' + e.id + ' ' + den(e.start_at) + ' [' + e.event_type + '] ' + (e.title || '') + '  → ' + jmeno(e.compounder_lead_id)));
  console.log('\n── Otevřené úkoly k odložení: ' + tasks.length + ' ──');
  tasks.forEach((t) => console.log('  #' + t.id + ' [' + t.kind + '] ' + (t.title || '') + '  → ' + jmeno(t.lead_id)));

  if (!APPLY) {
    console.log('\nDRY-RUN — nic se nezměnilo. Spusť znovu s --apply.');
    return;
  }
  const ev = events.length
    ? await prisma.salesEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { status: 'cancelled' } })
    : { count: 0 };
  const tk = tasks.length
    ? await prisma.salesTask.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { status: 'skipped', skipped_reason: DUVOD } })
    : { count: 0 };
  console.log('\nHOTOVO — zavřeno událostí: ' + ev.count + ', odloženo úkolů: ' + tk.count);
}

main()
  .catch((e) => { console.error('CHYBA:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
