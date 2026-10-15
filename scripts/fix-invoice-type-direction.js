// HolyOS — srovná Invoice.type podle Invoice.direction (opravuje chybu OCR importu: přijatá faktura s typem „issued“).
// Použití:  node scripts/fix-invoice-type-direction.js          (jen vypíše)
//           node scripts/fix-invoice-type-direction.js --apply  (provede změny)
'use strict';
require('dotenv').config();
const { prisma } = require('../config/database');

const TO_AP = { issued: 'received', credit_note_issued: 'credit_note_received', proforma_issued: 'proforma_received' };
const TO_AR = { received: 'issued', credit_note_received: 'credit_note_issued', proforma_received: 'proforma_issued' };

(async () => {
  const apply = process.argv.includes('--apply');
  const bad = await prisma.invoice.findMany({
    where: { OR: [{ direction: 'ap', type: { in: Object.keys(TO_AP) } }, { direction: 'ar', type: { in: Object.keys(TO_AR) } }] },
    select: { id: true, invoice_number: true, type: true, direction: true },
    orderBy: { id: 'asc' },
  });
  console.log(`Nalezeno ${bad.length} dokladů s nesouladem typ/směr.`);
  for (const i of bad) {
    const to = i.direction === 'ap' ? TO_AP[i.type] : TO_AR[i.type];
    console.log(`  ${i.invoice_number}: ${i.type} (${i.direction}) → ${to}`);
    if (apply) await prisma.invoice.update({ where: { id: i.id }, data: { type: to } });
  }
  console.log(apply ? 'Hotovo — změny provedeny.' : 'Nic se nezměnilo. Pro provedení spusť s --apply.');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
