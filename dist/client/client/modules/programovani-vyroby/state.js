/* ============================================
   state.ts — Stav aplikace (Programování výroby)
   ============================================ */
export const state = {
    // Objekty areálu (read-only pozadí)
    arealId: null, // ID zdrojového areálu
    arealName: '', // Název areálu
    arealObjects: [], // Objekty z areálu (polygony, cesty, vjezdy) — pouze zobrazení
    // Editovatelné objekty (pracoviště, sklady, vstupy, propojení)
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
    connectMode: false,
    connectFrom: null,
    pxPerMeter: 20, // 1 metr = 20px při zoom=1
    // Režim kreslení polygonů (nepoužívá se v tomto modulu, ale zachováno pro kompatibilitu)
    drawMode: false,
    drawType: null,
    drawPoints: [],
    drawConstraint: null,
    drawDistance: null,
    // Nepoužívané v tomto modulu (entrance/wall/gate)
    entrancePlaceMode: false,
    entrancePlaceType: 'vjezd',
    entrancePlaceStep: 0,
    entrancePlaceFirstPoint: null,
    wallDrawMode: false,
    wallDrawObjId: null,
    wallDrawStart: null,
    wallDrawSnap: null,
    gatePlaceMode: false,
    gatePlaceObjId: null,
    gatePlaceWallId: null,
    // Režim umísťování popisku místnosti
    roomLabelPlaceMode: false,
    roomLabelPlaceObjId: null,
    // Aktuální programování
    currentSimId: null, // ID uložené konfigurace programování
    currentSimName: '', // název konfigurace
};
//# sourceMappingURL=state.js.map