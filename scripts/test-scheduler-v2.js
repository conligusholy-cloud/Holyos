#!/usr/bin/env node
// =============================================================================
// HolyOS — Plánovač V2 standalone test (žádná DB závislost)
// =============================================================================
// Testuje jen čistou logiku shift-calendar.js a scheduler.js přes mock Prisma.
// Spuštění: TZ=Europe/Prague node scripts/test-scheduler-v2.js
// =============================================================================

const path = require('path');
const SCHEDULER_PATH = path.join(__dirname, '..', 'services', 'planning', 'scheduler.js');
const SHIFT_PATH = path.join(__dirname, '..', 'services', 'planning', 'shift-calendar.js');

// Stub config/database — testy používají mock prisma, ale require chain v scheduler.js
// instancuje skutečný PrismaClient (a jeho beforeExit hook hodí Linux binary error
// na Windows). Stub to vyřeší.
require.cache[require.resolve(path.join(__dirname, '..', 'config', 'database.js'))] = {
  exports: { prisma: { /* nepoužito — testy mají vlastní mock */ } },
};

// Suppress Prisma init errors po dokončení testů (irrelevantní pro RCCP logiku)
process.on('unhandledRejection', (err) => {
  if (err && /PrismaClient|Query Engine/.test(String(err))) return;
  console.error('Unhandled:', err);
  process.exit(1);
});

// Nastav env PŘED načtením modulů
process.env.SCHEDULER_SHIFT_START = '05:30';
process.env.SCHEDULER_SHIFT_END = '14:00';
process.env.SCHEDULER_WORK_DAYS = '1,2,3,4,5';

// Mock prisma — minimalist DSL pro scheduler testy
function makeMockPrisma(state) {
  return {
    productionBatch: {
      findUnique: async ({ where, select }) => state.batches.find(b => b.id === where.id) || null,
      update: async ({ where, data }) => {
        const b = state.batches.find(b => b.id === where.id);
        if (b) Object.assign(b, data);
        return b;
      },
      findMany: async ({ where, orderBy }) => {
        let res = state.batches.filter(b => where.status.in.includes(b.status));
        // simple sort by priority desc
        res.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return res;
      },
    },
    batchOperation: {
      findMany: async ({ where }) => {
        let res = state.operations.filter(o => {
          if (where.workstation_id && !where.workstation_id.in.includes(o.workstation_id)) return false;
          if (where.batch_id && where.batch_id.not === o.batch_id) return false;
          if (o.planned_start == null || o.planned_end == null) return false;
          const b = state.batches.find(bb => bb.id === o.batch_id);
          if (!b || !where.batch.status.in.includes(b.status)) return false;
          if (where.status.notIn.includes(o.status)) return false;
          return true;
        });
        return res;
      },
      update: async ({ where, data }) => {
        const o = state.operations.find(o => o.id === where.id);
        if (o) Object.assign(o, data);
        return o;
      },
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (fn) => {
      // pass through — same prisma instance
      return await fn(state.prisma);
    },
    // Tabulky pro resource assignment — defaultně prázdné, testy mohou injectovat
    operationRequiredCompetency: {
      findMany: async ({ where }) => {
        const opIds = where?.operation_id?.in || [];
        return (state.required || []).filter(r => opIds.includes(r.operation_id));
      },
    },
    workerCompetency: {
      findMany: async ({ where }) => {
        const compIds = where?.competency_id?.in || [];
        return (state.workerComps || [])
          .filter(w => compIds.includes(w.competency_id))
          .map(w => ({
            competency_id: w.competency_id,
            level: w.level,
            person: { id: w.person_id, first_name: w.first_name, last_name: w.last_name },
          }));
      },
    },
    workstationWorker: {
      findMany: async ({ where }) => {
        const wsIds = where?.workstation_id?.in || [];
        return (state.wsWorkers || [])
          .filter(w => wsIds.includes(w.workstation_id))
          .sort((a, b) => (b.is_primary === a.is_primary ? 0 : b.is_primary ? 1 : -1))
          .map(w => ({
            workstation_id: w.workstation_id,
            is_primary: w.is_primary,
            person: { id: w.person_id, first_name: w.first_name, last_name: w.last_name },
          }));
      },
    },
  };
}

// ─── Test framework ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log(`  ✓ ${name}`); },
    (e) => { failed++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name}\n    ${e.message}`); }
  );
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'assertEq'}: expected ${b}, got ${a}`);
}
function assertGte(a, b, msg) {
  if (a < b) throw new Error(`${msg || 'assertGte'}: expected ${a} >= ${b}`);
}

// ─── Shift-calendar testy ───────────────────────────────────────────────────
const { getShiftConfig, nextShiftStart, consumeShift, isInShift, isoDow } = require(SHIFT_PATH);

async function shiftTests() {
  console.log('\n[shift-calendar]');
  await test('config loads from env', () => {
    const cfg = getShiftConfig();
    assertEq(cfg.enabled, true);
    assertEq(cfg.start, '05:30');
    assertEq(cfg.end, '14:00');
  });

  await test('isInShift true mid-shift Po 10:00', () => {
    // 2026-05-18 (Po) 10:00 lokálního času
    const d = new Date(2026, 4, 18, 10, 0); // měsíc 0-indexed
    assertEq(isoDow(d), 1);
    assertEq(isInShift(d, getShiftConfig()), true);
  });

  await test('isInShift false sobota 10:00', () => {
    const d = new Date(2026, 4, 23, 10, 0); // sobota
    assertEq(isoDow(d), 6);
    assertEq(isInShift(d, getShiftConfig()), false);
  });

  await test('isInShift false po-15:00 (po shift end)', () => {
    const d = new Date(2026, 4, 18, 15, 0); // Po 15:00
    assertEq(isInShift(d, getShiftConfig()), false);
  });

  await test('nextShiftStart skips weekend So 20:00 → Po 05:30', () => {
    const d = new Date(2026, 4, 23, 20, 0); // sobota 20:00
    const next = nextShiftStart(d, getShiftConfig());
    assertEq(isoDow(next), 1, 'should be Monday');
    assertEq(next.getHours(), 5);
    assertEq(next.getMinutes(), 30);
  });

  await test('consumeShift 60 min v 06:00 Po → 07:00 Po (žádné čekání)', () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const r = consumeShift(start, 60, getShiftConfig());
    assertEq(r.end.getHours(), 7);
    assertEq(r.end.getMinutes(), 0);
    assertEq(r.wait_minutes, 0);
  });

  await test('consumeShift 600 min od 12:00 Po → přetéká do Út', () => {
    // 600 min = 10 h. Shift Po končí ve 14:00 (2h k dispozici).
    // Zbývá 8 h. Další shift Út 05:30 → 13:30.
    const start = new Date(2026, 4, 18, 12, 0);
    const r = consumeShift(start, 600, getShiftConfig());
    // End by mělo být Út 13:30
    assertEq(r.end.getDay(), 2, 'tuesday'); // JS 2=Tue
    assertEq(r.end.getHours(), 13);
    assertEq(r.end.getMinutes(), 30);
    assertGte(r.wait_minutes, 900, 'wait should include overnight'); // 14:00 Po - 05:30 Út = 15.5 h = 930 min
  });

  await test('consumeShift přes víkend Pá 13:00 → 90 min → spadne do Po', () => {
    const start = new Date(2026, 4, 22, 13, 0); // Pá 13:00 (jen 60 min do konce shiftu)
    const r = consumeShift(start, 90, getShiftConfig());
    // 60 min se spotřebuje v Pá (13-14), 30 min v Po (05:30-06:00)
    assertEq(r.end.getDay(), 1, 'monday'); // Po
    assertEq(r.end.getHours(), 6);
    assertEq(r.end.getMinutes(), 0);
  });
}

// ─── Scheduler testy ────────────────────────────────────────────────────────
const { scheduleBatch } = require(SCHEDULER_PATH);

function makeBatchState(batchId, ops, opts = {}) {
  const state = {
    batches: [{
      id: batchId,
      batch_number: opts.batch_number || `T-${batchId}`,
      quantity: opts.quantity || 1,
      planned_start: opts.planned_start || null,
      status: opts.status || 'planned',
      priority: opts.priority || 100,
      planned_end: null,
      batch_operations: ops,
      slot_assignments: opts.slot_assignments || [],
    }],
    operations: ops.map(o => ({ ...o, batch_id: batchId })),
  };
  state.prisma = makeMockPrisma(state);
  return state;
}

async function schedulerTests() {
  console.log('\n[scheduler]');

  await test('1 operace 60 min od Po 06:00 → end Po 07:00, 0 wait', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(1, [
      { id: 101, sequence: 1, status: 'ready', workstation_id: 10,
        operation: { duration: 60, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    const r = await scheduleBatch(1, { tx: state.prisma });
    assertEq(r.operations_scheduled, 1);
    assertEq(r.work_minutes, 60);
    assertEq(r.wait_minutes, 0);
    const op = state.operations.find(o => o.id === 101);
    assertEq(op.planned_end.getHours(), 7);
  });

  await test('Operace přes konec shiftu → split do dalšího dne, idle_pct > 0', async () => {
    const start = new Date(2026, 4, 18, 12, 0); // Po 12:00
    const state = makeBatchState(2, [
      { id: 201, sequence: 1, status: 'ready', workstation_id: 10,
        operation: { duration: 600, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    const r = await scheduleBatch(2, { tx: state.prisma });
    assertGte(r.idle_pct, 50, 'idle_pct should be > 50% (overnight gap dominant)');
  });

  await test('Setup time se přičítá k duration', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(3, [
      { id: 301, sequence: 1, status: 'ready', workstation_id: 10,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 15 } },
    ], { planned_start: start });
    const r = await scheduleBatch(3, { tx: state.prisma });
    assertEq(r.work_minutes, 45, 'work_minutes = setup 15 + run 30');
  });

  await test('Operace bez workstation_id → warning, ale naplánovaná', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(4, [
      { id: 401, sequence: 1, status: 'ready', workstation_id: null,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    const r = await scheduleBatch(4, { tx: state.prisma });
    assertEq(r.operations_scheduled, 1);
    assertEq(r.op_warnings.length, 1);
    assertEq(r.op_warnings[0].warnings[0], 'no_workstation_assigned');
  });

  await test('Operace skip done/cancelled — neaktualizuje časy', async () => {
    const oldDate = new Date(2020, 0, 1);
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(5, [
      { id: 501, sequence: 1, status: 'done', workstation_id: 10,
        planned_start: oldDate, planned_end: oldDate,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 0 } },
      { id: 502, sequence: 2, status: 'ready', workstation_id: 10,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    const r = await scheduleBatch(5, { tx: state.prisma });
    assertEq(r.operations_scheduled, 1);
    const done = state.operations.find(o => o.id === 501);
    assertEq(done.planned_start.getTime(), oldDate.getTime(), 'done op untouched');
  });

  await test('Sériové operace v dávce — 2 op po 60 min od 06:00 → konec 08:00', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(6, [
      { id: 601, sequence: 1, status: 'ready', workstation_id: 10,
        operation: { duration: 60, duration_unit: 'MINUTE', preparation_time: 0 } },
      { id: 602, sequence: 2, status: 'ready', workstation_id: 11,
        operation: { duration: 60, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    const r = await scheduleBatch(6, { tx: state.prisma });
    assertEq(r.operations_scheduled, 2);
    const op2 = state.operations.find(o => o.id === 602);
    assertEq(op2.planned_end.getHours(), 8);
  });
}


async function assignmentTests() {
  console.log('\n[assignment]');

  await test('Fallback na WorkstationWorker.is_primary', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(7, [
      { id: 701, operation_id: 7001, sequence: 1, status: 'ready', workstation_id: 10,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    state.required = []; // žádné required competencies
    state.workerComps = [];
    state.wsWorkers = [
      { workstation_id: 10, person_id: 99, is_primary: true, first_name: 'Karel', last_name: 'Novák' },
      { workstation_id: 10, person_id: 88, is_primary: false, first_name: 'Anna', last_name: 'Bednárová' },
    ];
    const r = await scheduleBatch(7, { tx: state.prisma });
    const op = state.operations.find(o => o.id === 701);
    assertEq(op.assigned_person_id, 99, 'primary worker should be picked');
    assertEq(r.assignees_assigned, 1);
  });

  await test('Required competency — vyřadí ne-kvalifikované', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(8, [
      { id: 801, operation_id: 8001, sequence: 1, status: 'ready', workstation_id: 10,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    state.required = [{ operation_id: 8001, competency_id: 555, min_level: 2 }];
    state.workerComps = [
      { competency_id: 555, level: 1, person_id: 88, first_name: 'Anna', last_name: 'Bednárová' }, // nestačí
      { competency_id: 555, level: 3, person_id: 99, first_name: 'Karel', last_name: 'Novák' },   // OK
    ];
    state.wsWorkers = [];
    const r = await scheduleBatch(8, { tx: state.prisma });
    const op = state.operations.find(o => o.id === 801);
    assertEq(op.assigned_person_id, 99, 'should pick Karel (level 3 ≥ 2)');
  });

  await test('Žádný kandidát → warning no_assignee_found', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(9, [
      { id: 901, operation_id: 9001, sequence: 1, status: 'ready', workstation_id: 99,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    state.required = [];
    state.workerComps = [];
    state.wsWorkers = []; // WS 99 nemá nikoho
    const r = await scheduleBatch(9, { tx: state.prisma });
    const allWarnings = r.op_warnings.flatMap(w => w.warnings);
    if (!allWarnings.includes('no_assignee_found')) throw new Error('expected no_assignee_found warning');
  });

  await test('Respektuje existující assigned_person_id (manuální volba)', async () => {
    const start = new Date(2026, 4, 18, 6, 0);
    const state = makeBatchState(10, [
      { id: 1001, operation_id: 10001, sequence: 1, status: 'ready', workstation_id: 10,
        assigned_person_id: 77,
        operation: { duration: 30, duration_unit: 'MINUTE', preparation_time: 0 } },
    ], { planned_start: start });
    state.required = [];
    state.workerComps = [];
    state.wsWorkers = [{ workstation_id: 10, person_id: 99, is_primary: true, first_name: 'Karel', last_name: 'Novák' }];
    await scheduleBatch(10, { tx: state.prisma });
    const op = state.operations.find(o => o.id === 1001);
    assertEq(op.assigned_person_id, 77, 'manual assignment must not be overwritten');
  });
}

// ─── Run ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (process.env.TZ !== 'Europe/Prague') {
      console.warn(`⚠ TZ=${process.env.TZ || '(unset)'}. Doporučeno TZ=Europe/Prague pro deterministické výsledky.`);
    }
    await shiftTests();
    await schedulerTests();
    await assignmentTests();
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Výsledek: ${passed} PASS, ${failed} FAIL`);
    if (failed > 0) {
      console.log('\nFailures:');
      failures.forEach(f => console.log(`  • ${f.name}\n    ${f.error}`));
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error('FATAL:', e);
    process.exit(1);
  }
})();
