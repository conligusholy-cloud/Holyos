// =============================================================================
// HolyOS — Ověření bankovních účtů (anti-podvod)
// =============================================================================
// Vrátí status, jestli je účet protistrany na faktuře "známý" (potvrzený dříve)
// nebo "podezřelý" (neznámý / liší se od dříve používaných).
//
// Stavy:
//   verified        — účet je v Company.verified_bank_accounts whitelistu
//   mfcr_ok         — účet zveřejněn v MFČR Registru plátců DPH (zapíše se k firmě)
//   mismatch        — firma má whitelist účtů, ale tenhle tam není (RED FLAG)
//   unknown         — žádný whitelist + žádné dřívější faktury → neutrální
//   no_account      — faktura nemá partner_bank_account (nelze ověřit)
//
// Whitelist se buduje při manuálním kliku "Potvrdit účet" v UI nebo při schválení
// faktury (3-way match). Service `addToWhitelist()` přidá účet s audit záznamem.
// =============================================================================

const { prisma } = require('../../config/database');
const { lookupDph, canonAccount, dicFor } = require('./mfcr-registr');

/**
 * Normalizuje číslo účtu — odstraní mezery, sjednotí oddělovač na '/'.
 */
function normalizeAccount(account) {
  if (!account) return null;
  return String(account).replace(/\s+/g, '').replace(/-/g, '');
}

/**
 * Ověří účet pro fakturu (účet přečtený z dokladu).
 *
 * Postup: 1) účty uložené u firmy (whitelist + hlavní účet v kartě)
 *         2) Registr plátců DPH MFČR (zveřejněné účty) — při shodě se účet
 *            sám zapíše k firmě (source 'mfcr_dph'), příště se ověří lokálně
 *         3) jinak needs_physical = true → člověk musí účet fyzicky ověřit
 *
 * @param {Object} args
 * @param {number} args.companyId
 * @param {string} args.partnerBankAccount
 * @param {string} [args.partnerIban]
 * @param {boolean} [args.useRegistry=true]  false = jen cache registru (listing)
 * @returns {Promise<{ status, message, source?, matched_entry?, needs_physical?, registry? }>}
 */
async function verifyAccount({ companyId, partnerBankAccount, partnerIban, useRegistry = true }) {
  if (!partnerBankAccount && !partnerIban) {
    return { status: 'no_account', message: 'Faktura nemá vyplněný účet protistrany.' };
  }
  if (!companyId) {
    return { status: 'unknown', needs_physical: true, message: 'Faktura nemá napojenou firmu — účet nelze porovnat.' };
  }
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, ico: true, dic: true, bank_account: true, verified_bank_accounts: true },
  });
  if (!company) return { status: 'unknown', needs_physical: true, message: 'Firma nenalezena.' };

  const whitelist = Array.isArray(company.verified_bank_accounts) ? company.verified_bank_accounts : [];
  const mine = [canonAccount(partnerBankAccount), canonAccount(partnerIban)].filter(Boolean);
  const hits = (...vals) => vals.some((v) => { const c = canonAccount(v); return c && mine.includes(c); });

  // 1a) Whitelist firmy
  const match = whitelist.find((e) => hits(e.account, e.iban));
  // 2) Registr DPH (i když je účet v whitelistu — kvůli nespolehlivému plátci)
  const dic = dicFor(company);
  let registry = null;
  if (dic) {
    const r = await lookupDph(dic, { cacheOnly: !useRegistry });
    if (r.ok) {
      registry = { checked: true, dic, found: r.found, unreliable: r.unreliable, accounts: r.accounts.map((a) => ({ account: a.account, since: a.since })), checked_at: r.checked_at,
        match: r.accounts.some((a) => a.canon && mine.includes(a.canon)) };
    } else if (r.error !== 'not_cached') {
      registry = { checked: false, dic, error: r.error };
    }
  } else {
    registry = { checked: false, error: 'Firma nemá CZ DIČ/IČO (zahraniční?) — registr MFČR nelze použít.' };
  }
  const unreliableNote = registry && registry.unreliable ? ' ⚠️ POZOR: firma je v registru vedena jako NESPOLEHLIVÝ PLÁTCE DPH!' : '';

  if (match) {
    return { status: 'verified', source: match.source || 'manual', matched_entry: match, registry,
      message: `Účet je uložen u firmy (${sourceLabel(match.source)}, ${match.verified_at?.slice(0, 10) || 'dříve'}).` + unreliableNote };
  }
  // 1b) Hlavní účet v kartě firmy
  if (company.bank_account && hits(company.bank_account)) {
    return { status: 'verified', source: 'company_card', registry, message: 'Účet odpovídá účtu v kartě firmy.' + unreliableNote };
  }
  // 2) Shoda s registrem → zapiš k firmě, ať příště stačí lokální kontrola
  if (registry && registry.match) {
    try {
      await addToWhitelist({ companyId, account: partnerBankAccount, iban: partnerIban, source: 'mfcr_dph',
        note: `Zveřejněný účet v Registru plátců DPH (DIČ CZ${dic})` });
    } catch (e) { console.error('[verify-account] zápis z registru selhal:', e.message); }
    return { status: 'mfcr_ok', source: 'mfcr_dph', registry,
      message: `Účet je zveřejněný v Registru plátců DPH (MFČR) — zapsán k firmě.` + unreliableNote };
  }
  // 3) Nic nesedí → fyzické ověření
  const why = [];
  why.push(whitelist.length || company.bank_account ? `u firmy máme uložené jiné účty (${whitelist.length + (company.bank_account ? 1 : 0)})` : 'u firmy zatím nemáme žádný uložený účet');
  if (registry && registry.checked) why.push(registry.found ? (registry.accounts.length ? `v registru DPH je zveřejněno ${registry.accounts.length} jiných účtů` : 'firma v registru DPH nemá zveřejněný žádný účet') : 'firma v registru DPH nenalezena');
  else if (registry && registry.error) why.push('registr DPH: ' + registry.error);
  return {
    status: (whitelist.length || company.bank_account || (registry && registry.accounts && registry.accounts.length)) ? 'mismatch' : 'unknown',
    needs_physical: true, registry,
    message: `Účet nesouhlasí s žádným známým účtem — ${why.join('; ')}. Před platbou ho FYZICKY ověř u dodavatele (telefon na známý kontakt).` + unreliableNote,
  };
}

function sourceLabel(s) {
  return ({ manual: 'potvrzen ručně', physical: 'fyzicky ověřen', mfcr_dph: 'z registru DPH', first_payment: 'po první platbě', company_card: 'karta firmy' })[s] || s || 'ručně';
}

/**
 * Přidá účet do whitelistu firmy.
 * @param {Object} args
 * @param {number} args.companyId
 * @param {string} args.account
 * @param {string} [args.iban]
 * @param {number} args.verifiedByUserId
 * @param {string} [args.source='manual']  — 'manual' | 'physical' | 'first_payment' | 'mfcr_dph'
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
    if ((normalized && eAcc === normalized) || (ibanNorm && eIban === ibanNorm)) return true;
    const mine = [canonAccount(account), canonAccount(iban)].filter(Boolean);
    return [canonAccount(e.account), canonAccount(e.iban)].some((c) => c && mine.includes(c));
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

module.exports = { verifyAccount, addToWhitelist, normalizeAccount, canonAccount, sourceLabel };
