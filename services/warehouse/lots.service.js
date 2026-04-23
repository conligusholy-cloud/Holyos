// HolyOS — Šarže (material lots) — service vrstva
//
// Role: tracking konkrétních šarží materiálu s expirací. Use case:
//   - prádelna: detergenty s expirací, sledujeme od které šarže byl
//     odebrán kus do konkrétního cyklu
//   - potraviny, chemie: FIFO podle expirace (pickFIFO)
//
// Šarže vzniká při receipt materiálu s `Material.expirable=true` nebo
// `Material.distinguish_batches=true`. Status přechody:
//   in_stock → consumed (vychystáno do nuly)
//   in_stock → expired (ručně nebo cronem)
//   in_stock → scrapped (ruční výřaz)

const { prisma } = require('../../config/database');
const { createMove } = require('./moves.service');

const LOT_STATUS = ['in_stock', 'consumed', 'expired', 'scrapped'];

/**
 * Vypočítá expires_at z manufactured_at + Material.shelf_life, pokud to šarže
 * sama neposkytla. shelf_life_unit: day / month / year.
 */
function computeExpiresAt(manufactured_at, material) {
  if (!manufactured_at) return null;
  const shelfLife = Number(material?.shelf_life);
  if (!Number.isFinite(shelfLife) || shelfLife <= 0) return null;
  const base = new Date(manufactured_at);
  const unit = (material.shelf_life_unit || 'month').toLowerCase();
  if (unit === 'day') base.setDate(base.getDate() + shelfLife);
  else if (unit === 'year') base.setFullYear(base.getFullYear() + shelfLife);
  else base.setMonth(base.getMonth() + shelfLife); // default = month
  return base;
}

/**
 * Vytvoří šarži (bez pohybu) — pro případy, kdy se šarže eviduje dopředu.
 */
async function createLot({
  material_id,
  lot_code,
  manufactured_at,
  expires_at,
  supplier_id,
  supplier_lot_ref,
  received_by,
  note,
}) {
  if (!lot_code || !String(lot_code).trim()) {
    throw new Error('lot_code je povinný');
  }
  const material = await prisma.material.findUnique({
    where: { id: material_id },
    select: { id: true, code: true, expirable: true, distinguish_batches: true, shelf_life: true, shelf_life_unit: true },
  });
  if (!material) throw new Error(`Materiál #${material_id} neexistuje`);

  // Compute expires_at pokud chybí, ale je manufactured + shelf_life
  const finalExpires = expires_at ?? computeExpiresAt(manufactured_at, material);

  if (manufactured_at && finalExpires && new Date(manufactured_at) > new Date(finalExpires)) {
    throw new Error('manufactured_at musí být <= expires_at');
  }

  return prisma.materialLot.create({
    data: {
      material_id,
      lot_code: String(lot_code).trim(),
      manufactured_at: manufactured_at ? new Date(manufactured_at) : null,
      expires_at: finalExpires ? new Date(finalExpires) : null,
      supplier_id: supplier_id ?? null,
      supplier_lot_ref: supplier_lot_ref ?? null,
      received_by: received_by ?? null,
      note: note ?? null,
      status: 'in_stock',
    },
  });
}

/**
 * Přijmout celou šarži atomicky: 1 receipt move + MaterialLot + Stock.lot_id.
 * Vhodné pro dodávku, kde 1 zásilka = 1 šarže = známé množství.
 */
async function receiveLotWithMove({
  material_id,
  warehouse_id,
  location_id,
  quantity,
  lot_code,
  manufactured_at,
  expires_at,
  supplier_id,
  supplier_lot_ref,
  unit_price,
  document_id,
  note,
  client_uuid,
  device_id,
  created_by,
}) {
  if (!location_id) throw new Error('Chybí location_id');
  if (!lot_code || !String(lot_code).trim()) throw new Error('lot_code je povinný');
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new Error('quantity musí být kladná');

  const material = await prisma.material.findUnique({
    where: { id: material_id },
    select: { id: true, code: true, expirable: true, distinguish_batches: true, shelf_life: true, shelf_life_unit: true },
  });
  if (!material) throw new Error(`Materiál #${material_id} neexistuje`);
  if (!material.expirable && !material.distinguish_batches) {
    throw new Error(`Materiál ${material.code} není označen jako expirable / distinguish_batches — šarže nemá smysl`);
  }

  // Kolize lot_code
  const existing = await prisma.materialLot.findUnique({
    where: { material_id_lot_code: { material_id, lot_code: String(lot_code).trim() } },
  });
  if (existing) {
    throw new Error(`Šarže ${lot_code} už existuje pro tento materiál`);
  }

  const finalExpires = expires_at ?? computeExpiresAt(manufactured_at, material);

  // Nejdřív move — createMove má vlastní $transaction s Stock update.
  // POZNÁMKA: createMove teď neumí lot_id argument, takže Stock se vytvoří
  // s lot_id=NULL a my ho níže v samostatné transakci přemažeme / rozmíchame.
  const moveResult = await createMove({
    type: 'receipt',
    material_id,
    warehouse_id,
    location_id,
    quantity: q,
    unit_price: unit_price ?? null,
    document_id: document_id ?? null,
    note: note ?? `Šarže ${lot_code}`,
    client_uuid: client_uuid ?? null,
    device_id: device_id ?? null,
    created_by: created_by ?? null,
  });

  // MaterialLot + přemapování Stock řádku na lot_id.
  // Protože Stock triplet unique je [material_id, location_id, lot_id], a
  // createMove vytvořil řádek s lot_id=NULL, musíme:
  //   1) vytvořit MaterialLot
  //   2) vytvořit nový Stock řádek s lot_id a quantity=q (přesun z NULL lotu)
  //   3) snížit NULL-lot Stock řádek o q
  // V praxi, pokud materiál je expirable, nikdo by neměl dřív vytvořit NULL lot
  // stock — ale createMove to nerespektuje. Pro clean stav dělá přemapování.
  const result = await prisma.$transaction(async (tx) => {
    const lot = await tx.materialLot.create({
      data: {
        material_id,
        lot_code: String(lot_code).trim(),
        status: 'in_stock',
        manufactured_at: manufactured_at ? new Date(manufactured_at) : null,
        expires_at: finalExpires ? new Date(finalExpires) : null,
        supplier_id: supplier_id ?? null,
        supplier_lot_ref: supplier_lot_ref ?? null,
        received_at: new Date(),
        received_move_id: moveResult.move.id,
        received_by: created_by ?? null,
        note: note ?? null,
      },
    });

    // Rebalance Stock: vezmi z NULL lot řádku q, přidej do nového lot řádku q.
    // Prisma neakceptuje NULL v compound findUnique key, proto findFirst.
    const nullStock = await tx.stock.findFirst({
      where: { material_id, location_id, lot_id: null },
    });
    const takeFromNull = nullStock ? Math.min(Number(nullStock.quantity), q) : 0;

    if (takeFromNull > 0) {
      const newQty = Number(nullStock.quantity) - takeFromNull;
      if (newQty > 0) {
        await tx.stock.update({
          where: { id: nullStock.id },
          data: { quantity: newQty },
        });
      } else {
        await tx.stock.delete({ where: { id: nullStock.id } });
      }
    }

    const lotStock = await tx.stock.upsert({
      where: {
        material_id_location_id_lot_id: {
          material_id,
          location_id,
          lot_id: lot.id,
        },
      },
      create: {
        material_id,
        location_id,
        lot_id: lot.id,
        quantity: takeFromNull || q,
      },
      update: {
        quantity: { increment: takeFromNull || q },
      },
    });

    return { lot, stock: lotStock };
  });

  return {
    move: moveResult.move,
    deduped: moveResult.deduped,
    lot: result.lot,
    stock: result.stock,
  };
}

async function listByMaterial(material_id, { status, expiringWithinDays, limit } = {}) {
  const where = { material_id };
  if (status) where.status = status;
  if (expiringWithinDays != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + Number(expiringWithinDays));
    where.expires_at = { not: null, lte: cutoff };
  }
  return prisma.materialLot.findMany({
    where,
    take: Math.min(Number(limit) || 500, 1000),
    orderBy: [
      { status: 'asc' },
      { expires_at: 'asc' },
    ],
    include: {
      supplier: { select: { id: true, name: true } },
      stock_rows: {
        include: { location: { select: { id: true, label: true } } },
      },
    },
  });
}

async function getLotById(id) {
  return prisma.materialLot.findUnique({
    where: { id },
    include: {
      material: { select: { id: true, code: true, name: true, unit: true, shelf_life: true, shelf_life_unit: true } },
      supplier: { select: { id: true, name: true } },
      stock_rows: {
        include: { location: { select: { id: true, label: true, warehouse_id: true } } },
      },
      received_move: { select: { id: true, created_at: true, quantity: true } },
      received_person: { select: { id: true, first_name: true, last_name: true } },
    },
  });
}

async function lookupByLotCode(material_id, lot_code) {
  const trimmed = String(lot_code || '').trim();
  if (!trimmed) return null;
  return prisma.materialLot.findUnique({
    where: { material_id_lot_code: { material_id, lot_code: trimmed } },
    include: {
      material: { select: { id: true, code: true, name: true, unit: true } },
      stock_rows: {
        include: { location: { select: { id: true, label: true } } },
      },
    },
  });
}

/**
 * Kolektivní dashboard — šarže expirující do N dní napříč všemi materiály.
 */
async function getExpiring({ days = 30, limit = 200 } = {}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + Number(days));
  return prisma.materialLot.findMany({
    where: {
      status: 'in_stock',
      expires_at: { not: null, lte: cutoff },
    },
    orderBy: { expires_at: 'asc' },
    take: Math.min(Number(limit) || 200, 500),
    include: {
      material: { select: { id: true, code: true, name: true, unit: true } },
      stock_rows: {
        where: { quantity: { gt: 0 } },
        include: { location: { select: { id: true, label: true } } },
      },
    },
  });
}

/**
 * Ruční výřaz šarže — status → expired/scrapped. Pohyb to negeneruje —
 * pokud chceš srovnat stock, udělej `inventory_adjust` move zvlášť.
 */
async function changeLotStatus(id, newStatus, note) {
  if (!LOT_STATUS.includes(newStatus)) {
    throw new Error(`Neplatný status '${newStatus}' (povoleno: ${LOT_STATUS.join(', ')})`);
  }
  const lot = await prisma.materialLot.findUnique({ where: { id } });
  if (!lot) throw new Error(`Šarže #${id} neexistuje`);
  if (lot.status === newStatus) return lot;

  return prisma.materialLot.update({
    where: { id },
    data: {
      status: newStatus,
      note: note ? (lot.note ? `${lot.note}\n[${newStatus}] ${note}` : note) : lot.note,
    },
  });
}

/**
 * Hromadné markování prošlých šarží. Spustitelné z cronu / startupu / admin
 * endpointu. Vrací počet šarží, které přešly z in_stock na expired.
 *
 * Záměr: držet dashboard čistý a automaticky markovat, že materiál už nesmí
 * být vyskladněn (UI může takové lots skrýt, backend by měl blokovat pick
 * z expired lotu — to zatím nemáme, ale listFifoCandidates je respektuje).
 */
async function sweepExpiredLots({ cutoff } = {}) {
  const atMoment = cutoff ? new Date(cutoff) : new Date();
  const result = await prisma.materialLot.updateMany({
    where: {
      status: 'in_stock',
      expires_at: { not: null, lt: atMoment },
    },
    data: {
      status: 'expired',
    },
  });
  return { marked: result.count, at: atMoment.toISOString() };
}

/**
 * FIFO výběr šarží pro picking — vrátí seřazený seznam in_stock šarží na
 * konkrétní lokaci, oldest expires_at first (šarže bez expirace jako poslední).
 * Caller pak odebírá postupně podle potřeby.
 */
async function listFifoCandidates({ material_id, location_id }) {
  const stocks = await prisma.stock.findMany({
    where: {
      material_id,
      location_id,
      quantity: { gt: 0 },
      lot_id: { not: null },
    },
    include: {
      lot: true,
    },
  });
  const withLot = stocks
    .filter((s) => s.lot && s.lot.status === 'in_stock')
    .sort((a, b) => {
      const aExp = a.lot.expires_at ? new Date(a.lot.expires_at).getTime() : Infinity;
      const bExp = b.lot.expires_at ? new Date(b.lot.expires_at).getTime() : Infinity;
      return aExp - bExp;
    });
  return withLot;
}

module.exports = {
  LOT_STATUS,
  computeExpiresAt,
  createLot,
  receiveLotWithMove,
  listByMaterial,
  getLotById,
  lookupByLotCode,
  getExpiring,
  changeLotStatus,
  listFifoCandidates,
  sweepExpiredLots,
};
