// =============================================================================
// HolyOS MCP Server — People (Velín dispečer Mistr)
// =============================================================================
// Tools, které AI dispečer Mistr používá pro autonomní přiřazování úkolů z
// plánovače kolegům s aktivním Velín zařízením.
//
// Princip: člověk je v MCP modelu "skill/agent" se schopnostmi (skills),
// dostupností (workload + shift) a rychlostí (speed_factor). Mistr s tím
// pracuje stejně, jako by si vybíral mezi několika stroji.
//
// Klíčová data: Person + Role + PersonSkillProfile + DeviceRegistration +
// BatchOperation + TaskAssignment.

function getPeopleTools() {
  return [
    {
      name: 'list_velin_people',
      description:
        'Seznam kolegů s aktivním Velín zařízením. Pro každého: role, oddělení, skill profil ' +
        '(skills, preferred_shift, speed_factor). Tady AI vybírá kandidáty na přiřazení úkolů.',
      input_schema: {
        type: 'object',
        properties: {
          department: { type: 'string', description: 'Volitelný filtr podle oddělení' },
          role: { type: 'string', description: 'Volitelný filtr podle role (částečná shoda)' },
          required_skill_key: {
            type: 'string',
            description: 'Volitelný filtr — kdo umí konkrétní skill (např. "sewing")',
          },
        },
      },
    },
    {
      name: 'get_today_workload',
      description:
        'Vrátí dnešní pracovní zátěž — pro každého aktivního Velín-kolegu sumu plánovaných minut, ' +
        'rozdělenou podle statusu úkolu (proposed/accepted/in_progress/blocked/done). Pomáhá Mistrovi ' +
        'rozhodnout, kdo má kapacitu na nový úkol.',
      input_schema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Datum YYYY-MM-DD. Default = dnes (Europe/Prague).',
          },
          person_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Volitelný filtr na konkrétní lidi. Default = všichni s aktivním zařízením.',
          },
        },
      },
    },
    {
      name: 'list_unassigned_batch_operations',
      description:
        'BatchOperation, které ještě nemají assigned_person_id — kandidáti na auto-přiřazení Mistrem. ' +
        'Filtrované na nadcházející (planned_start v rozmezí now → now+horizon_days).',
      input_schema: {
        type: 'object',
        properties: {
          horizon_days: {
            type: 'number',
            description: 'Kolik dní dopředu hledat. Default 14.',
          },
          batch_id: {
            type: 'number',
            description: 'Volitelně omezit na jednu dávku.',
          },
        },
      },
    },
    {
      name: 'find_best_person_for_task',
      description:
        'Pro konkrétní BatchOperation najde TOP 3 kandidáty seřazené podle skóre. Skóre kombinuje: ' +
        'shoda role/skill s názvem operace, volná kapacita dnes (méně minut = vyšší skóre), speed_factor. ' +
        'Vrací každého s rozpisem důvodů.',
      input_schema: {
        type: 'object',
        properties: {
          batch_operation_id: { type: 'number', description: 'ID BatchOperation pro přiřazení.' },
          top_n: { type: 'number', description: 'Kolik kandidátů vrátit. Default 3.' },
        },
        required: ['batch_operation_id'],
      },
    },
    {
      name: 'propose_assignment_to_velin',
      description:
        'AUTONOMNÍ AKCE — přiřadí kolegu k BatchOperation a okamžitě pošle úkol do Velína (TaskAssignment + push notif). ' +
        'Idempotentní: pokud už BatchOperation má jiného assignee, přepíše ho (loguj reason). ' +
        'Mistr to volá až po find_best_person_for_task.',
      input_schema: {
        type: 'object',
        properties: {
          batch_operation_id: { type: 'number', description: 'BatchOperation, kterou přiřadit.' },
          person_id: { type: 'number', description: 'Komu přiřadit.' },
          reason: {
            type: 'string',
            description: 'Krátký důvod (max 500 znaků) — uloží se do BatchOperation.note a do auditu.',
          },
        },
        required: ['batch_operation_id', 'person_id'],
      },
    },
  ];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Pražský den jako Date(UTC midnight) — pro filtr na "dnes".
function startOfDay(input) {
  const tz = 'Europe/Prague';
  const d = input ? new Date(input) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return new Date(parts + 'T00:00:00Z');
}

function endOfDay(input) {
  const start = startOfDay(input);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

// Skóre kandidáta na úkol. Vrací { score, reasons[] }.
function scoreCandidate(person, operation, workloadByPerson) {
  const reasons = [];
  let score = 0;

  const opText = `${operation?.name || ''} ${operation?.description || ''}`.toLowerCase();
  const roleName = (person.role?.name || '').toLowerCase();
  const skills = Array.isArray(person.velin_skill_profile?.skills)
    ? person.velin_skill_profile.skills
    : [];

  // 1) Role match — pokud role obsahuje keyword z operace
  if (roleName && opText) {
    const roleWords = roleName.split(/\s+/).filter(w => w.length > 3);
    const matched = roleWords.filter(w => opText.includes(w));
    if (matched.length > 0) {
      score += 30 * matched.length;
      reasons.push(`role "${person.role.name}" odpovídá operaci`);
    }
  }

  // 2) Skill match — JSON skill keys vs text operace
  let skillBonus = 0;
  for (const s of skills) {
    if (!s.key) continue;
    if (opText.includes(String(s.key).toLowerCase())) {
      const lvl = Number(s.level) || 1;
      skillBonus += 20 + lvl * 5; // level 1=25, 5=45
      reasons.push(`umí "${s.key}" (úroveň ${lvl})`);
    }
  }
  score += skillBonus;

  // 3) Workload — méně minut dnes = vyšší skóre (kapacita 480 min = celý den)
  const wl = workloadByPerson[person.id] || { total_min: 0 };
  const freeMin = Math.max(0, 480 - wl.total_min);
  const workloadScore = Math.min(40, freeMin / 12); // max 40 bodů
  score += workloadScore;
  if (wl.total_min === 0) {
    reasons.push('volný den (žádné úkoly)');
  } else if (wl.total_min < 240) {
    reasons.push(`má jen ${wl.total_min} min úkolů (cca polovina dne)`);
  } else if (wl.total_min < 420) {
    reasons.push(`má ${wl.total_min} min úkolů (cca plný den)`);
  } else {
    reasons.push(`má ${wl.total_min} min úkolů (přetížený)`);
  }

  // 4) Speed factor — rychlejší kolegové dostanou bonus
  const sf = Number(person.velin_skill_profile?.speed_factor) || 1.0;
  if (sf > 1.05) {
    score += 5 * (sf - 1.0);
    reasons.push(`rychlejší o ${Math.round((sf - 1) * 100)} %`);
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

// ─── Executor ───────────────────────────────────────────────────────────────

async function executePeopleTool(toolName, params, prisma) {
  switch (toolName) {
    case 'list_velin_people':
      return await listVelinPeople(params || {}, prisma);
    case 'get_today_workload':
      return await getTodayWorkload(params || {}, prisma);
    case 'list_unassigned_batch_operations':
      return await listUnassignedBatchOperations(params || {}, prisma);
    case 'find_best_person_for_task':
      return await findBestPersonForTask(params || {}, prisma);
    case 'propose_assignment_to_velin':
      return await proposeAssignmentToVelin(params || {}, prisma);
    default:
      throw new Error(`Neznámý people tool: ${toolName}`);
  }
}

// ─── Implementations ────────────────────────────────────────────────────────

async function listVelinPeople(params, prisma) {
  const where = {
    active: true,
    velin_devices: { some: { active: true } },
  };
  if (params.department) {
    where.department = { name: { contains: params.department, mode: 'insensitive' } };
  }
  if (params.role) {
    where.role = { name: { contains: params.role, mode: 'insensitive' } };
  }

  const people = await prisma.person.findMany({
    where,
    select: {
      id: true,
      first_name: true,
      last_name: true,
      role: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      velin_skill_profile: {
        select: { skills: true, preferred_shift: true, speed_factor: true, notes: true },
      },
    },
    orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
  });

  let filtered = people;
  if (params.required_skill_key) {
    const key = String(params.required_skill_key).toLowerCase();
    filtered = people.filter(p => {
      const skills = Array.isArray(p.velin_skill_profile?.skills) ? p.velin_skill_profile.skills : [];
      return skills.some(s => String(s.key || '').toLowerCase() === key);
    });
  }

  return {
    total: filtered.length,
    people: filtered.map(p => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      role: p.role?.name || null,
      department: p.department?.name || null,
      skills: p.velin_skill_profile?.skills || [],
      preferred_shift: p.velin_skill_profile?.preferred_shift || null,
      speed_factor: p.velin_skill_profile?.speed_factor || 1.0,
    })),
  };
}

async function getTodayWorkload(params, prisma) {
  const day = params.date ? startOfDay(params.date) : startOfDay();
  const dayEnd = endOfDay(day);

  // Lidé s aktivním zařízením (nebo explicitní seznam)
  const peopleWhere = { active: true };
  if (Array.isArray(params.person_ids) && params.person_ids.length > 0) {
    peopleWhere.id = { in: params.person_ids };
  } else {
    peopleWhere.velin_devices = { some: { active: true } };
  }
  const people = await prisma.person.findMany({
    where: peopleWhere,
    select: { id: true, first_name: true, last_name: true, role: { select: { name: true } } },
    orderBy: [{ last_name: 'asc' }],
  });

  // Všechny TaskAssignment pro tyto lidi v daný den (přes DailyPlan.date)
  const tasks = await prisma.taskAssignment.findMany({
    where: {
      person_id: { in: people.map(p => p.id) },
      daily_plan: { date: { gte: day, lt: dayEnd } },
    },
    select: { person_id: true, status: true, estimated_min: true },
  });

  const aggByPerson = {};
  for (const p of people) {
    aggByPerson[p.id] = {
      person_id: p.id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      role: p.role?.name || null,
      total_min: 0,
      proposed_min: 0,
      accepted_min: 0,
      in_progress_min: 0,
      blocked_count: 0,
      done_min: 0,
      task_count: 0,
    };
  }
  for (const t of tasks) {
    const a = aggByPerson[t.person_id];
    if (!a) continue;
    const m = t.estimated_min || 0;
    a.task_count++;
    a.total_min += m;
    if (t.status === 'proposed') a.proposed_min += m;
    else if (t.status === 'accepted') a.accepted_min += m;
    else if (t.status === 'in_progress') a.in_progress_min += m;
    else if (t.status === 'blocked') a.blocked_count++;
    else if (t.status === 'done') a.done_min += m;
  }

  return {
    date: day.toISOString().slice(0, 10),
    people: Object.values(aggByPerson).sort((a, b) => a.total_min - b.total_min),
  };
}

async function listUnassignedBatchOperations(params, prisma) {
  const horizonDays = Number(params.horizon_days) || 14;
  const horizon = new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000);

  const where = {
    assigned_person_id: null,
    status: { in: ['planned', 'released', 'in_progress'] },
    OR: [
      { planned_start: { lte: horizon } },
      { planned_start: null }, // i nezaplánované — Mistr je vidí
    ],
  };
  if (params.batch_id) where.batch_id = Number(params.batch_id);

  const ops = await prisma.batchOperation.findMany({
    where,
    take: 200,
    orderBy: [{ planned_start: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      status: true,
      planned_start: true,
      planned_end: true,
      operation: { select: { id: true, name: true, description: true } },
      workstation: { select: { id: true, name: true } },
      batch: {
        select: {
          id: true,
          batch_number: true,
          quantity: true,
          product: { select: { name: true, code: true } },
        },
      },
    },
  });

  return {
    horizon_days: horizonDays,
    count: ops.length,
    operations: ops.map(op => ({
      batch_operation_id: op.id,
      status: op.status,
      planned_start: op.planned_start,
      planned_end: op.planned_end,
      operation_name: op.operation?.name || null,
      operation_description: op.operation?.description || null,
      workstation_name: op.workstation?.name || null,
      batch_number: op.batch?.batch_number || null,
      product_name: op.batch?.product?.name || null,
      quantity: op.batch?.quantity || null,
    })),
  };
}

async function findBestPersonForTask(params, prisma) {
  const opId = Number(params.batch_operation_id);
  if (!Number.isFinite(opId)) throw new Error('batch_operation_id je povinné');
  const topN = Math.max(1, Math.min(10, Number(params.top_n) || 3));

  // Najdi operaci
  const op = await prisma.batchOperation.findUnique({
    where: { id: opId },
    select: {
      id: true,
      planned_start: true,
      operation: { select: { name: true, description: true } },
      workstation: { select: { name: true } },
    },
  });
  if (!op) throw new Error(`BatchOperation ${opId} nenalezena`);

  // Všichni aktivní Velín-kolegové
  const people = await prisma.person.findMany({
    where: { active: true, velin_devices: { some: { active: true } } },
    select: {
      id: true, first_name: true, last_name: true,
      role: { select: { name: true } },
      velin_skill_profile: {
        select: { skills: true, preferred_shift: true, speed_factor: true },
      },
    },
  });

  // Workload na den operace (nebo dnes)
  const targetDate = op.planned_start || new Date();
  const wlRes = await getTodayWorkload({ date: targetDate.toISOString() }, prisma);
  const wlMap = {};
  for (const w of wlRes.people) wlMap[w.person_id] = w;

  // Score everyone
  const scored = people.map(p => {
    const { score, reasons } = scoreCandidate(p, op.operation, wlMap);
    return {
      person_id: p.id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      role: p.role?.name || null,
      score,
      reasons,
    };
  });
  scored.sort((a, b) => b.score - a.score);

  return {
    batch_operation_id: opId,
    operation_name: op.operation?.name || null,
    workstation_name: op.workstation?.name || null,
    planned_date: targetDate.toISOString().slice(0, 10),
    candidates: scored.slice(0, topN),
  };
}

async function proposeAssignmentToVelin(params, prisma) {
  const opId = Number(params.batch_operation_id);
  const personId = Number(params.person_id);
  if (!Number.isFinite(opId) || !Number.isFinite(personId)) {
    throw new Error('batch_operation_id a person_id jsou povinné');
  }
  const reason = (params.reason || 'auto-přiřazeno Mistrem').slice(0, 500);

  // 1) Nastav assignee + audit do note
  const op = await prisma.batchOperation.findUnique({
    where: { id: opId },
    select: { id: true, assigned_person_id: true, note: true, planned_start: true },
  });
  if (!op) throw new Error(`BatchOperation ${opId} nenalezena`);

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const oldAssignee = op.assigned_person_id;
  const noteAppend = `[${ts}] 🤖 Mistr: ${reason}`;
  const newNote = op.note ? `${op.note}\n${noteAppend}` : noteAppend;

  await prisma.batchOperation.update({
    where: { id: opId },
    data: {
      assigned_person_id: personId,
      note: newNote,
      // pokud chybí planned_start, nastav teď (Mistr přiřazuje "od teď")
      planned_start: op.planned_start || new Date(),
    },
  });

  // 2) Pošli do Velína přes bridge
  let velinResult = null;
  try {
    const { syncBatchOperationToVelin } = require('../../services/planning/velin-bridge');
    velinResult = await syncBatchOperationToVelin(opId, { source: 'ai_dispatcher' });
  } catch (e) {
    console.warn('[people-server] velin-bridge selhal:', e.message);
  }

  return {
    batch_operation_id: opId,
    person_id: personId,
    previous_assignee: oldAssignee,
    reason_logged: reason,
    velin_task_id: velinResult?.task?.id || null,
    velin_created: velinResult?.created || false,
  };
}

module.exports = {
  getPeopleTools,
  executePeopleTool,
  // Pro hook v plánovači (Krok E) — vystavený scoring bez Anthropic round-tripu.
  scoreCandidate,
  startOfDay,
};
