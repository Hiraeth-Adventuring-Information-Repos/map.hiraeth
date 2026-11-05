const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexSource = fs.readFileSync('index.html', 'utf8');
const mapEditorSource = fs.readFileSync('map-editor.html', 'utf8');
const appConfigSource = fs.readFileSync('js/app-config.js', 'utf8');
const appSource = fs.readFileSync('js/app.js', 'utf8');
const swSource = fs.readFileSync('sw.js', 'utf8');
const versionMatch = appConfigSource.match(/version:\s*'([^']+)'/);
assert.ok(versionMatch, 'Could not find default asset version in app config');
const appConfigVersion = versionMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

assert.match(indexSource, new RegExp(`<script src="js/app-config\\.js\\?v=${appConfigVersion}"></script>`));
[
    'css/leaflet.css',
    'css/style.css',
    'css/stars.css',
    'css/Control.MiniMap.min.css'
].forEach((stylesheet) => {
    const escapedStylesheet = stylesheet.replace(/\./g, '\\.');
    assert.match(indexSource, new RegExp(`<link rel="stylesheet" href="${escapedStylesheet}\\?v=${appConfigVersion}" data-app-stylesheet="true">`));
});
[
    'js/libs/leaflet.js',
    'js/libs/lucide.min.js',
    'js/libs/purify.min.js',
    'js/app.js'
].forEach((scriptPath) => {
    const escapedScriptPath = scriptPath.replace(/\./g, '\\.');
    assert.match(indexSource, new RegExp(`<link rel="preload" href="${escapedScriptPath}\\?v=${appConfigVersion}" as="script" data-app-preload="true">`));
});
assert.match(indexSource, new RegExp(`<link rel="preload" href="maps/atlas-index\\.json\\?v=${appConfigVersion}" as="fetch"[^>]+data-app-preload="true">`));
assert.match(mapEditorSource, new RegExp(`EditorLoading\\.asset\\('js/app-config\\.js\\?v=${appConfigVersion}'\\)`));
assert.match(indexSource, new RegExp(`window\\.APP_ASSET_VERSION\\s*=\\s*"${appConfigVersion}"`));
assert.match(indexSource, /window\.APP_ASSET_VERSION\s*=\s*window\.AppConfig \? window\.AppConfig\.get\("assets\.version", "0"\) : "0"/);
assert.match(indexSource, /window\.AppConfig\.get\("assets\.stylesheets"/);
assert.match(indexSource, /document\.querySelectorAll\('link\[data-app-stylesheet\]'\)/);
assert.match(indexSource, /document\.querySelectorAll\('link\[data-app-preload\]'\)/);
assert.match(indexSource, /preloadedAssets\.has\(href\)/);
assert.match(indexSource, /const versionedHref = `\$\{href\}\?v=\$\{version\}`/);
assert.match(indexSource, /link\.href = versionedHref/);
assert.ok(
    indexSource.indexOf('<link rel="stylesheet" href="css/leaflet.css') < indexSource.indexOf('<script src="js/app-config.js'),
    'runtime stylesheets should be parser-visible before the app config script'
);
assert.match(indexSource, /script\.src = `\$\{src\}\?v=\$\{version\}`/);

assert.match(appSource, /const swUrl = `sw\.js\?v=\$\{encodeURIComponent\(window\.APP_ASSET_VERSION \|\| '0'\)\}`/);
assert.match(appSource, /window\.setTimeout\(\(\) => \{\s*scheduleIdleTask\(\(\) => \{\s*navigator\.serviceWorker\.register\(swUrl\)/);
assert.match(appSource, /\}, 2500\);\s*\}, 1200\);/);
assert.match(appSource, /navigator\.serviceWorker\.register\(swUrl\)/);

assert.match(swSource, /const VERSION = new URL\(self\.location\.href\)\.searchParams\.get\('v'\) \|\| '0';/);
assert.match(swSource, /function isVersionedShellRequest\(url\) \{/);
assert.match(swSource, /return url\.searchParams\.has\('v'\);/);
assert.match(swSource, /async function cacheFirstTask\(request, cacheName\)/);
assert.match(swSource, /const TILE_CACHE = 'hag-tiles-v1'/);
assert.match(swSource, /function respondWithCacheTask\(event, task\)/);
assert.match(swSource, /event\.waitUntil\(taskPromise/);
assert.match(swSource, /MAX_TILE_CACHE_ENTRIES = 1024/);
assert.match(swSource, /\? cacheFirstTask\(request, SHELL_CACHE\)/);
assert.match(swSource, /: networkFirstTask\(request, SHELL_CACHE\)/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'css\/style\.css'/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'css\/leaflet\.css'/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'js\/app-config\.js'/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'js\/shared-utils\.js'/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'js\/libs\/leaflet\.js'/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'js\/libs\/lucide\.min\.js'/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'js\/libs\/purify\.min\.js'/);
assert.match(swSource, /const DEFAULT_VERSIONED_SHELL_ASSETS = \[[\s\S]*'maps\/atlas-index\.json'/);
assert.doesNotMatch(swSource, /const DEFAULT_STATIC_SHELL_ASSETS = \[[\s\S]*'images\/sky-background\.webp'/);
assert.doesNotMatch(swSource, /const DEFAULT_STATIC_SHELL_ASSETS = \[[\s\S]*'images\/hiraeth-maps-preview\.png'/);
assert.match(swSource, /site\.config\.json\?v=\$\{VERSION\}/);
assert.match(swSource, /const cacheResponse = response\.clone\(\)/);
assert.match(swSource, /\.filter\(\(asset\) => asset !== 'site\.config\.json'\)/);
assert.match(swSource, /cache\.put\(configuredAssets\.configAsset\.url, configuredAssets\.configAsset\.response\)/);
assert.match(swSource, /cache\.addAll\(\[\.\.\.configuredAssets\.static, \.\.\.versionedShellAssets\]\)/);

console.log('shell versioning regression checks passed');
