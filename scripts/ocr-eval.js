// HolyOS — vyhodnocení přesnosti OCR na reálných fakturách
// Znovu přečte PDF/obrázky už založených faktur (extractHeader s textovou vrstvou) a porovná s uloženými (opravenými) hodnotami.
// Použití (PowerShell):
//   $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL; node scripts/ocr-eval.js --limit=30
//   node scripts/ocr-eval.js --ids=813,825,829
//   node scripts/ocr-eval.js --limit=50 --since=2026-09-01 --model=opus
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { prisma } = require('../config/database');
const { extractHeader } = require('../services/ocr/claude-vision');
const { validateHeaderNumbers } = require('../services/ocr/validators');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
const normText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(s r o|spol|a s|inc|ltd|gmbh|llc|limited|ireland|ulc)\b/g, '').trim();
const normAcc = (s) => String(s || '').replace(/\s+/g, '').replace(/^0+/, '');
const num = (v) => (v == null || v === '' ? null : Number(v));

const FIELDS = {
  supplier_name: (h, inv) => cmpName(h.supplier && h.supplier.name, inv.company && inv.company.name),
  supplier_ico: (h, inv) => cmpEq(digits(h.supplier && h.supplier.ico).replace(/^0+/, ''), digits(inv.company && inv.company.ico).replace(/^0+/, '')),
  external_number: (h, inv) => cmpEq(String(h.external_number || '').replace(/\s+/g, ''), String(inv.external_number || '').replace(/\s+/g, '')),
  total: (h, inv) => {
    const a = num(h.total), b = num(inv.total);
    if (a == null || b == null) return null;
    return Math.abs(a - b) < 0.011 ? 'ok' : 'x';
  },
  payment_method: (h, inv) => {
    const card = h.paid_by_card === true;
    const got = card ? 'card' : (inv.payment_method === 'card' ? 'other' : inv.payment_method);
    if (!inv.payment_method) return null;
    return (card ? 'card' : (inv.payment_method === 'card' ? 'bank_transfer' : inv.payment_method)) === inv.payment_method ? 'ok' : 'x';
  },
  partner_account: (h, inv) => {
    const want = normAcc(inv.partner_bank_account) || digits(inv.partner_iban);
    if (!want) return null;
    const got = normAcc(h.partner_bank_account) || String(h.partner_iban || '').replace(/\s+/g, '');
    const w = String(inv.partner_iban || '').replace(/\s+/g, '');
    return (normAcc(h.partner_bank_account) === normAcc(inv.partner_bank_account) && normAcc(inv.partner_bank_account)) ||
      (w && String(h.partner_iban || '').replace(/\s+/g, '') === w) ? 'ok' : 'x';
  },
};

function cmpEq(a, b) { if (!b) return null; return a === b ? 'ok' : 'x'; }
function cmpName(a, b) {
  if (!b) return null;
  const x = normText(a), y = normText(b);
  if (!x) return 'x';
  return (x === y || x.includes(y) || y.includes(x)) ? 'ok' : 'x';
}

(async () => {
  const where = { source_file_path: { not: null } };
  if (args.ids) where.id = { in: String(args.ids).split(',').map(Number).filter(Boolean) };
  if (args.since) where.created_at = { gte: new Date(args.since) };
  const invoices = await prisma.invoice.findMany({
    where, include: { company: true }, orderBy: { id: 'desc' },
    take: args.ids ? undefined : Number(args.limit || 30),
  });
  console.log(`Vyhodnocuji ${invoices.length} faktur…\n`);

  const stats = {}; for (const f of Object.keys(FIELDS)) stats[f] = { ok: 0, x: 0 };
  const mismatches = []; let checksumBad = 0, read = 0, failed = 0;

  for (const inv of invoices) {
    let file = inv.source_file_path;
    if (!fs.existsSync(file)) { const alt = path.resolve(process.cwd(), file); if (fs.existsSync(alt)) file = alt; }
    if (!fs.existsSync(file)) { console.log(`#${inv.id} ${inv.invoice_number || ''}: soubor nenalezen (${inv.source_file_path})`); failed++; continue; }
    try {
      const res = await extractHeader(file, args.model === 'opus' ? { model: require('../services/ocr/claude-vision').MODEL_OPUS } : {});
      const h = res.data || {};
      read++;
      if (!validateHeaderNumbers(h).ok) checksumBad++;
      const row = [];
      for (const [f, fn] of Object.entries(FIELDS)) {
        const r = fn(h, inv);
        if (r == null) continue;
        stats[f][r]++;
        if (r === 'x') row.push(f);
      }
      if (row.length) mismatches.push({ id: inv.id, number: inv.invoice_number, fields: row, ocr: { supplier: h.supplier && h.supplier.name, ico: h.supplier && h.supplier.ico, ext: h.external_number, total: h.total, card: h.paid_by_card, acc: h.partner_bank_account || h.partner_iban }, db: { supplier: inv.company && inv.company.name, ico: inv.company && inv.company.ico, ext: inv.external_number, total: Number(inv.total), pm: inv.payment_method, acc: inv.partner_bank_account || inv.partner_iban } });
      process.stdout.write(row.length ? 'x' : '.');
    } catch (e) {
      failed++; process.stdout.write('!');
    }
  }

  console.log('\n\n=== Přesnost podle polí ===');
  for (const [f, s] of Object.entries(stats)) {
    const n = s.ok + s.x;
    console.log(`${f.padEnd(18)} ${n ? ((s.ok / n) * 100).toFixed(1) + ' %' : '—'}  (${s.ok}/${n})`);
  }
  console.log(`\nPřečteno: ${read}, selhalo: ${failed}, neplatný kontrolní součet: ${checksumBad}`);
  if (mismatches.length) {
    console.log('\n=== Neshody ===');
    for (const m of mismatches) {
      console.log(`#${m.id} ${m.number || ''}  [${m.fields.join(', ')}]`);
      console.log('   OCR:', JSON.stringify(m.ocr));
      console.log('   DB :', JSON.stringify(m.db));
    }
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
