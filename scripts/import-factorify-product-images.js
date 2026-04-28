// =============================================================================
// HolyOS — Migrace fotografií produktů z Factorify do persistent volume
// =============================================================================
// Stáhne photoUrl ze všech zboží ve Factorify a uloží je do
//   <repo>/data/product-images/<product_id>.<ext>     (lokálně)
//   /app/data/product-images/<product_id>.<ext>       (Railway)
// Následně aktualizuje Product.image_path.
//
// Použití:
//   node scripts/import-factorify-product-images.js              # všechny produkty
//   node scripts/import-factorify-product-images.js --only=2942  # jen jeden produkt
//   node scripts/import-factorify-product-images.js --dry-run    # bez zápisu
//
// Vyžaduje env: FACTORIFY_BASE_URL, FACTORIFY_TOKEN, FACTORIFY_ACCOUNTING_UNIT, DATABASE_URL.
// =============================================================================

require('dotenv').config({ override: true });

const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const BASE_URL = process.env.FACTORIFY_BASE_URL || 'https://bs.factorify.cloud';
const TOKEN = process.env.FACTORIFY_TOKEN || '';
const ACCT = process.env.FACTORIFY_ACCOUNTING_UNIT || '1';

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'product-images');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_ID = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;

// ─── HTTP helper ──────────────────────────────────────────────────────────

function callFactorify(reqPath, body = null, method = 'POST') {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const postData = (method === 'GET' || body == null) ? '' : JSON.stringify(body);
    const headers = {
      'Accept': 'application/json',
      'Cookie': `securityToken=${TOKEN}`,
      'X-AccountingUnit': ACCT,
      'X-FySerialization': 'ui2',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + (url.search || ''), method, headers,
    }, (res) => {
      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
      stream.on('error', e => reject(e));
    });
    req.on('error', e => reject(e));
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Factorify timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// Stáhne binární soubor z Factorify URL (přes session cookie).
function downloadBinary(reqPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const headers = {
      'Cookie': `securityToken=${TOKEN}`,
      'X-AccountingUnit': ACCT,
      'Accept': 'image/*,*/*',
    };
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + (url.search || ''), method: 'GET', headers,
    }, (res) => {
      // Sleduj redirecty (3xx)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadBinary(res.headers.location));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          buffer: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Image download timeout')); });
    req.end();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function ensureImagesDir() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    console.log(`[import-images] Vytvořen adresář ${IMAGES_DIR}`);
  }
}

function extFromPathOrType(urlPath, contentType) {
  const fromPath = (path.extname(urlPath) || '').toLowerCase().replace('.', '');
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fromPath)) {
    return fromPath === 'jpeg' ? 'jpg' : fromPath;
  }
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
}

// ─── Hlavní logika ────────────────────────────────────────────────────────

async function fetchGoodsCatalogWithPhotos() {
  console.log('[import-images] Stahuji Goods katalog z Factorify...');
  // POST /api/query/Goods s prázdným bodyem vrací všechny goods.
  // Některé pole se nemusí dostat do query response — pokud photoUrl chybí,
  // budeme pro každý produkt s factorify_id volat GET /api/goods/{id} jako fallback.
  const r = await callFactorify('/api/query/Goods', {});
  if (r.status !== 200) {
    throw new Error(`Goods katalog: HTTP ${r.status}`);
  }
  const rows = Array.isArray(r.body) ? r.body
    : Array.isArray(r.body?.rows) ? r.body.rows
    : Array.isArray(r.body?.items) ? r.body.items
    : Array.isArray(r.body?.data) ? r.body.data
    : [];
  console.log(`[import-images] Goods katalog: ${rows.length} položek`);

  // Index podle id → row (pro snadné lookup podle factorify_id z HolyOS)
  const byId = new Map();
  for (const g of rows) {
    if (g && g.id != null) byId.set(String(g.id), g);
  }
  return byId;
}

async function getPhotoUrlForFactorifyId(fid, catalog) {
  const row = catalog.get(String(fid));
  if (row && row.photoUrl) return row.photoUrl;

  // Fallback — GET /api/goods/{fid} (vrací plný objekt s photoUrl)
  const r = await callFactorify(`/api/goods/${fid}`, null, 'GET');
  if (r.status !== 200) return null;
  return r.body && r.body.photoUrl ? r.body.photoUrl : null;
}

async function downloadPhoto(photoUrl, label, stats) {
  // photoUrl je relativní cesta typu "storage/2025-3/44303/foo.png"
  let dl;
  try {
    dl = await downloadBinary('/' + photoUrl.replace(/^\/+/, ''));
  } catch (e) {
    console.warn(`[import-images] ${label}: download selhal: ${e.message}`);
    stats.errors++;
    return null;
  }
  if (dl.status !== 200) {
    console.warn(`[import-images] ${label}: HTTP ${dl.status} při stahování ${photoUrl}`);
    stats.errors++;
    return null;
  }
  return dl;
}

async function processProduct(product, catalog, stats) {
  if (!product.factorify_id) {
    stats.no_factorify_id++;
    return;
  }
  let photoUrl;
  try {
    photoUrl = await getPhotoUrlForFactorifyId(product.factorify_id, catalog);
  } catch (e) {
    console.warn(`[import-images] Product#${product.id} (${product.code}): chyba při získání photoUrl: ${e.message}`);
    stats.errors++;
    return;
  }
  if (!photoUrl) { stats.no_photo++; return; }

  const label = `Product#${product.id} (${product.code})`;
  const dl = await downloadPhoto(photoUrl, label, stats);
  if (!dl) return;

  const ext = extFromPathOrType(photoUrl, dl.contentType);
  const filename = `${product.id}.${ext}`;
  const filePath = path.join(IMAGES_DIR, filename);

  if (DRY_RUN) {
    console.log(`[dry-run] ${label}: by uloženo ${filename} (${(dl.buffer.length / 1024).toFixed(1)} kB) z ${photoUrl}`);
    stats.would_save++;
    return;
  }

  fs.writeFileSync(filePath, dl.buffer);
  await prisma.product.update({
    where: { id: product.id },
    data: { image_path: filename },
  });
  console.log(`[import-images] ${label}: uloženo ${filename} (${(dl.buffer.length / 1024).toFixed(1)} kB)`);
  stats.saved++;
}

async function processMaterial(material, catalog, stats) {
  // Material.factorify_id je String?, na rozdíl od Product.factorify_id (Int?)
  if (!material.factorify_id) { stats.no_factorify_id++; return; }
  let photoUrl;
  try {
    photoUrl = await getPhotoUrlForFactorifyId(material.factorify_id, catalog);
  } catch (e) {
    console.warn(`[import-images] Material#${material.id} (${material.code}): chyba při získání photoUrl: ${e.message}`);
    stats.errors++;
    return;
  }
  if (!photoUrl) { stats.no_photo++; return; }

  const label = `Material#${material.id} (${material.code})`;
  const dl = await downloadPhoto(photoUrl, label, stats);
  if (!dl) return;

  const ext = extFromPathOrType(photoUrl, dl.contentType);
  // Prefix "mat-" odlišuje od Product souborů (kolize Product.id × Material.id).
  // Route /api/wh/materials/:id/image hledá soubory podle tohoto prefixu.
  const filename = `mat-${material.id}.${ext}`;
  const filePath = path.join(IMAGES_DIR, filename);
  const apiUrl = `/api/wh/materials/${material.id}/image`;

  if (DRY_RUN) {
    console.log(`[dry-run] ${label}: by uloženo ${filename}, photo_url=${apiUrl}`);
    stats.would_save++;
    return;
  }

  // Smaž případné staré soubory s jiným ext (např. .jpg → .png)
  try {
    const prefix = `mat-${material.id}.`;
    for (const f of fs.readdirSync(IMAGES_DIR)) {
      if (f !== filename && f.startsWith(prefix)) {
        fs.unlinkSync(path.join(IMAGES_DIR, f));
      }
    }
  } catch {}

  fs.writeFileSync(filePath, dl.buffer);
  await prisma.material.update({
    where: { id: material.id },
    data: { photo_url: apiUrl },
  });
  console.log(`[import-images] ${label}: uloženo ${filename} (${(dl.buffer.length / 1024).toFixed(1)} kB)`);
  stats.saved++;
}

async function main() {
  if (!TOKEN) {
    console.error('[import-images] CHYBA: FACTORIFY_TOKEN není nastaven v .env');
    process.exit(1);
  }
  console.log(`[import-images] BASE_URL=${BASE_URL}, IMAGES_DIR=${IMAGES_DIR}, DRY_RUN=${DRY_RUN}`);
  ensureImagesDir();

  // Načti produkty a materiály z HolyOS, které mají factorify_id.
  const productWhere = ONLY_ID
    ? { id: parseInt(ONLY_ID), factorify_id: { not: null } }
    : { factorify_id: { not: null } };
  const products = await prisma.product.findMany({
    where: productWhere,
    select: { id: true, code: true, name: true, factorify_id: true, image_path: true },
    orderBy: { id: 'asc' },
  });
  const materials = ONLY_ID
    ? [] // při --only=N zpracujeme jen daný Product (ID se neshoduje s Material.id)
    : await prisma.material.findMany({
        where: { factorify_id: { not: null } },
        select: { id: true, code: true, name: true, factorify_id: true, photo_url: true },
        orderBy: { id: 'asc' },
      });
  console.log(`[import-images] HolyOS produktů s factorify_id: ${products.length}, materiálů s factorify_id: ${materials.length}`);
  if (products.length === 0 && materials.length === 0) {
    console.log('[import-images] Nic ke zpracování.');
    return;
  }

  const catalog = await fetchGoodsCatalogWithPhotos();

  const stats = { saved: 0, would_save: 0, no_photo: 0, no_factorify_id: 0, errors: 0 };
  // Sekvenčně, aby Factorify nedostal hromadu paralelních requestů
  for (const product of products) {
    await processProduct(product, catalog, stats);
  }
  for (const material of materials) {
    await processMaterial(material, catalog, stats);
  }

  console.log('\n[import-images] Hotovo:');
  console.log(`  uloženo:           ${stats.saved}`);
  console.log(`  by uloženo (dry):  ${stats.would_save}`);
  console.log(`  bez fotky:         ${stats.no_photo}`);
  console.log(`  bez factorify_id:  ${stats.no_factorify_id}`);
  console.log(`  chyby:             ${stats.errors}`);
}

main()
  .catch(e => { console.error('[import-images] FATAL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
