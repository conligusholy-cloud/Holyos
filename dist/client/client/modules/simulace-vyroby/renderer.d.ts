import { DrawingObject } from '../../../shared/types.js';
export declare function initDom(): void;
export interface WorldCoord {
    x: number;
    y: number;
}
export declare function screenToWorld(sx: number, sy: number): WorldCoord;
export declare function worldToScreen(wx: number, wy: number): WorldCoord;
export declare function updateTransform(): void;
export declare function renderAll(): void;
export declare function renderTokens(): void;
export declare function highlightStation(obj: DrawingObject, active: boolean): void;
export declare function resizeSVG(): void;
export declare function zoomFit(): void;
