# -*- coding: utf-8 -*-
"""
Fix 400 invalid_request_error v ac-chat.js (chat() + chatDraft()).

PROBLÉM: response.content z Anthropic obsahuje text bloky I tool_use bloky.
Kód pushuje CELÝ response.content do history. Tool_use bloky tam zůstávají
bez korespondujícího tool_result, takže další volání API končí 400:
  'tool_use ids were found without tool_result blocks immediately after'

ŘEŠENÍ: stripnout tool_use bloky z assistant content před uložením do history.
Sonnet je nepotřebuje vidět v dalším turnu — efekt (update_ac_fields apod.)
proběhl backendově a frontend draft se updatoval.

Spusť:
    python scripts/apply-ac-chat-400-fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "services", "ai-developer", "ac-chat.js")


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


# Společný helper přidám na začátek souboru (po require).
# Pak ho použiju v obou newHistory blocích.

HELPER = (
    "// stripToolUses — vrátí jen text bloky z Anthropic response.content.\n"
    "// Bez tohohle by tool_use bloky zůstaly v history a další API call by selhal\n"
    "// s 400 'tool_use ids were found without tool_result blocks immediately after'.\n"
    "// Sonnet tool_use bloky v history nepotřebuje — efekt (update_ac_fields apod.)\n"
    "// proběhl server-side a frontend draft se updatoval přes 'updates' return value.\n"
    "function stripToolUses(content) {\n"
    "  if (!Array.isArray(content)) return content;\n"
    "  const textOnly = content.filter((b) => b.type === 'text');\n"
    "  if (textOnly.length === 0) {\n"
    "    // Sonnet vrátil jen tool_use bez textu — pošli prázdnou textovku, ať\n"
    "    // Anthropic přijme assistant turn (assistant nesmí být prázdný array).\n"
    "    return [{ type: 'text', text: '(akce provedena)' }];\n"
    "  }\n"
    "  return textOnly;\n"
    "}\n"
    "\n"
)


patch(
    TARGET,
    [
        (
            "stripToolUses helper",
            "const AC_CHAT_MODEL = process.env.AI_DEV_AC_CHAT_MODEL || 'claude-haiku-4-5-20251001';\n"
            "const AC_CHAT_MAX_TOKENS = 2048;",
            "const AC_CHAT_MODEL = process.env.AI_DEV_AC_CHAT_MODEL || 'claude-haiku-4-5-20251001';\n"
            "const AC_CHAT_MAX_TOKENS = 2048;\n"
            "\n"
            + HELPER.rstrip(),
        ),
        (
            "chat(): strip tool_use v newHistory",
            "  // Build new history (push our turn + assistant turn)\n"
            "  const newHistory = [\n"
            "    ...history,\n"
            "    { role: 'user', content: userMessage },\n"
            "    { role: 'assistant', content: response.content },\n"
            "  ];",
            "  // Build new history (push our turn + assistant turn)\n"
            "  // POZOR: stripToolUses() je nutný — bez něj 400 invalid_request_error\n"
            "  // ('tool_use ids were found without tool_result blocks') v dalším volání.\n"
            "  const newHistory = [\n"
            "    ...history,\n"
            "    { role: 'user', content: userMessage },\n"
            "    { role: 'assistant', content: stripToolUses(response.content) },\n"
            "  ];",
        ),
        (
            "chatDraft(): strip tool_use v newHistory",
            "  const newHistory = [\n"
            "    ...history,\n"
            "    { role: 'user', content: userMessage },\n"
            "    { role: 'assistant', content: response.content },\n"
            "  ];\n"
            "\n"
            "  // Merge updates do draftu (pro frontend pohodlí — vrátíme updated draft)\n"
            "  const updatedDraft = updates ? { ...draft, ...updates } : draft;",
            "  // POZOR: stripToolUses() je nutný — bez něj 400 invalid_request_error\n"
            "  // ('tool_use ids were found without tool_result blocks') v dalším volání.\n"
            "  const newHistory = [\n"
            "    ...history,\n"
            "    { role: 'user', content: userMessage },\n"
            "    { role: 'assistant', content: stripToolUses(response.content) },\n"
            "  ];\n"
            "\n"
            "  // Merge updates do draftu (pro frontend pohodlí — vrátíme updated draft)\n"
            "  const updatedDraft = updates ? { ...draft, ...updates } : draft;",
        ),
    ],
)

print("\n✅ Hotovo. Spusť `git diff services/ai-developer/ac-chat.js` a commitni.")
