// =============================================================================
// HolyOS — Mapper: Factorify Project → HolyOS Project
// =============================================================================
// Faktorify Project (208 záznamů) — projekt, k němuž se vážou nákupní objednávky.
// Pole z metadata: id, name, code, active/state, ...
// =============================================================================

const { getStr, getBool, trimStr, ImportStats, batchUpsertByFactorifyId } = require('./_helpers');

async function upsertProject(prisma, raw, opts = {}) {
  const stats = opts.stats || new ImportStats('projects');
  const factorifyId = raw?.id != null ? String(raw.id) : null;
  if (!factorifyId) { stats.noteSkip('missing id'); return null; }

  const name = trimStr(getStr(raw, 'name', 'referenceName'), 255);
  if (!name) { stats.noteSkip(`${factorifyId}: missing name`); return null; }

  const code = trimStr(getStr(raw, 'code'), 50);
  const stateCode = getStr(raw?.state, 'code');
  const active = stateCode !== 'ARCHIVED' && stateCode !== 'CLOSED';
  const note = getStr(raw, 'note');

  const data = { name, code, active, note, factorify_id: trimStr(factorifyId, 100) };

  if (opts.dryRun) {
    stats.noteCreate();
    if (opts.idCache) opts.idCache.set('projects', factorifyId, -1);
    return null;
  }

  try {
    let existing = await prisma.project.findFirst({
      where: { factorify_id: factorifyId },
      select: { id: true },
    });
    if (!existing && code) {
      existing = await prisma.project.findFirst({
        where: { code },
        select: { id: true },
      });
    }
    let projectId;
    if (existing) {
      await prisma.project.update({ where: { id: existing.id }, data });
      projectId = existing.id;
      stats.noteUpdate();
    } else {
      const created = await prisma.project.create({ data });
      projectId = created.id;
      stats.noteCreate();
    }
    if (opts.idCache) opts.idCache.set('projects', factorifyId, projectId);
    return projectId;
  } catch (e) {
    stats.noteFail(e, { factorify_id: factorifyId, name });
    return null;
  }
}

/**
 * Hromadný BATCH upsert projektů.
 */
async function upsertProjects(prisma, rawList, opts = {}) {
  const stats = opts.stats || new ImportStats('projects');

  const dataList = [];
  for (const raw of rawList) {
    const factorifyId = raw?.id != null ? String(raw.id) : null;
    if (!factorifyId) { stats.noteSkip('missing id'); continue; }
    const name = trimStr(getStr(raw, 'name', 'referenceName'), 255);
    if (!name) { stats.noteSkip(`${factorifyId}: missing name`); continue; }
    const stateCode = getStr(raw?.state, 'code');
    dataList.push({
      name,
      code: trimStr(getStr(raw, 'code'), 50),
      active: stateCode !== 'ARCHIVED' && stateCode !== 'CLOSED',
      note: getStr(raw, 'note'),
      factorify_id: trimStr(factorifyId, 100),
    });
  }

  return await batchUpsertByFactorifyId(prisma, 'project', dataList, {
    ...opts,
    stats,
    idCacheTable: 'projects',
  });
}

module.exports = { upsertProject, upsertProjects };
