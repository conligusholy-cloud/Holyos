/* ============================================
   api/hr.js — HR Module API endpoints

   Handles /api/hr/* routes using JSON file DB.
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

    return false; // not handled
  } catch (e) {
    console.error('HR API error:', e);
    sendJSON(res, 500, { error: e.message });
    return true;
  }
}

module.exports = handleHR;
