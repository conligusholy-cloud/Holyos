// =============================================================================
// HolyOS — Smazání naimportovaných objednávek (stav „Importováno")
// =============================================================================
// Smaže objednávky se stavem `imported` (import z Factorify) včetně jejich položek
// a uvolní případné přiřazené výrobní sloty (stejná logika jako DELETE /api/wh/orders/:id).
//
// Spuštění (lokálně proti Railway DB — DATABASE_URL v .env):
//   node scripts/delete-imported-orders.js                       (DRY-RUN — jen vypíše, co by smazal)
//   node scripts/delete-imported-orders.js --apply               (opravdu smaže — NEVRATNÉ)
//   node scripts/delete-imported-orders.js --type purchase       (jen nákupní; výchozí: všechny typy)
//   node scripts/delete-imported-orders.js --status imported,completed --prefix FY-   (i „Ukončeno" z Factorify)
//
// Objednávky navázané na fakturu nebo jiný záznam, který smazání brání, se přeskočí
// a vypíšou se na konci.

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

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argVal = (flag, def) => { const i = args.indexOf(flag); return (i !== -1 && args[i + 1]) ? args[i + 1] : def; };
const STATUSES = argVal('--status', 'imported').split(',').map((s) => s.trim()).filter(Boolean);
const TYPE = argVal('--type', '');
const PREFIX = argVal('--prefix', '');

async function main() {
  const where = { status: { in: STATUSES } };
  if (TYPE) where.type = TYPE;
  if (PREFIX) where.order_number = { startsWith: PREFIX };

  const orders = await prisma.order.findMany({ where, select: { id: true, order_number: true, type: true, status: true }, orderBy: { id: 'asc' } });
  const byKey = {};
  orders.forEach((o) => { const k = o.type + ' / ' + o.status; byKey[k] = (byKey[k] || 0) + 1; });
  console.log(`Nalezeno objednávek ke smazání: ${orders.length}`);
  Object.entries(byKey).forEach(([k, n]) => console.log(`  ${k}: ${n}`));
  if (orders.length) console.log('  např.: ' + orders.slice(0, 5).map((o) => o.order_number).join(', ') + (orders.length > 5 ? ', …' : ''));

  if (!APPLY) { console.log('\nDRY-RUN — nic nesmazáno. Pro skutečné smazání přidej --apply.'); return; }
  if (!orders.length) return;

  let ok = 0; const failed = [];
  for (const o of orders) {
    try {
      const assignments = await prisma.slotAssignment.findMany({ where: { order_id: o.id } });
      const slotIds = [...new Set(assignments.map((a) => a.slot_id))];
      await prisma.slotAssignment.deleteMany({ where: { order_id: o.id } });
      for (const sid of slotIds) {
        const remaining = await prisma.slotAssignment.count({ where: { slot_id: sid } });
        if (remaining === 0) await prisma.productionSlot.update({ where: { id: sid }, data: { status: 'open' } });
      }
      await prisma.order.delete({ where: { id: o.id } });
      ok++;
    } catch (e) { failed.push(`${o.order_number}: ${String(e.message).split('\n').pop()}`); }
  }
  console.log(`\nSmazáno: ${ok}, přeskočeno: ${failed.length}`);
  failed.slice(0, 20).forEach((f) => console.log('  ✗ ' + f));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
