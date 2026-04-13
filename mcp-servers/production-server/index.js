// =============================================================================
// HolyOS MCP Server — Production (Výroba)
// =============================================================================

function getProductionTools() {
  return [
    {
      name: 'list_products',
      description: 'Seznam výrobků a polotovarů. Volitelně včetně operací.',
      input_schema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Hledání podle názvu nebo kódu' },
          include_operations: { type: 'boolean', description: 'Zahrnout operace', default: false },
          limit: { type: 'number', description: 'Max výsledků', default: 30 },
        },
      },
    },
    {
      name: 'list_workstations',
      description: 'Seznam pracovišť a strojů.',
      input_schema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Hledání podle názvu' },
          limit: { type: 'number', description: 'Max výsledků', default: 30 },
        },
      },
    },
    {
      name: 'product_operations',
      description: 'Detailní operace (výrobní kroky) pro konkrétní výrobek.',
      input_schema: {
        type: 'object',
        properties: {
          product_id: { type: 'number', description: 'ID výrobku' },
          product_code: { type: 'string', description: 'Kód výrobku (alternativa k ID)' },
        },
      },
    },
    {
      name: 'system_stats',
      description: 'Přehled systému — počty zaměstnanců, materiálů, výrobků, objednávek, pracovišť.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

async function executeProductionTool(toolName, params, prisma) {
  switch (toolName) {
    case 'list_products': {
      const where = {};
      if (params.search) {
        where.OR = [
          { name: { contains: params.search, mode: 'insensitive' } },
          { code: { contains: params.search, mode: 'insensitive' } },
        ];
      }

      const products = await prisma.product.findMany({
        where,
        take: params.limit || 30,
        include: params.include_operations ? {
          operations: { orderBy: { sequence: 'asc' }, include: { workstation: { select: { name: true } } } },
        } : undefined,
        orderBy: { name: 'asc' },
      });

      return {
        count: products.length,
        products: products.map(p => ({
          id: p.id, code: p.code, name: p.name, type: p.type,
          operations_count: p.operations?.length,
          operations: p.operations?.map(op => ({
            sequence: op.sequence, name: op.name,
            workstation: op.workstation?.name,
            time_minutes: op.time_minutes,
          })),
        })),
      };
    }

    case 'list_workstations': {
      const where = {};
      if (params.search) where.name = { contains: params.search, mode: 'insensitive' };

      const workstations = await prisma.workstation.findMany({
        where,
        take: params.limit || 30,
        include: { _count: { select: { operations: true } } },
        orderBy: { name: 'asc' },
      });

      return {
        count: workstations.length,
        workstations: workstations.map(w => ({
          id: w.id, name: w.name, code: w.code, type: w.type,
          operations_count: w._count.operations,
        })),
      };
    }

    case 'product_operations': {
      const where = {};
      if (params.product_id) where.id = params.product_id;
      else if (params.product_code) where.code = params.product_code;
      else return { error: 'Zadejte product_id nebo product_code' };

      const product = await prisma.product.findFirst({
        where,
        include: {
          operations: {
            orderBy: { sequence: 'asc' },
            include: { workstation: { select: { name: true, code: true } } },
          },
        },
      });

      if (!product) return { error: 'Výrobek nenalezen' };

      return {
        product: { id: product.id, code: product.code, name: product.name },
        operations_count: product.operations.length,
        operations: product.operations.map(op => ({
          sequence: op.sequence, name: op.name, description: op.description,
          workstation: op.workstation?.name, workstation_code: op.workstation?.code,
          time_minutes: op.time_minutes, setup_minutes: op.setup_minutes,
        })),
      };
    }

    case 'system_stats': {
      const [people, companies, materials, orders, products, workstations] = await Promise.all([
        prisma.person.count({ where: { active: true } }),
        prisma.company.count({ where: { active: true } }),
        prisma.material.count({ where: { status: 'active' } }),
        prisma.order.count(),
        prisma.product.count(),
        prisma.workstation.count(),
      ]);

      // Materiály pod minimem
      const belowMin = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM materials
        WHERE status = 'active' AND min_stock IS NOT NULL AND current_stock < min_stock
      `;

      return {
        zaměstnanci: people,
        firmy: companies,
        materiály: materials,
        materiály_pod_minimem: belowMin[0]?.count || 0,
        objednávky: orders,
        výrobky: products,
        pracoviště: workstations,
      };
    }

    default:
      throw new Error(`Unknown production tool: ${toolName}`);
  }
}

module.exports = { getProductionTools, executeProductionTool };
