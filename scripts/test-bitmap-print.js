// HolyOS — Lokální test bitmap pipeline (bez API, bez DB)
// =============================================================================
// Default mód = PREVIEW: vyrenderuje SVG do PNG, uloží na disk, OTEVŘE v defaultní
// prohlížečce. ŽÁDNÝ TISK. Šetří etikety a umožní iteraci na obrazovce.
//
// Skutečný tisk: přidej argument --print
//
// Použití:
//   node scripts/test-bitmap-print.js           # jen preview
//   node scripts/test-bitmap-print.js --print   # preview + tisk
//
// Výstupní soubory:
//   scripts/preview-grayscale.png   — co Chromium vyrasterizoval (před thresholdem)
//   scripts/preview-1bit.png        — co skutečně půjde na tiskárnu (po thresholdu)
//   scripts/preview.tspl.bin        — binární TSPL job (jen při --print)
// =============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');

const { renderTemplate, closeBrowser, substituteSvg, renderSvgToBitmap, buildTsplBitmapJob } = require('../services/print/bitmap-renderer');

// Cílová tiskárna (TSC TE210 přes port forward)
const PRINTER_IP = '90.183.16.242';
const PRINTER_PORT = 55987;

const SVG_PATH = path.join(__dirname, '..', 'services', 'print', 'templates', 'pradlomat-nameplate.svg');

const DO_PRINT = process.argv.includes('--print');

// Testovací data (typický prádlomat 218S)
const DATA = {
  product_name: 'PRÁDLOMAT',
  type:         'AL218-218S-A',
  date:         '05/2026',
  serial:       '00010 IE',
  power:        '35 kW',
  voltage:      '3x230/400 V',
  weight:       '2 700 kg',
};

async function sendRawTcp(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(8000);
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
    socket.connect(port, ip, () => {
      socket.write(buffer, (err) => {
        if (err) return reject(err);
        // Dej tiskárně čas na ack, pak zavři
        setTimeout(() => { socket.end(() => resolve(buffer.length)); }, 800);
      });
    });
  });
}

(async () => {
  console.log('Načítám SVG:', SVG_PATH);
  const svg = fs.readFileSync(SVG_PATH, 'utf8');

  console.log('Renderuji etiketu 100×80 mm (data:', Object.values(DATA).slice(0, 3).join(' / '), '...)');
  const t0 = Date.now();

  // Použijeme přímo low-level rendererem, ať dostaneme i preview PNG buffery
  const substituted = substituteSvg(svg, DATA);
  const widthDots  = 800;
  const heightDots = 640;
  // supersample 3 = render v 2400×1920, downsample s vysokým AA → výrazně čistší malé glyfy
  // threshold 140 = víc pixelů jde do černé → strokes/fonty plnější
  const bitmap = await renderSvgToBitmap(substituted, widthDots, heightDots, { supersample: 3, threshold: 140 });
  console.log(`Render hotov za ${Date.now() - t0} ms`);

  // Ulož preview PNG (oba)
  const preview1 = path.join(__dirname, 'preview-grayscale.png');
  const preview2 = path.join(__dirname, 'preview-1bit.png');
  fs.writeFileSync(preview1, bitmap.previewPng);
  fs.writeFileSync(preview2, bitmap.printPreviewPng);
  console.log('Preview uloženo:');
  console.log('  Grayscale (Chromium render): ' + preview1);
  console.log('  1-bit (co opravdu pojede na tiskárnu): ' + preview2);

  if (!DO_PRINT) {
    console.log('\n[PREVIEW MÓD] Tisk přeskočen. Otevři PNG, koukni, jestli sedí.');
    console.log('Skutečný tisk: spusť znovu s --print');

    // Otevři v defaultním viewer (Windows)
    if (process.platform === 'win32') {
      exec(`start "" "${preview2}"`);
    }

    await closeBrowser();
    process.exit(0);
  }

  // Skutečný tisk
  const payload = buildTsplBitmapJob(bitmap, {
    widthMm: 100, heightMm: 80,
    density: 13, speed: 2, gapMm: 2, copies: 1,
  });

  const tsplPath = path.join(__dirname, 'preview.tspl.bin');
  fs.writeFileSync(tsplPath, payload);
  console.log('TSPL job uložen: ' + tsplPath + ' (' + payload.length + ' B)');

  console.log(`\nOdesílám na ${PRINTER_IP}:${PRINTER_PORT}...`);
  const bytes = await sendRawTcp(PRINTER_IP, PRINTER_PORT, payload);
  console.log(`OK — odesláno ${bytes} B`);

  await closeBrowser();
  process.exit(0);
})().catch(async (e) => {
  console.error('CHYBA:', e.message);
  console.error(e.stack);
  try { await closeBrowser(); } catch {}
  process.exit(1);
});
