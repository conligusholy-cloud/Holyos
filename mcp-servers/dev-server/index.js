// =============================================================================
// HolyOS — Dev MCP Server (in-process)
// Nástroje pro vývojářské agenty: čtení kódu, analýza, návrhy
// =============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

// ─── Tool definitions (Claude tool_use format) ────────────────────────────

// Kompaktní verze nástrojů — 4 místo 8 (šetří tokeny pro rate limit)
function getDevTools() {
  return [
    {
      name: 'read_file',
      description: 'Přečte soubor. Pokud path končí /, vypíše adresář.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relativní cesta (routes/hr.routes.js nebo modules/lide-hr/)' },
          start_line: { type: 'number' },
          end_line: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_code',
      description: 'Hledá text v projektu. Vrátí nalezené řádky.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string' },
          file_pattern: { type: 'string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_info',
      description: 'Vrátí info o projektu. action: "schema" (Prisma model), "module" (analýza modulu), "routes" (API endpointy), "context" (agent kontext).',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['schema', 'module', 'routes', 'context'] },
          target: { type: 'string', description: 'Název modelu/modulu/route souboru/agenta' },
        },
        required: ['action'],
      },
    },
    {
      name: 'propose_change',
      description: 'Navrhne změnu kódu pro review. NEAPLIKUJE ji.',
      input_schema: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          description: { type: 'string' },
          old_code: { type: 'string' },
          new_code: { type: 'string' },
          type: { type: 'string', enum: ['bugfix', 'feature', 'refactor', 'optimization'] },
        },
        required: ['file', 'description', 'old_code', 'new_code'],
      },
    },
  ];
}

// Plné nástroje (pro budoucí vyšší tier)
function getDevToolsFull() {
  return [
    ...getDevTools(),
    {
      name: 'list_files',
      description: 'Seznam souborů v adresáři.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          recursive: { type: 'boolean' },
          pattern: { type: 'string' },
        },
        required: ['path'],
      },
    },
  ];
}

// ─── Tool execution ───────────────────────────────────────────────────────

async function executeDevTool(toolName, params) {
  switch (toolName) {
    case 'read_file':
      return readFile(params);
    case 'list_files':
      return listFiles(params);
    case 'search_code':
      return searchCode(params);
    case 'get_info':
      return getInfo(params);
    // Zpětná kompatibilita — staré názvy nástrojů
    case 'analyze_module':
      return analyzeModule(params);
    case 'get_prisma_schema':
      return getPrismaSchema(params);
    case 'get_route_endpoints':
      return getRouteEndpoints(params);
    case 'get_agent_context':
      return getAgentContext(params);
    case 'propose_change':
      return proposeChange(params);
    default:
      return { error: `Neznámý nástroj: ${toolName}` };
  }
}

// Sloučený info nástroj
function getInfo({ action, target }) {
  switch (action) {
    case 'schema':
      return getPrismaSchema({ model: target });
    case 'module':
      return analyzeModule({ module: target });
    case 'routes':
      return getRouteEndpoints({ route_file: target });
    case 'context':
      return getAgentContext({ agent: target });
    default:
      return { error: `Neznámá akce: ${action}. Použij: schema, module, routes, context` };
  }
}

// ─── Tool implementations ─────────────────────────────────────────────────

function readFile({ path: filePath, start_line, end_line }) {
  const fullPath = path.join(ROOT, filePath);
  if (!fs.existsSync(fullPath)) return { error: `Neexistuje: ${filePath}` };

  // Pokud je adresář, vrať listing
  if (fs.statSync(fullPath).isDirectory()) {
    return listFiles({ path: filePath, recursive: false });
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');

  if (start_line || end_line) {
    const start = Math.max(1, start_line || 1) - 1;
    const end = Math.min(lines.length, end_line || lines.length);
    return {
      path: filePath,
      totalLines: lines.length,
      range: `${start + 1}-${end}`,
      content: lines.slice(start, end).join('\n'),
    };
  }

  // Omezit na 500 řádků
  if (lines.length > 500) {
    return {
      path: filePath,
      totalLines: lines.length,
      truncated: true,
      content: lines.slice(0, 500).join('\n') + '\n\n// ... [zkráceno, celkem ' + lines.length + ' řádků]',
    };
  }

  return { path: filePath, totalLines: lines.length, content };
}

function listFiles({ path: dirPath, recursive, pattern }) {
  const fullPath = path.join(ROOT, dirPath || '');
  if (!fs.existsSync(fullPath)) return { error: `Adresář neexistuje: ${dirPath}` };

  const entries = [];
  function walk(dir, prefix) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'dist') continue;
      const rel = prefix ? prefix + '/' + item.name : item.name;

      if (pattern && !item.isDirectory()) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        if (!regex.test(item.name)) continue;
      }

      if (item.isDirectory()) {
        entries.push({ name: rel, type: 'dir' });
        if (recursive) walk(path.join(dir, item.name), rel);
      } else {
        const stat = fs.statSync(path.join(dir, item.name));
        entries.push({ name: rel, type: 'file', size: stat.size });
      }
    }
  }

  walk(fullPath, '');
  return { path: dirPath || '.', count: entries.length, entries };
}

function searchCode({ query, path: searchPath, file_pattern, max_results = 20 }) {
  const dir = path.join(ROOT, searchPath || '');
  try {
    let cmd = `grep -rn --include='${file_pattern || '*.js'}' '${query.replace(/'/g, "'\\''")}'  '${dir}' | head -${max_results}`;
    // Také hledat v HTML
    if (!file_pattern) {
      cmd = `grep -rn --include='*.js' --include='*.html' --include='*.json' '${query.replace(/'/g, "'\\''")}'  '${dir}' | grep -v node_modules | grep -v dist | head -${max_results}`;
    }
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    const matches = result.split('\n').filter(l => l).map(line => {
      const parts = line.match(/^(.*?):(\d+):(.*)/);
      if (!parts) return { raw: line };
      return {
        file: parts[1].replace(ROOT + '/', ''),
        line: parseInt(parts[2]),
        content: parts[3].trim(),
      };
    });
    return { query, matchCount: matches.length, matches };
  } catch (e) {
    return { query, matchCount: 0, matches: [], note: 'Žádné výsledky' };
  }
}

function analyzeModule({ module }) {
  const modulePath = path.join(ROOT, 'modules', module);
  if (!fs.existsSync(modulePath)) return { error: `Modul neexistuje: ${module}` };

  // Soubory modulu
  const files = [];
  function walk(dir, prefix) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const rel = prefix ? prefix + '/' + item.name : item.name;
      if (item.isDirectory()) {
        walk(path.join(dir, item.name), rel);
      } else {
        const stat = fs.statSync(path.join(dir, item.name));
        files.push({ name: rel, size: stat.size, ext: path.extname(item.name) });
      }
    }
  }
  walk(modulePath, '');

  // Najdi odpovídající route soubor
  const routeMap = {
    'lide-hr': 'hr.routes.js',
    'nakup-sklad': 'warehouse.routes.js',
    'ai-agenti': 'ai.routes.js',
    'admin-tasks': 'admin-tasks.routes.js',
    'pracovni-postup': 'production.routes.js',
    'programovani-vyroby': 'production.routes.js',
    'simulace-vyroby': 'production.routes.js',
    'audit-log': 'audit.routes.js',
  };

  const routeFile = routeMap[module];
  let endpoints = [];
  if (routeFile) {
    const routeResult = getRouteEndpoints({ route_file: routeFile });
    endpoints = routeResult.endpoints || [];
  }

  // Najdi MCP server
  const mcpMap = {
    'lide-hr': 'hr-server',
    'nakup-sklad': 'warehouse-server',
    'pracovni-postup': 'production-server',
    'programovani-vyroby': 'production-server',
    'simulace-vyroby': 'production-server',
    'ai-agenti': null,
    'admin-tasks': 'tasks-server',
  };

  return {
    module,
    path: `modules/${module}`,
    totalFiles: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    files,
    routeFile: routeFile || null,
    endpointCount: endpoints.length,
    mcpServer: mcpMap[module] || null,
  };
}

function getPrismaSchema({ model }) {
  const schemaPath = path.join(ROOT, 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) return { error: 'Prisma schema neexistuje' };

  const content = fs.readFileSync(schemaPath, 'utf-8');

  if (!model) {
    // Vrátit přehled modelů
    const models = content.match(/^model \w+/gm) || [];
    return {
      modelCount: models.length,
      models: models.map(m => m.replace('model ', '')),
      schemaSize: content.length,
    };
  }

  // Najít konkrétní model
  const regex = new RegExp(`model ${model} \\{[\\s\\S]*?^\\}`, 'm');
  const match = content.match(regex);
  if (!match) return { error: `Model '${model}' nenalezen v schema` };

  return { model, definition: match[0] };
}

function getRouteEndpoints({ route_file }) {
  const routePath = path.join(ROOT, 'routes', route_file);
  if (!fs.existsSync(routePath)) return { error: `Route soubor neexistuje: ${route_file}` };

  const content = fs.readFileSync(routePath, 'utf-8');
  const endpoints = [];
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const match = line.match(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/i);
    if (match) {
      // Najdi popis z komentáře nad endpointem
      let comment = '';
      for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
        if (lines[i].trim().startsWith('//')) {
          comment = lines[i].trim().replace(/^\/\/\s*/, '');
          break;
        }
      }
      endpoints.push({
        method: match[1].toUpperCase(),
        path: match[2],
        line: idx + 1,
        comment: comment || null,
      });
    }
  });

  return { file: route_file, endpointCount: endpoints.length, endpoints };
}

function getAgentContext({ agent }) {
  const agentMap = {
    hr: 'hr-developer.md',
    warehouse: 'warehouse-developer.md',
    production: 'production-developer.md',
    assistant: 'assistant-developer.md',
    frontend: 'frontend-developer.md',
  };

  const filename = agentMap[agent];
  if (!filename) return { error: `Neznámý agent: ${agent}. Dostupné: ${Object.keys(agentMap).join(', ')}` };

  const contextPath = path.join(ROOT, '.claude', 'agents', filename);
  if (!fs.existsSync(contextPath)) return { error: `Kontextový soubor neexistuje: ${contextPath}` };

  return {
    agent,
    file: `.claude/agents/${filename}`,
    content: fs.readFileSync(contextPath, 'utf-8'),
  };
}

function proposeChange({ file, description, old_code, new_code, type }) {
  // Ověř že soubor existuje
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) return { error: `Soubor neexistuje: ${file}` };

  const content = fs.readFileSync(fullPath, 'utf-8');
  if (!content.includes(old_code)) {
    return { error: `Starý kód nebyl nalezen v souboru ${file}`, suggestion: 'Zkontroluj přesné znění starého kódu.' };
  }

  return {
    proposal: {
      file,
      type: type || 'feature',
      description,
      diff: {
        removed: old_code,
        added: new_code,
      },
      linesAffected: old_code.split('\n').length,
      status: 'pending_review',
    },
    note: 'Změna je připravena k review. Pro aplikaci musí být schválena uživatelem.',
  };
}

module.exports = { getDevTools, getDevToolsFull, executeDevTool };
