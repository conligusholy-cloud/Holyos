// HolyOS — historie změn rezervací výrobních slotů (SlotAssignment) do audit_log.
// Zapisuje se automaticky z rozšíření Prisma klienta (config/database.js) → zachytí VŠECHNY cesty
// (UI, platby, workery, mazání objednávek…). Nikdy nesmí shodit původní operaci.
const ctx = require('./audit-context');

const FIELDS = ['slot_id', 'order_id', 'order_item_id', 'batch_id', 'product_name', 'customer_name', 'quantity', 'estimated_hours', 'priority', 'status', 'note', 'reservation_status', 'reserved_until', 'reservation_confirmed_at'];
const safe = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
const fmtD = (d) => { try { return new Date(d).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }); } catch (e) { return ''; } };

async function slotLabel(base, slotId, cache) {
  if (cache[slotId] !== undefined) return cache[slotId];
  let t = 'slot #' + slotId;
  try { const s = await base.productionSlot.findUnique({ where: { id: slotId }, select: { name: true, start_date: true, end_date: true } }); if (s) t = (s.name ? s.name + ' · ' : '') + fmtD(s.start_date) + '–' + fmtD(s.end_date); } catch (e) { /* label je jen informativní */ }
  return (cache[slotId] = t);
}

function diff(before, after) {
  const ch = {};
  FIELDS.forEach((k) => {
    const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
    const sa = a == null ? null : (a instanceof Date ? a.toISOString() : String(a)), sb = b == null ? null : (b instanceof Date ? b.toISOString() : String(b));
    if (sa !== sb) ch[k] = { from: sa, to: sb };
  });
  return ch;
}

// rows = [{ before, after }]; action = create | update | delete
async function write(base, action, rows, hint) {
  try {
    const c = ctx.get(); const u = c.user || {};
    const who = u.username || null, disp = u.displayName || u.display_name || (c.source ? null : null) || null;
    const src = c.source || hint || null; const cache = {};
    for (const r of rows) {
      const row = r.after || r.before; if (!row) continue;
      const label = await slotLabel(base, row.slot_id, cache);
      const who2 = disp || who || (src ? 'systém' : 'neznámý');
      let desc;
      if (action === 'create') desc = 'Rezervace slotu vytvořena: ' + (row.customer_name || row.product_name || '—') + ' · ' + label + (row.reservation_status ? ' (' + row.reservation_status + ')' : '');
      else if (action === 'delete') desc = 'Rezervace slotu SMAZÁNA: ' + (row.customer_name || row.product_name || '—') + ' · ' + label + (row.order_id ? ' · objednávka #' + row.order_id : '');
      else {
        const ch = diff(r.before, r.after); const keys = Object.keys(ch);
        if (!keys.length) continue;
        desc = 'Rezervace slotu upravena: ' + (row.customer_name || row.product_name || '—') + ' · ' + label + ' — ' + keys.join(', ');
        r.changes = ch;
      }
      if (src) desc += ' [' + src + ']';
      await base.auditLog.create({ data: {
        user_name: who, user_display: who2, action, entity: 'slot_assignment', entity_id: row.id, description: desc.slice(0, 1500),
        changes: action === 'update' ? safe(r.changes) : undefined, snapshot: safe(r.before || r.after),
      } });
    }
  } catch (e) { console.warn('[slot-audit] zápis selhal:', e.message); }
}

// Ruční zápis (např. před kaskádním smazáním slotu): rows = pole SlotAssignment záznamů
async function logDeleted(base, rows, hint) { await write(base, 'delete', (rows || []).map((b) => ({ before: b })), hint); }

function extension(base) {
  const find = (where) => base.slotAssignment.findMany({ where }).catch(() => []);
  return { query: { slotAssignment: {
    async create({ args, query }) { const r = await query(args); write(base, 'create', [{ after: r }]); return r; },
    async update({ args, query }) {
      const before = await base.slotAssignment.findUnique({ where: args.where }).catch(() => null);
      const r = await query(args); write(base, 'update', [{ before, after: r }]); return r;
    },
    async updateMany({ args, query }) {
      const before = await find(args.where); const r = await query(args);
      if (before.length) { const ids = before.map((b) => b.id); const after = await base.slotAssignment.findMany({ where: { id: { in: ids } } }).catch(() => []); write(base, 'update', before.map((b) => ({ before: b, after: after.find((a) => a.id === b.id) }))); }
      return r;
    },
    async delete({ args, query }) {
      const before = await base.slotAssignment.findUnique({ where: args.where }).catch(() => null);
      const r = await query(args); if (before) write(base, 'delete', [{ before }]); return r;
    },
    async deleteMany({ args, query }) {
      const before = await find(args.where); const r = await query(args);
      if (before.length) write(base, 'delete', before.map((b) => ({ before: b }))); return r;
    },
  } } };
}

module.exports = { extension, logDeleted };
