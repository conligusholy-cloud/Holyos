// Rychlá kontrola Person.email pro Tomáše (před E2E testem Graph send-as).
// Spuštění: node scripts/check-person-email.js
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  const rows = await prisma.person.findMany({
    where: {
      OR: [
        { email: { contains: 'tomas.holy', mode: 'insensitive' } },
        { last_name: 'Holý' },
      ],
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
    },
    orderBy: { id: 'asc' },
  });

  if (rows.length === 0) {
    console.log('— Žádný Person nenalezen.');
  } else {
    console.table(rows);
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
