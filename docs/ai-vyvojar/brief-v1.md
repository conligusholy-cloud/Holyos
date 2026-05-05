# HolyOS — Modul "AI Vývojář" — Brief v1.0

> Brief pro implementaci 13. modulu HolyOSu. Modul přijímá požadavky z modulu Úkoly, autonomně je analyzuje, programuje a odevzdává jako PR. Komunikuje přes existující Chat HolyOSu, využívá sdílenou DB a uživatele.

---

## 1. Výchozí situace a rozhodnutí

- Modul AI Vývojář je **součást HolyOSu**, ne samostatná služba. Žije ve stejné DB, sdílí `users`, `roles`, `tasks`, `chat_threads`, `notifications`.
- **Plná autonomie + povinný PR + auto-merge** je výchozí režim. Agent commituje sám, ale do feature větve, otevře PR. Po splnění podmínek (testy + lintery + žádné zamítnutí v okně N minut) se PR auto-mergne.
- **Tvrdé zákazy** (migrace, secrets, autentizace, force push, mazání DB) platí vždy bez ohledu na nastavení autonomie.
- AI Vývojář má **vlastní HolyOS user account** s avatarem a jménem (např. *Alan, AI Vývojář*). Pro zaměstnance vypadá jako kolega — píše do chatu, plní úkoly, dostává notifikace.
- Komunikace s zadavatelem probíhá výhradně přes **chat thread daného úkolu**. Žádné nové komunikační kanály.
- Vývoj běží v **Docker kontejneru per požadavek** — čistý sandbox, po dokončení se zahodí.
- **Backend agenta**: Claude Code SDK (CLI/programatický). Orchestrátor je tenká vrstva, která pollnuje úkoly, spouští kontejnery a píše do DB.
- Kódí se primárně v repu **SIS** a dalších, které se přidají v super admin sekci.
- **AI chat v HolyOS** doptává zadavatele na akceptační kritéria *před* tím, než úkol dojde k AI Vývojáři. AI Vývojář dostává úkol s vyplněnými poli.

---

## 2. Technologický stack

### 2.1 Modul v HolyOSu (UI + API)

- Stejný stack jako zbytek HolyOSu (frontend, REST API, PostgreSQL).
- Nová sekce v super admin menu **AI Vývojář** s podstránkami: Dashboard, Pravidla, Limity, Repozitáře, Schvalovací fronta, Audit log, Kill switch.

### 2.2 Orchestrátor (vlastní mikroslužba)

- **Node.js + TypeScript** (doporučení — stejný jazyk jako Claude Code SDK, minimum kontextového přepínání).
- Běží jako démon vedle HolyOS backendu (na stejném serveru nebo VPS).
- Komunikuje s HolyOS přes interní REST API (servisní účet AI Vývojáře) a přímo s DB (nebo přes API, podle preference).
- Alternativně: pokud bude HolyOS v PHP, dá se napsat v PHP/Laravel jako Job worker — ale TypeScript je čistší kvůli SDK.

### 2.3 Sandbox

- **Docker** s předpřipraveným image: Node, Python, git, Claude Code CLI, lintery a testovací nástroje pro stack HolyOSu.
- Per požadavek = jeden krátkodobý kontejner.
- Žádný persistent storage v kontejneru — repo se klonuje vždy znovu.

### 2.4 Git workflow

- Všechna repa na GitHubu (SIS a další).
- Agent vždy větvi z `main` do `ai/REQ-{id}-{slug}`.
- PR vytváří přes GitHub API (servisní GitHub účet propojený s uživatelem AI Vývojáře v HolyOSu).
- Auto-merge přes GitHub Actions po splnění podmínek (viz kap. 7).

---

## 3. Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│                          HolyOS                                  │
│                                                                  │
│  ┌─────────┐  ┌─────────┐  ┌────────┐  ┌──────────┐             │
│  │  Úkoly  │  │  Chat   │  │ Lidé/  │  │Notifikace│             │
│  │         │  │         │  │ role   │  │          │             │
│  └────┬────┘  └────┬────┘  └────┬───┘  └────┬─────┘             │
│       │            │            │           │                   │
│       └────────────┴────────────┴───────────┘                   │
│                          │                                      │
│              ┌───────────┴───────────┐                          │
│              │  Modul AI Vývojář     │                          │
│              │  (UI + API endpointy) │                          │
│              └───────────┬───────────┘                          │
│                          │                                      │
│                  Sdílená PostgreSQL                             │
│  users · tasks · chat_messages · agent_runs · agent_rules ...   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ interní REST API + DB
                           ▼
              ┌────────────────────────┐
              │   Orchestrátor (TS)    │
              │   - poll úkoly         │
              │   - spouští kontejnery │
              │   - pravidla, limity   │
              │   - audit              │
              └────────────┬───────────┘
                           │ Docker API
                           ▼
              ┌────────────────────────┐
              │   Docker sandbox       │
              │   (per požadavek)      │
              │                        │
              │   Claude Code SDK      │
              │   git, testy, lintery  │
              └────────────┬───────────┘
                           │ git push, GitHub API
                           ▼
              ┌────────────────────────┐
              │  GitHub repo (SIS, ..) │
              │  feature branch + PR   │
              │  auto-merge po testech │
              └────────────────────────┘
```

**Klíčový důsledek:** modul AI Vývojář v HolyOSu je *řídicí a zobrazovací vrstva*. Skutečnou práci dělá orchestrátor + sandbox, ale veškerý stav, požadavky, komunikace a audit žijí v HolyOS DB. Pokud orchestrátor spadne, modul v HolyOSu pořád funguje — jen se nic nerozjede do té doby, než se orchestrátor zvedne.

---

## 4. Datový model (PostgreSQL)

Tabulky níže jsou součástí hlavní HolyOS DB. FK na existující tabulky (`users`, `tasks`, `chat_threads`, `chat_messages`).

### 4.1 `agent_settings` (singleton, jeden řádek)

| Sloupec | Typ | Popis |
|---|---|---|
| `id` | INT | PK, vždy 1 |
| `enabled` | BOOL | Master switch (kill switch = false) |
| `default_autonomy` | ENUM | `full_auto`, `pr_review`, `plan_review` |
| `max_concurrent_runs` | INT | Kolik agentů smí běžet současně |
| `max_runs_per_day` | INT | Denní limit dokončených/spuštěných běhů |
| `daily_token_budget` | INT | Maximální spotřeba API tokenů za den |
| `default_timeout_minutes` | INT | Timeout per běh |
| `max_commits_per_run` | INT | Pojistka proti zacyklení |
| `auto_merge_wait_minutes` | INT | Po jaké době od PR provést auto-merge |
| `updated_by` | UUID FK users | |
| `updated_at` | TIMESTAMPTZ | |

### 4.2 `agent_rules`

Pravidla, co agent smí / nesmí / vyžaduje schválení.

| Sloupec | Typ | Popis |
|---|---|---|
| `id` | UUID | PK |
| `kind` | ENUM | `forbidden`, `requires_approval`, `allowed` |
| `scope` | ENUM | `path_pattern`, `module`, `operation_type`, `db_table`, `repo` |
| `value` | TEXT | Glob, regex, název modulu, typ operace |
| `description` | TEXT | Pro lidi |
| `active` | BOOL | |
| `created_by` | UUID FK users | |
| `created_at` | TIMESTAMPTZ | |

**Předdefinované záznamy (seed):**

- `forbidden / path_pattern / **/migrations/**`
- `forbidden / path_pattern / **/.env*`
- `forbidden / path_pattern / **/secrets/**`
- `forbidden / operation_type / db_drop`
- `forbidden / operation_type / db_truncate`
- `forbidden / operation_type / git_force_push`
- `forbidden / operation_type / auth_change` (změny v autentizační logice)
- `requires_approval / operation_type / new_dependency`
- `requires_approval / operation_type / new_db_migration`
- `requires_approval / operation_type / new_api_endpoint`
- `requires_approval / path_pattern / **/payments/**`
- `requires_approval / path_pattern / **/permissions/**`

### 4.3 `agent_repos`

| Sloupec | Typ | Popis |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | Např. "SIS" |
| `git_url` | TEXT | SSH/HTTPS URL |
| `default_branch` | TEXT | Obvykle `main` |
| `protected_branches` | TEXT[] | `main`, `production` |
| `allow_auto_merge` | BOOL | |
| `required_checks` | TEXT[] | Které GitHub Actions musí projít |
| `tech_stack` | JSONB | `{"runtime":"node","tests":"vitest","lint":"eslint"}` |
| `active` | BOOL | |

### 4.4 `agent_runs`

Hlavní tabulka — jeden řádek = jeden běh agenta nad jedním úkolem.

| Sloupec | Typ | Popis |
|---|---|---|
| `id` | UUID | PK |
| `task_id` | UUID FK tasks | Z modulu Úkoly |
| `repo_id` | UUID FK agent_repos | |
| `status` | ENUM | `queued`, `triaging`, `awaiting_clarification`, `planning`, `awaiting_approval`, `coding`, `testing`, `pr_open`, `merged`, `completed`, `failed`, `cancelled`, `escalated` |
| `autonomy_mode` | ENUM | Snapshot v okamžiku spuštění |
| `started_at` | TIMESTAMPTZ | |
| `ended_at` | TIMESTAMPTZ | |
| `container_id` | TEXT | Docker container ID (pro debug) |
| `branch` | TEXT | `ai/REQ-123-fix-login` |
| `pr_url` | TEXT | |
| `pr_number` | INT | |
| `tokens_used` | INT | Spotřebované API tokeny |
| `commits_count` | INT | |
| `failure_reason` | TEXT | Pokud `failed` |
| `summary` | TEXT | Krátké shrnutí toho, co agent udělal (pro audit) |

### 4.5 `agent_run_events`

Detailní audit log — každý významný krok agenta.

| Sloupec | Typ | Popis |
|---|---|---|
| `id` | UUID | PK |
| `run_id` | UUID FK agent_runs | |
| `at` | TIMESTAMPTZ | |
| `kind` | ENUM | `tool_call`, `file_change`, `commit`, `question_to_user`, `rule_blocked`, `error`, `decision`, `llm_message` |
| `payload` | JSONB | Strukturovaná data k události |

### 4.6 `agent_approvals`

Schvalovací fronta (pro režimy `requires_approval` a override).

| Sloupec | Typ | Popis |
|---|---|---|
| `id` | UUID | PK |
| `run_id` | UUID FK agent_runs | |
| `kind` | ENUM | `plan_review`, `pr_review`, `rule_override` |
| `requested_at` | TIMESTAMPTZ | |
| `decided_at` | TIMESTAMPTZ | |
| `decided_by` | UUID FK users | |
| `decision` | ENUM | `pending`, `approved`, `rejected`, `expired` |
| `comment` | TEXT | |
| `payload` | JSONB | Co se schvaluje (plán, diff, override) |

### 4.7 Rozšíření existujících tabulek

**`tasks`** — přidat sloupce:

- `assignable_to_ai` BOOL — zadavatel/AI chat označí úkol jako vhodný pro AI Vývojáře
- `acceptance_criteria` TEXT — pole vyplněné AI chatem během doptávání
- `affected_module` TEXT — odkaz na modul HolyOSu (volitelně)
- `target_repo_id` UUID FK agent_repos NULL

**`users`** — žádná změna struktury, jen přidat servisní účet:

- email `ai-vyvojar@holyos.local`
- role `system_agent` (nová role)
- avatar (vlastní)

---

## 5. Workflow z pohledu uživatele a agenta

### 5.1 Vznik požadavku

1. Zaměstnanec (nebo AI jádro, nebo Tomáš) založí úkol v modulu Úkoly.
2. AI chat HolyOSu se zadavatele doptá na akceptační kritéria (viz kap. 6).
3. Pokud zadavatel označí úkol jako "AI Vývojář", úkol dostane `assignable_to_ai = true` a přiřadí se uživateli `ai-vyvojar`.

### 5.2 Triáž

4. Orchestrátor pollnuje (každých 30 s) tabulku `tasks` na úkoly přiřazené `ai-vyvojar` se statusem `new`.
5. Pro každý nový úkol vytvoří `agent_run` se statusem `triaging`.
6. Spustí Docker kontejner v triáž módu — agent (Claude Code) si přečte:
   - Akceptační kritéria
   - Strukturu repa (read-only)
   - Aktivní pravidla (`agent_rules`)
   - Případně související soubory dle popisu
7. Agent vrátí jeden ze tří verdiktů:
   - **OK** → status `planning`
   - **Potřebuju doplnění** → status `awaiting_clarification`, agent napíše konkrétní otázky do chatu úkolu, čeká na odpověď
   - **Stop** → status `escalated`, vytvoří se `agent_approval` typu `rule_override` nebo se to vrátí zadavateli s vysvětlením proč

### 5.3 Plán a realizace

8. V `planning` agent rozepíše plán: které soubory změní, jaké testy napíše, jaké závislosti přidá, jaký je odhad rizika.
9. Plán se zaloguje do `agent_run_events`. Pokud autonomy = `full_auto` a plán neporušuje pravidla, jde rovnou dál. Jinak `awaiting_approval`.
10. V `coding` agent napíše kód, spustí lintery a testy v sandboxu.
11. Pokud testy padají, agent má omezený počet pokusů na opravu (viz `max_commits_per_run`). Pak buď uspěje, nebo eskaluje.

### 5.4 PR a auto-merge

12. Agent pushne větev, otevře PR s popisem (co dělal, jak to testoval, link na úkol HolyOSu).
13. Status `pr_open`. PR čeká na required checks (CI).
14. Po `auto_merge_wait_minutes` (default např. 15 min) a splnění checks se PR auto-mergne.
15. Status `merged` → `completed`. Do chatu úkolu se napíše shrnutí + odkaz na merged PR. Zadavatel dostane notifikaci.

### 5.5 Komunikace v chatu úkolu

Agent píše do chatu pod jménem *Alan, AI Vývojář* tyto typy zpráv:

- **Přijetí** — "Beru si to, zkoumám zadání."
- **Otázka** — konkrétní dotaz na nejasnost.
- **Plán** — co plánuje udělat (jen pokud autonomy ≠ full_auto, jinak jen do auditu).
- **Hotovo** — link na PR + co konkrétně udělal.
- **Eskalace** — pokud něco nezvládá, popíše proč a otaguje Tomáše.

---

## 6. Akceptační kritéria — co AI chat HolyOSu musí vytáhnout od zadavatele

Než je úkol připravený pro AI Vývojáře, musí mít vyplněna tato pole. AI chat se ptá tak dlouho, dokud nemá odpovědi nebo dokud zadavatel neřekne "nevím, ať rozhodne agent / Tomáš".

**Povinná pole:**

1. **Cíl jednou větou** — "Co se má stát?"
2. **Definice hotovo** — "Jak poznáme, že je to hotové?" Konkrétní ověřitelný popis. Pokud zadavatel neumí odpovědět, požadavek není zralý.
3. **Modul / oblast** — který z 12 modulů HolyOSu se mění (nebo "infrastruktura", "globální").
4. **Typ změny** — `bug_fix`, `new_feature`, `refactor`, `ui_change`, `integration`, `documentation`, `data_migration`.

**Doporučená pole (AI chat se ptá, ale nepřerušuje, pokud zadavatel neví):**

5. **Kontext** — navazuje to na něco existujícího? Existuje vzor (jiný modul, který se chová podobně)?
6. **Omezení** — termín, design, kompatibilita.
7. **Dotčená data** — sahá to na DB? Na kterou tabulku? Čte/zapisuje? Citlivá data (zákazníci, faktury, mzdy)?
8. **Testovatelnost** — jak se to ověří? Existují testovací data?
9. **Priorita a dopad** — kdo to potřebuje, kolik lidí ovlivní.

**Heuristika pro AI chat:** pokud po rozhovoru nedokáže shrnout úkol do tvaru *"Když uživatel udělá X, systém má udělat Y, a poznáme to podle Z"*, úkol není připravený. AI chat to označí a dá zadavateli jednu z možností: doplnit, nechat to na AI Vývojáři (s rizikem doptání) nebo přiřadit člověku.

---

## 7. Bezpečnost a pravidla

### 7.1 Tři vrstvy pravidel

**Tvrdé zákazy (forbidden) — agent nesmí nikdy:**

- Mazat nebo měnit existující migrace
- Sahat na soubory se secrets (`.env`, `secrets/`, `*.key`, `*.pem`)
- Měnit autentizační a autorizační logiku
- Měnit platební flow
- Force push, mazat git historii, mazat větve `main`/`production`
- Spouštět DROP, TRUNCATE, DELETE bez WHERE na DB
- Přímý zápis do produkční DB (vždy jen přes verzované migrace v dev)
- Push přímo do chráněných větví bez PR

**Vyžaduje schválení (requires_approval):**

- Nové DB migrace (i v dev)
- Nové API endpointy
- Změny v sdílených komponentech, které používá víc modulů
- Změny v CI/CD
- Cokoli s finančním dopadem (faktury, ceny, slevy)
- Úprava uživatelských rolí a oprávnění
- Přidání nové externí závislosti (npm/pip package)

**Volné pole (allowed) — agent může sám:**

- UI úpravy v rámci jednoho modulu
- Přidání reportů a exportů (čtení)
- Přidání testů
- Dokumentace
- Refaktoring v jednom souboru
- Oprava bugů, kde už existuje failing test
- Úprava jen v rámci jedné komponenty bez sdílených dopadů

### 7.2 Databázové bezpečnostní zásady

- Agent má **read-only přístup k produkční DB** (jen pro analýzu schématu, nikdy pro zápis).
- Veškeré změny schématu jdou výhradně přes **verzované migrace v gitu**.
- Každá migrace **musí mít `down`** (reverzibilita).
- Před každou migrací se v dev/staging dělá automatický **snapshot** (pojistka pro rychlý rollback).
- Agent nikdy nepouští ad-hoc SQL na produkci.

### 7.3 Auto-merge podmínky

PR se auto-mergne jen pokud platí všechny:

- Všechny `required_checks` v `agent_repos` prošly (CI, testy, lint).
- Žádný reviewer neoznačil PR jako "Request changes".
- Uplynulo `auto_merge_wait_minutes` od otevření PR.
- Změna se nedotýká cest se štítkem `requires_approval`.

Pokud cokoli z toho selže → status zůstane `pr_open` a Tomáš dostane notifikaci k ručnímu rozhodnutí.

### 7.4 Limity (editovatelné v super admin)

- `max_concurrent_runs` (start: 1, doporučeno 1–3)
- `max_runs_per_day` (start: 5)
- `max_commits_per_run` (default: 10) — pojistka proti zacyklení
- `default_timeout_minutes` (default: 30)
- `daily_token_budget` (default: nastavit dle finančního limitu)

### 7.5 Kill switch

- Velké červené tlačítko v super admin sekci.
- Při stisku: `agent_settings.enabled = false` → orchestrátor dokončí běžící, ale nespouští nové.
- Druhé tlačítko *"Stop now"*: kromě výše také zabije běžící Docker kontejnery.
- Vždy auditováno (kdo, kdy, proč).

---

## 8. UI specifikace — sekce "AI Vývojář" v super admin

### 8.1 Dashboard

- Aktuálně běžící agenti (live update přes WebSocket nebo poll)
- Fronta čekajících úkolů
- Posledních 20 dokončených/selhaných běhů s odkazem na detail
- Spotřeba tokenů dnes / tento měsíc (vč. peněžního ekvivalentu)
- Velký kill switch

### 8.2 Pravidla

- Tři tabulky (forbidden / requires_approval / allowed)
- Možnost přidat, editovat, deaktivovat pravidlo
- Filtr podle scope
- U každého pravidla počet, kolikrát zablokovalo / vyžádalo schválení (statistika)

### 8.3 Limity

- Formulář s editovatelnými hodnotami z `agent_settings`
- Při uložení audit log

### 8.4 Repozitáře

- Seznam aktivních rep
- Pro každé: název, git URL, nastavení auto-merge, požadované checks, technologický stack
- Tlačítko "Test connection" — ověří, že agent má přístup

### 8.5 Schvalovací fronta

- Seznam `agent_approvals` se statusem `pending`
- Pro každý: typ (plán/PR/override), úkol, navrhovaná akce, čas vytvoření
- Tlačítka Schválit / Zamítnout / Komentovat
- Možnost otevřít plán nebo diff přímo zde

### 8.6 Audit log

- Filtrovatelný seznam `agent_runs`
- Detail běhu: kompletní `agent_run_events` chronologicky, transcript LLM zpráv, změněné soubory, link na PR, spotřeba tokenů
- Export do CSV

### 8.7 Kill switch

- V hlavičce sekce, vždy viditelný
- Stav (zelená/červená)
- Po stisku potvrzovací dialog s polem "Důvod"

---

## 9. API endpointy modulu

Interní REST API HolyOSu, autentizace přes existující JWT.

### Pro orchestrátor (servisní účet AI Vývojáře)

- `GET /api/agent/queue` — vrátí úkoly čekající na zpracování
- `POST /api/agent/runs` — vytvoří `agent_run`
- `PATCH /api/agent/runs/:id` — update statusu, polí
- `POST /api/agent/runs/:id/events` — append do audit logu
- `POST /api/agent/runs/:id/chat` — pošle zprávu do chat threadu úkolu
- `GET /api/agent/rules` — aktivní pravidla
- `GET /api/agent/repos/:id` — detail repa
- `POST /api/agent/approvals` — vyžádá schválení
- `GET /api/agent/approvals/:id` — stav

### Pro UI super adminu

- `GET /api/agent/dashboard` — agregovaná data
- `GET/PUT /api/agent/settings`
- CRUD `/api/agent/rules`
- CRUD `/api/agent/repos`
- `GET /api/agent/runs?filter=...`
- `GET /api/agent/runs/:id` (s eventy)
- `POST /api/agent/approvals/:id/decide` — schválit/zamítnout
- `POST /api/agent/kill-switch` — zapnout/vypnout

---

## 10. Orchestrátor — kostra (TypeScript)

```ts
// orchestrator/src/index.ts (zjednodušená kostra)
import { HolyOSClient } from './holyos-client'
import { DockerSandbox } from './sandbox'
import { ClaudeCodeAgent } from './agent'

const POLL_INTERVAL_MS = 30_000

async function main() {
  const holy = new HolyOSClient(process.env.HOLYOS_API_URL!, process.env.AGENT_TOKEN!)

  while (true) {
    const settings = await holy.getSettings()
    if (!settings.enabled) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    const running = await holy.countRunningRuns()
    if (running >= settings.max_concurrent_runs) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    const tasks = await holy.fetchQueue()
    for (const task of tasks) {
      // pojistka na denní limit
      if (await holy.todayRunsCount() >= settings.max_runs_per_day) break

      processTask(task, holy).catch(err => {
        console.error('Run failed', err)
      })
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

async function processTask(task, holy) {
  const run = await holy.createRun({ task_id: task.id, status: 'triaging' })
  const sandbox = new DockerSandbox(run.id)
  const agent = new ClaudeCodeAgent(sandbox, holy, run)

  try {
    await sandbox.start()

    const triage = await agent.triage(task)
    if (triage.verdict === 'needs_clarification') {
      await holy.postChatMessage(task.id, triage.questions)
      await holy.updateRun(run.id, { status: 'awaiting_clarification' })
      return
    }
    if (triage.verdict === 'stop') {
      await holy.escalate(run.id, triage.reason)
      return
    }

    await holy.updateRun(run.id, { status: 'planning' })
    const plan = await agent.makePlan(task)

    const planCheck = await checkRules(plan, holy)
    if (planCheck.requiresApproval && run.autonomy_mode !== 'full_auto') {
      await holy.requestApproval(run.id, 'plan_review', plan)
      await holy.updateRun(run.id, { status: 'awaiting_approval' })
      return
    }

    await holy.updateRun(run.id, { status: 'coding' })
    await agent.implement(plan)

    await holy.updateRun(run.id, { status: 'testing' })
    const testResult = await agent.runTests()

    if (!testResult.ok) {
      // omezené pokusy o opravu
      await agent.repairAndRetry(testResult, run.commits_count)
    }

    const pr = await agent.openPR(task)
    await holy.updateRun(run.id, { status: 'pr_open', pr_url: pr.url, pr_number: pr.number })
    await holy.postChatMessage(task.id, `Hotovo, otevřel jsem PR: ${pr.url}`)
  } catch (err) {
    await holy.updateRun(run.id, { status: 'failed', failure_reason: err.message })
    await holy.postChatMessage(task.id, `Narazil jsem na problém: ${err.message}`)
  } finally {
    await sandbox.cleanup()
  }
}
```

Auto-merge řeší **GitHub Actions** workflow v každém repu — kontroluje labels, testy, čekací dobu a mergne PR. Orchestrátor o auto-merge neví, jen zachytí webhook nebo poll PR status a aktualizuje `agent_runs.status` na `merged`.

---

## 11. Docker sandbox

### 11.1 Base image (Dockerfile)

```dockerfile
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    git curl python3 python3-pip jq \
    && rm -rf /var/lib/apt/lists/*

# Claude Code SDK
RUN npm install -g @anthropic-ai/claude-code

# Lintery a testovací nástroje pro stack HolyOSu
RUN npm install -g eslint prettier vitest

WORKDIR /workspace
USER 1000:1000
```

### 11.2 Spuštění per požadavek

```bash
docker run --rm \
  --name agent-run-${RUN_ID} \
  --network=agent-net \
  --memory=2g --cpus=2 \
  -e ANTHROPIC_API_KEY=${KEY} \
  -e GITHUB_TOKEN=${GH_TOKEN} \
  -e RUN_ID=${RUN_ID} \
  -e HOLYOS_API_URL=${URL} \
  -v /tmp/agent-${RUN_ID}:/workspace \
  holyos-agent:latest \
  /usr/local/bin/run-agent.sh
```

### 11.3 Síťová izolace

- Vlastní Docker network `agent-net` s povolenými cíli: GitHub, npm/pip registry, Anthropic API, HolyOS API.
- Žádný přímý přístup k produkční DB ani ostatním službám.

---

## 12. Postup stavby (fáze)

### Fáze 1 — MVP (1–2 týdny)

- Nový HolyOS user `ai-vyvojar` + role
- Tabulky `agent_runs`, `agent_run_events`, `agent_settings` (minimum)
- Orchestrátor v TS, polluje úkoly přiřazené `ai-vyvojar`
- Sandbox jen jako lokální adresář (zatím bez Dockeru)
- Vždy otevírá PR, žádný auto-merge
- Super admin sekce: Dashboard (jen seznam běhů) + Kill switch
- Cíl: end-to-end na 1–2 reálných úkolech v repu SIS

### Fáze 2 — Bezpečnost a izolace (1–2 týdny)

- Docker sandbox
- Tabulky `agent_rules`, `agent_repos`, `agent_approvals` + UI
- Tvrdé zákazy a `requires_approval` aktivní
- Schvalovací fronta v UI
- Auto-merge přes GitHub Actions
- Audit log v UI s eventy

### Fáze 3 — Plná autonomie a integrace (1–2 týdny)

- AI chat HolyOSu doptává akceptační kritéria
- Mix-autonomy podle typu úkolu
- Komunikace agenta v chatu úkolu jako kolega
- Notifikace přes existující systém
- Metriky úspěšnosti (kolik PR mergnuto bez zásahu, kolik vráceno)

### Fáze 4 — Inteligence (postupně)

- AI jádro samo zakládá úkoly pro AI Vývojáře (např. "v reportingu chybí X")
- Agent vidí historii podobných úkolů a poučí se z minulých vrácení
- Paralelizace (víc běhů zároveň)
- Doporučení: které úkoly jsou pro AI vhodné

---

## 13. Otevřené otázky / co doladit při implementaci

- **Token budget vs. realita** — po prvních 10 bězích přepočítat reálnou spotřebu a nastavit `daily_token_budget`.
- **Stack HolyOSu** — pokud finální stack není Node, upravit testovací nástroje v base image a `tech_stack` v `agent_repos`.
- **GitHub vs. self-hosted git** — brief počítá s GitHubem; pro self-hosted Gitea nebo GitLab se upraví git workflow vrstva.
- **Notifikace** — formát zprávy od AI Vývojáře v chatu (tonalita, šablony) — doladit v praxi.
- **Onboarding nového repa** — checklist, co musí být v repu nastavené, aby ho AI Vývojář mohl obsluhovat (CI, eslint config, README s instrukcemi).
- **Fallback při výpadku Anthropic API** — agent zaloguje, vrátí úkol do fronty, počká.

---

*Projekt: HolyOS / Modul AI Vývojář | Verze briefu: 1.0 | Pro Claude Cowork*
