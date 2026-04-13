const BaseSkill = require('../base-skill');

class ListWorkstationsSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Seznam pracovišť',
      slug: 'list-workstations',
      description: 'Vrátí seznam pracovišť (strojů) s kódy a počtem operací.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Hledání podle názvu' },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const where = {};
    if (params.search) {
      where.name = { contains: params.search, mode: 'insensitive' };
    }

    const workstations = await prisma.workstation.findMany({
      where,
      include: { _count: { select: { operations: true } } },
      orderBy: { name: 'asc' },
    });

    return {
      count: workstations.length,
      workstations: workstations.map(w => ({
        id: w.id,
        name: w.name,
        code: w.code,
        operations_count: w._count.operations,
      })),
    };
  }
}

module.exports = new ListWorkstationsSkill();
