# Hand-off pro nový chat — Plánovač prádlomatů, Fáze 1

> **Pro Clauda v nové session:** Pokračování z 2026-04-27 večer. Iniciativa **Účetní doklady** dokončena (12/12 fází), produkce běží na holyos.cz. Teď začíná **iniciativa Plánovač výroby prádlomatů**.

## 1. Stav

- **Iniciativa Účetní doklady — DONE 12/12** ✅ (commit pushnuté, na produkci)
- **Iniciativa Plánovač** — V2 plán uložen v `docs/planovac-vyroby-V2.md`, schéma rozhodnutí potvrzeno, **kódování ještě nezačalo**
- Memory `holyos_pradlomat_planovac.md` aktualizovaná, odkazuje na V2

## 2. Tvůj první krok

1. **Přečti `docs/planovac-vyroby-V2.md` celý.** Pochopíš funkční oblasti, datový model, fáze, TODO.
2. **Přečti memory soubory** (klíčové pro tuto práci):
   - `holyos_prisma_migrate_workflow.md` — proti Railway DB **NE** `migrate dev`. Vzor: diff + db execute + migrate resolve.
   - `holyos_truncated_files_pre_railway_up.md` — pracovní strom občas má uříznuté JS soubory. Po každém Edit ověř `wc -l`.
   - `holyos_powershell_bom_gotcha.md` — PowerShell 5.1 nepoužívat `Out-File -Encoding utf8`.
   - `holyos_railway_deploy_source.md` — `railway variables --set` redeployuje z origin/main.
3. **Ověř čisté schema:** `npx prisma validate` (poslední potvrzeno OK 4/27 22:00).
4. **Spusť `TaskList`** — uvidíš tasky #26-#30 pro F1 sub-úkoly + #25 pro F6 kiosek.

## 3. Klíčová rozhodnutí ze 4/27

| Otázka | Rozhodnutí |
|---|---|
| Striktnost kompetencí v kiosku | **Tvrdé** — pracovník nevidí úkol, na který nemá kompetenci |
| Workshop kiosek umístění | Rozšíření existujícího `modules/kiosky/` (sdílí pattern s HR) |
| Factorify | API pull (BOM + postupy + materiály + dodavatelé), `from_factorify=true` flag, ručně kalibrovatelné časy |
| Plná matice kompetencí | **Ano** — `OperationRequiredCompetency` (operace × kompetence × min_level) |
| F7 workflow engine | Paralelně po F3 plánovači, ne v MVP |

## 4. NEDĚLAT VELKÉ SOUBORY (lekce 4/27)

Během práce na účetních dokladech se v `prisma/schema.prisma` a `routes/accounting.routes.js` opakovaně objevily oseknuté konce souborů (mid-route, mid-model). Pravděpodobně z velkých `Edit` operací nad 1500+ řádkovými soubory. Tomáš to zmínil explicitně.

**Postup:**

1. **Maximálně 1 model nebo 1 route na 1 Edit operaci.** Žádné mega-bloky.
2. **Po každém Edit kontrola:**
   - JS routes: `node --check routes/xxx.routes.js`
   - Schema: `npx prisma validate`
   - Soubor: `wc -l` před a po, ať vidíme, že se nic nezkrátilo
3. **Pokud se zdá zkrácený** (`wc -l` menší nebo končí mid-block): okamžitě `git checkout HEAD -- soubor` a zkus jinou strategii.
4. **Šetři kontextem** — nečti velké soubory celé, použij `grep -n` + `sed -n 'X,Yp'` na konkrétní místa.

## 5. Plán Fáze 1 — sub-úkoly

### F1.1 Schema (task #26)

V `prisma/schema.prisma` přidat **POSTUPNĚ, jeden model na 1 Edit**:

1. `Competency` — katalog dovedností
2. `WorkerCompetency` — vazba Person × Competency
3. `OperationRequiredCompetency` — operace × kompetence
4. `ProductionBatch`
5. `BomSnapshot`
6. `BomSnapshotItem`
7. `BatchOperation` — instance operace pro dávku (klíč pro kiosek!)
8. `BatchOperationLog`

**Plus rozšíření existujících entit** (každé samostatný Edit):

- `Workstation` ← `flow_type String @default("batch") @db.VarChar(20)`
- `Product` ← `min_batch_size Int?`, `economic_batch_size Int?`, `batch_size_step Int?`
- `SlotAssignment` ← `batch_id Int?` (FK na ProductionBatch)
- `ProductOperation` ← `from_factorify Boolean @default(false)`, `last_calibrated_at DateTime?`, `last_calibrated_by_id Int?`
- `Person` ← reverzní relace (WorkerCompetency, ProductionBatch creator, BatchOperation assigned, BatchOperationLog)

**POZOR — už v schema je** (zjištěno 4/27, nepřidávat duplikát):
- `Material.lead_time_days`, `Material.supplier_id`, `Material.batch_size_min/max/default`
- `Workstation.input_warehouse_id`, `input_location_id`, `output_warehouse_id`, `output_location_id`

**Po každém Edit:** `npx prisma validate`. Tomáš pošle výstup, pak pokračovat.

### F1.2 Migrační SQL (task #27)

Per `holyos_prisma_migrate_workflow.md`:

1. Vyrobit ručně SQL migraci `prisma/migrations/{stamp}_pridej-davky-kompetence-bom-snapshot/migration.sql`
2. Apply přes `npx prisma db execute --file ... --schema prisma/schema.prisma`
3. Označit jako applied: `npx prisma migrate resolve --applied {stamp}_pridej-...`
4. P3008 "already recorded as applied" je benigní (memory `holyos_prisma_p3008_benign.md`)

### F1.3 Routes Competency (task #28)

V `routes/production.routes.js` (existuje, ověř délku před Edit):

- `GET/POST /api/production/competencies` — list + create (super admin)
- `GET/PUT/DELETE /api/production/competencies/:id`
- `GET/POST /api/production/persons/:personId/competencies`
- `POST /api/production/operations/:opId/required-competencies`

**Jedna route na Edit, po každé `node --check`.**

### F1.4 Routes Batch + BatchOperation (task #29)

Stejný soubor:

- `GET/POST /api/production/batches` + generátor batch_number `DV-{rok}-W{week}-{seq}`
- `GET/PUT /api/production/batches/:id`
- `POST /api/production/batches/:id/release` — status planned → released
- `GET /api/production/batch-operations` — pro kiosek
- `POST /api/production/batch-operations/:id/start` — assigned_person_id + started_at
- `POST /api/production/batch-operations/:id/done` — finished_at + duration_minutes

### F1.5 Seed (task #30)

Nový **samostatný** soubor `scripts/seed-competencies.js` (~150 řádků):

15 kompetencí: svařování MIG, pájení bondů, montáž rámu, elektromontáž, kabeláž, programování PLC, kontrola jakosti, zkouška těsnosti, lakování, balení, atd. Idempotentní upsert podle `code`.

## 6. Po F1

V `docs/planovac-vyroby-V2.md` sekce 8 zaškrtnout F1.1 - F1.5 a do sekce 11 přidat zpětnou vazbu.

Pak rozhodnout, jestli pokračovat F2 (Factorify pull) nebo F6 (kiosek — protože Person + Attendance + Competency už máme, kiosek lze postavit dřív).

## 7. Tvůj styl práce

- **Krátké odpovědi.** Tomáš měl masivní den.
- **Po každém Edit pošli 2-3 řádky souhrn** + výstup validate/check + ptej se "pokračovat?".
- **Žádné mega-edity.** Max 1 model nebo 1 route na 1 Edit.
- **Šetři kontextem.** `grep -n` + `sed -n` místo čtení celých souborů.

Hodně štěstí. Tomáš zaslouží klidnou session.

---

## Příloha: Co je v gitu z 4/27

Dnešní commits (`git log --oneline -10`):
- Účetní doklady Fáze 1-12 + force-delete + Sklad 2.0 fixes (velký commit)
- Reports: oprava Vehicle.brand/model → category/year (Fáze 9 fix)

Untracked / pending v repu:
- `docs/planovac-vyroby-V2.md` (nový plán)
- `docs/HANDOFF-PLANOVAC-2026-04-27.md` (tento soubor)
- Memory updates v paměťovém systému

Před začátkem F1 práce **nejdřív commit + push tyto 2 dokumenty**, ať jsou v repu pro budoucí reference.
