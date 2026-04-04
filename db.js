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
  _nextId: { people: 1, departments: 1, roles: 1, attendance: 1, admin_tasks: 1, shifts: 1, absence_types: 1, leave_requests: 1 },
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
