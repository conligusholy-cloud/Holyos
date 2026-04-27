// HolyOS — Standalone test pro services/banking/abo-kpc.js
// Spuštění: node scripts/test-abo-kpc.js
// Nezávislé na DB — testuje čisté funkce.

'use strict';

const path = require('path');
const fs = require('fs');
const {
  generateAboKpc, validateBatchInput,
  parseAccount, formatAccountForAbo, asciify, padLeft, padRight,
  amountInHaler, fmtDateYYMMDD, LINE_WIDTH, LINE_END,
} = require('../services/banking/abo-kpc');

let passed = 0;
let failed = 0;

function ok(label, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + label); }
  else      { failed++; console.error('  ❌ ' + label + (extra ? ' — ' + extra : '')); }
}

console.log('\n═══ Test 1: helper funkce ════════════════════════════════════════');

ok('asciify zahodí diakritiku', asciify('Příjmení Žluťoučký kůň') === 'Prijmeni Zlutoucky kun');
ok('asciify zachová ASCII', asciify('Best Series s.r.o. 123') === 'Best Series s.r.o. 123');
ok('padLeft "5" na 4 = "0005"', padLeft('5', 4) === '0005');
ok('padLeft "12345" na 4 = "2345" (slice)', padLeft('12345', 4) === '2345');
ok('padRight "abc" na 5 = "abc  "', padRight('abc', 5) === 'abc  ');
ok('padRight long string slice', padRight('abcdefgh', 5) === 'abcde');

ok('parseAccount "123-456789/0100"', JSON.stringify(parseAccount('123-456789/0100')) === JSON.stringify({ prefix: '123', base: '456789', bankCode: '0100' }));
ok('parseAccount "2501234567/2010"', JSON.stringify(parseAccount('2501234567/2010')) === JSON.stringify({ prefix: null, base: '2501234567', bankCode: '2010' }));
ok('parseAccount "  123-456789 / 0100 " (whitespace)', JSON.stringify(parseAccount('  123-456789 / 0100 ')) === JSON.stringify({ prefix: '123', base: '456789', bankCode: '0100' }));

let parseFailed = false;
try { parseAccount('blbost'); } catch { parseFailed = true; }
ok('parseAccount vyhodí chybu na neplatný formát', parseFailed);

ok('formatAccountForAbo prefix+base', formatAccountForAbo('123-456789/0100') === '0001230000456789');
ok('formatAccountForAbo bez prefix',  formatAccountForAbo('2501234567/2010') === '0000002501234567');

ok('amountInHaler 1234.56 = 123456', amountInHaler(1234.56) === 123456);
ok('amountInHaler 0.01 = 1',         amountInHaler(0.01) === 1);
ok('amountInHaler "100" string = 10000', amountInHaler('100') === 10000);

let amountFailed = false;
try { amountInHaler(-5); } catch { amountFailed = true; }
ok('amountInHaler vyhodí na záporné',  amountFailed);

console.log('\n═══ Test 2: minimální batch (1 platba) ══════════════════════════');

const batch1 = {
  senderAccount: { account: '2501234567/2010' },
  batchNumber: 'PB-2026-0001',
  creationDate: new Date(2026, 3, 25), // 25. 4. 2026
  dueDate: new Date(2026, 3, 28),
  payments: [
    {
      targetAccount: '1234567890/0300',
      amount: 1234.56,
      variableSymbol: '202604123',
      constantSymbol: '0308',
      message: 'Faktura 2026-001',
    },
  ],
};

const result1 = generateAboKpc(batch1);

ok('Vrací content + buffer', !!result1.content && Buffer.isBuffer(result1.contentBuffer));
ok('lineCount = 3 (UHL + 1 platba + 5 footer)', result1.lineCount === 3);
ok('paymentCount = 1', result1.paymentCount === 1);
ok('totalAmount = 1234.56', result1.totalAmount === 1234.56);
ok('totalHaler = 123456', result1.totalHaler === 123456);

const lines1 = result1.content.split(LINE_END).filter(l => l.length > 0);
ok('Každý řádek má 80 znaků', lines1.every(l => l.length === LINE_WIDTH), 'délky: ' + lines1.map(l => l.length).join(','));
ok('Hlavička začíná UHL1', lines1[0].startsWith('UHL1'));
ok('Hlavička má YYMMDD = 260425', lines1[0].slice(4, 10) === '260425');
ok('Hlavička obsahuje účet odesílatele', lines1[0].slice(10, 26) === '0000002501234567');
ok('Hlavička obsahuje file seq 001', lines1[0].slice(26, 29) === '001');
ok('Hlavička obsahuje batchNumber', lines1[0].includes('PB-2026-0001'));

ok('Řádek 2 začíná typem 1', lines1[1].startsWith('1'));
ok('Řádek 2 obsahuje účet odesílatele', lines1[1].slice(15, 31) === '0000002501234567');
ok('Řádek 2 obsahuje částku 0000000123456 (haléře)', lines1[1].slice(31, 44) === '0000000123456');
ok('Řádek 2 obsahuje účet příjemce', lines1[1].slice(44, 60) === '0000001234567890');
ok('Řádek 2 obsahuje kód banky 0300', lines1[1].slice(60, 64) === '0300');
ok('Řádek 2 obsahuje VS 0202604123', lines1[1].slice(64, 74) === '0202604123');
ok('Řádek 2 obsahuje KS 0308', lines1[1].slice(74, 78) === '0308');

ok('Footer začíná typem 5', lines1[2].startsWith('5'));
ok('Footer obsahuje počet plateb 0000001', lines1[2].slice(1, 8) === '0000001');
ok('Footer obsahuje součet 0000000123456', lines1[2].slice(8, 21) === '0000000123456');

console.log('\n═══ Test 3: více plateb, ověření součtu ════════════════════════');

const batch2 = {
  senderAccount: { account: '2501234567/2010' },
  payments: [
    { targetAccount: '1234567890/0300', amount: 1000.00, variableSymbol: '111' },
    { targetAccount: '987654321/0600',  amount: 500.50,  variableSymbol: '222' },
    { targetAccount: '111-222333/2700', amount: 9876.54, variableSymbol: '333' },
  ],
};
const result2 = generateAboKpc(batch2);

ok('paymentCount = 3', result2.paymentCount === 3);
ok('totalAmount = 11377.04', result2.totalAmount === 11377.04);
ok('totalHaler = 1137704', result2.totalHaler === 1137704);
const lines2 = result2.content.split(LINE_END).filter(l => l.length > 0);
ok('Total řádků = 5 (UHL + 3 platby + 5)', lines2.length === 5);
ok('Footer count = 0000003', lines2[4].slice(1, 8) === '0000003');
ok('Footer total = 0000001137704', lines2[4].slice(8, 21) === '0000001137704');

console.log('\n═══ Test 4: validace negativních cest ═══════════════════════════');

const errs1 = validateBatchInput({ senderAccount: { account: 'blbost' }, payments: [{ targetAccount: '1/0100', amount: 100 }] });
ok('Validace zachytí špatný senderAccount', errs1.some(e => e.includes('Neplatný')));

const errs2 = validateBatchInput({ senderAccount: { account: '123/0100' }, payments: [] });
ok('Validace zachytí prázdné payments', errs2.some(e => e.includes('Žádné platby')));

const errs3 = validateBatchInput({
  senderAccount: { account: '123/0100' },
  payments: [{ targetAccount: '456/0300', amount: 0 }],
});
ok('Validace zachytí 0-amount', errs3.some(e => e.includes('neplatná částka')));

const errs4 = validateBatchInput({
  senderAccount: { account: '123/0100' },
  payments: [{ targetAccount: '456/0300', amount: 100, variableSymbol: 'abc' }],
});
ok('Validace zachytí ne-numerický VS', errs4.some(e => e.includes('VS')));

console.log('\n═══ Test 5: encoding & write souboru ════════════════════════════');

const batch3 = {
  senderAccount: { account: '2501234567/2010' },
  payments: [
    { targetAccount: '1234567890/0300', amount: 100, message: 'Příliš žluťoučký kůň' },
  ],
};
const result3 = generateAboKpc(batch3);
ok('Content je čistě ASCII (po asciify)', /^[\x20-\x7E\r\n]*$/.test(result3.content));

// Zápis testovacího souboru pro ruční ověření
const outDir = path.resolve(__dirname, '..', 'tmp');
try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
const outPath = path.join(outDir, 'test-abo-kpc.kpc');
fs.writeFileSync(outPath, result3.contentBuffer);
console.log('  📁 Test soubor zapsán:', outPath, '(' + result3.contentBuffer.length + ' bytů)');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Výsledky: ✅ ${passed} prošlo, ❌ ${failed} selhalo`);
process.exit(failed === 0 ? 0 : 1);
