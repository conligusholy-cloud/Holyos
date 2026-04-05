/* ============================================
   ai-assistant.js — AI Voice Assistant for HOLYOS
   Web Speech API (STT) + SpeechSynthesis (TTS)
   ============================================ */

(function() {
  'use strict';

  // State
  var isOpen = false;
  var isListening = false;
  var isProcessing = false;
  var recognition = null;
  var currentModule = '';
  var messages = [];
  var speechSynth = window.speechSynthesis;

  // Detect current module from URL
  var pathMatch = window.location.pathname.match(/modules\/([^/]+)/);
  currentModule = pathMatch ? pathMatch[1] : 'hlavní stránka';

  // Check browser support
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var hasSpeech = !!SpeechRecognition;

  // ---- Inject CSS ----
  var style = document.createElement('style');
  style.textContent = `
    /* AI Assistant Floating Button */
    .ai-fab {
      position: fixed; bottom: 28px; right: 28px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #6C5CE7, #0984E3);
      border: none; cursor: pointer; color: #fff;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(108,92,231,0.4);
      transition: transform 0.2s, box-shadow 0.2s;
      font-size: 24px;
    }
    .ai-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(108,92,231,0.55); }
    .ai-fab.listening {
      animation: ai-pulse 1.5s ease-in-out infinite;
      background: linear-gradient(135deg, #ef4444, #f59e0b);
    }
    @keyframes ai-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
      50% { box-shadow: 0 0 0 18px rgba(239,68,68,0); }
    }
    .ai-fab svg { width: 26px; height: 26px; fill: currentColor; }

    /* Chat Panel */
    .ai-panel {
      position: fixed; bottom: 96px; right: 28px; z-index: 9998;
      width: 400px; max-height: 70vh;
      background: var(--surface, #282840); border: 1px solid var(--border, #3a3a5c);
      border-radius: 16px; display: none; flex-direction: column;
      box-shadow: 0 12px 48px rgba(0,0,0,0.4);
      overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .ai-panel.open { display: flex; }

    .ai-panel-header {
      padding: 16px 20px; display: flex; align-items: center; gap: 12px;
      background: linear-gradient(135deg, #6C5CE7, #0984E3);
      color: #fff;
    }
    .ai-panel-header h3 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
    .ai-panel-close {
      background: rgba(255,255,255,0.2); border: none; color: #fff;
      width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
      font-size: 14px; display: flex; align-items: center; justify-content: center;
    }
    .ai-panel-close:hover { background: rgba(255,255,255,0.3); }

    .ai-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;
      min-height: 200px; max-height: 50vh;
    }
    .ai-msg {
      padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5;
      max-width: 85%; word-wrap: break-word;
    }
    .ai-msg.user {
      align-self: flex-end; background: #6C5CE7; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .ai-msg.assistant {
      align-self: flex-start; background: var(--surface2, #32324e); color: var(--text, #e0e0e0);
      border-bottom-left-radius: 4px;
    }
    .ai-msg.system {
      align-self: center; color: var(--text2, #8888aa); font-size: 12px;
      font-style: italic; background: none; padding: 4px;
    }
    .ai-msg.error { color: #ef4444; }

    .ai-input-row {
      padding: 12px 16px; display: flex; gap: 8px; align-items: center;
      border-top: 1px solid var(--border, #3a3a5c);
      background: var(--bg, #1e1e2e);
    }
    .ai-input {
      flex: 1; background: var(--surface, #282840); border: 1px solid var(--border, #3a3a5c);
      border-radius: 24px; padding: 10px 16px; color: var(--text, #e0e0e0);
      font-size: 14px; outline: none; font-family: inherit;
    }
    .ai-input:focus { border-color: #6C5CE7; }
    .ai-input::placeholder { color: var(--text2, #8888aa); }

    .ai-mic-btn {
      width: 40px; height: 40px; border-radius: 50%; border: none;
      background: var(--surface2, #32324e); color: var(--text, #e0e0e0);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .ai-mic-btn:hover { background: #6C5CE7; color: #fff; }
    .ai-mic-btn.active { background: #ef4444; color: #fff; animation: ai-pulse 1.5s ease-in-out infinite; }
    .ai-mic-btn svg { width: 20px; height: 20px; fill: currentColor; }

    .ai-send-btn {
      width: 40px; height: 40px; border-radius: 50%; border: none;
      background: #6C5CE7; color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .ai-send-btn:hover { background: #5a4bd6; }
    .ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .ai-send-btn svg { width: 18px; height: 18px; fill: currentColor; }

    .ai-typing { display: flex; gap: 4px; padding: 8px 14px; }
    .ai-typing span {
      width: 8px; height: 8px; background: var(--text2, #8888aa);
      border-radius: 50%; animation: ai-bounce 1.4s ease-in-out infinite;
    }
    .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
    .ai-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes ai-bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    /* Sound wave visualizer */
    .ai-wave {
      display: flex; align-items: center; justify-content: center; gap: 3px;
      height: 24px; margin: 0 8px;
    }
    .ai-wave span {
      width: 3px; background: #fff; border-radius: 2px;
      animation: ai-wave-bar 0.8s ease-in-out infinite;
    }
    .ai-wave span:nth-child(1) { height: 8px; animation-delay: 0s; }
    .ai-wave span:nth-child(2) { height: 16px; animation-delay: 0.1s; }
    .ai-wave span:nth-child(3) { height: 24px; animation-delay: 0.2s; }
    .ai-wave span:nth-child(4) { height: 16px; animation-delay: 0.3s; }
    .ai-wave span:nth-child(5) { height: 8px; animation-delay: 0.4s; }
    @keyframes ai-wave-bar {
      0%, 100% { transform: scaleY(0.4); }
      50% { transform: scaleY(1); }
    }

    /* Welcome screen */
    .ai-welcome {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 32px 24px; text-align: center; color: var(--text2, #8888aa);
    }
    .ai-welcome-icon { font-size: 48px; margin-bottom: 12px; }
    .ai-welcome h4 { color: var(--text, #e0e0e0); margin: 0 0 8px; font-size: 16px; }
    .ai-welcome p { margin: 0 0 16px; font-size: 13px; line-height: 1.5; }
    .ai-welcome-hints { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    .ai-hint {
      background: var(--surface2, #32324e); border: 1px solid var(--border, #3a3a5c);
      border-radius: 10px; padding: 10px 14px; font-size: 13px; cursor: pointer;
      color: var(--text, #e0e0e0); text-align: left; transition: border-color 0.2s;
    }
    .ai-hint:hover { border-color: #6C5CE7; }

    /* Mobile */
    @media (max-width: 500px) {
      .ai-panel { width: calc(100vw - 24px); right: 12px; bottom: 84px; }
      .ai-fab { bottom: 16px; right: 16px; width: 50px; height: 50px; }
    }

    /* TTS indicator */
    .ai-tts-btn {
      background: none; border: none; cursor: pointer; padding: 2px 6px;
      font-size: 16px; opacity: 0.5; transition: opacity 0.2s;
    }
    .ai-tts-btn:hover { opacity: 1; }
  `;
  document.head.appendChild(style);

  // ---- SVG Icons ----
  var micIcon = '<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
  var sendIcon = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var aiIcon = '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a2 2 0 110 4h-1.17A7 7 0 0113 23h-2a7 7 0 01-6.83-5H3a2 2 0 110-4h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-1 9a5 5 0 00-5 5 5 5 0 005 5h2a5 5 0 005-5 5 5 0 00-5-5h-2zm-1 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm4 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>';
  var stopIcon = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';

  // ---- Create DOM Elements ----
  // Floating button
  var fab = document.createElement('button');
  fab.className = 'ai-fab';
  fab.title = 'AI Asistent (hlasové ovládání)';
  fab.innerHTML = aiIcon;
  fab.onclick = togglePanel;
  document.body.appendChild(fab);

  // Chat panel
  var panel = document.createElement('div');
  panel.className = 'ai-panel';
  panel.innerHTML = `
    <div class="ai-panel-header">
      <span style="font-size:20px">&#129302;</span>
      <h3>AI Asistent</h3>
      <button class="ai-panel-close" onclick="this.closest('.ai-panel').classList.remove('open')" title="Zavřít">&#10005;</button>
    </div>
    <div class="ai-messages" id="ai-messages"></div>
    <div class="ai-input-row">
      <button class="ai-mic-btn" id="ai-mic-btn" title="Mluvit">${micIcon}</button>
      <input class="ai-input" id="ai-input" type="text" placeholder="Napište nebo mluvte..." autocomplete="off" />
      <button class="ai-send-btn" id="ai-send-btn" title="Odeslat">${sendIcon}</button>
    </div>
  `;
  document.body.appendChild(panel);

  // Close button fix
  panel.querySelector('.ai-panel-close').onclick = function() { togglePanel(); };

  // ---- Message area ----
  var messagesEl = document.getElementById('ai-messages');
  var inputEl = document.getElementById('ai-input');
  var micBtn = document.getElementById('ai-mic-btn');
  var sendBtn = document.getElementById('ai-send-btn');

  // Show welcome
  showWelcome();

  // ---- Event handlers ----
  sendBtn.onclick = function() { sendMessage(); };
  inputEl.onkeydown = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  micBtn.onclick = function() { toggleListening(); };

  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen) {
      inputEl.focus();
      if (messages.length === 0) showWelcome();
    } else {
      stopListening();
    }
  }

  function showWelcome() {
    messagesEl.innerHTML = `
      <div class="ai-welcome">
        <div class="ai-welcome-icon">&#129302;</div>
        <h4>Ahoj! Jsem tvůj AI asistent.</h4>
        <p>Zeptej se mě na cokoliv o systému HOLYOS, nebo mi řekni co mám udělat.${hasSpeech ? ' Můžeš mluvit i psát.' : ' Napiš svůj dotaz.'}</p>
        <div class="ai-welcome-hints">
          <div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Kolik máme zboží na skladě?</div>
          <div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Kolik máme zaměstnanců?</div>
          <div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Jaké objednávky jsou otevřené?</div>
          <div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Které položky jsou pod minimálním stavem?</div>
        </div>
      </div>
    `;
  }

  // Global helper for hints
  window._aiSendHint = function(text) {
    inputEl.value = text;
    sendMessage();
  };

  // ---- Speech Recognition ----
  function initRecognition() {
    if (!hasSpeech || recognition) return;
    recognition = new SpeechRecognition();
    recognition.lang = 'cs-CZ';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = function() {
      isListening = true;
      micBtn.classList.add('active');
      fab.classList.add('listening');
      micBtn.innerHTML = stopIcon;
      addMessage('system', 'Poslouchám...');
    };

    recognition.onresult = function(e) {
      var transcript = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      inputEl.value = transcript;
      // If final result, send it
      if (e.results[e.results.length - 1].isFinal) {
        stopListening();
        sendMessage();
      }
    };

    recognition.onerror = function(e) {
      console.warn('Speech recognition error:', e.error);
      if (e.error === 'not-allowed') {
        addMessage('system error', 'Přístup k mikrofonu byl zamítnut. Povolte mikrofon v nastavení prohlížeče.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        addMessage('system', 'Nezachytil jsem žádnou řeč. Zkuste to znovu.');
      }
      stopListening();
    };

    recognition.onend = function() {
      stopListening();
    };
  }

  function toggleListening() {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }

  function startListening() {
    if (!hasSpeech) {
      addMessage('system error', 'Váš prohlížeč nepodporuje rozpoznávání řeči. Použijte Chrome.');
      return;
    }
    // Stop any TTS
    speechSynth.cancel();
    initRecognition();
    try {
      recognition.start();
    } catch(e) {
      // Already started
    }
  }

  function stopListening() {
    isListening = false;
    micBtn.classList.remove('active');
    fab.classList.remove('listening');
    micBtn.innerHTML = micIcon;
    if (recognition) {
      try { recognition.stop(); } catch(e) {}
    }
    // Remove "Poslouchám..." system messages
    var sysMsg = messagesEl.querySelectorAll('.ai-msg.system');
    sysMsg.forEach(function(el) {
      if (el.textContent === 'Poslouchám...') el.remove();
    });
  }

  // ---- Send Message ----
  function sendMessage() {
    var text = (inputEl.value || '').trim();
    if (!text || isProcessing) return;

    // Clear welcome if first message
    if (messages.length === 0) messagesEl.innerHTML = '';

    addMessage('user', text);
    inputEl.value = '';
    isProcessing = true;
    sendBtn.disabled = true;

    // Show typing indicator
    var typingEl = document.createElement('div');
    typingEl.className = 'ai-msg assistant';
    typingEl.innerHTML = '<div class="ai-typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    fetch('/api/ai/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, context: currentModule })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      typingEl.remove();
      if (data.error) {
        addMessage('assistant error', 'Chyba: ' + data.error);
      } else {
        var response = data.response || 'Omlouvám se, nepodařilo se zpracovat odpověď.';
        addMessage('assistant', response);
        // TTS — read out the response
        speak(response);
      }
    })
    .catch(function(e) {
      typingEl.remove();
      addMessage('assistant error', 'Nepodařilo se spojit se serverem. Zkuste to znovu.');
    })
    .finally(function() {
      isProcessing = false;
      sendBtn.disabled = false;
    });
  }

  // ---- Add message to chat ----
  function addMessage(type, text) {
    var cls = type.includes('user') ? 'user' : type.includes('system') ? 'system' : 'assistant';
    if (type.includes('error')) cls += ' error';
    var el = document.createElement('div');
    el.className = 'ai-msg ' + cls;
    el.textContent = text;

    // Add TTS button for assistant messages
    if (cls === 'assistant' && !type.includes('error')) {
      var ttsBtn = document.createElement('button');
      ttsBtn.className = 'ai-tts-btn';
      ttsBtn.innerHTML = '&#128264;';
      ttsBtn.title = 'Přečíst nahlas';
      ttsBtn.onclick = function(e) { e.stopPropagation(); speak(text); };
      el.appendChild(ttsBtn);
    }

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    messages.push({ role: cls, text: text });
    return el;
  }

  // ---- Text-to-Speech ----
  function speak(text) {
    if (!speechSynth) return;
    speechSynth.cancel();
    // Clean text for speech
    var clean = text.replace(/[#*_`]/g, '').replace(/\n+/g, '. ');
    var utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'cs-CZ';
    utterance.rate = 1.05;
    utterance.pitch = 1;
    // Try to find Czech voice
    var voices = speechSynth.getVoices();
    var czVoice = voices.find(function(v) { return v.lang.startsWith('cs'); });
    if (czVoice) utterance.voice = czVoice;
    speechSynth.speak(utterance);
  }

  // Pre-load voices
  if (speechSynth) {
    speechSynth.getVoices();
    speechSynth.onvoiceschanged = function() { speechSynth.getVoices(); };
  }

  // ---- Keyboard shortcut: Ctrl+Shift+A to toggle ----
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      togglePanel();
    }
  });

})();
