// Doplnění zemí k městům, která hráči prozkoumali dřív, než se země začala
// ukládat. Z ní jsou pak vlaječky u hráčů v žebříčku.
//
// Běží při startu serveru na pozadí a je idempotentní: bere jen města, kde
// země chybí, a jede pomalu — geokodér OpenStreetMap chce nejvýš dotaz za
// vteřinu. Co se nepodaří zjistit, dostane „xx", ať se to nezkouší pořád dokola.
const { prisma } = require('../../config/database');
const finder = require('../spots/finder');

const NAJEDNOU = 60;        // víc měst za jeden start nedoplňujeme
const PAUZA_MS = 1200;      // slušná pauza mezi dotazy na geokodér
const NEZNAMO = 'xx';

const pockej = (ms) => new Promise((r) => setTimeout(r, ms));

async function doplnZemeMest() {
  const mesta = await prisma.gameArea.findMany({
    where: { country: null }, select: { key: true, name: true }, take: NAJEDNOU,
  });
  if (!mesta.length) return { doplneno: 0, neznamo: 0 };

  let doplneno = 0, neznamo = 0;
  for (const m of mesta) {
    let kod = null;
    try {
      const g = await finder.geocodeArea(m.name || m.key);
      if (g && g.country_code) kod = String(g.country_code).toLowerCase().slice(0, 2);
    } catch (e) { /* geokodér neodpověděl — zkusí se při příštím startu */ }
    if (!/^[a-z]{2}$/.test(kod || '')) { kod = NEZNAMO; neznamo++; } else doplneno++;
    await prisma.gameArea.update({ where: { key: m.key }, data: { country: kod } }).catch(() => {});
    await pockej(PAUZA_MS);
  }
  console.log('[game] země měst: doplněno ' + doplneno + ', nezjištěno ' + neznamo);
  return { doplneno, neznamo };
}

module.exports = { doplnZemeMest, NEZNAMO };
