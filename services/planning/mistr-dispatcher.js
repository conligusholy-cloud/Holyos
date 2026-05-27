// =============================================================================
// HolyOS — Mistr dispatcher (Velín Fáze 5 — Krok E)
// =============================================================================
// Autonomní auto-přiřazení BatchOperation kolegům s aktivním Velín zařízením.
// Volá se z plánovače po scheduleBatch / scheduleAllActive.
//
// Princip: použijeme `scoreCandidate` z people-server (deterministický scoring
// podle skill + role + workload + speed_factor) **bez Anthropic round-tripu** —
// rychlý, idempotentní, žádné latency ani API cost. Anthropic přijde do hry,
// až když si admin chce s Mistrem popovídat v chatu (Krok D).
//
// Logika:
//   1) Pro každou BatchOperation v batchId, která nemá assigned_person_id:
//   2) Vypočítej skóre pro každého aktivního Velín-kolegu
//   3) Top 1 (pokud má skóre > MIN_SCORE) → přiřaď + pošli do Velína
//   4) Pokud nikdo dostatečně dobrý → ponech bez assignee, log do výsledku

const { prisma: defaultPrisma } = require('../../config/database');
const { scoreCandidate } = require('../../mcp-servers/people-server');
const { syncBatchOperationToVelin } = require('./velin-bridge');

// Minimální skóre, aby se kandidát automaticky přiřadil. Pod tímto prahem
// Mistr nepřiřadí a označí operaci jako "nezbyl vhodný kolega" — admin se
// rozhodne ručně.
const MIN_AUTO_ASSIGN_SCORE = 30;

/**
 * Autonomně přiřadí kolegy k unassigned BatchOperation v dané dávce.
 *
 * @param batchId — kterou dávku zpracovat
 * @param opts — { prisma?, dryRun? }
 * @returns { assigned: [{op_id, person_id, score, reasons}], skipped: [{op_id, reason}] }
 */
async function autoAssignBatch(batchId, opts = {}) {
  const prisma = opts.prisma || defaultPrisma;
  const dryRun = opts.dryRun === true;

  // 1) Najdi unassigned operace v dávce
  const ops = await prisma.batchOperation.findMany({
    where: {
      batch_id: batchId,
      assigned_person_id: null,
      status: { in: ['planned', 'released'] },
    },
    select: {
      id: true,
      planned_start: true,
      operation: { select: { id: true, name: true, description: true } },
      workstation: { select: { id: true, name: true } },
    },
  });

  if (ops.length === 0) {
    return { assigned: [], skipped: [], message: 'Žádné nepřiřazené operace v dávce' };
  }

  // 2) Načti všechny aktivní Velín-kolegy jednou (pro všechny operace)
  const people = await prisma.person.findMany({
    where: { active: true, velin_devices: { some: { active: true } } },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      role: { select: { name: true } },
      velin_skill_profile: {
        select: { skills: true, preferred_shift: true, speed_factor: true },
      },
    },
  });

  if (people.length === 0) {
    return {
      assigned: [],
      skipped: ops.map(o => ({ op_id: o.id, reason: 'Žádní kolegové s aktivním Velín zařízením' })),
    };
  }

  // 3) Předpočítej workload pro každého kolegu na dnešní den
  // (zjednodušení: workload měřený jen pro dnešek; pro delší horizont by se to
  // dalo rozšířit per-den, ale to bychom načítali zbytečně moc dat)
  const wlMap = await loadTodayWorkloadMap(prisma, people.map(p => p.id));

  const assigned = [];
  const skipped = [];

  // 4) Iteruj operace, vyhodnoť kandidáty
  for (const op of ops) {
    const scored = people.map(p => {
      const { score, reasons } = scoreCandidate(p, op.operation, wlMap);
      return { person_id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), score, reasons };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (!best || best.score < MIN_AUTO_ASSIGN_SCORE) {
      skipped.push({
        op_id: op.id,
        op_name: op.operation?.name || null,
        reason: best
          ? `Nejlepší kandidát ${best.name} má skóre jen ${best.score} (pod prahem ${MIN_AUTO_ASSIGN_SCORE})`
          : 'Žádní kandidáti',
        top: scored.slice(0, 3),
      });
      continue;
    }

    if (dryRun) {
      assigned.push({
        op_id: op.id,
        op_name: op.operation?.name || null,
        person_id: best.person_id,
        person_name: best.name,
        score: best.score,
        reasons: best.reasons,
        dry_run: true,
      });
      continue;
    }

    // 4a) Přiřaď + audit do note
    const reasonShort = best.reasons.slice(0, 3).join('; ').slice(0, 500);
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const noteAppend = `[${ts}] 🤖 Mistr: ${best.name} (skóre ${best.score}) — ${reasonShort}`;
    const opFull = await prisma.batchOperation.findUnique({
      where: { id: op.id },
      select: { note: true },
    });
    const newNote = opFull?.note ? `${opFull.note}\n${noteAppend}` : noteAppend;

    await prisma.batchOperation.update({
      where: { id: op.id },
      data: {
        assigned_person_id: best.person_id,
        note: newNote,
      },
    });

    // 4b) Pošli úkol do Velína (push notif kolegovi)
    let velinResult = null;
    try {
      velinResult = await syncBatchOperationToVelin(op.id);
    } catch (e) {
      console.warn(`[mistr-dispatcher] velin sync(${op.id}) selhal:`, e.message);
    }

    // 4c) Aktualizuj workload v paměti (kolega právě dostal úkol)
    const wl = wlMap[best.person_id] || { total_min: 0 };
    wl.total_min += 30; // hrubý odhad — přesný estimated_min bridge si dopočítá
    wlMap[best.person_id] = wl;

    assigned.push({
      op_id: op.id,
      op_name: op.operation?.name || null,
      person_id: best.person_id,
      person_name: best.name,
      score: best.score,
      reasons: best.reasons,
      velin_task_id: velinResult?.task?.id || null,
    });
  }

  return { assigned, skipped, total: ops.length };
}

/**
 * Bulk variant — pro každou batch po sobě.
 */
async function autoAssignAllUnassigned(opts = {}) {
  const prisma = opts.prisma || defaultPrisma;

  // Všechny dávky se status v [planned, released], které mají alespoň 1 unassigned op
  const batches = await prisma.productionBatch.findMany({
    where: {
      status: { in: ['planned', 'released'] },
      batch_operations: { some: { assigned_person_id: null } },
    },
    select: { id: true, batch_number: true },
  });

  const results = [];
  for (const b of batches) {
    const r = await autoAssignBatch(b.id, opts);
    results.push({ batch_id: b.id, batch_number: b.batch_number, ...r });
  }

  // Agregát
  const totalAssigned = results.reduce((sum, r) => sum + r.assigned.length, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped.length, 0);

  return {
    batches_processed: results.length,
    total_assigned: totalAssigned,
    total_skipped: totalSkipped,
    by_batch: results,
  };
}

// ─── Helper: workload map ───────────────────────────────────────────────────

async function loadTodayWorkloadMap(prisma, personIds) {
  if (!personIds || personIds.length === 0) return {};

  const tz = 'Europe/Prague';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const today = new Date(parts + 'T00:00:00Z');
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const tasks = await prisma.taskAssignment.findMany({
    where: {
      person_id: { in: personIds },
      daily_plan: { date: { gte: today, lt: tomorrow } },
      status: { in: ['proposed', 'accepted', 'in_progress'] },
    },
    select: { person_id: true, estimated_min: true },
  });

  const map = {};
  for (const pid of personIds) map[pid] = { total_min: 0 };
  for (const t of tasks) {
    if (!map[t.person_id]) map[t.person_id] = { total_min: 0 };
    map[t.person_id].total_min += t.estimated_min || 0;
  }
  return map;
}

module.exports = {
  autoAssignBatch,
  autoAssignAllUnassigned,
  MIN_AUTO_ASSIGN_SCORE,
};
