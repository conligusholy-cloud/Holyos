// =============================================================================
// HolyOS MCP Server — Tasks (Úkoly & Koordinace)
// =============================================================================

function getTasksTools() {
  return [
    {
      name: 'list_tasks',
      description: 'Seznam úkolů. Filtr podle stavu, přiřazené osoby, priority.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['new', 'in_progress', 'done', 'cancelled'], description: 'Stav úkolu' },
          assigned_to: { type: 'string', description: 'Jméno přiřazené osoby' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priorita' },
          limit: { type: 'number', description: 'Max výsledků', default: 20 },
        },
      },
    },
    {
      name: 'create_task',
      description: 'Vytvoří nový úkol s popisem, prioritou a volitelným přiřazením.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Název úkolu' },
          description: { type: 'string', description: 'Detailní popis' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priorita', default: 'normal' },
          assigned_to_id: { type: 'number', description: 'ID osoby, které se úkol přiřadí' },
          due_date: { type: 'string', description: 'Termín ve formátu YYYY-MM-DD' },
        },
        required: ['title'],
      },
    },
    {
      name: 'update_task_status',
      description: 'Změní stav úkolu (new → in_progress → done).',
      input_schema: {
        type: 'object',
        properties: {
          task_id: { type: 'number', description: 'ID úkolu' },
          status: { type: 'string', enum: ['new', 'in_progress', 'done', 'cancelled'], description: 'Nový stav' },
          note: { type: 'string', description: 'Poznámka ke změně stavu' },
        },
        required: ['task_id', 'status'],
      },
    },
  ];
}

async function executeTasksTool(toolName, params, prisma) {
  switch (toolName) {
    case 'list_tasks': {
      const where = {};
      if (params.status) where.status = params.status;
      if (params.priority) where.priority = params.priority;
      if (params.assigned_to) {
        where.assignee = {
          OR: [
            { first_name: { contains: params.assigned_to, mode: 'insensitive' } },
            { last_name: { contains: params.assigned_to, mode: 'insensitive' } },
          ],
        };
      }

      const tasks = await prisma.task.findMany({
        where,
        take: params.limit || 20,
        include: {
          assignee: { select: { first_name: true, last_name: true } },
          creator: { select: { first_name: true, last_name: true } },
        },
        orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
      });

      return {
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id, title: t.title, description: t.description,
          status: t.status, priority: t.priority,
          assignee: t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : null,
          creator: t.creator ? `${t.creator.first_name} ${t.creator.last_name}` : null,
          due_date: t.due_date, created_at: t.created_at,
        })),
      };
    }

    case 'create_task': {
      const task = await prisma.task.create({
        data: {
          title: params.title,
          description: params.description || null,
          priority: params.priority || 'normal',
          status: 'new',
          assignee_id: params.assigned_to_id || null,
          due_date: params.due_date ? new Date(params.due_date) : null,
        },
      });

      return {
        ok: true,
        message: `Úkol "${task.title}" vytvořen (ID: ${task.id})`,
        task: { id: task.id, title: task.title, status: task.status, priority: task.priority },
      };
    }

    case 'update_task_status': {
      const task = await prisma.task.update({
        where: { id: params.task_id },
        data: {
          status: params.status,
          ...(params.status === 'done' ? { completed_at: new Date() } : {}),
        },
      });

      return {
        ok: true,
        message: `Úkol "${task.title}" změněn na stav: ${params.status}`,
        task: { id: task.id, title: task.title, status: task.status },
      };
    }

    default:
      throw new Error(`Unknown tasks tool: ${toolName}`);
  }
}

module.exports = { getTasksTools, executeTasksTool };
