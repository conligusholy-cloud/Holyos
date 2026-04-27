#!/usr/bin/env node
// HolyOS — test scriptu pro statement parsery (GPC / Fio CSV / MT940)
// =============================================================================
// Spuštění: node scripts/test-statement-parsers.js
// =============================================================================

'use strict';

const path = require('path');
const fs = require('fs');

const {
  parseStatement,
  detectFormat,
  parseGpc,
  parseFioCsv,
  parseMt940,
} = require('../services/banking/parsers');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error('  ✗', msg);
  }
}

function eq(actual, expected, msg) {
  const actStr = JSON.stringify(actual);
  const expStr = JSON.stringify(expected);
  if (actStr === expStr) {
    passed++;
  } else {
    failed++;
    failures.push(`${msg}\n      expected: ${expStr}\n      actual:   ${actStr}`);
    console.error(`  ✗ ${msg}\n      expected: ${expStr}\n      actual:   ${actStr}`);
  }
}

function approx(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    failures.push(`${msg} (got ${actual}, expected ~${expected})`);
    console.error(`  ✗ ${msg} (got ${actual}, expected ~${expected})`);
  }
}

// ─── FIXTURE: GPC ───────────────────────────────────────────────────────────

function buildGpcLine(fields) {
  // Sestaví řádek 128 znaků z {start, end, value} polí
  const buf = ' '.repeat(128).split('');
  for (const { start, end, value } of fields) {
    const padded = String(value).padEnd(end - start + 1, ' ').slice(0, end - start + 1);
    for (let i = 0; i < padded.length; i++) {
      buf[start - 1 + i] = padded[i];
    }
  }
  return buf.join('');
}

function makeGpcFixture() {
  // Hlavička 074: účet 2501234567 (no prefix), výpis č. 5, datum sestavení 26.4.2026
  // Otev. zůstatek 15000,00 Kč (signed: 14 cifer + '+' = pos 46-60)
  // Konečný 13500,50 Kč
  // Obrat MD 1500,00 (12 znaků na pos 76-87)
  // Obrat DAL 0,50 (14 znaků na pos 88-101)
  const header = buildGpcLine([
    { start: 1, end: 3, value: '074' },
    { start: 4, end: 19, value: '0000002501234567' },
    { start: 20, end: 39, value: 'BEST SERIES SRO' },
    { start: 40, end: 45, value: '010426' },                // datum staré bilance
    { start: 46, end: 59, value: '00000001500000' },        // stará bilance (14 cifer)
    { start: 60, end: 60, value: '+' },                     // znaménko
    { start: 61, end: 74, value: '00000001350050' },        // nová bilance (14 cifer)
    { start: 75, end: 75, value: '+' },                     // znaménko
    { start: 76, end: 87, value: '000000150000' },          // obrat MD (12)
    { start: 88, end: 101, value: '00000000000050' },       // obrat DAL (14)
    { start: 102, end: 104, value: '000' },                 // rezerva (Fio = "000")
    { start: 105, end: 107, value: '005' },                 // pořadové č. výpisu = 5
    { start: 108, end: 113, value: '260426' },              // datum sestavení
  ]);

  // Transakce 075 #1: Výdaj 1500 Kč na 1234567890, VS 260128581, KS 308
  const tx1 = buildGpcLine([
    { start: 1, end: 3, value: '075' },
    { start: 4, end: 19, value: '0000002501234567' },
    { start: 20, end: 35, value: '0000001234567890' },
    { start: 36, end: 36, value: 'X' },                     // flag
    { start: 37, end: 49, value: 'REF0000000001' },         // bank reference (13)
    { start: 50, end: 61, value: '000000150000' },          // částka 1500.00 v haléřích
    { start: 62, end: 62, value: '1' },                     // typ MD/výdaj
    { start: 63, end: 72, value: '0260128581' },            // VS
    { start: 73, end: 76, value: '0308' },                  // KS
    { start: 77, end: 86, value: '0000000000' },            // SS
    { start: 92, end: 97, value: '150426' },                // datum splatnosti
    { start: 98, end: 117, value: 'PLATBA TESCO' },         // zpráva
    { start: 118, end: 122, value: '00203' },               // měna CZK
    { start: 123, end: 128, value: '150426' },              // datum účtování
  ]);

  // Transakce 075 #2: Příchozí 0,50 Kč (bankovní úrok)
  const tx2 = buildGpcLine([
    { start: 1, end: 3, value: '075' },
    { start: 4, end: 19, value: '0000002501234567' },
    { start: 20, end: 35, value: '0000000000000000' },
    { start: 36, end: 36, value: 'I' },
    { start: 37, end: 49, value: 'REF0000000002' },
    { start: 50, end: 61, value: '000000000050' },          // 0.50 Kč
    { start: 62, end: 62, value: '2' },                     // typ DAL/příjem
    { start: 63, end: 72, value: '0000000000' },
    { start: 73, end: 76, value: '0000' },
    { start: 77, end: 86, value: '0000000000' },
    { start: 92, end: 97, value: '300426' },
    { start: 98, end: 117, value: 'UROK Q1 2026' },
    { start: 118, end: 122, value: '00203' },
    { start: 123, end: 128, value: '300426' },
  ]);

  return [header, tx1, tx2].join('\r\n') + '\r\n';
}

function testGpc() {
  console.log('\n=== GPC parser ===');
  const content = makeGpcFixture();

  const result = parseGpc(content);
  assert(result.format === 'gpc', 'format = gpc');
  assert(result.warnings.length === 0,
    `žádné warnings (got: ${result.warnings.join('; ')})`);

  const s = result.statement;
  eq(s.account_number, '2501234567', 'statement.account_number');
  eq(s.statement_number, '005', 'statement.statement_number');
  approx(s.opening_balance, 15000, 0.01, 'statement.opening_balance');
  approx(s.closing_balance, 13500.50, 0.01, 'statement.closing_balance');
  approx(s.debit_turnover, 1500, 0.01, 'statement.debit_turnover');
  approx(s.credit_turnover, 0.50, 0.01, 'statement.credit_turnover');

  eq(result.transactions.length, 2, '2 transakce');

  const t1 = result.transactions[0];
  eq(t1.direction, 'out', 'tx1.direction = out');
  approx(t1.amount, 1500, 0.01, 'tx1.amount');
  eq(t1.counterparty_account, '1234567890', 'tx1.counterparty_account');
  eq(t1.counterparty_bank_code, null, 'tx1.counterparty_bank_code (GPC neobsahuje)');
  eq(t1.variable_symbol, '260128581', 'tx1.variable_symbol');
  eq(t1.constant_symbol, '308', 'tx1.constant_symbol');
  eq(t1.message, 'PLATBA TESCO', 'tx1.message');
  eq(t1.reference, 'XREF0000000001', 'tx1.reference (flag + bankref)');
  eq(t1.is_reversal, false, 'tx1.is_reversal');
  eq(t1.currency, 'CZK', 'tx1.currency (z ISO 00203)');

  const t2 = result.transactions[1];
  eq(t2.direction, 'in', 'tx2.direction = in');
  approx(t2.amount, 0.50, 0.01, 'tx2.amount');
}

// ─── FIXTURE: Fio CSV ───────────────────────────────────────────────────────

function makeFioCsvFixture() {
  return [
    '"Číslo účtu";"2501234567/2010"',
    '"Měna";"CZK"',
    '"IBAN";"CZ65 2010 0000 0025 0123 4567"',
    '"BIC";"FIOBCZPP"',
    '"Datum začátku období";"01.04.2026"',
    '"Datum konce období";"30.04.2026"',
    '"Počáteční zůstatek";"15000,00"',
    '"Konečný zůstatek";"13500,50"',
    '"Pořadové číslo výpisu";"5"',
    '',
    '"ID operace";"Datum";"Objem";"Měna";"Protiúčet";"Název protiúčtu";"Kód banky";"Název banky";"KS";"VS";"SS";"Uživatelská identifikace";"Zpráva pro příjemce";"Typ";"Provedl";"Upřesnění";"Komentář";"BIC";"ID pokynu"',
    '"12345678";"15.04.2026";"-1500,00";"CZK";"1234567890";"Tesco Stores";"0300";"ČSOB";"308";"260128581";"";"";"PLATBA TESCO";"Bezhotovostní platba";"";"";"";"";"OP-1234"',
    '"12345679";"30.04.2026";"0,50";"CZK";"";"";"2010";"Fio";"";"";"";"";"UROK Q1 2026";"Připsaný úrok";"";"";"";"";""',
  ].join('\r\n');
}

function testFioCsv() {
  console.log('\n=== Fio CSV parser ===');
  const content = makeFioCsvFixture();

  const result = parseFioCsv(content);
  assert(result.format === 'fio_csv', 'format = fio_csv');

  const s = result.statement;
  eq(s.account_number, '2501234567', 'statement.account_number');
  eq(s.bank_code, '2010', 'statement.bank_code');
  eq(s.statement_number, '5', 'statement.statement_number');
  approx(s.opening_balance, 15000, 0.01, 'statement.opening_balance');
  approx(s.closing_balance, 13500.50, 0.01, 'statement.closing_balance');
  eq(s.iban, 'CZ65 2010 0000 0025 0123 4567', 'statement.iban');
  eq(s.bic, 'FIOBCZPP', 'statement.bic');

  eq(result.transactions.length, 2, '2 transakce');

  const t1 = result.transactions[0];
  eq(t1.direction, 'out', 'tx1.direction = out (záporné objem)');
  approx(t1.amount, 1500, 0.01, 'tx1.amount (absolutní)');
  eq(t1.counterparty_account, '1234567890', 'tx1.counterparty_account');
  eq(t1.counterparty_bank_code, '0300', 'tx1.counterparty_bank_code');
  eq(t1.counterparty_name, 'Tesco Stores', 'tx1.counterparty_name');
  eq(t1.variable_symbol, '260128581', 'tx1.variable_symbol');
  eq(t1.constant_symbol, '308', 'tx1.constant_symbol');
  eq(t1.message, 'PLATBA TESCO', 'tx1.message');
  eq(t1.reference, '12345678', 'tx1.reference');

  const t2 = result.transactions[1];
  eq(t2.direction, 'in', 'tx2.direction = in (kladné)');
  approx(t2.amount, 0.50, 0.01, 'tx2.amount');
  eq(t2.message, 'UROK Q1 2026', 'tx2.message');
}

// ─── FIXTURE: MT940 ─────────────────────────────────────────────────────────

function makeMt940Fixture() {
  return [
    ':20:STMT-2026-04',
    ':25:CZ6520100000002501234567',
    ':28C:5/00001',
    ':60F:C260401CZK15000,00',
    ':61:2604150415D1500,00NTRFREF000000001//OP-1234',
    ':86:?00Bezhotovostni platba?20PLATBA TESCO?30CSOB?311234567890?32Tesco Stores?60VS:260128581 KS:308',
    ':61:2604300430C0,50NMSCREF000000002//',
    ':86:?00Pripsany urok?20UROK Q1 2026',
    ':62F:C260430CZK13500,50',
    '-',
  ].join('\r\n');
}

function testMt940() {
  console.log('\n=== MT940 parser ===');
  const content = makeMt940Fixture();

  const result = parseMt940(content);
  assert(result.format === 'mt940', 'format = mt940');

  const s = result.statement;
  eq(s.iban, 'CZ6520100000002501234567', 'statement.iban');
  eq(s.account_number, '2501234567', 'statement.account_number (z IBAN)');
  eq(s.bank_code, '2010', 'statement.bank_code (z IBAN)');
  eq(s.statement_number, '5/00001', 'statement.statement_number');
  approx(s.opening_balance, 15000, 0.01, 'statement.opening_balance');
  approx(s.closing_balance, 13500.50, 0.01, 'statement.closing_balance');
  eq(s.currency, 'CZK', 'statement.currency');

  eq(result.transactions.length, 2, '2 transakce');

  const t1 = result.transactions[0];
  eq(t1.direction, 'out', 'tx1.direction = out (D)');
  approx(t1.amount, 1500, 0.01, 'tx1.amount');
  eq(t1.counterparty_account, '1234567890', 'tx1.counterparty_account');
  eq(t1.counterparty_name, 'Tesco Stores', 'tx1.counterparty_name');
  eq(t1.variable_symbol, '260128581', 'tx1.variable_symbol');
  eq(t1.constant_symbol, '308', 'tx1.constant_symbol');
  eq(t1.message, 'PLATBA TESCO', 'tx1.message');
  eq(t1.reference, 'OP-1234', 'tx1.reference (bank reference)');
  eq(t1.is_reversal, false, 'tx1.is_reversal = false');

  const t2 = result.transactions[1];
  eq(t2.direction, 'in', 'tx2.direction = in (C)');
  approx(t2.amount, 0.50, 0.01, 'tx2.amount');
  eq(t2.message, 'UROK Q1 2026', 'tx2.message');
}

// ─── DETECT FORMAT ──────────────────────────────────────────────────────────

function testDetect() {
  console.log('\n=== auto-detect ===');
  eq(detectFormat(makeGpcFixture()), 'gpc', 'GPC content → gpc');
  eq(detectFormat(makeFioCsvFixture()), 'fio_csv', 'Fio CSV content → fio_csv');
  eq(detectFormat(makeMt940Fixture()), 'mt940', 'MT940 content → mt940');
  eq(detectFormat('garbage', 'foo.gpc'), 'gpc', 'extension fallback gpc');
  eq(detectFormat('garbage', 'foo.csv'), 'fio_csv', 'extension fallback csv');
  eq(detectFormat('garbage', 'foo.sta'), 'mt940', 'extension fallback sta');
  eq(detectFormat('totally unknown content'), 'unknown', 'unknown content');
}

// ─── ENTRY POINT (parseStatement) ───────────────────────────────────────────

function testEntryPoint() {
  console.log('\n=== parseStatement (entry) ===');
  const r1 = parseStatement(makeGpcFixture(), { filename: 'vypis.gpc' });
  eq(r1.format, 'gpc', 'entry: gpc');
  eq(r1.transactions.length, 2, 'entry gpc: 2 tx');

  const r2 = parseStatement(makeFioCsvFixture(), { filename: 'vypis.csv' });
  eq(r2.format, 'fio_csv', 'entry: fio_csv');
  eq(r2.transactions.length, 2, 'entry fio: 2 tx');

  const r3 = parseStatement(makeMt940Fixture(), { filename: 'vypis.sta' });
  eq(r3.format, 'mt940', 'entry: mt940');
  eq(r3.transactions.length, 2, 'entry mt940: 2 tx');

  // Vynucený formát i přes blbě jméno
  const r4 = parseStatement(makeGpcFixture(), { format: 'gpc', filename: 'random.bin' });
  eq(r4.format, 'gpc', 'entry: vynucený gpc');

  // Unknown format → throw
  let threw = false;
  try {
    parseStatement('totally unknown content');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'unknown content → throw');
}

// ─── EDGE CASES ─────────────────────────────────────────────────────────────

function testEdgeCases() {
  console.log('\n=== edge cases ===');

  // GPC: prázdný soubor
  let threw = false;
  try { parseGpc(''); } catch (e) { threw = true; }
  assert(threw, 'GPC prázdný → throw');

  // GPC: jen hlavička bez transakcí
  const headerOnly = buildGpcLine([
    { start: 1, end: 3, value: '074' },
    { start: 4, end: 19, value: '0000002501234567' },
    { start: 20, end: 39, value: 'BEST SERIES' },
    { start: 40, end: 45, value: '010426' },
    { start: 46, end: 59, value: '00000001500000' },
    { start: 60, end: 60, value: '+' },
    { start: 61, end: 74, value: '00000001500000' },
    { start: 75, end: 75, value: '+' },
    { start: 105, end: 107, value: '005' },
    { start: 108, end: 113, value: '260426' },
  ]);
  const r = parseGpc(headerOnly + '\r\n');
  eq(r.transactions.length, 0, 'GPC jen hlavička: 0 tx');
  approx(r.statement.opening_balance, 15000, 0.01, 'GPC jen hlavička: balance');

  // GPC: storno (typ 5 = storno DAL)
  const reversal = buildGpcLine([
    { start: 1, end: 3, value: '074' },
    { start: 4, end: 19, value: '0000002501234567' },
    { start: 20, end: 39, value: 'TEST' },
    { start: 40, end: 45, value: '010426' },
    { start: 46, end: 59, value: '00000000000000' },
    { start: 60, end: 60, value: '+' },
    { start: 61, end: 74, value: '00000000000000' },
    { start: 75, end: 75, value: '+' },
    { start: 105, end: 107, value: '001' },
    { start: 108, end: 113, value: '260426' },
  ]) + '\r\n' + buildGpcLine([
    { start: 1, end: 3, value: '075' },
    { start: 4, end: 19, value: '0000002501234567' },
    { start: 20, end: 35, value: '0000001234567890' },
    { start: 36, end: 36, value: 'X' },
    { start: 37, end: 49, value: 'REVREF000001' },
    { start: 50, end: 61, value: '000000050000' },
    { start: 62, end: 62, value: '5' },
    { start: 92, end: 97, value: '260426' },
    { start: 118, end: 122, value: '00203' },
    { start: 123, end: 128, value: '260426' },
  ]);
  const rev = parseGpc(reversal + '\r\n');
  eq(rev.transactions[0].is_reversal, true, 'GPC: typ 5 = is_reversal');
  eq(rev.transactions[0].direction, 'out', 'GPC: storno DAL = out');

  // MT940: chybí :25:
  threw = false;
  try {
    parseMt940(':20:TEST\r\n:60F:C260401CZK0,00\r\n-');
  } catch (e) { threw = true; }
  assert(threw, 'MT940 bez :25: → throw');
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

console.log('=========================================================');
console.log('   HolyOS — Bank statement parsers test suite');
console.log('=========================================================');

testGpc();
testFioCsv();
testMt940();
testDetect();
testEntryPoint();
testEdgeCases();

console.log('\n=========================================================');
console.log(`  Výsledek: ${passed} passed, ${failed} failed`);
console.log('=========================================================');

if (failed > 0) {
  console.error('\nSelhaly tyto kontroly:');
  failures.forEach(f => console.error('  -', f));
  process.exit(1);
}
process.exit(0);
