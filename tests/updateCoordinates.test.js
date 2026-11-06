const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('js/app.js', 'utf8');

const sandbox = {
    coordsLocked: false,
    coordsDisplayEnabled: true,
    isMobileLayoutActive: false,
    latestCoordinatePoint: null,
    currentLatLonBounds: {
        north: 73,
        south: 1.24,
        east: -48.34375,
        west: 71.65625
    },
    currentBounds: [[0, 0], [6144, 8192]],
    updateCoordinateDisplay: () => {}, // Mocked below
    coordinateDisplay: { hidden: false, style: { display: 'block' } },
    toggleCoordsBtn: null,
    mobileCoordsBtn: null,
    safeSetStorage() {},
    UX_STORAGE_KEYS: { coordsVisible: 'coords' },
    trackAnalytics() {},
    console,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean
};

// Extract functions securely without relying on strict formatting.
const functionNames = [
    'getMapPixelDimensions',
    'projectMapPointToLatLon',
    'renderLatestCoordinates',
    'updateCoordinates',
    'setCoordsDisplayVisible'
];

let extractedCode = '';
for (const fnName of functionNames) {
    const fnRegex = new RegExp(`function\\s+${fnName}\\s*\\([\\s\\S]*?\\)\\s*{`);
    const match = appSource.match(fnRegex);
    if (!match) throw new Error(`Could not find function ${fnName}`);

    let startIndex = match.index;
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    let endIndex = startIndex;

    // Find the matching closing brace
    for (let i = startIndex; i < appSource.length; i++) {
        const char = appSource[i];
        const prevChar = i > 0 ? appSource[i-1] : '';

        if (!inString && (char === "'" || char === '"' || char === '`')) {
            inString = true;
            stringChar = char;
        } else if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
        } else if (!inString) {
            if (char === '{') braceCount++;
            else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                    endIndex = i + 1;
                    break;
                }
            }
        }
    }
    extractedCode += appSource.slice(startIndex, endIndex) + '\n\n';
}

vm.createContext(sandbox);
vm.runInContext(extractedCode, sandbox);

let lastLatLon = null;
sandbox.updateCoordinateDisplay = (lat, lon) => {
    lastLatLon = { lat, lon };
};

const assertClose = (actual, expected, epsilon = 1e-9) => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
};

// Top-left corner should map to the northern & western bounds.
sandbox.updateCoordinates({ latlng: { lat: 6144, lng: 0 } });
assertClose(lastLatLon.lat, 73);
assertClose(lastLatLon.lon, 71.65625);

// Bottom-right corner should map to the southern & eastern bounds.
sandbox.updateCoordinates({ latlng: { lat: 0, lng: 8192 } });
assertClose(lastLatLon.lat, 1.24);
assertClose(lastLatLon.lon, -48.34375);

// Midpoint should be halfway between bounds.
sandbox.updateCoordinates({ latlng: { lat: 3072, lng: 4096 } });
assertClose(lastLatLon.lat, 37.120000000000005);
assertClose(lastLatLon.lon, 11.65625);

// The pure projection helper should preserve the same interpolation semantics.
const projected = sandbox.projectMapPointToLatLon(
    { lat: 1536, lng: 2048 },
    sandbox.currentLatLonBounds,
    sandbox.currentBounds
);
assertClose(projected.lat, 19.18);
assertClose(projected.lon, 41.65625);

let projectionCount = 0;
const project = sandbox.projectMapPointToLatLon;
sandbox.projectMapPointToLatLon = (...args) => {
    projectionCount++;
    return project(...args);
};

// Hidden hover only remembers the latest point; it does no projection or rendering.
sandbox.setCoordsDisplayVisible(false);
lastLatLon = null;
for (let index = 0; index < 100; index++) {
    sandbox.updateCoordinates({ latlng: { lat: 1000 + index, lng: 2000 + index } });
}
assert.equal(lastLatLon, null);
assert.equal(projectionCount, 0);
sandbox.setCoordsDisplayVisible(true);
const latestProjected = project({ lat: 1099, lng: 2099 }, sandbox.currentLatLonBounds, sandbox.currentBounds);
assertClose(lastLatLon.lat, latestProjected.lat);
assertClose(lastLatLon.lon, latestProjected.lon);
assert.equal(projectionCount, 1, 'revealing coordinates renders the latest hidden point');

// Advanced-control visibility can hide the display while the preference stays enabled.
for (const hiddenBy of ['style', 'hidden']) {
    if (hiddenBy === 'style') sandbox.coordinateDisplay.style.display = 'none';
    else sandbox.coordinateDisplay.hidden = true;
    assert.equal(sandbox.coordsDisplayEnabled, true);
    lastLatLon = null;
    projectionCount = 0;
    for (let index = 0; index < 100; index++) {
        sandbox.updateCoordinates({ latlng: { lat: 1700 + index, lng: 2700 + index } });
    }
    assert.equal(projectionCount, 0, `${hiddenBy}-hidden coordinates must not project`);
    assert.equal(lastLatLon, null, `${hiddenBy}-hidden coordinates must not render`);
    sandbox.coordinateDisplay.hidden = false;
    sandbox.setCoordsDisplayVisible(true);
    const revealed = project({ lat: 1799, lng: 2799 }, sandbox.currentLatLonBounds, sandbox.currentBounds);
    assertClose(lastLatLon.lat, revealed.lat);
    assertClose(lastLatLon.lon, revealed.lon);
    assert.equal(projectionCount, 1, `${hiddenBy}-hidden coordinates reveal the latest point`);
}

// Mobile layout keeps the desktop coordinate display hidden even when enabled.
sandbox.isMobileLayoutActive = true;
lastLatLon = null;
projectionCount = 0;
sandbox.updateCoordinates({ latlng: { lat: 1400, lng: 2400 } });
sandbox.setCoordsDisplayVisible(true);
assert.equal(lastLatLon, null);
assert.equal(projectionCount, 0);
sandbox.isMobileLayoutActive = false;
sandbox.setCoordsDisplayVisible(true);

// Locked coordinates should prevent hover updates from mutating state.
sandbox.coordsLocked = true;
const savedPoint = sandbox.latestCoordinatePoint;
lastLatLon = null;
sandbox.updateCoordinates({ latlng: { lat: 0, lng: 0 } });
assert.equal(lastLatLon, null);
assert.equal(sandbox.latestCoordinatePoint, savedPoint);

// Exercise the actual double-click handler: capture the event point before locking.
let doubleClick;
sandbox.map = { on(name, callback) { assert.equal(name, 'dblclick'); doubleClick = callback; } };
sandbox.isMeasuringMultiPoint = false;
sandbox.filtersPanelVisible = false;
sandbox.searchResultsContainer = { style: { display: 'none' } };
sandbox.setMapBlurbVisible = () => {};
const handlerStart = appSource.indexOf("map.on('dblclick', function (e) {");
const handlerEnd = appSource.indexOf('// --- Blurb Element Click Stop ---', handlerStart);
vm.runInContext(appSource.slice(handlerStart, handlerEnd), sandbox);
sandbox.coordsLocked = false;
sandbox.updateCoordinates({ latlng: { lat: 3072, lng: 4096 } });
doubleClick({ latlng: { lat: 6144, lng: 0 } });
assert.equal(sandbox.coordsLocked, true);
assertClose(lastLatLon.lat, 73);
assertClose(lastLatLon.lon, 71.65625);
sandbox.updateCoordinates({ latlng: { lat: 0, lng: 8192 } });
assertClose(lastLatLon.lat, 73);
assertClose(lastLatLon.lon, 71.65625);

// Hiding and revealing a locked point preserves the lock and its captured value.
sandbox.setCoordsDisplayVisible(false);
lastLatLon = null;
sandbox.updateCoordinates({ latlng: { lat: 0, lng: 8192 } });
sandbox.setCoordsDisplayVisible(true);
assert.equal(sandbox.coordsLocked, true);
assertClose(lastLatLon.lat, 73);
assertClose(lastLatLon.lon, 71.65625);

doubleClick({ latlng: { lat: 0, lng: 8192 } });
assert.equal(sandbox.coordsLocked, false);
sandbox.updateCoordinates({ latlng: { lat: 0, lng: 8192 } });
assertClose(lastLatLon.lat, 1.24);
assertClose(lastLatLon.lon, -48.34375);

// Locking while hidden captures the double-click point without projecting it.
sandbox.setCoordsDisplayVisible(false);
projectionCount = 0;
lastLatLon = null;
doubleClick({ latlng: { lat: 3072, lng: 4096 } });
assert.equal(sandbox.coordsLocked, true);
assert.equal(lastLatLon, null);
assert.equal(projectionCount, 0);
sandbox.setCoordsDisplayVisible(true);
assertClose(lastLatLon.lat, 37.120000000000005);
assertClose(lastLatLon.lon, 11.65625);

// A different map must not reuse a remembered point against its new bounds.
sandbox.currentBounds = [[0, 0], [1024, 1024]];
lastLatLon = null;
sandbox.setCoordsDisplayVisible(true);
assert.equal(lastLatLon, null);

// Missing bounds should no-op instead of throwing.
sandbox.coordsLocked = false;
sandbox.currentBounds = null;
lastLatLon = null;
sandbox.updateCoordinates({ latlng: { lat: 0, lng: 0 } });
assert.equal(lastLatLon, null);

console.log('updateCoordinates regression checks passed');
