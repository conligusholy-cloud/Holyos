/* ============================================
   Sdílené TypeScript typy pro celý projekt HOLYOS
   ============================================ */

// ==========================================
// Geometrie
// ==========================================

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Dimensions {
  w: number;
  h: number;
}

// ==========================================
// Objekty v editoru (areál, haly, pracoviště...)
// ==========================================

export type ObjectType = 'areal' | 'hala' | 'pracoviste' | 'sklad' | 'cesta' | 'vstup';
export type EntranceType = 'vjezd' | 'vyjezd' | 'oboji';
export type DrawConstraint = 'h' | 'v' | null;
export type DrawType = ObjectType | null;

export interface Entrance {
  id: number;
  edgeIndex: number;
  t1: number;
  t2: number;
  type: EntranceType;
  name: string;
  width: number;
}

export interface Gate {
  id: number;
  t: number;
  width: number;
  name: string;
}

export interface Wall {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  name: string;
  gates: Gate[];
}

export interface EntrancePlacePoint {
  objId: number;
  edgeIndex: number;
  t: number;
  px: number;
  py: number;
}

export interface EdgeSnap {
  edgeType: string;
  edgeIndex?: number;
  wallId?: number;
  x: number;
  y: number;
  t: number;
  edgeStart: Point;
  edgeEnd: Point;
  edgeLen: number;
  distFromStart: number;
}

export interface RoomLabel {
  id: number;
  name: string;
  x: number;
  y: number;
}

export interface DrawingObject {
  id: number;
  type: ObjectType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  points?: Point[];
  color: string;
  fillColor: string;
  rotation: number;
  locked?: boolean;
  entrances?: Entrance[];
  walls?: Wall[];
  rooms?: RoomLabel[];
}

export interface Connection {
  from: number;
  to: number;
}

// ==========================================
// Editor State (vytvoření areálu)
// ==========================================

export interface EditorState {
  objects: DrawingObject[];
  connections: Connection[];
  nextId: number;
  selected: number | null;
  zoom: number;
  panX: number;
  panY: number;
  gridVisible: boolean;
  snapEnabled: boolean;
  snapSize: number;
  pxPerMeter: number;

  // Drawing modes
  drawMode: boolean;
  drawType: DrawType;
  drawPoints: Point[];
  drawConstraint: DrawConstraint;
  drawDistance: number | null;

  // Entrance placement
  entrancePlaceMode: boolean;
  entrancePlaceType: EntranceType;
  entrancePlaceStep: number;
  entrancePlaceFirstPoint: EntrancePlacePoint | null;

  // Wall drawing
  wallDrawMode: boolean;
  wallDrawObjId: number | null;
  wallDrawStart: Point | null;
  wallDrawSnap: EdgeSnap | null;

  // Gate placement
  gatePlaceMode: boolean;
  gatePlaceWallId: number | null;
  gatePlaceObjId: number | null;

  // Room labels
  roomLabelPlaceMode: boolean;
  roomLabelPlaceObjId: number | null;

  // Connection mode
  connectMode: boolean;
  connectFrom: number | null;

  // Simulation context
  currentSimId: string | null;
  currentSimName: string;
}

// ==========================================
// Programování výroby
// ==========================================

export interface WorkstationConfig {
  w: number;
  h: number;
}

export interface FactorifyWorkstation {
  id: string;
  name: string;
  code: string;
  type?: string;
  active: boolean;
  raw?: Record<string, unknown>;
}

export interface WsConfigData {
  dimensions: Record<string, WorkstationConfig>;
  defaultWsSize: WorkstationConfig;
  enabledIds: string[];
}

export interface ProgrammingState extends EditorState {
  arealId: string | null;
  arealName: string;
  arealObjects: DrawingObject[];
}

export interface ProgrammingProject {
  id: string;
  name: string;
  version: number;
  arealId: string;
  arealName: string;
  objects: DrawingObject[];
  connections: Connection[];
  nextId: number;
  viewport: Viewport;
  wsConfig: WsConfigData;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Simulace výroby
// ==========================================

export interface Product {
  id: string;
  name: string;
  code: string;
  type?: string;
  workflowId?: string;
}

export interface RouteOperation {
  id: string;
  name: string;
  stageId: string;
  stageName: string;
  duration: number;
  order: number;
}

export type TokenState = 'waiting' | 'moving' | 'processing' | 'done';

export interface Token {
  id: string;
  currentStep: number;
  x: number;
  y: number;
  state: TokenState;
  progress: number;
  startTime?: number;
  targetX?: number;
  targetY?: number;
}

export interface StationUtilization {
  busy: number;
  idle: number;
}

export interface SimMetrics {
  totalTime: number;
  productiveTime: number;
  waitTime: number;
  moveTime: number;
  stationUtil: Record<string, StationUtilization>;
  bottlenecks: string[];
}

export interface SimulationState {
  arealId: string | null;
  arealName: string;
  arealObjects: DrawingObject[];
  objects: DrawingObject[];
  connections: Connection[];

  currentProgId: string | null;
  currentProgName: string;
  selectedProduct: Product | null;

  route: RouteOperation[];

  simRunning: boolean;
  simPaused: boolean;
  simFinished: boolean;
  simTime: number;
  simSpeed: number;
  simBatchSize: number;
  simMoveSpeed: number;
  simAnimFrame: number | null;

  tokens: Token[];
  metrics: SimMetrics;

  // UI state
  zoom: number;
  panX: number;
  panY: number;
  pxPerMeter: number;
}

// ==========================================
// Pracovní postup
// ==========================================

export interface WorkProcedureProduct {
  id: string;
  name: string;
  code: string;
  type: string;
  unit?: string;
}

// ==========================================
// Uživatelé a autentizace
// ==========================================

export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  displayName: string;
  hash: string;
  salt: string;
  role: UserRole;
  created: string;
}

export interface UserPublic {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  created: string;
}

export interface SessionData {
  userId: number;
  username: string;
  displayName: string;
  role: UserRole;
  created: number;
  lastAccess: number;
}

// ==========================================
// Úložiště simulací / projektů
// ==========================================

export interface SavedSimulation {
  id: string;
  name: string;
  version: number;
  objects: DrawingObject[];
  connections: Connection[];
  nextId: number;
  viewport: Viewport;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// API konfigurace
// ==========================================

export interface FactorifyConfig {
  baseUrl: string;
  securityToken: string;
  endpoints: {
    entities: string;
    entityMeta: string;
    query: string;
  };
  headers: Record<string, string>;
  workstationEntity: string;
}

// ==========================================
// Editor Config (barvy, velikosti)
// ==========================================

export interface ObjectColors {
  areal: string;
  hala: string;
  pracoviste: string;
  sklad: string;
  cesta: string;
  vstup: string;
}

export interface DefaultSizes {
  areal: Dimensions;
  hala: Dimensions;
  pracoviste: Dimensions;
  sklad: Dimensions;
  cesta: Dimensions;
}

export interface EditorConfig {
  COLORS: ObjectColors;
  FILL_COLORS: ObjectColors;
  DEFAULT_SIZES: DefaultSizes;
  POLYGON_TYPES: ObjectType[];
  ENTRANCE_TYPES: { type: EntranceType; label: string; color: string; icon: string }[];
  COLOR_SWATCHES: string[];
}

// ==========================================
// History (Undo/Redo)
// ==========================================

export interface HistorySnapshot {
  objects: DrawingObject[];
  connections: Connection[];
  nextId: number;
}
