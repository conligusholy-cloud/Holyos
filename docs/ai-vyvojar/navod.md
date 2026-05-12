# AI Vývojář & Kolega — Návod k použití

> Modul `ai-vyvojar` (#13) + AI asistent **Kolega/Alan**. End-to-end průvodce pro Tomáše a HolyOS team. Stav: Fáze 1–4 hotové (2026-05-12). Docker sandbox záměrně odložen.

---

## 1. Co to vlastně je

**AI Vývojář** je autonomní agent, který:

1. Vezme úkol z modulu **Úkoly pro adminy** (`/modules/admin-tasks/`)
2. Naklonuje cílový repozitář (HolyOS, holyos-ai-playground, …)
3. Naplánuje, naprogramuje a otestuje změnu (Claude Sonnet 4-6 + tool-use loop)
4. Vytvoří na GitHubu Pull Request s diffem
5. Podle nastavené autonomie buď čeká na schválení, nebo PR rovnou mergne

**Kolega / Alan** je AI asistent, kterého potkáš na třech místech:

- **Pravý panel kdekoli v HolyOSu** (zvonek/chat ikona) — obecný chat nad celou aplikací
- **Diskuze u úkolu** — když Alan dělá triage / coding a něco potřebuje, píše ti přímo do task chatu
- **Vytváření nového úkolu** — Kolega ti pomůže formulovat zadání tak, aby agent věděl, co po něm chceš

Cíl Kolegy: **nepoužívat IT žargon**. Mluví se skladnicí, mistrem, HR-istkou, účetní. Ptá se na *co* chceš a *jak poznáš, že je to hotové* — ne na "komponenty", "endpointy" ani "DB tabulky".

---

## 2. Architektura na jeden pohled

```
┌──────────────────────────────────────────────────────────┐
│  UI:  /modules/admin-tasks/   (zadávání)                 │
│       /modules/ai-vyvojar/    (6 záložek, monitoring)    │
│       Sidebar AI panel        (Kolega, free chat)        │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  Routes:                                                 │
│   /api/admin-tasks/*    (CRUD úkolů + AC chat)           │
│   /api/agent/*          (runy, schválení, repos, rules)  │
│   /api/messages/*       (task chat — hook na AC update)  │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  services/ai-developer/                                  │
│   ├── worker.js        — poll loop (30s)                 │
│   ├── runner.js        — orchestrace 1 runu              │
│   ├── triage.js        — Haiku preflight                 │
│   ├── ac-chat.js       — Kolega u úkolu / draftu         │
│   ├── suitability.js   — 0–100 skóre                     │
│   ├── seeder.js        — návrhy nových úkolů             │
│   ├── planner.js       — Sonnet plán + souhlas Tomáše    │
│   ├── agent.js         — Sonnet coding loop (tool-use)   │
│   ├── repository.js    — Prisma vrstva                   │
│   └── autonomy.js      — resolver mix-autonomy           │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  GitHub (isomorphic-git pro klon, REST pro PR/merge)     │
└──────────────────────────────────────────────────────────┘
```

Worker běží v procesu Node serveru, ne jako samostatný service — startuje s `app.js` a polluje DB každých 30 vteřin.

---

## 3. Životní cyklus úkolu (happy path)

```
NEW ──► (PUT /api/admin-tasks/:id  s ai_assign=true)
     │
     ▼
QUEUED   suitability_score se přepočítá automaticky
     │
     ▼
TRIAGE   Haiku rozhodne: ok / needs_clarification / stop
     │       │                    │
     │       │                    └─► STOPPED  (forbidden, špatný repo)
     │       │
     │       └─► AWAITING_CLARIFICATION
     │              (Alan napíše do task chatu otázky;
     │               odpověď uživatele se připíše do AC
     │               a run se cancelne → vznikne nový run)
     ▼
PLANNING   Sonnet sepíše krok-za-krokem plán
     │
     │   ── (mix-autonomy)
     │       full_auto ───┐
     │       pr_review ───┤
     │       plan_review ─┴► AWAITING_PLAN_APPROVAL (Tomáš v UI)
     ▼
CODING     Sonnet tool-use: list_files / read_file / write_file / run_shell
     │
     ▼
PR_OPEN    Pull Request na GitHubu, link v UI a v task chatu
     │
     │   ── (mix-autonomy)
     │       full_auto ──► auto-merge worker checkne CI ──► MERGED
     │       pr_review ──► AWAITING_PR_APPROVAL (Tomáš klikne)
     ▼
DONE
```

Stavy najdeš v UI (`/modules/ai-vyvojar/`) v záložce **Běhy** s barevnými badgi.

---

## 4. Jak zadat úkol agentovi

### A. Z modulu Úkoly pro adminy

1. **Nový úkol** → vyplň titulek a popis česky, normálně, bez IT.
2. Otevři rozšířené pole **Akceptační kritéria (AC)** — popiš co konkrétně musí platit, aby byl úkol hotový. Krátké odrážky stačí.
3. Při ukládání systém spočítá **suitability score** (badge 0–100). Nad 60 dává smysl pustit, pod 40 znamená "tady chybí kontext".
4. Klikni **Přidělit AI** — vybereš `target_repo`, `change_type` (bugfix/feature/refactor/…) a případně `autonomy_override` (defaultní je `pr_review`).

### B. Když si nevíš rady — Kolega ti pomůže

Nahoře na detailu úkolu je tlačítko **Probrat s Kolegou (AC chat)**. Otevře se modál a Alan postupně zjišťuje:

- *Co* chceš udělat jinak
- *Jak* poznáš, že je to hotové (1 konkrétní scénář)
- *Kde* v HolyOSu to je (název stránky, ne adresářová cesta)
- *Proč* to potřebuješ, kdo to bude používat

Alan **nikdy** neřeší soubor/kód/CSS/DB — to si zjistí planner sám. Když ti nabídne **„Uložit AC a předat agentovi“**, kliknout můžeš = úkol jde do fronty.

### C. Mix-autonomy (důležité)

Globální default pro agent je `pr_review`. Per-úkol můžeš přebít v `autonomy_override`:

| Hodnota       | Plán schvaluje | PR mergne                          |
|---------------|----------------|------------------------------------|
| `full_auto`   | nikdo (auto)   | worker po zelené CI (auto-merge)   |
| `pr_review`   | nikdo (auto)   | Tomáš ručně v UI                   |
| `plan_review` | Tomáš v UI     | Tomáš ručně v UI                   |

Pro destruktivní/nejasné věci dávej **plan_review**, pro typické malé bugy stačí **pr_review**, pro repetitivní bezpečné úpravy (seedy, dokumentace, lokalizace…) jde i **full_auto**.

---

## 5. Pravidla psaní AC (co opravdu funguje)

Z 39 retry pokusů na úkolu #42 a stuck #44 jsme se naučili:

1. **1 cíl = 1 úkol.** Nepiš „opravit X a zároveň udělat Y a uklidit Z“.
2. **Konkrétní scénář, ne abstrakce.** Místo "validace formuláře" napiš "když nechám prázdné IČO a kliknu Uložit, pod políčkem se objeví červený text 'IČO je povinné'".
3. **Kde to je.** Název modulu/stránky podle sidebaru, ne path. "Vozový park → detail vozidla → záložka STK".
4. **Co se NEMÁ změnit.** Pokud něco nesmí spadnout pod ruku, řekni to ("nemažeme historii, jen schováme tlačítko").
5. **Screenshot s šipkou** je zlatý standard pro UI změny.

Pokud má AC pod 20 znaků, triage to automaticky vrátí jako `needs_clarification` a Alan se zeptá.

---

## 6. Konfigurace agenta

### `agent_repos` — co může agent klonovat

V UI `/modules/ai-vyvojar/` → záložka **Repozitáře**:

- `name`, `git_url`, `default_branch`, `tech_stack` (JSON)
- `pat_scope` — GitHub PAT s `repo` scopem (uložený šifrovaně)
- HolyOS samotný (`holyos-app`) i sandbox (`holyos-ai-playground`) jsou aktivní

Když přidáváš nový repo, nezapomeň, že **PAT musí mít přístup ke konkrétnímu repu** (klasické GitHub Fine-grained PAT s vybraným repem + Contents/Pull requests = write).

### `agent_rules` — co agent NESMÍ (Fáze 4)

Tabulka `AgentRule` (UI → záložka **Pravidla**) nahradila hardcoded forbidden patterny. Defaultní seed obsahuje:

- `**/.env*`, `prisma/migrations/**`, `**/*.key`, `**/*.pem` — nikdy needit
- `DROP TABLE`, `TRUNCATE`, `DELETE FROM ... WITHOUT WHERE`, `--force` push — nikdy nespouštět
- `services/ai-developer/**` — agent se sám sebe upravovat nesmí (chrání před boot-strap loop)

Pravidla se vyhodnocují **ve dvou bodech**:

1. **Triage** — pokud AC explicitně žádá zakázanou věc → verdict `stop`
2. **Coding loop** — `buildForbiddenChecker(rules)` validuje každý `write_file`/`run_shell`, blokuje na úrovni tool execution

Pravidla můžeš přidávat/vypínat z UI bez deploye.

---

## 7. Co dělá Kolega v sidebaru (pravý panel)

To je **obecný chat** nad celou aplikací — postavený na stejném Sonnet endpointu, ale s odlišnou systémovou promptou. Umí:

- Vysvětlit co je v jakém modulu
- Najít zaměstnance/materiál/objednávku přes MCP nástroje (`hr-server`, `warehouse-server`, …)
- Pomoct s plánováním výroby, kontrolou zásob, atd.

**Není** to ten samý kontext jako agent v úkolu. Když chceš agenta na konkrétní úkol, jdi do modulu Úkoly pro adminy a otevři AC chat tam — agent tam má historii úkolu, repo metadata a vidí předchozí pokusy.

---

## 8. Co se děje, když Alan napíše do task chatu

Triage někdy skončí jako `needs_clarification` a do task chatu napíše 1–3 otázky. Pak:

1. Run zůstane ve stavu `awaiting_clarification`
2. Ty (nebo kolega/skladnice) odpovíš normálně v task chatu (přes `/api/messages/...`)
3. **Hook v `routes/messages.routes.js`** automaticky:
   - Připíše tvou zprávu do `acceptance_criteria` jako `--- Odpověď od X (čas) ---\n...`
   - Cancellne aktuální čekající run (`status='cancelled'`, reason='AC doplněno přes task chat')
4. Worker ho při dalším pollu vyzvedne, spustí znovu triage s novým AC

Tj. **odpovídáš normálně lidsky, agent si přepíše AC sám**. Nemusíš nic kopírovat ručně.

---

## 9. UI modulu `/modules/ai-vyvojar/`

Šest záložek:

1. **Dashboard** — kolik runů běží, kolik tokenů dnes, success rate
2. **Běhy** — chronologický seznam s filtrem podle stavu, klikni pro detail (events, plán, diff, PR link)
3. **Fronta** — co worker uvidí v dalším pollu (queue + awaiting_clarification)
4. **Repozitáře** — CRUD `agent_repos`
5. **Pravidla** — CRUD `agent_rules`
6. **Návrhy (seeder)** — Sonnet sám občas navrhne úkoly z historie (opakující se bugy, technický dluh)

Schválení (plán i PR) řešíš přes záložku **Běhy** → detail → tlačítko **Schválit / Zamítnout** (zamítnutí má povinný komentář, Tomášův text se ukládá do `AgentApproval.comment` a používá se jako zpětná vazba pro budoucí runy podobných úkolů).

---

## 10. Suitability score

Každý úkol dostane skóre 0–100 (Haiku call, ~700 tokenů). Spouští se:

- při PUT `/api/admin-tasks/:id` (pokud se změnilo AC)
- na požádání `POST /api/admin-tasks/:id/evaluate-suitability`
- batch backfill `POST /api/admin-tasks/backfill-suitability`

Barva badge v UI:
- 🟢 80–100 — agent to zvládne
- 🟡 50–79 — pusť, ale buď připraven schvalovat
- 🟠 30–49 — Alan se nejspíš zeptá, doplň AC
- 🔴 0–29 — nezadávej, přeformuluj

Skóre **není** blokační — můžeš pustit i 20/100, jen víš dopředu, že to bude bolet.

---

## 11. Past failures jako kontext

Když se úkol dostane do triage / planneru, repository vrstva (`getPastFailures`) přiloží do promptu posledních 3 podobných selhání + zamítnuté plány pro tento modul. Cíl: aby agent nešlapal do stejných šlápot dvakrát. Vidíš to v `run.payload.past_failures_used` v event logu.

---

## 12. Troubleshooting (z reálných incidentů)

| Symptom                                       | Co to znamená                              | Co s tím                                            |
|-----------------------------------------------|--------------------------------------------|-----------------------------------------------------|
| `429 rate_limit_error` od Anthropic           | Tier 1 limit (30k input tokens/min)        | Počkat 1 min, zvážit upgrade tieru nebo backoff     |
| Run zaseknutý 1+ hod ve stavu `coding`        | Sonnet bruteforce prochází moduly          | Cancel přes UI, doplnit AC, spustit znovu           |
| `awaiting_clarification` neodbavený           | Hook v messages.routes.js nezareagoval     | Zkontroluj, že odpovídáš v *task* chatu, ne v sidebaru |
| Agent commitne ale PR se neotevře             | PAT scope nestačí (chybí Pull requests)    | Reissue PAT s Contents+PR write                     |
| Triage stop "špatný target_repo"              | Úkol cílí na repo, kde modul není          | Vyber správný `target_repo_id` (UI ho teď umí měnit) |
| `P3008` při migrate resolve                   | Migrace už je v `_prisma_migrations`       | Benigní, apply skript to toleruje                   |
| Worker nestartuje                             | Chybí ANTHROPIC_API_KEY / GITHUB_PAT       | `echo $env:` (PowerShell env shadowne .env)         |

Logy běhu: záložka **Běhy** → detail → **Events** (každý tool call, každé rozhodnutí, použité tokeny).

---

## 13. Co bych dělal jinak příště (lessons learned)

- **Triage ušetří víc, než stojí.** Incident #42 by stál 650 tokenů místo 395 090, kdyby triage byl od začátku.
- **Mix-autonomy je výhra.** Defaultně `pr_review`, eskalace na `plan_review` jen pro citlivé věci. `full_auto` jen pro známé bezpečné šablony.
- **Lidský AC chat (Alan) > formulářové pole.** Skladnice nenapíše dobré AC sama, ale na Alanovy otázky odpoví ráda.
- **Past failures jako kontext snižuje opakovaná selhání.** Nech to zapnuté.
- **Sandbox/Windows mount nemá rád velké Write/Edit.** Pro >10 kB jdi přes `Read HEAD: + Python POSIX write` (viz memory `holyos_python_write_windows_mount_truncate`).

---

## 14. Co je ještě odložené (vědomě)

- **Docker sandbox** pro `run_shell` — agent dnes spouští shell na hostu Railway containeru s forbidden checkerem. Plný izolovaný Docker zatím nepotřeba, ale je v brief-v2 jako Fáze 5.
- **Self-update agenta** — pravidlo `services/ai-developer/**` zakázáno; pokud chceme nechat agenta upravovat sám sebe, potřebujeme separátní review queue.
- **Multi-PR řetězce** — zatím 1 úkol = 1 PR. Stacked PRs nejsou potřeba.

---

## 15. Klíčové soubory (rychlá orientace)

```
services/ai-developer/
  worker.js         pollOnce + pollAutoMerge + pollApprovals (30 s interval)
  runner.js         triage → plan → code → PR (resume support)
  triage.js         Haiku preflight, mluví česky k laikům
  ac-chat.js        chat() per-task + chatDraft() při vytváření úkolu
  planner.js        Sonnet tool-use, výstup = JSON plán
  agent.js          Sonnet coding loop, buildForbiddenChecker(rules)
  suitability.js    evaluate() 0–100
  seeder.js         propose() návrhy úkolů z historie
  autonomy.js       resolveAutonomy(task, repo, global)
  repository.js     Prisma vrstva (getPastFailures, listApprovalsToProcess, …)

routes/
  agent.routes.js          /api/agent/* (runs, approvals, repos, rules, seeder)
  admin-tasks.routes.js    /api/admin-tasks/* (PUT auto-eval, /ac-chat, /draft-chat)
  messages.routes.js       hook: odpověď v task chatu → AC append + run cancel

modules/
  ai-vyvojar/        6 záložek
  admin-tasks/       karty úkolů s AI tlačítky a suitability badgi

prisma/schema.prisma
  AdminTask + change_type/autonomy_override/ai_suitability_*
  AgentRepo, AgentRun, AgentRunEvent, AgentApproval, AgentRule
```

---

## 16. Quick start pro nového člověka

1. Otevři `https://app.holyos.cz/modules/admin-tasks/`
2. Nový úkol → titulek + popis česky, vyplň AC (klidně přes **Probrat s Kolegou**)
3. **Přidělit AI** → zvol `holyos-ai-playground` (pro experiment) nebo `holyos-app` (pro ostrou změnu)
4. Otevři `/modules/ai-vyvojar/` → záložka **Běhy** a sleduj postup
5. Když Alan napíše do task chatu otázku, **odpověz tam** (nemusíš nic dál mačkat — hook se postará)
6. Až bude `awaiting_pr_approval`, klikni si v UI **Schválit** nebo otevři PR na GitHubu

Hotovo. Tomáš si pak může v klidu vařit kafe, zatímco kolega-AI dělá pull requesty.

---

*Stav dokumentu: 2026-05-12. Doplňuj podle reálných incidentů — to je nejcennější zpětná vazba.*
