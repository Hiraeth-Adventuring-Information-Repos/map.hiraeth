const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/app.js', 'utf8');
const start = appSource.indexOf('function applySearchParamsToCurrentMap');
const end = appSource.indexOf('function createPopupContent');

if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not locate applySearchParamsToCurrentMap in js/app.js');
}

const functionSource = appSource.slice(start, end);

global.window = { location: { search: '' } };

let checkAndFocusFeatureCalled = false;
let checkAndFocusFeatureReturnValue = false;
global.checkAndFocusFeature = () => {
    checkAndFocusFeatureCalled = true;
    return checkAndFocusFeatureReturnValue;
};

let resolveInitialMapViewportReturnValue = { mode: 'fit-bounds' };
let resolveInitialMapViewportArgs = null;
global.resolveInitialMapViewport = (params) => {
    resolveInitialMapViewportArgs = params;
    return resolveInitialMapViewportReturnValue;
};

let mapSetViewArgs = null;
let mapFitBoundsArgs = null;
global.map = {
    setView: (center, zoom, options) => {
        mapSetViewArgs = { center, zoom, options };
    },
    fitBounds: (bounds) => {
        mapFitBoundsArgs = bounds;
    }
};

let trackShareViewOpenFromParamsArgs = null;
global.trackShareViewOpenFromParams = (params, rawView) => {
    trackShareViewOpenFromParamsArgs = { params, rawView };
};

let getShareContextFromParamsReturnValue = null;
global.getShareContextFromParams = () => {
    return getShareContextFromParamsReturnValue;
};

let showShareRelayPromptArgs = null;
global.showShareRelayPrompt = (context) => {
    showShareRelayPromptArgs = context;
};

global.currentBounds = null;
let zoomFloorOptions;
global.syncMapZoomFloor = options => { zoomFloorOptions = options; };

// eslint-disable-next-line no-eval
eval(functionSource);

function resetMocks() {
    checkAndFocusFeatureCalled = false;
    checkAndFocusFeatureReturnValue = false;
    resolveInitialMapViewportReturnValue = { mode: 'fit-bounds' };
    resolveInitialMapViewportArgs = null;
    mapSetViewArgs = null;
    mapFitBoundsArgs = null;
    trackShareViewOpenFromParamsArgs = null;
    getShareContextFromParamsReturnValue = null;
    showShareRelayPromptArgs = null;
    global.currentBounds = null;
    zoomFloorOptions = null;
}

// Test case 1: When params have 'poi'/'region'/'line' and checkAndFocusFeature returns true
resetMocks();
checkAndFocusFeatureReturnValue = true;
let params = new URLSearchParams('poi=test');
let result = applySearchParamsToCurrentMap(params);
assert.equal(result, true, 'Should return true when feature is focused');
assert.equal(checkAndFocusFeatureCalled, true, 'Should call checkAndFocusFeature');

resetMocks();
checkAndFocusFeatureReturnValue = true;
params = new URLSearchParams('region=test');
result = applySearchParamsToCurrentMap(params);
assert.equal(result, true, 'Should return true when region feature is focused');
assert.equal(checkAndFocusFeatureCalled, true, 'Should call checkAndFocusFeature');

resetMocks();
checkAndFocusFeatureReturnValue = true;
params = new URLSearchParams('line=test');
result = applySearchParamsToCurrentMap(params);
assert.equal(result, true, 'Should return true when line feature is focused');
assert.equal(checkAndFocusFeatureCalled, true, 'Should call checkAndFocusFeature');

// Test case 2: When resolveInitialMapViewport returns explicit view
resetMocks();
params = new URLSearchParams('view=10,20,5');
resolveInitialMapViewportReturnValue = {
    mode: 'explicit-view',
    view: { lat: 10, lng: 20, zoom: 5 },
    rawView: '10,20,5'
};
getShareContextFromParamsReturnValue = { some: 'context' };
result = applySearchParamsToCurrentMap(params);
assert.equal(result, false, 'Should return false when explicit view is set');
assert.deepEqual(mapSetViewArgs, { center: [10, 20], zoom: 5, options: { animate: false } }, 'Should call map.setView with correct args');
assert.deepEqual(trackShareViewOpenFromParamsArgs, { params, rawView: '10,20,5' }, 'Should call trackShareViewOpenFromParams');
assert.deepEqual(showShareRelayPromptArgs, { some: 'context' }, 'Should call showShareRelayPrompt when context exists');

// Test case 3: When resolveInitialMapViewport returns explicit view but no share context
resetMocks();
params = new URLSearchParams('view=10,20,5');
resolveInitialMapViewportReturnValue = {
    mode: 'explicit-view',
    view: { lat: 10, lng: 20, zoom: 5 },
    rawView: '10,20,5'
};
getShareContextFromParamsReturnValue = null; // No share context
result = applySearchParamsToCurrentMap(params);
assert.equal(result, false, 'Should return false when explicit view is set');
assert.deepEqual(mapSetViewArgs, { center: [10, 20], zoom: 5, options: { animate: false } }, 'Should call map.setView');
assert.deepEqual(trackShareViewOpenFromParamsArgs, { params, rawView: '10,20,5' }, 'Should call trackShareViewOpenFromParams');
assert.equal(showShareRelayPromptArgs, null, 'Should not call showShareRelayPrompt');

// Test case 4: When resolveInitialMapViewport returns fit bounds and currentBounds is set
resetMocks();
params = new URLSearchParams('');
global.currentBounds = [[-10, -10], [10, 10]];
result = applySearchParamsToCurrentMap(params);
assert.equal(result, false, 'Should return false when fitting bounds');
assert.deepEqual(mapFitBoundsArgs, [[-10, -10], [10, 10]], 'Should call map.fitBounds with currentBounds');
assert.deepEqual(zoomFloorOptions, { explicitZoom: null });

resetMocks();
params = new URLSearchParams('view=3072,4096,-4.5');
resolveInitialMapViewportReturnValue = {
    mode: 'explicit-view',
    view: { lat: 3072, lng: 4096, zoom: -4.5 },
    rawView: '3072,4096,-4.5'
};
applySearchParamsToCurrentMap(params);
assert.deepEqual(zoomFloorOptions, { explicitZoom: -4.5 });
assert.equal(mapSetViewArgs.zoom, -4.5);

console.log('applySearchParamsToCurrentMap checks passed');
