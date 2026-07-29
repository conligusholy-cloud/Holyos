// =============================================================================
// HolyOS — Jednorázově zapnout sekci „Příklad" (show_example) u všech leadů,
// které mají zpřístupněnou sekci Investor (klíč „nabidka" ve visible_sections).
// =============================================================================
// Dry-run default; --apply zapíše. Leadů bez „nabidka" se nedotýká.
//
// Spuštění (lokálně proti Railway DB — DATABASE_URL v .env):
//   node scripts/enable-example-for-investor-leads.js            (DRY-RUN)
//   node scripts/enable-example-for-investor-leads.js --apply    (zápis do DB)

'use strict';

const fs = require('fs');
const path = require('path');
if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = t.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) process.env.DATABASE_URL = m[1].trim();
  } catch (e) { /* .env nemusí existovat */ }
}
const { prisma } = require('../config/database');

const APPLY = process.argv.includes('--apply');

function hasNabidka(csv) {
  return String(csv || '').split(',').map((s) => s.trim()).includes('nabidka');
}

(async function () {
  console.log(`\n=== Zapnutí sekce „Příklad" u Investor leadů ===`);
  console.log(`Režim: ${APPLY ? 'APPLY (zápis do DB)' : 'DRY-RUN (nic se nezapíše)'}\n`);

  // Kandidáti: mají „nabidka" v sekcích. Filtrujeme v JS (visible_sections je volný CSV text).
  const all = await prisma.compounderLead.findMany({
    where: { visible_sections: { contains: 'nabidka' } },
    select: { id: true, name: true, visible_sections: true, show_example: true },
    orderBy: { id: 'asc' },
  });
  const investorLeads = all.filter((l) => hasNabidka(l.visible_sections));
  const toEnable = investorLeads.filter((l) => !l.show_example);

  console.log(`Investor leadů (nabidka): ${investorLeads.length}`);
  console.log(`Z toho už má Příklad zapnutý: ${investorLeads.length - toEnable.length}`);
  console.log(`Ke změně (zapnout Příklad): ${toEnable.length}\n`);

  toEnable.forEach((l) => console.log(`  ${APPLY ? 'zapínám' : '[dry-run]'} #${l.id}  ${l.name}`));

  if (APPLY && toEnable.length) {
    const ids = toEnable.map((l) => l.id);
    const r = await prisma.compounderLead.updateMany({
      where: { id: { in: ids } },
      data: { show_example: true },
    });
    console.log(`\n✓ Aktualizováno záznamů: ${r.count}`);
  } else if (!APPLY) {
    console.log(`\nToto byl DRY-RUN. Pro skutečný zápis spusť znovu s příznakem --apply.`);
  } else {
    console.log(`\nNic k aktualizaci — všechny Investor leady už Příklad mají.`);
  }

  await prisma.$disconnect();
})().catch(async (e) => { console.error('Chyba:', e); await prisma.$disconnect(); process.exit(1); });
