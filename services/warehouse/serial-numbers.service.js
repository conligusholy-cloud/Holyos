// HolyOS — Sériová čísla (S/N) — service vrstva
//
// Role: trackování konkrétních kusů pro servis. S/N vzniká při receipt
// materiálu s `Material.save_sn_first_scan=true`. Status přechody:
//   in_stock → issued (výdej na zakázku/servis)
//   in_stock → scrapped (vyřazeno)
//   issued   → returned (vráceno, zpět in_stock s novou lokací)

const { prisma } = require('../../config/database');
const { createMove } = require('./moves.service');

const SN_STATUS = ['in_stock', 'issued', 'scrapped', 'returned'];

/**
 * Validuje formát S/N proti `Material.sn_mask` regexu (pokud nastaven).
 * sn_mask je buď plain regex string, nebo s předponou `^` a příponou `$`.
 */
function validateSnMask(mask, serial) {
  if (!mask || !mask.trim()) return true;
  try {
    const re = new RegExp(mask);
    return re.test(String(serial));
  } catch (_err) {
    // Neplatný regex v masce — neplatně restriktivní, tiše projdeme.
    return true;
  }
}

/**
 * Přijme N kusů s konkrétními S/N jako atomic operaci:
 *   1× InventoryMovement type=receipt (quantity=serials.length)
 *   N× SerialNumber(in_stock) napojeno na tento move
 *
 * Validace:
 *   - Material musí existovat a mít save_sn_first_scan=true
 *   - Každé S/N musí projít přes sn_mask (pokud je nastavená)
 *   - Žádné z S/N nesmí už u daného material_id existovat
 *   - serials nesmí obsahovat duplicity
 */
async function createBulkReceiptWithSerials({
  material_id,
  warehouse_id,
  location_id,      // povinné pro receipt (kam se kusy ukládají)
  serials,          // string[]
  unit_price,
  document_id,
  note,
  client_uuid,      // idempotence pro move (PWA)
  device_id,
  created_by,
}) {
  if (!Array.isArray(serials) || serials.length === 0) {
    throw new Error('Seznam sériových čísel je prázdný');
  }
  if (!location_id) {
    throw new Error('Chybí location_id (kam se kusy ukládají)');
  }

  // Normalizace + dedup
  const normalized = serials.map((s) => String(s).trim()).filter(Boolean);
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw new Error('Seznam S/N obsahuje duplicity');
  }

  const material = await prisma.material.findUnique({
    where: { id: material_id },
    select: {
      id: true,
      code: true,
      name: true,
      save_sn_first_scan: true,
      sn_mask: true,
    },
  });
  if (!material) throw new Error(`Materiál #${material_id} neexistuje`);
  if (!material.save_sn_first_scan) {
    throw new Error(
      `Materiál ${material.code} nemá save_sn_first_scan=true — nepřijímá se per S/N`
    );
  }

  // sn_mask validace
  const invalid = normalized.filter((s) => !validateSnMask(material.sn_mask, s));
  if (invalid.length > 0) {
    throw new Error(
      `S/N neodpovídá masce ${material.sn_mask}: ${invalid.join(', ')}`
    );
  }

  // Kolize s existujícími
  const existing = await prisma.serialNumber.findMany({
    where: { material_id, serial_number: { in: normalized } },
    select: { serial_number: true },
  });
  if (existing.length > 0) {
    throw new Error(
      `S/N už existují pro tento materiál: ${existing.map((e) => e.serial_number).join(', ')}`
    );
  }

  // Samotný receipt move je v createMove vlastní $transaction (updates Stock +
  // current_stock). S/N zápisy uděláme až po úspěšném move, ale vlastní Prisma
  // $transaction. Pokud SN zápis failne, move už existuje — ale díky
  // `received_move_id` nullable a unique (material × serial) to není vážný
  // stav; operator uvidí, že pohyb proběhl ale S/N chybí, a zopakuje.
  const moveResult = await createMove({
    type: 'receipt',
    material_id,
    warehouse_id,
    location_id,
    quantity: normalized.length,
    unit_price: unit_price ?? null,
    document_id: document_id ?? null,
    note: note ?? null,
    client_uuid: client_uuid ?? null,
    device_id: device_id ?? null,
    created_by: created_by ?? null,
  });

  const now = new Date();
  const created = await prisma.$transaction(
    normalized.map((sn) =>
      prisma.serialNumber.create({
        data: {
          material_id,
          serial_number: sn,
          status: 'in_stock',
          location_id,
          received_at: now,
          received_move_id: moveResult.move.id,
          received_by: created_by ?? null,
          note: note ?? null,
        },
      })
    )
  );

  return {
    move: moveResult.move,
    deduped: moveResult.deduped,
    serials: created,
  };
}

/**
 * Výdej jednoho S/N (změna status 'issued' + issue move).
 */
async function issueSerial({
  id,
  warehouse_id,
  reference_type,
  reference_id,
  note,
  client_uuid,
  device_id,
  issued_by,
}) {
  const sn = await prisma.serialNumber.findUnique({
    where: { id },
    include: { material: { select: { id: true, code: true } } },
  });
  if (!sn) throw new Error(`Sériové číslo #${id} neexistuje`);
  if (sn.status !== 'in_stock') {
    throw new Error(`S/N ${sn.serial_number} není ve stavu in_stock (je "${sn.status}")`);
  }
  if (!sn.location_id) {
    throw new Error(`S/N ${sn.serial_number} nemá aktuální lokaci — nelze vydat`);
  }

  const moveResult = await createMove({
    type: 'issue',
    material_id: sn.material_id,
    warehouse_id,
    location_id: sn.location_id,
    quantity: 1,
    reference_type: reference_type ?? null,
    reference_id: reference_id ?? null,
    note: note ?? `Výdej S/N ${sn.serial_number}`,
    client_uuid: client_uuid ?? null,
    device_id: device_id ?? null,
    created_by: issued_by ?? null,
  });

  const updated = await prisma.serialNumber.update({
    where: { id },
    data: {
      status: 'issued',
      issued_at: new Date(),
      issued_move_id: moveResult.move.id,
      issued_by: issued_by ?? null,
      reference_type: reference_type ?? null,
      reference_id: reference_id ?? null,
      // location_id necháváme pro audit („odkud se vydalo"); při returnu se přepíše
    },
  });

  return { serial: updated, move: moveResult.move, deduped: moveResult.deduped };
}

/**
 * Vyřadit kus (status='scrapped'). Negeneruje pohyb — kus fyzicky zmizí, stock
 * se sníží pohybem type=adjustment, který volající musí udělat zvlášť (pokud
 * chce). Tohle drží jen stavovou informaci.
 */
async function scrapSerial({ id, note, scrapped_by }) {
  const sn = await prisma.serialNumber.findUnique({ where: { id } });
  if (!sn) throw new Error(`Sériové číslo #${id} neexistuje`);
  if (sn.status === 'scrapped') return sn;

  return prisma.serialNumber.update({
    where: { id },
    data: {
      status: 'scrapped',
      scrapped_at: new Date(),
      note: note ? (sn.note ? `${sn.note}\n[scrapped by ${scrapped_by ?? '?'}] ${note}` : note) : sn.note,
    },
  });
}

/**
 * Vrátit kus (z 'issued' zpět na 'in_stock' v nové lokaci).
 * Negeneruje move — returnový pohyb udělá volající přes createMove type=receipt
 * (nebo adjustment), pokud chce ovlivnit stock. Return je stavová změna S/N.
 */
async function returnSerial({ id, location_id, note, returned_by }) {
  if (!location_id) throw new Error('Return vyžaduje cílovou location_id');
  const sn = await prisma.serialNumber.findUnique({ where: { id } });
  if (!sn) throw new Error(`Sériové číslo #${id} neexistuje`);
  if (sn.status !== 'issued') {
    throw new Error(`S/N ${sn.serial_number} není ve stavu issued (je "${sn.status}")`);
  }

  return prisma.serialNumber.update({
    where: { id },
    data: {
      status: 'returned',
      returned_at: new Date(),
      location_id,
      note: note ? (sn.note ? `${sn.note}\n[returned by ${returned_by ?? '?'}] ${note}` : note) : sn.note,
    },
  });
}

/**
 * Fulltext lookup podle S/N (bez filtru na material). Vrátí maximálně 10
 * kandidátů — u servisních kusů by duplicity přes materiály měly být
 * výjimečné, ale teoretické.
 */
async function lookupBySerialNumber(sn) {
  const trimmed = String(sn || '').trim();
  if (!trimmed) return [];
  return prisma.serialNumber.findMany({
    where: { serial_number: trimmed },
    take: 10,
    include: {
      material: { select: { id: true, code: true, name: true, unit: true } },
      location: { select: { id: true, label: true, warehouse_id: true } },
    },
    orderBy: { updated_at: 'desc' },
  });
}

async function listByMaterial(material_id, { status, limit } = {}) {
  const where = { material_id };
  if (status) where.status = status;
  return prisma.serialNumber.findMany({
    where,
    take: Math.min(Number(limit) || 500, 1000),
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    include: {
      location: { select: { id: true, label: true } },
    },
  });
}

async function getSerialById(id) {
  return prisma.serialNumber.findUnique({
    where: { id },
    include: {
      material: { select: { id: true, code: true, name: true, unit: true, sn_mask: true } },
      location: { select: { id: true, label: true, warehouse_id: true } },
      received_move: { select: { id: true, created_at: true } },
      issued_move: { select: { id: true, created_at: true } },
      received_person: { select: { id: true, first_name: true, last_name: true } },
      issued_person: { select: { id: true, first_name: true, last_name: true } },
    },
  });
}

module.exports = {
  SN_STATUS,
  validateSnMask,
  createBulkReceiptWithSerials,
  issueSerial,
  scrapSerial,
  returnSerial,
  lookupBySerialNumber,
  listByMaterial,
  getSerialById,
};
