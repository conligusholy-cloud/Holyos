// HolyOS — Bank statement parsers — entry point s auto-detekcí
// =============================================================================
// Unifikované rozhraní pro tři podporované formáty bankovních výpisů:
//   - GPC      (ABO/ČBA standard 1500, fixed-width 128)
//   - Fio CSV  (Fio internetbanking export, ;-delimited)
//   - MT940    (SWIFT mezinárodní)
//
// Výstup je vždy stejná struktura { statement, transactions, warnings, format }
// kterou import endpoint zapíše do BankStatement + BankTransaction modelů.
// =============================================================================

'use strict';

const { parseGpc } = require('./gpc-parser');
const { parseFioCsv } = require('./fio-csv-parser');
const { parseMt940 } = require('./mt940-parser');

/**
 * Detekce formátu z prvních N bytů + extension hintu.
 *
 * @param {Buffer|string} input
 * @param {string} [filename]   pro extension hint
 * @returns {'gpc'|'fio_csv'|'mt940'|'unknown'}
 */
function detectFormat(input, filename = '') {
  const text = Buffer.isBuffer(input)
    ? input.slice(0, 4096).toString('latin1')
    : String(input).slice(0, 4096);

  const ext = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/);
  const extName = ext ? ext[1] : '';

  // MT940 — typicky začíná blokem {1:F01...} nebo přímo :20:
  if (/^\{1:[FAS]/.test(text) || /^:20:/m.test(text.slice(0, 200))) {
    return 'mt940';
  }
  if (extName === 'sta' || extName === 'mt940' || extName === 'swift') {
    return 'mt940';
  }

  // GPC — fixed-width řádky začínající "074" nebo "075"
  if (/^074\d/.test(text) || /^075\d/.test(text)) {
    return 'gpc';
  }
  if (extName === 'gpc' || extName === 'abo') {
    return 'gpc';
  }

  // Fio CSV — typicky začíná `"Číslo účtu";` nebo přímo `"ID operace";`
  // Heuristika: obsahuje ; jako delimiter a alespoň jeden CSV-style řádek
  if (/^"[^"]*";/.test(text) || /^[A-Za-z][^;\n]*;[^;\n]*;/.test(text)) {
    return 'fio_csv';
  }
  if (extName === 'csv') {
    return 'fio_csv';
  }

  return 'unknown';
}

/**
 * Hlavní entry point — auto-detekuje formát a delegated na konkrétní parser.
 *
 * @param {Buffer|string} input
 * @param {Object} [opts]
 * @param {string} [opts.filename]   pro extension hint a uložení do file_path
 * @param {string} [opts.format]     vynutit formát ('gpc' | 'fio_csv' | 'mt940')
 * @returns {Object} { statement, transactions, warnings, format }
 * @throws na nerozpoznaný formát nebo chybu parseru
 */
function parseStatement(input, opts = {}) {
  const format = opts.format || detectFormat(input, opts.filename);

  switch (format) {
    case 'gpc':
      return parseGpc(input);
    case 'fio_csv':
      return parseFioCsv(input);
    case 'mt940':
      return parseMt940(input);
    case 'unknown':
    default:
      throw new Error(
        `Nelze detekovat formát výpisu (filename=${opts.filename || '?'}). ` +
        `Podporované: GPC (.gpc), Fio CSV (.csv), MT940 (.sta/.mt940). ` +
        `Použij opts.format pro explicitní volbu.`
      );
  }
}

module.exports = {
  parseStatement,
  detectFormat,
  // Re-export jednotlivých parserů pro testy a explicit volání
  parseGpc,
  parseFioCsv,
  parseMt940,
};
