import type { Point, DrawingObject } from '../../../shared/types.js';
export interface DomElements {
    svg: SVGSVGElement | null;
    container: HTMLElement | null;
    objectLayer: SVGGElement | null;
    connectionLayer: SVGGElement | null;
    snapLayer: SVGGElement | null;
    labelLayer: SVGGElement | null;
    drawLayer: SVGGElement | null;
    gridRect: SVGRectElement | null;
    zoomDisplay: HTMLElement | null;
    coordsDisplay: HTMLElement | null;
    propsPanel: HTMLElement | null;
    fileInput: HTMLInputElement | null;
    ghost: HTMLElement | null;
    drawStatus: HTMLElement | null;
}
export declare const dom: DomElements;
export declare function initDom(): void;
export interface ScreenCoord {
    x: number;
    y: number;
}
export declare function screenToWorld(sx: number, sy: number): ScreenCoord;
export declare function worldToScreen(wx: number, wy: number): ScreenCoord;
export declare function snapToGrid(val: number): number;
export declare function updateTransform(): void;
export declare function renderAll(): void;
export declare function svgEl(tag: string): SVGElement;
export declare function getObjectCenter(obj: DrawingObject): Point;
export declare function getPolygonCentroid(pts: Point[]): Point;
export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export declare function getPolygonBBox(pts: Point[]): BBox;
export declare function getPolygonArea(pts: Point[]): number;
export declare function getPolygonSignedArea(pts: Point[]): number;
export declare function showToast(message: string): void;
export declare function resizeSVG(): void;
