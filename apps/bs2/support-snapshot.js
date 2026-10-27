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
    await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 25000 });
    if (fast && !/jste podpořili/i.test(await page.evaluate(() => document.body.innerText).catch(() => ''))) {
      // cookie nestačila (portál chce dashboard) → klasické přihlášení v prohlížeči
      await page.goto(BASE + '/php-action/fake-login.php?email=' + encodeURIComponent(email), { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 25000 });
    }
    await new Promise((r) => setTimeout(r, 300));
    return await page.screenshot(type === 'png' ? { type: 'png', fullPage: true } : { type: 'jpeg', quality, fullPage: true });
  } finally {
    await ctx.close().catch(() => {});
  }
}

module.exports = { captureSupportScreenshot, openBrowser, captureWith };
