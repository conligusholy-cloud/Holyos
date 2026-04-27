#!/usr/bin/env node
// HolyOS — testy pro auto-matcher (čistá logika, bez DB)
// Spuštění: node scripts/test-auto-matcher.js
// =============================================================================

'use strict';

const { findMatchCandidates, normalizeVs } = require('../services/banking/auto-matcher');

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`${msg}\n   expected: ${e}\n   actual:   ${a}`);
    console.error(`  ✗ ${msg}\n   expected: ${e}\n   actual:   ${a}`);
  }
}

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error('  ✗', msg);
  }
}

// ─── Mock Prisma ─────────────────────────────────────────────────────────

function mockPrisma(invoices) {
  return {
    invoice: {
      async findMany(args) {
        // Simulujeme filter where { direction, variable_symbol: { not: null }, status: { notIn: [...] } }
        return invoices.filter(inv => {
          if (args?.where?.direction && inv.direction !== args.where.direction) return false;
          if (args?.where?.variable_symbol && !inv.variable_symbol) return false;
          if (args?.where?.status?.notIn?.includes(inv.status)) return false;
          return true;
        });
      },
    },
  };
}

const baseInvoice = (overrides) => ({
  id: 1,
  invoice_number: 'FP-2026-00001',
  external_number: null,
  direction: 'ap',
  status: 'ready_to_pay',
  total: 1000,
  paid_amount: 0,
  variable_symbol: '12345',
  date_due: new Date('2026-04-15'),
  company: { id: 1, name: 'Test s.r.o.', ico: '12345678' },
  ...overrides,
});

const baseTx = (overrides) => ({
  id: 100,
  direction: 'out',
  amount: 1000,
  variable_symbol: '12345',
  transaction_date: new Date('2026-04-09'),
  ...overrides,
});

// ─── normalizeVs ─────────────────────────────────────────────────────────

console.log('\n=== normalizeVs ===');
eq(normalizeVs('12345'), '12345', 'plain VS');
eq(normalizeVs('00012345'), '12345', 'leading zeros stripped');
eq(normalizeVs(null), '', 'null → empty');
eq(normalizeVs(''), '', 'empty → empty');
eq(normalizeVs('VS-12345'), '12345', 'non-digits stripped');
eq(normalizeVs('  12345  '), '12345', 'whitespace stripped');

// ─── findMatchCandidates ─────────────────────────────────────────────────

async function testCases() {
  console.log('\n=== findMatchCandidates: bez VS ===');
  const noVs = await findMatchCandidates(baseTx({ variable_symbol: null }), mockPrisma([]));
  eq(noVs.decision, 'no_match', 'bez VS → no_match');

  console.log('\n=== findMatchCandidates: žádné faktury ===');
  const noInvoices = await findMatchCandidates(baseTx(), mockPrisma([]));
  eq(noInvoices.decision, 'no_match', 'prázdná DB → no_match');

  console.log('\n=== findMatchCandidates: 1 kandidát přesně sedí ===');
  const exactMatch = await findMatchCandidates(
    baseTx({ amount: 1000 }),
    mockPrisma([baseInvoice({ total: 1000, paid_amount: 0 })])
  );
  eq(exactMatch.decision, 'auto_match', '1 přesný kandidát → auto_match');
  eq(exactMatch.candidates.length, 1, 'auto_match má 1 kandidáta');

  console.log('\n=== findMatchCandidates: částečná platba bez allow_partial ===');
  const partial = await findMatchCandidates(
    baseTx({ amount: 500 }),
    mockPrisma([baseInvoice({ total: 1000 })])
  );
  eq(partial.decision, 'needs_review', 'částka < remaining → needs_review');
  eq(partial.candidates.length, 1, 'kandidát existuje, ale potřebuje review');

  console.log('\n=== findMatchCandidates: částečná platba s allow_partial ===');
  const partialAllowed = await findMatchCandidates(
    baseTx({ amount: 500 }),
    mockPrisma([baseInvoice({ total: 1000 })]),
    { allow_partial: true }
  );
  eq(partialAllowed.decision, 'auto_match', 'allow_partial → auto_match');

  console.log('\n=== findMatchCandidates: 2 kandidáti se stejným VS ===');
  const twoCandidates = await findMatchCandidates(
    baseTx({ amount: 1000 }),
    mockPrisma([
      baseInvoice({ id: 1, invoice_number: 'FP-1', total: 1000 }),
      baseInvoice({ id: 2, invoice_number: 'FP-2', total: 1000 }),
    ])
  );
  eq(twoCandidates.decision, 'needs_review', '2 kandidáti se stejnou částkou → needs_review');
  eq(twoCandidates.candidates.length, 2, '2 kandidáti vráceni');

  console.log('\n=== findMatchCandidates: paid invoice excluded ===');
  const paidExcluded = await findMatchCandidates(
    baseTx(),
    mockPrisma([baseInvoice({ status: 'paid' })])
  );
  eq(paidExcluded.decision, 'no_match', 'paid invoice nenalezena');

  console.log('\n=== findMatchCandidates: cancelled excluded ===');
  const cancelledExcluded = await findMatchCandidates(
    baseTx(),
    mockPrisma([baseInvoice({ status: 'cancelled' })])
  );
  eq(cancelledExcluded.decision, 'no_match', 'cancelled vyloučen');

  console.log('\n=== findMatchCandidates: direction mismatch (in tx, ap invoice) ===');
  const dirMismatch = await findMatchCandidates(
    baseTx({ direction: 'in' }),
    mockPrisma([baseInvoice({ direction: 'ap' })])
  );
  eq(dirMismatch.decision, 'no_match', 'in tx + ap invoice = no match');

  console.log('\n=== findMatchCandidates: AR invoice + in tx ===');
  const arMatch = await findMatchCandidates(
    baseTx({ direction: 'in' }),
    mockPrisma([baseInvoice({ direction: 'ar', status: 'sent' })])
  );
  eq(arMatch.decision, 'auto_match', 'AR + in tx = match');

  console.log('\n=== findMatchCandidates: VS s leading zeros ===');
  const lzMatch = await findMatchCandidates(
    baseTx({ variable_symbol: '0012345' }),
    mockPrisma([baseInvoice({ variable_symbol: '12345' })])
  );
  eq(lzMatch.decision, 'auto_match', 'normalize VS — leading zeros sjednoceny');

  console.log('\n=== findMatchCandidates: amount tolerance ===');
  const tolerance = await findMatchCandidates(
    baseTx({ amount: 1000.005 }),
    mockPrisma([baseInvoice({ total: 1000 })]),
    { amount_tolerance: 0.01 }
  );
  eq(tolerance.decision, 'auto_match', 'částka v toleranci → auto_match');

  console.log('\n=== findMatchCandidates: tx amount > remaining ===');
  const tooMuch = await findMatchCandidates(
    baseTx({ amount: 1500 }),
    mockPrisma([baseInvoice({ total: 1000 })])
  );
  eq(tooMuch.decision, 'needs_review', 'nepasující částka → needs_review');

  console.log('\n=== findMatchCandidates: částečně zaplacená faktura ===');
  const partlyPaid = await findMatchCandidates(
    baseTx({ amount: 300 }),
    mockPrisma([baseInvoice({ total: 1000, paid_amount: 700 })])
  );
  eq(partlyPaid.decision, 'auto_match', '700+300 = total → auto_match (doplatek)');
}

// ─── MAIN ────────────────────────────────────────────────────────────────

(async () => {
  console.log('=========================================================');
  console.log('   HolyOS — Auto-matcher test suite');
  console.log('=========================================================');

  await testCases();

  console.log('\n=========================================================');
  console.log(`  Výsledek: ${passed} passed, ${failed} failed`);
  console.log('=========================================================');

  if (failed > 0) {
    console.error('\nFailures:');
    failures.forEach(f => console.error('  -', f));
    process.exit(1);
  }
  process.exit(0);
})();
