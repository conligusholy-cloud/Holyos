// =============================================================================
// HolyOS MCP Server — Planning (plánovač výroby prádlomatů)
// =============================================================================
//
// Vystavuje plánovací logiku jako MCP tools — agent může v chatu volat:
//   - list_batches        seznam výrobních dávek s filtry
//   - get_batch_detail    detail konkrétní dávky včetně operací
//   - create_batch        nová dávka (auto-generuje BatchOperation)
//   - generate_operations vygeneruje operace pro existující dávku
//   - release_batch       planned → released
//   - calculate_mrp       MRP analýza pro dávku
//   - create_bom_snapshot zamražení BOM produktu
//   - list_competencies   seznam kompetencí pro plánování

const { generateBatchOperationsForBatch } = require('../../services/planning/batch-operations');
const { computeMrpForBatch } = require('../../services/planning/mrp');
const { computePrePickForBatch } = require('../../services/planning/pre-pick');
const { computePurchaseReport } = require('../../services/planning/purchase-report');

function getPlanningTools() {
  return [
    {
      name: 'list_batches',
      description: 'Seznam výrobních dávek. Filtr na status, batch_type a produkt. Vrátí přehled s počtem operací.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['planned', 'released', 'in_progress', 'paused', 'done', 'cancelled'] },
          batch_type: { type: 'string', enum: ['main', 'feeder', 'subassembly'] },
          product_id: { type: 'number', description: 'Filtr na konkrétní produkt' },
          limit: { type: 'number', default: 30 },
        },
      },
    },
    {
      name: 'get_batch_detail',
      description: 'Detail konkrétní výrobní dávky — operace, jejich stavy, přiřazení, BOM snapshot.',
      input_schema: {
        type: 'object',
        properties: {
          batch_id: { type: 'number', description: 'ID dávky' },
        },
        required: ['batch_id'],
      },
    },
    {
      name: 'create_batch',
      description: 'Vytvoří novou výrobní dávku. Auto-generuje BatchOperation pro každou ProductOperation produktu.',
      input_schema: {
        type: 'object',
        properties: {
          product_id: { type: 'number' },
          quantity: { type: 'number', description: 'Počet kusů' },
          batch_type: { type: 'string', enum: ['main', 'feeder', 'subassembly'], default: 'main' },
          variant_key: { type: 'string', description: 'Variant key např. "ram:nerez|barva:bila"' },
          planned_start: { type: 'string', description: 'YYYY-MM-DD' },
          planned_end: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'number', default: 100, description: 'Nižší = přednost' },
          note: { type: 'string' },
          auto_generate_operations: { type: 'boolean', default: true },
        },
        required: ['product_id', 'quantity'],
      },
    },
    {
      name: 'generate_operations',
      description: 'Vygeneruje BatchOperation pro existující dávku z ProductOperation produktu. Idempotentní.',
      input_schema: {
        type: 'object',
        properties: {
          batch_id: { type: 'number' },
          initial_status: { type: 'string', enum: ['ready', 'pending'], default: 'ready' },
        },
        required: ['batch_id'],
      },
    },
    {
      name: 'release_batch',
      description: 'Vydá dávku do výroby (planned → released). Operace pak budou v kioscích vidět.',
      input_schema: {
        type: 'object',
        properties: {
          batch_id: { type: 'number' },
        },
        required: ['batch_id'],
      },
    },
    {
      name: 'calculate_mrp',
      description: 'Spočítá MRP analýzu pro dávku — co je na skladě, co chybí, kdy přijdou objednávky.',
      input_schema: {
        type: 'object',
        properties: {
          batch_id: { type: 'number' },
        },
        required: ['batch_id'],
      },
    },
    {
      name: 'create_bom_snapshot',
      description: 'Zamrazí BOM produktu jako BomSnapshot pro pozdější referenci v dávce.',
      input_schema: {
        type: 'object',
        properties: {
          product_id: { type: 'number' },
          variant_key: { type: 'string' },
          source: { type: 'string', enum: ['computed', 'factorify_pull', 'manual'], default: 'computed' },
          note: { type: 'string' },
        },
        required: ['product_id'],
      },
    },
    {
      name: 'list_competencies',
      description: 'Seznam kompetencí (dovedností) pro plánování úkolů přes kiosek.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'svarovna, montaz, elektro, kontrola, ...' },
          active: { type: 'boolean', default: true },
        },
      },
    },
    {
      name: 'compute_pre_pick',
      description: 'Pre-pick V1 — návrh transferů materiálu na vstupní lokace pracovišť pro konkrétní dávku. Vrátí seznam transferů per pracoviště se stavem (transfer_ok / on_location / shortage / no_source / no_target).',
      input_schema: {
        type: 'object',
        properties: {
          batch_id: { type: 'number' },
        },
        required: ['batch_id'],
      },
    },
    {
      name: 'purchase_report',
      description: 'Konsolidovaný nákupní report — materiály k objednání napříč všemi aktivními dávkami (planned/released/in_progress/paused). Group by supplier.',
      input_schema: {
        type: 'object',
        properties: {
          statuses: {
            type: 'array',
            items: { type: 'string', enum: ['planned', 'released', 'in_progress', 'paused', 'done', 'cancelled'] },
            description: 'Filtr na statusy dávek (default: aktivní).',
          },
        },
      },
    },
    {
      name: 'workstation_queue',
      description: 'Vytížení pracovišť — kolik BatchOperation čeká, je ready, in_progress, nebo bylo dnes hotovo. Per pracoviště + sumár.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'person_performance',
      description: 'Výkon pracovníka v daný den — kolik operací dokončil, kolik minut, průměr na operaci. Také rozpracované úkoly.',
      input_schema: {
        type: 'object',
        properties: {
          person_id: { type: 'number' },
          date: { type: 'string', description: 'YYYY-MM-DD, default dnes' },
        },
        required: ['person_id'],
      },
    },
  ];
}

async function executePlanningTool(toolName, params, prisma) {
  switch (toolName) {
    // ─── list_batches ────────────────────────────────────────────────────
    case 'list_batches': {
      const where = {};
      if (params.status) where.status = params.status;
      if (params.batch_type) where.batch_type = params.batch_type;
      if (params.product_id) where.product_id = params.product_id;

      const batches = await prisma.productionBatch.findMany({
        where,
        take: params.limit || 30,
        include: {
          product: { select: { code: true, name: true } },
          _count: { select: { batch_operations: true } },
        },
        orderBy: [{ priority: 'asc' }, { planned_start: 'asc' }],
      });

      return {
        count: batches.length,
        batches: batches.map(b => ({
          id: b.id,
          batch_number: b.batch_number,
          status: b.status,
          batch_type: b.batch_type,
          quantity: b.quantity,
          product: b.product ? `${b.product.code} ${b.product.name}` : null,
          operations: b._count.batch_operations,
          planned_start: b.planned_start,
          planned_end: b.planned_end,
          priority: b.priority,
        })),
      };
    }

    // ─── get_batch_detail ────────────────────────────────────────────────
    case 'get_batch_detail': {
      const batch = await prisma.productionBatch.findUnique({
        where: { id: params.batch_id },
        include: {
          product: { select: { code: true, name: true } },
          parent_batch: { select: { batch_number: true } },
          bom_snapshot: { select: { id: true, source: true, snapshot_at: true } },
          batch_operations: {
            include: {
              operation: { select: { name: true, step_number: true, duration: true } },
              workstation: { select: { name: true } },
              assigned_person: { select: { first_name: true, last_name: true } },
            },
            orderBy: { sequence: 'asc' },
          },
        },
      });
      if (!batch) throw new Error(`Dávka id=${params.batch_id} nenalezena`);

      return {
        id: batch.id,
        batch_number: batch.batch_number,
        status: batch.status,
        batch_type: batch.batch_type,
        quantity: batch.quantity,
        priority: batch.priority,
        product: batch.product ? `${batch.product.code} ${batch.product.name}` : null,
        parent_batch: batch.parent_batch?.batch_number || null,
        bom_snapshot: batch.bom_snapshot,
        planned_start: batch.planned_start,
        planned_end: batch.planned_end,
        actual_start: batch.actual_start,
        actual_end: batch.actual_end,
        note: batch.note,
        operations: batch.batch_operations.map(op => ({
          id: op.id,
          sequence: op.sequence,
          name: op.operation?.name,
          workstation: op.workstation?.name,
          status: op.status,
          assigned_to: op.assigned_person ? `${op.assigned_person.first_name} ${op.assigned_person.last_name}` : null,
          started_at: op.started_at,
          finished_at: op.finished_at,
          duration_minutes: op.duration_minutes,
        })),
      };
    }

    // ─── create_batch ────────────────────────────────────────────────────
    case 'create_batch': {
      // Generátor batch_number (kopie z routes/production.routes.js)
      const ref = params.planned_start ? new Date(params.planned_start) : new Date();
      const year = ref.getFullYear();
      const prefix = `${year}-`;
      const last = await prisma.productionBatch.findFirst({
        where: { batch_number: { startsWith: prefix } },
        orderBy: { batch_number: 'desc' },
        select: { batch_number: true },
      });
      let seq = 1;
      if (last) {
        const m = last.batch_number.match(/-(\d+)$/);
        if (m) seq = parseInt(m[1], 10) + 1;
      }
      const batch_number = prefix + String(seq).padStart(3, '0');

      const batch = await prisma.productionBatch.create({
        data: {
          batch_number,
          product_id: params.product_id,
          quantity: params.quantity,
          batch_type: params.batch_type || 'main',
          variant_key: params.variant_key || null,
          planned_start: params.planned_start ? new Date(params.planned_start) : null,
          planned_end: params.planned_end ? new Date(params.planned_end) : null,
          priority: params.priority || 100,
          note: params.note || null,
        },
        include: { product: { select: { code: true, name: true } } },
      });

      let opsResult = null;
      if (params.auto_generate_operations !== false) {
        opsResult = await generateBatchOperationsForBatch(batch.id);
      }

      return {
        id: batch.id,
        batch_number: batch.batch_number,
        status: batch.status,
        product: batch.product ? `${batch.product.code} ${batch.product.name}` : null,
        operations_generated: opsResult ? {
          created_count: opsResult.created_count,
          skipped: opsResult.skipped,
          warning: opsResult.warning,
        } : null,
      };
    }

    // ─── generate_operations ─────────────────────────────────────────────
    case 'generate_operations': {
      const result = await generateBatchOperationsForBatch(params.batch_id, {
        initialStatus: params.initial_status || 'ready',
      });
      return result;
    }

    // ─── release_batch ───────────────────────────────────────────────────
    case 'release_batch': {
      const existing = await prisma.productionBatch.findUnique({
        where: { id: params.batch_id }, select: { status: true, batch_number: true },
      });
      if (!existing) throw new Error(`Dávka id=${params.batch_id} nenalezena`);
      if (existing.status !== 'planned') {
        throw new Error(`Nelze vydat ze stavu '${existing.status}', musí být 'planned'`);
      }
      const updated = await prisma.productionBatch.update({
        where: { id: params.batch_id },
        data: { status: 'released' },
        select: { id: true, batch_number: true, status: true },
      });
      return updated;
    }

    // ─── calculate_mrp ───────────────────────────────────────────────────
    case 'calculate_mrp': {
      const result = await computeMrpForBatch(params.batch_id);
      // Zkrácený výstup pro AI — plný JSON je velký
      return {
        batch_number: result.batch.batch_number,
        product: result.batch.product ? `${result.batch.product.code} ${result.batch.product.name}` : null,
        quantity: result.batch.quantity,
        bom_source: result.bom_source,
        all_materials_ok: result.summary.all_materials_ok,
        items_count: result.summary.items_count,
        shortage_count: result.summary.shortage_count,
        items: result.items.map(it => ({
          material: it.material ? `${it.material.code} ${it.material.name}` : null,
          needed: it.needed,
          available: it.stock?.available,
          shortage: it.shortage,
          unit: it.unit,
          expected_delivery: it.expected_delivery,
          supplier: it.supplier?.name || null,
        })),
        po_proposals: result.po_proposals.map(p => ({
          material: p.material ? `${p.material.code} ${p.material.name}` : null,
          quantity_to_order: p.quantity_to_order,
          unit: p.unit,
          supplier: p.supplier?.name || null,
          expected_delivery: p.expected_delivery,
        })),
      };
    }

    // ─── create_bom_snapshot ─────────────────────────────────────────────
    case 'create_bom_snapshot': {
      const operations = await prisma.productOperation.findMany({
        where: { product_id: params.product_id },
        include: { materials: true },
        orderBy: { step_number: 'asc' },
      });
      if (operations.length === 0) {
        throw new Error('Produkt nemá žádné operace — BOM nelze sestavit');
      }

      const items = [];
      for (const op of operations) {
        for (const om of op.materials) {
          items.push({
            material_id: om.material_id,
            source_operation_id: op.id,
            quantity: om.quantity,
            unit: om.unit || 'ks',
            depth: 0,
          });
        }
      }

      const snap = await prisma.$transaction(async (tx) => {
        const s = await tx.bomSnapshot.create({
          data: {
            product_id: params.product_id,
            variant_key: params.variant_key || null,
            source: params.source || 'computed',
            note: params.note || null,
          },
        });
        if (items.length > 0) {
          await tx.bomSnapshotItem.createMany({
            data: items.map(it => ({ ...it, snapshot_id: s.id })),
          });
        }
        return s;
      });

      return {
        id: snap.id,
        product_id: snap.product_id,
        variant_key: snap.variant_key,
        source: snap.source,
        snapshot_at: snap.snapshot_at,
        items_count: items.length,
        operations_processed: operations.length,
      };
    }

    // ─── list_competencies ───────────────────────────────────────────────
    case 'list_competencies': {
      const where = {};
      if (params.category) where.category = params.category;
      if (params.active !== false) where.active = true;

      const items = await prisma.competency.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      });
      return {
        count: items.length,
        competencies: items.map(c => ({
          id: c.id, code: c.code, name: c.name,
          category: c.category, level_max: c.level_max,
        })),
      };
    }

    // ─── compute_pre_pick ────────────────────────────────────────────────
    case 'compute_pre_pick': {
      const result = await computePrePickForBatch(params.batch_id);
      // Zkrácený výstup pro AI
      return {
        batch_number: result.batch?.batch_number,
        product: result.batch?.product ? `${result.batch.product.code} ${result.batch.product.name}` : null,
        summary: result.summary,
        by_workstation: (result.by_workstation || []).map(g => ({
          workstation: g.workstation?.name || null,
          input_location: g.input_location ? `${g.input_location.code || ''} ${g.input_location.name}`.trim() : null,
          transfers: g.transfers.map(t => ({
            material: t.material ? `${t.material.code} ${t.material.name}` : null,
            needed: t.needed,
            unit: t.unit,
            source: t.source_location ? `${t.source_location.code || ''} ${t.source_location.name}`.trim() : null,
            available_at_source: t.available_at_source,
            action: t.action,
          })),
        })),
      };
    }

    // ─── purchase_report ─────────────────────────────────────────────────
    case 'purchase_report': {
      const result = await computePurchaseReport({ statuses: params.statuses });
      return {
        batches_processed: result.batches_processed,
        items_count: result.items_count,
        by_supplier: result.by_supplier.map(s => ({
          supplier: s.supplier?.name || '— bez dodavatele —',
          items_count: s.items_count,
          sample_lead_time_days: s.sample_lead_time_days,
        })),
        items: result.items.map(it => ({
          material: it.material ? `${it.material.code} ${it.material.name}` : null,
          total_shortage: it.total_shortage,
          unit: it.unit,
          supplier: it.supplier?.name || null,
          lead_time_days: it.lead_time_days,
          expected_delivery: it.expected_delivery,
          covers_batches: it.contributors.length,
        })),
      };
    }

    // ─── workstation_queue ───────────────────────────────────────────────
    case 'workstation_queue': {
      // Inline implementace — sdílíme s GET /workstation-queue endpointem
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const ops = await prisma.batchOperation.findMany({
        where: {
          OR: [
            { status: { in: ['pending', 'ready', 'in_progress'] } },
            { AND: [{ status: 'done' }, { finished_at: { gte: todayStart } }] },
          ],
        },
        select: { id: true, workstation_id: true, status: true,
          batch: { select: { quantity: true } },
          operation: { select: { duration: true, duration_unit: true } } },
      });
      const wsIds = Array.from(new Set(ops.map(o => o.workstation_id).filter(Boolean)));
      const wsAll = await prisma.workstation.findMany({
        where: wsIds.length > 0 ? { id: { in: wsIds } } : undefined,
        select: { id: true, name: true, code: true },
      });
      const wsMap = new Map(wsAll.map(w => [w.id, w]));
      const groups = new Map();
      function opMin(op) {
        const d = op.operation?.duration || 0;
        const u = op.operation?.duration_unit || 'MINUTE';
        const qty = op.batch?.quantity || 1;
        const perKs = u === 'HOUR' ? d * 60 : u === 'SECOND' ? d / 60 : d;
        return perKs * qty;
      }
      for (const o of ops) {
        const key = o.workstation_id || 'null';
        const cur = groups.get(key) || {
          workstation: o.workstation_id ? wsMap.get(o.workstation_id) : null,
          pending: 0, ready: 0, in_progress: 0, done_today: 0, planned_minutes: 0,
        };
        if (o.status === 'pending') { cur.pending++; cur.planned_minutes += opMin(o); }
        else if (o.status === 'ready') { cur.ready++; cur.planned_minutes += opMin(o); }
        else if (o.status === 'in_progress') cur.in_progress++;
        else if (o.status === 'done') cur.done_today++;
        groups.set(key, cur);
      }
      const result = Array.from(groups.values())
        .map(g => ({
          workstation: g.workstation?.name || null,
          queue_total: g.pending + g.ready,
          pending: g.pending, ready: g.ready,
          in_progress: g.in_progress, done_today: g.done_today,
          planned_hours: +(g.planned_minutes / 60).toFixed(1),
        }))
        .sort((a, b) => b.queue_total - a.queue_total);
      return { workstations_count: result.length, workstations: result };
    }

    // ─── person_performance ──────────────────────────────────────────────
    case 'person_performance': {
      const dateStr = params.date || new Date().toISOString().slice(0, 10);
      const dayStart = new Date(dateStr + 'T00:00:00');
      const dayEnd = new Date(dateStr + 'T23:59:59');

      const completed = await prisma.batchOperation.findMany({
        where: {
          assigned_person_id: params.person_id,
          finished_at: { gte: dayStart, lte: dayEnd },
          status: 'done',
        },
        include: {
          operation: { select: { name: true } },
          workstation: { select: { name: true } },
          batch: { select: { batch_number: true,
            product: { select: { code: true } } } },
        },
        orderBy: { finished_at: 'asc' },
      });
      const totalMinutes = completed.reduce((s, op) => s + (op.duration_minutes || 0), 0);
      return {
        person_id: params.person_id,
        date: dateStr,
        completed_count: completed.length,
        total_minutes: totalMinutes,
        total_hours: +(totalMinutes / 60).toFixed(2),
        avg_minutes: completed.length > 0 ? +(totalMinutes / completed.length).toFixed(1) : 0,
        operations: completed.map(op => ({
          batch: op.batch?.batch_number,
          product: op.batch?.product?.code,
          operation: op.operation?.name,
          workstation: op.workstation?.name,
          duration_minutes: op.duration_minutes,
          finished_at: op.finished_at,
        })),
      };
    }

    default:
      throw new Error(`Unknown Planning tool: ${toolName}`);
  }
}

module.exports = { getPlanningTools, executePlanningTool };
