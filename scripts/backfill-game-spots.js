// HolyOS — doplní zábory míst pro prádlomaty, které vznikly dřív, než tabulka
// game_spot_claims existovala. Bez toho je konkurence na mapě neviditelná.
//
// Spustit uvnitř Railway (databáze není z notebooku dostupná):
//   node scripts/backfill-game-spots.js          ← jen vypíše, co by udělal
//   node scripts/backfill-game-spots.js --zapsat ← opravdu zapíše
//
// Co dělá: projde uložené stavy hráčů, vezme jejich units a pro každý
// obsazený spot založí zábor. Místa, která už někdo drží, přeskočí.
const { prisma } = require('../config/database');
const ZAPSAT = process.argv.includes('--zapsat');

(async () => {
  const hraci = await prisma.gamePlayer.findMany({
    where: { state: { not: null } },
    select: { id: true, nick: true, state: true },
  });
  let nove = 0, bylo = 0, bezDat = 0;

  for (const h of hraci) {
    const units = Array.isArray(h.state && h.state.units) ? h.state.units : [];
    for (const u of units) {
      if (!u || !u.spotId) { bezDat++; continue; }
      const je = await prisma.gameSpotClaim.findUnique({ where: { spot_id: u.spotId } });
      if (je) { bylo++; continue; }
      const data = {
        spot_id: String(u.spotId).slice(0, 120),
        area_key: String(u.areaId || '').slice(0, 80) || 'neznama',
        player_id: h.id, nick: h.nick,
        model: String((u.eco && u.eco.model) || 'mini').slice(0, 10),
        rent: Math.max(0, Math.round((u.eco && u.eco.rent) || 0)),
        name: u.name ? String(u.name).slice(0, 160) : null,
        lat: typeof u.lat === 'number' ? u.lat : null,
        lon: typeof u.lon === 'number' ? u.lon : null,
      };
      console.log('  + ' + h.nick.padEnd(16) + (data.name || data.spot_id).padEnd(28) + data.model + ' · nájem ' + data.rent);
      if (ZAPSAT) await prisma.gameSpotClaim.create({ data });
      nove++;
    }
  }
  console.log('\n' + (ZAPSAT ? 'Zapsáno' : 'K zapsání') + ': ' + nove
    + ' | už mělo zábor: ' + bylo + (bezDat ? ' | bez id místa: ' + bezDat : ''));
  if (!ZAPSAT && nove) console.log('Spusť znovu s --zapsat, pokud to tak má být.');
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
