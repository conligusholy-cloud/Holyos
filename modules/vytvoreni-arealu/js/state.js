/* ============================================
   state.js — Stav aplikace
   ============================================ */

const state = {
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

  // Režim kreslení polygonů
  drawMode: false,      // true = kreslíme polygon
  drawType: null,       // typ objektu který se kreslí ('areal', 'hala', ...)
  drawPoints: [],       // body aktuálně kresleného polygonu [{x, y}, ...]

  // Omezení směru při kreslení
  drawConstraint: null, // null = volně, 'h' = vodorovně, 'v' = svisle
  drawDistance: null,    // zadaná délka hrany (null = volně)

  // Režim umísťování vjezdů/výjezdů (dva body na hraně)
  entrancePlaceMode: false,
  entrancePlaceType: 'vjezd', // 'vjezd', 'vyjezd', 'oboji'
  entrancePlaceStep: 0,         // 0 = čekám na první bod, 1 = čekám na druhý
  entrancePlaceFirstPoint: null, // {objId, edgeIndex, t, px, py}

  // Režim kreslení stěn v hale
  wallDrawMode: false,
  wallDrawObjId: null,
  wallDrawStart: null,   // {x, y} — první bod stěny
  wallDrawStep: 0,       // 0=klik, 1=potvrzuji start, 2=potvrzuji konec
  wallDrawSnap: null,    // snap info o přichycené hraně

  // Režim umísťování vrat
  gatePlaceMode: false,
  gatePlaceObjId: null,
  gatePlaceWallId: null,

  // Režim umísťování popisku místnosti
  roomLabelPlaceMode: false,
  roomLabelPlaceObjId: null,

  // Aktuální simulace
  currentSimId: null,   // ID simulace v localStorage
  currentSimName: '',   // název simulace
};
