// HolyOS — MT940 parser (bankovní výpis)
// =============================================================================
// Parsuje SWIFT MT940 výpisy. Používá se hlavně pro mezinárodní transakce
// a podporují ho všechny 4 banky, které HolyOS spravuje. Pro CZ jsou GPC výpisy
// běžnější, ale MT940 je standardní formát pro účtárny a mezinárodní toky.
//
// Tagy (pole oddělená `:tag:` na začátku řádku):
//   :20:   reference výpisu (statement number)
//   :25:   identifikace účtu (IBAN nebo account/bank)
//   :28C:  číslo výpisu / sekvence (např. "001/00001")
//   :60F:  počáteční zůstatek (F=final)
//   :61:   řádek transakce
//   :86:   doplňující info k :61: (jméno protistrany, VS, KS, SS, message)
//   :62F:  konečný zůstatek
//   :64:   konečný disponibilní zůstatek
//
// Kód `:61:`:
//   YYMMDD            value date (6)
//   [MMDD]            entry date — volitelné (4)
//   C|D|RC|RD         credit / debit / reversal credit / reversal debit (1-2)
//   [funds code]      volitelný 1 znak (nepovinné)
//   amount            částka s čárkou (max 15)
//   N + 3 znaky       transaction type (např. NTRF, NMSC, NCHK)
//   reference for AO  reference klienta (až 16, končí "//")
//   // bank reference reference banky (zbytek)
//
// `:86:` český strukturovaný formát (MultiCash standard):
//   ?00 transaction text
//   ?20-?25 unstructured info (zpráva)
//   ?30 BIC/bank code protistrany
//   ?31 account protistrany
//   ?32-?33 jméno protistrany
//   ?60 VS, KS, SS — různé banky používají rozdílně
//
// Banky často neimplementují MT940 striktně podle SWIFT — parser je tolerantní.
// =============================================================================

'use strict';

// ─── HELPERY ────────────────────────────────────────────────────────────────

/** "260415" → Date | null (YYMMDD) */
function parseDateYYMMDD(s) {
  if (!s || !/^\d{6}$/.test(s)) return null;
  const yy = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(2, 4), 10);
  const dd = parseInt(s.slice(4, 6), 10);
  if (!dd || !mm || mm > 12 || dd > 31) return null;
  const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

/** "1500,50" / "1500.50" → number */
function parseMtAmount(s) {
  if (!s) return 0;
  const cleaned = String(s).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Spojí multiline tag obsah do jednoho stringu.
 * MT940 zalamuje řádky, pokračovací řádky nejsou prefixované `:tag:`.
 */
function collectTagBlocks(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = []; // [{ tag, content }]
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Konec zprávy: "-" osamoceně nebo "}" v block-mode
    if (line === '-' || line === '}') break;
    // SWIFT block headers — ignorujeme {1:..}{2:..}{4: ... :20:...
    if (line.startsWith('{') && line.endsWith('}')) continue;

    const tagMatch = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tagMatch) {
      if (current) blocks.push(current);
      current = { tag: tagMatch[1], content: tagMatch[2] };
    } else if (current) {
      // Pokračování předchozího tagu (zalomený řádek)
      current.content += '\n' + line;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** Parse :60F: nebo :62F: → { mark: 'C'|'D', date, currency, amount } */
function parseBalance(content) {
  // Format: C260401CZK15000,00
  const m = content.match(/^([CD])(\d{6})([A-Z]{3})([\d.,]+)/);
  if (!m) return null;
  return {
    mark: m[1],
    date: parseDateYYMMDD(m[2]),
    currency: m[3],
    amount: parseMtAmount(m[4]) * (m[1] === 'D' ? -1 : 1),
  };
}

/** Parse :25: → { account, bank_code, iban } */
function parseAccountTag(content) {
  const trimmed = content.trim();
  // IBAN: CZ + 22 znaků
  const ibanMatch = trimmed.match(/^([A-Z]{2}\d{2}[\s\d]+)$/);
  if (ibanMatch && /^CZ/.test(trimmed)) {
    const iban = trimmed.replace(/\s/g, '');
    // Z CZ IBAN se dá vytáhnout: pozice 5-8 = bank code, 9-14 = prefix, 15-24 = base
    if (iban.length === 24 && iban.startsWith('CZ')) {
      const bankCode = iban.slice(4, 8);
      const prefix = iban.slice(8, 14).replace(/^0+/, '');
      const base = iban.slice(14, 24).replace(/^0+/, '') || '0';
      const account = prefix ? `${prefix}-${base}` : base;
      return { iban, account, bank_code: bankCode };
    }
    return { iban, account: null, bank_code: null };
  }
  // "1234567890/0300" formát
  const slashMatch = trimmed.match(/^([\d-]+)\/(\d{4})$/);
  if (slashMatch) {
    return { iban: null, account: slashMatch[1], bank_code: slashMatch[2] };
  }
  return { iban: null, account: trimmed, bank_code: null };
}

/** Parse :61: → transakční hlavička */
function parseLine61(content) {
  // Format (variabilní): YYMMDD[MMDD]C|D|RC|RD[fundsCode]amountNTRTrefAO//bankRef[\nsupplementary]
  const firstLine = content.split('\n')[0];

  // Match value date + optional entry date + DC + optional funds code + amount + N + transaction type
  const m = firstLine.match(
    /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d.,]+)([A-Z]{4})(.*)$/
  );
  if (!m) return null;

  const valueDate = parseDateYYMMDD(m[1]);
  const entryDate = m[2] ? parseDateYYMMDD(m[1].slice(0, 2) + m[2]) : valueDate;
  const dcMark = m[3];
  const amount = parseMtAmount(m[5]);
  const direction = (dcMark === 'C' || dcMark === 'RC') ? 'in' : 'out';
  const isReversal = dcMark.startsWith('R');
  const transactionType = m[6];

  // Reference: AO//bankRef
  const refRest = (m[7] || '').trim();
  let customerRef = null;
  let bankRef = null;
  if (refRest.includes('//')) {
    const parts = refRest.split('//');
    customerRef = parts[0] || null;
    bankRef = parts.slice(1).join('//') || null;
  } else {
    customerRef = refRest || null;
  }

  return {
    value_date: valueDate,
    entry_date: entryDate,
    direction,
    amount,
    is_reversal: isReversal,
    transaction_type: transactionType,
    customer_reference: customerRef,
    bank_reference: bankRef,
  };
}

/** Parse :86: strukturované české pole (MultiCash) → counterparty info, symboly, zpráva. */
function parseLine86(content) {
  const out = {
    counterparty_name: null,
    counterparty_account: null,
    counterparty_bank_code: null,
    variable_symbol: null,
    constant_symbol: null,
    specific_symbol: null,
    message: null,
    transaction_text: null,
  };

  if (!content) return out;

  // Strukturované sub-fieldy ?NN
  const subfieldRegex = /\?(\d{2})([^?]*)/g;
  const subfields = {};
  let match;
  while ((match = subfieldRegex.exec(content))) {
    const code = match[1];
    const value = match[2].trim();
    if (subfields[code]) subfields[code] += ' ' + value;
    else subfields[code] = value;
  }

  if (Object.keys(subfields).length > 0) {
    out.transaction_text = subfields['00'] || null;

    // Zpráva pro příjemce — typicky ?20-?25
    const messageParts = ['20', '21', '22', '23', '24', '25']
      .map(c => subfields[c])
      .filter(Boolean);
    if (messageParts.length > 0) out.message = messageParts.join(' ');

    out.counterparty_bank_code = subfields['30'] || null;
    out.counterparty_account = subfields['31'] || null;

    // Jméno protistrany — ?32 + ?33
    const nameParts = ['32', '33'].map(c => subfields[c]).filter(Boolean);
    if (nameParts.length > 0) out.counterparty_name = nameParts.join(' ');

    // Symboly — banky používají různé sub-kódy. Zkusíme ?60-?63
    // Zkušenost: ?60 obsahuje VS, KS, SS jako "VS:xxx KS:xxx SS:xxx" string
    const symbolBlock = ['60', '61', '62', '63'].map(c => subfields[c]).filter(Boolean).join(' ');
    if (symbolBlock) {
      const vsMatch = symbolBlock.match(/VS[:\s]*(\d+)/i);
      const ksMatch = symbolBlock.match(/KS[:\s]*(\d+)/i);
      const ssMatch = symbolBlock.match(/SS[:\s]*(\d+)/i);
      out.variable_symbol = vsMatch ? vsMatch[1] : null;
      out.constant_symbol = ksMatch ? ksMatch[1] : null;
      out.specific_symbol = ssMatch ? ssMatch[1] : null;
    }
  } else {
    // Nestrukturované — použij jako zprávu a zkus extrahovat VS/KS/SS heuristikou
    out.message = content.replace(/\s+/g, ' ').trim();
    const vsMatch = content.match(/VS[:\s]*(\d+)/i);
    const ksMatch = content.match(/KS[:\s]*(\d+)/i);
    const ssMatch = content.match(/SS[:\s]*(\d+)/i);
    if (vsMatch) out.variable_symbol = vsMatch[1];
    if (ksMatch) out.constant_symbol = ksMatch[1];
    if (ssMatch) out.specific_symbol = ssMatch[1];
  }

  return out;
}

// ─── HLAVNÍ PARSER ──────────────────────────────────────────────────────────

function parseMt940(input) {
  const blocks = collectTagBlocks(input);
  if (blocks.length === 0) {
    throw new Error('MT940: prázdný nebo nerozpoznatelný soubor');
  }

  const warnings = [];
  let statementRef = null;
  let accountInfo = null;
  let statementNumber = null;
  let openingBalance = null;
  let closingBalance = null;
  const transactions = [];

  for (let i = 0; i < blocks.length; i++) {
    const { tag, content } = blocks[i];

    switch (tag) {
      case '20':
        statementRef = content.trim();
        break;
      case '25':
        accountInfo = parseAccountTag(content);
        break;
      case '28':
      case '28C':
        statementNumber = content.trim();
        break;
      case '60F':
      case '60M':
        openingBalance = parseBalance(content);
        break;
      case '62F':
      case '62M':
        closingBalance = parseBalance(content);
        break;
      case '61': {
        const tx61 = parseLine61(content);
        if (!tx61) {
          warnings.push(`Tag ${i + 1} :61: nelze parsovat`);
          break;
        }
        // Najdi následující :86: pro doplňující info
        let info86 = {};
        if (i + 1 < blocks.length && blocks[i + 1].tag === '86') {
          info86 = parseLine86(blocks[i + 1].content);
        }
        transactions.push({
          transaction_date: tx61.entry_date || tx61.value_date,
          value_date: tx61.value_date,
          direction: tx61.direction,
          amount: tx61.amount,
          currency: openingBalance ? openingBalance.currency : 'CZK',
          counterparty_account: info86.counterparty_account || null,
          counterparty_bank_code: info86.counterparty_bank_code || null,
          counterparty_account_full:
            info86.counterparty_account && info86.counterparty_bank_code
              ? `${info86.counterparty_account}/${info86.counterparty_bank_code}`
              : info86.counterparty_account || null,
          counterparty_name: info86.counterparty_name || null,
          variable_symbol: info86.variable_symbol || null,
          constant_symbol: info86.constant_symbol || null,
          specific_symbol: info86.specific_symbol || null,
          message: info86.message || null,
          reference: tx61.bank_reference || tx61.customer_reference || null,
          is_reversal: tx61.is_reversal,
          transaction_type: tx61.transaction_type,
          transaction_text: info86.transaction_text || null,
        });
        break;
      }
      case '86':
        // Konzumováno :61: handlerem výše. Pokud :86: stojí osamoceně, ignoruj.
        break;
      default:
        // 64, 65, 13, 21, ... ostatní tagy ignorujeme — nejsou pro statement nezbytné
        break;
    }
  }

  if (!accountInfo) {
    throw new Error('MT940: chybí :25: tag (account identification)');
  }

  // Period z transakcí pokud neudán
  let periodFrom = openingBalance ? openingBalance.date : null;
  let periodTo = closingBalance ? closingBalance.date : null;
  if ((!periodFrom || !periodTo) && transactions.length > 0) {
    const dates = transactions.map(t => t.transaction_date.getTime());
    periodFrom = periodFrom || new Date(Math.min(...dates));
    periodTo = periodTo || new Date(Math.max(...dates));
  }

  const statement = {
    statement_number: statementNumber || statementRef || `MT940-${Date.now()}`,
    account_number: accountInfo.account,
    bank_code: accountInfo.bank_code,
    iban: accountInfo.iban,
    period_from: periodFrom,
    period_to: periodTo,
    opening_balance: openingBalance ? openingBalance.amount : 0,
    closing_balance: closingBalance ? closingBalance.amount : 0,
    debit_turnover: null,
    credit_turnover: null,
    currency: openingBalance ? openingBalance.currency : 'CZK',
    statement_ref: statementRef,
  };

  return { statement, transactions, warnings, format: 'mt940' };
}

module.exports = {
  parseMt940,
  // Exporty pro testy
  collectTagBlocks,
  parseBalance,
  parseAccountTag,
  parseLine61,
  parseLine86,
  parseDateYYMMDD,
};
