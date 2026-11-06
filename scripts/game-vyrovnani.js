// Vyrovnání starým hráčům. Noví teď začínají s mnohem vyšší hotovostí kvůli
// tutoriálu — kdo začal dřív, dostane rozdíl mezi svou původní a novou
// startovní hotovostí. Posílá se jako doručenka, kterou si hra připíše sama,
// takže se to nepřepíše synchronizací stavu.
//
//   railway ssh
//   node scripts/game-vyrovnani.js              jen ukáže, komu a kolik
//   node scripts/game-vyrovnani.js --provest    pošle
//
// Každý hráč to dostane nejvýš jednou — doručenka má svůj klíč.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Musí sedět s PROFILES v public/compounder/game/game.js.
const STARA = { opatrny: 500000, vyvazeny: 350000, dravy: 300000 };
const NOVA = { opatrny: 1500000, vyvazeny: 1400000, dravy: 1300000 };
// Kdo rozehrál hru před touhle chvílí, začínal ještě s původní hotovostí.
const MEZNIK = Date.parse(process.env.MEZNIK || '2026-11-06T18:00:00Z');
const KLIC = 'vyrovnani:startovni-hotovost';

const cz = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
const dt = (d) => (d ? new Date(d).toLocaleString('cs-CZ') : '—');

(async () => {
  const provest = process.argv.includes('--provest');
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false },
    select: { id: true, nick: true, company: true, state: true, created_at: true },
    orderBy: { created_at: 'asc' },
  });
  const uz = await prisma.gameDelivery.findMany({
    where: { kind: 'cash', spot_id: KLIC }, select: { player_id: true },
  });
  const hotovo = new Set(uz.map((d) => d.player_id));

  console.log('\nMezník: ' + dt(MEZNIK) + '  (kdo rozehrál dřív, dostane rozdíl)\n');
  let celkem = 0, kusu = 0;
  for (const h of hraci) {
    const st = h.state || {};
    const profil = st.profile;
    if (!profil || !STARA[profil]) { console.log('  ' + h.nick + '  → nemá rozehranou hru'); continue; }
    if (hotovo.has(h.id)) { console.log('  ' + h.nick + '  → už vyrovnán'); continue; }
    const zacal = Number(st.startedAt) || Date.parse(h.created_at);
    if (!(zacal < MEZNIK)) { console.log('  ' + h.nick + '  → začal až po změně, nenáleží'); continue; }
    const rozdil = NOVA[profil] - STARA[profil];
    if (!(rozdil > 0)) { console.log('  ' + h.nick + '  → žádný rozdíl'); continue; }
    console.log('  ' + h.nick + '  (' + profil + ', začal ' + dt(zacal) + ')  → ' + cz(rozdil) + ' L$');
    celkem += rozdil; kusu++;
    if (provest) {
      await prisma.gameDelivery.create({
        data: {
          player_id: h.id, kind: 'cash', amount: rozdil, spot_id: KLIC,
          popis: 'Vyrovnání ' + cz(rozdil) + ' L$ — noví hráči teď začínají s vyšší hotovostí, '
            + 'tak ti doplácíme rozdíl.',
        },
      });
      console.log('      → posláno');
    }
  }
  console.log('');
  if (!kusu) console.log('Není koho vyrovnávat.');
  else if (provest) console.log('Posláno ' + kusu + '× v celkové výši ' + cz(celkem) + ' L$. '
    + 'Připíše se každému při nejbližším otevření hry.');
  else console.log('Vyrovnalo by se ' + kusu + '× v celkové výši ' + cz(celkem) + ' L$.\n'
    + 'Proveď to příkazem:  node scripts/game-vyrovnani.js --provest');
  console.log('');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
