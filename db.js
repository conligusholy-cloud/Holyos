/* ============================================
   db.js — JSON file database for HOLYOS

   Simple JSON-file storage with auto-increment IDs.
   Data saved to data/hr.json (Railway Volume).
   ============================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'hr.json');

const DEFAULT_DATA = {
  _nextId: { people: 1, departments: 1, roles: 1, attendance: 1 },
  people: [],
  departments: [],
  roles: [],
  attendance: [],
};

// Load or initialize
let data;
try {
  data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  // Ensure all collections exist
  for (const key of Object.keys(DEFAULT_DATA)) {
    if (!(key in data)) data[key] = DEFAULT_DATA[key];
  }
} catch (e) {
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function now() { return new Date().toISOString(); }

function nextId(collection) {
  if (!data._nextId[collection]) data._nextId[collection] = 1;
  return data._nextId[collection]++;
}

// ============================================
// Generic CRUD helpers
// ============================================
const db = {
  // --- People ---
  getAllPeople(filters = {}) {
    let results = data.people.filter(p => {
      if (filters.type && p.type !== filters.type) return false;
      if (filters.active !== undefined && filters.active !== '' && p.active !== parseInt(filters.active)) return false;
      if (filters.search) {
        const s = filters.search.toLowerCase();
        if (!((p.first_name || '').toLowerCase().includes(s) ||
              (p.last_name || '').toLowerCase().includes(s) ||
              (p.email || '').toLowerCase().includes(s))) return false;
      }
      return true;
    });
    // Join department and role names
    return results.map(p => {
      const dept = data.departments.find(d => d.id === p.department_id);
      const role = data.roles.find(r => r.id === p.role_id);
      return { ...p, department_name: dept ? dept.name : null, role_name: role ? role.name : null };
    }).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
  },

  getPersonById(id) {
    const p = data.people.find(x => x.id === id);
    if (!p) return null;
    const dept = data.departments.find(d => d.id === p.department_id);
    const role = data.roles.find(r => r.id === p.role_id);
    return { ...p, department_name: dept ? dept.name : null, role_name: role ? role.name : null };
  },

  createPerson(fields) {
    const person = {
      id: nextId('people'),
      type: fields.type || 'employee',
      first_name: fields.first_name,
      last_name: fields.last_name,
      email: fields.email || null,
      phone: fields.phone || null,
      notes: fields.notes || null,
      active: 1,
      // Employee fields (stored flat for simplicity)
      employee_number: fields.employee_number || null,
      department_id: fields.department_id ? parseInt(fields.department_id) : null,
      role_id: fields.role_id ? parseInt(fields.role_id) : null,
      hire_date: fields.hire_date || null,
      contract_type: fields.contract_type || null,
      hourly_rate: fields.hourly_rate ? parseFloat(fields.hourly_rate) : null,
      monthly_salary: fields.monthly_salary ? parseFloat(fields.monthly_salary) : null,
      supervisor_id: fields.supervisor_id ? parseInt(fields.supervisor_id) : null,
      birth_date: fields.birth_date || null,
      address: fields.address || null,
      bank_account: fields.bank_account || null,
      photo_url: fields.photo_url || null,
      chip_number: fields.chip_number || null,
      is_super_admin: fields.is_super_admin ? 1 : 0,
      // Auth link
      user_id: fields.user_id || null,
      username: fields.username || null,
      created_at: now(),
      updated_at: now(),
    };
    data.people.push(person);
    save();
    return person;
  },

  updatePerson(id, fields) {
    const idx = data.people.findIndex(p => p.id === id);
    if (idx === -1) return null;
    const existing = data.people[idx];
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && k !== 'id' && k !== 'created_at') {
        existing[k] = v;
      }
    }
    existing.updated_at = now();
    data.people[idx] = existing;
    save();
    return existing;
  },

  deletePerson(id) {
    const idx = data.people.findIndex(p => p.id === id);
    if (idx === -1) return false;
    data.people.splice(idx, 1);
    // Also delete attendance records
    data.attendance = data.attendance.filter(a => a.person_id !== id);
    save();
    return true;
  },

  // --- Departments ---
  getAllDepartments() {
    return [...data.departments].sort((a, b) => a.name.localeCompare(b.name));
  },

  createDepartment(fields) {
    const dept = {
      id: nextId('departments'),
      name: fields.name,
      parent_id: fields.parent_id ? parseInt(fields.parent_id) : null,
      color: fields.color || '#6c5ce7',
      created_at: now(),
    };
    data.departments.push(dept);
    save();
    return dept;
  },

  updateDepartment(id, fields) {
    const dept = data.departments.find(d => d.id === id);
    if (!dept) return null;
    if (fields.name !== undefined) dept.name = fields.name;
    if (fields.parent_id !== undefined) dept.parent_id = fields.parent_id ? parseInt(fields.parent_id) : null;
    if (fields.color !== undefined) dept.color = fields.color;
    save();
    return dept;
  },

  deleteDepartment(id) {
    const idx = data.departments.findIndex(d => d.id === id);
    if (idx === -1) return false;
    data.departments.splice(idx, 1);
    save();
    return true;
  },

  // --- Roles ---
  getAllRoles() {
    return data.roles.map(r => {
      const dept = data.departments.find(d => d.id === r.department_id);
      return { ...r, department_name: dept ? dept.name : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
  },

  createRole(fields) {
    const role = {
      id: nextId('roles'),
      name: fields.name,
      department_id: fields.department_id ? parseInt(fields.department_id) : null,
      description: fields.description || null,
      created_at: now(),
    };
    data.roles.push(role);
    save();
    return role;
  },

  updateRole(id, fields) {
    const role = data.roles.find(r => r.id === id);
    if (!role) return null;
    if (fields.name !== undefined) role.name = fields.name;
    if (fields.department_id !== undefined) role.department_id = fields.department_id ? parseInt(fields.department_id) : null;
    if (fields.description !== undefined) role.description = fields.description;
    save();
    return role;
  },

  deleteRole(id) {
    const idx = data.roles.findIndex(r => r.id === id);
    if (idx === -1) return false;
    data.roles.splice(idx, 1);
    save();
    return true;
  },

  // --- Attendance ---
  getAttendance(filters = {}) {
    let results = data.attendance.filter(a => {
      if (filters.person_id && a.person_id !== parseInt(filters.person_id)) return false;
      if (filters.month && !a.date.startsWith(filters.month)) return false;
      if (filters.from && a.date < filters.from) return false;
      if (filters.to && a.date > filters.to) return false;
      return true;
    });
    // Join person names
    return results.map(a => {
      const p = data.people.find(x => x.id === a.person_id);
      return { ...a, first_name: p ? p.first_name : '?', last_name: p ? p.last_name : '?' };
    }).sort((a, b) => b.date.localeCompare(a.date));
  },

  createAttendance(fields) {
    const record = {
      id: nextId('attendance'),
      person_id: parseInt(fields.person_id),
      date: fields.date,
      clock_in: fields.clock_in || null,
      clock_out: fields.clock_out || null,
      break_minutes: fields.break_minutes ? parseInt(fields.break_minutes) : 30,
      type: fields.type || 'work',
      note: fields.note || null,
      created_at: now(),
    };
    data.attendance.push(record);
    save();
    return record;
  },

  updateAttendance(id, fields) {
    const record = data.attendance.find(a => a.id === id);
    if (!record) return null;
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && k !== 'id' && k !== 'created_at' && k !== 'person_id') {
        record[k] = v;
      }
    }
    save();
    return record;
  },

  deleteAttendance(id) {
    const idx = data.attendance.findIndex(a => a.id === id);
    if (idx === -1) return false;
    data.attendance.splice(idx, 1);
    save();
    return true;
  },

  // --- Stats ---
  getStats() {
    const activePeople = data.people.filter(p => p.active === 1);
    const employees = activePeople.filter(p => p.type === 'employee').length;
    const contacts = activePeople.filter(p => p.type !== 'employee').length;
    const today = new Date().toISOString().split('T')[0];
    const presentToday = new Set(data.attendance.filter(a => a.date === today && a.type === 'work').map(a => a.person_id)).size;

    return {
      totalPeople: activePeople.length,
      employees,
      contacts,
      departments: data.departments.length,
      roles: data.roles.length,
      presentToday,
    };
  },
};

console.log('✅ HR Database loaded:', DB_FILE, `(${data.people.length} people, ${data.departments.length} depts)`);

module.exports = db;
