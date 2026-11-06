const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('js/app.js', 'utf8');

function extractFunctionSource(name) {
    const start = appSource.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`Could not find function ${name}`);
    let depth = 0;
    for (let index = start; index < appSource.length; index += 1) {
        if (appSource[index] === '{') depth += 1;
        if (appSource[index] === '}') {
            depth -= 1;
            if (depth === 0) return appSource.slice(start, index + 1);
        }
    }
    throw new Error(`Could not parse function ${name}`);
}

const withAssetVersion = (url, version) => `${url}?v=${version || 'test'}`;

// eslint-disable-next-line no-eval
eval([
    extractFunctionSource('getGeneratedTileRowCount'),
    extractFunctionSource('normalizeSimpleCrsTileCoords'),
    extractFunctionSource('buildGeneratedTileUrl'),
    extractFunctionSource('getVisibleSourceTileCoordinates'),
    extractFunctionSource('getIdleTileWarmupCandidates')
].join('\n'));

const tileSource = {
    urlTemplate: 'tile/main_continent/{z}/{x}/{y}.webp',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 5,
    cacheVersion: 'map-fingerprint'
};
const tileLayer = {
    options: { sourceHeight: 6144, sourceMaxZoom: 5, tileSize: 256 },
    _getZoomForUrl() { return 4; },
    _tiles: {
        first: { current: true, coords: { z: -1, x: 4, y: 5 } },
        duplicate: { current: true, coords: { z: -1, x: 4, y: 5 } },
        second: { current: true, coords: { z: -1, x: 5, y: 5 } },
        stale: { current: false, coords: { z: -1, x: 8, y: 5 } }
    }
};

assert.deepEqual(getVisibleSourceTileCoordinates(tileLayer, tileSource), [
    { z: 4, x: 4, y: 5 },
    { z: 4, x: 5, y: 5 }
]);

const candidates = getIdleTileWarmupCandidates(
    { width: 8192, height: 6144 },
    tileLayer,
    tileSource
);
assert.equal(candidates.length, 8, 'two visible z4 tiles should expand to eight highest-detail z5 descendants');
assert.equal(new Set(candidates.map((candidate) => candidate.url)).size, 8);
assert.ok(candidates.every((candidate) => candidate.z === 5));
assert.ok(candidates.every((candidate) => candidate.url.endsWith('?v=map-fingerprint')));
assert.deepEqual(
    candidates.slice(0, 2).map(({ x, y }) => [x, y]),
    [[9, 10], [9, 11]],
    'warmup should prioritize descendants closest to the visible viewport center'
);

const allowedSource = extractFunctionSource('isIdleTileWarmupAllowed');
function evaluateAllowed({ enabled = true, hidden = false, saveData = false, effectiveType = '4g' } = {}) {
    const context = {
        result: null,
        document: { hidden },
        navigator: { connection: { saveData, effectiveType } },
        getConfigValue(path, fallbackValue) {
            assert.equal(path, 'performance.idleTileWarmup');
            return enabled ? fallbackValue : false;
        }
    };
    vm.runInNewContext(`${allowedSource}; result = isIdleTileWarmupAllowed();`, context);
    return context.result;
}

assert.equal(evaluateAllowed(), true);
assert.equal(evaluateAllowed({ enabled: false }), false);
assert.equal(evaluateAllowed({ hidden: true }), false);
assert.equal(evaluateAllowed({ saveData: true }), false);
assert.equal(evaluateAllowed({ effectiveType: 'slow-2g' }), false);
assert.equal(evaluateAllowed({ effectiveType: '2g' }), false);

assert.match(appSource, /cache:\s*'force-cache'/, 'idle requests should prefer the browser or service-worker tile cache');
assert.match(appSource, /await response\.blob\(\)/, 'each background tile should finish downloading before the next batch');
assert.match(appSource, /idleTileWarmupBatchDelayMs/, 'idle batches should be paced to avoid a background request burst');
assert.match(appSource, /beginMapInteraction[\s\S]*cancelIdleTileWarmup\(\{ removeDetailLayer: true \}\)/);
assert.match(appSource, /detailLayer\.setOpacity\(1\)/, 'a fully warmed visible area should fade to the forced high-detail layer');

console.log('idle tile warmup checks passed');

// Oversized views must stop generating URLs as soon as the budget is exceeded.
const originalBuildGeneratedTileUrl = buildGeneratedTileUrl;
let generatedUrlCount = 0;
buildGeneratedTileUrl = (...args) => { generatedUrlCount++; return originalBuildGeneratedTileUrl(...args); };
assert.deepEqual(getIdleTileWarmupCandidates({ width: 8192, height: 6144 }, tileLayer, tileSource, 3), []);
assert.equal(generatedUrlCount, 3);
generatedUrlCount = 0;
assert.deepEqual(getIdleTileWarmupCandidates({ width: 8192, height: 6144 }, tileLayer, tileSource, 8), candidates);
assert.equal(generatedUrlCount, 8, 'a view exactly at its budget retains all tiles and their order');
generatedUrlCount = 0;
assert.deepEqual(getIdleTileWarmupCandidates({ width: 8192, height: 6144 }, tileLayer, tileSource, 0), []);
assert.equal(generatedUrlCount, 0);
