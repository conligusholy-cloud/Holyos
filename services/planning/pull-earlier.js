// =============================================================================
// HolyOS — Plánovač: posunutí operace na DŘÍVĚJŠÍ termín (když je materiál připravený dřív)
// =============================================================================
// Skladník ve čtečce připraví materiál / WIP dřív, než je plánovaný termín. Pak může
// operaci „stáhnout" dopředu — ale jen pokud:
//   1) všechny úkoly přípravy pro tuto operaci jsou označené „připraveno" (nebo žádné nejsou),
//   2) předchozí operace hlavní linie v dávce už skončila / je naplánovaná před novým startem,
//   3) pracoviště je v novém okně volné (jiný výrobek ho nedrží — viz pravidlo jeden výrobek na pracovišti),
//   4) VŠICHNI přiřazení lidé (montér + další pracovníci) mají v novém okně volno.
// Hledá nejbližší vyhovující okno od „teď" v pracovní době; když není dřívější než dosavadní plán,
// nic nemění a vrátí důvod.
// =============================================================================
'use strict';

const { prisma: defaultPrisma } = require('../../config/database');
const { loadShiftConfig, consumeShift, nextShiftStart } = require('./shift-calendar');
const { operationMinutes, findQueueConflictEnd, loadQueueByWorkstation, ACTIVE_BATCH_STATUSES } = require('./scheduler');

async function personsConflictEnd(tx, personIds, start, end, excludeOpId) {
  if (!personIds.length) return null;
  const rows = await tx.batchOperation.findMany({
    where: {
      id: { not: excludeOpId },
      status: { notIn: ['done', 'cancelled'] },
      planned_start: { lt: end }, planned_end: { gt: start },
      batch: { status: { in: ACTIVE_BATCH_STATUSES } },
      OR: [{ assigned_person_id: { in: personIds } }, { workers: { some: { person_id: { in: personIds } } } }],
    },
    select: { planned_end: true, assigned_person: { select: { first_name: true, last_name: true } } },
    orderBy: { planned_end: 'desc' }, take: 1,
  });
  if (!rows.length) return null;
  return { end: new Date(rows[0].planned_end), who: rows[0].assigned_person ? ((rows[0].assigned_person.first_name || '') + ' ' + (rows[0].assigned_person.last_name || '')).trim() : null };
}

async function pullOperationEarlier(batchOpId, opts = {}) {
  const tx = opts.prisma || defaultPrisma;
  const op = await tx.batchOperation.findUnique({
    where: { id: batchOpId },
    include: {
      batch: { select: { id: true, batch_number: true, quantity: true, status: true } },
      operation: { select: { id: true, name: true, step_number: true, duration: true, duration_unit: true, preparation_time: true, is_parallel: true, parallel_from: true } },
      workers: { select: { person_id: true } },
      assigned_person: { select: { id: true, first_name: true, last_name: true } },
    },
  });
  if (!op) return { ok: false, moved: false, reason: 'Operace nenalezena' };
  if (!['pending', 'ready'].includes(op.status)) return { ok: false, moved: false, reason: 'Operace už běží nebo je hotová' };
  if (!op.planned_start) return { ok: false, moved: false, reason: 'Operace nemá naplánovaný termín' };

  // 1) materiál / WIP pro tuto operaci připraveno?
  const { computeMaterialTasks } = require('./material-tasks');
  const from = new Date(new Date(op.planned_start).getTime() - 3 * 86400000);
  const to = new Date(new Date(op.planned_end || op.planned_start).getTime() + 86400000);
  const mt = await computeMaterialTasks({ prisma: tx, from, to });
  const mine = (mt.tasks || []).filter(t => t.operation && t.operation.batch_operation_id === op.id);
  const notReady = mine.filter(t => !t.prepared);
  if (notReady.length) return { ok: false, moved: false, reason: 'Není připraveno: ' + notReady.map(t => (t.item && t.item.code) || t.kind).join(', ') };

  // 2) předchozí operace hlavní linie
  let earliest = new Date();
  if (!op.operation.is_parallel) {
    const prev = await tx.batchOperation.findFirst({
      where: { batch_id: op.batch_id, sequence: { lt: op.sequence }, status: { notIn: ['cancelled'] }, operation: { is_parallel: false } },
      orderBy: { sequence: 'desc' },
      select: { status: true, planned_end: true, finished_at: true },
    });
    if (prev && prev.status !== 'done' && prev.planned_end && new Date(prev.planned_end) > earliest) earliest = new Date(prev.planned_end);
  }

  // 3)+4) hledání nejbližšího volného okna (pracoviště + lidé) v pracovní době
  const cfg = await loadShiftConfig();
  const prepMin = op.operation.preparation_time || 0;
  const runMin = operationMinutes(op.operation, Number(op.batch.quantity));
  const totalMin = prepMin + runMin;
  const personIds = [...new Set([op.assigned_person_id, ...(op.workers || []).map(w => w.person_id)].filter(Boolean))];
  const queueByWs = op.workstation_id ? await loadQueueByWorkstation(tx, op.batch_id, [op.workstation_id], false) : new Map();

  let candidate = nextShiftStart(earliest, cfg);
  let consumed = null, busyWho = null;
  for (let i = 0; i < 60; i++) {
    consumed = consumeShift(candidate, totalMin, cfg);
    const wsConflict = op.workstation_id ? findQueueConflictEnd(queueByWs, op.workstation_id, candidate, consumed.end) : null;
    const pc = await personsConflictEnd(tx, personIds, candidate, consumed.end, op.id);
    const pushTo = [wsConflict, pc && pc.end].filter(Boolean).sort((a, b) => b - a)[0];
    if (!pushTo) break;
    if (pc && pc.end && (!wsConflict || pc.end >= wsConflict)) busyWho = pc.who;
    candidate = nextShiftStart(new Date(pushTo), cfg);
  }
  const newStart = candidate, newEnd = consumed.end;
  const oldStart = new Date(op.planned_start);
  if (newStart.getTime() >= oldStart.getTime() - 60000) {
    return { ok: true, moved: false, reason: busyWho ? ('Dřívější termín není: ' + busyWho + ' nemá volno') : 'Dřívější volné okno není (pracoviště/lidé obsazení nebo čeká na předchozí operaci)', planned_start: op.planned_start, planned_end: op.planned_end };
  }

  await tx.batchOperation.update({ where: { id: op.id }, data: { planned_start: newStart, planned_end: newEnd } });
  // Hlavní operace posunuta dřív → navazující hlavní operace dávky se mohou posunout taky (přeplánuj dávku od konce této operace)
  return { ok: true, moved: true, from: op.planned_start, to_start: newStart, to_end: newEnd, operation: { id: op.id, name: op.operation.name, step: op.operation.step_number }, batch: op.batch.batch_number, people: personIds };
}

module.exports = { pullOperationEarlier };
