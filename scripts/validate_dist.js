#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { countFiles, forbiddenPublicFiles, assertPagesBundleSize } = require('./build_pages.js');
const travel = require('../js/travel-network.js');

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
    // Map sharing plus city-address and journey lifecycle hooks use about
    // 226.5 KiB minified; the routing and parcel renderers remain separate.
    appBytes: 228 * 1024,
    // Directions cards, route suggestions and the mobile sheet add about 5 KiB.
    styleBytes: 108 * 1024,
    atlasShellBytes: 32 * 1024
};

function validateDist(options = {}) {
    const distDir = path.resolve(options.distDir || path.resolve(__dirname, '../dist'));
    function artifactPath(relativePath) {
        if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\')) {
            throw new Error(`Invalid artifact reference: ${relativePath}`);
        }
        const resolved = path.resolve(distDir, relativePath);
        if (!resolved.startsWith(`${distDir}${path.sep}`)) throw new Error(`Artifact reference escapes dist: ${relativePath}`);
        return resolved;
    }
    function readJson(relativePath) {
        return JSON.parse(fs.readFileSync(artifactPath(relativePath), 'utf8'));
    }
    function assertRoutingPayloads() {
        const atlas = readJson('maps/atlas-index.json');
        if (!Array.isArray(atlas.tree) || !atlas.tree.length) throw new Error('Pages atlas tree is missing maps.');
        const seenDocuments = new Set();
        const referencedPayloads = new Set();
        function visit(node) {
            if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Invalid Pages atlas node.');
            if (node.dataUrl && !seenDocuments.has(node.dataUrl)) {
                seenDocuments.add(node.dataUrl);
                const base = readJson(node.dataUrl);
                if (base.id !== node.id) throw new Error(`Map identity mismatch: ${node.dataUrl}`);
                if (base.routingDataFields && !base.routingDataUrl) throw new Error(`Missing routing reference: ${node.dataUrl}`);
                if (base.routingDataUrl) {
                    if (!base.routingDataUrl.startsWith('maps/routing/')) throw new Error(`Invalid routing reference: ${base.routingDataUrl}`);
                    const routing = readJson(base.routingDataUrl);
                    referencedPayloads.add(path.relative(distDir, artifactPath(base.routingDataUrl)));
                    const keys = Object.keys(routing || {}).filter(key => key !== 'mapId');
                    const expected = base.routingDataFields;
                    if (!routing || routing.mapId !== base.id || !Array.isArray(expected) || !expected.length ||
                        new Set(expected).size !== expected.length || keys.length !== expected.length ||
                        expected.some(key => !keys.includes(key)) || keys.some(key =>
                            !['buildings', 'travelNodes', 'roads', 'lines'].includes(key) || !Array.isArray(routing[key]))) {
                        throw new Error(`Incomplete or mismatched routing payload: ${base.routingDataUrl}`);
                    }
                    const errors = travel.validate({ ...base, ...routing });
                    if (errors.length) throw new Error(`Invalid routing geometry in ${base.routingDataUrl}: ${errors.join('; ')}`);
                }
            }
            if (node.children !== undefined) {
                if (!Array.isArray(node.children)) throw new Error('Invalid Pages atlas children.');
                node.children.forEach(visit);
            }
        }
        atlas.tree.forEach(visit);
        function inspect(directory) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) inspect(fullPath);
                else if (entry.isFile() && entry.name.endsWith('.json')) {
                    const relativePath = path.relative(distDir, fullPath);
                    const text = fs.readFileSync(fullPath, 'utf8').trim();
                    if (text !== JSON.stringify(JSON.parse(text))) throw new Error(`Pages JSON is not compact: ${relativePath}`);
                    if (relativePath.startsWith(`maps${path.sep}routing${path.sep}`) && !referencedPayloads.has(relativePath)) {
                        throw new Error(`Unreferenced routing payload: ${relativePath}`);
                    }
                }
            }
        }
        inspect(distDir);
    }
    function assertForbiddenFilesAbsent() {
        const present = forbiddenPublicFiles.filter((relativePath) => {
            return fs.existsSync(path.join(distDir, relativePath));
        });
        if (present.length > 0) {
            throw new Error(`Forbidden editor/internal files found in dist/: ${present.join(', ')}`);
        }
    }

    function assertRequiredPagesFilesPresent() {
        const missing = requiredPagesFiles.filter((relativePath) => {
            return !fs.existsSync(path.join(distDir, relativePath));
        });
        if (missing.length > 0) {
            throw new Error(`Required Pages files missing from dist/: ${missing.join(', ')}`);
        }

        const legacyPoiPngDirectory = path.join(distDir, 'images', 'poi-icons');
        const legacyPoiPngs = fs.existsSync(legacyPoiPngDirectory)
            ? fs.readdirSync(legacyPoiPngDirectory).filter((fileName) => fileName.endsWith('.png'))
            : [];
        if (legacyPoiPngs.length > 0) {
            throw new Error(`Legacy POI PNGs found in dist/: ${legacyPoiPngs.join(', ')}`);
        }
    }

    function assertTileCacheVersionsPresent() {
        const tileManifest = readJson('tile/manifest.json');
        if (!Array.isArray(tileManifest.maps) || !tileManifest.maps.length) throw new Error('Pages tile manifest is missing maps.');
        const distAtlas = readJson('maps/atlas-index.json');
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
                const documentPath = path.join(distDir, dataUrl);
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
            throw new Error(`Pages map data is missing tile cache fingerprints: ${invalidMaps.map((map) => map.id).join(', ')}`);
        }
    }

    function assertNativeTileQualityPreserved() {
        const tileManifest = readJson('tile/manifest.json');
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
            throw new Error(`Pages tiles do not preserve native map detail: ${invalidMaps.map((map) => map.id).join(', ')}`);
        }
    }

    function assertOptimizedRuntimeAssets() {
        const appPath = path.join(distDir, 'js', 'app.js');
        const stylePath = path.join(distDir, 'css', 'style.css');
        const atlasPath = path.join(distDir, 'maps', 'atlas-index.json');
        const searchPath = path.join(distDir, 'maps', 'atlas-search-index.json');
        const appBytes = fs.statSync(appPath).size;
        const styleBytes = fs.statSync(stylePath).size;
        const atlasShellBytes = fs.statSync(atlasPath).size;
        const atlas = readJson('maps/atlas-index.json');
        const searchPayload = readJson('maps/atlas-search-index.json');
        const budgetFailures = [];

        if (appBytes > optimizedAssetBudgets.appBytes) budgetFailures.push(`app.js is ${appBytes} bytes`);
        if (styleBytes > optimizedAssetBudgets.styleBytes) budgetFailures.push(`style.css is ${styleBytes} bytes`);
        if (atlasShellBytes > optimizedAssetBudgets.atlasShellBytes) budgetFailures.push(`atlas-index.json is ${atlasShellBytes} bytes`);
        if (budgetFailures.length > 0) {
            throw new Error(`Optimized runtime asset budgets exceeded: ${budgetFailures.join(', ')}`);
        }
        if (Object.prototype.hasOwnProperty.call(atlas, 'searchIndex') || atlas.searchIndexUrl !== 'maps/atlas-search-index.json') {
            throw new Error('Pages atlas shell must defer its search index to maps/atlas-search-index.json.');
        }
        if (!Array.isArray(searchPayload.searchIndex) || searchPayload.searchIndex.length === 0) {
            throw new Error('Pages atlas search payload is missing search entries.');
        }

        [atlasPath, searchPath, path.join(distDir, 'maps', 'Fair-Content.json')].forEach((jsonPath) => {
            const source = fs.readFileSync(jsonPath, 'utf8').trim();
            if (source !== JSON.stringify(JSON.parse(source))) {
                throw new Error(`Pages JSON is not compact: ${path.relative(distDir, jsonPath)}`);
            }
        });

        return {
            appBytes,
            styleBytes,
            atlasShellBytes,
            atlasSearchEntries: searchPayload.searchIndex.length
        };
    }


    assertForbiddenFilesAbsent();
    assertRequiredPagesFilesPresent();
    assertTileCacheVersionsPresent();
    assertNativeTileQualityPreserved();
    const optimizedRuntime = assertOptimizedRuntimeAssets();
    assertRoutingPayloads();
    return { ...optimizedRuntime, fileCount: countFiles(distDir), bundleBytes: assertPagesBundleSize(distDir) };
}

if (require.main === module) {
    try {
        const result = validateDist({ distDir: process.argv[2] });
        console.log(`Pages artifact validation passed (${result.fileCount} files; app/style/atlas ${result.appBytes}/${result.styleBytes}/${result.atlasShellBytes} bytes).`);
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

module.exports = { validateDist, optimizedAssetBudgets, requiredPagesFiles };
