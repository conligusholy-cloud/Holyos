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
        type: url.searchParams.get('type') || undefined,
        status: url.searchParams.get('status') || undefined,
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

    // --- INVENTORIES ---
    if (pathname === '/api/wh/inventories' && method === 'GET') {
      const filters = {
        warehouse_id: url.searchParams.get('warehouse_id') || undefined,
        status: url.searchParams.get('status') || undefined,
      };
      sendJSON(res, 200, db.getInventories(filters));
      return true;
    }

    if (pathname === '/api/wh/inventories' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body.warehouse_id) { sendJSON(res, 400, { error: 'warehouse_id is required' }); return true; }
      const inv = db.createInventory(body);
      // Auto-generate items
      db.generateInventoryItems(inv.id);
      sendJSON(res, 201, inv);
      return true;
    }

    const invMatch = pathname.match(/^\/api\/wh\/inventories\/(\d+)$/);
    if (invMatch) {
      const id = parseInt(invMatch[1]);
      if (method === 'GET') {
        const inv = db.getInventoryById(id);
        if (!inv) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, inv);
        return true;
      }
      if (method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const updated = db.updateInventory(id, body);
        if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE') {
        const ok = db.deleteInventory(id);
        if (!ok) { sendJSON(res, 404, { error: 'Not found' }); return true; }
        sendJSON(res, 200, { ok: true });
        return true;
      }
    }

    const invStartMatch = pathname.match(/^\/api\/wh\/inventories\/(\d+)\/start$/);
    if (invStartMatch && method === 'PUT') {
      const id = parseInt(invStartMatch[1]);
      const inv = db.startInventory(id);
      if (!inv) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    const invCompleteMatch = pathname.match(/^\/api\/wh\/inventories\/(\d+)\/complete$/);
    if (invCompleteMatch && method === 'PUT') {
      const id = parseInt(invCompleteMatch[1]);
      const body = JSON.parse(await readBody(req));
      const inv = db.completeInventory(id, body.apply_differences !== false);
      if (!inv) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    const invRegenerateMatch = pathname.match(/^\/api\/wh\/inventories\/(\d+)\/regenerate$/);
    if (invRegenerateMatch && method === 'POST') {
      const id = parseInt(invRegenerateMatch[1]);
      const items = db.generateInventoryItems(id);
      if (!items) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      sendJSON(res, 200, { ok: true, count: items.length });
      return true;
    }

    // --- INVENTORY ITEMS ---
    const invItemMatch = pathname.match(/^\/api\/wh\/inventory-items\/(\d+)$/);
    if (invItemMatch && method === 'PUT') {
      const id = parseInt(invItemMatch[1]);
      const body = JSON.parse(await readBody(req));
      const updated = db.updateInventoryItem(id, body);
      if (!updated) { sendJSON(res, 404, { error: 'Not found' }); return true; }
      sendJSON(res, 200, { ok: true });
      return true;
    }

    // --- FACTORIFY IMPORT ---
    if (pathname === '/api/wh/factorify/goods' && method === 'GET') {
      const https = require('https');
      const baseUrl = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
      const token = process.env.FACTORIFY_TOKEN || '';
      const skip = parseInt(url.searchParams.get('skip')) || 0;
      const take = parseInt(url.searchParams.get('take')) || 100;
      const search = url.searchParams.get('search') || '';

      const postData = JSON.stringify({ skip, take, filter: search ? { Name: { contains: search } } : undefined });
      const fUrl = new URL(baseUrl + '/api/query/Goods');

      const options = {
        hostname: fUrl.hostname, port: 443, path: fUrl.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-FySerialization': 'ui2', 'X-AccountingUnit': '1',
          'Cookie': 'securityToken=' + token, 'Content-Length': Buffer.byteLength(postData),
        },
      };

      try {
        const body = await new Promise((resolve, reject) => {
          const req2 = https.request(options, (res2) => {
            let d = '';
            res2.on('data', chunk => d += chunk);
            res2.on('end', () => resolve(d));
          });
          req2.on('error', reject);
          req2.write(postData);
          req2.end();
        });
        sendJSON(res, 200, JSON.parse(body));
      } catch (e) {
        sendJSON(res, 502, { error: 'Factorify unreachable: ' + e.message });
      }
      return true;
    }

    if (pathname === '/api/wh/factorify/import' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const items = body.items || [];
      if (!items.length) { sendJSON(res, 400, { error: 'No items to import' }); return true; }

      const TYPE_MAP = { 'Výrobek': 'product', 'Materiál': 'material', 'Zboží': 'goods', 'Polotovar': 'semi_product' };
      const STATUS_MAP = { 'Aktivní': 'active', 'Nový': 'new', 'První běh': 'first_run', 'Smazáno': 'deleted' };

      let imported = 0, skipped = 0;
      for (const item of items) {
        // Check if already imported by factorify_id
        const existing = db.getMaterials({}).find(m => m.factorify_id === item.Id);
        if (existing) { skipped++; continue; }

        db.createMaterial({
          code: item.Code || '',
          name: item.Name || 'Bez názvu',
          type: TYPE_MAP[item.TypeLabel] || TYPE_MAP[item.Type] || 'material',
          status: STATUS_MAP[item.StatusLabel] || STATUS_MAP[item.Status] || 'active',
          category: item.Classification || 'general',
          classification: item.Classification || '',
          unit: item.Unit || 'ks',
          factorify_id: item.Id,
          external_id: item.ExternalId || '',
          weight: item.Weight || 0,
          min_stock: item.MinStock || 0,
          max_stock: item.MaxStock || 0,
          barcode: item.Barcode || '',
          description: item.Note || '',
          production_note: item.ProductionNote || '',
          keywords: item.Keywords || '',
          photo_url: item.PhotoUrl || '',
          non_stock: !!item.NonStock,
        });
        imported++;
      }
      sendJSON(res, 200, { ok: true, imported, skipped });
      return true;
    }

    return false;
  } catch (e) {
    console.error('Warehouse API error:', e);
    sendJSON(res, 500, { error: e.message });
    return true;
  }
}

module.exports = handleWarehouse;
