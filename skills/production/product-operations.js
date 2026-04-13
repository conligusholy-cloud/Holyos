const BaseSkill = require('../base-skill');

class ProductOperationsSkill extends BaseSkill {
  constructor() {
    super({
      name: 'Operace výrobku',
      slug: 'product-operations',
      description: 'Vrátí detailní pracovní postup (operace) pro konkrétní výrobek.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'number', description: 'ID výrobku' },
          product_code: { type: 'string', description: 'Kód výrobku (alternativa k ID)' },
        },
      },
    });
  }

  async execute(params, { prisma }) {
    let product;

    if (params.product_id) {
      product = await prisma.product.findUnique({
        where: { id: params.product_id },
        include: {
          operations: {
            include: { workstation: { select: { name: true, code: true } } },
            orderBy: { step_number: 'asc' },
          },
        },
      });
    } else if (params.product_code) {
      product = await prisma.product.findUnique({
        where: { code: params.product_code },
        include: {
          operations: {
            include: { workstation: { select: { name: true, code: true } } },
            orderBy: { step_number: 'asc' },
          },
        },
      });
    }

    if (!product) {
      return { error: 'Výrobek nenalezen', product_id: params.product_id, product_code: params.product_code };
    }

    const totalDuration = product.operations.reduce((sum, op) => {
      if (op.duration_unit === 'HOUR') return sum + (op.duration || 0) * 60;
      if (op.duration_unit === 'SECOND') return sum + (op.duration || 0) / 60;
      return sum + (op.duration || 0);
    }, 0);

    return {
      product: { id: product.id, code: product.code, name: product.name, type: product.type },
      operations_count: product.operations.length,
      total_duration_minutes: Math.round(totalDuration),
      operations: product.operations.map(op => ({
        step: op.step_number,
        name: op.name,
        phase: op.phase,
        workstation: op.workstation?.name,
        workstation_code: op.workstation?.code,
        duration: op.duration,
        duration_unit: op.duration_unit,
        preparation_time: op.preparation_time,
      })),
    };
  }
}

module.exports = new ProductOperationsSkill();
