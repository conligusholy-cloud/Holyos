/* ============================================
   history.js — Undo/Redo systém
   ============================================ */

const undoHistory = {
  undoStack: [],
  redoStack: [],
  maxSize: 50,
};

function getStateSnapshot() {
  return {
    objects: JSON.parse(JSON.stringify(state.objects)),
    connections: JSON.parse(JSON.stringify(state.connections)),
    nextId: state.nextId,
  };
}

function restoreSnapshot(snap) {
  state.objects = snap.objects;
  state.connections = snap.connections;
  state.nextId = snap.nextId;
  state.selected = null;
  renderAll();
  dom.propsPanel.className = 'empty-state';
  dom.propsPanel.innerHTML = '<p>Vyber objekt na plátně<br>nebo přetáhni z palety</p>';
}

function pushUndo() {
  undoHistory.undoStack.push(getStateSnapshot());
  if (undoHistory.undoStack.length > undoHistory.maxSize) {
    undoHistory.undoStack.shift();
  }
  undoHistory.redoStack = [];
}

function undo() {
  if (undoHistory.undoStack.length === 0) {
    showToast('Nic k vrácení');
    return;
  }
  undoHistory.redoStack.push(getStateSnapshot());
  const snap = undoHistory.undoStack.pop();
  restoreSnapshot(snap);
  showToast('Vráceno zpět (Ctrl+Z)');
}

function redo() {
  if (undoHistory.redoStack.length === 0) {
    showToast('Nic k zopakování');
    return;
  }
  undoHistory.undoStack.push(getStateSnapshot());
  const snap = undoHistory.redoStack.pop();
  restoreSnapshot(snap);
  showToast('Zopakováno (Ctrl+Y)');
}
