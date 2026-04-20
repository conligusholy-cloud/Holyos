// =============================================================================
// HolyOS MCP Server — CAD výkresy
// Nástroje pro AI asistenty: dotazy nad CAD projekty, výkresy, kusovníky,
// rozpoznávání neznámých komponent, programatický import.
// =============================================================================

function summarizeDrawing(d) {
  if (!d) return null;
  return {
    id: d.id,
    file_name: d.file_name,
    extension: d.extension,
    version: d.version,
    project: d.project ? { id: d.project.id, code: d.project.code, name: d.project.name } : null,
    block: d.block ? { id: d.block.id, name: d.block.name } : null,
    title: d.title,
    imported_at: d.imported_at,
    last_import_at: d.last_import_at,
    configurations_count: d.configurations ? d.configurations.length : undefined,
  };
}

function summarizeComponent(c) {
  return {
    id: c.id,
    name: c.name,
    quantity: c.quantity,
    configuration: c.configuration,
    path: c.path,
    is_unknown: c.is_unknown,
    resolved: c.resolved,
    material: c.material ? { id: c.material.id, code: c.material.code, name: c.material.name } : null,
  };
}

function getCadTools() {
  return [
    {
      name: 'list_cad_projects',
      description: 'Vypíše seznam CAD projektů včetně stromu bloků. Slouží pro orientaci, kam uživatel posílá výkresy.',
      input_schema: {
        type: 'object',
        properties: {
          active_only: { type: 'boolean', description: 'Pouze aktivní (default true)', default: true },
          limit: { type: 'number', default: 50 },
        },
      },
    },
    {
      name: 'search_cad_drawings',
      description: 'Vyhledá CAD výkresy podle názvu, přípony nebo projektu. Vrátí seznam s projektem a blokem.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Fulltext v názvu souboru nebo titulku' },
          project_code: { type: 'string', description: 'Filtr podle kódu projektu' },
          extension: { type: 'string', description: 'sldprt | sldasm | slddrw | stl' },
          limit: { type: 'number', default: 30 },
        },
      },
    },
    {
      name: 'get_cad_drawing',
      description: 'Detail výkresu: konfigurace, kusovník, cesty k PDF/PNG.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          file_name: { type: 'string', description: 'Alternativa k id — název souboru (jednoznačný v rámci projektu)' },
          project_code: { type: 'string', description: 'Pokud se hledá podle file_name, pro jednoznačnost projekt' },
        },
      },
    },
    {
      name: 'get_cad_bom',
      description: 'Vrátí kusovník (BOM) dané konfigurace výkresu. Pro výkresy typu sldasm.',
      input_schema: {
        type: 'object',
        properties: {
          drawing_id: { type: 'number' },
          configuration: { type: 'string', description: 'Název konfigurace; pokud null, vrátí BOM první konfigurace.' },
        },
        required: ['drawing_id'],
      },
    },
    {
      name: 'list_unknown_components',
      description: 'Vrátí seznam nerozpoznaných komponent v CAD kusovníkách, které čekají na přiřazení k materiálu v katalogu.',
      input_schema: {
        type: 'object',
        properties: {
          project_code: { type: 'string' },
          limit: { type: 'number', default: 50 },
        },
      },
    },
    {
      name: 'resolve_cad_component',
      description: 'Přiřadí CAD komponentu ke konkrétnímu materiálu v katalogu (vyřeší „unknown component“).',
      input_schema: {
        type: 'object',
        properties: {
          component_id: { type: 'number' },
          material_id: { type: 'number' },
        },
        required: ['component_id', 'material_id'],
      },
    },
    {
      name: 'cad_project_summary',
      description: 'Shrnutí projektu: počet bloků, výkresů, konfigurací, otevřené unknown komponenty.',
      input_schema: {
        type: 'object',
        properties: {
          project_code: { type: 'string' },
          project_id: { type: 'number' },
        },
      },
    },
  ];
}

async function executeCadTool(toolName, params = {}, prisma) {
  switch (toolName) {
    case 'list_cad_projects': {
      const where = params.active_only === false ? {} : { active: true };
      const projects = await prisma.cadProject.findMany({
        where,
        orderBy: { code: 'asc' },
        take: Math.min(params.limit || 50, 200),
        include: { blocks: { select: { id: true, name: true, parent_id: true } },
                   _count: { select: { drawings: true } } },
      });
      return projects.map(p => ({
        id: p.id, code: p.code, name: p.name, customer: p.customer,
        drawings_count: p._count.drawings,
        blocks: p.blocks,
      }));
    }

    case 'search_cad_drawings': {
      const { query, project_code, extension, limit = 30 } = params;
      const where = {};
      if (extension) where.extension = String(extension).toLowerCase();
      if (project_code) where.project = { code: project_code };
      if (query) {
        where.OR = [
          { file_name: { contains: String(query), mode: 'insensitive' } },
          { title: { contains: String(query), mode: 'insensitive' } },
          { description: { contains: String(query), mode: 'insensitive' } },
        ];
      }
      const drawings = await prisma.cadDrawing.findMany({
        where,
        take: Math.min(limit, 200),
        orderBy: [{ last_import_at: 'desc' }],
        include: {
          project: { select: { id: true, code: true, name: true } },
          block:   { select: { id: true, name: true } },
          _count:  { select: { configurations: true } },
        },
      });
      return drawings.map(d => ({
        ...summarizeDrawing(d),
        configurations_count: d._count.configurations,
      }));
    }

    case 'get_cad_drawing': {
      const { id, file_name, project_code } = params;
      let where = null;
      if (id) where = { id };
      else if (file_name) {
        const filter = project_code
          ? { file_name, project: { code: project_code } }
          : { file_name };
        const found = await prisma.cadDrawing.findFirst({ where: filter });
        if (!found) return { error: 'Výkres nenalezen' };
        where = { id: found.id };
      } else return { error: 'Je třeba zadat id nebo file_name' };

      const drawing = await prisma.cadDrawing.findUnique({
        where,
        include: {
          project: true,
          block: true,
          configurations: {
            include: {
              components: { include: { material: { select: { id: true, code: true, name: true } } } },
            },
          },
        },
      });
      if (!drawing) return { error: 'Výkres nenalezen' };
      return {
        ...summarizeDrawing(drawing),
        configurations: drawing.configurations.map(c => ({
          id: c.id,
          name: c.config_name,
          quantity: c.quantity,
          mass_grams: c.mass_grams,
          png_url: c.png_path ? `/api/cad/assets/${c.png_path}` : null,
          pdf_url: c.pdf_path ? `/api/cad/assets/${c.pdf_path}` : null,
          custom_properties: c.custom_properties,
          components: c.components.map(summarizeComponent),
        })),
      };
    }

    case 'get_cad_bom': {
      const { drawing_id, configuration } = params;
      if (!drawing_id) return { error: 'Je třeba zadat drawing_id' };
      const configs = await prisma.cadDrawingConfig.findMany({
        where: configuration
          ? { drawing_id, config_name: configuration }
          : { drawing_id },
        include: {
          components: { include: { material: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { id: 'asc' },
      });
      if (!configs.length) return { error: 'Konfigurace nenalezena' };
      const cfg = configs[0];
      return {
        drawing_id,
        configuration: cfg.config_name,
        quantity: cfg.quantity,
        items: cfg.components.map(summarizeComponent),
      };
    }

    case 'list_unknown_components': {
      const { project_code, limit = 50 } = params;
      const where = { is_unknown: true, resolved: false };
      if (project_code) {
        where.parent_config = { drawing: { project: { code: project_code } } };
      }
      const comps = await prisma.cadComponent.findMany({
        where,
        take: Math.min(limit, 200),
        orderBy: { created_at: 'desc' },
        include: {
          parent_config: {
            include: {
              drawing: { include: { project: { select: { code: true, name: true } } } },
            },
          },
        },
      });
      return comps.map(c => ({
        id: c.id,
        name: c.name,
        path: c.path,
        quantity: c.quantity,
        drawing: c.parent_config?.drawing
          ? { id: c.parent_config.drawing.id, file_name: c.parent_config.drawing.file_name }
          : null,
        project: c.parent_config?.drawing?.project || null,
      }));
    }

    case 'resolve_cad_component': {
      const { component_id, material_id } = params;
      if (!component_id || !material_id) return { error: 'Chybí component_id nebo material_id' };
      const material = await prisma.material.findUnique({ where: { id: material_id } });
      if (!material) return { error: 'Materiál nenalezen' };
      const updated = await prisma.cadComponent.update({
        where: { id: component_id },
        data: { material_id, is_unknown: false, resolved: true },
      });
      return { id: updated.id, name: updated.name, material_id, resolved: true };
    }

    case 'cad_project_summary': {
      const { project_code, project_id } = params;
      if (!project_code && !project_id) return { error: 'Zadej project_code nebo project_id' };
      const project = project_id
        ? await prisma.cadProject.findUnique({ where: { id: project_id } })
        : await prisma.cadProject.findUnique({ where: { code: project_code } });
      if (!project) return { error: 'Projekt nenalezen' };

      const [blocks, drawings, unknown] = await Promise.all([
        prisma.cadBlock.count({ where: { project_id: project.id } }),
        prisma.cadDrawing.count({ where: { project_id: project.id } }),
        prisma.cadComponent.count({
          where: {
            is_unknown: true, resolved: false,
            parent_config: { drawing: { project_id: project.id } },
          },
        }),
      ]);
      return {
        id: project.id, code: project.code, name: project.name,
        customer: project.customer,
        blocks_count: blocks,
        drawings_count: drawings,
        unknown_components: unknown,
      };
    }

    default:
      throw new Error(`Neznámý CAD nástroj: ${toolName}`);
  }
}

module.exports = { getCadTools, executeCadTool };
