// =============================================================================
// HolyOS — Laundromat Tycoon: úklid starých nabídek pronájmu
// =============================================================================
// Dokud stavba na vlastním pozemku nemazala nabídku pronájmu, zůstal na
// zastavěném pozemku viset inzerát „k pronájmu“. Mapa ho ukazovala, ale
// pronajmout se nedal: /spots/najmout i /spots/pronajem zem se strojem
// odmítají. Tenhle skript takové inzeráty uklidí.
//
// POZOR: zem prodaná pod cizím prádlomatem má v pronajem_cena nájem, který
// provozovatel platí majiteli země (Požadavek #158). Ten se nemaže — proto
// se berou jen řádky bez pozemek_majitel_id.
//
// Spouští se u sebe na stroji, proti databázi z .env:
//   node nastroje/uklid-pronajmy.js            → jen vypíše, co by uklidil
//   node nastroje/uklid-pronajmy.js --opravdu  → doopravdy uklidí
// =============================================================================
'use strict';

const { prisma } = require('../config/database');

(async () => {
  const opravdu = process.argv.indexOf('--opravdu') > 0;
  const rows = await prisma.gameSpotClaim.findMany({
    where: { model: { not: '' }, pronajem_cena: { not: null }, pozemek_majitel_id: null },
    select: { spot_id: true, nick: true, name: true, model: true,
      pronajem_cena: true, najemce_id: true, najemce_nick: true },
    orderBy: { spot_id: 'asc' },
  });
  // Pozemek se strojem A nájemcem zároveň vzniknout neměl. Když takový je,
  // je to jiná chyba než stará nabídka — tu neuklízíme naslepo.
  const sporne = rows.filter((c) => c.najemce_id);
  const uklid = rows.filter((c) => !c.najemce_id);

  console.log('Zastavěných pozemků se starou nabídkou: ' + uklid.length);
  uklid.forEach((c) => {
    console.log('  ' + c.spot_id + '  ' + c.nick + '  ' + c.model
      + '  ' + c.pronajem_cena + ' L$  ' + (c.name || ''));
  });
  if (sporne.length) {
    console.log('\nPOZOR, tyhle NEuklízím — stojí na nich stroj a zároveň mají nájemce:');
    sporne.forEach((c) => console.log('  ' + c.spot_id + '  ' + c.nick
      + '  nájemce ' + c.najemce_nick));
  }
  if (!uklid.length) { console.log('\nNení co uklízet.'); return; }
  if (!opravdu) {
    console.log('\nTohle byl jen výpis. Doopravdy to uklidí:');
    console.log('  node nastroje/uklid-pronajmy.js --opravdu');
    return;
  }
  const r = await prisma.gameSpotClaim.updateMany({
    where: { spot_id: { in: uklid.map((c) => c.spot_id) } },
    data: { pronajem_cena: null, pronajem_sit: false },
  });
  console.log('\nUklizeno: ' + r.count + ' nabídek.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
