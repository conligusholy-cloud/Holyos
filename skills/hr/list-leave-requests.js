const BaseSkill = require('../base-skill');

class ListLeaveRequestsSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Žádosti o dovolenou',
      slug: 'list-leave-requests',
      description: 'Vrátí seznam žádostí o dovolenou s filtrováním podle stavu.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filtr dle stavu: pending, approved, rejected' },
          person_id: { type: 'number', description: 'ID konkrétní osoby' },
          limit: { type: 'number', description: 'Max výsledků', default: 20 },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const where = {};
    if (params.status) where.status = params.status;
    if (params.person_id) where.person_id = params.person_id;

    const requests = await prisma.leaveRequest.findMany({
      where,
      take: params.limit || 20,
      include: {
        person: { select: { first_name: true, last_name: true, department: { select: { name: true } } } },
        approver: { select: { first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      count: requests.length,
      requests: requests.map(r => ({
        id: r.id,
        person: `${r.person.first_name} ${r.person.last_name}`,
        department: r.person.department?.name,
        type: r.type,
        date_from: r.date_from.toISOString().split('T')[0],
        date_to: r.date_to.toISOString().split('T')[0],
        status: r.status,
        approved_by: r.approver ? `${r.approver.first_name} ${r.approver.last_name}` : null,
        note: r.note,
      })),
    };
  }
}

module.exports = new ListLeaveRequestsSkill();
