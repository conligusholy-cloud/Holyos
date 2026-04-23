// =============================================================================
// HolyOS MCP Server — Warehouse (Sklad 2.0)
// In-process režim pro orchestrátor
// Pro standalone MCP režim viz mcp-servers/standalone/warehouse.mjs
// =============================================================================

const { createMove } = require('../../services/warehouse/moves.service');
const { printLabel } = require('../../services/print/print.service');

/**
 * Vrátí tool definitions pro Claude API (in-process)
 */
function getWarehouseTools() {
  return [
    // ---------------------- LEGACY (ponecháno 1:1) ----------------------
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

    // ---------------------- SKLAD 2.0 ----------------------
    {
      name: 'search_materials',
      description: 'Fulltextové hledání materiálu podle kódu, názvu nebo QR/barcode. Použij pro libovolné "jaký materiál…", "kolik mám…", "najdi…" dotazy.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Hledaný výraz — porovnává se s code, name a barcode' },
          sector: { type: 'string', enum: ['vyroba', 'stavba', 'servis', 'eshop', 'pradelna'], description: 'Omez na sektor' },
          limit: { type: 'number', description: 'Max výsledků', default: 20 },
        },
        required: ['query'],
      },
    },
    {
      name: 'lookup_material_by_qr',
      description: 'Detail materiálu podle QR / barcode. Vrací aktuální zásobu po lokacích a posledních 10 pohybů. Použij, když uživatel naskenoval kód nebo zná přesné SKU.',
      input_schema: {
        type: 'object',
        properties: {
          qr_code: { type: 'string', description: 'Hodnota QR kódu nebo barcode na etiketě' },
        },
        required: ['qr_code'],
      },
    },
    {
      name: 'lookup_location_by_qr',
      description: 'Detail skladové lokace podle QR kódu. Vrací seznam všech materiálů, které na lokaci fyzicky leží. Použij po sken­u lokačního QR na regálu.',
      input_schema: {
        type: 'object',
        properties: {
          qr_code: { type: 'string', description: 'Hodnota QR na etiketě lokace' },
        },
        required: ['qr_code'],
      },
    },
    {
      name: 'create_move',
      description: 'Zapiš skladový pohyb (receipt / issue / transfer / adjustment). Transakčně aktualizuje zásoby. Uveď client_uuid = identifikátor požadavku (nová UUID v4 pro každý unikátní pohyb; resend se stejnou UUID je idempotentní).',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['receipt', 'issue', 'transfer', 'adjustment'], description: 'Typ pohybu' },
          material_id: { type: 'number', description: 'ID materiálu' },
          warehouse_id: { type: 'number', description: 'ID skladu' },
          quantity: { type: 'number', description: 'Počet (u receipt/issue/transfer kladné; adjustment může být záporné)' },
          location_id: { type: 'number', description: 'Pro jednoduchý příjem/výdej na jednu lokaci' },
          from_location_id: { type: 'number', description: 'Zdrojová lokace pro transfer' },
          to_location_id: { type: 'number', description: 'Cílová lokace pro transfer/příjem na konkrétní místo' },
          note: { type: 'string', description: 'Volitelná poznámka' },
          client_uuid: { type: 'string', description: 'UUID v4 klientem pro idempotenci' },
        },
        required: ['type', 'material_id', 'warehouse_id', 'quantity', 'client_uuid'],
      },
    },
    {
      name: 'list_batches',
      description: 'Seznam pickovacích dávek. Filtrace podle stavu a sektoru.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'picking', 'done', 'cancelled'], description: 'Stav dávky' },
          sector: { type: 'string', enum: ['vyroba', 'stavba', 'servis', 'eshop', 'pradelna'] },
          limit: { type: 'number', default: 20 },
        },
      },
    },
    {
      name: 'list_documents',
      description: 'Seznam skladových dokumentů (DL, výdejky, přesunky, pickovací listy, inventury).',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['receipt_doc', 'issue_doc', 'transfer_doc', 'pick_list', 'inventory_doc'] },
          status: { type: 'string', enum: ['draft', 'in_progress', 'completed', 'cancelled'] },
          limit: { type: 'number', default: 20 },
        },
      },
    },
    {
      name: 'print_label',
      description: 'Vytiskni etiketu přes centrální tiskový subsystém. Použij template = kód šablony (item_label, location_label, document_summary) a data = hodnoty pro {{placeholder}} v šabloně. printer_id je volitelný — při vynechání se vybere podle priority / location_id.',
      input_schema: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Kód šablony — item_label / location_label / document_summary / vlastní' },
          data: { type: 'object', description: 'Hodnoty pro placeholdery v šabloně', additionalProperties: true },
          printer_id: { type: 'number', description: 'ID tiskárny (volitelné — jinak autoselekce)' },
          copies: { type: 'number', description: 'Počet kopií', default: 1 },
          location_id: { type: 'number', description: 'Pro autoselekci tiskárny podle místa operace' },
        },
        required: ['template', 'data'],
      },
    },
  ];
}

/**
 * Spustí warehouse tool in-process
 */
async function executeWarehouseTool(toolName, params, prisma) {
  switch (toolName) {
    // ---------------------- LEGACY ----------------------
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
          company: { select: { name: true, type: true } },
          items: { include: { material: { select: { name: true, code: true, unit: true } } } },
        },
        orderBy: { created_at: 'desc' },
      });
      return {
        count: orders.length,
        orders: orders.map(o => ({
          id: o.id, order_number: o.order_number, type: o.type, status: o.status,
          company: o.company?.name,
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
      return {
        count: companies.length,
        companies: companies.map(c => ({ id: c.id, name: c.name, type: c.type, ico: c.ico, email: c.email, phone: c.phone })),
      };
    }

    // ---------------------- SKLAD 2.0 ----------------------
    case 'search_materials': {
      const query = String(params.query || '').trim();
      if (!query) return { count: 0, materials: [] };
      const where = {
        status: 'active',
        OR: [
          { code: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
        ],
      };
      if (params.sector) where.sector = params.sector;

      const materials = await prisma.material.findMany({
        where,
        take: params.limit || 20,
        orderBy: { name: 'asc' },
        select: {
          id: true, code: true, name: true, barcode: true, unit: true, sector: true,
          current_stock: true, min_stock: true,
        },
      });
      return {
        count: materials.length,
        materials: materials.map(m => ({
          ...m,
          current_stock: Number(m.current_stock),
          min_stock: m.min_stock != null ? Number(m.min_stock) : null,
          below_minimum: m.min_stock != null && Number(m.current_stock) < Number(m.min_stock),
        })),
      };
    }

    case 'lookup_material_by_qr': {
      const material = await prisma.material.findUnique({
        where: { barcode: params.qr_code },
        include: { supplier: { select: { id: true, name: true } } },
      });
      if (!material) return { found: false, qr_code: params.qr_code };

      const stock = await prisma.stock.findMany({
        where: { material_id: material.id, quantity: { gt: 0 } },
        orderBy: { quantity: 'desc' },
        take: 10,
        include: { location: { select: { id: true, label: true, warehouse_id: true } } },
      });
      const lastMoves = await prisma.inventoryMovement.findMany({
        where: { material_id: material.id },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { id: true, type: true, quantity: true, created_at: true, location_id: true, from_location_id: true, to_location_id: true },
      });
      return {
        found: true,
        material: {
          id: material.id, code: material.code, name: material.name, barcode: material.barcode,
          unit: material.unit, sector: material.sector,
          current_stock: Number(material.current_stock),
          min_stock: material.min_stock != null ? Number(material.min_stock) : null,
          supplier: material.supplier?.name || null,
        },
        stock_by_location: stock.map(s => ({
          location_id: s.location_id,
          location_label: s.location?.label,
          quantity: Number(s.quantity),
        })),
        last_movements: lastMoves.map(m => ({ ...m, quantity: Number(m.quantity) })),
      };
    }

    case 'lookup_location_by_qr': {
      const location = await prisma.warehouseLocation.findUnique({
        where: { barcode: params.qr_code },
        include: { warehouse: { select: { id: true, name: true, code: true } } },
      });
      if (!location) return { found: false, qr_code: params.qr_code };

      const stock = await prisma.stock.findMany({
        where: { location_id: location.id, quantity: { gt: 0 } },
        orderBy: { quantity: 'desc' },
        include: { material: { select: { id: true, code: true, name: true, unit: true } } },
      });
      return {
        found: true,
        location: {
          id: location.id, label: location.label, barcode: location.barcode,
          type: location.type, warehouse: location.warehouse?.name,
          locked_for_inventory: location.locked_for_inventory,
        },
        materials: stock.map(s => ({
          material_id: s.material_id,
          code: s.material?.code,
          name: s.material?.name,
          unit: s.material?.unit,
          quantity: Number(s.quantity),
        })),
      };
    }

    case 'create_move': {
      const result = await createMove({
        type: params.type,
        material_id: params.material_id,
        warehouse_id: params.warehouse_id,
        quantity: params.quantity,
        location_id: params.location_id ?? null,
        from_location_id: params.from_location_id ?? null,
        to_location_id: params.to_location_id ?? null,
        client_uuid: params.client_uuid,
        note: params.note ?? null,
      });
      return {
        move_id: result.move.id,
        type: result.move.type,
        quantity: Number(result.move.quantity),
        deduped: result.deduped,
        created_at: result.move.created_at,
      };
    }

    case 'list_batches': {
      const where = {};
      if (params.status) where.status = params.status;
      if (params.sector) where.sector = params.sector;
      const batches = await prisma.batch.findMany({
        where,
        take: params.limit || 20,
        orderBy: { created_at: 'desc' },
        include: {
          assignee: { select: { id: true, first_name: true, last_name: true } },
          _count: { select: { items: true } },
        },
      });
      return {
        count: batches.length,
        batches: batches.map(b => ({
          id: b.id, number: b.number, sector: b.sector, status: b.status,
          assignee: b.assignee ? `${b.assignee.first_name} ${b.assignee.last_name}` : null,
          items_count: b._count.items,
          created_at: b.created_at,
          completed_at: b.completed_at,
        })),
      };
    }

    case 'list_documents': {
      const where = {};
      if (params.type) where.type = params.type;
      if (params.status) where.status = params.status;
      const docs = await prisma.warehouseDocument.findMany({
        where,
        take: params.limit || 20,
        orderBy: { created_at: 'desc' },
        include: {
          partner: { select: { id: true, name: true } },
          _count: { select: { movements: true } },
        },
      });
      return {
        count: docs.length,
        documents: docs.map(d => ({
          id: d.id, number: d.number, type: d.type, status: d.status,
          partner: d.partner?.name || null,
          reference: d.reference,
          movements_count: d._count.movements,
          created_at: d.created_at,
          completed_at: d.completed_at,
        })),
      };
    }

    case 'print_label': {
      const job = await printLabel({
        template: params.template,
        data: params.data || {},
        printer_id: params.printer_id || null,
        copies: params.copies || 1,
        location_id: params.location_id || null,
      });
      return {
        job_id: job.id,
        printer_id: job.printer_id,
        status: job.status,
        copies: job.copies,
        finished_at: job.finished_at,
      };
    }

    default:
      throw new Error(`Unknown warehouse tool: ${toolName}`);
  }
}

module.exports = { getWarehouseTools, executeWarehouseTool };
