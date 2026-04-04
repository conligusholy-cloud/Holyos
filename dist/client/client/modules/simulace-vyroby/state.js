/* ============================================
   state.ts — Stav simulace výroby
   ============================================ */
export const state = {
    // Půdorys (z programování výroby)
    arealId: null,
    arealName: '',
    arealObjects: [], // read-only pozadí areálu
    objects: [], // pracoviště, sklady, vstupy
    connections: [],
    pxPerMeter: 20,
    zoom: 1,
    panX: 0,
    panY: 0,
    // Aktuální programování
    currentProgId: null,
    currentProgName: '',
    // Vybrané zboží
    selectedProduct: null,
    // Pracovní postup — operace
    route: [],
    // Simulace
    simRunning: false,
    simPaused: false,
    simFinished: false,
    simTime: 0, // aktuální čas simulace (sekundy)
    simSpeed: 1, // násobitel rychlosti
    simBatchSize: 1, // kolik kusů
    simMoveSpeed: 1, // m/s přesunu
    simAnimFrame: null, // requestAnimationFrame ID
    // Tokeny — animované objekty (kusy zboží)
    tokens: [],
    // Metriky
    metrics: {
        totalTime: 0,
        productiveTime: 0,
        waitTime: 0,
        moveTime: 0,
        stationUtil: {}, // stageId → { busy: sec, idle: sec }
        bottlenecks: [],
    },
};
export const PROG_STORAGE_KEY = 'vyroba_programovani';
export const AREAL_STORAGE_KEY = 'vyroba_simulations';
//# sourceMappingURL=state.js.map