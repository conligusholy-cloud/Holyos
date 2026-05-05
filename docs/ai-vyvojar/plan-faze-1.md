# AI Vývojář — Fáze 1 (MVP) — Plán implementace

> Doplněk k `brief-v1.md`. Sjednocuje terminologii briefu s reálným stavem HolyOSu, dolazuje otevřené body a rozsekává MVP na konkrétní pořadové kroky.

Datum: 2026-05-05  
Cíl Fáze 1: end-to-end průchod jednoho úkolu — zadání v modulu Úkoly → orchestrátor zvedne → otevře PR v testovacím repu → audit log v super admin UI.

---

## 0. Vyjasnění proti briefu (rozhodnuto teď)

### 0.1 Sjednocení názvosloví: tasks vs. AdminTask

Brief mluví o tabulce `tasks`. Realita: HolyOS má **`AdminTask` (tabulka `admin_tasks`)** v `prisma/schema.prisma`. Modul AI Vývojář se napojí na **`AdminTask`**, ne na novou tabulku `tasks`. Všechny FK ve specifikaci agentích tabulek (`agent_runs.task_id`) odkazují na `admin_tasks.id`.

### 0.2 Sjednocení názvosloví: chat_threads vs. ChatChannel

Brief mluví o `chat_threads`. Realita: HolyOS má **`ChatChannel`** s `type` enum (`direct|group|task|system`) a polem `admin_task_id` jako vazbou na úkol. Komunikace agenta se zadavatelem půjde přes `ChatChannel` typu `task` se sender_type `ai`. Žádný nový messaging.

### 0.3 Stack orchestrátoru (DOLADĚNO)

**Rozhodnutí:** orchestrátor poběží **jako interní Node worker uvnitř HolyOS procesu** v `services/ai-developer/`, NE jako samostatný TS daemon.

Důvody:
- HolyOS už je Node + Express, druhý deployment by zbytečně rozdělil ops.
- Anthropic SDK je nainstalovaný, sdílíme ho.
- Stejné env a Prisma client jako zbytek backendu — žádné REST volání mezi orchestrátorem a HolyOS, přímý DB přístup.
- Worker se zapne přes env flag `AGENT_WORKER_ENABLED=true` a `agent_settings.enabled=true`. Ve výchozím stavu je vypnutý.
- TS overhead nepotřebujeme — píšeme v JS jako zbytek backendu (TypeScript je v repu jen pro některé skripty).

**Důsledek:** "Orchestrátor (TS)" v briefu je v Fázi 1 nahrazen worker modulem `services/ai-developer/worker.js` startovaným z `app.js`.

### 0.4 Cílový repozitář (DOLADĚNO)

**Fáze 1:** Pouze externí repo. AI Vývojář **neupravuje sám sebe** (HolyOS repo). Self-modify by vyžadovalo zvláštní bezpečnostní vrstvu, kterou ve Fázi 1 nemáme.

Pro ostré ověření Fáze 1 použijeme:
- Buď reálný `SIS` repo (pokud je připravené GH PAT a CI),
- Nebo testovací sandbox repo `holyos-ai-playground` (doporučeno pro první běh — žádné riziko poškození SIS).

Cílový repo se konfiguruje v tabulce `agent_repos`.

### 0.5 Servisní účet a auth (DOLADĚNO)

`requireAuth` v `middleware/auth.js` zkouší v pořadí:
1. `Authorization: Bearer <token>` header
2. `req.cookies.token` (httpOnly cookie pro browser)

Servisní účet pro orchestrátor není nutný v Fázi 1, protože orchestrátor běží **uvnitř HolyOS procesu** a používá Prisma přímo (viz 0.3). Worker volá obyčejné JS funkce (`agentRepository`, `agentService`), nikoli REST API.

ALE: agent **uvnitř sandboxu** (Claude Code v subprocess) přístup k HolyOS DB nemá. Pokud bude potřebovat HolyOS data (např. číst úkol), dostane je předem injectované do prompt/inputu. Bez internetu k DB.

V `users` tabulce ale potřebujeme **viditelný účet** pro chat zprávy, notifikace a audit:
- `username`: `ai-vyvojar`
- `display_name`: `Alan, AI Vývojář`
- `password_hash`: nepoužitelný hash (nelze se přihlásit)
- `role`: `system_agent` (nový string, semanticky)
- `is_super_admin`: `false`

ChatMessage od agenta má `sender_id = users.id` toho účtu, `sender_type = 'ai'`, `sender_label = 'Alan, AI Vývojář'`.

### 0.6 Sandbox ve Fázi 1

Brief: Docker per request. Realita Fáze 1: **lokální tmp adresář per run**, žádný Docker. Důvody:
- Railway hosting Dockeru jako vedlejšího procesu je netriviální.
- Pro MVP s autonomy vypnutým a "openni jen PR, žádný auto-merge" je riziko nízké.
- Docker přidáme v Fázi 2.

Konkrétní prostředí pro sandbox:
- `<os tmp>/holyos-agent/<run_id>/repo` — clone cílového repa
- Worker spawnuje child_process `claude` (Claude Code CLI) v tomto adresáři
- Po dokončení adresář smazat (i při chybě, nejlépe `try/finally`)

### 0.7 Fáze 1 vs. brief — co NEDĚLÁME

Brief obsahuje hodně, do Fáze 1 patří pouze:

| Komponenta briefu | Fáze 1? | Poznámka |
|---|---|---|
| `agent_settings` (singleton) | ✅ | Master switch, limity |
| `agent_runs` | ✅ | Hlavní tabulka |
| `agent_run_events` | ✅ | Audit log |
| `agent_rules` + UI | ❌ | Fáze 2 (zatím jen hardcoded forbidden v kódu) |
| `agent_repos` + UI | ✅ | Potřeba pro konfiguraci, jednoduchý CRUD |
| `agent_approvals` + UI | ❌ | Fáze 2 |
| `tasks.assignable_to_ai` (nové sloupce) | ✅ | Rozšíření AdminTask |
| Servisní user `ai-vyvojar` | ✅ | |
| Worker poller | ✅ | Vypnutý defaultně |
| Triáž režim | ✅ | Pouze "OK" verdikt v MVP, ostatní fallback na escalated |
| Plánování + schvalování | ❌ | Fáze 2 (jen fixní instrukce v Fázi 1) |
| Coding + testing | ✅ | Claude Code CLI v tmp adresáři |
| Open PR | ✅ | Přes GitHub API |
| Auto-merge | ❌ | Fáze 2 |
| Docker sandbox | ❌ | Fáze 2 |
| Pravidla forbidden/requires_approval | ❌ minimum | Hardcoded forbidden paths v sandboxu |
| Super admin UI: Dashboard | ✅ | Seznam běhů + kill switch |
| Super admin UI: Audit log | ✅ | Detail run + events |
| Super admin UI: Repos CRUD | ✅ | Min. funkční |
| Super admin UI: Pravidla | ❌ | Fáze 2 |
| Super admin UI: Schvalovací fronta | ❌ | Fáze 2 |
| AI chat doptává AC | ❌ | Fáze 3 (ve Fázi 1 se AC vyplňují ručně v Úkolech) |

---

## 1. Pořadí implementace

Závislosti zakódovány do tasklistu. Každý krok končí ověřitelným stavem.

### Krok 1 — Prisma schema změny

Přidat do `prisma/schema.prisma`:

- enum `AgentRunStatus` (queued, triaging, awaiting_clarification, planning, coding, testing, pr_open, merged, completed, failed, cancelled, escalated) — vynechány `awaiting_approval` (Fáze 2)
- enum `AgentAutonomyMode` (full_auto, pr_review, plan_review)
- enum `AgentRunEventKind` (tool_call, file_change, commit, question_to_user, error, decision, llm_message)
- model `AgentSettings` (singleton, Int id default 1)
- model `AgentRepo`
- model `AgentRun`
- model `AgentRunEvent`
- rozšíření `AdminTask` o sloupce: `assignable_to_ai Boolean @default(false)`, `acceptance_criteria String?`, `affected_module String?`, `target_repo_id String?` (FK na AgentRepo)

Dodržet styly schema souboru (UUID jako String @id @default(uuid()), snake_case mapování).

### Krok 2 — Migrace přes diff + execute + resolve workflow (Railway)

Podle memory `holyos_prisma_migrate_workflow`:

```bash
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma.bak \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/20260505_ai_developer/migration.sql

# Manual review of SQL

npx prisma db execute --file prisma/migrations/20260505_ai_developer/migration.sql --schema prisma/schema.prisma

npx prisma migrate resolve --applied 20260505_ai_developer
```

Před migrací: `cp prisma/schema.prisma prisma/schema.prisma.bak`. Po: `npx prisma generate`.

### Krok 3 — Seed servisního usera + výchozí AgentSettings

Skript `scripts/seed-ai-developer.js`:

- Vytvořit usera `ai-vyvojar` / `Alan, AI Vývojář`, password_hash = `$2a$10$INVALID_LOGIN_DISABLED`, role `system_agent`, is_super_admin false.
- Vytvořit AgentSettings s id=1, enabled=false (defaultně vypnutý), default_autonomy=`pr_review`, max_concurrent_runs=1, max_runs_per_day=5, daily_token_budget=1000000, default_timeout_minutes=30, max_commits_per_run=10, auto_merge_wait_minutes=15.

Idempotentní (upsert).

### Krok 4 — Repository vrstva: `services/ai-developer/repository.js`

Tenká vrstva nad Prisma:

- `listQueue(prisma)` — vrátí `AdminTask` přiřazené servisnímu uživateli, status `new`/`open`, `assignable_to_ai=true`, ne mají běžící run.
- `createRun(prisma, { taskId, repoId })`
- `updateRun(prisma, runId, patch)`
- `appendEvent(prisma, runId, kind, payload)`
- `getSettings(prisma)`
- `setSettings(prisma, patch, userId)`
- `listRuns(prisma, filter)`, `getRun(prisma, runId)` se eventy

### Krok 5 — Routes: `routes/agent.routes.js`

Mountnout v `app.js` jako `app.use('/api/agent', requireAuth, requireSuperAdmin, agentRoutes)`.

Endpointy (Fáze 1 minimum):

- `GET /api/agent/dashboard` — agregát (počet aktivních, dnešní spotřeba tokenů, posledních 20 runs)
- `GET /api/agent/settings`
- `PUT /api/agent/settings` — update + audit log
- `GET /api/agent/runs?status=&limit=`
- `GET /api/agent/runs/:id` — s eventy
- `POST /api/agent/runs/:id/cancel` — zruší běh (status `cancelled`)
- `GET /api/agent/repos`
- `POST /api/agent/repos`
- `PUT /api/agent/repos/:id`
- `DELETE /api/agent/repos/:id`
- `POST /api/agent/kill-switch` body `{ enabled, reason }` — toggle + audit

Validace přes `zod` (existuje? ověřit; pokud ne, ruční validace dle vzoru ostatních routes).

### Krok 6 — Orchestrator worker: `services/ai-developer/worker.js` + `services/ai-developer/agent-runner.js`

- `worker.js`: `start()` exportuje, spustí `setInterval(poll, 30000)`. `poll()`: čte settings, pokud `enabled`, načte queue, pro každý úkol spustí `agentRunner.run(task)` v pozadí (limit `max_concurrent_runs`).
- `agent-runner.js`: hlavní orchestrace — clone repa, branch, spustit Claude Code CLI, parsovat výstup, commit & push, otevřít PR přes GitHub API.

Fáze 1: `agentRunner.run` neumí triage a planning v plné šíři — používá fixní system prompt s akceptačními kritérii a říká: "uprav repo, commitni, otevři PR". Veškeré výsledky logujeme do `agent_run_events` typu `llm_message`, `file_change`, `commit`, `error`.

Tvrdé zákazy ve Fázi 1: hardcoded check před commitem — pokud změna sahá na `**/migrations/**`, `**/.env*`, `**/secrets/**` → přerušit a `escalated`.

### Krok 7 — GitHub integrace: `services/ai-developer/github.js`

- Klient nad `octokit` (přidat dep).
- Funkce: `createBranch`, `commitChanges` (přes git CLI), `openPullRequest`, `getPRStatus`.
- PAT v env `AI_DEV_GITHUB_TOKEN`.

### Krok 8 — Chat integrace: `services/ai-developer/chat.js`

- `postMessage(prisma, { adminTaskId, text, kind })` — najde nebo vytvoří `ChatChannel` typu `task` pro daný `adminTaskId`, append `ChatMessage` se `sender_id = aiVyvojar.id`, `sender_type = 'ai'`, `sender_label = 'Alan, AI Vývojář'`.
- Použité kindy: "Beru si to", "Otázka", "Hotovo, otevřel jsem PR", "Eskalace".

### Krok 9 — Notifikace

- Po otevření PR: vytvořit `Notification` pro `created_by` úkolu. `type = 'task_status'` (existuje), title = `"AI Vývojář otevřel PR k úkolu #X"`, body = link na PR + úkol.

### Krok 10 — Frontend modul: `modules/ai-vyvojar/`

- `index.html` — layout dle `holyos_module_layout_pattern` (sidebar + main-wrapper, žádný .dashboard wrapper).
- `app.js`:
  - Načte `/api/agent/dashboard` na onload.
  - Tabulka posledních běhů (status barevné chipy, link na detail).
  - Velký kill switch v hlavičce (POST `/api/agent/kill-switch`).
  - Tab "Repozitáře" — CRUD nad `/api/agent/repos`.
  - Tab "Limity" — formulář nad `/api/agent/settings`.
  - Tab "Audit log" — drilldown do `/api/agent/runs/:id`.
- Styly inline (memory `holyos_datatable_inline_css`).

### Krok 11 — Sidebar registrace

- `js/sidebar.js`: přidat `{ id: 'ai-vyvojar', name: 'AI Vývojář', icon: '&#129302;', color: '#0ea5e9', active: true }`.
- Modul viditelný jen pro `is_super_admin` (kontrola v `renderSidebar`, pokud existuje gate; jinak vidí všichni a backend stejně 403 vrátí).

### Krok 12 — env + Railway

Nové env proměnné:

- `AGENT_WORKER_ENABLED=true|false` — zapne worker v procesu (default false v produkci, true při ladění).
- `AI_DEV_GITHUB_TOKEN=ghp_xxx` — GitHub PAT pro servisní účet.
- `AI_DEV_TMP_DIR=/tmp/holyos-agent` — root pro sandbox adresáře (default `os.tmpdir()`).

Synchronizovat lokální `.env` i Railway variables (memory `holyos_railway_env_sync`).

### Krok 13 — Verifikace MVP

- `node --check` všech nově vzniklých `.js` souborů (memory `holyos_truncated_files_pre_railway_up`, `holyos_write_tool_nul_padding`).
- `npx prisma validate`.
- `npx prisma generate` musí projít bez warnings.
- Manuální test:
  1. Lokálně: `AGENT_WORKER_ENABLED=true npm run dev`.
  2. V super admin sekci: vytvořit AgentRepo `holyos-ai-playground`.
  3. V modulu Úkoly: založit úkol, označit `assignable_to_ai=true`, přiřadit `ai-vyvojar`, vyplnit `acceptance_criteria`.
  4. Po ≤30 s: orchestrátor zvedne, worker zaloguje run, otevře PR.
  5. Audit log v super admin obsahuje řadu eventů, link na PR.
- Před `railway up`: `node --check` znovu, push do origin, ověřit že Railway env má `AGENT_WORKER_ENABLED` a `AI_DEV_GITHUB_TOKEN`.

---

## 2. Závislosti pro `package.json`

Přidat:

- `octokit` (GitHub API klient) — `^3.x`
- `simple-git` (git operace) — `^3.x`
- `@anthropic-ai/claude-code` (Claude Code SDK / CLI) — verze dle aktuálu

Anthropic SDK už je. UUID už je. Bcrypt už je.

---

## 3. Riziková místa a poznámky

- **Claude Code CLI**: ověřit, že CLI lze spustit z child_process s nastavenými env (ANTHROPIC_API_KEY) a pracovním adresářem. Pokud ne, fallback na `@anthropic-ai/sdk` přímo s vlastními tool calls.
- **GitHub PAT scope**: musí mít `repo` scope a být přidaný do org/repa jako collaborator.
- **Railway tmp dir**: existuje? Limity velikosti? Pro malé repa OK. Pokud SIS je velký, sandbox čisticí logika musí spolehlivě promazávat.
- **Token budget**: ve Fázi 1 nezapojeno tvrdé limitování (jen logujeme `tokens_used`). Vyhodnotit po prvních bězích.
- **Race condition v polleru**: pokud `max_concurrent_runs > 1`, dva pollery může pickpnout stejný úkol. Řešení: SELECT ... FOR UPDATE SKIP LOCKED nebo "claim" sloupec na AdminTask. Pro Fázi 1 se nastaví `max_concurrent_runs=1` a tím se obejde.
- **Truncated files na Windows mountu** (memory `holyos_truncated_files_pre_railway_up`): při Write/Edit velkých souborů přes Windows mount občas vznikne padding NUL. Před commitem `tr -d '\000'` na všech nových `.js`.
- **PowerShell BOM** (memory `holyos_powershell_bom_gotcha`): pokud generujeme migration.sql přes PowerShell, NEpoužít `Out-File -Encoding utf8`. Použít `Set-Content` nebo přímo Node skript.

---

*Plán Fáze 1, verze 1.0 — 2026-05-05*
