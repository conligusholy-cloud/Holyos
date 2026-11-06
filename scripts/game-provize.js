// Proč nepřišla provize. Vypíše celý řetěz: zvoucí → koho přivedl →
// co postavil → jaké doručenky mu z toho vznikly.
// Spouští se na Railway:  railway ssh   →   node scripts/game-provize.js LosDolaros
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const acct = require('../routes/game-account.routes');

const cz = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
const dt = (d) => (d ? new Date(d).toLocaleString('cs-CZ') : '—');

(async () => {
  const nick = (process.argv[2] || '').trim();
  if (!nick) {
    console.log('Použití: node scripts/game-provize.js <nick>');
    process.exit(1);
  }
  const p = await prisma.gamePlayer.findUnique({ where: { nick_lower: nick.toLowerCase() } });
  if (!p) { console.log('Takový hráč tu není: ' + nick); process.exit(1); }

  const aktivni = acct._distAktivni(p);
  console.log('\n=== ZVOUCÍ ===');
  console.log('  nick           ' + p.nick + '  (id ' + p.id + ')');
  console.log('  sdílené id     ' + (p.ref_id || '— CHYBÍ, odkaz nikam nevede'));
  console.log('  distributor do ' + dt(p.distributor_do) + (aktivni ? '  → AKTIVNÍ' : '  → NEAKTIVNÍ'));
  console.log('  provize celkem ' + cz(p.provize_celkem) + ' L$');

  // Koho přivedl — napevno i jen přes odkaz, ať je vidět, kde se vazba utrhla.
  const podleId = p.ref_id
    ? await prisma.gamePlayer.findMany({ where: { OR: [{ invited_by_id: p.id }, { invited_by_ref: p.ref_id }] },
        orderBy: { created_at: 'asc' } })
    : await prisma.gamePlayer.findMany({ where: { invited_by_id: p.id }, orderBy: { created_at: 'asc' } });

  console.log('\n=== PŘIVEDL (' + podleId.length + ') ===');
  if (!podleId.length) console.log('  nikoho — nikdo se nezaregistroval přes jeho odkaz');

  for (const h of podleId) {
    const vazba = h.invited_by_id === p.id ? 'napevno'
      : (h.invited_by_id ? 'POZOR: zapsán u hráče ' + h.invited_by_id : 'jen přes odkaz, invited_by_id CHYBÍ');
    console.log('\n  ' + h.nick + '  (id ' + h.id + ', založen ' + dt(h.created_at) + ')');
    console.log('    vazba        ' + vazba);
    console.log('    invited_by_ref ' + (h.invited_by_ref || '—'));

    const mista = await prisma.gameSpotClaim.findMany({ where: { player_id: h.id }, orderBy: { created_at: 'asc' } });
    console.log('    postavil     ' + mista.length + '×');
    mista.forEach((m) => {
      console.log('      ' + dt(m.created_at) + '  ' + String(m.model).toUpperCase() + '  ' + (m.name || m.spot_id));
    });
    if (mista.length) {
      const prvni = mista[0].created_at;
      const melBy = p.distributor_do && new Date(p.distributor_do).getTime() > new Date(prvni).getTime();
      console.log('    → při první stavbě měl zvoucí distribuci: ' + (melBy ? 'ANO' : 'NE'));
    }
  }

  const prov = await prisma.gameDelivery.findMany({
    where: { player_id: p.id, kind: 'cash', popis: { startsWith: 'Provize' } },
    orderBy: { id: 'asc' },
  });
  console.log('\n=== VYPLACENÉ PROVIZE (' + prov.length + ') ===');
  if (!prov.length) console.log('  žádná');
  prov.forEach((d) => {
    console.log('  ' + dt(d.created_at) + '  ' + cz(d.amount) + ' L$  '
      + (d.claimed_at ? 'vyzvednuto ' + dt(d.claimed_at) : 'ČEKÁ na vyzvednutí ve hře') + '  — ' + d.popis);
  });

  console.log('');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
