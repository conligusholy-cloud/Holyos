// BS2 — Screenshot „Přehledu podpory" ze starého portálu (partner.bestseries.cz).
// Na rozdíl od legacy-support.js (textový výtah čísel přes fetch+cookie jar) tohle dělá vizuální
// důkaz: headless Chromium se přihlásí jako uživatel (fake-login.php) a vyfotí reálně vykreslenou
// stránku, přesně jak by ji viděl admin v prohlížeči. Používá se jen ručně, jeden klik = jeden uživatel.
'use strict';

const puppeteer = require('puppeteer-core');

const BASE = process.env.LEGACY_PORTAL_URL || 'https://partner.bestseries.cz';
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';

/**
 * Přihlásí se jako uživatel a vyfotí danou stránku starého portálu.
 * @param {string} email
 * @param {string} path např. '/cs/bo/my-invests/'
 * @returns {Promise<Buffer>} PNG screenshot
 */
async function captureSupportScreenshot(email, path = '/cs/bo/my-invests/') {
  if (!email) throw new Error('Uživatel nemá e-mail.');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    // Top-level navigace na fake-login.php — nastaví session cookie stejně, jako když admin klikne na odkaz sám.
    await page.goto(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), { waitUntil: 'networkidle2', timeout: 20000 });
    await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 20000 });
    // Drobná pauza navíc pro případné dopočítání hodnot přes JS po načtení.
    await new Promise((r) => setTimeout(r, 400));
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Hromadné screenshoty: jeden sdílený Chromium, každý uživatel ve vlastním izolovaném kontextu
// (vlastní cookies → žádné míchání přihlášení mezi souběžnými snímky). JPEG kvůli velikosti v DB.
async function openBrowser() {
  return puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
}
async function captureWith(browser, email, { path = '/cs/bo/my-invests/', type = 'jpeg', quality = 72 } = {}) {
  if (!email) throw new Error('Uživatel nemá e-mail.');
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  try {
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    // Zrychlení: nestahovat média a sledovací/chatové skripty (screenshot je nepotřebuje, stránka se načte dřív)
    await page.setRequestInterception(true);
    page.on('request', (rq) => {
      const u = rq.url();
      if (rq.resourceType() === 'media' || /google-analytics|googletagmanager|facebook\.net|hotjar|intercom|doubleclick|clarity\.ms/i.test(u)) rq.abort().catch(() => {});
      else rq.continue().catch(() => {});
    });
    // Rychlá cesta: přihlásit se mimo prohlížeč (fake-login bez následování přesměrování na těžký dashboard),
    // session cookie vložit do kontextu a jít rovnou na Přehled podpory. Když se cookie nepodaří, klasická cesta.
    let fast = false;
    try {
      const r = await fetch(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), { redirect: 'manual', headers: { 'user-agent': 'BS2-admin-snapshot' } });
      let list = []; try { list = r.headers.getSetCookie ? r.headers.getSetCookie() : []; } catch (e) { /* starší Node */ }
      const host = new URL(BASE).hostname;
      const cookies = list.map((c) => { const kv = String(c).split(';')[0]; const i = kv.indexOf('='); return i > 0 ? { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim(), domain: host, path: '/' } : null; }).filter(Boolean);
      if (cookies.length) { await page.setCookie(...cookies); fast = true; }
    } catch (e) { /* fallback níže */ }
    if (!fast) await page.goto(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), { waitUntil: 'domcontentloaded', timeout: 25000 });
    // Místo čekání na „ticho v síti" počkat jen na to, až se na stránce objeví „Celkem jste podpořili: <číslo>" (dopočet JS)
    const ready = () => page.waitForFunction(() => /Celkem jste\s*podpořili:\s*[\d\s .,]*\d/i.test(document.body.innerText || ''), { timeout: 8000 }).catch(() => {});
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await ready();
    if (fast && !/jste podpořili/i.test(await page.evaluate(() => document.body.innerText).catch(() => ''))) {
      // cookie nestačila (portál chce dashboard) → klasické přihlášení v prohlížeči
      await page.goto(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await ready();
    }
    // Přečíst z vykreslené stránky přesně to, co je na screenshotu: „Celkem jste podpořili" (po dopočtu JS) + měnu
    const read = await page.evaluate(() => {
      const t = document.body.innerText || '';
      const m = t.match(/Celkem jste\s*podpořili:\s*([\d\s\u00a0.,]+)\s*(czk|kč|eur|€)/i);
      const y = t.match(/(\d{4}) jste podpořili:\s*([\d\s\u00a0.,]+)\s*(czk|kč|eur|€)/i);
      return { total: m ? m[1] : null, cur: m ? m[2] : (y ? y[3] : null), year: y ? y[1] : null, year_total: y ? y[2] : null };
    }).catch(() => ({}));
    const buf = await page.screenshot(type === 'png' ? { type: 'png', fullPage: true } : { type: 'jpeg', quality, fullPage: true });
    const num = (s) => { if (s == null) return null; const v = Number(String(s).replace(/[\s\u00a0]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isFinite(v) ? v : null; };
    buf.read = { total: num(read.total), currency: read.cur ? (/eur|€/i.test(read.cur) ? 'EUR' : 'CZK') : null, year: read.year ? Number(read.year) : null, year_total: num(read.year_total) };
    return buf;
  } finally {
    await ctx.close().catch(() => {});
  }
}

module.exports = { captureSupportScreenshot, openBrowser, captureWith };
