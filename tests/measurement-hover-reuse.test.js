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
    L: { polyline: points => layer('line', points), tooltip: () => layer('tooltip'), point: (x, y) => [x, y] },
    measurementLayerGroup: { layers: groupLayers, removeLayer: value => groupLayers.delete(value), clearLayers: () => groupLayers.clear() },
    map: {
        layers: mapLayers,
        distance: (a, b) => Math.hypot(b.lat - a.lat, b.lng - a.lng),
        removeLayer: value => mapLayers.delete(value),
        off() {}, doubleClickZoom: { enable() {} }
    },
    document: { removeEventListener() {} },
    mapElement: { classList },
    measureToolBtn: { classList, setAttribute() {} },
    mobileMeasureBtn: null,
    measurementDoubleClickZoomWasEnabled: false,
    multiPointPolyline: null,
    multiPointTotalTooltip: null,
    multiPointVertexMarkers: [],
    cachedMultiPointPixelDistance: 0,
    handleMultiPointMeasureClick() {},
    updateMeasurementTooltips() {}
};
vm.createContext(sandbox);
for (const [name, next] of [
    ['handleMultiPointMouseMove', 'updateMeasurementTooltips'],
    ['finalizeMultiPointMeasure', 'handleMeasureKeyDown']
]) {
    vm.runInContext(source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`)), sandbox);
}
const keyStart = source.indexOf('function handleMeasureKeyDown(');
vm.runInContext(source.slice(keyStart, source.indexOf("measureToolBtn.addEventListener('click'", keyStart)), sandbox);

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
sandbox.handleMeasureKeyDown({ key: 'Backspace', preventDefault() {} });
assert.equal(sandbox.temporaryMouseMoveLine, null);
assert.equal(sandbox.temporaryMouseMoveTooltip, null);
assert.equal(groupLayers.size, 0);
assert.equal(mapLayers.size, 0);
const beforeEmptyMove = { ...counts };
sandbox.handleMultiPointMouseMove({ latlng: { lat: 0, lng: 10 } });
assert.deepEqual(counts, beforeEmptyMove);
console.log('Measurement hover reuse and cleanup checks passed');
