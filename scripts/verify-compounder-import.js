// HolyOS — Kontrola dávkového importu Compounder leadů (owner = Alena Šídlová #32)
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = t.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) process.env.DATABASE_URL = m[1].trim();
  } catch (e) { /* .env nemusí existovat */ }
}
const { prisma } = require('../config/database');

(async function () {
  const OWNER = 32;
  const cnt = await prisma.compounderLead.count({ where: { source: 'import', owner_person_id: OWNER } });
  console.log(`Leadů source=import, owner=Alena #${OWNER}: ${cnt}`);

  const leads = await prisma.compounderLead.findMany({
    where: { source: 'import', owner_person_id: OWNER },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, email: true, phone: true },
  });
  console.log('ID rozsah:', leads.length ? `#${leads[0].id}–#${leads[leads.length - 1].id}` : '—');
  leads.forEach((l) => console.log(`  #${l.id}  ${l.name}  |  ${l.email || '—'}  |  ${l.phone || '—'}`));

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
