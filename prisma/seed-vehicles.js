// =============================================================================
// HolyOS — Seed: Vozový park
// Import vozidel z Excelu "Evidence vozoveho parku.xlsx" do DB
// Spuštění: node prisma/seed-vehicles.js
// Idempotentní — vozidlo se identifikuje podle VIN (nebo SPZ, když VIN chybí).
// =============================================================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Normalizace kategorií na hodnoty používané v UI
function normalizeCategory(c) {
  if (!c) return 'Osobní vůz';
  const m = c.toLowerCase();
  if (m.includes('osobní')) return 'Osobní vůz';
  if (m.includes('dodávk')) return 'Dodávka';
  if (m.includes('nákl')) return 'Nákladní';
  if (m.includes('motocykl')) return 'Motocykl';
  if (m.includes('přív')) return 'Přívěsný vozík';
  if (m.includes('bagr') || m.includes('stroj')) return 'Pracovní stroj';
  return c;
}

const VEHICLES = [
  { license_plate: '7H6 5380', model: 'Peugeot Boxer',      vin: 'VF3YBCNFC12S23984', category: 'Dodávka',          insurance_from: '2026-04-07', insurance_to: '2027-02-24', stk_valid_to: '2027-03-26', toll_sticker_to: '2027-03-11', financing_to: '2026-03-28', financing_owner: 'Best Series s.r.o.' },
  { license_plate: '6H1 1946', model: 'Volkswagen Crafter', vin: 'WV1ZZZ2EZ96005532', category: 'Dodávka',          insurance_from: '2025-05-31', insurance_to: '2026-05-31', stk_valid_to: '2026-09-11', financing_owner: 'Best Series s.r.o.', disk_size: '6,5JX16/ET62       6,5JX17/ET62        6,5JX16/ET62', tire_size: '225/75 R16C 116R 235/60 R17C 117R 235/65 R16C 115R' },
  { license_plate: '7H5 0591', model: 'Hyundai i30',        vin: 'TMAH381AAMJ078808', category: 'Osobní vůz',       insurance_from: '2025-10-16', insurance_to: '2026-10-15', stk_valid_to: '2026-10-03', toll_sticker_to: '2027-03-11', financing_owner: 'Best Series s.r.o.', disk_size: '6,5JX16/ET50', tire_size: '205/55 R16 91H' },
  { license_plate: '7H6 5381', model: 'Hyundai i30',        vin: 'TMAH381AAMJ088957', category: 'Osobní vůz',       insurance_from: '2026-04-07', insurance_to: '2027-04-06', stk_valid_to: '2027-08-26', toll_sticker_to: '2027-03-11', financing_to: '2026-03-28', financing_owner: 'Best Series s.r.o.', disk_size: '6,5JX16/ET50', tire_size: '205/55 R16 91H' },
  { license_plate: '7H5 5673', model: 'Hyundai i30',        vin: 'TMAH381AAMJ078825', category: 'Osobní vůz',       insurance_from: '2025-10-16', insurance_to: '2026-10-15', stk_valid_to: '2026-10-16', toll_sticker_to: '2027-03-11', financing_owner: 'Best Series s.r.o.', disk_size: '6,5JX16/ET50', tire_size: '205/55 R16 91H' },
  { license_plate: '7H5 5764', model: 'Hyundai i20',        vin: 'NLHBM51HAMZ013983', category: 'Osobní vůz',       insurance_to: '2024-12-14', stk_valid_to: '2026-11-20', financing_owner: 'Best Series s.r.o.', disk_size: '6JX16/ET50            6JX15/ET47      6JX16/ET50       7JX17/ET54', tire_size: '195/55 R16 87H 185/65 R15 88H 195/55 R16 87H 215/45 R17 91V' },
  { license_plate: '7H6 5545', model: 'Hyundai i30',        vin: 'TMAH381AAMJ096812', category: 'Osobní vůz',       insurance_from: '2025-07-15', insurance_to: '2026-07-14', stk_valid_to: '2027-07-01', toll_sticker_to: '2026-08-05', financing_to: '2026-07-15', financing_owner: 'ESSOX s.r.o.', financing_type: 'operativni_leasing', disk_size: '6,5JX16/ET50', tire_size: '205/55 R16 91H' },
  { license_plate: '7H8 4570', model: 'Hyundai SANTA FE',   vin: 'KMHS581HHMU402236', category: 'Osobní vůz',       insurance_from: '2025-10-11', insurance_to: '2026-10-10', stk_valid_to: '2027-09-25', toll_sticker_to: '2026-11-16' },
  { license_plate: '7H8 4571', model: 'Hyundai SANTA FE',   vin: 'KMHS581HHMU402239', category: 'Osobní vůz',       insurance_from: '2025-10-11', insurance_to: '2026-10-10', stk_valid_to: '2027-11-28', financing_owner: 'Best Series s.r.o.' },
  { license_plate: null,       model: 'Mercedes-Benz GLS 450d 4MATIC šedá',  vin: 'W1NFF3DE5SB343449', category: 'Osobní vůz', insurance_from: '2026-04-15', insurance_to: '2026-04-14', financing_owner: 'Heidin Automotive CR' },
  { license_plate: null,       model: 'Mercedes-Benz GLS 450d 4MATIC černá', vin: 'W1NFF3DE2SB396660', category: 'Osobní vůz', financing_owner: 'Heidin Automotive CR' },
  { license_plate: '5H0 2281', model: 'Škoda YETI',         vin: 'TMBLD75LXC6085380', category: 'Osobní vůz',       insurance_from: '2026-02-23', insurance_to: '2027-02-22', stk_valid_to: '2027-09-24', financing_owner: 'Best Series s.r.o.' },
  { license_plate: '7H8 4853', model: 'Hyundai KONA',       vin: 'KMHK2813GNU847216', category: 'Osobní vůz',       stk_valid_to: '2028-02-07', financing_owner: 'Best Series s.r.o.', disk_size: '7JX17/ET50', tire_size: '215/55R17 94V' },
  { license_plate: '7H7 9238', model: 'Agados O1N1',        vin: 'TKXHA7175MANA0600', category: 'Přívěsný vozík',   insurance_from: '2026-03-25', insurance_to: '2027-03-24', stk_valid_to: '2027-04-07', financing_owner: 'Best Series s.r.o.', disk_size: '4,5X13 ET30', tire_size: '165/70 R13 79T' },
  { license_plate: '7H7 9264', model: 'Agados O2B2',        vin: 'TKXV31227LABB8402', category: 'Přívěsný vozík',   insurance_from: '2025-04-15', insurance_to: '2026-04-14', stk_valid_to: '2027-05-30', financing_owner: 'Best Series s.r.o.', disk_size: '5X13 ET30', tire_size: '165 R13C 96N' },
  { license_plate: null,       model: 'YANMAR',                     vin: 'YCESV17VCBBB17259', category: 'Pracovní stroj',   insurance_from: '2025-05-19', insurance_to: '2026-05-18', financing_owner: 'Best Series s.r.o.' },
  { license_plate: null,       model: 'YANMAR SV 18 CLASSIC',       vin: 'YCE0SV18VBBV05009', category: 'Pracovní stroj',   insurance_from: '2025-07-29', insurance_to: '2026-07-28', financing_owner: 'Best Series s.r.o.' },
  { license_plate: '1AIT208',  model: 'Hyundai i30',                 vin: null,              category: 'Osobní vůz' },
  { license_plate: '1AIT259',  model: 'Hyundai i30',                 vin: null,              category: 'Osobní vůz',       insurance_from: '2026-01-01', insurance_to: '2026-12-31' },
  { license_plate: '1AHA877',  model: 'Hyundai i30',                 vin: null,              category: 'Osobní vůz' },
  { license_plate: '1AHA891',  model: 'Hyundai i30',                 vin: null,              category: 'Osobní vůz',       insurance_from: '2026-01-01', insurance_to: '2026-12-31' },
];

function toDate(s) { return s ? new Date(s) : null; }

async function main() {
  let created = 0, updated = 0;

  for (const v of VEHICLES) {
    const data = {
      license_plate: v.license_plate || null,
      model: v.model,
      vin: v.vin || null,
      category: normalizeCategory(v.category),
      insurance_from:  toDate(v.insurance_from),
      insurance_to:    toDate(v.insurance_to),
      stk_valid_to:    toDate(v.stk_valid_to),
      toll_sticker_to: toDate(v.toll_sticker_to),
      financing_to:    toDate(v.financing_to),
      financing_owner: v.financing_owner || null,
      financing_type:  v.financing_type || null,
      disk_size: v.disk_size || null,
      tire_size: v.tire_size || null,
      active: true,
    };

    // Hledej existující vozidlo — nejdřív podle VIN, jinak podle SPZ, jinak podle (model + financing_owner)
    let existing = null;
    if (v.vin) existing = await prisma.vehicle.findFirst({ where: { vin: v.vin } });
    if (!existing && v.license_plate) existing = await prisma.vehicle.findFirst({ where: { license_plate: v.license_plate } });
    if (!existing) existing = await prisma.vehicle.findFirst({ where: { model: v.model, financing_owner: v.financing_owner || null, vin: null, license_plate: null } });

    if (existing) {
      await prisma.vehicle.update({ where: { id: existing.id }, data });
      updated++;
      console.log(`  ↻ Aktualizováno: ${v.license_plate || v.vin || v.model}`);
    } else {
      await prisma.vehicle.create({ data });
      created++;
      console.log(`  + Vytvořeno:    ${v.license_plate || v.vin || v.model}`);
    }
  }

  console.log(`\n✅ Hotovo — vytvořeno ${created}, aktualizováno ${updated} vozidel.`);
}

main()
  .catch(err => { console.error('❌ Chyba:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
