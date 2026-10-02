// =============================================================================
// HolyOS — Plánovač: simulace termínu výroby (dry-run, nic se neukládá)
// =============================================================================
// „Když to teď dám do výroby, kdy nejdřív to bude hotové?"
// Uvnitř transakce vytvoří dočasnou dávku, vygeneruje operace z postupu, pustí
// plánovač (směny, fronty pracovišť, skupiny, paralelní operace, lidé) a MRP
// (dostupnost materiálu + dodací lhůty). Nakonec transakci ZAHODÍ (rollback),
// takže v DB nic nezůstane. Vrací nejdřívější reálný termín + úzká místa.
// =============================================================================

'use strict';

const { prisma } = require('../../config/database');
const { generateBatchOperationsForBatch } = require('./batch-operations');
const { scheduleBatch } = require('./scheduler');
const { computeMrpForBatch } = require('./mrp');

const ROLLBACK = Symbol('simulate-rollback');

/**
 * @param {object} p { product_id, quantity, start?, due_date?, ignore_stock?, priority? }
 * @returns {Promise<object>} { feasible, earliest_start, earliest_finish, due_date, meets_due, slack_hours, work_minutes, wait_minutes, operations, bottlenecks[], material }
 */
async function simulateProduction(p) {
  const productId = parseInt(p.product_id, 10);
  const qty = Math.max(1, parseInt(p.quantity, 10) || 1);
  const start = p.start ? new Date(p.start) : new Date();
  const due = p.due_date ? new Date(p.due_date) : null;
  const ignoreStock = !!p.ignore_stock;
  let out = null;

  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true, operations: { where: { is_staging: false }, select: { id: true, is_parallel: true, allowed_people: { select: { person_id: true } }, workstation_id: true, workstation_group_id: true, name: true, step_number: true } } } });
      if (!product) throw new Error('Výrobek nenalezen');
      if (!product.operations.length) throw new Error('Výrobek nemá pracovní postup');

      // 1) Materiál: MRP před plánováním → od kdy je materiál k dispozici (dodací lhůty)
      let material = { checked: !ignoreStock, shortages: [], material_ready_at: null };
      let materialStart = start;

      const batch = await tx.productionBatch.create({ data: { batch_number: 'SIM-' + Date.now(), product_id: productId, quantity: qty, status: 'planned', priority: p.priority != null ? parseInt(p.priority, 10) : 100, planned_start: start, note: 'simulace', is_test: true, ignore_stock: ignoreStock } });

      if (!ignoreStock) {
        try {
          const mrp = await computeMrpForBatch(batch.id, { tx });
          const short = (mrp.items || []).filter(it => (it.open_shortage != null ? it.open_shortage : it.shortage) > 0);
          let latest = null;
          material.shortages = short.map(it => {
            const lead = it.material && it.material.lead_time_days != null ? Number(it.material.lead_time_days) : null;
            const eta = it.expected_delivery ? new Date(it.expected_delivery) : (lead != null ? new Date(Date.now() + lead * 86400000) : null);
            if (eta && (!latest || eta > latest)) latest = eta;
            return { material: it.material ? { id: it.material.id, code: it.material.code, name: it.material.name } : null, needed: it.needed, available: it.available, shortage: it.open_shortage != null ? it.open_shortage : it.shortage, unit: it.unit, lead_time_days: lead, eta, supplier: it.supplier ? it.supplier.name : null };
          });
          material.material_ready_at = latest;
          if (latest && latest > materialStart) materialStart = latest;
        } catch (e) { material.error = e.message; }
      }
      if (materialStart.getTime() !== start.getTime()) await tx.productionBatch.update({ where: { id: batch.id }, data: { planned_start: materialStart } });

      // 2) Operace + plán
      await generateBatchOperationsForBatch(batch.id, { tx });
      const sch = await scheduleBatch(batch.id, { tx });

      const warnings = (sch.op_warnings || []).flatMap(w => w.warnings || []);
      const count = (pref) => warnings.filter(w => String(w).startsWith(pref)).length;
      const bottlenecks = [];
      const noPeopleOps = product.operations.filter(o => !(o.allowed_people || []).length).length;
      if (count('no_assignee_found')) bottlenecks.push({ type: 'people', severity: 'warn', text: count('no_assignee_found') + ' operací bez dostupného člověka' + (noPeopleOps ? ' (' + noPeopleOps + ' operací nemá definováno, kdo je smí dělat)' : '') });
      if (count('no_workstation_assigned')) bottlenecks.push({ type: 'workstation', severity: 'warn', text: count('no_workstation_assigned') + ' operací bez pracoviště' });
      if (count('group_all_busy_waiting') || count('pushed_by_queue')) bottlenecks.push({ type: 'queue', severity: 'info', text: 'Čekání na obsazená pracoviště: ' + (count('pushed_by_queue') + count('group_all_busy_waiting')) + '× (fronta jiných dávek)' });
      if (count('parallel_overflow')) bottlenecks.push({ type: 'parallel', severity: 'warn', text: count('parallel_overflow') + ' paralelních operací přesahuje své okno' });
      if (count('crossed_slot_block')) bottlenecks.push({ type: 'block', severity: 'info', text: 'Plán překračuje blokaci slotu' });
      if (material.shortages.length) bottlenecks.push({ type: 'material', severity: material.material_ready_at ? 'warn' : 'error', text: material.shortages.length + ' materiálů chybí na skladě' + (material.material_ready_at ? ' — po objednání k dispozici ' + material.material_ready_at.toLocaleDateString('cs-CZ') : ' (bez dodací lhůty — termín nelze spočítat)') });
      if (material.error) bottlenecks.push({ type: 'material', severity: 'info', text: 'MRP: ' + material.error });

      const finish = sch.plan_end ? new Date(sch.plan_end) : null;
      const meets = due && finish ? finish <= due : null;
      out = {
        product: { id: product.id, code: product.code, name: product.name }, quantity: qty,
        requested_start: start, earliest_start: sch.plan_start ? new Date(sch.plan_start) : materialStart, earliest_finish: finish,
        due_date: due, meets_due: meets, slack_hours: due && finish ? Math.round((due - finish) / 3600000 * 10) / 10 : null,
        operations_scheduled: sch.operations_scheduled, work_minutes: sch.work_minutes, wait_minutes: sch.wait_minutes, idle_pct: sch.idle_pct,
        shift: sch.shift_config, bottlenecks, material, feasible: !!finish && !bottlenecks.some(b => b.severity === 'error'),
        operations: (sch.operations || []).map(o => ({ planned_start: o.planned_start, planned_end: o.planned_end, minutes: o.minutes, assignee: o.assigned_person_name, warnings: o.warnings })),
      };
      throw ROLLBACK; // nic neukládat
    }, { timeout: 30000 });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return out;
}

module.exports = { simulateProduction };
