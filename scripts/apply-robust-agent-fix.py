# -*- coding: utf-8 -*-
"""
Robustní 4-vrstvý fix pro AI Vývojář agent:
  1. Stagnation detection — nudge po 3 turnech bez file_change
  2. Token budget guard — hard cap na input tokens (default 800k)
  3. Silnější system prompt (push na finish() ihned po dokončení změn)
  4. MAX_TURNS default 25 → 18

Cíl: 80% úspora tokenů na typickém úkolu.

Spusť:
    python scripts/apply-robust-agent-fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "services", "ai-developer", "agent.js")


def patch(content, old, new, label):
    if new in content and old not in content:
        print(f"  SKIP {label} — už aplikováno")
        return content, False
    if content.count(old) == 0:
        print(f"  ERROR {label} — nelze najít blok")
        sys.exit(1)
    if content.count(old) > 1:
        print(f"  ERROR {label} — blok není unikátní ({content.count(old)}×)")
        sys.exit(1)
    print(f"  OK   {label}")
    return content.replace(old, new, 1), True


def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        content = f.read()

    original_len = len(content)
    any_change = False

    # ──────────────────────────────────────────────────────────────────────
    # 1) MAX_TURNS default 25 → 18 + nová konstanta pro token budget
    # ──────────────────────────────────────────────────────────────────────
    content, ch = patch(
        content,
        "const MAX_TURNS = parseInt(process.env.AI_DEV_MAX_TURNS || '25', 10);\n"
        "// 16 384 — výrazně více než 4 096, ať write_file velkého souboru (např. routes/*.js\n"
        "// ~30–50 kB) projde v jednom turnu bez useknutí. Důvod: stop_reason='max_tokens'\n"
        "// uřízne tool_use blok mid-content, agent.js to pak nesprávně interpretoval jako\n"
        "// \"skončil bez finish()\" a celý běh zhavaroval (#49, 12.5.2026: 288k tokens, 0 commitů).\n"
        "const MAX_TOKENS_PER_TURN = parseInt(process.env.AI_DEV_MAX_TOKENS_PER_TURN || '16384', 10);",
        "const MAX_TURNS = parseInt(process.env.AI_DEV_MAX_TURNS || '18', 10);\n"
        "// 16 384 — výrazně více než 4 096, ať write_file velkého souboru (např. routes/*.js\n"
        "// ~30–50 kB) projde v jednom turnu bez useknutí. Důvod: stop_reason='max_tokens'\n"
        "// uřízne tool_use blok mid-content, agent.js to pak nesprávně interpretoval jako\n"
        "// \"skončil bez finish()\" a celý běh zhavaroval (#49, 12.5.2026: 288k tokens, 0 commitů).\n"
        "const MAX_TOKENS_PER_TURN = parseInt(process.env.AI_DEV_MAX_TOKENS_PER_TURN || '16384', 10);\n"
        "// Hard cap na input tokens per run — pojistka proti runaway loopu, kdyby stagnation\n"
        "// detection selhala. 800k * Sonnet input ~$3/M = max $2.40 na run.\n"
        "const MAX_INPUT_TOKENS_PER_RUN = parseInt(process.env.AI_DEV_MAX_INPUT_TOKENS || '800000', 10);\n"
        "// Po kolika turnech bez file_change pošleme stagnation nudge.\n"
        "const STAGNATION_TURNS = parseInt(process.env.AI_DEV_STAGNATION_TURNS || '3', 10);",
        "Vrstva 4: MAX_TURNS 25→18 + nové konstanty",
    )
    any_change = any_change or ch

    # ──────────────────────────────────────────────────────────────────────
    # 2) System prompt — silnější tlak na finish()
    # ──────────────────────────────────────────────────────────────────────
    content, ch = patch(
        content,
        "POSTUP:\n"
        "1. Prozkoumej strukturu repa pomocí list_files / read_file.\n"
        "2. Najdi soubory, které je potřeba změnit nebo vytvořit.\n"
        "3. Proveď změny pomocí write_file.\n"
        "4. Pokud existují testy nebo lintery, spusť je přes run_shell (whitelist: npm test, npm run lint, npm run build, npx eslint, npx prettier).\n"
        "5. Až jsi hotov, zavolej finish() s krátkým shrnutím (česky, 4–6 vět) pro PR description.\n"
        "\n"
        "PRAVIDLA:\n"
        "- NIKDY neměň: .env*, secrets/, *.key, *.pem, prisma/migrations/, node_modules/.\n"
        "- Drž se akceptačních kritérií, neexpanduj scope.\n"
        "- Pokud zadání nedává smysl, volej finish s vysvětlením, co chybí. Lidský operátor to převezme.\n"
        "- Žádné force push, žádné mazání cizích souborů, žádný npm install nových balíčků.\n"
        "- Maximum ${MAX_TURNS} kol nástrojů. Buď rychlý a konkrétní.",
        "POSTUP:\n"
        "1. Prozkoumej strukturu repa pomocí list_files / read_file (max 5–8 kol).\n"
        "2. Najdi soubory, které je potřeba změnit nebo vytvořit.\n"
        "3. Proveď změny pomocí write_file.\n"
        "4. Pokud existují testy nebo lintery, spusť je přes run_shell (whitelist: npm test, npm run lint, npm run build, npx eslint, npx prettier).\n"
        "5. JAKMILE tvoje write_file změny pokrývají všechna AC, ZAVOLEJ finish() OKAMŽITĚ.\n"
        "   Shrnutí česky, 4–6 vět pro PR description. NEPOKRAČUJ v exploring po dokončení.\n"
        "\n"
        "KRITICKÉ PRAVIDLO COST AWARENESS:\n"
        "- Každý turn = celá historie znovu přes drahý Sonnet model. Zbytečné read_file po\n"
        "  dokončení změn pálí peníze majitele (1 turn ≈ $0.10–$0.50 na Tier 2).\n"
        "- Pokud si nejsi 100% jistý, jestli jsi hotov, finish() RADŠI BRZO s tím co máš.\n"
        "  Review udělá člověk; nedotažené detaily se dají dořešit v dalším úkolu.\n"
        "- Po 3 turnech bez write_file dostaneš nudge — pak okamžitě finish, nebo udělej\n"
        "  konkrétní write_file (žádné další list_files).\n"
        "\n"
        "PRAVIDLA:\n"
        "- NIKDY neměň: .env*, secrets/, *.key, *.pem, prisma/migrations/, node_modules/.\n"
        "- Drž se akceptačních kritérií, neexpanduj scope.\n"
        "- Pokud zadání nedává smysl, volej finish s vysvětlením, co chybí. Lidský operátor to převezme.\n"
        "- Žádné force push, žádné mazání cizích souborů, žádný npm install nových balíčků.\n"
        "- Maximum ${MAX_TURNS} kol nástrojů. Buď rychlý a konkrétní.",
        "System prompt — silnější push na finish()",
    )
    any_change = any_change or ch

    # ──────────────────────────────────────────────────────────────────────
    # 3) State tracking — přidat _stagnationNudgeSent + lastFileChangeTurn
    # ──────────────────────────────────────────────────────────────────────
    content, ch = patch(
        content,
        "  let totalInputTokens = 0;\n"
        "  let totalOutputTokens = 0;\n"
        "  let summary = null;\n"
        "  let _finishNudgeSent = false;\n"
        "  const fileChanges = new Set();",
        "  let totalInputTokens = 0;\n"
        "  let totalOutputTokens = 0;\n"
        "  let summary = null;\n"
        "  let _finishNudgeSent = false;\n"
        "  let _stagnationNudgeSent = false;\n"
        "  let lastFileChangeTurn = -1;\n"
        "  const fileChanges = new Set();",
        "State pro stagnation detection",
    )
    any_change = any_change or ch

    # ──────────────────────────────────────────────────────────────────────
    # 4) Token budget guard — po počítání tokenů check budget
    #    (Hledáme blok kde se počítají tokeny — totalInputTokens += ...)
    # ──────────────────────────────────────────────────────────────────────
    content, ch = patch(
        content,
        "    totalInputTokens += response.usage?.input_tokens || 0;\n"
        "    totalOutputTokens += response.usage?.output_tokens || 0;",
        "    totalInputTokens += response.usage?.input_tokens || 0;\n"
        "    totalOutputTokens += response.usage?.output_tokens || 0;\n"
        "\n"
        "    // VRSTVA 2 — Token budget guard. Pokud agent přeskočí ekonomickou hranici,\n"
        "    // okamžitě přerušíme. Runner pak otevře PR pokud existují file_changes.\n"
        "    if (totalInputTokens > MAX_INPUT_TOKENS_PER_RUN) {\n"
        "      summary = summary ||\n"
        "        'Token budget vyčerpán (' + totalInputTokens + '/' + MAX_INPUT_TOKENS_PER_RUN +\n"
        "        ' input tokens). PR otevřen pokud existují file_changes.';\n"
        "      if (onEvent) {\n"
        "        await onEvent('decision', {\n"
        "          action: 'token_budget_exceeded',\n"
        "          input_tokens: totalInputTokens,\n"
        "          output_tokens: totalOutputTokens,\n"
        "          file_changes: fileChanges.size,\n"
        "        });\n"
        "      }\n"
        "      break;\n"
        "    }",
        "Vrstva 2: Token budget guard",
    )
    any_change = any_change or ch

    # ──────────────────────────────────────────────────────────────────────
    # 5) Track lastFileChangeTurn v write_file branch
    # ──────────────────────────────────────────────────────────────────────
    content, ch = patch(
        content,
        "      if (block.name === 'write_file' && result?.ok) {\n"
        "        fileChanges.add(block.input.path);\n"
        "        if (onEvent) await onEvent('file_change', { path: block.input.path, bytes: result.bytes });\n"
        "      }",
        "      if (block.name === 'write_file' && result?.ok) {\n"
        "        fileChanges.add(block.input.path);\n"
        "        lastFileChangeTurn = turn;\n"
        "        if (onEvent) await onEvent('file_change', { path: block.input.path, bytes: result.bytes });\n"
        "      }",
        "lastFileChangeTurn tracking",
    )
    any_change = any_change or ch

    # ──────────────────────────────────────────────────────────────────────
    # 6) Stagnation detection — po messages.push tool_results, před if (finishCalled) break
    # ──────────────────────────────────────────────────────────────────────
    content, ch = patch(
        content,
        "    messages.push({ role: 'user', content: toolResults });\n"
        "\n"
        "    if (finishCalled) break;\n"
        "  }",
        "    messages.push({ role: 'user', content: toolResults });\n"
        "\n"
        "    if (finishCalled) break;\n"
        "\n"
        "    // VRSTVA 1 — Stagnation detection.\n"
        "    // Agent legitimně exploruje na začátku (read_file / list_files), pak by měl\n"
        "    // udělat changes a finishovat. Pokud po prvním write_file proběhly STAGNATION_TURNS\n"
        "    // kol bez další změny, je vysoká pravděpodobnost že je hotov ale jen exploruje.\n"
        "    // Pošleme mu jasný signál.\n"
        "    if (\n"
        "      !_stagnationNudgeSent &&\n"
        "      lastFileChangeTurn >= 0 &&\n"
        "      turn - lastFileChangeTurn >= STAGNATION_TURNS\n"
        "    ) {\n"
        "      _stagnationNudgeSent = true;\n"
        "      messages.push({\n"
        "        role: 'user',\n"
        "        content:\n"
        "          'Posledních ' + STAGNATION_TURNS + ' kol jsi neudělal žádnou změnu souboru. ' +\n"
        "          'Pokud jsi splnil akceptační kritéria, zavolej OKAMŽITĚ finish() s česky ' +\n"
        "          'napsaným shrnutím (4–6 vět) pro PR description. Nepokračuj v dalším ' +\n"
        "          'exploring — pálíš peníze majitele. Pokud máš ještě jednu konkrétní ' +\n"
        "          'změnu, popiš ji jednou větou a hned ji udělej write_file callem.',\n"
        "      });\n"
        "      if (onEvent) {\n"
        "        await onEvent('decision', {\n"
        "          action: 'stagnation_nudge',\n"
        "          turn,\n"
        "          last_file_change_turn: lastFileChangeTurn,\n"
        "          stagnant_turns: turn - lastFileChangeTurn,\n"
        "        });\n"
        "      }\n"
        "    }\n"
        "  }",
        "Vrstva 1: Stagnation detection",
    )
    any_change = any_change or ch

    if not any_change:
        print("\n✅ Vše už aplikováno, nic neměním.")
        return

    with open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    print(f"\n✅ Aplikováno ({len(content) - original_len:+d} bytes).")
    print("   Zkontroluj `git diff services/ai-developer/agent.js` a commitni.")


if __name__ == "__main__":
    main()
