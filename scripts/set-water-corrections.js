// HolyOS — Hromadné doplnění „Korekce vodoměru" ke strojům v provozu
// Spuštění (lokálně proti Railway DB — DATABASE_URL v .env):
//   node scripts/set-water-corrections.js            (DRY-RUN — jen vypíše, co by udělal)
//   node scripts/set-water-corrections.js --apply    (opravdu zapíše do DB)
//
// Stroje se párují podle názvu (bez diakritiky, malá písmena, shoda na začátek).
// Stejný název vícekrát (Karlovy Vary) → hodnoty se přiřadí strojům seřazeným podle ID
// v pořadí, v jakém jsou v seznamu níže. Neshodu/nejednoznačnost skript vypíše a nic nezapíše.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const DATA = [
  ['Příbram - Nový rybník - Pračka', 60],
  ['Karlovy Vary - OC Varyáda - Pračka', 50],
  ['Karlovy Vary - OC Varyáda - Pračka', 40],
  ['Boskovice - Tesco - Pračka', 15],
  ['Králíky - Penny - Pračka', 12],
  ['Říčany - Tesco - Pračka AL081818S-V', 0],
  ['Ivančice - Tesco - Pračka', -45],
  ['Kroměříž - Tesco - Pračka', -470],
  ['Mělník - Tesco - Pračka', -950],
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

(async () => {
  const machines = await prisma.serviceMachine.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true, water_correction: true } });
  // Pomocný výpis: node scripts/set-water-corrections.js --find Karlovy
  const fi = process.argv.indexOf('--find');
  if (fi > -1) {
    const q = norm(process.argv[fi + 1] || '');
    machines.filter((m) => norm(m.name).includes(q)).forEach((m) => console.log(`#${m.id}  ${m.name}  (korekce: ${m.water_correction == null ? '—' : m.water_correction})`));
    await prisma.$disconnect(); return;
  }
  // seskupit položky seznamu podle názvu
  const groups = new Map();
  DATA.forEach(([n, v]) => { const k = norm(n); if (!groups.has(k)) groups.set(k, { name: n, vals: [] }); groups.get(k).vals.push(v); });

  const plan = []; const problems = [];
  for (const [k, g] of groups) {
    let found = machines.filter((m) => norm(m.name) === k);
    if (!found.length) found = machines.filter((m) => norm(m.name).startsWith(k) || k.startsWith(norm(m.name)));
    if (found.length !== g.vals.length) { problems.push(`„${g.name}": v seznamu ${g.vals.length}×, v DB nalezeno ${found.length}× ${found.map((m) => '#' + m.id + ' ' + m.name).join(' | ')}`); continue; }
    found.forEach((m, i) => plan.push({ id: m.id, name: m.name, from: m.water_correction, to: g.vals[i] }));
  }
  plan.forEach((p) => console.log(`#${p.id}  ${p.name}  :  ${p.from == null ? '—' : p.from} → ${p.to}`));
  if (problems.length) { console.log('\nNEJEDNOZNAČNÉ / NENALEZENO (nezapsáno):'); problems.forEach((x) => console.log(' - ' + x)); }
  if (!APPLY) { console.log('\nDRY-RUN. Pro zápis spusť s --apply.'); }
  else {
    for (const p of plan) await prisma.serviceMachine.update({ where: { id: p.id }, data: { water_correction: p.to } });
    console.log(`\nZapsáno ${plan.length} strojů.`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
