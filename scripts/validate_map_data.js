#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const mapsDir = path.join(repoRoot, 'maps');
const errors = [];
const journeys = require('../js/campaign-journeys.js');

function relativeFromRepo(fullPath) {
    return path.relative(repoRoot, fullPath).split(path.sep).join('/');
}

function addError(message) {
    errors.push(message);
}

function readJson(relativePath) {
    const fullPath = path.join(repoRoot, relativePath);
    try {
        return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (error) {
        addError(`${relativePath}: invalid JSON (${error.message})`);
        return null;
    }
}

function listJsonFiles(directoryPath) {
    if (!fs.existsSync(directoryPath)) return [];
    return fs.readdirSync(directoryPath, { withFileTypes: true })
        .flatMap((entry) => {
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) return listJsonFiles(entryPath);
            if (entry.isFile() && entry.name.endsWith('.json')) return [entryPath];
            return [];
        })
        .sort();
}

function isExternalUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
}

function isSafeRelativePath(value) {
    const rawPath = String(value || '').trim();
    if (!rawPath || isExternalUrl(rawPath) || rawPath.startsWith('#') || rawPath.startsWith('mailto:')) {
        return false;
    }
    if (path.isAbsolute(rawPath)) return false;
    const normalized = path.normalize(rawPath);
    return normalized && !normalized.startsWith('..') && !path.isAbsolute(normalized);
}

function assertExistingRelativeFile(relativePath, context) {
    if (!relativePath || isExternalUrl(relativePath)) return;
    if (!isSafeRelativePath(relativePath)) {
        addError(`${context}: unsafe repository-relative path "${relativePath}"`);
        return;
    }
    const fullPath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        addError(`${context}: missing referenced file "${relativePath}"`);
    }
}

function assertNonEmptyString(value, context) {
    if (typeof value !== 'string' || !value.trim()) {
        addError(`${context}: expected a non-empty string`);
    }
}

function assertPositiveNumber(value, context) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
        addError(`${context}: expected a positive number`);
    }
}

function assertPositiveInteger(value, context) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        addError(`${context}: expected a positive integer`);
    }
}

function assertNonNegativeInteger(value, context) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        addError(`${context}: expected a non-negative integer`);
    }
}

function validateTileSource(tileSource, context) {
    if (tileSource === undefined) return;
    if (!tileSource || typeof tileSource !== 'object' || Array.isArray(tileSource)) {
        addError(`${context}: expected an object`);
        return;
    }

    const type = String(tileSource.type || 'xyz').trim().toLowerCase();
    if (type !== 'xyz') {
        addError(`${context}.type: expected "xyz"`);
    }

    assertNonEmptyString(tileSource.urlTemplate, `${context}.urlTemplate`);
    const urlTemplate = String(tileSource.urlTemplate || '').trim();
    if (urlTemplate && (!urlTemplate.includes('{z}') || !urlTemplate.includes('{x}') || !urlTemplate.includes('{y}'))) {
        addError(`${context}.urlTemplate: expected {z}, {x}, and {y} tokens`);
    }
    if (urlTemplate && !isSafeRelativePath(urlTemplate.replace(/\{[zxy]\}/g, '0'))) {
        addError(`${context}.urlTemplate: expected a safe repository-relative tile path template`);
    }

    assertPositiveInteger(tileSource.tileSize, `${context}.tileSize`);
    assertNonNegativeInteger(tileSource.minZoom, `${context}.minZoom`);
    assertNonNegativeInteger(tileSource.maxZoom, `${context}.maxZoom`);

    if (Number.isInteger(Number(tileSource.minZoom)) &&
        Number.isInteger(Number(tileSource.maxZoom)) &&
        Number(tileSource.minZoom) > Number(tileSource.maxZoom)) {
        addError(`${context}: minZoom must be less than or equal to maxZoom`);
    }

    if (tileSource.leafletNativeZoom !== undefined && !Number.isFinite(Number(tileSource.leafletNativeZoom))) {
        addError(`${context}.leafletNativeZoom: expected a finite number`);
    }
    if (tileSource.zoomOffset !== undefined && !Number.isFinite(Number(tileSource.zoomOffset))) {
        addError(`${context}.zoomOffset: expected a finite number`);
    }
}

function assertCoordinatePair(value, context) {
    if (!Array.isArray(value) || value.length !== 2) {
        addError(`${context}: expected [y, x] coordinate pair`);
        return;
    }
    value.forEach((coordinate, index) => {
        if (!Number.isFinite(Number(coordinate))) {
            addError(`${context}[${index}]: expected a finite number`);
        }
    });
}

function validatePoint(point, context) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
        addError(`${context}: expected an object`);
        return;
    }
    assertNonEmptyString(point.name, `${context}.name`);
    assertCoordinatePair(point.coords, `${context}.coords`);
    if (point.linkedMapId !== undefined && typeof point.linkedMapId !== 'string') {
        addError(`${context}.linkedMapId: expected a string when present`);
    }
}

function validateRegion(region, context) {
    if (!region || typeof region !== 'object' || Array.isArray(region)) {
        addError(`${context}: expected an object`);
        return;
    }
    assertNonEmptyString(region.name, `${context}.name`);
    if (!Array.isArray(region.coordinates)) {
        addError(`${context}.coordinates: expected an array`);
        return;
    }
    region.coordinates.forEach((coordinate, index) => {
        assertCoordinatePair(coordinate, `${context}.coordinates[${index}]`);
    });
}

function validateLine(line, context) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
        addError(`${context}: expected an object`);
        return;
    }
    if (!line.name && !line.type) {
        addError(`${context}: expected name or type`);
    }
    if (!Array.isArray(line.coordinates)) {
        addError(`${context}.coordinates: expected an array`);
        return;
    }
    line.coordinates.forEach((coordinate, index) => {
        assertCoordinatePair(coordinate, `${context}.coordinates[${index}]`);
    });
}

function validateFeatureArray(mapDocument, key, itemValidator, context) {
    if (mapDocument[key] === undefined) return;
    if (!Array.isArray(mapDocument[key])) {
        addError(`${context}.${key}: expected an array`);
        return;
    }
    mapDocument[key].forEach((item, index) => itemValidator(item, `${context}.${key}[${index}]`));
}

function validateMapDocument(mapDocument, context) {
    if (!mapDocument || typeof mapDocument !== 'object' || Array.isArray(mapDocument)) {
        addError(`${context}: expected an object`);
        return;
    }
    assertNonEmptyString(mapDocument.id, `${context}.id`);
    assertNonEmptyString(mapDocument.name, `${context}.name`);

    const imageFields = [
        'imageUrl',
        'mobileImageUrl',
        'imageUrlMobile',
        'smallImageUrl',
        'imageUrlSmall'
    ];
    imageFields.forEach((field) => {
        if (mapDocument[field]) {
            assertExistingRelativeFile(mapDocument[field], `${context}.${field}`);
        }
    });

    if (mapDocument.imageUrl) {
        assertPositiveNumber(mapDocument.width, `${context}.width`);
        assertPositiveNumber(mapDocument.height, `${context}.height`);
    }

    if (mapDocument.imageVariants !== undefined) {
        if (!mapDocument.imageVariants || typeof mapDocument.imageVariants !== 'object' || Array.isArray(mapDocument.imageVariants)) {
            addError(`${context}.imageVariants: expected an object`);
        } else {
            Object.entries(mapDocument.imageVariants).forEach(([variantName, variantValue]) => {
                if (typeof variantValue === 'string') {
                    assertExistingRelativeFile(variantValue, `${context}.imageVariants.${variantName}`);
                } else if (variantValue && typeof variantValue === 'object' && variantValue.url) {
                    assertExistingRelativeFile(variantValue.url, `${context}.imageVariants.${variantName}.url`);
                }
            });
        }
    }
    validateTileSource(mapDocument.tileSource, `${context}.tileSource`);

    validateFeatureArray(mapDocument, 'pointsOfInterest', validatePoint, context);
    validateFeatureArray(mapDocument, 'regions', validateRegion, context);
    validateFeatureArray(mapDocument, 'lines', validateLine, context);
    validateFeatureArray(mapDocument, 'roads', validateLine, context);
    journeys.validate(mapDocument.journeys).forEach(error => addError(`${context}.journeys: ${error}`));

    if (mapDocument.encounterTables !== undefined && !Array.isArray(mapDocument.encounterTables)) {
        addError(`${context}.encounterTables: expected an array`);
    }
}

function getManifestEntries(manifestDocument) {
    if (Array.isArray(manifestDocument)) return manifestDocument;
    if (manifestDocument && Array.isArray(manifestDocument.maps)) return manifestDocument.maps;
    return null;
}

function validateManifest() {
    const manifest = readJson('maps/maps.json');
    const entries = getManifestEntries(manifest);
    if (!entries) {
        addError('maps/maps.json: expected an array or an object with a maps array');
        return;
    }

    const knownIds = new Set();
    entries.forEach((entry, index) => {
        const context = `maps/maps.json[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            addError(`${context}: expected an object`);
            return;
        }
        assertNonEmptyString(entry.id, `${context}.id`);
        assertNonEmptyString(entry.name, `${context}.name`);
        if (entry.id) {
            if (knownIds.has(entry.id)) addError(`${context}.id: duplicate id "${entry.id}"`);
            knownIds.add(entry.id);
        }
        if (entry.dataUrl) assertExistingRelativeFile(entry.dataUrl, `${context}.dataUrl`);
    });

    entries.forEach((entry, index) => {
        if (!entry || !entry.parentId) return;
        if (!knownIds.has(entry.parentId)) {
            addError(`maps/maps.json[${index}].parentId: unknown parent "${entry.parentId}"`);
        }
    });
}

function validateAtlasNode(node, context) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
        addError(`${context}: expected an object`);
        return;
    }
    assertNonEmptyString(node.id, `${context}.id`);
    assertNonEmptyString(node.name, `${context}.name`);
    if (node.dataUrl) assertExistingRelativeFile(node.dataUrl, `${context}.dataUrl`);
    if (node.imageUrl) {
        assertExistingRelativeFile(node.imageUrl, `${context}.imageUrl`);
        assertPositiveNumber(node.width, `${context}.width`);
        assertPositiveNumber(node.height, `${context}.height`);
    }
    validateTileSource(node.tileSource, `${context}.tileSource`);
    if (node.children !== undefined) {
        if (!Array.isArray(node.children)) {
            addError(`${context}.children: expected an array`);
            return;
        }
        node.children.forEach((child, index) => validateAtlasNode(child, `${context}.children[${index}]`));
    }
}

function validateAtlasIndex() {
    const atlas = readJson('maps/atlas-index.json');
    if (!atlas) return;
    if (!Array.isArray(atlas.tree)) {
        addError('maps/atlas-index.json.tree: expected an array');
    } else {
        atlas.tree.forEach((node, index) => validateAtlasNode(node, `maps/atlas-index.json.tree[${index}]`));
    }
    if (!Array.isArray(atlas.searchIndex)) {
        addError('maps/atlas-index.json.searchIndex: expected an array');
    }
}

function validateAllJsonParses() {
    listJsonFiles(mapsDir).forEach((fullPath) => {
        readJson(relativeFromRepo(fullPath));
    });
}

function validateSourceMapFiles() {
    fs.readdirSync(mapsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => `maps/${entry.name}`)
        .filter((relativePath) => !['maps/maps.json', 'maps/atlas-index.json'].includes(relativePath))
        .forEach((relativePath) => {
            validateMapDocument(readJson(relativePath), relativePath);
        });
}

function validateSiteConfig() {
    const siteConfig = readJson('site.config.json');
    if (!siteConfig) return;
    const assetConfig = siteConfig.assets || {};
    ['cloudTexture', 'previewImage'].forEach((field) => {
        if (assetConfig[field]) assertExistingRelativeFile(assetConfig[field], `site.config.json.assets.${field}`);
    });
    Object.entries(assetConfig.poiIcons || {}).forEach(([group, iconPath]) => {
        assertExistingRelativeFile(iconPath, `site.config.json.assets.poiIcons.${group}`);
    });
    Object.entries(assetConfig.poiTypeIcons || {}).forEach(([type, iconPath]) => {
        assertExistingRelativeFile(iconPath, `site.config.json.assets.poiTypeIcons.${type}`);
    });
    Object.entries(assetConfig.audio || {}).forEach(([mode, audioPath]) => {
        assertExistingRelativeFile(audioPath, `site.config.json.assets.audio.${mode}`);
    });
}

function validateMapData() {
    validateAllJsonParses();
    validateManifest();
    validateAtlasIndex();
    validateSourceMapFiles();
    validateSiteConfig();

    if (errors.length > 0) {
        console.error(`Map data validation failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
        errors.forEach((error) => console.error(`- ${error}`));
        process.exit(1);
    }

    console.log('Map data validation passed.');
}

if (require.main === module) {
    validateMapData();
}

module.exports = {
    validateMapData
};
