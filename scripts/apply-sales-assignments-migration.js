// HolyOS — Obchod / role + přidělení / provize | Aplikace migrace 20260516120000
//
// Použití: node scripts/apply-sales-assignments-migration.js
//
// Aplikuje SQL z prisma/migrations/20260516120000_add_sales_assignments
// na DB konfigurovanou v prisma/schema.prisma (Railway přes DATABASE_URL).
//
// Kroky:
//   1. Ověří existenci migration.sql + odstraní BOM (PS 5.1 past)
//   2. `prisma db execute` — provede SQL
//   3. `prisma migrate resolve --applied` — zapíše do _prisma_migrations
//      (P3008 "already recorded as applied" je benigní)
//   4. `prisma generate` — regeneruje klienta

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const migName = '20260516120000_add_sales_assignments';
const migDir = path.join('prisma', 'migrations', migName);
const migFile = path.join(migDir, 'migration.sql');

if (!fs.existsSync(migFile)) {
  console.error(`CHYBA: ${migFile} neexistuje.`);
  process.exit(1);
}

// Odfiltruj případný BOM z migration.sql (PS 5.1 Out-File past).
const buf = fs.readFileSync(migFile);
if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
  console.log('Detekován BOM v migration.sql — odstraňuji a přepisuji bez BOM.');
  fs.writeFileSync(migFile, buf.slice(3));
}

function step(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}
function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}
function runAllowFailure(cmd) {
  console.log(`$ ${cmd}`);
  try { execSync(cmd, { stdio: 'inherit' }); return 0; }
  catch (err) { return err.status || 1; }
}

try {
  step('[1/3] Aplikuji migration.sql přes prisma db execute');
  run(`npx prisma db execute --file "${migFile}" --schema prisma/schema.prisma`);

  step('[2/3] Zaznamenávám migraci do _prisma_migrations (resolve --applied)');
  const code = runAllowFailure(`npx prisma migrate resolve --applied "${migName}"`);
  if (code !== 0) {
    console.log(`(migrate resolve skončil ${code} — pravděpodobně P3008 "already applied", pokračuji.)`);
  }

  step('[3/3] Regeneruji Prisma klienta');
  run('npx prisma generate');

  console.log('\n' + '='.repeat(70));
  console.log('HOTOVO — migrace add_sales_assignments je applied.');
  console.log('='.repeat(70));
  console.log('\nDalší krok: ujisti se, že nový sloupec funguje');
  console.log('   1) zkontroluj v DB:  SELECT COUNT(*) FROM sales_contact_assignments;');
  console.log('   2) deploy:  railway up   (nebo  git push  + počkej na auto-deploy)');
  console.log('   3) Person.role pro vedoucí obchodu nastav na "Vedoucí obchodu" (HR modul)');
  console.log('   4) Person.role pro obchodníky nastav na "Obchodník"\n');
} catch (err) {
  console.error('\nCHYBA při aplikaci migrace:', err.message);
  process.exit(1);
}
