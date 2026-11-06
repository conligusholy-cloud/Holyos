// Ruční zápis do sítě hráčů: komu se připíše, že někoho do hry přivedl.
//
//   railway ssh
//   node scripts/game-sit.js LosDolaros Fresh Veseraj Horalka              jen ukáže
//   node scripts/game-sit.js LosDolaros Fresh Veseraj Horalka --provest    zapíše
//
// Hráče hledá podle nicku i podle názvu firmy. Když si není jistý, nic nezapíše
// a vypíše, co našel — vazba „kdo koho přivedl" se špatně bere zpátky.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const dt = (d) => (d ? new Date(d).toLocaleString('cs-CZ') : '—');

async function najdi(vyraz) {
  const q = vyraz.toLowerCase();
  const podleNicku = await prisma.gamePlayer.findMany({
    where: { nick_lower: q }, select: { id: true, nick: true, company: true },
  });
  if (podleNicku.length === 1) return { hrac: podleNicku[0], jak: 'nick' };
  const vsichni = await prisma.gamePlayer.findMany({
    select: { id: true, nick: true, company: true, disabled: true },
  });
  const shody = vsichni.filter((p) => !p.disabled && (
    (p.nick || '').toLowerCase().includes(q) || (p.company || '').toLowerCase().includes(q)));
  if (shody.length === 1) return { hrac: shody[0], jak: 'firma nebo část nicku' };
  return { hrac: null, jak: null, shody };
}

(async () => {
  const args = process.argv.slice(2);
  const provest = args.includes('--provest');
  const jmena = args.filter((x) => x !== '--provest');
  if (jmena.length < 2) {
    console.log('Použití: node scripts/game-sit.js <zvoucí> <přivedený…> [--provest]');
    process.exit(1);
  }
  const zvouciVyraz = jmena.shift();
  const z = await najdi(zvouciVyraz);
  if (!z.hrac) {
    console.log('\nZvoucího "' + zvouciVyraz + '" jsem nenašel jednoznačně.');
    (z.shody || []).forEach((p) => console.log('  možná: ' + p.nick + '  (' + (p.company || '') + ')'));
    process.exit(1);
  }
  console.log('\nZvoucí: ' + z.hrac.nick + '  (' + (z.hrac.company || '') + ', id ' + z.hrac.id + ')\n');

  const kZapisu = [];
  for (const v of jmena) {
    const r = await najdi(v);
    if (!r.hrac) {
      console.log('  ' + v + '  → NENAŠEL jsem ho jednoznačně'
        + ((r.shody || []).length ? ', může to být: ' + r.shody.map((p) => p.nick).join(', ') : ''));
      continue;
    }
    if (r.hrac.id === z.hrac.id) { console.log('  ' + v + '  → to je on sám, přeskakuji'); continue; }
    const p = await prisma.gamePlayer.findUnique({ where: { id: r.hrac.id } });
    const stav = p.invited_by_id === z.hrac.id ? 'už u něj zapsaný'
      : (p.invited_by_id ? 'POZOR: zapsaný u hráče ' + p.invited_by_id : 'zatím u nikoho');
    console.log('  ' + v + '  → ' + p.nick + '  (' + (p.company || '') + ', id ' + p.id
      + ', nalezen podle: ' + r.jak + ')  ' + stav);
    if (p.invited_by_id !== z.hrac.id) kZapisu.push(p);
  }

  if (!kZapisu.length) {
    console.log('\nNení co zapisovat.\n');
    await prisma.$disconnect();
    return;
  }
  if (!provest) {
    console.log('\nZapsalo by se ' + kZapisu.length + '×: ' + kZapisu.map((p) => p.nick).join(', '));
    console.log('Proveď to příkazem se stejnými jmény a --provest na konci.\n');
    await prisma.$disconnect();
    return;
  }
  for (const p of kZapisu) {
    await prisma.gamePlayer.update({
      where: { id: p.id },
      data: { invited_by_id: z.hrac.id, invited_at: p.invited_at || new Date() },
    });
    console.log('  zapsáno: ' + p.nick + ' → ' + z.hrac.nick);
  }
  const celkem = await prisma.gamePlayer.count({ where: { invited_by_id: z.hrac.id } });
  console.log('\n' + z.hrac.nick + ' má teď v síti ' + celkem + ' hráčů.');
  console.log('Provize za jejich už koupené stroje mu doběhnou, až otevře záložku Já'
    + (z.hrac.distributor_do && new Date(z.hrac.distributor_do) > new Date()
      ? '.' : ' — ale distribuci má neaktivní (do ' + dt(z.hrac.distributor_do) + '), takže až si ji zapne.'));
  console.log('');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
