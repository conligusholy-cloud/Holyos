const BaseSkill = require('../base-skill');

class SystemStatsSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Statistiky systému',
      slug: 'system-stats',
      description: 'Vrátí přehledové statistiky celého systému.',
      parameters: {
        type: 'object',
        properties: {},
      },
    });
  }

  async execute(params, { prisma }) {
    const [
      employees, companies, materials, orders, products, semiProducts,
      workstations, belowMinCount, pendingLeaves, todayAttendance
    ] = await Promise.all([
      prisma.person.count({ where: { active: true, type: 'employee' } }),
      prisma.company.count({ where: { active: true } }),
      prisma.material.count({ where: { status: 'active' } }),
      prisma.order.count(),
      prisma.product.count({ where: { type: 'product' } }),
      prisma.product.count({ where: { type: 'semi-product' } }),
      prisma.workstation.count(),
      prisma.$queryRaw`SELECT COUNT(*)::int as count FROM materials WHERE status = 'active' AND min_stock IS NOT NULL AND current_stock < min_stock`,
      prisma.leaveRequest.count({ where: { status: 'pending' } }),
      prisma.attendance.count({ where: { date: new Date(new Date().toISOString().split('T')[0]) } }),
    ]);

    return {
      employees_active: employees,
      companies_active: companies,
      materials_active: materials,
      materials_below_minimum: belowMinCount[0]?.count || 0,
      orders_total: orders,
      products: products,
      semi_products: semiProducts,
      workstations: workstations,
      pending_leave_requests: pendingLeaves,
      today_attendance_records: todayAttendance,
    };
  }
}

module.exports = new SystemStatsSkill();
