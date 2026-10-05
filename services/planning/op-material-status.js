// HolyOS — Stav materiálu pro naplánované operace (semafor do Plánu práce / kiosku)
//
// Pro každou BatchOperation spočítá, jestli na ni máme materiál:
//   on_site   🟢 materiál už je na vstupním skladu pracoviště (nebo skladník označil „připraveno")
//   in_stock  🔵 materiál je ve firmě skladem (jen přesun na pracoviště)
//   ordered   🟠 není skladem, ale chybějící množství pokrývá otevřená nákupní objednávka (ETA)
//   missing   🔴 chybí a NENÍ objednáno → zamakat na nákupu
//   none      ⚪ operace nemá žádný materiál
// Úroveň operace = nejhorší z jejích materiálů. Pozn.: sklad se nerozpočítává mezi dávky
// (stejný kus může „pokrývat" víc operací) — je to rychlý semafor, přesné MRP je u dávky.

const { prisma: defaultPrisma } = require('../../config/database');

const LEVEL_RANK = { none: 0, on_site: 1, in_stock: 2, ordered: 3, missing: 4 };

/**
 * @param {Array} ops  BatchOperation záznamy; potřebují: id, operation.id (ProductOperation),
 *                     batch.quantity, workstation.input_warehouse_id (volitelně)
 * @returns {Promise<Map<number, {level:string, materials:Array}>>}
 */
async function computeOpMaterialStatus(ops, opts = {}) {
  const tx = opts.tx || defaultPrisma;
  const result = new Map();
  if (!ops || !ops.length) return result;

  const prodOpIds = [...new Set(ops.map(o => o.operation && o.operation.id).filter(Boolean))];
  const opMats = prodOpIds.length ? await tx.operationMaterial.findMany({
    where: { operation_id: { in: prodOpIds } },
    select: { operation_id: true, material_id: true, quantity: true, unit: true, material: { select: { id: true, code: true, name: true, unit: true } } },
  }) : [];
  const matsByOp = new Map();
  for (const om of opMats) { if (!matsByOp.has(om.operation_id)) matsByOp.set(om.operation_id, []); matsByOp.get(om.operation_id).push(om); }
  const materialIds = [...new Set(opMats.map(m => m.material_id))];

  // Sklad per materiál + per sklad (kvůli „už na pracovišti")
  const stockRows = materialIds.length ? await tx.stock.findMany({
    where: { material_id: { in: materialIds } },
    select: { material_id: true, quantity: true, reserved_quantity: true, location: { select: { warehouse_id: true } } },
  }) : [];
  const stockTotal = new Map();   // material_id → available
  const stockByWh = new Map();    // material_id|warehouse_id → quantity
  for (const s of stockRows) {
    const avail = Number(s.quantity) - Number(s.reserved_quantity || 0);
    stockTotal.set(s.material_id, (stockTotal.get(s.material_id) || 0) + avail);
    const whId = s.location ? s.location.warehouse_id : null;
    if (whId) { const k = s.material_id + '|' + whId; stockByWh.set(k, (stockByWh.get(k) || 0) + Number(s.quantity)); }
  }

  // Otevřené nákupní objednávky (stejná logika jako MRP; ETA v minulosti = nepočítá se)
  const openItems = materialIds.length ? await tx.orderItem.findMany({
    where: {
      material_id: { in: materialIds },
      status: { notIn: ['completed', 'cancelled'] },
      order: { type: 'purchase', status: { notIn: ['delivered', 'cancelled', 'closed', 'done', 'completed'] } },
    },
    select: { material_id: true, quantity: true, delivered_quantity: true, expected_delivery: true, order: { select: { order_number: true, expected_delivery: true } } },
  }) : [];
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const onOrder = new Map(); // material_id → { qty, eta, orders[] }
  for (const oi of openItems) {
    const remaining = Number(oi.quantity || 0) - Number(oi.delivered_quantity || 0);
    if (remaining <= 0) continue;
    const eta = oi.expected_delivery || (oi.order && oi.order.expected_delivery) || null;
    if (eta && new Date(eta) < todayStart) continue;
    const cur = onOrder.get(oi.material_id) || { qty: 0, eta: null, orders: [] };
    cur.qty += remaining;
    if (eta && (!cur.eta || new Date(eta) < new Date(cur.eta))) cur.eta = eta;
    if (oi.order && oi.order.order_number && cur.orders.indexOf(oi.order.order_number) === -1) cur.orders.push(oi.order.order_number);
    onOrder.set(oi.material_id, cur);
  }

  // „Připraveno" ze čtečky
  const opIds = ops.map(o => o.id);
  const doneRows = await tx.materialPrepDone.findMany({ where: { batch_operation_id: { in: opIds }, kind: 'material' }, select: { batch_operation_id: true, material_id: true } }).catch(() => []);
  const doneSet = new Set(doneRows.map(d => d.batch_operation_id + '|' + d.material_id));

  for (const o of ops) {
    const mats = (o.operation && matsByOp.get(o.operation.id)) || [];
    const qty = Number((o.batch && o.batch.quantity) || 1);
    const whId = o.workstation ? o.workstation.input_warehouse_id : null;
    let worst = 'none';
    const details = mats.map(om => {
      const needed = Math.round(Number(om.quantity) * qty * 1000) / 1000;
      const onSite = whId ? (stockByWh.get(om.material_id + '|' + whId) || 0) : 0;
      const available = stockTotal.get(om.material_id) || 0;
      const po = onOrder.get(om.material_id) || { qty: 0, eta: null, orders: [] };
      let level;
      if (doneSet.has(o.id + '|' + om.material_id) || onSite >= needed) level = 'on_site';
      else if (available >= needed) level = 'in_stock';
      else if (po.qty >= needed - available) level = 'ordered';
      else level = 'missing';
      if (LEVEL_RANK[level] > LEVEL_RANK[worst]) worst = level;
      return {
        material_id: om.material_id, code: om.material ? om.material.code : null, name: om.material ? om.material.name : null,
        unit: om.unit || (om.material && om.material.unit) || '', needed, available: Math.round(available * 1000) / 1000, on_site: Math.round(onSite * 1000) / 1000,
        on_order: Math.round(po.qty * 1000) / 1000, eta: po.eta, orders: po.orders, level,
      };
    });
    result.set(o.id, { level: worst, materials: details });
  }
  return result;
}

module.exports = { computeOpMaterialStatus, LEVEL_RANK };
