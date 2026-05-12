# -*- coding: utf-8 -*-
"""
Apply AI Vývojář bugfix patches (3 commits worth).
Sandbox Edit tool nepersistlo změny — tenhle skript je dělá deterministicky.

Spusť z root projektu:
    python scripts/apply-ai-vyvojar-fixes.py

Idempotentní — pokud už je patch aplikovaný, soubor přeskočí.
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def patch_file(rel_path, replacements):
    """replacements = list of (old, new) tuples. Each must match exactly once."""
    path = os.path.join(ROOT, rel_path)
    print(f"--- {rel_path}")
    with open(path, "r", encoding="utf-8", newline="") as f:
        content = f.read()
    original = content
    for old, new in replacements:
        if new in content and old not in content:
            print(f"  SKIP (už aplikováno)")
            return
        count = content.count(old)
        if count == 0:
            print(f"  ERROR: nelze najít blok ({old[:60]!r}...)")
            sys.exit(1)
        if count > 1:
            print(f"  ERROR: blok není unikátní ({count}× výskyt)")
            sys.exit(1)
        content = content.replace(old, new, 1)
    if content == original:
        print(f"  no-op (žádná změna)")
        return
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    print(f"  OK ({len(content) - len(original):+d} bytes)")


# ============================================================================
# COMMIT 1 — services/ai-developer/agent.js
# - MAX_TOKENS_PER_TURN 4096 -> 16384 (env override)
# - MAX_TURNS env override
# - handle stop_reason='max_tokens' (recovery nudge)
# - handle stop_reason='end_turn' bez tool_use (finish() nudge, 1× retry)
# ============================================================================
patch_file(
    "services/ai-developer/agent.js",
    [
        (
            "const MODEL = process.env.AI_DEV_MODEL || 'claude-sonnet-4-6';\n"
            "const MAX_TURNS = 25;\n"
            "const MAX_TOKENS_PER_TURN = 4096;\n"
            "const MAX_READ_BYTES = 200_000;",
            "const MODEL = process.env.AI_DEV_MODEL || 'claude-sonnet-4-6';\n"
            "const MAX_TURNS = parseInt(process.env.AI_DEV_MAX_TURNS || '25', 10);\n"
            "// 16 384 — výrazně více než 4 096, ať write_file velkého souboru (např. routes/*.js\n"
            "// ~30–50 kB) projde v jednom turnu bez useknutí. Důvod: stop_reason='max_tokens'\n"
            "// uřízne tool_use blok mid-content, agent.js to pak nesprávně interpretoval jako\n"
            "// \"skončil bez finish()\" a celý běh zhavaroval (#49, 12.5.2026: 288k tokens, 0 commitů).\n"
            "const MAX_TOKENS_PER_TURN = parseInt(process.env.AI_DEV_MAX_TOKENS_PER_TURN || '16384', 10);\n"
            "const MAX_READ_BYTES = 200_000;",
        ),
        (
            "  let totalInputTokens = 0;\n"
            "  let totalOutputTokens = 0;\n"
            "  let summary = null;\n"
            "  const fileChanges = new Set();\n"
            "\n"
            "  for (let turn = 0; turn < MAX_TURNS; turn++) {",
            "  let totalInputTokens = 0;\n"
            "  let totalOutputTokens = 0;\n"
            "  let summary = null;\n"
            "  let _finishNudgeSent = false;\n"
            "  const fileChanges = new Set();\n"
            "\n"
            "  for (let turn = 0; turn < MAX_TURNS; turn++) {",
        ),
        (
            "    // Přidej assistant turn do messages\n"
            "    messages.push({ role: 'assistant', content: response.content });\n"
            "\n"
            "    if (response.stop_reason !== 'tool_use') {\n"
            "      // Claude se rozhodl skončit bez volání finish — bereme jako neúspěch\n"
            "      summary = summary || 'Agent skončil bez volání finish().';\n"
            "      break;\n"
            "    }",
            "    // Přidej assistant turn do messages\n"
            "    messages.push({ role: 'assistant', content: response.content });\n"
            "\n"
            "    // stop_reason='max_tokens' znamená, že odpověď byla useknutá kvůli limitu —\n"
            "    // tool_use blok je neúplný (např. write_file s mid-content cutoff). Nesmí\n"
            "    // se to brát jako \"vzdal to\"; pošli nudge user-message a dej Sonnetu šanci\n"
            "    // pokračovat.\n"
            "    if (response.stop_reason === 'max_tokens') {\n"
            "      messages.push({\n"
            "        role: 'user',\n"
            "        content:\n"
            "          'Tvoje předchozí odpověď byla useknutá kvůli limitu max_tokens (' +\n"
            "          MAX_TOKENS_PER_TURN +\n"
            "          '). Tool_use bloky v ní nebyly dokončeny a nemohly se provést. ' +\n"
            "          'Pokračuj — pokud potřebuješ napsat velký soubor, rozděl write_file ' +\n"
            "          'na menší úseky (po sekcích) nebo nahraď jen klíčové změny místo ' +\n"
            "          'celého obsahu. Až budeš mít všechny změny hotové, zavolej finish().',\n"
            "      });\n"
            "      if (onEvent) {\n"
            "        await onEvent('decision', {\n"
            "          action: 'max_tokens_recovery',\n"
            "          turn,\n"
            "          note: 'Předchozí turn useknut, posílám nudge.',\n"
            "        });\n"
            "      }\n"
            "      continue;\n"
            "    }\n"
            "\n"
            "    if (response.stop_reason !== 'tool_use') {\n"
            "      // Sonnet vrátil text bez tool_use (end_turn / stop_sequence) — buď je\n"
            "      // přesvědčen, že je hotov ale zapomněl finish(), nebo si není jistý.\n"
            "      // Pošli jednorázový nudge; pokud i další turn skončí bez tool_use,\n"
            "      // bereme to jako neúspěch.\n"
            "      if (!_finishNudgeSent) {\n"
            "        _finishNudgeSent = true;\n"
            "        messages.push({\n"
            "          role: 'user',\n"
            "          content:\n"
            "            'Skončil jsi turn bez volání žádného nástroje. Pokud jsi hotov, ' +\n"
            "            'zavolej finish() s česky napsaným shrnutím změn (4–6 vět) pro PR ' +\n"
            "            'description. Pokud ještě hotov nejsi, pokračuj s tool callem ' +\n"
            "            '(write_file, read_file, run_shell). Žádný čistě textový turn už ' +\n"
            "            'nedělej.',\n"
            "        });\n"
            "        if (onEvent) {\n"
            "          await onEvent('decision', {\n"
            "            action: 'no_tool_nudge',\n"
            "            turn,\n"
            "            note: 'Sonnet skončil bez tool_use, posílám připomenutí finish().',\n"
            "          });\n"
            "        }\n"
            "        continue;\n"
            "      }\n"
            "      summary = summary || 'Agent skončil bez volání finish() i po nudge.';\n"
            "      break;\n"
            "    }",
        ),
    ],
)


# ============================================================================
# COMMIT 2 — services/ai-developer/planner.js + runner.js
# - buildSystemPrompt přijímá pastFailures parametr
# - runPlanner přijímá pastFailures parametr
# - runner.js předává pastFailures do runPlanner
# ============================================================================
patch_file(
    "services/ai-developer/planner.js",
    [
        ("function buildSystemPrompt(task, repo) {", "function buildSystemPrompt(task, repo, pastFailures) {"),
        (
            "async function runPlanner({ workdir, task, repo, forbiddenCheck, onEvent }) {",
            "async function runPlanner({ workdir, task, repo, forbiddenCheck, onEvent, pastFailures = null }) {",
        ),
        (
            "      system: buildSystemPrompt(task, repo),",
            "      system: buildSystemPrompt(task, repo, pastFailures),",
        ),
    ],
)

patch_file(
    "services/ai-developer/runner.js",
    [
        (
            "        const result = await plannerModule.runPlanner({\n"
            "          workdir,\n"
            "          task,\n"
            "          repo,\n"
            "          forbiddenCheck,\n"
            "          onEvent: async (kind, payload) => log(kind, payload),\n"
            "        });",
            "        const result = await plannerModule.runPlanner({\n"
            "          workdir,\n"
            "          task,\n"
            "          repo,\n"
            "          forbiddenCheck,\n"
            "          pastFailures,\n"
            "          onEvent: async (kind, payload) => log(kind, payload),\n"
            "        });",
        ),
    ],
)


# ============================================================================
# COMMIT 3 — services/ai-developer/repository.js
# - listQueue dostane toxic-task filter: 2+ failed runs / 24h → vyřadit
# ============================================================================
patch_file(
    "services/ai-developer/repository.js",
    [
        (
            "  // Vyfiltruj ty, co mají běžící run, čekající PR, nebo nedávno failed run.\n"
            "  // - RUNNING_STATUSES: agent právě pracuje\n"
            "  // - pr_open: čeká na review člověka\n"
            "  // - failed/escalated mladší než FAILED_BACKOFF_MINUTES: nedávno spadl,\n"
            "  //   nezvedat 30 min, ať Tomáš stihne změnit target_repo / AC. Bez toho\n"
            "  //   by se cyklus opakoval každých 30 s a pálil tokeny (viz incident\n"
            "  //   2026-05-06: úkol #42 spálil 360 000 tokenů ve 39 retry pokusech).\n"
            "  const FAILED_BACKOFF_MINUTES = 30;\n"
            "  const backoffCutoff = new Date(Date.now() - FAILED_BACKOFF_MINUTES * 60_000);\n"
            "\n"
            "  const taskIds = candidates.map((t) => t.id);\n"
            "  const blocking = await prisma.agentRun.findMany({\n"
            "    where: {\n"
            "      task_id: { in: taskIds },\n"
            "      OR: [\n"
            "        { status: { in: [...RUNNING_STATUSES, 'pr_open'] } },\n"
            "        {\n"
            "          status: { in: ['failed', 'escalated'] },\n"
            "          updated_at: { gte: backoffCutoff },\n"
            "        },\n"
            "      ],\n"
            "    },\n"
            "    select: { task_id: true },\n"
            "  });\n"
            "  const busyTaskIds = new Set(blocking.map((r) => r.task_id));\n"
            "\n"
            "  return candidates.filter((t) => !busyTaskIds.has(t.id));\n"
            "}",
            "  // Vyfiltruj ty, co mají běžící run, čekající PR, nebo nedávno failed run.\n"
            "  // - RUNNING_STATUSES: agent právě pracuje\n"
            "  // - pr_open: čeká na review člověka\n"
            "  // - failed/escalated mladší než FAILED_BACKOFF_MINUTES: nedávno spadl,\n"
            "  //   nezvedat krátkodobě (default 30 min).\n"
            "  // - failed >= MAX_FAILS_PER_24H za posledních 24 h: úkol je toxic, agent ho\n"
            "  //   nikdy nedotáhne (#42 incident: 39× retry / 360k tokens; #49 incident\n"
            "  //   2026-05-12: 4× retry / 1,2M tokens). Vyžaduje manuální reset přes UI\n"
            "  //   (Tomáš musí upravit AC / target_repo a re-pushnout úkol do fronty).\n"
            "  const FAILED_BACKOFF_MINUTES = parseInt(process.env.AI_DEV_FAILED_BACKOFF_MIN || '30', 10);\n"
            "  const MAX_FAILS_PER_24H = parseInt(process.env.AI_DEV_MAX_FAILS_PER_24H || '2', 10);\n"
            "  const backoffCutoff = new Date(Date.now() - FAILED_BACKOFF_MINUTES * 60_000);\n"
            "  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);\n"
            "\n"
            "  const taskIds = candidates.map((t) => t.id);\n"
            "  const blocking = await prisma.agentRun.findMany({\n"
            "    where: {\n"
            "      task_id: { in: taskIds },\n"
            "      OR: [\n"
            "        { status: { in: [...RUNNING_STATUSES, 'pr_open'] } },\n"
            "        {\n"
            "          status: { in: ['failed', 'escalated'] },\n"
            "          updated_at: { gte: backoffCutoff },\n"
            "        },\n"
            "      ],\n"
            "    },\n"
            "    select: { task_id: true },\n"
            "  });\n"
            "  const busyTaskIds = new Set(blocking.map((r) => r.task_id));\n"
            "\n"
            "  // Spočti failure rate per task za posledních 24 h.\n"
            "  const recentFails = await prisma.agentRun.groupBy({\n"
            "    by: ['task_id'],\n"
            "    where: {\n"
            "      task_id: { in: taskIds },\n"
            "      status: { in: ['failed', 'escalated'] },\n"
            "      updated_at: { gte: dayAgo },\n"
            "    },\n"
            "    _count: { _all: true },\n"
            "  });\n"
            "  const toxicTaskIds = new Set(\n"
            "    recentFails\n"
            "      .filter((r) => (r._count?._all || 0) >= MAX_FAILS_PER_24H)\n"
            "      .map((r) => r.task_id)\n"
            "  );\n"
            "\n"
            "  return candidates.filter(\n"
            "    (t) => !busyTaskIds.has(t.id) && !toxicTaskIds.has(t.id)\n"
            "  );\n"
            "}",
        ),
    ],
)

print("\nVšechny patche aplikovány. Zkontroluj `git diff` a commitni.")
