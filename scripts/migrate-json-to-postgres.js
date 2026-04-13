#!/usr/bin/env node
// =============================================================================
// HolyOS — Migrační skript: JSON soubory → PostgreSQL
//
// Použití:
//   1. Nastav DATABASE_URL v .env
//   2. Spusť: npx prisma migrate dev
//   3. Spusť: node scripts/migrate-json-to-postgres.js
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── Pomocné funkce ────────────────────────────────────────────────────────

function loadJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ Soubor ${filename} neexistuje, přeskakuji`);
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`  ✗ Chyba při čtení ${filename}:`, err.message);
    return null;
  }
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function parseBool(val) {
  if (val === true || val === 1 || val === '1') return true;
  return false;
}

function parseDecimal(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ─── Migrace jednotlivých kolekcí ─────────────────────────────────────────

async function migrateUsers(data) {
  const users = data;
  if (!Array.isArray(users) || users.length === 0) return 0;

  let count = 0;
  for (const u of users) {
    // Převeď PBKDF2 hash na bcrypt (uživatelé budou muset resetovat heslo,
    // nebo ponecháme starý hash a přidáme fallback ověření)
    // Pro jednoduchost: nastavíme výchozí heslo, uživatel si změní
    const hash = await bcrypt.hash('changeme', 12);

    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        display_name: u.displayName || u.username,
        password_hash: hash,
        role: u.role || 'user',
        is_super_admin: parseBool(u.is_super_admin),
        created_at: parseDate(u.created) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateDepartments(items) {
  let count = 0;
  for (const d of items) {
    await prisma.department.upsert({
      where: { id: d.id },
      update: { name: d.name, color: d.color || null, parent_id: d.parent_id || null },
      create: {
        id: d.id,
        name: d.name,
        color: d.color || null,
        parent_id: d.parent_id || null,
        created_at: parseDate(d.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateRoles(items) {
  let count = 0;
  for (const r of items) {
    await prisma.role.upsert({
      where: { id: r.id },
      update: { name: r.name },
      create: {
        id: r.id,
        name: r.name,
        description: r.description || null,
        department_id: r.department_id || null,
        parent_role_id: r.parent_role_id || null,
        created_at: parseDate(r.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateShifts(items) {
  let count = 0;
  for (const s of items) {
    await prisma.shift.upsert({
      where: { id: s.id },
      update: { name: s.name },
      create: {
        id: s.id,
        name: s.name,
        type: s.type || 'fixed',
        start_time: s.start || null,
        end_time: s.end || null,
        hours_fund: parseDecimal(s.hours_fund) || 8.0,
        break_minutes: s.break_minutes || 30,
        created_at: parseDate(s.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migratePeople(items) {
  let count = 0;
  for (const p of items) {
    await prisma.person.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        type: p.type || 'employee',
        first_name: p.first_name || '',
        last_name: p.last_name || '',
        email: p.email || null,
        phone: p.phone || null,
        notes: p.notes || null,
        active: parseBool(p.active !== undefined ? p.active : true),
        employee_number: p.employee_number || null,
        hire_date: parseDate(p.hire_date),
        end_date: parseDate(p.end_date),
        contract_type: p.contract_type || null,
        hourly_rate: parseDecimal(p.hourly_rate),
        monthly_salary: parseDecimal(p.monthly_salary),
        bank_account: p.bank_account || null,
        birth_date: parseDate(p.birth_date),
        birth_number: p.birth_number || null,
        id_card_number: p.id_card_number || null,
        gender: p.gender || null,
        address: p.address || null,
        city: p.city || null,
        zip: p.zip || null,
        emergency_name: p.emergency_name || null,
        emergency_phone: p.emergency_phone || null,
        emergency_relation: p.emergency_relation || null,
        photo_url: p.photo_url || null,
        chip_number: p.chip_number || null,
        chip_card_id: p.chip_card_id || null,
        is_super_admin: parseBool(p.is_super_admin),
        username: p.username || null,
        leave_entitlement_days: p.leave_entitlement_days || null,
        leave_carryover: p.leave_carryover || null,
        department_id: p.department_id || null,
        role_id: p.role_id || null,
        supervisor_id: p.supervisor_id || null,
        shift_id: p.shift_id || null,
        created_at: parseDate(p.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateAbsenceTypes(items) {
  let count = 0;
  for (const a of items) {
    await prisma.absenceType.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        name: a.name,
        code: a.code,
        color: a.color || null,
        paid: parseBool(a.paid),
      },
    });
    count++;
  }
  return count;
}

async function migrateAttendance(items) {
  let count = 0;
  for (const a of items) {
    await prisma.attendance.create({
      data: {
        id: a.id,
        person_id: a.person_id,
        date: parseDate(a.date) || new Date(),
        clock_in: a.clock_in || null,
        clock_out: a.clock_out || null,
        break_minutes: a.break_minutes || 30,
        type: a.type || 'work',
        note: a.note || null,
        adjusted_clock_in: a.adjusted_clock_in || null,
        adjusted_clock_out: a.adjusted_clock_out || null,
        adjusted_break: a.adjusted_break || null,
        created_at: parseDate(a.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateCompanies(items) {
  let count = 0;
  for (const c of items) {
    await prisma.company.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        name: c.name || '',
        ico: c.ico || null,
        dic: c.dic || null,
        address: c.address || null,
        city: c.city || null,
        zip: c.zip || null,
        country: c.country || 'CZ',
        type: c.type || 'supplier',
        contact_person: c.contact_person || null,
        email: c.email || null,
        phone: c.phone || null,
        web: c.web || null,
        bank_account: c.bank_account || null,
        payment_terms_days: c.payment_terms_days || 14,
        notes: c.notes || null,
        active: parseBool(c.active !== undefined ? c.active : true),
        created_at: parseDate(c.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateMaterials(items) {
  let count = 0;
  for (const m of items) {
    await prisma.material.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        code: m.code || `MAT-${m.id}`,
        name: m.name || '',
        external_id: m.external_id || null,
        status: m.status || 'active',
        type: m.type || 'material',
        unit: m.unit || 'ks',
        barcode: m.barcode || null,
        unit_price: parseDecimal(m.unit_price),
        weighted_avg_price: parseDecimal(m.weighted_avg_price),
        current_stock: parseDecimal(m.current_stock) || 0,
        min_stock: parseDecimal(m.min_stock),
        max_stock: parseDecimal(m.max_stock),
        supplier_id: m.supplier_id || null,
        lead_time_days: parseDecimal(m.lead_time_days),
        weight: parseDecimal(m.weight),
        dimension: m.dimension || null,
        color: m.color || null,
        description: m.description || null,
        production_note: m.production_note || null,
        factorify_id: m.factorify_id || null,
        photo_url: m.photo_url || null,
        // Přenášíme všechna boolean pole
        non_stock: parseBool(m.non_stock),
        distinguish_batches: parseBool(m.distinguish_batches),
        mandatory_scan: parseBool(m.mandatory_scan),
        exact_consumption: parseBool(m.exact_consumption),
        expirable: parseBool(m.expirable),
        plan_orders: parseBool(m.plan_orders),
        created_at: parseDate(m.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateOrders(items) {
  let count = 0;
  for (const o of items) {
    await prisma.order.upsert({
      where: { id: o.id },
      update: {},
      create: {
        id: o.id,
        order_number: o.order_number || `ORD-${o.id}`,
        type: o.type || 'purchase',
        company_id: o.company_id,
        status: o.status || 'new',
        items_count: o.items_count || 0,
        total_amount: parseDecimal(o.total_amount) || 0,
        currency: o.currency || 'CZK',
        note: o.note || null,
        created_by: o.created_by || null,
        approved_by: o.approved_by || null,
        expected_delivery: parseDate(o.expected_delivery),
        delivered_at: parseDate(o.delivered_at),
        created_at: parseDate(o.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateOrderItems(items) {
  let count = 0;
  for (const i of items) {
    await prisma.orderItem.create({
      data: {
        id: i.id,
        order_id: i.order_id,
        material_id: i.material_id || null,
        name: i.name || '',
        quantity: parseDecimal(i.quantity) || 0,
        unit: i.unit || 'ks',
        unit_price: parseDecimal(i.unit_price) || 0,
        total_price: parseDecimal(i.total_price) || 0,
        expected_delivery: parseDate(i.expected_delivery),
        delivered_quantity: parseDecimal(i.delivered_quantity) || 0,
        status: i.status || 'pending',
        note: i.note || null,
      },
    });
    count++;
  }
  return count;
}

async function migrateWarehouses(items) {
  let count = 0;
  for (const w of items) {
    await prisma.warehouse.upsert({
      where: { id: w.id },
      update: {},
      create: {
        id: w.id,
        name: w.name || '',
        code: w.code || null,
        address: w.address || null,
        type: w.type || 'main',
        manager_id: w.manager_id || null,
        active: parseBool(w.active !== undefined ? w.active : true),
        created_at: parseDate(w.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateLeaveRequests(items) {
  let count = 0;
  for (const lr of items) {
    await prisma.leaveRequest.create({
      data: {
        id: lr.id,
        person_id: lr.person_id,
        type: lr.type || 'vacation',
        date_from: parseDate(lr.date_from) || new Date(),
        date_to: parseDate(lr.date_to) || new Date(),
        note: lr.note || null,
        status: lr.status || 'pending',
        approved_by: lr.approved_by || null,
        created_at: parseDate(lr.created_at) || new Date(),
      },
    });
    count++;
  }
  return count;
}

async function migrateAuditLog(data) {
  if (!Array.isArray(data)) return 0;
  let count = 0;
  for (const entry of data) {
    await prisma.auditLog.create({
      data: {
        timestamp: parseDate(entry.timestamp) || new Date(),
        user_name: entry.user?.username || null,
        user_display: entry.user?.displayName || null,
        action: entry.action || 'unknown',
        entity: entry.entity || 'unknown',
        entity_id: entry.entityId || null,
        description: entry.description || null,
        changes: entry.changes || null,
        // Snapshot je moc velký, přeskočíme
        snapshot: null,
      },
    });
    count++;
  }
  return count;
}

async function seedDefaultAbsenceTypes() {
  const defaults = [
    { id: 1, name: 'Oběd', code: 'lunch', color: '#f59e0b', paid: false },
    { id: 2, name: 'Lékař', code: 'doctor', color: '#3b82f6', paid: true },
    { id: 3, name: 'Soukromě', code: 'personal', color: '#8b5cf6', paid: false },
    { id: 4, name: 'Dovolená', code: 'vacation', color: '#10b981', paid: true },
    { id: 5, name: 'Nemocenská', code: 'sick', color: '#ef4444', paid: true },
    { id: 6, name: 'Home office', code: 'homeoffice', color: '#06b6d4', paid: true },
  ];

  let count = 0;
  for (const a of defaults) {
    await prisma.absenceType.upsert({
      where: { code: a.code },
      update: {},
      create: a,
    });
    count++;
  }
  return count;
}

// ─── Hlavní migrace ───────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  HolyOS — Migrace JSON → PostgreSQL             ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Načti hlavní databázi
  const hrData = loadJson('hr.json');
  const usersData = loadJson('users.json');
  const auditData = loadJson('audit-log.json');

  // hr.json může být prázdný — to je OK, začínáme s čistou DB
  const hr = hrData || {};

  // Pořadí migrace je důležité kvůli FK vazbám!
  const steps = [
    { name: 'Users', fn: () => migrateUsers(usersData || []) },
    { name: 'Departments', fn: () => migrateDepartments(hr.departments || []) },
    { name: 'Roles', fn: () => migrateRoles(hr.roles || []) },
    { name: 'Shifts', fn: () => migrateShifts(hr.shifts || []) },
    { name: 'Absence types', fn: () => migrateAbsenceTypes(hr.absence_types || []) },
    { name: 'People', fn: () => migratePeople(hr.people || []) },
    { name: 'Attendance', fn: () => migrateAttendance(hr.attendance || []) },
    { name: 'Leave requests', fn: () => migrateLeaveRequests(hr.leave_requests || []) },
    { name: 'Companies', fn: () => migrateCompanies(hr.companies || []) },
    { name: 'Warehouses', fn: () => migrateWarehouses(hr.warehouses || []) },
    { name: 'Materials', fn: () => migrateMaterials(hr.materials || []) },
    { name: 'Orders', fn: () => migrateOrders(hr.orders || []) },
    { name: 'Order items', fn: () => migrateOrderItems(hr.order_items || []) },
    { name: 'Audit log', fn: () => migrateAuditLog(auditData || []) },
    { name: 'Default absence types', fn: () => seedDefaultAbsenceTypes() },
  ];

  let totalMigrated = 0;

  for (const step of steps) {
    process.stdout.write(`  Migruji ${step.name}...`);
    try {
      const count = await step.fn();
      console.log(` ✓ ${count} záznamů`);
      totalMigrated += count;
    } catch (err) {
      console.log(` ✗ CHYBA: ${err.message}`);
      if (process.env.MIGRATION_STRICT === 'true') {
        throw err;
      }
    }
  }

  // Reset auto-increment sekvencí na správné hodnoty
  console.log('');
  console.log('  Resetuji sekvence...');
  const tables = [
    'users', 'departments', 'roles', 'shifts', 'absence_types',
    'people', 'attendance', 'leave_requests', 'companies',
    'warehouses', 'materials', 'orders', 'order_items', 'audit_log',
  ];

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${table}`
      );
    } catch {
      // Některé tabulky nemají autoincrement sekvenci
    }
  }

  console.log('');
  console.log(`  ═══════════════════════════════════════`);
  console.log(`  ✓ Migrace dokončena: ${totalMigrated} záznamů celkem`);
  console.log(`  ═══════════════════════════════════════`);
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatální chyba migrace:', err);
  await prisma.$disconnect();
  process.exit(1);
});
