# -*- coding: utf-8 -*-
"""
Apply max_tokens recovery 400 fix to services/ai-developer/agent.js.

Recovery code v max_tokens větvi musí poslat tool_result (is_error=true) pro
každý useknutý tool_use_id PŘED textovým nudge — jinak Anthropic API vrátí 400
invalid_request_error.

Idempotentní — opakované spuštění nic neudělá.

Spusť:
    python scripts/apply-max-tokens-tool-result-fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "services", "ai-developer", "agent.js")

OLD_BLOCK = (
    "    // stop_reason='max_tokens' znamená, že odpověď byla useknutá kvůli limitu —\n"
    "    // tool_use blok je neúplný (např. write_file s mid-content cutoff). Nesmí\n"
    "    // se to brát jako \"vzdal to\"; pošli nudge user-message a dej Sonnetu šanci\n"
    "    // pokračovat. Tool_use bloky s neúplným input.content do tool_results\n"
    "    // neposíláme — Sonnet vidí, že tool nezvládl run a zkusí to znovu menší.\n"
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
    "    }"
)

NEW_BLOCK = (
    "    // stop_reason='max_tokens' znamená, že odpověď byla useknutá kvůli limitu —\n"
    "    // tool_use blok je neúplný (např. write_file s mid-content cutoff).\n"
    "    //\n"
    "    // KRITICKÉ: Anthropic API vyžaduje, aby user message PO assistant message\n"
    "    // s tool_use obsahovala tool_result pro KAŽDÉ tool_use_id. Jinak vrátí\n"
    "    // 400 invalid_request_error. Takže nestačí poslat jen text nudge —\n"
    "    // musíme nejdřív poslat is_error tool_result pro každý neúplný tool_use\n"
    "    // a pak druhý user message s textovým nudge.\n"
    "    if (response.stop_reason === 'max_tokens') {\n"
    "      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');\n"
    "      if (toolUseBlocks.length > 0) {\n"
    "        messages.push({\n"
    "          role: 'user',\n"
    "          content: toolUseBlocks.map((b) => ({\n"
    "            type: 'tool_result',\n"
    "            tool_use_id: b.id,\n"
    "            content:\n"
    "              'Tool nemohl být proveden — tvoje odpověď byla useknutá na max_tokens (' +\n"
    "              MAX_TOKENS_PER_TURN +\n"
    "              ' output tokenů). Rozděl výstup na menší kusy a zkus znovu.',\n"
    "            is_error: true,\n"
    "          })),\n"
    "        });\n"
    "      }\n"
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
    "          truncated_tool_uses: toolUseBlocks.length,\n"
    "          note: 'Předchozí turn useknut, posílám nudge.',\n"
    "        });\n"
    "      }\n"
    "      continue;\n"
    "    }"
)


def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        content = f.read()

    if "truncated_tool_uses: toolUseBlocks.length" in content:
        print("✅ Fix už aplikovaný, nic neměním.")
        return

    if OLD_BLOCK not in content:
        print("❌ Nelze najít původní blok max_tokens recovery v agent.js")
        print("   Soubor mohl být upraven jinde — projdi diff ručně.")
        sys.exit(1)

    new_content = content.replace(OLD_BLOCK, NEW_BLOCK, 1)
    with open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(new_content)
    print(f"✅ Aplikováno ({len(new_content) - len(content):+d} bytes).")
    print("   Zkontroluj `git diff services/ai-developer/agent.js` a commitni.")


if __name__ == "__main__":
    main()
