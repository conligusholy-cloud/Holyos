// HolyOS — Fio CSV parser (bankovní výpis)
// =============================================================================
// Parsuje CSV výpisy z Fio internetbankingu / Fio API. Formát má dva bloky:
//   1) Hlavičkový blok — řádky typu `"klíč";"hodnota"` (číslo účtu, IBAN,
//      období, počáteční/konečný zůstatek)
//   2) Tabulka transakcí — začíná hlavičkou `"ID operace";"Datum";"Objem";...`
//      následovanou datovými řádky
//
// Encoding: typicky Windows-1250. Pro robustnost čteme jako UTF-8 a fallback
// na latin1 — diakritika v counterparty_name se může zkomolit, ale ostatní
// pole (čísla, datumy) jsou ASCII.
//
// Decimální čárka, datum DD.MM.YYYY. Záporná částka = odchozí, kladná = příchozí.
// =============================================================================

'use strict';

// ─── HELPERY ────────────────────────────────────────────────────────────────

/** Mini-CSV parser: řádek "a";"b;c";"d" → ['a', 'b;c', 'd'] */
function parseCsvLine(line, delim = ';') {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

/** "1 500,00" / "-1500,00" / "1500.00" → number */
function parseCzAmount(s) {
  if (s === null || s === undefined || s === '') return 0;
  const cleaned = String(s).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** "15.04.2026" / "15.04.26" → Date (UTC midnight) | null */
function parseCzDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);
  if (yy < 100) yy = yy < 70 ? 2000 + yy : 1900 + yy;
  if (!dd || !mm || mm > 12 || dd > 31) return null;
  return new Date(Date.UTC(yy, mm - 1, dd));
}

/** Najde index sloupce podle názvu (case-insensitive, fuzzy). */
function findColumn(headers, candidates) {
  for (const cand of candidates) {
    const idx = headers.findIndex(h =>
      h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        === cand.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Rozdělí číslo účtu "1234567890" + bankovní kód "0300" na "1234567890/0300". */
function fmtAccount(accountNum, bankCode) {
  if (!accountNum) return null;
  if (!bankCode) return accountNum;
  return `${accountNum}/${bankCode}`;
}

// ─── HLAVNÍ PARSER ──────────────────────────────────────────────────────────

/**
 * Parse Fio CSV bankovní výpis.
 *
 * @param {Buffer|string} input
 * @returns {Object} { statement, transactions, warnings, format: 'fio_csv' }
 */
function parseFioCsv(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);

  // Sanity check — pokud UTF-8 dekód obsahuje moc replacement chars, zkus latin1
  const replacementCount = (text.match(/�/g) || []).length;
  let workingText = text;
  if (replacementCount > 5 && Buffer.isBuffer(input)) {
    workingText = input.toString('latin1');
  }

  const lines = workingText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const warnings = [];
  const headerData = {};
  let columnHeaders = null;
  const transactions = [];

  // Stavový automat: hlavička → hledáme řádek s "ID operace" → tabulka
  let inHeaderBlock = true;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) {
      if (inHeaderBlock && Object.keys(headerData).length > 0) {
        // Prázdný řádek po hlavičkovém bloku — předzvěst tabulky
        continue;
      }
      continue;
    }

    const cells = parseCsvLine(raw);

    if (inHeaderBlock) {
      // Hlavičkový blok: 2-buňkový řádek "klíč";"hodnota"
      if (cells.length === 2 && !cells[0].toLowerCase().includes('id operace')) {
        headerData[cells[0].trim()] = cells[1].trim();
        continue;
      }
      // Detekce řádku s názvy sloupců
      if (cells.some(c => c.toLowerCase().includes('id operace')
        || c.toLowerCase().includes('id pohybu')
        || c.toLowerCase() === 'datum')) {
        columnHeaders = cells.map(c => c.trim());
        inHeaderBlock = false;
        continue;
      }
      // Pokud nemá 2 buňky a nevypadá jako header tabulky, nech to padnout dolů
      // — některé exporty hlavičkový blok vůbec nemají
      if (cells.length > 5) {
        // pravděpodobně hned data; zkus to interpretovat jako headers
        columnHeaders = cells.map(c => c.trim());
        inHeaderBlock = false;
        continue;
      }
    } else {
      if (!columnHeaders) {
        warnings.push(`Řádek ${i + 1}: data před headers, přeskakuji`);
        continue;
      }
      if (cells.length < 3) continue; // krátký = ignorujeme

      const tx = parseFioRow(cells, columnHeaders, warnings, i + 1);
      if (tx) transactions.push(tx);
    }
  }

  if (Object.keys(headerData).length === 0 && transactions.length === 0) {
    throw new Error('Fio CSV: nelze rozpoznat formát (žádná hlavička ani transakce)');
  }

  // Sestavení statement metadata
  const accountFull = headerData['Číslo účtu'] || headerData['Cislo uctu'] || '';
  const accountParts = accountFull.split('/');
  const periodFrom = parseCzDate(
    headerData['Datum začátku období'] ||
    headerData['Datum zacatku obdobi'] ||
    headerData['dateStart']
  );
  const periodTo = parseCzDate(
    headerData['Datum konce období'] ||
    headerData['Datum konce obdobi'] ||
    headerData['dateEnd']
  );
  const opening = parseCzAmount(
    headerData['Počáteční zůstatek'] ||
    headerData['Pocatecni zustatek'] ||
    headerData['openingBalance']
  );
  const closing = parseCzAmount(
    headerData['Konečný zůstatek'] ||
    headerData['Konecny zustatek'] ||
    headerData['closingBalance']
  );

  // Statement number — Fio API obvykle vrací "yearList/idList" v hlavičce, jinak fallback
  const statementNumber = headerData['Pořadové číslo výpisu'] ||
    headerData['statementId'] ||
    `FIO-${(periodFrom || new Date()).toISOString().slice(0, 7).replace('-', '')}`;

  // Pokud nemáme period z hlavičky, odvodit z transakcí
  let pf = periodFrom;
  let pt = periodTo;
  if ((!pf || !pt) && transactions.length > 0) {
    const dates = transactions.map(t => t.transaction_date.getTime());
    pf = pf || new Date(Math.min(...dates));
    pt = pt || new Date(Math.max(...dates));
  }

  const statement = {
    statement_number: String(statementNumber),
    account_number: accountParts[0] || null,
    bank_code: accountParts[1] || null,
    period_from: pf,
    period_to: pt,
    opening_balance: opening,
    closing_balance: closing,
    debit_turnover: null,
    credit_turnover: null,
    iban: headerData['IBAN'] || null,
    bic: headerData['BIC'] || null,
    currency: headerData['Měna'] || headerData['Mena'] || 'CZK',
    raw_header: headerData,
  };

  return { statement, transactions, warnings, format: 'fio_csv' };
}

function parseFioRow(cells, headers, warnings, lineNo) {
  const colId = findColumn(headers, ['ID operace', 'ID pohybu', 'ID']);
  const colDate = findColumn(headers, ['Datum', 'Datum operace']);
  const colAmount = findColumn(headers, ['Objem', 'Castka', 'Částka', 'Amount']);
  const colCurrency = findColumn(headers, ['Měna', 'Mena', 'Currency']);
  const colCpAccount = findColumn(headers, ['Protiúčet', 'Protiucet', 'Counterparty']);
  const colCpName = findColumn(headers, ['Název protiúčtu', 'Nazev protiuctu', 'Counterparty Name']);
  const colCpBank = findColumn(headers, ['Kód banky', 'Kod banky', 'Bank code']);
  const colVs = findColumn(headers, ['VS', 'Variabilní symbol', 'Variabilni symbol']);
  const colKs = findColumn(headers, ['KS', 'Konstantní symbol', 'Konstantni symbol']);
  const colSs = findColumn(headers, ['SS', 'Specifický symbol', 'Specificky symbol']);
  const colMessage = findColumn(headers, ['Zpráva pro příjemce', 'Zprava pro prijemce', 'Message']);
  const colType = findColumn(headers, ['Typ', 'Type']);
  const colNote = findColumn(headers, ['Komentář', 'Komentar', 'Note']);

  if (colDate < 0 || colAmount < 0) {
    warnings.push(`Řádek ${lineNo}: chybí povinné sloupce datum/objem`);
    return null;
  }

  const amount = parseCzAmount(cells[colAmount]);
  if (amount === 0) return null;

  const reference = colId >= 0 ? (cells[colId] || '').trim() : null;
  const txDate = parseCzDate(cells[colDate]);
  if (!txDate) {
    warnings.push(`Řádek ${lineNo}: neplatné datum "${cells[colDate]}"`);
    return null;
  }

  const direction = amount < 0 ? 'out' : 'in';
  const cpAccount = colCpAccount >= 0 ? (cells[colCpAccount] || '').trim() : '';
  const cpBank = colCpBank >= 0 ? (cells[colCpBank] || '').trim() : '';

  return {
    transaction_date: txDate,
    value_date: null,
    direction,
    amount: Math.abs(amount),
    currency: colCurrency >= 0 ? (cells[colCurrency] || 'CZK').trim() : 'CZK',
    counterparty_account: cpAccount || null,
    counterparty_bank_code: cpBank || null,
    counterparty_account_full: fmtAccount(cpAccount, cpBank),
    counterparty_name: colCpName >= 0 ? (cells[colCpName] || '').trim() || null : null,
    variable_symbol: colVs >= 0 ? (cells[colVs] || '').trim() || null : null,
    constant_symbol: colKs >= 0 ? (cells[colKs] || '').trim() || null : null,
    specific_symbol: colSs >= 0 ? (cells[colSs] || '').trim() || null : null,
    message: colMessage >= 0 ? (cells[colMessage] || '').trim() || null : null,
    reference: reference || null,
    is_reversal: false,
    payment_type: colType >= 0 ? (cells[colType] || '').trim() || null : null,
    note: colNote >= 0 ? (cells[colNote] || '').trim() || null : null,
  };
}

module.exports = {
  parseFioCsv,
  // Exporty pro testy
  parseCsvLine,
  parseCzAmount,
  parseCzDate,
};
