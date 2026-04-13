const BaseSkill = require('../base-skill');

class ListEmployeesSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Seznam zaměstnanců',
      slug: 'list-employees',
      description: 'Vrátí seznam zaměstnanců s možností filtrování podle oddělení, role, aktivního stavu.',
      parameters: {
        type: 'object',
        properties: {
          department: { type: 'string', description: 'Filtr dle názvu oddělení' },
          role: { type: 'string', description: 'Filtr dle názvu role' },
          active: { type: 'boolean', description: 'Pouze aktivní zaměstnanci', default: true },
          limit: { type: 'number', description: 'Maximální počet výsledků', default: 50 },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const where = {};
    if (params.active !== undefined) where.active = params.active;
    if (params.department) where.department = { name: { contains: params.department, mode: 'insensitive' } };
    if (params.role) where.role = { name: { contains: params.role, mode: 'insensitive' } };

    const employees = await prisma.person.findMany({
      where,
      take: params.limit || 50,
      include: {
        department: { select: { name: true } },
        role: { select: { name: true } },
        shift: { select: { name: true } },
      },
      orderBy: { last_name: 'asc' },
    });

    return {
      count: employees.length,
      employees: employees.map(e => ({
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        employee_number: e.employee_number,
        department: e.department?.name || null,
        role: e.role?.name || null,
        shift: e.shift?.name || null,
        email: e.email,
        phone: e.phone,
        active: e.active,
      })),
    };
  }
}

module.exports = new ListEmployeesSkill();
