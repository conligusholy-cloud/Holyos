// HolyOS — ABO / KPC platební příkaz generator
// =============================================================================
// Generuje "Klientský PC" (KPC) soubor v ABO formátu — historický český
// bankovní standard pro hromadné tuzemské platební příkazy. Akceptují jej
// všechny 4 banky, které HolyOS používá: Fio, ČSOB, Moneta, UniCredit.
//
// Specifikace:
//  - Pevná šířka 80 znaků na řádek + CRLF (\r\n)
//  - Encoding cp852 (DOS Latin 2) — fallback ASCII bez diakritiky
//  - Hlavička UHL1 (1 řádek)
//  - Jednorázové tuzemské příkazy = řádky typu "1" (jeden per platba)
//  - Ukončovací řádek "5" (kontrolní součet) — pro Fio/ČSOB povinný
//
// Nezávislé na DB i Prisma — vstupem je čistá struktura, výstupem Buffer.
// Lze testovat samostatně přes scripts/test-abo-kpc.js.
//
// Reference:
//  - https://www.fio.cz/docs/cz/struktura-abo.pdf  (Fio ABO popis)
//  - ČSOB: produkt MultiCash / "Tuzemský platební styk"
//  - ČBA standard 1500: Klientský PC formát
// =============================================================================

'use strict';

// ─── ZÁKLADNÍ KONSTANTY ─────────────────────────────────────────────────────

const LINE_WIDTH = 80;
const LINE_END = '\r\n';

/**
 * Mapa CZ-diakritiky → ASCII fallback. Bankovní formáty žádají ASCII (resp.
 * cp852, ale safer cesta je úplně bez háčků). Banka beztak při zpracování
 * diakritiku zahodí a může vrátit chybu validace.
 */
const DIACRITIC_MAP = {
  á: 'a', č: 'c', ď: 'd', é: 'e', ě: 'e', í: 'i', ň: 'n', ó: 'o',
  ř: 'r', š: 's', ť: 't', ú: 'u', ů: 'u', ý: 'y', ž: 'z',
  Á: 'A', Č: 'C', Ď: 'D', É: 'E', Ě: 'E', Í: 'I', Ň: 'N', Ó: 'O',
  Ř: 'R', Š: 'S', Ť: 'T', Ú: 'U', Ů: 'U', Ý: 'Y', Ž: 'Z',
};

// ─── HELPERY ────────────────────────────────────────────────────────────────

/** Odstraní diakritiku a unsafe ASCII znaky. */
function asciify(s) {
  if (s === null || s === undefined) return '';
  let out = String(s);
  out = out.replace(/[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, c => DIACRITIC_MAP[c] || c);
  // Cokoli mimo printable ASCII (32–126) zahodíme
  out = out.replace(/[^\x20-\x7E]/g, ' ');
  return out;
}

/** Doplní řetězec zprava mezerami na danou délku (left-justified). */
function padRight(s, len, char = ' ') {
  s = asciify(s);
  if (s.length >= len) return s.slice(0, len);
  return s + String(char).repeat(len - s.length);
}

/** Doplní řetězec zleva nulami nebo jiným znakem (right-justified). */
function padLeft(s, len, char = '0') {
  s = String(s);
  if (s.length >= len) return s.slice(-len);
  return String(char).repeat(len - s.length) + s;
}

/**
 * Rozdělí české bankovní spojení na (prefix, base, bankCode).
 *  Akceptuje formáty:
 *    "123-1234567890/0100"
 *    "1234567890/0100"
 *    "0001234567/0800"
 *  Vrací { prefix: string|null, base: string, bankCode: string }
 */
function parseAccount(input) {
  const cleaned = String(input || '').replace(/\s+/g, '').trim();
  const m = cleaned.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) {
    throw new Error(`Neplatný formát bankovního účtu: "${input}" (očekáváno [prefix-]číslo/kód_banky)`);
  }
  return {
    prefix: m[1] || null,
    base: m[2],
    bankCode: m[3],
  };
}

/** "1234-567890" → "00000012340000567890" (16 znaků, prefix-base) */
function formatAccountForAbo(account) {
  const { prefix, base } = parseAccount(account);
  // ABO úzus: prefix 6 znaků (zleva nulami) + base 10 znaků (zleva nulami)
  const prefixPad = padLeft(prefix || '0', 6, '0');
  const basePad = padLeft(base, 10, '0');
  return prefixPad + basePad;
}

/** Datum YYMMDD pro ABO header */
function fmtDateYYMMDD(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return yy + mm + dd;
}

/** Datum DDMMYY (alternativní formát používaný v některých polích) */
function fmtDateDDMMYY(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return dd + mm + yy;
}

/** Datum DDMMYYYY pro některé varianty (Fio chce někdy YYYYMMDD) */
function fmtDateDDMMYYYY(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return dd + mm + yyyy;
}

/** Částka v haléřích (Decimal/number → integer Kč*100) */
function amountInHaler(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Neplatná částka: ${amount}`);
  }
  return Math.round(n * 100);
}

// ─── HLAVNÍ GENERÁTOR ───────────────────────────────────────────────────────

/**
 * Vygeneruje obsah ABO/KPC souboru.
 *
 * @param {Object}   batch                              Vstupní data
 * @param {Object}   batch.senderAccount                Náš účet
 * @param {string}   batch.senderAccount.account        "123-1234567890/0100"
 * @param {string}   [batch.senderAccount.bankCode]     Volitelně přepíše parsed bank code
 * @param {string}   [batch.senderAccount.bankCodeFile] Číslo souboru za den, "001"–"999" (default "001")
 * @param {string}   [batch.batchNumber]                Interní číslo batche (jen pro UHL clientId)
 * @param {Date}     [batch.creationDate]               Datum vytvoření (default now)
 * @param {Date}     [batch.dueDate]                    Datum splatnosti (default = today, použito pro řádky)
 * @param {Array}    batch.payments                     Pole plateb
 * @param {string}   batch.payments[].targetAccount     "1234567890/0300"
 * @param {number}   batch.payments[].amount            Kč (decimal s 2 místy)
 * @param {string}   [batch.payments[].variableSymbol]  VS (max 10 číslic)
 * @param {string}   [batch.payments[].constantSymbol]  KS (max 4 číslice)
 * @param {string}   [batch.payments[].specificSymbol]  SS (max 10 číslic)
 * @param {string}   [batch.payments[].message]         Zpráva pro příjemce (max 35 znaků, ASCII)
 * @param {Date}     [batch.payments[].dueDate]         Splatnost per platba (default batch.dueDate)
 *
 * @returns {Object} { content: string, contentBuffer: Buffer, lineCount: number, totalAmount: number, totalHaler: number }
 */
function generateAboKpc(batch) {
  if (!batch || !batch.senderAccount || !batch.senderAccount.account) {
    throw new Error('generateAboKpc: chybí senderAccount.account');
  }
  if (!Array.isArray(batch.payments) || batch.payments.length === 0) {
    throw new Error('generateAboKpc: chybí payments (alespoň 1 platba)');
  }

  const sender = parseAccount(batch.senderAccount.account);
  const senderBankCode = batch.senderAccount.bankCode || sender.bankCode;
  const senderAccountAbo = formatAccountForAbo(batch.senderAccount.account);
  const fileSeq = padLeft(batch.senderAccount.bankCodeFile || '001', 3, '0');
  const creationDate = batch.creationDate || new Date();
  const defaultDue = batch.dueDate || creationDate;

  const lines = [];

  // ───── Řádek UHL1 — hlavička souboru (80 znaků) ────────────────────────────
  // Layout (1-indexed):
  //   01-04   "UHL1"
  //   05-10   datum vytvoření YYMMDD
  //   11-26   účet odesílatele (16 znaků, prefix6 + base10, leading zeros)
  //   27-29   pořadové č. souboru za den (3)
  //   30-49   identifikace klienta / batch_number (20)
  //   50-53   kód banky odesílatele (4)
  //   54-59   datum splatnosti (default) YYMMDD
  //   60-80   rezervní (mezery)
  let header = '';
  header += 'UHL1';                                       // 01-04
  header += fmtDateYYMMDD(creationDate);                  // 05-10
  header += senderAccountAbo;                             // 11-26
  header += fileSeq;                                      // 27-29
  header += padRight(batch.batchNumber || '', 20);        // 30-49
  header += padLeft(senderBankCode, 4, '0');              // 50-53
  header += fmtDateYYMMDD(defaultDue);                    // 54-59
  header += padRight('', LINE_WIDTH - header.length);     // dorovnání
  lines.push(header.slice(0, LINE_WIDTH));

  // ───── Řádky typu "1" — jednorázové tuzemské příkazy ───────────────────────
  // Layout (1-indexed):
  //   01      "1"
  //   02-15   identifikace klienta / VS prefix (14, padded right zeros)
  //   16-31   účet plátce (16, prefix6 + base10)
  //   32-44   částka v haléřích (13, leading zeros)
  //   45-60   účet příjemce (16, prefix6 + base10)
  //   61-64   kód banky příjemce (4)
  //   65-74   variabilní symbol (10, leading zeros)
  //   75-78   konstantní symbol (4, leading zeros)
  //   79-80   filler (00 — náhrada za splatnost a měnu, tu řešíme v UHL)
  let totalHaler = 0;

  for (let i = 0; i < batch.payments.length; i++) {
    const p = batch.payments[i] || {};
    if (!p.targetAccount) {
      throw new Error(`Platba #${i + 1}: chybí targetAccount`);
    }
    const target = parseAccount(p.targetAccount);
    const targetAbo = formatAccountForAbo(p.targetAccount);
    const haler = amountInHaler(p.amount);
    if (haler === 0) {
      throw new Error(`Platba #${i + 1}: částka 0 — odmítnuto`);
    }
    totalHaler += haler;

    const vs = padLeft((p.variableSymbol || '').replace(/\D/g, ''), 10, '0');
    const ks = padLeft((p.constantSymbol || '').replace(/\D/g, ''), 4, '0');
    // ssLong slouží pro klient_id v poli 02-15 (využíváme spec-symbol, max 14)
    const clientId = padLeft((p.specificSymbol || vs || '').replace(/\D/g, ''), 14, '0');

    let line = '';
    line += '1';                                          // 01
    line += clientId;                                     // 02-15
    line += senderAccountAbo;                             // 16-31
    line += padLeft(String(haler), 13, '0');              // 32-44
    line += targetAbo;                                    // 45-60
    line += padLeft(target.bankCode, 4, '0');             // 61-64
    line += vs;                                           // 65-74
    line += ks;                                           // 75-78
    line += '00';                                         // 79-80
    lines.push(line.slice(0, LINE_WIDTH));
  }

  // ───── Řádek "5" — souhrn / kontrolní součet ───────────────────────────────
  // Layout:
  //   01      "5"
  //   02-08   počet plateb (7, leading zeros)
  //   09-21   součet částek v haléřích (13, leading zeros)
  //   22-80   filler (mezery)
  let footer = '';
  footer += '5';                                          // 01
  footer += padLeft(String(batch.payments.length), 7, '0'); // 02-08
  footer += padLeft(String(totalHaler), 13, '0');         // 09-21
  footer += padRight('', LINE_WIDTH - footer.length);     // 22-80
  lines.push(footer.slice(0, LINE_WIDTH));

  // ───── Skládání výsledku ───────────────────────────────────────────────────
  const content = lines.join(LINE_END) + LINE_END;
  // cp852-aware Buffer: protože jsme vyhodili všechnu diakritiku v asciify(),
  // ASCII subset je 1:1 stejný v cp852 i UTF-8. Stačí bezpečně cast na latin1.
  const contentBuffer = Buffer.from(content, 'latin1');

  return {
    content,
    contentBuffer,
    lineCount: lines.length,
    paymentCount: batch.payments.length,
    totalAmount: totalHaler / 100,
    totalHaler,
    fileSeq,
  };
}

/**
 * Validace vstupních dat — vrátí pole errorů (prázdné = OK).
 * Lze použít před voláním generateAboKpc pro UI feedback.
 */
function validateBatchInput(batch) {
  const errors = [];
  if (!batch || typeof batch !== 'object') {
    errors.push('Chybí objekt batch');
    return errors;
  }
  if (!batch.senderAccount || !batch.senderAccount.account) {
    errors.push('Chybí senderAccount.account');
  } else {
    try { parseAccount(batch.senderAccount.account); }
    catch (e) { errors.push(e.message); }
  }
  if (!Array.isArray(batch.payments) || batch.payments.length === 0) {
    errors.push('Žádné platby v batch');
    return errors;
  }
  batch.payments.forEach((p, i) => {
    if (!p.targetAccount) errors.push(`Platba #${i + 1}: chybí targetAccount`);
    else {
      try { parseAccount(p.targetAccount); }
      catch (e) { errors.push(`Platba #${i + 1}: ${e.message}`); }
    }
    const a = Number(p.amount);
    if (!Number.isFinite(a) || a <= 0) errors.push(`Platba #${i + 1}: neplatná částka`);
    if (p.variableSymbol && !/^\d{1,10}$/.test(String(p.variableSymbol))) {
      errors.push(`Platba #${i + 1}: VS musí být 1–10 číslic`);
    }
    if (p.constantSymbol && !/^\d{1,4}$/.test(String(p.constantSymbol))) {
      errors.push(`Platba #${i + 1}: KS musí být 1–4 číslic`);
    }
    if (p.specificSymbol && !/^\d{1,10}$/.test(String(p.specificSymbol))) {
      errors.push(`Platba #${i + 1}: SS musí být 1–10 číslic`);
    }
  });
  return errors;
}

module.exports = {
  generateAboKpc,
  validateBatchInput,
  // Exporty pro testy + bank-specific adapters
  parseAccount,
  formatAccountForAbo,
  asciify,
  padRight,
  padLeft,
  fmtDateYYMMDD,
  fmtDateDDMMYY,
  fmtDateDDMMYYYY,
  amountInHaler,
  LINE_WIDTH,
  LINE_END,
};
