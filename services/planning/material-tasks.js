// =============================================================================
// HolyOS — Plánovač: pokyny pro skladníka / čtečku (příprava materiálu na pracoviště)
// =============================================================================
// Z naplánovaných operací (BatchOperation.planned_start) vyrobí seznam úkolů:
//   1) MATERIÁL  — co přivézt ze skladu na vstupní sklad pracoviště před začátkem operace
//                  (spotřeba z postupu × počet kusů dávky)
//   2) PŘESUN    — rozpracovaný výrobek (WIP) z výstupního skladu pracoviště A na vstupní
//                  sklad pracoviště B, když další operace hlavní linie běží jinde
// Termín = plánovaný začátek operace minus rezerva (výchozí 60 min, ⚙️ production.material_lead_min).
// Zdroj materiálu = pozice s největší dostupnou zásobou (Stock), mimo cílové pracoviště.
// =============================================================================

'use strict';

const { prisma: defaultPrisma } = require('../../config/database');

async function computeMaterialTasks(opts = {}) {
  const tx = opts.prisma || defaultPrisma;
  const from = opts.from ? new Date(opts.from) : new Date(Date.now() - 86400000);
  const to = opts.to ? new Date(opts.to) : new Date(Date.now() + 14 * 86400000);
  let leadMin = 60;
  try { const { getSetting } = require('../settings'); const v = await getSetting('production.material_lead_min', { type: 'number', defaultValue: 60 }); if (Number.isFinite(Number(v))) leadMin = Number(v); } catch (e) { /* default */ }

  const ops = await tx.batchOperation.findMany({
    where: { planned_start: { not: null, lte: to }, planned_end: { gte: from }, status: { notIn: ['done', 'cancelled'] }, batch: { status: { in: ['planned', 'released', 'in_progress', 'paused'] }, ignore_stock: false } },
    select: {
      id: true, sequence: true, status: true, planned_start: true, planned_end: true,
      batch: { select: { id: true, batch_number: true, quantity: true, is_test: true, product: { select: { id: true, code: true, name: true } } } },
      operation: { select: { id: true, name: true, step_number: true, is_parallel: true, materials: { select: { quantity: true, unit: true, material: { select: { id: true, code: true, name: true, unit: true } } } } } },
      workstation: { select: { id: true, name: true, code: true, input_warehouse_id: true, input_location_id: true, output_warehouse_id: true, output_location_id: true,
        input_warehouse: { select: { id: true, name: true, code: true } }, input_location: { select: { id: true, label: true } },
        output_warehouse: { select: { id: true, name: true, code: true } }, output_location: { select: { id: true, label: true } } } },
    },
    orderBy: [{ batch_id: 'asc' }, { sequence: 'asc' }],
  });

  // Zásoby pro všechny potřebné materiály najednou
  const matIds = [...new Set(ops.flatMap(o => (o.operation.materials || []).map(m => m.material.id)))];
  const stock = matIds.length ? await tx.stock.findMany({ where: { material_id: { in: matIds }, quantity: { gt: 0 } }, select: { material_id: true, quantity: true, reserved_quantity: true, location: { select: { id: true, label: true, warehouse: { select: { id: true, name: true, code: true } } } } } }) : [];
  const stockByMat = new Map();
  for (const s of stock) { if (!stockByMat.has(s.material_id)) stockByMat.set(s.material_id, []); stockByMat.get(s.material_id).push(s); }

  const tasks = [];
  const dueOf = (d) => new Date(new Date(d).getTime() - leadMin * 60000);

  // 1) materiál na pracoviště
  for (const o of ops) {
    const ws = o.workstation;
    for (const m of o.operation.materials || []) {
      const needed = Math.round(Number(m.quantity) * Number(o.batch.quantity) * 1000) / 1000;
      if (needed <= 0) continue;
      const targetWhId = ws ? ws.input_warehouse_id : null;
      const cands = (stockByMat.get(m.material.id) || []).filter(s => !targetWhId || s.location.warehouse.id !== targetWhId).sort((a, b) => (Number(b.quantity) - Number(b.reserved_quantity)) - (Number(a.quantity) - Number(a.reserved_quantity)));
      const alreadyThere = (stockByMat.get(m.material.id) || []).filter(s => targetWhId && s.location.warehouse.id === targetWhId).reduce((sum, s) => sum + Number(s.quantity), 0);
      const src = cands[0] || null;
      const avail = src ? Number(src.quantity) - Number(src.reserved_quantity) : 0;
      let status = 'ok';
      if (alreadyThere >= needed) status = 'on_site';
      else if (!ws) status = 'no_workstation';
      else if (!targetWhId) status = 'no_target';
      else if (!src) status = 'no_stock';
      else if (avail < needed) status = 'partial';
      tasks.push({
        kind: 'material', due: dueOf(o.planned_start), start_at: o.planned_start, status,
        batch: { id: o.batch.id, batch_number: o.batch.batch_number, is_test: o.batch.is_test, product: o.batch.product },
        operation: { id: o.operation.id, step: o.operation.step_number, name: o.operation.name, batch_operation_id: o.id },
        item: { type: 'material', id: m.material.id, code: m.material.code, name: m.material.name }, qty: needed, unit: m.unit || m.material.unit || 'ks',
        from: src ? { warehouse: src.location.warehouse, location: { id: src.location.id, label: src.location.label }, available: avail } : null,
        to: ws ? { workstation: { id: ws.id, name: ws.name }, warehouse: ws.input_warehouse, location: ws.input_location } : null,
        on_site: alreadyThere,
      });
    }
  }

  // 2) přesun WIP mezi pracovišti (hlavní linie: operace N → N+1 na jiném pracovišti)
  const byBatch = new Map();
  for (const o of ops) { if (o.operation.is_parallel) continue; if (!byBatch.has(o.batch.id)) byBatch.set(o.batch.id, []); byBatch.get(o.batch.id).push(o); }
  for (const list of byBatch.values()) {
    list.sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], next = list[i];
      if (!prev.workstation || !next.workstation || prev.workstation.id === next.workstation.id) continue;
      tasks.push({
        kind: 'wip', due: dueOf(next.planned_start), start_at: next.planned_start, after: prev.planned_end,
        status: (prev.workstation.output_warehouse_id && next.workstation.input_warehouse_id) ? 'ok' : 'no_target',
        batch: { id: next.batch.id, batch_number: next.batch.batch_number, is_test: next.batch.is_test, product: next.batch.product },
        operation: { id: next.operation.id, step: next.operation.step_number, name: next.operation.name, batch_operation_id: next.id, prev_step: prev.operation.step_number, prev_name: prev.operation.name },
        item: { type: 'wip', id: next.batch.product.id, code: next.batch.product.code, name: next.batch.product.name + ' (rozpracováno po op. ' + prev.operation.step_number + ')' }, qty: Number(next.batch.quantity), unit: 'ks',
        from: { workstation: { id: prev.workstation.id, name: prev.workstation.name }, warehouse: prev.workstation.output_warehouse, location: prev.workstation.output_location },
        to: { workstation: { id: next.workstation.id, name: next.workstation.name }, warehouse: next.workstation.input_warehouse, location: next.workstation.input_location },
      });
    }
  }

  tasks.sort((a, b) => new Date(a.due) - new Date(b.due) || (a.kind === 'wip' ? 1 : -1));
  return { from, to, lead_minutes: leadMin, operations_checked: ops.length, tasks };
}

module.exports = { computeMaterialTasks };
