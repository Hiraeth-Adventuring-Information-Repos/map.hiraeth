const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/app.js', 'utf8');

// Use subsequent function signature for robust extraction per architectural constraints
function extractFunctionSource(name) {
    const start = appSource.indexOf(`function ${name}(`);
    if (start === -1) {
        throw new Error(`Could not find function ${name}`);
    }
    const end = appSource.indexOf('function handleMultiPointMeasureClick(', start);
    if (end === -1) {
        throw new Error(`Could not find end of function ${name}`);
    }
    return appSource.slice(start, end);
}

const toggleMeasurementToolSource = extractFunctionSource('toggleMeasurementTool');

// Mock setup
class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    toggle(className, force) {
        if (force === true) {
            this.classes.add(className);
        } else if (force === false) {
            this.classes.delete(className);
        } else {
            if (this.classes.has(className)) this.classes.delete(className);
            else this.classes.add(className);
        }
    }
    has(className) {
        return this.classes.has(className);
    }
}

class MockElement {
    constructor() {
        this.classList = new MockClassList();
        this.attributes = new Map();
        this.title = "";
    }
    setAttribute(name, value) {
        this.attributes.set(name, value);
    }
    getAttribute(name) {
        return this.attributes.get(name);
    }
}

global.isMeasuringMultiPoint = false;
global.isMeasuring = false;
global.measurementPoints = [];
global.measurementLines = [];
global.measurementTooltips = [];
global.measurementPath = null;

global.measureToolBtn = new MockElement();
global.mapElement = new MockElement();
global.mobileMeasureBtn = new MockElement();

global.mapEvents = {};
global.map = {
    closePopup() {},
    doubleClickZoom: {
        enabled: () => true,
        disable() {},
        enable() {}
    },
    on(event, handler) {
        global.mapEvents[event] = handler;
    },
    off(event, handler) {
        delete global.mapEvents[event];
    },
    removeLayer(layer) {
        layer.removed = true;
    }
};

global.documentEvents = {};
global.document = {
    addEventListener(event, handler) {
        global.documentEvents[event] = handler;
    },
    removeEventListener(event, handler) {
        delete global.documentEvents[event];
    }
};

global.measurementLayerGroup = {
    cleared: false,
    clearLayers() {
        this.cleared = true;
    }
};

global.multiPointPath = [];
global.multiPointVertexMarkers = [];
global.multiPointPolyline = null;
global.multiPointTotalTooltip = null;

global.filtersPanelVisible = false;
global.toggleFilterPanelCalled = false;
global.toggleFilterPanel = function() {
    global.toggleFilterPanelCalled = true;
};

global.handleMultiPointMeasureClick = function() {};
global.handleMultiPointMouseMove = function() {};
global.finalizeMultiPointMeasureCalled = false;
global.finalizeMultiPointMeasure = function(permanent) {
    global.finalizeMultiPointMeasureCalled = true;
    global.finalizeMultiPointMeasurePermanentArg = permanent;
    // mock removal of listeners that happens in finalize
    delete global.mapEvents['click'];
    delete global.mapEvents['mousemove'];
    delete global.mapEvents['dblclick'];
    delete global.documentEvents['keydown'];
};
global.handleMeasureKeyDown = function() {};

global.analyticsEvents = [];
global.trackAnalytics = function(event, data) {
    global.analyticsEvents.push({ event, data });
};

// Add global L to prevent ReferenceError
global.L = {
    polyline: function() {
        return {
            addTo: function() {
                return this;
            }
        };
    }
};

// eslint-disable-next-line no-eval
eval(toggleMeasurementToolSource);

// --- Tests ---

// 1. Initial State -> Enable Tool
toggleMeasurementTool();

assert.equal(global.isMeasuringMultiPoint, true);
assert.equal(global.measureToolBtn.classList.has('active'), true);
assert.equal(global.measureToolBtn.getAttribute('aria-pressed'), true);
assert.equal(global.mapElement.classList.has('measuring-cursor'), true);
assert.equal(global.measureToolBtn.title, "Click to add points. Double-click or Enter to finish. Backspace undoes a point. Esc cancels.");

assert.equal(global.mapEvents['click'], global.handleMultiPointMeasureClick);
assert.equal(global.mapEvents['mousemove'], global.handleMultiPointMouseMove);
assert.equal(global.mapEvents['dblclick'], global.finalizeMultiPointMeasure);
assert.equal(global.documentEvents['keydown'], global.handleMeasureKeyDown);

assert.equal(global.measurementLayerGroup.cleared, true);

assert.equal(global.mobileMeasureBtn.classList.has('active'), true);
assert.equal(global.mobileMeasureBtn.getAttribute('aria-pressed'), 'true');

assert.equal(global.analyticsEvents.length, 1);
assert.deepEqual(global.analyticsEvents[0], { event: 'measurement_toggled', data: { enabled: true } });

// 2. Clear layers and paths logic
global.multiPointPolyline = { removed: false };
global.multiPointTotalTooltip = { removed: false };

global.isMeasuringMultiPoint = false; // Reset to false to trigger enable again
toggleMeasurementTool();

assert.equal(global.multiPointPolyline, null);
assert.equal(global.multiPointTotalTooltip, null);

// 3. Test filter panel toggle
global.filtersPanelVisible = true;
global.isMeasuringMultiPoint = false;
toggleMeasurementTool();
assert.equal(global.toggleFilterPanelCalled, true);

// 4. Test Disable Tool
global.isMeasuringMultiPoint = true;
global.finalizeMultiPointMeasureCalled = false;
toggleMeasurementTool();

assert.equal(global.isMeasuringMultiPoint, false);
assert.equal(global.measureToolBtn.classList.has('active'), false);
assert.equal(global.measureToolBtn.getAttribute('aria-pressed'), false);
assert.equal(global.mapElement.classList.has('measuring-cursor'), false);
assert.equal(global.measureToolBtn.title, "Measure Distance");

assert.equal(global.finalizeMultiPointMeasureCalled, true);
assert.equal(global.finalizeMultiPointMeasurePermanentArg, false);

// Check event listener removal via finalize mock
assert.equal(global.mapEvents['click'], undefined);
assert.equal(global.mapEvents['mousemove'], undefined);
assert.equal(global.mapEvents['dblclick'], undefined);
assert.equal(global.documentEvents['keydown'], undefined);

assert.equal(global.mobileMeasureBtn.classList.has('active'), false);
assert.equal(global.mobileMeasureBtn.getAttribute('aria-pressed'), 'false');

console.log('toggleMeasurementTool checks passed');
