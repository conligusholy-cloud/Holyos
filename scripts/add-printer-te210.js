// HolyOS — One-shot: vloží TSC TE210 do tabulky printers
// Použití: node scripts/add-printer-te210.js
// Pozn.: IP je lokální (192.168.1.122). Po nastavení port-forwardu na routeru
// uprav ip_address/port přes UI Tiskárny → ⚙ Upravit, případně rovnou v DB.

// Explicitní načtení .env, aby ho neshazovaly User-level Win env shadow proměnné
require('dotenv').config({ override: true });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const NAME = 'TSC TE210 štítek';
  const dbHost = (process.env.DATABASE_URL || '').match(/@([^:/]+)/)?.[1] || '?';
  console.log('Připojuji se k DB hostu: ' + dbHost);

  // Idempotence: pokud už tiskárna se stejným názvem existuje, jen ji vrátíme.
  const existing = await prisma.printer.findFirst({ where: { name: NAME } });
  if (existing) {
    console.log('UŽ EXISTUJE:', JSON.stringify(existing, null, 2));
    process.exit(0);
  }

  const created = await prisma.printer.create({
    data: {
      name:            NAME,
      model:           'TSC_TC200',     // TE210 patří do stejné rodiny, ZPL emulace funguje stejně
      connection_type: 'lan',
      ip_address:      '192.168.1.122', // lokální — z Railway nedosažitelná, viz poznámka výše
      port:            9100,
      language:        'ZPL',
      label_width_mm:  60,
      label_height_mm: 20,
      dpi:             203,
      priority:        50,
      is_active:       true,
      encoding:        'UTF-8',
    },
  });

  console.log('VLOŽENO:', JSON.stringify(created, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('CHYBA:', e);
  await prisma.$disconnect();
  process.exit(1);
});
