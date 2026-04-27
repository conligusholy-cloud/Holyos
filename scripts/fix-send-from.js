// Oprava: 1) propojení User.tomas.holy → Person.id=1, 2) oprava Company.email překlepu.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  // 1) Najdi Tomášovu Person
  const tomasPerson = await prisma.person.findFirst({
    where: { first_name: 'Tomáš', last_name: 'Holý' },
  });
  if (!tomasPerson) {
    console.error('Person Tomáš Holý nenalezena.');
    process.exit(1);
  }
  console.log(`Person Tomáš Holý: id=${tomasPerson.id}, email=${tomasPerson.email}`);

  // 2) Propoj User.tomas.holy
  const updatedUser = await prisma.user.update({
    where: { username: 'tomas.holy' },
    data: { person: { connect: { id: tomasPerson.id } } },
    include: { person: true },
  });
  console.log(`✓ User.${updatedUser.username} → Person.id=${updatedUser.person?.id} (email=${updatedUser.person?.email})`);

  // 3) Stejně tak pro jan.holy, pokud Person Jan Holý existuje
  const janPerson = await prisma.person.findFirst({
    where: { first_name: 'Jan', last_name: 'Holý' },
  });
  if (janPerson) {
    try {
      const u = await prisma.user.update({
        where: { username: 'jan.holy' },
        data: { person: { connect: { id: janPerson.id } } },
        include: { person: true },
      });
      console.log(`✓ User.${u.username} → Person.id=${u.person?.id} (email=${u.person?.email})`);
    } catch (e) {
      console.log(`(jan.holy User neexistuje nebo nelze propojit: ${e.code || e.message})`);
    }
  }

  // 4) Oprava Company.email pro naši firmu
  const ourCompany = await prisma.company.update({
    where: { id: 1 },
    data: { email: 'faktury@bestseries.cz' },
  });
  console.log(`✓ Company.id=1 → email=${ourCompany.email}`);

  console.log('\nHotovo. Po dalším loginu (po restart serveru) bude req.user.person.email naplněný.');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
