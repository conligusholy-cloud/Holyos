/* ============================================
   history.ts — Undo/Redo systém
   ============================================ */

import type { HistorySnapshot } from '../../../shared/types.js';
import { state } from './state.js';
import { renderAll, showToast } from './renderer.js';
import { showProperties, deselectAll } from './properties.js';

export interface UndoRedoHistory {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  maxSize: number;
}

export const undoHistory: UndoRedoHistory = {
  undoStack: [],
  redoStack: [],
  maxSize: 50,
};

export function getStateSnapshot(): HistorySnapshot {
  return {
    objects: JSON.parse(JSON.stringify(state.objects)),
    connections: JSON.parse(JSON.stringify(state.connections)),
    nextId: state.nextId,
  };
}

export function restoreSnapshot(snap: HistorySnapshot): void {
  state.objects = snap.objects;
  state.connections = snap.connections;
  state.nextId = snap.nextId;
  state.selected = null;
  renderAll();
  const propsPanel = document.getElementById('properties');
  if (propsPanel) {
    propsPanel.className = 'empty-state';
    propsPanel.innerHTML = '<p>Vyber objekt na plátně<br>nebo přetáhni z palety</p>';
  }
}

export function pushUndo(): void {
  undoHistory.undoStack.push(getStateSnapshot());
  if (undoHistory.undoStack.length > undoHistory.maxSize) {
    undoHistory.undoStack.shift();
  }
  undoHistory.redoStack = [];
}

export function undo(): void {
  if (undoHistory.undoStack.length === 0) {
    showToast('Nic k vrácení');
    return;
  }
  undoHistory.redoStack.push(getStateSnapshot());
  const snap = undoHistory.undoStack.pop();
  if (snap) {
    restoreSnapshot(snap);
  }
  showToast('Vráceno zpět (Ctrl+Z)');
}

export function redo(): void {
  if (undoHistory.redoStack.length === 0) {
    showToast('Nic k zopakování');
    return;
  }
  undoHistory.undoStack.push(getStateSnapshot());
  const snap = undoHistory.redoStack.pop();
  if (snap) {
    restoreSnapshot(snap);
  }
  showToast('Zopakováno (Ctrl+Y)');
}
