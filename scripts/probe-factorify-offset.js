// =============================================================================
// HolyOS — Probe: podporuje Factorify Stage API offset/skip pro paginaci?
// Vyzkouší 6 různých kombinací s limit + offset/skip/page proti malému datasetu.
// =============================================================================

require('dotenv').config();
const factorify = require('../services/factorify/client.service');

const ENTITY = 'PurchaseOrderItem'; // 14347 záznamů — dost velké, ale rychlé

const VARIANTS = [
  { label: 'limit=5 (kontrola)', body: { limit: 5 } },
  { label: 'limit=5, offset=5', body: { limit: 5, offset: 5 } },
  { label: 'limit=5, skip=5', body: { limit: 5, skip: 5 } },
  { label: 'limit=5, page=2', body: { limit: 5, page: 2 } },
  { label: 'limit=5, start=5', body: { limit: 5, start: 5 } },
  { label: 'limit=5, from=5', body: { limit: 5, from: 5 } },
  { label: 'paging.limit=5, paging.offset=5', body: { paging: { limit: 5, offset: 5 } } },
];

async function main() {
  console.log(`\nProbe paginace offset proti ${ENTITY}\n`);
  // Reference: prvních 5 ID
  const ref = await factorify.query(ENTITY, { limit: 5 });
  const refIds = ref.map(r => r.id);
  console.log(`  reference (limit=5):       [${refIds.join(', ')}]\n`);

  for (const v of VARIANTS) {
    process.stdout.write(`  ${v.label.padEnd(36)} `);
    try {
      const rows = await factorify.query(ENTITY, v.body, { timeoutMs: 30_000 });
      const ids = rows.map(r => r.id);
      const sameAsRef = JSON.stringify(ids) === JSON.stringify(refIds);
      const marker = sameAsRef
        ? '◯ ignoruje (vrací prvních 5)'
        : `✅ FUNGUJE — [${ids.join(', ')}]`;
      console.log(`${rows.length} záznamů  ${marker}`);
    } catch (e) {
      console.log(`❌ ${e.message.substring(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\nHotovo.');
}

main().catch(e => { console.error(e); process.exit(1); });
