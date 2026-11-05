// HolyOS — srovná názvy v ceníku hry s těmi v kódu.
// Potřeba jen jednou, kvůli dřívějšímu seedu, který uložil starý název
// („Známý na úřadě" místo „Známý řemeslník"). Od teď se název z databáze
// nepoužívá, takže tenhle skript je jen pro pořádek v tabulce.
//   node scripts/fix-game-price-names.js
const { prisma } = require('../config/database');
const ALL = require('../routes/game-account.routes')._defaults;

(async () => {
  let zmeneno = 0;
  for (const kind of Object.keys(ALL)) {
    const r = await prisma.gamePrice.findUnique({ where: { kind } });
    if (!r || r.name === ALL[kind].name) continue;
    await prisma.gamePrice.update({ where: { kind }, data: { name: ALL[kind].name } });
    console.log('  ' + kind.padEnd(10) + '"' + r.name + '" → "' + ALL[kind].name + '"');
    zmeneno++;
  }
  console.log(zmeneno ? 'Srovnáno: ' + zmeneno : 'Všechny názvy už sedí.');
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
