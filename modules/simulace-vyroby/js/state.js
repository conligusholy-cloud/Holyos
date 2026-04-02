/* ============================================
   state.js — Stav simulace výroby
   ============================================ */

const state = {
  // Půdorys (z programování výroby)
  arealId: null,
  arealName: '',
  arealObjects: [],       // read-only pozadí areálu
  objects: [],            // pracoviště, sklady, vstupy
  connections: [],
  pxPerMeter: 20,
  zoom: 1,
  panX: 0,
  panY: 0,

  // Aktuální programování
  currentProgId: null,
  currentProgName: '',

  // Vybrané zboží
  selectedProduct: null,  // { id, name, code, ... }

  // Pracovní postup — operace
  route: [],              // [{ id, name, stageId, stageName, duration, order }, ...]

  // Simulace
  simRunning: false,
  simPaused: false,
  simFinished: false,
  simTime: 0,             // aktuální čas simulace (sekundy)
  simSpeed: 1,            // násobitel rychlosti
  simBatchSize: 1,        // kolik kusů
  simMoveSpeed: 1,        // m/s přesunu
  simAnimFrame: null,     // requestAnimationFrame ID

  // Tokeny — animované objekty (kusy zboží)
  tokens: [],             // [{ id, currentStep, x, y, state: 'moving'|'processing'|'waiting'|'done', progress, ... }]

  // Metriky
  metrics: {
    totalTime: 0,
    productiveTime: 0,
    waitTime: 0,
    moveTime: 0,
    stationUtil: {},      // stageId → { busy: sec, idle: sec }
    bottlenecks: [],
  },
};

const PROG_STORAGE_KEY = 'vyroba_programovani';
const AREAL_STORAGE_KEY = 'vyroba_simulations';
