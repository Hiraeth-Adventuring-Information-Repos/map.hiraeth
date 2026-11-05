const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('js/app.js', 'utf8');
const warmupSource = source.slice(source.indexOf('function isIdleTileWarmupAllowed('),
    source.indexOf('function scheduleIdleTileWarmup('));

function createWarmup({ mobile = false, count = 8, performance = {}, onIdle, onFetch } = {}) {
    const requests = [];
    const layers = [];
    let idleSlices = 0;
    const mapInfo = { width: 8192, height: 6144 };
    const tileSource = { urlTemplate: 'tile/map/{z}/{x}/{y}.webp', tileSize: 256, maxZoom: 5,
        leafletNativeZoom: 0, zoomOffset: 5, cacheVersion: 'native' };
    const candidates = Array.from({ length: count }, (_, index) => ({ url: `tile/map/5/${index}/0.webp?v=native` }));
    const context = {
        idleTileWarmupTimer: null, idleTileWarmupGeneration: 1, idleDetailTileLayer: null,
        currentMapData: mapInfo, currentImageLayer: {}, currentMapBaseLayerMode: 'tile',
        isMobileLayoutActive: mobile,
        document: { hidden: false }, navigator: { connection: { effectiveType: '4g', saveData: false } },
        mapOptions: { minZoom: -5, maxZoom: 4 }, currentBounds: [[0, 0], [6144, 8192]],
        L: { latLngBounds: bounds => bounds },
        map: { hasLayer: () => true, removeLayer() {} },
        getConfigValue: () => true,
        getPerformanceNumber: (name, fallback) => Object.hasOwn(performance, name) ? performance[name] :
            name === 'idleTileWarmupBatchDelayMs' ? 0 : fallback,
        getMapTileSource: () => tileSource,
        getIdleTileWarmupCandidates: () => candidates,
        withAssetVersion: (url, version) => `${url}?v=${version}`,
        scheduleIdleTask(resolve) { idleSlices++; onIdle?.(context, idleSlices); resolve(); },
        async fetch(url, options) {
            requests.push({ url, options });
            await onFetch?.(context, requests.length);
            return { ok: true, async blob() {} };
        },
        createSimpleCrsTileLayer(url, options) {
            const handlers = {};
            const layer = { url, options, handlers,
                on(type, listener) { handlers[type] = listener; },
                addTo() { layers.push(layer); },
                getContainer: () => ({ classList: { add() {} } }),
                setOpacity(opacity) { layer.opacity = opacity; }
            };
            return layer;
        },
        setTimeout, clearTimeout
    };
    vm.createContext(context);
    vm.runInContext(warmupSource, context);
    return { context, requests, layers, candidates,
        get idleSlices() { return idleSlices; },
        run: () => context.runIdleTileWarmup(1) };
}

for (const [label, options] of [
    ['desktop overview beyond display limit', { count: 161 }],
    ['mobile overview beyond display limit', { mobile: true, count: 73 }],
    ['desktop beyond warming budget', { count: 12, performance: { idleTileWarmupMaxTiles: 8 } }],
    ['mobile beyond warming budget', { mobile: true, count: 12, performance: { idleTileWarmupMobileMaxTiles: 8 } }],
    ['disabled warming budget', { count: 8, performance: { idleTileWarmupMaxTiles: 0 } }]
]) {
    test(`${label} performs zero network requests`, async () => {
        const warmup = createWarmup(options);
        await warmup.run();
        assert.deepEqual(warmup.requests, []);
        assert.equal(warmup.idleSlices, 0);
        assert.deepEqual(warmup.layers, []);
    });
}

for (const mobile of [false, true]) {
    test(`small ${mobile ? 'mobile' : 'desktop'} view warms all candidates and displays native detail`, async () => {
        const warmup = createWarmup({ mobile });
        await warmup.run();
        assert.deepEqual(warmup.requests.map(request => request.url), warmup.candidates.map(candidate => candidate.url));
        assert.equal(warmup.idleSlices, 2);
        assert.equal(warmup.layers.length, 1);
        assert.ok(warmup.requests.every(({ options }) => options.cache === 'force-cache'));
        const layer = warmup.layers[0];
        assert.equal(layer.url, 'tile/map/{z}/{x}/{y}.webp?v=native');
        assert.equal(layer.options.minNativeZoom, 0);
        assert.equal(layer.options.maxNativeZoom, 0);
        assert.equal(layer.options.sourceMaxZoom, 5);
        assert.equal(layer.options.opacity, 0);
        layer.handlers.load();
        assert.equal(layer.opacity, 1, 'native detail becomes visible only after its tiles load');
    });
}

for (const [label, cancel] of [
    ['generation cancellation', context => context.cancelIdleTileWarmup()],
    ['map switch', context => { context.currentMapData = {}; }],
    ['data saving enabled', context => { context.navigator.connection.saveData = true; }],
    ['slow network', context => { context.navigator.connection.effectiveType = '2g'; }],
    ['hidden document', context => { context.document.hidden = true; }]
]) {
    test(`${label} before first idle batch performs zero requests`, async () => {
        const warmup = createWarmup({ onIdle: cancel });
        await warmup.run();
        assert.deepEqual(warmup.requests, []);
        assert.deepEqual(warmup.layers, []);
    });
    test(`${label} during download stops subsequent batches`, async () => {
        const warmup = createWarmup({ onFetch(context, count) { if (count === 1) cancel(context); } });
        await warmup.run();
        assert.equal(warmup.requests.length, 4, 'only the already-started batch may complete');
        assert.deepEqual(warmup.layers, []);
    });
    test(`${label} during the final batch prevents attaching detail`, async () => {
        const warmup = createWarmup({ count: 4, onFetch(context, count) { if (count === 1) cancel(context); } });
        await warmup.run();
        assert.equal(warmup.requests.length, 4, 'the already-started final batch may complete');
        assert.deepEqual(warmup.layers, []);
    });
}

test('cancelled generation cannot reveal a late detail-layer load', async () => {
    const warmup = createWarmup();
    await warmup.run();
    const layer = warmup.layers[0];
    warmup.context.cancelIdleTileWarmup();
    layer.handlers.load();
    assert.equal(layer.opacity, undefined);
    assert.equal(warmup.context.idleDetailTileLayer, null);
});
