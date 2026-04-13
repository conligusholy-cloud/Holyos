# HOLYOS Developer Context

Globální pravidla a konvence pro práci s HolyOS kódovou bází.

## Projekt

**HolyOS** - Manufacturing OS  
**Autor**: Tomáš Holý / Best Series s.r.o.  
**Třída**: Manufacturing execution system (MES) pro malé až střední výrobny  
**Cíl**: Kompletní digitalizace výroby: HR, sklad, plánování, simulace, AI asistenti

## Tech Stack

```
Frontend:        Vanilla JavaScript (ES6+), HTML5, CSS3
Backend:         Node.js + Express.js
Database:        PostgreSQL 14+
ORM:             Prisma 6 (migrations, type-safe)
AI:              Anthropic Claude SDK (claude-sonnet-4-6)
MCP:             Model Context Protocol (tools for Claude)
Auth:            JWT (token-based)
Hosting:         Railway.app (PostgreSQL persistent volume at /app/data)
```

## Architektura

```
HolyOS/
├── routes/              # Express route handlers (REST API)
│   ├── auth.routes.js   # Login, register, token
│   ├── hr.routes.js     # HR: people, departments, attendance, leave
│   ├── warehouse.routes.js  # Warehouse: materials, orders, stock
│   ├── production.routes.js # Production: products, operations
│   ├── ai.routes.js     # AI: assistants, skills, conversations
│   ├── chat.routes.js   # Chat UI endpoints
│   └── ...other
├── modules/             # Frontend modules (standalone HTML + JS)
│   ├── lide-hr/         # HR UI
│   ├── nakup-sklad/     # Warehouse UI
│   ├── pracovni-postup/ # Production step UI
│   ├── programovani-vyroby/ # Production planning UI
│   ├── simulace-vyroby/ # Simulation UI
│   ├── vytvoreni-arealu/ # Facility design UI
│   ├── ai-agenti/       # AI assistant UI
│   └── ...other
├── mcp-servers/         # MCP tool implementations
│   ├── hr-server/       # HR tools for Claude
│   ├── warehouse-server/# Warehouse tools for Claude
│   ├── production-server/ # Production tools for Claude
│   └── tasks-server/    # Admin tasks tools
├── services/            # Business logic
│   ├── ai/              # AI orchestrator, Claude integration
│   └── ...other
├── middleware/          # Express middleware (auth, error handling)
├── config/              # Configuration (database, env)
├── prisma/              # Prisma schema + migrations
├── public/              # Static files (login, public assets)
├── js/                  # Shared frontend JS
│   ├── sidebar.js       # Module navigation
│   ├── ai-chat-panel.js # Chat widget
│   └── persistent-storage.js
├── css/                 # Shared CSS
│   └── dashboard.css    # Global styles + CSS variables
├── index.html           # Main dashboard
├── app.js               # Express server entry point
├── .env                 # Environment variables (git-ignored)
├── .env.example         # Template for .env
├── package.json         # Node dependencies
└── prisma/schema.prisma # Data model
```

## Klíčové konvence

### Komentáře & Čeština
- Všechny route descriptions, error messages, UI texty: **ČEŠTINA**
- Soubor header: `// HolyOS — Module description` (čeština)
- Inline comments: Čeština, srozumitelně
- Git commits: Čeština ("Přidej HR API", "Oprav docházku")

### Databáze & Prisma

**Pravidlo #1: Vždy Prisma, nikdy raw SQL**
```javascript
// ✅ DOBRÉ
const people = await prisma.person.findMany({
  where: { active: true },
  include: { department: true }
});

// ❌ ŠPATNÉ
const people = await db.query('SELECT * FROM people WHERE active = true');
```

**Pravidlo #2: Include relationships, ne N+1 queries**
```javascript
// ✅ DOBRÉ (1 query)
const orders = await prisma.order.findMany({
  include: { company: true, items: true, creator: true }
});

// ❌ ŠPATNÉ (N+1 queries)
const orders = await prisma.order.findMany();
orders.forEach(o => o.company = await prisma.company.findUnique(...));
```

**Pravidlo #3: Indexy pro výkon**
- Vždy index na FK (person_id, department_id, etc.)
- Vždy index na frequently filtered fields (status, active, date)
- Composite index na (person_id, date) pro docházku

**Pravidlo #4: Migrations**
```bash
# Po změně schema.prisma:
npx prisma migrate dev --name "popis-zmeny"
# NIKDY: prisma db push (pro dev only, ne produkci)
```

### Backend Routes & API

**Struktura**:
```javascript
// routes/example.routes.js
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth); // Všechny routy vyžadují auth

// GET /api/example
router.get('/', async (req, res, next) => {
  try {
    // logika
    res.json(data);
  } catch (err) {
    next(err); // middleware error handler
  }
});

module.exports = router;
```

**Pravidla**:
- Všechny routy (mimo /auth) mají `router.use(requireAuth)`
- Chyby se passují do `next(err)`, ne `res.status(500).send()`
- Status codes: 200 OK, 201 Created, 400 Bad Request, 404 Not Found, 500 Internal
- Query params pro filtry: `/api/hr/people?search=john&active=true`
- Body pro data: POST/PUT s `Content-Type: application/json`

**Validace**:
```javascript
const { z } = require('zod');

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email()
});

router.post('/', async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  // use parsed.data
});
```

### Frontend

**Vanilla JS bez frameworků**:
- Žádný React, Vue, Angular
- Vanilla ES6+, DOM API, Fetch
- HTML: semantic, accessible
- CSS: CSS variables (--primary, --bg, atd.), flexbox, grid

**Module Structure**:
```javascript
// modules/lide-hr/app.js
(async function() {
  const token = sessionStorage.getItem('token');
  if (!token) window.location = '/public/login.html';
  
  // Fetch data
  const people = await fetch('/api/hr/people', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(r => r.json());
  
  // Render UI
  const tbody = document.querySelector('tbody');
  people.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.first_name}</td><td>${p.email}</td>`;
    tbody.appendChild(tr);
  });
  
  // Event listeners
  document.querySelector('#add-btn').addEventListener('click', () => {
    // modal, form, etc.
  });
})();
```

**Responsive CSS**:
```css
.main-wrapper {
  margin-left: var(--sidebar-w);
  flex: 1;
}

@media (max-width: 768px) {
  .main-wrapper {
    margin-left: 0;
  }
  .sidebar {
    position: fixed;
    left: -100%;
    transition: left 0.3s;
  }
}
```

### AI & MCP

**MCP Server Pattern**:
```javascript
// mcp-servers/hr-server/index.js
function getHrTools() {
  return [
    {
      name: 'list_employees',
      description: 'Vrátí seznam zaměstnanců',
      input_schema: {
        type: 'object',
        properties: {
          department: { type: 'string' },
          limit: { type: 'number', default: 50 }
        }
      }
    }
  ];
}

async function executeHrTool(toolName, params, prisma) {
  switch (toolName) {
    case 'list_employees':
      return await prisma.person.findMany({
        where: { department: { name: params.department } },
        take: params.limit
      });
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { getHrTools, executeHrTool };
```

**Orchestrator** (services/ai/orchestrator.js):
- Initializes Anthropic SDK
- Loads MCP tools from all servers
- Calls Claude with tools
- Executes tool calls against database/APIs
- Saves Message + SkillExecution records

### Authentication & Authorization

**Flow**:
```
1. User sends username + password to POST /api/auth/login
2. Backend hashes password (bcrypt), compares with DB
3. If match: generate JWT token, return {token, user}
4. Frontend stores token in sessionStorage
5. All API requests include: Authorization: Bearer {token}
6. Middleware: requireAuth checks token, extracts user_id
7. User.role + Permission model determine module access
```

**Middleware**:
```javascript
// middleware/auth.js
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth); // All routes protected

// Access control (Optional)
router.use(requireAdmin); // Only admins
```

## Soubory k jejich účelu

| Soubor | Účel |
|--------|------|
| app.js | Express server, PORT, middleware setup |
| routes/*.js | REST API endpointy |
| modules/*/index.html | Frontend UI pro modul |
| modules/*/app.js | JS logika modulu |
| prisma/schema.prisma | Database schema (entities + relationships) |
| mcp-servers/*/index.js | MCP tools pro Claude |
| services/ai/orchestrator.js | Claude API integration |
| middleware/auth.js | Token validation |
| config/database.js | Prisma client |
| js/sidebar.js | Module navigation |
| css/dashboard.css | Global styles + variables |

## Běžný workflow

### Přidání nové feature

1. **Schema**: Uprav `prisma/schema.prisma`
   ```bash
   npx prisma migrate dev --name "add-new-field"
   ```

2. **Route**: Vytvoř/uprav `routes/module.routes.js`
   ```javascript
   router.get('/new-endpoint', requireAuth, async (req, res) => {
     // logika
   });
   ```

3. **Frontend**: Vytvoř/uprav `modules/module/app.js`
   ```javascript
   fetch('/api/module/new-endpoint').then(r => r.json());
   ```

4. **MCP Tool** (pokud relevantní): Uprav `mcp-servers/*/index.js`

5. **Git Commit**:
   ```bash
   git add .
   git commit -m "Přidej novou feature XYZ"
   git push origin feature/xyz
   ```

### Deployment

```bash
# Railway
railway up
# nebo GitHub Actions (if configured)
```

Data se uloží do PostgreSQL persistent volume.

## Debugging

### Frontend
- Chrome DevTools (F12)
- Console.log, Network tab
- localStorage inspection

### Backend
- `console.log(data)` (loguje se do stdout)
- nodemon restart na save
- GET /api/* endpoints bez autentizace (login first)

### Database
```bash
npx prisma studio  # Visual DB explorer (localhost:5555)
```

## Bezpečnost

- **Passwords**: Vždy hash + salt (bcrypt, ne MD5)
- **Tokens**: JWT s expirací (30 minut), refresh token
- **CORS**: Nakonfiguruj podle origin (production vs dev)
- **SQL Injection**: Prisma chrání automaticky
- **XSS**: Sanitize user input (frontend + backend)
- **Sensitive data**: Bank account, birth_number jen pro autentizované user, jen jejich own data

## Dodatečné poznámky

- **Production**: Railway, env vars v CI/CD
- **Database**: PostgreSQL 14+, UTF-8 encoding
- **Rate limiting**: (pokud je potřeba) Middleware express-rate-limit
- **Logging**: Winston (pokud je potřeba) nebo stdout
- **Monitoring**: Application logs, error tracking (optional Sentry)
- **Version**: Node 18+, npm 9+

## Git Flow

```
main (production-ready)
  ├── staging (tested, ready for prod)
  └── feature/module-xyz (development)

Feature branches: feature/*, bugfix/*, hotfix/*
Commits: Czech, imperative mood: "Přidej...", "Oprav..."
```

---

**V případě nejasností konzultuj konkrétní agent context** (hr-developer.md, warehouse-developer.md, atd.).
