// =============================================================================
// HolyOS MCP Server — Vozový park (Fleet)
// Nástroje pro AI asistenty: dotazy na vozidla, termíny, řidiče
// =============================================================================

function daysUntil(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function statusFromDays(days) {
  if (days === null || days === undefined) return null;
  if (days < 0) return 'expired';
  if (days <= 30) return 'warning';
  return 'ok';
}

function summarizeVehicle(v) {
  return {
    id: v.id,
    license_plate: v.license_plate,
    model: v.model,
    vin: v.vin,
    category: v.category,
    driver: v.driver ? `${v.driver.first_name} ${v.driver.last_name}` : null,
    active: v.active,
    insurance_to: v.insurance_to,
    insurance_days: daysUntil(v.insurance_to),
    insurance_status: statusFromDays(daysUntil(v.insurance_to)),
    stk_valid_to: v.stk_valid_to,
    stk_days: daysUntil(v.stk_valid_to),
    stk_status: statusFromDays(daysUntil(v.stk_valid_to)),
    toll_sticker_to: v.toll_sticker_to,
    toll_days: daysUntil(v.toll_sticker_to),
    toll_status: statusFromDays(daysUntil(v.toll_sticker_to)),
    financing_type: v.financing_type,
    financing_owner: v.financing_owner,
  };
}

function getFleetTools() {
  return [
    {
      name: 'list_vehicles',
      description: 'Seznam vozidel ve vozovém parku. Lze filtrovat podle kategorie, aktivního stavu nebo řidiče.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filtr podle kategorie (např. "Osobní vůz", "Dodávka")' },
          active: { type: 'boolean', description: 'Pouze aktivní vozidla (default: true)', default: true },
          driver_name: { type: 'string', description: 'Filtr podle jména/příjmení řidiče' },
          limit: { type: 'number', description: 'Max výsledků', default: 50 },
        },
      },
    },
    {
      name: 'get_vehicle',
      description: 'Detail vozidla podle SPZ, VIN nebo ID. Vrátí všechny údaje včetně termínů POV/STK/dálniční známky.',
      input_schema: {
        type: 'object',
        properties: {
          license_plate: { type: 'string', description: 'SPZ vozidla' },
          vin: { type: 'string', description: 'VIN kód' },
          id: { type: 'number', description: 'ID vozidla' },
        },
      },
    },
    {
      name: 'get_expiring_vehicles',
      description: 'Vrátí vozidla s blížícími se termíny POV, STK nebo dálniční známky, nebo už po termínu. Klíčové pro přehled toho, co je potřeba řešit.',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Kolik dní dopředu hlídat (default 30)', default: 30 },
          kind: { type: 'string', enum: ['all', 'insurance', 'stk', 'toll'], description: 'Typ termínu (default all)', default: 'all' },
        },
      },
    },
    {
      name: 'get_fleet_stats',
      description: 'Souhrnná statistika vozového parku: celkový počet, rozložení kategorií, financování, počet vozidel s končícími/prošlými termíny.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'update_vehicle_dates',
      description: 'Aktualizuje termíny vozidla (POV, STK, dálniční známka, financování). Použij po prodloužení POV, absolvování STK apod.',
      input_schema: {
        type: 'object',
        properties: {
          vehicle_id: { type: 'number', description: 'ID vozidla' },
          license_plate: { type: 'string', description: 'Alternativně SPZ' },
          insurance_from: { type: 'string', description: 'YYYY-MM-DD' },
          insurance_to: { type: 'string', description: 'YYYY-MM-DD' },
          stk_valid_to: { type: 'string', description: 'YYYY-MM-DD' },
          toll_sticker_to: { type: 'string', description: 'YYYY-MM-DD' },
          financing_to: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    },
  ];
}

async function executeFleetTool(toolName, params, prisma) {
  switch (toolName) {
    case 'list_vehicles': {
      const where = {};
      if (params.active !== false) where.active = true;
      if (params.category) where.category = params.category;
      if (params.driver_name) {
        const parts = params.driver_name.trim().split(/\s+/);
        where.driver = {
          OR: parts.flatMap(p => ([
            { first_name: { contains: p, mode: 'insensitive' } },
            { last_name: { contains: p, mode: 'insensitive' } },
          ])),
        };
      }

      const vehicles = await prisma.vehicle.findMany({
        where,
        take: params.limit || 50,
        include: { driver: { select: { first_name: true, last_name: true } } },
        orderBy: [{ active: 'desc' }, { license_plate: 'asc' }],
      });

      return { count: vehicles.length, vehicles: vehicles.map(summarizeVehicle) };
    }

    case 'get_vehicle': {
      const where = {};
      if (params.id) where.id = params.id;
      else if (params.license_plate) where.license_plate = params.license_plate;
      else if (params.vin) where.vin = params.vin;
      else throw new Error('Musí být zadáno alespoň jedno z: id, license_plate, vin');

      const v = await prisma.vehicle.findFirst({
        where,
        include: {
          driver: { select: { first_name: true, last_name: true, email: true, phone: true } },
        },
      });
      if (!v) return { found: false };

      return { found: true, vehicle: {
        ...summarizeVehicle(v),
        color: v.color, year: v.year, current_km: v.current_km,
        insurance_from: v.insurance_from, insurance_company: v.insurance_company,
        disk_size: v.disk_size, tire_size: v.tire_size,
        financing_to: v.financing_to,
        note: v.note,
      }};
    }

    case 'get_expiring_vehicles': {
      const days = params.days || 30;
      const kind = params.kind || 'all';

      const vehicles = await prisma.vehicle.findMany({
        where: { active: true },
        include: { driver: { select: { first_name: true, last_name: true } } },
      });

      const alerts = [];
      for (const v of vehicles) {
        const items = [];
        if (kind === 'all' || kind === 'insurance') {
          const d = daysUntil(v.insurance_to);
          if (v.insurance_to && (d < 0 || d <= days)) items.push({ kind: 'insurance', label: 'Povinné ručení', days: d, date: v.insurance_to });
        }
        if (kind === 'all' || kind === 'stk') {
          const d = daysUntil(v.stk_valid_to);
          if (v.stk_valid_to && (d < 0 || d <= days)) items.push({ kind: 'stk', label: 'STK', days: d, date: v.stk_valid_to });
        }
        if (kind === 'all' || kind === 'toll') {
          const d = daysUntil(v.toll_sticker_to);
          if (v.toll_sticker_to && (d < 0 || d <= days)) items.push({ kind: 'toll', label: 'Dálniční známka', days: d, date: v.toll_sticker_to });
        }
        for (const it of items) {
          alerts.push({
            vehicle_id: v.id,
            license_plate: v.license_plate,
            model: v.model,
            driver: v.driver ? `${v.driver.first_name} ${v.driver.last_name}` : null,
            kind: it.kind, label: it.label, days: it.days, date: it.date,
            status: it.days < 0 ? 'expired' : 'warning',
          });
        }
      }
      alerts.sort((a, b) => a.days - b.days);
      return { count: alerts.length, alerts };
    }

    case 'get_fleet_stats': {
      const vehicles = await prisma.vehicle.findMany({ where: { active: true } });
      const byCategory = {};
      const byFinancing = {};
      let povExpired = 0, povWarning = 0;
      let stkExpired = 0, stkWarning = 0;
      let tollExpired = 0, tollWarning = 0;

      for (const v of vehicles) {
        byCategory[v.category] = (byCategory[v.category] || 0) + 1;
        if (v.financing_type) byFinancing[v.financing_type] = (byFinancing[v.financing_type] || 0) + 1;

        const insD = daysUntil(v.insurance_to);
        const stkD = daysUntil(v.stk_valid_to);
        const tollD = daysUntil(v.toll_sticker_to);
        if (insD !== null) { if (insD < 0) povExpired++; else if (insD <= 30) povWarning++; }
        if (stkD !== null) { if (stkD < 0) stkExpired++; else if (stkD <= 30) stkWarning++; }
        if (tollD !== null) { if (tollD < 0) tollExpired++; else if (tollD <= 30) tollWarning++; }
      }

      return {
        total: vehicles.length,
        by_category: byCategory,
        by_financing: byFinancing,
        insurance: { expired: povExpired, warning: povWarning },
        stk: { expired: stkExpired, warning: stkWarning },
        toll: { expired: tollExpired, warning: tollWarning },
      };
    }

    case 'update_vehicle_dates': {
      // Najít vozidlo
      let id = params.vehicle_id;
      if (!id && params.license_plate) {
        const v = await prisma.vehicle.findFirst({ where: { license_plate: params.license_plate } });
        if (!v) throw new Error('Vozidlo nenalezeno podle SPZ: ' + params.license_plate);
        id = v.id;
      }
      if (!id) throw new Error('Musí být zadáno vehicle_id nebo license_plate');

      const data = {};
      const dateFields = ['insurance_from', 'insurance_to', 'stk_valid_to', 'toll_sticker_to', 'financing_to'];
      for (const f of dateFields) {
        if (params[f]) {
          const d = new Date(params[f]);
          if (!isNaN(d.getTime())) data[f] = d;
        }
      }
      if (Object.keys(data).length === 0) throw new Error('Nebylo zadáno žádné datum k aktualizaci');

      const updated = await prisma.vehicle.update({
        where: { id },
        data,
        include: { driver: { select: { first_name: true, last_name: true } } },
      });
      return { ok: true, vehicle: summarizeVehicle(updated) };
    }

    default:
      throw new Error(`Unknown Fleet tool: ${toolName}`);
  }
}

module.exports = { getFleetTools, executeFleetTool };
