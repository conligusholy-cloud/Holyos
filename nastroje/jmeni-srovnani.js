// Srovnání jmění: co hra hlásí dnes proti tomu, co si server spočítá sám.
//
// Nic nemění, jen čte a tiskne. Výpočet bydlí v services/game/srovnani.js,
// aby ho mohla použít i administrace — na produkční databázi je totiž vidět
// jen z běžícího serveru, z vývojového prostředí se na ni nedá připojit.
// Tenhle nástroj je proto k ruce na databázi, která je po ruce (testovací,
// nebo produkční tunel, když zrovna jde).
//
// Spustit: npm run hra:jmeni
'use strict';

const { prisma } = require('../config/database');
const { srovnani, tisk } = require('../services/game/srovnani');

(async () => {
  console.log(tisk(await srovnani()));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e && e.message);
  if (/reach database server/i.test(String(e && e.message))) {
    console.error('\nNa databázi odsud není vidět. Stejný přehled je v administraci hry:');
    console.error('  /api/game-admin/jmeni-srovnani');
  }
  try { await prisma.$disconnect(); } catch (x) { /* nevadí */ }
  process.exit(1);
});
