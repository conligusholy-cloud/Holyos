const BaseSkill = require('../base-skill');

class ListProductsSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Seznam výrobků',
      slug: 'list-products',
      description: 'Vrátí seznam výrobků a polotovarů, volitelně s jejich operacemi.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Typ: product, semi-product' },
          search: { type: 'string', description: 'Hledání podle názvu nebo kódu' },
          include_operations: { type: 'boolean', description: 'Zahrnout operace', default: false },
          limit: { type: 'number', description: 'Max výsledků', default: 30 },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const where = {};
    if (params.type) where.type = params.type;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { code: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const include = {};
    if (params.include_operations) {
      include.operations = {
        include: { workstation: { select: { name: true } } },
        orderBy: { step_number: 'asc' },
      };
    }

    const products = await prisma.product.findMany({
      where,
      take: params.limit || 30,
      include,
      orderBy: { name: 'asc' },
    });

    return {
      count: products.length,
      products: products.map(p => ({
        id: p.id,
        code: p.code,
        name: p.name,
        type: p.type,
        operations: p.operations?.map(op => ({
          step: op.step_number,
          name: op.name,
          workstation: op.workstation?.name,
          duration: op.duration,
          duration_unit: op.duration_unit,
          preparation_time: op.preparation_time,
        })),
      })),
    };
  }
}

module.exports = new ListProductsSkill();
