// Jednorázové vyrovnání starým hráčům. Noví začínají s mnohem vyšší
// hotovostí kvůli tutoriálu — kdo začal dřív, dostane rozdíl mezi svou původní
// a novou startovní hotovostí. Posílá se jako doručenka, kterou si hra připíše
// sama, takže se to nepřepíše synchronizací stavu.
//
// Běží při startu serveru a je idempotentní: každý hráč to dostane nejvýš
// jednou, protože doručenka má svůj klíč.
const { prisma } = require('../../config/database');

// Musí sedět s PROFILES v public/compounder/game/game.js.
const STARA = { opatrny: 500000, vyvazeny: 350000, dravy: 300000 };
const NOVA = { opatrny: 1500000, vyvazeny: 1400000, dravy: 1300000 };
// Kdo rozehrál hru před touhle chvílí, začínal ještě s původní hotovostí.
const MEZNIK = Date.parse('2026-11-06T18:00:00Z');
const KLIC = 'vyrovnani:startovni-hotovost';

async function vyrovnejStartovniHotovost() {
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false },
    select: { id: true, nick: true, state: true, created_at: true },
  });
  if (!hraci.length) return { poslano: 0, celkem: 0 };
  const uz = await prisma.gameDelivery.findMany({
    where: { kind: 'cash', spot_id: KLIC }, select: { player_id: true },
  });
  const hotovo = new Set(uz.map((d) => d.player_id));

  let poslano = 0, celkem = 0;
  for (const h of hraci) {
    if (hotovo.has(h.id)) continue;
    const st = h.state || {};
    const profil = st.profile;
    if (!profil || !STARA[profil]) continue;
    const zacal = Number(st.startedAt) || Date.parse(h.created_at);
    if (!(zacal < MEZNIK)) continue;
    const rozdil = NOVA[profil] - STARA[profil];
    if (!(rozdil > 0)) continue;
    await prisma.gameDelivery.create({
      data: {
        player_id: h.id, kind: 'cash', amount: rozdil, spot_id: KLIC,
        popis: 'Vyrovnání ' + rozdil.toLocaleString('cs-CZ') + ' L$ — noví hráči teď začínají '
          + 's vyšší hotovostí, tak ti doplácíme rozdíl.',
      },
    });
    poslano++; celkem += rozdil;
  }
  if (poslano) {
    console.log('[game] vyrovnani startovni hotovosti: ' + poslano + ' hracu, '
      + celkem.toLocaleString('cs-CZ') + ' L$');
  }
  return { poslano, celkem };
}

module.exports = { vyrovnejStartovniHotovost };
