// HolyOS — nastaví e-mail osobě (podle celého jména nebo id).
//
// Použití:
//   node scripts/set-person-email.js "<jméno příjmení|id>" <email>
// Např.:
//   node scripts/set-person-email.js "Boris Kožuljević" boris.kozuljevic@bestseries.cz
//
// Vyžaduje DATABASE_URL (nebo $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  const who = String(process.argv[2] || '').trim();
  const email = String(process.argv[3] || '').trim();
  if (!who || !email || email.indexOf('@') < 1) {
    console.error('Použití: node scripts/set-person-email.js "<jméno|id>" <email>');
    process.exit(1);
  }
  let person = null;
  if (/^\d+$/.test(who)) {
    person = await prisma.person.findUnique({ where: { id: Number(who) } });
  }
  if (!person) {
    const people = await prisma.person.findMany({ select: { id: true, first_name: true, last_name: true, email: true } });
    const key = norm(who);
    person = people.find((p) => norm((p.first_name || '') + ' ' + (p.last_name || '')) === key)
          || people.find((p) => norm((p.first_name || '') + ' ' + (p.last_name || '')).indexOf(key) >= 0);
    if (person) person = await prisma.person.findUnique({ where: { id: person.id } });
  }
  if (!person) { console.error('Osoba nenalezena:', who); process.exit(1); }

  const old = person.email || '(prázdné)';
  await prisma.person.update({ where: { id: person.id }, data: { email } });
  console.log(`Osoba #${person.id} ${person.first_name || ''} ${person.last_name || ''}: e-mail ${old} → ${email}`);
  console.log('Hotovo. Sync do M365 se zapne, jakmile schránka v tenantu existuje.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
