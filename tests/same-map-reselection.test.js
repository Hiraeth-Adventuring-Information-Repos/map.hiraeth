const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
function functionSource(name) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.notEqual(start, -1, `Missing production function: ${name}`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

function createHarness({ loaded = true, search = '', hash = '#a-c', getDefinition } = {}) {
    const calls = { reset: 0, definitions: [], rendered: [], completed: [], focused: [], push: [], replace: [], analytics: [] };
    const entries = { a: { id: 'a', name: 'Map A' }, b: { id: 'b', name: 'Map B' }, soon: { id: 'soon', status: 'coming-soon' } };
    const preloads = [];
    const location = new URL(`https://example.test/maps/${search}${hash}`);
    function layer() {
        return { handlers: {}, on(type, callback) { this.handlers[type] = callback; }, addTo() { return this; } };
    }
    const context = {
        URL, URLSearchParams, performance: { now: () => 1 }, console: { warn() {}, error() {} }, alert() {},
        mapData: Object.values(entries), currentlyLoadedMapId: loaded ? 'a' : null,
        currentImageLayer: loaded ? layer() : null, currentMapPreviewLayer: null,
        currentMapUnderlay: layer(), currentMapBaseLayerMode: 'image', currentBounds: [[0, 0], [100, 100]],
        currentSidebarState: 'c', loadRequestToken: 5, loadingMapId: null,
        loadingIndicator: { style: { display: 'none' } }, loadingProgressInterval: null, loadingProgress: 0,
        measurements: [{ distance: 25 }], poiSearchInput: { value: 'tavern' },
        window: { location }, prefetchedImageUrls: new Set(), isMobileLayoutActive: false,
        map: { removeLayer() {}, fitBounds() {} }, L: { imageOverlay: layer },
        Image: class { constructor() { preloads.push(this); } },
        setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
        findMapRecursive: (_data, id) => entries[id],
        hideShareRelayPrompt() {}, mountBootstrapMapPreview() {}, setMapAtmosphere() {},
        setMapChooserVisible(value) { context.chooserVisible = value; },
        trackAnalytics: (name) => calls.analytics.push(name),
        generateHash: (id, sidebar) => `#${id}-${sidebar}`,
        buildAppUrlWithHash: (nextHash, nextSearch) => `/maps/${nextSearch}${nextHash}`,
        history: Object.fromEntries(['push', 'replace'].map(method => [`${method}State`, (...args) => {
            calls[method].push(args);
            location.href = new URL(args[2], location).href;
        }])),
        startMapLoadingProgress() { context.loadingIndicator.style.display = 'flex'; context.loadingProgressInterval = 10; },
        resetMapState() {
            calls.reset++;
            context.currentImageLayer = null;
            context.measurements = [];
            context.poiSearchInput.value = '';
        },
        async getMapDefinition(id, entry) {
            calls.definitions.push(id);
            return getDefinition ? getDefinition(id, entry) : { ...entry, imageUrl: `${id}.webp` };
        },
        abortMapLoad(options) {
            context.currentlyLoadedMapId = null;
            context.currentMapData = null;
            context.failure = options;
        },
        getPreferredMapImageUrl: selected => selected.imageUrl,
        setupMapLayers() { context.currentImageLayer = layer(); context.currentMapUnderlay = layer(); return true; },
        renderMapFeatures: selected => calls.rendered.push(selected.id),
        finalizeMapUI(id) { context.currentlyLoadedMapId = id; context.loadingMapId = null; },
        applySearchParamsToCurrentMap: params => calls.focused.push(params.toString()),
        finalizeMapLoadState(id) { calls.completed.push(id); context.loadingIndicator.style.display = 'none'; },
        removeBootstrapMapPreview() {}, removeMapPreviewLayer() {}, setLoadingProgressValue() {}, withAssetVersion: url => url,
        getConfigValue: (_key, fallback) => fallback, closeMobileSheet() {}
    };
    vm.createContext(context);
    vm.runInContext([
        'pushMapHistoryState', 'replaceMapHistoryState', 'initMapLoadContext', 'handleMapUnavailable',
        'handleRedundantLoad', 'fetchMapDefinitionOrAbort', 'setupMapImageLoading', 'loadMap',
        'clearTransientMapSearchParams', 'navigateToMap'
    ].map(functionSource).join('\n'), context);
    return { context, calls, entries, preloads };
}

test('reselecting the active map preserves layers, search, and measurements without starting a load', async () => {
    const { context, calls } = createHarness();
    const image = context.currentImageLayer;
    const measurements = context.measurements;
    context.chooserVisible = true;
    await context.loadMap(' a ');
    assert.equal(context.currentImageLayer, image);
    assert.equal(context.measurements, measurements);
    assert.equal(context.poiSearchInput.value, 'tavern');
    assert.equal(context.chooserVisible, false);
    assert.equal(context.loadRequestToken, 5);
    assert.equal(calls.reset, 0);
    assert.deepEqual(calls.definitions, []);
    assert.deepEqual(calls.analytics, []);
    assert.deepEqual(calls.push, []);
    assert.deepEqual(calls.replace, []);
});

test('same-map search parameters still focus features and replace history only when requested', async () => {
    const { context, calls } = createHarness({ search: '?poi=inn&view=10,20,2', hash: '#a-o' });
    await context.loadMap('a', false);
    assert.deepEqual(calls.focused, ['poi=inn&view=10%2C20%2C2']);
    assert.equal(calls.replace.length, 0);
    await context.loadMap('a');
    assert.equal(calls.replace.length, 1);
    assert.equal(context.window.location.hash, '#a-c');
    assert.equal(context.window.location.search, '?poi=inn&view=10,20,2');
    assert.equal(calls.push.length, 0);
});

test('same-map navigation clears transient URL focus and pushes a single history entry', async () => {
    const { context, calls } = createHarness({ search: '?poi=inn&gallery=true&embed=true' });
    context.navigateToMap('a');
    assert.equal(context.window.location.search, '?embed=true');
    assert.equal(calls.push.length, 1);
    assert.equal(calls.replace.length, 0);
    assert.deepEqual(calls.focused, ['embed=true']);
    assert.equal(calls.reset, 0);
});

test('reselecting a map during image loading preserves its token and lets the real completion callback finish', async () => {
    const { context, calls, preloads } = createHarness({ loaded: false });
    await context.loadMap('a', false);
    const image = context.currentImageLayer;
    const token = context.loadRequestToken;
    assert.equal(context.loadingIndicator.style.display, 'flex');
    await context.loadMap('a', false);
    assert.equal(context.currentImageLayer, image);
    assert.equal(context.loadRequestToken, token);
    assert.equal(context.loadingIndicator.style.display, 'flex');
    assert.equal(context.loadingProgressInterval, 10);
    preloads[0].onload();
    assert.deepEqual(calls.completed, ['a']);
    assert.equal(context.loadingIndicator.style.display, 'none');
    assert.equal(calls.reset, 1);
});

test('selecting the old map during another definition load supersedes the pending request', async () => {
    let resolveOther;
    const { context, calls, entries, preloads } = createHarness({ getDefinition: (id, entry) => id === 'b'
        ? new Promise(resolve => { resolveOther = resolve; }) : { ...entry, imageUrl: `${id}.webp` } });
    const otherLoad = context.loadMap('b', false);
    await context.loadMap('a', false);
    resolveOther({ ...entries.b, imageUrl: 'b.webp' });
    await otherLoad;
    assert.equal(context.currentlyLoadedMapId, 'a');
    assert.deepEqual(calls.rendered, ['a']);
    assert.deepEqual(calls.definitions, ['b', 'a']);
    assert.equal(calls.reset, 2);
    preloads[0].onload();
    assert.deepEqual(calls.completed, ['a']);
});

test('a late image callback from the previous map cannot finalize the newly selected map', async () => {
    const { context, calls, preloads } = createHarness({ loaded: false });
    await context.loadMap('a', false);
    await context.loadMap('b', false);
    preloads[0].onload();
    assert.deepEqual(calls.completed, []);
    preloads[1].onload();
    assert.deepEqual(calls.completed, ['b']);
});

test('definition failure can retry the same requested map successfully', async () => {
    let attempt = 0;
    const { context, calls } = createHarness({ loaded: false, getDefinition: (_id, entry) => {
        if (++attempt === 1) throw new Error('temporary failure');
        return { ...entry, imageUrl: 'a.webp' };
    } });
    await context.loadMap('a', false);
    assert.equal(context.failure.reason, 'definition_error');
    assert.equal(context.loadingMapId, 'a');
    await context.loadMap(context.loadingMapId, false);
    assert.deepEqual(calls.definitions, ['a', 'a']);
    assert.deepEqual(calls.rendered, ['a']);
});

test('image failure permits retry rather than treating the failed map as already loaded', async () => {
    const { context, calls, preloads } = createHarness({ loaded: false });
    await context.loadMap('a', false);
    preloads[0].onerror();
    assert.equal(context.failure.reason, 'image_error');
    await context.loadMap('a', false);
    assert.deepEqual(calls.definitions, ['a', 'a']);
    preloads[1].onload();
    assert.deepEqual(calls.completed, ['a']);
});

test('an unavailable map is still rejected even if its ID matches stale active state', async () => {
    const { context, calls, entries } = createHarness();
    entries.a.status = 'coming-soon';
    await context.loadMap('a', false);
    assert.equal(context.failure.reason, 'unavailable');
    assert.equal(calls.reset, 1);
    assert.deepEqual(calls.definitions, []);
});
