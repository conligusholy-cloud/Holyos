// HolyOS — GPC parser (bankovní výpis)
// =============================================================================
// Parsuje výpisy v ABO/GPC formátu (ČBA standard 1500). Akceptují jej všechny
// 4 banky, které HolyOS používá: Fio, ČSOB, Moneta, UniCredit. Layout je
// kalibrovaný proti reálnému Moneta výpisu (2026-04-26, 074 hlavička +
// 58 transakcí), Fio + ostatní mají velmi podobnou strukturu — odchylky se
// projeví pouze v okrajových polích (kód banky protistrany), nikoli v jádru
// (částka, VS, datum, popis).
//
// Encoding: Windows-1250 (CP1250). Fallback latin1.
//
// Layout 074 (hlavička, 128 znaků, 1-indexed):
//   01-03   "074"
//   04-19   účet plátce (16: prefix6 + base10, leading zeros)
//   20-39   název klienta (20)
//   40-45   datum staré bilance DDMMYY (6)
//   46-59   stará bilance v haléřích (14)
//   60      znaménko staré bilance (+/-)
//   61-74   nová bilance v haléřích (14)
//   75      znaménko nové bilance (+/-)
//   76-87   obrat MD v haléřích (12) — Moneta používá 12, jiné banky 14
//   88-101  obrat DAL v haléřích (14)  — variabilní napříč bankami
//   102-105 rezerva
//   106-108 pořadové číslo výpisu (3)
//   109-114 datum sestavení DDMMYY (6)
//   115-128 rezerva
//
// Layout 075 (transakce, 128 znaků, 1-indexed):
//   01-03   "075"
//   04-19   účet plátce — náš účet (16)
//   20-35   účet protistrany (16: prefix6 + base10)
//   36-48   bank reference / ID dokumentu (13)
//   49-60   částka v haléřích (12)
//   61      typ účtování (1=MD/výdaj, 2=DAL/příjem, 4=storno MD, 5=storno DAL)
//   62-71   variabilní symbol VS (10)
//   72-77   rezerva (6) — pravděpodobně obsahuje kód banky protistrany,
//           ale formát se napříč bankami liší (Moneta nepoužívá konzistentně)
//   78-81   konstantní symbol KS (4)
//   82-85   rezerva (4)
//   86-91   specifický symbol SS (6) — kratší než ABO standard 10
//   92-97   datum splatnosti DDMMYY (6)
//   98-117  popis / zpráva (20)
//   118-122 měna (5) — ISO 4217 numeric, "00203" pro CZK
//   123-128 datum účtování DDMMYY (6)
//
// Pozn.: GPC neobsahuje spolehlivě kód banky protistrany. Pole 72-77 některé
// banky vyplňují, jiné ne — necháváme to jako null a uživatel doplní ručně
// nebo přes auto-detekci podle čísla účtu (Moneta zjistí z databáze klientů).
//
// Řádky 078/079 (Fio rozšiřující info) se připojí k poslední 075 transakci
// jako extra_info.
// =============================================================================

'use strict';

const LINE_WIDTH = 128;

// ─── DEKÓDOVÁNÍ CP1250 → UTF-8 ──────────────────────────────────────────────

let _cp1250Decoder = null;
function getCp1250Decoder() {
  if (_cp1250Decoder !== null) return _cp1250Decoder;
  try {
    _cp1250Decoder = new TextDecoder('windows-1250', { fatal: false });
  } catch {
    _cp1250Decoder = false;
  }
  return _cp1250Decoder;
}

/** Buffer/string → string s českou diakritikou. Preferuje cp1250, fallback latin1. */
function decodeBuffer(input) {
  if (typeof input === 'string') return input;
  if (!Buffer.isBuffer(input)) return String(input);
  const decoder = getCp1250Decoder();
  if (decoder) {
    try {
      return decoder.decode(input);
    } catch {
      // padá → latin1 fallback
    }
  }
  return input.toString('latin1');
}

// ─── HELPERY ────────────────────────────────────────────────────────────────

function field(line, start, end) {
  return line.slice(start - 1, end).trim();
}

function fieldRaw(line, start, end) {
  return line.slice(start - 1, end);
}

function parseDateDDMMYY(s) {
  if (!s || !/^\d{6}$/.test(s)) return null;
  const dd = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(2, 4), 10);
  const yy = parseInt(s.slice(4, 6), 10);
  if (!dd || !mm || mm > 12 || dd > 31) return null;
  const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

function halerToCzk(s) {
  if (!s) return 0;
  const trimmed = String(s).trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const cleaned = trimmed.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
  const haler = parseInt(cleaned, 10);
  if (!Number.isFinite(haler)) return 0;
  return (haler / 100) * sign;
}

/** Bilance: 14 cifer + 1 znak znaménka (`+` / `-`) */
function halerToCzkSigned(numStr, signChar) {
  if (!numStr) return 0;
  const sign = signChar === '-' ? -1 : 1;
  const cleaned = String(numStr).replace(/^0+/, '') || '0';
  const haler = parseInt(cleaned, 10);
  if (!Number.isFinite(haler)) return 0;
  return (haler / 100) * sign;
}

function parseAboAccount(raw16) {
  if (!raw16) return '';
  const padded = String(raw16).padStart(16, '0');
  const prefix = padded.slice(0, 6).replace(/^0+/, '');
  const base = padded.slice(6, 16).replace(/^0+/, '') || '0';
  if (base === '0' && !prefix) return '';
  return prefix ? `${prefix}-${base}` : base;
}

function mapPostingType(t) {
  switch (t) {
    case '1': return { direction: 'out', isReversal: false };
    case '2': return { direction: 'in', isReversal: false };
    case '4': return { direction: 'in', isReversal: true };
    case '5': return { direction: 'out', isReversal: true };
    default:  return { direction: 'unknown', isReversal: false };
  }
}

const ISO4217_NUM = {
  '203': 'CZK', '978': 'EUR', '840': 'USD', '826': 'GBP',
  '348': 'HUF', '985': 'PLN', '946': 'RON',
};
function currencyFromIsoNum(s) {
  if (!s) return 'CZK';
  const trimmed = String(s).replace(/^0+/, '');
  return ISO4217_NUM[trimmed] || 'CZK';
}

function splitLines(input) {
  const text = decodeBuffer(input);
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(line => line.length > 0);
}

// ─── HLAVNÍ PARSER ──────────────────────────────────────────────────────────

function parseGpc(input) {
  const lines = splitLines(input);
  if (lines.length === 0) {
    throw new Error('GPC: prázdný soubor');
  }

  const warnings = [];
  let header = null;
  const transactions = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length < 3) {
      warnings.push(`Řádek ${i + 1}: příliš krátký, přeskakuji`);
      continue;
    }
    const line = raw.length < LINE_WIDTH
      ? raw + ' '.repeat(LINE_WIDTH - raw.length)
      : raw;
    if (raw.length > LINE_WIDTH + 2) {
      warnings.push(`Řádek ${i + 1}: delší než 128 znaků (${raw.length}), oříznuto`);
    }

    const recordType = line.slice(0, 3);

    if (recordType === '074') {
      if (header) {
        warnings.push(`Řádek ${i + 1}: druhá hlavička 074, přepisuji první`);
      }
      header = parseHeader074(line);
    } else if (recordType === '075') {
      if (!header) {
        throw new Error(`Řádek ${i + 1}: 075 transakce před hlavičkou 074`);
      }
      transactions.push(parseTransaction075(line, header));
    } else if (recordType === '078' || recordType === '079') {
      // Fio extra info — připojíme k poslední 075 transakci
      if (transactions.length > 0) {
        const last = transactions[transactions.length - 1];
        const extraText = line.slice(3, LINE_WIDTH).trim();
        if (extraText) {
          last.extra_info = last.extra_info
            ? last.extra_info + ' | ' + extraText
            : extraText;
        }
      } else {
        warnings.push(`Řádek ${i + 1}: ${recordType} bez předchozí 075 transakce`);
      }
    } else {
      warnings.push(`Řádek ${i + 1}: neznámý typ záznamu "${recordType}", přeskakuji`);
    }
  }

  if (!header) {
    throw new Error('GPC: chybí hlavička 074');
  }

  // Period z transakcí; fallback na statement_date
  let periodFrom = header.statement_date || header.old_balance_date || null;
  let periodTo = header.statement_date || null;
  if (transactions.length > 0) {
    const dates = transactions
      .map(t => t.transaction_date)
      .filter(Boolean)
      .map(d => d.getTime());
    if (dates.length > 0) {
      periodFrom = new Date(Math.min(...dates));
      periodTo = new Date(Math.max(...dates));
    }
  }

  // Statement number — pokud prázdné/nuly, fallback YYYYMMDD-{orig}
  let stmtNumber = header.statement_number;
  if (!stmtNumber || /^0+$/.test(stmtNumber)) {
    const dt = periodTo || new Date();
    stmtNumber = `GPC-${dt.toISOString().slice(0, 10).replace(/-/g, '')}-${stmtNumber || '000'}`;
    warnings.push(`Hlavička obsahuje prázdné číslo výpisu, použito náhradní "${stmtNumber}"`);
  }

  const statement = {
    statement_number: stmtNumber,
    account_number: header.account_number,
    bank_code: null,
    period_from: periodFrom,
    period_to: periodTo,
    opening_balance: header.opening_balance,
    closing_balance: header.closing_balance,
    debit_turnover: header.debit_turnover,
    credit_turnover: header.credit_turnover,
    statement_date: header.statement_date,
    account_name: header.account_name,
  };

  return { statement, transactions, warnings, format: 'gpc' };
}

function parseHeader074(line) {
  return {
    record_type: '074',
    account_number: parseAboAccount(fieldRaw(line, 4, 19)),
    account_name: field(line, 20, 39),
    old_balance_date: parseDateDDMMYY(fieldRaw(line, 40, 45)),
    opening_balance: halerToCzkSigned(fieldRaw(line, 46, 59), fieldRaw(line, 60, 60)),
    closing_balance: halerToCzkSigned(fieldRaw(line, 61, 74), fieldRaw(line, 75, 75)),
    // Obraty: 14 cifer (Moneta layout, ověřeno proti reálnému výpisu 26.4.2026)
    debit_turnover: halerToCzk(fieldRaw(line, 76, 89)),
    credit_turnover: halerToCzk(fieldRaw(line, 90, 103)),
    statement_number: field(line, 106, 108) || '0',
    statement_date: parseDateDDMMYY(fieldRaw(line, 109, 114)),
  };
}

function parseTransaction075(line, header) {
  const ourAccount = parseAboAccount(fieldRaw(line, 4, 19));
  const counterpartyAccount = parseAboAccount(fieldRaw(line, 20, 35));

  const reference = field(line, 36, 48);

  const amount = halerToCzk(fieldRaw(line, 49, 60));
  const postingType = fieldRaw(line, 61, 61);
  const { direction, isReversal } = mapPostingType(postingType);

  const variableSymbol = field(line, 62, 71).replace(/^0+/, '') || null;

  // Kód banky protistrany — pos 74-77 (Moneta layout, ověřeno proti PDF výpisu)
  const bankCodeRaw = field(line, 74, 77);
  const counterpartyBankCode = (bankCodeRaw && bankCodeRaw !== '0000') ? bankCodeRaw : null;

  const constantSymbol = field(line, 78, 81).replace(/^0+/, '') || null;
  const specificSymbol = field(line, 86, 91).replace(/^0+/, '') || null;

  const dueDate = parseDateDDMMYY(fieldRaw(line, 92, 97));
  const message = field(line, 98, 117) || null;
  const currency = currencyFromIsoNum(field(line, 118, 122));
  const transactionDate = parseDateDDMMYY(fieldRaw(line, 123, 128)) || header.statement_date;

  // Account_full = "číslo/banka" pokud bank code známý, jinak jen číslo
  const accountFull = counterpartyAccount
    ? (counterpartyBankCode ? `${counterpartyAccount}/${counterpartyBankCode}` : counterpartyAccount)
    : null;

  return {
    transaction_date: transactionDate,
    value_date: dueDate,
    direction,
    amount,
    currency,
    counterparty_account: counterpartyAccount || null,
    counterparty_bank_code: counterpartyBankCode,
    counterparty_account_full: accountFull,
    counterparty_name: null,
    variable_symbol: variableSymbol,
    constant_symbol: constantSymbol,
    specific_symbol: specificSymbol,
    message: message ? message.replace(/\s+$/, '') : null,
    reference: reference || null,
    is_reversal: isReversal,
    posting_type: postingType,
    our_account_in_record: ourAccount,
  };
}

module.exports = {
  parseGpc,
  parseHeader074,
  parseTransaction075,
  parseAboAccount,
  parseDateDDMMYY,
  halerToCzk,
  halerToCzkSigned,
  decodeBuffer,
  currencyFromIsoNum,
};
