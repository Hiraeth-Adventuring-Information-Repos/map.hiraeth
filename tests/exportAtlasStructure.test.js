const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/map-editor.js', 'utf8');

const fnStart = appSource.indexOf('function exportAtlasStructure() {');
const fnEnd = appSource.indexOf('async function selectMap(', fnStart);

if (fnStart === -1 || fnEnd === -1 || fnEnd <= fnStart) {
    throw new Error('Could not locate exportAtlasStructure in js/map-editor.js');
}

const fnSource = appSource.slice(fnStart, fnEnd);

// Setup globals required by the eval
global.utils = {};
global.state = {};
global.readMapSettingsForm = () => {};
global.downloadJsonFile = () => {};
global.setExportStatus = () => {};

// Eval the function so it becomes globally available in the test context
global.fileDocuments = require('../js/map-file-document');
const wrapperStart = appSource.indexOf('function serializePreservedManifest(');
const wrapperEnd = appSource.indexOf('function serializePreservedMap(', wrapperStart);
assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart);
// eslint-disable-next-line no-eval
eval(appSource.slice(wrapperStart, wrapperEnd) + '\n' + fnSource);

// --- Mocks ---

let serializeFlatManifestStateArgs = null;
let serializeFlatManifestStateError = null;
global.utils.serializeFlatManifestState = (args) => {
    serializeFlatManifestStateArgs = args;
    if (serializeFlatManifestStateError) {
        throw serializeFlatManifestStateError;
    }
    return { mockManifest: true };
};

let downloadJsonFileArgs = null;
global.downloadJsonFile = (filename, value) => {
    downloadJsonFileArgs = { filename, value };
};

let exportStatusMessage = null;
let exportStatusIsError = null;
global.setExportStatus = (message, isError) => {
    exportStatusMessage = message;
    exportStatusIsError = isError;
};

let readMapSettingsFormCalled = false;
global.readMapSettingsForm = () => {
    readMapSettingsFormCalled = true;
    return { mockSettings: true };
};

const originalConsoleError = console.error;
let consoleErrorArgs = null;
console.error = (...args) => {
    consoleErrorArgs = args;
};

// Reset mocks before each test
function resetMocks() {
    serializeFlatManifestStateArgs = null;
    serializeFlatManifestStateError = null;
    downloadJsonFileArgs = null;
    exportStatusMessage = null;
    exportStatusIsError = null;
    readMapSettingsFormCalled = false;
    consoleErrorArgs = null;

    global.state = {
        atlasTree: [{ id: 'mock-tree-node' }],
        currentMapId: '',
        currentMap: null
    };
}

// --- Tests ---

// 1. Happy path: With currentMap
resetMocks();
global.state.currentMapId = 'map-123';
global.state.currentMap = { id: 'map-123' };

exportAtlasStructure();

assert.equal(readMapSettingsFormCalled, true);
assert.deepEqual(serializeFlatManifestStateArgs, {
    masterMapData: [{ id: 'mock-tree-node' }],
    currentMapId: 'map-123',
    mapSettings: { mockSettings: true }
});
assert.deepEqual(downloadJsonFileArgs, {
    filename: 'maps.json',
    value: { mockManifest: true }
});
assert.equal(exportStatusMessage, 'Exported maps.json.');
assert.equal(exportStatusIsError, undefined);
assert.equal(consoleErrorArgs, null);

// 2. Happy path: Without currentMap
resetMocks();
global.state.currentMapId = '';
global.state.currentMap = null;

exportAtlasStructure();

assert.equal(readMapSettingsFormCalled, false);
assert.deepEqual(serializeFlatManifestStateArgs, {
    masterMapData: [{ id: 'mock-tree-node' }],
    currentMapId: '',
    mapSettings: {}
});
assert.deepEqual(downloadJsonFileArgs, {
    filename: 'maps.json',
    value: { mockManifest: true }
});
assert.equal(exportStatusMessage, 'Exported maps.json.');
assert.equal(exportStatusIsError, undefined);
assert.equal(consoleErrorArgs, null);

// 3. Error path: Exception thrown
resetMocks();
const mockError = new Error('Test mock error');
serializeFlatManifestStateError = mockError;

exportAtlasStructure();

assert.equal(downloadJsonFileArgs, null);
assert.deepEqual(consoleErrorArgs, [mockError]);
assert.equal(exportStatusMessage, 'Test mock error');
assert.equal(exportStatusIsError, true);

// 4. Error path: Exception with no message
resetMocks();
serializeFlatManifestStateError = 'String error'; // No .message

exportAtlasStructure();

assert.equal(downloadJsonFileArgs, null);
assert.deepEqual(consoleErrorArgs, ['String error']);
assert.equal(exportStatusMessage, 'Could not export maps.json.');
assert.equal(exportStatusIsError, true);

// Preserve source-only index metadata and its envelope on export.
resetMocks();
const rawEntry = { id: 'map-123', dataUrl: 'maps/source.json', name: 'Before', custom: { retained: true } };
const baselineEntry = { id: 'map-123', dataUrl: 'maps/source.json', name: 'Before' };
const session = fileDocuments.createSession(rawEntry, baselineEntry);
global.state.manifestSource = { maps: [rawEntry], campaign: 'Preserved' };
global.state.manifestSnapshots = { 'map-123': session.snapshot };
global.utils.cloneJson = value => JSON.parse(JSON.stringify(value));
global.utils.serializeFlatManifestState = () => [{ ...baselineEntry, name: 'After' }];
exportAtlasStructure();
assert.deepEqual(downloadJsonFileArgs.value, { campaign: 'Preserved', maps: [{ ...rawEntry, name: 'After' }] });
assert.equal(consoleErrorArgs, null);

// Restore original console.error
console.error = originalConsoleError;

console.log('exportAtlasStructure tests passed');
