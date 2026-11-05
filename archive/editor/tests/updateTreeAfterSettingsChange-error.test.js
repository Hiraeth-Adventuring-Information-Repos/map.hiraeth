const assert = require('node:assert/strict');
const fs = require('node:fs');

const editorSource = fs.readFileSync('js/map-editor.js', 'utf8');

// We need to extract the part of the code where the event listener is defined
// Specifically, registerEventListeners()

const fnStart = editorSource.indexOf('function registerEventListeners() {');
const fnEnd = editorSource.indexOf('async function initializeEditor() {');

if (fnStart === -1 || fnEnd === -1 || fnEnd <= fnStart) {
    throw new Error('Could not locate registerEventListeners block in js/map-editor.js');
}

const fnSource = editorSource.slice(fnStart, fnEnd);

let mapSettingsFormChangeHandler = null;

// Mock dependencies
global.state = {
    currentMap: { id: 'test-map' } // Make sure the early return isn't hit
};

let setSelectionStatusCalledWith = null;
global.setSelectionStatus = (msg) => {
    setSelectionStatusCalledWith = msg;
};

// Mock console.error
const originalConsoleError = console.error;
let consoleErrorCalledWith = null;
console.error = (err) => {
    consoleErrorCalledWith = err;
};

// We will mock this to throw
global.updateTreeAfterSettingsChange = () => {
    throw new Error('Test forced error');
};

global.debounce = (fn) => fn;
global.updateSelectedFeatureFromForm = () => {};
global.saveCurrentMapJson = () => {};
global.saveAtlasStructure = () => {};
global.buildLivePreview = () => {};
global.exportCurrentMapJson = () => {};
global.exportAtlasStructure = () => {};
global.openExportDialog = () => {};
global.closeExportDialog = () => {};
global.finishDraftGeometry = () => {};
global.undoDraftPoint = () => {};
global.toggleSelectedPointCurve = () => {};
global.clearDrawMode = () => {};
global.beginDrawMode = () => {};
global.startFocusedFeatureCreation = () => {};
global.deleteSelectedFeature = () => {};
global.queueMapViewportReset = () => {};
global.markCurrentMapDirty = () => {};
global.setInspectorCollapsed = () => {};
global.registerInspectorResize = () => {};
global.registerInspectorTabs = () => {};
global.undoEditorChange = () => {};
global.redoEditorChange = () => {};
global.closeUnsavedDialog = () => {};
global.canMutateWorkspace = () => true;

// Proxy dom to automatically return a mocked element with addEventListener
global.dom = new Proxy({}, {
    get: function(target, prop) {
        if (prop === 'toolButtons' || prop === 'appMenuButtons' || prop === 'appMenus' || prop === 'appMenuItems') return [];
        if (prop === 'mapSettingsForm') {
            return {
                addEventListener: (event, handler) => {
                    if (event === 'change') {
                        mapSettingsFormChangeHandler = handler;
                    }
                }
            };
        }
        return { addEventListener: () => {} };
    }
});

global.window = {
    addEventListener: () => {},
    location: { reload: () => {} }
};
global.document = {
    addEventListener: () => {}
};

// Evaluate
// eslint-disable-next-line no-eval
eval(fnSource);

// Run the setup function
registerEventListeners();

// Trigger the handler
assert.ok(mapSettingsFormChangeHandler, 'Change handler should be registered');
mapSettingsFormChangeHandler();

// Check if error was logged
assert.equal(consoleErrorCalledWith.message, 'Test forced error');

// Check if setSelectionStatus was called correctly
assert.equal(setSelectionStatusCalledWith, 'Test forced error');

// Now test fallback error message
global.updateTreeAfterSettingsChange = () => {
    throw 'String error'; // A non-Error object that might not have a message property
};
mapSettingsFormChangeHandler();
assert.equal(setSelectionStatusCalledWith, 'Could not apply map settings.');

// Restore console.error
console.error = originalConsoleError;

console.log('updateTreeAfterSettingsChange error handling regression checks passed');
