const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const invalidPairs = [
    [null, ''], ['0', 1], [1, '2.5'], [true, 0], [0, false], [undefined, 0],
    [Infinity, 0], [0, -Infinity], [NaN, 1], [[], 0], [{}, 0],
    [], [0], [0, 1, 2], null, undefined, '00', { 0: 0, 1: 0, length: 2 }, new Array(2)
];
const validPairs = [[0, 0], [0, 12.5], [18.25, 0], [100, 200]];

// Exercise the actual geometry validators, including each feature entry point.
const validatorSource = fs.readFileSync('scripts/validate_map_data.js', 'utf8');
const validationErrors = [];
const validator = {
    addError: message => validationErrors.push(message),
    assertNonEmptyString: () => {}
};
vm.createContext(validator);
vm.runInContext(validatorSource.slice(
    validatorSource.indexOf('function assertCoordinatePair('),
    validatorSource.indexOf('function validateFeatureArray(')
), validator);
for (const [label, validate] of [
    ['point', coords => validator.validatePoint({ name: 'Point', coords }, 'point')],
    ['region', coords => validator.validateRegion({ name: 'Region', coordinates: [coords] }, 'region')],
    ['road', coords => validator.validateLine({ name: 'Road', coordinates: [coords] }, 'road')],
    ['line', coords => validator.validateLine({ type: 'River', coordinates: [coords] }, 'line')]
]) {
    for (const coords of invalidPairs) {
        validationErrors.length = 0;
        validate(coords);
        assert.ok(validationErrors.length, `${label} must reject ${String(coords)}`);
    }
    // Geometry may extend beyond the image; numeric validity adds no spatial bounds.
    for (const coords of [...validPairs, [-12.5, 900000]]) {
        validationErrors.length = 0;
        validate(coords);
        assert.deepEqual(validationErrors, [], `${label} must preserve numeric pairs`);
    }
}

// Run the rendering loop itself; malformed data must never reach L.marker.
const appSource = fs.readFileSync('js/app.js', 'utf8');
const markerCalls = [];
const warnings = [];
const runtime = {
    visiblePointsCache: [...invalidPairs, ...validPairs].map((coords, index) => ({ id: `point-${index}`, name: `Point ${index}`, coords })),
    allMapMarkers: [], allMapMarkersById: new Map(), allMapMarkersByName: new Map(),
    L: { marker(coords) {
        markerCalls.push(coords);
        return { bindPopup() {}, bindTooltip() {}, on() {} };
    } },
    getPoiMarkerAccessibleName: point => point.name,
    getPoiIcon() {}, getPoiGroup() {}, createPopupContent() {},
    createPoiTooltipContent() {}, getPoiTooltipOptions() {}, attachPoiTooltipBehavior() {},
    trackAnalytics() { assert.fail('Invalid pairs should be rejected without throwing'); },
    console: { warn: (...args) => warnings.push(args), error() { assert.fail('Unexpected render error'); } }
};
vm.createContext(runtime);
vm.runInContext(appSource.slice(
    appSource.indexOf('function populatePOIsOnMap('),
    appSource.indexOf('function finalizeMapUI(')
), runtime);
runtime.populatePOIsOnMap({ name: 'Fixture', height: 100, width: 200 });
assert.deepEqual(markerCalls, validPairs, 'only actual numeric pairs reach Leaflet, in original [y, x] order');
assert.equal(runtime.allMapMarkers.length, validPairs.length);
assert.equal(warnings.length, invalidPairs.length);

// Retain the viewer's existing POI bounds, including valid coordinates on all edges.
runtime.visiblePointsCache = [
    { name: 'Outside', coords: [-0.5, 0] }, { name: 'Outside', coords: [0, 200.5] }
];
runtime.populatePOIsOnMap({ name: 'Fixture', height: 100, width: 200 });
assert.equal(markerCalls.length, validPairs.length);
console.log('strict coordinate validation and POI rendering checks passed');
