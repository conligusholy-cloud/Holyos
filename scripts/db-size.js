// HolyOS — diagnostika velikosti databáze (jen čtení, nic nemaže)
// Použití:  node scripts/db-size.js
// Bere DATABASE_URL z .env (nebo z prostředí). Pro Railway nastav veřejnou URL Postgresu (Public Networking).
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const db = await prisma.$queryRawUnsafe(`SELECT current_database() AS db, pg_size_pretty(pg_database_size(current_database())) AS velikost`);
    console.log('\nDatabáze:', db[0].db, '—', db[0].velikost, '\n');
    const rows = await prisma.$queryRawUnsafe(`
      SELECT relname AS tabulka,
             pg_size_pretty(pg_total_relation_size(relid)) AS celkem,
             pg_size_pretty(pg_relation_size(relid)) AS data,
             pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS indexy_toast,
             n_live_tup::bigint AS radku
      FROM pg_catalog.pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC LIMIT 20`);
    console.table(rows.map((r) => ({ tabulka: r.tabulka, celkem: r.celkem, data: r.data, 'indexy+toast': r.indexy_toast, radku: Number(r.radku) })));
  } catch (e) { console.error('Chyba:', e.message); }
  finally { await prisma.$disconnect(); }
})();
