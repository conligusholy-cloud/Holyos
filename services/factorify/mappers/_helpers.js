// =============================================================================
// HolyOS — Factorify mappers — sdílené utility
// =============================================================================
// Pomocné funkce pro extrakci hodnot z Factorify response (volné types,
// label objects, různé pojmenování polí). Vychází ze stylu dump-factorify.js.
// =============================================================================

/**
 * Vrátí první ne-null hodnotu z předaných klíčů. Pro objekty zkusí extrahovat
 * label/name/referenceName.
 */
function getStr(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      const inner = v.label || v.name || v.referenceName;
      if (typeof inner === 'string') return inner;
      if (inner != null) return String(inner);
    }
  }
  return null;
}

function getNum(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function getInt(obj, ...keys) {
  const n = getNum(obj, ...keys);
  return n != null ? Math.round(n) : null;
}

function getBool(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return false;
  for (const k of keys) {
    if (obj[k] != null) return !!obj[k];
  }
  return false;
}

function getDate(obj, ...keys) {
  const s = getStr(obj, ...keys);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Faktorify často reference cizí entitu jako vnořený objekt s `id`.
 * Vrátí stringové ID (factorify_id formát).
 */
function refId(refObj) {
  if (!refObj || typeof refObj !== 'object') return null;
  const id = refObj.id || refObj.ID || refObj.Id;
  return id != null ? String(id) : null;
}

/**
 * Ořez stringu na max délku (pro VarChar sloupce). Null-safe.
 */
function trimStr(val, maxLen) {
  if (val == null) return null;
  const s = String(val);
  return s.length > maxLen ? s.substring(0, maxLen) : s;
}

/**
 * Normalizace IČO: odstranění mezer, padding na 8 číslic. Pro porovnávání s HolyOS.
 */
function normalizeIco(ico) {
  if (!ico) return null;
  const cleaned = String(ico).replace(/\s/g, '').replace(/^CZ/i, '');
  if (!/^\d+$/.test(cleaned)) return cleaned; // pokud má písmena, vrátit původní
  return cleaned.padStart(8, '0');
}

/**
 * Cache pro lookup factorify_id → HolyOS id. Snižuje DB hits při importu items.
 */
class IdCache {
  constructor() { this.maps = new Map(); }
  get(table, factorifyId) {
    const m = this.maps.get(table);
    return m ? m.get(String(factorifyId)) : undefined;
  }
  set(table, factorifyId, holyosId) {
    if (!this.maps.has(table)) this.maps.set(table, new Map());
    this.maps.get(table).set(String(factorifyId), holyosId);
  }
  /** Předem nahrát všechna factorify_id → id z dané HolyOS tabulky. */
  async preload(prisma, table, modelName) {
    const rows = await prisma[modelName].findMany({
      where: { factorify_id: { not: null } },
      select: { id: true, factorify_id: true },
    });
    if (!this.maps.has(table)) this.maps.set(table, new Map());
    const m = this.maps.get(table);
    for (const r of rows) m.set(r.factorify_id, r.id);
    return rows.length;
  }
  size(table) { return this.maps.get(table)?.size ?? 0; }
}

/**
 * Statistika běhu importu jednoho mapperu.
 */
class ImportStats {
  constructor(label) {
    this.label = label;
    this.created = 0;
    this.updated = 0;
    this.skipped = 0;
    this.failed = 0;
    this.startedAt = Date.now();
    this.errors = [];
  }
  noteCreate() { this.created++; }
  noteUpdate() { this.updated++; }
  noteSkip(reason) { this.skipped++; if (reason && this.errors.length < 50) this.errors.push({ reason }); }
  noteFail(err, ctx) {
    this.failed++;
    if (this.errors.length < 50) this.errors.push({ message: err.message, ctx });
  }
  total() { return this.created + this.updated + this.skipped + this.failed; }
  summary() {
    const ms = Date.now() - this.startedAt;
    return `[${this.label}] ${this.total()} celkem · ${this.created} vytvořeno · ${this.updated} updated · ${this.skipped} skip · ${this.failed} fail · ${ms}ms`;
  }
}

/**
 * Batch upsert přes factorify_id. Dramatický speedup oproti per-record upsertu
 * (Railway latency ~150-250ms × N round-tripů → fixní 2-3 round-tripy celkem).
 *
 * Postup:
 *   1) ONE findMany — najdi existující factorify_id v jediném dotazu.
 *   2) Pro existing: prisma.$transaction(updateMany batches) — N updatů v jedné transakci.
 *   3) Pro new: prisma.createMany — bulk insert s skipDuplicates.
 *   4) Re-query po factorify_id pro získání nových HolyOS id (pro idCache).
 *
 * @param {PrismaClient} prisma
 * @param {string} modelName             camelCase prisma client name (např. 'company', 'project')
 * @param {Array<object>} dataList       data připravená k zápisu (každý objekt má .factorify_id)
 * @param {object} opts                  { dryRun, stats, idCache, idCacheTable, txSize=200, onProgress }
 * @returns {Promise<{stats, idMap}>}    idMap: Map<factorify_id, holyos_id>
 */
async function batchUpsertByFactorifyId(prisma, modelName, dataList, opts = {}) {
  const stats = opts.stats || new ImportStats(modelName);
  const txSize = opts.txSize || 200;
  const onProgress = opts.onProgress;
  const idMap = new Map();

  if (dataList.length === 0) return { stats, idMap };

  // 1) Lookup po factorify_id (jeden DB hit)
  const factorifyIds = dataList.map(d => d.factorify_id).filter(Boolean);
  let existingMap = new Map();
  if (factorifyIds.length > 0) {
    const existing = await prisma[modelName].findMany({
      where: { factorify_id: { in: factorifyIds } },
      select: { id: true, factorify_id: true },
    });
    existingMap = new Map(existing.map(e => [e.factorify_id, e.id]));
  }

  // 2) Rozhodni create vs update
  const toCreate = [];
  const toUpdate = [];
  for (const d of dataList) {
    if (d.factorify_id && existingMap.has(d.factorify_id)) {
      toUpdate.push({ data: d, existingId: existingMap.get(d.factorify_id) });
      idMap.set(d.factorify_id, existingMap.get(d.factorify_id));
    } else {
      toCreate.push(d);
    }
  }

  // 3) Bulk create
  if (toCreate.length > 0) {
    if (!opts.dryRun) {
      for (let i = 0; i < toCreate.length; i += txSize) {
        const batch = toCreate.slice(i, i + txSize);
        try {
          await prisma[modelName].createMany({ data: batch, skipDuplicates: true });
          for (const d of batch) stats.noteCreate();
        } catch (e) {
          // Fallback per-row (createMany může failnout na unique conflict)
          for (const d of batch) {
            try { await prisma[modelName].create({ data: d }); stats.noteCreate(); }
            catch (er) { stats.noteFail(er, { factorify_id: d.factorify_id }); }
          }
        }
        if (onProgress) onProgress(Math.min(i + txSize, toCreate.length), toCreate.length + toUpdate.length, 'create');
      }
    } else {
      for (const d of toCreate) stats.noteCreate();
    }

    // Re-query nově created kvůli idMap
    if (!opts.dryRun) {
      const newFactorifyIds = toCreate.map(d => d.factorify_id).filter(Boolean);
      if (newFactorifyIds.length > 0) {
        const newRows = await prisma[modelName].findMany({
          where: { factorify_id: { in: newFactorifyIds } },
          select: { id: true, factorify_id: true },
        });
        for (const r of newRows) idMap.set(r.factorify_id, r.id);
      }
    }
  }

  // 4) Batch update (transakce)
  if (toUpdate.length > 0) {
    if (!opts.dryRun) {
      for (let i = 0; i < toUpdate.length; i += txSize) {
        const batch = toUpdate.slice(i, i + txSize);
        try {
          await prisma.$transaction(batch.map(o => prisma[modelName].update({
            where: { id: o.existingId },
            data: o.data,
          })));
          for (const o of batch) stats.noteUpdate();
        } catch (e) {
          // Fallback per-row
          for (const o of batch) {
            try { await prisma[modelName].update({ where: { id: o.existingId }, data: o.data }); stats.noteUpdate(); }
            catch (er) { stats.noteFail(er, { factorify_id: o.data.factorify_id }); }
          }
        }
        if (onProgress) onProgress(toCreate.length + Math.min(i + txSize, toUpdate.length), toCreate.length + toUpdate.length, 'update');
      }
    } else {
      for (const o of toUpdate) stats.noteUpdate();
    }
  }

  // Aktualizuj idCache
  if (opts.idCache && opts.idCacheTable) {
    for (const [fid, hid] of idMap) opts.idCache.set(opts.idCacheTable, fid, hid);
  }

  return { stats, idMap };
}

module.exports = {
  getStr, getNum, getInt, getBool, getDate, refId,
  trimStr, normalizeIco,
  IdCache, ImportStats,
  batchUpsertByFactorifyId,
};
