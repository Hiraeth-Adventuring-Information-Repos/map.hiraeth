const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
function section(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Missing app section: ${start}`);
    return source.slice(first, last);
}
const navigationSource = [
    section('function prefersReducedMotion()', '// --- Measurement Tool State ---'),
    section('function focusSidebarSelectedFeature()', 'function renderSidebarEmptyFeature('),
    section('function searchMapMarkers(', 'function searchAtlasIndex(')
].join('\n');

function createNavigation(reducedMotion, zoom = -1) {
    const calls = [];
    const point = [10, 20];
    const bounds = [[0, 0], [20, 30]];
    const popup = () => calls.push({ method: 'popup' });
    const marker = { poiData: { name: 'Harbor', type: 'Town' }, getLatLng: () => point, openPopup: popup };
    const region = { regionData: { name: 'Harbor', type: 'Province' }, getBounds: () => bounds, openPopup: popup };
    const line = { roadData: { name: 'Harbor', type: 'Road' }, getBounds: () => bounds, getPopup: () => ({}), openPopup: popup };
    const context = vm.createContext({
        window: { matchMedia: () => ({ matches: reducedMotion }) },
        map: {
            getZoom: () => zoom,
            flyTo: (...args) => calls.push({ method: 'flyTo', args }),
            fitBounds: (...args) => calls.push({ method: 'fitBounds', args })
        },
        allMapMarkers: [marker], allMapRegions: [region], allMapLines: [line],
        currentMarkerGroup: { hasLayer: () => true }, currentRegionGroup: {}, currentRoadGroup: {},
        markersVisible: true, filterToggleAllCheckbox: { checked: true, indeterminate: false },
        getPoiGroup: type => type, normalizeSearchValue: value => value,
        getFeatureSearchDetailText: () => '',
        computeSearchMatch: () => ({ matched: true, score: 1 }),
        computePrecomputedSearchMatch: () => ({ matched: true, score: 1 }),
        findSidebarFeatureLayer: (_feature, type) => ({ poi: marker, region, line })[type],
        selectedSidebarFeature: {}, selectedSidebarFeatureType: 'poi'
    });
    vm.runInContext(navigationSource, context);
    return { context, calls, marker, region, line, point, bounds };
}

for (const reducedMotion of [false, true]) {
    for (const type of ['poi', 'region', 'line']) {
        test(`${type} search selection ${reducedMotion ? 'disables' : 'preserves'} navigation animation`, () => {
            const { context, calls, marker, region, line, point, bounds } = createNavigation(reducedMotion);
            const results = [];
            if (type === 'poi') context.searchMapMarkers('Harbor', results, true, new Set(), true);
            if (type === 'region') context.searchMapRegions('Harbor', results, true);
            if (type === 'line') context.searchMapLines('Harbor', results, true);
            assert.equal(results.length, 1);
            assert.equal(results[0].onSelect(), { poi: marker, region, line }[type]);
            const navigation = calls[0];
            assert.equal(navigation.method, type === 'poi' ? 'flyTo' : 'fitBounds');
            assert.deepEqual(navigation.args[0], type === 'poi' ? point : bounds);
            const options = navigation.args.at(-1);
            assert.equal(options.animate, !reducedMotion);
            if (type === 'poi') assert.equal(navigation.args[1], 1);
            else assert.equal(options.maxZoom, 1);
            assert.equal(calls[1].method, 'popup');
        });

        test(`${type} feature focus ${reducedMotion ? 'disables' : 'preserves'} navigation animation`, () => {
            const { context, calls, point, bounds } = createNavigation(reducedMotion, 2);
            context.selectedSidebarFeatureType = type;
            context.focusSidebarSelectedFeature();
            const navigation = calls[0];
            assert.equal(navigation.method, type === 'poi' ? 'flyTo' : 'fitBounds');
            assert.deepEqual(navigation.args[0], type === 'poi' ? point : bounds);
            const options = navigation.args.at(-1);
            assert.equal(options.animate, !reducedMotion);
            if (type === 'poi') assert.equal(navigation.args[1], 2);
            else assert.equal(options.maxZoom, 2);
            assert.equal(calls[1].method, 'popup');
        });
    }
}
