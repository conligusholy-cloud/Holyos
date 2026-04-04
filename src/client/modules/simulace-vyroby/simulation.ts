/* ============================================
   simulation.ts — Simulační engine
   ============================================ */

import { state } from './state.js';
import { renderTokens, highlightStation, updateTransform } from './renderer.js';
import { showToast, mapRouteToFloorPlan } from './factorify-sim.js';
import { Token, RouteOperation, StationUtilization } from '../../../shared/types.js';

let lastFrameTime = 0;

// ---- Ovládání simulace ----

export function startSimulation(): void {
  if (!state.route || state.route.length === 0) {
    showToast('Nejprve vyberte zboží a definujte pracovní postup');
    return;
  }

  // Zkontrolovat mapování na půdorys
  const unmapped = state.route.filter(op => (op as any).floorX == null);
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

export function pauseSimulation(): void {
  state.simPaused = true;
  state.simRunning = false;
  if (state.simAnimFrame) cancelAnimationFrame(state.simAnimFrame);
  updateSimButtons();
}

export function stopSimulation(): void {
  state.simRunning = false;
  state.simPaused = false;
  state.simFinished = true;
  if (state.simAnimFrame) cancelAnimationFrame(state.simAnimFrame);
  updateSimButtons();
  calculateFinalMetrics();
  showToast('Simulace zastavena');
}

export function stepSimulation(): void {
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

export function setSimSpeed(value: string | number): void {
  state.simSpeed = parseFloat(String(value)) || 1;
  const speedDisplay = document.getElementById('speed-display');
  if (speedDisplay) speedDisplay.textContent = state.simSpeed + '×';
}

export function resetSimulation(): void {
  state.tokens = [];
  state.simTime = 0;
  state.simRunning = false;
  state.simPaused = false;
  state.simFinished = false;
  if (state.simAnimFrame) cancelAnimationFrame(state.simAnimFrame);
  clearStationHighlights();
  updateSimButtons();
  updateSimUI();
}

// ---- Inicializace tokenů ----

function initTokens(): void {
  state.tokens = [];
  for (let i = 0; i < state.simBatchSize; i++) {
    // Vstupní pozice — první pracoviště v postupu
    const firstOp = state.route[0];
    const startX = (firstOp as any).floorX || 0;
    const startY = (firstOp as any).floorY || 0;

    state.tokens.push({
      id: i + 1,
      currentStep: 0,
      x: startX,
      y: startY,
      targetX: startX,
      targetY: startY,
      state: 'processing',
      progress: 0,
      startTime: i * 2,     // rozesazení — každý kus začne o 2s později
    } as unknown as Token);

    // Rozšíření pro vlastní atributy
    const token = state.tokens[state.tokens.length - 1] as any;
    token.stepStartTime = i * 2;
    token.totalProcessing = 0;
    token.totalMoving = 0;
    token.totalWaiting = 0;
    token.completedAt = null;
    token.visible = true;
  }
}

function initMetrics(): void {
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
      (state.metrics.stationUtil as any)[key] = {
        name: op.stageName || op.name,
        busy: 0,
        idle: 0,
        queue: 0,
      };
    }
  });
}

// ---- Hlavní smyčka ----

function simLoop(timestamp: number): void {
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

function updateSimulation(dt: number): void {
  state.tokens.forEach(token => {
    if (token.state === 'done') return;

    const tokenData = token as any;

    // Čekání na start (rozesazení)
    if (state.simTime < tokenData.stepStartTime) {
      token.state = 'waiting';
      tokenData.totalWaiting = (tokenData.totalWaiting || 0) + dt;
      return;
    }

    const currentOp = state.route[token.currentStep];
    if (!currentOp) {
      token.state = 'done';
      tokenData.completedAt = state.simTime;
      tokenData.visible = true;
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

function setTokenTarget(token: Token, op: RouteOperation): void {
  if ((op as any).floorX != null) {
    token.targetX = (op as any).floorX;
    token.targetY = (op as any).floorY;
  }
}

function moveToken(token: Token, dt: number): void {
  const dx = token.targetX! - token.x;
  const dy = token.targetY! - token.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.3) {
    // Dorazil
    token.x = token.targetX!;
    token.y = token.targetY!;
    token.state = 'processing';
    token.progress = 0;

    // Highlight stanice
    const op = state.route[token.currentStep];
    if (op && (op as any).floorObj) highlightStation((op as any).floorObj, true);
    return;
  }

  const speed = state.simMoveSpeed; // m/s
  const moveDist = speed * dt;
  const ratio = Math.min(moveDist / dist, 1);
  token.x += dx * ratio;
  token.y += dy * ratio;

  const tokenData = token as any;
  tokenData.totalMoving = (tokenData.totalMoving || 0) + dt;

  // Aktualizovat station util
  const op = state.route[token.currentStep];
  if (op) {
    const key = op.stageId || op.stageName;
    const util = (state.metrics.stationUtil as any)[key];
    if (util) {
      util.idle = (util.idle || 0) + dt;
    }
  }
}

function processToken(token: Token, op: RouteOperation, dt: number): void {
  const duration = op.duration || 60;
  token.progress += dt / duration;

  // Aktualizovat station util
  const key = op.stageId || op.stageName;
  const util = (state.metrics.stationUtil as any)[key];
  if (util) {
    util.busy = (util.busy || 0) + dt;
  }

  const tokenData = token as any;
  tokenData.totalProcessing = (tokenData.totalProcessing || 0) + dt;

  if (token.progress >= 1) {
    // Operace dokončena
    token.progress = 1;

    // Un-highlight stanice
    if ((op as any).floorObj) highlightStation((op as any).floorObj, false);

    // Další krok
    token.currentStep++;
    if (token.currentStep >= state.route.length) {
      token.state = 'done';
      tokenData.completedAt = state.simTime;
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

function updateSimButtons(): void {
  const btnPlay = document.getElementById('btn-play') as HTMLButtonElement | null;
  const btnPause = document.getElementById('btn-pause') as HTMLButtonElement | null;
  const btnStop = document.getElementById('btn-stop') as HTMLButtonElement | null;
  const statusEl = document.getElementById('sim-status') as HTMLElement | null;

  if (btnPlay) btnPlay.disabled = state.simRunning;
  if (btnPause) btnPause.disabled = !state.simRunning;
  if (btnStop) btnStop.disabled = !state.simRunning && !state.simPaused;

  if (statusEl) {
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
}

function updateSimUI(): void {
  // Čas
  const timeEl = document.getElementById('sim-time');
  if (timeEl) timeEl.textContent = formatSimTime(state.simTime);

  // Progress
  const progressEl = document.getElementById('sim-progress');
  if (!progressEl) return;
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

function updateRouteHighlight(): void {
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
    if (idx < maxStep) (step as HTMLElement).classList.add('done');
    if (idx === maxStep) (step as HTMLElement).classList.add('active');
  });
}

function clearStationHighlights(): void {
  state.objects.forEach(obj => {
    highlightStation(obj, false);
  });
}

function updateMetricsUI(): void {
  // Průběžné metriky
  let totalProd = 0, totalMove = 0, totalWait = 0;
  state.tokens.forEach(t => {
    const tData = t as any;
    totalProd += tData.totalProcessing || 0;
    totalMove += tData.totalMoving || 0;
    totalWait += tData.totalWaiting || 0;
  });

  const timeEl = document.getElementById('metric-total-time');
  if (timeEl) timeEl.textContent = formatSimTime(state.simTime);

  const prodEl = document.getElementById('metric-productive-time');
  if (prodEl) prodEl.textContent = formatSimTime(totalProd / state.simBatchSize);

  const moveEl = document.getElementById('metric-move-time');
  if (moveEl) moveEl.textContent = formatSimTime(totalMove / state.simBatchSize);

  const waitEl = document.getElementById('metric-wait-time');
  if (waitEl) waitEl.textContent = formatSimTime(totalWait / state.simBatchSize);

  // Vytížení pracovišť
  renderUtilizationChart();
}

function calculateFinalMetrics(): void {
  updateMetricsUI();

  // Úzká místa — stanice s nejdelším busy časem
  const stationEntries = Object.entries(state.metrics.stationUtil)
    .map(([key, data]) => ({ key, ...(data as any) }))
    .sort((a, b) => (b as any).busy - (a as any).busy);

  const bnEl = document.getElementById('bottleneck-info');
  if (!bnEl) return;

  if (stationEntries.length === 0) {
    bnEl.innerHTML = '<div class="empty-state">Žádné data</div>';
    return;
  }

  const maxBusy = (stationEntries[0] as any).busy;
  let html = '';
  stationEntries.forEach(s => {
    const busy = (s as any).busy;
    if (busy < maxBusy * 0.5) return; // zobrazit jen nejvytíženější
    const utilPct = state.simTime > 0 ? Math.round((busy / state.simTime) * 100) : 0;
    html += `
      <div class="bottleneck-card">
        <div class="bn-name">${(s as any).name}</div>
        <div class="bn-detail">Vytížení: ${utilPct}% | Aktivní: ${formatSimTime(busy)}</div>
      </div>`;
  });

  bnEl.innerHTML = html || '<div class="empty-state">Žádná úzká místa</div>';
}

function renderUtilizationChart(): void {
  const container = document.getElementById('utilization-chart');
  const entries = Object.entries(state.metrics.stationUtil);

  if (!container) return;

  if (entries.length === 0 || state.simTime === 0) {
    container.innerHTML = '<div class="empty-state">Spusťte simulaci</div>';
    return;
  }

  let html = '';
  entries.forEach(([key, data]) => {
    const dataTyped = data as any;
    const totalTime = dataTyped.busy + dataTyped.idle;
    const utilPct = totalTime > 0 ? Math.round((dataTyped.busy / Math.max(state.simTime, 1)) * 100) : 0;
    const clampedPct = Math.min(100, utilPct);
    const color = utilPct > 80 ? '#ef4444' : utilPct > 50 ? '#f59e0b' : '#22c55e';

    html += `
      <div class="util-bar-wrap">
        <div class="util-bar-label">
          <span>${dataTyped.name}</span>
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

function formatSimTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
