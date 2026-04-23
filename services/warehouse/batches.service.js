// HolyOS — Warehouse Batches service
//
// Pickovací dávky: skupina položek, které operátor postupně vychystává
// ze skladu. Stav batch_item: pending → picked (plně) / short (částečně) / skipped.

const { prisma } = require('../../config/database');
const { createMove } = require('./moves.service');
const lotsService = require('./lots.service');

const BATCH_STATUS = ['open', 'picking', 'done', 'cancelled'];
const ITEM_STATUS = ['pending', 'picked', 'short', 'skipped'];

/**
 * Vygeneruje číslo dávky BAT-{YEAR}-{0001}.
 */
async function generateBatchNumber(tx = prisma) {
  const year = new Date().getFullYear();
  const latest = await tx.batch.findFirst({
    where: { number: { startsWith: `BAT-${year}-` } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  let next = 1;
  if (latest) {
    const seq = Number(latest.number.split('-')[2]);
    if (Number.isFinite(seq)) next = seq + 1;
  }
  return `BAT-${year}-${String(next).padStart(4, '0')}`;
}

/**
 * Vytvoří dávku s položkami. Každá položka dostane sort_order podle pořadí ve vstupu
 * (pokud není explicitně zadáno) — PWA může využít jako navrženou trasu.
 */
async function createBatch({ sector, assigned_to, note, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Dávka musí mít alespoň jednu položku');
  }

  return prisma.$transaction(async (tx) => {
    const number = await generateBatchNumber(tx);
    const batch = await tx.batch.create({
      data: {
        number,
        sector: sector ?? null,
        status: 'open',
        assigned_to: assigned_to ?? null,
        note: note ?? null,
      },
    });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await tx.batchItem.create({
        data: {
          batch_id: batch.id,
          material_id: it.material_id,
          from_location_id: it.from_location_id ?? null,
          quantity: it.quantity,
          sort_order: it.sort_order ?? i,
          status: 'pending',
        },
      });
    }
    return tx.batch.findUnique({
      where: { id: batch.id },
      include: { items: { orderBy: { sort_order: 'asc' } } },
    });
  });
}

/**
 * Potvrď napickování jedné položky. Idempotentní přes client_uuid
 * (který se použije pro podřízený pohyb v inventory_movements).
 *
 * Pokud operátor napickoval méně než je požadováno, status bude 'short'.
 * Pokud plně, 'picked'. Pokud není co picknout (0), 'skipped'.
 *
 * Pokud se batch přepne z 'open' na 'picking' prvním reálným pickem,
 * started_at se nastaví. Pokud jsou všechny items picked/short/skipped,
 * batch je automaticky 'done' (lze to vrátit zpět explicitním completem).
 */
async function pickBatchItem({ batch_id, batch_item_id, picked_quantity, from_location_id, client_uuid, device_id, user_person_id, note }) {
  if (picked_quantity == null) throw new Error('picked_quantity je povinné');
  if (!client_uuid) throw new Error('client_uuid je povinný (idempotence)');

  // Většina práce mimo transakci (pick pohyb je sám v $transaction uvnitř moves.service).
  const batch = await prisma.batch.findUnique({ where: { id: batch_id } });
  if (!batch) throw new Error('Dávka neexistuje');
  if (batch.status === 'done' || batch.status === 'cancelled') {
    throw new Error(`Dávka je ve stavu '${batch.status}', pick není povolen`);
  }

  const item = await prisma.batchItem.findUnique({ where: { id: batch_item_id } });
  if (!item) throw new Error('Položka dávky neexistuje');
  if (item.batch_id !== batch_id) throw new Error('Položka nepatří do této dávky');

  const sourceLocation = from_location_id || item.from_location_id;

  let moveId = null;
  let lotIdUsed = null;
  if (Number(picked_quantity) > 0) {
    if (!sourceLocation) {
      throw new Error('Chybí from_location_id (ani v requestu, ani na položce dávky)');
    }

    // FIFO šarží: pokud materiál má expirable/distinguish_batches, vybereme
    // lot s nejbližší expirací, který má dost stocku pro celé `picked_quantity`.
    // Rozdělení přes víc šarží v jedné pick operaci nepodporujeme — operátor by
    // ho musel udělat jako několik separátních picků.
    const material = await prisma.material.findUnique({
      where: { id: item.material_id },
      select: { id: true, code: true, expirable: true, distinguish_batches: true },
    });
    if (material && (material.expirable || material.distinguish_batches)) {
      const candidates = await lotsService.listFifoCandidates({
        material_id: item.material_id,
        location_id: sourceLocation,
      });
      const enough = candidates.find(
        (s) => Number(s.quantity) >= Number(picked_quantity)
      );
      if (!enough) {
        const available = candidates
          .map((s) => `${s.lot.lot_code} (${s.quantity})`)
          .join(', ');
        throw new Error(
          `Žádná jednotlivá šarže na lokaci nemá ${picked_quantity} ks. K dispozici: ${available || 'žádné šarže'}. Rozděl pick ručně.`
        );
      }
      lotIdUsed = enough.lot_id;
    }

    const moveResult = await createMove({
      type: 'issue', // picking fakticky znamená výdej na zakázku
      client_uuid,
      device_id,
      material_id: item.material_id,
      warehouse_id: (await prisma.warehouseLocation.findUnique({ where: { id: sourceLocation }, select: { warehouse_id: true } })).warehouse_id,
      location_id: sourceLocation,
      lot_id: lotIdUsed, // null pro nešaržované, lot.id pro FIFO pick
      quantity: picked_quantity,
      reference_type: 'batch',
      reference_id: batch.id,
      created_by: user_person_id ?? null,
      note: lotIdUsed
        ? (note ? `${note} (lot ${lotIdUsed})` : `FIFO lot ${lotIdUsed}`)
        : note,
    });
    moveId = moveResult.move.id;
  }

  // Update stavu položky
  const pq = Number(picked_quantity);
  let newStatus;
  if (pq === 0) newStatus = 'skipped';
  else if (pq < Number(item.quantity)) newStatus = 'short';
  else newStatus = 'picked';

  const updated = await prisma.batchItem.update({
    where: { id: batch_item_id },
    data: {
      picked_quantity: pq,
      status: newStatus,
      picked_by: user_person_id ?? null,
      picked_at: new Date(),
      from_location_id: sourceLocation ?? item.from_location_id,
    },
  });

  // Pokud je batch ještě 'open', převeď na 'picking'
  if (batch.status === 'open') {
    await prisma.batch.update({
      where: { id: batch.id },
      data: { status: 'picking', started_at: new Date() },
    });
  }

  // Auto-done: když žádná položka není 'pending'
  const pendingLeft = await prisma.batchItem.count({
    where: { batch_id: batch.id, status: 'pending' },
  });
  if (pendingLeft === 0) {
    await prisma.batch.update({
      where: { id: batch.id },
      data: { status: 'done', completed_at: new Date() },
    });
  }

  return { item: updated, move_id: moveId, lot_id: lotIdUsed, auto_completed: pendingLeft === 0 };
}

/**
 * Rozdělený pick přes víc šarží — vyřeší případ, kdy žádná jednotlivá šarže
 * na lokaci nemá dost stocku pro celé `item.quantity`. Vytvoří po jednom
 * `issue` pohybu pro každý split v transakčním pořadí.
 *
 * `client_uuid_prefix` je UUID v4; z něj se deterministicky odvodí per-split
 * client_uuid (prefix s patched posledními 4 hex nibbles = index). Umožňuje
 * retry při síťové chybě — druhý send projde jako 200 deduped pro každý
 * split zvlášť.
 */
async function pickBatchItemMultiLot({
  batch_id,
  batch_item_id,
  splits, // [{ lot_id, quantity, from_location_id? }]
  client_uuid_prefix,
  device_id,
  user_person_id,
  note,
}) {
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new Error('splits musí obsahovat aspoň jednu položku');
  }
  if (!client_uuid_prefix) throw new Error('client_uuid_prefix je povinný (idempotence)');
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(client_uuid_prefix)) {
    throw new Error('client_uuid_prefix musí být platné UUID v4');
  }

  const batch = await prisma.batch.findUnique({ where: { id: batch_id } });
  if (!batch) throw new Error('Dávka neexistuje');
  if (batch.status === 'done' || batch.status === 'cancelled') {
    throw new Error(`Dávka je ve stavu '${batch.status}', pick není povolen`);
  }

  const item = await prisma.batchItem.findUnique({ where: { id: batch_item_id } });
  if (!item) throw new Error('Položka dávky neexistuje');
  if (item.batch_id !== batch_id) throw new Error('Položka nepatří do této dávky');

  // Sanity: součet split quantities > 0
  const totalPicked = splits.reduce((s, x) => s + Number(x.quantity || 0), 0);
  if (!Number.isFinite(totalPicked) || totalPicked <= 0) {
    throw new Error('Celkové picked_quantity musí být kladné');
  }

  // Získáme warehouse_id podle první lokace (všechny by měly být ze stejného warehouse)
  const firstLocationId = splits[0].from_location_id || item.from_location_id;
  if (!firstLocationId) {
    throw new Error('Chybí from_location_id (ani v requestu, ani na položce dávky)');
  }
  const firstLoc = await prisma.warehouseLocation.findUnique({
    where: { id: firstLocationId },
    select: { warehouse_id: true },
  });
  if (!firstLoc) throw new Error('Zdrojová lokace neexistuje');

  const moves = [];
  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    const locId = split.from_location_id || item.from_location_id;
    if (!locId) throw new Error(`Split #${i + 1}: chybí from_location_id`);
    const q = Number(split.quantity);
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error(`Split #${i + 1}: quantity musí být kladné`);
    }
    if (!split.lot_id) {
      throw new Error(`Split #${i + 1}: lot_id je povinný`);
    }

    // Derivace client_uuid: prefix s náhradou posledních 4 hex na hex zapis indexu.
    // Pro index < 65536 (splits je <=10 prakticky) se index vejde do 4 hex znaků.
    const idxHex = String(i).padStart(4, '0').slice(-4);
    const clientUuid = client_uuid_prefix.slice(0, -4) + idxHex;

    const mr = await createMove({
      type: 'issue',
      client_uuid: clientUuid,
      device_id,
      material_id: item.material_id,
      warehouse_id: firstLoc.warehouse_id,
      location_id: locId,
      lot_id: split.lot_id,
      quantity: q,
      reference_type: 'batch',
      reference_id: batch.id,
      created_by: user_person_id ?? null,
      note: note ? `${note} (split ${i + 1}/${splits.length}, lot ${split.lot_id})` : `split ${i + 1}/${splits.length}, lot ${split.lot_id}`,
    });
    moves.push({ move_id: mr.move.id, lot_id: split.lot_id, quantity: q, deduped: mr.deduped });
  }

  // Update batch_item
  let newStatus;
  if (totalPicked >= Number(item.quantity)) newStatus = 'picked';
  else if (totalPicked > 0) newStatus = 'short';
  else newStatus = 'skipped';

  const updated = await prisma.batchItem.update({
    where: { id: batch_item_id },
    data: {
      picked_quantity: totalPicked,
      status: newStatus,
      picked_by: user_person_id ?? null,
      picked_at: new Date(),
      from_location_id: firstLocationId,
    },
  });

  // Open → picking
  if (batch.status === 'open') {
    await prisma.batch.update({
      where: { id: batch.id },
      data: { status: 'picking', started_at: new Date() },
    });
  }

  // Auto-done
  const pendingLeft = await prisma.batchItem.count({
    where: { batch_id: batch.id, status: 'pending' },
  });
  if (pendingLeft === 0) {
    await prisma.batch.update({
      where: { id: batch.id },
      data: { status: 'done', completed_at: new Date() },
    });
  }

  return { item: updated, moves, total_picked: totalPicked, auto_completed: pendingLeft === 0 };
}

/**
 * Ruční uzavření dávky (i pokud nejsou všechny items picked).
 */
async function completeBatch(id) {
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) throw new Error('Dávka neexistuje');
  if (batch.status === 'done') return batch;
  return prisma.batch.update({
    where: { id },
    data: { status: 'done', completed_at: new Date() },
  });
}

module.exports = {
  createBatch, pickBatchItem, pickBatchItemMultiLot, completeBatch, generateBatchNumber,
  BATCH_STATUS, ITEM_STATUS,
};
