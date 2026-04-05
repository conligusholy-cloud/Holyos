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
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');

const DEFAULT_DATA = {
  _nextId: { people: 1, departments: 1, roles: 1, attendance: 1, admin_tasks: 1, shifts: 1, absence_types: 1, leave_requests: 1, company_leave: 1, documents: 1, document_templates: 1, document_notifications: 1, companies: 1, orders: 1, order_items: 1, warehouses: 1, warehouse_locations: 1, materials: 1, inventory_movements: 1, stock_rules: 1, inventories: 1, inventory_items: 1 },
  people: [],
  departments: [],
  roles: [],
  attendance: [],
  permissions: {}, // roleId → { moduleId: 'read'|'write'|'none' }
  admin_tasks: [], // AI-generated improvement tasks
  shifts: [],         // Shift definitions: { id, name, type: 'fixed'|'flexible', start, end, hours_fund, break_minutes }
  absence_types: [    // Default absence types
    { id: 1, name: 'Oběd', code: 'lunch', color: '#f59e0b', paid: false },
    { id: 2, name: 'Lékař', code: 'doctor', color: '#ef4444', paid: true },
    { id: 3, name: 'Soukromě', code: 'personal', color: '#8b5cf6', paid: false },
    { id: 4, name: 'Dovolená', code: 'vacation', color: '#3b82f6', paid: true },
    { id: 5, name: 'Nemocenská', code: 'sick', color: '#10b981', paid: true },
    { id: 6, name: 'Home office', code: 'homeoffice', color: '#06b6d4', paid: true },
  ],
  leave_requests: [], // { id, person_id, type, date_from, date_to, status: 'pending'|'approved'|'rejected', approved_by, note }
  leave_settings: {
    default_entitlement_days: 20, // 4 týdny = 20 dní
    year: new Date().getFullYear(),
    carryover_allowed: true,
    carryover_max_days: 5,
  },
  company_leave: [], // { id, date_from, date_to, name, excluded_person_ids: [] }
  overtime_settings: {
    yearly_limit_hours: 150,       // zákonný limit bez souhlasu
    yearly_absolute_max: 416,      // absolutní max
    alert_threshold_percent: 80,   // upozornění při 80%
    compensation: 'surcharge',     // 'surcharge' (příplatek 25%) | 'timeoff' (náhradní volno)
    surcharge_percent: 25,
    allow_monthly_transfer: true,  // převod hodin mezi měsíci
  },
  documents: [],              // { id, person_id, title, type, category, file_data (base64), file_name, file_type, file_size, valid_from, valid_to, status, tags, note, created_at, updated_at }
  document_templates: [],     // { id, name, category, content (HTML with {{placeholders}}), variables: [], description, created_at, updated_at }
  document_notifications: [], // { id, document_id, person_id, type: 'expiring'|'expired'|'custom', trigger_days_before, message, sent_at, dismissed, created_at }
  // --- Warehouse & Purchasing ---
  companies: [],              // { id, name, ico, dic, address, city, zip, country, type: 'supplier'|'customer'|'cooperation'|'both', contact_person, email, phone, web, bank_account, payment_terms_days, notes, active, created_at, updated_at }
  orders: [],                 // { id, order_number, type: 'purchase'|'sales'|'cooperation', company_id, status, items_count, total_amount, currency, note, created_by, approved_by, created_at, updated_at, expected_delivery, delivered_at }
  order_items: [],            // { id, order_id, material_id, name, quantity, unit, unit_price, total_price, expected_delivery, delivered_quantity, status, note }
  warehouses: [],             // { id, name, code, address, type: 'main'|'raw'|'finished'|'wip'|'external', manager_id, active, created_at }
  warehouse_locations: [],    // { id, warehouse_id, section, rack, position, label, barcode, capacity, notes }
  materials: [],              // { id, code, name, category, unit, unit_price, weighted_avg_price, supplier_id, min_stock, current_stock, description, barcode, active, created_at, updated_at }
  inventory_movements: [],    // { id, material_id, warehouse_id, location_id, type: 'receipt'|'issue'|'transfer'|'adjustment', quantity, unit_price, reference_type, reference_id, note, created_by, created_at }
  stock_rules: [],            // { id, material_id, warehouse_id, min_stock, max_stock, reorder_quantity, auto_order, preferred_supplier_id, notes }
  inventories: [],            // { id, warehouse_id, name, status: 'draft'|'in_progress'|'completed'|'cancelled', started_at, completed_at, created_by, note, created_at }
  inventory_items: [],        // { id, inventory_id, material_id, location_id, expected_qty, actual_qty, difference, unit_price, value_difference, counted_by, counted_at, note }
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

// Count workdays between two dates (Mon-Fri, excluding weekends)
function countWorkdays(dateFrom, dateTo) {
  let count = 0;
  const d = new Date(dateFrom);
  const end = new Date(dateTo);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function nextId(collection) {
  if (!data._nextId[collection]) data._nextId[collection] = 1;
  return data._nextId[collection]++;
}

// ============================================
// Audit Log — records every change with snapshots for rollback
// ============================================
let auditLog;
try {
  auditLog = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
  if (!Array.isArray(auditLog)) auditLog = [];
} catch (e) {
  auditLog = [];
}

function saveAuditLog() {
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(auditLog, null, 2), 'utf-8');
}

// Current user context (set by server.js before each request)
let _currentUser = null;

function setCurrentUser(user) {
  _currentUser = user;
}

function logChange(action, entity, entityId, description, oldData, newData) {
  // Create deep copy of current DB state for snapshot (exclude photo_url to save space)
  const snapshotData = JSON.parse(JSON.stringify(data));
  // Strip photo_url from snapshot to keep file size manageable
  if (snapshotData.people) {
    snapshotData.people.forEach(p => { delete p.photo_url; });
  }

  const entry = {
    id: auditLog.length + 1,
    timestamp: now(),
    user: _currentUser ? { username: _currentUser.username, displayName: _currentUser.displayName } : { username: 'system', displayName: 'Systém' },
    action,       // 'create' | 'update' | 'delete'
    entity,       // 'person' | 'department' | 'role' | 'attendance'
    entityId,
    description,
    changes: null,
    snapshot: snapshotData,
  };

  // Compute diff for updates
  if (action === 'update' && oldData && newData) {
    const changes = {};
    for (const key of Object.keys(newData)) {
      if (key === 'updated_at' || key === 'photo_url') continue;
      if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
        changes[key] = { from: oldData[key], to: newData[key] };
      }
    }
    if (Object.keys(changes).length > 0) entry.changes = changes;
  }

  auditLog.push(entry);
  saveAuditLog();
  return entry;
}

// ============================================
// Generic CRUD helpers
// ============================================
const db = {
  // --- People ---
  getAllPeople(filters = {}) {
    let results = data.people.filter(p => {
      if (filters.type && p.type !== filters.type) return false;
      if (filters.active != null && filters.active !== '' && p.active != parseInt(filters.active)) return false;
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
      end_date: fields.end_date || null,
      bank_account: fields.bank_account || null,
      photo_url: fields.photo_url || null,
      chip_number: fields.chip_number || null,
      is_super_admin: fields.is_super_admin ? 1 : 0,
      // Osobní údaje
      birth_number: fields.birth_number || null,
      id_card_number: fields.id_card_number || null,
      gender: fields.gender || null,
      city: fields.city || null,
      zip: fields.zip || null,
      // Nouzový kontakt
      emergency_name: fields.emergency_name || null,
      emergency_phone: fields.emergency_phone || null,
      emergency_relation: fields.emergency_relation || null,
      // Auth link
      user_id: fields.user_id || null,
      username: fields.username || null,
      created_at: now(),
      updated_at: now(),
    };
    data.people.push(person);
    save();
    logChange('create', 'person', person.id, `Vytvořena osoba: ${person.first_name} ${person.last_name}`, null, person);
    return person;
  },

  updatePerson(id, fields) {
    const idx = data.people.findIndex(p => p.id === id);
    if (idx === -1) return null;
    const existing = data.people[idx];
    const oldCopy = { ...existing };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && k !== 'id' && k !== 'created_at') {
        existing[k] = v;
      }
    }
    existing.updated_at = now();
    data.people[idx] = existing;
    save();
    logChange('update', 'person', id, `Upravena osoba: ${existing.first_name} ${existing.last_name}`, oldCopy, existing);
    return existing;
  },

  deletePerson(id) {
    const idx = data.people.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const deleted = data.people[idx];
    data.people.splice(idx, 1);
    data.attendance = data.attendance.filter(a => a.person_id !== id);
    save();
    logChange('delete', 'person', id, `Smazána osoba: ${deleted.first_name} ${deleted.last_name}`, deleted, null);
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
    logChange('create', 'department', dept.id, `Vytvořena společnost: ${dept.name}`, null, dept);
    return dept;
  },

  updateDepartment(id, fields) {
    const dept = data.departments.find(d => d.id === id);
    if (!dept) return null;
    const oldCopy = { ...dept };
    if (fields.name !== undefined) dept.name = fields.name;
    if (fields.parent_id !== undefined) dept.parent_id = fields.parent_id ? parseInt(fields.parent_id) : null;
    if (fields.color !== undefined) dept.color = fields.color;
    save();
    logChange('update', 'department', id, `Upravena společnost: ${dept.name}`, oldCopy, dept);
    return dept;
  },

  deleteDepartment(id) {
    const idx = data.departments.findIndex(d => d.id === id);
    if (idx === -1) return false;
    const deleted = data.departments[idx];
    data.departments.splice(idx, 1);
    save();
    logChange('delete', 'department', id, `Smazána společnost: ${deleted.name}`, deleted, null);
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
      parent_role_id: fields.parent_role_id ? parseInt(fields.parent_role_id) : null,
      description: fields.description || null,
      created_at: now(),
    };
    data.roles.push(role);
    save();
    logChange('create', 'role', role.id, `Vytvořena role: ${role.name}`, null, role);
    return role;
  },

  updateRole(id, fields) {
    const role = data.roles.find(r => r.id === id);
    if (!role) return null;
    const oldCopy = { ...role };
    if (fields.name !== undefined) role.name = fields.name;
    if (fields.department_id !== undefined) role.department_id = fields.department_id ? parseInt(fields.department_id) : null;
    if (fields.parent_role_id !== undefined) role.parent_role_id = fields.parent_role_id ? parseInt(fields.parent_role_id) : null;
    if (fields.description !== undefined) role.description = fields.description;
    save();
    logChange('update', 'role', id, `Upravena role: ${role.name}`, oldCopy, role);
    return role;
  },

  deleteRole(id) {
    const idx = data.roles.findIndex(r => r.id === id);
    if (idx === -1) return false;
    const deleted = data.roles[idx];
    data.roles.splice(idx, 1);
    save();
    logChange('delete', 'role', id, `Smazána role: ${deleted.name}`, deleted, null);
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
    logChange('create', 'attendance', record.id, `Docházka: ${record.date} (osoba #${record.person_id})`, null, record);
    return record;
  },

  updateAttendance(id, fields) {
    const record = data.attendance.find(a => a.id === id);
    if (!record) return null;
    const oldCopy = { ...record };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && k !== 'id' && k !== 'created_at' && k !== 'person_id') {
        record[k] = v;
      }
    }
    save();
    logChange('update', 'attendance', id, `Upravena docházka: ${record.date} (osoba #${record.person_id})`, oldCopy, record);
    return record;
  },

  deleteAttendance(id) {
    const idx = data.attendance.findIndex(a => a.id === id);
    if (idx === -1) return false;
    const deleted = data.attendance[idx];
    data.attendance.splice(idx, 1);
    save();
    logChange('delete', 'attendance', id, `Smazána docházka: ${deleted.date} (osoba #${deleted.person_id})`, deleted, null);
    return true;
  },

  // --- Permissions ---
  getPermissions() {
    return data.permissions || {};
  },

  getPermissionsForRole(roleId) {
    return (data.permissions || {})[String(roleId)] || {};
  },

  setPermissions(roleId, modulePerms) {
    if (!data.permissions) data.permissions = {};
    const oldPerms = data.permissions[String(roleId)] || {};
    data.permissions[String(roleId)] = modulePerms;
    save();
    logChange('update', 'permissions', roleId, `Upravena oprávnění pro roli #${roleId}`, oldPerms, modulePerms);
    return modulePerms;
  },

  // --- Admin Tasks ---
  getAdminTasks(filters = {}) {
    let tasks = data.admin_tasks || [];
    if (filters.status) tasks = tasks.filter(t => t.status === filters.status);
    if (filters.page) tasks = tasks.filter(t => t.page === filters.page);
    return [...tasks].reverse();
  },

  getAdminTask(id) {
    return (data.admin_tasks || []).find(t => t.id === id) || null;
  },

  createAdminTask(task) {
    if (!data._nextId.admin_tasks) data._nextId.admin_tasks = 1;
    const newTask = {
      id: data._nextId.admin_tasks++,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'new', // new, in_progress, done, cancelled
      page: task.page || '',
      page_title: task.page_title || '',
      description: task.description || '',
      ai_questions: task.ai_questions || [],
      ai_answers: task.ai_answers || {},
      screenshot: task.screenshot || null,
      priority: task.priority || 'medium',
      spec: task.spec || '',
      created_by: task.created_by || null,
    };
    if (!data.admin_tasks) data.admin_tasks = [];
    data.admin_tasks.push(newTask);
    save();
    logChange('create', 'admin_task', newTask.id, `Nový požadavek: ${newTask.description.substring(0, 60)}`, null, newTask);
    return newTask;
  },

  updateAdminTask(id, updates) {
    const task = (data.admin_tasks || []).find(t => t.id === id);
    if (!task) return null;
    const before = { ...task };
    Object.assign(task, updates, { updated_at: new Date().toISOString() });
    save();
    logChange('update', 'admin_task', id, `Upraven požadavek #${id}`, before, task);
    return task;
  },

  deleteAdminTask(id) {
    const idx = (data.admin_tasks || []).findIndex(t => t.id === id);
    if (idx === -1) return false;
    const task = data.admin_tasks[idx];
    data.admin_tasks.splice(idx, 1);
    save();
    logChange('delete', 'admin_task', id, `Smazán požadavek: ${task.description.substring(0, 60)}`, task, null);
    return true;
  },

  // --- Shifts ---
  getShifts() { return data.shifts || []; },
  getShift(id) { return (data.shifts || []).find(s => s.id === id); },
  createShift(fields) {
    if (!data._nextId.shifts) data._nextId.shifts = 1;
    const shift = {
      id: data._nextId.shifts++,
      name: fields.name,
      type: fields.type || 'fixed', // 'fixed' | 'flexible'
      start: fields.start || null,   // HH:MM for fixed
      end: fields.end || null,       // HH:MM for fixed
      hours_fund: fields.hours_fund ? parseFloat(fields.hours_fund) : 8, // daily hours for flexible
      break_minutes: fields.break_minutes ? parseInt(fields.break_minutes) : 30,
      created_at: now(),
    };
    if (!data.shifts) data.shifts = [];
    data.shifts.push(shift);
    save();
    logChange('create', 'shift', shift.id, `Vytvořena směna: ${shift.name}`, null, shift);
    return shift;
  },
  updateShift(id, fields) {
    const s = (data.shifts || []).find(x => x.id === id);
    if (!s) return null;
    const old = { ...s };
    for (const [k, v] of Object.entries(fields)) { if (v !== undefined && k !== 'id') s[k] = v; }
    save();
    logChange('update', 'shift', id, `Upravena směna: ${s.name}`, old, s);
    return s;
  },
  deleteShift(id) {
    const idx = (data.shifts || []).findIndex(s => s.id === id);
    if (idx === -1) return false;
    const del = data.shifts[idx];
    data.shifts.splice(idx, 1);
    save();
    logChange('delete', 'shift', id, `Smazána směna: ${del.name}`, del, null);
    return true;
  },

  // --- Absence Types ---
  getAbsenceTypes() { return data.absence_types || []; },
  createAbsenceType(fields) {
    if (!data._nextId.absence_types) data._nextId.absence_types = 7; // after defaults
    const at = {
      id: data._nextId.absence_types++,
      name: fields.name,
      code: fields.code || fields.name.toLowerCase().replace(/\s+/g, '_'),
      color: fields.color || '#6c5ce7',
      paid: !!fields.paid,
    };
    if (!data.absence_types) data.absence_types = [];
    data.absence_types.push(at);
    save();
    return at;
  },
  updateAbsenceType(id, fields) {
    const at = (data.absence_types || []).find(x => x.id === id);
    if (!at) return null;
    for (const [k, v] of Object.entries(fields)) { if (v !== undefined && k !== 'id') at[k] = v; }
    save();
    return at;
  },
  deleteAbsenceType(id) {
    const idx = (data.absence_types || []).findIndex(x => x.id === id);
    if (idx === -1) return false;
    data.absence_types.splice(idx, 1);
    save();
    return true;
  },

  // --- Leave Requests ---
  getLeaveRequests(filters = {}) {
    let reqs = data.leave_requests || [];
    if (filters.person_id) reqs = reqs.filter(r => r.person_id === parseInt(filters.person_id));
    if (filters.status) reqs = reqs.filter(r => r.status === filters.status);
    return reqs.sort((a, b) => b.id - a.id);
  },
  createLeaveRequest(fields) {
    if (!data._nextId.leave_requests) data._nextId.leave_requests = 1;
    const req = {
      id: data._nextId.leave_requests++,
      person_id: parseInt(fields.person_id),
      type: fields.type || 'vacation',
      date_from: fields.date_from,
      date_to: fields.date_to,
      note: fields.note || '',
      status: 'pending',
      approved_by: null,
      created_at: now(),
    };
    if (!data.leave_requests) data.leave_requests = [];
    data.leave_requests.push(req);
    save();
    logChange('create', 'leave_request', req.id, `Žádost o volno: osoba #${req.person_id} (${req.date_from} - ${req.date_to})`, null, req);
    return req;
  },
  approveLeaveRequest(id, approvedBy) {
    const req = (data.leave_requests || []).find(r => r.id === id);
    if (!req) return null;
    const old = { ...req };
    req.status = 'approved';
    req.approved_by = approvedBy;
    save();
    logChange('update', 'leave_request', id, `Schváleno volno: osoba #${req.person_id}`, old, req);
    return req;
  },
  rejectLeaveRequest(id, rejectedBy) {
    const req = (data.leave_requests || []).find(r => r.id === id);
    if (!req) return null;
    const old = { ...req };
    req.status = 'rejected';
    req.approved_by = rejectedBy;
    save();
    logChange('update', 'leave_request', id, `Zamítnuto volno: osoba #${req.person_id}`, old, req);
    return req;
  },

  // --- Kiosk: Find person by chip card ---
  findPersonByChip(chipId) {
    return data.people.find(p => p.chip_card_id === chipId && p.active == 1) || null;
  },

  // --- Kiosk: Clock action (arrival/departure/absence) ---
  clockAction(personId, action, absenceType) {
    const today = new Date().toISOString().split('T')[0];
    const timeNow = new Date().toTimeString().slice(0, 5); // HH:MM

    // Find today's attendance for this person
    let record = data.attendance.find(a => a.person_id === personId && a.date === today && a.type === 'work');

    if (action === 'clock_in') {
      if (!record) {
        // Create new attendance record for today
        record = {
          id: nextId('attendance'),
          person_id: personId,
          date: today,
          clock_in: timeNow,
          clock_out: null,
          break_minutes: 0,
          type: 'work',
          note: '',
          created_at: now(),
        };
        data.attendance.push(record);
      } else {
        record.clock_in = record.clock_in || timeNow;
      }
    } else if (action === 'clock_out') {
      if (record) {
        record.clock_out = timeNow;
      }
    } else if (action === 'absence_out') {
      // Going on absence (e.g., lunch, doctor)
      const absRec = {
        id: nextId('attendance'),
        person_id: personId,
        date: today,
        clock_in: timeNow, // absence start
        clock_out: null,
        break_minutes: 0,
        type: absenceType || 'other',
        note: '',
        created_at: now(),
      };
      data.attendance.push(absRec);
      record = absRec;
    } else if (action === 'absence_in') {
      // Returning from absence — find the open absence record
      const openAbsence = data.attendance.find(a => a.person_id === personId && a.date === today && a.type !== 'work' && !a.clock_out);
      if (openAbsence) {
        openAbsence.clock_out = timeNow;
        record = openAbsence;
      }
    }

    save();
    return record;
  },

  // --- Today's presence overview ---
  getTodayPresence() {
    const today = new Date().toISOString().split('T')[0];
    const todayRecords = data.attendance.filter(a => a.date === today);
    const activePeople = data.people.filter(p => p.active == 1 && p.type === 'employee');

    return activePeople.map(p => {
      const workRec = todayRecords.find(a => a.person_id === p.id && a.type === 'work');
      const absRecs = todayRecords.filter(a => a.person_id === p.id && a.type !== 'work');
      const openAbsence = absRecs.find(a => !a.clock_out);

      let status = 'absent'; // hasn't arrived
      if (workRec && workRec.clock_in && !workRec.clock_out) {
        status = openAbsence ? 'on_break' : 'present';
      } else if (workRec && workRec.clock_out) {
        status = 'left';
      }

      return {
        person_id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        photo_url: p.photo_url || null,
        role_name: (data.roles.find(r => r.id === p.role_id) || {}).name || null,
        status,
        clock_in: workRec ? workRec.clock_in : null,
        clock_out: workRec ? workRec.clock_out : null,
        current_absence: openAbsence ? openAbsence.type : null,
        absences: absRecs,
      };
    });
  },

  // --- Leave Settings ---
  getLeaveSettings() { return data.leave_settings || DEFAULT_DATA.leave_settings; },
  updateLeaveSettings(fields) {
    if (!data.leave_settings) data.leave_settings = { ...DEFAULT_DATA.leave_settings };
    const old = { ...data.leave_settings };
    Object.assign(data.leave_settings, fields);
    save();
    logChange('update', 'leave_settings', 0, 'Upraveno nastavení dovolených', old, data.leave_settings);
    return data.leave_settings;
  },

  // --- Overtime Settings ---
  getOvertimeSettings() { return data.overtime_settings || DEFAULT_DATA.overtime_settings; },
  updateOvertimeSettings(fields) {
    if (!data.overtime_settings) data.overtime_settings = { ...DEFAULT_DATA.overtime_settings };
    const old = { ...data.overtime_settings };
    Object.assign(data.overtime_settings, fields);
    save();
    logChange('update', 'overtime_settings', 0, 'Upraveno nastavení přesčasů', old, data.overtime_settings);
    return data.overtime_settings;
  },

  // --- Company-wide Leave (celozávodní dovolená) ---
  getCompanyLeave(year) {
    const cl = data.company_leave || [];
    if (year) return cl.filter(c => c.date_from.startsWith(String(year)));
    return cl;
  },
  createCompanyLeave(fields) {
    if (!data._nextId.company_leave) data._nextId.company_leave = 1;
    const cl = {
      id: data._nextId.company_leave++,
      name: fields.name || 'Celozávodní dovolená',
      date_from: fields.date_from,
      date_to: fields.date_to,
      excluded_person_ids: (fields.excluded_person_ids || []).map(Number),
      created_at: now(),
    };
    if (!data.company_leave) data.company_leave = [];
    data.company_leave.push(cl);
    save();
    logChange('create', 'company_leave', cl.id, `Celozávodní dovolená: ${cl.date_from} – ${cl.date_to}`, null, cl);
    return cl;
  },
  deleteCompanyLeave(id) {
    const idx = (data.company_leave || []).findIndex(c => c.id === id);
    if (idx === -1) return false;
    const del = data.company_leave[idx];
    data.company_leave.splice(idx, 1);
    save();
    logChange('delete', 'company_leave', id, `Smazána celozávodní dovolená: ${del.date_from} – ${del.date_to}`, del, null);
    return true;
  },

  // --- Leave Balance (zůstatek dovolené) ---
  getLeaveBalance(personId, year) {
    year = year || new Date().getFullYear();
    const person = data.people.find(p => p.id === parseInt(personId));
    if (!person) return null;

    const settings = data.leave_settings || DEFAULT_DATA.leave_settings;
    // Personal entitlement overrides default
    const entitlementDays = person.leave_entitlement_days || settings.default_entitlement_days || 20;

    // Count approved leave days for this year
    const approvedLeaves = (data.leave_requests || []).filter(r =>
      r.person_id === parseInt(personId) &&
      r.status === 'approved' &&
      r.date_from.startsWith(String(year))
    );

    let usedDays = 0;
    for (const leave of approvedLeaves) {
      usedDays += countWorkdays(leave.date_from, leave.date_to);
    }

    // Count company-wide leave days (unless excluded)
    const companyLeaves = (data.company_leave || []).filter(c =>
      c.date_from.startsWith(String(year)) &&
      !c.excluded_person_ids.includes(parseInt(personId))
    );
    for (const cl of companyLeaves) {
      usedDays += countWorkdays(cl.date_from, cl.date_to);
    }

    // Carryover from last year (stored on person record)
    const carryover = person.leave_carryover || 0;

    return {
      person_id: parseInt(personId),
      year,
      entitlement: entitlementDays,
      carryover,
      total: entitlementDays + carryover,
      used: usedDays,
      remaining: entitlementDays + carryover - usedDays,
      approved_requests: approvedLeaves.length,
    };
  },

  // Get leave balances for all employees
  getAllLeaveBalances(year) {
    year = year || new Date().getFullYear();
    const employees = data.people.filter(p => p.active == 1 && p.type === 'employee');
    return employees.map(p => this.getLeaveBalance(p.id, year));
  },

  // --- Overtime Calculation ---
  getOvertimeSummary(personId, year, month) {
    year = year || new Date().getFullYear();
    const person = data.people.find(p => p.id === parseInt(personId));
    if (!person) return null;

    const shift = (data.shifts || []).find(s => s.id === person.shift_id);
    const dailyFund = shift ? shift.hours_fund : 8;

    // Get attendance records
    let records = data.attendance.filter(a =>
      a.person_id === parseInt(personId) &&
      a.type === 'work' &&
      a.date.startsWith(String(year))
    );
    if (month) {
      const monthStr = String(year) + '-' + String(month).padStart(2, '0');
      records = records.filter(a => a.date.startsWith(monthStr));
    }

    let totalWorkedMins = 0;
    let totalFundMins = 0;

    for (const r of records) {
      const clockIn = r.adjusted_clock_in || r.clock_in;
      const clockOut = r.adjusted_clock_out || r.clock_out;
      const breakMins = r.adjusted_break != null ? r.adjusted_break : (r.break_minutes || 0);

      if (clockIn && clockOut) {
        const [ih, im] = clockIn.split(':').map(Number);
        const [oh, om] = clockOut.split(':').map(Number);
        const worked = (oh * 60 + om) - (ih * 60 + im) - breakMins;
        totalWorkedMins += Math.max(0, worked);
      }
      totalFundMins += dailyFund * 60;
    }

    const overtimeMins = Math.max(0, totalWorkedMins - totalFundMins);
    const settings = data.overtime_settings || DEFAULT_DATA.overtime_settings;

    return {
      person_id: parseInt(personId),
      year,
      month: month || null,
      daily_fund_hours: dailyFund,
      work_days: records.length,
      total_worked_hours: +(totalWorkedMins / 60).toFixed(2),
      total_fund_hours: +(totalFundMins / 60).toFixed(2),
      overtime_hours: +(overtimeMins / 60).toFixed(2),
      yearly_limit: settings.yearly_limit_hours,
      compensation: settings.compensation,
      surcharge_percent: settings.surcharge_percent,
    };
  },

  // Get overtime for all employees
  getAllOvertimeSummaries(year, month) {
    year = year || new Date().getFullYear();
    const employees = data.people.filter(p => p.active == 1 && p.type === 'employee');
    return employees.map(p => {
      const summary = this.getOvertimeSummary(p.id, year, month);
      return { ...summary, first_name: p.first_name, last_name: p.last_name };
    });
  },

  // --- Stats ---
  getStats() {
    const activePeople = data.people.filter(p => p.active == 1);
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

// ============================================
// Audit Log API
// ============================================
// ============================================
// Documents
// ============================================
db.getDocuments = function(filters = {}) {
  let results = [...data.documents];
  if (filters.person_id) results = results.filter(d => d.person_id === parseInt(filters.person_id));
  if (filters.category) results = results.filter(d => d.category === filters.category);
  if (filters.status) results = results.filter(d => d.status === filters.status);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    results = results.filter(d => (d.title || '').toLowerCase().includes(s) || (d.note || '').toLowerCase().includes(s));
  }
  // Join person name
  return results.map(d => {
    const p = data.people.find(x => x.id === d.person_id);
    return { ...d, person_name: p ? (p.first_name + ' ' + p.last_name) : '—', file_data: undefined };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};

db.getDocumentById = function(id) {
  return data.documents.find(d => d.id === id) || null;
};

db.createDocument = function(fields) {
  const doc = {
    id: nextId('documents'),
    person_id: fields.person_id ? parseInt(fields.person_id) : null,
    title: fields.title,
    type: fields.type || 'other',
    category: fields.category || 'general',
    file_data: fields.file_data || null,
    file_name: fields.file_name || null,
    file_type: fields.file_type || null,
    file_size: fields.file_size || 0,
    valid_from: fields.valid_from || null,
    valid_to: fields.valid_to || null,
    status: fields.status || 'active',
    tags: fields.tags || [],
    note: fields.note || '',
    created_at: now(),
    updated_at: now(),
  };
  data.documents.push(doc);
  save();
  logChange('create', 'document', doc.id, `Dokument "${doc.title}" vytvořen`, null, doc);
  return doc;
};

db.updateDocument = function(id, fields) {
  const doc = data.documents.find(d => d.id === id);
  if (!doc) return null;
  const oldData = { ...doc };
  for (const key of Object.keys(fields)) {
    if (key !== 'id' && key !== 'created_at') doc[key] = fields[key];
  }
  doc.updated_at = now();
  save();
  logChange('update', 'document', id, `Dokument "${doc.title}" upraven`, oldData, doc);
  return doc;
};

db.deleteDocument = function(id) {
  const idx = data.documents.findIndex(d => d.id === id);
  if (idx < 0) return false;
  const doc = data.documents[idx];
  data.documents.splice(idx, 1);
  // Also delete notifications for this document
  data.document_notifications = data.document_notifications.filter(n => n.document_id !== id);
  save();
  logChange('delete', 'document', id, `Dokument "${doc.title}" smazán`, doc, null);
  return true;
};

db.getDocumentFile = function(id) {
  const doc = data.documents.find(d => d.id === id);
  if (!doc || !doc.file_data) return null;
  return { file_data: doc.file_data, file_name: doc.file_name, file_type: doc.file_type };
};

// ============================================
// Document Templates
// ============================================
db.getDocumentTemplates = function() {
  return data.document_templates.map(t => ({ ...t })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
};

db.getDocumentTemplateById = function(id) {
  return data.document_templates.find(t => t.id === id) || null;
};

db.createDocumentTemplate = function(fields) {
  const tmpl = {
    id: nextId('document_templates'),
    name: fields.name,
    category: fields.category || 'general',
    content: fields.content || '',
    variables: fields.variables || [],
    description: fields.description || '',
    created_at: now(),
    updated_at: now(),
  };
  data.document_templates.push(tmpl);
  save();
  logChange('create', 'document_template', tmpl.id, `Šablona "${tmpl.name}" vytvořena`, null, tmpl);
  return tmpl;
};

db.updateDocumentTemplate = function(id, fields) {
  const tmpl = data.document_templates.find(t => t.id === id);
  if (!tmpl) return null;
  const oldData = { ...tmpl };
  for (const key of Object.keys(fields)) {
    if (key !== 'id' && key !== 'created_at') tmpl[key] = fields[key];
  }
  tmpl.updated_at = now();
  save();
  logChange('update', 'document_template', id, `Šablona "${tmpl.name}" upravena`, oldData, tmpl);
  return tmpl;
};

db.deleteDocumentTemplate = function(id) {
  const idx = data.document_templates.findIndex(t => t.id === id);
  if (idx < 0) return false;
  const tmpl = data.document_templates[idx];
  data.document_templates.splice(idx, 1);
  save();
  logChange('delete', 'document_template', id, `Šablona "${tmpl.name}" smazána`, tmpl, null);
  return true;
};

db.generateFromTemplate = function(templateId, personId, variables = {}) {
  const tmpl = data.document_templates.find(t => t.id === templateId);
  if (!tmpl) return null;
  const person = data.people.find(p => p.id === parseInt(personId));
  if (!person) return null;
  const dept = data.departments.find(d => d.id === person.department_id);
  const role = data.roles.find(r => r.id === person.role_id);

  // Build variable map with person data auto-fill
  const vars = {
    jmeno: person.first_name,
    prijmeni: person.last_name,
    cele_jmeno: person.first_name + ' ' + person.last_name,
    email: person.email || '',
    telefon: person.phone || '',
    osobni_cislo: person.employee_number || '',
    datum_nastupu: person.hire_date || '',
    typ_smlouvy: person.contract_type || '',
    pozice: role ? role.name : '',
    oddeleni: dept ? dept.name : '',
    hodinova_sazba: person.hourly_rate ? String(person.hourly_rate) : '',
    mesicni_mzda: person.monthly_salary ? String(person.monthly_salary) : '',
    datum: new Date().toLocaleDateString('cs-CZ'),
    rok: String(new Date().getFullYear()),
    ...variables,
  };

  // Replace placeholders
  let content = tmpl.content;
  for (const [key, val] of Object.entries(vars)) {
    content = content.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), val || '');
  }

  return { content, person_name: person.first_name + ' ' + person.last_name, template_name: tmpl.name };
};

// ============================================
// Document Notifications
// ============================================
db.getDocumentNotifications = function(filters = {}) {
  let results = [...data.document_notifications];
  if (filters.person_id) results = results.filter(n => n.person_id === parseInt(filters.person_id));
  if (filters.dismissed === false) results = results.filter(n => !n.dismissed);
  // Join document and person info
  return results.map(n => {
    const doc = data.documents.find(d => d.id === n.document_id);
    const p = data.people.find(x => x.id === n.person_id);
    return {
      ...n,
      document_title: doc ? doc.title : '—',
      document_valid_to: doc ? doc.valid_to : null,
      person_name: p ? (p.first_name + ' ' + p.last_name) : '—',
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};

db.createDocumentNotification = function(fields) {
  const notif = {
    id: nextId('document_notifications'),
    document_id: fields.document_id ? parseInt(fields.document_id) : null,
    person_id: fields.person_id ? parseInt(fields.person_id) : null,
    type: fields.type || 'custom',
    trigger_days_before: fields.trigger_days_before || 30,
    message: fields.message || '',
    sent_at: null,
    dismissed: false,
    created_at: now(),
  };
  data.document_notifications.push(notif);
  save();
  return notif;
};

db.dismissNotification = function(id) {
  const n = data.document_notifications.find(x => x.id === id);
  if (!n) return false;
  n.dismissed = true;
  n.sent_at = now();
  save();
  return true;
};

db.checkExpiringDocuments = function(daysAhead = 30) {
  const today = new Date();
  const ahead = new Date(today);
  ahead.setDate(ahead.getDate() + daysAhead);
  const todayStr = today.toISOString().slice(0, 10);
  const aheadStr = ahead.toISOString().slice(0, 10);

  const expiring = data.documents.filter(d =>
    d.valid_to && d.status === 'active' && d.valid_to >= todayStr && d.valid_to <= aheadStr
  );

  // Auto-create notifications if not already existing
  for (const doc of expiring) {
    const existing = data.document_notifications.find(n =>
      n.document_id === doc.id && n.type === 'expiring' && !n.dismissed
    );
    if (!existing) {
      db.createDocumentNotification({
        document_id: doc.id,
        person_id: doc.person_id,
        type: 'expiring',
        trigger_days_before: daysAhead,
        message: `Dokument "${doc.title}" vyprší ${doc.valid_to}`,
      });
    }
  }

  // Also flag expired documents
  const expired = data.documents.filter(d =>
    d.valid_to && d.status === 'active' && d.valid_to < todayStr
  );
  for (const doc of expired) {
    const existing = data.document_notifications.find(n =>
      n.document_id === doc.id && n.type === 'expired' && !n.dismissed
    );
    if (!existing) {
      db.createDocumentNotification({
        document_id: doc.id,
        person_id: doc.person_id,
        type: 'expired',
        message: `Dokument "${doc.title}" vypršel ${doc.valid_to}!`,
      });
    }
  }

  return { expiring: expiring.length, expired: expired.length };
};

// ============================================
// Companies (Suppliers/Customers)
// ============================================
db.getCompanies = function(filters = {}) {
  let results = [...data.companies];
  if (filters.type) results = results.filter(c => c.type === filters.type || c.type === 'both');
  if (filters.active !== undefined) results = results.filter(c => c.active === (filters.active === true || filters.active === 1 || filters.active === '1'));
  if (filters.search) {
    const s = filters.search.toLowerCase();
    results = results.filter(c => (c.name||'').toLowerCase().includes(s) || (c.ico||'').includes(s) || (c.email||'').toLowerCase().includes(s));
  }
  return results.sort((a,b) => (a.name||'').localeCompare(b.name||''));
};

db.getCompanyById = function(id) {
  return data.companies.find(c => c.id === id) || null;
};

db.createCompany = function(fields) {
  const company = {
    id: nextId('companies'), name: fields.name, ico: fields.ico || null, dic: fields.dic || null,
    address: fields.address || null, city: fields.city || null, zip: fields.zip || null, country: fields.country || 'CZ',
    type: fields.type || 'supplier', contact_person: fields.contact_person || null,
    email: fields.email || null, phone: fields.phone || null, web: fields.web || null,
    bank_account: fields.bank_account || null, payment_terms_days: fields.payment_terms_days ? parseInt(fields.payment_terms_days) : 14,
    notes: fields.notes || '', active: true, created_at: now(), updated_at: now(),
  };
  data.companies.push(company);
  save();
  logChange('create', 'company', company.id, `Společnost "${company.name}" vytvořena`, null, company);
  return company;
};

db.updateCompany = function(id, fields) {
  const c = data.companies.find(x => x.id === id);
  if (!c) return null;
  const old = { ...c };
  for (const k of Object.keys(fields)) { if (k !== 'id' && k !== 'created_at') c[k] = fields[k]; }
  c.updated_at = now();
  save();
  logChange('update', 'company', id, `Společnost "${c.name}" upravena`, old, c);
  return c;
};

db.deleteCompany = function(id) {
  const idx = data.companies.findIndex(c => c.id === id);
  if (idx < 0) return false;
  const c = data.companies[idx];
  data.companies.splice(idx, 1);
  save();
  logChange('delete', 'company', id, `Společnost "${c.name}" smazána`, c, null);
  return true;
};

// ============================================
// Orders
// ============================================
db.getOrders = function(filters = {}) {
  let results = [...data.orders];
  if (filters.type) results = results.filter(o => o.type === filters.type);
  if (filters.status) results = results.filter(o => o.status === filters.status);
  if (filters.company_id) results = results.filter(o => o.company_id === parseInt(filters.company_id));
  if (filters.search) {
    const s = filters.search.toLowerCase();
    results = results.filter(o => (o.order_number||'').toLowerCase().includes(s) || (o.note||'').toLowerCase().includes(s));
  }
  return results.map(o => {
    const company = data.companies.find(c => c.id === o.company_id);
    return { ...o, company_name: company ? company.name : '—' };
  }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
};

db.getOrderById = function(id) {
  const o = data.orders.find(x => x.id === id);
  if (!o) return null;
  const company = data.companies.find(c => c.id === o.company_id);
  const items = data.order_items.filter(i => i.order_id === id);
  return { ...o, company_name: company ? company.name : '—', items };
};

db.createOrder = function(fields) {
  const orderNum = fields.order_number || (fields.type === 'purchase' ? 'NO' : fields.type === 'sales' ? 'PO' : 'KO') + '-' + new Date().getFullYear() + '-' + String(data.orders.length + 1).padStart(4, '0');
  const order = {
    id: nextId('orders'), order_number: orderNum, type: fields.type || 'purchase',
    company_id: fields.company_id ? parseInt(fields.company_id) : null,
    status: fields.status || 'new', items_count: 0, total_amount: 0,
    currency: fields.currency || 'CZK', note: fields.note || '',
    created_by: fields.created_by || null, approved_by: null,
    created_at: now(), updated_at: now(),
    expected_delivery: fields.expected_delivery || null, delivered_at: null,
  };
  data.orders.push(order);
  save();
  logChange('create', 'order', order.id, `Objednávka ${order.order_number} vytvořena`, null, order);
  return order;
};

db.updateOrder = function(id, fields) {
  const o = data.orders.find(x => x.id === id);
  if (!o) return null;
  const old = { ...o };
  for (const k of Object.keys(fields)) { if (k !== 'id' && k !== 'created_at') o[k] = fields[k]; }
  o.updated_at = now();
  save();
  logChange('update', 'order', id, `Objednávka ${o.order_number} upravena`, old, o);
  return o;
};

db.deleteOrder = function(id) {
  const idx = data.orders.findIndex(o => o.id === id);
  if (idx < 0) return false;
  const o = data.orders[idx];
  data.orders.splice(idx, 1);
  data.order_items = data.order_items.filter(i => i.order_id !== id);
  save();
  logChange('delete', 'order', id, `Objednávka ${o.order_number} smazána`, o, null);
  return true;
};

// ============================================
// Order Items
// ============================================
db.getOrderItems = function(orderId) {
  return data.order_items.filter(i => i.order_id === parseInt(orderId)).map(i => {
    const mat = data.materials.find(m => m.id === i.material_id);
    return { ...i, material_name: mat ? mat.name : null, material_code: mat ? mat.code : null };
  });
};

db.addOrderItem = function(orderId, fields) {
  const item = {
    id: nextId('order_items'), order_id: parseInt(orderId),
    material_id: fields.material_id ? parseInt(fields.material_id) : null,
    name: fields.name || '', quantity: parseFloat(fields.quantity) || 0,
    unit: fields.unit || 'ks', unit_price: parseFloat(fields.unit_price) || 0,
    total_price: (parseFloat(fields.quantity) || 0) * (parseFloat(fields.unit_price) || 0),
    expected_delivery: fields.expected_delivery || null,
    delivered_quantity: 0, status: 'pending', note: fields.note || '',
  };
  data.order_items.push(item);
  // Update order totals
  const order = data.orders.find(o => o.id === parseInt(orderId));
  if (order) {
    const items = data.order_items.filter(i => i.order_id === parseInt(orderId));
    order.items_count = items.length;
    order.total_amount = items.reduce((s, i) => s + (i.total_price || 0), 0);
    order.updated_at = now();
  }
  save();
  return item;
};

db.updateOrderItem = function(id, fields) {
  const item = data.order_items.find(i => i.id === id);
  if (!item) return null;
  for (const k of Object.keys(fields)) { if (k !== 'id' && k !== 'order_id') item[k] = fields[k]; }
  if (fields.quantity !== undefined || fields.unit_price !== undefined) {
    item.total_price = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);
  }
  // Update order totals
  const order = data.orders.find(o => o.id === item.order_id);
  if (order) {
    const items = data.order_items.filter(i => i.order_id === item.order_id);
    order.items_count = items.length;
    order.total_amount = items.reduce((s, i) => s + (i.total_price || 0), 0);
    order.updated_at = now();
  }
  save();
  return item;
};

db.deleteOrderItem = function(id) {
  const idx = data.order_items.findIndex(i => i.id === id);
  if (idx < 0) return false;
  const item = data.order_items[idx];
  data.order_items.splice(idx, 1);
  const order = data.orders.find(o => o.id === item.order_id);
  if (order) {
    const items = data.order_items.filter(i => i.order_id === item.order_id);
    order.items_count = items.length;
    order.total_amount = items.reduce((s, i) => s + (i.total_price || 0), 0);
    order.updated_at = now();
  }
  save();
  return true;
};

// ============================================
// Warehouses & Locations
// ============================================
db.getWarehouses = function() {
  return data.warehouses.map(w => {
    const locs = data.warehouse_locations.filter(l => l.warehouse_id === w.id);
    return { ...w, locations_count: locs.length };
  }).sort((a,b) => (a.name||'').localeCompare(b.name||''));
};

db.getWarehouseById = function(id) {
  const w = data.warehouses.find(x => x.id === id);
  if (!w) return null;
  const locations = data.warehouse_locations.filter(l => l.warehouse_id === id);
  return { ...w, locations };
};

db.createWarehouse = function(fields) {
  const w = {
    id: nextId('warehouses'), name: fields.name, code: fields.code || '',
    address: fields.address || '', type: fields.type || 'main',
    manager_id: fields.manager_id ? parseInt(fields.manager_id) : null,
    active: true, created_at: now(),
  };
  data.warehouses.push(w);
  save();
  logChange('create', 'warehouse', w.id, `Sklad "${w.name}" vytvořen`, null, w);
  return w;
};

db.updateWarehouse = function(id, fields) {
  const w = data.warehouses.find(x => x.id === id);
  if (!w) return null;
  const old = { ...w };
  for (const k of Object.keys(fields)) { if (k !== 'id' && k !== 'created_at') w[k] = fields[k]; }
  save();
  logChange('update', 'warehouse', id, `Sklad "${w.name}" upraven`, old, w);
  return w;
};

db.deleteWarehouse = function(id) {
  const idx = data.warehouses.findIndex(w => w.id === id);
  if (idx < 0) return false;
  const w = data.warehouses[idx];
  data.warehouses.splice(idx, 1);
  data.warehouse_locations = data.warehouse_locations.filter(l => l.warehouse_id !== id);
  save();
  logChange('delete', 'warehouse', id, `Sklad "${w.name}" smazán`, w, null);
  return true;
};

// Warehouse Locations
db.getWarehouseLocations = function(warehouseId) {
  return data.warehouse_locations.filter(l => l.warehouse_id === parseInt(warehouseId));
};

db.createWarehouseLocation = function(fields) {
  const loc = {
    id: nextId('warehouse_locations'), warehouse_id: parseInt(fields.warehouse_id),
    section: fields.section || '', rack: fields.rack || '', position: fields.position || '',
    label: fields.label || '', barcode: fields.barcode || '', capacity: fields.capacity || null,
    notes: fields.notes || '',
  };
  data.warehouse_locations.push(loc);
  save();
  return loc;
};

db.updateWarehouseLocation = function(id, fields) {
  const loc = data.warehouse_locations.find(l => l.id === id);
  if (!loc) return null;
  for (const k of Object.keys(fields)) { if (k !== 'id') loc[k] = fields[k]; }
  save();
  return loc;
};

db.deleteWarehouseLocation = function(id) {
  const idx = data.warehouse_locations.findIndex(l => l.id === id);
  if (idx < 0) return false;
  data.warehouse_locations.splice(idx, 1);
  save();
  return true;
};

// ============================================
// Materials (Catalog)
// ============================================
db.getMaterials = function(filters = {}) {
  let results = [...data.materials];
  if (filters.category) results = results.filter(m => m.category === filters.category);
  if (filters.type) results = results.filter(m => m.type === filters.type);
  if (filters.status) results = results.filter(m => m.status === filters.status);
  if (filters.active !== undefined) results = results.filter(m => m.active !== false);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    results = results.filter(m => (m.name||'').toLowerCase().includes(s) || (m.code||'').toLowerCase().includes(s) || (m.barcode||'').includes(s) || (m.keywords||'').toLowerCase().includes(s));
  }
  if (filters.low_stock) results = results.filter(m => m.min_stock && m.current_stock < m.min_stock);
  // Enrich with supplier name
  return results.map(m => {
    const sup = m.supplier_id ? data.companies.find(c => c.id === m.supplier_id) : null;
    return { ...m, supplier_name: sup ? sup.name : '' };
  }).sort((a,b) => (a.name||'').localeCompare(b.name||''));
};

db.getMaterialById = function(id) {
  return data.materials.find(m => m.id === id) || null;
};

db.createMaterial = function(fields) {
  const pf = (v) => parseFloat(v) || 0;
  const pi = (v) => parseInt(v) || 0;
  const mat = {
    id: nextId('materials'),
    // === Obecné (General) ===
    code: fields.code || 'MAT-' + String(data.materials.length + 1).padStart(4, '0'),
    name: fields.name,
    external_id: fields.external_id || '',
    status: fields.status || 'active',
    non_stock: !!fields.non_stock,
    sn_mask: fields.sn_mask || '',
    uses_service_eshop: !!fields.uses_service_eshop,
    type: fields.type || 'material',
    classification: fields.classification || '',
    internal_value: fields.internal_value || '',
    family: fields.family || '',
    active_flag: fields.active_flag || 'active',
    color: fields.color || '',
    secondary_color: fields.secondary_color || '',
    export_state: fields.export_state || '',
    keywords: fields.keywords || '',
    unit: fields.unit || 'ks',
    alt_unit: fields.alt_unit || '',
    alt_unit_coeff: pf(fields.alt_unit_coeff),
    similar_goods: fields.similar_goods || '',
    alt_goods: fields.alt_goods || '',
    alt_goods_forecast: fields.alt_goods_forecast || '',
    target_warehouse: fields.target_warehouse || '',
    wait_after_stock_hours: pf(fields.wait_after_stock_hours),
    material_ref: fields.material_ref || '',
    semi_product_ref: fields.semi_product_ref || '',
    route: fields.route || '',
    revision_number: fields.revision_number || '',
    order_number: fields.order_number || '',
    position: fields.position || '',
    drawn_by: fields.drawn_by || '',
    toolbox_name: fields.toolbox_name || '',
    dimension: fields.dimension || '',
    solid_name: fields.solid_name || '',
    supplier_id: fields.supplier_id ? pi(fields.supplier_id) : null,
    group: fields.group || '',
    norm: fields.norm || '',
    weight: pf(fields.weight),
    accounting_unit: fields.accounting_unit || '',
    goods_template: fields.goods_template || '',
    photo_url: fields.photo_url || '',
    description: fields.description || '',
    production_note: fields.production_note || '',
    // === Plánování / Zásoby ===
    internal_status: fields.internal_status || '',
    valid_from: fields.valid_from || '',
    valid_to: fields.valid_to || '',
    customers: fields.customers || '',
    expedition_reserve_days: pf(fields.expedition_reserve_days),
    delivery_tolerance_pct: pf(fields.delivery_tolerance_pct),
    batch_size_min: pf(fields.batch_size_min),
    batch_size_max: pf(fields.batch_size_max),
    batch_size_default: pf(fields.batch_size_default),
    processed_in_multiples: pf(fields.processed_in_multiples),
    min_stock_type: fields.min_stock_type || 'min_stock',
    min_stock: pf(fields.min_stock),
    max_stock_type: fields.max_stock_type || 'total_stock',
    max_stock: pf(fields.max_stock),
    priority: pi(fields.priority),
    release_before_dispatch_days: pf(fields.release_before_dispatch_days),
    forecast_pct: pf(fields.forecast_pct),
    sort_weight: pf(fields.sort_weight),
    daily_target: pf(fields.daily_target),
    // === Checkboxy ===
    distinguish_batches: !!fields.distinguish_batches,
    interchangeable_batches: !!fields.interchangeable_batches,
    no_availability_check: !!fields.no_availability_check,
    check_availability_stage: !!fields.check_availability_stage,
    check_availability_expedition: !!fields.check_availability_expedition,
    plan_orders: !!fields.plan_orders,
    mandatory_scan: !!fields.mandatory_scan,
    save_sn_first_scan: !!fields.save_sn_first_scan,
    temp_barcode: !!fields.temp_barcode,
    auto_complete_after_bom_scan: !!fields.auto_complete_after_bom_scan,
    stock_substitution: fields.stock_substitution || 'none',
    exact_consumption: !!fields.exact_consumption,
    ignore: !!fields.ignore,
    ignore_forecast_eval: !!fields.ignore_forecast_eval,
    split_receipt_by_sales_items: !!fields.split_receipt_by_sales_items,
    // === Expirace ===
    expirable: !!fields.expirable,
    max_acceptable_shelf_life_pct: pf(fields.max_acceptable_shelf_life_pct),
    shelf_life: fields.shelf_life || '',
    shelf_life_unit: fields.shelf_life_unit || 'month',
    allow_rotation: !!fields.allow_rotation,
    // === Kalkulace ===
    unit_price: pf(fields.unit_price),
    weighted_avg_price: pf(fields.unit_price),
    lead_time_days: pf(fields.lead_time_days),
    // === Systémové ===
    factorify_id: fields.factorify_id || null,
    barcode: fields.barcode || '',
    category: fields.category || 'general',
    current_stock: 0,
    active: fields.status !== 'deleted',
    created_at: now(),
    updated_at: now(),
  };
  data.materials.push(mat);
  save();
  logChange('create', 'material', mat.id, `Zboží "${mat.name}" vytvořeno`, null, mat);
  return mat;
};

db.updateMaterial = function(id, fields) {
  const m = data.materials.find(x => x.id === id);
  if (!m) return null;
  const old = { ...m };
  for (const k of Object.keys(fields)) { if (k !== 'id' && k !== 'created_at') m[k] = fields[k]; }
  m.updated_at = now();
  save();
  logChange('update', 'material', id, `Materiál "${m.name}" upraven`, old, m);
  return m;
};

db.deleteMaterial = function(id) {
  const idx = data.materials.findIndex(m => m.id === id);
  if (idx < 0) return false;
  const m = data.materials[idx];
  data.materials.splice(idx, 1);
  save();
  logChange('delete', 'material', id, `Materiál "${m.name}" smazán`, m, null);
  return true;
};

// ============================================
// Inventory Movements
// ============================================
db.getInventoryMovements = function(filters = {}) {
  let results = [...data.inventory_movements];
  if (filters.material_id) results = results.filter(m => m.material_id === parseInt(filters.material_id));
  if (filters.warehouse_id) results = results.filter(m => m.warehouse_id === parseInt(filters.warehouse_id));
  if (filters.type) results = results.filter(m => m.type === filters.type);
  if (filters.from) results = results.filter(m => m.created_at >= filters.from);
  if (filters.to) results = results.filter(m => m.created_at <= filters.to);
  return results.map(mv => {
    const mat = data.materials.find(m => m.id === mv.material_id);
    const wh = data.warehouses.find(w => w.id === mv.warehouse_id);
    return { ...mv, material_name: mat ? mat.name : '—', material_code: mat ? mat.code : '', warehouse_name: wh ? wh.name : '—' };
  }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
};

db.createInventoryMovement = function(fields) {
  const mv = {
    id: nextId('inventory_movements'),
    material_id: parseInt(fields.material_id), warehouse_id: parseInt(fields.warehouse_id),
    location_id: fields.location_id ? parseInt(fields.location_id) : null,
    type: fields.type, // 'receipt' | 'issue' | 'transfer' | 'adjustment'
    quantity: parseFloat(fields.quantity) || 0,
    unit_price: parseFloat(fields.unit_price) || 0,
    reference_type: fields.reference_type || null, // 'order' | 'project' | 'manual'
    reference_id: fields.reference_id || null,
    note: fields.note || '', created_by: fields.created_by || null, created_at: now(),
  };
  data.inventory_movements.push(mv);

  // Update material stock
  const mat = data.materials.find(m => m.id === mv.material_id);
  if (mat) {
    if (mv.type === 'receipt' || mv.type === 'adjustment') {
      // Weighted average price calculation
      if (mv.type === 'receipt' && mv.unit_price > 0 && mv.quantity > 0) {
        const oldTotal = mat.current_stock * (mat.weighted_avg_price || 0);
        const newTotal = mv.quantity * mv.unit_price;
        mat.weighted_avg_price = mat.current_stock + mv.quantity > 0
          ? (oldTotal + newTotal) / (mat.current_stock + mv.quantity) : mv.unit_price;
      }
      mat.current_stock = (mat.current_stock || 0) + mv.quantity;
    } else if (mv.type === 'issue') {
      mat.current_stock = Math.max(0, (mat.current_stock || 0) - mv.quantity);
    }
    // transfer: handled by creating two movements (issue + receipt)
    mat.updated_at = now();
  }

  save();
  logChange('create', 'inventory_movement', mv.id, `Skladový pohyb: ${mv.type} ${mv.quantity}x materiál #${mv.material_id}`, null, mv);
  return mv;
};

// ============================================
// Stock Rules
// ============================================
db.getStockRules = function(filters = {}) {
  let results = [...data.stock_rules];
  if (filters.material_id) results = results.filter(r => r.material_id === parseInt(filters.material_id));
  return results.map(r => {
    const mat = data.materials.find(m => m.id === r.material_id);
    const wh = data.warehouses.find(w => w.id === r.warehouse_id);
    return { ...r, material_name: mat ? mat.name : '—', warehouse_name: wh ? wh.name : '—' };
  });
};

db.createStockRule = function(fields) {
  const rule = {
    id: nextId('stock_rules'),
    material_id: parseInt(fields.material_id), warehouse_id: fields.warehouse_id ? parseInt(fields.warehouse_id) : null,
    min_stock: parseFloat(fields.min_stock) || 0, max_stock: parseFloat(fields.max_stock) || 0,
    reorder_quantity: parseFloat(fields.reorder_quantity) || 0,
    auto_order: fields.auto_order || false,
    preferred_supplier_id: fields.preferred_supplier_id ? parseInt(fields.preferred_supplier_id) : null,
    notes: fields.notes || '',
  };
  data.stock_rules.push(rule);
  save();
  return rule;
};

db.updateStockRule = function(id, fields) {
  const r = data.stock_rules.find(x => x.id === id);
  if (!r) return null;
  for (const k of Object.keys(fields)) { if (k !== 'id') r[k] = fields[k]; }
  save();
  return r;
};

db.deleteStockRule = function(id) {
  const idx = data.stock_rules.findIndex(r => r.id === id);
  if (idx < 0) return false;
  data.stock_rules.splice(idx, 1);
  save();
  return true;
};

// ============================================
// Inventories (Inventury)
// ============================================
db.getInventories = function(filters = {}) {
  let results = [...data.inventories];
  if (filters.warehouse_id) results = results.filter(i => i.warehouse_id === parseInt(filters.warehouse_id));
  if (filters.status) results = results.filter(i => i.status === filters.status);
  return results.map(inv => {
    const wh = data.warehouses.find(w => w.id === inv.warehouse_id);
    const items = data.inventory_items.filter(it => it.inventory_id === inv.id);
    const counted = items.filter(it => it.actual_qty !== null && it.actual_qty !== undefined).length;
    const totalDiff = items.reduce((s, it) => s + (it.value_difference || 0), 0);
    return { ...inv, warehouse_name: wh ? wh.name : '—', items_total: items.length, items_counted: counted, value_difference: totalDiff };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};

db.getInventoryById = function(id) {
  const inv = data.inventories.find(i => i.id === id);
  if (!inv) return null;
  const wh = data.warehouses.find(w => w.id === inv.warehouse_id);
  const items = data.inventory_items.filter(it => it.inventory_id === id).map(it => {
    const mat = data.materials.find(m => m.id === it.material_id);
    const loc = data.warehouse_locations.find(l => l.id === it.location_id);
    return { ...it, material_name: mat ? mat.name : '—', material_code: mat ? mat.code : '', location_label: loc ? loc.label || (loc.section + '-' + loc.rack + '-' + loc.position) : '—' };
  });
  return { ...inv, warehouse_name: wh ? wh.name : '—', items };
};

db.createInventory = function(fields) {
  const inv = {
    id: nextId('inventories'),
    warehouse_id: parseInt(fields.warehouse_id),
    name: fields.name || 'Inventura ' + new Date().toLocaleDateString('cs-CZ'),
    status: 'draft',
    started_at: null, completed_at: null,
    created_by: fields.created_by || null,
    note: fields.note || '',
    created_at: now(),
  };
  data.inventories.push(inv);
  save();
  logChange('create', 'inventory', inv.id, `Inventura "${inv.name}" vytvořena`, null, inv);
  return inv;
};

db.updateInventory = function(id, fields) {
  const inv = data.inventories.find(i => i.id === id);
  if (!inv) return null;
  const old = { ...inv };
  for (const k of Object.keys(fields)) { if (k !== 'id' && k !== 'created_at') inv[k] = fields[k]; }
  save();
  logChange('update', 'inventory', id, `Inventura "${inv.name}" upravena`, old, inv);
  return inv;
};

db.deleteInventory = function(id) {
  const idx = data.inventories.findIndex(i => i.id === id);
  if (idx < 0) return false;
  const inv = data.inventories[idx];
  data.inventories.splice(idx, 1);
  data.inventory_items = data.inventory_items.filter(it => it.inventory_id !== id);
  save();
  logChange('delete', 'inventory', id, `Inventura "${inv.name}" smazána`, inv, null);
  return true;
};

db.startInventory = function(id) {
  const inv = data.inventories.find(i => i.id === id);
  if (!inv) return null;
  inv.status = 'in_progress';
  inv.started_at = now();
  save();
  logChange('update', 'inventory', id, `Inventura "${inv.name}" zahájena`, null, inv);
  return inv;
};

db.generateInventoryItems = function(inventoryId) {
  const inv = data.inventories.find(i => i.id === inventoryId);
  if (!inv) return null;
  // Remove existing items
  data.inventory_items = data.inventory_items.filter(it => it.inventory_id !== inventoryId);
  // Generate items from all active materials
  const mats = data.materials.filter(m => m.active !== false);
  for (const mat of mats) {
    const item = {
      id: nextId('inventory_items'),
      inventory_id: inventoryId,
      material_id: mat.id,
      location_id: null,
      expected_qty: mat.current_stock || 0,
      actual_qty: null,
      difference: null,
      unit_price: mat.weighted_avg_price || mat.unit_price || 0,
      value_difference: null,
      counted_by: null,
      counted_at: null,
      note: '',
    };
    data.inventory_items.push(item);
  }
  save();
  return data.inventory_items.filter(it => it.inventory_id === inventoryId);
};

db.updateInventoryItem = function(id, fields) {
  const item = data.inventory_items.find(i => i.id === id);
  if (!item) return null;
  if (fields.actual_qty !== undefined) {
    item.actual_qty = parseFloat(fields.actual_qty);
    item.difference = item.actual_qty - (item.expected_qty || 0);
    item.value_difference = item.difference * (item.unit_price || 0);
    item.counted_at = now();
  }
  if (fields.counted_by !== undefined) item.counted_by = fields.counted_by;
  if (fields.note !== undefined) item.note = fields.note;
  if (fields.location_id !== undefined) item.location_id = fields.location_id ? parseInt(fields.location_id) : null;
  save();
  return item;
};

db.completeInventory = function(id, applyDifferences) {
  const inv = data.inventories.find(i => i.id === id);
  if (!inv) return null;
  inv.status = 'completed';
  inv.completed_at = now();

  if (applyDifferences) {
    const items = data.inventory_items.filter(it => it.inventory_id === id && it.actual_qty !== null);
    for (const item of items) {
      const mat = data.materials.find(m => m.id === item.material_id);
      if (mat && item.difference !== 0) {
        // Create adjustment movement
        db.createInventoryMovement({
          material_id: item.material_id,
          warehouse_id: inv.warehouse_id,
          location_id: item.location_id,
          type: 'adjustment',
          quantity: item.difference,
          unit_price: item.unit_price || 0,
          reference_type: 'inventory',
          reference_id: inv.id,
          note: 'Inventura: ' + inv.name,
        });
      }
    }
  }

  save();
  logChange('update', 'inventory', id, `Inventura "${inv.name}" dokončena` + (applyDifferences ? ' (rozdíly aplikovány)' : ''), null, inv);
  return inv;
};

// ============================================
// Warehouse Stats
// ============================================
db.getWarehouseStats = function() {
  const totalMaterials = data.materials.filter(m => m.active !== false).length;
  const totalValue = data.materials.reduce((s, m) => s + (m.current_stock || 0) * (m.weighted_avg_price || 0), 0);
  const lowStock = data.materials.filter(m => m.active !== false && m.min_stock > 0 && m.current_stock < m.min_stock).length;
  const activeOrders = data.orders.filter(o => !['delivered','cancelled'].includes(o.status)).length;
  const warehouseCount = data.warehouses.filter(w => w.active !== false).length;
  const companyCount = data.companies.filter(c => c.active !== false).length;
  return { totalMaterials, totalValue, lowStock, activeOrders, warehouseCount, companyCount };
};

db.setCurrentUser = setCurrentUser;

db.getAuditLog = function(filters = {}) {
  let results = [...auditLog];
  if (filters.entity) results = results.filter(e => e.entity === filters.entity);
  if (filters.user) results = results.filter(e => e.user.username === filters.user);
  if (filters.from) results = results.filter(e => e.timestamp >= filters.from);
  if (filters.to) results = results.filter(e => e.timestamp <= filters.to);
  // Return without snapshots (too large for list view)
  return results.map(e => {
    const { snapshot, ...rest } = e;
    return rest;
  }).reverse();
};

db.getAuditEntry = function(id) {
  return auditLog.find(e => e.id === id) || null;
};

db.rollbackToEntry = function(id) {
  const entry = auditLog.find(e => e.id === id);
  if (!entry || !entry.snapshot) return false;

  // Save current state as a rollback entry first
  const snapshotNow = JSON.parse(JSON.stringify(data));
  if (snapshotNow.people) snapshotNow.people.forEach(p => { delete p.photo_url; });

  // Restore data from snapshot
  const restored = JSON.parse(JSON.stringify(entry.snapshot));
  // Preserve _nextId to avoid ID conflicts
  restored._nextId = data._nextId;
  // Restore photo_url from current data (not in snapshot)
  if (restored.people && data.people) {
    for (const rp of restored.people) {
      const current = data.people.find(p => p.id === rp.id);
      if (current && current.photo_url) rp.photo_url = current.photo_url;
    }
  }

  // Apply
  for (const key of Object.keys(DEFAULT_DATA)) {
    data[key] = restored[key] || DEFAULT_DATA[key];
  }
  save();

  // Log the rollback itself
  auditLog.push({
    id: auditLog.length + 1,
    timestamp: now(),
    user: _currentUser ? { username: _currentUser.username, displayName: _currentUser.displayName } : { username: 'system', displayName: 'Systém' },
    action: 'rollback',
    entity: 'system',
    entityId: id,
    description: `Systém vrácen do bodu #${id} (${entry.timestamp})`,
    changes: null,
    snapshot: snapshotNow, // snapshot of state BEFORE rollback
  });
  saveAuditLog();

  return true;
};

console.log('✅ HR Database loaded:', DB_FILE, `(${data.people.length} people, ${data.departments.length} depts, ${auditLog.length} audit entries)`);

module.exports = db;
