// Proč nepřišla provize. Vypíše celý řetěz: zvoucí → koho přivedl →
// co postavil → jaké doručenky mu z toho vznikly.
//
//   railway ssh
//   node scripts/game-provize.js LosDolaros              jen vypíše
//   node scripts/game-provize.js LosDolaros --doplatit   doplatí, co chybí
//
// Doplácí se jen stavby, které vznikly v době platné distribuce a na které
// ještě žádná doručenka není — dvakrát se tedy vyplatit nedá.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const acct = require('../routes/game-account.routes');

const DIST_PROVIZE = 0.10;
const CENY_STROJU = {
  mini: Math.round(35000 * 24.35 * 1.25),
  flex: Math.round(52000 * 24.35 * 1.25),
  max: Math.round(67000 * 24.35 * 1.25),
};
const cz = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
const dt = (d) => (d ? new Date(d).toLocaleString('cs-CZ') : '—');

(async () => {
  const nick = (process.argv[2] || '').trim();
  const doplatit = process.argv.includes('--doplatit');
  if (!nick) {
    console.log('Použití: node scripts/game-provize.js <nick> [--doplatit]');
    process.exit(1);
  }
  const p = await prisma.gamePlayer.findUnique({ where: { nick_lower: nick.toLowerCase() } });
  if (!p) { console.log('Takový hráč tu není: ' + nick); process.exit(1); }

  console.log('\n=== ZVOUCÍ ===');
  console.log('  nick           ' + p.nick + '  (id ' + p.id + ')');
  console.log('  sdílené id     ' + (p.ref_id || '— CHYBÍ, odkaz nikam nevede'));
  console.log('  distributor do ' + dt(p.distributor_do)
    + (acct._distAktivni(p) ? '  → AKTIVNÍ' : '  → NEAKTIVNÍ'));
  console.log('  provize celkem ' + cz(p.provize_celkem) + ' L$');

  // Koho přivedl — napevno i jen přes odkaz, ať je vidět, kde se vazba utrhla.
  const kde = [{ invited_by_id: p.id }];
  if (p.ref_id) kde.push({ invited_by_ref: p.ref_id });
  const lide = await prisma.gamePlayer.findMany({ where: { OR: kde }, orderBy: { created_at: 'asc' } });

  console.log('\n=== PŘIVEDL (' + lide.length + ') ===');
  if (!lide.length) console.log('  nikoho — nikdo se nezaregistroval přes jeho odkaz');

  // Co už mu bylo vyplaceno, ať se nic neplatí dvakrát.
  const hotove = await prisma.gameDelivery.findMany({
    where: { player_id: p.id, kind: 'cash', popis: { startsWith: 'Provize' } },
    orderBy: { id: 'asc' },
  });
  const jiz = new Set(hotove.map((d) => d.spot_id).filter(Boolean));

  let dluzno = 0, kusu = 0;
  for (const h of lide) {
    const vazba = h.invited_by_id === p.id ? 'napevno'
      : (h.invited_by_id ? 'POZOR: zapsán u hráče ' + h.invited_by_id : 'jen přes odkaz, invited_by_id CHYBÍ');
    console.log('\n  ' + h.nick + '  (id ' + h.id + ', založen ' + dt(h.created_at) + ')');
    console.log('    vazba          ' + vazba);
    console.log('    invited_by_ref ' + (h.invited_by_ref || '—'));

    const mista = await prisma.gameSpotClaim.findMany({
      where: { player_id: h.id }, orderBy: { created_at: 'asc' },
    });
    console.log('    postavil       ' + mista.length + '×');
    for (const m of mista) {
      const vdobe = p.distributor_do && new Date(m.created_at) <= new Date(p.distributor_do);
      const zaplaceno = jiz.has(m.spot_id);
      const castka = Math.round((CENY_STROJU[m.model] || CENY_STROJU.mini) * DIST_PROVIZE);
      let stav;
      if (zaplaceno) stav = 'provize už vyplacena';
      else if (!vdobe) stav = 'mimo platnou distribuci — nenáleží';
      else { stav = 'CHYBÍ provize ' + cz(castka) + ' L$'; dluzno += castka; kusu++; }
      console.log('      ' + dt(m.created_at) + '  ' + String(m.model).toUpperCase()
        + '  ' + (m.name || m.spot_id) + '  → ' + stav);

      if (doplatit && !zaplaceno && vdobe) {
        await prisma.gameDelivery.create({
          data: {
            player_id: p.id, kind: 'cash', amount: castka, spot_id: m.spot_id,
            popis: 'Provize ' + cz(castka) + ' L$ — ' + h.nick + ' postavil '
              + String(m.model).toUpperCase() + (m.name ? ' (' + m.name + ')' : ''),
          },
        });
        await prisma.gamePlayer.update({
          where: { id: p.id }, data: { provize_celkem: { increment: castka } },
        });
        console.log('        → DOPLACENO');
      }
      // Při té příležitosti srovnáme vazbu, ať příští stavba projde sama.
      if (doplatit && !h.invited_by_id && h.invited_by_ref === p.ref_id) {
        await prisma.gamePlayer.update({ where: { id: h.id }, data: { invited_by_id: p.id } });
        console.log('        → vazba doplněna napevno');
      }
    }
  }

  console.log('\n=== VYPLACENÉ PROVIZE (' + hotove.length + ') ===');
  if (!hotove.length) console.log('  žádná');
  hotove.forEach((d) => {
    console.log('  ' + dt(d.created_at) + '  ' + cz(d.amount) + ' L$  '
      + (d.claimed_at ? 'vyzvednuto ' + dt(d.claimed_at) : 'ČEKÁ na vyzvednutí ve hře')
      + '  — ' + d.popis);
  });

  console.log('');
  if (kusu && !doplatit) {
    console.log('Chybí ' + kusu + '× provize, celkem ' + cz(dluzno) + ' L$.');
    console.log('Doplatíš je příkazem:  node scripts/game-provize.js ' + p.nick + ' --doplatit');
  } else if (!kusu) {
    console.log('Nic nechybí.');
  }
  console.log('');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
