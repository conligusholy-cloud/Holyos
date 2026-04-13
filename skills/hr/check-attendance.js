const BaseSkill = require('../base-skill');

class CheckAttendanceSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Kontrola docházky',
      slug: 'check-attendance',
      description: 'Zjistí docházku zaměstnanců za daný den. Ukáže kdo je přítomen, kdo chybí.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Datum ve formátu YYYY-MM-DD (výchozí: dnes)' },
          person_id: { type: 'number', description: 'ID konkrétní osoby (volitelné)' },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const date = params.date ? new Date(params.date) : new Date();
    date.setHours(0, 0, 0, 0);

    const where = { date };
    if (params.person_id) where.person_id = params.person_id;

    const records = await prisma.attendance.findMany({
      where,
      include: {
        person: {
          select: { id: true, first_name: true, last_name: true, department: { select: { name: true } } },
        },
      },
    });

    const present = records.filter(r => r.clock_in && !r.clock_out);
    const completed = records.filter(r => r.clock_in && r.clock_out);
    const totalActive = await prisma.person.count({ where: { active: true, type: 'employee' } });

    return {
      date: date.toISOString().split('T')[0],
      total_active_employees: totalActive,
      records_today: records.length,
      currently_present: present.length,
      completed_shifts: completed.length,
      missing: totalActive - records.length,
      attendance: records.map(r => ({
        name: `${r.person.first_name} ${r.person.last_name}`,
        department: r.person.department?.name,
        clock_in: r.clock_in,
        clock_out: r.clock_out,
        type: r.type,
        note: r.note,
      })),
    };
  }
}

module.exports = new CheckAttendanceSkill();
