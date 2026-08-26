// HolyOS — hromadné doplnění dosledování do kalendáře jako 5min aktivity.
// Pro všechny leady všech obchodníků ve stavu 'dosledovani' (bez už naplánované akce)
// vytvoří SalesEvent (event_type 'followup', 5 min). Den = konec slevy (discount_until),
// jinak dnes; časy rozprostřené 8:00–18:00 (per obchodník + den).
//
// SPUSŤ LOKÁLNĚ (kvůli časové zóně Europe/Prague) proti Railway DB:
//   $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL
//   node scripts/backfill-dosledovani-events.js            # dry-run (jen vypíše)
//   node scripts/backfill-dosledovani-events.js --commit   # ostrý zápis
const { prisma } = require('../config/database');

const COMMIT = process.argv.includes('--commit');
const MARK = 'auto-dosledovani'; // marker v description → idempotence

function dayKeyLocal(d) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
// Datum (den) v LOKÁLNÍM čase v 00:00 → pro sestavení časů 8–18.
function atLocal(dayKey, minutesFromMidnight) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, 0, Math.round(minutesFromMidnight), 0, 0);
}

(async function () {
  const now = new Date();
  const todayKey = dayKeyLocal(now);

  const leads = await prisma.compounderLead.findMany({
    where: { status: 'dosledovani', owner_person_id: { not: null }, is_test: false },
    select: { id: true, name: true, owner_person_id: true, discount_until: true, phone: true },
    take: 100000,
  });
  console.log('Leadů ve stavu Dosledování s obchodníkem: ' + leads.length);

  // Vynech ty, co už mají naplánovaný follow-up/hovor (idempotence + neduplikovat).
  const existing = await prisma.salesEvent.findMany({
    where: { status: 'planned', event_type: { in: ['followup', 'call'] }, compounder_lead_id: { in: leads.map((l) => l.id) } },
    select: { compounder_lead_id: true },
  });
  const hasEvent = new Set(existing.map((e) => e.compounder_lead_id));

  // Rozděl podle (obchodník, den) — den = konec slevy (je-li v budoucnu), jinak dnes.
  const groups = new Map(); // key = owner|dayKey → [lead]
  let skipped = 0;
  for (const l of leads) {
    if (hasEvent.has(l.id)) { skipped++; continue; }
    let dayKey = todayKey;
    if (l.discount_until) { const du = new Date(l.discount_until); if (du.getTime() >= now.getTime()) dayKey = dayKeyLocal(du); }
    const key = l.owner_person_id + '|' + dayKey;
    (groups.get(key) || groups.set(key, []).get(key)).push(l);
  }
  console.log('Přeskočeno (už mají naplánovanou akci): ' + skipped);

  const WIN_START = 8 * 60, WIN_END = 18 * 60, SPAN = WIN_END - WIN_START; // 8:00–18:00
  let planned = 0; const toCreate = [];
  for (const [key, arr] of groups) {
    const [ownerStr, dayKey] = key.split('|');
    const owner = Number(ownerStr);
    const n = arr.length;
    arr.forEach((l, i) => {
      // Rovnoměrné rozprostření v okně 8–18 (5min aktivita; u velkých počtů se kroky zhustí).
      const startMin = WIN_START + (n > 1 ? Math.round(i * (SPAN / n)) : 0);
      const start = atLocal(dayKey, startMin);
      const end = new Date(start.getTime() + 5 * 60000);
      toCreate.push({
        organizer_id: owner, compounder_lead_id: l.id, event_type: 'followup',
        title: 'Dosledovat – ' + (l.name || ('lead #' + l.id)),
        description: 'Zavolat a získat zpětnou vazbu, případně domluvit další kroky. (' + MARK + ')',
        start_at: start, end_at: end, all_day: false, status: 'planned', attendees: null,
      });
      planned++;
    });
  }

  console.log('K vytvoření: ' + planned + ' událostí (5 min) napříč ' + groups.size + ' skupinami (obchodník × den).');
  // Ukázka prvních 10
  toCreate.slice(0, 10).forEach((e) => console.log('  · ' + e.start_at.toLocaleString('cs-CZ') + '  obch#' + e.organizer_id + '  ' + e.title));

  if (!COMMIT) {
    console.log('\nDRY-RUN. Nic se nezapsalo. Pro ostrý zápis přidej --commit.');
    await prisma.$disconnect();
    return;
  }
  let ok = 0;
  for (const data of toCreate) {
    try { await prisma.salesEvent.create({ data }); ok++; } catch (e) { console.error('  chyba u leadu ' + data.compounder_lead_id + ': ' + e.message); }
  }
  console.log('\nHOTOVO. Vytvořeno ' + ok + ' / ' + planned + ' událostí. Synchronizace do Outlooku proběhne postupně při otevření kalendáře.');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
