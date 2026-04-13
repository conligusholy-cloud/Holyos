const BaseSkill = require('../base-skill');

class StockCheckSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Kontrola zásob',
      slug: 'stock-check',
      description: 'Kontrola zásob materiálu. Filtrování podle názvu, pod minimem.',
      parameters: {
        type: 'object',
        properties: {
          material_name: { type: 'string', description: 'Hledání podle názvu materiálu' },
          below_minimum: { type: 'boolean', description: 'Pouze položky pod minimální zásobou' },
          limit: { type: 'number', description: 'Max výsledků', default: 30 },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    const where = { status: 'active' };
    if (params.material_name) {
      where.name = { contains: params.material_name, mode: 'insensitive' };
    }

    let materials = await prisma.material.findMany({
      where,
      take: params.limit || 30,
      include: {
        supplier: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });

    if (params.below_minimum) {
      materials = materials.filter(m =>
        m.min_stock !== null && Number(m.current_stock) < Number(m.min_stock)
      );
    }

    const belowMin = materials.filter(m =>
      m.min_stock !== null && Number(m.current_stock) < Number(m.min_stock)
    );

    return {
      total_checked: materials.length,
      below_minimum: belowMin.length,
      materials: materials.map(m => ({
        id: m.id,
        code: m.code,
        name: m.name,
        type: m.type,
        current_stock: Number(m.current_stock),
        min_stock: m.min_stock ? Number(m.min_stock) : null,
        unit: m.unit,
        supplier: m.supplier?.name || null,
        alert: m.min_stock !== null && Number(m.current_stock) < Number(m.min_stock),
      })),
    };
  }
}

module.exports = new StockCheckSkill();
