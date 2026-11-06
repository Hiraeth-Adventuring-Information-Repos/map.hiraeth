const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
const functions = [
    ['populatePOIsOnMap', 'function finalizeMapUI('],
    ['addRegionsToMap', '// --- Update region visibility'],
    ['addRoadsToMap', 'function canUseSoundControlsNow(']
].map(([name, end]) => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf(end, start + 1));
}).join('\n');

for (const type of ['poi', 'region', 'line']) {
    test(`${type} defers popup rendering and refreshes feature data and app state on reopen`, () => {
        const feature = {
            id: `${type}-id`, name: 'Original', type: 'test', coords: [10, 10],
            coordinates: [[0, 0], [0, 10], [10, 10]]
        };
        const layers = [];
        const renders = [];
        const selections = [];
        const makeLayer = () => {
            const layer = {
                events: {},
                bindPopup(content, options) { this.content = content; this.popupOptions = options; },
                bindTooltip() {},
                on(name, callback) { this.events[name] = callback; },
                bringToBack() {},
                openPopup() {
                    this.html = this.content();
                    this.events.popupopen();
                }
            };
            layers.push(layer);
            return layer;
        };
        const group = { clearLayers() {}, addLayer() {} };
        const context = {
            L: { marker: makeLayer, polygon: makeLayer, polyline: makeLayer },
            visiblePointsCache: [feature], visibleRegionsCache: [feature], visibleLinesCache: [feature],
            currentRegionGroup: group, currentRoadGroup: group, regionsVisible: true,
            allMapMarkers: [], allMapRegions: [], allMapLines: [],
            getMapRuntimeData: () => ({ regions: [feature], roads: [feature] }),
            getPoiMarkerAccessibleName: data => data.name,
            getPoiIcon() {}, getPoiGroup() {}, createPoiTooltipContent() {}, getPoiTooltipOptions() {},
            attachPoiTooltipBehavior() {},
            setSidebarSelectedFeature: (data, selectedType) => selections.push([data, selectedType]),
            linkedMapName: 'First linked map',
            createPopupContent(data, popupType) {
                renders.push([data, popupType]);
                return `${data.name}: ${context.linkedMapName}`;
            },
            console
        };
        for (const name of ['Markers', 'Regions', 'Lines']) {
            context[`allMap${name}ById`] = new Map();
            context[`allMap${name}ByName`] = new Map();
        }
        vm.createContext(context);
        vm.runInContext(functions, context);
        if (type === 'poi') context.populatePOIsOnMap({ height: 100, width: 100 });
        if (type === 'region') context.addRegionsToMap('map');
        if (type === 'line') context.addRoadsToMap('map');

        assert.equal(layers.length, 1);
        assert.equal(renders.length, 0, 'unopened features must not generate popup HTML');
        const layer = layers[0];
        assert.equal(layer.popupOptions.minWidth, 250);
        layer.openPopup();
        assert.equal(layer.html, 'Original: First linked map');
        assert.equal(renders.length, 1);
        assert.equal(renders[0][1], type);
        assert.deepEqual(selections[0], [feature, type], 'popup opening still selects sidebar details');

        feature.name = 'Updated';
        context.linkedMapName = 'Updated linked map';
        layer.openPopup();
        assert.equal(layer.html, 'Updated: Updated linked map');
        assert.equal(renders.length, 2, 'reopening must not reuse stale HTML');
        assert.equal(selections.length, 2);
    });
}
