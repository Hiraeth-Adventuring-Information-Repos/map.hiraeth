const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    applyTileCacheVersionToMap,
    assertPagesBundleSize,
    compactJsonText,
    collectPublicMapAssetFiles,
    createPagesAtlasPayloads,
    createPagesSiteConfig,
    defaultTileCachePath,
    embedPagesSiteConfig,
    getDirectorySizeBytes,
    maxPagesBundleBytes,
    minifyPagesRuntimeSource,
    pagesAtlasSearchIndexPath,
    pagesRuntimeMinifyFiles,
    shouldCopyRuntimeAsset
} = require('../scripts/build_pages.js');

const versionedMap = {
    id: 'map-a',
    tileSource: { urlTemplate: 'tile/map-a/{z}/{x}/{y}.webp' }
};
const matchedVersionedMaps = new Set();
assert.equal(
    applyTileCacheVersionToMap(versionedMap, new Map([['map-a', 'abcdef0123456789']]), matchedVersionedMaps),
    true
);
assert.equal(versionedMap.tileSource.cacheVersion, 'abcdef0123456789');
assert.deepEqual(Array.from(matchedVersionedMaps), ['map-a']);
assert.equal(applyTileCacheVersionToMap({ id: 'map-b' }, { 'map-b': '1234' }), false);

const publicMapAssets = collectPublicMapAssetFiles();

[
    'maps/atlas-index.json',
    'maps/Fair-Content.json',
    'maps/Fair-Content.mini.webp',
    'maps/IceBeach.json',
    'maps/IceBeach.mini.webp',
    'maps/DEV-2025-08-Fair-Content.webp'
].forEach((assetPath) => {
    assert.ok(publicMapAssets.includes(assetPath), `Pages bundle should include ${assetPath}`);
});

[
    'maps/maps.json',
    'maps/Archive-2025-09-10-Fair-Content.webp',
    'maps/Old-Lin Map.jpeg',
    'maps/generated/main_continent.json',
    'maps/Fair-Content.webp',
    'maps/IceBeach.webp'
].forEach((assetPath) => {
    assert.equal(publicMapAssets.includes(assetPath), false, `Pages bundle should not include ${assetPath}`);
});

assert.equal(
    publicMapAssets.every((assetPath) => assetPath.startsWith('maps/')),
    true,
    'public map asset collector should only return map asset paths'
);

assert.equal(
    publicMapAssets.some((assetPath) => assetPath.startsWith('tile/')),
    false,
    'generated tile paths should not be copied from the source tree'
);

const sourceSiteConfig = JSON.parse(fs.readFileSync('site.config.json', 'utf8'));
const pagesSiteConfig = createPagesSiteConfig(sourceSiteConfig);
assert.equal(sourceSiteConfig.performance.tileAssetRoot, 'dist/tile');
assert.equal(
    pagesSiteConfig.performance.tileAssetRoot,
    'tile',
    'dist-root Pages bundles should keep generated tile URLs relative to the bundle root'
);
assert.equal(
    pagesSiteConfig.performance.tileFullImageFallback,
    false,
    'Pages bundles should keep the preview visible instead of requesting omitted full images when all tiles fail'
);

const embeddedIndex = embedPagesSiteConfig(
    '<!doctype html><script src="js/app-config.js?v=1"></script>',
    { copy: { html: '</script><script>alert(1)</script>' } }
);
assert.match(embeddedIndex, /window\.__SITE_CONFIG_EMBEDDED__=true/);
assert.match(embeddedIndex, /\\u003c\/script>/);
assert.doesNotMatch(embeddedIndex, /<script>alert\(1\)<\/script>/);

const pagesAtlasPayloads = createPagesAtlasPayloads({
    generatedAt: '2026-07-09T00:00:00.000Z',
    tree: [{ id: 'map-a' }],
    searchIndex: [{ kind: 'map', mapId: 'map-a', name: 'Map A' }]
});
assert.deepEqual(pagesAtlasPayloads.atlasShell.tree, [{ id: 'map-a' }]);
assert.equal(pagesAtlasPayloads.atlasShell.searchIndexUrl, pagesAtlasSearchIndexPath);
assert.equal(Object.prototype.hasOwnProperty.call(pagesAtlasPayloads.atlasShell, 'searchIndex'), false);
assert.deepEqual(pagesAtlasPayloads.searchPayload.searchIndex, [{ kind: 'map', mapId: 'map-a', name: 'Map A' }]);
assert.throws(
    () => createPagesAtlasPayloads({ tree: [], searchIndex: null }),
    /tree and searchIndex arrays/
);

assert.equal(compactJsonText('{\n  "map": true,\n  "count": 2\n}'), '{"map":true,"count":2}\n');
const minifiedJavascript = minifyPagesRuntimeSource(
    'function externallyVisibleName() { const deliberatelyLongLocalName = 40 + 2; return deliberatelyLongLocalName; }',
    { loader: 'js', target: 'es2020' }
);
assert.match(minifiedJavascript, /externallyVisibleName/);
assert.ok(minifiedJavascript.length < 100);
const minifiedCss = minifyPagesRuntimeSource(
    '.map-card { color: rgb(255, 0, 0); padding: 0px 0px 0px 0px; }',
    { loader: 'css', target: ['chrome100', 'firefox100', 'safari15.4'] }
);
assert.ok(minifiedCss.length < 50);
assert.ok(pagesRuntimeMinifyFiles.some((asset) => asset.relativePath === 'js/app.js'));
assert.ok(pagesRuntimeMinifyFiles.some((asset) => asset.relativePath === 'css/style.css'));

const temporaryBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraeth-pages-budget-'));
try {
    fs.mkdirSync(path.join(temporaryBundle, 'nested'));
    fs.writeFileSync(path.join(temporaryBundle, 'index.html'), 'map');
    fs.writeFileSync(path.join(temporaryBundle, 'nested', 'tile.webp'), 'tiles');
    assert.equal(getDirectorySizeBytes(temporaryBundle), 8);
    assert.equal(assertPagesBundleSize(temporaryBundle, 8), 8);
    assert.throws(
        () => assertPagesBundleSize(temporaryBundle, 7),
        /Pages bundle is .* expected no more than/
    );
} finally {
    fs.rmSync(temporaryBundle, { recursive: true, force: true });
}

assert.equal(
    maxPagesBundleBytes,
    225 * 1024 * 1024,
    'Pages bundle budget should leave room for higher-quality tiles without allowing duplicate full maps back in'
);

assert.equal(shouldCopyRuntimeAsset('images/poi-icons/city.png'), false);
assert.equal(shouldCopyRuntimeAsset('images/poi-icons/city.svg'), true);
assert.equal(shouldCopyRuntimeAsset('images/poi-icons/city.webp'), true);
assert.equal(shouldCopyRuntimeAsset('images/hiraeth-maps-preview.png'), true);
assert.equal(shouldCopyRuntimeAsset('sounds/night-ambient.mp3'), true);
assert.equal(defaultTileCachePath.endsWith(path.join('.cache', 'pages-tiles')), true);

console.log('Pages bundle map asset collection checks passed');
