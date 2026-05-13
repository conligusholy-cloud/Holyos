# -*- coding: utf-8 -*-
"""
Robustní fix pro Alan/Kolega chat — eliminace HTTP 500 (zkus znovu) hlášek.

VRSTVY:
  1. Frontend auto-retry s exponential backoff (2s, 5s, 10s) na 5xx/429
  2. Frontend single-flight guard (nikdy 2 paralelní requesty)
  3. Frontend preserve message on error (vrátí text do inputu)
  4. Frontend friendly error messaging (rozliš retryable vs neretryable)
  5. Backend strukturované error response s retry hint
  6. Backend detailní logging s exception trace + Anthropic error code

Spusť:
    python scripts/apply-chat-resilience-fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTES = os.path.join(ROOT, "routes", "admin-tasks.routes.js")
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


# ─── BACKEND: routes/admin-tasks.routes.js — strukturované error response ──
patch(
    ROUTES,
    [
        (
            "draft-chat: lepší error handling + logging",
            "    let result;\n"
            "    try {\n"
            "      result = await acChat.chatDraft({ draft, history, userMessage: message, pageContext });\n"
            "    } catch (e) {\n"
            "      console.error('[ac-chat draft] failed:', e.message);\n"
            "      return res.status(500).json({ error: 'AC chat (draft) selhal: ' + e.message });\n"
            "    }",
            "    let result;\n"
            "    try {\n"
            "      result = await acChat.chatDraft({ draft, history, userMessage: message, pageContext });\n"
            "    } catch (e) {\n"
            "      // Detailní log pro debug — celá exception trace + Anthropic error code.\n"
            "      console.error('[ac-chat draft] failed:', {\n"
            "        message: e.message,\n"
            "        status: e.status || e.statusCode || null,\n"
            "        anthropicError: e.error || e.response?.data || null,\n"
            "        stack: e.stack ? e.stack.split('\\n').slice(0, 5).join('\\n') : null,\n"
            "      });\n"
            "      // Mapuj Anthropic chyby na proper HTTP status + retry hint pro klienta.\n"
            "      const upstreamStatus = e.status || e.statusCode;\n"
            "      const retryable = upstreamStatus === 429 || upstreamStatus === 503 ||\n"
            "                        upstreamStatus === 529 || (upstreamStatus >= 500 && upstreamStatus < 600);\n"
            "      const retryAfter = e.headers && e.headers['retry-after']\n"
            "        ? Number(e.headers['retry-after'])\n"
            "        : (retryable ? 5 : null);\n"
            "      const httpStatus = upstreamStatus === 429 ? 429 : (retryable ? 503 : 500);\n"
            "      return res.status(httpStatus).json({\n"
            "        error: e.message || 'AC chat (draft) selhal',\n"
            "        retryable,\n"
            "        retry_after: retryAfter,\n"
            "        code: upstreamStatus || 'unknown',\n"
            "      });\n"
            "    }",
        ),
    ],
)


# ─── FRONTEND: js/sidebar.js — kompletní přepsání fetch chainu ─────────────
# Jeden velký patch: single-flight + auto-retry + preserve text + friendly errors
patch(
    SIDEBAR,
    [
        (
            "draft-chat fetch chain → resilient verze",
            "  _aiChatState.messages.push({ role: 'bot', text: '\\u23F3 Alan p\\u0159em\\u00FD\\u0161l\\u00ED...', _pending: true });\n"
            "  if (input) input.value = '';\n"
            "  renderAiChat();\n"
            "\n"
            "  var headers = { 'Content-Type': 'application/json' };\n"
            "  var tk = sessionStorage.getItem('token');\n"
            "  if (tk) headers['Authorization'] = 'Bearer ' + tk;\n"
            "\n"
            "  fetch('/api/admin-tasks/draft-chat', {\n"
            "    method: 'POST',\n"
            "    credentials: 'include',\n"
            "    headers: headers,\n"
            "    body: JSON.stringify({\n"
            "      message: text,\n"
            "      history: _aiChatState.history || [],\n"
            "      draft: _aiChatState.draft || {},\n"
            "      page_context: { path: _aiChatState.pagePath, title: _aiChatState.pageTitle },\n"
            "    }),\n"
            "  }).then(function(r) {\n"
            "    if (!r.ok) throw new Error('HTTP ' + r.status);\n"
            "    return r.json();\n"
            "  }).then(function(data) {\n"
            "    _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "    _aiChatState.messages.push({ role: 'bot', text: data.ai_message || '(Alan: bez textu)' });\n"
            "    if (data.draft) _aiChatState.draft = data.draft;\n"
            "    if (data.history) _aiChatState.history = data.history;\n"
            "    if (data.finalized) { _aiChatState.finalized = true; _aiChatState.summary = data.summary; }\n"
            "    if (data.escalate) { _aiChatState.escalateReason = data.escalate_reason; }\n"
            "    renderAiChat();\n"
            "  }).catch(function(e) {\n"
            "    _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "    _aiChatState.messages.push({ role: 'bot', text: '\\u26A0\\uFE0F Chyba: ' + e.message + ' (zkus znovu)' });\n"
            "    renderAiChat();\n"
            "  });\n"
            "}",
            "  // === Robustní fix proti HTTP 500 ===\n"
            "  // Single-flight: pokud běží předchozí request, nepouštět druhý\n"
            "  if (_aiChatState._inFlight) {\n"
            "    if (input) input.value = text;\n"
            "    return;\n"
            "  }\n"
            "  _aiChatState._inFlight = true;\n"
            "  _aiChatState._lastUserText = text;\n"
            "\n"
            "  _aiChatState.messages.push({ role: 'bot', text: '\\u23F3 Alan p\\u0159em\\u00FD\\u0161l\\u00ED...', _pending: true });\n"
            "  if (input) input.value = '';\n"
            "  renderAiChat();\n"
            "\n"
            "  var headers = { 'Content-Type': 'application/json' };\n"
            "  var tk = sessionStorage.getItem('token');\n"
            "  if (tk) headers['Authorization'] = 'Bearer ' + tk;\n"
            "\n"
            "  var requestBody = JSON.stringify({\n"
            "    message: text,\n"
            "    history: _aiChatState.history || [],\n"
            "    draft: _aiChatState.draft || {},\n"
            "    page_context: { path: _aiChatState.pagePath, title: _aiChatState.pageTitle },\n"
            "  });\n"
            "\n"
            "  // Auto-retry s exponential backoff (max 4 pokusy, 2/4/8/15 s)\n"
            "  function attemptDraftChat(attempt) {\n"
            "    if (attempt > 1) {\n"
            "      var pendingMsg = _aiChatState.messages.find(function(m) { return m._pending; });\n"
            "      if (pendingMsg) pendingMsg.text = '\\u23F3 Alan p\\u0159em\\u00FD\\u0161l\\u00ED... (pokus ' + attempt + '/4)';\n"
            "      renderAiChat();\n"
            "    }\n"
            "    return fetch('/api/admin-tasks/draft-chat', {\n"
            "      method: 'POST',\n"
            "      credentials: 'include',\n"
            "      headers: headers,\n"
            "      body: requestBody,\n"
            "    }).then(function(r) {\n"
            "      if (!r.ok) {\n"
            "        return r.json().catch(function() { return {}; }).then(function(body) {\n"
            "          var err = new Error(body.error || ('HTTP ' + r.status));\n"
            "          err._retryable = body.retryable === true || r.status === 429 || r.status === 503 || r.status === 504;\n"
            "          err._retryAfter = body.retry_after ? body.retry_after * 1000 : null;\n"
            "          throw err;\n"
            "        });\n"
            "      }\n"
            "      return r.json();\n"
            "    }).then(function(data) {\n"
            "      _aiChatState._inFlight = false;\n"
            "      _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "      _aiChatState.messages.push({ role: 'bot', text: data.ai_message || '(Alan: bez textu)' });\n"
            "      if (data.draft) _aiChatState.draft = data.draft;\n"
            "      if (data.history) _aiChatState.history = data.history;\n"
            "      if (data.finalized) { _aiChatState.finalized = true; _aiChatState.summary = data.summary; }\n"
            "      if (data.escalate) { _aiChatState.escalateReason = data.escalate_reason; }\n"
            "      renderAiChat();\n"
            "    }).catch(function(e) {\n"
            "      var retryable = e._retryable || /Failed to fetch|NetworkError|429|503|504/.test(e.message);\n"
            "      var retryAfter = e._retryAfter || Math.min(2000 * Math.pow(2, attempt - 1), 15000);\n"
            "      if (retryable && attempt < 4) {\n"
            "        return new Promise(function(resolve) {\n"
            "          setTimeout(function() { resolve(attemptDraftChat(attempt + 1)); }, retryAfter);\n"
            "        });\n"
            "      }\n"
            "      _aiChatState._inFlight = false;\n"
            "      _aiChatState.messages = _aiChatState.messages.filter(function(m) { return !m._pending; });\n"
            "      var userFriendly = retryable\n"
            "        ? '\\u26A0\\uFE0F AI je momentálně přetížený. Zkus to za chvíli — text máš zpět v poli.'\n"
            "        : '\\u26A0\\uFE0F Chyba: ' + e.message;\n"
            "      _aiChatState.messages.push({ role: 'bot', text: userFriendly });\n"
            "      if (input && _aiChatState._lastUserText) input.value = _aiChatState._lastUserText;\n"
            "      renderAiChat();\n"
            "    });\n"
            "  }\n"
            "\n"
            "  attemptDraftChat(1);\n"
            "}",
        ),
    ],
)

print("\n✅ Hotovo. Zkontroluj `git diff` a commitni.")
