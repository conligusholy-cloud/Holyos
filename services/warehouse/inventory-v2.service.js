// HolyOS — Inventory v2 service
//
// Rozšíření nad existující `POST /api/wh/inventories/:id/complete`:
//   - lockLocations / unlockLocations podle InventoryItem.location_id
//   - finishInventoryWithAdjust — pro položky s difference ≠ 0 vygeneruje
//     inventory_adjust pohyby přes createMove (tj. srovná i Stock tabulku
//     a Material.current_stock).
//
// Stávající endpoint /complete necháváme beze změny (počítá difference
// a ukládá do InventoryItem, ale reálné pohyby negeneruje — historické
// chování pro dnešní web UI).

const { prisma } = require('../../config/database');
const { createMove } = require('./moves.service');

/**
 * Zamkne pro výdej/přesun všechny lokace, které jsou v items inventury.
 * (Přeskočí items bez location_id.)
 */
async function lockLocations(inventory_id) {
  const items = await prisma.inventoryItem.findMany({
    where: { inventory_id, location_id: { not: null } },
    select: { location_id: true },
    distinct: ['location_id'],
  });
  const ids = items.map(i => i.location_id);
  if (ids.length === 0) return { locked_count: 0 };

  await prisma.warehouseLocation.updateMany({
    where: { id: { in: ids } },
    data: { locked_for_inventory: true },
  });
  return { locked_count: ids.length, location_ids: ids };
}

async function unlockLocations(inventory_id) {
  const items = await prisma.inventoryItem.findMany({
    where: { inventory_id, location_id: { not: null } },
    select: { location_id: true },
    distinct: ['location_id'],
  });
  const ids = items.map(i => i.location_id);
  if (ids.length === 0) return { unlocked_count: 0 };

  await prisma.warehouseLocation.updateMany({
    where: { id: { in: ids } },
    data: { locked_for_inventory: false },
  });
  return { unlocked_count: ids.length, location_ids: ids };
}

/**
 * Dokonči inventuru a vygeneruj inventory_adjust pohyby pro rozdíly.
 *
 * Konvence: InventoryItem.difference = expected_qty − actual_qty.
 *   - difference > 0  → reálně méně, delta na stock je záporné
 *   - difference < 0  → reálně více, delta na stock je kladné
 *   - delta = -difference  (signed quantity pro inventory_adjust)
 *
 * Items bez location_id nebo bez actual_qty přeskočíme (nemáme kam delta zapsat).
 * Items, které už přispěly pohybem (např. opakované spuštění) se přeskočí přes client_uuid.
 */
async function finishInventoryWithAdjust(inventory_id, person_id) {
  const inv = await prisma.inventory.findUnique({ where: { id: inventory_id } });
  if (!inv) throw new Error('Inventura neexistuje');
  if (inv.status === 'completed') throw new Error('Inventura je už uzavřená');

  const items = await prisma.inventoryItem.findMany({
    where: { inventory_id },
    include: { material: { select: { id: true, unit: true } } },
  });

  const generated = [];
  let skipped_no_location = 0;
  let skipped_no_actual = 0;
  let skipped_no_diff = 0;

  for (const it of items) {
    if (!it.location_id) { skipped_no_location++; continue; }
    if (it.actual_qty == null) { skipped_no_actual++; continue; }
    const diff = Number(it.difference ?? (Number(it.expected_qty) - Number(it.actual_qty)));
    if (diff === 0) { skipped_no_diff++; continue; }

    // Deterministické client_uuid: 'inventory-{inv_id}-item-{item_id}' → jako v4 sub-hash.
    // Pro deduplikaci při opakovaném finish (který by neměl nastat, ale pro jistotu)
    // použijeme triviální mapping.
    const client_uuid = `00000000-0000-4000-8000-${String(inv.id).padStart(6, '0')}${String(it.id).padStart(6, '0')}`;

    try {
      const res = await createMove({
        type: 'inventory_adjust',
        material_id: it.material_id,
        warehouse_id: inv.warehouse_id,
        location_id: it.location_id,
        quantity: -diff,  // záporný diff = chybí → stock dolů
        reference_type: 'inventory',
        reference_id: inv.id,
        client_uuid,
        created_by: person_id ?? null,
        note: `Inventurní úprava pro položku #${it.id}`,
      });
      generated.push({ item_id: it.id, move_id: res.move.id, delta: -diff, deduped: res.deduped });
    } catch (e) {
      console.error(`[Inventory v2] Selhal adjust pro item ${it.id}:`, e.message);
      generated.push({ item_id: it.id, error: e.message });
    }
  }

  // Uvolni lokace + uzavři inventuru
  await unlockLocations(inventory_id);
  const completed = await prisma.inventory.update({
    where: { id: inventory_id },
    data: { status: 'completed', completed_at: new Date() },
  });

  return {
    inventory: completed,
    adjustments_count: generated.filter(g => g.move_id).length,
    skipped: {
      no_location: skipped_no_location,
      no_actual: skipped_no_actual,
      no_diff: skipped_no_diff,
    },
    generated,
  };
}

module.exports = { lockLocations, unlockLocations, finishInventoryWithAdjust };
