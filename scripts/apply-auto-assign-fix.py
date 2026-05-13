# -*- coding: utf-8 -*-
"""
Auto-assign úkolu na AI Vývojáře při ai_suitability_score >= threshold.

Default threshold: 70 % (env AI_AUTO_ASSIGN_THRESHOLD).

Logika:
  1. evaluateSuitabilityAsync vyhodnotí score
  2. Pokud score >= threshold AND task.assignable_to_ai není true
     AND task.acceptance_criteria existuje AND task.status NOT IN (done,archived)
     → automaticky nastav assignable_to_ai=true + target_repo_id (default první
     aktivní repo nebo AI_AUTO_ASSIGN_REPO_ID env) + autonomy_override
     (default pr_review nebo AI_AUTO_ASSIGN_AUTONOMY env)
  3. Pošli chat zprávu do task threadu: "🤖 Úkol automaticky předán AI Vývojáři"
  4. Vlož decision event do AgentRunEvent? Ne — task ještě nemá run.
     Místo toho jen console.log + chat notif.

ENV (defaults):
  AI_AUTO_ASSIGN_THRESHOLD=70
  AI_AUTO_ASSIGN_REPO_ID=  (prázdné = první aktivní repo)
  AI_AUTO_ASSIGN_AUTONOMY=pr_review

Spusť:
    python scripts/apply-auto-assign-fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "routes", "admin-tasks.routes.js")


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
            print(f"  ERROR {label} — blok nenalezen")
            sys.exit(1)
        if content.count(old) > 1:
            print(f"  ERROR {label} — blok není unikátní ({content.count(old)}×)")
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


patch(
    TARGET,
    [
        # ────────────────────────────────────────────────────────────────
        # 1) Import chat modulu (pokud chybí — pro postMessage notif)
        # ────────────────────────────────────────────────────────────────
        (
            "import chat service",
            "const suitability = require('../services/ai-developer/suitability');\n"
            "\n"
            "router.use(requireAuth);",
            "const suitability = require('../services/ai-developer/suitability');\n"
            "const chat = require('../services/ai-developer/chat');\n"
            "\n"
            "router.use(requireAuth);",
        ),
        # ────────────────────────────────────────────────────────────────
        # 2) Helper funkce maybeAutoAssign + integrace do evaluateSuitabilityAsync
        # ────────────────────────────────────────────────────────────────
        (
            "evaluateSuitabilityAsync + auto-assign hook",
            "// Helper — vyhodnotí task + uloží score/reasoning do DB.\n"
            "async function evaluateSuitabilityAsync(taskId) {\n"
            "  const task = await prisma.adminTask.findUnique({\n"
            "    where: { id: taskId },\n"
            "    select: {\n"
            "      id: true, page_title: true, description: true, page: true,\n"
            "      acceptance_criteria: true, affected_module: true, change_type: true,\n"
            "    },\n"
            "  });\n"
            "  if (!task) return;\n"
            "  const result = await suitability.evaluate(task);\n"
            "  const data = {\n"
            "    ai_suitability_score: result.score,\n"
            "    ai_suitability_reasoning: result.reasoning,\n"
            "    ai_suitability_at: new Date(),\n"
            "  };\n"
            "  // Pokud Alan ještě nemá change_type / autonomy, můžeme nasadit doporučení.\n"
            "  // Jen JEMNĚ — nepřepisujeme pokud už něco je (uživatel může mít vlastní volbu).\n"
            "  if (result.recommendedChangeType && !task.change_type) data.change_type = result.recommendedChangeType;\n"
            "  await prisma.adminTask.update({ where: { id: taskId }, data });\n"
            "}",
            "// Helper — vyhodnotí task + uloží score/reasoning do DB.\n"
            "async function evaluateSuitabilityAsync(taskId) {\n"
            "  const task = await prisma.adminTask.findUnique({\n"
            "    where: { id: taskId },\n"
            "    select: {\n"
            "      id: true, page_title: true, description: true, page: true,\n"
            "      acceptance_criteria: true, affected_module: true, change_type: true,\n"
            "    },\n"
            "  });\n"
            "  if (!task) return;\n"
            "  const result = await suitability.evaluate(task);\n"
            "  const data = {\n"
            "    ai_suitability_score: result.score,\n"
            "    ai_suitability_reasoning: result.reasoning,\n"
            "    ai_suitability_at: new Date(),\n"
            "  };\n"
            "  // Pokud Alan ještě nemá change_type / autonomy, můžeme nasadit doporučení.\n"
            "  // Jen JEMNĚ — nepřepisujeme pokud už něco je (uživatel může mít vlastní volbu).\n"
            "  if (result.recommendedChangeType && !task.change_type) data.change_type = result.recommendedChangeType;\n"
            "  await prisma.adminTask.update({ where: { id: taskId }, data });\n"
            "\n"
            "  // AUTO-ASSIGN: pokud score >= threshold, automaticky předej AI Vývojáři.\n"
            "  await maybeAutoAssignToAI(taskId, result.score);\n"
            "}\n"
            "\n"
            "// AUTO-ASSIGN HELPER\n"
            "// Když suitability skóre překročí threshold, automaticky nastav assignable_to_ai\n"
            "// + target_repo_id (default první aktivní repo) + autonomy_override (default pr_review).\n"
            "// Tomáš pak ručně už nemusí klikat 'Přidat AI Vývojáři'.\n"
            "async function maybeAutoAssignToAI(taskId, score) {\n"
            "  const threshold = parseInt(process.env.AI_AUTO_ASSIGN_THRESHOLD || '70', 10);\n"
            "  if (!Number.isFinite(score) || score < threshold) return false;\n"
            "\n"
            "  const task = await prisma.adminTask.findUnique({\n"
            "    where: { id: taskId },\n"
            "    select: {\n"
            "      id: true, page_title: true, assignable_to_ai: true,\n"
            "      target_repo_id: true, autonomy_override: true,\n"
            "      acceptance_criteria: true, status: true,\n"
            "    },\n"
            "  });\n"
            "  if (!task) return false;\n"
            "  if (task.assignable_to_ai) return false; // už předáno dřív\n"
            "  if (!task.acceptance_criteria || task.acceptance_criteria.length < 20) {\n"
            "    console.log('[auto-assign] task #' + taskId + ' skip — chybí AC');\n"
            "    return false;\n"
            "  }\n"
            "  if (task.status === 'done' || task.status === 'archived') return false;\n"
            "\n"
            "  // Vyber target_repo_id — pokud už ho task má, použij; jinak env nebo první aktivní\n"
            "  let repoId = task.target_repo_id;\n"
            "  if (!repoId) {\n"
            "    if (process.env.AI_AUTO_ASSIGN_REPO_ID) {\n"
            "      repoId = parseInt(process.env.AI_AUTO_ASSIGN_REPO_ID, 10);\n"
            "    } else {\n"
            "      const defaultRepo = await prisma.agentRepo.findFirst({\n"
            "        where: { active: true },\n"
            "        orderBy: { id: 'asc' },\n"
            "      });\n"
            "      if (!defaultRepo) {\n"
            "        console.warn('[auto-assign] task #' + taskId + ' — žádný aktivní repo, skip');\n"
            "        return false;\n"
            "      }\n"
            "      repoId = defaultRepo.id;\n"
            "    }\n"
            "  }\n"
            "\n"
            "  const autonomy = task.autonomy_override || process.env.AI_AUTO_ASSIGN_AUTONOMY || 'pr_review';\n"
            "\n"
            "  await prisma.adminTask.update({\n"
            "    where: { id: taskId },\n"
            "    data: {\n"
            "      assignable_to_ai: true,\n"
            "      target_repo_id: repoId,\n"
            "      autonomy_override: autonomy,\n"
            "    },\n"
            "  });\n"
            "  console.log('[auto-assign] task #' + taskId + ' → AI Vývojář (score=' + score + '/100, repo=' + repoId + ', autonomy=' + autonomy + ')');\n"
            "\n"
            "  // Chat notif do task threadu\n"
            "  try {\n"
            "    await chat.postMessage(taskId,\n"
            "      '🤖 **Úkol automaticky předán AI Vývojáři** (skóre ' + score + '/100 ≥ ' + threshold + ').\\n\\n' +\n"
            "      'Worker ho vyzvedne v dalším pollu (~30 s). Pokud chceš zrušit, klikni \"Uvolnit z AI\" v UI úkolu.'\n"
            "    );\n"
            "  } catch (e) { console.warn('[auto-assign] chat notif failed:', e.message); }\n"
            "\n"
            "  return true;\n"
            "}",
        ),
    ],
)

print("\n✅ Hotovo.")
print("ENV proměnné (volitelné, mají defaults):")
print("  AI_AUTO_ASSIGN_THRESHOLD=70")
print("  AI_AUTO_ASSIGN_REPO_ID=     (prázdné = první aktivní repo)")
print("  AI_AUTO_ASSIGN_AUTONOMY=pr_review")
