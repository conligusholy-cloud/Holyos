// Oprava FV-2026-00001: OCR ji špatně klasifikovala jako AR (vydanou) s firmou
// BEST SERIES s.r.o., ale ve skutečnosti je to AP (přijatá) od BestDrive Czech Republic
// (IČ 41193598). BestDrive IČ je v PDF jen v small-print hlavičce, naše IČ vlevo
// dole v "Odběratel" — OCR to obrátila.
require('dotenv').config({ override: true });
const { prisma } = require('../config/database');

(async () => {
  // 1) Najdi nebo upsert BestDrive Company
  const bestDriveIco = '41193598';
  let bestDrive = await prisma.company.findFirst({ where: { ico: bestDriveIco } });
  if (!bestDrive) {
    bestDrive = await prisma.company.create({
      data: {
        ico: bestDriveIco,
        dic: 'CZ41193598',
        name: 'BestDrive Czech Republic s.r.o.',
        address_street: 'Objízdná 1628',
        address_city: 'Otrokovice',
        address_zip: '765 02',
        country: 'CZ',
      },
    });
    console.log(`✓ Vytvořena Company BestDrive id=${bestDrive.id}`);
  } else {
    console.log(`✓ Company BestDrive nalezena id=${bestDrive.id}`);
  }

  // 2) Najdi špatnou fakturu
  const wrong = await prisma.invoice.findFirst({
    where: { invoice_number: 'FV-2026-00001' },
  });
  if (!wrong) {
    console.error('FV-2026-00001 nenalezena.');
    process.exit(1);
  }
  console.log(`Před opravou: id=${wrong.id} direction=${wrong.direction} company_id=${wrong.company_id} number=${wrong.invoice_number}`);

  // 3) Spočítej nové FP- číslo (poslední FP-2026-NNNNN + 1)
  const lastFp = await prisma.invoice.findFirst({
    where: { invoice_number: { startsWith: 'FP-2026-' } },
    orderBy: { invoice_number: 'desc' },
    select: { invoice_number: true },
  });
  let nextSeq = 11;
  if (lastFp) {
    const m = lastFp.invoice_number.match(/FP-2026-(\d+)/);
    if (m) nextSeq = parseInt(m[1], 10) + 1;
  }
  const newNumber = `FP-2026-${String(nextSeq).padStart(5, '0')}`;
  console.log(`Nové číslo: ${newNumber}`);

  // 4) Update — direction AR → AP, company → BestDrive, číslo FV → FP
  const updated = await prisma.invoice.update({
    where: { id: wrong.id },
    data: {
      direction: 'ap',
      company_id: bestDrive.id,
      invoice_number: newNumber,
      // BankAccount už je správně 10382647/6200 (na PDF souhlasí)
      // VS, datum vystavení, DUZP, splatnost, položky a celkem zůstávají
    },
  });
  console.log(`\n✓ Opraveno: ${updated.invoice_number} direction=${updated.direction} company_id=${updated.company_id}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
