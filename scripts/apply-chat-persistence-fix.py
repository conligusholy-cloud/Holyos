# -*- coding: utf-8 -*-
"""
Persistence draft chatu s Alanem do localStorage.

PROBLÉM: _aiChatState žije jen v paměti prohlížeče. Refresh / 502 / zavření
panelu → celá konverzace pryč. Pro úkol #56 (2026-05-13) tak Tomáš ztratil
celý kontext, který Josef vyprávěl Alanovi.

ŘEŠENÍ:
  1. Po každé zprávě uložit _aiChatState do localStorage (kromě screenshotu —
     base64 by snadno přetekl quota limit).
  2. Při openAiChat: zkontrolovat, zda existuje rozdělaný draft pro AKTUÁLNÍ
     stránku. Pokud ano → restore + bot info zpráva "Pokračujeme tam kde jsme
     skončili". Pokud chce uživatel začít znova, klikne tlačítko "Začít znova".
  3. Po finalize (task vytvořen) → clear z localStorage.
  4. localStorage klíč: 'holyos:ai-chat-draft:' + pagePath (per-page izolace).

Spusť:
    python scripts/apply-chat-persistence-fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIDEBAR = os.path.join(ROOT, "js", "sidebar.js")


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
    SIDEBAR,
    [
        # ────────────────────────────────────────────────────────────────
        # 1) Helper funkce — persist / restore / clear localStorage draftu.
        #    Vložíme před `function openAiChat()`.
        # ────────────────────────────────────────────────────────────────
        (
            "persist/restore/clear helpers",
            "function openAiChat() {",
            "// === Draft chat persistence (recovery po refresh / 502 / zavření) ===\n"
            "// Klíč per stránka — různé stránky mají různé kontexty, ať se nemíchají.\n"
            "function _aiChatDraftKey(pagePath) {\n"
            "  return 'holyos:ai-chat-draft:' + (pagePath || window.location.pathname);\n"
            "}\n"
            "\n"
            "function _persistAiChatState() {\n"
            "  try {\n"
            "    if (!_aiChatState || _aiChatState.finalized) return;\n"
            "    if (!_aiChatState.messages || _aiChatState.messages.length < 2) return; // jen iniciální bot zpráva\n"
            "    // POZOR: screenshot (base64 datauri) může mít stovky kB. Vynech ho,\n"
            "    // jinak rychle narazíme na localStorage quota (typicky 5 MB).\n"
            "    // attachments stejně tak — uchováváme jen metadata, ne data.\n"
            "    var snapshot = {\n"
            "      messages: _aiChatState.messages.filter(function(m) { return !m._pending; }),\n"
            "      step: _aiChatState.step,\n"
            "      description: _aiChatState.description,\n"
            "      draft: _aiChatState.draft,\n"
            "      history: _aiChatState.history,\n"
            "      pagePath: _aiChatState.pagePath,\n"
            "      pageTitle: _aiChatState.pageTitle,\n"
            "      answers: _aiChatState.answers,\n"
            "      savedAt: Date.now(),\n"
            "    };\n"
            "    localStorage.setItem(_aiChatDraftKey(_aiChatState.pagePath), JSON.stringify(snapshot));\n"
            "  } catch (e) {\n"
            "    // Quota exceeded nebo localStorage disabled — ignoruj, nelze nic dělat\n"
            "    console.warn('[ai-chat] persist failed:', e.message);\n"
            "  }\n"
            "}\n"
            "\n"
            "function _restoreAiChatState(pagePath) {\n"
            "  try {\n"
            "    var raw = localStorage.getItem(_aiChatDraftKey(pagePath));\n"
            "    if (!raw) return null;\n"
            "    var parsed = JSON.parse(raw);\n"
            "    // Expirace — drafty starší než 24h zahodit (asi se na ně zapomnělo)\n"
            "    if (parsed.savedAt && Date.now() - parsed.savedAt > 24 * 3600 * 1000) {\n"
            "      localStorage.removeItem(_aiChatDraftKey(pagePath));\n"
            "      return null;\n"
            "    }\n"
            "    return parsed;\n"
            "  } catch (e) {\n"
            "    console.warn('[ai-chat] restore failed:', e.message);\n"
            "    return null;\n"
            "  }\n"
            "}\n"
            "\n"
            "function _clearAiChatDraft(pagePath) {\n"
            "  try { localStorage.removeItem(_aiChatDraftKey(pagePath)); } catch (_) {}\n"
            "}\n"
            "\n"
            "// Tlačítko \"Začít znova\" v UI — exposed globally pro onclick\n"
            "window.restartAiChat = function() {\n"
            "  if (!confirm('Opravdu začít znova? Aktuální konverzace s Alanem se ztratí.')) return;\n"
            "  _clearAiChatDraft(_aiChatState.pagePath);\n"
            "  openAiChat();\n"
            "};\n"
            "\n"
            "function openAiChat() {",
        ),
        # ────────────────────────────────────────────────────────────────
        # 2) Modifikuj openAiChat aby zkusil restore z localStorage
        # ────────────────────────────────────────────────────────────────
        (
            "openAiChat: restore from localStorage",
            "function openAiChat() {\n"
            "  var page = getCurrentPageInfo();\n"
            "  _aiChatState = {\n"
            "    messages: [],\n"
            "    step: 0,\n"
            "    description: '',\n"
            "    draft: {},\n"
            "    history: [],\n"
            "    finalized: false,\n"
            "    summary: null,\n"
            "    escalateReason: null,\n"
            "    screenshot: null,     // hlavní obrázek (pro preview + zachování zpětné kompat.)\n"
            "    attachments: [],      // další soubory — PDF, Word, Excel, obrázky navíc atd.\n"
            "    pagePath: page.path,\n"
            "    pageTitle: page.title,\n"
            "    answers: {}\n"
            "  };\n"
            "\n"
            "  // Add initial bot message\n"
            "  _aiChatState.messages.push({\n"
            "    role: 'bot',\n"
            "    text: 'Ahoj! 👋 Vidím, že jste na stránce <strong>' + page.title + '</strong>.\\n\\nPopište, co byste chtěli upravit nebo přidat. Můžete také nahrát screenshot pro přesnější vyjádření.'\n"
            "  });\n"
            "\n"
            "  renderAiChat();",
            "function openAiChat() {\n"
            "  var page = getCurrentPageInfo();\n"
            "\n"
            "  // === Recovery z localStorage ===\n"
            "  var restored = _restoreAiChatState(page.path);\n"
            "  if (restored && restored.messages && restored.messages.length >= 2) {\n"
            "    _aiChatState = {\n"
            "      messages: restored.messages || [],\n"
            "      step: restored.step || 0,\n"
            "      description: restored.description || '',\n"
            "      draft: restored.draft || {},\n"
            "      history: restored.history || [],\n"
            "      finalized: false,\n"
            "      summary: null,\n"
            "      escalateReason: null,\n"
            "      screenshot: null,\n"
            "      attachments: [],\n"
            "      pagePath: restored.pagePath || page.path,\n"
            "      pageTitle: restored.pageTitle || page.title,\n"
            "      answers: restored.answers || {},\n"
            "    };\n"
            "    // Hlavička indikující recovery + tlačítko Začít znova\n"
            "    _aiChatState.messages.push({\n"
            "      role: 'bot',\n"
            "      text: '\\u23EA Pokračujeme tam kde jsme skončili. Pokud chceš začít znova, klikni vpravo nahoře \\u201CZačít znova\\u201D.'\n"
            "    });\n"
            "    renderAiChat();\n"
            "    return;\n"
            "  }\n"
            "\n"
            "  _aiChatState = {\n"
            "    messages: [],\n"
            "    step: 0,\n"
            "    description: '',\n"
            "    draft: {},\n"
            "    history: [],\n"
            "    finalized: false,\n"
            "    summary: null,\n"
            "    escalateReason: null,\n"
            "    screenshot: null,     // hlavní obrázek (pro preview + zachování zpětné kompat.)\n"
            "    attachments: [],      // další soubory — PDF, Word, Excel, obrázky navíc atd.\n"
            "    pagePath: page.path,\n"
            "    pageTitle: page.title,\n"
            "    answers: {}\n"
            "  };\n"
            "\n"
            "  // Add initial bot message\n"
            "  _aiChatState.messages.push({\n"
            "    role: 'bot',\n"
            "    text: 'Ahoj! 👋 Vidím, že jste na stránce <strong>' + page.title + '</strong>.\\n\\nPopište, co byste chtěli upravit nebo přidat. Můžete také nahrát screenshot pro přesnější vyjádření.'\n"
            "  });\n"
            "\n"
            "  renderAiChat();",
        ),
        # ────────────────────────────────────────────────────────────────
        # 3) Po každém přijetí odpovědi z backendu → persist
        # ────────────────────────────────────────────────────────────────
        (
            "persist po úspěšné odpovědi",
            "    }).then(function(data) {\n"
            "      _aiChatState._inFlight = false;\n"
            "      _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "      _aiChatState.messages.push({ role: 'bot', text: data.ai_message || '(Alan: bez textu)' });\n"
            "      if (data.draft) _aiChatState.draft = data.draft;\n"
            "      if (data.history) _aiChatState.history = data.history;\n"
            "      if (data.finalized) { _aiChatState.finalized = true; _aiChatState.summary = data.summary; }\n"
            "      if (data.escalate) { _aiChatState.escalateReason = data.escalate_reason; }\n"
            "      renderAiChat();\n"
            "    }).catch(function(e) {",
            "    }).then(function(data) {\n"
            "      _aiChatState._inFlight = false;\n"
            "      _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "      _aiChatState.messages.push({ role: 'bot', text: data.ai_message || '(Alan: bez textu)' });\n"
            "      if (data.draft) _aiChatState.draft = data.draft;\n"
            "      if (data.history) _aiChatState.history = data.history;\n"
            "      if (data.finalized) {\n"
            "        _aiChatState.finalized = true;\n"
            "        _aiChatState.summary = data.summary;\n"
            "        _clearAiChatDraft(_aiChatState.pagePath); // úkol vytvořen, draft už netřeba\n"
            "      } else {\n"
            "        _persistAiChatState(); // průběžná záloha pro recovery po refresh/502\n"
            "      }\n"
            "      if (data.escalate) { _aiChatState.escalateReason = data.escalate_reason; }\n"
            "      renderAiChat();\n"
            "    }).catch(function(e) {",
        ),
        # ────────────────────────────────────────────────────────────────
        # 4) Persist i při errorovém ukončení — záloha pro retry po refreshi
        # ────────────────────────────────────────────────────────────────
        (
            "persist po finálním errorovém ukončení",
            "      _aiChatState._inFlight = false;\n"
            "      _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "      var userFriendly = retryable\n"
            "        ? '\\u26A0\\uFE0F AI je momentálně přetížený. Zkus to za chvíli — text máš zpět v poli.'\n"
            "        : '\\u26A0\\uFE0F Chyba: ' + e.message;\n"
            "      _aiChatState.messages.push({ role: 'bot', text: userFriendly });\n"
            "      if (input && _aiChatState._lastUserText) input.value = _aiChatState._lastUserText;\n"
            "      renderAiChat();",
            "      _aiChatState._inFlight = false;\n"
            "      _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "      var userFriendly = retryable\n"
            "        ? '\\u26A0\\uFE0F AI je momentálně přetížený. Zkus to za chvíli — text máš zpět v poli.'\n"
            "        : '\\u26A0\\uFE0F Chyba: ' + e.message;\n"
            "      _aiChatState.messages.push({ role: 'bot', text: userFriendly });\n"
            "      if (input && _aiChatState._lastUserText) input.value = _aiChatState._lastUserText;\n"
            "      _persistAiChatState(); // ulož i errorový stav, ať po refresh user neztratí kontext\n"
            "      renderAiChat();",
        ),
    ],
)

print("\n✅ Hotovo.")
print("Pozn: Tlačítko 'Začít znova' přidáš později do renderAiChat() (manuální úprava nebo další skript).")
