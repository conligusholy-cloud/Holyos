const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const people = await p.person.findMany({
    where: { OR: [{ last_name: { contains: 'eč', mode: 'insensitive' } }, { last_name: { contains: 'ec', mode: 'insensitive' } }, { first_name: { contains: 'eč', mode: 'insensitive' } }] },
    select: { id: true, first_name: true, last_name: true, active: true, velin_activated_at: true },
  });
  console.log('PEOPLE ~Beč:', JSON.stringify(people, null, 2));
  const byPlat = await p.deviceRegistration.groupBy({ by: ['platform', 'active'], _count: { _all: true } });
  console.log('DEVICES by platform/active:', JSON.stringify(byPlat, null, 2));
  const total = await p.deviceRegistration.count();
  console.log('TOTAL device registrations:', total);
  await p.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(2); });
