// =============================================================================
// HolyOS — Ověření bankovních účtů (anti-podvod)
// =============================================================================
// Vrátí status, jestli je účet protistrany na faktuře "známý" (potvrzený dříve)
// nebo "podezřelý" (neznámý / liší se od dříve používaných).
//
// Stavy:
//   verified        — účet je v Company.verified_bank_accounts whitelistu
//   mfcr_ok         — účet potvrzen v MFČR Registru plátců DPH (Fáze 2, později)
//   mismatch        — firma má whitelist účtů, ale tenhle tam není (RED FLAG)
//   unknown         — žádný whitelist + žádné dřívější faktury → neutrální
//   no_account      — faktura nemá partner_bank_account (nelze ověřit)
//
// Whitelist se buduje při manuálním kliku "Potvrdit účet" v UI nebo při schválení
// faktury (3-way match). Service `addToWhitelist()` přidá účet s audit záznamem.
// =============================================================================

const { prisma } = require('../../config/database');

/**
 * Normalizuje číslo účtu — odstraní mezery, sjednotí oddělovač na '/'.
 */
function normalizeAccount(account) {
  if (!account) return null;
  return String(account).replace(/\s+/g, '').replace(/-/g, '');
}

/**
 * Ověří účet pro fakturu.
 *
 * @param {Object} args
 * @param {number} args.companyId  - ID firmy protistrany (Company.id)
 * @param {string} args.partnerBankAccount - číslo účtu z Invoice
 * @param {string} [args.partnerIban]
 * @returns {Promise<{ status, message, source?, matched_entry? }>}
 */
async function verifyAccount({ companyId, partnerBankAccount, partnerIban }) {
  if (!partnerBankAccount && !partnerIban) {
    return { status: 'no_account', message: 'Faktura nemá vyplněný účet protistrany.' };
  }

  if (!companyId) {
    return { status: 'unknown', message: 'Faktura nemá napojenou firmu.' };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, verified_bank_accounts: true },
  });
  if (!company) {
    return { status: 'unknown', message: 'Firma nenalezena.' };
  }

  const whitelist = Array.isArray(company.verified_bank_accounts)
    ? company.verified_bank_accounts
    : [];

  const normalized = normalizeAccount(partnerBankAccount);
  const ibanNorm = (partnerIban || '').replace(/\s+/g, '').toUpperCase();

  // 1) Hledej v interním whitelistu (přesná shoda nebo IBAN shoda)
  const match = whitelist.find(entry => {
    const entryAcc = normalizeAccount(entry.account);
    const entryIban = (entry.iban || '').replace(/\s+/g, '').toUpperCase();
    if (normalized && entryAcc && entryAcc === normalized) return true;
    if (ibanNorm && entryIban && entryIban === ibanNorm) return true;
    return false;
  });

  if (match) {
    return {
      status: 'verified',
      source: match.source || 'manual',
      message: `Účet je v whitelistu firmy (potvrzen ${match.verified_at?.slice(0, 10) || 'dříve'}).`,
      matched_entry: match,
    };
  }

  // 2) Whitelist EXISTUJE, ale účet v něm není → mismatch (RED FLAG)
  if (whitelist.length > 0) {
    return {
      status: 'mismatch',
      message: `Firma "${company.name}" má v whitelistu ${whitelist.length} účet${whitelist.length === 1 ? '' : 'ů'}, ale tenhle (${partnerBankAccount}) tam není. Před platbou ověř s dodavatelem!`,
    };
  }

  // 3) Bez whitelistu → unknown (neutralní, první kontakt s firmou)
  //    TODO Fáze 2: zkusit MFČR Registr plátců DPH
  return {
    status: 'unknown',
    message: `Firma "${company.name}" zatím nemá ověřené účty. Po první platbě potvrď účet kliknutím na "Potvrdit účet" v detailu faktury.`,
  };
}

/**
 * Přidá účet do whitelistu firmy.
 * @param {Object} args
 * @param {number} args.companyId
 * @param {string} args.account
 * @param {string} [args.iban]
 * @param {number} args.verifiedByUserId
 * @param {string} [args.source='manual']  — 'manual' | 'first_payment' | 'mfcr_dph'
 * @param {string} [args.note]
 */
async function addToWhitelist({ companyId, account, iban, verifiedByUserId, source = 'manual', note }) {
  if (!companyId) throw new Error('addToWhitelist: chybí companyId');
  if (!account && !iban) throw new Error('addToWhitelist: chybí account ani iban');

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, verified_bank_accounts: true },
  });
  if (!company) throw new Error(`addToWhitelist: Company ${companyId} neexistuje`);

  const whitelist = Array.isArray(company.verified_bank_accounts)
    ? [...company.verified_bank_accounts]
    : [];

  const normalized = normalizeAccount(account);
  const ibanNorm = (iban || '').replace(/\s+/g, '').toUpperCase();

  // Pokud už v whitelistu je, neduplikujeme
  const existing = whitelist.find(e => {
    const eAcc = normalizeAccount(e.account);
    const eIban = (e.iban || '').replace(/\s+/g, '').toUpperCase();
    return (normalized && eAcc === normalized) || (ibanNorm && eIban === ibanNorm);
  });
  if (existing) {
    return { added: false, reason: 'duplicate', entry: existing };
  }

  const entry = {
    account: account || null,
    iban: iban || null,
    verified_by_user_id: verifiedByUserId || null,
    verified_at: new Date().toISOString(),
    source,
    note: note || null,
  };
  whitelist.push(entry);

  await prisma.company.update({
    where: { id: companyId },
    data: { verified_bank_accounts: whitelist },
  });

  return { added: true, entry, total: whitelist.length };
}

module.exports = { verifyAccount, addToWhitelist, normalizeAccount };
