import type { DrawingObject, Point } from '../../../shared/types.js';
export interface DomElements {
    svg: SVGSVGElement | null;
    container: HTMLElement | null;
    objectLayer: SVGGElement | null;
    connectionLayer: SVGGElement | null;
    snapLayer: SVGGElement | null;
    labelLayer: SVGGElement | null;
    drawLayer: SVGGElement | null;
    gridRect: SVGElement | null;
    zoomDisplay: HTMLElement | null;
    coordsDisplay: HTMLElement | null;
    propsPanel: HTMLElement | null;
    fileInput: HTMLInputElement | null;
    ghost: HTMLElement | null;
    drawStatus: HTMLElement | null;
}
export declare const dom: DomElements;
export declare function initDom(): void;
export declare function screenToWorld(sx: number, sy: number): Point;
export declare function worldToScreen(wx: number, wy: number): Point;
export declare function snapToGrid(val: number): number;
export declare function updateTransform(): void;
export declare function renderAll(): void;
export declare function renderDrawPreview(mouseWorld: Point | null): void;
export declare function svgEl(tag: string): SVGElement;
export declare function getPolygonCentroid(pts: Point[]): Point;
interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export declare function getPolygonBBox(pts: Point[]): BBox;
export declare function getPolygonArea(pts: Point[]): number;
export declare function getPolygonSignedArea(pts: Point[]): number;
export declare function isPointInPolygon(px: number, py: number, pts: Point[]): boolean;
export declare function renderEntrancePlacePreview(mouseWorld: Point | null): void;
export declare function renderWallDrawPreview(mouseWorld: Point | null): void;
interface SnapInfo {
    x: number;
    y: number;
    distFromStart: number;
    edgeStart: Point;
    edgeEnd: Point;
}
export declare function renderWallSnapHover(snap: SnapInfo | null): void;
interface ProjectedPoint {
    px: number;
    py: number;
    t: number;
}
export declare function renderGatePlacePreview(obj: DrawingObject | null, wallId: number | null, projected: ProjectedPoint | null): void;
export {};
