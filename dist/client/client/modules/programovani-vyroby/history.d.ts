import type { HistorySnapshot } from '../../../shared/types.js';
export interface UndoRedoHistory {
    undoStack: HistorySnapshot[];
    redoStack: HistorySnapshot[];
    maxSize: number;
}
export declare const undoHistory: UndoRedoHistory;
export declare function getStateSnapshot(): HistorySnapshot;
export declare function restoreSnapshot(snap: HistorySnapshot): void;
export declare function pushUndo(): void;
export declare function undo(): void;
export declare function redo(): void;
