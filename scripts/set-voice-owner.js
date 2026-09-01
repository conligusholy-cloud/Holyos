#!/usr/bin/env node
// =============================================================================
// HolyOS — Nastaví majitele hlasové recepční (kam chodí push po hovoru)
//
// Person.voice_twilio_number = volané Twilio číslo → tomu člověku pak chodí
// push „Zmeškaný hovor" z /api/voice (services/voice/notify.js).
//
// Použití:
//   node scripts/set-voice-owner.js <username> <twilio_number>
// Příklad:
//   node scripts/set-voice-owner.js tomas.holy +420910926010
// =============================================================================

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normNumber(n) {
  return (n || '').replace(/[\s\-()]/g, '');
}

async function main() {
  const [username, number] = process.argv.slice(2);
  if (!username || !number) {
    console.error('❌ Použití: node scripts/set-voice-owner.js <username> <twilio_number>');
    process.exit(1);
  }
  const norm = normNumber(number);

  // Person hledáme primárně přes navázaný User (username je na účtu),
  // fallback na Person.username.
  const user = await prisma.user.findUnique({ where: { username }, include: { person: true } });
  const person = (user && user.person) || (await prisma.person.findFirst({ where: { username } }));
  if (!person) {
    console.error(
      `❌ Nenašel jsem Person pro username="${username}" (ani přes účet, ani přes Person.username).`
    );
    process.exit(1);
  }

  await prisma.person.update({
    where: { id: person.id },
    data: { voice_twilio_number: norm, voice_agent_enabled: true },
  });

  console.log('✅ Hotovo:');
  console.log(`   ${person.first_name} ${person.last_name} (Person ${person.id})`);
  console.log(`   voice_twilio_number = ${norm}, voice_agent_enabled = true`);
  console.log('\n👉 Po zavěšení hovoru na toto číslo dorazí push do Velína tomuto člověku.\n');
}

main()
  .catch((err) => { console.error('❌ Chyba:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
