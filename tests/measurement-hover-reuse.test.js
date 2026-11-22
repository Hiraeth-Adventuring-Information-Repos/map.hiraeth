const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/app.js', 'utf8');
const counts = { line: 0, tooltip: 0 };
const groupLayers = new Set();
const mapLayers = new Set();
function layer(kind, points) {
    counts[kind]++;
    return {
        points,
        setLatLngs(value) { this.points = value; return this; },
        setLatLng(value) { this.position = value; return this; },
        setContent(value) { this.content = value; return this; },
        addTo(target) { target.layers.add(this); return this; }
    };
}
const classList = { remove() {} };
const sandbox = {
    isMeasuringMultiPoint: true,
    currentlyLoadedMapId: 'test',
    multiPointPath: [{ lat: 0, lng: 0 }],
    temporaryMouseMoveLine: null,
    temporaryMouseMoveTooltip: null,
    getMapRuntimeData: () => ({ scalePixels: 10, scaleKilometers: 2 }),
    L: { Browser: { touch: false }, circleMarker: () => layer('line'), polyline: points => layer('line', points), tooltip: () => layer('tooltip'), point: (x, y) => [x, y] },
    measurementLayerGroup: { layers: groupLayers, removeLayer: value => groupLayers.delete(value), clearLayers: () => groupLayers.clear() },
    map: {
        layers: mapLayers,
        getCenter: () => center,
        distance: (a, b) => Math.hypot(b.lat - a.lat, b.lng - a.lng),
        removeLayer: value => mapLayers.delete(value),
        off() {}, doubleClickZoom: { enable() {} }
    },
    document: { removeEventListener() {} },
    mapElement: { classList, removeAttribute() {} },
    measurementControls: { contains: () => false },
    measurementUndoBtn: {},
    measurementFinishBtn: {},
    isMobileLayoutActive: false,
    lastMeasurementMousePoint: null,
    measurementMouseDoubleClick: false,
    measureToolBtn: { classList, setAttribute() {} },
    mobileMeasureBtn: null,
    measurementDoubleClickZoomWasEnabled: false,
    multiPointPolyline: null,
    multiPointTotalTooltip: null,
    multiPointVertexMarkers: [],
    cachedMultiPointPixelDistance: 0,
    shouldIgnoreMapPointerEvent: () => false,
    updateMeasurementTooltips() {}
};
let center = { lat: 0, lng: 0 };
vm.createContext(sandbox);
for (const [name, next] of [
    ['handleMultiPointMeasureClick', 'handleMultiPointMouseMove'],
    ['handleMultiPointMouseMove', 'updateMeasurementTooltips'],
    ['finalizeMultiPointMeasure', 'handleMeasureKeyDown']
]) {
    vm.runInContext(source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`)), sandbox);
}
const keyStart = source.indexOf('function handleMeasureKeyDown(');
vm.runInContext(source.slice(keyStart, source.indexOf("measurementUndoBtn.addEventListener('click'", keyStart)), sandbox);

sandbox.handleMultiPointMouseMove({ latlng: { lat: 3, lng: 4 } });
const line = sandbox.temporaryMouseMoveLine;
const tooltip = sandbox.temporaryMouseMoveTooltip;
assert.equal(tooltip.content, 'Segment: 1.00 km');
for (let i = 1; i <= 100; i++) sandbox.handleMultiPointMouseMove({ latlng: { lat: 0, lng: i } });
assert.deepEqual(counts, { line: 1, tooltip: 1 });
assert.equal(sandbox.temporaryMouseMoveLine, line);
assert.equal(sandbox.temporaryMouseMoveTooltip, tooltip);
assert.equal(line.points[1].lng, 100);
assert.equal(tooltip.position.lng, 100);
assert.equal(tooltip.content, 'Segment: 20.00 km');
assert.equal(groupLayers.size, 1);
assert.equal(mapLayers.size, 1);

// A newly fixed vertex becomes the preview's start without replacing its layers.
const vertex = { lat: 0, lng: 90 };
sandbox.multiPointPath.push(vertex);
sandbox.handleMultiPointMouseMove({ latlng: { lat: 0, lng: 100 } });
assert.equal(line.points[0], vertex);
assert.equal(tooltip.content, 'Segment: 2.00 km');
sandbox.getMapRuntimeData = () => ({});
sandbox.handleMultiPointMouseMove({ latlng: { lat: 0, lng: 105 } });
assert.equal(tooltip.content, 'Segment: 15 px');

// Both finishing and cancelling remove the reused preview and permit a fresh one.
for (const permanent of [true, false]) {
    sandbox.finalizeMultiPointMeasure(permanent);
    assert.equal(sandbox.temporaryMouseMoveLine, null);
    assert.equal(sandbox.temporaryMouseMoveTooltip, null);
    assert.equal(groupLayers.size, 0);
    assert.equal(mapLayers.size, 0);
    sandbox.isMeasuringMultiPoint = true;
    sandbox.multiPointPath = [{ lat: 0, lng: 0 }];
    sandbox.handleMultiPointMouseMove({ latlng: { lat: 0, lng: 5 } });
}
// Undoing the only vertex also clears the preview; subsequent moves cannot revive it.
sandbox.handleMeasureKeyDown({ key: 'Backspace', target: sandbox.mapElement, preventDefault() {} });
assert.equal(sandbox.temporaryMouseMoveLine, null);
assert.equal(sandbox.temporaryMouseMoveTooltip, null);
assert.equal(groupLayers.size, 0);
assert.equal(mapLayers.size, 0);
const beforeEmptyMove = { ...counts };
sandbox.handleMultiPointMouseMove({ latlng: { lat: 0, lng: 10 } });
assert.deepEqual(counts, beforeEmptyMove);
// Keyboard placement samples the map center after panning and preserves button activation.
function press(key, target = sandbox.mapElement, repeat = false) {
    let prevented = false;
    sandbox.handleMeasureKeyDown({ key, target, repeat, preventDefault() { prevented = true; } });
    return prevented;
}
assert.equal(press('ArrowRight'), false);
assert.equal(press(' '), true);
assert.equal(press(' ', sandbox.mapElement, true), true);
assert.equal(sandbox.multiPointPath.length, 1);
assert.equal(sandbox.measurementFinishBtn.disabled, true);
assert.equal(press('Enter'), true);
assert.equal(sandbox.isMeasuringMultiPoint, true);
assert.equal(press('Enter', sandbox.measurementFinishBtn), false);
center = { lat: 0, lng: 20 };
assert.equal(press(' '), true);
assert.equal(sandbox.multiPointPath[1], center);
assert.equal(sandbox.measurementFinishBtn.disabled, false);
assert.equal(press('Backspace'), true);
assert.equal(sandbox.multiPointPath.length, 1);

// Simulated touch double-clicks and distinct mouse clicks both keep the path open.
function click(lng, detail, pointerType) {
    sandbox.handleMultiPointMeasureClick({
        latlng: { lat: 0, lng },
        containerPoint: { x: lng, distanceTo: other => Math.abs(lng - other.x) },
        originalEvent: { detail, pointerType }
    });
}
click(30, 1, 'touch');
click(31, 2, 'touch');
sandbox.handleMeasurementDoubleClick({ originalEvent: { _simulated: true } });
assert.equal(sandbox.multiPointPath.length, 3);
assert.equal(sandbox.isMeasuringMultiPoint, true);
click(40, 1, 'mouse');
click(60, 2, 'mouse');
sandbox.handleMeasurementDoubleClick({ originalEvent: {} });
assert.equal(sandbox.multiPointPath.length, 5);
assert.equal(sandbox.isMeasuringMultiPoint, true);

// Nearby mouse double-clicks preserve the desktop shortcut and add one vertex.
const finalize = sandbox.finalizeMultiPointMeasure;
let finished = false;
sandbox.finalizeMultiPointMeasure = () => { finished = true; };
click(70, 1, 'mouse');
click(71, 2, 'mouse');
sandbox.handleMeasurementDoubleClick({ originalEvent: {} });
assert.equal(sandbox.multiPointPath.length, 6);
assert.equal(finished, true);
finished = false;
assert.equal(press('Enter'), true);
assert.equal(finished, true);
sandbox.finalizeMultiPointMeasure = finalize;

console.log('Measurement hover, cleanup, keyboard and pointer checks passed');
