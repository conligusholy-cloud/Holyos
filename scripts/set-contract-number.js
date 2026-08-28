// HolyOS — ručně nastaví číslo smlouvy u rezervace a posune globální sekvenci.
//
// Použití:
//   node scripts/set-contract-number.js <hledaný_text|id_rezervace> <číslo>
// Např.:
//   node scripts/set-contract-number.js OFIXIU 6      # → 2026K0006 / 2026N0006, další od 7
//   node scripts/set-contract-number.js 42 6          # podle id rezervace
//
// Vyžaduje DATABASE_URL (nebo $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const matcher = String(process.argv[2] || '').trim();
  const num = parseInt(process.argv[3], 10);
  if (!matcher || !Number.isInteger(num) || num < 1) {
    console.error('Použití: node scripts/set-contract-number.js <text|id> <číslo>');
    process.exit(1);
  }
  const year = new Date().getFullYear();

  // Najdi rezervaci.
  let rec = null;
  if (/^\d+$/.test(matcher)) {
    rec = await prisma.locationReservation.findUnique({ where: { id: Number(matcher) } });
  }
  if (!rec) {
    rec = await prisma.locationReservation.findFirst({
      where: {
        OR: [
          { buyer_name: { contains: matcher, mode: 'insensitive' } },
          { kiosk_code: { equals: matcher.toUpperCase() } },
        ],
      },
      orderBy: { created_at: 'desc' },
    });
  }
  if (!rec) { console.error('Rezervace nenalezena pro:', matcher); process.exit(1); }

  const kupni = year + 'K' + String(num).padStart(4, '0');
  const najemni = year + 'N' + String(num).padStart(4, '0');

  await prisma.locationReservation.update({
    where: { id: rec.id },
    data: { contract_seq: num, contract_no_kupni: kupni, contract_no_najemni: najemni, contract_year: year },
  });
  console.log(`Rezervace #${rec.id} (${rec.kiosk_code}, „${rec.buyer_name || '—'}") → ${kupni} / ${najemni}`);

  // Posuň globální sekvenci na num+1 (jen nahoru, nikdy dolů).
  const row = await prisma.appSetting.findUnique({ where: { key: 'contracts.seq' } });
  const cur = row ? (parseInt(row.value, 10) || 0) : 0;
  const nextSeq = Math.max(cur, num + 1);
  if (row) await prisma.appSetting.update({ where: { key: 'contracts.seq' }, data: { value: String(nextSeq), value_type: 'number' } });
  else await prisma.appSetting.create({ data: { key: 'contracts.seq', value: String(nextSeq), value_type: 'number' } });
  console.log(`Globální sekvence contracts.seq → ${nextSeq} (další nová smlouva dostane ${year}K${String(nextSeq).padStart(4, '0')}).`);

  console.log('Hotovo.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
