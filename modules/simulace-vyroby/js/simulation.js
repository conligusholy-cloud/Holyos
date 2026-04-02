/* ============================================
   simulation.js — Simulační engine
   ============================================ */

let lastFrameTime = 0;

// ---- Ovládání simulace ----

function startSimulation() {
  if (!state.route || state.route.length === 0) {
    showToast('Nejprve vyberte zboží a definujte pracovní postup');
    return;
  }

  // Zkontrolovat mapování na půdorys
  const unmapped = state.route.filter(op => op.floorX == null);
  if (unmapped.length > 0) {
    mapRouteToFloorPlan();
  }

  if (state.simPaused) {
    // Pokračovat
    state.simPaused = false;
    state.simRunning = true;
    updateSimButtons();
    lastFrameTime = performance.now();
    state.simAnimFrame = requestAnimationFrame(simLoop);
    return;
  }

  // Reset a start
  resetSimulation();
  state.simRunning = true;
  state.simFinished = false;
  state.simTime = 0;

  // Vytvořit tokeny
  initTokens();
  initMetrics();
  updateSimButtons();
  renderTokens();

  lastFrameTime = performance.now();
  state.simAnimFrame = requestAnimationFrame(simLoop);

  showToast('Simulace spuštěna');
}

function pauseSimulation() {
  state.simPaused = true;
  state.simRunning = false;
  if (state.simAnimFrame) cancelAnimationFrame(state.simAnimFrame);
  updateSimButtons();
}

function stopSimulation() {
  state.simRunning = false;
  state.simPaused = false;
  state.simFinished = true;
  if (state.simAnimFrame) cancelAnimationFrame(state.simAnimFrame);
  updateSimButtons();
  calculateFinalMetrics();
  showToast('Simulace zastavena');
}

function stepSimulation() {
  if (state.simFinished) return;
  if (!state.simRunning && !state.simPaused && state.tokens.length === 0) {
    // Ještě nespuštěno — inicializovat
    resetSimulation();
    state.simTime = 0;
    initTokens();
    initMetrics();
    state.simPaused = true;
  }

  // Provést jeden krok (1 sekunda simulačního času)
  const dt = 1;
  updateSimulation(dt);
  state.simTime += dt;
  renderTokens();
  updateSimUI();
  updateRouteHighlight();
  updateMetricsUI();
}

function setSimSpeed(value) {
  state.simSpeed = parseFloat(value) || 1;
  document.getElementById('speed-display').textContent = state.simSpeed + '×';
}

function resetSimulation() {
  state.tokens = [];
  state.simTime = 0;
  state.simRunning = false;
  state.simPaused = false;
  state.simFinished = false;
  if (state.simAnimFrame) cancelAnimationFrame(state.simAnimFrame);
  dom.animationLayer.innerHTML = '';
  clearStationHighlights();
  updateSimButtons();
  updateSimUI();
}

// ---- Inicializace tokenů ----

function initTokens() {
  state.tokens = [];
  for (let i = 0; i < state.simBatchSize; i++) {
    // Vstupní pozice — první pracoviště v postupu
    const firstOp = state.route[0];
    const startX = firstOp.floorX || 0;
    const startY = firstOp.floorY || 0;

    state.tokens.push({
      id: i + 1,
      currentStep: 0,
      x: startX,
      y: startY,
      targetX: startX,
      targetY: startY,
      state: 'processing',      // 'moving', 'processing', 'waiting', 'done'
      progress: 0,              // 0-1 progress aktuální operace
      stepStartTime: i * 2,     // rozesazení — každý kus začne o 2s později
      totalProcessing: 0,
      totalMoving: 0,
      totalWaiting: 0,
      completedAt: null,
      visible: true,
    });
  }
}

function initMetrics() {
  state.metrics = {
    totalTime: 0,
    productiveTime: 0,
    waitTime: 0,
    moveTime: 0,
    stationUtil: {},
    bottlenecks: [],
  };

  // Inicializovat station utilization
  state.route.forEach(op => {
    if (op.stageId || op.stageName) {
      const key = op.stageId || op.stageName;
      state.metrics.stationUtil[key] = {
        name: op.stageName || op.name,
        busy: 0,
        idle: 0,
        queue: 0,
      };
    }
  });
}

// ---- Hlavní smyčka ----

function simLoop(timestamp) {
  if (!state.simRunning) return;

  const realDt = (timestamp - lastFrameTime) / 1000; // sekundy
  lastFrameTime = timestamp;

  const simDt = realDt * state.simSpeed;
  state.simTime += simDt;

  updateSimulation(simDt);
  renderTokens();
  updateSimUI();
  updateRouteHighlight();

  // Průběžné metriky
  if (Math.floor(state.simTime) % 2 === 0) {
    updateMetricsUI();
  }

  // Kontrola konce
  const allDone = state.tokens.every(t => t.state === 'done');
  if (allDone) {
    state.simRunning = false;
    state.simFinished = true;
    calculateFinalMetrics();
    updateSimButtons();
    showToast('Simulace dokončena!');
    return;
  }

  state.simAnimFrame = requestAnimationFrame(simLoop);
}

// ---- Update simulace ----

function updateSimulation(dt) {
  state.tokens.forEach(token => {
    if (token.state === 'done') return;

    // Čekání na start (rozesazení)
    if (state.simTime < token.stepStartTime) {
      token.state = 'waiting';
      token.totalWaiting += dt;
      return;
    }

    const currentOp = state.route[token.currentStep];
    if (!currentOp) {
      token.state = 'done';
      token.completedAt = state.simTime;
      token.visible = true;
      return;
    }

    switch (token.state) {
      case 'moving':
        moveToken(token, dt);
        break;

      case 'processing':
        processToken(token, currentOp, dt);
        break;

      case 'waiting':
        // Počkat a začít se pohybovat k dalšímu pracovišti
        token.state = 'moving';
        setTokenTarget(token, currentOp);
        break;
    }
  });
}

function setTokenTarget(token, op) {
  if (op.floorX != null) {
    token.targetX = op.floorX;
    token.targetY = op.floorY;
  }
}

function moveToken(token, dt) {
  const dx = token.targetX - token.x;
  const dy = token.targetY - token.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.3) {
    // Dorazil
    token.x = token.targetX;
    token.y = token.targetY;
    token.state = 'processing';
    token.progress = 0;

    // Highlight stanice
    const op = state.route[token.currentStep];
    if (op && op.floorObj) highlightStation(op.floorObj, true);
    return;
  }

  const speed = state.simMoveSpeed; // m/s
  const moveDist = speed * dt;
  const ratio = Math.min(moveDist / dist, 1);
  token.x += dx * ratio;
  token.y += dy * ratio;
  token.totalMoving += dt;

  // Aktualizovat station util
  const op = state.route[token.currentStep];
  if (op) {
    const key = op.stageId || op.stageName;
    if (state.metrics.stationUtil[key]) {
      state.metrics.stationUtil[key].idle += dt;
    }
  }
}

function processToken(token, op, dt) {
  const duration = op.duration || 60;
  token.progress += dt / duration;

  // Aktualizovat station util
  const key = op.stageId || op.stageName;
  if (state.metrics.stationUtil[key]) {
    state.metrics.stationUtil[key].busy += dt;
  }

  token.totalProcessing += dt;

  if (token.progress >= 1) {
    // Operace dokončena
    token.progress = 1;

    // Un-highlight stanice
    if (op.floorObj) highlightStation(op.floorObj, false);

    // Další krok
    token.currentStep++;
    if (token.currentStep >= state.route.length) {
      token.state = 'done';
      token.completedAt = state.simTime;
      return;
    }

    // Přesun k dalšímu pracovišti
    const nextOp = state.route[token.currentStep];
    if (nextOp) {
      token.state = 'moving';
      token.progress = 0;
      setTokenTarget(token, nextOp);
    }
  }
}

// ---- UI updates ----

function updateSimButtons() {
  const btnPlay = document.getElementById('btn-play');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  const statusEl = document.getElementById('sim-status');

  btnPlay.disabled = state.simRunning;
  btnPause.disabled = !state.simRunning;
  btnStop.disabled = !state.simRunning && !state.simPaused;

  statusEl.className = 'sim-status';
  if (state.simRunning) {
    statusEl.textContent = 'Běží';
    statusEl.classList.add('running');
  } else if (state.simPaused) {
    statusEl.textContent = 'Pauza';
    statusEl.classList.add('paused');
  } else if (state.simFinished) {
    statusEl.textContent = 'Dokončeno';
    statusEl.classList.add('finished');
  } else {
    statusEl.textContent = 'Připraveno';
  }
}

function updateSimUI() {
  // Čas
  const timeEl = document.getElementById('sim-time');
  timeEl.textContent = formatSimTime(state.simTime);

  // Progress
  const progressEl = document.getElementById('sim-progress');
  if (state.tokens.length === 0) {
    progressEl.innerHTML = '<div class="empty-state">Nespuštěno</div>';
    return;
  }

  let html = '';
  state.tokens.forEach(token => {
    const stepName = token.currentStep < state.route.length ? state.route[token.currentStep].name : 'Dokončeno';
    const pct = token.state === 'done' ? 100 : Math.min(100, Math.round(
      ((token.currentStep + token.progress) / state.route.length) * 100
    ));
    const stateLabel = { moving: 'Přesun', processing: 'Zpracování', waiting: 'Čekání', done: 'Hotovo' }[token.state] || '';
    const stateColor = { moving: '#6c8cff', processing: '#22c55e', waiting: '#f59e0b', done: '#10b981' }[token.state] || '#fff';

    html += `
      <div style="margin-bottom:6px;font-size:11px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
          <span>Kus #${token.id}</span>
          <span style="color:${stateColor};">${stateLabel}</span>
        </div>
        <div class="util-bar">
          <div class="util-bar-fill" style="width:${pct}%;background:${stateColor};"></div>
        </div>
        <div style="color:var(--text2);margin-top:1px;">${stepName} (${pct}%)</div>
      </div>`;
  });
  progressEl.innerHTML = html;
}

function updateRouteHighlight() {
  // Zvýraznit aktuální krok v seznamu operací
  const steps = document.querySelectorAll('.route-step');
  steps.forEach(step => {
    step.classList.remove('active', 'done');
  });

  // Najít nejpokročilejší token
  let maxStep = -1;
  state.tokens.forEach(t => {
    if (t.currentStep > maxStep) maxStep = t.currentStep;
  });

  steps.forEach((step, idx) => {
    if (idx < maxStep) step.classList.add('done');
    if (idx === maxStep) step.classList.add('active');
  });
}

function clearStationHighlights() {
  state.objects.forEach(obj => {
    highlightStation(obj, false);
  });
}

function updateMetricsUI() {
  // Průběžné metriky
  let totalProd = 0, totalMove = 0, totalWait = 0;
  state.tokens.forEach(t => {
    totalProd += t.totalProcessing;
    totalMove += t.totalMoving;
    totalWait += t.totalWaiting;
  });

  document.getElementById('metric-total-time').textContent = formatSimTime(state.simTime);
  document.getElementById('metric-productive-time').textContent = formatSimTime(totalProd / state.simBatchSize);
  document.getElementById('metric-move-time').textContent = formatSimTime(totalMove / state.simBatchSize);
  document.getElementById('metric-wait-time').textContent = formatSimTime(totalWait / state.simBatchSize);

  // Vytížení pracovišť
  renderUtilizationChart();
}

function calculateFinalMetrics() {
  updateMetricsUI();

  // Úzká místa — stanice s nejdelším busy časem
  const stationEntries = Object.entries(state.metrics.stationUtil)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => b.busy - a.busy);

  const bnEl = document.getElementById('bottleneck-info');
  if (stationEntries.length === 0) {
    bnEl.innerHTML = '<div class="empty-state">Žádné data</div>';
    return;
  }

  const maxBusy = stationEntries[0].busy;
  let html = '';
  stationEntries.forEach(s => {
    if (s.busy < maxBusy * 0.5) return; // zobrazit jen nejvytíženější
    const utilPct = state.simTime > 0 ? Math.round((s.busy / state.simTime) * 100) : 0;
    html += `
      <div class="bottleneck-card">
        <div class="bn-name">${s.name}</div>
        <div class="bn-detail">Vytížení: ${utilPct}% | Aktivní: ${formatSimTime(s.busy)}</div>
      </div>`;
  });

  bnEl.innerHTML = html || '<div class="empty-state">Žádná úzká místa</div>';
}

function renderUtilizationChart() {
  const container = document.getElementById('utilization-chart');
  const entries = Object.entries(state.metrics.stationUtil);

  if (entries.length === 0 || state.simTime === 0) {
    container.innerHTML = '<div class="empty-state">Spusťte simulaci</div>';
    return;
  }

  let html = '';
  entries.forEach(([key, data]) => {
    const totalTime = data.busy + data.idle;
    const utilPct = totalTime > 0 ? Math.round((data.busy / Math.max(state.simTime, 1)) * 100) : 0;
    const clampedPct = Math.min(100, utilPct);
    const color = utilPct > 80 ? '#ef4444' : utilPct > 50 ? '#f59e0b' : '#22c55e';

    html += `
      <div class="util-bar-wrap">
        <div class="util-bar-label">
          <span>${data.name}</span>
          <span>${utilPct}%</span>
        </div>
        <div class="util-bar">
          <div class="util-bar-fill" style="width:${clampedPct}%;background:${color};"></div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

// ---- Helpers ----

function formatSimTime(seconds) {
  if (!seconds || seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
