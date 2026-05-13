# -*- coding: utf-8 -*-
"""
Integrace auto-summary helperu do runner.js + flag finishCalled do agent.js
(VRSTVA 3 robust řešení).

Spusť AŽ PO apply-robust-agent-fix.py:
    python scripts/apply-auto-summary-integration.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = os.path.join(ROOT, "services", "ai-developer", "agent.js")
RUNNER = os.path.join(ROOT, "services", "ai-developer", "runner.js")


def patch(path, replacements):
    print(f"--- {os.path.relpath(path, ROOT)}")
    with open(path, "r", encoding="utf-8", newline="") as f:
        content = f.read()
    original = content
    for label, old, new in replacements:
        if new in content and old not in content:
            print(f"  SKIP {label}")
            continue
        if content.count(old) == 0:
            print(f"  ERROR {label} — nelze najít blok")
            sys.exit(1)
        if content.count(old) > 1:
            print(f"  ERROR {label} — neunikátní blok ({content.count(old)}×)")
            sys.exit(1)
        content = content.replace(old, new, 1)
        print(f"  OK   {label}")
    if content == original:
        print(f"  no-op")
        return False
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    print(f"  written ({len(content) - len(original):+d} bytes)")
    return True


# ─── agent.js: přidat finishCalled flag do návratu ─────────────────────────
patch(
    AGENT,
    [
        (
            "track finishCalled state",
            "      if (block.name === 'finish') {\n"
            "        finishCalled = true;\n"
            "        summary = (block.input && block.input.summary) || 'Hotovo.';\n"
            "      }",
            "      if (block.name === 'finish') {\n"
            "        finishCalled = true;\n"
            "        _finishCalledAny = true;\n"
            "        summary = (block.input && block.input.summary) || 'Hotovo.';\n"
            "      }",
        ),
        (
            "deklarace _finishCalledAny",
            "  let _finishNudgeSent = false;\n"
            "  let _stagnationNudgeSent = false;\n"
            "  let lastFileChangeTurn = -1;\n"
            "  const fileChanges = new Set();",
            "  let _finishNudgeSent = false;\n"
            "  let _stagnationNudgeSent = false;\n"
            "  let _finishCalledAny = false;\n"
            "  let lastFileChangeTurn = -1;\n"
            "  const fileChanges = new Set();",
        ),
        (
            "return finishCalled",
            "  return {\n"
            "    summary,\n"
            "    tokensUsed: totalInputTokens + totalOutputTokens,\n"
            "    inputTokens: totalInputTokens,\n"
            "    outputTokens: totalOutputTokens,",
            "  return {\n"
            "    summary,\n"
            "    finishCalled: _finishCalledAny,\n"
            "    tokensUsed: totalInputTokens + totalOutputTokens,\n"
            "    inputTokens: totalInputTokens,\n"
            "    outputTokens: totalOutputTokens,",
        ),
    ],
)


# ─── runner.js: import + integrace auto-summary ────────────────────────────
patch(
    RUNNER,
    [
        (
            "import auto-summary",
            "const { runAgent, buildForbiddenChecker } = require('./agent');",
            "const { runAgent, buildForbiddenChecker } = require('./agent');\n"
            "const autoSummary = require('./auto-summary');",
        ),
        (
            "call auto-summary po runAgent",
            "    const agentResult = await runAgent({\n"
            "      workdir,\n"
            "      task,\n"
            "      repo,\n"
            "      rules: forbiddenRules,\n"
            "      presetPlan: isResume ? presetPlan : null,\n"
            "      onEvent: async (kind, payload) => log(kind, payload),\n"
            "    });\n"
            "\n"
            "    await log('decision', {\n"
            "      action: 'agent_done',\n"
            "      summary: agentResult.summary,\n"
            "      tokens_used: agentResult.tokensUsed,\n"
            "      file_changes: agentResult.fileChanges,\n"
            "    });",
            "    const agentResult = await runAgent({\n"
            "      workdir,\n"
            "      task,\n"
            "      repo,\n"
            "      rules: forbiddenRules,\n"
            "      presetPlan: isResume ? presetPlan : null,\n"
            "      onEvent: async (kind, payload) => log(kind, payload),\n"
            "    });\n"
            "\n"
            "    // VRSTVA 3 — Haiku auto-summary když agent skončil bez finish() ale má changes.\n"
            "    // Fallback summary jako 'Agent dosáhl maxima X kol' není dobrý PR description.\n"
            "    // Generujeme smysluplné shrnutí z task AC + file_changes + recent text_blocks.\n"
            "    let autoSummaryTokens = 0;\n"
            "    if (!agentResult.finishCalled && (agentResult.fileChanges || []).length > 0) {\n"
            "      try {\n"
            "        const enriched = await repository.getRunWithEvents(run.id, { eventsLimit: 30 });\n"
            "        const result = await autoSummary.generateSummary({\n"
            "          task,\n"
            "          fileChanges: agentResult.fileChanges,\n"
            "          events: enriched?.events || [],\n"
            "        });\n"
            "        if (result.summary && result.summary.length > 30) {\n"
            "          await log('decision', {\n"
            "            action: 'auto_summary_generated',\n"
            "            tokens_used: result.tokensUsed,\n"
            "            original_fallback: String(agentResult.summary || '').slice(0, 120),\n"
            "          });\n"
            "          agentResult.summary = result.summary;\n"
            "          autoSummaryTokens = result.tokensUsed;\n"
            "        }\n"
            "      } catch (e) {\n"
            "        console.warn('[ai-dev/runner] auto-summary failed:', e.message);\n"
            "        await log('error', { phase: 'auto_summary', message: e.message });\n"
            "      }\n"
            "    }\n"
            "\n"
            "    await log('decision', {\n"
            "      action: 'agent_done',\n"
            "      summary: agentResult.summary,\n"
            "      tokens_used: agentResult.tokensUsed,\n"
            "      auto_summary_tokens: autoSummaryTokens,\n"
            "      finish_called: agentResult.finishCalled,\n"
            "      file_changes: agentResult.fileChanges,\n"
            "    });",
        ),
        (
            "tokens_used zahrnuje auto-summary",
            "    await repository.updateRun(run.id, {\n"
            "      summary: agentResult.summary,\n"
            "      tokens_used: triageTokens + plannerTokens + agentResult.tokensUsed,\n"
            "    });",
            "    await repository.updateRun(run.id, {\n"
            "      summary: agentResult.summary,\n"
            "      tokens_used: triageTokens + plannerTokens + agentResult.tokensUsed + autoSummaryTokens,\n"
            "    });",
        ),
    ],
)

print("\n✅ Hotovo. Zkontroluj `git diff services/ai-developer/`.")
