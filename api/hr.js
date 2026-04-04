/* ============================================
   api/hr.js — HR Module API endpoints

   Handles /api/hr/* routes for:
   - People (CRUD)
   - Employees (CRUD + extensions)
   - Departments
   - Roles
   - Attendance
   ============================================ */

const db = require('../db');

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

// ============================================
// Main handler
// ============================================
async function handleHR(req, res, pathname) {
  const method = req.method;

  try {
    // --- PEOPLE ---
    if (pathname === '/api/hr/people' && method === 'GET') {
      return getPeople(req, res);
    }
    if (pathname === '/api/hr/people' && method === 'POST') {
      return await createPerson(req, res);
    }
    const personMatch = pathname.match(/^\/api\/hr\/people\/(\d+)$/);
    if (personMatch && method === 'GET') {
      return getPersonById(res, parseInt(personMatch[1]));
    }
    if (personMatch && method === 'PUT') {
      return await updatePerson(req, res, parseInt(personMatch[1]));
    }
    if (personMatch && method === 'DELETE') {
      return deletePerson(res, parseInt(personMatch[1]));
    }

    // --- DEPARTMENTS ---
    if (pathname === '/api/hr/departments' && method === 'GET') {
      return getDepartments(res);
    }
    if (pathname === '/api/hr/departments' && method === 'POST') {
      return await createDepartment(req, res);
    }
    const deptMatch = pathname.match(/^\/api\/hr\/departments\/(\d+)$/);
    if (deptMatch && method === 'PUT') {
      return await updateDepartment(req, res, parseInt(deptMatch[1]));
    }
    if (deptMatch && method === 'DELETE') {
      return deleteDepartment(res, parseInt(deptMatch[1]));
    }

    // --- ROLES ---
    if (pathname === '/api/hr/roles' && method === 'GET') {
      return getRoles(res);
    }
    if (pathname === '/api/hr/roles' && method === 'POST') {
      return await createRole(req, res);
    }
    const roleMatch = pathname.match(/^\/api\/hr\/roles\/(\d+)$/);
    if (roleMatch && method === 'PUT') {
      return await updateRole(req, res, parseInt(roleMatch[1]));
    }
    if (roleMatch && method === 'DELETE') {
      return deleteRole(res, parseInt(roleMatch[1]));
    }

    // --- ATTENDANCE ---
    if (pathname === '/api/hr/attendance' && method === 'GET') {
      return getAttendance(req, res);
    }
    if (pathname === '/api/hr/attendance' && method === 'POST') {
      return await createAttendance(req, res);
    }
    const attMatch = pathname.match(/^\/api\/hr\/attendance\/(\d+)$/);
    if (attMatch && method === 'PUT') {
      return await updateAttendance(req, res, parseInt(attMatch[1]));
    }
    if (attMatch && method === 'DELETE') {
      return deleteAttendance(res, parseInt(attMatch[1]));
    }

    // --- STATS ---
    if (pathname === '/api/hr/stats' && method === 'GET') {
      return getStats(res);
    }

    return false; // not handled
  } catch (e) {
    console.error('HR API error:', e);
    sendJSON(res, 500, { error: e.message });
    return true;
  }
}

// ============================================
// People
// ============================================
function getPeople(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const type = url.searchParams.get('type'); // filter by type
  const search = url.searchParams.get('search');
  const active = url.searchParams.get('active');

  let sql = `
    SELECT p.*,
      e.employee_number, e.department_id, e.role_id, e.hire_date,
      e.contract_type, e.hourly_rate, e.monthly_salary, e.supervisor_id,
      d.name as department_name,
      r.name as role_name
    FROM people p
    LEFT JOIN employees e ON e.person_id = p.id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN roles r ON r.id = e.role_id
    WHERE 1=1
  `;
  const params = [];

  if (type) { sql += ' AND p.type = ?'; params.push(type); }
  if (active !== null && active !== undefined && active !== '') {
    sql += ' AND p.active = ?'; params.push(parseInt(active));
  }
  if (search) {
    sql += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  sql += ' ORDER BY p.last_name, p.first_name';

  const rows = db.prepare(sql).all(...params);
  sendJSON(res, 200, rows);
  return true;
}

function getPersonById(res, id) {
  const person = db.prepare(`
    SELECT p.*,
      e.employee_number, e.department_id, e.role_id, e.hire_date,
      e.contract_type, e.hourly_rate, e.monthly_salary, e.supervisor_id,
      e.birth_date, e.address, e.bank_account,
      d.name as department_name,
      r.name as role_name
    FROM people p
    LEFT JOIN employees e ON e.person_id = p.id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN roles r ON r.id = e.role_id
    WHERE p.id = ?
  `).get(id);

  if (!person) return sendJSON(res, 404, { error: 'Person not found' }), true;
  sendJSON(res, 200, person);
  return true;
}

async function createPerson(req, res) {
  const body = JSON.parse(await readBody(req));
  const { type, first_name, last_name, email, phone, notes,
          employee_number, department_id, role_id, hire_date,
          contract_type, hourly_rate, monthly_salary, supervisor_id,
          birth_date, address, bank_account } = body;

  if (!first_name || !last_name) {
    return sendJSON(res, 400, { error: 'first_name and last_name are required' }), true;
  }

  const insertPerson = db.prepare(`
    INSERT INTO people (type, first_name, last_name, email, phone, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertEmployee = db.prepare(`
    INSERT INTO employees (person_id, employee_number, department_id, role_id, hire_date,
      contract_type, hourly_rate, monthly_salary, supervisor_id, birth_date, address, bank_account)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = insertPerson.run(type || 'employee', first_name, last_name, email || null, phone || null, notes || null);
    const personId = result.lastInsertRowid;

    if ((type || 'employee') === 'employee') {
      insertEmployee.run(personId, employee_number || null, department_id || null,
        role_id || null, hire_date || null, contract_type || null,
        hourly_rate || null, monthly_salary || null, supervisor_id || null,
        birth_date || null, address || null, bank_account || null);
    }

    return personId;
  });

  const personId = transaction();
  const created = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  sendJSON(res, 201, created);
  return true;
}

async function updatePerson(req, res, id) {
  const body = JSON.parse(await readBody(req));
  const existing = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  if (!existing) return sendJSON(res, 404, { error: 'Person not found' }), true;

  const { type, first_name, last_name, email, phone, notes, active,
          employee_number, department_id, role_id, hire_date,
          contract_type, hourly_rate, monthly_salary, supervisor_id,
          birth_date, address, bank_account } = body;

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE people SET type=?, first_name=?, last_name=?, email=?, phone=?, notes=?, active=?, updated_at=datetime('now')
      WHERE id = ?
    `).run(type || existing.type, first_name || existing.first_name, last_name || existing.last_name,
      email !== undefined ? email : existing.email,
      phone !== undefined ? phone : existing.phone,
      notes !== undefined ? notes : existing.notes,
      active !== undefined ? active : existing.active, id);

    if ((type || existing.type) === 'employee') {
      const emp = db.prepare('SELECT * FROM employees WHERE person_id = ?').get(id);
      if (emp) {
        db.prepare(`
          UPDATE employees SET employee_number=?, department_id=?, role_id=?, hire_date=?,
            contract_type=?, hourly_rate=?, monthly_salary=?, supervisor_id=?,
            birth_date=?, address=?, bank_account=?, updated_at=datetime('now')
          WHERE person_id = ?
        `).run(
          employee_number !== undefined ? employee_number : emp.employee_number,
          department_id !== undefined ? department_id : emp.department_id,
          role_id !== undefined ? role_id : emp.role_id,
          hire_date !== undefined ? hire_date : emp.hire_date,
          contract_type !== undefined ? contract_type : emp.contract_type,
          hourly_rate !== undefined ? hourly_rate : emp.hourly_rate,
          monthly_salary !== undefined ? monthly_salary : emp.monthly_salary,
          supervisor_id !== undefined ? supervisor_id : emp.supervisor_id,
          birth_date !== undefined ? birth_date : emp.birth_date,
          address !== undefined ? address : emp.address,
          bank_account !== undefined ? bank_account : emp.bank_account,
          id
        );
      } else {
        db.prepare(`
          INSERT INTO employees (person_id, employee_number, department_id, role_id, hire_date,
            contract_type, hourly_rate, monthly_salary, supervisor_id, birth_date, address, bank_account)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, employee_number || null, department_id || null,
          role_id || null, hire_date || null, contract_type || null,
          hourly_rate || null, monthly_salary || null, supervisor_id || null,
          birth_date || null, address || null, bank_account || null);
      }
    }
  });

  transaction();
  sendJSON(res, 200, { ok: true });
  return true;
}

function deletePerson(res, id) {
  const result = db.prepare('DELETE FROM people WHERE id = ?').run(id);
  if (result.changes === 0) return sendJSON(res, 404, { error: 'Person not found' }), true;
  sendJSON(res, 200, { ok: true });
  return true;
}

// ============================================
// Departments
// ============================================
function getDepartments(res) {
  const rows = db.prepare('SELECT * FROM departments ORDER BY name').all();
  sendJSON(res, 200, rows);
  return true;
}

async function createDepartment(req, res) {
  const { name, parent_id, color } = JSON.parse(await readBody(req));
  if (!name) return sendJSON(res, 400, { error: 'name is required' }), true;
  const result = db.prepare('INSERT INTO departments (name, parent_id, color) VALUES (?, ?, ?)').run(name, parent_id || null, color || '#6c5ce7');
  sendJSON(res, 201, { id: result.lastInsertRowid, name, parent_id, color });
  return true;
}

async function updateDepartment(req, res, id) {
  const { name, parent_id, color } = JSON.parse(await readBody(req));
  db.prepare('UPDATE departments SET name=COALESCE(?,name), parent_id=?, color=COALESCE(?,color), updated_at=datetime(\'now\') WHERE id=?')
    .run(name, parent_id !== undefined ? parent_id : null, color, id);
  sendJSON(res, 200, { ok: true });
  return true;
}

function deleteDepartment(res, id) {
  db.prepare('DELETE FROM departments WHERE id = ?').run(id);
  sendJSON(res, 200, { ok: true });
  return true;
}

// ============================================
// Roles
// ============================================
function getRoles(res) {
  const rows = db.prepare(`
    SELECT r.*, d.name as department_name
    FROM roles r LEFT JOIN departments d ON d.id = r.department_id
    ORDER BY r.name
  `).all();
  sendJSON(res, 200, rows);
  return true;
}

async function createRole(req, res) {
  const { name, department_id, description } = JSON.parse(await readBody(req));
  if (!name) return sendJSON(res, 400, { error: 'name is required' }), true;
  const result = db.prepare('INSERT INTO roles (name, department_id, description) VALUES (?, ?, ?)').run(name, department_id || null, description || null);
  sendJSON(res, 201, { id: result.lastInsertRowid, name });
  return true;
}

async function updateRole(req, res, id) {
  const { name, department_id, description } = JSON.parse(await readBody(req));
  db.prepare('UPDATE roles SET name=COALESCE(?,name), department_id=?, description=COALESCE(?,description) WHERE id=?')
    .run(name, department_id !== undefined ? department_id : null, description, id);
  sendJSON(res, 200, { ok: true });
  return true;
}

function deleteRole(res, id) {
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  sendJSON(res, 200, { ok: true });
  return true;
}

// ============================================
// Attendance
// ============================================
function getAttendance(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const personId = url.searchParams.get('person_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const month = url.searchParams.get('month'); // YYYY-MM

  let sql = `
    SELECT a.*, p.first_name, p.last_name
    FROM attendance a
    JOIN people p ON p.id = a.person_id
    WHERE 1=1
  `;
  const params = [];

  if (personId) { sql += ' AND a.person_id = ?'; params.push(parseInt(personId)); }
  if (from) { sql += ' AND a.date >= ?'; params.push(from); }
  if (to) { sql += ' AND a.date <= ?'; params.push(to); }
  if (month) { sql += ' AND a.date LIKE ?'; params.push(month + '%'); }

  sql += ' ORDER BY a.date DESC, a.clock_in DESC';

  const rows = db.prepare(sql).all(...params);
  sendJSON(res, 200, rows);
  return true;
}

async function createAttendance(req, res) {
  const { person_id, date, clock_in, clock_out, break_minutes, type, note } = JSON.parse(await readBody(req));
  if (!person_id || !date) return sendJSON(res, 400, { error: 'person_id and date are required' }), true;

  const result = db.prepare(`
    INSERT INTO attendance (person_id, date, clock_in, clock_out, break_minutes, type, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(person_id, date, clock_in || null, clock_out || null, break_minutes || 30, type || 'work', note || null);

  sendJSON(res, 201, { id: result.lastInsertRowid });
  return true;
}

async function updateAttendance(req, res, id) {
  const body = JSON.parse(await readBody(req));
  const existing = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  if (!existing) return sendJSON(res, 404, { error: 'Record not found' }), true;

  db.prepare(`
    UPDATE attendance SET clock_in=?, clock_out=?, break_minutes=?, type=?, note=?
    WHERE id = ?
  `).run(
    body.clock_in !== undefined ? body.clock_in : existing.clock_in,
    body.clock_out !== undefined ? body.clock_out : existing.clock_out,
    body.break_minutes !== undefined ? body.break_minutes : existing.break_minutes,
    body.type !== undefined ? body.type : existing.type,
    body.note !== undefined ? body.note : existing.note,
    id
  );
  sendJSON(res, 200, { ok: true });
  return true;
}

function deleteAttendance(res, id) {
  db.prepare('DELETE FROM attendance WHERE id = ?').run(id);
  sendJSON(res, 200, { ok: true });
  return true;
}

// ============================================
// Stats
// ============================================
function getStats(res) {
  const totalPeople = db.prepare('SELECT COUNT(*) as count FROM people WHERE active = 1').get().count;
  const employees = db.prepare("SELECT COUNT(*) as count FROM people WHERE type = 'employee' AND active = 1").get().count;
  const contacts = db.prepare("SELECT COUNT(*) as count FROM people WHERE type != 'employee' AND active = 1").get().count;
  const departments = db.prepare('SELECT COUNT(*) as count FROM departments').get().count;
  const roles = db.prepare('SELECT COUNT(*) as count FROM roles').get().count;

  // Today's attendance
  const today = new Date().toISOString().split('T')[0];
  const presentToday = db.prepare("SELECT COUNT(DISTINCT person_id) as count FROM attendance WHERE date = ? AND type = 'work'").get(today).count;

  sendJSON(res, 200, { totalPeople, employees, contacts, departments, roles, presentToday });
  return true;
}

module.exports = handleHR;
