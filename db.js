/* ============================================
   db.js — SQLite databáze pro HOLYOS

   Používá better-sqlite3 pro synchronní přístup.
   Data se ukládají do data/holyos.db (Railway Volume).
   ============================================ */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'holyos.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================
// Schema — Lidé a HR
// ============================================
db.exec(`
  -- Oddělení / organizační jednotky
  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES departments(id),
    color TEXT DEFAULT '#6c5ce7',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Role / pozice
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department_id INTEGER REFERENCES departments(id),
    description TEXT,
    permissions TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Lidé (univerzální — zaměstnanci, kontakty, dodavatelé, zákazníci)
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'employee' CHECK(type IN ('employee', 'contact', 'supplier', 'customer', 'external')),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    photo_url TEXT,
    notes TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Zaměstnanecká data (rozšíření people)
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
    employee_number TEXT,
    department_id INTEGER REFERENCES departments(id),
    role_id INTEGER REFERENCES roles(id),
    hire_date TEXT,
    contract_type TEXT CHECK(contract_type IN ('HPP', 'DPP', 'DPC', 'OSVČ', 'other')),
    hourly_rate REAL,
    monthly_salary REAL,
    supervisor_id INTEGER REFERENCES people(id),
    birth_date TEXT,
    address TEXT,
    bank_account TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Docházka
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    clock_in TEXT,
    clock_out TEXT,
    break_minutes INTEGER DEFAULT 30,
    type TEXT DEFAULT 'work' CHECK(type IN ('work', 'vacation', 'sick', 'holiday', 'other')),
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Index pro rychlé dotazy
  CREATE INDEX IF NOT EXISTS idx_people_type ON people(type);
  CREATE INDEX IF NOT EXISTS idx_people_active ON people(active);
  CREATE INDEX IF NOT EXISTS idx_employees_person ON employees(person_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_person_date ON attendance(person_id, date);
`);

console.log('✅ Database initialized:', DB_PATH);

module.exports = db;
