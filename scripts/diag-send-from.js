// Diagnostika: kdo je User tomas.holy a jaký má Person.email + jaký je e-mail naší firmy.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');
const { getOurCompany } = require('../services/settings');

(async () => {
  const user = await prisma.user.findUnique({
    where: { username: 'tomas.holy' },
    include: { person: true },
  });
  console.log('--- User tomas.holy ---');
  console.log({
    id: user?.id,
    username: user?.username,
    person_id: user?.person_id,
    person_email: user?.person?.email,
    person_first: user?.person?.first_name,
    person_last: user?.person?.last_name,
  });

  const ourCompany = await getOurCompany();
  console.log('\n--- Naše firma (accounting.our_company_id) ---');
  console.log({
    id: ourCompany?.id,
    name: ourCompany?.name,
    email: ourCompany?.email,
    ico: ourCompany?.ico,
  });

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
