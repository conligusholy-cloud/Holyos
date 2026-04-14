// =============================================================================
// HolyOS — Audit logging helper
// Automatické logování změn do audit_log tabulky
// =============================================================================

const { prisma } = require('../config/database');

/**
 * Zaloguje akci do audit logu
 * @param {Object} opts
 * @param {string} opts.action - 'create' | 'update' | 'delete' | 'rollback'
 * @param {string} opts.entity - název entity (person, department, role, warehouse, material, ...)
 * @param {number} opts.entity_id - ID entity
 * @param {string} opts.description - popis změny (česky)
 * @param {Object} opts.changes - { field: { from, to } } — změny (pro update)
 * @param {Object} opts.snapshot - kompletní snapshot entity (pro rollback)
 * @param {Object} opts.user - req.user objekt
 */
async function logAudit({ action, entity, entity_id, description, changes, snapshot, user }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entity_id: entity_id || null,
        description: description || null,
        changes: changes || undefined,
        snapshot: snapshot || undefined,
        user_name: user ? (user.username || null) : null,
        user_display: user ? (user.displayName || user.display_name || null) : null,
      },
    });
  } catch (err) {
    // Audit log nesmí shodit hlavní operaci — jen logujeme chybu
    console.error('[Audit] Chyba při zápisu audit logu:', err.message);
  }
}

/**
 * Porovná dva objekty a vrátí změny
 * @param {Object} before - starý stav
 * @param {Object} after - nový stav
 * @returns {Object} - { field: { from, to } }
 */
function diffObjects(before, after) {
  const changes = {};
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  // Ignorovat systémová pole
  const ignore = new Set(['id', 'created_at', 'updated_at', 'password_hash', 'password']);

  for (const key of allKeys) {
    if (ignore.has(key)) continue;
    const oldVal = before ? before[key] : undefined;
    const newVal = after ? after[key] : undefined;

    // Přeskoč vnořené objekty (relace) — logujeme jen skalární pole
    if (oldVal !== null && typeof oldVal === 'object' && !Array.isArray(oldVal) && !(oldVal instanceof Date)) continue;
    if (newVal !== null && typeof newVal === 'object' && !Array.isArray(newVal) && !(newVal instanceof Date)) continue;

    // Porovnej hodnoty (normalizuj null/undefined)
    const o = oldVal === undefined ? null : oldVal;
    const n = newVal === undefined ? null : newVal;

    // Date porovnání
    if (o instanceof Date && n instanceof Date) {
      if (o.getTime() !== n.getTime()) changes[key] = { from: o.toISOString(), to: n.toISOString() };
      continue;
    }

    // Stringify pro bezpečné porovnání (Decimal, atd.)
    if (String(o) !== String(n)) {
      changes[key] = { from: o, to: n };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Vytvoří čistý snapshot entity (bez vnořených relací)
 * @param {Object} entity - Prisma objekt
 * @returns {Object} - Flat snapshot
 */
function makeSnapshot(entity) {
  if (!entity) return null;
  const snap = {};
  for (const [key, val] of Object.entries(entity)) {
    // Přeskoč vnořené objekty (relace)
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) continue;
    if (key === 'password_hash') continue;
    snap[key] = val;
  }
  return snap;
}

module.exports = { logAudit, diffObjects, makeSnapshot };
