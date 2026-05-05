// HolyOS — One-shot: vloží TSC TE210 do tabulky printers (přes node-postgres)
// Použití: node scripts/add-printer-te210-pg.js
// Pozn.: IP je lokální (192.168.1.122). Po nastavení port-forwardu na routeru
// uprav ip_address/port přes UI Tiskárny → ⚙ Upravit.

require('dotenv').config();
const { Client } = require('pg');

const NAME = 'TSC TE210 štítek';

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL v .env chybí');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const exists = await client.query('SELECT * FROM printers WHERE name = $1', [NAME]);
    if (exists.rows.length) {
      console.log('UŽ EXISTUJE id=' + exists.rows[0].id);
      console.log(JSON.stringify(exists.rows[0], null, 2));
      return;
    }

    const insert = await client.query(
      `INSERT INTO printers
       (name, model, connection_type, ip_address, port, language,
        label_width_mm, label_height_mm, dpi, priority, is_active, encoding,
        created_at, updated_at)
       VALUES ($1, $2, $3, $4::inet, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        NAME,
        'TSC_TC200',
        'lan',
        '192.168.1.122',
        9100,
        'ZPL',
        60,
        20,
        203,
        50,
        true,
        'UTF-8',
      ]
    );
    console.log('VLOŽENO id=' + insert.rows[0].id);
    console.log(JSON.stringify(insert.rows[0], null, 2));
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('CHYBA:', e.message); process.exit(1); });
