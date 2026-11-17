// Výpis transakcí jednoho hráče (jen čte, nic nezapisuje).
//
//   node scripts/game-transakce.js LenkaM
//   node scripts/game-transakce.js LenkaM 200        posledních 200 řádků (výchozí 80)
//
// Hráče hledá podle nicku nebo názvu firmy. Ukáže: stav uložené hry (kdy a jak velký),
// doručenky (peníze, stroje, zprávy), obchody na burze, podíly a půjčky.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const dt = (d) => (d ? new Date(d).toLocaleString('cs-CZ') : '—');
const kc = (n) => (n == null ? '' : Number(n).toLocaleString('cs-CZ') + ' L$');

async function main() {
  const q = String(process.argv[2] || '').toLowerCase();
  const limit = parseInt(process.argv[3], 10) || 80;
  if (!q) { console.log('Použití: node scripts/game-transakce.js <nick nebo firma> [počet]'); return; }
  const vsichni = await prisma.gamePlayer.findMany();
  const shody = vsichni.filter((p) => (p.nick || '').toLowerCase().includes(q) || (p.company || '').toLowerCase().includes(q));
  if (!shody.length) { console.log('Nikdo nenalezen.'); return; }
  if (shody.length > 1) {
    console.log('Našlo se víc hráčů, uprav hledání:');
    shody.forEach((p) => console.log('  #' + p.id + '  ' + p.nick + '  /  ' + (p.company || '—') + '  (založen ' + dt(p.created_at) + ')'));
    return;
  }
  const p = shody[0]; const id = p.id; const st = p.state || {};
  const kb = Math.round(JSON.stringify(st).length / 1024);
  const units = Array.isArray(st.units) ? st.units : [];
  console.log('═══ #' + id + ' ' + p.nick + ' / ' + (p.company || '—') + ' ═══');
  console.log('Založen:', dt(p.created_at), '· poslední přihlášení:', dt(p.last_login_at), p.disabled ? '· ZABLOKOVANÝ' : '');
  console.log('Uložený stav hry: naposledy', dt(p.state_at), '· verze', p.state_rev, '·', kb, 'kB');
  console.log('  hotovost', kc(Math.round(st.cash || 0)), '· prádlomatů', units.length,
    '· z nich se ziskem', units.filter((u) => u.eco && u.eco.profit > 0).length,
    '· součet eco.profit', kc(Math.round(units.reduce((a, u) => a + ((u.eco && u.eco.profit) || 0), 0))));

  const dor = await prisma.gameDelivery.findMany({ where: { player_id: id }, orderBy: { created_at: 'desc' }, take: limit });
  console.log('\n── Doručenky (posledních ' + dor.length + ') ──');
  dor.forEach((d) => console.log(dt(d.created_at).padEnd(20), (d.kind || '').padEnd(11), kc(d.amount).padStart(16),
    d.claimed_at ? '✓ přijato' : '… čeká  ', ' ', d.popis || d.text_kod || ''));

  const obch = await prisma.gameTrade.findMany({ where: { OR: [{ from_id: id }, { to_id: id }] }, orderBy: { created_at: 'desc' }, take: limit });
  console.log('\n── Burza: nabídky a obchody (' + obch.length + ') ──');
  obch.forEach((t) => console.log(dt(t.created_at).padEnd(20), ('#' + t.id).padEnd(7), t.from_nick + ' → ' + t.to_nick,
    '·', t.smer, t.predmet, kc(t.cena), '·', t.stav, t.data ? JSON.stringify(t.data) : ''));

  const pod = await prisma.gameEquity.findMany({ where: { OR: [{ firma_id: id }, { investor_id: id }] }, orderBy: { created_at: 'desc' } });
  console.log('\n── Podíly (' + pod.length + ') ──');
  pod.forEach((e) => console.log('#' + e.id, 'firma', e.firma_nick, '· investor', e.investor_nick, '·', Math.round(e.podil * 100) + ' %',
    '· cena', kc(e.cena), '· vyplaceno', kc(e.vyplaceno), '·', e.stav, '· další výplata', dt(e.dalsi_at), '· koupeno', dt(e.created_at)));

  const pujcky = await prisma.gameLoan.findMany({ where: { OR: [{ lender_id: id }, { borrower_id: id }] }, orderBy: { created_at: 'desc' } });
  console.log('\n── Půjčky (' + pujcky.length + ') ──');
  pujcky.forEach((l) => console.log('#' + l.id, l.lender_nick, '→', l.borrower_nick, kc(l.castka), '· splaceno', l.splaceno + '/' + l.mesicu,
    '· zmeškáno', l.zmeskano, '·', l.stav));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
