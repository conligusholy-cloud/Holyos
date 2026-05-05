// =============================================================================
// HolyOS — Debug: jaké hodnoty má StockMove.quantity?
// Stáhne 200 záznamů a vypíše distribuci znamének per state/parent doc type.
// =============================================================================

require('dotenv').config();
const factorify = require('../services/factorify/client.service');

async function main() {
  console.log('Stahuji 200 StockMove pro analýzu znamének quantity…');
  const rows = await factorify.query('StockMove', { limit: 200 });
  console.log(`OK, mám ${rows.length} sample.\n`);

  let pos = 0, neg = 0, zero = 0;
  const perState = {}; // state → {pos, neg, zero, samples: [{qty, state, docType}]}

  for (const r of rows) {
    const q = Number(r?.quantity || 0);
    const state = r?.state || '?';
    const docType = r?.stockDocument?.type || '?';
    const key = `${state} (doc=${docType})`;

    if (!perState[key]) perState[key] = { pos: 0, neg: 0, zero: 0, samples: [] };
    if (q > 0) { pos++; perState[key].pos++; }
    else if (q < 0) { neg++; perState[key].neg++; }
    else { zero++; perState[key].zero++; }

    if (perState[key].samples.length < 3) {
      perState[key].samples.push({
        qty: q,
        moveId: r?.id,
        material: r?.goods?.code || r?.goods?.name || r?.goods?.id,
        stock: r?.stock?.name || r?.stock?.id,
      });
    }
  }

  console.log('═══════════════════════════════════════════');
  console.log(`  Celkem ${rows.length}:`);
  console.log(`  ➕ pos:  ${pos}`);
  console.log(`  ➖ neg:  ${neg}`);
  console.log(`  0  zero: ${zero}`);
  console.log('═══════════════════════════════════════════\n');

  console.log('Per state + parent document type:\n');
  for (const [k, v] of Object.entries(perState)) {
    console.log(`  ${k.padEnd(50)} pos=${v.pos}  neg=${v.neg}  zero=${v.zero}`);
    for (const s of v.samples) {
      console.log(`     • move=${s.moveId} qty=${s.qty} mat=${s.material} stock=${s.stock}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
