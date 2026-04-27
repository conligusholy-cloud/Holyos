// HolyOS — Plánovač Fáze 1 | Aplikace vygenerované migrace na DB + zápis do historie
//
// Použití: node scripts/apply-planovac-f1-migration.js <migration_name>
// Např.:   node scripts/apply-planovac-f1-migration.js 20260427180000_pridej-davky-kompetence-bom-snapshot
//
// Kroky:
//   1. Ověří, že adresář migrace existuje a má migration.sql
//   2. Spustí SQL proti DB přes `prisma db execute`
//   3. Zaznamená do _prisma_migrations tabulky přes `prisma migrate resolve --applied`
//   4. Regeneruje Prisma klienta

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const migName = process.argv[2];
if (!migName) {
  console.error('CHYBA: chybí parametr <migration_name>');
  console.error('Použití: node scripts/apply-planovac-f1-migration.js <migration_name>');
  process.exit(1);
}

const migDir = path.join('prisma', 'migrations', migName);
const migFile = path.join(migDir, 'migration.sql');

if (!fs.existsSync(migFile)) {
  console.error(`CHYBA: ${migFile} neexistuje. Spustil jsi nejdřív .\\scripts\\migrate-planovac-f1.ps1?`);
  process.exit(1);
}

// PowerShell 5.1 `Out-File -Encoding utf8` zapisuje BOM (EF BB BF),
// kvůli kterému Postgres hlásí "syntax error at or near ''". Odfiltruj BOM.
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

// Varianta, která NEHODÍ výjimku — jen zaloguje stderr a vrátí exit code.
// Používáme pro `migrate resolve`, protože P3008 ("already recorded as applied")
// je benigní stav při opakovaném běhu a nemá zastavit celý skript.
function runAllowFailure(cmd) {
  console.log(`$ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    return 0;
  } catch (err) {
    return err.status || 1;
  }
}

try {
  step('[1/3] Aplikuji migration.sql přes prisma db execute');
  run(`npx prisma db execute --file "${migFile}" --schema prisma/schema.prisma`);

  step('[2/3] Zaznamenávám migraci do _prisma_migrations (resolve --applied)');
  const resolveCode = runAllowFailure(`npx prisma migrate resolve --applied "${migName}"`);
  if (resolveCode !== 0) {
    console.log(`(migrate resolve skončil exit code ${resolveCode} — typicky P3008 "already recorded as applied", pokračuji dál.)`);
  }

  step('[3/3] Regeneruji Prisma klienta');
  run('npx prisma generate');

  console.log('\n' + '='.repeat(70));
  console.log('HOTOVO — migrace planovac-f1 je applied.');
  console.log('='.repeat(70));
  console.log('\nDalší krok: seed kompetencí:');
  console.log('   node scripts/seed-competencies.js');
} catch (e) {
  console.error('\nCHYBA při migraci. Zkontroluj output výše.');
  console.error('Pokud selhalo [1/3] db execute, DB je nedotčená (transakce Prisma rollbacke).');
  console.error('Pokud selhalo [2/3] resolve, DB je migrovaná, ale historie ne — zavolej mě.');
  process.exit(1);
}
