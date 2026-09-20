#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const { generateTiles } = require('./generate_tiles.js');
const { generateSharePages } = require('./generate_share_pages.js');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'dist');
const defaultTileCachePath = path.join(repoRoot, '.cache', 'pages-tiles');
const maxPagesBundleBytes = 225 * 1024 * 1024;

const runtimeFiles = [
    'index.html',
    'CNAME',
    'sw.js',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'favicon.png',
    'apple-touch-icon.png'
];

const runtimeAssetFiles = [
    'css/leaflet.css',
    'css/style.css',
    'css/stars.css',
    'css/Control.MiniMap.min.css',
    'css/images/marker-icon.png',
    'css/images/marker-icon-2x.png',
    'css/images/marker-shadow.png',
    'js/app-config.js',
    'js/shared-utils.js',
    'js/campaign-journeys.js',
    'js/libs/leaflet.js',
    'js/libs/purify.min.js',
    'js/libs/lucide.min.js',
    'js/starfield.js',
    'js/app.js',
    'js/libs/Control.MiniMap.min.js'
];

const runtimeDirectories = [
    'images',
    'sounds'
];

const forbiddenPublicFiles = [
    'map-editor.html',
    'js/map-editor.js',
    'js/editor-shared.js',
    'js/libs/text-toolbar.js',
    'css/map-editor.css',
    'maps/maps.json',
    'tests',
    'scripts',
    'node_modules'
];

const ignoredAssetFileNames = new Set([
    '.DS_Store'
]);
const ignoredRuntimeAssetPatterns = [
    /^images\/poi-icons\/[^/]+\.png$/i
];
const pagesLucideReferenceFiles = [
    'index.html',
    'js/app.js'
];
const pagesAtlasSearchIndexPath = 'maps/atlas-search-index.json';
const pagesRuntimeMinifyFiles = [
    { relativePath: 'css/style.css', loader: 'css', target: ['chrome100', 'firefox100', 'safari15.4'] },
    { relativePath: 'css/stars.css', loader: 'css', target: ['chrome100', 'firefox100', 'safari15.4'] },
    { relativePath: 'js/app-config.js', loader: 'js', target: 'es2020' },
    { relativePath: 'js/app.js', loader: 'js', target: 'es2020' },
    { relativePath: 'js/campaign-journeys.js', loader: 'js', target: 'es2020' },
    { relativePath: 'js/shared-utils.js', loader: 'js', target: 'es2020' },
    { relativePath: 'js/starfield.js', loader: 'js', target: 'es2020' }
];

function resolveRepoPath(relativePath) {
    const resolved = path.resolve(repoRoot, relativePath);
    if (!resolved.startsWith(`${repoRoot}${path.sep}`) && resolved !== repoRoot) {
        throw new Error(`Refusing to resolve path outside repository: ${relativePath}`);
    }
    return resolved;
}

function resolveOutputPath(relativePath) {
    const resolved = path.resolve(outputDir, relativePath);
    if (!resolved.startsWith(`${outputDir}${path.sep}`) && resolved !== outputDir) {
        throw new Error(`Refusing to write path outside dist: ${relativePath}`);
    }
    return resolved;
}

function assertExists(sourcePath, label) {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Missing required Pages asset: ${label}`);
    }
}

function copyFile(relativePath) {
    const sourcePath = resolveRepoPath(relativePath);
    const destinationPath = resolveOutputPath(relativePath);
    assertExists(sourcePath, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
}

function createPagesSiteConfig(sourceConfig) {
    const pagesConfig = JSON.parse(JSON.stringify(sourceConfig || {}));
    pagesConfig.performance = {
        ...(pagesConfig.performance || {}),
        tileAssetRoot: 'tile',
        tileFullImageFallback: false
    };
    return pagesConfig;
}

function copyPagesSiteConfig() {
    const relativePath = 'site.config.json';
    const sourcePath = resolveRepoPath(relativePath);
    const destinationPath = resolveOutputPath(relativePath);
    assertExists(sourcePath, relativePath);
    const sourceConfig = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const pagesConfig = createPagesSiteConfig(sourceConfig);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, `${JSON.stringify(pagesConfig, null, 2)}\n`);
    return pagesConfig;
}

function serializeInlineJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function embedPagesSiteConfig(indexHtml, pagesConfig) {
    const appConfigScriptPattern = /(<script src="js\/app-config\.js\?v=[^"]+"><\/script>)/;
    if (!appConfigScriptPattern.test(indexHtml)) {
        throw new Error('Could not locate the app config script in index.html.');
    }
    const inlineConfig = `<script>window.__SITE_CONFIG__=${serializeInlineJson(pagesConfig)};window.__SITE_CONFIG_EMBEDDED__=true;</script>`;
    return indexHtml.replace(appConfigScriptPattern, `${inlineConfig}\n    $1`);
}

function embedPagesConfigInIndex(pagesConfig) {
    const destinationPath = resolveOutputPath('index.html');
    const indexHtml = fs.readFileSync(destinationPath, 'utf8');
    fs.writeFileSync(destinationPath, embedPagesSiteConfig(indexHtml, pagesConfig));
}

function createPagesAtlasPayloads(atlasIndex) {
    if (!atlasIndex || !Array.isArray(atlasIndex.tree) || !Array.isArray(atlasIndex.searchIndex)) {
        throw new Error('Atlas index must include tree and searchIndex arrays before Pages optimization.');
    }
    const { searchIndex, ...atlasShell } = atlasIndex;
    atlasShell.searchIndexUrl = pagesAtlasSearchIndexPath;
    return {
        atlasShell,
        searchPayload: {
            generatedAt: atlasIndex.generatedAt || null,
            searchIndex
        }
    };
}

function splitPagesAtlasSearchIndex() {
    const atlasPath = resolveOutputPath('maps/atlas-index.json');
    const atlasIndex = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
    const { atlasShell, searchPayload } = createPagesAtlasPayloads(atlasIndex);
    const searchPath = resolveOutputPath(pagesAtlasSearchIndexPath);
    fs.mkdirSync(path.dirname(searchPath), { recursive: true });
    fs.writeFileSync(atlasPath, `${JSON.stringify(atlasShell, null, 2)}\n`);
    fs.writeFileSync(searchPath, `${JSON.stringify(searchPayload, null, 2)}\n`);
    return {
        entryCount: searchPayload.searchIndex.length,
        searchPath: pagesAtlasSearchIndexPath
    };
}

function minifyPagesRuntimeSource(source, { loader, target }) {
    return transformSync(String(source || ''), {
        charset: 'utf8',
        legalComments: 'eof',
        loader,
        minify: true,
        target
    }).code;
}

function optimizePagesRuntimeAssets() {
    let sourceBytes = 0;
    let optimizedBytes = 0;
    pagesRuntimeMinifyFiles.forEach((asset) => {
        const assetPath = resolveOutputPath(asset.relativePath);
        const source = fs.readFileSync(assetPath, 'utf8');
        const optimized = minifyPagesRuntimeSource(source, asset);
        sourceBytes += Buffer.byteLength(source);
        optimizedBytes += Buffer.byteLength(optimized);
        fs.writeFileSync(assetPath, optimized);
    });
    return { sourceBytes, optimizedBytes };
}

function compactJsonText(source) {
    return `${JSON.stringify(JSON.parse(source))}\n`;
}

function compactPagesJsonAssets(directoryPath = outputDir) {
    let sourceBytes = 0;
    let compactBytes = 0;
    let fileCount = 0;

    function walk(currentPath) {
        fs.readdirSync(currentPath, { withFileTypes: true }).forEach((entry) => {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                walk(entryPath);
                return;
            }
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') return;
            const source = fs.readFileSync(entryPath, 'utf8');
            const compact = compactJsonText(source);
            sourceBytes += Buffer.byteLength(source);
            compactBytes += Buffer.byteLength(compact);
            fileCount += 1;
            fs.writeFileSync(entryPath, compact);
        });
    }

    walk(directoryPath);
    return { sourceBytes, compactBytes, fileCount };
}

function shouldCopyRuntimeAsset(relativePath) {
    const normalizedPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalizedPath || ignoredAssetFileNames.has(path.posix.basename(normalizedPath))) return false;
    return !ignoredRuntimeAssetPatterns.some((pattern) => pattern.test(normalizedPath));
}

function copyDirectory(relativePath) {
    const sourcePath = resolveRepoPath(relativePath);
    const destinationPath = resolveOutputPath(relativePath);
    assertExists(sourcePath, relativePath);
    fs.cpSync(sourcePath, destinationPath, {
        recursive: true,
        filter: (source) => shouldCopyRuntimeAsset(path.relative(repoRoot, source))
    });
}

function collectPagesLucideIconNames(sourceTexts = null) {
    const texts = Array.isArray(sourceTexts)
        ? sourceTexts
        : pagesLucideReferenceFiles.map((relativePath) => {
            return fs.readFileSync(resolveRepoPath(relativePath), 'utf8');
        });
    const iconNames = new Set();

    texts.forEach((sourceText) => {
        const iconPattern = /\bdata-lucide=["']([a-z0-9-]+)["']/gi;
        let match = iconPattern.exec(String(sourceText || ''));
        while (match) {
            iconNames.add(match[1].toLowerCase());
            match = iconPattern.exec(String(sourceText || ''));
        }
    });

    return Array.from(iconNames).sort();
}

function getLucideExportName(iconName) {
    return String(iconName || '')
        .split('-')
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join('');
}

function buildPagesLucideSubsetSource(iconNames, lucideModule) {
    const icons = {};
    Array.from(new Set(iconNames || [])).sort().forEach((iconName) => {
        const exportName = getLucideExportName(iconName);
        const iconNode = lucideModule?.icons?.[exportName] || lucideModule?.[exportName];
        if (!Array.isArray(iconNode)) {
            throw new Error(`Lucide icon is unavailable for the Pages subset: ${iconName}`);
        }
        icons[iconName] = iconNode;
    });
    if (Object.keys(icons).length === 0) {
        throw new Error('No Lucide icons were discovered for the Pages subset.');
    }

    return `/**
 * @license lucide v1.17.0 - ISC
 * Production subset generated from js/libs/lucide.min.js.
 */
(function(root){
    'use strict';
    const icons=${JSON.stringify(icons)};
    const defaultAttributes={xmlns:'http://www.w3.org/2000/svg',width:24,height:24,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'};
    function createElement(node){
        const tagName=node[0];
        const attributes=node[1]||{};
        const children=node[2]||[];
        const element=document.createElementNS('http://www.w3.org/2000/svg',tagName);
        Object.keys(attributes).forEach((name)=>element.setAttribute(name,String(attributes[name])));
        children.forEach((child)=>element.appendChild(createElement(child)));
        return element;
    }
    function hasAccessibleName(attributes){
        return Object.keys(attributes).some((name)=>name.startsWith('aria-')||name==='role'||name==='title');
    }
    function createIcons(options={}){
        const rootNode=options.root||document;
        const nameAttribute=options.nameAttr||'data-lucide';
        const sharedAttributes=options.attrs||{};
        rootNode.querySelectorAll('['+nameAttribute+']').forEach((placeholder)=>{
            const iconName=String(placeholder.getAttribute(nameAttribute)||'').toLowerCase();
            const iconNode=icons[iconName];
            if(!iconNode){
                if(root.console&&typeof root.console.warn==='function')root.console.warn('Lucide icon not included in Pages subset:',iconName);
                return;
            }
            const elementAttributes={};
            Array.from(placeholder.attributes).forEach((attribute)=>{elementAttributes[attribute.name]=attribute.value;});
            if(!hasAccessibleName(elementAttributes))elementAttributes['aria-hidden']='true';
            const classes=['lucide','lucide-'+iconName,elementAttributes.class||'']
                .join(' ').split(/\\s+/).filter((value,index,values)=>value&&values.indexOf(value)===index).join(' ');
            elementAttributes.class=classes;
            const svg=createElement(['svg',{...defaultAttributes,...sharedAttributes,...elementAttributes},iconNode]);
            placeholder.replaceWith(svg);
        });
    }
    root.lucide={icons,createIcons};
})(typeof globalThis!=='undefined'?globalThis:this);
`;
}

function writePagesLucideSubset() {
    const relativePath = 'js/libs/lucide.min.js';
    const sourcePath = resolveRepoPath(relativePath);
    const destinationPath = resolveOutputPath(relativePath);
    const iconNames = collectPagesLucideIconNames();
    delete require.cache[require.resolve(sourcePath)];
    const lucideModule = require(sourcePath);
    const subsetSource = buildPagesLucideSubsetSource(iconNames, lucideModule);
    fs.writeFileSync(destinationPath, subsetSource);

    return {
        iconCount: iconNames.length,
        sourceBytes: fs.statSync(sourcePath).size,
        subsetBytes: Buffer.byteLength(subsetSource)
    };
}

function isExternalUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
}

function normalizePublicAssetPath(assetPath) {
    const rawPath = String(assetPath || '').trim();
    if (!rawPath || isExternalUrl(rawPath) || rawPath.startsWith('#') || rawPath.startsWith('mailto:')) {
        return '';
    }

    const withoutHash = rawPath.split('#')[0];
    const withoutQuery = withoutHash.split('?')[0];
    if (!withoutQuery || path.isAbsolute(withoutQuery)) return '';

    const normalized = path.posix.normalize(withoutQuery);
    if (!normalized || normalized.startsWith('../') || normalized === '..' || path.isAbsolute(normalized)) {
        return '';
    }
    return normalized;
}

function addPublicAssetPath(assetPaths, assetPath, { optional = false } = {}) {
    const normalized = normalizePublicAssetPath(assetPath);
    if (!normalized) return;
    if (optional && !fs.existsSync(resolveRepoPath(normalized))) return;
    assetPaths.add(normalized);
}

function getDerivedMiniMapImagePath(imagePath) {
    const normalized = normalizePublicAssetPath(imagePath);
    if (!normalized) return '';
    const miniPath = normalized.replace(/(\.[^./?#]+)$/, '.mini.webp');
    return miniPath === normalized ? `${normalized}.mini.webp` : miniPath;
}

function addMapImageAssetPaths(assetPaths, mapLike, { includeFullImages = true, requirePreview = false } = {}) {
    if (!mapLike || typeof mapLike !== 'object') return;
    [
        'imageUrl',
        'mobileImageUrl',
        'imageUrlMobile',
        'smallImageUrl',
        'imageUrlSmall'
    ].forEach((key) => {
        const imagePath = mapLike[key];
        if (includeFullImages) addPublicAssetPath(assetPaths, imagePath);
        const previewPath = getDerivedMiniMapImagePath(imagePath);
        addPublicAssetPath(assetPaths, previewPath, { optional: !requirePreview });
        if (requirePreview && imagePath && !fs.existsSync(resolveRepoPath(previewPath))) {
            throw new Error(`Tiled map image is missing its preview asset: ${previewPath}`);
        }
    });

    if (mapLike.imageVariants && typeof mapLike.imageVariants === 'object' && !Array.isArray(mapLike.imageVariants)) {
        Object.values(mapLike.imageVariants).forEach((variantValue) => {
            const imagePath = typeof variantValue === 'string' ? variantValue : variantValue?.url;
            if (includeFullImages) addPublicAssetPath(assetPaths, imagePath);
            const previewPath = getDerivedMiniMapImagePath(imagePath);
            addPublicAssetPath(assetPaths, previewPath, { optional: !requirePreview });
            if (requirePreview && imagePath && !fs.existsSync(resolveRepoPath(previewPath))) {
                throw new Error(`Tiled map image variant is missing its preview asset: ${previewPath}`);
            }
        });
    }
}

function readMapDocument(dataUrl) {
    const normalizedDataUrl = normalizePublicAssetPath(dataUrl);
    if (!normalizedDataUrl) return null;
    const mapDocumentPath = resolveRepoPath(normalizedDataUrl);
    if (!fs.existsSync(mapDocumentPath)) return null;

    return JSON.parse(fs.readFileSync(mapDocumentPath, 'utf8'));
}

function hasGeneratedTileSource(mapLike) {
    const source = mapLike && mapLike.tileSource;
    return !!(
        source &&
        typeof source === 'object' &&
        !Array.isArray(source) &&
        String(source.urlTemplate || '').includes('{z}') &&
        String(source.urlTemplate || '').includes('{x}') &&
        String(source.urlTemplate || '').includes('{y}')
    );
}

function collectPublicMapAssetFiles() {
    const atlasIndexPath = resolveRepoPath('maps/atlas-index.json');
    assertExists(atlasIndexPath, 'maps/atlas-index.json');

    const atlasIndex = JSON.parse(fs.readFileSync(atlasIndexPath, 'utf8'));
    const assetPaths = new Set(['maps/atlas-index.json']);

    function walkNode(node) {
        if (!node || typeof node !== 'object') return;

        const dataUrl = normalizePublicAssetPath(node.dataUrl);
        let mapDocument = null;
        if (dataUrl) {
            addPublicAssetPath(assetPaths, dataUrl);
            mapDocument = readMapDocument(dataUrl);
        }
        const publicMap = mapDocument ? { ...node, ...mapDocument } : node;
        const tiled = hasGeneratedTileSource(publicMap);
        addMapImageAssetPaths(assetPaths, publicMap, {
            includeFullImages: !tiled,
            requirePreview: tiled
        });

        if (Array.isArray(node.children)) {
            node.children.forEach(walkNode);
        }
    }

    if (Array.isArray(atlasIndex.tree)) {
        atlasIndex.tree.forEach(walkNode);
    }

    return Array.from(assetPaths).sort();
}

function copyPublicMapAssets() {
    collectPublicMapAssetFiles().forEach(copyFile);
}

function applyTileCacheVersionToMap(mapLike, cacheVersionsByMapId, matchedMapIds = null) {
    if (!mapLike || typeof mapLike !== 'object' || Array.isArray(mapLike)) return false;
    const mapId = String(mapLike.id || '').trim();
    const cacheVersion = cacheVersionsByMapId instanceof Map
        ? cacheVersionsByMapId.get(mapId)
        : cacheVersionsByMapId?.[mapId];
    if (!cacheVersion || !mapLike.tileSource || typeof mapLike.tileSource !== 'object' || Array.isArray(mapLike.tileSource)) {
        return false;
    }
    mapLike.tileSource.cacheVersion = String(cacheVersion);
    if (matchedMapIds instanceof Set) matchedMapIds.add(mapId);
    return true;
}

function applyPagesTileCacheVersions(tileManifest) {
    const manifestMaps = Array.isArray(tileManifest?.maps) ? tileManifest.maps : [];
    const cacheVersionsByMapId = new Map(manifestMaps.map((manifestMap) => [
        String(manifestMap?.id || '').trim(),
        String(manifestMap?.cacheVersion || '').trim()
    ]).filter(([mapId, cacheVersion]) => mapId && cacheVersion));
    if (cacheVersionsByMapId.size !== manifestMaps.length || cacheVersionsByMapId.size === 0) {
        throw new Error('Tile manifest is missing per-map cache versions.');
    }

    const atlasPath = resolveOutputPath('maps/atlas-index.json');
    const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
    const matchedMapIds = new Set();
    const mapDocuments = new Map();

    function walkNode(node) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        applyTileCacheVersionToMap(node, cacheVersionsByMapId, matchedMapIds);

        const dataUrl = normalizePublicAssetPath(node.dataUrl);
        if (dataUrl && dataUrl.toLowerCase().endsWith('.json')) {
            const documentPath = resolveOutputPath(dataUrl);
            if (fs.existsSync(documentPath) && !mapDocuments.has(documentPath)) {
                const mapDocument = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
                applyTileCacheVersionToMap(mapDocument, cacheVersionsByMapId, matchedMapIds);
                mapDocuments.set(documentPath, mapDocument);
            }
        }

        if (Array.isArray(node.children)) node.children.forEach(walkNode);
    }

    if (Array.isArray(atlas.tree)) atlas.tree.forEach(walkNode);
    const missingMapIds = Array.from(cacheVersionsByMapId.keys()).filter((mapId) => !matchedMapIds.has(mapId));
    if (missingMapIds.length > 0) {
        throw new Error(`Could not attach tile cache versions to map data: ${missingMapIds.join(', ')}`);
    }

    fs.writeFileSync(atlasPath, `${JSON.stringify(atlas, null, 2)}\n`);
    mapDocuments.forEach((mapDocument, documentPath) => {
        fs.writeFileSync(documentPath, `${JSON.stringify(mapDocument, null, 2)}\n`);
    });
    return { mapCount: matchedMapIds.size, documentCount: mapDocuments.size };
}

function populatePagesTiles() {
    const destinationPath = resolveOutputPath('tile');
    const configuredCachePath = String(process.env.MAP_HIRAETH_TILE_CACHE_DIR || '').trim();
    const cachePath = configuredCachePath
        ? path.resolve(repoRoot, configuredCachePath)
        : defaultTileCachePath;
    if (cachePath === outputDir || cachePath.startsWith(`${outputDir}${path.sep}`)) {
        throw new Error('MAP_HIRAETH_TILE_CACHE_DIR must be outside dist/.');
    }
    generateTiles({ repoRoot, outputDir: cachePath, reuseExisting: true });
    fs.cpSync(cachePath, destinationPath, { recursive: true });
    return JSON.parse(fs.readFileSync(path.join(destinationPath, 'manifest.json'), 'utf8'));
}

function assertForbiddenFilesAbsent() {
    const presentForbiddenFiles = forbiddenPublicFiles.filter((relativePath) => {
        return fs.existsSync(resolveOutputPath(relativePath));
    });
    if (presentForbiddenFiles.length > 0) {
        throw new Error(`Forbidden internal files were copied to dist: ${presentForbiddenFiles.join(', ')}`);
    }
}

function getDirectorySizeBytes(directoryPath) {
    if (!fs.existsSync(directoryPath)) return 0;

    return fs.readdirSync(directoryPath, { withFileTypes: true }).reduce((total, entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) return total + getDirectorySizeBytes(entryPath);
        if (entry.isFile()) return total + fs.statSync(entryPath).size;
        return total;
    }, 0);
}

function assertPagesBundleSize(directoryPath, maxBytes = maxPagesBundleBytes) {
    const bundleSizeBytes = getDirectorySizeBytes(directoryPath);
    if (bundleSizeBytes > maxBytes) {
        const actualMiB = (bundleSizeBytes / 1024 / 1024).toFixed(1);
        const maximumMiB = (maxBytes / 1024 / 1024).toFixed(1);
        throw new Error(`Pages bundle is ${actualMiB} MiB; expected no more than ${maximumMiB} MiB.`);
    }
    return bundleSizeBytes;
}

function buildPagesBundle() {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    runtimeFiles.forEach(copyFile);
    const pagesConfig = copyPagesSiteConfig();
    embedPagesConfigInIndex(pagesConfig);
    runtimeAssetFiles.forEach(copyFile);
    const lucideSubset = writePagesLucideSubset();
    runtimeDirectories.forEach(copyDirectory);
    copyPublicMapAssets();
    const sharePageCount = generateSharePages({
        repoRoot, outputDir, brand: pagesConfig.brand,
        tree: JSON.parse(fs.readFileSync(resolveRepoPath('maps/atlas-index.json'), 'utf8')).tree
    });
    console.log(`Generated previews for ${sharePageCount} maps.`);
    const tileManifest = populatePagesTiles();
    const tileCacheVersions = applyPagesTileCacheVersions(tileManifest);
    const atlasSearchSplit = splitPagesAtlasSearchIndex();
    const runtimeOptimization = optimizePagesRuntimeAssets();
    const jsonOptimization = compactPagesJsonAssets();

    fs.writeFileSync(path.join(outputDir, '.nojekyll'), '');
    removeIgnoredAssetFiles(outputDir);
    assertForbiddenFilesAbsent();

    const copiedFileCount = countFiles(outputDir);
    const bundleSizeBytes = assertPagesBundleSize(outputDir);
    const bundleSizeMiB = (bundleSizeBytes / 1024 / 1024).toFixed(1);
    const lucideSourceKiB = (lucideSubset.sourceBytes / 1024).toFixed(1);
    const lucideSubsetKiB = (lucideSubset.subsetBytes / 1024).toFixed(1);
    const runtimeSourceKiB = (runtimeOptimization.sourceBytes / 1024).toFixed(1);
    const runtimeOptimizedKiB = (runtimeOptimization.optimizedBytes / 1024).toFixed(1);
    const jsonSourceKiB = (jsonOptimization.sourceBytes / 1024).toFixed(1);
    const jsonCompactKiB = (jsonOptimization.compactBytes / 1024).toFixed(1);
    console.log(`Reduced Lucide from ${lucideSourceKiB} KiB to ${lucideSubsetKiB} KiB (${lucideSubset.iconCount} icons).`);
    console.log(`Minified owned runtime assets from ${runtimeSourceKiB} KiB to ${runtimeOptimizedKiB} KiB.`);
    console.log(`Compacted ${jsonOptimization.fileCount} JSON files from ${jsonSourceKiB} KiB to ${jsonCompactKiB} KiB.`);
    console.log(`Deferred ${atlasSearchSplit.entryCount} atlas search entries to ${atlasSearchSplit.searchPath}.`);
    console.log(`Pinned ${tileCacheVersions.mapCount} map tile sets to content fingerprints.`);
    console.log(`Built GitHub Pages bundle at dist/ with ${copiedFileCount} files (${bundleSizeMiB} MiB).`);
}

function removeIgnoredAssetFiles(directoryPath) {
    if (!fs.existsSync(directoryPath)) return;
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    entries.forEach((entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            removeIgnoredAssetFiles(entryPath);
            return;
        }
        if (entry.isFile() && ignoredAssetFileNames.has(entry.name)) {
            fs.rmSync(entryPath, { force: true });
        }
    });
}

function countFiles(directoryPath) {
    let count = 0;
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    entries.forEach((entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            count += countFiles(entryPath);
        } else if (entry.isFile()) {
            count += 1;
        }
    });
    return count;
}

if (require.main === module) {
    try {
        buildPagesBundle();
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

module.exports = {
    assertPagesBundleSize,
    applyPagesTileCacheVersions,
    applyTileCacheVersionToMap,
    buildPagesLucideSubsetSource,
    buildPagesBundle,
    compactJsonText,
    compactPagesJsonAssets,
    collectPagesLucideIconNames,
    collectPublicMapAssetFiles,
    countFiles,
    createPagesAtlasPayloads,
    createPagesSiteConfig,
    defaultTileCachePath,
    embedPagesSiteConfig,
    forbiddenPublicFiles: [...forbiddenPublicFiles],
    hasGeneratedTileSource,
    ignoredAssetFileNames: [...ignoredAssetFileNames],
    getDirectorySizeBytes,
    maxPagesBundleBytes,
    minifyPagesRuntimeSource,
    optimizePagesRuntimeAssets,
    pagesAtlasSearchIndexPath,
    pagesLucideReferenceFiles: [...pagesLucideReferenceFiles],
    pagesRuntimeMinifyFiles: pagesRuntimeMinifyFiles.map((asset) => ({ ...asset })),
    runtimeAssetFiles: [...runtimeAssetFiles],
    runtimeDirectories: [...runtimeDirectories],
    runtimeFiles: [...runtimeFiles],
    shouldCopyRuntimeAsset,
    splitPagesAtlasSearchIndex,
    writePagesLucideSubset
};
