// Debug: spustí Claude Vision přímo na první PDF z invoices-incoming
// a vypíše buď extracted_data nebo přesnou chybu z Anthropic API.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractHeader, extractItems } = require('../services/ocr/claude-vision');

function findPdf(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      const r = findPdf(p);
      if (r) return r;
    } else if (p.toLowerCase().endsWith('.pdf')) {
      return p;
    }
  }
  return null;
}

(async () => {
  const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage');
  const dir = path.join(STORAGE_DIR, 'invoices-incoming');
  console.log('Hledám PDF v:', dir);
  const pdf = findPdf(dir);
  if (!pdf) {
    console.error('Žádné PDF nenalezeno.');
    process.exit(1);
  }
  console.log('Testuji:', pdf);
  console.log('Velikost:', fs.statSync(pdf).size, 'B');
  console.log('ANTHROPIC_API_KEY je nastaven:', !!process.env.ANTHROPIC_API_KEY);
  console.log('Délka klíče:', (process.env.ANTHROPIC_API_KEY || '').length);
  console.log('Klíč začíná:', (process.env.ANTHROPIC_API_KEY || '').slice(0, 15));
  console.log();

  console.log('=== PASS 1 — HEADER ===');
  try {
    const h = await extractHeader(pdf);
    console.log('Confidence:', h.confidence);
    console.log('Tokens in/out:', h.input_tokens, '/', h.output_tokens);
    console.log('Duration:', h.duration_ms, 'ms');
    console.log('Data:', JSON.stringify(h.data, null, 2));
  } catch (err) {
    console.error('CHYBA Pass 1:');
    console.error('  message:', err.message);
    console.error('  stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
    if (err.error) console.error('  api error:', err.error);
    if (err.status) console.error('  http status:', err.status);
  }
})();
