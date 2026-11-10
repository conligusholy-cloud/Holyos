// =============================================================================
// HolyOS — Plánovač: nepřítomnosti lidí (schválené žádosti o volno)
// =============================================================================
//
// Most mezi HR a plánováním výroby. Jakmile je žádost o volno schválená,
// plánovač daného člověka v těch dnech nesmí na nic naplánovat. (Požadavek #136)
//
// Celozávodní dovolená (CompanyLeave) se řeší jinde — shift-calendar.js ji
// promítá do `closedDays`, takže stojí celý závod. Tenhle modul řeší absence
// jednotlivých lidí.
//
// POZOR — TZ: LeaveRequest.date_from/date_to jsou Prisma @db.Date, tj. půlnoc
// v UTC. Plánovač ale počítá v lokálním čase serveru (TZ=Europe/Prague), proto
// se kalendářní den z UTC složek přepočítá na lokální interval
// <den 00:00 lokálně, následující den 00:00 lokálně).
// =============================================================================

/** Kalendářní den z Prisma @db.Date → lokální interval celého dne. */
function denNaInterval(date) {
  const d = new Date(date);
  const start = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  const end = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return { start, end };
}

/** Interval od prvního do posledního dne absence (včetně obou krajních dnů). */
function absenceInterval(req) {
  const od = denNaInterval(req.date_from).start;
  const doData = denNaInterval(req.date_to || req.date_from).end;
  return { start: od, end: doData };
}

/**
 * Načte schválené absence lidí jako Map person_id → [{ start, end, type, request_id }].
 * `from`/`to` zužují načtený rozsah (default: od včerejška dál).
 */
async function loadApprovedAbsences(prisma, opts = {}) {
  const out = new Map();
  try {
    if (!prisma || !prisma.leaveRequest) return out;
    const from = opts.from ? new Date(opts.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d; })();
    const where = { status: 'approved', date_to: { gte: from } };
    if (opts.to) where.date_from = { lte: new Date(opts.to) };
    if (Array.isArray(opts.personIds) && opts.personIds.length) where.person_id = { in: opts.personIds };

    const rows = await prisma.leaveRequest.findMany({
      where,
      select: { id: true, person_id: true, type: true, date_from: true, date_to: true },
    });
    for (const r of rows) {
      const iv = absenceInterval(r);
      if (!out.has(r.person_id)) out.set(r.person_id, []);
      out.get(r.person_id).push({ start: iv.start, end: iv.end, type: r.type, request_id: r.id });
    }
  } catch (e) {
    // Nepřítomnosti nesmí shodit plánování — v nejhorším se plánuje jako dřív.
    console.warn('[planning] načtení schválených absencí:', e.message);
  }
  return out;
}

/** Je člověk v intervalu <start, end) nepřítomný? */
function isAway(absences, personId, start, end) {
  const list = absences && absences.get ? absences.get(personId) : null;
  if (!list || !list.length) return false;
  const s = new Date(start).getTime();
  const e = new Date(end || start).getTime();
  return list.some(iv => iv.start.getTime() < e && iv.end.getTime() > s);
}

/** Důvod nepřítomnosti pro hlášky (první překrývající se záznam). */
function awayReason(absences, personId, start, end) {
  const list = absences && absences.get ? absences.get(personId) : null;
  if (!list) return null;
  const s = new Date(start).getTime();
  const e = new Date(end || start).getTime();
  const hit = list.find(iv => iv.start.getTime() < e && iv.end.getTime() > s);
  return hit ? hit.type : null;
}

/**
 * Operace, které už jsou naplánované na dny schválené absence. Používá se po
 * schválení žádosti — plán se tím nepřepisuje, jen se na kolizi upozorní.
 */
async function findPlannedConflicts(prisma, request) {
  const iv = absenceInterval(request);
  try {
    const workers = await prisma.batchOperationWorker.findMany({
      where: {
        person_id: request.person_id,
        batch_operation: {
          planned_start: { lt: iv.end },
          planned_end: { gt: iv.start },
          status: { notIn: ['cancelled', 'done', 'completed'] },
          batch: { status: { in: ['planned', 'released', 'in_progress', 'paused'] } },
        },
      },
      select: {
        batch_operation: {
          select: {
            id: true, planned_start: true, planned_end: true, batch_id: true,
            operation: { select: { name: true } },
            batch: { select: { id: true, batch_number: true } },
          },
        },
      },
    });
    const videno = new Set();
    const out = [];
    for (const w of workers) {
      const bo = w.batch_operation;
      if (!bo || videno.has(bo.id)) continue;
      videno.add(bo.id);
      out.push({
        operation_id: bo.id,
        batch_id: bo.batch_id,
        batch_number: bo.batch && bo.batch.batch_number ? bo.batch.batch_number : ('#' + bo.batch_id),
        name: bo.operation && bo.operation.name ? bo.operation.name : ('Operace #' + bo.id),
        planned_start: bo.planned_start,
        planned_end: bo.planned_end,
      });
    }
    out.sort((a, b) => new Date(a.planned_start) - new Date(b.planned_start));
    return out;
  } catch (e) {
    console.warn('[planning] kontrola kolizí absence s plánem:', e.message);
    return [];
  }
}

module.exports = {
  loadApprovedAbsences,
  isAway,
  awayReason,
  absenceInterval,
  findPlannedConflicts,
};
