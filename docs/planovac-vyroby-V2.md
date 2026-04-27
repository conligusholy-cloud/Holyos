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
  id, batch_number (DV-{rok}-W{week}-{seq}),
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
- [x] **F1.4** Routes ProductionBatch + BatchOperation CRUD + generátor batch_number `DV-{rok}-W{week}-{seq}` (9 endpointů)
- [x] **F1.5** Seed `scripts/seed-competencies.js` — 15 kompetencí (svarovna, montáž, elektro, bondy, lakovna, kontrola, expedice)

### F2 — Factorify pull
- [ ] **F2.1** Rozšíření Factorify klienta o BOM endpoint (`POST /api/query/Stage` s parametry)
- [ ] **F2.2** Sync ProductOperation z Factorify s `from_factorify=true`
- [ ] **F2.3** Sync Material lead-time + supplier z Factorify
- [ ] **F2.4** UI pro kalibraci časů ProductOperation (override `last_calibrated_at`)
- [ ] **F2.5** Snapshot endpoint `POST /api/planning/snapshot-bom`

### F3 — Plánovač v1
- [ ] **F3.1** `services/planning/scheduler.js` — týdenní kapacitní plán
- [ ] **F3.2** `services/planning/batch-builder.js` — EOQ s kapacitním omezením
- [ ] **F3.3** `services/planning/capacity-planner.js` — RCCP (týdenní) + CRP (denní)
- [ ] **F3.4** Pre-pick logika: po vygenerování BatchOperation vystavit transfer order na `input_location_id` pracoviště
- [ ] **F3.5** Routes `POST /api/planning/weekly-plan`, `POST /api/planning/daily-plan`
- [ ] **F3.6** MCP `planning-server/` + tool `generate_weekly_plan` v1
- [ ] **F3.7** Agent `planovac` + zaregistrování v orchestrátoru (AGENT_MCP_MAP, KEYWORD_MAP, MODULE_ASSISTANT_MAP)

### F4 — MRP
- [ ] **F4.1** `services/planning/mrp.js` — BOM explosion + netting
- [ ] **F4.2** Lead-time offset, kategorizace položek (long-lead / kanban / vyráběné)
- [ ] **F4.3** Endpoint `POST /api/planning/mrp-run` — vrátí návrhy POs
- [ ] **F4.4** MCP tool `calculate_mrp`
- [ ] **F4.5** UI report návrhů nákupu (modul `planovani-vyroby`)

### F5 — UI dispečer
- [ ] **F5.1** `vyrobni-sloty` rozšíření o slot health score + barevné varování
- [ ] **F5.2** `prodejni-objednavky` — drag-drop OrderItem → SlotAssignment
- [ ] **F5.3** Modul `planovani-vyroby` (nový) — přehled dávek, denní plán, filtr týden/typ
- [ ] **F5.4** Workstation buffer view (vstupní/výstupní materiál v reálném čase)
- [ ] **F5.5** Endpoint `GET /api/slots/:id/health-score`

### F6 — Výrobní obrazovka pracoviště
- [ ] **F6.1** Rozšíření `modules/kiosky/` o typ `workstation` (URL `?type=workstation&ws=N`)
- [ ] **F6.2** Login čipem (Attendance pattern, sdílí logiku se HR kioskem)
- [ ] **F6.3** Endpoint `GET /api/workstation/:id/available-work` — filtrované přes kompetence + ready BatchOperation
- [ ] **F6.4** Endpoint `POST /api/batch-operations/:id/start` (assigned_person_id + started_at)
- [ ] **F6.5** Endpoint `POST /api/batch-operations/:id/done` + auto-trigger transferu materiálu na další pracoviště
- [ ] **F6.6** Touch-friendly fullscreen UI (velká tlačítka, čitelné z 1 m)
- [ ] **F6.7** Live refresh seznamu úkolů (polling 30 s)

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
