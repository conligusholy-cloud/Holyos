// HolyOS — přijaté faktury placené hotově označit jako zaplacené (hotově = zaplaceno na místě)
// Použití:   node scripts/oznacit-hotovost-zaplaceno.js            (jen výpis, nic nemění)
//            node scripts/oznacit-hotovost-zaplaceno.js --apply    (provede změnu)
// Produkce:  $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL
const { prisma } = require('../config/database');

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.invoice.findMany({
    where: { direction: 'ap', payment_method: 'cash', status: { notIn: ['paid', 'cancelled', 'written_off', 'archived'] } },
    select: { id: true, invoice_number: true, total: true, currency: true, date_issued: true, company: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  console.log('\nPřijaté faktury placené hotově a dosud nezaplacené: ' + rows.length + '\n');
  rows.forEach((r) => console.log('  ' + r.invoice_number + ' · ' + ((r.company && r.company.name) || '—') + ' · ' + r.total + ' ' + r.currency));
  if (!apply) { console.log('\nNic se nezměnilo. Pro provedení spusť s --apply.\n'); await prisma.$disconnect(); return; }
  let n = 0;
  for (const r of rows) {
    await prisma.invoice.update({ where: { id: r.id }, data: { status: 'paid', paid_amount: r.total, date_due: r.date_issued } });
    n++;
  }
  console.log('\nOznačeno jako zaplacené: ' + n + '\n');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
