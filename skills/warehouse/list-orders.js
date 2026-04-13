const BaseSkill = require('../base-skill');

class ListOrdersSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Seznam objednávek',
      slug: 'list-orders',
      description: 'Vrátí seznam objednávek s filtrováním podle typu a stavu.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Typ: purchase, sales, cooperation' },
          status: { type: 'string', description: 'Stav: new, confirmed, shipped, delivered, cancelled' },
          limit: { type: 'number', description: 'Max výsledků', default: 20 },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const where = {};
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;

    const orders = await prisma.order.findMany({
      where,
      take: params.limit || 20,
      include: {
        company: { select: { name: true } },
        items: { select: { name: true, quantity: true, unit_price: true, total_price: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      count: orders.length,
      orders: orders.map(o => ({
        id: o.id,
        order_number: o.order_number,
        type: o.type,
        company: o.company.name,
        status: o.status,
        items_count: o.items.length,
        total_amount: Number(o.total_amount),
        currency: o.currency,
        expected_delivery: o.expected_delivery?.toISOString().split('T')[0],
        items: o.items.map(i => ({
          name: i.name,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
          status: i.status,
        })),
      })),
    };
  }
}

module.exports = new ListOrdersSkill();
