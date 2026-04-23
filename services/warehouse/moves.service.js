// HolyOS — Warehouse Moves service (Sklad 2.0)
//
// Transakční zápis skladového pohybu + synchronní update Stock tabulky
// a backward-kompatibilního Material.current_stock.
//
// Idempotence: pokud přijde stejný client_uuid (např. PWA offline resend),
// vrátí se původní move a nic se nepřipíše.

const { prisma } = require('../../config/database');

const MOVE_TYPES = ['receipt', 'issue', 'transfer', 'adjustment', 'pick', 'inventory_adjust'];

/**
 * Rozhodni, na kterých lokacích a v jakém směru se projeví pohyb.
 * Vrací pole { location_id, delta } — delta je signed number,
 * které se aplikuje na Stock.quantity.
 *
 *   receipt        → +q na to_location (fallback location_id)
 *   issue          → −q na from_location (fallback location_id)
 *   transfer, pick → −q na from, +q na to
 *   adjustment     → ±q (quantity může být záporné) na location_id
 *   inventory_adjust → ±q (delta = actual − expected) na location_id
 */
function deriveStockDeltas(input) {
  const q = Number(input.quantity);
  const loc = input.location_id || null;
  const from = input.from_location_id || null;
  const to = input.to_location_id || null;

  const deltas = [];

  switch (input.type) {
    case 'receipt':
      if (!(to || loc)) throw new Error('receipt vyžaduje to_location_id nebo location_id');
      deltas.push({ location_id: to || loc, delta: q });
      break;
    case 'issue':
      if (!(from || loc)) throw new Error('issue vyžaduje from_location_id nebo location_id');
      deltas.push({ location_id: from || loc, delta: -q });
      break;
    case 'transfer':
    case 'pick':
      if (!from || !to) throw new Error(`${input.type} vyžaduje from_location_id i to_location_id`);
      if (from === to) throw new Error(`${input.type}: from a to nesmí být stejné`);
      deltas.push({ location_id: from, delta: -q });
      deltas.push({ location_id: to, delta: q });
      break;
    case 'adjustment':
    case 'inventory_adjust':
      if (!loc) throw new Error(`${input.type} vyžaduje location_id`);
      // q může být záporné (adjustment dolů)
      deltas.push({ location_id: loc, delta: q });
      break;
    default:
      throw new Error(`Neznámý typ pohybu: ${input.type}`);
  }
  return deltas;
}

/**
 * Upsert Stock řádku s atomickým delta zvýšením/snížením.
 * V Prisma 6 lze použít `quantity: { increment: delta }` (umí i záporné).
 *
 * Po zavedení MaterialLot (SKLAD 2.0) je Stock unikátní podle triplet
 * [material_id, location_id, lot_id]. Protože Prisma findUnique/upsert
 * neakceptuje NULL v compound key, pro nešaržované pohyby (lot_id=null)
 * obcházíme přes findFirst + update/create.
 */
async function applyStockDelta(tx, { material_id, location_id, lot_id = null, delta }) {
  if (lot_id == null) {
    const existing = await tx.stock.findFirst({
      where: { material_id, location_id, lot_id: null },
    });
    if (existing) {
      await tx.stock.update({
        where: { id: existing.id },
        data: { quantity: { increment: delta } },
      });
    } else {
      await tx.stock.create({
        data: { material_id, location_id, lot_id: null, quantity: delta },
      });
    }
    return;
  }
  await tx.stock.upsert({
    where: {
      material_id_location_id_lot_id: { material_id, location_id, lot_id },
    },
    create: { material_id, location_id, lot_id, quantity: delta },
    update: { quantity: { increment: delta } },
  });
}

/**
 * Hlavní vstupní bod. Vrací { move, deduped }.
 *
 * @param {object} input — odpovídá POST /api/wh/moves body
 * @param {number} input.material_id
 * @param {number} input.warehouse_id
 * @param {string} input.type — receipt | issue | transfer | adjustment | pick | inventory_adjust
 * @param {number} input.quantity — pro všechny typy kromě adjustment/inventory_adjust je kladné
 * @param {number} [input.location_id]
 * @param {number} [input.from_location_id]
 * @param {number} [input.to_location_id]
 * @param {number} [input.document_id]
 * @param {string} [input.client_uuid] — UUID v4 pro offline dedup
 * @param {string} [input.device_id]
 * @param {number} [input.created_by] — Person.id, ne User.id
 * @param {string} [input.reference_type]
 * @param {number} [input.reference_id]
 * @param {number} [input.unit_price]
 * @param {string} [input.note]
 */
async function createMove(input) {
  if (!MOVE_TYPES.includes(input.type)) {
    throw new Error(`Neznámý typ pohybu: ${input.type}`);
  }
  if (!input.quantity || !Number.isFinite(Number(input.quantity))) {
    throw new Error('quantity je povinný a musí být číslo');
  }
  if (['receipt', 'issue', 'transfer', 'pick'].includes(input.type) && Number(input.quantity) <= 0) {
    throw new Error(`${input.type} vyžaduje kladné quantity`);
  }

  // Lot status guard — pokud pohyb cílí na konkrétní šarži, ta musí být aktivní
  // (in_stock / consumed). Expired nebo scrapped šarže nelze pohybovat;
  // takové kusy musí být vyřazeny dedikovaným adjustment pohybem bez lot_id.
  if (input.lot_id != null) {
    const lot = await prisma.materialLot.findUnique({
      where: { id: input.lot_id },
      select: { id: true, status: true, lot_code: true, material_id: true },
    });
    if (!lot) throw new Error(`Šarže #${input.lot_id} neexistuje`);
    if (lot.material_id !== input.material_id) {
      throw new Error(`Šarže ${lot.lot_code} nepatří k materiálu #${input.material_id}`);
    }
    if (['expired', 'scrapped'].includes(lot.status)) {
      throw new Error(`Šarže ${lot.lot_code} je ve stavu '${lot.status}', pohyb není povolen`);
    }
  }

  const deltas = deriveStockDeltas(input);

  return prisma.$transaction(async (tx) => {
    // 1. Idempotence podle client_uuid
    if (input.client_uuid) {
      const existing = await tx.inventoryMovement.findUnique({
        where: { client_uuid: input.client_uuid },
      });
      if (existing) return { move: existing, deduped: true };
    }

    // 2. Vytvoř pohyb
    const move = await tx.inventoryMovement.create({
      data: {
        material_id: input.material_id,
        warehouse_id: input.warehouse_id,
        location_id: input.location_id ?? null,
        from_location_id: input.from_location_id ?? null,
        to_location_id: input.to_location_id ?? null,
        type: input.type,
        quantity: input.quantity,
        unit_price: input.unit_price ?? null,
        reference_type: input.reference_type ?? null,
        reference_id: input.reference_id ?? null,
        document_id: input.document_id ?? null,
        client_uuid: input.client_uuid ?? null,
        device_id: input.device_id ?? null,
        note: input.note ?? null,
        created_by: input.created_by ?? null,
      },
    });

    // 3. Stock: aplikuj delty (lot_id propaguje se z input — pro šaržované pohyby)
    for (const d of deltas) {
      await applyStockDelta(tx, {
        material_id: input.material_id,
        location_id: d.location_id,
        lot_id: input.lot_id ?? null,
        delta: d.delta,
      });
    }

    // 4. Backward-compat: aktualizuj Material.current_stock (součet přes všechny lokace)
    // Pro transfer/pick je součet delt 0, takže current_stock se nemění.
    const netDelta = deltas.reduce((s, d) => s + Number(d.delta), 0);
    if (netDelta !== 0) {
      await tx.material.update({
        where: { id: input.material_id },
        data: { current_stock: { increment: netDelta } },
      });
    }

    return { move, deduped: false };
  });
}

/**
 * Helper — vrátí Person.id pro daného User.id (nebo null).
 * Používá se v routes k převedení req.user.id → created_by.
 */
async function resolvePersonIdForUser(user) {
  if (!user) return null;
  if (user.person_id) return user.person_id;
  if (!user.id) return null;
  const p = await prisma.person.findFirst({
    where: { user_id: user.id },
    select: { id: true },
  });
  return p?.id ?? null;
}

module.exports = { createMove, resolvePersonIdForUser, MOVE_TYPES, deriveStockDeltas };
