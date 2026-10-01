// HolyOS — Smazání všech pracovišť (restart výroby podle nového klíče)
//
// Co se stane:
//   - smažou se všechna Workstation + jejich WorkstationWorker (cascade)
//   - ProductOperation.workstation_id, ProductionSlot.workstation_id, BatchOperation.workstation_id → NULL
//     (výrobky, postupy, operace, sloty i dávky ZŮSTÁVAJÍ, jen přijdou o přiřazené pracoviště)
//   - haly zůstávají; s --halls se smažou i ty
// Před smazáním se uloží záloha do data/backups/workstations-<timestamp>.json.
//
// Použití (z kořene projektu, s DATABASE_URL na správnou DB):
//   node scripts/reset-workstations.js            # jen ukáže, co by se smazalo
//   node scripts/reset-workstations.js --commit   # opravdu smaže pracoviště
//   node scripts/reset-workstations.js --commit --halls   # smaže i haly
//
// Proti Railway DB z lokálu: DATABASE_URL=<DATABASE_PUBLIC_URL> node scripts/reset-workstations.js --commit

'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { prisma } = require('../config/database');

const COMMIT = process.argv.includes('--commit');
const HALLS = process.argv.includes('--halls');

async function main() {
  const ws = await prisma.workstation.findMany({ include: { workers: true, hall: true }, orderBy: { id: 'asc' } });
  const halls = await prisma.hall.findMany({ orderBy: { id: 'asc' } });
  const opsLinked = await prisma.productOperation.count({ where: { workstation_id: { not: null } } });
  const slotsLinked = await prisma.productionSlot.count({ where: { workstation_id: { not: null } } }).catch(() => 0);
  const bopsLinked = await prisma.batchOperation.count({ where: { workstation_id: { not: null } } }).catch(() => 0);

  console.log('Pracovišť:', ws.length, '| hal:', halls.length);
  console.log('Operací s přiřazeným pracovištěm (odpojí se):', opsLinked);
  console.log('Výrobních slotů s pracovištěm (odpojí se):', slotsLinked);
  console.log('Dávkových operací s pracovištěm (odpojí se):', bopsLinked);
  console.log('Přiřazení pracovníků (smažou se):', ws.reduce((s, w) => s + w.workers.length, 0));
  ws.forEach((w) => console.log('  -', w.id, w.name, w.hall ? '(' + w.hall.name + ')' : '', w.is_external ? '[kooperace]' : ''));

  // Záloha vždy (i nanečisto) — ať je co vrátit.
  const dir = path.join(__dirname, '..', 'data', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'workstations-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify({ exported_at: new Date().toISOString(), workstations: ws, halls }, null, 2));
  console.log('Záloha uložena:', file);

  if (!COMMIT) { console.log('\nNANEČISTO — nic nesmazáno. Spusť s --commit pro skutečné smazání' + (HALLS ? ' (včetně hal)' : '') + '.'); return; }

  const r = await prisma.workstation.deleteMany({});
  console.log('Smazáno pracovišť:', r.count);
  if (HALLS) { const h = await prisma.hall.deleteMany({}); console.log('Smazáno hal:', h.count); }
  console.log('Hotovo. Výrobky a postupy zůstaly, operace jsou bez pracoviště — v Pracovním postupu je přiřadíš k novým.');
}

main().catch((e) => { console.error('Chyba:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
