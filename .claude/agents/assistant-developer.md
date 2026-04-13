# Assistant Developer (AI Asistenti & Skilly)

## Tvůj modul
Systém AI asistentů pro HolyOS. Asistenti jsou obdobou chatbotů vybavených "skilly" (nástroji).
Každý asistent má roli, system prompt a přiřazené skilly z HR, skladů, výroby.
Backend integruje Anthropic SDK s Prisma databází.

## Klíčové soubory

### Backend - Routes
- **routes/ai.routes.js** (12.5 KB) - API pro asistenty, konverzace, skilly, streaming
  - GET /api/ai/modules - auto-detekce modulů
  - GET /api/ai/dashboard/stats - monitoring
  - POST /api/ai/assistants - CRUD
  - POST /api/ai/conversations - nová konverzace
  - POST /api/ai/chat/message - odeslání zprávy (streaming)
  - POST /api/ai/skills/execute - direktní vykonání skilly
- **routes/chat.routes.js** (5 KB) - Chat UI endpointy
- **services/ai/orchestrator.js** - Orchestrátor pro Claude AI + MCP tools
- **services/ai/** - Podpůrné služby

### Backend - MCP Servers
- **mcp-servers/hr-server/index.js** (4.4 KB) - HR MCP tools
- **mcp-servers/warehouse-server/index.js** (4 KB) - Warehouse MCP tools
- **mcp-servers/production-server/index.js** - Production MCP tools
- **mcp-servers/tasks-server/index.js** - Admin tasks MCP tools

### Frontend
- **modules/ai-agenti/index.html** (41 KB) - UI pro správu asistentů (CRUD, testování)
- **js/ai-assistant.js** (28 KB) - Logika asistentů a MCP orchestrálc
- **js/ai-chat-panel.js** (28 KB) - Chat panel pro uživatele (embedded widget)

### Konfigurace
- **.env** - ANTHROPIC_API_KEY, MODEL (claude-sonnet-4-6)

## Datový model

### Klíčové modely Prisma

**Assistant** - AI asistent
```
- id (uuid), name, slug (unique), role (description)
- system_prompt (full), model (default: claude-sonnet-4-6)
- avatar_url, is_active (bool), config (JSON)
- created_at, updated_at
- Vztahy: skills[] (via AssistantSkill), conversations[]
```

**Skill** - Nástroj/funkčnost asistenta
```
- id (uuid), name, slug (unique), description
- category (system, hr, warehouse, production, tasks, custom)
- handler_type (mcp_tool, api_call, db_query, external, javascript)
- handler_config (JSON: {tool_name, mcp_server, endpoint, script})
- input_schema (JSON Schema), output_schema (JSON Schema)
- requires_auth (bool, default: true), is_active (bool)
- created_at, updated_at
- Vztahy: assistants[] (via AssistantSkill), executions[]
```

**AssistantSkill** - Přiřazení skilly asistentovi
```
- assistant_id, skill_id (compound PK)
- priority (int, default: 0, vyšší = první)
- config_override (JSON, přepíše skill.handler_config)
```

**Conversation** - Konverzace s asistentem
```
- id (uuid), user_id (FK), assistant_id (FK)
- title (optional), context (JSON: {{module, page, extra_data}})
- created_at, updated_at
- Vztahy: messages[], assistant
- Index: user_id, assistant_id
```

**Message** - Jednotlivá zpráva v konverzaci
```
- id (uuid), conversation_id (FK)
- role (user|assistant|system), content (text)
- skill_calls (JSON array: [{{skill_id, input, output}}, ...])
- created_at
- Vztahy: conversation, executions[]
- Index: conversation_id
```

**SkillExecution** - Záznam o spuštění skilly
```
- id (uuid), message_id (FK), skill_id (FK)
- input (JSON), output (JSON), status (success|error|timeout)
- duration_ms (int)
- created_at
- Indexy: skill_id, created_at
```

## API endpointy

### Asistenti (Assistants)
- `GET /api/ai/assistants` - Lista asistentů (active, all)
- `GET /api/ai/assistants/:id` - Detail + skilly
- `POST /api/ai/assistants` - Vytvoř asistenta
- `PUT /api/ai/assistants/:id` - Uprav asistenta
- `DELETE /api/ai/assistants/:id` - Smaž asistenta
- `POST /api/ai/assistants/:id/clone` - Duplikuj asistenta

### Skilly (Skills)
- `GET /api/ai/skills` - Lista skillů (category, active)
- `GET /api/ai/skills/:id` - Detail skilly
- `POST /api/ai/skills` - Vytvoř skilly
- `PUT /api/ai/skills/:id` - Uprav skilly
- `DELETE /api/ai/skills/:id` - Smaž skilly

### Přiřazení skillů asistentovi
- `POST /api/ai/assistants/:id/skills` - Přidej skilly asistentovi
- `DELETE /api/ai/assistants/:id/skills/:skillId` - Odeber skilly
- `PUT /api/ai/assistants/:id/skills/:skillId` - Uprav config

### Konverzace & Chat
- `GET /api/ai/conversations` - Moje konverzace (user_id)
- `GET /api/ai/conversations/:id` - Detail konverzace + messages
- `POST /api/ai/conversations` - Nová konverzace
- `DELETE /api/ai/conversations/:id` - Smaž konverzaci
- `POST /api/ai/chat/message` - Odeslání zprávy
  - Input: {conversation_id, message_text, context?: {module, page}}
  - Output: {message_id, role, content, skill_calls: [...], streaming}

### Skillů execution
- `POST /api/ai/skills/execute` - Direktní vykonání skilly (bez konverzace)
  - Input: {skill_id, input: {...}}
  - Output: {status, output, duration_ms, error?}

### Monitoring
- `GET /api/ai/dashboard/stats` - Statistiky (count: assistants, skills, conversations, messages)
- `GET /api/ai/modules` - Auto-detekce modulů z /modules/

## MCP Integration

### Orchestrátor
**services/ai/orchestrator.js** integruje:
1. **Anthropic SDK** - Volání Claude API
2. **MCP Servers** - HR, warehouse, production, tasks
3. **Database** - Prisma (Person, Order, Material, atd.)
4. **Tools** - ClaudeTools Schema z MCP serverů

Typický flow:
```
1. User sends message to assistant
2. Orchestrator calls Claude with:
   - system_prompt (z Assistant)
   - messages history
   - tools (z AssistantSkill prioritizované)
3. Claude selects tools (MCP tool calls)
4. Orchestrator executes tools via MCP
5. Claude generates final response
6. Save Message + SkillExecutions
```

### Available MCP Tools

**HR Server (mcp-servers/hr-server/index.js)**
- list_employees(department, role, active, limit)
- check_attendance(date)
- list_leave_requests(status, limit)

**Warehouse Server (mcp-servers/warehouse-server/index.js)**
- stock_check(material_name, below_minimum, limit)
- list_orders(type, status, limit)
- list_companies(type, search, limit)

**Production Server (mcp-servers/production-server/index.js)**
- list_products(search, type, limit)
- check_operations(product_id, workstation_id)
- plan_production(product_id, quantity, start_date)

**Tasks Server (mcp-servers/tasks-server/index.js)**
- list_admin_tasks(status, priority, limit)
- assign_task(task_id, description)
- complete_task(task_id, status)

## Pravidla

- **Autentizace**: requireAuth middleware
- **Streaming**: POST /api/ai/chat/message vrací server-sent events (text/event-stream)
- **Model**: Default = "claude-sonnet-4-6" (nastavitelné v Assistant.model)
- **Timeout**: Skill execution timeout = 30 sekund, pak status = "timeout"
- **Tools limit**: Jeden message může volat max 10 skillů
- **Čeština**: System prompty, chyby, skill descriptions jsou v češtině
- **Skill handler_type**:
  - `mcp_tool`: Přímo z MCP serveru (handler_config: {tool_name, mcp_server})
  - `api_call`: GET/POST na endpoint (handler_config: {method, endpoint})
  - `db_query`: Direktní Prisma query (handler_config: {query_name, model})
  - `javascript`: Kód v handler_config.script
  - `external`: Volání externího API
- **Context**: Při vytváření konverzace lze předat context (modul, stránka) pro lepší relevanci

## Nezasahuj do

- `routes/hr.routes.js` - HR API (ne AI)
- `routes/warehouse.routes.js` - Sklad API (ne AI)
- `routes/production.routes.js` - Výroba API (ne AI)
- `routes/auth.routes.js` - Autentizace (ne AI)
- `modules/lide-hr/` - HR modul (ne AI)
- `modules/nakup-sklad/` - Sklad modul (ne AI)
- `modules/pracovni-postup/` - Výroba modul (ne AI)
- Databázová schéma (migrace přes prisma migrate)

## Dodatečné poznatky

### Asistent design
- Každý asistent má konkrétní roli (např. "HR Manager", "Warehouse Supervisor", "Production Planner")
- Skill assignment určuje co asistent může dělat (AssistantSkill.priority = pořadí ve kterém se nabízejí)
- Conversation.context se používá pro personalizaci promptu (např. context.module = "lide-hr" → fokus na HR)

### Skill execution
- SkillExecution.status = "timeout" pokud MCP tool neodpověděl v čase
- SkillExecution.input/output jsou JSON pro auditování
- duration_ms měří čas od requestu k responsesu

### Streaming chat
- Frontend očekává server-sent events (event: "message" + data: "...")
- Final event obsahuje skill_calls JSON
- Pokud dojde k chybě během execution, pošli event: "error"

### Debugging
- GET /api/ai/dashboard/stats vrací počty pro monitoring
- Message.skill_calls obsahuje historii všech volání (debug info)
- Každá Skill má input_schema a output_schema pro validaci

### Rozšiřitelnost
- Nový MCP server se přidá do orchestrator.js
- Nový skill se vytvoří přes POST /api/ai/skills
- Nový asistent se vytvoří přes POST /api/ai/assistants + přiřazení skillů
