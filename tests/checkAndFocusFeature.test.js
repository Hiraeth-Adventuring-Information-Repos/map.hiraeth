const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

(function() {
    const appJsContent = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

    const startFocusPOI = appJsContent.indexOf('function focusPOI(');
    const endFocusPOI = appJsContent.indexOf('function focusRegion(');
    const focusPOIStr = appJsContent.substring(startFocusPOI, endFocusPOI);

    const startFocusRegion = appJsContent.indexOf('function focusRegion(');
    const endFocusRegion = appJsContent.indexOf('function focusLine(');
    const focusRegionStr = appJsContent.substring(startFocusRegion, endFocusRegion);

    const startFocusLine = appJsContent.indexOf('function focusLine(');
    const endFocusLine = appJsContent.indexOf('function checkAndFocusFeature(');
    const focusLineStr = appJsContent.substring(startFocusLine, endFocusLine);

    const startCheck = appJsContent.indexOf('function checkAndFocusFeature()');
    const endCheck = appJsContent.indexOf('// --- Map View URL State Management ---');
    const checkAndFocusFeatureStr = appJsContent.substring(startCheck, endCheck);

    // Global mocks
    global.allMapMarkers = [];
    global.allMapMarkersById = new Map();
    global.allMapRegionsById = new Map();
    global.allMapLinesById = new Map();
    global.allMapMarkersByName = new Map();
    global.allMapRegionsByName = new Map();
    global.allMapLinesByName = new Map();
    global.currentMarkerGroup = {
        layers: [],
        hasLayer: function(l) { return this.layers.includes(l); },
        addLayer: function(l) { this.layers.push(l); },
        addTo: function(m) { m.layers.push(this); }
    };
    global.currentRegionGroup = {
        layers: [],
        eachLayer: function(cb) { this.layers.forEach(cb); }
    };
    global.currentRoadGroup = {
        layers: [],
        eachLayer: function(cb) { this.layers.forEach(cb); }
    };
    global.map = {
        layers: [],
        hasLayer: function(l) { return this.layers.includes(l); },
        setView: function(latlng, zoom, opts) {
            this.lastSetView = {latlng, zoom, opts};
        },
        getZoom: () => 5,
        fitBounds: function(bounds, opts) {
            this.lastFitBounds = {bounds, opts};
        }
    };

    global.trackShareLinkOpenFromParams = () => {};
    global.getShareContextFromParams = () => null;
    global.showShareRelayPrompt = () => {};
    global.hideShareRelayPrompt = () => {};

    let searchParams = {};
    const OriginalURLSearchParams = global.URLSearchParams;
    global.URLSearchParams = class {
        constructor() {}
        get(k) { return searchParams[k]; }
    };
    const originalWindow = global.window;
    global.window = { location: { search: '' } };

    eval(focusPOIStr);
    eval(focusRegionStr);
    eval(focusLineStr);
    eval(checkAndFocusFeatureStr);

    // Mock console.warn safely
    const originalWarn = console.warn;
    console.warn = () => {};

    // Reset state between tests
    function resetMocks() {
        global.allMapMarkersById.clear();
        global.allMapRegionsById.clear();
        global.allMapLinesById.clear();
        global.allMapLinesByName.clear();
        global.allMapMarkers = [];
        global.allMapMarkersByName.clear();
        global.currentMarkerGroup.layers = [];
        global.currentRegionGroup.layers = [];
        global.currentRoadGroup.layers = [];
        global.map.layers = [];
        global.map.lastSetView = null;
        global.map.lastFitBounds = null;
        searchParams = {};
    }

    try {
        // Test focusPOI
        resetMocks();
        const mockMarker = {
            poiData: { name: 'Test POI' },
            getLatLng: () => [10, 20],
            openPopup: function() { this.popupOpened = true; },
            popupOpened: false
        };
        global.allMapMarkers.push(mockMarker);
        global.allMapMarkersByName.set('Test POI', mockMarker);
        const resultPoi = focusPOI('Test POI');
        assert.equal(resultPoi, true, 'focusPOI should return true for found POI');
        assert.ok(mockMarker.popupOpened, 'Marker popup should be opened');
        assert.ok(global.currentMarkerGroup.layers.includes(mockMarker), 'Marker should be in currentMarkerGroup');
        assert.ok(global.map.layers.includes(global.currentMarkerGroup), 'currentMarkerGroup should be on map');
        assert.deepEqual(global.map.lastSetView.latlng, [10, 20], 'map.setView should be called with correct coordinates');
        assert.equal(global.map.lastSetView.zoom, 5, 'map.setView should be called with correct zoom');

        resetMocks();
        const resultPoiFail = focusPOI('Missing POI');
        assert.equal(resultPoiFail, false, 'focusPOI should return false for missing POI');

        // Test focusRegion
        resetMocks();
        const mockRegionLayer = {
            regionData: { name: 'Test Region' },
            getBounds: () => 'mockBounds',
            openPopup: function() { this.popupOpened = true; },
            popupOpened: false
        };
        global.currentRegionGroup.layers.push(mockRegionLayer);
        global.allMapRegionsByName.set('Test Region', mockRegionLayer);
        const resultRegion = focusRegion('Test Region');
        assert.equal(resultRegion, true, 'focusRegion should return true for found Region');
        assert.ok(mockRegionLayer.popupOpened, 'Region popup should be opened');
        assert.equal(global.map.lastFitBounds.bounds, 'mockBounds', 'map.fitBounds should be called with correct bounds');

        resetMocks();
        const resultRegionFail = focusRegion('Missing Region');
        assert.equal(resultRegionFail, false, 'focusRegion should return false for missing Region');

        // Test focusLine
        resetMocks();
        const mockLineLayer = {
            roadData: { name: 'Test Line' },
            getBounds: () => 'mockLineBounds',
            openPopup: function() { this.popupOpened = true; },
            popupOpened: false
        };
        global.currentRoadGroup.layers.push(mockLineLayer);
        global.allMapLinesByName.set('Test Line', mockLineLayer);
        const resultLine = focusLine('Test Line');
        assert.equal(resultLine, true, 'focusLine should return true for found Line');
        assert.ok(mockLineLayer.popupOpened, 'Line popup should be opened');
        assert.equal(global.map.lastFitBounds.bounds, 'mockLineBounds', 'map.fitBounds should be called with correct bounds');

        resetMocks();
        const resultLineFail = focusLine('Missing Line');
        assert.equal(resultLineFail, false, 'focusLine should return false for missing Line');

        // Test checkAndFocusFeature
        resetMocks();
        global.allMapMarkers.push(mockMarker);
        global.allMapMarkersByName.set('Test POI', mockMarker);
        searchParams = { poi: 'Test POI' };
        const resultCheckPoi = checkAndFocusFeature();
        assert.equal(resultCheckPoi, true, 'checkAndFocusFeature should return true when POI is focused');

        resetMocks();
        global.currentRegionGroup.layers.push(mockRegionLayer);
        global.allMapRegionsByName.set('Test Region', mockRegionLayer);
        searchParams = { region: 'Test Region' };
        const resultCheckRegion = checkAndFocusFeature();
        assert.equal(resultCheckRegion, true, 'checkAndFocusFeature should return true when Region is focused');

        resetMocks();
        global.currentRoadGroup.layers.push(mockLineLayer);
        global.allMapLinesByName.set('Test Line', mockLineLayer);
        searchParams = { line: 'Test Line' };
        const resultCheckLine = checkAndFocusFeature();
        assert.equal(resultCheckLine, true, 'checkAndFocusFeature should return true when Line is focused');

        resetMocks();
        searchParams = { unknown: 'Test' };
        const resultCheckFail = checkAndFocusFeature();
        assert.equal(resultCheckFail, false, 'checkAndFocusFeature should return false when no feature is focused');

    } finally {
        console.warn = originalWarn;
        global.URLSearchParams = OriginalURLSearchParams;
        global.window = originalWindow;
    }
})();
