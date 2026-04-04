/* ============================================
   api/warehouse.js — Warehouse & Purchasing API
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

async function handleWarehouse(req, res, pathname) {
  const method = req.method;
  const url = new URL(req.url, 'http://localhost');

  try {
    // --- STATS ---
    if (pathname === '/api/wh/stats' && method === 'GET') {
      sendJSON(res, 200, db.getWarehouseStats());
      return true;
    }

    // --- COMPANIES ---
    if (pathname === '/api/wh/companies' && method === 'GET') {
      const filters = {
        type: url.searchParams.get('type') || undefined,
        search: url.searchParams.get('search') || undefined,
        active: url.searchParams.get('active') !== null ? url.searchParams.get('active') : undefined,
      };
      sendJSON(res, 200, db.getCompanies(filters));
      return true;
    }

    if (pathname === '/api/wh/companies' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.name) { sendJSON(res, 400, { error: 'name is required' }); return true; }
      sendJSON(res, 201, db.createCompany(body));
      return true;
    }

    const companyMatch = pathname.match(/^\/api\/wh\/companies\/(\d+)$/);
    if (companyMatch) {
      const id = parseInt(companyMatch[1]);
      if (method === 'GET') {
        const c = db.getCompanyById(id);
        if (!c) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, c);
        return true;
      }
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateCompany(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteCompany(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- ARES ICO LOOKUP (proxy to avoid CORS) ---
    const aresMatch = pathname.match(/^\/api\/wh\/ares\/(\d+)$/);
    if (aresMatch && method === 'GET') {
      const ico = aresMatch[1];
      try {
        const https = require('https');
        const aresData = await new Promise((resolve, reject) => {
          https.get(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`, (r) => {
            let d = '';
            r.on('data', ch => d += ch);
            r.on('end', () => {
              try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
            });
          }).on('error', reject);
        });
        const result = {
          name: aresData.obchodniJmeno || '',
          ico: aresData.ico || ico,
          dic: aresData.dic || '',
          address: (aresData.sidlo?.textovaAdresa) || '',
          city: aresData.sidlo?.nazevObce || '',
          zip: aresData.sidlo?.psc ? String(aresData.sidlo.psc) : '',
        };
        sendJSON(res, 200, result);
      } catch (e) {
        sendJSON(res, 404, { error: 'IČO nenalezeno v ARES' });
      }
      return true;
    }

    // --- ORDERS ---
    if (pathname === '/api/wh/orders' && method === 'GET') {
      const filters = {
        type: url.searchParams.get('type') || undefined,
        status: url.searchParams.get('status') || undefined,
        company_id: url.searchParams.get('company_id') || undefined,
        search: url.searchParams.get('search') || undefined,
      };
      sendJSON(res, 200, db.getOrders(filters));
      return true;
    }

    if (pathname === '/api/wh/orders' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.type) { sendJSON(res, 400, { error: 'type is required' }); return true; }
      sendJSON(res, 201, db.createOrder(body));
      return true;
    }

    const orderMatch = pathname.match(/^\/api\/wh\/orders\/(\d+)$/);
    if (orderMatch) {
      const id = parseInt(orderMatch[1]);
      if (method === 'GET') {
        const o = db.getOrderById(id);
        if (!o) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, o);
        return true;
      }
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateOrder(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteOrder(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- ORDER ITEMS ---
    const orderItemsMatch = pathname.match(/^\/api\/wh\/orders\/(\d+)\/items$/);
    if (orderItemsMatch) {
      const orderId = parseInt(orderItemsMatch[1]);
      if (method === 'GET') {
        sendJSON(res, 200, db.getOrderItems(orderId));
        return true;
      }
      if (method === 'POST') {
        const body = JSON.parse(await readBody(req));
        sendJSON(res, 201, db.addOrderItem(orderId, body));
        return true;
      }
    }

    const orderItemMatch = pathname.match(/^\/api\/wh\/order-items\/(\d+)$/);
    if (orderItemMatch) {
      const id = parseInt(orderItemMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateOrderItem(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteOrderItem(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- WAREHOUSES ---
    if (pathname === '/api/wh/warehouses' && method === 'GET') {
      sendJSON(res, 200, db.getWarehouses());
      return true;
    }

    if (pathname === '/api/wh/warehouses' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.name) { sendJSON(res, 400, { error: 'name is required' }); return true; }
      sendJSON(res, 201, db.createWarehouse(body));
      return true;
    }

    const whMatch = pathname.match(/^\/api\/wh\/warehouses\/(\d+)$/);
    if (whMatch) {
      const id = parseInt(whMatch[1]);
      if (method === 'GET') {
        const w = db.getWarehouseById(id);
        if (!w) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, w);
        return true;
      }
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateWarehouse(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteWarehouse(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- WAREHOUSE LOCATIONS ---
    const whLocsMatch = pathname.match(/^\/api\/wh\/warehouses\/(\d+)\/locations$/);
    if (whLocsMatch) {
      const whId = parseInt(whLocsMatch[1]);
      if (method === 'GET') {
        sendJSON(res, 200, db.getWarehouseLocations(whId));
        return true;
      }
      if (method === 'POST') {
        const body = JSON.parse(await readBody(req));
        body.warehouse_id = whId;
        sendJSON(res, 201, db.createWarehouseLocation(body));
        return true;
      }
    }

    const locMatch = pathname.match(/^\/api\/wh\/locations\/(\d+)$/);
    if (locMatch) {
      const id = parseInt(locMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateWarehouseLocation(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteWarehouseLocation(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- MATERIALS ---
    if (pathname === '/api/wh/materials' && method === 'GET') {
      const filters = {
        category: url.searchParams.get('category') || undefined,
        search: url.searchParams.get('search') || undefined,
        low_stock: url.searchParams.get('low_stock') === 'true' || undefined,
      };
      sendJSON(res, 200, db.getMaterials(filters));
      return true;
    }

    if (pathname === '/api/wh/materials' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.name) { sendJSON(res, 400, { error: 'name is required' }); return true; }
      sendJSON(res, 201, db.createMaterial(body));
      return true;
    }

    const matMatch = pathname.match(/^\/api\/wh\/materials\/(\d+)$/);
    if (matMatch) {
      const id = parseInt(matMatch[1]);
      if (method === 'GET') {
        const m = db.getMaterialById(id);
        if (!m) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, m);
        return true;
      }
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateMaterial(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteMaterial(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    // --- INVENTORY MOVEMENTS ---
    if (pathname === '/api/wh/movements' && method === 'GET') {
      const filters = {
        material_id: url.searchParams.get('material_id') || undefined,
        warehouse_id: url.searchParams.get('warehouse_id') || undefined,
        type: url.searchParams.get('type') || undefined,
      };
      sendJSON(res, 200, db.getInventoryMovements(filters));
      return true;
    }

    if (pathname === '/api/wh/movements' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.material_id || !body.warehouse_id || !body.type || !body.quantity) {
        sendJSON(res, 400, { error: 'material_id, warehouse_id, type, and quantity are required' });
        return true;
      }
      sendJSON(res, 201, db.createInventoryMovement(body));
      return true;
    }

    // --- STOCK RULES ---
    if (pathname === '/api/wh/stock-rules' && method === 'GET') {
      const filters = { material_id: url.searchParams.get('material_id') || undefined };
      sendJSON(res, 200, db.getStockRules(filters));
      return true;
    }

    if (pathname === '/api/wh/stock-rules' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.material_id) { sendJSON(res, 400, { error: 'material_id is required' }); return true; }
      sendJSON(res, 201, db.createStockRule(body));
      return true;
    }

    const ruleMatch = pathname.match(/^\/api\/wh\/stock-rules\/(\d+)$/);
    if (ruleMatch) {
      const id = parseInt(ruleMatch[1]);
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateStockRule(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteStockRule(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    return false;
  } catch (e) {
    console.error('Warehouse API error:', e);
    sendJSON(res, 500, { error: e.message });
    return true;
  }
}

module.exports = handleWarehouse;
