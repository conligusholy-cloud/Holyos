// HolyOS — Laundromats Marketplace: rozmazání náhledové fotky pro veřejnou ukázku.
// Rozmazání se dělá NA SERVERU a výsledkem je nový obrázek (originál se nikam neposílá), takže se
// z veřejného obrázku nedá zpět získat ani adresa, ani cedule, ani detaily okolí — jen přibližný dojem.
'use strict';
const fs = require('fs');
const path = require('path');

let _browser = null;
async function getBrowser() {
  if (!_browser || !_browser.isConnected()) _browser = await require('puppeteer').launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  return _browser;
}
const cacheDir = () => path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'marketplace-blur');
const inflight = new Map();

// key = unikátní klíč (např. site+photo id) → po změně náhledu se vygeneruje znovu
async function blurPhoto(key, srcFile, mime) {
  const dir = cacheDir(); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, String(key).replace(/[^a-zA-Z0-9_-]/g, '_') + '.jpg');
  if (fs.existsSync(out)) return fs.readFileSync(out);
  if (inflight.has(out)) return inflight.get(out);
  const job = (async () => {
    const b64 = fs.readFileSync(srcFile).toString('base64');
    const page = await (await getBrowser()).newPage();
    try {
      await page.setViewport({ width: 640, height: 400 });
      await page.setContent('<body style="margin:0;background:#0b1220"><div style="width:640px;height:400px;overflow:hidden"><img id="i" src="data:' + (mime || 'image/jpeg') + ';base64,' + b64 + '" style="width:100%;height:100%;object-fit:cover;filter:blur(26px) saturate(1.1);transform:scale(1.3)"></div></body>', { waitUntil: 'load' });
      await page.evaluate(() => new Promise((r) => { const i = document.getElementById('i'); if (i.complete) r(); else { i.onload = r; i.onerror = r; } }));
      const buf = await page.screenshot({ type: 'jpeg', quality: 62, clip: { x: 0, y: 0, width: 640, height: 400 } });
      fs.writeFileSync(out, buf);
      return buf;
    } finally { await page.close().catch(() => {}); }
  })().finally(() => inflight.delete(out));
  inflight.set(out, job);
  return job;
}
module.exports = { blurPhoto };
