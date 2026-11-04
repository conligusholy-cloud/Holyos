// HolyOS — naplní ceník hry výchozími hodnotami z kódu.
// Spustit JEDNOU po migraci (uvnitř Railway, kde je databáze dostupná):
//   node scripts/seed-game-prices.js
// Pustit znovu nic nerozbije — už existující položky nechá být.
const { prisma } = require('../config/database');
const ALL = require('../routes/game-account.routes')._defaults;

(async () => {
  let nove = 0, bylo = 0;
  for (const kind of Object.keys(ALL)) {
    const d = ALL[kind];
    const je = await prisma.gamePrice.findUnique({ where: { kind } });
    if (je) { bylo++; continue; }
    await prisma.gamePrice.create({ data: { kind, price: d.price, laundry: d.laundry || null, name: d.name, active: true } });
    nove++;
    console.log('  + ' + kind.padEnd(10) + (d.price / 100) + ' Kč' + (d.laundry ? ' → ' + d.laundry.toLocaleString('cs-CZ') + ' L$' : ''));
  }
  console.log('Hotovo: nových ' + nove + ', už tam bylo ' + bylo);
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
