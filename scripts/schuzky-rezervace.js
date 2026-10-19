// HolyOS — výpis rezervací schůzek (kdo, kdy, stav) pro kontrolu duplicit v Centru reklamy
// Použití:  node scripts/schuzky-rezervace.js [--since=2026-10-19]     (výchozí = dnes)
// Produkce: $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL; node scripts/schuzky-rezervace.js
const { prisma } = require('../config/database');

(async () => {
  const arg = (process.argv.find((a) => a.startsWith('--since=')) || '').split('=')[1];
  const since = arg ? new Date(arg + 'T00:00:00') : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const fmt = (d) => new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
  const rows = await prisma.meetingReservation.findMany({
    where: { created_at: { gte: since } },
    orderBy: { created_at: 'asc' },
    include: { slot: { select: { starts_at: true } } },
  });
  console.log('\nRezervace schůzek od ' + fmt(since) + ': ' + rows.length + '\n');
  rows.forEach((r) => {
    console.log('#' + r.id + ' · vytvořeno ' + fmt(r.created_at) + ' · termín ' + (r.slot ? fmt(r.slot.starts_at) : '?') + ' · ' + r.status);
    console.log('    ' + (r.name || '—') + ' · ' + (r.email || '—') + ' · ' + (r.phone || '—') + ' · lead: ' + (r.compounder_lead_id || '—') + ' · forma: ' + (r.mode || '—') + '\n');
  });
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
