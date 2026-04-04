import type { DrawingObject, Point, ObjectType, EntranceType } from '../../../shared/types.js';
export declare function createObject(type: ObjectType, x: number, y: number): DrawingObject;
export declare function createPolygonObject(type: ObjectType | null, points: Point[]): DrawingObject | null;
export declare function deleteObject(id: number): void;
export declare function duplicateObject(id: number): void;
export declare function findObjectAt(wx: number, wy: number): DrawingObject | null;
export declare function selectObject(id: number): void;
export declare function updateProp(key: string, value: unknown): void;
export declare function updateColor(color: string): void;
export declare function movePolygon(obj: DrawingObject, dx: number, dy: number): void;
export declare function moveVertex(obj: DrawingObject, index: number, newX: number, newY: number): void;
export declare function rotatePolygon(objId: number, angleDeg: number, centerIndex: number | null): void;
export declare function addEntrance(objId: number, edgeIndex: number, t1: number, t2: number, type: EntranceType): void;
export declare function removeEntrance(objId: number, entranceId: number): void;
export declare function updateEntranceProp(objId: number, entranceId: number, key: string, value: unknown): void;
export declare function updateEntranceWidth(objId: number, entranceId: number, newWidthMeters: number): void;
interface NearestEdgeResult {
    objId: number;
    edgeIndex: number;
    t: number;
    dist: number;
    px: number;
    py: number;
}
export declare function findNearestArealEdge(wx: number, wy: number): NearestEdgeResult | null;
export declare function addWall(objId: number, x1: number, y1: number, x2: number, y2: number): void;
export declare function removeWall(objId: number, wallId: number): void;
export declare function addGate(objId: number, wallId: number, t: number, width: number): void;
export declare function removeGate(objId: number, wallId: number, gateId: number): void;
interface NearestWallResult {
    wallId: number;
    t: number;
    dist: number;
    px: number;
    py: number;
}
export declare function findNearestWall(obj: DrawingObject, wx: number, wy: number): NearestWallResult | null;
interface ProjectedResult {
    wallId: number;
    t: number;
    dist: number;
    px: number;
    py: number;
}
export declare function projectOntoWall(obj: DrawingObject, wallId: number, wx: number, wy: number): ProjectedResult | null;
export declare function addRoomLabel(objId: number, x: number, y: number): void;
export declare function removeRoomLabel(objId: number, roomId: number): void;
export declare function updateRoomLabelProp(objId: number, roomId: number, prop: string, value: unknown): void;
export {};
