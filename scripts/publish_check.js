#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { countFiles, forbiddenPublicFiles } = require('./build_pages.js');

const repoRoot = path.resolve(__dirname, '..');
const requiredPagesFiles = [
    '.nojekyll',
    'CNAME',
    'index.html',
    'site.config.json',
    'maps/atlas-index.json',
    'maps/atlas-search-index.json',
    'tile/manifest.json'
];
const optimizedAssetBudgets = {
    // The current viewer plus map sharing is about 222 KiB minified.
    appBytes: 225 * 1024,
    styleBytes: 100 * 1024,
    atlasShellBytes: 32 * 1024
};

function runStep(label, command, args) {
    console.log(`\n> ${label}`);
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: 'inherit'
    });
    if (result.error) {
        console.error(result.error.message || result.error);
        process.exit(1);
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function runCapture(command, args) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
    });
    if (result.error || result.status !== 0) return null;
    return String(result.stdout || '').trim();
}

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function getUnitTestFiles() {
    return fs.readdirSync(path.join(repoRoot, 'tests'))
        .filter((fileName) => fileName.endsWith('.test.js'))
        .sort()
        .map((fileName) => path.join('tests', fileName));
}

function assertForbiddenFilesAbsent() {
    const present = forbiddenPublicFiles.filter((relativePath) => {
        return fs.existsSync(path.join(repoRoot, 'dist', relativePath));
    });
    if (present.length > 0) {
        console.error(`Forbidden editor/internal files found in dist/: ${present.join(', ')}`);
        process.exit(1);
    }
}

function assertRequiredPagesFilesPresent() {
    const missing = requiredPagesFiles.filter((relativePath) => {
        return !fs.existsSync(path.join(repoRoot, 'dist', relativePath));
    });
    if (missing.length > 0) {
        console.error(`Required Pages files missing from dist/: ${missing.join(', ')}`);
        process.exit(1);
    }

    const legacyPoiPngDirectory = path.join(repoRoot, 'dist', 'images', 'poi-icons');
    const legacyPoiPngs = fs.existsSync(legacyPoiPngDirectory)
        ? fs.readdirSync(legacyPoiPngDirectory).filter((fileName) => fileName.endsWith('.png'))
        : [];
    if (legacyPoiPngs.length > 0) {
        console.error(`Legacy POI PNGs found in dist/: ${legacyPoiPngs.join(', ')}`);
        process.exit(1);
    }
}

function assertTileCacheVersionsPresent() {
    const tileManifest = readJson('dist/tile/manifest.json');
    const distAtlas = readJson('dist/maps/atlas-index.json');
    const observedVersionsByMapId = new Map();
    const visitedDocuments = new Set();

    function collectMapVersion(mapLike) {
        if (!mapLike || typeof mapLike !== 'object' || Array.isArray(mapLike)) return;
        const mapId = String(mapLike.id || '').trim();
        if (mapId && mapLike.tileSource && typeof mapLike.tileSource === 'object') {
            const versions = observedVersionsByMapId.get(mapId) || new Set();
            versions.add(String(mapLike.tileSource.cacheVersion || '').trim());
            observedVersionsByMapId.set(mapId, versions);
        }
    }

    function walkNode(node) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        collectMapVersion(node);
        const dataUrl = String(node.dataUrl || '').trim().replace(/^\.\//, '');
        if (dataUrl && dataUrl.endsWith('.json') && !visitedDocuments.has(dataUrl)) {
            visitedDocuments.add(dataUrl);
            const documentPath = path.join(repoRoot, 'dist', dataUrl);
            if (fs.existsSync(documentPath)) collectMapVersion(JSON.parse(fs.readFileSync(documentPath, 'utf8')));
        }
        if (Array.isArray(node.children)) node.children.forEach(walkNode);
    }

    if (Array.isArray(distAtlas.tree)) distAtlas.tree.forEach(walkNode);
    const invalidMaps = (tileManifest.maps || []).filter((manifestMap) => {
        const expectedVersion = String(manifestMap.cacheVersion || '').trim();
        const observedVersions = observedVersionsByMapId.get(String(manifestMap.id || '').trim());
        return !expectedVersion || !observedVersions || observedVersions.size !== 1 || !observedVersions.has(expectedVersion);
    });
    if (invalidMaps.length > 0) {
        console.error(`Pages map data is missing tile cache fingerprints: ${invalidMaps.map((map) => map.id).join(', ')}`);
        process.exit(1);
    }
}

function assertNativeTileQualityPreserved() {
    const tileManifest = readJson('dist/tile/manifest.json');
    const invalidMaps = (tileManifest.maps || []).filter((manifestMap) => {
        const maxZoom = Number(manifestMap?.tileSource?.maxZoom);
        const expectedQuality = Number(manifestMap?.tileSource?.quality);
        const nativeLevel = Array.isArray(manifestMap?.levels)
            ? manifestMap.levels.find((level) => Number(level?.z) === maxZoom)
            : null;
        return !nativeLevel ||
            Number(nativeLevel.scaledWidth) !== Number(manifestMap.width) ||
            Number(nativeLevel.scaledHeight) !== Number(manifestMap.height) ||
            Number(nativeLevel.quality) !== expectedQuality;
    });
    if (invalidMaps.length > 0) {
        console.error(`Pages tiles do not preserve native map detail: ${invalidMaps.map((map) => map.id).join(', ')}`);
        process.exit(1);
    }
}

function assertOptimizedRuntimeAssets() {
    const appPath = path.join(repoRoot, 'dist', 'js', 'app.js');
    const stylePath = path.join(repoRoot, 'dist', 'css', 'style.css');
    const atlasPath = path.join(repoRoot, 'dist', 'maps', 'atlas-index.json');
    const searchPath = path.join(repoRoot, 'dist', 'maps', 'atlas-search-index.json');
    const appBytes = fs.statSync(appPath).size;
    const styleBytes = fs.statSync(stylePath).size;
    const atlasShellBytes = fs.statSync(atlasPath).size;
    const atlas = readJson('dist/maps/atlas-index.json');
    const searchPayload = readJson('dist/maps/atlas-search-index.json');
    const budgetFailures = [];

    if (appBytes > optimizedAssetBudgets.appBytes) budgetFailures.push(`app.js is ${appBytes} bytes`);
    if (styleBytes > optimizedAssetBudgets.styleBytes) budgetFailures.push(`style.css is ${styleBytes} bytes`);
    if (atlasShellBytes > optimizedAssetBudgets.atlasShellBytes) budgetFailures.push(`atlas-index.json is ${atlasShellBytes} bytes`);
    if (budgetFailures.length > 0) {
        console.error(`Optimized runtime asset budgets exceeded: ${budgetFailures.join(', ')}`);
        process.exit(1);
    }
    if (Object.prototype.hasOwnProperty.call(atlas, 'searchIndex') || atlas.searchIndexUrl !== 'maps/atlas-search-index.json') {
        console.error('Pages atlas shell must defer its search index to maps/atlas-search-index.json.');
        process.exit(1);
    }
    if (!Array.isArray(searchPayload.searchIndex) || searchPayload.searchIndex.length === 0) {
        console.error('Pages atlas search payload is missing search entries.');
        process.exit(1);
    }

    [atlasPath, searchPath, path.join(repoRoot, 'dist', 'maps', 'Fair-Content.json')].forEach((jsonPath) => {
        const source = fs.readFileSync(jsonPath, 'utf8').trim();
        if (source !== JSON.stringify(JSON.parse(source))) {
            console.error(`Pages JSON is not compact: ${path.relative(repoRoot, jsonPath)}`);
            process.exit(1);
        }
    });

    return {
        appBytes,
        styleBytes,
        atlasShellBytes,
        atlasSearchEntries: searchPayload.searchIndex.length
    };
}

function printChangedFileSummary() {
    const status = runCapture('git', ['status', '--short', '--untracked-files=normal']);
    console.log('\nChanged files:');
    if (!status) {
        console.log('  Unable to read git status.');
        return;
    }
    const lines = status.split('\n').filter(Boolean);
    if (lines.length === 0) {
        console.log('  None');
        return;
    }
    const generatedDistLines = lines.filter((line) => /^.. dist\//.test(line));
    lines
        .filter((line) => !/^.. dist\//.test(line))
        .forEach((line) => console.log(`  ${line}`));
    if (generatedDistLines.length > 0) {
        console.log(`  dist/: ${generatedDistLines.length} generated file changes`);
    }
}

runStep('Generate atlas index', process.execPath, ['scripts/generate_atlas_index.js']);
runStep('Validate map data', process.execPath, ['scripts/validate_map_data.js']);
runStep('Run unit tests', process.execPath, ['--test', ...getUnitTestFiles()]);
runStep('Build GitHub Pages bundle', process.execPath, ['scripts/build_pages.js']);
assertForbiddenFilesAbsent();
assertRequiredPagesFilesPresent();
assertTileCacheVersionsPresent();
assertNativeTileQualityPreserved();
const optimizedRuntime = assertOptimizedRuntimeAssets();

const atlas = readJson('maps/atlas-index.json');
const distPath = path.join(repoRoot, 'dist');
const distFileCount = fs.existsSync(distPath) ? countFiles(distPath) : 0;

console.log('\nPublish check passed.');
console.log(`- Search entries: ${Array.isArray(atlas.searchIndex) ? atlas.searchIndex.length : 0}`);
console.log(`- Pages bundle files: ${distFileCount}`);
console.log('- Required Pages files present');
console.log('- Forbidden editor/internal files absent from dist/');
console.log('- Legacy POI PNG copies absent from dist/');
console.log('- Per-map tile cache fingerprints present');
console.log('- Native map resolution and detail quality preserved');
console.log(`- Optimized app/style/atlas shell: ${optimizedRuntime.appBytes}/${optimizedRuntime.styleBytes}/${optimizedRuntime.atlasShellBytes} bytes`);
console.log(`- Deferred atlas search entries: ${optimizedRuntime.atlasSearchEntries}`);
printChangedFileSummary();
