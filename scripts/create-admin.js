#!/usr/bin/env node
// =============================================================================
// HolyOS — Vytvoření admin uživatele
//
// Použití:
//   node scripts/create-admin.js [username] [password] [displayName]
//
// Příklad:
//   node scripts/create-admin.js tomas.holy heslo123 "Tomáš Holý"
// =============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin';
  const displayName = process.argv[4] || 'Administrátor';

  console.log(`\n🔧 Vytvářím admin uživatele: ${username}`);

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { username },
    update: {
      password_hash: hash,
      display_name: displayName,
      role: 'admin',
      is_super_admin: true,
    },
    create: {
      username,
      password_hash: hash,
      display_name: displayName,
      role: 'admin',
      is_super_admin: true,
    },
  });

  console.log(`✅ Uživatel vytvořen/aktualizován:`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Username: ${user.username}`);
  console.log(`   Display: ${user.display_name}`);
  console.log(`   Role: ${user.role}`);
  console.log(`   Super Admin: ${user.is_super_admin}\n`);
}

main()
  .catch((err) => {
    console.error('❌ Chyba:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
