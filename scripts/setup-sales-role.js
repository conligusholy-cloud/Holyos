#!/usr/bin/env node
// =============================================================================
// HolyOS — Přiřadí obchodníkovi roli s modulovými právy
//
// Cíl: shodit sales_only na false, aby měl obchodník plnohodnotný Velín
// (Dnes / Chat / Notifikace / Já) a zároveň zůstal obchodníkem.
// sales_only = true nastává jen když obchodník nemá ROLI s právem != none.
//
// Založí/aktualizuje roli "Obchodník" s read právy na obchodní moduly
// a přiřadí ji zadané osobě (podle username).
//
// Použití:
//   node scripts/setup-sales-role.js <username>
// Příklad:
//   node scripts/setup-sales-role.js boris.kozuljevic
// =============================================================================

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ROLE_NAME = 'Obchodník';
const MODULES = ['obchod', 'prodejni-objednavky', 'velin', 'chat']; // read

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('❌ Použití: node scripts/setup-sales-role.js <username>');
    process.exit(1);
  }

  const person = await prisma.person.findFirst({ where: { username } });
  if (!person) {
    console.error(`❌ Nenašel jsem Person s username="${username}".`);
    process.exit(1);
  }

  // 1) Role "Obchodník"
  let role = await prisma.role.findFirst({ where: { name: ROLE_NAME } });
  if (!role) role = await prisma.role.create({ data: { name: ROLE_NAME, description: 'Obchodník — plný Velín + obchodní moduly' } });

  // 2) Práva (read) na obchodní moduly — idempotentně
  for (const module_id of MODULES) {
    await prisma.permission.upsert({
      where: { role_id_module_id: { role_id: role.id, module_id } },
      update: { access_level: 'read' },
      create: { role_id: role.id, module_id, access_level: 'read' },
    });
  }

  // 3) Přiřaď roli osobě
  await prisma.person.update({ where: { id: person.id }, data: { role_id: role.id } });

  console.log('✅ Hotovo:');
  console.log(`   ${person.first_name} ${person.last_name} (Person ${person.id}) → role "${ROLE_NAME}" (id ${role.id})`);
  console.log(`   Práva (read): ${MODULES.join(', ')}`);
  console.log('\n👉 Boris se musí ve Velínu ODHLÁSIT a znovu PŘIHLÁSIT — starý token má sales_only zapečený.\n');
}

main()
  .catch((err) => { console.error('❌ Chyba:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
