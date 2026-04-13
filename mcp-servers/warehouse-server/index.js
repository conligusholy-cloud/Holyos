// =============================================================================
// HolyOS MCP Server — Warehouse (Sklad)
// In-process režim pro orchestrátor
// Pro standalone MCP režim viz mcp-servers/standalone/warehouse.mjs
// =============================================================================

/**
 * Vrátí tool definitions pro Claude API (in-process)
 */
function getWarehouseTools() {
  return [
    {
      name: 'stock_check',
      description: 'Kontrola zásob materiálu. Filtrování podle názvu, pod minimem.',
      input_schema: {
        type: 'object',
        properties: {
          material_name: { type: 'string', description: 'Hledání podle názvu materiálu' },
          below_minimum: { type: 'boolean', description: 'Pouze položky pod minimální zásobou' },
          limit: { type: 'number', description: 'Max výsledků', default: 30 },
        },
      },
    },
    {
      name: 'list_orders',
      description: 'Seznam objednávek. Filtrování podle typu (purchase/sale) a stavu.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['purchase', 'sale'], description: 'Typ objednávky' },
          status: { type: 'string', description: 'Stav objednávky' },
          limit: { type: 'number', description: 'Max výsledků', default: 20 },
        },
      },
    },
    {
      name: 'list_companies',
      description: 'Seznam firem (dodavatelé, odběratelé).',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['supplier', 'customer', 'both'], description: 'Typ firmy' },
          search: { type: 'string', description: 'Hledání podle názvu' },
          limit: { type: 'number', description: 'Max výsledků', default: 30 },
        },
      },
    },
  ];
}

/**
 * Spustí warehouse tool in-process
 */
async function executeWarehouseTool(toolName, params, prisma) {
  switch (toolName) {
    case 'stock_check': {
      const where = { status: 'active' };
      if (params.material_name) where.name = { contains: params.material_name, mode: 'insensitive' };
      let materials = await prisma.material.findMany({
        where, take: params.limit || 30,
        include: { supplier: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
      if (params.below_minimum) {
        materials = materials.filter(m => m.min_stock !== null && Number(m.current_stock) < Number(m.min_stock));
      }
      const belowMin = materials.filter(m => m.min_stock !== null && Number(m.current_stock) < Number(m.min_stock));
      return {
        total_checked: materials.length, below_minimum: belowMin.length,
        materials: materials.map(m => ({
          id: m.id, code: m.code, name: m.name, type: m.type,
          current_stock: Number(m.current_stock),
          min_stock: m.min_stock ? Number(m.min_stock) : null,
          unit: m.unit, supplier: m.supplier?.name || null,
          alert: m.min_stock !== null && Number(m.current_stock) < Number(m.min_stock),
        })),
      };
    }
    case 'list_orders': {
      const where = {};
      if (params.type) where.type = params.type;
      if (params.status) where.status = params.status;
      const orders = await prisma.order.findMany({
        where, take: params.limit || 20,
        include: {
          supplier: { select: { name: true } }, customer: { select: { name: true } },
          items: { include: { material: { select: { name: true, code: true, unit: true } } } },
        },
        orderBy: { created_at: 'desc' },
      });
      return {
        count: orders.length,
        orders: orders.map(o => ({
          id: o.id, code: o.code, type: o.type, status: o.status,
          supplier: o.supplier?.name, customer: o.customer?.name,
          items_count: o.items?.length || 0,
          items: (o.items || []).map(i => ({ material: i.material?.name, quantity: Number(i.quantity), unit: i.material?.unit })),
          created_at: o.created_at,
        })),
      };
    }
    case 'list_companies': {
      const where = { active: true };
      if (params.type && params.type !== 'both') where.type = params.type;
      if (params.search) where.name = { contains: params.search, mode: 'insensitive' };
      const companies = await prisma.company.findMany({ where, take: params.limit || 30, orderBy: { name: 'asc' } });
      return { count: companies.length, companies: companies.map(c => ({ id: c.id, name: c.name, type: c.type, ico: c.ico, email: c.email, phone: c.phone })) };
    }
    default:
      throw new Error(`Unknown warehouse tool: ${toolName}`);
  }
}

module.exports = { getWarehouseTools, executeWarehouseTool };
