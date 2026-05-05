// =============================================================================
// HolyOS — Mapper: Factorify Company → HolyOS Company
// =============================================================================
// Faktorify Company (1241 záznamů) má pole:
//   id, name, types[] (SUPPLIER/CUSTOMER/BOTH), stateIdentNo (IČO), vatNo (DIČ),
//   emails, phones, externalId, externalId2, paymentTerms, defaultBankAccount,
//   www, note, plus enum CompanyState
//
// Strategie párování (idempotentní):
//   1. Hledá existující záznam podle factorify_id
//   2. Fallback: hledá podle normalizovaného IČO (8 číslic)
//   3. Pokud nenajde, vytvoří nový
//
// Pro typ:
//   - SUPPLIER → 'supplier'
//   - CUSTOMER → 'customer'
//   - BOTH (= dodavatel i odběratel) → 'both'
//   - prázdné → 'supplier' (default — Tomáš migruje hlavně dodavatele)
// =============================================================================

const { getStr, trimStr, normalizeIco, ImportStats, batchUpsertByFactorifyId } = require('./_helpers');

function mapType(rawTypes) {
  const types = Array.isArray(rawTypes) ? rawTypes : [];
  const has = (t) => types.includes(t);
  if (has('BOTH')) return 'both';
  if (has('SUPPLIER') && has('CUSTOMER')) return 'both';
  if (has('CUSTOMER')) return 'customer';
  if (has('COOPERATION')) return 'cooperation';
  if (has('SERVICE_PROVIDER')) return 'service_provider';
  if (has('SUPPLIER')) return 'supplier';
  return 'supplier';
}

/**
 * Upsert jedné firmy.
 * @param {PrismaClient} prisma
 * @param {object} raw         - Factorify Company záznam
 * @param {object} opts        - { dryRun, stats, idCache }
 */
async function upsertSupplier(prisma, raw, opts = {}) {
  const stats = opts.stats || new ImportStats('suppliers');
  const factorifyId = raw?.id != null ? String(raw.id) : null;
  if (!factorifyId) { stats.noteSkip('missing id'); return null; }

  const name = trimStr(getStr(raw, 'name'), 255);
  if (!name) { stats.noteSkip(`${factorifyId}: missing name`); return null; }

  const ico = normalizeIco(getStr(raw, 'stateIdentNo'));
  const dic = trimStr(getStr(raw, 'vatNo'), 20);
  const type = mapType(raw.types);
  const email = trimStr(getStr(raw, 'emails'), 255);
  const phone = trimStr(getStr(raw, 'phones'), 20);
  const web = trimStr(getStr(raw, 'www'), 255);
  const notes = getStr(raw, 'note');
  // CompanyState — jen 'archived' převést na inactive
  const stateCode = getStr(raw?.state, 'code');
  const active = stateCode !== 'ARCHIVED';

  const data = {
    name,
    type,
    ico: ico ? trimStr(ico, 20) : null,
    dic,
    email,
    phone,
    web,
    notes,
    active,
    factorify_id: trimStr(factorifyId, 100),
  };

  if (opts.dryRun) {
    stats.noteCreate();
    if (opts.idCache) opts.idCache.set('companies', factorifyId, -1);
    return null;
  }

  try {
    // 1) Najdi po factorify_id
    let existing = await prisma.company.findFirst({
      where: { factorify_id: factorifyId },
      select: { id: true },
    });
    // 2) Fallback po IČO
    if (!existing && ico) {
      existing = await prisma.company.findFirst({
        where: { ico },
        select: { id: true },
      });
    }
    let companyId;
    if (existing) {
      await prisma.company.update({ where: { id: existing.id }, data });
      companyId = existing.id;
      stats.noteUpdate();
    } else {
      const created = await prisma.company.create({ data });
      companyId = created.id;
      stats.noteCreate();
    }
    if (opts.idCache) opts.idCache.set('companies', factorifyId, companyId);
    return companyId;
  } catch (e) {
    stats.noteFail(e, { factorify_id: factorifyId, name });
    return null;
  }
}

/**
 * Hromadný BATCH upsert suppliers — 200x rychlejší proti per-row variantě.
 * Strategie: factorify_id-first lookup (jeden findMany), pak createMany + transakční updates.
 * Pro fallback po IČO (entity bez factorify_id) se po batchovém běhu spustí druhá pasáž
 * per-row jen pro firmy, které selhaly na unique conflict (IČO match).
 *
 * @param {PrismaClient} prisma
 * @param {Array} rawList  - pole Factorify Company záznamů
 */
async function upsertSuppliers(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('suppliers');

  // 1) Map raw → data, filter invalidní
  const dataList = [];
  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }
    const name = trimStr(getStr(raw, 'name'), 255);
    if (!name) { stats.noteSkip(`${factorifyId}: missing name`); continue; }
    const ico = normalizeIco(getStr(raw, 'stateIdentNo'));
    const stateCode = getStr(raw?.state, 'code');
    dataList.push({
      name,
      type: mapType(raw.types),
      ico: ico ? trimStr(ico, 20) : null,
      dic: trimStr(getStr(raw, 'vatNo'), 20),
      email: trimStr(getStr(raw, 'emails'), 255),
      phone: trimStr(getStr(raw, 'phones'), 20),
      web: trimStr(getStr(raw, 'www'), 255),
      notes: getStr(raw, 'note'),
      active: stateCode !== 'ARCHIVED',
      factorify_id: trimStr(factorifyId, 100),
    });
  }

  // 2) Batch upsert
  return await batchUpsertByFactorifyId(prisma, 'company', dataList, {
    ...opts,
    stats,
    idCacheTable: 'companies',
  });
}

module.exports = { upsertSupplier, upsertSuppliers, mapType };
