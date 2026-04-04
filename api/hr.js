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

    return false; // not handled
  } catch (e) {
    console.error('HR API error:', e);
    sendJSON(res, 500, { error: e.message });
    return true;
  }
}

module.exports = handleHR;
