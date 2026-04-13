// =============================================================================
// HolyOS MCP Server — HR (Lidé & Docházka)
// =============================================================================

function getHrTools() {
  return [
    {
      name: 'list_employees',
      description: 'Seznam zaměstnanců. Filtr podle oddělení, pozice, aktivní/neaktivní.',
      input_schema: {
        type: 'object',
        properties: {
          department: { type: 'string', description: 'Filtr podle oddělení' },
          role: { type: 'string', description: 'Filtr podle pozice' },
          active: { type: 'boolean', description: 'Pouze aktivní', default: true },
          limit: { type: 'number', description: 'Max výsledků', default: 50 },
        },
      },
    },
    {
      name: 'check_attendance',
      description: 'Kontrola dnešní docházky. Kdo je přítomen, kdo chybí.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Datum ve formátu YYYY-MM-DD (default: dnes)' },
        },
      },
    },
    {
      name: 'list_leave_requests',
      description: 'Seznam žádostí o dovolenou/volno. Filtr podle stavu.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'], description: 'Stav žádosti' },
          limit: { type: 'number', description: 'Max výsledků', default: 20 },
        },
      },
    },
  ];
}

async function executeHrTool(toolName, params, prisma) {
  switch (toolName) {
    case 'list_employees': {
      const where = {};
      if (params.active !== false) where.active = true;
      if (params.department) where.department = { name: { contains: params.department, mode: 'insensitive' } };
      if (params.role) where.position = { contains: params.role, mode: 'insensitive' };

      const people = await prisma.person.findMany({
        where,
        take: params.limit || 50,
        include: { department: { select: { name: true } } },
        orderBy: { last_name: 'asc' },
      });

      return {
        count: people.length,
        employees: people.map(p => ({
          id: p.id, first_name: p.first_name, last_name: p.last_name,
          position: p.position, department: p.department?.name || null,
          email: p.email, phone: p.phone, active: p.active,
        })),
      };
    }

    case 'check_attendance': {
      const date = params.date ? new Date(params.date) : new Date();
      const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

      const [records, totalActive] = await Promise.all([
        prisma.attendance.findMany({
          where: { date: { gte: dayStart, lte: dayEnd } },
          include: { person: { select: { first_name: true, last_name: true, position: true } } },
        }),
        prisma.person.count({ where: { active: true } }),
      ]);

      const present = records.filter(r => r.check_in && !r.check_out);
      const completed = records.filter(r => r.check_in && r.check_out);

      return {
        date: dayStart.toISOString().split('T')[0],
        total_active: totalActive,
        present: present.length + completed.length,
        missing: totalActive - (present.length + completed.length),
        records: records.map(r => ({
          person: `${r.person.first_name} ${r.person.last_name}`,
          position: r.person.position,
          check_in: r.check_in, check_out: r.check_out,
          status: r.check_out ? 'completed' : 'present',
        })),
      };
    }

    case 'list_leave_requests': {
      const where = {};
      if (params.status) where.status = params.status;

      const requests = await prisma.leaveRequest.findMany({
        where,
        take: params.limit || 20,
        include: { person: { select: { first_name: true, last_name: true } } },
        orderBy: { created_at: 'desc' },
      });

      return {
        count: requests.length,
        requests: requests.map(r => ({
          id: r.id,
          person: `${r.person.first_name} ${r.person.last_name}`,
          type: r.type, status: r.status,
          from: r.date_from, to: r.date_to,
          note: r.note,
        })),
      };
    }

    default:
      throw new Error(`Unknown HR tool: ${toolName}`);
  }
}

module.exports = { getHrTools, executeHrTool };
