# HolyOS — Architektonický plán

> Datum: 13. dubna 2026  
> Verze: 2.0  
> Autor: Tomáš Holý + Claude

---

## 1. Současný stav

HolyOS je monolitický systém v čistém Node.js bez frameworku. Vše běží v jednom `server.js` (1400+ řádků), data se ukládají do JSON souborů a frontend je statické HTML/JS. Factorify slouží jako hlavní zdroj dat pro výrobní entity (produkty, pracoviště).

**Co funguje dobře:**
- 8 funkčních modulů (HR, sklad, simulace, mindmapa, admin úkoly, audit log)
- Základní voice AI přes Whisper + Claude
- Autentizace se sessions a RBAC oprávněními
- Audit trail s rollback možností

**Co je potřeba změnit:**
- Monolitický server → modulární backend
- JSON soubory → databáze
- Závislost na Factorify → vlastní data
- Žádná vrstva pro AI asistenty a skilly

---

## 2. Cílová architektura

Systém má **tři vrstvy agentů**:
- **Provozní asistenti** — pomáhají uživatelům s denní prací (sklad, HR, výroba)
- **Vývojářští agenti** — programují a vylepšují jednotlivé moduly HolyOS
- **Orchestrátor** — koordinuje agenty, routuje požadavky, řídí MCP servery

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────────┐ │
│  │ Moduly   │ │ Dashboard│ │ Panel     │ │ Dev Hub       │ │
│  │ (HR,     │ │ & přehled│ │ asistentů │ │ (úkoly pro    │ │
│  │  sklad,  │ │          │ │ (chat,    │ │  vývojářské   │ │
│  │  výroba) │ │          │ │  správa)  │ │  agenty)      │ │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └──────┬────────┘ │
└───────┼─────────────┼─────────────┼──────────────┼──────────┘
        │             │             │              │
        ▼             ▼             ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API GATEWAY                                │
│            (Express.js + middleware)                          │
│     Auth │ CORS │ Rate limit │ Logging │ Validation          │
└────┬──────────┬────────────────┬─────────────┬──────────────┘
     │          │                │             │
     ▼          ▼                ▼             ▼
┌─────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────────┐
│  REST   │ │ Moduly   │ │ ORCHESTR.  │ │ VÝVOJÁŘŠTÍ       │
│  API    │ │ (HR,     │ │ ASISTENTŮ  │ │ AGENTI           │
│  routes │ │  sklad,  │ │            │ │                  │
│         │ │  výroba) │ │ Claude     │ │ ┌─ HR dev ─────┐ │
│         │ │          │ │ Agent SDK  │ │ │ zná kód HR   │ │
│         │ │          │ │            │ │ │ modulu       │ │
│         │ │          │ │ ┌────────┐ │ │ └──────────────┘ │
│         │ │          │ │ │MCP srv.│ │ │ ┌─ Sklad dev ──┐ │
│         │ │          │ │ │HR      │ │ │ │ zná kód      │ │
│         │ │          │ │ │Sklad   │ │ │ │ skladu       │ │
│         │ │          │ │ │Výroba  │ │ │ └──────────────┘ │
│         │ │          │ │ │Tasks   │ │ │ ┌─ Výroba dev ─┐ │
│         │ │          │ │ └────────┘ │ │ │ zná kód      │ │
│         │ │          │ │            │ │ │ výroby       │ │
│         │ │          │ └────────────┘ │ └──────────────┘ │
└────┬────┘ └────┬─────┘       │        └────────┬─────────┘
     │           │             │                 │
     ▼           ▼             ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                       DATABÁZE                               │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────────────┐ │
│  │ PostgreSQL │ │ Redis      │ │ pgvector                 │ │
│  │ (hlavní    │ │ (sessions, │ │ (AI kontext, embeddingy, │ │
│  │  data)     │ │  cache,    │ │  paměť asistentů)        │ │
│  │            │ │  fronty)   │ │                          │ │
│  └────────────┘ └────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Systém asistentů a skillů

### 3.1 Co je asistent

Asistent je autonomní AI agent, který má:
- **Identitu** — jméno, role, popis, avatar
- **Kontext** — přístup k relevantním datům z HolyOS
- **Skilly** — sada schopností, které může vykonávat
- **Paměť** — historii konverzací a naučené poznatky
- **Oprávnění** — co smí a nesmí dělat

### 3.2 Co je skill

Skill je konkrétní schopnost, kterou asistent může použít. Každý skill má:
- **Název a popis**
- **Vstupní parametry** (co potřebuje vědět)
- **Výstup** (co vrátí nebo udělá)
- **Typ akce** — interní (v systému) nebo externí (mimo systém)

### 3.3 Příklady asistentů a jejich skillů

```
┌─────────────────────────────────────────────────┐
│  VÝROBNÍ ASISTENT "Mistr"                       │
│  Role: Řízení výroby a plánování                │
│                                                 │
│  Skilly:                                        │
│  ├── plan-production     Naplánovat výrobu      │
│  ├── check-stock         Ověřit stav skladu     │
│  ├── assign-workstation  Přiřadit pracoviště    │
│  ├── notify-team         Upozornit tým          │
│  └── generate-report     Vytvořit report        │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  HR ASISTENT "Personalista"                     │
│  Role: Správa lidí a docházky                   │
│                                                 │
│  Skilly:                                        │
│  ├── manage-attendance   Správa docházky        │
│  ├── approve-leave       Schválit dovolenou     │
│  ├── onboard-employee    Nástup zaměstnance     │
│  ├── check-documents     Kontrola dokumentů     │
│  └── assign-shift        Přiřadit směnu         │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  SKLADOVÝ ASISTENT "Skladník"                   │
│  Role: Řízení zásob a objednávek                │
│                                                 │
│  Skilly:                                        │
│  ├── check-inventory     Stav zásob             │
│  ├── create-order        Vytvořit objednávku    │
│  ├── receive-goods       Příjem zboží           │
│  ├── alert-low-stock     Upozornit nízký stav   │
│  └── find-material       Najít materiál         │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  TASK ASISTENT "Koordinátor"                    │
│  Role: Delegování úkolů na lidi                 │
│                                                 │
│  Skilly:                                        │
│  ├── create-task         Vytvořit úkol          │
│  ├── assign-person       Přiřadit osobu         │
│  ├── track-progress      Sledovat průběh        │
│  ├── send-reminder       Poslat připomínku      │
│  └── escalate            Eskalovat problém      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  PC ASISTENT "Technik"                          │
│  Role: Práce se soubory a systémem              │
│                                                 │
│  Skilly:                                        │
│  ├── create-document     Vytvořit dokument      │
│  ├── process-data        Zpracovat data         │
│  ├── generate-chart      Vytvořit graf          │
│  ├── export-pdf          Exportovat do PDF      │
│  └── send-email          Odeslat email          │
└─────────────────────────────────────────────────┘
```

### 3.4 Orchestrace — jak asistenti spolupracují

Klíčová je vrstva **Orchestrátoru**, která:

1. Přijme požadavek od uživatele (text/hlas)
2. Rozhodne, který asistent(i) ho zpracují
3. Asistent vybere relevantní skilly
4. Skilly se vykonají (sekvenčně nebo paralelně)
5. Výsledek se vrátí uživateli

```
Uživatel: "Potřebuji objednat materiál na zakázku Z-2024-15"
    │
    ▼
Orchestrátor → analyzuje požadavek
    │
    ├─► Skladový asistent
    │   ├── check-inventory (zkontroluje co chybí)
    │   └── create-order (vytvoří objednávku)
    │
    └─► Koordinátor
        ├── create-task (úkol "Ověřit dodací lhůtu")
        └── assign-person (přiřadí nákupčího)
    │
    ▼
Odpověď: "Vytvořil jsem objednávku OBJ-456 na chybějící
materiály. Honza z nákupu dostal úkol ověřit dodací lhůtu."
```

---

## 4. Datový model asistentů a skillů

### 4.1 Tabulka: assistants

| Sloupec         | Typ        | Popis                          |
|-----------------|------------|--------------------------------|
| id              | UUID       | Primární klíč                  |
| name            | VARCHAR    | Název asistenta                |
| slug            | VARCHAR    | URL-friendly identifikátor     |
| role            | TEXT       | Popis role                     |
| system_prompt   | TEXT       | Systémový prompt pro AI        |
| model           | VARCHAR    | Který AI model použít          |
| avatar_url      | VARCHAR    | URL avataru                    |
| is_active       | BOOLEAN    | Aktivní/neaktivní              |
| config          | JSONB      | Další konfigurace              |
| created_at      | TIMESTAMP  | Vytvořeno                      |
| updated_at      | TIMESTAMP  | Upraveno                       |

### 4.2 Tabulka: skills

| Sloupec         | Typ        | Popis                          |
|-----------------|------------|--------------------------------|
| id              | UUID       | Primární klíč                  |
| name            | VARCHAR    | Název skillu                   |
| slug            | VARCHAR    | Identifikátor                  |
| description     | TEXT       | Co skill dělá                  |
| category        | VARCHAR    | Kategorie (system/data/notify) |
| handler_type    | VARCHAR    | api_call / db_query / external |
| handler_config  | JSONB      | Konfigurace handleru           |
| input_schema    | JSONB      | JSON Schema vstupů             |
| output_schema   | JSONB      | JSON Schema výstupů            |
| requires_auth   | BOOLEAN    | Vyžaduje oprávnění             |
| is_active       | BOOLEAN    | Aktivní                        |

### 4.3 Tabulka: assistant_skills (M:N vazba)

| Sloupec        | Typ    | Popis                     |
|----------------|--------|---------------------------|
| assistant_id   | UUID   | FK na assistants          |
| skill_id       | UUID   | FK na skills              |
| priority       | INT    | Priorita skillu           |
| config_override| JSONB  | Přepsání konfigurace      |

### 4.4 Tabulka: conversations

| Sloupec        | Typ        | Popis                     |
|----------------|------------|---------------------------|
| id             | UUID       | Primární klíč             |
| user_id        | UUID       | FK na users               |
| assistant_id   | UUID       | FK na assistants          |
| title          | VARCHAR    | Název konverzace          |
| context        | JSONB      | Kontext (modul, stránka)  |
| created_at     | TIMESTAMP  | Vytvořeno                 |

### 4.5 Tabulka: messages

| Sloupec        | Typ        | Popis                          |
|----------------|------------|--------------------------------|
| id             | UUID       | Primární klíč                  |
| conversation_id| UUID       | FK na conversations            |
| role           | VARCHAR    | user / assistant / system      |
| content        | TEXT       | Obsah zprávy                   |
| skill_calls    | JSONB      | Které skilly byly použity      |
| created_at     | TIMESTAMP  | Vytvořeno                      |

### 4.6 Tabulka: skill_executions (log)

| Sloupec        | Typ        | Popis                          |
|----------------|------------|--------------------------------|
| id             | UUID       | Primární klíč                  |
| message_id     | UUID       | FK na messages                 |
| skill_id       | UUID       | FK na skills                   |
| input          | JSONB      | Vstupní data                   |
| output         | JSONB      | Výstupní data                  |
| status         | VARCHAR    | success / error / timeout      |
| duration_ms    | INT        | Doba trvání                    |
| created_at     | TIMESTAMP  | Vytvořeno                      |

---

## 5. Nová struktura backendu

```
holyos/
├── server.js                    # Entry point (minimální, jen startuje app)
├── package.json
├── .env
│
├── config/
│   ├── database.js              # DB připojení
│   ├── redis.js                 # Redis připojení
│   └── ai.js                    # AI konfigurace (API klíče, modely)
│
├── middleware/
│   ├── auth.js                  # JWT autentizace
│   ├── permissions.js           # RBAC kontrola
│   ├── validation.js            # Validace vstupů
│   └── error-handler.js         # Centrální zpracování chyb
│
├── routes/
│   ├── auth.routes.js           # /api/auth/*
│   ├── hr.routes.js             # /api/hr/*
│   ├── warehouse.routes.js      # /api/wh/*
│   ├── production.routes.js     # /api/production/*
│   ├── assistant.routes.js      # /api/assistants/*
│   └── skill.routes.js          # /api/skills/*
│
├── controllers/
│   ├── auth.controller.js
│   ├── hr.controller.js
│   ├── warehouse.controller.js
│   ├── assistant.controller.js
│   └── skill.controller.js
│
├── models/                      # Databázové modely (Knex/Prisma)
│   ├── User.js
│   ├── Person.js
│   ├── Material.js
│   ├── Order.js
│   ├── Assistant.js
│   ├── Skill.js
│   ├── Conversation.js
│   └── Message.js
│
├── services/
│   ├── ai/
│   │   ├── orchestrator.js      # Hlavní orchestrátor asistentů
│   │   ├── assistant-runner.js  # Spuštění konkrétního asistenta
│   │   ├── skill-executor.js    # Vykonání skillu
│   │   └── context-builder.js   # Sestavení kontextu z DB
│   │
│   ├── hr.service.js
│   ├── warehouse.service.js
│   └── audit.service.js
│
├── skills/                      # Implementace jednotlivých skillů
│   ├── system/
│   │   ├── create-document.js
│   │   ├── send-email.js
│   │   └── generate-report.js
│   ├── hr/
│   │   ├── manage-attendance.js
│   │   ├── approve-leave.js
│   │   └── check-documents.js
│   ├── warehouse/
│   │   ├── check-inventory.js
│   │   ├── create-order.js
│   │   └── alert-low-stock.js
│   └── tasks/
│       ├── create-task.js
│       ├── assign-person.js
│       └── send-reminder.js
│
├── migrations/                  # DB migrace
│   ├── 001_create_users.js
│   ├── 002_create_hr_tables.js
│   ├── 003_create_warehouse_tables.js
│   ├── 004_create_assistant_tables.js
│   └── 005_migrate_factorify_data.js
│
├── seeds/                       # Výchozí data
│   ├── default-assistants.js
│   └── default-skills.js
│
└── public/                      # Frontend (statické soubory)
    ├── index.html
    ├── css/
    ├── js/
    └── modules/
```

---

## 6. Postup migrace — 5 fází

### Fáze 1: Databáze (1–2 týdny)

**Cíl:** Přejít z JSON souborů na PostgreSQL

1. Nainstalovat PostgreSQL na Railway (addon)
2. Vytvořit migrace pro všechny tabulky (users, people, departments, materials, orders...)
3. Napsat migrační skript: JSON → PostgreSQL
4. Přepojit stávající API endpointy na novou DB
5. Otestovat, že vše funguje jako předtím

**Proč PostgreSQL:**
- Podpora JSONB (flexibilní jako JSON soubory, ale s indexy)
- pgvector rozšíření pro AI kontext (vektorové embeddingy)
- Transakce a ACID (žádné race conditions)
- Railway má nativní podporu

### Fáze 2: Refaktoring backendu (1–2 týdny)

**Cíl:** Rozdělit monolitický server.js na moduly

1. Přejít na Express.js (nebo Fastify)
2. Extrahovat routes, controllers, services
3. Přejít ze sessions na JWT tokeny
4. Implementovat middleware (auth, validace, error handling)
5. Zachovat zpětnou kompatibilitu s frontendem

### Fáze 3: KOMPLETNÍ odpojení Factorify (1–2 týdny)

**Cíl:** Stáhnout VŠECHNA data z Factorify, uložit do vlastní DB, Factorify úplně odstranit

Factorify se v budoucnu nebude používat vůbec — žádné API, žádný proxy, žádný sync.
HolyOS bude jediný zdroj pravdy.

1. Zmapovat všechny Factorify entity, které se dnes používají (Item, Stage, a další)
2. Vytvořit odpovídající tabulky v PostgreSQL (products, workstations, atd.)
3. Napsat jednorázový migrační skript: Factorify API → PostgreSQL dump
4. Spustit migraci, ověřit kompletnost dat
5. Přepsat frontend moduly — nahradit volání Factorify proxy za vlastní API:
   - `modules/pracovni-postup/` → vlastní `/api/production/products`
   - `modules/vytvoreni-arealu/` → vlastní `/api/production/workstations`
   - `modules/programovani-vyroby/` → vlastní `/api/production/workstations`
   - `modules/simulace-vyroby/` → vlastní `/api/production/simulations`
6. **Smazat** veškerý Factorify kód:
   - `proxy-server.js` — celý soubor pryč
   - `api-config.js` — celý soubor pryč
   - Všechny `factorify-api.js` v modulech — pryč
   - Factorify proxy routes v `server.js` — pryč
   - `FACTORIFY_TOKEN` z `.env` — pryč
7. Ověřit, že nikde v kódu nezůstal žádný odkaz na `factorify` nebo `bs.factorify.cloud`
8. Data z Factorify jsou teď plně v PostgreSQL, HolyOS je jediný systém

### Fáze 4: MCP servery + Agent SDK (2–3 týdny)

**Cíl:** Vystavit moduly jako MCP servery, zprovoznit orchestraci přes Claude Agent SDK

1. Nainstalovat `@modelcontextprotocol/sdk` a `@anthropic-ai/sdk`
2. Vytvořit MCP server pro sklad (první, nejjednodušší)
3. Vytvořit MCP server pro HR
4. Vytvořit MCP server pro úkoly
5. Implementovat orchestrátor (router → agent → MCP tools)
6. Vytvořit DB tabulky (assistants, skills, conversations, messages)
7. Přidat logování skill_executions
8. Otestovat end-to-end: uživatel → orchestrátor → agent → MCP → DB → odpověď

### Fáze 5: Frontend panel asistentů (1–2 týdny)

**Cíl:** UI pro správu a interakci s asistenty

1. Dashboard asistentů — přehled, stav, statistiky
2. Konfigurátor — vytvořit/upravit asistenta, přiřadit skilly
3. Chat interface — konverzace s asistentem v kontextu modulu
4. Monitoring — log vykonaných skillů, úspěšnost, chyby
5. Voice interface — rozšířit stávající voice AI

### Fáze 6: Vývojářští agenti (2 týdny)

**Cíl:** Agent na každý modul, který umí programovat a navrhovat vylepšení

1. Vytvořit kontextové soubory (.claude/agents/*.md) pro každý modul
2. Vytvořit MCP dev-server (čtení kódu, zápis, testy, git)
3. Implementovat Dev Hub UI (zadávání úkolů, review návrhů)
4. Zprovoznit reaktivní režim (Tomáš zadá úkol → agent implementuje)
5. Později: proaktivní režim (agent navrhuje vylepšení)

---

## 7. Technologický stack

| Vrstva            | Technologie              | Důvod                              |
|-------------------|--------------------------|------------------------------------|
| Runtime           | Node.js 20+             | Už používáš, zachovat              |
| Framework         | Express.js              | Nejrozšířenější, velký ekosystém   |
| Databáze          | PostgreSQL + pgvector   | Relační data + AI embeddingy       |
| ORM               | Prisma                  | Type-safe, skvělé migrace          |
| Cache             | Redis                   | Sessions, fronty úkolů, cache      |
| **Agent runtime** | **Claude Agent SDK**    | **Orchestrace agentů, multi-agent**|
| **Agent tools**   | **MCP servery**         | **Standardní protokol pro nástroje**|
| AI                | Claude API (tool use)   | Nativní function calling pro skilly|
| Auth              | JWT + bcrypt            | Stateless, škálovatelné            |
| Hosting           | Railway                 | Už používáš                        |
| Frontend          | Vanilla JS (zatím)      | Postupná modernizace později       |

---

## 7.1 MCP servery — jak fungují v HolyOS

**MCP (Model Context Protocol)** je standard od Anthropicu, který odděluje AI agenta od nástrojů.
Místo toho, aby agent přímo volal databázi, komunikuje přes MCP server, který mu vystaví
standardizované nástroje (tools).

### Proč MCP a ne přímé volání?

- **Bezpečnost** — MCP server kontroluje co agent smí a nesmí, agent nikdy nepřistupuje k DB přímo
- **Znovupoužitelnost** — stejný MCP server můžeš napojit na provozního i vývojářského agenta
- **Standardní protokol** — jakýkoli agent (Claude, GPT, lokální LLM) může použít tvé MCP servery
- **Izolace** — když MCP server spadne, nezasáhne to zbytek systému

### MCP servery pro HolyOS

```
holyos/
├── mcp-servers/
│   ├── hr-server/                # MCP server pro HR data
│   │   ├── index.js              # Server entry point
│   │   └── tools/
│   │       ├── get-employees.js  # Seznam zaměstnanců
│   │       ├── check-attendance.js
│   │       ├── manage-leave.js
│   │       └── get-hr-stats.js
│   │
│   ├── warehouse-server/         # MCP server pro sklad
│   │   ├── index.js
│   │   └── tools/
│   │       ├── check-inventory.js
│   │       ├── create-order.js
│   │       ├── receive-goods.js
│   │       └── get-stock-alerts.js
│   │
│   ├── production-server/        # MCP server pro výrobu
│   │   ├── index.js
│   │   └── tools/
│   │       ├── get-workstations.js
│   │       ├── plan-production.js
│   │       └── get-simulations.js
│   │
│   ├── tasks-server/             # MCP server pro úkoly
│   │   ├── index.js
│   │   └── tools/
│   │       ├── create-task.js
│   │       ├── assign-task.js
│   │       ├── get-tasks.js
│   │       └── send-notification.js
│   │
│   └── dev-server/               # MCP server pro vývojářské agenty
│       ├── index.js
│       └── tools/
│           ├── read-module-code.js
│           ├── write-code.js
│           ├── run-tests.js
│           ├── git-commit.js
│           └── analyze-module.js
```

### Příklad MCP serveru (TypeScript/Node.js)

```javascript
// mcp-servers/warehouse-server/index.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { db } from '../../config/database.js';

const server = new McpServer({
  name: 'holyos-warehouse',
  version: '1.0.0',
  description: 'MCP server pro skladové operace HolyOS'
});

// Tool: Zkontrolovat zásoby
server.tool(
  'check-inventory',
  'Zkontroluje aktuální stav zásob materiálu ve skladu',
  {
    material_name: z.string().optional().describe('Název materiálu (hledá částečnou shodu)'),
    warehouse_id: z.string().optional().describe('ID konkrétního skladu'),
    only_low_stock: z.boolean().optional().describe('Jen materiály pod minimem')
  },
  async ({ material_name, warehouse_id, only_low_stock }) => {
    let query = db.material.findMany({
      include: { warehouse: true, movements: { take: 10, orderBy: { created_at: 'desc' } } }
    });

    if (material_name) {
      query = query.where({ name: { contains: material_name, mode: 'insensitive' } });
    }

    const materials = await query;
    const results = materials
      .map(m => ({
        id: m.id,
        name: m.name,
        current_qty: m.current_quantity,
        unit: m.unit,
        min_level: m.reorder_level,
        is_low: m.current_quantity <= m.reorder_level,
        warehouse: m.warehouse?.name
      }))
      .filter(m => !only_low_stock || m.is_low);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results, null, 2)
      }]
    };
  }
);

// Tool: Vytvořit objednávku
server.tool(
  'create-order',
  'Vytvoří novou objednávku materiálu u dodavatele',
  {
    supplier_id: z.string().describe('ID dodavatele'),
    items: z.array(z.object({
      material_id: z.string(),
      quantity: z.number(),
      note: z.string().optional()
    })).describe('Položky objednávky')
  },
  async ({ supplier_id, items }) => {
    const order = await db.order.create({
      data: {
        type: 'purchase',
        supplier_id,
        status: 'draft',
        items: { create: items }
      }
    });

    return {
      content: [{
        type: 'text',
        text: `Objednávka ${order.code} vytvořena (${items.length} položek). Status: koncept.`
      }]
    };
  }
);

// Spuštění serveru
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 7.2 Claude Agent SDK — orchestrace agentů

Claude Agent SDK řídí, který agent se zapojí a jaké MCP servery má k dispozici.

### Příklad: Orchestrátor s více agenty

```javascript
// services/ai/orchestrator.js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Definice agentů — každý má přístup k jiným MCP serverům
const AGENTS = {
  skladnik: {
    name: 'Skladník',
    model: 'claude-sonnet-4-6',
    system: `Jsi skladový asistent systému HolyOS. Pomáháš se správou
             zásob, objednávkami a příjmem materiálu. Odpovídáš česky.
             Vždy ověř stav zásob před vytvořením objednávky.`,
    mcpServers: ['holyos-warehouse']
  },
  personalista: {
    name: 'Personalista',
    model: 'claude-sonnet-4-6',
    system: `Jsi HR asistent systému HolyOS. Spravuješ docházku,
             dovolené, směny a zaměstnance. Odpovídáš česky.`,
    mcpServers: ['holyos-hr']
  },
  koordinator: {
    name: 'Koordinátor',
    model: 'claude-sonnet-4-6',
    system: `Jsi task manager systému HolyOS. Vytváříš úkoly,
             přiřazuješ je lidem a hlídáš termíny. Odpovídáš česky.`,
    mcpServers: ['holyos-tasks', 'holyos-hr']  // Vidí i lidi pro přiřazení
  },
  mistr: {
    name: 'Mistr',
    model: 'claude-sonnet-4-6',
    system: `Jsi výrobní asistent systému HolyOS. Plánuješ výrobu,
             přiřazuješ pracoviště a optimalizuješ procesy. Odpovídáš česky.`,
    mcpServers: ['holyos-production', 'holyos-warehouse']
  }
};

// Hlavní router — rozhodne, který agent(i) požadavek zpracují
async function routeRequest(userMessage, context) {
  // Krok 1: Claude rozhodne, kdo je nejlepší agent pro tento požadavek
  const routing = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',  // Rychlý model pro routing
    system: `Jsi router. Na základě zprávy uživatele urči, který agent(i) ji mají zpracovat.
             Vrať JSON pole s názvy agentů: skladnik, personalista, koordinator, mistr.
             Můžeš vrátit více agentů pokud je potřeba spolupráce.`,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 100
  });

  const selectedAgents = JSON.parse(routing.content[0].text);

  // Krok 2: Spusť vybrané agenty (paralelně pokud je jich víc)
  const results = await Promise.all(
    selectedAgents.map(agentName => runAgent(agentName, userMessage, context))
  );

  // Krok 3: Pokud odpovědělo více agentů, syntetizuj odpověď
  if (results.length > 1) {
    return synthesizeResponses(results, userMessage);
  }

  return results[0];
}
```

---

## 7.3 Vývojářští agenti — 1 agent na modul

Každý modul HolyOS má svého vývojářského agenta. Ten zná strukturu kódu
modulu, jeho datový model, API endpointy a UI komponenty.

### Jak fungují

```
Tomáš: "Přidej do HR modulu export docházky do XLSX"
    │
    ▼
Dev Hub (frontend) → pošle požadavek na backend
    │
    ▼
Dev Orchestrátor → vybere "HR Developer" agenta
    │
    ▼
HR Developer agent (Claude Agent SDK)
    ├── Má přístup k MCP dev-server (čtení/zápis kódu)
    ├── Zná strukturu: modules/lide-hr/, api/hr.js, models/Person.js
    ├── Zná pravidla: coding standards, test patterns, git flow
    │
    ├── 1. Analyzuje aktuální kód HR modulu
    ├── 2. Navrhne implementaci (review od Tomáše)
    ├── 3. Napíše kód (backend endpoint + frontend UI)
    ├── 4. Spustí testy
    └── 5. Commitne do feature branch (Tomáš merguje)
```

### Kontextové soubory pro vývojářské agenty

```
holyos/
├── .claude/
│   ├── CLAUDE.md                        # Globální pravidla
│   │
│   └── agents/
│       ├── hr-developer.md              # Kontext pro HR dev agenta
│       ├── warehouse-developer.md       # Kontext pro sklad dev agenta
│       ├── production-developer.md      # Kontext pro výrobu dev agenta
│       ├── assistant-developer.md       # Kontext pro systém asistentů
│       └── frontend-developer.md        # Kontext pro frontend
```

### Příklad kontextového souboru

```markdown
# HR Developer Agent

## Tvůj modul
Spravuješ HR modul systému HolyOS — správa zaměstnanců, docházka,
dovolené, směny, dokumenty.

## Klíčové soubory
- Backend: `api/hr.js` (24 KB, REST endpointy)
- Frontend: `modules/lide-hr/index.html` (155 KB, hlavní UI)
- Kiosk: `modules/lide-hr/kiosk.html` (24 KB, terminál docházky)
- Model: `models/Person.js`, `models/Department.js`, `models/Shift.js`
- MCP server: `mcp-servers/hr-server/`

## Pravidla
- Vždy piš česky v komentářích a UI textech
- Každý nový endpoint musí mít validaci vstupů (Zod)
- Každá změna v datech musí projít audit logem
- Používej Prisma pro DB operace, nikdy raw SQL
- Frontend: vanilla JS, žádné React/Vue (zatím)
- Testy: Vitest pro backend, žádné E2E zatím

## API konvence
- GET /api/hr/{resource} — seznam s filtrováním
- GET /api/hr/{resource}/:id — detail
- POST /api/hr/{resource} — vytvoření
- PUT /api/hr/{resource}/:id — aktualizace
- DELETE /api/hr/{resource}/:id — smazání (soft delete)

## Nezasahuj do
- Autentizace (middleware/auth.js)
- Jiné moduly (warehouse, production)
- Databázové migrace (jen navrhni, Tomáš spustí)
```

### Dva režimy vývojářských agentů

**Reaktivní (Tomáš zadá úkol):**
"Přidej do HR filtrování zaměstnanců podle oddělení"
→ Agent analyzuje kód → navrhne řešení → implementuje → testuje

**Proaktivní (agent sám navrhuje):**
Agent pravidelně analyzuje svůj modul a navrhuje:
- Bugy a potenciální problémy
- Chybějící validace
- Optimalizace výkonu
- Nové features na základě dat z provozu

Proaktivní návrhy se ukládají do Dev Hubu, Tomáš je schvaluje nebo odmítá.

---

## 8. Jak funguje skill technicky

Každý skill je Node.js modul s jednotným rozhraním:

```javascript
// skills/warehouse/check-inventory.js
module.exports = {
  name: 'check-inventory',
  description: 'Zkontroluje stav zásob materiálu',

  // JSON Schema — toto Claude dostane jako tool definition
  inputSchema: {
    type: 'object',
    properties: {
      material_id: { type: 'string', description: 'ID materiálu' },
      warehouse_id: { type: 'string', description: 'ID skladu (volitelné)' }
    },
    required: ['material_id']
  },

  // Hlavní logika skillu
  async execute({ material_id, warehouse_id }, context) {
    const { db, user } = context;

    const stock = await db.material.findUnique({
      where: { id: material_id },
      include: { inventory_movements: true }
    });

    const currentQty = calculateCurrentStock(stock);
    const isLow = currentQty <= stock.reorder_level;

    return {
      material: stock.name,
      current_quantity: currentQty,
      unit: stock.unit,
      reorder_level: stock.reorder_level,
      is_low_stock: isLow,
      message: isLow
        ? `⚠ ${stock.name}: ${currentQty} ${stock.unit} — pod minimem!`
        : `✓ ${stock.name}: ${currentQty} ${stock.unit} — OK`
    };
  }
};
```

A orchestrátor je pošle Claude jako tools:

```javascript
// services/ai/orchestrator.js
async function handleUserMessage(message, assistantId, context) {
  const assistant = await db.assistant.findUnique({
    where: { id: assistantId },
    include: { skills: true }
  });

  // Převeď skilly na Claude tool definitions
  const tools = assistant.skills.map(skill => ({
    name: skill.slug,
    description: skill.description,
    input_schema: skill.inputSchema
  }));

  // Pošli Claude zprávu s tools
  const response = await claude.messages.create({
    model: assistant.model,
    system: assistant.system_prompt,
    messages: [...conversationHistory, { role: 'user', content: message }],
    tools: tools
  });

  // Pokud Claude chce použít tool → spusť skill
  if (response.stop_reason === 'tool_use') {
    for (const toolCall of response.content) {
      if (toolCall.type === 'tool_use') {
        const skill = loadSkill(toolCall.name);
        const result = await skill.execute(toolCall.input, context);
        // Vrať výsledek Claude a pokračuj v konverzaci
      }
    }
  }

  return finalResponse;
}
```

---

## 9. Prioritní pořadí skillů k implementaci

### Vlna 1 — Základní (nutné pro fungování)

| Skill               | Asistent     | Popis                          |
|---------------------|--------------|--------------------------------|
| check-inventory     | Skladník     | Stav zásob                     |
| create-order        | Skladník     | Vytvořit objednávku            |
| search-people       | Personalista | Najít zaměstnance              |
| check-attendance    | Personalista | Stav docházky                  |
| create-task         | Koordinátor  | Vytvořit úkol                  |

### Vlna 2 — Automatizace

| Skill               | Asistent     | Popis                          |
|---------------------|--------------|--------------------------------|
| alert-low-stock     | Skladník     | Automatické upozornění         |
| approve-leave       | Personalista | Schválení dovolené             |
| assign-person       | Koordinátor  | Přiřazení osoby k úkolu       |
| send-reminder       | Koordinátor  | Připomínky termínů             |
| generate-report     | Technik      | PDF/XLSX reporty               |

### Vlna 3 — Inteligence

| Skill               | Asistent     | Popis                          |
|---------------------|--------------|--------------------------------|
| plan-production     | Mistr        | AI plánování výroby            |
| predict-demand      | Skladník     | Predikce potřeby materiálu     |
| optimize-shifts     | Personalista | Optimalizace směn              |
| escalate            | Koordinátor  | Inteligentní eskalace          |
| analyze-efficiency  | Mistr        | Analýza efektivity výroby      |

---

## 10. Co začít dělat TEĎ

1. **Přidat PostgreSQL na Railway** a vytvořit první migrace
2. **Napsat migrační skript** JSON → PostgreSQL pro stávající data
3. **Rozdělit server.js** na Express routes + controllers
4. **Stáhnout data z Factorify** a importovat do vlastní DB
5. **Vytvořit první MCP server** (warehouse) jako proof of concept
6. **Zprovoznit Claude Agent SDK** s jedním agentem + jedním MCP serverem
7. **Vytvořit kontextové soubory** (.claude/agents/) pro vývojářské agenty

---

## 11. Porovnání zvažovaných technologií

| Technologie        | Jazyk         | Pro HolyOS              | Verdikt          |
|--------------------|---------------|-------------------------|------------------|
| Claude Agent SDK   | TS/Node/Python| Nativní, MCP podpora    | **VYBRÁNO**      |
| MCP servery        | Jakýkoli      | Standardní protokol     | **VYBRÁNO**      |
| LangGraph          | Python        | Silné, ale Python-only  | Odmítnuto        |
| CrewAI             | Python        | Vysokoúrovňové, omezené | Odmítnuto        |
| AWS Bedrock        | -             | Enterprise, drahé       | Odmítnuto        |
| Make.com / n8n     | No-code       | Jen jednoduché workflow  | Doplněk (možná)  |

**Rozhodnutí:** Node.js + Express + PostgreSQL + Claude Agent SDK + MCP servery.
Jeden jazyk, jeden ekosystém, žádné zbytečné vrstvy.

---

*Tento dokument je živý plán v2.0. Aktualizuj ho průběžně jak se projekt vyvíjí.*
