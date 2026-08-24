#!/usr/bin/env node
// =============================================================================
// HolyOS — Vytvoření obchodníka (User + Person) pro plně funkční Velín
//
// Založí/aktualizuje User (přihlášení do Velína i webu) a napojený Person
// s příznakem is_salesperson = true (obrazovka obchodníka, provize, slevy).
//
// Použití:
//   node scripts/create-salesperson.js <username> <heslo> <jméno> <příjmení> [email]
//
// Příklad:
//   node scripts/create-salesperson.js boris.kozuljevic Heslo123 Boris Kožuljević boris.kozuljevic@icloud.com
// =============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const [username, password, firstName, lastName, email] = process.argv.slice(2);

  if (!username || !password || !firstName || !lastName) {
    console.error('❌ Použití: node scripts/create-salesperson.js <username> <heslo> <jméno> <příjmení> [email]');
    process.exit(1);
  }

  const displayName = `${firstName} ${lastName}`;
  console.log(`\n🔧 Zakládám obchodníka: ${displayName} (login: ${username})`);

  const hash = await bcrypt.hash(password, 12);

  // 1) User účet (přihlášení)
  const user = await prisma.user.upsert({
    where: { username },
    update: { password_hash: hash, display_name: displayName, role: 'user' },
    create: { username, password_hash: hash, display_name: displayName, role: 'user' },
  });

  // 2) Person navázaný na User, s příznaky obchodníka
  const existing = await prisma.person.findFirst({ where: { user_id: user.id } });
  const data = {
    first_name: firstName,
    last_name: lastName,
    email: email || null,
    active: true,
    is_salesperson: true,
    can_give_discount: true,
    can_add_individual_offers: true,
    user_id: user.id,
    username,
  };

  const person = existing
    ? await prisma.person.update({ where: { id: existing.id }, data })
    : await prisma.person.create({ data });

  console.log('✅ Hotovo:');
  console.log(`   User ID: ${user.id}  /  Person ID: ${person.id}`);
  console.log(`   Login:   ${username}`);
  console.log(`   Osoba:   ${displayName}  aktivní=${person.active}  obchodník=${person.is_salesperson}`);
  console.log('\n👉 Ověř přihlášení na app.holyos.cz, pak stejné údaje ve Velínu.\n');
}

main()
  .catch((err) => { console.error('❌ Chyba:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
