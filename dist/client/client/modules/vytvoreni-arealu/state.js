/* ============================================
   state.ts — Stav aplikace
   ============================================ */
export const state = {
    objects: [],
    connections: [],
    nextId: 1,
    selected: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    gridVisible: true,
    snapEnabled: true,
    snapSize: 1, // metry
    pxPerMeter: 20, // 1 metr = 20px při zoom=1
    connectMode: false,
    connectFrom: null,
    // Režim kreslení polygonů
    drawMode: false, // true = kreslíme polygon
    drawType: null, // typ objektu který se kreslí ('areal', 'hala', ...)
    drawPoints: [], // body aktuálně kresleného polygonu [{x, y}, ...]
    // Omezení směru při kreslení
    drawConstraint: null, // null = volně, 'h' = vodorovně, 'v' = svisle
    drawDistance: null, // zadaná délka hrany (null = volně)
    // Režim umísťování vjezdů/výjezdů (dva body na hraně)
    entrancePlaceMode: false,
    entrancePlaceType: 'vjezd', // 'vjezd', 'vyjezd', 'oboji'
    entrancePlaceStep: 0, // 0 = čekání na první bod, 1 = čekání na druhý bod, 2 = hotovo
    entrancePlaceFirstPoint: null, // první bod vjezdu
    // Režim kreslení stěn v hale
    wallDrawMode: false,
    wallDrawObjId: null,
    wallDrawStart: null, // počáteční bod kreslení stěny
    wallDrawSnap: null, // snapování na existující stěny
    // Režim umísťování vrat
    gatePlaceMode: false,
    gatePlaceObjId: null,
    gatePlaceWallId: null,
    // Režim umísťování popisku místnosti
    roomLabelPlaceMode: false,
    roomLabelPlaceObjId: null,
    // Aktuální simulace
    currentSimId: null, // ID simulace v localStorage
    currentSimName: '', // název simulace
};
//# sourceMappingURL=state.js.map