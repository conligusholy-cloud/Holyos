/* ============================================
   api/hr.js — HR Module API endpoints

   Handles /api/hr/* routes using JSON file DB.
   ============================================ */

const db = require('../db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Auth helpers (same as server.js)
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); }
  catch (e) { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

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
// Main handler — returns true if handled
// ============================================
async function handleHR(req, res, pathname) {
  const method = req.method;

  try {
    // --- STATS ---
    if (pathname === '/api/hr/stats' && method === 'GET') {
      sendJSON(res, 200, db.getStats());
      return true;
    }

    // --- PEOPLE ---
    if (pathname === '/api/hr/people' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const filters = {
        type: url.searchParams.get('type') || undefined,
        active: url.searchParams.get('active'),
        search: url.searchParams.get('search') || undefined,
      };
      sendJSON(res, 200, db.getAllPeople(filters));
      return true;
    }

    if (pathname === '/api/hr/people' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.first_name || !body.last_name) {
        sendJSON(res, 400, { error: 'first_name and last_name are required' });
        return true;
      }
      const person = db.createPerson(body);
      sendJSON(res, 201, person);
      return true;
    }

    const personMatch = pathname.match(/^\/api\/hr\/people\/(\d+)$/);
    if (personMatch) {
      const id = parseInt(personMatch[1]);

      if (method === 'GET') {
        const person = db.getPersonById(id);
        if (!person) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, person);
        return true;
      }

      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updatePerson(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }

      if (method === 'DELETE') {
        const ok = db.deletePerson(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- DEPARTMENTS ---
    if (pathname === '/api/hr/departments' && method === 'GET') {
      sendJSON(res, 200, db.getAllDepartments());
      return true;
    }

    if (pathname === '/api/hr/departments' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.name) { sendJSON(res, 400, { error: 'name is required' }); return true; }
      sendJSON(res, 201, db.createDepartment(body));
      return true;
    }

    const deptMatch = pathname.match(/^\/api\/hr\/departments\/(\d+)$/);
    if (deptMatch) {
      const id = parseInt(deptMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateDepartment(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        db.deleteDepartment(id);
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- ROLES ---
    if (pathname === '/api/hr/roles' && method === 'GET') {
      sendJSON(res, 200, db.getAllRoles());
      return true;
    }

    if (pathname === '/api/hr/roles' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.name) { sendJSON(res, 400, { error: 'name is required' }); return true; }
      sendJSON(res, 201, db.createRole(body));
      return true;
    }

    const roleMatch = pathname.match(/^\/api\/hr\/roles\/(\d+)$/);
    if (roleMatch) {
      const id = parseInt(roleMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateRole(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        db.deleteRole(id);
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- ATTENDANCE ---
    if (pathname === '/api/hr/attendance' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const filters = {
        person_id: url.searchParams.get('person_id') || undefined,
        month: url.searchParams.get('month') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      };
      sendJSON(res, 200, db.getAttendance(filters));
      return true;
    }

    if (pathname === '/api/hr/attendance' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.person_id || !body.date) {
        sendJSON(res, 400, { error: 'person_id and date are required' });
        return true;
      }
      sendJSON(res, 201, db.createAttendance(body));
      return true;
    }

    const attMatch = pathname.match(/^\/api\/hr\/attendance\/(\d+)$/);
    if (attMatch) {
      const id = parseInt(attMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateAttendance(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        db.deleteAttendance(id);
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- USER ACCOUNT (create login for a person) ---
    const userAccMatch = pathname.match(/^\/api\/hr\/people\/(\d+)\/account$/);
    if (userAccMatch && method === 'POST') {
      const personId = parseInt(userAccMatch[1]);
      const person = db.getPersonById(personId);
      if (!person) { sendJSON(res, 404, { error: 'Person not found' }); return true; }

      const body = JSON.parse(await readBody(req));
      const { username, password, role } = body;
      if (!username || !password) {
        sendJSON(res, 400, { error: 'username and password are required' });
        return true;
      }

      const users = loadUsers();
      if (users.find(u => u.username === username)) {
        sendJSON(res, 400, { error: 'Uživatelské jméno již existuje' });
        return true;
      }

      const { hash, salt } = hashPassword(password);
      const newUser = {
        id: Math.max(0, ...users.map(u => u.id)) + 1,
        username: username.trim(),
        displayName: (person.first_name + ' ' + person.last_name).trim(),
        hash, salt,
        role: role || 'user',
        personId: personId,
        created: new Date().toISOString(),
      };
      users.push(newUser);
      saveUsers(users);

      // Link user to person
      db.updatePerson(personId, { user_id: newUser.id, username: newUser.username });

      console.log(`✅ Vytvořen účet: ${newUser.displayName} (${newUser.username}) pro osobu #${personId}`);
      sendJSON(res, 201, { ok: true, user_id: newUser.id, username: newUser.username });
      return true;
    }

    // --- UPDATE PASSWORD ---
    const pwdMatch = pathname.match(/^\/api\/hr\/people\/(\d+)\/password$/);
    if (pwdMatch && method === 'PUT') {
      const personId = parseInt(pwdMatch[1]);
      const person = db.getPersonById(personId);
      if (!person || !person.user_id) { sendJSON(res, 404, { error: 'No account linked' }); return true; }

      const body = JSON.parse(await readBody(req));
      if (!body.password) { sendJSON(res, 400, { error: 'password is required' }); return true; }

      const users = loadUsers();
      const user = users.find(u => u.id === person.user_id);
      if (!user) { sendJSON(res, 404, { error: 'User not found' }); return true; }

      const { hash, salt } = hashPassword(body.password);
      user.hash = hash;
      user.salt = salt;
      saveUsers(users);

      sendJSON(res, 200, { ok: true });
      return true;
    }

    // ---- PHOTO UPLOAD (base64) ----
    const photoMatch = pathname.match(/^\/api\/hr\/people\/(\d+)\/photo$/);
    if (photoMatch && req.method === 'POST') {
      const personId = parseInt(photoMatch[1]);
      const body = JSON.parse(await readBody(req));
      if (!body.photo_url) {
        sendJSON(res, 400, { error: 'photo_url required' });
        return true;
      }
      // Validate it's a data URL (base64 image)
      if (!body.photo_url.startsWith('data:image/')) {
        sendJSON(res, 400, { error: 'Invalid image format' });
        return true;
      }
      const updated = db.updatePerson(personId, { photo_url: body.photo_url });
      if (!updated) {
        sendJSON(res, 404, { error: 'Person not found' });
        return true;
      }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    // ---- DELETE PHOTO ----
    if (photoMatch && req.method === 'DELETE') {
      const personId = parseInt(photoMatch[1]);
      const updated = db.updatePerson(personId, { photo_url: null });
      if (!updated) {
        sendJSON(res, 404, { error: 'Person not found' });
        return true;
      }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    // --- SHIFTS ---
    if (pathname === '/api/hr/shifts' && method === 'GET') {
      sendJSON(res, 200, db.getShifts());
      return true;
    }

    if (pathname === '/api/hr/shifts' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.name) {
        sendJSON(res, 400, { error: 'name is required' });
        return true;
      }
      sendJSON(res, 201, db.createShift(body));
      return true;
    }

    const shiftMatch = pathname.match(/^\/api\/hr\/shifts\/(\d+)$/);
    if (shiftMatch) {
      const id = parseInt(shiftMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateShift(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteShift(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- ABSENCE TYPES ---
    if (pathname === '/api/hr/absence-types' && method === 'GET') {
      sendJSON(res, 200, db.getAbsenceTypes());
      return true;
    }

    if (pathname === '/api/hr/absence-types' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.name) {
        sendJSON(res, 400, { error: 'name is required' });
        return true;
      }
      sendJSON(res, 201, db.createAbsenceType(body));
      return true;
    }

    const absenceTypeMatch = pathname.match(/^\/api\/hr\/absence-types\/(\d+)$/);
    if (absenceTypeMatch) {
      const id = parseInt(absenceTypeMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateAbsenceType(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteAbsenceType(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- LEAVE REQUESTS ---
    if (pathname === '/api/hr/leave-requests' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const filters = {
        person_id: url.searchParams.get('person_id') || undefined,
        status: url.searchParams.get('status') || undefined,
      };
      sendJSON(res, 200, db.getLeaveRequests(filters));
      return true;
    }

    if (pathname === '/api/hr/leave-requests' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.person_id || !body.date_from || !body.date_to) {
        sendJSON(res, 400, { error: 'person_id, date_from, and date_to are required' });
        return true;
      }
      sendJSON(res, 201, db.createLeaveRequest(body));
      return true;
    }

    const leaveApproveMatch = pathname.match(/^\/api\/hr\/leave-requests\/(\d+)\/approve$/);
    if (leaveApproveMatch && method === 'PUT') {
      const id = parseInt(leaveApproveMatch[1]);
      const body = JSON.parse(await readBody(req));
      if (!body.approved_by) {
        sendJSON(res, 400, { error: 'approved_by is required' });
        return true;
      }
      const result = db.approveLeaveRequest(id, body.approved_by);
      if (!result) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    const leaveRejectMatch = pathname.match(/^\/api\/hr\/leave-requests\/(\d+)\/reject$/);
    if (leaveRejectMatch && method === 'PUT') {
      const id = parseInt(leaveRejectMatch[1]);
      const body = JSON.parse(await readBody(req));
      if (!body.rejected_by) {
        sendJSON(res, 400, { error: 'rejected_by is required' });
        return true;
      }
      const result = db.rejectLeaveRequest(id, body.rejected_by);
      if (!result) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    // --- KIOSK ---
    if (pathname === '/api/hr/kiosk/identify' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.chip_id) {
        sendJSON(res, 400, { error: 'chip_id is required' });
        return true;
      }
      const person = db.findPersonByChip(body.chip_id);
      if (!person) {
        sendJSON(res, 404, { error: 'Person not found' });
        return true;
      }
      sendJSON(res, 200, person);
      return true;
    }

    if (pathname === '/api/hr/kiosk/clock' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.person_id || !body.action) {
        sendJSON(res, 400, { error: 'person_id and action are required' });
        return true;
      }
      const result = db.clockAction(body.person_id, body.action, body.absence_type);
      sendJSON(res, 200, result);
      return true;
    }

    // --- PRESENCE ---
    if (pathname === '/api/hr/presence' && method === 'GET') {
      sendJSON(res, 200, db.getTodayPresence());
      return true;
    }

    // --- LEAVE SETTINGS ---
    if (pathname === '/api/hr/leave-settings' && method === 'GET') {
      sendJSON(res, 200, db.getLeaveSettings());
      return true;
    }

    if (pathname === '/api/hr/leave-settings' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      sendJSON(res, 200, db.updateLeaveSettings(body));
      return true;
    }

    // --- OVERTIME SETTINGS ---
    if (pathname === '/api/hr/overtime-settings' && method === 'GET') {
      sendJSON(res, 200, db.getOvertimeSettings());
      return true;
    }

    if (pathname === '/api/hr/overtime-settings' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      sendJSON(res, 200, db.updateOvertimeSettings(body));
      return true;
    }

    // --- LEAVE BALANCE ---
    const leaveBalanceMatch = pathname.match(/^\/api\/hr\/leave-balance\/(\d+)$/);
    if (leaveBalanceMatch && method === 'GET') {
      const personId = parseInt(leaveBalanceMatch[1]);
      const url = new URL(req.url, 'http://localhost');
      const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
      sendJSON(res, 200, db.getLeaveBalance(personId, year));
      return true;
    }

    if (pathname === '/api/hr/leave-balances' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
      sendJSON(res, 200, db.getAllLeaveBalances(year));
      return true;
    }

    // --- OVERTIME SUMMARY ---
    const overtimeMatch = pathname.match(/^\/api\/hr\/overtime\/(\d+)$/);
    if (overtimeMatch && method === 'GET') {
      const personId = parseInt(overtimeMatch[1]);
      const url = new URL(req.url, 'http://localhost');
      const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
      const month = url.searchParams.get('month') ? parseInt(url.searchParams.get('month')) : null;
      sendJSON(res, 200, db.getOvertimeSummary(personId, year, month));
      return true;
    }

    if (pathname === '/api/hr/overtime-all' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
      const month = url.searchParams.get('month') ? parseInt(url.searchParams.get('month')) : null;
      sendJSON(res, 200, db.getAllOvertimeSummaries(year, month));
      return true;
    }

    // --- COMPANY-WIDE LEAVE ---
    if (pathname === '/api/hr/company-leave' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const year = url.searchParams.get('year') ? parseInt(url.searchParams.get('year')) : undefined;
      sendJSON(res, 200, db.getCompanyLeave(year));
      return true;
    }

    if (pathname === '/api/hr/company-leave' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.date_from || !body.date_to || !body.name) {
        sendJSON(res, 400, { error: 'date_from, date_to, and name are required' });
        return true;
      }
      sendJSON(res, 201, db.createCompanyLeave(body));
      return true;
    }

    const companyLeaveMatch = pathname.match(/^\/api\/hr\/company-leave\/(\d+)$/);
    if (companyLeaveMatch && method === 'DELETE') {
      const id = parseInt(companyLeaveMatch[1]);
      const ok = db.deleteCompanyLeave(id);
      if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    return false; // not handled
  } catch (e) {
    console.error('HR API error:', e);
    sendJSON(res, 500, { error: e.message });
    return true;
  }
}

module.exports = handleHR;
