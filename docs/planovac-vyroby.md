# Plánovač výroby prádlomatů — kompletní plán

> **Stav**: Draft schema schválen. Čeká se na spuštění migrace (Fáze 1).
> **Autor**: Tomáš Holý + Claude (session 2026-04-21)
> **Projekt**: HolyOS (`C:\Users\Tomáš\Projekty\Výroba\Výroba`)
> **Účel**: Referenční dokument pro celou iniciativu plánovače. Zdroj pravdy o rozhodnutích. Kontrolní list pro Tomáše. Kontext pro budoucí session Claude.

---

## 0. Jak tento dokument používat

- **Tomáš** — sekce 6 (Fáze) + sekce 7 (TODO) pro kontrolu, co je hotovo a na čem se pokračuje.
- **Claude v budoucí session** — začni sekcí 8 (Zadání pro Clauda). Pak sekce 1–5 pro kontext, sekce 9 pro integrační detail.
- **Aktualizace** — když se něco dokončí, zatrhni checkbox v sekci 7 a aktualizuj „Poslední dokončené" v sekci 8.

---

## 1. Kontext projektu

Tomáš staví výrobní závod na **průmyslové prádlomaty**. HolyOS má zastřešit plánování výroby.

**Produkt**: Prádlomat, ~750 položek BOM, **3 typy × 3 variace** (9 SKU celkem). Časy výroby variant jsou si podobné (nízká variance).

**Topologie výroby**:
- **Hlavní montážní linka** — cílová vize Boeing-style pulse line (výrobek stojí, lidé/týmy se přesouvají). Dnes klasický tok přes pracoviště.
- **Feederová pracoviště** (předmontáže):
  - Kabeláž — kitové výroby na objednávku
  - CNC řezání bondových desek — dávkové kvůli setupům
  - Svarovna — dávkové
  - Pila — dávkové
  - Další polotovary

**Obchodní model**:
- Zákazník volí **dodací slot** (týdenní okno)
- Deadline = poslední den slotu
- Aktuální délka slotu = 1 týden, cíl ji zkracovat, možnost prodlužovat při problémech
- Stav 2026-04-21: sloty naplněné až do srpna 2026

**Organizační jazyk**:
- Výrobní dávky + kapacitní plánování (to, co firma už dnes umí)
- Dávka a slot jsou ortogonální — jedna dávka pokrývá více slotů, jeden slot obsahuje kusy z více dávek

**Datový zdroj**:
- **Factorify** — stávající ERP, drží BOM, produkty, kapacitu. HolyOS pulls přes API přes session token + `X-AccountingUnit` header, endpoint `POST /api/query/Stage`.
- HolyOS — lokální PostgreSQL, vlastní entity pro výrobu/HR/sklad

---

## 2. Cíle plánovače (lexikografické pořadí priorit)

1. **Dodržení termínu slotu** — tvrdé omezení. Plán, který slot porušuje, je odmítnut.
2. **Nízká rozpracovanost** — cíl <2–3 dny průměrná doba kusu v procesu.
3. **Optimální sklad + řízení nákupu** — minimalizace carrying cost při zachování bezpečnostních zásob.
4. **Využití lidí** — cíl 80–85 %, ne 100 % (100 % = antipattern, není prostor pro odchylku).

Každé kritérium by mělo mít váhu, kterou Tomáš může v UI upravit (např. „tento týden žeň termín, sklad ignoruj").

---

## 3. Neřešíme hned

Explicitně mimo rozsah první iterace:

- Pulse-line v čisté formě — zavedeme parametr `Workstation.flow_type`, ale algoritmy dnes budou `batch`. Pulse přidáme, až bude mít infrastruktura konkrétní smysl.
- Automatická normalizace časů (MOST/MTM) — normy přijdou z Factorify nebo ručně přes UI. Auto-normování je samostatný agent, ne MVP.
- Multi-site (více závodů) — dnes jeden závod.
- Finanční optimalizace (cash flow) — plánovač řeší fyzickou kapacitu + sklad, ne peníze.

---

## 4. Architektura — kde věci žijí

```
HolyOS/
├── prisma/schema.prisma             ← nové entity: Competency, WorkerCompetency, OperationRequiredCompetency,
│                                      ProductionBatch, BomSnapshot, BomSnapshotItem
│                                      + rozšíření Product, Workstation, SlotAssignment
│
├── routes/
│   ├── planning.routes.js           ← NOVÉ: /api/planning/* (generate, validate, mrp, batches)
│   ├── slots.routes.js              ← stávající — doplnit health score endpoint
│   └── production.routes.js         ← stávající — doplnit endpointy pro Competency + Batch CRUD
│
├── services/
│   ├── planning/                    ← NOVÉ
│   │   ├── scheduler.js             ← kaskáda: týdenní → denní plán
│   │   ├── batch-builder.js         ← logika dávkování (EOQ s kapacitním omezením)
│   │   ├── capacity-planner.js      ← RCCP (týdenní) + CRP (denní)
│   │   ├── mrp.js                   ← BOM explosion, netting, lead-time offset, PO návrh
│   │   ├── slot-health.js           ← Slot Health Score výpočet
│   │   └── bom-snapshot.js          ← zamražení BOM v okamžiku výpočtu
│   ├── factorify/                   ← stávající — rozšířit o BOM endpoint
│   └── ai/
│       ├── orchestrator.js          ← stávající — doplnit AGENT_MCP_MAP o `planovac`
│       └── workflow-engine.js       ← NOVÉ (Fáze 5)
│
├── mcp-servers/
│   └── planning-server/             ← NOVÉ
│       ├── index.js                 ← getTools + executeTool
│       └── tools/
│           ├── generate_weekly_plan.js
│           ├── calculate_mrp.js
│           ├── propose_batch_sizes.js
│           ├── check_slot_capacity.js
│           ├── list_batches.js
│           └── simulate_plan.js     ← volá existující DES simulátor
│
└── modules/
    ├── vyrobni-sloty/               ← stávající — doplnit health score + kapacitní vizualizaci
    ├── prodejni-objednavky/         ← stávající — doplnit přiřazení OrderItem → Slot
    ├── planovani-vyroby/            ← NOVÉ (Fáze 4): přehled dávek + denního plánu
    └── workflows/                   ← NOVÉ (Fáze 5): plátno + run viewer + feedback
```

---

## 5. Datový model — finální návrh schema (schváleno)

Všechny migrace jsou pojmenovány `pridej-<téma>-<datum>`.

### 5.1. Nové entity

```prisma
// --- Kompetence (dovednosti pracovníků) ---

model Competency {
  id          Int       @id @default(autoincrement())
  name        String    @db.VarChar(255)   // "Svařování MIG", "Pájení bondů", "Montáž rámu"
  code        String    @unique @db.VarChar(50)
  category    String?   @db.VarChar(50)    // "welding", "electronics", "assembly"
  description String?   @db.Text
  level_max   Int       @default(3)         // 1=začátečník, 3=expert
  created_at  DateTime  @default(now())

  worker_competencies    WorkerCompetency[]
  operation_requirements OperationRequiredCompetency[]

  @@map("competencies")
}

model WorkerCompetency {
  id             Int       @id @default(autoincrement())
  person_id      Int
  competency_id  Int
  level          Int       @default(1)
  certified_at   DateTime? @db.Date
  valid_until    DateTime? @db.Date
  note           String?   @db.Text
  created_at     DateTime  @default(now())

  person     Person     @relation(fields: [person_id], references: [id], onDelete: Cascade)
  competency Competency @relation(fields: [competency_id], references: [id], onDelete: Cascade)

  @@unique([person_id, competency_id])
  @@index([competency_id])
  @@map("worker_competencies")
}

model OperationRequiredCompetency {
  id            Int @id @default(autoincrement())
  operation_id  Int
  competency_id Int
  min_level     Int @default(1)

  operation  ProductOperation @relation(fields: [operation_id], references: [id], onDelete: Cascade)
  competency Competency       @relation(fields: [competency_id], references: [id], onDelete: Cascade)

  @@unique([operation_id, competency_id])
  @@map("operation_required_competencies")
}

// --- Výrobní dávka ---

model ProductionBatch {
  id              Int       @id @default(autoincrement())
  batch_number    String    @unique @db.VarChar(50)   // "DV-2026-W28-0142"
  product_id      Int
  variant_key     String?   @db.VarChar(255)
  quantity        Int
  batch_type      String    @default("main") @db.VarChar(20)    // main, feeder, subassembly
  status          String    @default("planned") @db.VarChar(20) // planned, released, in_progress, paused, done, cancelled
  priority        Int       @default(0)

  planned_start   DateTime?
  planned_end     DateTime?
  actual_start    DateTime?
  actual_end      DateTime?

  parent_batch_id Int?
  bom_snapshot_id Int?

  note            String?   @db.Text
  created_by      Int?
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt

  product          Product           @relation(fields: [product_id], references: [id])
  parent_batch     ProductionBatch?  @relation("BatchParent", fields: [parent_batch_id], references: [id])
  child_batches    ProductionBatch[] @relation("BatchParent")
  bom_snapshot     BomSnapshot?      @relation(fields: [bom_snapshot_id], references: [id])
  creator          Person?           @relation("BatchCreatedBy", fields: [created_by], references: [id])
  slot_assignments SlotAssignment[]

  @@index([product_id])
  @@index([status])
  @@index([planned_start])
  @@index([batch_type])
  @@map("production_batches")
}

// --- BOM snapshot (zamražený kusovník pro plán) ---

model BomSnapshot {
  id           Int       @id @default(autoincrement())
  product_id   Int
  variant_key  String?   @db.VarChar(255)
  snapshot_at  DateTime  @default(now())
  source       String    @default("computed") @db.VarChar(20) // computed, factorify_pull, manual
  source_ref   String?   @db.VarChar(255)
  note         String?   @db.Text

  product Product            @relation(fields: [product_id], references: [id])
  items   BomSnapshotItem[]
  batches ProductionBatch[]

  @@index([product_id])
  @@index([snapshot_at])
  @@map("bom_snapshots")
}

model BomSnapshotItem {
  id                  Int       @id @default(autoincrement())
  snapshot_id         Int
  material_id         Int
  quantity            Decimal   @db.Decimal(10, 3)
  unit                String    @default("ks") @db.VarChar(20)
  source_operation_id Int?
  depth               Int       @default(0)

  snapshot         BomSnapshot       @relation(fields: [snapshot_id], references: [id], onDelete: Cascade)
  material         Material          @relation(fields: [material_id], references: [id])
  source_operation ProductOperation? @relation(fields: [source_operation_id], references: [id], onDelete: SetNull)

  @@index([snapshot_id])
  @@index([material_id])
  @@map("bom_snapshot_items")
}
```

### 5.2. Rozšíření existujících entit

```prisma
// V Product přidat:
  min_batch_size      Int?    // minimální technologická dávka
  economic_batch_size Int?    // ekonomicky výhodná dávka
  batch_size_step     Int?    // násobky (dávky po 5 ks apod.)
  batches             ProductionBatch[]
  bom_snapshots       BomSnapshot[]

// V Workstation přidat:
  flow_type           String  @default("batch") @db.VarChar(20) // batch, pulse, fixed_position

// V SlotAssignment přidat:
  batch_id            Int?
  batch               ProductionBatch? @relation(fields: [batch_id], references: [id], onDelete: SetNull)

// V Person přidat reverzní relace:
  competencies       WorkerCompetency[]
  batches_created    ProductionBatch[] @relation("BatchCreatedBy")

// V ProductOperation přidat reverzní relaci:
  required_competencies OperationRequiredCompetency[]
  bom_snapshot_items    BomSnapshotItem[]

// V Material přidat reverzní relaci:
  bom_snapshot_items BomSnapshotItem[]
```

### 5.3. Poznámky k designu

- **Pojmenování `Competency`** místo `Skill` (kolize s AI Skill registry).
- **Vztah OrderItem ↔ Batch** jde přes `SlotAssignment` (nepřidáváme pivot `OrderItemBatch` pro v1).
- **Feeder dávky** přes `parent_batch_id` — kabelová dávka zásobující hlavní dávku.
- **`variant_key` jako string** (rozhodnuto). Formát: `"ram:nerez|barva:bila|polepy:none"`. 9 variant nepotřebuje plnohodnotnou `ProductVariant` entitu.
- **BOM snapshot = 2 tabulky** (hlavička + řádky) místo JSON — snadné dotazy napříč snapshoty.
- **`Workstation.flow_type`** — dnes všechno `batch`, připraveno na `pulse`/`fixed_position`.

### 5.4. Material už má skvělé věci (nic neměníme)

`Material` má připravené: `lead_time_days`, `batch_size_min/max/default`, `processed_in_multiples`, `reorder_quantity`, `expedition_reserve_days`, `delivery_tolerance_pct`, `plan_orders`, `min_stock/max_stock`. To jsou všechny vstupy pro MRP. **Nic nepřidáváme**.

### 5.5. ProductionSlot + SlotAssignment už existují

Existující entity pokrývají slotový model. Jen doplňujeme `batch_id` do `SlotAssignment`.

---

## 6. Fáze a milníky

Realistické odhady za předpokladu práce cca 1–2 dny v týdnu na tom.

### Fáze 1 — Datový základ (odhad 3–5 dní)

**Cíl**: Schema je migrované, CRUD endpointy fungují, dá se manuálně zadat kompetence a dávka přes API.

**Deliverables**:
- Migrace `pridej-davky-kompetence-bom-snapshot`
- `routes/production.routes.js` rozšířené o Competency + Batch CRUD
- Seed: základní katalog kompetencí (≈15 kompetencí pro prádlomat: svařování, pájení, montáž rámu, elektro, kabeláž, kontrola, atd.)

**Definice hotovo**: Můžu přes HTTP vytvořit dávku, přiřadit kompetenci člověku, přiřadit požadavek kompetence k operaci.

### Fáze 2 — Plánovač v1 (odhad 5–8 dní)

**Cíl**: Z chatu zeptám „naplánuj týden W28" a dostanu návrh dávek.

**Deliverables**:
- `services/factorify/` rozšířeno o BOM endpoint
- `services/planning/bom-snapshot.js` — zamražení BOM
- `services/planning/scheduler.js` + `batch-builder.js` + `capacity-planner.js`
- `routes/planning.routes.js` — endpointy `POST /api/planning/weekly-plan`, `POST /api/planning/snapshot-bom`
- `mcp-servers/planning-server/` + tool `generate_weekly_plan`
- Agent `planovac` (Assistant záznam + DevAgent + AGENT_MCP_MAP)

**Definice hotovo**: V UI AI chatu se agenta zeptám na plán, dostanu strukturovanou odpověď s dávkami, slot capacity, varování (pokud slot přetéká).

### Fáze 3 — MRP a řízení nákupu (odhad 4–6 dní)

**Cíl**: Plán nejen ukazuje dávky, ale i generuje návrh nákupu s přesnými termíny objednávek.

**Deliverables**:
- `services/planning/mrp.js` — BOM explosion, netting, lead-time offset
- MCP tool `calculate_mrp`
- Endpoint `POST /api/planning/mrp-run` — vrátí seznam navrhovaných nákupních objednávek
- Rozdělení položek: long lead (MRP), kanban (min-max), vyráběné (interní feeder dávka)

**Definice hotovo**: Zeptám se agenta „co musíme objednat do konce dubna abychom stihli srpen?" a dostanu seznam s dodavateli a termíny.

### Fáze 4 — UI Slot Management + přehled dávek (odhad 4–6 dní)

**Cíl**: Tomáš vidí sloty a dávky vizuálně, obchodník přiřazuje objednávky do slotů.

**Deliverables**:
- `modules/vyrobni-sloty/` — progressbar naplněnosti, Slot Health Score, barevné varování
- `modules/prodejni-objednavky/` — tlačítko „Přiřadit do slotu" u OrderItem, drag-drop do slotů
- `modules/planovani-vyroby/` (nový) — přehled dávek, filtr podle týdne, detail dávky
- Endpoint `GET /api/slots/:id/health-score`

**Definice hotovo**: V prohlížeči vidím sloty W17-W30 s naplněností, u objednávky vidím, do kterého slotu patří, u dávky vidím, které objednávky pokrývá.

### Fáze 5 — Workflow engine (odhad 8–12 dní)

**Cíl**: n8n-style vizuální orchestrace agentů, feedback smyčka, plánovač jako DAG.

**Deliverables**:
- Migrace `pridej-workflow-engine`: Workflow, WorkflowNode, WorkflowEdge, WorkflowRun, NodeExecution, Feedback
- `services/ai/workflow-engine.js` — topologické řazení, exekuce, logování, retry
- `modules/workflows/` — plátno (LiteGraph.js nebo custom SVG), run viewer, feedback buttons
- Překlopení plánovače z monolitického agenta na DAG: rozklad objednávek → capacity check → feeder scheduler → main line balancer → MRP → souhrn

**Definice hotovo**: Mohu v UI poskládat vlastní workflow z uzlů, spustit ho, vidět živý průběh, dát feedback k jednotlivým uzlům, feedback se při dalším spuštění injectuje do kontextu.

---

## 7. TODO list (kontrolovatelný)

Aktualizuj zatrháváním checkboxů po dokončení. Dubluje se s in-memory task listem Claude (vizibilní přes TaskList v session).

### Fáze 1 — Datový základ
- [x] **1.** Zmapovat stav HolyOSu ✅ (2026-04-21)
- [x] **2.** Navrhnout finální schema migrací ✅ (2026-04-21, schváleno)
- [ ] **3.** Spustit migrace `pridej-davky-kompetence-bom-snapshot`
- [ ] **3a.** Vytvořit seed kompetencí pro prádlomat (svařování, pájení, montáž rámu, elektro, kabeláž, QC, ...)
- [ ] **3b.** Rozšířit `routes/production.routes.js` o CRUD pro Competency + WorkerCompetency + OperationRequiredCompetency
- [ ] **3c.** Rozšířit `routes/production.routes.js` o CRUD pro ProductionBatch

### Fáze 2 — Plánovač v1
- [ ] **4.** Rozšířit Factorify klienta o BOM endpoint + logiku BomSnapshot
- [ ] **5.** Scaffold backendu: `services/planning/`, `routes/planning.routes.js`, `mcp-servers/planning-server/`
- [ ] **6.** Implementovat MCP tool `generate_weekly_plan` v1
- [ ] **8.** Vytvořit agenta `planovac` + zaregistrovat v orchestrátoru
- [ ] **9.** End-to-end test: „naplánuj týden W28" přes chat

### Fáze 3 — MRP
- [ ] **7.** Implementovat MCP tool `calculate_mrp` v1
- [ ] **7a.** Kategorizace položek: long-lead / kanban / vyráběné
- [ ] **7b.** Endpoint `POST /api/planning/mrp-run` + zobrazení návrhů

### Fáze 4 — UI Slot Management
- [ ] **10.** UI: přiřazení OrderItem → SlotAssignment + Slot Health Score
- [ ] **10a.** Modul `planovani-vyroby/` — přehled dávek
- [ ] **10b.** Endpoint `GET /api/slots/:id/health-score`

### Fáze 5 — Workflow engine
- [ ] **11.** Navrhnout finální schema workflow enginu (draft k odsouhlasení)
- [ ] **12.** Migrace + runtime: `services/ai/workflow-engine.js`
- [ ] **13.** UI workflow enginu: plátno + run viewer + feedback
- [ ] **14.** Přepsat plánovač na DAG + napojit feedback do kontextu

---

## 8. Zadání pro Clauda (jak pokračovat v budoucí session)

> **Tento dokument čti jako první**, pokud pokračuješ v práci na plánovači výroby.

### Co jsi viděl před sebou při příchodu

1. `MEMORY.md` v paměti má referenci `HolyOS plánovač výroby prádlomatů — iniciativa` → otevři `holyos_pradlomat_planovac.md` pro zkrácený kontext.
2. `CLAUDE.md` v kořenu HolyOS projektu má obecné konvence (Prisma, Czech, routes, atd.). **Dodržuj je.**
3. Tento dokument (`docs/planovac-vyroby.md`) má kompletní plán.

### Kontrola stavu

1. Zavolej `TaskList` ať vidíš, které úkoly jsou `pending` / `in_progress` / `completed`.
2. Podívej se do sekce 7 v tomto dokumentu na checkboxy.
3. Před jakoukoli implementační akcí ověř reálný stav kódu (čti soubor, ne předpokládej) — paměť/plán může být stará.

### Poslední dokončené

- Fáze 0: Průzkum HolyOSu
- Fáze 1, úkol 2: Schema draft schválen
- **Další na řadě**: Fáze 1, úkol 3 — spuštění migrace

### Konvence, které NESMÍŠ porušit

- **Čeština** — všechny komentáře, error messages, UI texty, git commity
- **Prisma, ne raw SQL** — nikdy `db.query(...)`, vždycky `prisma.xxx.yyy(...)`
- **JWT v httpOnly cookie** — moduly NESMĚJÍ dělat token-based redirect na login přes sessionStorage (viz `holyos_auth_flow.md` v paměti)
- **Všechny routy mají `requireAuth`** (mimo `/api/auth/*`)
- **Chyby přes `next(err)`**, ne `res.status(500).send(...)`
- **Include relationships**, ne N+1 queries
- **Index na FK + frequently filtered fields**
- **Migrace s popisným názvem**, `npx prisma migrate dev --name "..."`, NIKDY `prisma db push`

### Před spuštěním migrace v Fázi 1, úkol 3

1. Přečti `prisma/schema.prisma` v sekcích Product, Workstation, SlotAssignment — ujisti se, že moje rozšíření pořád sedí na aktuální stav (schema se mohlo změnit mezi session).
2. Zkontroluj existující migrace v `prisma/migrations/` — navazuje se na poslední.
3. Až pak edituj `schema.prisma` a pusť `npx prisma migrate dev --name "pridej-davky-kompetence-bom-snapshot"`.
4. Po migraci zkontroluj, že se vygeneroval Prisma client (`node_modules/@prisma/client/`).

### Před přidáním nového MCP toolu

1. Přečti `services/ai/orchestrator.js` a jeho `AGENT_MCP_MAP` — pochop, jak se tooly registrují.
2. Následuj pattern existujících MCP serverů (`mcp-servers/hr-server/index.js`, `mcp-servers/warehouse-server/index.js`).
3. Export: `getPlanningTools()` + `executePlanningTool(name, params, prisma)`.
4. Po přidání nezapomeň do `AGENT_MCP_MAP` přidat `planovac` → `['planning', 'warehouse', 'production', 'hr']`.

### Před dotykem frontendu

1. Čti `js/sidebar.js` + `css/dashboard.css` — CSS variables, globální pattern.
2. Modul je vlastní adresář `modules/xyz/` s `index.html` + `app.js` + případně CSS.
3. Nové moduly registruj v `js/sidebar.js` do navigace.
4. Fetch přes `/api/...` s `credentials: 'include'` (kvůli httpOnly cookie).

---

## 9. Integrační detail — API kontrakty, MCP tooly, UI screens

### 9.1. Backend endpointy (nové)

```
POST /api/planning/snapshot-bom
  body: { product_id: Int, variant_key?: String, source: "computed"|"factorify_pull" }
  resp: { snapshot_id: Int, items_count: Int, duration_ms: Int }

POST /api/planning/weekly-plan
  body: { iso_week: String ("2026-W28"), options?: { priorities, weights, constraints } }
  resp: {
    slot_id: Int,
    order_items: [{ order_item_id, product_name, quantity, variant_key, customer }],
    batches: [{ batch_number, product_id, variant_key, quantity, planned_start, planned_end, batch_type, covered_order_items: [{id, qty}] }],
    capacity_check: { main_line_load_pct, feeder_load: {cable, bond, weld, saw}, bottlenecks },
    warnings: [{ type, message, affected }],
    health_score: Number (0-100)
  }

POST /api/planning/mrp-run
  body: { from_date: Date, to_date: Date, include_forecast?: Boolean }
  resp: {
    requirements: [{ material_id, material_code, required_qty, available_qty, net_qty, unit, needed_by: Date, supplier_id, lead_time_days, order_by: Date }],
    proposed_pos: [{ supplier_id, items: [...], total_value, suggested_order_date, arrival_date }]
  }

GET /api/slots/:id/health-score
  resp: {
    slot_id, load_pct, capacity_hours_used, capacity_hours_total,
    orders_count, batches_count, risk_level: "green"|"amber"|"red",
    suggestions: [String]
  }

GET /api/planning/batches?status=&week=&product_id=
  resp: [{ ...ProductionBatch, product, slot_assignments, order_coverage }]

POST /api/planning/batches
  body: { product_id, variant_key, quantity, batch_type, planned_start, planned_end, ... }
  resp: { ...created batch }

PATCH /api/planning/batches/:id
  body: partial update
  resp: { ...updated batch }

# Competency CRUD (v routes/production.routes.js)
GET/POST/PATCH/DELETE /api/production/competencies
GET/POST/DELETE /api/production/worker-competencies
GET/POST/DELETE /api/production/operation-required-competencies
```

### 9.2. MCP tooly pro agenta `planovac`

```
generate_weekly_plan(iso_week: String) → WeeklyPlan
  Popis: Vygeneruje návrh dávek a obsazení slotu pro daný ISO týden.

calculate_mrp(from_date: Date, to_date: Date, include_forecast?: Boolean) → MrpResult
  Popis: BOM explosion z potvrzených objednávek, netting, návrh nákupu.

propose_batch_sizes(product_id: Int, demand_qty: Int) → BatchProposal
  Popis: Pro daný produkt a poptávku navrhne počet a velikost dávek (respektuje min/economic batch, násobky).

check_slot_capacity(iso_week: String) → CapacityReport
  Popis: Spočte zatížení hlavní linky + feederů pro týden.

list_batches(filter: { status?, week?, product_id? }) → Batch[]
  Popis: Seznam dávek podle filtru.

simulate_plan(plan_id: String) → SimulationReport
  Popis: Zavolá stávající DES simulátor (`modules/simulace-vyroby/`) a vrátí odhad rozpracovanosti, úzkých míst, vytížení.
```

### 9.3. UI screens

| Screen | Modul | Co dělá |
|---|---|---|
| Seznam slotů s health score | `vyrobni-sloty/` | Gantt-like timeline, barevně podle napnutosti |
| Detail slotu | `vyrobni-sloty/` | Naplněnost, přiřazené objednávky + dávky, „přeplánovat" |
| Seznam objednávek | `prodejni-objednavky/` | Tabulka s filtrem, sloupec „Slot" |
| Přiřazení do slotu | `prodejni-objednavky/` | Modal s návrhem slotu + drag-drop alternativa |
| Přehled dávek | `planovani-vyroby/` (nové) | Kanban podle stavu (planned/released/in_progress/done) |
| Detail dávky | `planovani-vyroby/` | Pokryté objednávky, BOM snapshot, operace, časy |
| Workflow plátno | `workflows/` (Fáze 5) | Drag-drop uzly, edges, konfigurace |
| Workflow run viewer | `workflows/` | Živý průběh uzlů, výstupy, feedback buttons |

### 9.4. Agent `planovac` — systémový prompt (draft)

```
Jsi plánovač výroby prádlomatů v HolyOSu. Tvoje práce je rozkládat
potvrzené prodejní objednávky do výrobních dávek, držet termíny
dodacích slotů, minimalizovat rozpracovanost a navrhovat nákup
materiálu.

Priority (lexikografické pořadí):
1. Dodržení termínu slotu (tvrdé omezení)
2. Nízká rozpracovanost (<2-3 dny ve výrobě)
3. Optimální sklad + řízení nákupu
4. Využití lidí (cíl 80-85 %)

Ke své práci používej dostupné nástroje:
- generate_weekly_plan, calculate_mrp, propose_batch_sizes,
  check_slot_capacity, list_batches, simulate_plan

Vždy odpovídej česky, strukturovaně. Při navrhování dávek uveď:
- Kolik dávek, jakého typu, kdy začínají a končí
- Které objednávky pokrývají
- Zatížení hlavní linky a feederů
- Varování (pokud něco nesedí)

Pokud nemáš dostatek dat, řekni to a navrhni, co doplnit.
Nikdy si nevymýšlej čísla.
```

---

## 10. Otevřené otázky (k rozhodnutí v dalších sessions)

- [ ] **Workflow canvas framework** — LiteGraph.js (single-file, funguje out-of-box) vs. custom SVG (více kontroly, více práce). Rozhodnutí před Fází 5.
- [ ] **Rozlišení položek v MRP** — jak konkrétně označit, co je long-lead vs. kanban vs. vyráběné? Navrhuju nové pole `Material.mrp_policy` (`mrp`, `kanban`, `produced`). Do Fáze 3.
- [ ] **Variant key formát** — schválené jako string `"ram:nerez|barva:bila|polepy:none"`. Může se ukázat, že 9 variant by profitovalo z `ProductVariant` entity. Vyhodnotit po Fázi 2.
- [ ] **Kde žije "feeder dependency"** — dnes parent_batch_id. Ale potřebujeme taky pravidlo „1 main dávka potřebuje N kabelových svazků". To je spíš atribut BomSnapshotItem (depth>0) + nová tabulka `BatchDependency`? Vyhodnotit při implementaci feeder scheduleru.
- [ ] **Slot per pracoviště vs. per linka** — `ProductionSlot` dnes má volitelný `workstation_id`. Pro hlavní linku bude prázdné (slot = linka jako celek). Pro feeder bude `workstation_id` vyplněné. Potvrdit tento výklad při implementaci.
- [ ] **Kde zobrazovat Slot Health Score** — jen v modulu vyrobni-sloty, nebo i v top-baru jako alert, když je risk_level="red"?
- [ ] **Jak se bude plnit seed kompetencí** — fixně v migraci, nebo jako samostatný seed script, který může admin spustit v UI?

---

## 11. Reference

**Projekt**
- HolyOS kořen: `C:\Users\Tomáš\Projekty\Výroba\Výroba`
- CLAUDE.md (konvence): `.claude/CLAUDE.md`
- Prisma schema: `prisma/schema.prisma`
- Deployment: Railway, `railway up`, persistent volume `/app/data`

**Factorify**
- API: `POST /api/query/Stage`
- Auth: session token + `X-AccountingUnit` header
- Paměťový záznam: `factorify_api_connection.md`

**Související moduly HolyOS (stávající)**
- `modules/vyrobni-sloty/` — slot CRUD (k rozšíření)
- `modules/prodejni-objednavky/` — objednávky (k rozšíření)
- `modules/pracovni-postup/` — detail výrobku + operace (read-only reference)
- `modules/simulace-vyroby/` — DES simulátor (budeme volat přes tool `simulate_plan`)
- `modules/programovani-vyroby/` — editor areálu (read-only reference)
- `modules/nakup-sklad/` — sklad + materiály (zdroj pro MRP)
- `modules/lide-hr/` — lidé, docházka (zdroj pro denní plán)
- `modules/ai-agenti/` — chat UI (plánovač se tu objeví)

**MCP servery (stávající)**
- `mcp-servers/production-server/`
- `mcp-servers/warehouse-server/`
- `mcp-servers/hr-server/`
- `mcp-servers/tasks-server/`

**Paměťové záznamy Claude** (`spaces/*/memory/`)
- `holyos_pradlomat_planovac.md` — zkrácený kontext této iniciativy
- `holyos_architecture_plan.md` — vyšší-level architektura HolyOSu
- `holyos_auth_flow.md` — JWT / httpOnly cookie pravidla
- `factorify_api_connection.md` — Factorify API detail
- `holyos_deployment.md` — Railway deployment

---

## 12. Changelog tohoto dokumentu

- **2026-04-21** — Vznik. Schválený schema draft, fáze rozkresleny, todo list vytvořen.
