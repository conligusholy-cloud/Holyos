// HolyOS — import do-not-contact seznamu do compounder_blocklist.
// Ukládá JEN e-mail + telefon (normalizované). Ostatní sloupce CSV se ignorují.
// Použití:  node scripts/import-do-not-contact.js <cesta-k-csv>
//   CSV musí mít v hlavičce sloupce "email" a/nebo "phone".
//
// Idempotentní: smaže dřívější import (note='import') a naimportuje znovu.

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function normPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d ? d.slice(-9) : ''; }

(async () => {
  const path = process.argv[2];
  if (!path) { console.error('Použití: node scripts/import-do-not-contact.js <cesta-k-csv>'); process.exit(1); }
  const raw = fs.readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) { console.error('Prázdný soubor.'); process.exit(1); }
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const iEmail = header.indexOf('email');
  const iPhone = header.indexOf('phone');
  if (iEmail === -1 && iPhone === -1) { console.error('CSV nemá sloupec "email" ani "phone". Hlavička:', header.join(', ')); process.exit(1); }

  const emails = new Set(), phones = new Set();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const e = iEmail >= 0 ? normEmail(c[iEmail]) : '';
    const p = iPhone >= 0 ? normPhone(c[iPhone]) : '';
    if (e && /.+@.+\..+/.test(e)) emails.add(e);
    if (p && p.length >= 6) phones.add(p);
  }
  const rows = [];
  emails.forEach((e) => rows.push({ email: e, phone: null, note: 'import' }));
  phones.forEach((p) => rows.push({ email: null, phone: p, note: 'import' }));
  console.log(`Načteno: ${emails.size} e-mailů, ${phones.size} telefonů → ${rows.length} záznamů.`);

  await prisma.compounderBlocklist.deleteMany({ where: { note: 'import' } });
  const B = 1000;
  for (let i = 0; i < rows.length; i += B) {
    await prisma.compounderBlocklist.createMany({ data: rows.slice(i, i + B) });
    process.stdout.write(`\r  importováno ${Math.min(i + B, rows.length)}/${rows.length}`);
  }
  console.log('\nHotovo.');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
