/* ============================================
   ai-assistant.js — AI Voice Assistant for HOLYOS
   Continuous listening + action execution + sidebar button
   ============================================ */

(function() {
  'use strict';

  var isOpen = false;
  var isListening = false;
  var isProcessing = false;
  var isSpeaking = false;
  var recognition = null;
  var currentModule = '';
  var messages = [];
  var speechSynth = window.speechSynthesis;
  var sessionActive = false; // continuous voice session

  var pathMatch = window.location.pathname.match(/modules\/([^/]+)/);
  currentModule = pathMatch ? pathMatch[1] : 'hlavní stránka';

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var hasSpeech = !!SpeechRecognition;

  // Module navigation map
  var NAV_MAP = {
    'lide': '/modules/lide-hr/index.html', 'hr': '/modules/lide-hr/index.html',
    'lidé': '/modules/lide-hr/index.html', 'zaměstnanc': '/modules/lide-hr/index.html',
    'docházk': '/modules/lide-hr/index.html', 'areál': '/modules/vytvoreni-arealu/simulace.html',
    'programování': '/modules/programovani-vyroby/simulace.html',
    'simulace': '/modules/simulace-vyroby/index.html',
    'pracovní postup': '/modules/pracovni-postup/index.html',
    'postup': '/modules/pracovni-postup/index.html',
    'nákup': '/modules/nakup-sklad/index.html', 'sklad': '/modules/nakup-sklad/index.html',
    'zboží': '/modules/nakup-sklad/index.html', 'materiál': '/modules/nakup-sklad/index.html',
    'objednávk': '/modules/nakup-sklad/index.html',
    'mindmap': '/modules/holyos-mindmap.html', 'myšlenkov': '/modules/holyos-mindmap.html',
    'hlavní': '/', 'domů': '/', 'přehled': '/',
  };

  // ---- CSS ----
  var style = document.createElement('style');
  style.textContent = `
    /* Sidebar AI button */
    .ai-sidebar-btn {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px; margin: 4px 12px 8px; border-radius: 10px;
      background: linear-gradient(135deg, #6C5CE7, #0984E3);
      color: #fff; border: none; cursor: pointer; font-size: 13px;
      font-weight: 600; transition: opacity 0.2s, transform 0.15s;
      width: calc(100% - 24px); text-align: left;
    }
    .ai-sidebar-btn:hover { opacity: 0.9; transform: scale(1.01); }
    .ai-sidebar-btn.active {
      background: linear-gradient(135deg, #ef4444, #f59e0b);
      animation: ai-glow 2s ease-in-out infinite;
    }
    .ai-sidebar-btn svg { width: 20px; height: 20px; fill: currentColor; flex-shrink: 0; }
    .ai-sidebar-btn .ai-btn-label { flex: 1; }
    .ai-sidebar-btn .ai-btn-wave {
      display: none; gap: 2px; align-items: center; height: 16px;
    }
    .ai-sidebar-btn.active .ai-btn-wave { display: flex; }
    .ai-sidebar-btn.active .ai-btn-label-text { display: none; }
    .ai-sidebar-btn .ai-btn-wave span {
      width: 2px; background: #fff; border-radius: 1px;
      animation: ai-bar 0.8s ease-in-out infinite;
    }
    .ai-sidebar-btn .ai-btn-wave span:nth-child(1) { height: 6px; animation-delay: 0s; }
    .ai-sidebar-btn .ai-btn-wave span:nth-child(2) { height: 12px; animation-delay: 0.1s; }
    .ai-sidebar-btn .ai-btn-wave span:nth-child(3) { height: 16px; animation-delay: 0.2s; }
    .ai-sidebar-btn .ai-btn-wave span:nth-child(4) { height: 12px; animation-delay: 0.3s; }
    .ai-sidebar-btn .ai-btn-wave span:nth-child(5) { height: 6px; animation-delay: 0.4s; }
    @keyframes ai-bar {
      0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); }
    }
    @keyframes ai-glow {
      0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.3); }
      50% { box-shadow: 0 0 20px rgba(239,68,68,0.6); }
    }

    /* Chat Panel — anchored bottom-left next to sidebar */
    .ai-panel {
      position: fixed; bottom: 16px; left: 266px; z-index: 9998;
      width: 420px; max-height: 75vh;
      background: var(--surface, #282840); border: 1px solid var(--border, #3a3a5c);
      border-radius: 16px; display: none; flex-direction: column;
      box-shadow: 0 12px 48px rgba(0,0,0,0.5);
      overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .ai-panel.open { display: flex; }

    .ai-panel-header {
      padding: 14px 18px; display: flex; align-items: center; gap: 10px;
      background: linear-gradient(135deg, #6C5CE7, #0984E3); color: #fff;
    }
    .ai-panel-header h3 { margin: 0; font-size: 14px; font-weight: 600; flex: 1; }
    .ai-status {
      font-size: 11px; opacity: 0.8; padding: 2px 8px;
      background: rgba(255,255,255,0.15); border-radius: 10px;
    }
    .ai-panel-close {
      background: rgba(255,255,255,0.2); border: none; color: #fff;
      width: 26px; height: 26px; border-radius: 50%; cursor: pointer;
      font-size: 13px; display: flex; align-items: center; justify-content: center;
    }
    .ai-panel-close:hover { background: rgba(255,255,255,0.3); }

    .ai-messages {
      flex: 1; overflow-y: auto; padding: 14px; display: flex;
      flex-direction: column; gap: 10px; min-height: 180px; max-height: 55vh;
    }
    .ai-msg {
      padding: 9px 13px; border-radius: 12px; font-size: 13px; line-height: 1.5;
      max-width: 88%; word-wrap: break-word;
    }
    .ai-msg.user {
      align-self: flex-end; background: #6C5CE7; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .ai-msg.assistant {
      align-self: flex-start; background: var(--surface2, #32324e);
      color: var(--text, #e0e0e0); border-bottom-left-radius: 4px;
    }
    .ai-msg.system {
      align-self: center; color: var(--text2, #8888aa); font-size: 11px;
      font-style: italic; background: none; padding: 3px;
    }
    .ai-msg.error { color: #ef4444; }
    .ai-msg.action-msg {
      background: rgba(108,92,231,0.15); border: 1px solid rgba(108,92,231,0.3);
      color: #a78bfa; font-size: 12px; cursor: pointer;
    }
    .ai-msg.action-msg:hover { background: rgba(108,92,231,0.25); }

    .ai-input-row {
      padding: 10px 14px; display: flex; gap: 8px; align-items: center;
      border-top: 1px solid var(--border, #3a3a5c); background: var(--bg, #1e1e2e);
    }
    .ai-input {
      flex: 1; background: var(--surface, #282840); border: 1px solid var(--border, #3a3a5c);
      border-radius: 24px; padding: 9px 14px; color: var(--text, #e0e0e0);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .ai-input:focus { border-color: #6C5CE7; }
    .ai-input::placeholder { color: var(--text2, #8888aa); }

    .ai-mic-btn, .ai-send-btn {
      width: 36px; height: 36px; border-radius: 50%; border: none;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .ai-mic-btn {
      background: var(--surface2, #32324e); color: var(--text, #e0e0e0);
    }
    .ai-mic-btn:hover { background: #6C5CE7; color: #fff; }
    .ai-mic-btn.active { background: #ef4444; color: #fff; }
    .ai-mic-btn svg, .ai-send-btn svg { width: 18px; height: 18px; fill: currentColor; }

    .ai-send-btn { background: #6C5CE7; color: #fff; }
    .ai-send-btn:hover { background: #5a4bd6; }
    .ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .ai-typing { display: flex; gap: 4px; padding: 6px 12px; }
    .ai-typing span {
      width: 7px; height: 7px; background: var(--text2, #8888aa);
      border-radius: 50%; animation: ai-bounce 1.4s ease-in-out infinite;
    }
    .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
    .ai-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes ai-bounce {
      0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); }
    }

    .ai-welcome {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 28px 20px; text-align: center; color: var(--text2, #8888aa);
    }
    .ai-welcome-icon { font-size: 44px; margin-bottom: 10px; }
    .ai-welcome h4 { color: var(--text, #e0e0e0); margin: 0 0 6px; font-size: 15px; }
    .ai-welcome p { margin: 0 0 14px; font-size: 12px; line-height: 1.5; }
    .ai-welcome-hints { display: flex; flex-direction: column; gap: 5px; width: 100%; }
    .ai-hint {
      background: var(--surface2, #32324e); border: 1px solid var(--border, #3a3a5c);
      border-radius: 8px; padding: 8px 12px; font-size: 12px; cursor: pointer;
      color: var(--text, #e0e0e0); text-align: left; transition: border-color 0.2s;
    }
    .ai-hint:hover { border-color: #6C5CE7; }

    .ai-tts-btn {
      background: none; border: none; cursor: pointer; padding: 1px 4px;
      font-size: 14px; opacity: 0.4; transition: opacity 0.2s; display: inline;
    }
    .ai-tts-btn:hover { opacity: 1; }

    @media (max-width: 768px) {
      .ai-panel { left: 12px; right: 12px; width: auto; bottom: 12px; }
    }
  `;
  document.head.appendChild(style);

  // ---- SVG Icons ----
  var micIcon = '<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
  var sendIcon = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var aiIcon = '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a2 2 0 110 4h-1.17A7 7 0 0113 23h-2a7 7 0 01-6.83-5H3a2 2 0 110-4h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-1 9a5 5 0 00-5 5 5 5 0 005 5h2a5 5 0 005-5 5 5 0 00-5-5h-2zm-1 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm4 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>';
  var stopIcon = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';

  // ---- Sidebar button (inserted under logo) ----
  function insertSidebarButton() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar || document.getElementById('ai-sidebar-btn')) return;
    var header = sidebar.querySelector('.sidebar-header');
    if (!header) return;

    var btn = document.createElement('button');
    btn.id = 'ai-sidebar-btn';
    btn.className = 'ai-sidebar-btn';
    btn.innerHTML = aiIcon +
      '<span class="ai-btn-label">' +
        '<span class="ai-btn-label-text">AI Asistent</span>' +
        '<span class="ai-btn-wave"><span></span><span></span><span></span><span></span><span></span></span>' +
      '</span>';
    btn.onclick = function() { toggleSession(); };
    header.insertAdjacentElement('afterend', btn);
    window._aiSidebarBtn = btn;
  }

  // Wait for sidebar to render, then insert button
  var sidebarCheck = setInterval(function() {
    if (document.querySelector('.sidebar-header')) {
      clearInterval(sidebarCheck);
      insertSidebarButton();
    }
  }, 100);
  setTimeout(function() { clearInterval(sidebarCheck); }, 5000);

  // ---- Chat panel ----
  var panel = document.createElement('div');
  panel.className = 'ai-panel';
  panel.innerHTML =
    '<div class="ai-panel-header">' +
      '<span style="font-size:18px">&#129302;</span>' +
      '<h3>AI Asistent</h3>' +
      '<span class="ai-status" id="ai-status">připraven</span>' +
      '<button class="ai-panel-close" title="Zavřít">&#10005;</button>' +
    '</div>' +
    '<div class="ai-messages" id="ai-messages"></div>' +
    '<div class="ai-input-row">' +
      '<button class="ai-mic-btn" id="ai-mic-btn" title="Mikrofon">' + micIcon + '</button>' +
      '<input class="ai-input" id="ai-input" type="text" placeholder="Napište nebo mluvte..." autocomplete="off" />' +
      '<button class="ai-send-btn" id="ai-send-btn" title="Odeslat">' + sendIcon + '</button>' +
    '</div>';
  document.body.appendChild(panel);

  panel.querySelector('.ai-panel-close').onclick = function() { closePanel(); };

  var messagesEl = document.getElementById('ai-messages');
  var inputEl = document.getElementById('ai-input');
  var micBtn = document.getElementById('ai-mic-btn');
  var sendBtn = document.getElementById('ai-send-btn');
  var statusEl = document.getElementById('ai-status');

  showWelcome();

  sendBtn.onclick = function() { sendMessage(); };
  inputEl.onkeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };
  micBtn.onclick = function() {
    if (isListening) stopRecognition();
    else startRecognition();
  };

  // ---- Toggle voice session (sidebar button) ----
  function toggleSession() {
    if (sessionActive) {
      endSession();
    } else {
      startSession();
    }
  }

  function startSession() {
    sessionActive = true;
    isOpen = true;
    panel.classList.add('open');
    if (window._aiSidebarBtn) window._aiSidebarBtn.classList.add('active');
    setStatus('naslouchám');
    if (messages.length === 0) {
      messagesEl.innerHTML = '';
      addMessage('assistant', 'Ahoj! Jsem tvůj AI asistent. S čím ti mohu pomoct? Mluv volně, poslouchám tě.');
      speak('Ahoj! Jsem tvůj AI asistent. S čím ti mohu pomoct?');
    }
    // Start continuous listening after TTS finishes
    waitForSpeechEnd(function() {
      startRecognition();
    });
  }

  function endSession() {
    sessionActive = false;
    stopRecognition();
    speechSynth.cancel();
    if (window._aiSidebarBtn) window._aiSidebarBtn.classList.remove('active');
    setStatus('ukončeno');
    addMessage('system', 'Hlasová relace ukončena.');
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
    if (sessionActive) endSession();
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function showWelcome() {
    messagesEl.innerHTML =
      '<div class="ai-welcome">' +
        '<div class="ai-welcome-icon">&#129302;</div>' +
        '<h4>AI Asistent HOLYOS</h4>' +
        '<p>Klikni na tlačítko v sidebaru pro zahájení hlasové konverzace. ' +
        'Můžeš také psát přímo sem.</p>' +
        '<div class="ai-welcome-hints">' +
          '<div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Kolik máme zboží na skladě?</div>' +
          '<div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Otevři modul Nákup a sklad</div>' +
          '<div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Které položky jsou pod minimem?</div>' +
          '<div class="ai-hint" onclick="window._aiSendHint(this.textContent)">Kolik máme zaměstnanců?</div>' +
        '</div>' +
      '</div>';
  }

  window._aiSendHint = function(text) {
    if (messages.length === 0) messagesEl.innerHTML = '';
    inputEl.value = text;
    sendMessage();
  };

  // ---- Speech Recognition — CONTINUOUS MODE ----
  function createRecognition() {
    if (!hasSpeech) return null;
    var rec = new SpeechRecognition();
    rec.lang = 'cs-CZ';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    var finalTranscript = '';
    var interimTranscript = '';
    var silenceTimer = null;

    rec.onstart = function() {
      isListening = true;
      micBtn.classList.add('active');
      micBtn.innerHTML = stopIcon;
      setStatus('naslouchám');
    };

    rec.onresult = function(e) {
      interimTranscript = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        } else {
          interimTranscript += e.results[i][0].transcript;
        }
      }
      inputEl.value = finalTranscript + interimTranscript;

      // Reset silence timer — send after 1.5s of silence after final result
      clearTimeout(silenceTimer);
      if (finalTranscript.trim()) {
        silenceTimer = setTimeout(function() {
          var text = finalTranscript.trim();
          finalTranscript = '';
          interimTranscript = '';
          if (text) {
            inputEl.value = '';
            processVoiceInput(text);
          }
        }, 1500);
      }
    };

    rec.onerror = function(e) {
      if (e.error === 'not-allowed') {
        addMessage('system error', 'Mikrofon zamítnut. Povolte přístup v prohlížeči.');
        sessionActive = false;
        if (window._aiSidebarBtn) window._aiSidebarBtn.classList.remove('active');
      } else if (e.error === 'no-speech') {
        // Restart if in session
        if (sessionActive && !isProcessing && !isSpeaking) {
          setTimeout(function() { startRecognition(); }, 300);
        }
      }
    };

    rec.onend = function() {
      isListening = false;
      micBtn.classList.remove('active');
      micBtn.innerHTML = micIcon;
      // Auto-restart if session still active and not speaking/processing
      if (sessionActive && !isProcessing && !isSpeaking) {
        setTimeout(function() { startRecognition(); }, 300);
      }
    };

    return rec;
  }

  function startRecognition() {
    if (!hasSpeech) {
      addMessage('system error', 'Prohlížeč nepodporuje rozpoznávání řeči. Použijte Chrome.');
      return;
    }
    if (isListening) return;
    speechSynth.cancel();
    // Always create fresh recognition instance
    recognition = createRecognition();
    try { recognition.start(); } catch(e) {}
  }

  function stopRecognition() {
    isListening = false;
    micBtn.classList.remove('active');
    micBtn.innerHTML = micIcon;
    if (recognition) {
      try { recognition.stop(); } catch(e) {}
      recognition = null;
    }
  }

  // ---- Process voice input ----
  function processVoiceInput(text) {
    // Check for stop commands
    var lower = text.toLowerCase().trim();
    if (lower.match(/^(stop|konec|ukonči|zavři asistent|dost|skonči|přestaň)/)) {
      endSession();
      closePanel();
      return;
    }
    sendMessageText(text);
  }

  // ---- Send Message ----
  function sendMessage() {
    var text = (inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';
    if (messages.length === 0) messagesEl.innerHTML = '';
    sendMessageText(text);
  }

  function sendMessageText(text) {
    if (isProcessing) return;

    addMessage('user', text);
    isProcessing = true;
    sendBtn.disabled = true;
    setStatus('přemýšlím...');

    // Pause listening while processing
    if (isListening) { stopRecognition(); }

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
        resumeListening();
      } else {
        var response = data.response || '';
        addMessage('assistant', response);

        // Check for navigation actions in the response
        var navAction = detectNavigation(text, response);
        if (navAction) {
          addActionMessage('Otevírám: ' + navAction.label, navAction.url);
          setTimeout(function() { window.location.href = navAction.url; }, 1200);
        }

        // Speak and then resume listening
        setStatus('mluvím...');
        isSpeaking = true;
        speak(response, function() {
          isSpeaking = false;
          resumeListening();
        });
      }
    })
    .catch(function() {
      typingEl.remove();
      addMessage('assistant error', 'Spojení se serverem selhalo.');
      resumeListening();
    })
    .finally(function() {
      isProcessing = false;
      sendBtn.disabled = false;
    });
  }

  function resumeListening() {
    if (sessionActive && !isProcessing && !isSpeaking) {
      setStatus('naslouchám');
      setTimeout(function() { startRecognition(); }, 500);
    }
  }

  // ---- Detect navigation intent ----
  function detectNavigation(userMsg, aiResponse) {
    var combined = (userMsg + ' ' + aiResponse).toLowerCase();
    // Direct commands: "otevři", "jdi na/do", "přejdi", "ukaž"
    if (!combined.match(/(otevři|jdi na|jdi do|přejdi|ukaž|naviguj|přepni na|zobraz modul)/)) return null;

    for (var key in NAV_MAP) {
      if (combined.includes(key)) {
        var label = key.charAt(0).toUpperCase() + key.slice(1);
        return { url: NAV_MAP[key], label: label };
      }
    }
    return null;
  }

  function addActionMessage(text, url) {
    var el = document.createElement('div');
    el.className = 'ai-msg action-msg';
    el.textContent = '➜ ' + text;
    el.onclick = function() { window.location.href = url; };
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- Add message ----
  function addMessage(type, text) {
    var cls = type.includes('user') ? 'user' : type.includes('system') ? 'system' : 'assistant';
    if (type.includes('error')) cls += ' error';
    var el = document.createElement('div');
    el.className = 'ai-msg ' + cls;
    el.textContent = text;

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

  // ---- TTS ----
  function speak(text, onEnd) {
    if (!speechSynth) { if (onEnd) onEnd(); return; }
    speechSynth.cancel();
    var clean = text.replace(/[#*_`]/g, '').replace(/\n+/g, '. ').substring(0, 500);
    var utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'cs-CZ';
    utterance.rate = 1.1;
    utterance.pitch = 1;
    var voices = speechSynth.getVoices();
    var czVoice = voices.find(function(v) { return v.lang.startsWith('cs'); });
    if (czVoice) utterance.voice = czVoice;
    utterance.onend = function() { if (onEnd) onEnd(); };
    utterance.onerror = function() { if (onEnd) onEnd(); };
    speechSynth.speak(utterance);
  }

  function waitForSpeechEnd(cb) {
    var check = setInterval(function() {
      if (!speechSynth.speaking) { clearInterval(check); cb(); }
    }, 100);
    setTimeout(function() { clearInterval(check); cb(); }, 8000);
  }

  if (speechSynth) {
    speechSynth.getVoices();
    speechSynth.onvoiceschanged = function() { speechSynth.getVoices(); };
  }

  // ---- Keyboard shortcut ----
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      toggleSession();
      if (!isOpen) { isOpen = true; panel.classList.add('open'); }
    }
  });

})();
