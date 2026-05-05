// =============================================================================
// HolyOS — Mapper: Factorify CostCenter → HolyOS CostCenter
// =============================================================================
// Faktorify CostCenter (11 záznamů) — nákladová střediska.
// HolyOS CostCenter má pole: code (unique), name, type, active, factorify_id
// =============================================================================

const { getStr, trimStr, ImportStats } = require('./_helpers');

async function upsertCostCenter(prisma, raw, opts = {}) {
  const stats = opts.stats || new ImportStats('cost_centers');
  const factorifyId = raw?.id != null ? String(raw.id) : null;
  if (!factorifyId) { stats.noteSkip('missing id'); return null; }

  const name = trimStr(getStr(raw, 'name', 'referenceName'), 255);
  if (!name) { stats.noteSkip(`${factorifyId}: missing name`); return null; }

  const factorifyCode = getStr(raw, 'code');
  // HolyOS vyžaduje unique code. Pokud Factorify nemá, vyrobíme z factorify_id.
  const code = trimStr(factorifyCode || `FY-CC-${factorifyId}`, 50);

  // HolyOS type je restriktivní (vehicle/person/machine/project/department/general).
  // Faktorify CostCenter to nezná → defaulujeme na 'general'.
  const data = {
    name,
    code,
    type: 'general',
    active: true,
    factorify_id: trimStr(factorifyId, 100),
  };

  if (opts.dryRun) {
    stats.noteCreate();
    if (opts.idCache) opts.idCache.set('cost_centers', factorifyId, -1);
    return null;
  }

  try {
    let existing = await prisma.costCenter.findFirst({
      where: { factorify_id: factorifyId },
      select: { id: true },
    });
    if (!existing) {
      // Fallback: po code (pokud má původní CostCenter v HolyOS stejný code)
      existing = await prisma.costCenter.findFirst({
        where: { code },
        select: { id: true },
      });
    }
    let costCenterId;
    if (existing) {
      // Pokud je code unique a koliduje, nejprve to zkontrolujeme — update jen pokud
      // nepřepíšeme cizí code.
      const updateData = { ...data };
      // Pokud existing má jiný code než my dáváme a je to existující HolyOS záznam, nepřepíšeme.
      // (jen doplníme factorify_id)
      const safeUpdate = await prisma.costCenter.findFirst({
        where: { id: existing.id, code },
      });
      if (!safeUpdate) {
        // existing má jiný code → jen doplnit factorify_id, nepřepisovat
        delete updateData.code;
        delete updateData.name;
        delete updateData.type;
      }
      await prisma.costCenter.update({ where: { id: existing.id }, data: updateData });
      costCenterId = existing.id;
      stats.noteUpdate();
    } else {
      const created = await prisma.costCenter.create({ data });
      costCenterId = created.id;
      stats.noteCreate();
    }
    if (opts.idCache) opts.idCache.set('cost_centers', factorifyId, costCenterId);
    return costCenterId;
  } catch (e) {
    stats.noteFail(e, { factorify_id: factorifyId, name });
    return null;
  }
}

async function upsertCostCenters(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('cost_centers');
  for (const raw of rawList) {
    await upsertCostCenter(prisma, raw, { ...opts, stats });
  }
  return stats;
}

module.exports = { upsertCostCenter, upsertCostCenters };
