// HolyOS — kontrolní součty pro údaje přečtené z faktur (IČO, české číslo účtu, IBAN)
// Chybně přečtená číslice téměř vždy rozbije kontrolní součet → okamžitě poznáme, že OCR četla špatně.

const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');

/** IČO: 8 číslic, kontrolní číslice (modulo 11). Vrací true/false, null = prázdné. */
function icoValid(ico) {
  const d = digits(ico);
  if (!d) return null;
  if (d.length > 8) return false;
  const p = d.padStart(8, '0');
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(p[i]) * (8 - i);
  let c = 11 - (sum % 11);
  if (c === 10) c = 0;
  else if (c === 11) c = 1;
  return c === Number(p[7]);
}

/** České číslo účtu „[předčíslí-]číslo/kód banky": modulo 11 (váhy 6,3,7,9,10,5,8,4,2,1) zvlášť pro předčíslí a číslo. null = prázdné / zahraniční. */
function czAccountValid(acc) {
  const m = /^\s*(?:(\d{1,6})\s*-\s*)?(\d{2,10})\s*\/\s*(\d{4})\s*$/.exec(String(acc || ''));
  if (!m) return String(acc || '').trim() ? null : null;
  const W = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];
  const check = (numStr) => {
    const p = numStr.padStart(10, '0');
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(p[i]) * W[i];
    return sum % 11 === 0;
  };
  if (m[1] && !check(m[1])) return false;
  return check(m[2]);
}

/** IBAN: mezinárodní kontrola modulo 97. null = prázdné. */
function ibanValid(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!s) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const re = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const dch of v) rem = (rem * 10 + Number(dch)) % 97;
  }
  return rem === 1;
}

/**
 * Zkontroluje čísla v hlavičce faktury. Vrací { issues: [..], ok: bool }.
 * IČO se kontroluje jen u tuzemských dodavatelů (zahraniční nemají české IČO).
 */
function validateHeaderNumbers(header) {
  const issues = [];
  const sup = (header && header.supplier) || {};
  const country = String(sup.country || '').toUpperCase();
  const foreign = country && country !== 'CZ' && country !== 'SK';
  if (!foreign && sup.ico && icoValid(sup.ico) === false) issues.push({ field: 'supplier.ico', value: sup.ico, message: `IČO ${sup.ico} nemá platný kontrolní součet` });
  const acc = header && header.partner_bank_account;
  if (acc && czAccountValid(acc) === false) issues.push({ field: 'partner_bank_account', value: acc, message: `Číslo účtu ${acc} nemá platný kontrolní součet` });
  const iban = header && header.partner_iban;
  if (iban && ibanValid(iban) === false) issues.push({ field: 'partner_iban', value: iban, message: `IBAN ${iban} nemá platný kontrolní součet` });
  return { issues, ok: issues.length === 0 };
}

module.exports = { icoValid, czAccountValid, ibanValid, validateHeaderNumbers };
