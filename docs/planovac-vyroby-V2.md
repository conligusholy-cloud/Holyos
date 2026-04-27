# Plánovač výroby prádlomatů — V2 (2026-04-27)

> **Revize 2026-04-27** — rozšíření původního plánu (`planovac-vyroby.md` ze 4/21) o:
> - Plnou matici kompetencí (operace × člověk)
> - Výrobní obrazovku pracoviště (kiosek)
> - Pre-pick logiku (auto vystavení transferu materiálu na pracoviště)
> - Lidská kapacita + Attendance + LeaveRequest jako vstup plánovače
> - Hlídání materiálu na pracovišti (input/output buffer)
>
> **Tento dokument je živý.** Zaškrtávej checkboxy v sekci 8 jak věci postupují. Sekce 11 drží zpětnou vazbu.

---

## 1. Rozsah projektu

Plánovač výroby pro průmyslové prádlomaty:

- **Produkt**: prádlomat, ~750 BOM, 3 typy × 3 variace (9 SKU), nízká variance časů mezi variantami
- **Výroba**: hlavní montážní linka + 4 feedery (kabeláž, CNC bondových desek, svarovna, pila)
- **Prodej**: zákazník volí týdenní slot, deadline = poslední den slotu, naplněno do srpna 2026
- **Kaskáda**: slotový plán (měsíce) → týdenní → denní → živý dispečer
- **Datový zdroj**: Factorify (BOM, postupy, materiály, dodavatelé) + lokální HolyOS (HR, sklad, lidé)

## 2. Cíle (lexikografické pořadí priorit)

1. **Termín slotu** (tvrdé) — plán, který slot porušuje, je odmítnut
2. **Nízká rozpracovanost** — cíl <2-3 dny průměrná doba kusu v procesu
3. **Sklad + nákup** — minimalizace carrying cost při zachování safety stock
4. **Využití lidí** — cíl 80-85 %, ne 100 %

Váhy nastavitelné v UI ("tento týden žeň termín, sklad ignoruj").

## 3. Mimo rozsah V2

- Pulse-line algoritmy (parametr `flow_type` připraven, ale dnes vše batch)
- Auto-normování času MOST/MTM (normy z Factorify nebo ručně)
- Multi-site (více závodů)
- Cash flow optimalizace
- Plánování údržby strojů (samostatný modul, později)

## 4. Funkční oblasti

| Kód | Oblast | F |
|---|---|---|
| A | Výrobní dávky + plánování | F1, F3 |
| B | BOM z Factorify (pull s možností kalibrace) | F2 |
| C | MRP + nákupní výhled (lead-time per materiál → návrh PO) | F4 |
| D | Hlídání materiálu na pracovišti (vstupní/výstupní buffer) | F5 |
| E | Slot management + UI dispečera | F5 |
| F | Výrobní obrazovka pracoviště (kiosek čipový login → "Najít práci") | F6 |
| G | Workflow engine n8n-style (DAG, feedback smyčka) | F7 |

## 5. Vstupy plánovače (datový tok)

```
                   ┌────────────────────┐
                   │  Slot kapacity     │  Sloty W17-W30, kolik kusů kde
                   │  (Order/SlotAss.)  │  (zákaznická poptávka)
                   └─────────┬──────────┘
                             │
   ┌─────────────────────────┼──────────────────────────┐
   │                         │                          │
   ▼                         ▼                          ▼
┌──────────┐          ┌──────────────┐         ┌──────────────────┐
│ BOM      │          │ Pracovní     │         │ Lidská kapacita  │
│ snapshot │          │ postup +     │         │ + kompetence     │
│ (BomSnap-│ ◄──────  │ čas + WS     │ ◄────── │ (Person+Comp.+   │
│  shot)   │  potřeba │(ProductOp.)  │   kdo   │  Attend+Leave)   │
└────┬─────┘          └──────┬───────┘   umí   └────────┬─────────┘
     │                       │                          │
     ▼                       ▼                          ▼
 ┌────────────────────────────────────────────────────────────────┐
 │                        PLÁNOVAČ                                 │
 │  vstupy: sloty, BOM, postupy, lidi, sklad, kompetence           │
 │  kaskáda: týdenní kapacitní plán → denní rozvrh dávek           │
 │  výstup: ProductionBatch + BatchOperation                       │
 │          + alerts (chybí materiál, lidi, kapacita)              │
 └─────┬────────────────────────────────────────────────────┬─────┘
       │                                                    │
       ▼                                                    ▼
 ┌──────────────┐                                ┌──────────────────┐
 │  MRP         │                                │  Pre-pick        │
 │  návrh POs   │                                │  transfer order  │
 │  (lead-time) │                                │  → input_loc WS  │
 └──────────────┘                                └─────────┬────────┘
                                                           │
                                                           ▼
                                                 ┌──────────────────┐
                                                 │  Výrobní obrazovka│
                                                 │  pracoviště       │
                                                 │  "Najít práci"    │
                                                 └──────────────────┘
```

## 6. Datový model

### 6.1 Nové entity (8 modelů)

```prisma
// Kompetence — katalog
model Competency {
  id, name, code (UNIQUE), category, description, level_max=3
}

// Kompetence člověka (plná matice)
model WorkerCompetency {
  id, person_id, competency_id, level (1-3),
  certified_at, valid_until, note
  UNIQUE(person_id, competency_id)
}

// Kompetenční nárok operace (plná matice)
model OperationRequiredCompetency {
  id, operation_id, competency_id, min_level (1-3)
  UNIQUE(operation_id, competency_id)
}

// Výrobní dávka
model ProductionBatch {
  id, batch_number ({rok}-{seq3}),
  product_id, variant_key, quantity,
  batch_type (main/feeder/subassembly), status (planned/released/in_progress/paused/done/cancelled),
  priority, planned_start, planned_end, actual_start, actual_end,
  parent_batch_id (feeder dávka), bom_snapshot_id,
  note, created_by
}

// BOM snapshot
model BomSnapshot {
  id, product_id, variant_key, snapshot_at,
  source (computed/factorify_pull/manual), source_ref, note
}

model BomSnapshotItem {
  id, snapshot_id, material_id, quantity, unit,
  source_operation_id, depth
}

// Instance operace pro dávku (klíčové pro výrobní kiosek!)
model BatchOperation {
  id, batch_id, operation_id, workstation_id, sequence,
  status (pending/ready/in_progress/done/blocked),
  planned_start, planned_end,
  assigned_person_id, started_at, finished_at,
  duration_minutes (skutečné — pro kalibraci normy),
  note
}

// Log akcí kioseku (start, pause, resume, done, problem)
model BatchOperationLog {
  id, batch_operation_id, person_id, action, note, created_at
}
```

### 6.2 Rozšíření existujících entit

| Model | Změna | Status |
|---|---|---|
| `Material` | `lead_time_days` (✓ už je), `supplier_id` (✓ už je), `batch_size_min/max/default` (✓ už je) | **Nic přidat netřeba** |
| `Workstation` | `input_warehouse_id`, `input_location_id`, `output_warehouse_id`, `output_location_id` (✓ už jsou) + **přidat** `flow_type` ('batch' default) | Přidat 1 sloupec |
| `Product` | + `min_batch_size`, `economic_batch_size`, `batch_size_step` | Přidat 3 sloupce |
| `SlotAssignment` | + `batch_id` (FK na ProductionBatch) | Přidat 1 sloupec |
| `ProductOperation` | + `from_factorify` (bool), `last_calibrated_at`, `last_calibrated_by_id` | Přidat 3 sloupce |
| `Person` | + reverzní relace `competencies`, `batches_created`, `batch_operations_assigned`, `batch_operation_logs` | Jen relace |

### 6.3 Napojení na existující (čte plánovač, nemění)

- `Person`, `Attendance` — kdo je dnes v práci
- `LeaveRequest` — kdo má dovolenou (vyřadí z kapacity)
- `Shift` — pracovní směny + dostupné hodiny
- `Stock` + `StockRule` — co je na skladu
- `Order` + `OrderItem` — zákaznická poptávka → SlotAssignment
- `Company` — dodavatelé materiálu

## 7. Fáze a milníky

| Fáze | Co | Odhad | Stav |
|---|---|---|---|
| **F1 Datový základ** | Schema migrace 8 nových modelů + 4 rozšíření + Competency CRUD + Batch CRUD + BatchOperation CRUD + seed | **5-7 dní** | 🟡 V práci |
| **F2 Factorify pull** | Stažení BOM + ProductOperation + Material + Company přes Factorify API. UI kalibrace časů (`from_factorify` flag) | 3-5 dní | ⬜ |
| **F3 Plánovač v1** | Generuje ProductionBatch a BatchOperation. Bere kompetence + Attendance + Leave + Stock. Pre-pick orderuje materiál na input_location. Agent `planovac` + MCP `generate_weekly_plan` | 7-10 dní | ⬜ |
| **F4 MRP + nákup** | BOM explosion + netting + lead_time offset + návrh POs. Endpoint `mrp-run`, alerty | 5-7 dní | ⬜ |
| **F5 UI dispečer** | Modul `planovani-vyroby` + slot health v `vyrobni-sloty` + drag-drop OrderItem do slotu + Workstation buffer view + alerts | 5-7 dní | ⬜ |
| **F6 Výrobní obrazovka** | Rozšíření `modules/kiosky/` o WS kiosek (čipový login → "Najít práci" filtr přes kompetence + ready BatchOperation → start/pause/done logging) | **5-7 dní** | ⬜ |
| **F7 Workflow engine** | n8n-style canvas + run viewer + DAG plánovač + feedback. Paralelně po F3 | 8-12 dní | ⬜ |

**Total: 38-55 dní práce, paralelizace F7 zkracuje o ~5 dní. Při 1-2 dny týdně ≈ 5-6 měsíců.**

## 8. TODO list (zaškrtávat při dokončení)

### F1 — Datový základ ✅ DONE 2026-04-27
- [x] **F1.1** Schema rozšíření v `prisma/schema.prisma` (8 nových + 4 rozšíření)
- [x] **F1.2** Migrační SQL `20260427160947_pridej-davky-kompetence-bom-snapshot` + apply na Railway DB (diff + db execute + migrate resolve)
- [x] **F1.3** Routes Competency + WorkerCompetency + OperationRequiredCompetency CRUD (11 endpointů)
- [x] **F1.4** Routes ProductionBatch + BatchOperation CRUD + generátor batch_number `{rok}-{seq3}` (9 endpointů)
- [x] **F1.5** Seed `scripts/seed-competencies.js` — 15 kompetencí (svarovna, montáž, elektro, bondy, lakovna, kontrola, expedice)

### F2 — Factorify pull (částečně 2026-04-27)
- [x] **F2.1** Factorify klient (`scripts/dump-factorify-fast.js`) už existuje — Goods/Stage/WorkOperation přes `POST /api/query/{Entity}` s X-AccountingUnit hlavičkou
- [x] **F2.2** Sync ProductOperation z Factorify s `from_factorify=true` (přidáno do dump skriptu)
- [ ] **F2.3** Sync Material lead-time + supplier z Factorify (TODO)
- [ ] **F2.4** UI pro kalibraci časů ProductOperation (override `last_calibrated_at`) (TODO)
- [x] **F2.5** Snapshot endpoint `POST /api/planning/snapshot-bom` v `routes/planning.routes.js` — flat BOM (depth=0) z OperationMaterial. + GET list/detail + DELETE

### F3 — Plánovač v1 (částečně 2026-04-27)
- [x] **F3.1** Generátor BatchOperation z dávky: `services/planning/batch-operations.js` + `POST /api/planning/batches/:id/generate-operations` + auto-generate při `POST /api/production/batches` (default true). UI: checkbox v modalu + tlačítko "⚙️ Generuj op." v tabulce u dávek s 0 op.
- [ ] **F3.2** `services/planning/batch-builder.js` — EOQ s kapacitním omezením (TODO)
- [ ] **F3.3** `services/planning/capacity-planner.js` — RCCP (týdenní) + CRP (denní) (TODO)
- [x] **F3.4** Pre-pick V1 — `services/planning/pre-pick.js`. Pro každou BatchOperation: konsoliduje OperationMaterial × batch.quantity, najde Stock zdroj s největší dostupností, navrhne transfer na `workstation.input_location`. Endpoint `POST/GET /api/planning/batches/:id/pre-pick`. UI: tlačítko "🚚 Pre-pick" v `planovani-vyroby` → modal po pracovištích s tabulkou (kód, název, potřeba, zdroj, dostupné, akce). Akce: transfer_ok / on_location / shortage / no_source / no_target. **V1: pouze návrh — reálné InventoryMovement se vystavuje ručně v "Skladové doklady".**
- [ ] **F3.5** Routes `POST /api/planning/weekly-plan`, `POST /api/planning/daily-plan` (TODO)
- [ ] **F3.6** MCP `planning-server/` + tool `generate_weekly_plan` v1 (TODO)
- [ ] **F3.7** Agent `planovac` + zaregistrování v orchestrátoru (TODO)

### F4 — MRP V1 (částečně 2026-04-27)
- [x] **F4.1** `services/planning/mrp.js` — BOM explosion (flat, depth=0) + netting Stock vs. potřeba. BOM zdroj: BomSnapshot pokud má, jinak fallback OperationMaterial. Sumuje Stock přes všechny lokace (quantity - reserved_quantity).
- [x] **F4.2** Lead-time offset (Material.lead_time_days → expected_delivery), zaokrouhlení qty_to_order na batch_size_default/min. Kategorizace long-lead/kanban TODO.
- [x] **F4.3** Endpoint `POST /api/planning/mrp-run` (s body { batch_id }) + GET `/api/planning/batches/:id/mrp` pro UI lazy-load.
- [x] **F4.4** MCP `planning-server/` se 8 tools: `list_batches`, `get_batch_detail`, `create_batch`, `generate_operations`, `release_batch`, `calculate_mrp`, `create_bom_snapshot`, `list_competencies`. Agent `planovac` registrovaný v orchestrátoru (servers: planning + production + warehouse). KEYWORD_MAP + MODULE_ASSISTANT_MAP rozšířené.
- [x] **F4.5** UI report v `planovani-vyroby` — tlačítko "📊 MRP" u dávky (per-batch) + nový **konsolidovaný "📋 Nákupní report"** v page header (přes všechny aktivní dávky). Endpoint `GET /api/planning/purchase-report` agreguje shortage per material, group by supplier. Sloupec "Materiál k dispozici" se updatne po MRP fetchi.

### F5 — UI dispečer (částečně 2026-04-27)
- [x] **F5.1** `vyrobni-sloty` rozšíření — health badge v detail modalu (lazy fetch /health-score, color + progress bar) + **in-grid mini badge** na každém occupied slotu (3px barevný proužek nahoře + procento vpravo nahoře, počítáno client-side ze slot.assignments)
- [ ] **F5.2** `prodejni-objednavky` — drag-drop OrderItem → SlotAssignment
- [x] **F5.3** Modul `planovani-vyroby` (nový) — přehled dávek, denní plán, filtr týden/typ (Factorify-style hustá tabulka, MRP modal, generátor operací)
- [x] **F5.4** Workstation buffer view — endpoint `GET /api/production/workstations/:id/buffer` (Stock per input/output location + in_progress operations) + tlačítko "📦 Materiál" v top baru kiosku → modal s tabulkou.
- [x] **F5.5** Endpoint `GET /api/slots/:id/health-score` — utilization_pct, status (under/optimal/full/overloaded/no_capacity), color hex, working_days × capacity_per_day

### F6 — Výrobní obrazovka pracoviště ✅ DONE 2026-04-27 (MVP)
- [x] **F6.1** `modules/kiosky/pracoviste.html` (URL `?ws=N`) + aktivace karty na rozcestníku
- [x] **F6.2** Login čipem přes existující `/api/hr/kiosk/identify` (sdíleno s HR kioskem)
- [x] **F6.3** `GET /api/production/workstations/:id/available-work?person_id=N` — tvrdé filtrování přes WorkerCompetency × OperationRequiredCompetency, vrací `my_in_progress` + `available`
- [x] **F6.4** `POST /api/production/batch-operations/:id/start` (z F1.4)
- [x] **F6.5** `POST /api/production/batch-operations/:id/done` (z F1.4) — auto-transfer materiálu na další pracoviště je TODO pro F3 plánovač
- [x] **F6.6** Touch-friendly fullscreen UI — velká tlačítka, dark theme, animovaný chip pulse, toast notifikace
- [x] **F6.7** Polling 30s + auto-logout po 5 min nečinnosti

**Smoke test data**: `node scripts/seed-test-batch.js --ws=N` vyrobí 1 testovací dávku se statusem `released` + BatchOperation pro každou ProductOperation pracoviště, status `ready` (hned vidět v kiosku).

### F7 — Workflow engine (paralelně po F3)
- [ ] **F7.1** Schema migrace `Workflow`, `WorkflowNode`, `WorkflowEdge`, `WorkflowRun`, `NodeExecution`, `Feedback`
- [ ] **F7.2** `services/ai/workflow-engine.js` — topologické řazení, exekuce, retry, logování
- [ ] **F7.3** Modul `workflows/` — plátno (LiteGraph.js nebo custom SVG)
- [ ] **F7.4** Run viewer + feedback UI (palec nahoru/dolů + komentář)
- [ ] **F7.5** Přepsání plánovače na DAG: rozklad objednávek → capacity check → feeder scheduler → main line balancer → MRP → souhrn

## 9. Klíčová rozhodnutí

| Otázka | Rozhodnutí |
|---|---|
| Pojmenování dovedností? | `Competency` (kolize `Skill` s AI registry) |
| OrderItem ↔ Batch? | Přes `SlotAssignment` (žádný pivot pro V1) |
| Feeder dávky? | `parent_batch_id` reference |
| Variant BOM? | `variant_key` string `"ram:nerez|barva:bila"` (ne ProductVariant) |
| BOM snapshot ukládání? | 2 tabulky (hlavička + řádky), ne JSON |
| Pulse line? | `Workstation.flow_type='pulse'` připraven, dnes vše `batch` |
| Striktnost kompetencí? | **Tvrdé** — pracovník nevidí v kiosku úkol, na který nemá kompetenci |
| Workshop kiosek umístění? | Rozšíření `modules/kiosky/` (sdílí pattern s HR kioskem) |
| Factorify start? | API pull (BOM + postupy + materiály + dodavatelé) |

## 10. Konvence (NESMÍŠ porušit)

- **Čeština** — komentáře, error messages, UI texty, git commity
- **Prisma, ne raw SQL** — vždy `prisma.xxx.yyy(...)`
- **JWT v httpOnly cookie** — moduly NESMĚJÍ dělat token-based redirect
- **Všechny routy mají `requireAuth`** (mimo `/api/auth/*`)
- **Chyby přes `next(err)`**, ne `res.status(500).send(...)`
- **Include relationships**, ne N+1 queries
- **Index na FK + frequently filtered fields**
- **Migrace s popisným názvem**, proti Railway DB **NE `migrate dev`** (viz `holyos_prisma_migrate_workflow.md`)

## 11. Změnový log + zpětná vazba

### 2026-04-27 — V2 revize plánu
- Přidána plná matice kompetencí (operace × člověk)
- Přidána F6 Výrobní obrazovka pracoviště (kiosek čipový login + "Najít práci")
- Přidána pre-pick logika (auto vystavení transferu materiálu na input_location pracoviště)
- Přidáno napojení na Attendance + LeaveRequest jako vstup plánovače
- Přidáno hlídání materiálu na pracovišti (input/output buffer)
- Zjištěno: `Workstation.input_*/output_*` už v schema je → ušetřena 1 migrace
- Zjištěno: `Material.lead_time_days`, `supplier_id`, `batch_size_*` už v schema je → ušetřena 1 migrace

### F1 retro (2026-04-27 večer)

**Co fungovalo:**
- 1 model per Edit + průběžný `npx prisma validate` po každém kroku — žádný truncation, schema validní napoprvé.
- Vzor migračních skriptů ze sklad-2 (`migrate-planovac-f1.ps1` + `apply-planovac-f1-migration.js`) přizpůsobený 1:1, bez problémů.
- `prisma migrate diff` → `db execute` → `migrate resolve` workflow proti Railway DB hladce.

**Co chytlo neočekávaně:**
- **Mount sync drift**: po startu session bylo 90+ souborů v `git status` jako modified, schema.prisma uříznutá o 137 řádků, package.json truncated. Obnoveno přes `git show HEAD:path > path` (přes git checkout to nešlo — `.git/index.lock` blokovaný Windows-side procesem). Memory `holyos_truncated_files_pre_railway_up.md` se znovu potvrdila.
- **Edit/bash mount inkonzistence**: Edit/Read tool vidí Windows realitu okamžitě, ale bash mount má cache delay (až 10 s). `wc -l` po Editu vrací starou hodnotu — pro ověření používat Read tool, ne `wc`/`cat`.
- **Drift v migration.sql**: `prisma migrate diff` vygeneroval `ALTER TABLE company_branches ALTER COLUMN updated_at DROP DEFAULT` — preexisting drift mezi DB a schemou (default v DB, ne ve schemě). Bezpečné, ponecháno.

**Co změnit ve F2:**
- Před start session vždy ověřit `git status --short | wc -l` a `wc -l prisma/schema.prisma` proti HEAD. Pokud drift, hned `git show HEAD:` na kritické soubory.
- Pro Factorify pull asi bude potřeba `BomSnapshot.source = 'factorify_pull'` + `source_ref` ukládat Factorify Stage run-id.

---

## 12. Pro Clauda v budoucí session

**Tento dokument čti jako první.** Pak mrkni:
1. Sekci 8 (TODO) — co je hotové, co rozpracované
2. Sekci 11 (changelog) — co se dělo posledně
3. Memory `holyos_pradlomat_planovac.md` (zkrácený kontext)
4. Memory `holyos_prisma_migrate_workflow.md` (proti Railway NE migrate dev)
5. Memory `holyos_powershell_bom_gotcha.md` (PS5.1 BOM gotcha)
6. Memory `holyos_truncated_files_pre_railway_up.md` (oseknuté JS soubory před deployem)

Před implementační akcí ověř reálný stav kódu (čti soubor, nepředpokládej) — paměť/plán může být stará.
