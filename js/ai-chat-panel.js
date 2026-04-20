/* ============================================
   ai-chat-panel.js — Plovoucí AI chat panel
   Fáze 5: specializovaní asistenti, markdown,
   historie, klávesové zkratky, zdroj dat
   ============================================ */

(function() {
  'use strict';

  // Zamezení dvojitému načtení
  if (window.__aiChatPanelLoaded) return;
  window.__aiChatPanelLoaded = true;

  // --- Stav ---
  let isOpen = false;
  let history = [];
  let isLoading = false;
  let currentModule = detectModule();
  let assistants = [];
  let selectedAssistant = null; // null = auto
  let conversations = [];
  let currentConversationId = null;
  let markedReady = false;

  // --- Detekce aktuálního modulu ---
  function detectModule() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('hr') || path.includes('lid')) return 'Lidé a HR';
    if (path.includes('sklad') || path.includes('warehouse')) return 'Nákup a sklad';
    if (path.includes('pracovni-postup')) return 'Pracovní postup';
    if (path.includes('programovani')) return 'Programování výroby';
    if (path.includes('simulace')) return 'Simulace výroby';
    if (path.includes('datovy-model')) return 'Datový model';
    if (path.includes('vytvoreni-arealu')) return 'Vytvoření areálu';
    if (path.includes('mindmap')) return 'Mindmapa';
    return 'Dashboard';
  }

  // --- Načtení marked.js pro markdown rendering ---
  function loadMarked() {
    if (window.marked) { markedReady = true; return Promise.resolve(); }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js';
      script.onload = () => { markedReady = true; resolve(); };
      script.onerror = () => resolve(); // graceful fallback
      document.head.appendChild(script);
    });
  }

  // --- CSS ---
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #ai-chat-fab {
        position: fixed; bottom: 24px; right: 24px; z-index: 9999;
        width: 56px; height: 56px; border-radius: 50%;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        border: none; cursor: pointer; box-shadow: 0 4px 20px rgba(99,102,241,0.4);
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #ai-chat-fab:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(99,102,241,0.6); }
      #ai-chat-fab svg { width: 28px; height: 28px; fill: white; }
      #ai-chat-fab .shortcut-hint {
        position: absolute; bottom: -20px; font-size: 10px; color: #9ca3af;
        white-space: nowrap; pointer-events: none;
      }

      #ai-chat-panel {
        position: fixed; bottom: 90px; right: 24px; z-index: 9998;
        width: 420px; max-height: 600px; border-radius: 16px;
        background: #1a1b23; border: 1px solid #2a2d35;
        box-shadow: 0 12px 48px rgba(0,0,0,0.5);
        display: none; flex-direction: column; overflow: hidden;
        font-family: 'Segoe UI', system-ui, sans-serif;
      }
      #ai-chat-panel.open { display: flex; animation: slideUp 0.25s ease; }
      @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }

      /* Header */
      #ai-chat-header {
        padding: 12px 16px; display: flex; align-items: center; gap: 10px;
        background: linear-gradient(135deg, #6366f1, #7c3aed);
        border-radius: 16px 16px 0 0; flex-shrink: 0;
      }
      #ai-chat-header .avatar { width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; font-size:18px; }
      #ai-chat-header .info { flex:1; }
      #ai-chat-header .info .name { color:#fff; font-size:14px; font-weight:600; }
      #ai-chat-header .info .status { color:rgba(255,255,255,0.7); font-size:11px; }
      .header-actions { display: flex; gap: 4px; }
      .header-actions button {
        background: rgba(255,255,255,0.1); border: none; color: rgba(255,255,255,0.8);
        cursor: pointer; font-size: 14px; padding: 4px 8px; border-radius: 6px;
        transition: background 0.2s;
      }
      .header-actions button:hover { background: rgba(255,255,255,0.2); color: #fff; }

      /* Assistant selector */
      #ai-assistant-selector {
        padding: 6px 12px; border-top: none; border-bottom: 1px solid #2a2d35;
        background: #1e1f27; display: flex; gap: 6px; overflow-x: auto;
        flex-shrink: 0;
      }
      #ai-assistant-selector::-webkit-scrollbar { height: 3px; }
      #ai-assistant-selector::-webkit-scrollbar-thumb { background: #3a3d45; border-radius: 3px; }
      .assistant-chip {
        padding: 4px 10px; border-radius: 12px; font-size: 11px;
        background: #252830; color: #a5b4fc; border: 1px solid #3a3d45;
        cursor: pointer; white-space: nowrap; transition: all 0.2s;
        display: flex; align-items: center; gap: 4px;
      }
      .assistant-chip:hover { border-color: #6366f1; }
      .assistant-chip.active { background: #6366f1; color: #fff; border-color: #6366f1; }
      .assistant-chip .chip-icon { font-size: 13px; }

      /* Messages */
      #ai-chat-messages {
        flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;
        min-height: 280px; max-height: 360px;
      }
      #ai-chat-messages::-webkit-scrollbar { width: 4px; }
      #ai-chat-messages::-webkit-scrollbar-thumb { background: #3a3d45; border-radius: 4px; }

      .chat-msg { max-width: 88%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6; word-wrap: break-word; }
      .chat-msg.user { align-self: flex-end; background: #6366f1; color: #fff; border-bottom-right-radius: 4px; }
      .chat-msg.assistant { align-self: flex-start; background: #252830; color: #e2e4e9; border-bottom-left-radius: 4px; border: 1px solid #2a2d35; }
      .chat-msg.system { align-self: center; background: transparent; color: #6b7280; font-size: 11px; text-align: center; padding: 4px; }

      /* Markdown styles in assistant messages */
      .chat-msg.assistant strong { color: #a5b4fc; }
      .chat-msg.assistant table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
      .chat-msg.assistant td, .chat-msg.assistant th { border: 1px solid #3a3d45; padding: 4px 8px; text-align: left; }
      .chat-msg.assistant th { background: #2a2d35; color: #a5b4fc; font-weight: 600; }
      .chat-msg.assistant code { background: #1e1f27; padding: 2px 5px; border-radius: 3px; font-size: 12px; font-family: 'Cascadia Code', 'Fira Code', monospace; }
      .chat-msg.assistant pre { background: #1e1f27; padding: 8px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
      .chat-msg.assistant pre code { padding: 0; background: none; }
      .chat-msg.assistant ul, .chat-msg.assistant ol { margin: 4px 0; padding-left: 20px; }
      .chat-msg.assistant li { margin: 2px 0; }
      .chat-msg.assistant a { color: #818cf8; }
      .chat-msg.assistant h1, .chat-msg.assistant h2, .chat-msg.assistant h3 { font-size: 14px; color: #a5b4fc; margin: 8px 0 4px; }

      /* Assistant badge */
      .chat-msg-meta {
        display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
      }
      .assistant-badge {
        font-size: 10px; padding: 2px 8px; border-radius: 8px;
        background: rgba(99,102,241,0.15); color: #818cf8; font-weight: 500;
      }

      /* Sources badge */
      .sources-badge {
        font-size: 10px; color: #6b7280; margin-top: 4px;
        display: flex; align-items: center; gap: 4px;
      }

      /* Typing indicator */
      .chat-typing { display: flex; gap: 4px; padding: 10px 14px; }
      .chat-typing span { width: 6px; height: 6px; border-radius: 50%; background: #6366f1; animation: bounce 1.2s infinite; }
      .chat-typing span:nth-child(2) { animation-delay: 0.15s; }
      .chat-typing span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-8px)} }

      /* Suggestions */
      .chat-suggestions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 10px; flex-shrink: 0; }
      .chat-suggestion {
        padding: 5px 10px; border-radius: 14px; font-size: 11px;
        background: #252830; color: #a5b4fc; border: 1px solid #3a3d45;
        cursor: pointer; transition: background 0.2s;
      }
      .chat-suggestion:hover { background: #6366f1; color: #fff; border-color: #6366f1; }

      /* Input area */
      #ai-chat-input-area {
        padding: 10px 16px; border-top: 1px solid #2a2d35; display: flex; gap: 8px; align-items: center;
        flex-shrink: 0;
      }
      #ai-chat-input {
        flex: 1; background: #252830; border: 1px solid #3a3d45; border-radius: 10px;
        padding: 10px 14px; color: #e2e4e9; font-size: 13px; outline: none; resize: none;
        font-family: inherit; min-height: 20px; max-height: 80px;
      }
      #ai-chat-input:focus { border-color: #6366f1; }
      #ai-chat-input::placeholder { color: #6b7280; }
      #ai-chat-send {
        width: 36px; height: 36px; border-radius: 50%; border: none; cursor: pointer;
        background: #6366f1; color: #fff; display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; flex-shrink: 0;
      }
      #ai-chat-send:hover { background: #5558e6; }
      #ai-chat-send:disabled { background: #3a3d45; cursor: not-allowed; }
      #ai-chat-send svg { width: 18px; height: 18px; fill: currentColor; }

      /* History sidebar */
      #ai-chat-history {
        display: none; flex-direction: column; background: #1e1f27;
        border-right: 1px solid #2a2d35; width: 100%; max-height: 300px;
      }
      #ai-chat-history.visible { display: flex; }
      #ai-chat-history .history-header {
        padding: 10px 14px; font-size: 12px; font-weight: 600; color: #a5b4fc;
        border-bottom: 1px solid #2a2d35; display: flex; justify-content: space-between; align-items: center;
      }
      #ai-chat-history .history-list { overflow-y: auto; flex: 1; }
      .history-item {
        padding: 8px 14px; font-size: 12px; color: #9ca3af; cursor: pointer;
        border-bottom: 1px solid #1a1b23; transition: background 0.15s;
        display: flex; justify-content: space-between; align-items: center;
      }
      .history-item:hover { background: #252830; color: #e2e4e9; }
      .history-item.active { background: #2a2d35; color: #a5b4fc; }
      .history-item .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .history-item .date { font-size: 10px; color: #6b7280; margin-left: 8px; white-space: nowrap; }
      .conv-item {
        padding: 8px 14px; font-size: 12px; color: #9ca3af; cursor: pointer;
        border-bottom: 1px solid #1a1b23; display: flex; align-items: center; gap: 6px;
        transition: background 0.15s;
      }
      .conv-item:hover { background: #252830; color: #e2e4e9; }
    `;
    document.head.appendChild(style);
  }

  // --- HTML ---
  function injectHTML() {
    // FAB button
    const fab = document.createElement('button');
    fab.id = 'ai-chat-fab';
    fab.title = 'AI Asistent (Ctrl+K)';
    fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg><span class="shortcut-hint">Ctrl+K</span>';
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'ai-chat-panel';
    panel.innerHTML = `
      <div id="ai-chat-header">
        <div class="avatar" id="ai-chat-avatar">🤖</div>
        <div class="info">
          <div class="name" id="ai-chat-name">HolyOS AI</div>
          <div class="status" id="ai-chat-status">${currentModule}</div>
        </div>
        <div class="header-actions">
          <button id="ai-btn-history" title="Historie konverzací">📋</button>
          <button id="ai-btn-new" title="Nová konverzace">➕</button>
          <button id="ai-btn-export" title="Export konverzace">📥</button>
          <button id="ai-btn-close" title="Zavřít (Esc)">✕</button>
        </div>
      </div>
      <div id="ai-assistant-selector"></div>
      <div id="ai-chat-history">
        <div class="history-header">
          <span>Historie konverzací</span>
          <button id="ai-btn-history-close" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:14px;">✕</button>
        </div>
        <div class="history-list" id="ai-history-list"></div>
      </div>
      <div id="ai-chat-messages">
        <div class="chat-msg system">Zeptej se mě na cokoliv o datech v systému</div>
      </div>
      <div class="chat-suggestions" id="ai-chat-suggestions"></div>
      <div id="ai-chat-input-area">
        <button id="ai-chat-save-task" title="Uložit jako požadavek" style="width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;background:rgba(167,139,250,0.15);color:#a78bfa;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;transition:background 0.2s;">📋</button>
        <textarea id="ai-chat-input" placeholder="Napiš zprávu... (Enter = odeslat)" rows="1"></textarea>
        <button id="ai-chat-send" title="Odeslat">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    `;
    document.body.appendChild(panel);

    // Event listeners
    document.getElementById('ai-chat-send').addEventListener('click', sendMessage);
    document.getElementById('ai-chat-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    document.getElementById('ai-chat-input').addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 80) + 'px';
    });
    document.getElementById('ai-btn-close').addEventListener('click', () => closePanel());
    document.getElementById('ai-btn-new').addEventListener('click', newConversation);
    document.getElementById('ai-btn-history').addEventListener('click', toggleHistory);
    document.getElementById('ai-btn-history-close').addEventListener('click', toggleHistory);
    document.getElementById('ai-btn-export').addEventListener('click', exportConversation);
    const saveTaskBtn = document.getElementById('ai-chat-save-task');
    if (saveTaskBtn) saveTaskBtn.addEventListener('click', saveAsTask);

    // Klávesové zkratky
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        togglePanel();
      }
      if (e.key === 'Escape' && isOpen) {
        closePanel();
      }
    });

    // Načíst asistenty a návrhy
    loadAssistants();
    loadSuggestions();
  }

  // --- Panel toggle ---
  function togglePanel() {
    isOpen ? closePanel() : openPanel();
  }

  function openPanel() {
    const panel = document.getElementById('ai-chat-panel');
    isOpen = true;
    panel.classList.add('open');
    document.getElementById('ai-chat-input').focus();
  }

  function closePanel() {
    const panel = document.getElementById('ai-chat-panel');
    isOpen = false;
    panel.classList.remove('open');
    // Skrýt historii
    document.getElementById('ai-chat-history').classList.remove('visible');
  }

  // --- Konverzace z DB ---
  async function loadConversations() {
    try {
      const resp = await fetch('/api/ai/conversations', { credentials: 'include' });
      if (!resp.ok) return;
      conversations = await resp.json();
      renderConversationList();
    } catch (e) { /* bez historie */ }
  }

  function renderConversationList() {
    const histEl = document.getElementById('ai-chat-history');
    if (!histEl || conversations.length === 0) return;
    let html = '<div style="padding:8px 12px;font-size:11px;color:var(--text2,#a0a0c0);border-bottom:1px solid rgba(255,255,255,0.06);">Předchozí konverzace</div>';
    conversations.slice(0, 15).forEach(c => {
      const d = new Date(c.created_at).toLocaleDateString('cs-CZ', { day:'numeric', month:'short' });
      const active = c.id === currentConversationId ? ' style="background:rgba(139,92,246,0.15);"' : '';
      html += '<div class="conv-item"' + active + ' onclick="window.__loadConv(\'' + c.id + '\')">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (c.title || 'Konverzace') + '</span>' +
        '<span style="font-size:10px;color:var(--text2,#888);flex-shrink:0;">' + d + '</span></div>';
    });
    histEl.innerHTML = html;
  }

  window.__loadConv = async function(convId) {
    try {
      const resp = await fetch('/api/ai/conversations/' + convId, { credentials: 'include' });
      if (!resp.ok) return;
      const conv = await resp.json();
      currentConversationId = conv.id;

      // Vyčistit chat a načíst zprávy
      history = [];
      const msgEl = document.getElementById('ai-chat-messages');
      msgEl.innerHTML = '';

      (conv.messages || []).forEach(m => {
        addMessage(m.role, m.content);
        history.push({ role: m.role, content: m.content });
      });

      // Skrýt historii
      document.getElementById('ai-chat-history').classList.remove('visible');
      renderConversationList();
    } catch (e) { console.error('Load conv error:', e); }
  };

  // --- Asistenti ---
  async function loadAssistants() {
    try {
      const resp = await fetch('/api/ai/assistants-public', { credentials: 'include' });
      if (!resp.ok) {
        const r2 = await fetch('/api/ai/assistants', { credentials: 'include' });
        if (r2.ok) assistants = await r2.json();
      } else {
        assistants = await resp.json();
      }
      renderAssistantSelector();
    } catch (e) { /* fallback — bez selektoru */ }
  }

  function renderAssistantSelector() {
    const container = document.getElementById('ai-assistant-selector');
    if (!container || assistants.length === 0) return;

    let html = '<div class="assistant-chip active" data-slug="" title="Automatický výběr asistenta"><span class="chip-icon">🔄</span> Auto</div>';
    assistants.forEach(a => {
      html += `<div class="assistant-chip" data-slug="${a.slug}" title="${a.role}"><span class="chip-icon">${a.icon}</span> ${a.name}</div>`;
    });
    html += `<label class="assistant-chip" title="Multi-agent: více agentů spolupracuje na odpovědi" style="margin-left:auto;font-size:10px;gap:4px;">
      <input type="checkbox" id="ai-multi-toggle" style="width:12px;height:12px;margin:0;accent-color:#8b5cf6;">
      <span class="chip-icon">🧠</span> Multi
    </label>`;
    container.innerHTML = html;

    container.querySelectorAll('.assistant-chip').forEach(chip => {
      chip.addEventListener('click', function() {
        container.querySelectorAll('.assistant-chip').forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        selectedAssistant = this.dataset.slug || null;
        updateHeaderForAssistant();
      });
    });
  }

  function updateHeaderForAssistant() {
    const avatar = document.getElementById('ai-chat-avatar');
    const name = document.getElementById('ai-chat-name');
    if (selectedAssistant) {
      const a = assistants.find(a => a.slug === selectedAssistant);
      if (a) {
        avatar.textContent = a.icon;
        name.textContent = a.name;
      }
    } else {
      avatar.textContent = '🤖';
      name.textContent = 'HolyOS AI';
    }
  }

  // --- Návrhy ---
  async function loadSuggestions() {
    try {
      const resp = await fetch('/api/ai/capabilities');
      if (!resp.ok) return;
      const data = await resp.json();
      const container = document.getElementById('ai-chat-suggestions');
      if (!container || !data.examples) return;

      const shuffled = data.examples.sort(() => 0.5 - Math.random()).slice(0, 3);
      container.innerHTML = shuffled.map(ex =>
        `<button class="chat-suggestion">${ex}</button>`
      ).join('');

      container.querySelectorAll('.chat-suggestion').forEach(btn => {
        btn.addEventListener('click', function() {
          document.getElementById('ai-chat-input').value = this.textContent;
          sendMessage();
        });
      });
    } catch (e) { /* ignore */ }
  }

  // --- Odeslání zprávy ---
  async function sendMessage() {
    const input = document.getElementById('ai-chat-input');
    const text = (input ? input.value : '').trim();
    if (!text || isLoading) return;

    input.value = '';
    input.style.height = 'auto';

    // Skrýt návrhy
    const suggestions = document.getElementById('ai-chat-suggestions');
    if (suggestions) suggestions.style.display = 'none';

    // Přidat uživatelskou zprávu
    addMessage('user', text);
    history.push({ role: 'user', content: text });

    // Typing indicator
    isLoading = true;
    updateSendButton();
    let typingEl = null;
    try {
      typingEl = addTyping();
    } catch (e) { /* ignore */ }

    try {
      const headers = { 'Content-Type': 'application/json' };
      const t = sessionStorage.getItem('token');
      if (t) headers['Authorization'] = 'Bearer ' + t;

      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        credentials: 'include',
        headers: headers,
        body: JSON.stringify({
          message: text,
          module: currentModule,
          history: history.slice(-8),
          assistantSlug: selectedAssistant || undefined,
          multiAgent: document.getElementById('ai-multi-toggle')?.checked || false,
        }),
      });

      if (typingEl) typingEl.remove();

      const data = await resp.json();

      if (data.ok && data.response) {
        const assistantInfo = data.assistant || {};
        const sources = data.sources || {};
        addMessage('assistant', data.response, {
          assistantName: assistantInfo.name,
          assistantIcon: assistantInfo.icon,
          toolsUsed: data.toolsUsed,
          sources: sources,
          agents: data.agents,
          mcpServers: data.mcpServers,
          multiAgent: data.multiAgent,
          duration: data.duration,
        });
        history.push({ role: 'assistant', content: data.response });

        // Aktualizuj header pokud Auto
        if (!selectedAssistant && assistantInfo.name) {
          document.getElementById('ai-chat-avatar').textContent = assistantInfo.icon || '🤖';
          document.getElementById('ai-chat-name').textContent = assistantInfo.name;
        }
      } else {
        addMessage('assistant', 'Chyba: ' + (data.error || 'Neznámá chyba'));
      }
    } catch (e) {
      if (typingEl) try { typingEl.remove(); } catch(_) {}
      addMessage('assistant', '⚠️ AI momentálně nedostupné. Můžete svůj požadavek uložit kliknutím na 📋 vedle textového pole.');
      console.error('[AI Chat] sendMessage error:', e);
    } finally {
      isLoading = false;
      updateSendButton();
    }
  }

  // --- Přidání zprávy do chatu ---
  function addMessage(role, text, meta) {
    const container = document.getElementById('ai-chat-messages');
    const wrapper = document.createElement('div');

    if (role === 'assistant' && meta) {
      // Meta badge (asistent + skilly)
      const metaDiv = document.createElement('div');
      metaDiv.className = 'chat-msg-meta';
      if (meta.assistantName) {
        metaDiv.innerHTML = `<span class="assistant-badge">${meta.assistantIcon || '🤖'} ${meta.assistantName}</span>`;
      }
      wrapper.appendChild(metaDiv);
    }

    const msg = document.createElement('div');
    msg.className = 'chat-msg ' + role;

    if (role === 'assistant' && markedReady && window.marked) {
      // Markdown rendering
      try {
        msg.innerHTML = window.marked.parse(text);
      } catch (e) {
        msg.innerHTML = simpleFormat(text);
      }
    } else if (role === 'assistant') {
      msg.innerHTML = simpleFormat(text);
    } else {
      msg.innerHTML = escapeHtml(text);
    }

    wrapper.appendChild(msg);

    // Sources + MCP badge
    if (role === 'assistant' && meta) {
      if (meta.sources && meta.sources.skills && meta.sources.skills.length > 0) {
        const sourceDiv = document.createElement('div');
        sourceDiv.className = 'sources-badge';
        const skillNames = meta.sources.skills.join(', ');
        const count = meta.sources.recordCount || 0;
        sourceDiv.innerHTML = `📊 Zdroj: ${skillNames}${count > 0 ? ` (${count} záznamů)` : ''}`;
        wrapper.appendChild(sourceDiv);
      }

      // MCP + multi-agent info
      const infoParts = [];
      if (meta.mcpServers && meta.mcpServers.length > 0) {
        infoParts.push(`MCP: ${meta.mcpServers.join(', ')}`);
      }
      if (meta.multiAgent && meta.agents && meta.agents.length > 1) {
        infoParts.push(`Multi-agent: ${meta.agents.join(' + ')}`);
      }
      if (meta.duration) {
        infoParts.push(`${meta.duration}ms`);
      }
      if (infoParts.length > 0) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'sources-badge';
        infoDiv.style.opacity = '0.6';
        infoDiv.innerHTML = `⚡ ${infoParts.join(' · ')}`;
        wrapper.appendChild(infoDiv);
      }
    }

    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    return wrapper;
  }

  function simpleFormat(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function addTyping() {
    const container = document.getElementById('ai-chat-messages');
    const typing = document.createElement('div');
    typing.className = 'chat-msg assistant chat-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
    return typing;
  }

  function updateSendButton() {
    const btn = document.getElementById('ai-chat-send');
    if (btn) btn.disabled = isLoading;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Nová konverzace ---
  function newConversation() {
    history = [];
    currentConversationId = null;
    const container = document.getElementById('ai-chat-messages');
    container.innerHTML = '<div class="chat-msg system">Nová konverzace. Zeptej se mě na cokoliv.</div>';
    const suggestions = document.getElementById('ai-chat-suggestions');
    if (suggestions) { suggestions.style.display = 'flex'; loadSuggestions(); }
    // Reset assistant to auto
    if (!selectedAssistant) {
      document.getElementById('ai-chat-avatar').textContent = '🤖';
      document.getElementById('ai-chat-name').textContent = 'HolyOS AI';
    }
  }

  // --- Historie ---
  function toggleHistory() {
    const historyPanel = document.getElementById('ai-chat-history');
    historyPanel.classList.toggle('visible');
    if (historyPanel.classList.contains('visible')) {
      renderHistoryList();
    }
  }

  function renderHistoryList() {
    const list = document.getElementById('ai-history-list');
    if (history.length === 0) {
      list.innerHTML = '<div style="padding:16px;color:#6b7280;font-size:12px;text-align:center;">Zatím žádná historie</div>';
      return;
    }

    // Zobraz lokální historii jako konverzace
    const userMessages = history.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      list.innerHTML = '<div style="padding:16px;color:#6b7280;font-size:12px;text-align:center;">Zatím žádná historie</div>';
      return;
    }

    list.innerHTML = '<div class="history-item active"><span class="title">Aktuální konverzace (' + userMessages.length + ' zpráv)</span></div>';
  }

  // --- Export ---
  function exportConversation() {
    if (history.length === 0) return;

    const md = history.map(m => {
      const role = m.role === 'user' ? '**Vy**' : '**AI**';
      return `${role}: ${m.content}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holyos-chat-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Uložit konverzaci jako požadavek ---
  async function saveAsTask() {
    // Sebrat text z inputu (pokud není v historii) + celou historii
    const input = document.getElementById('ai-chat-input');
    const inputText = (input ? input.value.trim() : '');

    const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
    // Přidat text z inputu pokud ještě nebyl odeslán
    if (inputText && (userMessages.length === 0 || userMessages[userMessages.length - 1] !== inputText)) {
      userMessages.push(inputText);
    }

    if (userMessages.length === 0) {
      alert('Nejdřív napište svůj požadavek do textového pole.');
      return;
    }

    const conversationLog = history.length > 0
      ? history.map(m => (m.role === 'user' ? 'Uživatel: ' : 'AI: ') + m.content.replace(/<[^>]*>/g, '')).join('\n')
      : 'Uživatel: ' + inputText;

    const task = {
      page: window.location.pathname,
      page_title: document.title || currentModule,
      description: userMessages.join('\n---\n'),
      ai_questions: [],
      ai_answers: { conversation: conversationLog },
      priority: 'medium',
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      const t = sessionStorage.getItem('token');
      if (t) headers['Authorization'] = 'Bearer ' + t;

      const res = await fetch('/api/admin-tasks', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(task),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Chyba serveru');

      // Vyčistit input
      if (input) { input.value = ''; input.style.height = 'auto'; }

      addMessage('assistant', '✅ <strong>Požadavek #' + result.id + ' byl uložen!</strong><br>Najdete ho v sekci Super Admin → Požadavky.');
      history.push({ role: 'assistant', content: 'Požadavek #' + result.id + ' uložen.' });
    } catch (e) {
      alert('Chyba při ukládání požadavku: ' + e.message);
    }
  }

  // --- Veřejné API ---
  window.__aiChat = {
    toggle: togglePanel,
    open: openPanel,
    close: closePanel,
    askSuggestion: function(text) {
      document.getElementById('ai-chat-input').value = text;
      sendMessage();
    },
    selectAssistant: function(slug) {
      selectedAssistant = slug || null;
      updateHeaderForAssistant();
    },
  };

  // --- Inicializace ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    injectStyles();
    injectHTML();
    loadMarked();
    loadConversations();
  }
})();
