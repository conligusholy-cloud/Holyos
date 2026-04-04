/* ============================================
   editor-api.ts — Global API pro funkce volané z HTML
   ============================================ */
import { startDrawMode, cancelDrawMode, startEntrancePlacement, startWallDrawMode, startGatePlacement, startRoomLabelPlacement, showDistanceInput, zoomIn, zoomOut, zoomFit, toggleGrid, toggleSnap, toggleConnectMode, confirmDistanceAndPlace, startEntrancePlacementGlobal } from './interactions.js';
import { createObject, deleteObject, duplicateObject, findObjectAt, selectObject, updateProp, updateColor, rotatePolygon, removeEntrance, updateEntranceProp, updateEntranceWidth, removeWall, removeGate, removeRoomLabel, updateRoomLabelProp } from './objects.js';
import { showProperties, getRotateCenter, updateVertex, updateEdgeDistance, removeVertex, updateGateProp, toggleLock, deselectAll } from './properties.js';
import { saveProject, saveProjectAs, loadProject, exportJSON, exportPNG, confirmSave, closeSaveDialog } from './storage.js';
import { undo, redo } from './history.js';
export function initEditorAPI() {
    // Make editor API available globally
    window.editorAPI = {
        // interactions
        startDrawMode,
        cancelDrawMode,
        startEntrancePlacement,
        startWallDrawMode,
        startGatePlacement,
        startRoomLabelPlacement,
        showDistanceInput,
        zoomIn,
        zoomOut,
        zoomFit,
        toggleGrid,
        toggleSnap,
        toggleConnectMode,
        // objects
        createObject,
        deleteObject,
        duplicateObject,
        findObjectAt,
        selectObject,
        updateProp,
        updateColor,
        rotatePolygon,
        removeEntrance,
        updateEntranceProp,
        updateEntranceWidth,
        removeWall,
        removeGate,
        removeRoomLabel,
        updateRoomLabelProp,
        // properties
        showProperties,
        getRotateCenter,
        updateVertex,
        updateEdgeDistance,
        removeVertex,
        updateGateProp,
        toggleLock,
        deselectAll,
        // storage
        saveProject,
        saveProjectAs,
        loadProject,
        exportJSON,
        exportPNG,
        confirmSave,
        closeSaveDialog,
        // history
        undo,
        redo,
        // extra
        confirmDistanceAndPlace,
        confirmWallPoint: confirmDistanceAndPlace,
        startEntrancePlacementGlobal,
        selectExistingSave: (id, name) => {
            // selectExistingSave only exists in programovani-vyroby module, not here
            console.warn('selectExistingSave not available in vytvoreni-arealu module');
        },
    };
    // Also expose key functions directly on window for HTML toolbar onclick handlers
    const w = window;
    w.zoomIn = zoomIn;
    w.zoomOut = zoomOut;
    w.zoomFit = zoomFit;
    w.undo = undo;
    w.redo = redo;
    w.toggleGrid = toggleGrid;
    w.toggleSnap = toggleSnap;
    w.saveProject = saveProject;
    w.saveProjectAs = saveProjectAs;
    w.loadProject = loadProject;
    w.exportJSON = exportJSON;
    w.exportPNG = exportPNG;
    w.confirmSave = confirmSave;
    w.closeSaveDialog = closeSaveDialog;
    w.confirmDistanceAndPlace = confirmDistanceAndPlace;
    w.startEntrancePlacementGlobal = startEntrancePlacementGlobal;
}
//# sourceMappingURL=editor-api.js.map