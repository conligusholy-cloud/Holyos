// HolyOS — Bitmap label renderer (SVG → PNG → TSPL BITMAP)
// =============================================================================
// Pixel-perfect renderování etiket pro TSC tiskárny v TSPL módu.
//
// Pipeline:
//   1) SVG šablona (z DB nebo souboru) + data → substituce {{placeholderů}}
//   2) Headless Chromium (puppeteer, reused instance) renderuje SVG na canvas
//   3) Threshold pixelů na 1-bit monochrom, packing 8 px/byte (MSB first)
//   4) Sestavení TSPL job: SIZE, GAP, DENSITY, SPEED, BITMAP, PRINT
//
// TSPL BITMAP konvence:
//   bit = 0 → tisk (černý dot)
//   bit = 1 → bílá (žádný tisk)
//
// Browser pool: jeden Chromium pro celý server, jednu page pro každý job
// (rychlé, viz vzor v services/pdf/invoice-pdf.js).
// =============================================================================

'use strict';

let _puppeteer = null;
function getPuppeteer() {
  if (_puppeteer) return _puppeteer;
  try {
    _puppeteer = require('puppeteer');
    return _puppeteer;
  } catch (e) {
    throw new Error('Puppeteer není nainstalovaný. Spusť `npm install puppeteer` v rootu HolyOS.');
  }
}

let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const puppeteer = getPuppeteer();
  _browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
}

/**
 * Substituce {{placeholderů}} v SVG. HTML-escape proti injekci.
 */
function substituteSvg(svg, data) {
  return svg.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const v = data[key];
    if (v === undefined || v === null) return '';
    return String(v).replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
    }[c]));
  });
}

/**
 * Vyrenderuje SVG do 1-bit packed bitmapy.
 *
 * Pracovní postup:
 *   1) Chromium renderuje SVG v 2× rozlišení (lepší rasterizace malých glyfů)
 *   2) downsample s anti-aliasingem na cílové rozlišení (1×)
 *   3) threshold luminance > 128 → bit 1 (white), jinak 0 (print)
 *   4) packing 8 px/byte (MSB first)
 *
 * Vrací mimo packed bitmapy taky náhled jako PNG buffer pro vizuální kontrolu.
 *
 * @param {string} svg
 * @param {number} widthDots
 * @param {number} heightDots
 * @param {object} [options]
 * @param {number} [options.supersample=2]
 * @param {number} [options.threshold=128]
 * @returns {Promise<{widthBytes: number, heightDots: number, data: Buffer, previewPng: Buffer}>}
 */
async function renderSvgToBitmap(svg, widthDots, heightDots, options = {}) {
  const supersample = options.supersample || 2;
  const threshold   = options.threshold   ?? 128;
  const renderW     = widthDots  * supersample;
  const renderH     = heightDots * supersample;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: renderW, height: renderH, deviceScaleFactor: 1 });

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#fff;width:${renderW}px;height:${renderH}px;overflow:hidden;}
      svg{display:block;width:${renderW}px;height:${renderH}px;}
    </style></head><body>${svg}</body></html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);

    const result = await page.evaluate(async (renderW, renderH, w, h, threshold) => {
      // 1) Render SVG at 2× via blob URL → Image → canvas
      const svgEl = document.querySelector('svg');
      const xml = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const canvasHi = document.createElement('canvas');
      canvasHi.width = renderW; canvasHi.height = renderH;
      const ctxHi = canvasHi.getContext('2d');
      ctxHi.fillStyle = 'white';
      ctxHi.fillRect(0, 0, renderW, renderH);

      await new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'sync';
        img.onload = () => { ctxHi.drawImage(img, 0, 0, renderW, renderH); URL.revokeObjectURL(url); resolve(); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
        img.src = url;
      });

      // 2) Downsample to 1× s vysokým AA
      const canvasLo = document.createElement('canvas');
      canvasLo.width = w; canvasLo.height = h;
      const ctxLo = canvasLo.getContext('2d');
      ctxLo.imageSmoothingEnabled = true;
      ctxLo.imageSmoothingQuality = 'high';
      ctxLo.fillStyle = 'white';
      ctxLo.fillRect(0, 0, w, h);
      ctxLo.drawImage(canvasHi, 0, 0, w, h);

      // 3) Preview PNG (samotná 1× rastrová podoba před thresholdem)
      const previewBase64 = canvasLo.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

      // 4) Threshold + pack
      const data = ctxLo.getImageData(0, 0, w, h).data;
      const widthBytes = (w + 7) >> 3;
      const bytes = new Uint8Array(widthBytes * h);

      for (let y = 0; y < h; y++) {
        const rowStart = y * widthBytes;
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const lum = (data[idx] * 299 + data[idx+1] * 587 + data[idx+2] * 114) / 1000;
          // TSPL BITMAP: bit 1 = white (no print), bit 0 = black (print)
          if (lum > threshold) {
            bytes[rowStart + (x >> 3)] |= (0x80 >> (x & 7));
          }
        }
      }

      // 5) Pre-print preview: ten samý 1-bit výstup jako uvidíš na etiketě
      const canvasBw = document.createElement('canvas');
      canvasBw.width = w; canvasBw.height = h;
      const ctxBw = canvasBw.getContext('2d');
      const imgBw = ctxBw.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const bit = (bytes[y * widthBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0; // 0 = print = černá; 1 = nic = bílá
          const i = (y * w + x) * 4;
          imgBw.data[i]     = v;
          imgBw.data[i + 1] = v;
          imgBw.data[i + 2] = v;
          imgBw.data[i + 3] = 255;
        }
      }
      ctxBw.putImageData(imgBw, 0, 0);
      const printPreviewBase64 = canvasBw.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

      return {
        bytes: Array.from(bytes),
        previewBase64,
        printPreviewBase64,
      };
    }, renderW, renderH, widthDots, heightDots, threshold);

    return {
      widthBytes: (widthDots + 7) >> 3,
      heightDots,
      data: Buffer.from(result.bytes),
      previewPng: Buffer.from(result.previewBase64, 'base64'),
      printPreviewPng: Buffer.from(result.printPreviewBase64, 'base64'),
    };
  } finally {
    try { await page.close(); } catch {}
  }
}

/**
 * Sestaví TSPL job s BITMAP příkazem (ascii hlavička + binární data + footer).
 *
 * @param {object} bitmap
 * @param {object} opts {widthMm, heightMm, density, speed, gapMm, copies}
 * @returns {Buffer}
 */
function buildTsplBitmapJob(bitmap, opts) {
  const {
    widthMm = 100, heightMm = 80,
    density = 12, speed = 3,
    gapMm = 2, copies = 1,
  } = opts;

  // ASCII hlavička (TSPL používá CR-LF)
  const header =
    `SIZE ${widthMm} mm, ${heightMm} mm\r\n` +
    `GAP ${gapMm} mm, 0 mm\r\n` +
    `DENSITY ${density}\r\n` +
    `SPEED ${speed}\r\n` +
    `DIRECTION 1\r\n` +
    `REFERENCE 0,0\r\n` +
    `CLS\r\n` +
    `BITMAP 0,0,${bitmap.widthBytes},${bitmap.heightDots},0,`;

  const footer = `\r\nPRINT ${copies},1\r\n`;

  return Buffer.concat([
    Buffer.from(header, 'ascii'),
    bitmap.data,
    Buffer.from(footer, 'ascii'),
  ]);
}

/**
 * Veřejné API — vstup SVG + data + jobové parametry, výstup Buffer pro raw TCP.
 *
 * @param {object} opts
 * @param {string} opts.svg
 * @param {object} opts.data
 * @param {number} opts.widthMm
 * @param {number} opts.heightMm
 * @param {number} [opts.dpi=203]
 * @param {number} [opts.density=12]
 * @param {number} [opts.speed=3]
 * @param {number} [opts.gapMm=2]
 * @param {number} [opts.copies=1]
 */
async function renderTemplate(opts) {
  const {
    svg, data,
    widthMm, heightMm,
    dpi = 203,
    density = 13, speed = 2, gapMm = 2, copies = 1,
    supersample = 3,   // 1 = bez, 2 = standard, 3 = high quality (default), 4 = ultra
    threshold = 140,   // 0-255; vyšší = víc pixelů černé → tlustší tahy
  } = opts;

  const dpmm = dpi / 25.4; // 203 DPI = 7.99 dots/mm ≈ 8
  const widthDots = Math.round(widthMm * dpmm);
  const heightDots = Math.round(heightMm * dpmm);

  const substituted = substituteSvg(svg, data || {});
  const bitmap = await renderSvgToBitmap(substituted, widthDots, heightDots, { supersample, threshold });
  return buildTsplBitmapJob(bitmap, { widthMm, heightMm, density, speed, gapMm, copies });
}

module.exports = { renderTemplate, closeBrowser, substituteSvg, renderSvgToBitmap, buildTsplBitmapJob };
